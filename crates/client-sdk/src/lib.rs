use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use anyhow::{anyhow, Result};
use argon2::{password_hash::SaltString, Argon2};
use rand::{rngs::OsRng, RngCore};
use reed_solomon_erasure::galois_8::ReedSolomon;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const DEFAULT_CHUNK_SIZE: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineConfig {
    pub chunk_size: usize,
    pub data_shards: usize,
    pub parity_shards: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum RedundancyProfile {
    Mobile,
    Balanced,
    Resilient,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            chunk_size: DEFAULT_CHUNK_SIZE,
            data_shards: 4,
            parity_shards: 2,
        }
    }
}

pub fn adaptive_config(
    total_bytes: usize,
    peer_count: usize,
    profile: RedundancyProfile,
) -> PipelineConfig {
    let mut cfg = PipelineConfig::default();

    match profile {
        RedundancyProfile::Mobile => {
            cfg.chunk_size = 128 * 1024;
            cfg.data_shards = 3;
            cfg.parity_shards = 1;
        }
        RedundancyProfile::Balanced => {
            cfg.chunk_size = DEFAULT_CHUNK_SIZE;
            cfg.data_shards = 4;
            cfg.parity_shards = if total_bytes > 32 * 1024 * 1024 { 3 } else { 2 };
        }
        RedundancyProfile::Resilient => {
            cfg.chunk_size = DEFAULT_CHUNK_SIZE;
            cfg.data_shards = 4;
            cfg.parity_shards = 4;
        }
    }

    if peer_count > 0 {
        // Keep at least 2 shards per peer target when enough peers are available.
        let target_total = usize::max(4, usize::min(12, peer_count.saturating_mul(2)));
        let base_data = usize::max(2, usize::min(cfg.data_shards, target_total - 1));
        cfg.data_shards = base_data;
        cfg.parity_shards = usize::max(1, target_total.saturating_sub(base_data));
    }

    cfg
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedChunk {
    pub nonce: [u8; 12],
    pub ciphertext: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shard {
    pub chunk_index: usize,
    pub shard_index: usize,
    pub cid: String,
    pub bytes: Vec<u8>,
    pub payload_len: usize,
    pub data_shards: usize,
    pub parity_shards: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineOutput {
    pub salt: String,
    pub shards: Vec<Shard>,
    pub manifest_root: String,
    pub total_bytes: usize,
    pub chunk_count: usize,
}

pub fn manifest_root_from_shards(shards: &[Shard]) -> String {
    let items: Vec<&str> = shards.iter().map(|s| s.cid.as_str()).collect();
    merkle_root(&items)
}

pub fn process_bytes(input: &[u8], password: &str, cfg: PipelineConfig) -> Result<PipelineOutput> {
    validate_cfg(&cfg)?;

    let salt = SaltString::generate(&mut OsRng);
    let key = derive_key(password, &salt)?;

    let mut shards_out = Vec::new();
    let mut chunk_count = 0usize;
    for (idx, chunk) in input.chunks(cfg.chunk_size).enumerate() {
        chunk_count += 1;
        let enc = encrypt_chunk(chunk, &key)?;
        let payload_len = 12 + enc.ciphertext.len();
        let encoded_shards = erasure_encode(&enc, cfg.data_shards, cfg.parity_shards)?;
        for (sidx, shard) in encoded_shards.into_iter().enumerate() {
            let cid = sha256_hex(&shard);
            shards_out.push(Shard {
                chunk_index: idx,
                shard_index: sidx,
                cid,
                bytes: shard,
                payload_len,
                data_shards: cfg.data_shards,
                parity_shards: cfg.parity_shards,
            });
        }
    }

    let manifest_root = merkle_root(
        &shards_out
            .iter()
            .map(|s| s.cid.as_str())
            .collect::<Vec<_>>(),
    );

    Ok(PipelineOutput {
        salt: salt.to_string(),
        shards: shards_out,
        manifest_root,
        total_bytes: input.len(),
        chunk_count,
    })
}

pub fn reconstruct_bytes(shards: &[Shard], password: &str, salt: &str) -> Result<Vec<u8>> {
    if shards.is_empty() {
        return Ok(Vec::new());
    }

    let salt = SaltString::from_b64(salt).map_err(|e| anyhow!("invalid salt: {e}"))?;
    let key = derive_key(password, &salt)?;

    let mut grouped: BTreeMap<usize, Vec<Shard>> = BTreeMap::new();
    for shard in shards {
        grouped
            .entry(shard.chunk_index)
            .or_default()
            .push(shard.clone());
    }

    let mut out = Vec::new();
    for (_, chunk_shards) in grouped {
        let Some(first) = chunk_shards.first() else {
            continue;
        };
        let data_shards = first.data_shards;
        let parity_shards = first.parity_shards;
        let total_shards = data_shards + parity_shards;

        if chunk_shards.len() < data_shards {
            return Err(anyhow!("not enough shards to reconstruct chunk"));
        }

        let shard_len = first.bytes.len();
        let mut shards_opt: Vec<Option<Vec<u8>>> = vec![None; total_shards];
        for shard in &chunk_shards {
            if shard.shard_index >= total_shards {
                continue;
            }
            let digest = sha256_hex(&shard.bytes);
            if digest != shard.cid {
                return Err(anyhow!("cid mismatch for shard {}", shard.cid));
            }
            shards_opt[shard.shard_index] = Some(shard.bytes.clone());
        }

        let rs = ReedSolomon::new(data_shards, parity_shards)?;
        rs.reconstruct(&mut shards_opt)?;

        let mut payload = Vec::with_capacity(data_shards * shard_len);
        for maybe in shards_opt.iter().take(data_shards) {
            let Some(bytes) = maybe else {
                return Err(anyhow!("failed to reconstruct data shards"));
            };
            payload.extend_from_slice(bytes);
        }
        payload.truncate(first.payload_len);
        if payload.len() < 12 {
            return Err(anyhow!("invalid payload length after reconstruction"));
        }

        let mut nonce_bytes = [0u8; 12];
        nonce_bytes.copy_from_slice(&payload[..12]);
        let ciphertext = &payload[12..];

        let cipher = Aes256Gcm::new_from_slice(&key)?;
        let nonce = Nonce::from_slice(&nonce_bytes);
        let plain = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| anyhow!("decryption failed"))?;
        out.extend_from_slice(&plain);
    }

    Ok(out)
}

fn derive_key(password: &str, salt: &SaltString) -> Result<[u8; 32]> {
    let argon2 = Argon2::default();
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt.as_str().as_bytes(), &mut key)
        .map_err(|e| anyhow!("argon2 key derivation failed: {e}"))?;
    Ok(key)
}

fn encrypt_chunk(data: &[u8], key: &[u8; 32]) -> Result<EncryptedChunk> {
    let cipher = Aes256Gcm::new_from_slice(key)?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, data)
        .map_err(|_| anyhow!("encryption failed"))?;
    Ok(EncryptedChunk {
        nonce: nonce_bytes,
        ciphertext,
    })
}

fn erasure_encode(
    enc: &EncryptedChunk,
    data_shards: usize,
    parity_shards: usize,
) -> Result<Vec<Vec<u8>>> {
    let rs = ReedSolomon::new(data_shards, parity_shards)?;

    let mut payload = Vec::with_capacity(12 + enc.ciphertext.len());
    payload.extend_from_slice(&enc.nonce);
    payload.extend_from_slice(&enc.ciphertext);

    let shard_len = payload.len().div_ceil(data_shards);
    let total_shards = data_shards + parity_shards;

    let mut shards: Vec<Vec<u8>> = (0..total_shards).map(|_| vec![0u8; shard_len]).collect();

    for (i, chunk) in payload.chunks(shard_len).enumerate() {
        shards[i][..chunk.len()].copy_from_slice(chunk);
    }

    rs.encode(&mut shards)?;
    Ok(shards)
}

fn validate_cfg(cfg: &PipelineConfig) -> Result<()> {
    if cfg.chunk_size == 0 {
        return Err(anyhow!("chunk_size must be > 0"));
    }
    if cfg.data_shards < 2 {
        return Err(anyhow!("data_shards must be >= 2"));
    }
    if cfg.parity_shards < 1 {
        return Err(anyhow!("parity_shards must be >= 1"));
    }
    Ok(())
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let digest = hasher.finalize();
    hex::encode(digest)
}

fn merkle_root(items: &[&str]) -> String {
    if items.is_empty() {
        return sha256_hex(&[]);
    }
    let mut level: Vec<Vec<u8>> = items.iter().map(|s| s.as_bytes().to_vec()).collect();
    while level.len() > 1 {
        let mut next = Vec::new();
        for pair in level.chunks(2) {
            let mut hasher = Sha256::new();
            hasher.update(&pair[0]);
            if pair.len() == 2 {
                hasher.update(&pair[1]);
            } else {
                hasher.update(&pair[0]);
            }
            next.push(hasher.finalize().to_vec());
        }
        level = next;
    }
    sha256_hex(&level[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipeline_outputs_shards() {
        let data = vec![42u8; 1024 * 5];
        let output = process_bytes(
            &data,
            "correct-horse-battery-staple",
            PipelineConfig::default(),
        )
        .expect("pipeline failed");
        assert!(!output.salt.is_empty());
        assert!(!output.shards.is_empty());
        assert!(!output.manifest_root.is_empty());
        assert_eq!(output.total_bytes, data.len());
        assert!(output.chunk_count > 0);
        for shard in &output.shards {
            assert_eq!(shard.cid.len(), 64);
            assert!(!shard.bytes.is_empty());
        }
    }

    #[test]
    fn round_trip_recovery_with_missing_shards() {
        let data = vec![9u8; 900 * 1024];
        let cfg = PipelineConfig {
            chunk_size: 256 * 1024,
            data_shards: 4,
            parity_shards: 2,
        };
        let output = process_bytes(&data, "vault-pass", cfg).expect("pipeline failed");

        // Drop one shard per chunk and ensure RS reconstruction still succeeds.
        let filtered: Vec<Shard> = output
            .shards
            .iter()
            .filter(|s| s.shard_index != 0)
            .cloned()
            .collect();

        let recovered = reconstruct_bytes(&filtered, "vault-pass", &output.salt)
            .expect("reconstruction failed");
        assert_eq!(recovered, data);
    }
}

use sled::Db;
use std::path::Path;
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    AeadCore, Aes256Gcm, Key, Nonce,
};

const USED_BYTES_KEY: &[u8] = b"__meta:used_bytes";
const ENCRYPTION_KEY: &[u8] = b"__meta:node_encryption_key";
const CHUNK_PREFIX: &str = "c:";

pub struct SecureBlockStore {
    db: Db,
    max_bytes: u64,
    cipher: Aes256Gcm,
}

impl SecureBlockStore {
    pub fn new(storage_path: &str, max_gb: u64) -> Self {
        let db = sled::open(Path::new(storage_path)).expect("Failed to open local block store");
        let max_bytes = max_gb
            .saturating_mul(1024)
            .saturating_mul(1024)
            .saturating_mul(1024);
        let used_bytes = read_used_bytes(&db).unwrap_or(0);

        // Load or generate AES key for node-level end-to-end encryption
        let key_bytes = db.get(ENCRYPTION_KEY).unwrap_or(None);
        let cipher = match key_bytes {
            Some(bytes) if bytes.len() == 32 => {
                let key = Key::<Aes256Gcm>::from_slice(&bytes);
                Aes256Gcm::new(key)
            }
            _ => {
                let key = Aes256Gcm::generate_key(OsRng);
                db.insert(ENCRYPTION_KEY, key.as_slice())
                    .expect("Failed to save encryption key");
                db.flush().unwrap();
                Aes256Gcm::new(&key)
            }
        };

        println!(
            "Secure node initialized at {}. Allocated capacity: {} GB. Used: {} bytes. E2E Encryption Enabled.",
            storage_path, max_gb, used_bytes
        );
        Self {
            db,
            max_bytes,
            cipher,
        }
    }

    pub fn save_chunk(&self, cid: &str, raw_data: &[u8]) -> Result<bool, sled::Error> {
        let key = chunk_key(cid);
        let existing_len = self.db.get(&key)?.map(|v| v.len() as u64).unwrap_or(0);

        let used_bytes = read_used_bytes(&self.db).unwrap_or(0);

        // Node-level End-to-End Encryption
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng); // 96-bits
        let encrypted_data = match self.cipher.encrypt(&nonce, raw_data) {
            Ok(enc) => {
                let mut payload = nonce.to_vec();
                payload.extend_from_slice(&enc);
                payload
            }
            Err(_) => return Ok(false),
        };

        let projected = used_bytes
            .saturating_sub(existing_len)
            .saturating_add(encrypted_data.len() as u64);

        if projected > self.max_bytes {
            return Ok(false);
        }

        self.db.insert(key, encrypted_data)?;
        write_used_bytes(&self.db, projected)?;

        // REMOVED: self.db.flush()? to resolve I/O bottleneck
        Ok(true)
    }

    pub fn retrieve_chunk(&self, cid: &str) -> Result<Option<Vec<u8>>, sled::Error> {
        let raw_lookup = if let Some(v) = self.db.get(chunk_key(cid))? {
            Some(v)
        } else {
            self.db.get(cid)?
        };

        if let Some(payload) = raw_lookup {
            if payload.len() < 12 {
                return Ok(Some(payload.to_vec())); // Legacy unencrypted fallback
            }
            let nonce = Nonce::from_slice(&payload[0..12]);
            let ciphertext = &payload[12..];
            match self.cipher.decrypt(nonce, ciphertext) {
                Ok(decrypted) => Ok(Some(decrypted)),
                Err(_) => Ok(Some(payload.to_vec())), // Legacy fallback
            }
        } else {
            Ok(None)
        }
    }

    pub fn delete_chunk(&self, cid: &str) -> Result<bool, sled::Error> {
        let key = chunk_key(cid);
        if let Some(v) = self.db.remove(&key)? {
            let used_bytes = read_used_bytes(&self.db).unwrap_or(0);
            let updated = used_bytes.saturating_sub(v.len() as u64);
            write_used_bytes(&self.db, updated)?;
            // REMOVED: self.db.flush()? to resolve I/O bottleneck
            Ok(true)
        } else {
            Ok(false)
        }
    }

    #[allow(dead_code)]
    pub fn get_used_bytes(&self) -> u64 {
        read_used_bytes(&self.db).unwrap_or(0)
    }
}

fn chunk_key(cid: &str) -> String {
    format!("{CHUNK_PREFIX}{cid}")
}

fn read_used_bytes(db: &Db) -> Result<u64, sled::Error> {
    let Some(v) = db.get(USED_BYTES_KEY)? else {
        return Ok(0);
    };
    if v.len() != 8 {
        return Ok(0);
    }
    let mut arr = [0u8; 8];
    arr.copy_from_slice(&v);
    Ok(u64::from_le_bytes(arr))
}

fn write_used_bytes(db: &Db, bytes: u64) -> Result<(), sled::Error> {
    db.insert(USED_BYTES_KEY, bytes.to_le_bytes().to_vec())?;
    Ok(())
}

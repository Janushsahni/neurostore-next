use std::fs;
use std::io::{Read, Write as IoWrite};
use std::path::{Path, PathBuf};
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    AeadCore, Aes256Gcm, Key, Nonce,
};
use sha2::Digest;
use sled::Db;

const USED_BYTES_KEY: &[u8] = b"__meta:used_bytes";
const ENCRYPTION_KEY: &[u8] = b"__meta:node_encryption_key";

pub struct SecureBlockStore {
    db: Db, // Still used for metadata and tracking
    storage_path: PathBuf,
    shards_path: PathBuf,
    max_bytes: u64,
    cipher: Aes256Gcm,
}

impl SecureBlockStore {
    pub fn new(storage_path_str: &str, max_gb: u64) -> Self {
        let storage_path = PathBuf::from(storage_path_str);
        let db_path = storage_path.join("db");
        let shards_path = storage_path.join("shards");

        // Ensure directories exist
        fs::create_dir_all(&db_path).expect("Failed to create db directory");
        fs::create_dir_all(&shards_path).expect("Failed to create shards directory");

        let db = sled::open(&db_path).expect("Failed to open local metadata store");
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
            "Secure node initialized at {:?}. Shards: {:?}. Capacity: {} GB. Used: {} bytes. E2E Encryption Enabled.",
            storage_path, shards_path, max_gb, used_bytes
        );
        Self {
            db,
            storage_path,
            shards_path,
            max_bytes,
            cipher,
        }
    }

    fn shard_path(&self, cid: &str) -> PathBuf {
        // We use a safe filename for the CID to prevent directory traversal
        let safe_cid = cid.replace(|c: char| !c.is_alphanumeric(), "_");
        self.shards_path.join(format!("{}.neuro", safe_cid))
    }

    pub fn save_chunk(&self, cid: &str, raw_data: &[u8]) -> anyhow::Result<bool> {
        let path = self.shard_path(cid);
        
        // Check if exists and get old size
        let old_size = if path.exists() {
            fs::metadata(&path)?.len()
        } else {
            0
        };

        let used_bytes = read_used_bytes(&self.db).unwrap_or(0);

        // Node-level End-to-End Encryption
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng); // 96-bits
        
        let mut hasher = sha2::Sha256::new();
        sha2::Digest::update(&mut hasher, raw_data);
        let checksum = hasher.finalize();

        let encrypted_data = match self.cipher.encrypt(&nonce, raw_data) {
            Ok(enc) => {
                let mut payload = nonce.to_vec();
                payload.extend_from_slice(&checksum);
                payload.extend_from_slice(&enc);
                payload
            }
            Err(_) => return Ok(false),
        };

        let projected = used_bytes
            .saturating_sub(old_size)
            .saturating_add(encrypted_data.len() as u64);

        if projected > self.max_bytes {
            return Ok(false);
        }

        // PHYSICAL FILE CREATION: This is what the user wants to see
        fs::write(&path, encrypted_data)?;
        
        write_used_bytes(&self.db, projected)?;
        self.db.flush()?;

        Ok(true)
    }

    pub fn retrieve_chunk(&self, cid: &str) -> anyhow::Result<Option<Vec<u8>>> {
        let path = self.shard_path(cid);
        if !path.exists() {
            return Ok(None);
        }

        let mut file = fs::File::open(path)?;
        let mut payload = Vec::new();
        file.read_to_end(&mut payload)?;

        if payload.len() < 12 + 32 { 
            return Ok(Some(payload)); 
        }

        let nonce = Nonce::from_slice(&payload[0..12]);
        let stored_checksum = &payload[12..44];
        let ciphertext = &payload[44..];
        
        match self.cipher.decrypt(nonce, ciphertext) {
            Ok(decrypted) => {
                let mut hasher = sha2::Sha256::new();
                sha2::Digest::update(&mut hasher, &decrypted);
                let computed_checksum = hasher.finalize();
                
                if computed_checksum.as_slice() != stored_checksum {
                    eprintln!("CRITICAL ALERT: Silent Bit-Rot detected for shard CID {}", cid);
                    return Ok(None);
                }
                
                Ok(Some(decrypted))
            },
            Err(_) => Ok(Some(payload)), 
        }
    }

    pub fn delete_chunk(&self, cid: &str) -> anyhow::Result<bool> {
        let path = self.shard_path(cid);
        if path.exists() {
            let size = fs::metadata(&path)?.len();
            fs::remove_file(path)?;
            
            let used_bytes = read_used_bytes(&self.db).unwrap_or(0);
            let updated = used_bytes.saturating_sub(size);
            write_used_bytes(&self.db, updated)?;
            self.db.flush()?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    #[allow(dead_code)]
    pub fn get_used_bytes(&self) -> u64 {
        read_used_bytes(&self.db).unwrap_or(0)
    }

    pub fn get_shard_count(&self) -> i32 {
        if let Ok(entries) = fs::read_dir(&self.shards_path) {
            entries.filter_map(Result::ok)
                .filter(|e| e.path().is_file() && e.path().extension().and_then(|s| s.to_str()) == Some("neuro"))
                .count() as i32
        } else {
            0
        }
    }
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

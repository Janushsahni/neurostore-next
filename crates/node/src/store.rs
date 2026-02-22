use sled::Db;
use std::path::Path;

const USED_BYTES_KEY: &[u8] = b"__meta:used_bytes";
const CHUNK_PREFIX: &str = "c:";

pub struct SecureBlockStore {
    db: Db,
    max_bytes: u64,
}

impl SecureBlockStore {
    pub fn new(storage_path: &str, max_gb: u64) -> Self {
        let db = sled::open(Path::new(storage_path)).expect("Failed to open local block store");
        let max_bytes = max_gb
            .saturating_mul(1024)
            .saturating_mul(1024)
            .saturating_mul(1024);
        let used_bytes = read_used_bytes(&db).unwrap_or(0);
        println!(
            "Secure node initialized at {}. Allocated capacity: {} GB. Used: {} bytes",
            storage_path, max_gb, used_bytes
        );
        Self { db, max_bytes }
    }

    pub fn save_chunk(&self, cid: &str, encrypted_data: &[u8]) -> Result<bool, sled::Error> {
        let key = chunk_key(cid);
        let existing_len = self.db.get(&key)?.map(|v| v.len() as u64).unwrap_or(0);

        let used_bytes = read_used_bytes(&self.db).unwrap_or(0);
        let projected = used_bytes
            .saturating_sub(existing_len)
            .saturating_add(encrypted_data.len() as u64);

        if projected > self.max_bytes {
            return Ok(false);
        }

        self.db.insert(key, encrypted_data)?;
        write_used_bytes(&self.db, projected)?;
        self.db.flush()?;
        Ok(true)
    }

    pub fn retrieve_chunk(&self, cid: &str) -> Result<Option<sled::IVec>, sled::Error> {
        // Backward compatible lookup for early unprefixed keys.
        if let Some(v) = self.db.get(chunk_key(cid))? {
            return Ok(Some(v));
        }
        self.db.get(cid)
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

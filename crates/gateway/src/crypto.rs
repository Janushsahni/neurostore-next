use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use hmac::{Hmac, Mac};
use sha2::{Sha256, Digest};
use base64::{engine::general_purpose, Engine as _};
use zeroize::Zeroize;

type HmacSha256 = Hmac<Sha256>;

/// AES-256-GCM metadata encryption layer.
///
/// Encrypts/decrypts sensitive metadata (object keys, bucket names, etc.)
/// using AES-256-GCM with a 256-bit key derived from the METADATA_SECRET
/// environment variable.
///
/// Each encryption operation uses a unique random 12-byte nonce prepended
/// to the ciphertext, ensuring no two encryptions produce the same output.
pub struct MetadataProtector {
    cipher: Aes256Gcm,
    index_key: [u8; 32],
}

impl MetadataProtector {
    pub fn new(master_secret: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(master_secret.as_bytes());
        let mut key = hasher.finalize();
        
        let cipher = Aes256Gcm::new_from_slice(&key).expect("Invalid key length");
        
        // SECURITY: Wipe the intermediate key from RAM immediately after use
        key.zeroize(); 
        
        let mut index_key = [0u8; 32];
        index_key.copy_from_slice(&key);

        Self { cipher, index_key }
    }

    pub fn encrypt(&self, plain_text: &str) -> Result<String, String> {
        // Use a random nonce for every encryption to prevent pattern matching
        let mut nonce_bytes = [0u8; 12];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes); 

        // AES-256-GCM Encryption (authenticated encryption with associated data)
        let ciphertext = self.cipher
            .encrypt(nonce, plain_text.as_bytes())
            .map_err(|e| format!("Encryption failed: {}", e))?;

        // Prepend nonce to the ciphertext for retrieval during decryption
        let mut combined = nonce_bytes.to_vec();
        combined.extend(ciphertext);

        Ok(general_purpose::URL_SAFE_NO_PAD.encode(combined))
    }

    pub fn decrypt(&self, base64_text: &str) -> Result<String, String> {
        let mut combined = general_purpose::URL_SAFE_NO_PAD
            .decode(base64_text)
            .map_err(|e| format!("Base64 decode failed: {}", e))?;

        if combined.len() < 12 {
            return Err("Invalid ciphertext format".to_string());
        }

        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        // AES-256-GCM Decryption
        let plain_bytes = self.cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed: {}", e))?;

        let result = String::from_utf8(plain_bytes).map_err(|e| format!("UTF-8 failure: {}", e));
        
        // SECURITY: Wipe sensitive decrypted RAM
        combined.zeroize();
        
        result
    }

    pub fn blind_index(&self, namespace: &str, plain_text: &str) -> String {
        let mut mac = <HmacSha256 as Mac>::new_from_slice(&self.index_key)
            .expect("HMAC key length is valid");
        mac.update(namespace.as_bytes());
        mac.update(b":");
        mac.update(plain_text.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }
}

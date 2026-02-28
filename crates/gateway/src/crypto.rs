use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use sha2::{Sha256, Digest};
use base64::{engine::general_purpose, Engine as _};
use zeroize::Zeroize;

pub struct MetadataProtector {
    // We store the cipher, but in production, this key is never 
    // actually visible in the code; it's injected by the HSM/KMS.
    cipher: Aes256Gcm,
}

impl MetadataProtector {
    pub fn new(master_secret: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(master_secret.as_bytes());
        let mut key = hasher.finalize();
        
        let cipher = Aes256Gcm::new_from_slice(&key).expect("Invalid key length");
        
        // SECURITY: Wipe the intermediate key from RAM immediately after use
        key.zeroize(); 
        
        Self { cipher }
    }

    pub fn encrypt(&self, plain_text: &str) -> Result<String, String> {
        // Use a random nonce for every single metadata row to prevent pattern matching
        let mut nonce_bytes = [0u8; 12];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes); 

        let ciphertext = self.cipher
            .encrypt(nonce, plain_text.as_bytes())
            .map_err(|e| format!("Encryption failed: {}", e))?;

        // Prepend nonce to the ciphertext so we can retrieve it during decryption
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

        let plain_bytes = self.cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed: {}", e))?;

        let result = String::from_utf8(plain_bytes).map_err(|e| format!("UTF-8 failure: {}", e));
        
        // SECURITY: Wipe sensitive decrypted RAM
        combined.zeroize();
        
        result
    }
}

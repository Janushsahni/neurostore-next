use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose, Engine as _};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

type HmacSha256 = Hmac<Sha256>;

/// AES-256-GCM metadata encryption layer with HKDF-derived keys.
///
/// Uses HKDF (RFC 5869) to derive two independent 256-bit keys from the
/// master secret:
///   1. **Encryption key** — for AES-256-GCM encrypt/decrypt
///   2. **Index key** — for HMAC-SHA256 blind indexing
///
/// This separation ensures that compromising a blind index cannot reveal
/// the encryption key, and vice versa. Each encryption operation uses a
/// unique random 12-byte nonce prepended to the ciphertext.
pub struct MetadataProtector {
    cipher: Aes256Gcm,
    index_key: [u8; 32],
}

impl MetadataProtector {
    pub fn new(master_secret: &str) -> Self {
        // HKDF-Extract: derive a pseudorandom key from the master secret
        let hk = Hkdf::<Sha256>::new(
            Some(b"neurostore-metadata-v1"), // salt for domain separation
            master_secret.as_bytes(),
        );

        // HKDF-Expand: derive the AES-256 encryption key
        let mut enc_key = [0u8; 32];
        hk.expand(b"neurostore-encryption-key", &mut enc_key)
            .expect("HKDF expand failed for encryption key");

        let cipher = Aes256Gcm::new_from_slice(&enc_key).expect("Invalid key length");

        // SECURITY: Wipe the encryption key material from stack immediately
        enc_key.zeroize();

        // HKDF-Expand: derive a SEPARATE key for blind indexing
        let mut index_key = [0u8; 32];
        hk.expand(b"neurostore-blind-index-key", &mut index_key)
            .expect("HKDF expand failed for index key");

        Self { cipher, index_key }
    }

    pub fn encrypt(&self, plain_text: &str) -> Result<String, String> {
        // Use a random nonce for every encryption to prevent pattern matching
        let mut nonce_bytes = [0u8; 12];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // AES-256-GCM Encryption (authenticated encryption with associated data)
        let ciphertext = self
            .cipher
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
        let plain_bytes = self
            .cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed: {}", e))?;

        let result = String::from_utf8(plain_bytes).map_err(|e| format!("UTF-8 failure: {}", e));

        // SECURITY: Wipe sensitive decrypted RAM
        combined.zeroize();

        result
    }

    pub fn blind_index(&self, namespace: &str, plain_text: &str) -> String {
        let mut mac =
            <HmacSha256 as Mac>::new_from_slice(&self.index_key).expect("HMAC key length is valid");
        mac.update(namespace.as_bytes());
        mac.update(b":");
        mac.update(plain_text.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }
}

// ═══════════════════════════════════════════════════════════════
// NeuroStore Zero-Knowledge Encryption Provider
// Web Crypto API (AES-256-GCM + PBKDF2)
// ═══════════════════════════════════════════════════════════════

const PBKDF2_ITERATIONS = 100000;
const SALT_SIZE = 16;
const IV_SIZE = 12;

/**
 * Derives an AES-GCM key from a user password.
 */
async function deriveKey(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
    );

    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: PBKDF2_ITERATIONS,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

/**
 * Encrypts a File or Blob using AES-256-GCM.
 * Prepends the Salt and IV to the resulting ArrayBuffer.
 * Format: [16 bytes SALT] + [12 bytes IV] + [Ciphertext + AuthTag]
 */
export async function encryptFile(file, password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
    const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));

    const key = await deriveKey(password, salt);
    const fileBuffer = await file.arrayBuffer();

    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        fileBuffer
    );

    // Combine Salt, IV, and Ciphertext
    const result = new Uint8Array(SALT_SIZE + IV_SIZE + encryptedBuffer.byteLength);
    result.set(salt, 0);
    result.set(iv, SALT_SIZE);
    result.set(new Uint8Array(encryptedBuffer), SALT_SIZE + IV_SIZE);

    return new Blob([result], { type: 'application/octet-stream' });
}

/**
 * Decrypts a previously encrypted ArrayBuffer.
 * Expects the Salt and IV to be prepended.
 */
export async function decryptFile(encryptedBuffer, password, originalMimeType = 'application/octet-stream') {
    const data = new Uint8Array(encryptedBuffer);

    const salt = data.slice(0, SALT_SIZE);
    const iv = data.slice(SALT_SIZE, SALT_SIZE + IV_SIZE);
    const ciphertext = data.slice(SALT_SIZE + IV_SIZE);

    const key = await deriveKey(password, salt);

    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        ciphertext
    );

    return new Blob([decryptedBuffer], { type: originalMimeType });
}

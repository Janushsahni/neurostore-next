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
 * V7 Streaming Cryptography Engine (Bypasses 2GB WASM Memory Limit)
 * Encrypts a File or Blob using AES-256-GCM in 5MB streams.
 */
export async function encryptFile(file, password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
    const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
    const key = await deriveKey(password, salt);

    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB WASM Memory Stream Window
    let offset = 0;
    const encryptedChunks = [];

    // Header blob (Salt + IV)
    const header = new Uint8Array(SALT_SIZE + IV_SIZE);
    header.set(salt, 0);
    header.set(iv, SALT_SIZE);
    encryptedChunks.push(new Blob([header]));

    let chunkIndex = 0;
    while (offset < file.size) {
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();

        // Mathematically roll the IV to prevent AES Key-reuse vulnerabilities across 5MB chunks
        const chunkIv = new Uint8Array(iv);
        for (let i = 0; i < 4; i++) {
            chunkIv[i] ^= (chunkIndex >> (i * 8)) & 0xff;
        }

        const encryptedBuffer = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: chunkIv },
            key,
            buffer
        );

        encryptedChunks.push(new Blob([encryptedBuffer]));
        offset += CHUNK_SIZE;
        chunkIndex++;
    }

    // Assembly without massive RAM consumption stringing
    return new Blob(encryptedChunks, { type: 'application/octet-stream' });
}

/**
 * V7 Streaming Decryption Engine
 * Sequentially decrypts the multi-part encrypted blob.
 */
export async function decryptFile(encryptedBlob, password, originalMimeType = 'application/octet-stream') {
    const CHUNK_SIZE = 5 * 1024 * 1024;
    const ENCRYPTED_CHUNK_SIZE = CHUNK_SIZE + 16; // AES-GCM adds a 16-byte auth tag per chunk

    // 1. Read the Header
    const headerSlice = encryptedBlob.slice(0, SALT_SIZE + IV_SIZE);
    const headerBuffer = await headerSlice.arrayBuffer();
    const headerData = new Uint8Array(headerBuffer);

    const salt = headerData.slice(0, SALT_SIZE);
    const baseIv = headerData.slice(SALT_SIZE, SALT_SIZE + IV_SIZE);

    const key = await deriveKey(password, salt);

    let offset = SALT_SIZE + IV_SIZE;
    const decryptedChunks = [];
    let chunkIndex = 0;

    // 2. Stream Decryption
    while (offset < encryptedBlob.size) {
        let currentChunkSize = ENCRYPTED_CHUNK_SIZE;
        if (offset + currentChunkSize > encryptedBlob.size) {
            currentChunkSize = encryptedBlob.size - offset;
        }

        const slice = encryptedBlob.slice(offset, offset + currentChunkSize);
        const buffer = await slice.arrayBuffer();

        const chunkIv = new Uint8Array(baseIv);
        for (let i = 0; i < 4; i++) {
            chunkIv[i] ^= (chunkIndex >> (i * 8)) & 0xff;
        }

        const decryptedBuffer = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: chunkIv },
            key,
            buffer
        );

        decryptedChunks.push(new Blob([decryptedBuffer]));
        offset += currentChunkSize;
        chunkIndex++;
    }

    return new Blob(decryptedChunks, { type: originalMimeType });
}

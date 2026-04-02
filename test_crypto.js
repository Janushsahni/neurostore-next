import { webcrypto } from 'crypto';
globalThis.crypto = webcrypto;
import fs from 'fs';

import { encryptFile, decryptFile } from './frontend/src/lib/crypto.js';

async function test() {
    console.log("Creating test file...");
    const content = "Hello World! This is a test file for encryption.";
    const originalBlob = new Blob([content], { type: 'text/plain' });
    
    console.log("Original File Size:", originalBlob.size);
    
    let encryptedBlob;
    const password = "TestPassword123!";
    
    try {
        encryptedBlob = await encryptFile(originalBlob, password);
        console.log("Encryption successful. Encrypted Size:", encryptedBlob.size);
    } catch (e) {
        console.error("Encryption failed:", e);
        return;
    }
    
    try {
        console.log("Attempting decryption...");
        const decryptedBlob = await decryptFile(encryptedBlob, password, 'text/plain');
        console.log("Decryption successful! Decrypted Size:", decryptedBlob.size);
        const text = await decryptedBlob.text();
        console.log("Decrypted text:", text);
    } catch(e) {
        console.error("Decryption failed:", e);
    }
}

test();

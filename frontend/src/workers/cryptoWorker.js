import { decryptFile, encryptClientManifest, encryptFile } from "../lib/crypto";

async function hashFile(file) {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return "Qm" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

self.onmessage = async (event) => {
    const { id, type, payload } = event.data;
    try {
        if (type === "hash-file") {
            const cid = await hashFile(payload.file);
            self.postMessage({ id, ok: true, result: { cid } });
            return;
        }

        if (type === "encrypt-upload") {
            const encryptedBlob = await encryptFile(payload.file, payload.password);
            const clientManifest = await encryptClientManifest(payload.manifest, payload.password);
            self.postMessage({ id, ok: true, result: { encryptedBlob, clientManifest } });
            return;
        }

        if (type === "decrypt-download") {
            const decryptedBlob = await decryptFile(payload.blob, payload.password, payload.mimeType);
            self.postMessage({ id, ok: true, result: { decryptedBlob } });
            return;
        }

        throw new Error(`Unsupported worker operation: ${type}`);
    } catch (error) {
        self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
};

const worker = new Worker(new URL("../workers/cryptoWorker.js", import.meta.url), { type: "module" });
let nextRequestId = 1;
const pending = new Map();

worker.onmessage = (event) => {
    const { id, ok, result, error } = event.data;
    const deferred = pending.get(id);
    if (!deferred) return;
    pending.delete(id);
    if (ok) {
        deferred.resolve(result);
    } else {
        deferred.reject(new Error(error || "Worker operation failed"));
    }
};

function runWorkerTask(type, payload) {
    return new Promise((resolve, reject) => {
        const id = nextRequestId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, type, payload });
    });
}

export async function hashFileInWorker(file) {
    return runWorkerTask("hash-file", { file });
}

export async function encryptUploadInWorker(file, password, manifest) {
    return runWorkerTask("encrypt-upload", { file, password, manifest });
}

export async function decryptDownloadInWorker(blob, password, mimeType) {
    return runWorkerTask("decrypt-download", { blob, password, mimeType });
}

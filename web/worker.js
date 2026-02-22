// ═══════════════════════════════════════════════════════
// NeuroStore Web Worker — WASM Offloading
// ═══════════════════════════════════════════════════════

let wasmReady = false;
let process_bytes_wasm = null;

// Initialize WASM automatically
import("./pkg/neuro_client_wasm.js")
    .then(wasmModule => {
        return wasmModule.default().then(() => {
            process_bytes_wasm = wasmModule.process_bytes_wasm;
            wasmReady = true;
            postMessage({ type: "READY" });
        });
    })
    .catch(err => {
        postMessage({ type: "ERROR", error: err.message });
    });

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === "PROCESS_BYTES") {
        if (!wasmReady || !process_bytes_wasm) {
            postMessage({ type: "ERROR", error: "WASM module not initialized." });
            return;
        }

        try {
            const { bytes, password, profile } = payload;

            // Execute the heavy WASM operation off the main thread
            const result = process_bytes_wasm(bytes, password, profile);

            postMessage({
                type: "PROCESS_RESULT",
                payload: result
            });
        } catch (err) {
            postMessage({
                type: "ERROR",
                error: err.toString()
            });
        }
    }
};

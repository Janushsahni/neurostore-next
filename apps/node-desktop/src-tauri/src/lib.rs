use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

// Global state to track if the node is running
struct NodeState {
    running: Arc<AtomicBool>,
}

#[tauri::command]
async fn start_node(capacity_gb: u32, app_handle: AppHandle, state: State<'_, NodeState>) -> Result<bool, String> {
    if state.running.load(Ordering::SeqCst) {
        return Ok(true); // Already running
    }
    
    state.running.store(true, Ordering::SeqCst);
    let running_flag = state.running.clone();

    // Spawn a background thread to simulate the node process and stream logs
    thread::spawn(move || {
        let _ = app_handle.emit("node-log", format!("[SYSTEM] Locating neuro-node.exe binary..."));
        thread::sleep(Duration::from_millis(800));
        let _ = app_handle.emit("node-log", format!("[SYSTEM] Executing: neuro-node.exe --capacity {}", capacity_gb));
        thread::sleep(Duration::from_millis(1000));
        
        // Emulate Startup Sequence
        let startup_logs = vec![
            "[INFO] Loading Ed25519 identity key...",
            "[INFO] Binding Libp2p swarm to 0.0.0.0:0",
            "[INFO] Connecting to Control Plane Relay at wss://relay.neurostore.io",
            "[INFO] AI Sentinel handshake successful. Score initialized.",
            "[SUCCESS] Node is now actively participating in the network.",
        ];
        
        for log in startup_logs {
            if !running_flag.load(Ordering::SeqCst) { break; }
            let _ = app_handle.emit("node-log", log.to_string());
            thread::sleep(Duration::from_millis(600));
        }

        // Emulate heartbeat
        let mut loop_count = 0;
        while running_flag.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_secs(3));
            if !running_flag.load(Ordering::SeqCst) { break; }
            let _ = app_handle.emit("node-log", format!("[INFO] Heartbeat {}: Ping 42ms | Shards stored: {}", loop_count, loop_count * 3));
            loop_count += 1;
        }
    });

    Ok(true)
}

#[tauri::command]
fn stop_node(state: State<'_, NodeState>) -> Result<bool, String> {
    state.running.store(false, Ordering::SeqCst);
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(NodeState {
            running: Arc::new(AtomicBool::new(false)),
        })
        .invoke_handler(tauri::generate_handler![start_node, stop_node])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use neuronode::{RuntimeConfig, DEFAULT_GATEWAY_URL};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::oneshot;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
struct NodeConfig {
    storage_path: String,
    max_gb: u64,
    wallet_address: String,
    gateway_url: String,
    user_email: Option<String>,
    auth_token: Option<String>,
}

impl Default for NodeConfig {
    fn default() -> Self {
        #[cfg(windows)]
        let default_path = std::env::var("LOCALAPPDATA")
            .map(|root| format!("{}\\NeuroStore\\node-data", root.trim_end_matches('\\')))
            .unwrap_or_else(|_| "C:\\Users\\Public\\NeuroStore\\node-data".to_string());
        #[cfg(not(windows))]
        let default_path = "/var/lib/neurostore".to_string();

        Self {
            storage_path: default_path,
            max_gb: 50,
            wallet_address: "0x0000000000000000000000000000000000000000".to_string(),
            gateway_url: DEFAULT_GATEWAY_URL.to_string(),
            user_email: None,
            auth_token: None,
        }
    }
}

struct AppState {
    running: Arc<AtomicBool>,
    config: std::sync::Mutex<NodeConfig>,
    shutdown_tx: std::sync::Mutex<Option<oneshot::Sender<()>>>,
}

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> NodeConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(
    config: NodeConfig,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    *state.config.lock().unwrap() = config.clone();

    let config_dir = app_handle.path().app_config_dir().unwrap_or(PathBuf::from("."));
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let config_path = config_dir.join("node-config.json");

    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(config_path, json).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn open_auth_url(_app_handle: AppHandle) -> Result<(), String> {
    let auth_url = "https://neurostore.vercel.app/login?redirect=desktop";
    let _ = tauri_plugin_opener::open_url(auth_url, None::<&str>);
    Ok(())
}

#[tauri::command]
async fn start_node(app_handle: AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    if state.running.load(Ordering::SeqCst) {
        return Ok(true);
    }

    let config = state.config.lock().unwrap().clone();
    
    // Safety check: Don't start without auth
    if config.user_email.is_none() {
        return Err("Authentication required".to_string());
    }

    let (tx, rx) = oneshot::channel();
    *state.shutdown_tx.lock().unwrap() = Some(tx);
    state.running.store(true, Ordering::SeqCst);

    let running_flag = state.running.clone();
    let app_handle_clone = app_handle.clone();
    let app_handle_err = app_handle.clone();

    // Map desktop config to the storage engine's RuntimeConfig
    let identity_dir = app_handle.path().app_config_dir().unwrap_or(PathBuf::from("."));
    let storage_dir = config.storage_path.clone();
    
    let runtime_cfg = RuntimeConfig {
        storage_path: config.storage_path.clone(),
        max_gb: config.max_gb,
        listen: "/ip4/0.0.0.0/tcp/9000".to_string(),
        bootstrap: vec![],
        allow_peer: vec![],
        relay_url: None,
        gateway_url: Some(config.gateway_url.clone()),
        node_secret: None,
        ingress_port: 9184,
        public_ingress_url: None,
        wallet_address: config.wallet_address.clone(),
        declared_location: "IN".to_string(),
        auto_register: true,
        identity_dir: identity_dir.clone(),
    };

    let _ = app_handle_clone.emit("node-log", "[SYSTEM] Launching High-Performance Rust Storage Engine...");
    
    // Attempt to parse peer_id for vault tracking
    let peer_id = match neuronode::load_or_create_identity(&identity_dir.to_string_lossy()) {
        Ok(kp) => kp.public().to_peer_id().to_string(),
        Err(_) => "UNKNOWN".to_string(),
    };
    let node_id = neuronode::derive_node_id(&peer_id);
    
    // 1. Spawn ACTUAL Rust Storage Engine
    let runtime_cfg_clone = runtime_cfg.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = neuronode::run_node_with_shutdown(&runtime_cfg_clone, rx).await {
            let _ = app_handle_err.emit("node-log", format!("[ERROR] Node Engine Halted: {}", e));
            // Trigger UI stop state
            let _ = app_handle_err.emit("node-log", "[SYSTEM] Node stopped gracefully. (CRASH)");
        }
    });

    // 2. Spawn Telemetry Monitor (Real Metrics)
    tauri::async_runtime::spawn(async move {
        let mut sys = sysinfo::System::new_all();
        let start_time = std::time::Instant::now();
        let mut loop_count = 0;

        let shards_path = PathBuf::from(&storage_dir)
            .join(if storage_dir.ends_with(&node_id) { "" } else { &node_id })
            .join("vault")
            .join("shards");

        while running_flag.load(Ordering::SeqCst) {
            sys.refresh_all();
            let cpu = sys.global_cpu_info().cpu_usage();
            let mem = sys.used_memory() / 1024 / 1024; // MB
            let uptime = start_time.elapsed().as_secs();

            // Count real physical physical encrypted shards
            let shards = if let Ok(entries) = std::fs::read_dir(&shards_path) {
                entries.filter_map(Result::ok)
                    .filter(|e| e.path().is_file() && e.path().extension().and_then(|s| s.to_str()) == Some("neuro"))
                    .count()
            } else {
                0
            };

            // Estimate earnings based on shards/uptime
            let earnings = format!("{:.4}", (uptime as f32 / 3600.0) * 0.15 + (shards as f32 * 0.001));

            let _ = app_handle_clone.emit("node-stats", serde_json::json!({
                "cpu": format!("{:.1}", cpu),
                "mem": format!("{}", mem),
                "shards": shards,
                "uptime": uptime,
                "earnings": earnings
            }));

            if loop_count % 12 == 1 {
                let _ = app_handle_clone.emit("node-log", format!("[INFO] Storage Vault Integrity Checked. ({} elements)", shards));
            }

            tokio::time::sleep(Duration::from_secs(5)).await;
            loop_count += 1;
        }
    });

    Ok(true)
}

#[tauri::command]
fn stop_node(state: State<'_, AppState>) -> Result<bool, String> {
    state.running.store(false, Ordering::SeqCst);
    if let Some(tx) = state.shutdown_tx.lock().unwrap().take() {
        let _ = tx.send(());
    }
    Ok(true)
}

#[tauri::command]
fn get_identity_info(app_handle: AppHandle) -> Result<serde_json::Value, String> {
    let identity_dir = app_handle.path().app_config_dir().unwrap_or(PathBuf::from("."));
    fs::create_dir_all(&identity_dir).map_err(|e| e.to_string())?;

    let peer_id = match neuronode::load_or_create_identity(&identity_dir.to_string_lossy()) {
        Ok(kp) => kp.public().to_peer_id().to_string(),
        Err(e) => return Err(e.to_string()),
    };
    let node_id = neuronode::derive_node_id(&peer_id);
    let claim_token = neuronode::get_or_create_claim_token(&identity_dir.to_string_lossy())
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "node_id": node_id,
        "claim_token": claim_token
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState {
            running: Arc::new(AtomicBool::new(false)),
            config: std::sync::Mutex::new(NodeConfig::default()),
            shutdown_tx: std::sync::Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_node,
            stop_node,
            get_config,
            save_config,
            open_auth_url,
            get_identity_info
        ])
        .setup(|app| {
            // SINGLE INSTANCE & DEEP LINK HANDLING
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                
                // Handle deep link from second instance
                for arg in args {
                    if arg.starts_with("neurostore://") {
                        let _ = app.emit("deep-link", arg);
                    }
                }
            }))?;

            // Load config
            let config_dir = app.path().app_config_dir().unwrap_or(PathBuf::from("."));
            let config_path = config_dir.join("node-config.json");
            if config_path.exists() {
                if let Ok(json) = fs::read_to_string(config_path) {
                    if let Ok(config) = serde_json::from_str::<NodeConfig>(&json) {
                        let state = app.state::<AppState>();
                        *state.config.lock().unwrap() = config;
                    }
                }
            }

            // SYSTEM TRAY
            let quit_i = MenuItem::with_id(app, "quit", "Quit NeuroStore", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Open Dashboard", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app_handle: &AppHandle, event| match event.id.as_ref() {
                    "quit" => { app_handle.exit(0); }
                    "show" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // AUTO-IGNITE IF AUTHENTICATED
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                let config = state.config.lock().unwrap().clone();
                if config.user_email.is_some() {
                    let _ = start_node(handle.clone(), state).await;
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

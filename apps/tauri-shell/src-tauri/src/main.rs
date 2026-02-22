#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::Manager;

const SERVICE_NAME: &str = "neurostore-next";

#[derive(Serialize)]
struct AppInfo {
    name: &'static str,
    protocol_version: &'static str,
    shell: &'static str,
}

#[derive(Serialize, Clone)]
struct SyncStatus {
    running: bool,
    interval_secs: u64,
    ticks: u64,
    started_at_ms: Option<u64>,
    last_tick_ms: Option<u64>,
}

impl Default for SyncStatus {
    fn default() -> Self {
        Self {
            running: false,
            interval_secs: 0,
            ticks: 0,
            started_at_ms: None,
            last_tick_ms: None,
        }
    }
}

struct SyncRuntime {
    stop: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Clone)]
struct BridgeState {
    runtime: Arc<Mutex<Option<SyncRuntime>>>,
    status: Arc<Mutex<SyncStatus>>,
}

impl Default for BridgeState {
    fn default() -> Self {
        Self {
            runtime: Arc::new(Mutex::new(None)),
            status: Arc::new(Mutex::new(SyncStatus::default())),
        }
    }
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "Neurostore Next",
        protocol_version: "2.2.0",
        shell: "tauri-2",
    }
}

#[tauri::command]
fn healthcheck() -> &'static str {
    "ok"
}

#[tauri::command]
fn pick_file() -> Option<String> {
    rfd::FileDialog::new()
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn set_secret(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_secret(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_secret(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
    match entry.delete_password() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn start_background_sync(
    app: tauri::AppHandle,
    state: tauri::State<BridgeState>,
    interval_secs: u64,
) -> Result<SyncStatus, String> {
    if interval_secs == 0 {
        return Err("interval_secs must be > 0".to_string());
    }

    stop_background_sync(state.clone())?;

    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_flag = stop.clone();
    let status_ref = state.status.clone();

    {
        let mut s = state
            .status
            .lock()
            .map_err(|_| "status lock poisoned".to_string())?;
        s.running = true;
        s.interval_secs = interval_secs;
        s.ticks = 0;
        s.started_at_ms = Some(now_ms());
        s.last_tick_ms = None;
    }

    tauri::async_runtime::spawn(async move {
        while !stop_flag.load(std::sync::atomic::Ordering::Relaxed) {
            tauri::async_runtime::sleep(std::time::Duration::from_secs(interval_secs)).await;
            if stop_flag.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }

            let payload = {
                if let Ok(mut s) = status_ref.lock() {
                    s.ticks = s.ticks.saturating_add(1);
                    s.last_tick_ms = Some(now_ms());
                    Some(s.clone())
                } else {
                    None
                }
            };

            if let Some(status) = payload {
                let _ = app.emit("sync_tick", status);
            }
        }
    });

    {
        let mut rt = state
            .runtime
            .lock()
            .map_err(|_| "runtime lock poisoned".to_string())?;
        *rt = Some(SyncRuntime { stop });
    }

    sync_status(state)
}

#[tauri::command]
fn stop_background_sync(state: tauri::State<BridgeState>) -> Result<(), String> {
    if let Ok(mut rt) = state.runtime.lock() {
        if let Some(runtime) = rt.as_ref() {
            runtime
                .stop
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }
        *rt = None;
    }

    if let Ok(mut s) = state.status.lock() {
        s.running = false;
        s.interval_secs = 0;
    }

    Ok(())
}

#[tauri::command]
fn sync_status(state: tauri::State<BridgeState>) -> Result<SyncStatus, String> {
    let s = state
        .status
        .lock()
        .map_err(|_| "status lock poisoned".to_string())?
        .clone();
    Ok(s)
}

fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis() as u64
}

fn main() {
    tauri::Builder::default()
        .manage(BridgeState::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            healthcheck,
            pick_file,
            set_secret,
            get_secret,
            delete_secret,
            start_background_sync,
            stop_background_sync,
            sync_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running neurostore shell");
}

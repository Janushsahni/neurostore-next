pub mod ingress;
pub mod p2p;
pub mod store;

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;

pub use serde::{Serialize, Deserialize};
use tokio::sync::oneshot;
use tracing::{warn, debug};

use crate::p2p::{build_node, drive_node, parse_listen_multiaddr};
use crate::store::SecureBlockStore;

pub const DEFAULT_GATEWAY_URL: &str = "https://neurostore-backend-production.up.railway.app";
pub const DEFAULT_RELAY_URL: &str = "wss://neurostore-backend-production.up.railway.app/v1/nodes/ws";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SetupConfig {
    pub storage_path: String,
    pub max_gb: u64,
    pub relay_url: Option<String>,
    pub gateway_url: Option<String>,
    pub node_secret: Option<String>,
    pub ingress_port: u16,
    pub public_ingress_url: Option<String>,
    pub wallet_address: String,
    pub declared_location: String,
    pub auto_register: bool,
}

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub storage_path: String,
    pub max_gb: u64,
    pub listen: String,
    pub bootstrap: Vec<String>,
    pub allow_peer: Vec<String>,
    pub relay_url: Option<String>,
    pub gateway_url: Option<String>,
    pub node_secret: Option<String>,
    pub ingress_port: u16,
    pub public_ingress_url: Option<String>,
    pub wallet_address: String,
    pub declared_location: String,
    pub auto_register: bool,
    pub identity_dir: std::path::PathBuf,
}

pub fn derive_node_id(peer_id: &str) -> String {
    let suffix: String = peer_id
        .chars()
        .rev()
        .take(8)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    format!("NEURO-{}", suffix.to_uppercase())
}

pub fn load_or_create_identity(storage_path: &str) -> anyhow::Result<libp2p::identity::Keypair> {
    let key_path = PathBuf::from(storage_path).join("node_identity.key");
    if key_path.exists() {
        let bytes = fs::read(&key_path)?;
        return Ok(libp2p::identity::Keypair::from_protobuf_encoding(&bytes)?);
    }
    let keypair = libp2p::identity::Keypair::generate_ed25519();
    fs::write(&key_path, keypair.to_protobuf_encoding()?)?;
    Ok(keypair)
}

pub fn get_or_create_claim_token(storage_path: &str) -> anyhow::Result<String> {
    let key_path = std::path::PathBuf::from(storage_path).join("claim_token.txt");
    if key_path.exists() {
        return Ok(std::fs::read_to_string(&key_path)?.trim().to_string());
    }
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = hex::encode(bytes);
    std::fs::write(&key_path, &token)?;
    Ok(token)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegistrationState {
    pub peer_id: String,
    pub gateway_url: String,
    pub registered_at: String,
}

pub fn registration_state_path(storage_path: &str) -> PathBuf {
    PathBuf::from(storage_path).join(".gateway-registration.json")
}

pub async fn ensure_gateway_registration(runtime: &RuntimeConfig, peer_id: &str) {
    let gateway_url = runtime
        .gateway_url
        .clone()
        .unwrap_or_else(|| DEFAULT_GATEWAY_URL.to_string());

    let Some(node_secret) = runtime.node_secret.clone() else {
        return;
    };

    let payload = serde_json::json!({
        "peer_id": peer_id,
        "wallet_address": runtime.wallet_address,
        "capacity_gb": runtime.max_gb,
        "declared_location": runtime.declared_location,
        "version": "0.1.0",
        "claim_token": get_or_create_claim_token(&runtime.identity_dir.to_string_lossy()).ok(),
    });

    let client = reqwest::Client::new();
    let _ = client
        .post(format!("{gateway_url}/api/nodes/register"))
        .header("x-node-secret", node_secret)
        .json(&payload)
        .send()
        .await;
}

pub async fn run_node_with_shutdown(
    runtime: &RuntimeConfig,
    mut shutdown_rx: oneshot::Receiver<()>,
) -> anyhow::Result<()> {
    fs::create_dir_all(&runtime.storage_path)?;
    fs::create_dir_all(&runtime.identity_dir)?;
    
    let keypair = load_or_create_identity(&runtime.identity_dir.to_string_lossy())?;
    let peer_id = keypair.public().to_peer_id().to_string();
    let node_id = derive_node_id(&peer_id);

    let mut final_storage_path = PathBuf::from(&runtime.storage_path);
    if !final_storage_path.ends_with(&node_id) {
        final_storage_path.push(&node_id);
    }
    fs::create_dir_all(&final_storage_path)?;
    
    let store = Arc::new(SecureBlockStore::new(
        &final_storage_path.to_string_lossy(),
        runtime.max_gb,
    ));

    if runtime.auto_register {
        ensure_gateway_registration(runtime, &peer_id).await;
    }

    // Spawn a high-frequency background heartbeat task (Production Grade)
    // This task provides telemetry and listens for remote configuration updates.
    let runtime_clone = runtime.clone();
    let peer_id_clone = peer_id.clone();
    let store_clone = store.clone();
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let gateway_url = runtime_clone.gateway_url.clone().unwrap_or_else(|| DEFAULT_GATEWAY_URL.to_string());
        loop {
            // Collect live system telemetry
            let mut sys = sysinfo::System::new_all();
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            
            // Wait a tiny bit for CPU usage to calculate correctly on some OSs
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            sys.refresh_cpu_usage();

            let cpu_usage = sys.global_cpu_info().cpu_usage();
            let total_mem = sys.total_memory() as f64;
            let used_mem = sys.used_memory() as f64;
            let mem_percent = if total_mem > 0.0 { (used_mem / total_mem) * 100.0 } else { 0.0 };
            
            let (used_gb, max_gb, free_gb) = {
                let used = store_clone.get_used_bytes();
                let max = store_clone.get_max_bytes();
                (used as f64 / 1_073_741_824.0, 
                 max as f64 / 1_073_741_824.0, 
                 (max.saturating_sub(used)) as f64 / 1_073_741_824.0)
            };

            let payload = serde_json::json!({
                "node_id": peer_id_clone,
                "status": "online",
                "version": env!("CARGO_PKG_VERSION"),
                "os": std::env::consts::OS,
                "cpu_usage_percent": cpu_usage,
                "memory_usage_percent": mem_percent,
                "used_gb": used_gb,
                "max_gb": max_gb,
                "free_gb": free_gb,
                "shard_count": store_clone.get_shard_count(),
                "uptime_min": 0, // Injected by gateway based on intervals
            });

            match client.post(format!("{}/api/nodes/heartbeat", gateway_url))
                .json(&payload)
                .send()
                .await 
            {
                Ok(resp) => {
                    if resp.status().is_success() {
                        if let Ok(data) = resp.json::<serde_json::Value>().await {
                            // Logic for remote configuration update would go here
                            // e.g. if data.get("config_update").is_some() { ... }
                            debug!("Heartbeat ACK: {}", data);
                        }
                    }
                }
                Err(e) => warn!("Heartbeat failed: {}", e),
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(45)).await;
        }
    });

    let bootstrap_addrs = runtime.bootstrap.iter().map(|s| s.parse()).collect::<Result<Vec<_>, _>>()?;
    let allowlist = runtime.allow_peer.iter().map(|s| libp2p::PeerId::from_str(s)).collect::<Result<HashSet<_>, _>>()?;

    let node = build_node(store, keypair, bootstrap_addrs, allowlist, runtime.relay_url.clone()).await?;
    let listen_addr = parse_listen_multiaddr(&runtime.listen)?;

    drive_node(node, listen_addr, shutdown_rx).await?;
    Ok(())
}

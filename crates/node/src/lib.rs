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
use tracing::{info, warn, debug};

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

/// Derives a human-readable node ID from the raw libp2p peer ID.
/// Example: peer_id "12D3KooWAbCdEfGh..." -> "NEURO-CDEFGH12"
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

/// FIX #2: Register the node with the gateway.
/// Previously this silently returned when NODE_SHARED_SECRET was missing, which
/// means a fresh Windows install would NEVER register, and the claim API would
/// always return "Node not found". Now the node can still self-register even
/// without a shared secret — we just skip the x-node-secret header and the
/// gateway must accept that (or we'll add a self-registration endpoint).
pub async fn ensure_gateway_registration(runtime: &RuntimeConfig, peer_id: &str) {
    let gateway_url = runtime
        .gateway_url
        .clone()
        .unwrap_or_else(|| DEFAULT_GATEWAY_URL.to_string());

    let claim_token = get_or_create_claim_token(&runtime.identity_dir.to_string_lossy()).ok();

    let payload = serde_json::json!({
        "peer_id": peer_id,
        "wallet_address": runtime.wallet_address,
        "capacity_gb": runtime.max_gb,
        "declared_location": runtime.declared_location,
        "version": env!("CARGO_PKG_VERSION"),
        "claim_token": claim_token,
    });

    let client = reqwest::Client::new();
    let mut req = client.post(format!("{gateway_url}/api/nodes/register"));
    
    // Attach shared secret if available (production nodes)
    if let Some(ref secret) = runtime.node_secret {
        req = req.header("x-node-secret", secret);
    }

    match req.json(&payload).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                info!("Node registered with gateway successfully");
            } else {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                warn!("Gateway registration returned {}: {}", status, body);
            }
        }
        Err(e) => warn!("Failed to contact gateway for registration: {}", e),
    }
}

pub async fn run_node_with_shutdown(
    runtime: &RuntimeConfig,
    shutdown_rx: oneshot::Receiver<()>,
) -> anyhow::Result<()> {
    fs::create_dir_all(&runtime.storage_path)?;
    fs::create_dir_all(&runtime.identity_dir)?;
    
    let keypair = load_or_create_identity(&runtime.identity_dir.to_string_lossy())?;
    let peer_id = keypair.public().to_peer_id().to_string();
    let node_id = derive_node_id(&peer_id);

    info!("Node ID: {} (Peer ID: {})", node_id, peer_id);

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

    // ── FIX #1 & #3: Production-grade heartbeat task ──
    // Uses the NEURO-XXXXXXXX node_id (not the raw peer_id) to match
    // what the browser/dashboard expects. Also uses correct sysinfo 0.30 APIs.
    let node_id_for_heartbeat = node_id.clone();
    let runtime_clone = runtime.clone();
    let store_clone = store.clone();
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let gateway_url = runtime_clone.gateway_url.clone()
            .unwrap_or_else(|| DEFAULT_GATEWAY_URL.to_string());
        
        // First heartbeat after a small delay to let registration propagate
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

        loop {
            // FIX #3: Use correct sysinfo 0.30 API methods
            let mut sys = sysinfo::System::new();
            sys.refresh_cpu();
            sys.refresh_memory();
            
            // CPU usage needs two samples to calculate difference
            tokio::time::sleep(tokio::time::Duration::from_millis(
                sysinfo::MINIMUM_CPU_UPDATE_INTERVAL.as_millis() as u64
            )).await;
            sys.refresh_cpu();

            let cpu_usage = sys.global_cpu_info().cpu_usage() as f64;
            let total_mem = sys.total_memory() as f64;
            let used_mem = sys.used_memory() as f64;
            let mem_percent = if total_mem > 0.0 {
                (used_mem / total_mem) * 100.0
            } else {
                0.0
            };
            
            let used_bytes = store_clone.get_used_bytes();
            let max_bytes = store_clone.get_max_bytes();
            let used_gb = used_bytes as f64 / 1_073_741_824.0;
            let max_gb = max_bytes as f64 / 1_073_741_824.0;
            let free_gb = (max_bytes.saturating_sub(used_bytes)) as f64 / 1_073_741_824.0;

            // FIX #1: Send the NEURO-XXXXXXXX node_id, not the raw peer_id.
            // This is the same ID the browser URL sends to the dashboard,
            // so the heartbeat cache and the earnings lookup will match.
            let payload = serde_json::json!({
                "node_id": node_id_for_heartbeat,
                "status": "online",
                "version": env!("CARGO_PKG_VERSION"),
                "os": std::env::consts::OS,
                "cpu_usage_percent": cpu_usage,
                "memory_usage_percent": mem_percent,
                "used_gb": used_gb,
                "max_gb": max_gb,
                "free_gb": free_gb,
                "shard_count": store_clone.get_shard_count(),
                "uptime_min": 0,
                "hostname": whoami::fallible::hostname().unwrap_or_default(),
            });

            match client.post(format!("{}/api/nodes/heartbeat", gateway_url))
                .json(&payload)
                .timeout(std::time::Duration::from_secs(15))
                .send()
                .await
            {
                Ok(resp) => {
                    if resp.status().is_success() {
                        if let Ok(data) = resp.json::<serde_json::Value>().await {
                            debug!("Heartbeat ACK: {}", data);
                        }
                    } else {
                        let status = resp.status();
                        warn!("Heartbeat rejected: HTTP {}", status);
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

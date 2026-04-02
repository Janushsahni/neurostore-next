// NOTE: windows_subsystem = "windows" was intentionally REMOVED so that
// neuro-node.exe always shows in Task Manager and always has a visible console.
// A storage node is a server process — operators need to see it running.
mod ingress;
mod p2p;
mod store;

use anyhow::Context;
use clap::Parser;
use p2p::{build_node, drive_node, parse_listen_multiaddr};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::{
    collections::HashSet,
    fs,
    io::{self, IsTerminal, Write},
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
};
use store::SecureBlockStore;
use tokio::sync::oneshot;
use tracing::info;

const DEFAULT_GATEWAY_URL: &str = "https://neurostore-backend-production.up.railway.app";
const DEFAULT_RELAY_URL: &str = "wss://demo.neurostore.network/v1/nodes/ws";

// --- CREATOR SIGNATURE ---
// Base64 encoded payload proving original authorship by Janyshh
#[allow(dead_code)]
const _CREATOR_SIG: &[u8] = b"SmFueXNoaCAtIE9yaWdpbmFsIENyZWF0b3Igb2YgTmV1cm9TdG9yZQ==";

#[derive(Parser, Debug, Clone)]
#[command(name = "neuro-node", version, about = "Decentralized storage node")]
struct Args {
    #[arg(long, default_value_t = default_storage_path_string())]
    storage_path: String,

    #[arg(long, default_value_t = 50)]
    max_gb: u64,

    #[arg(long, default_value = "/ip4/0.0.0.0/tcp/9000")]
    listen: String,

    #[arg(long, num_args = 0..)]
    bootstrap: Vec<String>,

    #[arg(long, num_args = 0..)]
    allow_peer: Vec<String>,

    #[arg(long, default_value_t = false)]
    interactive_setup: bool,

    #[arg(long)]
    relay_url: Option<String>,

    #[arg(long, default_value = DEFAULT_GATEWAY_URL)]
    gateway_url: String,

    #[arg(long)]
    setup_config_path: Option<String>,

    #[arg(long, default_value_t = false, hide = true)]
    run_as_service: bool,

    #[arg(long, default_value = "NeurostoreNode")]
    service_name: String,

    #[arg(long, default_value_t = false)]
    print_peer_id: bool,

    #[arg(long, default_value_t = false)]
    print_claim_token: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SetupConfig {
    storage_path: String,
    max_gb: u64,
    relay_url: Option<String>,
    #[serde(default = "default_gateway_url")]
    gateway_url: Option<String>,
    #[serde(default)]
    node_secret: Option<String>,
    #[serde(default = "default_ingress_port")]
    ingress_port: u16,
    #[serde(default)]
    public_ingress_url: Option<String>,
    #[serde(default = "default_wallet_address")]
    wallet_address: String,
    #[serde(default = "default_declared_location")]
    declared_location: String,
    #[serde(default = "default_auto_register")]
    auto_register: bool,
}

fn default_gateway_url() -> Option<String> {
    Some(DEFAULT_GATEWAY_URL.to_string())
}

fn env_string(keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        std::env::var(key).ok().and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
    })
}

fn env_bool(keys: &[&str], default: bool) -> bool {
    env_string(keys)
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(default)
}

fn derive_node_id(peer_id: &str) -> String {
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

fn default_ingress_port() -> u16 {
    9184
}

fn default_wallet_address() -> String {
    "0x0000000000000000000000000000000000000000".to_string()
}

fn default_declared_location() -> String {
    "IN".to_string()
}

fn default_auto_register() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize)]
struct RegistrationState {
    peer_id: String,
    gateway_url: String,
    registered_at: String,
}

#[derive(Debug, Clone)]
struct RuntimeConfig {
    storage_path: String,
    max_gb: u64,
    listen: String,
    bootstrap: Vec<String>,
    allow_peer: Vec<String>,
    relay_url: Option<String>,
    gateway_url: Option<String>,
    node_secret: Option<String>,
    ingress_port: u16,
    public_ingress_url: Option<String>,
    wallet_address: String,
    declared_location: String,
    auto_register: bool,
    identity_dir: std::path::PathBuf,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Configure logging: file-based for service mode, stdout for foreground
    if args.run_as_service {
        let log_dir = std::path::Path::new(
            &std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string()),
        )
        .join("NeuroStore")
        .join("logs");
        let _ = std::fs::create_dir_all(&log_dir);
        let file_appender = tracing_appender::rolling::daily(&log_dir, "neuro-node.log");
        let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
            )
            .with_target(true)
            .with_thread_ids(true)
            .with_writer(non_blocking)
            .with_ansi(false)
            .init();
        // Keep _guard alive for the process lifetime by leaking it
        // (service runs until SCM stops it, so this is intentional)
        std::mem::forget(_guard);
    } else {
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
            )
            .with_target(true)
            .with_thread_ids(true)
            .init();
    }

    #[cfg(windows)]
    if args.run_as_service {
        return windows_service_host::run(args);
    }
    #[cfg(not(windows))]
    if args.run_as_service {
        anyhow::bail!("--run-as-service is only supported on Windows");
    }

    run_foreground(args).await
}

fn get_or_create_claim_token(storage_path: &str) -> anyhow::Result<String> {
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

async fn run_foreground(args: Args) -> anyhow::Result<()> {
    let runtime = build_runtime_config(&args)?;
    if args.print_peer_id {
        std::fs::create_dir_all(&runtime.storage_path)?;
        std::fs::create_dir_all(&runtime.identity_dir)?;
        let keypair = load_or_create_identity(&runtime.identity_dir.to_string_lossy())?;
        println!("{}", keypair.public().to_peer_id());
        return Ok(());
    }
    if args.print_claim_token {
        std::fs::create_dir_all(&runtime.storage_path)?;
        std::fs::create_dir_all(&runtime.identity_dir)?;
        let token = get_or_create_claim_token(&runtime.identity_dir.to_string_lossy())?;
        println!("{}", token);
        return Ok(());
    }

    // ── STARTUP BANNER ──
    println!();
    println!("  ╔══════════════════════════════════════════════════════╗");
    println!("  ║         N E U R O S T O R E   N O D E               ║");
    println!("  ║         Decentralized Storage Mesh v{}         ║", env!("CARGO_PKG_VERSION"));
    println!("  ╠══════════════════════════════════════════════════════╣");
    println!("  ║  Status:   STARTING                                 ║");
    println!("  ║  Listen:   {}  ", runtime.listen);
    println!("  ║  Storage:  {}  ", runtime.storage_path);
    println!("  ║  Max:      {} GB allocated  ", runtime.max_gb);
    println!("  ║  Gateway:  {}  ", runtime.gateway_url.as_deref().unwrap_or("none"));
    println!("  ╚══════════════════════════════════════════════════════╝");
    println!();
    println!("  Press Ctrl+C to stop the node gracefully.");
    println!();

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        let _ = shutdown_tx.send(());
    });
    run_node_with_shutdown(&runtime, shutdown_rx).await
}

fn build_runtime_config(args: &Args) -> anyhow::Result<RuntimeConfig> {
    let launched_without_flags = std::env::args_os().len() <= 1;
    let has_terminal = io::stdin().is_terminal() && io::stdout().is_terminal();
    let config_path = args
        .setup_config_path
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(default_setup_config_path);
    let setup = resolve_setup_config(args, launched_without_flags, has_terminal, &config_path)?;

    Ok(RuntimeConfig {
        storage_path: setup.storage_path,
        max_gb: setup.max_gb,
        listen: args.listen.clone(),
        bootstrap: args.bootstrap.clone(),
        allow_peer: args.allow_peer.clone(),
        relay_url: setup.relay_url,
        gateway_url: setup.gateway_url.or_else(|| Some(args.gateway_url.clone())),
        node_secret: normalize_optional_secret(setup.node_secret),
        ingress_port: setup.ingress_port,
        public_ingress_url: setup.public_ingress_url,
        wallet_address: normalize_wallet_address(&setup.wallet_address),
        declared_location: normalize_declared_location(&setup.declared_location),
        auto_register: setup.auto_register,
        identity_dir: config_path.parent().unwrap_or(Path::new(".")).to_path_buf(),
    })
}

async fn run_node_with_shutdown(
    runtime: &RuntimeConfig,
    shutdown_rx: oneshot::Receiver<()>,
) -> anyhow::Result<()> {
    fs::create_dir_all(&runtime.storage_path)?;
    fs::create_dir_all(&runtime.identity_dir)?;
    let keypair = load_or_create_identity(&runtime.identity_dir.to_string_lossy())?;
    let peer_id = keypair.public().to_peer_id().to_string();
    let node_id = derive_node_id(&peer_id);

    // Lock the storage folder to the Node ID
    let mut final_storage_path = PathBuf::from(&runtime.storage_path);
    if !final_storage_path.ends_with(&node_id) {
        final_storage_path.push(&node_id);
    }
    fs::create_dir_all(&final_storage_path)?;
    let final_storage_path_string = final_storage_path.to_string_lossy().to_string();
    let store = Arc::new(SecureBlockStore::new(
        &final_storage_path_string,
        runtime.max_gb,
    ));

    let bootstrap_addrs = runtime
        .bootstrap
        .iter()
        .map(|s| s.parse())
        .collect::<Result<Vec<_>, _>>()?;
    let allowlist = runtime
        .allow_peer
        .iter()
        .map(|s| libp2p::PeerId::from_str(s))
        .collect::<Result<HashSet<_>, _>>()?;
    if runtime.auto_register {
        ensure_gateway_registration(runtime, &peer_id).await;
    }

    let node = build_node(
        store.clone(),
        keypair,
        bootstrap_addrs,
        allowlist,
        runtime.relay_url.clone(),
    )
    .await?;
    let listen_addr = parse_listen_multiaddr(&runtime.listen)?;

    info!(peer_id = %node.peer_id, node_id = %node_id, "Node identity loaded");
    info!(
        max_gb = runtime.max_gb,
        path = %final_storage_path_string,
        "Node storage allocation configured"
    );

    // ── GATEWAY HEARTBEAT BACKGROUND TASK ──
    let gateway_url = runtime
        .gateway_url
        .clone()
        .unwrap_or_else(|| "https://neurostore-backend-production.up.railway.app".to_string());
    let heartbeat_node_id = node_id.clone();
    let heartbeat_store = store.clone();
    let heartbeat_max_gb = runtime.max_gb;
    let start_time = std::time::Instant::now();
    let advertised_ingress_url = resolve_public_ingress_url(runtime);

    let ingress_secret = std::env::var("NODE_INGRESS_SHARED_SECRET")
        .or_else(|_| std::env::var("NODE_SHARED_SECRET"))
        .unwrap_or_default();
    let ingress_store = store.clone();
    let ingress_node_id = node_id.clone();
    let ingress_url_for_server = advertised_ingress_url.clone();
    let ingress_port = runtime.ingress_port;
    tokio::spawn(async move {
        if ingress_secret.is_empty() {
            tracing::warn!("NODE_INGRESS_SHARED_SECRET not set; direct node ingress disabled");
            return;
        }
        if let Err(err) =
            ingress::serve_ingress(ingress_store, ingress_node_id, ingress_secret, ingress_port)
                .await
        {
            tracing::error!("Node ingress server failed: {}", err);
        }
    });

    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(45));
        let mut sys = sysinfo::System::new_all();
        loop {
            interval.tick().await;
            sys.refresh_all();

            let used_bytes = heartbeat_store.get_used_bytes();
            let used_gb = used_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
            let uptime_min = start_time.elapsed().as_secs_f64() / 60.0;

            let cpu_usage = sys.global_cpu_info().cpu_usage();
            let memory_used_percent =
                (sys.used_memory() as f64 / sys.total_memory() as f64) * 100.0;

            let mut hasher = <sha2::Sha256 as sha2::Digest>::new();
            hasher.update(whoami::hostname().as_bytes());
            let fingerprint = format!("FP-{:x}", hasher.finalize());
            let mac_address = match mac_address::get_mac_address() {
                Ok(Some(ma)) => ma.to_string(),
                _ => fingerprint.clone(),
            };

            let heartbeat = serde_json::json!({
                "node_id": heartbeat_node_id,
                "status": "online",
                "shard_count": heartbeat_store.get_shard_count(),
                "used_gb": used_gb,
                "max_gb": heartbeat_max_gb,
                "free_gb": (heartbeat_max_gb as f64) - used_gb,
                "uptime_min": uptime_min,
                "cpu_usage_percent": cpu_usage,
                "memory_usage_percent": memory_used_percent,
                "version": env!("CARGO_PKG_VERSION"),
                "os": std::env::consts::OS,
                "os_version": "",
                "username": whoami::username(),
                "hostname": whoami::hostname(),
                "device_fingerprint": fingerprint,
                "mac_address": mac_address,
                "ingress_url": ingress_url_for_server,
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "build_digest": build_digest(),
                "build_signature": build_signature(),
            });

            match client
                .post(format!("{}/api/node/heartbeat", gateway_url))
                .json(&heartbeat)
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await
            {
                Ok(resp) => {
                    if resp.status().is_success() {
                        if let Ok(body) = resp.json::<serde_json::Value>().await {
                            let earned = body
                                .get("total_earned_inr")
                                .and_then(|v| v.as_str())
                                .unwrap_or("0.00");
                            info!(
                                node_id = %heartbeat_node_id,
                                used_gb = format!("{:.3}", used_gb),
                                uptime_min = format!("{:.1}", uptime_min),
                                total_earned_inr = %earned,
                                "💚 Heartbeat OK — Earning ₹"
                            );
                        }
                    } else {
                        tracing::warn!(
                            node_id = %heartbeat_node_id,
                            status = %resp.status(),
                            gateway = %gateway_url,
                            "Heartbeat HTTP {} — gateway may be updating",
                            resp.status()
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        node_id = %heartbeat_node_id,
                        gateway = %gateway_url,
                        "⚠️  Heartbeat failed: {} (will retry in 45s — node continues storing shards)",
                        e
                    );
                }
            }
        }
    });

    drive_node(node, listen_addr, shutdown_rx).await?;

    Ok(())
}

fn load_or_create_identity(storage_path: &str) -> anyhow::Result<libp2p::identity::Keypair> {
    let key_path = PathBuf::from(storage_path).join("node_identity.key");

    if key_path.exists() {
        let bytes = fs::read(&key_path)?;
        let keypair = libp2p::identity::Keypair::from_protobuf_encoding(&bytes)?;
        return Ok(keypair);
    }

    let keypair = libp2p::identity::Keypair::generate_ed25519();
    let encoded = keypair.to_protobuf_encoding()?;
    fs::write(&key_path, encoded)?;
    Ok(keypair)
}

fn resolve_setup_config(
    args: &Args,
    launched_without_flags: bool,
    has_terminal: bool,
    config_path: &Path,
) -> anyhow::Result<SetupConfig> {
    let defaults = SetupConfig {
        storage_path: env_string(&["NEUROSTORE_STORAGE_PATH", "STORAGE_PATH"])
            .unwrap_or_else(|| args.storage_path.clone()),
        max_gb: std::env::var("NEUROSTORE_MAX_GB")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(args.max_gb),
        relay_url: env_string(&["NEUROSTORE_RELAY_URL", "RELAY_URL"]).or_else(|| args.relay_url.clone()),
        gateway_url: env_string(&["NEUROSTORE_GATEWAY_URL", "GATEWAY_URL"]).or_else(|| Some(args.gateway_url.clone())),
        node_secret: std::env::var("NEUROSTORE_NODE_SHARED_SECRET")
            .ok()
            .or_else(|| std::env::var("NODE_SHARED_SECRET").ok()),
        ingress_port: std::env::var("NEUROSTORE_INGRESS_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(default_ingress_port()),
        public_ingress_url: env_string(&["NEUROSTORE_PUBLIC_INGRESS_URL", "PUBLIC_INGRESS_URL"]),
        wallet_address: default_wallet_address(),
        declared_location: default_declared_location(),
        auto_register: env_bool(&["NEUROSTORE_AUTO_REGISTER", "AUTO_REGISTER"], true),
    };

    let explicit_config = args.setup_config_path.is_some();

    if args.run_as_service {
        if let Some(saved) = load_setup_config(config_path)? {
            info!(path = %config_path.display(), "Loaded saved node setup for service mode");
            return Ok(saved);
        }
        return Ok(defaults);
    }

    #[cfg(windows)]
    if args.interactive_setup || launched_without_flags {
        return run_interactive_setup(&defaults, config_path);
    }

    #[cfg(not(windows))]
    if args.interactive_setup || (launched_without_flags && has_terminal) {
        return run_interactive_setup(&defaults, config_path);
    }

    if launched_without_flags || explicit_config {
        if let Some(saved) = load_setup_config(config_path)? {
            let mut setup = saved;
            // Always ensure the storage path is normalized
            setup.storage_path = normalize_storage_path(&setup.storage_path);
            info!(path = %config_path.display(), "Loaded saved node setup");
            return Ok(setup);
        } else if explicit_config {
            anyhow::bail!(
                "Explicitly requested setup config not found at {}",
                config_path.display()
            );
        }
    }

    Ok(defaults)
}

fn run_interactive_setup(
    defaults: &SetupConfig,
    config_path: &Path,
) -> anyhow::Result<SetupConfig> {
    println!("===============================================");
    println!("        Welcome to NeuroStore Node Setup       ");
    println!("===============================================");

    let mut baseline = defaults.clone();
    if let Some(saved) = load_setup_config(config_path)? {
        println!(
            "Found saved configuration at {}. Press Enter to keep current values.",
            config_path.to_string_lossy()
        );
        baseline = saved;
    } else {
        println!("No saved setup found. Let's get you set up to earn by renting storage.");
    }

    // --- PRE-GENERATE IDENTITY ---
    // We want to show the Node ID *before* the setup starts so the user feels it's real.
    // We'll store the master key in the config directory by default so it persists across setup changes.
    let identity_dir = config_path.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(identity_dir)?;
    let keypair = load_or_create_identity(&identity_dir.to_string_lossy())?;
    let peer_id = keypair.public().to_peer_id().to_string();
    let node_id = derive_node_id(&peer_id);

    let welcome_msg = format!("This wizard will help you join the NeuroStore infrastructure as a node. \n\nYOUR ASSIGNED NODE ID: {}\n\nClick Continue to choose your storage settings.", node_id);
    let _ = prompt_gui_fallback("NeuroStore Identity Registered", &welcome_msg, "Continue");

    let default_relay = baseline
        .relay_url
        .clone()
        .unwrap_or_else(|| DEFAULT_RELAY_URL.to_string());
    let default_gateway = baseline
        .gateway_url
        .clone()
        .unwrap_or_else(|| DEFAULT_GATEWAY_URL.to_string());
    let default_node_secret = baseline.node_secret.clone().unwrap_or_default();
    let default_ingress_port = baseline.ingress_port.to_string();
    let default_public_ingress_url = baseline.public_ingress_url.clone().unwrap_or_default();

    // Suggest adding the Node ID to the path
    let mut suggested_path = PathBuf::from(&baseline.storage_path);
    if !suggested_path.to_string_lossy().contains(&node_id) {
        suggested_path.push(&node_id);
    }

    let storage_path_input = prompt_path_gui_fallback(
        &format!("Storage Location for {}", node_id),
        &format!("Choose where {} should keep encrypted shard data.", node_id),
        &suggested_path.to_string_lossy(),
    )?;

    // Native Cross-Platform GUI Prompts!
    let max_gb_input = prompt_gui_fallback(
        "Storage Allocation",
        "How many Gigabytes (GB) of storage do you want to rent out? (e.g. 100, 500, 1000)",
        &baseline.max_gb.to_string(),
    )?;

    let relay_url_input = prompt_gui_fallback(
        "Network Relay",
        "Enter the Control Plane Relay (Default usually works):",
        &default_relay,
    )?;

    let wallet_address_input = prompt_gui_fallback(
        "Payout Wallet",
        "Enter your ERC-20 / EVM address for node rentals payout:",
        &baseline.wallet_address,
    )?;

    let max_gb = max_gb_input.parse::<u64>().unwrap_or(baseline.max_gb);
    let relay_url = if relay_url_input.is_empty() {
        None
    } else {
        Some(relay_url_input)
    };
    let gateway_url = baseline.gateway_url.clone();

    // Auto-register using standard secrets if not provided
    let node_secret = baseline.node_secret.clone();

    let setup = SetupConfig {
        storage_path: normalize_storage_path(&storage_path_input),
        max_gb,
        relay_url,
        gateway_url,
        node_secret,
        ingress_port: baseline.ingress_port,
        public_ingress_url: baseline.public_ingress_url.clone(),
        wallet_address: normalize_wallet_address(&wallet_address_input),
        declared_location: baseline.declared_location.clone(),
        auto_register: true,
    };
    save_setup_config(config_path, &setup)?;
    println!("Saved setup config to {}", config_path.to_string_lossy());
    Ok(setup)
}

fn prompt_path_gui_fallback(
    title: &str,
    prompt: &str,
    default_value: &str,
) -> anyhow::Result<String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; \
             Add-Type -AssemblyName System.Drawing; \
             $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; \
             $dialog.Description = '{prompt}'; \
             $dialog.ShowNewFolderButton = $true; \
             if ('{default_value}' -ne '') {{ $dialog.SelectedPath = '{default_value}' }}; \
             if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ Write-Output $dialog.SelectedPath }}",
            prompt = prompt.replace("'", "''"),
            default_value = default_value.replace("'", "''")
        );
        if let Ok(output) = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(script)
            .output()
        {
            let res = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !res.is_empty() {
                return Ok(res);
            }
        }
    }

    prompt_gui_fallback(title, prompt, default_value)
}

fn prompt_gui_fallback(title: &str, prompt: &str, default_value: &str) -> anyhow::Result<String> {
    #[cfg(windows)]
    {
        use std::fs;
        use std::process::Command;
        let vbs_code = format!(
            "Dim userInput\nuserInput = InputBox(\"{}\", \"{}\", \"{}\")\nWScript.Echo userInput",
            prompt.replace("\"", "\"\""),
            title.replace("\"", "\"\""),
            default_value.replace("\"", "\"\"")
        );
        let temp_name = format!("neuro_prompt_{}.vbs", chrono::Utc::now().timestamp_millis());
        let path = std::env::temp_dir().join(temp_name);
        if fs::write(&path, vbs_code).is_ok() {
            if let Ok(output) = Command::new("cscript").arg("//nologo").arg(&path).output() {
                let _ = fs::remove_file(&path);
                let res = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !res.is_empty() {
                    return Ok(res);
                }
                return Ok(default_value.to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let script = format!(
            r#"display dialog "{}" default answer "{}" with title "{}""#,
            prompt.replace("\"", "\\\""),
            default_value.replace("\"", "\\\""),
            title.replace("\"", "\\\"")
        );
        if let Ok(output) = Command::new("osascript").arg("-e").arg(&script).output() {
            let res = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Some(idx) = res.find("text returned:") {
                let val = res[idx + 14..].split(',').next().unwrap_or("").to_string();
                if !val.is_empty() {
                    return Ok(val);
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("zenity")
            .arg("--entry")
            .arg(&format!("--title={}", title))
            .arg(&format!("--text={}", prompt))
            .arg(&format!("--entry-text={}", default_value))
            .output()
        {
            let res = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !res.is_empty() {
                return Ok(res);
            }
        }
    }

    // Fallback to purely terminal CLI
    prompt_with_default(prompt, default_value)
}

fn prompt_with_default(label: &str, default_value: &str) -> anyhow::Result<String> {
    loop {
        print!("{label} [{default_value}]: ");
        io::stdout().flush()?;

        let mut buf = String::new();
        io::stdin().read_line(&mut buf)?;
        let input = buf.trim();
        if input.is_empty() {
            return Ok(default_value.to_string());
        }
        if !input.is_empty() {
            return Ok(input.to_string());
        }
    }
}

#[allow(dead_code)]
fn prompt_u64_with_default(label: &str, default_value: u64) -> anyhow::Result<u64> {
    loop {
        let input = prompt_with_default(label, &default_value.to_string())?;
        match input.parse::<u64>() {
            Ok(v) if v > 0 => return Ok(v),
            _ => println!("Please enter a positive integer."),
        }
    }
}

fn load_setup_config(config_path: &Path) -> anyhow::Result<Option<SetupConfig>> {
    if !config_path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(config_path)
        .with_context(|| format!("failed to read setup config {}", config_path.display()))?;
    let cfg: SetupConfig = serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse setup config {}", config_path.display()))?;
    Ok(Some(cfg))
}

fn save_setup_config(config_path: &Path, setup: &SetupConfig) -> anyhow::Result<()> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(setup)?;
    fs::write(config_path, raw)
        .with_context(|| format!("failed to write setup config {}", config_path.display()))?;
    Ok(())
}

fn default_setup_config_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return PathBuf::from(appdata)
                .join("Neurostore")
                .join("node-config.json");
        }
    }

    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
        return PathBuf::from(xdg)
            .join("neurostore")
            .join("node-config.json");
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join(".config")
            .join("neurostore")
            .join("node-config.json");
    }
    PathBuf::from("node-config.json")
}

fn default_storage_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local_app_data)
            .join("Neurostore")
            .join("node-data");
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("NeuroStore")
            .join("node-data");
    }

    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(xdg).join("neurostore").join("node-data");
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("neurostore")
            .join("node-data");
    }
    PathBuf::from("./node-data")
}

fn default_storage_path_string() -> String {
    default_storage_path().to_string_lossy().to_string()
}

fn normalize_storage_path(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        default_storage_path_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_optional_secret(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn resolve_public_ingress_url(runtime: &RuntimeConfig) -> Option<String> {
    // If the operator explicitly configured a public ingress URL, use that.
    if let Some(ref url) = runtime.public_ingress_url {
        if !url.is_empty() {
            return Some(url.clone());
        }
    }

    // Otherwise, DON'T fall back to 127.0.0.1 — that's unreachable from
    // other machines.  Returning None causes the gateway to use
    // "gateway-relay" mode, which proxies the data through the gateway
    // itself, solving NAT traversal automatically.
    None
}

fn normalize_wallet_address(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        default_wallet_address()
    } else {
        trimmed.to_string()
    }
}

fn normalize_declared_location(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        default_declared_location()
    } else {
        trimmed.to_uppercase()
    }
}

fn build_digest() -> Option<&'static str> {
    option_env!("NEURO_NODE_BUILD_DIGEST")
}

fn build_signature() -> Option<&'static str> {
    option_env!("NEURO_NODE_BUILD_SIGNATURE")
}

fn registration_state_path(storage_path: &str) -> PathBuf {
    PathBuf::from(storage_path).join(".gateway-registration.json")
}

fn load_registration_state(storage_path: &str) -> anyhow::Result<Option<RegistrationState>> {
    let path = registration_state_path(storage_path);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("failed to read registration state {}", path.display()))?;
    let state: RegistrationState = serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse registration state {}", path.display()))?;
    Ok(Some(state))
}

fn save_registration_state(storage_path: &str, state: &RegistrationState) -> anyhow::Result<()> {
    let path = registration_state_path(storage_path);
    let raw = serde_json::to_string_pretty(state)?;
    fs::write(&path, raw)
        .with_context(|| format!("failed to write registration state {}", path.display()))?;
    Ok(())
}

async fn ensure_gateway_registration(runtime: &RuntimeConfig, peer_id: &str) {
    let gateway_url = runtime
        .gateway_url
        .clone()
        .unwrap_or_else(|| DEFAULT_GATEWAY_URL.to_string());

    match load_registration_state(&runtime.storage_path) {
        Ok(Some(existing))
            if existing.peer_id == peer_id && existing.gateway_url == gateway_url =>
        {
            info!(peer_id = %peer_id, "Node already registered with gateway");
            return;
        }
        Ok(_) => {}
        Err(err) => tracing::warn!("Failed to read registration state: {err:#}"),
    }

    let Some(node_secret) = runtime.node_secret.clone() else {
        tracing::warn!("Skipping gateway auto-registration: node onboarding secret is missing");
        info!("Node will run in standalone mode. Heartbeats and earnings require gateway registration.");
        return;
    };

    let payload = serde_json::json!({
        "peer_id": peer_id,
        "wallet_address": runtime.wallet_address,
        "capacity_gb": runtime.max_gb,
        "declared_location": runtime.declared_location,
        "version": env!("CARGO_PKG_VERSION"),
        "latency_ms": serde_json::Value::Null,
        "ingress_url": resolve_public_ingress_url(runtime),
        "build_digest": build_digest(),
        "build_signature": build_signature(),
        "claim_token": get_or_create_claim_token(&runtime.identity_dir.to_string_lossy()).ok(),
    });

    let client = reqwest::Client::new();
    let max_attempts = 3;

    for attempt in 1..=max_attempts {
        info!(
            peer_id = %peer_id,
            gateway = %gateway_url,
            attempt = attempt,
            "Registering node with gateway (attempt {}/{})",
            attempt, max_attempts
        );

        match client
            .post(format!("{gateway_url}/api/nodes/register"))
            .header("x-node-secret", node_secret.clone())
            .json(&payload)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let state = RegistrationState {
                    peer_id: peer_id.to_string(),
                    gateway_url: gateway_url.clone(),
                    registered_at: chrono::Utc::now().to_rfc3339(),
                };
                if let Err(err) = save_registration_state(&runtime.storage_path, &state) {
                    tracing::warn!("Registered node but failed to save registration state: {err:#}");
                }
                info!(peer_id = %peer_id, gateway = %gateway_url, "✅ Gateway node registration succeeded");
                return;
            }
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::warn!(
                    peer_id = %peer_id,
                    gateway = %gateway_url,
                    status = %status,
                    body = %body,
                    "Gateway registration returned HTTP {} (attempt {}/{})",
                    status, attempt, max_attempts
                );
            }
            Err(err) => {
                tracing::warn!(
                    peer_id = %peer_id,
                    gateway = %gateway_url,
                    "Gateway registration failed: {} (attempt {}/{})",
                    err, attempt, max_attempts
                );
            }
        }

        if attempt < max_attempts {
            info!("Retrying gateway registration in 10 seconds...");
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        }
    }

    tracing::warn!(
        "Gateway registration failed after {} attempts. Node will continue running in offline mode.",
        max_attempts
    );
    info!("The node is still accepting P2P connections and storing shards. Heartbeats will retry automatically.");
}

#[cfg(windows)]
mod windows_service_host {
    use super::{build_runtime_config, run_node_with_shutdown, Args, RuntimeConfig};
    use anyhow::Context;
    use std::{
        ffi::OsString,
        sync::{Mutex, OnceLock},
        time::Duration,
    };
    use tokio::sync::oneshot;
    use windows_service::{
        define_windows_service,
        service::{
            ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
            ServiceType,
        },
        service_control_handler::{self, ServiceControlHandlerResult, ServiceStatusHandle},
        service_dispatcher,
    };

    #[derive(Clone)]
    struct ServiceRuntime {
        service_name: String,
        runtime: RuntimeConfig,
    }

    static SERVICE_RUNTIME: OnceLock<ServiceRuntime> = OnceLock::new();

    pub fn run(args: Args) -> anyhow::Result<()> {
        let runtime = build_runtime_config(&args)?;
        let service_name = args.service_name.clone();
        SERVICE_RUNTIME
            .set(ServiceRuntime {
                service_name: service_name.clone(),
                runtime,
            })
            .map_err(|_| anyhow::anyhow!("windows service runtime already initialized"))?;
        service_dispatcher::start(service_name.as_str(), ffi_service_main).with_context(|| {
            format!("failed to start windows service dispatcher for {service_name}")
        })?;
        Ok(())
    }

    define_windows_service!(ffi_service_main, service_main);

    fn service_main(_arguments: Vec<OsString>) {
        if let Err(err) = run_service() {
            eprintln!("windows service error: {err:#}");
        }
    }

    fn run_service() -> anyhow::Result<()> {
        let config = SERVICE_RUNTIME
            .get()
            .cloned()
            .context("missing service runtime config")?;

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let shutdown_tx = Mutex::new(Some(shutdown_tx));
        let status_handle = service_control_handler::register(
            config.service_name.as_str(),
            move |control_event| match control_event {
                ServiceControl::Stop | ServiceControl::Shutdown => {
                    if let Some(tx) = shutdown_tx.lock().ok().and_then(|mut guard| guard.take()) {
                        let _ = tx.send(());
                    }
                    ServiceControlHandlerResult::NoError
                }
                ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
                _ => ServiceControlHandlerResult::NotImplemented,
            },
        )?;

        set_service_status(&status_handle, ServiceState::StartPending)?;
        set_service_status(&status_handle, ServiceState::Running)?;

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .context("failed to create tokio runtime for windows service")?;
        let run_result = runtime.block_on(run_node_with_shutdown(&config.runtime, shutdown_rx));

        set_service_status(&status_handle, ServiceState::Stopped)?;
        run_result
    }

    fn set_service_status(
        status_handle: &ServiceStatusHandle,
        state: ServiceState,
    ) -> anyhow::Result<()> {
        let controls_accepted = if state == ServiceState::Running {
            ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN
        } else {
            ServiceControlAccept::empty()
        };
        let wait_hint = if state == ServiceState::StartPending {
            Duration::from_secs(10)
        } else {
            Duration::default()
        };

        status_handle.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: state,
            controls_accepted,
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint,
            process_id: None,
        })?;
        Ok(())
    }
}

#![windows_subsystem = "windows"]
mod p2p;
mod store;

use anyhow::Context;
use clap::Parser;
use p2p::{build_node, drive_node, parse_listen_multiaddr};
use serde::{Deserialize, Serialize};
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

// --- CREATOR SIGNATURE ---
// Base64 encoded payload proving original authorship by Janyshh
#[allow(dead_code)]
const _CREATOR_SIG: &[u8] = b"SmFueXNoaCAtIE9yaWdpbmFsIENyZWF0b3Igb2YgTmV1cm9TdG9yZQ==";

#[derive(Parser, Debug, Clone)]

#[command(name = "neuro-node", version, about = "Decentralized storage node")]
struct Args {
    #[arg(long, default_value = "./node-data")]
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

    #[arg(long)]
    setup_config_path: Option<String>,

    #[arg(long, default_value_t = false, hide = true)]
    run_as_service: bool,

    #[arg(long, default_value = "NeurostoreNode")]
    service_name: String,

    #[arg(long, default_value_t = false)]
    print_peer_id: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SetupConfig {
    storage_path: String,
    max_gb: u64,
    relay_url: Option<String>,
}

#[derive(Debug, Clone)]
struct RuntimeConfig {
    storage_path: String,
    max_gb: u64,
    listen: String,
    bootstrap: Vec<String>,
    allow_peer: Vec<String>,
    relay_url: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(true)
        .with_thread_ids(true)
        .init();

    let args = Args::parse();
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

async fn run_foreground(args: Args) -> anyhow::Result<()> {
    let runtime = build_runtime_config(&args)?;
    if args.print_peer_id {
        fs::create_dir_all(&runtime.storage_path)?;
        let keypair = load_or_create_identity(&runtime.storage_path)?;
        println!("{}", keypair.public().to_peer_id());
        return Ok(());
    }
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
    })
}

async fn run_node_with_shutdown(
    runtime: &RuntimeConfig,
    shutdown_rx: oneshot::Receiver<()>,
) -> anyhow::Result<()> {
    fs::create_dir_all(&runtime.storage_path)?;

    let store = Arc::new(SecureBlockStore::new(&runtime.storage_path, runtime.max_gb));
    let keypair = load_or_create_identity(&runtime.storage_path)?;
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
    let node = build_node(store.clone(), keypair, bootstrap_addrs, allowlist, runtime.relay_url.clone()).await?;
    let listen_addr = parse_listen_multiaddr(&runtime.listen)?;

    info!(peer_id = %node.peer_id, "Node identity loaded");
    info!(
        max_gb = runtime.max_gb,
        path = %runtime.storage_path,
        "Node storage allocation configured"
    );



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
        storage_path: args.storage_path.clone(),
        max_gb: args.max_gb,
        relay_url: args.relay_url.clone(),
    };

    if args.run_as_service {
        return Ok(defaults);
    }

    if args.interactive_setup || (launched_without_flags && has_terminal) {
        return run_interactive_setup(&defaults, config_path);
    }

    if launched_without_flags {
        if let Some(saved) = load_setup_config(config_path)? {
            info!(path = %config_path.display(), "Loaded saved node setup");
            return Ok(saved);
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

    let default_relay = baseline.relay_url.clone().unwrap_or_else(|| "wss://demo.neurostore.network/v1/nodes/ws".to_string());

    // Native Cross-Platform GUI Prompts!
    let max_gb_input = prompt_gui_fallback(
        "NeuroStore Storage Allocation",
        "How many Gigabytes (GB) of storage do you want to rent out? (e.g. 50, 100, 500)",
        &baseline.max_gb.to_string(),
    )?;
    
    let relay_url_input = prompt_gui_fallback(
        "NeuroStore Network Joining",
        "Enter the Control Plane WS Relay URL. (If joining a friend's Ngrok link, paste it here):",
        &default_relay,
    )?;

    let max_gb = max_gb_input.parse::<u64>().unwrap_or(baseline.max_gb);
    let relay_url = if relay_url_input.is_empty() { None } else { Some(relay_url_input) };

    let setup = SetupConfig {
        storage_path: baseline.storage_path,
        max_gb,
        relay_url,
    };
    save_setup_config(config_path, &setup)?;
    println!("Saved setup config to {}", config_path.to_string_lossy());
    Ok(setup)
}

fn prompt_gui_fallback(title: &str, prompt: &str, default_value: &str) -> anyhow::Result<String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        use std::fs;
        let vbs_code = format!(
            "Dim userInput\nuserInput = InputBox(\"{}\", \"{}\", \"{}\")\nWScript.Echo userInput",
            prompt.replace("\"", "\"\""),
            title.replace("\"", "\"\""),
            default_value.replace("\"", "\"\"")
        );
        let path = std::env::temp_dir().join("neuro_prompt.vbs");
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
            .output() {
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

#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

use clap::{Parser, Subcommand};
use neuronode::{
    get_or_create_claim_token, load_or_create_identity, run_node_with_shutdown, RuntimeConfig,
    SetupConfig, DEFAULT_GATEWAY_URL,
};
use std::path::{Path, PathBuf};
use tokio::sync::oneshot;

#[derive(Parser, Debug, Clone)]
#[command(name = "neuro-node", version, about = "Decentralized storage node")]
struct Args {
    #[arg(long)]
    uninstall: bool,

    #[arg(long, alias = "config")]
    setup_config_path: Option<PathBuf>,

    #[arg(long, default_value_t = false)]
    run_as_service: bool,

    #[arg(long)]
    service_name: Option<String>,

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

    #[arg(long)]
    gateway_url: Option<String>,

    #[arg(long, default_value_t = false)]
    print_peer_id: bool,

    #[arg(long, default_value_t = false)]
    print_claim_token: bool,

    /// Subcommand for CLI operations
    #[command(subcommand)]
    command: Option<NodeCommand>,
}

#[derive(Subcommand, Debug, Clone)]
enum NodeCommand {
    /// Show current node status (queries gateway for live telemetry)
    Status,
    /// Stop the running node service/process
    Stop,
    /// Show recent node logs
    Logs {
        /// Follow log output in real-time
        #[arg(long, short, default_value_t = false)]
        follow: bool,
        /// Number of lines to show
        #[arg(long, short, default_value_t = 50)]
        lines: usize,
    },
    /// Authenticate with Google OAuth (PKCE flow)
    Login,
    /// Show node identity and configuration info
    Info,
}

#[cfg(target_os = "windows")]
fn handle_windows_lifecycle(uninstall: bool) -> anyhow::Result<bool> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;

    let app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\".to_string());
    let neuro_dir = Path::new(&app_data).join("NeuroStore");
    let target_exe = neuro_dir.join("NeuroStore-Node.exe");

    if uninstall {
        // Clear stored credentials
        let _ = neuronode::auth::clear_tokens_secure();

        // Remove registry key
        let _ = Command::new("reg.exe")
            .args(&["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "NeuroStoreNode", "/f"])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output();
        
        // Stop any running nodes via taskkill
        let _ = Command::new("taskkill.exe")
            .args(&["/F", "/IM", "NeuroStore-Node.exe"])
            .creation_flags(0x08000000)
            .output();

        // Optionally, show a msgbox using PowerShell since we have no window
        let script = "[System.Windows.MessageBox]::Show('NeuroStore Node has been completely uninstalled. You can now delete this file.', 'NeuroStore', 0, 64)";
        let _ = Command::new("powershell.exe")
            .args(&["-c", &format!("Add-Type -AssemblyName PresentationFramework; {}", script)])
            .creation_flags(0x08000000)
            .output();

        std::process::exit(0);
    }

    let current_exe = std::env::current_exe()?;
    let is_in_appdata = current_exe.starts_with(&neuro_dir);

    if !is_in_appdata {
        // 1. Create directory
        std::fs::create_dir_all(&neuro_dir)?;

        // 2. Copy ourselves there
        if let Err(e) = std::fs::copy(&current_exe, &target_exe) {
            tracing::warn!("Failed to install to AppData: {}", e);
        }

        // 3. Add to Startup Registry
        let _ = Command::new("reg.exe")
            .args(&[
                "add",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                "/v", "NeuroStoreNode",
                "/t", "REG_SZ",
                "/d", &format!("\"{}\"", target_exe.to_string_lossy()),
                "/f"
            ])
            .creation_flags(0x08000000)
            .output();

        // 4. Generate a secure Node claim token & Peer ID
        let original_dir = std::env::current_dir()?;
        std::env::set_current_dir(&neuro_dir)?;
        let keypair = load_or_create_identity(".")?;
        let peer_id = keypair.public().to_peer_id().to_string();
        // CRITICAL: use the SAME derive_node_id function as lib.rs
        // so the browser URL matches what the heartbeat sends
        let node_id = neuronode::derive_node_id(&peer_id);
        
        // Use a secure, persistent claim token instead of a static one
        use neuronode::get_or_create_claim_token;
        let claim_token = get_or_create_claim_token(".")?;
        std::env::set_current_dir(original_dir)?;

        // 5. Instantly open browser for the user with the SECURE token
        let dashboard_url = format!("https://neurostore.vercel.app/dashboard/node?node_id={}&claim_token={}", node_id, claim_token);
        let _ = Command::new("cmd.exe")
            .args(&["/C", "start", "", &dashboard_url])
            .creation_flags(0x08000000)
            .output();

        // 6. Launch the background AppData version
        let _ = Command::new(target_exe)
            .creation_flags(0x08000000) // Detach from console if any
            .spawn();

        // 7. Exit this frontend process
        return Ok(true);
    }

    Ok(false)
}

#[cfg(not(target_os = "windows"))]
fn handle_windows_lifecycle(_uninstall: bool) -> anyhow::Result<bool> {
    Ok(false)
}

fn load_setup_config(path: &Path) -> anyhow::Result<SetupConfig> {
    let raw = std::fs::read_to_string(path)?;
    let config = serde_json::from_str::<SetupConfig>(&raw)?;
    Ok(config)
}

fn runtime_from_args(args: &Args) -> anyhow::Result<RuntimeConfig> {
    if let Some(config_path) = args.setup_config_path.as_deref() {
        let config = load_setup_config(config_path)?;
        let identity_dir = PathBuf::from(&config.storage_path);

        return Ok(RuntimeConfig {
            storage_path: config.storage_path,
            max_gb: config.max_gb,
            listen: args.listen.clone(),
            bootstrap: args.bootstrap.clone(),
            allow_peer: args.allow_peer.clone(),
            relay_url: config.relay_url,
            gateway_url: config.gateway_url.or_else(|| Some(DEFAULT_GATEWAY_URL.to_string())),
            node_secret: config.node_secret,
            ingress_port: config.ingress_port,
            public_ingress_url: config.public_ingress_url,
            wallet_address: config.wallet_address,
            declared_location: config.declared_location,
            auto_register: config.auto_register,
            identity_dir,
        });
    }

    // Check for saved onboarding config
    if neuronode::onboarding::is_onboarded() {
        let config = neuronode::onboarding::load_onboarding_config()?;
        let identity_dir = PathBuf::from(&config.storage_path);
        return Ok(RuntimeConfig {
            storage_path: config.storage_path,
            max_gb: config.max_gb,
            listen: args.listen.clone(),
            bootstrap: args.bootstrap.clone(),
            allow_peer: args.allow_peer.clone(),
            relay_url: config.relay_url,
            gateway_url: config.gateway_url.or_else(|| Some(DEFAULT_GATEWAY_URL.to_string())),
            node_secret: config.node_secret,
            ingress_port: config.ingress_port,
            public_ingress_url: config.public_ingress_url,
            wallet_address: config.wallet_address,
            declared_location: config.declared_location,
            auto_register: config.auto_register,
            identity_dir,
        });
    }

    #[cfg(target_os = "windows")]
    let base_dir = {
        let app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\".to_string());
        PathBuf::from(app_data).join("NeuroStore")
    };

    #[cfg(not(target_os = "windows"))]
    let base_dir = PathBuf::from(".");

    let final_storage_path = if args.storage_path == "./node-data" {
        base_dir.join("node-data").to_string_lossy().to_string()
    } else {
        args.storage_path.clone()
    };

    Ok(RuntimeConfig {
        storage_path: final_storage_path,
        max_gb: args.max_gb,
        listen: args.listen.clone(),
        bootstrap: args.bootstrap.clone(),
        allow_peer: args.allow_peer.clone(),
        relay_url: None,
        gateway_url: Some(args.gateway_url.clone().unwrap_or_else(|| DEFAULT_GATEWAY_URL.to_string())),
        node_secret: std::env::var("NODE_SHARED_SECRET").ok(),
        ingress_port: 9184,
        public_ingress_url: None,
        wallet_address: "0x0000000000000000000000000000000000000000".to_string(),
        declared_location: "IN".to_string(),
        auto_register: true,
        identity_dir: base_dir,
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Handle subcommands first (these don't need full node startup)
    if let Some(cmd) = args.command.clone() {
        let cli_cmd = match cmd {
            NodeCommand::Status => neuronode::cli::CliCommand::Status,
            NodeCommand::Stop => neuronode::cli::CliCommand::Stop,
            NodeCommand::Logs { follow, lines } => {
                neuronode::cli::CliCommand::Logs { follow, lines }
            }
            NodeCommand::Login => neuronode::cli::CliCommand::Login,
            NodeCommand::Info => neuronode::cli::CliCommand::Info,
        };
        return cli_cmd.execute().await;
    }

    let _ = (args.run_as_service, args.service_name.as_deref());

    if handle_windows_lifecycle(args.uninstall)? {
        return Ok(());
    }

    // First-run interactive onboarding (only when running interactively, not as service)
    if !args.run_as_service
        && args.setup_config_path.is_none()
        && !neuronode::onboarding::is_onboarded()
    {
        // Check if stdin is a terminal (interactive session)
        #[cfg(unix)]
        let is_interactive = unsafe { libc::isatty(0) != 0 };
        #[cfg(windows)]
        let is_interactive = true; // Windows exe is always interactive on first run
        #[cfg(not(any(unix, windows)))]
        let is_interactive = true;

        if is_interactive {
            match neuronode::onboarding::run_onboarding()? {
                Some(_result) => {
                    // Config is saved; will be loaded by runtime_from_args below
                }
                None => {
                    // User declined consent
                    return Ok(());
                }
            }
        }
    }

    let runtime = runtime_from_args(&args)?;

    if args.print_peer_id {
        std::fs::create_dir_all(&runtime.identity_dir)?;
        let keypair = load_or_create_identity(&runtime.identity_dir.to_string_lossy())?;
        println!("{}", keypair.public().to_peer_id());
        return Ok(());
    }

    if args.print_claim_token {
        std::fs::create_dir_all(&runtime.identity_dir)?;
        let token = get_or_create_claim_token(&runtime.identity_dir.to_string_lossy())?;
        println!("{}", token);
        return Ok(());
    }

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        let _ = shutdown_tx.send(());
    });

    run_node_with_shutdown(&runtime, shutdown_rx).await
}

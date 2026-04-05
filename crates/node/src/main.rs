#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

use clap::Parser;
use neuronode::{
    load_or_create_identity, run_node_with_shutdown, RuntimeConfig, DEFAULT_GATEWAY_URL,
};
use std::{
    path::{Path, PathBuf},
};
use tokio::sync::oneshot;

#[derive(Parser, Debug, Clone)]
#[command(name = "neuro-node", version, about = "Decentralized storage node")]
struct Args {
    #[arg(long)]
    uninstall: bool,

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
}

#[cfg(target_os = "windows")]
fn handle_windows_lifecycle(uninstall: bool) -> anyhow::Result<bool> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;

    let app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\".to_string());
    let neuro_dir = Path::new(&app_data).join("NeuroStore");
    let target_exe = neuro_dir.join("NeuroStore-Node.exe");

    if uninstall {
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

        // 4. Generate the Node claim token & Peer ID by loading identity from AppData
        let original_dir = std::env::current_dir()?;
        std::env::set_current_dir(&neuro_dir)?;
        let keypair = load_or_create_identity(".")?;
        let node_id = format!("NEURO-{}", &keypair.public().to_peer_id().to_string().to_uppercase()[..8]);
        let claim_token = "auto-claim-v1"; // Simplified static claim token for now to launch browser
        std::env::set_current_dir(original_dir)?;

        // 5. Instantly open browser for the user
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    if handle_windows_lifecycle(args.uninstall)? {
        return Ok(());
    }

    // Determine working directory (AppData if on Windows, otherwise current dir)
    #[cfg(target_os = "windows")]
    let base_dir = {
        let app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\".to_string());
        PathBuf::from(app_data).join("NeuroStore")
    };
    
    #[cfg(not(target_os = "windows"))]
    let base_dir = PathBuf::from(".");

    if args.print_peer_id {
        let keypair = load_or_create_identity(base_dir.to_str().unwrap_or("."))?;
        println!("{}", keypair.public().to_peer_id());
        return Ok(());
    }

    // Automatically set node data directory relative to base_dir
    let final_storage_path = if args.storage_path == "./node-data" {
        base_dir.join("node-data").to_string_lossy().to_string()
    } else {
        args.storage_path.clone()
    };

    let runtime = RuntimeConfig {
        storage_path: final_storage_path,
        max_gb: args.max_gb,
        listen: args.listen,
        bootstrap: args.bootstrap,
        allow_peer: args.allow_peer,
        relay_url: None,
        gateway_url: Some(args.gateway_url.unwrap_or_else(|| DEFAULT_GATEWAY_URL.to_string())),
        node_secret: std::env::var("NODE_SHARED_SECRET").ok(),
        ingress_port: 9184,
        public_ingress_url: None,
        wallet_address: "0x0000000000000000000000000000000000000000".to_string(),
        declared_location: "IN".to_string(),
        auto_register: true,
        identity_dir: base_dir,
    };

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        let _ = shutdown_tx.send(());
    });

    run_node_with_shutdown(&runtime, shutdown_rx).await
}

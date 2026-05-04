//! First-run interactive onboarding flow with explicit user consent.
//!
//! Presented once on first launch. Collects:
//! - Storage allocation (GB)
//! - Storage directory path
//! - Resource usage disclosure + consent
//! - Service installation consent

use anyhow::Result;
use std::io::{self, Write};
use std::path::PathBuf;

use crate::SetupConfig;

/// Result of the interactive onboarding flow.
#[derive(Debug, Clone)]
pub struct OnboardingResult {
    pub config: SetupConfig,
    pub install_service: bool,
}

const BANNER: &str = r#"
╔══════════════════════════════════════════════════════════════╗
║         🧠 NeuroStore — Decentralized Storage Node          ║
║                                                              ║
║  Your machine will store encrypted data shards for the       ║
║  NeuroStore network. You earn rewards for uptime and         ║
║  storage provided. All data is AES-256 encrypted.            ║
╚══════════════════════════════════════════════════════════════╝
"#;

const RESOURCE_DISCLOSURE: &str = r#"
┌─────────────────────── Resource Usage ───────────────────────┐
│                                                               │
│  • CPU:       ~1-3% idle, spikes during shard operations      │
│  • RAM:       ~30-80 MB (well under 100 MB target)            │
│  • Disk:      Only the amount you allocate below              │
│  • Network:   Heartbeat every 45s (~2 KB), shard I/O on       │
│               demand. Bandwidth is throttled per-transfer.    │
│  • Ports:     TCP 9000 (P2P), TCP 9184 (ingress API)          │
│  • TLS:       All gateway communication uses HTTPS/WSS        │
│  • Encryption: AES-256-GCM at rest, Noise protocol in transit │
│                                                               │
└───────────────────────────────────────────────────────────────┘
"#;

/// Run the interactive onboarding flow in the terminal.
/// Returns `None` if the user declines consent.
pub fn run_onboarding() -> Result<Option<OnboardingResult>> {
    println!("{}", BANNER);

    // Step 1: Storage allocation
    let max_gb = prompt_storage_gb()?;

    // Step 2: Storage directory
    let storage_path = prompt_storage_path()?;

    // Step 3: Resource disclosure
    println!("{}", RESOURCE_DISCLOSURE);

    // Step 4: Explicit consent
    if !prompt_consent(
        "Do you consent to NeuroStore using the resources described above? [y/N]: ",
    )? {
        println!("\n  ℹ️  Setup cancelled. No changes were made.\n");
        return Ok(None);
    }

    // Step 5: Service installation consent
    let install_service = prompt_consent(
        "\nInstall as a background service (auto-start on boot)? [y/N]: ",
    )?;

    if install_service {
        println!("  ✓ Will install as a persistent background service.");
        println!("  ℹ️  You can uninstall anytime with: neuro-node --uninstall");
    } else {
        println!("  ✓ Will run in foreground only (no auto-start).");
    }

    // Generate Identity and Claim Token FIRST so we can use Node ID for folder
    let original_dir = std::env::current_dir()?;
    let identity_dir = config_file_path().parent().unwrap().to_path_buf();
    std::fs::create_dir_all(&identity_dir)?;
    std::env::set_current_dir(&identity_dir)?;
    
    let keypair = crate::load_or_create_identity(".")?;
    let peer_id = keypair.public().to_peer_id().to_string();
    let node_id = crate::derive_node_id(&peer_id);
    let claim_token = crate::get_or_create_claim_token(".")?;
    
    std::env::set_current_dir(original_dir)?;

    // Append Node ID to the user's chosen folder
    let final_storage_path = storage_path.join(&node_id);

    let config = SetupConfig {
        storage_path: final_storage_path.to_string_lossy().to_string(),
        max_gb,
        relay_url: None,
        gateway_url: Some(crate::DEFAULT_GATEWAY_URL.to_string()),
        node_secret: None,
        ingress_port: 9184,
        public_ingress_url: None,
        wallet_address: "0x0000000000000000000000000000000000000000".to_string(),
        declared_location: "IN".to_string(),
        auto_register: true,
    };

    // Persist config for future runs
    let config_path = config_file_path();
    let json = serde_json::to_string_pretty(&config)?;
    std::fs::write(&config_path, &json)?;
    println!("\n  ✓ Configuration saved to {:?}", config_path);

    // Create storage directory with the Node ID subfolder
    std::fs::create_dir_all(&final_storage_path)?;
    println!("  ✓ Storage directory ready: {:?}", final_storage_path);

    println!("\n  🚀 Setup complete! Opening dashboard securely in your browser...");
    
    // Automatically launch dashboard securely
    let dashboard_url = format!("https://neurostore.vercel.app/dashboard/node?node_id={}&claim_token={}", node_id, claim_token);
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("cmd.exe")
            .args(&["/C", "start", "", &dashboard_url])
            .creation_flags(0x08000000)
            .output();
    }
    
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&dashboard_url).output();
    }
    
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&dashboard_url).output();
    }

    println!("\n  🚀 Starting node...\n");

    Ok(Some(OnboardingResult {
        config,
        install_service,
    }))
}

/// Check if onboarding has already been completed.
pub fn is_onboarded() -> bool {
    config_file_path().exists()
}

/// Load previously saved onboarding config.
pub fn load_onboarding_config() -> Result<SetupConfig> {
    let path = config_file_path();
    let raw = std::fs::read_to_string(&path)?;
    let config: SetupConfig = serde_json::from_str(&raw)?;
    Ok(config)
}

fn config_file_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let app_data =
            std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\".to_string());
        PathBuf::from(app_data)
            .join("NeuroStore")
            .join("node-config.json")
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join(".config")
            .join("neurostore")
            .join("node-config.json")
    }
}

fn prompt_storage_gb() -> Result<u64> {
    loop {
        print!("  How much storage to allocate (GB)? [50]: ");
        io::stdout().flush()?;

        let mut input = String::new();
        io::stdin().read_line(&mut input)?;
        let trimmed = input.trim();

        if trimmed.is_empty() {
            return Ok(50);
        }

        match trimmed.parse::<u64>() {
            Ok(gb) if gb >= 1 && gb <= 100_000 => return Ok(gb),
            Ok(_) => println!("  ⚠️  Please enter between 1 and 100,000 GB."),
            Err(_) => println!("  ⚠️  Please enter a valid number."),
        }
    }
}

fn prompt_storage_path() -> Result<PathBuf> {
    let default = default_storage_path();

    print!(
        "  Storage directory [{}]: ",
        default.display()
    );
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let trimmed = input.trim();

    if trimmed.is_empty() {
        Ok(default)
    } else {
        Ok(PathBuf::from(trimmed))
    }
}

fn default_storage_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let app_data =
            std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\".to_string());
        PathBuf::from(app_data).join("NeuroStore").join("node-data")
    }

    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("/var/lib/neurostore")
    }
}

fn prompt_consent(message: &str) -> Result<bool> {
    print!("{}", message);
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let answer = input.trim().to_lowercase();

    Ok(answer == "y" || answer == "yes")
}

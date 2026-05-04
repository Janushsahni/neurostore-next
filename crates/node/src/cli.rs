//! CLI subcommands for monitoring, controlling, and inspecting the running node.
//!
//! Provides: `neuro-node status`, `neuro-node stop`, `neuro-node logs`, `neuro-node login`, `neuro-node uninstall`

use anyhow::Result;
use std::path::PathBuf;

/// Subcommand dispatch.
pub enum CliCommand {
    /// Show running node status (queries gateway API).
    Status,
    /// Stop the running node service.
    Stop,
    /// Tail node logs.
    Logs { follow: bool, lines: usize },
    /// Trigger OAuth login flow.
    Login,
    /// Show the current node's identity info.
    Info,
}

impl CliCommand {
    pub async fn execute(self) -> Result<()> {
        match self {
            Self::Status => cmd_status().await,
            Self::Stop => cmd_stop(),
            Self::Logs { follow, lines } => cmd_logs(follow, lines),
            Self::Login => cmd_login().await,
            Self::Info => cmd_info(),
        }
    }
}

// ── Status ──────────────────────────────────────────────────────

async fn cmd_status() -> Result<()> {
    let identity_dir = identity_dir();
    if !identity_dir.exists() {
        println!("  Node is not initialized. Run `neuro-node` to set up.");
        return Ok(());
    }

    let keypair = crate::load_or_create_identity(&identity_dir.to_string_lossy())?;
    let peer_id = keypair.public().to_peer_id().to_string();
    let node_id = crate::derive_node_id(&peer_id);

    println!("╔══════════════════════════════════════════════════════╗");
    println!("║           NeuroStore Node Status                    ║");
    println!("╚══════════════════════════════════════════════════════╝");
    println!();
    println!("  Node ID:    {}", node_id);
    println!("  Peer ID:    {}", peer_id);

    // Check if service is running
    let running = is_service_running();
    println!(
        "  Service:    {}",
        if running { "🟢 Running" } else { "🔴 Stopped" }
    );

    // Query gateway for live telemetry
    let gateway_url = std::env::var("GATEWAY_URL")
        .unwrap_or_else(|_| crate::DEFAULT_GATEWAY_URL.to_string());

    match reqwest::Client::new()
        .get(format!("{}/api/node/{}/status", gateway_url, node_id))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                println!();
                println!(
                    "  Status:     {}",
                    data["status"].as_str().unwrap_or("unknown")
                );
                println!(
                    "  Storage:    {} / {} GB",
                    data["used_gb"].as_f64().map(|v| format!("{:.2}", v)).unwrap_or_default(),
                    data["max_gb"].as_f64().map(|v| format!("{:.1}", v)).unwrap_or_default(),
                );
                println!(
                    "  Shards:     {}",
                    data["shard_count"].as_i64().unwrap_or(0)
                );
                println!(
                    "  Uptime:     {:.1} min",
                    data["uptime_minutes"].as_f64().unwrap_or(0.0)
                );
                println!(
                    "  Earnings:   ₹{}",
                    data["total_earned_inr"]
                        .as_str()
                        .or_else(|| data["total_earned_inr"].as_f64().map(|_| "0.00"))
                        .unwrap_or("0.00")
                );
                if let Some(hb) = data["last_heartbeat_at"].as_str() {
                    println!("  Last HB:    {}", hb);
                }
            }
        }
        Ok(resp) => {
            println!(
                "\n  ⚠️  Gateway returned HTTP {}. Node may not be registered.",
                resp.status()
            );
        }
        Err(e) => {
            println!("\n  ⚠️  Could not reach gateway: {}", e);
        }
    }

    println!();
    Ok(())
}

// ── Stop ────────────────────────────────────────────────────────

fn cmd_stop() -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        println!("  Stopping NeuroStore Node service...");

        // Try Windows Service first
        let sc_result = std::process::Command::new("sc.exe")
            .args(&["stop", "NeurostoreNode"])
            .creation_flags(0x08000000)
            .output();

        match sc_result {
            Ok(output) if output.status.success() => {
                println!("  ✓ Service stopped.");
                return Ok(());
            }
            _ => {}
        }

        // Fallback: kill the process
        let _ = std::process::Command::new("taskkill.exe")
            .args(&["/F", "/IM", "NeuroStore-Node.exe"])
            .creation_flags(0x08000000)
            .output();

        println!("  ✓ Process terminated.");
    }

    #[cfg(target_os = "linux")]
    {
        println!("  Stopping NeuroStore Node service...");
        let result = std::process::Command::new("systemctl")
            .args(&["stop", "neurostore-node"])
            .output();

        match result {
            Ok(output) if output.status.success() => {
                println!("  ✓ Service stopped.");
            }
            _ => {
                // Fallback: kill by PID file or process name
                let _ = std::process::Command::new("pkill")
                    .args(&["-f", "neuro-node"])
                    .output();
                println!("  ✓ Process terminated.");
            }
        }
    }

    Ok(())
}

// ── Logs ────────────────────────────────────────────────────────

fn cmd_logs(follow: bool, lines: usize) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        let log_dir = {
            let app_data =
                std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\".to_string());
            PathBuf::from(app_data).join("NeuroStore").join("logs")
        };

        let latest_log = std::fs::read_dir(&log_dir)
            .ok()
            .and_then(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        e.path()
                            .extension()
                            .map(|ext| ext == "log")
                            .unwrap_or(false)
                    })
                    .max_by_key(|e| e.metadata().ok().and_then(|m| m.modified().ok()))
            });

        match latest_log {
            Some(entry) => {
                println!("  Showing logs from {:?}\n", entry.path());
                let content = std::fs::read_to_string(entry.path())?;
                let log_lines: Vec<&str> = content.lines().collect();
                let start = log_lines.len().saturating_sub(lines);
                for line in &log_lines[start..] {
                    println!("{}", line);
                }
                if follow {
                    println!("\n  (--follow not supported on Windows; use Event Viewer or `Get-Content -Wait`)");
                }
            }
            None => {
                println!("  No log files found in {:?}", log_dir);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let mut args = vec![
            "-u".to_string(),
            "neurostore-node".to_string(),
            "-n".to_string(),
            lines.to_string(),
            "--no-pager".to_string(),
        ];
        if follow {
            args.push("-f".to_string());
        }

        let _ = std::process::Command::new("journalctl")
            .args(&args)
            .status();
    }

    Ok(())
}

// ── Login ───────────────────────────────────────────────────────

async fn cmd_login() -> Result<()> {
    println!("  Preparing secure dashboard login...\n");

    let identity_dir = identity_dir();
    if !identity_dir.exists() {
        std::fs::create_dir_all(&identity_dir)?;
    }

    let keypair = crate::load_or_create_identity(&identity_dir.to_string_lossy())?;
    let peer_id = keypair.public().to_peer_id().to_string();
    let node_id = crate::derive_node_id(&peer_id);
    let claim_token = crate::get_or_create_claim_token(&identity_dir.to_string_lossy())?;

    let dashboard_url = format!("https://neurostore.vercel.app/dashboard/node?node_id={}&claim_token={}", node_id, claim_token);
    
    println!("  🚀 Opening your browser to authenticate and link this node...");
    println!("  If your browser does not open automatically, click this link:");
    println!("  {}\n", dashboard_url);

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

    println!("  ✅ Once you authenticate in the browser, this node will be fully linked to your account.");

    Ok(())
}

// ── Info ────────────────────────────────────────────────────────

fn cmd_info() -> Result<()> {
    let identity_dir = identity_dir();
    if !identity_dir.exists() {
        println!("  Node is not initialized.");
        return Ok(());
    }

    let keypair = crate::load_or_create_identity(&identity_dir.to_string_lossy())?;
    let peer_id = keypair.public().to_peer_id().to_string();
    let node_id = crate::derive_node_id(&peer_id);

    let claim_token =
        crate::get_or_create_claim_token(&identity_dir.to_string_lossy()).unwrap_or_default();

    println!("  Node ID:       {}", node_id);
    println!("  Peer ID:       {}", peer_id);
    println!("  Claim Token:   {}...", &claim_token[..16.min(claim_token.len())]);
    println!("  Identity Dir:  {:?}", identity_dir);

    if let Ok(config) = crate::onboarding::load_onboarding_config() {
        println!("  Storage Path:  {}", config.storage_path);
        println!("  Max GB:        {}", config.max_gb);
        println!("  Gateway:       {}", config.gateway_url.unwrap_or_default());
    }

    // Check auth status
    match crate::auth::load_tokens_secure() {
        Ok(Some(tokens)) => {
            println!(
                "  Auth:          ✅ Logged in as {}",
                tokens.email.as_deref().unwrap_or("unknown")
            );
            if let Some(exp) = tokens.expires_at {
                let remaining = exp - chrono::Utc::now().timestamp();
                if remaining > 0 {
                    println!("  Token Expiry:  {} min remaining", remaining / 60);
                } else {
                    println!("  Token Expiry:  ⚠️ Expired (will auto-refresh)");
                }
            }
        }
        Ok(None) => println!("  Auth:          Not logged in"),
        Err(_) => println!("  Auth:          ⚠️ Error reading credentials"),
    }

    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────

fn identity_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let app_data =
            std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\".to_string());
        PathBuf::from(app_data).join("NeuroStore")
    }

    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("/var/lib/neurostore")
    }
}

fn is_service_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("sc.exe")
            .args(&["query", "NeurostoreNode"])
            .creation_flags(0x08000000)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("RUNNING"))
            .unwrap_or(false)
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("systemctl")
            .args(&["is-active", "--quiet", "neurostore-node"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        false
    }
}

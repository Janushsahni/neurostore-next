//! OAuth 2.0 Authorization Code Flow with PKCE for headless node authentication.
//!
//! Flow:
//! 1. Generate PKCE code_verifier + code_challenge (S256)
//! 2. Spawn ephemeral localhost HTTP server on a random port
//! 3. Open default browser to Google OAuth consent screen
//! 4. Receive authorization code at localhost callback
//! 5. Exchange code + verifier for access_token + refresh_token
//! 6. Store tokens securely in OS credential manager
//! 7. Register/link node with gateway using the access token

use anyhow::{Context, Result};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio::sync::oneshot;
use tracing::{info, warn};

// ── PKCE ────────────────────────────────────────────────────────

/// Generate a cryptographically random PKCE code_verifier (43-128 chars, base64url).
pub fn generate_code_verifier() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    base64_url_encode(&buf)
}

/// Derive the S256 code_challenge from a code_verifier.
pub fn generate_code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64_url_encode(&digest)
}

fn base64_url_encode(input: &[u8]) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    URL_SAFE_NO_PAD.encode(input)
}

// ── OAuth Configuration ─────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct OAuthConfig {
    pub client_id: String,
    pub auth_url: String,
    pub token_url: String,
    pub scopes: Vec<String>,
    pub gateway_url: String,
}

impl OAuthConfig {
    /// Load OAuth config from environment or use NeuroStore defaults.
    pub fn from_env() -> Result<Self> {
        let client_id = std::env::var("GOOGLE_CLIENT_ID")
            .or_else(|_| std::env::var("NEURO_OAUTH_CLIENT_ID"))
            .context(
                "GOOGLE_CLIENT_ID or NEURO_OAUTH_CLIENT_ID must be set for OAuth authentication",
            )?;

        let gateway_url = std::env::var("GATEWAY_URL").unwrap_or_else(|_| {
            crate::DEFAULT_GATEWAY_URL.to_string()
        });

        Ok(Self {
            client_id,
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth".to_string(),
            token_url: "https://oauth2.googleapis.com/token".to_string(),
            scopes: vec!["email".to_string(), "profile".to_string()],
            gateway_url,
        })
    }
}

// ── Token Types ─────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>, // Unix timestamp
    pub email: Option<String>,
}

#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    #[serde(default)]
    token_type: String,
}

#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct GoogleUserInfo {
    email: String,
    name: Option<String>,
}

// ── Localhost Callback Server ───────────────────────────────────

/// Runs the complete OAuth PKCE flow:
/// 1. Spawns localhost callback server
/// 2. Opens browser to Google consent screen
/// 3. Waits for authorization code
/// 4. Exchanges for tokens
/// 5. Stores securely
pub async fn run_oauth_flow(config: &OAuthConfig) -> Result<TokenSet> {
    let code_verifier = generate_code_verifier();
    let code_challenge = generate_code_challenge(&code_verifier);

    // Bind to a random available port
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);

    info!("OAuth callback server listening on {}", redirect_uri);

    // Build the authorization URL
    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        config.auth_url,
        urlencoding::encode(&config.client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&config.scopes.join(" ")),
        urlencoding::encode(&code_challenge),
    );

    // Open browser
    info!("Opening browser for authentication...");
    if let Err(e) = open_browser(&auth_url) {
        warn!("Could not open browser automatically: {}", e);
        println!("\n  Please open this URL in your browser to authenticate:\n");
        println!("  {}\n", auth_url);
    }

    // Wait for the callback with the authorization code
    let (code_tx, code_rx) = oneshot::channel::<String>();
    let code_tx = Arc::new(tokio::sync::Mutex::new(Some(code_tx)));

    let server = {
        let code_tx = code_tx.clone();
        async move {
            loop {
                let (stream, _) = listener.accept().await?;
                let code_tx = code_tx.clone();

                tokio::spawn(async move {
                    let io = hyper_util::rt::TokioIo::new(stream);
                    let service = hyper::service::service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
                        let code_tx = code_tx.clone();
                        async move {
                            if req.uri().path() == "/callback" {
                                if let Some(query) = req.uri().query() {
                                    let params: std::collections::HashMap<String, String> =
                                        url::form_urlencoded::parse(query.as_bytes())
                                            .map(|(k, v)| (k.to_string(), v.to_string()))
                                            .collect();

                                    if let Some(code) = params.get("code") {
                                        if let Some(tx) = code_tx.lock().await.take() {
                                            let _ = tx.send(code.clone());
                                        }

                                        let body = "<!DOCTYPE html><html><body style='font-family:system-ui;text-align:center;padding:60px'>\
                                            <h1>✅ Authentication Successful</h1>\
                                            <p>You can close this tab and return to the terminal.</p>\
                                            <script>setTimeout(()=>window.close(),2000)</script>\
                                            </body></html>";

                                        return Ok::<_, hyper::Error>(hyper::Response::builder()
                                            .header("Content-Type", "text/html")
                                            .body(http_body_util::Full::new(hyper::body::Bytes::from(body)))
                                            .unwrap());
                                    }

                                    if let Some(error) = params.get("error") {
                                        let body = format!(
                                            "<!DOCTYPE html><html><body style='font-family:system-ui;text-align:center;padding:60px'>\
                                            <h1>❌ Authentication Failed</h1><p>{}</p></body></html>",
                                            error
                                        );
                                        return Ok(hyper::Response::builder()
                                            .status(400)
                                            .header("Content-Type", "text/html")
                                            .body(http_body_util::Full::new(hyper::body::Bytes::from(body)))
                                            .unwrap());
                                    }
                                }
                            }

                            Ok(hyper::Response::builder()
                                .status(404)
                                .body(http_body_util::Full::new(hyper::body::Bytes::from("Not Found")))
                                .unwrap())
                        }
                    });

                    let _ = hyper::server::conn::http1::Builder::new()
                        .serve_connection(io, service)
                        .await;
                });
            }
            #[allow(unreachable_code)]
            Ok::<_, anyhow::Error>(())
        }
    };

    // Race: either we get the code or timeout after 120 seconds
    let auth_code = tokio::select! {
        _ = server => anyhow::bail!("OAuth server exited unexpectedly"),
        code = code_rx => code.context("OAuth callback channel closed without receiving code")?,
        _ = tokio::time::sleep(std::time::Duration::from_secs(120)) => {
            anyhow::bail!("OAuth authentication timed out after 120 seconds. Please try again.")
        }
    };

    info!("Authorization code received, exchanging for tokens...");

    // Exchange authorization code for tokens
    let token_set = exchange_code(config, &auth_code, &code_verifier, &redirect_uri).await?;

    // Store tokens securely
    store_tokens_secure(&token_set)?;

    info!(
        "Authentication complete for {}",
        token_set.email.as_deref().unwrap_or("unknown")
    );

    Ok(token_set)
}

/// Exchange authorization code for access + refresh tokens.
async fn exchange_code(
    config: &OAuthConfig,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenSet> {
    let client = reqwest::Client::new();

    let resp = client
        .post(&config.token_url)
        .form(&[
            ("client_id", config.client_id.as_str()),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await
        .context("Failed to contact Google token endpoint")?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Token exchange failed: {}", body);
    }

    let token_resp: GoogleTokenResponse = resp.json().await?;

    let expires_at = token_resp
        .expires_in
        .map(|secs| chrono::Utc::now().timestamp() + secs);

    // Fetch user info to get email
    let user_info = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&token_resp.access_token)
        .send()
        .await?
        .json::<GoogleUserInfo>()
        .await
        .ok();

    Ok(TokenSet {
        access_token: token_resp.access_token,
        refresh_token: token_resp.refresh_token,
        expires_at,
        email: user_info.map(|u| u.email),
    })
}

// ── Secure Credential Storage ───────────────────────────────────

const KEYRING_SERVICE: &str = "neurostore-node";
const KEYRING_USER: &str = "oauth-tokens";

/// Store tokens in OS-native credential manager.
/// - Windows: Credential Manager (DPAPI-protected)
/// - Linux: libsecret / GNOME Keyring / KWallet
/// - Fallback: encrypted file with machine-specific key
pub fn store_tokens_secure(tokens: &TokenSet) -> Result<()> {
    let json = serde_json::to_string(tokens)?;

    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        Ok(entry) => {
            entry
                .set_password(&json)
                .context("Failed to store credentials in OS keyring")?;
            info!("Tokens stored securely in OS credential manager");
            Ok(())
        }
        Err(e) => {
            warn!("OS keyring unavailable ({}), using encrypted file fallback", e);
            store_tokens_file_fallback(tokens)
        }
    }
}

/// Load tokens from OS-native credential manager.
pub fn load_tokens_secure() -> Result<Option<TokenSet>> {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        Ok(entry) => match entry.get_password() {
            Ok(json) => {
                let tokens: TokenSet = serde_json::from_str(&json)?;
                // Check if access token is expired
                if let Some(exp) = tokens.expires_at {
                    if chrono::Utc::now().timestamp() >= exp - 60 {
                        info!("Access token expired, refresh required");
                        // Still return the token set — caller should attempt refresh
                        return Ok(Some(tokens));
                    }
                }
                Ok(Some(tokens))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => {
                warn!("Keyring read error: {}, trying file fallback", e);
                load_tokens_file_fallback()
            }
        },
        Err(e) => {
            warn!("OS keyring unavailable ({}), trying file fallback", e);
            load_tokens_file_fallback()
        }
    }
}

/// Delete stored tokens (for logout / uninstall).
pub fn clear_tokens_secure() -> Result<()> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.delete_credential();
    }
    // Also clean up file fallback
    let path = token_file_path();
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

// ── Encrypted File Fallback (headless Linux servers without D-Bus) ──

fn token_file_path() -> std::path::PathBuf {
    let base = if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string())
    } else {
        std::env::var("HOME")
            .map(|h| format!("{}/.config", h))
            .unwrap_or_else(|_| ".".to_string())
    };
    std::path::PathBuf::from(base)
        .join("neurostore")
        .join(".credentials.enc")
}

fn store_tokens_file_fallback(tokens: &TokenSet) -> Result<()> {
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};
    use aes_gcm::aead::OsRng;
    use aes_gcm::AeadCore;

    let path = token_file_path();
    std::fs::create_dir_all(path.parent().unwrap())?;

    let key = derive_machine_key();
    let cipher = Aes256Gcm::new_from_slice(&key)?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let plaintext = serde_json::to_vec(tokens)?;
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_ref())
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

    let mut output = nonce.to_vec();
    output.extend_from_slice(&ciphertext);
    std::fs::write(&path, &output)?;

    // Restrict file permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

fn load_tokens_file_fallback() -> Result<Option<TokenSet>> {
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};
    use aes_gcm::Nonce;

    let path = token_file_path();
    if !path.exists() {
        return Ok(None);
    }

    let data = std::fs::read(&path)?;
    if data.len() < 12 {
        return Ok(None);
    }

    let key = derive_machine_key();
    let cipher = Aes256Gcm::new_from_slice(&key)?;
    let nonce = Nonce::from_slice(&data[..12]);
    let ciphertext = &data[12..];

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| anyhow::anyhow!("Failed to decrypt credential file"))?;

    let tokens: TokenSet = serde_json::from_slice(&plaintext)?;
    Ok(Some(tokens))
}

/// Derive a machine-specific 256-bit key for file-based credential encryption.
/// Uses hostname + machine-id as entropy source — tied to this specific machine.
fn derive_machine_key() -> [u8; 32] {
    let hostname = whoami::fallible::hostname().unwrap_or_else(|_| "unknown".to_string());

    let machine_id = if cfg!(target_os = "linux") {
        std::fs::read_to_string("/etc/machine-id")
            .or_else(|_| std::fs::read_to_string("/var/lib/dbus/machine-id"))
            .unwrap_or_else(|_| "fallback-id".to_string())
    } else {
        // Windows: use ComputerName + SID as entropy
        std::env::var("COMPUTERNAME").unwrap_or_else(|_| "win-fallback".to_string())
    };

    let mut hasher = Sha256::new();
    hasher.update(b"neurostore-credential-key-v1:");
    hasher.update(hostname.as_bytes());
    hasher.update(b":");
    hasher.update(machine_id.trim().as_bytes());
    let result = hasher.finalize();

    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

// ── Token Refresh ───────────────────────────────────────────────

/// Attempt to refresh an expired access token using the refresh token.
pub async fn refresh_access_token(config: &OAuthConfig, tokens: &TokenSet) -> Result<TokenSet> {
    let refresh_token = tokens
        .refresh_token
        .as_ref()
        .context("No refresh token available — re-authentication required")?;

    let client = reqwest::Client::new();
    let resp = client
        .post(&config.token_url)
        .form(&[
            ("client_id", config.client_id.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .context("Failed to contact token refresh endpoint")?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Token refresh failed: {}", body);
    }

    let token_resp: GoogleTokenResponse = resp.json().await?;
    let expires_at = token_resp
        .expires_in
        .map(|secs| chrono::Utc::now().timestamp() + secs);

    let new_tokens = TokenSet {
        access_token: token_resp.access_token,
        refresh_token: token_resp
            .refresh_token
            .or_else(|| tokens.refresh_token.clone()),
        expires_at,
        email: tokens.email.clone(),
    };

    store_tokens_secure(&new_tokens)?;
    Ok(new_tokens)
}

/// Get a valid access token — refreshing if necessary.
pub async fn get_valid_token(config: &OAuthConfig) -> Result<TokenSet> {
    let tokens = load_tokens_secure()?.context("Not authenticated. Run `neuro-node login` first.")?;

    if let Some(exp) = tokens.expires_at {
        if chrono::Utc::now().timestamp() >= exp - 60 {
            info!("Access token expired, attempting refresh...");
            return refresh_access_token(config, &tokens).await;
        }
    }

    Ok(tokens)
}

// ── Browser Opener ──────────────────────────────────────────────

fn open_browser(url: &str) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd.exe")
            .args(&["/C", "start", "", url])
            .creation_flags(0x08000000)
            .spawn()?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(url).spawn()?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(url).spawn()?;
    }

    Ok(())
}

use axum::{
    extract::{Request, State},
    http::{HeaderValue, Method},
    middleware::{from_fn, Next},
    response::{Response, IntoResponse},
    routing::{get, post},
    Router,
    Json,
};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::ServeDir;
use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
use std::sync::Arc;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;
use tokio::sync::mpsc;
use crate::p2p::SwarmRequest;

use moka::future::Cache;

pub mod models;
pub mod handlers;
pub mod erasure;
pub mod p2p;

pub mod proofs;
pub mod repair;
pub mod geofence;
pub mod crypto;

pub struct AppState {
    pub db: sqlx::PgPool,
    pub p2p_tx: mpsc::Sender<SwarmRequest>,
    // CDN Layer: Maps CID -> Raw Bytes
    pub edge_cache: Cache<String, axum::body::Bytes>,
    pub geo: geofence::GeoFenceManager,
    pub metadata_protector: crypto::MetadataProtector,
    pub jwt_secret: String,
    pub proof_submit_token: String,
    pub compliance_signing_key: String,
    pub node_shared_secret: String,
    pub cookie_secure: bool,
    pub environment: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok(); // Load .env if present

    // Initialize tracing
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::DEBUG)
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .expect("setting default subscriber failed");

    // Connect to PostgreSQL with retry logic (Railway may start DB after gateway)
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL environment variable is required");

    info!("Connecting to PostgreSQL...");
    
    let mut pool_result = None;
    for attempt in 1..=5u32 {
        match PgPoolOptions::new()
            .max_connections(25)
            .acquire_timeout(std::time::Duration::from_secs(10))
            .connect(&database_url)
            .await
        {
            Ok(p) => {
                info!("Connected to database on attempt {}.", attempt);
                pool_result = Some(p);
                break;
            }
            Err(e) => {
                let wait = 2u64.pow(attempt);
                tracing::warn!("DB connection attempt {} failed: {}. Retrying in {}s...", attempt, e, wait);
                tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
            }
        }
    }
    let pool = pool_result.expect("Failed to connect to PostgreSQL after 5 attempts");

    // Run Migrations (Ensuring production schema is provisioned)
    sqlx::migrate!("./migrations").run(&pool).await?;

    // Phase 10: Ignite the LibP2P Swarm Network (non-fatal on cloud platforms)
    let (p2p_tx, p2p_rx) = mpsc::channel(100);
    let geo_manager = geofence::GeoFenceManager::new();
    
    match p2p::P2pNode::new().await {
        Ok(mut swarm_node) => {
            let geo_manager_clone = geofence::GeoFenceManager::new();
            let db_for_p2p = pool.clone();
            tokio::spawn(async move {
                info!("Igniting LibP2P Kademlia DHT Swarm...");
                if let Err(e) = swarm_node.start(9010, p2p_rx, geo_manager_clone, db_for_p2p).await {
                    tracing::error!("P2P Swarm error: {}", e);
                }
            });
        }
        Err(e) => {
            tracing::warn!("P2P Swarm disabled (cloud mode): {}. HTTP API will still function.", e);
            // Drain the rx channel so senders don't block
            tokio::spawn(async move {
                let mut rx = p2p_rx;
                while rx.recv().await.is_some() {}
            });
        }
    }

    fn env_or_random(name: &str) -> String {
        std::env::var(name).unwrap_or_else(|_| {
            let val: String = (0..32).map(|_| format!("{:02x}", rand::random::<u8>())).collect();
            tracing::warn!("{} not set — using generated default. Set this in production!", name);
            val
        })
    }

    let metadata_secret = env_or_random("METADATA_SECRET");
    let jwt_secret = env_or_random("JWT_SECRET");
    let proof_submit_token = env_or_random("PROOF_SUBMIT_TOKEN");
    let compliance_signing_key = env_or_random("COMPLIANCE_SIGNING_KEY");
    let node_shared_secret = env_or_random("NODE_SHARED_SECRET");
    let cookie_secure = std::env::var("COOKIE_SECURE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let environment = std::env::var("ENVIRONMENT").unwrap_or_else(|_| "development".to_string());
    let metadata_protector = crypto::MetadataProtector::new(&metadata_secret);

    let edge_cache: Cache<String, axum::body::Bytes> = Cache::new(10_000);

    let shared_state = Arc::new(AppState { 
        db: pool, 
        p2p_tx, 
        edge_cache,
        geo: geo_manager,
        metadata_protector,
        jwt_secret,
        proof_submit_token,
        compliance_signing_key,
        node_shared_secret,
        cookie_secure,
        environment,
    });


    // Phase 11: Ignite the Cryptographic Proof of Spacetime (PoSt) Daemon
    let post_daemon = proofs::ProofOfSpacetimeDaemon::new(Arc::clone(&shared_state));
    tokio::spawn(async move {
        post_daemon.start().await;
    });

    // Phase 18: Ignite the Automated Data Repair Daemon (Self-Healing Swarm)
    let repair_daemon = repair::RepairDaemon::new(Arc::clone(&shared_state));
    tokio::spawn(async move {
        repair_daemon.start().await;
    });

    let allowed_origins = parse_allowed_origins();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(allowed_origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
            "x-csrf-token".parse().unwrap(),
            "x-neuro-proof-token".parse().unwrap(),
        ])
        .expose_headers([
            axum::http::header::CONTENT_TYPE,
        ])
        .allow_credentials(true);

    // Build the Axum Router
    let app = Router::new()
        .route("/readyz", get(health_check))
        .route("/api/health", get(health_check)) // Senior DevOps Alias
        
        // Auth Routes (Supporting both legacy and /api standardized paths)
        .route("/auth/register", post(handlers::auth::register))
        .route("/api/register", post(handlers::auth::register))
        .route("/auth/login", post(handlers::auth::login))
        .route("/api/login", post(handlers::auth::login))
        .route("/auth/logout", post(handlers::auth::logout))
        .route("/api/logout", post(handlers::auth::logout))
        .route("/auth/session", get(handlers::auth::session))
        .route("/api/session", get(handlers::auth::session))
        
        // Enterprise Auth Routes
        .route("/api/auth/escrow", post(handlers::auth::setup_escrow))
        .route("/api/auth/sso/saml", post(handlers::auth::sso_saml_login))
        .route("/api/auth/sso/oauth", post(handlers::auth::sso_oauth_login))
        
        // S3-Compatible API (Path Style)
        .route("/:bucket", get(handlers::s3::list_objects))
        .route("/:bucket/*key", 
            get(handlers::s3::get_object)
            .put(handlers::s3::put_object)
            .delete(handlers::s3::delete_object)
        )
        
        // Internal Extensions
        .route("/api/manifest/:bucket/*key", get(handlers::s3::get_presigned_manifest))
        .route("/api/deduplicate/:bucket/*key", post(handlers::s3::deduplicate_object))
        .route("/api/reconstruct/:bucket/*key", post(handlers::s3::reconstruct_metadata))
        .route("/api/compliance/sovereignty/:bucket", get(handlers::compliance::sovereignty_audit))
        .route("/api/nodes/register", post(handlers::nodes::register_provider_node))
        .route("/api/node/heartbeat", post(handlers::nodes::node_heartbeat))
        .route("/api/nodes/stats", get(handlers::nodes::network_stats))
        .route("/api/node/:node_id/earnings", get(handlers::nodes::node_earnings))
        .route("/zk/store/:bucket/*key", post(handlers::zk::zk_store))
        .route("/zk/issue-challenge", post(proofs::issue_zk_challenge))
        .route("/zk/submit-proof", post(proofs::verify_zk_proof))
        // Webhook API
        .route("/api/webhooks", post(handlers::webhooks::register_webhook))
        .route("/api/webhooks/:bucket", get(handlers::webhooks::list_webhooks))
        // Feature API — PII Detection, Versioning, WORM, AI, Billing
        .route("/api/pii/scan/:bucket/*key", post(handlers::features::scan_object_pii))
        .route("/api/pii/scan-text", post(handlers::features::scan_text_pii))
        .route("/api/versions/:bucket/*key", get(handlers::features::list_versions))
        .route("/api/worm/configure", post(handlers::features::configure_worm))
        .route("/api/ai/auto-tag/:bucket/*key", post(handlers::features::auto_tag_object))
        .route("/api/ai/search", post(handlers::features::ai_semantic_search))
        .route("/api/billing/usage", get(handlers::features::get_usage_summary))
        .fallback_service(ServeDir::new("public"))
        .layer(cors)
        .layer(from_fn(security_headers))
        .layer(from_fn(rate_limit))
        .with_state(shared_state);

    // Bind server (supporting Railway/Heroku dynamic PORT)
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(9009);
        
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("NeuroStore V3 Enterprise Gateway listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let db_ok = sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .map(|v| v == 1)
        .unwrap_or(false);

    let mut warnings: Vec<String> = Vec::new();
    if state.jwt_secret.len() < 32 {
        warnings.push("JWT_SECRET is shorter than 32 characters".to_string());
    }
    if state.proof_submit_token.len() < 32 {
        warnings.push("PROOF_SUBMIT_TOKEN is shorter than 32 characters".to_string());
    }
    if state.compliance_signing_key.len() < 32 {
        warnings.push("COMPLIANCE_SIGNING_KEY is shorter than 32 characters".to_string());
    }
    if state.node_shared_secret.len() < 32 {
        warnings.push("NODE_SHARED_SECRET is shorter than 32 characters".to_string());
    }
    if !state.cookie_secure {
        warnings.push("COOKIE_SECURE is disabled".to_string());
    }
    if state.environment.eq_ignore_ascii_case("production") {
        let has_localhost_origin = std::env::var("ALLOWED_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .map(|o| o.trim().to_lowercase())
            .any(|o| o.contains("localhost") || o.contains("127.0.0.1"));
        if has_localhost_origin {
            warnings.push("ALLOWED_ORIGINS contains localhost while ENVIRONMENT=production".to_string());
        }
    }

    let production_ready = db_ok && warnings.is_empty();

    // SECURITY: In production, do NOT expose specific readiness warnings
    // (they reveal which secrets are weak and what is misconfigured)
    let is_production = state.environment.eq_ignore_ascii_case("production");
    let exposed_warnings = if is_production {
        vec![] // Hide details in production
    } else {
        warnings.clone()
    };

    Json(serde_json::json!({
        "status": if db_ok { "ok" } else { "degraded" },
        "ok": db_ok,
        "production_ready": production_ready,
        "readiness_warnings": exposed_warnings,
        "warning_count": warnings.len(),
        "service": "neurostore-rust-gateway-v3",
        "version": "0.3.0",
        "environment": state.environment,
    }))
}

async fn security_headers(
    request: Request,
    next: Next,
) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        "x-frame-options",
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        "referrer-policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(
        "permissions-policy",
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    headers.insert(
        "content-security-policy",
        HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"),
    );
    response
}

/// Per-IP rate limiter using a moka cache with 60-second TTL.
/// Limits each IP to 200 requests per minute.
static RATE_LIMIT_CACHE: std::sync::LazyLock<moka::future::Cache<String, u32>> =
    std::sync::LazyLock::new(|| {
        moka::future::Cache::builder()
            .time_to_live(std::time::Duration::from_secs(60))
            .max_capacity(100_000)
            .build()
    });

const MAX_REQUESTS_PER_MINUTE: u32 = 200;

async fn rate_limit(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let client_ip = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| {
            request
                .headers()
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "127.0.0.1".to_string());

    let count = RATE_LIMIT_CACHE.get(&client_ip).await.unwrap_or(0);

    if count >= MAX_REQUESTS_PER_MINUTE {
        return (
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            "Rate limit exceeded. Try again in 60 seconds.",
        )
            .into_response();
    }

    RATE_LIMIT_CACHE.insert(client_ip, count + 1).await;
    next.run(request).await
}

fn parse_allowed_origins() -> Vec<HeaderValue> {
    let raw = std::env::var("ALLOWED_ORIGINS").unwrap_or_else(|_| {
        "https://neurostore-next.vercel.app,https://neurostore-next-production.up.railway.app,http://localhost:5173".to_string()
    });

    let mut parsed = Vec::new();
    for origin in raw.split(',').map(|v| v.trim()).filter(|v| !v.is_empty()) {
        match origin.parse::<HeaderValue>() {
            Ok(value) => parsed.push(value),
            Err(_) => tracing::warn!("Ignoring invalid origin in ALLOWED_ORIGINS: {}", origin),
        }
    }

    if parsed.is_empty() {
        tracing::warn!("ALLOWED_ORIGINS produced no valid origins, falling back to localhost-only");
        parsed.push("http://localhost:5173".parse().unwrap());
    }

    parsed
}

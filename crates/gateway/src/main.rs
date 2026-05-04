use crate::p2p::SwarmRequest;
use axum::{
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode},
    middleware::{from_fn, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use sqlx::postgres::PgPoolOptions;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::sync::RwLock;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::ServeDir;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

use moka::future::Cache;

pub mod erasure;
pub mod handlers;
pub mod models;
pub mod p2p;

pub mod crypto;
pub mod geofence;
pub mod intelligence;
pub mod proofs;
pub mod repair;

#[derive(Debug, Clone)]
pub struct HeartbeatCacheEntry {
    pub node_id: String,
    pub status: String,
    pub os: String,
    pub version: String,
    pub shard_count: i32,
    pub used_gb: f64,
    pub max_gb: f64,
    pub free_gb: f64,
    pub uptime_minutes: f64,
    pub cpu_usage_percent: f64,
    pub memory_usage_percent: f64,
    pub persisted_total_earned_inr: f64,
    pub pending_earnings_inr: f64,
    pub last_heartbeat_at: chrono::DateTime<chrono::Utc>,
    pub dirty: bool,
    pub hostname: Option<String>,
    pub device_fingerprint: Option<String>,
    pub mac_address: Option<String>,
    pub ip_address: Option<String>,
    pub ingress_url: Option<String>,
}

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
    pub heartbeat_buffer: RwLock<HashMap<String, HeartbeatCacheEntry>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok(); // Load .env if present

    // Initialize tracing
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::DEBUG)
        .finish();
    tracing::subscriber::set_global_default(subscriber).expect("setting default subscriber failed");

    // Connect to PostgreSQL with retry logic (Railway may start DB after gateway)
    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL environment variable is required");

    info!("Connecting to PostgreSQL...");

    let mut pool_result = None;
    for attempt in 1..=5u32 {
        match PgPoolOptions::new()
            .max_connections(250)
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
                tracing::warn!(
                    "DB connection attempt {} failed: {}. Retrying in {}s...",
                    attempt,
                    e,
                    wait
                );
                tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
            }
        }
    }
    let pool = pool_result.expect("Failed to connect to PostgreSQL after 5 attempts");

    // Run Migrations (Ensuring production schema is provisioned)
    sqlx::migrate!("./migrations").run(&pool).await?;

    // Phase 10: Ignite the LibP2P Swarm Network (non-fatal on cloud platforms)
    let (p2p_tx, p2p_rx) = mpsc::channel(10000);
    let geo_manager = geofence::GeoFenceManager::new();

    match p2p::P2pNode::new().await {
        Ok(mut swarm_node) => {
            let geo_manager_clone = geofence::GeoFenceManager::new();
            let db_for_p2p = pool.clone();
            tokio::spawn(async move {
                info!("Igniting LibP2P Kademlia DHT Swarm...");
                if let Err(e) = swarm_node
                    .start(9010, p2p_rx, geo_manager_clone, db_for_p2p)
                    .await
                {
                    tracing::error!("P2P Swarm error: {}", e);
                }
            });
        }
        Err(e) => {
            tracing::warn!(
                "P2P Swarm disabled (cloud mode): {}. HTTP API will still function.",
                e
            );
            // Drain the rx channel so senders don't block
            tokio::spawn(async move {
                let mut rx = p2p_rx;
                while rx.recv().await.is_some() {}
            });
        }
    }

    fn env_or_random(name: &str) -> String {
        std::env::var(name).unwrap_or_else(|_| {
            let val: String = (0..32)
                .map(|_| format!("{:02x}", rand::random::<u8>()))
                .collect();
            tracing::warn!(
                "{} not set — using generated default. Set this in production!",
                name
            );
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
        heartbeat_buffer: RwLock::new(HashMap::new()),
    });

    // Phase 11: Ignite the Cryptographic Proof of Spacetime (PoSt) Daemon
    let post_daemon = proofs::ProofOfSpacetimeDaemon::new(Arc::clone(&shared_state));
    tokio::spawn(async move {
        post_daemon.start().await;
    });

    // Auto-bootstrap admin user if env var is provided
    if let Ok(admin_password) = std::env::var("ADMIN_PASSWORD") {
        let pool_clone = shared_state.db.clone();
        tokio::spawn(async move {
            let email = "janushsahni24@gmail.com";
            let existing: Option<i64> = sqlx::query_scalar("SELECT 1 FROM users WHERE email = $1")
                .bind(email)
                .fetch_optional(&pool_clone)
                .await
                .unwrap_or(None);

            if existing.is_none() {
                let password_hash = tokio::task::spawn_blocking(move || {
                    use argon2::{password_hash::{rand_core::OsRng, SaltString}, Argon2, PasswordHasher};
                    let salt = SaltString::generate(&mut OsRng);
                    let argon2 = Argon2::default();
                    argon2.hash_password(admin_password.as_bytes(), &salt).map(|h| h.to_string()).unwrap_or_default()
                }).await.unwrap_or_default();

                if !password_hash.is_empty() {
                    let _ = sqlx::query("INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)")
                        .bind(email)
                        .bind(&password_hash)
                        .bind("System Admin")
                        .execute(&pool_clone)
                        .await;
                    tracing::info!("Bootstrapped admin user from environment variable");
                }
            }
        });
    }

    // Phase 18: Ignite the Automated Data Repair Daemon (Self-Healing Swarm)
    let repair_daemon = repair::RepairDaemon::new(Arc::clone(&shared_state));
    tokio::spawn(async move {
        repair_daemon.start().await;
    });

    // Phase 19: Ignite the AI Intelligence Engine (Trust Scoring & Fake Node Detection)
    let intel_engine = intelligence::IntelligenceEngine::new(Arc::clone(&shared_state));
    tokio::spawn(async move {
        intel_engine.start().await;
    });

    let heartbeat_state = Arc::clone(&shared_state);
    tokio::spawn(async move {
        handlers::nodes::heartbeat_flush_daemon(heartbeat_state).await;
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
            "x-neuro-client-manifest".parse().unwrap(),
        ])
        .expose_headers([axum::http::header::CONTENT_TYPE])
        .allow_credentials(true);

    // Build the Axum Router
    let api_routes = Router::new()
        .route("/health", get(health_check))
        .route("/register", post(handlers::auth::register))
        .route("/login", post(handlers::auth::login))
        .route("/logout", post(handlers::auth::logout))
        .route("/session", get(handlers::auth::session))
        .route("/auth/escrow", post(handlers::auth::setup_escrow))
        .route("/auth/recovery-kit", get(handlers::auth::get_recovery_kit).post(handlers::auth::setup_escrow))
        .route("/auth/recovery-kit/public", get(handlers::auth::get_recovery_kit_public))
        .route("/auth/sso/saml", post(handlers::auth::sso_saml_login))
        .route("/auth/sso/oauth", post(handlers::auth::sso_oauth_login))
        .route("/auth/google/login", get(handlers::oauth::google_login))
        .route("/auth/google/callback", get(handlers::oauth::google_callback))
        .route("/admin/controls", get(handlers::admin::get_controls).post(handlers::admin::patch_controls))
        .route("/downloads/node/:os/:arch", get(|axum::extract::Path((os, arch)): axum::extract::Path<(String, String)>| async move { handlers::downloads::proxy_node_download(axum::extract::Path((os, arch))).await }))
        .route("/manifest/:bucket/*key", get(handlers::s3::get_presigned_manifest))
        .route("/downloads/plan/:bucket/*key", get(handlers::s3::plan_download))
        .route("/uploads/plan/:bucket/*key", post(handlers::s3::plan_upload))
        .route("/uploads/direct/commit/:bucket/*key", post(handlers::s3::commit_direct_upload))
        .route("/client-manifest/:bucket/*key", post(handlers::s3::put_client_manifest))
        .route("/deduplicate/:bucket/*key", post(handlers::s3::deduplicate_object))
        .route("/object/rename/:bucket/*key", post(handlers::s3::rename_object))
        .route("/reconstruct/:bucket/*key", post(handlers::s3::reconstruct_metadata))
        .route("/object/shards/:bucket/*key", get(handlers::s3::get_object_shards))
        .route("/compliance/sovereignty/:bucket", get(handlers::compliance::sovereignty_audit))
        .route("/nodes/register", post(handlers::nodes::register_provider_node))
        .route("/node/register", post(handlers::nodes::register_provider_node))
        .route("/node/heartbeat", post(handlers::nodes::node_heartbeat))
        .route("/nodes/heartbeat", post(handlers::nodes::node_heartbeat))
        .route("/nodes/stats", get(handlers::nodes::network_stats))
        .route("/nodes/explorer", get(handlers::nodes::list_public_nodes))
        .route("/node/:node_id/earnings", get(handlers::nodes::node_earnings))
        .route("/node/:node_id/status", get(handlers::nodes::node_status))
        .route("/admin/inventory", get(handlers::nodes::get_admin_inventory))
        .route("/my/nodes", get(handlers::nodes::my_nodes))
        .route("/node/:node_id/wallet", axum::routing::put(handlers::nodes::update_node_wallet))
        .route("/node/claim", post(handlers::nodes::claim_node))
        .route("/webhooks", post(handlers::webhooks::register_webhook))
        .route("/webhooks/:bucket", get(handlers::webhooks::list_webhooks))
        .route("/pii/scan/:bucket/*key", post(handlers::features::scan_object_pii))
        .route("/pii/scan-text", post(handlers::features::scan_text_pii))
        .route("/versions/:bucket/*key", get(handlers::features::list_versions))
        .route("/worm/configure", post(handlers::features::configure_worm))
        .route("/ai/auto-tag/:bucket/*key", post(handlers::features::auto_tag_object))
        .route("/ai/search", post(handlers::features::ai_semantic_search))
        .route("/ai/hot-objects", get(handlers::features::hot_objects))
        .route("/ai/trust-scores", get(get_trust_scores))
        .route("/billing/usage", get(handlers::features::get_usage_summary));

    let app = Router::new()
        .route("/readyz", get(health_check))
        .nest("/api", api_routes)
        // Legacy Auth compatibility
        .route("/auth/register", post(handlers::auth::register))
        .route("/auth/login", post(handlers::auth::login))
        .route("/auth/logout", post(handlers::auth::logout))
        .route("/auth/session", get(handlers::auth::session))
        // ZK Storage (Separate prefix to avoid S3 overlap)
        .route("/zk/store/:bucket/*key", post(handlers::zk::zk_store))
        .route("/zk/issue-challenge", post(proofs::issue_zk_challenge))
        .route("/zk/submit-proof", post(proofs::verify_zk_proof))
        // S3-Compatible API (Path Style) - Moved to bottom to prevent shadowing
        // We exclude /api from the bucket match in the handler if needed,
        // but Axum precedence will now favor the nested /api router.
        .route("/:bucket", get(handlers::s3::list_objects))
        .route(
            "/:bucket/*key",
            get(handlers::s3::get_object)
                .put(handlers::s3::put_object)
                .delete(handlers::s3::delete_object),
        )
        .fallback_service(ServeDir::new("public"))
        .layer(cors)
        .layer(from_fn(request_id_middleware))
        .layer(from_fn(security_headers))
        .layer(from_fn(emergency_controls))
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
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}

async fn health_check(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
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
    if crate::handlers::auth::configured_admin_emails().is_empty() {
        warnings.push("ADMIN_EMAILS is not configured".to_string());
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
            warnings.push(
                "ALLOWED_ORIGINS contains localhost while ENVIRONMENT=production".to_string(),
            );
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

async fn get_trust_scores(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let rows = sqlx::query(
        r#"
        SELECT node_id, status,
               COALESCE(trust_score, 0.7) as trust_score,
               COALESCE(trust_verdict, 'pending') as trust_verdict,
               COALESCE(trust_anomalies, '[]') as trust_anomalies,
               trust_evaluated_at,
               COALESCE(country_code, 'GLOBAL') as region,
               COALESCE(free_gb, 0) as free_gb,
               uptime_minutes
        FROM node_registry
        WHERE last_heartbeat_at > NOW() - INTERVAL '24 hours'
        ORDER BY trust_score DESC
        "#,
    )
    .fetch_all(&state.db)
    .await;

    match rows {
        Ok(rows) => {
            let nodes: Vec<serde_json::Value> = rows
                .iter()
                .map(|r| {
                    serde_json::json!({
                        "node_id": r.get::<String, _>("node_id"),
                        "status": r.get::<String, _>("status"),
                        "trust_score": r.get::<f64, _>("trust_score"),
                        "trust_verdict": r.get::<String, _>("trust_verdict"),
                        "anomalies": serde_json::from_str::<serde_json::Value>(
                            &r.get::<String, _>("trust_anomalies")
                        ).unwrap_or(serde_json::json!([])),
                        "region": r.get::<String, _>("region"),
                        "free_gb": r.get::<f64, _>("free_gb"),
                        "uptime_minutes": r.get::<Option<f64>, _>("uptime_minutes"),
                        "evaluated_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("trust_evaluated_at"),
                    })
                })
                .collect();

            let quarantined = nodes.iter().filter(|n| n["trust_verdict"] == "quarantined").count();
            let warned = nodes.iter().filter(|n| n["trust_verdict"] == "warning").count();

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "engine": "neurostore-intelligence-v1",
                    "total_nodes": nodes.len(),
                    "trusted": nodes.len() - quarantined - warned,
                    "warned": warned,
                    "quarantined": quarantined,
                    "nodes": nodes,
                })),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Trust score query failed: {}", e),
        )
            .into_response(),
    }
}

async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
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

/// Request ID middleware: assigns a unique UUID to every request for E2E tracing.
/// The ID is propagated in the `x-request-id` response header and logged.
async fn request_id_middleware(request: Request, next: Next) -> Response {
    let request_id = uuid::Uuid::new_v4().to_string();
    let method = request.method().to_string();
    let path = request.uri().path().to_string();

    tracing::info!(
        request_id = %request_id,
        method = %method,
        path = %path,
        "Incoming request"
    );

    let start = std::time::Instant::now();
    let mut response = next.run(request).await;
    let elapsed = start.elapsed();

    // Attach request ID to response for client-side correlation
    if let Ok(v) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert("x-request-id", v);
    }

    // Egress tracking: log response body size for billing
    let status = response.status().as_u16();
    let content_length = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);

    tracing::info!(
        request_id = %request_id,
        status = status,
        elapsed_ms = elapsed.as_millis() as u64,
        egress_bytes = content_length,
        "Request completed"
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

async fn rate_limit(request: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let trust_proxy_headers = std::env::var("TRUST_PROXY_HEADERS")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let client_ip = if trust_proxy_headers {
        request
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
    } else {
        request
            .extensions()
            .get::<axum::extract::ConnectInfo<SocketAddr>>()
            .map(|connect| connect.0.ip().to_string())
    }
    .unwrap_or_else(|| "unknown-client".to_string());

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

async fn emergency_controls(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    tracing::warn!("====== INCOMING REQ: {} {} ======", method, path);

    if path.starts_with("/readyz")
        || path.starts_with("/api/health")
        || path.starts_with("/api/admin/controls")
        || path.starts_with("/api/downloads/node/")
    {
        return next.run(request).await;
    }

    let state = match request.extensions().get::<Arc<AppState>>() {
        Some(state) => Arc::clone(state),
        None => return next.run(request).await,
    };

    let controls = match crate::handlers::admin::load_controls(&state).await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to load emergency controls: {}", e);
            return (StatusCode::SERVICE_UNAVAILABLE, "control plane unavailable").into_response();
        }
    };

    let is_write = matches!(
        method,
        Method::POST | Method::PUT | Method::DELETE | Method::PATCH
    );

    let exempt_write_paths = [
        "/auth/login",
        "/api/login",
        "/auth/register",
        "/api/register",
        "/auth/logout",
        "/api/logout",
        "/api/node/heartbeat",
        "/api/nodes/heartbeat",
        "/zk/submit-proof",
    ];
    let exempt_write = exempt_write_paths.iter().any(|p| path == *p);

    if controls.writes_locked && is_write && !exempt_write {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "writes temporarily disabled by emergency control",
        )
            .into_response();
    }

    if controls.node_admission_locked
        && (path == "/api/nodes/register" || path == "/api/node/register")
    {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "node admission temporarily disabled by emergency control",
        )
            .into_response();
    }

    if controls.payouts_locked && path.contains("/earnings") {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "payout APIs temporarily disabled by emergency control",
        )
            .into_response();
    }

    next.run(request).await
}

fn parse_allowed_origins() -> Vec<HeaderValue> {
    let raw = std::env::var("ALLOWED_ORIGINS").unwrap_or_else(|_| {
        "https://neurostore.vercel.app,https://neurostore-backend-production.up.railway.app,http://localhost:5173".to_string()
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

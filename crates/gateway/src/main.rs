use axum::{
    routing::{get, post},
    Router,
    Json,
};
use tower_http::cors::CorsLayer;
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

    // Connect to PostgreSQL
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL environment variable is required");

    info!("Connecting to PostgreSQL at {}...", database_url);
    
    let pool = PgPoolOptions::new()
        .max_connections(500)
        .connect(&database_url)
        .await?;

    info!("Connected to database.");

    // Run Migrations (Ensuring production schema is provisioned)
    sqlx::migrate!("./migrations").run(&pool).await?;

    // Phase 10: Ignite the LibP2P Swarm Network
    let (p2p_tx, p2p_rx) = mpsc::channel(100);
    let mut swarm_node = p2p::P2pNode::new().await?;
    let geo_manager = geofence::GeoFenceManager::new();
    let geo_manager_clone = geofence::GeoFenceManager::new(); // For the p2p loop
    
    let db_for_p2p = pool.clone();
    tokio::spawn(async move {
        info!("Igniting LibP2P Kademlia DHT Swarm...");
        if let Err(e) = swarm_node.start(9010, p2p_rx, geo_manager_clone, db_for_p2p).await {
            tracing::error!("Fatal P2P Swarm crash: {}", e);
        }
    });

    let metadata_secret = std::env::var("METADATA_SECRET")
        .expect("METADATA_SECRET environment variable is required");
    
    let jwt_secret = std::env::var("JWT_SECRET")
        .expect("JWT_SECRET environment variable is required");

    let metadata_protector = crypto::MetadataProtector::new(&metadata_secret);

    let edge_cache: Cache<String, axum::body::Bytes> = Cache::new(10_000);

    let shared_state = Arc::new(AppState { 
        db: pool, 
        p2p_tx, 
        edge_cache,
        geo: geo_manager,
        metadata_protector,
        jwt_secret,
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

    let cors = CorsLayer::new()
        .allow_origin([
            "https://neurostore-next.vercel.app".parse().unwrap(),
            "https://neurostore-next-production.up.railway.app".parse().unwrap(),
            "http://localhost:5173".parse().unwrap(), // Local Dev
        ])
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::DELETE,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
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
        
        // S3-Compatible API (Path Style)
        .route("/:bucket", get(handlers::s3::list_objects))
        .route("/:bucket/*key", 
            get(handlers::s3::get_object)
            .put(handlers::s3::put_object)
            .delete(handlers::s3::delete_object)
        )
        
        // Internal Extensions
        .route("/api/deduplicate/:bucket/*key", post(handlers::s3::deduplicate_object))
        .route("/api/reconstruct/:bucket/*key", post(handlers::s3::reconstruct_metadata))
        .route("/api/compliance/sovereignty/:bucket", get(handlers::compliance::sovereignty_audit))
        .route("/api/nodes/register", post(handlers::nodes::register_provider_node))
        .route("/zk/store/:bucket/*key", post(handlers::zk::zk_store))
        .route("/zk/submit-proof", post(proofs::verify_zk_proof))
        .layer(cors)
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

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "neurostore-rust-gateway-v3",
        "version": "0.3.0"
    }))
}

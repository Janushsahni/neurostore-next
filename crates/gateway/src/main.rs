use axum::{
    routing::{get, post, put},
    Router,
    Json,
};
use tower_http::cors::{Any, CorsLayer};
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
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::DEBUG)
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .expect("setting default subscriber failed");

    // Connect to PostgreSQL (Spinning up via Docker)
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://neuro_admin:neuro_dev_password_2026@localhost:5432/neurostore_production".to_string());

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
        .unwrap_or_else(|_| "neurostore_fallback_v9_secret_key_2026".to_string());
    
    let metadata_protector = crypto::MetadataProtector::new(&metadata_secret);

    let edge_cache: Cache<String, axum::body::Bytes> = Cache::new(10_000);

    let shared_state = Arc::new(AppState { 
        db: pool, 
        p2p_tx, 
        edge_cache,
        geo: geo_manager,
        metadata_protector,
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
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
        .expose_headers(Any);

    // Build the Axum Router
    let app = Router::new()
        .route("/readyz", get(health_check))
        .route("/auth/register", post(handlers::auth::register))
        .route("/auth/login", post(handlers::auth::login))
        .route("/s3/:bucket", get(handlers::s3::list_objects))
        .route("/s3/:bucket/:key", put(handlers::s3::put_object))
        .route("/s3/:bucket/:key", get(handlers::s3::get_object))
        .route("/s3/deduplicate/:bucket/:key", post(handlers::s3::deduplicate_object))
        .route("/zk/store/:bucket/:key", post(handlers::zk::zk_store))
        .route("/zk/submit-proof", post(proofs::verify_zk_proof))
        .layer(cors)
        .with_state(shared_state);

    // Bind server
    let port = 9009; // Replacing the Node.js port
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

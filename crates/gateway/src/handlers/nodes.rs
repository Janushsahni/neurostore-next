use axum::{
    extract::State,
    http::HeaderMap,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use crate::AppState;

#[derive(Deserialize)]
pub struct NodeRegisterRequest {
    pub peer_id: String,
    pub wallet_address: String,
    pub capacity_gb: i64,
    pub declared_location: String, // e.g. "IN-KA" (Karnataka, India)
    pub latency_ms: Option<f64>, // Provided by P2P ping metric or client header
}

#[derive(Serialize)]
pub struct NodeRegisterResponse {
    pub status: String,
    pub assigned_role: String,
    pub min_stake_required: u64,
}

pub async fn register_provider_node(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<NodeRegisterRequest>,
) -> impl IntoResponse {
    let provided_secret = headers
        .get("x-node-secret")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();

    if provided_secret.is_empty() || provided_secret != state.node_shared_secret {
        return (StatusCode::UNAUTHORIZED, "Unauthorized node registration").into_response();
    }

    if !is_valid_peer_id(&payload.peer_id) {
        return (StatusCode::BAD_REQUEST, "Invalid peer_id").into_response();
    }
    if !is_valid_wallet_address(&payload.wallet_address) {
        return (StatusCode::BAD_REQUEST, "Invalid wallet_address").into_response();
    }
    if payload.capacity_gb <= 0 || payload.capacity_gb > 100_000 {
        return (StatusCode::BAD_REQUEST, "capacity_gb must be between 1 and 100000").into_response();
    }
    if !is_valid_declared_location(&payload.declared_location) {
        return (StatusCode::BAD_REQUEST, "declared_location must use ISO-style format (e.g. IN-KA)").into_response();
    }

    // ── GEOFENCE & LATENCY TETHER VALIDATION ──
    let country_code = payload.declared_location.split('-').next().unwrap_or("XX");
    if let Some(rtt) = payload.latency_ms {
        if !state.geo.validate_tether(country_code, rtt) {
            tracing::warn!("IP Spoofing Detected: Node {} claimed {}, but RTT is {}ms", payload.peer_id, country_code, rtt);
            return (StatusCode::FORBIDDEN, "Latency Tether Validation Failed: Physical distance does not match declared location.").into_response();
        }
    }

    // ── COLLATERAL STAKING (SYBIL PREVENTION) ──
    // Nodes are created as INACTIVE by default. A separate worker or smart contract listener
    // must verify their NeuroToken stake before they are marked as active and receive data.
    let res = sqlx::query(
        r#"
        INSERT INTO nodes (peer_id, wallet_address, storage_capacity_gb, country_code, is_active)
        VALUES ($1, $2, $3, $4, FALSE)
        ON CONFLICT (peer_id) DO UPDATE SET
            storage_capacity_gb = excluded.storage_capacity_gb,
            last_seen = CURRENT_TIMESTAMP
        "#
    )
    .bind(&payload.peer_id)
    .bind(&payload.wallet_address)
    .bind(payload.capacity_gb)
    .bind(&payload.declared_location)
    .execute(&state.db)
    .await;

    match res {
        Ok(_) => {
            tracing::info!("NEW PROVIDER JOINED (PENDING STAKE): {} from {}", payload.peer_id, payload.declared_location);
            // Example economics: 10 NeuroTokens required per GB of capacity.
            let required_stake = (payload.capacity_gb as u64) * 10;
            
            (StatusCode::OK, Json(NodeRegisterResponse {
                status: "Registered. Awaiting Collateral Stake.".to_string(),
                assigned_role: "StorageProvider".to_string(),
                min_stake_required: required_stake,
            })).into_response()
        },
        Err(e) => {
            tracing::error!("Node registration failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Registration DB Error").into_response()
        }
    }
}

fn is_valid_peer_id(value: &str) -> bool {
    if value.len() < 10 || value.len() > 128 {
        return false;
    }
    value
        .chars()
        .all(|c| c.is_ascii_alphanumeric())
}

fn is_valid_wallet_address(value: &str) -> bool {
    if value.len() != 42 || !value.starts_with("0x") {
        return false;
    }
    value[2..].chars().all(|c| c.is_ascii_hexdigit())
}

fn is_valid_declared_location(value: &str) -> bool {
    let mut parts = value.split('-');
    let country = parts.next().unwrap_or_default();
    if country.len() != 2 || !country.chars().all(|c| c.is_ascii_uppercase()) {
        return false;
    }
    if let Some(region) = parts.next() {
        if region.len() < 2 || region.len() > 8 {
            return false;
        }
        if !region.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
            return false;
        }
    }
    parts.next().is_none()
}

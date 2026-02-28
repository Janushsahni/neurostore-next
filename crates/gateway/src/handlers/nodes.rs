use axum::{
    extract::State,
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
}

#[derive(Serialize)]
pub struct NodeRegisterResponse {
    pub status: String,
    pub assigned_role: String,
    pub min_stake_required: u64,
}

pub async fn register_provider_node(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<NodeRegisterRequest>,
) -> impl IntoResponse {
    // 1. Verify Node PeerID through P2P Swarm
    // 2. Validate IP Jurisdiction (Ensure it's actually in India)
    
    let res = sqlx::query(
        r#"
        INSERT INTO nodes (peer_id, wallet_address, storage_capacity_gb, country_code, is_active)
        VALUES ($1, $2, $3, $4, TRUE)
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
            tracing::info!("NEW PROVIDER JOINED: {} from {}", payload.peer_id, payload.declared_location);
            (StatusCode::OK, Json(NodeRegisterResponse {
                status: "Registered. Awaiting Collateral Stake.".to_string(),
                assigned_role: "StorageProvider".to_string(),
                min_stake_required: 1000,
            })).into_response()
        },
        Err(e) => {
            tracing::error!("Node registration failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Registration DB Error").into_response()
        }
    }
}

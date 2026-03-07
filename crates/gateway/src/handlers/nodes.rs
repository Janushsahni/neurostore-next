use axum::{
    extract::State,
    http::HeaderMap,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use crate::AppState;

type HmacSha256 = Hmac<Sha256>;

#[derive(Deserialize)]
pub struct NodeRegisterRequest {
    pub peer_id: String,
    pub wallet_address: String,
    pub capacity_gb: i64,
    pub declared_location: String, // e.g. "IN-KA" (Karnataka, India)
    pub latency_ms: Option<f64>, // Provided by P2P ping metric or client header
    pub build_digest: Option<String>,
    pub build_signature: Option<String>,
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
    if let Err(err) = verify_node_build(&payload.peer_id, payload.build_digest.as_deref(), payload.build_signature.as_deref()) {
        return err.into_response();
    }

    let provided_secret = headers
        .get("x-node-secret")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();

    // SECURITY: Use constant-time comparison to prevent timing attacks
    let secrets_match = provided_secret.as_bytes().ct_eq(state.node_shared_secret.as_bytes());
    if provided_secret.is_empty() || !bool::from(secrets_match) {
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

    let controls = match crate::handlers::admin::load_controls(&state).await {
        Ok(c) => c,
        Err(_) => {
            return (StatusCode::SERVICE_UNAVAILABLE, "control plane unavailable").into_response();
        }
    };

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
            is_active = CASE WHEN $5 THEN FALSE ELSE nodes.is_active END,
            last_seen = CURRENT_TIMESTAMP
        "#
    )
    .bind(&payload.peer_id)
    .bind(&payload.wallet_address)
    .bind(payload.capacity_gb)
    .bind(&payload.declared_location)
    .bind(controls.quarantine_new_nodes)
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

// ═══════════════════════════════════════════════════════
// NODE HEARTBEAT, STATS & EARNINGS (₹ INR)
// ═══════════════════════════════════════════════════════

// Earning rate: ₹0.42/GB/month = ₹0.000009722/GB/second
const INR_PER_GB_PER_SECOND: f64 = 0.000009722;

#[derive(Deserialize)]
pub struct HeartbeatRequest {
    pub node_id: String,
    pub status: Option<String>,
    pub shard_count: Option<i32>,
    pub used_gb: Option<f64>,
    pub max_gb: Option<f64>,
    pub free_gb: Option<f64>,
    pub uptime_min: Option<f64>,
    pub version: Option<String>,
    pub os: Option<String>,
    pub os_version: Option<String>,
    pub timestamp: Option<String>,
    pub build_digest: Option<String>,
    pub build_signature: Option<String>,
}

/// POST /api/node/heartbeat — Nodes send this every 45 seconds
pub async fn node_heartbeat(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<HeartbeatRequest>,
) -> impl IntoResponse {
    if let Err(err) = verify_node_build(&payload.node_id, payload.build_digest.as_deref(), payload.build_signature.as_deref()) {
        return err.into_response();
    }

    if payload.node_id.is_empty() || payload.node_id.len() > 64 {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "invalid node_id" }))).into_response();
    }

    let used_gb = payload.used_gb.unwrap_or(0.0).max(0.0);
    let max_gb = payload.max_gb.unwrap_or(50.0).max(0.0);
    let free_gb = payload.free_gb.unwrap_or(0.0).max(0.0);
    let uptime_min = payload.uptime_min.unwrap_or(0.0).max(0.0);
    let shard_count = payload.shard_count.unwrap_or(0).max(0);
    let version = payload.version.as_deref().unwrap_or("1.0.0");
    let os = payload.os.as_deref().unwrap_or("Unknown");
    let status = payload.status.as_deref().unwrap_or("online");

    // Upsert node into registry
    let upsert_result = sqlx::query(
        r#"
        INSERT INTO node_registry (
            node_id, status, os, version, shard_count,
            used_gb, max_gb, free_gb, uptime_minutes, last_heartbeat_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (node_id) DO UPDATE SET
            status = excluded.status,
            os = excluded.os,
            version = excluded.version,
            shard_count = excluded.shard_count,
            used_gb = excluded.used_gb,
            max_gb = excluded.max_gb,
            free_gb = excluded.free_gb,
            uptime_minutes = excluded.uptime_minutes,
            last_heartbeat_at = NOW()
        "#
    )
    .bind(&payload.node_id)
    .bind(status)
    .bind(os)
    .bind(version)
    .bind(shard_count)
    .bind(used_gb)
    .bind(max_gb)
    .bind(free_gb)
    .bind(uptime_min)
    .execute(&state.db)
    .await;

    if let Err(e) = upsert_result {
        tracing::error!("Heartbeat DB error: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "db error" }))).into_response();
    }

    let payouts_locked = crate::handlers::admin::load_controls(&state)
        .await
        .map(|c| c.payouts_locked)
        .unwrap_or(false);

    // Calculate earnings for this heartbeat interval (45 seconds)
    let heartbeat_interval_secs: f64 = 45.0;
    let earnings_inr = used_gb * INR_PER_GB_PER_SECOND * heartbeat_interval_secs;

    if earnings_inr > 0.0 && !payouts_locked {
        let _ = sqlx::query(
            "INSERT INTO node_earnings (node_id, amount_inr, reason) VALUES ($1, $2, 'uptime_reward')"
        )
        .bind(&payload.node_id)
        .bind(earnings_inr)
        .execute(&state.db)
        .await;

        let _ = sqlx::query(
            "UPDATE node_registry SET total_earned_inr = total_earned_inr + $1 WHERE node_id = $2"
        )
        .bind(earnings_inr)
        .bind(&payload.node_id)
        .execute(&state.db)
        .await;
    }

    // Fetch total earned
    let total_earned: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT COALESCE(total_earned_inr, 0) FROM node_registry WHERE node_id = $1"
    )
    .bind(&payload.node_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0.0);

    (StatusCode::OK, Json(serde_json::json!({
        "status": "ack",
        "earned_this_heartbeat_inr": format!("{:.4}", if payouts_locked { 0.0 } else { earnings_inr }),
        "total_earned_inr": format!("{:.2}", total_earned),
        "pending_shards": serde_json::Value::Null,
        "payouts_locked": payouts_locked,
    }))).into_response()
}

fn verify_node_build(
    node_id: &str,
    build_digest: Option<&str>,
    build_signature: Option<&str>,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let signing_secret = std::env::var("NODE_BINARY_SIGNING_SECRET").unwrap_or_default();
    if signing_secret.is_empty() {
        return Ok(());
    }

    let digest = build_digest.unwrap_or_default();
    let signature = build_signature.unwrap_or_default();
    if digest.is_empty() || signature.is_empty() {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "signed node build required" })),
        ));
    }
    if digest.len() != 64 || !digest.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid build_digest" })),
        ));
    }

    let mut mac = <HmacSha256 as Mac>::new_from_slice(signing_secret.as_bytes())
        .expect("valid hmac key");
    mac.update(node_id.as_bytes());
    mac.update(b":");
    mac.update(digest.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());

    if bool::from(expected.as_bytes().ct_eq(signature.as_bytes())) {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "node build signature verification failed" })),
        ))
    }
}

/// GET /api/nodes/stats — Network-wide statistics (public)
pub async fn network_stats(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    // Total nodes (all time)
    let total_nodes: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM node_registry"
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    // Active nodes (heartbeat within last 2 minutes)
    let active_nodes: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM node_registry WHERE last_heartbeat_at > NOW() - INTERVAL '2 minutes'"
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    // Total storage contributed
    let total_storage_gb: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT COALESCE(SUM(max_gb), 0) FROM node_registry WHERE last_heartbeat_at > NOW() - INTERVAL '2 minutes'"
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0.0);

    // Total storage used
    let used_storage_gb: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT COALESCE(SUM(used_gb), 0) FROM node_registry WHERE last_heartbeat_at > NOW() - INTERVAL '2 minutes'"
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0.0);

    // Total shards hosted
    let total_shards: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(shard_count::bigint), 0) FROM node_registry WHERE last_heartbeat_at > NOW() - INTERVAL '2 minutes'"
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    // Total earnings paid out
    let total_earnings_inr: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT COALESCE(SUM(total_earned_inr), 0) FROM node_registry"
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0.0);

    // Top nodes (by earnings)
    let top_nodes = sqlx::query_as::<_, (String, f64, i32, f64, String)>(
        r#"SELECT node_id, total_earned_inr, shard_count, used_gb, 
           CASE WHEN last_heartbeat_at > NOW() - INTERVAL '2 minutes' THEN 'online' ELSE 'offline' END as status
           FROM node_registry ORDER BY total_earned_inr DESC LIMIT 10"#
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let top_nodes_json: Vec<serde_json::Value> = top_nodes
        .iter()
        .map(|(id, earned, shards, used, status)| {
            serde_json::json!({
                "node_id": id,
                "earned_inr": format!("{:.2}", earned),
                "shard_count": shards,
                "used_gb": format!("{:.3}", used),
                "status": status,
            })
        })
        .collect();

    (StatusCode::OK, Json(serde_json::json!({
        "total_nodes": total_nodes,
        "active_nodes": active_nodes,
        "total_storage_gb": format!("{:.1}", total_storage_gb),
        "used_storage_gb": format!("{:.3}", used_storage_gb),
        "total_shards": total_shards,
        "total_earnings_paid_inr": format!("{:.2}", total_earnings_inr),
        "earning_rate_inr_per_gb_month": "0.42",
        "top_nodes": top_nodes_json,
    }))).into_response()
}

/// GET /api/node/:id/earnings — Individual node earnings history
pub async fn node_earnings(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(node_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    if node_id.is_empty() || node_id.len() > 64 {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "invalid node_id" }))).into_response();
    }

    // Fetch node info
    let node = sqlx::query_as::<_, (String, String, i32, f64, f64, f64, f64)>(
        r#"SELECT node_id, status, shard_count, used_gb, max_gb, total_earned_inr, uptime_minutes 
           FROM node_registry WHERE node_id = $1"#
    )
    .bind(&node_id)
    .fetch_optional(&state.db)
    .await;

    let Some(node) = node.ok().flatten() else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "node not found" }))).into_response();
    };

    // Fetch recent earnings (last 50)
    let earnings = sqlx::query_as::<_, (f64, String, String)>(
        "SELECT amount_inr, reason, created_at::text FROM node_earnings WHERE node_id = $1 ORDER BY created_at DESC LIMIT 50"
    )
    .bind(&node_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let earnings_json: Vec<serde_json::Value> = earnings
        .iter()
        .map(|(amount, reason, ts)| {
            serde_json::json!({
                "amount_inr": format!("{:.4}", amount),
                "reason": reason,
                "timestamp": ts,
            })
        })
        .collect();

    // Monthly projection
    let monthly_projection = node.3 * 0.42; // used_gb * ₹0.42/GB/month

    (StatusCode::OK, Json(serde_json::json!({
        "node_id": node.0,
        "status": node.1,
        "shard_count": node.2,
        "used_gb": format!("{:.3}", node.3),
        "max_gb": format!("{:.1}", node.4),
        "total_earned_inr": format!("{:.2}", node.5),
        "uptime_minutes": format!("{:.1}", node.6),
        "monthly_projection_inr": format!("{:.2}", monthly_projection),
        "recent_earnings": earnings_json,
    }))).into_response()
}


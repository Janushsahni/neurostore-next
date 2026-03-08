use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use subtle::ConstantTimeEq;

use crate::AppState;

#[derive(Debug, Serialize)]
pub struct ControlSnapshot {
    pub writes_locked: bool,
    pub node_admission_locked: bool,
    pub payouts_locked: bool,
    pub quarantine_new_nodes: bool,
}

#[derive(Debug, Deserialize)]
pub struct ControlPatch {
    pub writes_locked: Option<bool>,
    pub node_admission_locked: Option<bool>,
    pub payouts_locked: Option<bool>,
    pub quarantine_new_nodes: Option<bool>,
}

fn admin_authorized(headers: &HeaderMap) -> bool {
    let configured = std::env::var("ADMIN_API_TOKEN").unwrap_or_default();
    if configured.is_empty() {
        return false;
    }

    let provided = headers
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    bool::from(provided.as_bytes().ct_eq(configured.as_bytes()))
}

pub async fn get_controls(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !admin_authorized(&headers) {
        return (StatusCode::UNAUTHORIZED, "admin token required").into_response();
    }

    match load_controls(&state).await {
        Ok(snapshot) => (StatusCode::OK, Json(snapshot)).into_response(),
        Err(e) => {
            tracing::error!("Failed to load controls: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "control lookup failed").into_response()
        }
    }
}

pub async fn patch_controls(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<ControlPatch>,
) -> impl IntoResponse {
    if !admin_authorized(&headers) {
        return (StatusCode::UNAUTHORIZED, "admin token required").into_response();
    }

    if let Some(v) = payload.writes_locked {
        if let Err(e) = set_control(&state, "writes_locked", v).await {
            tracing::error!("Failed to update writes_locked: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "control update failed").into_response();
        }
    }
    if let Some(v) = payload.node_admission_locked {
        if let Err(e) = set_control(&state, "node_admission_locked", v).await {
            tracing::error!("Failed to update node_admission_locked: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "control update failed").into_response();
        }
    }
    if let Some(v) = payload.payouts_locked {
        if let Err(e) = set_control(&state, "payouts_locked", v).await {
            tracing::error!("Failed to update payouts_locked: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "control update failed").into_response();
        }
    }
    if let Some(v) = payload.quarantine_new_nodes {
        if let Err(e) = set_control(&state, "quarantine_new_nodes", v).await {
            tracing::error!("Failed to update quarantine_new_nodes: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "control update failed").into_response();
        }
    }

    match load_controls(&state).await {
        Ok(snapshot) => (StatusCode::OK, Json(snapshot)).into_response(),
        Err(e) => {
            tracing::error!("Failed to reload controls: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "control reload failed").into_response()
        }
    }
}

pub async fn load_controls(state: &AppState) -> Result<ControlSnapshot, sqlx::Error> {
    let rows = sqlx::query_as::<_, (String, serde_json::Value)>(
        "SELECT key, value_json FROM system_controls",
    )
    .fetch_all(&state.db)
    .await?;

    let mut snapshot = ControlSnapshot {
        writes_locked: false,
        node_admission_locked: false,
        payouts_locked: false,
        quarantine_new_nodes: false,
    };

    for (key, value) in rows {
        let flag = value.as_bool().unwrap_or(false);
        match key.as_str() {
            "writes_locked" => snapshot.writes_locked = flag,
            "node_admission_locked" => snapshot.node_admission_locked = flag,
            "payouts_locked" => snapshot.payouts_locked = flag,
            "quarantine_new_nodes" => snapshot.quarantine_new_nodes = flag,
            _ => {}
        }
    }

    Ok(snapshot)
}

async fn set_control(state: &AppState, key: &str, value: bool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO system_controls (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET
            value_json = EXCLUDED.value_json,
            updated_at = NOW()
        "#,
    )
    .bind(key)
    .bind(serde_json::json!(value))
    .execute(&state.db)
    .await?;
    Ok(())
}

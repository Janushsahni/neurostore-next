use std::{net::SocketAddr, sync::Arc, time::{SystemTime, UNIX_EPOCH}};

use anyhow::Context;
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, Method, StatusCode},
    response::IntoResponse,
    routing::{get, put},
    Json, Router,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use tower_http::cors::CorsLayer;

use crate::store::SecureBlockStore;

#[derive(Clone)]
struct IngressState {
    store: Arc<SecureBlockStore>,
    peer_id: String,
    secret: String,
}

pub async fn serve_ingress(
    store: Arc<SecureBlockStore>,
    peer_id: String,
    secret: String,
    port: u16,
) -> anyhow::Result<()> {
    let state = IngressState { store, peer_id, secret };
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods([Method::GET, Method::PUT, Method::OPTIONS])
        .allow_headers(tower_http::cors::Any);

    let app = Router::new()
        .route("/v1/shards/:cid", put(put_shard).get(get_shard))
        .route("/healthz", get(|| async { Json(serde_json::json!({ "ok": true })) }))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind ingress port {}", port))?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn put_shard(
    State(state): State<IngressState>,
    Path(cid): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    if let Err(err) = verify_token(&state, &headers, "upload") {
        return err.into_response();
    }
    if body.is_empty() {
        return (StatusCode::BAD_REQUEST, "empty shard").into_response();
    }
    match state.store.save_chunk(&cid, &body) {
        Ok(true) => (StatusCode::OK, Json(serde_json::json!({
            "stored": true,
            "cid": cid,
            "size_bytes": body.len(),
        }))).into_response(),
        Ok(false) => (StatusCode::INSUFFICIENT_STORAGE, "node storage full").into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "failed to store shard").into_response(),
    }
}

async fn get_shard(
    State(state): State<IngressState>,
    Path(cid): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(err) = verify_token(&state, &headers, "download") {
        return err.into_response();
    }
    match state.store.retrieve_chunk(&cid) {
        Ok(Some(bytes)) => (StatusCode::OK, bytes).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "shard not found").into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "failed to read shard").into_response(),
    }
}

fn verify_token(state: &IngressState, headers: &HeaderMap, op: &str) -> Result<(), (StatusCode, &'static str)> {
    let token = headers
        .get("x-neuro-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let scope = headers
        .get("x-neuro-scope")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let exp = headers
        .get("x-neuro-exp")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;

    if token.is_empty() || scope.is_empty() || exp <= now {
        return Err((StatusCode::UNAUTHORIZED, "invalid or expired ingress token"));
    }

    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(state.secret.as_bytes())
        .expect("valid ingress secret");
    mac.update(state.peer_id.as_bytes());
    mac.update(b":");
    mac.update(op.as_bytes());
    mac.update(b":");
    mac.update(scope.as_bytes());
    mac.update(b":");
    mac.update(exp.to_string().as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());
    if subtle::ConstantTimeEq::ct_eq(expected.as_bytes(), token.as_bytes()).into() {
        Ok(())
    } else {
        Err((StatusCode::UNAUTHORIZED, "token verification failed"))
    }
}

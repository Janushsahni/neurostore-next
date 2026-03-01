use axum::{
    extract::{Path, State},
    http::HeaderMap,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;
use serde::Deserialize;
use neuro_protocol::{ChunkCommand, StoreChunkRequest};
use base64::Engine;
use tokio::time::{timeout, Duration};

use crate::AppState;
use crate::p2p::SwarmRequest;

#[derive(Deserialize)]
pub struct ZkPayload {
    pub manifest_root: String,
    pub total_bytes: usize,
    pub chunk_count: usize,
    pub shards: Vec<ZkShardInput>,
}

#[derive(Deserialize)]
pub struct ZkShardInput {
    pub cid: String,
    pub chunk_index: usize,
    pub shard_index: usize,
    pub data_shards: usize,
    pub parity_shards: usize,
    pub bytes: String,
}

pub async fn zk_store(
    State(state): State<Arc<AppState>>,
    Path((bucket, key)): Path<(String, String)>,
    headers: HeaderMap,
    Json(payload): Json<ZkPayload>,
) -> impl IntoResponse {
    if let Err(err) = crate::handlers::s3::validate_csrf(&headers) {
        return err.into_response();
    }
    let user_email = match crate::handlers::s3::validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };
    if let Err(err) = crate::handlers::s3::authorize_bucket(&state, &bucket, &user_email).await {
        return err.into_response();
    }

    let key = key.trim_start_matches('/').to_string();
    let size = payload.total_bytes as i64;
    let etag = format!("\"zk-{}\"", payload.manifest_root);
    let cid = payload.manifest_root.clone();
    let mut shard_placements: Vec<(i32, String, String, String, i64, bool)> = Vec::new();

    tracing::info!("Zero-Knowledge payload received for {}/{}, dispatching {} pre-encrypted shards to DHT", bucket, key, payload.shards.len());

    let shards_count = payload.shards.len() as i32;
    let mut recovery_threshold = 10;

    for shard in payload.shards {
        let decoded_bytes = match base64::engine::general_purpose::STANDARD.decode(&shard.bytes) {
            Ok(b) => b,
            Err(_) => return (StatusCode::BAD_REQUEST, "Invalid Base64 Shard").into_response(),
        };

        recovery_threshold = shard.data_shards as i32;

        // Phase 19 INJECTION POINT - CDN Edge Caching Layer
        // Immediately pin this "hot" shard to the fast RAM memory cache.
        // This allows other clients (or the same client) to pull the shard instantly
        // without orchestrating a 10-node LibP2P Kademlia lookup.
        state.edge_cache.insert(shard.cid.clone(), axum::body::Bytes::from(decoded_bytes.clone())).await;

        let cmd = ChunkCommand::Store(StoreChunkRequest {
            cid: shard.cid.clone(),
            data: decoded_bytes,
        });

        let (tx, rx) = tokio::sync::oneshot::channel();
        if let Err(e) = state.p2p_tx.send(SwarmRequest::Store {
            command: cmd,
            geofence: "".to_string(),
            tx,
        }).await {
            tracing::error!("Failed to route ZK shard to LibP2P Swarm: {}", e);
            return (StatusCode::SERVICE_UNAVAILABLE, "Storage network queue unavailable").into_response();
        }
        let ack = match timeout(Duration::from_secs(10), rx).await {
            Ok(Ok(ack)) => ack,
            _ => return (StatusCode::SERVICE_UNAVAILABLE, "Shard storage acknowledgement failed").into_response(),
        };
        if !ack.stored {
            return (StatusCode::SERVICE_UNAVAILABLE, "Shard storage acknowledgement failed").into_response();
        }
        shard_placements.push((
            shard.shard_index as i32,
            shard.cid.clone(),
            ack.peer_id,
            ack.country_code,
            ack.timestamp_ms as i64,
            ack.signature_valid,
        ));
    }

    let encrypted_key = match state.metadata_protector.encrypt(&key) {
        Ok(k) => k,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Key encryption failed").into_response(),
    };

    let res = sqlx::query(
        r#"
        INSERT INTO objects (bucket, key, etag, cid, shards, recovery_threshold, size, metadata_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (bucket, key) DO UPDATE SET
            etag = excluded.etag,
            cid = excluded.cid,
            size = excluded.size,
            shards = excluded.shards,
            metadata_json = excluded.metadata_json
        "#
    )
    .bind(&bucket)
    .bind(&encrypted_key)
    .bind(&etag)
    .bind(&cid)
    .bind(shards_count)
    .bind(recovery_threshold)
    .bind(size)
    .bind(serde_json::json!({ "zk_enabled": true, "chunk_count": payload.chunk_count }))
    .execute(&state.db)
    .await;

    match res {
        Ok(_) => {
            for (shard_index, shard_cid, peer_id, country_code, receipt_timestamp_ms, receipt_signature_valid) in shard_placements {
                let _ = sqlx::query(
                    r#"
                    INSERT INTO object_shards (
                        object_cid, shard_cid, shard_index, peer_id, country_code,
                        receipt_timestamp_ms, receipt_signature_valid, last_verified_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                    ON CONFLICT (object_cid, shard_index) DO UPDATE SET
                        shard_cid = excluded.shard_cid,
                        peer_id = excluded.peer_id,
                        country_code = excluded.country_code,
                        receipt_timestamp_ms = excluded.receipt_timestamp_ms,
                        receipt_signature_valid = excluded.receipt_signature_valid,
                        last_verified_at = NOW()
                    "#
                )
                .bind(&cid)
                .bind(&shard_cid)
                .bind(shard_index)
                .bind(&peer_id)
                .bind(&country_code)
                .bind(receipt_timestamp_ms)
                .bind(receipt_signature_valid)
                .execute(&state.db)
                .await;
            }
            (StatusCode::OK, "Zero-Knowledge Shards Dispatched").into_response()
        }
        Err(e) => {
            tracing::error!("Failed to register ZK object in DB: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "ZK Object registration failed").into_response()
        }
    }
}

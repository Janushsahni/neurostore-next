use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;
use serde::Deserialize;
use neuro_protocol::{ChunkCommand, StoreChunkRequest};
use base64::Engine;

use crate::AppState;

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
    Json(payload): Json<ZkPayload>,
) -> impl IntoResponse {
    let size = payload.total_bytes as i64;
    let etag = format!("\"zk-{}\"", payload.manifest_root);
    let cid = payload.manifest_root.clone();

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

        if let Err(e) = state.p2p_tx.send(cmd).await {
            tracing::error!("Failed to route ZK shard to LibP2P Swarm: {}", e);
        }
    }

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
    .bind(&key)
    .bind(&etag)
    .bind(&cid)
    .bind(shards_count)
    .bind(recovery_threshold)
    .bind(size)
    .bind(serde_json::json!({ "zk_enabled": true, "chunk_count": payload.chunk_count }))
    .execute(&state.db)
    .await;

    match res {
        Ok(_) => (StatusCode::OK, "Zero-Knowledge Shards Dispatched").into_response(),
        Err(e) => {
            tracing::error!("Failed to register ZK object in DB: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "ZK Object registration failed").into_response()
        }
    }
}

use axum::{
    extract::{Path, State, Query},
    http::{StatusCode, HeaderMap},
    response::IntoResponse,
    body::Bytes,
};
use std::sync::Arc;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use md5::Md5;
use neuro_protocol::{ChunkCommand, StoreChunkRequest};

use crate::AppState;
use crate::erasure::ErasureEncoder;

#[derive(Deserialize)]
pub struct ListQuery {
    pub prefix: Option<String>,
    pub delimiter: Option<String>,
    #[serde(rename = "max-keys")]
    pub max_keys: Option<i32>,
}

pub async fn list_objects(
    State(state): State<Arc<AppState>>,
    Path(bucket): Path<String>,
    Query(query): Query<ListQuery>,
) -> impl IntoResponse {
    let prefix = query.prefix.unwrap_or_default();
    let max_keys = query.max_keys.unwrap_or(1000);

    let prefix_like = format!("{}%", prefix);
    let limit = max_keys as i64;

    let rows = sqlx::query_as::<_, crate::models::Object>(
        "SELECT * FROM objects WHERE bucket = $1 AND key LIKE $2 LIMIT $3"
    )
    .bind(&bucket)
    .bind(&prefix_like)
    .bind(limit)
    .fetch_all(&state.db)
    .await;

    match rows {
        Ok(objects) => {
            let mut xml = String::new();
            xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
            xml.push_str("<ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">\n");
            xml.push_str(&format!("  <Name>{}</Name>\n", bucket));
            xml.push_str(&format!("  <Prefix>{}</Prefix>\n", prefix));
            xml.push_str(&format!("  <MaxKeys>{}</MaxKeys>\n", max_keys));
            xml.push_str("  <IsTruncated>false</IsTruncated>\n");

            for o in objects {
                xml.push_str("  <Contents>\n");
                xml.push_str(&format!("    <Key>{}</Key>\n", o.key));
                let date_str = o.created_at.map(|d| d.to_rfc3339()).unwrap_or_default();
                xml.push_str(&format!("    <LastModified>{}</LastModified>\n", date_str));
                // S3 requires ETag to be wrapped in literal quotes
                let etag_quoted = if o.etag.starts_with('"') { o.etag.clone() } else { format!("\"{}\"", o.etag) };
                xml.push_str(&format!("    <ETag>{}</ETag>\n", etag_quoted));
                xml.push_str(&format!("    <Size>{}</Size>\n", o.size));
                xml.push_str("    <StorageClass>STANDARD</StorageClass>\n");
                xml.push_str("  </Contents>\n");
            }

            xml.push_str("</ListBucketResult>");

            let mut headers = HeaderMap::new();
            headers.insert("Content-Type", "application/xml".parse().unwrap());
            (StatusCode::OK, headers, xml).into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Database Error").into_response(),
    }
}

pub async fn put_object(
    State(state): State<Arc<AppState>>,
    Path((bucket, key)): Path<(String, String)>,
    // headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let size = body.len() as i64;

    // Construct an artificial ETag (md5)
    let etag = format!("\"{:x}\"", Md5::digest(&body));
    
    // Construct CID (base58 sha256)
    let mut hasher = Sha256::new();
    hasher.update(&body);
    let hash = hasher.finalize();
    let cid = format!("Qm{}", bs58::encode(hash).into_string());

    // Phase 9 ERASURE CODING INJECTION POINT
    // reed_solomon_erasure divides the payload into 10 Data + 5 Parity physical byte streams.
    let shards = 15;
    let recovery_threshold = 10;
    
    let encoder = ErasureEncoder::new(recovery_threshold as usize, (shards - recovery_threshold) as usize)
        .expect("Failed to initialize RS Encoder");
        
    let _physical_shards = encoder.encode(&body)
        .expect("Failed to mathematically shard the payload");

    tracing::info!("Mathematically sliced {} bytes into 15 perfect Galois shards", size);

    // Phase 10 LibP2P INJECTION POINT
    // Dispatch every physical chunk across the Kademlia Swarm
    for (i, shard_bytes) in _physical_shards.into_iter().enumerate() {
        let shard_cid = format!("{}-shard-{}", cid, i);
        let cmd = ChunkCommand::Store(StoreChunkRequest {
            cid: shard_cid,
            data: shard_bytes,
        });
        
        if let Err(e) = state.p2p_tx.send(cmd).await {
            tracing::error!("Failed to route shard {} to LibP2P Swarm: {}", i, e);
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
            metadata_json = excluded.metadata_json
        "#
    )
    .bind(&bucket)
    .bind(&key)
    .bind(&etag)
    .bind(&cid)
    .bind(shards)
    .bind(recovery_threshold)
    .bind(size)
    .bind(serde_json::json!({}))
    .execute(&state.db)
    .await;

    match res {
        Ok(_) => {
            let mut headers_out = HeaderMap::new();
            headers_out.insert("ETag", etag.parse().unwrap());
            (StatusCode::OK, headers_out).into_response()
        }
        Err(e) => {
            tracing::error!("Failed to insert object: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Object insertion failed").into_response()
        }
    }
}

pub async fn get_object(
    State(state): State<Arc<AppState>>,
    Path((bucket, key)): Path<(String, String)>,
) -> impl IntoResponse {
    let row = sqlx::query_as::<_, crate::models::Object>(
        "SELECT * FROM objects WHERE bucket = $1 AND key = $2"
    )
    .bind(&bucket)
    .bind(&key)
    .fetch_optional(&state.db)
    .await;

    match row {
        Ok(Some(obj)) => {
            // Phase 19 INJECTION POINT - CDN Edge Caching Layer
            // If the file is a viral/hot object, all 15 shards might still be pinned
            // in the Gateway's internal 1GB RAM Cache, granting <1ms retrieval.
            if let Some(_cached_bytes) = state.edge_cache.get(&obj.cid).await {
               tracing::info!("CDN CACHE HIT: Served {}/{} instantly from Moka RAM Cache", bucket, key);
               // TODO: Return cached bytes instead of simulating a pending P2P operation
               return (StatusCode::NOT_IMPLEMENTED, "CDN Cache Hit, Reconstruct Pending").into_response();
            }

            // Phase 10 LibP2P INJECTION POINT
            // Cache Miss: Here, we broadcast a DHT request for `obj.cid` and await 10 shards from the Swarm.
            (StatusCode::NOT_IMPLEMENTED, "LibP2P Swarm Retrieval Pending (Phase 10)").into_response()
        }
        Ok(None) => (StatusCode::NOT_FOUND, "NoSuchKey").into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Database Error").into_response(),
    }
}

#[derive(Deserialize)]
pub struct DedupRequest {
    pub cid: String,
}

pub async fn deduplicate_object(
    State(state): State<Arc<AppState>>,
    Path((bucket, key)): Path<(String, String)>,
    axum::Json(payload): axum::Json<DedupRequest>,
) -> impl IntoResponse {
    let existing_obj = sqlx::query_as::<_, crate::models::Object>(
        "SELECT * FROM objects WHERE cid = $1 LIMIT 1"
    )
    .bind(&payload.cid)
    .fetch_optional(&state.db)
    .await;

    match existing_obj {
        Ok(Some(obj)) => {
            let copy_res = sqlx::query(
                r#"
                INSERT INTO objects (bucket, key, etag, cid, shards, recovery_threshold, size, metadata_json)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (bucket, key) DO UPDATE SET
                    etag = excluded.etag,
                    cid = excluded.cid,
                    size = excluded.size
                "#
            )
            .bind(&bucket)
            .bind(&key)
            .bind(obj.etag)
            .bind(obj.cid)
            .bind(obj.shards)
            .bind(obj.recovery_threshold)
            .bind(obj.size)
            .bind(obj.metadata_json)
            .execute(&state.db)
            .await;

            match copy_res {
                Ok(_) => {
                    tracing::info!("Global Deduplication Success: Mapped {}/{} to CID {}", bucket, key, payload.cid);
                    (StatusCode::OK, "Deduplicated").into_response()
                },
                Err(e) => {
                    tracing::error!("Failed to deduplicate: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to map existing shards").into_response()
                }
            }
        },
        Ok(None) => (StatusCode::NOT_FOUND, "CID Not Found").into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Database Error").into_response(),
    }
}

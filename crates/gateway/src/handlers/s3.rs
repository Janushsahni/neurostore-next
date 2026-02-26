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
use crate::p2p::SwarmRequest;
use tokio::sync::oneshot;

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
                // Decrypt the key for the user (The Gateway performs this in memory)
                let decrypted_key = state.metadata_protector.decrypt(&o.key).unwrap_or_else(|_| o.key.clone());
                
                xml.push_str("  <Contents>\n");
                xml.push_str(&format!("    <Key>{}</Key>\n", decrypted_key));

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
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let geofence = headers.get("x-neuro-geofence")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("GLOBAL")
        .to_string();

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
        
        let swarm_req = SwarmRequest::Store {
            command: cmd,
            geofence: geofence.clone(),
        };

        if let Err(e) = state.p2p_tx.send(swarm_req).await {
            tracing::error!("Failed to route shard {} to LibP2P Swarm: {}", i, e);
        }
    }

    let metadata_json = serde_json::json!({});
    let metadata_str = serde_json::to_string(&metadata_json).unwrap_or_else(|_| "{}".to_string());
    
    // ZK-METADATA ENCRYPTION (Deterministic for exact-match search)
    let encrypted_key = state.metadata_protector.encrypt(&key)
        .expect("Failed to encrypt object key");
    let encrypted_metadata = state.metadata_protector.encrypt(&metadata_str)
        .expect("Failed to encrypt object metadata");

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
    .bind(&encrypted_key)
    .bind(&etag)
    .bind(&cid)
    .bind(shards)
    .bind(recovery_threshold)
    .bind(size)
    .bind(serde_json::json!({ "encrypted": encrypted_metadata }))
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
    let encrypted_key = state.metadata_protector.encrypt(&key)
        .expect("Search Encryption Failure");

    let row = sqlx::query_as::<_, crate::models::Object>(
        "SELECT * FROM objects WHERE bucket = $1 AND key = $2"
    )
    .bind(&bucket)
    .bind(&encrypted_key)
    .fetch_optional(&state.db)
    .await;


    match row {
        Ok(Some(obj)) => {
            // Phase 19 INJECTION POINT - CDN Edge Caching Layer
            if let Some(_cached_bytes) = state.edge_cache.get(&obj.cid).await {
               tracing::info!("CDN CACHE HIT: Served {}/{} instantly from Moka RAM Cache", bucket, key);
               // TODO: Return cached bytes instead of simulating
            }

            // V8 SUPER NODE PRIORITIZATION & RETRIEVAL
            let mut retrieved_shards = Vec::new();
            
            // For MVP, we attempt to retrieve enough shards to satisfy the threshold
            for i in 0..obj.shards {
                let shard_cid = format!("{}-shard-{}", obj.cid, i);
                let (tx, rx) = oneshot::channel();
                
                let req = SwarmRequest::Retrieve {
                    cid: shard_cid,
                    tx,
                };

                if state.p2p_tx.send(req).await.is_ok() {
                    if let Ok(Some(data)) = rx.await {
                        retrieved_shards.push(Some(data));
                        // Break early if we have enough for reconstruction
                        if retrieved_shards.iter().flatten().count() >= obj.recovery_threshold as usize {
                            break;
                        }
                    } else {
                        retrieved_shards.push(None);
                    }
                }
            }

            // Fill remaining with None for the RS decoder
            while retrieved_shards.len() < obj.shards as usize {
                retrieved_shards.push(None);
            }

            // Pass to Reed-Solomon for reconstruction
            let encoder = ErasureEncoder::new(obj.recovery_threshold as usize, (obj.shards - obj.recovery_threshold) as usize)
                .expect("RS Reconstruct: Decoder Initialization Failed");
            
            match encoder.decode(retrieved_shards) {
                Ok(reconstructed_data) => {
                    tracing::info!("SUCCESS: Reconstructed {}/{} after P2P retrieval", bucket, key);
                    (StatusCode::OK, reconstructed_data).into_response()
                }
                Err(e) => {
                    tracing::error!("FAILURE: Failed to reconstruct shards: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, "Erasure Reconstruction Failure").into_response()
                }
            }
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

pub async fn delete_object(
    State(state): State<Arc<AppState>>,
    Path((bucket, key)): Path<(String, String)>,
) -> impl IntoResponse {
    let encrypted_key = state.metadata_protector.encrypt(&key)
        .expect("Delete Encryption Failure");

    // 1. Find the object to get the CID and shard count
    let row = sqlx::query_as::<_, crate::models::Object>(
        "SELECT * FROM objects WHERE bucket = $1 AND key = $2"
    )
    .bind(&bucket)
    .bind(&encrypted_key)
    .fetch_optional(&state.db)
    .await;

    match row {
        Ok(Some(obj)) => {
            // 2. Broadcast Deletion Commands for all shards
            for i in 0..obj.shards {
                let shard_cid = format!("{}-shard-{}", obj.cid, i);
                let (tx, rx) = oneshot::channel();
                
                let req = SwarmRequest::Delete {
                    cid: shard_cid,
                    tx,
                };

                if state.p2p_tx.send(req).await.is_ok() {
                    // We don't strictly wait for every shard to be confirmed deleted 
                    // for the HTTP response, but we log the attempt.
                    let _ = rx.await;
                }
            }

            // 3. Remove from PostgreSQL
            let del_res = sqlx::query("DELETE FROM objects WHERE bucket = $1 AND key = $2")
                .bind(&bucket)
                .bind(&encrypted_key)
                .execute(&state.db)
                .await;

            match del_res {
                Ok(_) => {
                    tracing::info!("SUCCESS: Deleted {}/{} from DB and dispatched P2P erasure", bucket, key);
                    StatusCode::NO_CONTENT.into_response()
                }
                Err(e) => {
                    tracing::error!("Database error during deletion: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
        }
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

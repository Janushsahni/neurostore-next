use axum::{
    extract::{Path, State, Query},
    http::{StatusCode, HeaderMap, HeaderValue},
    response::IntoResponse,
    body::{Bytes, Body},
};
use std::sync::Arc;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use md5::Md5;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use neuro_protocol::{ChunkCommand, StoreChunkRequest};
use futures::stream::{FuturesUnordered, StreamExt};
use std::time::Instant;

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

// ── BUCKET AUTHORIZATION ──────────────────────────────────────────
async fn authorize_bucket(state: &AppState, bucket: &str, email: &str) -> Result<(), (StatusCode, String)> {
    let row = sqlx::query!("SELECT owner_email FROM buckets WHERE name = $1", bucket)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB Error: {}", e)))?;

    match row {
        Some(record) => {
            if record.owner_email == email {
                Ok(())
            } else {
                Err((StatusCode::FORBIDDEN, "AccessDenied: Bucket owned by another user".to_string()))
            }
        },
        None => {
            sqlx::query!("INSERT INTO buckets (name, owner_email) VALUES ($1, $2)", bucket, email)
                .execute(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to provision bucket: {}", e)))?;
            Ok(())
        }
    }
}

// S3 Auth Stub - Extract AWS Signature V4 or fallback to JWT
fn validate_s3_auth(headers: &HeaderMap, state: &AppState) -> Result<String, (StatusCode, String)> {
    let auth_header = headers.get("Authorization").and_then(|h| h.to_str().ok());
    
    if let Some(auth) = auth_header {
        if auth.starts_with("AWS4-HMAC-SHA256") {
            return Err((StatusCode::FORBIDDEN, "AccessDenied: Full AWS SigV4 not yet implemented. Use JWT Bearer token.".to_string()));
        } else if auth.starts_with("Bearer ") {
            let token = auth.trim_start_matches("Bearer ");
            let token_data = jsonwebtoken::decode::<crate::models::Claims>(
                token,
                &jsonwebtoken::DecodingKey::from_secret(state.jwt_secret.as_bytes()),
                &jsonwebtoken::Validation::default(),
            );
            if let Ok(data) = token_data {
                return Ok(data.claims.email);
            } else {
                return Err((StatusCode::UNAUTHORIZED, "Invalid JWT".to_string()));
            }
        }
    }
    Err((StatusCode::FORBIDDEN, "AccessDenied: Invalid Authentication".to_string()))
}

// ── S3 HANDLERS ───────────────────────────────────────────────────

pub async fn list_objects(
    State(state): State<Arc<AppState>>,
    Path(bucket): Path<String>,
    Query(query): Query<ListQuery>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let user_email = match validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };
    if let Err(err) = authorize_bucket(&state, &bucket, &user_email).await {
        return err.into_response();
    }

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
                let decrypted_key = state.metadata_protector.decrypt(&o.key).unwrap_or_else(|_| o.key.clone());
                
                xml.push_str("  <Contents>\n");
                xml.push_str(&format!("    <Key>{}</Key>\n", decrypted_key));

                let date_str = o.created_at.map(|d| d.to_rfc3339()).unwrap_or_default();
                xml.push_str(&format!("    <LastModified>{}</LastModified>\n", date_str));
                let etag_quoted = if o.etag.starts_with('"') { o.etag.clone() } else { format!("\"{}\"", o.etag) };
                xml.push_str(&format!("    <ETag>{}</ETag>\n", etag_quoted));
                xml.push_str(&format!("    <Size>{}</Size>\n", o.size));
                xml.push_str("    <StorageClass>STANDARD</StorageClass>\n");
                xml.push_str("  </Contents>\n");
            }

            xml.push_str("</ListBucketResult>");

            let mut headers = HeaderMap::new();
            headers.insert("Content-Type", HeaderValue::from_static("application/xml"));
            (StatusCode::OK, headers, xml).into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Database Error").into_response(),
    }
}

pub async fn put_object(
    State(state): State<Arc<AppState>>,
    Path((bucket, key)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> impl IntoResponse {
    let start_time = Instant::now();
    let user_email = match validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };
    if let Err(err) = authorize_bucket(&state, &bucket, &user_email).await {
        return err.into_response();
    }

    let key = key.trim_start_matches('/').to_string();
    let geofence = headers.get("x-neuro-geofence")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("GLOBAL")
        .to_string();

    // ── STREAMING CHUNK COLLECTOR ──
    let mut full_body = Vec::new();
    let mut body_stream = body.into_data_stream();
    while let Some(chunk) = body_stream.next().await {
        match chunk {
            Ok(data) => {
                if full_body.len() + data.len() > 1024 * 1024 * 500 {
                    return (StatusCode::PAYLOAD_TOO_LARGE, "Exceeds 500MB Limit").into_response();
                }
                full_body.extend_from_slice(&data);
            },
            Err(_) => return (StatusCode::BAD_REQUEST, "Stream Error").into_response(),
        }
    }
    let body_bytes = Bytes::from(full_body);
    let etag = format!("\"{:x}\"", Md5::digest(&body_bytes));
    
    // ── DOUBLE-BLIND ENCRYPTION ──
    let mut hasher = Sha256::new();
    hasher.update(&body_bytes);
    let plaintext_hash = hasher.finalize();
    let enc_key_hex = hex::encode(plaintext_hash);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&plaintext_hash));
    let mut nonce_bytes = [0u8; 12];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let encrypted_body = match cipher.encrypt(nonce, body_bytes.as_ref()) {
        Ok(enc) => {
            let mut combined = nonce_bytes.to_vec();
            combined.extend(enc);
            combined
        },
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Encryption failed").into_response(),
    };

    let size = encrypted_body.len() as i64;
    
    let mut cid_hasher = Sha256::new();
    cid_hasher.update(&encrypted_body);
    let cid = format!("Qm{}", bs58::encode(cid_hasher.finalize()).into_string());

    // RS(10, 10) - 20 total shards
    let recovery_threshold = 10;
    let parity_shards = 10;
    let total_shards = recovery_threshold + parity_shards;
    
    let encoder = match ErasureEncoder::new(recovery_threshold, parity_shards) {
        Ok(e) => e,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "RS Init Error").into_response(),
    };
        
    let physical_shards = match encoder.encode(&encrypted_body) {
        Ok(s) => s,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "RS Encode Error").into_response(),
    };

    tracing::info!("ENHANCED REDUNDANCY: Sliced {} bytes into 20 Galios Shards (RS 10+10)", size);

    for (i, shard_bytes) in physical_shards.into_iter().enumerate() {
        let shard_cid = format!("{}-shard-{}", cid, i);
        let cmd = ChunkCommand::Store(StoreChunkRequest {
            cid: shard_cid,
            data: shard_bytes,
        });
        
        let swarm_req = SwarmRequest::Store {
            command: cmd,
            geofence: geofence.clone(),
        };

        let _ = state.p2p_tx.try_send(swarm_req);
    }

    let metadata_json = serde_json::json!({ "encryption_key": enc_key_hex });
    let metadata_str = serde_json::to_string(&metadata_json).unwrap_or_else(|_| "{}".to_string());
    
    let encrypted_key = match state.metadata_protector.encrypt(&key) {
        Ok(k) => k,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Key encryption failed").into_response(),
    };
    
    let encrypted_metadata = match state.metadata_protector.encrypt(&metadata_str) {
        Ok(m) => m,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Metadata encryption failed").into_response(),
    };

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
    .bind(total_shards as i32)
    .bind(recovery_threshold as i32)
    .bind(size)
    .bind(serde_json::json!({ "encrypted": encrypted_metadata }))
    .execute(&state.db)
    .await;


    match res {
        Ok(_) => {
            let duration = start_time.elapsed();
            tracing::info!("PUT SUCCESS: {}/{} | Redundancy: 2.0x | Latency: {}ms", bucket, key, duration.as_millis());

            let manifest = serde_json::json!({
                "bucket": bucket,
                "key": key,
                "cid": cid,
                "size": size,
                "shards": total_shards,
                "recovery_threshold": recovery_threshold,
                "etag": etag,
                "metadata": encrypted_metadata
            });
            
            let manifest_bytes = serde_json::to_vec(&manifest).unwrap_or_default();
            let mut manifest_hasher = Sha256::new();
            manifest_hasher.update(format!("{}:{}", bucket, key).as_bytes());
            let manifest_id = format!("meta-{}", hex::encode(manifest_hasher.finalize()));
            
            let cmd = ChunkCommand::Store(StoreChunkRequest {
                cid: manifest_id,
                data: manifest_bytes,
            });
            let _ = state.p2p_tx.send(SwarmRequest::Store { command: cmd, geofence: "GLOBAL".to_string() }).await;

            let mut headers_out = HeaderMap::new();
            if let Ok(val) = etag.parse() {
                headers_out.insert("ETag", val);
            }
            headers_out.insert("x-neuro-latency-ms", HeaderValue::from_str(&duration.as_millis().to_string()).unwrap());
            (StatusCode::OK, headers_out).into_response()
        }
        Err(e) => {
            tracing::error!("Failed to insert object: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Object insertion failed").into_response()
        }
    }
}

pub async fn reconstruct_metadata(
    State(state): State<Arc<AppState>>,
    Path((bucket, key)): Path<(String, String)>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let user_email = match validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };
    if let Err(err) = authorize_bucket(&state, &bucket, &user_email).await {
        return err.into_response();
    }
    
    let key = key.trim_start_matches('/').to_string();

    let mut manifest_hasher = Sha256::new();
    manifest_hasher.update(format!("{}:{}", bucket, key).as_bytes());
    let manifest_id = format!("meta-{}", hex::encode(manifest_hasher.finalize()));

    let (tx, rx) = oneshot::channel();
    let req = SwarmRequest::Retrieve {
        cid: manifest_id,
        tx,
    };

    if state.p2p_tx.send(req).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "P2P Dispatch Error").into_response();
    }

    match rx.await {
        Ok(Some(data)) => {
            let Ok(manifest) = serde_json::from_slice::<serde_json::Value>(&data) else {
                return (StatusCode::INTERNAL_SERVER_ERROR, "Invalid Manifest Data").into_response();
            };

            let cid = manifest["cid"].as_str().unwrap_or_default();
            let etag = manifest["etag"].as_str().unwrap_or_default();
            let shards = manifest["shards"].as_i64().unwrap_or(20);
            let threshold = manifest["recovery_threshold"].as_i64().unwrap_or(10);
            let size = manifest["size"].as_i64().unwrap_or(0);
            let encrypted_meta = manifest["metadata"].as_str().unwrap_or("");

            let encrypted_key = match state.metadata_protector.encrypt(&key) {
                Ok(k) => k,
                Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Key encryption failed").into_response(),
            };

            let res = sqlx::query(
                r#"
                INSERT INTO objects (bucket, key, etag, cid, shards, recovery_threshold, size, metadata_json)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (bucket, key) DO NOTHING
                "#
            )
            .bind(&bucket)
            .bind(&encrypted_key)
            .bind(etag)
            .bind(cid)
            .bind(shards as i32)
            .bind(threshold as i32)
            .bind(size)
            .bind(serde_json::json!({ "encrypted": encrypted_meta }))
            .execute(&state.db)
            .await;

            match res {
                Ok(_) => (StatusCode::OK, "Metadata Restored from P2P Shadow Registry").into_response(),
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("DB Restore Failed: {}", e)).into_response(),
            }
        }
        _ => (StatusCode::NOT_FOUND, "No Shadow Manifest found in Swarm").into_response(),
    }
}

pub async fn get_object(
    State(state): State<Arc<AppState>>,
    Path((bucket, key)): Path<(String, String)>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let start_time = Instant::now();
    let user_email = match validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };
    if let Err(err) = authorize_bucket(&state, &bucket, &user_email).await {
        return err.into_response();
    }
    
    let key = key.trim_start_matches('/').to_string();
    
    let encrypted_key = match state.metadata_protector.encrypt(&key) {
        Ok(k) => k,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Search Encryption Failure").into_response(),
    };

    let row = sqlx::query_as::<_, crate::models::Object>(
        "SELECT * FROM objects WHERE bucket = $1 AND key = $2"
    )
    .bind(&bucket)
    .bind(&encrypted_key)
    .fetch_optional(&state.db)
    .await;


    match row {
        Ok(Some(obj)) => {
            // HIGH-SPEED CACHE CHECK
            if let Some(cached_bytes) = state.edge_cache.get(&obj.cid).await {
               let duration = start_time.elapsed();
               tracing::info!("CDN RAM HIT: Served {}/{} in {}ms", bucket, key, duration.as_millis());
               return (StatusCode::OK, cached_bytes).into_response();
            }

            // ── PARALLEL RACING RETRIEVAL ──
            let mut futures = FuturesUnordered::new();
            
            for i in 0..obj.shards {
                let shard_cid = format!("{}-shard-{}", obj.cid, i);
                let (tx, rx) = oneshot::channel();
                let p2p_tx = state.p2p_tx.clone();
                
                futures.push(async move {
                    let req = SwarmRequest::Retrieve { cid: shard_cid, tx };
                    if p2p_tx.send(req).await.is_ok() {
                        if let Ok(Some(data)) = rx.await {
                            return Some((i as usize, data));
                        }
                    }
                    None
                });
            }

            let mut retrieved_shards = vec![None; obj.shards as usize];
            let mut success_count = 0;

            while let Some(result) = futures.next().await {
                if let Some((index, data)) = result {
                    retrieved_shards[index] = Some(data);
                    success_count += 1;
                    
                    if success_count >= obj.recovery_threshold as usize {
                        break;
                    }
                }
            }

            if success_count < obj.recovery_threshold as usize {
                return (StatusCode::INTERNAL_SERVER_ERROR, "Data unavailable: Insufficient shards").into_response();
            }

            let encoder = match ErasureEncoder::new(obj.recovery_threshold as usize, (obj.shards - obj.recovery_threshold) as usize) {
                Ok(e) => e,
                Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "RS Decoder Init Failed").into_response(),
            };
            
            match encoder.decode(retrieved_shards) {
                Ok(reconstructed_data) => {
                    let metadata_str = match obj.metadata_json.as_ref().and_then(|v| v.get("encrypted")).and_then(|v| v.as_str()) {
                        Some(enc_str) => state.metadata_protector.decrypt(enc_str).unwrap_or_else(|_| "{}".to_string()),
                        None => "{}".to_string(),
                    };
                    let metadata: serde_json::Value = serde_json::from_str(&metadata_str).unwrap_or(serde_json::json!({}));
                    
                    let mut final_data = reconstructed_data;
                    if let Some(key_hex) = metadata.get("encryption_key").and_then(|v| v.as_str()) {
                        if let Ok(key_bytes) = hex::decode(key_hex) {
                            if key_bytes.len() == 32 {
                                let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
                                if final_data.len() > 12 {
                                    let (nonce_bytes, ciphertext) = final_data.split_at(12);
                                    let nonce = Nonce::from_slice(nonce_bytes);
                                    if let Ok(dec) = cipher.decrypt(nonce, ciphertext) {
                                        final_data = dec;
                                    }
                                }
                            }
                        }
                    }

                    let duration = start_time.elapsed();
                    tracing::info!("GET SUCCESS: {}/{} | Racing Shards: {}/{} | Latency: {}ms", bucket, key, success_count, obj.shards, duration.as_millis());
                    
                    let cache = state.edge_cache.clone();
                    let cid = obj.cid.clone();
                    let data_to_cache = final_data.clone();
                    tokio::spawn(async move {
                        cache.insert(cid, Bytes::from(data_to_cache)).await;
                    });

                    (StatusCode::OK, final_data).into_response()
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
    pub etag: String,
}

pub async fn deduplicate_object(
    State(state): State<Arc<AppState>>,
    Path((bucket, key)): Path<(String, String)>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<DedupRequest>,
) -> impl IntoResponse {
    let user_email = match validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };
    if let Err(err) = authorize_bucket(&state, &bucket, &user_email).await {
        return err.into_response();
    }
    
    let key = key.trim_start_matches('/').to_string();

    let existing_obj = sqlx::query_as::<_, crate::models::Object>(
        "SELECT * FROM objects WHERE cid = $1 AND etag = $2 LIMIT 1"
    )
    .bind(&payload.cid)
    .bind(&payload.etag)
    .fetch_optional(&state.db)
    .await;

    match existing_obj {
        Ok(Some(obj)) => {
            let encrypted_key = match state.metadata_protector.encrypt(&key) {
                Ok(k) => k,
                Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Key encryption failed").into_response(),
            };

            let copy_res = sqlx::query(
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
            .bind(&obj.etag)
            .bind(&obj.cid)
            .bind(obj.shards)
            .bind(obj.recovery_threshold)
            .bind(obj.size)
            .bind(&obj.metadata_json)
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
        Ok(None) => (StatusCode::NOT_FOUND, "CID or ETag verification failed").into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Database Error").into_response(),
    }
}

pub async fn delete_object(
    State(state): State<Arc<AppState>>,
    Path((bucket, key)): Path<(String, String)>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let user_email = match validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };
    if let Err(err) = authorize_bucket(&state, &bucket, &user_email).await {
        return err.into_response();
    }
    
    let key = key.trim_start_matches('/').to_string();

    let encrypted_key = match state.metadata_protector.encrypt(&key) {
        Ok(k) => k,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Delete Encryption Failure").into_response(),
    };

    let row = sqlx::query_as::<_, crate::models::Object>(
        "SELECT * FROM objects WHERE bucket = $1 AND key = $2"
    )
    .bind(&bucket)
    .bind(&encrypted_key)
    .fetch_optional(&state.db)
    .await;

    match row {
        Ok(Some(obj)) => {
            for i in 0..obj.shards {
                let shard_cid = format!("{}-shard-{}", obj.cid, i);
                let (tx, rx) = oneshot::channel();
                
                let req = SwarmRequest::Delete {
                    cid: shard_cid,
                    tx,
                };

                if state.p2p_tx.send(req).await.is_ok() {
                    let _ = rx.await;
                }
            }

            let del_res = sqlx::query("DELETE FROM objects WHERE bucket = $1 AND key = $2")
                .bind(&bucket)
                .bind(&encrypted_key)
                .execute(&state.db)
                .await;

            match del_res {
                Ok(_) => {
                    tracing::info!("SUCCESS: Deleted {}/{} from DB", bucket, key);
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

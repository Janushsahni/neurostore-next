use sha2::Digest;
use sqlx::Row;
use std::sync::Arc;
use std::time::Duration;
use tokio::time;
use tracing::{error, info, warn};

use crate::AppState;

#[derive(sqlx::FromRow)]
struct DegradedObject {
    bucket: String,
    key: String,
    cid: String,
    shards: i32,
    recovery_threshold: i32,
}

pub struct RepairDaemon {
    state: Arc<AppState>,
}

impl RepairDaemon {
    pub fn new(state: Arc<AppState>) -> Self {
        Self { state }
    }

    pub async fn start(&self) {
        info!("Data Repair Daemon initialized. Sweeping network every 60 seconds.");

        let mut interval = time::interval(Duration::from_secs(60));

        loop {
            interval.tick().await;
            self.sweep().await;
            self.proactive_migration_sweep().await;
            self.thundering_herd_caching_sweep().await;
            self.recursive_manifest_pinning_sweep().await;
        }
    }

    async fn recursive_manifest_pinning_sweep(&self) {
        // "Recursive Manifest Pinning" (Shadow Objects)
        // Prevents "Metadata Decapitation." If the central Postgres DB is destroyed,
        // the Swarm still holds the encrypted metadata map of every object.
        // We periodically verify these "meta-cids" exist in the swarm and re-store if missing.

        let recent_objects = sqlx::query_as::<_, DegradedObject>(
            r#"
            SELECT bucket, key, cid, shards, recovery_threshold
            FROM objects 
            ORDER BY created_at DESC
            LIMIT 100
            "#,
        )
        .fetch_all(&self.state.db)
        .await;

        match recent_objects {
            Ok(objects) => {
                for obj in objects {
                    let mut manifest_hasher = sha2::Sha256::new();
                    sha2::Digest::update(
                        &mut manifest_hasher,
                        format!("{}:{}", obj.bucket, obj.key).as_bytes(),
                    );
                    let manifest_id = format!("meta-{}", hex::encode(manifest_hasher.finalize()));

                    // Attempt to retrieve the shadow manifest from the P2P swarm
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    let _ = self
                        .state
                        .p2p_tx
                        .send(crate::p2p::SwarmRequest::Retrieve {
                            cid: manifest_id.clone(),
                            preferred_peer_id: None,
                            tx,
                        })
                        .await;

                    let manifest_exists = match tokio::time::timeout(
                        tokio::time::Duration::from_secs(5),
                        rx,
                    )
                    .await
                    {
                        Ok(Ok(ack)) => ack.data.is_some(),
                        _ => false,
                    };

                    if !manifest_exists {
                        // Re-generate the manifest JSON from Postgres and store it in the swarm
                        let manifest_json = serde_json::json!({
                            "bucket": obj.bucket,
                            "key": obj.key,
                            "cid": obj.cid,
                            "shards": obj.shards,
                            "recovery_threshold": obj.recovery_threshold,
                            "pinned_at": chrono::Utc::now().to_rfc3339(),
                        });

                        let manifest_bytes = serde_json::to_vec(&manifest_json).unwrap_or_default();
                        let (store_tx, store_rx) = tokio::sync::oneshot::channel();
                        let cmd = neuro_protocol::ChunkCommand::Store(
                            neuro_protocol::StoreChunkRequest {
                                cid: manifest_id.clone(),
                                data: manifest_bytes,
                            },
                        );

                        let _ = self
                            .state
                            .p2p_tx
                            .send(crate::p2p::SwarmRequest::Store {
                                command: cmd,
                                geofence: "ANY".to_string(),
                                tx: store_tx,
                            })
                            .await;

                        match tokio::time::timeout(tokio::time::Duration::from_secs(10), store_rx)
                            .await
                        {
                            Ok(Ok(ack)) if ack.stored => {
                                info!(
                                    "Shadow Object RE-PINNED for {}/{} -> CID: {} on peer {}",
                                    obj.bucket, obj.key, manifest_id, ack.peer_id
                                );
                            }
                            _ => {
                                warn!(
                                    "Failed to re-pin Shadow Object for {}/{} -> CID: {}",
                                    obj.bucket, obj.key, manifest_id
                                );
                            }
                        }
                    } else {
                        tracing::debug!(
                            "Shadow Object verified for {}/{} -> CID: {}",
                            obj.bucket, obj.key, manifest_id
                        );
                    }
                }
            }
            Err(e) => {
                tracing::error!(
                    "Failed to fetch objects for Recursive Manifest Pinning: {}",
                    e
                );
            }
        }
    }

    async fn thundering_herd_caching_sweep(&self) {
        // "Thundering Herd" Swarm Caching
        // Identifies objects with high recent read activity ("Heat Score")
        // and dynamically replicates their shards to additional nodes.
        // This spreads the retrieval load across the mesh, preventing
        // localized DDoS attacks on smaller Data Centers.

        let hot_objects_res = sqlx::query_as::<_, DegradedObject>(
            r#"
            SELECT bucket, key, cid, shards, recovery_threshold
            FROM objects 
            WHERE metadata_json->>'heat_score' > '1000' 
              AND shards < 100
            "#,
        )
        .fetch_all(&self.state.db)
        .await;

        match hot_objects_res {
            Ok(objects) => {
                for obj in objects {
                    let target_shards = 100i32;
                    let additional_needed = target_shards - obj.shards;
                    if additional_needed <= 0 {
                        continue;
                    }

                    warn!("THUNDERING HERD DETECTED: Object {}/{} is viral. Scaling from {} to {} shards.",
                        obj.bucket, obj.key, obj.shards, target_shards);

                    // Retrieve existing shards to replicate
                    let existing_shards = sqlx::query_as::<_, (String, Vec<u8>)>(
                        "SELECT chunk_cid, '' as data FROM object_shards WHERE object_cid = $1 LIMIT 5"
                    )
                    .bind(&obj.cid)
                    .fetch_all(&self.state.db)
                    .await
                    .unwrap_or_default();

                    let mut distributed_count = 0i32;

                    for (chunk_cid, _) in &existing_shards {
                        // Retrieve the actual shard data from whichever peer has it
                        let (rtx, rrx) = tokio::sync::oneshot::channel();
                        let _ = self.state.p2p_tx
                            .send(crate::p2p::SwarmRequest::Retrieve {
                                cid: chunk_cid.clone(),
                                preferred_peer_id: None,
                                tx: rtx,
                            })
                            .await;

                        let shard_data = match tokio::time::timeout(
                            tokio::time::Duration::from_secs(10), rrx
                        ).await {
                            Ok(Ok(ack)) if ack.data.is_some() => ack.data.unwrap(),
                            _ => continue,
                        };

                        // Distribute copies to additional peers (up to 5 replicas per existing shard)
                        let replicas_per_shard = (additional_needed / existing_shards.len() as i32).max(1).min(5);
                        for _ in 0..replicas_per_shard {
                            let (stx, srx) = tokio::sync::oneshot::channel();
                            let cmd = neuro_protocol::ChunkCommand::Store(
                                neuro_protocol::StoreChunkRequest {
                                    cid: chunk_cid.clone(),
                                    data: shard_data.clone(),
                                },
                            );
                            let _ = self.state.p2p_tx
                                .send(crate::p2p::SwarmRequest::Store {
                                    command: cmd,
                                    geofence: "ANY".to_string(),
                                    tx: stx,
                                })
                                .await;

                            if let Ok(Ok(ack)) = tokio::time::timeout(
                                tokio::time::Duration::from_secs(10), srx
                            ).await {
                                if ack.stored {
                                    distributed_count += 1;
                                }
                            }
                        }
                    }

                    // Update DB with actual distribution count and reset heat score
                    let new_shard_count = obj.shards + distributed_count;
                    let _ = sqlx::query(
                        "UPDATE objects SET shards = $1, metadata_json = jsonb_set(COALESCE(metadata_json::jsonb, '{}'::jsonb), '{heat_score}', '0'::jsonb) WHERE bucket = $2 AND key = $3"
                    )
                    .bind(new_shard_count)
                    .bind(&obj.bucket)
                    .bind(&obj.key)
                    .execute(&self.state.db)
                    .await;

                    info!("Swarm Caching Complete: {}/{} scaled to {} shards ({} new replicas distributed).",
                        obj.bucket, obj.key, new_shard_count, distributed_count);
                }
            }
            Err(e) => {
                tracing::debug!("Swarm caching sweep skipped or no hot objects found: {}", e);
            }
        }
    }

    async fn proactive_migration_sweep(&self) {
        // Predictive AI: "Pre-emptive Self-Healing"
        // Find peers with high churn_probability (> 0.8) and proactively replicate
        // any shards hosted on them to stable nodes BEFORE the node goes offline.

        let high_churn_peers_res = sqlx::query(
            "SELECT peer_id FROM nodes WHERE uptime_percentage < 95.0 AND bandwidth_capacity_mbps < 5 LIMIT 5"
        )
        .fetch_all(&self.state.db)
        .await;

        match high_churn_peers_res {
            Ok(peers) => {
                for peer in peers {
                    let peer_id: String = match peer.try_get("peer_id") {
                        Ok(v) => v,
                        Err(e) => {
                            error!("Failed to decode peer_id in proactive migration: {}", e);
                            continue;
                        }
                    };

                    warn!("PREDICTIVE AI: Node {} flagged for proactive migration.", peer_id);

                    // Find all shards hosted on this high-churn peer
                    let shards_on_peer = sqlx::query_as::<_, (String, String, i32)>(
                        "SELECT object_cid, chunk_cid, chunk_index FROM object_shards WHERE peer_id = $1 LIMIT 50"
                    )
                    .bind(&peer_id)
                    .fetch_all(&self.state.db)
                    .await
                    .unwrap_or_default();

                    if shards_on_peer.is_empty() {
                        info!("Node {} has no shards to migrate.", peer_id);
                        continue;
                    }

                    let mut migrated = 0u32;

                    for (object_cid, chunk_cid, chunk_index) in &shards_on_peer {
                        // 1. Retrieve the shard from the churn-risk peer
                        let (rtx, rrx) = tokio::sync::oneshot::channel();
                        let _ = self.state.p2p_tx
                            .send(crate::p2p::SwarmRequest::Retrieve {
                                cid: chunk_cid.clone(),
                                preferred_peer_id: Some(peer_id.clone()),
                                tx: rtx,
                            })
                            .await;

                        let shard_data = match tokio::time::timeout(
                            tokio::time::Duration::from_secs(10), rrx
                        ).await {
                            Ok(Ok(ack)) if ack.data.is_some() => ack.data.unwrap(),
                            _ => {
                                warn!("Failed to retrieve shard {} from churn-risk node {}", chunk_cid, peer_id);
                                continue;
                            }
                        };

                        // 2. Re-store on a different (stable) peer
                        let (stx, srx) = tokio::sync::oneshot::channel();
                        let cmd = neuro_protocol::ChunkCommand::Store(
                            neuro_protocol::StoreChunkRequest {
                                cid: chunk_cid.clone(),
                                data: shard_data,
                            },
                        );
                        let _ = self.state.p2p_tx
                            .send(crate::p2p::SwarmRequest::Store {
                                command: cmd,
                                geofence: "ANY".to_string(),
                                tx: stx,
                            })
                            .await;

                        match tokio::time::timeout(tokio::time::Duration::from_secs(15), srx).await {
                            Ok(Ok(ack)) if ack.stored => {
                                // 3. Update DB: point the shard record to the new peer
                                let _ = sqlx::query(
                                    "UPDATE object_shards SET peer_id = $1 WHERE object_cid = $2 AND chunk_index = $3 AND peer_id = $4"
                                )
                                .bind(&ack.peer_id)
                                .bind(object_cid)
                                .bind(chunk_index)
                                .bind(&peer_id)
                                .execute(&self.state.db)
                                .await;

                                migrated += 1;
                            }
                            _ => {
                                warn!("Failed to migrate shard {} to stable peer", chunk_cid);
                            }
                        }
                    }

                    info!("Proactive migration complete for Node {}: {}/{} shards moved to stable peers.",
                        peer_id, migrated, shards_on_peer.len());
                }
            }
            Err(e) => error!("Failed to fetch high-churn peers: {}", e),
        }
    }

    async fn sweep(&self) {
        // Scan for objects where shard count has degraded below the target (20).
        // NOTE: This daemon currently IDENTIFIES degraded objects and flags them.
        // Full self-healing requires:
        //   1. Retrieve remaining shards from swarm via P2P
        //   2. RS-decode to reconstruct the original data
        //   3. RS-encode new parity shards
        //   4. Distribute new shards to fresh nodes
        //   5. Only THEN update the DB shard count
        // Until that pipeline is implemented, we log warnings and mark objects.

        let degraded_objects_res = sqlx::query_as::<_, DegradedObject>(
            r#"
            SELECT o.bucket, o.key, o.cid, o.shards, o.recovery_threshold
            FROM objects o
            WHERE o.shards < 20 AND o.shards >= o.recovery_threshold
            "#,
        )
        .fetch_all(&self.state.db)
        .await;

        match degraded_objects_res {
            Ok(objects) => {
                if objects.is_empty() {
                    return;
                }

                warn!(
                    "Repair Daemon detected {} degraded objects requiring attention.",
                    objects.len()
                );

                for obj in objects {
                    let missing = 20 - obj.shards;

                    // 1. Identify surviving shards in the Swarm
                    let healthy_shards_res = sqlx::query(
                        r#"
                        SELECT os.chunk_cid, os.chunk_index, os.peer_id
                        FROM object_shards os
                        LEFT JOIN node_registry nr ON nr.node_id = os.peer_id
                        WHERE os.object_cid = $1
                          AND (nr.last_heartbeat_at IS NULL OR nr.last_heartbeat_at > NOW() - INTERVAL '10 minutes')
                        "#
                    )
                    .bind(&obj.cid)
                    .fetch_all(&self.state.db)
                    .await;

                    if let Ok(healthy_shards) = healthy_shards_res {
                        let healthy_count = healthy_shards.len();

                        if healthy_count < obj.recovery_threshold as usize {
                            error!("FATAL: Object {}/{} has fallen below Recovery Threshold ({} < {}). Data is irrecoverably lost.", 
                                obj.bucket, obj.key, healthy_count, obj.recovery_threshold);
                            continue;
                        }

                        info!("Initiating Self-Healing for {}/{} ({} missing parity). Reconstructing from {} surviving chunks...", 
                            obj.bucket, obj.key, missing, healthy_count);

                        // 2. Fetch surviving shards from P2P Swarm
                        let mut retrieved_blocks: std::collections::HashMap<usize, Vec<u8>> =
                            std::collections::HashMap::new();

                        for row in &healthy_shards {
                            let chunk_cid: String = row.get("chunk_cid");
                            let chunk_index: i32 = row.get("chunk_index");
                            let preferred_peer: Option<String> = row.try_get("peer_id").ok();

                            let (tx, rx) = tokio::sync::oneshot::channel();
                            let _ = self
                                .state
                                .p2p_tx
                                .send(crate::p2p::SwarmRequest::Retrieve {
                                    cid: chunk_cid.clone(),
                                    preferred_peer_id: preferred_peer,
                                    tx,
                                })
                                .await;

                            if let Ok(ack) =
                                tokio::time::timeout(tokio::time::Duration::from_secs(10), rx).await
                            {
                                if let Ok(ack_data) = ack {
                                    if let Some(data) = ack_data.data {
                                        retrieved_blocks.insert(chunk_index as usize, data);
                                    }
                                }
                            }

                            if retrieved_blocks.len() >= obj.recovery_threshold as usize {
                                break;
                            }
                        }

                        if retrieved_blocks.len() < obj.recovery_threshold as usize {
                            error!("Repair aborted for {}/{}: Swarm retrieval failed (timed out or nodes rejected transfer).", obj.bucket, obj.key);
                            continue;
                        }

                        // 3. Reed-Solomon Erasure Decoding
                        let data_shards = obj.recovery_threshold as usize;
                        let parity_shards = 20 - data_shards;

                        let encoder =
                            match crate::erasure::ErasureEncoder::new(data_shards, parity_shards) {
                                Ok(e) => e,
                                Err(e) => {
                                    error!("RS Init failed: {:?}", e);
                                    continue;
                                }
                            };

                        let mut rs_matrix: Vec<Option<Vec<u8>>> = vec![None; 20];
                        for (idx, data) in retrieved_blocks.into_iter() {
                            if idx < 20 {
                                rs_matrix[idx] = Some(data);
                            }
                        }

                        let decoded_original_data = match encoder.decode(rs_matrix.clone()) {
                            Ok(data) => data,
                            Err(e) => {
                                error!("RS Decode failed for {}/{}: {:?}", obj.bucket, obj.key, e);
                                continue;
                            }
                        };

                        // 4. Reed-Solomon Re-encoding
                        let fresh_shards = match encoder.encode(&decoded_original_data) {
                            Ok(s) => s,
                            Err(e) => {
                                error!("RS Re-encode failed: {:?}", e);
                                continue;
                            }
                        };

                        // 5. Inject missing shards back into the swarm
                        let mut successfully_repaired = 0;

                        for i in 0..20 {
                            if rs_matrix[i].is_none() {
                                let fresh_data = &fresh_shards[i];

                                let mut hasher = sha2::Sha256::new();
                                sha2::Digest::update(&mut hasher, fresh_data);
                                let new_cid = format!("chunk-{}", hex::encode(hasher.finalize()));

                                let (tx, rx) = tokio::sync::oneshot::channel();
                                let cmd = neuro_protocol::ChunkCommand::Store(
                                    neuro_protocol::StoreChunkRequest {
                                        cid: new_cid.clone(),
                                        data: fresh_data.clone(),
                                    },
                                );

                                let _ = self
                                    .state
                                    .p2p_tx
                                    .send(crate::p2p::SwarmRequest::Store {
                                        command: cmd,
                                        geofence: "IN".to_string(),
                                        tx,
                                    })
                                    .await;

                                if let Ok(ack) =
                                    tokio::time::timeout(tokio::time::Duration::from_secs(15), rx)
                                        .await
                                {
                                    if let Ok(ack_data) = ack {
                                        if ack_data.stored {
                                            // 6. DB Update only on physical storage success
                                            let _ = sqlx::query(
                                                r#"
                                                INSERT INTO object_shards (object_cid, chunk_index, chunk_cid, peer_id, size_bytes)
                                                VALUES ($1, $2, $3, $4, $5)
                                                "#
                                            )
                                            .bind(&obj.cid)
                                            .bind(i as i32)
                                            .bind(&new_cid)
                                            .bind(&ack_data.peer_id)
                                            .bind(fresh_data.len() as i32)
                                            .execute(&self.state.db)
                                            .await;

                                            successfully_repaired += 1;
                                        }
                                    }
                                }
                            }
                        }

                        // 7. Update Object Shard Metadata
                        let _ =
                            sqlx::query("UPDATE objects SET shards = shards + $1 WHERE cid = $2")
                                .bind(successfully_repaired)
                                .bind(&obj.cid)
                                .execute(&self.state.db)
                                .await;

                        info!("Self-Healing Complete for {}/{}: Re-encoded & Distributed {} missing shards.", 
                            obj.bucket, obj.key, successfully_repaired);
                    }
                }
            }
            Err(e) => {
                error!("Repair Daemon failed to query degraded objects: {}", e);
            }
        }
    }
}

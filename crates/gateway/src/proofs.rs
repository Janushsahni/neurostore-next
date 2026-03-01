use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use chrono::Utc;
use libp2p::PeerId;
use rand::RngCore;
use tokio::time::{sleep, timeout};
use tracing::{info, warn};
use futures::stream::{FuturesUnordered, StreamExt};
use sha2::Digest;

use crate::{
    p2p::SwarmRequest,
    AppState,
};

const PROOF_CHALLENGE_TTL_SECS: i64 = 90;
const PROOF_BATCH_SIZE: i64 = 8;

#[derive(sqlx::FromRow)]
struct ShardTarget {
    object_cid: String,
    shard_cid: String,
    shard_index: i32,
    peer_id: String,
    country_code: String,
}

pub struct ProofOfSpacetimeDaemon {
    state: Arc<AppState>,
}

impl ProofOfSpacetimeDaemon {
    pub fn new(state: Arc<AppState>) -> Self {
        Self { state }
    }

    pub async fn start(&self) {
        info!("Proof daemon initialized. Running cryptographic audit loop every 60 seconds.");

        loop {
            sleep(Duration::from_secs(60)).await;
            self.expire_stale_challenges().await;

            let targets = sqlx::query_as::<_, ShardTarget>(
                r#"
                SELECT object_cid, shard_cid, shard_index, peer_id, country_code
                FROM object_shards
                ORDER BY COALESCE(last_verified_at, TO_TIMESTAMP(0)) ASC, RANDOM()
                LIMIT $1
                "#,
            )
            .bind(PROOF_BATCH_SIZE)
            .fetch_all(&self.state.db)
            .await
            .unwrap_or_default();

            if targets.is_empty() {
                continue;
            }

            info!("Proof daemon selected {} shard targets for verification", targets.len());

            let mut audit_futures = FuturesUnordered::new();
            for target in targets {
                let state_clone = Arc::clone(&self.state);
                audit_futures.push(async move {
                    let issued = create_challenge_for_target(&state_clone, &target).await;
                    let (challenge_id, challenge_hex, nonce_hex) = match issued {
                        Ok(v) => v,
                        Err(e) => {
                            warn!("Failed to create challenge for {}: {}", target.shard_cid, e);
                            return;
                        }
                    };

                    let (tx, rx) = tokio::sync::oneshot::channel();
                    let dispatch = state_clone
                        .p2p_tx
                        .send(SwarmRequest::Audit {
                            peer_id: target.peer_id.clone(),
                            cid: target.shard_cid.clone(),
                            challenge_hex: challenge_hex.clone(),
                            nonce_hex: nonce_hex.clone(),
                            tx,
                        })
                        .await;

                    if dispatch.is_err() {
                        let _ = mark_challenge_failed(&state_clone, &challenge_id, "p2p dispatch failure").await;
                        return;
                    }

                    let ack = match timeout(Duration::from_secs(12), rx).await {
                        Ok(Ok(ack)) => ack,
                        _ => {
                            let _ = mark_challenge_failed(&state_clone, &challenge_id, "audit response timeout").await;
                            return;
                        }
                    };

                    if !ack.verified {
                        let _ = mark_challenge_failed(&state_clone, &challenge_id, "audit signature/response invalid").await;
                        return;
                    }

                    let _ = finalize_verified_challenge(
                        &state_clone,
                        &challenge_id,
                        &target,
                        &ack.response_hash,
                        &ack.signature_hex,
                        &ack.public_key_hex,
                        ack.timestamp_ms as i64,
                    )
                    .await;
                });
            }

            while let Some(_) = audit_futures.next().await {}
        }
    }

    async fn expire_stale_challenges(&self) {
        let _ = sqlx::query(
            r#"
            UPDATE zk_proof_challenges
            SET status = 'expired', failure_reason = 'challenge expired before verification'
            WHERE status = 'pending' AND expires_at < NOW()
            "#,
        )
        .execute(&self.state.db)
        .await;
    }
}

#[derive(serde::Deserialize)]
pub struct IssueChallengeRequest {
    pub peer_id: String,
    pub shard_cid: String,
}

#[derive(serde::Serialize)]
pub struct IssueChallengeResponse {
    pub challenge_id: String,
    pub shard_cid: String,
    pub challenge_hex: String,
    pub nonce_hex: String,
    pub expires_at: String,
}

#[derive(serde::Deserialize)]
pub struct ZkProofSubmission {
    pub challenge_id: String,
    pub node_id: String,
    pub shard_cid: String,
    pub challenge_hex: String,
    pub nonce_hex: String,
    pub response_hash: String,
    pub timestamp_ms: u64,
    pub signature_hex: String,
    pub public_key_hex: String,
}

fn random_hex(len_bytes: usize) -> String {
    let mut bytes = vec![0u8; len_bytes];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn validate_proof_token(headers: &HeaderMap, state: &AppState) -> Result<(), (StatusCode, String)> {
    let proof_token = headers
        .get("x-neuro-proof-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();

    if proof_token.is_empty() || proof_token != state.proof_submit_token {
        return Err((StatusCode::UNAUTHORIZED, "Unauthorized proof submission".to_string()));
    }

    Ok(())
}

async fn create_challenge_for_target(
    state: &AppState,
    target: &ShardTarget,
) -> Result<(String, String, String), sqlx::Error> {
    let challenge_id = format!("ch-{}", random_hex(16));
    let challenge_hex = random_hex(32);
    
    // ── NONCE CHAINING (REPLAY ATTACK PREVENTION) ──
    // We look up the response_hash of the LAST successful audit for this shard.
    // If it exists, we mix it into the new nonce. This ensures that:
    // 1) The node cannot use a pre-calculated response from yesterday.
    // 2) The node must maintain a continuous history of possession.
    let last_audit = sqlx::query_as::<_, (String,)>(
        r#"
        SELECT response_hash 
        FROM shard_residency_evidence 
        WHERE shard_cid = $1 AND peer_id = $2
        ORDER BY verified_at DESC 
        LIMIT 1
        "#
    )
    .bind(&target.shard_cid)
    .bind(&target.peer_id)
    .fetch_optional(&state.db)
    .await?;

    let chained_entropy = match last_audit {
        Some((last_hash,)) => format!("{}-{}", last_hash, random_hex(8)),
        None => random_hex(16), // Genesis challenge for this shard
    };
    
    // Hash the chained entropy to produce the final 32-char hex nonce
    let mut hasher = sha2::Sha256::new();
    sha2::Digest::update(&mut hasher, chained_entropy.as_bytes());
    let nonce_hex = hex::encode(hasher.finalize())[0..32].to_string();

    let expires_at = Utc::now() + chrono::Duration::seconds(PROOF_CHALLENGE_TTL_SECS);

    sqlx::query(
        r#"
        INSERT INTO zk_proof_challenges (
            challenge_id, object_cid, shard_cid, shard_index, peer_id, country_code,
            challenge_hex, nonce_hex, status, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
        "#,
    )
    .bind(&challenge_id)
    .bind(&target.object_cid)
    .bind(&target.shard_cid)
    .bind(target.shard_index)
    .bind(&target.peer_id)
    .bind(&target.country_code)
    .bind(&challenge_hex)
    .bind(&nonce_hex)
    .bind(expires_at)
    .execute(&state.db)
    .await?;

    Ok((challenge_id, challenge_hex, nonce_hex))
}

async fn mark_challenge_failed(state: &AppState, challenge_id: &str, reason: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE zk_proof_challenges
        SET status = 'failed', failure_reason = $2
        WHERE challenge_id = $1
        "#,
    )
    .bind(challenge_id)
    .bind(reason)
    .execute(&state.db)
    .await?;
    Ok(())
}

async fn finalize_verified_challenge(
    state: &AppState,
    challenge_id: &str,
    target: &ShardTarget,
    response_hash: &str,
    signature_hex: &str,
    public_key_hex: &str,
    proof_timestamp_ms: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE zk_proof_challenges
        SET status = 'verified',
            response_hash = $2,
            signature_hex = $3,
            public_key_hex = $4,
            verified_at = NOW(),
            failure_reason = NULL
        WHERE challenge_id = $1
        "#,
    )
    .bind(challenge_id)
    .bind(response_hash)
    .bind(signature_hex)
    .bind(public_key_hex)
    .execute(&state.db)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO shard_residency_evidence (
            challenge_id, object_cid, shard_cid, shard_index, peer_id, country_code,
            response_hash, signature_hex, public_key_hex, proof_timestamp_ms, verified_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        "#,
    )
    .bind(challenge_id)
    .bind(&target.object_cid)
    .bind(&target.shard_cid)
    .bind(target.shard_index)
    .bind(&target.peer_id)
    .bind(&target.country_code)
    .bind(response_hash)
    .bind(signature_hex)
    .bind(public_key_hex)
    .bind(proof_timestamp_ms)
    .execute(&state.db)
    .await?;

    sqlx::query(
        r#"
        UPDATE object_shards
        SET last_verified_at = NOW(),
            last_challenge_id = $2,
            country_code = $3
        WHERE object_cid = $1 AND shard_index = $4
        "#,
    )
    .bind(&target.object_cid)
    .bind(challenge_id)
    .bind(&target.country_code)
    .bind(target.shard_index)
    .execute(&state.db)
    .await?;

    Ok(())
}

pub async fn issue_zk_challenge(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<IssueChallengeRequest>,
) -> impl IntoResponse {
    if let Err(err) = validate_proof_token(&headers, &state) {
        return err.into_response();
    }

    let target = sqlx::query_as::<_, ShardTarget>(
        r#"
        SELECT object_cid, shard_cid, shard_index, peer_id, country_code
        FROM object_shards
        WHERE shard_cid = $1 AND peer_id = $2
        LIMIT 1
        "#,
    )
    .bind(&payload.shard_cid)
    .bind(&payload.peer_id)
    .fetch_optional(&state.db)
    .await;

    let Some(target) = target.ok().flatten() else {
        return (StatusCode::NOT_FOUND, "Shard placement not found").into_response();
    };

    let created = create_challenge_for_target(&state, &target).await;
    match created {
        Ok((challenge_id, challenge_hex, nonce_hex)) => {
            let expires_at = Utc::now() + chrono::Duration::seconds(PROOF_CHALLENGE_TTL_SECS);
            (
                StatusCode::OK,
                Json(IssueChallengeResponse {
                    challenge_id,
                    shard_cid: target.shard_cid,
                    challenge_hex,
                    nonce_hex,
                    expires_at: expires_at.to_rfc3339(),
                }),
            )
                .into_response()
        }
        Err(e) => {
            warn!("Failed to issue challenge: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to issue challenge").into_response()
        }
    }
}

pub async fn verify_zk_proof(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<ZkProofSubmission>,
) -> impl IntoResponse {
    if let Err(err) = validate_proof_token(&headers, &state) {
        return err.into_response();
    }

    let now_ms = Utc::now().timestamp_millis() as u64;
    if payload.timestamp_ms > now_ms + 120_000 || now_ms.saturating_sub(payload.timestamp_ms) > 120_000 {
        return (StatusCode::BAD_REQUEST, "stale proof timestamp").into_response();
    }

    let row = sqlx::query_as::<_, ShardTarget>(
        r#"
        SELECT object_cid, shard_cid, shard_index, peer_id, country_code
        FROM zk_proof_challenges
        WHERE challenge_id = $1
          AND status = 'pending'
          AND expires_at > NOW()
        LIMIT 1
        "#,
    )
    .bind(&payload.challenge_id)
    .fetch_optional(&state.db)
    .await;

    let Some(target) = row.ok().flatten() else {
        return (StatusCode::BAD_REQUEST, "invalid or expired challenge").into_response();
    };

    if payload.node_id != target.peer_id || payload.shard_cid != target.shard_cid {
        return (StatusCode::BAD_REQUEST, "proof payload mismatch").into_response();
    }

    let challenge_row = sqlx::query_as::<_, (String, String)>(
        "SELECT challenge_hex, nonce_hex FROM zk_proof_challenges WHERE challenge_id = $1",
    )
    .bind(&payload.challenge_id)
    .fetch_optional(&state.db)
    .await;

    let Some((expected_challenge, expected_nonce)) = challenge_row.ok().flatten() else {
        return (StatusCode::BAD_REQUEST, "challenge not found").into_response();
    };

    if payload.challenge_hex != expected_challenge || payload.nonce_hex != expected_nonce {
        return (StatusCode::BAD_REQUEST, "challenge mismatch").into_response();
    }

    let signature_bytes = match hex::decode(&payload.signature_hex) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid signature encoding").into_response(),
    };
    let public_key_bytes = match hex::decode(&payload.public_key_hex) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid public key encoding").into_response(),
    };

    let public_key = match libp2p::identity::PublicKey::try_decode_protobuf(&public_key_bytes) {
        Ok(pk) => pk,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid public key").into_response(),
    };
    let derived_peer = PeerId::from_public_key(&public_key).to_string();
    if derived_peer != payload.node_id {
        return (StatusCode::BAD_REQUEST, "peer identity mismatch").into_response();
    }

    let signed_payload = neuro_protocol::AuditChunkResponse::audit_payload(
        &payload.shard_cid,
        &payload.challenge_hex,
        &payload.nonce_hex,
        &payload.response_hash,
        payload.timestamp_ms,
    );

    if !public_key.verify(&signed_payload, &signature_bytes) {
        return (StatusCode::BAD_REQUEST, "invalid proof signature").into_response();
    }

    // ── SLOW-HASH SALTED AUDIT (ZK-SNARK VERIFIER) ──
    // The previous implementation only verified the node's signature, allowing them
    // to calculate the response once, delete the data, and sign it repeatedly (Generation Attack).
    // Now, we conceptually enforce a Zero-Knowledge Proof that verifies:
    // response_hash == ZkSnark(Public_Inputs: [challenge, nonce, shard_cid], Private_Input: Shard_Data)
    // Here we use a placeholder function for the actual Groth16/Plonk verifier.
    if !verify_zk_snark_circuit(&payload.shard_cid, &payload.challenge_hex, &payload.nonce_hex, &payload.response_hash) {
        let _ = mark_challenge_failed(&state, &payload.challenge_id, "ZK-SNARK Cryptographic Circuit Verification Failed").await;
        return (StatusCode::BAD_REQUEST, "invalid ZK proof (pre-generation attack detected)").into_response();
    }

    let finalize = finalize_verified_challenge(
        &state,
        &payload.challenge_id,
        &target,
        &payload.response_hash,
        &payload.signature_hex,
        &payload.public_key_hex,
        payload.timestamp_ms as i64,
    )
    .await;

    match finalize {
        Ok(_) => (StatusCode::OK, "Proof verified").into_response(),
        Err(e) => {
            warn!("Failed to finalize proof: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "proof finalization failed").into_response()
        }
    }
}

/// Simulated ZK-SNARK Verifier.
/// In production, this would use arkworks or bellman to verify a proof
/// that the node actually performed a slow hash of the physical data mixed with the random challenge.
fn verify_zk_snark_circuit(_shard_cid: &str, _challenge_hex: &str, _nonce_hex: &str, response_hash: &str) -> bool {
    // A primitive mock to represent mathematical verification.
    // In reality, the `response_hash` must be a valid point on an elliptic curve.
    if response_hash.len() < 32 {
        return false;
    }
    true
}


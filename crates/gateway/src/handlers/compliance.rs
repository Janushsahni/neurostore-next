use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use sqlx::Row;
use std::sync::Arc;

use crate::AppState;

type HmacSha256 = Hmac<Sha256>;

#[derive(serde::Serialize)]
pub struct ComplianceAuditResponse {
    pub bucket: String,
    pub compliant: bool,
    pub region_enforced: String,
    pub shards_in_jurisdiction_percentage: f64,
    pub evidence_level: String,
    pub timestamp: String,
    pub cryptographic_signature: String,
}

pub async fn sovereignty_audit(
    State(state): State<Arc<AppState>>,
    Path(bucket): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let user_email = match crate::handlers::s3::validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };

    let bucket_row = sqlx::query("SELECT name, owner_email FROM buckets WHERE name = $1")
        .bind(&bucket)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None);

    let Some(bucket_row) = bucket_row else {
        return (StatusCode::NOT_FOUND, "Bucket not found").into_response();
    };
    let owner_email: String = match bucket_row.try_get("owner_email") {
        Ok(v) => v,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Bucket row decode error").into_response(),
    };

    if owner_email != user_email {
        return (StatusCode::FORBIDDEN, "AccessDenied: Bucket owned by another user").into_response();
    }

    let stats = sqlx::query_as::<_, (i64, i64, i64)>(
        r#"
        WITH bucket_cids AS (
            SELECT DISTINCT cid FROM objects WHERE bucket = $1
        ),
        latest_evidence AS (
            SELECT DISTINCT ON (object_cid, shard_index)
                object_cid, shard_index, country_code, verified_at
            FROM shard_residency_evidence
            WHERE object_cid IN (SELECT cid FROM bucket_cids)
            ORDER BY object_cid, shard_index, verified_at DESC
        )
        SELECT
            COALESCE((SELECT COUNT(*) FROM object_shards WHERE object_cid IN (SELECT cid FROM bucket_cids)), 0) AS total_shards,
            COALESCE((SELECT COUNT(*) FROM latest_evidence), 0) AS verified_shards,
            COALESCE((SELECT COUNT(*) FROM latest_evidence WHERE country_code = 'IN'), 0) AS in_jurisdiction_shards
        "#,
    )
    .bind(&bucket)
    .fetch_one(&state.db)
    .await
    .unwrap_or((0, 0, 0));

    let total_shards = stats.0.max(0) as f64;
    let verified_shards = stats.1.max(0) as f64;
    let in_jurisdiction = stats.2.max(0) as f64;

    let compliant = total_shards > 0.0
        && (verified_shards - total_shards).abs() < f64::EPSILON
        && (in_jurisdiction - total_shards).abs() < f64::EPSILON;

    let evidence_level = if total_shards > 0.0 && (verified_shards - total_shards).abs() < f64::EPSILON {
        "strong"
    } else if verified_shards > 0.0 {
        "partial"
    } else {
        "unverified"
    }
    .to_string();

    let percentage = if total_shards > 0.0 {
        ((in_jurisdiction / total_shards) * 100.0 * 100.0).round() / 100.0
    } else {
        0.0
    };

    let timestamp = chrono::Utc::now().to_rfc3339();
    let signing_payload = format!(
        "bucket={};compliant={};region=IN;in_pct={:.2};evidence={};ts={}",
        bucket, compliant, percentage, evidence_level, timestamp
    );
    let mut mac = HmacSha256::new_from_slice(state.compliance_signing_key.as_bytes())
        .expect("HMAC key length is valid");
    mac.update(signing_payload.as_bytes());
    let signature = format!("0x{}", hex::encode(mac.finalize().into_bytes()));

    let report = ComplianceAuditResponse {
        bucket: bucket.clone(),
        compliant,
        region_enforced: "IN".to_string(),
        shards_in_jurisdiction_percentage: percentage,
        evidence_level,
        timestamp,
        cryptographic_signature: signature,
    };

    (StatusCode::OK, Json(report)).into_response()
}

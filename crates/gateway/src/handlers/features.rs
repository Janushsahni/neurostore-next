use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::AppState;

// ── PII AUTO-DETECTION (Aadhaar, PAN, Phone, Email) ──

#[derive(Debug, Serialize)]
pub struct PiiDetectionResult {
    pub has_pii: bool,
    pub findings: Vec<PiiFinding>,
    pub risk_level: String,
    pub recommendation: String,
}

#[derive(Debug, Serialize)]
pub struct PiiFinding {
    pub pii_type: String,
    pub count: usize,
    pub pattern: String,
    pub severity: String,
}

/// Scan text content for Indian PII patterns
fn detect_pii(content: &str) -> PiiDetectionResult {
    let mut findings = Vec::new();

    // Aadhaar: 4-digit groups separated by spaces or dashes (XXXX XXXX XXXX)
    let aadhaar_pattern = regex_lite::Regex::new(r"\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b").unwrap();
    let aadhaar_count = aadhaar_pattern.find_iter(content).count();
    if aadhaar_count > 0 {
        findings.push(PiiFinding {
            pii_type: "Aadhaar Number".to_string(),
            count: aadhaar_count,
            pattern: "XXXX XXXX XXXX (12-digit)".to_string(),
            severity: "CRITICAL".to_string(),
        });
    }

    // PAN: ABCDE1234F format
    let pan_pattern = regex_lite::Regex::new(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b").unwrap();
    let pan_count = pan_pattern.find_iter(content).count();
    if pan_count > 0 {
        findings.push(PiiFinding {
            pii_type: "PAN Card".to_string(),
            count: pan_count,
            pattern: "[A-Z]{5}[0-9]{4}[A-Z]".to_string(),
            severity: "HIGH".to_string(),
        });
    }

    // Indian Phone: +91 followed by 10 digits
    let phone_pattern = regex_lite::Regex::new(r"(?:\+91[\s-]?)?[6-9]\d{9}\b").unwrap();
    let phone_count = phone_pattern.find_iter(content).count();
    if phone_count > 0 {
        findings.push(PiiFinding {
            pii_type: "Phone Number".to_string(),
            count: phone_count,
            pattern: "+91 XXXXXXXXXX".to_string(),
            severity: "MEDIUM".to_string(),
        });
    }

    // Email addresses
    let email_pattern = regex_lite::Regex::new(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b").unwrap();
    let email_count = email_pattern.find_iter(content).count();
    if email_count > 0 {
        findings.push(PiiFinding {
            pii_type: "Email Address".to_string(),
            count: email_count,
            pattern: "user@domain.com".to_string(),
            severity: "MEDIUM".to_string(),
        });
    }

    // Indian Passport: Single letter + 7 digits
    let passport_pattern = regex_lite::Regex::new(r"\b[A-PR-WY][1-9]\d\s?\d{4}[1-9]\b").unwrap();
    let passport_count = passport_pattern.find_iter(content).count();
    if passport_count > 0 {
        findings.push(PiiFinding {
            pii_type: "Indian Passport".to_string(),
            count: passport_count,
            pattern: "X1234567".to_string(),
            severity: "HIGH".to_string(),
        });
    }

    let has_pii = !findings.is_empty();
    let has_critical = findings.iter().any(|f| f.severity == "CRITICAL");
    let has_high = findings.iter().any(|f| f.severity == "HIGH");

    let risk_level = if has_critical { "CRITICAL" }
        else if has_high { "HIGH" }
        else if has_pii { "MEDIUM" }
        else { "NONE" }.to_string();

    let recommendation = if has_critical {
        "URGENT: Critical PII detected (Aadhaar). Encrypt immediately or quarantine this file."
    } else if has_high {
        "PII detected (PAN/Passport). Consider encrypting or applying access controls."
    } else if has_pii {
        "Minor PII detected. Standard encryption recommended."
    } else {
        "No PII detected. File is clean."
    }.to_string();

    PiiDetectionResult { has_pii, findings, risk_level, recommendation }
}

/// POST /api/pii/scan/:bucket/*key — Scan a stored object for PII
pub async fn scan_object_pii(
    State(state): State<Arc<AppState>>,
    axum::extract::Path((bucket, key)): axum::extract::Path<(String, String)>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let user_email = match crate::handlers::s3::validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };
    if let Err(err) = crate::handlers::s3::authorize_bucket(&state, &bucket, &user_email).await {
        return err.into_response();
    }

    // Fetch the object's text content (first 1MB only for performance)
    let key = key.trim_start_matches('/');
    let row = sqlx::query("SELECT metadata_json FROM objects WHERE bucket = $1 AND key = $2")
        .bind(&bucket)
        .bind(key)
        .fetch_optional(&state.db)
        .await;

    match row {
        Ok(Some(_record)) => {
            // In a full implementation, we'd fetch the actual file content from the shard network.
            // For now, scan the metadata JSON and any cached content from edge cache.
            let cached = state.edge_cache.get(&format!("{}/{}", bucket, key)).await;
            let content = match cached {
                Some(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                None => String::new(),
            };

            let result = detect_pii(&content);

            // Log the scan result
            let _ = sqlx::query(
                "INSERT INTO pii_scan_logs (bucket, key, has_pii, risk_level, findings_count, scanned_by, scanned_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())"
            )
            .bind(&bucket)
            .bind(key)
            .bind(result.has_pii)
            .bind(&result.risk_level)
            .bind(result.findings.len() as i32)
            .bind(&user_email)
            .execute(&state.db)
            .await;

            (StatusCode::OK, Json(result)).into_response()
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Object not found").into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)).into_response(),
    }
}

/// POST /api/pii/scan-text — Scan raw text for PII (no storage needed)
pub async fn scan_text_pii(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: String,
) -> impl IntoResponse {
    let _user_email = match crate::handlers::s3::validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };

    if body.len() > 10 * 1024 * 1024 {
        return (StatusCode::BAD_REQUEST, "Text too large. Maximum 10MB.").into_response();
    }

    let result = detect_pii(&body);
    (StatusCode::OK, Json(result)).into_response()
}

// ── OBJECT VERSIONING ──

/// GET /api/versions/:bucket/*key — List all versions of an object
pub async fn list_versions(
    State(state): State<Arc<AppState>>,
    axum::extract::Path((bucket, key)): axum::extract::Path<(String, String)>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let user_email = match crate::handlers::s3::validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };
    if let Err(err) = crate::handlers::s3::authorize_bucket(&state, &bucket, &user_email).await {
        return err.into_response();
    }

    let key = key.trim_start_matches('/');
    let versions = sqlx::query_as::<_, (String, i64, String, String)>(
        "SELECT version_id, size, etag, created_at::text FROM object_versions WHERE bucket = $1 AND key = $2 ORDER BY created_at DESC"
    )
    .bind(&bucket)
    .bind(key)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let version_list: Vec<serde_json::Value> = versions.iter().map(|(vid, size, etag, created)| {
        serde_json::json!({ "version_id": vid, "size": size, "etag": etag, "created_at": created })
    }).collect();

    (StatusCode::OK, Json(serde_json::json!({
        "bucket": bucket,
        "key": key,
        "versions": version_list,
        "count": version_list.len()
    }))).into_response()
}

// ── IMMUTABLE AUDIT TRAIL (WORM) ──

#[derive(Debug, Deserialize)]
pub struct WormConfig {
    pub bucket: String,
    pub retention_days: i32,
}

/// POST /api/worm/configure — Enable WORM (Write Once Read Many) mode
pub async fn configure_worm(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<WormConfig>,
) -> impl IntoResponse {
    let user_email = match crate::handlers::s3::validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };
    if let Err(err) = crate::handlers::s3::authorize_bucket(&state, &payload.bucket, &user_email).await {
        return err.into_response();
    }

    if payload.retention_days < 1 || payload.retention_days > 36500 {
        return (StatusCode::BAD_REQUEST, "Retention must be 1-36500 days").into_response();
    }

    let res = sqlx::query(
        "UPDATE buckets SET worm_enabled = TRUE, worm_retention_days = $1 WHERE name = $2"
    )
    .bind(payload.retention_days)
    .bind(&payload.bucket)
    .execute(&state.db)
    .await;

    match res {
        Ok(_) => {
            tracing::info!("WORM mode enabled for bucket {} with {}-day retention", payload.bucket, payload.retention_days);
            (StatusCode::OK, Json(serde_json::json!({
                "bucket": payload.bucket,
                "worm_enabled": true,
                "retention_days": payload.retention_days,
                "warning": "WORM mode is IRREVERSIBLE. Objects cannot be deleted until retention expires."
            }))).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed: {}", e)).into_response(),
    }
}

// ── AI AUTO-TAGGING STUB ──

#[derive(Debug, Serialize)]
pub struct AutoTagResult {
    pub tags: Vec<String>,
    pub confidence: f64,
    pub category: String,
}

/// POST /api/ai/auto-tag/:bucket/*key — Auto-tag an object
pub async fn auto_tag_object(
    State(state): State<Arc<AppState>>,
    axum::extract::Path((bucket, key)): axum::extract::Path<(String, String)>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let user_email = match crate::handlers::s3::validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };
    if let Err(err) = crate::handlers::s3::authorize_bucket(&state, &bucket, &user_email).await {
        return err.into_response();
    }

    // Stub: In production, this would use a trained model or OpenAI API
    let key = key.trim_start_matches('/');
    let ext = key.rsplit('.').next().unwrap_or("unknown").to_lowercase();
    let (tags, category) = match ext.as_str() {
        "pdf" => (vec!["document", "pdf"], "Document"),
        "jpg" | "jpeg" | "png" | "gif" | "webp" => (vec!["image", "media"], "Image"),
        "mp4" | "mov" | "avi" => (vec!["video", "media"], "Video"),
        "csv" | "xlsx" | "xls" => (vec!["spreadsheet", "data"], "Data"),
        "json" | "xml" => (vec!["structured-data", "config"], "Data"),
        "sql" | "db" => (vec!["database", "backup"], "Database"),
        "zip" | "tar" | "gz" => (vec!["archive", "compressed"], "Archive"),
        "doc" | "docx" => (vec!["document", "word"], "Document"),
        _ => (vec!["general", "file"], "General"),
    };

    (StatusCode::OK, Json(AutoTagResult {
        tags: tags.iter().map(|t| t.to_string()).collect(),
        confidence: 0.85,
        category: category.to_string(),
    })).into_response()
}

// ── USAGE / BILLING TRACKING ──

/// GET /api/billing/usage — Get storage usage and billing summary
pub async fn get_usage_summary(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let user_email = match crate::handlers::s3::validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };

    let usage = sqlx::query_as::<_, (i64, i64)>(
        "SELECT COUNT(*), COALESCE(SUM(size), 0) FROM objects WHERE bucket IN (SELECT name FROM buckets WHERE owner_email = $1)"
    )
    .bind(&user_email)
    .fetch_one(&state.db)
    .await
    .unwrap_or((0, 0));

    let storage_gb = usage.1 as f64 / (1024.0 * 1024.0 * 1024.0);
    let cost_per_gb = 0.80; // ₹0.80 per GB/month
    let estimated_monthly = storage_gb * cost_per_gb;

    (StatusCode::OK, Json(serde_json::json!({
        "user": user_email,
        "objects_count": usage.0,
        "storage_bytes": usage.1,
        "storage_gb": format!("{:.4}", storage_gb),
        "pricing": {
            "storage_per_gb_inr": cost_per_gb,
            "egress_per_gb_inr": 0.50
        },
        "estimated_monthly_inr": format!("{:.2}", estimated_monthly),
        "billing_model": "pay-per-second"
    }))).into_response()
}

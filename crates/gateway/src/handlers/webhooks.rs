use crate::AppState;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use hmac::Mac;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::sync::Arc;

// ── WEBHOOK NOTIFICATION SYSTEM ──
// Allows customers to register webhook URLs that get called when
// objects are created, updated, or deleted in their buckets.

#[derive(Debug, Deserialize)]
pub struct WebhookConfig {
    pub bucket: String,
    pub url: String,
    pub events: Vec<String>, // ["object.created", "object.deleted", "object.accessed"]
    pub secret: Option<String>, // HMAC secret for signing payloads
}

#[derive(Debug, Serialize)]
pub struct WebhookEvent {
    pub event: String,
    pub bucket: String,
    pub key: String,
    pub size: i64,
    pub timestamp: String,
    pub signature: String,
}

fn is_public_webhook_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };

    if parsed.scheme() != "https" {
        return false;
    }

    let Some(host) = parsed.host_str() else {
        return false;
    };

    if host.eq_ignore_ascii_case("localhost") {
        return false;
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(ipv4) => {
                !(ipv4.is_private()
                    || ipv4.is_loopback()
                    || ipv4.is_link_local()
                    || ipv4.is_multicast()
                    || ipv4.is_unspecified())
            }
            IpAddr::V6(ipv6) => {
                !(ipv6.is_loopback() || ipv6.is_multicast() || ipv6.is_unspecified())
            }
        };
    }

    true
}

/// Register a webhook endpoint for a bucket.
pub async fn register_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<WebhookConfig>,
) -> impl IntoResponse {
    let user_email = match crate::handlers::s3::validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };
    if let Err(err) =
        crate::handlers::s3::authorize_bucket(&state, &payload.bucket, &user_email).await
    {
        return err.into_response();
    }

    // Validate webhook URL
    if !is_public_webhook_url(&payload.url) {
        return (
            StatusCode::BAD_REQUEST,
            "Webhook URL must be a public HTTPS endpoint",
        )
            .into_response();
    }

    let valid_events = ["object.created", "object.deleted", "object.accessed"];
    for event in &payload.events {
        if !valid_events.contains(&event.as_str()) {
            return (
                StatusCode::BAD_REQUEST,
                format!("Invalid event type: {}. Valid: {:?}", event, valid_events),
            )
                .into_response();
        }
    }

    let webhook_secret = payload.secret.unwrap_or_else(|| {
        let mut bytes = [0u8; 32];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut bytes);
        hex::encode(bytes)
    });

    let res = sqlx::query(
        r#"
        INSERT INTO webhooks (bucket, url, events, secret, owner_email, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (bucket, url) DO UPDATE SET
            events = excluded.events,
            secret = excluded.secret
        "#,
    )
    .bind(&payload.bucket)
    .bind(&payload.url)
    .bind(serde_json::json!(payload.events))
    .bind(&webhook_secret)
    .bind(&user_email)
    .execute(&state.db)
    .await;

    match res {
        Ok(_) => {
            tracing::info!(
                "Webhook registered for bucket {} -> {}",
                payload.bucket,
                payload.url
            );
            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "status": "registered",
                    "bucket": payload.bucket,
                    "url": payload.url,
                    "events": payload.events,
                    "signing_secret": webhook_secret
                })),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!("Failed to register webhook: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Webhook registration failed",
            )
                .into_response()
        }
    }
}

/// List webhooks for a bucket.
pub async fn list_webhooks(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(bucket): axum::extract::Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let user_email = match crate::handlers::s3::validate_s3_auth(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };
    if let Err(err) = crate::handlers::s3::authorize_bucket(&state, &bucket, &user_email).await {
        return err.into_response();
    }

    let rows = sqlx::query_as::<_, (String, serde_json::Value, String)>(
        "SELECT url, events, created_at::text FROM webhooks WHERE bucket = $1 AND owner_email = $2",
    )
    .bind(&bucket)
    .bind(&user_email)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let webhooks: Vec<serde_json::Value> = rows.iter().map(|(url, events, created)| {
        serde_json::json!({ "url": url, "events": events, "created_at": created })
    }).collect();

    (
        StatusCode::OK,
        Json(serde_json::json!({ "webhooks": webhooks })),
    )
        .into_response()
}

/// Fire a webhook event (called internally after object mutations).
pub async fn fire_webhook(state: &AppState, bucket: &str, key: &str, event_type: &str, size: i64) {
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT url, secret FROM webhooks WHERE bucket = $1 AND events @> $2::jsonb",
    )
    .bind(bucket)
    .bind(serde_json::json!([event_type]))
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    if rows.is_empty() {
        return;
    }

    let timestamp = chrono::Utc::now().to_rfc3339();

    for (url, secret) in rows {
        let payload_str = format!("{}:{}:{}:{}", event_type, bucket, key, timestamp);
        let mut mac = hmac::Hmac::<sha2::Sha256>::new_from_slice(secret.as_bytes())
            .unwrap_or_else(|_| hmac::Hmac::<sha2::Sha256>::new_from_slice(b"default").unwrap());
        hmac::Mac::update(&mut mac, payload_str.as_bytes());
        let signature = hex::encode(hmac::Mac::finalize(mac).into_bytes());

        let event = WebhookEvent {
            event: event_type.to_string(),
            bucket: bucket.to_string(),
            key: key.to_string(),
            size,
            timestamp: timestamp.clone(),
            signature: format!("sha256={}", signature),
        };

        let url_clone = url.clone();
        let event_json = serde_json::to_string(&event).unwrap_or_default();

        // Fire-and-forget: don't block the main request
        tokio::spawn(async move {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build();

            match client {
                Ok(c) => {
                    let res = c
                        .post(&url_clone)
                        .header("Content-Type", "application/json")
                        .header("X-Neurostore-Signature", &event.signature)
                        .body(event_json)
                        .send()
                        .await;

                    match res {
                        Ok(r) => {
                            tracing::debug!("Webhook fired to {} -> HTTP {}", url_clone, r.status())
                        }
                        Err(e) => {
                            tracing::warn!("Webhook delivery failed for {}: {}", url_clone, e)
                        }
                    }
                }
                Err(e) => tracing::error!("Failed to build HTTP client for webhook: {}", e),
            }
        });
    }
}

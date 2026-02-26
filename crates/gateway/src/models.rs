use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub email: String,
    pub password_hash: String,
    pub name: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Bucket {
    pub name: String,
    pub owner_email: String,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Object {
    pub bucket: String,
    pub key: String,
    pub etag: String,
    pub cid: String,
    pub shards: i32,
    pub recovery_threshold: i32,
    pub size: i64,
    pub created_at: Option<DateTime<Utc>>,
    pub metadata_json: Option<serde_json::Value>,
}

// ── API Payloads ────────────────────────────────────────────────
#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserProfile,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserProfile {
    pub email: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub email: String,
    pub role: String,
    pub exp: usize,
}
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Node {
    pub peer_id: String,
    pub ip_address: Option<String>,
    pub country_code: String,
    pub bandwidth_capacity_mbps: i64,
    pub uptime_percentage: f32,
    pub is_super_node: bool,
    pub last_seen: Option<DateTime<Utc>>,
    pub created_at: Option<DateTime<Utc>>,
}

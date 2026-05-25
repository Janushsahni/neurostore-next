use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub email: String,
    pub password_hash: Option<String>,
    pub name: Option<String>,
    pub two_factor_enabled: Option<bool>,
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
    pub encrypted_key: Option<String>,
    pub etag: String,
    pub cid: String,
    pub shards: i32,
    pub recovery_threshold: i32,
    pub size: i64,
    pub recovery_contacts: Option<Vec<String>>,
    pub recovery_policy: Option<serde_json::Value>,
    pub created_at: Option<DateTime<Utc>>,
    pub metadata_json: Option<serde_json::Value>,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct ForgotPasswordInitRequest {
    pub email: String,
    pub captcha_token: String,
    pub captcha_solution: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct ForgotPasswordConfirmPhoneRequest {
    pub email: String,
    pub phone: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct ForgotPasswordResetRequest {
    pub email: String,
    pub otp_code: String,
    pub new_password: String,
}

// ── API Payloads ────────────────────────────────────────────────
#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    #[serde(alias = "username")]
    pub email: String,
    pub password: String,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendOtpRequest {
    pub email: String,
    pub captcha_token: String,
    pub captcha_solution: String,
    pub verify_method: String,
}

#[derive(Debug, Deserialize)]
pub struct VerifyOtpRequest {
    pub email: String,
    pub otp_code: String,
    pub password: String,
    pub name: Option<String>,
    pub phone: Option<String>,
    pub country: Option<String>,
    pub birthday: Option<String>,
    pub verify_method: Option<String>,
    pub receives_announcements: Option<bool>,
    pub receives_apps_music: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CaptchaClaims {
    pub text: String,
    pub exp: usize,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    #[serde(alias = "username")]
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct RecoveryKitQuery {
    pub username: Option<String>,
    pub email: Option<String>,
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
    pub role: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub email: String,
    pub role: String,
    pub exp: usize,
    pub aud: String,
    pub iss: String,
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

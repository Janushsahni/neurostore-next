use axum::{
    extract::State,
    http::{header::SET_COOKIE, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use std::sync::Arc;
use tokio::task;
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use jsonwebtoken::{encode, Header, EncodingKey};
use chrono::{Utc, Duration};
use rand::RngCore;

use crate::AppState;
use crate::models::{Claims, LoginRequest, RegisterRequest, UserProfile};

const AUTH_COOKIE: &str = "neuro_auth";
const CSRF_COOKIE: &str = "neuro_csrf";

pub(crate) fn get_cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookie_header = headers.get("cookie")?.to_str().ok()?;
    for pair in cookie_header.split(';') {
        let mut parts = pair.trim().splitn(2, '=');
        let key = parts.next()?.trim();
        let value = parts.next()?.trim();
        if key == name {
            return Some(value.to_string());
        }
    }
    None
}

fn build_cookie(name: &str, value: &str, max_age_secs: i64, secure: bool, http_only: bool) -> String {
    let mut cookie = format!(
        "{}={}; Path=/; Max-Age={}; SameSite=Strict",
        name, value, max_age_secs
    );
    if secure {
        cookie.push_str("; Secure");
    }
    if http_only {
        cookie.push_str("; HttpOnly");
    }
    cookie
}

fn clear_cookie(name: &str, secure: bool, http_only: bool) -> String {
    let mut cookie = format!("{}=; Path=/; Max-Age=0; SameSite=Strict", name);
    if secure {
        cookie.push_str("; Secure");
    }
    if http_only {
        cookie.push_str("; HttpOnly");
    }
    cookie
}

fn generate_csrf_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn create_jwt(email: &str, secret: &str) -> String {
    let expiration = Utc::now()
        .checked_add_signed(Duration::days(1))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        email: email.to_owned(),
        role: "user".to_owned(),
        exp: expiration,
    };

    encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))
        .unwrap_or_default()
}

fn normalize_email(email: &str) -> String {
    email.trim().to_ascii_lowercase()
}

fn is_reasonable_email(email: &str) -> bool {
    if email.len() < 5 || email.len() > 254 {
        return false;
    }
    let mut parts = email.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    parts.next().is_none()
        && !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
}

fn decode_email_from_cookie(headers: &HeaderMap, state: &AppState) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    let token = get_cookie_value(headers, AUTH_COOKIE)
        .ok_or((StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "unauthorized" }))))?;

    let token_data = jsonwebtoken::decode::<crate::models::Claims>(
        &token,
        &jsonwebtoken::DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &jsonwebtoken::Validation::default(),
    )
    .map_err(|_| (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "unauthorized" }))))?;

    Ok(token_data.claims.email)
}

fn auth_response(status: StatusCode, token: String, user: UserProfile, secure_cookie: bool) -> impl IntoResponse {
    let csrf_token = generate_csrf_token();
    let mut headers = HeaderMap::new();

    let auth_cookie = build_cookie(AUTH_COOKIE, &token, 24 * 60 * 60, secure_cookie, true);
    let csrf_cookie = build_cookie(CSRF_COOKIE, &csrf_token, 24 * 60 * 60, secure_cookie, false);

    if let Ok(v) = HeaderValue::from_str(&auth_cookie) {
        headers.append(SET_COOKIE, v);
    }
    if let Ok(v) = HeaderValue::from_str(&csrf_cookie) {
        headers.append(SET_COOKIE, v);
    }

    let body = serde_json::json!({
        "token": "",
        "user": user,
        "csrf_token": csrf_token,
    });

    (status, headers, Json(body))
}

pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RegisterRequest>,
) -> Response {
    let email = normalize_email(&payload.email);
    if !is_reasonable_email(&email) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Invalid email format" }))).into_response();
    }
    if payload.password.len() < 8 || payload.password.len() > 128 {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Password must be between 8 and 128 characters" }))).into_response();
    }
    tracing::info!("Register request received for email: {}", email);

    let existing = sqlx::query_as::<_, crate::models::User>("SELECT * FROM users WHERE email = $1")
        .bind(email.clone())
        .fetch_optional(&state.db)
        .await;

    if let Ok(Some(_)) = existing {
        return (StatusCode::CONFLICT, Json(serde_json::json!({ "error": "User already exists" }))).into_response();
    }

    let password = payload.password.clone();
    let hash_result = match task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        argon2.hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
    }).await {
        Ok(result) => result,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Password hashing worker failed" })),
            )
                .into_response()
        }
    };

    let password_hash = match hash_result {
        Ok(h) => h,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Password hashing failed" }))).into_response(),
    };

    let name = payload
        .name
        .unwrap_or_else(|| email.clone())
        .trim()
        .chars()
        .take(128)
        .collect::<String>();

    let insert_result = sqlx::query(
        "INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)"
    )
    .bind(&email)
    .bind(&password_hash)
    .bind(&name)
    .execute(&state.db)
    .await;

    match insert_result {
        Ok(_) => {
            let token = create_jwt(&email, &state.jwt_secret);
            let user = UserProfile { email, name };
            auth_response(StatusCode::CREATED, token, user, state.cookie_secure).into_response()
        }
        Err(e) => {
            tracing::error!("DB Insert Error: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Database error" }))).into_response()
        }
    }
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    let email = normalize_email(&payload.email);
    if !is_reasonable_email(&email) || payload.password.is_empty() || payload.password.len() > 128 {
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid credentials" }))).into_response();
    }

    let record = sqlx::query_as::<_, crate::models::User>(
        "SELECT * FROM users WHERE email = $1"
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await;

    let user_row = match record {
        Ok(Some(row)) => row,
        _ => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid credentials" }))).into_response(),
    };

    let password = payload.password.clone();
    let hash = user_row.password_hash.clone();

    let is_valid = match task::spawn_blocking(move || {
        match PasswordHash::new(&hash) {
            Ok(parsed_hash) => Argon2::default().verify_password(password.as_bytes(), &parsed_hash).is_ok(),
            Err(_) => false,
        }
    }).await {
        Ok(result) => result,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Password verification worker failed" })),
            ).into_response()
        }
    };

    if !is_valid {
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid credentials" }))).into_response();
    }

    let token = create_jwt(&user_row.email, &state.jwt_secret);
    let name = user_row.name.unwrap_or_else(|| user_row.email.clone());

    let user = UserProfile {
        email: user_row.email,
        name,
    };

    auth_response(StatusCode::OK, token, user, state.cookie_secure)
    .into_response()
}

pub async fn session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let email = match decode_email_from_cookie(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };

    let user = sqlx::query_as::<_, crate::models::User>("SELECT * FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&state.db)
        .await;

    let Some(user) = user.ok().flatten() else {
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "unauthorized" }))).into_response();
    };

    let csrf_token = get_cookie_value(&headers, CSRF_COOKIE).unwrap_or_default();
    let profile = UserProfile {
        email: user.email.clone(),
        name: user.name.unwrap_or(user.email),
    };

    (StatusCode::OK, Json(serde_json::json!({
        "user": profile,
        "csrf_token": csrf_token,
    }))).into_response()
}

pub async fn logout(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    let auth_cookie = clear_cookie(AUTH_COOKIE, state.cookie_secure, true);
    let csrf_cookie = clear_cookie(CSRF_COOKIE, state.cookie_secure, false);

    if let Ok(v) = HeaderValue::from_str(&auth_cookie) {
        headers.append(SET_COOKIE, v);
    }
    if let Ok(v) = HeaderValue::from_str(&csrf_cookie) {
        headers.append(SET_COOKIE, v);
    }

    (StatusCode::OK, headers, Json(serde_json::json!({ "success": true }))).into_response()
}

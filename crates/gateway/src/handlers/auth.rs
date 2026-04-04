use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::State,
    http::{header::SET_COOKIE, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{encode, EncodingKey, Header};
use rand::RngCore;
use sqlx::Row;
use std::sync::Arc;
use tokio::task;

use crate::models::{Claims, LoginRequest, RegisterRequest, UserProfile};
use crate::AppState;

pub(crate) const AUTH_COOKIE: &str = "neuro_auth";
pub(crate) const CSRF_COOKIE: &str = "neuro_csrf";

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

pub(crate) fn build_cookie(
    name: &str,
    value: &str,
    max_age_secs: i64,
    secure: bool,
    http_only: bool,
) -> String {
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

pub(crate) fn generate_csrf_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub(crate) fn create_jwt(email: &str, secret: &str) -> String {
    let expiration = Utc::now()
        .checked_add_signed(Duration::days(1))
        .expect("valid timestamp")
        .timestamp() as usize;

    let role = if email.eq_ignore_ascii_case("janushsahni24@gmail.com") {
        "admin"
    } else {
        "user"
    };

    let claims = Claims {
        email: email.to_owned(),
        role: role.to_owned(),
        exp: expiration,
        aud: "neurostore".to_owned(),
        iss: "neurostore-gateway".to_owned(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
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

pub(crate) fn decode_claims_from_request(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<crate::models::Claims, (StatusCode, Json<serde_json::Value>)> {
    // 1. Try Bearer token first (cross-domain friendly)
    if let Some(auth_header) = headers.get("Authorization").and_then(|h| h.to_str().ok()) {
        if auth_header.starts_with("Bearer ") {
            let token = auth_header.trim_start_matches("Bearer ");
            let mut validation = jsonwebtoken::Validation::default();
            validation.set_audience(&["neurostore"]);
            validation.set_issuer(&["neurostore-gateway"]);
            validation.set_required_spec_claims(&["exp", "aud", "iss"]);
            if let Ok(data) = jsonwebtoken::decode::<crate::models::Claims>(
                token,
                &jsonwebtoken::DecodingKey::from_secret(state.jwt_secret.as_bytes()),
                &validation,
            ) {
                return Ok(data.claims);
            }
        }
    }

    // 2. Fallback to cookie (backwards compatibility)
    let token = get_cookie_value(headers, AUTH_COOKIE).ok_or((
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({ "error": "unauthorized" })),
    ))?;

    let mut validation = jsonwebtoken::Validation::default();
    validation.set_audience(&["neurostore"]);
    validation.set_issuer(&["neurostore-gateway"]);
    validation.set_required_spec_claims(&["exp", "aud", "iss"]);
    let token_data = jsonwebtoken::decode::<crate::models::Claims>(
        &token,
        &jsonwebtoken::DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "unauthorized" })),
        )
    })?;

    Ok(token_data.claims)
}

pub(crate) fn decode_email_from_request(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    decode_claims_from_request(headers, state).map(|claims| claims.email)
}

fn auth_response(
    status: StatusCode,
    token: String,
    user: UserProfile,
    secure_cookie: bool,
) -> impl IntoResponse {
    let csrf_token = generate_csrf_token();
    let mut headers = HeaderMap::new();

    // Still set cookies for backwards compatibility, but the frontend
    // should prefer the JWT token from the response body.
    let auth_cookie = build_cookie(AUTH_COOKIE, &token, 24 * 60 * 60, secure_cookie, true);
    let csrf_cookie = build_cookie(CSRF_COOKIE, &csrf_token, 24 * 60 * 60, secure_cookie, false);

    if let Ok(v) = HeaderValue::from_str(&auth_cookie) {
        headers.append(SET_COOKIE, v);
    }
    if let Ok(v) = HeaderValue::from_str(&csrf_cookie) {
        headers.append(SET_COOKIE, v);
    }

    // Return the actual JWT token so the frontend can use Bearer auth
    let body = serde_json::json!({
        "token": token,
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
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Invalid email format" })),
        )
            .into_response();
    }
    if payload.password.len() < 8 || payload.password.len() > 128 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Password must be between 8 and 128 characters" })),
        )
            .into_response();
    }
    tracing::info!("Register request received for email: {}", email);

    let existing = sqlx::query_as::<_, crate::models::User>("SELECT * FROM users WHERE email = $1")
        .bind(email.clone())
        .fetch_optional(&state.db)
        .await;

    if let Ok(Some(_)) = existing {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "User already exists" })),
        )
            .into_response();
    }

    let password = payload.password.clone();
    let hash_result = match task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        argon2
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
    })
    .await
    {
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
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Password hashing failed" })),
            )
                .into_response()
        }
    };

    let name = payload
        .name
        .unwrap_or_else(|| email.clone())
        .trim()
        .chars()
        .take(128)
        .collect::<String>();

    let insert_result =
        sqlx::query("INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)")
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
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Database error" })),
            )
                .into_response()
        }
    }
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    let email = normalize_email(&payload.email);
    if !is_reasonable_email(&email) || payload.password.is_empty() || payload.password.len() > 128 {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid credentials" })),
        )
            .into_response();
    }

    let record = sqlx::query_as::<_, crate::models::User>("SELECT * FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&state.db)
        .await;

    let user_row = match record {
        Ok(Some(row)) => row,
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Invalid credentials" })),
            )
                .into_response()
        }
    };

    let password = payload.password.clone();
    let Some(hash) = user_row.password_hash.clone() else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": "This account uses single sign-on. Continue with Google."
            })),
        )
            .into_response();
    };

    let is_valid = match task::spawn_blocking(move || match PasswordHash::new(&hash) {
        Ok(parsed_hash) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_ok(),
        Err(_) => false,
    })
    .await
    {
        Ok(result) => result,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Password verification worker failed" })),
            )
                .into_response()
        }
    };

    if !is_valid {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid credentials" })),
        )
            .into_response();
    }

    let token = create_jwt(&user_row.email, &state.jwt_secret);
    let name = user_row.name.unwrap_or_else(|| user_row.email.clone());

    let user = UserProfile {
        email: user_row.email,
        name,
    };

    auth_response(StatusCode::OK, token, user, state.cookie_secure).into_response()
}

pub async fn session(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    let email = match decode_email_from_request(&headers, &state) {
        Ok(email) => email,
        Err(err) => return err.into_response(),
    };

    let user = sqlx::query_as::<_, crate::models::User>("SELECT * FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&state.db)
        .await;

    let Some(user) = user.ok().flatten() else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "unauthorized" })),
        )
            .into_response();
    };

    let csrf_token = get_cookie_value(&headers, CSRF_COOKIE).unwrap_or_default();
    let profile = UserProfile {
        email: user.email.clone(),
        name: user.name.unwrap_or(user.email),
    };

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "user": profile,
            "csrf_token": csrf_token,
        })),
    )
        .into_response()
}

pub async fn logout(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    let auth_cookie = clear_cookie(AUTH_COOKIE, state.cookie_secure, true);
    let csrf_cookie = clear_cookie(CSRF_COOKIE, state.cookie_secure, false);

    if let Ok(v) = HeaderValue::from_str(&auth_cookie) {
        headers.append(SET_COOKIE, v);
    }
    if let Ok(v) = HeaderValue::from_str(&csrf_cookie) {
        headers.append(SET_COOKIE, v);
    }

    (
        StatusCode::OK,
        headers,
        Json(serde_json::json!({ "success": true })),
    )
        .into_response()
}

// ── ENTERPRISE STUBS ─────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct EscrowRequest {
    pub wrapped_vault_key: String,
    pub wrapped_manifest_seed: Option<String>,
    pub recovery_contacts: Option<Vec<String>>,
    pub recovery_policy: Option<serde_json::Value>,
}

pub async fn setup_escrow(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<EscrowRequest>,
) -> impl IntoResponse {
    let email = match crate::handlers::s3::validate_s3_auth(&headers, &state) {
        Ok(e) => e,
        Err(e) => return e.into_response(),
    };

    if payload.wrapped_vault_key.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "wrapped_vault_key is required" })),
        )
            .into_response();
    }

    let contacts = payload.recovery_contacts.unwrap_or_default();
    let policy = payload
        .recovery_policy
        .unwrap_or_else(|| serde_json::json!({ "type": "recovery-kit" }));
    let kit_id = format!("rk_{}", hex::encode(rand::random::<[u8; 8]>()));

    let result = sqlx::query(
        r#"
        INSERT INTO recovery_kits (email, kit_id, wrapped_vault_key, wrapped_manifest_seed, recovery_contacts, recovery_policy, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (email) DO UPDATE SET
            kit_id = excluded.kit_id,
            wrapped_vault_key = excluded.wrapped_vault_key,
            wrapped_manifest_seed = excluded.wrapped_manifest_seed,
            recovery_contacts = excluded.recovery_contacts,
            recovery_policy = excluded.recovery_policy,
            updated_at = NOW()
        "#
    )
    .bind(&email)
    .bind(&kit_id)
    .bind(&payload.wrapped_vault_key)
    .bind(&payload.wrapped_manifest_seed)
    .bind(serde_json::json!(contacts))
    .bind(policy)
    .execute(&state.db)
    .await;

    if let Err(err) = result {
        tracing::error!("Failed to persist recovery kit for {}: {}", email, err);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "failed to store recovery kit" })),
        )
            .into_response();
    }

    tracing::info!("Recovery kit enabled for {}", email);

    (StatusCode::OK, Json(serde_json::json!({
        "status": "recovery_kit_active",
        "kit_id": kit_id,
        "message": "Recovery kit stored. The server holds only client-wrapped recovery material, not the raw vault key."
    }))).into_response()
}

pub async fn get_recovery_kit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let email = match crate::handlers::s3::validate_s3_auth(&headers, &state) {
        Ok(e) => e,
        Err(e) => return e.into_response(),
    };

    let row = sqlx::query(
        r#"SELECT kit_id, wrapped_vault_key, wrapped_manifest_seed, recovery_contacts, recovery_policy, updated_at::text
           FROM recovery_kits WHERE email = $1"#
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await;

    match row {
        Ok(Some(record)) => (StatusCode::OK, Json(serde_json::json!({
            "kit_id": record.try_get::<String, _>("kit_id").unwrap_or_default(),
            "wrapped_vault_key": record.try_get::<String, _>("wrapped_vault_key").unwrap_or_default(),
            "wrapped_manifest_seed": record.try_get::<Option<String>, _>("wrapped_manifest_seed").unwrap_or(None),
            "recovery_contacts": record.try_get::<serde_json::Value, _>("recovery_contacts").unwrap_or_else(|_| serde_json::json!([])),
            "recovery_policy": record.try_get::<serde_json::Value, _>("recovery_policy").unwrap_or_else(|_| serde_json::json!({})),
            "updated_at": record.try_get::<String, _>("updated_at").unwrap_or_default(),
        }))).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "recovery kit not configured" }))).into_response(),
        Err(err) => {
            tracing::error!("Failed to load recovery kit for {}: {}", email, err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "failed to load recovery kit" }))).into_response()
        }
    }
}

pub async fn get_recovery_kit_public(
    State(state): State<Arc<AppState>>,
    axum::extract::Query(query): axum::extract::Query<crate::models::RecoveryKitQuery>,
) -> impl IntoResponse {
    let raw_email = query.username.or(query.email).unwrap_or_default();
    let normalized_email = normalize_email(&raw_email);

    let row = sqlx::query(
        r#"SELECT wrapped_vault_key, wrapped_manifest_seed FROM recovery_kits WHERE email = $1"#,
    )
    .bind(&normalized_email)
    .fetch_optional(&state.db)
    .await;

    match row {
        Ok(Some(record)) => (StatusCode::OK, Json(serde_json::json!({
            "wrapped_vault_key": record.try_get::<String, _>("wrapped_vault_key").unwrap_or_default(),
            "wrapped_manifest_seed": record.try_get::<Option<String>, _>("wrapped_manifest_seed").unwrap_or(None),
        }))).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Recovery kit not configured for this email." }))).into_response(),
        Err(err) => {
            tracing::error!("Failed to load recovery kit for {}: {}", normalized_email, err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Database error loading kit." }))).into_response()
        }
    }
}

/// E3: Enterprise SSO - SAML 2.0 (Okta / Entra ID) stub
pub async fn sso_saml_login() -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        "SAML Provider Trust not configured in this environment",
    )
        .into_response()
}

/// E3: Enterprise SSO - OAuth2 / OIDC stub
pub async fn sso_oauth_login() -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        "OAuth2/OIDC Provider not configured in this environment",
    )
        .into_response()
}

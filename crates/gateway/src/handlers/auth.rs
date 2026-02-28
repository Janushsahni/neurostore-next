use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
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

use crate::AppState;
use crate::models::{LoginRequest, RegisterRequest, AuthResponse, UserProfile, Claims};

pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RegisterRequest>,
) -> impl IntoResponse {
    let email = payload.email.clone();
    tracing::info!("Register request received for email: {}", email);
    
    // Check if user exists
    let existing = sqlx::query_as::<_, crate::models::User>("SELECT * FROM users WHERE email = $1")
        .bind(email.clone())
        .fetch_optional(&state.db)
        .await;

    if let Ok(Some(_)) = existing {
        return (StatusCode::CONFLICT, Json(serde_json::json!({ "error": "User already exists" })));
    }

    // Hash password with Argon2 automatically on a blocking thread
    let password = payload.password.clone();
    let hash_result = task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        argon2.hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
    }).await.unwrap();

    let password_hash = match hash_result {
        Ok(h) => h,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Password hashing failed" }))),
    };

    let name = payload.name.unwrap_or_else(|| email.clone());

    // Insert to PostgreSQL
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
            let response = AuthResponse {
                token,
                user: UserProfile { email, name },
            };
            (StatusCode::CREATED, Json(serde_json::json!(response)))
        }
        Err(e) => {
            tracing::error!("DB Insert Error: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Database error" })))
        }
    }
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    let record = sqlx::query_as::<_, crate::models::User>(
        "SELECT * FROM users WHERE email = $1"
    )
    .bind(&payload.email)
    .fetch_optional(&state.db)
    .await;

    let user_row = match record {
        Ok(Some(row)) => row,
        _ => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid credentials" }))),
    };

    let password = payload.password.clone();
    let hash = user_row.password_hash.clone();
    
    let is_valid = task::spawn_blocking(move || {
        let parsed_hash = PasswordHash::new(&hash).unwrap();
        Argon2::default().verify_password(password.as_bytes(), &parsed_hash).is_ok()
    }).await.unwrap();

    if !is_valid {
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid credentials" })));
    }

    let token = create_jwt(&user_row.email, &state.jwt_secret);
    let name = user_row.name.unwrap_or_else(|| user_row.email.clone());

    let response = AuthResponse {
        token,
        user: UserProfile { email: user_row.email, name },
    };
    (StatusCode::OK, Json(serde_json::json!(response)))
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

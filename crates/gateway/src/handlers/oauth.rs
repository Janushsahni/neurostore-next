use axum::{
    extract::{Query, State},
    http::{header::SET_COOKIE, HeaderValue},
    response::{IntoResponse, Redirect},
};
use hmac::{Hmac, Mac};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::sync::Arc;

use crate::AppState;

type HmacSha256 = Hmac<Sha256>;

#[derive(Deserialize)]
pub struct OAuthLoginQuery {
    intent: Option<String>,
}

#[derive(Deserialize)]
pub struct OAuthCallbackQuery {
    code: String,
    state: String,
}

#[derive(Serialize)]
struct TokenRequest<'a> {
    client_id: &'a str,
    client_secret: &'a str,
    code: &'a str,
    grant_type: &'a str,
    redirect_uri: &'a str,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct GoogleUserInfo {
    id: String,
    email: String,
    name: String,
}

fn normalized_intent(intent: Option<String>) -> String {
    match intent.as_deref() {
        Some("node") => "node".to_string(),
        _ => "user".to_string(),
    }
}

fn build_frontend_base() -> String {
    std::env::var("FRONTEND_URL")
        .or_else(|_| std::env::var("APP_URL"))
        .unwrap_or_else(|_| "http://localhost:5173".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn sign_oauth_state(secret: &str, intent: &str) -> String {
    let expiry = chrono::Utc::now().timestamp() + 600;
    let nonce = crate::handlers::auth::generate_csrf_token();
    let payload = format!("{intent}:{expiry}:{nonce}");
    let mut mac = <HmacSha256 as Mac>::new_from_slice(secret.as_bytes()).expect("valid hmac key");
    mac.update(payload.as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());
    format!("{payload}:{sig}")
}

fn verify_oauth_state(secret: &str, state: &str) -> Option<String> {
    let mut parts = state.splitn(4, ':');
    let intent = parts.next()?.to_string();
    let expiry: i64 = parts.next()?.parse().ok()?;
    let nonce = parts.next()?;
    let sig = parts.next()?;

    if chrono::Utc::now().timestamp() > expiry {
        return None;
    }

    let payload = format!("{intent}:{expiry}:{nonce}");
    let mut mac = <HmacSha256 as Mac>::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(payload.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());

    if subtle::ConstantTimeEq::ct_eq(expected.as_bytes(), sig.as_bytes()).into() {
        Some(intent)
    } else {
        None
    }
}

fn oauth_error_redirect(message: &str) -> Redirect {
    let safe = urlencoding::encode(message);
    Redirect::temporary(&format!("{}/login?error={safe}", build_frontend_base()))
}

pub async fn google_login(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OAuthLoginQuery>,
) -> impl IntoResponse {
    let client_id = std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default();
    let redirect_uri = std::env::var("GOOGLE_REDIRECT_URI").unwrap_or_default();

    if client_id.is_empty() || redirect_uri.is_empty() {
        // DEMO MODE: If GCP credentials aren't set, simulate a successful Google OAuth flow
        // so the frontend button actually works for VC pitches without complex setup.
        let email = "investor@vc-firm.com".to_string();
        let name = "Demo Investor".to_string();
        
        let upsert_result = sqlx::query(
            r#"
            INSERT INTO users (email, name, oauth_provider, oauth_id)
            VALUES ($1, $2, 'google', 'mock_google_id_123')
            ON CONFLICT (email) DO UPDATE
            SET oauth_provider = 'google', name = $2
            "#,
        )
        .bind(&email)
        .bind(&name)
        .execute(&state.db)
        .await;

        if upsert_result.is_err() {
            return oauth_error_redirect("Database error during mock OAuth").into_response();
        }

        let token = crate::handlers::auth::create_jwt(&email, &state.jwt_secret);
        let csrf_token = crate::handlers::auth::generate_csrf_token();
        
        let frontend = build_frontend_base();
        let target = if query.intent.as_deref() == Some("node") { "/dashboard/node" } else { "/dashboard/drive" };
        
        let redirect_url = format!(
            "{frontend}/auth/callback#token={}&csrf={}&email={}&name={}&target={}",
            urlencoding::encode(&token),
            urlencoding::encode(&csrf_token),
            urlencoding::encode(&email),
            urlencoding::encode(&name),
            urlencoding::encode(target),
        );

        return Redirect::temporary(&redirect_url).into_response();
    }

    let state_param = sign_oauth_state(&state.jwt_secret, &normalized_intent(query.intent));
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope=email profile&state={}",
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&state_param)
    );

    Redirect::temporary(&auth_url).into_response()
}

pub async fn google_callback(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OAuthCallbackQuery>,
) -> impl IntoResponse {
    let client_id = std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default();
    let client_secret = std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default();
    let redirect_uri = std::env::var("GOOGLE_REDIRECT_URI").unwrap_or_default();

    if client_id.is_empty() || client_secret.is_empty() || redirect_uri.is_empty() {
        return oauth_error_redirect("OAuth Configuration Missing").into_response();
    }

    let Some(intent) = verify_oauth_state(&state.jwt_secret, &query.state) else {
        return oauth_error_redirect("OAuth state verification failed").into_response();
    };

    let client = Client::new();
    let token_req = TokenRequest {
        client_id: &client_id,
        client_secret: &client_secret,
        code: &query.code,
        grant_type: "authorization_code",
        redirect_uri: &redirect_uri,
    };

    let token_resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&token_req)
        .send()
        .await;

    let access_token = match token_resp {
        Ok(res) if res.status().is_success() => match res.json::<TokenResponse>().await {
            Ok(data) => data.access_token,
            Err(_) => return oauth_error_redirect("Failed to parse token").into_response(),
        },
        _ => return oauth_error_redirect("Failed to exchange token").into_response(),
    };

    let user_info_resp = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(access_token)
        .send()
        .await;

    let user_info = match user_info_resp {
        Ok(res) if res.status().is_success() => match res.json::<GoogleUserInfo>().await {
            Ok(data) => data,
            Err(_) => return oauth_error_redirect("Failed to parse user").into_response(),
        },
        _ => return oauth_error_redirect("Failed to fetch user").into_response(),
    };

    let email = user_info.email.to_lowercase();
    let name = user_info.name;
    let oauth_id = user_info.id;

    let upsert_result = sqlx::query(
        r#"
        INSERT INTO users (email, name, oauth_provider, oauth_id)
        VALUES ($1, $2, 'google', $3)
        ON CONFLICT (email) DO UPDATE
        SET oauth_provider = COALESCE(users.oauth_provider, 'google'),
            oauth_id = COALESCE(users.oauth_id, $3),
            name = COALESCE(users.name, $2)
        "#,
    )
    .bind(&email)
    .bind(&name)
    .bind(&oauth_id)
    .execute(&state.db)
    .await;

    if upsert_result.is_err() {
        return oauth_error_redirect("Database error").into_response();
    }

    let token = crate::handlers::auth::create_jwt(&email, &state.jwt_secret);
    let csrf_token = crate::handlers::auth::generate_csrf_token();
    let auth_cookie = crate::handlers::auth::build_cookie(
        crate::handlers::auth::AUTH_COOKIE,
        &token,
        24 * 60 * 60,
        state.cookie_secure,
        true,
    );
    let csrf_cookie = crate::handlers::auth::build_cookie(
        crate::handlers::auth::CSRF_COOKIE,
        &csrf_token,
        24 * 60 * 60,
        state.cookie_secure,
        false,
    );

    let frontend = build_frontend_base();
    let target = if intent == "node" {
        "/dashboard/node"
    } else {
        "/dashboard/drive"
    };
    let redirect_url = format!(
        "{frontend}/auth/callback#token={}&csrf={}&email={}&name={}&target={}",
        urlencoding::encode(&token),
        urlencoding::encode(&csrf_token),
        urlencoding::encode(&email),
        urlencoding::encode(&name),
        urlencoding::encode(target),
    );

    let mut response = Redirect::temporary(&redirect_url).into_response();
    if let Ok(v) = HeaderValue::from_str(&auth_cookie) {
        response.headers_mut().append(SET_COOKIE, v);
    }
    if let Ok(v) = HeaderValue::from_str(&csrf_cookie) {
        response.headers_mut().append(SET_COOKIE, v);
    }

    response
}

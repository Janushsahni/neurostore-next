use axum::{
    extract::Path,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
};

fn download_target(os: &str, arch: &str) -> Option<(&'static str, &'static str, &'static str)> {
    match (os, arch) {
        ("windows", "x86_64") => Some((
            "NODE_WINDOWS_INSTALLER_URL",
            "https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-windows-x86_64.msi",
            "neuro-node-windows-x86_64.msi",
        )),
        ("windows-portable", "x86_64") => Some((
            "NODE_WINDOWS_PORTABLE_URL",
            "https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-windows-x86_64.zip",
            "neuro-node-windows-x86_64.zip",
        )),
        ("macos", "arm64") => Some((
            "NODE_MACOS_ARM64_URL",
            "https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-macos-arm64.tar.gz",
            "neuro-node-macos-arm64.tar.gz",
        )),
        ("macos", "x86_64") => Some((
            "NODE_MACOS_X86_64_URL",
            "https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-macos-x86_64.tar.gz",
            "neuro-node-macos-x86_64.tar.gz",
        )),
        ("linux", "x86_64") => Some((
            "NODE_LINUX_X86_64_URL",
            "https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-linux-x86_64.tar.gz",
            "neuro-node-linux-x86_64.tar.gz",
        )),
        ("checksums", "latest") => Some((
            "NODE_RELEASE_CHECKSUMS_URL",
            "https://github.com/Janushsahni/neurostore-next/releases/latest/download/SHA256SUMS.txt",
            "SHA256SUMS.txt",
        )),
        _ => None,
    }
}

pub async fn proxy_node_download(Path((os, arch)): Path<(String, String)>) -> impl IntoResponse {
    tracing::warn!("==== HIT PROXY NODE DOWNLOAD: os={}, arch={} ====", os, arch);
    let Some((env_name, default_url, filename)) = download_target(&os, &arch) else {
        return (StatusCode::NOT_FOUND, "unsupported download target").into_response();
    };

    let source_url = std::env::var(env_name).unwrap_or_else(|_| default_url.to_string());
    let client = reqwest::Client::new();
    let response = match client.get(&source_url).send().await {
        Ok(resp) => resp,
        Err(err) => {
            tracing::error!("node download proxy failed for {}: {}", source_url, err);
            return (StatusCode::BAD_GATEWAY, "download upstream unavailable").into_response();
        }
    };

    if !response.status().is_success() {
        tracing::warn!(
            "node download upstream returned {} for {}",
            response.status(),
            source_url
        );
        return (StatusCode::BAD_GATEWAY, "download upstream rejected request").into_response();
    }

    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::error!("node download body read failed for {}: {}", source_url, err);
            return (StatusCode::BAD_GATEWAY, "download body failed").into_response();
        }
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{}\"", filename))
            .unwrap_or(HeaderValue::from_static("attachment")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=300"),
    );

    (StatusCode::OK, headers, bytes).into_response()
}

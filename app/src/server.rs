use axum::extract::State;
use axum::http::header;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use mime_guess::from_path;
use rust_embed::Embed;
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

/// Shared app state. Nothing to hold yet — OSC stats live in `osc_out` — but
/// the GUI and future routes can hang their own data off it.
#[derive(Default)]
pub struct AppState;

#[derive(Embed)]
#[folder = "../.output/public/"]
struct Asset;

fn embed_bytes(data: std::borrow::Cow<'static, [u8]>) -> axum::body::Bytes {
    match data {
        std::borrow::Cow::Borrowed(b) => axum::body::Bytes::from_static(b),
        std::borrow::Cow::Owned(b) => axum::body::Bytes::from(b),
    }
}

fn etag_for(path: &str, data: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    data.hash(&mut hasher);
    format!("\"{:x}\"", hasher.finish())
}

/// `Cache-Control: no-cache` (revalidate every time, never serve stale) plus
/// ETag revalidation — required because the binary re-embeds assets on
/// rebuild under the same URLs.
fn if_none_match(headers: &HeaderMap, etag: &str) -> bool {
    headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        == Some(etag)
}

fn respond_asset(path: &str, data: std::borrow::Cow<'static, [u8]>, headers: &HeaderMap) -> Response {
    let etag = etag_for(path, &data);
    if if_none_match(headers, &etag) {
        return (
            StatusCode::NOT_MODIFIED,
            [
                (header::ETAG, etag),
                (header::CACHE_CONTROL, "no-cache".to_string()),
            ],
        )
            .into_response();
    }
    let mime = if path.ends_with(".html") {
        "text/html; charset=utf-8".to_string()
    } else {
        from_path(path).first_or_octet_stream().as_ref().to_string()
    };
    (
        [
            (header::CONTENT_TYPE, mime),
            (header::ETAG, etag),
            (header::CACHE_CONTROL, "no-cache".to_string()),
        ],
        embed_bytes(data),
    )
        .into_response()
}

fn get_index(headers: &HeaderMap) -> Response {
    match Asset::get("index.html") {
        Some(content) => respond_asset("index.html", content.data, headers),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn serve_index(headers: HeaderMap) -> Response {
    get_index(&headers)
}

async fn serve_static_file(uri: axum::http::Uri, headers: HeaderMap) -> Response {
    let path = uri.path().trim_start_matches('/');
    match Asset::get(path) {
        Some(content) => respond_asset(path, content.data, &headers),
        None => {
            // SPA fallback: extension-less paths are client-side routes and
            // get index.html; missing assets (with extension) 404.
            let has_extension = std::path::Path::new(path).extension().is_some();
            if has_extension {
                StatusCode::NOT_FOUND.into_response()
            } else {
                get_index(&headers)
            }
        }
    }
}

/// Byte-compatible port of `src/routes/api/osc/send.ts`.
async fn api_osc_send(State(_state): State<Arc<AppState>>, body: String) -> Response {
    let parsed: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid JSON" })),
            )
                .into_response()
        }
    };
    let payload = crate::osc_out::Payload::from_value(&parsed);
    let message_count = payload.messages.len();
    if message_count == 0 {
        return Json(json!({ "sent": 0 })).into_response();
    }
    match crate::osc_out::send_batch(
        &payload.host,
        payload.port,
        payload.bundle,
        payload.messages,
    )
    .await
    {
        Ok(sent) => Json(json!({ "sent": sent, "messages": message_count })).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, Json(json!({ "error": e }))).into_response(),
    }
}

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(serve_index))
        .route("/ws", get(crate::ws::ws_handler))
        .route("/api/osc/send", post(api_osc_send))
        .route("/{*path}", get(serve_static_file))
        .with_state(state)
}

/// Plain-HTTP server shared by the GUI and headless modes.
pub async fn run_server(state: Arc<AppState>, bind: String, port: u16) -> Result<(), String> {
    let app = build_router(state);
    let bind_addr: IpAddr = bind
        .parse()
        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    let addr = SocketAddr::new(bind_addr, port);
    let listener = tokio::net::TcpListener::bind(addr).await.map_err(|e| {
        format!(
            "could not bind to {addr}: {e}\n       Another slopmotion instance may already be running.\n       Use --port <port> to use a different port."
        )
    })?;
    axum::serve(listener, app)
        .await
        .map_err(|e| format!("server error: {e}"))
}

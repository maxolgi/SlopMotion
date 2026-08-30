use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use serde_json::Value;

pub async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(socket: WebSocket) {
    let (mut sender, mut receiver) = socket.split();

    while let Some(Ok(msg)) = receiver.next().await {
        let text = match msg {
            Message::Text(t) => t,
            _ => continue,
        };

        // Bare-text keepalive from clients that don't send the JSON form.
        if text.trim() == "ping" {
            if sender.send(Message::Text("pong".into())).await.is_err() {
                return;
            }
            continue;
        }

        // A malformed message must never kill the socket.
        let parsed: Value = match serde_json::from_str(&text.to_string()) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if parsed.get("type").and_then(Value::as_str) == Some("ping") {
            if sender.send(Message::Text("pong".into())).await.is_err() {
                return;
            }
            continue;
        }

        // The optional `"type": "osc"` tag is accepted with or without it;
        // anything carrying a messages array is treated as OSC traffic.
        // Fire-and-forget: no per-message ack.
        let payload = crate::osc_out::Payload::from_value(&parsed);
        if payload.messages.is_empty() {
            continue;
        }
        if let Err(e) = crate::osc_out::send_batch(
            &payload.host,
            payload.port,
            payload.bundle,
            payload.messages,
        )
        .await
        {
            eprintln!("osc send failed: {e}");
        }
    }
}

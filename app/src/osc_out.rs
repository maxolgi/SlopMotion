use rosc::{OscBundle, OscMessage, OscPacket, OscTime, OscType};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::net::UdpSocket;

/// One OSC message as it arrives over the JSON wire format:
/// `{"address": "/ch/1", "args": [{"type": "f", "value": 0.5}]}`.
///
/// Fields stay loosely typed (`Value`) so coercion mirrors the TypeScript
/// route exactly (`String(address)`, `Number(value)`, unknown type → float)
/// instead of rejecting bodies the SPA would have accepted.
#[derive(serde::Deserialize)]
pub struct WireMessage {
    #[serde(default)]
    pub address: Value,
    #[serde(default)]
    pub args: Vec<WireArg>,
}

#[derive(serde::Deserialize)]
pub struct WireArg {
    #[serde(default, rename = "type")]
    pub kind: Value,
    #[serde(default)]
    pub value: Value,
}

/// A fully coerced send request (same shape as POST /api/osc/send).
pub struct Payload {
    pub host: String,
    pub port: u16,
    pub bundle: bool,
    pub messages: Vec<WireMessage>,
}

impl Payload {
    /// Byte-compatible port of the TS route's coercion rules:
    /// `host || "127.0.0.1"`, `Number(port) || 8101`, `bundle !== false`,
    /// `messages.slice(0, 128)`.
    pub fn from_value(v: &Value) -> Payload {
        let host = v
            .get("host")
            .and_then(Value::as_str)
            .filter(|h| !h.is_empty())
            .unwrap_or("127.0.0.1")
            .to_string();
        Payload {
            host,
            port: coerce_port(v.get("port")),
            bundle: !matches!(v.get("bundle"), Some(Value::Bool(false))),
            messages: v
                .get("messages")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .take(128)
                        .filter_map(|m| serde_json::from_value(m.clone()).ok())
                        .collect()
                })
                .unwrap_or_default(),
        }
    }
}

/// TS: `Number(body.port) || 8101`.
fn coerce_port(v: Option<&Value>) -> u16 {
    let n = match v {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => s.trim().parse::<f64>().ok(),
        _ => None,
    };
    n.filter(|f| *f != 0.0).map_or(8101, |f| f as u16)
}

/// TS `Number(x)` for numeric coercion of a JSON value.
fn js_f64(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => s.trim().parse().unwrap_or(f64::NAN),
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        _ => f64::NAN,
    }
}

/// TS `String(x)` for string coercion of a JSON value.
fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn osc_arg(a: &WireArg) -> OscType {
    match a.kind.as_str() {
        Some("i") => OscType::Int(js_f64(&a.value).round() as i32),
        Some("s") => OscType::String(js_string(&a.value)),
        // Unknown/missing type falls back to float, like the TS route.
        _ => OscType::Float(js_f64(&a.value) as f32),
    }
}

fn osc_message(m: &WireMessage) -> OscMessage {
    let mut addr = js_string(&m.address);
    if !addr.starts_with('/') {
        addr.insert(0, '/');
    }
    OscMessage {
        addr,
        args: m.args.iter().map(osc_arg).collect(),
    }
}

/// Mirror of TS `encodePacket`: one `#bundle` packet when bundling more than
/// one message (immediate timetag), otherwise one packet per message.
fn encode_packets(bundle: bool, messages: &[OscMessage]) -> Vec<Vec<u8>> {
    let encode = |p: &OscPacket| -> Option<Vec<u8>> {
        rosc::encoder::encode(p)
            .map_err(|e| eprintln!("osc encode error: {e}"))
            .ok()
    };
    if bundle && messages.len() > 1 {
        let packet = OscPacket::Bundle(OscBundle {
            timetag: OscTime {
                seconds: 0,
                fractional: 1, // immediate
            },
            content: messages.iter().map(|m| OscPacket::Message(m.clone())).collect(),
        });
        encode(&packet).into_iter().collect()
    } else {
        messages
            .iter()
            .filter_map(|m| encode(&OscPacket::Message(m.clone())))
            .collect()
    }
}

static SOCKETS: std::sync::LazyLock<Mutex<HashMap<(String, u16), Arc<UdpSocket>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));
static PACKETS_SENT: AtomicU64 = AtomicU64::new(0);
static MESSAGES_SENT: AtomicU64 = AtomicU64::new(0);
static ERRORS: AtomicU64 = AtomicU64::new(0);

/// Cumulative counters shown by the GUI.
#[allow(dead_code)] // consumed by gui.rs once the GUI agent fills it in
pub struct Stats {
    pub packets_sent: u64,
    pub messages_sent: u64,
    pub errors: u64,
}

#[allow(dead_code)]
pub fn stats() -> Stats {
    Stats {
        packets_sent: PACKETS_SENT.load(Ordering::Relaxed),
        messages_sent: MESSAGES_SENT.load(Ordering::Relaxed),
        errors: ERRORS.load(Ordering::Relaxed),
    }
}

async fn socket_for(host: &str, port: u16) -> Result<Arc<UdpSocket>, String> {
    let key = (host.to_string(), port);
    if let Some(sock) = SOCKETS.lock().unwrap().get(&key) {
        return Ok(sock.clone());
    }
    let sock = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("udp bind failed: {e}"))?;
    let sock = Arc::new(sock);
    SOCKETS.lock().unwrap().insert(key, sock.clone());
    Ok(sock)
}

/// Encode and send a batch of messages as UDP OSC packets.
/// Returns the number of UDP packets sent.
pub async fn send_batch(
    host: &str,
    port: u16,
    bundle: bool,
    messages: Vec<WireMessage>,
) -> Result<usize, String> {
    let messages: Vec<OscMessage> = messages.iter().map(osc_message).collect();
    if messages.is_empty() {
        return Ok(0);
    }
    let packets = encode_packets(bundle, &messages);
    let sock = socket_for(host, port).await?;
    let mut sent = 0usize;
    for packet in &packets {
        // Unconnected send_to mirrors the TS route's `dgram.send`: ICMP
        // port-unreachable from earlier sends is never replayed here.
        match sock.send_to(packet, (host, port)).await {
            Ok(_) => {
                sent += 1;
                PACKETS_SENT.fetch_add(1, Ordering::Relaxed);
            }
            Err(e) => {
                ERRORS.fetch_add(1, Ordering::Relaxed);
                return Err(format!("udp send to {host}:{port} failed: {e}"));
            }
        }
    }
    MESSAGES_SENT.fetch_add(messages.len() as u64, Ordering::Relaxed);
    Ok(sent)
}

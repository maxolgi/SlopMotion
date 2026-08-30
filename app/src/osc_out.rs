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
pub struct Stats {
    // gui.rs only surfaces messages_sent/errors today; kept for completeness.
    #[allow(dead_code)]
    pub packets_sent: u64,
    pub messages_sent: u64,
    pub errors: u64,
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn msg(addr: &str) -> OscMessage {
        osc_message(&WireMessage {
            address: json!(addr),
            args: vec![],
        })
    }

    #[test]
    fn payload_defaults_on_empty_object() {
        let p = Payload::from_value(&json!({}));
        assert_eq!(p.host, "127.0.0.1");
        assert_eq!(p.port, 8101);
        assert!(p.bundle);
        assert!(p.messages.is_empty());
    }

    #[test]
    fn payload_bundle_false_respected() {
        let p = Payload::from_value(&json!({ "bundle": false }));
        assert!(!p.bundle);
    }

    #[test]
    fn payload_port_coercion() {
        assert_eq!(Payload::from_value(&json!({ "port": "9000" })).port, 9000);
        assert_eq!(Payload::from_value(&json!({ "port": 0 })).port, 8101);
        assert_eq!(Payload::from_value(&json!({ "port": "abc" })).port, 8101);
    }

    #[test]
    fn payload_messages_capped_at_128() {
        let messages: Vec<_> = (0..200).map(|_| json!({ "address": "/ch" })).collect();
        let p = Payload::from_value(&json!({ "messages": messages }));
        assert_eq!(p.messages.len(), 128);
    }

    #[test]
    fn osc_arg_coercion() {
        let arg = |kind: Value, value: Value| osc_arg(&WireArg { kind, value });
        assert_eq!(arg(json!("i"), json!(1.6)), OscType::Int(2));
        assert_eq!(arg(json!("s"), json!(5)), OscType::String("5".to_string()));
        assert_eq!(arg(json!("f"), json!(2.5)), OscType::Float(2.5));
        assert_eq!(arg(Value::Null, json!(2.5)), OscType::Float(2.5));
        assert_eq!(arg(json!("i"), json!("7")), OscType::Int(7));
    }

    #[test]
    fn osc_message_prepends_slash() {
        let m = osc_message(&WireMessage {
            address: json!("ch/1"),
            args: vec![],
        });
        assert_eq!(m.addr, "/ch/1");
        let m = osc_message(&WireMessage {
            address: json!("/ch/1"),
            args: vec![],
        });
        assert_eq!(m.addr, "/ch/1");
    }

    #[test]
    fn encode_packets_single_message_is_not_bundle() {
        let packets = encode_packets(true, &[msg("/ch/1")]);
        assert_eq!(packets.len(), 1);
        assert!(!packets[0].starts_with(b"#bundle"));
        assert_eq!(packets[0].len() % 4, 0);
    }

    #[test]
    fn encode_packets_bundles_multiple_messages() {
        let packets = encode_packets(true, &[msg("/ch/1"), msg("/ch/2")]);
        assert_eq!(packets.len(), 1);
        assert!(packets[0].starts_with(b"#bundle"));
        assert_eq!(&packets[0][8..16], &[0, 0, 0, 0, 0, 0, 0, 1]);
        assert_eq!(packets[0].len() % 4, 0);
    }

    #[test]
    fn encode_packets_without_bundle_one_per_message() {
        let packets = encode_packets(false, &[msg("/ch/1"), msg("/ch/2")]);
        assert_eq!(packets.len(), 2);
        for p in &packets {
            assert_eq!(p.len() % 4, 0);
        }
    }

    #[test]
    fn encoded_single_message_bytes() {
        let m = osc_message(&WireMessage {
            address: json!("/ch/1"),
            args: vec![WireArg {
                kind: json!("f"),
                value: json!(0.5),
            }],
        });
        let packets = encode_packets(false, &[m]);
        assert_eq!(packets.len(), 1);
        assert_eq!(packets[0], b"/ch/1\0\0\0,f\0\0\x3f\x00\x00\x00");
    }
}

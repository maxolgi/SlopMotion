// ─── OSC WebSocket bridge (singleton) ────────────────────────────────────────
// Transport rule (deterministic):
// - DEV builds always POST (the vinxi dev server has no /ws endpoint).
// - PROD builds always try the WebSocket served by the Rust app at /ws. While
//   the socket is not open, payloads are enqueued (cap 64, oldest dropped,
//   flushed in order on open) AND the POST fallback fires, so the very first
//   sends never stall; once the socket is open, sends go over WS only — no
//   double-sending. Imperative sends (immediate flag) skip the queue: while
//   the socket is not open they POST only, so they fire exactly once.
// Fire-and-forget: no acks. The server answers "pong" to {"type":"ping"}; we
// ping every 30s to keep the socket warm and otherwise rely on
// reconnect-on-close.

import type { OscMessage } from '@/lib/osc/encode'

export interface OscPayload {
  host: string
  port: number
  bundle: boolean
  messages: OscMessage[]
}

const MAX_QUEUE = 64
const RECONNECT_MIN = 500
const RECONNECT_MAX = 5000
const PING_INTERVAL = 30_000

let ws: WebSocket | null = null
let queue: OscPayload[] = []
let backoff = RECONNECT_MIN
let wasOpen = false
let pingTimer: ReturnType<typeof setInterval> | null = null

// Set by the engine so POST-fallback failures and WS disconnects surface in
// the stats UI (once per failed POST batch / once per disconnect, not per
// message).
let transportErrorHandler: ((message: string) => void) | null = null

export function setOscTransportErrorHandler(fn: (message: string) => void) {
  transportErrorHandler = fn
}

function postFallback(payload: OscPayload) {
  fetch('/api/osc/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    })
    .catch((e: unknown) => {
      transportErrorHandler?.(e instanceof Error ? e.message : 'send failed')
    })
}

function ensureSocket() {
  if (ws) return
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const socket = new WebSocket(`${proto}://${location.host}/ws`)
  ws = socket
  socket.onopen = () => {
    backoff = RECONNECT_MIN
    wasOpen = true
    for (const payload of queue) socket.send(JSON.stringify({ type: 'osc', ...payload }))
    queue = []
    pingTimer = setInterval(() => socket.send(JSON.stringify({ type: 'ping' })), PING_INTERVAL)
  }
  socket.onclose = () => {
    if (pingTimer !== null) clearInterval(pingTimer)
    pingTimer = null
    if (ws === socket) ws = null
    if (wasOpen) {
      wasOpen = false
      transportErrorHandler?.('websocket disconnected')
    }
    setTimeout(ensureSocket, backoff)
    backoff = Math.min(backoff * 2, RECONNECT_MAX)
  }
  // Pongs are ignored; onerror is always followed by onclose, which handles
  // reporting and reconnect scheduling.
  socket.onmessage = () => {}
  socket.onerror = () => {}
}

export function sendOsc(payload: OscPayload, immediate = false): void {
  if (import.meta.env.DEV) {
    postFallback(payload)
    return
  }
  ensureSocket()
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'osc', ...payload }))
    return
  }
  if (immediate) {
    postFallback(payload)
    return
  }
  queue.push(payload)
  if (queue.length > MAX_QUEUE) queue.shift()
  postFallback(payload)
}

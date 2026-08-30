// ─── Minimal OSC 1.0 encoder (no dependencies) ────────────────────────────────
// Encodes single messages and #bundle packets, big-endian, 32-bit aligned.

export type OscArg =
  | { type: 'f'; value: number }
  | { type: 'i'; value: number }
  | { type: 's'; value: string }

export interface OscMessage {
  address: string
  args: OscArg[]
}

function pad4(n: number): number {
  return (4 - (n % 4)) % 4
}

function encodeString(str: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff)
  bytes.push(0)
  const pad = pad4(bytes.length)
  for (let i = 0; i < pad; i++) bytes.push(0)
  return bytes
}

export function encodeMessage(msg: OscMessage): Uint8Array {
  const out: number[] = []
  const addr = encodeString(msg.address.startsWith('/') ? msg.address : `/${msg.address}`)
  const types = ',' + msg.args.map((a) => a.type).join('')
  const tag = encodeString(types)
  const body: number[] = []
  for (const a of msg.args) {
    if (a.type === 'i') {
      const v = Math.round(a.value) | 0
      body.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
    } else if (a.type === 'f') {
      const buf = new ArrayBuffer(4)
      new DataView(buf).setFloat32(0, a.value, false) // big-endian
      const u8 = new Uint8Array(buf)
      body.push(u8[0], u8[1], u8[2], u8[3])
    } else {
      body.push(...encodeString(a.value))
    }
  }
  out.push(...addr, ...tag, ...body)
  return new Uint8Array(out)
}

/** Bundle multiple messages into one packet with an immediate timetag. */
export function encodeBundle(messages: OscMessage[]): Uint8Array {
  const out: number[] = []
  out.push(...encodeString('#bundle'))
  // timetag: 64-bit immediate (secs=0, frac=1)
  out.push(0, 0, 0, 0, 0, 0, 0, 1)
  for (const m of messages) {
    const data = encodeMessage(m)
    const len = data.length
    out.push((len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff)
    for (let i = 0; i < data.length; i++) out.push(data[i])
  }
  return new Uint8Array(out)
}

/** Encode a message list for transport: single packet or per-message packets. */
export function encodePacket(messages: OscMessage[], bundle: boolean): Uint8Array[] {
  if (bundle && messages.length > 1) return [encodeBundle(messages)]
  return messages.map((m) => encodeMessage(m))
}

// ─── Message helpers ──────────────────────────────────────────────────────────

export function addrMessage(addr: string, value: number): OscMessage {
  return { address: addr.startsWith('/') ? addr : `/${addr}`, args: [{ type: 'f', value }] }
}

export function noteOn(ch: number, note: number, vel: number): OscMessage {
  return {
    address: '/noteon',
    args: [
      { type: 'i', value: Math.round(ch) },
      { type: 'i', value: Math.round(note) },
      { type: 'i', value: Math.max(0, Math.min(127, Math.round(vel))) },
    ],
  }
}

export function noteOff(ch: number, note: number): OscMessage {
  return {
    address: '/noteoff',
    args: [
      { type: 'i', value: Math.round(ch) },
      { type: 'i', value: Math.round(note) },
    ],
  }
}

/** Human readable preview e.g. `/ch/4  0.732` — used by the monitor panel. */
export function fmtMessage(m: OscMessage): string {
  return `${m.address}  ${m.args.map((a) => (typeof a.value === 'number' ? a.value.toFixed(3) : String(a.value))).join(' ')}`
}

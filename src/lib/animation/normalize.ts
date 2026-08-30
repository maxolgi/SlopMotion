import type {
  Clip,
  ClipAction,
  Env,
  Handle,
  Interp,
  Keyframe,
  Knob,
  Lfo,
  LfoMode,
  LfoWave,
  OscSettings,
  OscTarget,
  Project,
  Track,
} from './types'
import { TRACK_COLORS, defaultEnv, defaultLfo, uid } from './types'

// ─── Recovery normalization for persisted / imported projects ─────────────────

const INTERPS: readonly Interp[] = ['bezier', 'auto', 'linear', 'stepped']
const LFO_WAVES: readonly LfoWave[] = ['sine', 'tri', 'sawUp', 'sawDown', 'square', 'noise']
const LFO_MODES: readonly LfoMode[] = ['add', 'mul', 'replace']

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const num = (v: unknown, fb: number): number => (isNum(v) ? v : fb)
const str = (v: unknown, fb: string): string => (typeof v === 'string' ? v : fb)
const bool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb)

function normalizeHandle(v: unknown): Handle | null {
  if (!isObj(v) || !isNum(v.dt) || !isNum(v.dv)) return null
  return { dt: v.dt, dv: v.dv }
}

function normalizeKeys(raw: unknown): Keyframe[] {
  const out: Keyframe[] = []
  if (!Array.isArray(raw)) return out
  const seen = new Set<string>()
  for (const k of raw) {
    if (!isObj(k) || !isNum(k.t) || !isNum(k.v)) continue
    const interp = INTERPS.find((i) => i === k.interp) ?? 'bezier'
    const id = typeof k.id === 'string' && !seen.has(k.id) ? k.id : uid('k')
    seen.add(id)
    out.push({
      id,
      t: Math.max(0, k.t),
      v: k.v,
      interp,
      hi: interp === 'bezier' ? normalizeHandle(k.hi) : null,
      ho: interp === 'bezier' ? normalizeHandle(k.ho) : null,
      broken: bool(k.broken, false),
    })
  }
  return out.sort((a, b) => a.t - b.t)
}

function normalizeTarget(raw: unknown): OscTarget {
  if (isObj(raw) && raw.kind === 'ch' && isNum(raw.n)) return { kind: 'ch', n: Math.min(64, Math.max(1, raw.n)) }
  if (isObj(raw) && raw.kind === 'cc' && isNum(raw.ch) && isNum(raw.cc)) return { kind: 'cc', ch: raw.ch, cc: raw.cc }
  return { kind: 'ch', n: 1 }
}

function normalizeLfo(raw: unknown): Lfo {
  const l = defaultLfo()
  if (!isObj(raw)) return l
  if (typeof raw.enabled === 'boolean') l.enabled = raw.enabled
  const wave = LFO_WAVES.find((w) => w === raw.wave)
  if (wave) l.wave = wave
  l.rate = num(raw.rate, l.rate)
  if (typeof raw.bpmSync === 'boolean') l.bpmSync = raw.bpmSync
  l.beats = num(raw.beats, l.beats)
  l.phase = num(raw.phase, l.phase)
  l.amount = num(raw.amount, l.amount)
  const mode = LFO_MODES.find((m) => m === raw.mode)
  if (mode) l.mode = mode
  return l
}

function normalizeEnv(raw: unknown): Env {
  const e = defaultEnv()
  if (!isObj(raw)) return e
  if (typeof raw.enabled === 'boolean') e.enabled = raw.enabled
  e.attack = num(raw.attack, e.attack)
  e.decay = num(raw.decay, e.decay)
  e.sustain = num(raw.sustain, e.sustain)
  e.hold = num(raw.hold, e.hold)
  e.release = num(raw.release, e.release)
  e.amount = num(raw.amount, e.amount)
  return e
}

function normalizeTrack(raw: Record<string, unknown>, i: number): Track {
  return {
    id: str(raw.id, uid('tr')),
    name: str(raw.name, `Track ${i + 1}`),
    color: str(raw.color, TRACK_COLORS[i % TRACK_COLORS.length]),
    muted: bool(raw.muted, false),
    send: bool(raw.send, true),
    target: normalizeTarget(raw.target),
    min: num(raw.min, 0),
    max: num(raw.max, 1),
    keys: normalizeKeys(raw.keys),
    lfo: normalizeLfo(raw.lfo),
    env: normalizeEnv(raw.env),
  }
}

function normalizeAction(raw: unknown): ClipAction | null {
  if (!isObj(raw)) return null
  switch (raw.type) {
    case 'seek':
      return isNum(raw.time) ? { type: 'seek', time: raw.time } : null
    case 'trigger':
      return typeof raw.trackId === 'string' ? { type: 'trigger', trackId: raw.trackId } : null
    case 'flash':
      return typeof raw.trackId === 'string' && isNum(raw.value) && isNum(raw.ramp) && isNum(raw.hold)
        ? { type: 'flash', trackId: raw.trackId, value: raw.value, ramp: raw.ramp, hold: raw.hold }
        : null
    case 'note':
      return isNum(raw.ch) && isNum(raw.note) && isNum(raw.vel) && isNum(raw.durMs)
        ? { type: 'note', ch: raw.ch, note: raw.note, vel: raw.vel, durMs: raw.durMs }
        : null
    default:
      return null
  }
}

function normalizeClips(raw: unknown): Clip[] {
  if (!Array.isArray(raw)) return []
  const out: Clip[] = []
  raw.forEach((c, i) => {
    if (!isObj(c)) return
    out.push({
      id: str(c.id, uid('clip')),
      name: str(c.name, `Clip ${i + 1}`),
      color: str(c.color, TRACK_COLORS[i % TRACK_COLORS.length]),
      actions: (Array.isArray(c.actions) ? c.actions : [])
        .map(normalizeAction)
        .filter((a): a is ClipAction => a !== null),
    })
  })
  return out
}

function normalizeKnobs(raw: unknown): Knob[] {
  if (!Array.isArray(raw)) return []
  const out: Knob[] = []
  raw.forEach((k, i) => {
    if (!isObj(k)) return
    out.push({
      id: str(k.id, uid('kn')),
      label: str(k.label, `Knob ${i + 1}`),
      address: str(k.address, `/ch/${i + 1}`),
      min: num(k.min, 0),
      max: num(k.max, 1),
      value: num(k.value, 0.5),
      reset: num(k.reset, 0.5),
    })
  })
  return out
}

function normalizeXy(raw: unknown): Project['xy'] {
  if (!isObj(raw)) return { addrX: '/ch/14', addrY: '/ch/15' }
  return { addrX: str(raw.addrX, '/ch/14'), addrY: str(raw.addrY, '/ch/15') }
}

function normalizeOsc(raw: unknown): OscSettings {
  const o: OscSettings = { host: '127.0.0.1', port: 8101, rate: 30, armed: true, live: false, bundle: false }
  if (!isObj(raw)) return o
  o.host = str(raw.host, o.host)
  o.port = isNum(raw.port) && raw.port >= 1 && raw.port <= 65535 ? raw.port : o.port
  o.rate = isNum(raw.rate) ? Math.min(120, Math.max(10, raw.rate)) : o.rate
  o.armed = bool(raw.armed, true)
  o.live = bool(raw.live, false)
  o.bundle = bool(raw.bundle, false)
  return o
}

export function normalizeProject(raw: unknown): Project | null {
  if (!isObj(raw) || !Array.isArray(raw.tracks)) return null
  return {
    version: 1,
    name: str(raw.name, 'Untitled'),
    fps: num(raw.fps, 30),
    bpm: num(raw.bpm, 120),
    duration: isNum(raw.duration) && raw.duration >= 1 ? raw.duration : 16,
    tracks: raw.tracks.filter(isObj).map(normalizeTrack),
    clips: normalizeClips(raw.clips),
    knobs: normalizeKnobs(raw.knobs),
    xy: normalizeXy(raw.xy),
    osc: normalizeOsc(raw.osc),
  }
}

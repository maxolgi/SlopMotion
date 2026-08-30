// ─── SlopMotion data model ────────────────────────────────────────────────────

export type Interp = 'bezier' | 'auto' | 'linear' | 'stepped'

export interface Handle {
  /** horizontal offset from key time in seconds (in: ≤ 0, out: ≥ 0) */
  dt: number
  /** vertical offset from key value (logical value units) */
  dv: number
}

export interface Keyframe {
  id: string
  t: number
  v: number
  interp: Interp
  /** incoming handle (only used when interp === 'bezier') */
  hi: Handle | null
  /** outgoing handle (only used when interp === 'bezier') */
  ho: Handle | null
  /** true when hi/ho move independently; false = unified tangent */
  broken: boolean
}

export type LfoWave = 'sine' | 'tri' | 'sawUp' | 'sawDown' | 'square' | 'noise'
export type LfoMode = 'add' | 'mul' | 'replace'

export interface Lfo {
  enabled: boolean
  wave: LfoWave
  /** Hz when !bpmSync */
  rate: number
  bpmSync: boolean
  /** beats per cycle when bpmSync: 4 = 4/4 bar, 1 = quarter … */
  beats: number
  phase: number // 0..1
  amount: number // 0..1
  mode: LfoMode
}

export interface Env {
  enabled: boolean
  attack: number // s
  decay: number // s
  sustain: number // 0..1
  hold: number // s — sustain hold before release
  release: number // s
  /** 0 = pure gain on curve output, 1 = full replacement of level */
  amount: number
}

export type OscTarget =
  | { kind: 'ch'; n: number } // /ch/{n} float 0..1
  | { kind: 'cc'; ch: number; cc: number } // /cc int int int

export interface Track {
  id: string
  name: string
  color: string
  muted: boolean
  /** include in OSC output */
  send: boolean
  target: OscTarget
  /** logical output range mapped onto the OSC 0..1 arg */
  min: number
  max: number
  keys: Keyframe[]
  lfo: Lfo
  env: Env
}

export type ClipAction =
  | { type: 'seek'; time: number }
  | { type: 'trigger'; trackId: string }
  | { type: 'flash'; trackId: string; value: number; ramp: number; hold: number }
  | { type: 'note'; ch: number; note: number; vel: number; durMs: number }

export interface Clip {
  id: string
  name: string
  color: string
  actions: ClipAction[]
}

export interface Knob {
  id: string
  label: string
  address: string
  min: number
  max: number
  value: number
  reset: number
}

export interface OscSettings {
  host: string
  port: number
  /** send rate in Hz (10–120) */
  rate: number
  /** master arm switch */
  armed: boolean
  /** false = simulate only (log, no UDP). true = POST to /api/osc/send */
  live: boolean
  /** bundle all messages of one tick into a single UDP packet */
  bundle: boolean
}

export interface Project {
  version: 1
  name: string
  fps: number
  bpm: number
  /** loop length in seconds */
  duration: number
  tracks: Track[]
  clips: Clip[]
  knobs: Knob[]
  xy: { addrX: string; addrY: string }
  osc: OscSettings
}

export interface Selection {
  trackIds: string[]
  /** trackId -> key ids */
  keyIds: Record<string, string[]>
}

export const TRACK_COLORS = [
  '#22d3ee', // cyan
  '#e879f9', // magenta
  '#fbbf24', // amber
  '#34d399', // emerald
  '#a78bfa', // violet
  '#fb7185', // rose
  '#a3e635', // lime
  '#fb923c', // orange
]

let uidCounter = 0
export function uid(prefix = 'id'): string {
  uidCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${uidCounter}`
}

export function defaultLfo(): Lfo {
  return {
    enabled: false,
    wave: 'sine',
    rate: 0.5,
    bpmSync: false,
    beats: 2,
    phase: 0,
    amount: 0.2,
    mode: 'add',
  }
}

export function defaultEnv(): Env {
  return { enabled: false, attack: 0.05, decay: 0.4, sustain: 0.6, hold: 0.2, release: 0.8, amount: 0.8 }
}

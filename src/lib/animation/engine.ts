'use client'

import {
  ccMessage,
  chMessage,
  fmtMessage,
  noteOff,
  noteOn,
  type OscMessage,
} from '@/lib/osc/encode'
import { sendOsc, setOscTransportErrorHandler } from '@/lib/osc/bridge'
import { evalCurve, clamp } from './curve'
import { applyEnv, applyLfo, envOneShot, lfoValue } from './modulators'
import type { Clip, Track } from './types'

// ─── Animation engine (module singleton) ─────────────────────────────────────
// Owns the transport clock, the evaluation pipeline and the throttled OSC
// dispatch. Structural state (tracks, keys…) lives in the zustand store; the
// engine pulls it through the accessor registered at boot to avoid cycles.

interface EnvTrigger {
  start: number // perf seconds
}
interface FlashOverride {
  from: number
  to: number
  start: number
  ramp: number
  hold: number
}

export interface MonitorEntry {
  t: number
  text: string
  live: boolean
}

export interface EngineStats {
  sent: number
  errors: number
  lastError: string | null
  lastSendAt: number
  msgRate: number
}

export interface TrackEval {
  base: number
  final: number
  arg: number // 0..1 OSC value
}

type ProjectGetter = () => {
  project: {
    tracks: Track[]
    clips: Clip[]
    bpm: number
    duration: number
    osc: {
      host: string
      port: number
      rate: number
      armed: boolean
      live: boolean
      bundle: boolean
    }
  }
}

class AnimationEngine {
  playing = false
  loop = true
  private playStartPerf = 0
  private playStartHead = 0
  private head = 0 // playhead seconds (project time)
  private accessor: ProjectGetter | null = null

  private lastSend = 0
  private rateWindow: number[] = []

  private envTriggers = new Map<string, EnvTrigger[]>()
  private flashes = new Map<string, FlashOverride>()
  private learnTrackId: string | null = null
  private learnStart = 0

  monitor: MonitorEntry[] = []
  stats: EngineStats = { sent: 0, errors: 0, lastError: null, lastSendAt: 0, msgRate: 0 }

  setAccessor(fn: ProjectGetter) {
    this.accessor = fn
  }

  private project() {
    return this.accessor?.().project ?? null
  }

  // ── transport ──────────────────────────────────────────────────────────────
  get time(): number {
    if (!this.playing) return this.head
    const p = this.project()
    const dur = p && p.duration > 0 ? p.duration : 0
    let t = this.playStartHead + (performance.now() - this.playStartPerf) / 1000
    if (dur > 0 && this.loop) t = t % dur
    this.head = t
    return t
  }

  play() {
    if (this.playing) return
    this.playing = true
    this.playStartPerf = performance.now()
    this.playStartHead = this.head
  }

  pause() {
    if (!this.playing) return
    this.head = this.time
    this.playing = false
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  stop() {
    this.playing = false
    this.head = 0
  }

  seek(t: number) {
    this.head = Math.max(0, t)
    this.playStartHead = this.head
    this.playStartPerf = performance.now()
  }

  setLoop(b: boolean) {
    this.loop = b
  }

  // ── evaluation ─────────────────────────────────────────────────────────────
  private flashValue(trackId: string, base: number, now: number): number | null {
    const f = this.flashes.get(trackId)
    if (!f) return null
    const el = now - f.start
    const { ramp, hold } = f
    if (el < ramp) return f.from + (f.to - f.from) * (el / Math.max(1e-4, ramp))
    if (el < ramp + hold) return f.to
    const rel = (el - ramp - hold) / Math.max(1e-4, ramp * 0.5)
    if (rel < 1) return f.to + (base - f.to) * rel
    this.flashes.delete(trackId)
    return null
  }

  private envLevel(track: Track, now: number): number {
    if (!track.env.enabled) return 1
    const list = this.envTriggers.get(track.id)
    if (!list || list.length === 0) return 0
    let level = 0
    const keep: EnvTrigger[] = []
    for (const tr of list) {
      const l = envOneShot(track.env, now - tr.start, track.env.hold)
      if (l > 0) keep.push(tr)
      if (l > level) level = l
    }
    if (keep.length !== list.length) this.envTriggers.set(track.id, keep)
    return level
  }

  /** Evaluate a track at project time t / perf now. */
  evalTrack(track: Track, t: number, now = performance.now() / 1000): TrackEval {
    const base0 = evalCurve(track.keys, t)
    const flash = this.flashValue(track.id, base0, now)
    const base = flash ?? base0
    let out = base
    if (track.lfo.enabled) {
      out = applyLfo(out, track.lfo, lfoValue(track.lfo, t, this.project()?.bpm ?? 120))
    }
    const ev = this.envLevel(track, now)
    if (track.env.enabled && ev > 0) out = applyEnv(out, track.env, ev)
    const span = Math.max(1e-9, track.max - track.min)
    const arg = clamp((out - track.min) / span, 0, 1)
    return { base: base0, final: out, arg }
  }

  // ── triggers / clips / learn ───────────────────────────────────────────────
  triggerEnv(trackId: string) {
    const list = this.envTriggers.get(trackId) ?? []
    list.push({ start: performance.now() / 1000 })
    this.envTriggers.set(trackId, list.slice(-8))
  }

  flash(trackId: string, value: number, ramp = 0.08, hold = 0.25) {
    const p = this.project()
    const track = p?.tracks.find((tr) => tr.id === trackId)
    if (!track) return
    const cur = this.evalTrack(track, this.time).final
    this.flashes.set(trackId, {
      from: cur,
      to: value,
      start: performance.now() / 1000,
      ramp,
      hold,
    })
  }

  launchClip(clip: Clip) {
    for (const a of clip.actions) {
      if (a.type === 'seek') this.seek(a.time)
      else if (a.type === 'trigger') this.triggerEnv(a.trackId)
      else if (a.type === 'flash') this.flash(a.trackId, a.value, a.ramp, a.hold)
      else if (a.type === 'note') this.sendNote(a.ch, a.note, a.vel, a.durMs)
    }
  }

  startLearn(trackId: string | null) {
    this.learnTrackId = trackId
    this.learnStart = performance.now()
  }

  get learning(): string | null {
    if (this.learnTrackId && performance.now() - this.learnStart > 15000) this.learnTrackId = null
    return this.learnTrackId
  }

  // ── OSC dispatch ───────────────────────────────────────────────────────────
  private trackMessage(track: Track, arg: number): OscMessage {
    if (track.target.kind === 'cc') return ccMessage(track.target.ch, track.target.cc, arg * 127)
    return chMessage(track.target.n, arg)
  }

  /** Immediate direct send (knobs, XY pad, notes, learn pulses). */
  sendImmediate(messages: OscMessage[]) {
    if (messages.length === 0) return
    const p = this.project()
    if (!p) return
    const { live, armed, host, port } = p.osc
    this.log(messages, live && armed)
    if (!live || !armed) return
    // Fire-and-forget transport: WS sends count as success immediately; the
    // POST fallback and WS disconnects report errors through the bridge hook.
    sendOsc({ host, port, bundle: false, messages })
    this.stats.sent += messages.length
    this.stats.lastSendAt = performance.now()
    this.stats.lastError = null
  }

  sendNote(ch: number, note: number, vel: number, durMs: number) {
    void this.sendImmediate([noteOn(ch, note, vel)])
    window.setTimeout(() => void this.sendImmediate([noteOff(ch, note)]), Math.max(30, durMs))
  }

  /** Called every animation frame by the driver component. */
  tick() {
    const p = this.project()
    if (!p) return
    const now = performance.now()
    const osc = p.osc
    const t = this.time

    // learn pulse: sweep 0→1→0 at 20 Hz on the learned track's address
    const learnId = this.learning
    if (learnId) {
      const track = p.tracks.find((tr) => tr.id === learnId)
      if (track) {
        if (now - this.lastSend > 50) {
          const ph = ((now - this.learnStart) / 2400) % 1
          const v = ph < 0.5 ? ph * 2 : 2 - ph * 2
          void this.sendImmediate([this.trackMessage(track, v)])
          this.lastSend = now
        }
        return // suppress normal traffic during learn for clarity
      }
    }

    if (now - this.lastSend < 1000 / Math.max(5, Math.min(120, osc.rate))) return
    this.lastSend = now

    const messages: OscMessage[] = []
    for (const track of p.tracks) {
      if (track.muted || !track.send) continue
      const { arg } = this.evalTrack(track, t)
      messages.push(this.trackMessage(track, arg))
    }
    if (messages.length === 0) return
    this.log(messages, osc.live && osc.armed)

    this.rateWindow.push(now)
    while (this.rateWindow.length > 0 && now - this.rateWindow[0] > 1000) this.rateWindow.shift()
    this.stats.msgRate = this.rateWindow.length

    if (!osc.live || !osc.armed) return
    sendOsc({
      host: osc.host,
      port: osc.port,
      bundle: osc.bundle,
      messages: messages.map((m) => ({
        address: m.address,
        args: m.args.map((a) => ({ ...a })),
      })),
    })
    this.stats.sent += messages.length
    this.stats.lastSendAt = performance.now()
    this.stats.lastError = null
  }

  private log(messages: OscMessage[], live: boolean) {
    const t = performance.now()
    for (const m of messages) {
      this.monitor.push({ t, text: fmtMessage(m), live })
    }
    if (this.monitor.length > 160) this.monitor.splice(0, this.monitor.length - 160)
  }
}

export const engine = new AnimationEngine()

// Surface bridge errors (POST fallback failures, WS disconnects — once per
// disconnect, not per message) in the stats panel.
setOscTransportErrorHandler((message) => {
  engine.stats.errors += 1
  engine.stats.lastError = message
})

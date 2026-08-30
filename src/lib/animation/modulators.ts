import type { Env, Lfo } from './types'

// ─── LFO / Envelope generators ────────────────────────────────────────────────

export function lfoValue(lfo: Lfo, t: number, bpm: number): number {
  const period = lfo.bpmSync
    ? Math.max(1e-6, (60 / Math.max(1, bpm)) * Math.max(0.001, lfo.beats))
    : 1 / Math.max(0.01, lfo.rate)
  let phase = (t / period + lfo.phase) % 1
  if (phase < 0) phase += 1
  switch (lfo.wave) {
    case 'sine':
      return Math.sin(phase * Math.PI * 2)
    case 'tri':
      return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4
    case 'sawUp':
      return phase * 2 - 1
    case 'sawDown':
      return 1 - phase * 2
    case 'square':
      return phase < 0.5 ? 1 : -1
    case 'noise': {
      // cheap deterministic value-noise: linear interp of random lattice
      const x = phase * 8
      const i = Math.floor(x)
      const f = x - i
      const r = (n: number) => {
        const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
        return s - Math.floor(s)
      }
      const a = r(i) * 2 - 1
      const b = r(i + 1) * 2 - 1
      const u = f * f * (3 - 2 * f)
      return a + (b - a) * u
    }
  }
}

/** ADSR level (0..1) `elapsed` seconds after a trigger. */
export function envValue(env: Env, elapsed: number): number {
  const { attack, decay, sustain, release } = env
  if (elapsed < 0) return 0
  if (elapsed < attack) return attack <= 0 ? 1 : elapsed / attack
  const d = elapsed - attack
  if (d < decay) return decay <= 0 ? sustain : 1 + (sustain - 1) * (d / decay)
  return sustain
  // release is applied by the engine once the trigger is released (gate-less
  // one-shots decay to 0 after sustain hold → handled in engine envLevel)
}

/** Full one-shot envelope including release ramp after sustainHold seconds. */
export function envOneShot(env: Env, elapsed: number, hold: number): number {
  if (elapsed < 0) return 0
  const sustainLevel = envValue(env, elapsed)
  if (elapsed <= hold) return sustainLevel
  const r = (elapsed - hold) / Math.max(1e-4, env.release)
  if (r >= 1) return 0
  return sustainLevel * (1 - r)
}

/** Apply an envelope to a base value. mode gain: base scaled toward silence;
 *  mode add: envelope value added on top. */
export function applyEnv(base: number, env: Env, level: number): number {
  if (env.amount <= 0) return base
  // gain-style: out = base * (1 - amount + amount * level)
  return base * (1 - env.amount + env.amount * level)
}

/** Apply an LFO to a base value according to its mode. */
export function applyLfo(base: number, lfo: Lfo, l: number): number {
  if (lfo.mode === 'add') return base + lfo.amount * l
  if (lfo.mode === 'mul') return base * (1 + lfo.amount * l)
  // replace: full substitution, centered
  return lfo.amount * (l * 0.5 + 0.5)
}

import type { Handle, Interp, Keyframe } from './types'

// ─── Curve interpolation core ─────────────────────────────────────────────────
// Segments are evaluated as cubic Béziers in (time, value) space:
//   P0 = (t0, v0), P1 = P0 + ho0, P2 = P3 + hi1, P3 = (t1, v1)
// Because time must stay monotonic, handle dt is clamped inside the segment
// before evaluation. The x(s)→s solve uses Newton with bisection fallback.

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function sortKeys(keys: Keyframe[]): Keyframe[] {
  return [...keys].sort((a, b) => a.t - b.t)
}

/** segment duration-aware handle clamp: keeps control points inside [t0, t1] */
function segHandles(k0: Keyframe, k1: Keyframe): { h0: Handle; h1: Handle } {
  const T = Math.max(1e-6, k1.t - k0.t)
  const h0: Handle =
    k0.interp === 'bezier' && k0.ho ? { ...k0.ho } : { dt: T / 3, dv: 0 }
  const h1: Handle =
    k1.interp === 'bezier' && k1.hi ? { ...k1.hi } : { dt: -T / 3, dv: 0 }
  h0.dt = clamp(h0.dt, 0, T)
  h1.dt = clamp(h1.dt, -T, 0)
  return { h0, h1 }
}

/** Auto (Catmull-Rom-ish) handles — used when interp === 'auto' or when
 *  converting an auto key into an editable bezier key. */
export function autoHandles(
  prev: Keyframe | undefined,
  k: Keyframe,
  next: Keyframe | undefined
): { hi: Handle; ho: Handle } {
  const tp = prev?.t ?? k.t - 1
  const vp = prev?.v ?? k.v
  const tn = next?.t ?? k.t + 1
  const vn = next?.v ?? k.v
  const dtSpan = Math.max(1e-6, tn - tp)
  const slope = (vn - vp) / dtSpan
  const left = Math.min((k.t - tp) * 0.35, (tn - k.t) * 0.45)
  const right = Math.min((tn - k.t) * 0.35, (k.t - tp) * 0.45)
  return {
    hi: { dt: -Math.max(1e-3, left), dv: -Math.max(1e-3, left) * slope },
    ho: { dt: Math.max(1e-3, right), dv: Math.max(1e-3, right) * slope },
  }
}

function bezX(s: number, x0: number, x1: number, x2: number, x3: number): number {
  const u = 1 - s
  return u * u * u * x0 + 3 * u * u * s * x1 + 3 * u * s * s * x2 + s * s * s * x3
}

function bezY(s: number, y0: number, y1: number, y2: number, y3: number): number {
  const u = 1 - s
  return u * u * u * y0 + 3 * u * u * s * y1 + 3 * u * s * s * y2 + s * s * s * y3
}

/** solve s ∈ [0,1] so that bezX(s) === t (time), via Newton + bisection */
function solveS(t: number, x0: number, x1: number, x2: number, x3: number): number {
  if (t <= x0) return 0
  if (t >= x3) return 1
  let s = (t - x0) / (x3 - x0 || 1e-9) // initial guess
  for (let i = 0; i < 8; i++) {
    const x = bezX(s, x0, x1, x2, x3)
    // derivative of bezX
    const u = 1 - s
    const dx =
      3 * u * u * (x1 - x0) + 6 * u * s * (x2 - x1) + 3 * s * s * (x3 - x2)
    if (Math.abs(dx) < 1e-9) break
    const next = s - (x - t) / dx
    if (next < 0 || next > 1) break
    if (Math.abs(next - s) < 1e-7) return next
    s = next
  }
  // bisection fallback
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    s = (lo + hi) / 2
    const x = bezX(s, x0, x1, x2, x3)
    if (Math.abs(x - t) < 1e-7) return s
    if (x < t) lo = s
    else hi = s
  }
  return s
}

/** Evaluate the keyframe curve at time t (base value, no modulators). */
export function evalCurve(keys: Keyframe[], t: number): number {
  const ks = keys // expected pre-sorted
  if (ks.length === 0) return 0
  if (t <= ks[0].t) return ks[0].v
  if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].v

  // find segment i: ks[i].t <= t < ks[i+1].t
  let lo = 0
  let hi = ks.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (t >= ks[mid].t) lo = mid
    else hi = mid - 1
  }
  const i = lo
  const k0 = ks[i]
  const k1 = ks[i + 1]

  if (k0.interp === 'stepped') return k0.v
  if (k0.interp === 'linear') {
    const f = (t - k0.t) / Math.max(1e-9, k1.t - k0.t)
    return k0.v + (k1.v - k0.v) * f
  }

  let h0: Handle
  let h1: Handle
  if (k0.interp === 'auto') {
    const a0 = autoHandles(ks[i - 1], k0, k1)
    h0 = a0.ho
  } else h0 = segHandles(k0, k1).h0
  if (k1.interp === 'auto') {
    const a1 = autoHandles(k0, k1, ks[i + 2])
    h1 = a1.hi
  } else h1 = segHandles(k0, k1).h1

  const x1 = k0.t + h0.dt
  const y1 = k0.v + h0.dv
  const x2 = k1.t + h1.dt
  const y2 = k1.v + h1.dv
  const s = solveS(t, k0.t, x1, x2, k1.t)
  return bezY(s, k0.v, y1, y2, k1.v)
}

/** Bake 'auto' handles into concrete bezier handles (used when the user grabs
 *  a handle of an auto key or applies an easing preset). */
export function bakeHandles(keys: Keyframe[], keyId: string): Keyframe[] {
  return keys.map((k, i) => {
    if (k.id !== keyId || k.interp !== 'auto') return k
    const a = autoHandles(keys[i - 1], k, keys[i + 1])
    return { ...k, interp: 'bezier' as Interp, hi: a.hi, ho: a.ho }
  })
}

export interface EasePreset {
  id: string
  label: string
  /** CSS cubic-bezier style control values (x1,y1,x2,y2) mapped onto segment */
  cb: [number, number, number, number]
}

export const EASE_PRESETS: EasePreset[] = [
  { id: 'linear', label: 'Linear', cb: [0, 0, 1, 1] },
  { id: 'ease', label: 'Ease (smooth)', cb: [0.25, 0.1, 0.25, 1] },
  { id: 'easeIn', label: 'Ease In', cb: [0.42, 0, 1, 1] },
  { id: 'easeOut', label: 'Ease Out', cb: [0, 0, 0.58, 1] },
  { id: 'easeInOut', label: 'Ease In-Out', cb: [0.42, 0, 0.58, 1] },
  { id: 'sineIn', label: 'Sine In', cb: [0.12, 0, 0.39, 0] },
  { id: 'sineOut', label: 'Sine Out', cb: [0.61, 1, 0.88, 1] },
  { id: 'circOut', label: 'Circ Out', cb: [0.075, 0.82, 0.165, 1] },
  { id: 'backOut', label: 'Back Out (overshoot)', cb: [0.34, 1.56, 0.64, 1] },
  { id: 'expoOut', label: 'Expo Out', cb: [0.19, 1, 0.22, 1] },
]

/** Apply a cubic-bezier ease preset to the outgoing handle of k0 and the
 *  incoming handle of k1, converting both segments to bezier. */
export function applyEase(
  keys: Keyframe[],
  k0Id: string,
  k1Id: string,
  preset: EasePreset
): Keyframe[] {
  const k0 = keys.find((k) => k.id === k0Id)
  const k1 = keys.find((k) => k.id === k1Id)
  if (!k0 || !k1) return keys
  const T = Math.max(1e-6, k1.t - k0.t)
  const dv = k1.v - k0.v
  const [x1, y1, x2, y2] = preset.cb
  return keys.map((k, i) => {
    if (k.id === k0Id)
      return {
        ...k,
        interp: 'bezier' as Interp,
        ho: { dt: x1 * T, dv: y1 * dv },
        hi: k.interp === 'auto' ? autoHandles(keys[i - 1], k, keys[i + 1]).hi : k.hi,
      }
    if (k.id === k1Id)
      return {
        ...k,
        interp: 'bezier' as Interp,
        hi: { dt: (x2 - 1) * T, dv: (y2 - 1) * dv },
        ho: k.interp === 'auto' ? autoHandles(keys[i - 1], k, keys[i + 1]).ho : k.ho,
      }
    return k
  })
}

/** Flatten a key's handles to horizontal (slope 0, keep length). */
export function flattenHandles(keys: Keyframe[], keyId: string): Keyframe[] {
  return keys.map((k) => {
    if (k.id !== keyId) return k
    const hi = k.hi ? { dt: k.hi.dt, dv: 0 } : null
    const ho = k.ho ? { dt: k.ho.dt, dv: 0 } : null
    return { ...k, interp: 'bezier' as Interp, hi, ho }
  })
}

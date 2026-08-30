import { describe, expect, it } from 'vitest'
import type { Handle, Interp, Keyframe } from './types'
import {
  EASE_PRESETS,
  applyEase,
  autoHandles,
  bakeHandles,
  evalCurve,
  flattenHandles,
  sortKeys,
} from './curve'

const h = (dt: number, dv: number): Handle => ({ dt, dv })

const key = (
  id: string,
  t: number,
  v: number,
  interp: Interp = 'bezier',
  hi: Handle | null = null,
  ho: Handle | null = null,
): Keyframe => ({ id, t, v, interp, hi, ho, broken: false })

const preset = (id: string) => EASE_PRESETS.find((p) => p.id === id)!

describe('evalCurve', () => {
  it('returns 0 for empty keys', () => {
    expect(evalCurve([], 5)).toBe(0)
  })

  it('returns the single key value everywhere', () => {
    const ks = [key('a', 1, 0.7)]
    expect(evalCurve(ks, 0)).toBeCloseTo(0.7)
    expect(evalCurve(ks, 1)).toBeCloseTo(0.7)
    expect(evalCurve(ks, 100)).toBeCloseTo(0.7)
  })

  it('clamps to endpoint values outside the key range', () => {
    const ks = [key('a', 0, 0.1, 'linear'), key('b', 2, 0.9, 'linear')]
    expect(evalCurve(ks, -1)).toBeCloseTo(0.1)
    expect(evalCurve(ks, 0)).toBeCloseTo(0.1)
    expect(evalCurve(ks, 2)).toBeCloseTo(0.9)
    expect(evalCurve(ks, 3)).toBeCloseTo(0.9)
  })

  it('stepped holds the left key value across the segment', () => {
    const ks = [
      key('a', 0, 0, 'stepped'),
      key('b', 1, 0.5, 'stepped'),
      key('c', 2, 1, 'stepped'),
    ]
    expect(evalCurve(ks, 0.5)).toBeCloseTo(0)
    expect(evalCurve(ks, 0.999)).toBeCloseTo(0)
    expect(evalCurve(ks, 1.5)).toBeCloseTo(0.5)
    expect(evalCurve(ks, 1.999)).toBeCloseTo(0.5)
    expect(evalCurve(ks, 2)).toBeCloseTo(1)
  })

  it('linear lerps the midpoint', () => {
    const ks = [key('a', 0, 0, 'linear'), key('b', 2, 1, 'linear')]
    expect(evalCurve(ks, 1)).toBeCloseTo(0.5)
    expect(evalCurve(ks, 0.5)).toBeCloseTo(0.25)
    expect(evalCurve(ks, 1.6)).toBeCloseTo(0.8)
  })

  it('bezier hits exact key values at key times', () => {
    const ks = [
      key('a', 0, 0.2, 'bezier', h(-0.3, 0.05), h(0.3, -0.05)),
      key('b', 1, 0.8, 'bezier', h(-0.25, 0.1), h(0.25, 0)),
      key('c', 3, 0.4, 'bezier', h(-0.3, 0), h(0.3, 0)),
    ]
    expect(evalCurve(ks, 0)).toBeCloseTo(0.2)
    expect(evalCurve(ks, 1)).toBeCloseTo(0.8)
    expect(evalCurve(ks, 3)).toBeCloseTo(0.4)
  })

  it('bezier with default handles stays between key values', () => {
    const ks = [key('a', 0, 0), key('b', 2, 1)]
    expect(evalCurve(ks, 1)).toBeCloseTo(0.5)
    for (let t = 0.05; t < 2; t += 0.05) {
      const v = evalCurve(ks, t)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('produces finite values for broken and out-of-segment handles', () => {
    const ks = [
      key('a', 0, 0, 'bezier', h(-2, 5), h(3, -4)),
      key('b', 1, 1, 'bezier', h(5, 3), h(-2, -7)),
      key('c', 2, -1, 'bezier', h(-4, 2), h(4, 2)),
    ]
    for (let t = 0; t <= 2.0001; t += 0.04) {
      expect(Number.isFinite(evalCurve(ks, t))).toBe(true)
    }
  })

  it('auto interp produces finite values hitting key values at key times', () => {
    const ks = [
      key('a', 0, 0.1, 'auto'),
      key('b', 1, 0.9, 'auto'),
      key('c', 2, 0.2, 'auto'),
      key('d', 3, 0.7, 'auto'),
    ]
    expect(evalCurve(ks, 0)).toBeCloseTo(0.1)
    expect(evalCurve(ks, 1)).toBeCloseTo(0.9)
    expect(evalCurve(ks, 2)).toBeCloseTo(0.2)
    expect(evalCurve(ks, 3)).toBeCloseTo(0.7)
    for (let t = 0; t <= 3.0001; t += 0.03) {
      expect(Number.isFinite(evalCurve(ks, t))).toBe(true)
    }
  })
})

describe('sortKeys', () => {
  it('orders by time and does not mutate the input', () => {
    const input = [key('b', 2, 0), key('a', 0, 1), key('c', 1, 0.5)]
    const sorted = sortKeys(input)
    expect(sorted.map((k) => k.id)).toEqual(['a', 'c', 'b'])
    expect(input.map((k) => k.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('autoHandles', () => {
  it('computes slope-following handles for a middle key', () => {
    const a = key('a', 0, 0, 'auto')
    const b = key('b', 1, 1, 'auto')
    const c = key('c', 2, 0, 'auto')
    const r = autoHandles(a, b, c)
    expect(r.hi.dt).toBeCloseTo(-0.35)
    expect(r.hi.dv).toBeCloseTo(0)
    expect(r.ho.dt).toBeCloseTo(0.35)
    expect(r.ho.dv).toBeCloseTo(0)
  })

  it('extrapolates a virtual previous key at edges', () => {
    const a = key('a', 0, 0, 'auto')
    const b = key('b', 1, 1, 'auto')
    const r = autoHandles(undefined, a, b)
    expect(r.hi.dt).toBeCloseTo(-0.35)
    expect(r.hi.dv).toBeCloseTo(-0.175)
    expect(r.ho.dt).toBeCloseTo(0.35)
    expect(r.ho.dv).toBeCloseTo(0.175)
  })
})

describe('bakeHandles', () => {
  const ks = [
    key('a', 0, 0, 'auto'),
    key('b', 1, 1, 'bezier', h(-0.2, 0), h(0.2, 0)),
    key('c', 2, 0.4, 'auto'),
  ]

  it('converts only the targeted auto key to bezier with handles', () => {
    const out = bakeHandles(ks, 'c')
    expect(out[2].interp).toBe('bezier')
    expect(out[2].hi).not.toBeNull()
    expect(out[2].ho).not.toBeNull()
    expect(Number.isFinite(out[2].hi!.dt)).toBe(true)
    expect(Number.isFinite(out[2].hi!.dv)).toBe(true)
    expect(out[0].interp).toBe('auto')
    expect(out[1].interp).toBe('bezier')
    expect(out[0]).toBe(ks[0])
    expect(out[1]).toBe(ks[1])
  })

  it('computes baked handle values from neighbors', () => {
    const out = bakeHandles(ks, 'a')
    expect(out[0].interp).toBe('bezier')
    expect(out[0].hi!.dt).toBeCloseTo(-0.35)
    expect(out[0].hi!.dv).toBeCloseTo(-0.175)
    expect(out[0].ho!.dt).toBeCloseTo(0.35)
    expect(out[0].ho!.dv).toBeCloseTo(0.175)
  })

  it('leaves non-auto keys untouched', () => {
    const out = bakeHandles(ks, 'b')
    expect(out[1]).toBe(ks[1])
    expect(out[0].interp).toBe('auto')
    expect(out[2].interp).toBe('auto')
  })
})

describe('applyEase', () => {
  const ks = [
    key('a', 0, 0, 'bezier', h(-0.2, 0), h(0.2, 0)),
    key('b', 2, 1, 'bezier', h(-0.2, 0.1), h(0.2, 0)),
  ]

  it('linear preset scales segment handles by T and dv', () => {
    const out = applyEase(ks, 'a', 'b', preset('linear'))
    expect(out[0].interp).toBe('bezier')
    expect(out[1].interp).toBe('bezier')
    expect(out[0].ho!.dt).toBeCloseTo(0)
    expect(out[0].ho!.dv).toBeCloseTo(0)
    expect(out[1].hi!.dt).toBeCloseTo(0)
    expect(out[1].hi!.dv).toBeCloseTo(0)
    expect(out[0].hi).toEqual(h(-0.2, 0))
    expect(out[1].ho).toEqual(h(0.2, 0))
  })

  it('backOut preset maps cb onto segment out and in handles', () => {
    const out = applyEase(ks, 'a', 'b', preset('backOut'))
    expect(out[0].ho!.dt).toBeCloseTo(0.34 * 2)
    expect(out[0].ho!.dv).toBeCloseTo(1.56 * 1)
    expect(out[1].hi!.dt).toBeCloseTo((0.64 - 1) * 2)
    expect(out[1].hi!.dv).toBeCloseTo((1 - 1) * 1)
  })

  it('returns keys unchanged when a key id is missing', () => {
    expect(applyEase(ks, 'a', 'zz', preset('linear'))).toEqual(ks)
  })
})

describe('flattenHandles', () => {
  it('zeroes dv keeping dt and forces bezier', () => {
    const out = flattenHandles([key('a', 1, 0.5, 'bezier', h(-0.4, 0.25), h(0.3, -0.6))], 'a')
    expect(out[0].interp).toBe('bezier')
    expect(out[0].hi).toEqual({ dt: -0.4, dv: 0 })
    expect(out[0].ho).toEqual({ dt: 0.3, dv: 0 })
  })

  it('keeps null handles null', () => {
    const out = flattenHandles([key('a', 1, 0.5, 'linear')], 'a')
    expect(out[0].interp).toBe('bezier')
    expect(out[0].hi).toBeNull()
    expect(out[0].ho).toBeNull()
  })
})

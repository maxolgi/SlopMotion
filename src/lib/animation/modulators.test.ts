import { describe, expect, it } from 'vitest'
import type { Env, Lfo } from './types'
import { applyEnv, applyLfo, envOneShot, envValue, lfoValue } from './modulators'

const lfo = (o: Partial<Lfo> = {}): Lfo => ({
  enabled: true,
  wave: 'sine',
  rate: 1,
  bpmSync: false,
  beats: 2,
  phase: 0,
  amount: 0.5,
  mode: 'add',
  ...o,
})

const env = (o: Partial<Env> = {}): Env => ({
  enabled: true,
  attack: 1,
  decay: 1,
  sustain: 0.5,
  hold: 1,
  release: 1,
  amount: 1,
  ...o,
})

describe('lfoValue', () => {
  it('sine hits 0, 1 and -1 at quarter phases', () => {
    expect(lfoValue(lfo(), 0, 120)).toBeCloseTo(0)
    expect(lfoValue(lfo(), 0.25, 120)).toBeCloseTo(1)
    expect(lfoValue(lfo(), 0.75, 120)).toBeCloseTo(-1)
  })

  it('sine phase field offsets the cycle', () => {
    expect(lfoValue(lfo({ phase: 0.75 }), 0, 120)).toBeCloseTo(-1)
    expect(lfoValue(lfo({ phase: 0.25 }), 0, 120)).toBeCloseTo(1)
  })

  it('tri is -1 at 0, 1 at half and 0 at quarter phases', () => {
    const l = lfo({ wave: 'tri' })
    expect(lfoValue(l, 0, 120)).toBeCloseTo(-1)
    expect(lfoValue(l, 0.5, 120)).toBeCloseTo(1)
    expect(lfoValue(l, 0.25, 120)).toBeCloseTo(0)
    expect(lfoValue(l, 0.75, 120)).toBeCloseTo(0)
  })

  it('square is 1 on the first half and -1 on the second', () => {
    const l = lfo({ wave: 'square' })
    expect(lfoValue(l, 0.25, 120)).toBeCloseTo(1)
    expect(lfoValue(l, 0.75, 120)).toBeCloseTo(-1)
  })

  it('sawUp and sawDown are antisymmetric at quarter phases', () => {
    expect(lfoValue(lfo({ wave: 'sawUp' }), 0.25, 120)).toBeCloseTo(-0.5)
    expect(lfoValue(lfo({ wave: 'sawUp' }), 0.75, 120)).toBeCloseTo(0.5)
    expect(lfoValue(lfo({ wave: 'sawDown' }), 0.25, 120)).toBeCloseTo(0.5)
    expect(lfoValue(lfo({ wave: 'sawDown' }), 0.75, 120)).toBeCloseTo(-0.5)
  })

  it('noise is deterministic and bounded', () => {
    const l = lfo({ wave: 'noise' })
    expect(lfoValue(l, 0.3, 120)).toBe(lfoValue(l, 0.3, 120))
    for (let t = 0; t < 2; t += 0.013) {
      const v = lfoValue(l, t, 120)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('bpmSync derives the period from bpm and beats', () => {
    const l = lfo({ bpmSync: true, beats: 2 })
    expect(lfoValue(l, 0.25, 120)).toBeCloseTo(1)
    expect(lfoValue(l, 1, 60)).toBeCloseTo(0)
    expect(lfoValue(l, 0.5, 60)).toBeCloseTo(1)
  })

  it('rate derives the period when not bpm synced', () => {
    expect(lfoValue(lfo({ rate: 2 }), 0.125, 120)).toBeCloseTo(1)
  })
})

describe('envValue', () => {
  it('is 0 before the trigger', () => {
    expect(envValue(env(), -0.1)).toBe(0)
  })

  it('ramps 0 to 1 during attack', () => {
    expect(envValue(env(), 0.5)).toBeCloseTo(0.5)
    expect(envValue(env(), 1)).toBeCloseTo(1)
  })

  it('decays from 1 down to sustain', () => {
    expect(envValue(env(), 1.5)).toBeCloseTo(0.75)
    expect(envValue(env(), 2)).toBeCloseTo(0.5)
    expect(envValue(env(), 5)).toBeCloseTo(0.5)
  })

  it('skips attack when attack is 0', () => {
    expect(envValue(env({ attack: 0 }), 0)).toBeCloseTo(1)
    expect(envValue(env({ attack: 0 }), 0.5)).toBeCloseTo(0.75)
  })
})

describe('envOneShot', () => {
  it('is 0 before the trigger', () => {
    expect(envOneShot(env(), -1, 1)).toBe(0)
  })

  it('follows the ADSR level during the hold window', () => {
    expect(envOneShot(env(), 0.5, 1)).toBeCloseTo(0.5)
    expect(envOneShot(env(), 1, 1)).toBeCloseTo(1)
  })

  it('decays to 0 by release end', () => {
    expect(envOneShot(env(), 1.5, 1)).toBeCloseTo(0.375)
    expect(envOneShot(env(), 2, 1)).toBeCloseTo(0)
    expect(envOneShot(env(), 5, 1)).toBeCloseTo(0)
  })
})

describe('applyEnv', () => {
  it('leaves the base unchanged at amount 0', () => {
    expect(applyEnv(2, env({ amount: 0 }), 0.3)).toBe(2)
  })

  it('multiplies base by level at amount 1', () => {
    expect(applyEnv(2, env({ amount: 1 }), 0.6)).toBeCloseTo(1.2)
  })

  it('blends between base and scaled base', () => {
    expect(applyEnv(2, env({ amount: 0.5 }), 0)).toBeCloseTo(1)
    expect(applyEnv(2, env({ amount: 0.5 }), 1)).toBeCloseTo(2)
  })
})

describe('applyLfo', () => {
  it('add mode adds the scaled lfo value', () => {
    expect(applyLfo(2, lfo({ mode: 'add', amount: 0.5 }), 0.4)).toBeCloseTo(2.2)
  })

  it('mul mode multiplies by the scaled deviation', () => {
    expect(applyLfo(2, lfo({ mode: 'mul', amount: 0.5 }), 0.4)).toBeCloseTo(2.4)
  })

  it('replace mode substitutes a centered value', () => {
    expect(applyLfo(2, lfo({ mode: 'replace', amount: 0.5 }), 0.4)).toBeCloseTo(0.35)
    expect(applyLfo(2, lfo({ mode: 'replace', amount: 0.5 }), -1)).toBeCloseTo(0)
  })
})

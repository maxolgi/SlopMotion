import { describe, expect, it } from 'vitest'
import { normalizeProject } from './normalize'
import { demoProject } from './presets'
import { TRACK_COLORS, defaultEnv, defaultLfo } from './types'

describe('normalizeProject', () => {
  it('returns null for invalid input', () => {
    expect(normalizeProject(null)).toBeNull()
    expect(normalizeProject('x')).toBeNull()
    expect(normalizeProject(5)).toBeNull()
    expect(normalizeProject({})).toBeNull()
    expect(normalizeProject({ tracks: 'x' })).toBeNull()
  })

  it('builds a fully defaulted project from empty tracks', () => {
    const p = normalizeProject({ tracks: [] })
    expect(p).not.toBeNull()
    expect(p!.version).toBe(1)
    expect(p!.name).toBe('Untitled')
    expect(p!.fps).toBe(30)
    expect(p!.bpm).toBe(120)
    expect(p!.duration).toBe(16)
    expect(p!.tracks).toEqual([])
    expect(p!.clips).toEqual([])
    expect(p!.knobs).toEqual([])
    expect(p!.xy).toEqual({ addrX: '/ch/14', addrY: '/ch/15' })
    expect(p!.osc).toEqual({ host: '127.0.0.1', port: 8101, rate: 30, armed: true, live: false, bundle: false })
  })

  it('repairs a corrupted track and fills defaults', () => {
    const p = normalizeProject({
      tracks: [
        {
          keys: [
            { t: -1, v: 0.5 },
            { t: 'x' },
            { t: 1, v: 2, id: 'dupe' },
            { t: 1, v: 3, id: 'dupe' },
          ],
        },
      ],
    })
    expect(p).not.toBeNull()
    expect(p!.version).toBe(1)
    expect(p!.clips).toEqual([])
    expect(p!.knobs).toEqual([])
    const tr = p!.tracks[0]
    expect(typeof tr.id).toBe('string')
    expect(tr.id.length).toBeGreaterThan(0)
    expect(tr.name).toBe('Track 1')
    expect(tr.color).toBe(TRACK_COLORS[0])
    expect(tr.muted).toBe(false)
    expect(tr.send).toBe(true)
    expect(tr.target).toEqual({ kind: 'ch', n: 1 })
    expect(tr.min).toBe(0)
    expect(tr.max).toBe(1)
    expect(tr.lfo).toEqual(defaultLfo())
    expect(tr.env).toEqual(defaultEnv())
    expect(tr.keys).toHaveLength(3)
    expect(tr.keys.map((k) => k.t)).toEqual([0, 1, 1])
    expect(tr.keys.map((k) => k.v)).toEqual([0.5, 2, 3])
    expect(tr.keys.every((k) => k.interp === 'bezier')).toBe(true)
    expect(tr.keys.every((k) => k.hi === null && k.ho === null)).toBe(true)
    expect(tr.keys.every((k) => k.broken === false)).toBe(true)
    expect(tr.keys[1].id).toBe('dupe')
    expect(tr.keys[0].id).not.toBe('dupe')
    expect(tr.keys[2].id).not.toBe('dupe')
    expect(new Set(tr.keys.map((k) => k.id)).size).toBe(3)
  })

  it('clamps osc rate and port', () => {
    const hi = normalizeProject({ tracks: [], osc: { rate: 500, port: 70000 } })!.osc
    expect(hi.rate).toBe(120)
    expect(hi.port).toBe(65535)
    const lo = normalizeProject({ tracks: [], osc: { rate: 1, port: 0 } })!.osc
    expect(lo.rate).toBe(10)
    expect(lo.port).toBe(1)
    const bad = normalizeProject({ tracks: [], osc: { rate: 'x', port: 'y' } })!.osc
    expect(bad.rate).toBe(30)
    expect(bad.port).toBe(8101)
  })

  it('falls back to duration 16 when below 1', () => {
    expect(normalizeProject({ tracks: [], duration: 0 })!.duration).toBe(16)
  })

  it('round-trips demoProject unchanged', () => {
    const demo = demoProject()
    expect(normalizeProject(demo)).toEqual(demo)
  })
})

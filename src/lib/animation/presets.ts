import type { Clip, Handle, Interp, Keyframe, Project, Track } from './types'
import { TRACK_COLORS, defaultEnv, defaultLfo } from './types'

// ─── Keyframe factory ─────────────────────────────────────────────────────────

let kc = 0
export function k(t: number, v: number, interp: Interp = 'bezier', ho?: Partial<Handle>, hi?: Partial<Handle>): Keyframe {
  kc += 1
  return {
    id: `k${kc}_${Math.random().toString(36).slice(2, 7)}`,
    t,
    v,
    interp,
    hi: interp === 'bezier' ? ({ dt: -0.3, dv: 0, ...hi } as Handle) : null,
    ho: interp === 'bezier' ? ({ dt: 0.3, dv: 0, ...ho } as Handle) : null,
    broken: false,
  }
}

export function mkTrack(
  id: string,
  name: string,
  ch: number,
  keys: Keyframe[],
  opts: Partial<Track> = {}
): Track {
  return {
    id,
    name,
    muted: false,
    send: true,
    target: { kind: 'ch', n: ch },
    min: 0,
    max: 1,
    keys,
    lfo: defaultLfo(),
    env: defaultEnv(),
    ...opts,
    color: (opts.color as string) ?? TRACK_COLORS[(ch - 1) % TRACK_COLORS.length],
  }
}

// ─── Demo project (SlopShady default mapping) ─────────────────────────────────

export function demoProject(): Project {
  return {
    version: 1,
    name: 'SlopShady Demo',
    fps: 30,
    bpm: 120,
    duration: 16,
    tracks: [
      mkTrack('tr_opacity', 'Layer 1 · Opacity', 1, [
        k(0, 0, 'bezier', { dt: 0.8, dv: 0 }, { dt: -0.01, dv: 0 }),
        k(2.5, 1, 'bezier', { dt: 0.4, dv: -0.15 }, { dt: -0.8, dv: 0.05 }),
        k(7, 0.85, 'bezier'),
        k(9, 0.25, 'bezier', { dt: 0.5, dv: -0.2 }, { dt: -0.4, dv: 0.1 }),
        k(12, 1, 'bezier'),
        k(16, 1, 'bezier'),
      ], { env: { ...defaultEnv(), amount: 0.9 } }),
      mkTrack('tr_bright', 'Layer 1 · Brightness', 2, [
        k(0, 0.6, 'auto'),
        k(4, 0.8, 'auto'),
        k(8, 0.5, 'auto'),
        k(12, 0.9, 'auto'),
        k(16, 0.6, 'auto'),
      ], {
        lfo: { ...defaultLfo(), enabled: true, wave: 'sine', rate: 0.5, amount: 0.15 },
      }),
      mkTrack('tr_speed', 'Layer 1 · Speed', 3, [
        k(0, 0.2, 'bezier'),
        k(8, 0.55, 'bezier', { dt: 0.7, dv: 0.1 }, { dt: -0.7, dv: -0.1 }),
        k(16, 0.35, 'bezier'),
      ]),
      mkTrack('tr_posx', 'Layer 1 · Pos X', 4, [
        k(0, 0.3, 'auto'),
        k(4, 0.7, 'auto'),
        k(8, 0.3, 'auto'),
        k(12, 0.7, 'auto'),
        k(16, 0.3, 'auto'),
      ]),
      mkTrack('tr_posy', 'Layer 1 · Pos Y', 5, [
        k(0, 0.7, 'auto'),
        k(4, 0.5, 'auto'),
        k(8, 0.2, 'auto'),
        k(12, 0.5, 'auto'),
        k(16, 0.7, 'auto'),
      ]),
      mkTrack('tr_scale', 'Layer 1 · Scale', 6, [
        k(0, 0.4, 'bezier'),
        k(3, 1, 'bezier', { dt: 0.55, dv: -0.35 }, { dt: -0.25, dv: 0 }),
        k(5.5, 0.8, 'bezier', { dt: 0.4, dv: 0.05 }, { dt: -0.45, dv: 0.15 }),
        k(8, 0.4, 'bezier'),
        k(11, 1, 'bezier', { dt: 0.55, dv: -0.3 }, { dt: -0.25, dv: 0 }),
        k(13.5, 0.8, 'bezier'),
        k(16, 0.4, 'bezier'),
      ]),
      mkTrack('tr_rot', 'Layer 1 · Rotation', 7, [
        k(0, 0, 'linear'),
        k(16, 1, 'linear'),
      ], { min: -1, max: 1 }),
      mkTrack('tr_cd0', 'Code Dial cd0', 8, [
        k(0, 0, 'stepped'),
        k(2, 0.3, 'stepped'),
        k(4, 0.3, 'stepped'),
        k(5, 0.8, 'stepped'),
        k(8, 0.1, 'stepped'),
        k(10, 0.6, 'stepped'),
        k(13, 0.9, 'stepped'),
        k(16, 0, 'stepped'),
      ]),
    ],
    clips: [
      {
        id: 'clip_go',
        name: 'GO!',
        color: '#22d3ee',
        actions: [
          { type: 'seek', time: 0 },
          { type: 'trigger', trackId: 'tr_opacity' },
        ],
      },
      {
        id: 'clip_mid',
        name: 'Mid',
        color: '#34d399',
        actions: [{ type: 'seek', time: 8 }],
      },
      {
        id: 'clip_blast',
        name: 'Blast',
        color: '#e879f9',
        actions: [
          { type: 'flash', trackId: 'tr_bright', value: 1, ramp: 0.05, hold: 0.3 },
          { type: 'note', ch: 0, note: 60, vel: 110, durMs: 300 },
        ],
      },
      {
        id: 'clip_strobe',
        name: 'Strobe X',
        color: '#fbbf24',
        actions: [{ type: 'flash', trackId: 'tr_posx', value: 1, ramp: 0.03, hold: 0.12 }],
      },
      {
        id: 'clip_dark',
        name: 'Dark',
        color: '#a78bfa',
        actions: [{ type: 'flash', trackId: 'tr_opacity', value: 0, ramp: 0.15, hold: 0.5 }],
      },
      {
        id: 'clip_dial',
        name: 'Dial Max',
        color: '#fb7185',
        actions: [{ type: 'flash', trackId: 'tr_cd0', value: 1, ramp: 0.02, hold: 0.2 }],
      },
      {
        id: 'clip_note_a',
        name: 'Note A4',
        color: '#a3e635',
        actions: [{ type: 'note', ch: 0, note: 69, vel: 100, durMs: 500 }],
      },
      {
        id: 'clip_note_c',
        name: 'Note C5',
        color: '#fb923c',
        actions: [{ type: 'note', ch: 0, note: 72, vel: 100, durMs: 500 }],
      },
    ],
    knobs: [
      { id: 'kn1', label: 'cd1', address: '/ch/9', min: 0, max: 1, value: 0.5, reset: 0.5 },
      { id: 'kn2', label: 'cd2', address: '/ch/10', min: 0, max: 1, value: 0.5, reset: 0.5 },
      { id: 'kn3', label: 'cd3', address: '/ch/11', min: 0, max: 1, value: 0.3, reset: 0.3 },
      { id: 'kn4', label: 'cd4', address: '/ch/12', min: 0, max: 1, value: 0.4, reset: 0.4 },
      { id: 'kn5', label: 'Feedback', address: '/ch/13', min: 0, max: 1, value: 0.2, reset: 0.2 },
      { id: 'kn6', label: 'Spread', address: '/ch/16', min: 0, max: 1, value: 0.5, reset: 0.5 },
    ],
    xy: { addrX: '/ch/14', addrY: '/ch/15' },
    osc: {
      host: '127.0.0.1',
      port: 8101,
      rate: 30,
      armed: true,
      live: false,
      bundle: false,
    },
  }
}

import { createStore, reconcile, unwrap } from 'solid-js/store'
import type { Keyframe, Project, Selection, Track } from '@/lib/animation/types'
import { uid } from '@/lib/animation/types'
import { applyEase, bakeHandles, evalCurve, sortKeys, EASE_PRESETS } from '@/lib/animation/curve'
import { demoProject } from '@/lib/animation/presets'
import { engine } from '@/lib/animation/engine'

const STORAGE_KEY = 'slopmotion.project.v1'

export interface AnimatorState {
  project: Project
  selection: Selection
  past: Project[]
  future: Project[]
  snap: boolean
  clipboard: Record<string, Keyframe[]> | null
  // hydration
  hydrated: boolean
}

function emptySelection(): Selection {
  return { trackIds: [], keyIds: {} }
}

/** unwrap first — Solid store proxies are not structuredClone-able */
function clone<T>(v: T): T {
  return typeof structuredClone === 'function'
    ? (structuredClone(unwrap(v as { [key: string]: any })) as T)
    : (JSON.parse(JSON.stringify(v)) as T)
}

const [store, setState] = createStore<AnimatorState>({
  project: demoProject(),
  selection: emptySelection(),
  past: [],
  future: [],
  snap: true,
  clipboard: null,
  hydrated: false,
})

export { store }

/** imperative snapshot read — safe outside reactive contexts */
export const getState = (): AnimatorState => store

const hydrate = () => {
  if (store.hydrated) return
  setState('hydrated', true)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Project
      if (p && Array.isArray(p.tracks)) setState('project', reconcile(p, { merge: true }))
    }
  } catch {
    /* corrupted storage → keep demo */
  }
}

const persist = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.project))
  } catch {
    /* quota — ignore */
  }
}

const commit = () => {
  const raw = unwrap(store)
  setState({ past: [...raw.past.slice(-99), clone(raw.project)], future: [] })
}

const undo = () => {
  const raw = unwrap(store)
  const { past, future, project } = raw
  if (past.length === 0) return
  const prev = past[past.length - 1]
  const snapshot = clone(project)
  setState('project', reconcile(prev, { merge: true }))
  setState({
    past: past.slice(0, -1),
    future: [snapshot, ...future.slice(0, 99)],
  })
  persist()
}

const redo = () => {
  const raw = unwrap(store)
  const { past, future, project } = raw
  if (future.length === 0) return
  const next = future[0]
  const snapshot = clone(project)
  setState('project', reconcile(next, { merge: true }))
  setState({
    past: [...past, snapshot],
    future: future.slice(1),
  })
  persist()
}

const mutate = (recipe: (p: Project) => void, undoable = true) => {
  if (undoable) commit()
  const p = clone(store.project)
  recipe(p)
  setState('project', reconcile(p, { merge: true }))
  persist()
}

const setProjectProp = (patch: Partial<Pick<Project, 'name' | 'fps' | 'bpm' | 'duration'>>) =>
  mutate((p) => Object.assign(p, patch))

const loadProject = (p: Project) => {
  commit()
  setState({ project: p, selection: emptySelection() })
  persist()
}

const resetDemo = () => {
  commit()
  setState({ project: demoProject(), selection: emptySelection() })
  persist()
}

const addTrack = () =>
  mutate((p) => {
    const n = p.tracks.length + 1
    const usedCh = new Set(
      p.tracks.filter((t) => t.target.kind === 'ch').map((t) => (t.target as { n: number }).n)
    )
    let chn = n
    while (usedCh.has(chn)) chn++
    p.tracks.push({
      id: uid('tr'),
      name: `Track ${n}`,
      color: ['#22d3ee', '#e879f9', '#fbbf24', '#34d399', '#a78bfa', '#fb7185', '#a3e635', '#fb923c'][(n - 1) % 8],
      muted: false,
      send: true,
      target: { kind: 'ch', n: chn },
      min: 0,
      max: 1,
      keys: [
        { id: uid('k'), t: 0, v: 0.5, interp: 'bezier', hi: { dt: -0.3, dv: 0 }, ho: { dt: 0.3, dv: 0 }, broken: false },
        { id: uid('k'), t: 4, v: 0.5, interp: 'bezier', hi: { dt: -0.3, dv: 0 }, ho: { dt: 0.3, dv: 0 }, broken: false },
      ],
      lfo: { enabled: false, wave: 'sine', rate: 0.5, bpmSync: false, beats: 2, phase: 0, amount: 0.2, mode: 'add' },
      env: { enabled: false, attack: 0.05, decay: 0.4, sustain: 0.6, hold: 0.2, release: 0.8, amount: 0.8 },
    })
  })

const removeTrack = (id: string) => {
  mutate((p) => {
    p.tracks = p.tracks.filter((t) => t.id !== id)
    for (const c of p.clips) {
      c.actions = c.actions.filter((a) => !('trackId' in a) || a.trackId !== id)
    }
  })
  setState('selection', emptySelection())
}

const duplicateTrack = (id: string) =>
  mutate((p) => {
    const src = p.tracks.find((t) => t.id === id)
    if (!src) return
    const copy = clone(src)
    copy.id = uid('tr')
    copy.name = `${src.name} copy`
    if (copy.target.kind === 'ch') copy.target.n = Math.min(64, copy.target.n + 1)
    copy.keys = copy.keys.map((kk) => ({ ...kk, id: uid('k') }))
    p.tracks.push(copy)
  })

const setTrackProp = (id: string, patch: Partial<Omit<Track, 'keys' | 'lfo' | 'env'>>) =>
  mutate((p) => {
    const t = p.tracks.find((tr) => tr.id === id)
    if (t) Object.assign(t, patch)
  })

const setTrackLfo = (id: string, patch: Partial<Track['lfo']>) =>
  mutate(
    (p) => {
      const t = p.tracks.find((tr) => tr.id === id)
      if (t) Object.assign(t.lfo, patch)
    },
    false
  )

const setTrackEnv = (id: string, patch: Partial<Track['env']>) =>
  mutate(
    (p) => {
      const t = p.tracks.find((tr) => tr.id === id)
      if (t) Object.assign(t.env, patch)
    },
    false
  )

const setKeys = (trackId: string, keys: Keyframe[]) =>
  mutate((p) => {
    const t = p.tracks.find((tr) => tr.id === trackId)
    if (t) t.keys = sortKeys(keys)
  })

/** non-undoable, persist-free key update used during drags */
const setKeysLive = (trackId: string, keys: Keyframe[]) =>
  setState('project', 'tracks', (t) => t.id === trackId, 'keys', sortKeys(keys))

const persistNow = () => persist()

const addKeyAtTime = (trackId: string, t: number, v?: number) =>
  mutate((p) => {
    const tr = p.tracks.find((x) => x.id === trackId)
    if (!tr) return
    const existing = tr.keys.find((kk) => Math.abs(kk.t - t) < 1e-4)
    if (existing) {
      existing.v = v ?? evalCurve(tr.keys, t)
      return
    }
    const value = v ?? evalCurve(tr.keys, t)
    tr.keys.push({
      id: uid('k'),
      t,
      v: value,
      interp: 'bezier',
      hi: { dt: -0.3, dv: 0 },
      ho: { dt: 0.3, dv: 0 },
      broken: false,
    })
    tr.keys = sortKeys(tr.keys)
  })

const deleteSelectedKeys = () => {
  const sel = store.selection
  mutate((p) => {
    for (const tr of p.tracks) {
      const ids = sel.keyIds[tr.id]
      if (ids && ids.length) tr.keys = tr.keys.filter((kk) => !ids.includes(kk.id))
    }
  })
  setState('selection', { trackIds: [...store.selection.trackIds], keyIds: {} })
}

const setSelection = (sel: Selection) => setState('selection', sel)

const selectTrack = (id: string, additive?: boolean) => {
  const cur = store.selection.trackIds
  const trackIds = additive
    ? cur.includes(id)
      ? cur.filter((x) => x !== id)
      : [...cur, id]
    : [id]
  setState('selection', { trackIds, keyIds: {} })
}

const selectKeys = (trackId: string, keyIds: string[], additive?: boolean) => {
  const sel = store.selection
  // plain copies so no proxies are re-inserted into the store
  const nextKeyIds: Record<string, string[]> = {}
  for (const tid in sel.keyIds) nextKeyIds[tid] = [...sel.keyIds[tid]]
  const trackIds = sel.trackIds.includes(trackId) ? [...sel.trackIds] : [...sel.trackIds, trackId]
  const prev = additive ? nextKeyIds[trackId] ?? [] : []
  const merged = additive
    ? keyIds.filter((x) => !prev.includes(x)).concat(prev.filter((x) => !keyIds.includes(x)))
    : keyIds
  nextKeyIds[trackId] = merged
  setState('selection', { trackIds, keyIds: nextKeyIds })
}

const clearSelection = () => setState('selection', emptySelection())

const setSelectedInterp = (interp: Keyframe['interp']) => {
  const sel = store.selection
  mutate((p) => {
    for (const tr of p.tracks) {
      const ids = sel.keyIds[tr.id]
      if (!ids || ids.length === 0) continue
      tr.keys = tr.keys.map((kk) => {
        if (!ids.includes(kk.id)) return kk
        if (interp === 'bezier') {
          if (kk.interp === 'auto') {
            const baked = bakeHandles(tr.keys, kk.id).find((x) => x.id === kk.id)
            if (baked) return { ...baked, interp: 'bezier' }
          }
          return {
            ...kk,
            interp,
            hi: kk.hi ?? { dt: -0.3, dv: 0 },
            ho: kk.ho ?? { dt: 0.3, dv: 0 },
          }
        }
        return { ...kk, interp, hi: null, ho: null } // auto / linear / stepped drop handles
      })
    }
  })
}

const applyEaseToSelection = (presetId: string) => {
  const preset = EASE_PRESETS.find((e) => e.id === presetId)
  if (!preset) return
  const sel = store.selection
  mutate((p) => {
    for (const tr of p.tracks) {
      const ids = sel.keyIds[tr.id]
      if (!ids || ids.length === 0) continue
      const sorted = sortKeys(tr.keys)
      if (ids.length === 1) {
        const idx = sorted.findIndex((kk) => ids.includes(kk.id))
        if (idx >= 0 && idx < sorted.length - 1) {
          tr.keys = applyEase(tr.keys, sorted[idx].id, sorted[idx + 1].id, preset)
        }
      } else {
        for (let i = 0; i < sorted.length - 1; i++) {
          if (ids.includes(sorted[i].id) && ids.includes(sorted[i + 1].id)) {
            tr.keys = applyEase(tr.keys, sorted[i].id, sorted[i + 1].id, preset)
          }
        }
      }
    }
  })
}

const flattenSelected = () => {
  const sel = store.selection
  mutate((p) => {
    for (const tr of p.tracks) {
      const ids = sel.keyIds[tr.id]
      if (!ids || ids.length === 0) continue
      tr.keys = tr.keys.map((kk) =>
        ids.includes(kk.id)
          ? {
              ...kk,
              interp: 'bezier' as const,
              hi: kk.hi ? { ...kk.hi, dv: 0 } : { dt: -0.3, dv: 0 },
              ho: kk.ho ? { ...kk.ho, dv: 0 } : { dt: 0.3, dv: 0 },
            }
          : kk
      )
    }
  })
}

const toggleBreakSelected = () => {
  const sel = store.selection
  mutate((p) => {
    for (const tr of p.tracks) {
      const ids = sel.keyIds[tr.id]
      if (!ids || ids.length === 0) continue
      tr.keys = tr.keys.map((kk) => {
        if (!ids.includes(kk.id)) return kk
        if (kk.interp !== 'bezier') {
          const baked = bakeHandles(tr.keys, kk.id).find((x) => x.id === kk.id)
          if (baked) return { ...baked, broken: true }
        }
        return { ...kk, broken: !kk.broken }
      })
    }
  })
}

const copySelection = () => {
  const { selection, project } = store
  const out: Record<string, Keyframe[]> = {}
  for (const tr of project.tracks) {
    const ids = selection.keyIds[tr.id]
    if (ids && ids.length) {
      out[tr.id] = tr.keys.filter((kk) => ids.includes(kk.id)).map((kk) => clone(kk))
    }
  }
  setState('clipboard', Object.keys(out).length ? out : null)
}

const pasteAtPlayhead = () => {
  const clip = store.clipboard
  if (!clip) return
  const t = engine.time
  const all = Object.entries(clip)
  if (all.length === 0) return
  const minT = Math.min(...all.flatMap(([, ks]) => ks.map((kk) => kk.t)))
  mutate((p) => {
    for (const [tid, ks] of all) {
      const tr = p.tracks.find((x) => x.id === tid)
      if (!tr) continue
      for (const kk of ks) {
        const nt = t + (kk.t - minT)
        tr.keys = tr.keys.filter((old) => Math.abs(old.t - nt) > 1e-4)
        tr.keys.push({ ...clone(kk), id: uid('k'), t: nt })
      }
      tr.keys = sortKeys(tr.keys)
    }
  })
}

const setSnap = (b: boolean) => setState('snap', b)

const updateClip = (id: string, patch: Partial<Project['clips'][number]>) =>
  mutate(
    (p) => {
      const c = p.clips.find((x) => x.id === id)
      if (c) Object.assign(c, patch)
    },
    false
  )

const setKnobProp = (id: string, patch: Partial<Project['knobs'][number]>) =>
  // knob drags are continuous → non-undoable
  setState('project', 'knobs', (kn) => kn.id === id, patch)

const setXy = (patch: Partial<Project['xy']>) => setState('project', 'xy', patch)

const setOsc = (patch: Partial<Project['osc']>) => setState('project', 'osc', patch)

export const actions = {
  hydrate,
  persist,
  commit,
  undo,
  redo,
  mutate,
  setProjectProp,
  loadProject,
  resetDemo,
  addTrack,
  removeTrack,
  duplicateTrack,
  setTrackProp,
  setTrackLfo,
  setTrackEnv,
  setKeys,
  setKeysLive,
  persistNow,
  addKeyAtTime,
  deleteSelectedKeys,
  setSelection,
  selectTrack,
  selectKeys,
  clearSelection,
  setSelectedInterp,
  applyEaseToSelection,
  flattenSelected,
  toggleBreakSelected,
  copySelection,
  pasteAtPlayhead,
  setSnap,
  updateClip,
  setKnobProp,
  setXy,
  setOsc,
}

// engine ↔ store bridge
if (typeof window !== 'undefined') {
  engine.setAccessor(() => ({ project: store.project }))
}

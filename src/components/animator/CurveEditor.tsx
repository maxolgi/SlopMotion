import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { actions, getState, store } from '@/store/useAnimator'
import { engine } from '@/lib/animation/engine'
import { autoHandles, evalCurve, sortKeys } from '@/lib/animation/curve'
import { EASE_PRESETS } from '@/lib/animation/curve'
import type { Handle, Keyframe, Track } from '@/lib/animation/types'

// ─── Curve / Graph Editor ─────────────────────────────────────────────────────

const RULER_H = 26
const GUTTER_L = 48
const GUTTER_R = 14
const PAD_BOTTOM = 6

interface View {
  x0: number // time at left edge
  pxPerSec: number
  yCenter: number // value at vertical center
  pxPerVal: number
}

type DragMode =
  | { kind: 'none' }
  | { kind: 'pan'; sx: number; sy: number; view: View }
  | { kind: 'scrub' }
  | {
      kind: 'keys'
      sx: number
      sy: number
      snapshot: Record<string, Keyframe[]> // pre-drag keys per track
    }
  | {
      kind: 'handle'
      trackId: string
      keyId: string
      side: 'in' | 'out'
      sx: number
      sy: number
      startKeys: Keyframe[] // immutable pre-drag snapshot
      startDt: number // dragged handle's dt at drag start
      startDv: number // dragged handle's dv at drag start
    }
  | { kind: 'box'; sx: number; sy: number; additive: boolean }

interface Hover {
  type: 'key' | 'handle' | 'ruler' | 'empty' | 'playhead'
  track?: Track
  key?: Keyframe
  side?: 'in' | 'out'
}

interface MenuState {
  x: number
  y: number
  open: boolean
}

const TIME_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120]
const VAL_STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10]

function niceStep(steps: number[], targetPx: number, pxPerUnit: number): number {
  for (const s of steps) if (s * pxPerUnit >= targetPx) return s
  return steps[steps.length - 1]
}

export default function CurveEditor() {
  let canvas!: HTMLCanvasElement
  let wrap!: HTMLDivElement
  let view: View = { x0: -0.4, pxPerSec: 84, yCenter: 0.5, pxPerVal: 240 }
  let drag: DragMode = { kind: 'none' }
  let hover: Hover = { type: 'empty' }
  let space = false
  let ghost: Record<string, Keyframe[]> | null = null
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null
  let size = { w: 800, h: 400 }
  const [menu, setMenu] = createSignal<MenuState>({ x: 0, y: 0, open: false })
  const [tip, setTip] = createSignal<{ x: number; y: number; text: string } | null>(null)

  // coordinate helpers ------------------------------------------------------
  const t2x = (t: number, w: number) => GUTTER_L + (t - view.x0) * view.pxPerSec
  const x2t = (x: number) => view.x0 + (x - GUTTER_L) / view.pxPerSec
  const v2y = (v: number, h: number) =>
    h - PAD_BOTTOM - (v - view.yCenter) * view.pxPerVal - (h - RULER_H - PAD_BOTTOM) / 2 + RULER_H
  const y2v = (y: number, h: number) =>
    view.yCenter + ((h - PAD_BOTTOM - y + RULER_H) - (h - RULER_H - PAD_BOTTOM) / 2) / view.pxPerVal

  // main draw loop ----------------------------------------------------------
  const draw = () => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { project, selection, snap } = getState()
    const { w: cssW, h: cssH } = size
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr
      canvas.height = cssH * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const W = cssW
    const H = cssH

    // background
    ctx.fillStyle = '#0e0e15'
    ctx.fillRect(0, 0, W, H)

    const plotR = W - GUTTER_R
    const tL = view.x0
    const tR = x2t(plotR)

    // clip plot region
    ctx.save()
    ctx.beginPath()
    ctx.rect(GUTTER_L, RULER_H, plotR - GUTTER_L, H - RULER_H - PAD_BOTTOM)
    ctx.clip()

    // grid
    const tStep = niceStep(TIME_STEPS, 72, view.pxPerSec)
    const vStep = niceStep(VAL_STEPS, 44, view.pxPerVal)
    const vTop = y2v(RULER_H, H)
    const vBot = y2v(H - PAD_BOTTOM, H)
    // minor vertical (time)
    ctx.strokeStyle = 'rgba(255,255,255,0.035)'
    ctx.lineWidth = 1
    ctx.beginPath()
    const tMinor = tStep / 5
    for (let t = Math.ceil(tL / tMinor) * tMinor; t <= tR; t += tMinor) {
      const x = Math.round(t2x(t, W)) + 0.5
      ctx.moveTo(x, RULER_H)
      ctx.lineTo(x, H - PAD_BOTTOM)
    }
    ctx.stroke()
    // major vertical
    ctx.strokeStyle = 'rgba(255,255,255,0.09)'
    ctx.beginPath()
    for (let t = Math.ceil(tL / tStep) * tStep; t <= tR; t += tStep) {
      const x = Math.round(t2x(t, W)) + 0.5
      ctx.moveTo(x, RULER_H)
      ctx.lineTo(x, H - PAD_BOTTOM)
    }
    ctx.stroke()
    // horizontal value lines
    ctx.beginPath()
    for (let v = Math.ceil(vBot / vStep) * vStep; v <= vTop; v += vStep) {
      const y = Math.round(v2y(v, H)) + 0.5
      ctx.moveTo(GUTTER_L, y)
      ctx.lineTo(plotR, y)
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.055)'
    ctx.stroke()
    // 0 and 1 emphasized
    ctx.beginPath()
    for (const v of [0, 1]) {
      const y = Math.round(v2y(v, H)) + 0.5
      if (y > RULER_H && y < H - PAD_BOTTOM) {
        ctx.moveTo(GUTTER_L, y)
        ctx.lineTo(plotR, y)
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'
    ctx.stroke()

    // duration boundary + shade beyond
    const durT2x = t2x(project.duration, W)
    if (project.duration > 0 && durT2x < plotR) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(durT2x, RULER_H, plotR - durT2x, H - RULER_H - PAD_BOTTOM)
      ctx.strokeStyle = 'rgba(232,121,249,0.35)'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(Math.round(durT2x) + 0.5, RULER_H)
      ctx.lineTo(Math.round(durT2x) + 0.5, H - PAD_BOTTOM)
      ctx.stroke()
      ctx.setLineDash([])
    }

    const now = performance.now() / 1000
    const playT = engine.time

    // ghost curves (pre-drag snapshot)
    if (ghost) {
      for (const tr of project.tracks) {
        const gk = ghost[tr.id]
        if (!gk) continue
        ctx.strokeStyle = tr.color
        ctx.globalAlpha = 0.2
        ctx.lineWidth = 1.25
        ctx.beginPath()
        let started = false
        for (let x = GUTTER_L; x <= plotR; x += 2) {
          const v = evalCurve(gk, x2t(x))
          const y = v2y(v, H)
          if (!started) {
            ctx.moveTo(x, y)
            started = true
          } else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }

    // curves
    const drawCurve = (tr: Track, keys: Keyframe[], style: 'solid' | 'final') => {
      ctx.beginPath()
      let started = false
      for (let x = GUTTER_L; x <= plotR; x += 2) {
        const t = x2t(x)
        let v: number
        if (style === 'solid') v = evalCurve(keys, t)
        else v = engine.evalTrack(tr, t, now).final
        const y = v2y(v, H)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else ctx.lineTo(x, y)
      }
      if (style === 'solid') {
        ctx.strokeStyle = tr.color
        ctx.lineWidth = selected.has(tr.id) ? 2.4 : 1.4
        ctx.globalAlpha = selected.has(tr.id) ? 1 : 0.42
        if (selected.has(tr.id)) {
          ctx.shadowColor = tr.color
          ctx.shadowBlur = 7
        }
        ctx.stroke()
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'
        ctx.lineWidth = 1
        ctx.setLineDash([5, 4])
        ctx.globalAlpha = 0.5
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }
    }

    const selected = new Set(selection.trackIds)
    for (const tr of project.tracks) if (!selected.has(tr.id)) drawCurve(tr, tr.keys, 'solid')
    for (const tr of project.tracks) {
      if (!selected.has(tr.id)) continue
      drawCurve(tr, tr.keys, 'solid')
      const modulated = tr.lfo.enabled || tr.env.enabled
      if (modulated) drawCurve(tr, tr.keys, 'final')
    }

    // keys + handles
    for (const tr of project.tracks) {
      const isSelTrack = selected.has(tr.id)
      const selIds = selection.keyIds[tr.id] ?? []
      // handles first (under keys)
      if (isSelTrack && selIds.length > 0) {
        for (const kk of tr.keys) {
          if (!selIds.includes(kk.id)) continue
          let hi = kk.hi
          let ho = kk.ho
          if (kk.interp === 'auto') {
            const a = autoHandles(tr.keys[tr.keys.indexOf(kk) - 1], kk, tr.keys[tr.keys.indexOf(kk) + 1])
            hi = a.hi
            ho = a.ho
          }
          const kx = t2x(kk.t, W)
          const ky = v2y(kk.v, H)
          ctx.strokeStyle = tr.color
          ctx.globalAlpha = 0.55
          ctx.lineWidth = 1
          if (hi) {
            ctx.beginPath()
            ctx.moveTo(kx, ky)
            ctx.lineTo(kx + hi.dt * view.pxPerSec, ky - hi.dv * view.pxPerVal)
            ctx.stroke()
          }
          if (ho) {
            ctx.beginPath()
            ctx.moveTo(kx, ky)
            ctx.lineTo(kx + ho.dt * view.pxPerSec, ky - ho.dv * view.pxPerVal)
            ctx.stroke()
          }
          ctx.globalAlpha = 1
          ctx.fillStyle = tr.color
          for (const h of [hi, ho]) {
            if (!h) continue
            const hx = kx + h.dt * view.pxPerSec
            const hy = ky - h.dv * view.pxPerVal
            ctx.beginPath()
            ctx.arc(hx, hy, 3.4, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = 'rgba(0,0,0,0.5)'
            ctx.stroke()
          }
        }
      }
      // key glyphs
      for (const kk of tr.keys) {
        const kx = t2x(kk.t, W)
        if (kx < GUTTER_L - 8 || kx > plotR + 8) continue
        const ky = v2y(kk.v, H)
        const isSel = selIds.includes(kk.id)
        const r = isSelTrack ? (isSel ? 5.2 : 4.2) : 3.4
        ctx.save()
        ctx.translate(kx, ky)
        const fill = isSel ? '#ffffff' : tr.color
        ctx.fillStyle = fill
        ctx.strokeStyle = isSel ? tr.color : 'rgba(0,0,0,0.55)'
        ctx.lineWidth = isSel ? 1.6 : 1
        ctx.globalAlpha = isSelTrack ? 1 : 0.5
        switch (kk.interp) {
          case 'auto':
            ctx.beginPath()
            ctx.arc(0, 0, r, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            break
          case 'linear':
            ctx.beginPath()
            ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6)
            ctx.fill()
            ctx.stroke()
            break
          case 'stepped':
            ctx.beginPath()
            ctx.moveTo(-r, -r * 0.7)
            ctx.lineTo(r, -r * 0.7)
            ctx.lineTo(r, r * 0.7)
            ctx.lineTo(-r, r * 0.7)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            break
          default: {
            // bezier diamond
            ctx.rotate(Math.PI / 4)
            ctx.beginPath()
            ctx.rect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5)
            ctx.fill()
            ctx.stroke()
          }
        }
        ctx.restore()
        ctx.globalAlpha = 1
      }
    }

    // current-value dots on playhead for selected tracks
    for (const tr of project.tracks) {
      if (!selected.has(tr.id)) continue
      const { final } = engine.evalTrack(tr, playT, now)
      const y = v2y(final, H)
      const x = t2x(playT, W)
      if (x >= GUTTER_L && x <= plotR) {
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.fillStyle = tr.color
        ctx.fill()
        ctx.stroke()
      }
    }

    // track name tags
    ctx.font = '10px ui-monospace, monospace'
    for (const tr of project.tracks) {
      const isSel = selected.has(tr.id)
      const label = tr.name
      const x = Math.max(GUTTER_L + 4, t2x(tr.keys[0]?.t ?? 0, W))
      const y = v2y(evalCurve(tr.keys, Math.max(tr.keys[0]?.t ?? 0, x2t(GUTTER_L + 4))), H)
      ctx.globalAlpha = isSel ? 0.9 : 0.4
      ctx.fillStyle = 'rgba(10,10,16,0.72)'
      const tw = ctx.measureText(label).width
      ctx.fillRect(x + 2, y - 19, tw + 8, 13)
      ctx.fillStyle = tr.color
      ctx.fillText(label, x + 6, y - 9)
      ctx.globalAlpha = 1
    }

    // box select rect
    if (box) {
      const b = box
      ctx.strokeStyle = 'rgba(34,211,238,0.8)'
      ctx.fillStyle = 'rgba(34,211,238,0.08)'
      ctx.lineWidth = 1
      const x = Math.min(b.x0, b.x1)
      const y = Math.min(b.y0, b.y1)
      ctx.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0))
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0))
    }

    ctx.restore() // plot clip

    // ── ruler ──
    ctx.fillStyle = '#12121b'
    ctx.fillRect(0, 0, W, RULER_H)
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.beginPath()
    ctx.moveTo(0, RULER_H + 0.5)
    ctx.lineTo(W, RULER_H + 0.5)
    ctx.stroke()
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillStyle = 'rgba(200,200,220,0.65)'
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.beginPath()
    for (let t = Math.ceil(tL / tStep) * tStep; t <= tR; t += tStep) {
      const x = Math.round(t2x(t, W)) + 0.5
      ctx.moveTo(x, RULER_H - 5)
      ctx.lineTo(x, RULER_H)
      ctx.fillText(t.toFixed(tStep < 1 ? 2 : 0) + 's', x + 3, 11)
    }
    ctx.stroke()
    // value gutter
    ctx.fillStyle = '#101019'
    ctx.fillRect(0, RULER_H, GUTTER_L, H - RULER_H)
    ctx.fillStyle = 'rgba(200,200,220,0.6)'
    ctx.textAlign = 'right'
    for (let v = Math.ceil(vBot / vStep) * vStep; v <= vTop; v += vStep) {
      const y = v2y(v, H)
      if (y > RULER_H + 8 && y < H - PAD_BOTTOM) ctx.fillText(v.toFixed(vStep < 1 ? 2 : 0), GUTTER_L - 6, y + 3)
    }
    for (const v of [0, 1]) {
      const y = v2y(v, H)
      if (y > RULER_H + 8 && y < H - PAD_BOTTOM) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.fillText(v.toFixed(1), GUTTER_L - 6, y + 3)
      }
    }
    ctx.textAlign = 'left'

    // playhead
    const px = t2x(playT, W)
    if (px >= GUTTER_L - 2 && px <= plotR + 2) {
      ctx.strokeStyle = '#22d3ee'
      ctx.lineWidth = 1.4
      ctx.shadowColor = '#22d3ee'
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.moveTo(px, RULER_H)
      ctx.lineTo(px, H - PAD_BOTTOM)
      ctx.stroke()
      ctx.shadowBlur = 0
      // cap
      ctx.fillStyle = '#22d3ee'
      ctx.beginPath()
      ctx.moveTo(px - 5, RULER_H - 8)
      ctx.lineTo(px + 5, RULER_H - 8)
      ctx.lineTo(px, RULER_H)
      ctx.closePath()
      ctx.fill()
      // time chip
      const label = `${playT.toFixed(2)}s`
      ctx.font = '10px ui-monospace, monospace'
      const tw = ctx.measureText(label).width
      const cx = Math.min(Math.max(px + 6, GUTTER_L), plotR - tw - 8)
      ctx.fillStyle = 'rgba(34,211,238,0.9)'
      ctx.fillRect(cx, RULER_H - 24, tw + 8, 13)
      ctx.fillStyle = '#06121a'
      ctx.fillText(label, cx + 4, RULER_H - 14)
    }
  }

  // rAF loop -----------------------------------------------------------------
  onMount(() => {
    let raf = 0
    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    onCleanup(() => cancelAnimationFrame(raf))
  })

  // resize -------------------------------------------------------------------
  onMount(() => {
    const ro = new ResizeObserver(() => {
      size = { w: wrap.clientWidth, h: wrap.clientHeight }
    })
    ro.observe(wrap)
    size = { w: wrap.clientWidth, h: wrap.clientHeight }
    onCleanup(() => ro.disconnect())
  })

  // fit helpers ---------------------------------------------------------------
  const frameAll = () => {
    const { project } = getState()
    const all = project.tracks.flatMap((t) => t.keys)
    const sels = project.tracks.filter((t) => getState().selection.trackIds.includes(t.id))
    const selKeys = sels.flatMap((t) => t.keys)
    const use = selKeys.length > 0 ? selKeys : all
    if (use.length === 0) return
    fitBounds(use)
  }

  const fitBounds = (keys: Keyframe[]) => {
    const { w, h } = size
    let tMin = Infinity
    let tMax = -Infinity
    let vMin = Infinity
    let vMax = -Infinity
    for (const kk of keys) {
      tMin = Math.min(tMin, kk.t)
      tMax = Math.max(tMax, kk.t)
      vMin = Math.min(vMin, kk.v)
      vMax = Math.max(vMax, kk.v)
    }
    if (tMin === Infinity) return
    const spanT = Math.max(0.5, tMax - tMin)
    const spanV = Math.max(0.2, vMax - vMin)
    const plotW = w - GUTTER_L - GUTTER_R
    const plotH = h - RULER_H - PAD_BOTTOM
    view.pxPerSec = Math.max(2, Math.min(2000, (plotW * 0.92) / spanT))
    view.pxPerVal = Math.max(20, Math.min(4000, (plotH * 0.85) / spanV))
    view.x0 = tMin - (plotW / view.pxPerSec - spanT) / 2
    view.yCenter = (vMin + vMax) / 2
  }

  onMount(() => {
    // initial fit after first layout
    const id = window.setTimeout(() => frameAll(), 60)
    onCleanup(() => window.clearTimeout(id))
  })

  // snapping -------------------------------------------------------------------
  const snapTime = (t: number, excludeIds: Set<string>, trackId: string): number => {
    const { project, snap } = getState()
    if (!snap) return t
    const fps = project.fps || 30
    let out = Math.round(t * fps) / fps
    // magnetic: other keys within 6px
    for (const tr of project.tracks) {
      for (const kk of tr.keys) {
        if (excludeIds.has(kk.id)) continue
        if (tr.id !== trackId && !getState().selection.trackIds.includes(tr.id)) continue
        if (Math.abs(t2x(kk.t, size.w) - t2x(t, size.w)) < 6) {
          out = kk.t
          return out
        }
      }
    }
    return out
  }

  const snapVal = (v: number): number => {
    const { snap } = getState()
    return snap ? Math.round(v * 20) / 20 : v
  }

  // hit testing -----------------------------------------------------------------
  const hitTest = (mx: number, my: number): Hover => {
    const { project, selection } = getState()
    const W = size.w
    const H = size.h
    if (my <= RULER_H) {
      const px = t2x(engine.time, W)
      if (Math.abs(mx - px) < 6) return { type: 'playhead' }
      return { type: 'ruler' }
    }
    if (mx < GUTTER_L) return { type: 'empty' }
    // handles (selected keys only)
    for (const tr of project.tracks) {
      const selIds = selection.keyIds[tr.id] ?? []
      if (selIds.length === 0) continue
      for (let i = 0; i < tr.keys.length; i++) {
        const kk = tr.keys[i]
        if (!selIds.includes(kk.id)) continue
        let hi = kk.hi
        let ho = kk.ho
        if (kk.interp === 'auto') {
          const a = autoHandles(tr.keys[i - 1], kk, tr.keys[i + 1])
          hi = a.hi
          ho = a.ho
        }
        const kx = t2x(kk.t, W)
        const ky = v2y(kk.v, H)
        for (const [side, h] of [['in', hi], ['out', ho]] as const) {
          if (!h) continue
          const hx = kx + h.dt * view.pxPerSec
          const hy = ky - h.dv * view.pxPerVal
          if (Math.hypot(mx - hx, my - hy) < 8) return { type: 'handle', track: tr, key: kk, side }
        }
      }
    }
    // keys — selected tracks first
    const order = [...project.tracks].sort(
      (a, b) =>
        (selection.trackIds.includes(b.id) ? 1 : 0) - (selection.trackIds.includes(a.id) ? 1 : 0)
    )
    for (const tr of order) {
      for (const kk of tr.keys) {
        const kx = t2x(kk.t, W)
        const ky = v2y(kk.v, H)
        if (Math.hypot(mx - kx, my - ky) < 8) return { type: 'key', track: tr, key: kk }
      }
    }
    return { type: 'empty' }
  }

  // pointer handlers -----------------------------------------------------------
  const onPointerDown = (e: PointerEvent & { currentTarget: HTMLCanvasElement }) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setMenu((m) => ({ ...m, open: false }))
    const { project, selection } = getState()

    if (e.button === 1 || space || (e.button === 0 && e.altKey)) {
      drag = { kind: 'pan', sx: mx, sy: my, view: { ...view } }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return

    const hit = hitTest(mx, my)
    if (hit.type === 'ruler' || hit.type === 'playhead') {
      engine.seek(Math.max(0, x2t(mx)))
      drag = { kind: 'scrub' }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }

    if (hit.type === 'handle' && hit.track && hit.key) {
      // bake auto → bezier on grab
      const tr = hit.track
      const idx = tr.keys.findIndex((x) => x.id === hit.key!.id)
      let keys = tr.keys
      if (tr.keys[idx].interp === 'auto') {
        keys = tr.keys.map((kk, i) => {
          if (i !== idx) return kk
          const a = autoHandles(tr.keys[i - 1], kk, tr.keys[i + 1])
          return { ...kk, interp: 'bezier' as const, hi: a.hi, ho: a.ho }
        })
      }
      actions.commit()
      actions.setKeysLive(tr.id, keys)
      const startHandle = hit.side === 'in' ? keys[idx].hi : keys[idx].ho
      drag = {
        kind: 'handle',
        trackId: tr.id,
        keyId: hit.key.id,
        side: hit.side!,
        sx: mx,
        sy: my,
        startKeys: keys,
        startDt: startHandle?.dt ?? 0,
        startDv: startHandle?.dv ?? 0,
      }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }

    if (hit.type === 'key' && hit.track && hit.key) {
      const tr = hit.track
      const kk = hit.key
      const selIds = selection.keyIds[tr.id] ?? []
      let finalIds: string[]
      if (e.shiftKey) {
        finalIds = selIds.includes(kk.id) ? selIds.filter((x) => x !== kk.id) : [...selIds, kk.id]
      } else {
        finalIds = selIds.includes(kk.id) ? selIds : [kk.id]
      }
      const trackIds = selection.trackIds.includes(tr.id) ? selection.trackIds : [...selection.trackIds.filter(() => e.shiftKey), tr.id]
      actions.setSelection({ trackIds, keyIds: { ...selection.keyIds, [tr.id]: finalIds } })
      // drag snapshot: all keys of tracks that have selection
      const snapshot: Record<string, Keyframe[]> = {}
      for (const t2 of project.tracks) {
        const ids = t2.id === tr.id ? finalIds : selection.keyIds[t2.id] ?? []
        if (ids.length > 0 || t2.id === tr.id) snapshot[t2.id] = t2.keys.map((x) => ({ ...x }))
      }
      ghost = Object.fromEntries(
        Object.entries(snapshot).map(([tid, ks]) => [tid, ks.map((x) => ({ ...x }))])
      )
      actions.commit()
      drag = { kind: 'keys', sx: mx, sy: my, snapshot }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }

    // empty: box select
    drag = { kind: 'box', sx: mx, sy: my, additive: e.shiftKey }
    box = { x0: mx, y0: my, x1: mx, y1: my }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent & { currentTarget: HTMLCanvasElement }) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const s = getState()

    if (drag.kind === 'none') {
      const hit = hitTest(mx, my)
      hover = hit
      canvas.style.cursor =
        hit.type === 'key' || hit.type === 'handle'
          ? 'grab'
          : hit.type === 'ruler' || hit.type === 'playhead'
            ? 'ew-resize'
            : space
              ? 'grabbing'
              : 'crosshair'
      if (hit.type === 'key' && hit.key) {
        const fps = s.project.fps || 30
        setTip({
          x: t2x(hit.key.t, size.w),
          y: v2y(hit.key.v, size.h),
          text: `${hit.key.t.toFixed(3)}s (f${Math.round(hit.key.t * fps)})  v=${hit.key.v.toFixed(3)}  [${hit.key.interp}]`,
        })
      } else if (hit.type === 'handle' && hit.key) {
        setTip({
          x: mx,
          y: my,
          text: `${hit.side === 'in' ? 'in' : 'out'} handle — drag to shape · Shift: 45° · DblClick: flatten`,
        })
      } else setTip(null)
      return
    }

    switch (drag.kind) {
      case 'pan': {
        const dx = mx - drag.sx
        const dy = my - drag.sy
        view.x0 = drag.view.x0 - dx / drag.view.pxPerSec
        view.yCenter = drag.view.yCenter + dy / drag.view.pxPerVal
        break
      }
      case 'scrub': {
        engine.seek(Math.max(0, x2t(mx)))
        break
      }
      case 'keys': {
        const dt = (mx - drag.sx) / view.pxPerSec
        const dv = (my - drag.sy) / view.pxPerVal
        const { project, selection } = s
        for (const tr of project.tracks) {
          const snap = drag.snapshot[tr.id]
          if (!snap) continue
          const ids = selection.keyIds[tr.id] ?? []
          const moving = new Set(ids.length ? ids : [])
          // constraint: keys cannot cross neighbors — compute allowed dt shift
          const sorted = sortKeys(snap)
          let minGap = -Infinity
          let maxGap = Infinity
          const movers = sorted.filter((kk) => moving.has(kk.id))
          if (movers.length > 0) {
            const firstMover = movers[0]
            const lastMover = movers[movers.length - 1]
            const before = sorted.filter((kk) => kk.t < firstMover.t)
            const after = sorted.filter((kk) => kk.t > lastMover.t)
            if (before.length) minGap = before[before.length - 1].t - firstMover.t + 0.001
            if (after.length) maxGap = after[0].t - lastMover.t - 0.001
          }
          const shift = Math.min(Math.max(dt, minGap === -Infinity ? -1e9 : minGap), maxGap === Infinity ? 1e9 : maxGap)
          const newKeys = snap.map((kk) =>
            moving.has(kk.id)
              ? {
                  ...kk,
                  t: Math.max(0, snapTime(kk.t + shift, moving, tr.id)),
                  v: Math.min(2, Math.max(-1, snapVal(kk.v - dv))),
                }
              : kk
          )
          actions.setKeysLive(tr.id, newKeys)
        }
        break
      }
      case 'handle': {
        const d = drag // narrowed const alias — closures can't narrow a mutable let
        const dx = mx - d.sx
        const dy = my - d.sy
        const tr = s.project.tracks.find((t) => t.id === d.trackId)
        if (!tr) break
        const idx = d.startKeys.findIndex((kk) => kk.id === d.keyId)
        const kk = d.startKeys[idx]
        const prev = d.startKeys[idx - 1]
        const next = d.startKeys[idx + 1]
        const segT = d.side === 'out' ? (next?.t ?? kk.t + 1) - kk.t : kk.t - (prev?.t ?? kk.t - 1)
        let dt = d.startDt + dx / view.pxPerSec
        let dv = d.startDv - dy / view.pxPerVal
        // clamp dt within segment
        dt = d.side === 'out' ? Math.max(0, Math.min(segT, dt)) : Math.min(0, Math.max(-segT, dt))
        // 45° snapping
        if (e.shiftKey) {
          const ang = Math.atan2(dv, dt)
          const snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4)
          const len = Math.hypot(dt, dv)
          dt = Math.cos(snapped) * len * Math.sign(dt || 1)
          dv = Math.sin(snapped) * len * Math.sign(dt || 1)
          dt = d.side === 'out' ? Math.abs(dt) : -Math.abs(dt)
        }
        const newHandle: Handle = { dt, dv }
        const newKeys = d.startKeys.map((x, i) => {
          if (i !== idx) return x
          if (d.side === 'in') {
            // unified: mirror collinear out-handle (keep its length)
            if (!kk.broken && x.ho) {
              const len = Math.hypot(x.ho.dt, x.ho.dv)
              const dirLen = Math.hypot(dt, dv)
              if (dirLen > 1e-6) {
                const ux = dt / dirLen
                const uy = dv / dirLen
                return { ...x, interp: 'bezier' as const, hi: newHandle, ho: { dt: -ux * len, dv: -uy * len } }
              }
            }
            return { ...x, interp: 'bezier' as const, hi: newHandle }
          } else {
            if (!kk.broken && x.hi) {
              const len = Math.hypot(x.hi.dt, x.hi.dv)
              const dirLen = Math.hypot(dt, dv)
              if (dirLen > 1e-6) {
                const ux = dt / dirLen
                const uy = dv / dirLen
                return { ...x, interp: 'bezier' as const, ho: newHandle, hi: { dt: -ux * len, dv: -uy * len } }
              }
            }
            return { ...x, interp: 'bezier' as const, ho: newHandle }
          }
        })
        actions.setKeysLive(drag.trackId, newKeys)
        break
      }
      case 'box': {
        if (box) box = { ...box, x1: mx, y1: my }
        break
      }
    }
  }

  const onPointerUp = (e: PointerEvent) => {
    const s = getState()
    if (drag.kind === 'keys' || drag.kind === 'handle') {
      ghost = null
      actions.persistNow()
    }
    if (drag.kind === 'box' && box) {
      const b = box
      const { project, selection } = s
      if (Math.abs(b.x1 - b.x0) > 3 || Math.abs(b.y1 - b.y0) > 3) {
        const x0 = Math.min(b.x0, b.x1)
        const x1 = Math.max(b.x0, b.x1)
        const y0 = Math.min(b.y0, b.y1)
        const y1 = Math.max(b.y0, b.y1)
        const W = size.w
        const H = size.h
        const keyIds: Record<string, string[]> = drag.additive ? { ...selection.keyIds } : {}
        const trackIds = drag.additive ? [...selection.trackIds] : []
        for (const tr of project.tracks) {
          const ids: string[] = []
          for (const kk of tr.keys) {
            const kx = t2x(kk.t, W)
            const ky = v2y(kk.v, H)
            if (kx >= x0 && kx <= x1 && ky >= y0 && ky <= y1) ids.push(kk.id)
          }
          if (ids.length) {
            keyIds[tr.id] = drag.additive ? Array.from(new Set([...(keyIds[tr.id] ?? []), ...ids])) : ids
            if (!trackIds.includes(tr.id)) trackIds.push(tr.id)
          }
        }
        actions.setSelection({ trackIds, keyIds })
      }
      box = null
    }
    drag = { kind: 'none' }
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onWheel = (e: WheelEvent & { currentTarget: HTMLCanvasElement }) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const f = e.deltaY > 0 ? 0.88 : 1.14
    if (e.shiftKey) {
      const vAt = y2v(my, size.h)
      view.pxPerVal = Math.max(20, Math.min(4000, view.pxPerVal * f))
      // keep value under cursor
      view.yCenter = vAt - ((size.h - PAD_BOTTOM - my + RULER_H) - (size.h - RULER_H - PAD_BOTTOM) / 2) / view.pxPerVal
    } else {
      const tAt = x2t(mx)
      view.pxPerSec = Math.max(2, Math.min(2000, view.pxPerSec * f))
      view.x0 = tAt - (mx - GUTTER_L) / view.pxPerSec
    }
  }

  const onDoubleClick = (e: MouseEvent & { currentTarget: HTMLCanvasElement }) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const hit = hitTest(mx, my)
    const s = getState()
    if (hit.type === 'empty') {
      const t = Math.max(0, x2t(mx))
      const v = Math.min(2, Math.max(-1, y2v(my, size.h)))
      const targets =
        s.selection.trackIds.length > 0
          ? s.selection.trackIds
          : s.project.tracks.slice(0, 1).map((t2) => t2.id)
      for (const tid of targets) actions.addKeyAtTime(tid, snapTime(t, new Set(), tid), v)
    } else if (hit.type === 'handle' && hit.track && hit.key) {
      // flatten handle on double-click
      actions.setKeys(
        hit.track.id,
        hit.track.keys.map((kk) =>
          kk.id === hit.key!.id
            ? {
                ...kk,
                interp: 'bezier' as const,
                hi: kk.hi ? { ...kk.hi, dv: 0 } : null,
                ho: kk.ho ? { ...kk.ho, dv: 0 } : null,
              }
            : kk
        )
      )
    }
  }

  // keyboard --------------------------------------------------------------------
  onMount(() => {
    const isTyping = (el: EventTarget | null) => {
      const node = el as HTMLElement | null
      return (
        !!node &&
        (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable)
      )
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const s = getState()
      const mod = e.ctrlKey || e.metaKey
      if (e.code === 'Space') {
        space = true
      }
      switch (e.key) {
        case 'k':
        case 'K': {
          e.preventDefault()
          const ids =
            e.shiftKey || s.selection.trackIds.length === 0
              ? s.project.tracks.filter((t) => !t.muted).map((t) => t.id)
              : s.selection.trackIds
          for (const tid of ids) actions.addKeyAtTime(tid, engine.time)
          break
        }
        case 'f':
        case 'F':
          e.preventDefault()
          frameAll()
          break
        case 'a':
        case 'A': {
          e.preventDefault()
          if (mod) {
            actions.setSelection({ trackIds: s.project.tracks.map((t) => t.id), keyIds: {} })
          } else {
            const all = s.project.tracks.flatMap((t) => t.keys)
            fitBounds(all)
          }
          break
        }
        case 's':
        case 'S':
          e.preventDefault()
          actions.setSnap(!getState().snap)
          break
        case 'l':
        case 'L':
          e.preventDefault()
          engine.setLoop(!engine.loop)
          break
        case 'Escape':
          actions.clearSelection()
          setMenu((m) => ({ ...m, open: false }))
          break
        case 'Home':
          engine.seek(0)
          break
        case '1':
          actions.setSelectedInterp('bezier')
          break
        case '2':
          actions.setSelectedInterp('auto')
          break
        case '3':
          actions.setSelectedInterp('linear')
          break
        case '4':
          actions.setSelectedInterp('stepped')
          break
        case '5':
          actions.flattenSelected()
          break
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          const hasKeys = Object.values(s.selection.keyIds).some((a) => a.length > 0)
          if (!hasKeys) return
          e.preventDefault()
          const fps = s.project.fps || 30
          const d = e.shiftKey ? 8 : 1
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const dt = (e.key === 'ArrowRight' ? 1 : -1) / fps * d
            actions.mutate((p) => {
              for (const tr of p.tracks) {
                const ids = s.selection.keyIds[tr.id]
                if (!ids?.length) continue
                tr.keys = sortKeys(
                  tr.keys.map((kk) => (ids.includes(kk.id) ? { ...kk, t: Math.max(0, kk.t + dt) } : kk))
                )
              }
            }, false)
          } else {
            const dv = (e.key === 'ArrowUp' ? 1 : -1) * 0.01 * d
            actions.mutate((p) => {
              for (const tr of p.tracks) {
                const ids = s.selection.keyIds[tr.id]
                if (!ids?.length) continue
                tr.keys = tr.keys.map((kk) => (ids.includes(kk.id) ? { ...kk, v: kk.v + dv } : kk))
              }
            }, false)
          }
          break
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') space = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    })
  })

  // context menu -----------------------------------------------------------------
  const onContextMenu = (e: MouseEvent & { currentTarget: HTMLCanvasElement }) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    const s = getState()
    if (hit.type === 'key' && hit.track && hit.key) {
      const ids = s.selection.keyIds[hit.track.id] ?? []
      if (!ids.includes(hit.key.id)) actions.selectKeys(hit.track.id, [hit.key.id], false)
    }
    setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, open: true })
  }

  const menuAction = (fn: () => void) => () => {
    fn()
    setMenu((m) => ({ ...m, open: false }))
  }
  const hasKeySel = createMemo(() => Object.values(store.selection.keyIds).some((a) => a.length > 0))

  return (
    <div ref={wrap} class="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvas}
        class="block h-full w-full touch-none select-none"
        style={{ width: '100%', height: '100%' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDblClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />
      {/* zoom buttons */}
      <div class="absolute right-3 top-9 flex flex-col gap-1">
        <button
          class="rounded border border-white/10 bg-black/50 px-2 py-1 font-mono text-[10px] text-zinc-300 hover:bg-white/10"
          onClick={() => {
            view.pxPerSec = Math.min(2000, view.pxPerSec * 1.25)
            view.pxPerVal = Math.min(4000, view.pxPerVal * 1.25)
          }}
          title="Zoom in"
        >
          +
        </button>
        <button
          class="rounded border border-white/10 bg-black/50 px-2 py-1 font-mono text-[10px] text-zinc-300 hover:bg-white/10"
          onClick={() => {
            view.pxPerSec = Math.max(2, view.pxPerSec * 0.8)
            view.pxPerVal = Math.max(20, view.pxPerVal * 0.8)
          }}
          title="Zoom out"
        >
          −
        </button>
        <button
          class="rounded border border-white/10 bg-black/50 px-2 py-1 font-mono text-[10px] text-zinc-300 hover:bg-white/10"
          onClick={frameAll}
          title="Frame all (A)"
        >
          ⤢
        </button>
      </div>
      {/* tooltip */}
      <Show when={tip()} keyed>
        {(t) => (
          <div
            class="pointer-events-none absolute z-10 whitespace-nowrap rounded border border-white/10 bg-black/85 px-2 py-1 font-mono text-[10px] text-zinc-200"
            style={{ left: `${Math.min(t.x + 12, size.w - 240)}px`, top: `${Math.max(30, t.y - 34)}px` }}
          >
            {t.text}
          </div>
        )}
      </Show>
      {/* context menu */}
      <Show when={menu().open}>
        <>
          <div class="fixed inset-0 z-30" onPointerDown={() => setMenu((m) => ({ ...m, open: false }))} />
          <div
            class="absolute z-40 w-56 rounded-md border border-white/10 bg-[#15151f] py-1 text-[12px] text-zinc-200 shadow-2xl"
            style={{ left: `${Math.min(menu().x, size.w - 230)}px`, top: `${Math.min(menu().y, size.h - 340)}px` }}
          >
            <div class="px-3 pb-1 pt-1.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
              Interpolation
            </div>
            {(
              [
                ['Bezier', 'bezier'],
                ['Auto smooth', 'auto'],
                ['Linear', 'linear'],
                ['Stepped', 'stepped'],
              ] as const
            ).map(([label, interp]) => (
              <button
                disabled={!hasKeySel()}
                class="block w-full px-3 py-1 text-left hover:bg-white/10 disabled:opacity-30"
                onClick={menuAction(() => actions.setSelectedInterp(interp))}
              >
                {label}
              </button>
            ))}
            <div class="my-1 h-px bg-white/10" />
            <div class="px-3 pb-1 pt-1 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
              Ease preset → next key
            </div>
            <div class="max-h-44 overflow-y-auto">
              {EASE_PRESETS.map((p) => (
                <button
                  disabled={!hasKeySel()}
                  class="block w-full px-3 py-1 text-left hover:bg-white/10 disabled:opacity-30"
                  onClick={menuAction(() => actions.applyEaseToSelection(p.id))}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div class="my-1 h-px bg-white/10" />
            <button
              disabled={!hasKeySel()}
              class="block w-full px-3 py-1 text-left hover:bg-white/10 disabled:opacity-30"
              onClick={menuAction(() => actions.flattenSelected())}
            >
              Flatten handles
            </button>
            <button
              disabled={!hasKeySel()}
              class="block w-full px-3 py-1 text-left hover:bg-white/10 disabled:opacity-30"
              onClick={menuAction(() => actions.toggleBreakSelected())}
            >
              Break / unify handles
            </button>
            <div class="my-1 h-px bg-white/10" />
            <button
              class="block w-full px-3 py-1 text-left hover:bg-white/10"
              onClick={menuAction(() => {
                const st = getState()
                const ids = st.selection.trackIds.length ? st.selection.trackIds : st.project.tracks.slice(0, 1).map((t) => t.id)
                for (const tid of ids) actions.addKeyAtTime(tid, engine.time)
              })}
            >
              Add key at playhead (K)
            </button>
            <button
              class="block w-full px-3 py-1 text-left hover:bg-white/10"
              onClick={menuAction(() => actions.copySelection())}
            >
              Copy keys (⌘C)
            </button>
            <button
              class="block w-full px-3 py-1 text-left hover:bg-white/10"
              onClick={menuAction(() => actions.pasteAtPlayhead())}
            >
              Paste at playhead (⌘V)
            </button>
            <button
              disabled={!hasKeySel()}
              class="block w-full px-3 py-1 text-left text-rose-300 hover:bg-white/10 disabled:opacity-30"
              onClick={menuAction(() => actions.deleteSelectedKeys())}
            >
              Delete keys (⌫)
            </button>
          </div>
        </>
      </Show>
    </div>
  )
}

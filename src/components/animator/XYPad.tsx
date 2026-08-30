import { createSignal, onCleanup, onMount } from 'solid-js'
import { chMessage } from '@/lib/osc/encode'
import { engine } from '@/lib/animation/engine'
import { store, actions } from '@/store/useAnimator'

// ─── XY Pad: sends two /ch addresses live ─────────────────────────────────────

export default function XYPad() {
  const [pos, setPos] = createSignal({ x: 0.5, y: 0.5 })
  let dragging = false
  let lastSend = 0

  onMount(() => {
    // stream position while dragging at ~30 Hz
    let raf = 0
    const loop = () => {
      if (dragging) {
        const now = performance.now()
        if (now - lastSend > 33) {
          lastSend = now
          const p = pos()
          const xy = store.project.xy
          void engine.sendImmediate([chMessage(atoi(xy.addrX), p.x), chMessage(atoi(xy.addrY), p.y)])
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    onCleanup(() => cancelAnimationFrame(raf))
  })

  const update = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height))
    setPos({ x, y })
  }

  return (
    <div class="flex flex-col gap-2">
      <div
        class="relative aspect-[4/3] w-full cursor-crosshair touch-none overflow-hidden rounded-lg border border-white/10 bg-[#0e0e16]"
        onPointerDown={(e) => {
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          dragging = true
          update(e)
        }}
        onPointerMove={(e) => dragging && update(e)}
        onPointerUp={(e) => {
          dragging = false
          try {
            ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }}
        style={{
          'background-image':
            'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
          'background-size': '25% 25%',
        }}
      >
        {/* crosshair */}
        <div
          class="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300"
          style={{
            left: `${pos().x * 100}%`,
            top: `${(1 - pos().y) * 100}%`,
            'box-shadow': '0 0 10px #22d3ee',
            background: 'rgba(34,211,238,0.35)',
          }}
        />
        <div
          class="pointer-events-none absolute inset-y-0 w-px bg-cyan-400/20"
          style={{ left: `${pos().x * 100}%` }}
        />
        <div
          class="pointer-events-none absolute inset-x-0 h-px bg-cyan-400/20"
          style={{ top: `${(1 - pos().y) * 100}%` }}
        />
        <div class="pointer-events-none absolute bottom-1 right-2 font-mono text-[9px] text-zinc-500">
          x {pos().x.toFixed(2)} · y {pos().y.toFixed(2)}
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <input
          class="w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[10px] text-zinc-300 outline-none focus:border-cyan-400/50"
          value={store.project.xy.addrX}
          onInput={(e) => actions.setXy({ addrX: e.currentTarget.value })}
          title="X address"
        />
        <input
          class="w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[10px] text-zinc-300 outline-none focus:border-cyan-400/50"
          value={store.project.xy.addrY}
          onInput={(e) => actions.setXy({ addrY: e.currentTarget.value })}
          title="Y address"
        />
      </div>
    </div>
  )
}

function atoi(addr: string): number {
  const m = addr.match(/\/ch\/(\d+)/)
  return m ? Number(m[1]) : 1
}

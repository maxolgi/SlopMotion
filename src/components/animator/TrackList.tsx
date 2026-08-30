import { createSignal, onCleanup, onMount, For, Show } from 'solid-js'
import { store, actions } from '@/store/useAnimator'
import { engine } from '@/lib/animation/engine'
import type { Track } from '@/lib/animation/types'
import {
  ChevronDown,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Gauge,
  Plus,
  Radio,
  Trash2,
  Waves,
} from 'lucide-solid'

// ─── Track list (left panel) ──────────────────────────────────────────────────

const liveReadouts = new Map<HTMLSpanElement, string>()

function LiveValue(props: { track: Track }) {
  let ref!: HTMLSpanElement
  onMount(() => {
    liveReadouts.set(ref, props.track.id)
  })
  onCleanup(() => {
    liveReadouts.delete(ref)
  })
  return (
    <span
      ref={ref}
      class="min-w-[38px] rounded bg-black/40 px-1 py-0.5 text-right font-mono text-[10px]"
      style={{ color: props.track.color }}
    >
      0.000
    </span>
  )
}

function addrLabel(t: Track): string {
  return t.target
}

export default function TrackList() {
  const [learning, setLearning] = createSignal<string | null>(null)
  onMount(() => {
    const id = window.setInterval(() => setLearning(engine.learning), 400)
    let raf = 0
    const loop = () => {
      for (const [span, trackId] of liveReadouts) {
        const track = store.project.tracks.find((t) => t.id === trackId)
        if (!track) continue
        const { arg } = engine.evalTrack(track, engine.time)
        span.textContent = arg.toFixed(3)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    onCleanup(() => {
      window.clearInterval(id)
      cancelAnimationFrame(raf)
    })
  })
  const [expanded, setExpanded] = createSignal<string | null>(null)

  return (
    <div class="flex h-full flex-col">
      <div class="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <span class="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          Tracks · {store.project.tracks.length}
        </span>
        <button
          class="flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-white/10"
          onClick={() => actions.addTrack()}
          title="Add track"
        >
          <Plus size={11} /> Add
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <For each={store.project.tracks}>
          {(tr) => {
            const sel = () => store.selection.trackIds.includes(tr.id)
            const isLearning = () => learning() === tr.id
            const isExpanded = () => expanded() === tr.id
            return (
              <div>
                <div
                  class={`group flex cursor-pointer items-center gap-1.5 border-b border-white/5 px-2 py-1.5 ${
                    sel() ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                  }`}
                  onClick={(e) => actions.selectTrack(tr.id, e.shiftKey || e.ctrlKey || e.metaKey)}
                >
                  <span
                    class="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: tr.color, 'box-shadow': sel() ? `0 0 6px ${tr.color}` : undefined }}
                  />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1">
                      <span
                        class={`truncate text-[11px] ${sel() ? 'text-white' : 'text-zinc-300'} ${
                          tr.muted ? 'line-through opacity-40' : ''
                        }`}
                      >
                        {tr.name}
                      </span>
                      <Show when={tr.lfo.enabled}>
                        <Waves size={9} class="shrink-0 text-cyan-300/70" />
                      </Show>
                      <Show when={tr.env.enabled}>
                        <Gauge size={9} class="shrink-0 text-fuchsia-300/70" />
                      </Show>
                      <Show when={isLearning()}>
                        <Radio size={9} class="shrink-0 animate-pulse text-amber-300" />
                      </Show>
                    </div>
                    <span class="font-mono text-[9px] text-zinc-500">{addrLabel(tr)}</span>
                  </div>
                  <LiveValue track={tr} />
                  <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      class="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                      title={tr.muted ? 'Unmute' : 'Mute'}
                      onClick={(e) => {
                        e.stopPropagation()
                        actions.setTrackProp(tr.id, { muted: !tr.muted })
                      }}
                    >
                      {tr.muted ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                    <button
                      class="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                      title="Send OSC on/off"
                      onClick={(e) => {
                        e.stopPropagation()
                        actions.setTrackProp(tr.id, { send: !tr.send })
                      }}
                    >
                      <Circle
                        size={11}
                        class={tr.send ? 'fill-emerald-400 text-emerald-400' : 'text-zinc-600'}
                      />
                    </button>
                    <button
                      class="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                      title="Duplicate"
                      onClick={(e) => {
                        e.stopPropagation()
                        actions.duplicateTrack(tr.id)
                      }}
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      class="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-rose-300"
                      title="Delete track"
                      onClick={(e) => {
                        e.stopPropagation()
                        actions.removeTrack(tr.id)
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                    <button
                      class="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                      title="Track settings"
                      onClick={(e) => {
                        e.stopPropagation()
                        setExpanded(expanded() === tr.id ? null : tr.id)
                      }}
                    >
                      <ChevronDown
                        size={11}
                        class={expanded() === tr.id ? 'rotate-180 transition-transform' : 'transition-transform'}
                      />
                    </button>
                  </div>
                </div>
                <Show when={isExpanded()}>
                  <div class="border-b border-white/5 bg-black/20 px-3 py-2 text-[11px] text-zinc-300">
                    <label class="mb-1 block font-mono text-[9px] uppercase text-zinc-500">Name</label>
                    <input
                      class="mb-2 w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] outline-none focus:border-cyan-400/50"
                      value={tr.name}
                      onBlur={(e) => actions.setTrackProp(tr.id, { name: e.currentTarget.value })}
                    />
                    <label class="mb-1 block font-mono text-[9px] uppercase text-zinc-500">OSC target</label>
                    <input
                      class="mb-2 w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] outline-none focus:border-cyan-400/50"
                      title="OSC address"
                      value={tr.target}
                      onBlur={(e) => {
                        const target = e.currentTarget.value.trim()
                        actions.setTrackProp(tr.id, {
                          target: target ? (target.startsWith('/') ? target : `/${target}`) : '/ch/1',
                        })
                      }}
                    />
                    <div class="mb-2 grid grid-cols-2 gap-2">
                      <div>
                        <label class="mb-1 block font-mono text-[9px] uppercase text-zinc-500">Range min</label>
                        <input
                          type="number"
                          step={0.1}
                          class="w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] outline-none"
                          value={tr.min}
                          onInput={(e) => actions.setTrackProp(tr.id, { min: Number(e.currentTarget.value) || 0 })}
                        />
                      </div>
                      <div>
                        <label class="mb-1 block font-mono text-[9px] uppercase text-zinc-500">Range max</label>
                        <input
                          type="number"
                          step={0.1}
                          class="w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] outline-none"
                          value={tr.max}
                          title="Output max — 0 sends absolute curve values"
                          onInput={(e) => {
                            const v = e.currentTarget.value
                            actions.setTrackProp(tr.id, { max: v === '' ? 1 : Number(v) })
                          }}
                        />
                      </div>
                    </div>
                    <button
                      class="w-full rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-300 hover:bg-amber-400/20"
                      onClick={() => {
                        if (engine.learning === tr.id) engine.startLearn(null)
                        else engine.startLearn(tr.id)
                        setLearning(engine.learning)
                      }}
                    >
                      {learning() === tr.id ? '■ Stop Learn pulse' : '◉ Learn — pulse this address'}
                    </button>
                    <p class="mt-1 text-[9px] leading-snug text-zinc-500">
                      Pulses 0→1 on {addrLabel(tr)} for 15 s. Use your OSC software&apos;s learn
                      mode to bind it to a destination.
                    </p>
                  </div>
                </Show>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}

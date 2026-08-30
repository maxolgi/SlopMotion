import { onCleanup, onMount, createSignal } from 'solid-js'
import { Pause, Play, Repeat, SkipBack } from 'lucide-solid'
import { engine } from '@/lib/animation/engine'
import { getState } from '@/store/useAnimator'

// ─── Transport bar: drives the engine rAF + transport controls ────────────────

export default function TransportBar() {
  const [playing, setPlaying] = createSignal(false)
  const [loop, setLoop] = createSignal(true)
  let timeRef!: HTMLSpanElement
  let frameRef!: HTMLSpanElement

  // engine clock — single driver for the whole app
  onMount(() => {
    let raf = 0
    const frame = () => {
      engine.tick()
      const fps = getState().project.fps || 30
      if (timeRef) timeRef.textContent = engine.time.toFixed(2)
      if (frameRef) frameRef.textContent = `f${Math.floor(engine.time * fps)}`
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    const id = window.setInterval(() => {
      setPlaying(engine.playing)
      setLoop(engine.loop)
    }, 200)
    onCleanup(() => {
      cancelAnimationFrame(raf)
      window.clearInterval(id)
    })
  })

  return (
    <div class="flex items-center gap-1.5">
      <button
        class="grid h-7 w-7 place-items-center rounded border border-white/10 bg-white/5 p-0 text-zinc-300 hover:bg-white/10"
        onClick={() => engine.seek(0)}
        title="Return to start (Home)"
      >
        <SkipBack size={14} />
      </button>
      <button
        class={`grid h-7 w-7 place-items-center rounded border p-0 ${
          playing()
            ? 'border-cyan-400/60 bg-cyan-400/20 text-cyan-300'
            : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
        }`}
        onClick={() => {
          engine.toggle()
          setPlaying(engine.playing)
        }}
        title="Play / Pause (Space)"
      >
        {playing() ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <button
        class={`grid h-7 w-7 place-items-center rounded border p-0 ${
          loop()
            ? 'border-fuchsia-400/60 bg-fuchsia-400/20 text-fuchsia-300'
            : 'border-white/10 bg-white/5 text-zinc-500 hover:bg-white/10'
        }`}
        onClick={() => {
          engine.setLoop(!engine.loop)
          setLoop(engine.loop)
        }}
        title="Loop (L)"
      >
        <Repeat size={14} />
      </button>
      <div class="ml-1 rounded border border-white/10 bg-black/40 px-2.5 py-1 font-mono text-[12px] tabular-nums">
        <span ref={timeRef} class="text-cyan-300">
          0.00
        </span>
        <span class="text-zinc-600">s</span>
        <span ref={frameRef} class="ml-1.5 text-[9px] text-zinc-500" />
      </div>
    </div>
  )
}

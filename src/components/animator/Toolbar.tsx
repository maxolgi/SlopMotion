import { createSignal, onCleanup, onMount } from 'solid-js'
import { store, getState, actions } from '@/store/useAnimator'
import { engine } from '@/lib/animation/engine'
import { demoProject } from '@/lib/animation/presets'
import type { Project } from '@/lib/animation/types'
import TransportBar from './TransportBar'
import {
  Download,
  HelpCircle,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
  Upload,
  Zap,
} from 'lucide-solid'
import { toast } from 'solid-sonner'

// ─── Toolbar ──────────────────────────────────────────────────────────────────

export default function Toolbar(props: {
  tab: 'editor' | 'perform'
  onTab: (t: 'editor' | 'perform') => void
  onHelp: () => void
}) {
  // osc status
  const [status, setStatus] = createSignal<{ ok: boolean; live: boolean; rate: number }>({
    ok: false,
    live: false,
    rate: 0,
  })
  onMount(() => {
    const id = window.setInterval(() => {
      setStatus({
        ok: performance.now() - engine.stats.lastSendAt < 1200 && !engine.stats.lastError,
        live: store.project.osc.live && store.project.osc.armed,
        rate: engine.stats.msgRate,
      })
    }, 600)
    onCleanup(() => window.clearInterval(id))
  })

  const exportJson = () => {
    const data = JSON.stringify(getState().project, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${store.project.name.replace(/\s+/g, '_').toLowerCase() || 'slopmotion'}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.success('Project exported')
  }

  const importJson = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const p = JSON.parse(await file.text()) as Project
        if (!Array.isArray(p.tracks)) throw new Error('not a SlopMotion project')
        actions.loadProject(p)
        toast.success(`Loaded “${p.name}”`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Invalid file')
      }
    }
    input.click()
  }

  return (
    <header class="flex flex-wrap items-center gap-2 border-b border-white/5 bg-[#101019] px-3 py-2">
      {/* brand */}
      <div class="mr-1 flex items-center gap-2">
        <div
          class="grid h-7 w-7 place-items-center rounded-md font-black text-black"
          style={{ background: 'linear-gradient(135deg,#22d3ee,#e879f9)' }}
        >
          S
        </div>
        <div class="leading-none">
          <div class="text-[13px] font-bold tracking-tight text-white">
            SlopMotion
          </div>
          <div class="text-[8px] uppercase tracking-[0.2em] text-zinc-500">
            OSC animator
          </div>
        </div>
      </div>

      <TransportBar />

      {/* project fields */}
      <input
        class="w-28 rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-cyan-400/40"
        value={store.project.name}
        onInput={(e) => actions.setProjectProp({ name: e.currentTarget.value })}
        title="Project name"
      />
      <label class="flex items-center gap-1 font-mono text-[10px] text-zinc-500">
        BPM
        <input
          type="number"
          min={20}
          max={300}
          class="w-14 rounded border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-zinc-200 outline-none"
          value={store.project.bpm}
          onInput={(e) => actions.setProjectProp({ bpm: Math.min(300, Math.max(20, Number(e.currentTarget.value) || 120)) })}
        />
      </label>
      <label class="flex items-center gap-1 font-mono text-[10px] text-zinc-500">
        LOOP
        <input
          type="number"
          min={1}
          max={600}
          class="w-16 rounded border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-zinc-200 outline-none"
          value={store.project.duration}
          onInput={(e) => actions.setProjectProp({ duration: Math.max(1, Number(e.currentTarget.value) || 16) })}
        />
        s
      </label>
      <button
        class={`rounded border px-2 py-1 font-mono text-[10px] ${
          store.snap ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-300' : 'border-white/10 text-zinc-500'
        }`}
        onClick={() => actions.setSnap(!store.snap)}
        title="Snap to frames + keys (S)"
      >
        SNAP
      </button>

      <div class="ml-auto flex items-center gap-1.5">
        {/* undo / redo */}
        <button
          class="rounded border border-white/10 p-1.5 text-zinc-400 hover:bg-white/10 disabled:opacity-30"
          onClick={() => actions.undo()}
          disabled={store.past.length === 0}
          title="Undo (⌘Z)"
        >
          <Undo2 size={13} />
        </button>
        <button
          class="rounded border border-white/10 p-1.5 text-zinc-400 hover:bg-white/10 disabled:opacity-30"
          onClick={() => actions.redo()}
          disabled={store.future.length === 0}
          title="Redo (⇧⌘Z)"
        >
          <Redo2 size={13} />
        </button>

        {/* osc chip */}
        <button
          class={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] ${
            status().live
              ? status().ok
                ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300'
                : 'border-amber-400/50 bg-amber-400/10 text-amber-300'
              : 'border-white/10 bg-white/5 text-zinc-400'
          }`}
          onClick={() => actions.setOsc({ live: !store.project.osc.live })}
          title="Toggle live OSC send"
        >
          <span
            class={`h-1.5 w-1.5 rounded-full ${
              status().live ? (status().ok ? 'bg-emerald-400' : 'bg-amber-400') : 'bg-zinc-600'
            } ${status().live && status().ok ? 'animate-pulse' : ''}`}
          />
          {status().live ? 'LIVE' : 'SIM'} · {status().rate}/s
        </button>

        {/* tabs */}
        <div class="flex overflow-hidden rounded-md border border-white/10">
          <button
            class={`px-3 py-1 text-[11px] ${
              props.tab === 'editor' ? 'bg-cyan-400/20 text-cyan-300' : 'text-zinc-400 hover:bg-white/5'
            }`}
            onClick={() => props.onTab('editor')}
          >
            Editor
          </button>
          <button
            class={`px-3 py-1 text-[11px] ${
              props.tab === 'perform' ? 'bg-fuchsia-400/20 text-fuchsia-300' : 'text-zinc-400 hover:bg-white/5'
            }`}
            onClick={() => props.onTab('perform')}
          >
            Perform
          </button>
        </div>

        {/* file */}
        <button
          class="rounded border border-white/10 p-1.5 text-zinc-400 hover:bg-white/10"
          onClick={exportJson}
          title="Export project JSON"
        >
          <Download size={13} />
        </button>
        <button
          class="rounded border border-white/10 p-1.5 text-zinc-400 hover:bg-white/10"
          onClick={importJson}
          title="Import project JSON"
        >
          <Upload size={13} />
        </button>
        <button
          class="rounded border border-white/10 p-1.5 text-zinc-400 hover:bg-white/10"
          onClick={() => {
            actions.persist()
            toast.success('Saved to this browser')
          }}
          title="Save to browser storage"
        >
          <Save size={13} />
        </button>
        <button
          class="rounded border border-white/10 p-1.5 text-zinc-400 hover:bg-white/10"
          onClick={() => {
            actions.resetDemo()
            toast('Demo project restored')
          }}
          title="Reset to demo project"
        >
          <RotateCcw size={13} />
        </button>
        <button
          class="rounded border border-fuchsia-400/40 bg-fuchsia-400/10 p-1.5 text-fuchsia-300 hover:bg-fuchsia-400/20"
          onClick={() => {
            const p = demoProject()
            actions.loadProject(p)
            engine.seek(0)
            toast('Loaded fresh SlopShady mapping template')
          }}
          title="Load SlopShady template"
        >
          <Zap size={13} />
        </button>
        <button
          class="rounded border border-white/10 p-1.5 text-zinc-400 hover:bg-white/10"
          onClick={() => props.onHelp()}
          title="Help & shortcuts"
        >
          <HelpCircle size={13} />
        </button>
      </div>
    </header>
  )
}

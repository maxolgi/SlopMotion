import { onMount, createSignal } from 'solid-js'
import Toolbar from '@/components/animator/Toolbar'
import TrackList from '@/components/animator/TrackList'
import Inspector from '@/components/animator/Inspector'
import HelpDialog from '@/components/animator/HelpDialog'
import CurveEditor from '@/components/animator/CurveEditor'
import PerformView from '@/components/animator/PerformView'
import { actions, store } from '@/store/useAnimator'
import { useGlobalKeys } from '@/lib/useGlobalKeys'
import { PanelLeft, PanelRight } from 'lucide-solid'

export default function Home() {
  const [tab, setTab] = createSignal<'editor' | 'perform'>('editor')
  const [help, setHelp] = createSignal(false)
  const [leftOpen, setLeftOpen] = createSignal(true)
  const [rightOpen, setRightOpen] = createSignal(true)

  useGlobalKeys()

  onMount(() => {
    actions.hydrate()
  })

  return (
    <div class="flex h-screen w-full flex-col overflow-hidden bg-[#0b0b11] text-zinc-200">
      <Toolbar tab={tab()} onTab={setTab} onHelp={() => setHelp(true)} />

      <div class="flex min-h-0 flex-1">
        {/* left: tracks */}
        <aside
          class={`relative z-20 shrink-0 border-r border-white/5 bg-[#101019] transition-all ${
            leftOpen() ? 'w-60' : 'w-0'
          } max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:top-[41px] max-lg:shadow-2xl`}
        >
          <div class="h-full w-60 overflow-hidden">
            <TrackList />
          </div>
        </aside>

        {/* center */}
        <main class="relative min-w-0 flex-1 bg-[#0e0e15]">
          {tab() === 'editor' ? <CurveEditor /> : <PerformView />}

          {/* panel toggles (mobile + desktop) */}
          <button
            class={`absolute left-0 top-0 z-30 border-b border-r border-white/10 bg-[#101019] p-1.5 text-zinc-400 hover:text-white ${leftOpen() ? 'lg:hidden' : ''}`}
            onClick={() => setLeftOpen((v) => !v)}
            title="Toggle track panel"
          >
            <PanelLeft size={14} />
          </button>
          <button
            class="absolute right-0 top-0 z-30 border-b border-l border-white/10 bg-[#101019] p-1.5 text-zinc-400 hover:text-white"
            onClick={() => setRightOpen((v) => !v)}
            title="Toggle inspector"
          >
            <PanelRight size={14} />
          </button>
        </main>

        {/* right: inspector */}
        <aside
          class={`relative z-20 shrink-0 border-l border-white/5 bg-[#101019] transition-all ${
            rightOpen() ? 'w-72' : 'w-0'
          } max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:top-[41px] max-lg:shadow-2xl`}
        >
          <div class="h-full w-72 overflow-hidden">
            <Inspector />
          </div>
        </aside>
      </div>

      {/* status strip */}
      <footer class="flex items-center gap-3 border-t border-white/5 bg-[#101019] px-3 py-1 font-mono text-[9px] text-zinc-600">
        <span>SlopMotion v0.1</span>
        <span class="text-zinc-700">|</span>
        <span>bezier · auto · linear · stepped</span>
        <span class="text-zinc-700">|</span>
        <span>LFO × {store.project.tracks.filter((t) => t.lfo.enabled).length} · ENV × {store.project.tracks.filter((t) => t.env.enabled).length}</span>
        <span class="ml-auto">autosaves to browser · export/import JSON via toolbar</span>
      </footer>

      <HelpDialog open={help()} onClose={() => setHelp(false)} />
    </div>
  )
}

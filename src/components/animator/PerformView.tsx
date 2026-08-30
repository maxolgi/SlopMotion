import { For, Show, onCleanup, onMount } from 'solid-js'
import Knob from './Knob'
import XYPad from './XYPad'
import { store, getState, actions } from '@/store/useAnimator'
import { engine } from '@/lib/animation/engine'
import { chMessage } from '@/lib/osc/encode'
import type { Clip } from '@/lib/animation/types'

// ─── Performance view: clip launcher + knobs + XY pad ────────────────────────

const CLIP_KEYS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F']

export default function PerformView() {
  const launch = (clip: Clip) => {
    engine.launchClip(clip)
  }

  // keyboard launch Q W E R A S D F — active only while this view is mounted
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const idx = CLIP_KEYS.indexOf(e.key.toUpperCase())
      if (idx >= 0) {
        const clip = getState().project.clips[idx]
        if (clip) {
          e.preventDefault()
          engine.launchClip(clip)
        }
      }
    }
    window.addEventListener('keydown', handler)
    onCleanup(() => window.removeEventListener('keydown', handler))
  })

  return (
    <div class="h-full overflow-y-auto p-4">
      <div class="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[1.2fr_1fr]">
        {/* clip launcher */}
        <section>
          <h3 class="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Clip launcher — Q W E R / A S D F
          </h3>
          <div class="grid grid-cols-4 gap-2">
            <For each={store.project.clips.slice(0, 8)}>
              {(clip, i) => (
                <div class="group relative">
                  <button
                    class="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border transition-all active:scale-95"
                    style={{
                      'border-color': `${clip.color}55`,
                      background: `linear-gradient(160deg, ${clip.color}18, #0e0e16 70%)`,
                      'box-shadow': `inset 0 0 20px ${clip.color}10`,
                    }}
                    onClick={() => launch(clip)}
                  >
                    <span class="text-[13px] font-semibold" style={{ color: clip.color }}>
                      {clip.name}
                    </span>
                    <span class="font-mono text-[9px] text-zinc-500">
                      {CLIP_KEYS[i()]} · {clip.actions.length} act
                    </span>
                  </button>
                  <input
                    class="mt-1 w-full rounded border border-white/5 bg-black/40 px-1 py-0.5 text-center text-[10px] text-zinc-400 outline-none focus:border-cyan-400/40"
                    value={clip.name}
                    onBlur={(e) => actions.updateClip(clip.id, { name: e.currentTarget.value })}
                    title="Rename clip"
                  />
                </div>
              )}
            </For>
          </div>
          <div class="mt-3 grid grid-cols-1 gap-1.5 rounded-lg border border-white/10 bg-black/25 p-2 text-[10px] leading-relaxed text-zinc-500">
            <p>
              <span class="text-zinc-300">Actions inside each clip</span> fire on launch: seek
              the timeline, trigger a track envelope, flash a value, or send a MIDI-style note to
              SlopShady&apos;s voice system. Rename clips inline; edit actions in{' '}
              <span class="font-mono">clips.json</span> export or duplicate this project.
            </p>
            <p>
              Voice note mapping: /noteon → ch, note, vel (V/Oct voices respond like MIDI). Flash
              overrides a track value for a moment, then eases back into the curve.
            </p>
          </div>
        </section>

        {/* knobs + xy */}
        <section class="space-y-5">
          <div>
            <h3 class="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Live knobs — drag ⇕ · dbl-click resets
            </h3>
            <div class="grid grid-cols-3 gap-3 rounded-lg border border-white/10 bg-black/25 p-3">
              <For each={store.project.knobs}>
                {(kn, i) => (
                  <Knob
                    label={kn.label}
                    address={kn.address}
                    value={kn.value}
                    min={kn.min}
                    max={kn.max}
                    color={['#22d3ee', '#e879f9', '#fbbf24', '#34d399', '#a78bfa', '#fb7185', '#a3e635', '#fb923c'][i() % 8]}
                    onChange={(v) => {
                      actions.setKnobProp(kn.id, { value: v })
                      const m = kn.address.match(/\/ch\/(\d+)/)
                      if (m) void engine.sendImmediate([chMessage(Number(m[1]), v)])
                    }}
                    onReset={() => {
                      actions.setKnobProp(kn.id, { value: kn.reset })
                      const m = kn.address.match(/\/ch\/(\d+)/)
                      if (m) void engine.sendImmediate([chMessage(Number(m[1]), kn.reset)])
                    }}
                  />
                )}
              </For>
            </div>
          </div>
          <div>
            <h3 class="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              XY pad
            </h3>
            <XYPad />
          </div>
          <div class="rounded-lg border border-white/10 bg-black/25 p-2">
            <div class="mb-1 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
              Track envelope triggers
            </div>
            <div class="flex flex-wrap gap-1">
              <Show
                when={store.project.tracks.filter((t) => t.env.enabled).length > 0}
                fallback={
                  <span class="text-[10px] text-zinc-600">
                    Enable an envelope on a track (Inspector ▸ Env) to see trigger buttons here.
                  </span>
                }
              >
                <For each={store.project.tracks.filter((t) => t.env.enabled)}>
                  {(t) => (
                    <button
                      class="rounded border px-2 py-1 text-[10px]"
                      style={{ 'border-color': `${t.color}66`, color: t.color }}
                      onClick={() => engine.triggerEnv(t.id)}
                    >
                      ⚡ {t.name}
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { actions, store } from '@/store/useAnimator'
import { engine } from '@/lib/animation/engine'
import type { LfoWave, LfoMode } from '@/lib/animation/types'

// ─── Inspector: Key props / LFO / Env / OSC ───────────────────────────────────

function NumField(props: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
}) {
  return (
    <label class="block">
      <span class="mb-0.5 block font-mono text-[9px] uppercase tracking-wider text-zinc-500">
        {props.label}
      </span>
      <input
        type="number"
        step={props.step ?? 0.01}
        min={props.min}
        max={props.max}
        value={Number.isFinite(props.value) ? props.value : 0}
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
        class="w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-cyan-400/50"
      />
      <Show when={props.suffix}>
        <span class="sr-only">{props.suffix}</span>
      </Show>
    </label>
  )
}

export default function Inspector() {
  const [tab, setTab] = createSignal<'key' | 'lfo' | 'env' | 'osc'>('key')

  const track = createMemo(
    () => store.project.tracks.find((t) => store.selection.trackIds.includes(t.id)) ?? null
  )
  const selKeyIds = createMemo(() => {
    const tr = track()
    return tr ? store.selection.keyIds[tr.id] ?? [] : []
  })
  const selKeys = createMemo(() => {
    const tr = track()
    return tr ? tr.keys.filter((k) => selKeyIds().includes(k.id)) : []
  })
  const one = createMemo(() => {
    const ks = selKeys()
    return ks.length === 1 ? ks[0] : null
  })

  // live monitor tail
  const [monitorTail, setMonitorTail] = createSignal<string[]>([])
  const [stats, setStats] = createSignal({ sent: 0, errors: 0, rate: 0, lastError: null as string | null })
  onMount(() => {
    const id = window.setInterval(() => {
      setMonitorTail(engine.monitor.slice(-14).reverse().map((m) => m.text))
      setStats({
        sent: engine.stats.sent,
        errors: engine.stats.errors,
        rate: engine.stats.msgRate,
        lastError: engine.stats.lastError,
      })
    }, 500)
    onCleanup(() => window.clearInterval(id))
  })

  return (
    <div class="flex h-full min-h-0 flex-col">
      {/* tabs */}
      <div class="flex border-b border-white/5 text-[10px]">
        <For
          each={[
            ['key', 'Key'],
            ['lfo', 'LFO'],
            ['env', 'Env'],
            ['osc', 'OSC'],
          ] as const}
        >
          {([id, label]) => (
            <button
              class={`flex-1 py-2 font-mono uppercase tracking-wider ${
                tab() === id
                  ? 'border-b-2 border-cyan-400 text-cyan-300'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          )}
        </For>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        {/* ── KEY ── */}
        <Show when={tab() === 'key'}>
          <div class="space-y-3">
            <Show when={!track()}>
              <p class="text-[11px] leading-relaxed text-zinc-500">
                Select a track in the list (or a key in the editor) to inspect it.
                <br />
                <br />
                <span class="text-zinc-400">Shortcuts:</span> K add key · S snap · F frame
                selected · A frame all · 1-4 interpolation · Space play · Dbl-click canvas adds a
                key.
              </p>
            </Show>
            <Show when={track()} keyed>
              {(tr) => (
                <Show when={selKeys().length === 0}>
                  <div class="space-y-2 text-[11px] text-zinc-400">
                    <div class="font-medium text-zinc-200">{tr.name}</div>
                    <p class="text-zinc-500">
                      {tr.keys.length} keys ·{' '}
                      {tr.target.kind === 'ch' ? `/ch/${tr.target.n}` : `/cc`}
                    </p>
                    <div class="grid grid-cols-2 gap-2">
                      <button
                        class="rounded border border-white/10 bg-white/5 py-1 hover:bg-white/10"
                        onClick={() => actions.addKeyAtTime(tr.id, engine.time)}
                      >
                        + Key @ playhead
                      </button>
                      <button
                        class="rounded border border-white/10 bg-white/5 py-1 hover:bg-white/10"
                        onClick={() => engine.triggerEnv(tr.id)}
                        disabled={!tr.env.enabled}
                        title={tr.env.enabled ? 'Fire envelope' : 'Enable Env first'}
                      >
                        Trigger env
                      </button>
                    </div>
                  </div>
                </Show>
              )}
            </Show>
            <Show when={one()} keyed>
              {(k) => (
                <Show when={track()} keyed>
                  {(tr) => (
                    <div class="space-y-3">
                      <div class="text-[11px] font-medium text-zinc-200">{tr.name}</div>
                      <div class="grid grid-cols-2 gap-2">
                        <NumField
                          label="Time (s)"
                          value={k.t}
                          step={0.01}
                          onChange={(v) =>
                            actions.setKeys(
                              tr.id,
                              tr.keys.map((kk) => (kk.id === k.id ? { ...k, t: Math.max(0, v) } : kk))
                            )
                          }
                        />
                        <NumField
                          label="Value"
                          value={k.v}
                          onChange={(v) =>
                            actions.setKeys(
                              tr.id,
                              tr.keys.map((kk) => (kk.id === k.id ? { ...k, v } : kk))
                            )
                          }
                        />
                      </div>
                      <div>
                        <span class="mb-1 block font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                          Interpolation
                        </span>
                        <div class="grid grid-cols-4 gap-1">
                          <For each={['bezier', 'auto', 'linear', 'stepped'] as const}>
                            {(i) => (
                              <button
                                class={`rounded border py-1 text-[10px] ${
                                  k.interp === i
                                    ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-300'
                                    : 'border-white/10 text-zinc-400 hover:bg-white/10'
                                }`}
                                onClick={() => actions.setSelectedInterp(i)}
                              >
                                {i}
                              </button>
                            )}
                          </For>
                        </div>
                      </div>
                      <Show when={k.interp === 'bezier'}>
                        <div class="grid grid-cols-2 gap-2">
                          <NumField
                            label="Out dt"
                            value={k.ho?.dt ?? 0}
                            onChange={(v) =>
                              actions.setKeys(
                                tr.id,
                                tr.keys.map((kk) =>
                                  kk.id === k.id ? { ...k, ho: { dt: Math.max(0, v), dv: k.ho?.dv ?? 0 } } : kk
                                )
                              )
                            }
                          />
                          <NumField
                            label="Out dv"
                            value={k.ho?.dv ?? 0}
                            onChange={(v) =>
                              actions.setKeys(
                                tr.id,
                                tr.keys.map((kk) =>
                                  kk.id === k.id ? { ...k, ho: { dt: k.ho?.dt ?? 0.3, dv: v } } : kk
                                )
                              )
                            }
                          />
                        </div>
                      </Show>
                      <button
                        class="w-full rounded border border-rose-400/30 bg-rose-400/10 py-1 text-[10px] text-rose-300 hover:bg-rose-400/20"
                        onClick={() => actions.deleteSelectedKeys()}
                      >
                        Delete key
                      </button>
                    </div>
                  )}
                </Show>
              )}
            </Show>
            <Show when={selKeys().length > 1}>
              <div class="space-y-2 text-[11px] text-zinc-400">
                <div>{selKeys().length} keys selected on {track()?.name}</div>
                <div class="grid grid-cols-2 gap-1">
                  <For each={['bezier', 'auto', 'linear', 'stepped'] as const}>
                    {(i) => (
                      <button
                        class="rounded border border-white/10 py-1 text-[10px] hover:bg-white/10"
                        onClick={() => actions.setSelectedInterp(i)}
                      >
                        → {i}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        {/* ── LFO ── */}
        <Show when={tab() === 'lfo'}>
          <div class="space-y-3">
            <Show when={!track()}>
              <p class="text-[11px] text-zinc-500">Select a track first.</p>
            </Show>
            <Show when={track()} keyed>
              {(tr) => (
                <>
                  <div class="flex items-center justify-between">
                    <span class="text-[11px] font-medium text-zinc-200">{tr.name}</span>
                    <label class="flex cursor-pointer items-center gap-1.5 text-[10px] text-zinc-400">
                      <input
                        type="checkbox"
                        checked={tr.lfo.enabled}
                        onChange={(e) => actions.setTrackLfo(tr.id, { enabled: e.currentTarget.checked })}
                        class="accent-cyan-400"
                      />
                      on
                    </label>
                  </div>
                  <div>
                    <span class="mb-1 block font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                      Waveform
                    </span>
                    <div class="grid grid-cols-3 gap-1">
                      <For each={['sine', 'tri', 'sawUp', 'sawDown', 'square', 'noise'] as LfoWave[]}>
                        {(w) => (
                          <button
                            class={`rounded border py-1 text-[10px] ${
                              tr.lfo.wave === w
                                ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-300'
                                : 'border-white/10 text-zinc-400 hover:bg-white/10'
                            }`}
                            onClick={() => actions.setTrackLfo(tr.id, { wave: w })}
                          >
                            {w}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                  <div>
                    <span class="mb-1 block font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                      Mode
                    </span>
                    <div class="grid grid-cols-3 gap-1">
                      <For each={['add', 'mul', 'replace'] as LfoMode[]}>
                        {(m) => (
                          <button
                            class={`rounded border py-1 text-[10px] ${
                              tr.lfo.mode === m
                                ? 'border-fuchsia-400/60 bg-fuchsia-400/15 text-fuchsia-300'
                                : 'border-white/10 text-zinc-400 hover:bg-white/10'
                            }`}
                            onClick={() => actions.setTrackLfo(tr.id, { mode: m })}
                          >
                            {m}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                  <label class="block font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                    Sync to BPM
                    <input
                      type="checkbox"
                      checked={tr.lfo.bpmSync}
                      onChange={(e) => actions.setTrackLfo(tr.id, { bpmSync: e.currentTarget.checked })}
                      class="ml-2 accent-cyan-400"
                    />
                  </label>
                  {tr.lfo.bpmSync ? (
                    <NumField
                      label="Beats / cycle"
                      value={tr.lfo.beats}
                      step={0.5}
                      min={0.25}
                      onChange={(v) => actions.setTrackLfo(tr.id, { beats: v })}
                    />
                  ) : (
                    <NumField
                      label="Rate (Hz)"
                      value={tr.lfo.rate}
                      step={0.05}
                      min={0.01}
                      onChange={(v) => actions.setTrackLfo(tr.id, { rate: Math.max(0.01, v) })}
                    />
                  )}
                  <div class="grid grid-cols-2 gap-2">
                    <NumField
                      label="Phase"
                      value={tr.lfo.phase}
                      step={0.05}
                      min={0}
                      max={1}
                      onChange={(v) => actions.setTrackLfo(tr.id, { phase: Math.min(1, Math.max(0, v)) })}
                    />
                    <NumField
                      label="Amount"
                      value={tr.lfo.amount}
                      step={0.05}
                      min={0}
                      max={1}
                      onChange={(v) => actions.setTrackLfo(tr.id, { amount: Math.min(1, Math.max(0, v)) })}
                    />
                  </div>
                  <p class="text-[9px] leading-snug text-zinc-500">
                    Dashed curve in the editor shows the modulated output. In SlopShady, bind{' '}
                    {tr.target.kind === 'ch' ? `/ch/${tr.target.n}` : '/cc'} via OSC-Learn.
                  </p>
                </>
              )}
            </Show>
          </div>
        </Show>

        {/* ── ENV ── */}
        <Show when={tab() === 'env'}>
          <div class="space-y-3">
            <Show when={!track()}>
              <p class="text-[11px] text-zinc-500">Select a track first.</p>
            </Show>
            <Show when={track()} keyed>
              {(tr) => (
                <>
                  <div class="flex items-center justify-between">
                    <span class="text-[11px] font-medium text-zinc-200">{tr.name}</span>
                    <label class="flex cursor-pointer items-center gap-1.5 text-[10px] text-zinc-400">
                      <input
                        type="checkbox"
                        checked={tr.env.enabled}
                        onChange={(e) => actions.setTrackEnv(tr.id, { enabled: e.currentTarget.checked })}
                        class="accent-fuchsia-400"
                      />
                      on
                    </label>
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <NumField label="Attack s" value={tr.env.attack} step={0.01} min={0} onChange={(v) => actions.setTrackEnv(tr.id, { attack: Math.max(0, v) })} />
                    <NumField label="Decay s" value={tr.env.decay} step={0.01} min={0} onChange={(v) => actions.setTrackEnv(tr.id, { decay: Math.max(0, v) })} />
                    <NumField label="Sustain" value={tr.env.sustain} step={0.05} min={0} max={1} onChange={(v) => actions.setTrackEnv(tr.id, { sustain: Math.min(1, Math.max(0, v)) })} />
                    <NumField label="Hold s" value={tr.env.hold} step={0.05} min={0} onChange={(v) => actions.setTrackEnv(tr.id, { hold: Math.max(0, v) })} />
                    <NumField label="Release s" value={tr.env.release} step={0.05} min={0} onChange={(v) => actions.setTrackEnv(tr.id, { release: Math.max(0.001, v) })} />
                    <NumField label="Amount" value={tr.env.amount} step={0.05} min={0} max={1} onChange={(v) => actions.setTrackEnv(tr.id, { amount: Math.min(1, Math.max(0, v)) })} />
                  </div>
                  <button
                    class="w-full rounded border border-fuchsia-400/40 bg-fuchsia-400/15 py-1.5 text-[11px] text-fuchsia-200 hover:bg-fuchsia-400/25"
                    onClick={() => engine.triggerEnv(tr.id)}
                  >
                    ⚡ Trigger envelope
                  </button>
                  <p class="text-[9px] leading-snug text-zinc-500">
                    One-shot ADSR that scales the curve output. Fire it from clips (Perform view) or
                    the button above.
                  </p>
                </>
              )}
            </Show>
          </div>
        </Show>

        {/* ── OSC ── */}
        <Show when={tab() === 'osc'}>
          <div class="space-y-3">
            <div class="grid grid-cols-[1fr_70px] gap-2">
              <label class="block">
                <span class="mb-0.5 block font-mono text-[9px] uppercase tracking-wider text-zinc-500">Host</span>
                <input
                  class="w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] outline-none focus:border-cyan-400/50"
                  value={store.project.osc.host}
                  onInput={(e) => actions.setOsc({ host: e.currentTarget.value })}
                />
              </label>
              <NumField label="Port" value={store.project.osc.port} step={1} min={1} max={65535} onChange={(v) => actions.setOsc({ port: Math.round(v) })} />
            </div>
            <label class="flex items-center justify-between rounded border border-white/10 bg-black/30 px-2 py-1.5">
              <span class="text-[11px] text-zinc-300">
                Live send
                <span class="block text-[9px] text-zinc-500">off = simulate + log only</span>
              </span>
              <input
                type="checkbox"
                checked={store.project.osc.live}
                onChange={(e) => actions.setOsc({ live: e.currentTarget.checked })}
                class="h-4 w-4 accent-emerald-400"
              />
            </label>
            <label class="flex items-center justify-between rounded border border-white/10 bg-black/30 px-2 py-1.5">
              <span class="text-[11px] text-zinc-300">
                Armed
                <span class="block text-[9px] text-zinc-500">master output switch</span>
              </span>
              <input
                type="checkbox"
                checked={store.project.osc.armed}
                onChange={(e) => actions.setOsc({ armed: e.currentTarget.checked })}
                class="h-4 w-4 accent-emerald-400"
              />
            </label>
            <label class="flex items-center justify-between rounded border border-white/10 bg-black/30 px-2 py-1.5">
              <span class="text-[11px] text-zinc-300">
                #bundle packets
                <span class="block text-[9px] text-zinc-500">one UDP packet per tick</span>
              </span>
              <input
                type="checkbox"
                checked={store.project.osc.bundle}
                onChange={(e) => actions.setOsc({ bundle: e.currentTarget.checked })}
                class="h-4 w-4 accent-emerald-400"
              />
            </label>
            <label class="block">
              <span class="mb-1 flex justify-between font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                Send rate <span class="text-zinc-400">{store.project.osc.rate} Hz</span>
              </span>
              <input
                type="range"
                min={10}
                max={120}
                step={5}
                value={store.project.osc.rate}
                onInput={(e) => actions.setOsc({ rate: Number(e.currentTarget.value) })}
                class="w-full accent-cyan-400"
              />
            </label>
            <button
              class="w-full rounded border border-cyan-400/40 bg-cyan-400/10 py-1.5 text-[11px] text-cyan-300 hover:bg-cyan-400/20"
              onClick={() =>
                void engine.sendImmediate([
                  { address: '/ch/1', args: [{ type: 'f', value: 0 }] },
                  { address: '/ch/1', args: [{ type: 'f', value: 1 }] },
                ])
              }
            >
              Send test pulse /ch/1
            </button>
            <div class="rounded border border-white/10 bg-black/30 p-2">
              <div class="mb-1 flex justify-between font-mono text-[9px] uppercase text-zinc-500">
                <span>Monitor</span>
                <span>
                  {stats().rate}/s · {stats().sent} sent{stats().errors > 0 ? ` · ${stats().errors} err` : ''}
                </span>
              </div>
              <div class="h-40 overflow-y-auto font-mono text-[9px] leading-relaxed">
                <Show when={monitorTail().length === 0}>
                  <div class="text-zinc-600">no traffic yet — press Play</div>
                </Show>
                <For each={monitorTail()}>
                  {(line, i) => (
                    <div class={i() === 0 ? 'text-cyan-300' : 'text-zinc-500'}>
                      {line}
                    </div>
                  )}
                </For>
              </div>
              <Show when={stats().lastError}>
                <div class="mt-1 rounded bg-rose-500/10 px-1.5 py-1 text-[9px] text-rose-300">
                  {stats().lastError}
                </div>
              </Show>
            </div>
            <p class="text-[9px] leading-relaxed text-zinc-500">
              UDP packets leave from wherever this app&apos;s server runs. To drive SlopShady on
              your own machine, run SlopMotion locally (see Help ▸ Run locally).
            </p>
          </div>
        </Show>
      </div>
    </div>
  )
}

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'

// ─── Help dialog: shortcuts, OSC reference, run-locally ──────────────────────

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['K / ⇧K', 'Add key at playhead (selected / all tracks)'],
  ['Dbl-click canvas', 'Add key at that time & value'],
  ['1 2 3 4', 'Interpolation: bezier / auto / linear / stepped'],
  ['5', 'Flatten handles'],
  ['⌘C / ⌘V', 'Copy / paste keys (pastes at playhead)'],
  ['⌫', 'Delete selected keys'],
  ['← → ↑ ↓', 'Nudge keys (⇧ = ×8 / ×0.1 steps)'],
  ['F / A', 'Frame selected / frame all'],
  ['S', 'Toggle snapping'],
  ['L', 'Toggle loop'],
  ['⌘Z / ⇧⌘Z', 'Undo / redo'],
  ['Drag empty', 'Box-select keys'],
  ['Alt+drag / middle / Space', 'Pan'],
  ['Wheel / ⇧Wheel', 'Zoom time / zoom value'],
  ['⇧ while handle-drag', 'Snap handle to 45°'],
  ['Dbl-click handle', 'Flatten that handle'],
  ['Q W E R A S D F', 'Launch clips (Perform tab)'],
]

const OSC_TABLE: [string, string, string][] = [
  ['/ch/{n}', 'float', 'Generic continuous source — any address works; value spans the track min..max range'],
  ['/noteon', 'int ch, note, vel', 'Note-on into the voice/note system'],
  ['/noteoff', 'int ch, note', 'Note-off'],
]

export default function HelpDialog(props: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent class="max-h-[85vh] max-w-2xl overflow-y-auto border-white/10 bg-[#14141f] text-zinc-200">
        <DialogHeader>
          <DialogTitle class="text-white">SlopMotion — OSC animation</DialogTitle>
          <DialogDescription class="text-zinc-400">
            A keyframe timeline + graph editor that streams OSC over UDP (default 127.0.0.1:8101)
            to any OSC receiver.
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-5 text-[12px] leading-relaxed">
          <section>
            <h3 class="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-cyan-300">
              Workflow
            </h3>
            <ol class="list-decimal space-y-1 pl-5 text-zinc-300">
              <li>
                In your OSC software, enable OSC learning/assignment and bind{' '}
                <code class="rounded bg-black/50 px-1 font-mono text-[11px]">/ch/1…N</code>{' '}
                to the parameters you want to animate (code dials, transforms, brightness…).
              </li>
              <li>
                Here: set each track&apos;s OSC target address (track ▸ ⌄), or hit <b>Learn</b> to
                pulse an address while you bind it.
              </li>
              <li>
                Keyframe curves (bezier/auto/linear/stepped + ease presets), stack per-track LFOs
                and ADSR envelopes, then press Play — values stream at 30–120 Hz.
              </li>
              <li>
                Perform tab: fire clips (QWER/ASDF), jam on knobs and the XY pad — they send
                immediately, independent of the timeline.
              </li>
            </ol>
          </section>

          <section>
            <h3 class="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-cyan-300">
              Run locally
            </h3>
            <p class="mb-1.5 text-zinc-300">
              The browser can&apos;t send raw UDP, so packets leave from this app&apos;s server
              process. To drive OSC software on your machine, run SlopMotion next to it:
            </p>
            <pre class="overflow-x-auto rounded-lg border border-white/10 bg-black/60 p-3 font-mono text-[11px] text-emerald-300">
{`# run the desktop app (GUI control panel)
npm run build && cargo run --release --manifest-path app/Cargo.toml -- --open
# headless / supervisor mode
cargo run --release --manifest-path app/Cargo.toml -- --no-gui
# development (hot reload, OSC via HTTP fallback)
npm run dev`}
            </pre>
            <p class="mt-1.5 text-zinc-500">
              Use Export/Import JSON to move projects between this preview and your local copy.
              Everything (tracks, curves, clips, knobs) is included.
            </p>
          </section>

          <section>
            <h3 class="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-cyan-300">
              OSC addresses
            </h3>
            <div class="overflow-hidden rounded-lg border border-white/10">
              <table class="w-full text-left font-mono text-[10.5px]">
                <thead class="bg-white/5 text-zinc-400">
                  <tr>
                    <th class="px-2 py-1.5">Address</th>
                    <th class="px-2 py-1.5">Args</th>
                    <th class="px-2 py-1.5 font-sans">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {OSC_TABLE.map(([a, args, desc]) => (
                    <tr class="border-t border-white/5">
                      <td class="px-2 py-1.5 text-cyan-300">{a}</td>
                      <td class="px-2 py-1.5 text-amber-300">{args}</td>
                      <td class="px-2 py-1.5 font-sans text-zinc-400">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 class="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-cyan-300">
              Keyboard shortcuts
            </h3>
            <div class="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
              {SHORTCUTS.map(([key, desc]) => (
                <div class="flex items-baseline justify-between gap-2 border-b border-white/5 py-1">
                  <kbd class="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                    {key}
                  </kbd>
                  <span class="text-right text-[11px] text-zinc-400">{desc}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

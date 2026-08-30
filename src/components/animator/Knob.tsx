import { Show, createMemo } from 'solid-js'

// ─── Draggable knob (vertical drag) ───────────────────────────────────────────

export default function Knob(props: {
  label: string
  address: string
  value: number // 0..1 normalized
  min: number
  max: number
  color?: string
  size?: number
  onChange: (v01: number) => void
  onReset?: () => void
}) {
  const size = props.size ?? 64
  let drag: { y: number; v: number } | null = null
  const norm = createMemo(() =>
    Math.min(1, Math.max(0, (props.value - props.min) / Math.max(1e-9, props.max - props.min)))
  )

  const onPointerDown = (e: PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag = { y: e.clientY, v: norm() }
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag
    if (!d) return
    const speed = e.shiftKey ? 0.001 : 0.005
    const nv = Math.min(1, Math.max(0, d.v + (d.y - e.clientY) * speed))
    props.onChange(props.min + nv * (props.max - props.min))
  }
  const onPointerUp = (e: PointerEvent) => {
    drag = null
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  // arc geometry: 135° sweep from lower-left to lower-right
  const startA = ((135 + 90) * Math.PI) / 180
  const endA = ((405 - 0.001) * Math.PI) / 180
  const angle = () => startA + (endA - startA) * norm()
  const r = size / 2 - 6
  const cx = size / 2
  const cy = size / 2
  const arc = (from: number, to: number) => {
    const x0 = cx + r * Math.cos(from)
    const y0 = cy + r * Math.sin(from)
    const x1 = cx + r * Math.cos(to)
    const y1 = cy + r * Math.sin(to)
    const large = to - from > Math.PI ? 1 : 0
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`
  }

  return (
    <div class="flex select-none flex-col items-center gap-1">
      <svg
        width={size}
        height={size}
        class="cursor-ns-resize touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDblClick={props.onReset}
      >
        <circle cx={cx} cy={cy} r={r - 7} fill="#14141f" stroke="rgba(255,255,255,0.08)" />
        <path
          d={arc(startA, endA)}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          stroke-width={3}
          stroke-linecap="round"
        />
        <Show when={norm() > 0.003}>
          <path
            d={arc(startA, angle())}
            fill="none"
            stroke={props.color ?? '#22d3ee'}
            stroke-width={3}
            stroke-linecap="round"
            style={{ filter: `drop-shadow(0 0 3px ${props.color ?? '#22d3ee'})` }}
          />
        </Show>
        <circle
          cx={cx + (r - 10) * Math.cos(angle())}
          cy={cy + (r - 10) * Math.sin(angle())}
          r={3}
          fill={props.color ?? '#22d3ee'}
        />
        <text x={cx} y={cy + 3} text-anchor="middle" class="fill-zinc-200 font-mono" font-size="10">
          {(props.min + norm() * (props.max - props.min)).toFixed(2)}
        </text>
      </svg>
      <div class="text-center leading-tight">
        <div class="text-[10px] text-zinc-300">{props.label}</div>
        <div class="font-mono text-[8px] text-zinc-500">{props.address}</div>
      </div>
    </div>
  )
}

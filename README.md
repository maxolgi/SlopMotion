# SlopMotion

A keyframe timeline + graph editor that streams OSC over UDP — built for driving
lights, visuals, and sound gear from your browser.

The web UI is a SolidJS app; a small Rust server wraps it into a standalone
desktop app. Browsers can't send raw UDP, so the server process relays the
packets to any OSC receiver on your machine or LAN.

## Features

- **Curve editor** — bezier / auto / linear / stepped interpolation, ease
  presets, box-select, copy/paste, undo/redo, snapping, zoom & pan
- **Modulation** — per-track LFOs and ADSR envelopes stacked on top of curves
- **Perform mode** — fire clips (QWER / ASDF), jam on knobs and an XY pad,
  independent of the timeline
- **OSC** — free-form target addresses per track, Learn mode for binding via
  OSC-learning receivers, configurable host / port / rate / bundling
  (default `127.0.0.1:8101`)
- **Projects** — autosave to the browser, full export / import as JSON

## Run it

Requirements: Node ≥ 18 (and a Rust toolchain for the desktop build).

```sh
npm install

# development (hot reload; OSC sent via the dev server's HTTP fallback)
npm run dev

# standalone desktop app (GUI control panel, OSC over UDP)
npm run build
cargo run --release --manifest-path app/Cargo.toml -- --open

# headless server (for process supervisors)
cargo run --release --manifest-path app/Cargo.toml -- --no-gui
```

The server listens on `http://localhost:3000` by default (`--port` / `--bind`
to change). Open your OSC receiver, enable OSC learn, and bind `/ch/1…N` (or
any address) to the parameters you want to animate.

Use Export / Import JSON in the toolbar to move projects between machines.

## Development

```sh
npm run test       # unit tests (vitest)
npm run typecheck  # tsc --noEmit
```

Web frontend: `src/` (SolidJS + Tailwind). Standalone server / UDP relay /
GUI: `app/` (Rust, axum + rosc, optional eframe GUI).

## License

[AGPL-3.0-or-later](./LICENSE)

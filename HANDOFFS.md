# HANDOFFS

The most recent handoff is at the **top**. When you stop work, prepend a new
dated section so the next agent can pick up cleanly. Keep it concise and current.

---

## 2026-06-14 — Playtest overhaul: belts, scope, primer, probes, ground, reset/speed

**State:** 🟢 Green; pushed. A large pass on the look + feel from hands-on feedback
("think Factorio with belts, but electricity"):
- **HiDPI** rendering (devicePixelRatio + autoDensity) — no more blur.
- **Belts:** traces route at 90° (`wireRoute`), are coloured by net voltage
  (`voltageColor`), and carry flow chevrons whose direction + density track the
  current (`redrawWires`, redrawn each frame off the live snapshot).
- **Scope** rewritten: per-tick samples (freezes on pause, scrubs with the
  timeline), a cursor line, numbered V axis + tick label.
- **Reset Run** (↺) + `loop.restart()`; **fractional** ticks-per-frame and a much
  slower default (0.25×).
- **Ground** symbol + "GND 0 V" at the source's node-0 pin (`drawGround`).
- **Panel** unified: the guided panel floats over the board (`.guided-overlay`)
  so the Parts bin stays visible; a **"Voltage & Current" primer** opens running
  (the first thing you see is current flowing) with a dismissible intro banner.
- **Probes** are now draggable leads that snap to a **pin or a trace**
  (`ProbePoint`, `snapProbe`, `measurePress`); a pin-attached lead follows the part.

### Now also done
- **Component rotation** shipped (R hotkey + Rotate button): `rot` on the component,
  rotated `pinCell`/`componentBox`, a rotated glyph sub-container with upright labels;
  connectivity is unchanged so the sim isn't reset. **Watch starts paused** now.
- **Mode-flow brainstorm** captured in `docs/ui/mode-flow.md` — collapse
  Select/Place/Wire into one armed-part "Build" mode + a Measure tool (Factorio-style).
  Phase 0 (small, mostly deletes the mode buttons) is the next UX task.

---

## 2026-06-14 — Pedagogy demos: "across/through" readout, DMM probe, divider R2 toggle, concept beats

**State:** 🟢 Green; pushed. A "show don't tell" layer over the board + examples:
- **Live readout on select** (`board.ts` ComponentNode `meter`): selecting a part shows its
  **V across · I through** — watch the RC cap's current fall to 0 (an open at DC, not a short).
- **DMM probe** — Measure mode in `board.ts`: red (+) / steel (−) leads with needle tips and
  handle knobs. Click two pins → live **ΔV** between them; one pin → vs GND. App passes the
  pin→net map via `board.setProbeNodes(netlist.nodesOfComponent)`. Teaches "voltage is a
  difference across two points / ground is just the reference you picked."
- **Divider R2-to-ground toggle** (`examples.ts` `demo` + App `toggleDemo`): lifts/restores
  R2's ground wire — OFF floats the output to the full rail (no current), ON divides to 3.33 V.
- **Guided concept beat:** the Build panel shows "Open loop — no current" until you close it
  to ground, then "Loop closed — current flows", matching the readouts that sit at 0 until then.

Next demonstrative ideas: extend demos to RC/RL (short the cap / open the coil); a movable
probe that snaps to whole nets; per-part value editing so learners can sweep R/C/L live.

---

## 2026-06-14 — Interactive board comes alive: viewport, scrubber, selection, solver, examples + guided build

**State:** 🟢 Green (cargo fmt/clippy/test, build:wasm, web check/lint/build). Pushed to
`claude/kind-turing-hdelb3` (ahead of `main`; no new PR opened this session).

### What's new
- **Viewport:** wheel zoom (to cursor) + pan (drag empty space / middle-drag) via a
  transformable `world` container in `web/src/lib/board.ts`.
- **Voltage source + values:** ideal `V` in the bin; every part carries a value + unit;
  `graph.ts` gains serialize/restore (used by undo + examples).
- **Time:** paused by default; a bottom **tick scrubber** (per-tick step back/forward)
  backed by a bounded snapshot history in `loop.ts`.
- **Editing:** click / shift+ctrl multi-select with highlight, **Delete**, **Ctrl+Z** undo
  (undo stack in `board.ts`).
- **Animated glyphs** (`web/src/lib/glyphs.ts`): R/C/L/V draw their schematic symbol plus a
  state-driven animation (current flow, charge fill, field halo, source pulse).
- **Solver wired:** `web/src/lib/netlist.ts` compiles the `BoardGraph` into the MNA netlist
  (ground = the first voltage source's − net). `sim-core` is generalized to an arbitrary
  ideal netlist (`set_netlist` / `node_voltages` / `element_currents`); golden
  `0x6d055513f0613902`. Per-element current/voltage feeds the glyph animations, so placed
  circuits and examples **simulate for real**.
- **Examples** (`web/src/lib/examples.ts`): a Parts/Examples tab; each example offers
  **Watch** (load + run) and **Build** (guided, auto-advancing checklist with a "why" per
  step) — Voltage Divider, RC, RL.

### Seam notes / gotchas
- The netlist is rebuilt only when topology or a value changes (a `sig`), so dragging parts
  never resets the sim. An empty board keeps the built-in demo RC; parts with no source go
  quiet (ground-only netlist).
- `state()` is now node voltages (variable length, index 0 = ground); telemetry labels are
  node-indexed.
- Ground convention: the net on the **first voltage source's − pin**. No dedicated GND part yet.
- `cap_voltage()` was removed from the wasm API (it was RC-specific); nothing in web used it.

### Pick up here
- Top of `TODOS.md`: a value-editing inspector, the diode (nonlinear), the power-bus visual
  language on wires, the digital/MCU engines, and the first graded challenge.
- GitHub Pages still needs the owner to flip Settings → Pages → Source: GitHub Actions.

---

## 2026-06-14 — PR #1 opened, Pages wired, bus visual-language reference added

- **PR #1** opened (`claude/kind-turing-hdelb3` → `main`):
  https://github.com/nathanfraske/CEC-Electronic-Game/pull/1
- **GitHub Pages** deploy added (`.github/workflows/pages.yml` + env-driven Vite
  `base`). After merge and enabling Pages (Settings → Pages → Source: GitHub
  Actions), the site deploys to https://nathanfraske.github.io/CEC-Electronic-Game/.
- **Bus visual language**: the owner provided a draft reference for showing
  voltage and current — `docs/ui/dc-bus-reference.html` (interactive) distilled
  into `docs/ui/visual-language.md`. Voltage = net level (height + rail color +
  number); current = flow + thickness + number; KCL at taps; IR-drop sag. Draft,
  not final. Implement in the PixiJS renderer once the board graph feeds the solver.

---

## 2026-06-14 — Parallel panel landed: M1 + M2 + design polish

**State:** 🟢 Green. Three parallel agents (isolated git worktrees) integrated
cleanly into this branch; the full gate suite passes on the integrated tree.

### What changed since the bootstrap
- **M2 — analog core (Lane A).** `crates/sim-core` now runs a real deterministic
  analog engine: backward-Euler companion models assembled by Modified Nodal
  Analysis, solved each fixed tick by a bounded dense Gaussian elimination
  (fixed order, partial pivot). Circuit = RC charge (V → R → C → gnd).
  `state()` = `[v(n1), v(cap), i(src), v(rail)]` (volts/amps). Committed golden
  `0x92349dbbbf5a8293` (seed 42, 1000 steps). `sim-wasm` adds `cap_voltage()`;
  all prior method names unchanged.
- **M1 — interactive board (Lane B).** `web/src/lib/graph.ts` (board model) plus
  a rewritten `board.ts` (PixiJS scene + input). Drag a part from the bin to
  place it, click-drag pin→pin to wire, drag to move, right-click to delete,
  Select/Place/Wire mode toggle + Clear. Renderer & telemetry iterate the live
  `state().length` (no hardcoded channel count).
- **Polish (Lane C).** Fonts self-hosted under `web/public/fonts/` (Google CDN
  removed); CRT/scanline scope frame, full button/chip/telemetry state matrices,
  neon glows, `prefers-reduced-motion`. Token values unchanged.

### ⚠️ Important seam for the next agent
The interactive board and the simulator are **not yet connected.** The core
solves a *fixed* RC circuit; placing/wiring parts builds a `BoardGraph` that is
**not yet fed to the solver.** The top backlog item is to compile the board
graph into a netlist the core solves (see `TODOS.md`).

### Integration mechanics (FYI)
Each lane worked in an isolated worktree branched from the bootstrap base and was
cherry-picked here (the lanes touched disjoint files, so no conflicts). The
ephemeral worktrees under `.claude/worktrees/` are gitignored and were removed
after integration.

How to verify is unchanged (see CLAUDE.md). Branch `claude/kind-turing-hdelb3`; no PR opened.

---

## 2026-06-14 — Repository bootstrap + first design pass

**State:** 🟢 Green. Every verification gate passes from a clean checkout.

### What exists now
- **Cargo workspace** (`Cargo.toml`) with three crates:
  - `crates/sim-core` — deterministic fixed-step placeholder `Sim`, FNV-1a
    `snapshot_hash`, `run_is_reproducible` test, ignored `print_golden`. Added a
    read-only `state()` accessor for rendering (does not affect determinism).
  - `crates/sim-protocol` — wire types only (`PROTOCOL_VERSION`, `NodeId`, `PinId`).
  - `crates/sim-wasm` — wasm-bindgen `Simulation` exposing
    `step/tick/state/protocol_version/snapshot_hash`. `wasm-opt` disabled here.
- **Web app** (`web/`) — Vite 8 + Svelte 5 + TS + PixiJS 8. CEC-styled HUD:
  component bin (tech-tree preview), oscilloscope board rendering the live
  deterministic snapshot as auto-ranged traces, telemetry panel, and transport
  controls (run/pause/step + 1×/4×/16×/64× speed). The JS↔wasm boundary is
  crossed once per frame in `web/src/sim/loop.ts`.
- **Design system** mirrored from criticalerrorcomputing.com — tokens in
  `web/src/app.css`, hex mirrors in `web/src/lib/board.ts`.
- **CI** `.github/workflows/ci.yml` (`rust-core`, `web-build`).
- **Docs** `docs/architecture.md`, `docs/determinism.md`, `docs/adr/0001-tech-stack.md`,
  and `docs/game-design.md` (pillars, tech tree, challenge/grading, milestones M0–M5).
  Legal: `LICENSE` (canonical Apache-2.0), `NOTICE`, `README.md`, `CONTRIBUTING.md`.
- **Self-heal hook** `.claude/hooks/` + `.claude/settings.json` — installs the
  wasm toolchain on ephemeral containers and surfaces these docs at session start.

### How to verify (full list in CLAUDE.md)
```
cargo fmt --all -- --check
cargo clippy -p sim-core -p sim-protocol --all-targets -- -D warnings
cargo test -p sim-core -p sim-protocol
pnpm run build:wasm
pnpm -C web check && pnpm -C web lint && pnpm -C web build
```

### Intentional deviations from the runbook (all documented)
- `wasm-opt` disabled in `crates/sim-wasm/Cargo.toml` — binaryen is not fetchable
  in the sandbox. Re-enable when the build image provides it.
- Added `Simulation.state()` so the renderer can read the snapshot. Read-only.
- `lint` = Prettier + ESLint flat config (svelte + ts), both green.

### Pick up here
- The placeholder `Sim` is a scaffold. The next substantive work is the real
  **mixed-signal engine** — start in `crates/sim-core/src/lib.rs` against
  `docs/architecture.md`, preserving the determinism invariants.
- Branch: `claude/kind-turing-hdelb3`. No PR opened yet — open against `main`
  when the owner is ready (do not push to `main`).
- See `TODOS.md` for the prioritized backlog.

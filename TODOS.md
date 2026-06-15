# TODOS

Append-only work log. Newest day at the top. Completed items are **tombstoned**
(struck through with `~~...~~`) and kept for history — never deleted. Open items
use `[ ]`. This file is maintained by agents; see CLAUDE.md for the rule.

---

## 2026-06-15

### Done — ammeter, custom rate, progressive guided builds
- ~~**Ammeter**: the Measure tool gains a V/A toggle; "A" reads the current through a clicked part or wire (KCL branch current) — `board.setProbeMode` + `drawAmmeter` + cached per-frame wire currents.~~
- ~~**Guided builds run the sim live** (`startBuild` resumes playback) so each added part comes alive in a working sub-circuit; **examples reworked into progressive/observable builds** (agent) — the buck now: forward path → ragged spike → add diode (spike vanishes) → add cap (smooths to ≈4 V). `steps[]`-only, topology unchanged, `done()` monotonic.~~
- ~~**Custom playback rate**: a ticks/second number input beside the rate presets.~~

### In flight / pending
- [ ] **Inspector as a popup over the component** (agent brainstorming `docs/ui/inspector-popup.md`): move the value picker out of the telemetry panel into a floating popover anchored above the clicked part (world→screen projection, edge-flip, open-on-select/close-on-deselect). Build after the brainstorm.
- [ ] **Incomplete-circuit affordance** (designed in `docs/ui/incomplete-circuits.md`, still unbuilt): topology pre-check for a current source with no return path + a deterministic `singular()` solver flag → amber hint, don't halt the sim.

### Done — ticks/second playback, wall-clock readout, timeline-to-0, +3 examples
- ~~**Ticks-per-second playback**: rate is now ticks of sim time per *real* second (real-dt driven), presets [50, 500, 5k, 50k, 500k]/s (500k/s = real time at DT 2 µs), replacing the per-frame multiplier (`loop.ts setTicksPerSecond` + `MAX_STEPS_PER_FRAME`).~~
- ~~**Timeline reaches t=0**: history is now an O(1) circular ring with a large cap, so the scrubber spans 0→max in a normal session (no O(n) shift/tick). (True unbounded rewind via keyframes is still the deep-rewind backlog item.)~~
- ~~**Wall-clock readout**: `DT_SECONDS` exported; scrubber + telemetry show the displayed tick as a real-time duration (tick × DT); rate buttons tooltip their "× real time" factor.~~
- ~~**+3 examples** (agent): RLC ringing (underdamped, ζ≈0.16 — damped sine on the scope), PWM dimmer (SW→RC averages to ≈duty×Vin), diode clamp (node pinned at ~0.57 V, with a lift-the-diode demo). Each net hand- and numerically-verified.~~

### Done — scope/telemetry upgrade (expandable, per-node toggle + rename)
- ~~Scope can **expand** (≈60% of the board) from a telemetry button; per-node **show/hide** checkboxes and **rename** inputs in the telemetry panel; the scope autoscales to visible traces and draws a coloured **legend** of node names. `board.ts`: `setNodeLabel`/`setNodeHidden`/`toggleScopeExpanded` + `scopeLegend` pool; `App.svelte`: node controls (GND stays fixed).~~

### In flight / backlog (this session)
- ~~**Solver upgrade → nonlinear Newton engine** (sim-core): deterministic Newton–Raphson outer loop engaged only when a nonlinear element is present (linear fast-path kept byte-identical → golden unchanged), with the **diode** (type 5, Shockley + gmin + pnjlim limiting, 100-iter cap) as the first nonlinear element. 25 tests pass incl. `diode_run_is_reproducible`; `docs/architecture.md` + `docs/determinism.md` updated. Foundation for LED/BJT/MOSFET.~~
- ~~**Diode + switch wired into the web**: `netlist.ts` `D:5`/`SW:6`; animated `drawD` (triangle + cathode bar, forward-conduction glow/flow) and `drawSW` (lever flicks open/closed off live `vAcross`, flow when closed); both placeable in the bin.~~
- ~~**Clock-driven SWITCH element** (`sim-core`, type 6): time-varying linear conductance, pure function of the tick (`SWITCH_PERIOD_TICKS = 50` = 10 kHz, `value` = duty, Ron 0.01 Ω / Goff 1e-9). Golden unchanged; 31 tests incl. `switch_buck_converter_steps_down_and_is_finite` + `switch_run_is_reproducible`.~~
- ~~**Buck Converter example**: Vin → SW → L → OUT with a freewheel diode + smoothing cap + load + GND, vertical V/C/R/D via an optional `rot` on the example `comp()` helper. Steps down 10 V → ≈4 V at 40% duty; every part animated.~~
- [ ] **LED + a diode example** (clipper/rectifier) and other nonlinear parts (BJT/MOSFET) on the new Newton engine.
- ~~**1-pin part hit box** (GND): `componentBox` now returns a generous 36×48 grab box for 1-pin parts, so GND is easy to click + drag.~~
- ~~**Floating GND no longer falsely grounds**: `buildNetlist` only accepts a GND as the reference if its net is wired to ≥1 other pin (net size > 1); a GND sitting unconnected on the board is ignored, so a disconnected circuit no longer falsely "solves" (was reading 10 V·10 mA on an open I→R chain).~~
- [ ] **Dangling current-source affordance (deeper #2)**: even with a *connected* ground, an ideal current source whose forced current has no return loop yields a singular solve (degenerate → misleading reading), whereas a V source just shows 0 current. Detect the singular/no-DC-path case (or a current source with no current loop) and surface "incomplete circuit" instead of garbage. Needs proper topology / singularity detection (likely a `sim-core` "singular" signal + an App hint).
- ~~**Value Inspector** shipped (`web/src/lib/values.ts` + board `setComponentValue`/`onSelect.single` + App): select one part → curated value chips + −/+ standard-value stepper + a "more values" decade×significand picker (E24 R / E6 C·L; curated lists for V/I and SW duty). Every valued part (V/R/C/L/I/SW) is now configurable; edits rebuild the netlist live.~~
- [ ] **Buck converter demo** (owner, "fun, less important"): a fully-animated buck converter showing energy moved in "buckets" to a new voltage — needs switching (switch/MOSFET + diode + L + C), so it follows the solver upgrade + a switch part.

### Done — KCL-aware belt flow, finer ΔT, readable example layouts + new examples
- ~~**KCL-aware wire flow:** `computeWireCurrents()` routes each element's injected current along a per-net spanning tree, so every wire segment shows its true branch current — the supply rail now visibly **thickens toward a source and thins past each tap** (thickness + chevron density + direction all track it). Replaces the old single-element `wireCurrent`. Render-only; never touches the sim.~~
- ~~**Finer ΔT:** `DT` 10 µs → **2 µs** (5× smoother dynamics). Golden regenerated `0xeaac376499e4fa24`; the monotonic-RC test now runs the same physical time (15000 × 2 µs). Playback compensated so wall-clock pace is unchanged: default `tpf` 0.1 → 0.5, `SPEEDS` [0.5,1,2,5,20], chevron `TICK_FLOW` 0.03 → 0.006.~~
- ~~**Readable examples:** primer/divider/RC/RL relaid as clean rectangular loops (loads on top, V bottom-left, **explicit GND** bottom-right). Added two new examples: **Parallel Resistors** (shows the KCL rail accumulation) and **Current Source** (the new `I` part, V = I·R).~~

### Done — draggable wires, timeline-relative flow, crisp text, hotkeys
- ~~**Draggable wires:** `Wire.mid` optional waypoint; dragging a wire bends its orthogonal belt through a grid cell, dropping it back on the straight line straightens it. One `routeForWire` is the single source of wire geometry (draw/hit-test/selection-with-handle/probe). Cosmetic only — netlist sig ignores it, so the sim never resets.~~
- ~~**Timeline-relative flow:** the flow phase is `realPhase + tick*TICK_FLOW`, so the current arrows/dots advance with ΔT — forward when the tick advances (running or scrubbing forward), reverse when stepping/scrubbing back — instead of freezing whenever paused.~~
- ~~**Crisp text (round 2):** Text resolution floored at 2× (supersampled, sharp on 1× displays) and multiplied by zoom + re-rasterized so labels stay sharp zoomed in (`applyTextRes`, `ComponentNode.setTextRes`); the prior cap-at-2 mismatched the hi-DPI renderer.~~
- ~~**Hotkeys:** Space = play/pause; arrows nudge the selection (or pan when empty, `board.nudge`); `,`/`.` step a tick back/forward.~~

### Done — new ideal elements (current source + ground), via parallel agent
- ~~**Ideal DC current source (`I`, type 4):** sim-core KCL stamp (no branch unknown, consistent across operating-point + transient, `currents = value`); validation + doc table; 4 new tests (I·R drop, KCL, a→b sign flip, linear cap ramp). Glyph `drawI` (circle + arrow, flow ∝ current). Golden `0x6d05…` unchanged.~~
- ~~**Explicit ground (`GND`):** 1-pin reference part; `buildNetlist` prefers a GND net for node 0, else falls back to the first V source's − pin — so current-source-only loops are now simulatable. Glyph `drawGND` (three-bar ⏚). Design note `docs/parts-roadmap.md`.~~

## 2026-06-14

### Done
- ~~Bootstrap the repository per AGENTRUNBOOK.md: Cargo workspace + three crates (sim-core, sim-protocol, sim-wasm).~~
- ~~sim-core: deterministic fixed-step placeholder, FNV-1a snapshot hash, reproducibility test (passing).~~
- ~~sim-wasm: wasm-bindgen bindings (step/tick/state/protocol_version/snapshot_hash).~~
- ~~WebAssembly build wiring (scripts/build-wasm.sh → web/src/wasm); disabled wasm-opt so build works offline.~~
- ~~Web app: Vite 8 + Svelte 5 + TypeScript + PixiJS 8, workspace wired with pnpm.~~
- ~~Apply the Critical Error Computing design system (OKLCH palette, Saira / Saira Condensed / IBM Plex Mono, HUD shell, grid + neon glows) to the web UI.~~
- ~~First design pass: component bin, live oscilloscope board (auto-ranged traces of the deterministic snapshot), telemetry panel, transport controls (run/pause/step/speed).~~
- ~~ESLint flat config (typescript-eslint + eslint-plugin-svelte) + Prettier; lint gate green.~~
- ~~CI workflow (.github/workflows/ci.yml): rust-core + web-build jobs.~~
- ~~Seed docs: architecture, determinism, ADR-0001. README/NOTICE/CONTRIBUTING with placeholders filled.~~
- ~~SessionStart hook: self-heal the wasm toolchain on ephemeral containers + surface the agent handoff docs.~~
- ~~All verification gates green from a clean checkout (fmt, clippy, test, build:wasm, check, lint, build).~~
- ~~Write the game design document (docs/game-design.md): pillars, fidelity-as-progression loop, tech tree, challenge/grading model, milestones M0–M5.~~

### Done — parallel agent panel (M1 + M2 + polish), integrated
- ~~M2 (Lane A): replace placeholder dynamics with a real deterministic analog engine — backward-Euler companion models via Modified Nodal Analysis, bounded dense solve. Circuit: RC charge (V → R → C → gnd). `state()` = [v(n1), v(cap), i(src), v(rail)].~~
- ~~M2: committed determinism golden `golden_snapshot_hash_is_stable` (seed 42, 1000 steps → 0x92349dbbbf5a8293); kept `run_is_reproducible`; added monotonic-charge, closed-form, and seed→rail tests.~~
- ~~M1 (Lane B): interactive board — TS board model (`web/src/lib/graph.ts`), drag-from-bin placement, click-drag wiring, move/delete, Select/Place/Wire mode toggle, and a renderer + telemetry generalized to a variable-length state vector.~~
- ~~Polish (Lane C): self-host the fonts (dropped the Google CDN), CRT/scanline scope frame, full button/chip/telemetry state matrices, neon glows, prefers-reduced-motion.~~
- ~~Integrate the three worktree branches into the feature branch (disjoint files → clean cherry-pick); rebuild wasm; full gate suite green; align telemetry labels to the core's state layout.~~

### Done — interactive features + solver integration (session 3)
- ~~Zoom + pan viewport (wheel zoom to cursor, drag-empty / middle-drag pan); grid redraws across the visible region.~~
- ~~Ideal fixed voltage source added to the bin; parts carry value + unit; graph gains serialize/restore.~~
- ~~Simulation paused by default; bottom timeline scrubber with per-tick step back/forward, backed by a bounded snapshot history.~~
- ~~Selection: click + shift/ctrl multi-select with highlight; Delete removes selection; Ctrl+Z undo.~~
- ~~Animated component glyphs (R zigzag + flow/heat, C plates + charge, L coil + field halo, V battery + pulse) driven by real per-element current/voltage.~~
- ~~Wire the board graph into the solver: `netlist.ts` compiles BoardGraph → MNA netlist (ground = first source's − net); sim-core generalized to an arbitrary ideal netlist (Lane A); new golden `0x6d055513f0613902`.~~
- ~~Examples panel: Watch (load + run) and guided Build (auto-advancing checklist with a per-step "why") for Voltage Divider, RC, RL.~~
- ~~"Show don't tell" demos: live V-across / I-through readout on a selected part; a DMM probe (Measure mode, red/steel leads, needle tips) reading voltage between any two pins; a divider R2-to-ground toggle; a guided open/closed-loop concept beat.~~

### Done — UX/visual overhaul (session 5, from playtest feedback)
- ~~HiDPI crispness (devicePixelRatio + autoDensity) — fixes the blur.~~
- ~~"Factorio belts": orthogonal 90° trace routing, voltage-coloured wires, current flowing as directional chevrons (density/speed/direction track the current).~~
- ~~Scope fixed: per-tick sampling (freezes on pause, scrubs with the timeline), cursor line, numbered V axis + tick label; skips the flat ground node.~~
- ~~Reset Run (↺) + loop.restart(); fractional ticks-per-frame with a much slower default (0.25×).~~
- ~~Ground symbol + "GND 0 V" drawn at the source's ground pin.~~
- ~~Panel unified: the guide floats over the board so the Parts bin stays visible; a "Voltage & Current" primer that opens running so the first thing you see is current flowing through a voltage-coloured wire (+ a dismissible intro banner naming both primitives).~~
- ~~Live "V across / I through" readout on a selected part; draggable DMM probes that snap to a pin or a trace.~~
- ~~Component rotation (R hotkey + Rotate button): `rot` on the component, rotated `pinCell`, rotated glyph with upright labels; connectivity unchanged so the sim isn't reset. Watch now starts paused.~~

### Done — modeless interaction, Phase 0 (session 6)
- ~~Collapse Select/Place/Wire into one contextual **Build** mode + a **Measure** toggle (the 4-mode toolbar is gone). `Mode` keeps `place`/`wire` internally but App only sets `select`/`measure`.~~
- ~~**Armed-part** model (replaces Place mode): click a bin row to arm a kind (toggle), then click empty board cells to drop it and stay armed (place-and-repeat); drag-from-bin still one-shots. `board.setArmed` + `placeCell`; `onArm` mirrors a board-side disarm (right-click) into the HUD.~~
- ~~**Esc** = universal cancel (disarm → cancel wiring → clear selection); right-click disarms when armed (else deletes under cursor). Per-context cursor (copy/crosshair/default), a one-line contextual **hint**, and an **armed-part chip** (× to disarm) for discoverability.~~

### Open / Next
- [ ] **Modeless flow, Phases 1–2** (`docs/ui/mode-flow.md`; Phase 0 shipped): ghost preview snapping to the cell under the cursor + pin hover highlight/snap-ring (Phase 1); click→click chained wiring, `1`–`9` hotbar + `Q` pipette, Shift-drag box-select, Space-pan (Phase 2). Cleanup: retire the unused `place`/`wire` `Mode` variants once convenient.
- [ ] **Make it a game, not just a sim (owner-driven).** Full brainstorm + backlog in `docs/game-rewards.md`. Core rule: the sim is the only judge — a reward is a number off a deterministic graded replay. Two currencies: **Credits** (spend) + **Lux** (earned only by understanding; **Lux gates the tech tree** = the anti-grind firewall). MVP order: (1) contract + spec-sheet grader (generalize the RC challenge); (2) Credits + "Ship It" juice (replay the winning run); (3) realism multiplier with one real 5% resistor (the pillar, made playable); (4) par score + replay-verified leaderboard; (5) predict-then-reveal + first Lux.
- [ ] Per-component **value editing** (click a part → set R/C/L/V); the model already carries values + units, expose a small inspector.
- [ ] Extend the "show don't tell" demos to RC/RL (short the cap to watch it discharge; open the coil for back-EMF); make the probe a movable meter that snaps to whole nets.
- [ ] Nonlinear devices: diode (then BJT) with a capped Newton solve in sim-core.
- [ ] **Power-bus visual language on wires/nets** (`docs/ui/visual-language.md`, ref `docs/ui/dc-bus-reference.html`): net voltage as level + color + number; branch current as flow + thickness + number; KCL at taps; IR-drop sag. Add rail tokens (`--r12/--r5/--r33/--gnd`) to `app.css`.
- [ ] Add the event-driven digital engine and the behavioral MCU emulator; meet the analog domain at the pins (docs/architecture.md).
- [ ] First graded challenge: "V(cap) reaches 90% of the rail within N ticks", verified by measurement + deterministic replay.
- [ ] sim-protocol: design the real snapshot/command wire schema; choose a serialization deliberately and record an ADR.
- [ ] Deep rewind via sparse keyframes (the scrubber currently replays a bounded snapshot history; keyframes give unbounded exact rewind).
- [ ] Re-enable `wasm-opt` once binaryen is provisioned in the build image.
- [ ] GitHub Pages: still needs the owner to set Settings → Pages → Source: GitHub Actions, then the `pages` workflow deploys.

Superseded earlier items (tombstoned):
- ~~Replace the placeholder dynamics with the real analog solver~~ → done (Lane A; arbitrary netlist).
- ~~Wire the board graph into the solver~~ → done (`netlist.ts` + integration).
- ~~Promote `print_golden` into a committed golden~~ → done.
- ~~Web: drag-from-bin placement + real board graph~~ → done (Lane B).
- ~~Self-host the fonts~~ → done (Lane C).
- ~~Web: rewind via the transport~~ → snapshot-history scrubber done; keyframe rewind still open above.

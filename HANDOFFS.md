# HANDOFFS

The most recent handoff is at the **top**. When you stop work, prepend a new
dated section so the next agent can pick up cleanly. Keep it concise and current.

---

## 2026-06-15 — Board interaction: placement ghost, junction drag, junction tool

**State:** 🟢 Green. **crates/ untouched** — render/interaction/graph only; golden
`0xeaac376499e4fa24` unchanged, `cargo test -p sim-core` 44 pass / 1 ignored;
fmt + clippy clean; `build:wasm`, web format/check/lint/build all pass. Three
features, all in `web/src/lib/board.ts`, `web/src/lib/graph.ts`,
`web/src/App.svelte`:

1. **Translucent placement ghost.** A non-interactive `ghostLayer` + reused
   `ghostGlyph` in the world container (above components, below pending-wire/
   probe; `alpha = GHOST_ALPHA`). `updateGhost()` redraws the armed part with the
   real `drawGlyph` at the grid-snapped cursor cell (`cellToWorld`) and rotates it
   by the new `armedRot`. Visible only while a part is armed AND the pointer is
   over the canvas — `pointerInside` tracked via canvas `pointerenter`/
   `pointerleave`; refreshed each `pointermove`. **Placement rotation:** `armedRot`
   (0..3); `setArmed` zeroes it on a new kind (keeps it when re-arming the same
   kind); `rotateArmed()` advances it. App's R calls `rotateArmed()` when
   `armedPart && selCount === 0`, else the old `rotateSelection()`. The drop passes
   it through `placeCell(kind, cell, rot)` (sets `c.rot` before `addNode`, whose
   ctor reads it).
2. **Double-click a junction to drag it.** `graph.ts` gains
   `moveJunction(id, cell)` — mutates only `j.cell`; incident wires reference the
   junction by id so they re-route by redraw; topology (and `sig`) unchanged.
   `board.ts` `junctionDrag` + `lastJunctionTap`: a 2nd press on the same junction
   within `DOUBLE_CLICK_MS` (350 ms) grabs it; move snaps + `moveJunction` +
   redraw; up commits to undo only if it moved. **Single-click still starts a wire
   from the junction** (unchanged).
3. **Junction placer tool + `J`.** `Mode` gains `"junction"`; App adds the toolbar
   button (mirrors Wire: `.btn`/`is-active` + `.hk` badge), `enterJunction()`, and
   `J` in `onKey`. In junction mode a wire click → `placeJunctionAt` →
   `junctionOnWire(wireId, cell)`. **`junctionOnWire`'s `from` is now optional**:
   without it the wire is split in place (`A→J`, `J→B`), giving the junction its 2
   incident ends so it survives `pruneJunctions` and `buildNetlist` keeps the two
   halves one net via J.

**Notes / deferred:** `onChange` still rewinds the clock to t=0 for *every* edit
(existing app-wide convention) — a junction drag does too, exactly like a part
move; but `sig` is stable so the solver netlist isn't rebuilt. Double-click is
timing-based (no Pixi `dblclick` on the federated stage). No new CSS — the
Junction button reuses existing `.btn`/`.hk` styles.

## 2026-06-15 — Zener (`ZD`) + electrolytic-cap (`EC`) web/UI integration

**State:** 🟢 Green (fmt/clippy/test incl. golden + 44 sim-core tests — 43 pass,
1 ignored `print_golden`; build:wasm, web format/check/lint/build). **crates/
untouched** — built on the committed Zener element (`ELEM_ZENER = 10`, `value` =
Vz), golden `0xeaac376499e4fa24` unchanged. Mirrors the Schottky/LED integration
below.

Two new parts are now placeable, simulated, animated, and explained:

- **Zener `ZD` (sim type 10).** `netlist.ts` `TYPE_OF ZD:10`; `graph.ts`
  `PART_KINDS` (bronze, `twoPin("A","K")`, **`value` = breakdown voltage Vz**,
  default 5.1 V); App bin (tier II, diode group); `values.ts` curated Vz set
  (2.4…15 V, chips 3.3/4.7/5.1/6.2/9.1/12). **Glyphs** (`glyphs.ts`): schematic =
  diode triangle + the **Z-bent cathode bar**, with a warm forward glow and a
  cyan reverse-breakdown bloom (each keyed to its current magnitude as alpha);
  factory = the check-valve gate **plus a side spillway/weir that opens on reverse
  breakdown** and pours the excess to the drain (per parts-catalog-ideation §1).
  `partInfo.ts`: static prose (forward = ordinary ~0.7 V diode; reverse blocks
  until Vz then clamps the node — the shunt-reference basis); live `headline`
  reports forward / blocking / in-breakdown + Vz, plus a power row.
- **Electrolytic `EC` (NO new sim type — netlist expansion).** Modelled honestly
  as an **ideal capacitor in series with a fixed 0.5 Ω ESR** (`EC_ESR_OHMS` in
  `netlist.ts`; fixed, not a function of C). In `buildNetlist`, each `EC`
  allocates **one internal node** (after all pin/junction nodes; bumps
  `nodeCount`; ordered by sorted component id so it's deterministic and
  move-invariant) and emits **two elements** — a capacitor (`+`pin → internal,
  value = C) and a resistor=ESR (internal → `−`pin). `elemOfComponent[EC]` = the
  **capacitor** element (its current is the series current the glyph/inspector
  read); `nodesOfComponent[EC]` = `[+pin, −pin]` so `vAcross` spans the whole part
  (incl. the ESR drop). The two stamps + the bumped `nodeCount` fold into the
  topology `sig`, so pure moves still don't reset the sim; the EC also unions its
  internal path in the floating-source check. `graph.ts` (cyan, polarized
  `twoPin("+","−")`, **`value` = C**, default 100 µF); bin (tier II); `values.ts`
  (10 µF…1000 µF). **Glyphs:** schematic = the polarized symbol (one **curved**
  plate + one straight plate + a "+" mark) reusing the cap charge-fill; factory =
  a **big ribbed pressure tank** that fills with stored voltage, ESR as a narrow
  throat at the inlet (per parts-catalog-ideation §2.1). `partInfo.ts`: teaches
  C + ESR (stores charge, but the series ESR drops a little on ripple surges — why
  a real cap can't perfectly flatten ripple); derived energy ½CV² + the ESR.
- **`examples.ts` (3 new).** **Zener Shunt Reference** (12 V → 1 kΩ → ZD→GND, node
  clamps ≈5.1 V, ~6.9 mA shunts through the Zener — mirrors the sim-core
  `zener_clamps_reverse_voltage` layout) and **Two LEDs in Series** (9 V → 270 Ω →
  LED → LED → GND, drops add to ~3.8 V, ~19 mA, both light equally) under
  **Diodes**; **Electrolytic Decoupling** (200 Hz AC → diode → load ∥ EC, ripple
  smoothing + the ESR keeps it from being perfectly flat, with a lift-the-cap
  demo) under **Capacitors & Inductors**. All operating points hand-checked.
- Every glyph rides the bounded `o.phase` clock; magnitude = fill / brightness /
  density / thickness, never speed (honours the flow-rate decoupling). `PALETTE`/
  token colors only; SPDX headers intact.

### Pick up here
- Owner-driven: the remaining parts catalog (`docs/parts-catalog-ideation.md`) —
  the next cheap-first wins are MOV (P1, like the Zener), then the multi-terminal
  lift (P3: BJT/MOSFET) and controlled sources (P4). Same UI backlog as below.
- The EC's ESR is a single fixed 0.5 Ω constant; a per-C ESR or a P2 param block
  is the natural fidelity upgrade if/when per-device params land.

---

## 2026-06-15 — Schottky + LED web/UI integration (sim types 8 & 9)

**State:** 🟢 Green (fmt/clippy/test incl. golden + 42 sim-core tests — 41 pass,
1 ignored `print_golden`; build:wasm, web format/check/lint/build). **crates/
untouched** — built on the committed sim-core diode family (`ELEM_SCHOTTKY = 8`,
`ELEM_LED = 9`), golden `0xeaac376499e4fa24` unchanged.

The two new diode-family parts are now placeable, simulated, animated, and
explained — the web layer mirrors how the silicon diode `D` is wired:

- **`netlist.ts`** — `TYPE_OF` gains `SD: 8`, `LED: 9`. An `LED` placed in
  V→R→LED→GND maps to element type 9; a Schottky to type 8 (both `twoPin("A","K")`,
  value unused, so they pass the 2-pin element guard in `buildNetlist`).
- **`graph.ts` + App bin** — `PART_KINDS` gains `SD` ("Schottky Diode", **cyan**,
  the cool low-loss variant) and `LED` ("LED", **accent** rose, the emitting hue);
  both added to the `PARTS` bin in the diode group (tier II) next to `D`.
- **`glyphs.ts`** — schematic + factory drawers for both, in `DRAWERS` and
  `FACTORY_DRAWERS`. Schottky: diode triangle + the bent-flag (S) cathode bar /
  a leaner open-throat check-valve. **LED: diode triangle + bar with two arrows
  radiating outward, and an emit glow (layered halo + white core) whose
  brightness = `norm(forwardCurrent, CUR_SCALE)`** — bright with current, dark when
  reverse/off; factory twin is a gate with a roof beacon lamp. All motion rides the
  bounded `o.phase` clock (breathe = `sin(phase·PULSE_K)`); magnitude is
  brightness/alpha/length, **never speed** (honours the flow-rate decoupling).
- **`partInfo.ts`** — `SD` teaches the ~0.3 V metal–semiconductor knee (large Is)
  vs silicon's ~0.7 V + a power row; `LED` teaches the ~1.8–2 V band-gap drop, that
  light tracks current, + a relative-brightness derived row (≈I/20 mA, presentation
  figure). Prose stays static; live numbers only in `headline`/`derived`.
- **`examples.ts`** — **"LED Current-Limiting"** (V 5 V → R 150 Ω → LED → GND,
  ≈20 mA, visibly lit — the classic first contract) and **"Schottky vs Silicon"**
  (parallel R+diode branches, reads the two forward drops side by side), both under
  the **Diodes** category.

### Pick up here
- Owner-driven: next nonlinear parts on the Newton engine (Zener, BJT/MOSFET) and
  the parts/IC roadmap (`docs/parts-roadmap.md`, the two ideation docs).
- Same outstanding UI backlog as below (more demo pages; optional energy-layer
  toggle).

---

## 2026-06-15 — Animation-rate fix + info-panel (static prose, live section, belt note)

**State:** 🟢 Green (fmt/clippy/test incl. golden + 38 sim-core tests, build:wasm,
web check/lint/build). sim-core untouched — golden `0xeaac376499e4fa24` unchanged.

- **Animation rate decoupled from magnitude + tps** (was unreadably fast on
  high-V/I examples; lowering tps didn't help). One **bounded visual flow clock**
  drives glyph flow dots, belt chevrons, energy dots, pulses — fixed wall-clock
  `FLOW_HZ ≈ 0.6`, independent of V/I/tps. Timeline gives **direction only**
  (forward running; sign of tick-change when scrubbing). Magnitude now reads as
  density + thickness + alpha. Carrier/energy slosh preserved by integrating the
  **saturated sign** of current / power v·i (`FLOW_DIR_SAT`), so AC still reverses
  and resistor energy still streams. `glyphs.ts` `flow()` constant-speed +
  density; `board.ts` `update()`/`redrawWires` rewrite. Spec in
  `docs/ui/visual-language.md` → *Decoupling flow rate from magnitude* (~0.3–1.5
  visual Hz across all I and tps). (Built by a worktree agent, reviewed +
  cherry-picked.)
- **Info panel jitter fixed:** the plain explanation embedded live numbers, so the
  prose reflowed every frame. Prose is now **static concept text** (`partInfo.ts`
  `plain()` no longer takes args); all changing numbers (headline relation +
  derived rows) are grouped into a dedicated **"Right now"** section below it.
- **Belt explainer:** always-on "carriers & energy" note in the Info tab —
  what the two layers are, and why energy flows forward on AC's negative
  half-cycle (P = V·I; negative × negative = positive). New `--energy` token.

- **Parts/IC ideation (no code, owner-driven):** `docs/parts-catalog-ideation.md`
  (discrete/analog menagerie → 8 new sim primitives; first 5 parts:
  per-device params → Schottky → LED → Zener → electrolytic-w/-ESR) and
  `docs/ic-buildings-ideation.md` (ICs as assemblers; black-box → macro →
  seal-a-sub-circuit-into-a-chip ladder; first ICs: gates → flip-flop → 555).

### Pick up here
- **More demo pages** (capacitor, inductor, RC/RL) in the dark style; link from app.
- Optional **toggle** for the energy layer if the belt is busy on dense boards.
- **Parts roadmap** (owner-driven): steer which parts/ICs first; the gating sim
  primitives are P3 multi-terminal + P4 controlled sources (see the two ideation
  docs + `parts-roadmap.md`).
- Owner-driven backlog unchanged (contracts prototype, per-island ΔT).

---

## 2026-06-15 — Interaction polish, carrier/energy belt, demo pages

**State:** 🟢 Green (fmt/clippy/test incl. golden + 38 sim-core tests, build:wasm,
web check/lint/build). sim-core untouched — golden `0xeaac376499e4fa24` unchanged.

- **Fixes batch (#22):** flow-jitter at high playback speed (per-frame phase-delta
  cap + chevrons capped to 14/wire); rotated parts lay labels/value/meter against
  the *rotated* pin bounds; on-board meter gated to parts without an editable
  value (the popover already shows V·A); top selector chips wrap instead of
  scrolling; **reset-on-edit** — any change (place/move/rotate/rewire/value)
  rewinds the scope + clock to t=0 (App `onChange`).
- **Carrier/energy belt (loop-tile):** each wire animates two layers — *carriers*
  (voltage-coloured chevrons, position integrates **signed current** → stream on
  DC, slosh on AC) and *energy* (warm-orange dots, travel integrates **signed
  power v·i** → steady delivery to the load on a resistor even while carriers
  slosh; sloshes on a reactive part). Per-wire phase accumulators
  (`carrierOffset`/`energyOffset`) off the same timeline-relative phase, consumed
  once/frame, pruned on delete. Encoding in `docs/ui/visual-language.md`.
- **Demo pages:** `docs/visuals/resistor.html` (heating, I²R) + `docs/visuals/
  diode.html` (half-wave + smoothing cap), standalone, in the **dark HUD** style
  (matches the app, not the light reference docs).

### Pick up here
- **More demo pages** in the same dark style (capacitor, inductor, RC/RL — the
  user asked for "a couple more"); consider linking them from the app.
- A **toggle** for the energy layer if the belt reads too busy on dense boards.
- Same owner-driven backlog as below (contracts prototype, per-island ΔT).

---

## 2026-06-15 — AC track (sine source + 9-example curriculum) + game-design ideation

**State:** 🟢 Green (fmt/clippy/test incl. golden + 38 sim-core tests, build:wasm,
web check/lint/build). Also shipped this session: the value Inspector (#13), an
ammeter + live guided builds (#14), custom rate + progressive examples (#15), the
value-popover (#16), the incomplete-circuit warning (#17), and collapsible
example categories (#18).

- **AC source** (`sim-core` type 7): ideal sine `5·sin(2π·f·t)`, `value` = freq,
  deterministic, golden unchanged. Wired through netlist `AC:7` / `PART_KINDS` /
  `drawAC` glyph / bin / inspector frequencies. **9 build-and-observe AC examples**
  (`docs/ui/ac-curriculum.md`) under AC Fundamentals / Reactance / Filters /
  Resonance / Rectification.
- **Time/measure/UX this session:** ticks-per-**second** playback driven by real
  elapsed time + a custom-rate input; an O(1) ring so the timeline reaches t=0; a
  wall-clock "Sim time" readout (`DT_SECONDS`); the **ammeter** (Measure → V/A);
  the **value Inspector** as a floating **popover** anchored above the part
  (`board.onAnchor` projects to screen space); and the incomplete-circuit amber
  warning (`netlist.floatingSources`).
- **Design ideation (no code):** `docs/game-factory-loop.md` +
  `docs/game-contracts-economy.md` explore the Factorio/Shapez sandbox+contracts
  vision (owner-driven; not greenlit to build).

### Pick up here
- **Sandbox ΔT model** (TODOS): per-electrical-island adaptive ΔT + a shared
  physical-time clock; black-boxing validated sub-circuits as a scale + ΔT lever.
  Owner wants to steer the game direction before implementation begins.
- **Game MVP** (if greenlit): a parametric contract generator + pin-sampling
  grader off the deterministic replay.

---

## 2026-06-15 — Buck converter: diode + PWM switch wired up, animated demo

**State:** 🟢 Green (fmt/clippy/test incl. golden + the new buck/switch tests,
build:wasm, web check/lint/build).

- **Switch element** (`sim-core` type 6, cherry-picked): time-varying linear
  conductance, a pure function of the tick (`SWITCH_PERIOD_TICKS = 50` ≈ 10 kHz,
  `value` = duty, `Ron 0.01 Ω` / `Goff 1e-9`), stamped in all four solve paths.
  Golden unchanged; 31 tests incl. `switch_buck_converter_steps_down_and_is_finite`.
- **Diode + switch in the web**: `netlist.ts` `D:5` / `SW:6`; animated `drawD`
  (triangle + cathode bar, forward glow/flow) and `drawSW` (lever flicks
  open/closed off live `vAcross`); both placeable in the bin.
- **Buck Converter example**: Vin → SW → L → OUT, freewheel diode, smoothing cap +
  load, GND; vertical V/C/R/D via a new optional `rot` on the example `comp()`.
  Steps 10 V → ≈4 V at 40 % duty. (Connectivity is by pin-ref, so the rotations are
  visual-only — the netlist is a correct buck regardless of layout.)
- **Design notes added** (no code yet): `docs/ui/value-picker.md`,
  `docs/ui/incomplete-circuits.md` (recommended fix for the V-loop/I-one-sided
  asymmetry: a topology pre-check for a current-source terminal with no DC path +
  a deterministic `singular()` flag from the solver, folded into the once-per-frame
  snapshot read; surface an amber hint, don't halt the sim, don't hash the flag).

### Pick up here
- Build the **value Inspector** (`docs/ui/value-picker.md`) and the
  **incomplete-circuit affordance** (`docs/ui/incomplete-circuits.md`).
- More nonlinear parts (LED, BJT/MOSFET) now that the Newton engine exists.

---

## 2026-06-15 — Scope/telemetry upgrade + value-picker design; solver upgrade in flight

**State:** 🟢 Green (web check/lint/build; Rust unchanged this batch). Scope panel
on the branch.

- **Scope/telemetry**: the scope can **Expand** (~60% of the board) from a
  telemetry button; each node has a **show/hide** checkbox and a **rename** input
  in the telemetry panel; the scope autoscales to visible traces and draws a
  coloured **legend** of node names. `board.ts`: `setNodeLabel` / `setNodeHidden`
  / `toggleScopeExpanded` + a `scopeLegend` Text pool + `nodeName()`. `App.svelte`:
  per-node controls (node 0 / GND stays fixed).

### Landed / in flight
- **Solver upgrade → nonlinear Newton engine** — ✅ merged into the branch.
  Deterministic Newton–Raphson loop, engaged only when a nonlinear element is
  present; the linear fast-path is byte-identical so the golden `0xeaac…` is
  unchanged. **Diode** (type 5: Shockley + `gmin` + `pnjlim` limiting, 100-iter
  cap) is the first nonlinear element. 25 sim-core tests pass incl.
  `diode_run_is_reproducible`. Next: wire the diode into the web (netlist
  `TYPE_OF D:5`, `drawD` glyph, bin) so it's placeable.
- **Value picker** design is in `docs/ui/value-picker.md` (recommended: an
  Inspector with curated chips + ▲▼ stepper + "More values ▸" decade×significand;
  E24 R / E6 C·L). Build the Inspector next.

### Backlog (owner)
- **Buck converter demo** — fully-animated, energy moved in "buckets" to a new
  voltage. Needs switching (switch/MOSFET + diode + L + C) → follows the solver
  upgrade + a switch part. Fun, lower priority.

---

## 2026-06-15 — KCL-aware belt flow, finer ΔT, readable example layouts + new examples

**State:** 🟢 Green (fmt/clippy/test incl. new golden, build:wasm, web
check/lint/build). On the branch; merge to `main` for the live site.

- **KCL-aware wire flow** (`board.ts computeWireCurrents`): each element injects
  its current at its two pins; routing those injections along a per-net spanning
  tree gives the true branch current in every wire segment. A shared rail now
  visibly **thickens toward a source and thins past each tap** (thickness +
  chevron density + direction). Render-only; cycle/redundant wires read 0.
- **Finer ΔT**: `DT` 10 µs → **2 µs**. Golden regenerated to
  `0xeaac376499e4fa24` (justified: deliberate fidelity change). Monotonic-RC test
  now runs 15000 × 2 µs (same physical time). Playback compensated to keep the
  wall-clock pace: default `tpf` 0.5, `SPEEDS` [0.5,1,2,5,20], `TICK_FLOW` 0.006.
- **Examples relaid** as readable rectangular loops with **explicit GND**
  (primer/divider/RC/RL), plus two new ones: **Parallel Resistors** (shows the
  new KCL rail accumulation) and **Current Source** (the `I` part, V = I·R).

### Pick up here — outstanding owner requests
- **Scope/telemetry panel** (asked, not yet built): make the right panel a
  bigger/expandable box housing the scope; **toggle each node** on/off; **label
  each node**. Touches `board.ts` (scope draw respects visibility + names) and
  `App.svelte` (telemetry: per-node checkboxes + name inputs + expand control).
- **Per-component value editing from real values** (asked): an inspector that
  lets you pick a component's value from standard/E-series options per type (no
  arbitrary 100.56 Ω). New values table + App inspector + a `board` setter.
- **Next parts batch** (asked): switch / push-button (stateful click-to-toggle —
  needs board interaction + netlist invalidation), then the nonlinear
  diode/LED/BJT (needs a Newton loop in sim-core). See `docs/parts-roadmap.md`.

---

## 2026-06-15 — Draggable wires, timeline-relative flow, crisp text, hotkeys + new I/GND parts

**State:** 🟢 Green (fmt/clippy/test incl. golden + 4 new current-source tests,
build:wasm, web check/lint/build). Phase 0 is on `main` (PR #5). This session's
work is on the branch, to ship as **one combined merge**:

- **Draggable wires:** `Wire.mid` optional waypoint — drag a wire to bend its
  orthogonal belt through a grid cell; drop it back on the straight pin-to-pin
  line to straighten. `routeForWire` is now the single source of wire geometry
  (draw / hit-test / selection-with-handle-dot / probe-snap). Cosmetic only — the
  netlist signature ignores `mid`, so the sim never resets.
- **Timeline-relative flow:** the flow phase is `realPhase + tick*TICK_FLOW`, so
  the arrows/dots track ΔT — forward as the tick advances (running OR scrubbing
  forward), reverse when stepping/scrubbing back — instead of freezing on pause.
- **Crisp text (round 2):** Text resolution floored at 2× and multiplied by zoom
  (`applyTextRes` + `ComponentNode.setTextRes`); the old cap-at-2 mismatched the
  hi-DPI renderer. Labels stay sharp when zoomed.
- **Hotkeys:** Space play/pause · arrows nudge the selection (or pan when empty,
  `board.nudge`) · `,`/`.` step a tick back/forward.
- **New ideal elements** (parallel worktree agent, cherry-picked clean): ideal DC
  **current source** (`I`, sim-core type 4, animated arrow) and an **explicit
  ground** (`GND`, 1-pin reference; `buildNetlist` prefers it for node 0). RC
  golden unchanged. See `docs/parts-roadmap.md`.

### Pick up here
- Combined PR → `main` is the next action (user chose one combined merge); then the
  live Pages site has everything.
- Modeless **Phase 1** still open (`docs/ui/mode-flow.md`): ghost preview + pin
  hover-snap. Per-component **value editing** is now more valuable (I/GND/V/R/C/L
  all carry values). The rail chevron density still reflects a *single* element's
  current, not the KCL sum along a shared net — a known visualization gap.

---

## 2026-06-14 — Modeless interaction (Phase 0): Build + Measure, armed parts

**State:** 🟢 Green (fmt/clippy/test + golden, build:wasm, web check/lint/build all
pass); pushed. Phase 0 of `docs/ui/mode-flow.md` — the clunky 4-mode toolbar
(Select/Place/Wire/Measure) is collapsed into a Factorio-style modeless board:

- **Build (default) + Measure toggle** replace the four mode buttons. The `Mode`
  type keeps `place`/`wire` internally, but `App.svelte` only ever sets
  `select`/`measure`.
- **Armed-part model** (replaces Place mode): clicking a bin row *arms* that kind
  (click again / Esc to disarm); clicking an empty board cell drops it and stays
  armed (place-and-repeat). Drag-from-bin still one-shots. New on the board:
  `setArmed`, `placeCell`, an `onArm` callback (so a board-side right-click disarm
  mirrors back into the HUD), and `escape()`.
- **`onPointerDown`**: the `place` early-return is gone. Pin → wire, body →
  select/move, wire → select all run as before; an empty-cell press with a part
  armed now places. Right-click disarms when armed (else deletes under cursor).
- **Discoverability:** per-context cursor (`copy` armed / `crosshair` measuring /
  default), a one-line **hint** in the board overlay, and an **armed-part chip**
  (× to disarm) in the toolbar. **Esc** = disarm → cancel wiring → clear selection.

### Pick up here
- **Phase 1** (feedback): a translucent **ghost** of the armed part snapping to the
  cell under the cursor, and **pin hover** highlight + snap-ring. **Phase 2**
  (speed): click→click chained wiring, `1`–`9` hotbar + `Q` pipette, Shift-drag
  box-select, Space-pan. Then retire the unused `place`/`wire` `Mode` variants.
- This is on `claude/kind-turing-hdelb3`, ahead of `main`. No PR opened this
  session (open/merge when the owner wants the live Pages site updated).

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

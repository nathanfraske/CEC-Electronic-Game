# TODOS

Append-only work log. Newest day at the top. Completed items are **tombstoned**
(struck through with `~~...~~`) and kept for history — never deleted. Open items
use `[ ]`. This file is maintained by agents; see CLAUDE.md for the rule.

---

## 2026-06-15

### Absolute-beginner onboarding / first-run (owner-driven; brainstorm in flight)
Design doc being written at **`docs/ui/onboarding-first-run.md`** (agent, 2026-06-15).
Brief: get someone who knows NOTHING about electronics rolling — how do you wire
things up, what am I looking at, what am I trying to read, the minimum mental model.
**Owner add-ons to fold into the doc (2026-06-15):**
- [ ] **Learn-as-you-explore, not a rail.** Concepts are introduced *as you go* /
  contextually (triggered by what you do), but the player is **free to explore
  whatever they want** at any time — progressive disclosure without a forced linear
  tutorial. The hand-holding rides alongside free play, not in front of it.
- [ ] **NO levels/tiers/picker — pull-based help in one open sandbox** (owner
  correction 2026-06-15: a levels menu defeats the open sandbox). "Self-select" =
  *what you pull, not what you pick*: the explanation layer is opt-in and
  always-available, so a total beginner can have ALL of it explained the moment they
  reach for it, and an EE just builds, never gated. Routing = the cold-open
  "Show me / Let me build" fork (both land in the same sandbox) + a persistent
  "Explain/?" handle that explains anything on demand + gentle, mutable first-
  encounter cards. One `explainAsYouGo` mute flag is the only state; everything is
  reachable for everyone always.
- [ ] **Replayable / resumable onboarding.** They can run the onboarding (or any
  guided bit) **again** if they get stuck, make a mistake, or want more help — it's
  not a one-shot. A persistent "help / show me again" affordance + a reset path.

### Component info panel — frictionless trigger + pinout + construction cutaways (owner-greenlit, queued)
Full design in **`docs/ui/component-info-panel.md`** (ideation, brainstormed
2026-06-15). Make rich component info reachable without breaking build flow.
Owner-approved direction + defaults:
- [ ] **Phase 1** — open the info drawer on **double-click** a component (+ an `I`
  hotkey on the selection, + an `ⓘ` chip on the value popover); reuse the existing
  right-side `.info-drawer`; **click-away does NOT close it** (persistent instrument
  panel that re-targets as you select); Esc/×/`I` dismiss. Add the **oriented,
  labelled pinout** (built from `PART_KINDS.pins` + `selPart.rot`). Suppress the 2nd
  click of a double on the manual switch so double-click stays universal.
- [ ] **Phase 2** — the **construction cutaways**: a third `DETAIL_DRAWERS` map
  (Pixi-drawn, parallel to `DRAWERS`/`FACTORY_DRAWERS`, hosted by a new "detail mode"
  on `InfoDiagram`, `DETAIL ?? schematic` fallback) + an in-panel schematic⇄cutaway
  toggle. First cutaways: the 3 capacitors (electrolytic rolled spiral, ceramic MLCC
  layer stack, film roll), diode/LED die, resistor color-bands. ~9 shared templates
  cover the ~30 kinds (see the doc's catalogue).
- [ ] **Phase 3** — fill the cutaway catalogue along the parts roadmap.
- Owner defaults locked: Pixi-drawn (not SVG); cutaway-with-toggle; click-away keeps
  it open; MSW 2nd-click suppressed. Presentation-only (no sim/golden impact).

### BUILD QUEUE — remaining catalog + ICs (owner: "go down the list we already had")
The full planned kit, from `docs/parts-catalog-ideation.md` and
`docs/ic-buildings-ideation.md`. **Done so far:** LED, Zener, Schottky, electrolytic
cap, BJT (NPN/PNP), MOSFET (N/P), op-amp, manual switch, varistor (MOV), logic gates
(AND/OR/NAND/NOR/XOR/NOT), transformer. Remaining, in rough build order (P-codes are
the enabling primitive from the catalog's §0 / §9 roadmap):

**Discrete parts still to build**
- [ ] **Relay** (catalog §5.2) — electromechanical: coil current pulls a contact
  (a 2nd, switched branch). **Unblocked now** (uses the 4th terminal `d`). Needs the
  stateful/hysteretic latch (P6, integer/threshold on the tick grid, hashed) + the
  flyback-diode lesson. The first stateful-conduction part. **Med.**
- ~~**Potentiometer** (`POT`) — 3-terminal wiper divider (A/B ends + wiper W);
  `buildNetlist` expands it to two resistors A→W=R·t, W→B=R·(1−t) (no new solver
  element). `Component.wiper` (0..1) + inspector % chips + the wiper slides live in
  the schematic/factory glyph. "Potentiometer Dimmer" example. Web-only; golden
  untouched.~~
- [ ] **Fuse** (catalog §6.1) — latched "blown" state (P6, + I²t thermal P7): once
  the current·time threshold trips, it stays open until replaced. **Med.**
- [ ] **Thermistor NTC/PTC** (catalog §6.3) — resistance vs temperature; needs the
  thermal scalar state P7 (self-heating from I²R, evolved on the tick grid). **Med.**
- [ ] **LDR / photoresistor** (catalog §7.1) — resistance vs light; needs the
  light/display I/O channel P8 (a player- or contract-driven light input). **Med.**
- [ ] **Photodiode** (catalog §1.4) — light-controlled current source (P8 + Newton). **Med.**
- [ ] **Seven-segment display** (catalog §7.2) — multi-terminal display, light I/O P8. **Med.**
- [ ] **Ceramic capacitor** (catalog §2.2) — low-ESR, non-polarized, voltage derating
  (P2 per-device params). **Low–med.**
- [ ] **JFET** (catalog §3.3) — depletion-mode FET (P3, MOSFET-like Newton path). **Med.**
- [ ] **Darlington pair** (catalog §3.4) — two cascaded BJTs, β≈β² (P3 composite). **Low–med.**
- [ ] **Programmable / electronic load** — commanded CC/CP/CR sink (for VRM load-testing). **Med.**
- [ ] **Autotransformer / true variac** — single tapped winding (see entry below). **Med.**
- [ ] **Reusable ferrite / magnetic core** — one core abstraction → transformer /
  common-mode choke / ferrite bead / cored inductor (see entry below). **Med–high.**

**ICs still to build** (`ic-buildings-ideation.md` §2.4 tier table, §3 entries) — all
Tier-A behavioral unless noted; build on the tick-pure digital pattern the gate set:
- ~~**D flip-flop** (`ELEM_DFF=19`, §3.2) — the first **sequential** element: 4-pin
  (Q=a, D=b, CLK=c, Q̄=d), `value`=rail. Samples D on the rising CLK edge into a
  stored bit (persistent unhashed state like the reactive companions), drives Q/Q̄
  through `GATE_GOUT` from the committed bit (constant stamp, no Newton); one-tick
  clk→Q delay. Edge-detect in the step commit. 4 tests (latch+hold, ÷2 toggle,
  validate, reproduce); golden unchanged. Web: `FF` part (clocked-box glyph + edge
  notch), partInfo, "Clocked Memory" + "Toggle (÷2 Counter)" examples. Reuses the
  a/b/c/d boundary (no wasm change).~~ (JK/latch variants still open.)
- [ ] **Shift register / counter / decoder / mux** (§3.3) — clocked integer state +
  **bus ports** (the §1.5 multi-bit belt renderer). **Low–med.**
- [ ] **555 timer** (§3.4) — internal comparators + SR latch + tick-derived output;
  R/C on the timing pins set the frequency. The "make it blink" win. **Med.**
- [ ] **Linear regulator (78xx)** (§3.5, Tier B) — controlled pass element holding
  Vout against load (output impedance + transient ride). The **VRM** thread. **Med.**
- [ ] **Comparator** — dedicated threshold→rail part with hysteresis (op-amp open-loop
  already does the basic job; this adds input loading + a clean schmitt). **Low.**
- [ ] **Switching regulator / buck-boost controller** (§2.4, C→A) — build the buck
  from discretes (we already simulate one) then seal it. **Med.**
- [ ] **DAC** (§2.4) — code → output voltage (a driven Thévenin source). **Low–med.**
- [ ] **ADC** (§2.4) — sample/quantize a node voltage → digital word on the tick grid. **Med.**
- [ ] **H-bridge / motor driver** (§2.4) — digital control of four switches + an
  inductive load. **Med.**
- [ ] **Memory (register file / SRAM)** (§2.4) — addressed array of bits. **Med.**
- [ ] **Microcontroller** (§3.11, emulator) — real C/Arduino firmware on an emulated
  core, a deterministic digital island. The sequential capstone. **High.**
- [ ] **FPGA** (Tier C) — the seal-a-built-subcircuit reprogrammable building; the
  spatial capstone. **High.**

### Owner requests — autotransformer + an ideal-vs-real fidelity pass
- [ ] **Autotransformer / true variac** (owner, 2026-06-15): a **single tapped
  winding** (top / tap / bottom — the tap is the 3rd terminal `c`), where the
  tap-to-bottom voltage is a chosen fraction of top-to-bottom. The authentic variac
  (continuously variable if paired with the pot), non-isolated, more copper-efficient
  than the two-winding transformer. Natural variant of the coupled-inductor math
  already built (one self-inductance + a tap fraction; or two series-coupled
  sub-windings sharing the tap node). **Note:** you can ALREADY rough one out today
  by **series-connecting the existing 2-winding transformer's windings** (tie P− to
  S+ → that junction is the tap) — a real technique ("transformer connected as an
  autotransformer"); the coupling does the work. A dedicated `AT` part would be the
  clean/authentic version.
- [ ] **Ideal-vs-real fidelity pass** (owner, 2026-06-15): a deliberate later pass
  that **separates the idealized parts from the realistic ones** and wires fidelity
  into **progression/tech-tree** (`docs/game-progression.md`, `docs/game-rewards.md`):
  ideal primitives early (ideal transformer ratio, lossless), real models later
  (winding R already in the transformer, leakage/saturation, ESR, tolerance, the
  realism multiplier in `game-rewards.md`). Catalog which parts have an ideal vs real
  tier and gate the real tier behind the tech tree. Do this when doing change/progress
  work, not now.

### Owner requests — potentiometer + programmable load (for VRMs/regulators)
- [ ] **Potentiometer** (owner, 2026-06-15): a player-adjustable 3-terminal variable
  resistor — two ends + a **wiper**, with a knob (0..1 wiper position) in the
  inspector. Model = two resistances `R·t` and `R·(1−t)` from the wiper to each end
  (reuses the existing resistor stamp; the wiper is the 3rd terminal `c`, already
  threaded). Gives variable dividers, adjustable bias/feedback, manual gain — and is
  the natural "knob" primitive. Low effort (no new sim primitive: expand to two Rs
  in `buildNetlist`, like the EC cap, OR add a tiny `ELEM_POT` if cleaner).
- [ ] **Programmable / electronic load** (owner, 2026-06-15): a sink that draws a
  *commanded* current (constant-current) — and ideally constant-power / constant-R
  modes — so you can **test supplies and build VRMs** (load-step response, regulation,
  efficiency). Model = a controlled current sink (a value-set current draw, possibly
  gated on its terminal voltage for CC vs CP). Pairs with the regulator IC + the
  buck we already simulate → "build a VRM and load-test it" contracts. Together with
  the pot, these unlock real power-supply design play.

### Owner requests — transformer phase (deferred; needs 4th terminal `d` + coupled-inductor model)
- [ ] **Full-bridge rectifier example with a tunable turns ratio.** Centerpiece of
  the transformer example set: a full-bridge rectifier fed from the transformer
  secondary, with the **turns ratio (N₂/N₁) as the tunable knob** so the player
  watches the turns-per-side step the AC up/down before the bridge rectifies it
  (step-down → bridge, DC output tracks the ratio). (Owner idea, 2026-06-15.)
- [ ] **Build-the-transformer-from-primitives example + a REUSABLE magnetic core.**
  Even cooler (owner, 2026-06-15): place **two coils (inductors) + a magnetic core**
  and watch the coupling come alive — model the **magnetic core as a placeable
  coupling element** that links windings via mutual inductance M = k·√(L₁L₂),
  rather than (or alongside) a monolithic 4-pin transformer. Owner follow-up: make
  that **core element reusable — e.g. a ferrite**. One core abstraction (winding
  count + coupling k + saturation curve) then covers a whole family: **transformer**
  (2 windings), **common-mode choke** (2 windings, EMI), **ferrite bead** (1 lossy
  winding, noise suppression), a **cored inductor** (1 winding, ↑L + saturation),
  **autotransformer**, **saturable reactor**. This strongly favors the **modular
  "core couples windings" architecture** over a sealed transformer part — more
  Factorio-ish, more teachable, and far more reusable. The monolithic 4-pin
  transformer (now in flight) is the fast first cut; design the modular ferrite-core
  element as the follow-on (it can share the coupled-inductor math already built).
  Owner: **finish logic gates first, then transformers.**

### IC ladder — logic gate (first behavioral digital IC)
- ~~**sim-core logic gate** (`ELEM_GATE = 17`, #51): Tier-A behavioral driver,
  a=OUT/b=IN1/c=IN2, `value` = logic-high rail, `aux` = function code (0 AND, 1 OR,
  2 NAND, 3 NOR, 4 XOR, 5 XNOR, 6 NOT, 7 BUF). Tick-pure boolean of the committed
  previous-tick inputs thresholded at half-rail; drives OUT toward 0/rail through
  `GATE_GOUT` (a constant Thévenin stamp = the switch's shape) in all 4 assembly
  sites + 4 readouts; one tick of propagation delay, no persistent state, golden
  unchanged. Also restored the op-amp's per-tick current readout.~~
- ~~**GMIN floor on gate inputs** (#52): a floating/undriven gate input was a
  singular row; floored each sensed input to ground with `GMIN` → non-singular,
  reads logic low. Golden unchanged; 79 tests.~~
- ~~**gate WEB wiring:** placeable AND/OR/NAND/NOR/XOR/NOT parts (each → type 17 +
  its `aux` code; `value` = rail, half-rail threshold), boolean-symbol schematic
  glyphs + Factorio decider/sorter, partInfo (truth table + threshold + 1-tick
  delay), and a "Logic & ICs" example set (inverter→LED, AND interlock, XOR+AND
  half-adder). Replaced the old non-simulated "&" placeholder.~~
- [ ] **Next IC rungs:** D flip-flop (clocked 1-bit state, edge detect on the tick
  grid) → counter/shift (bus ports) → 555 → linear regulator. Then the deferred
  discretes (fuse/thermistor/LDR/7-seg) and the 4th-terminal parts (relay,
  transformer — see the owner transformer requests above).

### Design ideation (no code) — ground returns + progression; MCU decision
- ~~**`docs/game-ground-returns.md`** — tiered grounding ladder G0 ideal-star → G1 lumped return R+L → G2 paintable ground-zone (the unlocked escape hatch) → G3 loop-area/EMI (integer shoelace × di/dt, deterministic) → G4 shared-ground noise budget; rejects full multi-layer PCB. Grounding is a **bonus/multiplier axis, not pass/fail**; violations located+explained; EMI scalar stays out of the golden.~~
- ~~**`docs/game-progression.md`** — 9-era tech-tree spine gating the ~8 sim primitives (not parts individually); unlock via credits + competency exams + discovery; the contract's **judgement part = a placeable acceptance fixture** whose pins are the harness. Exploration rewards: **Lab Notebook** codex (first time you cause a phenomenon), **Eureka boosts** (doing X discounts X's gate), **autopsy-for-Lux** (analyze a blown part), **Lux-vs-Credits** (deepen vs widen — a tinkerer can climb without shipping).~~
- ~~**MCU decision** captured in `ic-buildings-ideation.md` §3.11: real C/Arduino firmware at the top of the ladder, run on an emulated core as a fast deterministic digital island; MCU (sequential) + FPGA (spatial) are the two programmable capstones.~~
- ~~**NEXT (owner-greenlit): MOSFETs + transistors** — the multi-terminal (P3)
  lift, web/UI half. Built on the committed sim-core level-1 MOSFET
  (`ELEM_NMOS = 11`, `ELEM_PMOS = 12`; D=a, S=b, G=c; crates untouched, golden
  `0xeaac376499e4fa24` unchanged). **`buildNetlist` now carries a third terminal
  `c: Uint32Array`** — a 3-pin device (a MOSFET) stamps `c[i]` = its gate node
  (pin 2), a 2-pin part stamps `c[i] = 0` (ground, ignored by the core); pin→
  terminal map is direct (pin 0 → a/Drain, 1 → b/Source, 2 → c/Gate). `c` folds
  into the topology `sig` (so rewiring the gate rebuilds, a pure move doesn't),
  the MOSFET pulls its gate net into the floating-source union-find, and
  `elemOfComponent`/`nodesOfComponent` map to [drain, source] (current = Id a→b,
  vAcross = Vds). App passes `nl.c` at both `setNetlist` call sites (empty array
  for the ground-only fallback). `graph.ts PART_KINDS` `NM`/`PM` (ok/green, pins
  D,S,G, value unused) + bin + Active & Switching category. `glyphs.ts`:
  schematic = the standard MOSFET symbol (insulated gate bar, drain up/source
  down, body arrow N-in / P-out, channel chokes shut in cutoff); factory = a
  gain-assembler/valve (thin gate control belt opens a fat drain→source main
  belt whose width/density track Id, choking shut below threshold) — all on the
  bounded `o.phase` clock. `partInfo.ts` `NM`/`PM` (Vgs vs ~2 V threshold;
  cutoff/triode/saturation; square law + gm; insulated gate draws no current;
  live region + Vds/Id + a recovered-gm row). **Two `examples.ts` builds** under
  Power & Switching: **MOSFET as a Switch** (gate drives an LED hard on/off,
  gate-high/low toggle) and **Common-Source Amplifier** (NMOS + 100 Ω drain R,
  Vgg = 3 V → saturation, drain ≈3.9 V @ ~11 mA, small gate swing → larger
  inverted drain swing). All gates green (53 sim-core tests: 52 pass / 1 ignored;
  fmt/clippy; build:wasm; web format/check/lint/build).~~

### Done — three board-interaction features (ghost / junction-drag / junction tool)
- ~~**Translucent placement ghost for the armed part.** `board.ts` adds a
  non-interactive `ghostLayer`/`ghostGlyph` (above components, below pending-wire/
  probe; alpha `GHOST_ALPHA`), reusing `drawGlyph` at the grid-snapped cursor cell
  (`cellToWorld`). Shown only while a part is armed AND the pointer is over the
  canvas (tracked via `pointerenter`/`pointerleave` → `pointerInside`). New
  placement-rotation state `armedRot`: `setArmed` resets it to 0 on a fresh kind;
  `rotateArmed()` (R via App when armed + nothing selected) turns the ghost; the
  drop applies it via `placeCell(kind, cell, rot)`. R still rotates the selection
  when something is selected.~~
- ~~**Double-click a junction to drag it.** `graph.ts` `moveJunction(id, cell)`
  (updates only `j.cell`; incident wires reference it by id so they follow; `sig`
  built from topology, not position, stays stable). `board.ts`: `junctionDrag` +
  `lastJunctionTap` detect a 2nd press on the same junction within
  `DOUBLE_CLICK_MS` (350) → grab + drag (snap, re-route, undoable via pending
  snapshot, commit only if moved). Single-click on a junction still starts a wire.~~
- ~~**Junction placer tool + `J` hotkey.** Added `"junction"` to `Mode`; toolbar
  button (mirrors Wire, `is-active` + `.hk` badge) + `enterJunction()` + `J` in
  `onKey`. In junction mode a wire click drops a junction at the snapped point via
  `junctionOnWire(wireId, cell)` — `from` is now **optional**; with no incoming
  wire it splits the trace in place (both halves end at J → survives prune, ties
  the wires into one net). crates/ untouched; golden + all gates green.~~

### Done — Zener (`ZD`) + electrolytic-cap (`EC`) web/UI integration
- ~~**Zener diode (`ZD`, sim type 10) + electrolytic cap with ESR (`EC`, netlist
  expansion, no new sim type) wired through the whole web layer** (crates
  untouched; Zener `ELEM_ZENER = 10` was already committed, golden
  `0xeaac376499e4fa24` unchanged). **ZD:** `netlist.ts TYPE_OF ZD:10`; `graph.ts
  PART_KINDS` (bronze, `twoPin("A","K")`, `value` = Vz, default 5.1 V) + App bin +
  `values.ts` curated Vz chips (3.3/4.7/5.1/6.2/9.1/12 …); `glyphs.ts` schematic
  (triangle + Z-bent cathode bar, forward glow + cyan breakdown bloom) + factory
  (check-valve + side spillway/weir that opens on reverse breakdown);
  `partInfo.ts` (forward ~0.7 V diode / reverse blocks until Vz then clamps; Vz +
  power rows). **EC:** modelled honestly as an ideal cap **in series with a fixed
  0.5 Ω ESR**, built in `buildNetlist` — each `EC` allocates one internal node
  (after pin/junction nodes, bumps `nodeCount`, deterministic by sorted id) and
  emits TWO elements (capacitor `+`→internal, resistor=ESR internal→`−`);
  `elemOfComponent[EC]`→the cap (series current), `nodesOfComponent[EC]`=[+pin,−pin]
  (V across whole part); folded into the topology `sig` so pure moves don't reset.
  `graph.ts PART_KINDS` (cyan, polarized `twoPin("+","−")`, `value` = C, default
  100 µF) + bin + `values.ts` (10 µF…1000 µF); `glyphs.ts` schematic (curved + straight
  plate, "+" mark, charge fill) + factory (ribbed pressure tank, ESR throat at
  inlet); `partInfo.ts` (C + ESR; energy ½CV² + ESR rows). Three `examples.ts`
  builds: **Zener Shunt Reference** (12 V→1 kΩ→ZD→GND clamps ≈5.1 V, ~6.9 mA) and
  **Two LEDs in Series** (9 V→270 Ω→LED→LED→GND, ~19 mA, drops add) under Diodes;
  **Electrolytic Decoupling** (200 Hz AC→D→load∥EC, ripple + ESR can't perfectly
  flatten) under Capacitors & Inductors. All glyph motion rides the bounded
  `o.phase` clock — magnitude is fill/brightness/density/thickness, never speed.
  Full gate set green (44 sim-core tests, golden unchanged).~~

### Done — Schottky + LED web/UI integration (sim types 8/9)
- ~~**Schottky (`SD`) + LED (`LED`) wired through the whole web layer** on top of
  the finished sim-core diode family (`ELEM_SCHOTTKY = 8`, `ELEM_LED = 9`; crates
  untouched). `netlist.ts TYPE_OF SD:8 / LED:9`; `graph.ts PART_KINDS` (SD cyan,
  LED accent) + the App bin; `glyphs.ts` schematic + factory drawers for both
  (Schottky triangle + bent-flag cathode bar / low-loss check-valve; LED triangle
  + radiating arrows + **emit glow keyed to forward current** / gate-plus-beacon);
  `partInfo.ts` SD + LED descriptors (low ~0.3 V vs ~0.7 V; ~1.9 V band-gap drop +
  relative-brightness derived row); two `examples.ts` builds (**LED Current-
  Limiting** ≈20 mA, **Schottky vs Silicon**) under the Diodes category. All glyph
  motion rides the bounded `o.phase` clock — magnitude is brightness/density/alpha,
  never speed. Full gate set green (42 sim-core tests, golden unchanged).~~

### Design ideation (no code) — parts catalog + IC buildings, owner-driven
- ~~**`docs/parts-catalog-ideation.md`** — the discrete/analog menagerie (diode family, real caps, transistor zoo, op-amp, relays/switches, fuses/varistors/thermistors, LED/LDR/7-seg, transformer). Each part: concept, deterministic sim model, schematic symbol, Factorio building, visual-language fit, difficulty + deps. Reduces to **8 new sim primitives**; P1/P5/P6/P7/P8 are independent of the expensive multi-terminal lift (P3). Recommended first 5: per-device params → Schottky → LED → Zener → electrolytic-w/-ESR.~~
- ~~**`docs/ic-buildings-ideation.md`** — ICs as Factorio **assemblers** (named ports + recipe). Fidelity ladder: behavioral black box → macro-model → **player-builds-then-seals-into-a-chip**. Per-IC entries (gates, 555, op-amps, regulators, ADC/DAC, memory, µC, H-bridge). First ICs: logic gates → flip-flop → counters → 555 → linear regulator. The **seal mechanic** is the keystone. Open Qs (controlled sources, the seal's hash contract) left for owners.~~
- [ ] Owner to steer which parts/ICs to build first and the new sim primitives (esp. P3 multi-terminal + P4 controlled sources, which `parts-roadmap.md` already flags).

### Done — animation-rate decoupling, info-panel jitter, belt explainer
- ~~**Flow rate decoupled from magnitude + tps:** animations were unreadably fast at high V/I and high playback; lowering tps didn't help because magnitude still scaled in. One bounded visual flow clock (`FLOW_HZ`) now drives everything, independent of V/I/tps; timeline gives direction only (forward running / sign of tick-change on scrub); magnitude → density + thickness + alpha; carrier/energy slosh preserved via the saturated **sign** of current/power. `glyphs.ts flow()` + `board.ts update()/redrawWires`; spec in `docs/ui/visual-language.md`. Render-only, golden unchanged. (Agent-built, cherry-picked.)~~
- ~~**Info-panel jitter:** the plain explanation embedded live numbers → prose reflowed every frame. Prose now static (`partInfo.ts plain()` arg-free); changing numbers grouped into a "Right now" section. Always-on "carriers & energy" explainer added to the Info tab (covers why energy flows forward when V and I are both negative). New `--energy` token.~~

### Done — interaction polish (#22), carrier/energy belt, demo pages
- ~~**Fixes (#22):** flow-jitter cap (per-frame phase delta + ≤14 chevrons/wire); rotated-part labels against the rotated pin bounds; on-board meter gated to no-value parts (popover shows V·A); top selector chips wrap; **reset-on-edit** rewinds scope+clock to t=0 on any change (`App.onChange`).~~
- ~~**Carrier/energy belt (loop-tile):** two animated layers per wire — carriers (chevrons, integrate signed current → DC stream / AC slosh) + energy (orange dots, integrate signed power v·i → steady delivery on a resistor while carriers slosh, slosh on a reactive part). Per-wire accumulators off the timeline phase, pruned on delete; `docs/ui/visual-language.md` updated. Render-only, golden unchanged.~~
- ~~**Demo pages:** `docs/visuals/resistor.html` + `diode.html`, standalone, dark HUD style (agent-built on `claude/resistor-diode-visuals`, cherry-picked).~~
- [ ] **More demo pages** in the dark style (capacitor, inductor, RC/RL); link them from the app.
- [ ] Optional **toggle** for the energy layer if the belt is too busy on dense boards.

### Done — ammeter, custom rate, progressive guided builds
- ~~**Ammeter**: the Measure tool gains a V/A toggle; "A" reads the current through a clicked part or wire (KCL branch current) — `board.setProbeMode` + `drawAmmeter` + cached per-frame wire currents.~~
- ~~**Guided builds run the sim live** (`startBuild` resumes playback) so each added part comes alive in a working sub-circuit; **examples reworked into progressive/observable builds** (agent) — the buck now: forward path → ragged spike → add diode (spike vanishes) → add cap (smooths to ≈4 V). `steps[]`-only, topology unchanged, `done()` monotonic.~~
- ~~**Custom playback rate**: a ticks/second number input beside the rate presets.~~

### Done — collapsible example categories
- ~~Examples are grouped into collapsible `<details>` categories (Fundamentals / Sources & Current / Capacitors & Inductors / Diodes / Power & Switching) so people can work through them; `examples.ts` exports `EXAMPLE_CATEGORIES` + `categoryOf(id)`. AC categories land with the AC set.~~

### Done — AC track (source + 9-example ground-up curriculum)
- ~~**AC source** (sim-core type 7, `ELEM_ACSOURCE`): ideal sine `5·sin(2π·f·t)`, `value` = frequency, deterministic (pure fn of the tick), golden unchanged; 38 tests incl. sine-tracking, RMS, AC+diode rectifier convergence. Wired into the web: netlist `AC:7`, `PART_KINDS` AC (500 Hz default, "Hz"), animated `drawAC` glyph (circle + sine), bin entry, curated inspector frequencies.~~
- ~~**9 AC examples** (`docs/ui/ac-curriculum.md` → `examples.ts`), build-and-observe, under new categories **AC Fundamentals / Reactance / Filters / Resonance / Rectification**: ac-resistor, ac-rms, ac-cap, ac-ind, ac-lowpass, ac-highpass, ac-resonance, ac-rectifier, ac-supply. Every net + demo hand- and netlist-verified; all frequencies in the 50 Hz–5 kHz band.~~

### Design ideation (no code) — captured, owner-driven
- ~~Game-design exploration of the "Factorio (power-as-belts) + Shapez (contract deliverables)" sandbox: `docs/game-factory-loop.md` (cap=buffer-chest / inductor=flywheel, brownout=backpressure, black-box validated sub-circuits to scale) and `docs/game-contracts-economy.md` (parametric sim-graded contracts for an endless supply, standing production contracts, Credits+Lux + anti-grind firewall).~~

### Done — teaching tools (info drawer + calculators), popover + DMM fixes
- ~~**Component info drawer** (`partInfo.ts` + `infoDiagram.ts` + App): an ⓘ Info tool opens a right-side drawer with a big animated diagram (reuses the glyph drawers at scale in a tiny Pixi sub-app), the governing equation with **live numbers substituted**, a plain "right now" sentence, and derived rows (power/energy/τ/dV·dt) — all from the existing per-frame electrical map, no new wasm crossing.~~
- ~~**Calculators tab** (`calc.ts`): divider / Ohm / RC·RL τ / Xc·Xl / f₀ / RMS, each always showing the **worked substitution** (anti-cheat), with "↤ sel" to fill matching fields from the selected part.~~
- ~~**Value popover fixes**: removed the stray scrollbar (the caret was triggering it — scroll now only on the expanded grid), widened to 320 px with larger chips, and **restored the live "V across · I through" readout** at the top.~~
- ~~**Combined DMM probe**: the Measure "A" probe now reads a part/wire's **current AND voltage together** (with a teaching note that real meters use separate ports).~~

- ~~**Schematic ↔ Factory style toggle** (`docs/ui/teaching-tools.md` Tool 2): a parallel `FACTORY_DRAWERS` map in `glyphs.ts` (cap = buffer chest that fills, source = generator, R = throat, L = flywheel, D = check-valve, SW = door, GND = drain) sharing pin geometry + the same flow/charge animation; `board.setStyle` + `setGlyphStyle` + a toolbar toggle; default schematic. Wiring unchanged across styles.~~

### Pending / owner-driven
- [ ] **Review + integrate the contract prototype** (on worktree branch `worktree-agent-a8d3b4a8b025619c4`, commit `8872b3c`): Test Load judgement part + sweep grader + Contracts tab + Credits. Cherry-pick will conflict with the AC/info-drawer changes — resolve on integration. Then Lux + standing contracts + the firewall.
- [ ] **Sandbox model** (`docs/architecture.md`): per-island adaptive ΔT + shared physical-time clock.
- [ ] Calculator **solve-for → push-back** and the **per-tier Factory reveal** (once competency gates exist).
- [ ] **Sandbox simulation model** (from the ΔT-in-one-sandbox question): shard the sim **per electrical island** (connected component), each with its own **adaptive ΔT** sized to its fastest dynamics; drive the whole board off a **shared physical-time clock** (each island does however many of its own ΔT-steps to reach the target sim-time); wiring two islands merges them to the finer ΔT. MHz comes free per-island; a single ms→GHz *connected* net is the deferred multirate frontier. Capture in `docs/architecture.md`; black-boxing validated sub-circuits is also a ΔT/perf lever. (Owner to steer before building.)
- [ ] **Game MVP** (owner-driven, if greenlit): the smallest "not-a-puzzle" loop — a **parametric contract generator + pin-sampling grader** off the deterministic replay (start with one template, e.g. "hold 5 V ±2% under 0–100 mA").
- [ ] **Selectable / per-example DT** (for RF): DT is a fixed 2 µs global; to reach MHz/GHz cleanly each scenario wants its own DT. Make DT a netlist/scenario parameter (keep the golden pinned at 2 µs). Audio-range AC (≤ ~5 kHz) is fine at 2 µs today.
- ~~**Inspector popup over the component** (`docs/ui/inspector-popup.md`): the value picker now floats as a popover anchored above the selected part — `board.ts` projects `componentBox` through the world transform each frame (`onAnchor`, change-detected, null during gestures/Measure); `App.svelte` positions an absolutely-placed `.value-pop` in `.board-frame` with edge-flip + a caret. Removed from the telemetry panel.~~
- ~~**Incomplete-circuit affordance** (`docs/ui/incomplete-circuits.md`): `buildNetlist` now detects an ideal current source whose forced current has no return path (union-find over non-`I` elements; flags `floatingSources`), and App shows an amber "no return path — complete the loop" warning without halting the sim. (Deterministic solver `singular()` backstop is the remaining refinement.)~~

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
- ~~**LED** wired up with a current-limiting example (and a Schottky added alongside); see the 2026-06-15 Schottky+LED entry above.~~ Still open: other nonlinear parts (Zener, BJT/MOSFET) on the Newton engine.
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

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Invisible Electronics — a unified ideation map

> Synthesis of six independent brainstorms (EMI/crosstalk, AC/DC & HF coupling,
> differential signalling, shielding/guarding, antennas/RF/transmission lines,
> grounding/return paths). This is the owner-facing design that ties them into
> **one** plan: a shared kernel built once, then the six phenomena layered in
> dependency order, all golden-safe by default.
>
> Read alongside `docs/game-ground-returns.md` (the closest existing spec — its
> loop-area term and "bonus-axis" doctrine are load-bearing here),
> `docs/heat-on-the-board-ideation.md` (the new-channel + new-lens + value-path
> template), `docs/ui/visual-language.md` (the V/I channels these must not
> collide with), and `docs/sim/fidelity-ceiling.md` (the "coupling is a placed
> component, not a field solve" ruling).

---

## 1. The unifying thesis

**Every phenomenon in this cluster is a form of coupling — energy crossing
between nets, parts, or loops by a path the ideal simulation does not draw — and
the game's job is to make that invisible path *visible, locatable, and
manageable*.**

The ideal solver the game ships today is honest but *blind* to exactly the
things a real bench engineer spends their career fighting:

- It has **one perfect ground** (node 0 — `crates/sim-core/src/lib.rs:237`,
  `web/src/lib/netlist.ts:802`), so **return current, ground bounce, and ground
  loops are erased**.
- Nets are **union-find sets over pin/junction refs** with **no physical length,
  no loop area, no proximity, no layer** — so **crosstalk, radiated emission,
  shield interception, and transmission-line length cannot exist**.
- The transient solve steps at a fixed **`DT = 2 µs`**, so anything above
  **~62.5 kHz aliases** — and *every* RF, HF-coupling, and fast-edge effect lives
  above that ceiling (`CLAUDE.md` "Two frequency regimes").

The through-line across all six clusters:

| Cluster | What couples | Through what path the ideal sim hides |
| --- | --- | --- |
| **Grounding / returns** | a load's return current ↔ another's reference | shared finite ground impedance (`I·R + L·dI/dt`) |
| **EMI / crosstalk** | an aggressor net's `dV/dt`,`dI/dt` ↔ a victim net | mutual C / mutual L set by proximity & loop area |
| **AC/DC & HF coupling** | one stage ↔ the next, or net ↔ net | a capacitor's `Z_C = 1/jωC` (intentional or stray) |
| **Differential pairs** | the noisy world ↔ a two-wire signal | common-mode pickup; the receiver *subtracts* it away |
| **Shielding / guarding** | aggressor field ↔ a victim's high-Z node | leakage `R`/coupling `C` a guard **intercepts** |
| **Antennas / RF / T-lines** | a conductor ↔ free space, or wave ↔ a mismatch | electrical length & `Z0`: a wire stops being a wire |

So this is not six features. It is **one model of coupling** (net-to-net, loop,
and field), seen through **a few new lenses and instruments**, expressed almost
entirely in **presentation + the analytic frequency domain + Real-mode unhashed
parameters** — with the *one* ideal assumption (perfect ground) preserved by
default and broken only as an explicit, mode-gated opt-in.

The pedagogy is consistent too: **the ideal sim teaches that circuits *work*;
this cluster teaches why they *fail in the real world* — and that the fix is
geometry, impedance, and shielding, not luck.** It is the EMC/SI capstone of the
curriculum `docs/game-progression.md` Era 6 ("Design Rules") already names.

---

## 2. Shared infrastructure to build ONCE

This is the highest-leverage insight in the synthesis: **the six clusters are
~80% the same plumbing.** Build these primitives once and each phenomenon
becomes a thin configuration of them. Each piece below names its hook.

### (a) The grid-geometry / adjacency layer — `web/src/lib/geometry.ts` (NEW)

The single missing input every cluster needs. The board *looks* 2-D but is
electrically a graph; this module makes the drawn layout *measurable*, **purely
web-side, integer-only, deterministic** — the discipline
`docs/game-ground-returns.md:303` already commits to ("integer in, integer out,
no floats from geometry, no hashing").

Derive **everything from data the player already drew** — no new persisted
fields for the first cut:

- **Trace path & length** — every wire carries ordered `Wire.waypoints?: Cell[]`
  (`web/src/lib/graph.ts:344-356`), explicitly cosmetic today. A net's geometry
  is the union of its wires' cell-paths; **length = Σ Manhattan cell steps**.
- **Proximity / parallel-run length** (crosstalk, shield coverage) — for two
  nets, the count of cells where their routed segments run within *N* cells
  (an integer grid-distance scan over `waypoints` + pin cells `graph.ts:22`,
  component `cell` `graph.ts:46`).
- **Enclosed loop area** (radiated emission, ground loops, ground-loop hum) —
  walk the forward+return cycle in the wire/junction graph and apply the
  **shoelace formula on integer grid coordinates** — *exactly*
  `game-ground-returns.md:303-306`.
- **Enclosure test** (guard ring / shield / can) — integer cell membership of
  pins inside vs. on-the-ring vs. outside a rectangular guard extent — the same
  "which pins fall inside" integer test as the planned ground-zone tool
  (`game-ground-returns.md:240`).

**Output contract:** a small set of deterministic scalars per net-pair / per-loop
/ per-enclosure (`proximity`, `parallelLen`, `loopAreaCells`, `enclosedPins`).
These feed the estimator (b), the lenses (c), and contract grading — and are
**never hashed**. Only if true layer/plane semantics are later wanted do we add
one explicit additive field (`Wire.layer` / `isGroundPlane` on `graph.ts`) —
flagged, not built.

### (b) The net-to-net coupling estimator — `web/src/lib/coupling.ts` (NEW)

One function family that turns geometry (a) + the already-computed per-element AC
readout into coupling strengths, mirroring the loop-area noise figure
(`game-ground-returns.md:300`). **It reads, never writes, sim state.** Inputs it
already has for free:

- **Aggressor slew** — `dV/dt ≈ vamp·ω`, `dI/dt ≈ iamp·ω` from the per-element
  `acMeasurements` block already crossing the boundary every frame
  (`web/src/sim/loop.ts:36`, `:104` `acElementMeasurements`). Zero new sim work.
- **Aggressor/victim labels** — the engine already computes `NetClass`
  (`Analog`/`Digital`/`Boundary`, `crates/sim-core/src/lib.rs:2091`). Fast
  `Digital` nets = aggressors; quiet `Analog` nets = victims. A *free* classifier.
- **Signed per-element current** — `element_currents()`
  (`crates/sim-core/src/lib.rs:7276`), surfaced unhashed via the snapshot
  `state` (`web/src/sim/loop.ts:116`) — for return-path tracing and `I·A`.

The estimator emits: `crosstalk(victim←aggressor)`, `emission(loop)`,
`conducted(victim)` (shared-return), `leakage(node)` and `Γ`/`VSWR`/`standing
wave` for ports. Each cluster picks the terms it needs. This is the single place
the "coupling figure" scalar lives.

### (c) The "disturbance / noise" visual channel — a NON-colliding cue family

The three channels are taken (`docs/ui/visual-language.md`,
`docs/heat-on-the-board-ideation.md`): **voltage** = identity hue + magnitude bar/
standpipe **on nets** (`board.ts:4843` `drawNetBars`, `:4992`
`drawNetStandpipes`); **current** = chevron flow + thickness + number **on
conductors** (`board.ts:4536`); **heat** (proposed) = warm emissive **on bodies**.

The shared *fourth* channel for this whole cluster: **coupling lives in the
GAPS between conductors and as a corruption envelope on victim nets — never on
the conductor fill, never as a rail hue.** The reusable cues:

- **Coupling filament / arc** — a faint **dashed hairline with crawling chevrons
  across a gap that has no wire** (current going where no copper is). Reuses the
  chevron-flow vocabulary on a *non-wire* edge. Serves crosstalk arcs, leakage
  filaments, and shield interception. Pre-attentive: "energy is jumping the gap."
- **Victim fuzz envelope** — a thin oscillating envelope *on top of* the victim's
  steady voltage bar/standpipe ("this should be flat but isn't"). Serves EMI
  pickup, common-mode noise, ground bounce. Distinct from the steady magnitude
  height.
- **Loop/area wash** — a translucent hatched fill of an enclosed polygon, amber→
  red past a threshold (the IR-drop `--warn` precedent,
  `visual-language.md:94`). Serves radiated emission, ground loops.
- **Radiation halo** — a soft additive glow in the **cell margin** (the one
  region no channel paints) with outward-rippling wavefronts on the bounded
  `FLOW_HZ` clock. Serves antennas/accidental radiators. Cool RF-teal, *not* a
  rail hue.

### (d) New LENSES — extend `BoardLens` (the established precedent)

`board.ts:88` `export type BoardLens = "schematic" | "analogy" | "reality";` set
via `setLens()` (`:1110`), gated at `effLens` (`:1949`, `:4335`). The proposed
`"thermal"` lens (`heat-on-the-board-ideation.md`) is the precedent. Add a small
family, each desaturating the board (dropping rail hues + carriers) and painting
*one* coupling story at full strength — mutually exclusive, opt-in:

- **`"emi"`** (the workhorse, shared by EMI/crosstalk/shielding/differential):
  aggressor strength on nets, coupling arcs/filaments, victim fuzz, loop wash,
  shield moats — "see the whole coupling budget."
- **`"return"`** (grounding): forward traces dim, return paths + ground metal
  light up; the least-impedance return **morphs with the source frequency**
  (resistive shortest-copper at DC → directly-under-the-trace at HF).
- **`"rf"`** (antennas/T-lines): traces draw with **electrical length in λ** as
  the magnitude cue, radiation halos bloom, standing-wave envelopes ripple; the
  whole board shifts to a field aesthetic. Frequency-aware — drag the picker up
  and a quiet trace blooms into an antenna.

One lens-extension mechanism; three (eventually) views. The `"frequency"`/`"Z"`
view from the coupling brainstorm folds into `"rf"`/`"emi"` rather than being a
fourth.

### (e) The FREQUENCY-DOMAIN emphasis — route ALL HF to `ac_solve`, never the alias

The non-negotiable shared rule. The transient solve aliases above ~62.5 kHz
(`DT = 2 µs`), and **crosstalk, HF coupling, differential CMRR rolloff, shield
displacement current, transmission-line reflection, radiated emission, and
inductive ground bounce all live at kHz–GHz.** Every one of them MUST read the
analytic path the engine already has and barely exploits:

- `ac_solve_models(omega, real)` (`crates/sim-core/src/lib.rs:6877`) — the
  complex MNA where cap ESR/ESL, R_ESL, inductor DCR/Cw are already stamped
  AC-only; the home for any new HF coupling stamp.
- `ac_sweep` (`:7106`) → the **Bode** plot (`web/src/lib/bode.ts`).
- `ac_element_measurements(omega, real)` (`:7130`) → per-element `[Vamp, Iamp,
  phase, |Z|, …]`, crossing as `acMeasurements` (`loop.ts:104`) → the **phase
  scope** (`web/src/lib/phaseScope.ts`, plotted vs θ so it is legible at any
  frequency).

A standing open item this cluster should close: the board adopting
`acElementMeasurements` above the ceiling for its shimmer/phasor is still
half-done (`docs/ui/high-frequency-render.md:165` "Still open") — every HF
phenomenon here is a reason to land it.

### (f) New INSTRUMENTS — Canvas2D panels, modelled on `bode.ts` / `phaseScope.ts`

All are **pure presentation** — each draws a flat buffer from an `ac_*` read or a
web estimator; none touch the boundary beyond the existing `acSweep` /
`acElementMeasurements` calls (`loop.ts:207`):

- **Spectrum analyser** (`web/src/lib/spectrum.ts`) — dBµV vs log-f from the
  `ac_sweep` harmonics, with an **FCC/CISPR-style limit line**; bars over the
  line glow `--bad`. Shared by EMI emissions and RF.
- **Smith chart + TDR** (`web/src/lib/smith.ts`, `tdr.ts`) — Γ inside the unit
  circle; a synthetic reflection time-line reconstructed from Γ + derived line
  delay (drawn against a normalized round-trip axis, **not** the aliasing
  transient). For antennas/T-lines.
- **Differential / common-mode probe + CM/DM decomposition view** — `V+−V−` and
  `(V+ +V−)/2` readouts (JS arithmetic on `state`), plus a `phaseScope.ts`
  sibling plotting `V_cm(θ)`/`V_dm(θ)`. For differential.
- **Insulation-resistance / leakage meter** — `R_iso`, `I_leak` per high-Z node
  (reuses the `meter`/`failText` text widgets). For shielding/guarding.
- **VSWR / EMI / ΔV(GND) badges** — single-number + green→amber→red bar, reusing
  the `--ok`/`--warn`/`--bad` droop vocabulary. Per cluster.

### Shared kernel summary

| Shared piece | New module / hook | Reused by |
| --- | --- | --- |
| Grid geometry (length/proximity/area/enclosure) | `web/src/lib/geometry.ts` over `graph.ts` `waypoints` | all six |
| Coupling estimator | `web/src/lib/coupling.ts` over `acMeasurements`+`NetClass`+`element_currents` | EMI, coupling, differential, shielding, RF, grounding |
| Disturbance cue family | `board.ts` render passes (filament/fuzz/wash/halo) | all six |
| Lens family | `BoardLens` `+ "emi" \| "return" \| "rf"` (`board.ts:88`,`1110`) | all six |
| Frequency-domain routing | `ac_solve_models`/`ac_sweep`/`ac_element_measurements` (already exist) | all HF effects |
| Instruments | `spectrum.ts`,`smith.ts`,`tdr.ts`, CM/DM view, leakage meter | per cluster |
| Golden-safe param/flag pattern | Real-mode `buildNetlist` emit (`netlist.ts`), `Element::params` slot, `flag_and_clamp_fails` | all six |

---

## 3. Dependency order (the DAG, in prose)

The clusters are not independent — they stack on two foundations.

**Foundation A — the shared kernel (§2).** Nothing ships without the geometry
layer, the coupling estimator, at least one new lens, and the disturbance cue
family. This is the root of the DAG.

**Foundation B — grounding / return paths.** This is the *substrate*. A real
return path and a non-ideal ground are the physical basis for:

- **conducted EMI / shared-impedance crosstalk** (the aggressor's return current
  through a shared `Z` *is* the coupling — `game-ground-returns.md` rung 1
  produces it for free once returns are real);
- **ground bounce** feeding logic glitches and differential reference shifts;
- **shielding** (a shield/guard is only as good as its ground strap; the plane is
  simultaneously return + shield);
- **the return-loop area** that the **antenna/EMI** emission term integrates.

So: **kernel → grounding/returns → {EMI/crosstalk, differential rejection,
shielding}**. EMI's mutual-C/mutual-L coupling and differential's common-mode
pickup both *consume* the geometry (loop area, proximity) that the grounding work
first makes real.

**The frequency-domain branch.** **AC/DC & HF coupling** is the gentlest
on-ramp to the analytic regime — it is *already* mostly implemented (the cap's
`Z_C` + ESR/ESL self-resonance are stamped today). It proves the
frequency-domain instruments and the "AC path ≠ DC path" idea, and it underpins:

- **antennas / RF / transmission lines**, which are the *showcase* of the
  frequency-domain tools (Smith/TDR/spectrum) and add the one genuinely new
  solver element (`ELEM_TLINE`).

So the second spine: **kernel → AC/DC & HF coupling (instruments + freq regime)
→ antennas/RF/transmission-lines**. RF also feeds back into EMI (an unterminated
stub or a big loop is the *radiator* whose field EMI then couples into a victim —
the two clusters share the `"emi"`/`"rf"` lenses and the emission term).

**Differential** sits at the confluence: it needs grounding (common-mode is
referenced to a noisy ground), the coupling model (the pickup it rejects), and
the frequency domain (CMRR rolls off with frequency). It is the *mitigation half*
of the EMI curriculum — "when you can't fix the ground, make the signal immune."

Compact DAG:

```
            ┌─────────────── kernel (§2) ───────────────┐
            │                                            │
   grounding / returns  ───────────►  EMI / crosstalk    │
            │   │                          ▲   │         │
            │   └──► shielding / guarding ──┘   │         │
            │                                   ▼         │
            └──────────────► differential rejection       │
                                                          │
   AC/DC & HF coupling (freq regime + instruments) ───────┘
            │
            └──► antennas / RF / transmission lines ──► (radiates into EMI)
```

---

## 4. Unified phased roadmap

Smallest shippable shared kernel first, then phenomena in dependency order. Each
phase is concrete about what lands.

### Phase 0 — Shared kernel, zero solver change, **golden byte-identical**

- `web/src/lib/geometry.ts`: length / proximity / loop-area (shoelace) /
  enclosure off `graph.ts` `waypoints` + cells. Integer, deterministic.
- `web/src/lib/coupling.ts`: the estimator skeleton reading `acMeasurements`,
  `NetClass`, `element_currents` — emits per-pair/per-loop scalars.
- The **disturbance cue family** in `board.ts` (filament, fuzz, wash, halo) wired
  but driven by the estimator.
- One HUD **EMI/EMC gauge** + a **compliance bar** (`App.svelte`).
- **Return-path highlight** (grounding Phase 0): walk `element_currents` from a
  selected element back to its source, draw the return leg as marching-ants.
  *Highest teaching-per-line; pure render.*

Ships the headline lessons "every fast edge is a transmitter" and "the circuit is
a closed loop" immediately, with no golden risk.

### Phase 1 — The lenses + AC/DC & HF coupling instruments (presentation + freq regime)

- Add `"emi"`, `"return"`, `"rf"` to `BoardLens` and the `setLens`/`effLens`
  branches (the cheapest is `"emi"` + `"return"` first).
- **AC/DC & HF coupling**, the gentle freq-domain on-ramp (mostly read-only):
  the cap pass/block glyph cue, the DC-wash vs AC-wash overlay, coupling/SRF/
  bypass-band markers on the **Bode** plot (data `ac_sweep` already returns), the
  **|Z|-vs-f** trace, the rail **ripple-residue** readout. A concept card fires on
  first series-cap-into-a-biased-stage.
- The **spectrum analyser** panel (`spectrum.ts`) with the FCC limit line.

All presentation over existing analytic reads. Golden untouched.

### Phase 2 — Grounding non-ideality + EMI/crosstalk coupling (Real-mode, golden-safe)

- **Grounding**: ground-loop detection + area wash + ΔV(GND)/Z_common readouts;
  the `"return"` lens frequency-morph (resistive↔under-trace), gated to the
  frequency-domain view; a **ground rating FLAG** via a new slot in
  `flag_and_clamp_fails` (flag-only, unhashed).
- **AC ground-segment inductance** stamped in `ac_solve_models(_, real)` only —
  AC-only + unhashed; inductive bounce becomes physically true on Bode/phase-
  scope. Transient golden byte-identical.
- **EMI/crosstalk**: the coupling arcs + victim fuzz go live off the estimator;
  loop-antenna shading (reuse the shoelace area). Optional **emissions FAIL flag**.

### Phase 3 — Differential + shielding (mostly presentation; one Real-mode op-amp slot)

- **Differential**: the diff/CM probes + CM/DM decomposition view (pure JS over
  `state` + `ac_sweep`); the twisted-pair bonded ribbon glyph + common-mode-halo
  / anti-phase shimmer; **finite CMRR** as a new `Element::params` slot on the
  op-amp (default `0` = today's infinite CMRR = golden-identical; Real-mode only),
  with an AC CMRR-rolloff stamp in `ac_solve_models`. Common-mode injector via
  web-expansion to two equal `ELEM_ACSOURCE`s.
- **Shielding/guarding**: auto-emitted leakage `R_leak` (huge `ELEM_RESISTOR`,
  Real-mode) + the dashed leakage filament + `I_leak` readout; the **driven guard**
  is an existing `OA` follower (emergent — chevrons stall as ΔV→0); the grounded
  guard ring / shield as a placeable moat; the capacitive `Cc` re-split through a
  shield node in `ac_solve_models`.

### Phase 4 — Antennas / RF / transmission lines (one new AC-only element + instruments)

- **`ELEM_TLINE = 26`** (next after `ELEM_BEHAVIORAL = 25`) stamping the
  telegrapher 2-port Y-parameters **only in `ac_solve_models`** (transient =
  no-op pass-through → transient golden byte-identical). Electrical length ℓ
  derived from grid `waypoints`; `Z0`/`vprop` from a `variant` picker.
- **Smith chart + TDR + VSWR** instruments; the `"rf"` lens halo + standing-wave
  envelope; loop-area extraction feeding the radiated-power estimate.
- **EMC/RF contract family** + (optional) a radiation FAIL flag — the bridge that
  closes RF back into EMI.

### Phase 5 — Richer fidelity (only where gameplay proves the need; the only golden-moving steps)

- Tiered receiver variants (instrumentation-amp / RS-485 / LVDS) and/or a
  dedicated `ELEM_DIFFRX`; finite DC ground network (Real-mode netlist
  expansion). Each is additive, mode-gated so default==today, with a regenerated
  golden + PR rationale. **Deferred by default.**

---

## 5. Cross-cutting determinism strategy (one policy)

**The default path for every phenomenon in this map is, in strict order of
preference:**

1. **Pure presentation.** Lenses, cues, instruments, and web-side estimators read
   unhashed outputs only — `ac_*` measurements (analysis-only, never hashed —
   their own doc-comments at `lib.rs:6874` say so), `element_currents`
   (`:7276`, snapshot-only), and grid geometry. By construction this touches
   neither `node_v` nor `snapshot_hash`. **The golden is byte-identical; no
   regeneration.** This covers the entire shared kernel and the bulk of every
   cluster. *(The hash folds only tick, node voltages/levels, and sequential
   element state — `lib.rs:7353-7404`; AC outputs, currents, and the FAIL mask
   are excluded.)*

2. **Real-mode AC-only / unhashed parameters.** Any frequency-dependent
   non-ideality is stamped **only inside `ac_solve_models(omega, real)`** — the
   exact envelope of cap ESR/ESL (`CAP_ESL` `lib.rs:2694`), R_ESL (`:2701`), and
   inductor DCR/Cw. The transient solve never reads it, so the **transient golden
   is untouched**. Targets here: EMI mutual-C/mutual-L, AC ground inductance,
   shield `Cc`, CMRR rolloff, the `ELEM_TLINE` telegrapher stamp. The param lives
   in a `0`-default `Element::params` slot (`PARAM_STRIDE = 8`, `:2592`;
   `param_or` `:2712`) and is installed Real-mode-only via `buildNetlist`
   (`TRANSIENT_TIER_KINDS` precedent, `web/src/lib/tiers.ts:127`).

3. **Real-mode netlist expansion from existing primitives.** Leakage = a huge
   `ELEM_RESISTOR`; stray coupling = a tiny `ELEM_CAPACITOR`; common-mode
   disturbance = two equal `ELEM_ACSOURCE`s — all emitted **Real-mode-only** from
   `buildNetlist`, the EC→cap+ESR / PULSE→ACSOURCE / POT→two-R precedent. The
   **Ideal-mode netlist is byte-identical**, so the canonical (Ideal) golden never
   moves; keep these **AC-only** (frequency-domain tools + lenses, never stamped
   into the transient MNA) and even the Real-mode transient golden is untouched.

4. **FAIL-style flags.** Any "you exceeded a limit" (emissions over the line,
   guard buffer over-stressed, ground segment over-budget, radiation FAIL) reuses
   the `flag_and_clamp_fails` mask via a `0`-default param slot
   (`RATED_CURRENT_SLOT` precedent, `lib.rs:2452`/`:6803`). `failed_elements` is
   **not in `snapshot_hash`** and only *flags* — never alters the solve.
   Golden-safe.

**Reserve a hashed sim-core change — additive, mode-gated so default==today, with
a regenerated golden + PR rationale per `CLAUDE.md` golden rule 1 — only where
fidelity truly demands the *transient* solve change, and only after the web/AC
model has proven the gameplay.** The named candidates, all Phase 5+ and all
deferred:

- **A finite DC ground network** (ground series-R + private nodes) — needed only
  if DC ground-bounce gameplay (below the alias ceiling) must be physically true
  rather than estimated. Moves only the *Real-mode* golden.
- **A dedicated `ELEM_DIFFRX`** (RS-485 fail-safe / LVDS current-mode) — only if
  the op-amp-with-CMRR macromodel proves too coarse.
- **A transient distributed line** (delay-line companion that steps) — explicitly
  a **non-goal**: it would move the golden and contradicts the thesis that RF
  lives in the analytic regime.

**The one shared hazard** (same as the heat doc): if any web-side parameter is
ever made a function of *accumulated* state (humidity drift, temperature),
the integrator must be **strictly tick-driven** (fixed Δt, identical native==wasm
float math), never wall-clock, and never feed a display phase
(`carrierOffset`-style) back into the solve. Keep estimator inputs static-per-
geometry in v1 and the hazard does not arise.

---

## 6. Completeness pass — other "invisible" phenomena on this map

The six clusters cover coupling and geometry. These adjacent invisibles round out
the curriculum; each notes its representation and whether it reuses the kernel.

| Phenomenon | Lesson | One-line representation | Reuses kernel? |
| --- | --- | --- | --- |
| **Thermal/Johnson noise + the noise floor** | every R at T>0 emits `√(4kTRB)`; SNR is finite | a **noise-floor band** on the scope/spectrum (a hatched grass under the signal); the spectrum's baseline | Yes — spectrum instrument (f) + Real-mode unhashed estimate; deterministic seeded per element id |
| **Jitter / timing & eye diagrams** | edges arrive early/late; data closes the "eye" | an **eye-diagram instrument** (overlaid edges) + edge-fuzz cue on digital nets | Yes — instrument family (f) + the disturbance cue (c); seeded jitter (`jitter(id)` precedent) |
| **Power integrity / PDN impedance** | the rail is a network with `Z(f)`; transients sag it | a **PDN |Z|-vs-f panel** + rail-ripple readout; the "decoupling band" | Yes — directly extends AC/DC coupling + grounding; `ac_sweep` |
| **Aging / drift / tolerance** | parts wander with time/temp; spec is a band not a point | a **±band on values** + a "drift" overlay in the inspector | Partly — Real-mode value-path (resistor tolerance `jitter` already exists); tick-driven if animated |
| **ESD** | a fast kV transient punches through | a **strike event** (bright filament to a victim pin) + a clamp/TVS FAIL flag | Yes — disturbance cue (c) + FAIL flag; ties to varistor (`ELEM_VARISTOR`) |
| **Microphonics / piezo** | mechanical vibration → voltage (esp. ceramics, cables) | a **vibration shimmer** on affected parts + an injected disturbance | Yes — disturbance cue + Real-mode AC injection |
| **Dielectric absorption ("soakback")** | a cap "remembers" charge after discharge | a **slow recovery curve** on the cap's voltage after a dump | New small transient state (multi-time-constant companion) — Phase 5+, golden-moving |
| **Settling / aliasing** | sampled systems fold HF; settling is finite | the existing **literal-render aliasing toggle** + a settling-time readout | Yes — already partly shown; the alias ceiling *is* the teaching moment |
| **Metastability** | a flip-flop caught mid-edge hangs undecided | a **flicker/undecided cue** on the FF output + a MTBF readout | New hashed sequential state — Phase 5+, golden-moving |

The pattern holds: **the analog/field ones (noise, jitter, PDN, ESD,
microphonics, drift) all reuse the shared kernel** (estimator + cue + instrument +
Real-mode-unhashed/flag), while the few with genuine *memory* (dielectric
absorption, metastability) are the only ones that would justify hashed transient
state — and belong, like the cluster's own Phase 5, behind a regenerated golden.

---

## 7. Recommendation — the single best first build

**Build the shared kernel (§2 a–d) and prove it with grounding's return-path
highlight + the EMI/EMC gauge — i.e. Phase 0 in full.**

Why this is the right first build:

1. **It is the root of the entire DAG.** The geometry layer (`geometry.ts`), the
   coupling estimator (`coupling.ts`), the disturbance cue family, and the lens
   mechanism are reused by *all six* clusters. Building them first means every
   subsequent phenomenon is a thin configuration, not a new system.

2. **Grounding/return-paths is the substrate** the most clusters depend on, and
   its flagship feature — the **return-path highlight** — is the highest
   teaching-per-line in the whole map: a render-only walk of `element_currents`
   (`lib.rs:7276`, already unhashed and crossing the boundary as snapshot `state`,
   `loop.ts:116`) that draws the loop the player has never seen. It needs **zero
   sim-core change** and proves the geometry + cue plumbing on real data.

3. **It is provably golden-safe** — pure presentation reading only unhashed
   outputs, so `cargo test -p sim-core` (incl. `run_is_reproducible`) cannot move,
   and the canonical RC golden is byte-identical.

4. **It de-risks the one true unknown** — whether grid `waypoints`-derived
   geometry is good enough to drive the coupling estimator. If the kernel proves
   out here on the simplest phenomenon (return paths) and the simplest cue
   (loop highlight), every richer phenomenon inherits a validated foundation; if
   geometry needs explicit fields, we learn it cheaply, before any solver work.

5. **It immediately delivers the thesis** — "make the invisible visible." The
   player selects a part and *sees the return current close the loop*; flips to
   the `"emi"` lens and *sees a fast trace radiating into a quiet neighbour*.
   That single session teaches lessons from three clusters at once with no golden
   risk and no new sim element.

The second build, once the kernel is validated, is **AC/DC & HF coupling
instruments (Phase 1)** — the gentlest entry into the analytic frequency domain
(the cap's `Z_C`/SRF physics already exists), which lights up the Bode/spectrum
tooling that antennas/RF and EMI then inherit.

---

### Key modules cited

- **Solver / analytic regime:** `crates/sim-core/src/lib.rs` — `ac_solve_models`
  (`:6877`), `ac_sweep` (`:7106`), `ac_element_measurements` (`:7130`),
  `flag_and_clamp_fails` + `RATED_CURRENT_SLOT` (`:6776`,`:2452`,`:6803`),
  `snapshot_hash` exclusions (`:7353-7404`), `element_currents` (`:7276`),
  `NetClass` (`:2091`), `Element::params`/`PARAM_STRIDE`/`param_or`
  (`:2580`,`:2592`,`:2712`), `CAP_ESL`/`R_ESL` (`:2694`,`:2701`), `ELEM_*` block
  (`:315-1016`; next free = 26), single ground node (`:237`).
- **Boundary:** `web/src/sim/loop.ts` — `Snapshot` w/ `failedMask`/`acMeasurements`
  (`:18`,`:31`,`:36`), `acSweep`/`acElementMeasurements` (`:98`,`:104`,`:207`),
  `state` (`:116`).
- **Geometry source:** `web/src/lib/graph.ts` — `Pin` (`:17`), `Component`
  (`:46`), `Wire.waypoints` (`:344-356`).
- **Netlist / Real-mode emit:** `web/src/lib/netlist.ts` — `buildNetlist`, ground
  assignment (`:802`); `web/src/lib/tiers.ts` — `tierParams`/`hasTiers`
  (`:127`,`:136`), `TRANSIENT_TIER_KINDS`; `web/src/lib/diodes.ts` (variant/rating
  precedent).
- **Lens / channels:** `web/src/lib/board.ts` — `BoardLens` (`:88`), `setLens`
  (`:1110`), `effLens` (`:1949`,`:4335`), current flow (`:4536`), net gauges
  (`:4843`,`:4992`).
- **Instruments to model on:** `web/src/lib/bode.ts`, `web/src/lib/phaseScope.ts`.
- **Governing docs:** `docs/game-ground-returns.md` (loop-area shoelace `:303`,
  ground-zone tool `:240`, bonus-axis doctrine `:339`, display-grade-first
  `:423`), `docs/heat-on-the-board-ideation.md` (new-channel/new-lens/value-path
  template), `docs/ui/visual-language.md` (V/I channels), `docs/sim/fidelity-
  ceiling.md` (coupling = placed component), `docs/ui/high-frequency-render.md`
  (`:165` "still open" board AC-measurement swap), `docs/game-progression.md`
  (Era 6, where EMC becomes gradable), `CLAUDE.md` ("Two frequency regimes",
  "Realistic-mode gate", golden rule 1).

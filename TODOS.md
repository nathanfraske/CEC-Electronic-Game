# TODOS

Append-only work log. Newest day at the top. Completed items are **tombstoned**
(struck through with `~~...~~`) and kept for history — never deleted. Open items
use `[ ]`. This file is maintained by agents; see CLAUDE.md for the rule.

---

## 2026-06-19 (19) — Device-variety frontier: diode types + current rating/FAIL (increment A)

Owner audit flagged the engine's real gap is **device variety**, not the tier axis. Four
workstreams chosen: (A) diode types + ratings, (B) LED colour, (C) waveform/pulse source, (D)
diode reverse-recovery. This is **A**.

- ~~**Per-device diode forward params** — `diode_model(&Element)` reads `Is` (slot 0) and `n`
  (slot 1) via `param_or`, so one diode kind becomes a family. Golden-safe (slot 0 → kind
  default). Test `diode_is_param_sets_forward_drop`.~~
- ~~**Diode TYPE picker** (`web/src/lib/diodes.ts`): Rectifier / Switching / Fast-recovery /
  Power, each a preset of forward `Is`/`n` + a current rating. `Component.variant` selects it;
  inspector shows the picker + rating. Variant 0 = the silicon default (existing diodes
  unchanged).~~
- ~~**Component current rating → FAIL** — general `RATED_CURRENT_SLOT` (slot 2) read for every
  element in `flag_and_clamp_fails`; `|I| > rated` boxes the part. `0` = unrated (Ideal mode +
  default), so golden-safe (not hashed). Rating installed web-side only in Real mode. Test
  `diode_over_rated_current_flags_fail`.~~
- ~~**Copy/paste now carries `tier` + `variant`** (the noted polish) — clipboard snippet +
  paste reconstruction.~~
- ~~**(B) LED colour** — `variant` → per-colour forward voltage (red ~1.9 / yellow / green /
  blue / white ~3.1 V, via `Is`) + glyph tint (`ledTint` in the board render) + a ~30 mA rating.
  Reused the diode forward-param plumbing (buildNetlist auto-emits once LED joined the variants
  map). Test `led_colour_is_sets_higher_forward_drop` (blue's extreme small Is converges).~~
- ~~**(C) Waveform / pulse source** — a dedicated **Pulse / Clock Gen** part: unipolar square
  (duty-controlled) + triangle, adjustable frequency + duty. Implemented by mapping the web
  `PULSE` kind to `ELEM_ACSOURCE` with a **waveform param** (slot 1: 1 square / 2 triangle, slot
  3: duty) — `ac_source_emf` grew the square/triangle branches (default slot 1 = 0 = sine, so
  the AC source + golden are untouched). New `Component.duty` field, glyph `drawPulse`, inspector
  (level + waveform + duty slider). Tests `pulse_source_emits_square_wave` / `_triangle_wave`.~~
- [ ] **(D) Diode reverse recovery (trr)** — dynamic stored-charge state; reverse-recovery
  spike on switch-off. New reactive state, determinism-sensitive. Hardest; last.
- [ ] **Follow-on:** ratings for SD/LED/ZD (LED especially — easy burnout) once (B) lands;
  reverse-voltage (Vrrm) rating + avalanche FAIL; inspector "actual value" readout for a
  deviated resistor.

## 2026-06-19 (18) — Quality-tier rollout COMPLETE (all gradeable parts ship tiers)

The budget/mid-range/high-end/lab-grade quality tiers now cover **every gradeable component**,
each non-ideality gated on the global **Real (realistic) fidelity flag** (Ideal mode = nominal
part regardless of tier). See CLAUDE.md "Component grades (tiers)".

- ~~**Op-amp GBW, cap ESR/ESL, inductor DCR/Cw** — AC-only params, gated in sim-core
  `ac_solve_models(omega, real)`.~~
- ~~**Electrolytic ESR (`ecEsr`), resistor tolerance (`resistorTolerance` + deterministic
  per-id `jitter`)** — web-expansion kinds, applied in `buildNetlist` (R deviation Real-only).~~
- ~~**Source output impedance (V / AC)** — first transient param; sim-core branch stamp
  `mat[bi][bi] -= e.params[0]`; gated web-side in `buildNetlist` (Real only).~~
- ~~**MOSFET Kp (NM/PM), BJT β (Q/QP)** — `mosfet_op`/`bjt_op` now take `&Element` and read
  `param_or(&e.params, 0, MOS_KP/BJT_BF)`; tiers in `tiers.ts`; gated web-side via
  `TRANSIENT_TIER_KINDS` (Real only). Tests: `bjt_beta_param_pulls_collector_lower` (base via
  RB so Ic = β·Ib actually moves the collector). 122 sim-core tests green.~~
- **Transformer — assessed, deliberately NOT tiered.** The ideal-T model hard-couples the
  secondary (no series Is term) for full-wave-rectifier stability, so its safe knobs
  (`rp`/`Lmag`) don't droop the loaded output, and the knob that would (secondary leakage) is
  the inrush-stability control. A meaningful, safe transformer tier would need the model to
  expose load regulation, which it intentionally doesn't. Left for a future model change.

Remaining Real-variant work beyond tiers (separate from the quality grade): diode series Rs,
inductor saturation — see (the now mostly-done) item below.
- [ ] **Follow-up polish:** inspector "actual value" readout for a Real-mode deviated resistor
  (so the deviation isn't a mystery); ~~copy/paste carrying `tier`~~ (done in (19)).

## 2026-06-19 (17) — Frequency-domain AC analysis engine (sim-core)

- ~~**AC sweep engine** (`Sim::ac_solve(omega)`) — complex MNA for the passive network (R→G,
  C→jωC, L→jωL branch, V-source short, AC source stimulus); returns complex node voltages at any
  frequency, no time-stepping / no Nyquist wall. `Cplx` + `solve_dense_complex` added. Pure
  analysis, doesn't touch the hash. Tests: RC corner (−3 dB/−45°/−20 dB-dec), LC resonance.~~
- ~~**Wasm binding** — `Sim::ac_sweep(freqs)` + `Simulation::ac_sweep` + `SimHandle.acSweep`;
  flattened [re,im] per node per freq. Test `ac_sweep_matches_pointwise_solve`.~~
- ~~**Bode panel** (web) — `lib/bode.ts drawBode` (dBV vs log-f, decade grid, scope colours) in a
  Telemetry "Frequency response" section; recomputed on netlist change when an AC source exists.
  PNG-verified (RC knee, LC peak). Not yet eyeballed live.~~
- [ ] **Bode polish** — phase trace (second plot / toggle), corner-frequency markers, a
  transfer-function (Vout/Vin, 0 dB) mode, |Z|-of-selected-part mode. Hover readout.
- ~~**Nonlinear small-signal in `ac_solve`** — diode/varistor/MOSFET/BJT companions stamped at
  the transient solver's settled operating point (mirrors `newton_iterate`, real partials, no jω
  since no internal device C). Tests: diode divider, MOSFET CS gain, BJT CE (exact 2-node
  cross-check). Bode panel shows amplifier response with no UI change.~~
- ~~**Op-amp small-signal + GBW pole in `ac_solve`** — output diag +Gout, transconductance
  Gout·dT/(1+jω/ωp), ωp=2π·GBW/A0, GBW=1 MHz. AC-only (transient algebraic → golden safe). Test:
  inverting amp gain Rf/Rin, −3 dB at GBW/(1+Rf/Rin). (#118)~~
- ~~**Ideal/Real parasitics (AC, functional)** — `ac_solve_models(omega, real)`: cap ESL+ESR+C
  series (SRF → inductive), inductor DCR + parallel Cw (SRF → capacitive). `ac_sweep`/`acSweep`
  take `real`; App Bode "Ideal/Real" toggle; sweep widened to 1 GHz. Analysis-only (golden safe).
  Tests + PNG (SRF notch+rise).~~
- [ ] **Analogy "parasitic sleeve" rendering** (next) — subtle always-on ESR grit-throat / ESL
  inertia-paddle / parallel side-tank in analogyDrawers.ts, brighten-by-contribution; read the
  SAME parasitic values as sim-core (mirror the constants). Full plan in HANDOFFS (35).
- [ ] **Transient parasitics (optional)** — netlist expansion (C→ESL+ESR+C, L→DCR+Cw, hidden
  internal nodes) for time-domain ESR ripple/spikes. Deferred; the AC-stamp covers the Bode.
- [ ] **(other track) Transient time base + PSU rating** — selectable fine dt + auto-measurements
  (ripple Vpp, overshoot, settling, regulation). Still open; owner chose the AC engine first.

## 2026-06-19 (16) — AC frequency range → 50 kHz; switching flicker root-caused

- ~~**AC source frequencies** extended to 50 kHz (`values.ts`: +10 k/20 k/50 k, +10 kHz chip).
  1 GHz infeasible at the 2 µs step (AC detect caps 62.5 kHz; round MHz/GHz → `f·dt` int → dead
  0 V source). 50 kHz already shimmers fully.~~
- [ ] **Resistor flicker under high SWITCHING** (owner ask) — NOT the same bug as AC flicker.
  `ELEM_SWITCH` = fixed 10 kHz chopper → unipolar PWM → sinusoidal AC detector says DC/invalid →
  (30) RMS-averaging can't engage → strobes. Fix: (a) sim-core AC analysis report RMS+fundamental
  for non-sinusoidal periodic signals, or (b) render-side ripple-gated magnitude stabiliser not
  keyed on `ac.valid`. Offered to owner; awaiting pick.
- [ ] **Phasor sweep ideas (round 2)** — Xc/Xl+R split (trig, cheapest); |Z|-vs-f sparkline the
  phasor paints (needs HUD-side freq-history buffer, presentation-only); RMS-vs-peak shadow;
  cap↔ind crossover anim; reactance-corner marker; resonance-hunt glow; two-part overlay (needs
  2nd readout). Full round-1 list (impedance triangle, PF ring, P/Q bar) still open from (14)/(29).

## 2026-06-19 (15) — Magnitude-rides-RMS (thickness + flow) + phasor moved to Telemetry

- ~~**Wire thickness/density flickered on AC** — `normC` rode `|i_instantaneous|`. Now eases
  toward a per-wire running-RMS branch current (`wireMs`, EMA `WIRE_RMS_ALPHA=0.04`, advanced once
  per frame in `advanceWireRms`) by the shimmer `blur`, mirroring the vrms colour blend. Sign kept
  → carriers still slosh. (board.ts)~~
- ~~**Component flow/heat strobed on AC** — new `glyphs.flowStabilized(e, blur)` eases the glyph
  `current` magnitude toward measured `ac.irms` (sign kept) by the part's own apparent-rate blur.
  Wired in the board.ts node loop.~~
- ~~**Phasor placement** — moved out of the value popover into its own ~180 px `Phasor · <part>`
  section in the Telemetry aside (beside the scope), with a V/I + ϕ°/lag/lead legend.
  `drawPhasor2D` strokes now scale with radius.~~
- [ ] **Flow stabilisation gaps** — diode/LED flow still strobes on fast AC (the `max(0,current)`
  sign-gate zeroes the off-half); potentiometer `legs[]` divider flow isn't RMS-blended. Low
  priority; honest-ish as-is.
- [ ] **Pixel-verify the board** — wire/glyph averaging is read- + numerically-verified only (no
  headless Pixi render). Confirm on live that thickness/flow are steady on fast AC.

## 2026-06-18 (14) — High-frequency AC render primitives (Layer 3) shipped

- ~~**`tierKit.shimmerFlow`** — the carrier→shimmer-band handoff on
  `blurFactor(apparentFreq(f))` (smoothstep 15→300 **apparent** Hz). The handoff tracks the
  on-screen apparent rate `f·tps·DT` (`setApparentRateScale` set each frame from the playback
  tickrate in App.svelte), so slowing the tickrate drops a fast AC back to visible sloshing
  and speeding up returns it to a shimmer. At `b=0` byte-for-byte `belt` (no DC regression).
  **`tierKit.phasorInset`** — V/I arrows on a dial, angle = measured V–I phase, lengths = AC
  amplitudes, filled phase arc, decaying-alpha I-tip phosphor trail; a pure function of the
  bounded phase (rewinds, no mutable buffer).~~
- ~~Data path: `ElectricalState.ac` (`AcReadout`) added (glyphs); `electricalMap` slices the
  flat `acMeasurements` per element; `App.svelte` passes `snap.acMeasurements`/`acFields`.~~
- ~~Applied: the **inductor** analogy drawer's pipe flow uses `shimmerFlow` (reference home);
  the **phasor inset** overlays the InfoDiagram for reactive parts (C/EC/L/TR) once a cycle
  is measured. Verified with `/tmp/harness/dumpPhasor.js` (handoff + phase encoding) and the
  existing `run.js` drawer regression. All web gates green.~~
- [ ] **Open (render adoption):** ~~board wire-pipes' carrier→shimmer swap~~ **done (15)**;
  the cap/transformer drawers adopting `shimmerFlow`; the phase-domain scope (V/I vs phase).
  See `docs/ui/high-frequency-render.md` §implementation-sketch 3–4.

---

## 2026-06-18 (19) — Auto-averaging (RMS) inspector readouts; flailing numbers fixed

- ~~**V/I numbers flail at high speed** (owner) — the inspector/HUD + partInfo formulas read
  the instantaneous `e.vAcross`/`e.current`, so they're unreadable once the AC reverses fast.
  Fixed DMM-style: `glyphs.rmsStabilized(e)` swaps in the measured RMS (`ac.vrms`/`ac.irms`);
  App.svelte computes `selRmsMode = ac.valid && apparentFreq(ac.freq) > READOUT_RMS_HZ(4)` each
  frame and feeds `selDisplay` (RMS or live) to the HUD + the "Right now" partInfo, with an
  `rms` badge. Self-adapts to signal freq AND playback speed (apparent rate). For DC, ac.valid
  is false → live value (already steady). Resistive P=V·I rows stay correct (Vrms·Irms = real
  power); reactive dV/dt-style formulas are stable but abstract (future: use Preal/PF).~~
- ~~**Phasor placement** (owner answered: inspector HUD + broaden parts + brainstorm). Added a
  Canvas2D `hudPhasor.drawPhasor2D` (lightweight twin of the Pixi `phasorInset`) to the
  inspector value popover for any part with `ac.valid` (a resistor reads in-phase); broadened
  the info-panel phasor gate from reactive-only to any AC part. Quadrant-tinted wedge (amber =
  lagging/inductive, violet = leading/capacitive, grey = resistive) folded in from the
  brainstorm. Verified with a Canvas2D-mock PNG render (`/tmp/harness/render-hudphasor.js`).~~
- [ ] **Phasor upgrades (brainstormed, not yet done)** — impedance/power triangle (R–X legs +
  projection drop-lines from `zmag`/`phase`/`iamp`); PF ring + real-vs-reactive (P/Q) bar; tie
  the cosmetic spin to the shared flow clock; L/C corner glyph. SRF "species-flip" ghost needs
  the Real-model parasitics (frequency-morph). Full list in the (29) handoff.

---

## 2026-06-18 (18) — Shimmer deactivated while running (the lerp dropped acMeasurements)

- ~~**Root cause of "shimmer deactivates on slow-down, only a t=0 reset brings it back"**:
  `lerpSnapshot` (loop.ts) — used to interpolate the display on ~every *running* frame
  (`acc > 1e-4`) — rebuilt the Snapshot WITHOUT `acMeasurements`/`acFields`. So running →
  AC data undefined → blur 0 → no shimmer/RMS-colour; it only survived when paused or right
  after a reset (cursor 0 skips the lerp). Fixed: carry `acMeasurements` (blended like the
  currents) + `acFields` through `lerpSnapshot`. Both Snapshot constructors now include them.~~
- Also: patched `~/.claude/stop-hook-git-check.sh` to skip `noreply@github.com` (GitHub's
  own squash/merge commits) so it stops nagging on every PR merge.

---

## 2026-06-18 (17) — Shimmer band visible (real bug) + lens/camera persistence

- ~~**Shimmer band was invisible** — not just calibration: the band was the same voltage
  colour as the wire + low alpha, so at high blur it looked like a plain wire (chevrons just
  vanished). Found via a new pure-Node PNG rasterizer (`/tmp/harness/raster.js` +
  `render-band.js`, verified `band.png`). Redesigned the band (board.ts + tierKit
  `shimmerFlow`): voltage aura + WHITE-HOT core + sparkle specks → reads as an energised wire.
  Shown on all three lenses.~~
- ~~**Persistence**: tier lens toggle, LOD toggle, and camera (pan+zoom) survive refresh —
  `Settings` (storage.ts) gains `boardLens`/`lodOn`/`camera`; `Board.getCamera()`/`setCamera()`;
  restore on init; debounced camera save in the frame loop.~~
- ~~**Wire colour flicker on fast AC** (owner) — voltage aliases like the carriers did
  (`voltageColor` is magnitude-based, so the hue strobes 0↔peak). Fixed: blend the wire
  colour toward the net's **Vrms** as blur rises, Vrms computed web-side from the non-aliased
  sub-frame `scopeBatch` (`Board.nodeVrms`); no core change. Verified with a PNG render
  (`/tmp/harness/render-color.js` → flicker row vs steady RMS row).~~

---

## 2026-06-18 (16) — Shimmer calibration fix + frequency-morph doc

- ~~**Shimmer not visible on screen** — calibration cliff: with `AC_SHIMMER_HI=300`
  apparent Hz, the default 500 Hz source only shimmered at the very top tickrate. Recalibrated
  to `AC_SHIMMER_LO=10` / `HI=60` so the carrier→shimmer transition lands in the reachable
  speed range (500 Hz flips between tps 5000↔50000); bumped the board band alpha. Verified by
  a blur-vs-tps calc + a `computeWireFlow` freq/acFrac replication (`/tmp/harness`).~~ NB: not
  screenshot-verified live (no headless-browser tooling) — owner to re-test at ≥50k ticks/s.
- ~~**`docs/ui/frequency-morph.md`** — the owner's "parts morph into their HF counterparts"
  idea written up: SRF flip (cap ⇄ inductor, shunt → shunt + L), depicted vs computed, as the
  payoff of the Ideal/Real flag. Added to the roadmap (Layer 3).~~
- [ ] **Frequency morph implementation** — blocked on the Ideal/Real fidelity flag (Layer 1)
  for the honest/computed version; a render-only preview could come first. See the doc.

---

## 2026-06-18 (15) — Board-wide carrier→shimmer handoff

- ~~`Board.computeWireFlow` (was `computeWireCurrents`) now also attributes each wire an
  **apparent AC frequency** (AC-amplitude-weighted mean of the elements' `ac.freq` in the
  wire's KCL subtree) and an **AC fraction** (AC amp vs |DC current|), from the one
  spanning-forest pass. `redrawWires` fades the chevrons/water/electron carriers into a
  voltage-tinted glow band (`SHIMMER_VIB` wobble) at high `blurFactor(apparentFreq(freq))`
  — in all three lenses; the energy belt is untouched. The AC-fraction gate keeps a
  rectifier's DC rail (small 2f ripple) reading as streaming carriers, not a shimmer.~~
- ~~Tickrate-coupled like the tier drawers (shares tierKit's `apparentRateScale`), so
  slowing playback drops fast AC back to visible sloshing. All web gates green; tierKit +
  drawer harnesses pass.~~
- [ ] **Brainstorm (owner):** components visibly **morphing into their high-frequency
  counterparts** (parasitics) at high apparent rate — e.g. a resistor → R + series L, a
  cap → C + ESR + ESL. Needs a design doc (the Ideal/Real fidelity ladder already frames
  the parasitics; this is the *render* of the transition). See HANDOFFS.

---

## 2026-06-18 (13) — AC analysis (Layer 2 measurement) shipped

- ~~**AC analysis** (sim-core) — new `AcMeas` per-element running analyzer + `Sim::
  ac_measurements()` (flat `[nElements × AC_FIELDS=12]`: Vrms, Irms, Vmean, Imean, Vamp,
  Iamp, Preal, PF, |Z|, phase, freq, valid). Synchronous RMS/power/phase detector: cycles
  delimited by rising zero-crossings of V about the running mean; phase = signed sub-sample
  offset of I's crossing (>0 inductive lag, <0 capacitive lead); PF = V–I correlation; freq
  from the period. O(1)/tick, O(1) storage. Updated each `step()` after the FAIL clamp;
  unhashed (golden bit-identical), deterministic (reproduces + rewinds).~~
- ~~Boundary: `ac_measurements()` + `ac_fields()` on sim-wasm; `loop.ts` `Snapshot` gains
  `acMeasurements` + `acFields` (one batched read/frame).~~
- ~~Tests: `ac_analysis_resistor_is_resistive` (PF≈1, φ≈0, |Z|≈R, freq✓), `…capacitor_
  current_leads` (φ≈−π/2), `…inductor_current_lags` (φ≈+π/2), `…run_is_reproducible`
  (measurement bits folded into the replay accumulator). 109 sim-core tests; all gates green.~~
- [ ] **Next:** the `shimmerFlow` + `phasorInset` render primitives (L3) now have their data
  source. Phase-domain scope (V/I vs phase) also reads these.

---

## 2026-06-18 (12) — Floating-component GMIN (Part 1 of floating networks) shipped

- ~~**Floating-component `GMIN`** (sim-core) — implemented in `crates/sim-core/src/lib.rs`.
  New `floating_refs(node_count, elements)` runs union-find (union-by-min, deterministic)
  over potential-defining ties (R/C/L/V/AC/switch/diode-family/varistor union a–b;
  FET/BJT channel a–b with the gate/base marked device-referenced; transformer unions each
  winding separately; op-amp/digital/pull-up terminals marked referenced; ISOURCE skipped),
  then returns the lowest node of every component with no path to ground. Stamped as one
  `GMIN` per floating component in all four assembly paths via `stamp_floating_refs`. New
  `floating_refs` field on `Sim`, computed at install.~~
- ~~Tests: `floating_refs_identifies_isolated_subnets` (topology), `floating_divider_solves_
  with_defined_common_mode` (exact differential, common-mode pinned), `floating_transformer_
  secondary_is_reproducible` (the headline win). Golden bit-identical; all gates green.~~
- [ ] **`ELEM_ROGOWSKI`** is now UNBLOCKED (Part 2 of `floating-networks.md`) — the
  floating-reference prerequisite is in. Next sim-core element after AC analysis if the
  owner wants the Rogowski path, else continue the critical path (AC analysis → render).

---

## 2026-06-17 (11) — Frameworks roadmap + high-frequency AC render

- ~~`docs/frameworks-roadmap.md` — the master "build the frameworks, then the game"
  dependency map (4 layers: solver core → measurement → render → game systems), with
  status + critical path. Stitches the per-system docs together.~~
- ~~`docs/ui/high-frequency-render.md` — the owner's AC render framework: decouple into
  three non-aliasing channels (shimmer width = amplitude, energy drift = real power,
  phasor angle = phase) + a phosphor-persistence phasor + a phase-domain scope.~~
- ~~SPDX headers retrofitted onto `floating-networks.md` + `fidelity-ceiling.md`.~~
- ~~**AC analysis (Layer 2)** — running per-net/element RMS, peak, V–I phase ϕ, real/
  reactive power, PF, |Z|, apparent frequency from the live waveforms (snapshot-only,
  deterministic). Feeds the phasor/high-freq render + AC telemetry + AC grading.~~ **Done
  — see (13) below.**
- ~~**`shimmerFlow` + `phasorInset` render primitives** (tierKit/web) — the carrier↔band
  handoff on the blur factor, and the two-arrow + arc + decaying-tip-trail widget.~~ **Done
  — see (14) below.**

---

## 2026-06-17 (10) — Floating networks + Rogowski coil + fidelity-ceiling docs

- ~~Design docs written: `docs/sim/floating-networks.md` (floating subnets + Rogowski
  coil) and `docs/sim/fidelity-ceiling.md` (how real the solver vs the reality tiers can
  get — the "where's the stopping point" map).~~
- ~~**Floating-component `GMIN`** (sim-core) — the netlist picks ONE global ground, so
  an isolated subnet has a singular common-mode. Stamp one `GMIN` to ground per floating
  connected component (generalises the op-amp/MOSFET-input GMIN). Small, golden-safe
  (grounded circuits unaffected), and on its own it fixes a floating transformer
  secondary + any isolation circuit. **Do first.**~~ **Done — see (12) below.**
- [ ] **`ELEM_ROGOWSKI`** (sim-core) — a non-loading current-sense, derivative source:
  sense a pass-through branch's current, force `V_out = M·dI/dt` onto an isolated output
  winding (reuses the transformer's hard-secondary stamp + the inductor `dI/dt`
  companion + the floating-component GMIN). Ideal first; Real bandwidth/droop later.
  Needs the floating fix first. Determinism: new `*_run_is_reproducible` coverage; the
  ideal analog golden stays untouched.

---

## 2026-06-17 (9) — Proportional-split flow framework

- ~~**Framework**: per-leg currents (`BuiltNetlist.legsOfComponent` → `ElectricalState.legs`)
  + `tierKit.flowSplit` (carriers commit to an exit in proportion to its current). General;
  feed it `electrical.legs` as exit weights.~~
- ~~**POT** analogy + reality: the wiper now STEALS its share of the carriers in proportion
  to the tapped current (KCL: tap = A→W − W→B). Verified across no/half/heavy tap.~~
- [ ] **Extend the split to more parts** as their per-terminal currents become available:
  transformer (secondary `Is = n·Ip`, derivable now — good next candidate); transistors
  (`Ib` would need the solver to expose the base branch; β-derived ≈1%, low value).

---

## 2026-06-17 (8) — Owner-review fixes + proportional-flow plan

- ~~**Thermistors missing from the bin** — were in `PART_KINDS` but not App.svelte's UI
  `PARTS`/`PART_CAT_OF`. Added under Passives.~~
- ~~**MOV bypass** — leads bypassed the poppet (A→tank→B). Reworked: leads pressurize the
  tank from below, flow only exits UP through the popped valve to the vents; spring
  compresses sealed→popped.~~
- [ ] **Particles to the exits, proportionally** (owner "would be cool"): split each
  part's internal particle streams by the per-exit currents so you can SEE the POT wiper
  stealing them (and per-output splits on transistors etc.). FEASIBLE — all per-element
  currents are in `elementCurrents` (loop.ts); the POT already stamps both legs (A→W,
  W→B). Add an optional secondary-current to `ElectricalState`, thread netlist→loop→board
  →drawer, split the streams. Also align internal dot count with the in/out pipe counts.

---

## 2026-06-17 (7) — Flow cohesion sweep: dam, slalom, MOV, connector pipe, caps

Owner push: every part's particles should interact with what affects them, terminals
should look like flowing pipes that join the wire-pipes (never "broken up"), and flow
should respect orientation.

- ~~**Diode** reverse-block now DAMS UP (packed jittering column + pressure chevrons).~~
- ~~**POT** stream SLALOMS around the resistance posts (`tierKit.scatterY`) and SNAGS
  carriers off at the wiper down the hose to W (the divider).~~
- ~~**MOV** reads open/sealed (poppet cracks + seat glow), flowing **pipe leads**
  (`tierKit.pipeLead`), polarity-correct through-flow.~~
- ~~**Connector pipe** (board): a stub from each pin into the body BEHIND the tier
  illustration, bridging the wire-pipes to the part universally. (Needs in-app look.)~~
- ~~**Ceramic cap + inductor**: pipe bodies water-filled terminal-to-terminal.~~
- ~~**Electrolytic cap** redesigned to ONE big tank — flow in the +/out the − lead,
  water level = the voltage with a gauge marker.~~
- [ ] **Finish the flow sweep** (owner: "finish the part sweep") — give the REMAINING
  parts flowing pipe-leads + interacting particles: transformer, BJT/MOSFET, op-amp,
  sources (V/I/AC), level shifter, switches (SW/MSW), gates, flip-flop. Pattern: anchor
  to real pins, `pipeLead` terminals, particles that react to the inline mechanism.
- [ ] **Get at wires behind components** — a component hit always wins (board.ts ~2507),
  so an occluded wire (op-amp example) is unreachable. Owner chose modifier **click-
  through**, BUT wants it discoverable without knowing the hotkey (hover-fade/right-
  click/handle all rejected as distracting/gimmicky — open question how).
- [ ] **Junctions: delete + move** — a way to remove a junction and drag it around (no
  rush). (Owner request 2026-06-17.)
- [ ] **Orientation audit** — confirm flow direction on every part when rotated (MOV is
  fixed via polarity + the rotating glyph holder; verify the class).

---

## 2026-06-17 (6) — Thermistor reality tier, POT flow respects wiper, resistor fire

- ~~**Thermistor reality (tier 3)** `drawDetailThermistor` (NTC/PTC) — polycrystalline
  ceramic: a grain chain with grain-boundary necks the carriers funnel through. NTC =
  carrier population grows with heat (freed-carrier sparkle + denser drift); PTC = red
  boundary barriers close the necks past the Curie point (the switching-ceramic snap).~~
- ~~**POT flow now RESPECTS the wiper** (audit fix). Analogy + detail: the drift/stream
  NECKS through the wiper contact (pinch tracks the wiper as it slides) and a tap branch
  drains down the arm/hose to W. `tierKit.flowAlongPath` now used in the detail tier too.~~
- ~~**Resistor CATCHES FIRE** past the smoke (`drawDetailResistor` + `flameTongue`): layered
  flickering flame tongues + embers off the body, driven by the raw |V·I| ratio (real
  headroom past the saturating `power`) — smolder → flames → blaze → inferno.~~
- Audit (Explore agent) of all analogy/detail flow vs inline constrictions: POT was the
  one clear offender (now fixed); MOSFET/BJT/diode/zener/caps/thermistor already gate
  their flow on conduction/obstacle/valve state. Diode reverse-block is borderline-sparse
  but acceptable — left as-is.

---

## 2026-06-17 (5) — Thermistor flow funnels through the gate

- ~~**`tierKit.flowThroughGap`** + `drawAnalogyThermistor` rework: carriers now funnel
  THROUGH the shutter gap (wide uniform stream when open, pinched to a thread when shut —
  the PTC snaps tight past Curie). Plates retract fully when wide open. See HANDOFFS (10).~~

---

## 2026-06-17 (4) — NTC + PTC thermistors (schematic + analogy, temperature knob)

- ~~**NTC + PTC thermistor kinds** added end-to-end, web-only (no sim-core/golden):
  catalog (`PART_KINDS`), schematic glyph (`drawThermistor` — IEC box + the temperature
  arrow, −/+ for NTC/PTC), heat-valve analogy (`drawAnalogyThermistor`), partInfo, and a
  per-part **temperature knob** in the inspector (mirrors the POT wiper).~~
- ~~**Shared R(T) model** in `web/src/lib/thermistor.ts` (NTC exponential; PTC switching
  ceramic with a Curie snap). `buildNetlist` stamps R(T) as a plain resistor — the POT
  pattern — so temperature changes rebuild the sim with no new element.~~
- ~~`temp` scalar threaded like `wiper` (Component, SelectedPart, clipboard, serialize/
  restore, board opts, infoDiagram).~~
- ~~**Thermistor reality (tier 3)** — `drawDetailThermistor`: a polycrystalline grain
  chain; carriers funnel through grain-boundary necks; NTC grows its freed-carrier
  population with heat, PTC rears up red boundary barriers past Curie (the snap). See
  2026-06-17 (6).~~
- [ ] **Thermistor params** — expose B (NTC) and the Curie point (PTC) as part scalars;
  fixed defaults for now. Optional silistor PTC variant.

---

## 2026-06-17 (3) — Zener closed loop, diode valve template, conduit fittings

- ~~**Zener analogy rebuilt** as a closed-loop spillway (`drawAnalogyZener`): forward check
  valve + cathode-side standpipe filling to the Vz weir + a **return tube** that carries the
  spill back to the anode (matches `zener-tier2.html`; no more "spilling into nothing").
  Column rim tracks the crest, so no dead freeboard.~~
- ~~**Shared `forwardCheckValve()` diode template** (D/SD/LED/ZD): bronze seat + spring + ball;
  **smaller ball**; open flow **parts around the ball** via new `tierKit.flowAroundBall`
  (horizontal `flowAroundPlug`). Valve un-crammed (taller chamber, wider body).~~
- ~~**Conduit tapers + junction fittings made translucent** — the port-flare + hub/nub fills
  were stacking over the pipe and reading cloudy; lowered their alphas.~~
- ~~**Junctions nudge with their runs** — follow-pass in `redrawWires` shifts each junction hub
  (and snaps its run-ends) by the per-axis-averaged nudge offset of its runs; derived FROM the
  nudge so it never fights `nudgeParallel`. `drawJunctions` takes a `junctionPos` map.~~

---

## 2026-06-17 (2) — reality transistors rotated + flow around the plug

- ~~**Reality MOSFET + BJT rotated to vertical**, anchored to the pins (drain/collector top,
  source/emitter bottom, gate/base left) so they match the board orientation.~~
- ~~**Flow parts around the plug** in the MOSFET/BJT analogies (`tierKit.flowAroundPlug`);
  plug narrowed to a disc thinner than the pipe so there's a side gap to flow through.~~
- ~~**Board traces as conduits** — DONE. `redrawWires` re-skins bare traces when zoomed into
  the analogy/reality lens: analogy = steel water pipe (carriers WITH current), reality =
  copper conductor with electrons drifting AGAINST current. Bus language kept; port collars
  at the ends are the lightweight taper. (`drawConduitSkin`, gated at `TIER_ZOOM`.)~~
- ~~**Conduit polish** — DONE. Auto bend radius (`roundedPolyline`), port taper (flared mouths
  oriented along the end segment), 4-way junction fittings with capped unused arms
  (`drawJunctionConduit` + `junctionDirs`).~~
- ~~**Conduit translucency** (#88) — lowered wall/bore/casing/flare/junction alphas so pipes
  read translucent.~~
- ~~**Free wire-ends** (#88) — empty-space click while routing drops a `free` junction and keeps
  routing from it.~~
- ~~**Potentiometer tiers** — `drawAnalogyPOT` (packed pipe) + `drawDetailPOT` (resistive film),
  anchored A/B/W, driven by wiper + current + vAcross.~~
- ~~**Conduit cleanup** — dropped the muddy dark bore (translucent 2-layer pipes), softened
  junctions (round-capped nubs), and added the **pin auto-bend** (a small aligning stub via
  `pinOutward`/`conduitDrawRoute`, rendering-only).~~
- [ ] **Conduit: nudge parallel pipes apart** (owner) — a render-offset channel-routing pass for
  overlapping collinear segments. Bigger/riskier; deferred.
- [ ] **Conduit: true per-part port-width taper** — flare each conduit to the component's actual
  port radius (needs parts to expose it). The current taper is a standard `PITCH*0.34` mouth.
- [ ] **Owner eyeball** the rotated reality transistors + the plug-skirting flow.

## 2026-06-17 — op-amp: doc-faithful analogy + reality

- ~~**OA analogy** rebuilt to the opamp-tiers.html tier-2 spool valve (input reservoirs,
  ±supply reservoirs, gain knob, bronze spool lands, output tank, ported flow), anchored to
  the real pins. Each input steers the spool toward its own rail (IN+→+rail up, IN−→−rail down).~~
- ~~**OA reality** replaced the capsule/puck with the doc's tier-3 long-tailed differential pair
  (Q+/Q−, constant tail current to −12 V, collectors to +12 V, Vout taps Q− collector).~~
- [ ] **Owner eyeball** the new OA analogy + reality on the board (deep zoom) + info panel.
- [ ] If wanted: the other reality tiers are still the older "factory" style — only OA was
  switched to its exact design-doc tier-3 this pass.

## 2026-06-16 (evening) — analogy tier: pin-anchoring + faithful re-port

- ~~**Analogy tiers PM/NM/OA/ZD/MOV** — DONE. Re-ported faithfully to the design sheets and
  **anchored to the real pins** (new `TierOpts.anchors`, computed in board.ts/infoDiagram.ts,
  resolved via `tierKit.anchorPt`). MOSFET = pressure-pilot valve (N/P mirror); OA = pilot
  spool valve (OUT/IN±); ZD = check-valve on the pin axis + spillway w/ reverse return; MOV =
  relief valve (vessel+vents+bonnet/screw). All move from the right live values.~~
- ~~**BJT (Q/QP) analogy** — DONE (owner OK'd). Anchored C/E/B + re-ported to the amplifying-
  valve ref: base check valve → float chamber → plug linkage; PNP mirror. Verified by the
  headless harness (pins reached, in-bounds, responds to I_C).~~
- [ ] **Owner eyeball** the re-ported analogy tiers (NM/PM/OA/ZD/MOV/Q/QP) on the board (deep
  zoom) + info panel.

## 2026-06-16 (afternoon) — tiers on the board + owner review fixes

- ~~**Tiers on the board (LOD)** — DONE. 3-way board lens (Schematic/Analogy/Reality); a part
  morphs into its full-panel illustration once zoomed past `TIER_ZOOM` (board.ts), else the
  schematic symbol. `ComponentNode.tierGlyph` + `Board.setLens`. **Needs an owner eyeball:**
  threshold + footprint bounds + possible off-screen cull.~~
- ~~**Resistor reality** = conductor lattice + drifting electrons + heat (was a colour-band rod).~~
- ~~**Diode reality** = PN-junction cutaway (P|depletion|N, recombination, LED photons, Schottky).~~
- ~~**Info-panel clipping** fixed (electrolytic tanks, BJT/MOSFET reservoirs pulled in-bounds).~~
- ~~**Transformer analogy** rocks back-and-forth (AC hinge) on the shared clock; strap shuttles.~~
- ~~**Info tab defaults to the board lens** (untracked; still toggleable).~~
- ~~**Diode analogy** ball lifts downstream when forward (was backwards) + decluttered.~~
- ~~**Zener analogy** rebuilt to the check-valve+spillway doc (no longer scrunched).~~
- [ ] **Board-tier LOD polish (owner review):** tune `TIER_ZOOM`; consider a cross-fade across
  the threshold; cull off-screen parts when drawing tier illustrations on large boards (cost).

## 2026-06-16 (overnight) — part-demo tiers: animation fix + all batch-1/2 tiers built

- ~~**Animation feedback (owner): slow down, de-jitter, pause-and-flow-with-time** — DONE.
  `InfoDiagram` adopts the board's shared flow clock (`Board.flowPhase()` → `setPhase` each
  frame): calm `FLOW_HZ`, freezes paused, reverses on scrub. Detail dot-loops de-jittered with a
  fixed-slot `dotPresence` fade (no count-flip teleporting).~~
- ~~**Analogy tier = full-panel illustration (owner: "as detailed as the design doc")** — DONE.
  New `web/src/lib/analogyDrawers.ts` + shared `web/src/lib/tierKit.ts`; `InfoDiagram` analogy
  mode draws full-panel `drawAnalogy()` else falls back to the board Factory glyph; gate is
  `hasFactory || hasAnalogy`.~~
- ~~**Analogy drawers (full-panel):** R, C, EC, L, TR, D/SD/LED, ZD, Q/QP, NM/PM — DONE.~~
- ~~**Reality drawers:** C (MLCC), EC (Al-foil), TR (iron-core windings), Q/QP (BJT silicon),
  NM/PM (MOSFET silicon) — DONE, registered in `DETAIL_DRAWERS`.~~
- ~~**Batch 2 implemented** (diode/zener analogy, transistor + MOSFET analogy & reality);
  PMOS ref saved (`docs/ui/parts/mosfet-pmos-tiers.html`).~~
- [ ] **Board LOD — the gated decision point.** Working LOD (NOT hide-to-reveal): always visible
  + animating, zoom-IN adds factory→reality detail, zoom-OUT simplifies. Hook off `world.scale`
  in `Board.update()`; overlay the full-panel analogy/reality drawer (they take a centred
  `bounds`) over the zoomed part. Thresholds/blend are visual tuning — **owner to eyeball live.**
- [ ] **Tier-fidelity caveats to revisit** (need richer per-element state): BJT/MOSFET reality
  proxy gate/base off |I| (no Vgs/Ib); transformer reality uses |Ip| as a flux-activity proxy
  (true core-flux/saturation is the ideal-vs-real work).

## 2026-06-16 (night) — part-demo tiers (owner design)

- **Three-tier part demos — STARTED (refs + design).** Every part shown schematic / analogy /
  reality, live-animated, revealed by zooming into a placed part or via the info panel. Refs:
  `docs/ui/parts/*-tiers.html` (5: R, ceramic C, electrolytic C, L, TR — authoritative spec).
  Design + plan: `docs/ui/part-demos-tiers.md`. Extends App.svelte `infoDiagram` / `hasFactory` /
  `diagramMode`. Pure presentation → no golden impact. **Next batch of part sheets arrives once
  this 5 is implemented.**
  - ~~Map the existing system — DONE (agent): three-tier `InfoDiagram` (PixiJS) + `DRAWERS` /
    `FACTORY_DRAWERS` / `DETAIL_DRAWERS` is ~70-80% built; tier switcher (`Symbol/Factory/Real`) +
    live per-frame feed already exist. Reality drawers exist for OA/D/SD/LED/ZD/R.~~
  - **Reality-tier drawers** (`detailDrawers.ts` → `DETAIL_DRAWERS`, the `drawDetail<Kind>` pattern):
    - ~~**Inductor (L)** — DONE (`drawDetailInductor`; solenoid + field loops + flux + spiral + dI/dt
      shimmer). Gates green; needs an eyeball on the live render.~~
    - [ ] **Ceramic cap (C)**, [ ] **electrolytic cap (EC)**, [ ] **transformer (TR)**. (R pre-existing —
      diff vs its ref + enrich later.)
  - [ ] **Board LOD — a *working* LOD, NOT hide-to-reveal** (owner clarified): the part is always
    visible + animating; zoom-IN progressively reveals factory→reality detail (same live state),
    zoom-OUT simplifies for clarity + render cost; nothing hidden. Tune thresholds/blend on visual review.
  - [ ] **Batch 2 (queued)** in `docs/ui/parts/`: `diode-factory`, `diode-tier2-study`, `zener-tier2`
    (analogy → `FACTORY_DRAWERS`), `transistor-tiers` + `mosfet-tiers` (Q/QP/NM/PM reality — the N-MOSFET
    sheet has the full schematic/valve/silicon set). Implement after batch 1, in order. More may follow.
  - Switcher relabelled **Schematic / Analogy / Reality** (was Symbol / Factory / Real).

## 2026-06-16 (night) — design (Ideal-vs-Real + multi-rate)

- **Ideal-vs-Real RESOLVED** as a progression-driven **fidelity gradient** (not a global
  toggle). Doc: `docs/sim/ideal-vs-real-parts.md`. Basics (R/C/L/V/I) pure-ideal &
  self-regularizing; past-basics carry essential parasitics by default; advanced unlocks more.
  Research-backed (CircuitJS source + ngspice manual). Parts audit done (only 6 purely ideal).
  - ~~**Visible FAIL UI** — DONE. wasm boundary exposes `failed()` + `failed_element_mask()`;
    `electricalMap` carries per-part `failed`; `board.ts` draws a pulsing red `FAIL` box +
    label on each flagged part (`PALETTE.bad`, free wall-clock pulse so it breathes while the
    run is frozen); `loop.ts` **freezes the run on FAIL** (the whole-sim FAIL state). Deferred
    polish: the `+FAIL/−FAIL` numeric-readout swap and a global banner (box+pause already read
    clearly).~~
  - ~~**Component labels / renaming** (owner ask — "a big one") — DONE. `Component.label`
    (free persistence via the serialize/restore spread + the save format); the value popover
    now opens for **every** part (not just valued ones — diodes/GND too) with a label text
    field at the top (commits on blur; routed through `onPersist`, so naming never rebuilds the
    netlist or rewinds the running sim); on-board label shows the custom name in place of the
    kind tag; preserved through copy/paste + undo. (Couldn't verify live — no browser here;
    gates green.)~~ *(Owner is doing a manual pass to label/clean the examples — kept hands off
    `examples.ts`.)*
  - [ ] **Curriculum tiering**: sort examples/contracts into "ideal basics" vs "reality carried".
  - [ ] **Additive Real-variant upgrades** (tech-tree/Lux gated, golden-safe additive): diode
    Rs + junction cap, R tolerance/power, C/EC ESR/ESL + ratings, FET/BJT caps + SOA, op-amp
    GBW/offset/Ibias, L saturation, transformer core saturation/loss.
  - [ ] **Web netlist test harness** — the c-terminal bug had zero web coverage (sim-core
    hand-wires c/d, so UI-built circuits are untested).
- **Multi-rate / mixed-signal architecture captured**: `docs/sim/multi-rate-domains.md`. Fixed
  integer rate ratios = deterministic (vs adaptive Δt); analog MNA at fixed Δt + digital event
  kernel sub-stepping a fixed integer per tick; the **ADC/comparator/DAC = the boundary**.
  - [ ] Lands with the CPU (`uC`) / FPGA (`FP`) / ADC-DAC tier; builds on the digital scheduler.

## 2026-06-16 (later)

- ~~**Four-pin c-terminal grounded — FIXED + SHIPPED (PR #70).** `nc` (pin 2 → node c) was
  computed only for `THREE_PIN_TYPES`, so the transformer's S+ and the DFF's CLK mapped to
  ground → half-wave bridge ("one diode conducts") + a flip-flop that never clocks. `nc` now
  includes `FOUR_PIN_TYPES`. Owner found the root cause.~~
- ~~**FAIL state foundation — SHIPPED (PR #70).** `flag_and_clamp_fails()` clamps non-finite/
  `>FAIL_LIMIT` to a finite bound (no more NaN propagation/trace-deletion), raises `failed()` +
  `failed_element_mask()`; native==wasm now. Golden stable; +2 tests (102 total).~~
- **Ideal-vs-Real parts (owner ask) — design doc written; build pending a policy decision.**
  Doc: `docs/sim/ideal-vs-real-parts.md`. Parts audit done (only 6 purely ideal: V/AC/R/C/L/I).
  - [ ] **DECIDE ideal-mode policy A vs B** (research agent running): (A) pure ideal, FAILs / you
    add impedance; (B) tiny universal lead R(+L) baked in so it just works, Real adds full
    parasitics. Root cause is fixed-Δt transient (SPICE uses adaptive Δt; we can't — determinism).
  - [ ] **Ideal transformer** (leakage floor depends on A/B). Bridge example already bounded+full-wave.
  - [ ] **Visible FAIL UI:** wasm exposes `failed()`+mask → `board.ts` pulsing red FAIL box →
    `loop.ts` pauses on FAIL; show `+FAIL/−FAIL` on the readout.
  - [ ] **Bin Ideal/Real toggle** + per-part inspector toggle + allow-but-warn mixing in `connect()`.
  - **Roll out Real variants** — mostly DONE via the quality-tier system (see 2026-06-19 (18)):
    ~~source output-Z, R tolerance, C/EC ESR/ESL, FETs Kp, BJT β, op-amp GBW, inductor DCR/Cw~~
    all ship Real-gated tiers. Remaining: [ ] diode series Rs, [ ] inductor saturation (current-
    dependent L). (Transformer tier deliberately deferred — model hard-couples the secondary.)
  - [ ] **Web netlist test harness** — the c-terminal bug had zero web coverage (sim-core hand-wires c/d).

- ~~**Transformer bridge inrush runaway — FIXED + SHIPPED (PR #69).** Owner-reported live
  bug: `tr-bridge-supply` diverged to ~61 kA on wasm (bounded ~50 A native — an ill-conditioned
  inrush, not stale cache). The hard zero-impedance secondary drove a near-impulse charging the
  empty reservoir cap. Fix: secondary **leakage inductance** `TRANSFORMER_LLEAK = 5 mH` (BE
  companion, **negative** branch diagonal like the magnetiser's `rp`; zero DC drop → full-wave
  intact). `Is` now a 2nd reactive state (`secondary_state`); golden + hash format unchanged.
  n=4/1 kHz: 49.8 A → 4.3 A. +2 regressions (high-step-up sweep, floating-primary bridge).~~
- ~~**"Logic from Transistors" curriculum (owner ask) — SHIPPED (PR #69).** CMOS inverter/NAND/
  NOR from raw MOSFETs + SR latch (cross-coupled NOR) in `examples.ts`; new example category.
  Pure content (MOSFET model does CMOS rail-to-rail as-is).~~
- **Catalogue roadmap (4 research agents synthesized) — owner picked transistor curriculum
  first (done above). Remaining, in build order:**
  - [ ] **>4-terminal `Element` keystone** — optional per-element extra-nodes side-table
    (golden-neutral). Unlocks wide counters/muxes/decoders, the BCD→7-seg decoder, RAM.
  - [ ] **7-segment display** (`S7` = 7-LED netlist expansion) + per-segment `GlyphOpts`; then
    **BCD→7-seg decoder** (`ELEM_BCD7`, rides the keystone) → "watch a digit count" chain.
  - [ ] Small ≤4-pin (B) digital parts: transparent D-latch, Schmitt buf/inv, tri-state buffer,
    2-bit counter (all golden-additive).
  - [ ] Analog: **reusable magnetic core** (generalize ideal-T to N windings → autotransformer/
    variac, common-mode choke, center-tap); **relay** (P6 latch pioneer); buildable-today wins
    (battery V+R, CC programmable load, crystal-as-RLC).
  - Economy (owner-confirmed): seal = FPGA only; everyday ICs unlock via **Lux-gated tech tree**
    after a build-from-primitives contract; IC = Lux once / cheaper Credits-per-placement than
    discrete (the integration lesson). Matches `ic-buildings-ideation.md` + `game-contracts-economy.md`.

## 2026-06-16

- **Digital scheduler (owner ask) — research done + Stage 1 shipped; Stage 2 next.**
  Six research agents synthesized into `docs/ui/logic-analog-digital-nets.md` §7 (the
  authoritative design + build plan). Owner chose scope **Stages 1–2**.
  - ~~**Stage 1 — net classification (golden-stable).** `classify_nets`/`is_digital`/
    `NetClass`/`Sim::net_class` label each node Analog/Digital/Boundary; computed but not
    yet acted on, so every golden is bit-identical. Test added.~~
  - ~~**Stage 2 — event engine + level-bearing hash (the deliberate break).** Shipped:
    `Level` {Low,High,Z,X} + `combine` table + 4-state `gate_logic_level`;
    `LogicFamily.quantize`/`drive_level` + `v_il_frac`; net-centric `eval_digital` +
    `stamp_digital` (one resolved drive per net, replacing the 4 per-gate stamps + 4
    `stamp_dff`); 4-state DFF (`ff_q`+`ff_clk_prev`) hashed; `snapshot_hash` folds
    pure-digital Levels + DFF state. Multi-driver now resolves instead of fighting.
    Needed **no golden regen** (digital tests are behaviour + self-consistency; RC/0xeaac
    has no digital parts and is untouched). New tests: ring oscillator, multi-driver
    resolve, per-tick lockstep DFF replay. All gates green.~~
  - ~~**Stage 3 — logic families + XNOR/BUF.** Shipped: XNOR/BUF surfaced on the board
    (PART_KINDS, type-17 map, codes 5/7, glyphs, palette, partInfo, pinout, values);
    sim-core `FAMILIES` (Ideal/CMOS/TTL) packed in aux upper bits (`func + 16*family`),
    wired through eval_digital/stamp_digital/commit/DFF via per-net `digital_family`,
    golden-stable (Ideal default); web `families.ts` mirror + `Component.family` +
    buildNetlist aux pack + `setComponentFamily` + App.svelte family chip picker & noise-
    margin readout. Test `gate_family_levels_and_mixed_rail` (the level-shifter lesson).~~
  - **Stage 4 — digital-interface ground rules.** (Prior batch SHIPPED to live via **PR #67**.)
    - ~~**Open-drain output mode + wired-AND bus.** Per-gate open-drain (aux bit 8): pulls
      low, releases high → an external pull-up forms a wired-AND bus, resolved by the MNA
      solve. `aux` now masks func/family/open-drain; new `gate_gout` for a mode-aware
      current readout. Default push-pull → golden-stable. Inspector output toggle + web
      threading. Test `gate_open_drain_wired_and_bus` (bus = A AND B).~~
    - ~~**Level-shifter (`ELEM_LEVELSHIFT=20`) + pull-up (`ELEM_PULLUP=21`).** Level
      shifter: 2-pin, reads input at rail A (`value`), re-drives at rail B (`aux`) —
      conversion in its pins (Ideal receiver/driver); web `value`=input rail, `amp`=output
      rail picker. Pull-up: 1-pin resistor to internal Vcc through 4.7k, constant Thévenin
      in the 4 assembly sites. Both golden-additive; tier-1 schematic glyphs (LS = buffer
      placeholder, PU = resistor-to-Vcc). Tests `level_shifter_translates_rails`,
      `pullup_takes_net_to_vcc_unless_pulled`.~~
    - [ ] **Tier-2 (factory) + tier-3 (real) glyphs for LS/PU** — owner's symbol pass
      (LS currently aliases the buffer; factory falls back to schematic).

## 2026-06-15

### Bugs found via the full-bridge-rectifier review (2026-06-15 eve)
- ~~**`formatValue` ate integer trailing zeros** → 470 µF shown as "47 µF", 100 Ω as
  "1 Ω", 120 V as "12 V", 100 kΩ as "1 kΩ" (any 100–999 mantissa ending in 0, 10×
  too small). Fixed: only strip zeros after a decimal point. Web-only.~~
- ~~**sim-core: a diode bridge off a transformer doesn't rectify (HARD) — FIXED.**
  Rewrote `stamp_transformer`/`stamp_transformer_op` from coupled-inductor to the
  **ideal-T model**: a magnetising inductance `Im` (+ primary winding R `rp`) across the
  primary, the secondary EMF forced **hard** to `n·V_Lm` (n × the *magnetiser* voltage,
  NOT the terminal voltage — that's what keeps DC blocked), the secondary current
  reflected `n·Is` into the primary KCL. Readout = `Im + n·Is`. Two refinements the
  build forced (see `transformer-bridge-convergence.md` §7): (1) the secondary carries
  **zero** series resistance — a `rs·Is` term softens the differential and the bridge
  runs away (positive feedback `Is = [n·V_Lm+Vcap+2Vf]/rs` grows with the cap); `rp` on
  the primary still gives loss + DC-block saturation. (2) **No** secondary→ground
  common-mode resistor is needed (§4 was a red herring) — a floating AC-source baseline
  rectifies full-wave on the GMIN-only floor, so isolation is preserved. Removed the now-
  unused `TRANSFORMER_K`/`transformer_inductances`. New regression
  `transformer_bridge_rectifies_full_wave` (all 4 diodes conduct, Vout ≈ Vsec_pk−2Vf ≈
  10.4 V, ripple ~0.9 V, Iprim ~0.19 A, no spike/runaway) + `..._scales_with_ratio` (step-up
  n=2 / step-down n=0.5); `transformer_scales_ac` now expects ratio = n (no k). Main
  analog-RC golden untouched. **Audit agent passed** (owner asked): stamp math correct
  sign-by-sign, no determinism risk; findings folded in (ratio test, dead `reactive_state_b`
  removed, stale comments fixed). All gates green.~~

### QoL / fixes batch (owner, 2026-06-15 pm)
- ~~**Draggable net labels** (KiCad-style): drag the tag pill; the dot + leader stay
  pinned to what it names. `NetLabel.tagOff` + `graph.moveNetLabel` + a lightweight
  `onPersist` board callback (save+undo, no netlist rebuild / clock rewind). (#65)~~
- ~~**AC mains amplitudes**: 60 Hz freq; peak chips 170/311/325 V (= 120/220/230 Vrms);
  RMS readout beside the peak; one-tap US/EU mains presets (amp + freq). (#65)~~
- ~~**Pan yields to Build on a grab**: clicking a component or wire in Pan switches
  to Build/Select and grabs it (move/reshape); empty still pans. `onMode` callback.~~
- ~~**R rotates the ghost when a part is armed** (was rotating a leftover selection).~~
- ~~**Open-loop current-source fix verified** (re-ran harness: open = 0 mA/0 V, closed
  = 10 mA/10 kV). Residual: a return path that's topologically present but DC-broken
  by *value* (open switch / lone cap) isn't caught by the topology-only union-find —
  needs the value-aware singular detection already on the backlog.~~
- [ ] **Drop a component onto existing track(s) should split/remove the spanned
  segment**, not leave it shorting the pins (e.g. a Transformer across dual tracks —
  the wire between the corner pins must be cut so the part bridges them, not the wire).
  *Analysis:* `placeCell` needs a post-place pass that, for each placed pin landing on
  an existing wire's route, splits that wire at the pin (reuse `junctionOnWire`/the
  split path) and removes any wire segment that runs **between** two of the new part's
  own pins (that's the short). Medium-complex; touches `placeCell` + graph split.
- [ ] **Delete on a wire deletes only the segment up to the nearest junction(s)** on
  that run, not the whole pin-to-pin wire. *Analysis:* wires already SPLIT at junctions
  (`junctionOnWire`), so a junction-bounded segment is its own wire object and deletes
  alone — the gap is deleting a single **segment between waypoints/corners** of one
  multi-bend wire object: needs `deleteSelection` (or a wire-segment delete) to split
  the wire at the clicked segment and drop only that piece. Medium-complex.
- [ ] **Wiring auto-complete with a junction (KiCad continue)**: while drawing a wire,
  clicking an existing trace drops a junction, ends the wire there, and **continues** a
  new wire from it. *Analysis:* the current model is **drag-per-wire** (press a pin →
  drag → release completes in `onPointerUp`; `finishWireOnWire` then `cancelWiring`).
  KiCad continue needs (a) `finishWireOnWire` to RETURN the new junction and the
  up-handler to set `this.wiring = {from:{junctionId}}` instead of cancelling, AND
  (b) `onPointerDown` reworked so a press **while already wiring** COMPLETES at the
  target (pin/wire/junction) instead of overwriting `this.wiring` with a new start —
  i.e. a click-to-place mode. The (b) rework is the real work; do it deliberately.
- ~~**Scope time window**: selectable, decimated span (0.48 ms/4.8 ms/48 ms/0.48 s);
  base span = old per-tick behaviour; ⏱ button cycles it, duration labelled on scope.~~

### Shipped this session (editor fixes + phase-shift + info-panel P1)
- ~~**Pan tool regression**: the Esc-default pan no longer blanket-grabs pointerdown —
  pin/junction press starts a wire, wire press reshapes, armed click places; only a
  body/empty drag pans. `arm()` leaves pan for select. (board.ts + App.svelte.)~~
- ~~**Label ghost**: onPointerMove now refreshes the ghost in `label` mode, so the
  name-pill preview follows the cursor + snaps (was only `armed`/`junction`).~~
- ~~**Open-loop current source** zeroed (see deeper-#2 tombstone below).~~
- ~~**POT B-terminal investigation**: NOT a bug — a properly-wired W→B leg conducts
  (verified 0.31 mA via the wasm solver); the user's ~0 reading reproduces the
  B-floating (rheostat) case exactly. Wiring near-miss, no code change.~~
- ~~**Phase-shift example** (`phase-shift`, Filters): corrected to 138 Hz
  (= 1/(2πRC√6)) with honest 56°/112°/180° tap labels + the 1/29 attenuation lesson +
  a detune-to-1 kHz demo. Verified end-to-end (transient sim: −180.0°, 1/29.1).~~

### Logic gates: separated analog/digital domain — DECIDED, building (owner, 2026-06-15)
**Decision (doc §6):** build the **full** separated digital domain NOW (families +
driver/receiver boundary + deterministic event scheduler + level-bearing hash), with
a **legacy-ideal default** (existing circuits identical; only gate/DFF goldens regen
when the scheduler lands; future digital parts golden-additive). Owner: lowest risk
of a future re-break.
- ~~**Phase 0 — family substrate (golden-stable).** `LogicFamily`{v_ih/v_ol/v_oh
  frac, g_ol/g_oh} + `LEGACY` const reproducing the original gate exactly;
  `gate_target_level` routes through `LEGACY.reads_high`/`.drive`. Byte-identical,
  88 tests pass, golden unchanged; `legacy_family_matches_original_gate` guards it.~~
- [ ] **Phase 1** — receiver/driver split + in-core net classification (analog /
  pure-digital / boundary). Still LEGACY, still golden-stable.
- [ ] **Phase 2** — the deterministic **event scheduler** (integer-tick buckets, enum
  `Level{Low,High,Z,X}`, element-index order, one-tick-delay feedback) + fold digital
  net levels into `fnv1a`. **Regenerate gate/DFF goldens** (the one deliberate break).
  Extend to the DFF. Per-family `*_run_is_reproducible` + mixed-rail + open-drain tests.
- [ ] **Phase 3** — boundary threading to web (family value-chip, noise-margin /
  forbidden-band readouts) + surface **XNOR(5)/BUF(7)** (the `GATE_AUX` gap).
- [ ] **Phase 4** — open-drain / Z / wired-AND + a first-class **level-shifter** part
  (golden-additive).
- The acceptance bar + exact design are in `logic-analog-digital-nets.md` §6. Do the
  scheduler with full budget — never land a half-built non-deterministic engine.

<details><summary>Original brainstorm summary (superseded by the §6 decision)</summary>
Brainstorm doc **written** at **`docs/ui/logic-analog-digital-nets.md`** (agent).
Recommends a 4-phase path: **(0)** add a `const` logic-family descriptor defaulted to
a legacy-ideal family that reproduces today's numbers *exactly* (golden untouched —
same trick as the AC `aux`/4th-terminal `d`); **(1)** opt-in real families with honest
`V_IL/IH/OL/OH` + asymmetric pull-up/down + open-drain (a deliberate golden regen);
**(2)** noise-margin/forbidden-band warnings + a first-class **level-shifter** part
(mostly presentation); **(3)** only when digital gets big, a separate deterministic
event scheduler (the architecture doc's target; the one hash-changing, risky step).
Includes a debug/validation plan (per-family threshold tests, mixed-rail, open-drain,
reproducibility, a legacy-equivalence golden guard). Decide direction before Phase 1.
- [ ] **Latent bug the agent flagged:** XNOR/BUF exist in sim-core `gate_logic` but
  aren't wired in `GATE_AUX` (web), so they're unreachable as placed parts. Verify +
  wire them (or confirm intentional). Cheap; do alongside Phase 0/1.
Owner: the gates (`ELEM_GATE=17`) currently can't handle logic-high being anything
but their set HIGH value and low being exactly 0 — no V_IL/V_IH vs V_OL/V_OH, no
noise margin, no mixed-rail interfacing (a 3.3 V part driving a 5 V part), no notion
of a divided/pulled input. Likely endgame: a **separated analog vs digital net
system with boundary/barrier elements** (or a per-gate logic-family descriptor under
the single analog solve). Must stay **golden-stable** (any sim-core behaviour change
⇒ regenerate the golden + justify) and keep the coarse JS↔wasm boundary. Doc must
include a **debug/validation plan** (deterministic sim-core tests across families +
mixed-rail interface cases). Decide direction after reading the doc.
</details>

### Editor: copy/paste + marquee select + group drag (owner, 2026-06-15)
- ~~**Box / marquee select** (Select-mode empty drag; shift = additive): rubber-band
  rect selects components whose centre is inside + wires with both ends inside +
  junctions inside. `board.ts` marquee layer + `finalizeMarquee`.~~
- ~~**Group drag**: already worked — `beginDrag` grabs the whole selection; internal
  wires re-route via their pins. (No change needed.)~~
- ~~**Copy/paste/cut** (⌘/Ctrl-C / -V / -X): in-memory `ClipboardSnippet` (components +
  internal wires + net labels on their pins); paste with fresh ids at a growing offset,
  remapped onto the new ids, re-selects the group. Cut = copy + delete. Same-named
  labels still alias by design. Validated through the harness.~~
- ~~**Persist board state across refreshes.** `lib/storage.ts` saves the
  `BoardGraph.serialize()` to localStorage (debounced 400 ms) on every edit and
  restores it on load (falls back to the primer only on a true first visit). Guarded
  try/catch + light shape validation. Not cookies.~~
- [~] **Persist progress/tutorial state.** Versioned `Settings` blob
  (`seenIntro`/`explainAsYouGo`/`seenConcepts`) + `loadSettings`/`saveSettings`
  **scaffolded** in `lib/storage.ts`; onboarding wires its writes/reads when built.
- ~~**Reset-progress button.** A `↺ Reset` chip in the header → `resetAll()` (clears
  board + settings) + reload to a clean first-run; confirmed so it can't nuke a board
  by accident.~~

### Absolute-beginner onboarding / first-run (owner-driven; MVP shipped)
Design doc at **`docs/ui/onboarding-first-run.md`**. Pull-based discovery layer.
- ~~**Learn-as-you-explore, not a rail** + **NO levels — pull-based, one mute** +
  **replayable**: shipped as the MVP — `concepts.ts` (4 first-encounter cards:
  source/ground/loop/reading) offered the moment the board shows each true (reactive
  triggers on board state), deduped via queue + persisted `seenConcepts`; one
  `explainAsYouGo` mute; an always-on **"?" Help handle** (mute / replay tips / re-show
  intro); settings load+persist via `storage.ts`; cards hold off behind the cold open.~~
- [ ] **Heavier guided pieces (deferred, §1–§3/§6):** cold-open auto-play of the
  primer + the "Show me / Let me build" fork; the guided **first-build wiring
  affordances** (pin-glow on the active step, next-edge ghost "from here → to there");
  **bin-narrowing + pre-arm** for the first build; tie the cards to a Lab Notebook codex.

### Component info panel — frictionless trigger + pinout + construction cutaways (owner-greenlit, queued)
Full design in **`docs/ui/component-info-panel.md`** (ideation, brainstormed
2026-06-15). Make rich component info reachable without breaking build flow.
Owner-approved direction + defaults:
- ~~**Phase 1** — open the info drawer on **double-click** a component (`onInspect`
  board callback; works from Select + Pan), + an `I` hotkey toggle, + an `ⓘ` chip on
  the value popover. Reuse the right-side `.info-drawer`; Esc closes the drawer first.
  **Oriented labelled pinout** shipped (`web/src/lib/pinout.ts`: `PART_KINDS.pins`
  rotated by `selPart.rot` → SVG body+legs+dots + DOM labels + per-leg glosses).
  MSW 2nd-click-of-a-double suppressed so double-click stays universal.~~ (shipped)
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
- ~~**Thermistor NTC/PTC** (catalog §6.3) — placeable now: catalog + schematic glyph +
  heat-valve analogy + temperature knob, with R(T) stamped as a plain resistor (web-only,
  the POT pattern). See 2026-06-17 (4).~~ Still open: the SIM-SIDE thermal state P7
  (self-heating from I²R) so temperature is modelled, not just a knob — the `temp` field
  and `thermistor.ts` curves are already shaped for it. **Med.**
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
- ~~**Dangling current-source affordance (deeper #2)**: an ideal current source whose forced current has no return loop made the MNA system singular → the deterministic zero-pivot fallback reported a phantom (full current "flowing" + huge IR voltage). `buildNetlist` now **zeroes the forced current** of every detected `floatingSources` member so the dead branch reads an honest 0 mA / 0 V (the amber "no return path" banner explains why); closing the loop restores the real value. Verified through the wasm solver (open: 0 mA; closed: 10 mA / 10 kV). Web-only, golden-safe.~~
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

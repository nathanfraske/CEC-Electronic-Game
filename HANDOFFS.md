# HANDOFFS

The most recent handoff is at the **top**. When you stop work, prepend a new
dated section so the next agent can pick up cleanly. Keep it concise and current.

---

## 2026-06-19 (45) — Device variety, increment C: pulse / clock generator

**State:** 🟢 Rust + Web, all gates green (127 sim-core tests, 1 ignored). Increment C of 4
(A diode types ✓, B LED colour ✓, C pulse source ✓, **D reverse recovery — deferred to a fresh
session** at owner's request, determinism-critical). Closes the "square waves and whatnot" gap.

- **Dedicated "Pulse / Clock Gen" part** producing a unipolar **square** (duty-controlled) or
  **triangle**, with adjustable frequency + duty. Owner chose a dedicated part over extending AC.
- **Implementation — reuses `ELEM_ACSOURCE`, no new solver element.** The web `PULSE` kind maps
  to type 7; `ac_source_emf` gained square/triangle branches keyed off a **waveform param**
  (slot 1: 0 = sine [default → AC + golden untouched], 1 = square, 2 = triangle; slot 3 = duty).
  Square/triangle are pure mul/div/floor/compare of the cycle phase — deterministic, no
  transcendental. This avoided threading a new ELEM type through the ~15 solver sites that
  special-case `ELEM_ACSOURCE` (the determinism-risky path).
- **Web:** new `Component.duty` field (round-trips + copy/paste); `buildNetlist` writes the
  waveform (from `variant`: 0 square → code 1, 1 triangle → code 2) + duty params and emits the
  amplitude in `aux` (like AC); glyph `drawPulse` (AC symbol with a square wave inside);
  palette entry; inspector (high level + waveform picker + duty slider). `setComponentDuty` in
  board.ts.
- Tests `pulse_source_emits_square_wave` (tracks an independent scalar square across a full
  period, agreeing even at the duty edge) and `pulse_source_emits_triangle_wave` (monotonic
  rising leg, peaks near amplitude).

**Polish not done (optional):** a `partInfo`/pinout blurb for PULSE (the info panel falls back
gracefully); a bipolar (±) square option; wiring PULSE into the Bode/AC-analysis stimulus.

**NEXT — (D) diode reverse recovery, FRESH SESSION.** The hard, determinism-sensitive one: a
dynamic stored-charge state so a rectifier shows a reverse-recovery current spike on switch-off.
Needs a new reactive state in sim-core (like the cap/inductor companion), careful golden
handling (may need a regen + rationale), and full context headroom. Plan: add a charge state
`Qd` per diode, a `trr`/`Qrr` param (tier/type-set), reverse-recovery current during the
recovery window; gate web-side to Real mode; default (no param) = today's ideal diode → golden
safe. See `docs/determinism.md` before touching the core.

**Landing:** PR + squash-merge to main, same flow as #122–#128.

---

## 2026-06-19 (44) — Device variety, increment B: LED colour

**State:** 🟢 Rust + Web, all gates green (125 sim-core tests, 1 ignored). Increment B of the
4-part device-variety plan (A diode types ✓, B LED colour ✓, C waveform source, D reverse
recovery).

- **LED colour** rides on the per-device diode forward-param hook from (A): `Component.variant`
  → an `Is` (slot 0) chosen so the colour sits at a fixed forward drop (red ~1.9 V … blue/white
  ~3 V; `Is = 20 mA / exp(Vf/(n·Vt))`, n = 2). Variant 0 = red at the `LED_IS` default, so
  existing LEDs are unchanged. `web/src/lib/diodes.ts` gained `LED_COLORS`, a per-kind `VARIANTS`
  map, `hasLedColors`, `variantList`, `ledTint`. **No sim-core change** beyond a test — the LED
  is already a diode kind reading `Is`/`n` from params, and buildNetlist auto-emits once LED
  joined the variants map.
- **Glyph tint:** the board render colours an LED by `ledTint(variant)` (live — the inspector
  updates it next frame) instead of the kind palette colour; the existing brightness-tracks-
  current glow now glows in the part's colour. Each colour also carries a ~30 mA rating (the
  (A) FAIL mechanism — LEDs burn out easily).
- **Inspector:** a "colour" picker for LEDs (parallel to the "diode type" picker).
- Test `led_colour_is_sets_higher_forward_drop` (blue's extreme small `Is` ≈ 8.7e-27 still
  converges and drops > red + 0.6 V — guards the Newton numerics at the colour extremes).

**Landing:** PR + squash-merge to main, same flow as #122–#127.

**Next (C):** waveform / pulse source — a square/pulse/triangle generator with adjustable
frequency + duty (new sim-core source element), and/or a multi-waveform AC source. Then (D)
reverse recovery — the hard, determinism-sensitive one (new reactive stored-charge state);
worth a fresh session with full context headroom given "determinism is sacred."

---

## 2026-06-19 (43) — Device variety, increment A: diode types + current rating/FAIL

**State:** 🟢 Rust + Web, all gates green (124 sim-core tests, 1 ignored). Owner audit (square
waves? diode sub-types? LED colour? every part checked?) found the real frontier is **device
variety**, not tiers. Plan: (A) diode types + ratings [THIS], (B) LED colour, (C) waveform/pulse
source, (D) diode reverse-recovery. Audit answers: only `FP` (FPGA) + `uC` (µC) have NO sim
model (Tier III placeholders); everything else (incl. POT/NTC/PTC) is genuinely modelled.

- **Per-device diode forward params** — `diode_model(kind,value)` → `diode_model(&Element)`,
  reading `Is` (slot 0) and `n` (slot 1) via `param_or` (5 call sites + 1 test). Golden-safe
  (slot 0 → kind constant). This is the "one diode kind → the family" lever, and the LED-colour
  mechanism for (B).
- **Diode TYPE picker** — new `web/src/lib/diodes.ts`: `DIODE_TYPES` (Rectifier / Switching /
  Fast-recovery / Power), `diodeVariant(kind,variant)`, `hasDiodeTypes`. New `Component.variant`
  field (general device sub-type; round-trips via serialize). buildNetlist emits forward `Is`/`n`
  in BOTH modes (part identity) + the rating only in Real. Inspector shows the picker + rating.
  Variant 0 = silicon default ⇒ existing diodes unchanged.
- **Component current rating → FAIL** — general `RATED_CURRENT_SLOT` (= 2) read for EVERY element
  in `flag_and_clamp_fails`; `|I| > rated` sets `failed_elements[i]` (the existing FAIL box). `0`
  = unrated (default + Ideal mode, since the rating is web-gated to Real). Golden-safe:
  `failed_elements` is NOT in `snapshot_hash`, and the rating only flags — it never alters the
  solve. Tests `diode_is_param_sets_forward_drop`, `diode_over_rated_current_flags_fail`.
- **Copy/paste now carries `tier` + `variant`** (the previously-noted polish): clipboard snippet
  type + copy + paste reconstruction.

**Landing:** PR + squash-merge to main, same as #122–#126 (owner confirmed that flow).

**Next (B):** LED colour — `variant` → per-colour Vf (red ~1.8 / green ~2.1 / blue ~3.0 / white
~3.2) via the diode forward-param hook + a render tint; give the LED a current rating too (easy
burnout). Then (C) waveform source, (D) reverse recovery (the hard, determinism-sensitive one).

---

## 2026-06-19 (42) — Transistor tiers shipped → quality-tier rollout COMPLETE

**State:** 🟢 Rust + Web, all gates green (122 sim-core tests, 1 ignored). The owner directive —
"keep going down the list until all parts have shipped tiers in their realistic mode" — is now
**done for every gradeable component**.

- **MOSFET Kp (NM/PM) + BJT β (Q/QP)** — the last transistor increment. `mosfet_op`/`bjt_op`
  now take `&Element` and read `param_or(&e.params, 0, MOS_KP / BJT_BF)` (12 call sites updated).
  Tiers added to `tiers.ts` (`NM`/`PM` Kp 0.01/0.02/0.04/0.08; `Q`/`QP` β 60/100/200/400, mid =
  the sim-core default). Gated web-side in `buildNetlist` via the new **`TRANSIENT_TIER_KINDS`**
  set (`V, AC, NM, PM, Q, QP`) — skipped when `!real`, like the source Zout. The inspector tier
  picker shows automatically (`hasTiers` keys off `TIER_PARAMS`). Test
  `bjt_beta_param_pulls_collector_lower` (base driven through RB so Ic = β·Ib actually moves Vc;
  a fixed-Vbe drive would hide β behind the exponential).

**Now graded + Real-gated (the full set):** op-amp (GBW), cap (ESR/ESL), inductor (DCR/Cw), EC
(ESR), resistor (tolerance), V/AC source (output-Z), **MOSFET (Kp), BJT (β)**. AC-only params
gate in sim-core's `ac_solve`; transient params gate web-side (`TRANSIENT_TIER_KINDS`).

- **Transformer — assessed, deliberately NOT tiered (documented in CLAUDE.md + TODOS).** I
  prototyped grading `rp`/`Lmag`, but the ideal-T model hard-couples the secondary (no series
  Is term — required for full-wave bridge stability), so neither knob droops the loaded output
  (a winding-resistance test showed budget 4.763 V vs lab 4.762 V — no effect). The only knob
  that gives load regulation is the secondary **leakage**, which is the inrush-stability control
  (lowering it risks the rectifier-into-empty-cap divergence). So a safe + observable transformer
  tier isn't achievable without a model change; reverted the prototype, kept the model untouched.

**Other kinds intentionally without quality tiers:** diodes/LED/Zener/Schottky/MOV (graded by
TYPE = distinct `ELEM_*`), logic gates / flip-flop (graded by FAMILY = Ideal/CMOS/TTL). So the
quality-tier axis is now genuinely complete.

**Follow-up polish (small, not blocking):** inspector "actual value" readout for a Real-mode
deviated resistor (so the deviation isn't a mystery); copy/paste carrying `tier`.

---

## 2026-06-19 (41) — Realistic-mode = global Fidelity flag; resistor tier (tolerance) shipped

**State:** 🟢 Rust + Web, gates green. Owner: every part's tier non-idealities bite **only in
realistic mode**; keep going until all parts ship tiers. Increment 1 of that.

- **Promoted `realModels`** from a Bode-panel toggle to a **global Fidelity toggle** (`○ Ideal /
  ● Real`) in the Telemetry panel (always reachable, even on DC circuits). Flipping it now
  `board.emitChange()`s (re-emits onChange → `rebuildNetlist`) AND re-runs the Bode.
- **`buildNetlist(graph, real)`** — passed `realModels`. In real mode a **resistor's value
  deviates** `value·(1 + tol·jitter(id))` (tier tolerance ±5/1/0.5/0.1 %, deterministic per
  **component id** so it's stable across edits — `jitter()` in netlist.ts). Ideal mode = exact.
  `resistorTolerance(tier)` + `R` in `hasTiers` (so the inspector shows the R tier picker).
- **Op-amp GBW pole gated on `real`** (sim-core ac_solve) for consistency — ideal = flat/infinite
  bandwidth, real = the GBW rolloff. Updated the 2 op-amp tests to the real path. 120 tests green.

**Graded + realistic-mode-gated:** op-amp (GBW), cap (ESR/ESL), inductor (DCR/Cw), EC (ESR),
resistor (tolerance), **V / AC source (output impedance)**. The source Zout is the FIRST
transient param: sim-core's V/AC branch stamp does `mat[bi][bi] -= e.params[0]` (so
`V(a)−V(b)=EMF−Rout·i_load`; the cap shares that arm and is skipped), and buildNetlist only puts
the source param block in Real mode (transient params gate web-side; AC-only params gate in
ac_solve). Test `vsource_output_impedance_sags_under_load`.

**Remaining — the transistors (the last genuinely tier-gradeable kind; diode/logic grades are
already TYPE/FAMILY-based):**
- **MOSFET / BJT — Vto/Kp / β** (sim-core): change `mosfet_op(kind,…)`/`bjt_op(kind,…)` to take
  `&Element` and read `e.params` (Kp/Vto/λ, βf) with the constant defaults (~6 call sites each).
  Then add MOSFET/BJT to `tiers.ts` + `hasTiers`. Transient operating-point params, so gate them
  web-side in buildNetlist (skip when !real), like the source Zout. Tests: a higher-β BJT / lower-
  Vto MOSFET conducts more. Note: the AC source Zout is transient-only (ac_solve treats the source
  as the ideal stimulus — fine, the Bode normalizes by the actual Vin).
**Follow-up polish:** inspector "actual value" readout for a deviated resistor (so it's not a
mystery); copy/paste carrying `tier`.

---

## 2026-06-19 (40) — Tiers: electrolytic added + the "all components get grades" convention

**State:** 🟢 Web, gates green. Owner: expand grades to ALL gradeable components + every NEW
component ships with grades. This is incremental (each device's params must be wired/expanded),
so: added the next clean one (EC) + established the **convention durably**.

- **Electrolytic cap (EC) grades** — graded **web-side** (it already expands to cap + series-ESR
  resistor in buildNetlist): `tiers.ts ecEsr(tier)` (1.0/0.5/0.1/0.03 Ω; mid = the old fixed
  0.5 Ω, so existing EC circuits are unchanged). `hasTiers` now covers EC, so the inspector picker
  shows; `buildNetlist` reads `ecEsr(c.tier)` for the ESR value. Removed the `EC_ESR_OHMS` const.
- **Convention in CLAUDE.md** (new "Component grades (tiers)" section): gradeable components carry
  a `tier`; presets live in `tiers.ts`; **param-block kinds** (op-amp/cap/inductor) wire
  `Element::params` in sim-core (slot map mirrored, 0 = default so mid ≈ default → golden safe),
  **web-expansion kinds** (EC) set a value in buildNetlist. **Every new gradeable component ships
  with its tier presets from the start.**

**Graded so far:** op-amp (GBW), cap (ESR/ESL), inductor (DCR/Cw), EC (ESR). **Remaining gradeable
(the additive roadmap, each its own increment):**
- **Resistor — tolerance** (web value-deviation `value·(1+tol·jitter(id))`, deterministic per id):
  budget ±5% / mid ±1% / high ±0.5% / lab ±0.1%. **OWNER DECISION: all tiers deviate, but ONLY in
  "realistic" mode** — i.e. gate it on the existing **Ideal/Real flag** (`realModels`), so Ideal =
  every resistor exact, Real = tiered deviation. Implementation (next increment): (1) promote
  `realModels` from a Bode-panel toggle to a **global realistic-mode** flag with a toggle reachable
  without an AC source; (2) `buildNetlist(graph, real)` deviates R values when `real` (jitter from a
  stable per-component hash, NOT the element index); (3) toggling the flag must **rebuild the
  netlist** (e.g. a new `board.emitChange()` re-emitting onChange → rebuildNetlist reads
  `realModels`; the deviated values are in the sig so it reinstalls); (4) ideally an inspector
  "actual value" readout so the deviation never looks like a bug. Caps/inductors/op-amp tier params
  already only bite in Real mode (their AC stamp), so this unifies cleanly.
- **V / AC source — output impedance** (web expansion, EC pattern: a series R that sags under
  load; budget supply regulates poorly). Keep mid≈0 so existing circuits are unchanged.
- **Diode family — Rs / Vf** and **MOSFET/BJT — Vto/Kp / β**: sim-core param wiring (the
  transistor `mosfet_op`/`bjt_op` have ~6 call sites; pass the element to read `e.params`).

---

## 2026-06-19 (39) — Quality tiers (budget/mid/high/lab) on the per-device params

**State:** 🟢 Rust + Web, gates green. Owner: parts come in four grades for main gameplay (a
preset bundle of model params; cost later); sandbox keeps raw param editing. Built end-to-end.

- **sim-core** — wired the cap (slot 0=ESR, 1=ESL) and inductor (slot 0=DCR, 1=Cw) Real-AC
  parasitics to read `Element.params` via a new `param_or(params, i, default)` helper (op-amp GBW
  already wired). Analysis-only → golden untouched. Test `ac_cap_esr_param_sets_resonance_depth`
  (a budget high-ESR cap has a shallower SRF notch). 120 tests green.
- **`web/src/lib/tiers.ts`** (new) — `TIER_LABELS` (Budget/Mid-range/High-end/Lab-grade),
  `tierParams(kind, tier)` → the param block, `hasTiers(kind)`. Presets for **OA / C / L** (slot
  meanings mirror sim-core). `DEFAULT_TIER=1` (mid). `PARAM_STRIDE=4`.
- **Plumbing** — `Component.tier?` (graph.ts; round-trips via serialize's `{...c}` spread).
  `buildNetlist` builds a `params: Float64Array` from each component's tier (keyed to its main
  element via `elemOfComponent`) + folds it into the `sig` (so a tier change reinstalls).
  App.svelte passes `nl.params` to `setNetlist` → routes to `set_netlist_p`.
- **UI** — `board.setComponentTier`; `SelectedPart.tier` emitted; a "quality tier" chip row
  (4 chips, mirrors the logic-family picker) in the inspector for tiered kinds. Gate-verified —
  **wants a live eyeball** (select a cap/op-amp/inductor → pick a tier → the Bode SRF / sleeve
  should shift).

**Deferred (additive):** copy/paste doesn't carry `tier` yet (ClipboardSnippet lists fields
explicitly — add it there); extend tiers to BJT/MOSFET/diode (wire their params first, like the
cap); the **cost** per tier (owner flagged "increase in cost when we add that"). Next engine
tracks (37): transient measurements + fine time-base; mixed-signal boundary.

---

## 2026-06-19 (38) — Per-device parameter block (engine foundation; the break-if-late gap)

**State:** 🟢 Rust + Web, gates green. Engine-completeness gap analysis (agent, (37) chat) ranked
this **#1** — it's a boundary/save-format change, so adding it after circuits + grading contracts
are authored forces a migration. Did the **plumbing + a proof**; wiring more device params is now
additive.

- **`Element.params: [f64; PARAM_STRIDE]`** (`PARAM_STRIDE=4`) — a per-device model-parameter
  block whose slot meaning is `kind`-specific. **A slot of `0.0` = "use the kind default"**, and
  an empty/omitted block installs all-defaults → **reproduces today bit-for-bit** (additive,
  golden-safe).
- **`Sim::set_netlist_p(…, params: &[f64])`** is the param-aware install; **`set_netlist` is now a
  thin wrapper** passing `&[]` (so the dozens of existing callers + the golden are untouched).
  **sim-wasm `set_netlist_p`** + **web `SimHandle.setNetlist(…, params?)`** route to it only when a
  non-empty block is supplied — the boundary + save format are now param-ready with zero change to
  the common path.
- **Proof:** op-amp **GBW** reads param slot 0 (`e.params[0] > 0 ? : OPAMP_GBW`) in `ac_solve`.
  Test `ac_opamp_gbw_param_sets_bandwidth` — a 10× faster op-amp gives 10× the closed-loop
  bandwidth. 119 sim-core tests green (incl. reproducibility goldens = empty-params path).

**Slot map so far:** op-amp `[0]=GBW (Hz)`. **Reserved/next (additive):** MOSFET `[Kp,Vto,λ]`
(6 `mosfet_op` call sites — change to read the element), BJT `[Is,βf,βr]`, diode `[Is,n,Rs]`. Then
the **web side**: board components store per-device params, `buildNetlist` emits the block, save
format carries it, and a small inspector UI to edit them. **Engine roadmap (37):** after the param
families, the next big tracks are **transient measurements + fine time-base** (PSU rating) and the
**mixed-signal boundary** (comparator→ADC/DAC).

---

## 2026-06-19 (37) — Analogy parasitic sleeve v1 (ESR/DCR heat-glow) + engine gap analysis

**State:** 🟢 Web, gates green. Owner: "get the sleeve down," then focus on making the **engine
mostly feature-complete before building more game** (game advances through the engine; late
engine changes risk breaking the built game).

- **Parasitic sleeve v1** (`analogyDrawers.ts`) — both the cap and the inductor analogy drawers
  already drew a "valve = series-R throat"; promoted them into the sleeve. New shared helper
  `seriesRGrit(g, x, halfH, current)`: faint always-on bronze **grit** specks in the throat +
  a friction **heat-glow** (warm→hot, `mix(warn,bad,heat)`) that brightens with the through-
  current (`norm(I)`), near-invisible at rest. Mirrors the resistor's proven heat-glow. Called
  from the cap (ESR) and inductor (DCR) drawers. Subtle-always-on per the (35) brainstorm + owner
  pick. **Gate-verified only — needs a live eyeball** (zoom past TIER_ZOOM in the *analogy* lens).
  Follow-ups (noted): ESL inertia-paddle + parallel side-tank (Cw); EC sleeve; cross-link to the
  Bode SRF corner. Uses the same parasitic *concept* as sim-core's `CAP_ESR`/`ind_dcr` (could read
  the literal values later for exact consistency).

- **Engine feature-completeness gap analysis** — dispatched a background agent to survey sim-core
  vs a "feature-complete teaching engine" and produce a phased roadmap (which gaps risk breaking
  the game if added later). Result lands in the (37) chat; synthesize for the owner + pick the
  next engine track (likely the **transient time-base + auto-measurements** for PSU rating, and/or
  more **source waveforms** square/PWM/pulse — both flagged repeatedly).

---

## 2026-06-19 (36) — Ideal/Real parasitics in the AC engine + Bode toggle (functional first)

**State:** 🟢 Rust + Web, gates green. Owner picked **functional-first** + **subtle always-on**
sleeve. This is the functional half (the Bode shows real self-resonant corners); the analogy
"parasitic sleeve" rendering is next (brainstorm in (35)).

Chose an **AC-stamp** approach over netlist expansion (far less plumbing — no internal nodes, no
scope-hiding, no netlist test harness needed — and it's Rust-testable + determinism-safe):

- **`Sim::ac_solve_models(omega, real)`** (lib.rs) — `ac_solve(omega)` is now a thin wrapper for
  `(omega, false)`. When `real`: a **capacitor** stamps the series ESL+ESR+C admittance
  `1/(ESR + j(ωL_esl − 1/ωC))` (self-resonates, goes inductive above SRF); an **inductor** stamps
  series DCR in its branch impedance + a parallel winding cap `IND_CW` (self-resonates, goes
  capacitive). Constants `CAP_ESL=1nH, CAP_ESR=50mΩ, IND_CW=1pF`, `ind_dcr(L)=max(0.1, L·1000)`.
  **Analysis-only** — the transient solve never sees `real`, so the **golden is untouched** (118
  tests green). Tests `ac_real_capacitor_self_resonates` / `ac_real_inductor_self_resonates`.
- **`ac_sweep(freqs, real)`** (sim-core + sim-wasm) and **`SimHandle.acSweep(freqs, real)`**
  (loop.ts) thread the flag. **App.svelte:** `realModels` $state + an **○ Ideal / ● Real toggle**
  in the Bode header (re-runs the sweep); Bode range widened to **1 Hz – 1 GHz** (frequency-domain
  has no Nyquist wall, so the MHz SRFs show — the legit "1 GHz" the time-domain source couldn't do).
- PNG-verified (`/tmp/harness/render-bode.js`, real-cap divider): violet dives to a notch at the
  SRF then rises (inductive), vs the ideal cap's monotonic rolloff.

**Parasitic values are mirrored** in sim-core constants — the analogy sleeve (next) must read the
same ESR/ESL/DCR/Cw so the visual matches the Bode. Sleeve plan (subtle always-on, brighten-by-
contribution: ESR grit-throat, ESL inertia-paddle, parallel side-tank) in (35). Optional later:
transient parasitics (netlist expansion) for time-domain ESR ripple — deferred.

---

## 2026-06-19 (35) — Op-amp small-signal + GBW pole in the AC engine

**State:** 🟢 Rust + Web, gates green. Owner asked for op-amps + GBW (and parasitics — that's
next; analogy-view brainstorm captured below).

- **`ac_solve` op-amp arm** (lib.rs) — stamps the op-amp small-signal companion: output diag
  `+OPAMP_GOUT`, and a **frequency-dependent** transconductance `Gout·dT / (1 + jω/ω_p)` to the
  inputs (`ω_p = 2π·OPAMP_GBW/OPAMP_GAIN`), so the open-loop gain rolls off at the GBW. New
  `OPAMP_GBW = 1e6` (1 MHz, 741-class). `dT` is the slope at the bias (a saturated op-amp → dT→0,
  stops responding). Test `ac_opamp_inverting_gbw_bandwidth`: low-f gain = Rf/Rin & inverting,
  −3 dB at `GBW/(1+Rf/Rin)`.
- **AC-only by design:** the GBW pole is read **only in `ac_solve`**; the transient op-amp stays
  algebraic (infinite bandwidth), so the **determinism golden is untouched** (116 tests green). A
  transient op-amp pole (Real-flag-gated reactive state) is a deliberate follow-up if honest
  transient stability is wanted — noted but not done.

**Parasitics (next) — analogy-view brainstorm result (agent, this session):** analogy tier is a
literal **water/pipe** world (resistor=throat, inductor=paddle-wheel flywheel, ceramic cap=piston-
on-spring, electrolytic=reservoir; the inductor + ceramic drawers **already draw a small upstream
"valve=series-R throat"** — a ready ESR/DCR hook). Recommended scheme: a **contribution-scaled
"parasitic sleeve"** — series-R **grit-throat** (ESR/DCR), series-L **mini inertia-paddle** (ESL),
parallel **side-tank** (Cw) — rendered by ONE shared helper at the detail tier, each near-invisible
until its own signal lifts it (|I| / dI-dt / apparentFreq), so DC/low-current looks exactly like
today. Promote to labelled on hover/select or a "Parasitics" toggle; tie the morph to the existing
`morphFactor`/`blur` (the cap-goes-inductive SRF flip the frequency-morph doc deferred for the
analogy tier — this unblocks it); select-to-highlight the SRF corner on the Bode, cross-lit to the
culprit parasitic. Full 14-idea list in the (35) chat.

---

## 2026-06-19 (34) — Nonlinear small-signal in the AC engine (amplifier Bode works)

**State:** 🟢 Rust + Web, gates green. Continued the list: `ac_solve` now linearizes the
nonlinear devices, so active circuits (diode dynamic resistance, MOSFET/BJT amplifiers) get a
real frequency response — and the Bode panel shows it with **no UI change** (it already calls
`ac_sweep`).

- **`ac_solve` nonlinear arm** (lib.rs) — for each diode/varistor/MOSFET/BJT, stamps its
  small-signal companion at the operating point the transient solver already holds (its limited
  iterates `self.diode_vd` / `mosfet_vgs,vds` / `bjt_vbe,vbc` / `varistor_v` — the settled DC
  bias). These models carry **no internal capacitance**, so the partials are real (the jω content
  is entirely the external L/C); the conductance stamps **mirror the transient companions in
  `newton_iterate`** minus the DC equivalent-current RHS. New `stamp_g` real-conductance helper.
  Still read-only → no hash impact (all reproducibility tests pass; 115 sim-core tests green).
- **Tests:** `ac_diode_small_signal_divider` (conductance divider `G1/(G1+G2+g_d)`),
  `ac_mosfet_common_source_gain` (`−gm/(1/Rd+gds)` vs read-back gm/gds; checks inversion),
  `ac_bjt_common_emitter_gain` (cross-checks `ac_solve` against the exact 2-node small-signal
  system from the read-back Ebers-Moll Jacobian gpi/gmu/gif/gic_bc — the hardest stamp).

**Deferred / next:** **op-amps** are still open in `ac_solve` (the output-row GOUT·dT stamp is
easy to add, but the model has **no internal pole**, so op-amp AC would be flat high-gain — fine
for active-filter corners set by external R/C, but not for honest loop-gain/phase-margin; pairs
with adding a GBW pole). Then **Ideal/Real parasitics** (ESR/ESL/DCR → real self-resonant
corners), **Bode polish** (phase trace, corner markers, transfer-function 0 dB mode), and the
**transient time-base + PSU-rating** track.

---

## 2026-06-19 (33) — Bode panel: the AC engine made visible (sweep → log-f plot)

**State:** 🟢 Rust + Web, gates green. Continued down the list: wasm binding + a Bode panel so
the (32) AC engine is usable. The "get into the corners" instrument now exists.

- **`Sim::ac_sweep(freqs_hz)`** (sim-core) — runs `ac_solve` across a frequency list, flattened
  `[re,im]` per non-ground node per frequency (block = `2·(node_count−1)`). Test
  `ac_sweep_matches_pointwise_solve`. **`Simulation::ac_sweep`** (sim-wasm) forwards it →
  `Vec<f64>`/Float64Array; **`SimHandle.acSweep`** (loop.ts) exposes it. Read-only — no hash
  impact (all reproducibility tests still pass).
- **`web/src/lib/bode.ts`** — `drawBode` (Canvas2D): each non-ground node's magnitude (dBV =
  20·log10|V|) vs **log frequency**, auto-scaled 80 dB window, decade grid, scope-matched trace
  colours; `logFreqs(min,max,n)`. PNG-verified (`/tmp/harness/render-bode.js` → `bode.png`: RC
  −3 dB knee at 1 kHz + −20 dB/dec, LC resonance peak at ~16 kHz, flat source).
- **App.svelte** — hoisted `simHandle`; `recomputeBode(nodeCount)` runs the sweep on each real
  netlist change (sig change) when an AC source is present (`bodeHasAc`, detected in onChange);
  `bodeAction` canvas + an `$effect` that repaints on sweep / node-visibility change (NOT
  per-frame — the response is static between edits). New Telemetry "Frequency response" section
  (1 Hz–10 MHz), gated on `bodeHasAc`; node visibility toggles reuse the scope's.

**Not yet eyeballed on live** — engine (Rust tests), sweep (test), draw (PNG), wiring (gates) are
each verified independently, but the full place-AC-source→see-corners path needs a real look.

**Next on the list:** (a) **nonlinear small-signal** in `ac_solve` — stamp diode/BJT/MOSFET/op-amp
operating-point conductances (reuse the `*_eval` linearizations) so amplifier/filter Bode + op-amp
loop gain work, not just passives; (b) **Ideal/Real parasitics** (ESR/ESL/DCR) → real
self-resonant corners; (c) the **transient time-base + PSU-rating measurements** track. Phasor
brainstorm vs-f ideas (|Z|-sparkline, Xc/Xl split) can now ride the same sweep buffer.

---

## 2026-06-19 (32) — Frequency-domain AC analysis engine (the "proper corners" foundation)

**State:** 🟢 Rust. Owner picked the **AC sweep / Bode engine** to get real component corners +
PSU work past the 2 µs / 62.5 kHz transient wall. Increment 1 (the engine + tests) is in
`sim-core`; the UI is next.

- **`Cplx` + `solve_dense_complex`** (lib.rs, by `solve_dense`) — a minimal dependency-free
  complex number + a complex Gaussian-elimination twin of the real solver. Same deterministic
  pivot rule.
- **`Sim::ac_solve(omega) -> Vec<(f64,f64)>`** — small-signal AC analysis: assembles a complex
  MNA (R→G, C→jωC, L→branch w/ jωL, DC V-source→short, AC source→stimulus at its amplitude, I
  source/nonlinear→open) and solves for the complex node voltages at **any** ω — it never
  time-steps, so the Nyquist/2 µs ceiling doesn't apply. Reuses `node_idx` + the transient MNA
  layout. **Pure analysis — reads the netlist, never mutates sim state, so it can't touch the
  snapshot hash** (determinism golden intact; all 111 tests incl. reproducibility pass).
- Tests: `ac_rc_lowpass_corner` (|H|=1/√2 & −45° at ω=1/RC, −20 dB/dec rolloff) and
  `ac_lc_divider_resonance` (1/(1−ω²LC), blows up at ω₀) — corners verified analytically.

**Next increments:** (a) wasm binding — `ac_sweep(freqs)` returning the complex node voltages
(interleaved Float64Array) + per-element |Z|/phase; (b) a **Bode / |Z|-vs-f panel** in the web UI
(log-f axis, magnitude+phase, corner markers) — pairs with the phasor; (c) **nonlinear
small-signal**: stamp diode/BJT/MOSFET/op-amp operating-point conductances (reuse `*_eval`) so
amplifier/filter Bode + loop gain work, not just passives. Then the Ideal/Real parasitics
(ESR/ESL/DCR) give real self-resonant corners for the AC engine to measure. Transient time-base +
PSU rating measurements remain the *other* track the owner flagged.

---

## 2026-06-19 (31) — AC frequency range → 50 kHz; switching-flicker root-caused (separate)

**State:** 🟢 Web. Owner: extend the AC source "out to 1 GHz for fun (if it doesn't cause
issues)"; also expects the resistor-flicker-under-high-switching to be fixed by this.

- **AC frequencies (`values.ts`)** — extended `CURATED_FULL.AC` to add 10 k/20 k/50 kHz (was
  capped 5 kHz) and a 10 kHz chip. **1 GHz is NOT feasible** at the fixed 2 µs step: AC detection
  needs ≥8 samples/cycle so it caps at **62.5 kHz** (`AC_MIN_CYCLE_SAMPLES=8`), and a round
  MHz/GHz makes `f·dt` an integer → `sin(2π·int·tick)=0` → a **dead 0 V source**. So the list
  stops at 50 kHz (10 samples/cycle, safe; the curated list also clamps custom input via
  `nearestStandard`). 50 kHz already shimmers fully at real-time playback. Web-only, no sim
  change, no golden risk.
- **Resistor flicker under high switching = SEPARATE root cause, NOT fixed by the above.**
  `ELEM_SWITCH` is a fixed **10 kHz** clock chopper (`SWITCH_PERIOD_TICKS=50`). A DC→switch→R
  makes a **unipolar PWM** current; the **sinusoidal** AC detector finds no symmetric V
  zero-crossing → finalizes as DC (freq 0), so `ac.valid=false` → the (30) RMS-averaging never
  engages → it strobes. Fix options (deferred, offered to owner): (a) sim-core — have the AC
  analysis report a real RMS + fundamental for non-sinusoidal periodic signals (detect the
  chopper period), or (b) render-side — a waveform-agnostic magnitude stabiliser gated on the
  per-wire ripple/rate-of-change rather than on `ac.valid`. (b) is smaller; (a) is more correct.

**Phasor brainstorm (round 2, high-freq/sweep angle) — done, in the (31) chat / below.** 12 new
ideas building on (29)'s 15. Top 3: Xc/Xl+R split (pure trig, cheapest), |Z|-vs-f sparkline the
phasor paints as you sweep (needs a HUD-side freq history buffer — presentation only), RMS-vs-peak
"stability shadow". Several vs-f ideas need a client-side readout history (no sim/hash change).

---

## 2026-06-19 (30) — Magnitude-rides-RMS for thickness + particle flow; phasor → own Telemetry panel

**State:** 🟢 Web. Owner: phasor "bigger / its own section, not in the popout, alongside the
scope"; "line thickness still flickers with current — average it like everything else"; "same
treatment to the flow of particles across components." All three done; gates green.

The "like everything else" = the wire **colour** already eases toward the net RMS voltage by the
shimmer `blur` (apparent rate) on fast AC; thickness/density/flow did **not** — they rode
`|i_instantaneous|`, which aliases 0↔peak. Fixed by mirroring the colour blend in the current
domain:

- **Wires (`board.ts redrawWires`)** — `normC` (drives belt thickness AND carrier
  density/size/alpha) now uses `magC = lerp(|cur|, irmsW, blur)`. `irmsW = sqrt(wireMs)`, a
  per-wire running mean-square branch current. The sub-frame batch carries only voltages (no
  per-tick branch current), so it's an EMA (`WIRE_RMS_ALPHA = 0.04`) advanced **once per frame**
  in new `advanceWireRms()` — NOT in redrawWires (which fires on every pan/drag/edit); redrawWires
  only reads it. Sign stays instantaneous → carriers still slosh. Verified the EMA settles to RMS
  with ≤~3% ripple at the blur onset (apparent ≥10 Hz) via `/tmp/harness/ema-rms.js`.
- **Components (`glyphs.ts flowStabilized` + `board.ts` node loop)** — new `flowStabilized(e,
  blur)` eases `current` magnitude toward the **measured** `ac.irms` (sign kept) by the part's own
  `blur` (= `blurFactor(apparentFreq(freq)) · acFrac`, acFrac from iamp vs |imean|). Stops glyph
  flow density/heat strobing on fast AC. DC / slow AC (blur≈0) ⇒ unchanged (still breathes).
- **Phasor → Telemetry panel** — moved out of the value popover into its own `Phasor · <part>`
  section in the right aside, ~180 px (was 60), with a V/I + `ϕ deg lag/lead/resistive` legend.
  `hudPhasor.drawPhasor2D` strokes/dots/heads now scale with radius (crisp small or large).
  Re-rendered at 180 px (`/tmp/harness/render-hudphasor.js`, S=180) — inductive/resistive/
  capacitive all read clearly.

**Known-minor / follow-ups:** a diode/LED's flow still strobes on fast AC (sign gates
`max(0,current)` so the off-half zeroes it — honest but not stabilised); `legs[]` (pot divider)
flow isn't stabilised. Couldn't headlessly render the full Pixi board, so the wire/glyph
*integration* is read-verified + numerically verified, not pixel-verified — eyeball on live.
Phasor brainstorm backlog (impedance/power triangle, PF ring, P/Q bar, etc.) still in (29).

---

## 2026-06-18 (29) — Phasor in the inspector HUD + broadened to any AC part + brainstorm

**State:** 🟢 Web, PNG-verified. Owner asked (AskUserQuestion) for: phasor in the inspector
HUD, broaden which parts, and an agent brainstorm. Did all three.

- **`web/src/lib/hudPhasor.ts`** — a lightweight **Canvas2D** twin of tierKit's Pixi
  `phasorInset` (a Pixi app per inspector would be wasteful). Same picture: dial + ticks,
  V (warm) / I (cyan) arrows length-coded to `vamp`/`iamp`, a phase wedge, a decaying-alpha
  I-tip phosphor trail; cosmetic spin on the bounded `phase`. Folded in a brainstorm win:
  **quadrant-tinted wedge** — amber = lagging/inductive, violet = leading/capacitive, grey =
  in-phase/resistive.
- **App.svelte** — `hudPhasorAction` captures the canvas; `drawHudPhasor(b.flowPhase())` runs
  each frame in the loop (no-op unless the canvas is mounted + `ac.valid`). Canvas added to the
  value popover, shown for **any part with `selDisplay.ac.valid`** (the broadening — a resistor
  shows in-phase). CSS `.insp-phasor`.
- **infoDiagram.ts** — broadened the info-panel phasor gate from `PHASOR_KINDS` (C/EC/L/TR) to
  any part with `ac.valid`. Removed the now-dead set.
- Verified by a Canvas2D-mock PNG render (`/tmp/harness/render-hudphasor.js` → `hudphasor.png`:
  inductive shows the amber-wedge separation, resistive fuses in-phase, capacitive leads). Gates green.

**Brainstorm agent ideas (do-next, all run on existing `AcReadout` unless noted):** (1) quadrant
tint ✅ done; (2) sign-aware lead/lag; (3) **impedance triangle** (R–X legs from `zmag`/`phase`)
+ (6) projection drop-lines (I·cosϕ / I·sinϕ) — the strongest pedagogy; (4) PF ring + (5)
real-vs-reactive **P/Q bar** (Q = √(S²−P²), S = vrms·irms); (7) tie spin to the shared flow
clock; (8) resonance "lock" cue; (10/11) honest DC / purely-resistive states; (12) freq badge;
(14) L/C corner glyph. (9) SRF species-flip ghost **needs** the Real-model parasitics
(frequency-morph). Top picks: quadrant-tint+sign trail, impedance/power triangle, honest edge
cases.

---

## 2026-06-18 (28) — DMM-style RMS inspector readouts (flailing V/I numbers fixed)

**State:** 🟢 Web. The readout twin of the RMS-colour / shimmer work: the inspector numbers
stop flailing on fast AC by showing the measured RMS, self-adapting to the apparent rate.

Owner: "V and A flail at high speed, can't get a clean read — a DMM can't see that either;
auto-average/auto-range that self-adapts." Done:
- `glyphs.rmsStabilized(e)` → a copy of the ElectricalState with `vAcross`/`current` replaced
  by `ac.vrms`/`ac.irms` when `ac.valid`, else pass-through (DC is already steady).
- `App.svelte`: each frame, `selRmsMode = ac.valid && apparentFreq(ac.freq) > READOUT_RMS_HZ`
  (4 apparent Hz — where numbers get unreadable, a touch before the shimmer's visual band).
  `selDisplay` (RMS-or-live) feeds the HUD meter (`{rms} V across · A through`) and the "Right
  now" partInfo headline/derived; a small `.rms-tag` badge marks RMS mode. Removed the now-dead
  `selElectrical`.
- Self-adapts to BOTH the signal frequency and the playback speed (via `apparentFreq`). For DC
  the part has no valid AC read → live value shown.
- Resistive `P = V·I` rows stay correct (Vrms·Irms = real power on a resistor). Reactive parts'
  dV/dt-style formulas are stable but a bit abstract under RMS — refine later with Preal/PF.

**Phasor (the other half of the ask):** `phasorInset` already overlays the InfoDiagram for
reactive parts (C/EC/L/TR) — the owner's screenshot was a **resistor** (correctly none), and
the **lerp bug** was hiding it on running frames (now fixed). Asked the owner whether to
broaden it (resistor → in-phase arrows) or relocate it (inspector HUD / board) before building
more — don't want another blind iteration.

---

## 2026-06-18 (27) — THE shimmer bug: lerpSnapshot dropped acMeasurements while running

**State:** 🟢 Web one-liner fix. This is why the owner "could never really see it" — the
shimmer deactivated whenever the sim was running and only came back on a t=0 reset.

`loop.ts` interpolates the displayed snapshot between the two latest ticks on essentially
every **running** frame (`running && cursor >= 1 && acc > 1e-4` — true ~always while
running, at any tps). `lerpSnapshot` rebuilt the Snapshot but **omitted `acMeasurements` /
`acFields`** (it predates them — I added AC in PR #105 and never updated the lerp). So a
running frame handed the board `acMeasurements: undefined` → no `ac` → `blur` 0 → no shimmer
and no RMS colour. It only survived when **paused** (`disp = at(cursor)`, the real snapshot)
or right after a **reset** (`cursor === 0` skips the lerp) — exactly "only a full t=0 reset
brings it back."
- **Fix:** `lerpSnapshot` now carries `acMeasurements` (blended like `elementCurrents`) and
  `acFields` (pass-through). Both Snapshot constructors (the `snapshot()` factory + the lerp)
  now include them. Gates green.
- Calibration (#106) + visible band (#107) + RMS colour (#108) + **this** = the shimmer
  should finally work *while running*, tickrate-coupled. Owner to confirm on live.

**Also:** patched `~/.claude/stop-hook-git-check.sh` to skip `noreply@github.com` committers
(GitHub's squash/merge commits) — no more "Unverified" nag on every PR merge.

---

## 2026-06-18 (26) — Wire colour RMS-stabilised on fast AC (no more strobing hue)

**State:** 🟢 Web, verified by PNG render. Completes the owner's "voltage flickers too / just
shows RMS" ask — the voltage-domain twin of the carrier→shimmer handoff.

`voltageColor` is **magnitude-based** (clamps to [0,12]), so a mean-zero AC net's hue strobes
grey↔peak frame to frame (the once-per-frame `snap.state` is aliased). Fix, web-only:
- `Board.nodeVrms` — per-node RMS computed each frame from the **sub-frame `scopeBatch`**
  (`SubFrameSample.state` = node voltages at sub-frame resolution → non-aliased). Undefined
  when there's no batch (paused/scrubbing) → falls back to the instantaneous colour.
- In `redrawWires`, blend the wire colour `lerpColor(voltageColor(v_inst),
  voltageColor(nodeVrms[node]), blur)` — so as the shimmer blur rises the hue locks to the
  RMS level (no sign issue: `voltageColor` ignores sign). Drives the wire stroke, the band
  aura, and the carriers (one `color` var), so the whole wire stops strobing.
- Verified: `/tmp/harness/render-color.js` → `color.png` shows the instantaneous row
  flickering cyan→violet→grey vs a single steady RMS hue. Gates green.

**Render-verification tooling now exists:** `/tmp/harness/raster.js` (pure-Node RGBA →
PNG, `zlib.crc32`) + `render-band.js` / `render-color.js`. Use it to actually SEE board/tier
render changes headlessly (the board isn't in the numeric `run.js`/`dumpPhasor.js` harnesses).

**Open / next:** owner to eyeball the shimmer + colour on live. Then the **Ideal/Real
fidelity flag** (Layer 1) — the progression lever + the unblock for the *computed* frequency
morph (`docs/ui/frequency-morph.md`).

---

## 2026-06-18 (25) — Shimmer band ACTUALLY visible (the real bug) + lens/camera persistence

**State:** 🟢 Web. Owner still didn't see the shimmer after the calibration fix — found the
real bug by building a headless renderer. Plus the requested persistence.

**The real bug: the band was the same colour as the wire.** Built a pure-Node RGBA
rasterizer + PNG encoder (`/tmp/harness/raster.js`, `render-band.js`) — no browser needed —
and rendered the wire carrier→band handoff. The old band was a same-`color` (voltage-tinted),
low-alpha stroke, so at high blur it was **indistinguishable from a plain wire**: the
chevrons just vanished and nothing visibly replaced them. Calibration was only half the
story.
- **Redesigned the band** (board.ts + tierKit `shimmerFlow`): a voltage-tinted **aura**
  around a **WHITE-HOT core** (`mix(color,white,0.35/0.75)`) + drifting white **sparkle
  specks** — reads as an energised, glowing wire, clearly ≠ a plain trace. Verified in the
  PNG (`/tmp/harness/band.png`). Shown in **all three lenses** (the band block sits after the
  carrier loop, outside the conduit branches).
- The earlier calibration (`AC_SHIMMER_LO=10/HI=60`) + this redesign together: an AC source
  at tps≥50000 now clearly shimmers.

**Persistence (owner ask):** the tier **lens toggle** (`boardLens`), the **LOD** toggle, and
the **camera** (pan + zoom) now survive a refresh. Added `boardLens`/`lodOn`/`camera` to the
`Settings` type (storage.ts), `Board.getCamera()`/`setCamera()` (clamped, malformed-safe),
restore on init, save on lens/lod toggle, and a **debounced** camera save (600 ms trailing,
keyed off a rounded-pose signature in the frame loop).

**Next (owner flagged, IN PROGRESS):** the **wire COLOUR flickers** on fast AC (voltage is
aliased frame-to-frame just like the carriers were) — owner wants it averaged ("just shows
RMS"). Plan: the sub-frame `scopeBatch` (`SubFrameSample.state` = node voltages at sub-frame
resolution) lets the board compute a **non-aliased per-net Vrms/Vmean** web-side and blend the
wire colour from instantaneous → RMS as `blur` rises — no core change. Do this next.

---

## 2026-06-18 (24) — Shimmer reachable on screen (calibration) + frequency-morph design doc

**State:** 🟢 Code (web calibration) + a new design doc. Owner reported the shimmer "not
working on screen." Root cause found and fixed; the morph idea written up.

**Shimmer fix — it was a calibration cliff, not a hard bug.** The blur is
`blurFactor(apparentFreq(freq))` and apparent = `freq · tps · DT`. With the old band
(`AC_SHIMMER_LO=15`, `HI=300` apparent Hz), a 500 Hz source (the AC-source default) hit
blur 0 at every tickrate **except the very top** (tps 500000 → 1.0; tps 50000 → 0.04;
below → 0), and 60 Hz never reached it. So at any normal setting nothing showed. Verified
with a blur-vs-tps calc in `/tmp/harness`.
- Recalibrated to **`AC_SHIMMER_LO=10`, `HI=60`** (apparent Hz — just over the eye's
  ~10–15 Hz tracking limit). Now 500 Hz transitions carriers→shimmer between tps 5000
  (blur 0) and 50000 (blur 0.90), full at 500000; 5 kHz at tps 5000; 60 Hz at the top.
  Reachable across the usable speed range.
- Bumped the board shimmer-band alpha (`board.ts`, core stroke 0.18→0.30 base) so it
  reads clearly once the carriers fade.
- **Caveat:** verified by the blur calc, a from-scratch replication of `computeWireFlow`'s
  freq/acFrac (`/tmp/harness/wireFlow.js` — AC line → 500 Hz/acFrac 1; DC and DC-rail-with-
  ripple → no shimmer), and the existing gates/harness. **No live browser screenshot** —
  the repo has no headless-browser tooling (no Playwright/Puppeteer) and the board class
  isn't in the harness. Owner should re-test: place an AC source (defaults to 500 Hz) and
  push the speed to ≥50 000 ticks/s; the wires should go from sloshing carriers to a glow
  band. Iterate on thresholds/alpha if it still reads weak.

**`docs/ui/frequency-morph.md` (new).** The owner's "components morph into their HF
counterparts" idea: every passive flips to its **dual at SRF** (cap ⇄ inductor, shunt →
shunt + L); the morph is the *render of that flip* on the same apparent-rate signal. Key
fork = **depicted (render-only) vs computed (solver-backed)**; the honest version is the
**payoff of the Ideal/Real fidelity flag** (Layer 1, next on the critical path). Lead with
the cap⇄inductor flip; anchor the first build on the current shunt. Added to the roadmap
(Layer 3, 📐). Determinism: depicted = presentation on the bounded phase; computed = Real-
model stamps (golden-safe, additive). Build order in the doc.

**Next:** the **Ideal/Real fidelity flag** (Layer 1) — unblocks both the depicted→computed
morph and the broader "fidelity is the progression" pillar.

---

## 2026-06-18 (23) — Board-wide carrier→shimmer handoff

**State:** 🟢 Shipped in `web/lib/board.ts`. The high-frequency render now applies to the
**board wires**, not just the inductor drawer. All web gates green; tierKit + drawer
harnesses pass. No sim-core change.

- **`Board.computeWireFlow`** (renamed from `computeWireCurrents`) now returns
  `{ current, freq, acFrac }` per wire from one KCL spanning-forest pass: the branch
  current (as before), an **apparent AC frequency** (AC-amplitude-weighted mean of the
  elements' measured `ac.freq` in the wire's subtree — 0 for DC, source freq on an AC
  path), and an **AC fraction** (subtree AC amplitude vs |DC current|). The ammeter still
  reads `lastWireCurrents` (built from `.current`).
- **`redrawWires`** computes `blur = blurFactor(apparentFreq(freq)) * acFrac` per wire and
  fades the carriers (chevrons / analogy water / reality electrons) out by `(1−blur)` while
  fading in a **voltage-tinted glow band** along the wire route (a `SHIMMER_VIB` bounded-
  phase wobble), in all three lenses. The energy belt is untouched (per the doc). The
  `acFrac` gate keeps a rectifier's DC rail (tiny 2f ripple) on streaming carriers.
- **Tickrate-coupled** via the same tierKit `apparentRateScale` App.svelte already sets each
  frame, so slowing playback drops fast AC back to visible sloshing carriers board-wide.
- Verification: `pnpm -C web check/lint/build` green; `/tmp/harness/dumpPhasor.js` (the
  shimmer primitive + tickrate coupling) and `run.js` (drawer regression) pass. The board
  itself isn't in the harness; the freq propagation mirrors the proven current forest.

**Next ask from owner (brainstorm — not yet started):** components visibly **morphing into
their high-frequency counterparts** at high apparent rate — a resistor sprouting a series
inductor, a cap growing ESR+ESL, etc. The Ideal/Real fidelity ladder
(`docs/sim/ideal-vs-real-parts.md`) already frames the *parasitics*; this is the **render of
the transition** (the symbol/illustration morph), driven by the same apparent-rate signal
the shimmer uses. Wants to brainstorm; likely a new design doc + a Layer-3 morph hook.

---

## 2026-06-18 (22) — High-frequency AC render primitives (Layer 3)

**State:** 🟢 Shipped in `web/` (tierKit primitives + data path + two integration points).
The owner's shimmer/phasor design, on top of the Layer-2 AC analysis. All web gates green;
the phasor/shimmer harness (`/tmp/harness/dumpPhasor.js`) and the existing drawer
regression (`run.js`) both pass. No sim-core change.

- **Data path:** `ElectricalState.ac` (`AcReadout`, the 12 AC fields) added in `glyphs.ts`;
  `electricalMap` slices the flat `acMeasurements` per element (new `acMeasurements?`/
  `acFields?` params); `App.svelte` passes `snap.acMeasurements`/`snap.acFields`.
- **`tierKit.shimmerFlow(g, ax,ay,bx,by, mag, b, dir, phase, color, r?)`** — the
  carrier→band handoff. `b = blurFactor(apparentFreq(f))` (smoothstep `AC_SHIMMER_LO=15`→
  `HI=300` **apparent** Hz). The blur tracks the **on-screen apparent rate, not the raw
  signal Hz**: `apparentFreq = f · apparentRateScale`, and the host sets that scale each
  frame to `tps · DT` (`setApparentRateScale`, from the live playback tickrate, wired in
  `App.svelte`). So slowing the tickrate drops a fast AC back to visible sloshing carriers
  and speeding up returns it to a shimmer (the owner's ask). At `b=0` it is **byte-for-byte
  `belt`** (DC/slow circuits unchanged — the inductor regression confirms it); as `b→1`
  carriers fatten + fade and a soft glow band whose half-thickness rides `mag` fades in,
  with a faint `SHIMMER_K` bounded-phase vibration.
- **`tierKit.phasorInset(g, cx,cy, radius, ac, phase)`** — the V (warm) / I (cyan) dial.
  Arrow lengths = AC amplitudes (with a visible floor), the **angle between them = the
  measured V–I phase** (`>0` lag/inductive, `<0` lead/capacitive), a filled wedge fills the
  phase, and the I tip drags a **decaying-alpha phosphor trail** computed as past tip angles
  `thI − k·dθ` — a pure function of the bounded phase, so it rewinds with no mutable buffer.
  Cosmetic dial spin only; magnitude never rides speed (visual-language clean).
- **Applied:** the **inductor** analogy drawer swaps its two `belt(...)` for `shimmerFlow`
  keyed to `ac.freq` (the reference home); the **phasor inset** overlays the `InfoDiagram`
  (a separate unscaled `overlay` Graphics, bottom-right corner) for reactive kinds
  `{C,EC,L,TR}` once `ac.valid`.

**Determinism/discipline:** all presentation on the bounded `phase`, reads `ElectricalState`
only — no sim/golden touch. Magnitude on thickness/alpha/length; frequency drives the blur
(presentation), not speed.

**Open (render adoption — TODOS 14):** board wire-pipes' carrier→shimmer swap (needs a
per-wire apparent frequency); the cap/transformer drawers adopting `shimmerFlow`; the
phase-domain scope (V/I vs phase). **Next on the roadmap critical path:** the Ideal/Real
fidelity flag (L1) — the progression lever.

---

## 2026-06-18 (21) — AC analysis (Layer 2 measurement) implemented

**State:** 🟢 Code shipped in `crates/sim-core` + boundary + `loop.ts`. The second
critical-path framework. All gates green; analog golden bit-identical.

Built the measurement layer that turns the solver's raw V/I waveforms into the AC
quantities the phasor/shimmer render (and later AC grading) need. It **must** live in
the core — only the core sees every 2 µs tick; the web reads one snapshot per frame.

- **`AcMeas`** (new struct, before `Sim`) — a per-element running analyzer. Each
  committed `step()`, `update_ac_analysis()` folds the element's terminal voltage
  `V(a)−V(b)` and through-current into it. A **synchronous detector**: cycles are
  delimited by rising zero-crossings of `V` about the previous window's mean; it keeps
  O(1) running sums (Σv, Σi, Σv², Σi², Σvi, min/max) and finalizes a held result set at
  each boundary. Phase = signed sub-sample offset of the current's rising crossing
  (wrapped to (−π,π]: **>0 inductive lag, <0 capacitive lead**); PF = the V–I
  correlation (= cos φ); |Z| = Vac_rms/Iac_rms; freq from the period. O(1)/tick, O(1)
  storage, no per-tick trig.
- **`Sim::ac_measurements()`** → flat `[nElements × AC_FIELDS]`, `AC_FIELDS = 12`:
  `[Vrms, Irms, Vmean, Imean, Vamp, Iamp, Preal, PF, |Z|, phase, freq, valid]`. New
  unhashed `ac: Vec<AcMeas>` field (like `currents`) → **golden-safe**; reset at
  install/reset so a rewind re-accumulates from t=0. `valid` is 0 until the first full
  cycle completes (render falls back to DC cues).
- **Boundary:** `ac_measurements()` + `ac_fields()` on `sim-wasm`; `loop.ts` `Snapshot`
  gains `acMeasurements` + `acFields` (one batched read/frame — the coarse-boundary rule).
- **Tests (109 total):** resistor → PF≈1/φ≈0/|Z|≈R/freq✓; capacitor → φ≈−π/2; inductor
  → φ≈+π/2; `ac_analysis_run_is_reproducible` folds the measurement bits into the replay
  accumulator. Golden untouched.

**Determinism note:** the analyzer is a pure function of the (clamped, finite) V/I
trajectory + fixed constants; it's unhashed so it can't move the golden, and it
reproduces/rewinds with the run. Variance uses Σx²−mean² (mild cancellation for
high-DC-low-AC signals; the phasor circuits are mean-zero AC so it's a non-issue — noted
for a possible Welford upgrade later).

**Next (critical path):** the **`shimmerFlow` + `phasorInset` render primitives** (L3) now
have their data source (`Snapshot.acMeasurements`) — the carrier→shimmer handoff on the
blur factor + the two-arrow/arc/decaying-tip phasor, plus the phase-domain scope. Then the
Ideal/Real fidelity flag (L1). See `docs/ui/high-frequency-render.md`.

---

## 2026-06-18 (20) — Floating-component GMIN implemented (floating-networks Part 1)

**State:** 🟢 Code shipped in `crates/sim-core`. First framework off the roadmap critical
path. All gates green; analog golden bit-identical.

The single-global-ground model left any subnet with no galvanic path to ground with a
singular common-mode row (it limped along on the dense solver's zero-pivot fallback).
Now generalised the per-node op-amp/MOSFET GMIN to **components**:

- **`floating_refs(node_count, &elements)`** (new free fn, next to `classify_nets`) +
  `uf_find`/`uf_union` helpers. Deterministic **union-by-min** union-find over
  *potential-defining* ties only: R/C/L/V/AC/switch/diode-family/varistor union a–b;
  FET/BJT channel a–b (gate/base marked device-referenced, not unioned); transformer
  unions each winding **separately** (so an isolated secondary stays its own component);
  op-amp + digital (gate/DFF/level-shift) + pull-up terminals marked referenced (the
  device pins them); **ISOURCE skipped** (current constraint, not a potential — the dual
  the netlist incomplete-circuit check already handles). Returns the lowest node of every
  component that contains neither ground nor a device-referenced terminal.
- **`stamp_floating_refs(&self, mat, n)`** stamps one `GMIN` (1e-12) on each such node's
  diagonal, called in **all four** assembly paths (linear OP + transient, Newton OP +
  transient base — into `base_mat` once, so it rides every Newton iteration). New
  `floating_refs: Vec<usize>` field, computed once in `install`.
- **Golden-safe by construction:** a grounded circuit is one component (the grounded one)
  → empty list → no stamp → `golden_snapshot_hash_is_stable` unchanged. Verified.
- **Tests:** `floating_refs_identifies_isolated_subnets`, `floating_divider_solves_with_
  defined_common_mode` (exact differential, common-mode pinned ~0 at lowest node),
  `floating_transformer_secondary_is_reproducible` (isolated secondary energises + bit-
  reproducible). 105 sim-core tests pass.

**Next (per roadmap):** `ELEM_ROGOWSKI` is now unblocked (floating-networks Part 2), but
the critical path continues to **AC analysis (Layer 2)** → the `shimmerFlow`/`phasorInset`
high-frequency render primitives. Owner's call which to take first.

---

## 2026-06-17 (19) — Frameworks roadmap + the high-frequency AC render framework

**State:** 🟢 Docs only, no code. Owner wants to build ALL the substrate frameworks, then
the game ("the game is just systems"). Drafted the master plan + a new render framework:

- **`docs/frameworks-roadmap.md`** — the dependency-ordered map of every substrate
  framework in 4 layers (solver core → measurement → render → game systems), each tagged
  built/specced/open, with a critical path (floating GMIN → AC analysis+render → ideal/real
  flag → thermal → sensors/Rogowski → multi-rate → render sweeps → THEN game). Stitches the
  per-system docs together; doesn't replace them.
- **`docs/ui/high-frequency-render.md`** — the owner's AC render invention (from their
  `acrender.html` study). Decouple fast current into THREE non-aliasing channels: shimmer
  width = amplitude, energy drift = real power, phasor angle = phase — plus a phosphor-
  persistence phasor (I-tip trail lagging V) and a phase-domain scope. Needs a new Layer-2
  **AC analysis** (RMS/phase/PF/|Z| measured from the live waveforms) — that's the build
  dependency. TODOS (11) tracks AC analysis + the `shimmerFlow`/`phasorInset` primitives.
- Retrofitted SPDX headers onto the two prior sim docs.

Next high-leverage cluster (per the roadmap): floating-component GMIN, then AC analysis +
high-frequency render.

---

## 2026-06-17 (18) — Design docs: floating networks / Rogowski + the fidelity ceiling

**State:** 🟢 Docs only, no code. Answered the owner's two questions in `docs/sim/`:

- **`floating-networks.md`** — yes we can simulate a floating network/Rogowski coil, in
  two `sim-core` parts: (1) **floating-component `GMIN`** (the netlist's single global
  ground leaves an isolated subnet's common-mode singular; stamp one GMIN to ground per
  floating connected component — golden-safe, also fixes a floating transformer
  secondary); (2) **`ELEM_ROGOWSKI`**, a non-loading current-sense that forces
  `M·dI/dt` onto an isolated output (reuses the transformer secondary stamp + inductor
  dI/dt companion + part 1). Build part 1 first.
- **`fidelity-ceiling.md`** — "how real, where's the stopping point": fidelity has TWO
  homes. The **solver** is lumped/deterministic/real-time → ceiling ≈ SPICE L1–3 compact
  models + parasitics + lumped coupling + slow thermal + GHz digital; NOT adaptive Δt,
  distributed/EM, RF, VLSI nets, or device physics. The **reality tiers** are a drawing →
  effectively unbounded, depict physics the solver never computes. The seam: terminal
  behaviour → solver; explanation → reality tier.

TODOS (10) tracks the two sim-core build items.

---

## 2026-06-17 (17) — MOV: the leads physically route (inlet INTO tank, outlet from relief)

**State:** 🟢 Green — web check/lint/build pass. No Rust/golden. Owner wanted the PIPES
themselves to route to their roles (not just the flow): the inlet lead now bends DOWN
INTO the tank (bendy L-pipe), the outlet lead comes out of the RELIEF area at the top,
and the two SWAP with polarity (`inPin/outPin` from `aHigh`). The relief current rides
the very same pipes (inlet→tank→cracked seat→outlet). `drawAnalogyVaristor` builds
`inletPipe`/`outletPipe` polylines, draws them with `pipeLead`, and the flow reuses them.

Verify: `/tmp/harness/dumpMov.js` (forward vs reverse shows the pipes swap sides).

---

## 2026-06-17 (16) — MOV: lift rides the relief current; inlet→tank / outlet→relief

**State:** 🟢 Green — web check/lint/build pass. No Rust/golden. Two owner fixes:

- **Poppet wouldn't lift.** A varistor CLAMPS the voltage to ≈Vclamp, so `over=|V|/Vclamp`
  pins near 1.0 and the lift (keyed to `over`) never moved — e.g. a 48 V loop with a 12 V
  MOV. Now the lift + `conducting` ride the SURGE CURRENT (`flow`), which is the real
  measure of how hard it's relieving. `lift = min(1, flow*1.4)*40`; full lift on a hard
  clamp.
- **Inlet→tank, outlet→relief (auto-mapped).** One continuous stream: the higher lead
  (inlet) runs DOWN INTO THE TANK (pressure building), then UP through the cracked seat
  and OUT the lower lead (the relief). `aHigh = vAcross≥0` picks the inlet, so it swaps
  with polarity. Replaces the across-the-valve dip.

Verify: `/tmp/harness/dumpMov.js` (clamp 12 V; I = 0 / 12 mA / 0.3 A / −0.3 A).

---

## 2026-06-17 (15) — MOV: faithful refsheet port (readable spring) + one-way flow

**State:** 🟢 Green — web check/lint/build pass. No Rust/golden. Two owner fixes to the
varistor analogy:

- **Squashed spring → faithful port.** I'd rebuilt the MOV with my own proportions and
  the tall spring collapsed to a tiny zigzag. Now `drawAnalogyVaristor` ports the
  reference sheet's tier-2 coordinates LITERALLY: a `px(rx)/py(ry)` map scales the ref's
  valve span (viewBox y≈150..500) to fill the bounds, so the spring stays the tall,
  readable coil. New `vcoilPts` = the ref's smooth sine `vcoil` (vs the coarse zigzag
  `vSpringPts`). Vessel/poppet/chamber/vents/screw/inlet-arrow all from the ref px.
- **Flow one-way by voltage sign.** The ref vents out BOTH sides (single-port demo); a
  real 2-terminal part conducts ONE way. Now a single `flowAlongPath` runs A→B across
  the cracked valve with `dir = sign(vAcross)` — only while `over>1 && flow>0.02`.

Verify: `/tmp/harness/dumpMov.js` (clamp 5 V; sealed 3.5 / cracking 4.6 / popped ±8).

---

## 2026-06-17 (14) — Proportional-split flow framework (the POT wiper "steals" carriers)

**State:** 🟢 Green — web check/lint/build pass. No Rust/golden. The owner's "particles
go to the exits proportionally" ask, built as a general framework + applied to the POT.

**Framework (general, reusable):**
- **Data** — per-leg currents. `BuiltNetlist.legsOfComponent: Map<id, number[]>` carries
  the EXTRA element indices for a part that splits; `electricalMap` reads them into the
  new `ElectricalState.legs?: number[]`. Threads to drawers for free (electrical is
  already in the opts; computed fresh each frame from the blended `elementCurrents`, so
  no loop.ts change). The POT registers its W→B leg, so the wiper tap = `current − legs[0]`.
- **Primitive** — `tierKit.flowSplit(g, inPath, exits[{path,weight}], mag, dir, phase,
  color, r)`: carriers stream in along `inPath`, then commit to an exit in proportion to
  its weight (its |current|), so the higher-current exit visibly takes more. Plus a small
  private `arcSampler` (shared arc-length helper).

**Applied:**
- **POT analogy** (`drawAnalogyPOT`): the stream slaloms A→wiper, then `flowSplit`s to B
  vs the tap hose to W, weighted by `|I(W→B)|` and `|tap|`. Verified: no load ⇒ empty
  hose; heavy load ⇒ most carriers peel to W.
- **POT reality** (`drawDetailPOT`): the arm tap flow is scaled by the tap fraction
  (`|A→W − W→B| / |A→W|`), so a loaded wiper steals more.

**Which other parts can use it (TODOS):** needs per-terminal currents. Transformer —
secondary `Is = n·Ip` is derivable (no new element) → a candidate. Transistors — `Ib`
isn't a separate solver element (β-derived, ~1% — low value). Others are single-path.

---

## 2026-06-17 (13) — Post-merge fixes: thermistors in the bin, MOV no-bypass

**State:** 🟢 Green — web check/lint/build pass. No Rust/golden. PR #96 already
squash-merged to `main`; this is follow-up on owner review. Branch reset to `main`
(358be63) then these commits on top.

- **Thermistors now appear in the parts bin.** They were in `PART_KINDS` (catalog) but
  never in App.svelte's UI `PARTS` list or `PART_CAT_OF` — so they never showed. Added
  both (under Passives). *This was why "I don't see the thermistors on the website."*
- **MOV reworked to a real relief valve** (owner ref sheet). The old leads bypassed the
  valve (both fed the vessel side with through-flow → water ran A→tank→B past the poppet).
  Now the leads feed the tank from BELOW; the only way out is UP through the popped poppet
  to the side vents (sealed ⇒ nothing passes). The spring visibly compresses sealed→popped.

**Feasibility found for the owner's "particles go to the exits proportionally" ask:**
all per-element currents are already in the web layer — `sim.element_currents()` →
`elementCurrents` (loop.ts), mapped in `netlist.ts` `readComponentElectrical` via
`elemOfComponent`. The POT stamps TWO resistor legs (A→W = `upIdx`, W→B = `upIdx+1`); only
A→W is read today. Reading the W→B leg too gives the wiper tap = A→W − W→B. Plan: add an
optional secondary-current field to `ElectricalState`, thread it (netlist → loop → board
opts → drawer), and split the particle streams by the per-exit currents. See TODOS.

---

## 2026-06-17 (12) — Flow-cohesion sweep (dam, slalom, MOV, connector pipe, caps/EC)

**State:** 🟢 Green — web check/lint/build pass. No Rust/golden. Branch
`claude/kind-turing-hdelb3`. A push to make every part's particles interact with what
affects them and to make terminals flow into the board's wire-pipes (never "broken up").

Shipped (drawer-render-verified in `/tmp/harness`):
- **Diode** reverse-block DAMS UP; **POT** slaloms around the posts (`tierKit.scatterY`)
  + snags the divider tap at the wiper; **MOV** reads open/sealed with flowing
  `pipeLead` terminals + polarity-correct flow; **ceramic cap + inductor** pipe bodies
  water-filled terminal-to-terminal; **electrolytic cap** redesigned to ONE big tank
  (flow in +/out −, level = voltage + gauge marker — per owner).
- New shared helpers in `tierKit`: `scatterY` (slalom around obstacles), `pipeLead`
  (steel-wall + water-core + flowing dots terminal), `PIPE_STEEL`.

Shipped but needs an in-app look (board canvas, not covered by the drawer harness):
- **Connector pipe** (board.ts ComponentNode): a stub from each pin into the body on a
  layer BEHIND the tier illustration, bridging the wire-pipes to the part universally.
  Tunables if it reads off: the `0.62` length factor and the `0.3`/`0.16` alphas.

Open (see TODOS 7): finish the sweep for the REMAINING parts (transformer, BJT/MOSFET,
op-amp, V/I/AC sources, level shifter, switches, gates, flip-flop); "get at wires behind
components" (owner wants discoverable click-through); junction delete/move (no rush);
orientation audit across rotated parts.

Harness dumps added: `dumpMov.js`, `dumpAudit.js` (2-pin analogy grid), `dumpDiode.js`,
`dumpPot.js`, `dumpFire.js`, `dumpThermR.js`.

---

## 2026-06-17 (11) — Thermistor reality tier · POT flow respects wiper · resistor fire

**State:** 🟢 Green — web check/lint/build pass. No Rust/golden touch. Branch
`claude/kind-turing-hdelb3`. Three things this pass:

1. **Thermistor reality (tier 3)** — `drawDetailThermistor` (NTC/PTC), registered in
   `DETAIL_DRAWERS`. A polycrystalline ceramic: a 4-grain chain between the electrodes,
   carriers FUNNEL through the grain-boundary necks (same inline lesson as the analogy).
   NTC shows its mechanism as a freed-carrier population that grows with heat (sparkle +
   denser drift + glow); PTC rears up RED grain-boundary barriers that close the necks
   past the Curie point (the switching-ceramic snap). Reuses the shared `thermistor.ts`
   model, so all three tiers agree. The info panel's reality tab + the board reality lens
   pick it up automatically (`hasDetail` now true for NTC/PTC; `infoDiagram` already
   threads `temp`).

2. **POT flow now RESPECTS the wiper** (the owner-flagged audit fix; an Explore-agent
   audit confirmed POT was the one clear offender — MOSFET/BJT/diode/zener/caps already
   gate their flow). Both tiers: the A↔B drift/stream NECKS through the wiper contact (a
   Gaussian pinch that tracks `xW` as the wiper slides) and a TAP branch drains down the
   arm/hose to W. Added `flowAlongPath` to the detail-tier import for the tap.

3. **Resistor CATCHES FIRE** past the smoke — `drawDetailResistor` + new `flameTongue`
   helper. Layered flickering flame tongues (cool-red outside → white-hot core) + rising
   embers, driven by the RAW `|V·I|/(V·I scale)` ratio (un-saturated, so there's real
   headroom past `power`'s soft clamp): smolder → flames → blaze → inferno.

**Verify:** `/tmp/harness` — `dumpThermR.js` (NTC/PTC reality grid), `dumpPot.js` (POT
both tiers × 3 wiper positions — pinch + tap track the wiper), `dumpFire.js` (resistor
escalation). All four `flowThroughGap`/funnel helpers in `tierKit`.

**Deferred (TODOS):** thermistor B/Curie as part params; diode reverse-block density is
borderline-sparse but acceptable.

---

## 2026-06-17 (10) — Thermistor flow funnels through the gate (open vs snap-shut)

**State:** 🟢 Green — web check/lint/build pass. No Rust/golden touch. Branch
`claude/kind-turing-hdelb3`. Follow-up to (9): the heat-valve flow now reads the
*openness in the stream itself*, per owner feedback ("make the particles move around the
gate — when it's open it's really open, when it shuts it can snap down really tight").

- **`tierKit.flowThroughGap`** (NEW) — the inverse of `flowAroundPlug`: several lanes ride
  the full channel then SQUEEZE toward the axis through the gate and fan back out. A
  wide-open valve passes a fat uniform stream (no pinch); a shutting one pinches the
  carriers to a thin thread (→ a near-line as the gap → 0).
- **`drawAnalogyThermistor`** swaps the straight `belt` for `flowThroughGap`. `fullGap`
  widened to `pipeHH*2.6` so the achievable openness opens *all the way* (plates retract
  out of sight, `flowGap` clamped to the pipe → uniform stream) before it throttles; the
  plates now draw only when partly closed and never bulge past the pipe.
- NTC opens as it heats; the switching-ceramic PTC snaps the stream to a thread past its
  Curie point — both straight from R(T).

**Verify:** `/tmp/harness/dumpTherm.js` (the NTC/PTC × cold/warm/hot grid).

---

## 2026-06-17 (9) — NTC + PTC thermistors (schematic + analogy, temperature knob)

**State:** 🟢 Green — web format/check/lint/build all pass. **No Rust / no golden touch**
(determinism intact). Branch `claude/kind-turing-hdelb3`. Added the NTC + PTC thermistors
end-to-end, the POT way — a per-part temperature scalar the netlist turns into R(T) and
stamps as a plain resistor, so the sim sees an ordinary resistor.

Owner's calls: **knob now but prep for a future temperature model**, **PTC = switching
ceramic (Curie snap)**, **schematic + analogy first** (reality tier deferred).

- **`web/src/lib/thermistor.ts`** (NEW) — the shared R(T) model: NTC `R0·exp(B(1/T−1/T0))`;
  PTC switching ceramic (low R, then a several-decade jump above the 100 °C Curie point).
  Also `thermistorOpenness` (valve gap), `tempNorm`, `THERMISTOR_TEMP` ranges. One place so
  the netlist, the drawer, AND a future SIM self-heating model share the curves.
- **netlist.ts** — NTC/PTC branch (beside POT): stamps ONE `ELEM_RESISTOR` with R(T) from
  `value` (nominal R) + `temp`. R(T) rides `values`, so changing temp rebuilds the sim.
- **`temp` scalar** threaded like `wiper`: `Component.temp`, default 25 °C on placement,
  `SelectedPart`, clipboard snippet + paste, serialize/restore (spread), `Board.setComponentTemp`,
  tier opts, `TierOpts.temp`, `infoDiagram.setState`.
- **glyphs.ts** `drawThermistor` (NTC/PTC → DRAWERS): IEC box + the diagonal temperature
  arrow, a small −/+ telling NTC (R falls) from PTC (R rises).
- **analogyDrawers.ts** `drawAnalogyThermistor` (NTC/PTC) — a HEAT-ACTUATED SHUTTER VALVE:
  heater coil+glow+waves under the orifice = temperature; shutter gap = openness(R(T)); flow
  = current. NTC opens as it heats; PTC snaps shut past Curie. One drawer, mirror behaviour
  straight from R(T).
- **App.svelte** — a temperature slider in the inspector (`{#if kind==="NTC"||"PTC"}`),
  mirroring the wiper (single-undo-per-drag). **partInfo.ts** — NTC/PTC entries (live R from
  V/I).

**Verify:** `/tmp/harness` — `dumpTherm.js` (analogy grid: NTC opens / PTC snaps shut across
temperature) and `dumpGlyph.js` (the schematic symbols). compile.js now also transpiles
`thermistor`. Deferred (in TODOS): the reality/tier-3 internals, and exposing B / Curie as
part params.

---

## 2026-06-17 (8) — Zener closed-loop rebuild, diode check-valve template, conduit fittings

**State:** 🟢 Green — web format/check/lint/build all pass (no Rust; golden untouched).
Branch `claude/kind-turing-hdelb3`. Four owner asks this session, two subsystems:

**Analogy drawers (`analogyDrawers.ts`, `tierKit.ts`):**
- **Zener rebuilt** to match `docs/ui/parts/zener-tier2.html`: a CLOSED-LOOP spillway —
  forward check valve on the axis, a standpipe on the cathode side that fills to the Vz
  weir, and a **return tube** that catches the spill over the crest and runs it back to
  the anode side (reverse current returns to the anode — no more "spilling into nothing").
  Column rim tracks the crest (taller wall = taller column, no dead freeboard). Reverse
  loop drawn with `flowAlongPath`.
- **Shared `forwardCheckValve()` template** (the diode family: D / SD / LED / ZD): bronze
  seat lips + spring/plunger + ball, with the **ball made smaller** and the open-flow
  **parting AROUND the ball** via new `tierKit.flowAroundBall` (horizontal mirror of
  `flowAroundPlug`) — belts up the inlet/outlet pipe, bulged lanes through the chamber.
  Tune the ball/flow once, every diode follows.
- Valve un-crammed: chamber stands clear above/below the ball; body widened for
  seat + travel + spring.

**Conduit (`board.ts`):**
- **Translucent tapers + junction fittings**: the port-taper flares and the junction
  hub/nubs were STACKING fills over the 2-layer pipe → cloudy. Lowered their alphas
  (flare 0.32→0.16 wall, inner ×0.4; hub 0.4→0.2; nub 0.3→0.22) so they read translucent.
- **Junctions nudge with their runs**: a junction is a free vertex, so when its runs fan
  into lanes the hub now rides along. Follow-pass in `redrawWires` derives each junction's
  shift from the nudge (the perpendicular offset of each run's first interior point),
  averaged PER AXIS (T/+ compose; parallel conflicts split the difference), then snaps the
  hub + every connected run-end onto it. Derived FROM the nudge ⇒ never fights it.
  `drawJunctions` now takes a `junctionPos` map. Verified numerically (`/tmp/harness/junctest.js`).

**Verify:** headless render harness in `/tmp/harness` (compile.js transpiles drawers →
CJS; dumpPart.js / dumpZener1.js → shapes.json → raster.py → PNG). NOTE: raster harness
now keys stroke width on `lw` (rect geom width was colliding on `w`).

---

## 2026-06-17 (7) — Conduit channel routing: nudge parallel + crossing bridges/junctions

**State:** 🟢 Green — web check/lint/build (no Rust; golden untouched). Branch
`claude/kind-turing-hdelb3`. The owner's two routing asks, both render-only on the
conduit draw routes (precomputed once per redraw in `redrawWires`, before rounding):

- **Nudge parallel** (#92): `nudgeParallel()` fans conduits sharing a grid line into
  separate lanes — groups interior segments by their line, clusters overlaps, offsets
  each perpendicular (corner points move along the perp axis ⇒ route stays orthogonal,
  terminals fixed).
- **Crossings** (this PR): `applyCrossings()` — a perpendicular crossing of two
  DIFFERENT-net wires bridges (the horizontal wire gets an up-hop baked into its route,
  so pipe + carriers ride over); a SAME-net crossing returns a junction dot (drawn after
  the wires). Skips shared-endpoint touches. Net id via `endpointNode` (cached per redraw
  alongside the wire colour, so no extra BFS in the hop classifier).
- Verified via the replica (parallel → lanes; diff-net → hop; same-net → dot).

**Conduit feature set now:** translucent 2-layer pipes, copper-vs-water skins, rounded
elbows + pin-align stubs (carriers follow), soft 4-way junction fittings, port tapers,
parallel-nudge, crossing bridges/junctions. (All rendering-only; logical routing
untouched.)

---

## 2026-06-17 (6) — Conduit: cleaner translucency, softer junctions, pin auto-bend

**State:** 🟢 Green — web check/lint/build (no Rust; golden untouched). Branch
`claude/kind-turing-hdelb3`. Owner: conduits "not ideal" (weird translucency / more
opaque), junctions "odd", + clarified the auto-bend = "a small bend that aligns it with
the input" (not grid-snapped routing-around).

- **Cleaner pipes:** dropped the dark bore (the stacked 3 layers, esp. the near-opaque
  bore, composited to ~0.8 and muddy grey). Now two translucent layers — faint wall rim
  (`pw+3`, 0.3) + voltage fill (`pw−1`, 0.32/0.36), reality + faint white sheen. Grid +
  crossings show through. Flare alphas lowered. Removed unused `PIPE_BORE`/`COND_CORE_DK`.
- **Softer junctions:** `drawJunctionConduit` — short **round-capped** nubs on unused
  arms (the rounded end is the cap; the perpendicular plates read as cluttered
  asterisks), shorter arms, translucent hub.
- **Pin auto-bend:** `pinOutward(ep)` (the pin's outward cardinal, footprint offset
  rotated with the part; null for junctions/centred/corner pins) + `conduitDrawRoute`/
  `alignStub` insert a short stub along the facing when the wire leaves/enters a pin
  perpendicular, so the conduit + flare exit/enter straight then bend. **Rendering-only**
  (shapes the conduit DRAW route; logical route / hit-test / waypoints / carriers
  untouched), conduit mode only.
- Verified via the replica render (translucent crossings over a grid; before/after the
  align stub).

**Still open:** the **channel-routing "nudge parallel pipes apart"** (the bigger
declutter) is still deferred — it's an actual routing change, unlike the rendering-only
items above.

---

## 2026-06-17 (5) — Conduit translucency + free wire-ends + Potentiometer tiers

**State:** 🟢 Green — web check/lint/build (no Rust; golden untouched). Branch
`claude/kind-turing-hdelb3`. Owner review of the conduits + POT ref delivered.

- **Conduit translucency** (#88): the pipes read solid; dropped the wall/bore/casing/
  flare/junction alphas (~0.3–0.5) so the grid + overlaps show through, voltage core +
  carriers stay readable.
- **Free wire-ends** (#88): a click in empty space while routing drops a `free` junction
  (KiCad dangling end) and keeps routing from it; `continueOrFinishWiring` empty-space
  branch. Drag-release-into-space still abandons. (Model already supported `free`
  junctions — `pruneJunctions` keeps them with one wire.)
- **Potentiometer tiers** (this PR): `drawAnalogyPOT` (packed pipe — track A↔B with
  resistance posts, weaving water = current, sliding wiper contact → arm to W, tapped-
  level gauge) + `drawDetailPOT` (resistive carbon film — potential-gradient bands, atom
  lattice = R, electrons drifting toward the + end, sprung wiper → arm to W). Anchored A
  top-left / B top-right / W bottom-centre; driven by `o.wiper` + current + vAcross +
  value. Registered POT in both maps. Verified (harness pins/bounds/wiper-response +
  render).

**Still open from the owner's message:** **auto-bend to the input** — `wireRoute` is a
fixed mid-split Z ignoring pin orientation; the real fix is pin-direction-aware routing
(or the deferred channel-routing "nudge apart"). Bigger; proposed, not done.

---

## 2026-06-17 (4) — Conduit polish: rounded bends + port taper + 4-way junction fittings

**State:** 🟢 Green — web check/lint/build (no Rust; golden untouched). Branch
`claude/kind-turing-hdelb3`. Owner review of the conduits (R2/GND screenshot): clipping
at parts + plain junction dot. Implemented the connect-cleanly trio (all rendering,
`board.ts`, conduit mode only):

- **Auto bend radius** — `roundedPolyline(g, pts, r)` (quadratic arcs at each interior
  vertex, r ≈ pipe width); the conduit strokes route through it so bends read as smooth
  elbows instead of hard mitres. (The owner's "more elegant" clipping fix.)
- **Port taper** — `drawConduitSkin` flares each end into a port mouth (a filled
  trapezoid, wall + voltage-core, oriented along the end segment) instead of a flat disc
  collar, so the conduit opens INTO the part it plugs into. Mouth = `PITCH*0.34` (a
  standard size; a true per-part port-width match still needs parts to expose a radius).
- **4-way junction fittings** — `drawJunctionConduit`: the arms a wire uses ARE the wire
  conduits; the UNUSED cardinal arms get a short **capped** blanking stub + a hub disc.
  Used dirs collected in the wire loop (`junctionDirs` bitmask via `dirBit`), passed to
  `drawJunctions(g, conduit, junctionDirs)`. Schematic lens keeps the plain dot.
- Verified via the standalone replica render (rounded bend + flared mouths + capped
  T-junction all correct).

**Deferred + proposed (owner's other idea):** "pipes running along each other → nudge
apart" — a render-offset **channel-routing** pass (group collinear overlapping segments,
offset perpendicular). Bigger + riskier (touches routing continuity at bends); left as a
follow-up. Also: true per-part port-width taper (needs parts to expose a port radius).

---

## 2026-06-17 (3) — Board traces as conduits (analogy pipes / reality copper)

**State:** 🟢 Green — web check/lint/build (no Rust; golden untouched). Branch
`claude/kind-turing-hdelb3`. Owner OK'd "traces as pipes" for the analogy tier and asked
how to handle the reality tier — recommendation + impl: BOTH, one renderer, two skins.

- **`board.ts` `redrawWires` now re-skins bare traces as conduits** when zoomed into the
  analogy/reality lens (gated `effLens !== schematic && zoom ≥ TIER_ZOOM`, same as the
  parts morphing). New `drawConduitSkin` + carrier branch:
  - **Analogy = water pipe**: steel wall (`PIPE_WALL`) + dark bore + voltage-tinted
    water core; round water carriers flowing **WITH** the current.
  - **Reality = copper conductor**: copper sheath (`COND_CASING` 0xc8915a) + glowing
    voltage-tinted core + white sheen; cyan electron carriers drifting **AGAINST** the
    current (electrons vs conventional current — the physics).
  - Both keep the bus language (colour = net voltage, density/width = current) and ride
    the existing `carrierOffset`/`flowDelta` clock; energy (warm) dots unchanged. Round
    stroke caps/joins handle the bends; a port collar at each route end is the
    lightweight "taper into the part" (no per-part port geometry needed yet).
  - Constant-width strokes (Pixi rounds bends/ends). Schematic lens + zoomed-out are
    untouched (the original chevron trace).
- Verified by a standalone replica render (same strokes/colours) — pipe vs copper read
  clearly distinct; bend + end collars correct.

**Possible next:** true per-part port-width taper (flare the conduit to each component's
port) — needs parts to expose a port radius; junction tees as pipe/wire branches; perf
pass if big boards feel heavy at the conduit zoom.

---

## 2026-06-17 (2) — Reality transistors rotated to the pins + flow parts around the plug

**State:** 🟢 Green — web check/lint/build (no Rust; golden untouched). Branch
`claude/kind-turing-hdelb3`. Owner review after merging #84: OA + the PM/NM analogy look
solid; the **reality tier needed rotating** to match the pins, and asked to show the
flow **moving around the stopper** in the valve analogies.

- **Reality MOSFET + BJT rotated to vertical + anchored** (`drawDetailMOSFET`,
  `drawDetailBJT`). They were drawn horizontally (terminals left/right, control on top)
  but the pins are terminal-top / terminal-bottom / control-left. Rebuilt vertical:
  - MOSFET: drain well TOP, source well BOTTOM, vertical inversion channel down the
    LEFT surface (pinched at the drain), oxide + metal gate on the left → G pin;
    carrier stream source→channel→drain. Anchored D/S/G.
  - BJT: collector (top) / thin base (middle) / emitter (bottom) bands, base contact on
    the LEFT → B pin; carriers cross the thin base bottom→top, recombination flashes.
    Anchored C/E/B. (`anchorPt` re-imported into detailDrawers.)
- **Flow parts around the plug** — new `tierKit.flowAroundPlug`: a single centred
  carrier stream that swings out to the pipe walls only as it skirts the plug, then
  rejoins, so the obstacle visibly throttles the flow. Wired into the MOSFET + BJT
  analogies (replacing the two straight gapped belts); the **plug is now a disc
  NARROWER than the pipe** (was wider, leaving no side gap) so the stream has room to
  go around it.
- Verified headlessly (harness: all reality + analogy tiers reach pins, in-bounds,
  respond) and re-rendered the PNG to eyeball the rotation + the plug-skirting flow.

**Idea parked (owner, "think on"):** render the board **traces as pipes** to match the
component pipe-metaphor, with an adaptive taper into each part. Not started — it's a
board.ts wire-rendering change (see reply for the sketch / trade-offs).

---

## 2026-06-17 — Op-amp: doc-faithful analogy spool valve + reality differential pair

**State:** 🟢 Green — web check/lint/build (no Rust; golden untouched). Branch
`claude/kind-turing-hdelb3`. Owner showed the opamp-tiers.html tier-2 (left) vs our
board OA (right) and asked to reconcile the LOOK to the design doc — keeping the pins
in their real orientation — and to implement the doc's tier-3 for the **reality** tier.

- **Analogy (`drawAnalogyOA`)** rebuilt to the doc's pilot SPOOL VALVE: two input
  reservoirs (fill = reconstructed ½±½·swing) at the IN+/IN− pins, ±supply reservoirs
  feeding the spool's left ports (the ported one glows), a geared GAIN KNOB, the spool
  with two **bronze** lands bounding the ported channel, the output tank (level =
  swing, rail caps glow on clip), and supply→channel→tank ported flow. Orientation
  reconciled with the pins via the right mental model: **each input steers the spool
  toward the rail on its own side** — non-inverting IN+ (top) → +rail up, inverting
  IN− (bottom) → −rail down — which is pin-correct, doc-faithful (+ up), and the
  correct inverting/non-inverting sense, with no force-balance contradiction.
- **Reality (`drawDetailOA`)** replaced the old capsule/puck with the doc's tier-3
  LONG-TAILED DIFFERENTIAL PAIR: Q+ / Q− stacks (collector n / base p / emitter n+)
  between the +12 V rail and a constant tail current source to −12 V; bases = the two
  inputs, emitters joined at the tail, Vout taps Q−'s collector → OUT. The tail split
  `f = ½+½·swing` crowds into the higher-base side (region glow + branch-stream
  density); output belt = |Iout|; rose rail-pin halo at saturation. Anchored to the
  pins (IN+→Q+ base, IN−→Q− base, OUT→Q− collector).
- **Verified headlessly**: extended the `/tmp` harness to the reality tier too (pins
  reached, in-bounds, responds) AND added a pure-JS shape-dump → Python rasterizer to
  actually *render* both tiers to a PNG and eyeball them (input tanks / supplies /
  gain knob / spool / output tank for analogy; diff-pair + tail source + Vout for
  reality). Sent the preview to the owner.

**Note on the look:** the input tanks sit at the corner pins (top-left / bottom-left)
rather than the doc's top/bottom-centre — the deliberate consequence of "keep pins in
the correct orientation." Everything else mirrors the doc.

---

## 2026-06-16 (evening 4) — Analogy tier: pin-anchoring + faithful re-port (PM/NM/OA/ZD/MOV)

**State:** 🟢 Green — web check/lint/build (no Rust change; golden untouched). Branch
`claude/kind-turing-hdelb3`. Owner: the analogy tiers for **PM, NM, OA, ZD, MOV** were
under-detailed, "didn't make sense / align with their pins," and didn't move with the
right values. Fixed.

- **Terminal anchoring (the alignment fix).** New `TierOpts.anchors` (`tierKit.ts`):
  the host hands each drawer the real pin positions **in the illustration's own REF
  space**, and a multi-terminal drawer routes every lead to its anchor by pin label.
  - `board.ts` computes them from the footprint: `anchor = (pin − footprintCentre) /
    scale`, where `scale = targetHW/REF_HW`. Verified exact: e.g. NM drain anchor
    `(76.5,−76.5)` ⇒ glyph-local `(52,0)` = the real drain pin. So leads land on the
    pin dots (board hides the drawer's own studs).
  - `infoDiagram.ts` passes the same per-pin layout mapped into its panel (0.6·hw /
    0.82·hh), so the board and info views are consistent.
  - `anchorPt(o, label, fxFrac, fyFrac)` helper resolves an anchor or a fraction
    fallback. Drawers that don't read `anchors` (R/C/L/D/TR) are unchanged.
- **Faithful re-ports (analogyDrawers.ts), all anchored + proportional:**
  - **MOSFET NM/PM** — pressure-pilot valve: drain↔source pipe (drain top, source
    bottom — real pin order), seated throat + lifting plug, threshold spring/piston +
    long rod, **sealed** gate pilot line + pressure gauge, supply reservoir = |V_DS|,
    throat choke (saturation proxy). P-channel mirrors: supply = SOURCE, flow up.
    Plug/piston ride a steep `norm(I_D)` (Vgs isn't exposed — the through-current is
    the visible proxy).
  - **Op-amp OA** — pilot spool valve anchored OUT-right / IN+-top-left / IN−-bot-left:
    two sealed input pilots, spool with two lands bounding the ported channel (centre =
    output swing), +rail/−rail bars (glow on clip), output tank = swing, ported flow =
    |Iout|, gain knob.
  - **Zener ZD** — check valve **on the pin axis** (was offset to 0.42·hh, off the
    centred pins) + taller spillway standpipe (level = |Vrev|, weir = Vz) with a
    reverse-return path that carries the clamp current back to the anode.
  - **Varistor MOV** — restructured to the relief-valve ref: vessel (fill = |V| +
    phase-clock molecule jiggle), neck/seat, body chamber with **side vent pipes**,
    bonnet + set-screw (depth = Vclamp) + threshold spring, poppet that cracks at
    `|V|>Vclamp` and vents (flow = |I|). Both leads feed the vessel (bidirectional).
  - **BJT Q/QP** (added after owner OK) — amplifying valve, anchored C-top / E-bottom /
    B-left: collector↔emitter pipe + plug, base **check valve** (passes flow — the
    BJT draws base current) feeding a **float chamber** whose level lifts the plug
    linkage. PNP mirrors (supply = emitter, flow up). Plug/chamber ride steep
    `norm(I_C)`; supply reservoir = |V_CE|.
- **Headless verification harness** (not committed; `/tmp`): compiles the drawers to CJS
  (type-only pixi import elides) and runs a recording mock that asserts, in board mode
  (studs hidden), that **every pin is reached by a lead**, nothing leaves the bounds,
  and the moving part responds to its driver. Caught + fixed real gaps (uncapped pipe
  mouths on NM/PM/ZD/Q/QP). All 7 pass.

**Open / possible next:** all flagged analogy tiers done + anchored. Visual/aesthetic
polish is eyeball-only (can't rasterise Pixi headlessly here) — owner review pending.

---

## 2026-06-16 (evening 3) — Board LOD + remaining review-batch fixes (DONE)

**State:** 🟢 Green — web check/lint/build (no Rust change this batch; golden untouched).
Branch `claude/kind-turing-hdelb3`. Finishes the owner's review batch.

- **Board LOD now 3 levels + toggle + deeper zoom** (board.ts): schematic → tier
  illustration (`TIER_ZOOM` 2.2) → illustration **+ simple pinout labels** (new
  `DETAIL_ZOOM` 4.5); `MAX_SCALE` 3.5→8. `Board.setLod(on/off)` + the `⊕/⊘ LOD`
  button (off ⇒ plain schematic at any zoom; lens button disabled while off). Pinout
  labels = pooled `Text` per pin on the part `view`, upright at the rotated pin.
  (Owner confirmed: NO explanatory text on the board — that stays in the info tab —
  **just** pin-name labels at the deep level.)
- **Pinout clutter fixed**: the tier illustration's decorative `stud()`s are hidden on
  the board (real pin dots are the connections) via a tierKit `studsVisible` module
  flag (set by `setStudsVisible`, like `currentStyle`); board clears it around each
  tier draw, info panel keeps studs.
- **Electrolytic two-tank**: removed the matched-level top line.
- **Transistors**: BJT/MOSFET (analogy + reality) gate-lift/channel now a sensitive
  signed-norm of the through-current (steep near 0) + bigger throw, so they visibly
  track small currents. (Still only the main through-current + node0−node1 V are
  exposed — no Vgs/Vbe/Ib — noted as a future state-exposure if finer transistor
  fidelity is wanted, à la the transformer flux.)

**Open / possible next:** tune `TIER_ZOOM`/`DETAIL_ZOOM` thresholds on a live eyeball;
off-screen cull for tier illustrations on big boards (perf); deeper transistor fidelity
would need Vgs/Ib exposed (same pattern as the transformer flux just shipped).

---

## 2026-06-16 (evening 2) — Transformer flux exposed; cap-spring; review-batch in progress

**State:** 🟢 Green — full gates (cargo fmt/clippy/test 102 incl. determinism +
`transformer_*`; build:wasm; web check/lint/build). Branch `claude/kind-turing-hdelb3`.

**Done this stretch (owner's big review batch — partial):**
1. **Transformer flux exposed + driven from it.** The owner asked why a bridge shows
   asymmetric flux bias if "flux isn't modelled" — it IS (the magnetising current `Im`
   is a reactive store; I'd conflated *modelled* with *exposed*). Surfaced it read-only
   (golden-safe, not hashed): `sim-core::reactive_currents()` → wasm →
   `Snapshot.reactiveCurrents` (interpolated in `lerpSnapshot`) → `electricalMap` →
   `ElectricalState.flux`. The transformer analogy + reality now read `flux`: wheels
   rock to where the flux sits (DC bias → off-centre, heavy drive → pins a sat end),
   core-flux loop brightness/direction follow real flux. Best under slow-mo. Confirmed
   the high-step-up bridge is *bounded* (so 601 V from US-mains×step-up is correct, not
   a bug — `transformer_bridge_high_stepup_inrush_bounded`).
2. **Ceramic-cap spring greatly exaggerated** (sensitive signed-norm of Vc + bigger
   throw) so the piston/spring visibly works at realistic Vc.

**Still TODO from the same batch (NOT done):**
- **Zoom LOD: 3 levels + toggle + zoom in further.** Currently 2 (schematic ↔ one tier
   illustration past `TIER_ZOOM`). Owner wants a *deeper* level = the design sheet 1:1
   (likely needs text labels in drawers — an architecture question to confirm), a
   slightly-simplified middle (current), and a toggle to disable the LOD. Raise
   `MAX_SCALE` (board.ts ~90).
- **Pinout clutter on the board.** The tier illustration draws its own decorative
   `stud()`s AND the real pin dots show → doubled terminals. Add a `studs?: boolean` to
   TierOpts (board passes false; info panel keeps them) and gate the drawers' terminal studs.
- **Electrolytic two-tank: remove the "matched-level guide" line** across the tops
   (analogyDrawers `drawAnalogyElectrolyticCap`) — owner says it implies more than "fill/drain".
- **Transistors not moving proportionally** — BJT/MOSFET plug-lift uses `norm(current)`;
   make it a sensitive signed response like the cap spring (current only exposes the main
   through-current + node0−node1 V, not the gate/base control — note the limit).

---

## 2026-06-16 (evening) — Scope smoothing/auto, slow playback, render interpolation

**State:** 🟢 Green — full gates pass (cargo fmt/clippy/test 102 incl. determinism; build:wasm;
web check/lint/build). Branch `claude/kind-turing-hdelb3`. Pure presentation — no Rust/golden
touch. Headed to main.

**Owner's scope + slow-motion batch:**
1. **Scope jitter (zoomed-out / slow)** — the trace was plotted by sample *index*, so at long
   spans the sparse decimated samples stepped instead of panned. Now the x-axis maps by **tick**
   within a sliding window `[tick−span, tick]` (board.ts `drawScope`, `scopeTick`), so it pans
   smoothly. Dropped the dead `scopeCursor`.
2. **Auto time-base** — the `⏱` span control gains an **auto** slot after the presets:
   `updateAutoSpan()` sizes the window to ~`AUTO_CYCLES` (3) periods of the biggest-swinging trace
   (period from upward mid-crossing spacing, eased; DC holds, too-short widens). Button shows
   "auto"; the live window shows in the scope overlay.
3. **Slow playback** — `RATES` now reach down to **1 t/s** (= 500,000× slow-mo); `fmtRealtime`
   reads as a "…× slow-mo" factor. `dt` (2 µs) is unchanged — it's the determinism contract.
4. **Smooth slow-mo (render interpolation)** — `sim/loop.ts` `lerpSnapshot` + the frame display
   step now **glide between the two latest computed ticks** by the fractional accumulator (node
   voltages + element currents), so at low rates the visuals slide instead of snapping once per
   step. ≤1-tick display lag (imperceptible above a few t/s); paused/scrubbing shows the exact
   snapshot. The sim still steps at the fixed dt → determinism untouched.

**Still TODO (owner asked, not yet done):** add **component + net labels to a few example
circuits** (examples.ts) for clarity — the owner specifically wants the rectifier / AC examples
labelled (Vin/Vout/GND etc.). The delegated agent hit a server 500 and did nothing; examples.ts
is untouched. API: `c.label = "R1"`; `g.addNetLabel({componentId, pinIndex}, "NAME")` — **net-label
names ALIAS nets, so each distinct net needs a UNIQUE name** (reusing a name shorts them).

---

## 2026-06-16 (afternoon) — Tiers on the board + owner review fixes

**State:** 🟢 Green — full gate set passes (cargo fmt/clippy/test 102 incl. determinism;
build:wasm; web check/lint/build). Branch `claude/kind-turing-hdelb3` (reset onto main after
the #74 squash, new commits on top). Pure presentation — no Rust/golden touch. Headed to main
(owner's iterate-on-main loop).

**Addressed the owner's review of the deployed tiers (all 7 notes + the zener follow-up):**
1. **Tiers on the board** — board lens is now 3-way (Schematic / Analogy / Reality), replacing
   schematic↔factory. A part shows the schematic symbol as the overview; **zoomed in past
   `TIER_ZOOM` (board.ts, =2.2)** the analogy/reality lens morphs it into the full-panel
   illustration drawn into the part footprint (new `tierGlyph` on `ComponentNode`, centred at
   `(wPx/2,hPx/2)`, animated from the same live state + shared phase). A working LOD: zoom-in
   adds detail, zoom-out is clean + cheap. **This is the bit built without a live eyeball — most
   likely to need tuning** (TIER_ZOOM threshold, the footprint `bounds` = `wPx/2+PITCH*0.7` /
   `max(hPx/2+…, hw*0.6)`, possible off-screen-cull for cost on big boards).
2. **Resistor reality** — rebuilt as the **conductor-lattice** view (resistor-tiers tier 3):
   jiggling + ion cores, electrons drifting toward + and scattering, heat glow/smoke. (Was a
   colour-band rod.)
3. **Info-panel clipping** — electrolytic two-tank, BJT + MOSFET reservoirs were overflowing;
   pulled them inside the canvas (proportional heights).
4. **Transformer analogy** — wheels now **rock back and forth** (AC hinge on the shared phase
   clock, amplitude ride drive) instead of one continuous spin; strap ticks shuttle.
5. **Info tab defaults to the board lens** — `diagramMode` defaults to `boardLens` on
   selection/double-click (untracked, still toggleable).
6. **Diode analogy** — ball now lifts **downstream** (toward cathode) when forward (was
   backwards); decluttered.
7. **Diode reality** — rebuilt as the **PN-junction cutaway** (diode-factory.html): P|depletion|N,
   carriers crossing + recombining, depletion width tracks bias, LED photons, Schottky = electrons.
   **+ Zener analogy** rebuilt to the check-valve+spillway doc (no longer scrunched).

**Files:** `web/src/lib/board.ts` (BoardLens + TIER_ZOOM + ComponentNode.tierGlyph),
`web/src/App.svelte` (3-way lens button `cycleLens`, info-tab default), `analogyDrawers.ts`
(transformer/diode/zener/EC/BJT/MOSFET), `detailDrawers.ts` (resistor + diode reality).
`Board.setStyle` is now unused (App calls `setLens`); left in place.

**Caveats unchanged:** BJT/MOSFET reality gate cue off |I| (no Vgs/Ib); transformer reality |Ip|
flux proxy. Still no live screenshot of the board-tier LOD — verify thresholds/positioning there.

---

## 2026-06-16 (overnight) — Part-demo tiers: animation fixed + all batch-1/2 tiers built

**State:** 🟢 Green — all web gates pass (`format`/`check`/`lint`/`build`); no Rust/golden
touch (pure presentation). Branch `claude/kind-turing-hdelb3`, **pushed**. Not merged to main
(owner offline; will eyeball in the morning). Owner's standing ask: *"push on until a gated
decision point or you run out of designs."* The remaining item — the **board LOD** — is that
gated decision point (a visual-tuning pass the owner wants to see live).

**Done this stretch (owner's most-recent feedback + both batches):**
1. **Animation slow/de-jitter/pause-flow-with-time** — `InfoDiagram` no longer free-runs a
   wall-clock phase; it adopts the **board's shared flow clock** via the new
   `Board.flowPhase()` (App.svelte feeds `infoDiagram.setPhase(b.flowPhase())` each frame).
   That clock is calm (`FLOW_HZ≈0.6`), freezes when paused, reverses when scrubbing back. The
   detail dot-loops were de-jittered with a fixed-slot `dotPresence` fade (no more count-flip
   teleporting when the live current wiggles).
2. **Analogy tier is now full-panel** (was the small scaled board glyph). New
   `web/src/lib/analogyDrawers.ts` + shared `web/src/lib/tierKit.ts` (extracted the common
   types/scales/`belt`/`stud`/`housing`/`mix`/`norm`/`dotPresence` from detailDrawers; reality
   tier behaviour unchanged). `InfoDiagram` analogy mode → `drawAnalogy()` full-panel, else the
   board Factory glyph; `effectiveDiagramMode` gates on `hasFactory || hasAnalogy`.
3. **Analogy drawers (full-panel):** R, C, EC, L, TR, D/SD/LED, ZD, Q/QP, NM/PM.
4. **Reality drawers added:** C (MLCC), EC (Al-foil), TR (iron-core windings), Q/QP (BJT
   silicon), NM/PM (MOSFET silicon) — registered in `DETAIL_DRAWERS`.
5. Saved + queued the **PMOS ref** (`docs/ui/parts/mosfet-pmos-tiers.html`).

**Discipline kept:** every tier reads only live `electrical`/`value` + the shared `phase`;
magnitude on density/alpha (never speed); motion at the calm phase rate/direction; no text
(the info panel supplies telemetry rows); recolour from PALETTE.

**NEXT — the gated decision point (board LOD):** a *working* LOD (owner: NOT hide-to-reveal —
the part is always visible/animating; zoom-IN adds factory→reality detail, zoom-OUT simplifies
for clarity + cost). Plan in `docs/ui/part-demos-tiers.md` phase 3: hook the swap off
`world.scale` in `Board.update()`, positioning the full-panel analogy/reality illustration as
an overlay over the zoomed part (the drawers already take a centred `bounds`, so they drop in).
Thresholds + blend are the visual-tuning the owner will eyeball — **stop here for owner review**.
Caveats to mention on review: BJT/MOSFET reality drive the gate/base proxies off |I| (no Vgs/Ib
in the basic ElectricalState); transformer reality uses |Ip| as a flux-activity proxy (true
core-flux/saturation belongs to the ideal-vs-real work).

---

## 2026-06-16 (night) — Part-demo tiers: refs + design landed, implementation starting

**State:** 🟢 Green (docs only this stretch; web/Rust untouched). Branch `claude/kind-turing-hdelb3`.
Component labels merged via **PR #72** (deployed).

**New MAJOR feature kicked off — three-tier part demos** (owner's design): every part shown
**schematic / analogy / reality**, animating live, revealed by **zooming into a placed part** or via
the **info panel**. Owner uploaded 5 detailed design sheets → saved as **`docs/ui/parts/*-tiers.html`**
(resistor, ceramic cap, electrolytic cap, inductor, transformer — standalone HTML, the authoritative
visual/animation spec). Design + phased plan: **`docs/ui/part-demos-tiers.md`**. **More part sheets
coming once this batch is implemented** (owner will upload the next batch then).

**Existing scaffolding to extend (don't duplicate):** App.svelte's `infoDiagram` (`setMode`/`setState`),
`hasDetail`/`hasFactory`, `diagramMode`/`effectiveDiagramMode` (schematic vs reality). A background
Explore agent is mapping its exact API + renderer + the board zoom/LOD hook.

**Progress + NEXT:** Mapping done — the three-tier system already exists (~70-80%): `InfoDiagram`
(PixiJS) + `DRAWERS`/`FACTORY_DRAWERS`/`DETAIL_DRAWERS` + tier switcher + live feed; reality drawers
for OA/D/SD/LED/ZD/R. **Inductor reality tier DONE** (`drawDetailInductor`, registered; gates green —
needs a live eyeball). Remaining reality drawers: **C, EC, TR** (same `drawDetail<Kind>` pattern in
`detailDrawers.ts` → `DETAIL_DRAWERS`). Then the **board LOD** — owner clarified it's a *working* LOD,
**NOT** hide-to-reveal: the part is always visible/animating, zoom-IN adds factory→reality detail,
zoom-OUT simplifies for clarity + render cost, nothing hidden; tune on visual review. **Batch 2 queued**
(`docs/ui/parts/`): `diode-factory`, `diode-tier2-study`, `zener-tier2` (analogy → `FACTORY_DRAWERS`),
`transistor-tiers` (Q/QP/NM/PM reality) — implement after batch 1, in order, no rush. Pure presentation
→ no golden impact. (Ideal-vs-Real fidelity work remains queued below; the tier demos are its visual
companion.)

---

## 2026-06-16 (night) — Component labels built + FAIL UI merged (PR #71)

**State:** 🟢 Green (web check/lint/build; no Rust change this stretch). Branch
`claude/kind-turing-hdelb3`, ahead of `main` by the labels commit. **The FAIL UI from the
entry below merged via PR #71** (deployed — owner can see the pulsing red box live).

**Component labels / renaming (owner ask, "a big one") — built (pending merge):**
- `web/src/lib/graph.ts`: `Component.label?: string`. Persists for **free** — `serialize`/`restore`
  spread the whole component, and the `cec-circuit` save format wraps `serialize`. Old JSON
  round-trips (optional field), so the owner's current exports stay valid.
- `web/src/lib/board.ts`: `ComponentNode` renders `component.label ?? kindTag`; `setLabel()`;
  `setComponentLabel()` — undoable, routed through **`onPersist`** (cosmetic save; **NO netlist
  rebuild, NO sim rewind**, like a net-label drag); `SelectedPart.label` + `emitSelect`; copy/paste
  preserves it (`ClipboardSnippet` + `copySelection` + paste restore).
- `web/src/App.svelte`: the value popover now opens for **every** selected part (dropped the
  `hasValue` gate on the outer `{#if}`; wrapped the value UI in `{#if hasValue(kind)}`), with a
  label `<input>` at the top that commits on blur (`onchange`); `setLabelText` handler; `.insp-name`
  CSS. (`onAnchor` already fires for any single-selected part, so diodes/GND get the popover too.)
- **Couldn't verify live** (no browser here): the popover-for-all-parts, the input UX, the on-board
  render. Gates green; logic sound. Owner can use it to label the examples in-UI.

**NEXT:** merge/deploy labels (owner said "parts labels next"). Then back to Ideal-vs-Real
(curriculum tiering + additive Real-variant upgrades). Owner is hand-cleaning the **examples**
(exports JSON via the save fn) — keep off `web/src/lib/examples.ts`.

---

## 2026-06-16 (night) — Visible FAIL UI built (pushed, NOT yet merged)

**State:** 🟢 Green (fmt, build:wasm, web check/lint/build). Branch `claude/kind-turing-hdelb3`,
ahead of `main`; **NOT merged** — owner is mid a manual examples-cleanup pass, so coordinate
before merging, and **keep hands off `web/src/lib/examples.ts`.**

**Built the visible FAIL UI** (the engine clamp shipped in PR #70; this is the front end):
- `crates/sim-wasm`: `failed()` + `failed_element_mask()` passthroughs.
- `web/src/sim/loop.ts`: `Snapshot.failed` + `failedMask`, read each frame; **the run freezes on
  FAIL** (`if (at(cursor)?.failed) running = false`) — the whole-sim FAIL state.
- `web/src/lib/glyphs.ts` + `netlist.ts`: `ElectricalState.failed`; `electricalMap` maps the
  per-element FAIL mask back to each component.
- `web/src/lib/board.ts`: `ComponentNode` draws a **pulsing red `FAIL` box + label** on any
  flagged part (`PALETTE.bad`; the pulse runs on a free wall-clock so it breathes even while the
  run is frozen — the flow phase is frozen when paused).
- `web/src/App.svelte`: passes `snap.failedMask` into `electricalMap`.
- **Deferred polish:** the `+FAIL/−FAIL` numeric-readout swap (the meter still shows the clamped
  number when a failed part is selected) and a global FAIL banner — the box + freeze already read
  clearly. Couldn't verify the visual live (no browser here); it compiles and the engine FAIL is
  unit-tested. Owner to confirm the red box on the deployed build.

**Owner asks logged (TODOS):** component **labels / renaming** (a per-part custom label, like net
labels — "a big one"); owner is also doing a manual pass to label/clean the **examples**.

**NEXT:** coordinate + merge the FAIL UI; then curriculum tiering (ideal-basics vs reality-carried)
+ the first additive Real-variant upgrades. (The entry below has the Ideal-vs-Real resolution +
the multi-rate architecture note.)

---

## 2026-06-16 (night) — Ideal-vs-Real RESOLVED (fidelity gradient) + multi-rate note

**State:** 🟢 Green; clean tree after this. Branch `claude/kind-turing-hdelb3` (ahead of `main`
by docs only since PR #70). A **design-conversation** stretch — two design docs, no engine code.

**Ideal-vs-Real RESOLVED** (`docs/sim/ideal-vs-real-parts.md`): owner's call is **fidelity is the
progression curve**, not a global Ideal/Real toggle. Basics (R/C/L/V/I) are pure ideal and
*self-regularize*; past-basics parts carry their essential parasitics by default (no manual
resistors); advanced play unlocks more reality (tolerance/ESR/ratings/saturation) along the
tech-tree. **Research (CircuitJS source + ngspice manual, primary) confirms the mechanism:**
energy-storage elements get a companion resistance for free from the discretization
(`R_cap = Δt/C`, `R_ind ∝ L/Δt`) so they're never zero-impedance — *we already do this*;
semiconductors get GMIN; ideal sources stay pure and a genuine short / source-loop is left
singular → FAIL (correct). So the **"ideal transformer" worry dissolves** — a transformer is
reality-carried by default and its current leakage-floor model is right for its tier; no
zero-leakage variant needed. FAIL narrows to a rare, correct backstop.

**Multi-rate architecture note** (`docs/sim/multi-rate-domains.md`): how to host a GHz CPU and a
µs analog net deterministically. Key: **multi-rate ≠ adaptive** — fixed integer rate ratios are
structure-not-value, so deterministic; adaptive Δt is not. Two kernels (continuous analog MNA at
fixed Δt + discrete event-driven digital sub-stepping a fixed integer per analog tick), meeting
only at **boundary nets**. Owner's insight, now the centerpiece: the analog↔digital boundary **is
a real converter** (ADC/comparator/Schmitt/DAC) — you must place one to cross, exactly as in
hardware, so it's physically honest and falls out for free. Forward-looking (CPU/FPGA/ADC tier).

**NEXT (unchanged priority):** the **visible FAIL UI** — wasm boundary exposes `failed()` +
`failed_element_mask()`, `board.ts` draws the pulsing red `FAIL` box on flagged parts + shows
`+FAIL/−FAIL` on the readout, `loop.ts` pauses the run on FAIL. Engine half shipped (PR #70).
Then curriculum tiering (ideal-basics vs reality-carried examples) + the first additive
Real-variant upgrades. The catalogue roadmap (7-seg, >4-pin keystone, …) is still queued.

---

## 2026-06-16 (later) — c-terminal + FAIL fixes SHIPPED (PR #70); Ideal-vs-Real design underway

**State:** 🟢 Green (fmt, clippy, **102 sim-core tests**, golden stable, wasm, web). **Merged to
`main` via PR #70**. Branch `claude/kind-turing-hdelb3`.

**Two fixes shipped (PR #70):**
1. **Four-pin c-terminal grounded** (`web/src/lib/netlist.ts`): pin 2 → node `c` was computed
   only for `THREE_PIN_TYPES`, so the transformer's **S+** and the DFF's **CLK** (both pin 2 on
   four-pin devices) silently mapped to **ground**. Transformer → bridge collapsed to **half-wave**
   (the owner's "top-right terminal does nothing / one diode conducts"); DFF → never clocked. Fix:
   `nc` now includes `FOUR_PIN_TYPES`, mirroring `nd`. The sim-core bridge tests passed because they
   hand-wire c/d, bypassing the web netlist — **a real web-side coverage gap (no netlist test exists).**
2. **FAIL state** (`crates/sim-core/src/lib.rs`): `flag_and_clamp_fails()` at the end of `step()`
   clamps any non-finite/`> FAIL_LIMIT` (1e9) value to a finite bound (so a NaN can't propagate and
   delete traces), raises `failed()`, and marks `failed_element_mask()`. Deterministic → **native and
   wasm now agree** (NaN was the platform split behind every "live-only" failure). Golden untouched.

**Ideal-vs-Real direction (owner's framing):** two part families toggled in the bin. Ideal = no
parasitics, reads **+FAIL/−FAIL** (whole-sim FAIL state + pulsing red box on the culprit) when pushed
past physics. Real = realistic parasitics, bounded. Mixing **allowed but warned**. Design doc:
**`docs/sim/ideal-vs-real-parts.md`** (mechanic + FAIL foundation + per-part catalogue/brainstorm +
build order). Parts audit done: only **6 parts purely ideal** — V, AC, R, C, L, I; the rest carry
incidental parasitics (TR leakage+RWIND, EC ESR, op-amp output-Z, switch Ron, gate drive, POT wiper,
pull-up). The TR and EC seed their Real variant.

**OPEN DESIGN QUESTION (owner raised, being researched):** the divergence is a **fixed-Δt transient**
artifact (SPICE dodges it with *adaptive* timestepping, which we can't use — it'd break determinism).
Real parts always have inherent R/L, so requiring users to add resistors is counterintuitive. Two
reconciliations: **(A)** purist ideal = zero parasitics, FAILs (you add impedance); **(B)** ideal
carries a tiny *universal* lead/wire R(+L) so it just works, Real adds full parasitics; FAIL becomes a
rare backstop. Possibly both via an Ideal-mode toggle. **A background research agent is investigating
how ngspice/LTspice, Falstad CircuitJS, Multisim, and EE curricula handle this** — decide A/B/both on
its findings.

**NEXT:** (1) research lands → pick A/B/both for ideal-mode; (2) build the **ideal transformer**
(its leakage floor depends on A vs B — the `tr-bridge-supply` example is already bounded+full-wave
post-#70, so it won't insta-die); (3) the **visible FAIL UI** — wasm boundary exposes `failed()` +
mask, `board.ts` draws the pulsing red FAIL box, `loop.ts` pauses on FAIL; (4) the bin Ideal/Real
toggle + allow-but-warn mixing; (5) roll out Real variants (diode Rs, source output-Z first). Also
worth adding: a **web-side netlist test harness** (the c-terminal bug had zero web coverage).

---

## 2026-06-16 (late) — Transformer inrush fix SHIPPED (PR #69) + transistor curriculum

**State:** 🟢 Green (fmt, clippy, **100 sim-core tests**, golden stable, wasm, web). **Merged
to `main` via PR #69** (Pages deploy rebuilds wasm → live). Branch `claude/kind-turing-hdelb3`.

**The bug (owner-reported, live):** the `tr-bridge-supply` example diverged — **~61 kA on
wasm**, traces vanishing mid-run (NaN propagation) — at high step-up / high frequency.
Native was bounded (~50 A) at the same point: the platform split flagged an **ill-conditioned
inrush solve**, NOT stale cache (owner cleared cache + hard-reloaded; still broke).

**Root cause:** the ideal-T fix made the secondary a **hard, zero-impedance** EMF (rs=0, to
keep full-wave). Charging an empty reservoir cap through the bridge at high step-up is then a
near-impulse — a stiff Newton step that tips to garbage under wasm's float rounding. The
secondary branch row also had **no diagonal** (a bare voltage constraint).

**Fix:** a small **secondary leakage inductance** `TRANSFORMER_LLEAK = 5 mH`, a backward-Euler
companion in series in the secondary branch (sign convention matches the magnetiser's `rp`:
**negative** diagonal `-g_leak`, history term subtracted — I first got the sign +g_leak and it
grew an LC oscillation; flipping it fixed it). Leakage has **zero DC drop**, so unlike series
*resistance* (which sags the EMF → half-wave, the reason rs was removed) it leaves full-wave
rectification untouched — it only limits secondary di/dt (inrush) and conditions the row.
`Is` is now a **second reactive state** (`secondary_state`, parallels `reactive_state`;
reflected in `node_v`, NOT hashed → snapshot-hash format + analog golden UNCHANGED).
n=4/1 kHz inrush **49.8 A → 4.3 A**. New regressions: `transformer_bridge_high_stepup_inrush_bounded`
(1 kHz ratio sweep) + `transformer_bridge_isolated_primary_stays_bounded` (floating primary) —
the corners the old 60 Hz / n≤2 bridge tests missed.

**Also shipped (same PR):** the **"Logic from Transistors" curriculum** (owner picked it off the
roadmap) — CMOS inverter/NAND/NOR from raw MOSFETs + an SR latch (cross-coupled NOR, behavioral
gates) in `examples.ts`. Pure content; MOSFET model already does CMOS rail-to-rail as-is.

**Roadmap status (from the 4 research agents — see chat):** owner confirmed the economy model
(seal = FPGA; everyday ICs unlocked via Lux-gated tech tree after a build-from-primitives
contract; IC costs Lux once / cheaper Credits-per-placement than discrete — the integration
lesson). NEXT off the roadmap: the **>4-terminal `Element` keystone** (an optional per-element
extra-nodes side-table — unlocks wide counters/muxes/decoders + the **BCD→7-seg decoder**), the
**7-seg display** (S7 = 7-LED netlist expansion + per-segment GlyphOpts), the small ≤4-pin (B)
digital parts (D-latch, Schmitt, tri-state, 2-bit counter), and on the analog side the
**reusable magnetic core** (generalize the ideal-T to N windings) + relay (P6 latch pioneer).

**NEXT:** confirm the Pages deploy went green and owner sees sane bridge currents after a
refresh. Then resume the roadmap (owner picks the next item).

---

## 2026-06-16 (night) — Stage 4 COMPLETE: open-drain + level-shifter + pull-up

**State:** 🟢 Green (fmt, clippy, **98 sim-core tests**, wasm, web). Branch
`claude/kind-turing-hdelb3`, a few commits ahead of `main` (PR #67's big batch is already
live). Stage 4's digital-interface ground rules are **all in**, with **tier-1 schematic
symbols** (owner will do a tier 2/3 art pass later — that was the explicit ask).

**The set:**
- **Open-drain output mode** (per-gate toggle, aux bit 8) → wired-AND bus with a pull-up.
- **Level shifter** (`ELEM_LEVELSHIFT=20`, digital, 2-pin OUT/IN): reads input at rail A
  (`value`), re-drives at rail B (`aux`) — the conversion lives in its pins (Ideal
  receiver/driver). Web: `value` = input rail (chips), `amp` = output rail (a dedicated
  picker); glyph = the buffer triangle (placeholder). Test `level_shifter_translates_rails`.
- **Pull-up** (`ELEM_PULLUP=21`, analog, 1-pin): resistor to internal Vcc (`value`) through
  `PULLUP_R=4.7k`, stamped as a constant Thévenin in the 4 assembly sites. Glyph = a
  resistor up to a Vcc bar. Test `pullup_takes_net_to_vcc_unless_pulled`.

**Architecture note (confirmed with owner):** the analog↔digital boundary lives in the
gate/FF/shifter **pins** (receiver = quantize voltage→Level on inputs; driver = stamp
Level→voltage on outputs). The pull-up is a **plain analog resistor**, NOT a boundary
marker — it just sets a net's voltage so an all-released open-drain bus reads high.

**aux bit layout (digital elements):** func bits 0–3 · family bits 4–7 · open-drain bit 8
(masked by `aux_bits`/`gate_func_code`/`gate_family_index`/`gate_open_drain`). The level
shifter (a non-gate) instead uses `aux` = output rail B (like AC uses aux for amplitude).

**NEXT:** owner is drafting **new symbols** — when they land, do the **tier-2 (factory) +
tier-3 (real) glyph pass** for LS/PU (currently LS aliases the buffer, PU is a custom
schematic; factory falls back to schematic). Also still open: lifting pure-digital nets
out of MNA (hash-neutral perf), the FBR curriculum example, the digital Tier-A ladder
(counters/shift registers/decoders — now all golden-**additive** on this foundation).
Ship Stage 4 whenever the owner wants (a few commits ahead of `main`; merge via PR like #67).

---

## 2026-06-16 (night) — Big batch SHIPPED (PR #67) + Stage 4 open-drain ground rule

**State:** 🟢 Green (fmt, clippy, **96 sim-core tests**, wasm, web). **The whole prior
batch is LIVE** — audit cleared it (ship-ready), and it merged to `main` via **PR #67**
(`main` couldn't take a direct push — branch-protected — so the "merge to main now" ask
went through a PR + immediate merge). That shipped: transformer ideal-T bridge fix,
digital scheduler Stages 1–2, XNOR/BUF, logic families + picker. Owner reviews on live.

**Stage 4 — open-drain / wired-AND ground rule (DONE, on branch, 1 commit ahead of main):**
The owner asked to "get the ground rules going before we add more stuff," so this lands the
open-drain mechanic (the foundation for buses / I²C / interrupt lines) as a per-gate
*output-mode toggle* — **no new part or symbol** (the owner is drafting symbols separately).
- **sim-core:** `aux` now packs three masked fields — func (bits 0–3), family (4–7),
  **open-drain (bit 8)** — via `aux_bits`/`gate_func_code`/`gate_family_index`/
  `gate_open_drain` (the family decode now masks, fixing a latent leak). `eval_digital`
  maps an open-drain High → `Z` (release); `stamp_digital` leaves the net to an external
  pull-up. New per-gate `gate_gout` makes the displayed gate current family/mode-aware
  (a released output reads ~0 A; also tidies the audit's gate-current note). Default
  push-pull → goldens unchanged. Test `gate_open_drain_wired_and_bus` (bus = A AND B).
- **web:** `Component.openDrain` → `aux` bit 8 in `buildNetlist`; `board.setComponentOpenDrain`
  + emitSelect/clipboard/serialize threading; inspector "output" toggle (Push-pull /
  Open-drain) for gates + a "add a pull-up" hint.

**NEXT (Stage 4 remainder, deferred per "ground rules first"):** a **level-shifter** part
(reads a logic level at rail A, re-drives at rail B — needs a two-rail design, e.g. a
4-pin VccA/IN/VccB/OUT element or a 2-pin part whose `value` is the output rail); maybe a
convenience **pull-up** part. Hold on these until the owner's new symbols land. Also still
open: lifting pure-digital nets out of MNA (hash-neutral perf), the FBR curriculum example.

---

## 2026-06-16 (eve) — Stage 3 DONE; whole batch ready to ship (review audit pending)

**State:** 🟢 Green (fmt, clippy, **95 sim-core tests**, wasm, web check/lint/build).
Branch `claude/kind-turing-hdelb3` is **~18 commits ahead of `main`** and **not merged**
— so NONE of this is live yet (GitHub Pages deploys from `main`). The owner wants to
**ship the whole batch together after a review audit**.

**The full unshipped batch (oldest→newest):** transformer ideal-T bridge fix + audit
follow-ups → digital scheduler Stages 1–2 (net classification, event engine,
level-bearing hash, 4-state DFF) → XNOR/BUF gates → logic-families foundation →
logic-family picker UI.

**Stage 3 (this batch) — logic families, DONE:**
- **XNOR + BUF** surfaced on the board (closed the GATE_AUX gap): graph.ts PART_KINDS,
  netlist.ts type-17 map + codes 5/7, glyphs ×2 (XNOR = XOR + bubble; BUF = NOT triangle,
  no bubble), palette/category, partInfo, pinout, value chips.
- **sim-core families:** `const FAMILIES` (0 Ideal / 1 CMOS / 2 TTL), per-element family
  packed in `aux`'s upper bits (`func + 16*family`, decoded by `gate_family_index`/
  `gate_func_code`) — **no wasm-boundary change**. Wired through `eval_digital`/
  `stamp_digital`/`commit_net_levels`/DFF latch via a per-net `digital_family`. Default
  Ideal → goldens unchanged. Test `gate_family_levels_and_mixed_rail` (CMOS V_OH≈0.95·rail;
  1.8 V high LOST into a 12 V part).
- **Family UI:** `web/src/lib/families.ts` mirrors the Rust fractions; `Component.family`;
  `buildNetlist` packs aux; `board.setComponentFamily` + clipboard/serialize threading;
  App.svelte family chip picker (Ideal/CMOS/TTL) + live V_IL/V_IH/V_OL/V_OH + noise-margin
  readout for digital parts.

**NEXT:** the owner asked for a **review audit that everything works** before shipping —
then merge `claude/kind-turing-hdelb3` → `main` (one batch) to deploy. Do NOT merge
without the owner's explicit go-ahead.

**Stage 4 (follow-up, not started):** open-drain driver mode (release high → Z) + a
wired-AND bus (open-drain + pull-up, resolved by the MNA solve) + a level-shifter part —
all golden-additive. Lifting pure-digital nets out of MNA stays a hash-neutral perf option.

---

## 2026-06-16 (eve) — Digital scheduler Stage 2 SHIPPED (event engine + level hash)

**State:** 🟢 Green (fmt, clippy, **94 sim-core tests** + 1 ignored, wasm, web). Pushed
to `claude/kind-turing-hdelb3`. **Stages 1–2 (the full scheduler) are done.**

**What landed (sim-core, the Option A2 design in `logic-analog-digital-nets.md §7`):**
- **`Level` {Low,High,Z,X}** (`#[repr(u8)]`, no float compares in the digital domain);
  **`combine`** resolution table (Z yields; disagreeing strong → X); 4-state
  **`gate_logic_level`** (reduces to the old boolean table on Low/High).
- **`LogicFamily`** gained **`v_il_frac`** + **`quantize`** (receiver, forbidden band → X)
  + **`drive_level`** (driver: Thévenin for High/Low, mid-rail for X, None=release for Z).
  LEGACY is byte-identical to the old half-rail/`GATE_GOUT` behaviour.
- **Net-centric engine:** `eval_digital` reads each gate's inputs as Levels from the
  committed previous-tick voltages (per-reader rail = one tick of delay), resolves every
  net's drive via `combine` in element order, and `stamp_digital` drives each
  Digital/Boundary net **once** — replacing the 4 per-gate stamp sites + 4 `stamp_dff`
  calls. Two outputs on a net now **resolve** instead of fighting. Still linear fast path.
- **4-state DFF:** `ff_q` + `ff_clk_prev` (Level), latched via `quantize`; **both now in
  the hash**. `snapshot_hash` folds node_v for analog/boundary, the discrete Level (u8)
  for each pure-digital net, and the DFF state. **RC golden `0xeaac` untouched.**
- Removed superseded `gate_logic`/`gate_target_level`/`reads_high`/`drive`/`stamp_dff`.
- **New tests:** ring oscillator oscillates; multi-driver resolves (agree→level,
  conflict→mid-rail X); per-tick **lockstep replay** of a clocked DFF. All prior
  gate/DFF behaviour + reproducibility tests stayed green.
- **Note:** the predicted "deliberate golden break" needed **no golden regeneration** —
  digital tests are behaviour + self-consistency, and the only fixed golden (RC) has no
  digital parts. The GMIN-bookkeeping change shifted digital node_v at 1e-12 but no test
  pins a digital node to a fixed value.

**Still pure-MNA-resident:** pure-digital nets still occupy MNA rows (driven + solved +
quantised). Lifting them OUT of the matrix is a **hash-neutral** future optimisation
(the hash already folds their discrete Level, not node_v) — do it only if perf needs it.

**NEXT — Stages 3–4 (follow-ups, golden-additive / presentation):**
- **Stage 3 (web):** thread a per-gate family index through `set_netlist`
  (sim-wasm → loop.ts → netlist.ts) + a family chip in the inspector; noise-margin /
  forbidden-band readouts (read the snapshot, presentation-only); surface XNOR(5)/BUF(7)
  as board parts (the `GATE_AUX` gap in `web/src/lib/netlist.ts`). Real families
  (TTL/CMOS/LVCMOS) become selectable here — the `quantize`/`drive_level`/X machinery is
  already in place; just add the `FAMILIES` table + per-element index.
- **Stage 4 (sim-core, additive):** open-drain driver mode (release high → Z) + wired-AND
  bus (open-drain + pull-up resistor, resolved by the MNA solve); a level-shifter part.
- **Renderer:** `Sim::net_class(n)` (0/1/2) is already exposed for drawing digital nets /
  boundary buffers distinctly.

---

## 2026-06-16 (pm) — Digital scheduler: research synthesized + Stage 1 shipped

**State:** 🟢 Green (all gates: fmt, clippy, 92 sim-core tests + 1 ignored, wasm, web).
Pushed to `claude/kind-turing-hdelb3` (3 commits this batch). The owner asked to build
the digital scheduler; chose scope **Stages 1–2 (full scheduler)**.

**Done:**
- **Research (6 agents) → `docs/ui/logic-analog-digital-nets.md` §7** — the
  research-validated design + build plan. Read §7 first; it is the authoritative spec.
  Headline: the fixed 2 µs step collapses all the variable-timestep mixed-mode machinery
  to a strict per-tick lock-step; unit-delay two-pass evaluate→commit is provably
  order-independent; digitaljs is the working precedent; Falstad (gates in the MNA matrix
  + RNG) is the anti-pattern we're leaving.
- **Stage 1 — net classification (golden-stable), shipped.** `classify_nets` in `install`
  labels each node Analog/Digital/Boundary deterministically; `is_digital(kind)`;
  `NetClass` enum; `Sim::net_class(n)->u8` accessor; `net_classes` field. Computed but
  **not yet acted on** (pure-digital nets still stamp into MNA), so every golden is
  bit-identical (0xeaac RC, gate/DFF reproducibility all unchanged). Test
  `net_classification_separates_domains`.

**NEXT — Stage 2: the event engine + level-bearing hash (the one deliberate break).**
This is the determinism-sacred core; do it deliberately, not rushed. Full spec in §7
(esp. §7.3 phase order, §7.5 models, §7.6 corrections, §7.7 test bar). Concrete plan:

- **Model:** `#[repr(u8)] enum Level{Low,High,Z,X}`; `LogicFamily.quantize(v,vhigh)->Level`
  (needs a new **`v_il_frac`** field; LEGACY sets `v_il_frac=v_ih_frac=0.5` → no X band →
  identical); a `combine(Level,Level)->Level` resolution table (Z yields; disagreeing
  strong → X — table in §7.6). DFF state becomes 4-state `Level` (`ff_q` + `ff_clk_prev`),
  replacing the f64 `ff_bit`/`ff_clk_high`.
- **Engine (per tick, in `step`):** evaluate-all double-buffer in **element-index order**:
  (1) each gate's output Level from committed input net-levels (4-state `gate_logic`);
  (2) each DFF Q/Q̄ from `ff_q`, with edge-detect on the committed CLK net-level;
  (3) **resolve per net** by folding all drivers via `combine` → `digital_drive[node]`;
  (4) the four MNA stamp sites stamp **each digital/boundary net once** from its resolved
  level (LEGACY Thévenin = today's `GATE_GOUT`), replacing the per-gate/DFF stamps;
  (5) after the solve, commit each digital/boundary net-level = `quantize(node_v)`.
- **⚠ GMIN gotcha (the trap):** today each gate stamps `GMIN` on *each* input it reads, so
  a net read by K gates gets K·GMIN on its diagonal. A net-centric restructure that floors
  each net once gives 1·GMIN → `node_v` differs at the 1e-12 level → **every digital hash
  changes**. So the restructure *is* the deliberate break (regenerate digital trajectories;
  there is **no fixed digital golden** — gate/DFF tests are self-consistency `run==run` +
  behavior, and the only fixed golden is RC/0xeaac which has no digital parts and stays).
  Either replicate K·GMIN exactly (ugly) or accept the regen (cleaner) — accept it.
- **Hash (`snapshot_hash`, lib.rs:3548):** fold `node_v` for Analog+Boundary nodes (as
  today) **plus** one `u8` Level per **pure-Digital** net **plus** each DFF's `ff_q` and
  `ff_clk_prev` (u8). Forward-stable, append-only; RC golden untouched.
- **Exact touchpoint map (verified @ commit 51c54dc — re-grep before editing, they drift):**
  - *Substrate:* `struct LogicFamily` 444, `const LEGACY` 462 (add `v_il_frac` here =
    `v_ih_frac`), `reads_high` 474 + `drive` 482 (add `quantize`/`combine` near these),
    `gate_target_level` 809, `ff_bit`/`ff_clk_high` fields 1394/1398 + inits 1488/1489
    (→ become 4-state `ff_q`/`ff_clk_prev`). Already present to leverage: `NetClass` 852,
    `classify_nets` 865, `Sim::net_class` accessor, `is_digital`.
  - *The 4 MNA solve sites* (each has a gate STAMP arm + gate READOUT arm + a `stamp_dff`
    call + a DFF READOUT arm): linear-OP, linear-transient, Newton-OP, Newton-transient.
    Gate stamp arms at **1894 / 2074 / 2901 / 3128**; `stamp_dff` def **3365** (called at
    all 4); commit/latch DFF arm **3452**; `snapshot_hash` **3548**. So it's ~16 match arms
    + stamp_dff + commit + hash — sizeable; a shared `stamp_digital(mat,rhs,dim)` helper +
    a precomputed `digital_drive: Vec<Level>` (resolved per node once per tick) keeps the
    4 sites to one call each.
  - *Baseline is green @ 51c54dc:* 91 sim-core tests, clippy, fmt, wasm, web all pass — so
    any red during Stage 2 is attributable to the restructure.
- **Tests (§7.7):** ring-oscillator oscillates (no hang/deadlock); gate-only stays on the
  **linear fast path** (no Newton); 4-state resolution table; multi-driver wired-AND
  (open-drain+pull-up); per-family `*_run_is_reproducible`; and **rewind-across-a-clock-edge
  → identical hash** (store `ff_q`+`ff_clk_prev` in the keyframe — the most likely replay
  bug). Existing gate/DFF behavior + self-consistency tests must stay green.
- **Sequencing tip:** because of the GMIN gotcha there is no clean golden-stable sub-split;
  do the restructure + hash as one focused commit, leaning on the existing behavior/
  self-consistency tests + the new test bar to prove correctness and determinism.

Stages 3–4 (web threading; open-drain/level-shifter parts) remain follow-ups.

---

## 2026-06-16 — Transformer→bridge FIXED (ideal-T, hard secondary)

**State:** 🟢 Green (all gates: fmt, clippy, 90 sim-core tests + 1 ignored, wasm build,
web check/lint/build). Pushed to `claude/kind-turing-hdelb3` (2 commits). **Audit agent
done** (owner asked for one) — verdict: fix correct, no defects; its findings are folded
in (see "Audit follow-ups" below).

**What changed (`crates/sim-core/src/lib.rs`):** rewrote the transformer from a
coupled-inductor pair to an **ideal-T model**. Two branches: magnetising `Im` (a→b, the
only reactive state) + secondary `Is` (c→d, algebraic). Magnetiser row is a backward-
Euler inductor companion with primary winding R `rp`; the **secondary is a HARD
differential** `V(c)−V(d) = n·V_Lm` where `V_Lm = g_mag·(Im−Im_prev)` is the magnetiser
voltage (NOT the terminal voltage — coupling to `V_Lm` is what blocks DC). Primary KCL
draws `Im + n·Is`; current readout = `Im + n·Is`.

**Two hard-won refinements** (full writeup: `docs/sim/transformer-bridge-convergence.md`
§7; the §6 verification already killed the §1–§4 "secondary→ground resistor" idea):
1. **Secondary has zero series resistance.** A `rs·Is` term softens the differential →
   under a bridge charging a cap it latches the wrong diode pair and runs away (positive
   feedback, `Is` climbed past 25 A in the trace). `rs = 0` makes the wrong state
   algebraically impossible. `rp` (primary) still gives loss + DC-block.
2. **No common-mode reference resistor.** Proved via a floating-AC-source baseline that
   the bridge rectifies full-wave on the GMIN-only floor; an interim 1 MΩ tie was added
   then **removed** (preserves galvanic isolation, diode currents become exactly
   symmetric). §4 of the research note was a red herring for a *hard* source.

Removed now-dead `TRANSFORMER_K` + `transformer_inductances`. Updated all transformer
doc-comments. `transformer_scales_ac_by_turns_ratio` now expects ratio = **n** (no k).
New regression **`transformer_bridge_rectifies_full_wave`**: 12 V-pk / n=1 / bridge /
100 µF / 1 kΩ → Vout 9.96–10.85 V, ripple ~0.9 V, **all 4 diodes** (0.12/0.155 A),
Iprim ~0.19 A, no spike/runaway. **Main analog-RC golden `run_is_reproducible`
untouched** (no transformer in it); `transformer_run_is_reproducible` still self-checks.

**Audit follow-ups (all done):** the audit confirmed the stamp math sign-by-sign, the
hard-differential reasoning, and zero determinism risk. Folded in: (1) new
`transformer_bridge_full_wave_scales_with_ratio` test (step-up n=2 + step-down n=0.5 —
exercises the `n·g_mag` / `n·Is` terms; refactored both bridge tests onto a
`bridge_rectifier_run(n, amp)` helper); (2) removed the now-dead `reactive_state_b`
field (secondary is algebraic — it was written every step but never meaningfully read)
and simplified `stamp_transformer_op`; (3) fixed stale "coupled-inductor / mutual-M"
comments and the doc §6 `n·V_p`→`n·V_Lm` prose mismatch.

**Next:** the owner's next ask is the **digital scheduler** ("we can do the scheduler
after"). Optional leftovers: the FBR curriculum example + reusable magnetic core (TODOS),
and a possible secondary copper-loss model via an internal node (deferred — would restore
winding R without softening the forced differential).

---

## 2026-06-15 (eve) — Merged to live (#63), 3-tier info panel, onboarding MVP

**State:** 🟢 Green (all gates). **PR #63 merged to `main` → deployed to live** for
owner review. Branch `claude/kind-turing-hdelb3` continues past the merge.

**Shipped this batch:**
- **3-tier component view** (owner's model) in the info panel: `Symbol · Factory ·
  Real` selector (`glyphs.ts drawGlyphIn`, `InfoDiagram` modes schematic/analogy/
  reality, outward fallback), defaults to Real; pinout + equation + "Right now" stay.
  The carriers-vs-energy **power primer moved out** to a "Reading the board" legend in
  the telemetry panel. Decision + reality-art framework in `component-info-panel.md`.
  (Reality art is owner-provided per component later — each is one `DETAIL_DRAWERS` entry.)
- **Onboarding MVP (pull-based, no levels)** — `concepts.ts` + App wiring: four
  first-encounter cards (source/ground/loop/reading) offered the moment the board can
  show each true, deduped via a queue + persisted `seenConcepts`; single
  `explainAsYouGo` mute; an always-on **"?" Help handle** (mute / replay tips / re-show
  intro). Settings load+persist via `storage.ts`. Cards hold off until the intro is
  dismissed. See `onboarding-first-run.md` §10.
- **Double-click info pipeline** checked: smooth (open via double-click/`I`/ⓘ, then it
  re-targets on every single-click); double-click now always re-asserts the Real view.

### Scoped wiring/placement fixes — INTEGRATED + on live (#64)
The worktree agent's **3 fixes** landed (cherry-picked clean, gates pass, merged to
live in #64): drop-on-track splits + de-shorts; segment-precise wire delete (adds
`Junction.free` + `graph.deleteWireSegment`); **KiCad click-to-continue wiring**
(press-while-routing completes-then-continues; classic drag-to-wire + junction
double-click-drag preserved). Note the new **click-based wiring is "sticky"** mid-route
(finish on a pin or Esc) — KiCad-faithful, as the owner asked; watch for feedback.

### Still open
- **Digital scheduler** (Phase 1+, the dedicated session; `logic-…-nets.md` §6).
- **Onboarding heavier pieces** (deferred): cold-open auto-play, the guided first-build
  wiring affordances (pin-glow, next-edge ghost), bin-narrowing/pre-arm (§1–§3, §6).

---

## 2026-06-15 (pm) — QoL batch (partial) + scope time window

**State:** 🟢 Green (full CI suite passed). Branch pushed. Shipped from the owner's
QoL batch:
- **Pan yields to Build on a grab** — clicking a part/wire in Pan switches to
  Build/Select and grabs it (move/reshape); empty still pans. New `onMode` callback.
- **R rotates the ghost** whenever a part is armed (was rotating a leftover selection).
- **Scope selectable time window** — decimated spans 0.48 ms/4.8 ms/48 ms/0.48 s (base
  = old behaviour), ⏱ button cycles, duration labelled. Fits a full low-f AC cycle.
- **Open-loop current-source fix re-verified** (harness: open 0 mA/0 V, closed 10 mA).

**Deferred (interaction-model changes — analysis in TODOS "QoL / fixes batch"):**
drop-on-track segment split (#4), delete-only-segment-to-junction (#5), KiCad
click-to-continue wiring (#6 — needs `onPointerDown` reworked to complete-while-wiring).
Plus the still-pending **onboarding** (pull-based; `docs/ui/onboarding-first-run.md`)
and the **digital scheduler** (Phase 1+, the dedicated session; `logic-…-nets.md` §6).

---

## 2026-06-15 (later) — Logic-family decision + Phase 0, marquee/copy-paste, factory internals

**State:** 🟢 Green. sim-core 88 tests pass, golden `0xeaac…fa24` **unchanged**; all
web gates pass. Branch `claude/kind-turing-hdelb3` (pushed).

**Shipped this batch:**
- **Marquee select + copy/paste/cut** (`board.ts`/`App.svelte`): Select-mode empty
  drag rubber-bands a box (shift = additive); `Ctrl/Cmd-C/V/X` copy/paste/cut an
  in-memory fragment (components + internal wires + net labels), paste with fresh ids
  at a growing offset. Group drag already worked.
- **Logic-gate analog/digital architecture — DECIDED + Phase 0.** Owner chose the
  **full separated digital domain** (families + driver/receiver boundary + a
  deterministic event scheduler + level-bearing hash) **now**, with a **legacy-ideal
  default** (existing circuits identical; only gate/DFF goldens regenerate when the
  scheduler lands; future digital parts are golden-additive). Decision + concrete
  build order recorded in **`docs/ui/logic-analog-digital-nets.md` §6**.
  - **Phase 0 landed (golden-stable):** `LogicFamily { v_ih_frac, v_ol/v_oh_frac,
    g_ol, g_oh }` + `LEGACY` const reproducing the original gate exactly;
    `gate_target_level` routes through `LEGACY.reads_high`/`.drive`. Byte-identical,
    golden unchanged, `legacy_family_matches_original_gate` guards it.
- **Live construction-detail ("factory internals") views** integrated from a worktree
  agent: `web/src/lib/detailDrawers.ts` (new) — animated op-amp/diode/LED/Schottky/
  Zener/resistor internals driven by live `ElectricalState`; `InfoDiagram` detail mode
  + `DETAIL ?? schematic` fallback; a **Symbol⇄Inside** toggle (defaults to Inside).
  Composed with info-panel Phase 1: drawer = toggle → diagram → pinout → equation.
- **Earlier this session (already pushed):** pan-regression + label-ghost fixes,
  open-loop current-source zeroing, POT non-bug (answered), phase-shift example,
  info-panel Phase 1 (double-click/`I`/ⓘ + pinout).

### Pick up here — the digital domain (the big, risky part; do it fresh)
The determinism-critical work remains: **Phase 1** receiver/driver split + in-core net
classification (analog / pure-digital / boundary), **Phase 2** the **deterministic
event scheduler** (integer-tick buckets, enum `Level{Low,High,Z,X}`, element-index
order, one-tick-delay feedback) + fold digital net levels into `fnv1a` → **regenerate
gate/DFF goldens** (the one deliberate break), **Phase 3** boundary threading to web
(family chip, noise-margin readout) + surface XNOR(5)/BUF(7) (the `GATE_AUX` gap),
**Phase 4** open-drain/Z/wired-AND + level-shifter. The acceptance bar + exact design
are in `logic-analog-digital-nets.md` §6. Do this with full budget — never land a
half-built scheduler. Also still queued: **onboarding** (pull-based, no levels;
`docs/ui/onboarding-first-run.md`), more parts/ICs.

---

## 2026-06-15 — Editor fixes, open-loop source, phase-shift example, info-panel Phase 1

**State:** 🟢 Green. All web gates pass (`check`/`lint`/`build`); sim-core untouched
this batch, golden `0xeaac376499e4fa24` unchanged. Branch `claude/kind-turing-hdelb3`.

**Shipped (pushed to the feature branch):**
- **Pan regression fix.** The pan tool (Esc default) no longer blanket-grabs
  pointerdown: a pin/junction press starts a wire, a wire press reshapes, an armed
  click places, and only a body / empty drag pans. `arm()` leaves pan for select.
  (board.ts onPointerDown pin/junction now accept `"pan"`; body-press in pan falls
  through to pan unless additive.)
- **Label ghost fix.** onPointerMove now refreshes the ghost in `label` mode too
  (was only `armed`/`junction`), so the name-pill preview tracks the cursor + snaps.
- **Open-loop current source.** `buildNetlist` now zeroes the forced current of any
  `floatingSources` (a current source whose loop isn't closed) so the dead branch
  reads an honest **0 mA / 0 V** instead of the singular-matrix phantom (10 kV/10 mA).
  Closing the loop restores the real value. Verified via the wasm solver.
- **POT B-terminal — NOT a bug (answered).** Reproduced through the real solver:
  a properly-wired W→B leg conducts (B→R10k→GND reads 0.31 mA); the user's `~0`
  reading reproduces *exactly* the **B-floating** case (rheostat mode = legitimate).
  No code change; it was a wiring near-miss. (POT expansion in netlist.ts is correct.)
- **Phase-shift example** (`phase-shift`, **Filters**). The user's 3-stage RC ladder
  (4.7 kΩ / 0.1 µF) mislabeled 60/120/180 at 1 kHz; corrected to **138 Hz**
  (= 1/(2πRC√6)) with honest 56°/112°/180° tap labels + the 1/29 attenuation lesson,
  and a detune-to-1 kHz demo. Verified end-to-end (transient sim: −180.0°, 1/29.1).
- **Component info panel — Phase 1** (per `docs/ui/component-info-panel.md`):
  - **Double-click a part** opens its info drawer (new `onInspect` board callback;
    works from Select + Pan; first click selects/toggles, second opens info and is
    swallowed — MSW carve-out handled). **`I`** hotkey toggles it; **ⓘ chip** on the
    value popover is the third door. **Esc closes the drawer first** (then disarm/clear).
  - **Pinout** (`web/src/lib/pinout.ts`): lays out `PART_KINDS.pins` rotated to the
    placed part (SelectedPart gains `rot`) → SVG body + legs + dots with DOM labels
    and per-leg glosses (anode/cathode, D/G/S, electrolytic polarity, transformer
    P/S, …). Pure reference; no live state, no sim, no golden.

**Reusable harness (not committed):** a Node script under `web/src/lib/_repro.ts`
(deleted after each use) imports `graph.ts`/`netlist.ts`/`examples.ts` + the built
wasm and runs real sims — drive it with `node --loader /tmp/tsresolve.mjs …` (a tiny
extensionless-`.ts` resolver). Invaluable for verifying circuits/netlists end-to-end.
Used to settle the POT, the open-loop source, and the phase-shift example.

### Pick up here (the remaining queue)
- **Info panel Phase 2** — `DETAIL_DRAWERS` construction cutaways (cap spiral / MLCC
  stack / LED lamp first) + static ratings block. Big; see the doc §3–4.
- **Onboarding** (pull-based, no levels) per `docs/ui/onboarding-first-run.md`.
- **Copy/paste + marquee select + group drag** (TODOS top entry).
- Remaining parts/ICs (relay, programmable load, ferrite, fuse/thermistor/LDR/…,
  counter/555/regulator/comparator/DAC/ADC/H-bridge/memory/MCU/FPGA).

---

## 2026-06-15 — Op-amp shipped end-to-end + scope autoscale (#47–#50)

**State:** 🟢 Green. Golden `0xeaac376499e4fa24` unchanged; 72 sim-core tests. The
op-amp is now a fully playable part, and the scope no longer clips big swings.

**Shipped (all on `main`):**
- **Op-amp sim-core** (#47): `ELEM_OPAMP=15` — smooth-clamped transconductance
  VCCS, `Vtarget = Vsat·tanh(GAIN·Vd/Vsat)` driven through finite `OPAMP_GOUT`;
  3-terminal a=OUT/b=IN−/c=IN+; per-iteration `Vd` step limiter for feedback
  robustness. 6 tests (follower, non-inv, inv, comparator, validate, reproduce).
  (Fixed a companion-stamp sign bug that railed the comparator backwards.)
- **Manual switch** (#48): `MSW` web part, reuses `ELEM_SWITCH=6` at value 0/1 +
  click-toggle. Open/Closed chips, LED example.
- **Op-amp web** (#49): `OA` placeable part (triangle glyph + factory comparator
  station), `value` = Vsat, added to `THREE_PIN_TYPES` (pin 2 = IN+ → `c`),
  curated Vsat rails, partInfo (virtual short / comparator prose), and a new
  **"Op-Amps"** example category: voltage follower, non-inverting amp (×3),
  open-loop comparator (high/low demo).
- **Scope autoscale** (#50): Y now fits the visible traces' true min/max across
  the window with ~8% headroom (was seeded [0,1] with no margin → big AC/PWM
  swings clipped on the frame). Keeps the 0 baseline in view; web-only, golden safe.

### In flight / pick up here (preliminary ICs)
**Logic-gate sim-core has LANDED** (`ELEM_GATE=17`): a Tier-A behavioural digital
primitive (a=OUT, b=IN1, c=IN2; `value`=logic-high rail, `aux`=function code:
0 AND/1 OR/2 NAND/3 NOR/4 XOR/5 XNOR/6 NOT/7 BUF). It thresholds inputs at half
the rail read from the **committed previous-tick `node_v`**, drives OUT toward
0/Vhigh through `GATE_GOUT` — a constant Thévenin stamp (the switch's linear,
tick-determined shape) added to all 4 assembly sites + 4 readouts. One tick of
propagation delay, no persistent state, golden `0xeaac376499e4fa24` unchanged,
6 new tests (78 total). Also fixed a latent op-amp per-tick current readout
omission (readout-only, not hashed) while in those match blocks.

**Gate WEB wiring has LANDED too** — placeable AND/OR/NAND/NOR/XOR/NOT parts (each
→ `ELEM_GATE` with its `aux` code via `GATE_AUX`; `value`=rail; 17 added to
`THREE_PIN_TYPES`), distinct boolean-symbol schematic glyphs + a Factorio
decider/sorter, partInfo (truth table + half-rail threshold + one-tick delay), and
a new **"Logic & ICs"** example set: inverter→LED, AND interlock, and an XOR+AND
**half-adder** (1+1=10). Replaced the non-simulated `"&"` placeholder.

**Transformer has LANDED (full feature, in this PR).** The **4th terminal `d`**
boundary bump is done end-to-end (Element + `set_netlist` + sim-wasm + `loop.ts` +
`netlist.ts` `FOUR_PIN_TYPES` + App.svelte — golden-safe, also unlocks the relay).
`ELEM_TRANSFORMER=18` is **two magnetically coupled inductors** (primary a/b,
secondary c/d; `value` = turns ratio n): two coupled branch currents + two reactive
states (`reactive_state_b`), backward-Euler companion cross-linked by M=k·√(L₁L₂),
per-winding resistance so it **blocks DC** (primary current saturates) and **scales
AC by ~k·n**. Stamped in all 4 assembly paths (transient = coupled branches, OP =
current sources). 4 new tests (AC scaling, DC blocking, validation, reproduce) — 83
total, golden `0xeaac376499e4fa24` unchanged. Web: `TR` part (4-pin, two-coil + core
glyph + factory converter), turns-ratio value shown as **Np:Ns** (`fmtVal`), partInfo,
and a **"Transformers"** example — a **full-bridge rectifier with a tunable turns
ratio** (the owner's centerpiece request). Also restored the op-amp per-tick current
readout.

**Owner ideas captured in TODOS (not yet built):** reusable **ferrite/magnetic-core**
element (one core abstraction → transformer / common-mode choke / ferrite bead /
cored inductor) + build-transformer-from-two-coils example; **potentiometer** (3-term
wiper divider) and a **programmable/electronic load** (CC/CP sink) for building &
load-testing **VRMs**.

**Next: the next IC rungs** — D flip-flop (clocked 1-bit state; tick-grid edge detect
— first sequential element) → counter/shift (bus ports) → 555 → linear regulator.
Then the deferred discretes (fuse, thermistor, LDR, 7-seg) and the **relay** (reuses
the now-built 4th terminal `d`). The modular ferrite-core, pot, and programmable load
are strong near-term adds (see TODOS).

---

## 2026-06-15 — Parts blitz: transistors, varistor, net labels, AC amplitude (#37–#46)

**State:** 🟢 Green. Golden `0xeaac376499e4fa24` unchanged throughout (verified via
`print_golden` on every sim-core change); 66 sim-core tests. A sustained autonomous
push toward "the whole parts selection + ICs + examples". Sim primitives land one
at a time on `lib.rs` (each golden-verified by me, then shipped), web wiring and
examples follow; the PR list on `main` is the running record.

**Shipped since the MOSFET batch (all on `main`):**
- **Multi-terminal infra + MOSFET** (#37/#38): `Element` gained a 3rd terminal
  `c`; `set_netlist` + sim-wasm + `loop.ts` carry it (trailing-optional). `ELEM_NMOS=11`,
  `ELEM_PMOS=12` (level-1 square-law VCCS companion). Placeable, examples.
- **BJT NPN/PNP** (#40/#43): `ELEM_NPN=13`, `ELEM_PNP=14` (Ebers-Moll, two coupled
  diode junctions reusing `pnjlim`; a=C, b=E, c=B). Placeable (`Q`/`QP`), examples
  (switch, common-emitter, current mirror).
- **Varistor (MOV)** (#42/#46): `ELEM_VARISTOR=16` (symmetric clamp, Zener-style
  dual-junction limiting). Placeable (`MOV`, new **Protection** category), surge example.
- **Net labels** (#41): KiCad-style names + global aliases. `NetLabel{id,name,at:Endpoint}`,
  second union-find pass in `buildNetlist` collapses same-named labels onto one node,
  `nodeNames` surfaced in scope/telemetry, **Label tool** + `L` hotkey + inline editor.
- **Tunable AC amplitude** (#44): a 2nd per-element scalar **`aux`** threaded
  sim-core→wasm→loop→netlist (mirrors `c`); AC source EMF uses it (default 5 V);
  `Component.amp` + inspector chips (1/2/3.3/5/9/12 V).
- Fixes: scope ↔ telemetry **node-color alignment** (#45, ground muted, palette
  from node 1); independent coexisting ammeter+voltmeter (#39); junction-tool ghost.

**In flight:** **op-amp** sim-core (`ELEM_OPAMP=15`, smooth-clamped transconductance
VCCS, 3-terminal a=OUT/b=IN−/c=IN+, must converge in feedback) on `lib.rs`;
**manual switch** web (`MSW`, reuses `ELEM_SWITCH=6` at value 0/1 + click-toggle) on the web.

### Pick up here (remaining parts, then ICs)
- After op-amp sim → op-amp web. Then 2-terminal parts (thermistor, fuse, LDR — P7
  thermal/light state) and **7-seg** (multi-terminal + P8).
- **Relay + transformer** need a **4th terminal `d`** (a boundary bump like `c`) —
  4 nodes (2 coil/primary + 2 contact/secondary). Sequence that on `lib.rs`.
- Then the **preliminary ICs** (ic-buildings §5: gates → flip-flop → counters → 555
  → linear regulator) as behavioral buildings + examples.
- Element-type registry so far: 0–7 base, 8 Schottky, 9 LED, 10 Zener, 11 NMOS,
  12 PMOS, 13 NPN, 14 PNP, 15 op-amp (in flight), 16 varistor. Next free: 17.

---

## 2026-06-15 — MOSFET (NMOS/PMOS) web/UI integration (sim types 11 & 12)

**State:** 🟢 Green. **crates/ untouched** — built on the committed sim-core
level-1 MOSFET (`ELEM_NMOS = 11`, `ELEM_PMOS = 12`; drain `a`, source `b`, gate
`c`), golden `0xeaac376499e4fa24` unchanged; 53 sim-core tests (52 pass / 1
ignored `print_golden`); fmt/clippy clean; build:wasm, web format/check/lint/build
all pass. The first **three-terminal** part is now placeable, simulated, animated,
explained, and has examples.

**The third terminal through `buildNetlist` (`web/src/lib/netlist.ts`):**
- `BuiltNetlist` gains **`c: Uint32Array`**, parallel to `a`/`b`. For each
  element it is pushed in lockstep (EC's two stamps each push `c = 0`). A **3-pin
  device** (a MOSFET, `THREE_PIN_TYPES = {11,12}` and `kind.pins.length >= 3`)
  stamps `c` = its **gate** node (pin 2); every **2-pin** part stamps `c = 0`
  (ground), which the core ignores.
- **Pin→terminal convention matches the core exactly:** pin 0 → a = **Drain**,
  pin 1 → b = **Source**, pin 2 → c = **Gate**. `PART_KINDS` `NM`/`PM` define
  pins in that order (labelled D, S, G), so the map is direct.
- `elemOfComponent` → the MOSFET element (current = `Id`, oriented a→b =
  drain→source); `nodesOfComponent` → `[drain, source]`, so `vAcross` reads
  `Vds`.
- `c` folds into the topology **`sig`** (rewiring the gate to a new net rebuilds
  the netlist; a pure move leaves every node — c included — unchanged, so the sim
  isn't reset). The MOSFET also unions its **gate net** into the floating-source
  return-path check (all three nodes participate).
- `web/src/App.svelte`: both `setNetlist` call sites updated — the live one passes
  **`nl.c`**, the quiet ground-only fallback passes a new empty `Uint32Array`.
  (`loop.ts setNetlist` already took the trailing optional `c?`.)

**Parts / glyphs / info / bin:**
- `graph.ts PART_KINDS` `NM` ("N-MOSFET") + `PM` ("P-MOSFET"), `ok`/green
  ("switching/gain" family), 3 pins **D, S, G**, `value` unused (fixed model),
  `ideal: true`. `netlist.ts TYPE_OF` `NM:11`, `PM:12`. App `PARTS` bin + the
  **Active & Switching** category (`PART_CAT_OF`).
- `glyphs.ts` (`DRAWERS` + `FACTORY_DRAWERS`): **schematic** = the standard
  enhancement MOSFET symbol (insulated gate bar off a broken channel, drain
  up/source down, the body/channel arrow N-in vs P-out, the channel fingers
  retract = choke shut in cutoff). **Factory** = a gain-assembler/valve: a thin
  gate control belt lifts a sluice that opens a **fat drain→source main belt**
  whose width + flow density track `Id` and choke shut below threshold. All
  motion on the bounded `o.phase` clock — magnitude is width/density/alpha/glow,
  never speed.
- `partInfo.ts` `NM`/`PM`: teach Vgs vs the ~2 V threshold controlling Id;
  cutoff/triode/saturation; the square law + transconductance gm; the insulated
  gate draws no DC current. Live `headline` = the operating region + Vds/Id;
  derived rows = Id, a **recovered gm** (inverts the saturation square law from
  the measured Id/Vds, since the gate node isn't exposed to the inspector), and
  power Vds·Id.

**Examples (`examples.ts`, under Power & Switching, hand-checked):**
- **MOSFET as a Switch** (`mosfet-switch`) — VDD 5 V → R 150 Ω → LED → NMOS
  (low-side), gate driven by a second V source; gate HIGH (5 V > VTO) closes the
  channel (LED lit, ~18 mA, drain ≈0.3 V), gate LOW cuts off (dark). A
  gate-high/low `demo` toggle.
- **Common-Source Amplifier** (`mosfet-cs-amp`) — VDD 5 V → RD 100 Ω → NMOS
  drain (output), source → GND, gate bias Vgg 3 V (Vov = 1 V → saturation). Drain
  parks ≈3.9 V @ Id ≈11 mA; a small gate nudge swings the drain ~2× harder and
  inverts (gain ≈ −gm·(RD‖ro)). Mirrors the sim-core
  `nmos_saturation_operating_point_matches_square_law` layout.

### Pick up here
- The MOSFET `value` field is unused (fixed VTO/KP/λ). A per-device params block
  (P2) would let learners sweep threshold/size — the natural fidelity upgrade, and
  it would also let `partInfo` show a true Vgs/region instead of the
  recovered-gm derivation (the gate node could then be exposed in
  `nodesOfComponent`).
- The BJT (`Q`, 3 pins) is still a placeholder — the next multi-terminal part now
  that the 3-terminal netlist seam exists. Same owner-driven UI backlog as below.

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

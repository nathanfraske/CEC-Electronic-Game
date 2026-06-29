<!-- SPDX-License-Identifier: Apache-2.0 -->

# Heat on the board — representing it & managing it (ideation)

Status: ideation (no code). The thermal system brainstorm: how to SHOW heat on the board and how to get
the player to MANAGE it. Companion to `docs/ic-package-density-ideation.md` (which proposed "power
density → heat" as the marquee package tradeoff) and `docs/game-rewards.md` (magic smoke / autopsy / risk
tiers / the realism multiplier).

## Framing

Heat is the natural next teaching axis because it falls out of quantities the game **already computes for
free**: every element exposes `V across` + `I through` render-side (`elemOfComponent`/`nodesOfComponent`
in `netlist.ts`, read each frame as `ElectricalState`), so per-part dissipation `P = V·I` is available
*today* — the info panel already prints "Power dissipated V·I" (`partInfo.ts`). The codebase is unusually
well-prepared:

- **`Component.temp`** already exists (`graph.ts`) — a per-part body temperature in °C, currently the
  thermistor's inspector knob, explicitly documented as "Prep for a future self-heating model: this same
  field would then be sim-driven."
- **The thermistor R(T) curves** (`thermistor.ts`) are factored into one place so "a future SIM-SIDE
  temperature model (self-heating from I²R) can reuse the exact same curves." `temp` rides into `values`
  and rebuilds the sim via the value signature — *no sim-core change, golden-safe*.
- **The rated-current → FAIL model** (`RATED_CURRENT_SLOT = 2`, read in `Sim::flag_and_clamp_fails`)
  already flags a part when `|I| > rated`, the renderer boxes it (`failBox`/`failText`), and
  **`failed_elements` is not in `snapshot_hash`** — flagging never moves the golden. Heat-as-derating
  slots straight into this proven pattern.
- **The lens system** (`BoardLens = "schematic" | "analogy" | "reality"`) is the precedent for a
  thermal-camera toggle.
- **The economy** (`game-rewards.md`) already names the beats: **magic smoke**, **autopsy → refund**,
  **risk-tier contracts**, the **realism multiplier**. Self-heating / runaway / `Tj` is already listed as
  the intended-but-deferred depth — this brainstorm is that work.

**Core tension:** voltage owns *identity colour + a magnitude channel* (LED bar / standpipe) on nets;
current owns *flow + thickness + number* on conductors. Heat must be a **third, non-colliding channel**:
a **warm-end emissive property of the part BODY** (not the wires) + an **opt-in thermal lens** — leaving
the voltage/current encodings on conductors/nets untouched.

## 1. Representing heat on the board (the visual language)

Heat's free real estate is the **part body's emissive fill** and a **dedicated lens**. (One collision to
avoid: power-flow already uses warm-orange dots on the *wire* — so keep heat off the wires entirely; heat
is a property of the **device**, not the trace, which is also physically honest.)

| Option | Reads as | Distinct from V/I? | Distinct from FAIL? | Code hook | Cost |
| --- | --- | --- | --- | --- | --- |
| **A. Body heat-tint/glow** | incandescence on the device | ✅ body fill, warm ramp ≠ rail hues | ✅ fill vs box outline | emissive pass on `tierGlyph`/`glyph` in `ComponentNode` | Low |
| **B. Thermal-camera lens** | full-board ironbow heatmap | ✅ replaces the V/I view (mutually exclusive) | ✅ different mode | new `"thermal"` in `BoardLens`, `setLens`/`effLens` | Med |
| **C. °C readout + thermal scope** | the exact number + the RC warm/cool curve | ✅ its own meter/scope | ✅ a number, not a state | reuse `meter` Text; a scope beside the time-scope | Low–Med |
| **D. Hotspot halo / wisps** | radiated heat, convection | ✅ behind-body bloom | ✅ glow ≠ box | additive Graphics on the `FLOW_HZ` clock | Low |
| **E. Magic-smoke vent** | the part dying | ✅ one-shot event | ⚠️ *intentionally* sibling to FAIL (charred/destroyed, not boxed) | vent animation + destroyed state | Med |
| **F. Ambient board warming** | hot zones / poor airflow | ✅ background wash | ✅ ambient ≠ per-part | global/region tint behind the board | Med |

- **A — body emissive ramp.** Starts *invisible* at ambient (~25 °C, so a cold board is unchanged), warms
  through bronze → amber (`--warn`) → red (`--bad`) → near-white at the rating ceiling. Heat literally
  looks like incandescence — the strongest pre-attentive "hot" cue. Reads as a **fill/glow**, orthogonal
  to the FAIL **box outline**.
- **B — thermal lens.** A fourth lens: desaturate the board (drop rail hues + chevrons), paint every part
  by `temp` on an ironbow/inferno palette, hottest parts bloom. The "see the whole power budget" view —
  a linear regulator glowing white next to a cool switcher tells the entire lesson at a glance. Hooks
  where `setLens`/`effLens` already branch. Mutually exclusive with the other lenses.
- **C — number + scope.** The glow names "hot," the number carries the value (the visual-language doc's
  "you can't read 12.0 V vs 11.7 V from a hue" discipline applies to heat too). The thermal scope shows
  the **time-constant** — a part warming on its RC-like curve, cooling when load drops.
- **D — halos/wisps.** Soft radial bloom on the bounded `FLOW_HZ` clock + faint upward wisps above the
  hottest parts. Subtle convective shimmer, not fire.
- **E — magic-smoke vent.** The terminal beat: a puff of smoke, a crack (audio wishlist), the body chars
  and is destroyed. Distinct from the over-current FAIL box: over-current FAIL = "you violated physics
  now, fix the topology" (recoverable, clears when fixed); thermal vent = "you cooked it over time, it's
  gone" (destroyed, costs Credits, eligible for autopsy → Lux).
- **F — ambient warming.** A faint global/region warm wash when dissipation is high — feeds the
  "spacing parts out" lever.

**The pre-attentive cue split (key UX decision):** *getting hot* = the body **fills** with a warm glow
(continuous, ramps over seconds); *failed (over-current)* = the existing **red box + FAIL pulse**
(instant on/off); *cooked to death* = a **one-shot smoke + char + destroyed marker** (terminal).

## 2. The heat model (teachable + fair)

A first-order lumped thermal model — the standard datasheet abstraction, which is exactly what the game
wants to teach:

- **Steady-state:** `Tj = Tambient + P · θ_JA` (`P = V·I`, `θ_JA` = thermal resistance to ambient, °C/W).
  This single equation is the derating lesson, and `θ_JA` is what a heatsink lowers.
- **Transient (the time-constant):** parts don't heat instantly. With thermal mass `Cth`, `Tj` relaxes
  toward its target with `τ = θ_JA · Cth`: `Tj ← Tj + (Tj_target − Tj)·(Δt/τ)` each frame (the same RC
  shape the game already teaches with caps). Makes **duty-cycling** matter and gives cool-down.
- **Derating (the lesson):** as `Tj` rises the **effective current rating shrinks**:
  `rated_eff = rated_nominal · derate(Tj)`. Feed `rated_eff` into `RATED_CURRENT_SLOT` (Real mode) and the
  **existing `flag_and_clamp_fails` boxes the part sooner the hotter it gets** — *zero new sim-core
  mechanism*. (This is exactly the density brainstorm's "power density → heat → derate.")
- **Thermal runaway (advanced):** for BJTs/power parts, dissipation rises with temperature → positive
  feedback. Model a `Tj`-dependent bump to leakage/β (or an accelerating `Tj_target`) so past a tipping
  point `Tj` diverges and the part vents — the canonical "why power transistors need heatsinks/ballasting"
  lesson.
  > **DONE (Path 2, golden-safe — handoffs 235/236).** Shipped as a per-tick `Tj`-in-the-solve loop on a
  > new `TEMPCO_SLOT` (=7), gated so the golden folds zero bytes ⇒ byte-identical. A **resistor** reads the
  > slot as a linear tempco `α` (`resistor_r_eff = value·(1+α·(Tj−25))` — an NTC runs away, a PTC
  > self-limits); a **BJT** reads it as the saturation-current tempco `γ` (`Is(T) = BJT_IS·exp(γ·(Tj−25))`,
  > capped) — at a fixed base bias `Ic` climbs with `Tj` → `Vce·Ic`↑ → runaway, and an **emitter ballast
  > resistor tames it** (textbook). Both ride the one `step()` `Tj` advance (from committed `P = |V·I|`) and
  > the one hash-fold; the web emits the tempco on NTC/PTC and Q/QP **Real-mode-only**. The MOV/power-part
  > "diverges and vents" is delivered by the climbing power driving the web's presentational `Tj` past
  > `T_MAX`. (Future: per-kind sim-core `θ` to match the web's per-kind `θ_JA`; today sim-core uses one
  > fixed `THERMAL_THETA`.)

**Connections to what exists:** `Component.temp` becomes the live junction temperature (sim-driven, as its
doc foresaw); the **thermistor R(T)** closes its loop (an NTC's `temp` driven by its own I²R self-heating
— the cleanest self-heating demo: an inrush limiter that warms and drops its R); the rating/FAIL model
consumes the derated rating unchanged.

**Where it lives (determinism decision):**
- **Path 1 — web-side accumulation (recommended for v1).** Integrate `Tj` per part in the JS loop from the
  per-frame `P = V·I`, write it back into `Component.temp`; it rides into `values` and rebuilds the sim
  through the value signature — **byte-identical to the thermistor-knob path, zero sim-core change, golden
  untouched**. The derated rating goes into `RATED_CURRENT_SLOT` (Real mode), like today's static rating.
- **Path 2 — sim-core hashed `Tj` state (later).** A true `temp_state` vector advanced inside the solve
  gives sub-tick fidelity + tight runaway feedback, but **moves the golden** (additive, Real-mode-gated,
  regenerated golden + rationale). Defer until the web model proves the gameplay.

## 3. Getting the player to manage heat (the gameplay — the heart)

| Lever | The real lesson | Code hook | Sim-touching? |
| --- | --- | --- | --- |
| **Heatsink** (placeable/attachable) | θ_JA ↓ → cooler `Tj` at the same P; *why heatsinks exist* | a part that lowers the target's `θ_JA` in the web model | No (web model → `temp` rides the value path) |
| **Forced cooling (fan)** | active cooling lowers ambient/θ | a fan part lowering ambient/local θ for nearby parts | No |
| **Spread parts out / board area** | mutual heating; *why dense ≠ free* | distance-weighted ambient between parts | No |
| **Higher-rated / higher-tier part** | datasheet literacy | `Component.tier`/`variant` (e.g. **power** diode) → bigger rating + lower θ | Existing (rating slot, Real mode) |
| **Pick the right package** | the density tradeoff — denser runs hotter | `UserIc.package` density scalar → higher θ_JA | No (derates via rating slot) |
| **Lower-power topology (switcher vs linear reg)** | **the marquee lesson** — a linear reg burns `(Vin−Vout)·I` as heat | falls out of `P=V·I` automatically — *no special-casing* | No (emergent) |
| **Duty-cycling** | average power + the thermal time-constant | the `PULSE` duty (slot 3) already exists; τ makes bursts survivable | No (emergent) |
| **Bigger power resistor** | *why power resistors are physically big* | a wattage/size axis on resistors → higher Pmax, lower θ | No |
| **Series/parallel sharing** | split dissipation | emergent from topology | No |
| **Copper pour / thermal vias (later)** | PCB as a heatsink | a board attribute lowering θ | No |

The standout: **the linear-vs-switcher lesson needs zero special code** — both are built from the same
primitives; the linear one simply has `(Vin−Vout)·I` of dissipation and the thermal model heats it. The
game teaches by simulating honestly ("the simulator is the only judge").

**Failure consequences (escalating):** (1) **drift → spec fail** (hot parts shift; a `3.30 V ± 2%`
contract fails once a part heats and drifts — no smoke, just a missed target); (2) **derated performance**
(the rating shrinks; a part fine cold gets boxed by the FAIL mask once hot); (3) **thermal runaway**
(`Tj` diverges); (4) **magic smoke / destroyed part** (vents, chars, costs Credits, earns autopsy → Lux).

**Teaching moments for free:** why power resistors are big; why heatsinks/fans exist; why linear regs
waste power as heat (and why switchers win); BJT thermal runaway; junction-temp derating curves; the
density tradeoff; self-heating thermistors/inrush limiters.

## 4. The gameplay loop / objectives

Heat as a first-class **contract dimension**, riding the existing contract/spec-grader spine:
- **Thermal budget per contract** — "keep every part under 85 °C while delivering 2 W" — machine-checkable
  off the deterministic replay by sampling each part's `temp` (a new spec-line type, not a new judge).
- **Thermal challenges** — a "survive the heat" contract class beside "survive (load transient)"; the
  CEC-Certified capstone extends to "holds spec across a temperature sweep" (the economy already names a
  **temperature-sweep bench service**).
- **Thermal-FAIL distinct from over-current-FAIL** — two surfaces, two lessons.
- **Heat as a realism-mode risk** — thermal non-idealities bite **only in Real mode** (the established
  gate); Real pays a higher multiplier *and* introduces thermal death (a gamble, not a free upgrade; slots
  into risk-tier contracts).
- **The thermal readout/scope + camera lens** as unlockable **instruments** ("a new way to see what's
  real," never a numeric boost).

## 5. Determinism & integration — what touches what

- **Pure presentation:** body glow, halos, wisps, the thermal lens, the vent animation, the °C readout,
  the thermal scope. Read snapshots, mutate Pixi.
- **Web-side game-state (deterministic via the value path):** `Tj` integrated in the JS loop from per-frame
  `P=V·I`, written into `Component.temp`, rebuilding the sim through the **value signature** — the
  identical mechanism the thermistor knob uses, so no golden change. The derated rating goes into
  `RATED_CURRENT_SLOT` (Real mode). **Caveat:** feeding `temp` back into `values` makes the sim stateful
  across frames; the `Tj` integrator must be **strictly tick-driven** (fixed Δt, same native==wasm float
  math), never wall-clock — treat `Tj` like the deterministic flow phase. This is the one hazard; get it
  right and it's as safe as the thermistor path.
- **Sim-core (Path 2 only, later):** a hashed `temp_state` moves the golden → additive, Real-mode-gated,
  regenerated golden + rationale. Defer.

**Safest path:** keep `Tj` accumulation **web-side**, route every sim consequence through (a) the **R(T)
value path** and (b) the **`RATED_CURRENT_SLOT` flag** — both already golden-safe (`failed_elements` is
unhashed; the rating only flags, never alters the solve). Full lesson — heating, derating, drift, magic
smoke — **without touching sim-core or the golden**, exactly as the rating/FAIL and tier systems do.

## 6. Phased build path

> **STATUS 2026-06-28 — the model + pipeline (Phase 0/1 core) LANDED** (`web/src/lib/thermal.ts`,
> commit `f8bfb51`, web-only, golden-safe, headless-tested). What's built: the lumped model
> (`thermalSpec` per-kind `θ_JA`/`Cth`, `steadyTemp`, the TICK-DRIVEN transient integrator `stepTemp`
> with a clamped step factor so it's unconditionally stable, `derate`, `glowFactor`), `dissipatedPower`
> = `max(0, V·I)`, and `advanceTemps` (integrate every part one sim-time interval, Real-mode-gated).
> Proven end-to-end by `thermalPipeline.test.ts` (buildNetlist → wasm → `electricalMap` → `Tj`: a 1 W
> resistor heats to ~105 °C, a 10 kΩ one and the source stay cool, Ideal = ambient).
>
> **Determinism refinement (learned building it):** the loop steps a *wall-clock-dependent* number of
> ticks per frame, so `Tj` must be integrated by the **sim-tick delta** (`Δticks·DT`), never wall-clock
> — then it's steady-state-exact and a pure function of the sim trajectory. A consequence that **doesn't
> perturb the solve** (over-temp / derated-rating → FAIL flag; the body glow) is replay-safe even
> web-side. A consequence that **does** (R(T) drift, thermal runaway) applied at frame granularity would
> make the sim frame-rate-dependent → it needs the **sim-core hashed-`Tj`** (Path 2, per-tick) to be
> replay-exact. So v1 keeps `Tj` purely presentational + the FAIL-flag consequence; R(T) feedback is
> deferred to Path 2. (This sharpens §2's "self-heating thermistor closes its R(T) loop" — that loop is
> Path 2, not the v1 web path.)
>
> **UPDATE 2026-06-29 — the LIVE vertical + the thermal lens LANDED** (`79accf5` + `4fc0080`, web 326,
> verified live). Per-part **heat-glow** (A) + **°C readout** (C): each `board.ts` `ComponentNode` owns
> `tj`, integrates it from its own `dissipatedPower` by the sim-tick delta, draws the warm halo; the
> inspector shows a "Body temp" row from `Board.bodyTempOf`. And the **thermal lens** (B) — a full-board
> **inferno heat-field overlay** (`thermalField.ts`: held-temp sources, explicit 5-point diffusion,
> still-air convection, inferno colourmap; `board.ts` `"thermal"` `BoardLens` + canvas-texture sprite +
> `updateHeatOverlay`, board dimmed, components distinct; `App.svelte` 🔥 Heat toggle). All
> golden-safe/presentational. **Remaining:** Phase 2 = copper-weighted diffusion (heat follows traces) +
> a °C colour-scale legend; the derate→FAIL/vent consequence; Path 2 (sim-core hashed Tj).
>
> **UPDATE 2026-06-29 — Phase 2 copper conduction LANDED** (web 327, verified live). The owner's ask:
> heat now **follows the traces/copper**, and the per-part glow halo is **suppressed under the lens**
> (colour contrast only). `thermalField.ts` `step(sources, dt, copper?)` takes a per-cell copper
> fraction; face conductance `= SUBSTRATE_W + (1−SUBSTRATE_W)·min(ci,cj)` (`SUBSTRATE_W = 0.02`) so a
> copper↔copper face conducts fully and bare board barely conducts — heat races down a trace and stalls
> at the substrate gap (retuned `DIFFUSIVITY 30→55`, `CONVECTION 0.45→0.25`, `L ≈ 14.8 cells`).
> `board.ts` `buildCopperGrid` rasterises part footprints (`ComponentNode.worldBox`) + each wire's
> `routeForWire` polyline (one-cell-dilated) into the field grid (per-frame, lens-active only);
> `ComponentNode.update` clears `heatGlow` when `lens === "thermal"`. Still golden-safe/presentational.
> **Remaining:** the °C colour-scale legend; derate→FAIL/vent; Path 2 (sim-core hashed Tj).
>
> **UPDATE 2026-06-29 — Phase 2b legend + the derate→FAIL consequence (#116) LANDED** (web 328, verified
> live). The **°C legend** (§1's "show the whole power budget"): a HUD side strip (`App.svelte`
> `.thermal-legend`, `{#if thermalLens && realModels}`) — a vertical inferno gradient (shared from
> `thermalField.ts` `infernoCssGradient()`, single source of truth with the canvas colormap) + mono ticks
> (ambient → the live scale top) + a live PEAK read, fed by `board.ts` `heatReadout(): {peakC, scaleTopC}`.
> And the **consequence** (§2/§6 step 2, the first half): a web-side `overTemp = real && tj >= T_MAX_C`
> flag on each `ComponentNode` → a **distinct OVERHEAT box** (charred fill + pulsing amber + label,
> separate from the red over-current FAIL, shown only when not also FAILed) + the inspector "Body temp"
> row goes red with "⚠ OVERHEAT". Heat is now a *consequence*, not just a readout. Golden-safe + replay-
> safe (presentational flag, never re-enters the solve — `failed_elements` was never hashed; Tj is the
> sim-tick-advanced power). **Remaining:** the thermal-death *vent* (animated smoke + autopsy→Lux);
> the management levers (§3 — heatsinks/fan/spacing/wattage axis); Path 2 (sim-core hashed Tj).
>
> **UPDATE 2026-06-29 — the thermal-death VENT (E) LANDED** (web-only, golden-safe, verified live). Past
> **sustained** over-temp (`ventHeat ≥ VENT_SECONDS = 1.6 s` of sim-time, accumulated by the sim-tick
> delta so it's replay-safe; a brief spike recovers), a part **vents** — the magic smoke escapes: a steady
> **charred "DESTROYED" box** + rising **smoke puffs** (`board.ts` `ComponentNode.drawSmoke`), latched for
> the run (`vented`), distinct from the transient pulsing OVERHEAT warning. So heat now has the full
> escalation: glow → OVERHEAT (cooking) → DESTROYED (cooked). The sim keeps solving (presentational only).
> Plus a **noise** companion refinement — an inspector **"Noise (RMS)"** readout (the std of a resistor's
> V-across over a window) makes the Johnson fuzz measurable. **Remaining:** autopsy→Lux hook; the
> management levers (§3); Path 2 (hashed Tj for R(T) drift / runaway).
>
> **UPDATE 2026-06-29 — the first MANAGEMENT LEVER (§3): a per-part HEATSINK** (web-only, golden-safe,
> verified live). `Component.heatsink` (0 none / 1 / 2 large) → a θ_JA multiplier (`heatsinkFactor`,
> `[1, 0.4, 0.18]`) in `stepTemp`'s `thetaScale`, so a cooled part runs cooler for the same power. An
> inspector picker (`partConfig`, Real-mode + heating kinds); `board.setComponentHeatsink` sets it with no
> netlist rebuild (the live node reads `component.heatsink` each frame → Tj re-stabilises, no reset);
> persists for free. Heat now has the full design loop: a 4 Ω resistor that **vents at ~525 °C** is
> **saved at ~109 °C** by a Large sink. **Remaining levers:** fan (ambient↓), part-spacing mutual heating,
> the wattage axis; then Path 2 (hashed Tj).
>
> **UPDATE 2026-06-29 — PATH 2 (per-tick `Tj`-in-the-solve) + THERMAL RUNAWAY LANDED** (sim-core, golden
> byte-identical by the param-gate; verified live). The first time `Tj` feeds **back into the deterministic
> solve** (not just presentation): `thermal_state[i]` is advanced each tick from the committed power
> `P=|V·I|`, gated on `has_thermal` and folded into `snapshot_hash` per tempco element (zero bytes / golden
> untouched when none). A resistor's effective resistance tracks it — `resistor_r_eff = value·(1 + α·(Tj −
> 25))` (clamped) in the 4 **transient** stamps (the OP keeps `value`). The web emits `α` Real-mode-only for
> **NTC** (`−0.05` → if it dominates the loop, **runaway**: heat ⇒ R↓ ⇒ V²/R↑ ⇒ hotter ⇒ OVERHEAT/vent) and
> **PTC** (`+0.03` → self-limits — the resettable-fuse effect). Replay-exact (`Tj` is a pure function of the
> committed trajectory); `pub element_temperature(i)` exposes it. Verified live: an NTC ran away (R 100 Ω→2 Ω
> clamp, OVERHEAT) and a badly-overloaded **12 V MOV** cooked → **DESTROYED** (every dissipating kind already
> self-heats web-side; only this R(T) **loop** is the new sim-core piece). **Next:** BJT `Is(T)` runaway on
> the same infra; R(T) drift for ordinary resistors; a MOV joule/energy rating.

0. ~~**Read-only heat.**~~ DONE — model + `P=V·I` → `Tj` (`thermal.ts`) + live glow + °C readout.
1. ~~**Thermal lens + the time-constant.**~~ DONE — the tick-driven integrator (`advanceTemps` / per-node
   `stepTemp`), wired into the live loop, the `"thermal"` `BoardLens` + inferno board heat-field overlay.
   Remaining sub-items: the thermal **scope** (a warm/cool curve over time) + the **legend**.
2. **Derating → FAIL + magic smoke.** Wire `Tj` into a derated `RATED_CURRENT_SLOT` (Real mode) so the FAIL
   box triggers sooner when hot; add the thermal-death vent (E) as a destroyed state distinct from the
   over-current box; hook autopsy → Lux. Heat becomes a *consequence*.
3. **The management levers.** Heatsinks (θ↓), fan (ambient↓), part-spacing mutual heating, the wattage axis
   on resistors / package-density on ICs; tie tier/variant to θ + ratings. The gameplay payoff.
4. **Contracts + runaway + sim-core (optional).** Thermal contract spec-lines, the CEC-Certified
   temperature sweep, BJT thermal runaway, and — only if fidelity demands — the hashed sim-core `Tj` state.

## Recommendation

**Build heat as a warm-end EMISSIVE property of the part BODY plus an opt-in THERMAL LENS, with `Tj`
accumulated WEB-SIDE and every sim consequence routed through the existing R(T) value path and the
`RATED_CURRENT_SLOT` → FAIL flag.**

Rationale: (1) it slots into proven, golden-safe machinery (the rating→FAIL model, the thermistor R(T)
value path, the lens system, and `Component.temp` were each built — and the thermistor explicitly
documented — to receive exactly this); (2) it doesn't collide with the visual language (voltage keeps
identity-hue + magnitude on nets, current keeps flow + thickness on conductors, heat takes the untouched
body emissive channel + a dedicated lens, reading as incandescence); (3) it teaches by honest simulation
(linear regs waste heat, denser runs hotter, heatsinks lower θ, BJTs run away — all emergent from `P=V·I`
+ the thermal model, not special-cased rules); (4) it's the deferred work, now ready — Phases 0–2 deliver
the marquee beats (heat → derate → vent) without a single sim-core line or golden regeneration.

**Get right:** (1) keep the `Tj` integrator strictly **tick-driven** so the value-signature rebuild stays
replay-safe (the one determinism hazard); (2) make the **thermal vent visually sibling-but-distinct** from
the over-current FAIL box (filled char/smoke vs pulsing outline); (3) gate **all** non-idealities to
**Real mode** so Ideal stays nominal and the golden/economy guardrails hold.

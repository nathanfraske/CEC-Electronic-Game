<!-- SPDX-License-Identifier: Apache-2.0 -->

# Bench-realism instruments & the EMI/EMC estimator kernel

> **What this is.** The design for the *bench-realism* instrument suite — **heat (Tj)**,
> the **reality lens**, **parasitics**, and the **EMI/EMC emissions-estimator kernel** — and
> the player-facing teaching that makes those invisible phenomena *readable*. It is a
> **planning document**: game-design / UX + **web-side** only. **Nothing here touches
> `crates/sim-core`, the netlist emission, `Element::params`, or `snapshot_hash`.** The
> instruments **read** the existing solve.
>
> **Why it matters.** The EMI kernel is the **single externally-blocked dependency** in
> `docs/implementation-plan.md`: the product-sim **EMI cert gate PS3b (item F5)** ships a
> typed stub returning `'unavailable'` until the kernel's three web modules
> (`geometry.ts` / `coupling.ts` / `spectrum.ts`) land. **This document designs that
> kernel** and so unblocks PS3b.

**Read first:** `docs/invisible-electronics-ideation.md` (the EMI/EMC estimator + the lens
family + the Phase-0/1 plan), `docs/heat-on-the-board-ideation.md` (Tj),
`docs/ui/reality-lens-and-junctions.md` (the reality lens),
`docs/ui/high-frequency-render.md` + `docs/ui/frequency-morph.md` (the two frequency regimes),
`docs/game-product-simulation.md` + `docs/game-product-sim-failure-modes.md` (the EMI/UL cert
gates that **consume** this kernel), `docs/implementation-plan.md` (PS3b / F5, the blocked item).

---

## 0. Thesis & relationship to the rest of the game

**Thesis.** A schematic lies — *a wire is 0 Ω, a part is its symbol, nothing gets hot, nothing
radiates.* The bench-realism suite is the set of **instruments that make the lie visible and
then teach the truth.** It operationalizes the *invisible-electronics / heat / reality*
ideation (`docs/invisible-electronics-ideation.md`, `docs/heat-on-the-board-ideation.md`,
`docs/ui/reality-lens-and-junctions.md`) into four composable **lenses over the one solve we
already have** — heat, reality, parasitics, EMI — and it **unblocks the product-sim EMI gate
PS3b/F5** by designing the emissions estimator the gate stubs on.

The load-bearing design move, stated once up front and repeated where it bites:

> **EMI (and heat, and parasitics) is NOT new physics in `sim-core`.** It is
> **presentation + integer geometry multiplied onto the *unhashed analytic AC currents*** the
> engine already produces, read against a **piecewise-constant CISPR/FCC limit line**. The
> whole suite is **golden-safe by construction**: golden `0xeaac_3764_99e4_fa24` stays
> **byte-identical** through the entire build, *including the gate flip*.

**The unblock, precisely.** `docs/implementation-plan.md` lists exactly one externally-blocked
item:

> *"PS3b (EMI gate) is the **only** item blocked outside this web-side plan — on the
> invisible-electronics kernel (`coupling.ts`/`spectrum.ts`/`geometry.ts`), confirmed absent
> today … a typed stub returns `'unavailable'` … as a fast-follow until the kernel lands."*

This document **is** that kernel's design. Landing `geometry.ts` + `coupling.ts` +
`spectrum.ts` flips the typed `unavailable` stub to a live **[emiChamber]** gate, and the same
three modules later gate **PS5**'s true-geometry creepage. Everything else in the PS lane
(report card, funded quality, protection, UL, reputation, recalls) already ships **around** the
block.

**Where it sits in the curriculum.** The four lenses ladder by **cognitive cost**, and that
ladder *is* the teaching arc:

| Lens | What it reveals | Cognitive cost | Lands |
| --- | --- | --- | --- |
| **Heat** | a part dissipating `P = V·I`, glowing | primal (incandescence — no theory) | earliest, pure sandbox |
| **Reality** | copper, solder, vias — the physical object | low (a costume change) | next |
| **Parasitics** | the hidden R/L/C of every part (a cap *is* an inductor up high) | medium (needs the frequency picker) | with the AC curriculum |
| **EMI** | a fast loop is a tiny radio, vs a compliance line | high (needs frequency **and** geometry) | **last — the Era-6 "Design Rules" capstone** |

**Two parts, one document** (per the owner): **PART I** is *how to build it* — the heat/Tj
instrument, the reality lens, parasitics, and the EMI kernel. **PART II** is *the player-facing
teaching* — the lenses as **show-don't-tell**, **pull-not-pick** discovery tools that ease a
five-year-old and an EE into the same widget at different depths. The two parts share one
estimator and one determinism guarantee.

---

## 1. The instrument suite overview — four lenses, one system

The four lenses are not four features bolted on; they are **one continuum** built on top of the
existing solve and the existing **`BoardLens`** mechanism (`schematic | analogy | reality`,
to be extended with `thermal`/`emi` overlays). They compose as a **pull-not-pick stack**: the *base* lenses
(`schematic` / `analogy` / `reality`) are mutually-exclusive **worlds** selected by `setLens`;
the *overlay* lenses (`thermal` / `emi` / `return` / `rf`) each **desaturate the board** (drop
rail hues + carrier chevrons) and **paint exactly one story at full strength.** Reality is the
**frame** the overlays paint onto.

### 1.1 The non-colliding channel map (the binding invariant)

Each physical quantity owns **one** visual channel, and the lenses must never fight over a
channel. This is the invariant the whole suite obeys (it is the `docs/ui/visual-language.md`
ownership map, extended):

| Quantity | Channel it owns | Where it lives | Lens |
| --- | --- | --- | --- |
| **Voltage** | identity **hue** + a magnitude **bar/standpipe** | on the **net** | all |
| **Current** | **chevron flow** + thickness + number | on the **conductor** (fill) | all |
| **Heat** | **emissive** ramp (bronze→amber→red→white) | on the **part body** | thermal |
| **Coupling / EMI** | the **gaps** between conductors + a **victim-fuzz envelope** | the cell margin, *not* the conductor | emi |
| **Reality / parasitics** | conductor **material** restyle + the part **growing its hidden elements** | the conductor + the part body | reality |

The rule that keeps four channels legible: **heat owns the body, voltage owns the net, current
owns the conductor fill, coupling owns the gaps.** Reality and parasitics add **no new
channel** — they restyle the conductor *material* and *grow* the part's hidden elements, so they
collide with nothing. Heat **never touches the wire** (power-flow already uses warm-orange dots
on the wire — keep heat off the trace, which is also physically honest: heat is a property of the
*device*).

### 1.2 Everything reads the same solve

| Instrument | Reads (all unhashed) | New `sim-core`? |
| --- | --- | --- |
| **Heat (Tj)** | the once-per-frame `electricalMap` `P = V·I` per part → a **web Tj integrator** → `Component.temp` | **No** |
| **Reality lens** | the once-per-frame snapshot; emits Pixi draw calls only | **No** (render-only) |
| **Parasitics** | the analytic `acMeasurements` / `acSweep` / `acElementMeasurements` (already stamped in `ac_solve_models`) | **No** (reads existing stamps) |
| **EMI kernel** | `acMeasurements` + `elementCurrents` + integer `Wire.waypoints` geometry + a net classifier | **No** — three new **web** modules |

The single most important consequence: **one number means everything.** The Tj the player
watches glow on the bench is the *same* `Component.temp` that drives the UL over-temp verdict
and the fleet Arrhenius wave. The EMI margin the compliance bar shows is the *same* scalar the
**[emiChamber]** gate reduces to a PASS/FAIL. Bench preview and cert verdict **can never
disagree**, because there is one source of truth.

---

# PART I — HOW TO BUILD IT

---

## 2. BUILD — the EMI/EMC estimator kernel (the unblock)

This is the externally-blocked deliverable. It is **three new web-side modules** over the
existing analytic AC solve. No `sim-core` change; golden byte-identical.

### 2.1 The estimator equation — the teachable spine

A small current loop carrying a high-frequency harmonic is a **magnetic-loop antenna**. The
estimator is the textbook small-loop radiator, **game-scaled**:

```
emission_dBuV(f) = 20 · log10( K · loopAreaCells · I_harmonic(f) · f² )
```

| Term | Meaning | Which module | The fix-it lever it teaches |
| --- | --- | --- | --- |
| `loopAreaCells` | enclosed area of the forward+return current loop, in **integer grid cells** | `geometry.ts` | **halve the loop → −6 dB** |
| `I_harmonic(f)` | the harmonic current at `f` (analytic, from the AC sweep) | `coupling.ts` ← `acMeasurements` | **slow the edge → high harmonics roll off** |
| `f²` | a loop antenna's emission rises with frequency squared | `coupling.ts` | (why the *fast* clock is the culprit) |
| `K` | a single game-scale constant collapsing geometry units + free-space terms | `data/balance.ts` (deferred) | — |

**The whole point of writing it this way:** every fix-it lever maps to **one term**, so the gate
teaches the **relationship**, never a certifiable absolute. The four canonical levers:

| Lever | Term it moves | Effect |
| --- | --- | --- |
| Tighten / halve the loop | `loopAreaCells` | **−6 dB** broadband |
| Slow the clock edge | `I_harmonic(f)` envelope | high harmonics roll off (`f²` weights them most) |
| Add a ferrite bead | series-L in `I_harmonic(f)` | **≈ −4 dB** on the high bars |
| Spread-spectrum the clock | redistributes `I_harmonic` | the **tallest bar splits** → peak **−4..−6 dB** |

> **Honesty rule.** The estimator is an **order-of-magnitude teaching model**, not a certifiable
> field strength. The UI never claims dBµV/m absolute compliance; it teaches *"this loop, at this
> frequency, vs a line — and here is the one knob that moves it."*

### 2.2 Why it MUST route through the analytic AC path (the frequency-regime rule)

This is the load-bearing reason the kernel is golden-safe and physically right at once.

| Regime | Tool | Ceiling | Used by EMI? |
| --- | --- | --- | --- |
| **Transient** (time domain) | the fixed-step solve, `DT = 2 µs` | **aliases above ~62.5 kHz** | **No** |
| **Frequency** (analytic) | `ac_solve` / `ac_sweep` → Bode, `phaseScope.ts` | **Nyquist-free** — MHz–GHz | **Yes** |

Emissions live **kHz–GHz**, *far* above the transient alias ceiling. The kernel therefore
**must** consume the **analytic, Nyquist-free** `ac_sweep` path — never the aliasing transient
solve. That keeps it **entirely off the hashed time-domain solve**, which is *why* it cannot
move the golden.

### 2.3 `geometry.ts` (NEW) — integer loop-area

```
web/src/lib/geometry.ts   — confirmed ABSENT today
```

- **Input:** `Wire.waypoints` (the manual routing cells — `graph.ts`) + pin/component grid
  cells. Walk the **forward + return** cycle for each net-pair / loop.
- **Method:** integer **shoelace** over grid cells.
- **Discipline — non-negotiable:** **integer-in / integer-out, no floats from geometry, no
  hashing.** This makes it **bit-identical across machines** (the same discipline
  `docs/game-ground-returns.md` already commits to).
- **Output:** deterministic integer scalars per net-pair / per-loop —
  `loopAreaCells`, `proximity`, `parallelLen`, `enclosedPins`.
- **Bonus:** the same module unblocks **PS5** true-creepage reliability (geometry is geometry).

### 2.4 `coupling.ts` (NEW) — the estimator family

```
web/src/lib/coupling.ts   — confirmed ABSENT today
```

The gate-facing term is `emission(loop)` above. Built as a **family** so later coupling
phenomena are thin configs of the same plumbing:

| Function | Teaches | Phase |
| --- | --- | --- |
| `emission(loop)` | radiated emissions (the **gate**) | the unblock |
| `crosstalk(victim ← aggressor)` | a fast net corrupting a quiet neighbour | later |
| `conducted(victim)` | noise riding the power rail | later |
| `leakage(node)` | high-impedance node pickup | later |

**Reads** (never writes):

- `geometry.ts` (loop area, proximity, parallel length),
- `acMeasurements` — `[Vamp, Iamp, phase, |Z|]` per element (per-frame, `loop.ts:36/121`),
  giving slew `dV/dt ≈ Vamp·ω`, `dI/dt ≈ Iamp·ω`,
- `acSweep(freqs, real)` — the harmonic spectrum as **node voltages** (re/im per non-ground
  node, `loop.ts:98/207`); per-element harmonic **current** is `Y·ΔV` — either `acElementMeasurements`
  looped per harmonic, or derived web-side as `Y·ΔV` over these node voltages,
- `elementCurrents` — signed, snapshot-only (`loop.ts:117`),
- a **net classifier** (Digital = aggressor / Analog = victim).

> **Boundary correction (do not skip).** The engine computes a **NetClass**
> (Analog / Digital / Boundary) in `sim-core`, but it **does NOT cross the `loop.ts` boundary
> today** (verified — no match). So it is **not** the zero-cost "already-crossing" input some
> earlier notes implied. Two golden-safe options:
> 1. **Surface NetClass** through `loop.ts` as a new **snapshot field** (a new *read* of an
>    unhashed classification — golden-safe, but real plumbing), or
> 2. **v1: derive** aggressor/victim **web-side** from `acMeasurements` **slew ranking** and
>    defer the NetClass crossing.
>
> Recommend **(2) for v1** — it keeps the gate fully web-side with zero new boundary work.

### 2.5 `spectrum.ts` (NEW) — the dBµV analyser

```
web/src/lib/spectrum.ts   — confirmed ABSENT today
```

A **Canvas2D dBµV-vs-log-f bar chart + a CISPR/FCC piecewise-constant limit line**, modelled on
`bode.ts` and `phaseScope.ts` — the **same flat draw-buffer + log-f axis + dB-label shape**.
Bars over the line glow `--bad`; the **worst bar pulses**. Pure presentation.

> **Reuse, don't reinvent.** `bode.ts` already draws a flat `[re, im]`-per-freq buffer against a
> log-f axis with dB labels. `spectrum.ts` is that panel with **bars + a limit line** as the only
> delta. Model it on `bode.ts`/`phaseScope.ts`; do not invent a new instrument idiom.

### 2.6 The limit line — a **contract data field**, not a difficulty picker

```
CISPR-B ≈ 40 dBµV  @ 30–230 MHz,   47 dBµV  @ 230 MHz–1 GHz   (game-scaled)
FCC-A   ≈ the looser sibling
```

The cert **class** (CISPR-B vs FCC-A) is a **CONTRACT DATA FIELD** keyed off the customer spec
— **NOT** a difficulty slider the player turns. A medical contract carries the strict line; a
shop-floor widget carries the loose one. (Open question 8.5: stepped vs interpolated at the
230 MHz break; peak vs quasi-peak detector — recommend **peak-only, game-scaled**.)

### 2.7 The gate reducer — the **[emiChamber]** call

```
margin   = min over harmonics ( limit_line(f) − emission_dBuV(f) )
worstAt  = the harmonic f where that min occurs
verdict  = sign(margin)        // PASS if margin ≥ 0
```

- **No PRNG.** Deterministic: same design → same verdict (which is why re-running an unchanged
  design is *free* — it cannot change).
- `margin` also drives the reliability coupling:

  ```
  lifeMultiplier = clamp( 0.6 .. 1.0,  0.6 + 0.4 · (emiMargin_dB / 10) )
  ```

  taken **worse-of** with the UL over-temp thin-pass (**no double-jeopardy** — see §3.7), not
  multiplied. This couples the EMI cert into the **fleet reliability roll**
  (`docs/game-product-simulation.md` §3).

### 2.8 Build order (golden byte-identical through B4)

| Step | Module / work | Golden moves? |
| --- | --- | --- |
| **B0** | Heat read-only (§3) — ships today | **No** |
| **B1** | Reality lens (§3.9) | **No** (render-only) |
| **B2** | EMI skeleton — `geometry.ts` + `coupling.ts` + return-path highlight | **No** |
| **B3** | `spectrum.ts` panel + limit line + the emi-lens cue family | **No** |
| **B4** | **Flip the PS3b stub → live `[emiChamber]`** | **No** |
| **B5** *(later)* | mutual-C/L crosstalk stamp in `ac_solve_models` (AC-only, unhashed) | **No** — transient golden still untouched |

> Note **B5 is NOT the gate dependency.** The gate (B4) is fully web-side. B5 is a future
> *physics-fidelity* refinement of crosstalk; even it leaves the **transient golden** untouched
> because it lives in the AC-only, unhashed path.

---

## 3. BUILD — the heat (Tj) + reality / parasitics instruments

### 3.1 Heat — promoting "a glow" to a calibrated bench meter

`docs/heat-on-the-board-ideation.md` already specs heat; this section promotes Tj from a glow to
an **instrument** with a defined read chain, three depths, and **one** deterministic output
(`Component.temp`) that fans out to four downstream consumers **without ever forking the model**.

**The read chain (web-side, per-frame):**

1. **Read** `P = V·I` per part off the once-per-frame batched `electricalMap`
   (`elemOfComponent` / `nodesOfComponent` give V-across + I-through; `partInfo.ts` already
   prints *"Power dissipated V·I"*). **No new boundary crossing.** A multi-element kind sums `P`
   over its slots.
2. **Integrate** a junction temperature (the instrument's core, web-side):

   ```
   Tj_target = Tambient + P · θ_JA                 // steady target, per-kind θ_JA (°C/W)
   Tj       ← Tj + (Tj_target − Tj) · (Δt / τ)     // transient relax, τ = θ_JA · Cth
   ```

   Same RC shape the caps already teach — makes duty-cycling survivable. A heatsink/fan lowers
   `θ_JA` web-side.
3. **Write back** `Tj → Component.temp` (the field **already exists**, `graph.ts:81`, doc'd as
   *"prep for a future self-heating model"*). `Component.temp` rides into `values` via the
   **value signature** and rebuilds the sim **byte-identically to the thermistor knob path** —
   zero `sim-core` change.

> **THE ONE HAZARD — read this twice.** The Tj integrator makes the sim **stateful across
> frames.** It **MUST be strictly tick-driven**: fixed `Δt` derived from the sim tick,
> *identical native == wasm float math*, **never wall-clock**, and the display value must
> **never feed back into the solve.** Treat Tj exactly like the deterministic flow phase. Get
> this wrong and the value-signature rebuild desyncs and replays diverge. This is the same
> caveat the thermistor model already carries (`docs/heat-on-the-board-ideation.md` §5). **Pin
> it with a vitest** (Tj reproducibility across a fixed replay).
>
> **The thermistor exception (why the golden stays byte-identical).** Tj is written to a
> **separate display field**, **never** back into a thermistor's `temp` R(T) input — the thermistor
> is the *only* kind where `Component.temp` enters the netlist (`netlist.ts` ~line 1218, via
> `thermistorResistance`) and would change **hashed** node voltages. The thermistor's `temp` knob
> stays the **user input**; Tj reaches the solve only through the **flag-only**
> `RATED_CURRENT_SLOT` derate (§3.3), which never alters node voltages.

### 3.2 Tj is the **master derating input** — four consumers, one number

```
                 ┌─► BENCH FAIL  (derated RATED_CURRENT_SLOT → flag_and_clamp_fails)
 Component.temp ──┼─► UL OVER-TEMP gate  (max Tj vs per-part ceiling)
   (one number)   ├─► FLEET FIT  (Arrhenius accel_T + the s_T stress ratio)
                 └─► ELECTROLYTIC WEAR-OUT  (the 10 °C-halves-life integral)
```

Because every consumer reads the **same** `Component.temp`, the bench glow, the cert verdict, and
the fleet RMA wave **can never disagree** — the player learns *one* number that means everything.

### 3.3 Derating → bench FAIL

```
rated_eff = rated_nominal · derate(Tj)   →   RATED_CURRENT_SLOT (= 2),  Real mode only
```

`flag_and_clamp_fails` boxes the part **sooner the hotter it gets**. `failed_elements` is **NOT
in `snapshot_hash`** (verified: `lib.rs:2481` — *"the rating only flags (`failed_elements` is not
hashed), so neither the solve nor the snapshot hash is affected"*), so it
only **flags**, never alters the solve. Zero new sim mechanism — reuse the proven
**rating → FAIL** pattern (the `RATED_CURRENT_SLOT` precedent, `lib.rs:2452/6803`).

### 3.4 UL over-temp gate (ships **ahead** of the EMI gate)

```
verdict = sign( ceiling − maxTj )         // electrolytic 105 °C, generic 125 °C
```

(`docs/game-product-simulation.md` §2.2 check 1.) **No EMI dependency** — UL ships **PS3a**,
ahead of the FCC gate. Lever: *"add a heatsink / derate / switch to a buck."* No PRNG.

### 3.5 Fleet FIT coupling (Arrhenius)

```
accel_T(Tj) = 2 ^ ((Tj − 55) / 20)        // rate doubles every 20 °C (game-scale of Ea ≈ 0.7 eV)
s_T         = Tj / junction-ceiling        // one of three stress ratios
FIT_part    = FIT_base · accel_s(s_worst) · accel_T(Tj)
```

Tj reads straight from `Component.temp`. **Heat is the master derating input** tying bench
thermal to fleet fate (`docs/game-product-simulation.md` §3).

### 3.6 Electrolytic wear-out (the "why electrolytics are the thing that dies" lesson)

```
L    = L_rated · 2 ^ ((T_rated − Tj) / 10)        // 10 °C halves life
wear = life_hours_in_field / L                     // wear ≥ 1 → a CERTAIN wear-out death
```

Worked: a 105 °C / 2000 h cap at **Tj = 85 °C** → `L = 8000 h ≈ 0.9 yr` → a 5-yr / 50 %-duty
contract → `wear = 2.7` → **dies ~year 2.** This is a **certainty** (a guaranteed year-N RMA
spike), not a Poisson tail — exact and teachable (`docs/game-product-simulation.md` §3 Step 4).

### 3.7 No-double-jeopardy coupling (UL ↔ EMI)

A thin UL over-temp margin raises the *same* Arrhenius acceleration the fleet model uses. When
both the UL thin-pass **and** the EMI thin-pass would scale `lifeMultiplier`, take the
**WORSE-OF**, **not the product** (`docs/game-product-simulation.md` §2.4). Owner confirms the
clamp band once both gates emit real margins (open question 8.4).

### 3.8 Runaway (advanced, web-side, optional)

A Tj-dependent kicker to leakage/β (or an accelerating `Tj_target`) above a knee, so Tj diverges
past a tipping point → the part vents. The canonical *"why power transistors need heatsinks"*
lesson. Still web-side via the value path. **Recommend** a web-side kicker for the teaching beat;
**defer** any hashed `sim-core` `temp_state` (Path 2) entirely (open question 8.4).

### 3.9 The reality lens (render-only — B1)

Already specced in `docs/ui/reality-lens-and-junctions.md`. The reality lens is the **physical
frame** onto which heat glow and EMI arcs paint, so a coupling arc reads as *a real board
misbehaving*, not an abstract graph. Reuse the existing layered-stroke machinery in
`boardRender.ts:drawConduitSkin`. First cut = **3 paints**:

| Paint | What it draws | Where |
| --- | --- | --- |
| **trace STRAP** | square caps + soldermask-rim wall stroke + one-edge etched-copper sheen | `drawConduitSkin` |
| **solder DOME junction** | convex hub + offset bright crescent + white speck | `drawJunctionConduit` |
| **pin-contact solder FILLET** | copper pad to `pinOutward` + warm-grey fillet + speck | the `ends` pin-end cap |

> **Already threaded:** `drawJunctionConduit` already takes `lens: BoardLens = "analogy"`
> (`boardRender.ts`), as does `drawConduitSkin`, and both callers (`board.ts drawJunctions`,
> `userIcInternalsView.ts`) already forward the live lens — so the reality re-skin is wired.
> Both the die-editor and the sealed-IC replica inherit it for free via the shared `this`-free
> `boardRender.ts` core.

**Shared truths preserved** across analogy/reality: electron-drift carriers (same path +
direction), `voltageColor` rail identity on the opaque core, magnitude on the LED bar (reality) /
standpipe (analogy) — **never on speed.**

### 3.10 Parasitics (AC-only, **read-only** — already stamped)

No new sim work — surface the **existing** `ac_solve_models(omega, real)` parasitics, read via
`acElementMeasurements` / `acSweep`:

| Part | Real-model parasitic | Visible effect |
| --- | --- | --- |
| **Cap** | ESR (series R) + ESL (series L) → `Z = ESR + jωL + 1/jωC` | V-shaped \|Z\|, **self-resonant** `SRF = 1/(2π√(LC))` — *"your 100 nF decoupler is an inductor above 8 MHz"* |
| **Inductor** | winding C (parallel) + series R | a parallel resonance |
| **Resistor / trace** | `R_ESL = 10 nH` lead inductance → `Y = 1/(R + jωL)` | the `ωL` term only swings phase when R is tiny — **invisible on 10 kΩ, ~+32° on a 10 mΩ SHUNT at 100 kHz** (hence the shunt part) |

The **SHUNT is the anchor failure demo:** `L·dI/dt` adds to `I·R`, so a current-sense shunt
**reads the wrong current** at high `dI/dt`.

### 3.11 The frequency morph — parasitics as render (`docs/ui/frequency-morph.md`)

Per part a morph factor `m = smoothstep(f_srf/k, f_srf·k, f_apparent)`, reusing the shimmer's
`apparentRateScale` so it is **tickrate-coupled and rewinds with the clock**. The drawer blends
ideal → equivalent on `m`:

- **SPROUT** — the part grows its hidden coil/ESR block,
- **FLIP** past `m ≈ 0.5` — a cap's plates crossfade into a coil (the headline *"your decoupler
  is an inductor above 8 MHz"*),
- **GLOW-BY-CONTRIBUTION** — the parasitic brightens in proportion to its impedance share
  (`ωL` vs R).

Shows on the **schematic symbol** (cleanest for the flip) **and** the **reality detail-drawers**
(parasitic as physical origin: ESR = foil/electrolyte resistance, ESL = the literal leads,
Cw = between winding turns).

> **Honesty rule (do not violate).** Build the **computed** morph (it renders the **Real**
> model, so the multimeter *confirms* the picture — the shunt reading diverges). The
> **depicted** preview toggle may ship first as a clearly-marked teaser, but **never claim the
> meter agrees** with a depicted-only morph.

### 3.12 The bridge — parasitic L → loop inductance → EMI

The **same** parasitic L that makes a cap go inductive at 8 MHz is the **same** lead/loop L that,
summed around the loop (`geometry.ts`), sets the radiated-emission spectrum. So the reality lens
*literally draws the copper that holds the L that sets the loop area that drives the spectrum.*
That is why, by the time a player meets `spectrum.ts`, it is just *"that part's parasitic, summed
over the loop I can see in reality view, vs a line."*

---

# PART II — PLAYER-FACING: teaching the invisible

---

## 4. Easing the player in

The suite teaches the invisible **only if the instruments are pulled, not pushed.** The binding
rules:

### 4.1 Pull-not-pick (the binding rule)

- The lenses (`thermal` / `reality` / `emi` / `return` / `rf`) are **always available**, **never
  auto-forced**, **never a modal or a level-gate.** Each desaturates the board and paints **one
  story** at full strength.
- The compliance bar + heat glow live **passively** in the bench HUD. The full `spectrum.ts`
  panel and the ranked fix-it report open **only on a pull** (a lens toggle or the
  make-100 / emiChamber offer chip).
- **A cert FAIL blocks ONLY the SHIP / production-run offer — never the sandbox.** The bench
  always supersedes (`docs/game-product-simulation.md` §5: *"the production run is an OFFER the
  bench always supersedes — never a gate"*). A pure tinkerer climbs the whole tree on **Lux /
  understanding alone** and need never pull a single instrument.

> **Erosion risk (hold the line).** A designer under pressure may want to *auto-open* the
> spectrum panel on an EMI FAIL to "make sure they see it." That turns a pull into a push.
> **Don't.** The reveal is a dismissible Probe chip + a passive bar; the full panel opens only on
> a pull; the chip self-mutes under `[explainAsYouGo]`.

### 4.2 Show → name → number (the Probe narration contract)

The player is **never told about EMI**. They pull the `emi` lens and **SEE** a fast trace
radiating into a quiet neighbour. Three lines per first-encounter, in the Probe's
retro-robotic, blameless register (*"that was MY oops"* — `docs/game-product-simulation.md`
§5.2):

| Beat | What it does | Example |
| --- | --- | --- |
| **SHOW** | a wordless pre-attentive cue already on screen + a soft pointer to one part/loop | the glow blooms / the red bar pokes the line |
| **NAME** | the phenomenon in plain voice, tied to its Lab Book page | *"that's your board SHOUTING on the radio"* / *"this corner is COOKING"* |
| **NUMBER** | the EE read **attached to an action**, never abstract | *"84 MHz, 6 dB over — tighten the loop or slow the edge"* |

Every line names a **cause AND a fix** and points at **exactly one** part/loop. Captioned DOM
text in the retro-robotic TTS; respects `prefers-reduced-motion` + the sensitive-child guard (a
calm single state change, no particle storm).

### 4.3 Win first, the invisible after

First encounter is a **win first** (the SHIP-IT beat); the invisible is **offered after**:
*"want to see why this came back from EMI testing?"* — exactly the SHIP-IT → make-100-chip
framing (`docs/game-product-simulation.md` §5.1). The lens is the **answer**, pulled not pushed.
The Probe **owns the oops** (*"that was MY oops"*) so the reveal reads **private/diagnostic, never
public shaming.**

### 4.4 The first-encounter lens moments (one per phenomenon, fire-once)

| Phenomenon | Trigger | First-encounter |
| --- | --- | --- |
| **Heat** | the web Tj integrator (`Component.temp`) first crosses a **warm knee** (~`--warn` onset) | a one-time Probe line + a Lab Book page; the body glow is already ramping |
| **EMI** | `coupling.ts` `emission(loop)` first **pokes a harmonic over** `limit_line(f)` in any emi-lens frame, **or** the first emiChamber preview | *"your board is shouting on the radio at 84 MHz"* |
| **Reality** | **no phenomenon trigger** — it is a costume toggle; the "first encounter" is the **lens-pull itself** | — |

Each trigger sets a **persisted seen-flag** (web/save state only — *never* in the hash) so it
never re-fires, and is **gated to Real mode** (Ideal ships nominal, so nothing triggers).

> **Spam guard.** Rate-limit to **one** first-encounter reveal per beat; queue the rest; stage
> by the heat → reality → EMI arc so two cannot land simultaneously. Gate EMI's trigger behind
> the make-100 / emiChamber pull so it fires only when the player has opted into product-realism.

### 4.5 All-ages: by-feel vs EE-numeric — one widget, three depths

Each instrument exposes the **same data** at three **self-selected** depths (reuse the fleet-grid
dual-form `[by-feel + numeric]` renderer, `docs/game-product-simulation.md` §5.3):

| Depth | Heat | EMI |
| --- | --- | --- |
| **by-feel** | the **incandescence ramp** (invisible → bronze → amber → red → white) + hold-to-highlight "hottest" | a single **compliance BAR** (green→amber→red, worst-harmonic margin) + the **loop wash** on the board |
| **named** | *"running hot / derating"* | *"over the line at 84 MHz"* |
| **numeric** | the **°C readout** + the thermal-RC scope + the derated `RATED_CURRENT_SLOT` headroom | the full `spectrum.ts` **dBµV-vs-log-f** panel + limit line + the ranked fix-it report |

**The by-feel read is structurally default-prominent;** the numeric **promotes only** when the
player edits a number or pulls deeper. A five-year-old reads the glow / the red bar; an EE reads
the dBµV. Coaching scales with distance (§4.8): a `−6 dB` bust earns the full ranked report; a
`−1.4 dB` squeak earns one named move.

> **Regression to avoid.** Never show dBµV/°C *before* the by-feel glow/bar — that re-imposes the
> theory wall. The by-feel read is default-prominent; the number promotes on a deeper pull or a
> number-edit (the same precedence as the fleet grid).

### 4.6 Easing into the dBµV spectrum analyser — three scaffolds

So `spectrum.ts` needs **no theory wall**:

1. **It looks like the Bode they already met** — same dark palette, log-f axis, dB vocabulary as
   `bode.ts` / `phaseScope.ts`. It reads as *"another scope."*
2. **The limit line IS the UI** — pass/fail is **pre-attentive**: bars under the line are calm,
   bars over glow `--bad` and the worst **pulses.** You don't read dBµV — you read *"the red bar
   pokes over."*
3. **The fix-it report names ONE lever in dB, attached to an action** —
   *"BZZT — you're lighting up the 84 MHz band, 6 dB over; that fast clock with the big loop is a
   tiny radio transmitter. **Tighten the loop or slow the edge.**"*

### 4.7 The disturbance-cue family (the by-feel board layer)

Coupling owns **the gaps**, never the conductor fill or the net hue
(`docs/invisible-electronics-ideation.md` §2c). The family reuses the **chevron-flow** vocabulary
on non-wire edges and the **IR-drop `--warn` wash** precedent:

| Cue | Reads as | Where |
| --- | --- | --- |
| **coupling filament / arc** | energy jumping a gap | between conductors |
| **victim-fuzz envelope** | *"this should be flat but isn't"* | on the victim net |
| **loop / area wash** | the enclosed loop (amber→red hatched fill) | the enclosed loop |
| **radiation halo** | RF-teal glow | the **one region no channel paints** — the cell margin |

The **board cue says WHERE**; the **spectrum number says HOW MUCH vs the line** — same data, two
zoom levels.

### 4.8 Coaching scales with distance (legible-not-punishing)

| Margin | Coaching |
| --- | --- |
| a real bust (e.g. **−6 dB**) | the full **ranked** fix-it report |
| a near-pass squeak (**−2 dB ≤ margin < 0**) | **one** named move — a single gentle nudge |

This is the **desirable-difficulty** band (`docs/game-product-simulation.md` line 146): legible,
never punishing.

### 4.9 The Lab Book tie-in

Each phenomenon (heat / reality / EMI) is a **Lab Book codex page** that pays **one-time Lux** on
first discovery via the existing autopsy → Lux flip (`docs/game-product-simulation.md` §5.4).
Heat / EMI / reality become **discoverable codex phenomena**, not tutorials — met in
cognitive-cost order (incandescence first, the radio capstone last) — so a pure tinkerer climbs
the whole tree on understanding alone.

### 4.10 The field-outcome reveal (the deepest beat — bench → fleet)

The **same Tj** the player watched glow on the bench returns as the **RMA story**: *"your
electrolytic ran at 85 °C, so it dies in year 2 fleet-wide."* One number (Tj), learned on the
bench, determines the cert verdict **and** the field-failure wave. The deepest teaching moment in
the rail — and still legible-not-punishing (a near-pass UL over-temp gets a single gentle nudge,
not the full report).

### 4.11 Thermal smoke / magic-smoke vent (the terminal beat)

Two **sibling-but-distinct** failure surfaces, two lessons:

| | Over-current FAIL | Thermal vent |
| --- | --- | --- |
| Cue | filled-box outline **pulse** | one-shot **smoke + char + destroyed** marker |
| Meaning | *"you violated physics now — fix topology"* | *"you cooked it over time — it's gone"* |
| Recoverable? | yes (clears when fixed) | no (costs Credits; eligible for **autopsy → Lux**) |

**Wire `prefers-reduced-motion` + the sensitive-child guard on the vent from the start** — the
thermal-death beat is the most intense visual in the rail. **Calm single state change; meaning
lives in the DOM text + the bar; the Probe is rueful, not frightening.**

### 4.12 The teaching arc across the bench rail

Stage the first-encounters by cognitive cost so heat (primal incandescence, no theory) lands
earliest, reality (a costume change — *same circuit, real board*) next, EMI (needs the frequency
domain **and** loop geometry) **last, as the Era-6 "Design Rules" capstone**
(`docs/invisible-electronics-ideation.md` §1). The same data reads at three depths off one
widget: **by-feel** (the red bar) / **named** (the 84 MHz band) / **numeric** (6.2 dB over).
**Sandbox-primary throughout:** a cert FAIL blocks only the SHIP offer, never the bench; a pure
tinkerer climbs on Lux alone.

---

## 5. Reuse vs new surface

### 5.1 REUSE (verified present)

| Asset | Used for |
| --- | --- |
| `loop.ts` boundary: `acMeasurements` (:36/:121), `acSweep` (:98/:207), `acElementMeasurements` (:104/:208), `elementCurrents` (:117), `failedMask` (:31/:120) | **the kernel needs NO new per-component boundary crossing** — the boundary stays coarse |
| `Wire.waypoints` + the `Cell` lattice + pin/component cells (`graph.ts:349`) | integer geometry for free — no new persisted field for v1 **(cosmetic-only per `graph.ts:351-353` — see §8.1 sufficiency risk)** |
| `bode.ts` / `phaseScope.ts` | the exact template + palette + log-f axis + dB vocab for `spectrum.ts` |
| `Component.temp` (`graph.ts:81`, doc'd as the self-heating receiver) | the Tj write-back target |
| the **thermistor value-signature path** (`thermistor.ts`, factored to one place for reuse) | Tj rides this exact mechanism, golden-safe |
| `RATED_CURRENT_SLOT` (= 2) + `flag_and_clamp_fails` + `failBox`/`failText` (unhashed) | the derated rating slots straight in |
| `setLens` + `effLens` + the `conduit !== null` / `TIER_ZOOM` guard | the lens-select + zoom-gate machinery the overlays extend |
| the reliability FIT chain (`s_T`, `accel_T`, the wear-out integral) | Tj plugs in as the master input — no new model |
| the meter `Text` (°C readout) + the time-scope pattern (the thermal scope) | the numeric heat depth |
| the SHIP-IT → make-100 offer chip + the autopsy → Lux flip + the fleet-grid dual-form renderer | the win-first framing, the codex payout, the three-depth read |
| the `boardRender.ts:drawConduitSkin` 4-stroke machinery + the shared `this`-free core | the reality re-skin (sealed-IC replica inherits for free) |

> Three modules (`geometry.ts` / `coupling.ts` / `spectrum.ts`) are **~80 % of the plumbing for
> six coupling phenomena** (crosstalk / HF / differential / shielding / RF / grounding). **Build
> the family once;** the EMI gate consumes only `emission(loop)`.

### 5.2 NEW (confirmed absent in `web/src/lib`)

| New | Cost |
| --- | --- |
| `geometry.ts` | ~150 LOC integer shoelace |
| `coupling.ts` | the estimator family |
| `spectrum.ts` | the dBµV panel |
| the **Tj integrator** (tick-driven, fixed Δt) | the **one genuinely new** stateful piece — handle with the hazard discipline |
| the `thermal` / `emi` / `return` / `rf` overlay lenses | a `BoardLens` union extension (today `schematic \| analogy \| reality`) + a desaturate-and-paint-one-story overlay pass |
| per-kind `θ_JA` + `Cth` tables, the `derate(Tj)` curve, the incandescence/thermal-lens palette passes, the vent/char animation, a `morphFactor(kind, apparentFreq)` signal + per-kind morph branches | balance + render |
| **(boundary)** surface NetClass through `loop.ts` **OR** derive aggressor/victim web-side | the **one cost the optimistic read understates** — recommend the web-side derivation for v1 |

> **No** new `sim-core` element, **no** new `Element::params` slot for this slice (parasitics
> already exist; an optional emissions FAIL flag could reuse the `RATED_CURRENT_SLOT` precedent,
> 0-default, unhashed — but the gate does **not** need it). Downstream `certLab.ts` (the
> emiChamber/ulLab host) and `reliability.ts` (lifeMultiplier) are also absent today.

---

## 6. Determinism & golden-safety

> ### Golden-safe by construction — proven three ways
>
> **(1) Pure presentation over unhashed outputs.** `snapshot_hash` (`lib.rs:7353`) folds **only**
> `tick` + node voltages / net levels + sequential element state. The AC measurements
> (analysis-only, doc-comment-confirmed **never hashed**), `element_currents` (snapshot-only),
> and the **FAIL mask** (`failed_elements` — *"never enters `Sim::snapshot_hash`"*, `lib.rs:6732`)
> are **all excluded.** The kernel reads exactly these plus **integer** geometry. `geometry.ts`
> is **integer-in / integer-out, no floats, no hashing.** It touches neither `node_v` nor
> `snapshot_hash` **by construction.**
>
> **(2) Sign-based verdict.** `verdict = sign(limit − measured)` and `Tj past a knee` — **no
> PRNG.** Same design → same verdict (which is why re-running an unchanged design is *free*).
> The only randomness anywhere downstream is the **fleet Poisson roll**, which is `mulberry32`
> seeded off `designHash` — same design → same outcome.
>
> **(3) Real-mode-gated.** In **Ideal** mode emissions are **off** and Tj is **nominal** (no
> derating, no wear-out). Every non-ideality bites only in **Real** mode.
>
> The suite touches **NO** `crates/sim-core`, `sim-protocol`, `sim-wasm`, `buildNetlist`,
> `Element::params`, `snapshot_hash`, or the `loop.ts` boundary **beyond** the existing
> `acSweep` / `acElementMeasurements` calls (the one NetClass add, if taken, is a new **read** of
> an unhashed classification — not a write). `cargo test -p sim-core` **including
> `run_is_reproducible` cannot move**; golden **`0xeaac_3764_99e4_fa24` is byte-identical**
> through **B0–B4** — only **B5** (a future AC-only crosstalk stamp, **not** the gate
> dependency) adds an unhashed AC stamp, and even that leaves the **transient golden untouched.**
>
> **The frequency-regime rule is the load-bearing reason this holds:** EMI lives kHz–GHz, above
> the `DT = 2 µs` alias ceiling (> 62.5 kHz), so the kernel **must** route through the analytic,
> Nyquist-free `ac_solve` / `ac_sweep` path — which keeps it **entirely off the hashed
> time-domain solve.**
>
> **THE ONE SHARED HAZARD.** The Tj integrator (and any future accumulated-state input) makes the
> sim **stateful across frames**, so it **MUST be strictly tick-driven**: fixed Δt from the sim
> tick, *identical native == wasm float math*, **never wall-clock**, **never** feeding a display
> phase back into the solve. **v1 sidesteps this for EMI** by keeping every EMI input
> **static-per-geometry** (loop area and AC currents are both static for a fixed design +
> frequency). Treat Tj like the deterministic flow phase and it is as safe as the thermistor
> path. *(A hashed `sim-core` `temp_state` — Path 2 — would move the golden and is explicitly
> deferred; v1 stays web-side.)*

### Verification gates this design must keep green

```
cargo test -p sim-core           # incl. run_is_reproducible + golden_snapshot_hash_is_stable
pnpm -C web test                 # incl. a NEW Tj-reproducibility pin + a lens/gate-parity pin
```

---

## 7. Phased build (the path that unblocks PS3b)

| Phase | Deliverable | Unblocks | Golden |
| --- | --- | --- | --- |
| **B0** | Heat read-only — Tj steady-state → `Component.temp`, body glow, °C readout, derated `RATED_CURRENT_SLOT` (Real) | the thermal lens, the **UL gate** (PS3a) | byte-identical |
| **B1** | Reality lens (3 paints + the `drawJunctionConduit` lens param) + return-path highlight | the physical frame; the cheap **waypoints-sufficiency probe** | byte-identical |
| **B2** | `geometry.ts` + `coupling.ts` skeleton (`emission(loop)`) | the estimator core | byte-identical |
| **B3** | `spectrum.ts` panel + CISPR/FCC limit line + the emi-lens cue family | the dBµV analyser + the by-feel bar | byte-identical |
| **B4** | **Flip the PS3b stub → live `[emiChamber]`** (reducer + `lifeMultiplier` coupling) | **🔓 PS3b / F5 — the unblock** | byte-identical |
| **B5** *(later)* | mutual-C/L crosstalk stamp in `ac_solve_models` (AC-only, unhashed) | richer crosstalk fidelity | transient golden untouched |

**The critical path to PS3b is `(B0-prereqs) → B2 → B3 → B4`.** B0/B1 ship value immediately (the
UL gate ships on B0 with **no** EMI dependency). The EMI gate consumes only `emission(loop)`, so
B2 can land before the full coupling family is built out.

> **De-risking order.** Ship **reality + the return-path highlight FIRST** (B1, the cheap probe)
> **before** the gate consumes the loop area — so the team sees whether cosmetic `Wire.waypoints`
> is a good-enough estimate of layout intent before betting a verdict on it (the one true
> unknown, §8.1).

---

## 8. Open questions / owner hand-offs

### 8.1 The one true unknown — `Wire.waypoints` sufficiency

Loop area is derived from **cosmetic** `Wire.waypoints` + pin/component cells. A player routing
sloppily in a way that **doesn't reflect real layout intent** produces a noisy area → noisy
margins. The reality lens makes this *more* visible (the player SEES the copper they routed) —
a feature for teaching, a risk for the estimate.
**Recommend:** accept geometry as an **estimate-of-intent** for v1; ship the **B1 return-path
highlight** as the cheap probe; flag an explicit `Wire.layer` / `isGroundPlane` additive field as
**flagged-not-built**.
**Owner:** accept-the-estimate for v1, or schedule the explicit layer field?

### 8.2 The boundary correction — NetClass crossing vs web-side slew derivation

NetClass is **computed in `sim-core` but does NOT cross `loop.ts` today** (verified). It is **not**
the zero-cost free input some notes imply.
**Recommend:** for v1, **derive** aggressor/victim **web-side** from `acMeasurements` slew
ranking; defer the NetClass crossing.
**Owner:** confirm — surface NetClass (a golden-safe snapshot-read add) or derive web-side?

### 8.3 Harmonic content + loop identification

- **Harmonic count + amplitude envelope:** how many harmonics does `ac_sweep` evaluate (8? 16?
  to the 1 GHz top?), and is the envelope derived from the **PULSE waveform/duty slots**
  (square → odd harmonics, −20 dB/decade, −40 past the edge corner) or a flat game-scale shape?
  `I_harmonic(f)` via the **analytic `ac_sweep` path** vs an **edge-rate `1/(πf)` envelope** past
  the knee (which also serves the *slow-the-edge* lever).
  **Recommend:** the `ac_sweep` analytic path with the edge-rate model as the slow-the-edge hook.
  **Owner picks the fidelity.**
- **Loop identification:** dominant-aggressor-by-slew, sum of all Digital-net loops, or
  player-selected? **Recommend:** auto-rank-by-slew + sum-top-N with click-to-isolate.
  **Owner confirms** the loop-set policy (a wrong choice reads the wrong aggressor).

### 8.4 Balance constants + the lifeMultiplier coupling

- **The `K` constant + the CISPR-B 40/47 dBµV break + `θ_JA`/`Cth`/`derate(Tj)`/per-part
  ceilings** are **balance-pass numbers** (target: a tidy board sits ~10 dB under / cool; a
  sloppy one busts 3–8 dB / cooks). They belong in **`data/balance.ts`** beside the FIT/RMA
  block, **deferred until the slice plays.** The 55 °C/20 °C Arrhenius and the 105 °C/10 °C
  wear-out numbers are **already fixed** in `docs/game-product-simulation.md` §3 — keep them as
  the canonical scale.
- **`lifeMultiplier`:** confirm the `0.6 .. 1.0`-over-10 dB clamp band and **worse-of vs
  multiplicative** with the UL thin-pass once both gates emit real margins.
- **Runaway fidelity:** web-side kicker (recommended for the teaching beat) vs deferring to a
  later hashed `temp_state` (defer). **Owner confirms** runaway is needed in the first slice.

### 8.5 CISPR/FCC detector + class delivery

Confirm the **cert class is a CONTRACT data field**, not a difficulty picker (the contract
template must carry it). Stepped vs interpolated at the 230 MHz break; **peak vs quasi-peak**
detector at game scale — **recommend peak-only, game-scaled, stepped break.**

### 8.6 Parity vitests (must-pin, not assume)

- **Lens/gate parity:** the free `emi` bench lens bar **and** the paid emiChamber scan **MUST**
  read the **IDENTICAL** estimator for a fixed board (one model, two moments) — else preview
  disagrees with verdict. The compliance **bar IS** `round(worst-harmonic margin)`, never a
  separate roll. **Pin with a vitest.**
- **Single-source-Tj parity:** pin that the free thermal lens, the UL over-temp gate, **and** the
  fleet FIT all read the **identical** `Component.temp` for a fixed board.
- **Tj reproducibility:** pin Tj across a fixed replay (the tick-driven hazard guard).
- **Reality-lens loop-wash parity:** the amber→red enclosed-area wash must read the **same**
  `coupling.emission` scalar as the spectrum panel and the gate (one source of truth).

### 8.7 Preview cost model + economy

- **Bench-service preview:** does the pre-ship Monte-Carlo / temp-sweep sink call the **same**
  kernel at **reduced harmonic-count**, or the **full** kernel at a discount? (Mirror the EMI and
  the Tj preview rulings for consistency.) **Owner.**
- **Thermal vent economy:** confirm the destroyed-part → autopsy → Lux refund path + the Credits
  cost, and that thermal-death is a **distinct** contract-FAIL surface from over-current FAIL
  (two surfaces, two lessons — `docs/heat-on-the-board-ideation.md` §4).
- **Lab Book Lux:** does **reality** (a costume, not a failure) warrant a Lux payout like the
  failure-mode pages, or is it a free always-on toggle with no codex entry? **Owner.**

### 8.8 Render / fidelity hand-offs

- **Reality pin end:** round collar or full rectangular SMD pad?
  (`docs/ui/reality-lens-and-junctions.md` §10) — affects whether the EMI loop-area read sees pad
  geometry. **Coupled** with the via-ring decision (a via ring implies a layer change → the same
  `Wire.layer` field §8.1 may need). **Resolve reality-via and geometry-layer together.**
- **Morph home:** ship the **depicted** preview toggle first as a teaser, or wait for the
  **computed** version so the meter always agrees? **Owner picks the teaser-vs-honesty tradeoff**
  (the doc recommends *building computed, marking depicted clearly*).
- **Headline first morph:** the **cap SRF flip** (the "aha", cap → inductor) or the **shunt +L**
  (the failure, ties to measurement)? `docs/ui/frequency-morph.md` recommends **shunt first**
  (the owner's original example + the measurable FAIL). **Confirm.**
- **Detail-drawer parasitic depth:** does the reality detail-drawer name **numeric** ESR/ESL/Cw
  (from the Real model / `tiers.ts` presets) or only the physical-origin art? Numeric ties the
  drawer to `tiers.ts` (cap ESR/ESL, inductor DCR/Cw already tiered there). **Owner sets the
  fidelity.**
- **Multi-element-part Tj:** one lumped body temp per `Component` (sum P over slots, recommended
  for v1 — datasheet-grade) or per-element Tj for a hot IC? **Flag** per-die as a fidelity
  upgrade; **owner confirms** lumped for v1.
- **Reduced-motion budget:** does the morph crossfade + the reality specular share
  `apparentRateScale` with the shimmer, or get a separate reduced-motion budget? **Owner.**

### 8.9 First-encounter authoring + thresholds

- **Trigger thresholds:** the heat warm-knee `ΔT` and the EMI "over the line" sensitivity (does a
  `+0.5 dB` graze fire the "shouting on the radio" moment, or only a real bust?).
  **Recommend** tying the EMI trigger to the same `−2 dB` near-pass band as the nudge, and the
  heat knee to the `--warn` onset. **Owner + balance pass.**
- **Reveal pacing:** allow heat's first-encounter to fire in pure sandbox (before any contract)
  while EMI's is gated behind the make-100 / emiChamber pull? **Recommend yes** — heat is the
  gentle on-ramp, EMI is product-realism. **Owner.**
- **Scripts:** the *"your board is shouting on the radio"* / *"this corner is cooking"*
  first-encounter scripts need authoring to the §5.2 register voice (only the FAIL-register lines
  exist today); the gentle near-pass and pure-curiosity (lens-pulled-without-a-contract)
  registers are unwritten. **Owner / narrative.**

---

*End — `docs/bench-realism-and-emi-kernel.md`. Planning only; golden `0xeaac_3764_99e4_fa24`
byte-identical by construction.*

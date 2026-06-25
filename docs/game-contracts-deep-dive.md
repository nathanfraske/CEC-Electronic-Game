<!-- SPDX-License-Identifier: Apache-2.0 -->

# Contracts, In Depth — the deep-dive

> **Read order.** This document is the third leg of a tripod. The **spine** is
> `docs/game-economy-progression-implementation.md` (the contract loop,
> Credits/Lux/standing, `realismMult`, the payout formula). The **probe arc** is
> `docs/ui/probe-teaching-arc.md` §3 (the seeded anti-copy generator and the
> *value-aware* `specMet` grader — the SHARED grader, built once). The **economy
> framing** is `docs/game-contracts-economy.md` (parametric contracts, standing
> vs batch, the judgement part). `docs/game-progression.md` supplies
> fidelity-as-progression and the very first 3.3 V divider OFFER.
>
> This file does not re-derive any of those. It deepens the **contract loop**
> and the **shared grader**, and answers four concrete questions: how a contract
> works end-to-end, how to grade one, which simulation pass each family is graded
> on, and the tiered-reality-vs-score decision.

---

## 0. Thesis — build the grader and the contract loop ONCE

A contract is a **purchase order with an acceptance test**. The economy spine
already names the loop (offer → build → ship → grade → pay) and the multipliers
that scale a payout. The probe arc already ships a *value-aware* grader: a
predicate that reads the live `V(OUT)` off the batched snapshot, debounces it,
and names the direction of a miss. The economy doc sketches a `grade()` spine
over a `SpecLine[]`.

**Those are the same machine seen from three angles. Do not fork them.** This
doc hardens them into one design:

- **One grader.** A single pure web-side reducer — `grade(spec: SpecLine[], …)`
  — over the already-batched, **unhashed** simulation output. The probe arc's
  one-`Vout`-line `specMet` is this function's first caller (a one-line spec).
  Every contract family is a different `SpecLine[]`, never a different grader.
- **One contract loop.** The spine's lifecycle, deepened here with the
  *judgement part*, the *satisfiability gate*, and the *standing scheduler*.
- **The firewall is structural.** Strict pass/fail GATES the ship and the
  payout; a separate weighted score is **display/telemetry/coaching only** and
  never enters `applyEarn`. A 90%-passing real attempt earns **zero**.
- **Determinism is sacred.** The entire grader + contract supply engine is
  web-side game-state. It touches **no** `crates/sim-core`, **no** `buildNetlist`
  emission, **no** netlist, **no** `snapshot_hash`. It only *reads* the
  already-batched output and the on-demand analytic AC results. `cargo test -p
  sim-core` (incl. `run_is_reproducible`) stays bit-identical. (§7 is the full
  statement.)

The deliverable of this doc is the *design*. The deliverable of the **build** is
three small web-side modules — `grader.ts`, `contracts/passes.ts`,
`contracts/realityTier.ts` — plus per-family template data. Once they exist,
adding a contract family is ~40 lines of data, not code. That line — generator,
not hand-list — is the whole point (`game-contracts-economy.md` §6).

---

## 1. How a contract works end-to-end

### 1.1 The lifecycle [the FSM]

A `ContractInstance` is a frozen, seeded snapshot of a `ContractTemplate`. It
walks a small state machine. The spine §4 owns the canonical states; this is the
deepened walk.

| State | Meaning | What the player sees | What the engine does |
| --- | --- | --- | --- |
| `offered` | Generated, satisfiability-proven, on a margin card | A non-modal offer card in the opener / tray | Nothing live; the instance is cached |
| `accepted` | Player pulled it in | The judgement part (JP) drops onto the bench; spec checklist appears | The JP stimulus arms; the live ring starts feeding the grader |
| `building` | Player wiring toward spec | A **live checklist** ticking amber→green per line | The shared grader runs each frame off the batched snapshot (display-only score) |
| `shippable` | `lines.every(passed)` true under the submitted window | A **SHIP IT** button lights | Strict gate satisfied; payout previewed |
| `shipped` (batch) | One-shot accepted | Payout lands; juice spike | `applyEarn(payout)`; per-seed decay records the clear |
| `committed` (standing) | Player pledged throughput | A standing card with a drip meter | The standing scheduler re-grades on a rolling window under a ramping profile |
| `lapsed` | A standing window FAILED | The card craters; an RMA hits standing | `rma` EarnEvent; clawback of the last drip interval |
| `expired` | An ignored offer aged out | Card fades from the tray | Instance discarded; sandbox never stopped |

**Pull-not-pick throughout.** No state is a gate on the sandbox. An offer that is
ignored simply ages to `expired`. The harder ceilings (reality riders, standing)
are *pulled* when the player wants the multiplier, never imposed.

### 1.2 The judgement part [the JP — how the contract talks to the bench]

A contract is not graded against a blank board. It ships a **judgement part**: a
real, tick-pure fixture that supplies the stimulus and names the pads the grader
reads. The JP is the contract's physical interface.

- The JP carries the **named pads** (`OUT`, `IN`, `SENSE`, `LOOP`, …) the spec's
  `PinAddr` resolves against. The player wires their circuit to those pads.
- The JP carries the **stimulus**. A regulator's load step, a filter's swept
  source, an oscillator's loop tap — all are driven by the JP using the existing
  param-on-existing-element trick: `PULSE → ELEM_ACSOURCE` (waveform param) and
  `SHUNT → ELEM_RESISTOR` (milliohm sense). **No new sim element.** The JP
  hashes like any element and replays byte-identically (`game-contracts-economy.md`
  §; the PULSE/SHUNT trick is in `CLAUDE.md` Gotchas).
- The JP is **tick-pure**: a board with a JP replays bit-for-bit.

### 1.3 The offer [what a card promises]

An offer card is the contract's promise, rendered in CEC voice:

```
[CUSTOMER: PowerCo]              [REWARD: 50 ₵ · par 2 parts]
+5 V → +3.3 V rail, ±5%                       [difficulty ▰▰▱▱▱]
  ▸ V(OUT) = 3.30 V  ±5%
RIDERS:  [+Real-5% MC  ×1.6]  [+Real-1%·temp  ×2.2 🔒]
                                          [ ACCEPT ]
```

The card is **self-describing**: spec lines in plain language, the par baseline
(from the reference circuit, §5), the reward, and the optional reality riders
(§4). A locked rider greys with an unlock badge — offer-not-gate language.

### 1.4 The end-to-end walk [one trip]

```
generate(template, sessionSeed, d)          // §5 — seeded, satisfiability-proven
   └─ frozen ContractInstance {spec, ref, par, JP}
offer  → player pulls it  → JP drops, stimulus arms
build  → grade(spec, liveRing) each frame   // §2 — display-only score, live checklist
ship   → lines.every(passed) ?  SHIP IT     // §2.4 — strict gate
pay    → applyEarn(BASE·(1+0.6·d)·realismMult·eleganceMult·marginMult·…)  // spine §3.1
        (standing) → scheduler drips per interval under a ramping profile  // §5.5
```

Every arrow except `generate` and the standing scheduler is the probe arc's
existing loop, generalized from one Vout line to `SpecLine[]`.

---

## 2. The grader and the spec language

> **One pure reducer.** `grade(spec: SpecLine[], input, maps, padToComponent)
> → GradeResult`. It reads already-batched, unhashed output and PICKS ITS OWN
> PASS per line. It is the probe arc's `specMet` widened: replace the single
> hardcoded `Vout` line with a loop over `spec[]`, add `PinAddr` resolution, add
> the reduce-verb dispatch. **The probe arc becomes `grade()`'s first caller.**

### 2.1 The `SpecLine` schema

Every line **self-describes** its address, its reduce-verb, its window, its
target, its tolerance, its comparator, and its weight. Every field is per-LINE,
so one template spans a difficulty curve by *stacking and tightening lines*, not
by forking templates.

```ts
type Measure =
  | 'nodeV' | 'branchI'          // DC / settled
  | 'risesToWithin' | 'period' | 'ripple'   // transient
  | 'logicLevel'                 // transient, powered-gate rails
  | 'gainDb' | 'phaseDeg';       // analytic AC (frequency domain)

type Reduce =
  | 'last' | 'mean' | 'max' | 'min'
  | 'peakToPeak' | 'firstCross' | 'period';

interface SpecLine {
  measure: Measure;
  at: PinAddr;                   // {pad:'OUT'} etc. — resolved at GRADE time
  cmp: '==' | '<=' | '>=';
  target: number;
  tol: number;                   // FRACTION of |target|
  window?: [tickLo, tickHi];     // ring slice for time-domain reduces
  reduce?: Reduce;
  atFreqHz?: number;             // present ⇒ analytic AC pass
  weight?: number;               // weighted-score ONLY; never gates
}
```

### 2.2 `PinAddr` resolves at GRADE TIME — never stored [the one correctness trap]

`PinAddr` is `{pad: string}`. It is resolved fresh every grade against the
*current* netlist:

```
{pad:'OUT'} → padToComponent → nodesOfComponent[id]   (nodeV)
                             → elemOfComponent[id]     (branchI)
   via electricalMap (netlist.ts ~:1841)
```

**Node and element indices shift per build** — a different wiring yields a
different node count and ordering. Storing a resolved index is a silent
correctness bug. The grader MUST resolve through `electricalMap` every time
(`game-economy-progression-implementation.md` §4.3 marks this "crucial"). A
frequency line resolves `OUT`/`IN` to two node indices and reads the complex
`ac_solve` response at each.

### 2.3 Tolerance is a FRACTION of target [scales across difficulty]

`tol` is a fraction of `|target|`, so a line scales across a difficulty curve
without re-authoring. Difficulty `d ∈ [0,1]` tightens it: `tol = lerp(0.08,
0.01, d)` — ±8% trivial to ±1% lab-hard (spine §4.2).

| `cmp` | Pass condition |
| --- | --- |
| `==` | `|m − target| ≤ tol·|target|` |
| `<=` | `m ≤ target·(1 + tol)` |
| `>=` | `m ≥ target·(1 − tol)` |

### 2.4 Pass/fail GATES; weighted score COACHES [the firewall, split not chosen]

The grader produces **two outputs from one pass**, and they are firewalled:

| | Model A — strict pass/fail | Model B — weighted score |
| --- | --- | --- |
| Formula | `passed = lines.every(ok)` | `score = Σ wᵢ·clamp01(passFracᵢ) / Σ wᵢ` |
| `passFracᵢ` | n/a | `1` if line passes; else graded falloff `1` at `tol` edge → `0` at `2·tol` |
| Role | **GATES the ship + the payout** | Display / telemetry / **coaching only** |
| Touches `applyEarn`? | **Yes — the only path** | **Never** |
| Touches lifecycle? | Yes (shippable, lapse) | Standing "drifting" grace only (§5.5, owner call) |

A purchase order is **acceptance testing, not answer-checking**. No customer pays
70% for 7-of-10. So Model A is the wallet. Model B drives the live checklist's
amber "92% — too high", the bonus-tier nudge (barely-gold vs robust-gold), and
the standing drifting-grace warning. **`realismMult` / `eleganceMult` /
`marginMult` multiply a PASS, never a partial.**

> **The firewall's single failure mode** is a future caller doing
> `applyEarn(score·x)`. Guard it at the **type level**: the weighted score lives
> on a `DisplayGrade` branch that the payout path structurally cannot read, and a
> vitest asserts no partial-pass ever mints Credits (§9 Q1).

### 2.5 The signed margin — one computation, three consumers

Each line yields a **signed margin**: the fractional distance to the nearest
tolerance edge (negative = failing-by, positive = passing-by). This single number
feeds **three** consumers — do not compute coaching direction separately:

1. **The gate** (margin < 0 ⇒ that line fails).
2. **The coach** (the probe-arc rubber-duck: a near-miss names the *direction* —
   "too high → grow R2 or shrink R1").
3. **`marginMult`** (spine §3.1: survival band `[0, 2%)` → ×1.15; robustness
   `≥ 15%` → ×1.25).

Worked: player ships 3.45 V on a 3.3 V ±2% line. The edge is 3.366 V; the
fractional overshoot is `(3.45−3.366)/(0.02·3.3) ≈ +1.27` past the edge ⇒ FAIL,
margin negative-relative-to-pass. Checklist shows amber "−7% high"; the coach
reads the *same* margin sign: "too high → grow R2 or shrink R1". A pass at 3.33 V
has margin `+0.55` within band ⇒ feeds `marginMult` survival bonus. **One margin,
three uses.**

### 2.6 Per-line pass selection and the UNION [pull-not-pick the pass]

A line picks its own pass from its shape:

```
if line.atFreqHz != null                         → analytic acSweep AcResult
else if line.reduce ∈ {firstCross, peakToPeak,
                       min, max, period}          → transient 2 µs ring
else (last | mean of nodeV | branchI)            → DC settled op-point
```

`grade()` computes the **UNION** of distinct passes the spec needs, runs each
**once**, caches them, reduces every line against its cache, then
`passed = lines.every`. A regulator that mixes a settled-DC line and a transient
droop line runs **DC + transient once each — never per-line re-solve**. (§3 is
the full per-family matrix; §9 Q5 owns the cache-once sign-off.) Cache shape:

```ts
{ dc?: DcResult, ring?: SnapshotSlice, ac?: AcResult /* one acSweep over
  logFreqs bracketing every spec atFreqHz */ }
```

### 2.7 Frequency-domain lines [the verb the aliased transient cannot express]

Two verbs live only in the analytic frequency domain:

- `gainDb = 20·log10(|V_out / V_in|)` at `atFreqHz` — the exact quantity
  `drawBode` plots (`bode.ts`, `dBV = 20·log10|V|`).
- `phaseDeg = arg(V_out / V_in)°` at `atFreqHz` — the quantity `drawPhaseScope`
  draws (`phaseScope.ts`).

These are **mandatory** for filters and oscillators because the fixed
**DT = 2 µs** transient **aliases above ~62.5 kHz**, and a filter's stop-band or
an oscillator's loop-cross routinely sits in the MHz. The analytic `ac_solve` has
**no Nyquist limit** (it displays MHz–GHz). The grader gains one `AcResult` input
branch and issues **one** `acSweep(logFreqs)` bracketing all spec freqs at grade
time — fed from the **same** `acSweep` that `bode.ts` / `phaseScope.ts` already
call. **No new wasm crossing.**

### 2.8 The not-ready guard [load-bearing for golden-safety]

`Snapshot.elementCurrents` and `Snapshot.failedMask` are **optional** on the
`Snapshot` type (`loop.ts:24, 31`). A window containing an `undefined`
`elementCurrents`/`failedMask` frame is treated as **not-ready/FAIL** — never read
as a zero, never a silent pass. A `firstCross` that never crosses in its window is
a fail (`tick = +∞`), never a silent pass.

### 2.9 Coaching [the live checklist]

While building, Model B drives a per-line checklist: green (passing), amber (near
the edge, with the signed-margin direction), grey (not-ready / unwired pad). This
is the rubber-duck made structural — it never reveals the answer (the firewall:
it compares the LIVE output to the per-session target, never the reference
parts), it names a *direction*.

### 2.10 The anti-copy property [the grader measures output, not parts]

The grader measures the **live output against the per-session target**, never the
player's component values against the reference's. Copying the example's 1k/2k
into a 5 V→3.3 V rail closes the loop on graph *shape* but reads visibly
out-of-spec on `nodeV` (the probe-arc §3c mechanic, now a `SpecLine`). The
inverse bug — comparing player values to reference parts — would *pass* a diligent
copier and *fail* a correct-but-different solution; the grader must never do it.
Guard with the planned vitest (probe-arc §7): 5k/3.5k in-ratio passes; the
example's 1k/2k into a different rail fails.

---

## 3. The SIMULATION-PASS MATRIX [which read, when, why — per family]

> **A contract does not own a "pass."** Each `SpecLine` *selects* its pass (§2.6);
> the grader runs the UNION the spec needs, once each, then ANDs. There are
> **seven read-only passes over two solvers**: the fixed-**DT = 2 µs** transient
> ring (aliases above ~62.5 kHz) and the analytic, **Nyquist-free** `acSweep`
> (MHz–GHz). The temperature / Monte-Carlo / corner passes are web-side
> **re-flatten wrappers** that re-run a family's primary pass N times and AND the
> verdicts.

### 3.1 The seven passes [the menu]

| # | Pass | Reads | Cost | When | Aliases? |
| --- | --- | --- | --- | --- | --- |
| 1 | **DC operating point** | `state[]` node-V + `elementCurrents` (last settled tick) | cheap | live at ship; scratch at generate | n/a |
| 2 | **Transient 2 µs stream** | the live `Snapshot[]` ring | **free** at ship (it IS the ring) | live at ship; capped replay at generate | **yes, >62.5 kHz** |
| 3 | **Analytic AC sweep / Bode** | `acSweep(logFreqs, real)` → `[re,im]` per node per freq | 1 `ac_solve` / freq point | live at ship; scratch at generate (AC families) | **no** |
| 4 | **Phase scope** | `ac_solve` at one freq, phase read | 1 `ac_solve` | same as #3 | **no** |
| 5 | **Temperature sweep** | re-flatten at each `conditions.tempC` (Tj) + re-solve primary | N_temp × primary | **scratch** at ship (perturbs values) | inherits primary |
| 6 | **Monte-Carlo tolerance** | re-flatten w/ per-id jitter (`tiers.ts resistorTolerance`) × N + re-solve primary | N × primary | **scratch** at ship; gates `sweepHeld` | inherits primary |
| 7 | **Worst-case corners** | each tol/temp param at min/max (2^k, screened for k>3) + re-solve | 2^k × primary | **scratch** at ship | inherits primary |

### 3.2 The router [one function, build once, inside `grade()`]

```ts
selectPass(line) =
  line.atFreqHz != null                              ? 'acSweep'
  : line.reduce ∈ {firstCross,peakToPeak,min,max,period} ? 'transient'
  : /* last|mean of nodeV|branchI */                   'dc';
```

`grade()` computes the union of distinct passes, runs each once, caches `{dc?,
ring?, ac?}`, reduces every line against its cache, ANDs.

### 3.3 The per-family SIM-PASS MATRIX

| Family | Primary pass | Reduce verbs | WHY this pass (not another) | When it runs | Ship-N wrapper |
| --- | --- | --- | --- | --- | --- |
| **Fixed rail / divider** | DC op-point | `last`/`mean` nodeV; `last` branchI | steady-state, no time dependence — a transient run wastes the ring on a flat line | live at ship; scratch DC at generate | MC over tolerance (real5); temp corner (over-temp) |
| **Current-limit / LED** | DC op-point / load sweep | `last`/`mean` branchI across a varying load | the limit is a DC characteristic | live at ship | MC for part spread |
| **RC timing** | Transient 2 µs | `firstCross` (= `risesToWithin`) | the charge curve IS the deliverable; τ stays well under 62.5 kHz | live ring at ship; capped replay at generate | temp-sweep (τ shifts with R/C over temp) |
| **Filter** | **Analytic AC sweep** | `gainDb` (& `phaseDeg`/Q) at two+ `atFreqHz` | **spec freqs routinely exceed 62.5 kHz where the transient ALIASES — the analytic path is the only honest one. This is why the AC pass exists.** | `acSweep` at ship; AC scratch at generate | corners for band-edge shift |
| **Oscillator** | **Analytic AC (HF)** `gainDb`+`phaseDeg` Barkhausen / **transient** `period` (LF ≤62.5 kHz) | loop gain ≥1 at phase-cross + amp; OR `period = 1/θ_f` | a >62.5 kHz LC/loop oscillator cannot be measured on the aliased transient; an LF relaxation blinker can | branch baked at generate | corners / amplitude floor |
| **Regulator under load step** | **Transient 2 µs + DC** | `min`/`max` (droop floor / overshoot ceiling) over the step window + `mean` (settled) | the load step is an inherently time-domain event — the droop only exists in the ring; the DC line pins the settled rail. **The JP step EDGE rate is clamped (rise ≥ a few·`DT`)** so its broadband content stays < 62.5 kHz — a sub-2 µs edge would alias the min/max extrema the spec grades (§3.4) | both passes once at ship | MC + corners for stability |
| **Rectifier / PSU** | Transient 2 µs (**50/60 Hz line**) **or analytic AC** (high-f SMPS ripple) | `peakToPeak` ripple over a window | ripple is a **sharp-edged, harmonic-rich** envelope, so the clamp must bound the highest SIGNIFICANT harmonic, not the fundamental — a 20 kHz SMPS has 3rd/5th harmonics (60/100 kHz) that alias, so **route high-switching-freq PSU ripple to the analytic path** like filters; only true 50/60 Hz line rectification grades safely on the transient | live ring (line) / `acSweep` (SMPS) at ship | MC for ESR ripple spread; temp for Vf |
| **Logic-level / threshold** | Transient 2 µs | `logicLevel` vs window (powered-gate VCC/GND rails) | edges and thresholds are time-domain | live ring at ship | corners for V_IH/V_IL over supply/temp |
| **MTBF / reliability / ship-N** | the family's PRIMARY pass wrapped in **MC + worst-case corners** | `sweepHeld = draws.every(passed)` | reliability **IS** the sweep — "works on my bench ≠ works across the spec"; gates CEC-Certified | scratch at ship | (this row IS the wrapper) |

### 3.4 The DT = 2 µs ceiling forces filters/oscillators onto the analytic AC path

This is the load-bearing routing fact, stated plainly: the transient solve is a
fixed-step `DT = 2 µs` integrator, so any time-domain measurement **aliases above
~62.5 kHz**. A filter's stop-band (`gainDb ≤ −40 dB @ 1 MHz`) and a loop
oscillator's cross frequency live *above* that ceiling. The analytic
`ac_solve`/`acSweep` is exact at any frequency (it is what the Bode and phase
scope already display in MHz–GHz). Therefore: **filter and oscillator-HF lines
MUST route to the analytic AC pass; this is a structural requirement, not a
preference.** The router (§3.2) encodes it via `atFreqHz`. The oscillator
transient-vs-AC branch is baked from θ_f **at generate time** (§5.3) so one
family never straddles 62.5 kHz mid-grade. **A stimulus-bandwidth invariant binds
EVERY transient-graded family, not just the rectifier:** the rectifier θ_f, the
**regulator load-step edge rate** (rise ≥ a few·`DT` so the step's broadband energy
sits < 62.5 kHz — a sub-2 µs edge would alias the very min/max droop extrema the spec
grades), and the **standing `conditionProfile` swept parameters** (§5.5, clamped
≤ 62.5 kHz *at sample time* the same way θ_f is, so a ramp can't walk a contract
across the ceiling mid-life) are all hard-clamped. The matrix's per-family note is
that clamp.

### 3.5 The three sim contexts [never conflated]

| Context | When | What runs | Golden relation |
| --- | --- | --- | --- |
| **SCRATCH** | generate-time, once per offer | satisfiability replay of the family's primary pass on the hidden ref, capped window (DC for divider, AC for filter/oscillator — **never** a transient it would alias on, transient for RC/rectifier/regulator) | a 2nd `createSimulation`; `snapshot_hash` **never** compared to the golden |
| **LIVE** | build → ship | time-domain + DC lines read the already-batched, unhashed snapshot | no extra crossing; reads only |
| **ANALYTIC-AC** | ship (and generate for AC families) | `acSweep`/`ac_solve`, on demand | excluded from `snapshot_hash`; no Nyquist limit |
| **MULTI-RUN** (temp/MC/corners) | ship | re-flatten + re-solve on a scratch sim | scratch; never compared to the golden |

The multi-run wrappers run on a **separate offscreen scratch Simulation** at ship
(never live — they perturb values). The MC/temp/corner bench services are
themselves **purchased capabilities** (Credit sinks) — fidelity-as-progression
applied to the grader itself.

---

## 4. THE BIG QUESTION — tiered reality-CONTRACTS vs reality-as-SCORE

> Should the player **self-select** into different reality tiers of the *same*
> contract (Option A), or should adding reality just **multiply the score** on
> one contract (Option B — the existing `realismMult`)? Both are designed below;
> the **recommendation is a rider hybrid**.

### 4.1 Option A — self-select reality TIERS

One circuit, **three side-by-side acceptance tests** selectable via
`realismTier ∈ {ideal, real5, real1temp}`.

```ts
interface RealityTier {
  minFidelity: 'ideal' | 'real';
  tolPct: 8 | 5 | 1;
  demandedPasses: Pass[];          // ideal: primary; real5: +MC; real1temp: +MC +tempCorner
  realismMult: 1.0 | 1.6 | 2.2;    // spine ladder
  tierCap: 'bronze' | 'gold' | 'certified';
}
```

The grader is **identical** across tiers — only `demandedPasses` differ.

- **Pro.** `realismMult` is a *visible chosen agency*; one template → three
  difficulties free; clean tree-service tie (real1temp needs the temp-sweep bench
  service).
- **Con.** Triples the offer-card surface; risks reading as the **difficulty
  modal** the pull-not-pick pillar fights; each tier is authored as a full
  parallel test (≈3× build cost).

### 4.2 Option B — reality-as-SCORE (the existing `realismMult`)

One contract, **one Ideal-passable acceptance test** ("3.3 V ±tol at the pins").
Reality is read **post-hoc** and folded into payout exactly as spine §3.1: pass in
Real mode with 5% parts that held → `realismMult` 1.6 applied *after* the pass;
Ideal → 1.0; an optional MC `sweepHeld` lifts the bonus tier bronze→…→certified.
No schema change beyond `GradeResult.realism`.

- **Pro.** Zero extra offer surface; cleanest "the sim is the only judge"
  framing; reality stays emergent.
- **Con.** Reality is **invisible until after the ship** — the player never
  *chooses* it, so `realismMult` feels like a number that *happened to them*.
  Weak pull toward fidelity-as-progression (no on-offer signal that *buying
  reality is the climb*). The rule-4 vent/corner-drift RISK has no on-offer
  expression, so "realism is a gamble, not a free win" is muted — Real becomes a
  near-free 1.6× if you happen to be in Real mode.

### 4.3 Comparison

| Axis | A — tiers | B — score | **Hybrid — riders (recommended)** |
| --- | --- | --- | --- |
| Player agency | high (chosen up front) | none (post-hoc) | **high (pulled, optional)** |
| Offer-card surface | heavy (triptych) | minimal | **light (one card + chips)** |
| Reads as difficulty modal? | **risk: yes** | no | **no (margin affordances)** |
| Build cost | ~3× (parallel tests) | ~1× | **~1× + two pass-unions** |
| Fidelity-as-progression pull | strong | weak | **strong (chips advertise the climb)** |
| Rule-4 risk visible on offer? | yes | no | **yes (risk copy on the chip)** |
| `realismMult` semantics | chosen rung | awarded rung | **chosen ceiling; scored within** |
| Firewall (brute-force can't reach 2.2×) | yes | partial | **yes (rider DEMANDS the MC/corner pass)** |

### 4.4 RECOMMENDATION — the rider hybrid

**Ship ONE contract instance with a base Ideal acceptance test PLUS optional
reality RIDERS the player pulls on the non-modal offer card.** This is Option-A's
pullable agency + Option-B's post-hoc within-tier scoring, expressed
**additively** (riders on one test) not as three parallel tests.

```ts
interface Rider {
  id: 'real5' | 'real1temp';
  label: string;
  addsPass: Pass;                  // real5 → Monte-Carlo; real1temp → +temp corner
  raisesCeilingTo: 1.0 | 1.6 | 2.2; // realismMult
  requiresUnlock: TreeNodeId | ServiceId;
  riskCopy: string;                // "real parts can vent / drift the corner — RMA −25"
  accepted: boolean;
}
// on the instance:
ContractInstance.riders: Rider[];
```

**How it composes:**

1. **Pulling a rider** (a) ANDs its demanded pass onto the shared grader's verdict
   and (b) raises the `realismMult` ceiling. Unpulled → the base Ideal contract
   (the default if the chips are ignored).
2. **The shared grader is never forked.** A rider contributes entries to the
   per-line pass UNION (§2.6): `real5` adds `montecarloHold(spec, N) =
   draws.every(d => grade(spec, d).passed)`; `real1temp` adds
   `cornerHold(spec, {tempC corners})`. The base verdict ANDs with each pulled
   rider's hold:
   ```
   pass = baseGrade && pulledRiders.every(r => r.hold)
   ```
3. **`realismMult` is the HIGHEST pulled rider's rung** (a *max*, not a product —
   riders raise the ceiling, they do not multiply each other; §9 Q6). Within that
   ceiling, `eleganceMult` / `marginMult` / `standingMult` / decay layer post-hoc
   exactly as spine §3.1 — **Option B's scoring preserved inside the chosen
   ceiling**.
4. **Pull-not-pick.** Riders are side-by-side chips on the one non-modal offer
   card, not an up-front difficulty bucket. A locked rider greys with its unlock
   badge (real1temp needs **both** the tolerance node **and** the temp-sweep
   bench service — a genuine two-purchase climb; §9 Q3). Ignore the chips → the
   default Ideal contract grades and pays at 1.0×.
5. **The firewall, on-offer.** A pulled rider *demands* its MC/corner pass, so a
   brute-force tuned to one nominal seed **cannot** reach 2.2× by toggling Real
   mode — it must HOLD the sweep. Strict pass/fail SHIP gate stays Model A: a
   90%-passing real attempt earns ZERO. The rider's risk copy names the rule-4
   gamble **on the card**, so ceiling-**and**-risk is chosen eyes-open.

**Worked (divider, 3.3 V from 5 V):**

| Choice | Demanded passes | `realismMult` | Payout (BASE 50) |
| --- | --- | --- | --- |
| Ignore chips (Ideal) | DC nominal | 1.0 | ~62 ₵, bronze-capped |
| Pull **[+Real-5% MC]** | DC + Monte-Carlo hold | 1.6 | ~168 ₵ (matches spine §3.1: `round(50·1.24·1.6·1.3·1.25·1.04)`), gold reachable, vent risk |
| Pull **both** | DC + MC + temp corner | 2.2 | ~296 ₵, certified reachable |

One template, additive riders, no parallel tests authored. **This is the
recommendation.** (§9 Q2 carries the framing sign-off.)

---

## 5. Generation, variety, difficulty — and standing vs batch

> **Ship a generator, not a hand-list.** A contract is a pure-TS **factory**:
> `ContractTemplate = (sampleParams → buildSpec → buildReference → judgement)`,
> seeded `mulberry32(xmur3(templateId:session:difficulty))` and frozen into a
> `ContractInstance`. Author ~12 templates → thousands of contracts. (Spine
> §4.1/§4.2 owns the schema; this deepens the supply half.)

### 5.1 The template ABI

```ts
interface ContractTemplate {
  id: string; title: string; family: Family; requiredTags: string[];
  minMode: 'ideal' | 'real';
  sampleParams(rng, d): Params;
  buildSpec(p): SpecLine[];
  buildBonus(p): BonusLine[];
  buildReference(p): GraphSnapshot;   // earns THREE uses: honesty proof, par, SHIP-IT ghost
  judgement(p): JudgementSpec;        // the JP
}
```

The three builders are the only per-family logic. Everything downstream —
seeding, satisfiability, grade, FSM, payout, SHIP-IT ghost — is **shared**.

### 5.2 The difficulty dial is CONTINUOUS and DEFORMS, never buckets

One scalar `d ∈ [0,1]` deforms **one** template across four channels:

| Channel | Driven by `d` | Example |
| --- | --- | --- |
| **Tolerance** | `tol = lerp(0.08, 0.01, d)` | ±8% trivial → ±1% lab-hard |
| **Range / sweep** | widen load sweep, raise stimulus freq toward a family ceiling, push V_target toward the rail (margin shrinks) | 2 → `2+round(3·d)` load points |
| **Duration** | `runTicks = round(base·lerp(1,3,d))` | a longer window the design must hold |
| **Spec-stacking** | at `d > 0.6`, `buildSpec` APPENDS a second hard line | divider gains `branchI ≤ iMax`; regulator gains a droop floor; filter gains a stop-band line |

`gs.band` (spine §1) creeps `d` with demonstrated skill (par-beats / predictions),
clamped per era — an automatic personal curriculum, **no level list**.

### 5.3 The satisfiability check [the honesty gate — load-bearing]

`generate()` proves every offered instance is *possible*:

```
generate(template, sessionSeed, d):
  params = sampleParams(rng, d)
  ref    = buildReference(params)
  scratch = createSimulation()                 // SEPARATE offscreen sim
  run the family's sim-pass on ref, CAPPED window (NOT full standing length)
  if !grade(buildSpec(params), refHistory|refAcResult).passed:
       resample up to K=8, else DROP template this tick
  par  = {parts, bomCost, power}               // par baseline
  ghost = refHistory                           // the SHIP-IT ghost
```

The scratch sim's `snapshot_hash` is **never** compared to the golden.
**Critical:** the satisfiability pass MUST equal the GRADE pass — a
filter/oscillator template runs its scratch check on the **analytic** `acSweep`,
never a transient it would alias on (§9 Q4). The oscillator transient-vs-AC
branch is baked from θ_f **here, at generate time**, so one family never straddles
62.5 kHz. One `buildReference` earns three uses: honesty proof, par, ghost.

### 5.4 Variety without a hand-list [five seed-driven axes]

| Axis | Source | Effect |
| --- | --- | --- |
| Param | sampled bands | different numbers per seed (baseline) |
| Structural | `Component.variant` (`diodes.ts`) | a rectifier picks a diode family; an LED picks a colour — visibly different parts |
| Customer / flavour | seeded `customerId` + CEC-voice copy | reskins the card, biases bonus weighting (a "cheap" customer weights `parRatio` harder) |
| Condition | `conditions.{tempC, supply, stimulus}` | two same-family builds feel different |
| Pairing | at high `d`, *which* second line stacks is sampled from a small per-family menu | divider stacks a draw cap OR a thermal corner |

Variety is **generated**, not authored — the anti-copy firewall applied to
supply: no two offers are the same circuit, so no walkthrough exists.

### 5.5 Standing vs batch [two consumption modes of the SAME instance]

| | **Batch** | **Standing** |
| --- | --- | --- |
| Flow | build → ship once → grade once → lump payout | commit a passing circuit → drip per re-grade interval |
| Role | the on-ramp; the juice spike; every new family debuts here | robustness-over-time becomes income (Shapez "demand climbs, scale your factory" in volts) |
| Stimulus | static submitted window | a tick-pure `conditionProfile(tick, seed)` θ-walk (the PWM/AC-source precedent — no new engine), **with any swept stimulus frequency clamped ≤ 62.5 kHz at sample time** (§3.4) so a ramp can't walk the contract into the aliased regime mid-life |
| Gate | strict pass/fail | re-grade over a rolling window; ramps; lapse → RMA |
| Unlock | always | a family's standing variant unlocks only after its first **batch** ship (learn on batch, then engineer it to last) |

**Standing scheduler [the deep spec]:**

```ts
interface StandingRun {
  instanceId; committedGraph; rampLevel; intervalsPassed; conditionProfile seed;
}
// every N intervals:
//   grade(spec, rollingWindowUnderProfile)
//   pass → drip = round(BASE · 0.15 · (1 + 0.25·rampLevel))
//   FAIL → status 'lapsed' + rma EarnEvent + clawback of last drip
//   ramp → rampLevel++ every K=4 passing intervals; each ramp ESCALATES the
//          profile (load grows, ripple budget tightens)
```

A fragile nominal pass dies on the first escalated transient; an engineered design
with margin earns rent. **Lapse → RMA** is the asymmetric downside (build is slow,
loss is fast): `oos` −18, `lapse` −12, `vent` −25 + clawback. Coupling closes the
loop: high-difficulty contracts surface only at `standing ≥ 60`; preferred-vendor
at `≥ 85` **widens the generator's difficulty band** — standing FEEDS the
difficulty dial.

**Partial-failure grace** (owner call, §9 Q7): Model-B score can warn "drifting
out of spec" **one interval** before lapse, instead of an instant crater.
Recommend grace **for standing only** — batch stays clean strict pass/fail. The
score never pays Credits (firewall intact); this is the *one* place Model B
touches lifecycle (not the wallet).

### 5.6 How reality rides ON TOP of difficulty + standing [three orthogonal knobs]

| Knob | Controls | Mechanism |
| --- | --- | --- |
| **`d`** | how HARD the spec is | tightens `tol`, widens sweep, stacks lines |
| **`realismTier` (rider)** | how ROBUSTLY it must hold | adds MC / temp-corner passes the *same* spec must survive |
| **standing** | DURATION under ramp | re-grade over a ramping profile |

`payout = BASE·(1+0.6·d)·realismMult·eleganceMult·marginMult·standingMult·decay`
(spine §3.1) multiplies all three **independently** — never one difficulty bucket.
Satisfiability must run the chosen tier's passes too: a Real-1%-temp offer is only
issued if the *reference* holds the MC+corner sweep, else it would be
impossible-at-tier.

---

## 6. Reuse vs new surface

### Reuse — built once, generalized, never forked

| Surface | Where | Role in contracts |
| --- | --- | --- |
| `specMet` predicate | probe-arc §3b | becomes `grade()`'s first one-line caller |
| `grade()` signature + reduce verbs | spine §4.3 | the shared grader (this doc ADDS `gainDb`/`phaseDeg` + `atFreqHz` — a strict superset) |
| `acSweep(freqs, real)` / `acElementMeasurements` | `loop.ts:98 / :104` | the frequency-domain pass — already read-only, already consumed by `bode.ts` / `phaseScope.ts`; **zero new wasm crossing** |
| `electricalMap` + `nodesOfComponent` / `elemOfComponent` / `nodeNames` | `netlist.ts ~:1841 / :818 / :828 / :852` | the pin/branch address book, rebuilt fresh per frame |
| `tiers.ts resistorTolerance` | `tiers.ts:118` | the Monte-Carlo jitter source (deterministic per id) |
| web-side Tj heat model + `Component.temp` | `board.ts` | the temp-sweep substrate (settable today) |
| the once-per-frame `Snapshot` ring | `loop.ts` | the time-domain substrate |
| seeded generator convention | probe-arc §3a | `mulberry32(xmur3(id))`, generalized to `(template:session:difficulty)` |
| separate offscreen scratch `Simulation` | spine §4.2 | satisfiability + every multi-run pass; golden-irrelevant by construction |
| `conditionProfile` θ-walk | spine §3.1 (PWM/AC-source precedent) | the standing ramp |

### New — small, additive, web-side only

| Module | Contents |
| --- | --- |
| `web/src/lib/grader.ts` | the generalized `grade(spec: SpecLine[], …)` reducer; per-line pass-union dispatch; the `AcResult` input branch; the not-ready guard; the display-only weighted-score overlay |
| `web/src/lib/contracts/passes.ts` | `selectPass(line)`; the `{dc?,ring?,ac?}` cache; the multi-run wrappers (`sweepHeld`, temp/MC/corners) |
| `web/src/lib/contracts/realityTier.ts` | the rider/tier config + the `pass = baseGrade && pulledRiders.every(r=>r.hold)` fold |
| `web/src/lib/contracts/contracts.ts` | the `mulberry32` seeded generator + the satisfiability scratch-sim loop + the sampler-helper library (`pick`/`pickE`/`pickLog`/`pickFrom`/`tolFor`/`ticksFor`/`loadSweep`) + the standing scheduler |
| `web/src/lib/contracts/templates/*.ts` | per-family template DATA (~40 lines each); fixedRail + rcTiming first (MVP), then rectifier/regulator/filter/oscillator/currentLimit as eras unlock |

**None** touches `sim-core`, `buildNetlist` emission, the netlist, or
`snapshot_hash`. SPDX header on every new `.ts`/`.svelte`.

### New — engine-side, FLAGGED, deferred

A `Tj = Tamb + P·θ_JA` integrator that *drives* `Component.temp` from solved
dissipation. `Component.temp` exists as a *manually-set* field — the temp-SWEEP
pass (re-flatten at a *stated* `tempC`) is buildable today and is golden-safe;
only an **autonomous self-heating** over-temp tier needs the integrator. Ship
`real1temp` as a stated-corner re-flatten for MVP; defer self-heating (§9 Q3).

---

## 7. Determinism and golden-safety [the statement]

**The entire grader + contract supply engine is web-side game-state. It touches
NO `crates/sim-core`, NO `buildNetlist` emission, NO netlist, NO `snapshot_hash`.
`cargo test -p sim-core` (incl. `run_is_reproducible`) stays bit-identical — no
Rust change.**

1. **Reads only, never writes.** Time-domain lines read the already-batched,
   **unhashed** once-per-frame `Snapshot`: `state` node-V (which IS in
   `snapshot_hash` but is **read, not written**), `elementCurrents` (NOT hashed),
   `failedMask` (NOT hashed — `failed_elements` is excluded from `snapshot_hash`),
   via `electricalMap`. A window with an undefined `elementCurrents`/`failedMask`
   frame is **not-ready/FAIL**, never a silent zero-pass.
2. **Analytic AC is on-demand and unhashed.** Frequency lines call
   `acSweep`/`acElementMeasurements` (`loop.ts:98/:104`) — read-only, never mutate
   sim state, excluded from `snapshot_hash`, **no Nyquist limit** (mandatory above
   62.5 kHz where the transient aliases). No new crossing beyond the `ac_solve`
   calls Bode/phase already make.
3. **Multi-run passes are golden-irrelevant.** Satisfiability and every
   temp/Monte-Carlo/worst-case-corner pass run on a **separate offscreen scratch
   Simulation** with deterministic-per-id jitter (`tiers.ts`); each re-solve is
   internally deterministic (same seed → same jitter → same solve) and **none**
   compares its `snapshot_hash` to the golden.
4. **The boundary stays coarse** (golden rule #2): one batched snapshot read per
   frame; no per-line / per-contract / per-component crossing. Every multi-run
   pass runs on the offscreen scratch sim.
5. **Seeds are web-side.** All seeds are `mulberry32` off a string-hashed
   contract id — **never** the sim's fixed `SEED = 1337`, never `snapshot_hash`.
   Same seed → same supply (classroom-shareable, refresh-stable on
   `BoardBlob.contract`).
6. **The grader sits BESIDE `graphShape`** and never flips `complete`, so every
   topology-only example stays bit-for-bit unaffected.
7. **The JP is a tick-pure fixture** (PULSE→`ELEM_ACSOURCE` / SHUNT→`ELEM_RESISTOR`
   param-on-existing-element) — hashes like any element, replays byte-identically.
8. **The firewall is wired, not sloganed.** The weighted partial-credit score is
   display/telemetry only and **never** enters `applyEarn` — a 90%-passing
   brute-force earns zero. Locked by a vitest (§9 Q1).

*Cited surfaces verified:* `loop.ts:24/31` (optional `elementCurrents`/
`failedMask`), `loop.ts:98/104` (`acSweep`/`acElementMeasurements`, read-only),
`tiers.ts:118` (`resistorTolerance`), `bode.ts` / `phaseScope.ts` (the
`gainDb`/`phaseDeg` reductions), `Component.temp` settable.

---

## 8. Phased build

| Phase | Ships | Depends on |
| --- | --- | --- |
| **0 — grader spine** | `grader.ts` generalized to `SpecLine[]` with `last`/`mean`/`firstCross`/`period` verbs; `PinAddr` grade-time resolution; the not-ready guard; the display-only score; the firewall vitest | nothing (reads existing snapshot) |
| **1 — MVP families** | `fixedRail` + `divider` (DC) + `rcTiming` (transient) templates; the satisfiability scratch loop; the sampler helpers; the probe arc re-pointed at `grade()` as caller #1 | Phase 0 |
| **2 — contract FSM + batch** | the lifecycle states, the live checklist, SHIP-IT, batch payout via `applyEarn` | Phase 1; spine §3 |
| **3 — analytic AC families** | `gainDb`/`phaseDeg` verbs + the `AcResult` branch; `filter` + `oscillator` templates (AC pass + the generate-time θ_f branch baking) | Phase 0; `bode.ts`/`phaseScope.ts` AC path |
| **4 — reality riders** | the rider chips on the offer card; the MC pass + `sweepHeld`; the temp-corner re-flatten (stated-tempC); `realismMult` ceiling fold; the MC/temp bench-service Credit sinks | Phase 2 + 3; `tiers.ts`; spine §3.1 |
| **5 — standing scheduler** | the standing FSM, `conditionProfile` ramp, re-grade interval, lapse→RMA, the drifting-grace warning | Phase 2 + 4 |
| **6 — worst-case corners + reliability** | the corner wrapper (screened for k>3); the ship-N / MTBF / CEC-Certified gate | Phase 4 + 5 |
| **deferred** | autonomous self-heating Tj integrator; `logicLevel` + timing-closure event-trace verbs (Era-5a logic) | flagged in §6 / §9 |

---

## 9. Open questions / owner hand-offs

1. **Firewall, type-level.** Confirm the weighted partial-credit score is
   display/telemetry ONLY — never enters `applyEarn` — via a `DisplayGrade` branch
   the payout `GradeResult` path structurally cannot read, **plus** a vitest
   asserting no partial-pass mints Credits. *(The firewall's single failure mode.)*
2. **THE BIG QUESTION sign-off.** Confirm the **rider hybrid** framing (§4.4 — one
   instance + additive rider chips) over the parallel-tier framing (three
   acceptance tests). Both land a hybrid; the rider framing is cheaper to build
   (one base test + two pass-unions) and reads less like a difficulty modal.
3. **Reality-rider gating + the Tj question.** Does `real1temp` gate on **both**
   the tolerance tree node **and** the temp-sweep bench service (a genuine
   two-purchase climb)? And: ship `real1temp` as a **stated-tempC** re-flatten for
   MVP (no self-heating), or invest in a web-side dissipation→Tj model now?
4. **AC pass caching + satisfiability parity.** Confirm ONE `acSweep(logFreqs)`
   per grade (bracketing all spec `atFreqHz`), reduced for every AC line — not one
   solve per line — and that the satisfiability scratch sim runs the SAME AC pass
   for filter/oscillator (never an aliased transient). Set the `logFreqs` grid: N
   points, and whether a refine pass is needed around sharp `peakHz`/`cornerHz` so
   a high-Q filter or knife-edge band-edge is not mis-graded *(accuracy, not just
   cost)*.
5. **Per-line pass union.** Confirm `grade()` computes each distinct pass **once**
   (`{dc,ring,ac}` cache) and reduces all lines against the cache — no per-line
   re-solve.
6. **`realismMult` is a MAX.** Confirm `realismMult` is set to the **highest**
   pulled rider's rung (not summed/stacked) — riders raise the ceiling, they do
   not multiply each other.
7. **Standing partial-failure grace.** Does a standing contract get one
   "drifting out of spec" warning interval (Model-B score) before `lapsed`+`rma`,
   or crater instantly (spine §4.4)? Recommend grace **for standing only**, never
   batch. *(The one place the weighted score touches lifecycle, not the wallet.)*
8. **Monte-Carlo + corner cost knobs.** Set the MC draw count `N` (8? 32?) and the
   worst-case corner policy (full 2^k vs a screened subset for k>3), confirm the MC
   seed is `mulberry32` off the contract id, and cap active corner axes before
   `certified`. Do MC/temp-sweep ship as purchasable bench services (CEC-Certified
   greyed until owned) at MVP, or are they deferred to Era-4+?
9. **Oscillator boundary + rectifier clamp.** Confirm `template.simPass` derives
   transient-vs-AC from θ_f **at generate** so one oscillator family never
   straddles 62.5 kHz, and the rectifier `sampleParams` θ_f is hard-clamped
   ≤62.5 kHz.
10. **Difficulty calibration.** How aggressively do par-beats/predictions raise
    `gs.band` before it feels punishing, and is `d > 0.6` the right place to stack
    the second line per family? *(Telemetry; all numbers in one `balance.ts`
    table.)* Recommend `pickE` (E-series snap) in `sampleParams` so targets are
    buildable from the in-bin resistor set.
11. **Parked behind Era-5a logic.** `logicLevel` and timing-closure event-trace
    verbs (glitch-free over W, setup/hold @ θ_clk) — named in the schema, not
    deep-specced; the 2 µs grid bounds the max gradable clock.
12. **Generation cadence.** Confirm generation (K=8 satisfiability) runs strictly
    **on idle** with the verdict cached once-at-generate, and settle the standing
    background-tick budget (only-while-focused at MVP vs accruing idle income).

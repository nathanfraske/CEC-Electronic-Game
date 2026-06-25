<!-- SPDX-License-Identifier: Apache-2.0 -->

# The Per-Component Reality Curriculum — pacing the non-idealities, one at a time

> **Status:** design / planning (2026-06-25). **No code.** Game-design / UX +
> web-side only. **Golden-safe:** the non-idealities this doc paces are *already*
> modeled in `sim-core` and Real-mode-gated (`docs/sim/ideal-vs-real-parts.md`,
> `CLAUDE.md` "Component grades" + "Device variants & ratings" + "Gotchas"). This
> panel is a **curriculum / pacing / teaching design OVER that existing machinery** —
> it sequences *when* each reality aspect is introduced and *how* the player is eased
> into it, not new physics. Where a reality aspect is **not yet a visible event** (an
> electrolytic *burst*, not just the FAIL flag), it is flagged as a small **additive,
> golden-safe web-side/presentation** item.
>
> **Read first (the spine this paces onto, never re-derives):**
> - `docs/game-design.md` — **Pillar 2: fidelity is the progression.** "You do not
>   unlock bigger numbers; you unlock *more reality*." This curriculum is that pillar
>   made **per-component and sequenced.**
> - `docs/game-progression.md` — the **era spine** (Era 0 First Light → Era 7 FPGA),
>   the **tier ladder** (budget→mid→high→lab), the **Ideal→Real** framing, the
>   **Credits/Lux/competency** unlock recipe, the **Lab Notebook** (§5.1) and
>   **eureka discounts** (§5.2).
> - `docs/sim/ideal-vs-real-parts.md` — **fidelity IS the progression curve** (owner,
>   2026-06-16): basics are pure ideal; past-basics carry essential parasitics by
>   default; advanced play layers Real variants. The parts catalogue (ideal model →
>   real parasitics) is the **raw material** of the catalog below.
> - `docs/reality-roadmap.md` — which non-idealities are modeled vs need a mechanism;
>   the golden-safe levers (`param_or` 0-default, rating→FAIL unhashed).
> - `docs/game-contracts-deep-dive.md` — the **reality riders** (§4.4): a contract that
>   *demands designing around* a reality aspect (the MC / temp-corner pass). This is
>   the **pull surface** for the curriculum.
> - `docs/game-lux-and-lab-book.md` — the **Lab Book logs/teaches phenomena**; the
>   **autopsy** faucet; the **DEMONSTRATE** challenge = the eureka bridge.
> - `docs/bench-realism-and-emi-kernel.md` (IN FLIGHT) — the **lenses/instruments**
>   that SHOW the reality (thermal glow, reality lens, EMI spectrum, the frequency-morph).
> - `docs/ui/probe-teaching-arc.md` + `docs/ui/fundamentals-scaffold-arc.md` — the
>   **show-don't-tell** grammar (SHOW→NAME→NUMBER), **pull-not-pick**, the Ideal→Real gate.
>
> **House voice:** machinery in `[brackets]`. CEC bench-instrument register.

---

## 0. Thesis — reality is a curriculum, not a flood

The shipped engine already carries every reality aspect this doc cares about: a
resistor's lead inductance (`R_ESL = 10 nH`, `lib.rs:2701`), a cap's ESR/ESL
(`CAP_ESL = 1 nF` → SRF ≈ 5 MHz for 1 µF, `lib.rs:2694`), an inductor's DCR/Cw, a
source's output impedance, an op-amp's GBW (`OPAMP_GBW = 1e6`, `lib.rs:1864`) **and
its rail-clip saturation** (`Vsat·tanh`, `lib.rs:3093` / `4925` — *already modeled,
just unsurfaced*), a MOSFET's Kp (`MOS_KP = 0.02`, `lib.rs:1815`), a BJT's β
(`BJT_BF = 100`, `lib.rs:1838`), a diode's forward `Is`/`n` + reverse-recovery `TT`,
the diode/LED **variants**, and the **rating→FAIL** flag (`RATED_CURRENT_SLOT = 2`,
`lib.rs:2452`). They all **bite only in Real mode** (`tiers.ts`, `diodes.ts`, the
`ac_solve_models(omega, real)` gate, the `TRANSIENT_TIER_KINDS` web-side gate). They
are **golden-safe by construction** (§6).

The problem this panel solves is **not** "model more reality." It is: *a player who
meets all of that reality at once learns none of it.* The owner's framing:

> Every component has a REALITY aspect that should at some point be designed around,
> but NOT all at once. A resistor/SHUNT becomes an INDUCTOR at high frequency; an
> ELECTROLYTIC cap can BURST; an OP-AMP SLEWS; a DIODE has reverse-recovery; an
> inductor SATURATES; a source SAGS.

So the design is three things, in order:

1. **The CATALOG** (§2) — every component family's key reality aspect(s): the
   non-ideality, the model it already rides, **what you must design around**, the
   failure / visible event, and **whether it is modeled today or a flagged gap.** This
   is the *content*.
2. **The PACING / SEQUENCE** (§3) — the order they are introduced, **ONE AT A TIME**,
   gated on **player READINESS** (mastered the ideal → reached the era → chose the
   tier → *it actually bit*), mapped onto the **existing** fidelity-as-progression
   ramp / tier ladder / eras. This is the *curriculum*.
3. **The PLAYER-FACING EASE-IN** (§4) — **SHOW-DON'T-TELL**: the first time a reality
   aspect *bites* (the shunt that suddenly has phase, the cap that bursts), a **lens**
   reveals WHY, the **Probe** narrates, the **Lab Book** logs it, and a **rider
   contract** lets you design around it — read in a **by-feel** channel (the wave
   skews, the cap pops) *and* an **EE-numeric** channel (+32°, 0.5 V/µs, 4 % droop).
   This is the *teaching*.

**The single governing rule** (it is just Pillar 2, per component): *a component's
reality is introduced the first time it would change a design the player has already
gotten working ideally.* You earn the ideal, then meet the one reality that breaks
your ideal assumption, then design around it — and only then does the next reality
arrive. Reality is **pulled by the next contract / the next tier / the next era**,
never dumped.

```
[master the ideal]  →  [one reality BITES]  →  [a lens shows WHY]  →
[the Lab Book logs it]  →  [a rider contract makes you design around it]  →
[the next reality]
```

**Relationship to the existing systems (this is a pacing, NOT a fifth system).** The
three "more reality" axes the docs already define — the **Ideal→Real fidelity step**,
the **tier ladder**, and the **era tech-tree** — *are* a reality curriculum; they just
aren't **paced per component**. This doc adds exactly one thing: the **per-component
sequence on those axes** plus a small **per-aspect REALITY RECORD** (§2.7) that binds
each reality to the tier slot that exposes it, the lens that shows it, the Lab Book
page it fills, the rider that demands designing around it, and the detector that says
"it bit." No new ramp, no new currency, no new hashed state.

---

## 1. How "more reality" already maps onto the progression (the ramp this paces onto)

Name the **three orthogonal "more reality" axes the docs already define**, so this
panel paces onto them rather than inventing a fourth. (Verified against
`game-progression.md` §0, §2; `ideal-vs-real-parts.md`; `tiers.ts`;
`game-contracts-deep-dive.md` §5.6.)

| Axis | What grows | Reality it carries | Gate / readiness signal | Owned by |
| --- | --- | --- | --- | --- |
| **The Ideal→Real fidelity step** | a part's *baseline* fidelity | the **essential** parasitic a part can't physically exist without (diode I-V, transformer leakage, cap ESR) | **past the basics** — the part carries it by default the moment you build past R/C/L/V/I (`ideal-vs-real-parts.md` "fidelity IS the progression curve") | the part's baseline model |
| **The tier ladder** (budget→mid→high→lab) | a part's *quality grade* | the **spec'd** non-ideality (op-amp GBW, source output-Z, R tolerance, EC ESR) — **bites only in Real mode** | the player **chose a tier** in the inspector; Real mode on (`tiers.ts`, `TRANSIENT_TIER_KINDS`) | `tiers.ts` |
| **The era / tech-tree** | the *parts in your bin* | a whole new **domain** of reality (Era 2 = the diode age = one-way conduction + recovery; Era 4 = gain/feedback/saturation; Era 6 = grounding/EMI) | **Lux licensed the era** + competency exam + Credits (`game-progression.md` §3) | `game-progression.md` |

**The key realization:** these three axes ARE a reality curriculum already — they just
aren't *paced per component*. The Ideal→Real step says *whether* a part carries its
essential reality; the tier says *how good* a part is; the era says *what new reality
domain* you've entered. What's missing — and what this doc adds — is the
**per-component sequence ON those axes**: which reality aspect of which part is the
*next one* a player meets, and the trigger that decides "now."

**The three readiness signals (already in the engine / docs), restated as this
curriculum's gates:**

1. **Mastered the ideal version** — the player has gotten the *ideal* part working (a
   `graphShape` completion, a shipped Ideal-tier contract, a Lab Book concept page for
   the ideal behaviour). This is the `competenceDetected` / `seenConcepts` / par-clear
   family the Probe and fundamentals arcs already detect (`probe-teaching-arc.md` §5;
   `fundamentals-scaffold-arc.md` §4).
2. **Reached the era** — `unlockedNodes` contains the era node that brings the part
   (`game-lux-and-lab-book.md` §3.1 `canUnlock`/`unlockNode`/`unlockedTags`).
3. **Chose a tier** — the player set `Component.tier` (or `Component.variant`) in the
   inspector, i.e. *opted into* a graded part, and **Real mode is on** — the only place
   tier non-idealities bite (`tiers.ts` realistic-mode gate). *(Identity realities —
   forward `Vf`, a diode family — skip this clause: they bite in both modes.)*

A per-component reality aspect is **offered** (pull-not-pick) only when its readiness
signal is lit **and it actually bit on the player's board** (§3.3). **Nothing is ever
forced;** the bench stays sandbox-primary — but the *first time* a reality bites on a
board the player built, the ease-in (§4) fires.

---

## 2. THE CATALOG — each component family's key reality aspect(s)

> **Reading the table.** *Non-ideality (★ = the PRIMARY)* = the reality aspect; the
> **★ primary** is the identity-breaking one that anchors the part's place in the
> sequence (§3) — its secondary aspects defer down the tier ladder / to riders.
> *Model / [machinery]* = the sim-core / web machinery that already produces it (cite).
> *Design-around* = the engineering judgement the player must make to live with it (the
> contract/lesson hook). *Failure / visible event* = what it does at the limit (the
> FAIL / autopsy / lens hook). *Modeled today vs gap* = the honest build-state — one of:
> **`already-visible`** (the symptom shows now), **`modeled-but-unsurfaced`** (the
> physics is in the core, only a detector/lens/copy is missing), **`rating-flag-only`**
> (it FLAGs via the unhashed mask, no destruction shown yet), or a **GAP** —
> **`gap:presentation`** (a golden-safe additive over the unhashed `failedMask`) or
> **`gap:physics`** (a deliberate Real-gated `param_or`-0 golden move, deferred). All
> modeled rows are **golden-safe** per §6.

### 2.1 Passives

| Component | Non-ideality (★ = primary) | Model / [machinery] | Design-around (the lesson) | Failure / visible event | Modeled today vs gap |
| --- | --- | --- | --- | --- | --- |
| **R (resistor)** | ★ **lead inductance** (becomes an INDUCTOR at HF); **tolerance**; (power rating / tempco) | `R_ESL = 10 nH`, AC path `Y = 1/(R + jωL)` [`lib.rs:2701`, `CLAUDE.md` Gotchas]; `resistorTolerance(tier)` web jitter [`tiers.ts:118`] | at HF a "resistor" adds phase — invisible on 10 kΩ, real on a shunt; size tolerance against a spec band, not the nominal | (power-burn / tempco at the limit) | `already-visible` (`R_ESL` AC-only + tolerance MC); tempco/power-burn = **gap:physics** (out of scope) |
| **SHUNT (current sense)** | ★ **the resistor-becomes-inductor lesson, made VISIBLE** — a 10 mΩ shunt at 100 kHz reads **~+32° phase** | `ELEM_RESISTOR` at milliohms + `R_ESL`; `phaseScope.ts` [`CLAUDE.md` "SHUNT" + R-ESL] | place the shunt where its phase doesn't corrupt the measurement — *the canonical first "a part isn't what its label says" moment* | (measurement lesson — no wreck) | `already-visible` (AC-only, fully visible via `phaseScope`) |
| **C (capacitor)** | ★ **self-resonance** (ESL → becomes INDUCTIVE past SRF); **ESR** (loss); leakage; voltage rating | ESR/ESL params, AC-only [`tiers.ts` C slots `[ESR, ESL]`; `CAP_ESL = 1 nF`, `lib.rs:2694`]; frequency-morph past SRF [`bench-realism…` §2] | a decoupling cap **stops decoupling** past its SRF; pick dielectric/tier for the band | over-V → rating flag (**BURST not yet a visible event** — §2.6) | `already-visible` (ESR/ESL morph); over-V burst = **gap:presentation** |
| **EC (electrolytic)** | ★ **polarity / over-V → BURST** (the pop); bigger ESR; voltage rating; large tolerance; (wear-out) | ESR via `ecEsr(tier)` web expansion (mid = 0.5 Ω) [`EC_ESR_BY_TIER` table at `tiers.ts:104`, read by `ecEsr()` at `tiers.ts:107`]; rating→FAIL | size ESR for ripple current; **never reverse it**; derate voltage | **reverse / over-V → BURST** (vent + spray) — *flagged, visible event NOT yet — §2.6* | ESR `already-visible`; rating `rating-flag-only`; **BURST = gap:presentation (THE HEADLINE)**; dry-out wear = gap (out of scope) |
| **L (inductor)** | ★ **core SATURATION** (L collapses above I_sat → inrush surge); **DCR** (winding R); winding-C self-resonance | DCR/Cw params, AC-only [`tiers.ts` L slots `[DCR, Cw]`] | DCR drops efficiency; **don't exceed I_sat** or the inductor stops inducting | **core saturation → inrush surge** (*DCR/Cw modeled; the L-collapse is NOT — §2.6*) | DCR/Cw `already-visible`; saturation = **gap** (MVP: web flag `gap:presentation`; real L-collapse = `gap:physics`, deferred) |

### 2.2 Diodes & the diode family

| Component | Non-ideality (★ = primary) | Model / [machinery] | Design-around | Failure / visible event | Modeled today vs gap |
| --- | --- | --- | --- | --- | --- |
| **D (diode)** | ★ **reverse recovery** (`TT` diffusion-charge spike); **forward drop** (`Is`/`n` — the *identity*); current rating; **family** (switching/rectifier/fast/power) | forward `Is`/`n` both modes; `TT` reverse-recovery companion, Real-only (`DIODE_TT_SLOT = 3`, `inv_dt`) [`diodes.ts`, `CLAUDE.md` "Reverse recovery"]; rating→FAIL | budget the `Vf` drop; **pick the family for the speed** (a slow rectifier rings in a switcher); rate the current | switch-off → **reverse-current spike**; over-current → FAIL/autopsy | forward `Vf` `already-visible` (identity, both modes); `TT` spike `already-visible` (Real-only); rating `rating-flag-only` |
| **LED** | ★ **easy to burn out** (~30 mA rating → POP); **colour sets Vf** (identity) | `LED_COLORS` Is-per-Vf + tint (red ~1.94 V → white ~3.1 V) [`diodes.ts:54`]; 0.03 A rating [`diodes.ts:56`] | size the series R for the colour's Vf at the target current (the **Probe blow-up lesson**) | over-current → **pop** (the cold-open) | Vf `already-visible` (both modes); rating `rating-flag-only` → the **LED-pop precedent** for every burst additive |
| **ZD (zener)** | ★ **dynamic impedance** (the knee isn't vertical); power | breakdown model **in core** (`ELEM_ZENER = 10`, `zener_breakdown_model`, `lib.rs:1929`; tested `zener_clamps_reverse_voltage`) | the regulated rail isn't flat under load; budget the knee | over-power → FAIL | breakdown `already-visible` (verified in core); power-burn = gap |
| **SD (schottky)** | ★ **low `Vf` + no reverse recovery** (`TT = 0`) traded for higher reverse leakage | `TT = 0` Schottky-like [`diodes.ts`] | the speed/leakage trade — why a switcher uses Schottky | over-current → FAIL | `already-visible` (variant identity, both modes; `TT=0` bit-identical) |
| **MOV (varistor)** | ★ **clamps, then WEARS OUT** (energy/joule rating) | symmetric breakdown clamp **in core** (`ELEM_VARISTOR = 16`, `varistor_eval`, `lib.rs:3066`; tested `varistor_clamps_positive_surge`) | one-shot protection that degrades — design for replacement | absorbed-too-much → FAIL/vent | clamp `already-visible` (verified in core); over-energy flag = `rating-flag-only` (joule slot, §2.6); joule-wear accumulator = **gap:presentation** |

### 2.3 Sources

| Component | Non-ideality (★ = primary) | Model / [machinery] | Design-around | Failure / visible event | Modeled today vs gap |
| --- | --- | --- | --- | --- | --- |
| **V (voltage source)** | ★ **output impedance** — the rail **SAGS** under load (IR droop) | output-Z param, transient, Real-only [`tiers.ts` V slot `[Rout]`: budget 1 Ω sags, lab 5 mΩ holds; `TRANSIENT_TIER_KINDS`] | a budget supply browns out a heavy load; a lab supply holds — **pick the tier for the load** | brown-out (rail reads `--warn` past ~4 % droop) [`game-progression.md` §1.2] | `already-visible` (transient, Real-only); ripple = gap (presentation) |
| **AC** | ★ **source impedance** — why a real bridge inrush is bounded | output-Z param [`tiers.ts` AC slot] | mains has impedance; an *ideal* AC into a bridge FAILs, a real one rings | degenerate ideal → FAIL | `already-visible` (transient) |
| **I (current source)** | ★ finite output impedance; **compliance limit** (can't force I past its rail) | output-Z; compliance **roadmap-claimed, unverified in core** (`ELEM_ISOURCE = 4` has no compliance clamp today — `reality-roadmap.md` intent) | the current source gives up at its compliance voltage | over-compliance → FAIL | compliance = **gap** (roadmap intent, not shipped); compliance flag = `rating-flag-only` (§2.6, web-side) |
| **PULSE (clock/pulse gen)** | ★ edge content → **harmonics** (the EMI aggressor) | `ELEM_ACSOURCE` + waveform slot [`CLAUDE.md` "PULSE"] | a fast edge round a big loop radiates — **slow the edge** [`bench-realism…` §3.3] | emissions over the line → cert FAIL (EMI kernel) | source param `already-visible`; EMI spectrum = `bench-realism` (in flight) |

### 2.4 Active devices

| Component | Non-ideality (★ = primary) | Model / [machinery] | Design-around | Failure / visible event | Modeled today vs gap |
| --- | --- | --- | --- | --- | --- |
| **OA (op-amp)** | ★ **SLEW-rate limiting** (output can't keep up with a fast edge — *the player-facing "op amp skews" reality this curriculum would add*); **finite GBW** (gain rolls off); **rail clip** (`Vsat`); output-Z; (offset/bias) | GBW param, AC-only (`OPAMP_GBW = 1e6`) [`tiers.ts` OA slot 0 — the **only** op-amp non-ideality in the core today, `ac_solve_models`]; **`Vsat·tanh` rail clip ALREADY in core** [`lib.rs:3093`/`4925`]; `GOUT` output-Z; **slew = PROPOSED transient param** (not yet in sim-core — only a future-feature note at `lib.rs:2587`) | bandwidth is finite — a fast signal slews/distorts; pick the tier (300 kHz budget → 50 MHz lab) for the signal; don't drive it into the rail | slew → distortion; over-drive → **flat-top clip** | GBW `already-visible`; **slew = `gap:physics`** (new transient param to add, Real-gated); **rail clip = `modeled-but-unsurfaced`** — only a detector + lens copy missing (*the cheapest teaching win*, §2.6); offset/bias = gap |
| **NM / PM (MOSFET)** | ★ **finite Kp** (drive strength ∝ Rds(on)); (body diode, gate cap, SOA) | Kp param, transient, Real-only (`MOS_KP = 0.02`) [`tiers.ts` NM/PM slot] | a weak FET won't pass the current — pick the tier; (switching speed when gate-cap lands) | over-current / SOA → FAIL | Kp `already-visible`; SOA vent = gap (behind `Tj`, §2.6) |
| **Q / QP (BJT)** | ★ **finite β** (base current); **thermal runaway**; (Early effect, β rolloff, SOA) | β param, transient, Real-only (`BJT_BF = 100`) [`tiers.ts` Q/QP slot] | a low-β part starves the base — bias for it; **bias for thermal stability** | thermal runaway (phenomenon, `game-progression.md` §5.1); SOA → FAIL | β `already-visible`; runaway/SOA vent = **gap:physics** (needs `Tj` infra, deferred) |

### 2.5 Magnetics, electromechanical, digital

| Component | Non-ideality (★ = primary) | Model / [machinery] | Design-around | Failure / visible event | Modeled today vs gap |
| --- | --- | --- | --- | --- | --- |
| **TR (transformer)** | ★ **leakage / magnetizing L** (carried by default); winding R; (core saturation) | ideal-T + `TRANSFORMER_LLEAK` floor + winding R [`ideal-vs-real-parts.md`]; **deliberately un-tiered** (leakage is the inrush-stability knob) [`CLAUDE.md`] | leakage is *why* the bridge inrush is bounded; (core saturation when modeled) | degenerate zero-leakage → FAIL; core-sat (later) | leakage `already-visible`; core-sat = **gap:physics** (magnetizing runaway, deferred) |
| **SW (switch)** | ★ on-resistance; off-leakage; (contact bounce) | 0.01 Ω on-R + 1 nS off-leak [`ideal-vs-real-parts.md`] | the switch isn't a perfect short/open | topology events | `already-visible`; bounce = gap |
| **Logic gates / FF** | ★ finite **drive strength** + **prop delay** + **metastability** (setup/hold); family thresholds (CMOS/TTL) | 5-pin powered gate, ~1 Ω drive, 1-tick delay, family thresholds [`CLAUDE.md` "Powered logic gates"]; DFF hashed | a slow edge into a threshold → an unknown `X`; meet setup/hold | metastability (phenomenon) | `already-visible`; richer timing = gap |
| **POT** | ★ wiper contact R; taper (log/lin); tolerance | 0.5 Ω wiper floor [`ideal-vs-real-parts.md`] | the wiper isn't ideal; taper shapes the sweep | (no wreck) | `already-visible` |

### 2.6 The NOT-YET-MODELED reality events (flagged additives — split by risk class)

Several reality aspects are **flagged in the engine but not yet a *visible event*** —
the part FAILs (boxed red) but the *characteristic destruction* isn't shown. These are
the owner's headline examples ("an electrolytic cap can BURST"). They split into **two
risk classes** (the §5 ledger):

- **CLASS A — pure web-side presentation, ZERO sim-core touch, byte-identical
  golden-safe.** Rides the **existing unhashed `failedMask`** exactly as the Probe
  blow-up does (`probe-teaching-arc.md` §4; `failed_elements` is **not** in
  `snapshot_hash`), or a flag-only rating slot mirroring `RATED_CURRENT_SLOT`, or a
  detector over the once-per-frame snapshot. **The whole MVP curriculum ships here.**
- **CLASS B — a deliberate, Real-mode-gated, `param_or`-0-default *new transient
  physics*** that regenerates the Real-mode golden in its own explained PR. **Deferred;
  the curriculum does not depend on it.**

| Event | Today | The additive | Risk class | Precedent |
| --- | --- | --- | --- | --- |
| **Op-amp rail clip / saturation** (the cheapest win) | **modeled** (`Vsat·tanh`, `lib.rs:3093`/`4925`) — but **not surfaced** as a taught phenomenon | a web-side **"saturation" detector** (output pinned near ±Vsat while input still moves) + a lens/Probe copy line + a Lab Book page — **NO new physics, NO new particle** | **CLASS A** | the Probe blow-up; reads existing tanh-clipped output |
| **Electrolytic BURST** (reverse / over-V / over-temp) — **THE HEADLINE** | rating → `failedMask` flag (red box) | a one-shot **vent animation** (pop + electrolyte spray + charred tint) on the rising edge of `failedMask[ec]`, wall-clock driven; an **autopsy** page per mode | **CLASS A** | the LED **pop** blow-up — *identical particle machinery* |
| **Cap BURST / venting** (ceramic crack, film) | rating flag | same one-shot vent presentation as EC, **tuned per dielectric** | **CLASS A** | EC burst above |
| **Voltage / energy ratings → FAIL** (cap over-V, MOV joule, source compliance) | unmodeled for these kinds | a **NEW web-side detector** over the once-per-frame snapshot — *not* a byte-for-byte mirror of `RATED_CURRENT_SLOT` (current is read for every element in-core at `lib.rs:6803`; there is **no existing per-element voltage or accumulated-joule quantity** in the snapshot, so a sampler must derive `\|V\|` / `joules` web-side). It only FLAGs, never alters the solve, and stays unhashed — hence still **CLASS A** | **CLASS A** | the current-rating reuse is the only *zero-new-derivation* mirror; any sampler reading node voltages → **Open-Q4 determinism review** |
| **MOV joule-wear** | clamp modeled | a web-side **wear accumulator** (unhashed) → degraded clamp → eventual vent | **CLASS A** | rating-FAIL + autopsy |
| **Inductor SATURATION** | DCR/Cw modeled (AC); saturation not | **MVP:** a web-side flag when `\|I\| > I_sat` (rating-style, unhashed) + lens glow — *teaches the symptom*. **Real:** an I_sat companion that collapses L in the transient solve | **A (flag)** / **B (real L-collapse)** | rating→FAIL; the `inv_dt` reactive seam |
| **Op-amp SLEW (dV/dt limit)** | **NOT modeled** — the transient op-amp is algebraic / infinite-bandwidth (`lib.rs:7057`); only **GBW** (AC-only) and the **rail clip** (`Vsat·tanh`) exist today | a new **transient dV/dt clamp / output-integrator companion** that rate-limits the op-amp output — a Real-mode-gated, `param_or`-0-default slot (a slew param) in its **own explained PR** | **CLASS B** | the inductor L-collapse / `Tj` golden-move pattern |
| **BJT/FET thermal runaway → SOA vent** | runaway is a *detectable phenomenon*; SOA not a visible burn | **MVP:** thermal-lens glow ramps to white + a vent on SOA-FAIL + a web-side `Tj` estimate. **Real:** a per-device `Tj` state axis feeding bias | **A (flag/lens)** / **B (real `Tj`)** | the `Tj` model + thermal lens (`bench-realism…` §1) |
| **Transformer core saturation** | leakage floor only | **MVP:** web flag + lens. **Real:** a magnetizing-current-runaway core-sat term | **A (flag)** / **B (real core-sat)** | `reality-roadmap.md` `Tj` pattern |

> **A correction worth stating plainly.** The op-amp **rail clip** (`Vsat·tanh`) is
> **already in the deterministic core** (`lib.rs:3093` / `4925`); surfacing it as a
> taught "saturation" is **CLASS A presentation — a detector + copy, NOT a golden
> move.** It is the **lowest-cost teaching win** of the whole panel and should ship in
> the same MVP wave as (or just before) the EC burst.

> **Determinism note on the additives.** Every CLASS A row is byte-identical
> golden-safe (the LED-pop / flag-slot precedents). The CLASS B variants (inductor
> L-collapse, transformer core-sat, real `Tj` runaway) are flagged as **deliberate,
> Real-mode-gated, `param_or`-0-default golden moves** — NOT shipped silently; each
> would be its own explained PR with regenerated Real-mode coverage and the transient
> golden untouched (`reality-roadmap.md` guardrails). **This doc does not require
> them** — the *visible-event* curriculum can ship entirely on the CLASS A path.

### 2.7 The REALITY RECORD — the per-aspect glue (the curriculum's data shape)

The four systems this curriculum paces over (tier ladder, riders, Lab Book, lenses)
each already carry a "reality" key, but **nothing binds those keys to one
`aspectId`.** The single integration artifact this doc adds is a **per-aspect REALITY
RECORD** — a web-side ordered table (a neighbour of `econ/labNotebook.ts`) that turns
four parallel systems into **one paced axis** with no new hashed state. The *order* of
the list IS the §3 sequence; the §3.3 gate walks it and offers the first aspect whose
predicates are lit and whose `reality:<aspectId>` is unclaimed.

Each record binds **five existing keys** + the readiness signal:

| Field | Binds to | Example (op-amp slew) |
| --- | --- | --- |
| `aspectId` | the dedupe key (`reality:<id>` in `claimedLux`, sibling of `concept:`/`phenomenon:`/`autopsy:`) | `oa-slew` |
| `tierExposesVia` | the `tiers.ts` slot / `ecEsr`/`resistorTolerance` that EXPOSES it; **mark `always-on` for identity/rating realities** that ignore tier (LED rating, forward `Vf`, shunt `R_ESL`) | OA slot 0 (GBW), tier-paced |
| `lensId` | the `bench-realism` lens that SHOWS it (thermal / reality / frequency-morph / EMI / bus-magnitude-bar / scope) | scope edge + Bode |
| `phenomenonOrAutopsyId` | the Lab Book page it fills (`phenomenon:<id>` for measurement realities, `autopsy:<mode>` for destructive ones) + the `challenge:demo-`/`challenge:break-` deck row | `phenomenon:slew` + `challenge:demo-slew` |
| `riderId` | the `game-contracts-deep-dive.md` §4.4 `Rider.id` whose `addsPass` proves you designed around it | a `slew/bandwidth` hold |
| `detectorSig` | the read-only sampler signature that fires §3.3 clause 4 ("it bit") — **reuses the contract grader's sampler exactly** | output dV/dt clamped vs ideal edge |
| `eraGateNode` + `seenConceptsIdealKey` | the `unlockedNodes` era node + the `seenConcepts` ideal-mastery key | Era 4 node + `concept:gain` |

This record is **pure web-side game-state** (none of its fields are hashed) and is the
concrete shape the §3.3 gate and the §4 four-beat read. Recommended as the curriculum's
canonical data structure; the build artifacts (§7) populate one record per catalog row.

---

## 3. THE PACING / SEQUENCE — one reality at a time, onto the existing ramp

> **The principle:** a component's reality aspect is introduced the first time it would
> change a design the player has **already gotten working ideally** — and never before
> the readiness signal (§1) is lit. The sequence rides the **era spine**
> (`game-progression.md` §6) as the COARSE clock and the **tier ladder** as the FINE
> clock, introducing **one reality per step**, each gated, each with its own ease-in (§4).

### 3.1 The ordered sequencing table — the reality curriculum mapped onto the eras

> Columns add a **first-bite SEE-cost** (what instrument/context the player needs
> before the symptom is even legible) and the **gate kind** (which §2.7 key fires it).
> The SEE-cost rises monotonically with the era — *that is why the era order and the
> reality order coincide* (cheapest-to-see first).

| Step | The ONE reality | Component | Readiness GATE (all must hold) | Design-around (the pull) | First-bite SEE-cost | Gate kind |
| --- | --- | --- | --- | --- | --- | --- |
| **0** First Light | **none — pure ideal.** R/C/L/V/I self-regularize | — | n/a (reality deliberately absent) | the ideal divider / RC curve (`probe-teaching-arc.md` Acts 1–3) | — | — |
| **1** The hook | **LED burns out** (current rating) | **LED** | press Run on a resistor-less LED (the cold-open) — **bites at every tier on purpose** | add the current-limiting R | **1 gesture** (cheapest, visceral) | `always-on` rating-FLAG |
| **2a** | **rail SAGS** (source output-Z) | **V** | Real mode + a shipped Ideal divider (mastered) — **effectively always-on once Real mode is on** (the default/mid tier still has a non-zero `Rout` = 0.1 Ω that sags a heavy load; a default-tier player never explicitly picks a tier, so the budget-tier pick is *amplification*, not a precondition — see Open-Q below) | pick the supply tier for the load | a **load on the bus** + the magnitude bar | transient-web |
| **2b** | **R tolerance** | **R** | as 2a | the first **Real-5 % MC rider** (`game-contracts-deep-dive.md` §4.4) | an **MC sweep** result | transient-web |
| **3a** | **forward `Vf` judgement** | **D family** | era licensed + a working rectifier (the rectification page) | budget the `Vf` | a working **rectifier** | both-modes (identity) |
| **3b** | **reverse recovery** (`TT`) | **D family** | as 3a + a switching context | pick the **family** so the spike doesn't ring | **time-scope** + a hard switch-off | transient (Real-only) |
| **4a** | switch on-R / bounce; relay latch | **SW / relay** | era licensed | debounce; design for the latch | a **topology event** | both-modes |
| **4b** | **thermal derating / runaway** | **thermistor / BJT** | era licensed + the thermal lens available | bias for stability; derate | the **thermal lens** glow | flag/lens (Real) |
| **5a** | **op-amp finite GBW** (bandwidth rolloff) — *slew is the deferred CLASS B follow-on, see below* | **OA** | era licensed + a working amplifier (gain demonstrated) + chose a tier | a contract demanding a **bandwidth** (pick the tier) | the **Bode / phase scope** (frequency domain — GBW is AC-only) | AC-only (GBW) |
| **5b** | **op-amp rail CLIP** (`Vsat`) | **OA** | as 5a + drove the output to the rail | don't over-drive; size the gain | the output **flat-tops** (the §2.6 detector) | `modeled-but-unsurfaced` |
| **5c** | **β / Kp drive limits** | **Q/QP → NM/PM** | as 5a | bias for finite β; pick the FET tier | a **weak stage** under load | transient-web |
| **6** | **pin boundary** (slow edge → `X`); **decoupling** (cap SRF) | **gates / decoupling C** | era licensed | place decoupling within the SRF band; meet setup/hold | the **frequency-morph** lens | AC-only |
| **6′** | **SHUNT +32° phase** (the `R_ESL` micro-lesson) | **SHUNT** | era licensed + the phase scope | place the shunt so phase doesn't corrupt | the **phase scope at 100 kHz** | AC-only |
| **7** | **EMI / grounding / loop area** (the capstone) | **PULSE aggressor / loop geometry** | era licensed + the EMI lens/spectrum | tighten the loop, slow the edge (the **EMI rider / cert gate**) | **geometry + the analytic-AC EMI spectrum** (most expensive) | EMI kernel (web) |
| **8** | (sealed-circuit reality inherits the above) | player's sealed dies | era licensed | — | — | — |

**Why this order is the right curriculum (not arbitrary):** it is the **join** of
three constraints the docs already commit to —

1. **It rides the era spine** (`game-progression.md` §6) — reality arrives *with the
   parts that carry it*, so no reality is taught before its component exists in the bin.
   **Step 1 (the LED burnout) is the one exception: it is the pre-era onboarding
   *cold-open*** (the fire-on-Run blow-up, `probe-teaching-arc.md` Act 0), deliberately
   *before* the era-gated steps — the era spine is the **coarse clock that holds from
   Step 2 onward** (the LED itself isn't an Era-1 part; the pop is onboarding spectacle,
   not the era-paced diode lesson, which arrives as Step 3a).
2. **It introduces the cheapest-to-SEE reality first** — the LED *pop* (one gesture)
   before the rail *sag* (needs a load) before *GBW / phase* (needs the frequency
   domain) before *EMI* (needs geometry + the analytic AC path). This is the same
   gradient the bench-realism rail commits to (`bench-realism…` §7: "heat is the
   gentlest… EMI is the capstone"). The **gate kind** column is the pacing key: it tells
   the sequence WHEN a row *can* fire — `both-modes` identity (forward `Vf`, earliest,
   no Real gate) < `rating-FLAG` (LED pop, the Era-1 hook) < `transient-web` (sag,
   β — needs Real + tier) < `AC-only` (op-amp GBW, shunt phase, cap SRF — needs the
   frequency domain) < `gap` (burst, saturation, **op-amp slew** — gated behind the
   additive / CLASS B physics shipping).
3. **Each step's reality breaks an assumption the previous ideal step let you make** —
   you learned the divider ideally (Step 0), so the *first* tolerance contract (Step 2b)
   teaches "the divider drifts"; you learned gain ideally (Step 5a entry), so *slew*
   teaches "gain has a speed limit." **The ideal is the setup; the reality is the
   punchline.**

### 3.2 The within-component micro-sequence (when ONE part has several realities)

A component with multiple reality aspects (the op-amp: GBW, slew, clip, offset,
output-Z; the cap: ESR, ESL, leakage, rating) does **not** reveal them all when the
part unlocks. They are paced **within** the part by the **tier ladder** and **rider
contracts**:

```
[part unlocks, IDEAL]            → the clean textbook part works
[chose a tier, Real mode]        → ONE tier non-ideality bites (op-amp: GBW rolloff)
[a rider contract demands it]    → a SECOND reality must be designed around (slew)
[a higher tier / harder rider]   → the next (clip, offset, output-Z) — only as pulled
```

The tier ladder is the **natural pacing dial** for a single part's realities: a
**budget** part exposes its non-ideality loudly (a 300 kHz GBW op-amp slews on
everything), a **lab** part hides it (50 MHz) — so *choosing budget is choosing to meet
that reality.* This is **pull-not-pick at the component level**: the player who buys
budget pulls the reality lesson; the player who buys lab defers it. **The REALITY
RECORD (§2.7) should therefore order each part's aspects by which tier/rider surfaces
them.** (`tiers.ts` realistic-mode gate is the existing machinery; this doc just names
it as the within-component pacer.)

### 3.3 The gate logic (reusing the existing readiness machinery — no new state)

A per-component reality aspect's ease-in (§4) **fires once**, the first time **all** of
its gate conditions hold, deduped against the **existing `seenConcepts` / `claimedLux`
ledgers** (`game-lux-and-lab-book.md` §1.2):

```
fireRealityEaseIn(aspectId) when, the FIRST time:
    masteredIdeal(component)        // seenConcepts ⊇ the ideal concept, or a par-clear
    AND eraReached(component)       // unlockedNodes ⊇ the era node
    AND (realModeOn AND choseTier)  // SKIPPED if the aspect is `always-on` (identity Vf, LED rating)
    AND theAspectActuallyBitOnThisBoard   // the lens/detector saw it on the player's circuit
  → offer the lens + Probe line + Lab Book page    // pull-not-pick, one per idle frame
  → dedupe on `reality:<aspectId>` in claimedLux
```

The fourth clause — *it actually bit on this board* — is the **show-don't-tell**
anchor: the lesson fires when the shunt *actually has phase*, the rail *actually sags*,
the cap *actually crossed its SRF*, the op-amp output *actually flat-topped* — detected
by the **same read-only samplers** the contract grader and Lab Book detectors already
use (`game-contracts-deep-dive.md` §7; `game-lux-and-lab-book.md` §6). **No new wasm
crossing, no new hashed state.** Because the detector and the rider's grader read
*identical physics*, the event that fires the SHOW is the same event a rider would
grade — the SHOW and the DESIGN-AROUND can never diverge.

### 3.4 Sandbox vs forced-curriculum — pace the lesson, never the sim

The era/tier gates keep the **forced-curriculum path strictly one-reality-at-a-time**.
The **sandbox stays open**: a player who places a budget op-amp + a 10 mΩ shunt + a
reversed EC at once sees **all three symptoms** (the sim is honest — the slew, the
phase, the pop all show). The ease-in **drain** serializes only the *teaching* (one
card per idle frame, §4.4). **The governing rule: pace the LESSON, never the SIM.**

---

## 4. THE PLAYER-FACING EASE-IN — show-don't-tell, one reality at a time

> The grammar is the one the Probe/fundamentals arcs already commit to:
> **SHOW (the reality bites, in motion/light, zero reading) → NAME (one clause where
> the eye already is) → NUMBER (one pull deeper) → DESIGN-AROUND (a rider contract)**
> — `probe-teaching-arc.md` §2; `fundamentals-scaffold-arc.md` §0.5. Pull-not-pick: the
> lens is offered after a **win**, never as a wall. **Symptom before word is absolute.**

### 4.1 The four-beat ease-in (every reality aspect uses it)

1. **It BITES (SHOW).** The reality first appears as a *visible anomaly on the player's
   own working circuit* — the rail belt sags and reads `--warn`; the shunt's phase scope
   swings +32°; the op-amp's output **flat-tops at the rail** (the modeled `Vsat·tanh`
   clip — its true time-domain bite today; the sloped *slew* edge is the deferred CLASS B
   companion) or its Bode rolls off past the GBW corner; the cap's
   decoupling stops working past its SRF; the LED/EC pops. **The player sees the symptom
   before any word.** Detected on the **honest replay** (the §3.3 fourth clause), so it's
   real, not scripted.
2. **A LENS reveals WHY (SHOW→NAME).** The relevant **lens** (`bench-realism…` §5) makes
   the invisible cause visible: the **thermal** lens for heat/runaway, the **reality**
   lens + **frequency-morph** for cap-goes-inductive / shunt-becomes-inductor, the
   **EMI** lens for loop radiation, the **bus magnitude bar** for sag, the **Bode / phase
   scope** for the op-amp's GBW rolloff (and, when it lands, the deferred slew clamp). The
   lens is **pulled** — offered as *"want to see why this came back from
   EMI testing?"* — never auto-shoved. (The op-amp clip's "lens" is the §2.6 saturation
   detector + a scope overlay; no new instrument.)
3. **The PROBE narrates (NAME).** One clause in the Probe's wry register, attached to the
   symptom on the part the eye is on, that **names the design-around system in the same
   breath** (bridging NAME → the rider). The equation lives **one pull deeper** (the info
   drawer), never unbidden.
4. **The LAB BOOK logs it + a RIDER lets you DESIGN AROUND it (NUMBER → transfer).** The
   first encounter fills a **Lab Book phenomenon/autopsy page** (one-time Lux,
   `game-lux-and-lab-book.md` §2) — a permanent datasheet-style write-up of *this*
   non-ideality; measurement realities mint a `phenomenon:` page + a **DEMONSTRATE**
   challenge, destructive ones mint an `autopsy:` page + a **BREAK-A-THING** challenge.
   Then a **reality-rider contract** (`game-contracts-deep-dive.md` §4.4) offers the
   chance to **design around it for a multiplier**: hold the spec across the tolerance MC
   sweep, meet the slew-rate, keep the loop under the EMI line. The rider is the **pull**
   that turns "I saw it" into "I engineered around it." A single first bite can pay
   **multiple faces once each** (the §2.4 precedent): the phenomenon/autopsy page + the
   challenge bounty + the rider unlock.

**The four beats map 1:1 onto the four systems** — SHOW = the **lens** (bench-realism);
NAME = the **Probe** (probe-teaching-arc); NUMBER = the **Lab Book** datasheet number
(lux faucet); DESIGN-AROUND = the **rider** (contracts). This 1:1 is the clearest proof
the curriculum is a *pacing*, not a new system: each beat is owned by an existing
system; the curriculum just fires them in order off one `aspectId`.

### 4.2 The FIRST-BITE table — per-aspect trigger + two channels (by-feel ‖ EE-numeric)

> For each headline reality: the **TRIGGER** that makes it bite, the **BY-FEEL** show
> (motion/light/shape — carries the whole lesson with zero reading; the pre-reader's
> punchline), the **EE-NUMERIC** show (lives one pull deeper, the older-reader's pull),
> the **LENS** pulled, the **PROBE** clause (verbatim), and the **Lab Book** page.

| Reality | Trigger (it bites) | BY-FEEL show | EE-NUMERIC show | Lens pulled | Probe clause (verbatim) | Lab Book page |
| --- | --- | --- | --- | --- | --- | --- |
| **SHUNT → inductor** | ideal current-sense works; player raises the source toward ~100 kHz on a milliohm shunt | the phase needle that sat dead-on **starts LEANING** | **+32°** at 100 kHz; `ωL` exceeds `R` | reality + frequency-morph (the copper strap grows its 10 nH) | *"Surprise — every wire is a little inductor. On a 10 kΩ you'd never notice; on a 10-milliohm shunt at 100 kHz that ωL beats the R. Your sense reads phase, not current."* | `phenomenon:` "a resistor is an inductor at HF" |
| **Electrolytic BURST** | player reverses or over-volts a working EC → `failedMask[ec]` rising edge | the cap visibly **POPS** — vent, electrolyte spray, charred tint (one-shot, wall-clock across the freeze) | rating exceeded; reverse-polarity flag in autopsy | (the burst IS the lens; thermal optional for the heat case) | *"BANG — you put it in backwards. Electrolytics are polarized; reverse one and the magic smoke leaves in a hurry."* | `autopsy:reverse` (the autopsy faucet pays Lux for reading the wreck) |
| **Op-amp SLEW** *(deferred CLASS B — the time-domain sloped edge is NOT produced today; the transient op-amp is algebraic/infinite-bandwidth, `lib.rs:7057`)* | working amplifier (gain shown); player feeds a fast edge / square into a budget (300 kHz) op-amp | *(when the CLASS B dV/dt clamp lands)* the crisp square **SLOPES** — corners round into ramps, the shape lags the input | output dV/dt clamps at the tier slew rate (e.g. **0.5 V/µs**) | scope overlay (ideal vs actual edge) — *needs the deferred slew companion* | *"Your square wave came out a ramp. The op-amp can only change its output so fast — that's slew. A faster tier (or a slower signal) keeps up."* | `phenomenon:` "gain has a speed limit (slew)" |
| **Op-amp finite GBW** | working amplifier (gain shown); player sweeps the input frequency up past the closed-loop corner | the Bode/phase trace **rolls off** — gain falls, phase lags past the −3 dB corner | −3 dB at **GBW / noise-gain**; phase margin on the loop | the **Bode / phase scope** (frequency domain — GBW is read only in `ac_solve_models`) | *"Gain isn't free at every frequency — past the corner it rolls off. A faster (higher-GBW) tier moves the corner out."* | `phenomenon:` "gain has a bandwidth (GBW)" |
| **Op-amp rail CLIP** | player drives the output toward the rail (input keeps climbing) | the output **FLAT-TOPS** — pins at the rail while the input still moves | output pinned near **±Vsat**, gain → 0 | scope overlay (output clamped) — the §2.6 detector | *"You drove it into the rail — past Vsat the output just stops; the gain went to zero."* | `phenomenon:` "finite output swing / clipping" |
| **Diode reverse-recovery** | working rectifier; player switches a slow rectifier family **fast** (or in a switcher), yanking a conducting diode off | a backward **SPIKE/glitch** flicks on the scope at switch-off, the instant before it blocks | reverse-current spike; `q = TT·I` swept out over several ticks | scope time-zoom on the switch-off edge + diffusion-charge tint | *"A diode that was conducting doesn't stop on a dime — stored charge sweeps out backwards first. Pick a fast-recovery part, or it rings."* | `phenomenon:` "reverse recovery (TT)" + the family picker |
| **Source SAG** | ideal divider/load works; player adds a heavy load on a budget (1 Ω `Rout`) supply in Real mode | the rail's magnitude **BAR/standpipe DROOPS** and tints `--warn` the moment the load draws | **~4 %** droop past threshold; `V = Vsrc − I·Rout` | bus magnitude bar + IR-drop sag on the trace | *"Your rail sagged the moment it took a load — that's a budget supply's output impedance. A stiffer (lab) one holds the line."* | `phenomenon:` "rails sag under load (output impedance)" |
| **Inductor SATURATION** | working inductor (filter/SMPS); player pushes current past I_sat | the inductor **stops smoothing** — current SURGES/spikes where it had been gently ramping (an inrush kick) | `\|I\| > I_sat` flag; L collapses | thermal/reality lens + the current-thickness channel surging | *"Past its saturation point the core gives up — the inductor stops inducting and the current bolts. Size it for the peak."* | `phenomenon:` "inductors saturate (I_sat)" — *MVP = flag + lens; the surge needs the deferred CLASS B L-collapse* |

> **Two channels, always both present, never gated against each other.** The BY-FEEL
> channel (the leaning needle, the sloping square, the popping cap, the drooping bar,
> the flicking spike) carries the whole punchline with zero reading — a pre-reader gets
> it. The EE-NUMERIC channel (+32°, 0.5 V/µs, 4 %, the TT spike width) waits one pull
> deeper in the info drawer / Probe. **The pop and sag skin cleanly for pre-readers; the
> subtle ones (shunt phase, slew, cap SRF) may be an older-player pull the young path
> never reaches** — Open Q7.

### 4.3 The two canonical worked examples (the grammar verified end-to-end)

**(a) The SHUNT that suddenly has phase** — the canonical "a part isn't what its label
says" moment (Step 6′, AC-only `R_ESL`, needs the phase scope):

| Beat | What happens | Machinery (existing) |
| --- | --- | --- |
| **Bites** | A 10 mΩ SHUNT, ideal, working. Player raises the source to 100 kHz. The **phase scope swings to +32°** — the "resistor" is reading reactive. | `R_ESL` AC path `Y=1/(R+jωL)`; `phaseScope.ts` |
| **Lens** | Pull the **reality lens** + **frequency-morph**: the shunt's copper strap shows its lead inductance tilting inductive with frequency. | reality lens, frequency-morph (`bench-realism…` §2) |
| **Probe** | *"Every wire is a little inductor. On a 10 kΩ you'd never notice. On a 10-milliohm shunt at 100 kHz, that ωL beats the R — your sense reads phase, not current."* | Probe persona (`probe-teaching-arc.md` §1) |
| **Lab Book + rider** | Fills the **"a resistor is an inductor at HF"** page (+Lux). A rider: *"measure this current with < 5° error at 100 kHz."* | Lab Book page; `phaseDeg`-error rider line (`game-contracts-deep-dive.md` §2.7) |

**(b) The electrolytic that BURSTS** — the headline needing the §2.6 CLASS A additive
(Step 1 companion):

| Beat | What happens | Machinery |
| --- | --- | --- |
| **Bites** | Player reverses an EC (or over-volts it). `\|I\|`/voltage crosses the rating → **`failedMask[ec]` rising edge**. | rating→FAIL (`diodes.ts`/`reality-roadmap.md`) |
| **SHOW (additive)** | A one-shot **vent**: pop + electrolyte spray + charred tint, wall-clock driven across the freeze — **identical to the LED pop**, golden-safe over the unhashed mask. | the §2.6 CLASS A additive; the LED-pop precedent (`probe-teaching-arc.md` §4) |
| **Probe** | *"BANG — you put it in backwards. Electrolytics are polarized; reverse one and the magic smoke leaves in a hurry."* | Probe |
| **Lab Book + autopsy** | The **autopsy** faucet (`game-lux-and-lab-book.md` §1.1 row 6) pays Lux for reading the wreck; fills the **reverse-polarity failure-mode page** + a **BREAK-A-THING** ("burst a cap on purpose"). | autopsy UI + `autopsy:<mode>` page |

### 4.4 Pacing the ease-ins themselves (so reality isn't a flood of toasts)

The ease-ins ride the **existing one-per-idle-frame pull drain** (`offerConcept` /
`pumpConcepts`, muted by `explainAsYouGo` — `game-lux-and-lab-book.md` §2.3). **One
reality ease-in surfaces at a time, never a stack, never mid-drag.** A player who mutes
coaching still sees the *symptom* (the sag, the slew, the clip, the pop) — only the
*words* mute, exactly as the Probe spectacle stays wordless when muted. An expert reads
nothing: the symptom is just the honest sim. A first bite fires **once** (deduped on
`reality:<aspectId>`); after that the symptom still shows every time but wordlessly — the
second slewed edge is just the honest sim, no re-narration (protecting the expert and
the muted-coaching player).

---

## 5. Reuse vs new surface — the build-risk ledger

> **Verdict: the curriculum is overwhelmingly REUSE.** Every modeled reality rides
> machinery verified this session (`tiers.ts`, `diodes.ts`, `lib.rs`). The genuinely-new
> surface is a small additive list that splits into **CLASS A** (web-side presentation,
> byte-identical golden-safe) and **CLASS B** (deliberate golden moves, deferred). **The
> MVP ships entirely on CLASS A.**

**REUSE (no new system — the bulk of the panel):**

- The **tier preset system** (`tiers.ts`: `tierParams`/`ecEsr`/`resistorTolerance`/
  `TRANSIENT_TIER_KINDS`, the V/AC/OA/C/L/NM/PM/Q/QP slots), the **`RATED_CURRENT_SLOT`
  → FAIL** flag path, the **diode `TT` reverse-recovery** companion, the **diode/LED
  variant** map (`diodes.ts`), the **AC-only gate** inside `ac_solve_models`, the
  **`Vsat·tanh` rail clip** already in core — all *read*, never touched.
- The **readiness gates**: `seenConcepts` (mastered ideal), `unlockedNodes` (era),
  `Component.tier` + Real mode (chose a tier), `claimedLux` (dedupe). All exist,
  read-only, web-side, unhashed. The curriculum adds the `reality:<aspectId>` namespace
  to the existing flat `claimedLux` `string[]` — same pattern as
  `concept:`/`phenomenon:`/`autopsy:`/`challenge:`, **zero new ledger.**
- The **ease-in pump** (`offerConcept`/`pumpConcepts` one-per-idle-frame drain +
  `explainAsYouGo` mute), the **SHOW instruments** (every lens already exists in
  `bench-realism`), the **DESIGN-AROUND pull** (the §4.4 Rider hybrid; `real5`/`real1temp`
  already shipped), the **Lab Book faucets** (`phenomenon:`/`autopsy:`/`challenge:demo-`/
  `challenge:break-`), and the **"it bit" detector** = the **same read-only sampler** the
  contract grader runs over the once-per-frame batched snapshot (golden rule #2).

**NEW — CLASS A (web-side presentation, golden-safe, flagged not silent):**

1. The per-aspect **REALITY RECORD / ordered table** (§2.7) binding the five keys — the
   curriculum's data shape (pure web-side game-state).
2. The **§2.6 visible-event additives**, **EC BURST first**, as presentation over the
   unhashed `failedMask` (reuses the LED-pop particle machinery verbatim); cap/MOV vent
   tuned per dielectric.
3. The **op-amp `Vsat` "saturation" detector** + lens/Probe copy — surfacing an
   already-modeled phenomenon (NO new physics, NO new particle — *the cheapest win*).
4. The **flag-only voltage/energy rating slot** mirroring `RATED_CURRENT_SLOT` (emitted
   from `buildNetlist` in Real mode; FLAGs only, never alters the solve); the **MOV
   joule-wear** unhashed accumulator.
5. The per-aspect **"it bit" detector thresholds** layered on the grader sampler, and the
   **rider ↔ Lab-Book coupling** glue.

**NEW — CLASS B (deliberate golden moves, DEFERRED, NOT this curriculum's dependency):**

- A real **inductor I_sat companion** (L-collapse in the transient solve), a real
  **per-device `Tj`** axis for thermal runaway, a **transformer core-sat**
  magnetizing-current term, and a real **op-amp slew (dV/dt) clamp** (an
  output-integrator companion — the transient op-amp is algebraic today, so the sloped
  edge needs this). Each is a new Real-mode-gated `param_or`-0-default slot
  (today bit-for-bit, default-off) regenerating the Real golden in its **own explained
  PR**. The curriculum is designed to **NOT depend on any of these** — it teaches the
  symptom on the CLASS A flag-and-lens path now, and the real physics lands later.

---

## 6. Determinism & golden-safety statement

> **Golden-safe by construction. This is game-design / UX + curriculum + web-side
> presentation only.** The non-idealities themselves are **already modeled and
> Real-mode-gated** in `sim-core` (`tiers.ts`, `diodes.ts`, `ac_solve_models`,
> `TRANSIENT_TIER_KINDS`); this panel **adds no physics** — it sequences and teaches the
> existing machinery.

- **The modeled realities are already golden-safe** (the premise this doc builds on):
  AC-only params (`R_ESL`, cap ESR/ESL, inductor DCR/Cw, op-amp GBW) gate inside
  `ac_solve_models(omega, real)` and are **unhashed** (transient golden
  `0xeaac_3764_99e4_fa24` untouched); transient tier params (source `Rout`, MOSFET Kp,
  BJT β, R tolerance) gate web-side in `buildNetlist` and **skip when `!real`**
  (`TRANSIENT_TIER_KINDS`); ratings only **flag** via the unhashed `failedMask`
  (`failed_elements` is **not** in `snapshot_hash`, `lib.rs:2481`). Mid-range ≈ the
  sim-core default (`MOS_KP = 0.02`, `BJT_BF = 100`, `OPAMP_GBW = 1e6`, EC ESR 0.5 Ω) and
  a `0` param slot = the kind default, so the golden is **byte-identical**.
- **Diode forward `Is`/`n` install in both modes (identity)**, but the **rating** and
  **`TT`** are Real-only, and `TT = 0` (default / Ideal / Schottky) zeroes the
  diffusion-charge term **bit-for-bit**.
- **The op-amp rail clip is already in the core** (`Vsat·tanh`, `lib.rs:3093`/`4925`);
  surfacing it is **CLASS A presentation** — a detector + copy reading the existing
  clamped output, **no golden move.**
- **The curriculum / pacing layer is pure web-side game-state** — readiness gates read
  `seenConcepts` / `unlockedNodes` / `claimedLux` / `Component.tier` (none hashed); the
  ease-in fires presentation (a lens, a Probe line, a Lab Book page) off the
  **already-batched once-per-frame snapshot** via the **same read-only samplers** the
  grader and detectors use. **No new JS↔wasm crossing** (golden rule #2 — the boundary
  stays coarse). The new `reality:<aspectId>` `claimedLux` key is a sibling of the
  existing `concept:`/`phenomenon:`/`autopsy:` keys — web-side local, unhashed.
- **The §2.6 CLASS A visible-event additives are presentation over the unhashed
  `failedMask`** — the LED-pop precedent (`probe-teaching-arc.md` §4, §8), wall-clock
  driven (`performance.now`, since the run freezes at FAIL), renderer-only flags reset on
  rebuild, byte-identical golden-safe. The flag-only rating slot only FLAGs (the solve
  is never altered). **No sim-core change.**
- **The CLASS B *transient physics* rows** (inductor L-collapse, transformer core-sat,
  real `Tj` runaway) are **flagged, not shipped here**: each would be a deliberate,
  Real-mode-gated, `param_or`-0-default golden move in its own explained PR with
  regenerated Real-mode coverage and the **transient golden untouched** — *never a silent
  change* (`reality-roadmap.md` guardrails). **This curriculum does not depend on them.**
- **No new currency, no new hashed state.** `cargo test -p sim-core` (incl.
  `run_is_reproducible`) is unaffected by construction. **SPDX `Apache-2.0` header on
  every new `.ts` / `.svelte`** if/when this is built.

---

## 7. Phased build (feasibility-weighted — cheapest-and-safest first)

| Phase | What ships | Risk class | Golden impact |
| --- | --- | --- | --- |
| **1 — pure presentation MVP** | (a) the **op-amp `Vsat` saturation detector + copy** (already modeled — *the cheapest win, ship first*); (b) the **EC BURST vent + autopsy** (the headline, reuses LED-pop particles); (c) the per-aspect **"it bit" detectors** reusing the grader sampler; (d) the **REALITY RECORD** table (§2.7) wiring existing surfaces into a sequence | **CLASS A** | golden untouched; no PR touches `sim-core` |
| **2 — flag-only rating slots** | the **voltage / energy / I_sat / SOA flag slots** emitted from `buildNetlist` in Real mode (mirroring `RATED_CURRENT_SLOT`); MOV joule-wear web accumulator; cap/MOV vent presentation | **CLASS A** (FLAG-only; one core-read-only emission) | golden-safe (mask unhashed, solve unaltered) |
| **3 — deferred, owner-gated** | the **real transient-physics golden moves** — inductor L-collapse, real `Tj` runaway, transformer core-sat, **op-amp slew (dV/dt) clamp** — each its **own explained PR** with regenerated Real-mode coverage; the transient golden untouched | **CLASS B** | regenerates the *Real-mode* golden only; deliberate, never silent |

**Build-priority within Phase 1:** Vsat surfacing (near-zero risk, no new physics *and*
no new particle) → EC burst (owner headline) → the detectors + the REALITY RECORD. The
forced-curriculum order (§3.1) is independent of Phase 3 — the saturation/runaway/core-sat
lessons teach on the CLASS A flag-and-lens path until (and unless) the real physics lands.

---

## 8. Open questions / owner hand-offs

1. **The REALITY RECORD as §2.7 (the integration artifact).** Confirm the per-aspect
   record (`aspectId → tierExposesVia | lensId | phenomenon/autopsy | riderId |
   detectorSig | eraGateNode | seenConceptsIdealKey`) belongs in this doc as the
   curriculum's data shape (vs an implementation doc). It is the single artifact that
   makes the curriculum a *pacing-over-records* rather than four parallel systems —
   golden-safe, web-side. *Recommend YES.*

2. **A "primary reality" tag per part (★ in §2).** Confirm every catalog row carries an
   explicit ★ primary (R→lead-inductance, OA→slew, EC→burst, …) so PACING and the
   first-bite detector read it directly rather than inferring primary-vs-secondary from
   prose. *Recommend YES — done provisionally in §2.*

3. **Re-tag the op-amp rail clip as MODELED, not a gap.** The `Vsat·tanh` clip is already
   in the core (`lib.rs:3093`/`4925`); confirm it ships as a **CLASS A presentation-only
   "saturation" detector + copy** (Step 5b, ranked just after EC burst as the lowest-cost
   teaching win), and that no copy implies clip needs new physics. *Recommend YES — done
   in §2.4 / §2.6 / §3.1.*

4. **The "it actually bit on this board" detector thresholds (§3.3 clause 4).** Set the
   per-aspect numbers (how much sag / phase / slew / SRF-crossing / TT-spike / I/I_sat
   counts as "bit"). Each must reuse the contract grader's sampler **exactly** (for
   determinism + zero new crossing), and any detector reading `node_v` needs a
   determinism review. Too low → reality fires on noise (floods); too high → the lesson
   never triggers. *Scope + determinism review; pairs with `game-progression.md` §7 Q5.*

5. **Era-1 ordering: sag-first vs a combined beat.** §3.1 splits Step 2 into **2a sag**
   (one load, intuitive) then **2b R tolerance** (needs the MC sweep). Confirm these want
   **two separate ease-in fires** (two cards, two pages) vs a single combined Era-1
   reality beat — i.e. whether "one at a time" means one-per-era or one-per-aspect. *Owner
   call.*

6. **Tier-as-pacer + the always-on exceptions (§3.2).** Confirm the tier ladder is the
   intended within-component pacer (budget op-amp exposes its GBW rolloff loudly; lab hides it).
   Which realities bite **regardless of tier**? The LED rating bites at every tier today
   (the hook); confirm the `always-on` set (identity `Vf`, reverse-EC, over-V burst, shunt
   `R_ESL`) vs the tier-paced spec'd non-idealities, as marked in the REALITY RECORD
   (`tierExposesVia = always-on`). *Owner: confirm.*

7. **EC-BURST MVP scope (§2.6).** Ship the EC vent + autopsy first (owner headline, pure
   presentation over `failedMask`)? Confirm per-dielectric tuning (EC pop vs ceramic crack
   vs film) and verbatim reuse of the LED-pop particle system. *Owner: confirm the MVP
   burst set.*

8. **The CLASS B physics — flag-for-MVP or real?** Inductor L-collapse saturation,
   transformer core-sat, and real `Tj` runaway: ship the **web flag + lens-glow** for the
   curriculum (the doc's recommendation) and defer the real physics to a `Tj`/I_sat
   infrastructure PR? The by-feel "current bolts" symptom is far stronger with the real
   L-collapse, but the order doesn't depend on it. *Owner: ratify so no one ships a silent
   golden change.*

9. **Reality-rider ↔ curriculum coupling.** Is a reality's design-around rider **offered**
   softly once its Lab Book page fills, or **wired** via `Rider.requiresUnlock` reading the
   filled page? *Recommend wired for destructive realities (you must have autopsied it to
   pull the "survive it" rider) and soft for the subtle ones.* (Relates to
   `game-contracts-deep-dive.md` §9 Q3, `game-lux-and-lab-book.md` §8 Q4.)

10. **Multi-face-once payout.** Confirm a single demonstrated/destroyed reality pays
    multiple faces **once each** (the §2.4 precedent): first bite pays the
    `phenomenon:`/`autopsy:` page + (if a break challenge) the `challenge:` bounty +
    unlocks the rider offer — the deepest single "aha" across all four systems, deduped
    independently. *Owner: confirm the intended reward shape.*

11. **Wear-out / aging.** EC dry-out and MOV joule degradation are catalogued as gaps with
    no model — confirm whether "wear" is a **web-side unhashed accumulator** (presentation,
    recommended) or out of scope for the curriculum's first pass. *Owner: scope.*

12. **Pre-reader register (§4.2).** The LED pop and EC burst reskin cleanly (glyph +
    chime). Do the *subtle* realities (shunt +32° phase, op-amp slew, cap SRF) have a true
    by-feel pre-reader skin (the leaning needle, the sloping square), or are they an
    older-player layer the young path never pulls — i.e. the sequence truncates by reader
    age? *Content owner / playtest.*

13. **Sandbox honesty invariant (§3.4).** Ratify "pace the lesson, never the sim" — the
    era/tier gates serialize the forced curriculum one-reality-at-a-time, but stacked
    realities in the sandbox all show their symptoms; only the coaching drain is
    serialized. *Owner: confirm.*

---

### Key surfaces cited

- **Reality machinery (existing, golden-safe, verified this session):**
  `web/src/lib/tiers.ts` (`tierParams`, `ecEsr`, `resistorTolerance`,
  `TRANSIENT_TIER_KINDS`, the V/AC/OA/C/L/NM/PM/Q/QP slots),
  `web/src/lib/diodes.ts` (`DIODE_TYPES`, `LED_COLORS`, `RATED_CURRENT_SLOT = 2`,
  `DIODE_TT_SLOT = 3`, LED `ratedA = 0.03`), `crates/sim-core/src/lib.rs`
  (`ac_solve_models(omega, real)`, `param_or`, `flag_and_clamp_fails`/`failed_elements`
  unhashed `:2481`/`:2481`, `R_ESL`=`:2701`, `CAP_ESL`=`:2694`, `OPAMP_GBW`=`:1864`,
  `Vsat·tanh` rail clip `opamp_target` tanh=`:3093` (fn `:3092`) / stamp `:4925`, `MOS_KP`=`:1815`,
  `BJT_BF`=`:1838`, fixed step `DT = 2.0e-6`=`:309`; `inv_dt` is **not** a constant — it is the
  per-solve reverse-recovery time term passed into `newton_iterate` (0 at the operating point,
  `1/DT` transiently)), `web/src/lib/netlist.ts` (`buildNetlist` emission /
  Real-mode gate), `web/src/lib/phaseScope.ts`.
- **The ramp this paces onto:** `docs/game-design.md` (Pillar 2),
  `docs/game-progression.md` (eras, tiers, Lux/Credits gate, Lab Notebook, eurekas),
  `docs/sim/ideal-vs-real-parts.md` (fidelity-IS-progression),
  `docs/reality-roadmap.md` (modeled vs mechanism-needed; the golden-safe levers).
- **The teaching surfaces:** `docs/ui/probe-teaching-arc.md` (SHOW→NAME→NUMBER, the
  blow-up/`failedMask` presentation, pull-not-pick),
  `docs/ui/fundamentals-scaffold-arc.md` (readiness detection, the Ideal→Real gate),
  `docs/bench-realism-and-emi-kernel.md` (the lenses: thermal / reality /
  frequency-morph / EMI spectrum / bus-magnitude-bar),
  `docs/game-lux-and-lab-book.md` (the Lab Book phenomenon/autopsy pages, the eureka
  bridge), `docs/game-contracts-deep-dive.md` (the reality riders that demand designing
  around a non-ideality).

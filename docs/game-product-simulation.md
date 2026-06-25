<!-- SPDX-License-Identifier: Apache-2.0 -->

# Product simulation — RMAs, certification, yield, reliability & reputation (the buildable expansion)

> Sibling to **`docs/product-run-reliability-ideation.md`** (the canonical, owner-agreed
> framing — read it first). This doc does **not** re-derive that framing; it **operationalizes**
> it into a buildable design: concrete formulas, the two cert labs, the RMA/recall/reputation
> economy, the all-ages teaching bridge, and the golden-safety proof. Everything here is
> **web-side game-design + economy + UX**. Zero `sim-core` change. The golden cannot move.

---

## 0. Thesis — what this panel decides

The bench answered *"does my one prototype work?"* This panel answers the next question the
owner asked out loud — *"did it pass EMI testing? do gadgets come back?"* — by giving the
fielded **fleet** a fate the player can read and **fix**.

The thesis is a single sentence the rest of the doc unpacks:

> **The production run is one pure deterministic function**
> `outcome = reliability(designHash, measuredMargins[], protectionPresent[], certResults, fundedQuality, stressProfile)`
> **evaluated web-side on top of the existing graded replay — never RNG, never `sim-core`, never the golden —
> whose every link is a datasheet-grade scalar the player can inspect, so the outcome teaches
> *derating, protection, and certification as a design-for-reliability budget* rather than punishing a dice roll.**

This panel decides five things the canonical doc named but did not model:

1. **The two certification gates** as a *service you pull*, not a wall — a deterministic
   `margin = limit − measured` chart with a ranked **fix-it report**.
2. **The reliability model's actual numbers** — the stress-ratio → derating-curve → Arrhenius →
   wear-out → fleet-FIT → RMA → recall chain, with worked arithmetic.
3. **The RMA / recall / reputation economy** — how returns net to profit/loss, why a recall
   craters, and what reputation *is* (a stake, never a currency).
4. **The teaching bridge** — exactly how a beginner of any age first **meets** product-sim, on
   the existing fidelity ladder, narrated by the Probe, legible-not-punishing.
5. **The build order** — Phase-1 report card ships **today** on heat + ratings alone; the FCC
   EMI gate is the one phase gated on a not-yet-built kernel.

### Relationship to the canonical doc (the three rails, restated not re-derived)

`product-run-reliability-ideation.md` §1 established that *"realism"* is **three rails**, not one
slider. This doc treats that as settled and builds on it. The one-table recap is §1 below; the
rest of the doc operationalizes **Rail 2 (production-run)** and **Rail 3 (cert gates)**, and shows
they are *literally the same rail* at the point where a marginal cert pass derates field life
(§3.6). The canonical **mechanic** (submit → labs → run → outcome), the **determinism contract**
(seeded off the design hash, reads unhashed margins), and the **phased path** are all inherited
verbatim — this doc fills in the formulas, the UI, and the teaching.

### Relationship to the teaching panels (the bridge for a beginner)

Product-sim is the **second rung of the fidelity ladder** the teaching panels established
(`docs/ui/probe-teaching-arc.md`, `docs/ui/beginner-onboarding-all-ages.md`, and
`docs/game-design.md` Pillar 2 *"fidelity IS the progression"*). The bench taught **"does my one
prototype work?"**; product-sim teaches **"will my hundred survive the field?"** — and it must be
*met the same way the bench was*: as a self-caused, blameless, **pulled** spectacle the Probe
narrates **show → name → number**. §5 owns this bridge in full. The binding rule, stated up front:
**the production run is an OFFER the bench always supersedes — never a forced gate.**

---

## 1. The three rails (recap — one table, canonical framing)

The canonical framing (`product-run-reliability-ideation.md` §1). This table is the recap; the
doc above is the source of truth for the *why*.

| Rail | Question | Time-scale | Where it lives | Manifests as | Owned by |
| --- | --- | --- | --- | --- | --- |
| **1 — Bench realism** | Does the **one** prototype work *now*? | Instant, visible | The prototype on the bench | thermal smoke, EMI lens, over-current FAIL box, slew, saturation, parasitics | `heat-on-the-board`, `invisible-electronics` |
| **2 — Production-run realism** | Will the **fleet** survive the field over years? | Statistical, over time × scale | The fielded fleet | yield %, field-failure FIT/MTBF, **RMAs**, **recalls** | **`[reliability.ts]` (this doc, §3)** |
| **3 — Certification gates** | May I legally **ship** this run? | Pass-to-ship, one-shot | The EMI/UL labs | FCC/CISPR EMI pass-fail, UL/CE safety pass-fail | **`[certLab]` (this doc, §2)** |

The bench rail is the **in-bench preview** of the fleet rail: the same over-current `[failedMask]`
part that boxes on the bench is the part the fleet model rates `s_I > 1`. **One honest model, two
scales** — the bench shows it on the prototype, the production run aggregates it across the fleet.
That bridge (§5) is the integration thesis made legible.

---

## 2. Certification gates — the EMI lab + the UL lab

Both cert gates are **the same machine the contract grader already is**: read an already-measured,
**unhashed** margin off the graded replay, hash-seed *nothing* (the measured value **is** the
verdict), and present `margin = limit − measured` as a curve-vs-limit-line with a ranked fix-it
report. A gate is **`[certLab]`** — one web-side module (`web/src/lib/certLab.ts`, **NEW**), two
gates, one report shape:

```ts
type CertGate = {
  id: string;
  measured: number;        // already-deterministic, unhashed (from the graded replay)
  limit: number;           // the customer's spec (a contract field)
  margin: number;          // limit − measured
  unit: 'dB' | '°C' | 'cells';
  verdict: 'PASS' | 'FAIL' | 'unavailable';   // = sign of margin. NOTHING is hash-rolled.
  worstAt?: number;        // the harmonic / part / net where the min margin occurs
  lever: string;           // the one move that recovers the curve
};
```

The gates run on contract-**SUBMIT** (the existing graded replay), reusing the once-per-frame
snapshot sampler (`electricalMap` + `acMeasurements`) the grader already reads — **no new wasm
crossing**. A gate **FAIL never touches the sandbox** — it only **blocks the SHIP offer**, and it
always hands back the one lever to move and the dB/°C/mm it costs.

### 2.1 The EMI lab — `[emiChamber]` (FCC / CISPR)

The chamber reads the invisible-electronics `emission(loop)` estimate (`coupling.ts` over
`geometry.ts` loop-area + `acMeasurements` slew) swept across harmonics by `ac_sweep` → the
`spectrum.ts` dBµV-vs-log-f buffer with the FCC/CISPR-B limit line already specced (bars over the
line glow `--bad`). The gate:

```
margin  = min over harmonics of ( limit_line(f) − emission_dBuV(f) )
worstAt = the harmonic frequency where that min occurs
```

The **class** (CISPR-B consumer / FCC-A industrial) is a **contract field** — the customer's spec,
**not a difficulty picker**.

**`[emiLimitMath]` — concrete, legible, teachable numbers.** CISPR-B radiated limit line ≈
**40 dBµV/m @ 30–230 MHz**, **47 dBµV/m @ 230 MHz–1 GHz** (the real shape, game-scaled). Emission
per harmonic ≈ `20·log10(K · loopAreaCells · I_harmonic · f²)` — the standard small-loop radiator
∝ **area · current · f²**, with `K` a game-scale constant tuned so a tidy board sits ~10 dB under
and a sloppy one busts by 3–8 dB. The lesson reads **directly off the levers**:

| Lever | Effect on the spectrum |
| --- | --- |
| Halve the loop area | −6 dB (the whole curve drops) |
| Slow the driver edge one step | high harmonics roll off → the > 100 MHz bars drop |
| Add a ferrite bead | −4 dB |
| Spread-spectrum the clock | tallest single bar splits into two shorter ones (peak −4…−6 dB) |

Every lever is a **visible curve move**, not a hidden multiplier. This is a **fidelity-ceiling
ruling**: `coupling` is a *placed-component estimate, not a field solve*. The chamber teaches the
**relationship** (tighten loop → −6 dB) like the heat model teaches Tj — never a certifiable
absolute dBµV.

**`[emiFixReport]` — the coaching layer.** On FAIL the report is **ranked by recoverable dB**, each
line naming the lever and the geometric/parametric move:

> *"CISPR-B busted by 6.2 dB @ 84 MHz (3rd harmonic of your 28 MHz clock). Biggest fix: shorten the
> return loop — your aggressor net encloses 41 cells; halving it ≈ −6 dB. Then: add a ferrite bead
> (−4 dB), slow the driver edge one step (−3 dB high-end), or spread-spectrum the clock (−5 dB peak)."*

A **near-pass** (`−2 dB ≤ margin < 0`) gets a single gentle Probe nudge instead of the full ranked
report — *"You're 1.8 dB over at 84 MHz — one bead or a slightly tighter ground loop and you're
in."* A comfortable PASS shows the headroom — *"+9 dB under the line — clean."* The coaching depth
**scales with how far you are**: a −6 dB bust earns the full ranked list; a −1.4 dB squeak earns one
named move. This is the desirable-difficulty band — close enough that one move lands it, named
precisely enough to teach **which** move.

> **HARD DEPENDENCY (stated up front).** The EMI gate is **blocked** on the not-yet-built
> invisible-electronics kernel (`coupling.ts` / `geometry.ts` / `spectrum.ts` — confirmed absent;
> only `diodes.ts` / `tiers.ts` exist today). Until it lands, `[emiChamber]` is a **typed stub
> returning `unavailable`** and the chamber shows *"estimator not installed."* The canonical §6
> phase ordering is correct: report card → funded quality + protection → UL gate → **EMI gate
> last**.

### 2.2 The UL lab — `[ulLab]` (safety, buildable NOW — no EMI kernel)

Three integer/scalar checks, each a `[certLab]` gate row with its own lever:

| # | Check | Measured | Limit | Source (all exist today) | Lever |
| --- | --- | --- | --- | --- | --- |
| 1 | **Over-temp** | max over parts of `Tj` (`= Tamb + P·θ_JA`) | per-part ceiling (electrolytic 105 °C, generic 125 °C) | heat-model `Component.temp` value path | "add a heatsink / derate / switch to a buck" |
| 2 | **Protection-present** | fuse/PTC in series with input? TVS/MOV across it? reverse-polarity diode? | required set per contract risk-class | `graphShape` topology oracle + part kind/variant | "place a fuse on the input" |
| 3 | **Isolation / creepage** | integer grid-distance between a hazardous-rail net and a touch/SELV net | required clearance in cells, scaled from rail voltage (mains → N cells; 5 V → 0) | `geometry.ts` (or a coarse cell-gap scan today) | "widen the gap by 3 cells" |

Mains/high-V contracts **require** the protection set; low-V contracts may not. The UL gate is
**not blocked** — it reads existing Tj + topology + a coarse geometry scan, and ships in Phase 3a
**ahead of** the FCC gate.

### 2.3 The lab economy — `[labEconomy]` (a Credit sink, no new currency)

Each gate is a bench-**SERVICE** you pull:

| Service | Fee | Beat | Respin (changed design) | Re-run (unchanged design) |
| --- | --- | --- | --- | --- |
| EMI scan | ≈ 200₵ + a "lab time" beat | spectrum + fix-it report | pay the fee again | **free** (deterministic — same design, same verdict) |
| UL check | ≈ 150₵ | three-check strip | pay the fee again | **free** |

Cost scales with contract **risk-class**. A FAIL → fix on the **bench (free, always open)** →
RESPIN = pay the lab fee again. The fee is the **anti-save-scum tax** that makes you *read the
fix-it report* instead of brute-forcing. A pre-ship **bench-service preview** (the Monte-Carlo /
temp-sweep sink already in `game-rewards` §1) runs the EMI/UL check **cheaper** before committing
the full run — so the labs reward **measuring twice**. **Re-running an unchanged design is free**
(nothing to re-roll), which kills fee-farming *and* means a player is never bled for re-checking.

### 2.4 Cert → reliability — `[certToReliability]` (the two rails become one)

The cert **result** is itself an **input** to the reliability roll (canonical §2: *"a marginal pass
derates field life"*). This is the one place cert and reliability are literally the same rail — the
gate doesn't just pass/block, it sets a **knob on the fleet's fate**:

```
lifeMultiplier = clamp( 0.6 … 1.0,  0.6 + 0.4·(emiMargin_dB / 10) )
```

A 0.5 dB squeak-past ships but returns **more** in the field (RMA trickle); a +9 dB clean pass
earns the robustness bonus (`lifeMultiplier → 1.0`). A thin UL over-temp margin directly raises the
Arrhenius acceleration the reliability model already uses. **Convention (no double-jeopardy):** when
both gates pass thin, take the **worse-of** the two multipliers, not the product.

**`[certBadge]`.** A clean cert sweep (both gates PASS with comfortable margin) is a **hard
precondition** for the **CEC-Certified** bonus tier (`game-rewards` §3) — which already means
*"holds spec across the Monte-Carlo / worst-case sweep."* A **thin pass ships and can Bronze/Silver
but cannot CEC-Certify** — margin is the gate to the top tier, exactly the anti-grind doctrine
(biggest payout needs insight, not repetition).

---

## 3. The production run + reliability model

The model's spine is **one legible chain** a player can read end-to-end. It lives in one new module:

> **`[reliability.ts]`** (`web/src/lib/reliability.ts`, **NEW**) — a pure-function library over the
> once-per-frame batched snapshot (**no new wasm crossing**): `partStress(comp)` → `partFIT(comp)`
> → `fleetFIT(graph)` → `runOutcome(...)`. A **sibling of the contract grader** — same reads, same
> replay, seeded off the design hash. Zero `sim-core` / `netlist` / `snapshot_hash` touch.

### 3.1 The chain (with the math)

**Step 1 — Stress ratio `s` (the master knob).** Per stressor `k`,
`s_k = applied_k / rated_k`, all from already-measured **unhashed** reads:

| Stressor | Numerator (applied) | Denominator (rated) |
| --- | --- | --- |
| `s_I` | `|I|` from `electricalMap` | `RATED_CURRENT_SLOT (=2)` — the **same** value the bench FAIL box uses |
| `s_V` | `|vAcross|` | part voltage rating (a `tiers.ts` / `diodes.ts` datum) |
| `s_P` | `V·I` | part power rating |
| `s_T` | `Tj` (heat integrator) | junction ceiling |

`s ≤ 0.5` is the classic **derate-to-half** comfort zone; `s → 1` is the cliff; `s ≥ 1` fires the
**bench FAIL** (this part is scrap, not a statistic). The over-current FAIL mask is the bench-side
**preview** of `s_I > 1`.

**Step 2 — The derating curve `FIT(s)` (published, drawn on the report card).** Each kind carries a
base rate (failures per 10⁹ device-hours):

| Kind | `FIT_base` (illustrative, game-scaled) |
| --- | --- |
| resistor | 2 |
| ceramic cap | 5 |
| electrolytic | 30 |
| diode | 8 |
| LED | 12 |
| BJT / MOSFET | 20 |
| IC | 60 |
| connector / solder-joint | 15 |

The stress accelerator is steep near 1: `accel_s(s) = exp(K·max(0, s − s_knee))` with
`s_knee = 0.5`, `K ≈ 6`:

| `s` | `accel_s` |
| --- | --- |
| 0.5 | ×1.0 |
| 0.7 | ×3.3 |
| 0.9 | ×11 |
| 0.99 | ×19 (and climbing) |
| ≥ 1 | bench FAIL (off the chart) |

The curve is drawn on the report card as a **dot on a published `x = stress, y = FIT-multiplier`
graph** — the derating lesson made visible.

**Step 3 — The Arrhenius term.** `accel_T(Tj) = 2^((Tj − T_ref)/T_double)` with `T_ref = 55 °C`,
`T_double = 20 °C` (rate doubles every 20 °C — the legible game-scale of the real `Ea ≈ 0.7 eV`
Arrhenius slope; the real form `exp((Ea/k)(1/T_ref − 1/T_use))` is its linearization). Per-part:

```
FIT_part = FIT_base · accel_s(s_worst) · accel_T(Tj)      where s_worst = max over stressors
```

*Worked:* an electrolytic (`FIT_base 30`) at `s = 0.9` (×11) and `Tj = 75 °C`
(`2^((75−55)/20) = ×2`) → `30·11·2 = 660 FIT`. `Tj` reads straight from the heat doc's web Tj
integrator (`Component.temp`), already golden-safe — **heat is the master derating input** tying the
bench thermal system to the fleet's fate.

**Step 4 — Electrolytic wear-out (the *10 °C halves life* rule as a consumed-life integral).** A
wet electrolytic has rated life `L_rated` at rated temp `T_rated` (e.g. 2000 h @ 105 °C — a real
datasheet number). Operating life `L = L_rated · 2^((T_rated − Tj)/10)`. Consumed fraction over the
contract's life-years × duty: `wear = life_hours_in_field / L`. When `wear ≥ 1` the cap is a
**wear-out death** — a **certainty, not a Poisson tail** — shown as a guaranteed year-N return
spike.

*Worked:* a 105 °C / 2000 h cap at `Tj = 85 °C` → `L = 2000·2^((105−85)/10) = 8000 h ≈ 0.9 yr` of
continuous use; a 5-yr contract at 50 % duty (≈ 22 000 h) → `wear = 2.7` → it dies ~year 2, a
guaranteed RMA wave. Derate the cap (cooler Tj or higher-temp grade) → `wear < 1` → no wear-out
returns. This is the *why electrolytics are the thing that dies* lesson, exact and teachable.

**Step 5 — Funded-quality multiplier (the pre-ship budget knob).** A `fundedQuality` level
(0..3: skimp / standard / screened / burn-in) bought with Credits sets an **infant-mortality**
multiplier on the **first-year** rate only (the bathtub front):

| Level | `m_infant` |
| --- | --- |
| skimp | 4.0 |
| standard | 1.0 |
| screened | 0.4 |
| burn-in | 0.15 |

It multiplies a **separate** `FIT_infant` component that decays after year 1 — **not** the
steady-state wear/random rate. **You cannot buy your way past a bad derating, only screen out the
lemons.** Yield is the parallel effect:
`yield = 1 − tolerance_escape − (1 − testCoverage)·latent`, where funded test coverage raises the
fraction of bad units caught at end-of-line. (*`tolerance_escape`* = the fraction out of spec from
component-tolerance stack-up, read from the existing `tiers.ts` tolerance Monte-Carlo; *`latent`* = the
latent-defect fraction screening can catch. **Phase-1 simplification:** ship a constant `latent` + a flat
`tolerance_escape`; the full tolerance-driven yield is a Phase-5 refinement. **Every number in this doc is
illustrative / game-scaled — balance in playtest, and treat the §2/§5 example figures as such.**) Burn-in cuts the year-1 wave ~7× **and does nothing**
for a cap that wears out hot in year 2 — the report card shows **both** lines so the lesson lands.

**Step 6 — Protection-gate collapse (topology, not value).** `protectionPresent(graph)` reuses
`graphShape` + part kind/variant (**no** value compare, **no** sim read):

| Placed protection (recognized by topology) | Collapses mode | Factor |
| --- | --- | --- |
| TVS / Zener across a port | ESD / over-V | ×0.05 |
| Fuse / PTC in series with supply | over-current cascade | ×0.1 |
| Reverse-polarity diode at input | reverse-connect | ×0.0 (eliminated) |

Each mode has its own `FIT_mode` contribution; protection multiplies **just that mode's term**.
Legible: *"No input clamp → ESD mode contributes 180 FIT to your fleet; drop a TVS → 9 FIT."*
Protection is the **design-for-reliability verb** — a topology choice with a fleet-scale payoff.

**Step 7 — Aggregate → field failures → the deterministic "roll".**
`FIT_fleet = Σ_parts FIT_part`. Expected random field failures over the contract:
`λ = N · (1 − exp(−FIT_fleet·1e-9 · life_hours))`, **plus** guaranteed wear-out deaths (timed to
their wear-year), **plus** the infant-mortality wave. The **actual integer return count** is a
**hash-seeded Poisson(λ) sample** via `mulberry32` seeded off the `designHash` (§7) — **same design
→ same count, bit-for-bit, no `Math.random`/wall-clock.**

*Worked:* `FIT_fleet = 900`, `N = 10 000`, 5-yr life @ 50 % duty (22 000 h) →
`λ = 10 000·(1 − exp(−900e-9·22000)) ≈ 196` random returns; + an 8 % wear-out wave if a hot cap
wasn't derated; + the infant wave per funded quality.

### 3.2 The RMA trickle vs the recall trigger (the distinction that teaches root-cause)

| | RMA **trickle** | **RECALL** |
| --- | --- | --- |
| Cause | many small per-part FIT contributions; no dominant root cause | **one** systemic stressor over a fleet-wide threshold |
| Trigger | the residual `λ` | a single root cause (one part at `s > 0.9` fleet-wide, **or** a missing protection mode, **or** a wear-out cap) accounting for **> `RECALL_SHARE` (≈ 40 %)** of expected failures **and** over an absolute floor |
| Shape | scattered over the contract window | discrete, root-caused, points at the **one part** |
| Teaches | *"add margin everywhere"* | *"find the systemic flaw"* |

Legible: *"RECALL — 62 % of returns trace to U1 running at 96 % of its current rating fleet-wide.
Derate U1 or add the fuse."* A recall is **never bad luck** — it names the shared cause. A hard
**safety** recall also fires on any part shipped at `s > 1` fleet-wide regardless of share.

### 3.3 The economics — Credits + reputation → profit/loss (no new currency)

```
profit = N_shipped·margin_per_unit
       − scrap_cost·(N − N_shipped)
       − RMA_unit_cost·rma_count
       − recall_hit
```

Illustrative: margin **₵2/unit**, scrap **₵0.5/unit**, `RMA_unit_cost` **₵8** (return shipping +
replace + handling — deliberately **≫ margin** so returns hurt and **field failures dwarf BOM
savings**), `recall_hit` = a flat ₵ crater scaled to volume (e.g. `N·margin·3` — a recall wipes out
**triple** the run's profit).

*Worked (clean):* 10 000 units, 97.2 % yield, 196 RMAs, no recall →
`9 720·2 − 280·0.5 − 196·8 = 19 440 − 140 − 1 568 = ₵17 732 profit`.
*Worked (un-derated cap):* same run + 800 wear-out RMAs + a recall →
`19 440 − 140 − 996·8 − 60 000 = a heavy LOSS`. **The arithmetic makes derating pay for itself**:
the ₵/unit on a higher-temp cap ≪ the RMA wave it prevents.

### 3.4 The outcome report card (the UX — extends the SHIP-IT beat, never overwrites it)

The existing bench **SHIP-IT** cascade fires **first** (the celebratory ship of the one prototype).
**Then**, only if the player pulled the run offer, an **OFFERED** "RUN SHIPPED" fleet sibling:

1. **Yield count-up** — *"9 720 of 10 000 passed end-of-line"* (scrapped fraction greys at test).
2. **Fleet light-up** — survivors power on together (the SHIP-IT net-energize sweep at fleet scale).
3. **Field-life fast-forward** — a deterministic scrub of the contract's life-years; returns
   trickle back as dimming icons on a fleet dot-grid, the FIT/MTBF number ticking.
4. **The report card** — the cert strip (§2) **above** the reliability block:

| Block | Lines |
| --- | --- |
| **Cert strip** (above) | EMI ⚡ row (green/amber/red bar + margin + spectrum thumbnail) · UL 🛡 row (three-check strip). Clicking a FAILED row opens the fix-it report. |
| **Reliability block** | YIELD % · FLEET FIT / MTBF (`= 1e9/FIT_fleet` hours) · RMA COUNT · PROFIT/LOSS · REPUTATION Δ |

Each reliability line is **expandable** to its **stress dot on the derating curve** + the named
cause. **Guaranteed wear-out** waves render distinctly from **random** Poisson trickle (a certainty
bar vs a tail), so the player reads *"this WILL die in year 2"* differently from *"a few might come
back."* A **recall** replaces step 3 with the company-scale **magic-smoke** beat — and immediately
flips to **autopsy → Lux** (analyzing the recall pays Lux + a codex page), so it **teaches**, not
just punishes.

---

## 4. The RMA / recall / reputation economy

### 4.1 Returns hit Credits **and** reputation

Every RMA debits Credits (`RMA_unit_cost`) **and** ticks reputation down a hair. A scattered
trickle is a Credit nick + a tiny rep ding. A **recall** is a Credit crater + a reputation crater +
the company-scale magic-smoke beat. The asymmetry is the lesson: *a returned unit costs ~3× its
margin, so reliability is not a luxury — it is the margin.*

### 4.2 Reputation — the long-game stake (NOT a third currency)

Reputation is a **per-customer-domain bounded scalar** (`consumer` / `industrial` / `automotive`),
local web-side game state, **golden-irrelevant**. It is **never spent, never bought, decays toward
neutral** — that is what keeps it a **stake**, not a balance you accumulate.

| Band | Range | Effect |
| --- | --- | --- |
| **Provisional** | < 0.2 | base contracts only, ×1.0 payout |
| **Trusted** | 0.2–0.5 | ×1.15 |
| **Preferred** | 0.5–0.8 | ×1.35 |
| **Flagship** | > 0.8 | ×1.6 + the widest Lux faucet for first-time reliability concepts |

**Accrual** (illustrative): CEC-Certified clean fleet **+0.06**; Bronze pass with scattered RMAs
**~0**; recall **−0.35** (a crater, ~6 clean ships to undo). **Decay:** relaxes toward neutral by a
small per-window step (×0.98) so **neither glory nor disgrace is permanent** — one bad run is
recoverable (legible-not-punishing) and a hoarded high rep can't be coasted on (anti-grind).
Reputation does **exactly two things**: (1) sets which contracts the customer board **OFFERS** + the
payout multiplier; (2) widens the **Lux** faucet on a clean high-band clear (a Flagship clear is
where *"CEC-Certified reliability"* Lux lives).

### 4.3 MTBF / reliability standing contracts

On the existing standing-contract harness (`game-contracts-economy` §2), a reliability contract —
*"ship 10 000 units, hold < 1 % return at 5 years, automotive ambient 85 °C, duty 0.6"* — reads the
seeded **stress profile** (ambient / duty / life-years / volume) into the life integral. The RMA
trickle advances **deterministically** by ticking the same seeded stream forward
(`seed XOR run-interval-index`), **never wall-clock** — so the fleet's 5-year fate is replayable and
save-scum-proof. Payout is a **Credit drip per window** *while* the fleet holds < the return
threshold; cross it and the contract **lapses** (reputation debit scaled to overshoot). This is the
Shapez *"demand ramps, your design must hold"* loop rendered as fleet reliability — and the natural
home for the **Flagship band** + **CEC-Certified Lux**.

### 4.4 Funded-quality allocation (a Credit sink, a *decision* not a slider)

A pre-ship `[QualityBudget]` allocates Credits across four **named** lines, each a legible
multiplier on a **specific** report-card number, each showing a **before/after delta**:

| Line | Affects | |
| --- | --- | --- |
| **Screening / burn-in** | infant-mortality (first-year FIT) | |
| **Solder / reflow-AOI QA** | yield (fewer cold-joint scrap + field returns) | |
| **Test coverage** | yield (catches tolerance-stack escapes at end-of-line) | |
| **Supplier grade** | counterfeit / early-life risk (Phase-5) | |

**The anti-cheese firewall:** funded quality multiplies the **infant-mortality + yield** terms,
**NOT** the steady-state stress-driven FIT. Over-funding screening on an under-derated hot cap still
bleeds RMAs in year 2 — *"you can't buy your way past a bad design."* It is a Credit **sink** that
rewards engineering, Real-mode-gated like a tier param.

### 4.5 Anti-grind firewall (extends the existing five rules)

1. **Re-shipping the same design + seed yields the identical fleet fate** (deterministic) → zero
   farming; Credit returns on a re-solved seed diminish exactly like a re-solved contract.
2. **Big payouts** (CEC-Certified clean fleets, recall-free MTBF clears, the Flagship multiplier)
   require demonstrated reliability **MARGIN** that grinding cannot fake.
3. **Funded quality** is a Credit sink that cannot buy past a bad derating (§4.4).
4. **Lux fires once per reliability concept**; a recall pays its autopsy Lux **once**.
5. **Reputation is unspendable + decays**, and a recall craters it — so spamming runs is
   **net-negative**. It rewards consistent engineering, the un-grindable thing.

---

## 5. The teaching bridge — all-ages + sandbox

Product-sim must be **met the way the bench was**: a self-caused, blameless, **pulled** spectacle
the Probe narrates **show → name → number**. This section owns the on-ramp. The binding rule, first:
**the production run is an OFFER the bench always supersedes — never a gate.**

### 5.1 The fidelity ladder — three rungs, all pulled

| Rung | Beat | State |
| --- | --- | --- |
| **A** | the **SHIP-IT** cascade on a clean bench pass — *"it works!"* | exists |
| **B** | after a SHIP-IT the Probe shows a single dismissible **`[make-100 offer chip]`** — *"Want to make 100 of these?"* | **NEW** |
| **C** | the **RUN-SHIPPED** cascade — yield count-up → fleet light-up → field-life fast-forward → *"8 of 100 came back"* / *"it failed EMI"* | **NEW** |

The offer is gated on a clean bench ship **only** so the first meeting is always a **win first**,
never a *"your broken thing failed at scale"* pile-on. The chip rides the existing **contract OFFER**
framing (a margin chip, Probe voice, pull-not-pick), **NOT** a modal, NOT a level transition, and
self-mutes under `[explainAsYouGo]` and after the first advanced action — exactly like the
*"try this next →"* ramp chip. A pure tinkerer never pulls it and climbs the whole tree on
understanding (Lux) alone.

This extends `game-design.md` Pillar 2 from **part-realism** into **product-realism** — the player
unlocks **more reality** (the fleet's fate, the customer's trust), not bigger numbers.

### 5.2 The Probe narrates a recall — retro-robotic, blameless-but-honest

Three registers keyed to outcome severity, all real DOM text + captioned, in the retro-robotic TTS:

| Register | Probe line |
| --- | --- |
| **Clean** | *"(happy hum) All 100 still humming out there! Clean run."* |
| **RMA trickle** | *"(concerned bloop) A few came back warm… that red cap was running hot. 8 of 100. Want to see which one?"* → pulls the fleet-grid cause-highlight |
| **Recall** | *"(alarm warble) Uh oh — uh OH — they're ALL coming back! Something I shipped breaks the same way every time. Let's autopsy it."* |
| **UL over-temp FAIL** | *"Safety lab says NO — that regulator hits 138 degrees, past its 125 ceiling. It'll cook in the field. Derate it or sink the heat."* |
| **EMI FAIL** | *"BZZT — you're lighting up the 84-megahertz band, 6 dB over the line. That fast clock with the big loop is a tiny radio transmitter. Tighten the loop or slow the edge."* |

The voice **owns the company-scale oops** the way the cold-open Probe owned the blown LED
(*"that was MY oops"*) — the failure is the Probe's-and-yours-together, never *"YOU failed."* Every
line names a **cause AND a fix** and points at the **one part/loop** to change. Failure reads
**private and diagnostic** (the `'—'`-style privacy stance), never public shaming. A recall is the
magic-smoke moment one rung up — but with the **autopsy → Lux** flip, so analyzing it pays
understanding. Reputation dips recover; one bad run is never a dead-end.

### 5.3 The fleet-grid — the all-ages by-feel read (the core widget)

A **10×10 dot grid** (one dot = one of 100 units) reusing the dual-form `[by-feel + numeric]` target
renderer (`beginner-onboarding` §4.1) and the `[voltageColor]` segmented-magnitude channel. **One
widget, three depths, self-selected by pull:**

| Depth | Read | Audience |
| --- | --- | --- |
| **By-feel** (default-prominent) | green dot = humming, grey dot = came back, red-ringed cluster = recall. *"8 dots dark"* IS *"8 came back."* Holding the dark dots **highlights the part on the board that cooked them** (the over-current `[failedMask]` part, or the hottest `[Tj]` part). | pre-reader, zero arithmetic |
| **Numeric** (beside it, dimmed; promoted the instant you edit a number) | yield % · field-failure % / FIT / MTBF · RMA % · profit ₵ · reputation Δ | teens+ |
| **Full report** (one pull deeper) | the per-part reliability table with stress ratios `s` and derating headroom | EE |

A 5-year-old reads the dimming dots; an EE reads the FIT. The **dot count IS the rounded
numeric** — never a separate roll (a vitest pins `dark-dot count == round(field-failure%·N)`). The
**cause rides the same widget**: the fleet-grid cause-highlight is the **literal wire** between the
two rails — the part that boxed on the bench is the part the dark dots point at.

### 5.4 Legible-not-punishing — the firewall against a punishment economy

Every field failure / RMA / recall **names a cause and a fix** and logs to the **Lab Notebook
codex** as a phenomenon paying one-time Lux. The report is **never a dead-end** — it always names
**one lever**. The teaching beat is *"I saw which part cooked → I derated it → fewer came back."*
**Build the report and the derate-and-re-ship loop together or not at all** — a report with no
actionable lever is the punishment economy we forbid.

**Binding presentation rule — the recall flood respects `prefers-reduced-motion` + the sensitive-child
guard** (inherited from [probe-teaching-arc] §4): a fleet-wide recall is *legible*, never *overwhelming*.
Under reduced motion (or for the youngest), the "they're all coming back" beat is a **single calm state
change** — the fleet-grid fills red + one named-cause line — with **no particle storm, no flood animation,
no alarm-spam**; meaning lives in the grid + DOM text, not motion. The Probe is rueful, never frightening,
and the fix-offer is always present in the same frame.

**The Lab Notebook codex** logs each NEW field-failure **mode** as a discoverable phenomenon page
paying one-time Lux (via the existing autopsy → Lux flip):

| Codex page | The phenomenon |
| --- | --- |
| `[cold-solder-joint]` | infant-mortality from a bad joint |
| `[electrolytic-wear-out]` | the hot cap that dries out before warranty |
| `[ESD-zap]` | field static killing an unprotected input |
| `[derating-violation]` | a part run too close to its rating |
| `[EMI-fail]` | emissions over the limit (the loop-antenna) |
| `[counterfeit-batch]` | (Phase-5) |
| `[the-recall]` | the capstone — the systemic flaw |

The blanks are the return loop; the by-feel skin is a **sticker-book slot** for pre-readers
(a returned-gadget sticker fills the slot). **Failure-as-fun at company scale** — the recall **pays
understanding**, turning the crater from punishment into a collectible lesson.

### 5.5 Pull-not-pick / offer-not-gate (the binding constraint)

| Rule | Enforcement |
| --- | --- |
| The bench / Test Bench / free-play are **always fully available** | the offer is a margin chip, never a modal or a level transition |
| Cert gates block **shipping a run**, never the sandbox | a FAIL bounces straight to the bench (free) with the fix named |
| Reputation is **revealed**, never picked | a higher band just means richer **offered** contracts — the player never selects a "reputation level" |
| The labs are **pull-not-pick services** | exactly like the existing bench-services (Monte-Carlo, temp-sweep) |
| A pure tinkerer never has to touch any of it | climbs the whole tree on Lux alone; there is no "production mode" |

**The cert preview as a pulled lens:** the invisible-electronics `"emi"` BoardLens **is** the
in-bench preview of the chamber — flip to it on the bench and **see the loop radiating** before you
ever pay for the scan. The teaching view and the gate are **one model at two moments** — preview
free on the bench, verdict paid at the lab.

### 5.6 A small all-ages matrix

| Outcome | Pre-reader (by-feel) | Teen+ (numeric) | EE (full report) |
| --- | --- | --- | --- |
| **Clean run** | all dots green, glow steady, *"all 100 humming!"* | yield 99 %, FIT 300, MTBF 380 k h | per-part `s ≤ 0.5`, comfortable headroom |
| **RMA trickle** | 8 dots grey, the red cap pulses | 8 % returns, −0.02 rep | cap at 92 % rating @ 70 °C → 3-yr life |
| **EMI fail** | a "radio-noise meter" bar pokes RED above a marked line, worst spot pulsing | 52 dBµV vs 46 line, −6 dB @ 30 MHz | the dBµV spectrum + ranked fix-it levers |
| **UL over-temp** | the part glows too-hot-orange past a "safe" tick | 128 °C vs 125 °C ceiling | `Tj = Tamb + P·θ_JA`, the derating lever |
| **Recall** | the grid floods red-ringed, *"uh oh — ALL coming back!"* | recall, −0.35 rep, ₵ crater | 62 % of returns trace to U1 at `s = 0.96` fleet-wide |

Same widget, two-to-three channels, **self-selected by pull depth** — the all-ages litmus
(Tablet Twosome ↔ Expert EE) holds because the production run is **one read-only consumer of the
shared snapshot**, surfaced at the depth the player pulls.

---

## 6. Reuse vs new surface

The expansion is **almost entirely reuse** — it is a new *consumer* of machinery that already
exists, plus a thin UI/state/sampler layer.

### Reuse (existing)

| Existing machinery | Role in product-sim |
| --- | --- |
| the **contract grader / graded replay** (`game-contracts-economy` §1) | the reliability model & cert gates are **sibling layers** reading the SAME node-V/branch-I margins; *"measured value is the verdict"* discipline |
| **`electricalMap`** / `element_currents()` (`netlist.ts:1822`, per-component `{current, vAcross, failed}`, `P = V·I`) | numerator of every stress ratio `s` |
| **`RATED_CURRENT_SLOT (=2)`** + `flag_and_clamp_fails` + the `failed_elements` mask (`lib.rs:2452`, unhashed, flag-only) | the rated-current datum for `s_I` **and** the bench-side **preview** of a fleet over-stress |
| the web-side **Tj integrator** → `Component.temp` (`heat-on-the-board` §5, golden-safe) | `accel_T(Tj)`, the electrolytic wear-out temp, the UL over-temp check |
| **`graphShape`** (`netlist.ts:1811`, value-independent topology oracle) | `protectionPresent` recognition + the integer creepage scan — no sim read |
| **`tiers.ts`** (`TRANSIENT_TIER_KINDS`, `jitter(id)`, `ecEsr`) + **`diodes.ts`** variants/ratings | the quality grade funded-quality reads + the yield Monte-Carlo + protection identity |
| the **SHIP-IT juice triad** + Bronze→CEC-Certified tiers + bench-services sinks (`game-rewards` §1/§3/§4) | the RUN-SHIPPED cascade; cert clearance gates CEC-Certified; the cheap pre-ship preview is a bench service |
| the **autopsy → Lux** flip + **Lab Notebook** codex + the **Probe** persona | the recall's lesson-not-punishment template; the failure-mode pages; the lab-tech narration |
| **`mulberry32`** + a web-side `designHash` seed — a **NEW shared convention** (specced in `probe-teaching-arc` §3a, **not yet built**; reused-by-agreement so both panels share one sampler, **not** sim-core's hash) | the deterministic Poisson/Monte-Carlo sample, drawn in canonical element-index order (§7) |
| the dual-form **by-feel + numeric** renderer (`beginner-onboarding` §4.1) + `voltageColor` | the fleet-grid's green/grey/red read beside the FIT number |
| the **once-per-frame batched snapshot** (`loop.ts`) | the model's read path — **no new wasm crossing** |

### New surface (web-side only — read-only consumers + a deterministic sampler)

| New | What it is | File / concept |
| --- | --- | --- |
| **`[reliability.ts]`** | the FIT/yield/RMA/recall pure functions + the hash-seeded Poisson sampler + the TS `designHash` | `web/src/lib/reliability.ts` |
| **`[certLab]`** | the gate struct + EMI margin/worst-harmonic extractor + the three UL checks + the ranked fix-it report builder + the `lifeMultiplier` | `web/src/lib/certLab.ts` |
| **the report-card UI** | fleet dot-grid + the cert strip + FIT/MTBF/profit/rep lines + expandable derating-curve dots | presentation |
| **the cert-lab UI** | the EMI chamber (spectrum + limit line + fix-it report) + the UL three-check strip + fee/respin chips | presentation + web economy |
| **the reputation track** | a bounded per-domain scalar + decay + contract-access/multiplier feedback + the recall event | local game state |
| **the `[QualityBudget]` allocator** | the pre-ship Credit-sink decision UI | local game state |
| **the `[make-100 offer chip]` + RUN-SHIPPED cascade** | the fidelity-ladder Rung B/C beats | presentation |
| **the production failure-mode codex pages** | cold-solder / wear-out / ESD-zap / derating-violation / EMI-fail / counterfeit / the-recall + sticker skins | content |
| **the contract `cert class` field** | CISPR-B/FCC-A, mains-vs-SELV, required-protection set — a **data field, not a difficulty picker** | contract data |

**None** touches `sim-core`, the netlist, or `snapshot_hash`.

---

## 7. Determinism & golden-safety statement

**Golden-safe by construction — no Rust is touched**, so `cargo test -p sim-core` (incl.
`run_is_reproducible`) and the FNV-1a golden `0xeaac…fa24` are **out of scope and cannot move**.

1. **No `sim-core` / `netlist` / `snapshot_hash` change.** Verified in code: `snapshot_hash`
   (`lib.rs:7353-7403`) folds **only** `tick` + per-node `node_v`/`net_level` + sequential
   ff/samp/cmp/behavioral integer state — `element_currents`, all `ac_*` outputs, and
   `failed_elements` are **excluded**. The `RATED_CURRENT_SLOT (=2)` check (`lib.rs:2452`, `:2481`)
   only **flags**, never alters the solve.

2. **The outcome reads already-deterministic, UNHASHED margins.** The entire model is a **pure
   function** `reliability(designHash, measuredMargins[], protectionPresent[], certResults, fundedQuality, stressProfile)`.
   All inputs are reads the renderer & contract grader already consume once per frame:
   `electricalMap` (stress ratios), the web-side Tj (`Component.temp`), the installed
   `RATED_CURRENT_SLOT`, the `failed_elements` mask, the `ac_*`/EMI estimate, and the spec margins
   from the grader. The **JS↔wasm boundary stays coarse** — no new per-component crossing.

3. **A gate verdict is NOT hash-rolled.** A cert verdict is the **sign of `limit − measured`**,
   where `measured` is an already-deterministic, unhashed output — exactly like a contract spec
   line. **No PRNG at all in the gate itself.**

4. **The reliability "roll" is a deterministic distribution SAMPLE, not RNG.** `fleet FIT → λ →
   Poisson(λ)` is drawn from a `mulberry32` stream seeded off the **`designHash`**:

   ```
   // a NEW web-side seed (the probe-teaching-arc §3a convention) — NOT sim-core's snapshot_hash:
   designHash = fnv1a(canonicalNetlistSerialization)         // any stable web-side hash; it does NOT
              ^ contractId ^ fidelityModeTag ^ fundedQualityLevel   // mirror lib.rs and need not match it
   ```

   **Draw order is canonical (the reproducibility crux).** The Poisson / Monte-Carlo draws walk the
   elements in **canonical netlist element-index order** (the order `buildNetlist` emits), advancing
   one `mulberry32` stream deterministically — so the per-part draws are identical on every machine.
   Iterating an unordered map here would silently break cross-machine reproducibility; the sampler
   MUST walk the ordered element array, never a hash-map. (`mulberry32` + this seed are a **NEW**
   shared web-side convention specced in `probe-teaching-arc` §3a — not existing machinery; the
   `designHash` is web-side only and is **unrelated to** sim-core's 64-bit `snapshot_hash`.)

   Same design + contract + mode + quality → **same fleet fate, bit-for-bit, across machines** —
   fair, replayable, save-scum-proof. **Never `Math.random()`, never `Date.now()`/wall-clock for any
   outcome** (wall-clock is allowed **only** for non-outcome presentation, e.g. the smoke
   animation). **Never the global sim `SEED=1337`.** Refunding quality or toggling Real
   **legitimately** re-rolls (the design changed).

5. **Persist the outcome, not just the seed.** The outcome object rides the existing save path so a
   refresh restores the **same** report. A standing contract's RMA trickle advances by a **tick-pure
   integer** `run-interval-index` (`mulberry32` advanced N draws), **never wall-clock** — the one
   hazard the heat/invisible-electronics docs flag, explicitly forbidden here.

6. **Real-mode-gated** per the established convention: in **Ideal** mode every part is its nominal
   self, the run ships nominal (yield 100 %, FIT ~0), and the golden is untouched. The
   non-idealities (emissions, Tj derating, ratings, base FITs) bite **only in Real**.

7. **No new physics, no new currency.** Credits = ship, Lux = understand (non-purchasable),
   reputation = the long-game stake already named — unspendable, unbought, decaying local state.

---

## 8. Phased build path

Honours the canonical §6 ordering. **Phase 1 ships today; the EMI gate is the only blocked phase.**

| Phase | Ships | Blocked on | Notes |
| --- | --- | --- | --- |
| **1 — Report card** | `[reliability.ts]` stress→FIT→yield→RMA chain + the fleet-grid + the RUN-SHIPPED cascade + the codex pages + Probe narration | **nothing** | reads heat (Tj) + `RATED_CURRENT_SLOT` + `electricalMap`, all of which exist. The all-ages on-ramp. **Start here.** |
| **2 — Funded quality + protection** | the `[QualityBudget]` allocator + `protectionPresent` collapse | nothing | the design-for-reliability budget made legible |
| **3a — UL gate** | `[ulLab]` (over-temp + protection-present + coarse creepage) + the fix-it-report shell + the `lifeMultiplier` coupling | nothing | reads Tj + topology; **ships ahead of FCC** |
| **3b — EMI gate** | `[emiChamber]` + `[emiLimitMath]` + the EMI fix-it report | **the invisible-electronics kernel** (`coupling.ts`/`spectrum.ts`/`geometry.ts`) | typed stub returns `unavailable` until the kernel lands |
| **4 — Reputation + recalls** | the reputation track + bands + the recall event + the magic-smoke→autopsy→Lux flip | nothing | the long-game stake |
| **5 — Richer reliability** | counterfeit, supplier-grade, true `geometry.ts` creepage, MTBF standing contracts at full fidelity | partly the geometry kernel | the Era-6 capstone |

**Era placement (recommendation):** the Phase-1 report card debuts **early and light** (it reads
margins that exist from Era 1–2) — a one-line *"fleet held / 3 of 100 came back"* footnote on the
first standing contracts. The full cert + recall + reputation + MTBF capstone is the **Era-6
"Design Rules"** beat (co-located with bench-services becoming standing gates). A **light UL
over-temp** gate can appear earlier (it reads Tj, which exists by the heat era). The exam wall stays
Era-4-only; product-sim is **pulled, never exam-gated**.

---

## 9. Open questions / owner hand-offs

1. **FIT / curve constants** (`FIT_base` table, `s_knee = 0.5`, `K ≈ 6`, `T_double = 20 °C`,
   `L_rated` examples) are **illustrative** — they need a balance pass against the Credit economy
   (margin ₵/unit vs `RMA_unit_cost` vs `recall_hit`) so derating reliably pays for itself without
   making the first few runs punishing. *Recommend: start forgiving (high `s_knee`, gentle `K`),
   tighten as reputation/era rises.* Owner + telemetry.

2. **`RECALL_SHARE` threshold** (proposed ≈ 40 % from one root cause + an absolute-rate floor): is
   single-root-cause share the right trigger, or should it **also** fire on a hard safety mode (any
   part shipped at `s > 1` fleet-wide, or a UL-fail) regardless of share? *Recommend both — a
   systemic-share recall AND a hard-safety recall — confirm the floors.*

3. **`cert → reliability` `lifeMultiplier`**: confirm the clamp band (`0.6…1.0` over a 10 dB EMI
   margin) and whether a UL over-temp thin pass should compound **multiplicatively** with the EMI
   thin pass or take the **worse-of**. *Recommend worse-of (the binding constraint), to avoid
   double-jeopardy.*

4. **Reputation constants & scope**: the actual `Δ_clean` / `Δ_recall` magnitudes, the decay rate,
   the band cutoffs, and the per-band multipliers (illustrative `+0.06 / −0.35 / ×0.98 /
   ×1.0–1.6`). One global scalar or **per-domain** (consumer/industrial/automotive)? *Recommend
   per-domain at the Era-6 capstone, single scalar for the Phase-1 light beat.* Owner.

5. **`designHash` sign-off**: confirm `fnv1a32(canonical-netlist) XOR contractId XOR fidelityMode
   XOR fundedQualityLevel` is the **one** shared web-side seeding convention with the daily-contract
   + anti-copy generator (`probe-teaching-arc` §3a). Does refunding quality **re-rolling the fleet**
   feel fair, or should quality be a post-hoc multiplier that does **not** re-roll the base draw?

6. **Funded-quality granularity**: the 4-level bundle (skimp/standard/screened/burn-in) for Phase-2
   legibility, or finer sub-lines (solder-AOI / test-coverage / burn-in sliders)? *Recommend the
   4-level bundle for Phase 2, finer lines deferred to Phase 5 — confirm it presents as a decision,
   not an opaque slider.*

7. **Isolation / creepage fidelity**: does v1 need the full `geometry.ts` integer cell-gap scan, or
   a coarse per-net rail-voltage → required-clearance lookup with a bounding-box gap? *Recommend
   coarse for v1 (the UL gate ships before the geometry kernel), upgrade to true creepage when
   `geometry.ts` lands.*

8. **Protection-present recognition**: the exact kind/variant set that counts (fuse, PTC, TVS, MOV,
   reverse-polarity diode, common-mode choke) and the topology predicate (in-series-with-input vs
   across-rail). Needs a small spec table; reuses `graphShape` + part kind/variant; connects to the
   invisible-electronics ESD + diode-variant machinery.

9. **Standing-contract RMA pacing**: real-seconds-per-field-life-window so the 5-year fast-forward
   feels like idle income without trivializing it (the same open Q as `game-contracts-economy` §8,
   now over field life). Prototype.

10. **`RMA_unit_cost` / `recall_hit` magnitudes**: confirm the per-RMA multiple (illustrative ₵8 ≈
    4× margin) and the recall coefficient (illustrative `N·margin·3`) so RMAs/recalls **dominate**
    BOM savings (they should, to teach the lesson) without making any field failure instantly
    bankrupting. Balance.

11. **CEC-Certified relationship**: is a comfortable cert pass a **hard precondition** for
    CEC-Certified, or one input among the Monte-Carlo sweep? *Recommend hard precondition (you
    cannot CEC-Certify a design that thin-passes or fails cert).*

12. **Wear-out as certainty vs sample**: confirm the report **visually distinguishes** the
    guaranteed wear-out wave (timed to the wear-year — a certainty bar) from the random Poisson
    trickle, so the player reads *"this WILL die in year 2"* differently from *"a few might come
    back."* The distinction is load-bearing for teaching wear-out vs random failure.

13. **Make-100 trigger & juice**: after **every** clean ship, or once-discovered then a persistent
    HUD handle? Field-life fast-forward duration/skippability? A distinct lighter glyph+chime so the
    bench ship still feels bigger? *Recommend once-discovered → persistent handle; ~2–3 s skippable
    cinematic.* Owner + juice call.

14. **Fleet-grid resolution at non-100 volumes**: a 10k-unit contract can't show 10k dots — fixed
    100-dot **percentage** grid (8 dark = 8 %) with the true count in the numeric tier, or scale?
    *Recommend fixed 100-dot percentage view for legibility.* Owner.

15. **Recall comedic register**: a recall is the biggest negative beat — too comedic undercuts the
    lesson, too grave breaks blameless-not-punishing. *Recommend comedic alarm + an immediate
    "let's autopsy it" pivot, never lingering on the charred state. Playtest with the
    sensitive-child guard (`probe-teaching-arc` §4).*

16. **HARD DEPENDENCY (confirm)**: the FCC EMI gate is blocked on building the invisible-electronics
    `coupling.ts`/`spectrum.ts`/`geometry.ts` kernel (confirmed absent today). Confirm the phase
    ordering ships the report card + funded quality + protection + reputation + recalls **first**
    (unblocked), with the FCC gate as a fast-follow once the kernel lands. Owner confirm.
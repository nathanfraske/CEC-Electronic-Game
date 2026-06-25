<!-- SPDX-License-Identifier: Apache-2.0 -->

# Product-sim — the failure-mode catalog + the money (the expansion)

> **Expansion of `docs/game-product-simulation.md`.** That doc built the spine
> (the three rails, the two cert gates, the `stress → derating → Arrhenius →
> wear-out → fleet-FIT → RMA → recall` chain first cut, the fleet-grid, the phased
> build). The owner: *"I know we did this, but expand on it — how failure modes
> work, and how much money you get from it."* This doc does exactly two things and
> **re-derives nothing**:
>
> **(A) THE FULL FAILURE-MODE CATALOG** — each mode as a self-teaching citizen of
> the bathtub curve: its TRIGGER (design choice × stress ratio × funded-quality),
> a physics-lite MODEL (the FIT/curve term it adds), how it MANIFESTS (RMA trickle
> vs recall; infant / random / wear-out region), and the FIX (the one verb the
> region forces). Deepened so each row is *dimensionally explicit* — what it reads,
> what its accelerator shape is, what makes the number move.
>
> **(B) THE ECONOMICS — HOW MUCH MONEY** — the full P&L ledger, reward magnitudes
> with worked numbers (clean vs **marginal** vs recall), how payout scales with
> volume × difficulty × reality, the reputation compounding loop with Credit
> deltas, and the balance so derating/protection visibly **pays** without a first
> failure being bankrupting.
>
> Canonical framing: `docs/product-run-reliability-ideation.md`. Plugs into the
> Credits/standing/firewall of `docs/game-economy-progression-implementation.md` §3
> and the SHIP-IT / failure-as-fun beats of `docs/game-rewards.md`. Everything here
> is **web-side game-design + economy**. Zero `sim-core` change. The golden cannot move.

---

## 0. Thesis + relationship to `game-product-simulation.md`

`game-product-simulation.md` named eleven realism items and modelled the **chain**
(`stress → derating → Arrhenius → wear-out → fleet-FIT → RMA → recall`). It did
**not** enumerate the *modes* — the distinct physical ways a unit dies, each with
its own trigger, its own bathtub region, its own fix verb, and its own contribution
to the fleet FIT sum. **This doc is that enumeration plus its money.** It builds
*on* the parent; it does not restate the three rails, the cert-gate mechanics, the
fleet-grid widget, or the determinism contract — those are settled there. The model
sentence is inherited verbatim:

> `outcome = reliability(designHash, measuredMargins[], protectionPresent[], certResults, fundedQuality, stressProfile)`
> — a **deterministic, hash-seeded distribution sample** over the existing
> **unhashed** measured margins (`electricalMap` stress ratios, the web Tj
> integrator, `RATED_CURRENT_SLOT`, the `failed_elements` mask, the emissions
> estimate). Each failure **mode** below is **one labelled additive term in the
> `FIT_fleet = Σ` sum** (parent §3.7), so adding a mode is adding a term — the
> golden never moves and the player can read every term off the report card.

**The single thesis the rest of the doc unpacks.** The catalog's power is that each
mode's `(TRIGGER, MODEL, TIMING, FIX)` form a **closed teaching loop where the fix
verb is forced by the bathtub region**. Every mode pins a `(design-choice,
stress-ratio, funded-quality)` triple to *exactly one* region, and the region
selects which of **four fix verbs** can possibly touch it. This is the anti-cheese
firewall expressed mode-by-mode: **funded-quality buys only the infant front,
design verbs (derate / protect) own random, temperature-grade owns wear-out, and
certification gates the legal-to-ship overlay.** No single knob spans regions, so
the player must *read the mode to find the fix*. The parent established this; this
doc deepens it by making each model term dimensionally explicit and tightening three
under-modelled rows (the thermal-runaway kicker, the counterfeit batch correlation,
the wear-out trio's shared integral) so a balance pass has concrete *shapes*, not
just constants.

[this doc is a labelled decomposition of the parent's FIT sum, not a new dice tower — every term reads a feeder the parent already verified]

---

## 1. (A) THE FAILURE-MODE CATALOG

### 1.0 The bathtub spine — the organizing invariant

Reliability engineering's bathtub curve is the skeleton. **Every catalog mode tags
to exactly one region**, because the region *is* the teaching — it decides which fix
verb can touch the mode:

| Region | When | Driven by | The fix-verb class that owns it | Manifests as |
| --- | --- | --- | --- | --- |
| **Infant mortality** | year 0–1, **decaying** | manufacturing defects (cold joints, ESD walking-wounded, latent cracks, a bad supplier batch) | **FUND-QUALITY** only (`m_infant` 4.0 skimp → 0.15 burn-in) | an early RMA wave that **tails off** |
| **Random (useful life)** | **flat** across life | `FIT_part = FIT_base · accel_s(s_worst) · accel_T(Tj)` — stress ratio × Arrhenius | **DERATE + PROTECT** (cannot be screened away) | a steady RMA **trickle** |
| **Wear-out** | year N onward, **rising** | a consumed-life integral `wear = field_h / L(stress)` (electrolytics, whiskers, fretting) | **DERATE / temperature-grade** | a guaranteed return **spike** at year N |

[the bathtub is the report card's hidden x-axis — the field-life fast-forward scrubs left-to-right through it]

**The four fix verbs, as a closed set — each owns a region.** This is the firewall
as a UI-legible rule. Every catalog FIX cell resolves to *exactly one* verb, and the
verb is forced by the region:

| Fix verb | Owns | Mechanism | Region it can touch |
| --- | --- | --- | --- |
| **DERATE** | lower `s` or `Tj` | move the dot down the published derating curve / cool the part | random **+** wear-out |
| **PROTECT-PART** | topology (TVS / fuse / series-R / reverse-diode) | the per-mode collapse factor (TVS ×0.05, fuse ×0.1, reverse ×0.0, latch/OV ×0.05–0.1) | random event-modes |
| **FUND-QUALITY** | screening / burn-in / AOI / supplier grade | `m_infant` on the **infant** component + yield | **infant only** |
| **CERTIFY** | pass EMI/UL with margin | the `lifeMultiplier` overlay (0.6…1.0) that scales the whole random term | the legal-to-ship overlay |

**Why this is the firewall.** Funded-quality multiplies the **infant** region only.
Derating/protection move the **random** region. Temperature-grade moves the
**wear-out** region. Certification scales the whole random term via a 0.6…1.0
multiplier. **No single knob touches all three** — which is exactly why *you cannot
buy your way past a bad design*. The catalog makes this concrete mode-by-mode: read
the mode → read its region → the region names the verb.

### 1.1 The catalog table

The summary table first; each mode is then unpacked. **All FIT numbers are
illustrative / game-scaled** (balance pass — §3.7, parent §9 Q1). Every mode reads
**only** the verified, unhashed bench feeders named in `[brackets]`.

The table carries an explicit **"engine input present today?"** column — because
four modes (ESD, latch-up, tin-whisker, over-voltage transient) read a *field-stress
event* or a *creepage geometry scan* the engine does **not** surface today, and that
gap must be visible per-mode, not buried in the phase table. ✅ = ships on a feeder
that exists; ⏳ = needs an input not yet built (the phase-gated modes).

| # | Mode | Region | Input today? | TRIGGER (design × stress × quality) | Unhashed feeder read | MODEL (the term added to `FIT_fleet`) | TIMING | MANIFESTS | FIX verb |
| --- | --- | --- | :---: | --- | --- | --- | --- | --- | --- |
| 1 | **Cold-solder / infant** | Infant | ✅ | high joint count + low **solder/AOI** funded line | part count (netlist length) × `solderQA` budget | `FIT_infant_solder = N_joints · p_coldjoint · m_infant`; decays after yr 1 | infant | early wave that tails off | **FUND** (reflow/AOI) or cut joints |
| 2 | **ESD field-zap** | Infant→Random | ⏳ *(field event)* | unprotected exposed input + no clamp | `[graphShape]`: TVS/Zener across the port? | `FIT_esd = FIT_esd_base(≈180) · (TVS ? 0.05 : 1)` = 9 vs 180 | infant→random | scattered I/O returns | **PROTECT** (drop a TVS) |
| 3 | **Electrolytic wear-out** | **Wear-out** | ✅ | hot cap + under-derated, long-life contract | web **Tj** (`Component.temp`) + cap grade (`[tiers.ts]` `ecEsr`) | `L = L_rated·2^((T_rated−Tj)/10)`; `wear = field_h/L`; `wear≥1` ⇒ certain death | wear-out | certainty bar at year N | **DERATE** Tj / higher grade |
| 4 | **Thermal runaway** | Random (cliff) | ✅ | positive-tempco part at high `s_P`, no thermal derate | web **Tj** + `s_P = V·I/P_rated` from `[electricalMap]` | `accel_T(Tj)` with a **runaway kicker** above a Tj knee (steeper exponent) | random-cliff | hot cluster returns fast | **DERATE** power / sink heat |
| 5 | **Over-derating breach (`s>1`)** | Random→hard | ✅ | any part past rating fleet-wide | `[RATED_CURRENT_SLOT]`(=2) + `[flag_and_clamp_fails]` — the **same** FAIL mask the bench boxes | `s>1` ⇒ the bench `[failedMask]` part ⇒ **hard-safety RECALL** regardless of share | random→hard | the bench-boxed part is the fleet killer | **DERATE** (bench showed the box) |
| 6 | **Counterfeit / supplier** *(P5)* | Infant + Random | ⏳ *(supplier line)* | cheap **supplier-grade** on a critical part | `[tiers.ts]` grade + the supplier-grade funded line | `FIT ×= supplierPenalty(grade)` on a **hash-seeded fraction** (binomial in canonical order) | infant+random | sub-population returns early, roots to one part+batch | **FUND** supplier grade |
| 7 | **Latch-up** | Random (cliff) | ⏳ *(over-rail event)* | CMOS port beyond rail + no series-R/clamp | `[graphShape]` (series-R/clamp?) + over-V transient | `FIT_latchup = base · (clamp\|\|seriesR ? 0.1 : 1)` | random-cliff | sudden dead units post-transient | **PROTECT** (series-R / clamp) |
| 8 | **Tin-whisker / dendrite** *(P5)* | **Wear-out** | ⏳ *(creepage scan)* | tight clearance + humidity/V-bias over years (pure tin) | coarse creepage scan + rail voltage | slow `wear` integral; `L` driven by **clearance_cells × rail_V** | wear-out | very-late-life shorts, climbing trickle | **DERATE** clearance / **FUND** coat |
| 9 | **Connector fretting** *(P5)* | **Wear-out** | ⏳ *(duty/cycle input)* | connector carrying I under thermal-cycle/vibration | connector kind + duty/thermal-cycle from contract | `wear` integral on connector `FIT_base(=15)`; `L` driven by **cycle count × duty** | wear-out | intermittents that climb with field-years | **PROTECT** (gold variant) / strain-relief |
| 10 | **Over-voltage / transient** | Random | ⏳ *(field surge)* | input exposed to supply transients, no TVS/MOV | `[graphShape]` TVS/MOV + `[diodes.ts]` variant rating | `FIT_ov = base · (MOV\|\|TVS ? 0.05 : 1)`; hard `s_V>1` can short-fail | random | spike-correlated cluster | **PROTECT** (TVS/MOV + reverse diode) |
| 11 | **Reverse-connect** | Infant / event | ✅ | no series reverse-polarity diode at input | `[graphShape]` reverse-diode present? + `[diodes.ts]` | `FIT_reverse · (revDiode ? 0.0 : 1)` — **eliminated** by one diode | infant/event | dead-on-arrival / field mis-wire | **PROTECT** (reverse diode, ×0.0) |
| 12 | **Systemic-flaw RECALL** | meta (any region) | ✅ | **one** root cause > `RECALL_SHARE(≈40%)` of expected failures **and** over an absolute floor; OR any `s>1` hard-safety; OR a UL/EMI fail shipped | the **dominant** `(mode,part)` term in the sum | **not a new term** — a **predicate over the share** of the sum + a hard-safety override | meta | company-scale magic-smoke → autopsy → Lux | **FIX the named dominant part** |

[modes 1–11 are additive FIT terms; mode 12 is a *predicate over the sum* — the share-of-failures trigger that names its cause]

> **The reverse-connect ruling (parent §3.6 vs the original failure-modes fold).**
> The parent doc lists reverse-connect as a distinct protection mode; the earlier
> failure-modes draft folded it into mode 10. **This doc promotes it to its own
> citizen (mode 11)** because its fix is the unique `×0.0` *elimination* (one diode
> makes the mode physically impossible) and it earns its own codex page + sticker
> slot. Owner may re-fold it into 10 if a codex page per mode is too many (§5 Q7).

### 1.2 The modes, unpacked

Each mode is `TRIGGER → MODEL → MANIFESTS → FIX`, with the Probe's diagnostic voice.
The model arithmetic reuses the parent's published constants
(`accel_s(s)=exp(K·max(0,s−0.5))`, `K≈6`; `accel_T(Tj)=2^((Tj−55)/20)`;
`FIT_part = FIT_base·accel_s(s_worst)·accel_T(Tj)`).

**1 — Cold-solder / infant mortality (INFANT, ships today).** *Trigger:* a
high-joint-count design plus a low **solder/reflow-AOI** funded line. *Model:*
`FIT_infant_solder = N_joints · p_coldjoint · m_infant`, where `N_joints` scales
with placed-part count, `p_coldjoint ≈ 0.5 FIT/joint`, and `m_infant` is the
funded-quality multiplier (skimp 4.0 → burn-in 0.15). It rides the **separate
`FIT_infant` component that decays after year 1** — it is *not* steady-state, so it
shows as an early wave that tails off. *Manifests:* the fleet-grid dims a chunk of
dots in the first fast-forward year, then stops. *Fix:* **FUND** reflow/AOI QA (the
single most direct infant knob) **or** reduce joint count (which *also* helps the
par/elegance score — one move, two payoffs). **The lesson it teaches:** *infant
mortality is a manufacturing problem you screen out, not a design problem you derate.*
[a fat BOM is an infant-mortality liability *and* a par penalty — the firewall agreeing with itself]

**2 — ESD field-zap (INFANT→RANDOM, ⏳ needs a field-event input).** *Trigger:* an
exposed input/connector port with no clamp. *Model:* `[graphShape]` answers "is a
TVS/Zener across this port?" — a **topology** question, no value read.
`FIT_esd = FIT_esd_base(≈180) · (clamp ? 0.05 : 1)` = **9 vs 180 FIT**. *Manifests:*
scattered returns on the I/O part (early-skewed, then random). *Fix:* **PROTECT** —
drop a TVS/Zener. The report card shows *"No input clamp → ESD mode contributes 180
FIT; drop a TVS → 9 FIT."* **The lesson:** *the clamp is a topology verb with a
fleet-scale payoff — pure design-for-reliability.* **Input gap:** ESD is a *field
static event* — the steady-state solve has no injected surge, so until an
over-rail-event input exists this mode is Phase-3b/5 (the topology read is free; the
*event that exercises it* is not). [the clamp turns 180 FIT into 9 — the cheapest fleet-scale fix in the catalog]

**3 — Electrolytic wear-out (WEAR-OUT, ships today — *the* signature lesson).**
*Trigger:* a wet electrolytic run hot and under-derated over a long-life contract.
*Model:* the consumed-life integral verbatim from parent §3 Step 4:
`L = L_rated·2^((T_rated−Tj)/10)`, `wear = field_hours / L`; `wear ≥ 1` is a
**certainty**, not a Poisson tail. Reads the web **Tj** integrator directly.
*Worked:* a 105 °C / 2000 h cap at Tj 85 °C → `L = 2000·2^((105−85)/10) = 8000 h ≈
0.9 yr`; a 5-yr 50%-duty contract (22 000 h) → `wear = 2.75` → it dies at field-year
`5/2.75 ≈ 1.8`, a guaranteed RMA wave. *Manifests:* a **certainty bar** at year ~2,
visually distinct from the random trickle (parent §9 Q12). *Fix:* **DERATE** —
cooler Tj or a higher-temp grade → `wear < 1` → zero wear-out returns. **Burn-in does
nothing for this** — the firewall made flesh. **The lesson:** *the 20 °C of derating
is the difference between a guaranteed year-2 recall wave and nothing — and it costs
cents/unit.* [screening can't save a cap physically drying out — the report shows both lines so the lesson lands]

**4 — Thermal runaway (RANDOM-CLIFF, ships today).** *Trigger:* a positive-tempco
device (BJT especially) at high `s_P` with no thermal derating — the device heats,
draws more, heats more. *Model:* `accel_T(Tj)` already doubles FIT per 20 °C;
runaway adds a **kicker** — above a per-kind Tj knee (`Tj_knee ≈ 110 °C`) the
effective doubling interval `T_double` *shrinks* (e.g. 20 °C → 10 °C), a **steeper
exponent, not a new physics loop**. Reads web **Tj** + `s_P` from `[electricalMap]`.
*Worked:* a BJT at Tj 90 °C has normal `accel_T = 2^((90−55)/20) = 3.36×`. At Tj
120 °C *with* the kicker: `2^((110−55)/20) · 2^((120−110)/10) = 2^2.75 · 2^1 = 6.7 ·
2 = 13.5×`, versus the un-kicked `2^((120−55)/20) = 9.5×`. The kicker adds the
regenerative super-doubling **above the knee** without a new integration loop —
golden-safe, legible. *Manifests:* a hot cluster that returns *fast* (front-loaded
random); fleet-wide it flirts with recall. *Fix:* **DERATE** — derate power below the
knee (visible as the dot dropping off the steep segment), sink the heat, or (design)
add emitter degeneration. **The lesson:** *positive feedback has a knee — the curve
goes vertical, and the fix is to keep the operating point off the steep part.*
[the heat model is the master derating input — a hot Tj is the thread tying bench thermal to fleet fate]

**5 — Over-derating breach (`s > 1`) (RANDOM→HARD, ships today — the bench↔fleet
bridge).** *Trigger:* any part shipped past its rating fleet-wide. *Model:* `s_I > 1`
is the **exact** `[RATED_CURRENT_SLOT]`(=2) + `[flag_and_clamp_fails]` condition that
boxes the part on the bench (the unhashed `failed_elements` mask, golden-safe: it
*flags*, never alters the solve). But the teaching subtlety is the *near-miss*: a
part shipped at `s_I = 0.96` is **under** the bench FAIL threshold so it ships, yet
`accel_s(0.96) = exp(6·(0.96−0.5)) = exp(2.76) = 15.8×` makes it **dominate** the FIT
sum → if it accounts for >40% of expected failures, a **systemic RECALL** names it.
Push to `s_I = 1.01` and it is the bench `failedMask` box → **hard-safety RECALL
regardless of share**. *Manifests:* the part that **boxed red on the bench** (or sat
one hair under it) is the one the dark dots point at. *Fix:* **DERATE** below the
rating; the bench already told you. **The lesson:** *the same rating slot that boxes
red on the bench is the fleet's killer — one honest model, two scales.* [you shipped a part the bench was already boxing — the fleet just scales the warning to 10,000 units]

**6 — Counterfeit / supplier (INFANT+RANDOM, ⏳ Phase-5 — needs the supplier line).**
*Trigger:* a cheap **supplier-grade** funded line on a critical part. *Model:* `FIT
×= supplierPenalty(grade)` applied to a **hash-seeded fraction** of the fleet (a bad
**batch**), drawn as a **binomial** in canonical element-index order off the
`designHash` — *not* a global multiplier. A global multiplier would smear the cause
across the whole fleet; the batch sub-population draw makes ~8% of units the bad
batch with `FIT ×= supplierPenalty(≈6×)`, so the recall finder **points at one part +
one supplier line**. *Worked:* at N=10 000 the binomial selects ~800 units; those
return early and root-cause cleanly to `(U1, batch)`. *Manifests:* a sub-population
returns early and root-causes to one part + one batch. *Fix:* **FUND** supplier
grade — and crucially funded-quality *can* touch this (it is an infant-front mode),
unlike a derating miss. **The lesson:** *a counterfeit batch is a hash-seeded
sub-population, not a global multiplier — it root-causes to one supplier line.*
[the batch binomial makes the recall finder honest — it names one part and one batch, not "the fleet got worse"]

**7 — Latch-up (RANDOM-CLIFF, ⏳ needs an over-rail event).** *Trigger:* a CMOS port
driven beyond its rails during a transient with no series-R or clamp. *Model:*
`FIT_latchup = base · (clamp||seriesR ? 0.1 : 1)` via `[graphShape]`; pairs with the
over-V mode. *Manifests:* sudden dead units correlated with a field transient.
*Fix:* **PROTECT** — a series resistor on the port, a clamp diode, or the rated diode
variant. **The lesson:** *latch-up is the SCR you didn't know you built — a series-R
starves it.* **Input gap:** like ESD, the *event* (a port driven past the rail) has
no source in the steady-state solve today; Phase-3b/5. [the series-R is a 10× collapse for a one-resistor BOM move]

**8 — Tin-whisker / dendrite (WEAR-OUT, ⏳ Phase-5 — needs a creepage scan).**
*Trigger:* tight clearance under humidity/voltage bias over years (pure-tin,
uncoated). *Model:* a slow `wear`-style integral (see §1.3, the shared integrator),
with `L` driven by **clearance_cells × rail_V** (creepage); `wear ≥ 1` ⇒ a very-late-
life short. *Manifests:* a thin trickle that **climbs** very late. *Fix:* **DERATE**
clearance (widen cells) or **FUND** a conformal-coat line. **The lesson:** *whiskers
are the slowest clock in the catalog — "passed at ship" isn't "passes at year 7".*
[whiskers teach that wear-out has many faces, and the slowest one is invisible until the warranty's almost up]

**9 — Connector fretting (WEAR-OUT, ⏳ Phase-5 — needs a duty/cycle input).**
*Trigger:* a connector carrying current under thermal-cycling/vibration duty.
*Model:* the same `wear`-style integral on the connector's `FIT_base(=15)`, with `L`
driven by **thermal-cycle count × duty** from the contract's stress profile.
*Manifests:* intermittents that climb with field-years. *Fix:* **PROTECT** —
gold-plate (a variant), strain relief, fewer mating cycles. **The lesson:** *the
failure that's "just the connector" — fretting is wear-out wearing a different hat.*
[fretting, whiskers, and the electrolytic are one integral with three different L-drivers — §1.3]

**10 — Over-voltage / transient (RANDOM, ⏳ needs a field surge).** *Trigger:* an
input port exposed to supply transients with no TVS/MOV. *Model:* `FIT_ov = base ·
(mov||tvs ? 0.05 : 1)`; a hard `s_V > 1` event can short-fail. Reads `[graphShape]`
+ `[diodes.ts]` variant ratings. *Manifests:* a spike-correlated return cluster.
*Fix:* **PROTECT** — TVS/MOV across the input (and the reverse-polarity diode for the
mis-wire case → mode 11). **The lesson:** *the clamp you skipped is the difference
between "survives the field" and "survives the lab".* [the MOV is the field's surge
absorber — without it the spike that the lab never sends finds you in year one]

**11 — Reverse-connect (INFANT/event, ships today).** *Trigger:* no series
reverse-polarity diode at the input. *Model:* `FIT_reverse · (revDiode ? 0.0 : 1)` —
a single series diode makes the mode **physically impossible** (`×0.0`, eliminated),
the only `×0.0` collapse in the catalog. *Manifests:* dead-on-arrival units or a
field mis-wire. *Fix:* **PROTECT** — the reverse diode. **The lesson:** *some modes
aren't derated or screened, they're designed out entirely — one diode, mode gone.*
[the only ×0.0 in the catalog — protection that doesn't reduce a mode but deletes it]

**12 — Systemic-flaw RECALL (META — a predicate over the sum, not a term).** A recall
fires when **one** root cause `(mode, part)` accounts for `> RECALL_SHARE (≈40%)` of
expected failures **and** clears an absolute floor (§3.7); **OR** any part ships at
`s > 1` fleet-wide (hard safety); **OR** a UL/EMI gate was failed-but-shipped.
*Manifests:* the company-scale magic-smoke beat → immediately flips to **autopsy →
Lux** (it *teaches*, parent §3.4). *Fix:* the report **names the dominant part** —
*"RECALL — 62% of returns trace to U1 at 96% of its current rating fleet-wide.
Derate U1 or add the fuse."* A recall is **never bad luck**; it names the shared
cause. **The lesson:** *a recall isn't a worse RMA — it's the moment one term
dominates the sum, and the report points straight at it.* This is the **one new piece
of machinery** the catalog requires: `partFIT(comp)` must return a `FailureMode[]`
(see §1.4) rather than a scalar, so the recall *names* its `(mode, part)` cause. It
only **labels** the existing single Poisson — it adds no draws. [a recall is the
moment the share-of-sum predicate trips — and because partFIT returns labelled terms, it can point at U1 by name]

### 1.3 The wear-out trio — one integral, three L-drivers (deepening modes 3/8/9)

Modes 3 (electrolytic), 8 (whisker), and 9 (fretting) are **one shape** —
`wear = ∫ field_hours / L(stress)` — differing *only* in what drives `L`. This
unifies the three Phase-5 wear modes under one reusable integrator (`wearIntegral()`
in `reliability.ts`):

| Mode | `L(stress)` driver | Concrete `L` | Renders as |
| --- | --- | --- | --- |
| 3 electrolytic | **temperature** | `L = L_rated · 2^((T_rated − Tj)/10)` | certainty bar at `5/wear` yr |
| 8 tin-whisker | **creepage** (clearance × bias) | `L ∝ clearance_cells · f(rail_V)` | certainty bar, very late |
| 9 connector fretting | **duty** (thermal-cycle count) | `L ∝ 1 / (cycle_count · duty)` | certainty bar, mid-late |

All three render as **certainty bars** timed to their wear-year — visually distinct
from the Poisson random trickle — so the player reads *"this WILL die in year N"*
versus *"a few might come back."* Mode 3 ships today (Tj exists); 8 and 9 are
Phase-5 (they need a creepage scan and a duty/cycle input — the ⏳ in §1.1).

### 1.4 How the modes compose into the report card

Each placed part contributes its mode terms into `FIT_fleet = Σ_parts Σ_modes
FIT_part_mode`. The **one added machinery** is the decomposition: `partFIT(comp)`
returns

```ts
type FailureMode = {
  id: string;              // 'esd' | 'electrolytic-wear' | …  (the codex-page key)
  fit: number;             // this mode's contribution to the part's FIT
  region: 'infant' | 'random' | 'wear-out';
  rootElementIndex: number;// the canonical element index — what the dark dots point at
  wearYear?: number;       // set for wear-out certainties (the certainty-bar x-position)
};
```

`classify()` groups the per-`(mode, part)` contributions by share; the recall
predicate is `max-share > RECALL_SHARE ∧ λ_mode ≥ floor` (§3.7). The report card's
**expandable reliability block** (parent §3.4) lets the player click any line to its
**stress dot on the derating curve** + the **named mode**. The wear-out modes render
as **certainty bars** timed to their wear-year; the random/infant modes render as the
**Poisson trickle**. One sum, three bathtub regions, twelve labelled terms — the
player reads exactly which mode, which part, which fix.

---

## 2. The reliability MODEL v2 — the math, made type-able

The parent's §3 chain is correct on paper; **v2's job is to make it type-able and
verifiable** — every link a pure function with a published curve shape, a canonical
draw order, and a vitest-pinnable invariant. The single load-bearing math claim:
**every link is monotone and inspectable** (`s↑→FIT↑`, `Tj↑→FIT↑`, `derate→fewer
RMAs`), and the only stochastic step (Poisson) is a deterministic *sample* over a
hash seed in canonical element-index order — so the *distribution* is
design-determined and the *fix* is always legible.

> **`[reliability.ts]`** (`web/src/lib/reliability.ts`, **NEW**, pure, web-side).
> Pipeline:
> `partStress(comp) → partFIT(comp,profile,quality) → fleetFIT(graph) →
> lambda(FIT_fleet,N,hours) → poissonSample(λ,rng) → classifyRecall(modeShares,N) →
> runOutcome(...) → {yield, rmaCount, recall?, modes}`. All reads come from the
> once-per-frame batched snapshot — **no new wasm crossing.**

### 2.1 The chain, link by link (with worked arithmetic)

**Link 1 — stress ratio `s`.** Per stressor `k`, `s_k = applied_k / rated_k`, all
from already-measured unhashed reads:

| Stressor | Numerator (applied) | Denominator (rated) |
| --- | --- | --- |
| `s_I` | `\|I\|` from `[electricalMap]` | `[RATED_CURRENT_SLOT]`(=2) — the **same** value the bench FAIL box uses |
| `s_V` | `\|vAcross\|` | part voltage rating (`[tiers.ts]`/`[diodes.ts]` datum) |
| `s_P` | `V·I` | part power rating |
| `s_T` | `Tj` (`Component.temp`) | junction ceiling |

`s_worst = max over k`. Bands: `s ≤ 0.5` comfort, `0.5 < s < 1` cliff, `s ≥ 1` fires
the bench `failed_elements` mask (scrap, not a statistic).

**Link 2 — the derating curve `accel_s(s) = exp(K·max(0, s − s_knee))`**,
`s_knee = 0.5`, `K = 6`. This is **the teaching curve** — drawn `x = stress,
y = FIT-multiplier`, with the part's dot on it. Flat below the knee (derate-to-half
is genuinely free), steep above (the cliff is visible):

| `s` | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 0.95 | 0.99 | ≥1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `accel_s` | ×1.0 | ×1.82 | ×3.3 | ×6.0 | ×11.0 | ×14.9 | ×18.9 | bench FAIL |

**Link 3 — Arrhenius `accel_T(Tj) = 2^((Tj − T_ref)/T_double)`**, `T_ref = 55 °C`,
`T_double = 20 °C` (the game-scale linearization of `Ea ≈ 0.7 eV`). Tj from the heat
doc's web integrator — **heat is the master derating input**:

| `Tj` | 25 °C | 55 °C | 75 °C | 95 °C | 125 °C |
| --- | --- | --- | --- | --- | --- |
| `accel_T` | ×0.35 | ×1.0 | ×2.0 | ×4.0 | ×11.3 |

**Link 4 — per-part random rate.** `FIT_part = FIT_base · accel_s(s_worst) ·
accel_T(Tj)`. The `FIT_base` table (per 10⁹ device-h, illustrative):

| Kind | R | ceramic | electrolytic | diode | LED | BJT/MOSFET | IC | connector/solder |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `FIT_base` | 2 | 5 | 30 | 8 | 12 | 20 | 60 | 15 |

*Worked:* electrolytic (30) at `s = 0.9` (×11.0), Tj 75 °C (×2.0) → `30·11.0·2.0 =
660 FIT`. The **Arrhenius ladder** is legible: the same IC (`FIT_base 60`) at `s =
0.7` (×3.3) reads `198 FIT @ 55 °C`, `396 @ 75 °C`, `792 @ 95 °C`, `2240 @ 125 °C` —
*every 20 °C doubles the field-failure rate*, taught by the player watching the
number double as the part runs hotter.

**Link 5 — electrolytic wear-out (a certainty, not a Poisson tail).** `L = L_rated ·
2^((T_rated − Tj)/10)`; `wear = field_hours / L`; `wear ≥ 1` ⇒ certain death at
field-year `life_years / wear`. *Worked (the signature lesson):* a 105 °C/2000 h cap,
contract 22 000 h (5 yr @ 50% duty):

| Tj | `L` | `wear` | Outcome |
| --- | --- | --- | --- |
| 65 °C | `2000·2^(40/10) = 32 000 h` | 0.69 | **survives** (zero wear-out returns) |
| 75 °C | `16 000 h` | 1.38 | dies ~yr 3.6 |
| 85 °C | `8 000 h` | 2.75 | dies ~yr 1.8 |
| 105 °C | `2 000 h` | 11 | dies yr 0.5 |

The 20 °C between 65 °C and 85 °C is the difference between **nothing** and a
guaranteed year-2 recall wave.

**Link 6 — funded-quality infant multiplier.** `m_infant` on a **separate
`FIT_infant`** component that decays after year 1 only — NOT the steady random/wear
rate. Levels: skimp 4.0 / standard 1.0 / screened 0.4 / burn-in 0.15.
`FIT_infant_solder = N_joints · p_coldjoint · m_infant`. Yield runs in parallel:
`yield = 1 − tolerance_escape − (1 − testCoverage)·latent` (`tolerance_escape` from
`[tiers.ts]` Monte-Carlo; Phase-1 uses flat constants). **Firewall:** `m_infant`
multiplies infant + yield only; it cannot touch `accel_s`/`accel_T` or the wear
integral.

**Link 7 — protection-gate collapse.** Per-mode factor from `[graphShape]` topology
(no value read, no sim read), multiplying **only that mode's term**: TVS/Zener →
ESD/over-V ×0.05; fuse/PTC → over-current cascade ×0.1; reverse-polarity diode →
reverse-connect ×0.0; latch-up series-R/clamp ×0.1. Legible: *"No clamp → ESD 180
FIT; drop a TVS → 9 FIT."*

**Link 8 — aggregate & the deterministic roll.** `FIT_fleet = Σ FIT_part_mode`.
`λ = N·(1 − exp(−FIT_fleet·1e-9·life_hours))` for the random component, **plus** timed
wear-out certainties, **plus** the infant wave. The integer RMA count is
**Poisson(λ)** sampled by **Knuth's algorithm** advancing **one** `mulberry32` stream
seeded off the web-side `designHash = fnv1a32(canonicalNetlist) ^ contractId ^
fidelityModeTag ^ fundedQualityLevel`. *Worked:* `FIT_fleet = 900, N = 10 000,
22 000 h → λ = 10 000·(1 − exp(−900e-9·22000)) ≈ 196 random returns`; `FIT_fleet =
300 → λ ≈ 66`.

### 2.2 The canonical draw order (the reproducibility crux)

The per-part / per-mode / sub-population (counterfeit batch) draws **walk the
elements in canonical netlist element-index order** (the order `buildNetlist` emits),
advancing the single stream deterministically — **never a hash-map iteration, never
`Math.random`, never `Date.now`/wall-clock, never the global sim `SEED=1337`, never
`snapshot_hash`.** Where two draw *kinds* share the stream (the counterfeit binomial
+ the Poisson), the order is **pinned**: the **batch binomial draws first**, then the
Poisson, so the stream advances identically on every machine. Same design + contract
+ mode + quality → **bit-identical fleet fate across machines.** vitest pins:
`same seed → same count`; `dark-dot count == round(field-failure% · N)`.

### 2.3 The recall trigger (resolves parent Q2/Q5 with concrete floors)

`classifyRecall` fires when **one** root cause `(mode, part)` accounts for `share >
RECALL_SHARE (= 0.40)` of expected failures **AND** clears an absolute floor `λ_mode
≥ max(RECALL_FLOOR_ABS, N · RECALL_FLOOR_FRAC)` with `RECALL_FLOOR_FRAC = 0.005`
(floor = 50 at N=10 000, = 0.5 at N=100 so small teaching fleets never
false-trigger); **OR** the hard-safety override (any part shipped `s>1` fleet-wide,
or a UL/EMI gate failed-but-shipped) regardless of share. The report **names the
dominant part** — a recall is never bad luck.

### 2.4 The `balance.ts` block (freeze for the balance pass)

```ts
// data/balance.ts — the reliability constant block (illustrative; one balance pass owns these)
{ s_knee: 0.5, K: 6, T_ref: 55, T_double: 20,
  FIT_base: { R:2, ceramic:5, electrolytic:30, diode:8, LED:12, fet:20, IC:60, connector:15 },
  p_coldjoint: 0.5, m_infant: [4.0, 1.0, 0.4, 0.15],
  protectionFactors: { tvs:0.05, fuse:0.1, reverse:0.0, latch:0.1 },
  Tj_knee: 110, T_double_runaway: 10,            // mode-4 kicker
  counterfeitBatchFrac: 0.08, supplierPenalty: 6,// mode-6 (Phase-5)
  RECALL_SHARE: 0.40, RECALL_FLOOR_FRAC: 0.005,
  margin: 2, BOM: 0.40, scrap: 0.5, RMA_unit_cost: 8, recall_mult: 3 }
```

**Two invariants for the balance pass** (the load-bearing inequalities): keep
`RMA_unit_cost ≈ 4× margin` (so RMAs ≫ BOM savings → derating pays) **and** the
first-trickle ≈ 10% of profit (so it's a nick, not a wound). Real-mode-gated: Ideal
ships nominal (FIT ~0, yield 100%, no modes fire), the model bites only in Real.

> **A unit dies once (an invariant `runOutcome` must hold).** A wear-out certainty and
> the random Poisson wave must not double-count an RMA on the same part: a wear-out
> death **retires the unit from the random pool** at its wear-year. Without this, a
> hot cap with a high random FIT over-reports returns (§5 Q5).

---

## 3. (B) THE ECONOMICS — HOW MUCH MONEY

This is the half the owner asked for most directly. The rule the parent set and we
make precise: **a returned unit costs ≈ 4× its margin and a recall costs ≈ 3× the
run's gross, so reliability *is* the margin** — engineered around the inequality
`BOM_savings ≪ RMA_prevented ≪ recall_hit`, which makes derating/protection visibly
pay while a *first* failure stays a nick, not a bankruptcy.

### 3.1 The full production-run P&L

Inherited from parent §3.3, made complete with every line:

```
profit = N_shipped · margin_per_unit          // revenue on units that passed end-of-line
       − BOM_cost · N_built                    // parts cost (par.bomCost × volume)
       − scrap_cost · (N_built − N_shipped)    // units that failed end-of-line test (yield loss)
       − RMA_unit_cost · rma_count             // field returns (ship-back + replace + handling)
       − recall_hit                            // the crater, only if mode-12 fires
```

| Term | Illustrative value | Source / rationale |
| --- | --- | --- |
| `margin_per_unit` | **₵2/unit** | the per-unit profit the contract pays on a good ship (recommend a **contract field**, §5 Q2) |
| `BOM_cost` | from **`par.bomCost`** (the grader already computes it) | ties the **elegance/par** score to the run — a fat BOM eats margin at volume |
| `scrap_cost` | **₵0.5/unit** | a scrapped unit costs its BOM, recovers nothing |
| `RMA_unit_cost` | **₵8/unit** (≈ **4× margin**) | return shipping + replacement + handling — deliberately ≫ margin so field failures dwarf BOM savings |
| `recall_hit` | **`N · margin · 3`** | a recall wipes ~**triple** the run's gross — the company-scale crater |
| `N_shipped` | `N_built · yield` | `yield = 1 − tolerance_escape − (1−testCoverage)·latent` |

[the P&L is the parent's three-line sketch with BOM and scrap restored — BOM is where par cashes out at volume]

### 3.2 Worked P&L — the clean / marginal / recall triad

The owner's framing is **clean vs marginal vs recall**. The canonical exemplars: a
`N = 10 000`-unit consumer contract, `margin ₵2`, `BOM ₵0.40/unit`, 5-yr life @ 50%
duty (22 000 field-hours). All read the **same** design at different derating/quality
choices — the spread *is* the lesson. The **marginal** run is the new canonical
middle: the slow bleed that still profits.

| Outcome | Yield | RMAs | Recall? | P&L arithmetic | **Net** |
| --- | --- | --- | --- | --- | --- |
| **CLEAN** (derated `s≤0.6` + screened) | 97.2% | 196 random | no | `9 720·2 − 4 000 − 280·0.5 − 196·8 = 19 440 − 4 000 − 140 − 1 568` | **+₵13 732** |
| **MARGINAL** (under-derated `s≈0.85`, skimped screening — the slow bleed) | ~95% | ~1 000 (196 random + 450 elevated-stress **spread across 3+ under-derated parts, no single (mode,part) > ~18% share** + 350 infant) | no (no single (mode,part) clears the 40% floor — the spread is what keeps it sub-recall) | `9 500·2 − 4 000 − 500·0.5 − 1 000·8 = 19 000 − 4 000 − 250 − 8 000` | **+₵6 750** |
| **HOT CAP** (un-derated electrolytic) | 97% | 196 + 800 wear-out | no (under 40% share) | `9 700·2 − 4 000 − 300·0.5 − 996·8 = 19 400 − 4 000 − 150 − 7 968` | **+₵7 282** |
| **RECALL** (`s = 0.96` fleet-wide, one mode > 40%) | 97% | 196 + a dominant mode | **RECALL** | `19 400 − 4 000 − 150 − … − (10 000·2·3) = … − 60 000` | **heavy LOSS (≈ −₵45 k, clamped to forfeit-not-debt)** |

[same design, four derating choices, a ₵60k swing — the arithmetic *is* the derating curriculum]

**The reading the triad forces:**
- **Clean → marginal** is a **₵6 982** swing bought by derating that costs cents/unit.
  The marginal run **still profits (+₵6 750)** — under-derating *bleeds* but doesn't
  bankrupt, so the lesson is *"you left money on the table,"* a teaching nudge, **not
  a punishment.**
- **Marginal → recall** is the cliff where one mode crosses the 40% share floor. Only
  the *systemic* flaw (named pre-ship) goes negative.
- A first **RMA trickle** (the clean run's 196 returns) is **₵1 568** — a nick on
  **₵13 732** profit, **never bankrupting.** You ship, you profit, you learn.
- A **recall** is the only outcome that goes negative — and it only fires on a
  *systemic* flaw (one dominant mode) or a hard-safety `s>1`, both of which the report
  **named** before you shipped. The crater is earned, legible, recoverable, and
  **clamped to forfeit the run's profit, never to debt.**

### 3.3 BOM-savings vs RMA-cost dominance — *"derating pays ~13:1"* made numeric

The design choice that proves the inequality: *"a cheap cap saves ₵0.05/unit BOM but
runs hot → ~8% wear-out RMA wave."* At volume `N`:

```
BOM_saved        = N · 0.05
RMA_cost_incurred = (0.08·N) · 8 = 0.64·N
ratio            = RMA_cost / BOM_saved = 0.64 / 0.05 = 12.8×   (at EVERY volume)
```

The ratio is **volume-invariant by construction** (both scale linearly with `N`);
what volume changes is the *absolute stakes*, not the inequality:

| `N` | BOM saved | RMA cost bled | Ratio |
| --- | --- | --- | --- |
| 100 | ₵5 | ₵64 | 12.8× |
| 1 000 | ₵50 | ₵640 | 12.8× |
| 10 000 | ₵500 | ₵6 400 | 12.8× |

**Derating's prevented-RMA value is ~13× the BOM it costs.** That is the governing
inequality made arithmetic:

> `BOM_savings/unit (₵0.05–0.40)  ≪  RMA_unit_cost · field_failure_rate (₵8 · 2–8%)  ≪  recall_hit (N·margin·3)`

Each `≪` is ~10× or more. This is what makes **derate / protect / certify** visibly
pay while a first failure stays a nick. **Keep `RMA ≫ margin` (the 3–4× ratio) or
reliability stops mattering** — that single ratio is the master tuning dial (§5 Q1).

### 3.4 How the run plugs into Credits — the deferred second settlement

The production run is **not a new payout** — it **nets against the existing batch
payout** (`game-economy-progression-implementation.md` §3.1). The contract pays the
SHIP-IT lump; the run then **adds the field P&L** as a second, deferred settlement:

```
total_contract_credits = batch_payout (SHIP-IT, immediate)        // §3.1 formula, unchanged
                       + run_pnl       (field settlement, deferred) // this doc §3.1, can be ±
```

Where `batch_payout = round(BASE·(1+0.6·difficulty)·realismMult·eleganceMult·
marginMult·standingMult·decay)` is left **untouched**. This means:

- The **immediate** SHIP-IT beat stays the spike of juice (unchanged — parent's
  binding rule: bench ship supersedes, the run is an OFFER).
- The **deferred** `run_pnl` is where reliability engineering is rewarded — at volume
  it can **exceed** the batch payout itself, which is *why* a deep player engineers
  for the field.
- A recall's negative P&L **cannot drive Credits below zero** (clamp at 0 — you
  forfeit the run's profit and the rep, never go into debt; legible-not-punishing).
  The *bite* is the opportunity cost + the reputation crater, not bankruptcy.

> **Settlement-order contract (the integration seam, §5 Q4).** When `run_pnl` drips
> over the field-life fast-forward (vs an immediate net), the **clamp-at-0 applies to
> the combined Credits ledger position, not the run line alone** — so a recall can
> never appear to drive a *prior* balance negative. Batch contracts settle
> immediately; standing contracts drip. `applyEarn` gets a new `run` producer, not a
> new ledger or currency.

[the run is a deferred second settlement on the same contract — clean ships earn rent, recalls forfeit it, neither goes to debt]

### 3.5 How payout scales — volume × difficulty × reality

Three multipliers on the run P&L, each tied to an existing axis:

| Axis | Effect on run P&L | Why |
| --- | --- | --- |
| **Volume `N`** | linear on every term (margin, RMA, recall) | a 10k-unit contract has 10× the upside *and* 10× the recall crater — the Shapez *"demand ramps"* loop |
| **Difficulty** | the contract's stress profile hardens (hotter ambient, higher duty, more life-years, tighter return threshold) | a harder field = a bigger reliability reward for surviving; `difficulty` already scales `BASE` via `(1+0.6·difficulty)` |
| **Reality (Real vs Ideal)** | **Ideal ships nominal** (yield 100%, FIT ~0, no modes fire) → `run_pnl ≈ N·margin − BOM`. **Real** exposes the full catalog | the `realismMult` (1.6–2.2×) pays on the batch payout *and* exposes the failure catalog — realism is a **gamble that pays a multiplier**, never a free win (the anti-domination rule) |

[volume scales upside and crater together; reality is the gamble that pays the multiplier — never a free upgrade]

**The volume sweet-spot.** Because `RMA_unit_cost (₵8) ≫ margin (₵2)`, a marginal
design's RMA cost *grows faster than its revenue* as `N` climbs — a fragile design
that profits at `N=100` **loses** at `N=10 000`. **Volume itself is the difficulty
dial for reliability.** The standing-contract drip (§3.7) is where this lives
long-term.

### 3.6 Funded quality — the Credit sink that must visibly pay

The `[QualityBudget]` (parent §4.4) is a **pre-ship Credit sink** that buys down the
**infant** and **yield** terms only (the firewall). Illustrative pricing, so the
allocator presents as a **decision with a visible before/after delta**:

| Line | Cost (illustrative) | Buys | Visible delta on the card |
| --- | --- | --- | --- |
| **Screening / burn-in** | ₵0.30/unit | `m_infant` 4.0 → 0.15 (cuts yr-1 wave ~7×) | the **infant** RMA bar shrinks |
| **Solder / reflow-AOI QA** | ₵0.15/unit | fewer cold-joint scrap + field returns | **yield %** climbs, cold-solder bar shrinks |
| **Test coverage** | ₵0.10/unit | catches tolerance-stack escapes at end-of-line | **yield %** climbs (fewer field escapes) |
| **Supplier grade** *(Phase-5)* | ₵0.20/unit | counterfeit/early-life risk down | the supplier-batch sub-population shrinks |

[the budget is four decisions with four visible deltas — never an opaque "quality slider"]

**The pay-off math (worked, both ways — the firewall felt in numbers).** On the
**lazy/skimp** run, spending **₵0.30/unit × 10 000 = ₵3 000** on burn-in cuts the
**600 infant RMAs to ~85** — saving `(600−85)·8 = ₵4 120` for a ₵3 000 outlay. **Net
+₵1 120**, and yield rises too. Screening **pays**. But — the **firewall** — spending
that *same* ₵3 000 on the **hot-cap** run does **nothing** for the 800 wear-out
returns (burn-in can't fix a cap physically drying out); the ₵3 000 is **money set on
fire**, the year-2 spike still comes. *"You can't buy your way past a bad derating."*

On the **marginal** run the ROI is thinner-but-positive: ₵3 000 burn-in cuts ~350
infant RMAs to ~50 → saves `(350−50)·8 = ₵2 400` (net −₵600 on infant *alone*), but
also lifts yield ~1.5 pt (≈150 fewer scrap+escape units) → break-even-to-slight-
positive. The *bigger* infant win is always on the lazier run. [screening pays on infant defects and is money set on fire on a wear-out cap — the allocator teaches which knob touches which region]

### 3.7 The reputation feedback — a stake, not a currency

Reputation is **unspendable, unbought, decaying** local state (parent §4.2,
`game-economy-progression-implementation.md` §3.3 standing). The run feeds it:

| Run outcome | Standing Δ (0..100 scale, matching `game-economy-progression-implementation.md` §3.3) | Credit consequence |
| --- | --- | --- |
| Clean fleet, CEC-Certified | **+6** | unlocks higher-difficulty / higher-`BASE` contracts; `standingMult` → 1.1 |
| Bronze pass, scattered RMAs | **≈ 0** | flat — you held the line, no progress |
| RMA — vent (`s>1` on `[failedMask]`) | **−25** (+ drip clawback) | the bench-FAIL part craters rep *and* clawbacks |
| **Recall** | **−35** (a crater, ~6 clean ships to undo) | `standingMult` drops; the customer stops offering below standing 40 |

**The feedback loop closed with numbers (two consecutive runs).** Standing gates
*which contracts are offered* and the `standingMult = 0.9 + 0.2·(standing/100)` on
**both** the batch payout and the run margin.

> *Run-1:* a clean CEC-Certified ship at standing 70 → **+6 → 76**. This unlocks a
> higher-`BASE`/higher-difficulty contract.
> *Run-2:* offered at `BASE 80` (vs 50), `difficulty 0.6` (vs 0.4), `standingMult
> 1.08` (vs 1.04). A clean record **compounds** into bigger contracts → bigger runs →
> bigger reliability rewards.
>
> *A recall (−0.35 ≈ standing −25 + clawback) **de-compounds**:* the customer stops
> offering below standing 40, you rebuild on small easy batches. Reputation **decays
> ×0.98/window** so neither glory nor disgrace is permanent (~6 clean ships to undo a
> recall). Bounded `standingMult` (0.9–1.1, narrow) + decay pull both extremes to
> neutral, and an always-available floor of small easy batches means a recall is a
> *setback, not a dead-end*.

Reputation is the **stake** that turns one good run into a trajectory and one recall
into a setback — **never a balance you spend**. [reputation is the only thing in the economy you can't buy, can't grind, and can't keep — which is exactly why it's the stake]

### 3.8 MTBF / reliability standing contracts (the idle-income loop)

On the standing-contract harness (`game-contracts-economy` §2), a reliability
contract — *"ship 10 000 units, hold < 1% return at 5 years, automotive ambient
85 °C, duty 0.6"* — reads the seeded stress profile into the life integral. The RMA
trickle advances **deterministically** by ticking the same seeded stream forward by a
**tick-pure integer `run-interval-index`** (`mulberry32` advanced N draws), **never
wall-clock**. Payout is a Credit drip per window *while* the fleet holds < the return
threshold; cross it and the contract **lapses** (reputation debit scaled to
overshoot). This is the natural home for the Flagship band + CEC-Certified Lux and
the volume-is-difficulty loop.

### 3.9 The anti-grind balance — derating pays without a first failure bankrupting

The balance targets, stated as invariants for the balance pass:

1. **First-RMA-trickle is a nick, not a wound.** A clean Real-mode run's residual
   trickle (≈2% returns) costs ≈10% of the run's gross. You **always profit** on a
   competent first ship. *(₵1 568 RMA on ₵13 732 profit.)*
2. **Derating's payoff ≫ its cost.** The ~13× ratio of §3.3. The dial that makes it
   true is `RMA_unit_cost / margin = 4`; tune up for stakes, down for gentleness — but
   keep `RMA ≫ margin` or reliability stops mattering.
3. **The marginal run still profits.** +₵6 750 — under-derating teaches *"money left
   on the table,"* never bankruptcy. If balance accidentally makes it negative, the
   nudge becomes a punishment (violates legible-not-punishing).
4. **Recalls are earned, named, recoverable.** A recall only fires on a *systemic*
   flaw the report **named pre-ship**, or a hard `s>1` the **bench already boxed**. It
   craters the run's profit and the rep, but **clamps Credits at 0** (no debt) and the
   rep **decays back** (~6 clean ships).
5. **Volume is the reliability difficulty dial.** A fragile design profits small and
   loses big.
6. **The firewall holds.** Funded quality buys down infant + yield only; it **cannot**
   touch the stress-driven random rate or the wear-out spike. Engineering (derate,
   protect, certify, grade) is the only path to the steady-state and wear-out wins.

[the dial that makes it all work is RMA = 4× margin — turn it up for stakes, down for gentleness, but keep RMA ≫ margin or reliability stops mattering]

---

## 4. The teaching / all-ages read (light — cites the existing bridge)

The parent §5 owns the on-ramp in full; this doc keeps the read **light** and cites
it. Three load-bearing pieces, restated only enough to anchor the catalog and the
money:

- **The fleet-grid** (parent §5.3) is the by-feel ↔ numeric ↔ full-report widget. A
  10×10 dot grid: green = humming, grey = came back, red-ringed cluster = recall.
  *"8 dots dark"* IS *"8 came back."* Holding a dark dot **highlights the part on the
  board that cooked it** — the literal wire between the bench FAIL box and the dark
  dots. The catalog's `FailureMode.rootElementIndex` (§1.4) is what powers that
  highlight; the recall's named `(mode, part)` is what the red ring points at. *(At
  non-100 volumes the grid is a **percentage** view — a vitest pins `dark dots =
  round(field-failure% · 100)`, not a raw count, so the "dots ARE the number"
  contract holds at 10k, §5 Q3.)*

- **The Probe narrates a recall** (parent §5.2) blameless-but-honest: *"Uh oh — they're
  ALL coming back! Something I shipped breaks the same way every time. Let's autopsy
  it."* Every line names a **cause AND a fix** and points at the **one part** to
  change — the recall is the Probe's-and-yours-together, never *"YOU failed."* The
  flood respects `prefers-reduced-motion` + the sensitive-child guard (a single calm
  state change, no particle storm).

- **Legible-not-punishing** (parent §5.4): every field failure logs a one-time-Lux
  **codex page** via the autopsy flip. The twelve modes are twelve discoverable
  phenomena (cold-solder, ESD, electrolytic-wear-out, thermal-runaway,
  derating-violation, counterfeit-batch, latch-up, tin-whisker, connector-fretting,
  over-voltage, reverse-connect, the-recall). The crater becomes a **collectible
  lesson**; the by-feel skin is a sticker-book slot for pre-readers. **Build the
  report and the derate-and-re-ship loop together or not at all** — a report with no
  lever is the punishment economy we forbid.

The all-ages litmus holds because the production run is **one read-only consumer of
the shared snapshot**, surfaced at the depth the player pulls — a 5-year-old reads the
dimming dots, an EE reads the FIT term decomposition, both off the same widget.

---

## 5. Reuse vs new surface

The expansion is **almost entirely reuse** — a new *consumer* of machinery that
already exists, plus the single `FailureMode[]` decomposition.

### Reuse (existing, verified)

| Existing machinery | Role here |
| --- | --- |
| the entire parent §3 FIT chain (`accel_s` `K=6`/`s_knee=0.5`, `accel_T` `T_double=20`, the `FIT_base` table, the wear integral, `m_infant`, the protection collapse) | the catalog adds **no new arithmetic** — it *labels* the existing Σ into named modes |
| `[RATED_CURRENT_SLOT]`(=2) + `[flag_and_clamp_fails]` (verified `lib.rs:2452`, flag-only, unhashed, **not** in `snapshot_hash`) | the `s_I` denominator and the bench↔fleet bridge for modes 5/12 |
| the web Tj integrator (`Component.temp`, golden-safe) | the master derating input for modes 3/4/8 and the Arrhenius term |
| `[diodes.ts]` (`RATED_CURRENT_SLOT`/`DIODE_TT_SLOT`/`diodeVariant`/`hasDiodeTypes`, verified `diodes.ts:11/12/87`) | the diode-rating reads for modes 7/10/11 |
| `[tiers.ts]` (`ecEsr` `EC_ESR_BY_TIER [1.0,0.5,0.1,0.03]`, `resistorTolerance` `R_TOLERANCE_BY_TIER [0.05…0.001]`, verified `tiers.ts:104/115`) | the supplier-grade and tolerance-escape reads for modes 1/6 |
| `[graphShape]` topology oracle (value-independent, no sim read) | `protectionPresent` for modes 2/5/7/10/11 |
| `[electricalMap]` `{current, vAcross, failed}`, `P=V·I` | the numerator of every stress ratio |
| `mulberry32` + the web-side `designHash` (the `probe-teaching-arc` §3a convention) | the deterministic Poisson + the counterfeit binomial, in canonical order |
| `batch_payout` (`game-economy-progression-implementation.md` §3.1, unchanged) | the run P&L **nets onto** it as a deferred second settlement |
| `applyEarn` / `EarnEvent` rma path + standing 0..100 (vent −25 + clawback) + per-seed decay | the run P&L is a new **producer** of existing rma/standing events — no new ledger, no new currency |
| the SHIP-IT triad + Bronze→CEC-Certified tiers + the dual-form by-feel+numeric renderer + `voltageColor` | the RUN-SHIPPED cascade, the cert gate to CEC-Certified, the fleet-grid |

### New surface (web-side only — read-only consumers + one sampler)

| New | What it is |
| --- | --- |
| **`partFIT(comp) → FailureMode[]`** *(the only added machinery)* | returns the labelled term list `{id, fit, region, rootElementIndex, wearYear}` instead of a scalar, so the recall **names** its `(mode, part)` cause and the bathtub regions render distinctly. It **labels** the existing single Poisson — adds zero draws |
| **`classify()` / `classifyRecall()`** | groups by `(mode, part)` share for the recall predicate (§2.3) |
| **`reliability.ts`** pipeline + Knuth `poissonSample` + the ordered-walk sampler + the TS `designHash` | the §2 model v2, read-only over the batched snapshot |
| **`data/balance.ts`** reliability block (§2.4) | the frozen constant table for the balance pass |
| **the report-card P&L line-stack** (gross / −BOM / −scrap / −RMA / −recall → net) + the avoided-RMA counterfactual line + the funded-quality before/after delta | presentation |
| **the per-mode FIT_base + collapse factors + the runaway `Tj_knee`/`T_double` + the counterfeit binomial fraction + the wear-out trio L-drivers** *(illustrative)* | balance-pass data |

**Smallest-surface confirmed:** the single genuinely-new sim concept is
`FailureMode[]` (a labelled term list), and it is golden-safe because it *labels* —
never multiplies the draw count of — the one existing Poisson. **None** touches
`sim-core`, the netlist, or `snapshot_hash`.

---

## 6. Determinism & golden-safety statement

**Golden-safe by construction — no Rust is touched.** `cargo test -p sim-core`
(incl. `run_is_reproducible`) and the FNV-1a golden are out of scope and cannot move.
This doc adds **no new mechanism** beyond the parent's §7 — it *labels* the existing
FIT sum into modes and *completes* the P&L arithmetic.

1. **Every mode is one additive term in the existing `FIT_fleet = Σ` sum** (parent
   §3.7), reading **only** already-deterministic, unhashed bench feeders:
   `[electricalMap]` (stress ratios), the web **Tj** integrator (`Component.temp`),
   `[RATED_CURRENT_SLOT]`(=2) + `[flag_and_clamp_fails]` (the unhashed `failed_elements`
   flag-only mask — verified `lib.rs:2452`; the doc-comment confirms it *flags, never
   alters the solve*, and `failed_elements` is **not** in `snapshot_hash`, which folds
   only `tick` + `node_v`/`net_level` + sequential ff/samp/cmp/beh integer state),
   `[tiers.ts]` grades + tolerance Monte-Carlo, `[diodes.ts]` variants/ratings
   (`DIODE_TT_SLOT`(=3) is Real-mode-only and zeroes to bit-identical when `TT=0`),
   and the emissions estimate. **None is in `snapshot_hash`.**

2. **The "roll" is a deterministic distribution SAMPLE, not RNG.** `FIT_fleet → λ →
   Poisson(λ)` (Knuth) and the counterfeit sub-population (binomial) walk the elements
   in **canonical netlist element-index order** over the ordered element array (never
   a hash-map iteration — that would silently break cross-machine reproducibility),
   advancing **one** `mulberry32` stream seeded off the web-side `designHash =
   fnv1a32(canonicalNetlist) ^ contractId ^ fidelityModeTag ^ fundedQualityLevel`. The
   batch binomial draws **before** the Poisson so the stream advances identically
   everywhere (§2.2). **Never `Math.random()`, never `Date.now()`/wall-clock for any
   outcome** (wall-clock allowed only for non-outcome presentation), **never the
   global sim `SEED=1337`, never `snapshot_hash`.** The `FailureMode[]` decomposition
   only **labels** the existing single Poisson — it adds no draws. Same design +
   contract + mode + quality → same fleet fate, bit-for-bit, across machines.

3. **The P&L is pure arithmetic over the sampled counts** (`N`, `yield`, `rma_count`,
   `recall?`) and the contract's scalar economics — plain TS reducers in `economy.ts`,
   persisted in the `cec.game.v1` sibling key, no sim contact beyond the once-per-frame
   batched snapshot. Standing-contract RMA pacing advances by a tick-pure integer
   `run-interval-index`, never wall-clock.

4. **Real-mode-gated.** In **Ideal** mode every mode is dormant (yield 100%, FIT ~0,
   `run_pnl ≈ N·margin − BOM`); the catalog bites **only in Real**.

5. **No new currency.** Credits = ship (the run P&L nets against the batch payout,
   clamped ≥ 0 — no debt), Lux = understand (each autopsy/mode-codex page fires once
   via `claimedLux`), reputation = the unspendable, decaying stake. **The JS↔wasm
   boundary stays coarse** (one batched snapshot read/frame).

> **One acknowledged float-determinism hazard (not a golden risk).** JS `Math.exp` /
> `Math.pow` in the `accel_s`/`accel_T` curves and Knuth-Poisson are not bit-
> guaranteed across engines; a λ on a knife-edge could flip the integer draw count.
> Mitigation: pin a vitest golden over a representative fleet, and if drift appears,
> quantize λ to a fixed decimal before sampling. This affects only the web-side
> sample, never the Rust golden.

---

## 7. Phased build path

Honours the parent §8 ordering. **Phase 1 ships today; the input-gap modes are the
only blocked surface.** The ✅/⏳ in §1.1 is the per-mode key.

| Phase | Ships | Modes | Blocked on | Notes |
| --- | --- | --- | --- | --- |
| **1 — Report card** | `reliability.ts` stress→FIT→yield→RMA chain + `FailureMode[]` + the fleet-grid + the RUN-SHIPPED cascade + Probe narration + the P&L line-stack | **1, 3, 4, 5, 11, 12** (the core + recall) | **nothing** | reads heat (Tj) + `RATED_CURRENT_SLOT` + `electricalMap` + `graphShape`, all present. **Start here.** |
| **2 — Funded quality + protection** | the `[QualityBudget]` allocator + `protectionPresent` collapse | sharpens 1/2/5/11; the collapse factors land | nothing | the design-for-reliability budget made legible |
| **3a — UL gate** | `[ulLab]` (over-temp + protection-present + coarse creepage) + the `lifeMultiplier` | enables the cert overlay on the random term | nothing | reads Tj + topology; **ships ahead of FCC** |
| **3b — EMI gate + field-event modes** | `[emiChamber]` + ESD/over-voltage/latch-up | **2, 7, 10** | the invisible-electronics kernel (`coupling.ts`/`spectrum.ts`/`geometry.ts`) **and** a field-stress-event input | typed stubs return `unavailable` until the kernel + event input land |
| **4 — Reputation + recalls** | the reputation track + bands + the recall event + the magic-smoke→autopsy→Lux flip | activates 12's economy | nothing | the long-game stake |
| **5 — Richer reliability** | counterfeit, supplier-grade, true `geometry.ts` creepage, MTBF standing contracts | **6, 8, 9** | the geometry kernel + a duty/cycle input | the Era-6 capstone |

**Ship the core five-plus mode set in Phase-1** (cold-solder, electrolytic,
thermal-runaway, over-derating, reverse-connect, and the recall predicate); defer the
field-event modes (ESD/latch-up/over-voltage) to 3b and the creepage/supplier modes
(counterfeit/whisker/fretting) to 5 — **do not ship a mode whose feeder is absent**
(exactly like the EMI gate's `coupling.ts` dependency).

---

## 8. Open questions / owner hand-offs

1. **`RMA_unit_cost / margin` ratio (the master economic lever).** Illustrative **4×**
   (₵8 vs ₵2). This single ratio decides whether reliability matters. *Recommend 3–4×
   — high enough that RMAs dwarf BOM savings, low enough that a first trickle is a
   nick. Balance + telemetry.* (Parent §9 Q10.)

2. **Is `margin_per_unit` a contract field or a flat constant? Is `BOM` an explicit
   P&L line wired to `par.bomCost`?** *Recommend both as contract fields* (different
   contracts → different unit economics) with ₵2 / ₵0.40 illustrative defaults — this
   is what makes the par/elegance score cash out at volume.

3. **`recall_hit` coefficient + the clamp.** Illustrative `N·margin·3`. Confirm `k=3`
   and confirm Credits **clamp at 0** (no debt) **on the combined ledger position**,
   not the run line alone (the §3.4 settlement-order contract).

4. **Does `run_pnl` net immediately or drip over the field-life fast-forward?**
   *Recommend immediate net for batch contracts (cleaner juice), deferred drip for
   standing contracts (teaches income-over-time).* Owner + juice call. (Parent §9 Q9.)

5. **The "a unit dies once" invariant.** Confirm wear-out certainties **retire the
   unit from the random Poisson pool** at their wear-year, so a cap that both wears out
   *and* has a high random FIT doesn't double-count an RMA. (§2.4.)

6. **Per-mode `FIT_base` + the protection collapse factors** (TVS ×0.05, fuse ×0.1,
   reverse-diode ×0.0, latch-up/OV ×0.05–0.1, ESD_base ≈180). Need a balance pass so
   each fix's payoff is legible on the card without trivializing the design. Owner +
   telemetry.

7. **The thermal-runaway kicker shape** (mode 4). *Recommend the Tj-knee
   super-doubling* (`T_double` 20 °C → 10 °C above ~110 °C, a steeper exponent —
   legible, golden-safe, no new physics) over a regenerative iteration (risks an opaque
   dice cliff). Make the knee a **visible inflection** on the published derating curve,
   not a discontinuity, so a part fine at 109 °C and dead at 111 °C never reads as
   punishing. Owner.

8. **The counterfeit batch sampling** (mode 6, Phase-5): the binomial batch-fraction
   (~8%?) and `supplierPenalty(grade)` curve, **plus pinning the batch draw BEFORE the
   Poisson in canonical element-index order** (a draw-order vitest). Owner + balance.

9. **`RECALL_SHARE` (40%) + the absolute floor** (`RECALL_FLOOR_FRAC = 0.005` →
   floor 50 @ 10k, 0.5 @ 100). Confirm the floor protects small teaching fleets from
   false-triggering, that big-N near-misses (a legitimately-bad 39%-share mode) don't
   silently escape, and that the make-100 teaching run gates on a clean bench ship so
   the first meeting is win-first. (Parent §9 Q2.)

10. **`partFIT → FailureMode[]` shape.** Confirm `{id, fit, region, rootElementIndex,
    wearYear}` is sufficient for *both* the recall finder *and* the per-line expandable
    report, and that grouping by `(mode, part)` share is the right recall predicate vs
    grouping by part alone.

11. **The reverse-connect ruling (mode 11).** Confirm it earns its own codex page +
    sticker slot (the unique `×0.0` elimination) vs folding into mode 10. The parent
    §3.6 lists it separately; this doc promotes it. Owner to decide.

12. **The avoided-RMA counterfactual line** on the report card (*"your derating
    prevented ~₵6 400 in returns"*). It makes the invisible win visible — the single
    strongest teaching line for *why* derating pays. *Recommend yes, as a one-line
    expandable.* Owner.

13. **Reputation scope + the float-quantization hazard.** Per-customer-domain or one
    global scalar? *Recommend per-domain at the Era-6 capstone, single scalar for the
    Phase-1 light beat.* And decide whether to quantize λ before the Knuth sample to
    defend against cross-engine `exp()` drift (add a vitest golden either way, §6).

14. **Wear-out trio v1 vs Phase-5** (modes 8/9 whisker/fretting): a coarse
    creepage/duty input in v1, or strictly Phase-5 behind the `geometry.ts` dependency?
    *Recommend Phase-5 — ship the core modes first.* (Parent §9 Q5.)

15. **The per-mode "engine input present today?" column** (§1.1): confirm it's the
    right place to surface the four ⏳ field-event/creepage modes, rather than the gap
    living only in the phase table — so a builder never starts mode 2 expecting
    `electricalMap` to surface an ESD event.

16. **Fleet-grid percentage mapping at non-100 volumes.** Confirm the vitest pins
    `dark dots = round(field-failure% · 100)` (the percentage mapping), not a raw
    count, so the all-ages *"the dots ARE the number"* contract holds at 10k units.
    (Parent §9 Q14.)

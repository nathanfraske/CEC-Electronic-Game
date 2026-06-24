<!-- SPDX-License-Identifier: Apache-2.0 -->

# CEC Electronic Game — Master Design Brainstorm

*Synthesis of five design lenses: progression/onboarding, the reality ramp, core loop/economy, retention/UGC/social, and wildcards. Grounded in the existing corpus (`game-design.md`, `game-progression.md`, `game-contracts-economy.md`, `game-factory-loop.md`, `game-rewards.md`, the four bench-realism ideations, `reality-roadmap.md`, `ic-maker-guide.md` + ADR 0006) and the live engine (the `real` gate in `buildNetlist`, `BoardLens`, `TRANSIENT_TIER_KINDS`, the `RATED_CURRENT_SLOT` FAIL mask, the seal-as-same-netlist IC maker). Where the lenses disagree, the call is made explicitly. This is ideation — no code, no levels invented that contradict shipped systems.*

---

## 1. Vision & pillars

**What this game is.** A browser-based electronics teaching game where a deterministic, fixed-step Rust sim is the *only judge*, three lenses (schematic / electron-flow "reality" / water-pipe "analogy") make the invisible visible, and an Ideal→Real fidelity axis turns "more reality" into the progression itself. You sit at a bench, place real parts, wire them, and watch genuine physics play out; you take jobs (contracts) that pay you to hit a spec; you climb a tech tree of *more truth* (tolerances, ratings, parasitics, heat, EMI, field reliability); and the capstone verb is sealing a circuit you understand into a reusable chip you author yourself. Fun is the carrier; the cargo is that you walk away actually understanding how electronics work — not the symbols, the *substance*.

**Design pillars** (each reconciles "teaches real electronics" with "a game people choose to play"):

1. **One honest model, no puzzle logic.** Every challenge is *data the same engine runs*; every reward is a number measured off a deterministic replay under stated conditions (`game-rewards.md` §0). There is no hidden "intended answer" — the sim grades pins, not topology. This is what makes the game endless (a generator, not a level-pack) *and* honest (you can't cheat physics).
2. **Fidelity is the progression.** You don't unlock bigger numbers; you unlock *more reality*. The campaign is a ramp of non-idealities, each a distinct lesson, each opt-in for understanding and contract-demanded for money. "Worked in Ideal, failed in Real" is the teaching engine (§4).
3. **The bench is the toy; everything else is a pull, not a gate.** Place/wire/run/probe is complete and fun before any economy exists (`game-factory-loop.md` §4). Contracts, the tech tree, and the social layer are *matches you choose to play in the gym* — never the only reason the game comes alive. There are **no levels and no upfront picker**: one sandbox for everyone, structured experiences pulled on as overlays (`onboarding-first-run.md` §10).
4. **Make the invisible visible — at the cheapest cognitive cost.** Current, voltage, heat, fields, time. Lenses, the water analogy, the magnitude-on-the-bar visual language, and a thermal/EMI lens family turn abstractions into pre-attentive pictures. Water is the most-visible model we have; the scope is the second.
5. **Understanding is its own currency, and it never substitutes for grinding.** Two non-fungible currencies (Credits = breadth/shipping, Lux = depth/mastery) plus a non-spendable Reputation *standing* keep three axes — shipping, understanding, sharing — deliberately separate. The fastest way up is curiosity, not repetition.

---

## 2. The core loop & spine

### 2.1 The spine: contracts — earned, not assumed

The corpus converged on **contracts-as-purchase-orders**, and stress-testing against the alternatives confirms the choice is *structural, not stylistic*. The decisive constraint (Pillar 1): the sim is the only judge, which rules out anything needing hand-authored puzzle logic.

| Candidate spine | Sim-is-sole-judge | Fidelity-is-progression | Content cost | Verdict |
| --- | --- | --- | --- | --- |
| Hand-authored puzzle campaign | Poor (implies one true answer) | Neutral | Dead on contact (authored once) | **Reject** |
| **Parametric contracts** | **Perfect** (spec[] AND-ed off replay) | **Perfect** (supply grows with the part tree) | Endless from ~12 templates × seeds | **Spine** |
| Freeform sandbox only | Perfect | Good | Infinite but aimless | **Substrate, not spine** |
| Idle/automation | Good | Weak alone | High | **A texture (standing contracts)** |
| Research tree funded by jobs | Good | Perfect | High | **The rail the spine feeds** |

The answer is therefore **contracts as the transactional spine, with sandbox as the always-present substrate, standing contracts as the idle texture, and the Lux-gated era tree as the progression rail.** The alternatives aren't rejected — they're *integrated as components* of the contract spine. This survives adversarial testing; we commit it.

### 2.2 Moment-to-moment (what your hands do)

```
PLACE a part → WIRE nets → RUN / STEP / SCRUB time → OBSERVE (belts flow, scope, meters,
heat glow, coupling lens) → JUDGE a value (size R, pick Vz, choose a ratio/topology) → re-RUN
```

This inner loop is self-rewarding *without a grader* — predict-then-reveal works in pure sandbox, the lab notebook fills whenever you cause a phenomenon anywhere, the Test Bench is consequence-free destruction. **One reframe we commit: elevate DEBUGGING to a first-class core verb.** The most electronics-authentic and most replayable inner loop is *observe-something-wrong → hypothesize → probe → fix*. The corpus only names this as a "repair contract" type; instead make a near-working board with a *visible symptom* (FAIL box, heat glow, brown-out, coupling arc) a **constant texture** of the bench. The deterministic replay makes it perfectly fair, and it is the single most engaging electronics moment there is.

### 2.3 The economy — the three-clock model

We keep the corpus's **two-currency firewall verbatim** (Credits ₵ spendable, Lux = un-grindable mastery) and add structure to the loops that produce and spend them. The structural contribution is separating the economy into three clocks at three time-scales — which also resolves the corpus's quiet conflation of "the engineer at a desk" and "the company shipping a fleet."

**Clock 1 — The Bench (seconds→minutes): free, creative, Lux-producing.** The bench costs nothing and risks nothing. The decisive refinement: **the fidelity tax is charged at SHIP, not at PLACE.** Per-placement charging taxes *experimentation* (trying a 1% resistor shouldn't cost money; *committing* one to a shipped product should). On the bench everything is free to try, ideal and real alike; the BOM cost shows live as an ambient par-meter ("7 parts, ₵142 BOM, 1.2 W") but is only debited at the ship gate. This keeps the bench a true sandbox while preserving the fidelity tax as a real economic force, and lands the realism *gamble* where it belongs — at ship, where a real part can actually fail. Bench output: **Lux**, via predict-then-reveal, lab-notebook phenomena, autopsies, eurekas. A pure tinkerer can climb the whole tree on Lux alone.

**Clock 2 — The Contract / Ship (minutes→session): the transactional crystallization.**

```
OFFER (seeded, satisfiability-proven, ships a par) → ACCEPT (drops the JUDGEMENT PART — the
customer's acceptance fixture marking the graded nets, carrying θ_load/stimulus) → BUILD on the
bench → SHIP (BOM debited, deterministic graded replay runs, spec[] AND-ed at the judgement
pins) → PAY (SHIP IT juice: green-band cascade, payout count-up, free instant replay) →
bonus tiers Bronze→Silver→Gold→CEC-Certified layer realism × elegance × margin multipliers
```

The ship gate is the economy's heartbeat and the place every realism system finally has a consequence: heat (thermal budget spec lines), EMI (emissions vs an FCC limit), IC density (inner-part derating), and — a new dimension the connectors doc enables but didn't name — **interface compliance** ("must mate to a VGA DE-15 / present a USB-C pinout," gradable as pin-role + package checks, golden-safe). Two durations: **batch** (build→ship once→paid once — the on-ramp and juice spike) and **standing** (commit a circuit; it pays ₵/interval *as long as it holds spec* under a tick-seeded walking load — robustness-over-time = income, and the answer to the "idle layer" alternative). Output: **Credits** (breadth) + first-time-concept Lux.

**Clock 3 — The Product Run (a "year" of sim-time, on the fielded fleet): the stakes.** This is `product-run-reliability-ideation.md`, and it is the **win/lose layer the contract loop alone lacks.** When you commit a design to a *manufacturing run*, the measured margins + the quality you funded + the contract's stress profile produce a deterministic outcome, seeded off the design hash (no save-scumming): **certification gates** (FCC EMI chamber, UL safety — pass-to-ship), **yield %**, **field-failure rate (FIT/MTBF)**, **RMAs** (Credit + reputation hit), and the dreaded **recall** (a systemic flaw — the company-scale magic-smoke moment). This converts every bench-realism system into *one consequence surface*, making "derate, protect, certify, fund quality" the literal optimal strategy. The **margin multiplier** is rewarded twice — once at the contract payout, once as lower field FIT — the most elegant alignment in the economy.

Running underneath all three: the **tinkerer's parallel loop** (lab notebook + eureka). Causing any detectable phenomenon *anywhere* fills a codex page, pays one-time Lux, and trips a **eureka discount** on the related tree node (Civ-VI for circuits: doing the thing discounts its tech). This gives free play a shape (a quest list) and makes curiosity the cheapest path up.

**The firewall, in one line:** Credits buy breadth (grindable, fine); a competency exam proves you can use a part; Lux buys depth (un-grindable); the cheapest Lux is tinkering toward the next tier. Reputation is a derived *score*, not a spendable currency. Three non-fungible gates, no axis grindable past.

### 2.4 Win/lose & scoring

There is no single "win" — the tech tree is the progress bar and the campaign is emergent. But the corpus is thin on *losing*, and the product run supplies it. The scoring stack, all off the deterministic replay (uncheatable): **(1)** pass/fail per spec line → **(2)** bonus tier Bronze→Silver→Gold→**CEC-Certified** (holds spec across a Monte-Carlo/worst-case sweep) → **(3)** par/golf (parts, BOM, power) → **(4)** product-run P&L + reputation — *where you can actually lose.*

---

## 3. Progression map

### 3.1 The campaign already exists — it's a reading order, not new content

The single highest-leverage insight: **the ~50 worked examples in `EXAMPLE_CATEGORIES` are already an authored, ordered campaign.** Each is a self-advancing guided build (`do`/`why`/`done`) with a "build the broken version, see what's missing, add the part, see it fixed" structure (the `buck` example — spikes → freewheel diode → cap smooths — is a masterclass). The design move is **not "write a campaign"** but "bind the 14 example-categories to the 8 progression eras and let the tech-tree gates project the shipped examples into a guided order."

| Era | Unlocks | Campaign examples |
| --- | --- | --- |
| **0 First Light** | Fundamentals, Sources | `primer`, `divider`, `pot-dimmer`, `parallel`, `isource` |
| **1 Tolerances** | (re-skins Fundamentals with real parts) | replay `divider`/`parallel` with a real 5% resistor — the fidelity tax |
| **2 Diode Age** | Diodes, Rectification (DC) | `diode-clamp`, `led-limit`, `schottky-vs-silicon`, `zener-shunt`, `surge-clamp` |
| **3a Hands On** | (subset of Power & Switching) | `manual-switch-led` |
| **3b Second Domains** | thermal/light | **content gap** (~3 thermistor/LDR examples to author) |
| **4 Active Tier** | Power & Switching, Op-Amps | `mosfet-switch`→`mosfet-cs-amp`→`bjt-ce-amp`, `opamp-*`, `buck`, `pwm-average` |
| **5 Integration** | Logic from Transistors, Logic & ICs | `cmos-nand` (built from 4 MOSFETs) **then** `logic-and` (the gate as one glyph) |
| **6 Design Rules** | the DRC/reliability layer | contracts gain DRC spec lines; the reliability labs |
| **7 IC Maker** | the seal mechanic | player authors their own |

Two opinionated calls: **(a) the AC track is a parallel spine**, not gate-locked behind transistors — a cheap "AC source + Bode/phasor" tool unlock gates it (the frequency tools are analytic and don't need the transistor engine). **(b) "Logic from Transistors" must precede "Logic & ICs"** — the player builds a NAND from four MOSFETs they just learned, watches it work at the analog level, and *only then* gets the gate as a one-glyph IC. That "build it from discretes, then earn the abstraction" ladder is the keystone of the whole teaching mission.

### 3.2 The first 10 minutes (beat by beat)

Minutes 0–5 defer entirely to `onboarding-first-run.md §6` (cold-open auto-run of the `primer`, coach-marks naming current/voltage on the live picture, guided primer build, the board comes alive, read `5 V across · 5 mA through`). The extension to minute 10:

- **Min 5 — light an actual LED** (`manual-switch-led`). Scaffolding drops a notch; a *clickable switch* makes the LED turn on *because the player did something*. "I made the light turn on" is the true emotional anchor.
- **Min 6 — the first Lab Notebook page fires.** "Current limiting — logged." One-time Lux drops, from *doing*, not a quiz. **This is the most important beat of minutes 5–10:** it establishes that *playing fills a collection*, the engine of the next hour. Notebook on screen *before* Credits, before any contract — because a novice causes phenomena constantly and accidentally, while shipping a spec is a later skill.
- **Min 7 — the divider contract, as an offer** (never a gate). The judgement part marks the graded net.
- **Min 8 — first Credits light the diode shelf.** The tech tree *is* the progress bar; the player watches a grey shelf turn live.
- **Min 9 — the first retroactive eureka.** "You already built a current limiter — the Diode license is discounted." Playing toward a concept cheapens its unlock.
- **Min 10 — the fork to self-direction.** Two threads now visibly exist (the contract/Credits thread, the notebook/Lux thread); the player picks a temperament. Onboarding is over — two circuits built, numbers read, one spec shipped, one page filled, the tree opened — and the player was *told* almost nothing.

Deliberately still hidden at minute 10: AC/Bode tools, IC maker, Factory lens, tiers beyond the one real resistor, reliability labs, board layers. They fade in just-in-time (§3.3).

### 3.3 The difficulty curve — three plateaus and one wall

Governed by one rule: *introduce a concept the first time the screen can demonstrate it true, in one clause, where the player is already looking, and never before.* This is already how the examples are written (`rc` step 5's "a charged cap is an open, not a short" fires *as the current fades to zero on screen*).

- **Plateau 1 (Eras 0–2): everything just works.** Ideal passives + diodes, no convergence failures. The beginner's first hour is a phenomenon-collecting spree.
- **Plateau 2 (Eras 3a/3b): things respond and things break.** The manual switch adds interaction; thermal/light add second domains and the first safe destruction. Difficulty rises via *consequence*, not complexity. Autopsy → Lux refund makes breaking things a reward.
- **THE WALL (Era 4): the active tier.** Biasing a BJT into the active region is the first genuinely hard engineering judgement, and the one place the competency exam belongs. The example ordering softens it (MOSFET-switch → MOSFET-amp → BJT-amp, gentler-converging first).
- **Plateau 3 (Era 5): abstraction pays off.** Build a NAND from four MOSFETs, *then* get the gate as one glyph. The relief of "I understand what's inside this black box because I built it" is the wall's emotional payoff. From here complexity rises but difficulty doesn't — black-boxing lets validated blocks collapse to pin-level behavior.

**Unlock schedule = hide-and-fade, never hard-lock.** Every surface is collapsed and fades in as it becomes relevant; a curious/expert player can always pop it open, and doing so is the implicit skip that mutes the coaching. The greyed tech-tree shelves are visible from minute zero (so the player sees the shape of the climb); the *tools* fade in just-in-time. One small new surface bridges structured campaign and open sandbox: **the "Suggested Next" rail** — 1–3 examples from the current era's categories, ranked by notebook pages they'd fill and eurekas they'd trip. It must be the single weakest pull in the UI: two ignores and it's gone for the session.

### 3.4 Where the IC maker enters, and the 10th hour

The IC maker is the **Era-7 capstone and the conduit by which understanding becomes shippable capital.** By hour 10 the player has cleared the transistor wall and lives in Eras 5→6→7. The headline of the 10th hour, and the literal closing of the whole project's ladder: using the IC maker, they drop a DIP-14 frame, build the 4-MOSFET CMOS NAND they learned in Era 5, name the pads (A, B, Y, VCC, GND), pass the containment DRC, and **Seal** it into a `CEC9001`. They zoom in under the reality lens and watch their own four transistors animate live; they place three sealed NANDs and wire a multi-IC board — *a sealed-IC board built from a chip they authored from transistors they understand.* Real mode is on and bites (tiers limit bandwidth, ratings FAIL-box, heat glows, the EMI lens shows district coupling); the contract carries a DRC layer and routes through the reliability labs on submission. The endgame is **capability sprawl, not stockpile sprawl** — "I can now build an ADC that works across temperature," not "I have 10k iron plates."

---

## 4. The reality ramp — the teaching engine

### 4.1 The reframe: replace the binary `real` flag with a monotonic `RealityLevel`

Today "Real" is a single binary toggle, but reality is a *stack* of a dozen independent non-idealities, each a distinct lesson. If we flip every non-ideality on at once, a circuit that worked in Ideal now fails for *five reasons simultaneously* and the player learns none of them. The fix is a **`RealityLevel` dial** — a monotonic rung ladder, 0 (pure Ideal) up through ~10 named rungs, each adding exactly one class of non-ideality. The existing `real: boolean` becomes `realityLevel >= rung_N` at each emission site in `buildNetlist` — a comparison, not a new system.

The dial is **per-board game-state**, orthogonal to the two existing per-part axes: `tier` (quality grade within an active non-ideality class) and `variant` (device identity). Beautifully, **the dial decides which datasheet columns matter, and tier/variant decide your score in those columns** — a budget electrolytic's bad ESR is invisible until the dial reaches the parasitics rung; then tier choice suddenly bites.

### 4.2 The ramp, rung by rung

Ordered by the engine's three golden-safe seams (value-path → AC-only → flag → hashed), which happen to sort by difficulty for free, and by teaching dependency (you can't teach derating before heat):

| Rung | Adds | Seam / golden cost | The "worked in Ideal, failed in Real" moment |
| --- | --- | --- | --- |
| **0 Ideal** | nothing — physics with the noise removed | byte-identical | (baseline; learn KCL, RC, gain cleanly) |
| **1 Tolerances** | resistor `jitter`, electrolytic `ecEsr` | value-path, byte-identical | "Your divider hit 3.300 V. Ship at 5%?" → Monte-Carlo: 12% fail ±2%. The datasheet number stops being the operating number. |
| **2 Ratings & FAIL** | `RATED_CURRENT_SLOT` over-current box | flag-only, golden-safe | The LED that glowed perfectly boxes red — sized for typical Vf, spiked at the rating edge. Autopsy pays Lux. |
| **3 Device limits** | source Z_out, MOSFET Kp, BJT β (`TRANSIENT_TIER_KINDS`) | value-path | The op-amp can't swing rail-to-rail; the "stiff" 5 V sags under load. |
| **4 Parasitics** | cap ESR/ESL, `R_ESL` lead inductance | AC-only, transient golden untouched | Your decoupling cap does *nothing* at 50 MHz — above self-resonance it's an inductor. "Why real boards parallel three cap values." |
| **5 Heat & derating** | accumulated `Tj`, glow→derate→vent, thermal lens | web value-path (Path 1) keeps it golden-safe in v1 | The linear regulator glows white-hot and vents; the switcher beside it stays cool. `(Vin−Vout)·I` had nowhere to go — zero special-casing. |
| **6 Invisible coupling** | EMI, crosstalk, ground bounce; `"emi"`/`"return"` lenses | AC-only + geometry, golden-safe | Passes every bench spec, then *fails the FCC chamber* — the clock trace ran parallel to the analog input for 40 cells. "Your schematic was right; your layout shipped a transmitter." |
| **7 RF / transmission lines** | `ELEM_TLINE`, Smith chart, TDR, `"rf"` lens | AC-only | A quiet trace "blooms into an antenna" as you drag the frequency picker up. A wire stops being a node. |
| **8 Noise floor** | seeded Johnson/shot/flicker | frequency-domain first (golden-safe), hashed time-domain deferred | You cannot resolve a signal below the grass. SNR is finite. |
| **9 Production-run reliability** | yield/RMA/recall/FCC/UL (Clock 3) | pure web economy, zero sim-core change | 10,000 units ship; 340 return — the electrolytic run at 95% rating and 70 °C had a 3-year life and year two arrived. *Derating was free on the bench and cost a fortune in the field.* |

**Reconciling the era spine vs. the ramp:** `game-progression.md` places thermal (Era 3b) *before* the active tier (Era 4), but the ramp places device-limits (Rung 3) before heat (Rung 5). These don't conflict — **the tech tree gates capability (when thermistors exist as parts); the dial gates non-ideality classes (when self-heating bites).** A player can own a thermistor and still have self-heating off. Two orthogonal axes, the invariant `game-progression.md §0` insists on.

### 4.3 Why the ramp *is* the teaching engine

The signature moment is the **split-screen "Ideal vs Real" A/B replay**: because Ideal is byte-identical to today's solve, run the *identical netlist* at two reality levels, overlay the two traces on one green-band scope, and caliper-annotate the single point of divergence ("the 5% resistor pushed Vout to 3.21 V" / "the rail sagged 0.4 V" / "the cap's ESR added 80 mV ripple"). It's the existing instant-replay juice run twice.

**The one-cause-at-a-time structure is what makes this diagnosable** — the strongest design claim of the ramp. The split-replay only teaches if the divergence has *one* cause; because each rung adds exactly one class, when a design that survived rung N fails at rung N+1, the cause is known *by construction.* This also yields a diagnostic superpower no real bench offers: a **per-rung toggle in the inspector** lets the player turn classes off until the failure disappears — the last one off is the culprit. A few booleans in `buildNetlist`'s gate conditions; pure teaching gold.

**Gating — two doors.** The player **opts in** (cranking the dial is voluntary and rewarded: higher realism multiplier at ship, a notebook page + Lux for tripping each rung's signature phenomenon). Contracts **demand** a minimum RealityLevel, ramping with prestige. The **eureka bridge** unites them: demonstrating a rung's phenomenon in free play discounts the contract/tier that needs it — so the optimal play is to crank the dial in the Test Bench, break things, and arrive at the contract pre-taught. Curiosity is the fastest path up the ramp.

**Scope discipline:** rungs 0–4 are entirely value-path / flag / AC-only — `cargo test -p sim-core` never moves. Ship those five first as a complete, deeply-teaching ramp with *zero* determinism risk, proving the dial before any golden regeneration. The only two golden-moving rungs (self-heating `Tj`, time-domain noise) are exactly the deliberate-regen items `reality-roadmap.md` already flags, and even they ship golden-safe first via the web-value-path / frequency-domain hosting.

---

## 5. Retention, UGC & social

### 5.1 The population is a supply chain, not five audiences

Five archetypes, each with a home loop and a retention cliff:

| Archetype | Home loop today | The cliff |
| --- | --- | --- |
| **Puzzle-solver** | the parametric contract grader | solving in a vacuum — no opponent, no "others did it differently" |
| **Realism tinkerer** | the lab notebook / phenomenon codex, Test Bench | personal-only; discoveries don't travel |
| **Optimizer** | par + golf + leaderboards | leaderboards listed but not designed; no seasons, no "coolest-running" board |
| **Builder/sharer** | the IC maker + seal (world-class authoring) | **no publish/discover surface at all** — the biggest single gap |
| **Educator/student** | worked examples, deterministic grading | no classroom container: no assignment, roster, or submit-a-replay |

The reorganizing insight: these are **five roles in one supply chain**, and the deterministic-artifact property lets them depend on each other. The tinkerer discovers a phenomenon → the educator assigns it → the puzzle-solver solves the contract → the optimizer golfs it to par → the builder seals the winner into a published chip → the next puzzle-solver *depends on that chip*. **The playerbase is the content treadmill** — and seal-as-same-netlist is what lets that treadmill run without a trust/moderation/anti-cheat tax, because every shared artifact is independently re-verified by the importer's own engine.

### 5.2 The Bench Exchange — the missing social layer

A verifiable registry over the artifacts the IC maker already produces (`UserIc`, `SavedCircuit`, and the replay stream — all serializable, all golden-safe). The core contract: **publishing attaches a manifest of measured facts the importer's sim re-derives, never trusts** (pinout, par BOM/cost/power, declared phenomena, certifications, and the stable design hash). A lying manifest is caught by the sim, not a moderator.

- **Publish** — any sealed IC or saved circuit, with the CEC9xxx house id and a **self-rendering datasheet**: the five-tier IC glyph spec means a published chip *already renders its own symbol→flow→valves→device→silicon refsheet*. A builder publishes a chip and gets a teaching datasheet for free. No other circuit game can do this; make the listing literally *be* the five-tier glyph card.
- **Discover** — browse by package + function (DIP-8 timers), by **phenomenon** (chips that demonstrate resonance — wired to the same codex taxonomy as the teaching notebook), and "**chips that solved contract X**" (exposing only the building-block chip, not the full solution).
- **Rate** — two channels, both dodging the popularity-contest trap: **objective sim-computed scores** (par cost/power/density/Tj-headroom — re-derived facts, the optimizer's currency) and the load-bearing social signal, **dependency count** ("how many designs use your chip inside them" — GitHub *dependents*, not stars: far harder to game, verifiable as an edge in the expansion graph).
- **Remix / fork — the on-brand killer feature.** Every sealed chip opens to its real netlist, so **"fork this chip" = open the box, edit the author's live sub-circuit, re-seal with lineage.** This is the entire open-source workflow rendered in silicon, and it *is* the skill the game teaches: read a stranger's circuit, understand it, improve it. A side-by-side die "diff" is buildable on the existing zoom-to-open renderer.

**The one determinism decision to flag:** ADR 0006's one-layer nesting rule bounds expand cost, but a dependency economy wants deep composition. Reconcile via **flatten-on-publish** — when you seal *using* a depended-upon chip, the dependency's internals inline into your seal (still one layer of *your* nesting; lineage is metadata). The social dependency graph grows arbitrarily deep while the *runtime* nesting stays shallow. It's the same seal-as-same-netlist expansion, but it must be folded into the determinism contract before shipping.

### 5.3 The dependency economy — what makes hour 50 fun

The single-player loop terminates (the same ten templates with different seeds go stale). **Other players are the inexhaustible content source.** Three mechanics:

1. **Standing on shoulders (the npm loop).** Late-game contracts get hard enough that building from primitives is tedious; stamp in *anyone's* published chip. The builder earns standing every time a *shipped, passing* solution depends on their chip. The community catalogue becomes the rest of the parts bin.
2. **Teardown / reverse-engineer mode — curiosity as competitive sport.** Take a *published* chip with internals **locked** (zoom-to-open disabled), probe it with the bench, submit a behavioral replica; the grader compares replicas at the pins (same sampler the contract grader uses). Leaderboards on *fewest probes* and *simplest correct replica*. On a correct teardown, **the box opens** — you reasoned your way to the behavior, then get to compare your model to the real silicon. Builders gain a "stump the world" prestige category ("this chip stumped 200 players"). Almost entirely assembly of shipped pieces (pin-grader + zoom-to-open + leaderboard); could carry the optimizer + tinkerer for hundreds of hours.
3. **Reputation as a third *standing*, not a third currency.** Earned when others' verified shipped solutions depend on your artifact; **not spendable** (respecting the corpus's firm "resist a third currency"). It unlocks harder contract pools, prestige cosmetics, and Exchange visibility. The firewall stays intact: **fame is for sharing, depth is for understanding, breadth is for shipping — three deliberately non-fungible axes.** This resolves `game-progression.md`'s open question #4: a pure builder/sharer earns Rep and Credits but *cannot* climb the Lux tree without doing their own predict/autopsy/eureka work.

### 5.4 Daily / weekly / seasonal & classroom

- **The three-board Daily Contract.** One seeded contract for the whole world, three competitions: **Cheapest** (BOM golf), **Coolest-running** (min `Tj` — why we built the heat model), **Most robust** (widest Monte-Carlo margin — the CEC-Certified sweep). One contract, three winners, serving the optimizer's distinct goals and *justifying the heat + Monte-Carlo systems already designed*. **Ghost replays** of the board-holders let you watch a better engineer's hands — the leaderboard's teaching payload.
- **The Weekly Build** (the builder's spotlight) and **Seasons** (rotating classic-contract ladders that reset quarterly so boards never ossify). All glory-and-Rep, never Credit/Lux farms.
- **Classroom is nearly free.** An **assignment = a contract + a roster**; submission is an auto-graded, byte-exact replay on the student's own machine (a copied replay is *visibly* a copy). Teachers publish a private "course standard-cell library" (a curriculum as a dependency tree) and author guided examples with the existing `BuildStep`/`why` schema. **Co-op uses the seal boundary as the collaboration boundary** — each player builds and seals a chip, then composes them on a shared board (pair-engineering rendered as the engine's own districts seam; teaches interface design, sidesteps the global-instantaneous-solve sync problem).

**The honest infrastructure flag:** the Exchange, rosters, daily seeds, and global leaderboards need a *backend* the static-web/wasm app doesn't have. MVP everything **file-based / offline-first** (export a chip as a file, share a replay as a link — `pot-dimmer.ts` is already a file-based circuit); the hosted social layer is a separate, real scope decision.

---

## 6. Out-of-left-field appendix

*The thread: determinism is not just a fairness property, it's a genre engine. The wildcards that win consume determinism (teardown fingerprints, replay duels, rewind-to-the-glitch horror, seeded yields) rather than fight it — and almost all are recombinations of already-specced systems.*

| Idea | Novelty | Feasibility | Rides on |
| --- | :---: | :---: | --- |
| **1. The Dead Bench** (teardown detective roguelike) | High | High | IC maker run backwards; reverse-eng contract + die-editor TEST rig exist |
| **2. Ghost in the Rails** (diagnostic horror) | Very High | Med-High | heat + EMI + wear-out pointed at dread; HUD already looks haunted |
| **4. Silicon Factory** (production line as primary loop) | High | High | most-specced (`product-run-reliability` agreed); factory framing exists |
| **6. Design Duels** (async PvP judged by the sim) | Med | Very High | nearly free; replay-verified grading is doctrine |
| **12. Chip Archaeology** (waveform Wordle) | Med-High | Very High | all instruments exist; lightest viral on-ramp |
| **3. Circuit Tower Defense** (survive stress waves) | High | Med | survive-transient contract exists; needs wave scheduler |
| **7. The Water World** (analogy lens as the whole game) | Med-High | High | the pipe lens is already built; a positioning reframe for novices/kids |
| **5. The Board Roguelike** (keep one board alive) | High | Med | needs tick-driven degradation (heat/wear-out) landed first |
| **9. Coop Debug** (Keep Talking & Nobody Explodes) | High | Med | strong classroom fit; needs fault library + netcode |
| **8. God of the Grid** (DC microgrid) | High | Med-Low | honest only at DC-microgrid scale; AC grid needs new modeling |
| **10. Speedrun the Solve** (golf as the genre) | Low-Med | Very High | done in doctrine; a positioning bet |
| **11. The Substrate** (recursive IC maker → CPU) | Very High | Low (near-term) | blocked on relaxing the one-layer nesting limit + per-island ΔT |

**The three to prototype:**

1. **The Dead Bench (teardown/detective roguelike) — the standout.** Highest novelty-to-feasibility ratio: it's the IC maker *inverted* (disable zoom-to-open, hand over a black box, judge the replica's behavioral fingerprint), and every piece exists. It teaches *characterization* — the most transferable real bench skill — and the player's deck of cracked chips becomes a tangible codex. A seeded daily teardown is shareable and viral. **This is the wildcard to build first, and it is the same engine as §5.3's teardown mode** — the social and the single-player versions are one feature.
2. **Ghost in the Rails (diagnostic horror) — the boldest, more buildable than it sounds.** Nobody predicts "horror" from a circuit teacher, yet it's the heat, EMI, and wear-out systems pointed at *dread and pacing* over a HUD that already looks like a haunted instrument panel. Its teaching payload — *intermittent-fault diagnosis over time*, the hardest real skill — is exactly what the §2.2 debugging reframe wants, and rewind-to-the-glitch-tick is a horror mechanic and a determinism showcase at once. Ship it as a *mode/campaign*, not the whole game.
3. **Silicon Factory (production line as the primary loop) — the deepest long-game.** Elevates the owner-agreed `product-run-reliability` loop from a post-ship report into a Factorio-of-electronics whose assemblers are your own sealed chips and whose belts are power rails. It's the natural home for heat, density, and EMI to *all* cash out through one consequence surface (the fleet's fate), and it teaches the hobbyist→product-engineer gap almost no game touches. **This is Clock 3 from §2.3 grown into a genre** — they are the same system at two ambitions.

Honorable mentions **Design Duels (#6)** and **Chip Archaeology (#12)** are the two cheapest wins (pure assembly of the replay grader + existing instruments) and make excellent viral on-ramps funnelling toward the three picks. **The Substrate (#11)** is the long-horizon crown jewel — flag now, build once recursive nesting and per-island ΔT land.

---

## 7. Open questions & next steps

**Decisions to make (with the recommended call):**

1. **One difficulty wall or many exams?** *Call: gate only the Era-4 active tier behind the competency exam; every other era unlocks on Lux + eureka.* A per-tier mandatory exam re-introduces the level-gate feel the owner is avoiding. Concentrate friction where the difficulty genuinely spikes.
2. **Fidelity tax at PLACE or SHIP?** *Call: SHIP.* This is the change that makes the bench a true sandbox while keeping the tax a real economic force. (Dissent to note: `game-rewards.md §1` currently says per-placement; this is a deliberate refinement.)
3. **Reality: binary flag or `RealityLevel` dial?** *Call: the dial.* It's a small change (a comparison at each `buildNetlist` gate) that is the spine of the entire teaching ramp and makes the A/B replay diagnosable.
4. **Reputation — currency or standing?** *Call: non-spendable standing.* Preserves the Credits/Lux firewall; resolves open question #4 (sharing is a third axis, not a Lux shortcut). Owner to confirm "sharing earns standing, not depth" is intended.
5. **The backend question.** The Exchange/rosters/daily-seeds need server infrastructure the static app lacks. *Call: file-based/offline-first MVP; hosted social layer is a separate scope decision.* This is the single biggest infrastructure dependency in the plan.
6. **Nesting depth vs. dependency depth.** Flatten-on-publish (§5.2) reconciles them but needs a determinism review (does inlining a published dependency reproduce byte-identically? it should — same seal expansion).
7. **Content gap:** Era 3b (thermal/light) needs ~3 new examples authored in the existing `do`/`why`/`done` shape. Every other era band has shipped examples.

**Suggested first playable milestone — "the smallest spine that proves the bet," in build order:**

1. **The spec-sheet grader + ONE parametric, satisfiability-checked template** (Fixed-rail or RC-timing). The judge; nothing matters without it.
2. **The judgement part** — the diegetic acceptance fixture marking the graded nets.
3. **Credits + the SHIP IT moment** — BOM debited *at ship*, green-band cascade, free instant replay.
4. **The reality dial, rungs 0–2 only** (Ideal → Tolerances → Ratings/FAIL) — all golden-safe; proves the dial and the **A/B "Ideal vs Real" split-replay**, the signature teaching beat, with zero determinism risk.
5. **The first 10-minute onboarding** (primer → light an LED → first notebook page → first contract offer → first eureka) — the hook, already specced.
6. **Par + replay-verified leaderboard** + **predict-then-reveal → first Lux → unlock one era** — installs the optimization itch and the second currency/firewall.

**The first thing *after* this MVP — pulled forward deliberately — is the Product-Run Report Card (Clock 3, Phase 1):** pure web-side reading of the already-deterministic margins (zero sim-core change, golden untouched). It is the cheapest way to give the entire realism backlog a *point* and the loop its *stakes*, converting heat, EMI, density, tier/variant quality, and interface compliance from a dozen disconnected bench glitches into one consequence surface where "derate, protect, certify, fund quality" is the literal optimal strategy.

**The bet, in one line:** *Make contracts the transactional spine, but run the economy as three clocks — a free creative bench that pays in understanding (Lux), a ship gate that crystallizes a design into Credits, and a product run whose fleet survival (profit + reputation) is the real win/lose — climb it on a reality dial whose every rung is one diagnosable lesson, and let the players' own sealed, verifiable chips become the inexhaustible content that makes hour 50 fun. The fastest way to climb is the most fun way to play, and every realism system finally has one place to matter.*
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Contracts, economy & meta-progression

The progression design. `game-design.md` says *what the player does*;
`game-rewards.md` is the earlier reward brainstorm (Credits + Lux, contracts-as-
products, realism multiplier, Lux-gated tech tree). This doc owns the **economic
loop**: how an open, regenerating factory economy replaces a level campaign, what
a contract *is* when it is not a hand-authored puzzle, and the firewall that keeps
the sim — the only judge (`architecture.md`, `determinism.md`) — uncheatable.

This is the meta-layer. The moment-to-moment builder (place/wire/probe/scrub) is
owned elsewhere. Scope here: contracts, currency, unlocks, anti-grind, onboarding.

## 0. The thesis, and the dead genre we are avoiding

The owner's call is correct and load-bearing: **discrete hand-authored scenario
puzzles are a dead genre for this game.** A 30-level campaign is content you
author once, the player consumes once, and then the game is over. Worse, an
authored puzzle almost always has *one intended answer*, which fights our entire
brand — the sim grades *physics*, not *your matching of my solution*.

The replacement is a **regenerating factory economy** in the Shapez lineage: an
open sandbox where an endless, self-scaling stream of **contracts** (machine-
checkable spec sheets) creates demand, demand pays a currency, and the currency
buys *more reality and more capability*. The campaign is emergent — the difficulty
curve is a property of the **economy and the tech tree**, not of a level list.

One reframe makes this concrete: **a contract is not a puzzle, it is a purchase
order.** A customer states measurable requirements; you ship anything that meets
them; the sim is acceptance-testing, not answer-checking.

## 1. What a contract is (parametric, not authored)

A contract is **data**, generated from a *template* by sampling parameters from a
seeded RNG. The template defines the *shape* of a requirement; the seed fills in
the numbers and the difficulty. This is the difference between authoring 30
levels and authoring ~12 templates that yield thousands of contracts.

A contract instance is:

```
Contract {
  template_id, seed, difficulty,
  conditions:   { supply, load (R or I sweep), temp, stimulus, run_ticks },
  spec[]:       [ { measure, target, tolerance, window } ],   // hard, all AND-ed
  bonus[]:      [ { name, predicate } ],                       // optional, layered
  par:          { parts, bom_cost, power },                    // for the golf score
}
```

Crucially the spec is expressed in the **measurement verbs the sim already
exposes** — node voltage and branch current sampled off a deterministic replay
under stated conditions. This is a direct generalization of the planned
"V(cap) reaches 90 % within N ticks" grader into a list of `(measure, target ±
tol, window)` lines, AND-ed for pass/fail. Nothing new in the core; the grader is
a sampler over the existing snapshot stream.

**No "one true answer."** The grader checks *the spec at the pins*, never the
netlist topology. A 5 V rail can be hit with a divider, a Zener, a series pass
element, a buck — all pass if the pins behave. We reward the *output*, then layer
multipliers (§3) so that *how* you did it matters for the **bonus**, never for the
**pass**.

### Contract templates (concrete, gradable, ordered by solver tier)

Each maps onto element classes from `parts-roadmap.md`, so contract supply grows
exactly as the engine grows. `θ` = a seed-sampled parameter.

| Template | Parametric spec (seed fills `θ`) | Graded by | Tier |
| --- | --- | --- | --- |
| **Fixed rail** | `V(out) = θ_v ±θ_tol` under load `θ_load` (R or I sweep) | node V across a load sweep | I |
| **Reference / divider** | tap `= θ_frac·Vin ±θ_tol`, draw `≤ θ_i` | node V + branch I | I |
| **RC timing** | `V(node)` hits `θ_pct·Vcc` within `[θ_lo,θ_hi]` ticks | V vs tick window | I |
| **Current limit** | deliver `θ_i ±θ_tol` into a varying load | branch I across sweep | I |
| **Rectifier** | rectify `θ_f` Hz AC to ripple `≤ θ_ripple` at `θ_load` | V ripple (max−min) over a window | II |
| **Regulator under transient** | hold `θ_v ±θ_tol` through a load step `θ_step` | V envelope during/after step | II |
| **Filter response** | attenuation `≤θ_pass` in band, `≥θ_stop` out of band | V ratio at two stimulus freqs | II |
| **Oscillator** | sustained `θ_f Hz ±θ_tol`, amplitude `≥θ_a` | zero-cross period + amplitude | II/III |
| **Logic level / threshold** | drive a `1`/`0` read correctly at the receiver across `θ_drive` | pin logic state vs window | III |
| **Timing closure** | no glitch on `Q` over window `W`; meet setup/hold at `θ_clk` | digital event trace | III |

Difficulty is *continuous*, not bucketed into levels: tighten `θ_tol`, widen the
load sweep, raise `θ_f`, add a temperature corner, stack two specs in one
contract. A single template spans "trivial" to "CEC-Certified-hard" purely by
where the seed lands on its difficulty dial — that dial is the campaign.

**Reference solution requirement (the grader's honesty check):** a generated
contract is only *issued* if the generator can prove it is satisfiable — it ships
with at least one internal reference netlist the grader replays and confirms
passes. This guarantees no impossible contracts and gives us a built-in **par**
and the **ghost replay**. The player never sees it.

## 2. Standing production vs. batch deliverables (the Shapez angle)

Shapez's hook is **continuous output under ramping demand**: a factory that keeps
producing while demand climbs. The electronics analog is the design decision here.
Recommendation: **support both, default to standing, gate standing behind batch.**

- **Batch deliverable (the on-ramp).** Build → ship once → graded once → paid
  once. This is the natural unit for *learning a new concept* and for the
  instant-replay "Ship It" beat. Every new template debuts as a batch contract.

- **Standing production contract (the engine of the economy).** You commit a
  *circuit* to a customer; it pays **Credits per simulated interval** for as long
  as it **keeps meeting spec** under a *time-varying* condition profile (a load
  that walks, a temperature that drifts, a supply that sags). Demand **ramps**:
  the contract periodically escalates a parameter (load grows, ripple budget
  tightens), and your committed design either holds — and the payout rate rises —
  or falls out of spec and the contract lapses. This is Shapez's "demand climbs,
  your factory must scale" rendered in volts: *robustness over time becomes
  income.* It directly teaches why real boards carry margin and decoupling — a
  fragile pass dies on the first transient; an engineered design earns rent.

  Mechanically this is **cheap given the architecture**: the condition profile is
  just a seeded, deterministic function of the tick (exactly like the existing
  PWM switch and AC source — `architecture.md`), and "keeps meeting spec" is the
  §1 grader sampled on a rolling window. No new engine; a scheduler over the same
  replay. A handful of standing contracts gives the sandbox a *reason to keep
  running* and a passive Credit drip that funds experimentation — the open-ended,
  replayable loop the owner wants, without a single authored level.

Why both: batch is the *tutorial and the spike of juice*; standing is the *idle
factory economy and the long tail*. Batch teaches the concept; standing makes you
**engineer it to last.** A new player lives on batch; a deep player runs a
portfolio of standing contracts and optimizes throughput.

## 3. Currencies & unlocks (reconciling with `game-rewards.md`)

**Keep both currencies — the two-currency split is the best idea in the prior
doc and I would not touch its core.** Restating, with my refinements:

- **Credits (₵)** — soft, spendable, circulates. Earned from contract payouts
  (batch lump + standing drip) and bonus tiers. **Spent on:** real parts (per
  placement — the fidelity tax), board area / layers, instruments (each unlocks a
  *measurement verb*), bench services (Monte-Carlo, temp sweep), and — my
  addition — **blueprints/automation** (see below).
- **Lux (mastery)** — hard, scarce, **non-purchasable, never spent on
  consumables.** Earned only by *demonstrated understanding*: first-time concept
  unlocks, correct pre-sim predictions, par/sub-par solves, edge-case discoveries,
  autopsies. **Lux gates the tech tree** — tier licenses cost Lux. You cannot grind
  Credits into tier-ups. This is the anti-grind firewall and it is correct.

**The tech tree gates the part list — fidelity-as-progression, literally.** This
is the pillar from `game-design.md` made economic, and `parts-roadmap.md` already
orders it for us by *solver capability*:

1. **Tier I — ideal passives** (R, C, L, I, V, GND): they just work, free to
   place. The sandbox everyone starts in.
2. **Real variants of Tier I** (5 % → 1 % → over-temp tolerance, ESR, leakage,
   saturation): unlocked with Lux, **cost Credits per placement.** Same solver, a
   value perturbation it already handles — the cheapest possible "more reality."
3. **Tier II — nonlinear & active** (diode/LED, BJT, MOSFET, AC source, switch):
   unlocked with Lux + a practical exam contract. Each is a real engine capability
   (Newton loop, time-varying stamp) and opens whole template families (§1).
4. **Tier III — spatial vs. sequential** (FPGA fabric, MCU) and programmability
   tiers (parametric → visual → firmware/HDL).

So the player literally **buys reality**: start ideal, unlock tolerances, then
parasitics, then new devices, then programmable silicon. The tech tree *is* the
spine of the campaign — Lux is the XP, the tree is the level ladder, and it is
open because the contract supply at every tier is procedurally endless.

**On a third currency: agree with the prior doc — resist it.** Two currencies that
*prove different things* (shipping vs. understanding) is exactly enough.

### What Credits buy that the prior doc under-developed: blueprints & automation

The Shapez loop needs **reuse**. Once you've engineered a regulator that holds
across a sweep, you should be able to **save it as a blueprint** (a parameterized
sub-circuit) and **stamp it** into the next contract for a Credit cost — paying to
*not* rebuild from gates every time. This is the electronics analog of copy-pasting
a factory blueprint, and it is where late-game depth and a Credit sink live. It is
*not* a cheese vector (§4) because the spec still must pass at the pins and the
**par/elegance** score still judges the whole BOM.

## 4. The anti-grind / anti-cheese firewall

The sim is the only judge — so the whole defense is *make the judge value things
that grinding and copy-paste cannot fake.* Five rules:

1. **Tier-ups cost Lux, never Credits.** The central firewall. The grindable
   resource (Credits) buys *breadth and convenience*; the *understanding*
   resource (Lux) buys *progression*. Grinding the same contract floods you with
   Credits you have nothing important to spend on.
2. **Diminishing Credit returns on a re-solved contract seed.** First clear pays
   full; repeats of the *same seed* decay fast. Re-solving is driven by
   **leaderboard glory and Lux-bearing bonuses**, not Credit farming. Because
   contracts are procedurally seeded, "play more" naturally means "play *new*
   contracts," not "grind one."
3. **Lux is one-time and insight-shaped.** A concept's first-demonstration Lux,
   a correct prediction's Lux, an edge-case's Lux — each fires *once*. You cannot
   re-derive the same understanding for pay. The biggest payouts (CEC-Certified
   clears, par-beats, predict-then-reveal) require *insight*, which by construction
   does not repeat.
4. **Multipliers reward what degenerate solutions lack — margin, realism,
   elegance.** A trivial pass Bronzes and moves on. Silver/Gold/CEC-Certified
   require real parts, sub-par BOM, and *holding spec across a Monte-Carlo /
   worst-case sweep.* A degenerate or over-tuned-to-one-seed circuit **fails the
   sweep** — "works on my bench ≠ works across the spec" is enforced, not
   sloganed. Realism deliberately raises *both* the ceiling and the risk (real
   parts can vent / fail the corner), so it is a gamble, not a free win — this
   keeps players from always picking real, the trap the prior doc flagged.
5. **Anti-copy-paste via diversity, applied to bonuses not passes.** Spamming 50
   identical decoupling caps to brute-force a transient costs Credits (fidelity
   tax) and *tanks the elegance/par score*, so it can never reach Gold. We do
   **not** forbid topologies (that would resurrect "one true answer"); we let the
   **BOM-cost / part-count / power par** make degenerate spam economically
   self-defeating. Optionally, a *standing* contract's escalating demand outruns a
   brute-forced design before a clever one — time itself filters cheese.

**Why this beats scenario puzzles:** a puzzle is beaten *once* and its answer
leaks; a parametric-contract economy regenerates difficulty forever, can't be
walkthrough'd (the numbers differ per seed), and ties reward to *transferable
engineering judgment* (margin, cost, robustness) rather than to guessing the
author's intended layout. The firewall is *emergent from the economy*, not bolted
on as puzzle-gating.

## 5. Onboarding without a campaign

No level ladder — so three surfaces do the pulling, and they already exist or are
cheap:

1. **The worked examples are the tutorial.** `web/src/lib/examples.ts` is already
   a guided, ordered, *why-it-matters* build surface (primer → divider → RC → RL →
   diode clamp → buck → PWM), categorized Fundamentals → Power & Switching. This
   is the on-ramp: "Watch" then "Build" teaches the verbs with no campaign
   authored. Each completed example **issues the player their first contract of
   that family** — the example is the worked solution, the contract is "now do it
   to a spec I choose." Examples → contracts is the seam from learning to earning.
2. **The tech tree is the visible spine.** With no levels, the **bin / tech tree
   is the progress bar.** A new player sees locked tiers and knows the shape of
   the journey ("voltage → divider → RC → real parts → diode → buck → fabric").
   Lux unlocks pull you *up the tree*; the tree *is* the campaign map.
3. **A soft contract-difficulty curve, gated by what you own.** The contract
   generator only issues templates whose **required element classes you have
   unlocked**, and samples `θ_difficulty` from a band that tracks your demonstrated
   skill (par-beats and predictions nudge the band up). So difficulty rises
   *because your toolbox and skill rose*, not because a designer placed level 7
   after level 6. A player who only owns Tier I sees only Tier-I-satisfiable
   contracts, at a difficulty that creeps as they master them — an automatic,
   personal, endless curriculum.

The arc "what is voltage → real systems" is therefore: examples teach the verb →
the matching batch contract proves it (pays Credits + first-concept Lux) → Lux
unlocks the next tier in the tree → new templates appear → standing contracts turn
the new skill into income → repeat. No campaign; a *self-scaling apprenticeship*.

## 6. MVP — the smallest economy that is fun and shippable

Building on the prior doc's MVP, **re-prioritized around the regenerating-economy
thesis** (the prior MVP under-weighted *procedural supply* — without it we ship a
puzzle book by accident). Smallest fun cut, in order, almost all assembly:

1. **The spec-sheet grader.** Generalize the planned RC grader into a declarative
   `spec[]` list sampled off the existing replay (node V + branch I already
   exposed). Pass/fail per line, AND-ed. *This is the judge; nothing else matters
   without it.* Ship against 2 templates: **Fixed rail** and **RC timing** (both
   buildable from current Tier-I parts + the divider/RC examples).
2. **One contract template, *parameterized*, with a satisfiability check.** Not
   3–4 hand-built contracts — **one template that emits a fresh seeded instance**
   (different `θ_v`, `θ_tol`, `θ_load`) each time, each proven satisfiable by an
   internal reference netlist. *This is the line between a regenerating economy
   and a puzzle book*, and it is the one place I most diverge from the prior MVP.
3. **Credits + the "Ship It" moment.** On pass: SHIP IT stamp, measurement cascade
   (spec lines lighting green via the existing scrubber), payout count-up, and the
   free instant-replay from t=0. Mostly front-end over (1)–(2). Turns "passed"
   into "fun."
4. **Realism multiplier with ONE real part** (5 % resistor): costs Credits,
   carries tolerance (a value perturbation the solver already does), pays more when
   the contract still passes. The game's thesis, playable.
5. **Par + a replay-verified leaderboard**, keyed on the deterministic action+tick
   stream. Even local + shareable replay export starts the optimization itch and
   makes (2)'s endless seeds *worth re-rolling*.
6. **Predict-then-reveal → first Lux → unlock one tier.** Installs the second
   currency and the firewall (Lux gates the tree) before the economy grows.

**The one MVP non-negotiable the prior doc missed:** ship **a generator, not a
hand-list.** Even one parameterized, satisfiability-checked template proves the
*regenerating* loop — the thing that makes this not a scenario campaign. Everything
else (standing contracts, magic-smoke, Monte-Carlo CEC-Certified, blueprints,
community templates, the skill tree) is deferred and additive.

## 7. Where I disagree with `game-rewards.md`

- **It is a puzzle book in disguise at the MVP.** Its MVP step 1 says "ship 3–4
  starter contracts from the existing Examples." Four authored contracts *is* a
  (tiny) level list — the exact dead genre we're avoiding. **Fix:** the MVP must
  ship a *parameterized generator* (§6.2), even if only one template. Authored
  contracts are fine as *tutorial seeds*; they must not be the supply.
- **It under-specifies the regenerating supply.** "Contracts as products" is right
  but the doc never says *where the endless stream comes from.* I make
  **templates + seeds + a satisfiability check** the load-bearing mechanism, and
  add a **difficulty dial** so one template spans the whole curve (§1).
- **It treats contracts as batch-only.** The Shapez core — *continuous output
  under ramping demand* — is absent. I add **standing production contracts** (§2)
  as the actual factory-economy engine and the long-tail income, which the prior
  doc's batch-and-juice loop lacks.
- **Reuse / automation is missing.** A factory game needs blueprints. I add
  **saved parameterized sub-circuits as a Credit sink** (§3) for late-game depth.
- **Agreements (to be explicit):** keep two currencies and resist a third; Lux-
  gates-the-tree as the firewall; the sim as sole judge; realism must raise risk
  *and* ceiling so it isn't a free upgrade; failure-as-fun and predict-then-reveal
  as the best *understanding* rewards. These are excellent and I build on them.

## 8. Open questions

- **Standing-contract pacing** vs. the fixed tick grid: real-seconds-per-payout
  needs a rate that feels like idle income without trivializing it. Prototype.
- **Difficulty-band estimation:** how aggressively do par-beats/predictions raise
  a player's `θ_difficulty` band before it feels punishing? Needs telemetry.
- **Filter/oscillator grading** wants a frequency-domain verb (a stimulus sweep +
  amplitude ratio) the sim doesn't expose yet — a small new measurement verb,
  parked behind Tier II. Coordinate with `docs/ui/ac-curriculum.md`.
- **Blueprint determinism:** a saved sub-circuit must replay identically when
  stamped — fold it into the determinism contract before shipping automation.

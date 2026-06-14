# Reward & fun mechanics — brainstorm / backlog

A backlog-ready idea bank for the game layer. Every mechanic is anchored to the
pillars (**fidelity is the progression**, **one honest model**, deterministic
replay) and to what's already built (place/wire, ideal MNA solver, guided
Examples, DMM probe, tick scrubber). The MVP section at the end is what to act on
first. This is a brainstorm, not a spec — revise freely.

## 0. Design stance (the one rule that governs all of it)

**The simulator is the only judge. No separate "puzzle logic," ever.** A reward
is a number computed from measurements sampled off a deterministic replay under
stated conditions — auditable, replayable, impossible to fake. That single
constraint kills most Skinner-box temptations before they start.

Corollary: **never pay for actions, only for outcomes and understanding.**
"Placed 100 resistors" earns nothing. "Hit the spec" earns. "Explained *why* via
a prediction" earns more.

## 1. Economy & currency

Two currencies, deliberately different in *what they prove*:

- **Credits (₵)** — soft, spendable, flows freely. The "I shipped working things"
  currency. Earned from contracts + bonus tiers; spent on parts, board area,
  instruments, retries. Meant to circulate.
- **Lux (mastery)** — hard, scarce, **non-purchasable, never spent on
  consumables**. Earned only by demonstrating understanding (first-time concept
  unlocks, correct pre-sim predictions, par/sub-par solutions, edge-case finds).
  Lux gates the **tier licenses** and prestige. You cannot buy your way up the
  tech tree with grind-Credits — tiers cost Lux, and Lux only comes from
  understanding. **This is the anti-grind firewall.**

Resist a third currency.

### Reward scales on three multiplicative axes

1. **Realism multiplier (the core pillar).** Ideal parts pay base; each real part
   carries messy behavior (tolerance, ESR, V_f, saturation, leakage) *and* a
   multiplier (`×1.0 ideal → ×1.6 real-5% → ×2.2 real-1%-over-temp`).
2. **Elegance multiplier (golf).** Fewer parts, lower BOM cost, lower power —
   computed exactly from the netlist + sim. Each contract has a par.
3. **Margin multiplier.** Squeaking past the tolerance edge pays a *survival*
   bonus (fragile); comfortable headroom pays a *robustness* bonus. Both styles
   rewarded — passing and engineering margin are different goals.

The trap: don't let realism *strictly* dominate, or players always pick real.
Fix: real parts raise the ceiling *and* the risk — they can **fail** the spec
(or vent), so the high multiplier is a gamble, not a free upgrade.

### Sinks (keep the economy honest)

- **Real parts cost Credits per placement; ideal parts are free** — this *is* the
  fidelity tax, and it makes the economy be the pedagogy.
- Board area / layer unlocks.
- **Instruments** (real scope w/ limited bandwidth, current probe, curve tracer,
  logic analyzer) — each purchase unlocks new *measurement verbs*.
- **Bench services**: temperature sweep, Monte-Carlo batch tester (1000 tolerance
  draws), worst-case analyzer — power tools that are also teaching instruments.

## 2. XP / progression / mastery

Two distinct ladders:

- **Tech tree (capability)** = the parts ladder (ideal passives → active/digital
  → FPGA vs MCU). Unlock = the part exists in your bin. Gated by **Lux** + a
  proof of competency.
- **Skill tree (technique)** = orthogonal masteries (Power, Timing, Analog,
  Digital/State, Diagnostics). Perks grant **new instruments or new visible
  truths, never numeric boosts** (e.g. "Decoupling I" shows rail droop;
  "Timing I" annotates setup/hold at flip-flop pins). Every upgrade is *a new way
  to see what's real.*

**Licenses / certifications** gate part tiers via a short practical **exam
contract** (e.g. Active license: "bias this transistor into active region and
prove gain"). Pays Lux + a badge. Include **datasheet literacy** as a sub-skill —
pick the right part for a stated condition from its parametric table.

Keep XP lightweight and tied to breadth of mastery, not volume. Leveling unlocks
*slots* (skill points, board layers, concurrent contracts), not power.

## 3. Challenges as "products" (the spine)

Frame every graded challenge as **shipping a product to a customer spec**,
verified by the sim.

A **Contract** = a spec sheet + test conditions, both machine-checkable:
targets with tolerances (`V_out = 3.30 V ± 2%`, `t_rise < N ticks`, `ripple <
X mV`, `no glitch on Q over window W`), stated conditions (supply, load, temp,
stimulus). Pass/fail is binary on hard specs; **bonus tiers** layer on top. This
is a tiny generalization of the planned "V(cap) reaches 90% within N ticks"
grader into a spec list evaluated against sampled measurements.

**Bonus tiers:** Bronze (meets spec) · Silver (real parts or under margin) · Gold
(at/under par *and* real parts) · **CEC-Certified** (holds spec across a
Monte-Carlo / worst-case tolerance+temperature sweep — the real-engineering
capstone: *works on my bench ≠ works across the spec*).

**Contract variety:** build-to-spec · repair/debug (probe-driven) ·
reverse-engineer a black box · cost-down (golf) · survive (load transient — why
real boards are covered in caps).

## 4. Reward types & juice

Determinism is a *gift* for juice — replay the winning run frame-perfect, free.

- **Instant-replay "It Works!"** — on ship, auto-scrub the deterministic solution
  from t=0 cinematically (rail powers up, cap charges on its real RC curve,
  output settles into the green spec band, stamp drops). Highest-ROI juice; it's
  just a replay of the graded run.
- **The green band** — draw the spec as a shaded tolerance band on the scope; the
  trace sliding in and staying is the payoff.
- **Measurement cascade** — each spec line validates in sequence with a glow.
- **Net energize sweep** — light nets in IR-drop order using the power-bus visual
  language (`docs/ui/visual-language.md`).
- **Par score (golf)** — "−2 under par" scorecard, independent of progression.
- **Leaderboards on cost / power / part-count / margin** (never time-played),
  **replay-verified** via the deterministic action+tick stream — uncheatable.
- **Ghost replays** — watch the par-holder's solution build itself, racing-game
  style. Pure teaching gold.
- **Audio as instrumentation** — rail voltage → tone, current → hum, vent →
  crack. Honest juice that doubles as diagnostics.

## 5. Exploration & discovery rewards

- **The probe pays** — first measurement across each *kind* of thing (charged
  cap, reverse-biased diode, saturated transistor, floating node) → one-time Lux
  + a codex/datasheet unlock. Wire discovery events to the existing DMM probe.
- **Codex / datasheet collection** — every concept you *demonstrate* unlocks a
  real datasheet-style page; the "show don't tell" demos become collectible.
- **Predict-then-reveal bounties** — predict a value before running, sim reveals
  truth, close enough pays Lux. The single best *understanding* reward.
- **Edge-case / anomaly bounties** — cap holds voltage after disconnect; LC tank
  resonance; divider sags under load. "Huh, neat" + a lesson.
- Sandbox discoveries still unlock codex pages + Lux.

## 6. Risk/reward & failure as fun ("blow it up to learn it")

Make physical failure a first-class beat, not a punishment. Squarely on-pillar.

- **Magic smoke** — exceed a real part's rating and it **vents** (puff, *crack*,
  net dies); deterministic, so it's a lesson not a gotcha. Electrolytics vent on
  reverse voltage, resistors char on overpower, diodes/LEDs pop, transistors fail
  short.
- **Autopsy → refund** — a vented part can be analyzed for a partial **Lux**
  refund. *Learn from the smoke.* This is the keystone that makes failure fun
  instead of punishing — build it together with failure or not at all.
- **"The Test Bench"** — a consequence-free sandbox whose point is to destroy
  parts and see ratings in action. Achievements for each failure mode.
- **Risk-tier contracts** — run parts near limits for a higher multiplier;
  over-spec safely (low reward, robust) or run the edge (high reward, might vent).

## 7. Long-tail / replayability

The deterministic action+tick stream is a shareable, verifiable artifact.

- **Daily contract** — one seeded contract for everyone (determinism makes "same
  for everyone" literal); global cost/power leaderboard.
- **Design golf / optimization ladders** — re-solve classics with tighter designs
  as your skill grows.
- **Share a solution = share a replay** — export the action+tick stream + netlist;
  anyone imports, watches it build & run, forks it. The replay *is* the share.
- **Community puzzles** — players author contracts (spec + conditions + a
  reference solution the grader verifies). A user contract is just *data* the same
  engine runs — no scripting, no trust needed. The killer long-tail feature, and
  cheap given the architecture.

## 8. Anti-grind / fairness guardrails

- **Tech tree costs Lux (understanding), not Credits (grind).** The central
  firewall — if you take only one guardrail, take this one.
- Diminishing Credit returns on repeats (leaderboard glory, not Credits, drives
  re-solves).
- No energy/timers, no login drips, no pay-to-progress.
- Biggest payouts (Lux, par-beats, predictions, CEC-Certified clears) require
  insight, not repetition. The grindable path is deliberately the least rewarding.
- **Hints cost margin, not money** — escalating hints lower the *bonus* ceiling
  for that solve (you can still Bronze it), never paywall progress.
- The deepest hook is intrinsic: "I predicted it and physics agreed."

## 9. MVP — the smallest set that makes it feel like a game

Given what's already built, build these **five**, in order — almost entirely
assembly of existing pieces:

1. **Contract + spec-sheet grader.** Generalize the planned "V(cap) reaches 90%
   within N ticks" into a declarative spec list (`{conditions, [measurement,
   target ± tol, at tick]}`), run by stepping the existing sim and sampling node
   voltages / element currents (both already exposed). Pass/fail per line. This is
   the judge; nothing else matters without it. Ship 3–4 starter contracts from the
   existing Examples (divider-to-spec, RC rise-time, RL, a regulated rail).
2. **Credits + the "Ship It" moment.** On pass: a SHIP IT stamp, the measurement
   cascade (spec lines lighting green via the existing scrubber/replay), a payout
   count-up, and an instant-replay from t=0 (free — deterministic re-run). Mostly
   front-end over (1). Turns "passed" into "fun."
3. **Realism multiplier with ONE real part.** Add a **5%-tolerance real
   resistor** beside the ideal one: costs Credits, carries tolerance, pays a
   higher multiplier when the contract still passes. Tolerance is just a value
   perturbation the MNA solver already handles. This is the game's thesis in
   playable form.
4. **Par score + a verifiable leaderboard.** Each contract gets a par
   (part-count / BOM cost), scored exactly from the netlist; leaderboard keyed on
   the deterministic action+tick stream (replay-verified). Even local + a
   shareable replay export starts the optimization itch — turns 4 contracts into
   dozens of hours.
5. **Predict-then-reveal + first Lux.** Before a contract runs, predict one
   measurement; reveal truth on the green-band scope; pay Lux for a close guess.
   Spend Lux to unlock the first tier license. Installs the second currency and
   the anti-grind firewall (Lux gates the tree) before the economy grows.

**Defer past MVP:** magic-smoke/failure models, Monte-Carlo "CEC-Certified" tier,
community-authored contracts, the full skill tree, audio. All high-value; none
needed to prove the game is fun, and several need new core/sim work.

### The bet, in one line

Build the **contract-grader + Ship-It juice + one real resistor + par
leaderboards + predict-then-reveal** — a stack whose entire reward structure is
*"understand reality well enough to ship something that survives it,"* which is
exactly the brand and exactly the thing worth teaching.

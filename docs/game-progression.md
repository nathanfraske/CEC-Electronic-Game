# Player progression — tech tree, unlocks & the reward for tinkering

**One-line thesis:** *the campaign is a tech tree of **more reality**, climbed by a
sandbox player who is paid in **Credits for what they ship** and **Lux for what they
understand** — and the game's job is to make "understand" the more fun of the two.*

This is the **progression spine** that ties the existing notes together. It does
**not** re-derive them — read them first and treat this as the synthesis:

- `game-design.md` — pillars (fidelity is the progression; one honest model; time
  is a toy) and the parts ladder.
- `game-factory-loop.md` — the builder feel: bench-first, contracts as *pull*,
  black-boxing for scale, the first-five-minutes hook.
- `game-contracts-economy.md` — the parametric contract grader, two currencies,
  the anti-grind firewall, standing vs batch.
- `game-rewards.md` — the reward/juice brainstorm (Credits + Lux, multipliers,
  failure-as-fun, the codex seeds).
- `parts-roadmap.md` + `parts-catalog-ideation.md` — the **eight sim primitives**
  (P1–P8) and which parts each unlocks; the cheap-first build order.
- `ic-buildings-ideation.md` — the IC fidelity tiers and the **owner decision**:
  the standard IC library is a *fixed-function pool unlocked as libraries*;
  **"seal a circuit into a chip" is the FPGA**, a distinct late part.
- `architecture.md` — the three engines that meet at the pins; per-island ΔT;
  black-boxing as the scale lever.

Where I extend or push back on those docs I say so. I invent **no new physics, no
third currency, and nothing that contradicts the determinism contract or the
FPGA/IC decision.** Everything here is a progression *arrangement* of capabilities
those docs already specify.

---

## 0. The shape of the whole climb (so the rest has a frame)

Three things grow together, and they are *deliberately* different axes so that no
one of them can be ground:

| Axis | What grows | Currency / gate | Owned by |
| --- | --- | --- | --- |
| **Capability** (the tech tree) | the parts/buildings/mechanics in your bin | **Lux** (a tier license) + a **competency exam** | this doc |
| **Breadth & convenience** | board area, instruments, real-part stock, blueprints | **Credits** (spendable) | economy doc |
| **Understanding** (the codex) | demonstrated phenomena, predictions, autopsies | earns **Lux**; never spent | this doc, §5 |

The reframe that makes it cohere: **Credits buy you a bigger sandbox; Lux buys you
a deeper one.** You can grind Credits into more toys, area, and stock — but the
*gate to the next era of physics is Lux*, and Lux only comes from understanding.
That single split (already the firewall in `game-contracts-economy.md` §4 and
`game-rewards.md` §8) is the whole anti-grind story, and every mechanic below is
designed to keep it true.

---

## 1. The opening — what you start with, and how it teaches its own verbs

**The owner's vision is sandbox-primary, contracts as pull.** So the opening is not
a tutorial level; it is a **bench with three parts on it and a reason to touch
them.** The game teaches its verbs by making the bench *respond*, in the order
`game-factory-loop.md` §5 already lays out — I commit it here as the literal
starting inventory and the first competency.

### 1.1 The t=0 inventory (Era 0 — "First Light")

At first launch the bin holds **exactly the Tier-I ideal elements the core already
solves**, because they "just work" and cost nothing (`game-design.md` pillar 2;
`parts-roadmap.md` element table):

- **Sources:** ideal DC voltage `V`, ideal DC current `I`.
- **Passives:** resistor `R`, capacitor `C`, inductor `L`.
- **Reference:** ground `GND`.
- **Tools (the verbs):** **place**, **wire**, **probe (DMM)**, **the scope**, and
  **the transport** (run / pause / single-step / scrub — *time is a toy* from
  minute one).

Nothing else is in the bin. The locked shelves below it (the diode family, active
devices, ICs, the FPGA) are **visible and greyed** — the tech tree *is* the
progress bar (`game-contracts-economy.md` §5.2). A new player sees the shape of the
journey before they've earned a credit.

The board itself opens **pre-seeded with the `primer` example**: a source, a
ground, a glowing rail (`examples.ts`). The player has not built anything yet, but
**power is already moving** — the belts are load-bearing from the first frame
(`game-factory-loop.md` §0).

### 1.2 Teaching the verbs without a wall of text — "the bench dares you"

Each verb is taught by a **single diegetic dare** that the bench answers visibly.
No modal tutorial; the responsiveness *is* the lesson (this is the on-ramp from
`game-factory-loop.md` §5, made the opening competency):

1. **Place + wire (0:00–0:30).** A ghost-prompt: *"drop a resistor on the rail."*
   They do; press Run; **current flows, the belt lights, voltage drops across the
   resistor.** The whole genre in one gesture.
2. **Responsiveness (0:30–2:00).** *"add another resistor in parallel."* The bus
   *thickens toward the source* as currents add (KCL made visible, the `parallel`
   example). Lesson learned without a sentence: *what I build changes the flow,
   everywhere, live.*
3. **The probe + time (2:00–4:00).** *"add a capacitor; single-step it."* It
   **charges on its RC curve** — the first *transient*, the first machine with
   behaviour. The probe and the scrubber are introduced as a **microscope you point
   at your own creation**, not as a contract requirement.
4. **The bus language (woven through).** The first time a rail sags past ~4% droop
   it reads `--warn` and a one-line caliper annotation explains *brown-out* — the
   "starved machine" of the factory metaphor (`game-factory-loop.md` §1). The
   visual language teaches itself by *happening*, exactly as `visual-language.md`
   intends.

### 1.3 The first goal — an *offer*, not a gate

At ~4:00 the first contract **appears as an offer in the margin**, and it is one
the player can already satisfy with the parts in hand:

> *"A customer needs **3.3 V** from this 5 V rail. You've got the parts."*

This is a **batch deliverable** (`game-contracts-economy.md` §2) and it hands the
player a **judgement** (size the divider) and a **judgement part** (§4.1) marking
the graded net. Ship it → the **SHIP IT** beat (stamp, measurement cascade, payout
count-up, free instant replay; `game-rewards.md` §4) → the first Credits visibly
unlock the next shelf of the bin, and the first **Lux** drops from a *predict-then-
reveal* on the output node (§3.3). Now the sandbox is bigger and the player is
holding the thread.

**The promise of the opening, in one line:** *you build, it comes alive, it
responds to you, and there is always a bigger machine* — and you were never made to
read a manual to get there.

---

## 2. The tech tree — a concrete unlock graph, grounded in the sim primitives

The tree's order is **not** arbitrary and **not** purely pedagogical — it is the
join of two real constraints already in the docs:

- **Teaching value** (`game-design.md`, `parts-catalog-ideation.md` §11): each tier
  should be the *next idea a learner is ready for*.
- **Sim cost** (`parts-catalog-ideation.md` §9–10, `architecture.md`): each tier
  should unlock as cheaply as the engine allows. The catalog's insight is that the
  whole menagerie is **eight primitives (P1–P8)**, and *building a primitive
  unlocks a whole cluster of parts at near-zero marginal cost.*

So **the tech tree is, literally, the primitive-unlock graph dressed as eras.**
Each era's headline is the primitive (or capability) it turns on; the parts are the
harvest. This is the single most important structural claim of this doc: *we do not
balance a hundred part-unlocks individually; we gate the ~eight capabilities, and
the parts ride along.*

### 2.1 The dependency graph (in prose)

```
ERA 0  First Light ─ ideal passives (R,C,L,I,V,GND)  [the starting bench]
   │        teaches: KCL, V=IR, RC/RL transients, the verbs
   ▼
ERA 1  Tolerances ─ "real variants of Tier I"  (P2: per-device params)
   │        unlocks: 1%/5% R, real C (ESR via EC), the *fidelity tax*
   │        teaches: the datasheet number ≠ the operating number
   ▼
ERA 2  The Diode Age ─ (P1 piecewise i(v) + P2)   [Newton loop already paid for]
   │        unlocks: signal diode → Schottky, LED, Zener, MOV   (a "library")
   │        teaches: one-way conduction, Vf judgement, clamping/regulation
   ▼   ┌───────────────────────────────────────────────────────────────┐
       │  PARALLEL, P3-INDEPENDENT BRANCHES (can open in any order):    │
       ▼                                                               ▼
ERA 3a  Hands On ─ (P6 latch/hysteresis)              ERA 3b  Second Domains ─ (P7/P8)
   │      unlocks: manual switch, push-button,           │   unlocks: thermistor (NTC/PTC),
   │      threshold fuse, relay armature                 │   LDR, I²t fuse, photodiode,
   │      teaches: human-in-loop, topology events,       │   LED brightness/7-seg, thermal
   │      latching, debounce                             │   derating, thermal runaway
   └──────────────────────────────┬────────────────────┘
                                  ▼
ERA 4  The Active Tier ─ (P3 multi-terminal)  ★ THE KEYSTONE LIFT ★
   │        unlocks: BJT → MOSFET → JFET → Darlington; (P4) op-amp;
   │        (P5, parallel linear track) the transformer; relay (4-term + P6)
   │        teaches: gain, the amplifier, voltage- vs current-control,
   │        feedback / virtual short, magnetic coupling + isolation
   ▼
ERA 5  Integration ─ the IC libraries  (Tier-A behavioral, then Tier-B macro)
   │        unlocks (as purchasable LIBRARIES, fixed-function):
   │          • Logic library: gates → FF/latch → counter/shift/decoder/mux
   │          • Timing library: 555, oscillators
   │          • Power library: 78xx regulator, buck/SMPS controller
   │          • Analog library: op-amp blocks, comparator, filters
   │          • Mixed-signal library: ADC, DAC; Memory; H-bridge
   │        teaches: the pin boundary, datapaths, mixed-signal, power integrity
   ▼
ERA 6  Design Rules ─ real ground returns + DRC mechanics  (the "ground-plane")
   │        unlocks: per-load ground return as a graded thing; EMI/grounding rules
   │        as *design-rule contracts*; the bench-services tier (Monte-Carlo,
   │        temp sweep, worst-case) as standing gates
   │        teaches: the difference between "works" and "works to spec, in a system"
   ▼
ERA 7  The FPGA ─ the reprogrammable capstone  ★ "seal a circuit into a chip" ★
            unlocks: the player's *own* validated sub-circuits become a chip;
            late, distinct, reprogrammable; the open-ended end of the catalogue
```

**Read the arrows as primitive dependencies, not story beats.** The catalog is
emphatic and I follow it: **P1, P5, P6, P7, P8 are all independent of the big P3
lift** and can open *around* it (`parts-catalog-ideation.md` §9). That is why Eras
3a/3b sit *before* Era 4 and can be entered in either order — they are cheap, they
open two whole new domains (control, thermal/light), and they let a player who
isn't ready for the transistor wall keep growing. P3 (Era 4) is the one heavy gate,
and it is the centerpiece of the tree on purpose.

### 2.2 What each era unlocks and *why that order*

| Era | Headline unlock (primitive) | Parts / buildings | Mechanics | Why here |
| --- | --- | --- | --- | --- |
| **0 First Light** | ideal passives (already in core) | R, C, L, I, V, GND | place/wire/probe/scope/time; the bus language | The cheapest possible "alive" bench; teaches KCL/RC before anything costs. |
| **1 Tolerances** | **P2** per-device params | 1%/5% R, ESR cap (EC) | the **fidelity tax** (real parts cost Credits, carry tolerance) | The smallest "more reality" step — a value perturbation the solver already does (`parts-roadmap.md`). Installs the economy's core trade *before* new devices. |
| **2 Diode Age** | **P1** piecewise `i(v)` | Schottky, LED, Zener, MOV | the first **library** unlock; clamping/regulation contracts | Highest teaching-per-engine-effort cluster — reuses the Newton loop already paid for (`parts-catalog-ideation.md` §10 Phase A). |
| **3a Hands On** | **P6** latch/hysteresis | manual/push switch, threshold fuse, relay coil | **topology events**, latching, the protect-this-load contract | Cheap, P3-independent; the manual switch is the simplest place to pioneer interaction + netlist-invalidation. |
| **3b Second Domains** | **P7/P8** thermal + light scalar | thermistor, LDR, I²t fuse, photodiode, 7-seg brightness | **thermal runaway** as a phenomenon; opto-links; thermal derating | Opens two physical domains for almost nothing; the home of "let the smoke out" learning (§5.5). P3-independent. |
| **4 Active Tier** | **P3** multi-terminal (+ P4, P5) | BJT, MOSFET, JFET, Darlington, op-amp, transformer, relay | the first **amplifier**; feedback; isolation | The keystone engine lift; everything "active" gates on it. Ordered BJT→MOSFET because MOSFET converges *gentler* and unlocks logic-from-discretes (`parts-catalog-ideation.md` §3). |
| **5 Integration** | IC libraries (Tier-A→B) | the curated fixed-function pool, by library | the **pin boundary**; black-boxing for *scale* (engine-side, automatic); standing-production economy | ICs are behavioral-at-the-pins, so a base of them survives the dense solver (`architecture.md`, `ic-buildings-ideation.md`). Libraries are the unlock unit, per owner decision. |
| **6 Design Rules** | ground returns + DRC | (no new parts) | EMI/grounding/decoupling as **graded rules**; bench-services as gates | The "system, not just circuit" era. The aggregate ground return (`visual-language.md`) becomes a *thing you can get wrong*; CEC-Certified maturity. |
| **7 The FPGA** | **the seal mechanic** | the FPGA; the player's sealed blueprints | "build → prove → seal → reprogram" | Late and distinct, per owner decision. The open-ended capstone: the player authors the rest of the catalogue. |

**On the IC tiers inside Era 5.** `ic-buildings-ideation.md` orders the libraries by
fidelity cost, and I keep that: the **Logic library is first** (pure-digital Tier-A,
integer-exact, *zero golden churn*), then the analog-touching libraries (regulator,
op-amp) which need controlled sources and *do* move `node_v` (golden regen, per
golden rule 1). So Era 5 has an internal grain — digital before analog — that
matches the engine's risk profile, not a flat "all chips at once."

**On the "ground-plane" unlock (Era 6).** The brief asks for this from the
ground-returns work. There is no `docs/game-ground-returns.md` yet, so I do **not**
cite one; I ground the era in what *does* exist — the **aggregate ground return** of
`visual-language.md` (drawn once today, real per-load) and the **island** model of
`architecture.md`. The progression claim is narrow and safe: *grounding/EMI/return-
path quality starts as an invisible given and becomes, in Era 6, a **graded
design-rule** the contract system can check* (e.g. "return-path IR within budget",
"no shared-impedance coupling above X"). The mechanic is a **design-rule contract**,
not a new physics primitive — see §4.4. **Open question for the owner:** does the
ground-return model warrant its own doc + a sim capability before Era 6 ships? (§7).

---

## 3. Unlock mechanics — Credits, competency gates, and discovery, combined

Three forces unlock a tree node, and the art is combining them so the result is *a
curriculum, not a grind.* They map cleanly onto the two currencies and the codex.

### 3.1 The three forces

1. **Credits (breadth).** Earned from contract payouts (batch lump + standing
   drip). **Spent on** real-part stock, board area/layers, instruments, bench
   services, and blueprints — *never on a tier license.* Credits make your sandbox
   **wider**: more to play with, more area to sprawl, more ways to measure.
2. **Competency gates (a graded proof).** A tree node opens only when you have
   **demonstrated** the prerequisite skill on the honest replay. This is the
   *practical-exam contract* from `game-rewards.md` §2: a short, graded build that
   proves you can do X before Y unlocks. Examples: *Active license* = "bias this
   BJT into active region and prove gain"; *Power license* = "hold 5 V ±2% to
   100 mA across a load sweep." The exam **is just a contract** — the sim is the
   only judge (no new mechanism).
3. **Lux (understanding).** The scarce resource that **buys the license itself**,
   once the competency gate is satisfied. Lux comes *only* from understanding —
   first-time concept demonstrations, correct predictions, par/sub-par solves,
   edge-case discoveries, autopsies (`game-rewards.md` §1; §5 below). Lux makes your
   sandbox **deeper**: the next era of physics.

### 3.2 How they combine (the unlock recipe)

A tier license unlocks when **all three** line up, and each force does a *different
job* so none can substitute for another:

```
   [ Credits to AFFORD the new toys ]            ← breadth (grindable, fine)
 + [ a Competency exam PASSED        ]           ← proof you can use it (graded)
 + [ Lux to BUY the license          ]           ← understanding (un-grindable)
 ──────────────────────────────────────
 = the next era opens
```

This is the firewall made into a gate: **you cannot Credit-grind past a tier**
(Lux), **you cannot Lux-buy a skill you can't perform** (the exam), and **you cannot
exam-cheese with a toy you haven't paid for** (Credits). The three are
*deliberately non-fungible*. Grinding the same contract floods you with Credits you
have nothing tier-important to spend on — the grindable path is the least rewarding,
by construction (`game-rewards.md` §8).

**Where I extend the docs:** the prior notes have Lux gate the tree and mention an
exam, but never *wire all three into one gate*. I do — and I make the exam a
**competency gate**, not a paywall: it costs *attempts and margin*, never extra
Credits or Lux. You can re-take it freely; failing just means you haven't shown the
skill yet. (Hints during an exam lower the *bonus ceiling*, never block progress —
`game-rewards.md` §8.)

### 3.3 Discovery feeds the gate (the anti-grind firewall, restated)

The third input — **discovery** — is what keeps the climb from being a Credit
treadmill, and it deserves its own section (§5) because the owner asked for it most.
The short version of how it *plugs into unlocks*:

- **First-demonstration Lux fires once per concept** (`game-contracts-economy.md`
  §4.3). You cannot re-derive the same understanding for pay.
- **Eureka boosts (§5.2) discount the *competency exam* or the *Lux price* of the
  related node** — discovering rectification on the bench makes the rectifier
  contract cheaper to unlock, à la Civ VI. *Playing toward a concept literally
  lowers its gate.*
- So the firewall is not "grind blocked" — it's "**the cheap path up the tree is
  curiosity, not repetition.**" A tinkerer who explores will out-progress a grinder
  who farms one seed, because the grinder hits a Lux wall the tinkerer walked
  through.

**The anti-grind firewall, in one line:** *Credits buy breadth and can be ground;
Lux buys depth and cannot; and the cheapest source of Lux is playing with things
you don't yet understand* — so the optimal strategy is the one we want to teach.

---

## 4. Finishing the contract loop — the full lifecycle

The contract economy is fully specified in `game-contracts-economy.md`; here I close
the **loop** end-to-end and commit the **judgement-part** mechanic the owner asked
for, then say what makes a contract *satisfying vs busywork.*

### 4.1 The lifecycle (one pass)

```
 1. OFFER     A template emits a seeded instance (θ filled): conditions + spec[].
              It ships with an internal reference netlist proving it's satisfiable
              (the player never sees it) → guarantees no impossible contracts + a par.
 2. ACCEPT    Taking it drops a JUDGEMENT PART onto the board — a special 1-/2-pin
              fixture that MARKS THE GRADED NET(S) and carries the spec. It IS the
              customer's probe point. You build around it.
 3. BUILD     You place/wire/judge (size this R, pick this Vz, choose this ratio).
              The sandbox is unchanged — same honest sim, same belts.
 4. GRADE     Press Ship. The deterministic replay runs the stated stimulus and
              SAMPLES AT THE JUDGEMENT PART'S PINS: node V + branch I over the
              window, AND-ed across spec[] lines (sweep / pin-sample / transient).
 5. PAY       On pass: SHIP IT stamp, measurement cascade (each spec line greens in
              sequence), payout count-up, free instant replay from t=0. Bonus tiers
              (Bronze→Silver→Gold→CEC-Certified) layer the multipliers.
 6. FEED      Credits + (first-time) Lux flow into the economy → fund stock/area,
              satisfy a Lux price, trip a eureka discount → the tree moves.
```

### 4.2 The judgement part — the owner's "marks the graded net" direction, committed

The prior docs grade "at the pins" but leave *which* pins implicit. I make it
**diegetic and concrete**: a contract hands you a **judgement part** — think of it
as the **customer's acceptance fixture** you must wire your design into.

- It is a **real placeable fixture** (its own glyph) with named pins
  (`LOAD`, `RAIL`, `SENSE`, `GND`…) that **defines the test harness**: it *is* the
  `θ_load` sweep resistor, the stimulus injector, the sense point. The spec is read
  **only at its pins** — so "the graded net" is never ambiguous and never a hidden
  topology rule. This is the cleanest possible way to honor "the sim grades
  physics, not your matching of my solution" (`game-contracts-economy.md` §0):
  *the customer tells you where they'll measure, and what they'll measure, and
  nothing else.*
- It doubles as the **standing-contract harness**: for a standing production
  contract the judgement part's stimulus is a *seeded function of the tick* (a
  walking load, a drifting temperature — `game-contracts-economy.md` §2), and "keeps
  meeting spec" is the grader sampled on a rolling window at the same pins.
- **Determinism note (so this doesn't bite the contract):** the judgement part is an
  ordinary fixture in the netlist — its stimulus is a tick-pure function (exactly
  like the PWM switch / AC source in `lib.rs`), so a recorded solve replays
  byte-identically. It hashes like any other element. *It is not special-case puzzle
  logic; it is a part with a known waveform and a marked net.* This keeps the "one
  honest model" pillar intact.

### 4.3 Contract generation, variety, standing vs production

All as `game-contracts-economy.md` §1–2 specifies — I add only the *progression*
view:

- **Variety scales with the tree.** The generator issues only templates whose
  **required element classes you've unlocked** (§5.3 of that doc), so the contract
  *menu grows as the tree grows* — the diode age brings rectifier/clamp contracts,
  Era 4 brings amplifier/regulator contracts, Era 5 brings logic/mixed-signal
  contracts. The curriculum is automatic and personal.
- **Batch debuts a concept; standing makes you engineer it to last.** Every new
  template arrives as a **batch** deliverable (the spike of juice, the lesson); the
  **standing** version (robustness over time = income) unlocks once you've cleared
  the batch — the Shapez "demand ramps, your design must hold" loop. Standing
  contracts are the **idle drip that funds free play** (§5's tinkerer economy).
- **The variety menu** (from `game-rewards.md` §3): build-to-spec, repair/debug
  (probe-driven), reverse-engineer a black box (§5.6), cost-down golf, survive a
  transient. Each is the *same grader* pointed at a different judgement-part harness.

### 4.4 Design-rule checks as contracts mature (the Era-6 tie-in)

As the player reaches Era 6, contracts grow a **design-rule layer** on top of the
spec — the "works to spec *in a system*" maturity:

- A **design-rule check (DRC)** is just **more spec lines**, graded the same way:
  return-path IR drop within budget, decoupling present within X of each IC, no
  rail droop past threshold under the worst-case sweep, current density under a
  trace limit. These are **measured on the replay**, never authored topology rules
  — consistent with the firewall (`game-contracts-economy.md` §4.5: we never forbid
  topologies; we let the *measured* outcome judge).
- This is where **grounding / EMI** become gradable (Era 6, §2.2): once the ground
  return is a modeled, measurable thing, "your return path is fine" becomes a spec
  line, and a sloppy ground *fails the DRC* the way a fragile rail fails the sweep.
  **It is additive** — early contracts ignore it; mature ones demand it. (Whether
  the ground model needs its own sim capability is the open question in §7.)
- **CEC-Certified** (the capstone tier, `game-rewards.md` §3) is exactly "passes the
  full DRC + Monte-Carlo/worst-case sweep" — the bench-services tier (temp sweep,
  1000-draw tolerance batch) bought with Credits is the instrument that *checks* it.

### 4.5 Satisfying vs busywork — the line

A contract is **satisfying** when it hands the player a **judgement** (a real
engineering choice with a right-ish answer they must reason to) and grades a
**measured outcome** they can *watch arrive* on the green band. It is **busywork**
when it asks for assembly with no judgement, or grades something the player can't
see. Concretely, every good contract:

- **Demands a judgement, not a recipe** — "size `Rs` to drive this LED at 20 mA"
  (judge `R = (Vsupply−Vf)/I`), not "place these five parts." (`parts-catalog-
  ideation.md` §11 is a ready bank of these.)
- **Pays off *visibly*** — the measurement cascade + green band + instant replay
  turn "passed" into a *show* (`game-rewards.md` §4). A contract whose pass isn't
  watchable is busywork even if the judgement was real.
- **Rewards margin and elegance separately from passing** — Bronze for a bare pass,
  the multipliers (realism × elegance × margin) for *engineering*. A degenerate
  brute-force (50 decoupling caps) passes Bronze and *can never reach Gold* because
  the BOM/par score tanks (`game-contracts-economy.md` §4.4–4.5). The contract is
  satisfying because *doing it well is a different, visible achievement than doing
  it at all.*

---

## 5. Rewarding exploration & tinkering — the heart of this doc

> The owner: *"the game should support exploration and tinkering, and reward the
> player for it."* This is where I spend the most ideas. The governing principle,
> from `game-rewards.md` §0, is the firewall's gift: **never pay for actions, only
> for outcomes and understanding.** Free play is rewarded not with Credits-for-
> clicks but with **understanding made tangible** — codex pages, Lux, eureka
> discounts, and the deep intrinsic hook of *"I predicted it and physics agreed."*

The mechanics below are ordered strongest-first. They share one engine property
that makes them cheap and honest: **the sim is the only judge, and every phenomenon
is a measurable signature on the deterministic replay** — so "you discovered
oscillation" is *detected*, not scripted.

### 5.1 The Lab Notebook — a discovery codex that fills when you *cause* a phenomenon

**The keystone exploration reward.** A persistent **lab notebook** (the codex from
`game-rewards.md` §5, made a first-class progression surface) with a page for every
**phenomenon** the engine can detect on a replay. A page **fills the first time you
*produce* the phenomenon** — anywhere, in any circuit, contract or sandbox — and
unlocks a real **datasheet-style write-up** + a **one-time Lux** bounty.

The phenomena are **measurable signatures**, detected by the same sampler the
grader uses (no new mechanism):

| Phenomenon | Detected signature (on the honest replay) | Teaches |
| --- | --- | --- |
| **Rectification** | a node that was bipolar upstream is now one-signed downstream | the diode's job |
| **Oscillation** | sustained zero-crossings at a stable period with no decay | feedback/timing |
| **Resonance** | an LC/RLC response peaking at a frequency; ring after a step | reactive energy exchange |
| **Latch / bistability** | a node holds a state after the stimulus is removed | memory |
| **Thermal runaway** | a P7 temperature scalar climbing without bound under self-heat | why bias stability matters |
| **Brown-out** | a load's rail sagging below its needed level under draw | power integrity |
| **Saturation** | a transistor's output stops responding to more input | device limits |
| **Virtual short** | an op-amp's `+`/`−` nodes converging under feedback | how feedback works |
| **Ripple & smoothing** | a cap cutting a node's max−min over a window | decoupling |
| **Inrush** | a turn-on current spike into a discharged cap | NTC limiting |

The notebook is **the exploration progress bar** — a player can chase a *full
codex* with zero contracts, and that pursuit is a complete game by itself. It also
**back-feeds the tree** (§5.2): a filled page is the discovery half of a eureka.

> *Extends* `game-rewards.md` §5 (which seeds the codex idea) by making it
> **phenomenon-keyed and self-detecting** rather than probe-keyed only, and by
> wiring it into eureka discounts (§5.2). It is the single biggest "tinkering is
> first-class" lever.

### 5.2 Eureka boosts — doing a thing discounts its tech (Civ VI, for circuits)

**The mechanic that makes tinkering *advance the tree*.** Each tree node carries an
optional **eureka condition**: *demonstrate the phenomenon and the node's unlock
gets cheaper* — a discount on its **competency exam** (it's pre-passed or
half-passed) or on its **Lux price**.

- Build a working rectifier in the sandbox → the **rectifier/diode-age** nodes get
  a eureka discount *before you ever take a rectifier contract.*
- Cause oscillation with an LC tank → the **oscillator / 555** node discounts.
- Watch an op-amp's inputs converge → the **op-amp** node discounts.
- Let a transistor go into thermal runaway and *survive the autopsy* → the
  **bias-stability** sub-skill discounts.

This is the **direct reward loop for curiosity**: *the cheapest way up the tree is
to play with the physics the next tier is about.* It turns "I wonder what happens
if…" into measurable progress, and it reconciles perfectly with the firewall —
eurekas discount *the un-grindable gate*, but only via a one-time demonstrated
phenomenon, so they can't be farmed.

> *New synthesis.* The docs have first-concept Lux; none of them has the **Civ-VI
> "doing X discounts the tech for X"** loop. It is the strongest possible bridge
> between free play and progression, and the owner explicitly asked for "eureka-
> style boosts." I make it the **second pillar** of the exploration system.

### 5.3 Achievements for *emergent, elegant, efficient* circuits

Badges (Lux-bearing, one-time) for circuits whose *quality* the sim can measure —
rewarding **understanding and craft**, not volume:

- **Minimalist** — meet a spec at or under the reference par BOM (golf, already in
  the economy as the elegance multiplier; surfaced here as a collectible).
- **Cool runner** — meet a power-sensitive spec under a tight power budget.
- **Rock steady** — hold spec across the full Monte-Carlo/worst-case sweep with
  comfortable margin (the robustness multiplier as a badge).
- **One-part wonder / clever-by-half** — solve a contract with a *qualitatively*
  simpler topology than the reference (detected by part-count + class, never by
  matching a layout).
- **It's alive** — first self-sustaining oscillator; **it remembers** — first
  latch; **it decides** — first comparator trip. (Phenomenon achievements that
  double as codex completions.)

These reward *elegant and efficient*, which the owner called out specifically, and
they ride entirely on numbers the grader already computes.

### 5.4 Sandbox "what-if" challenges & predict-then-reveal (the deepest hook)

- **Predict-then-reveal works *in the sandbox*, not just in contracts**
  (`game-rewards.md` §5, `game-factory-loop.md` §4.4): before you press Run on
  *anything*, guess a node voltage / a period / a current; the green-band scope
  reveals truth; a close guess pays **Lux**. *No contract needed.* This is the
  deepest intrinsic reward — "I predicted it and physics agreed" — and it makes the
  bench a self-directed gym.
- **"What-if" seeds** — the game can sprinkle optional, ungraded *curiosities* in
  the margin ("what happens if you reverse this electrolytic?", "what's the voltage
  at the tap if the load doubles?") that pay a codex page / small Lux when you *try
  it and observe*, not when you get an answer "right." They are **invitations to
  poke**, and they reward the poking.

### 5.5 Breaking things safely — "let the smoke out" as a *learning* reward

The owner asked for this explicitly, and `game-rewards.md` §6 + `parts-catalog-
ideation.md` (the fuse/MOV/thermistor/electrolytic vent models) already build the
parts for it. The **progression framing** that makes destruction a *reward, not a
fail*:

- **The Test Bench is a permanent free-play surface** — a consequence-free sandbox
  whose *point* is to destroy parts and watch ratings in action (over-volt a cap →
  it **vents** with a crack; reverse an electrolytic; cook a resistor; pop an LED).
  Determinism makes every blow-up a **repeatable lesson**, not a gotcha.
- **Autopsy → Lux refund is the keystone** (`game-rewards.md` §6): a vented part can
  be *analyzed* for a partial **Lux** refund and a **codex page** on its failure
  mode. *You are paid in understanding for breaking it.* Build the vent and the
  autopsy together or not at all — the autopsy is what flips destruction from
  punishment to reward.
- **Failure-mode codex pages** — each distinct way a part dies (over-voltage,
  reverse-polarity, over-current, over-temperature, I²t blow) is its own notebook
  page with a one-time Lux bounty. *Completionism rewards curiosity about limits.*
- **Risk-tier contracts** (`game-rewards.md` §6) let the player *choose* to run
  parts near their limits for a higher multiplier — over-spec safely (low reward,
  robust) or run the edge (high reward, might vent). Failure here costs a part and a
  retry, never progression.

> The thesis: **smoke is information.** The game's most memorable lessons are the
> ones where a thing *fails the way the datasheet warned* — and we pay Lux for
> learning it, so a player goes looking for the edge.

### 5.6 Reverse-engineering a black box — curiosity as a contract

A **reverse-engineer** contract (`game-rewards.md` §3) hands the player a *sealed,
unknown* block (an opaque chip with pins and a hidden behavior) and a bench, and
asks: *figure out what it does and replicate it / state its transfer.* Graded by
matching the measured behavior at the pins. This rewards the **diagnostic** skill
(probe-driven understanding) and is pure intrinsic fun — the "what *is* this thing?"
itch. It also seeds the **datasheet-literacy** sub-skill (`game-rewards.md` §2):
read the parametric behavior, pick the matching part.

### 5.7 The tinkerer economy — Lux for understanding, Credits for delivery

The two-currency split is *itself* the tinkering reward structure, and I make the
contrast explicit as a progression statement:

- **Credits are the *delivery* economy** — you earn them by shipping to a customer
  spec, and you spend them on *more sandbox* (parts, area, instruments). A pure
  contract-runner accumulates Credits and breadth.
- **Lux is the *understanding* economy** — you earn it by *getting it* (predictions,
  first-demonstrations, autopsies, eurekas, codex pages), and you spend it on
  *depth* (tier licenses). **A pure tinkerer who never ships a contract can still
  climb the tree**, because the codex + predict-then-reveal + autopsies are a
  complete Lux faucet (§5.1, §5.4, §5.5). That is the strongest possible statement
  that free play is first-class: *you can progress entirely by understanding,
  without ever delivering a product.* (Whether that is *intended* is an open
  question — §7.)
- The two **reinforce**: standing contracts drip Credits that fund the stock and
  area a tinkerer plays with; tinkering fills codex pages and trips eurekas that
  cheapen the licenses a shipper wants. Neither path is the "real" game — they are
  two doors into the same loop, exactly the open sandbox the owner wants.

> **The exploration reward, in one line:** *make understanding a tangible,
> collectible, tree-advancing resource — fill a notebook by causing phenomena, get
> the next tech discounted for playing toward it, and get paid in Lux for breaking
> things and figuring out why* — so curiosity is not a detour from progression, it
> **is** the fastest progression.

---

## 6. The recommended progression spine (the headline-per-era list)

The ordered eras, one headline unlock each — the spine to build the game around:

1. **Era 0 — First Light:** the ideal-passive bench (R, C, L, I, V, GND) — power
   flows on the first frame; the verbs teach themselves.
2. **Era 1 — Tolerances:** *real* variants of Tier I (P2) — the fidelity tax; the
   datasheet number stops being the operating number.
3. **Era 2 — The Diode Age:** the diode family library (P1) — Schottky, LED, Zener,
   MOV; one-way conduction, the `Vf` judgement, clamping.
4. **Era 3a — Hands On:** stateful switching (P6) — manual switches, relays,
   threshold fuses; topology events and latching. *(P3-independent; parallel.)*
5. **Era 3b — Second Domains:** thermal + light (P7/P8) — thermistors, LDRs,
   photodiodes, 7-seg; thermal runaway and opto-links. *(P3-independent; parallel.)*
6. **Era 4 — The Active Tier:** multi-terminal devices (P3 + P4/P5) — the
   transistor zoo, the op-amp, the transformer; **gain, feedback, isolation.** *(The
   keystone lift.)*
7. **Era 5 — Integration:** the IC libraries (Tier-A→B) — logic, timing, power,
   analog, mixed-signal as *fixed-function libraries*; the pin boundary and scale.
8. **Era 6 — Design Rules:** ground returns + DRC — grounding/EMI/decoupling become
   graded; "works to spec, in a system"; CEC-Certified maturity.
9. **Era 7 — The FPGA:** the reprogrammable capstone — **seal a proven circuit into
   a chip**; the player authors the rest of the catalogue.

---

## 7. The top open questions for the owner

Deliberately *not* answered here, because they trade off scope, content, or touch
the determinism / FPGA-IC contracts:

1. **The ground-return model & Era 6.** Does grounding/EMI warrant its own sim
   capability + a `docs/game-ground-returns.md` before Era 6's design-rule contracts
   can ship? Today only the *aggregate* return is modeled (`visual-language.md`);
   grading return-path quality may need a real per-load return + a new measurement
   verb. **Scope call.** *(I deliberately did not invent this doc or its physics.)*

2. **Competency-exam friction.** §3 wires Credits + a graded exam + Lux into every
   tier gate. Is a mandatory practical exam per tier the right amount of friction,
   or should some tiers unlock on **Lux + eureka alone** (no exam) to keep the
   sandbox-first feel? Needs playtest — the risk is the exam re-introducing a
   level-gate feel the owner is avoiding.

3. **Eureka discount sizing.** How big a discount should a eureka give — pre-pass
   the exam entirely, or just cheapen the Lux price? Too generous and tinkering
   trivializes the tree; too stingy and the loop doesn't pull. **Telemetry call**
   (pairs with the difficulty-band question in `game-contracts-economy.md` §8).

4. **Can a pure tinkerer fully climb the tree?** §5.7 claims free play alone is a
   complete Lux faucet. Is that *intended* — a player who never ships a contract
   reaching the FPGA — or should some late licenses require *delivered* standing
   contracts (Credits-gated capability), so the two economies must both be touched?
   This is a **design-intent** call about whether "shipping" is ever mandatory.

5. **Notebook scope at MVP.** The lab notebook (§5.1) is the strongest exploration
   lever but it implies a **phenomenon-detector** library (signatures on the
   replay). How many phenomena ship first, and does detection reuse the contract
   grader's sampler exactly (it should, for determinism)? **Scope + a determinism
   review** of any detector that reads `node_v`.

6. **FPGA timing vs the tree.** Era 7 places the seal/FPGA capstone *after* Era 6's
   design rules. Is that the right gate, or should the FPGA arrive earlier (right
   after Era 5's logic libraries) for players who want to build datapaths sooner?
   Touches the owner's FPGA/IC decision — **owner's call**, flagged not settled.

---

### The bet, in one line

**Make the tech tree a ladder of *more reality* gated by understanding, hand the
player a bench that's alive before they're told anything, close the contract loop
with a judgement part that marks exactly what the customer measures — and reward
curiosity so well (a notebook that fills when you cause a phenomenon, a tech tree
that gets cheaper the more you tinker toward it, Lux paid for breaking things and
figuring out why) that the fastest way up the tree is the most fun way to play.**

<!--
  SPDX-License-Identifier: Apache-2.0
-->

# The factory loop — playing electronics as a Factorio-like builder

This is the **builder-feel** counterpart to `game-design.md` (what teaches) and
`game-rewards.md` (the economy). Its lens is narrow and deliberate: *how does
this actually play, minute to minute, as a spatial factory builder?* — and how
do we map Factorio/Shapez pillars onto a **real deterministic analog sim**
without lying about the physics. The owner's framing: **"Factorio, but power is
the belt and components are assemblers,"** an **open sandbox** with **contract
deliverables (Shapez)** that pay **credits**. The genre we are explicitly *not*
building is the hand-authored scenario puzzler — discrete puzzles are dead;
this is a base you grow.

Status: design ideation. No code. Where I extend or push back on the existing
docs I say so.

---

## 0. The fantasy, in one line

**You are building a living electrical machine, and you can see the power move
through it.** Not "solve the puzzle on this card" — *grow a thing that runs.*
The animated power belts in `docs/ui/visual-language.md` are not decoration;
they are the whole reason the genre works. Factorio is satisfying before any
rocket because watching belts flow is satisfying. Our belts are already
physically true (current = flow + thickness, voltage = rail level), so the toy
is load-bearing from minute one.

## 1. What is "the belt," and what flows on it?

The honest answer first, because it sets up the central tension. **In Factorio a
belt buffers discrete items**: they pile up, a full belt back-pressures, a
starved machine idles. **In our analog core you cannot buffer current.** Charge
is conserved instantaneously (KCL holds every tick); current is not a stock that
sits on a wire waiting. If we pretend otherwise we betray the sim and the
teaching. So the mapping is *not* "current = items." The mapping is:

> **The belt is the conductor; the analog of throughput/backpressure/starvation
> is the rail's behaviour under load — which the real solver already produces.**

Concretely, here is the Factorio vocabulary translated to physics we actually
simulate (node voltages + branch currents, per `architecture.md`):

| Factorio feel | Electronics reality | Already in the sim? |
| --- | --- | --- |
| Item flow rate on a belt | **Current** (A) along a conductor | yes — branch currents |
| Belt thickness / how "full" | **Belt thickness + chevron density** (∝ I/Imax) | spec'd in visual-language.md |
| A machine *starved* of input | **A load that browns out** — its rail sags below the threshold it needs | yes — IR drop, MNA node V |
| A belt *backed up* / saturated | **A rail hitting a current limit** — source can't push more, voltage collapses | needs a current-limited source model |
| Throughput of a lane | **Power** P = V·I delivered down a rail | yes — derived |
| Splitter dividing a lane | **A tap / fan-out node** — current divides (KCL), belt thins each branch | yes — visual-language.md |
| Merging lanes | **A shared bus** several sources/loads sit on | yes |

The teaching win is that **the thing that makes a factory legible — "this lane
is saturated, that machine is starved" — is real engineering here.** A rail
browning out under too much load is exactly why real boards are covered in
decoupling caps, and it is *visible* as the belt height sagging (rose `--warn`
past ~4% droop). We don't fake backpressure; we surface the physics that
behaves *like* backpressure and let the player learn the difference.

**Make the invisible visible — the four "belt states" the player learns to
read at a glance:**

- **Flowing** — chevrons moving, belt at healthy thickness, rail at level. Good.
- **Browning out** — belt height sagging toward `--warn`; a downstream block's
  rail dropped under the level it needs to work. The electronics "starvation."
- **Saturating** — a conductor near `Imax`: belt maxed thickness, chevrons
  dense and fast. Push more and something vents (Tier-real parts; see §6).
- **Dead** — no chevrons. Open loop, blown part, or a net with no return path.
  (We already plan a `singular()` flag and an amber "no DC path" hint — see
  `docs/ui/incomplete-circuits.md`. That *is* the "your belt goes nowhere"
  feedback.)

**Where I extend visual-language.md:** that doc nails the DC steady-state
encoding. For factory *feel* we need the **transient** to be the show — the belt
should visibly *fill* when you energize a district (the "net energize sweep" in
`game-rewards.md` §4), and *sag in real time* as you bolt on another load. The
deterministic transient (a cap charging on its RC curve, a rail dipping when a
motor kicks in) is the animation budget Factorio spends on item sprites. We
already have it for free; we just have to let it play out on screen instead of
snapping to steady state.

**Tension to flag honestly.** Factorio's belts decouple production from
consumption *in time* — a buffer chest lets an under-producing mine still feed a
hungry assembler for a while. The pure-resistive parts of our world have **no
such buffer**: draw exceeds supply and the rail drops *now*, not later. The
component that genuinely *does* buffer is the **capacitor** (a charge reservoir)
and the **inductor** (a current reservoir). That is a gift, not a problem:

> **The capacitor is the buffer chest. The inductor is the flywheel.** Decoupling
> a district with a bulk cap so it rides out a load transient is *literally* the
> electronics version of dropping a buffer chest in front of a spiky consumer —
> and it is real, examinable engineering, not a metaphor we bolted on.

So the factory's "logistics buffering" gameplay isn't lost; it's relocated to
the exact parts that teach it. That is the whole thesis of this project working
*for* us.

## 2. What is "an assembler / building"? — tiers of machine

A building **transforms inputs → outputs**. In electronics the inputs/outputs of
a block are *signals on its pins* (voltage, current, a logic level, a clock, a
data byte). The pin boundary is already the most important teaching surface
(`game-design.md`), so it doubles perfectly as the assembler's **input/output
ports**. The tiers below escalate *richness of transformation*, and they map
onto the existing tech tree and `parts-roadmap.md` rather than inventing a new
ladder.

**Tier 0 — Wires, taps, buses (the belt network itself).** Not machines; the
logistics layer. A **bus** is a power belt that feeds a whole district (a `+5V`
rail running the length of your board). Learning to route, tap, and *size* a bus
is the early-game "lay down your main belt" beat.

**Tier 1 — Shapers (passives: R, C, L, D).** Trivial assemblers that *reshape*
what flows through. A resistor is a "lane limiter / divider" (sets current,
splits voltage). A capacitor is the **buffer chest** (smooths, decouples, blocks
DC). An inductor is the **flywheel** (resists change, stores in current). A diode
is a **one-way belt / check valve**. These exist today (`graph.ts`: V, AC, R, C,
L, I, D, SW, GND) and the worked examples in `examples.ts` already read like
"here's what this building does to the flow" (divider, RC, RL, diode clamp).

**Tier 2 — Active machines (transistor, regulator, oscillator, gate).** The
first *real* assemblers — they take a small input and produce a *qualitatively
different, more valuable* output:
- **Transistor** = the **amplifier / valve assembler** (a small base current
  controls a large collector current — gain is the first "1 in → many out").
- **Regulator** = the **rail refinery** (messy input rail → clean fixed-voltage
  output rail; the canonical "raw ore → ingot"). A buck (we already simulate
  one — see the `buck` example) is the player-built version of this building.
- **Oscillator** = the **clock generator** (DC in → a periodic signal out; the
  factory's "ticking" heartbeat, like a pumpjack's rhythm).
- **Logic gate** = the **sorter / combinator** (levels in → a decided level out,
  at a threshold — exactly where a weak edge becomes an unknown).

**Tier 3 — Sub-assemblies & black boxes (ADC, MCU, FPGA, your own blueprints).**
The richest machines *contain* a factory. An ADC turns an analog level into a
number (continuous belt → discrete items — the closest thing we have to "fluid
becomes counted items"). An MCU is a programmable assembler whose recipe is
*firmware* (`game-design.md`'s programmability tiers: parametric → visual logic →
real code). The FPGA is a *reconfigurable* district. Crucially, **the player's
own saved sub-circuits become Tier-3 buildings** (see §3, blueprints).

**Automate & scale, concretely:**
- **Stamp copies.** Place 8 identical LED-driver stages along a bus. Each is the
  same building; the *bus* is what makes them a system.
- **Blueprint sub-assemblies.** Select a working divider+regulator, save it as a
  named building with exposed pins ("3V3 Supply"), drop it as one unit forever
  after. This is Factorio's blueprint book *and* Shapez's "wire up a machine that
  makes the thing you keep needing."
- **Bus a district.** One regulator feeds a `+3.3V` bus that powers a whole
  region of logic. Now "scaling" means widening the bus (more current headroom)
  and decoupling each consumer — real power-integrity engineering, played.

## 3. Emergence & scale — "my base got huge"

The Factorio dopamine is *zoom out and see the sprawl you built from parts you
understand.* The electronics version is a clean, real ladder of abstraction:

> **breadboard → board → rack → system**, and in parallel
> **transistor → gate → adder → register → CPU.**

You build a bigger machine out of machines you already understand. That is the
literal history of computing and it is the perfect long-game curve. An hour-1
player wires a divider; an hour-50 player drops a "4-bit adder" blueprint they
built from gate blueprints they built from transistor stages — and watches a
carry *ripple* down the belt, stage by stage, using the **time-as-a-toy**
controls (`game-design.md` pillar 3) to single-step it.

**This is where the deterministic analog sim both enables and constrains us — be
honest about both:**

- **Enables:** determinism makes a saved sub-circuit a *trustworthy* reusable
  building. Its behaviour replays byte-identically (`docs/determinism.md`), so a
  "3V3 Supply" blueprint behaves the same everywhere — exactly the property a
  factory builder needs from its blueprints.
- **Constrains:** a full continuous-time MNA solve does **not** scale to a
  thousand transistors at interactive frame rates the way Factorio's belt sim
  scales to thousands of items. The dense per-tick solve (`architecture.md`) has
  real cost. So **scale must come through abstraction, not brute simulation.**

**The black-boxing rule that makes huge bases possible (proposed):**

> A sub-assembly the player has *validated* can collapse into a **behavioral
> block that runs only at its pins** — the same mechanism `architecture.md`
> already uses for MCUs and the programmability tiers. A verified adder stops
> being 30 analog nodes and becomes a digital truth-table evaluated on the tick
> grid. You pay full analog fidelity *only where you're currently looking or
> learning;* validated, trusted districts run as cheap pin-level models.

This is the single most important architectural lever for the factory fantasy,
and it's already latent in the engine (analog / digital / emulator domains that
"meet only at the pins"). The pedagogy stays honest: you earn the right to
black-box a block by *demonstrating it works* at the analog level first (tie this
to the Lux/"prove competency" gate in `game-rewards.md` §2). You can always
*open the box* and drop back to full analog to see why an edge is slow — the gap
between "what I intended" and "what the silicon did" is preserved, on demand.

**The scale fantasy, staged:** a single net glowing → a loop with flow → a
district on a bus → a board of districts → a rack the camera pulls back to
reveal. Each zoom level is a real artifact an engineer recognizes, and each was
built from the level below.

## 4. Sandbox-first — make free play the heart

The owner is emphatic, and right: **contracts must be a *pull*, not a *gate*.**
If the game only comes alive when a contract is loaded, we've rebuilt the dead
scenario puzzler with extra steps. The fix is to make the **bench itself** the
fun, so a player who never opens a contract still loses an hour.

**The toys (free-play feedback loops), in order of pull:**

1. **The belts.** Place a source, a resistor, a ground; press Run; watch power
   *flow*. This is the core toy and it already exists. Free play is: keep adding
   things and watch the flow redistribute. Every wire you drop changes the whole
   picture *live* (KCL is global). That instant, total responsiveness is the
   Factorio "I just want to optimize this one belt" hook.
2. **The scope & meters.** Probe anything, see the truth. The DMM probe and the
   scope already exist; in sandbox they're a microscope you point at your own
   creation for the "huh, neat" payoff (`game-rewards.md` §5: cap holds voltage
   after disconnect; LC tank rings).
3. **Blowing things up.** **The Test Bench** (`game-rewards.md` §6) is pure
   sandbox: over-volt a cap and watch it *vent* with a crack. Consequence-free
   destruction is a legitimate, beloved free-play loop (it's half of why
   Factorio has a sandbox). Determinism makes it a *lesson*, not a gotcha.
4. **Measuring & predicting.** Predict-then-reveal works in sandbox too — guess
   the node voltage, run, see if physics agrees. The deepest intrinsic hook
   ("I predicted it and physics agreed") needs no contract at all.
5. **Stamping & decorating a base.** Once blueprints exist, free play becomes
   *base-building*: lay a bus, line it with stages, watch the whole district
   light up in IR-drop order. Aesthetic, organizational satisfaction — the
   Shapez/Factorio "my factory is *mine* and it's beautiful" drive.

**Contracts as pull:** a contract should feel like *"oh, I could point my bench
at this"* — a customer wants a 3.3 V supply that survives a load step; you
happen to have been playing with regulators; you take it for the credits and the
green-band payoff (`game-rewards.md` §3–4). The sandbox is the gym; the contract
is the match you choose to play. Credits unlock more *toys* (parts, board area,
instruments — the `game-rewards.md` sinks), which makes free play richer, which
makes the next contract more inviting. **The loop's center of gravity is the
bench, and the economy orbits it** — not the reverse.

## 5. The hook in the first five minutes

A tight on-ramp that gets the player to *"I built a thing and power is moving
through it"* fast, then hands them the keys:

- **0:00–0:30 — One belt.** Pre-placed source + ground, a glowing rail. "Drag a
  resistor onto the belt." They do. Press Run. **Current flows; the belt lights
  and the voltage drops across the resistor.** That's the whole genre in one
  gesture — and it's the `primer` example we already ship.
- **0:30–2:00 — It responds to *you*.** "Add another resistor in parallel." The
  bus *thickens* toward the source as currents add (the `parallel` example —
  KCL made visible). The player learns: *what I build changes the flow,
  everywhere, live.* This is the responsiveness hook.
- **2:00–4:00 — A machine that does something.** "Add a capacitor." Watch it
  *charge on the curve* (time-as-a-toy: single-step it). Now there's a
  *transient* to watch, not just a steady state — the first "machine with
  behaviour." (`rc` example.)
- **4:00–5:00 — A reason to keep going.** First tiny contract appears as an
  *offer*, not a wall: "A customer needs 3.3 V from this 5 V rail — you've got
  the parts." Ship the divider, get the **SHIP IT** stamp + credit count-up +
  instant replay (`game-rewards.md` MVP §9). The credits visibly unlock the next
  shelf of the bin. *Now the sandbox is bigger and they're holding the thread.*

The promise made in those five minutes: **you build, it comes alive, it responds
to you, and there's always a bigger machine.** Sandbox first, contract as the
pull, fidelity as the long climb (`game-design.md` pillar 2).

## 6. Tensions with the real analog sim (the honest list)

Factory builders take liberties with physics; we've chosen not to. Where that
bites, and the stance:

- **You can't buffer current like items.** Resolved by relocating "buffering" to
  the **capacitor/inductor** (§1) — it becomes real engineering instead of a
  faked mechanic. *Honor the physics; the physics is the better game.*
- **Global, instantaneous coupling.** Unlike independent belt lanes, every net
  is solved together every tick — touch one wire and the whole board's solution
  moves. This is *more* alive than Factorio's local belts, but it means you can't
  reason about a district in isolation the way you can about a belt segment.
  Black-boxing validated sub-assemblies (§3) restores local reasoning.
- **Solve cost vs. base size.** The dense MNA solve won't carry a CPU's worth of
  analog transistors interactively. Black-boxing is the answer, and it's the
  pedagogically correct answer (you earn the abstraction by proving the block).
- **No "stockpile" win condition.** Factorio/Shapez often reward *accumulation*
  (items/minute). Electronics has no warehouse to fill. Our accumulation is
  **capability and fidelity** (`game-rewards.md`: credits, Lux, the tech tree) —
  "I can now build an ADC and it works across temperature," not "I have 10k iron
  plates." Lean into *capability sprawl*, not stockpile sprawl.
- **Topology changes mid-run.** Adding a building rebuilds the netlist (per the
  switch/relay note in `parts-roadmap.md`). Factorio lets you build live; we can
  too, but it's a re-solve, not a cheap insert. Fine at human speed; flag it for
  performance when bases get large.

## 7. Open questions for the economy & content owners (not mine to settle)

- How exactly blueprints price into the economy (does saving a sub-assembly cost
  Lux? does using one waive the part costs of its internals?). Hand-off to
  `game-rewards.md`.
- Whether districts/buses are *unlocked board area* (a credit sink) or free.
- The exact black-boxing earn condition (which Lux/competency gate flips a block
  from analog to pin-level). Architecture-adjacent; needs a determinism review.

---

### The bet, in one line

**Make the bench a sandbox where building a living, power-flowing machine is the
whole joy, relocate Factorio's "buffer/throughput/blueprint" feel onto the parts
that *actually* do it (caps, regs, black-boxed sub-assemblies), and let contracts
pull the player up a ladder of ever-bigger machines they understand** — a factory
builder where the factory is real electronics and the belts never lie.

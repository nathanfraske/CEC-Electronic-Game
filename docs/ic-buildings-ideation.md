# Integrated circuits as Factorio buildings — design ideation

This is the **multi-terminal-machine** counterpart to `game-factory-loop.md`
(which mapped the *discrete* parts — cap = buffer chest, source = generator,
R = throat, L = flywheel, diode = check-valve, switch = door, GND = drain — onto
the Factorio metaphor). Its lens is narrow: *how does an **integrated circuit**
become a legible Factorio building?* An IC is bigger than a two-terminal part —
it has named input and output ports, an internal recipe, often a mode, and an
inside that animates while it works. That is not a resistor; it is an
**assembler / chemical plant**. This doc designs that archetype, the fidelity
ladder that keeps it deterministic and honest, a per-IC catalogue, and the
black-box "seal a sub-circuit into a chip" mechanic that ties the whole game
together.

Status: **design ideation. No code.** Where I extend or push back on the existing
docs I say so. Everything here is implemented *later*; this is the spec to build
against.

> **Owner decision (2026-06-15).** The standard library of ICs is a **curated
> pool of fixed-function buildings** (Tier A black boxes), shipped as **unlockable
> libraries** as the player progresses — a 74xx logic chip does exactly what a
> 74xx logic chip does; you place it, you don't define it. The
> "**seal a sub-circuit into a chip**" mechanic (Tier C below) is **not** how the
> general IC works — it is specifically the **FPGA**: a distinct, advanced,
> *reprogrammable* building whose recipe is whatever circuit the player builds and
> seals into it. Read Tier C and §4.3 through that lens: they describe the FPGA,
> not the everyday chip. The everyday catalogue is Tier A + Tier B.

Grounding (read these first; this doc assumes them):

- `crates/sim-core/src/lib.rs` — the element model. Eight two-terminal element
  types today (V, R, C, L, I, diode, clocked switch, AC sine), a dense MNA solve
  with a bounded deterministic Newton outer loop, time-varying stamps (switch,
  AC) that are **pure functions of the tick**, and the FNV-1a snapshot hash.
- `web/src/lib/glyphs.ts` — `DRAWERS` (schematic) vs `FACTORY_DRAWERS` (the
  building lens), the shared `flow()` / charge-fill / field-halo helpers, and the
  rule that **pin geometry is shared across styles** (`docs/ui/teaching-tools.md`)
  so wiring is identical whichever skin is on.
- `docs/architecture.md` — the three engines (analog / digital / emulator) that
  **meet only at the pins**, the **black-boxing of validated sub-circuits**, and
  the **per-electrical-island adaptive-ΔT** sandbox model. ICs lean on all three.
- `docs/game-contracts-economy.md` — the parametric spec-sheet grader, the two
  currencies (Credits + Lux), and the "earn the abstraction by proving it" gate.
- `docs/ui/visual-language.md` — voltage = net level (height + rail color +
  number), current = flow + thickness + number, the carrier/energy two-layer
  belt. ICs must speak this at their ports.

---

## 0. The thesis, in one line

**An IC is an assembler: named input ports on one side, named output ports on the
other, a recipe in the middle, and — almost always — a behavioral black box at
the pins rather than a transistor netlist you re-solve every tick.** The discrete
parts taught you to read one belt; the IC is the first machine that *consumes
belts and produces new ones*, and it is where the factory finally looks like a
factory.

This rests on a property the engine already has and `architecture.md` already
commits to: **the domains meet only at the pins.** A logic gate, an MCU, an
op-amp behavioral model — none of them is solved as analog silicon; each is a
*behavior evaluated at its port boundary* on the tick grid, coupled to the analog
world through driver/receiver models. That is not a shortcut we are inventing for
ICs; it is the same mechanism the digital and emulator engines already use, and
it is what makes a thousand-gate base survive a dense MNA solver that cannot scale
to a thousand analog transistors (`game-factory-loop.md` §3).

---

## 1. The IC building archetype — an assembler with ports + a recipe

A two-terminal part draws its body *between* its two pins (`fLeads`/`fBox` in
`glyphs.ts`). An IC cannot: it has many pins and a side-ness to them (ins vs
outs, signal vs power). So the archetype is a **footprint, not a leaded body** —
a rectangular building that occupies a block of grid cells, with **ports on its
edges**. This is the DIP/box-with-pins schematic *and* the Factorio assembler,
and they are the same outline.

### 1.1 Port layout on the grid

- **The building is a rectangle of cells** (e.g. a 74xx gate is ~2×3; a 555 is
  ~3×4; an MCU is a large 6×6+ block). Ports are anchored to **named pin sites on
  the edges**, exactly as `PART_KINDS` anchors the two pins of a leaded part —
  generalized to N pins with a `side` and an index. Wiring connects to a named
  pin site, not to "pin 0 / pin 1."
- **Convention: inputs left, outputs right, power top, ground bottom** — the
  default factory reading order (belts flow left-to-right, power rains from
  above, the return drains down). This is a *layout default*, not a constraint;
  pins are named, so the renderer can place an op-amp's `+`/`−` on the left and
  `OUT` on the right regardless. The convention exists so a player reads flow
  direction at a glance, the way an assembler's input/output arrows do in
  Factorio.
- **Pins carry a role + a name**, surfaced on hover and in the inspector:
  `IN`, `OUT`, `CLK`, `D`, `Q`, `VCC`, `GND`, `EN`, `A0..A7`, … The role drives
  the port glyph (a clock port gets the chevron-edge motif; a power port gets the
  rail-color cap; a bus port draws as a fat multi-line belt — see §1.5).

### 1.2 How wiring connects to named pins

Nothing about the wire model changes. A wire still joins two pin sites and the
union-find still computes nets (`docs/architecture.md`, `incomplete-circuits.md`).
The only generalization is that an IC pin site is one of N on a footprint instead
of one of two on a leaded body. Crucially — and this mirrors the Schematic⇄Factory
property in `teaching-tools.md` — **pin geometry is identical across skins**, so a
board wired with the IC in schematic (DIP) form is byte-for-bit correctly wired
when flipped to the factory (assembler) skin. The recipe art changes; the ports
do not move.

A power pin is just a pin: wire `VCC` to your `+5V` bus and `GND` to the drain,
exactly as you bus any district. **The IC is a load on the rail like any other**
— it can brown out, it sags the bus, it draws its quiescent current — and that
is real and visible (§1.6). No special "power" plumbing; the same belts.

### 1.3 Showing the recipe — the factory skin

The factory body is a **machine that visibly performs its function**, reusing the
`game-factory-loop.md` assembler vocabulary and the existing animation helpers
(`flow`, charge-fill, field-halo, the bounded `phase` clock). The recipe is
legible from the body art and a small internal animation:

- **A logic gate** is a **sorter / decider**: input belts arrive, a threshold
  "gate" inside swings, one output belt leaves at the decided level. The body
  shows the boolean glyph (`&`, `≥1`, `=1`, a bubble for inversion).
- **A 555 / oscillator** is a **metronome / pump house**: an internal piston or
  pendulum beats at the output frequency; the output port emits a square-wave
  belt (chevrons pulsing in time, not streaming).
- **A regulator** is the **rail refinery** (`game-factory-loop.md` Tier-2): a
  messy input rail enters, a clean fixed-height output rail leaves; the internal
  animation is a "leveling" mechanism (a float valve, a governor) holding the
  output bar flat while the input bar wobbles.
- **A shift register / counter** is a **bucket line**: cells drawn as a row of
  bins; on each clock edge the contents *advance one bin* (shift) or a counter's
  bins tick up. You can watch the bit walk down the line.
- **An H-bridge / motor driver** is a **gearbox / turntable**: the four switches
  drawn as four doors; the direction input lights the diagonal pair; the output
  port drives a spinning load glyph whose direction flips with the input.
- **An ADC** is the **fluid-to-items counter** (`game-factory-loop.md` Tier-3,
  "the closest thing we have to fluid becomes counted items"): an analog belt
  pours into a measuring vat, and discrete numbered tokens drop out the digital
  side.
- **An MCU** is a **programmable assembler whose recipe is firmware**: the body
  shows a small "program" motif (a cartridge, a tape) and a heartbeat LED; its
  ports are configurable (GPIO that can be in or out, ADC pins, PWM pins).

Each factory drawer is the same shape as the existing ones in
`FACTORY_DRAWERS` — read the port `ElectricalState`s, draw a body, call `flow()`
on the port leads — just with N ports and a recipe animation in the middle. The
internal animation rides the **same bounded visual `phase` clock** so it never
encodes magnitude in speed (the anti-pattern called out in `visual-language.md`
and the `glyphs.ts` header); magnitude rides density/thickness/number at the
ports, and *state* (which bin is lit, which way the bridge points) rides the
discrete logic the block already computes.

### 1.4 Showing the recipe — the schematic skin

The same building draws as a **DIP / box-with-pins** (the IEC/ANSI part): a
rectangle with numbered pins and the standard inner glyph (the gate's boolean
symbol, the op-amp triangle with `+`/`−`/`OUT`, the regulator's `7805`-style
three-pin block, the counter's labeled box). This is the *transferable* form a
learner meets on a real datasheet, and per `teaching-tools.md` it is the
**default**; the factory skin is the opt-in game-feel lens, ideally unlocked once
you've used the part in a working circuit. Op-amps and comparators get the
triangle; gates get distinctive-shape (or rectangular IEC) symbols; sequential
parts get the labeled box with `CLK`/`D`/`Q`. The inner glyph *is* the recipe in
schematic language.

### 1.5 Ports for buses (multi-bit signals)

Counters, shift registers, ADC/DAC, memory, and the MCU have **multi-bit ports**
(`Q0..Q7`, an address bus, a data bus). Two honest renderings, pick per density:

- **Fan-out of single-bit ports** — N adjacent pin sites, each a normal belt.
  Honest and probe-able (you can scope one bit), best at small width.
- **A bus port** — one fat multi-line belt drawn with the bus motif from
  `visual-language.md` (thicker stroke, a small "/8" tap count), expanding to the
  individual lines only when zoomed or probed. Best for wide buses where eight
  parallel belts are noise.

Either way each line is still a net the analog/digital engine resolves at a pin,
so KCL/threshold behavior at the boundary is unchanged. The bus is presentation
grouping over real per-line nets, exactly as the aggregate ground return is drawn
once but is real per-load (`visual-language.md`).

### 1.6 Power, ground, and "the IC is a load"

An IC's `VCC`/`GND` are normal pins on normal nets, so **everything the bus
visual language already does applies**: the IC sits at the rail's level, draws
current (its quiescent draw plus its switching draw), sags the bus under IR drop,
and **browns out** if the rail droops below the level it needs — at which point
its behavioral model should *visibly misbehave* (a logic gate's output goes
invalid/`X`, an MCU resets), which is the real, examinable lesson about decoupling
and power integrity that `game-factory-loop.md` §1 makes central. This is the
single most important "honest" property of IC power: **a black-boxed chip is not
exempt from the physics at its supply pins.** The cheap behavioral model reads
its own `VCC−GND` each tick and gates its outputs on it. Decoupling each IC with
a local cap (the buffer chest) to ride out switching transients is then *literally*
the electronics version of a buffer chest in front of a spiky consumer.

### 1.7 The internal animation and the carrier/energy language

At the ports the IC speaks the full belt language (`visual-language.md`): voltage
as height + rail color + number, current as flow + thickness + number, the
carrier/energy two-layer slosh on AC-bearing pins. *Inside*, the recipe animation
is presentation-only (a phase accumulator, never fed back to the sim) and shows
**state and function**, not magnitude: the bit walking down the shift register,
the 555's piston, the bridge's lit diagonal, the regulator's held-flat output
bar. The split is the same one the discrete parts already honor — the belt
carries the numbers, the body art carries the *meaning*.

---

## 2. Fidelity tiers — the honesty ladder

ICs span an enormous range of internal complexity, and we have one sacred
constraint: **determinism** (FNV-1a hash + pinned golden, `docs/determinism.md`).
The way to honor both is a **fidelity ladder**, where each IC is placed on the
*lowest* tier that is *honest enough to teach what it's for*. This is the same
"fidelity is the progression" pillar (`game-design.md`) applied to whole chips,
and it maps directly onto the three engines in `architecture.md`.

> **Tier A — behavioral black box.** A defined I/O relation (truth table, transfer
> function, timing, state machine) evaluated **at the pins** on the tick grid.
> Cheap, exact, trivially deterministic. Most ICs live here.
>
> **Tier B — macro-model.** A handful of *ideal analog elements + controlled
> sources* stamped into the real MNA system, so the chip participates in the
> continuous-time solve (loading, saturation, real output impedance). More
> faithful, costs a Newton-ish solve, deterministic if the elements are.
>
> **Tier C — player-built-then-sealed.** The black-boxing path: a learner builds
> the function from discretes, **verifies** it against a spec, and it **collapses**
> into a reusable Tier-A building. The pedagogy and the scaling lever in one.

### 2.1 Tier A — behavioral black box (the default, and the workhorse)

**What it is.** The IC is a function `outputs = f(inputs, internal_state, tick)`
evaluated each tick at its pin boundary, coupled to the analog world by
driver/receiver models (an output pin drives a level through a finite output
resistance; an input pin reads its net voltage and thresholds it). This is
`architecture.md`'s digital engine and emulator, generalized: *any* IC whose job
is well captured by a truth table, a clocked state machine, a timing relation, or
firmware belongs here.

**Why it's the default.** It is **cheap** (no matrix growth for purely-digital
ICs; they're event-driven on the tick grid), it is **exactly deterministic** (a
table lookup and integer state updates are bit-identical everywhere — far safer
than float MNA, which is already pinned), and it is **honest for the lesson**: a
74xx AND gate's *teaching content* is "threshold in, boolean out, with a real
edge and a real drive strength," and that is precisely what a behavioral model
with driver/receiver pins delivers. We are not pretending to solve its
transistors because the transistors are not the lesson.

**Determinism implications.**

- **Pure-digital ICs (gates, FF, counters, registers, decoders, memory):**
  event-driven, integer/boolean state, tick-grid timing. Hash these into the
  snapshot as part of the digital domain's state. No float subtlety. The safest
  tier we have.
- **Analog-touching behavioral ICs (op-amp transfer, 555 thresholds, regulator
  output, DAC output, comparator):** they read analog node voltages and *drive*
  analog nodes, so their output is a stamp into the analog system (a driven
  voltage through an output resistance — a Thévenin source). That stamp is a
  pure function of the read voltages and the tick, so it stays deterministic,
  but it now touches `node_v` and therefore the **golden hash** — any new such
  model must regenerate the golden and justify it (`CLAUDE.md` golden rule 1).
- **Internal clocking** (the 555, oscillators, counters' divide chain) is a pure
  function of the tick, **exactly like the existing PWM switch and AC source**
  (`switch_conductance`/`ac_source_emf` in `lib.rs` — both `(tick) -> value`).
  This is the proven, determinism-safe pattern for "a chip that ticks": never an
  RNG, never wall-clock, always a closed-form function of `Sim::tick`.
- **Multi-rate** (`architecture.md`'s per-island adaptive ΔT): a black-boxed
  oscillator "becomes a 1 kHz clock source" and no longer forces fine ΔT inside
  itself — the chip's internal timescale is sealed away from the island's ΔT
  choice. This is the multi-rate payoff that makes mixed-timescale boards
  tractable.

### 2.2 Tier B — macro-model (a few ideal elements + controlled sources)

**What it is.** Instead of one behavioral stamp, the IC expands to a *small*
internal netlist of **ideal primitives plus controlled sources** that the real
MNA solver assembles: e.g. an op-amp as `(input takes no current) → a
voltage-controlled voltage source of gain A with an output resistance, clamped to
the rails`; a comparator as a high-gain VCVS into a saturating output; a linear
regulator as a controlled series pass element holding `Vout` against load.

**Why it exists.** It buys **continuous-time faithfulness** the black box can't:
real input loading, finite output impedance and the resulting droop, slew
limiting via an internal RC, soft saturation near the rails, the *interaction*
between the chip and reactive parts on its pins (a filter's actual phase, a
regulator's transient ring with its output cap). When the lesson *is* that
interaction (op-amp integrators/filters, regulator transient response — the
`game-contracts-economy.md` "Regulator under transient" and "Filter response"
templates), Tier B is the honest floor.

**The dependency it needs: controlled sources.** `parts-roadmap.md` already
identifies VCVS / VCCS / CCCS / CCVS as **linear and clean to stamp** — each is a
fixed coupling between a sensed pair and a driven pair — and flags the *only*
blocker as **two-port placement UX** (you must pick the sensing nodes and the
driven nodes), which the current two-terminal board can't express. **The IC
footprint solves exactly that UX problem**: an op-amp building *is* the two-port
placement — `+`/`−` are the named sense pins, `OUT`/`GND` the named drive pins,
no free-floating two-port gesture required. So Tier B becomes buildable the moment
controlled sources land in the core, and ICs are the natural first home for them.

**Determinism implications.** Controlled sources are linear stamps — deterministic
by the same argument as V/R/C/L/I. Saturation/clamping is a nonlinearity, so a
hard-clamped op-amp output engages the **Newton path** (like the diode), with the
same bounded-iteration + fixed-tie-break discipline already proven in `lib.rs`. A
soft (tanh-ish) saturation is a smooth nonlinear `i(v)`/`v(v)` — a clean Newton
companion. Either way: bounded, fixed-order, pure `f64`, golden-affecting (these
touch `node_v`), so each new macro-model regenerates and justifies the golden.

### 2.3 Tier C — player-built-then-sealed (the black-boxing path)

**What it is.** The learner builds the function out of discretes (or lower ICs)
they already understand, **demonstrates it meets a spec** at the pins, and the
verified sub-circuit **collapses into a single Tier-A building** with exposed
named ports — `architecture.md`'s "black-boxing validated sub-circuits," made a
game mechanic. A divider+pass-transistor becomes a "3V3 Supply" chip; four NAND
stages become a latch; the latch ×N becomes a register; the register becomes a
byte of memory.

**Why it's the keystone.** This is where the three pillars fuse: it is the
**pedagogy** ("you earn the abstraction by proving the analog truth first" —
`game-factory-loop.md` §3, `game-rewards.md` §2), the **scaling lever** (you pay
full analog fidelity only where you're looking; sealed districts run as cheap pin
models, the only way huge bases survive the dense solver), and the **factory
fantasy** ("zoom out and see the sprawl you built from parts you understand").
§4 develops it as the game's spine.

**Determinism implications.** A sealed chip must **replay byte-identically** when
stamped, or it cannot be a trustworthy blueprint (`game-contracts-economy.md` §8
parks exactly this: "fold blueprint determinism into the determinism contract").
Two honest ways to seal, with different guarantees:

- **Seal-as-recorded-behavior (digital/logic blocks):** capture the verified
  truth-table / state-machine and replay *that* as a Tier-A behavioral block.
  Exact, cheap, and the sealed block's hash is its table — trivially reproducible.
  Correct for anything whose behavior is discrete (logic, counters, registers).
- **Seal-as-macro-model (analog blocks):** fit the verified behavior to a Tier-B
  macro-model (gain, output impedance, limits) and run *that*. The seal is then a
  set of fitted parameters; reproducible because the fit is deterministic, but
  it is an *approximation of* the analog original — so opening the box (dropping
  back to the full discrete netlist) can legitimately differ in the third decimal.
  That gap is a feature, not a bug: it is the same "what I intended vs what the
  silicon did" gap the project prizes, and the player can always re-open to see it.

The earn-condition (which competency gate flips a block from analog to sealed) is
owned by the economy doc (`game-contracts-economy.md` §3, `game-rewards.md`); the
*mechanism* is the architecture's pin-level collapse, and the *determinism rule*
is: a sealed block's contribution to the snapshot hash must be a pure function of
its inputs, internal state, and the tick — never the discrete netlist it came
from (so re-opening is a separate, heavier sim the player chooses).

### 2.4 Which ICs live on which tier (summary)

| IC | Default tier | Why |
| --- | --- | --- |
| Logic gates (AND/OR/NOT/NAND/NOR/XOR) | **A** | truth table + edge + drive strength is the whole lesson |
| D / JK flip-flop, latch | **A** | one bit of clocked state; integer-exact |
| Shift register, counter, decoder/mux | **A** | clocked state machines; the bit walking is the lesson |
| Memory (register file / SRAM block) | **A** | addressed array of bits; pure digital |
| Microcontroller | **A** (emulator) | recipe = firmware; behavioral by definition |
| 555 timer | **A** (+ optional **B**) | thresholds + tick-driven output; B if you want the RC interaction explicit |
| Comparator | **A** (or **B**) | threshold → saturated output; B for input loading/hysteresis fidelity |
| Op-amp (gain, buffer, integrator, filter) | **B** | the *interaction* with feedback/reactive parts is the lesson |
| Linear regulator (78xx) | **B** (or sealed **C**) | output impedance + transient ride is the lesson; or seal a built one |
| Switching reg / buck-boost controller | **C → A** | build the buck from discretes (we already simulate one), then seal it |
| DAC | **A** (drives analog) | code → output voltage; a driven Thévenin source |
| ADC | **A** (reads analog) | sample/quantize node voltage → digital word on the tick grid |
| H-bridge / motor driver | **A** (+ **B** load) | digital control of four switches; B-ish for the inductive load |
| Player blueprints (adder, supply, …) | **C** | the whole point of sealing |

---

## 3. Per-IC entries

Each entry: **what it teaches**, the **building metaphor + recipe**, the **port
set**, the **simplest honest deterministic model**, the **configurable
parameters**, and its **difficulty / sim dependency**. Models are written to the
existing core's grain — pin-boundary behavioral where possible, a controlled-
source macro-model where the interaction matters, and tick-pure for anything that
clocks.

### 3.1 Logic gates — 74xx AND / OR / NOT / NAND / NOR / XOR

- **Teaches.** Thresholds at the pin: where a weak edge or a sagging rail turns an
  intended `1` into an unknown (`game-design.md`'s pin boundary, the best lesson
  surface). Boolean composition: NAND/NOR are universal; XOR is the adder's seed.
- **Metaphor / recipe.** A **decider / sorter**: input belts in on the left, a
  threshold gate swings, one decided belt out on the right. Body shows the boolean
  glyph; a NAND/NOR draws the inversion bubble. The output belt's level snaps to
  the driven rail.
- **Ports.** `A`, `B` (in, left), `Y` (out, right), `VCC` (top), `GND` (bottom).
  NOT is single-input. Multi-input variants fan in more left ports.
- **Model (Tier A).** Read each input net's voltage, threshold it against
  `VIL`/`VIH` (with a defined invalid band → `X`), compute the boolean, drive `Y`
  through an output resistance toward the driven level. **Output is gated on
  `VCC−GND`** (§1.6): brown out the rail and `Y` goes invalid. Edge/propagation
  delay is a fixed tick count. All integer/boolean + a driver stamp.
- **Parameters.** Logic family thresholds (TTL vs CMOS `VIL/VIH`), propagation
  delay (ticks), output drive strength (output resistance), number of inputs.
- **Difficulty / deps.** **Lowest.** Needs the digital engine's driver/receiver
  pin models — the core "domains meet at the pins" capability. No matrix growth.
  This is the first IC to build and the one that unlocks the
  `game-contracts-economy.md` "Logic level / threshold" template.

### 3.2 D / JK flip-flop and latch

- **Teaches.** One bit of memory; the difference between level-sensitive (latch)
  and edge-triggered (FF); setup/hold as a *timing* concept you can violate.
- **Metaphor / recipe.** A **single-bin store with a clocked gate**: on the active
  clock edge the input bin's contents latch into the output bin and hold. The body
  shows a bistable (a two-state lever).
- **Ports.** `D` (in), `CLK` (in, clock-port glyph), `Q`, `Q̄` (out), optional
  `SET`/`RST` (in), `VCC`/`GND`.
- **Model (Tier A).** Edge-detect `CLK` on the tick grid; on the active edge
  sample `D`'s thresholded level into the stored bit; drive `Q`/`Q̄` from it.
  Integer state, tick-grid edges — bit-exact.
- **Parameters.** Edge polarity, setup/hold window (ticks, for the timing-closure
  lesson), async set/reset behavior, propagation delay.
- **Difficulty / deps.** **Low**, just above the gate (adds clock edge-detection +
  one state bit). Unlocks the "Timing closure" template (setup/hold, no-glitch).

### 3.3 Shift register / counter / decoder / multiplexer

- **Teaches.** Sequential logic and *buses*: a bit walking down a chain (shift),
  modular counting and frequency division (counter), one-hot decode and address
  selection (decoder/mux). The on-ramp to datapaths.
- **Metaphor / recipe.** A **bucket line**: a row of bins; each clock edge
  advances the contents one bin (shift) or increments the count (counter). A
  decoder is a **switchyard** lighting exactly one output line; a mux is a
  **turntable** selecting one input belt onto the output.
- **Ports.** Shift: `SER_IN`, `CLK`, `Q0..Qn` (bus port, §1.5), `VCC`/`GND`.
  Counter: `CLK`, `RST`, `EN`, `Q0..Qn`. Decoder: `A0..Ak` (bus in), `Y0..Y(2^k)`
  (bus out), `EN`. Mux: `D0..D(2^k)` (in), `S0..Sk` (select), `Y` (out).
- **Model (Tier A).** Clocked integer state array; on each edge, shift/increment/
  decode; drive the output bus lines from the integer state. The counter's divide
  chain is a pure function of the clock edges (a tick-derived counter), the same
  determinism-safe pattern as the PWM switch.
- **Parameters.** Width (bits), direction (counter up/down, shift L/R), modulus,
  synchronous vs ripple, decode polarity (active-high/low).
- **Difficulty / deps.** **Low–medium** (more state, bus ports). Needs the bus
  port renderer (§1.5). High teaching value per sim cost — strongly recommended
  early.

### 3.4 The 555 timer

- **Teaches.** Thresholds + RC timing producing a *frequency*: how `R` and `C` set
  astable frequency and duty, monostable pulse width. The first "make it blink"
  win and a great contract ("make this 555 blink at 1 Hz").
- **Metaphor / recipe.** A **metronome / pump house**: an internal piston beats at
  the output frequency; the `OUT` port emits a square-wave belt (chevrons pulsing
  in time). In astable mode you can watch the external timing cap charge/discharge
  between the two thresholds.
- **Ports.** `TRIG`, `THRESH`, `DISCH`, `CTRL` (in/analog), `RST` (in), `OUT`
  (out), `VCC`/`GND`. (The classic 8-pin DIP, named.)
- **Model.** **Tier A** for the win-fast version: an internal SR latch + two
  comparators evaluated at the pins, output square wave whose period is computed
  from the external `R`/`C` on the timing pins (read their net behavior), tick-pure
  edge generation. **Tier B optional** if you want the RC charge/discharge to be
  *real* MNA dynamics on the external cap (more honest, shows the exponential
  between thresholds) — then the comparators are macro-model thresholds on real
  node voltages.
- **Parameters.** Mode (astable / monostable), the external `R`/`C` (these are
  *placed parts* on the timing pins, not chip parameters — which is the lesson),
  `CTRL` voltage, reset.
- **Difficulty / deps.** **Medium.** Tier A needs internal comparators+latch
  behavior and tick-derived output. Tier B additionally needs the comparator
  macro-model reading real node voltages. Pairs with the "Oscillator" contract
  template (sustained frequency ± tolerance).

### 3.5 Op-amp ICs (and comparators)

- **Teaches.** Gain, feedback, virtual short, the building block of analog: a
  buffer (unity), an inverting/non-inverting amp (gain set by two resistors), and
  — with reactive feedback — integrators and active filters. The comparator
  teaches open-loop saturation and hysteresis.
- **Metaphor / recipe.** An **amplifier / valve assembler** (`game-factory-loop.md`
  Tier-2, "a small input controls a large output"): a small differential input
  belt drives a large output belt; the body shows the triangle (schematic) or a
  pressure-amplifier (factory). The feedback wire is drawn as a belt looping from
  `OUT` back to `−` — the player *sees* the loop that sets the gain.
- **Ports.** `+` (non-inverting in), `−` (inverting in), `OUT` (out), `V+`/`V−`
  (rails — single or dual supply), `GND`.
- **Model (Tier B is the honest floor).** Ideal op-amp macro-model: inputs draw
  ~no current (high input resistance), `OUT = clamp(A·(V+ − V−), rails)` through a
  finite output resistance, with an internal RC for slew/bandwidth. As a
  controlled source (**VCVS** with gain `A`, output `R`, rail clamp) this is
  exactly the two-port that `parts-roadmap.md` says is "clean in principle, blocked
  only on two-port UX" — and the IC footprint *is* that UX (§2.2). The rail clamp
  (and comparator saturation) is the nonlinearity → Newton path. **Comparator** =
  the same with very high `A`, no linear feedback expected, plus optional input
  hysteresis (a thresholded state bit, Tier-A-ish).
- **Parameters.** Open-loop gain `A`, input/output resistance, slew rate / GBW
  (the internal RC), supply rails, (comparator) hysteresis band, rail-to-rail vs
  not.
- **Difficulty / deps.** **Medium–high.** **Requires controlled sources** in the
  core (the main new linear capability `parts-roadmap.md` defers on UX) plus the
  rail-clamp nonlinearity on the proven Newton path. Golden-affecting. Unlocks the
  "Filter response" contract and op-amp-block contracts.

### 3.6 Op-amp-based blocks — integrator, differentiator, active filter

- **Teaches.** That *topology around the op-amp* makes the function: a cap in the
  feedback path integrates (`Vout = −1/RC ∫Vin`); swap R↔C to differentiate; an
  RC network sets an active filter's corner and `Q`. Connects the AC curriculum
  (`docs/ui/ac-curriculum.md`, the filter examples in `examples.ts`) to active
  parts.
- **Metaphor / recipe.** These are **not separate chips** — they are an op-amp
  building **with placed R/C parts** wired into its feedback, then optionally
  **sealed (Tier C)** into a named "Integrator" / "2nd-order LPF" block. This is
  the cleanest possible demonstration of the seal mechanic: the recipe is *visibly*
  the op-amp plus its feedback parts, until you collapse it.
- **Ports.** Same as the op-amp; after sealing, `IN`/`OUT`/rails with the feedback
  parts hidden inside.
- **Model.** Tier B op-amp (3.5) + real R/C in the MNA system → the dynamics are
  genuine continuous-time (the integrator's ramp, the filter's phase, are *solved*,
  not faked). Sealed: a Tier-B macro-model fit (or kept as the small internal
  netlist if cheap enough).
- **Parameters.** The feedback R/C values (placed parts), filter order/topology
  (Sallen-Key etc.) as a build choice.
- **Difficulty / deps.** **High** (op-amp macro-model + reactive feedback in the
  solve + the seal path). Highest fidelity payoff; depends on 3.5 and §4's seal.

### 3.7 Linear voltage regulator (78xx)

- **Teaches.** A clean fixed rail from a messy higher one; dropout, quiescent
  current, load and line regulation, and *transient ride* (why the output cap and
  decoupling matter). The canonical "raw ore → ingot" refinery.
- **Metaphor / recipe.** The **rail refinery** (`game-factory-loop.md` Tier-2): a
  wobbly input rail enters the top, a clean flat output rail leaves the right; the
  internal animation is a governor/float-valve holding the output bar level while
  the input bar bobs. Brown out the input below dropout and the output bar visibly
  follows the input down — the dropout lesson, seen.
- **Ports.** `IN` (in, left/top), `OUT` (out, right), `GND` (bottom, common).
- **Model.** **Tier B**: a controlled series pass element holding `Vout` against
  load — a regulated voltage source with an output impedance and a dropout clamp
  (`Vout = min(Vset, Vin − Vdropout)`), the clamp on the Newton path. Or **Tier C**:
  the player builds it (Zener + pass transistor, or a series pass + feedback) and
  seals it. Honest either way; the macro-model is the floor, the built-and-sealed
  is the deeper path.
- **Parameters.** `Vset` (5/3.3/12…), dropout voltage, max current / current
  limit, quiescent current, output impedance.
- **Difficulty / deps.** **Medium** (controlled source + a one-sided clamp). Maps
  straight onto the "Fixed rail" and "Regulator under transient" contract
  templates (`game-contracts-economy.md`). A top-tier early contract magnet.

### 3.8 Switching regulator / buck-boost controller

- **Teaches.** Efficient power conversion: PWM duty sets the output, the inductor
  buckets energy, the diode freewheels, the cap smooths, feedback closes the loop.
  This is the **payoff of the discrete `buck` example** (`examples.ts`) promoted to
  a building.
- **Metaphor / recipe.** A **substation**: a controller building that drives a
  switch node; the L/D/C are placed power parts around it (or sealed in). The
  internal animation shows the duty-cycle pulse and the feedback comparator nudging
  it to hold the output.
- **Ports.** `VIN`, `SW` (the switch node, out to the L), `FB` (feedback in,
  reads the output), `EN`, `GND`; plus the external `L`, `D`/synchronous switch,
  `Cout` as placed parts.
- **Model.** **Tier C → A is the intended arc.** The player first builds the open-
  loop buck from discretes — *which the core already simulates* (the clocked
  switch + inductor + freewheel diode + cap, on the Newton path, is the `buck`
  example). Then a **controller** building closes the feedback loop (adjusts duty
  from `FB` to hold `Vout`) — that controller is a Tier-A behavioral block reading
  `FB` and emitting the switch drive, the switch state a tick-pure function exactly
  like `switch_conductance`. Seal the whole thing into a "5V Buck" chip (Tier A
  with a macro-model output) for scaling.
- **Parameters.** Target `Vout`, switching frequency, duty limits, the external
  L/C values, current limit, mode (buck / boost / buck-boost).
- **Difficulty / deps.** **High** (closed-loop control on top of the existing
  switching primitives; feedback that adjusts duty per tick). But the hard part —
  the switching netlist — *already exists*; this is mostly the controller behavior
  + the seal. A flagship "you built a real SMPS" moment.

### 3.9 ADC and DAC

- **Teaches.** The analog↔digital boundary made literal: sampling, quantization,
  resolution (bits), reference voltage, and the reverse (a code becoming a
  voltage). `game-factory-loop.md` calls the ADC "the closest thing we have to
  fluid becomes counted items" — the single best Tier-3 metaphor.
- **Metaphor / recipe.** **ADC = a measuring vat + counter**: an analog belt pours
  in, a measured number of discrete numbered tokens drops out the digital bus.
  **DAC = a mixer**: a digital code-bus arrives, and a precisely-leveled analog
  belt leaves (a stepped staircase as the code changes).
- **Ports.** ADC: `AIN` (analog in), `VREF` (analog in), `CLK`/`START` (in),
  `D0..Dn` (digital bus out), `EOC` (out), `VCC`/`GND`. DAC: `D0..Dn` (bus in),
  `VREF` (in), `AOUT` (analog out), rails.
- **Model (Tier A, both).** ADC: on the convert trigger, read `AIN`'s node voltage,
  quantize against `VREF` to `n` bits (`code = round((AIN/VREF)·(2^n−1))`, clamped),
  present the code on the bus after a fixed conversion-tick latency. DAC: read the
  input code, drive `AOUT` to `(code/(2^n−1))·VREF` through an output resistance (a
  Thévenin source stamped into the analog system). Both are pure functions of the
  read voltage + code + tick → deterministic; the DAC (and the ADC's read) touch
  `node_v`, so golden-affecting.
- **Parameters.** Resolution (bits), `VREF`, conversion latency (ticks), sample
  rate, (ADC) input range, (DAC) output range and impedance.
- **Difficulty / deps.** **Medium.** Needs the digital-bus port (§1.5) and the
  analog read/drive at the pin boundary (the DAC reuses the same driven-Thévenin
  output the gate uses, just analog-valued). Quantization is integer-exact. A
  satisfying bridge contract: "digitize this sensor to ±1 LSB."

### 3.10 Memory (register file / small SRAM block)

- **Teaches.** Addressed storage: address in, data in/out, write-enable, the idea
  that memory is an array of the flip-flops you already built. Feeds the datapath/
  CPU long game (`game-factory-loop.md` §3's "transistor → gate → adder → register
  → CPU").
- **Metaphor / recipe.** A **warehouse with addressed shelves**: an address picks a
  shelf, read pulls its contents onto the data belt, write stores the data belt
  into the shelf. The body shows a grid of cells with the addressed row lit.
- **Ports.** `A0..Ak` (address bus in), `D0..Dn` (data bus, bidirectional or split
  in/out), `WE` (write enable), `OE` (output enable), `CLK`, `VCC`/`GND`.
- **Model (Tier A).** An integer array `mem[2^k]` of `n`-bit words; on a write-
  enabled clock edge store the data bus into `mem[addr]`; on read drive the data
  bus from `mem[addr]`. Pure integer state — bit-exact; hashes cleanly into the
  digital domain snapshot.
- **Parameters.** Depth (address bits), word width (data bits), sync vs async read,
  bidirectional vs separate data ports, initial contents.
- **Difficulty / deps.** **Low–medium** (an integer array + bus ports + tri-state
  data handling). Cheap and high-leverage for the datapath arc.

### 3.11 Microcontroller (programmable building)

- **Teaches.** The whole "spatial vs sequential" judgment (`game-design.md` Tier
  III): when to reach for a programmed sequential machine vs wired logic; and the
  programmability ladder (parametric → visual logic → real firmware/HDL), with the
  *gap between intent and silicon* as the lesson.
- **Metaphor / recipe.** The **programmable assembler whose recipe is firmware**:
  a large building with a "program" motif (cartridge/tape) and a heartbeat LED; its
  GPIO ports are **configurable** (each can be input, output, ADC, or PWM), so the
  same building takes a different shape of belts depending on its program.
- **Ports.** Configurable GPIO `P0..Pn` (each in/out/analog/PWM by firmware),
  `VCC`/`GND`, `RST`, `CLK` (or internal), debug. Pin *roles* are set by the
  program, surfaced on the building.
- **Model (Tier A, the emulator).** `architecture.md`'s behavioral emulator: runs
  firmware **temporally decoupled and resynchronized at pin interactions**. The
  MCU advances its own program, and only when it reads/writes a pin does it sync to
  the tick grid and the analog/digital world at that pin boundary. PWM output pins
  reuse the tick-pure switching pattern; ADC input pins reuse the §3.9 read.
- **Parameters.** Firmware (the three programmability tiers), clock speed, pin
  configuration, peripheral set (timers, ADC channels, PWM).
- **Difficulty / deps.** **Highest.** Needs the emulator domain and the
  temporal-decoupling/resync machinery. But it is *already in the architecture*,
  and behaviorally it is "a black box whose `f` is firmware" — the same Tier-A pin
  boundary, just with a richer authoring story. The capstone building.

### 3.12 H-bridge / motor driver

- **Teaches.** Driving an inductive load in both directions; the four-switch
  bridge, why you never close a leg's pair at once (shoot-through), PWM speed
  control, and flyback/freewheel diodes (the inductor's energy needs somewhere to
  go — the `buck`/`rl` lesson, applied).
- **Metaphor / recipe.** A **turntable / gearbox**: four doors (switches) drawn as
  the bridge; the direction input lights the active diagonal pair; the output drives
  a spinning load glyph whose direction flips with the input and whose speed tracks
  the PWM duty.
- **Ports.** `IN1`, `IN2` (direction/PWM in), `EN` (in), `OUT1`, `OUT2` (out, to
  the motor), `VMOTOR` (power), `GND`; the motor itself is an external R+L (+ back-
  EMF) load.
- **Model.** **Tier A** control + **Tier B-ish** load: the four switches are
  behavioral (driven from `IN1`/`IN2`/`EN`, with shoot-through forbidden), each a
  conductance stamp like the existing clocked switch; the motor is an external R+L
  (the inductor already in the core), optionally with a back-EMF controlled source
  (Tier B) for realism. PWM on the inputs reuses the tick-pure switch pattern.
- **Parameters.** PWM frequency/duty, current limit, dead-time (anti-shoot-through),
  the external motor R/L, decay mode (fast/slow).
- **Difficulty / deps.** **Medium–high.** The switch stamps and inductor already
  exist; the new pieces are the four-switch behavioral control and (for back-EMF) a
  controlled source. Visually one of the most satisfying buildings (a spinning,
  reversing load).

---

## 4. Synthesis — the progression and the seal mechanic

### 4.1 Recommended first ICs (highest teaching value ÷ lowest sim cost)

The order follows the engine's capability growth (the `parts-roadmap.md` /
`architecture.md` ladder) and front-loads the cheapest, most-foundational chips.
All of Wave 1 is **Tier A, pure-digital, integer-exact** — the safest possible
determinism story, no `node_v` impact, no golden churn — yet it unlocks the entire
digital contract family.

1. **Logic gates (NAND/NOR first — universal — then AND/OR/NOT/XOR).** The
   foundational IC and the cheapest. Needs only the digital engine's
   driver/receiver pin models (the core "meet at the pins" capability). Unlocks the
   "Logic level / threshold" contract and *every* gate-built blueprint downstream.
2. **D flip-flop / latch.** One clocked bit; adds edge-detection + one state bit.
   Unlocks "Timing closure" (setup/hold, no-glitch) and is the seed of all
   sequential parts.
3. **Counter / shift register / decoder / mux.** Sequential datapath primitives;
   adds the bus port (§1.5). Huge teaching value (the bit walking, frequency
   division, one-hot decode) for modest sim cost.
4. **555 timer (Tier A).** The first "make it blink" win and a beloved contract
   ("blink at 1 Hz"). Needs internal comparator+latch behavior and tick-pure
   output — the proven PWM-switch pattern.
5. **Linear regulator 78xx (Tier B) — once controlled sources land.** The "raw ore
   → ingot" refinery and a premier early contract magnet ("hold 5 V ±2% to
   100 mA"). The IC footprint is what makes controlled sources placeable (§2.2), so
   this is the natural first analog IC.
6. **Op-amp (Tier B).** Unlocks gain, buffers, integrators, and active filters
   (3.6), bridging the existing AC/filter curriculum to active parts. Builds
   directly on the regulator's controlled-source capability.

Then the richer tier as the engine and economy mature: **ADC/DAC** (the analog↔
digital bridge), **memory** (the datapath warehouse), **switching regulator**
(seal the built buck), **H-bridge/motor driver** (the spinning payoff), and the
**microcontroller** (the emulator capstone).

> **Rule of thumb for sequencing a new IC:** put it on the **lowest fidelity tier
> that still teaches its point**, prefer **pure-digital Tier A** (no golden
> impact) before any analog-touching model, and gate **Tier B** chips behind the
> arrival of **controlled sources** (the one genuinely new linear capability the
> core still needs, whose only blocker — two-port placement — the IC footprint
> dissolves).

### 4.2 How ICs unlock bigger contracts and the factory-scaling loop

ICs are rich contract targets because each maps onto a `game-contracts-economy.md`
template *and* raises the ceiling of what a single deliverable can demand:

- A gate/FF unlocks **logic-level** and **timing-closure** contracts (drive a `1`
  correctly across a load; meet setup/hold at a clock).
- The 555/oscillator unlocks **oscillator** contracts (sustained frequency ±
  tolerance — "make this 555 blink at 1 Hz").
- The regulator unlocks **fixed-rail** and **regulator-under-transient** contracts
  ("hold 5 V ±2% through a load step") — the standing-production economy's bread
  and butter, because *robustness over time becomes income* and an IC that holds
  spec under a walking load earns rent.
- The op-amp unlocks **filter-response** and amplifier contracts.
- ADC/DAC unlock **mixed-signal** contracts (digitize to ±1 LSB; reconstruct a
  staircase).

And each IC is itself a **factory-scaling unit**: stamp eight identical gate-driver
stages along a bus; blueprint a "3V3 Supply" and drop it as one building forever
after; bus a district of logic off one sealed regulator. The IC is the level of
abstraction at which "my base got huge" (`game-factory-loop.md` §3) becomes the
literal history of computing — transistor → gate → adder → register → CPU — built
from buildings you understand, with the carry visibly *rippling* down the belt
under the time-as-a-toy controls.

### 4.3 The seal mechanic — the keystone that ties the game together

This is the pillar. **"Build a sub-circuit, prove it, seal it into a chip"** is
simultaneously the project's pedagogy, its performance strategy, and its factory
fantasy — and ICs are where all three meet, because *an IC just is a sealed
sub-circuit*.

**The loop:**

1. **Build** the function from parts you already understand — discretes for your
   first regulator, gates for your first latch, latches for your first register,
   an op-amp + R/C for your first filter.
2. **Prove** it at the pins: run it under the contract's stated conditions and
   watch the spec lines go green (`game-contracts-economy.md`'s grader). You are
   demonstrating the *analog truth* before you're allowed to abstract it — the
   `game-rewards.md` / `game-factory-loop.md` §3 "earn the abstraction" gate.
3. **Seal** it: the verified sub-circuit **collapses to a Tier-A pin-level
   building** (`architecture.md`'s black-boxing) with named ports — a new chip in
   your bin, indistinguishable in use from a built-in IC.
4. **Scale** with it: the sealed chip runs as a cheap behavioral model (you pay
   full analog fidelity only where you're currently looking), so a district of
   sealed chips survives the dense MNA solver that could never carry their
   transistor-level equivalent. This is the *only* way the base gets big.
5. **Open** it on demand: drop any sealed chip back to its full discrete netlist to
   see *why* an edge is slow or a rail sags — the "what I intended vs what the
   silicon did" gap preserved, the determinism caveat from §2.3 made visible (the
   sealed macro-model and the re-opened analog can legitimately differ in the small
   digits, which is itself a lesson about modeling).

**Why this is the spine.** It makes the IC catalogue *open-ended*: the built-in
ICs (§3) are the seeds, and **the player's own sealed blueprints are the rest of
the catalogue** — an adder you built, a supply you tuned, a filter you proved.
It makes scaling **pedagogically honest** (you can't seal what you haven't proven)
and **architecturally necessary** (sealing is the scale + multi-rate lever in
`architecture.md`). And it makes the factory fantasy land: the dopamine of "zoom
out and see the sprawl you built from parts you understand" is, here, *literally
true* — every chip in the sprawl is either a primitive you learned or a sub-circuit
you sealed.

> **The bet, in one line:** make the IC a Factorio assembler — named ports, a
> visible recipe, a behavioral black box at the pins by default — and make
> **sealing a proven sub-circuit into a chip** the master mechanic, so the chip
> catalogue is *endless* (the player writes most of it), scaling is *honest* (earn
> the abstraction by proving the physics), and the dense analog solver only ever
> pays for the one district you're looking at.

### 4.4 Open questions for the architecture & economy owners (not mine to settle)

- **The seal's hash contract.** §2.3 proposes a sealed block contributes to the
  snapshot hash purely via its inputs/state/tick (never its origin netlist), so
  re-opening is a separate heavier sim. Needs a determinism review before any seal
  ships (`game-contracts-economy.md` §8 already parks this).
- **Tier-A vs Tier-B sealing for analog blocks.** Recorded-behavior is exact for
  digital; analog blocks need a fitted macro-model whose fit must be deterministic
  *and* documented as an approximation. Where's the line, and who owns the fit?
- **Controlled-source placement UX details.** The IC footprint solves the two-port
  problem for *named* op-amp/regulator pins; do user-sealed analog blocks expose
  their controlled-source internals, or only the fitted macro-model?
- **Which competency gate flips analog→sealed.** Owned by `game-rewards.md` /
  `game-contracts-economy.md` §3; architecture-adjacent, needs the determinism
  review above.
- **Bus-port determinism + probing.** A bus is presentation grouping over real
  per-line nets (§1.5); confirm the grouped rendering never changes which nets
  exist or how they hash.

---

## 5. First IC batch — concrete buildings + animation

Sections 1–4 are the survey and the ladder. This section is the **shortlist to
ship**: the *first concrete batch* of ICs, each pinned to one factory building
and an animation precise enough to write a `FACTORY_DRAWERS` entry from. It does
not re-derive the survey — it commits to a buildable set and obeys two settled
facts:

- **Fixed-function only, no seal.** Per the owner decision (top of this doc), the
  everyday IC is a curated, fixed-function Tier-A black box. The seal mechanic is
  the FPGA and is *out of scope* here. Nothing below leans on it.
- **Determinism, read off the real hash.** `snapshot_hash` in `lib.rs` is FNV-1a
  over **`tick` + `node_v` only** (confirmed in source: it hashes
  `self.tick.to_le_bytes()` then each `node_v`). So the determinism test for a
  first-batch IC is blunt and exact: **does its state live in `node_v`?** A
  pure-digital chip carries integer/boolean state *beside* `node_v` (a new hashed
  digital-domain field, the same way `reactive_state`/`diode_vd` are committed in
  `step()` but here integer-exact), drives its outputs through a level the
  digital→analog receiver picks up, and — for the very first chips that don't yet
  stamp an analog driver — **never perturbs `node_v`, so the golden
  `0xeaac376499e4fa24` is untouched.** The moment a chip *drives an analog node*
  (its output stamps a Thévenin source into the MNA system — the regulator, later
  the op-amp/DAC), it moves `node_v` and **regenerates the golden** with a
  justification, exactly per golden rule 1. That single distinction orders the
  whole batch.

Each entry is deliberately implementation-shaped. The animation specs all ride
the **bounded visual `phase` clock** already in `glyphs.ts` (`o.phase`, the
`FLOW_SPEED`/`PULSE_K` constants) and reuse `flow()` for port leads, so magnitude
is **density + thickness + alpha + the number**, never speed — the
`visual-language.md` decoupling. *State* (which bin is lit, which way a latch
sits, whether a rail holds) rides the discrete logic the block already computes,
which is exactly what makes these legible without animating magnitude.

### 5.0 The shared substrate every first-batch IC needs

Before any single chip, three small renderer/engine capabilities are the real
first deliverable; the chips are cheap once these land. They are called out in §1
but here is the batch's minimum:

1. **The N-port footprint + named pins** (§1.1): a rectangular body of grid cells
   with `side`+`index` pin sites carrying a `role`+`name`. This generalizes
   `PART_KINDS`' two-pin anchor; **pin geometry is identical across skins** (§1.2)
   so a DIP-wired board is byte-identically wired in the factory skin.
2. **The digital driver/receiver pin** (§2.1): an output pin drives a level
   through a finite output resistance; an input pin reads its net voltage and
   thresholds it against `VIL/VIH` with a defined invalid band → `X`. This is the
   "domains meet at the pins" capability; **gates need only this.**
3. **`VCC`/`GND` as ordinary pins** (§1.6): the IC is a load on the rail, and the
   behavioral model **reads its own `VCC−GND` each tick and gates its outputs on
   it** — the brownout lesson, free and identical for every chip below.

A new `FACTORY_DRAWERS` entry for an IC has the same shape as the existing
two-terminal ones — read the port `ElectricalState`s, draw a body via an
`fBox`-style helper sized to the footprint, call `flow()` on each port lead — plus
a **recipe animation in the middle** keyed to `o.phase` and to the chip's computed
discrete state. Every spec below is written to drop into that shape.

> **Carrier vocabulary reused (no new primitives in the renderer).** The five
> buildings below are assembled from the *existing* `FACTORY_DRAWERS` language —
> the **throat** (`drawFR`), **buffer chest** fill (`drawFC`), **flywheel** spin
> (`drawFL`), **one-way conveyor gate / check-valve** (`drawFD`), **door**
> (`drawFSW`), **generator** core (`generator`), and **drain grate** (`drawFGND`)
> — recomposed on an N-port body. Where an entry says "sorter swing," "bucket
> advance," or "metronome piston," that is a small new internal motif on the
> bounded clock, not a new way to show magnitude.

### 5.1 — IC #1: Logic gate (NAND/NOR first) → the **sorter / decider**

1. **Why it's first.** Highest teaching value ÷ lowest sim cost in the whole
   catalogue. It needs *only* substrate capability 2 (the driver/receiver pin) —
   no matrix growth, integer-exact, golden-untouched. NAND and NOR are universal,
   so this one building is the seed of every gate-built blueprint downstream. It
   unlocks the **"Logic level / threshold"** contract (drive a clean `1` across a
   load; watch a sagging rail turn it into `X`).
2. **Sim model. Tier A.** Ports `A`,`B` (in, left), `Y` (out, right), `VCC` (top),
   `GND` (bottom); NOT is single-input, wide gates fan in more left ports. Each
   tick: threshold every input net against `VIL/VIH` → `{0,1,X}`; compute the
   boolean (`X` on any `X` input); drive `Y` through the output resistance toward
   the driven level *after a fixed `prop_delay` tick count*; **gate `Y` on
   `VCC−GND`** — droop the rail and `Y` → `X`. **Determinism:** the gate's logic
   value is integer/boolean state hashed in the digital domain; for the first
   build, `Y` drives a *digital* receiver and **does not stamp `node_v`** → golden
   untouched. (When gates later sink real current into an analog load, that draw
   stamps `node_v` and is a deliberate, golden-regenerating step.) Truth table +
   tick-grid edge = bit-identical everywhere.
3. **Factory building.** The §1.3 **decider / sorter**, ~2×3 cells. Body shows the
   boolean glyph (`&`, `≥1`, `=1`); NAND/NOR draw the **inversion bubble** on the
   `Y` edge. Schematic skin: the distinctive-shape (or IEC rectangular) gate
   symbol with numbered DIP pins — the transferable datasheet form, and the
   **default** skin.
4. **Animation spec.** Two input belts arrive left and feed a central **sorter
   arm** — a short paddle (reuse the `drawFD` chevron-triangle motif) that rests
   in one of two detents. *State, not magnitude, drives the arm:* the arm sits
   "pass" or "block" according to the computed boolean, snapping between detents on
   the `prop_delay` edge (a discrete flip, like `drawFSW`'s door). The `Y` lead
   runs `flow()` at the driven level → **density/alpha show drive strength, the
   belt's rail color + height show the logic level.** Inputs read as their own
   belts on `A`/`B`. **Working vs idle:** when inputs are steady and `Y` settled,
   the arm holds and only the bounded-clock chevrons recirculate (calm); on an
   input change the arm *snaps* once — the only motion that ever encodes the chip
   "doing something." **`X` / invalid:** the arm sits **mid-travel, jittering on
   the `phase` clock** and `Y`'s belt drops to the dim `--warn` neutral with no
   committed rail color — the visible "unknown." **Brownout:** when `VCC−GND` sags
   under the family threshold, the **bubble/glyph dims and the arm goes limp to
   mid-travel** (same as `X`) — the chip can't decide because its supply is gone.
   The `VCC` lead (top) and `GND` lead (bottom) each carry the chip's quiescent +
   switching draw as a thin `flow()` belt, so you see it loading the rail.
5. **Dependencies.** Substrate 1+2+3. No analog stamp. **First to build.**

### 5.2 — IC #2: D flip-flop / latch → the **clocked single-bin store**

1. **Why it's first-batch.** One clocked bit, just above the gate: adds **clock
   edge-detection on the tick grid + one state bit** and nothing else. Integer-
   exact, golden-untouched. It is the seed of every sequential part and unlocks the
   **"Timing closure"** contract (meet setup/hold; no glitch).
2. **Sim model. Tier A.** Ports `D` (in), `CLK` (in, clock-port chevron glyph),
   `Q`,`Q̄` (out), optional `SET`/`RST` (in), `VCC`/`GND`. Edge-detect `CLK`
   against the previous tick's thresholded level; on the active edge, sample `D`'s
   level into the stored bit; drive `Q`/`Q̄` from it through the output resistance.
   The latch variant is level-sensitive (transparent while `CLK` high). **Setup/
   hold** is a fixed tick window around the edge; violate it and the captured bit
   is defined-but-`X` (the lesson). **Determinism:** one stored bit + the previous
   `CLK` sample are integer state hashed in the digital domain; outputs drive
   digital receivers → **`node_v` untouched, golden safe.** Clock-edge timing is a
   pure function of the tick — the same proven family as `switch_conductance`'s
   `(tick % period)`.
3. **Factory building.** The §1.4 **single-bin store with a clocked gate**, ~3×3.
   Body draws a **bistable lever** (a two-state seesaw) over one storage bin. The
   `CLK` port gets the chevron-edge motif; schematic skin is the labeled box with
   `CLK`/`D`/`Q`/`Q̄`.
4. **Animation spec.** A small bin sits center; its **fill (reuse `drawFC`'s
   charge-fill rect) shows the stored bit** — full = `1`, empty = `0`, *not* a
   magnitude, just two levels. The `CLK` lead draws a **chevron that pulses on the
   bounded clock**; on the **active edge** a quick **gate flap** (a one-frame
   `drawFSW`-style door swing) lets the `D` belt's level *latch* into the bin — you
   watch the bin snap to its new fill exactly on the edge, then **hold flat between
   edges** (the "memory" read). `Q`/`Q̄` leads run `flow()` at the driven level
   (complementary). **Working vs idle:** between clocks the bin holds and only the
   `CLK` chevron beats — a held bin *is* the chip working (storing); the only event
   is the edge flap. **Setup/hold violation:** if `D` moves inside the window, the
   bin **fills to a jittering half-level (`X`)** on that edge and `Q` shows the dim
   neutral — the timing lesson, seen. **Brownout:** rail sag **dumps the bin to
   empty and freezes the lever** (a reset/`X`), the canonical "MCU/FF resets when
   the rail browns out" from §1.6.
5. **Dependencies.** Substrate + IC #1's threshold/receiver. Adds edge-detect +
   one bit. **Second.**

### 5.3 — IC #3: Counter / shift register (+ decoder/mux) → the **bucket line**

1. **Why it's first-batch.** The sequential datapath primitive with the best
   "watch the bit walk" payoff per sim cost. Clocked integer state array; the one
   genuinely new renderer dependency is the **bus port** (§1.5). Still integer-
   exact and golden-untouched. Huge teaching surface: a bit walking down a chain
   (shift), modular counting + frequency division (counter), one-hot decode
   (decoder), input selection (mux).
2. **Sim model. Tier A.** Shift: `SER_IN`,`CLK`,`Q0..Qn` (bus, §1.5),`VCC`/`GND`.
   Counter: `CLK`,`RST`,`EN`,`Q0..Qn`. Decoder: `A0..Ak` (bus in),`Y0..Y(2^k)`
   (bus out),`EN`. Mux: `D0..D(2^k)`,`S0..Sk`,`Y`. Each active edge: shift /
   increment / decode the integer state array; drive the output bus lines from it.
   The counter's divide chain is a **pure function of the clock edges** — a
   tick-derived counter, same determinism-safe pattern as the PWM switch.
   **Determinism:** the `n`-bit integer state hashes in the digital domain;
   per-line outputs drive digital receivers → **golden safe** until a line sinks
   real analog current. Bus is presentation grouping over **real per-line nets**
   (§1.5) — grouping never changes which nets exist or how they hash.
3. **Factory building.** The §1.3 **bucket line**: a row of bins, ~ (n+2)×3 for an
   n-bit width (or compact behind a bus port). A decoder is the **switchyard**
   lighting exactly one output line; a mux is the **turntable** selecting one
   input belt. Schematic skin: the labeled sequential box; the bus draws with the
   fat multi-line "/n" motif, fanning to single belts on zoom/probe.
4. **Animation spec.** Draw the bins as a left-to-right row, each bin's **fill =
   its bit** (two levels, per IC #2). On each `CLK` edge the **contents advance one
   bin** (shift: the lit bin steps right and `SER_IN`'s level enters the first bin)
   or **the count increments** (the bin pattern updates to the new value) — *you
   literally watch the bit walk the line*, one bin per edge, the motion carried by
   the discrete state change and timed to the edge, never to magnitude. The output
   **bus lead** runs one `flow()` per line (or a single fat belt whose **thickness
   = active-line count**, with the "/n" tap label carrying the number). Decoder:
   the **one selected `Y` line lights** (full belt), all others dark — one-hot made
   literal. Mux: a **turntable wedge** (reuse the `drawFL` spoke motif, but its
   angle is *set by the `S` select value*, not spinning freely) points at the
   chosen `D` belt and routes it to `Y`. **Working vs idle:** between edges the
   bins hold; the chip "works" by stepping on each `CLK` — a frozen pattern that
   advances. **`RST`/`EN`:** `RST` clears all bins to empty in one frame; `EN` low
   freezes the advance (bins hold, `CLK` chevron still beats but nothing walks).
   **Brownout:** rail sag **scrambles the bins to jittering half-levels** and stops
   the walk (state lost) — the digital-integrity lesson.
5. **Dependencies.** Substrate + IC #2's clocked-bit core + **the bus-port
   renderer (§1.5)** — the one new presentation capability this batch introduces.
   **Third** (the bus port is its gate).

### 5.4 — IC #4: 555 timer → the **metronome / pump house**

1. **Why it's first-batch.** The first **"make it blink"** win and a beloved
   contract magnet. Tier A: an internal SR latch + two comparator *thresholds*
   evaluated at the pins, output a square wave whose period is computed from the
   external `R`/`C` on the timing pins, with **tick-pure edge generation** — the
   proven `switch_conductance` pattern (a closed-form `(tick)→level`, never an RNG
   or wall-clock). Unlocks the **"Oscillator"** contract ("blink at 1 Hz ±tol").
2. **Sim model. Tier A (first cut).** Ports `TRIG`,`THRESH`,`DISCH`,`CTRL`
   (in/analog),`RST` (in),`OUT` (out),`VCC`/`GND` — the classic 8-pin DIP, named.
   The internal latch toggles when the timing node crosses ⅓/⅔ `VCC`; `OUT` is a
   tick-derived square wave at the resulting period/duty. **Honesty caveat that
   sequences it last in the batch:** the *fully* honest 555 reads the external
   timing cap's voltage (an analog node) to decide its thresholds — that read makes
   the chip **observe `node_v`**, and if it also pulls the `DISCH` pin to ground
   through a transistor it **stamps `node_v`** → golden-affecting. The **first-cut
   Tier-A version** computes the period from the placed `R`/`C` *values* and emits
   a tick-pure square on a digital `OUT`, leaving the analog cap cosmetic — that
   version is golden-safe; the **Tier-B upgrade** (real RC charge/discharge between
   thresholds, §3.4) stamps `node_v` and regenerates the golden. Ship the tick-pure
   `OUT` first.
3. **Factory building.** The §1.3 **metronome / pump house**, ~3×4. An internal
   **piston / pendulum beats at the output frequency**; `OUT` emits a square-wave
   belt — **chevrons that pulse in time, not stream** (the one place a belt's
   chevrons gate on the chip's own clock rather than the bounded visual clock's
   free recirculation, because the *output frequency is the lesson*). Schematic
   skin: the labeled 8-pin box.
4. **Animation spec.** A central **piston** rides up/down (or a pendulum swings)
   **once per output half-period**, driven by the chip's tick-derived square state
   — this is the rare animation tied to a *simulated* rate (the blink rate the
   contract grades), distinct from the bounded visual clock; both coexist (the
   piston beats at `f_out`; the port chevrons elsewhere recirculate at the calm
   `FLOW_HZ`). On the astable build, draw the **external timing cap charging /
   discharging between two threshold marks** (reuse `drawFC` fill ramping between a
   ⅓ and ⅔ line) so you watch the exponential climb, hit ⅔, dump to ⅓, repeat. The
   `OUT` belt: a block of chevrons that **appears (high) and vanishes (low)** in
   lockstep with the piston — square-wave made visible; **duty = the fraction of
   the cycle the chevron block is present**, magnitude/drive still on density+alpha.
   **Working vs idle:** a *running* 555 is the piston beating + `OUT` blinking — the
   most obviously "alive" first-batch chip. In `RST`, the piston **parks at bottom
   and `OUT` goes dark**. **Brownout:** as `VCC` sags the **piston slows and
   stalls** — but note this is the one chip where "slows" is honest, because the
   blink *frequency itself* genuinely drops with the rail; the bounded-clock rule
   is about *not encoding magnitude in speed*, and here the rate is the modeled
   quantity, not a stand-in for current.
5. **Dependencies.** Substrate + IC #2's latch/edge core + comparator-threshold
   behavior + tick-derived output. Independent of the bus port. **Fourth** (after
   the digital trio, because it introduces the threshold-read + tick-square output
   and is the bridge toward analog-aware chips).

### 5.5 — IC #5: Linear regulator (78xx) → the **rail refinery** *(first analog-touching; gated)*

1. **Why it's in the batch but last.** The canonical **"raw ore → ingot"** and a
   premier early contract magnet — **"hold 5 V ±2% to 100 mA"**, the standing-
   production economy's bread and butter (robustness over time = income). It is
   here because the **IC footprint dissolves the only blocker on controlled
   sources** (§2.2): `IN`/`OUT`/`GND` are the named drive pins, so no free-floating
   two-port gesture is needed. But it is **last and explicitly gated** because it
   is the **first chip that drives an analog node** → it moves `node_v` and
   **regenerates the golden**.
2. **Sim model. Tier B.** Ports `IN` (in, left/top),`OUT` (out, right),`GND`
   (bottom, common). A **controlled series-pass element** holding `Vout` against
   load: a regulated voltage source with an output impedance and a **dropout
   clamp** `Vout = min(Vset, Vin − Vdropout)`, the clamp on the proven Newton path
   (like the diode). **Determinism:** the controlled-source stamp is linear and
   the clamp is a bounded, fixed-threshold Newton nonlinearity — deterministic by
   the same argument as V/R/C/L/I + the diode. **It stamps `node_v`, so it is
   golden-affecting** — any netlist exercising it regenerates the pinned hash with
   a justification, per golden rule 1. This is the batch's one deliberate analog
   step.
3. **Factory building.** The §1.3 / `game-factory-loop.md`-Tier-2 **rail refinery**,
   ~3×3. A **wobbly input rail enters the top, a clean flat output rail leaves the
   right**; the internal motif is a **governor / float-valve** holding the output
   bar level while the input bar bobs. Schematic skin: the `7805`-style three-pin
   block.
4. **Animation spec.** Two horizontal **rail bars** drawn inside the body: the
   **`IN` bar bobs** (its height = the noisy input voltage, which genuinely varies)
   and the **`OUT` bar holds dead flat** at `Vset`. Between them sits a **float-
   valve / governor**: a small paddle that **rides up and down on the bounded
   `phase` clock to *visibly do the leveling work*** — when the input bar rises the
   paddle nudges to throttle, keeping the output flat. The `OUT` lead runs `flow()`
   at the load current → **belt thickness = current drawn**, height = the held
   `Vset` (rail color = the produced rail: +5V cyan, +3.3V violet, +12V amber from
   `visual-language.md`). **Working vs idle:** a working regulator is the **output
   bar held flat while the input bobs and the governor fidgets** — robustness made
   visible; with no load the governor rests and the bars sit still. **Dropout /
   brownout (the lesson):** drive `IN` below `Vset + Vdropout` and the **output bar
   *follows the input bar down*** (the governor bottoms out, paddle slammed open) —
   `Vout = Vin − Vdropout`, the dropout lesson seen directly. A local decoupling cap
   on `OUT` (the §1.6 buffer chest) visibly **rides out an input dip**, tying the
   refinery back to the buffer-chest mechanic.
5. **Dependencies.** Substrate + **controlled sources in the core (P4 in
   `parts-catalog-ideation.md`)** + the one-sided dropout clamp on the Newton path.
   **Golden-regenerating. Fifth and gated** — it ships the moment controlled
   sources land, and it is the natural first home for them.

### 5.6 Recommended first batch (ordered) + rationale

1. **Logic gate (NAND/NOR → AND/OR/NOT/XOR)** — the *sorter / decider*.
2. **D flip-flop / latch** — the *clocked single-bin store*.
3. **Counter / shift register (+ decoder/mux)** — the *bucket line*.
4. **555 timer** — the *metronome / pump house*.
5. **Linear regulator (78xx)** — the *rail refinery* (gated on controlled sources).

**Rationale (one paragraph).** Items 1–4 are all **Tier-A, integer-exact,
`node_v`-free → the golden `0xeaac376499e4fa24` never moves**, and they are
sequenced by the single renderer/engine capability each one adds: the gate needs
only the driver/receiver pin (capability 2); the flip-flop adds clock edge-detect
+ one bit; the counter/shift line adds the bus port (§1.5), the only new
presentation primitive in the batch; the 555 adds threshold-read + a tick-pure
square output and is the bridge toward analog awareness. They unlock the entire
**digital contract family** — logic-level, timing-closure, oscillator — with the
safest possible determinism story and a clear "watch it work" animation for each
(the snapping sorter, the latching bin, the walking bit, the beating piston). The
regulator is deliberately **fifth and fenced off**: it is the first chip that
*drives* an analog node, so it depends on controlled sources (P4) landing and it
**regenerates the golden** — but it is the highest-value early *analog* contract
("hold a rail under load"), and the IC footprint is precisely what makes its
controlled source placeable, so it is the right first analog IC and the right
bridge into batch two.

### 5.7 Deferred to batch two (and why)

- **Op-amp + op-amp blocks (integrator/active filter)** — Tier B, **controlled
  source + rail-clamp nonlinearity, golden-affecting**, and the blocks additionally
  want reactive feedback in the solve. Waits behind the regulator proving the
  controlled-source path (§3.5–3.6).
- **ADC / DAC** — Tier A but **read/drive analog nodes** (the DAC stamps a Thévenin
  output, the ADC reads `node_v`) → golden-affecting; also want the bus port mature.
  The analog↔digital bridge is a batch-two flagship, not a first step (§3.9).
- **Switching regulator / buck-boost controller** — the switching netlist already
  exists, but this needs **closed-loop control adjusting duty per tick** on top of
  it; a Tier-C→A arc better suited once the regulator and a controller-behavior
  pattern are proven (§3.8).
- **Memory (register file / SRAM)** — Tier A and golden-safe, deferred only on
  *priority*: it wants the bus port and tri-state data handling, and its payoff
  (the datapath warehouse) lands better after the counter/shift line establishes
  buses (§3.10).
- **H-bridge / motor driver** — Tier-A control but the satisfying version wants the
  inductive-load (and back-EMF controlled-source) interaction; visually a batch-two
  showpiece (§3.12).
- **Microcontroller** — the emulator capstone; needs the temporal-decoupling/resync
  machinery. Explicitly the *last* building, not a first-batch chip (§3.11).

**The through-line:** ship the four golden-safe digital chips first (gate →
flip-flop → counter/shift → 555), each adding exactly one capability and one clear
animation; then cross the analog line *once*, with the regulator, regenerating the
golden deliberately — and everything that also drives or reads analog nodes
(op-amp, ADC/DAC, switcher) follows it in batch two on that same proven
controlled-source/Thévenin substrate.

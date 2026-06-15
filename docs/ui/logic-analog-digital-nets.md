<!-- SPDX-License-Identifier: Apache-2.0 -->

# Logic levels, logic families, and the analog↔digital boundary

Status: **design ideation. No code yet.** Owner-driven brief. This note is the
in-flight doc referenced from `TODOS.md` ("Logic gates: real logic levels /
families + analog↔digital boundary"). It studies the current behavioral gate
(`ELEM_GATE = 17`), diagnoses exactly where it breaks, surveys the design space
for fixing it against the project's non-negotiables, and recommends a phased
path. The verbatim ask from the owner:

> "The logic gates currently have no idea how to handle logic high and logic low
> being anything other than their set HIGH value and low being zero. Don't know
> how we're going to consolidate this, but I think the solution is going to end
> up as a separated analog and digital net system, with barriers, or something
> like that maybe."

Unlike `component-info-panel.md` and `onboarding-first-run.md` — which are
**presentation-only** and never touch `sim-core` — *this* brief is mostly about
the simulation core. So determinism is front-and-centre throughout: every option
below is judged first on whether it can stay **golden-stable** (the FNV-1a
snapshot hash, `gate_run_is_reproducible`, the fixed-step solve — see
`docs/determinism.md`), and any deliberate behaviour change is flagged as
**regenerate-the-golden** work. The teaching mission is the second axis: the
analog↔digital boundary is, per `docs/architecture.md`, *"the most useful
teaching surface,"* so the goal is to **expose** noise margin / logic families /
level shifting, not to paper over them.

---

## 1. What the gate model does today (and exactly where it breaks)

### 1.1 The current model, precisely

The gate is a **tick-pure behavioral driver** stamped into the same dense MNA
matrix as every other element. Reading the code:

- **One solver type, function by code.** Every gate part (`AND`/`OR`/`NAND`/
  `NOR`/`XOR`/`NOT`) maps to `ELEM_GATE = 17`
  (`crates/sim-core/src/lib.rs:412`); the boolean is selected per-part by `aux`
  (`gate_logic`, `crates/sim-core/src/lib.rs:720` — `0 AND, 1 OR, 2 NAND,
  3 NOR, 4 XOR, 5 XNOR, 6 NOT, 7 BUF`). Pins are `a = OUT, b = IN1, c = IN2`.
- **A single half-rail threshold for inputs.** `gate_target_level`
  (`crates/sim-core/src/lib.rs:740`) thresholds *both* inputs at
  `GATE_VTH_FRAC * value`, where `GATE_VTH_FRAC = 0.5`
  (`crates/sim-core/src/lib.rs:426`) and `value` is the gate's logic-high rail.
  An input is a logical `1` iff its node voltage `> 0.5 * value`. There is **one**
  threshold, used for **both** the rising and falling decision — no hysteresis,
  no invalid band.
- **The output is a Thévenin pull to exactly `0` or exactly `value`.** The chosen
  level (`vh` or `0.0`, `crates/sim-core/src/lib.rs:744`) is driven onto the
  output node `a` through a fixed conductance `GATE_GOUT = 1.0` S
  (`crates/sim-core/src/lib.rs:419`) — a constant conductance to ground plus a
  current injection `GATE_GOUT * Vtarget` (the linear-path stamp,
  `crates/sim-core/src/lib.rs:1779-1784`; the Newton-path and base-matrix copies
  are identical at `:1959`, `:2787`, `:3015`). So the output Thévenin source is
  `(V_OH = value or V_OL = 0)` behind a `1 Ω` source resistance, *symmetric* for
  high and low.
- **Inputs draw no current.** Each sensed input row gets only a `GMIN` floor to
  ground (`crates/sim-core/src/lib.rs:1788-1793`) so a floating input is
  non-singular and reads low. There is no input load model beyond that.
- **One tick of delay; no persistent state.** The decision reads the **committed
  previous-tick** node voltages, so the stamp is constant within a solve (no
  Newton, no branch unknown) and the output lags inputs by one tick. The gate
  holds no state of its own; only the node voltages carry into the hash
  (`crates/sim-core/src/lib.rs:80-81`, `:409-410`). This is what keeps
  `gate_run_is_reproducible` (`crates/sim-core/src/lib.rs:4938`) on the **linear
  fast path** (`is_nonlinear` deliberately excludes the gate,
  `crates/sim-core/src/lib.rs:766-768`).
- **The D flip-flop shares the same machinery** (`ELEM_DFF = 19`): same
  `GATE_VTH_FRAC` threshold on `D`/`CLK` (`crates/sim-core/src/lib.rs:3315`),
  same `GATE_GOUT` output pull on `Q`/`Q̄` (`stamp_dff`,
  `crates/sim-core/src/lib.rs:3225`). Anything we decide for gates must carry to
  the DFF (and to the whole Tier-A digital roadmap in `TODOS.md`: shift
  registers, counters, decoders, the ADC, the H-bridge).

The front end mirrors this with a single number: `value` is the logic-high rail
(`web/src/lib/graph.ts:370-374`), and `gateInfo` teaches exactly one threshold —
`threshold = rail / 2` (`web/src/lib/partInfo.ts:110-116`). Note also a latent
gap: `GATE_AUX` in `web/src/lib/netlist.ts:116-123` only defines AND/OR/NAND/
NOR/XOR/NOT — **XNOR (5) and BUF (7) exist in the core but are unreachable from
the board** because no part maps to them. (Minor, but relevant: any redesign
should decide whether to surface them.)

### 1.2 The single sentence that captures the limitation

> The gate has exactly **one** voltage parameter (`value`), and it serves as
> *all four* of `V_IL`, `V_IH`, `V_OL`, `V_OH` at once: inputs switch at `value/2`
> and outputs are pinned to `{0, value}`. A logic level is "the rail or zero,"
> full stop.

Everything below is a consequence of that conflation.

### 1.3 Concrete failure cases

These are the cases the owner is pointing at. Each is real today.

**(a) Two different-rail gates wired together (3.3 V → 5 V).**
Place a 3.3 V gate (`value = 3.3`) driving a 5 V gate (`value = 5`). The first
gate's "high" is `V_OH = 3.3 V` behind `1 Ω`. The second gate thresholds at
`0.5 * 5 = 2.5 V`. `3.3 > 2.5`, so it *happens* to read high — but for the wrong
reasons and with **no noise margin shown** (`V_OH − V_IH = 3.3 − 2.5 = 0.8 V`,
which is real and teachable, but invisible). Now reverse it: a 5 V gate
(`V_OH = 5`) driving a 3.3 V gate works electrically here but, on real silicon,
**5 V into a 3.3 V input is an over-voltage fault** (it can forward-bias the
input clamp diode / damage the part). The sim has no concept of an absolute-max
input voltage, so it silently "works" where a real board would be marginal or
destroyed. And the *interesting* failing direction — a true 1.8 V part
(`V_OH = 1.8`) driving a 5 V part thresholded at `2.5 V` — reads **low** (`1.8 <
2.5`), i.e. the high is *lost*, which is the canonical "you need a level shifter"
lesson. Today that just looks like the gate "not working," with nothing pointing
at *why*.

**(b) A resistor-divided / partially-driven input.**
Drive a gate input through a divider so the node sits at, say, `2.7 V` on a 5 V
part. Today: `2.7 > 2.5`, reads high — a hard, clean `1`, no notion that
`2.7 V` is *barely* above threshold and would be in the **forbidden region** of a
real TTL part (`V_IH(TTL) ≈ 2.0`, `V_IL(TTL) ≈ 0.8`; `2.7` is a valid high there,
but `1.5 V` would be *indeterminate* on real hardware yet reads a crisp `0` here
at `1.5 < 2.5`). The model cannot represent "this input is in the invalid band" —
the comment at `crates/sim-core/src/lib.rs:423-425` admits this directly:
*"the invalid/indeterminate band of a real family is deliberately collapsed to
this single threshold."*

**(c) An open-drain / pull-up net.**
There is no open-drain output and no wired-AND bus. An open-drain output is
"pull low, or release (high-Z)"; the high comes from an external pull-up resistor
to the rail. Today every gate output is a **push-pull** Thévenin source that
*actively drives both* `0` and `value`, so:

- you cannot build a wired-AND / wired-OR bus (multiple outputs on one net, any
  one pulling it low),
- you cannot model I²C / 1-Wire / an interrupt line,
- two gate outputs tied to the same net **fight**: each stamps `GATE_GOUT` to
  ground + `GATE_GOUT * Vt` into the shared row, so the net settles at the
  *average* of their targets (`(Vt1 + Vt2) / 2` for equal conductances) — a
  physically meaningless half-rail, not a "bus contention" error.

**(d) Loss of noise margin / V_OL ≠ 0, V_OH ≠ rail.**
A real gate's `V_OL` is not `0` (TTL `V_OL ≈ 0.4 V`, and it rises under load),
and `V_OH` is not the rail (it sags under load, and for TTL totem-pole it's
`~3.4 V` off a 5 V rail). The sim pins outputs to exactly `{0, value}` (modulo
the `1 Ω` IR drop into a load). So the noise-margin arithmetic
(`NM_H = V_OH − V_IH`, `NM_L = V_IL − V_OL`) is **not representable** — every
margin is "rail minus half-rail," the same for every family. The defining
property that distinguishes TTL from CMOS from LVCMOS — *their thresholds and
levels differ* — has nowhere to live.

**(e) Different V_IL/V_IH between input and output of the same family.**
Even within one part, a real family's *input* thresholds and *output* levels are
different numbers (that asymmetry **is** the noise margin). The single `value`
cannot encode that the same 5 V CMOS part guarantees `V_OH ≈ 4.95`, `V_OL ≈
0.05`, but only *requires* `V_IH ≈ 3.5`, `V_IL ≈ 1.5`. One number, six roles.

### 1.4 Why the half-rail idealisation was the right *first* cut

To be fair to the existing code (and to set the bar for not regressing it): the
half-rail model is a deliberate, documented simplification
(`crates/sim-core/src/lib.rs:422-426`) that buys enormous determinism wins — a
**constant** stamp, **no** Newton iteration, **no** branch unknown, one clean
tick of delay, and a ring oscillator that oscillates instead of deadlocking
(`crates/sim-core/src/lib.rs:406-408`). Any redesign must preserve those
properties. The problem is not that the model is *wrong* — it is that it has
**no parameters to teach with**.

---

## 2. The design space

Four families of solution, evaluated against the three non-negotiables:
**(D) determinism**, **(B) the coarse JS↔wasm boundary**, **(T) teaching**.

A note that frames all four: the architecture doc *already promises* a separated
digital domain — *"An event-driven digital engine owns gates, flip-flops, and
fabric, with events landing on the tick grid… The domains meet only at the pins
through driver and receiver models, which is also the most useful teaching
surface"* (`docs/architecture.md:21-25`). So Option A is not a left-field idea;
it is the **stated long-term architecture**. The question is sequencing: how much
of it do we need now, and what is the cheapest first step that doesn't paint us
into a corner.

### Option A — Separated analog vs digital nets with explicit boundary elements

**The shape.** Nets are classified as **analog** or **digital**. A digital net
carries a *logic level* (a small enum: `0`, `1`, `Z`, `X`) rather than a
continuous voltage. The two domains meet only through two **boundary/barrier
elements**:

- a **receiver / input buffer** that *quantises* an analog node voltage into a
  digital level using a logic family's `V_IL`/`V_IH` (with an optional `X`
  "indeterminate" verdict in the forbidden band, and hysteresis for a
  Schmitt input);
- a **driver / output buffer** that *re-presents* a digital level back onto an
  analog node as a real Thévenin (or open-drain) source using the family's
  `V_OL`/`V_OH` and an output impedance `R_pull-up`/`R_pull-down`.

The pure-digital interior (gate → gate → flip-flop, all on digital nets) is then
solved by a **deterministic digital scheduler**, not by the MNA matrix at all.
Only the boundary elements touch the analog solve.

**Net classification — who decides?** Three sub-choices, in increasing user
burden:

1. **Compiler-inferred (recommended).** `buildNetlist` already computes connected
   components via union-find (`web/src/lib/netlist.ts:190-221`). Extend it: a net
   touched *only* by digital pins (gate I/O, FF I/O, future logic) and other
   digital nets is **digital**; a net touched by any analog element (R/C/L/
   source/diode/transistor) is **analog**; a net touching *both* is a **boundary
   net** and the compiler **auto-inserts** the appropriate barrier. The user
   wires as today; classification is invisible and deterministic (it is a pure
   function of the topology, like the existing ground-selection and
   floating-source passes).
2. **User-placed barriers as real parts.** The user drops an explicit
   "input buffer (74LVC)" / "level shifter" part. Honest and very teachable, but
   high friction and easy to forget — every gate-to-LED example
   (`web/src/lib/examples.ts:1532`) would need one.
3. **Hybrid: auto-insert, but surface as a real, inspectable thing.** The
   compiler inserts the barrier, but the UI *shows* it (a little buffer glyph on
   the boundary, an inspector that reads "quantised 3.27 V → logic 1, margin
   0.77 V"). This is the teaching sweet spot.

**Is the digital interior solved by events or still stamped into MNA?** This is
the crux, and it splits Option A into two very different cost profiles:

- **A1 — digital nets still stamped into MNA** (a "single matrix, but typed
  nets"). The digital scheduler decides each gate's *output level* (as today,
  from last tick), and the boundary elements convert; but the digital nets are
  still real rows in the dense matrix carrying the driven voltage. This is
  **barely more than today** — it is essentially "give the gate a family
  descriptor" (Option B) plus "name which nets are digital so the UI can render
  them differently." It keeps the gate on the linear fast path. Cheapest; lowest
  risk; does *not* deliver a wired-AND bus cleanly (outputs still fight in the
  matrix unless the driver model is open-drain).
- **A2 — a true separate deterministic digital scheduler.** Digital nets are
  removed from the MNA system entirely; gate evaluation is event-driven on the
  tick grid (the architecture doc's target). The analog matrix shrinks to just
  the analog nets + boundary stamps. This is the **fuller** system and the one
  that makes ms→GHz islanding (`docs/architecture.md:34-72`) and big digital
  fabric tractable — but it is a major new subsystem.

**(D) Determinism.** A1 is golden-neutral *in principle* but **changes gate
behaviour** (levels are no longer `{0, value}`), so it **regenerates the golden**
— a deliberate, reviewed act per `docs/determinism.md`. A2 needs a **separate
deterministic digital scheduler**, which is the hard part. It *can* be
deterministic if: evaluation order is a fixed function of element index (never
hashed-collection order — golden rule #1); the event queue is a deterministic
structure (a fixed-capacity per-tick bucket keyed by integer tick, drained in
element order, **not** a `BinaryHeap` of floats); levels are a discrete enum (no
float compares inside the digital domain at all); and combinational feedback is
resolved by the **same one-tick-delay** trick the gate already uses (read last
tick, settle next tick) rather than an unbounded fixpoint loop. Done that way it
reproduces bit-for-bit and rewinds with the tick exactly like the PWM switch.
The snapshot hash would need to **include the digital net levels** (the gate no
longer stores state, but a scheduler does) — small, discrete bytes folded into
`fnv1a` (`crates/sim-core/src/lib.rs:230`) in fixed order. **This is a golden
change and a hashing change; both must be deliberate.**

**(B) Boundary.** Neutral. The per-frame snapshot
(`web/src/sim/loop.ts`) already batches `state()` + `element_currents()`; digital
levels are just more bytes in the same batched read. Net classification is
computed JS-side in `buildNetlist` (it already runs there) or mirrored in the
core; either way it does not add a per-component crossing.

**(T) Teaching — the strongest of the four.** This is *literally* the
analog↔digital boundary made into a tangible object. You can show: the quantiser
verdict ("2.7 V → 1, but only 0.2 V of margin"), the `X`/forbidden band lighting
up red, a wired-AND bus working because outputs *release* instead of fight, and a
level shifter as a first-class part. It matches the `visual-language.md`
discipline (a digital net could render as a two-state rail with a margin badge).

**Cost.** A1: low-moderate (mostly Option B + net typing). A2: high (a whole new
deterministic engine). Risk concentrated in A2's scheduler determinism.

### Option B — One unified analog solve, but a proper logic-family descriptor

**The shape.** Keep *everything* in the MNA matrix exactly as today, but replace
the single `value` with a **logic-family descriptor**: `{ V_IL, V_IH, V_OL,
V_OH, R_oh, R_ol, hysteresis?, input_model }`. The gate then:

- thresholds inputs with `V_IL`/`V_IH` (and a hysteresis band for Schmitt
  inputs) instead of `value/2` — replacing the single `GATE_VTH_FRAC` compare in
  `gate_target_level` (`crates/sim-core/src/lib.rs:740`);
- drives the output toward `V_OH`/`V_OL` (not `value`/`0`) through asymmetric
  pull-up/pull-down conductances `1/R_oh`, `1/R_ol` (replacing the symmetric
  `GATE_GOUT` stamp at `crates/sim-core/src/lib.rs:1779-1784`).

**Where does the descriptor live?** The element already carries two scalars
(`value`, `aux`). A family is a small **index** into a fixed, code-defined table
of standard families (TTL, 5 V CMOS, 3.3 V LVCMOS, 2.5 V, 1.8 V, …) — the same
pattern as the diode family's `DiodeModel` (`crates/sim-core/src/lib.rs:108-111`)
and the gate's own function code. The table is `const` (fixed constants → golden
reproducibility), so the descriptor is one more small integer per element. **No
new branch unknown, no Newton** — it is the same constant-Thévenin stamp with
different numbers.

**(D) Determinism.** Clean — it stays on the linear fast path and adds no float
nondeterminism (all constants are fixed). But it **changes the numbers** the gate
produces (`V_OL = 0.4` not `0.0`, asymmetric pulls), so **the golden must be
regenerated** and the change explained. The asymmetric pull-up/pull-down is the
one subtlety: two outputs on a net no longer settle at a clean average, which is
arguably *more* honest but still not a real bus-contention model.

**(B) Boundary.** Fully neutral — identical to today (one batched snapshot).

**(T) Teaching.** Good, and the **cheapest** teaching win: real noise margins
appear (`NM_H = V_OH − V_IH`), families differ, the info panel can show the four
levels and the two margins instead of one threshold (extending `gateInfo`,
`web/src/lib/partInfo.ts:106`). What it **still cannot do**: a true digital `Z`
(high-impedance / open-drain / wired-AND), an `X` indeterminate state as a
*propagating* value (it can *flag* an input in the forbidden band, but the output
is still forced to a definite level), and it does not separate the domains for
the islanding/perf story. It is "analog gates with honest levels," not "a digital
domain."

### Option C — Hybrid: analog everywhere, family params, front-end visualises levels

**The shape.** Option B's core change (family descriptor, real levels/margins),
**plus** a presentation layer that reads the per-frame snapshot and renders logic
semantics: a digital net drawn as a two-state rail, a **noise-margin meter** on a
selected gate, a forbidden-band warning when a node sits between `V_IL` and
`V_IH`, a level-shifter recommendation when a high is lost across a rail
boundary. Crucially the *front end* classifies nets as "looks digital" for
rendering only — the sim stays a single analog solve.

**(D) Determinism.** Identical to Option B (the sim change is Option B; the rest
is presentation, golden-neutral like `carrierOffset`/`phase`).

**(B) Boundary.** Neutral — the visualisation is a pure read of the existing
batched snapshot (node voltages already cross; the family descriptor is static
JS-side data the renderer already has from the netlist).

**(T) Teaching — excellent per dollar.** Gets ~80% of Option A's teaching value
(noise margins, families, "your high is too low for this part," level-shifting as
a concept) for ~20% of the cost, because the hard part (a digital scheduler) is
deferred. The honest limitation: it can *show* a forbidden band and *recommend* a
level shifter, but it cannot *simulate* a wired-AND bus or a true `Z`, because
under the hood it is still Option B's forced-level analog gate.

### Option D — A first-class level-shifter / interface part

**The shape.** Regardless of A/B/C, add an explicit **level translator** part
(and its cousins: a buffer/line-driver, a Schmitt-trigger input, an open-drain
buffer with a separate pull-up). A level shifter reads a logic level referenced
to rail `V_A` on one side and re-drives it referenced to rail `V_B` on the other.

**(D) Determinism.** If built as a behavioral element (two boundary buffers
back-to-back, each a constant Thévenin stamp from last tick), it is exactly as
deterministic as the gate — linear, no Newton, no branch unknown, golden-additive
(a *new* element type doesn't change existing goldens, like every part added
since: MOSFET, op-amp, transformer all landed golden-stable per `TODOS.md`).

**(B) Boundary.** Neutral.

**(T) Teaching — high and *targeted*.** It is the *answer* to failure case (a):
the part that makes a 1.8 V sensor talk to a 5 V MCU. It only fully shines once
levels are real (Option B/C), because otherwise "3.3 → 5" already "works" and the
shifter looks pointless. So Option D is a **companion** to B/C, not a substitute.

### 2.x Comparison table

| Axis | A1 (typed nets, still MNA) | A2 (digital scheduler) | B (family descriptor) | C (B + viz) | D (level-shifter part) |
| --- | --- | --- | --- | --- | --- |
| **Determinism** | golden change; linear; safe | golden + **new deterministic scheduler** + hash change | golden change; linear; safe | = B (sim); rest presentation | golden-**additive** (new type) |
| **JS↔wasm boundary** | neutral | neutral (more snapshot bytes) | neutral | neutral | neutral |
| **Real V_IL/IH/OL/OH + noise margin** | yes | yes | **yes** | yes | n/a (uses them) |
| **Open-drain / `Z` / wired-AND bus** | only if driver is OD | **yes** | no | no | partial (OD buffer) |
| **`X` indeterminate as a value** | flag only | **propagates** | flag only | flag only | no |
| **Mixed-rail interfacing taught** | yes | yes | yes (margins) | **yes (visual)** | **yes (the part)** |
| **Enables digital islanding / perf** | no | **yes** | no | no | no |
| **Implementation cost** | low–med | **high** | low | low–med | low |
| **Touches `sim-core`?** | yes | yes (a lot) | yes | yes (a little) | yes (new type) |

---

## 3. Recommendation — a phased path from MVP to the fuller system

The right move is **not** to jump straight to the architecture doc's
event-driven digital engine (Option A2). It is to **earn** it in stages, banking
the cheap teaching wins first and only building the separate scheduler when the
digital circuits get big enough to need it. Concretely: **C now, A2 later, with
B as the sim substrate under C and D added as soon as levels are real.**

### Phase 0 — Decide the descriptor and *don't* break the golden yet (sim-core)

Introduce the **logic-family table** (`const` array of `{V_IL, V_IH, V_OL, V_OH,
R_oh, R_ol}` for TTL / 5 V CMOS / 3.3 V LVCMOS / 2.5 V / 1.8 V) and a family
**index** carried per gate. **Default the index to a "legacy/ideal" family whose
numbers reproduce today's behaviour exactly** (`V_IL = V_IH = value/2`,
`V_OL = 0`, `V_OH = value`, `R_oh = R_ol = 1 Ω`). Wiring this in *without*
selecting a non-legacy family for any existing example keeps **every golden
bit-identical** — the same discipline that let the AC `aux` amplitude and the
4th terminal `d` land signature-compatibly (`web/src/lib/netlist.ts:538-547`).
This is the safe scaffold.

- **Touches `sim-core`** (new constants + a per-element index + a rewritten
  `gate_target_level`/stamp that *collapses to today's numbers* under the legacy
  family). **Golden: unchanged**, provided the default family is the exact
  idealisation. Add tests asserting the legacy family reproduces the current
  truth-table voltages (`gate_out`, `crates/sim-core/src/lib.rs:4847`).

### Phase 1 — Real families + noise margins, opt-in per part (sim-core + golden)

Let a gate **select** a real family (TTL, LVCMOS, …). Now `V_OL = 0.4`, `V_OH`
sags, thresholds are asymmetric, pull-up/pull-down differ. Add the **open-drain**
output mode here too (a driver that pulls to `V_OL` or *releases* to high-Z via
`GMIN`), which is the minimum needed for a pull-up net and a wired-AND bus.

- **Touches `sim-core`.** **Golden: regenerate** — this is a deliberate
  behaviour change; the PR must say *why* (real logic levels) and show the new
  hashes. Existing examples that stay on the legacy family are still
  bit-identical; only examples switched to a real family move.
- **New deterministic tests** (see §4): per-family threshold/level tables, the
  mixed-rail cases, the open-drain pull-up, and a fresh `gate_run_is_reproducible`
  per family.

### Phase 2 — Front-end logic visualisation + level-shifter part (presentation + new type)

This is where the **teaching** lands and where the brief's failure cases become
*lessons*:

- **Noise-margin readout.** Extend `gateInfo` (`web/src/lib/partInfo.ts:106`) and
  the info panel to show `V_IL/V_IH/V_OL/V_OH` and the two margins, not the lone
  `rail/2` threshold. Static specs go in the ratings block proposed by
  `component-info-panel.md` §2 (#7).
- **Forbidden-band warning.** When a digital-driven node sits between `V_IL` and
  `V_IH`, surface the `incomplete-circuits.md` vocabulary (amber chip, ringed
  pin, "indeterminate — between V_IL and V_IH") instead of a confident `0`/`1`.
  Pure read of the per-frame snapshot.
- **Digital-net rendering.** Per `visual-language.md`, a net the renderer
  classifies as digital draws as a two-state rail with a small margin badge —
  presentation only; the sim is unchanged.
- **Level-shifter / buffer / Schmitt / open-drain parts (Option D).** New
  behavioral element type(s), each two boundary buffers' worth of constant
  Thévenin stamps. **Golden-additive** (new types don't perturb existing
  circuits). This is the concrete fix for "1.8 V part → 5 V part."

These are mostly **presentation-only** (golden-neutral, like
`component-info-panel.md`/`onboarding-first-run.md`) except the new
level-shifter type, which is golden-*additive*.

### Phase 3 — The separated digital domain / event scheduler (sim-core, big; Option A2)

Only when the digital circuits warrant it (counters, shift registers, the
sequential capstone in `TODOS.md`, or the ms→GHz islanding work): lift the
**pure-digital interior** out of the MNA matrix into a **deterministic
event-driven digital engine** (the `docs/architecture.md` target). The boundary
buffers from Phase 1 become the formal domain barrier. The analog matrix shrinks
to analog nets + barrier stamps.

- **Touches `sim-core` heavily.** **Golden: regenerate** (and the **snapshot hash
  gains the digital net levels** — discrete bytes, fixed order, folded into
  `fnv1a`). The determinism recipe in §2/Option A2 is the acceptance bar:
  element-index evaluation order, integer-tick event buckets (no float-keyed
  heap), enum levels (no digital-domain float compares), one-tick-delay feedback
  resolution. This is the **highest-risk** step and should not be attempted until
  Phases 0–2 have proven the level/family model.

### What touches the golden vs what is presentation-only — at a glance

| Work | Layer | Golden impact |
| --- | --- | --- |
| Family table + legacy-default descriptor (Phase 0) | `sim-core` | **none** (legacy reproduces today) |
| Real families, asymmetric pulls, open-drain (Phase 1) | `sim-core` | **regenerate** (deliberate) |
| Noise-margin readout, forbidden-band warning, digital-net render (Phase 2) | `web` (presentation) | **none** |
| Level-shifter / buffer / Schmitt parts (Phase 2) | `sim-core` (new types) | **additive** (existing circuits unchanged) |
| Event-driven digital engine + level-bearing hash (Phase 3) | `sim-core` | **regenerate** + hash change |

### Open questions for the owner

1. **Inference vs explicit barriers.** Should net classification be
   **compiler-inferred + auto-inserted** (recommended: zero friction, the
   union-find already exists) or require the user to drop explicit buffer/shifter
   parts (more honest, more friction)? Recommendation: infer, but **show** the
   inserted barrier (§2/Option A, sub-choice 3) so it still teaches.
2. **How many stock families, and are they user-editable?** Recommendation: a
   fixed `const` set (TTL, 5 V CMOS, 3.3 V LVCMOS, 2.5 V, 1.8 V) for determinism;
   custom per-part `V_IL/IH/OL/OH` is possible but multiplies the golden surface —
   confirm whether custom families are wanted in the game at all.
3. **Does an over-voltage input become a *fault*?** Real 5 V-into-3.3 V can
   damage a part. Do we model an absolute-max input voltage and *flag/fail* it
   (great teaching, new failure semantics), or just warn? Recommendation: warn in
   Phase 2 (forbidden-band machinery), consider a "magic smoke" failure later.
4. **`X` (indeterminate): flag-only or a propagating value?** Option B/C can only
   *flag* it; a true propagating `X`/`Z` needs the digital domain (Phase 3).
   Confirm whether a flag is enough for the curriculum until Phase 3.
5. **Default family for a freshly-placed gate.** Legacy-ideal (keeps things
   simple for a beginner) or a real family like 5 V CMOS (teaches from the
   start)? This decides whether *new* user circuits look idealised or real.
6. **Surface XNOR (5) and BUF (7).** They exist in `gate_logic`
   (`crates/sim-core/src/lib.rs:720`) but `GATE_AUX`
   (`web/src/lib/netlist.ts:116`) omits them. Add board parts while we're here?
7. **The DFF and the rest of the Tier-A digital ladder.** The flip-flop shares
   `GATE_VTH_FRAC`/`GATE_GOUT` (`crates/sim-core/src/lib.rs:3315`, `:3231`); the
   family/level work should extend to it and to the planned shift register /
   counter / decoder / ADC (`TODOS.md`). Confirm we treat "logic family" as a
   shared property of the whole digital tier, set once.

---

## 4. Debugging / validation plan

The owner explicitly asked to *"debug it."* Because the heart of this is in
`sim-core`, validation is **deterministic Rust unit tests first**, front-end
checks second. The bar is the existing gate test block
(`crates/sim-core/src/lib.rs:4832-5014`) — extend it, don't replace it.

**1. Per-family threshold/level tables (sim-core).**
Generalise the existing `gate_out(code, a_hi, b_hi)` helper
(`crates/sim-core/src/lib.rs:4847`) into `gate_out_family(family, code, va, vb)`
that drives the inputs to *arbitrary* analog voltages (not just `{0, 5}`). For
each stock family assert, with **explicit numeric expectations**:
- an input at `V_IH + ε` reads `1`, at `V_IL − ε` reads `0`, and at a voltage
  strictly between `V_IL` and `V_IH` lands in the **forbidden** verdict (or
  whatever the chosen `X` semantics are);
- the output high settles near `V_OH` and low near `V_OL` (loaded and unloaded),
  asserting the asymmetric pull-up/pull-down by loading the output and checking
  `V_OL` *rises* under load but `V_OH` *sags* — the real behaviour.
This directly exercises failure cases (b) and (d).

**2. Mixed-rail interface cases (sim-core).**
Build the explicit cross-rail nets from §1.3(a): a 1.8 V family output into a
5 V family input must read **low** (`V_OH(1.8) < V_IH(5 V CMOS)`) — i.e. the high
is correctly *lost*, proving the model now distinguishes families. Then insert a
level-shifter part and assert the same chain now reads **high**. This is the
regression test that "level shifting" is real, not cosmetic.

**3. Open-drain / wired-AND bus (sim-core).**
Two open-drain outputs on one net with a pull-up resistor to the rail: assert the
net is high only when **both** release, and low when **either** pulls — a wired
AND. Assert node voltages stay finite (no singular row), the same robustness the
floating-input test guards (`gate_floating_input_reads_low`,
`crates/sim-core/src/lib.rs:4994`). This is failure case (c).

**4. Reproducibility per family (sim-core — the golden gate).**
Clone `gate_run_is_reproducible` (`crates/sim-core/src/lib.rs:4938`) **per
family** and for any new element (level shifter, open-drain): run 1000 ticks,
XOR-fold the snapshot hash, assert `run() == run()`. For Phase 3, additionally
assert that a digital-only sub-circuit reproduces *after the hash starts
including digital levels* — and that a **rewind-and-replay** lands on the
identical hash (the `docs/determinism.md` keyframe contract). Confirm the
gate-only circuit still takes the **linear fast path** in Phases 0–2
(`is_nonlinear` excludes the gate, `crates/sim-core/src/lib.rs:766`); add a test
that asserts no Newton iterations occur for a gate-only netlist.

**5. The legacy-equivalence guard (Phase 0 — protects the golden).**
A test asserting that the **legacy/ideal family reproduces the pre-change
truth-table voltages bit-for-bit** (`> 4.0` high, `< 1.0` low, exactly as
`gate_and_or_truth_tables` etc. assert today). This is the safety net that lets
Phase 0 land with **zero golden churn**; if it fails, the descriptor refactor
changed behaviour it shouldn't have.

**6. Determinism stress for the Phase 3 scheduler (sim-core).**
A ring oscillator and a multi-gate combinational mesh with feedback: assert it
oscillates (doesn't deadlock) — already the design intent
(`crates/sim-core/src/lib.rs:406-408`) — and that the event order is a pure
function of element index by running the same netlist with elements submitted in
a different *internal* evaluation order should be impossible (order is fixed),
but a test that two structurally-identical builds hash-match guards against an
accidental hashed-collection iteration. Explicitly assert **no float-keyed
priority queue** is on the digital path (a code-level review item, not a runtime
test, but call it out in the PR).

**7. Front-end checks (web).**
- **Inspector correctness:** the noise-margin readout shows the right
  `V_OH − V_IH` for the selected family (a unit test on the `gateInfo` derived
  rows, `web/src/lib/partInfo.ts:113`).
- **Forbidden-band surfacing:** a node driven into `(V_IL, V_IH)` renders the
  amber/ringed "indeterminate" affordance from `incomplete-circuits.md`, not a
  confident level — verifiable in a Vitest/component test that feeds a synthetic
  snapshot.
- **No new boundary crossing:** confirm the logic visualisation reads only the
  existing batched `state()`/`element_currents()` snapshot (golden rule #2) — a
  grep/review check that nothing calls across the wasm boundary per gate.
- The standard gates (`pnpm -C web check / lint / build`) must stay green; the
  `GATE_AUX` table (`web/src/lib/netlist.ts:116`) must list every code the core
  now expects (close the XNOR/BUF gap if §3 open-question 6 says so).

**8. Manual / visual debugging.**
Use the existing examples as live probes: `logic-inverter`
(`web/src/lib/examples.ts:1532`) and the `manual-switch-led` / AND-interlock /
XOR set (`TODOS.md`) become the eyeball test for "does a real-family gate still
light the LED, and does the margin badge read sensibly." Add a deliberately
**marginal** example (a divider putting an input at ~`V_IH`) so the forbidden-band
warning has somewhere to fire on the board — turning the failure case into a
teaching demo.

---

## 5. Summary

The gate's whole problem is one conflated parameter: `value` is simultaneously
`V_IL`, `V_IH`, `V_OL`, and `V_OH`, so a logic level can only ever be "the rail
or zero." The fix is not one big leap to the architecture doc's event-driven
digital engine, but a phased path: **(0)** introduce a logic-family descriptor
defaulted to a legacy-ideal family so the golden is untouched; **(1)** let gates
adopt real families (TTL/CMOS/LVCMOS) with honest `V_IL/IH/OL/OH`, asymmetric
drive, and an open-drain mode — a deliberate golden regeneration; **(2)** surface
noise margins, forbidden-band warnings, and a first-class level-shifter part
(mostly presentation, golden-neutral, plus one golden-additive type); and **(3)**,
only when digital circuits get big, lift the pure-digital interior into a separate
**deterministic** event scheduler (the analog↔digital barrier made literal),
which is the one step that changes the snapshot hash and carries real risk. The
boundary stays coarse throughout (digital levels are just more bytes in the
existing once-per-frame snapshot), and every stage turns one of the owner's
failure cases — mixed rails, divided inputs, open-drain buses — into a lesson
rather than a silent wrong answer.

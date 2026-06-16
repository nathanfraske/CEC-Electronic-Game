# Multi-rate domains — deterministic mixed-signal timing

Status: **architecture note** (2026-06-16). Forward-looking — this lands when the CPU
(`uC`), FPGA fabric (`FP`), and ADC/DAC/comparator parts arrive. It builds directly on the
digital scheduler (`docs/ui/logic-analog-digital-nets.md`) and the analog/digital net
classification already in `sim-core`.

## The problem

Different parts of a circuit live on wildly different timescales. A GHz CPU or FPGA wants
nanoseconds; an analog power / audio / sensor network settles over microseconds to
milliseconds. We can't run the whole simulation at 1 ns (infeasible — billions of solves),
and we can't pick the step adaptively from the signals, because that would break the
deterministic golden that the whole engine rests on (`docs/sim/determinism.md`). So: how do
we host multiple timescales in one sim **and** stay bit-for-bit reproducible?

## The crucial distinction: multi-rate ≠ adaptive

These get conflated; they are opposites for our purposes.

- **Adaptive timestepping** (what SPICE/LTspice do) chooses the next Δt from the *solved
  values* — local truncation error, which depends on the voltages this instant. Two machines
  with different float rounding pick different steps and diverge. **Non-deterministic — off
  the table.**
- **Multi-rate** runs different domains at different *fixed* rates that are all integer
  ratios of one common base tick. The schedule is fixed by the circuit's **structure** at
  build time, completely independent of the solved values. **Deterministic.**

So "a GHz block and a µs block in the same sim" is fine. "Shrink the step because a voltage
spiked" is not. The rule: timing may depend on **structure**, never on **values**.

## Two kernels, one boundary

The fast stuff that wants nanoseconds isn't analog at all — it's *digital*: quantized 0/1
logic that advances on clock edges as discrete events, not an ODE you integrate. So we split
the engine the way every real mixed-signal tool (Verilog-AMS, Cadence AMS) does:

- **Continuous analog kernel** — the MNA matrix solve at **one fixed Δt** (µs scale). Never
  sped up for digital; the analog golden's Δt never changes.
- **Discrete digital kernel** — event-driven logic at its own resolution. A digital block
  declares its clock; the event engine **sub-steps a fixed integer number of times per analog
  tick**. 1 GHz against a 2 µs analog tick is exactly **2000 digital sub-ticks** — a fixed
  ratio derived from the declared rate, not from any voltage. A CPU/FPGA is a behavioral
  (cycle-stepped) state machine or gate-level digital logic, **never in the analog matrix**.
- The two kernels meet **only at boundary nets**.

We are already half-built for this. `sim-core` has `classify_nets` / `NetClass`
(Analog / Digital / Boundary), the unit-delay event engine (`eval_digital`, `stamp_digital`,
`commit_net_levels`), and the level-bearing snapshot hash. The digital domain already runs as
a separate event layer over the analog solve; multi-rate is the extension where that layer can
tick faster than the analog Δt by a fixed integer.

## The boundary IS a real device (the elegant part)

You cannot turn analog into digital by fiat. In hardware you must pass the signal through a
physical converter — an **ADC**, a **comparator**, a **Schmitt trigger**, a logic **buffer**.
That device samples a continuous voltage and emits a discrete level. In the sim, that is
*exactly* the boundary net: analog at one terminal, digital at the other, sampled at the
digital domain's clock.

So the domain crossing is **not an artifact we impose — it's a component the user must place.**
An **ADC literally is the boundary layer**: feed analog in one end, get a digital word out the
other, at its sample rate. A comparator or Schmitt trigger is the 1-bit version of the same
thing. This makes the architecture physically honest in a way that falls out for free:

- There is no "magic" analog→digital crossing anywhere a converter isn't placed — just as in
  reality, where a bare wire from an op-amp to a logic input is either a comparator-by-accident
  or a bug.
- The converter's **sample rate sets the digital domain's view of the analog** — so
  quantization, sample-and-hold, and aliasing emerge naturally from the same mechanism instead
  of being bolted on.
- It has real teaching value: you learn that to get a microcontroller to "see" a sensor you
  *need* an ADC (or at least a comparator), because the sim makes you cross the boundary the
  same way the bench does.

Going the other way, a **DAC** (or a logic output driving an analog net through its output
impedance) is the digital→analog boundary: the held digital word becomes a voltage the analog
kernel integrates at its Δt.

## Determinism guarantee

- Every domain rate is a fixed integer multiple of one base tick (the GCD of all rates).
  Sub-step counts come from declared structure, not from values.
- The analog MNA's Δt never changes, so the analog golden and every `*_run_is_reproducible`
  stay bit-identical.
- Cross-domain sampling happens at fixed tick boundaries: the digital kernel reads a boundary
  voltage at a fixed sub-tick of the analog step; the analog kernel reads the held digital
  level at the analog step. A fixed schedule → reproducible.
- The snapshot hash already folds `tick` + per-net `Level` + sequential state; it extends to
  fold the digital sub-tick counter and boundary state as integers. New clock-domain circuits
  get their own reproducibility coverage; the existing goldens are untouched.

## What we deliberately do not do

- Run the analog MNA at 1 ns — infeasible, and pointless (the analog doesn't care about
  nanoseconds).
- Adaptive Δt of any kind (value-dependent → non-deterministic).
- **Pure-analog** multi-rate — partitioning a fast analog mesh from a slow one into two coupled
  MNA solves at different fixed Δt's. It *is* deterministic if the partition and ratios are
  fixed, but it's heavy machinery (system partitioning, inter-mesh coupling, interpolation) we
  almost certainly never need — because the things that want nanoseconds are digital, and
  digital we handle with the event kernel, not the matrix.

## Build path (forward-looking)

Lands with the CPU/FPGA/ADC tier. Sketch, in dependency order:

1. **Digital clock domains** — a digital block declares a clock rate; the event engine
   sub-steps a fixed integer count per analog tick. Generalizes the current one-tick unit
   delay (which is the special case of one digital sub-tick per analog tick).
2. **Boundary converter parts** — `ADC` (analog → digital word at a sample rate), `DAC`
   (digital word → analog voltage), `comparator` / `Schmitt` (analog → 1-bit), `buffer`. Each
   is a Boundary net with a declared sample point. These are the *only* sanctioned
   analog↔digital crossings.
3. **Behavioral CPU / FPGA blocks** — cycle-stepped state machines in the digital kernel, with
   I/O exclusively at boundary pins. (Gate-level is possible but behavioral is the practical
   default at GHz.)
4. **Hash + reproducibility** — fold the sub-tick counter and boundary state; add multi-rate
   golden coverage.

See also: `docs/ui/logic-analog-digital-nets.md` (the digital scheduler this extends),
`docs/sim/determinism.md` (the contract this must preserve), and
`docs/sim/ideal-vs-real-parts.md` (fidelity progression — ADCs/comparators are themselves
parts with ideal→real fidelity, e.g. finite resolution, sample jitter, input offset).

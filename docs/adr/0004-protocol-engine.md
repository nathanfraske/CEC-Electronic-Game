# ADR 0004: The protocol / behavioral engine

Status: accepted (design + phase 1 underway)

## Context

Serial buses (SPI / I2C / UART), the behavioral CPU (`uC`) and FPGA fabric (`FP`)
placeholders, and the serial ADC/DAC chips (ADC081S021 SPI, MCP4725 I2C) all need a
**behavioral / protocol engine** — clocked state machines that run beside the analog
solve and talk to it only at boundary pins. The forward-looking design is
`docs/sim/multi-rate-domains.md`; this ADR makes it a decision and sets the phased build.

## Decision

Build the protocol engine as **two kernels meeting at a boundary**, exactly as
`multi-rate-domains.md` lays out:

- **Continuous analog kernel** — the MNA solve at the fixed `DT = 2µs`. It is **never**
  sped up; the analog golden's Δt never changes.
- **Discrete digital / behavioral kernel** — clocked state machines (gates, the DFF, and
  new **behavioral blocks**) that advance as discrete events. The current one-tick unit
  delay is the special case "one digital sub-tick per analog tick"; multi-rate generalizes
  it so a block may sub-step a **fixed integer** count per analog tick, derived from its
  **declared clock rate (structure)**, never from solved values.
- The two kernels cross **only at boundary nets**, which are **real placed converters** —
  an ADC / comparator / sampler (analog→digital) or a DAC / driven output (digital→analog).
  There is no magic crossing; `ELEM_COMPARATOR` and `ELEM_SAMPLER` are already two of them.

A **behavioral block** is a new element type (`ELEM_BEHAVIORAL`) carrying a small
fixed-size block of **integer** internal state (the state-machine state + shift registers +
counters) and a **program id** (a scalar selecting which protocol/firmware it runs). Each
tick (later: each sub-tick) it runs a deterministic step: read its input-pin levels, advance
its state, drive its output-pin levels through the existing digital-drive machinery. Specific
protocols (SPI master/slave, UART, I2C, a tiny MCU) are programs dispatched by the id — one
engine, many behaviors, the way `PULSE`/`SHUNT`/`LOAD` overload an existing element.

## Determinism guarantees (the contract this must preserve)

- **Structure, not values.** Every domain rate is a fixed integer multiple of the base tick;
  sub-step counts and baud dividers come from declared params, never from a voltage. (Adaptive
  Δt is off the table — non-deterministic.)
- **Analog Δt fixed** → the analog golden and every `*_run_is_reproducible` stay bit-identical.
- **Integer state only** in behavioral blocks (no float-state, no PRNG, no std hasher); folded
  into `snapshot_hash` in fixed element + word order, **appended after** the existing folds and
  **defaulting to zero**, so a circuit with no behavioral block (the RC golden, every existing
  test) folds zero extra bytes and the golden — `0xeaac_3764_99e4_fa24` — is byte-identical by
  construction. The sub-tick counter (phase 2) folds the same way.
- Cross-domain sampling happens at fixed tick (later: sub-tick) boundaries — a fixed schedule,
  reproducible.

## Phased build path (dependency order)

1. **Boundary converters** — DONE: `ELEM_COMPARATOR`, `ELEM_SAMPLER` (analog→digital); R-2R
   DAC composition (digital→analog); `ELEM_ASWITCH` for the S&H front end.
2. **Behavioral block + first protocol (phase 1, now):** `ELEM_BEHAVIORAL` (integer state +
   program-id dispatch + digital I/O + hash fold) at the **base tick rate**, with the first
   program a **SPI master** (assert CS, shift a configured word out on MOSI clocked by SCLK at
   a structural divider, sample MISO). Slow but functional; proves the engine end to end.
3. **Multi-rate sub-ticking (phase 2):** the event kernel sub-steps a fixed integer count per
   analog tick (a block declares its rate). Generalizes the 1-tick delay; folds the sub-tick
   counter. This is what lets protocols/CPUs run at MHz against the µs analog tick.
4. **More protocols + endpoints (phase 3):** SPI slave (→ the serial DAC081S101 / ADC081S021),
   UART (async framing + a baud divider — works at the base rate too), I2C (the open-drain +
   pull-up wired-AND bus is already half of it).
5. **Behavioral CPU / FPGA (phase 4):** larger cycle-stepped state machines / a tiny ISA at the
   `uC`/`FP` pins, on the sub-tick kernel.

## Notes

- Keep the JS↔wasm boundary coarse (ADR 0001): behavioral state lives in sim-core; the program
  id + config ride in `value`/`aux`/`params`; the wider 8-terminal format (ADR 0002) gives a
  behavioral block enough pins (SCLK/MOSI/MISO/CS + START + VCC/GND).
- Fidelity progression (`docs/sim/ideal-vs-real-parts.md`): converters/protocols get an
  ideal→real axis later (finite resolution, sample jitter, setup/hold) — out of scope here.
- The behavioral block is the M8 mechanism; sub-ticking is M7 (the exhaustive catalog). Phase 1
  delivers M8 at the base rate so the harder M7 step-loop change is isolated to phase 2.

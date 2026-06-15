<!--
  SPDX-License-Identifier: Apache-2.0
-->

# Parts roadmap — ideal circuit elements

A short audit of the basic ideal elements we could add to the solver, sorted by
how well the existing **linear MNA + backward-Euler** core can carry them. The
core today assembles one fixed-size dense system per netlist and solves it in a
single non-iterative pass (see `crates/sim-core/src/lib.rs` and
`docs/architecture.md`). "Clean today" means: a linear stamp that fits that one
pass with no iteration, no per-element interaction state, and no change to the
determinism contract.

## Element set today

| type | tag | element           | model                                   |
| ---- | --- | ----------------- | --------------------------------------- |
| 0    | V   | DC voltage source | MNA branch augmentation                 |
| 1    | R   | resistor          | conductance `1/R`                       |
| 2    | C   | capacitor         | backward-Euler companion                |
| 3    | L   | inductor          | backward-Euler companion (branch)       |
| 4    | I   | DC current source | KCL right-hand-side injection (**new**) |

Plus **GND** — a 1-pin reference part, not a solver element (it only pins a net
to node 0). It is absent from `TYPE_OF`, so the netlist element loop skips it.

## What the linear core can do cleanly today

These are pure linear stamps that drop straight into the existing assembly with
no new machinery:

- **Ideal DC current source (`I`)** — _implemented._ The dual of `V`: a KCL RHS
  stamp `rhs[a] -= value; rhs[b] += value` in both `solve_operating_point` and
  `solve_into_readout`. No branch unknown, no reactive state. Its committed
  current is the forced `value`. **Sign:** the arrow points `a -> b`; a positive
  `value` draws current out of node `a` and delivers it into node `b`.
- **Explicit ground (`GND`)** — _implemented._ A 1-pin reference. `buildNetlist`
  now grounds on an explicit `GND` part's net if present, else the prior
  fallback (first voltage source's `−` pin). This is what makes
  current-source-only loops simulatable, since such a loop has no `V` to borrow
  a reference from.
- **Short / ideal wire** — already expressible as a 0 V source or just a wire in
  the union-find; not worth a distinct part.
- **Linear VCVS / VCCS / CCCS / CCVS (controlled sources)** — linear, so each is
  a fixed stamp coupling two branches/nodes. Clean in principle, but they need a
  **two-port placement UX** (pick the sensing pair and the driven pair), which
  the current two-terminal board model does not express. Deferred on UX, not on
  math.

## What needs future work

- **Diode / LED, BJT, MOSFET** — nonlinear `i(v)`. The single-pass linear solve
  cannot represent an exponential or a square-law device; these need a
  **Newton–Raphson outer loop** with companion linearization per iteration,
  plus a convergence-and-determinism story (fixed iteration cap, stable
  tie-breaks). This is the main missing engine capability.
- **Switch / push-button / relay (stateful click-to-toggle)** — trivial as a
  stamp (open = skip, closed = 0 V source), but it introduces **interactive,
  stateful, per-element UI state** (a click toggles conduction) and a topology
  change mid-run. Needs an interaction + netlist-invalidation path before it is
  worthwhile.
- **AC / time-varying source** — easy as a stamp (RHS varies with `tick * DT`),
  but it implies a presentation story (frequency vs. the fixed `DT`, phase
  readout) that should be designed deliberately rather than bolted on.
- **Transformer / coupled inductors, ideal op-amp** — expressible with extra
  branch constraints, but each wants the same two-port placement UX as the
  controlled sources, and the op-amp wants a saturation model to be useful.

## What was implemented in this pass, and why

`I` and `GND` were the two highest-value additions that the **linear core
already supports with zero new solver machinery** and that unlock a genuinely
new circuit class (current-driven loops) the player could not build before. A
`GND` + `I` + `R` loop now simulates: the current source drives a resistor to
ground and develops `I * R` across it.

Both follow the existing animated-glyph approach: `I` is a circle with a
direction arrow whose flow tracks its set current (palette `warn`); `GND` is the
three-bar reference symbol (palette `dim`). Wired end-to-end through
sim-core → netlist → graph → glyph → bin, with the JS↔wasm boundary unchanged
(`set_netlist` already passes opaque types/values). The RC golden uses only
V/R/C and is unchanged.

New sim-core tests cover the current source: `I*R` across a resistor with an
asserted sign, KCL at every node, terminal-flip sign reversal, and a
constant-current capacitor ramp. The golden (`0x6d055513f0613902`) and
`run_is_reproducible` stay green.

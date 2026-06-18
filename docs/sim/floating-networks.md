<!-- SPDX-License-Identifier: Apache-2.0 -->

# Floating networks and the Rogowski coil

Status: **design** (2026-06-17). Forward-looking. Answers the owner question
"can we simulate a floating network, such as a Rogowski coil?" Builds on the MNA
core (`crates/sim-core/src/lib.rs`), the netlist's single-ground model
(`web/src/lib/netlist.ts`), and the existing magnetic coupling in the transformer.
Must honour `docs/determinism.md`.

## TL;DR

Yes — but it is a **`sim-core` feature in two parts**, not a web change:

1. **Floating-component reference** (small, broadly useful). The netlist picks **one
   global ground**; a subnetwork with no galvanic path to it has an undefined
   *common-mode* potential → the MNA matrix is singular in that one degree of freedom.
   The fix is the trick the engine already uses for floating op-amp/MOSFET inputs:
   stamp one `GMIN` to ground per floating connected component. This makes **any**
   isolated subnet solvable — a transformer secondary left floating, an isolated
   sensor, the Rogowski output.
2. **A current-sense / Rogowski element** (larger). Magnetic coupling already exists
   (the transformer), and its reactive secondary already produces a `dI/dt`-shaped
   output. A faithful Rogowski adds: sense a *pass-through* conductor's current without
   loading it, and force `V_out = M·dI/dt` onto an isolated winding.

Part 1 is the prerequisite and a standalone win. Part 2 sits on top.

## Part 1 — floating networks

### Why it's not free today

The netlist (`netlist.ts:273`) chooses a single ground node (node 0): a wired `GND`
part if present, else the first voltage source's `−` pin; with **no** reference it
refuses to simulate (`return null`). Every other node is numbered relative to that one
node, and the solver excludes node 0 from the unknowns (`x = [v(1), …, v(n−1)]`,
`lib.rs` module header). A connected component that never touches node 0 therefore has
**no equation fixing its absolute potential** — only the differences within it are
determined. In MNA that is a singular row.

The solver does not crash on it (dense Gaussian elimination with a **deterministic
zero-pivot fallback**, plus the `FAIL_LIMIT` clamp from `ideal-vs-real-parts.md`), and
the **differential** answers inside the floating subnet (voltage across a part, current
through it) come out physically correct. But the subnet's common-mode is pinned
arbitrarily (effectively 0), which is fragile and not something to build a feature on.

The existing **incomplete-circuit check** (`netlist.ts:502`) only handles the dual case
— an ideal *current source* with no return path — by zeroing it. It does **not** give a
floating passive subnet a reference.

### The fix: one `GMIN` per floating component

The engine already pins otherwise-undefined nodes with **`GMIN = 1e-12 S`**
(`lib.rs:1120`), stamped at op-amp inputs and MOSFET gates precisely so "a floating
input is non-singular." Generalise it from *nodes* to *components*:

1. Union-find every node over every element that conducts between its terminals (the
   same traversal the incomplete-circuit check already builds, `netlist.ts:507`).
2. The component containing node 0 is the **referenced** one. Every **other** component
   gets a single `GMIN` from its lowest-index node to ground — a weak common-mode tie
   to ~0 V.

That removes the singular degree of freedom without disturbing the physics (1 pS is
twelve orders below any real conductance), exactly as GMIN does at a gate today.

**Determinism.** `GMIN` is a fixed constant and "the lowest-index node of each floating
component" is a deterministic choice, so a given netlist reproduces bit-for-bit
(`docs/determinism.md`). **Golden impact:** a *grounded* circuit has exactly one
component (the grounded one) → no extra stamp → its readings and the analog golden are
**unchanged**. Only circuits that *currently* contain a floating subnet change (from the
zero-pivot fallback to a clean common-mode-zero solve), and those get their own
reproducibility coverage. This is the same "additive, golden-safe" shape as the Real
parasitics in `ideal-vs-real-parts.md`.

**Where to stamp.** Cleanest in the **netlist build**: it already computes the
connected components and owns node numbering, so it can hand the solver a short list of
"reference these nodes with GMIN" (a new array across the wasm boundary, or fold into
`aux`). Keeps `sim-core` dumb about topology.

### What it unlocks beyond the Rogowski

- A **transformer secondary** that drives an isolated load with no ground tie (today it
  leans on the zero-pivot fallback).
- **Galvanic isolation** in general: isolated DC-DC, opto-isolator output stages,
  instrumentation-amp front ends, an isolated sensor with its own local return.
- The honest version of "this side of the circuit floats relative to that side," which
  is a real and teachable concept (why you need a ground reference, what a floating
  measurement is, why scope-probe grounds matter).

## Part 2 — the Rogowski coil

### What it is

An air-cored (non-magnetic) toroidal winding **clipped around** a conductor. It is a
current *transducer*: the changing current threads the toroid, the coil sees the flux
rate, and its open-circuit EMF is `V = M·dI/dt` (M = mutual inductance, set by the
turns and geometry). Two properties define it:

- **It does not load the measured circuit.** The conductor just passes through; the coil
  adds (ideally) no series impedance. This is the opposite of a current-shunt resistor.
- **Its output is `dI/dt`,** galvanically **isolated** from the measured circuit. To
  read the *current* you integrate the output (an op-amp integrator — which the engine
  already has). Rogowski coil **+ integrator = a non-intrusive current probe**, the
  thing they put around fat AC bus bars and CT-unfriendly conductors.

### What the engine already gives us

- **Magnetic coupling.** The transformer (element type 18) is a real coupled-inductor /
  ideal-T: separate primary/secondary windings, galvanically isolated, the secondary EMF
  *forced* to `n·V_Lm` where `V_Lm = L₁·dIₘ/dt`. So a coupled winding whose output is
  proportional to `dI/dt` is **already in the box** — that is most of a Rogowski.
- **The `dI/dt` machinery.** Backward-Euler companions for L and the transformer already
  carry the per-step current difference deterministically; a sense element reuses it.
- **The integrator.** An op-amp + R + C is a standard integrator, so the "recover I"
  half is just a sub-circuit the player builds — which is good teaching.

### What a faithful model adds

The transformer is *almost* it but wrong in two ways for a current probe: its primary is
a 2-pin winding you wire **in series** (it breaks the conductor and inserts the
magnetising inductance), and it is a power element, not a sense. A faithful Rogowski is a
**non-loading current-sense, derivative source**:

- **Senses a pass-through branch.** The measured conductor stays a normal wire in the
  main circuit; the coil names *which branch's current* it encircles (a designated
  sense branch — e.g. a 0 Ω current-sense element the conductor runs through, or the
  coil's two "clip" pins clamp around a wire and the netlist resolves the enclosed
  branch). The coil adds ~no impedance to that branch.
- **Forces `V_out = M·dI/dt`** onto an isolated 2-pin output winding, where `dI/dt` is
  the backward-Euler difference of the sensed branch current. This is a
  *current-controlled, derivative voltage source* — a primitive the engine doesn't have
  yet but that stamps like the transformer's hard secondary (a forced differential)
  with the controlling quantity being a branch current's time-derivative.
- **The output floats** (no galvanic tie to the measured circuit) → needs Part 1.

So: a new `ELEM_ROGOWSKI` (sense branch ref + isolated output winding, value = M), built
from the transformer's secondary-EMF stamp + the inductor's `dI/dt` companion + the
Part-1 floating reference.

### Fidelity tiers (per `ideal-vs-real-parts.md`)

- **Ideal Rogowski:** perfect `V = M·dI/dt`, zero insertion impedance, infinite input
  resistance, flat response.
- **Real Rogowski:** the coil's own self-inductance and terminating resistor set a
  bandwidth (low-frequency droop without integration, HF resonance), finite mutual
  coupling, position sensitivity, and the integrator's offset/drift (the classic reason
  real Rogowski probes can't measure DC and drift on a steady current).

## Build order

1. **Floating-component `GMIN`** (Part 1). Small, self-contained, golden-safe, and it
   immediately benefits the transformer secondary and any isolation circuit. Do this
   first regardless of the Rogowski.
2. **`ELEM_ROGOWSKI`** (Part 2): the branch-current sense + `M·dI/dt` forced output, on
   top of Part 1. Ideal variant first; Real bandwidth/droop later.
3. **Reproducibility + golden.** Both are new behaviour for new configurations; add
   `floating_run_is_reproducible` and `rogowski_run_is_reproducible` and keep the
   existing analog golden untouched (grounded circuits are unaffected by Part 1; the
   Rogowski is a new element).

## See also

- `docs/determinism.md` — the contract both parts must preserve.
- `docs/sim/ideal-vs-real-parts.md` — the ideal→real fidelity ladder these parts ride.
- `docs/sim/fidelity-ceiling.md` — where coupled/floating/sense elements sit on the
  bigger "how real can the solver get" map.
- `docs/sim/transformer-bridge-convergence.md` — the coupled-inductor stamp this reuses.

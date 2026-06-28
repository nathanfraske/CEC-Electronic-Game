<!-- SPDX-License-Identifier: Apache-2.0 -->

# Transistor-scale Newton convergence — the "CLK changes my ALU result" bug

**Status:** root-caused (2026-06-28). The headline cause is now proven with hard numbers; the fix has
two complementary paths (one golden-safe and already in the backlog, one golden-sensitive and optional).
See also `fidelity-ceiling.md`, `cell-characterization-and-integration-hierarchy.md`, and
`docs/ui/test-bench-design.md`.

## The report

The owner's 4-BIT FULL ALU (a hand-built, hierarchical CMOS design) produced **wrong, CLK-dependent**
results: e.g. `AND(6,2)` read `6` (= A) instead of `2`, and the wrong value changed when the clock pin
was toggled — even though the clock electrically feeds **only** the FLAG REGISTER, which is isolated from
the combinational datapath. The corruption appeared **only at the full-ALU scale**; a minimal inverter +
DFF repro was clean.

## Root cause (proven)

**The ALU flattens to 548 discrete MOSFETs, and the engine's nonlinear solver cannot converge on a
transistor-level network that large.** It is a numerical (solver) failure, not an electrical-coupling or
node-merge bug.

The deterministic core (`crates/sim-core`) routes any netlist containing a nonlinear device
(`is_nonlinear` = diode / MOSFET / BJT / varistor / op-amp) through a **seeded Newton-Raphson**
operating-point solve each tick (`solve_into_readout_newton` → `newton_iterate`,
`NEWTON_MAX_ITERS = 100`). On non-convergence it **settles to the last iterate** — a defined, finite, but
*garbage* result. The Newton seed each tick is the **previous tick's `node_v`** (lib.rs ~4727).

Headless measurements on the owner's save (`873c4c88…json`), driven through `buildNetlist` + a scratch
`Simulation` (the wasm core runs in node via `initSync` — see "Tooling" below):

| build | nodes | elements | nonlinear | Newton result |
| --- | --- | --- | --- | --- |
| 4-BIT FULL ALU, raw transistors | 271 | 563 | **548 MOSFETs** | `iters = 100, converged = false` **every tick** |
| same, all inputs = 0 | 271 | 563 | 548 | converges (9 iters) — a *trivial* operating point |

The solve is **fragile**, not cleanly size-gated. Convergence flips with the input pattern *and* with a
trivial perturbation (a 1 GΩ output sense resistor):

| input pattern | no sense R | with sense R |
| --- | --- | --- |
| all zeros | converges (9) | converges (1), R=15 |
| all ones | **fails (100)** | converges (1), R=0 |
| A=6 B=2, ctrl 0 | converges (20) | **fails (100)**, R=9 |
| A=6 B=2, M=1 | **fails (100)** | **fails (100)** |

This is the textbook signature of a high-gain CMOS DC solve with **no globalization** (no gmin stepping,
no source/supply stepping, no damped/line-search Newton): it sits on the ragged edge — many operating
points hit the iteration cap and emit the last iterate, and some that *do* converge land on a **wrong**
DC point (all-zeros → R=15).

### Why "CLK changes the result"

The wrong output is the **non-converged last iterate**, and the iterate depends on the Newton **seed** =
the previous tick's `node_v`. The flag register's transistors sit in different states for CLK = 0 vs
CLK = 1, so the seed differs, so the garbage differs. The datapath nets are genuinely electrically
isolated; the coupling is **numerical**, through the shared, non-converged solver — which is exactly why
the earlier black-box passes (correctly) found "no node-merge, the core stamps verbatim" yet still saw
coupling. Toggling CLK perturbs a solve that never settled.

### Why "only at scale"

Every sub-cell converges in **1 iteration** on its own: Inverter (2 FETs), NAND (4), AND (6), XOR (16),
FULL ADDER (50), even the 4-BIT RIPPLE ADDER (200 FETs). The convergence cliff is between those and the
assembled 548-FET ALU with its flag-register feedback. The minimal repro was clean because it was below
the cliff.

## Why the owner's design hit it

The ALU **design is correct** (see the fix below — the logic ops compute bit-exact). The trigger is a
**workflow gap**, not a design error:

- **9 of 21** library cells already carry a characterized `behavior` (the LUT face): XOR, OR, NOR,
  Inverter, NAND, AND, 2:1 MUX, 1-BIT LOGIC, ZERO DETECT.
- **0 of 58** nested instances opt into `fidelity: 'behavioral'`. A placed instance collapses to its
  cheap LUT in `flattenUserIcs` **only when its def has `behavior` AND the instance is set to behavioral
  fidelity** (`web/src/lib/userIc.ts`). Default fidelity is `'full'` → every instance inlines its real
  transistors → the whole ALU flattens to 548 raw FETs.

So the characterization exists but is never *used*: the chip is simulated as if it were 548 loose
transistors solved simultaneously.

## The fix

### Path A — use the characterization (golden-safe, recommended, already backlog #35)

Opt the nested instances into their existing behavioral LUTs. Proven headless on the owner's ALU
(flip every nested user-IC instance to `fidelity: 'behavioral'`, then rebuild):

| | raw transistors | behavioral LUTs |
| --- | --- | --- |
| flattened elements | 271 nodes, 548 MOSFETs | 138 nodes, **34 LUTs, 0 MOSFETs** |
| solver | Newton, `iters=100`, **non-convergent** | **linear single pass, `iters=0`** (Newton never runs) |
| `AND(6,2)` (SEL=11) | garbage (R=9) | **R=2 ✓** |
| `OR(6,2)` / `XOR(6,2)` / `NOT A` | garbage | **R=6 / 4 / 9 ✓** |

A LUT (`ELEM_BEHAVIORAL`) is linear/digital, so a fully-characterized hierarchy takes the linear path
(`has_nonlinear == false`) — no Newton, no convergence risk, and the whole ALU sweep runs in ~1 s headless.
This is the project's intended scaling path (`cell-characterization-and-integration-hierarchy.md`): you
**cannot** build a CPU as one transistor-level Newton system (tens of thousands of FETs) regardless of
solver quality — characterize bottom-up and compose the LUTs.

The missing UX is **backlog #35**: a recursive "use behavioral fidelity" / "collapse to characterized"
action that, for any selected cell, sets `fidelity: 'behavioral'` on every nested instance whose def has a
valid `behavior`. Golden-safe (web-only; the golden places no user IC). Without it, a deep hierarchy is
impractical to opt in by hand — which is exactly why this ALU ran as raw transistors.

> Note: the **logic** ops verify bit-exact. The **arithmetic** ops (M=1) read 0 for every SEL/Binv/Cin
> in the configs tried — a *converged* result (`iters=0`), so it is **not** the engine bug. It is either
> an ALU control-encoding detail (M/SEL/Cin) not matched in the test, or a stale/incorrect `behavior`
> word on an arithmetic-only sub-gate (the adder carry path / output-mux select). Flagged for the owner;
> outside the scope of the convergence bug.

### Path B — make raw transistor-level converge (golden-sensitive, optional)

Add Newton **globalization** so large CMOS converges directly: gmin stepping and/or source (supply)
stepping, plus damped / line-search Newton. This is the standard SPICE answer and would let modest
transistor-level circuits scale, but it **changes `node_v` trajectories on every nonlinear transient → it
moves the golden** (`0xeaac_3764_99e4_fa24`) → regenerate per `docs/determinism.md`, with the rationale in
the PR. It is also a real undertaking and never scales to a CPU (Path A is still required there). Treat as
a robustness improvement for small/medium raw-transistor designs, **only with explicit owner greenlight**.

## Tooling added (golden-safe)

- **`Sim::last_newton_iters()` / `last_newton_converged()`** (sim-core) and **`Simulation.newton_iters()` /
  `newton_converged()`** (sim-wasm): read-only telemetry recording the most recent nonlinear solve's
  iteration count and whether it converged. Never folded into `snapshot_hash`, never read by the solve —
  verified golden-stable (`run_is_reproducible`, `golden_snapshot_hash_is_stable` both pass). A linear
  netlist never runs Newton, so `iters` stays 0 / `converged` true. This is the engine half of the
  test-bench "did it finish thinking?" detector (`docs/ui/test-bench-design.md`).
- **The wasm core runs headless in node** via `initSync({ module: <bytes> })` — `characterize.ts` /
  `sequentialTrace.ts`'s "APP-ONLY, can't run headless" caveat is obsolete. This unlocks deterministic,
  browser-free drive→step→read→compare tests (the test-bench engine, and the measurements in this doc).

## Takeaways

1. The ALU design is sound; the engine cannot solve it as raw transistors at scale.
2. The "CLK coupling" is a symptom of Newton non-convergence (seed = prior `node_v`), not electrical.
3. The unlock is **using** the characterization that already exists (backlog #35) — the scalable path to
   a CPU. Raw-transistor globalization (Path B) is an optional, golden-sensitive nicety.

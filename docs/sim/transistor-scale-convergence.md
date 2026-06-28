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

## Latch metastability — a separate axis (the power-up symmetry break), LANDED 2026-06-28

Convergence (can the solver find *a* root for N transistors?) is **not** the same problem as
**metastability** (does a symmetric bistable cell pick a *definite* bit?). #88's gmin stepping fixed
the former; this fixes the latter. They are orthogonal: a 2-transistor-pair latch converges fine yet
still has *three* DC roots — two stable rails and an **unstable metastable midpoint** — and the damped
Newton OP solve, seeded from the all-zeros `node_v` (dead on the cell's symmetry axis), lands squarely
on the midpoint. So an unwritten transistor 6T SRAM / flip-flop powered up to `Q ≈ Q̄ ≈ VCC/2` mush
instead of a real bit. (The *write* path always worked — external bit-line drive forces the whole state
to a rail, which then holds; only the **unwritten power-up** was stuck.)

**Measured facts that shaped the fix** (headless, `cross_coupled_latch` in `lib.rs`):
- A symmetric cell sits at *exactly* the midpoint (`Q = Q̄ = 2.500`).
- A static **Vth mismatch alone does not escape it** — a +10 mV offset only *shifts* the midpoint root
  to `(2.500, 2.505)`; Newton from the symmetric seed converges right back to the (shifted) midpoint.
  The midpoint stays a root for any realistic mismatch; eliminating it would need an unphysical skew.
- The decisive lever is the **seed**, but the `node_v` seed feeds only Newton's convergence test — the
  device stamps linearise at the stored `mosfet_vgs`/`vds`. To bite, the bias must land on the device
  operating points, and must be **strong + self-consistent** (a whole rail state), not a small nudge.
- The near-singular latch matrix makes the solve **node-order sensitive**: one seed direction holds,
  its mirror drifts back to mid-rail (a classic latch-DC pivoting effect). So a one-shot seed can't be
  trusted — it must be retried with the flipped direction.

**The fix — `Sim::break_metastable_latches()`** (called once after the install/reset OP solve):
1. **Gate (Real mode only):** runs only if some MOSFET carries a slot-1 **threshold mismatch**. The web
   layer (`buildNetlist`) emits a deterministic per-device Vth offset `MOSFET_VTH_MISMATCH * jitter(id)`
   (±30 mV) **only in Realistic mode** — the same per-component-id deviation as resistor tolerance.
   Ideal mode emits nothing → early return → `node_v` is the untouched OP → **byte-identical**, and an
   ideal perfectly-symmetric cell stays *honestly* metastable (a real teaching point).
2. **Detect** cross-coupled pairs as **gate→drain 2-cycles** (node *u*'s inverter drives node *v*'s
   drain and vice-versa) — sorted-edge binary search, no hashing. Generalises to NAND/NOR SR latches.
3. **Seed + re-solve:** for each pair still at mid-rail, drive its two storage nodes to opposite rails
   (`0` / supply EMF), re-linearise every MOSFET from that seed, and re-solve the OP so it converges to
   and *holds* the rail. The mismatch **sign** picks the bit; a still-metastable pair is retried with
   the **flipped** direction (two attempts always suffice). `mosfet_op` also reads slot 1 (raw/signed)
   for a realistic Vth spread.

**Golden-safe by construction:** the golden RC is linear (no MOSFET) → the gate never fires → the
hash `0xeaac_3764_99e4_fa24` is untouched (`golden_snapshot_hash_is_stable` green). Slot 1 defaults to
0 for every existing Element and every Ideal-mode netlist, so they are bit-identical. Tests:
`ideal_cross_coupled_latch_is_metastable_at_midrail`, `mismatched_cross_coupled_latch_powers_up_to_a_
definite_bit`, `jittered_cross_coupled_latch_settles_to_a_clean_rail`,
`latch_metastability_break_run_is_reproducible` (sim-core); `sramPowerUp.test.ts` (web, the owner's 6T
SRAM prefab: Ideal → mid-rail, Real → a deterministic complementary bit).

## DRAM is the mirror image — capacitor leakage, not metastability, LANDED 2026-06-28

"Can we do the same for a DRAM cell?" — **no, and it doesn't need it.** DRAM is **1 transistor + 1
capacitor** (charge on a cap), not a bistable latch, so there is **no metastable midpoint**. Verified
headlessly: an unwritten transistor 1T1C cell powers up to a **definite 0** (discharged cap), and a
written cell holds the realistic NMOS-passed weak-1 (~3 V, the Vth drop) **rock-steady**. So the cell
already works as memory — the metastability break is N/A here (and the DRAM **sense amp**, a
cross-coupled latch, is already covered by `break_metastable_latches`).

The real DRAM-specific gap is the **opposite** of the SRAM one: our ideal cap **never leaks**, so a
1T1C cell read as non-volatile SRAM-on-a-cap. Real DRAM is *dynamic* — it leaks and must be refreshed.
Fixed by **capacitor leakage** (`cap_leak_g`): a Real-mode parallel `G = C/tau` stamped in the
transient companion, where `tau` (self-discharge time constant, [`CAP_LEAK_SLOT`] = 5) is emitted by
`buildNetlist` **per quality tier** (`capLeakTau`/`ecLeakTau`) — the owner's call: **all** caps leak,
proportional to reality, gated by grade (budget electrolytic leaks fast, lab-grade film ≈ ideal).
Golden-safe: `tau = 0` (Ideal, every existing cap, the **RC golden's own cap**) → no leak →
byte-identical (`golden_snapshot_hash_is_stable` green). Game-scaled (seconds; realistic ordering, like
diode `TT`) so a held cap visibly decays while filter caps (`tau ≫` their signal period) are untouched.
Tests: `leaky_capacitor_settles_at_the_insulation_divider` + reproducible (sim-core);
`dramCell.test.ts` (Real-mode emission gate + a written 1T1C cell decays in Real, holds in Ideal).

## Takeaways

1. The ALU design is sound; the engine cannot solve it as raw transistors at scale.
2. The "CLK coupling" is a symptom of Newton non-convergence (seed = prior `node_v`), not electrical.
3. The unlock is **using** the characterization that already exists (backlog #35) — the scalable path to
   a CPU. Raw-transistor globalization (Path B) is an optional, golden-sensitive nicety.
4. **Convergence ≠ metastability.** Making a transistor latch *hold a bit* is a distinct, now-landed fix
   (Real-mode mismatch → structural rail seed), orthogonal to making big CMOS *converge*.

<!--
  SPDX-License-Identifier: Apache-2.0
-->

# Incomplete circuits — reading "incomplete" instead of a fake number

Status: **draft** (design brainstorm; no code yet).

## The problem

A voltage source needs a complete loop before anything happens — lift its return
path and every current goes to zero, which *looks* like nothing because it
*is* nothing. An **ideal current source is the dual**, and that is exactly where
the asymmetry bites: if its forced current has no return loop, the solver still
hands back a confident, finite set of node voltages. The number is meaningless,
but nothing on screen says so. We want an incomplete circuit to **read as
incomplete** — without breaking the legitimate "dangling branch" cases that are
supposed to float to a rail.

## 1. Root cause (precisely)

MNA solves `A x = b`. A current source contributes **nothing to `A`** — its
stamp is a pure right-hand-side KCL injection (`crates/sim-core/src/lib.rs`,
`ELEM_ISOURCE`: `rhs[a] -= value; rhs[b] += value`). It forces `value` amps to
*leave* node `a` and *enter* node `b`, and it asserts, by KCL, that those amps
must be balanced by current through other elements at each node.

Three distinct failure shapes, which we should keep separate:

- **No DC path to ground.** A node (or island of nodes) connects to the rest of
  the circuit only through elements that carry no DC current — capacitors
  (open at DC), an unconnected terminal, or nothing at all. The corresponding
  KCL row has no conductance, so the matrix row is all (or nearly all) zeros.
- **Dead-end node (degree < 2).** A node touched by exactly one element terminal
  can carry no steady current — there is nowhere for it to go. With only a
  current source forcing charge onto it, KCL is *unsatisfiable*: the forced amps
  have no exit.
- **A source whose forced quantity has no consistent solution.** The general
  case: an ideal current source whose terminal sits on a node with no other
  current path. KCL at that node reads "`value` amps in, nothing out" — no
  finite voltage makes that true. The system is **singular** (rank-deficient):
  the row that should pin that node's voltage is zero, yet `b` is non-zero there.

Why it then yields *garbage* rather than erroring: `solve_dense` deliberately
**falls back to `0.0` on a zero pivot** instead of producing a NaN (the
`if diag == 0.0` guards in both elimination and back-substitution). That keeps
the run finite and reproducible for an ill-posed netlist — good for determinism
— but it means a singular system silently returns *a* vector that does **not**
satisfy the forced-current constraint. The current source is the one element
that can drive `b` non-zero while contributing zero to `A`, so it is uniquely
able to make the system *inconsistent* (not merely under-determined) and still
get a clean finite answer out. The `GMIN` shunt across diode junctions papers
over this for the nonlinear path; current sources have no equivalent.

**Why a voltage source with a dangling branch stays well-posed.** Contrast the
R2-lifted divider (`web/src/lib/examples.ts`, `divider.demo.alt()`): R1's far
pin is the floating-output node, reached only through R1. That node *does* have a
conductance to the rest of the circuit (R1's `g = 1/R1`), so its KCL row is
**non-zero** — `g·V(out) − g·V(rail) = 0`, i.e. `V(out) = V(rail)`. The solution
is unique: the output **floats up to the full rail with zero current**. That is
a *meaningful, solvable* result, not garbage, and it is the whole point of the
demo. The dangling resistor contributes a real (if currentless) equation; the
dangling current-source terminal contributes an impossible one. **Any detector
must keep this case alive.**

## 2. Detection options

### (a) Topology pre-check in `buildNetlist`

Walk the union-find nets we already compute and flag:

- a current-source (`I`) **terminal whose node has no other DC current path**
  (the precise, low-false-positive signal), and/or
- the coarser **degree-1 / dead-end** and **no-DC-path-to-ground** conditions.

*Pros:* cheap, runs where we already know component kinds and `netSize`, and can
name the exact offending pin/net for the UI. *Cons:* the general "no DC path"
test must treat capacitors/inductors as open/short at DC to avoid false alarms,
which starts to re-implement the solver's knowledge.

*The divider case:* the **narrow** rule (current-source terminal only) is
trivially safe — the divider has no `I` element, so it is never flagged. The
**coarse** degree-1 rule is *not* safe as a hard error: R2's lifted far pin is
degree-1, and so is the floating-output node in spirit; firing on those would
kill the intended "floats to the rail" demo. So degree-1 may *annotate* a pin as
a dead-end, but must **not** be treated as "circuit invalid."

### (b) Singularity detection in the solve

Make `solve_dense` report that it hit a zero (or near-zero, relative to the
column scale) pivot — i.e. the system was rank-deficient — and surface that flag
out of the core. This is the **ground-truth** signal: it fires precisely when the
zero-pivot fallback was used, which is exactly the situation that produces a
bogus number, for *any* cause (current source today, future elements tomorrow).

*Keeping determinism:* the flag is a pure function of the same fixed-order
elimination — set a `bool` (or a small bitset of singular rows) when a pivot
column's max magnitude is below a fixed relative threshold; no new hashed
iteration, no float reduction that varies by platform. Use a **relative**
tolerance (e.g. pivot `< eps · column-infinity-norm`) rather than exact `== 0.0`
so a numerically-singular row is caught too, but pick a single fixed `eps` and
keep it out of the snapshot hash. It does **not** change `node_v`, so the golden
and `run_is_reproducible` are untouched.

*The divider case:* the R2-lifted divider is **non-singular** — every pivot is
finite (R1 supplies the conductance) — so this flag never fires on it. Correct by
construction.

### (c) Hybrid (recommended shape)

Cheap JS topology pre-check for the **common, nameable** case (a current-source
terminal with no return path → we can point at the pin), with the solver
singular-flag as the **backstop** for everything else (and as the authority that
the math actually failed). Topology gives a *teachable, located* message;
the solver flag guarantees we never show a confident garbage number even for a
case the JS heuristic missed.

*The divider case:* neither layer fires (no `I` element for the pre-check; a
full-rank matrix for the backstop), so it simulates and floats to the rail
exactly as today.

## 3. What to show the user

The board already has the vocabulary: `chip` / `chip-warn`, the one-line
`scope-tag` hint over the board, per-component `V across · I through` readouts,
and the dark HUD palette. Use them rather than a modal block.

Recommended affordances, in order of teaching value:

- **Located hint chip** over the board, amber (`--warn`):
  *"Current source has no return path — current can't flow."* Naming the cause
  is what teaches; it mirrors the existing `hint` line.
- **Highlight the offending pin/net** — a faint amber ring/glow on the dangling
  current-source terminal, so "incomplete" is *spatial*, not just text. Reuse the
  neon-glow motif.
- **Replace the bogus per-component number with "—"** for elements attached to
  the unsolved island, instead of printing a confident-but-wrong `V`/`I`. A dash
  reads as "no answer," which is the honest state.
- **Optionally ghost/dim** the affected branch (reduced opacity) to say "this
  isn't doing anything," consistent with how a de-energized part should feel.

Avoid a hard "INVALID — simulation stopped" badge: it blocks instead of teaches,
and it would wrongly tar the legitimate float-to-rail divider if the trigger ever
over-fired. Keep the sim **running**; just mark the suspect readouts.

## 4. Recommendation

**Do the hybrid, weighted toward the topology pre-check, with the solver flag as
a determinism-safe backstop.**

Rough sketch:

- **`web/src/lib/netlist.ts`** — in `buildNetlist`, after the nets are known,
  compute for each `I` terminal whether its node has any *other* DC current path
  (any R/L/V/diode terminal, or a second I, on that net). Emit an optional
  `incomplete?: { reason: "isource-no-return"; netId; pinKey }[]` on
  `BuiltNetlist`. This is the **primary** signal and the one that can point at a
  pin. It is pure topology — no solver, no boundary cost.
- **`crates/sim-core` + `crates/sim-wasm`** — add a `bool singular()` (or a
  packed `u32` bitmask of singular node rows) computed inside `solve_dense`'s
  existing fixed-order pass and exposed via the thin wasm layer. One extra scalar
  crosses the boundary per frame, folded into the **existing** batched snapshot
  read in `web/src/sim/loop.ts` — **never** a new per-component call. It stays
  out of `snapshot_hash`, so determinism, the golden, and `run_is_reproducible`
  are unaffected.
- **`web/src/App.svelte`** — when either signal is set, render the amber hint
  chip, ring the located pin (if topology named one), and substitute "—" in the
  affected `V across · I through` readouts. The `scope` and the rest of the sim
  keep running.

This makes the **dual** honest: a one-sided current source now reads as
*incomplete* (located, explained), while the R2-lifted divider — a voltage
source with a dangling resistor branch — remains a fully simulated result that
**floats to the rail with zero current**, untouched.

**Explicitly do NOT:**

- Do **not** change the `solve_dense` zero-pivot → `0.0` fallback or let it
  return NaN; determinism depends on the finite, defined outcome. Only *observe*
  that it happened.
- Do **not** put the singular flag (or any heuristic state) into the snapshot
  hash, and do not branch the solve on it — that would risk the golden.
- Do **not** treat degree-1 / dead-end nodes as a hard "invalid circuit"; the
  legitimate dangling-branch float-to-rail case depends on them solving normally.
- Do **not** block or halt the simulation; mark the suspect readouts and teach,
  keep the loop alive.
- Do **not** add a per-component or per-net wasm call; one scalar in the existing
  once-per-frame snapshot is the ceiling.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Event-driven dirty-set digital evaluation — design

Status: **design (2026-06-29), adversarially reviewed; build S0→S4 recommended.** The digital-matrix
lift (`docs/sim/digital-matrix-lift-plan.md`) made gate-level digital scale **linearly** in gate count.
The remaining `O(gates)` cost is that the digital evaluation re-runs **every** element every (sub-)tick.
This note designs the event-driven **dirty-set** that re-evaluates only the *active* fanout — provably
byte-identical to evaluate-all, fenced by a debug oracle exactly like the lift. Produced by a multi-agent
design panel (3 proposals, 31 adversarial divergence cases, judge-scored). Every line ref is verified
against `crates/sim-core/src/lib.rs`.

## The three facts that determine the design

1. **`eval_digital` re-quantizes inputs from live `node_v`, not from `net_level`**, at *each reader's own
   rail*: `fam.quantize(self.node_v[pin] − vlow, rail)` where `(vlow, vhigh) = gate_rails(&e, &node_v)`.
   So the skip key must be the reader's own quantization — **never** the net's committed level (the trap
   every naive level-diff dirty-set falls into).
2. **`snapshot_hash` folds the discrete `Level` only for `NetClass::Digital`**; a `Boundary` net hashes
   its **`node_v`** (the continuous voltage the analog solve produces every tick). So a quiescent
   pure-digital net keeps a stable hashed byte even as its closed-form `node_v` wiggles, but a Boundary
   net's hashed quantity is owned by the analog solve, never by the dirty-set.
3. **A powered gate's analog stamp moves every tick**: `gate_target = vlow + frac·rail`, `gate_gout`,
   `digital_vhigh/vlow/family` are recomputed from live `node_v` every `eval_digital`. A *legacy* gate
   (`d==0 && e==0`) sees a constant `value`-rail, so its stamp is constant given its level.

## The design — two passes on different triggers

**Pass L — LEVEL resolution (event-driven, the win).** A digital element's discrete output `Level` (and
its `combine()` fold into `digital_drive[outnet]`) is a pure function of: each reader pin's quantized
input level *at this element's rail*, the powered bool `rail ≥ GATE_MIN_RAIL`, and committed sequential
state (`ff_q`/`samp_q`/`cmp_q`/`beh_state`/`mem_data`). We cache that exact tuple per element; the skip
test recomputes the *same* `fam.quantize` calls and compares. **Skipped ⇒ identical by construction** —
the skip predicate *is* the first half of `eval_digital`'s work; what we eliminate is the truth-table +
`combine` + four array writes. For a quiescent CPU between clock edges that is essentially the whole inner
loop.

**Pass R — rail-dependent stamp (always-on, scoped).** `gate_target/gate_gout/digital_v*` are pure
functions of `(resolved level, rail node_v)`; the rail moves every tick, so these floats refresh even when
Pass L skips. From the **frozen** level (Pass L's cache):
- **Legacy** (constant rail): stamp is constant given level → folded into Pass L, not always-on.
- **Powered, drives Analog/Boundary** (`analog_driving_gates`, the small boundary interface): refreshed
  **unconditionally** every tick (its output is in the dense matrix / feeds `stamp_digital`).
- **Powered, drives pure-Digital** (`powered_digital_drivers`): refresh metadata + re-derive the
  closed-form `node_v` **iff** the rail `node_v.to_bits()` changed OR the level changed.

So **Pass L touches no rail f64 in its skip decision; Pass R owns every f64 the analog solve perturbs.**

**Propagation** (per sub-tick, single committed frontier): drain a FIFO `dirty_nets`; for each reader in
`net_readers[net]` (ascending element index) run Pass L; if a reader's output flips, Z-reset that net and
**re-fold its full `net_drivers[net]`** in ascending index (reproducing `eval_digital`'s Z-reset +
element-order fold + last-driver-wins metadata), then enqueue its readers; settle to fixpoint. The
multi-rate `run_digital_subticks` re-seeds each sub-tick from that sub-tick's `commit_net_levels` diff.

**Always-run in v1** (never event-gated — these carry per-tick or time-driven state): `commit_net_levels`
(re-quantize every Digital|Boundary net + diff into the seed); `commit_sequential_digital_state` (full
scan — clock edges, DRAM decay, UART/SAR counters); the analog solve / FAIL clamp / AC analysis.

## Byte-identity + the debug oracle

Determinism is sacred, so this is **proven, not asserted** — same discipline as the lift's shadow/oracle
(`debug_assert_digital_closed_form`, `debug_assert_digital_block_diagonal`). After each dirty-set
`eval_digital` (main tick **and** every sub-tick), in `#[cfg(debug_assertions)]`: snapshot the dirty
arrays, run the old **full evaluate-all** into scratch, and `assert_eq!` bit-for-bit:

| Array | Compare | by |
| --- | --- | --- |
| `digital_drive` | `Level` | net |
| `digital_vhigh/vlow` | `f64::to_bits` | net |
| `digital_family` | `u8` | net |
| `gate_target/gate_gout` | `f64::to_bits` | element |
| `net_level` | `Level` | net (post-commit) |
| `node_v` | `f64::to_bits` | node (post closed-form fill) |
| `ff_q/ff_clk_prev/samp_*/cmp_q/beh_state/mem_digest` | exact | element |

If it ever fires, the seeding is incomplete and the step is wrong — **never** the cue to regenerate a
golden. Release/wasm compiles it out.

## Data structures (install-time, deterministic — no std hasher, no hashed iteration)

Built once after `classify_nets` (the pass that builds `digital_rows`/`solve_row`), by in-order scans;
every inner Vec ascending; rebuilt on `set_netlist`/`reset` against the new `net_classes`; **none enter
the hash**.
- `net_readers: Vec<Vec<u32>>` — net → ascending elements that read it (per-kind pin lists; must include
  **every** `node_v[pin]` read in `eval_digital` *and* the live helpers `beh_lut_live_index` /
  `beh_flash_adc_code`).
- `net_drivers: Vec<Vec<u32>>` — net → ascending elements that drive it (for the full-net re-fold).
- `analog_driving_gates`, `powered_digital_drivers`, `clocked_elements` — the Pass-R / sequential subsets.
- Persistent across ticks (no longer reset each eval): `digital_drive`, `digital_vhigh/vlow/family`,
  `gate_target`, `gate_gout`.
- Transient, never hashed: `dirty_nets` FIFO + epoch-stamped O(1) dedup (no `HashSet`); `prev_net_level`;
  `prev_rail_bits` per powered element; `elem_inq_cache: Vec<[Level; K]>` + `elem_power_prev` (the skip key).

## Divergence handling (the 31 adversarial cases, distilled)

Every case the panel surfaced maps to a handling; the **fatal** ones:
- *Powered stamp drifts on a frozen level* → Pass R always-on (case #1).
- *Rail crosses `GATE_MIN_RAIL`* → powered bool in the skip key, recomputed every tick (#2).
- *Multi-driver `combine()` is non-invertible* → dirty granularity is the **net**: any driver change ⇒
  Z-reset + full re-fold (#3, #4, #11 open-drain release, #12 legacy/powered mix).
- *Clock edge / analog-sense threshold / `ff_clk_prev`* → sequential commit kept **full-scan**; never
  event-gated (#5, #6, #16).
- *Boundary net hashes `node_v`* → that voltage comes from the untouched analog solve; Pass R only feeds
  its stamp (#9).
- *Lifted pure-digital input fed by a moving rail* → per-reader quantization is the skip key; rail-bits
  dirty it; Pass R refills `digital_net_solved_voltage` (#14).
- *install/reset/first-tick* → force evaluate-all on the OP prime + tick 0/1; baseline `prev_net_level`
  captured at the `commit_net_levels` after `break_metastable_latches` (#8, #10).

Time-driven & analog-sense state (#5/#6/#13/#16) is **never** event-gated — only the combinational Pass L is.

## Staged build plan (each gate-green; no golden move at any stage)

- **S0 — Oracle harness, no behaviour change.** Make `eval_digital`'s per-element body callable in
  isolation; add the debug oracle as a *tautology* (full == full) after `eval_digital` + in
  `run_digital_subticks`. Proves the oracle plumbing + the array list is complete.
- **S1 — Install-time maps.** Build `net_readers/net_drivers/analog_driving_gates/...` + caches; rebuild on
  `set_netlist`/`reset`; debug-assert a from-scratch `net_drivers` re-fold equals the in-place fold.
- **S2 — Pass R split.** Split the rail stamp into the scoped always-on pass; Pass L still full. Oracle
  green proves the stamp/level separation is exact.
- **S3 — Pass L dirty-set (main tick).** Persist drives; per-touched-net re-fold; seed from
  `commit_net_levels` diff + sequential mutation + powered/rail-bits flips; force evaluate-all on
  install/reset/first-step. Oracle green across the suite.
- **S4 — Dirty-set inside `run_digital_subticks`.** Per-sub-tick re-seed + fixpoint; oracle wraps each
  sub-tick.
- **S5 (v2, optional, profiled) — Incrementalize the always-run scans** (`commit_net_levels`,
  `commit_sequential_digital_state`) toward true `O(active)`.

## Expected win & honest caveat

For a quiescent powered CPU, Pass L → ~0 re-resolutions (the eliminated `2× quantize + truth-table +
combine + 4 writes` per element per sub-tick — the dominant residual digital constant after the lift), and
Pass R → O(`analog_driving_gates`) (the small boundary set) once the supply settles to DC. The active
region costs O(switching cone). **Caveat:** the win is on the per-gate *logic*, not the *stamp* (one
`drive_level` per analog-driving element remains); a circuit that is analog-solve-bound sees this correctly
as a near-no-op (only the O(n) seed scan). v1 still pays O(nodes) for `commit_net_levels` + the closed-form
fill + the sequential scan each tick; S5 drives those toward O(active).

**Recommendation:** build S0→S4 now (S0–S2 are pure refactor + always-full, oracle a tautology, zero
behavioural risk; S3–S4 the actual win). Defer S5 to a profiled follow-up.

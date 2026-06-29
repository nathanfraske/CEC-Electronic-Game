<!-- SPDX-License-Identifier: Apache-2.0 -->

# The biggest engine win: lift pure-digital nets out of the dense MNA matrix

Status: **Stage A0 + A (the lift) IMPLEMENTED and proven byte-identical; the residual
`O(n²)` assembly is a noted follow-up.** Drafted in answer to "what is the biggest thing we
can do for the engine, and how do we tackle it." This note names the win, inventories the
(large) scaffolding already in place, scopes the structural step, and proves it lands
**golden-byte-identical**. It is the natural culmination of ADR 0004 (the protocol/behavioral
engine) and `docs/ui/logic-analog-digital-nets.md` (§6–§7), and the gate to the project's
stated endgame: **sand → CPU → DOOM** — a *gate-level* digital design running in the browser.

> **Implemented (2026-06-29).** Stage A landed as a **submatrix-extraction wrapper**
> (`Sim::solve_dense_lift_digital`, `crates/sim-core/src/lib.rs`) rather than a from-scratch
> compacted assembler — a byte-identical realisation that is far lower-risk. The full matrix
> is still assembled exactly as before (every stamp, `branch_index`, `node_idx` untouched);
> the wrapper then **drops the provably-diagonal pure-`Digital` rows/cols, factors only the
> analog+boundary+branch submatrix, and refills the dropped nets from the closed form**,
> returning a full-width solution so every caller's scatter/readout is unchanged. This turns
> the dense **`O(n³)` factorisation into `O(n_analog³)`** — the wall for a gate-level CPU —
> while a **debug-only shadow solve inside the wrapper asserts the lifted result equals
> factoring the full matrix bit-for-bit on every step**, so byte-identity is a *proven runtime
> fact* across the whole suite (229 tests, golden `0xeaac…` untouched), not just an argument.
> A0 (the `closed-form == in-matrix` invariant) shipped first as the validating checkpoint.
> **Residual / follow-up:** the full matrix is still *allocated and assembled* at `O(n²)`
> (then extracted at `O(n²)`); assembling *directly* into the compacted system (true §5-A2)
> would drop that to `O(n_analog²)` — a clean, separate optimisation now that the factorisation
> wall is gone. Stage B (Z/X propagation) remains unstarted and optional.

> One sentence: **the dense `O(n³)` MNA solve is the wall between us and a gate-level CPU,
> and the entire codebase has already been scaffolded to climb it — what remains is to
> stop stamping pure-digital nets into the dense matrix and instead resolve them in the
> already-built, already-proven digital domain, shrinking the dense solve to just the
> analog + boundary nets.**

---

## 1. The bottleneck, stated precisely

The transient solve factors a **dense** matrix every tick: `solve_dense`
(`crates/sim-core/src/lib.rs:2805`) is Gaussian elimination with partial pivoting, `O(n³)`
in the node count `n`. Every assembly path runs it — the operating-point solve, the linear
transient `solve_into_readout` (`:5024`), and the Newton transient
`solve_into_readout_newton` (`:6141`).

Today **every pure-digital net is a row in that dense matrix.** A logic gate, a flip-flop,
a LUT — each of their signal nets is stamped (`stamp_digital`, `:6993`) and factored
alongside the analog nodes. That is fine for a handful of gates. It is fatal for a CPU:

| Circuit | ~pure-digital nets | dense `O(n³)` cost / tick | feasible? |
| --- | --- | --- | --- |
| An AND-gate demo | ~5 | ~10² | trivially |
| A 4-bit ALU slice | ~80 | ~5×10⁵ | yes |
| A 4-bit accumulator CPU | ~10³ | ~10⁹ | sluggish |
| A gate-level 8-bit CPU (the endgame) | ~5×10³ | **~10¹¹ / tick** | **no** |

At `DT = 2 µs`, one simulated second is 500 000 ticks; `10¹¹ × 5×10⁵ ≈ 10¹⁶` flops to run
a gate-level CPU for a second — a non-starter in a browser. The cube is the wall.

The structural fix is the one the architecture doc has promised from the start
(`docs/architecture.md`): the pure-digital interior does **not** belong in the analog
matrix. A logic net carries a discrete *level*, resolved by combining its drivers — not a
continuous voltage that needs a linear solve. Lift those nets out and the dense matrix
collapses to the **analog + boundary** nodes only (power rails, the analog I/O fringe — a
few dozen nodes even for a big CPU), while the thousands of digital nets resolve in `O(gates)`
linear work. That is a `~10⁶×` reduction in the dominant term for the endgame circuit, and
it is the single highest-leverage change available to the engine.

---

## 2. What is already built (the ~85%)

The reason this is a **bounded capstone, not a greenfield subsystem**: across ADR 0004's
phases the digital domain has already been constructed in full *beside* the matrix — it is
simply not yet *load-bearing* for the main analog tick. Inventory, all in
`crates/sim-core/src/lib.rs`:

| Piece | Where | State |
| --- | --- | --- |
| **Net classification** `Analog / Digital / Boundary` | `classify_nets` (`:2133`), `NetClass` (`:2120`), `is_digital` (`:2101`) | ✅ deterministic, fixed element order; **fully tested** (the classification block at `:8880`+ covers gates, DFFs, comparators, SPI, open-drain buses, RC interiors) |
| **Pure-digital row partition** | `digital_rows` (`:3656`) | ✅ computed at install; proven **strictly diagonal** by `debug_assert_digital_block_diagonal` (`:6956`) before every `solve_dense` |
| **Receiver / logic / driver pass** | `eval_digital` (`:6566`) | ✅ quantises inputs per logic family, evaluates every gate/DFF/LUT/memory/protocol block, resolves multi-driver nets |
| **4-state resolution** `Z yields, conflict → X` | `combine` (`:528`) | ✅ associative/commutative IEEE-1164-style fold |
| **Logic-family table** (`V_IL/V_IH/V_OL/V_OH`, `quantize`, `drive_level`) | `FAMILIES` (`:625`), `LogicFamily` | ✅ `LEGACY` + real families; receiver and driver both route through it |
| **Closed-form diagonal solve** | `digital_net_solved_voltage` (`:7041`), `digital_net_thevenin` (`:7020`) | ✅ `v = g·vt/(GMIN+g)` — the value `stamp_digital`+`solve_dense` produce for a diagonal row, **without** a factorisation |
| **Level commit** (re-quantise `node_v → Level`) | `commit_net_levels` (`:6921`) | ✅ runs each tick for Digital + Boundary nets |
| **Sequential commit** (edge-detect / FF / sampler / comparator / behavioral) | `commit_sequential_digital_state` (`:7329`) | ✅ factored so the analog tick and the sub-tick loop share it verbatim |
| **Multi-rate sub-tick loop** — *already solves pure-digital nets out-of-matrix* | `run_digital_subticks` (`:7628`) | ✅ for `S > 1` it freezes the boundary and re-derives `digital_rows` via the **closed form** `S−1` times per analog tick |
| **Level-bearing snapshot hash** | `snapshot_hash` (`:8528`) | ✅ folds the discrete `Level` (one `u8`) for pure-`Digital` nets, `node_v` (f64) for analog/boundary |

The two facts that matter most for the plan:

1. **The closed form is already proven equal to the in-matrix solve.** `run_digital_subticks`
   relies on `digital_net_solved_voltage` being bit-identical to what `solve_dense` produces
   for a `digital_rows` row — that equality is the entire basis of the existing `S > 1`
   sub-tick path, and it holds because the block is provably diagonal (`:6956`) and both the
   stamp and the closed form share `digital_net_thevenin` (`:7020`), so they "can never drift
   apart" (the doc-comment's words at `:7038`).

2. **The hash already commits the level, not the voltage, for pure-digital nets.**
   `snapshot_hash` (`:8531`–`:8537`) branches on `NetClass::Digital` and folds
   `net_level[n] as u8`; only analog/boundary nodes fold their `f64`. The "level-bearing
   hash" the design docs treated as a future, golden-breaking change **is already in the
   tree** and golden-stable (the RC golden `0xeaac_3764_99e4_fa24` has no digital nets, so it
   folds zero level bytes).

What is **not** yet done is the last wire: on the main analog tick, pure-digital nets are
still *stamped into and factored by* the dense matrix (`stamp_digital` at `:6993` stamps both
`Digital` and `Boundary`; the doc-comment at `:3638` and `:2114` says so outright — "pure-
digital nets still stamp into the MNA matrix until the event scheduler lands"). The sub-tick
loop lifted them out for `S > 1`; the **base tick never did**.

---

## 3. The remaining step — and the determinism discovery that de-risks it

ADR 0004 phase 3 (`docs/adr/0004-protocol-engine.md:60`–`79`) framed the choice as **two
strategies**:

- **Strategy 2 (shipped):** keep pure-digital nets in the matrix; for `S > 1`, sub-solve the
  decoupled digital block separately. Chosen because it is N=1 bit-identical.
- **Strategy 1 (deferred, "the cleaner long-term representation"):** drop pure-digital nets
  from the matrix entirely and commit the resolved level directly. The ADR flagged this as a
  **golden-breaking** step because committing the raw `combine` changes the level for
  floating-`Z` (→ would be `Z`, today re-quantises to `Low`) and contention (→ `X`, today
  re-quantises to a mid-rail voltage) nets.

**The discovery this plan rests on: those are two separable changes, and only the second
breaks the golden.** Dropping the rows from the matrix (the *performance* win) and changing
the *committed level semantics* (the *correctness* win) are independent:

> Because (a) `digital_net_solved_voltage` is bit-identical to the in-matrix diagonal solve,
> (b) the pure-digital block is provably decoupled from the analog block (no off-diagonals,
> so removing it cannot perturb the analog elimination or its partial-pivot order), and
> (c) the hash already folds `net_level` — re-quantised from `node_v` — for pure-digital
> nets, we can **remove pure-digital rows from the dense matrix, fill their `node_v` from the
> closed form, and re-quantise exactly as today**, and the snapshot hash is **byte-identical**.

That is the performance win with **zero golden change** — Strategy 1's matrix, Strategy 2's
bit-identity. The ADR conflated "leave the matrix" with "commit raw `combine`"; they come
apart precisely because the sub-tick loop already proved the closed form reproduces the
matrix value. The genuinely golden-gated part (Z/X as first-class *propagating* levels) is a
**later, optional, more-correct** upgrade — valuable for teaching (`logic-analog-digital-nets.md`
§7 wants `X` to propagate), but **not** required for the speed-up and cleanly deferrable.

So the plan splits along that seam:

- **Stage A — the lift (golden-byte-identical).** Stop stamping `NetClass::Digital` rows;
  shrink the dense system to analog + boundary + branch unknowns; fill pure-digital `node_v`
  from `digital_net_solved_voltage`; `commit_net_levels` unchanged. **This is the entire
  performance win.** Acceptance bar: the existing 1000-tick reproducibility goldens for every
  gate / DFF / ring / sampler / comparator / behavioral / memory circuit stay **bit-identical**.
- **Stage B — Z/X propagation (deliberate golden regen; optional, later).** Commit the
  resolved `combine` level directly so a floating net is `Z` and a contention net is `X`, and
  let `X` propagate through sequential elements. Regenerates the gate/DFF reproducibility
  goldens (the deliberate break ADR 0004 anticipated); the analog golden stays untouched.

---

## 4. Why this is the biggest win (and an honest comparison)

Three structural changes could each be called "the biggest thing for the engine." They are
not interchangeable; for *this* project's goal they rank clearly.

| Candidate | What it buys | Cost / risk | Fit to "sand → CPU → DOOM" |
| --- | --- | --- | --- |
| **Lift pure-digital nets out of the dense matrix** (this plan) | Removes the dominant `O(n³)` term for *digital* scale → gate-level CPUs become feasible | **Low–moderate, and Stage A is golden-byte-identical** — ~85% pre-built, the seam is one classification branch in the assembly + a post-solve fill | **Direct enabler.** A CPU is thousands of digital nets and a few analog I/O nets; this is exactly the scaling that blocks the endgame |
| **Sparse analog solver** (KLU-style LU) | Removes `O(n³)` for *analog* scale | **High, determinism-hostile** — fill-reducing orderings (AMD/COLAMD) must be pinned and bit-reproducible across platforms/toolchains; a large rewrite of the core solve | Secondary. After the lift the analog matrix is *small* (rails + fringe), so sparsity buys little for a CPU; it matters for big *analog* boards, not the digital endgame |
| **Event-driven dirty-set digital** (only re-evaluate gates whose inputs changed) | Removes the `O(gates)` per-tick *re-evaluation* term | Low, but **premature** | A *follow-on to* the lift, not a substitute. `logic-analog-digital-nets.md` §7.5 is explicit: "start with evaluate-all double-buffered cycle-update… the event-driven dirty-set is a *later* optimisation behind a bit-equality assertion." Evaluate-all is fine until gate counts are very large |

The lift wins on all three axes: **highest leverage** for the stated goal (it attacks the
term that actually explodes for a CPU), **lowest risk** (Stage A is provably golden-safe and
most of it exists), and **best sequencing** (it is the precondition for the dirty-set
optimisation and is orthogonal to — and reduces the need for — a sparse analog solver). A
sparse solver is the right "biggest analog win" later; the digital lift is the right biggest
win *now*.

---

## 5. Staged build plan

Each stage keeps `cargo test -p sim-core -p sim-protocol` green. Only Stage B regenerates any
golden, and it is isolated to its own commit (per `logic-analog-digital-nets.md` §7.6
correction #4 — sequence the golden-stable and golden-breaking changes separately so any diff
is attributable).

### Stage A — lift the rows (golden-byte-identical) — the headline

A0. **Pin the equality as a runtime invariant first (cheap insurance).** Before changing the
assembly, add a debug-only check (sibling to `debug_assert_digital_block_diagonal`) that, for
every `digital_rows` net, the post-solve in-matrix `node_v[node]` equals
`digital_net_solved_voltage(node)` to the last bit. Run the suite. If it ever fires, the
closed form and the matrix have a discrepancy that Stage A must reconcile **before** removing
the rows — see the floating-ref risk in §7. This converts the central assumption into a
checked fact across every existing digital test.

A1. **Split the digital stamp by class.** `stamp_digital` (`:6993`) currently stamps both
`Digital` and `Boundary`. Restrict the matrix stamp to **`Boundary`** nets (they stay in the
matrix — that is where the domains meet, and contention there is resolved by real
conductance-weighted physics). Pure-`Digital` nets no longer stamp.

A2. **Shrink the assembled system.** The analog assembly already excludes ground (row =
`node − 1`); now also exclude `NetClass::Digital` nodes from the dense system. Concretely:
build a stable `node → row` map over `{analog ∪ boundary}` nodes (ascending, deterministic —
the same discipline as `digital_rows`), assemble/solve at the reduced dimension, and scatter
the solution back. Branch unknowns (inductor/transformer/source currents) are unaffected —
they never touch a pure-digital net (those are decoupled by construction). The pivot order
over the remaining analog rows is unchanged because the removed block contributed no
off-diagonals to them.

A3. **Fill pure-digital `node_v` from the closed form, post-solve.** After the analog solve,
for each `digital_rows` node set `node_v[node] = digital_net_solved_voltage(node)` — exactly
what `run_digital_subticks` (`:7637`–`:7640`) already does. Then `commit_net_levels` (`:6921`)
re-quantises as today. Renderer/boundary reads of a digital net's voltage are unchanged
(still the closed-form value, bit-identical to the old in-matrix value).

A4. **Prove it.** The acceptance bar is byte-identity (see §6). Because the analog block and
the level commit are untouched and the closed form reproduces the old digital `node_v`, every
existing snapshot hash must be unchanged over 1000 ticks. The main analog golden was already
safe (no digital nets); now the *gate/DFF/etc.* goldens are too — **no regen in Stage A**.

The performance result of Stage A alone: a gate-level CPU's dense solve drops from
`O((analog+digital)³)` to `O((analog+boundary)³) + O(digital)`. The digital term is the
linear `eval_digital` + `combine` pass that already runs every tick.

### Stage B — Z/X as propagating levels (deliberate golden regen; optional, later)

Only once Stage A has banked the speed-up and the owner wants the correctness/teaching upgrade:

B1. **Commit the resolved level directly** for pure-`Digital` nets — `Z` when released, `X`
on contention — instead of re-quantising the closed-form voltage. Boundary nets keep the
physical re-quantise (an analog load genuinely pulls a real voltage).

B2. **Propagate `X` through sequential state** (store FF/sampler/comparator/behavioral state
as `Level`, never `bool`, so `X` survives a clock edge — `logic-analog-digital-nets.md` §7.6
correction #5), and surface `Z`-with-no-pull-up as an incomplete-circuit warning (correction
#6).

B3. **Regenerate the gate/DFF/etc. reproducibility goldens** in a dedicated commit; the PR
states why (Z/X now propagate) and shows the new hashes. The analog golden stays byte-identical.

### Stage C — follow-ons (separate, as needed)

- **Event-driven dirty-set** (`logic-analog-digital-nets.md` §7.5) behind a bit-equality
  assertion against evaluate-all — only when gate counts make the linear re-eval pass itself
  the cost.
- **Web threading / teaching surface** (Stage 3–4 of the doc): family chips, noise-margin and
  forbidden-band readouts, the level-shifter / open-drain parts. Golden-additive or
  presentation-only; independent of the lift.

---

## 6. Test bar (deterministic Rust first, per house discipline)

- **Stage A byte-identity (the gate).** For every existing digital circuit — gate truth
  tables, the ring oscillator, the DFF, sampler, comparator, every behavioral program, the
  memory array — run 1000 ticks and assert the XOR-folded `snapshot_hash` is **identical**
  before and after the lift. This is the whole acceptance bar for Stage A; if any hash moves,
  Stage A has a bug (it must be byte-identical by the §3 argument).
- **The A0 closed-form ↔ matrix equality invariant** green across the entire suite (the
  precondition that makes A1–A3 sound).
- **Dimension/feasibility:** the analog system is non-singular at the reduced dimension for a
  representative spread (gate-only, gate-driving-an-LED boundary, open-drain + pull-up bus,
  RC-loaded gate output, a floating digital net).
- **Linear fast path preserved:** a gate-only netlist still takes the linear path (no Newton,
  no branch unknown) — `is_nonlinear` excludes the gate (`:766`).
- **Multi-rate still bit-identical:** the existing `S > 1` sub-tick reproducibility tests stay
  green (the lift makes the base tick do what the sub-tick already did, so they should *agree
  more*, not less).
- **Performance smoke (not a golden):** a synthetic N-gate chain shows dense-solve dimension
  flat in N after the lift (it tracks boundary/analog nodes, not gate count) — the structural
  proof the cube is gone for digital scale.
- **Stage B (when built):** per-family threshold/level tables; mixed-rail (1.8 V → 5 V reads
  `Low`; with a shifter, `High`); open-drain wired-AND; a 4-state resolution table; `X`
  surviving a flip-flop; **rewind-across-a-clock-edge → identical hash** (the keyframe
  contract, `logic-analog-digital-nets.md` §7.6 correction #2).

---

## 7. Risks & open questions for the owner

1. **The floating-ref interaction is the one real bit-identity risk in Stage A, and A0 is
   built to catch it.** A released (`Z`) pure-digital net gets a `GMIN` floor from
   `stamp_digital`; if `floating_refs` (`:3677`, the isolated-subnet anti-singularity tie)
   *also* anchors that same net, its in-matrix diagonal is `2·GMIN`, while
   `digital_net_solved_voltage` assumes `GMIN`. For an undriven net both give `0 V` (rhs = 0),
   but for a *driven* net the two would differ in the last ULPs (`g·vt/(GMIN+g)` vs
   `g·vt/(2·GMIN+g)`). The A0 equality invariant surfaces any such case across the whole
   suite *before* the rows are removed; the fix (exclude pure-digital nets from `floating_refs`,
   or fold the exact floor into the closed form) is small and local. **This is why Stage A
   validates the equality rather than assuming it.**
2. **Stage B scope.** Do we want `Z`/`X` to propagate now, or is the golden-stable speed-up
   (Stage A) enough for the foreseeable curriculum? Recommendation: **land Stage A alone
   first** (pure win, no golden churn), schedule Stage B when a lesson actually needs a
   visible high-Z bus or an `X`.
3. **Default `combine` for an undriven net under Stage B.** Today a floating digital input
   reads `Low` (the `GMIN`-to-0 re-quantise). Under Stage B it would read `Z`. Confirm that is
   the desired teaching behaviour (it is more honest, but changes what an unwired gate input
   shows) before regenerating goldens.
4. **No behaviour change ships silently.** Stage A is presented as byte-identical; if the A0
   invariant forces any reconciliation that *does* move a hash, that becomes an explicit,
   explained golden regen — never a silent one (golden rule #1).

---

## 8. Summary

The dense `O(n³)` solve is the only thing standing between the engine and a gate-level CPU,
and the project has already built — across ADR 0004 — the entire digital domain needed to
step around it: deterministic net classification, a proven-diagonal pure-digital partition, a
full receiver/logic/driver pass with 4-state resolution and logic families, a closed-form
digital solve that the multi-rate sub-tick loop already uses in place of the matrix, and a
snapshot hash that already commits discrete levels for digital nets. The remaining step is to
make the **base analog tick** do what the sub-tick loop already does: stop stamping
pure-digital nets into the dense matrix and fill them from the closed form instead. Because
that closed form is bit-identical to the in-matrix solve and the hash is already
level-bearing, the **performance win lands golden-byte-identical (Stage A)** — the dense
matrix shrinks to the analog + boundary fringe while thousands of digital nets resolve in
linear time. The only deliberately golden-breaking work — making `Z` and `X` first-class
*propagating* levels (Stage B) — is a separable, optional correctness/teaching upgrade that
can wait. It is the highest-leverage, lowest-risk, best-sequenced change available to the
engine, and it is the gate to "sand → CPU → DOOM."

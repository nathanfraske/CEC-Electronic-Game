<!-- SPDX-License-Identifier: Apache-2.0 -->
# Sequential Cell Characterization — the "Option A" plan

> **As-built update (2026-06-26): A1 is IMPLEMENTED.** `characterizeCell` no longer refuses clocked
> cells — it runs a sequential sweep (`sequentialSweepNetlist` drives a square clock on the CLK pin;
> the loop steps across clock periods and `classifySequentialSamples` decides the settled next-state)
> and emits a **registered** LUT (`mode:1`) for a pure D-type cell. It **fails safe**: any cell it
> can't prove is a pure D-type (a toggle/counter/oscillator — Q keeps changing across edges) is
> **refused → stays discrete**, never mischaracterized. The wasm-free wiring + the classifier are
> headless-tested (`sweepNetlist.test.ts`); the live wasm sweep is **app-verified** (same convention as
> the combinational characterizer). **A2 (the multi-bit / self-dependent fabric) remains future work.**

**Status:** A1 implemented; A2 planned. Owner-directed 2026-06-26 (first "eat the cost now, but plan
the fix with A"; then "implement that overnight as well"). This is the focused, **as-built** plan for letting a *player-built sequential cell*
(a flip-flop / register / counter built from transistors or gates) collapse to the cheap behavioral
face — the way a combinational gate already does. It is the sequential thread of
`docs/cell-characterization-and-integration-hierarchy.md` (§2.2/§2.5/§2.7/§2.8 Phase B, §2.9) and
`docs/cell-characterization-build-plan.md` (P8 + P9), pulled into one place and **re-grounded against
the P7 combinational characterizer that actually shipped** (`web/src/lib/characterize.ts`,
`web/src/lib/sweepNetlist.ts`). Read those two for the determinism contract, the UX on-ramp, and the
golden re-verification; this doc is the implementation map for the one rung we deliberately left out.

Every mechanism is anchored to a real `file:symbol`. **NEW vs already-built** is marked throughout.
The golden contract is one statement, re-checked in §5: `0xeaac_3764_99e4_fa24` cannot move under any
phase here — route A1 and A2 are **web-side only** (no `sim-core` change), and the runtime they target
already folds its state append-only and golden-absent.

---

## 0. The decision: eat the cost now

A player-built **combinational** gate collapses to one cheap `ELEM_BEHAVIORAL` LUT today (P7,
`characterizeCell`). A player-built **sequential** cell (a flop, a register, a counter) does **not** —
`characterizeCell` refuses it (`hasClk` → `ok:false`, `characterize.ts:77`). So a transistor- or
gate-built flop **stays flattened to its discrete parts** and re-solves them every tick. That is the
cost we are choosing to pay for now:

- **What still works:** small sequential designs (a handful of hand-built flops) run correctly — they
  are just analog/digital-mixed at full fidelity, not collapsed. A 4-bit counter built from gates is
  fine. The simulation is *correct*, only not *cheap*.
- **Where it bites (the deferred problem):** a **wide register file / large counter / a CPU's
  sequential state** built from player cells keeps hundreds–thousands of flop transistors (or
  `ELEM_DFF`/gate elements) live in the per-tick solve. Combinational logic between them collapses
  (P7); the **state elements do not**. That is the per-tick wall at CPU scale.
- **Interim guidance for the player (no code):** cheap sequential state is already available *as
  primitives* — the **`ELEM_DFF`** D flip-flop and the **registered `ELEM_BEHAVIORAL` LUT** (a LUT+FF
  "FPGA logic element") are each one element. A player who wants a cheap register today uses those
  stock parts (the "stock library", same role `ELEM_GATE` plays for combinational). The thing Option A
  unlocks is collapsing a **hand-built-from-transistors** flop to that same cheap element — closing the
  last gap in "build everything above the primitives and still run at scale."

**Trigger to pick this up (the exit condition for "eat the cost"):** when a player's sequential array
(register file, wide counter, CPU state) makes the per-tick solve visibly stall — i.e. the first time
someone builds enough hand-rolled state that the discrete flops dominate the matrix. Until then this
doc sits here.

---

## 1. Where we are (as-built)

The P7 combinational pipeline shipped and is the template Option A extends:

| Piece | As-built location | Sequential status |
| --- | --- | --- |
| Per-vector scratch netlist (wasm-free, headless-tested) | `sweepNetlist.ts:sweepNetlist` (`SweepPins`) | drives rails + inputs only — **no CLK/reset** |
| The sweep + guard (drives the wasm `Simulation`) | `characterize.ts:characterizeCell` | **refuses** `hasClk` (`:77`), multi-output (`:72`), no-GND (`:83`), >4-in (`:91`) |
| Stored cheap face | `UserIc.behavior: CellBehavior {prog,word,mode,sig}` (`userIc.ts:105`) | `mode` field exists; sweep only ever writes `mode:0` |
| Per-instance opt-in | `Component.fidelity === "behavioral"` (`userIc.ts:981`) | shared by both faces |
| The collapse (flatten → one element) | `flattenUserIcs` LUT branch (`userIc.ts:981-1024`) | **already maps `clk` role → LUT pin 5** (`:991`) |
| The runtime element | `ELEM_BEHAVIORAL` prog 4, `beh_lut_step` (`lib.rs:1554`); mode rides `params[BEH_LUT_MODE_SLOT=4]` (`lib.rs:1513`) | **registered mode already implemented** — latches `Q` on the rising CLK edge |

**The decisive observation:** the *registered* runtime is already complete end to end. `beh_lut_step`
latches `truth[index]` into `Q` on a rising CLK edge and drives `Q`; the flatten branch already emits a
`clk`-roled pin onto LUT terminal 5; `CellBehavior.mode` already carries the combinational/registered
bit. **The only missing piece is the characterizer producing a registered `CellBehavior` instead of
refusing.** Option A is therefore a web-side extension of `characterizeCell` + `sweepNetlist` — there
is no new `sim-core` element and no new hashed field.

---

## 2. The ceiling that shapes the whole design

The registered LUT computes **`Q+ = LUT(external inputs)`** — its index is `IN0 | IN1<<1 | IN2<<2 |
IN3<<3` from the *input* terminals (`beh_lut_live_index`, `lib.rs:1539`). **The index does NOT include
the current `Q`.** Two consequences fix the phase split:

1. A **D-type** next-state function (`Q+ = f(inputs)`, no self-dependence) — a D flip-flop, a
   D-latch, a load-enable register bit fed externally — collapses to **one** registered LUT. This is
   Phase **A1**.
2. A **state-dependent** next-state (`Q+ = f(inputs, Q)`) — a **toggle/JK flop, a counter, an
   accumulator, anything that reads its own output** — cannot be one registered LUT, because `Q` is not
   an index bit. It needs `Q` **fed back as a digital interconnect net** into a combinational LUT whose
   output drives the registered LUT's data input: a **2+-element fabric**. This is Phase **A2**.

This is not a limitation to engineer around — it is exactly the FPGA decomposition (`Q` routed back
through the LUT fabric), and it is the honest realization of "a fabric of LUT+FF logic elements is any
sequential machine" (`lib.rs:1011`).

---

## 3. Phase A1 — single registered LUT (the D-type family)

**Goal:** a hand-built D flip-flop / D-latch / externally-loaded register bit collapses to one
registered `ELEM_BEHAVIORAL` LUT, exactly as a NAND collapses to a combinational one.

### 3.1 The sequential sweep protocol (NEW)

A combinational sweep drives inputs and reads the settled output. A sequential sweep must instead
**force a known state, clock once, and read the next state** — because the next-state table cannot be
observed without controlling `Q`. Mandate (promoted from §2.9's open sub-question to a requirement):

> **A characterizable sequential cell must declare an async reset (or preset) pin.** The sweep forces
> `Q` to a known value through it; a cell whose state cannot be forced is refused to the cheap face
> (kept analog).

Per input vector `combo` (over the ≤4 data inputs):
1. drive reset → settle → `Q` is known (e.g. 0),
2. release reset, hold `combo` on the inputs,
3. issue one **rising CLK edge** (drive CLK low→high, settle `SETTLE_STEPS`),
4. read the output → that is `Q+` for `(combo)` → bit `combo` of the registered truth word.

Because the index excludes `Q`, the table is complete after one pass over the `2^k` input combos at a
single forced start-state — there is no `state × input` cross-product to enumerate for A1 (that
cross-product is A2's job, and it is what the fabric, not a single element, expresses).

### 3.2 The deltas (small, web-side)

- **`sweepNetlist.ts` — `SweepPins`:** add `clkPin: number` and `resetPin: number` (both `-1` when
  absent). The driver already injects per-pin sources via `dieTestGraph` + `pinTests`
  (`sweepNetlist.ts:65-71`); add a `clk`/`reset` `PinTest` role so the harness can pulse them. The
  high-Z sense resistor on OUT (`:75-95`) is unchanged — `Q+` is read exactly like a combinational
  output.
- **`characterize.ts` — `characterizeCell`:** replace the blanket `hasClk → refuse` (`:77`) with a
  branch: if `hasClk` **and** a reset/preset pin is declared **and** the cell is single-state-bit
  D-type (no self-dependence — see the guard below), run the §3.1 protocol and emit
  `{prog:4, word, mode:1, sig}` (registered). Keep the refusal for clocked cells **without** a
  forceable reset, or with self-state-dependence (those are A2).
- **Data model:** none. `CellBehavior.mode` (`userIc.ts:105`) already carries the registered bit;
  `flattenUserIcs` already emits a `clk`-roled pin onto LUT terminal 5 and passes `mode` through
  (`userIc.ts:1003-1004`). A1 just makes the sweep *write* `mode:1`.

### 3.3 Guard extensions (NEW correctness checks)

Add to the existing two-level/stable/pure checks (`characterize.ts:66-95`):
- **edge-dependence:** `Q+` must change only across the declared CLK edge, not on input changes alone
  between edges (else it is a transparent latch mischaracterized as edge-triggered, or an oscillator).
- **no self-state-dependence:** clamp `Q` to 0, sweep; clamp `Q` to 1 (via preset), re-sweep; if the
  two tables differ, `Q+` depends on `Q` → **refuse to A1, route to A2**. This is the structural test
  that separates the D family from the toggle/JK family.
- reuse the existing two-quantizer discipline (output verified with `fam.quantize`, not the input
  `beh_level` — hierarchy doc §2.6 / build-plan D5).

---

## 4. Phase A2 — the fabric (route a1) for state-dependent & multi-bit cells

**Goal:** a toggle/JK flop, a counter, a shift register, a multi-bit register — anything `Q+ =
f(inputs, Q)` or with >1 state bit — collapses to a **fabric of LUT4 elements** (combinational LUTs
for the logic cones + one registered LUT per state bit), wired through pure-digital interconnect. This
is the CPU-scale enabler and the genuinely substantial work.

### 4.1 Structural lowering (route a1, NOT function synthesis)

Per the build-plan's D7 correction, this is **structural graph→element lowering**, not Shannon/BDD
synthesis (no such code exists in the repo, and a wide cell cannot be swept as one table):
1. Walk the cell's discrete graph. Each **≤4-input combinational gate** becomes one combinational LUT4
   (a ≤2-in gate *is* a 16-bit word — its truth table is computed directly, not swept).
2. Each **storage node** (a recognized flop primitive, a registered LUT, or a detected cross-coupled
   bistable) becomes one **registered LUT4**; its `Q` output net is a normal interconnect net.
3. **Feed `Q` back** as an input net wherever the logic reads it (this is what lifts the §2 ceiling:
   `Q` is an *input* to the combinational cone feeding the registered LUT's data pin).
4. Wire every internal signal net as a **pure-`NetClass::Digital` node** (build-plan D9 /
   hierarchy §2.7: `run_digital_subticks` re-solves only `digital_rows`, `lib.rs:6744`; an
   analog-touched inter-LUT net is `Boundary` and freezes during sub-ticks, so the fabric must emit no
   analog interconnect).
5. Wire all leaf VCC/GND to a **shared coarse rail-node set** so the analog matrix carries O(#rails),
   not O(#cells) — the §5 supply-cost point in the hierarchy doc.

### 4.2 Detecting state structurally

A2 needs to identify storage nodes. Three recognizers, cheapest first:
- a placed **`ELEM_DFF`** or **registered `ELEM_BEHAVIORAL`** in the cell → map 1:1 to a registered
  LUT (trivial; this is the common "register built from stock flops" case),
- a **cross-coupled gate pair** (combinational cycle of length 2 in the cell graph) → one bistable →
  one registered LUT with the loop broken at the `Q` feedback net,
- general **feedback loops** (graph cycle detection on the netlist) → each minimal feedback set is a
  state bit; refuse (keep analog) if the loop is not a clean bistable (e.g. a ring oscillator), with
  the C4 failure-reason UX.

### 4.3 The global digital-keep policy

`flattenUserIcs` currently collapses per-instance on `fidelity:"behavioral"`. A2 adds the
scale policy: at CPU scale, default placed characterized cells to the fabric face and keep them
digital, raising the **global** sub-tick rate to cover the deepest combinational cone (hierarchy §2.7;
note the slot-2 sub-tick-vs-rating collision, §2.7a / build-plan D11, and the queued slot move in
TODOS.md). A synchronous design (registers between every cone) holds at `subtick_rate = 1`, which is
why a clocked CPU is the friendly target.

---

## 5. Determinism & golden — safe by construction

Re-checked against the fold order (`lib.rs:7353-7404`: tick → per-node `u8 net_level` for Digital /
`f64 node_v` otherwise → DFF → SAMPLER → COMPARATOR → `beh_state`, **append-only, no params, no
`failed_elements`**):

- A **registered** LUT folds `Q`/`clk_prev` into `beh_state` **append-only after the comparator block**
  (`lib.rs:7391-7402`); a **combinational** LUT folds an all-zero state block. Both are the *existing*
  prog-4 element — Option A adds **no new hashed field**.
- The golden circuit **places no behavioral block**, so `flattenUserIcs` early-returns (`userIc.ts`
  `!any` guard) and the fold is zero-byte. `0xeaac_3764_99e4_fa24` cannot move.
- The sweep runs on a **separate scratch `Simulation`** (`characterize.ts:110`), never the hashed
  global instance — exactly as P7 already does. (Build-plan P6's `ScratchSim` newtype that does not
  expose `snapshot_hash` is the structural hardening for this; A1/A2 do not depend on it but should land
  after it.)
- Route a1 lowering is **pure web graph→element** emission to existing prog-4 elements — **no
  `sim-core` change**. (Route b, a new wider `BEH_PROG_*`, would be append-and-default-off like
  programs 1–8 — not needed for A1/A2.)

`params` are not hashed (`PARAM_STRIDE=8`, build-plan D3), so the `mode`/sub-tick slots Option A writes
never touch the contract.

---

## 6. Tests (extend the existing idioms)

- **Face-equivalence (the load-bearing one):** for each characterized sequential cell, run the
  discrete (FET/gate) face and the registered-LUT face on two scratch sims, drive a clock sequence, and
  assert **identical `Q` after each edge** (extends the P7/P8 combinational `netlist.test.ts:137/319`
  seal-equivalence idiom to "equal committed level *and* equal Q-after-edge").
- **A2 fabric equivalence:** a counter / shift-register cell, discrete vs fabric, over N clocks →
  identical state trajectory.
- **Cross-instance hash (determinism):** a placed registered prog-4 LUT stepped N ticks twice → equal
  `snapshot_hash` (build-plan D7), once driving a pure-Digital net, once an analog/Boundary load.
- **Self-dependence detector:** unit-test that a toggle flop is refused to A1 and routed to A2; a D
  flop is accepted by A1.

---

## 7. Phasing summary

| Phase | Scope | Risk | `sim-core`? |
| --- | --- | --- | --- |
| **A1 ✅ landed** | single registered LUT, D-type family (sequential sweep, fail-safe guard, `mode:1`) | medium | none |
| **A2** | fabric of LUT+FF for state-dependent / multi-bit (structural lowering, `Q` feedback, state detection, global digital-keep) | high | none (route a1) |

**A1 as built (2026-06-26).** No reset pin is required after all: instead of forcing Q via reset, the
sweep clocks several edges and requires Q to **converge** (a pure D-type settles to `f(inputs)`
regardless of start state; a self-dependent toggle/counter keeps changing → refused). This is simpler
and strictly fail-safe. `classifySequentialSamples` is the pure decision (headless-tested);
`sequentialSweepNetlist` is the tested wiring; `characterizeSequential` drives the live wasm sweep
(app-verified). A2 is the remaining frontier (self-dependent register-with-load, counters, multi-bit).

Both are golden-safe by construction. A1 is a contained extension of `characterize.ts` +
`sweepNetlist.ts` and the natural next slice after P7. A2 is the substantial compiler-ish work and the
real CPU-scale payoff; it should land only after the local-solve (build-plan P6) so a collapsed
sequential cell still shows live inner numbers when opened.

---

## 8. Cross-references

- `docs/cell-characterization-and-integration-hierarchy.md` — the conceptual arc (dual-face cell §2,
  live inner telemetry §3, integration hierarchy §4), the registered-LUT ceiling, the equivalence
  contract, the determinism statement §6.
- `docs/cell-characterization-build-plan.md` — the full P0–P9 plan; **P8** (registered 1-bit D-type +
  multi-output) and **P9** (wide structural fabric) are A1 and A2 respectively, with the determinism
  re-verification and the `ScratchSim` hardening this doc assumes.
- `docs/phase4-lut-and-inverter-element.md` — the LUT element / inverter teardown the runtime leans on.
- `web/src/lib/characterize.ts`, `web/src/lib/sweepNetlist.ts` — the as-built combinational sweep this
  plan extends; `crates/sim-core/src/lib.rs` `beh_lut_step` (`:1554`) — the registered runtime already
  in place.

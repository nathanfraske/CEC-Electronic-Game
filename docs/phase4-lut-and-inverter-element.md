<!-- SPDX-License-Identifier: Apache-2.0 -->

# Phase 4 — the Inverter element (CEC9002) and the 4-LUT worked example

**Status:** design (owner-directed, 2026-06-24). Two linked Phase-4 features of the recursive-IC
LoD plan (`docs/recursive-ic-lod-plan.md` §Phase 4). Design 1 promotes the SOT-23-5 CMOS inverter
to a first-class built-in part; Design 2 is the 4-input LUT teardown — INVERTER → SRAM config bit →
MUX2 → 16-bit SRAM column + 16:1 mux tree — built from realistic cells, made tractable by Phase 1's
recursive nesting. Both are **golden-safe**; the contract is stated in §3 and re-checked per cell.

This is a design doc, not an implementation. It records the decision, the determinism contract, the
cell hierarchy with depth/instance counts, and the worked-example data shape. Read it with
`CLAUDE.md` (Component grades/tiers; Device variants; "Powered logic gates `ELEM_GATE`"), the SRAM
refsheet (`docs/ui/new-part-refsheets.md` §"SRAM cell"), and the LUT card
(`docs/ui/parts/lut-ic.html` / `lut-guidesheet.md`).

---

## 0. Context the design leans on (verified in-tree)

- **The gate is a real 5-pin powered IC.** `ELEM_GATE` (sim type 17): a=OUT, b=IN1, c=IN2, d=VCC,
  e=GND. Rail = `V(VCC) − V(GND)` (`gate_rails`); inputs threshold relative to GND; output swings
  `V(GND)..V(VCC)`. An unwired VCC floats to ~0 → rail `< GATE_MIN_RAIL` (0.3 V) → the gate is
  **dead** (output released, Z). The inverter `NOT` is the single-gate form: pins `[Y, A, NC, VCC,
  GND]` (pin 2 is the package no-connect, ignored by the core for NOT/BUF). (`crates/sim-core/src/lib.rs`,
  `web/src/lib/graph.ts` `PART_KINDS.NOT`, `web/src/lib/netlist.ts` `GATE_AUX`/`FIVE_PIN_TYPES`.)

- **The digital domain is a deterministic unit-delay engine.** `Sim::eval_digital` reads each gate's
  inputs from the **committed previous-tick** node voltages (one tick of propagation delay),
  evaluates a four-state boolean, and folds drivers per net via `combine` in **element-index order**
  (order-independent, deterministic). A feedback loop of gates **oscillates** tick-to-tick rather
  than deadlocking — physically honest, and the basis of every latch in the part set. This is the
  cornerstone for the SRAM bit (§5): a cross-coupled inverter pair settles to one of two stable
  states, exactly like the existing `SRL` (SR latch) composite of two cross-coupled NORs.

- **Composites expand to gates with no new sim element.** `CEC_COMP` in `netlist.ts` maps a
  house-IC kind to a list of `GateStep`s (`[func, out, in1, in2]`) plus optional `extra` raw element
  steps; `buildNetlist` routes the part's VCC/GND pins to every sub-gate's d/e and emits one
  `ELEM_GATE` per step through private internal nodes. `MUX2` (CEC2031) already exists this way:
  `Y = A·¬SEL | B·SEL`, four gates (NOT, two ANDs, OR), `internal: 3`. This is the golden-safe
  pattern Design 1's "expansion" option reuses.

- **Sealed user ICs flatten recursively to a fixed point (Phase 1).** `flattenUserIcs` inlines a
  placed sealed IC's inner circuit before `buildNetlist`, fusing frame pins to the placed instance's
  pins; an inner circuit may itself place sealed ICs, inlined in waves. Bounds: `MAX_DEPTH = 24`,
  **`MAX_INSTANCES = 4096`** (hard budget on total inlined instances — flatten runs on every netlist
  rebuild). A board with no nesting settles in one wave, byte-identical to the old single pass.
  (`web/src/lib/userIc.ts`.) The §6 instance count is checked against this 4096 budget.

- **Tier presets are param-block bundles.** `tiers.ts` already grades `NM`/`PM` by transconductance
  `Kp` (slot 0): budget 0.01, mid 0.02 (= sim-core `MOS_KP` default), high 0.04, lab 0.08 A/V².
  TRANSIENT-affecting, so Real-mode-gated in `buildNetlist` (`TRANSIENT_TIER_KINDS`). Any inverter
  tier inherits this, applied to its two constituent FETs.

---

## Design 1 — CEC9002 → a built-in "Inverter" element (`INV`)

The owner: *"those [SOT-23-5 inverter] frames will be the new Inverter element."* Today an inverter
is either (a) the `NOT` gate part (a 5-pin powered `ELEM_GATE`, behavioral), or (b) a sealed user IC
the player built as a PMOS+NMOS pair in a SOT-23-5 die (the CEC9002 in the owner's SRAM context).
Promote it to a **first-class built-in kind** so it sits in the part bin, carries tiers, opens to its
two transistors in the zoom-to-open view, and is the named leaf of the LUT teardown.

### 1.1 The decision: expansion, not a new `ELEM_*` (recommended)

Two implementations were weighed.

**Option A — a new `ELEM_INVERTER` sim-core element (type 26).** A dedicated digital element: a=OUT,
b=IN, d=VCC, e=GND, output = ¬quantize(IN) over the rail, one tick of delay. Essentially `ELEM_GATE`
with func=NOT pre-baked.
- *Cost:* touches `sim-core` — a new `ELEM_*` constant, a new arm in `eval_digital`/`stamp_digital`,
  the ~15 source/element-type match sites (`is_*`, the OP/transient/AC stamp dispatchers,
  `flag_and_clamp_fails`), and `sim-protocol` if the wire types enumerate kinds. Every one is a
  determinism surface.
- *Determinism:* golden-safe **only** if the element is appended after the existing types and is
  default-absent from the golden netlist (the golden has no inverter) — see §3. But it earns nothing
  the gate engine doesn't already do.
- *Verdict:* **rejected.** It duplicates `ELEM_GATE`'s NOT for no behavioral gain and adds
  determinism surface area for nothing. The golden rule ("keep `sim-core` changes minimal; prefer the
  no-new-element path") points away from it.

**Option B — a `buildNetlist` expansion, no new sim element (recommended).** `INV` becomes a new
*web kind* that expands at compile time, in one of two flavors:

- **B1 — expand to one powered `ELEM_GATE` (func=NOT).** `INV` is, electrically, exactly the `NOT`
  gate. Add it to `CEC_COMP` (or, simpler, a one-line alias that emits the same gate as `NOT` with the
  inverter's own pinout). Behavioral fidelity = today's inverter: ideal-ish digital, one tick delay,
  dead when unpowered. Zero transistors in the netlist.

- **B2 — expand to the real PMOS+NMOS pair (the CMOS inverter).** `INV` expands to `ELEM_PMOS` +
  `ELEM_NMOS` sharing a drain (= OUT), sources at VCC/GND, gates tied to IN — the genuine
  complementary push-pull stage the CEC9002 die is. This is an analog (Newton) expansion through
  `CEC_COMP.extra` raw steps (`{ t: ELEM_PMOS, … }`, `{ t: ELEM_NMOS, … }`), reusing the same
  machinery the tri-state buffer already uses for its `ELEM_ASWITCH`+resistor extras.

**Recommendation: ship B2 as the `INV` element, with B1 retained as exactly today's `NOT` gate.**
Rationale:
1. **The owner's framing is physical** — "those frames [the PMOS+NMOS SOT-23-5 die] will be the
   Inverter element." The CEC9002 *is* two FETs; the built-in should be the same two FETs, not a
   behavioral box. B2 makes `INV` the real CMOS stage.
2. **It is the teardown's true leaf.** The LUT (§4) descends to silicon; if `INV` were a behavioral
   gate (B1) the zoom-to-open recursion would bottom out at a digital box, not at transistors. B2
   gives Phase 2/3 real PM/NM devices to render and (Phase 3) hand off to the silicon tier.
3. **Tiers fall out for free.** `INV`'s tier maps onto its two FETs' `Kp` (the existing `NM`/`PM`
   tier presets), so a budget inverter is genuinely weaker (softer edges, lower drive) and a lab
   inverter genuinely stiffer — a real non-ideality, not a cosmetic one. A behavioral `NOT` can't
   express that.
4. **Still no new sim element.** `ELEM_PMOS`/`ELEM_NMOS` already exist; B2 only adds a `CEC_COMP`
   entry. The golden is untouched (§3).

The cost of B2 over B1 is that an inverter now adds **two Newton elements** instead of one digital
gate, and needs a VCC/GND reference to bias (an unwired-VCC inverter has both FETs off → OUT floats,
which is the correct CMOS behavior and mirrors the gate's dead-rail rule, but is *not* the gate's
explicit Z-release; it is a high-impedance node). For the LUT's instance budget this matters and is
accounted in §6 — which is **why the LUT is built from SRAM-bit cells and MUX2s (gate-level
composites), with the `INV` element appearing only inside the SRAM-bit cell**, keeping the
transistor count bounded. (If a future profiling pass shows the LUT's FET count is too heavy for the
flatten budget or the solve, `INV` inside the SRAM bit can be swapped to B1 with no API change — the
pinout and tiers are identical; only the expansion target differs. The design keeps that door open.)

### 1.2 Pins and package (the 4-pin option)

A CMOS inverter needs four electrical nodes: **A** (in), **Y** (out), **VCC**, **GND**. The real
74LVC1G04 is SOT-23-5 with one no-connect (the `NOT` part models this: pin 2 = NC). Phase 4's "4-pin
package option" (`recursive-ic-lod-plan.md` §Phase 4) exists precisely so an inverter need not waste
a pin.

**Recommendation:** ship `INV` with a **4-pin package** (e.g. SOT-323-4 / SC-70-4, or the generic
4-lead die-frame footprint), pins ordered to keep the expansion map direct:

| pin index | label | role |
| --- | --- | --- |
| 0 | `Y` | output (the shared PM/NM drain) |
| 1 | `A` | input (both gates) |
| 2 | `VCC` | positive supply (PM source) |
| 3 | `GND` | ground (NM source) |

This drops the vestigial NC of the SOT-23-5 `NOT`. The package option is a `packages.ts` addition
(a 4-lead archetype + its `packageLayout`), consumed by the new kind's `PartKind` exactly as the
existing parts consume theirs. The five-tier IC glyph and the zoom-to-open replica both read this
pinout. (The existing `NOT` gate part stays as-is — a 5-pin SOT-23-5 behavioral inverter — so old
boards/the golden are untouched; `INV` is the new, transistor-true, 4-pin sibling.)

> **Naming.** Kind tag **`INV`** (display "Inverter"). Distinct from `NOT` (the behavioral gate) so
> both coexist; the part bin shows `INV` as "Inverter (CMOS)" with the violet/`ok` logic tint and
> the inverter glyph. The auto-id `CEC9002` the owner used for the sealed prototype is *retired into*
> this built-in — i.e. the built-in supersedes the user-IC prototype; any saved board still carrying
> a literal `CEC9002` sealed def keeps working (it is a user IC, resolved from its embedded `userIcs`),
> but new placements use `INV`.

### 1.3 The expansion (B2), concretely

`INV` joins `CEC_COMP` with no gates and two raw FET steps. Pins `Y(0) A(1) VCC(2) GND(3)`:

```ts
// Inverter (CEC9002): pins Y(0) A(1) VCC(2) GND(3). A real CMOS complementary pair —
// PMOS (source=VCC, drain=Y, gate=A) pulls Y up when A is low; NMOS (drain=Y, source=GND,
// gate=A) pulls Y down when A is high. The shared drain Y is the push-pull output. No gates,
// no new sim element (ELEM_PMOS/ELEM_NMOS already exist); golden-safe. Tiers map onto the two
// FETs' Kp via the standard NM/PM tier presets (applied in Real mode in buildNetlist).
INV: {
  internal: 0,
  vccPin: 2,
  gndPin: 3,
  voutPin: 0,          // Y is the output (for vAcross)
  primary: 0,          // the PMOS backs the part's glyph current
  gates: [],
  extra: [
    // ELEM_PMOS (12): drain=Y(0), source=VCC(2), gate=A(1). value unused (square-law model).
    { t: 12, a: 0, b: 2, c: 1, d: 0, e: 0, value: 0, aux: 0 },
    // ELEM_NMOS (11): drain=Y(0), source=GND(3), gate=A(1). value unused.
    { t: 11, a: 0, b: 3, c: 1, d: 0, e: 0, value: 0, aux: 0 },
  ],
},
```

Notes that make this drop-in:
- The expander already resolves `extra` terminal refs as **pin indices** (≥0) and routes them through
  the net union-find — no new resolution path. The FETs use `a`/`b`/`c` only (d/e = ground, ignored),
  exactly as a standalone `NM`/`PM` does.
- **Tiers.** To apply the inverter's `tier` to its two FETs, `buildNetlist`'s composite-emit loop
  passes the part's tier into each raw FET step's param block via `tierParams("NM"/"PM", tier)` when
  `t ∈ {11,12}` and the mode is Real — a small, local extension of the existing per-element param
  emission (the same `param_or` slot-0 `Kp` the standalone FETs read). Mid-range = the `MOS_KP`
  default, so a default-tier inverter is the sim-core nominal CMOS stage. (Alternatively, add an
  `INV` row to `TIER_PARAMS` and fan it onto both FETs; either keeps mid = default.) Add `INV` to
  `TRANSIENT_TIER_KINDS` so the tier bites only in Real mode.
- **Zoom-to-open / glyph.** Because `INV` is a `CEC_COMP`, `compositeInternals` records its two FET
  sub-elements (their indices + resolved nodes), so the zoom-to-open mini-board already draws the two
  real transistors with live currents (the same path `MUX2`/`ADC` use). The five-tier glyph follows
  `docs/ui/parts/inv-ic.html` (the canonical 74LVC1G04 template) — symbol (∇ with bubble) → flow
  (push-pull) → valves (the complementary PM/NM pair) → device (the two-FET schematic) → silicon (the
  CMOS cross-section). No new glyph spec; reuse the existing inverter refsheet, re-pinned to 4 leads.

### 1.4 What changes, file by file

- `web/src/lib/packages.ts` — a 4-lead package archetype + `packageLayout` (the "4-pin package
  option").
- `web/src/lib/graph.ts` — `PART_KINDS.INV` (4 pins `[Y, A, VCC, GND]`, `hasTiers` true, logic tint).
- `web/src/lib/netlist.ts` — `CEC_COMP.INV` (the two-FET expansion above); the composite-emit loop
  threads `tier` → FET `Kp` (Real mode).
- `web/src/lib/tiers.ts` — `INV` in `TRANSIENT_TIER_KINDS` (and optionally a `TIER_PARAMS.INV` row
  fanned to both FETs); mid-range = the FET default so the golden is untouched.
- `docs/ui/parts/inv-ic.html` — re-pinned to the 4-lead package (or a new `inv4-ic.html` beside it).
- **No `sim-core` / `sim-protocol` change.**

---

## 3. The golden contract (one statement, both designs)

> **The golden snapshot hash `0xeaac_3764_99e4_fa24` does not move.**

Why each path is safe:

1. **No new `sim-core` element, no new `params` slot.** Both designs are `buildNetlist` compositions
   over **existing** element types: `ELEM_GATE` (17), `ELEM_PMOS` (12), `ELEM_NMOS` (11), `ELEM_DFF`
   (19 — only if a registered SRAM bit is chosen, §5). No new `ELEM_*` constant, no new match arm in
   the core, no new param slot. The slot map in `tiers.ts` stays in lockstep with `Element::params`
   because no slot is added — the inverter reuses the FET `Kp` slot (0).
2. **The golden netlist contains none of these parts.** The golden run (`run_is_reproducible` /
   `golden_snapshot_hash_is_stable`) is a fixed circuit with no inverter, no LUT, no SRAM bit. None
   of §1–§6 emits an element into that circuit, so its element arrays — and its FNV-1a snapshot hash
   — are byte-identical. New parts only add capability; they never alter an existing netlist.
3. **Tiers are mid-default and Real-gated.** `INV`'s tier maps to FET `Kp`; mid-range = `MOS_KP`
   (the sim-core default), and the tier is applied only in Real mode (`TRANSIENT_TIER_KINDS`), so a
   default-tier / Ideal-mode inverter is the exact nominal CMOS stage — no parameter deviation, no
   hash change.
4. **The SRAM "stored bit" never enters the hash as new physics.** The realism dial (§5) sets an
   *initial condition* of an existing bistable (or an `aux` data word of an existing `ELEM_DFF`); it
   is the value of state the core already hashes, not a new hashed field. If the bit is realized as a
   cross-coupled inverter latch, its only state is the net's discrete `Level` (already a `u8` in the
   snapshot hash) — present **only** in a circuit that places the cell, never in the golden.
5. **Flatten stays a no-op when nothing is placed.** The LUT example places sealed ICs, but
   `flattenUserIcs` is a strict no-op on any board (the golden's included) that places none — so the
   recursive nesting cannot perturb the golden either (Phase 1's invariant, re-affirmed).

**The recommended path (B2, expansion) holds this contract with zero `sim-core` edits.** That is the
decisive reason to prefer it over a new element: the new-element path (Option A) *can* be made
golden-safe by append-and-default-off, but it spends determinism surface to buy nothing.

---

## Design 2 — the 4-LUT worked example (built from realistic cells)

A 4-input look-up table is "any function of 4 inputs": a 16-entry truth table read by a 4-bit
address. Built physically it is a **16-bit SRAM column** (the 16 stored truth-table bits) feeding a
**16:1 multiplexer tree** addressed by the four inputs. We build it bottom-up as a **standard-cell
hierarchy of sealed ICs**, each nesting the smaller one — which Phase 1's recursive flatten makes a
single buildable artifact instead of a 100-transistor flat canvas.

> The game already ships a behavioral `LUT` part (`ELEM_BEHAVIORAL` prog 4, a 16-bit truth table in
> `aux`). **This worked example is the opposite teaching move:** show the LUT's *insides* — that the
> magic truth-table box is really memory cells + a mux tree — built from realistic parts. The two
> coexist: the behavioral `LUT` is the efficient primitive you place in a design; the teardown is the
> lesson in what it is. (Same relationship the flash-ADC discrete remake has to its old behavioral
> form, ADR 0005 phase 4.)

### 4. The cell hierarchy (each cell a sealed IC nesting the smaller ones)

Five tiers of standard cell, each sealed via the IC maker, each placing instances of the tier below:

| # | cell (sealed IC) | built from | nesting depth (this cell as root) | pins |
| --- | --- | --- | --- | --- |
| L0 | **`INV` element** (Design 1) | PMOS + NMOS (primitives) | 0 (a built-in, not a user IC) | Y, A, VCC, GND |
| L1 | **SRAM config bit** (`CEC_SRBIT`) | 2× `INV` (cross-coupled) + 1 access switch | 1 | Q, D, WE/SET, VCC, GND |
| L2 | **MUX2** (built-in `MUX2`, CEC2031) | 4 powered gates (NOT, 2×AND, OR) | 0 (built-in composite) | Y, A, B, SEL, VCC, GND |
| L3 | **LUT-nibble / 4:1 slice** (`CEC_LUT4SLICE`) | 4× `CEC_SRBIT` + 3× `MUX2` (a 2-level mux of 4 bits) | 2 | Y, S0, S1, VCC, GND, (4 bit-set lines) |
| L4 | **4-LUT** (`CEC_LUT16`) | 4× `CEC_LUT4SLICE` + 3× `MUX2` (top mux level) + the 16-bit column | 3 | Y, I0, I1, I2, I3, VCC, GND |

Two structural choices keep this realistic *and* bounded:

- **L1 (SRAM bit) is the realism leaf that uses the `INV` element.** It is the only place real
  transistors appear in the LUT, so the FET count is `16 bits × 2 FETs = 32` (plus access switches),
  not "every gate is transistors." This is the §6 budget lever.
- **L2 (MUX2) and the mux tree stay gate-level** (the existing `MUX2` composite). A 16:1 mux is a
  binary tree of 15 MUX2s (8 + 4 + 2 + 1) across two LUT-slice levels; gate-level keeps each canvas
  small and the solve light, and it is exactly how an FPGA's routing mux is taught.

So the **4-LUT** = a 16-bit SRAM column (16× `CEC_SRBIT`) + a 16:1 mux tree (15× `MUX2`), packaged as
nested slices. Nesting depth from the 4-LUT root down to a transistor: `LUT16 → LUT4SLICE → SRBIT →
INV → FET` = **4 levels of sealed/composite nesting above the FET** — comfortably inside
`MAX_DEPTH = 24`.

### 5. The SRAM config bit and its realism dial

**The cell.** One SRAM bit is the bistable core the owner described: **two inverters mouth-to-tail**
(each drives the other's input), forming a latch with two stable states (Q, ¬Q), plus an **access
device** (the word-line-gated switch) to write it. Built from two `INV` elements (Design 1) and one
access switch, sealed as `CEC_SRBIT`. This is precisely the SRAM refsheet's "device" tier (two CMOS
inverters cross-coupled) — "Built from the existing gate/MOSFET elements … zero core code"
(`new-part-refsheets.md` §SRAM cell), and it is the same regenerative feedback the existing `SRL`
composite already settles deterministically in the digital domain.

**Determinism of the bistable.** Cross-coupled inverters form a feedback loop. The digital engine
(`eval_digital`) reads inputs from the **committed previous tick** and resolves drivers in
element-index order, so the loop is deterministic and reproduces bit-for-bit; a perfectly balanced
metastable tie **oscillates** rather than deadlocking (physically honest, and the same behavior the
SR latch relies on). With the B2 (FET) inverter the two stages bias through VCC/GND and the loop
settles by the Newton solve + the unit-delay digital path together, exactly as the gate latches do.

**The realism dial — setting/showing a stored bit without a full bitstream.** A real LUT is loaded by
a configuration bitstream shifting 16 bits into the column at power-up. Simulating a shift-register
bitstream write is out of scope (and not the lesson). Instead, **the stored bit is a settable
property of the cell, abstracting the write** — three escalating options, recommended in order:

1. **Recommended — a `SET` input + a one-shot "preset" at power-up, driven by the cell's config.**
   The `CEC_SRBIT` exposes a `WE/SET` pin and carries a 1-bit datum (the cell's intended stored
   value). On the board this is shown as a **toggle in the inspector** ("Stored bit: 0 / 1") — the
   realism dial. Under the hood the cell forces its Q node to the chosen state through the access
   switch for the first tick(s) (a preset), then releases; the bistable holds it. This *is* the write,
   collapsed to "the bit you configured," with no shift register. It reuses `Component.word` (or a
   new `bit` boolean) on the cell's placed instance — exactly the pattern the behavioral `LUT`
   already uses for its 16-bit `word`.
   - **Determinism:** the preset is a deterministic function of the cell's config + the tick (an
     initial condition), not a new hashed physics field. Golden-safe per §3.4.
2. **Simpler fallback — realize the bit as an `ELEM_DFF` (type 19) with its stored value in `aux`.**
   The existing JK-FF composite already emits a raw `ELEM_DFF` step; an SRAM bit could be a DFF whose
   committed `Q` is the configured bit, clocked once at load. This trades the cross-coupled-inverter
   *teaching* fidelity for a one-element cell. Use only if the inverter-latch solve proves heavy at
   16× scale. Still golden-safe (DFF state is already hashed; absent from the golden).
3. **Pure-display fallback — the bit is a fixed logic source (a tied VCC/GND through a buffer).**
   If even a settable latch is more than the example needs, the 16 bits become 16 fixed sources
   (each tied high or low per the truth table), and the cell is "frozen" config. Loses the bistable
   lesson entirely; mentioned only for completeness. Not recommended.

**Recommendation:** ship **option 1** — a real two-inverter bistable with a `SET`-at-power-up preset
driven by an inspector "Stored bit" toggle. It is the honest cell (regenerative feedback, holds
without refresh), it teaches static memory, and the dial is a single toggle that stands in for the
bitstream. The 16 toggles of a LUT-slice column become the LUT's truth table — which is the whole
point: **you set the 16 stored bits and you have programmed the LUT.**

### 6. Instance count vs the flatten budget (the critical check)

`flattenUserIcs` inlines every nested instance on **every** netlist rebuild; the hard cap is
**`MAX_INSTANCES = 4096`**. The 4-LUT must flatten under it. Counting *inlined instances* (each
sealed-IC placement that flatten expands — built-in composites like `MUX2`/`INV` are **not** user-IC
instances and so do **not** count against this budget; they expand inside `buildNetlist` after
flatten):

**User-IC instances inlined by `flattenUserIcs` (the budget that matters):**

| sealed user-IC cell | count in the 4-LUT | note |
| --- | --- | --- |
| `CEC_LUT16` (the placed top cell) | 1 | the instance the player drops |
| `CEC_LUT4SLICE` | 4 | one per input-pair slice |
| `CEC_SRBIT` | 16 | the 16 truth-table bits |
| **total user-IC instances** | **21** | **≪ 4096** |

So the recursive flatten inlines **21 user-IC instances** to a fixed point — three orders of
magnitude under the 4096 budget, and the wave count (LUT16 → LUT4SLICE → SRBIT = 3 waves) is far
under `MAX_DEPTH = 24`. The budget is not remotely threatened, even if a future curriculum nests
several 4-LUTs.

**Resulting sim elements after flatten + `buildNetlist` composite expansion (for solver sizing, not
the flatten budget):**

| source | per-unit elements | units | elements |
| --- | --- | --- | --- |
| `CEC_SRBIT`: 2× `INV` (2 FETs each) + 1 access switch | 4 FET + 1 switch = 5 | 16 | 80 |
| `MUX2`: 4 powered `ELEM_GATE` | 4 | 15 (8+4+2+1) | 60 |
| wiring/glue (pull-ups, the preset path) | ~1 | ~16 | ~16 |
| **total solver elements (order of)** | | | **~150–160** |

~32 FETs (16 inverter-pairs' worth that are the SRAM bits) + ~60 powered gates is a substantial but
tractable netlist — comparable to the discrete flash-ADC composite's comparator bank. If profiling
finds the 32 Newton FETs too heavy per frame, the §1.1 fallback (swap the SRAM-bit inverters to the
B1 behavioral gate) drops the FET count to zero with no change to the example's structure, pins, or
the player-facing build — the LoD/teardown stays intact (it just bottoms out at a digital inverter
instead of a CMOS pair). The design is built so that lever exists.

### 7. How the MUX is built

Use the **existing `MUX2` composite** (CEC2031, `Y = A·¬SEL | B·SEL`, four powered gates). A 16:1 mux
is a binary tree of 15 MUX2s addressed by the four LUT inputs (I0 selects the bottom level, …, I3 the
top). This is the recommended path: it is the standard FPGA routing-mux teaching, keeps each canvas
small, and adds no transistors.

A **transmission-gate alternative** (CMOS pass-gate mux from PM+NM pairs, à la `docs/ui/parts/
xorpass-ic.html`) is *possible* and more physically "FPGA-like" (real LUTs use pass-transistor mux
trees), but each TG mux node is 2 FETs and bidirectional, multiplying the Newton FET count and
needing level-restoring buffers — it blows the solver sizing for marginal teaching gain at this scale.
**Recommendation: gate-level `MUX2` tree for the buildable example; mention the pass-transistor mux
as the silicon-tier reality in the glyph/guidesheet** (so the *lesson* that real LUT muxes are
transmission gates is taught, without paying for 30 FETs in the live solve).

### 8. The worked-example data (`examples.ts` + `circuits/`)

The example ships exactly like `pot-dimmer`: **built in-game, Saved, and pasted into a tiny
`circuits/*.ts` wrapper**, then registered via `savedExample(...)` in `EXAMPLES`. The key difference
from `pot-dimmer` is that this circuit **places sealed ICs**, so its `SavedCircuit` carries the
`userIcs` array (the embedded `CEC_SRBIT` / `CEC_LUT4SLICE` / `CEC_LUT16` definitions) — `fromSaved`
re-registers them before the graph loads (`if ("userIcs" in saved) registerUserIcs(...)`), and
`userIcsForGraph` already descends nested dies so the save embeds the whole cell library transitively
(top cell + every cell nested inside it), even the ones that never appear as a top-level board
component.

```ts
// web/src/lib/circuits/lut4-teardown.ts
// SPDX-License-Identifier: Apache-2.0
// The 4-input LUT, built from realistic cells: a 16-bit SRAM column (16× cross-coupled-inverter
// bits) feeding a 16:1 MUX2 tree, packaged as nested sealed cells (CEC_SRBIT → CEC_LUT4SLICE →
// CEC_LUT16). Saved straight off the board. The embedded `userIcs` carry the whole cell library
// (transitively, via userIcsForGraph), so the placed CEC_LUT16 resolves on a fresh load.
import type { SavedCircuit } from "../examples";
const circuit: SavedCircuit = {
  format: "cec-circuit", version: 3,
  graph: { components: [ /* a placed CEC_LUT16 + the four inputs + VCC/GND + a Y readout */ ],
           wires: [ /* … */ ], junctions: [], netLabels: [ /* V(I0..I3), V(Y) */ ],
           nextComponentId: /*…*/, nextWireId: /*…*/, nextJunctionId: /*…*/, nextNetLabelId: /*…*/ },
  userIcs: [ /* CEC_LUT16, CEC_LUT4SLICE, CEC_SRBIT definitions (plain JSON) */ ],
};
export default circuit;
```

Registered in `examples.ts`:

```ts
import lut4Teardown from "./circuits/lut4-teardown";
// … in EXAMPLES:
savedExample({
  id: "lut4-teardown",
  name: "Inside a LUT",
  blurb:
    "A LUT — the FPGA's 'any function of 4 inputs' box — is really memory plus a multiplexer. Sixteen SRAM bits hold the truth table; a 16-to-1 mux tree, steered by the four inputs, reads out the bit you addressed. Set the sixteen stored bits and you have programmed the function.",
  watch:
    "the four inputs as an address: flip them through 0000…1111 and watch the selected SRAM bit light the path down the mux tree to Y. Change a stored bit (the inspector toggle on a cell) and that row of the truth table flips.",
  saved: lut4Teardown,
  // bespoke steps: seal an INV pair into an SRAM bit, tile 16 of them, wire the MUX2 tree, set the table.
  steps: [ /* … */ ],
});
```

**Authoring order (in-game, then save):** build the `INV` (already a built-in) → drop two into a
die, cross-couple, add the access switch, name the pads (Q/D/SET/VCC/GND), **Seal → `CEC_SRBIT`** →
build a 4:1 slice from 4 `CEC_SRBIT` + 3 `MUX2`, **Seal → `CEC_LUT4SLICE`** → tile 4 slices + 3
`MUX2` for the top level, **Seal → `CEC_LUT16`** → place one `CEC_LUT16`, wire the 4 inputs + VCC/GND
+ a Y readout, set the 16 stored bits to the desired truth table, **Save**. Paste the JSON into the
wrapper. Phase 1's recursive flatten makes the placed `CEC_LUT16` expand all the way down on build;
Phase 2's recursive zoom-to-open lets the player descend LUT → slice → bit → inverter → transistor.

---

## 9. Validation gates (before handing back)

Both designs are web-only (no `sim-core`/`sim-protocol` edit on the recommended paths), but run the
full set per `CLAUDE.md`:

```
cargo fmt --all -- --check
cargo clippy -p sim-core -p sim-protocol --all-targets -- -D warnings
cargo test -p sim-core -p sim-protocol      # incl. golden_snapshot_hash_is_stable / run_is_reproducible
pnpm run build:wasm
pnpm -C web check && pnpm -C web lint && pnpm -C web build && pnpm -C web test
```

The `web/src/lib/netlist.test.ts` vitest suite is the determinism-critical web check: it verifies a
sealed IC expands to the **same netlist** as the inline circuit. Add cases that (a) the `INV` element
expands to a PMOS+NMOS pair identical to the hand-built CMOS inverter, and (b) the sealed `CEC_SRBIT`
/ `CEC_LUT16` flatten to the same element arrays as their inline equivalents — and assert the
**golden is unchanged** by the new parts (it places none).

---

## 10. Summary of recommendations

1. **Inverter element = a `buildNetlist` expansion to a real PMOS+NMOS pair (`CEC_COMP.INV`,
   Option B2), not a new `ELEM_*`.** No `sim-core` edit; the FET elements already exist.
2. **4-pin package** (`Y, A, VCC, GND`), dropping the SOT-23-5 inverter's NC — the Phase-4 "4-pin
   package option." The behavioral `NOT` gate stays as the legacy 5-pin sibling.
3. **Tiers fall out for free** by mapping `INV`'s tier onto its two FETs' `Kp` (Real-mode-gated);
   mid = the `MOS_KP` default, so the golden is untouched.
4. **Golden contract:** `0xeaac_3764_99e4_fa24` is stable — every new part is a composition over
   existing element types, the golden circuit places none of them, tiers are mid-default and
   Real-gated, and the stored bit is an initial condition of already-hashed state.
5. **4-LUT = 16-bit SRAM column (16× `CEC_SRBIT`) + a 16:1 `MUX2` tree (15× `MUX2`)**, packaged as
   nested sealed cells: `CEC_LUT16 → CEC_LUT4SLICE → CEC_SRBIT → INV → FET`.
6. **Nesting depth = 4 levels of cells above the transistor** (≪ `MAX_DEPTH = 24`); **21 user-IC
   instances** inlined by `flattenUserIcs` (1 LUT16 + 4 slices + 16 bits) — **≪ `MAX_INSTANCES =
   4096`**. ~150–160 solver elements after expansion (~32 FETs in the SRAM bits + ~60 powered gates).
7. **SRAM bit = two cross-coupled `INV` elements + an access switch**, with a **"Stored bit" inspector
   toggle** that presets the bistable at power-up (abstracting the bitstream write); golden-safe.
8. **MUX tree = the existing gate-level `MUX2` composite** (transmission-gate pass-mux noted as the
   silicon-tier reality in the glyph, not built in the live example, to bound the Newton FET count).
9. **Worked example** ships as a Saved board pasted into `web/src/lib/circuits/lut4-teardown.ts`,
   registered via `savedExample` in `examples.ts`, with the cell library embedded in `userIcs` (and
   `userIcsForGraph` carrying the nested cells transitively).
10. **Escape hatch:** if the 32 Newton FETs prove heavy, swap the SRAM-bit inverters to the B1
    behavioral gate — identical pinout/tiers/structure, zero FETs — without touching the example or
    the LoD teardown.

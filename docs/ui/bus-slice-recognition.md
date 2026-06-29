<!-- SPDX-License-Identifier: Apache-2.0 -->

# Bus-slice recognition — draw a bit-sliced IC as N gate symbols

Status: **scoped (2026-06-29); queued after the dirty-set digital-eval build.** Render + classification
only — **web-only, golden-safe, no `sim-core` change.** Captured from a code-exploration pass so the design
isn't lost. The owner ask: *"classify a block like my 4-INVERT as N identical slices on a bus and show it as
N gate symbols on the zoomed-out (sealed) symbol instead of one opaque block."*

## The idea

A user-built IC whose interior is **N copies of one leaf cell, each wired to a distinct bit of an input bus
and an output bus, sharing the control/power lines** is a *bit-sliced datapath* — an n-bit AND/OR/INV, a mux,
a register file. Today its sealed symbol is one generic block (or one characterized gate if it collapses to a
≤2-input LUT). This feature recognizes the slice array and draws the sealed symbol as **N stacked gate
glyphs** with the bus threading through, so a 4-wide conditional-inverter reads at a glance as four XOR/NOT
slices on `Binv`.

Motivating fixture: the owner's `4-INVERT` (`B-INVERT`) = 4 `XOR-Gate` slices computing `B'i = Bi ⊕ Binv`
(the B-input-invert stage of an adder/subtractor); pins `B0..B3` / `B'0..B'3` + `Binv` + VCC/GND.

## The pragmatic approach — drive detection from the bus labels (sidestep subgraph isomorphism)

General "find N isomorphic slices" is subgraph isomorphism (NP-complete). **Skip it.** A bit-sliced block is
already **bus-labeled**, and the label parser already exists — so detect from the labels, not the topology:

1. Parse the IC's pins into buses with `busWiring.parseBusLabel` / `busOfPin` (`web/src/lib/busWiring.ts:18–120`).
   Find an **input bus** and an **output bus of equal width N** (`B0..B3` → `B'0..B'3`); the leftover pins are
   the **shared lines** (`Binv`, VCC, GND).
2. For each bit `i`, walk `Bi → B'i` through the interior graph. It matches iff **every bit routes through
   exactly one internal component of the same kind**, all sharing the leftover nets, with **no cross-slice
   wiring** except the bus + shared lines.
3. The per-slice symbol = that leaf kind's recognized gate. For `4-INVERT` the slice *is* an `XOR-Gate`
   instance, so the kind tag gives the symbol directly; for a raw-transistor slice, characterize it and call
   `recognizeGate` (`web/src/lib/userIc.ts:189`).

This correctly **fails on a ripple-carry adder** (its slices share a cross-slice carry → not a clean parallel
bus), so the array symbol appears only when the structure really is a bus. That's the desired behaviour.

## Building blocks that already exist (reuse)

| Capability | Where | Note |
| --- | --- | --- |
| Sealed-symbol selection cascade | `userIc.ts:282–321` `cellSymbol`/`computeCellSymbol` | override → name → characterized LUT → sequential. **Add a "slice array" branch here.** |
| Gate recognition from a LUT word | `userIc.ts:189–223` `recognizeGate(word, inputs)` | maps 1–2-input words → `NOT`/`XOR`/`AND`/… (the per-slice identity for raw slices) |
| Draw any gate glyph at any `(cx,cy)` | `glyphs.ts:2239–2425` `drawGateBodySymbol`/`drawCellSymbol` | N glyphs = call it N times at stacked positions |
| Sealed render already has the inner graph | `board.ts:8767–8834` (`resolveUserIc`) | draws **one** symbol + routes leads by pin role + fades on zoom; the inner graph is in hand, unused for structure |
| Bus grouping by label | `busWiring.ts:18–120` | the detector's front door |
| Per-slice characterization (raw cells) | `characterize.ts:75–209` `characterizeCell` | headless-sweepable on an isolated slice subgraph |
| Subassembly model + inner graph | `userIc.ts:45–115` `UserIc { graph, pinRoles, … }` | fully introspectable at render time |

## What's new

1. **The slice recognizer** — `web/src/lib/busSlice.ts` (new): bus-label-driven, returns
   `{ gate: SymbolId, count: N, inBus, outBus, shared } | null`. The only real new logic; a heuristic, not
   graph isomorphism. Deterministic, pure function of `UserIc.graph` + pins.
2. **Slice-array branch** in `computeCellSymbol` returning the descriptor (cached by the `behavior.sig`
   content hash, `userIc.ts:157`, so it invalidates on reseal).
3. **Multi-glyph layout** in the sealed render (`board.ts:8767`): stack N `drawGateBodySymbol`s, input bus on
   the lead-in side, output bus on the lead-out side, shared control/power threaded; reuse the existing
   zoom-fade. A "bus bracket" or `×N` badge keeps it legible when N is large (cap the drawn glyphs, badge the
   rest).

## Nuances / decisions for the owner

- **XOR-slice vs NOT.** The `4-INVERT` slices are XOR (conditional invert), not plain NOT. Draw the faithful
  leaf symbol (XOR) with `Binv` shown; optionally special-case "XOR/XNOR slice whose 2nd input is a whole-bus
  shared control" → a NOT-with-invert-enable glyph (which is what a conditional inverter *is*).
- **Clean-slice requirement + fallback.** Require one leaf per bit, shared control/power, no cross-slice wires;
  otherwise fall back to the existing single-symbol / generic-block path. Never force an array.
- **Ambiguity.** A 4-bit mux is "4 one-bit muxes"; an adder is *not* a clean bus. The clean-slice test
  resolves both correctly (mux matches, adder doesn't).
- **Mixed widths / partial buses.** Match only when an input and output bus of equal width align; ignore stray
  bits.

## Scope & risk

Render + datasheet classification only — **golden-safe, web-only.** Verify by `pnpm -C web shoot --fixture
<this .json>` and Read the sealed symbol; add a `busSlice.test.ts` (the detector is a pure function over the
saved graph, headless-testable like `netlist.test.ts`). New: `busSlice.ts` + one cascade branch + the
multi-glyph layout. Medium effort, contained blast radius.

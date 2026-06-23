<!-- SPDX-License-Identifier: Apache-2.0 -->

# IC maker: frame, pinout, and sealing — authoring guide

How to turn a circuit you build from real components into a sealed IC whose zoom-in view shows that
circuit running live. This is the concrete how-to + the mechanism spec; the design rationale and the
determinism contract live in **ADR 0006** (and ADR 0005 for the zoom-to-open). The package geometry is
already implemented in `web/src/lib/packages.ts`.

## 0. The idea in one line

An authored IC = **a frame (package) + a pinout (named pins) + the circuit you build inside it**, collapsed
("sealed") into one placeable part. Sealed, it's a black box you wire like any chip; zoomed in (reality or
analogy lens) it opens to the exact circuit you built, animating live from the real netlist (ADR 0005's
"seal-as-same-netlist" — the sim runs the real parts, the seal is only the drawing). So **you author the
internals once, as a normal circuit, and both the live reality view (tier 5) and the live analogy view
(tier 3) come from it** — skinned per lens, no redrawing.

## 1. The three pieces you create

1. **The frame** — a package outline placed on the board: a chosen archetype (DIP-8, SOT-23-6, …) that
   fixes the die boundary, the pin count, the pin positions, and pin 1. It is the wall you build inside.
2. **The pinout** — the frame's pins, each a **port pad**: a numbered, nameable, connectable terminal on
   the wall. A pad is the bond-pad-to-lead of a real chip: from the **inside** you wire an internal net to
   it; on the **outside** it becomes the package lead the rest of the board connects to. Naming a pad
   (`A`, `Y`, `VCC`, …) and giving it a role (in / out / inout / power / passive / nc) IS the pinout.
3. **The circuit** — the components and wires you place **inside the frame**, wired out to the port pads.
   This is the real sub-circuit that the sealed IC will run and reveal.

## 2. The frame / package

- Pick a **package archetype** from the library (`packages.ts`, `packageOptions()`): the starter set is
  **SOT-23-3 / -5 / -6** (fixed die), **VSSOP-8**, **DIP-8 / -14 / -16** (expandable die). More drop in
  later (SOIC/TSSOP/QFP/TO-92).
- `packageLayout(archetype, pinCount)` gives the footprint (grid cells), each numbered lead's position,
  pin 1, and the **die policy**: `fixed` (the body is locked to the standard — fit your circuit inside) or
  `expandable` (the body grows to fit). The frame draws that outline + numbered pads.
- **Containment ("nothing over the walls"):** every component and wire of the circuit must sit inside the
  frame. A design-rule check flags anything crossing the boundary; you can't seal until it fits. This is a
  presentation-time check only — it never affects the simulation.

## 3. The pinout (port pads)

- Each numbered lead on the frame is a **port pad** you can wire to and edit:
  - **name** — free-form (`A`, `B`, `Y`, `VIN`, `CLK`, `VCC`, `GND`, …); shown on the sealed part's pins.
  - **role** — `in` / `out` / `inout` / `power` / `passive` / `nc` (drives the look + later DRC; `nc` = a
    lead you didn't use).
  - **number** — the package pin number (from the archetype; pin 1 marked).
- **Wire the internal circuit to the pad's inside.** When sealed, that pad's internal net is *fused* with
  the external pin node — one electrical node straight through the wall — so a board wire to pin 5 connects,
  unbroken, to whatever the pad touches inside (no buffering, exact same netlist).
- A pad with nothing wired is `nc`.

> **Implemented (die editor):** inside the die the pads sit on the **perimeter walls** at their real lead
> positions (`dieLayout` in `packages.ts`, a roomy relayout of `packageLayout` with the **same pin
> numbering/index order**, so the seal maps each pad straight through). **Naming** is live: **double-click a
> wall pin** to open a small input and name it (Enter/blur commits; blank reverts to the package number).
> The name is stored on the die-frame component (`Component.pinNames` by pin index), carried by
> `captureSeal` into `UserIc.pinNames`, and becomes the **label on the sealed chip's matching pin**
> (`userIcPartKind`, falling back to the number). Names are presentation only — never in the netlist.
> (Pad **roles** remain a future addition.)

## 4. Build the circuit inside

- Drop real parts (transistors, gates, resistors, …) inside the frame and wire them up, routing the
  boundary nets out to the port pads. Build it exactly as you'd build it standalone — it *is* a standalone
  circuit until you seal it.
- **Lay it out the way you want it read.** The sealed IC's zoom-in view preserves your component positions
  and wires, so the internal view *is* the schematic you drew (not an auto-layout). Tidy here = tidy zoom.
- **One layer of nesting:** you may use discretes and any **built-in** parts inside (a comparator, a
  buffer, gates, a flip-flop), but **not another user-authored IC**. So an authored IC is built from
  primitives + factory parts only — keeps expansion shallow and the zoom always terminates.

## 5. Seal it

- With the circuit inside the frame and the pads named/wired, **Seal**:
  - Name the part (free-form; defaults to the next **CEC9xxx** house id).
  - It collapses into a single placeable part with the package's footprint + your pinout, landing in your
    part library beside the built-ins.
  - Placed on a board it's a black box; **zoom in under the reality or analogy lens** and it opens to your
    live circuit (tier 5 reality / tier 3 analogy, skinned), the real parts animating from the snapshot.
- **Re-open / edit:** a sealed IC can be opened back to its frame+circuit to tweak and re-seal.

## 6. The rules (decided — see ADR 0006)

- **Naming:** free-form, default `CEC9xxx` (auto-incrementing).
- **Nesting:** one layer — no user IC inside a user IC (built-ins are fine).
- **Die sizing:** per-package — `fixed` packages lock the die; `expandable` ones grow to fit. Containment
  DRC applies to both.
- **Determinism:** a sealed IC expands to its real authored netlist (seal-as-same-netlist), so the solve +
  golden are exactly the discrete circuit's; the package/pinout are presentation + node-binding only, never
  hashed.

## 7. Authoring workflow (the short version)

1. Place an **IC frame**; choose a package + pin count.
2. **Name the pads** you'll use (and their roles); leave the rest `nc`.
3. **Build the circuit inside** the walls; wire its boundary nets out to the pads.
4. Fix anything the **containment DRC** flags.
5. **Seal** + name it. It's now a placeable part.
6. Place it, **zoom in** to see your circuit live; re-open to edit.

## 8. Build mapping (for implementing the mechanism)

The pieces and where they hook into the existing code:

- **Frame part** — a placeable object carrying `{ archetype, pinCount, pin1, orientation }`; its pins +
  footprint come from `packageLayout(...)` (`packages.ts`). Renders as the package outline + numbered pads.
- **Port pad** — a pad is the frame's pin: a connectable terminal (reuse the board's pin/wire machinery)
  with per-instance `{ number, name, role, net }`. Per-pad naming is the one new per-instance field.
- **Containment DRC** — a bounds check: every component/wire of the enclosed circuit inside the frame's
  footprint; surfaced as a non-blocking flag until seal.
- **Seal / generalized expander** — ADR 0006 phase 2: take the enclosed sub-graph + the pad→pin map and
  splice it into the netlist with private internal nodes, fusing each pad's net to the placed instance's
  pin node. This generalizes the hardcoded `CEC_COMP` expander to an arbitrary saved sub-graph; the
  built-in composites become the first "factory-preset" user ICs (one expander, one package model).
- **Live zoom** — already built: `internalsView.ts` renders a sealed composite's real sub-elements live,
  lens-skinned. Upgrade for authored ICs: render the internals with the board's **own component glyphs at
  the authored positions** (a mini-board), so the zoom is the schematic you drew, not an auto-grid.
- **Persistence** — save/load authored ICs (the `SavedCircuit` round-trip) into a user part bin.

## 9. Notes

- Built-in vs authored ICs converge on one expander + one package model — keep that unification in view so
  we don't grow two parallel systems.
- The refsheets stay the **codex** reference (the authored five-tier teaching pages); the in-board zoom is
  the live, built-from-parts view. They're complementary, not the same artifact.

# ADR 0006: User-defined ICs — the IC maker (packages, pinouts, sealing)

Status: proposed — design pass (no code yet). The authoring layer on top of ADR 0005's seal mechanic;
this is ADR 0005 phase 5, fully specified. Phased build path below.

## Context

ADR 0005 decides **seal-as-the-same-netlist**: a sealed chip is always solved as its real discrete
expansion (the `CEC_COMP` path), and a **zoom-to-open** board view reveals the live internals. That ADR
covers the built-in composites. The owner wants the full thing: **a designable IC maker** — let the player
build an arbitrary sub-circuit, **define its pinout and package format**, and seal it into a reusable
part. This ADR specifies that authoring layer.

What exists to build on:
- A part **kind** (`graph.ts` `PART_KINDS`) is `kind(tag, name, color, pins, defaultValue, unit, ideal)`
  where `pins = pin(label, dx, dy)` and the **footprint is derived from the furthest pin offset**. The
  "package" is today implicit in those hand-placed offsets.
- The **`CEC_COMP` expander** already turns a placed composite into its real sub-netlist with private
  internal nodes (`cecInternal`) and a pin->terminal map — i.e. it already "instantiates a fixed
  sub-circuit and binds its boundary to external pins." A user IC is the same thing with a **player-
  authored** sub-circuit instead of a hardcoded table.
- A built board is already serializable (`GraphSnapshot` / `SavedCircuit`, `lib/circuits/`).
- The **five-tier glyph spec** already names package archetypes (SOT-23-6, SC70, MSOP-8, SOT-23-8, DIP)
  and draws them with a shared `drawPkg` frame; the catalogue lists pin configs by package.

## Decision

A **user-authored IC** is a serializable, versioned definition with three separable parts:

1. **The function** — a `GraphSnapshot` (the very sub-circuit the player builds on the board: parts +
   wires + ideal values). This is ADR 0005's seal payload; at sim time it expands to real elements.
2. **The pinout** — a list of **ports**: internal nets the player designates as boundary, each carrying
   `{ pinNumber, name, role, net-ref }`. Roles: `in` / `out` / `inout` / `power` / `passive` / `nc`.
   Designating a net as a port is the only "interface" act; everything else inside stays private.
3. **The package** — a **package-format archetype** + the assignment of pin numbers to physical
   positions + pin-1 location/orientation. The package alone determines the **board footprint** (which
   cells the part occupies and where each numbered pin attaches) and the drawn package outline.

**Packages are a parametric library, not ad-hoc offsets.** Ship a small set of archetypes, each a
template that yields a footprint + a numbering convention + a pin-1 marker from a pin count:
- Dual / single in-line: **DIP-N**, **SOIC-N**, **TSSOP-N** (two rows, pin-1 top-left, CCW numbering);
  **SIP-N** (one row). Through-hole **TO-92** (3) / **TO-220** (tab) for discretes-as-parts.
- Small-outline / chip-scale: **SOT-23-3/5/6**, **SC70-5/6**, **MSOP-8**, **SOT-23-8** (the ones the
  catalogue and glyphs already use).
- Quad: **QFP-N** / **QFN-N** (pins on all four sides) for high pin counts (ADR 0003 territory).

`graph.ts`'s "footprint from furthest pin" generalizes to "footprint from the package archetype": the
archetype lays the numbered pins onto the footprint deterministically, and the **pinout binds each
package pin to an internal port net** (or leaves it `nc`). A user IC placed on the board is thus a
**dynamic `PartKind`** (pins from package+pinout) backed by a **dynamic `CEC_COMP`-style expander** (the
authored sub-graph spliced in, ports bound to the pin nodes).

## Determinism guarantees (the contract this preserves)

- A user IC **expands to its real authored sub-netlist** (seal-as-same-netlist, ADR 0005) -> the solve
  and `snapshot_hash` are exactly those of the discrete circuit; opening the box cannot differ. No
  built-in golden circuit uses a user IC, so the golden is untouched.
- **Package and pinout are presentation + node-binding only** — which board cell a pin sits on and which
  internal net it maps to. They add **no hashed state**; renumbering pins or swapping the package never
  changes the simulation, only the drawing and the external wiring.
- A sealed blueprint's reproducibility = its sub-graph's reproducibility: save/load must round-trip every
  element param exactly (the `SavedCircuit` contract). Integer/structural params only, per ADR 0004.
- **Depth** (a user IC containing user ICs) recurses cleanly under seal-as-same-netlist, but the solve
  cost compounds; the **Tier-A sealed-behavior backing** (`ic-buildings-ideation.md` §2.3 — replay the
  verified truth-table/macro-model instead of re-expanding) is the escape hatch for deep/large bases and
  is a pure function of inputs+state+tick, so it stays deterministic.

## The authoring flow (UI surface)

1. **Build** the sub-circuit on the board (or select an existing region of it).
2. **Designate ports:** tag boundary nets as pins; give each a name + role. (A net label already names a
   net — promoting a labelled net to a port is the natural gesture.)
3. **Choose a package:** pick an archetype + pin count; assign pin numbers to the port nets; set pin-1.
   Unused package pins are `nc`. A live footprint preview shows the resulting board part.
4. **(Verify)** optionally check a spec at the pins (the earn-condition that flips analog->sealed is owned
   by `game-rewards.md` / `game-contracts-economy.md`; out of scope here).
5. **Seal** -> a new placeable part lands in the player's **part library**, usable like any built-in IC,
   and **zoom-to-open** (ADR 0005) reveals the authored sub-circuit running live.

## Phased build path (dependency order; this is ADR 0005 phase 5 expanded)

1. **Package-format library** — the archetype templates: footprint derivation, numbering conventions,
   pin-1 marker, and `drawPkg`/board-glyph integration. Pure presentation; no sim impact. (Refactor
   `graph.ts` `kind()` so a kind's footprint can come from a package layout, keeping the existing
   hand-placed parts working.)
2. **User-IC data model + generic expander** — `UserIc { graph, package, pins[] }`; generalize the
   `CEC_COMP` expander to "instantiate an arbitrary saved sub-graph, allocate its internal nodes, bind
   its port nets to the placed instance's pin nodes." Golden-safe additive.
3. **Pinout / package authoring UI** — designate ports, name/role them, pick a package, assign pins,
   preview the footprint.
4. **Persistence + the player part library** — save/load user ICs (the `SavedCircuit` round-trip), a
   browsable user-part bin beside the built-ins.
5. **Optional polish** — auto-generated glyph **symbol/schematic** tiers (the sub-graph *is* the
   schematic; rich analogy/silicon tiers stay authored for built-ins), and the **Tier-A sealed-behavior
   backing** for cheap simulation of large/deep designs.

## Notes

- Built-in composites (`CEC_COMP`) and user ICs converge on **one** expander and **one** package model;
  the built-ins become "factory-preset" user ICs. Worth keeping that unification in view from phase 2 so
  we don't grow two parallel systems.
- Keep the JS<->wasm boundary coarse (ADR 0001): packaging/pinout/expansion are all web-side; sim-core
  still sees only the flat expanded element list it already solves.
- House numbering for authored parts (e.g. a `CEC9xxx` user range vs. free-form names), the first
  shipped package set, and nesting limits are owner calls — flagged as open questions, not decided here.

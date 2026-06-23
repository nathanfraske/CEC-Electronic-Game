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

A **user-authored IC** is a serializable, versioned definition with four parts:

1. **The die boundary (the barrier)** — the IC is authored inside a **bounded build region**: a walled
   die area on its own canvas. A **design rule keeps every component and wire INSIDE the walls** —
   nothing may hang over the boundary — so the design always packages cleanly into its footprint. The
   boundary is coupled to the package (pick a package -> get a die area to fit inside; or grow the die
   and the package follows). The walls are the only place signals may leave.
2. **The function** — a `GraphSnapshot` (the sub-circuit built inside the boundary: parts + wires + ideal
   values). This is ADR 0005's seal payload; at sim time it expands to real elements.
3. **The pinout, via PORT PADS** — the in/out connection mechanism. The author drops **port pads** on the
   boundary walls and **wires the internal circuit to them**; each pad is one boundary crossing carrying
   `{ pinNumber, name, role }` (roles `in` / `out` / `inout` / `power` / `passive` / `nc`). A pad is the
   **bond-pad-to-lead of a real IC**: from the INSIDE you route an internal net to it; on the OUTSIDE it
   becomes the numbered package lead the rest of the system wires to. Dropping and wiring a pad is the
   only "interface" act; everything else inside stays private. (A pad generalizes the existing net label
   + the `CEC_COMP` pin->terminal binding — it is the single object that bridges in and out.)
4. **The package** — a **package-format archetype** + pin-1 location/orientation. The package's die
   outline **IS** the build boundary, and its numbered leads are the external side of the port pads; the
   package alone fixes the **board footprint** (which cells the part occupies and where each numbered pin
   attaches).

**Packages are a parametric library, not ad-hoc offsets.** Ship a small set of archetypes, each a
template that yields a footprint + a numbering convention + a pin-1 marker from a pin count:
- Dual / single in-line: **DIP-N**, **SOIC-N**, **TSSOP-N** (two rows, pin-1 top-left, CCW numbering);
  **SIP-N** (one row). Through-hole **TO-92** (3) / **TO-220** (tab) for discretes-as-parts.
- Small-outline / chip-scale: **SOT-23-3/5/6**, **SC70-5/6**, **MSOP-8**, **SOT-23-8** (the ones the
  catalogue and glyphs already use).
- Quad: **QFP-N** / **QFN-N** (pins on all four sides) for high pin counts (ADR 0003 territory).

`graph.ts`'s "footprint from furthest pin" generalizes to "footprint from the package archetype": the
archetype lays the numbered leads onto the footprint deterministically, and **each lead binds, through its
port pad, to the internal net the author wired to that pad** (or is left `nc`). A user IC placed on the
board is thus a **dynamic `PartKind`** (pins from package + pinout) backed by a **dynamic
`CEC_COMP`-style expander** (the authored sub-graph spliced in, each pad's internal net fused to its
external pin node — so a wire on the board to pin N continues, unbroken, to whatever the pad touches
inside).

## Determinism guarantees (the contract this preserves)

- A user IC **expands to its real authored sub-netlist** (seal-as-same-netlist, ADR 0005) -> the solve
  and `snapshot_hash` are exactly those of the discrete circuit; opening the box cannot differ. No
  built-in golden circuit uses a user IC, so the golden is untouched.
- **Package and pinout are presentation + node-binding only** — which board cell a pin sits on and which
  internal net it maps to. They add **no hashed state**; renumbering pins or swapping the package never
  changes the simulation, only the drawing and the external wiring.
- **The die boundary is a design-rule check, not a sim input.** "Everything inside the walls" is enforced
  at authoring time (placement/DRC), so it shapes only what the player may seal — it never enters the
  solve or the hash. A **port pad fuses** its internal net with its external pin node (one node, not a
  buffered crossing), so a board wire to pin N and the internal wire to the pad are the *same* electrical
  node — the seal-as-same-netlist guarantee holds straight through the package wall.
- A sealed blueprint's reproducibility = its sub-graph's reproducibility: save/load must round-trip every
  element param exactly (the `SavedCircuit` contract). Integer/structural params only, per ADR 0004.
- **Depth** (a user IC containing user ICs) recurses cleanly under seal-as-same-netlist, but the solve
  cost compounds; the **Tier-A sealed-behavior backing** (`ic-buildings-ideation.md` §2.3 — replay the
  verified truth-table/macro-model instead of re-expanding) is the escape hatch for deep/large bases and
  is a pure function of inputs+state+tick, so it stays deterministic.

## The authoring flow (UI surface)

1. **Open a die:** pick a package (archetype + pin count); its die outline becomes the **bounded build
   canvas** with numbered **lead stubs** on the walls. (Or start from a region you already built and let
   the die size to fit.)
2. **Build inside the walls:** lay out the sub-circuit within the boundary. A live **design-rule check**
   flags anything crossing the walls — the design must fit to be sealed (nothing over the walls).
3. **Wire the pins in and out:** drop **port pads** on the wall (or adopt the lead stubs), route internal
   nets to them, and give each a name + role + package pin number; set pin-1. A pad with nothing wired is
   `nc`. A live footprint preview shows the resulting board part. This step is literally "connect the pins
   in and out": inside you wire to the pad, outside the pad is the lead the board wires to.
4. **(Verify)** optionally check a spec at the pins (the earn-condition that flips analog->sealed is owned
   by `game-rewards.md` / `game-contracts-economy.md`; out of scope here).
5. **Seal** -> a new placeable part lands in the player's **part library**, wired like any built-in IC,
   and **zoom-to-open** (ADR 0005) reveals the authored sub-circuit running live inside its walls.

## Phased build path (dependency order; this is ADR 0005 phase 5 expanded)

1. **Package-format library + die boundary** — the archetype templates: footprint derivation, numbering
   conventions, pin-1 marker, the **die outline (the build boundary) derived from the package**, and
   `drawPkg`/board-glyph integration. Pure presentation; no sim impact. (Refactor `graph.ts` `kind()` so a
   kind's footprint can come from a package layout, keeping the existing hand-placed parts working.)
2. **User-IC data model + generic expander** — `UserIc { graph, package, pins[] }` where each `pin` is a
   **port pad** (`{ number, name, role, padPosition, net-ref }`); generalize the `CEC_COMP` expander to
   "instantiate an arbitrary saved sub-graph, allocate its internal nodes, **fuse each pad's internal net
   with the placed instance's pin node**." Golden-safe additive.
3. **Pinout / package authoring UI** — the **bounded die canvas** with wall lead-stubs, the **containment
   design-rule check** (nothing over the walls), dropping/wiring **port pads**, naming/roling them,
   assigning pin numbers, and the live footprint preview.
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
- **Die-sizing policy** is an owner call too: package-fixed (pick the package -> fit inside its die) vs.
  design-grown (build, then the smallest fitting package is offered) vs. a hybrid. The DRC ("nothing over
  the walls") is the same either way; only *when* the boundary is set differs.

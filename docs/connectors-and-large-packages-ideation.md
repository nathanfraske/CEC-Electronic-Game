<!-- SPDX-License-Identifier: Apache-2.0 -->

# Connectors and large / many-pin packages — ideation

Status: ideation (no code). Captures the brainstorm behind the owner's near-term ask (edge-mounted
pin labels; a deep 1:1 zoom that fills the screen with the authored internal circuit) and the
further-out ask: **large / many-pin / non-2-row packages**, where the **headline open question is
BGA — the Ball Grid Array** (§2A). A BGA's pins are **solder balls in a grid *underneath* the
package**, hidden, with **no perimeter leads to bridge out to** — so the owner's worry is "how are we
gonna model that without it becoming a cluttered mess." Everything that works for SOT-23/DIP/QFP
(perimeter edge-labels, a lead to run a wire to) **fundamentally does not apply to a BGA**, which is
why it gets its own deep section and is flagged as the hard, late item. Connectors (VGA, HDMI, USB,
…) are the lower-priority **"later, fun" tier** (§3): they exercise the same geometry engine but are
not the hard part.

Companion to **ADR 0006** (the IC maker), **`docs/ui/ic-glyph-spec.md`** (the five-tier teaching
refsheets), and the package/zoom docs **`docs/ic-package-density-ideation.md`** and
**`docs/ic-buildings-ideation.md`**. Read alongside `web/src/lib/packages.ts` (where footprints come
from), `web/src/lib/graph.ts` (`PART_KINDS`, the `Pin`/`Component` model, `rotateOffset`), and
`web/src/lib/userIcInternalsView.ts` (the existing zoom-to-open renderer the owner wants to deepen).

## 0. Framing — what the owner is asking for, in this codebase's terms

Three asks, two of them small and one large, and they share a single spine:

1. **(now) Edge-mounted pin labels.** Today a placed part's pin names (`A`/`K`, `D`/`S`/`G`, the
   die-editor pad names) draw as upright `Text` *parked just above each pin dot*
   (`board.ts` `pinTexts` / `layoutGhostPinLabels`, IBM Plex Mono 9px). The owner wants the
   datasheet look: each pin's **name sits OUTSIDE the body, on the side that pin lives on** — the
   exact convention the refsheet `drawPkg` already uses (`pin(x, top, num, name, col)` puts the
   number *inside* the body edge and the function name *outside* the tab, `ic-glyph-spec.md` §7).
2. **(now) A deeper 1:1 zoom.** `userIcInternalsView.drawUserIcInternals` already shrinks the
   authored sub-circuit to fit the sealed footprint at one uniform `scale = min(dstW/srcW,
   dstH/srcH)`. The owner wants to keep zooming until a single IC **fills the screen as a 1:1
   replica** of the authored internal circuit, routed out to the (now edge-labelled) pins.
3. **(later) Connectors and large packages.** "VGA chips and whatnot" is really two new geometry
   families the current `packages.ts` can't express: **connectors** (VGA DE-15 is 3 staggered rows;
   USB/HDMI/RJ45/headers/edge-fingers are their own shapes) and **large ICs** (QFP = pins on all 4
   sides; BGA = a *grid* of balls with no perimeter at all).

**The spine:** every one of these is **presentation + geometry, web-side, and golden-safe by
construction.** A package is "a pin count → a deterministic `{number, dx, dy}` layout" (`packages.ts`
header says so explicitly: "presentation + geometry only: it never enters the solve or the hash"). A
connector is "a labelled multi-pin terminal with no element" — exactly the no-element-hub a sealed
`UserIc` instance already is (absent from `TYPE_OF`, see `userIc.ts` `userIcPartKind`). Edge labels
and deep zoom are pure render. **Nothing here needs a sim-core change** — and §5/§7 flag the one or
two places where a careless implementation *would* touch the solver, and how to keep it out.

**Thesis:** grow `packages.ts` from three hard-coded families (`dual`/`sot23`/`sip`) into a **general
perimeter/row/grid layout engine** driven by a small **row-spec** (+ a `grid` branch for BGA); render
pin labels **edge-mounted** off that same spec; let the zoom-to-open renderer scale all the way to
fill-screen. Most large packages (QFP/QFN/PLCC/SOIC-wide/TO-220) and the whole connector family then
fall out as *data* on that engine. **BGA is the exception** — it needs new representation invention
(a hidden underside with no leads), so it gets its own model (§2A) and is the hard, late item. The
solver never learns any of it happened.

---

## 1. The geometry gap — what `packages.ts` can express today vs. what these need

Today (`web/src/lib/packages.ts`):

- `PackageFamily = "dual" | "sot23" | "sip"` — three hand-written layout functions.
- `dualLayout(n)` → two columns (`dx ∈ {0,2}`), pin 1 top-left, down the left then up the right (the
  CCW DIP order). `w = 3`, `h = ceil(n/2)`.
- `sot23Slots`/`sot23Layout` → the literal JEDEC SOT-23-3/5/6 slot tables on a 3×2 body.
- `sipLayout(n)` → one row.
- `dieLayout` mirrors each as a **roomy perimeter relayout** for the build canvas
  (`DIE_PIN_PITCH = 5`, `DIE_CORNER_INSET = 3`, `edgeSpan(n) = 2*inset + (n-1)*pitch`,
  `DIE_CROSS` per family), with the *same pin index order* so the seal maps straight through.
- **Unknown archetype → falls back to `dualLayout`/`dualDie`.** (Important: this means a new
  archetype that isn't wired up still draws *something*, never nothing.)

What the new shapes demand and the current model can't say:

| Need | Why today's model can't | What's missing |
| --- | --- | --- |
| **3 rows, staggered** (VGA DE-15) | only `dx ∈ {0,2}` (dual) or one row | rows at >2 distinct `dx`, with a per-row `dy` half-step (stagger) |
| **Pins on all 4 sides** (QFP/LQFP/QFN/PLCC) | dual is left+right only | top row + bottom row + left col + right col in one layout, JEDEC CCW numbering |
| **A grid of pads, no perimeter** (BGA) | every family is edge-based | a 2-D ball matrix with alpha-numeric (A1, B3, …) coordinates |
| **Mixed/odd geometries** (USB-C 24-pin dual-row reversible; edge-finger dual-side; barrel jack 3 contacts) | bespoke each | an escape hatch: an explicit `{number, dx, dy}` list when no rule fits |
| **Power tabs** (TO-220/TO-247) | no notion of a fat metal tab vs a lead | a lead-vs-tab flag on a pin (presentation only) |

### The proposed growth: a row-spec layout engine

Keep `PackageLayout`/`PackagePin` (the `{number, dx, dy}` contract the whole stack already consumes —
`userIcPartKind`, `framePackage`, the die editor). **Replace the family switch with a data-driven
spec.** Two complementary representations, both compiling to the same `PackagePin[]`:

```ts
// (sketch — packages.ts)
type Edge = "top" | "bottom" | "left" | "right";
interface RowSpec {
  edge: Edge;
  count: number;        // pins on this edge
  pitch?: number;       // cell spacing along the edge (default per archetype)
  stagger?: 0 | 1;      // half-pitch cross-axis offset (VGA's middle row)
  startNumber?: number; // where this edge's numbering begins (JEDEC order)
  reverse?: boolean;    // numbering direction along the edge
}
interface GridSpec {     // BGA: a matrix of balls, no edges
  rows: number; cols: number;
  // JEDEC ball coords A1..: letters skip I,O,Q,S,X,Z; we store {number, dx, dy} + a coord label.
  depopulate?: [number, number][]; // (r,c) holes for a perimeter/partial BGA
}
type LayoutSpec =
  | { kind: "rows"; rows: RowSpec[]; w?: number; h?: number }
  | { kind: "grid"; grid: GridSpec }
  | { kind: "explicit"; pins: PackagePin[]; w: number; h: number }; // the escape hatch
```

- `dualLayout`, `sot23Slots`, `sipLayout` all **become `rows`-specs** (a regression-safe rewrite:
  the dual is `[{left,half},{right,half,reverse}]`, SIP is `[{top,n}]`). Keep the existing functions
  as thin wrappers that emit these specs so **the golden die/footprint numbers don't move** for
  parts that already ship. (Mirrors how `tiers.ts` keeps "mid-range = the existing default.")
- A **QFP** is four `rows` (CCW: left top→bottom, bottom left→right, right bottom→top, top
  right→left — the standard quad order), pin 1 at top-left of the left column.
- **BGA** is the `grid` branch: `dx = col`, `dy = row`, plus a `coord` label ("A1", "B3"). No edges,
  so the perimeter-based `dieLayout` reasoning is replaced by "scatter into the interior" for the
  build canvas (see §2).
- **Connectors and oddballs** that resist a clean rule (USB-C, barrel jack, a specific edge-finger
  card) use the **`explicit`** escape hatch — a literal pin list, still `{number, dx, dy}`, so they
  drop into the same renderer with zero special-casing. This is the pragmatic out: not every
  real-world connector deserves a parametric family.

`dieLayout` grows the same way: a generic **perimeter walk** that places each `RowSpec`'s pins along
its edge at `DIE_PIN_PITCH`, insetting `DIE_CORNER_INSET`, with `DIE_CROSS`/`edgeSpan` generalised so
a 4-edge body sizes from its **two** governing edge spans (max of the opposing pairs). For `grid`
(BGA) the die canvas is a roomy interior with the balls laid on a coarse lattice; the build area is
the whole interior rather than "between two pinned edges." **Same invariant as today: pin INDEX order
is identical between `packageLayout` and `dieLayout`, so the seal maps each lead straight through.**

---

## 2. Large IC packages — QFP / QFN / BGA / PLCC / SOIC-wide / TO-220

These are pure `packages.ts` extensions on the §1 engine. None touch `graph.ts`'s `Pin` shape, the
seal, or the solver. JEDEC numbering is the only fiddly part and it is **datasheet-verified**, never
recalled (the same discipline `ic-glyph-spec.md` §2 mandates for refsheet pinouts).

| Package | Layout in the engine | Numbering | Notes |
| --- | --- | --- | --- |
| **QFP / LQFP / TQFP** | four `rows` (all edges), equal `count` per side for the common symmetric parts | CCW from pin 1 at top of the left column | the canonical "pins on all 4 sides"; `w ≈ h` |
| **QFN / MLF** | identical to QFP geometry (it's the leadless cousin) + an optional center **thermal pad** pin (an `explicit` extra at the body centre, flagged as a pad) | same CCW | the pad is presentation; if wired, it's just another net boundary |
| **PLCC** | four `rows`, but **pin 1 is top-CENTER** and numbering runs CCW from there (the J-lead convention) | CCW from top-center | a `startNumber`/offset on the top row expresses it |
| **SOIC-wide / SSOP / TSSOP** | the existing **dual** spec with a wider `DIE_CROSS` / different body `w` | unchanged dual order | a body-size variant, overlaps `ic-package-density-ideation.md` axis (d) |
| **BGA** | the `grid` branch; `rows × cols` balls | **alpha-numeric** (row letter skipping I,O,Q,S,X,Z; col number) — store the coord as the pin's label, keep a 1-based `number` for the index | "no perimeter" — **the headline hard case; see §2A** |
| **TO-220 / TO-247** | `sip`-like single row of 3 leads + a fat **mounting tab** (an `explicit` pad pin) | 1..3 along the leads | the tab is a heat/strap feature; presentation flag `tab: true` |

Legibility for dense parts (a 100-pin LQFP, a 256-ball BGA): the **board footprint** stays a compact
body (you don't want 100 readable labels at board zoom), and the **detail is gated behind zoom and
the inspector** (§3, §6). At board zoom a QFP draws as a body + pin-1 dot + count; zoom in (past
`DETAIL_ZOOM` in `board.ts`) to reveal numbered/edge-labelled leads; open the inspector/refsheet for
the full pin table. BGA's "you can't see the balls, they're under the chip" is itself a teachable
moment — render the ball grid only in the zoomed/X-ray view, exactly as real BGA inspection needs an
X-ray.

**JEDEC numbering belongs in one tested helper.** Put `bgaCoord(row, col)` (the I/O/Q/S/X/Z-skipping
letter scheme) and the quad CCW walk in `packages.ts`, and add a `netlist.test.ts`-style unit test
that pins a few known parts (a QFP-44's pin-1/11/12, a BGA's A1/B1 → indices) so a future edit can't
silently renumber. (This is the same "headless vitest verifies determinism-critical layout" pattern
CLAUDE.md describes for `buildNetlist`.)

---

## 2A. BGA — the hidden-underside problem (the headline open question)

This is the case the owner singled out, and it breaks the assumptions every other package in this doc
leans on. A QFP has leads on its edges; you draw a label outboard and run a wire to the lead. **A BGA
has no edges and no leads.** Its contacts are an N×M matrix of **solder balls on the *bottom* of the
package**, completely hidden when the chip sits on the board — you literally cannot see or touch them
without lifting/X-raying the part. A 256-ball BGA is a 16×16 grid; the naive "draw every contact with
a label and a wire stub" turns the chip into the cluttered mess the owner is rightly worried about.
So BGA needs its **own representation model**, not the perimeter machinery. The good news: it is still
**pure presentation + a no-element net boundary** (§5), so however we draw it, the solver and golden
are untouched.

### The four sub-problems a BGA forces

1. **Hidden underside** — the balls are *under* the body, so a top-down board glyph can't show them
   truthfully without a deliberate "see-through" or "flip" affordance.
2. **Clutter / density** — hundreds of contacts; showing them all, all the time, is unreadable.
3. **No lead to bridge to** — the authored internal net has no perimeter pin to run a wire out to;
   it must connect to a ball *in the interior of the grid*.
4. **Hunting a specific ball** — wiring to "ball T12" by eyeballing a dense grid is miserable; the
   player needs to *address* a ball, not pixel-hunt it.

### Representation options (weighed)

| Option | What it is | Pros | Cons | Verdict |
| --- | --- | --- | --- | --- |
| **(A) Ball-map grid overlay** | the JEDEC A1-corner alphanumeric matrix drawn as a coordinate grid (row letters down the left, col numbers across the top), like a datasheet bottom view — dots, not leads | the canonical, instantly-recognisable BGA view; coordinates make balls *addressable* (§interaction); no fake leads | only legible when zoomed/opened, not at board scale | **the core view** (shown on zoom/inspect) |
| **(B) X-ray / ghosted underside** | the package body drawn semi-transparent with the ball grid visible *through* it (balls dimmed, "under glass") | truthful ("they're underneath"); teaches that BGA is inspected by X-ray; no flip needed | balls compete visually with the body; busy if all shown | **the board-glyph treatment** when zoomed in (pair with C) |
| **(C) Flip-to-bottom toggle** | a "view bottom" button that flips the chip to show the ball map face-on (mirror in X), as you'd flip a real part | matches how you actually read a BGA pinout; clean, face-on grid | a mode the player must invoke; must clearly indicate "you're looking at the bottom" (mirror handling) | **the inspector/refsheet view**; optional on-board |
| **(D) Progressive disclosure / LOD** | collapsed = a labelled square with a pin-1 corner + ball count; zoom in to reveal the matrix; **only WIRED balls light up + are labelled, the rest dimmed to faint dots** | kills the clutter dead — density never overwhelms because you only foreground what's used; rides the existing `board.ts` LOD ladder | "where are the unused balls" needs the overlay/inspector to answer | **the spine — combine with A** |
| **(E) Label-in-place only** | just draw a coord on each ball, no leads | simplest | unreadable at any real ball count; the clutter trap itself | reject as the only model (fine as the deepest-zoom detail on a *used* ball) |

**Recommended model: (D) + (A), with (B)/(C) as the "show me the underside" affordances.**
Collapsed, a BGA is a clean labelled square (body + pin-1 corner + "256 balls"). Zoom past
`DETAIL_ZOOM` (`board.ts`) and the **ball-map grid (A)** appears as faint dots with row/col rulers;
**only the balls the player has wired are lit and labelled (D)** (net colour from the snapshot, coord
+ optional net name), every other ball a dim placeholder. A **"view bottom" toggle (C)** or a
**ghosted X-ray (B)** lets the player see the true underside when they want the full map. Density is
*never* the default; it's revealed on demand and foregrounds only what matters.

### Fan-out routing — connecting an interior ball with no edge to run to

The "no lead to bridge to" problem (sub-problem 3). Options:

- **(i) Short fan-out stub per used ball.** Each *wired* ball sprouts a tiny stub toward the nearest
  body edge (mimicking real BGA fan-out/dog-bone vias to the board), and the player's wire attaches
  at the stub's outboard end. Reads like real escape routing; only used balls get a stub, so it stays
  sparse. **Recommended** — it's the literal real-world answer and composes with (D)'s "only wired
  balls are prominent."
- **(ii) Virtual breakout / perimeter ring.** The chip presents a synthetic ring of edge pins (one
  per used ball) around the body — a "breakout board" the player wires to, with a thin connector line
  from each ring pin back to its ball. Cleanest for wiring, but it's a fiction layered over the part;
  good as an *optional* breakout overlay, not the default truth.
- **(iii) Label-in-place + wire-to-ball.** The wire simply terminates *on* the ball at its grid
  position (no stub), with the coord label beside it. Simplest and most honest about "the contact is
  right there," but dense grids make the wire endpoints hard to place — leans entirely on the
  addressing affordances below.

Recommendation: **(i) fan-out stubs for the on-board glyph** (real, sparse, only-used), with **(ii)
the virtual breakout as an optional view** for someone who wants to wire a BGA like a header. Both are
pure render geometry over the same `{number, dx, dy}` ball positions — no model change.

### Interaction — wiring to a ball without hunting

Because eyeballing "ball K9" in a 256-dot grid is hopeless, **address balls, don't pixel-hunt**:

- **Pick by coordinate / net name.** A small picker (type/select `K9`, or the signal name if the
  ball is named) that **snaps the wire endpoint to that ball** — the same spirit as the net-label
  search/alias machinery (`graph.ts` `NetLabel`) and the coordinate grid that view (A) already draws.
- **Snap-to-ball + highlight-on-hover.** Hovering the grid highlights the nearest ball, shows its
  coord + current net, and snaps the pending wire to its centre (reuse the existing `pinHitTest`
  snap, widened to ball centres). The lit/dim split from (D) means the cursor lands on real targets,
  not a sea of identical dots.
- **Filter to used / named balls.** Toggle "show only wired/named balls" so the working set is a
  handful of addressable points, not the full matrix.

### How BGA composes with the 1:1 zoom replica and determinism

- **1:1 zoom-to-open (§7).** Works the same as any sealed IC, with one change: the inner net runs out
  to a ball at `(row, col)` in the *interior*, not a perimeter lead. `drawUserIcInternals` already
  maps `internals.pinNodes → pins[i]` by index, and a BGA's `pins[i]` are simply interior `(dx,dy)`
  positions — so the deep replica routes each authored net to its ball's fan-out stub (option i)
  exactly as it routes to an edge pin elsewhere. The "fill the screen" view is where the ball map is
  *most* legible (room for coords + lit nets), so deep-zoom and the ball-map overlay reinforce.
- **Determinism (still golden-safe).** A BGA is the same **no-element net boundary** as every other
  package here (§5): the balls are pins, the chip emits no element, `buildNetlist`'s output is
  byte-identical with or without it. The ball-map overlay, X-ray/flip, fan-out stubs, LOD, and the
  picker are **all pure render / authoring-UI** — none cross the wasm boundary or touch
  `snapshot_hash`. The grid `{number, dx, dy}` + `bgaCoord` label come from the §1 `grid` branch and
  the one tested numbering helper, so the layout is deterministic and the golden cannot move.

**Why BGA is the hard, late item:** it's the only package that needs *new representation invention*
(hidden underside, X-ray/flip, ball addressing, fan-out) rather than "another row-spec." Everything
else in §2 is data on the §1 engine; BGA is data **plus** an interaction/rendering model. Build the
engine, edge-labels, deep-zoom, and the simpler packages first; land BGA once those primitives exist
to lean on (the LOD ladder, the snap/hit-test, the deep-zoom router).

---

## 3. Connectors — a new part family (the "later, fun" tier)

These share the §1 geometry engine but are **lower priority than the package work and BGA** — a
"later, fun" cohort (the owner was explicit they were *not* the headline ask). They're worth speccing
because most are trivial on the engine, and a couple (VGA's 3-row stagger) stress-test it usefully.


Connectors differ from ICs in three teaching-relevant ways, and the design should lean into all
three:

1. **They have no internal active circuit.** A connector is *just labelled contacts* — a net
   boundary where signals leave/enter the board. Electrically it is a **multi-pin junction**: pins
   that name nets, no element. (See §5 — this is why it's golden-safe almost for free.)
2. **Their pinout IS the lesson.** The teaching payload of "VGA" is "pin 1 = Red, pins 5/6/7/8/10 =
   grounds, 13 = HSync, 14 = VSync, …" plus the **physical shape** (which way the D-shell faces,
   which row a pin is in). So the refsheet/inspector is a **pinout map over the real shell**, not a
   five-tier silicon dive.
3. **Their geometry is the hard part** — and it's exactly the geometry §1's row-spec was built for.

### The connector cohort (a `PART_KINDS` family + layouts)

Each connector is a `PartKind` (so it's placeable, wireable, rotatable like any part) whose pins come
from a layout spec. They form a visual family (suggest a distinct `colorKey` — e.g. `bronze` for
contacts/metal, or a dedicated key) and a tech-tree bin section "Connectors."

| Connector | Real pinout | Layout spec | Geometry challenge |
| --- | --- | --- | --- |
| **VGA (DE-15 / HD-15)** | 15 pins, 3 rows of 5, **staggered**; RGB + 5 grounds + HSync/VSync + DDC | `rows`: 3× `{count:5, stagger}` with the middle row half-pitch offset, inside a D-shell outline | **the 3-row stagger** — the case the owner named; needs `stagger` + 3 distinct `dx` |
| **HDMI (Type-A, 19-pin)** | 19 pins, 2 staggered rows (10 + 9), TMDS pairs + shields + clock + CEC/DDC/HEC | `rows`: two staggered rows of 10/9 | staggered 2-row (a half-step `dy`), TMDS pairs grouped |
| **USB-A 2.0** | 4 contacts (VBUS, D−, D+, GND) in a row | `rows`: `{top, 4}` | trivial — a good MVP connector |
| **USB-C** | 24 pins, **dual-row, point-symmetric (reversible)** — VBUS/GND/CC/SBU/TX/RX/D | `explicit` (the A1..B12 reversible map is bespoke) | reversibility — a presentation note; electrically just 24 named pins |
| **RJ45 (8P8C)** | 8 contacts in a row; Ethernet pairs (1/2, 3/6, 4/5, 7/8) | `rows`: `{top, 8}` | pair grouping in the label/teaching layer |
| **Pin header 1×N** | N pins, one row | `rows`: `{top, N}` = the existing **`sip`** family generalised | already expressible; parametric N |
| **Pin header 2×N** | 2×N, two rows | `rows`: `{top,N},{bottom,N}` (or the dual spec) | numbering convention (odd/even rows vs snake) — datasheet-pick |
| **Edge connector (PCIe-style gold fingers)** | contacts on **both faces** of a card edge | `rows`: top-face row + bottom-face row, drawn as fingers; an `explicit` map per slot type | dual-**face** (front/back), not dual-edge; a render distinction (gold fingers) |
| **Barrel jack (DC)** | 3 contacts: tip, sleeve, switch | `explicit` (3 pins) | non-grid physical shape; the teaching art carries it |
| **Audio jack (3.5 mm TRS/TRRS)** | 3–4 contacts: tip, ring(s), sleeve | `explicit` | same — physical contact stack, not a grid |
| **Screw terminal block** | N screw posts in a row | `rows`: `{top, N}` | trivial; a header with chunky posts |
| **Ribbon / IDC** | 2×N (the dual-row IDC), keyed | `rows`: two rows of N | the same 2×N header geometry + a keying notch (cosmetic) |

**MVP set:** USB-A, a 1×N and 2×N header, screw terminal, RJ45 (all single/dual-row, trivial on the
engine), then **VGA** as the flagship that *proves the 3-row stagger*. HDMI/USB-C/edge-fingers/barrel/
audio are the stretch tier (bespoke `explicit` maps or extra render art).

### Connector pins carry net SEMANTICS

A connector's value is its labels, so push them further than a generic pin name:

- **Pin label = signal name** (`R`, `G`, `B`, `HSYNC`, `GND`, `D+`, `VBUS`, `TX0+`…), sourced from a
  per-connector pinout table in a new `web/src/lib/connectors.ts` (the analogue of `diodes.ts` for
  variants / `tiers.ts` for presets). This rides the **existing pin `label`** field — no schema
  change (`graph.ts` `Pin.label`).
- **Optional net-role tint:** grounds drawn in the GND rail colour, power pins in their rail colour
  (reuse `board.ts` `voltageColor`/the rail palette), signal pairs (TMDS, USB D±, Ethernet) hinted
  as pairs. Presentation only.
- A connector could **auto-name its nets**: dropping a `NetLabel` (`graph.ts`) on each wired
  connector pin so the net shows `VBUS` / `HSYNC` board-wide — leveraging the global-alias machinery
  that already exists. Optional QoL; the inspector pinout is the MVP.

---

## 4. Edge-mounted pin labels (the owner wants this NOW)

The geometry the owner asked for is **already solved in the refsheet `drawPkg`** (`ic-glyph-spec.md`
§7.1): the function name draws *outside the tab* at `top ? ty-7 : ty+41`, the number *inside* the
body edge. The task is to bring that to the **live board renderer** and generalise it from "dual
top/bottom" to "any edge / grid."

### The rule: place each label off the body on its pin's side

Today `board.ts` parks every pin label `9px above` its dot (`layoutGhostPinLabels`, the placed-part
`pinTexts`). Replace "always above" with **"outboard along the pin's outward normal,"** derived from
which edge the pin sits on:

- Compute each pin's **edge** from its `(dx, dy)` relative to the footprint bounding box (min/max of
  the kind's pin offsets — `footprintCenter` already does the bbox math): `dx == minDx` → left edge
  → label to the **left**, right edge → **right**, top → **above**, bottom → **below**. A BGA ball
  (interior) has no edge → label inboard or omit at board zoom (show coord on hover/zoom only).
- Set the `Text` anchor per side so the label hugs the body cleanly: left edge → `anchor (1, 0.5)`
  (right-aligned, sitting left of the dot); right edge → `anchor (0, 0.5)`; top → `(0.5, 1)`;
  bottom → `(0.5, 0)`. Offset by a few px past the lead.
- **Under rotation/mirror:** the label's *position* must rotate with the part (use the same
  `rotateOffset(dx, dy, rot, mirror)` the pin dot uses — `graph.ts`), but the *text stays upright and
  re-anchored to the NEW outward side*. (The existing ghost labels already live on the un-rotated
  `ghostLayer` and re-position via `rotPx`, so the upright-but-repositioned pattern is established;
  the new part is recomputing the edge/anchor after the rotation so a left-edge pin that rotates to
  the top gets a top anchor.)

### Density: avoid overlap, choose number vs name vs both

- **Number vs name vs both, by zoom (LOD).** Board overview: pin **numbers** only (or nothing on a
  dense part) — names would be a wall of text. Zoom in past `DETAIL_ZOOM` (`board.ts` already gates
  the refsheet-style "full detail with pinout labels" here): show **names**; deeper still, **both**
  (`5 · VCC`). This reuses the LOD ladder `board.ts` already runs (`TIER_ZOOM` / `DETAIL_ZOOM` /
  `INTERNALS_ZOOM`).
- **Dense-edge thinning.** When pins are closer than the label is tall, fall back to numbers, or
  label only every Nth pin + the named/special ones (power, pin 1), with the full table in the
  inspector. A 100-pin QFP never tries to draw 100 names at once.
- **Pin-1 / orientation marker** stays (the `drawPkg` orientation dot) so the part reads even when
  labels are thinned.

This is **pure render** — no model, no netlist, no hash. It also directly serves the refsheets:
generalising `drawPkg`'s 2-edge label placement to a 4-edge/grid helper means QFP/BGA refsheets get
edge labels from the same code (§6).

---

## 5. Connectors as circuit nodes (the netlist / determinism story)

**A connector is a no-element, multi-pin net boundary — and the codebase already has the exact
pattern.** Two existing precedents to copy, not invent:

1. **The multi-pin junction / labelled net.** `graph.ts` `Junction` ties wire-ends into one net with
   *no element*; a `NetLabel` names a net and globally aliases same-named labels. A connector pin is
   "a pin that names a net and is a boundary" — structurally a named terminal.
2. **The sealed-`UserIc` no-element hub.** `userIc.ts` `userIcPartKind` builds a placeable `PartKind`
   that is **deliberately absent from `TYPE_OF`**, so `buildNetlist` treats the placed instance as a
   *no-element hub* — its pins just join whatever nets touch them. **A connector wants precisely this
   treatment:** a `PartKind` whose pins are net boundaries and which emits **no element**.

So the netlist integration is: **connectors are kinds that `buildNetlist` skips for element emission**
(like GND, the frame, a placed user-IC instance — all already `ideal: true` but not in `TYPE_OF`).
Each connector pin's net is whatever it's wired to; the pin's `label` is its signal name. **Zero
sim-core change. The golden cannot move** (a connector adds no element to the compiled list; if no
connector is placed, nothing changes — the same "strict no-op when absent" argument `flattenUserIcs`
and `dieTestGraph` already make).

### What WOULD need a sim-core change — and how to keep it out

The temptation, flagged so a future agent doesn't wander into it:

- **A connector that's a SIGNAL SOURCE/SINK** (e.g. "the VGA connector *drives* an RGB waveform," or
  "USB VBUS *is* a 5 V supply," or a connector that models a cable's characteristic impedance). The
  moment a connector pin must *source* a voltage/current or carry a transmission-line model, it stops
  being a no-element hub and becomes (or must attach) a real element. **Keep it out by composition,
  not a new element:** if a connector should supply power, the *player wires a `V`/`PULSE` source to
  its pin* — the connector stays passive. If a "live input" connector is wanted, model it the way
  `PULSE` and `SHUNT` already cheat (CLAUDE.md "Gotchas"): **reuse an existing element type with a
  param**, never add a connector element to sim-core's ~15 source sites. A cable's Z0/length is the
  whole **`invisible-electronics-ideation.md`** transmission-line program — out of scope here, and
  when it lands it rides Real-mode unhashed params, not a connector primitive.
- **Auto-grounding.** If a connector's GND pins should *auto-tie to node 0*, do it the **web/netlist
  way** (treat them like a wired `GND` part in `buildNetlist`'s node-0 rooting, `netlist.ts`), not a
  core change. Default: they're just pins; the player wires GND. (Auto-tie is a later QoL.)

**Invariant (state it in the PR):** a connector contributes pins + labels + geometry and **no
element**. `buildNetlist`'s element output is byte-identical whether or not connectors are present,
so `snapshot_hash` and the golden are untouched by construction — the same discipline the IC maker,
junctions, and net labels already hold to.

---

## 6. Teaching — refsheets and inspector treatment

The five-tier silicon dive (`ic-glyph-spec.md`) is **right for active ICs and wrong for connectors
and most large packages.** Connectors have no silicon; a 100-pin MCU's teaching is its function and
pinout, not one transistor. So this work needs a **second refsheet archetype**, not a stretch of the
existing one:

- **Connector refsheet = a pinout map over the real shell.** The shared `drawPkg` frame
  (generalised to the connector's shape — the VGA D-shell, the USB-A blade, the RJ45 body) with
  **every pin edge-labelled with its signal name**, grouped by function (RGB / sync / ground;
  TMDS pairs; power/data), plus a short "what this connector is for" intro. No tiers — or at most a
  2-state "pinout / wiring" toggle. Lives in `docs/ui/parts/` beside the IC refsheets (e.g.
  `vga-connector.html`), authored from the **datasheet/standard** pinout (verified, per §2/§spec).
  The new edge-label helper from §4 is the workhorse here.
- **Large-IC refsheet = package + pin table + (optional) block diagram.** For a QFP/BGA MCU you
  don't draw the die; you draw the **package with numbered/edge-labelled pins** and a function table,
  optionally a block diagram. The existing five-tier dive remains for parts whose *internals* are the
  lesson (gates, op-amps); a big mixed-signal package gets the package-plus-table treatment.
- **In-game inspector** (the live board, not the standalone HTML): when a connector/large package is
  selected, the inspector shows its **pinout table** (pin → signal, with the wired net's live
  voltage beside each, read from the snapshot) — turning the connector into a live breakout
  reference. This reuses the inspector + telemetry plumbing (`board.ts` net names per node, the
  voltage read-out path).

MVP vs later for teaching: MVP is the **inspector pinout table** (cheap, lives in existing chrome) +
**edge labels on the board glyph**. Standalone refsheets (VGA, then the common connectors) are the
next tier; the QFP/BGA package-plus-table refsheet follows the package work.

---

## 7. The 1:1 deep-zoom replica (the owner wants this NOW too)

`userIcInternalsView.drawUserIcInternals` already does the hard part: it lays the **authored** inner
glyphs at their drawn positions, scaled to the footprint at one uniform `scale`, coloured + animated
off the **same snapshot** the board reads (ADR 0005 seal-as-same-netlist). The owner's ask is to let
that **keep scaling up until the chip fills the screen** and reads as the exact authored circuit, with
the internal nets routed cleanly out to the (edge-labelled) pins.

What's needed, all render-side:

- **Lift the zoom ceiling for an opened IC.** Today `INTERNALS_ZOOM = 2.5` triggers the open and
  `MAX_SCALE = 8` caps zoom (`board.ts`). For a deep "fill the screen with one IC" mode, allow the
  opened-IC view to scale past the normal cap (a dedicated focus/zoom-to-fit on the selected chip),
  so the inner schematic renders at **near-1:1 with the board's own `PITCH`** rather than shrunk into
  the footprint. At that point the inner parts are full-size glyphs — the "exact circuit" the owner
  means — instead of the fit-to-footprint miniature.
- **Route inner nets to the EDGE pins, not just anchor dots.** Today the view ties each lead to its
  inner net with a short stub + a `dim` anchor dot (`drawUserIcInternals`, the `pinNodes`/`pins`
  loop). For the 1:1 replica, draw a **clean orthogonal route** from each inner net's nearest point
  to its package lead, terminating at the **edge-labelled pin** (§4) — so the deep view reads like a
  real schematic whose ports are the chip's named pins. (The `internals.pinNodes` → `pins` mapping
  is already there; this upgrades the stub to a real trace.)
- **Interaction with the five-tier system.** The deep-zoom replica is the **`reality` lens** of an
  *authored* IC (the live authored schematic) — distinct from the five-tier *refsheet* dive, which
  is a curated teaching artifact for a *known* part. They compose: a built-in part can offer the
  five-tier refsheet (curated), while a player's sealed IC offers the 1:1 authored replica (live).
  The LOD ladder (`schematic` → `analogy` → `reality` → `internals`/deep) stays the through-line;
  deep-zoom is the bottom rung for a sealed user IC.
- **Determinism:** untouched. `drawUserIcInternals` already takes the snapshot's `nodeV` and `phase`
  and draws — no new sim, no hashing (its own header says so). Filling the screen is just a bigger
  `scale` and longer routes; the data is the same per-frame snapshot. The `bbox`/`pinNodes` come from
  the flatten's render-only `FlattenRecord` sink (`userIc.ts`), which is explicitly documented as not
  touching the element arrays.

---

## 8. Determinism & integration summary — what touches what

Hard rule (CLAUDE.md golden rule 1; ADR 0005/0006): the sealed netlist is the real authored parts;
none of this may change the solve unless it's an explicit, golden-safe model param. It doesn't:

- **Pure presentation (no sim, no hash):** the row-spec/grid layout engine and every new
  `packageLayout`/`dieLayout` it produces (the header already declares packages presentation-only);
  edge-mounted labels; the deep 1:1 zoom; refsheets/inspector pinouts; connector glyphs and tints.
- **Web-side model plumbing (no sim, no hash):** connectors as **no-element hubs** in `buildNetlist`
  (skipped for element emission, like the frame / placed user IC / GND — `userIc.ts`,
  `dieEditor.ts` precedents); optional connector-pin auto-`NetLabel`; optional GND auto-tie done the
  netlist way. A connector adds **zero** elements, so `buildNetlist`'s output and the golden are
  byte-identical with or without connectors present.
- **Would need sim-core / determinism care — kept OUT (§5):** a connector that *sources* signal or
  models a cable (compose with existing `V`/`PULSE`/`SHUNT`-style param reuse, never a new
  primitive); transmission-line Z0 (the separate invisible-electronics program, Real-mode unhashed).

**The invariant:** these features change *geometry, labels, and how the inside is drawn/zoomed* — the
solver never learns a package grew to 4 sides, a connector appeared, or the zoom went 1:1. Same safety
argument the IC maker, junctions, and net labels already rely on.

---

## 9. Phased build order (MVP → stretch)

Dependency-ordered; each phase is independently shippable and golden-safe.

1. **Edge-mounted pin labels (NOW).** Generalise `board.ts` pin-label placement from "always above"
   to "outboard along the pin's edge normal," with per-side anchors and rotation/mirror re-anchoring
   (reuse `rotateOffset` + the bbox/`footprintCenter` math). LOD: numbers at overview, names at
   `DETAIL_ZOOM`, both deeper. **Pure render.** Smallest, highest-want item; also unblocks the
   refsheet edge-label helper.
2. **Deep 1:1 zoom replica (NOW).** Let an opened sealed IC scale past the normal cap to near-1:1
   `PITCH`, and upgrade `drawUserIcInternals`'s lead stubs to clean orthogonal routes terminating at
   the edge-labelled pins. **Pure render** (same snapshot).
3. **The row-spec/grid layout engine (the enabling refactor).** Rewrite `packages.ts`'s
   `dual`/`sot23`/`sip` as `rows`-specs behind the existing functions (regression-safe — golden
   footprint/die numbers unchanged), add the `grid` and `explicit` branches, and a `packages`/
   `netlist`-style **unit test** pinning known layouts (dual order, SOT-23 slots) so nothing
   renumbers.
4. **Large perimeter packages (the easy large ones).** QFP/LQFP/QFN (4-edge `rows` + JEDEC CCW +
   optional thermal pad), PLCC (top-center pin 1), SOIC-wide/SSOP/TSSOP (body-size dual variants),
   TO-220/TO-247 (SIP + tab flag). All are *data on the §1 engine.* Datasheet-verified numbering in
   one tested helper. **(BGA deliberately excluded here — see phase 7.)**
5. **Connector family — MVP (the "later, fun" tier).** A `connectors.ts` pinout table + a `PART_KINDS`
   connector cohort, wired as **no-element hubs** in `buildNetlist`. Trivial geometries first (USB-A,
   1×N/2×N header, screw terminal, RJ45 — all single/dual-row on the engine), then **VGA DE-15** as
   the flagship proving the **3-row stagger** (`stagger` on the middle row). Inspector pinout table.
6. **Connector family — stretch.** HDMI (staggered 19), USB-C (`explicit` reversible 24), edge
   connector / gold fingers (dual-face), barrel jack, audio jack, ribbon/IDC keying. Standalone
   connector refsheets in `docs/ui/parts/` (VGA first). Optional connector-pin auto-`NetLabel` and
   GND auto-tie (netlist-side). QFP package-plus-table refsheets.
7. **BGA — the hard, late item (§2A).** Land this *last*, once the engine, edge-labels, deep-zoom,
   the LOD ladder, and the snap/hit-test all exist to lean on. It is the only package that needs new
   *representation invention*, not just a layout: the `grid` branch + `bgaCoord` helper + test (the
   data part) **plus** the ball-map overlay (A), LOD lit/dim disclosure (D), X-ray/flip underside
   (B/C), fan-out stubs (i), and the pick-by-coordinate/snap-to-ball wiring affordances. All pure
   render / authoring-UI; still a no-element net boundary, so golden-safe. The BGA package-plus-table
   refsheet rides the same ball-map view.

---

## 10. Pointer for the next agent

- **Start in `web/src/lib/packages.ts`.** The whole geometry story is here. The `PackagePin
  {number, dx, dy}` / `PackageLayout` contract is consumed by `userIcPartKind` (`userIc.ts`),
  `framePackage`/`FRAME_PACKAGES` (`graph.ts`), and `dieBounds`/`freshDieGraph` (`dieEditor.ts`) — so
  **keep that contract** and grow the *producers* (`packageLayout`/`dieLayout`) behind a row-spec.
  The unknown-archetype fallback to `dual` (both `packageLayout` and `dieLayout`) means a half-wired
  new family still draws something — lean on that while iterating.
- **The golden-safety argument is structural, not numeric:** a connector emits **no element** (skip
  it in `buildNetlist` like GND / the frame / a placed user IC — none are in `TYPE_OF`), so the
  compiled element list and `snapshot_hash` are byte-identical with or without connectors. Rewriting
  the existing families as `rows`-specs must keep their **current `{dx,dy}` and pin-index order**
  (add the §2/§9 unit test first, then refactor under it). Edge labels and deep zoom never cross the
  wasm boundary at all.
- **Edge labels (NOW):** the *geometry already exists* in `drawPkg` (`ic-glyph-spec.md` §7.1 — name
  outside the tab). Port that placement into `board.ts`'s pin-label code (today `layoutGhostPinLabels`
  / the placed-part `pinTexts` park labels `9px above`); generalise to 4 edges + grid with per-side
  anchors and rotation/mirror re-anchoring via `rotateOffset`. Gate number/name/both on the existing
  `DETAIL_ZOOM` LOD.
- **Deep zoom (NOW):** `userIcInternalsView.drawUserIcInternals` is the file. It already fits the
  authored circuit at `scale = min(dstW/srcW, dstH/srcH)` off the live snapshot; lift the
  opened-IC zoom cap (`INTERNALS_ZOOM`/`MAX_SCALE` in `board.ts`) toward 1:1 `PITCH` and turn the
  lead stubs into clean routes to the edge-labelled pins. No sim work.
- **BGA (§2A) is the hard one — save it for last.** Unlike every other package it needs a *rendering
  + interaction model*, not just a layout: the headline trap is the hidden underside + clutter. Land
  the `grid` branch / `bgaCoord` first (data), then build the **anti-clutter spine: LOD progressive
  disclosure (only wired balls lit, the rest dim) + the ball-map coordinate overlay**, then the
  underside affordances (X-ray/flip), fan-out stubs, and **pick-by-coordinate / snap-to-ball** wiring
  (widen `pinHitTest` to ball centres; reuse the `NetLabel` search idiom). Never draw all balls
  labelled at once. It's still a no-element net boundary, so it stays golden-safe.
- **Verify datasheet pinouts, never recall them** (the `ic-glyph-spec.md` §2 rule applies doubly to
  JEDEC quad/BGA numbering and to VGA/HDMI/USB). Put `bgaCoord` and the quad CCW walk in one place
  with a test.
- **Don't add a sim-core element for any of this.** If a "live" connector or a cable model is ever
  wanted, compose with existing source elements + params (`PULSE`/`SHUNT` trick) or defer to the
  transmission-line program in `invisible-electronics-ideation.md` — both keep the golden frozen.

One-liner: **"Grow `packages.ts` from three hard-coded 1-/2-row families into one row-spec + grid
layout engine, and most large packages (QFP/QFN/…) and the whole connector family fall out as data;
render pin names edge-mounted off that same spec (the refsheet `drawPkg` already does it) and let the
zoom-to-open keep scaling to a 1:1 live replica. BGA is the one genuinely hard case — a hidden grid of
balls under the chip with no leads — so it gets its own model: collapse it to a labelled square, and
on zoom reveal a ball-map where only the WIRED balls light up, addressable by coordinate, with
fan-out stubs to wire to. All of it is a no-element net boundary, so the solver and the golden never
learn any of it happened."**

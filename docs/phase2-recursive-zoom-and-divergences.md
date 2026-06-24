<!-- SPDX-License-Identifier: Apache-2.0 -->

# Phase 2 — Recursive zoom-to-open LoD + the opened-IC ↔ die-editor divergence audit

**Status:** design (2026-06-24). Companion to `docs/recursive-ic-lod-plan.md` (the master plan; this
fleshes out its **Phase 2** stub and audits the gap between the sealed-IC opened replica
(`drawUserIcInternals`) and the real die editor (`board.ts` `redrawWires` + the tier machinery).

This document is **render-only and golden-safe throughout.** Nothing here touches `sim-core`,
`sim-protocol`, the netlist element/value emission, or anything hashed. Every node index already lives
in the flattened `node_voltages`; every new struct field is render-side. Per the plan: "Phases 0/2/3
are render-only … the golden hash `0xeaac_3764_99e4_fa24` never moves."

---

## 0. The model as it stands (what Phase 0/1 left us)

The opened-IC replica is `drawUserIcInternals(g, o)` in `web/src/lib/userIcInternalsView.ts`. It is
invoked once per frame per placed sealed IC from `board.ts` `ComponentNode.update`
(`web/src/lib/board.ts:6527`), in the `showUserIc` branch (`board.ts:6615`).

The frame's geometry, in three multiplied scales:

```
on-screen px = footprint-px  ×  s  ×  cameraZoom
                              └ container fit-scale    └ this.world.scale.x
```

- **`footprint-px`** — a part draws at world scale (`PITCH = ` the grid pitch) inside the container; a
  part at cell (c,r) sits at (c·PITCH, r·PITCH).
- **`s`** — the single uniform fit-scale `drawUserIcInternals` computes (`userIcInternalsView.ts:151`)
  to shrink the inner circuit's authored bbox into the package body rectangle. The whole `partLayer`
  (`this.userIcGlyphs`) is scaled by `s` and positioned onto the body.
- **`cameraZoom`** — `this.world.scale.x`, passed today into `update` as the `zoom` argument
  (`board.ts:2227`). It is the **camera/world** transform, and is **not currently threaded into
  `drawUserIcInternals`** — that is the first thing Phase 2 needs.

The replica's container tree (so the z-order and scale stacking are unambiguous):

```
world (scale = cameraZoom)                              board.ts:786
 ├─ wireLayer            (board's own wires)            board.ts:791   ← UNDER components
 └─ componentLayer                                      board.ts:794   ← OVER wires
     └─ ComponentNode.view
         └─ glyphHolder  (carries rot + mirror)         board.ts:6363
             ├─ tierGlyph                                board.ts:6357
             ├─ glyph     (the package frame goes here, glyph-local, UNSCALED)
             └─ userIcGlyphs  ==  partLayer  (scaled by s, positioned onto body)  board.ts:6362
                 ├─ child[0] = innerG     (all inner wires + junctions, one Graphics, cleared/frame)
                 └─ child[1..N] = one Graphics per inner part  (drawn AFTER innerG ⇒ ON TOP)
```

The `UserIcInternals` struct (`web/src/lib/netlist.ts:615`) the replica draws from carries:
`parts` (`UserIcInnerPart[]`), `wires`, `pinNodes`, `bbox`, `gndNode`, `pinCells`, **`innerGraph`**
(a reconstructed `BoardGraph`), **`nodeOfInner(e) → number | null`** (the flatten-aware net resolver),
and **`frameId`**. Phase 1 (`netlist.ts:1581`) emits one `UserIcInternals` per **inlined instance**,
keyed in a `Map<number, UserIcInternals>` by the instance's **flattened hub id** (`rec.instanceId`
from `FlattenRecord`), installed onto the board via `setUserIcInternals` (`board.ts:1492`) and read in
`update` via `this.userIcInternals?.get(id)` (`board.ts:2230`).

Crucially `flattenUserIcs` is already recursive to a fixed point (`userIc.ts:295`, waves to
`MAX_DEPTH`), and its `sink` already pushes a `FlattenRecord` **per inlined instance at every depth**
(`userIc.ts:311`) — *including nested ones* (for a nested instance `inst.id` is its already-inlined
offset id). So the netlist already builds and stores a `UserIcInternals` for **every** nested IC in the
hierarchy. Phase 2 is therefore overwhelmingly a **rendering** change: the data is present; the replica
just needs to (a) know a given inner part is itself a sealed IC, (b) find its `UserIcInternals`, and (c)
recurse the draw into a child container at the right scale once it is big enough on screen.

---

## Part A — Phase 2 recursive zoom-to-open architecture

### A.1 Thread `cameraZoom` (+ the map) into the opts and the call site

`drawUserIcInternals` must know the **absolute on-screen scale** of what it is drawing, to decide
per-inner-part whether to open it. The container fit-scale `s` is local; what crosses the open
threshold is `s · cameraZoom`. Add to `UserIcInternalsOpts` (`userIcInternalsView.ts:47`):

```ts
/** The camera/world transform (board.ts this.world.scale.x). On-screen px of an inner element
 *  = its world px × the CUMULATIVE container fit-scale × cameraZoom. Threads down the recursion
 *  unchanged (each nested level multiplies in its own s). Used to gate the per-part tier detail
 *  (Part B) and the recursive open of a nested sealed IC (Part A). */
cameraZoom: number;
/** The whole netlist map of inlined-instance → its inner circuit, keyed by FLATTENED hub id
 *  (board.ts this.userIcInternals). Threaded so a nested sealed-IC inner part can look up ITS
 *  internals and recurse. Absent in the static (unpowered) fallback (the geometry map carries no
 *  flattened ids) — recursion then simply doesn't fire and a nested IC stays a labelled box. */
allInternals?: Map<number, UserIcInternals>;
/** Recursion depth (0 at the top opened IC). A hard guard against a pathological hierarchy or a
 *  reseal cycle that slipped past flatten's MAX_DEPTH; capped at RECURSE_MAX_DEPTH. */
depth?: number;
/** The cumulative fit-scale of every ENCLOSING container (∏ of the parents' `s`), so a nested
 *  level can compute its own absolute on-screen scale without walking the Pixi tree:
 *  childAbsScale = cumulativeScale × thisLevel.s. Defaults to 1 at the top. */
cumulativeScale?: number;
```

At the board call site (`board.ts:6618`) add the three new fields:

```ts
drawUserIcInternals(g, {
  internals: effUserIc,
  nodeV,
  pins: this.pinPositions,
  wPx: this.wPx,
  hPx: this.hPx,
  color: this.color,
  phase,
  accent: lens === "analogy" ? PIPE_WATER : COND_ELEC,
  style: lens === "analogy" ? "factory" : "schematic",
  lens,
  partLayer: this.userIcGlyphs,
  cameraZoom: zoom,                 // == this.world.scale.x (the `zoom` arg already in update)
  allInternals: this.userIcInternals, // the full map, for nested lookups
  // depth / cumulativeScale default (top level is depth 0, cumulativeScale 1)
});
```

`zoom` is already a parameter of `update` (`board.ts:2227` passes `this.world.scale.x`). No `loop.ts`
change is needed — the wasm boundary already delivers `state` (node voltages) once per frame and the
camera transform is board-owned. (This keeps golden rule #2 intact: still one batched snapshot read.)

### A.2 Map each nested-IC inner part → its `UserIcInternals` — what to ADD to `UserIcInnerPart`

This is the one **data** gap. The replica iterates `parts: UserIcInnerPart[]`
(`userIcInternalsView.ts:331`); each `UserIcInnerPart` (`netlist.ts:580`) carries `kind`, `cell`,
`rot`, `mirror`, `value`, `nodes` — but **not the inlined id** that keys `allInternals`. Without it the
replica can detect a nested IC (`isUserIc(part.kind)` is true) but cannot find its inner circuit.

**Add one field to `UserIcInnerPart`:**

```ts
/** When this inner part is ITSELF a sealed user IC, its FLATTENED hub id within this build's netlist
 *  — the key into the netlist's `Map<number, UserIcInternals>` (board.ts userIcInternals), so the
 *  zoom-to-open replica can recurse into its inner circuit (Phase 2). Absent for a plain part and for
 *  the static (unpowered) fallback (no flatten ran). Render-only; never hashed. */
flatId?: number;
```

**Populating it in `netlist.ts` (`netlist.ts:1614`, the parts loop):** the inner component's flattened
id is exactly the id `flattenUserIcs`'s `remap` produced — `comp.id + o` for a non-frame inner
component, where `o` is this instance's offset (`rec.offset`). That id is the **same** key the nested
instance's own `FlattenRecord.instanceId` carries (because the nested instance was inlined at
`comp.id + o`, and flatten pushed its record keyed by that id). So:

```ts
parts.push({
  kind: comp.kind,
  cell: { col: comp.cell.col, row: comp.cell.row },
  rot: comp.rot,
  mirror: !!comp.mirror,
  value: comp.value,
  nodes: kind.pins.map((p) => nodeOfEndpoint({ componentId: comp.id, pinIndex: p.index })),
  ...(isUserIc(comp.kind) ? { flatId: comp.id + o } : {}), // o === rec.offset
});
```

That is **the entire mapping**: `userIcInternals.get(part.flatId!)` returns the nested IC's
`UserIcInternals`, whose `nodeOfInner`/`innerGraph` are already wired to the flattened netlist. (Confirm
the wave that inlined the nested instance ran with offset `comp.id + o` as the record's `instanceId`;
flatten guarantees this because the nested instance, once surfaced as a still-`REGISTRY`-tagged comp
with id `comp.id + o`, is processed in a later wave and pushes `{ instanceId: comp.id + o, … }`.)

In `userIcGeometry` (the static fallback, `netlist.ts:672`) leave `flatId` absent — the unpowered
replica has no flattened netlist, so nested ICs there stay labelled boxes (acceptable: there is nothing
live to show inside them anyway).

### A.3 The recursion — drawing a nested IC's replica into the inner part's child container

Today the parts loop (`userIcInternalsView.ts:331`) draws every inner part with the small
`drawGlyphIn` glyph into its pooled `child` Graphics. Phase 2 replaces that single draw with a
three-way base/recurse decision **per inner part**, on its absolute on-screen scale:

```
childAbsScale = s · cumulativeScale · cameraZoom        // s = THIS level's fit-scale
partOnScreenPx = footprintPx(kind) · childAbsScale       // longest footprint side × the scale
```

1. **`partOnScreenPx < TIER_threshold`** → the small glyph (today's `drawGlyphIn`) — unchanged base.
2. **`partOnScreenPx ≥ TIER_threshold` and the part is NOT a sealed IC** → the **tier detail drawer**
   (Part B below) — the standalone transistor-model fix, and the recursion's true base case.
3. **`partOnScreenPx ≥ OPEN_threshold` and the part IS a sealed IC with a resolvable `flatId`** →
   **recurse**: draw the nested IC's own replica into this inner part's child container.

The child container today is a single `Graphics` (`partLayer.children[k+1]`). For a nested IC it must
become a **sub-`partLayer`** of the same shape (`child[0]=innerG`, `child[1..M]=its parts`). The clean
way: give each inner-part slot a small **holder Container** (orient + position it exactly as
`userIcInternalsView.ts:347` does today — `position = cell·PITCH`, `scale.x = mirror?-1:1`,
`rotation = rot·π/2`), and:

- **glyph/detail base case:** the holder contains one `Graphics` we draw the glyph/detail into.
- **recurse case:** the holder contains a nested **`partLayer` Container** + a `Graphics` for the nested
  **package frame**, and we call:

```ts
drawUserIcInternals(nestedFrameG, {
  internals: nested,                       // allInternals.get(part.flatId!)
  nodeV,                                   // SAME snapshot — live at every depth
  pins: nestedKind.pins.map(...glyph-local px...),   // the nested package's pin px (kind.pins · PITCH)
  wPx: (nestedKind.w - 1) * PITCH,
  hPx: (nestedKind.h - 1) * PITCH,
  color: PALETTE.accent,                   // a sealed user IC is accent-tinted (userIc.ts:133)
  phase, accent, style, lens,              // inherited unchanged → the lens follows the board
  partLayer: nestedPartLayer,              // this inner part's OWN scaled sub-container
  cameraZoom,
  allInternals,
  depth: (depth ?? 0) + 1,
  cumulativeScale: s * (cumulativeScale ?? 1), // accumulate THIS level's fit-scale for the child
});
```

The nested call computes **its own** `s` (fitting its inner bbox into its own package body) and scales
**its** `partLayer` by that `s` — relative to the holder, which already carries this part's
position/rotation/mirror and sits inside the parent `partLayer` (scaled by the parent `s`). So the Pixi
transform stack multiplies the fit-scales automatically: a transistor three levels down lands at
`PITCH · s_top · s_mid · s_leaf` in world space, and the `world.scale` (cameraZoom) finishes it. The
**package frame** of the nested IC draws into its holder's frame-Graphics glyph-local (unscaled),
exactly as the top frame draws into `g` today — so each nested cell reads as a real chip-within-a-chip
with leads on the outside, then its interior fills with the next level down. This is the plan's
"nested cells show as labelled boxes with pinouts until you zoom into them."

**Pool growth.** The part-pool resize (`userIcInternalsView.ts:113`) must allocate the right child
**shape** per part (plain holder vs nested-replica holder) and rebuild a slot when a part's kind flips
between plain and sealed-IC across edits (a reference/identity compare, like the `staticUserIcDef`
guard at `board.ts:6583`). Destroy a slot's nested sub-tree when it falls back below `OPEN_threshold`
(or is culled) so a deep dive that scrolls away frees its GPU objects — the auto-cull the plan calls
for ("only the levels currently large-enough-and-in-view are drawn, so infinite zoom stays cheap").

### A.4 Depth-guard + culling

- **Depth guard:** `if ((depth ?? 0) >= RECURSE_MAX_DEPTH) return;` at the top of any recurse decision
  (suggest `RECURSE_MAX_DEPTH = 24`, mirroring flatten's `MAX_DEPTH` so the two bounds agree). Belt and
  braces against a cycle that slipped flatten's guard; in practice the on-screen-size gate (A.5) stops
  recursion far sooner because each level shrinks the child by its `s`.
- **Size cull (the real economy):** a nested IC only recurses when `partOnScreenPx ≥ OPEN_threshold`.
  Because `s < 1` at every level (a circuit fits *inside* its package), `childAbsScale` shrinks
  geometrically with depth, so for any fixed cameraZoom only a **finite, small** number of levels are
  large enough to open. Everything deeper stays a labelled box (drawn cheaply or not at all).
- **View cull:** additionally skip a nested recurse (and its glyph/detail draw) when the part's body
  box, transformed to screen space, lies fully outside the viewport. The board already culls offscreen
  `ComponentNode`s; the same `getBounds`-vs-screen-rect test applied to the holder keeps a giant
  zoomed-in cell from drawing the thousands of sub-cells that are scrolled off-frame. Pair with A.3's
  destroy-on-cull so memory tracks what's visible.

### A.5 Live signals at every depth — the recursive `nodeOfInner`

This is already solved by Phase 1's data model and needs **no new plumbing**: the nested
`UserIcInternals` fetched via `flatId` carries its **own** `nodeOfInner`/`innerGraph`, both built in
`netlist.ts` against the **flattened** netlist (`netlist.ts:1689`). Because the flattened sim holds
*every* transistor-level node (flatten inlines the whole hierarchy before `buildNetlist`), a nested
level's `nodeOfInner(innerEndpoint)` resolves straight into the same `node_voltages` (`nodeV`) the top
level reads. So:

- The same `nodeV` snapshot is passed down unchanged at every depth (A.3).
- Each level colours its wires/junctions/parts via **its own** `nodeOfInner` + the shared
  `voltageColor` — identical hues to the die editor, live, all the way down.
- `null`-awareness is preserved per level (floating inner runs → cyan; `applyCrossings` keeps distinct
  floating nets apart — see `netlist.ts:634` on why `null`, not `0`, is load-bearing).

A nested cell therefore animates from the real solved state the instant it opens — no separate sim, no
per-depth boundary read.

---

## Part B — the transistor-model fix (per-part tier detail) as the base case

**The defect (owner-reported):** the replica's inner parts *always* use the small `drawGlyphIn` glyph
(`userIcInternalsView.ts:366`). The die editor, zoomed past `TIER_ZOOM`, swaps each part to its
**tier-detail illustration** — `drawDetail` (reality) / `drawAnalogy` (analogy) — so a MOSFET shows its
animated device/valve, a resistor its scatter lattice, etc. (`board.ts:6633-6677`). Inside the opened
IC those parts never make that swap, so a zoomed-in sealed inverter shows tiny schematic MOSFET symbols
where the bare board would show the full transistor model. Fixing this is **both** the standalone
"transistor-model in the replica" fix and Phase 2's base case (decision #2 in A.3).

**The gate (per inner part, on `s · cumulativeScale · cameraZoom`):** mirror `board.ts:6549` and
`board.ts:6633`. For each part, choose its tier from the **lens** (the replica already receives `lens`):

```ts
const partTier =
  lens === "reality" && hasDetail(part.kind) ? "reality"
  : lens === "analogy" && hasAnalogy(part.kind) ? "analogy"
  : null;
const absScale = s * (cumulativeScale ?? 1) * cameraZoom; // on-screen px per world px
```

Then render the detail when zoomed in enough. The board uses the **world** scale against `TIER_ZOOM`;
in the replica the part's effective magnification is `absScale`, so the equivalent gate is
`absScale >= TIER_ZOOM`. (Optionally gate on `partOnScreenPx` directly for parity with A.3's
`TIER_threshold`; `absScale ≥ TIER_ZOOM` is the faithful translation of the editor's own test.)

**The exact `TierOpts` / anchors / REF-size block to copy from `board.ts:6641-6677`** — adapted to draw
into the inner part's child `Graphics` (call it `dg`) instead of `tierGlyph`, with the part's
**glyph-local** geometry (footprint px) instead of `this.wPx`/`this.pinPositions`:

```ts
// REF-then-scale, exactly as board.ts:6641 — render big so the drawers' fixed-px details
// (studs, throats, spring/piston clamps like `anchorX − 40`) don't distort at the tiny footprint.
const REF_HW = 130;
const REF_HH = 80;
const partWPx = (kind.w - 1) * PITCH;   // this inner part's footprint width in world px
const partHPx = (kind.h - 1) * PITCH;
const targetHW = partWPx / 2 + PITCH * 0.7;   // same target the board uses (this.wPx/2 + PITCH*0.7)
const detScale = targetHW / REF_HW;

// Each catalog pin's position in REF space, so a multi-terminal drawer routes its leads onto the
// real footprint pins. The detail is centred on the footprint and scaled by detScale, so a pin at
// glyph-local (p − footprint-centre) is (that / detScale) in REF px. Mirror board.ts:6650.
const glyphPins = kind.pins.map((pin) => ({ x: pin.dx * PITCH, y: pin.dy * PITCH }));
const anchors = glyphPins.map((p, i) => ({
  label: kind.pins[i]?.label ?? "",
  x: (p.x - partWPx / 2) / detScale,
  y: (p.y - partHPx / 2) / detScale,
}));

const opts: TierOpts = {
  kind: part.kind,
  bounds: { hw: REF_HW, hh: REF_HH },
  color: PALETTE[kind.colorKey],
  electrical,            // the SAME { current, vAcross } the glyph base case builds (see below)
  phase,
  value: part.value,
  // wiper/temp: pull from the inner Component if the replica grows to carry them; absent ⇒ the
  // drawer's own default (only the POT/NTC/PTC drawers read them). Today's struct has only `value`.
  anchors,
};

setStudsVisible(false);             // board.ts:6668 — hide the illustration's decorative studs;
if (partTier === "reality") drawDetail(dg, opts);   // the real pin dots / wire grommets mark the
else drawAnalogy(dg, opts);                          // connections, avoid the doubled-terminal clutter
setStudsVisible(true);              // board.ts:6671

dg.scale.set(detScale);             // board.ts:6672 — REF → footprint
// dg lives in the part's holder, which carries position = cell·PITCH, rotation = rot·π/2,
// scale.x = mirror?-1:1 (A.3) — so the detail orients EXACTLY as the editor's glyph holder does.
```

**`electrical` for the drawer:** reuse the replica's existing per-part readout
(`userIcInternalsView.ts:359`): `{ current: 0, vAcross: vAt(na) − vAt(nb) }` (voltage across the part's
first two terminals; current not attributed — see divergence C-4). The detail drawers degrade
gracefully on `current = 0` (motion fades; the field/charge animation rides `vAcross`). When the
per-inner-wire current of C-4 lands, feed the real `current` here too.

**Orientation parity (load-bearing).** Just as the glyph base case rotates the *holder* and draws
canonical pins (`userIcInternalsView.ts:341` warns: a drawer that infers orientation from pin
positions — the MOSFET valve, polarised sources — renders a rotated/mirrored part **wrong** if handed
pre-rotated pins), the detail base case must draw into the **holder** (which carries rot+mirror) using
**canonical** `anchors` (computed from unrotated `kind.pins`). Do **not** pre-rotate the anchor points.

---

## Part C — opened-IC ↔ die-editor divergence audit

Every remaining way the replica (`drawUserIcInternals`) differs from the die editor (`redrawWires` +
the tier/gauge machinery). Each: **cause → fix → render-only/golden-safe → tractability (S/M/L)**.
Ranked by visual impact / how much it breaks the "rendered the exact same way" invariant.

### C-1 — Inner parts use the small glyph, never the tier detail  *(Part B)* — **M**
- **Cause:** `userIcInternalsView.ts:366` always calls `drawGlyphIn`; there is no `s·cameraZoom` gate to
  `drawDetail`/`drawAnalogy` as the editor does at `board.ts:6633`.
- **Fix:** Part B — per-part detail gate on `absScale ≥ TIER_ZOOM`, copying the REF-size/anchors/
  `TierOpts` block from `board.ts:6641-6677` into the part's child Graphics.
- **Render-only / golden-safe:** yes — pure drawing; the drawers read only `ElectricalState`+`phase`.
- **Tractability: M.** The block is self-contained, but needs the per-part holder restructure (A.3) so
  the detail orients correctly, plus pool-shape handling. The single biggest fidelity win; do it first.

### C-2 — The schematic lens shows a blank replica  *(needs a plain-polyline wire/junction branch)* — **S–M**
- **Cause:** the `wantUserIc` gate (`board.ts:6570`) requires `lens === "reality" || lens === "analogy"`
  — the **schematic** lens is excluded, so a sealed IC zoomed in under the clean schematic lens shows
  the black-box symbol, never its inner circuit. (And the shared `drawConduitSkin`/`drawJunctionConduit`
  the replica uses have **no schematic branch** — `boardRender.ts:593`,`:662` always draw pipes — so
  even if the gate let schematic through, the inner wires would be pipes, not schematic lines.)
- **Why it diverges:** the die editor *does* draw a schematic-lens board (the bare orthogonal trace +
  chevrons + plain junction dots — `redrawWires` `else` branch at `board.ts:4781-4785`,`:4829-4839`).
  The replica simply has no schematic rendering path.
- **Fix:** (a) extend the `wantUserIc` gate to include `"schematic"`; (b) in `drawUserIcInternals`,
  branch on `lens === "schematic"`: draw each wire as a **plain polyline** (the `board.ts:4781` style —
  a wide faint halo stroke + a thin bright `color` stroke), junctions as a **plain dot**, and skip the
  conduit skin/grommets entirely. The route family (`routeForWire`/`nudgeParallel`/`applyCrossings`/
  `roundedPoints`) is lens-agnostic and is reused as-is; only the final *skin* differs. (Parts already
  follow the lens via `style: "schematic"` once C-2 passes `style` correctly for the schematic case.)
- **Render-only / golden-safe:** yes.
- **Tractability: S–M.** Gate change is trivial; the plain-wire/junction skin is a ~20-line branch
  mirroring an existing board block. Bumps the line count in the view but no structural change.

### C-3 — No per-net voltage gauges / standpipes  *(`drawNetBars` / `drawNetStandpipes`)* — **L**
- **Cause:** the die editor draws a per-net **magnitude gauge** on top of the conduit — the reality
  segmented LED bar (`drawNetBars`, `board.ts:5161`) or the analogy water standpipe
  (`drawNetStandpipes`, `board.ts:5321`) — at each net's anchor (`board.ts:4923`). The replica draws
  **neither** (its TODO at `userIcInternalsView.ts:323` names exactly these). This is the
  power-bus visual language's **voltage = pre-attentive magnitude channel** (`docs/ui/visual-language.md`)
  — its absence is the most semantically significant divergence: the opened IC shows rail *identity*
  (hue) but not rail *magnitude*.
- **Why it's hard:** `drawNetBars`/`drawNetStandpipes` are **private board methods** that depend on a
  thicket of board-only state — `netGaugeAnchors`, `circuitVMaxByGroup`, `netVStats`, `nodeColor`,
  `netSwing`, `circuitGroup`, `nodeVrms` — i.e. **RMS / envelope statistics** the board accumulates per
  frame (`nodeVrms`, the sub-frame batch), which the replica's `nodeV` (instantaneous voltages) does
  **not** carry. A faithful port needs either (a) those stats threaded into `UserIcInternals` per inner
  net, or (b) hoisting the gauge family into `boardRender.ts` parameterised on a `nodeStats(node)`
  provider + an anchor list, then feeding it the inner nets via `nodeOfInner`.
- **Fix:** extract `drawNetBars`/`drawNetStandpipes` + their helpers into `boardRender.ts` (the Phase-0
  Approach-A pattern: `this`-free, re-parameterised on the graph/stats), keep thin board wrappers, and
  call them from the replica over `innerGraph`'s nets — with anchors derived from the same `condRoutes`
  the replica already computes (`userIcInternalsView.ts:183`). The RMS/envelope inputs need a
  render-only per-inner-net stats source: simplest is to thread the board's `nodeVrms`/`netVStats`
  outputs (already computed for the flattened nodes, since the inner nodes ARE flattened nodes) into the
  opts, resolved per inner net via `nodeOfInner`.
- **Render-only / golden-safe:** yes (gauges read voltages/RMS only; nothing hashed).
- **Tractability: L.** The biggest extraction; touches the most board-private surface. Sequence it after
  C-1/C-2. Until then the replica is honest about identity but silent on magnitude.

### C-4 — No carrier flow-dots / energy belts  *(needs a per-inner-wire current)* — **L**
- **Cause:** the die editor animates **charge carriers** (chevrons/dots) and an **energy belt** along
  every wire, density+thickness riding the **branch current** (`board.ts:4807-4911`,
  `beltDots`/`sampleRouteAt`). The replica draws static pipes with **no carriers** (TODO at
  `userIcInternalsView.ts:324`). So the opened IC shows *where* current would flow (the pipes) but never
  the *flow* — the loop-tile/Factorio-belt language the whole game leans on.
- **Why it's hard:** the carrier density/direction needs a **signed current per inner wire**, which the
  board derives in `computeWireFlow` (`board.ts:5824`) by running a KCL spanning-forest over
  `this.electrical` (**per-element currents**, keyed by component id) and `this.graph.wires`. The
  replica has **neither**: `update` passes only `nodeV` (voltages), and `UserIcInnerWire`/`InnerPart`
  carry **no current**. (`this.electrical` *does* contain the inner elements — their flattened ids are
  real netlist elements — but it isn't passed into `update`, and the inner part's flattened id isn't on
  the struct until A.2's `flatId`.)
- **Fix:** two options. (a) **Compute it in the replica:** thread the board's `electrical`
  map (or a render-only inner-element-current map) + use A.2's `flatId` to key it, then run a hoisted,
  `this`-free `computeWireFlow` over `innerGraph` — exact parity with the editor. (b) **Precompute in
  netlist.ts:** while `buildNetlist` already has the flattened element currents post-solve, emit a
  per-inner-wire signed current onto `UserIcInnerWire` (extend the struct) — cheaper per frame but
  couples the struct to a solve pass. Option (a) is the faithful, recursion-friendly choice (it works at
  every depth via each level's own `nodeOfInner`/`innerGraph`); option (b) only covers the top level
  unless replicated per nested record. Once a current exists, reuse `beltDots`+`sampleRouteAt` over the
  replica's `condRoutes` (already built) with the editor's exact carrier/energy/shimmer code.
- **Render-only / golden-safe:** yes.
- **Tractability: L.** Needs both a current source and a `computeWireFlow` hoist; pairs with C-1's
  `electrical` thread (the detail drawers also want the real `current`). Do after C-3.

### C-5 — Inner part bodies clip / paint over the inner wires  *(component layer over wire layer)* — **S**
- **Cause:** in the replica, **all wires + junctions** draw into `innerG` = `partLayer.children[0]`
  (`userIcInternalsView.ts:111`), and the **inner part glyphs** draw into `partLayer.children[1..N]`
  (`userIcInternalsView.ts:333`) — i.e. **after** `innerG`, so a part body paints **on top of** the
  wires that should run under it / land on its pins. On the real board the separation is the opposite:
  `wireLayer` is added **before** `componentLayer` (`board.ts:791` vs `:794`), so wires are under
  components board-wide, but the board compensates with the conduit **port grommet/collar**
  (`drawConduitSkin`'s end-cap, `boardRender.ts:646`) flaring the pipe cleanly into the pin — the wire
  *reads* continuous into the part. In the replica the same z-order holds, but because the inner parts
  are tier-detail/glyphs at the SAME container depth, a large part body can occlude a wire elbow that
  routes past it, reading as a clipped/broken trace.
- **Fix (trim option):** either (a) give `innerG` a higher child index than the parts (draw wires
  **last**, like a schematic where nets sit over symbols) — simplest, and matches the schematic reading;
  or (b) keep the order but **trim** each inner wire's route at the part's body box (stop the conduit at
  the body edge, as the editor's grommet does) so no wire is drawn *under* a body it would otherwise
  cross; or (c) split into a sub-`wireLayer` Container drawn after the parts within `partLayer`. Option
  (a) is the one-line fix (swap the pool so `innerG` is the last child, or move it to a second pooled
  Graphics added after the parts).
- **Render-only / golden-safe:** yes.
- **Tractability: S.** A z-order/pool-index change in the view; no new data.

### C-6 — Lead connectors are present but the package-to-pin handoff differs slightly — **S**
- **Cause:** the replica draws a **lead connector** from each inner frame-pin to the package lead root
  (`userIcInternalsView.ts:305-321`) as a plain `drawConduitSkin([fpW, rootW], …)` two-point pipe — a
  Phase-0 follow-up the plan notes is "deferred." The die editor's frame leads route with the **down-bend
  / frame-pin exit** geometry (`routeForWire`'s `dieFrameId` path, `frameLeadRoute` at
  `boardRender.ts:777`) rather than a straight stub, so the elbow into a package pin can differ from the
  editor's. Also the replica's lead is colour `netColor(pinNodes[i])` and width `PW`, matching the inner
  pipes, but it lacks the editor's pin-align stub nuance for the boundary leads.
- **Fix:** route the boundary leads through the same `routeForWire`/`frameLeadRoute` family used for the
  interior (the replica already imports `routeForWire`), treating the package boundary as the frame
  exit, so the down-bend matches; or accept the straight stub as a deliberate simplification (it is
  visually close). Low priority.
- **Render-only / golden-safe:** yes.
- **Tractability: S.**

### C-7 — Fail boxes / over-current FAIL flags are not shown inside the replica — **S–M**
- **Cause:** the board boxes a `failed_elements` part (over its `RATED_CURRENT_SLOT`, per CLAUDE.md's
  "Ratings → FAIL"; the renderer draws a `failBox`/`failText` per `ComponentNode`, `board.ts:6431`).
  Inner parts in the replica are bare glyphs/details with **no fail decoration**, so a sealed IC whose
  inner transistor is over its rating shows the box on the *outer* hub (if at all) but not on the
  offending inner part.
- **Fix:** the fail mask is keyed by **element index**, resolvable for an inner part via its `flatId`
  (A.2) → element index. Thread the fail set into the replica and draw a thin box around a failed inner
  part's body. Render-only (the mask only *flags*, never alters the solve — golden-safe by design).
- **Render-only / golden-safe:** yes.
- **Tractability: S–M.** Needs the element-index resolve + a small box draw; no structural change.

### C-8 — Net-label colour overrides / pinned-net colours are not honoured inside the replica — **S**
- **Cause:** the die editor lets a pinned net-label override a net's hue (`endpointColor`/`nodeColor`
  consult per-node colour overrides, `board.ts:1496`). The replica colours purely by `voltageColor(vAt
  (node))` (`userIcInternalsView.ts:169`) — it has no access to the node-colour-override map — so an
  inner net the author colour-pinned shows its rail hue, not the pinned colour.
- **Fix:** thread the node→colour-override map (already on the board, `setNodeColors`) into the replica
  and prefer it in `netColor`, exactly as `endpointColor` does. Render-only.
- **Render-only / golden-safe:** yes.
- **Tractability: S.**

### C-9 — Inner-part `wiper` / `temp` (and other secondary scalars) not carried — **S**
- **Cause:** `UserIcInnerPart` carries only `value` (`netlist.ts:592`); a POT's `wiper` and an NTC/PTC's
  `temp` are absent, so those drawers (the only readers of `wiper`/`temp`) fall back to defaults inside
  the replica — a pot at the author's wiper position renders centred, a thermistor at ambient. The
  editor passes the live `wiper`/`temp` from the `Component` (`board.ts:6662-6664`).
- **Fix:** add optional `wiper`/`temp` to `UserIcInnerPart`, populate from the inner `Component` in
  `netlist.ts`, and pass into the Part-B `TierOpts`. Render-only.
- **Tractability: S.**

### C-10 — Energy belt / shimmer-band high-frequency render absent — **M** (subsumed by C-4)
- **Cause:** beyond carriers (C-4), the editor draws the **energy belt** (warm power dots,
  `board.ts:4904`) and the **carrier→shimmer** handoff for fast AC (`board.ts:4860`). The replica has
  none — a fast-AC inner branch that would shimmer on the board is a static pipe in the replica.
- **Fix:** rides on C-4 — once a per-inner-wire current (+ its AC `freq`/`acFrac`) is available, reuse
  the editor's energy + `blurFactor`/`apparentFreq` shimmer block verbatim. Needs the inner wire's AC
  amplitude/frequency too (from the flattened element AC measurements via `flatId`).
- **Render-only / golden-safe:** yes.
- **Tractability: M.** Additive once C-4's current+freq plumbing exists.

### C-11 — Minor colour / width / z-order parity nits — **S**
- **Pipe width:** the replica uses a fixed `PW = 4` core width (`userIcInternalsView.ts:182`); the
  editor modulates pipe width by current (`pw = 4 + 5·normC`, `board.ts:4775`). Without C-4's current
  the replica can't modulate — so inner buses don't fatten toward a source. Resolves with C-4.
- **Crossing-dot radius / colour:** the replica's tie dots (`userIcInternalsView.ts:284`) and the
  editor's (`board.ts:4916`) use the same `4.5`/`3` radii + `0x0d0b16` backing — **matched** (good).
- **Junction hub:** both use `drawJunctionConduit` — matched, including the reality solder-dome (which
  scales with `r`, so it degrades cleanly in the shrunk replica, `boardRender.ts:682`). Matched.
- **Package label fade:** the editor fades a sealed IC's designator as you zoom into the replica
  (`board.ts:6594`); inside the replica the nested package labels would need the same fade as you dive
  past each one — additive nicety, pairs with A.3's nested frames.
- **Tractability: S** (each); mostly fall out of C-4.

### Divergences that are NOT present (verified parity — do not "fix")
- **Wire routing geometry** (elbows, down-bend, parallel fan, crossings/bridges) — the replica reuses
  the **identical** `routeForWire`/`conduitDrawRoute`/`nudgeParallel`/`applyCrossings`/`roundedPoints`
  pipeline + junction follow-pass (`userIcInternalsView.ts:194-296`), step-for-step mirroring
  `redrawWires`. Matched by construction.
- **Rail-identity hue** (`voltageColor`), **floating→cyan**, **null-net handling** — matched
  (`userIcInternalsView.ts:169`).
- **Part orientation** (canonical pins in a rot+mirror holder) — matched (`userIcInternalsView.ts:341`).
- **Conduit skin look** (moat/wall/core, reality soldermask + sheen, port grommets) — matched (same
  `drawConduitSkin`).

---

## Suggested sequencing

1. **C-1 / Part B** (transistor detail) — biggest fidelity win, the owner's explicit ask, the Phase-2
   base case. Carries the per-part holder restructure that Phase 2 recursion (A.3) also needs.
2. **A.2 `flatId` + A.1 threading** — the data + opts plumbing; unlocks recursion *and* C-4/C-7.
3. **A.3/A.4/A.5 recursion** — the nested replica, with depth guard + size/view cull.
4. **C-2** (schematic-lens branch) — small, removes a whole-lens blank.
5. **C-5** (wire/part z-order) — one-line trim, stops clipped traces.
6. **C-4 + C-10/C-11** (per-inner-wire current → carriers, energy, shimmer, width modulation) — the
   `computeWireFlow` hoist; restores the flow language.
7. **C-3** (net gauges/standpipes) — the largest extraction; restores the voltage-magnitude channel.
8. **C-6 / C-7 / C-8 / C-9** (lead routing, fail boxes, pinned colours, wiper/temp) — small parity
   cleanups.

Every step gates with `pnpm -C web check && lint && build && test` and is render-only (the golden hash
`0xeaac_3764_99e4_fa24` is untouched throughout), per the master plan's audit protocol.

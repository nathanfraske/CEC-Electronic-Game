<!-- SPDX-License-Identifier: Apache-2.0 -->

# Bus cable as a first-class trace — design

Status: **scoped (2026-06-29) from owner art-direction; build next.** The bus `Cable` (`graph.ts`
`interface Cable`; rendered by `board.ts` `drawCables`) started as a render-only trunk. The owner wants it
to behave and read like **any other trace** — only bundled. This note captures the full vision + the
grounded implementation approach. **All of it is web-only / render+UX, golden-safe** (a cable lowers to N
auto net-labels via `deriveCableLinks`; `sim-core` never sees it).

## Landed already

**Select + delete** (`db2db96`). `cableHitTest` (vs the trunk polyline cached each frame in
`cableTrunkRoutes`, the analogue of `conduitDrawRoutes`), `selectedCables` + `selectCable` (mirrors
`selectWire`); accent halo in `redrawSelection`; `deleteSelection` → `graph.removeCable`; every selection
reset clears cables; a selected cable counts as an edge in `emitSelect`.

**S1 lens-respect** (`6bd4a84`). The bundled trunk skins via `drawConduitSkin` (analogy pipe / reality
conductor / schematic trace), threaded from `redrawWires`.

**S2 belt-fan** (`84107ad`). Replaced the blocky pinch with the owner's Factorio-balancer symmetric
convergence: strands ordered top→bottom by source-pin Y (no crossings), each turning toward the bus centre
as a **compact nested chevron** keyed to its rank FROM the centre — outermost strands run straight out
longest and turn in last; evenly scalable (verified 4 + 8 wide).

**S3 zoom-unzip + per-strand colour + bent/close generalization** (this change). Above `TIER_ZOOM` and
`!collapsed`, a cable fans into its N literal strands, each `endpointColor`'d by its bit's net and
lens-skinned (S1). The unzip now handles **any horizontal-approach bus, straight OR bent**: the parallel
bundle follows the (possibly routed) trunk via `offsetOrtho` (parallel-curve of the Manhattan centreline —
each strand a lane offset perpendicular by its rank, so the bundle bends with the route, corners nesting),
spliced between the two belt-fan chevrons. `buildCableTrunk` orthogonalizes `[srcGather, …route, dstGather]`
(a Z when both gathers share an approach axis at different rows, an L when they differ). **Too-close
fallback:** when the trunk is shorter than the fan needs (zip and unzip would meet), each bit instead runs
**straight through** pin→pin — a clean Manhattan trace (a single line for an aligned bus), no bundling.
Verified via `shoot --democable --democable-mode straight|bend|close` (the harness now stands up all three
layouts). All render-only / golden-safe.

**The geometry now lives in `web/src/lib/cableGeometry.ts`** (`buildCableTrunk` / `offsetOrtho` /
`cableStrandRoutes` — pure, no instance state), so the crossing-free property is unit-tested in
`cableGeometry.test.ts` without a browser. **Bowtie fix (bent buses):** the first version crossed the
strands at the entry bend — `buildCableTrunk`'s elbow landed at the gather's coordinate while the first
route waypoint sat the *other* side of it, so the trunk hooked out-and-back (a cusp), and the perpendicular
offset of a cusp crosses. `buildCableTrunk` now drops any vertex collinear with both neighbours, collapsing
that backtrack spur to a clean monotonic run. **Width-agnostic:** `cableStrandRoutes` is crossing-free at
ANY N — the test asserts zero inter-strand crossings + a spur-free trunk for widths **2,3,4,5,7,8,10,12,16,
24,32,48,64** across straight / bent / too-close (odd widths centre a strand on the trunk at `d=0`). A very
wide bus simply needs the parts proportionally further apart to belt-fan, else it cleanly run-throughs.
**Convergence tuning** (owner art-direction): the nested chevron is anchored at each end's FAN-START (the
pin lead-out), NOT out at the gather, so the strands begin converging right next to their pins (short
pin→convergence lead) and then run as a long parallel bundle to the gather; and the chevron's x-stagger
`STEP = LANE·1.2` (on par with the bundle's strand spacing, a touch bigger) so the nest packs at just over
45°, matching the ribbon density.

**S4 drag-reroute** (this change). Grab a trunk segment and drag it perpendicular (KiCad-style) to bend the
cable, exactly like a wire's segment-drag — the gather ends stay put (they track the parts). Reuses the wire
machinery: `beginCableSegmentDrag` runs the shared pure `planSegmentDrag` on the DRAWN trunk
(`cableTrunkRoutes`, cached each frame) with the gathers as fixed endpoints; `updateCableSegmentDrag` writes
the interior brackets back via `graph.setCableRoute` (render-only — connectivity is the per-bit labels,
untouched); on drop `cleanRouteWaypoints` collapses redundant bends. The trunk is rebuilt from the route on
redraw (re-orthogonalized + spur-collapsed), so the bundle AND every unzipped strand follow the new bend. One
undo step; gated on actual movement (a bare click only selects). Verified by a headless pointer drive
(`board.cableProbe` / `window.__cecCableProbe`): dragging a straight cable's trunk down turns its empty route
into a clean Z-bend and the strands follow.

**S5 per-bit tap** (this change). The JUNCTION tool on an unzipped cable STRAND breaks that one bit out: it
drops a **free junction** on the strand at the click cell and the player wires off it to a process. Data
model: `Cable.taps?: { bit, junctionId }[]` — `graph.addCableTap(cableId, bit, at)` creates the free junction
and `deriveCableLinks` emits a matching owner-tagged label (`cableNetName(id, bit)`) at it, so buildNetlist's
same-name union ties the junction onto bit `bit`'s net — **no new sim element, golden-safe** (a tap === a
junction + a label, exactly the owner's manual `bus-tap-reference` pattern, auto-managed). The tap junction is
cleaned up with `removeCableTap` / when the cable or an endpoint part is removed; stale taps self-heal in
`deriveCableLinks`. Strand hit-test reads a per-frame `cableStrandCache` (only matches when fanned). Verified
by unit tests (`cable.test.ts`: the tap lands on the right bit's net, is bit-isolated, and cleans up) AND a
headless drive (junction-mode click on a strand → `cable.taps` 0→1, junction dot on the bit). **Whole-bus fan-out** (this change): the JUNCTION
tool on the COLLAPSED TRUNK (zoomed out, where no strands are drawn) breaks EVERY bit out at once —
`graph.addCableFanOut(cableId, at, reversed)` drops one tap per bit on a staggered down-right diagonal (one
column each so the break-out wires don't collide), forward bit order by default or **reversed with Shift**
(the owner's "junction up" vs "sequential junction down"). The gesture is zoom-disambiguated: zoomed IN a
click hits a strand → single-bit tap; zoomed OUT it hits the trunk → whole-bus fan-out. Tested
(`cable.test.ts`: N taps, forward/reversed bit order, staggered cells, each on its bit's net) + headless
drive (zoomed-out junction-click → `cable.taps` 0→N).

**Break-out stubs + scaled tap nodes** (owner review — the staggered tap junctions sat at grid cells off the
sub-cell strands, so they floated and read oversized). Fixes, both render-only in `board.ts`: each tap now
draws a thin, bit-coloured, lens-skinned Manhattan **stub** (`drawCableTapStubs`, end of `drawCables`) from
the point on its bit's strand (`cableStrandCache`; the collapsed trunk when zoomed out) to the junction — so
a tap reads as ATTACHED to the bus and a whole-bus fan-out reads as the strands visibly dropping out at
staggered points; and `drawJunctions` renders cable-tap junctions at a smaller `TAP_R` (the grab/hit range
stays `JUNCTION_R`-based, so they're still easy to wire from).

**Tap node sits ON the strand + a distinct bit label** (owner ask). `drawJunctions` now SKIPS cable-tap
junctions entirely — `drawCableTapStubs` owns the whole tap visual: a haloed **on-strand node** at the
break-out point on the bit's strand, the bit-coloured **stub** peeling out to the wire-anchor node at the
junction cell, and a **bit tag** pill (`${cable.base}${bit}`, e.g. `DATA2`) in the net's colour just off the
anchor (pooled `cableTapTexts`, resolution-tracked like the net labels). So a tap reads as a labelled
break-out sitting on the bus, and a whole-bus fan-out is the strands peeling off to `DATA0…DATA3` at
staggered points. Render-only.

**Consistent right-click CONTEXT MENU** (owner — "make right-clicking consistent across the board. Right now it
deletes elements for most things. And for the forward vs reverse [fan-out], none of those options are really
great … they either sacrifice accessibility by adding excessive mouse precision, or they add more bloat to an
already bloated menu and toolbar"). Right-click was a per-target *delete*, and the whole-bus fan-out
forward/reversed sat in fiddly junction-tool gestures (zoom-out-trunk-click = forward, **Shift**+click =
reversed — exactly the "excessive precision" complaint). Now ONE affordance: `onRightDown` →
`buildContextMenu(wx,wy)` hit-tests topmost-first (label → junction → wire → cable[strand|trunk] → part),
**selects** the target (highlight shows what the menu acts on) and returns rows — label/junction/wire ⇒
*Delete X*; **cable** ⇒ *Tap bit N* (only when a strand was hit, with that bit) · *Fan out ▾ (forward)* · *Fan
out ▴ (reversed)* · *Delete cable*; part ⇒ *Rotate · Flip · Delete*. Each row's `run` does its own action +
undo; the board emits a `ContextMenuRequest` (page coords + rows), the HUD renders a `position:fixed`
`.ctx-menu` popover (clamped into the viewport, on-brand dark/uppercase/`--bad`-danger), dismissed by Escape,
left-click-away (`<svelte:window onpointerdown>`; right-clicks pass through so the menu re-opens elsewhere), or
clicking a row. The junction tool keeps its quick **tap-a-strand**, but its fan-out gestures (+ the Shift
branch + `placeCableFanOutAt`) are **gone** — fan-out lives only in the menu, so no gesture precision and no
toolbar bloat. `addCableFanOut(reversed)` now fans the stack the *side you tapped* (forward = down + forward
order; reversed = up + reversed order). Web-only / render-only; verified by a headless Playwright drive (strand
right-click opens the menu — does NOT delete; *Fan out forward* fanned an 8-bit bus, taps 0→8; Escape +
click-away dismiss; package body gives Rotate/Flip/Delete) and on-brand menu screenshots.

**Vertical-approach unzip + width badge** (the two deferred follow-ups). (1) **Vertical unzip:** the unzip used
to bail to the collapsed comb unless BOTH ends approached horizontally; now a vertical-approach bus (pins
stacked horizontally, the bundle running up↕down) unzips with the same symmetric belt-fan. `cableStrandRoutes`
takes an `axis` and solves vertical by TRANSPOSING (reflect across `y = x`) into the horizontal frame, running
the one belt-fan, then transposing back — a reflection preserves orthogonality + distances, so the
crossing-free property carries over unchanged (the geometry test now runs all widths in BOTH axes:
`cableGeometry.test.ts`, 78 cases). The board gate is now `src.axis === dst.axis` (a mixed-axis corner-turning
bus still uses the collapsed comb). Verified via `shoot --democable-mode vertical` (a new demo mode rotates
both packages 90° + stacks them) — both belt-fans symmetric, the bundle vertical, no crossings. (2) **Width
badge:** a collapsed/zoomed-out (or mixed-axis) bundle hides its strands, so it now stamps a small `×N`
trace-count pill (in the bus colour) at the trunk's arc-length midpoint — read the bus width at a glance
without unzipping. Pooled `cableBadgeTexts`, drawn only on the collapsed/packed bundle, only for a real
bundle (≥2). Both render-only / golden-safe.

**Collapsed = PACKED RIBBON belt-fan, not a comb + fat trunk** (owner: "the zoomed out cable looks much worse
than the zoomed in one — make it the same staggered approach, just with a much more packed ribbon cable in the
centre"). The collapsed/zoomed-out view used to drop to the orthogonal comb + one fat trunk (the "blocky"
look). Now a same-axis bus draws the **same staggered belt-fan at every zoom** — `cableStrandRoutes` gained a
`lanePack` factor that scales the lane gap (and, since the chevron stagger derives from it, the whole
convergence): `lanePack = 1` is the wide zoomed-in spread; collapsed uses `RIBBON_PACK = 0.4` for a tightly-
packed ribbon down the middle (strands drawn thinner to stay distinct), with the `×N` badge on it. A uniform
scale of the perpendicular offsets keeps the lanes monotonic in rank ⇒ still crossing-free (`cableGeometry.test
.ts` now also guards the packed factor across widths + both axes, 117 cases total). Only a **mixed-axis**
(corner-turning) bus still uses the comb + fat trunk. Verified live: `shoot --democable --zoom 1.45` (packed
straight), `--democable-mode bend --zoom 1.5` (packed ribbon nests through the Z-bend), `--democable-mode
vertical --zoom 1.5` (packed + transposed) — and the zoomed-in spread is unchanged.

**Mixed-axis CORNER (sharp 90° turn) + copy-paste keeps traces** (owner, from a hand-wired bus-corner
reference). (1) **Corner cable:** the mixed-axis case (one end horizontal, the other vertical — "the bus comes
up short on one side and needs a sharp 90° turn") no longer falls back to the comb. `cableGeometry.ts`
`cableCornerRoutes(srcW, dstW, srcAxis)` lays each bit as a single **staggered L** — leave the source pin
along its axis, turn ONCE at the destination pin's perpendicular coordinate, enter the dest pin along ITS axis
(the owner's manual pattern: top source ↔ far-side dest). The turns stagger by pin position, so a matched
pairing nests crossing-free at any width (`cableGeometry.test.ts` corner block; it does NOT reorder, so an
incompatible pairing genuinely crosses — also asserted). `board.ts` `drawCables` now has a mixed-axis branch
(`src.axis !== dst.axis`) using the shared `strokeStrands`; the comb is now only the single-conductor /
mismatched-count fallback. New `shoot --democable-mode corner` (source horizontal + destination rotated 90°,
dst pins reversed to match the corner). Verified live: 4 strands turn a clean staggered 90° onto the rotated
bank, no crossings — matching the owner's reference. (2) **Copy-paste keeps traces:** the clipboard carried
only wire ENDPOINTS, so a pasted hand-routed trace auto-rerouted (lost its bends). `ClipboardSnippet.wires`
now carries `waypoints`; `copySelection` captures them and `placePaste` (extracted from `commitPaste`)
re-bases + rotates them with the group — so a pasted trace keeps its shape. Verified by a headless drive
(`scripts/drive-copypaste.mjs` via `__cecDuplicateAll`): duplicating the L-turn fixture doubled the
wire-waypoint total (4→8) — the routes survived. Both render-only / golden-safe (gate green: 233 sim incl.
golden, 490 web).

**Corner pairing: AUTO-INVERT + a manual override** (owner: "it should auto-invert, but there should be a way
to do an intentional inversion"). Because a corner's crossing-free routing requires pairing **top-source ↔
far-dest** — the inverted pin numbering — the cable now picks that automatically AND lets the player flip it.
The pairing IS the order of `dst.pinIndices` (both the render and `deriveCableLinks` read it in order), so
reversing that one array flips the cable coherently. **Auto-invert at creation** (`board.ts`
`autoOrientCablePairing`, run in the cable-create gesture): for a mixed-approach (corner) bus, route the
name-aligned dst order AND its reverse, count crossings (`cableGeometry.ts` `strandCrossings`), and keep the
cleaner — so a corner comes out crossing-free without the player thinking about it; a same-axis bus keeps its
order. **Manual override**: a **"Reverse pairing"** row in the cable's right-click menu (`graph.reverseCablePairing`
→ reverse `dst.pinIndices`, re-derive) flips any cable's pairing (the intentional inversion), reversible.
`cableGeometry.test.ts` proves the picker prefers the crossing-free order (144 cases); verified live (the demo
now goes through `autoOrientCablePairing`: 0 crossings; the menu toggle flips 0→6→0). Render-only / golden-safe.

## The five remaining asks (owner, verbatim intent)

1. **Zoom-unzip → see the literal traces + what they carry.** Zoomed out: the bundled trunk. Zoomed in
   (past a scale threshold, e.g. reuse `TIER_ZOOM`, and `!cable.collapsed`): the **N literal strands**,
   each **coloured by its bit's signal** (`voltageColor` of the net at `src.pinIndices[i]`). The
   `Cable.collapsed` field already exists for the manual/LoD zip state.
2. **Pretty symmetric "belt-fan" convergence** (owner ref: a Factorio 4-belt merge — 4 resistors → 4 teal
   traces converging with clean **nested, staggered** right-angle bends → 4 dots; "looks super nice").
   Replace the comb that pinches all teeth to one point: each conductor turns toward the bus centreline at
   a **staggered offset** (outer conductors turn furthest out) so the perpendicular legs nest symmetrically,
   run parallel through the bundle, then diverge identically at the far end.
3. **Respect the lens.** A cable strand should look like the wire it stands for: **schematic** = thin
   coloured trace; **analogy** = pipe; **reality** = metal conductor. Reuse `drawConduitSkin(g, route,
   color, pw, lens)` exactly as `redrawWires` does, gated the same way (`conduit = effLens !== "schematic"
   && world.scale.x >= TIER_ZOOM`, already computed in `redrawWires` right where `drawCables(g)` is
   called — just thread it in). Collapsed trunk = one wide pipe; unzipped = each strand its own pipe.
4. **Manipulate like any trace (drag-reroute).** Grab a trunk segment and drag it perpendicular
   (KiCad-style), endpoints staying put — mirror `beginWireSegmentDrag`/the `wireDrag` machinery, but edit
   the cable's `route: Cell[]` (its long-haul waypoints) instead of a wire's `waypoints`. The drawn trunk
   inserts gather-elbows from the route, so the segment→route-waypoint mapping needs care (the drawn
   `cableTrunkRoutes[id]` polyline ≠ the stored `route`; map the grabbed drawn-segment back to the nearest
   route leg, like `wireLegIndexAt`).
5. **Junction off it / tap a bit.** Drop a junction on the trunk to branch the **whole bus** onward, and a
   **per-bit tap** to break ONE strand out of the bundle mid-run (Cable P3 fan-out-to-process). A bus
   junction is a new concept (a junction today joins single wires); a per-bit tap creates a normal wire
   from bit i's net at the tap point. Design the data model: likely a tap = a net-label/wire anchored at a
   point on the trunk on bit i's net (reusing `deriveCableLinks`' per-bit nets), NOT a new sim element.
   **Canonical owner reference: `docs/ui/bus-tap-reference.ceccircuit.json`** (2026-06-29) — the owner's
   MANUAL implementation of exactly this: a 4-bit bus (`A0..A3`, four `R`s ↔ four `R`s) with two taps off
   it — a **"junction up"** breaking the four bits out **forward** (A0→A3) and a **"sequential junction
   down"** breaking them out **reversed** (A3→A0), each via a per-bit junction on the bus wire + a matched
   net label. The native cable tap must reproduce this (forward AND reversed bit order), without the player
   hand-placing 16 wires + 8 labels + 8 junctions. (It currently uses plain wires + labels, NOT a `Cable`
   — it is the behavioural spec, not a cable fixture.)

## Implementation order (each shoot-verifiable; build a reusable cable fixture first)

**S0 — cable fixture + harness.** No cable is screenshot-able today (constructing one needs two
same-width name-indexed bus pin groups). Build a saved-circuit fixture (e.g. two `GATE`s, a width-2 cable
`src=g1.[1,2] dst=g2.[1,2]`, a source per bit) under `web/scripts/` or the examples, so `shoot --fixture
… --lens analogy --zoom <>` can SEE the cable. Reusable for every slice below + a `busCable.test.ts`.

**S1 — lens-respect (foundation).** Thread `conduit` into `drawCables`; render the trunk via
`drawConduitSkin` when `conduit`, else the plain stroke (a wider `pw` than a wire — it's a bundle). Verify
schematic vs analogy vs reality via shoot. (Smallest, lowest-risk; everything else layers on it.)

**S2 — belt-fan geometry.** Replace the comb with the staggered symmetric convergence (ask #2). Pure
`drawCables` geometry; verify the look against the owner ref.

**S3 — zoom-unzip + per-strand signal colour.** Below the unzip threshold: trunk. Above (and
`!collapsed`): N strands, each offset perpendicular along the trunk (write an ortho-offset helper, or
route each `src.pin[i]→dst.pin[i]` as a wire-like path), each `voltageColor(netVOf(src.pinIndices[i]))`,
each through the lens skin (S1). The belt-fan (S2) is the strands' end convergence. Verify zoomed in/out.

**S4 — drag-reroute** (ask #4): mirror the wire segment-drag onto the cable `route`. **S5 — junction /
per-bit tap** (ask #5): the new interactions + minimal data model. These are Cable P3 (#93) and the
heaviest; design the tap data model before coding.

## Risks / notes

- **The ortho perpendicular-offset of a bent trunk** (S3 parallel strands) is the fiddliest geometry —
  for a straight bus it's a trivial uniform offset; handle bends by offsetting per-segment and reconnecting
  at the shifted corner. Start with the straight-bus common case looking great. **DONE** (`offsetOrtho` in
  `board.ts`): per-segment left-normal offset, interior corners = intersection of the two adjacent offset
  lines (never singular for 90° turns), collinear/dup points dropped first. Signed by the trunk's leaving
  direction so the topmost source pin always takes the topmost lane. **Now handles vertical approach too**
  (`cableStrandRoutes(..., axis)`: a vertical-approach bus is solved by TRANSPOSING — reflecting across `y = x`
  — into the horizontal belt-fan, then transposing the routes back; a reflection preserves orthogonality +
  distances, so crossing-freeness carries over unchanged at any width, no duplicated geometry). The board
  unzips whenever BOTH ends share an approach axis (`src.axis === dst.axis`); a mixed-axis (corner-turning)
  bus still falls back to the collapsed comb.
- **Golden-safe throughout** — none of this crosses the wasm boundary or the snapshot hash.
- **Verify every slice with `shoot`** on the S0 fixture (the owner is art-directing — show, don't guess).

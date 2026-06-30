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
stays `JUNCTION_R`-based, so they're still easy to wire from). **Follow-up the owner can direct:** a bit
label on the tap node.

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
  direction so the topmost source pin always takes the topmost lane. **Still horizontal-approach only**
  (`src.axis === "h" && dst.axis === "h"`); a vertical-approach bus still falls back to the collapsed comb —
  a follow-up.
- **Golden-safe throughout** — none of this crosses the wasm boundary or the snapshot hash.
- **Verify every slice with `shoot`** on the S0 fixture (the owner is art-directing — show, don't guess).

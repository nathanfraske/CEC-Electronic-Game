// SPDX-License-Identifier: Apache-2.0
// Draw the LIVE inner circuit of a sealed USER IC — the "zoom-to-open" mini-board (the owner's
// "show a miniature version of your exact circuit inside, scaled properly"). Unlike a built-in
// composite (drawn as a generic grid by `internalsView.ts`), a user IC reveals the *authored*
// schematic: the real component glyphs at the positions the player drew them, plus the authored
// wires, shrunk to fit the chip footprint and animated from the SAME per-frame snapshot the board
// already reads — node voltages colour the wires by level and the flow clock pulses carriers along.
//
// Render-only, and rendered by the REAL board pipeline so a sealed IC's opened view is identical to
// the die editor. The trick is a SINGLE SCALED CONTAINER (`partLayer`): the inner circuit is drawn at
// FULL world scale (PITCH) — wires via the shared `routeForWire`/`conduitDrawRoute`/`nudgeParallel`/
// `applyCrossings`/`drawConduitSkin` pipeline that `board.ts`'s `redrawWires` runs, junctions via the
// shared `drawJunctionConduit`, parts via their real `drawGlyphIn` — and then the whole container is
// uniformly scaled + positioned onto the chip footprint. Every element (conduit width, junction hub,
// part glyph) keeps its natural board size, just shrunk together; there is no fragile per-element
// scale math, and it sets up the recursive zoom (Phase 1+). The package frame stays glyph-local in
// `g` (unscaled). No new simulation, no hashing — the seal is purely a drawing over the same netlist
// (ADR 0005 "seal-as-same-netlist").
import { Container, Graphics, Point } from "pixi.js";
import { PALETTE, PART_KINDS, isJunctionRef } from "./graph";
import { isUserIc } from "./userIc";
import {
  drawGlyphIn,
  drawUserIcPackageBody,
  userIcBodyBox,
  ZERO_ELECTRICAL,
  type ElectricalState,
  type GlyphStyle,
} from "./glyphs";
import {
  PITCH,
  cellToWorld,
  conduitDrawRoute,
  dirBit,
  drawConduitSkin,
  drawJunctionConduit,
  nudgeParallel,
  applyCrossings,
  wireDrawOrder,
  pinExit,
  polyline,
  roundedPoints,
  routeForWire,
  voltageColor,
  type BoardLens,
} from "./boardRender";
import { drawDetail, hasDetail } from "./detailDrawers";
import { drawAnalogy, hasAnalogy } from "./analogyDrawers";
import { setStudsVisible, type TierOpts } from "./tierKit";
import type { UserIcInternals } from "./netlist";

export interface UserIcInternalsOpts {
  internals: UserIcInternals;
  /** node voltages, indexed by node number (the sim snapshot's `state`). ABSENT when the board does
   * not solve — the view then draws the authored circuit STATICALLY (every level 0: rail-coloured
   * wires, no flow carriers, parts at rest), so a placed chip still opens to "the circuit as you
   * built it" unpowered. */
  nodeV?: Float64Array;
  /** footprint pin positions (glyph-local px), by external pin index — the FALLBACK anchor used only
   * when the internals carry no authored `pinCells` (the package boundary positions). */
  pins: { x: number; y: number }[];
  wPx: number;
  hPx: number;
  /** the IC's identity colour, for the package body rim. */
  color: number;
  /** the board's bounded flow clock, for animating carriers along the wires. */
  phase: number;
  /** the live-signal "hot" colour, skinned by lens (analogy water vs reality electron). */
  accent: number;
  /** the glyph style the inner parts draw in, so they FOLLOW the board lens (analogy → factory machines,
   * reality/schematic → schematic symbols) instead of being stuck in one style. */
  style: GlyphStyle;
  /** the board's detail lens (analogy water vs reality electron), threaded into the conduit skin so the
   * inner wires get the SAME pipe/conductor look the die editor draws under the active lens. */
  lens: BoardLens;
  /** The camera/world transform (board.ts `this.world.scale.x`, the `zoom` arg of `ComponentNode.update`).
   * The on-screen magnification of an inner part = the container fit-scale `s` × `cameraZoom`. Used to
   * gate the per-part tier-DETAIL swap (Part B / C-1): an inner part whose ABSOLUTE on-screen scale
   * `s · cameraZoom ≥ tierZoom` renders its `drawDetail`/`drawAnalogy` illustration (as the die editor
   * does past TIER_ZOOM) instead of the small schematic glyph. */
  cameraZoom: number;
  /** The board's TIER_ZOOM threshold — the world scale past which the die editor swaps a part to its
   * tier-detail illustration. The replica fires the same swap when `s · cameraZoom ≥ tierZoom`. */
  tierZoom: number;
  /** The board's INTERNALS_ZOOM threshold — the world scale past which a top-level sealed IC opens to
   * its inner circuit. The replica RECURSES into a nested sealed-IC inner part when that part's own
   * cumulative on-screen magnification (`cumulativeScale · s · cameraZoom`) crosses this same bar
   * (mirroring the top-level `zoom ≥ INTERNALS_ZOOM` test, per part, in absolute on-screen scale). */
  internalsZoom: number;
  /** The whole netlist map of inlined-instance → its inner circuit, keyed by FLATTENED hub id
   * (board.ts `this.userIcInternals`). Threaded so a nested sealed-IC inner part (carrying a
   * {@link UserIcInnerPart.flatId}) can look up ITS internals and recurse. Absent in the static
   * (unpowered) fallback — recursion then simply doesn't fire and a nested IC stays a labelled box. */
  allInternals?: Map<number, UserIcInternals>;
  /** Recursion depth (0 at the top opened IC). A hard guard against a pathological hierarchy or a
   * reseal cycle that slipped past flatten's MAX_DEPTH; capped at {@link RECURSE_MAX_DEPTH}. */
  depth?: number;
  /** The cumulative fit-scale of every ENCLOSING container (∏ of the parents' `s`), so a nested level
   * can compute its own absolute on-screen scale without walking the Pixi tree:
   * `childAbsScale = cumulativeScale · thisLevel.s`. Defaults to 1 at the top. */
  cumulativeScale?: number;
  /** The screen (renderer) rect in CSS px — `{ w: app.screen.width, h: app.screen.height }`. Enables the
   * A.4 VIEW cull: an inner part whose body, mapped to screen space, lies a full viewport beyond the edge
   * is skipped (no recurse, no detail/glyph draw, nested subtree freed) — so zooming deep into ONE nested
   * cell doesn't redraw every off-screen sibling's whole subtree each frame (the size-cull bounds depth,
   * this bounds breadth). Absent ⇒ no view cull (the static fallback / headless tests draw everything). */
  viewport?: { w: number; h: number };
  /** A per-frame probe the HUD zoom meter reads (Phase 5): the renderer records, at the DEEPEST opened
   * level whose package body (in screen space) contains the view-centre point `(cx, cy)`, that level's
   * cumulative fit-scale — so the meter knows "how deep am I" honestly, from the same transforms that
   * drew the view. Mutated in place (the board passes ONE object, threaded down every recursion level,
   * and reads `scale` after the frame). Absent ⇒ not metered (static fallback / headless tests). */
  viewProbe?: { cx: number; cy: number; depth: number; scale: number };
  /**
   * A persistent container (added under the instance's rotated glyph holder) that becomes the SCALED
   * inner-view: child[0] is a pooled {@link Graphics} for the wires + junctions (cleared every frame),
   * child[1..N] are one pooled {@link Graphics} per inner part. The view draws everything here at full
   * world scale, then sets this container's scale + position to shrink the whole circuit onto the
   * footprint — so conduit widths, junction hubs and part glyphs all keep their natural board size.
   * The caller owns it (visibility, teardown).
   */
  partLayer: Container;
}

/**
 * Draw the live authored inner circuit, scaled into the chip footprint. The package frame goes into
 * `g` (glyph-local, unscaled). Everything else — the wires/junctions (into a pooled `innerG`) and the
 * inner parts' glyphs — goes into `opts.partLayer` at full world scale; the container's own transform
 * does the shrink. Returns nothing.
 */
/** Hard recursion guard (Part A.4): the deepest the zoom-to-open replica will open a nested sealed IC.
 * Mirrors `flattenUserIcs`'s MAX_DEPTH so the two bounds agree. This DEPTH cap is the termination
 * GUARANTEE: a real IC's body is far smaller than the circuit it abstracts, so each level's fit-scale
 * `s` is well below 1 and the on-screen-size cull (`absScale ≥ internalsZoom`) usually halts recursion
 * far sooner — but `s = min(fitW/domW, fitH/domH)` is NOT clamped, so a contrived cell whose body is
 * larger than its inner bbox could have `s > 1`; the depth cap (with flatten's own MAX_DEPTH) bounds
 * that case regardless. The {@link UserIcInternalsOpts.viewport} cull bounds BREADTH the same way. */
const RECURSE_MAX_DEPTH = 24;

/** A.4 VIEW cull: is this inner-part holder near enough the screen to be worth drawing? The holder's
 * local origin maps to screen as exactly its world transform's `(tx, ty)` (a matrix applied to `(0,0)`),
 * and the local→screen scale magnitude is `absScale`, so the holder's screen footprint is a disc of
 * radius `radLocal · absScale` about `(tx, ty)`. We keep it when that disc reaches within ONE viewport
 * dimension of the screen rect — a deliberately generous margin so a one-frame-stale transform (the
 * cull reads last render's matrix) or a fast pan can never blink a real part out; the genuinely distant
 * siblings at deep zoom are many viewports away and still cull. A brand-new holder (identity transform →
 * origin (0,0), inside the rect) is kept, so a level never culls itself on its first frame. */
function holderNearViewport(
  child: Container,
  radLocal: number,
  absScale: number,
  vp: { w: number; h: number },
): boolean {
  const wt = child.worldTransform;
  const sx = wt.tx;
  const sy = wt.ty;
  const rad = radLocal * absScale;
  const m = Math.max(vp.w, vp.h); // one-viewport slack on every side
  return (
    sx + rad >= -m &&
    sx - rad <= vp.w + m &&
    sy + rad >= -m &&
    sy - rad <= vp.h + m
  );
}

/** The pooled sub-objects a single inner-part holder (a {@link Graphics} in `partLayer`) may own across
 * frames, indexed off the holder via {@link slotOf}. `dg` is the Part-B tier-detail Graphics; `frameG`
 * + `nestedLayer` are the Part-A nested-IC recursion subtree (the nested package frame + its scaled
 * inner partLayer). Kept in a WeakMap (not positional `children[i]`) so adding/removing one never
 * shifts the others' indices, and so the whole record is GC'd when the holder is destroyed (pool
 * shrink does `destroy({ children: true })`, which frees these children's GPU buffers). */
interface SlotRecord {
  dg?: Graphics;
  frameG?: Graphics;
  nestedLayer?: Container;
}
const slotRecords = new WeakMap<Graphics, SlotRecord>();
function slotOf(holder: Graphics): SlotRecord {
  let r = slotRecords.get(holder);
  if (!r) {
    r = {};
    slotRecords.set(holder, r);
  }
  return r;
}

export function drawUserIcInternals(g: Graphics, o: UserIcInternalsOpts): void {
  const {
    internals,
    nodeV,
    pins,
    wPx,
    hPx,
    color,
    phase,
    accent,
    style,
    lens,
    partLayer,
    cameraZoom,
    tierZoom,
    internalsZoom,
    allInternals,
    depth = 0,
    cumulativeScale = 1,
    viewport,
    viewProbe,
  } = o;
  const { parts, wires, innerGraph, nodeOfInner, frameId } = internals;
  // The schematic lens (C-2) draws plain orthogonal polyline traces + plain junction dots instead of
  // the conduit pipe/grommet skin — mirroring the die editor's non-conduit (`else`) branch in
  // `redrawWires`/`drawJunctions`. `conduitLens` is null in schematic so the shared route family still
  // runs but the final SKIN switches.
  const schematic = lens === "schematic";

  // Draw the PACKAGE first, glyph-local (NOT scaled): the leads out to the solder pins + the dark
  // body. The scaled inner circuit then fills the body interior, so it reads as the real chip opened
  // up (leads on the outside).
  drawUserIcPackageBody(g, pins, wPx, hPx, color);

  // Pool layout (C-5 — wires LAST so they paint OVER the part bodies, never under): child[0..N-1] =
  // the inner part glyphs/details, child[N] = innerG (all wires + junctions, cleared each frame), drawn
  // AFTER the parts. In Pixi later children render on top, so the inner traces now land cleanly on the
  // part pins instead of a large detail body occluding a wire elbow routing past it (matches a schematic
  // where nets sit over symbols; the conduit grommets already flare into the pin so the read stays
  // continuous). Grow/shrink the part pool when the netlist under the cursor changes.
  const wantChildren = parts.length + 1; // + innerG (the trailing slot)
  while (partLayer.children.length < wantChildren) {
    partLayer.addChild(new Graphics());
  }
  for (let i = partLayer.children.length - 1; i >= wantChildren; i--) {
    // `{ children: true }`: a part slot can now own a nested detail `dg` Graphics (Part B), so free the
    // whole subtree — a bare `.destroy()` would orphan the `dg`'s GPU buffers (leaks as the pool shrinks).
    partLayer.removeChildAt(i).destroy({ children: true });
  }
  const innerG = partLayer.children[wantChildren - 1] as Graphics; // the LAST slot
  innerG.clear();
  // The innerG holder carries no per-part transform — wires draw in raw container/world coords. A slot
  // pooled from a former PART (the trailing index shifts as parts.length changes) may carry a nested
  // detail `dg` child; drop any children so a stale illustration can't render under the wires.
  innerG.position.set(0, 0);
  innerG.scale.set(1, 1);
  innerG.rotation = 0;
  for (let i = innerG.children.length - 1; i >= 0; i--) {
    innerG.removeChildAt(i).destroy({ children: true });
  }
  // Drop any pooled slot record for the trailing holder now serving as innerG: its `dg`/`frameG`/
  // `nestedLayer` were just destroyed above, so a stale record would hand `slotOf` (if this holder is
  // reused as a PART when parts.length grows) references to dead Graphics. Clearing it forces a rebuild.
  slotRecords.delete(innerG);
  if (parts.length === 0 && wires.length === 0) {
    partLayer.visible = false;
    return;
  }
  partLayer.visible = true;

  // --- 0.6 THE FIT: shrink the inner circuit's FULL extent (the authored bbox, in world px) into the
  // package BODY rectangle with a SINGLE UNIFORM scale, centred on the body — so the inner circuit fills
  // the package the way the die circuit fills its frame in the editor. Fit to the actual body interior
  // (bodyB.w × bodyB.h), NOT a square `max(wPx,hPx)`: userIcBodyBox swaps the footprint's aspect (it
  // insets the lead/stick axis and outsets the array axis), so a square target mismatches the body and
  // the circuit ends up over-wide / narrow. Each side is floored at PITCH so a degenerate (sliver) body
  // can't collapse the scale. A small inset keeps the conduits off the body rim. The container transform
  // applies `s`; everything inside draws at world scale, so a part at cell (c,r) sits at (c·PITCH,
  // r·PITCH) and the container maps it to glyph-local (px + c·PITCH·s, py + r·PITCH·s). ---
  const domMinX = internals.bbox.minCol * PITCH;
  const domMaxX = internals.bbox.maxCol * PITCH;
  const domMinY = internals.bbox.minRow * PITCH;
  const domMaxY = internals.bbox.maxRow * PITCH;
  const domW = domMaxX - domMinX;
  const domH = domMaxY - domMinY;
  const bodyB = userIcBodyBox(pins, wPx, hPx);
  const centreX = bodyB.x + bodyB.w / 2;
  const centreY = bodyB.y + bodyB.h / 2;
  // Fit to the body rectangle (aspect-preserving), inset a hair for a rim margin; floor each side at
  // PITCH so a sliver body can't collapse `s`. Guard a degenerate/empty bbox (single cell, no parts):
  // fall back to centre + unit scale. The `|| PITCH` on the domain handles a single-axis-flat bbox.
  const INSET = 0.92;
  const fitW = Math.max(bodyB.w * INSET, PITCH);
  const fitH = Math.max(bodyB.h * INSET, PITCH);
  const degenerate = !(domW > 0) && !(domH > 0);
  const s = degenerate
    ? 1
    : Math.min(fitW / (domW || PITCH), fitH / (domH || PITCH));
  // Land the bbox centre on the body centre: px + (worldBboxCentre)·s = bodyCentre.
  const px = degenerate ? centreX : centreX - ((domMinX + domMaxX) / 2) * s;
  const py = degenerate ? centreY : centreY - ((domMinY + domMaxY) / 2) * s;
  partLayer.scale.set(s);
  partLayer.position.set(px, py);

  // --- ZOOM-METER probe (Phase 5): this level IS being drawn opened, so if its package body contains
  // the view centre and we're deeper than any level recorded so far, record THIS level's cumulative
  // fit-scale (`cumulativeScale · s`) — the meter reads it as "how deep am I." The body is glyph-local
  // (`bodyB`); `g`'s world transform maps it to screen, so we test the centre against the body's
  // screen-space AABB (one-frame-stale transform is fine for a readout). ---
  if (viewProbe && depth > viewProbe.depth) {
    const wt = g.worldTransform;
    const corners: [number, number][] = [
      [bodyB.x, bodyB.y],
      [bodyB.x + bodyB.w, bodyB.y],
      [bodyB.x + bodyB.w, bodyB.y + bodyB.h],
      [bodyB.x, bodyB.y + bodyB.h],
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [lx, ly] of corners) {
      const sxp = wt.a * lx + wt.c * ly + wt.tx;
      const syp = wt.b * lx + wt.d * ly + wt.ty;
      if (sxp < minX) minX = sxp;
      if (sxp > maxX) maxX = sxp;
      if (syp < minY) minY = syp;
      if (syp > maxY) maxY = syp;
    }
    if (
      viewProbe.cx >= minX &&
      viewProbe.cx <= maxX &&
      viewProbe.cy >= minY &&
      viewProbe.cy <= maxY
    ) {
      viewProbe.depth = depth;
      viewProbe.scale = cumulativeScale * s;
    }
  }

  // Net colour = the die editor's RAIL-IDENTITY code (`voltageColor`), so the opened IC reads with the
  // EXACT same hues the die-editor build does (GND dark, +5 red, +3.3 orange, −5 cyan, …) rather than a
  // separate gradient. A `null` net (an unresolved / floating inner run, and every run in the static
  // unpowered fallback) follows the board's `endpointColor`: cyan when live (the floating cue), or the
  // at-rest 0 V grey when the board isn't solving (`nodeV` absent → `voltageColor(0)`).
  const vAt = (n: number): number => {
    const v = nodeV ? (nodeV[n] ?? 0) : 0;
    return Number.isFinite(v) ? v : 0;
  };
  const netColor = (node: number | null): number =>
    node == null
      ? nodeV
        ? PALETTE.cyan
        : voltageColor(0)
      : voltageColor(vAt(node));

  // --- WIRES via the REAL board pipeline over `innerGraph`, into `innerG` at world scale (no point
  // scaling — the container does the shrink). This MIRRORS `redrawWires` step for step: route every
  // wire, build its conduit draw-route (logical route + pin-align stubs), record junction run-ends with
  // their entering axis, fan parallels apart, snap each junction hub onto the fanned lanes, resolve
  // crossings, then skin each as a conduit. So routed elbows, the die down-bend, fanned-bus junctions
  // and the pipe look all match the die editor by construction. ---
  const PW = 4; // core pipe width in WORLD px (the board's idle width; the container scale shrinks it)
  const condRoutes = new Map<number, Point[]>();
  const nets = new Map<number, number | null>();
  const colorOf = new Map<number, number>();
  // Junction run-ends (which junction each wire end ties to + that leg's axis, recorded pre-nudge), so
  // the follow-pass can shift each hub by the offset its runs picked up — exactly as `redrawWires` does.
  const jRecs: {
    wid: number;
    jid: number;
    from: boolean;
    vertical: boolean;
  }[] = [];
  for (const w of innerGraph.wires.values()) {
    const route = routeForWire(w, innerGraph, frameId);
    if (route.length < 2) continue;
    condRoutes.set(
      w.id,
      conduitDrawRoute(
        route,
        pinExit(w.from, innerGraph, frameId),
        pinExit(w.to, innerGraph, frameId),
      ),
    );
    if (isJunctionRef(w.from))
      jRecs.push({
        wid: w.id,
        jid: w.from.junctionId,
        from: true,
        vertical: (dirBit(route[0]!, route[1]!) & 5) !== 0,
      });
    if (isJunctionRef(w.to))
      jRecs.push({
        wid: w.id,
        jid: w.to.junctionId,
        from: false,
        vertical:
          (dirBit(route[route.length - 1]!, route[route.length - 2]!) & 5) !==
          0,
      });
    const node = nodeOfInner(w.from);
    nets.set(w.id, node);
    colorOf.set(w.id, netColor(node));
  }
  nudgeParallel(condRoutes);
  // Follow-pass: each junction's shift = the perpendicular offset its runs picked up in nudgeParallel,
  // averaged per axis; snap the hub AND every connected run-end onto it so fanned pipes stay joined.
  const junctionPos = new Map<number, Point>();
  const jAcc = new Map<
    number,
    { dx: number; dy: number; nx: number; ny: number }
  >();
  for (const rec of jRecs) {
    const pts = condRoutes.get(rec.wid);
    if (!pts || pts.length < 2) continue;
    const ei = rec.from ? 0 : pts.length - 1;
    const J = pts[ei]!;
    const nb = pts[rec.from ? 1 : pts.length - 2]!;
    const acc = jAcc.get(rec.jid) ?? { dx: 0, dy: 0, nx: 0, ny: 0 };
    if (rec.vertical) {
      acc.dx += nb.x - J.x;
      acc.nx++;
    } else {
      acc.dy += nb.y - J.y;
      acc.ny++;
    }
    jAcc.set(rec.jid, acc);
  }
  for (const [jid, acc] of jAcc) {
    const j = innerGraph.junctions.get(jid);
    if (!j) continue;
    const base = cellToWorld(j.cell);
    junctionPos.set(
      jid,
      new Point(
        base.x + (acc.nx ? acc.dx / acc.nx : 0),
        base.y + (acc.ny ? acc.dy / acc.ny : 0),
      ),
    );
  }
  for (const rec of jRecs) {
    const jp = junctionPos.get(rec.jid);
    const pts = condRoutes.get(rec.wid);
    if (!jp || !pts || pts.length < 2) continue;
    pts[rec.from ? 0 : pts.length - 1] = new Point(jp.x, jp.y);
  }
  // Same-net crossings → a tie dot; different-net crossings → a bridge hop baked into the route.
  const cross = applyCrossings(
    condRoutes,
    nets,
    (id) => colorOf.get(id) ?? PALETTE.cyan,
  );
  // Draw a hopping wire AFTER the wire it hops, so every bridge reads as going OVER (same as the board).
  const wireOrder = wireDrawOrder(
    [...innerGraph.wires.keys()],
    cross.overpasses,
  );
  for (const id of wireOrder) {
    const rd = condRoutes.get(id);
    if (!rd) continue;
    const rounded = roundedPoints(rd, PW * 2);
    const c = colorOf.get(id) ?? PALETTE.cyan;
    if (schematic) {
      // C-2: plain double-stroke polyline (faint halo + bright core), mirroring redrawWires' non-conduit
      // `else` branch (board.ts ~4782). The route family above already orthogonalised + crossed it.
      polyline(innerG, rounded);
      innerG.stroke({ width: PW + 4, color: c, alpha: 0.16 });
      polyline(innerG, rounded);
      innerG.stroke({ width: PW, color: c, alpha: 0.95 });
    } else {
      drawConduitSkin(innerG, rounded, c, PW, lens);
    }
  }
  for (const d of cross.dots) {
    innerG.circle(d.x, d.y, 4.5).fill({ color: 0x0d0b16, alpha: 0.9 });
    innerG.circle(d.x, d.y, 3).fill({ color: d.color });
  }

  // --- JUNCTIONS via the shared conduit hub, at world scale (the nudged hub position when its runs
  // were fanned into lanes, else the plain cell — matching `drawJunctions`). The hub is world-sized and
  // the container shrinks it, so its proportions match the pipes by construction (no per-element guess). ---
  for (const j of innerGraph.junctions.values()) {
    const node = nodeOfInner({ junctionId: j.id });
    const p = junctionPos.get(j.id) ?? cellToWorld(j.cell);
    if (schematic) {
      // C-2: plain filled junction dot (dark backing + net-coloured core), mirroring drawJunctions'
      // non-conduit branch (board.ts ~4558). JUNCTION_R is 4 on the board (board-local const).
      const JR = 4;
      innerG.circle(p.x, p.y, JR + 1.5).fill({ color: 0x0d0b16, alpha: 1 });
      innerG.circle(p.x, p.y, JR).fill({ color: netColor(node) });
    } else {
      drawJunctionConduit(innerG, p, netColor(node), lens);
    }
  }

  // --- LEAD CONNECTORS: tie each inner frame-pin net OUT to its package lead. A short conduit (in the
  // SCALED container `innerG`, so it's the SAME width as the inner pipes) from the frame pin's world cell
  // to the package lead ROOT on the body edge — the lead root lives in glyph space, so it's mapped back
  // into container/world coords ((root − pos)/s). The inner net then reads as one continuous run from the
  // part, through the frame pin, out to the solder lead the package carries on to its tip. ---
  const bcx = bodyB.x + bodyB.w / 2;
  const bcy = bodyB.y + bodyB.h / 2;
  for (let i = 0; i < internals.pinCells.length; i++) {
    const pc = internals.pinCells[i];
    const pp = pins[i];
    if (!pc || !pp || degenerate) continue;
    const fpW = new Point(pc.col * PITCH, pc.row * PITCH); // frame pin in world (container) coords
    const rootG = bodyB.alongX
      ? { x: pp.x, y: pp.y < bcy ? bodyB.y : bodyB.y + bodyB.h }
      : { x: pp.x < bcx ? bodyB.x : bodyB.x + bodyB.w, y: pp.y };
    const rootW = new Point((rootG.x - px) / s, (rootG.y - py) / s);
    // Orthogonal STAPLE, not a raw diagonal: exit BOTH ends along the lead axis (alongX leads are
    // vertical, else horizontal), joined by one cross leg, then rounded — so the connector reads as a
    // clean bent run from the frame pin out to the lead, never a diagonal (owner).
    const leadPts = bodyB.alongX
      ? [
          fpW,
          new Point(fpW.x, (fpW.y + rootW.y) / 2),
          new Point(rootW.x, (fpW.y + rootW.y) / 2),
          rootW,
        ]
      : [
          fpW,
          new Point((fpW.x + rootW.x) / 2, fpW.y),
          new Point((fpW.x + rootW.x) / 2, rootW.y),
          rootW,
        ];
    const leadColor = netColor(internals.pinNodes[i] ?? null);
    const leadRounded = roundedPoints(leadPts, PW * 2);
    if (schematic) {
      polyline(innerG, leadRounded);
      innerG.stroke({ width: PW + 4, color: leadColor, alpha: 0.16 });
      polyline(innerG, leadRounded);
      innerG.stroke({ width: PW, color: leadColor, alpha: 0.95 });
    } else {
      drawConduitSkin(innerG, leadRounded, leadColor, PW, lens);
    }
  }

  // TODO(phase-0-followup): per-net voltage gauges/standpipes (drawNetBars/drawNetStandpipes) and the
  // carrier flow-dots (beltDots/sampleRouteAt) — additive, need a per-inner-wire current the struct
  // doesn't carry yet.

  // --- INNER PARTS: each draws its REAL glyph into its pooled child Graphics at WORLD scale (the
  // container does the shrink). Positioned at the part's authored anchor cell × PITCH, pins at the
  // part's rotated cell offsets × PITCH — drawGlyphIn routes the symbol between them, exactly as the
  // die editor draws the part. ---
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]!;
    const child = partLayer.children[k] as Graphics; // child[0..N-1] are parts; innerG is the LAST slot
    child.clear();
    const kind = PART_KINDS[part.kind];
    if (!kind) {
      child.visible = false;
      continue;
    }
    child.visible = true;
    // Orient the child EXACTLY as the die editor's glyph holder does (board.ts `ComponentNode.reposition`):
    // CANONICAL (unrotated) pins drawn into a holder that carries the part's rotation + mirror — NOT
    // pre-rotated pins. A drawer that infers orientation from pin positions (the MOSFET valve, diodes,
    // polarised sources) renders a rotated/mirrored part WRONG when handed already-rotated pins; rotating
    // the container instead keeps every part identical to the editor. The parent `partLayer` then uniformly
    // scales the whole thing. (scale.x = −1 is the horizontal flip, matching the holder's `scale.x`.)
    child.position.set(part.cell.col * PITCH, part.cell.row * PITCH);
    child.scale.set(part.mirror ? -1 : 1, 1);
    child.rotation = (part.rot * Math.PI) / 2;
    const glyphPins = kind.pins.map((pin) => ({
      x: pin.dx * PITCH,
      y: pin.dy * PITCH,
    }));
    // A live electrical readout for the glyph: voltage across the part's first two terminals, sign
    // from their level difference. (Current isn't attributed per inner part here — the glyph reads
    // vAcross for its field/charge animation.) Cheap + honest.
    const na = part.nodes[0];
    const nb = part.nodes[1];
    let electrical: ElectricalState = ZERO_ELECTRICAL;
    if (na !== undefined && nb !== undefined) {
      electrical = { current: 0, vAcross: vAt(na) - vAt(nb) };
    }
    const partColor = PALETTE[kind.colorKey];

    // Per-slot sub-objects (pooled across frames on this holder): `dg` = the tier-DETAIL Graphics
    // (Part B); `frameG` + `nestedLayer` = the nested-IC RECURSION subtree (a package-frame Graphics +
    // a scaled inner partLayer Container, Part A). All three states (small glyph / detail / nested
    // replica) are mutually exclusive per frame — the unused ones are hidden so nothing stale shows
    // through, and destroyed when a part stops recursing (below) so a pool reuse can't leak or mis-render.
    const slot = slotOf(child);
    const absScale = s * cumulativeScale * cameraZoom; // on-screen px per world px at this depth

    // --- A.4 VIEW cull: skip a part whose body lies a full viewport beyond the screen edge — no recurse,
    // no detail/glyph draw, and free any nested subtree so memory tracks what's visible. The size-cull
    // (below) bounds recursion DEPTH; this bounds BREADTH, so zooming deep into ONE nested cell doesn't
    // rebuild every off-screen sibling's whole subtree every frame. radLocal = the part footprint's
    // diagonal (+PITCH overhang) from the holder origin, a conservative bound for any rotation. Only when
    // a viewport was supplied (the static fallback / headless tests pass none and draw everything). ---
    if (viewport) {
      const radLocal =
        Math.hypot((kind.w - 1) * PITCH, (kind.h - 1) * PITCH) + PITCH;
      if (!holderNearViewport(child, radLocal, absScale, viewport)) {
        if (slot.frameG || slot.nestedLayer) {
          slot.frameG?.destroy({ children: true });
          slot.nestedLayer?.destroy({ children: true });
          slot.frameG = undefined;
          slot.nestedLayer = undefined;
        }
        child.visible = false; // hides the holder + any pooled detail `dg`, so nothing stale draws
        continue;
      }
    }

    // --- A.3 RECURSE: when this inner part is ITSELF a sealed user IC whose internals resolve in the
    // map, AND its absolute on-screen footprint has grown past the SAME open bar the top level uses
    // (`cumulativeScale · s · cameraZoom ≥ internalsZoom`), AND we are within the depth guard, draw its
    // OWN inner circuit into a nested replica — a chip-within-a-chip. Otherwise fall through to the
    // detail/glyph base case (and tear down any nested subtree so it stops drawing + frees its GPU
    // objects — the auto-cull that keeps infinite zoom cheap). ---
    const nested =
      isUserIc(part.kind) && part.flatId !== undefined
        ? allInternals?.get(part.flatId)
        : undefined;
    const wantRecurse =
      nested !== undefined &&
      depth < RECURSE_MAX_DEPTH &&
      absScale >= internalsZoom;
    if (wantRecurse && nested) {
      // Hide the base-case visuals on this holder (and clear the glyph drawn into `child` above).
      if (slot.dg) slot.dg.visible = false;
      // Build/reuse the nested subtree: a frame Graphics (the nested package, glyph-local, UNSCALED)
      // and a partLayer Container (the nested inner circuit, scaled by the nested level's own `s`).
      if (!slot.frameG) {
        slot.frameG = new Graphics();
        child.addChild(slot.frameG);
      }
      if (!slot.nestedLayer) {
        slot.nestedLayer = new Container();
        child.addChild(slot.nestedLayer);
      }
      slot.frameG.visible = true;
      slot.frameG.clear();
      slot.nestedLayer.visible = true;
      // The nested package's glyph-local geometry: its pins (kind.pins · PITCH) + footprint px. The
      // nested call draws its frame into `frameG` glyph-local and fills its body with the next level
      // down — both inside this holder, which already carries the part's position/rotation/mirror.
      const nestedPins = kind.pins.map((pin) => ({
        x: pin.dx * PITCH,
        y: pin.dy * PITCH,
      }));
      drawUserIcInternals(slot.frameG, {
        internals: nested,
        nodeV, // SAME snapshot — live at every depth (A.5; each level's own nodeOfInner resolves it)
        pins: nestedPins,
        wPx: (kind.w - 1) * PITCH,
        hPx: (kind.h - 1) * PITCH,
        color: PALETTE.accent, // a sealed user IC is accent-tinted
        phase,
        accent,
        style,
        lens,
        partLayer: slot.nestedLayer,
        cameraZoom,
        tierZoom,
        internalsZoom,
        allInternals,
        depth: depth + 1,
        cumulativeScale: s * cumulativeScale, // accumulate THIS level's fit-scale for the child
        viewport, // nested levels cull off-screen sub-cells against the same screen rect
        viewProbe, // SAME probe object — a deeper level under the view centre wins the meter
      });
      continue;
    }
    // Not recursing this frame: tear down any nested subtree (a part that zoomed back out / scrolled
    // away / flipped kind) so it stops drawing and frees its GPU buffers — `destroy({ children: true })`
    // (the base case's leak lesson) frees the whole nested replica, not just the frame Graphics.
    if (slot.frameG || slot.nestedLayer) {
      slot.frameG?.destroy({ children: true });
      slot.nestedLayer?.destroy({ children: true });
      slot.frameG = undefined;
      slot.nestedLayer = undefined;
    }

    // C-1 (Part B) — TIER-DETAIL gate. The die editor swaps a part to its full tier illustration
    // (`drawDetail`/`drawAnalogy`) once the WORLD scale passes TIER_ZOOM (board.ts:6634). Inside the
    // opened IC a part's effective magnification is the cumulative fit-scale × cameraZoom, so the
    // faithful translation is `s · cumulativeScale · cameraZoom ≥ tierZoom`. The tier follows the lens
    // (the replica already receives it); schematic never has a detail (hasDetail/hasAnalogy false).
    const partTier =
      lens === "reality" && hasDetail(part.kind)
        ? "reality"
        : lens === "analogy" && hasAnalogy(part.kind)
          ? "analogy"
          : null;
    // The detail is drawn into a NESTED Graphics `dg` inside the rot+mirror holder `child`, so it
    // inherits the part's orientation while carrying its OWN REF→footprint scale (mirroring board.ts'
    // separate tierGlyph at `wPx/2, hPx/2`). The small glyph and the detail are mutually exclusive per
    // frame (one is cleared/hidden while the other draws).
    let dg = slot.dg;
    if (partTier !== null && absScale >= tierZoom) {
      // REF-then-scale, EXACTLY board.ts:6642-6673 — render big so the drawers' fixed-px details
      // (studs, throats, spring/piston clamps like `anchorX − 40`) don't distort at the tiny footprint.
      if (!dg) {
        dg = new Graphics();
        child.addChild(dg);
        slot.dg = dg;
      }
      dg.clear();
      dg.visible = true;
      const REF_HW = 130;
      const REF_HH = 80;
      const partWPx = (kind.w - 1) * PITCH;
      const partHPx = (kind.h - 1) * PITCH;
      const targetHW = partWPx / 2 + PITCH * 0.7; // same target the board uses (this.wPx/2 + PITCH·0.7)
      const detScale = targetHW / REF_HW;
      // CANONICAL anchors (from UNROTATED kind.pins): the holder carries rot+mirror, so a drawer that
      // infers orientation from pin positions (MOSFET valve, polarised sources) stays correct — never
      // pre-rotate these (the same lesson as the glyph base case + the part-orientation fix). Centred on
      // the footprint, so a glyph-local pin (p − footprint-centre) is (that / detScale) in REF px.
      const anchors = glyphPins.map((p, i) => ({
        label: kind.pins[i]?.label ?? "",
        x: (p.x - partWPx / 2) / detScale,
        y: (p.y - partHPx / 2) / detScale,
      }));
      const opts: TierOpts = {
        kind: part.kind,
        bounds: { hw: REF_HW, hh: REF_HH },
        color: partColor,
        electrical, // the SAME { current: 0, vAcross } the glyph base case built (C-4 will feed current)
        phase,
        value: part.value,
        anchors,
      };
      // Hide the illustration's decorative studs (board.ts:6669) — the inner wires' grommets mark the
      // real connections; avoids the doubled-terminal clutter.
      setStudsVisible(false);
      if (partTier === "reality") drawDetail(dg, opts);
      else drawAnalogy(dg, opts);
      setStudsVisible(true);
      // Centre the detail on the footprint (board.ts positions tierGlyph at `wPx/2, hPx/2`) and apply
      // the REF→footprint scale. The holder `child` already carries position/rotation/mirror.
      dg.position.set(partWPx / 2, partHPx / 2);
      dg.scale.set(detScale);
    } else {
      // Base case: the small schematic/factory glyph drawn straight into the holder, as before. Hide
      // any pooled detail Graphics so a part that zoomed back out doesn't leave a stale illustration.
      if (dg) dg.visible = false;
      // drawGlyphIn with the explicit lens-derived style, so the inner parts switch schematic ↔ factory
      // with the board toggler (drawGlyph would lock them to the global style and ignore the lens).
      drawGlyphIn(
        child,
        {
          kind: part.kind,
          pins: glyphPins,
          wPx: (kind.w - 1) * PITCH,
          hPx: (kind.h - 1) * PITCH,
          color: partColor,
          electrical,
          phase,
          value: part.value,
        },
        style,
      );
    }
  }
}

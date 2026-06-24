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
  pinOutward,
  roundedPoints,
  routeForWire,
  voltageColor,
  type BoardLens,
} from "./boardRender";
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
export function drawUserIcInternals(g: Graphics, o: UserIcInternalsOpts): void {
  const {
    internals,
    nodeV,
    pins,
    wPx,
    hPx,
    color,
    phase,
    style,
    lens,
    partLayer,
  } = o;
  const { parts, wires, innerGraph, nodeOfInner, frameId } = internals;

  // Draw the PACKAGE first, glyph-local (NOT scaled): the leads out to the solder pins + the dark
  // body. The scaled inner circuit then fills the body interior, so it reads as the real chip opened
  // up (leads on the outside).
  drawUserIcPackageBody(g, pins, wPx, hPx, color);

  // Pool layout: child[0] = innerG (wires + junctions, cleared each frame), child[1..N] = the inner
  // part glyphs. Grow/shrink the part pool when the netlist under the cursor changes.
  if (partLayer.children.length === 0) partLayer.addChild(new Graphics()); // innerG slot
  const innerG = partLayer.children[0] as Graphics;
  innerG.clear();
  const wantChildren = parts.length + 1; // + innerG
  while (partLayer.children.length < wantChildren) {
    partLayer.addChild(new Graphics());
  }
  for (let i = partLayer.children.length - 1; i >= wantChildren; i--) {
    partLayer.removeChildAt(i).destroy();
  }
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
        pinOutward(w.from, innerGraph),
        pinOutward(w.to, innerGraph),
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
    drawConduitSkin(innerG, rounded, colorOf.get(id) ?? PALETTE.cyan, PW, lens);
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
    drawJunctionConduit(innerG, p, netColor(node));
  }

  // TODO(phase-0-followup): the per-net voltage gauges/standpipes (drawNetBars/drawNetStandpipes),
  // the carrier flow-dots (beltDots/sampleRouteAt off an inner-current feed), and the explicit
  // lead-connectors from each frame pad out to its package pin. Conduits + junctions + parts + scale
  // land first; these are additive and need a per-inner-wire current the struct doesn't carry yet.

  // --- INNER PARTS: each draws its REAL glyph into its pooled child Graphics at WORLD scale (the
  // container does the shrink). Positioned at the part's authored anchor cell × PITCH, pins at the
  // part's rotated cell offsets × PITCH — drawGlyphIn routes the symbol between them, exactly as the
  // die editor draws the part. ---
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]!;
    const child = partLayer.children[k + 1] as Graphics; // +1: child[0] is innerG
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

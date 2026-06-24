// SPDX-License-Identifier: Apache-2.0
// Shared, `this`-free board render engine. These are the pure geometry / carrier /
// conduit-drawing functions that the PixiJS board renderer (`board.ts`) uses to turn a
// graph into routed, skinned conduits — extracted here so a sealed IC's opened view
// (`userIcInternalsView.ts`) can later run the SAME wire pipeline over its reconstructed
// inner graph. Nothing here touches a `Board` instance: every function takes only its
// parameters plus the module-level consts below. Render-only; nothing here is hashed.
//
// IMPORTANT: this module must NOT import `board.ts` (it imports from here) — keep it to
// pixi + `./graph` (+ the part-drawer modules, when those land in later steps).

import { Graphics, Point } from "pixi.js";
import {
  PART_KINDS,
  rotateOffset,
  isJunctionRef,
  isPinRef,
  type BoardGraph,
  type Cell,
  type Endpoint,
  type Wire,
} from "./graph";

/** Grid pitch in pixels — the cell size everything snaps to. */
export const PITCH = 26;

// Conduit skin palette (shared by `drawConduitSkin` / `drawJunctionConduit`). The
// die-editor wires re-skin at TIER_ZOOM into either an ANALOGY pipe (steel wall, dark
// bore, voltage-tinted water) or a REALITY metal conductor (bright sheath, glowing core).
export const PIPE_WALL = 0x6b6488; // steel pipe wall
export const PIPE_WATER = 0x8fd6ff; // bright water carriers
export const COND_CASING = 0xc8915a; // copper conductor sheath (reads as real wire)
export const COND_ELEC = 0x9fe6ff; // electron carriers (drift against the current)

// reverses each half-cycle; at high tps a frame can otherwise span many cycles and
// the eased reversal would still read as a hard jump. Clamping the per-frame pixel
// delta keeps the reversal a smooth back-and-forth slosh at any ticks-per-second
// without affecting the steady DC stream (whose per-frame delta stays well under).
export const MAX_FLOW_PX_PER_FRAME = 14;
// Safety cap on dots per belt so a very long trace can't spawn unbounded graphics.
export const MAX_BELT_DOTS = 64;

const NUDGE_SPACING = 13; // px between conduits sharing a channel (clears the pipe body + dark moat)
const BUMP_W = 11; // hop half-width (wider arc to fit the opaque pipe + moat)
const BUMP_H = 17; // hop height (taller so the over-pipe clears the under-pipe's full width + moat)

/** The lens (fidelity tier) a part / wire renders in. Mirrors the info panel's `DiagramMode`;
 *  re-exported by `board.ts` so existing importers keep working. */
export type BoardLens = "schematic" | "analogy" | "reality";

/** Position + unit direction at a point along a trace (for belt-dot / carrier placement). */
export interface RouteSample {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export type Dir = { x: number; y: number };

interface ConduitSeg {
  i: number;
  axis: "H" | "V";
  fixed: number;
  lo: number;
  hi: number;
}

export function saturate(x: number): number {
  return x / (1 + x);
}

export function polyline(g: Graphics, pts: Point[]): void {
  if (pts.length < 2) return;
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
}

/**
 * A rounded version of `pts` as a tessellated polyline: each interior vertex becomes a
 * quadratic-arc elbow (tangent to both legs, pulled back by up to `r`, capped at half
 * the shorter leg), sampled into `steps` segments. Returning points (not drawing) lets
 * the conduit be BOTH stroked and walked by the carriers along the exact same path, so
 * the particles follow the rounded pipe through its bends.
 */
export function roundedPoints(pts: Point[], r: number, steps = 6): Point[] {
  if (pts.length < 3 || r <= 0.5) return pts.slice();
  const out: Point[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]!;
    const v = pts[i]!;
    const n = pts[i + 1]!;
    const d1 = Math.hypot(v.x - p.x, v.y - p.y) || 1;
    const d2 = Math.hypot(n.x - v.x, n.y - v.y) || 1;
    const r1 = Math.min(r, d1 / 2);
    const r2 = Math.min(r, d2 / 2);
    const ax = v.x + ((p.x - v.x) / d1) * r1;
    const ay = v.y + ((p.y - v.y) / d1) * r1;
    const bx = v.x + ((n.x - v.x) / d2) * r2;
    const by = v.y + ((n.y - v.y) / d2) * r2;
    out.push(new Point(ax, ay));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push(
        new Point(
          u * u * ax + 2 * u * t * v.x + t * t * bx,
          u * u * ay + 2 * u * t * v.y + t * t * by,
        ),
      );
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Cardinal-direction bit (N=1,E=2,S=4,W=8) of the step from `a` toward `b`. */
export function dirBit(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 2 : 8;
  return dy >= 0 ? 4 : 1;
}

/**
 * Fan apart conduits that run along the SAME grid line (overlapping collinear segments)
 * so parallel pipes don't stack into one muddy band. Operates on the orthogonal draw
 * routes (before rounding), perpendicular-offsetting each overlapping INTERIOR segment
 * into its own lane. Because an orthogonal route alternates H/V, moving a segment's two
 * corner points along the perpendicular axis just lengthens the adjacent (perpendicular)
 * legs — the route stays orthogonal and the pin terminals stay put. Render-only:
 * `routes` holds per-wire Point copies, never the graph.
 */
export function nudgeParallel(routes: Map<number, Point[]>): void {
  type Seg = { id: number; iA: number; iB: number; lo: number; hi: number };
  const hGroups = new Map<number, Seg[]>();
  const vGroups = new Map<number, Seg[]>();
  const push = (m: Map<number, Seg[]>, key: number, s: Seg): void => {
    const arr = m.get(key);
    if (arr) arr.push(s);
    else m.set(key, [s]);
  };
  for (const [id, pts] of routes) {
    for (let i = 0; i + 1 < pts.length; i++) {
      // Skip the two end legs so the pin terminals never move.
      if (i === 0 || i + 1 === pts.length - 1) continue;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 2) {
        push(hGroups, Math.round(a.y / 4) * 4, {
          id,
          iA: i,
          iB: i + 1,
          lo: Math.min(a.x, b.x),
          hi: Math.max(a.x, b.x),
        });
      } else if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 2) {
        push(vGroups, Math.round(a.x / 4) * 4, {
          id,
          iA: i,
          iB: i + 1,
          lo: Math.min(a.y, b.y),
          hi: Math.max(a.y, b.y),
        });
      }
    }
  }
  const apply = (groups: Map<number, Seg[]>, axis: "x" | "y"): void => {
    for (const segs of groups.values()) {
      if (segs.length < 2) continue;
      segs.sort((p, q) => p.lo - q.lo);
      let cluster: Seg[] = [];
      let hi = -Infinity;
      const flush = (): void => {
        const ids = [...new Set(cluster.map((s) => s.id))].sort(
          (p, q) => p - q,
        );
        if (cluster.length >= 2 && ids.length >= 2) {
          const lane = new Map(
            ids.map((id, k) => [
              id,
              (k - (ids.length - 1) / 2) * NUDGE_SPACING,
            ]),
          );
          for (const s of cluster) {
            const off = lane.get(s.id) ?? 0;
            const pts = routes.get(s.id)!;
            pts[s.iA]![axis] += off;
            pts[s.iB]![axis] += off;
          }
        }
        cluster = [];
      };
      for (const s of segs) {
        if (cluster.length && s.lo > hi + 2) flush();
        cluster.push(s);
        hi = Math.max(hi, s.hi);
      }
      flush();
    }
  };
  apply(hGroups, "y");
  apply(vGroups, "x");
}

export function conduitSegs(pts: Point[]): ConduitSeg[] {
  const out: ConduitSeg[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 2)
      out.push({
        i,
        axis: "H",
        fixed: a.y,
        lo: Math.min(a.x, b.x),
        hi: Math.max(a.x, b.x),
      });
    else if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 2)
      out.push({
        i,
        axis: "V",
        fixed: a.x,
        lo: Math.min(a.y, b.y),
        hi: Math.max(a.y, b.y),
      });
  }
  return out;
}

/**
 * Resolve conduit crossings (a perpendicular intersection of two DIFFERENT wires' draw
 * routes): a SAME-net crossing becomes a junction dot (returned); a DIFFERENT-net
 * crossing gets a "bridge" — the horizontal wire hops over the vertical one, a small
 * up-bump inserted into its route (so the pipe and its carriers ride over, not through).
 * Mutates `routes` with the bumps; the crossing must be interior to both segments (a
 * shared endpoint already connects, so it is skipped).
 */
export function applyCrossings(
  routes: Map<number, Point[]>,
  nets: Map<number, number | null>,
  colorOf: (id: number) => number,
): { x: number; y: number; color: number }[] {
  const ids = [...routes.keys()];
  const cache = new Map(ids.map((id) => [id, conduitSegs(routes.get(id)!)]));
  const dots: { x: number; y: number; color: number }[] = [];
  const bumps = new Map<number, Map<number, number[]>>(); // wireId → segIdx → x list
  const addBump = (id: number, seg: number, x: number): void => {
    let m = bumps.get(id);
    if (!m) bumps.set(id, (m = new Map()));
    const arr = m.get(seg);
    if (arr) arr.push(x);
    else m.set(seg, [x]);
  };
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const A = ids[i]!;
      const B = ids[j]!;
      const na = nets.get(A);
      const sameNet = na != null && na === nets.get(B);
      for (const sa of cache.get(A)!) {
        for (const sb of cache.get(B)!) {
          if (sa.axis === sb.axis) continue;
          const h = sa.axis === "H" ? sa : sb;
          const vv = sa.axis === "H" ? sb : sa;
          if (
            vv.fixed > h.lo + BUMP_W &&
            vv.fixed < h.hi - BUMP_W &&
            h.fixed > vv.lo + 4 &&
            h.fixed < vv.hi - 4
          ) {
            // A SAME-net crossing ties the nets → a junction dot. A DIFFERENT-net crossing gets a
            // BRIDGE: the horizontal pipe hops over the vertical one. The interior margin is now BUMP_W
            // (was 3), so the whole hop fits INSIDE the segment — near a junction it no longer distorts
            // past the end (the abrupt pop the owner saw); the bump is also taller now (BUMP_H) to clear
            // the wider opaque pipe + its dark moat.
            if (sameNet) {
              dots.push({ x: vv.fixed, y: h.fixed, color: colorOf(A) });
            } else {
              addBump(sa.axis === "H" ? A : B, h.i, vv.fixed);
            }
          }
        }
      }
    }
  }
  for (const [id, segMap] of bumps) {
    const pts = routes.get(id)!;
    const out: Point[] = [pts[0]!];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const xs = segMap.get(i);
      if (xs && xs.length) {
        const dir = Math.sign(b.x - a.x) || 1;
        const hy = a.y;
        const inter: Point[] = [];
        for (const bx of xs) {
          inter.push(new Point(bx - BUMP_W, hy));
          inter.push(new Point(bx, hy - BUMP_H));
          inter.push(new Point(bx + BUMP_W, hy));
        }
        inter.sort((p, q) => dir * (p.x - q.x));
        for (const p of inter) out.push(p);
      }
      out.push(b);
    }
    routes.set(id, out);
  }
  return dots;
}

/** The short aligning stub from a pin: when the route leaves the pin perpendicular to
 *  the pin's facing `out`, return a point a little way along `out` (so the conduit
 *  exits straight, then bends). Null when it already leaves aligned (or opposite, which
 *  would hairpin). */
export function alignStub(pin: Point, other: Point, out: Dir): Point | null {
  const dx = other.x - pin.x;
  const dy = other.y - pin.y;
  const d = Math.hypot(dx, dy) || 1;
  const dot = (dx / d) * out.x + (dy / d) * out.y;
  if (Math.abs(dot) > 0.5) return null;
  const len = Math.min(PITCH * 0.9, d * 0.5);
  return new Point(pin.x + out.x * len, pin.y + out.y * len);
}

/** The route a conduit is DRAWN along: the logical route plus a small aligning stub at
 *  each pin end (see {@link alignStub}). Rendering-only — the logical route (hit-test,
 *  waypoints, carriers) is unchanged. */
export function conduitDrawRoute(
  route: Point[],
  out0: Dir | null,
  out1: Dir | null,
): Point[] {
  if (route.length < 2 || (!out0 && !out1)) return route;
  const pts = route.slice();
  if (out1) {
    const s = alignStub(pts[pts.length - 1]!, pts[pts.length - 2]!, out1);
    if (s) pts.splice(pts.length - 1, 0, s);
  }
  if (out0) {
    const s = alignStub(pts[0]!, pts[1]!, out0);
    if (s) pts.splice(1, 0, s);
  }
  return pts;
}

export function routeLength(pts: Point[]): number {
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    len += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
  }
  return len;
}

/**
 * Advance a belt's absolute arc-length offset (pixels) by `delta`, clamping the
 * per-frame step so an AC reversal at high tps stays a smooth slosh instead of a
 * jump, then wrap into `[0, len)`. Pixel speed is `|delta|` and is independent of
 * `len`, so equal-current traces flow at the same on-screen speed at any length.
 */
export function advanceBeltOffset(
  offset: number,
  delta: number,
  len: number,
): number {
  const step = Math.max(
    -MAX_FLOW_PX_PER_FRAME,
    Math.min(MAX_FLOW_PX_PER_FRAME, delta),
  );
  const next = offset + step;
  return ((next % len) + len) % len;
}

/**
 * Absolute arc-length positions (px) of belt dots along a trace of length `len`,
 * at the given pixel `spacing` and arc-length `offset`. Spacing is the spacing the
 * current asks for, so equal-current segments draw the same arrows-per-pixel at any
 * length (constant density). If that would exceed `MAX_BELT_DOTS` (a very long, high-
 * current trace) the spacing is stretched to spread exactly the cap evenly over the
 * whole belt — density degrades gracefully instead of leaving the tail bare, and the
 * graphics count stays bounded. Positions wrap through `offset` so the belt scrolls.
 */
export function beltDots(
  len: number,
  spacing: number,
  offset: number,
): number[] {
  const want = Math.max(1, Math.ceil(len / spacing));
  const n = Math.min(MAX_BELT_DOTS, want);
  const step = n >= want ? spacing : len / n; // stretch only when capped
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((i * step + offset) % len);
  return out;
}

/** Position + unit direction at fraction `t` of a polyline's arc length. */
export function sampleRoute(pts: Point[], t: number): RouteSample {
  return sampleRouteAt(pts, t * routeLength(pts));
}

/**
 * Position + unit direction at an absolute arc-length `dist` (in pixels) along a
 * polyline. Belt dots are placed by absolute distance — not a route fraction — so
 * a given current draws the same on-screen spacing and speed at every trace length.
 */
export function sampleRouteAt(pts: Point[], dist: number): RouteSample {
  let target = dist;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const seg = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (seg <= 0) continue;
    if (target <= seg) {
      const f = target / seg;
      return {
        x: p0.x + (p1.x - p0.x) * f,
        y: p0.y + (p1.y - p0.y) * f,
        dx: (p1.x - p0.x) / seg,
        dy: (p1.y - p0.y) / seg,
      };
    }
    target -= seg;
  }
  const last = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2] ?? last;
  const dl = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
  return {
    x: last.x,
    y: last.y,
    dx: (last.x - prev.x) / dl,
    dy: (last.y - prev.y) / dl,
  };
}

/**
 * A flow chevron (arrowhead) at (x,y) pointing along (dx,dy). `size` is the
 * arrowhead half-length in pixels — it scales with current so amperage reads as
 * bigger arrows (never as faster ones); the stroke width tracks it so the glyph
 * stays proportioned. Defaults preserve the previous fixed size.
 */
export function drawChevron(
  g: Graphics,
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: number,
  alpha: number,
  size = 4,
): void {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const s = size;
  const bx = x - ux * s;
  const by = y - uy * s;
  g.moveTo(bx + px * s, by + py * s)
    .lineTo(x, y)
    .lineTo(bx - px * s, by - py * s);
  g.stroke({ width: Math.max(2, s * 0.5), color, alpha });
}

/**
 * Re-skin a bare trace as a conduit: an ANALOGY pipe (steel wall, dark bore,
 * voltage-tinted water) or a REALITY metal conductor (bright sheath, glowing core, a
 * sheen highlight). Constant-width strokes — Pixi rounds the bends and the ends —
 * plus a port collar at each end so the conduit merges smoothly into the part (or
 * junction) it plugs into, the "adaptive taper" without per-part port geometry.
 */
export function drawConduitSkin(
  g: Graphics,
  rp: Point[],
  color: number,
  pw: number,
  lens: BoardLens,
): void {
  const cap = "round" as const;
  const join = "round" as const;
  // OPAQUE core (was 0.26/0.3): a later pipe's core now KNOCKS OUT the one it crosses, so two pipes
  // read as two (a clean over/under) instead of two translucent fills summing into a brighter blob.
  const coreAlpha = 0.95;
  const wallCol = lens === "analogy" ? PIPE_WALL : COND_CASING;
  // `rp` is the already-rounded draw path. Layers, outside-in: a near-opaque dark MOAT (a thin
  // trench wider than the wall, laid first so each later route knocks back the previous pipe's halo
  // — restoring the dark grid gap the eye uses to separate adjacent/crossing pipes), a faint steel
  // wall rim (the soft halo), then the opaque voltage-tinted core. The carriers walk this same path.
  polyline(g, rp);
  g.stroke({ width: pw + 5, color: 0x0d0b16, alpha: 0.9, cap, join });
  polyline(g, rp);
  g.stroke({ width: pw + 3, color: wallCol, alpha: 0.24, cap, join });
  polyline(g, rp);
  g.stroke({
    width: Math.max(1, pw - 1),
    color,
    alpha: coreAlpha,
    cap,
    join,
  });
  if (lens === "reality") {
    polyline(g, rp);
    g.stroke({ width: 1.2, color: 0xffffff, alpha: 0.08, cap, join });
  }
  // Port plug at each end: the round line-cap already paints a clean ph-radius dome where the pipe
  // meets a pin/junction, so the connection needs no flare. The old 4-point taper flared out to
  // ~8.8px and — now that the core is opaque — read as a hard triangular ARROWHEAD pointing into the
  // pin (three of them made a junction a spiky asterisk). Replace it with a concentric round GROMMET:
  // a dark-moat disc + an opaque voltage-core disc, both at/under the cap radius so nothing protrudes.
  // The pipe simply plugs in — solid, round, no apex, no orientation, no spike. Same two colours/alphas
  // as the body, so there's no translucency seam, and it never paints proud of the pipe wall (so the
  // crossing over/under occlusion is preserved).
  const ph = (pw + 5) / 2;
  for (const ei of [0, rp.length - 1] as const) {
    const e = rp[ei];
    if (!e) continue;
    g.circle(e.x, e.y, ph).fill({ color: 0x0d0b16, alpha: 0.9 });
    g.circle(e.x, e.y, Math.max(1, ph - 2)).fill({ color, alpha: coreAlpha });
  }
}

/**
 * A conduit junction: one clean ROUND node the pipes tie off into. A dark collar disc blanks every
 * unused cardinal at once (replacing the old per-direction blanking nubs, which read as an asterisk's
 * arms beside the opaque pipes), then an opaque colour disc on top — sized to SWALLOW the arriving
 * pipe-end grommets — so a 3-way tie reads as a single solid dot, not a spiky cluster. Drawn after
 * every pipe (drawJunctions runs last), so the hub paints on top of the pipe ends.
 */
export function drawJunctionConduit(
  g: Graphics,
  p: Point,
  color: number,
): void {
  const pw = 5; // matches the thin pipe body
  // Dark collar disc first: a ROUND rim that knocks back each arriving pipe's moat/bloom and blanks
  // all unused cardinals at once (no radiating stubs). It's the KiCad-style dark backing ring.
  g.circle(p.x, p.y, pw / 2 + 3.5).fill({ color: 0x0d0b16, alpha: 0.92 });
  // Opaque colour hub on top, big enough to cover the pipe-end grommets (dark radius ≤ ~7) so the
  // tie reads as ONE node the pipes plug into. The 2px dark ring between collar and hub stays legible.
  g.circle(p.x, p.y, pw / 2 + 1.5).fill({ color, alpha: 0.95 });
}

// --- wire routing -----------------------------------------------------------
// The `this`-free route family: the orthogonal polyline a wire is drawn / hit-tested /
// routed along, re-parameterised on the `graph` (and the die-frame id) that were the only
// `Board` fields it read. `board.ts` keeps `private` wrappers that pass `this.graph` /
// `this.dieFrameId`, so its call sites are byte-identical; the sealed-IC opened view can
// call these directly over its reconstructed inner graph.

/** World position of a grid cell's anchor (col,row → px). */
export function cellToWorld(cell: Cell): Point {
  return new Point(cell.col * PITCH, cell.row * PITCH);
}

/** The outward facing (unit cardinal) of a pin endpoint, or null for a junction / a centre
 *  or corner pin (ambiguous). Used to give a conduit a short straight exit stub. */
export function pinOutward(ep: Endpoint, graph: BoardGraph): Dir | null {
  if (isJunctionRef(ep)) return null;
  const c = graph.components.get(ep.componentId);
  if (!c) return null;
  const kind = graph.kindOf(c);
  const pin = kind?.pins[ep.pinIndex];
  if (!kind || !pin) return null;
  const ox = pin.dx - (kind.w - 1) / 2;
  const oy = pin.dy - (kind.h - 1) / 2;
  if (ox === 0 && oy === 0) return null;
  const rr = rotateOffset(ox, oy, c.rot, c.mirror);
  const ax = Math.abs(rr.col);
  const ay = Math.abs(rr.row);
  if (Math.abs(ax - ay) < 0.4) return null; // corner pin → ambiguous facing
  return ax > ay
    ? { x: Math.sign(rr.col), y: 0 }
    : { x: 0, y: Math.sign(rr.row) };
}

export function wireRoute(pa: Point, pb: Point): Point[] {
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  if (Math.abs(dx) < 1 || Math.abs(dy) < 1) return [pa, pb];
  if (Math.abs(dx) >= Math.abs(dy)) {
    const mx = pa.x + dx / 2;
    return [pa, new Point(mx, pa.y), new Point(mx, pb.y), pb];
  }
  const my = pa.y + dy / 2;
  return [pa, new Point(pa.x, my), new Point(pb.x, my), pb];
}

/**
 * If `ep` is a pad on the die frame (die-editor only), the axis a trace should LEAVE it on: "v"
 * (vertical) for a top/bottom-edge package (SOT, wide), "h" for a side-edge package (DIP, tall). Lets
 * a builder→internal trace DOWN-BEND — exit perpendicular to the pad's edge with a single elbow —
 * instead of the generic mid-split Z-route (owner: "for the builder to the internal connections it
 * should allow a down-bend"). Null when not a frame pad, so the ordinary board is unaffected.
 */
export function dieFramePinExit(
  ep: Endpoint,
  graph: BoardGraph,
  dieFrameId: number | null,
): "v" | "h" | null {
  if (dieFrameId === null) return null;
  if (!isPinRef(ep) || ep.componentId !== dieFrameId) return null;
  const frame = graph.components.get(dieFrameId);
  const kind = frame ? PART_KINDS[frame.kind] : undefined;
  if (!kind) return null;
  let minDx = Infinity;
  let maxDx = -Infinity;
  let minDy = Infinity;
  let maxDy = -Infinity;
  for (const pin of kind.pins) {
    if (pin.dx < minDx) minDx = pin.dx;
    if (pin.dx > maxDx) maxDx = pin.dx;
    if (pin.dy < minDy) minDy = pin.dy;
    if (pin.dy > maxDy) maxDy = pin.dy;
  }
  // Pads sit on the long (array) edges; a trace leaves perpendicular to that edge.
  return maxDx - minDx >= maxDy - minDy ? "v" : "h";
}

/**
 * The DOWN-BEND route from/into a die-frame pad: leave the pad PERPENDICULAR to its edge and reach the
 * target with a single elbow (an L, not the mid-split Z {@link wireRoute} draws). `exitFrom`/`exitTo`
 * are the pad exit axes ({@link dieFramePinExit}); `exitFrom` wins if both ends are pads. Falls back to
 * a straight segment when already aligned. Used only when one end is a frame pad — pure geometry, the
 * wire's logical connectivity is unchanged.
 */
export function frameLeadRoute(
  pa: Point,
  pb: Point,
  exitFrom: "v" | "h" | null,
  exitTo: "v" | "h" | null,
): Point[] {
  const near = (m: number, n: number): boolean => Math.abs(m - n) < 1;
  if (exitFrom === "v") {
    return near(pa.x, pb.x) ? [pa, pb] : [pa, new Point(pa.x, pb.y), pb];
  }
  if (exitFrom === "h") {
    return near(pa.y, pb.y) ? [pa, pb] : [pa, new Point(pb.x, pa.y), pb];
  }
  // The frame pad is `pb`: bend so the LAST leg into pb is perpendicular to its edge.
  if (exitTo === "v") {
    return near(pa.x, pb.x) ? [pa, pb] : [pa, new Point(pb.x, pa.y), pb];
  }
  return near(pa.y, pb.y) ? [pa, pb] : [pa, new Point(pa.x, pb.y), pb];
}

/**
 * The full orthogonal polyline for a wire: the auto L-route when it has no
 * manual waypoints, otherwise an orthogonal leg bending through each waypoint in
 * order (from → wp[0] → … → wp[n-1] → to). Empty if either endpoint has gone
 * missing. This is the single source of wire geometry (draw / hit-test /
 * selection handles / probe-snap).
 */
export function routeForWire(
  w: Wire,
  graph: BoardGraph,
  dieFrameId: number | null,
): Point[] {
  const a = graph.endpointCell(w.from);
  const b = graph.endpointCell(w.to);
  if (!a || !b) return [];
  const wps = w.waypoints ?? [];
  const anchors = [a, ...wps, b].map((c) => cellToWorld(c));
  if (anchors.length === 2) {
    // A wire touching a die-frame pad down-bends (perpendicular exit + one elbow); everything else
    // gets the ordinary mid-split Z-route.
    const exitFrom = dieFramePinExit(w.from, graph, dieFrameId);
    const exitTo = dieFramePinExit(w.to, graph, dieFrameId);
    return exitFrom || exitTo
      ? frameLeadRoute(anchors[0]!, anchors[1]!, exitFrom, exitTo)
      : wireRoute(anchors[0]!, anchors[1]!);
  }
  // Chain an orthogonal leg through each consecutive anchor pair, dropping the
  // duplicated joint between legs so the polyline is continuous.
  const out: Point[] = [];
  for (let i = 0; i + 1 < anchors.length; i++) {
    const leg = wireRoute(anchors[i]!, anchors[i + 1]!);
    if (i === 0) out.push(...leg);
    else out.push(...leg.slice(1));
  }
  return out;
}

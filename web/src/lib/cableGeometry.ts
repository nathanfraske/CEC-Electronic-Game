// SPDX-License-Identifier: Apache-2.0
// Pure geometry for the bus-cable UNZIP render (board.ts `drawCables`/`drawCableStrands`): the
// orthogonalized bundle centreline (`buildCableTrunk`), the parallel-offset of a Manhattan polyline
// (`offsetOrtho`), and the per-bit strand routes (`cableStrandRoutes`). Split out of board.ts so the
// crossing-free property — the bundle's lanes never cross each other at ANY bus width — is unit-testable
// without a browser (`cableGeometry.test.ts`). Render-only / golden-safe: a cable lowers to N net-labels
// (deriveCableLinks); none of this crosses the wasm boundary or the snapshot hash.
import { Point } from "pixi.js";

/**
 * Orthogonalize a cable's centreline — `[srcGather, ...routeWaypoints, dstGather]` — into a pure-Manhattan
 * polyline so the trunk leaves the source gather and enters the destination gather along each end's fan
 * axis. With NO route the single leg is split honouring BOTH gathers: a Z (two elbows) when they share an
 * approach axis (e.g. two horizontal-facing arrays at different rows), an L when they differ. With a route,
 * each leg gets one elbow, the first honouring `srcAxis`, the last `dstAxis`. A final pass drops any vertex
 * collinear with both neighbours — redundant points AND, crucially, BACKTRACK SPURS (an elbow that lands at
 * the gather's coordinate while the next waypoint sits the other side of it would hook out-and-back; the
 * perpendicular offset of that cusp would cross the lanes — the bowtie), leaving a clean monotonic run.
 * Render-only (the stored `route` is unchanged); shared by the collapsed trunk and the unzip.
 */
export function buildCableTrunk(
  srcPt: { x: number; y: number },
  dstPt: { x: number; y: number },
  routeW: Point[],
  srcAxis: "h" | "v",
  dstAxis: "h" | "v",
): Point[] {
  let trunk: Point[];
  if (routeW.length === 0) {
    const out: Point[] = [new Point(srcPt.x, srcPt.y)];
    if (srcPt.x !== dstPt.x && srcPt.y !== dstPt.y) {
      if (srcAxis === dstAxis) {
        // Both ends approached on the same axis → a Z (two elbows) so the leg leaves AND enters on it.
        if (srcAxis === "h") {
          const midX = (srcPt.x + dstPt.x) / 2;
          out.push(new Point(midX, srcPt.y), new Point(midX, dstPt.y));
        } else {
          const midY = (srcPt.y + dstPt.y) / 2;
          out.push(new Point(srcPt.x, midY), new Point(dstPt.x, midY));
        }
      } else {
        out.push(
          srcAxis === "h"
            ? new Point(dstPt.x, srcPt.y)
            : new Point(srcPt.x, dstPt.y),
        );
      }
    }
    out.push(new Point(dstPt.x, dstPt.y));
    trunk = out;
  } else {
    const pts = [srcPt, ...routeW, dstPt];
    trunk = [new Point(pts[0]!.x, pts[0]!.y)];
    for (let i = 1; i < pts.length; i++) {
      const a = trunk[trunk.length - 1]!;
      const b = pts[i]!;
      if (a.x !== b.x && a.y !== b.y) {
        const corner =
          i === pts.length - 1
            ? dstAxis === "h"
              ? new Point(a.x, b.y)
              : new Point(b.x, a.y)
            : i === 1
              ? srcAxis === "h"
                ? new Point(b.x, a.y)
                : new Point(a.x, b.y)
              : new Point(b.x, a.y);
        trunk.push(corner);
      }
      trunk.push(new Point(b.x, b.y));
    }
  }
  // Drop any vertex collinear with BOTH neighbours — same x for all three, or same y — removing redundant
  // points AND backtrack spurs (a cusp whose perpendicular offset would cross the lanes). The result is a
  // clean monotonic Manhattan run, so the offset bundle never self-crosses.
  let changed = true;
  while (changed && trunk.length > 2) {
    changed = false;
    for (let i = 1; i < trunk.length - 1; i++) {
      const a = trunk[i - 1]!;
      const b = trunk[i]!;
      const c = trunk[i + 1]!;
      const sameX = Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6;
      const sameY = Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6;
      if (sameX || sameY) {
        trunk.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return trunk;
}

/**
 * Parallel-offset an orthogonal polyline by a signed distance `d` along each segment's LEFT normal
 * (−dy, dx). Interior corners are the intersection of the two adjacent offset segment-lines (always
 * well-defined for the 90° turns a Manhattan trunk makes); endpoints shift along their single adjacent
 * segment. Duplicate/collinear input points are dropped first so every kept vertex has a real turn. Used
 * to lay each unzipped strand as a lane parallel to the trunk, so the bundle bends with the route.
 */
export function offsetOrtho(pts: Point[], d: number): Point[] {
  const P: Point[] = [];
  for (const p of pts) {
    const last = P[P.length - 1];
    if (!last || Math.abs(p.x - last.x) > 1e-6 || Math.abs(p.y - last.y) > 1e-6)
      P.push(p);
  }
  if (P.length < 2) return P.map((p) => new Point(p.x, p.y));
  const seg = P.slice(0, -1).map((p, i) => {
    let dx = P[i + 1]!.x - p.x;
    let dy = P[i + 1]!.y - p.y;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    return { dx, dy, nx: -dy, ny: dx };
  });
  const out: Point[] = [
    new Point(P[0]!.x + seg[0]!.nx * d, P[0]!.y + seg[0]!.ny * d),
  ];
  for (let i = 1; i < P.length - 1; i++) {
    const s0 = seg[i - 1]!;
    const s1 = seg[i]!;
    const a = new Point(P[i]!.x + s0.nx * d, P[i]!.y + s0.ny * d);
    const b = new Point(P[i]!.x + s1.nx * d, P[i]!.y + s1.ny * d);
    // Intersect line(a, s0.dir) with line(b, s1.dir); perpendicular dirs ⇒ never singular for 90° turns.
    const det = s0.dx * -s1.dy - -s1.dx * s0.dy;
    if (Math.abs(det) < 1e-9) {
      out.push(b);
      continue;
    }
    const t = ((b.x - a.x) * -s1.dy - -s1.dx * (b.y - a.y)) / det;
    out.push(new Point(a.x + t * s0.dx, a.y + t * s0.dy));
  }
  const sl = seg[seg.length - 1]!;
  out.push(
    new Point(P[P.length - 1]!.x + sl.nx * d, P[P.length - 1]!.y + sl.ny * d),
  );
  return out;
}

/**
 * The per-bit strand routes for the unzip, indexed by bit (route `[i]` plugs `srcW[i]`→`dstW[i]`). Each bit
 * gets a symmetric STAGGERED "belt" fan at each end (a compact nested chevron keyed to the strand's rank
 * FROM the centre, so it stays evenly spaced + non-crossing as the bus widens — at ANY N, odd or even, up to
 * 64-bit and beyond) joined by a lane parallel to the `trunk` ({@link offsetOrtho}), so the bundle follows
 * the route's bends. When the trunk is shorter than the fan needs (zip and unzip too close) it falls back to
 * a straight pin→pin RUN-THROUGH — no bundling. Pure geometry; the caller colours + strokes each route.
 *
 * `axis` is the bus's APPROACH axis (the gather's fan axis, from board.ts `gatherAxis`): `"h"` (the default)
 * is a horizontal-approach bus — pins stacked vertically, strands run left↔right. `"v"` is a vertical-approach
 * bus — pins stacked horizontally, strands run up↕down. Vertical is solved by TRANSPOSING (reflecting across
 * `y = x`) the inputs into the horizontal frame, running the one belt-fan, then transposing the routes back:
 * a reflection preserves orthogonality AND distances, so the crossing-free property carries over unchanged
 * with no duplicated geometry. (The caller only takes this path when both ends share an approach axis.)
 */
export function cableStrandRoutes(
  srcW: Point[],
  dstW: Point[],
  trunk: Point[],
  pitch: number,
  axis: "h" | "v" = "h",
): Point[][] {
  if (axis === "v") {
    const T = (p: Point) => new Point(p.y, p.x);
    return cableStrandRoutes(
      srcW.map(T),
      dstW.map(T),
      trunk.map(T),
      pitch,
      "h",
    ).map((r) => r.map(T));
  }
  const n = srcW.length;
  const sx = trunk[0]!.x;
  const dx = trunk[trunk.length - 1]!.x;
  const LANE = pitch * 0.24; // perpendicular gap between adjacent strands — a dense ribbon
  const LEAD = pitch * 0.8; // straight lead-out track off each pin BEFORE any turn (no harsh pin-bends)
  const STEP = LANE * 1.2; // x-stagger of the convergence verticals — on par with LANE, a touch bigger, so
  //                          the nested chevron packs at just over 45° (matching the bundle's strand density)
  // Order strands top→bottom by their SOURCE pin so the lanes never cross, and place each on the lane at its
  // sorted rank.
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => srcW[a]!.y - srcW[b]!.y,
  );
  const mid = (n - 1) / 2;
  const routes: Point[][] = new Array(n);
  // TOO CLOSE → straight RUN-THROUGH: when the trunk (the parallel-bundle run between the zip and the unzip)
  // is shorter than the fan needs, there is no room for a clean belt. Default to each bit a direct Manhattan
  // trace pin→pin (a single straight line for an aligned bus), no bundling.
  let trunkLen = 0;
  for (let i = 1; i < trunk.length; i++)
    trunkLen += Math.hypot(
      trunk[i]!.x - trunk[i - 1]!.x,
      trunk[i]!.y - trunk[i - 1]!.y,
    );
  if (trunkLen < Math.max(pitch, (mid + 1) * STEP)) {
    for (let p = 0; p < n; p++) {
      const i = order[p]!;
      const sp = srcW[i]!;
      const dp = dstW[i]!;
      const mx = (sp.x + dp.x) / 2;
      routes[i] =
        Math.abs(sp.y - dp.y) < 1e-6
          ? [sp, dp]
          : [sp, new Point(mx, sp.y), new Point(mx, dp.y), dp];
    }
    return routes;
  }
  // BELT-FAN + parallel bundle. The convergence is a COMPACT NESTED CHEVRON anchored at each end's FAN-START
  // (the pin column's lead-out end), NOT out at the gather — so the strands begin converging right after they
  // leave their pins (a short pin→convergence lead) and then run as a long parallel bundle to the gather and
  // along the trunk. Each strand's turn is staggered by its rank FROM the centre: the innermost pair turns at
  // the fan-start, each more-outward pair one `STEP` further along, so the outermost runs straight longest —
  // the same nested chevron, just sitting next to the pins. Between the two chevrons each strand follows a
  // lane parallel to the trunk (offsetOrtho), so the bundle bends with the route. Signed by the trunk's
  // leaving direction so the topmost source pin always takes the topmost lane (no twist) at the source end.
  const srcDirSign = Math.sign(trunk[1]!.x - trunk[0]!.x) || 1;
  const srcFanStart = Math.min(
    Math.max(...srcW.map((p) => p.x)) + LEAD,
    sx - pitch * 0.3,
  );
  const dstFanStart = Math.max(
    Math.min(...dstW.map((p) => p.x)) - LEAD,
    dx + pitch * 0.3,
  );
  const maxRank = Math.floor(mid); // rank of the innermost pair — anchors the chevron at the fan-start
  for (let p = 0; p < n; p++) {
    const i = order[p]!;
    const sp = srcW[i]!;
    const dp = dstW[i]!;
    const rankOut = mid - Math.abs(p - mid); // 0 for the outermost strands, +1 per pair toward the centre
    // Turn x, measured OUT from the fan-start (clamped to leave a sliver of bundle before the gather): the
    // innermost pair turns at the fan-start, each outward pair `STEP` further along. Strictly monotonic in
    // rankOut ⇒ the lanes still nest without crossing.
    const sTurn = Math.min(
      sx - pitch * 0.3,
      srcFanStart + (maxRank - rankOut) * STEP,
    );
    const dTurn = Math.max(
      dx + pitch * 0.3,
      dstFanStart - (maxRank - rankOut) * STEP,
    );
    const lane = offsetOrtho(trunk, (p - mid) * LANE * srcDirSign);
    const entry = lane[0]!;
    const exit = lane[lane.length - 1]!;
    routes[i] = [
      sp,
      new Point(sTurn, sp.y),
      new Point(sTurn, entry.y),
      ...lane,
      new Point(dTurn, exit.y),
      new Point(dTurn, dp.y),
      dp,
    ];
  }
  return routes;
}

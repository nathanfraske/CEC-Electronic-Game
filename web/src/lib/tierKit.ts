// SPDX-License-Identifier: Apache-2.0
// Shared kit for the full-panel tier illustrations — the common types, scales and
// drawing primitives behind BOTH the reality tier (detailDrawers.ts, the device
// internals) and the analogy tier (analogyDrawers.ts, the factory-machine
// metaphor). A tier illustration paints an *illustration of the object* into a
// centred bounds (not a wired board symbol), reads only the live ElectricalState +
// phase, and recolours from PALETTE — pure presentation, no sim / netlist / golden
// touch, honouring the bus-language discipline (docs/ui/visual-language.md):
// magnitude rides alpha / density / thickness, NEVER speed.

import { Graphics } from "pixi.js";
import { type ElectricalState } from "./glyphs";

/**
 * What a tier drawer is handed. A superset of the glyph's draw inputs, but with a
 * centred {@link TierBounds} instead of pin coordinates — the illustration owns its
 * whole canvas. `color` is the kind's accent (PALETTE); `electrical` and `phase`
 * are the same live pair the glyphs animate from; `value`/`wiper` carry a part's
 * primary/secondary scalar for the few state-bearing kinds.
 */
export interface TierOpts {
  kind: string;
  /** Drawing region, centred on the origin (the host translates to canvas centre). */
  bounds: TierBounds;
  /** The kind's accent colour (PALETTE[colorKey]). */
  color: number;
  /** Live per-element readout — the source of all motion. */
  electrical: ElectricalState;
  /** The shared bounded visual flow clock (Board.flowPhase()); pauses + reverses. */
  phase: number;
  /** The part's primary scalar (Component.value); most drawers ignore it. */
  value?: number;
  /** A potentiometer's wiper in [0,1]; only the POT drawer reads it. */
  wiper?: number;
  /** A thermistor's body temperature in °C; only the NTC/PTC drawer reads it. */
  temp?: number;
  /**
   * Terminal anchor points in the drawer's OWN bounds space (pre-scale px), one per
   * catalog pin (carrying its `label`). The host computes where each real pin lands
   * inside the illustration's box — on the board, the actual footprint pin; in the
   * info panel, the laid-out terminal — and a multi-terminal drawer routes each lead
   * to its anchor so the picture's connections sit exactly on the part's pins. Absent
   * ⇒ the drawer uses its own default edge placement (see {@link anchorPt}).
   */
  anchors?: TierAnchor[];
}

/** One terminal's anchor: where a named pin lands inside the illustration's box. */
export interface TierAnchor {
  label: string;
  x: number;
  y: number;
}

/** Half-extents of the centred drawing region, in local (pre-scale) px. */
export interface TierBounds {
  hw: number;
  hh: number;
}

/**
 * Resolve a named terminal's anchor point. Returns the host-supplied anchor when one
 * exists for `label` (so the lead lands on the real pin), else a fallback at the given
 * fraction of the bounds — letting a drawer be written purely against anchors while
 * still degrading gracefully when none are passed.
 */
export function anchorPt(
  o: TierOpts,
  label: string,
  fxFrac: number,
  fyFrac: number,
): { x: number; y: number } {
  const a = o.anchors?.find((p) => p.label === label);
  if (a) return { x: a.x, y: a.y };
  return { x: fxFrac * o.bounds.hw, y: fyFrac * o.bounds.hh };
}

// --- shared scales ------------------------------------------------------------

/** Saturating normalize: magnitude → 0..1 with a soft knee at `scale`. */
export function norm(x: number, scale: number): number {
  const a = Math.abs(x) / scale;
  return a / (1 + a);
}

export const CUR_SCALE = 0.02; // ~20 mA reads as a strong current
export const V_SCALE = 6; // ~6 V reads as a strong field/drop
export const OUT_SCALE = 8; // op-amp output rails near ±8 V (teaching saturation)

// Constant recirculation per unit phase — NOT magnitude-scaled (the anti-pattern
// is speed-carries-magnitude; see docs/ui/visual-language.md). Magnitude is
// carried by density + alpha instead.
export const FLOW_SPEED = 1.0;
export const FLOW_DOTS_MIN = 2;
export const FLOW_DOTS_MAX = 7;
// Breathing/pulse clock, on the same bounded phase (~1.3 visual Hz).
export const PULSE_K = 2.2;

// --- colour helpers -----------------------------------------------------------

/** A 0xRRGGBB → {r,g,b} split, for cheap channel blends. */
export function rgb(c: number): { r: number; g: number; b: number } {
  return { r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff };
}
/** Linear blend between two packed colours, t in [0,1]. */
export function mix(a: number, b: number, t: number): number {
  const ca = rgb(a);
  const cb = rgb(b);
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(ca.r + (cb.r - ca.r) * k);
  const g = Math.round(ca.g + (cb.g - ca.g) * k);
  const bl = Math.round(ca.b + (cb.b - ca.b) * k);
  return (r << 16) | (g << 8) | bl;
}

// --- flow primitives ----------------------------------------------------------

/**
 * Smooth fade for the marginal carrier as `mag` grows the visible dot count past a
 * whole dot. Keeps the dot *positions* fixed (always `max` evenly-spaced slots) and
 * only ramps the trailing dots' alpha in/out — so a live current that wiggles across
 * a rounding boundary no longer flips the count and teleports every dot. Magnitude
 * still rides density+alpha (visual-language §flow), just jitter-free.
 */
export function dotPresence(
  i: number,
  mag: number,
  max = FLOW_DOTS_MAX,
): number {
  const visible = FLOW_DOTS_MIN + (max - FLOW_DOTS_MIN) * mag;
  return Math.max(0, Math.min(1, visible - i));
}

/**
 * Flowing carriers along a straight segment — the tier-view "belt". Density + alpha
 * ride `mag` (0..1); the belt always recirculates at the bounded rate. `dir`
 * (+1/−1) sets travel direction. `r` is the dot radius. The dot slots are FIXED
 * (FLOW_DOTS_MAX of them) and faded by magnitude, so the belt never jitters when
 * the live current changes — only the trailing dots dim in and out.
 */
export function belt(
  g: Graphics,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  mag: number,
  dir: number,
  phase: number,
  color: number,
  r = 2.2,
): void {
  if (mag < 0.02) return;
  const n = FLOW_DOTS_MAX;
  for (let i = 0; i < n; i++) {
    const present = dotPresence(i, mag);
    if (present <= 0) continue;
    const t = (((i / n + phase * FLOW_SPEED * dir) % 1) + 1) % 1;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    g.circle(x, y, r).fill({ color, alpha: (0.35 + 0.55 * mag) * present });
  }
}

/**
 * Like {@link belt} but along an arbitrary polyline `pts` (e.g. a tessellated bezier —
 * a flexible hose). Carriers ride the bounded `phase` at constant rate; density + alpha
 * ride `mag`; `dir` (+1/−1) sets travel along the path.
 */
export function flowAlongPath(
  g: Graphics,
  pts: { x: number; y: number }[],
  mag: number,
  dir: number,
  phase: number,
  color: number,
  r = 2.4,
): void {
  if (mag < 0.02 || pts.length < 2) return;
  const cum = [0];
  for (let i = 0; i < pts.length - 1; i++) {
    cum.push(
      cum[i]! +
        Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y),
    );
  }
  const total = cum[cum.length - 1]!;
  if (total <= 0) return;
  const at = (d: number): { x: number; y: number } => {
    for (let i = 0; i < pts.length - 1; i++) {
      if (d <= cum[i + 1]!) {
        const t = (d - cum[i]!) / (cum[i + 1]! - cum[i]! || 1);
        return {
          x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t,
          y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t,
        };
      }
    }
    return pts[pts.length - 1]!;
  };
  const n = FLOW_DOTS_MAX;
  for (let i = 0; i < n; i++) {
    const present = dotPresence(i, mag);
    if (present <= 0) continue;
    const t = (((i / n + phase * FLOW_SPEED * dir) % 1) + 1) % 1;
    const p = at(t * total);
    g.circle(p.x, p.y, r).fill({ color, alpha: (0.3 + 0.55 * mag) * present });
  }
}

/**
 * Flowing carriers down a vertical pipe that PART around a central plug — the two
 * symmetric streams hug the centre away from the obstacle and bulge out toward the
 * walls as they pass it, so the plug visibly throttles the flow (the valve-control
 * lesson the transistor/MOSFET analogies teach). Density + alpha ride `mag`; motion is
 * on the bounded `phase` (never speed). `yFrom`→`yTo` is the travel direction along the
 * pipe at `pipeX` (half-width `pipeHW`); `plugY`/`plugHalf` is the obstacle to skirt.
 */
export function flowAroundPlug(
  g: Graphics,
  pipeX: number,
  pipeHW: number,
  yFrom: number,
  yTo: number,
  plugY: number,
  plugHalf: number,
  mag: number,
  phase: number,
  color: number,
  r = 2.6,
): void {
  if (mag < 0.02) return;
  const n = FLOW_DOTS_MAX;
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const present = dotPresence(i, mag);
      if (present <= 0) continue;
      const t = (((i / n + phase * FLOW_SPEED) % 1) + 1) % 1;
      const y = yFrom + (yTo - yFrom) * t;
      // a single centred stream that swings out toward the walls only as it skirts
      // the plug, then rejoins — so the obstacle visibly splits the flow.
      const bump = Math.exp(-(((y - plugY) / plugHalf) ** 2));
      const lane = pipeHW * 0.82 * bump;
      g.circle(pipeX + side * lane, y, r).fill({
        color,
        alpha: (0.3 + 0.5 * mag) * present,
      });
    }
  }
}

/**
 * Carriers streaming along a HORIZONTAL pipe that PART around a ball obstacle — two
 * symmetric lanes that ride the axis, then bulge out toward the chamber walls as they
 * skirt the ball and rejoin past it (the open check valve: water flows AROUND the lifted
 * ball, not through it). Density + alpha ride `mag` (0..1); motion is on the bounded
 * `phase` (never speed). `xFrom`→`xTo` is the travel direction along the axis at `cy`;
 * the ball is at (`ballX`, cy) radius `ballR`; `chamberHH` is how far the lanes may bulge
 * (the valve chamber half-height, wider than the thin pipe).
 */
export function flowAroundBall(
  g: Graphics,
  xFrom: number,
  xTo: number,
  cy: number,
  chamberHH: number,
  ballX: number,
  ballR: number,
  mag: number,
  phase: number,
  color: number,
  r = 2.4,
): void {
  if (mag < 0.02) return;
  const n = FLOW_DOTS_MAX;
  // Sit the bulged lane just outside the ball but inside the chamber walls.
  const lane = Math.min(chamberHH - r - 2, ballR + r + 4);
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const present = dotPresence(i, mag);
      if (present <= 0) continue;
      const t = (((i / n + phase * FLOW_SPEED) % 1) + 1) % 1;
      const x = xFrom + (xTo - xFrom) * t;
      // hug the axis away from the ball, swing out to the lane only as it passes.
      const bump = Math.exp(-(((x - ballX) / (ballR * 1.25)) ** 2));
      g.circle(x, cy + side * lane * bump, r).fill({
        color,
        alpha: (0.3 + 0.5 * mag) * present,
      });
    }
  }
}

/**
 * Carriers funnelling THROUGH a central gap between two shutter plates on a HORIZONTAL
 * pipe — the inverse of {@link flowAroundPlug}. Several lanes ride the full channel,
 * then SQUEEZE toward the axis as they pass the gate and fan back out, so a wide-open
 * valve passes a fat stream while a shutting one pinches it to a thin thread (and snaps
 * to a near-line as the gap → 0). The thermistor heat-valve lesson: openness is read in
 * the stream itself, not just the plate positions. Density + alpha ride `mag`; motion is
 * on the bounded `phase` (never speed). `xFrom`→`xTo` is travel along the axis at `cy`;
 * the channel half-height is `pipeHH`; the gate sits at `gateX` leaving half-gap
 * `gapHalf`; the funnel eases over `throat` on each side.
 */
export function flowThroughGap(
  g: Graphics,
  xFrom: number,
  xTo: number,
  cy: number,
  pipeHH: number,
  gapHalf: number,
  gateX: number,
  throat: number,
  mag: number,
  dir: number,
  phase: number,
  color: number,
  r = 2.3,
): void {
  if (mag < 0.02) return;
  const lanes = [-0.85, -0.5, -0.17, 0.17, 0.5, 0.85];
  const n = FLOW_DOTS_MAX;
  for (let li = 0; li < lanes.length; li++) {
    const u = lanes[li]!;
    for (let i = 0; i < n; i++) {
      const present = dotPresence(i, mag);
      if (present <= 0) continue;
      // stagger lanes so the dots read as a stream, not a marching grid
      const t =
        (((i / n + (li / lanes.length) * 0.5 + phase * FLOW_SPEED * dir) % 1) +
          1) %
        1;
      const x = xFrom + (xTo - xFrom) * t;
      // available half-height funnels from pipeHH (outside the throat) to gapHalf (at
      // the gate), so every lane is pulled through the gap and released past it.
      const k = Math.min(1, Math.abs(x - gateX) / throat);
      const hAvail = gapHalf + (pipeHH - gapHalf) * k;
      g.circle(x, cy + u * hAvail, r * (0.72 + 0.28 * k)).fill({
        color,
        alpha: (0.28 + 0.5 * mag) * present,
      });
    }
  }
}

// --- machine furniture --------------------------------------------------------

// Whether stud() actually paints. On the board the illustration's decorative studs
// are redundant with (and offset from) the real pin dots the wires meet, so the
// board hides them while the info panel keeps them (it has no separate pins). A
// module flag like glyphs.ts's `currentStyle`: set immediately before each tier
// draw and read synchronously (single-threaded), so no per-call plumbing.
let studsVisible = true;
export function setStudsVisible(v: boolean): void {
  studsVisible = v;
}

/** A terminal stud (dark disc + coloured core), the factory-style pin marker.
 * A no-op while studs are hidden (see {@link setStudsVisible}). */
export function stud(g: Graphics, x: number, y: number, color: number): void {
  if (!studsVisible) return;
  g.circle(x, y, 5).fill({ color: 0x101820 });
  g.circle(x, y, 5).stroke({ width: 1.5, color });
  g.circle(x, y, 2.4).fill({ color });
}

/** A factory machine-housing panel: dark body, accent edge, top depth highlight. */
export function housing(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  radius = 6,
): void {
  g.roundRect(x - 2, y - 2, w + 4, h + 4, radius + 2).stroke({
    width: 3,
    color: 0x0c0f16,
  });
  g.roundRect(x, y, w, h, radius).fill({ color: 0x191324, alpha: 0.97 });
  g.roundRect(x, y, w, h, radius).stroke({ width: 2, color, alpha: 0.9 });
  g.moveTo(x + 6, y + 4)
    .lineTo(x + w - 6, y + 4)
    .stroke({ width: 1.4, color, alpha: 0.32 });
}

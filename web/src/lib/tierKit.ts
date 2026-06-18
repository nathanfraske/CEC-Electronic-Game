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
import { type AcReadout, type ElectricalState } from "./glyphs";

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

// --- high-frequency AC render (the carrier→shimmer handoff) -------------------
//
// docs/ui/high-frequency-render.md: slow current reads as carriers sloshing, but
// once the cycle rate outruns the eye (~10–15 Hz) animating every reversal aliases
// into jitter. The fix is a frequency-driven BLUR FACTOR that hands the discrete
// carriers off to a soft shimmer band whose thickness rides |I| — magnitude on
// thickness/alpha, never speed (visual-language). `b` comes from the apparent rate,
// not the solver clock, so it is pure presentation and frequency-stable.

/** Apparent-rate band below which flow reads as discrete carriers (Hz). */
export const AC_SHIMMER_LO = 15;
/** Apparent rate above which flow reads as a pure shimmer band (Hz). */
export const AC_SHIMMER_HI = 300;
// Faint shimmer vibration rate on the bounded phase — a "too fast to resolve" wobble,
// NOT a real cycle (it never tracks the signal frequency).
const SHIMMER_K = 9.0;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * The blur factor `b ∈ [0,1]` for an apparent cycle rate `freq` (Hz): a smoothstep
 * from discrete carriers (`b → 0` below {@link AC_SHIMMER_LO}) to a full shimmer band
 * (`b → 1` above {@link AC_SHIMMER_HI}). The single knob behind {@link shimmerFlow}.
 */
export function blurFactor(freq: number): number {
  const t = clamp01((freq - AC_SHIMMER_LO) / (AC_SHIMMER_HI - AC_SHIMMER_LO));
  return t * t * (3 - 2 * t);
}

/**
 * Flow along a straight segment that HANDS OFF from discrete carriers to a shimmer
 * band as the blur factor `b` rises — the high-frequency render of {@link belt}. At
 * `b = 0` it is byte-for-byte a `belt` (sloshing carriers, density + alpha riding
 * `mag`); as `b → 1` the carriers fatten and fade out while a soft glow band fades in,
 * its half-thickness tracking `mag` (the current amplitude) with a faint fast vibration
 * on the bounded `phase`. So a fast-AC branch reads as a calm glowing band instead of
 * aliased strobing dots. `b` is `blurFactor(apparent_freq)`; `dir` (+1/−1) is travel.
 */
export function shimmerFlow(
  g: Graphics,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  mag: number,
  b: number,
  dir: number,
  phase: number,
  color: number,
  r = 2.4,
): void {
  if (mag < 0.02) return;
  const blur = clamp01(b);
  // Carriers: fade out and fatten as the band takes over (skip once fully blurred).
  if (blur < 0.98) {
    const n = FLOW_DOTS_MAX;
    for (let i = 0; i < n; i++) {
      const present = dotPresence(i, mag);
      if (present <= 0) continue;
      const t = (((i / n + phase * FLOW_SPEED * dir) % 1) + 1) % 1;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      g.circle(x, y, r + blur * r * 1.6).fill({
        color,
        alpha: (0.35 + 0.55 * mag) * present * (1 - blur),
      });
    }
  }
  // Shimmer band: a soft glow whose half-thickness tracks |I|, with a faint vibration.
  if (blur > 0.02) {
    const vib = 0.85 + 0.15 * Math.sin(phase * SHIMMER_K);
    const half = (r + r * 2.0 * mag) * vib;
    g.moveTo(ax, ay)
      .lineTo(bx, by)
      .stroke({
        width: 2 * half,
        color,
        alpha: blur * (0.1 + 0.16 * mag),
        cap: "round",
      });
    g.moveTo(ax, ay)
      .lineTo(bx, by)
      .stroke({
        width: Math.max(1, half * 0.7),
        color,
        alpha: blur * (0.2 + 0.32 * mag),
        cap: "round",
      });
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

/** An arc-length sampler over a polyline: `at(d)` returns the point `d` pixels along. */
function arcSampler(pts: { x: number; y: number }[]): {
  total: number;
  at: (d: number) => { x: number; y: number };
} {
  const cum = [0];
  for (let i = 0; i < pts.length - 1; i++) {
    cum.push(
      cum[i]! +
        Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y),
    );
  }
  const total = cum[cum.length - 1]!;
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
    return pts[pts.length - 1] ?? { x: 0, y: 0 };
  };
  return { total, at };
}

/**
 * The general PROPORTIONAL-SPLIT flow: carriers stream IN along `inPath` to its end (a
 * junction), then continue down one of the `exits` — each carrier committed to an exit
 * in proportion to that exit's `weight` (its share of the current). So the split is
 * VISIBLE: more carriers take the higher-current exit, and you watch a tap (the POT
 * wiper, a divider) STEAL its share off the main run as you change it. Density rides the
 * total in-current `mag`; motion is on the bounded `phase` (never speed). Zero-weight
 * exits get nothing; if every weight is ~0 it draws nothing.
 *
 * The reusable framework for "particles go to the exits proportionally": feed it the
 * per-leg currents from {@link ElectricalState.legs} as the exit weights.
 */
export function flowSplit(
  g: Graphics,
  inPath: { x: number; y: number }[],
  exits: { path: { x: number; y: number }[]; weight: number }[],
  mag: number,
  dir: number,
  phase: number,
  color: number,
  r = 2.4,
): void {
  if (mag < 0.02 || exits.length === 0 || inPath.length < 1) return;
  const weights = exits.map((e) => Math.max(0, e.weight));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 1e-9) return;
  // cumulative fractions partition the carriers among the exits by weight
  const cumFrac: number[] = [];
  let acc = 0;
  for (const w of weights) {
    acc += w / total;
    cumFrac.push(acc);
  }
  // an arc-length sampler over each full route (the shared inPath + that exit)
  const routes = exits.map((e) => arcSampler([...inPath, ...e.path]));
  const n = FLOW_DOTS_MAX * 2;
  for (let k = 0; k < n; k++) {
    const present = dotPresence(Math.floor((k * FLOW_DOTS_MAX) / n), mag);
    if (present <= 0) continue;
    const lane = (k + 0.5) / n;
    let ei = 0;
    while (ei < cumFrac.length - 1 && lane > cumFrac[ei]!) ei++;
    const route = routes[ei]!;
    const t = (((k / n + phase * FLOW_SPEED * dir) % 1) + 1) % 1;
    const p = route.at(t * route.total);
    g.circle(p.x, p.y, r).fill({ color, alpha: (0.3 + 0.5 * mag) * present });
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

/**
 * A y-deflection in [-1, 1] that steers a carrier AROUND a row of obstacles: every
 * obstacle it passes shoves it to the far side (relative to the channel centre `cy`),
 * so a stream multiplied by this slaloms between the obstacles — the picture of carriers
 * scattering off a lattice, which IS resistance. Sum of signed Gaussian bumps (cheap; far
 * obstacles skipped). Multiply the result by the amplitude you want.
 */
export function scatterY(
  x: number,
  obstacles: { x: number; y: number }[],
  spread: number,
  cy = 0,
): number {
  let dy = 0;
  for (const ob of obstacles) {
    const dx = (x - ob.x) / spread;
    if (dx < -3 || dx > 3) continue;
    dy += (ob.y <= cy ? 1 : -1) * Math.exp(-dx * dx);
  }
  return Math.max(-1, Math.min(1, dy));
}

// --- machine furniture --------------------------------------------------------

/** Steel wall colour of a pipe (mirrors the board's wire-conduit wall, PIPE_WALL). */
export const PIPE_STEEL = 0x6b6488;

/**
 * A PIPE-style lead along a polyline: a steel wall stroke + a coloured core + flowing
 * carrier dots when `mag` > 0 — so a part's terminal reads as a continuous flowing pipe
 * that meets the board's wire-pipes, instead of a thin schematic line that looks broken
 * off from the system. `dir` is the flow sense along the path (+1 = pts[0]→last).
 */
export function pipeLead(
  g: Graphics,
  pts: { x: number; y: number }[],
  width: number,
  core: number,
  water: number,
  mag: number,
  dir: number,
  phase: number,
): void {
  if (pts.length < 2) return;
  const trace = (w: number, c: number, a: number): void => {
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
    g.stroke({ width: w, color: c, alpha: a, cap: "round", join: "round" });
  };
  trace(width + 4, PIPE_STEEL, 0.45); // wall
  trace(width, core, 0.3); // voltage-tinted core
  if (mag > 0.02) flowAlongPath(g, pts, mag, dir, phase, water, 2.2);
}

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

// --- phasor inset (the V–I clock with phosphor persistence) -------------------
//
// docs/ui/high-frequency-render.md ch.3: the one frequency-stable picture of the V–I
// relationship. Two arrows on a dial — V (warm) and I (cyan) — turning at a COSMETIC
// fixed rate; the physics is the LENGTHS (amplitudes) and the ANGLE between them (the
// phase the reactance adds, which opens past the reactive corner). The I tip leaves a
// decaying phosphor trail, so you read current lead/lag at a glance. It reads the same
// at 1 Hz and 1 MHz — frequency-agnostic by construction.

const PHASOR_V = 0xd8a24a; // warm rail tone for voltage
const PHASOR_I = 0x46d2e6; // cyan for current (mirrors the board V/I language)
const PHASOR_SPIN = 1.1; // cosmetic dial rotation per unit bounded phase
const PHASOR_TRAIL = 7; // fading samples behind the I tip
const PHASOR_TRAIL_DANG = 0.17; // angular spacing of the phosphor trail (rad)

/** A vector arrow from `(cx,cy)` at angle `ang`, length `len`, with a small head. */
function phasorArrow(
  g: Graphics,
  cx: number,
  cy: number,
  ang: number,
  len: number,
  color: number,
  width: number,
): void {
  const tx = cx + Math.cos(ang) * len;
  const ty = cy + Math.sin(ang) * len;
  g.moveTo(cx, cy).lineTo(tx, ty).stroke({
    width,
    color,
    alpha: 0.95,
    cap: "round",
  });
  const head = Math.min(8, len * 0.32);
  for (const s of [-1, 1]) {
    const ha = ang + Math.PI + s * 0.42;
    g.moveTo(tx, ty)
      .lineTo(tx + Math.cos(ha) * head, ty + Math.sin(ha) * head)
      .stroke({ width, color, alpha: 0.95, cap: "round" });
  }
}

/** A filled pie wedge from angle `a0` to `a1` (shortest sweep) — the phase arc. */
function phasorWedge(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  color: number,
  alpha: number,
): void {
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const steps = Math.max(2, Math.round(Math.abs(d) / 0.2));
  const pts: number[] = [cx, cy];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + d * (i / steps);
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.poly(pts, true).fill({ color, alpha });
}

/**
 * The phasor inset: a dial at `(cx,cy)` radius `radius` showing the V (warm) and I
 * (cyan) vectors for an {@link AcReadout}. Arrow lengths ride the AC amplitudes (with a
 * visible floor so both always show); the angle between them is the measured V–I phase
 * (`>0` current lags = inductive, `<0` leads = capacitive); a filled arc fills that
 * phase; and the I tip drags a decaying phosphor trail. The whole dial turns at a
 * cosmetic, frequency-agnostic rate on the bounded `phase`, so motion never encodes
 * magnitude — a pure function of (`ac`, `phase`) that rewinds with the clock.
 */
export function phasorInset(
  g: Graphics,
  cx: number,
  cy: number,
  radius: number,
  ac: AcReadout,
  phase: number,
): void {
  // Dial: bezel + tick ring.
  g.circle(cx, cy, radius).fill({ color: 0x0c0f16, alpha: 0.82 });
  g.circle(cx, cy, radius).stroke({ width: 1.6, color: 0x2a2440, alpha: 0.95 });
  for (const ang of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    g.moveTo(
      cx + Math.cos(ang) * radius * 0.86,
      cy + Math.sin(ang) * radius * 0.86,
    )
      .lineTo(
        cx + Math.cos(ang) * radius * 0.98,
        cy + Math.sin(ang) * radius * 0.98,
      )
      .stroke({ width: 1, color: 0x3a3358, alpha: 0.75 });
  }

  // Amplitudes → arrow lengths (visible floor; the angle carries the physics).
  const vlen = radius * (0.34 + 0.6 * norm(ac.vamp, V_SCALE));
  const ilen = radius * (0.34 + 0.6 * norm(ac.iamp, CUR_SCALE));
  const spin = phase * PHASOR_SPIN; // cosmetic rotation
  const thV = spin;
  const thI = spin - ac.phase; // I lags V by the measured phase

  // The phase arc (fills the V→I angle); fades up with the reactive content.
  phasorWedge(
    g,
    cx,
    cy,
    radius * 0.3,
    thV,
    thI,
    mix(PHASOR_V, PHASOR_I, 0.5),
    0.22,
  );

  // Phosphor trail: the I tip's recent positions (a fixed-length history of a value-
  // derived point → deterministic, rewinds with `phase`), decaying alpha.
  for (let k = PHASOR_TRAIL; k >= 1; k--) {
    const th = thI - k * PHASOR_TRAIL_DANG;
    const a = 0.5 * (1 - k / (PHASOR_TRAIL + 1));
    g.circle(cx + Math.cos(th) * ilen, cy + Math.sin(th) * ilen, 2.0).fill({
      color: PHASOR_I,
      alpha: a,
    });
  }

  phasorArrow(g, cx, cy, thV, vlen, PHASOR_V, 2.4);
  phasorArrow(g, cx, cy, thI, ilen, PHASOR_I, 2.4);
  g.circle(cx, cy, 2.4).fill({ color: 0xbfb8d8 }); // hub
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

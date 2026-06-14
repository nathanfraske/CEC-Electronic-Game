// SPDX-License-Identifier: Apache-2.0
// Animated component symbols. Each part draws its schematic glyph plus a
// state-driven animation — current flow, charge fill, field halo — into a
// Graphics. Pure presentation: it reads an ElectricalState and a free-running
// phase. The electrical numbers are fed from the solver; until a circuit is
// solved they sit near zero and the glyphs idle quietly.

import { Graphics } from "pixi.js";

/** Per-element electrical readout used to drive the animation. */
export interface ElectricalState {
  /** Amps through the element, signed in the a→b direction. */
  current: number;
  /** Volts across the element, V(a) − V(b). */
  vAcross: number;
}

export const ZERO_ELECTRICAL: ElectricalState = { current: 0, vAcross: 0 };

export interface GlyphPin {
  x: number;
  y: number;
}

export interface GlyphOpts {
  kind: string;
  pins: GlyphPin[];
  /** Footprint in pixels (for the fallback card). */
  wPx: number;
  hPx: number;
  color: number;
  electrical: ElectricalState;
  /** Free-running animation phase (seconds). */
  phase: number;
}

// Saturating normalize: maps a magnitude to 0..1 with a soft knee at `scale`.
function norm(x: number, scale: number): number {
  const a = Math.abs(x) / scale;
  return a / (1 + a);
}

const CUR_SCALE = 0.02; // ~20 mA reads as a strong signal
const V_SCALE = 6; // ~6 V reads as a strong field

/** Draw flowing dots along a straight segment to show current direction/amount. */
function flow(
  g: Graphics,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  current: number,
  phase: number,
  color: number,
): void {
  const mag = norm(current, CUR_SCALE);
  if (mag < 0.02) return;
  const dir = current >= 0 ? 1 : -1;
  const n = 4;
  const speed = 0.15 + mag * 0.9;
  for (let i = 0; i < n; i++) {
    const t = (((i / n + phase * speed * dir) % 1) + 1) % 1;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    g.circle(x, y, 1.7).fill({ color, alpha: 0.35 + 0.55 * mag });
  }
}

function drawV(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const r = 11;
  const lit = norm(o.electrical.vAcross || 5, V_SCALE);
  // pulsing energy ring
  const pulse = 0.5 + 0.5 * Math.sin(o.phase * 2.2);
  g.circle(mx, my, r + 5).stroke({
    width: 2,
    color: o.color,
    alpha: (0.12 + 0.3 * lit) * (0.5 + 0.5 * pulse),
  });
  // leads
  g.moveTo(a.x, a.y).lineTo(mx - r, my);
  g.moveTo(mx + r, my).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  // body
  g.circle(mx, my, r).fill({ color: 0x161020, alpha: 0.95 });
  g.circle(mx, my, r).stroke({ width: 1.6, color: o.color, alpha: 0.95 });
  // battery bars: long plate (+) toward pin a, short plate (−) toward pin b
  g.moveTo(mx - 3, my - 6).lineTo(mx - 3, my + 6);
  g.stroke({ width: 2, color: o.color, alpha: 0.95 });
  g.moveTo(mx + 3, my - 3.5).lineTo(mx + 3, my + 3.5);
  g.stroke({ width: 3, color: o.color, alpha: 0.95 });
  flow(g, a.x, a.y, mx - r, my, o.electrical.current, o.phase, o.color);
  flow(g, mx + r, my, b.x, b.y, o.electrical.current, o.phase, o.color);
}

function drawR(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const x0 = a.x + 10;
  const x1 = b.x - 10;
  const amp = 7;
  const heat = norm(o.electrical.current, CUR_SCALE);
  // heat halo
  if (heat > 0.03) {
    g.roundRect(x0 - 2, a.y - amp - 4, x1 - x0 + 4, 2 * amp + 8, 5).fill({
      color: 0xe0533a,
      alpha: 0.16 * heat,
    });
  }
  // leads
  g.moveTo(a.x, a.y).lineTo(x0, a.y);
  g.moveTo(x1, b.y).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  // zigzag body
  const segs = 6;
  g.moveTo(x0, a.y);
  for (let i = 0; i < segs; i++) {
    const x = x0 + ((i + 0.5) / segs) * (x1 - x0);
    const y = a.y + (i % 2 === 0 ? -amp : amp);
    g.lineTo(x, y);
  }
  g.lineTo(x1, b.y);
  g.stroke({ width: 2.2, color: o.color, alpha: 0.95 });
  flow(g, x0, a.y, x1, b.y, o.electrical.current, o.phase, 0x46d2e6);
}

function drawC(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const gap = 5;
  const ph = 13; // half plate height
  const charge = norm(o.electrical.vAcross, V_SCALE);
  // dielectric field glow between the plates, grows with voltage
  if (charge > 0.02) {
    g.roundRect(mx - gap, my - ph, 2 * gap, 2 * ph, 2).fill({
      color: o.color,
      alpha: 0.5 * charge,
    });
  }
  // leads
  g.moveTo(a.x, a.y).lineTo(mx - gap, my);
  g.moveTo(mx + gap, my).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  // plates
  g.moveTo(mx - gap, my - ph).lineTo(mx - gap, my + ph);
  g.moveTo(mx + gap, my - ph).lineTo(mx + gap, my + ph);
  g.stroke({ width: 2.4, color: o.color, alpha: 0.95 });
  // charge shimmer dots between plates
  if (charge > 0.05) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const t = (((i / n + o.phase * 0.6) % 1) + 1) % 1;
      g.circle(
        mx - gap + 2 * gap * t,
        my - ph + (2 * ph * ((i * 7) % 5)) / 5,
        1.2,
      ).fill({ color: 0xffffff, alpha: 0.25 * charge });
    }
  }
  flow(g, a.x, a.y, mx - gap, my, o.electrical.current, o.phase, 0x46d2e6);
}

function drawL(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const x0 = a.x + 8;
  const x1 = b.x - 8;
  const loops = 4;
  const rr = (x1 - x0) / (loops * 2);
  const field = norm(o.electrical.current, CUR_SCALE);
  // breathing field halo
  if (field > 0.02) {
    const s = 1 + 0.12 * Math.sin(o.phase * 3);
    g.ellipse((x0 + x1) / 2, a.y, ((x1 - x0) / 2) * 1.1 * s, 16 * s).fill({
      color: 0x8a95f2,
      alpha: 0.16 * field,
    });
  }
  // leads
  g.moveTo(a.x, a.y).lineTo(x0, a.y);
  g.moveTo(x1, b.y).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  // coil: a row of half-circle bumps
  for (let i = 0; i < loops; i++) {
    const cx = x0 + rr * (2 * i + 1);
    g.arc(cx, a.y, rr, Math.PI, 0, false);
  }
  g.stroke({ width: 2.2, color: o.color, alpha: 0.95 });
  flow(g, x0, a.y, x1, b.y, o.electrical.current, o.phase, 0x46d2e6);
}

function drawCard(g: Graphics, o: GlyphOpts): void {
  const w = o.wPx;
  const h = o.hPx;
  g.roundRect(-10, -10, w + 20, h + 20, 4).fill({
    color: 0x16121f,
    alpha: 0.92,
  });
  g.roundRect(-10, -10, w + 20, h + 20, 4).stroke({
    width: 1.5,
    color: o.color,
    alpha: 0.85,
  });
  g.moveTo(-10, -10).lineTo(-10, h + 10);
  g.stroke({ width: 2, color: o.color, alpha: 0.95 });
}

const DRAWERS: Record<string, (g: Graphics, o: GlyphOpts) => void> = {
  V: drawV,
  R: drawR,
  C: drawC,
  L: drawL,
};

/** Returns true if the kind draws a schematic symbol (vs. a fallback card). */
export function isSymbol(kind: string): boolean {
  return kind in DRAWERS;
}

/** Draw a component's glyph + state animation into the (pre-cleared) Graphics. */
export function drawGlyph(g: Graphics, o: GlyphOpts): void {
  const drawer = DRAWERS[o.kind];
  if (drawer) drawer(g, o);
  else drawCard(g, o);
}

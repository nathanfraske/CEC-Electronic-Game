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

function drawI(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const r = 11;
  // The current source's strength is its (forced) current, so the arrow and the
  // halo track |current| rather than voltage. Sign sets the arrow direction:
  // positive current is delivered a -> b (matches the sim-core stamp).
  const drive = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1;
  // pulsing energy ring, like the voltage source but keyed to current
  const pulse = 0.5 + 0.5 * Math.sin(o.phase * 2.2);
  g.circle(mx, my, r + 5).stroke({
    width: 2,
    color: o.color,
    alpha: (0.12 + 0.3 * drive) * (0.5 + 0.5 * pulse),
  });
  // leads
  g.moveTo(a.x, a.y).lineTo(mx - r, my);
  g.moveTo(mx + r, my).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  // body
  g.circle(mx, my, r).fill({ color: 0x161020, alpha: 0.95 });
  g.circle(mx, my, r).stroke({ width: 1.6, color: o.color, alpha: 0.95 });
  // arrow through the circle, pointing in the conventional-current direction
  const ax = r - 5; // arrow half-length inside the body
  const tipX = mx + dir * ax;
  const tailX = mx - dir * ax;
  const head = 4;
  g.moveTo(tailX, my).lineTo(tipX, my);
  g.moveTo(tipX, my)
    .lineTo(tipX - dir * head, my - head)
    .moveTo(tipX, my)
    .lineTo(tipX - dir * head, my + head);
  g.stroke({
    width: 2.2,
    color: o.color,
    alpha: 0.7 + 0.25 * drive,
  });
  flow(g, a.x, a.y, mx - r, my, o.electrical.current, o.phase, o.color);
  flow(g, mx + r, my, b.x, b.y, o.electrical.current, o.phase, o.color);
}

function drawGND(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  if (!a) return;
  // A single pin drops to the classic three-bar ground symbol (⏚). No current
  // flows "through" a reference, so it has no flow animation; a faint pull keyed
  // to how far its net sits from 0 V hints when something is wired wrong.
  const drop = 9; // lead length down from the pin
  const topY = a.y + drop;
  const off = norm(o.electrical.vAcross, V_SCALE);
  // lead
  g.moveTo(a.x, a.y).lineTo(a.x, topY);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  // three shrinking horizontal bars
  const bars = [
    { w: 11, y: topY },
    { w: 7, y: topY + 4 },
    { w: 3, y: topY + 8 },
  ];
  for (const bar of bars) {
    g.moveTo(a.x - bar.w, bar.y).lineTo(a.x + bar.w, bar.y);
  }
  g.stroke({ width: 2.2, color: o.color, alpha: 0.9 });
  // a soft warning glow if this "ground" is somehow not at 0 V
  if (off > 0.05) {
    g.circle(a.x, topY + 4, 13).stroke({
      width: 1.5,
      color: 0xe0533a,
      alpha: 0.3 * off,
    });
  }
}

function drawAC(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const r = 11;
  // The classic AC symbol: a circle with a sine inside. A ring keyed to the
  // instantaneous output pulses; the leads carry the (reversing) current.
  const lvl = norm(o.electrical.vAcross, V_SCALE);
  const pulse = 0.5 + 0.5 * Math.sin(o.phase * 2.2);
  g.circle(mx, my, r + 5).stroke({
    width: 2,
    color: o.color,
    alpha: (0.12 + 0.4 * lvl) * (0.5 + 0.5 * pulse),
  });
  g.moveTo(a.x, a.y).lineTo(mx - r, my);
  g.moveTo(mx + r, my).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  g.circle(mx, my, r).fill({ color: 0x161020, alpha: 0.95 });
  g.circle(mx, my, r).stroke({ width: 1.6, color: o.color, alpha: 0.95 });
  // sine wave inside the body
  const sw = 7;
  const amp = 4;
  g.moveTo(mx - sw, my);
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    g.lineTo(mx - sw + 2 * sw * t, my - amp * Math.sin(t * Math.PI * 2));
  }
  g.stroke({ width: 1.6, color: o.color, alpha: 0.95 });
  flow(g, a.x, a.y, mx - r, my, o.electrical.current, o.phase, o.color);
  flow(g, mx + r, my, b.x, b.y, o.electrical.current, o.phase, o.color);
}

function drawD(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const s = 8;
  // A diode only conducts forward (anode a -> cathode b): the glow + flow track
  // the positive current, so it lights up when forward-biased and goes dark when
  // it blocks.
  const cond = norm(Math.max(0, o.electrical.current), CUR_SCALE);
  if (cond > 0.03) {
    g.circle(mx, my, 13).fill({ color: o.color, alpha: 0.2 * cond });
  }
  // leads
  g.moveTo(a.x, a.y).lineTo(mx - s, my);
  g.moveTo(mx + s, my).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  // triangle pointing from anode to cathode
  g.poly([mx - s, my - s, mx + s, my, mx - s, my + s]).fill({
    color: 0x161020,
    alpha: 0.95,
  });
  g.poly([mx - s, my - s, mx + s, my, mx - s, my + s]).stroke({
    width: 1.8,
    color: o.color,
    alpha: 0.95,
  });
  // cathode bar
  g.moveTo(mx + s, my - s).lineTo(mx + s, my + s);
  g.stroke({ width: 2.4, color: o.color, alpha: 0.95 });
  flow(
    g,
    a.x,
    a.y,
    mx - s,
    my,
    Math.max(0, o.electrical.current),
    o.phase,
    0x46d2e6,
  );
  flow(
    g,
    mx + s,
    my,
    b.x,
    b.y,
    Math.max(0, o.electrical.current),
    o.phase,
    0x46d2e6,
  );
}

function drawSW(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const gap = 9;
  // Read the switch state off the simulation: closed drops ~0 V across it, open
  // stands the full node difference. The lever flicks up/down as it switches.
  const closed = Math.abs(o.electrical.vAcross) < 0.25;
  g.moveTo(a.x, a.y).lineTo(mx - gap, my);
  g.moveTo(mx + gap, my).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  g.circle(mx - gap, my, 2).fill({ color: o.color });
  g.circle(mx + gap, my, 2).fill({ color: o.color });
  const tipX = closed ? mx + gap : mx + gap - 3;
  const tipY = closed ? my : my - 12;
  g.moveTo(mx - gap, my).lineTo(tipX, tipY);
  g.stroke({ width: 2.4, color: closed ? o.color : 0x9c93b8, alpha: 0.95 });
  if (closed) {
    const cond = norm(o.electrical.current, CUR_SCALE);
    if (cond > 0.03) {
      g.circle(mx, my, 12).fill({ color: o.color, alpha: 0.16 * cond });
    }
    flow(g, a.x, a.y, b.x, b.y, o.electrical.current, o.phase, o.color);
  }
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

// --- Factory style: components as machines/buildings (the Factorio lens) ------
// Same keys, same pin geometry, same animation helpers — only the body art
// changes, so wiring is identical across styles (see docs/ui/teaching-tools.md).

/** Lead stubs from the two pins to the building edges. */
function fLeads(g: Graphics, o: GlyphOpts, mx: number, hw: number): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  g.moveTo(a.x, a.y).lineTo(mx - hw, a.y);
  g.moveTo(mx + hw, b.y).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
}

/** A boxy machine body with a depth highlight along the top. */
function fBox(
  g: Graphics,
  mx: number,
  my: number,
  hw: number,
  hh: number,
  color: number,
): void {
  g.roundRect(mx - hw, my - hh, 2 * hw, 2 * hh, 3).fill({
    color: 0x161020,
    alpha: 0.96,
  });
  g.roundRect(mx - hw, my - hh, 2 * hw, 2 * hh, 3).stroke({
    width: 1.8,
    color,
    alpha: 0.95,
  });
  g.moveTo(mx - hw + 2, my - hh + 2)
    .lineTo(mx + hw - 2, my - hh + 2)
    .stroke({ width: 1.4, color, alpha: 0.4 });
}

function generator(g: Graphics, o: GlyphOpts, drive: number): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const hw = 13;
  fLeads(g, o, mx, hw);
  fBox(g, mx, my, hw, 11, o.color);
  const pulse = 0.5 + 0.5 * Math.sin(o.phase * 2.4);
  g.circle(mx, my, 5).fill({
    color: o.color,
    alpha: 0.4 + 0.55 * drive * pulse,
  });
  flow(g, a.x, a.y, mx - hw, my, o.electrical.current, o.phase, o.color);
  flow(g, mx + hw, my, b.x, b.y, o.electrical.current, o.phase, o.color);
}

function drawFV(g: Graphics, o: GlyphOpts): void {
  generator(g, o, norm(o.electrical.vAcross || 5, V_SCALE));
}
function drawFI(g: Graphics, o: GlyphOpts): void {
  generator(g, o, norm(o.electrical.current, CUR_SCALE));
}
function drawFAC(g: Graphics, o: GlyphOpts): void {
  generator(g, o, norm(o.electrical.vAcross, V_SCALE));
}

function drawFR(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const hw = 13;
  const heat = norm(o.electrical.current, CUR_SCALE);
  fLeads(g, o, mx, hw);
  fBox(g, mx, my, hw, 11, o.color);
  if (heat > 0.03) {
    g.roundRect(mx - hw, my - 11, 2 * hw, 22, 3).fill({
      color: 0xe0533a,
      alpha: 0.18 * heat,
    });
  }
  // a throat the belt squeezes through
  g.poly([mx - hw + 2, my - 8, mx - 3, my, mx - hw + 2, my + 8]).fill({
    color: o.color,
    alpha: 0.3,
  });
  g.poly([mx + hw - 2, my - 8, mx + 3, my, mx + hw - 2, my + 8]).fill({
    color: o.color,
    alpha: 0.3,
  });
  flow(g, mx - hw, my, mx + hw, my, o.electrical.current, o.phase, 0x46d2e6);
}

function drawFC(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const hw = 13;
  const hh = 12;
  fLeads(g, o, mx, hw);
  fBox(g, mx, my, hw, hh, o.color);
  // a buffer chest that fills with the charge level
  const charge = norm(o.electrical.vAcross, V_SCALE);
  const fillH = 2 * (hh - 3) * charge;
  if (fillH > 0.5) {
    g.roundRect(mx - hw + 3, my + hh - 3 - fillH, 2 * (hw - 3), fillH, 1).fill({
      color: o.color,
      alpha: 0.55,
    });
  }
}

function drawFL(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const hw = 13;
  fLeads(g, o, mx, hw);
  fBox(g, mx, my, hw, 12, o.color);
  // a flywheel whose spokes spin faster with more current
  const spin = norm(o.electrical.current, CUR_SCALE);
  const ang = o.phase * (1 + spin * 6);
  g.circle(mx, my, 7).stroke({ width: 1.4, color: o.color, alpha: 0.8 });
  for (let i = 0; i < 4; i++) {
    const t = ang + (i * Math.PI) / 2;
    g.moveTo(mx, my).lineTo(mx + 7 * Math.cos(t), my + 7 * Math.sin(t));
  }
  g.stroke({ width: 1.6, color: o.color, alpha: 0.7 + 0.25 * spin });
  flow(g, a.x, a.y, mx - hw, my, o.electrical.current, o.phase, o.color);
  flow(g, mx + hw, my, b.x, b.y, o.electrical.current, o.phase, o.color);
}

function drawFD(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const hw = 13;
  const cond = norm(Math.max(0, o.electrical.current), CUR_SCALE);
  fLeads(g, o, mx, hw);
  fBox(g, mx, my, hw, 11, o.color);
  // a one-way conveyor gate, lit when it's passing
  g.poly([mx - 5, my - 6, mx + 5, my, mx - 5, my + 6]).fill({
    color: o.color,
    alpha: 0.3 + 0.6 * cond,
  });
  const fwd = Math.max(0, o.electrical.current);
  flow(g, a.x, a.y, mx - hw, my, fwd, o.phase, 0x46d2e6);
  flow(g, mx + hw, my, b.x, b.y, fwd, o.phase, 0x46d2e6);
}

function drawFSW(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const hw = 13;
  const closed = Math.abs(o.electrical.vAcross) < 0.25;
  fLeads(g, o, mx, hw);
  fBox(g, mx, my, hw, 11, o.color);
  // a door: shut (solid panel) when closed, ajar when open
  if (closed) {
    g.rect(mx - 6, my - 7, 12, 14).fill({ color: o.color, alpha: 0.35 });
    flow(g, mx - hw, my, mx + hw, my, o.electrical.current, o.phase, o.color);
  } else {
    g.poly([
      mx - 6,
      my - 7,
      mx + 2,
      my - 9,
      mx + 2,
      my + 5,
      mx - 6,
      my + 7,
    ]).fill({ color: 0x9c93b8, alpha: 0.3 });
  }
}

function drawFGND(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  if (!a) return;
  // a drain grate the return belt pours into
  const topY = a.y + 9;
  g.moveTo(a.x, a.y).lineTo(a.x, topY);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  g.rect(a.x - 10, topY, 20, 9).stroke({
    width: 1.8,
    color: o.color,
    alpha: 0.9,
  });
  for (let i = -2; i <= 2; i++) {
    g.moveTo(a.x + i * 4, topY + 1).lineTo(a.x + i * 4, topY + 8);
  }
  g.stroke({ width: 1.2, color: o.color, alpha: 0.55 });
}

const DRAWERS: Record<string, (g: Graphics, o: GlyphOpts) => void> = {
  V: drawV,
  R: drawR,
  C: drawC,
  L: drawL,
  I: drawI,
  AC: drawAC,
  GND: drawGND,
  D: drawD,
  SW: drawSW,
};

const FACTORY_DRAWERS: Record<string, (g: Graphics, o: GlyphOpts) => void> = {
  V: drawFV,
  R: drawFR,
  C: drawFC,
  L: drawFL,
  I: drawFI,
  AC: drawFAC,
  GND: drawFGND,
  D: drawFD,
  SW: drawFSW,
};

/** Component art style: real schematic symbols, or Factorio-ish machines. */
export type GlyphStyle = "schematic" | "factory";
let currentStyle: GlyphStyle = "schematic";
export function setGlyphStyle(s: GlyphStyle): void {
  currentStyle = s;
}

/** Returns true if the kind draws a schematic symbol (vs. a fallback card). */
export function isSymbol(kind: string): boolean {
  return kind in DRAWERS;
}

/** Draw a component's glyph + state animation into the (pre-cleared) Graphics,
 * in the active style (schematic symbols, or the Factory machine lens). */
export function drawGlyph(g: Graphics, o: GlyphOpts): void {
  const map = currentStyle === "factory" ? FACTORY_DRAWERS : DRAWERS;
  const drawer = map[o.kind] ?? DRAWERS[o.kind];
  if (drawer) drawer(g, o);
  else drawCard(g, o);
}

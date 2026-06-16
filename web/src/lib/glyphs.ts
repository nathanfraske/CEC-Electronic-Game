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
  /**
   * The placed component's primary scalar (`Component.value`), when the live
   * renderer can supply it. Most glyphs read their state purely off `electrical`
   * and ignore this; the manual switch (MSW) uses it to draw open/closed directly
   * from its commanded state (1 = closed, 0 = open) rather than inferring it from
   * the voltage across — so a switch with no current still reads correctly.
   * Optional, so the placement ghost (which has no live value) can omit it.
   */
  value?: number;
  /**
   * The potentiometer's wiper position in `[0, 1]` ({@link Component.wiper}), so its
   * glyph can draw the wiper tap where it actually sits and slide it as the player
   * turns the knob. Only the POT reads it; other glyphs ignore it. Optional (the
   * placement ghost omits it → a centred wiper).
   */
  wiper?: number;
}

// Saturating normalize: maps a magnitude to 0..1 with a soft knee at `scale`.
function norm(x: number, scale: number): number {
  const a = Math.abs(x) / scale;
  return a / (1 + a);
}

const CUR_SCALE = 0.02; // ~20 mA reads as a strong signal
const V_SCALE = 6; // ~6 V reads as a strong field

// Flow legibility: magnitude is carried by DENSITY (dot count) + ALPHA, never by
// speed. `phase` is the board's bounded visual flow clock — a fixed wall-clock
// rate, sign-tracked to the timeline — so the recirculation rate is constant and
// readable (~0.3–1.5 visual Hz) no matter how large V/I are or how high the
// playback tps is. Speed-carries-magnitude was the old anti-pattern: it
// compounded with the tps-scaled phase and blew up (see docs/ui/visual-language.md).
const FLOW_SPEED = 1.0; // constant recirculation per unit phase (NOT magnitude-scaled)
const FLOW_DOTS_MIN = 2; // a sparse trickle even at the visibility threshold
const FLOW_DOTS_MAX = 6; // a dense stream at full current
// Breathing/spin clock: rides the same bounded phase so glows and rotations beat
// at a constant ~1.3 visual Hz (0.6 phase-Hz × 2.2). Magnitude rides alpha/scale
// amplitude, never the rate, so nothing speeds up as V/I climb.
const PULSE_K = 2.2;

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
  // Magnitude → density + alpha (speed stays constant): more current packs in more
  // dots and brightens them, but the belt always recirculates at the same calm rate.
  const n = FLOW_DOTS_MIN + Math.round((FLOW_DOTS_MAX - FLOW_DOTS_MIN) * mag);
  for (let i = 0; i < n; i++) {
    const t = (((i / n + phase * FLOW_SPEED * dir) % 1) + 1) % 1;
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
  const pulse = 0.5 + 0.5 * Math.sin(o.phase * PULSE_K);
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
    const s = 1 + 0.12 * Math.sin(o.phase * PULSE_K);
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
  const pulse = 0.5 + 0.5 * Math.sin(o.phase * PULSE_K);
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
  const pulse = 0.5 + 0.5 * Math.sin(o.phase * PULSE_K);
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

function drawSD(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const s = 8;
  // A Schottky is the same one-way valve as the silicon diode but with a much
  // lower forward knee, so it lights up earlier; the glow tracks the (positive)
  // forward current exactly like the diode — magnitude as alpha, never speed.
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
  // The distinctive Schottky cathode bar: a plain bar with the ends bent back
  // into little flags (an "S"/bracket on each end) — the standard symbol.
  const f = 4; // flag length
  g.moveTo(mx + s - f, my - s)
    .lineTo(mx + s, my - s)
    .lineTo(mx + s, my + s)
    .lineTo(mx + s - f, my + s);
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

function drawLED(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const s = 8;
  // The marquee onboarding part: it visibly LIGHTS UP. Brightness is a function
  // of the forward current (norm → 0..1), so it glows brighter as more current
  // flows and is dark when reverse-biased or off. A gentle breathing on the
  // bounded phase keeps it alive without coupling speed to magnitude.
  const lit = norm(Math.max(0, o.electrical.current), CUR_SCALE);
  if (lit > 0.01) {
    const breathe = 0.85 + 0.15 * Math.sin(o.phase * PULSE_K);
    // layered halo: a soft wide bloom + a tight bright core, both keyed to `lit`.
    g.circle(mx, my, 20).fill({ color: o.color, alpha: 0.22 * lit * breathe });
    g.circle(mx, my, 13).fill({ color: o.color, alpha: 0.38 * lit * breathe });
    g.circle(mx, my, 6).fill({
      color: 0xffffff,
      alpha: 0.3 * lit * breathe,
    });
  }
  // leads
  g.moveTo(a.x, a.y).lineTo(mx - s, my);
  g.moveTo(mx + s, my).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  // triangle + cathode bar, exactly like the diode
  g.poly([mx - s, my - s, mx + s, my, mx - s, my + s]).fill({
    color: 0x161020,
    alpha: 0.95,
  });
  g.poly([mx - s, my - s, mx + s, my, mx - s, my + s]).stroke({
    width: 1.8,
    color: o.color,
    alpha: 0.95,
  });
  g.moveTo(mx + s, my - s).lineTo(mx + s, my + s);
  g.stroke({ width: 2.4, color: o.color, alpha: 0.95 });
  // The two little arrows radiating away from the body — the "emitting light"
  // marker that distinguishes an LED from a plain diode. Their reach grows a
  // touch with brightness (alpha + length), but they never move.
  const reach = 7 + 4 * lit;
  for (let k = 0; k < 2; k++) {
    const ox = mx - 1 + k * 6; // two arrows offset along the top edge
    const sx = ox + 3;
    const sy = my - s - 2;
    const ex = sx + reach * 0.7;
    const ey = sy - reach;
    g.moveTo(sx, sy).lineTo(ex, ey);
    // arrowhead
    g.moveTo(ex, ey)
      .lineTo(ex - 3.2, ey + 1.2)
      .moveTo(ex, ey)
      .lineTo(ex - 1.2, ey + 3.2);
    g.stroke({ width: 1.4, color: o.color, alpha: 0.55 + 0.4 * lit });
  }
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

function drawZD(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const s = 8;
  // A Zener conducts BOTH ways, but for different reasons: forward (positive
  // a→b current) it is an ordinary diode; in reverse breakdown the current goes
  // negative (it sinks cathode→anode) and it clamps the node. Show forward
  // conduction with the warm diode glow, and breakdown with a cool reverse glow —
  // each keyed to its current magnitude as alpha, never speed.
  const fwd = norm(Math.max(0, o.electrical.current), CUR_SCALE);
  const rev = norm(Math.max(0, -o.electrical.current), CUR_SCALE);
  if (fwd > 0.03) {
    g.circle(mx, my, 13).fill({ color: o.color, alpha: 0.2 * fwd });
  }
  if (rev > 0.03) {
    // Breakdown: a cyan "clamp" bloom around the cathode bar — the reverse spill.
    g.circle(mx + s, my, 12).fill({ color: 0x46d2e6, alpha: 0.22 * rev });
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
  // The distinctive Zener cathode bar: a straight bar with the ends bent back
  // (the "Z" flag) — top end kicks forward, bottom end kicks back.
  const f = 4; // flag length
  g.moveTo(mx + s + f, my - s)
    .lineTo(mx + s, my - s)
    .lineTo(mx + s, my + s)
    .lineTo(mx + s - f, my + s);
  g.stroke({ width: 2.4, color: o.color, alpha: 0.95 });
  // Forward current streams anode→cathode; in breakdown the carriers run the
  // other way (cathode→anode), so feed `flow` the SIGNED current both legs.
  flow(g, a.x, a.y, mx - s, my, o.electrical.current, o.phase, 0x46d2e6);
  flow(g, mx + s, my, b.x, b.y, o.electrical.current, o.phase, 0x46d2e6);
}

function drawMOV(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const x0 = a.x + 10;
  const x1 = b.x - 10;
  const amp = 7;
  // A varistor is a *symmetric* voltage clamp: nearly open while |V| < Vc, then it
  // conducts hard in EITHER polarity to pin |V| near Vc and dump the surge. The
  // standard symbol is a resistor body with a diagonal arrow slashing through it.
  // It idles quietly below the clamp and lights up when it clamps, so — like the
  // Zener — drive the bloom off the (signed) clamp current rather than Vc (which
  // the glyph isn't handed): a symmetric clamp bloom whose alpha tracks |I|, with
  // the across-the-part field read on |V| so it brightens as the spike rises.
  const clamp = norm(o.electrical.current, CUR_SCALE);
  const field = norm(o.electrical.vAcross, V_SCALE);
  // The symmetric clamp bloom: a cyan "spill" wrapping the whole body when it
  // conducts (either direction), the watchable "dumping the surge" cue.
  if (clamp > 0.03) {
    g.roundRect(x0 - 4, my - amp - 6, x1 - x0 + 8, 2 * amp + 12, 6).fill({
      color: 0x46d2e6,
      alpha: 0.22 * clamp,
    });
  }
  // a faint warn-coloured field that grows with |V across| — the rising spike the
  // clamp is about to flatten (brightest just before it conducts).
  if (field > 0.02) {
    g.roundRect(x0 - 2, my - amp - 4, x1 - x0 + 4, 2 * amp + 8, 5).fill({
      color: o.color,
      alpha: 0.16 * field,
    });
  }
  // leads
  g.moveTo(a.x, a.y).lineTo(x0, a.y);
  g.moveTo(x1, b.y).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  // the resistor zigzag body (the varistor's voltage-dependent resistance)
  const segs = 6;
  g.moveTo(x0, a.y);
  for (let i = 0; i < segs; i++) {
    const x = x0 + ((i + 0.5) / segs) * (x1 - x0);
    const y = a.y + (i % 2 === 0 ? -amp : amp);
    g.lineTo(x, y);
  }
  g.lineTo(x1, b.y);
  g.stroke({ width: 2.2, color: o.color, alpha: 0.95 });
  // the diagonal arrow slashing through the body — the mark that says "this
  // resistance varies with voltage" (the VDR/MOV symbol).
  const dx0 = mx - amp - 2;
  const dy0 = my + amp + 4;
  const dx1 = mx + amp + 4;
  const dy1 = my - amp - 4;
  g.moveTo(dx0, dy0).lineTo(dx1, dy1);
  // arrowhead at the top-right tip
  const ah = 4;
  g.moveTo(dx1, dy1)
    .lineTo(dx1 - ah, dy1 + ah * 0.4)
    .moveTo(dx1, dy1)
    .lineTo(dx1 - ah * 0.4, dy1 + ah);
  g.stroke({ width: 1.8, color: o.color, alpha: 0.9 });
  // Signed flow on both legs: it sinks current a→b OR b→a depending on the surge
  // polarity, so feed `flow` the SIGNED current — the belt reverses with the spike.
  flow(g, a.x, a.y, x0, a.y, o.electrical.current, o.phase, 0x46d2e6);
  flow(g, x1, b.y, b.x, b.y, o.electrical.current, o.phase, 0x46d2e6);
}

function drawEC(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const gap = 5;
  const ph = 13; // half plate height
  // Polarized electrolytic: a straight plate (+, toward pin a) facing a CURVED
  // plate (−, toward pin b), with a "+" mark. It stores charge exactly like the
  // ceramic cap, so reuse the dielectric-fill animation keyed to its voltage.
  const charge = norm(o.electrical.vAcross, V_SCALE);
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
  // the straight (+) plate
  g.moveTo(mx - gap, my - ph).lineTo(mx - gap, my + ph);
  g.stroke({ width: 2.4, color: o.color, alpha: 0.95 });
  // the curved (−) plate: a shallow arc bowing away from the + plate
  g.moveTo(mx + gap, my - ph);
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const yy = my - ph + 2 * ph * t;
    const bow = 3 * Math.sin(t * Math.PI); // bulge outward at the middle
    g.lineTo(mx + gap + bow, yy);
  }
  g.stroke({ width: 2.4, color: o.color, alpha: 0.95 });
  // the "+" polarity mark above the + plate
  g.moveTo(mx - gap - 7, my - ph - 3)
    .lineTo(mx - gap - 3, my - ph - 3)
    .moveTo(mx - gap - 5, my - ph - 5)
    .lineTo(mx - gap - 5, my - ph - 1);
  g.stroke({ width: 1.4, color: o.color, alpha: 0.8 });
  // charge shimmer dots between the plates (constant rate; alpha = charge)
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

// Whether a switch glyph should read as CLOSED. The manual switch knows its own
// commanded state, so prefer `o.value` (≥ 0.5 = closed) when the live renderer
// supplied it — that way it reads correctly even with no current flowing (an open
// loop, or a closed switch carrying zero current). Falls back to the electrical
// inference the clock switch uses: a closed switch drops ~0 V, an open one stands
// the full node difference across itself.
function switchClosed(o: GlyphOpts): boolean {
  if (o.value !== undefined) return o.value >= 0.5;
  return Math.abs(o.electrical.vAcross) < 0.25;
}

function drawMSW(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const gap = 9;
  // The standard SPST switch: a hinged blade pivoting on the left contact. It
  // CLOSES flat onto the right contact at state ≥ 0.5 (conducting) and LIFTS OPEN
  // (the blade swings up off the contact) at state < 0.5 (the break). Hand-flipped
  // by the player — the state comes straight off `o.value`, so it reads right with
  // or without current.
  const closed = switchClosed(o);
  g.moveTo(a.x, a.y).lineTo(mx - gap, my);
  g.moveTo(mx + gap, my).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  // the two fixed contacts (the pivot on the left, the landing pad on the right)
  g.circle(mx - gap, my, 2.4).fill({ color: o.color });
  g.circle(mx + gap, my, 2.4).fill({ color: o.color });
  // the hinged blade: lands on the right contact when closed, lifts well clear
  // (a wider, more obvious swing than the clock switch) when open.
  const tipX = closed ? mx + gap : mx + gap - 4;
  const tipY = closed ? my : my - 14;
  g.moveTo(mx - gap, my).lineTo(tipX, tipY);
  g.stroke({ width: 2.6, color: closed ? o.color : 0x9c93b8, alpha: 0.95 });
  if (closed) {
    // a near-ideal wire: a conduction glow + the flowing belt across the contacts.
    const cond = norm(o.electrical.current, CUR_SCALE);
    if (cond > 0.03) {
      g.circle(mx, my, 12).fill({ color: o.color, alpha: 0.16 * cond });
    }
    flow(g, a.x, a.y, b.x, b.y, o.electrical.current, o.phase, o.color);
  } else {
    // a visible break in the line when open — a small gap mark at the contact the
    // blade has lifted off, so "open = no path" reads at a glance.
    g.circle(mx + gap, my, 4.5).stroke({
      width: 1.4,
      color: 0x9c93b8,
      alpha: 0.5,
    });
  }
}

// --- MOSFET (3-terminal) ------------------------------------------------------
// Pins are ordered D, S, G: pin 0 = Drain (top), pin 1 = Source (bottom),
// pin 2 = Gate (left). `electrical.current` is Id oriented a→b = drain→source;
// `electrical.vAcross` is Vds. The schematic draws the standard enhancement-mode
// symbol — an insulated gate bar set off a broken channel, drain up / source down
// — and animates the drain→source conduction: magnitude rides density + alpha +
// glow (never speed), and the channel visibly chokes shut in cutoff.
//
// `nch` flips the body/channel arrow (N points *in* toward the channel, P points
// *out*) — the one mark that distinguishes the two polarities.
function mosfetSchematic(g: Graphics, o: GlyphOpts, nch: boolean): void {
  const d = o.pins[0];
  const s = o.pins[1];
  const gate = o.pins[2];
  if (!d || !s || !gate) return;
  // The conduction channel runs vertically down the drain/source side; the gate
  // plate sits to its left, with the gate lead reaching in from pin 2.
  const chx = (d.x + s.x) / 2; // channel x (drain & source share it)
  const topY = Math.min(d.y, s.y) + 6;
  const botY = Math.max(d.y, s.y) - 6;
  const midY = (topY + botY) / 2;
  const platex = chx - 10; // the channel-side conductor (the three fingers' spine)
  const gatex = platex - 5; // the insulated gate bar, set off by the oxide gap

  // The drain current drives everything: |Id| as a 0..1 magnitude, its sign the
  // flow direction. Cutoff (≈0 current) reads as a choked, dim channel.
  const cond = norm(o.electrical.current, CUR_SCALE);
  const on = cond > 0.03;
  if (on) {
    g.roundRect(
      platex - 3,
      topY - 4,
      chx - platex + 8,
      botY - topY + 8,
      4,
    ).fill({ color: o.color, alpha: 0.16 * cond });
  }

  // Drain lead (top) and source lead (bottom) in to the channel spine.
  g.moveTo(d.x, d.y).lineTo(d.x, topY).lineTo(platex, topY);
  g.moveTo(s.x, s.y).lineTo(s.x, botY).lineTo(platex, botY);
  // Gate lead in to the gate bar.
  g.moveTo(gate.x, gate.y).lineTo(gatex, gate.y).lineTo(gatex, midY);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });

  // The channel spine + the three "fingers" (the broken channel of an
  // enhancement device): top finger to the drain, bottom to the source, middle
  // the body. The channel narrows (the fingers shorten toward the spine) as the
  // device chokes off — a visible cutoff cue, on the bounded clock via alpha.
  const reach = 7 * (0.45 + 0.55 * (on ? 1 : 0.25)); // fingers retract in cutoff
  g.moveTo(platex, topY - 1).lineTo(platex, botY + 1); // the spine
  for (const fy of [topY, midY, botY]) {
    g.moveTo(platex, fy).lineTo(platex + reach, fy);
  }
  g.stroke({ width: 2.2, color: o.color, alpha: 0.6 + 0.35 * cond });

  // The insulated gate bar (the MOS "plate"), parallel to the spine across the
  // oxide gap. This is the control electrode that draws no DC current.
  g.moveTo(gatex, topY).lineTo(gatex, botY);
  g.stroke({ width: 2.6, color: o.color, alpha: 0.95 });

  // The body/channel arrow on the middle finger: N-channel points IN (toward the
  // gate/channel), P-channel points OUT. This is the polarity mark.
  const ax = platex + reach;
  const ah = 3.2;
  if (nch) {
    // arrowhead at the spine end, pointing left (into the channel)
    g.moveTo(platex, midY)
      .lineTo(platex + ah, midY - ah)
      .moveTo(platex, midY)
      .lineTo(platex + ah, midY + ah);
  } else {
    // arrowhead at the finger tip, pointing right (out of the channel)
    g.moveTo(ax, midY)
      .lineTo(ax - ah, midY - ah)
      .moveTo(ax, midY)
      .lineTo(ax - ah, midY + ah);
  }
  g.stroke({ width: 2, color: o.color, alpha: 0.9 });

  // The drain→source conduction belt: flowing dots down the channel spine, fed
  // the SIGNED drain current so it reverses with Id and vanishes in cutoff.
  flow(g, platex, topY, platex, botY, o.electrical.current, o.phase, 0x46d2e6);
}

function drawNM(g: Graphics, o: GlyphOpts): void {
  mosfetSchematic(g, o, true);
}

function drawPM(g: Graphics, o: GlyphOpts): void {
  mosfetSchematic(g, o, false);
}

// --- BJT (3-terminal bipolar) -------------------------------------------------
// Pins are ordered C, E, B: pin 0 = Collector (top), pin 1 = Emitter (bottom),
// pin 2 = Base (left). `electrical.current` is Ic oriented a→b = collector→emitter;
// `electrical.vAcross` is Vce. The schematic draws the standard BJT symbol — a
// vertical base bar with the collector and emitter leads springing off it at an
// angle, and the emitter carrying the polarity arrow (out of the base for NPN,
// into it for PNP). The collector→emitter conduction is animated: magnitude rides
// density + alpha + glow (never speed), and it visibly chokes off in cutoff.
//
// `npn` flips the emitter arrow (NPN points *out* away from the base, PNP points
// *in* toward it) — the one mark that distinguishes the two polarities.
function bjtSchematic(g: Graphics, o: GlyphOpts, npn: boolean): void {
  const c = o.pins[0];
  const e = o.pins[1];
  const base = o.pins[2];
  if (!c || !e || !base) return;
  // The base bar is a short vertical line; the collector and emitter leads meet it
  // at a single junction point partway up the bar, springing away toward their pins.
  const barx = (Math.min(c.x, e.x) + base.x) / 2 + 4; // base bar x, set off from the base pin
  const topY = Math.min(c.y, e.y) + 6;
  const botY = Math.max(c.y, e.y) - 6;
  const midY = (topY + botY) / 2;
  const barH = 7; // half-height of the base bar
  const jx = barx; // the bar is at the junction x
  const jTop = midY - barH;
  const jBot = midY + barH;

  // |Ic| drives the conduction; its sign the flow direction. Cutoff (≈0 current)
  // reads as a dim, choked device.
  const cond = norm(o.electrical.current, CUR_SCALE);
  const on = cond > 0.03;
  if (on) {
    g.roundRect(barx - 3, topY - 4, c.x - barx + 8, botY - topY + 8, 4).fill({
      color: o.color,
      alpha: 0.16 * cond,
    });
  }

  // Base lead in to the middle of the bar.
  g.moveTo(base.x, base.y)
    .lineTo(barx - 5, base.y)
    .lineTo(barx - 5, midY);
  g.moveTo(barx - 5, midY).lineTo(jx, midY);
  // Collector lead: from its pin down to a spur, then angling in to the bar's top.
  g.moveTo(c.x, c.y).lineTo(c.x, topY).lineTo(jx, jTop);
  // Emitter lead: from the bar's bottom angling out to its pin's spur, then down.
  g.moveTo(jx, jBot).lineTo(e.x, botY).lineTo(e.x, e.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });

  // The base bar itself — the thick vertical electrode the leads spring off.
  g.moveTo(barx, midY - barH).lineTo(barx, midY + barH);
  g.stroke({ width: 2.8, color: o.color, alpha: 0.95 });

  // The emitter arrow — the polarity mark. NPN points OUT (away from the bar,
  // toward the emitter pin); PNP points IN (toward the bar). It sits on the
  // emitter lead just off the bar.
  const ah = 3.4;
  // A point a short way along the emitter lead from the junction (jx,jBot) toward
  // the emitter spur (e.x, botY).
  const ex = e.x;
  const ey = botY;
  const dx = ex - jx;
  const dy = ey - jBot;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  if (npn) {
    // Arrowhead near the emitter end, pointing OUT along the lead (away from bar).
    const px = jx + dx * 0.62;
    const py = jBot + dy * 0.62;
    g.moveTo(px, py)
      .lineTo(px - ah * ux + ah * uy, py - ah * uy - ah * ux)
      .moveTo(px, py)
      .lineTo(px - ah * ux - ah * uy, py - ah * uy + ah * ux);
  } else {
    // Arrowhead near the bar, pointing IN toward the bar (back up the lead).
    const px = jx + dx * 0.38;
    const py = jBot + dy * 0.38;
    g.moveTo(px, py)
      .lineTo(px + ah * ux + ah * uy, py + ah * uy - ah * ux)
      .moveTo(px, py)
      .lineTo(px + ah * ux - ah * uy, py + ah * uy + ah * ux);
  }
  g.stroke({ width: 2, color: o.color, alpha: 0.9 });

  // The collector→emitter conduction belt: flowing dots along the C and E leads,
  // fed the SIGNED collector current so it reverses with Ic and vanishes in cutoff.
  flow(g, c.x, topY, jx, jTop, o.electrical.current, o.phase, 0x46d2e6);
  flow(g, jx, jBot, e.x, botY, o.electrical.current, o.phase, 0x46d2e6);
}

function drawQ(g: Graphics, o: GlyphOpts): void {
  bjtSchematic(g, o, true);
}

function drawQP(g: Graphics, o: GlyphOpts): void {
  bjtSchematic(g, o, false);
}

// --- Op-amp (3-terminal high-gain amplifier) ----------------------------------
// Pins are ordered OUT, IN−, IN+: pin 0 = Output (right vertex), pin 1 = IN−
// (inverting, left edge), pin 2 = IN+ (non-inverting, left edge). The schematic is
// the classic right-pointing triangle: the two inputs enter the vertical left
// edge (IN+ marked +, IN− marked −) and the output leaves the apex.
// `electrical.current` is the output drive Iout sourced at the apex; its magnitude
// rides the body glow + the output belt density, its sign the belt direction —
// the inputs sip no current (high-impedance), so only the output animates, the
// "the inputs sense, the output drives" lesson. `electrical.vAcross` is
// V(OUT)−V(IN−).
function drawOA(g: Graphics, o: GlyphOpts): void {
  const out = o.pins[0];
  const inM = o.pins[1];
  const inP = o.pins[2];
  if (!out || !inM || !inP) return;
  // Triangle: a vertical left edge spanning the two input heights, an apex on the
  // right toward the output pin. Leads spur in/out from the pins to the body.
  const leftX = Math.min(inP.x, inM.x) + 10;
  const apexX = out.x - 8;
  const midY = (inP.y + inM.y) / 2;
  const topY = Math.min(inP.y, inM.y) - 3;
  const botY = Math.max(inP.y, inM.y) + 3;

  // |Iout| drives the body glow + the output belt; sign sets the belt direction.
  const drive = norm(o.electrical.current, CUR_SCALE);

  // Body fill — brightens a touch as the output works (a near-ideal amp barely
  // breaks a sweat, so keep it subtle).
  g.moveTo(leftX, topY)
    .lineTo(apexX, midY)
    .lineTo(leftX, botY)
    .closePath()
    .fill({ color: o.color, alpha: 0.1 + 0.16 * drive });

  // Input leads in to the left edge (high-impedance: drawn quiet, no flow dots).
  g.moveTo(inP.x, inP.y).lineTo(leftX, inP.y);
  g.moveTo(inM.x, inM.y).lineTo(leftX, inM.y);
  // Output lead out from the apex.
  g.moveTo(apexX, midY).lineTo(out.x, out.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });

  // The triangle outline — the amplifier body.
  g.moveTo(leftX, topY)
    .lineTo(apexX, midY)
    .lineTo(leftX, botY)
    .closePath()
    .stroke({ width: 2.4, color: o.color, alpha: 0.95 });

  // Input polarity marks just inside the left edge: + at IN+, − at IN−.
  const mk = leftX + 6;
  const ms = 2.4; // mark half-size
  // '+' at the non-inverting input
  g.moveTo(mk - ms, inP.y)
    .lineTo(mk + ms, inP.y)
    .moveTo(mk, inP.y - ms)
    .lineTo(mk, inP.y + ms);
  // '−' at the inverting input
  g.moveTo(mk - ms, inM.y).lineTo(mk + ms, inM.y);
  g.stroke({ width: 1.6, color: o.color, alpha: 0.9 });

  // The output drive belt: flowing dots along the output lead, fed the SIGNED
  // output current so it reverses with Iout and fades when the output idles.
  flow(g, apexX, midY, out.x, out.y, o.electrical.current, o.phase, 0x46d2e6);
}

// --- Logic gates (behavioral digital ICs) -------------------------------------
// Pins are ordered Y, A, B: pin 0 = output (right), pin 1 = input A, pin 2 = input
// B (absent for the inverter). The body draws the distinctive boolean symbol — AND
// is a flat-backed "D", OR/XOR a curved shield, NOT a triangle — with an inversion
// bubble on the output for NAND/NOR/NOT and the extra back-arc for XOR.
// `electrical.current` is the output drive current: its magnitude lights the body
// and the output flow belt, so a gate driving a load visibly works (a gate feeding
// another gate's high-impedance input draws ~0 and idles quietly — which is
// correct). The boolean shape is the identity; the live logic levels read on the
// scope.
type GateShape = "and" | "or" | "not";

function gateSchematic(
  g: Graphics,
  o: GlyphOpts,
  shape: GateShape,
  inverted: boolean,
  xor: boolean,
): void {
  const out = o.pins[0];
  const inA = o.pins[1];
  if (!out || !inA) return;
  const inB = o.pins[2]; // undefined for the inverter (single input)
  const midY = inB ? (inA.y + inB.y) / 2 : inA.y;
  const topY = inB ? Math.min(inA.y, inB.y) : midY - 12;
  const botY = inB ? Math.max(inA.y, inB.y) : midY + 12;
  const backX = Math.min(inA.x, inB?.x ?? inA.x) + 9;
  const tipX = out.x - (inverted ? 12 : 7); // leave room for the inversion bubble
  const midX = (backX + tipX) / 2;
  const col = o.color;
  const drive = norm(o.electrical.current, CUR_SCALE);

  // Input + output leads. For XOR the leads reach the inner body, crossing the
  // outer back-arc just as a real XOR symbol's do.
  g.moveTo(inA.x, inA.y).lineTo(backX, inA.y);
  if (inB) g.moveTo(inB.x, inB.y).lineTo(backX, inB.y);
  g.moveTo(tipX, midY).lineTo(out.x, out.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });

  // The body outline, as a closed path (drawn twice — fill then stroke).
  const body = (gg: Graphics): void => {
    if (shape === "not") {
      gg.moveTo(backX, topY).lineTo(tipX, midY).lineTo(backX, botY).closePath();
    } else if (shape === "and") {
      // Flat vertical back, straight top/bottom, a rounded front (the "D").
      gg.moveTo(backX, botY)
        .lineTo(backX, topY)
        .lineTo(midX, topY)
        .quadraticCurveTo(tipX, topY, tipX, midY)
        .quadraticCurveTo(tipX, botY, midX, botY)
        .lineTo(backX, botY)
        .closePath();
    } else {
      // OR/XOR: a concave back bulging into the body, two sweeps to a front point.
      gg.moveTo(backX, topY)
        .quadraticCurveTo(backX + 9, midY, backX, botY)
        .quadraticCurveTo(midX, botY, tipX, midY)
        .quadraticCurveTo(midX, topY, backX, topY)
        .closePath();
    }
  };
  body(g);
  g.fill({ color: col, alpha: 0.12 + 0.16 * drive });
  body(g);
  g.stroke({ width: 2.2, color: col, alpha: 0.95 });

  // XOR's extra back-arc, a parallel curve just behind the body's concave back.
  if (xor) {
    g.moveTo(backX - 5, topY)
      .quadraticCurveTo(backX + 4, midY, backX - 5, botY)
      .stroke({ width: 2, color: col, alpha: 0.9 });
  }

  // The inversion bubble at the output tip (NAND / NOR / NOT).
  if (inverted) {
    g.circle(tipX + 4, midY, 3.2).stroke({ width: 2, color: col, alpha: 0.95 });
  }

  // Output drive belt: flowing dots along the output lead, signed by the current.
  flow(
    g,
    tipX + (inverted ? 8 : 0),
    midY,
    out.x,
    out.y,
    o.electrical.current,
    o.phase,
    0x46d2e6,
  );
}

function drawAND(g: Graphics, o: GlyphOpts): void {
  gateSchematic(g, o, "and", false, false);
}
function drawOR(g: Graphics, o: GlyphOpts): void {
  gateSchematic(g, o, "or", false, false);
}
function drawNAND(g: Graphics, o: GlyphOpts): void {
  gateSchematic(g, o, "and", true, false);
}
function drawNOR(g: Graphics, o: GlyphOpts): void {
  gateSchematic(g, o, "or", true, false);
}
function drawXOR(g: Graphics, o: GlyphOpts): void {
  gateSchematic(g, o, "or", false, true);
}
function drawXNOR(g: Graphics, o: GlyphOpts): void {
  gateSchematic(g, o, "or", true, true);
}
function drawNOT(g: Graphics, o: GlyphOpts): void {
  gateSchematic(g, o, "not", true, false);
}
function drawBUF(g: Graphics, o: GlyphOpts): void {
  gateSchematic(g, o, "not", false, false);
}

// --- Transformer (two windings coupled through a core) ------------------------
// Pins ordered P+, P−, S+, S−. The primary winding (left) couples through the iron
// core (the two centre bars) to the secondary winding (right). `electrical.current`
// is the PRIMARY current Ip: it drives the primary flow belt and pulses the core's
// flux glow; the secondary shows a coupled shimmer (its own current isn't separately
// exposed). The turns ratio `value` sets how the secondary voltage scales.
function drawTR(g: Graphics, o: GlyphOpts): void {
  const pp = o.pins[0];
  const pm = o.pins[1];
  const sp = o.pins[2];
  const sm = o.pins[3];
  if (!pp || !pm || !sp || !sm) return;
  const priX = Math.min(pp.x, pm.x) + 8;
  const secX = Math.max(sp.x, sm.x) - 8;
  const topY = Math.min(pp.y, sp.y) + 4;
  const botY = Math.max(pm.y, sm.y) - 4;
  const midX = (priX + secX) / 2;
  const bumps = 3;
  const rr = (botY - topY) / (bumps * 2);
  const drive = norm(o.electrical.current, CUR_SCALE);

  // Core flux glow between the windings, pulsing on the bounded clock with |Ip|.
  if (drive > 0.02) {
    const s = 1 + 0.12 * Math.sin(o.phase * PULSE_K);
    g.ellipse(midX, (topY + botY) / 2, 6 * s, ((botY - topY) / 2) * s).fill({
      color: 0x8a95f2,
      alpha: 0.18 * drive,
    });
  }

  // Leads to the top/bottom of each winding.
  g.moveTo(pp.x, pp.y).lineTo(priX, pp.y).lineTo(priX, topY);
  g.moveTo(pm.x, pm.y).lineTo(priX, pm.y).lineTo(priX, botY);
  g.moveTo(sp.x, sp.y).lineTo(secX, sp.y).lineTo(secX, topY);
  g.moveTo(sm.x, sm.y).lineTo(secX, sm.y).lineTo(secX, botY);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });

  // Primary winding: vertical bumps bulging right (toward the core).
  for (let i = 0; i < bumps; i++) {
    const cy = topY + rr * (2 * i + 1);
    g.arc(priX, cy, rr, -Math.PI / 2, Math.PI / 2, false);
  }
  g.stroke({ width: 2.2, color: o.color, alpha: 0.95 });
  // Secondary winding: vertical bumps bulging left (toward the core).
  for (let i = 0; i < bumps; i++) {
    const cy = topY + rr * (2 * i + 1);
    g.arc(secX, cy, rr, -Math.PI / 2, Math.PI / 2, true);
  }
  g.stroke({ width: 2.2, color: o.color, alpha: 0.95 });

  // The iron core: two vertical bars between the windings (brighten with the flux).
  g.moveTo(midX - 2, topY).lineTo(midX - 2, botY);
  g.moveTo(midX + 2, topY).lineTo(midX + 2, botY);
  g.stroke({ width: 1.8, color: o.color, alpha: 0.55 + 0.35 * drive });

  // Primary current belt down the primary winding (signed by Ip).
  flow(g, priX, topY, priX, botY, o.electrical.current, o.phase, 0x46d2e6);
  // Secondary coupled shimmer: dots riding the same clock (the induced activity).
  if (drive > 0.04) {
    for (let i = 0; i < 2; i++) {
      const t = (((i / 2 + o.phase * FLOW_SPEED) % 1) + 1) % 1;
      g.circle(secX, topY + (botY - topY) * t, 1.6).fill({
        color: 0x46d2e6,
        alpha: 0.3 + 0.3 * drive,
      });
    }
  }
}

// --- Potentiometer (variable resistor with a movable wiper) --------------------
// Pins ordered A, B, W: the two track ends (A left, B right) and the wiper W below.
// The resistive track runs A→B; the wiper arrow taps it at `o.wiper` (0 = A end,
// 1 = B end), and slides as the player turns the knob. `electrical.current` is the
// A→W leg current (drives the flow belt + heat halo); `value` is the total
// resistance.
function drawPOT(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  const w = o.pins[2];
  if (!a || !b || !w) return;
  const x0 = a.x + 8;
  const x1 = b.x - 8;
  const amp = 6;
  const trackY = a.y;
  const t = Math.min(1, Math.max(0, o.wiper ?? 0.5));
  const heat = norm(o.electrical.current, CUR_SCALE);

  if (heat > 0.03) {
    g.roundRect(x0 - 2, trackY - amp - 4, x1 - x0 + 4, 2 * amp + 8, 5).fill({
      color: 0xe0533a,
      alpha: 0.16 * heat,
    });
  }
  // End leads.
  g.moveTo(a.x, a.y).lineTo(x0, trackY);
  g.moveTo(x1, trackY).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  // Zigzag track A→B.
  const segs = 6;
  g.moveTo(x0, trackY);
  for (let i = 0; i < segs; i++) {
    const x = x0 + ((i + 0.5) / segs) * (x1 - x0);
    const y = trackY + (i % 2 === 0 ? -amp : amp);
    g.lineTo(x, y);
  }
  g.lineTo(x1, trackY);
  g.stroke({ width: 2.2, color: o.color, alpha: 0.95 });

  // Wiper: a lead up from W that taps the track at the wiper position, capped with
  // an arrowhead pointing at the track. It slides horizontally as `t` changes.
  const tapX = x0 + t * (x1 - x0);
  const tapY = trackY + amp + 5;
  g.moveTo(w.x, w.y).lineTo(w.x, tapY).lineTo(tapX, tapY);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  const ah = 4;
  g.moveTo(tapX, trackY + amp)
    .lineTo(tapX - ah, tapY)
    .lineTo(tapX + ah, tapY)
    .closePath()
    .fill({ color: o.color, alpha: 0.95 });

  // Track current belt (the A→W leg), signed by its current.
  flow(g, x0, trackY, x1, trackY, o.electrical.current, o.phase, 0x46d2e6);
}

// --- D flip-flop (edge-triggered one-bit memory) ------------------------------
// Pins ordered Q, D, CLK, Q̄: outputs Q (right-top) and Q̄ (right-bottom), inputs D
// (left-top) and the edge-clocked CLK (left-bottom, drawn with the ">" edge marker).
// The standard clocked-box symbol; `electrical.current` is the Q output drive, which
// animates the Q output belt when it drives a load. The stored bit reads on the
// scope at Q/Q̄.
function drawFF(g: Graphics, o: GlyphOpts): void {
  const q = o.pins[0];
  const d = o.pins[1];
  const clk = o.pins[2];
  const qb = o.pins[3];
  if (!q || !d || !clk || !qb) return;
  const leftX = Math.min(d.x, clk.x) + 8;
  const rightX = Math.max(q.x, qb.x) - 8;
  const topY = Math.min(d.y, q.y) + 2;
  const botY = Math.max(clk.y, qb.y) - 2;
  const drive = norm(o.electrical.current, CUR_SCALE);

  // Leads to the box edges.
  g.moveTo(d.x, d.y).lineTo(leftX, d.y);
  g.moveTo(clk.x, clk.y).lineTo(leftX, clk.y);
  g.moveTo(rightX, q.y).lineTo(q.x, q.y);
  g.moveTo(rightX, qb.y).lineTo(qb.x, qb.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });

  // The clocked box body.
  g.roundRect(leftX, topY, rightX - leftX, botY - topY, 3).fill({
    color: o.color,
    alpha: 0.1 + 0.12 * drive,
  });
  g.roundRect(leftX, topY, rightX - leftX, botY - topY, 3).stroke({
    width: 2.2,
    color: o.color,
    alpha: 0.95,
  });

  // The edge-clock marker: a ">" notch at the CLK input inside the box.
  const cy = clk.y;
  g.moveTo(leftX, cy - 4)
    .lineTo(leftX + 6, cy)
    .lineTo(leftX, cy + 4)
    .stroke({ width: 2, color: o.color, alpha: 0.9 });

  // The Q output drive belt (signed by its current); Q̄ gets a faint complement.
  flow(g, rightX, q.y, q.x, q.y, o.electrical.current, o.phase, 0x46d2e6);
  if (drive > 0.04) {
    for (let i = 0; i < 2; i++) {
      const t = (((i / 2 + o.phase * FLOW_SPEED) % 1) + 1) % 1;
      g.circle(rightX + (qb.x - rightX) * t, qb.y, 1.4).fill({
        color: 0x46d2e6,
        alpha: 0.3,
      });
    }
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
  const pulse = 0.5 + 0.5 * Math.sin(o.phase * PULSE_K);
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
  // a flywheel: it spins at a constant calm rate; more current shows as brighter,
  // bolder spokes (alpha below), never as a faster spin (the old speed-coupling).
  const spin = norm(o.electrical.current, CUR_SCALE);
  const ang = o.phase * PULSE_K;
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

function drawFSD(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const hw = 13;
  const cond = norm(Math.max(0, o.electrical.current), CUR_SCALE);
  fLeads(g, o, mx, hw);
  fBox(g, mx, my, hw, 11, o.color);
  // A low-loss check-valve: the same one-way gate as the diode, but slimmer with
  // an open throat — visibly the leaner/faster valve (it barely impedes the belt).
  g.poly([mx - 6, my - 7, mx + 6, my, mx - 6, my + 7]).stroke({
    width: 1.6,
    color: o.color,
    alpha: 0.85,
  });
  g.poly([mx - 3, my - 4, mx + 5, my, mx - 3, my + 4]).fill({
    color: o.color,
    alpha: 0.3 + 0.6 * cond,
  });
  const fwd = Math.max(0, o.electrical.current);
  flow(g, a.x, a.y, mx - hw, my, fwd, o.phase, 0x46d2e6);
  flow(g, mx + hw, my, b.x, b.y, fwd, o.phase, 0x46d2e6);
}

function drawFLED(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const hw = 13;
  // A one-way gate that doubles as a beacon: the lamp on the roof brightens with
  // the forward current (alpha + a gentle breathe on the bounded phase), dark
  // when off — the factory-lens twin of the lighting-up LED symbol.
  const lit = norm(Math.max(0, o.electrical.current), CUR_SCALE);
  if (lit > 0.01) {
    const breathe = 0.85 + 0.15 * Math.sin(o.phase * PULSE_K);
    g.circle(mx, my - 4, 18).fill({
      color: o.color,
      alpha: 0.2 * lit * breathe,
    });
  }
  fLeads(g, o, mx, hw);
  fBox(g, mx, my, hw, 11, o.color);
  // the one-way gate
  g.poly([mx - 5, my - 6, mx + 5, my, mx - 5, my + 6]).fill({
    color: o.color,
    alpha: 0.3 + 0.5 * lit,
  });
  // the beacon lamp on the roof
  if (lit > 0.01) {
    const breathe = 0.85 + 0.15 * Math.sin(o.phase * PULSE_K);
    g.circle(mx, my - 11, 3.5).fill({
      color: 0xffffff,
      alpha: 0.4 * lit * breathe,
    });
    g.circle(mx, my - 11, 3.5).stroke({
      color: o.color,
      width: 1.2,
      alpha: 0.9,
    });
  }
  const fwd = Math.max(0, o.electrical.current);
  flow(g, a.x, a.y, mx - hw, my, fwd, o.phase, 0x46d2e6);
  flow(g, mx + hw, my, b.x, b.y, fwd, o.phase, 0x46d2e6);
}

function drawFZD(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const hw = 13;
  // A check-valve that ALSO has a side spillway/weir: it passes forward like the
  // diode gate, but once the rail drives it into reverse breakdown the weir opens
  // and dumps the excess down to the drain — pinning the rail height (a shunt
  // regulator). Forward current lights the gate; reverse (breakdown) current
  // opens the spillway. Both keyed to magnitude as alpha, never speed.
  const fwd = norm(Math.max(0, o.electrical.current), CUR_SCALE);
  const rev = norm(Math.max(0, -o.electrical.current), CUR_SCALE);
  fLeads(g, o, mx, hw);
  fBox(g, mx, my, hw, 11, o.color);
  // the one-way conveyor gate, lit when passing forward
  g.poly([mx - 5, my - 6, mx + 5, my, mx - 5, my + 6]).fill({
    color: o.color,
    alpha: 0.3 + 0.6 * fwd,
  });
  // the side spillway/weir on the roof: a gate that opens (lifts) with breakdown
  // current, with a cyan overflow pouring down to the drain.
  const open = rev; // 0 = shut, 1 = wide open
  const weirY = my - 11; // roof line
  if (open > 0.03) {
    // the lifted weir gate
    g.moveTo(mx + 3, weirY)
      .lineTo(mx + 9, weirY - 3 - 4 * open)
      .stroke({ width: 1.6, color: 0x46d2e6, alpha: 0.9 });
    // the overflow spilling down the side to the drain — constant-rate dots,
    // density + alpha rise with how hard it's spilling.
    const n =
      FLOW_DOTS_MIN + Math.round((FLOW_DOTS_MAX - FLOW_DOTS_MIN) * open);
    for (let i = 0; i < n; i++) {
      const t = (((i / n + o.phase * FLOW_SPEED) % 1) + 1) % 1;
      g.circle(mx + 9, weirY - 2 + (my + 9 - (weirY - 2)) * t, 1.6).fill({
        color: 0x46d2e6,
        alpha: 0.3 + 0.55 * open,
      });
    }
  }
  flow(g, a.x, a.y, mx - hw, my, o.electrical.current, o.phase, 0x46d2e6);
  flow(g, mx + hw, my, b.x, b.y, o.electrical.current, o.phase, 0x46d2e6);
}

function drawFMOV(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const hw = 13;
  // The varistor's surge clamp / spillway (docs/parts-catalog-ideation.md §6.2):
  // a sluice straddling the rail and the drain that sits SHUT and idle below the
  // clamp voltage, then dumps the surge BOTH ways once |V| reaches Vc. It is the
  // symmetric cousin of the Zener's one-way weir: a positive surge (V > +Vc,
  // current a→b) lifts the TOP spillway and spills up to the high rail; a negative
  // surge (V < −Vc, current b→a) lifts the BOTTOM spillway and spills down to the
  // drain. The body's throat glows as the spike rises (|V across|); the weirs open
  // and spill with the clamp current — magnitude as fill/lift/density, never speed.
  const up = norm(Math.max(0, o.electrical.current), CUR_SCALE); // V > +Vc spill
  const down = norm(Math.max(0, -o.electrical.current), CUR_SCALE); // V < −Vc spill
  const field = norm(o.electrical.vAcross, V_SCALE);
  fLeads(g, o, mx, hw);
  fBox(g, mx, my, hw, 11, o.color);
  // the central throat the belt passes through, brightening with the rising spike
  // (warn-coloured) until a weir opens — the "about to clamp" cue.
  g.roundRect(mx - 4, my - 7, 8, 14, 2).fill({
    color: o.color,
    alpha: 0.18 + 0.4 * field,
  });
  // A spillway gate + overflow stream. `dir = -1` is the top weir (spills UP to
  // the rail), `dir = +1` the bottom weir (spills DOWN to the drain). Drawn shut
  // and idle when `open ≈ 0`; lifts and pours (cyan, constant-rate dots) with it.
  const weir = (open: number, dir: number): void => {
    if (open <= 0.03) return;
    const edgeY = my + dir * 11; // roof line (top) or floor line (bottom)
    const tipY = edgeY + dir * (3 + 4 * open); // the lifted gate tip
    g.moveTo(mx + 3, edgeY)
      .lineTo(mx + 9, tipY)
      .stroke({ width: 1.6, color: 0x46d2e6, alpha: 0.9 });
    const farY = my + dir * 20; // where the overflow lands (rail / drain)
    const n =
      FLOW_DOTS_MIN + Math.round((FLOW_DOTS_MAX - FLOW_DOTS_MIN) * open);
    for (let i = 0; i < n; i++) {
      const t = (((i / n + o.phase * FLOW_SPEED) % 1) + 1) % 1;
      g.circle(
        mx + 9,
        edgeY + dir * 2 + (farY - (edgeY + dir * 2)) * t,
        1.6,
      ).fill({ color: 0x46d2e6, alpha: 0.3 + 0.55 * open });
    }
  };
  weir(up, -1); // positive surge spills UP to the high rail
  weir(down, 1); // negative surge spills DOWN to the drain
  // Signed flow on both legs — the clamp sinks current either direction with the
  // surge polarity, so the belt reverses with the spike (the symmetric action).
  flow(g, a.x, a.y, mx - hw, my, o.electrical.current, o.phase, 0x46d2e6);
  flow(g, mx + hw, my, b.x, b.y, o.electrical.current, o.phase, 0x46d2e6);
}

function drawFEC(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const hw = 13;
  const hh = 13;
  // A big ribbed pressure tank (vs the ceramic's small buffer chest): it fills
  // with the stored voltage, and its ESR shows as a narrow throat at the inlet
  // where the ripple current "rubs" through. Reuse the chest-fill idea on the
  // bounded clock; magnitude is fill height + the inlet's heat, never speed.
  fLeads(g, o, mx, hw);
  // the inlet throat (the ESR): a narrow neck on the + side the belt squeezes
  // through; it warms (a faint red shimmer) with the through-current.
  const ripple = norm(o.electrical.current, CUR_SCALE);
  g.poly([mx - hw, my - 6, mx - hw + 5, my, mx - hw, my + 6]).fill({
    color: o.color,
    alpha: 0.3,
  });
  if (ripple > 0.03) {
    g.circle(mx - hw + 3, my, 4).fill({
      color: 0xe0533a,
      alpha: 0.25 * ripple,
    });
  }
  fBox(g, mx, my, hw, hh, o.color);
  // ribs down the tank wall
  for (let i = -1; i <= 1; i++) {
    g.moveTo(mx + i * 7, my - hh + 3)
      .lineTo(mx + i * 7, my + hh - 3)
      .stroke({ width: 1, color: o.color, alpha: 0.3 });
  }
  // the stored charge filling the tank from the bottom
  const charge = norm(o.electrical.vAcross, V_SCALE);
  const fillH = 2 * (hh - 3) * charge;
  if (fillH > 0.5) {
    g.roundRect(mx - hw + 3, my + hh - 3 - fillH, 2 * (hw - 3), fillH, 1).fill({
      color: o.color,
      alpha: 0.55,
    });
  }
  // the "+" polarity mark by the inlet
  g.moveTo(mx - hw - 6, my - hh + 2)
    .lineTo(mx - hw - 2, my - hh + 2)
    .moveTo(mx - hw - 4, my - hh)
    .lineTo(mx - hw - 4, my - hh + 4)
    .stroke({ width: 1.4, color: o.color, alpha: 0.8 });
  flow(g, a.x, a.y, mx - hw, my, o.electrical.current, o.phase, 0x46d2e6);
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

function drawFMSW(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const hw = 13;
  // A player-operated gate across the belt: when CLOSED (conducting) the door is
  // swung aside so the belt runs straight through; when OPEN the door is shut
  // square across the lane, blocking it. The state comes from `o.value`, so it
  // reads right even with no goods on the belt.
  const closed = switchClosed(o);
  fLeads(g, o, mx, hw);
  fBox(g, mx, my, hw, 11, o.color);
  if (closed) {
    // door swung aside (hinged flat against the top wall, out of the lane) — the
    // belt flows through the open gateway.
    g.moveTo(mx - 6, my - 7)
      .lineTo(mx + 6, my - 7)
      .stroke({ width: 2.2, color: o.color, alpha: 0.6 });
    flow(g, mx - hw, my, mx + hw, my, o.electrical.current, o.phase, o.color);
  } else {
    // door shut square across the lane — a solid barred panel stopping the belt.
    g.rect(mx - 6, my - 8, 12, 16).fill({ color: 0x9c93b8, alpha: 0.32 });
    g.rect(mx - 6, my - 8, 12, 16).stroke({
      width: 1.6,
      color: 0x9c93b8,
      alpha: 0.7,
    });
    // a couple of bars to read it as a closed gate, not a panel
    g.moveTo(mx, my - 8)
      .lineTo(mx, my + 8)
      .stroke({ width: 1.2, color: 0x9c93b8, alpha: 0.55 });
  }
}

// The MOSFET as a Factorio gain-assembler / valve: a thin GATE control belt
// (from pin 2) drives a sluice that opens a FAT drain→source MAIN belt (pin 0 →
// pin 1). The main belt's thickness + flow density track |Id|, and it visibly
// chokes shut below threshold (the gate sluice drops closed). All motion rides
// the bounded `o.phase` clock — magnitude is width/density/alpha, never speed.
// `nch` flips a small intake marker so the two polarities read apart.
function mosfetFactory(g: Graphics, o: GlyphOpts, nch: boolean): void {
  const d = o.pins[0];
  const s = o.pins[1];
  const gate = o.pins[2];
  if (!d || !s || !gate) return;
  const mx = (d.x + s.x) / 2;
  const hw = 11;
  const topY = Math.min(d.y, s.y) + 6;
  const botY = Math.max(d.y, s.y) - 6;
  const my = (topY + botY) / 2;

  // |Id| drives the main belt; near-zero current = choked valve. The gate's job
  // is shown by how far the sluice has lifted, keyed to the same conduction.
  const cond = norm(o.electrical.current, CUR_SCALE);
  const open = cond; // 0 = shut, 1 = wide open

  // Drain lead in at the top, source lead out at the bottom, gate lead from the
  // left into the control box.
  g.moveTo(d.x, d.y).lineTo(d.x, topY);
  g.moveTo(s.x, s.y).lineTo(s.x, botY);
  g.moveTo(gate.x, gate.y).lineTo(mx - hw, gate.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });

  // The assembler body.
  fBox(g, mx, my, hw, (botY - topY) / 2 + 2, o.color);

  // The FAT main belt down the middle: its width grows with how far the valve is
  // open (a thin choked throat in cutoff, a wide channel when conducting).
  const beltW = 2 + 8 * open;
  if (open > 0.02) {
    g.roundRect(mx - beltW / 2, topY, beltW, botY - topY, 2).fill({
      color: o.color,
      alpha: 0.22 + 0.3 * open,
    });
  } else {
    // choked shut: just a hairline throat
    g.moveTo(mx, topY).lineTo(mx, botY).stroke({
      width: 1.4,
      color: 0x9c93b8,
      alpha: 0.6,
    });
  }

  // The gate sluice gate on the left wall: it lifts open with the control signal.
  const lift = 5 * open;
  g.moveTo(mx - hw + 1, my + 3)
    .lineTo(mx - hw + 6, my + 3 - lift)
    .stroke({ width: 1.8, color: o.color, alpha: 0.55 + 0.4 * open });
  // a couple of control-belt dots running in along the gate lead (always on the
  // bounded clock; the gate is a signal, so it ticks even at low current)
  for (let i = 0; i < 2; i++) {
    const t = (((i / 2 + o.phase * FLOW_SPEED) % 1) + 1) % 1;
    g.circle(gate.x + (mx - hw - gate.x) * t, gate.y, 1.4).fill({
      color: o.color,
      alpha: 0.4,
    });
  }

  // A small intake marker that differs by polarity (N draws from the top rail,
  // P sources from it) — a faint cue, not load-bearing.
  g.circle(mx, nch ? topY + 2 : botY - 2, 1.6).fill({
    color: o.color,
    alpha: 0.5,
  });

  // The main drain→source flow, signed so it reverses with Id and dies in cutoff.
  flow(g, mx, topY, mx, botY, o.electrical.current, o.phase, 0x46d2e6);
}

function drawFNM(g: Graphics, o: GlyphOpts): void {
  mosfetFactory(g, o, true);
}

function drawFPM(g: Graphics, o: GlyphOpts): void {
  mosfetFactory(g, o, false);
}

// The BJT as a Factorio current-gain assembler / valve: a THIN base control belt
// (from pin 2) trickles in a small metering current that throws open a FAT
// collector→emitter MAIN belt (pin 0 → pin 1). The main belt's thickness + flow
// density track |Ic| — and crucially they dwarf the thin base belt, the visible
// "small base current commands a large collector current" lesson. The valve chokes
// shut when the base isn't driven. All motion rides the bounded `o.phase` clock —
// magnitude is width/density/alpha, never speed. `npn` flips a small intake marker
// so the two polarities read apart.
function bjtFactory(g: Graphics, o: GlyphOpts, npn: boolean): void {
  const c = o.pins[0];
  const e = o.pins[1];
  const base = o.pins[2];
  if (!c || !e || !base) return;
  const mx = (c.x + e.x) / 2;
  const hw = 11;
  const topY = Math.min(c.y, e.y) + 6;
  const botY = Math.max(c.y, e.y) - 6;
  const my = (topY + botY) / 2;

  // |Ic| drives the main belt; near-zero current = choked valve. The base's job is
  // shown by a thin metering trickle that's always running on the bounded clock.
  const cond = norm(o.electrical.current, CUR_SCALE);
  const open = cond; // 0 = shut, 1 = wide open
  // The recovered base drive: a small fraction of the collector current (Ic ≈
  // β·Ib), so the base belt reads as a thin trickle next to the fat main belt.
  const baseDrive = 0.15 + 0.25 * open;

  // Collector lead in at the top, emitter lead out at the bottom, base lead from
  // the left into the control box.
  g.moveTo(c.x, c.y).lineTo(c.x, topY);
  g.moveTo(e.x, e.y).lineTo(e.x, botY);
  g.moveTo(base.x, base.y).lineTo(mx - hw, base.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });

  // The assembler body.
  fBox(g, mx, my, hw, (botY - topY) / 2 + 2, o.color);

  // The FAT main belt down the middle: its width grows with how far the valve is
  // open (a thin choked throat in cutoff, a wide channel when conducting).
  const beltW = 2 + 8 * open;
  if (open > 0.02) {
    g.roundRect(mx - beltW / 2, topY, beltW, botY - topY, 2).fill({
      color: o.color,
      alpha: 0.22 + 0.3 * open,
    });
  } else {
    // choked shut: just a hairline throat
    g.moveTo(mx, topY).lineTo(mx, botY).stroke({
      width: 1.4,
      color: 0x9c93b8,
      alpha: 0.6,
    });
  }

  // The base metering gate on the left wall: a small sluice that lifts a touch with
  // the base drive — its modest motion against the fat belt is the gain lesson.
  const lift = 3 * baseDrive;
  g.moveTo(mx - hw + 1, my + 3)
    .lineTo(mx - hw + 5, my + 3 - lift)
    .stroke({ width: 1.6, color: o.color, alpha: 0.5 + 0.4 * open });
  // The THIN base control belt: a couple of dots trickling in along the base lead.
  // The base belt always ticks on the bounded clock (it's the metering signal),
  // and stays sparse/dim — a small current commanding the large main belt.
  for (let i = 0; i < 2; i++) {
    const t = (((i / 2 + o.phase * FLOW_SPEED) % 1) + 1) % 1;
    g.circle(base.x + (mx - hw - base.x) * t, base.y, 1.3).fill({
      color: o.color,
      alpha: 0.35 + 0.2 * baseDrive,
    });
  }

  // A small intake marker that differs by polarity (NPN sinks from the top
  // collector rail, PNP sources from it) — a faint cue, not load-bearing.
  g.circle(mx, npn ? topY + 2 : botY - 2, 1.6).fill({
    color: o.color,
    alpha: 0.5,
  });

  // The main collector→emitter flow, signed so it reverses with Ic and dies in
  // cutoff — the fat belt that the thin base trickle commands.
  flow(g, mx, topY, mx, botY, o.electrical.current, o.phase, 0x46d2e6);
}

function drawFQ(g: Graphics, o: GlyphOpts): void {
  bjtFactory(g, o, true);
}

function drawFQP(g: Graphics, o: GlyphOpts): void {
  bjtFactory(g, o, false);
}

// The op-amp as a Factorio comparator/amplifier station: two THIN sensor probes
// (the high-impedance inputs, pins 2 and 1 — they only read, no belt runs through
// them) feed a differential-comparator core that throws a FAT output belt out the
// apex (pin 0). The output belt's width + flow density track |Iout|; the inputs
// stay sparse and still — the visible "the inputs sense, the output drives"
// lesson. All motion rides the bounded `o.phase` clock — magnitude is
// width/density/alpha, never speed.
function drawFOA(g: Graphics, o: GlyphOpts): void {
  const out = o.pins[0];
  const inM = o.pins[1];
  const inP = o.pins[2];
  if (!out || !inM || !inP) return;
  const leftX = Math.min(inP.x, inM.x) + 9;
  const my = (inP.y + inM.y) / 2;
  const hw = 11;
  const mx = leftX + hw;
  const hh = Math.max(inP.y, inM.y) - my + 3;

  const drive = norm(o.electrical.current, CUR_SCALE);

  // Input sensor probes in from the left to the core wall (drawn quiet — sensing,
  // not conveying).
  g.moveTo(inP.x, inP.y).lineTo(leftX, inP.y);
  g.moveTo(inM.x, inM.y).lineTo(leftX, inM.y);
  // Output spur out to the pin.
  g.moveTo(mx + hw, my).lineTo(out.x, out.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });

  // The comparator core.
  fBox(g, mx, my, hw, hh, o.color);

  // The differential gauge inside: + and − sensor taps on the left wall that glow
  // a touch with the drive — the two readings the core is comparing.
  const tap = leftX + 4;
  const ts = 2.2;
  g.moveTo(tap - ts, inP.y)
    .lineTo(tap + ts, inP.y)
    .moveTo(tap, inP.y - ts)
    .lineTo(tap, inP.y + ts);
  g.moveTo(tap - ts, inM.y).lineTo(tap + ts, inM.y);
  g.stroke({ width: 1.5, color: o.color, alpha: 0.6 + 0.3 * drive });
  // A couple of sparse, still sensor dots on each input lead (no recirculation —
  // they only read), a faint cue that the inputs are live but carry no belt.
  g.circle((inP.x + leftX) / 2, inP.y, 1.2).fill({
    color: o.color,
    alpha: 0.4,
  });
  g.circle((inM.x + leftX) / 2, inM.y, 1.2).fill({
    color: o.color,
    alpha: 0.4,
  });

  // The FAT output belt out the right wall: its width grows with how hard the
  // output is driving (a thin idle throat, a wide channel when sourcing current).
  const beltW = 2 + 8 * drive;
  if (drive > 0.02) {
    g.roundRect(mx + hw, my - beltW / 2, out.x - (mx + hw), beltW, 2).fill({
      color: o.color,
      alpha: 0.22 + 0.3 * drive,
    });
  }

  // The output drive flow, signed so it reverses with Iout and fades when idle.
  flow(g, mx + hw, my, out.x, my, o.electrical.current, o.phase, 0x46d2e6);
}

// The logic gate as a Factorio decider/sorter: input belts arrive on the left, a
// threshold "decider" body weighs them, and one decided belt leaves on the right.
// The output belt's width + flow track |Iout| (lit when driving a load). The left
// intake wall is straight for AND, concave for OR/XOR; an inversion shows as a
// bubble on the output throat, XOR as a doubled intake.
function gateFactory(
  g: Graphics,
  o: GlyphOpts,
  shape: GateShape,
  inverted: boolean,
  xor: boolean,
): void {
  const out = o.pins[0];
  const inA = o.pins[1];
  if (!out || !inA) return;
  const inB = o.pins[2];
  const midY = inB ? (inA.y + inB.y) / 2 : inA.y;
  const leftX = Math.min(inA.x, inB?.x ?? inA.x) + 9;
  const hw = 11;
  const mx = leftX + hw;
  const hh = (inB ? Math.abs(inA.y - midY) : 9) + 3;
  const col = o.color;
  const drive = norm(o.electrical.current, CUR_SCALE);
  const throatX = mx + hw + (inverted ? 8 : 0);

  // Input probe leads in, output throat out.
  g.moveTo(inA.x, inA.y).lineTo(leftX, inA.y);
  if (inB) g.moveTo(inB.x, inB.y).lineTo(leftX, inB.y);
  g.moveTo(throatX, midY).lineTo(out.x, out.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });

  // The decider body.
  fBox(g, mx, midY, hw, hh, col);

  // Intake wall: straight for AND, concave for OR/XOR (and the inverter). Doubled
  // for XOR (the "exclusive" extra gate).
  const drawIntake = (xoff: number): void => {
    if (shape === "and") {
      g.moveTo(leftX + xoff, midY - hh + 3).lineTo(leftX + xoff, midY + hh - 3);
    } else {
      g.moveTo(leftX + xoff, midY - hh + 3).quadraticCurveTo(
        leftX + xoff + 4,
        midY,
        leftX + xoff,
        midY + hh - 3,
      );
    }
    g.stroke({ width: 1.4, color: col, alpha: 0.55 });
  };
  drawIntake(1);
  if (xor) drawIntake(-3);

  // Sparse input probe dots (sensing, not conveying).
  for (const p of inB ? [inA, inB] : [inA]) {
    g.circle((p.x + leftX) / 2, p.y, 1.2).fill({ color: col, alpha: 0.45 });
  }

  // The decided output belt: width grows with the drive.
  const beltW = 2 + 8 * drive;
  if (drive > 0.02) {
    g.roundRect(mx + hw, midY - beltW / 2, throatX - (mx + hw), beltW, 2).fill({
      color: col,
      alpha: 0.22 + 0.3 * drive,
    });
  }

  // Inversion bubble on the output throat (NAND / NOR / NOT).
  if (inverted) {
    g.circle(mx + hw + 4, midY, 3).stroke({
      width: 1.8,
      color: col,
      alpha: 0.9,
    });
  }

  // The decided output flow, signed by Iout.
  flow(g, throatX, midY, out.x, midY, o.electrical.current, o.phase, 0x46d2e6);
}

function drawFAND(g: Graphics, o: GlyphOpts): void {
  gateFactory(g, o, "and", false, false);
}
function drawFOR(g: Graphics, o: GlyphOpts): void {
  gateFactory(g, o, "or", false, false);
}
function drawFNAND(g: Graphics, o: GlyphOpts): void {
  gateFactory(g, o, "and", true, false);
}
function drawFNOR(g: Graphics, o: GlyphOpts): void {
  gateFactory(g, o, "or", true, false);
}
function drawFXOR(g: Graphics, o: GlyphOpts): void {
  gateFactory(g, o, "or", false, true);
}
function drawFXNOR(g: Graphics, o: GlyphOpts): void {
  gateFactory(g, o, "or", true, true);
}
function drawFNOT(g: Graphics, o: GlyphOpts): void {
  gateFactory(g, o, "not", true, false);
}
function drawFBUF(g: Graphics, o: GlyphOpts): void {
  gateFactory(g, o, "not", false, false);
}

// The transformer as a Factorio voltage-converter station: the primary belt pair
// feeds a core "converter" that drives the secondary belt pair out the other side,
// scaled by the turns ratio. The core bars pulse with the primary current; the
// primary flow and a coupled secondary shimmer ride the bounded clock.
function drawFTR(g: Graphics, o: GlyphOpts): void {
  const pp = o.pins[0];
  const pm = o.pins[1];
  const sp = o.pins[2];
  const sm = o.pins[3];
  if (!pp || !pm || !sp || !sm) return;
  const midX = (pp.x + sp.x) / 2;
  const my = (pp.y + pm.y) / 2;
  const hw = 12;
  const hh = Math.max(pm.y, sm.y) - my + 2;
  const drive = norm(o.electrical.current, CUR_SCALE);

  // Primary leads in from the left, secondary leads out to the right.
  g.moveTo(pp.x, pp.y).lineTo(midX - hw, pp.y);
  g.moveTo(pm.x, pm.y).lineTo(midX - hw, pm.y);
  g.moveTo(midX + hw, sp.y).lineTo(sp.x, sp.y);
  g.moveTo(midX + hw, sm.y).lineTo(sm.x, sm.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });

  // The converter body.
  fBox(g, midX, my, hw, hh, o.color);

  // Core flux bars down the middle, brightening with the primary current.
  const s = 1 + 0.1 * Math.sin(o.phase * PULSE_K);
  g.moveTo(midX - 2, my - hh + 3).lineTo(midX - 2, my + hh - 3);
  g.moveTo(midX + 2, my - hh + 3).lineTo(midX + 2, my + hh - 3);
  g.stroke({ width: 1.6, color: o.color, alpha: 0.5 + 0.35 * drive * s });

  // Primary intake flow, signed by Ip.
  flow(g, midX - hw, my, midX, my, o.electrical.current, o.phase, 0x46d2e6);
  // Secondary output shimmer (induced; its current isn't separately read).
  if (drive > 0.04) {
    for (let i = 0; i < 3; i++) {
      const t = (((i / 3 + o.phase * FLOW_SPEED) % 1) + 1) % 1;
      g.circle(midX + hw + (sp.x - midX - hw) * t, my, 1.5).fill({
        color: 0x46d2e6,
        alpha: 0.3 + 0.3 * drive,
      });
    }
  }
}

// The potentiometer as a Factorio throttle: a resistive channel A→B with a sliding
// tap (the wiper) that picks off the belt partway along, at the wiper position.
function drawFPOT(g: Graphics, o: GlyphOpts): void {
  const a = o.pins[0];
  const b = o.pins[1];
  const w = o.pins[2];
  if (!a || !b || !w) return;
  const x0 = a.x + 6;
  const x1 = b.x - 6;
  const trackY = a.y;
  const t = Math.min(1, Math.max(0, o.wiper ?? 0.5));
  const heat = norm(o.electrical.current, CUR_SCALE);

  // End leads + the channel body.
  g.moveTo(a.x, a.y).lineTo(x0, trackY);
  g.moveTo(x1, trackY).lineTo(b.x, b.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });
  g.roundRect(x0, trackY - 5, x1 - x0, 10, 2).fill({
    color: 0x161020,
    alpha: 0.96,
  });
  g.roundRect(x0, trackY - 5, x1 - x0, 10, 2).stroke({
    width: 1.6,
    color: o.color,
    alpha: 0.9,
  });

  // The sliding tap at the wiper position, with the wiper lead from W.
  const tapX = x0 + t * (x1 - x0);
  const tapY = trackY + 9;
  g.moveTo(w.x, w.y)
    .lineTo(w.x, tapY)
    .lineTo(tapX, tapY)
    .lineTo(tapX, trackY + 5);
  g.stroke({ width: 2, color: o.color, alpha: 0.9 });
  g.rect(tapX - 2, trackY - 5, 4, 10).fill({ color: o.color, alpha: 0.8 });

  // Belt flow along the channel, signed by the A→W leg current.
  flow(g, x0, trackY, x1, trackY, o.electrical.current, o.phase, 0x46d2e6);
  if (heat > 0.03) {
    g.roundRect(x0, trackY - 5, x1 - x0, 10, 2).fill({
      color: 0xe0533a,
      alpha: 0.14 * heat,
    });
  }
}

// The flip-flop as a Factorio single-bin store with a clocked gate: D arrives on the
// left, a clock pulse on the bottom-left latches it, and the held bit feeds the Q /
// Q̄ output belts on the right. The clock intake is marked with the edge ">" notch.
function drawFFF(g: Graphics, o: GlyphOpts): void {
  const q = o.pins[0];
  const d = o.pins[1];
  const clk = o.pins[2];
  const qb = o.pins[3];
  if (!q || !d || !clk || !qb) return;
  const mx = (d.x + q.x) / 2;
  const my = (d.y + clk.y) / 2;
  const hw = 11;
  const hh = Math.max(clk.y, qb.y) - my + 2;
  const drive = norm(o.electrical.current, CUR_SCALE);

  // Input/output leads.
  g.moveTo(d.x, d.y).lineTo(mx - hw, d.y);
  g.moveTo(clk.x, clk.y).lineTo(mx - hw, clk.y);
  g.moveTo(mx + hw, q.y).lineTo(q.x, q.y);
  g.moveTo(mx + hw, qb.y).lineTo(qb.x, qb.y);
  g.stroke({ width: 2, color: 0x6b6488, alpha: 0.85 });

  // The store body + the edge-clock notch on the left wall at the CLK input.
  fBox(g, mx, my, hw, hh, o.color);
  g.moveTo(mx - hw, clk.y - 4)
    .lineTo(mx - hw + 5, clk.y)
    .lineTo(mx - hw, clk.y + 4)
    .stroke({ width: 1.6, color: o.color, alpha: 0.8 });

  // The Q output belt (signed) + a faint Q̄ complement.
  flow(g, mx + hw, q.y, q.x, q.y, o.electrical.current, o.phase, 0x46d2e6);
  if (drive > 0.04) {
    for (let i = 0; i < 2; i++) {
      const t = (((i / 2 + o.phase * FLOW_SPEED) % 1) + 1) % 1;
      g.circle(mx + hw + (qb.x - mx - hw) * t, qb.y, 1.4).fill({
        color: 0x46d2e6,
        alpha: 0.3,
      });
    }
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
  EC: drawEC,
  L: drawL,
  I: drawI,
  AC: drawAC,
  GND: drawGND,
  D: drawD,
  SD: drawSD,
  LED: drawLED,
  ZD: drawZD,
  MOV: drawMOV,
  SW: drawSW,
  MSW: drawMSW,
  NM: drawNM,
  PM: drawPM,
  Q: drawQ,
  QP: drawQP,
  OA: drawOA,
  AND: drawAND,
  OR: drawOR,
  NAND: drawNAND,
  NOR: drawNOR,
  XOR: drawXOR,
  XNOR: drawXNOR,
  NOT: drawNOT,
  BUF: drawBUF,
  TR: drawTR,
  POT: drawPOT,
  FF: drawFF,
};

const FACTORY_DRAWERS: Record<string, (g: Graphics, o: GlyphOpts) => void> = {
  V: drawFV,
  R: drawFR,
  C: drawFC,
  EC: drawFEC,
  L: drawFL,
  I: drawFI,
  AC: drawFAC,
  GND: drawFGND,
  D: drawFD,
  SD: drawFSD,
  LED: drawFLED,
  ZD: drawFZD,
  MOV: drawFMOV,
  SW: drawFSW,
  MSW: drawFMSW,
  NM: drawFNM,
  PM: drawFPM,
  Q: drawFQ,
  QP: drawFQP,
  OA: drawFOA,
  AND: drawFAND,
  OR: drawFOR,
  NAND: drawFNAND,
  NOR: drawFNOR,
  XOR: drawFXOR,
  XNOR: drawFXNOR,
  NOT: drawFNOT,
  BUF: drawFBUF,
  TR: drawFTR,
  POT: drawFPOT,
  FF: drawFFF,
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

/** Draw a component's glyph + state animation into the (pre-cleared) Graphics, in
 * an **explicit** style, independent of the global board lens — used by the info
 * diagram's tier selector so previewing the Factory (analogy) tier never flips the
 * board itself. Falls back to the schematic drawer, then a generic card. */
export function drawGlyphIn(
  g: Graphics,
  o: GlyphOpts,
  style: GlyphStyle,
): void {
  const map = style === "factory" ? FACTORY_DRAWERS : DRAWERS;
  const drawer = map[o.kind] ?? DRAWERS[o.kind];
  if (drawer) drawer(g, o);
  else drawCard(g, o);
}

/** Whether the kind has dedicated Factory (analogy) art (vs. falling back to the
 * schematic symbol). Lets the info panel show the Factory tier only when it differs. */
export function hasFactory(kind: string): boolean {
  return kind in FACTORY_DRAWERS;
}

/** Draw a component's glyph + state animation into the (pre-cleared) Graphics,
 * in the active board style (schematic symbols, or the Factory machine lens). */
export function drawGlyph(g: Graphics, o: GlyphOpts): void {
  drawGlyphIn(g, o, currentStyle);
}

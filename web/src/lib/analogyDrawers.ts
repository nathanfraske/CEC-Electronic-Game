// SPDX-License-Identifier: Apache-2.0
// Analogy-tier drawers: the full-panel "factory machine" METAPHOR for a part —
// the intuitive physical picture that builds a feel for what V / I / charge / flux
// mean (water forced through a throat, a paddle-wheel flywheel in a pipe, a
// spring-loaded piston, belted wheels). The middle of the owner's three tiers
// (docs/ui/part-demos-tiers.md), ported from the tier-2 panels of the design refs
// in docs/ui/parts/*.html.
//
// A sibling of detailDrawers.ts (the reality tier): same full-bounds illustration
// pattern and shared tierKit primitives, but the analogy vocabulary instead of the
// device internals. Pure presentation — it READS the live ElectricalState + the
// board's shared phase clock and NEVER feeds the sim, the netlist, or the snapshot
// hash. It recolours from PALETTE and honours the bus-language discipline
// (docs/ui/visual-language.md): magnitude rides alpha / density / thickness, NEVER
// speed; the machinery turns at the calm bounded `phase` rate and direction only.
//
// These render at the same fidelity as the reality tier (no text — the info panel
// supplies the telemetry rows separately), so the analogy tier reads as richly as
// the design doc rather than a scaled-up board glyph.

import { Graphics } from "pixi.js";
import { PALETTE } from "./graph";
import {
  THERMISTOR_TEMP,
  type ThermistorKind,
  tempNorm,
  thermistorOpenness,
  thermistorResistance,
} from "./thermistor";
import {
  type TierOpts as AnalogyOpts,
  anchorPt,
  belt,
  dotPresence,
  flowAlongPath,
  flowAroundBall,
  flowAroundPlug,
  flowSplit,
  flowThroughGap,
  housing,
  mix,
  norm,
  pipeLead,
  scatterY,
  stud,
  CUR_SCALE,
  FLOW_SPEED,
  FLOW_DOTS_MAX,
  OUT_SCALE,
  PULSE_K,
  V_SCALE,
} from "./tierKit";

// Shared analogy palette: water (cool flow), warm (the moving current/energy),
// pressure (the violet return / resistance), all from PALETTE so one source recolours.
const WATER = mix(PALETTE.cyan, PALETTE.violet, 0.22); // the medium in the pipes
const WATER2 = mix(PALETTE.cyan, 0xffffff, 0.35); // brighter water (surfaces / spill)
const WARM = mix(PALETTE.bronze, 0xffffff, 0.45); // moving current / hot energy
const PRESS = PALETTE.violet; // pressure / resistance / return
const PLATE = mix(PALETTE.dim, 0xffffff, 0.5); // bright metal (piston / tank plates)
const SPRING = PALETTE.accent; // the capacitor pushing back (rose)

/** A zig-zag spring polyline from (x0,yc) to (x1,yc), `coils` zig-zags at ±amp. */
function springPts(
  x0: number,
  x1: number,
  yc: number,
  amp: number,
  coils: number,
): number[] {
  const n = coils * 2;
  const pts: number[] = [x0, yc];
  for (let k = 1; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n;
    const y = k === n ? yc : yc + (k % 2 ? -amp : amp);
    pts.push(x, y);
  }
  return pts;
}

/** A vertical zig-zag spring from (xc,y0) to (xc,y1), `coils` zig-zags at ±amp. */
function vSpringPts(
  xc: number,
  y0: number,
  y1: number,
  amp: number,
  coils: number,
): number[] {
  const n = coils * 2;
  const pts: number[] = [xc, y0];
  for (let k = 1; k <= n; k++) {
    const y = y0 + ((y1 - y0) * k) / n;
    const x = k === n ? xc : xc + (k % 2 ? -amp : amp);
    pts.push(x, y);
  }
  return pts;
}

/** A smooth vertical coil spring (a sine, like varistor-tiers.html's `vcoil`) from
 * (xc,y0) to (xc,y1) — `coils` full turns of half-width `amp`. Reads as a real spring. */
function vcoilPts(
  xc: number,
  y0: number,
  y1: number,
  amp: number,
  coils: number,
): number[] {
  const n = Math.max(2, Math.round(coils * 8));
  const pts: number[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    pts.push(xc + Math.sin(t * coils * Math.PI * 2) * amp, y0 + (y1 - y0) * t);
  }
  return pts;
}

/**
 * The diode family's forward CHECK VALVE — bronze seat lips, a spring to a plunger, and a
 * ball the forward push lifts off its seat; when OPEN the water PARTS AROUND the ball (an
 * obstacle it skirts, not a hole it pours through). Shared by every diode (plain,
 * Schottky, LED, Zener) so they read identically and the ball size + flow tune in ONE
 * place. Draws the seat, spring, forward flow, then the ball on the axis at `cy`; the
 * caller owns the housing + pipes and any reverse / blocked flow (those differ per part).
 */
function forwardCheckValve(
  g: Graphics,
  v: {
    cy: number;
    pipeHH: number; // the thin pipe half-height (sets the seat throat)
    chamberHH: number; // the valve chamber half-height (how far the flow may bulge)
    seatX: number;
    plungerX: number;
    ballR: number;
    liftX: number; // ball centre, already lifted by the caller's forward amount
    inX: number; // forward inlet x (anode side)
    outX: number; // forward outlet x (cathode side)
    open: number; // 0..1 forward openness → flow density (≤0.03 ⇒ no forward flow)
    phase: number;
    ballColor: number;
  },
): void {
  const { cy, pipeHH, seatX, plungerX, ballR, liftX } = v;
  // seat lips — two bronze lips; the ball seals the throat between them
  for (const s of [-1, 1]) {
    g.poly([
      seatX - 10,
      cy + s * (pipeHH + 6),
      seatX + 8,
      cy + s * (pipeHH + 6),
      seatX + 3,
      cy + s * pipeHH * 0.4,
      seatX - 5,
      cy + s * pipeHH * 0.4,
    ]).fill({ color: PALETTE.bronze, alpha: 0.9 });
  }
  // plunger backstop + spring (compresses as the ball lifts toward it)
  g.roundRect(plungerX, cy - ballR, 8, ballR * 2, 2).fill({
    color: PALETTE.rail,
    alpha: 0.9,
  });
  g.poly(springPts(liftX + ballR, plungerX, cy, ballR * 0.5, 6), false).stroke({
    width: 2.4,
    color: WARM,
    alpha: 0.85,
  });
  // forward flow: belts along the inlet + outlet pipe, PARTING around the ball between
  // (so the parting stays dense and legible instead of a few dots lost over the run).
  if (v.open > 0.03) {
    const w0 = seatX - ballR;
    const w1 = plungerX + ballR;
    belt(g, v.inX, cy, w0, cy, v.open, 1, v.phase, WATER, 2.4);
    flowAroundBall(
      g,
      w0,
      w1,
      cy,
      v.chamberHH,
      liftX,
      ballR,
      v.open,
      v.phase,
      WATER,
      2.4,
    );
    belt(g, w1, cy, v.outX, cy, v.open, 1, v.phase, WATER, 2.4);
  }
  // the ball + its highlight (drawn last, on top of the flow)
  g.circle(liftX, cy, ballR).fill({ color: v.ballColor, alpha: 0.92 });
  g.circle(liftX, cy, ballR).stroke({
    width: 1.4,
    color: 0xdce3f0,
    alpha: 0.6,
  });
  g.circle(liftX - ballR * 0.34, cy - ballR * 0.34, ballR * 0.22).fill({
    color: 0xffffff,
    alpha: 0.7,
  });
}

// ============================================================================
// Inductor — ported from inductor-tiers.html tier 2: a heavy PADDLE-WHEEL FLYWHEEL
// in a pipe. The pump (left) drives water through; a valve (= series R) throttles
// it; the water spins the flywheel. The wheel's spin IS the current and its
// momentum is the stored energy; the pressure across the wheel is the voltage,
// present only while the spin is CHANGING (V = L·dI/dt); a heavier (bigger) wheel
// resists change more — more inductance.
//
// Live mapping (inductor ElectricalState: I = current a→b, V_L = V(a)−V(b)):
//   • flow / spin  = norm(|I|)  → water-dot + swirl density/alpha, wheel-blade
//     brightness, energy-halo size. Sign of I sets the spin + flow direction.
//   • pressure     = V_L        → the two pressure spouts across the wheel rise/
//     fall oppositely (the differential), present only while the current changes.
//   • inductance   = value (H)  → the wheel's radius (a heavier flywheel).
// The wheel turns at the calm bounded `phase` rate (never scaled by |I|), so it
// pauses and flows with the sim like the board belts.
// ============================================================================
function drawAnalogyInductor(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;

  const i = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1;
  // Signed pressure across the wheel, present only while the current changes.
  const press = Math.max(
    -1,
    Math.min(1, o.electrical.vAcross / (V_SCALE * 1.4)),
  );
  const changing = Math.abs(press);

  // --- pipe geometry -----------------------------------------------------------
  const pipeHH = hh * 0.17; // pipe half-height
  const aX = -hw + 8; // left terminal (lead) stud
  const bX = hw - 8; // right terminal stud
  const pipeR = bX - 4;
  const pumpX = -hw * 0.72; // the driving pump
  const valveX = -hw * 0.4; // the throttling valve (= series R)
  const cx = 0; // chamber / wheel centre x
  const chamR = hh * 0.66; // chamber radius
  // Wheel radius grows with inductance (a heavier flywheel resists change more).
  const wheelR = hh * (0.36 + 0.2 * (o.value ? norm(o.value, 0.2) : 0.5));

  // --- energy halo behind the wheel (stored ½L·I²) -----------------------------
  if (i > 0.03) {
    g.circle(cx, 0, wheelR * (0.8 + 0.5 * i)).fill({
      color: PALETTE.bronze,
      alpha: 0.06 + 0.22 * i,
    });
  }

  // --- the pipe walls + water-filled body, terminal-to-terminal (one continuous
  // flowing pipe that meets the board's wire-pipes, not a thin wireframe) ---------
  g.rect(aX, -pipeHH, bX - aX, 2 * pipeHH).fill({ color: WATER, alpha: 0.08 });
  for (const s of [-1, 1]) {
    g.moveTo(aX, s * pipeHH)
      .lineTo(bX, s * pipeHH)
      .stroke({ width: 2.5, color: PALETTE.border, alpha: 0.9 });
  }

  // --- the pump (left): a cyan piston that nudges out with the flow ------------
  const pumpThrow = 6 * i;
  g.roundRect(pumpX - 9, -pipeHH - 8, 18, pipeHH * 2 + 16, 4).fill({
    color: 0x141a2c,
    alpha: 0.95,
  });
  g.roundRect(pumpX - 9, -pipeHH - 8, 18, pipeHH * 2 + 16, 4).stroke({
    width: 1.6,
    color: PALETTE.cyan,
    alpha: 0.7,
  });
  g.roundRect(pumpX - 4 + pumpThrow, -pipeHH, 7, pipeHH * 2, 2).fill({
    color: PALETTE.cyan,
    alpha: 0.55,
  });

  // --- the valve = series R: a violet throat that pinches the pipe -------------
  const throat = pipeHH * 0.5;
  g.poly([valveX - 9, -pipeHH, valveX, -throat, valveX + 9, -pipeHH]).fill({
    color: PRESS,
    alpha: 0.5,
  });
  g.poly([valveX - 9, pipeHH, valveX, throat, valveX + 9, pipeHH]).fill({
    color: PRESS,
    alpha: 0.5,
  });

  // --- the wheel chamber -------------------------------------------------------
  g.circle(cx, 0, chamR).fill({ color: 0x10131f, alpha: 0.82 });
  g.circle(cx, 0, chamR).stroke({
    width: 2,
    color: PALETTE.border,
    alpha: 0.9,
  });

  // --- pressure spouts across the wheel (the voltage, only while changing) -----
  // Inlet (left) and outlet (right) standpipes rise/fall oppositely with V_L — the
  // pressure differential. Equal (flat) at steady current; tallest during a step.
  if (changing > 0.04) {
    const span = hh * 0.5;
    const inH = span * (0.5 + 0.5 * press);
    const outH = span * (0.5 - 0.5 * press);
    const inX = cx - chamR - 6;
    const outX = cx + chamR + 6;
    g.roundRect(inX - 3, -pipeHH - inH, 6, inH, 2).fill({
      color: WARM,
      alpha: 0.4 + 0.5 * changing,
    });
    g.roundRect(outX - 3, -pipeHH - outH, 6, outH, 2).fill({
      color: WARM,
      alpha: 0.4 + 0.5 * changing,
    });
  }

  // --- the flywheel: N spokes + paddle blades, one WARM reference spoke ---------
  const spokes = 6;
  const spin = o.phase * FLOW_SPEED * dir * Math.PI; // calm phase-driven rotation
  g.circle(cx, 0, wheelR).stroke({
    width: 3,
    color: PALETTE.bronze,
    alpha: 0.35 + 0.5 * i,
  });
  for (let k = 0; k < spokes; k++) {
    const a = spin + (k / spokes) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const col = k === 0 ? PALETTE.warn : PALETTE.bronze;
    const alpha = (k === 0 ? 0.6 : 0.45) + 0.45 * i;
    // spoke from hub to rim
    g.moveTo(cx + ca * wheelR * 0.18, sa * wheelR * 0.18)
      .lineTo(cx + ca * wheelR * 0.96, sa * wheelR * 0.96)
      .stroke({ width: 3, color: col, alpha });
    // paddle blade across the rim (perpendicular to the spoke)
    const rxp = cx + ca * wheelR * 0.96;
    const ryp = sa * wheelR * 0.96;
    const px = -sa;
    const py = ca;
    const blade = wheelR * 0.22;
    g.moveTo(rxp - px * blade, ryp - py * blade)
      .lineTo(rxp + px * blade, ryp + py * blade)
      .stroke({ width: 3.4, color: col, alpha });
  }
  g.circle(cx, 0, wheelR * 0.16).fill({ color: PALETTE.bronze, alpha: 0.9 });

  // --- swirl of water around the wheel (recirculating flow) --------------------
  if (i > 0.02) {
    const n = FLOW_DOTS_MAX;
    for (let k = 0; k < n; k++) {
      const present = dotPresence(k, i);
      if (present <= 0) continue;
      const t = (((k / n + o.phase * FLOW_SPEED * dir) % 1) + 1) % 1;
      const a = t * Math.PI * 2;
      g.circle(
        cx + Math.cos(a) * chamR * 0.9,
        Math.sin(a) * chamR * 0.9,
        2.6,
      ).fill({ color: WATER, alpha: (0.3 + 0.5 * i) * present });
    }
  }

  // --- terminal studs + the water flowing along the pipe -----------------------
  stud(g, aX, 0, PALETTE.bronze);
  stud(g, bX, 0, PALETTE.bronze);
  belt(g, valveX + 9, 0, cx - chamR, 0, i, dir, o.phase, WATER, 2.6);
  belt(g, cx + chamR, 0, pipeR, 0, i, dir, o.phase, WATER, 2.6);
}

// ============================================================================
// Resistor — ported from resistor-tiers.html tier 2: water in a pipe with a narrow
// THROAT. The throat IS the resistance — more resistance, a tighter throat, less
// flow for the same push. The water funnels through the gap (continuity) and the
// friction there is the heat. Two standpipes read the pressure on each side; the
// height difference between them is the voltage drop.
//
// Live mapping (resistor ElectricalState: current a→b, vAcross = V(a)−V(b)):
//   • flow   = norm(|I|)        → water-dot density/alpha (NOT speed). Sign of the
//     drop orients the flow direction + which standpipe stands high.
//   • drop   = vAcross          → the upstream/downstream standpipe column heights.
//   • heat   = norm(|V·I|)      → the throat glow (and a hot tint as it's pushed).
//   • R      = value (Ω)        → the throat tightness (a tighter gap).
// ============================================================================
function openingAt(
  x: number,
  pipeL: number,
  pipeR: number,
  full: number,
  throatHalf: number,
): number {
  const cx = (pipeL + pipeR) / 2;
  const throatW = (pipeR - pipeL) * 0.16; // half-width of the pinched region
  const d = Math.abs(x - cx);
  if (d >= throatW) return full;
  const s = d / throatW; // 0 at the centre, 1 at the throat shoulders
  const sm = s * s * (3 - 2 * s); // smoothstep
  return throatHalf + (full - throatHalf) * sm;
}

function drawAnalogyResistor(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;

  const cur = norm(o.electrical.current, CUR_SCALE);
  const power = norm(
    Math.abs(o.electrical.vAcross * o.electrical.current),
    V_SCALE * CUR_SCALE,
  );
  const aHigh = o.electrical.vAcross >= 0; // terminal a is the high-pressure side
  const dir = aHigh ? 1 : -1;
  const heatCol = mix(PALETTE.warn, PALETTE.bad, power);

  const aX = -hw + 8;
  const bX = hw - 8;
  const pipeL = aX + 4;
  const pipeR = bX - 4;
  const full = hh * 0.22; // wide-pipe half-height
  // A tighter throat for more resistance (value = R in ohms).
  const rNorm = o.value ? norm(o.value, 1000) : 0.5;
  const throatHalf = full * (1 - 0.72 * rNorm);
  const cx = 0;

  // --- heat glow at the throat (friction = power) ------------------------------
  if (power > 0.04) {
    g.ellipse(cx, 0, hw * (0.16 + 0.06 * power), full * (1.6 + power)).fill({
      color: heatCol,
      alpha: Math.min(0.5, 0.5 * power),
    });
  }

  // --- the pipe walls (the throat profile) + water-filled body -----------------
  const N = 28;
  const top: number[] = [];
  const bot: number[] = [];
  for (let k = 0; k <= N; k++) {
    const x = pipeL + (k / N) * (pipeR - pipeL);
    const op = openingAt(x, pipeL, pipeR, full, throatHalf);
    top.push(x, -op);
    bot.push(x, op);
  }
  // body fill: the water inside the pipe (top wall, then bottom wall reversed)
  const body = top.slice();
  for (let k = bot.length - 2; k >= 0; k -= 2) body.push(bot[k]!, bot[k + 1]!);
  g.poly(body).fill({ color: PALETTE.cyan, alpha: 0.07 });
  g.poly(top, false).stroke({ width: 3, color: PALETTE.bronze, alpha: 0.95 });
  g.poly(bot, false).stroke({ width: 3, color: PALETTE.bronze, alpha: 0.95 });

  // --- two standpipes: pressure each side; the difference is the drop ----------
  const tubeTop = -hh * 0.92;
  const upX = cx - (pipeR - pipeL) * 0.22;
  const dnX = cx + (pipeR - pipeL) * 0.22;
  const vMag = Math.min(1, Math.abs(o.electrical.vAcross) / V_SCALE);
  const colH = hh * 0.18 + hh * 0.46 * vMag; // upstream column tracks the drop
  const colLo = hh * 0.18; // downstream reference column
  const upH = aHigh ? colH : colLo;
  const dnH = aHigh ? colLo : colH;
  const upCol = aHigh ? PALETTE.cyan : PALETTE.violet;
  const dnCol = aHigh ? PALETTE.violet : PALETTE.cyan;
  for (const [sx, h, col] of [
    [upX, upH, upCol],
    [dnX, dnH, dnCol],
  ] as const) {
    g.moveTo(sx, -full)
      .lineTo(sx, tubeTop)
      .stroke({ width: 1.5, color: PALETTE.border, alpha: 0.8 });
    g.roundRect(sx - 5, tubeTop, 10, -full - tubeTop, 2).stroke({
      width: 1.4,
      color: PALETTE.border,
      alpha: 0.7,
    });
    g.roundRect(sx - 4, -full - h, 8, h, 2).fill({ color: col, alpha: 0.85 });
  }

  // --- the water funnelling through the throat (3 lanes converge) --------------
  if (cur > 0.02) {
    const lanes = [-0.62, 0, 0.62];
    const N2 = FLOW_DOTS_MAX;
    for (const lane of lanes) {
      for (let k = 0; k < N2; k++) {
        const present = dotPresence(k, cur);
        if (present <= 0) continue;
        const t = (((k / N2 + o.phase * FLOW_SPEED * dir) % 1) + 1) % 1;
        const x = pipeL + t * (pipeR - pipeL);
        const op = openingAt(x, pipeL, pipeR, full, throatHalf);
        g.circle(x, lane * (op - 3), 2.6).fill({
          color: WATER,
          alpha: (0.3 + 0.55 * cur) * present,
        });
      }
    }
  }

  // --- terminal studs ----------------------------------------------------------
  stud(g, aX, 0, PALETTE.bronze);
  stud(g, bX, 0, PALETTE.bronze);
}

// ============================================================================
// Ceramic capacitor — ported from capacitor-ceramic-tiers.html tier 2: a sealing
// PISTON ON A SPRING in a pipe. Water flows on both sides but nothing crosses the
// piston (the displacement current — charge in == charge out, yet nothing passes
// the dielectric). The piston slides as the cap charges; the spring is the
// capacitor pushing back (Vc); a taller pipe is a larger capacitance.
//
// Live mapping (cap ElectricalState: current a→b, vAcross = Vc):
//   • charge / Vc = vAcross → piston displacement + spring compression.
//   • flow        = norm(|I|) → water-dot density/alpha both sides; sign sets dir.
//   • capacitance = value (F) → the pipe (piston) height.
// ============================================================================
function drawAnalogyCeramicCap(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;

  const flow = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1;
  // Greatly EXAGGERATED, signed response: a sensitive knee so even a small Vc visibly
  // swings the piston and works the spring (the spring is the whole teaching point),
  // saturating but monotonic so it still reads proportionally.
  const charge =
    Math.sign(o.electrical.vAcross) * norm(o.electrical.vAcross, V_SCALE * 0.3);

  const aX = -hw + 8;
  const bX = hw - 8;
  const pipeR = bX - 4;
  const pipeHH = hh * (0.2 + 0.22 * (o.value ? norm(o.value, 5e-6) : 0.5));
  const pumpX = -hw * 0.74;
  const valveX = -hw * 0.52;
  const anchorX = hw * 0.6; // fixed wall the spring pushes against
  const restX = -hw * 0.1;
  const throwX = hw * 0.44; // bigger swing so the motion is unmistakable
  const pistonX = Math.max(
    valveX + 22,
    Math.min(anchorX - 40, restX + charge * throwX),
  );

  // --- pipe walls + water-filled body, run terminal-to-terminal so the part reads as
  // one continuous flowing pipe that meets the board's wire-pipes (not a thin frame) --
  g.rect(aX, -pipeHH, bX - aX, 2 * pipeHH).fill({ color: WATER, alpha: 0.08 });
  for (const s of [-1, 1]) {
    g.moveTo(aX, s * pipeHH)
      .lineTo(bX, s * pipeHH)
      .stroke({ width: 2.5, color: PALETTE.border, alpha: 0.9 });
  }

  // --- pump (left) + valve = series R throat -----------------------------------
  g.roundRect(pumpX - 9, -pipeHH - 8, 18, pipeHH * 2 + 16, 4).fill({
    color: 0x141a2c,
    alpha: 0.95,
  });
  g.roundRect(pumpX - 9, -pipeHH - 8, 18, pipeHH * 2 + 16, 4).stroke({
    width: 1.6,
    color: PALETTE.cyan,
    alpha: 0.65,
  });
  g.roundRect(pumpX - 3 + 5 * flow, -pipeHH, 6, pipeHH * 2, 2).fill({
    color: PALETTE.cyan,
    alpha: 0.5,
  });
  for (const s of [-1, 1]) {
    g.poly([
      valveX - 8,
      s * pipeHH,
      valveX,
      s * pipeHH * 0.5,
      valveX + 8,
      s * pipeHH,
    ]).fill({ color: PRESS, alpha: 0.5 });
  }

  // --- the spring (piston → fixed anchor): tighter as Vc grows ------------------
  const compressed = (charge + 1) / 2; // 0..1
  g.moveTo(anchorX, -pipeHH)
    .lineTo(anchorX, pipeHH)
    .stroke({ width: 4, color: PALETTE.rail, alpha: 0.9 });
  g.poly(springPts(pistonX + 4, anchorX, 0, pipeHH * 0.42, 7), false).stroke({
    width: 2.6,
    color: SPRING,
    alpha: 0.55 + 0.4 * compressed,
  });

  // --- the sealing piston ------------------------------------------------------
  g.roundRect(pistonX - 4, -pipeHH, 8, pipeHH * 2, 1).fill({
    color: PLATE,
    alpha: 0.95,
  });
  g.roundRect(pistonX - 4, -pipeHH, 8, pipeHH * 2, 1).stroke({
    width: 1,
    color: 0xdfe3ee,
    alpha: 0.6,
  });

  // --- water both sides (nothing crosses the piston) ---------------------------
  belt(g, valveX + 8, 0, pistonX - 6, 0, flow, dir, o.phase, WATER, 2.6);
  belt(g, anchorX + 6, 0, pipeR, 0, flow, dir, o.phase, WATER, 2.6);

  stud(g, aX, 0, PALETTE.bronze);
  stud(g, bX, 0, PALETTE.bronze);
}

// ============================================================================
// Electrolytic capacitor — ONE BIG RESERVOIR. The current flows IN the + lead and OUT
// the − lead (the charge current), filling/draining the tank; the water LEVEL is the
// voltage across it (Vc) — a gauge marker rides the surface so the stored voltage reads
// directly. A wider tank holds more charge per volt (more capacitance). The flow fades
// to nothing as it charges up (|I| → 0 at steady state), the level holding where it sits.
//
// Live mapping (cap ElectricalState: current a→b, vAcross = Vc):
//   • level / Vc  = vAcross   → water-column height + the gauge marker (the voltage).
//   • flow        = norm(|I|) → in/out lead dot density; sign = charge vs discharge.
//   • capacitance = value (F) → the tank width.
// ============================================================================
function drawAnalogyElectrolyticCap(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;
  const flow = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1; // + = charging (in via the + lead)
  const level = Math.max(
    0,
    Math.min(1, o.electrical.vAcross / (V_SCALE * 1.6)),
  );

  const A = anchorPt(o, "+", -0.85, 0);
  const B = anchorPt(o, "−", 0.85, 0);

  // one big reservoir; a WIDER tank holds more charge per volt (more capacitance)
  const tankHW = hw * (0.24 + 0.2 * (o.value ? norm(o.value, 5e-4) : 0.5));
  const tankT = -hh * 0.5;
  const tankB = hh * 0.62;
  const tankL = -tankHW;
  const tankR = tankHW;
  const fillY = tankB - level * (tankB - tankT);

  // --- flowing pipe leads: IN the + terminal, OUT the − terminal (the charge current).
  // They meet the tank at mid-height where the pins sit, so the part flows continuously
  // into the board's wire-pipes; the dots fade as |I| → 0 (fully charged). -----------
  const lc = mix(WATER, PALETTE.cyan, 0.3);
  pipeLead(g, [A, { x: tankL, y: 0 }], 9, lc, WATER2, flow, dir, o.phase);
  pipeLead(g, [{ x: tankR, y: 0 }, B], 9, lc, WATER2, flow, dir, o.phase);

  // --- the reservoir + its water column (height = the voltage Vc) ---------------
  housing(g, tankL, tankT, tankR - tankL, tankB - tankT, PALETTE.cyan, 5);
  g.rect(tankL + 3, fillY, tankR - tankL - 6, tankB - fillY).fill({
    color: WATER,
    alpha: 0.45,
  });
  // stored charge jiggling in the water
  for (let k = 0; k < 12; k++) {
    const bx = tankL + 9 + ((k * 0.61803) % 1) * (tankR - tankL - 18);
    const by = fillY + 8 + ((k * 0.41 + 0.2) % 1) * (tankB - fillY - 14);
    if (by > tankB - 5 || by < fillY + 4) continue;
    g.circle(bx + Math.sin(o.phase * PULSE_K + k) * 1.4, by, 1.8).fill({
      color: WATER2,
      alpha: 0.7,
    });
  }
  // the live surface = the voltage line (a bright band so the level reads at a glance)
  if (level > 0.015) {
    g.rect(tankL + 3, fillY - 1.5, tankR - tankL - 6, 3).fill({
      color: WATER2,
      alpha: 0.55,
    });
  }
  g.moveTo(tankL + 3, fillY)
    .lineTo(tankR - 3, fillY)
    .stroke({ width: 2.2, color: WATER2, alpha: 0.95 });

  // --- voltage gauge inside the right wall: ticks + a marker riding the level ----
  const gx = tankR - 7;
  for (let t = 0; t <= 4; t++) {
    const ty = tankB - (t / 4) * (tankB - tankT - 6);
    g.moveTo(gx - 4, ty)
      .lineTo(gx, ty)
      .stroke({ width: 1.1, color: PALETTE.border, alpha: 0.5 });
  }
  g.poly([gx, fillY, gx - 9, fillY - 4.5, gx - 9, fillY + 4.5]).fill({
    color: PALETTE.warn,
    alpha: 0.95,
  });

  // --- polarity tags so the directional in/out reads (+ inlet, − outlet) --------
  g.moveTo(A.x + 9, A.y - 4)
    .lineTo(A.x + 9, A.y + 4)
    .moveTo(A.x + 5, A.y)
    .lineTo(A.x + 13, A.y)
    .stroke({ width: 1.6, color: PALETTE.warn, alpha: 0.85 });
  g.moveTo(B.x - 13, B.y)
    .lineTo(B.x - 5, B.y)
    .stroke({ width: 1.8, color: PALETTE.violet, alpha: 0.85 });

  stud(g, A.x, A.y, PALETTE.bronze);
  stud(g, B.x, B.y, PALETTE.bronze);
}

// A spoked pulley wheel centred at (cx,cy), radius r, rotated by `spin`; one WARM
// reference spoke so the rotation reads. `glow` (0..1) brightens it with the drive.
function pulley(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  spin: number,
  glow: number,
): void {
  g.circle(cx, cy, r).stroke({
    width: 3,
    color: PALETTE.bronze,
    alpha: 0.4 + 0.5 * glow,
  });
  for (let k = 0; k < 6; k++) {
    const a = spin + (k / 6) * Math.PI * 2;
    const col = k === 0 ? PALETTE.warn : PALETTE.bronze;
    g.moveTo(cx, cy)
      .lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92)
      .stroke({
        width: 3,
        color: col,
        alpha: (k === 0 ? 0.65 : 0.5) + 0.4 * glow,
      });
  }
  g.circle(cx, cy, r * 0.14).fill({ color: PALETTE.bronze, alpha: 0.9 });
}

// ============================================================================
// Transformer — ported from transformer-tiers.html tier 2: TWO WHEELS AND A FINITE
// STRAP. A primary wheel and a secondary wheel are linked by a strap (the core
// flux). Rock the primary (AC drive) and the strap shuttles, both wheels rock and
// power flows to the load. The wheel-radius ratio is the turns ratio — it sets the
// voltage, its inverse sets the current. The strap has finite travel: crank it
// steadily (DC) and it jams at its end — the core saturating.
//
// Live mapping (transformer ElectricalState: primary current Ip, vAcross = Vp;
// value = turns ratio n = Ns/Np):
//   • drive   = norm(|Ip|) → strap-tick density/alpha + wheel-spoke brightness.
//   • dir     = sign(Ip)   → rock direction (flips each AC half-cycle).
//   • ratio   = value      → secondary-vs-primary wheel radius (the turns ratio).
//   • strap travel = sin(spin) → the flux-gauge pointer between the two sat ends.
// ============================================================================
function drawAnalogyTransformer(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;

  const drive = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1;
  const n = Math.max(0.33, Math.min(3, o.value && o.value > 0 ? o.value : 1));

  // Wheel radii in the turns ratio rs/rp = n; the larger wheel fills baseR.
  const baseR = hh * 0.36;
  const rp = n >= 1 ? baseR / n : baseR;
  const rs = n >= 1 ? baseR : baseR * n;
  const cxP = -hw * 0.4;
  const cxS = hw * 0.4;
  const cy = -hh * 0.08;
  // Drive the rock from the REAL core flux (the magnetising current `Im`) when the
  // sim exposes it: the wheels rock to where the flux actually sits, so a DC flux
  // BIAS sits off-centre and a heavily-driven core pins toward a saturation end —
  // not a free oscillation. Falls back to a calm phase hinge when there's no flux
  // readout. Best observed under slow playback, where the swing reads instead of
  // aliasing. `FLUX_SCALE` is the magnetising current that reads as a strong flux.
  const FLUX_SCALE = 0.3;
  const fluxN =
    o.electrical.flux !== undefined
      ? Math.max(-1, Math.min(1, o.electrical.flux / FLUX_SCALE))
      : Math.sin(o.phase * Math.PI) * dir;
  const rock = fluxN * 1.6;

  // --- AC drive (left) + primary rod -------------------------------------------
  const drvX = -hw + 14;
  g.circle(drvX, cy, 10).stroke({ width: 2, color: PALETTE.cyan, alpha: 0.8 });
  g.moveTo(drvX - 6, cy)
    .quadraticCurveTo(drvX - 3, cy - 7, drvX, cy)
    .quadraticCurveTo(drvX + 3, cy + 7, drvX + 6, cy)
    .stroke({ width: 1.8, color: PALETTE.cyan, alpha: 0.85 });
  g.moveTo(drvX + 10, cy)
    .lineTo(cxP - rp, cy)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });

  // --- load R (right) + secondary rod, dimming if power transfer falters --------
  const loadX = hw - 12;
  g.moveTo(cxS + rs, cy)
    .lineTo(loadX, cy)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });
  g.roundRect(loadX - 6, cy - 16, 12, 32, 3).stroke({
    width: 3,
    color: PALETTE.violet,
    alpha: 0.5 + 0.4 * drive,
  });

  // --- the finite strap (top + bottom tangents) --------------------------------
  for (const s of [-1, 1]) {
    g.moveTo(cxP, cy + s * rp)
      .lineTo(cxS, cy + s * rs)
      .stroke({ width: 3, color: PALETTE.rail, alpha: 0.85 });
  }

  // --- the two wheels (radii = turns ratio), hinging back and forth ------------
  pulley(g, cxP, cy, rp, rock, drive);
  pulley(g, cxS, cy, rs, rock, drive);

  // --- WARM ticks on the strap, shuttling back and forth as the wheels rock -----
  if (drive > 0.03) {
    const topPyP = cy - rp;
    const topPyS = cy - rs;
    const nT = FLOW_DOTS_MAX;
    for (let k = 0; k < nT; k++) {
      const present = dotPresence(k, drive);
      if (present <= 0) continue;
      const u = (((k / nT + 0.14 * fluxN) % 1) + 1) % 1;
      g.circle(cxP + (cxS - cxP) * u, topPyP + (topPyS - topPyP) * u, 2.6).fill(
        {
          color: WARM,
          alpha: (0.3 + 0.5 * drive) * present,
        },
      );
    }
  }

  // --- the flux gauge: strap travel between the two saturation ends ------------
  const trackY = hh * 0.66;
  const thw = hw * 0.34;
  g.moveTo(-thw, trackY)
    .lineTo(thw, trackY)
    .stroke({ width: 2, color: PALETTE.border, alpha: 0.9 });
  for (const sx of [-thw, 0, thw]) {
    g.moveTo(sx, trackY - 6)
      .lineTo(sx, trackY + 6)
      .stroke({ width: 1.6, color: PALETTE.rail, alpha: 0.8 });
  }
  const travel = fluxN; // strap position = the real core-flux level (signed)
  // sat zones at each end brighten as the flux pins toward that travel limit

  for (const end of [-1, 1]) {
    const near = Math.max(0, (travel * end - 0.8) / 0.2);
    g.rect(end > 0 ? thw - 26 : -thw, trackY - 6, 26, 12).fill({
      color: PALETTE.accent,
      alpha: 0.12 + 0.4 * near,
    });
  }
  const px = travel * thw;
  g.poly([px - 6, trackY - 16, px + 6, trackY - 16, px, trackY - 5]).fill({
    color: Math.abs(travel) > 0.8 ? PALETTE.accent : WARM,
    alpha: 0.9,
  });

  // --- primary / secondary terminal studs --------------------------------------
  stud(g, drvX, cy, PALETTE.bronze);
  stud(g, loadX, cy, PALETTE.bronze);
}

// ============================================================================
// Diode — ported from diode-tier2-study.html (the "spring valve"): a SPRING-LOADED
// CHECK VALVE. A ball is held against its seat by a spring; once the forward push
// beats the spring (forward bias past the ~0.7 V knee) the ball lifts off and water
// streams through anode→cathode. Reverse-bias and the ball stays seated — blocked.
// An ordinary diode forced into reverse breakdown stresses the seat (rose glow); an
// LED lights its body as it conducts.
//
// Live mapping (diode ElectricalState: current a→b = anode→cathode, vAcross =
// V(anode)−V(cathode)):
//   • forward = norm(max(0, I))  → ball lift + water stream + (LED) the lamp.
//   • reverse = norm(max(0,−I))  → breakdown stress glow + backward trickle.
//   • bias    = sign(vAcross)    → which side runs high; the dammed trickle side.
// ============================================================================
function drawAnalogyDiode(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;
  const isLED = o.kind === "LED";
  const emit = isLED ? o.color : PALETTE.bad;

  const fwd = norm(Math.max(0, o.electrical.current), CUR_SCALE);
  const rev = norm(Math.max(0, -o.electrical.current), CUR_SCALE);
  const conducting = fwd > 0.03;
  const breakdown = rev > 0.03;

  const aX = -hw + 8;
  const bX = hw - 8;
  const pipeHH = hh * 0.17;
  const bodyL = -hw * 0.34;
  const bodyR = hw * 0.46;
  const seatX = bodyL + 16; // the seat, just inside the anode inlet
  const ballR = hh * 0.13; // small enough that the open flow parts AROUND it
  const plungerX = bodyR - 6; // fixed spring backing, downstream of the ball
  const ballRest = seatX + ballR + 3; // ball sits just downstream of the seat
  // Forward flow pushes the ball DOWNSTREAM (toward the cathode) off its seat,
  // compressing the spring; reverse keeps it seated. (Anode left → cathode right.)
  const liftX = Math.min(plungerX - ballR - 4, ballRest + hw * 0.16 * fwd);

  // --- conduction / breakdown halo ---------------------------------------------
  if (conducting && isLED) {
    const breathe = 0.82 + 0.18 * Math.sin(o.phase * 2.2);
    g.circle(0, 0, Math.min(hh * 0.85, hh * (0.55 + 0.4 * fwd))).fill({
      color: emit,
      alpha: 0.22 * fwd * breathe,
    });
  } else if (breakdown) {
    const breathe = 0.8 + 0.2 * Math.sin(o.phase * 2.2);
    g.circle(seatX, 0, hh * 0.6).fill({
      color: PALETTE.bad,
      alpha: (0.16 + 0.4 * rev) * breathe,
    });
  }

  // --- pipes + valve body ------------------------------------------------------
  for (const s of [-1, 1]) {
    g.moveTo(aX + 4, s * pipeHH)
      .lineTo(bodyL, s * pipeHH)
      .moveTo(bodyR, s * pipeHH)
      .lineTo(bX - 4, s * pipeHH)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }
  housing(
    g,
    bodyL,
    -pipeHH - 12,
    bodyR - bodyL,
    (pipeHH + 12) * 2,
    PALETTE.bronze,
    12,
  );
  if (isLED && conducting) {
    g.roundRect(bodyL, -pipeHH - 12, bodyR - bodyL, (pipeHH + 12) * 2, 12).fill(
      {
        color: emit,
        alpha: 0.18 * fwd,
      },
    );
  }

  // --- reverse / blocked flow (the forward flow is the shared valve's, below) ----
  if (breakdown) {
    belt(g, bX, 0, aX, 0, rev, -1, o.phase, PALETTE.bad, 2.6);
  } else if (!conducting) {
    // reverse-biased & blocked: the water DAMS UP against the seated ball — a packed,
    // jittering column backed up from the anode inlet, denser/taller the harder you push
    // reverse (pressure = |reverse V|). Nothing crosses the valve.
    const press = Math.min(1, Math.max(0, -o.electrical.vAcross) / V_SCALE);
    const damR = seatX - ballR - 3; // right edge of the dam, up against the ball
    g.rect(aX + 2, -pipeHH + 1, damR - aX - 2, 2 * pipeHH - 2).fill({
      color: WATER,
      alpha: 0.08 + 0.16 * press,
    });
    const cols = 3 + Math.round(3 * press);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < 3; r++) {
        const jx = Math.abs(Math.sin(o.phase * 3 + c * 1.3 + r)) * 2; // Brownian press
        const px = damR - 3 - c * 5.5 + jx;
        const py = -pipeHH + 4 + r * (pipeHH - 4);
        g.circle(px, py, 2.1).fill({
          color: WATER2,
          alpha: 0.3 + 0.5 * press,
        });
      }
    }
    // pressure chevrons shoving toward the (closed) seat
    if (press > 0.2) {
      for (let i = 0; i < 2; i++) {
        const cxv = aX + 7 + i * 7;
        g.moveTo(cxv, -4)
          .lineTo(cxv + 4, 0)
          .lineTo(cxv, 4)
          .stroke({
            width: 1.6,
            color: mix(WATER2, 0xffffff, 0.3),
            alpha: 0.3 + 0.4 * press,
          });
      }
    }
  }

  // --- the forward check valve (seat + spring + ball, water parting around it) ---
  forwardCheckValve(g, {
    cy: 0,
    pipeHH,
    chamberHH: pipeHH + 12,
    seatX,
    plungerX,
    ballR,
    liftX,
    inX: aX,
    outX: bX,
    open: fwd,
    phase: o.phase,
    ballColor: conducting ? PALETTE.ok : breakdown ? PALETTE.bad : PLATE,
  });

  stud(g, aX, 0, PALETTE.bronze);
  stud(g, bX, 0, PALETTE.bronze);
}

// ============================================================================
// Zener — ported from zener-tier2.html: a CHECK VALVE WITH A SPILLWAY. Forward, it
// is the same spring check valve as a diode. In reverse it is a standpipe with a
// spillway: the water level is the reverse voltage and the wall height is Vz. Push
// the bias negative and the level climbs to the wall, then pours over and HOLDS
// there — the clamp. A higher Vz builds the wall higher.
//
// Live mapping (zener ElectricalState; value = Vz):
//   • forward  = norm(max(0, I))  → the check valve opens (as a diode).
//   • reverse  = vAcross < 0      → standpipe level = |Vrev|; overflow + reverse
//     current once the level reaches the Vz spillway wall (the clamp).
// ============================================================================
function drawAnalogyZener(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;

  const fwd = norm(Math.max(0, o.electrical.current), CUR_SCALE);
  const rev = norm(Math.max(0, -o.electrical.current), CUR_SCALE);
  const conducting = fwd > 0.03;
  const clamping = rev > 0.03; // reverse current only flows once it tops the weir
  const vrev = Math.max(0, -o.electrical.vAcross); // reverse volts across the part
  const vz = o.value && o.value > 0 ? o.value : 5.1;
  const wallF = Math.min(0.9, vz / (V_SCALE * 1.6)); // weir height (Vz) as a fraction
  const lvlF = Math.min(1, vrev / (V_SCALE * 1.6)); // standpipe fill (reverse volts)

  // Terminals on the real pins: anode left, cathode right, both on the part's axis.
  const A = anchorPt(o, "A", -0.588, 0);
  const K = anchorPt(o, "K", 0.588, 0);
  const lineY = (A.y + K.y) / 2; // the forward valve runs along the pin axis
  const pipeHH = hh * 0.11;

  // --- forward check valve (roomy, on the anode half of the axis) ---------------
  const bodyL = A.x + hw * 0.22;
  const bodyR = bodyL + hw * 0.48; // wide enough for seat + ball travel + spring
  const seatX = bodyL + hw * 0.08;
  const ballR = hh * 0.11; // small enough that the open flow parts AROUND it
  const plungerX = bodyR - hw * 0.045;
  const valveHalfH = ballR + 14; // chamber stands clear above + below the ball + flow
  const liftSpan = Math.max(0, plungerX - seatX - ballR * 2 - 8);
  const liftX = seatX + ballR + 4 + liftSpan * fwd; // the ball lifts toward cathode

  // --- standpipe + spillway (cathode side, between the valve and the cathode) ----
  const standCx = bodyR + (K.x - bodyR) * 0.44;
  const spW = hw * 0.16;
  const standL = standCx - spW / 2;
  const standR = standCx + spW / 2;
  const standBot = lineY - pipeHH;
  const fullH = hh * 0.55; // column height that represents the full reverse-volt scale
  const weirY = standBot - wallF * fullH; // the crest (left lip) at height Vz
  const lvlY = standBot - Math.min(lvlF, wallF) * fullH; // held at the crest when full
  const standTop = Math.min(lineY - hh * 0.4, weirY - hh * 0.05); // rim just above crest

  // --- the return tube: spill pours over the crest and runs back to the anode ----
  const retRunY = Math.min(weirY + hh * 0.1, lineY - ballR - hh * 0.1);
  const xChan = standL - hw * 0.03; // the catch just left of the column
  const xRet = A.x + hw * 0.14; // the down-leg into the anode pipe (before the valve)
  const retPath = [
    { x: standL, y: weirY },
    { x: xChan, y: weirY },
    { x: xChan, y: retRunY },
    { x: xRet, y: retRunY },
    { x: xRet, y: lineY },
  ];

  // ---- horizontal pipe walls along the axis (anode A→valve, cathode valve→K) ----
  for (const s of [-1, 1]) {
    g.moveTo(A.x, lineY + s * pipeHH)
      .lineTo(bodyL, lineY + s * pipeHH)
      .moveTo(bodyR, lineY + s * pipeHH)
      .lineTo(K.x, lineY + s * pipeHH)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }
  // flange caps across the inlet/outlet, so the anode + cathode leads meet the pins
  for (const x of [A.x, K.x]) {
    g.moveTo(x, lineY - pipeHH)
      .lineTo(x, lineY + pipeHH)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }

  // ---- the return tube (drawn first so the valve + column sit over its mouth) ---
  const retFlat = retPath.flatMap((p) => [p.x, p.y]);
  const retW = pipeHH * 1.3 + 2;
  g.poly(retFlat, false).stroke({
    width: retW,
    color: PALETTE.rail,
    alpha: 0.3,
    cap: "round",
    join: "round",
  });
  g.poly(retFlat, false).stroke({
    width: Math.max(1, retW - 5),
    color: WATER,
    alpha: clamping ? 0.2 : 0.1,
    cap: "round",
    join: "round",
  });

  // ---- forward check valve: housing, seat lips, spring, plunger, ball -----------
  housing(
    g,
    bodyL,
    lineY - valveHalfH,
    bodyR - bodyL,
    valveHalfH * 2,
    PALETTE.bronze,
    9,
  );
  forwardCheckValve(g, {
    cy: lineY,
    pipeHH,
    chamberHH: valveHalfH,
    seatX,
    plungerX,
    ballR,
    liftX,
    inX: A.x,
    outX: K.x,
    open: fwd,
    phase: o.phase,
    ballColor: conducting ? PALETTE.ok : clamping ? PALETTE.accent : PLATE,
  });

  // ---- the standpipe glass column rising from the cathode pipe ------------------
  g.rect(standL, standTop, spW, standBot - standTop).fill({
    color: WATER,
    alpha: 0.06,
  });
  // right wall full height; left wall only up to the weir crest (the dam)
  g.moveTo(standR, standBot)
    .lineTo(standR, standTop)
    .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  g.moveTo(standL, standBot)
    .lineTo(standL, weirY)
    .stroke({
      width: 3,
      color: clamping ? PALETTE.accent : PALETTE.bronze,
      alpha: 0.9,
    });
  // the crest the water pours over (height = Vz) + a faint Vz reference line
  g.rect(standL - 7, weirY - 2, 14, 4).fill({
    color: clamping ? PALETTE.accent : PALETTE.bronze,
    alpha: 0.95,
  });
  g.moveTo(standL - 10, weirY)
    .lineTo(standR + 8, weirY)
    .stroke({ width: 1.2, color: PALETTE.accent, alpha: 0.4 });
  // water fill = reverse voltage, held at the crest once it tops out (the clamp)
  g.rect(standL + 2, lvlY, spW - 4, standBot - lvlY).fill({
    color: WATER,
    alpha: 0.55,
  });
  g.moveTo(standL + 2, lvlY)
    .lineTo(standR - 2, lvlY)
    .stroke({ width: 1.6, color: WATER2, alpha: lvlF > 0.04 ? 0.85 : 0 });

  // ---- reverse spill-and-return loop (forward flow is the shared valve's, above) -
  if (clamping) {
    const loop = [
      { x: K.x, y: lineY },
      { x: standCx, y: lineY },
      { x: standCx, y: weirY },
      ...retPath,
      { x: A.x, y: lineY },
    ];
    flowAlongPath(g, loop, rev, 1, o.phase, WATER2, 2.4);
  }

  stud(g, A.x, A.y, PALETTE.bronze);
  stud(g, K.x, K.y, PALETTE.bronze);
}

// ============================================================================
// Bipolar transistor (BJT) — ported from transistor-tiers.html tier 2: an AMPLIFYING
// VALVE. The collector↔emitter pipe (pressure = V_CE) is sealed by a plug at a seat.
// A small BASE flow trickles through a check valve (cracks at ~0.7 V) into a side
// chamber; the rising level floats a linkage that lifts the plug, opening a LARGE
// collector flow — a small base flow commands a big collector flow (the gain β).
// Unlike the MOSFET's sealed gate, the base check valve passes real flow (the BJT
// draws base current). Collector top, emitter bottom (the real pin order), base on
// the left. The PNP mirrors it: the high-pressure supply is the EMITTER and the flow
// runs emitter→collector (up).
//
// Live mapping (BJT ElectricalState: current = I_C, vAcross = V_CE; value = β):
//   • open      = norm(|I_C|, steep) → plug lift + chamber level (I_B isn't exposed,
//     so the collector current is the visible proxy for the base having filled it).
//   • flow      = norm(|I_C|)        → the big collector→emitter stream density.
//   • supply    = |V_CE|             → the supply-reservoir fill.
// ============================================================================
function drawAnalogyBjt(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;
  const pnp = o.kind === "QP"; // p-type: emitter is the high side, flow emitter→collector

  const ic = norm(o.electrical.current, CUR_SCALE);
  const conducting = ic > 0.03;
  // Sensitive base proxy (steep near 0) so even a small I_C visibly fills the chamber
  // and lifts the plug — the gate-lift is the teaching point.
  const open = norm(o.electrical.current, CUR_SCALE * 0.3);
  const vce = norm(o.electrical.vAcross, V_SCALE);

  // Terminals on the real pins: collector top, emitter bottom (shared pipe), base left.
  const C = anchorPt(o, "C", 0.588, -0.95);
  const E = anchorPt(o, "E", 0.588, 0.95);
  const B = anchorPt(o, "B", -0.588, 0);
  const pipeX = (C.x + E.x) / 2;
  const pipeHW = Math.min(hw, hh) * 0.14;
  const topY = Math.min(C.y, E.y);
  const botY = Math.max(C.y, E.y);
  const throatY = (topY + botY) / 2;
  const supplyY = pnp ? botY : topY; // high-pressure end
  const outletY = pnp ? topY : botY;
  const toSupply = Math.sign(supplyY - throatY) || -1;
  const plugY = throatY + toSupply * open * Math.abs(supplyY - throatY) * 0.55;

  // --- supply reservoir at the high-pressure end (fill = |V_CE|) ----------------
  const resLen = Math.abs(botY - topY) * 0.26;
  const resW = pipeHW * 3.4;
  const rIn = supplyY - toSupply * resLen;
  g.roundRect(pipeX - resW / 2, Math.min(supplyY, rIn), resW, resLen, 4).stroke(
    { width: 1.6, color: PALETTE.rail, alpha: 0.85 },
  );
  const fillH = resLen * vce;
  g.rect(
    pipeX - resW / 2 + 3,
    Math.min(supplyY, supplyY - toSupply * fillH),
    resW - 6,
    fillH,
  ).fill({ color: WATER, alpha: 0.45 });

  // --- main pipe walls + seat ridges + mouth caps ------------------------------
  for (const s of [-1, 1]) {
    g.moveTo(pipeX + s * pipeHW, supplyY)
      .lineTo(pipeX + s * pipeHW, outletY)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
    g.poly([
      pipeX + s * pipeHW,
      throatY - 12,
      pipeX + s * pipeHW * 0.2,
      throatY,
      pipeX + s * pipeHW,
      throatY + 12,
    ]).fill({ color: PALETTE.rail, alpha: 0.85 });
  }
  for (const y of [supplyY, outletY]) {
    g.moveTo(pipeX - pipeHW, y)
      .lineTo(pipeX + pipeHW, y)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }

  // --- collector → emitter stream PARTING around the plug ----------------------
  if (conducting) {
    flowAroundPlug(
      g,
      pipeX,
      pipeHW,
      supplyY,
      outletY,
      plugY,
      16,
      ic,
      o.phase,
      WATER,
      2.6,
    );
  }
  g.ellipse(pipeX, plugY, pipeHW * 0.62, 11).fill({
    color: conducting ? PLATE : mix(PLATE, PALETTE.dim, 0.5),
    alpha: 0.95,
  });
  g.ellipse(pipeX, plugY, pipeHW * 0.62, 11).stroke({
    width: 1.1,
    color: 0xdfe3ee,
    alpha: 0.5,
  });

  // --- float chamber: base flow fills it, the float lifts the plug linkage ------
  const chamX = -hw * 0.06;
  const chamHW = hw * 0.13;
  const chamTop = throatY - hh * 0.42;
  const chamBot = throatY + hh * 0.34;
  const waterY = chamBot - open * (chamBot - chamTop);
  for (const s of [-1, 1]) {
    g.moveTo(chamX + s * chamHW, chamTop)
      .lineTo(chamX + s * chamHW, chamBot)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }
  g.moveTo(chamX - chamHW, chamBot)
    .lineTo(chamX + chamHW, chamBot)
    .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  g.rect(chamX - chamHW + 2, waterY, chamHW * 2 - 4, chamBot - waterY).fill({
    color: WATER,
    alpha: 0.5,
  });
  g.moveTo(chamX - chamHW + 2, waterY)
    .lineTo(chamX + chamHW - 2, waterY)
    .stroke({ width: 1.4, color: WATER2, alpha: open > 0.03 ? 0.8 : 0 });
  // float + linkage rod to the plug
  g.roundRect(chamX - chamHW + 4, waterY - 5, chamHW * 2 - 8, 10, 2).fill({
    color: PLATE,
    alpha: 0.9,
  });
  g.moveTo(chamX, waterY)
    .lineTo(pipeX - pipeHW, plugY)
    .stroke({ width: 3, color: PLATE, alpha: 0.65 });

  // --- base inlet check valve (cracks at ~0.7 V; the base DOES draw flow) -------
  const seatBX = chamX - chamHW;
  const ballX = seatBX - 16;
  for (const s of [-1, 1]) {
    g.moveTo(B.x, B.y + s * 5)
      .lineTo(seatBX, B.y + s * 5)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.8 });
  }
  // flange cap across the base inlet, so the base lead meets the pin
  g.moveTo(B.x, B.y - 5)
    .lineTo(B.x, B.y + 5)
    .stroke({ width: 2, color: PALETTE.border, alpha: 0.8 });
  g.poly(springPts(ballX + 6, seatBX, B.y, 4, 4), false).stroke({
    width: 1.6,
    color: WARM,
    alpha: 0.8,
  });
  g.circle(ballX + (conducting ? 4 : 0), B.y, 6).fill({
    color: conducting ? PALETTE.ok : PLATE,
    alpha: 0.92,
  });
  if (conducting) {
    belt(
      g,
      B.x,
      B.y,
      ballX - 6,
      B.y,
      Math.min(1, open * 0.8),
      1,
      o.phase,
      WATER,
      2,
    );
  }

  stud(g, B.x, B.y, PALETTE.accent);
  stud(g, C.x, C.y, PALETTE.bronze);
  stud(g, E.x, E.y, PALETTE.bronze);
}

// ============================================================================
// MOSFET — ported from mosfet-tiers.html / mosfet-pmos-tiers.html tier 2: a PRESSURE
// PILOT valve. The big drain↔source pipe (pressure = V_DS) is sealed by a plug at a
// seated throat. A piston on a threshold SPRING lifts the plug — driven by the gate
// PRESSURE through a SEALED pilot line that takes NO flow (the gate draws no current,
// it only sets up a field). Past threshold the plug lifts and the supply streams
// through to the outlet, the channel widening with more gate drive; the throat chokes
// in saturation. The drain and source share the vertical pipe (drain top, source
// bottom — the real pin order); the gate mechanism sits on the left, on the gate pin.
// For the P-channel the high-pressure supply is the SOURCE (bottom) and the flow runs
// source→drain (up), mirroring the N-channel.
//
// Live mapping (MOSFET ElectricalState: current = I_D, vAcross = V_DS):
//   • open   = norm(|I_D|, steep) → plug lift + piston travel (Vgs isn't exposed, so
//     the through-current is the visible proxy for the gate clearing threshold).
//   • flow   = norm(|I_D|)        → the supply→outlet stream density.
//   • supply = |V_DS|             → the supply-reservoir fill at the high-pressure end.
//   • choke  = conducting · |V_DS|→ the throat pinch + seat glow (saturation proxy).
// ============================================================================
function drawAnalogyMosfet(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;
  const pch = o.kind === "PM"; // p-channel: source is the high side, flow source→drain

  const id = norm(o.electrical.current, CUR_SCALE);
  const conducting = id > 0.03;
  // Sensitive gate-open proxy (steep near 0) so even a small I_D visibly lifts the
  // plug — the valve lift is the whole teaching point.
  const open = norm(o.electrical.current, CUR_SCALE * 0.3);
  const vds = norm(o.electrical.vAcross, V_SCALE); // supply pressure
  // Saturation proxy (no region readout): conducting hard against a big V_DS chokes
  // the throat and holds the flow flat.
  const choke = conducting ? Math.max(0, Math.min(1, (vds - 0.5) * 2)) : 0;

  // Terminals ride the real pins: drain + source share the pipe column (drain top,
  // source bottom), gate on the left.
  const D = anchorPt(o, "D", 0.588, -0.95);
  const S = anchorPt(o, "S", 0.588, 0.95);
  const G = anchorPt(o, "G", -0.588, 0);
  const pipeX = (D.x + S.x) / 2;
  const pipeHW = Math.min(hw, hh) * 0.14;
  const topY = Math.min(D.y, S.y);
  const botY = Math.max(D.y, S.y);
  const throatY = (topY + botY) / 2;
  const supplyY = pch ? botY : topY; // high-pressure end
  const outletY = pch ? topY : botY;
  const toSupply = Math.sign(supplyY - throatY) || -1; // throat→supply direction
  const plugY = throatY + toSupply * open * Math.abs(supplyY - throatY) * 0.55;

  // --- the supply reservoir at the high-pressure end (fill = |V_DS|) -----------
  const resLen = Math.abs(botY - topY) * 0.26;
  const resW = pipeHW * 3.4;
  const rIn = supplyY - toSupply * resLen; // inner edge, toward the throat
  g.roundRect(pipeX - resW / 2, Math.min(supplyY, rIn), resW, resLen, 4).stroke(
    { width: 1.6, color: PALETTE.rail, alpha: 0.85 },
  );
  const fillH = resLen * vds;
  g.rect(
    pipeX - resW / 2 + 3,
    Math.min(supplyY, supplyY - toSupply * fillH),
    resW - 6,
    fillH,
  ).fill({ color: WATER, alpha: 0.45 });

  // --- main pipe walls + seat ridges (throat) ----------------------------------
  for (const s of [-1, 1]) {
    g.moveTo(pipeX + s * pipeHW, supplyY)
      .lineTo(pipeX + s * pipeHW, outletY)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
    // seat ridge pinching the throat; tightens + glows as it chokes in saturation
    const ridge = pipeHW * (0.22 + 0.5 * choke);
    g.poly([
      pipeX + s * pipeHW,
      throatY - 13,
      pipeX + s * (pipeHW - ridge),
      throatY,
      pipeX + s * pipeHW,
      throatY + 13,
    ]).fill({
      color:
        choke > 0.04 ? mix(PALETTE.rail, PALETTE.bronze, choke) : PALETTE.rail,
      alpha: 0.85,
    });
  }
  // mouth flanges across the pipe ends, so the drain + source leads meet the pins
  for (const y of [supplyY, outletY]) {
    g.moveTo(pipeX - pipeHW, y)
      .lineTo(pipeX + pipeHW, y)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }

  // --- supply→outlet stream PARTING around the plug, when the valve is open -----
  if (conducting) {
    flowAroundPlug(
      g,
      pipeX,
      pipeHW,
      supplyY,
      outletY,
      plugY,
      16,
      id,
      o.phase,
      WATER,
      2.6,
    );
  }

  // --- the plug (a disc narrower than the pipe, so flow skirts it) --------------
  g.ellipse(pipeX, plugY, pipeHW * 0.62, 12).fill({
    color: conducting ? PLATE : mix(PLATE, PALETTE.dim, 0.5),
    alpha: 0.95,
  });
  g.ellipse(pipeX, plugY, pipeHW * 0.62, 12).stroke({
    width: 1.1,
    color: 0xdfe3ee,
    alpha: 0.55,
  });

  // --- gate cylinder: threshold spring + piston + rod to the plug --------------
  const cylX = G.x + hw * 0.2;
  const cylHW = pipeHW * 1.3;
  const cylHalf = Math.abs(throatY - supplyY) * 0.55 + 12; // contains the travel
  const cylTop = throatY - cylHalf;
  const cylBot = throatY + cylHalf;
  g.roundRect(cylX - cylHW, cylTop, cylHW * 2, cylBot - cylTop, 3).stroke({
    width: 1.5,
    color: PALETTE.rail,
    alpha: 0.8,
  });
  // the spring pushes off the far wall (away from the supply) — sets the threshold
  const wallY = toSupply < 0 ? cylBot : cylTop;
  g.moveTo(cylX - cylHW, wallY)
    .lineTo(cylX + cylHW, wallY)
    .stroke({ width: 3, color: PALETTE.rail, alpha: 0.9 });
  g.poly(vSpringPts(cylX, wallY, plugY, cylHW * 0.5, 5), false).stroke({
    width: 1.8,
    color: PALETTE.bronze,
    alpha: 0.85,
  });
  // piston + the long horizontal rod linking it to the plug
  g.roundRect(cylX - cylHW + 2, plugY - 5, cylHW * 2 - 4, 10, 2).fill({
    color: PLATE,
    alpha: 0.9,
  });
  g.moveTo(cylX + cylHW, plugY)
    .lineTo(pipeX, plugY)
    .stroke({ width: 3, color: PLATE, alpha: 0.65 });

  // --- the SEALED gate pilot line (no flow) + pressure gauge --------------------
  const gaugeX = G.x + hw * 0.07;
  g.moveTo(G.x, G.y)
    .lineTo(gaugeX, G.y)
    .stroke({ width: 2.4, color: PALETTE.border, alpha: 0.8 });
  g.moveTo(cylX, G.y)
    .lineTo(cylX, throatY)
    .moveTo(gaugeX, G.y)
    .lineTo(cylX, G.y)
    .stroke({ width: 2.4, color: PALETTE.border, alpha: 0.7 });
  g.circle(gaugeX, G.y, 11).fill({ color: 0x10131f, alpha: 0.7 });
  g.circle(gaugeX, G.y, 11).stroke({
    width: 1.4,
    color: PALETTE.rail,
    alpha: 0.8,
  });
  const ang = (-60 + open * 120) * (Math.PI / 180);
  g.moveTo(gaugeX, G.y)
    .lineTo(gaugeX + 9 * Math.sin(ang), G.y - 9 * Math.cos(ang))
    .stroke({ width: 1.8, color: PALETTE.accent, alpha: 0.95 });

  stud(g, G.x, G.y, PALETTE.accent);
  stud(g, D.x, D.y, PALETTE.bronze);
  stud(g, S.x, S.y, PALETTE.bronze);
}

// ============================================================================
// Op-amp — ported from opamp-tiers.html tier 2: a pilot SPOOL VALVE. Two input
// reservoirs feed pilots that steer a spool; the spool ports one of the two supply
// rails (±12 V) through to the output tank, geared up by the gain. The tiny input
// difference slides the spool a lot — the huge open-loop gain — until it bottoms out
// on a rail and the output clips. Each input steers the spool toward the rail on ITS
// own side: the non-inverting IN+ (top) toward the +rail, the inverting IN− (bottom)
// toward the −rail — which is exactly their electrical sense and keeps the +rail up.
// Anchored to the real pins (IN+ top-left, IN− bottom-left, OUT right).
//
// Live mapping (op-amp ElectricalState: current = Iout, vAcross = V(OUT)−V(IN−);
// value = ±Vsat rail):
//   • swing  = vAcross/Vsat → spool offset + output-tank level (clamped at rails).
//   • inputs = ½ ± ½·swing  → the two reservoir levels (reconstructed; the difference
//     is what's observable) + which steer arrow drives.
//   • drive  = norm(|Iout|) → the ported supply→channel→tank flow; sign sets dir.
// ============================================================================
function drawAnalogyOA(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;
  const POS = PALETTE.pos;
  const NEG = PALETTE.neg;
  const OUT = PALETTE.out;
  const railV = o.value && o.value > 0.5 ? o.value : OUT_SCALE;
  const swing = Math.max(-1, Math.min(1, o.electrical.vAcross / railV));
  const sat = Math.abs(o.electrical.vAcross / railV) >= 0.985;
  const drive = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1;
  const posWins = swing >= 0;

  // Terminals on the real pins: IN+ top-left, IN− bottom-left, OUT right. (Match the
  // inverting input by "IN but not +", robust to the ± glyph.)
  const pick = (
    frag: string,
    neg: boolean,
    fx: number,
    fy: number,
  ): { x: number; y: number } => {
    const hit = o.anchors?.find((p) =>
      neg
        ? p.label.includes("IN") && !p.label.includes("+")
        : p.label.includes(frag),
    );
    return hit ? { x: hit.x, y: hit.y } : { x: fx * hw, y: fy * hh };
  };
  const IP = pick("+", false, -0.588, -0.95);
  const IM = pick("", true, -0.588, 0.95);
  const OU = pick("OUT", false, 0.588, 0);

  // --- spool geometry ----------------------------------------------------------
  const spX = -hw * 0.06;
  const spHW = hw * 0.085;
  const spTop = -hh * 0.72;
  const spBot = hh * 0.72;
  const range = hh * 0.4;
  const cy = -swing * range; // ported-channel centre: up for +out, down for −
  const gap = hh * 0.13;

  // --- ±supply reservoirs feeding the spool's left ports -----------------------
  // +rail (the non-inverting side) sits upper, −rail lower; the one being ported
  // (by the output's sign) glows toward the output colour.
  const supX = spX - hw * 0.34;
  const supHW = hw * 0.1;
  for (const [py, isPlus] of [
    [-hh * 0.3, true],
    [hh * 0.3, false],
  ] as const) {
    const active = isPlus === posWins && drive > 0.03;
    g.roundRect(supX - supHW, py - 10, supHW * 2, 20, 2).stroke({
      width: 1.5,
      color: PALETTE.rail,
      alpha: 0.8,
    });
    g.rect(supX - supHW + 2, py - 8, supHW * 2 - 4, 16).fill({
      color: active ? OUT : PALETTE.rail,
      alpha: active ? 0.5 : 0.22,
    });
    g.moveTo(supX + supHW, py)
      .lineTo(spX - spHW, py)
      .stroke({
        width: 2,
        color: active ? OUT : PALETTE.rail,
        alpha: active ? 0.85 : 0.5,
      });
  }

  // --- the gain knob (geared step-up between the supplies and the spool) -------
  const knobX = supX + hw * 0.18;
  g.circle(knobX, 0, hw * 0.06).fill({ color: 0x10131f, alpha: 0.85 });
  g.circle(knobX, 0, hw * 0.06).stroke({
    width: 2,
    color: PALETTE.accent,
    alpha: 0.9,
  });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    g.moveTo(knobX + Math.cos(a) * hw * 0.045, Math.sin(a) * hw * 0.045)
      .lineTo(knobX + Math.cos(a) * hw * 0.06, Math.sin(a) * hw * 0.06)
      .stroke({ width: 1.2, color: PALETTE.accent, alpha: 0.7 });
  }

  // --- input reservoirs at the pins + steer arrows at the spool ends -----------
  const ipLevel = Math.max(0, Math.min(1, 0.5 + 0.5 * swing));
  const imLevel = Math.max(0, Math.min(1, 0.5 - 0.5 * swing));
  for (const [an, lvl, end, col, steer, win] of [
    [IP, ipLevel, spTop, POS, -1, Math.max(0, swing)],
    [IM, imLevel, spBot, NEG, 1, Math.max(0, -swing)],
  ] as const) {
    const tkW = hw * 0.13;
    const tkH = hh * 0.34;
    const tkx = an.x + hw * 0.04;
    const tky = an.y - steer * (hh * 0.28); // pulled inboard so it clears the edge
    // lead from the pin to the tank (vertex at the pin)
    g.moveTo(an.x, an.y)
      .lineTo(tkx, an.y)
      .lineTo(tkx, tky - steer * (tkH / 2))
      .stroke({ width: 2, color: col, alpha: 0.45 });
    g.roundRect(tkx - tkW / 2, tky - tkH / 2, tkW, tkH, 2).stroke({
      width: 1.6,
      color: PALETTE.rail,
      alpha: 0.8,
    });
    const fillH = lvl * (tkH - 4);
    g.rect(tkx - tkW / 2 + 2, tky + tkH / 2 - 2 - fillH, tkW - 4, fillH).fill({
      color: col,
      alpha: 0.5,
    });
    // dashed connector from the tank toward the spool end
    g.moveTo(tkx, tky + steer * (tkH / 2))
      .lineTo(spX, end)
      .stroke({ width: 1.8, color: col, alpha: 0.32 });
    // steer arrow just outside the spool end, pointing toward this input's rail
    const aw = 4 + 7 * win;
    const baseY = end + steer * 3;
    g.poly([spX - 5, baseY, spX + 5, baseY, spX, baseY + steer * aw]).fill({
      color: col,
      alpha: 0.45 + 0.45 * win,
    });
    stud(g, an.x, an.y, col);
  }

  // --- spool body (vertical) with two lands bounding the ported channel ---------
  for (const s of [-1, 1]) {
    g.moveTo(spX + s * spHW, spTop)
      .lineTo(spX + s * spHW, spBot)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }
  for (const [y0, y1] of [
    [spTop, cy - gap],
    [cy + gap, spBot],
  ] as const) {
    g.roundRect(spX - spHW + 2, y0, spHW * 2 - 4, Math.max(0, y1 - y0), 2).fill(
      { color: PALETTE.bronze, alpha: 0.8 },
    );
    g.roundRect(
      spX - spHW + 2,
      y0,
      spHW * 2 - 4,
      Math.max(0, y1 - y0),
      2,
    ).stroke({ width: 1, color: WARM, alpha: 0.6 });
  }
  g.moveTo(spX, spTop)
    .lineTo(spX, spBot)
    .stroke({ width: 2, color: PLATE, alpha: 0.35 });

  // --- output tank (right): level = output, clamped at the supply rails ---------
  const tankX = OU.x - hw * 0.2;
  const tankHW = hw * 0.12;
  const tankT = -hh * 0.72;
  const tankB = hh * 0.72;
  for (const s of [-1, 1]) {
    g.moveTo(tankX + s * tankHW, tankT)
      .lineTo(tankX + s * tankHW, tankB)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }
  for (const [ry, glow] of [
    [tankT, sat && posWins],
    [tankB, sat && !posWins],
  ] as const) {
    g.moveTo(tankX - tankHW - 3, ry)
      .lineTo(tankX + tankHW + 3, ry)
      .stroke({
        width: 2.5,
        color: glow ? PALETTE.accent : PALETTE.rail,
        alpha: glow ? 0.95 : 0.8,
      });
  }
  const lvlY = -swing * (hh * 0.66);
  g.rect(
    tankX - tankHW + 2,
    Math.min(0, lvlY),
    tankHW * 2 - 4,
    Math.abs(lvlY),
  ).fill({ color: OUT, alpha: sat ? 0.5 : 0.3 });
  g.moveTo(tankX - tankHW - 3, lvlY)
    .lineTo(tankX + tankHW + 3, lvlY)
    .stroke({ width: 2.5, color: sat ? PALETTE.accent : WARM, alpha: 0.95 });

  // --- ported flow: active supply → channel → output tank → the OUT lead --------
  if (drive > 0.03) {
    const supActiveY = posWins ? -hh * 0.3 : hh * 0.3;
    belt(g, spX - spHW, supActiveY, spX, cy, drive, 1, o.phase, WATER, 2.2);
    belt(g, spX + spHW, cy, tankX - tankHW, 0, drive, dir, o.phase, WATER, 2.6);
  }
  g.moveTo(tankX + tankHW, 0)
    .lineTo(OU.x, OU.y)
    .stroke({ width: 2, color: OUT, alpha: 0.5 });
  stud(g, OU.x, OU.y, OUT);
}

// ============================================================================
// Varistor (MOV) — ported FAITHFULLY from varistor-tiers.html tier 2: a PRESSURE
// RELIEF VALVE. The applied voltage pressurises a vessel from below; that pressure
// pushes up under a poppet held shut by a spring whose set-screw is the clamp voltage.
// Below the clamp the poppet stays seated and nothing passes. Past the clamp it cracks,
// and the current flows ACROSS the open valve — A↔B in the direction of the voltage (a
// real 2-terminal part conducts one way, not out to "atmosphere"). The reference's exact
// coordinates are scaled into the bounds so the SPRING stays the tall, readable coil it
// is in the sheet, not a squashed zigzag.
//
// Live mapping (MOV ElectricalState: current a→b, vAcross = V across; value = Vclamp):
//   • applied = |vAcross|         → vessel fill + molecule jiggle + the inlet arrow.
//   • over    = |vAcross|/Vclamp  → poppet lift (pushes up); the spring compresses.
//   • clamp   = Vclamp            → the set-screw depth (spring preload).
//   • flow    = norm(|I|)         → the current across the open valve; dir = sign(V).
// ============================================================================
function drawAnalogyVaristor(g: Graphics, o: AnalogyOpts): void {
  const { hh } = o.bounds;
  const applied = Math.abs(o.electrical.vAcross);
  const vclamp = o.value && o.value > 0 ? o.value : 5;
  const over = applied / vclamp;
  const flow = norm(o.electrical.current, CUR_SCALE);
  const conducting = over > 1;
  // a real 2-terminal part conducts ONE way — in the direction of the voltage across it
  const vdir = o.electrical.vAcross >= 0 ? 1 : -1;

  const A = anchorPt(o, "A", -0.588, 0);
  const B = anchorPt(o, "B", 0.588, 0);
  const cx = (A.x + B.x) / 2;
  const lineY = (A.y + B.y) / 2;

  // Port the reference's tier-2 coordinates (its valve spans viewBox y≈150..500) into the
  // bounds, centred and scaled to FILL the vertical space — so the spring keeps its real
  // proportions instead of being squashed. px/py map a reference point to ours.
  const S = (1.85 * hh) / 346;
  const px = (rx: number): number => cx + (rx - 300) * S;
  const py = (ry: number): number => lineY + (ry - 327) * S;
  const STEEL = 0x9aa6bd;
  const ORANGE = 0xff9a4d;

  // live geometry, straight from updateT2 (reference px): poppet lift, spring, screw
  const lift = Math.min(1, Math.max(0, (over - 1) * 2)) * 40;
  const by = 296 - lift; // poppet base
  const ptop = by - 22; // poppet apex
  const screwBottom = 166 + Math.min(1, Math.max(0, (vclamp - 3) / 9)) * 24;

  // --- applied-pressure inlet arrow below the vessel (grows with |V|) ---------------
  const aLen = 12 + Math.min(1, applied / 10) * 26;
  g.moveTo(px(300), py(516))
    .lineTo(px(300), py(516 - aLen))
    .stroke({ width: 2.4, color: WATER, alpha: 0.75 });
  g.poly([
    px(294),
    py(516 - aLen + 9),
    px(306),
    py(516 - aLen + 9),
    px(300),
    py(516 - aLen),
  ]).fill({ color: WATER, alpha: 0.75 });

  // --- the vessel + fill (= |V|) + jiggling molecules -------------------------------
  g.roundRect(px(234), py(320), 132 * S, 148 * S, 14 * S).fill({
    color: WATER,
    alpha: Math.min(1, applied / 10) * 0.42,
  });
  g.roundRect(px(234), py(320), 132 * S, 148 * S, 14 * S).stroke({
    width: 2.5,
    color: STEEL,
    alpha: 0.9,
  });
  const mAmp = (2 + Math.min(1, applied / 10) * 5) * S;
  for (let i = 0; i < 9; i++) {
    const mx = 260 + (i % 3) * 40;
    const my = 352 + Math.floor(i / 3) * 38;
    const ph = i * 1.7;
    g.circle(
      px(mx) + Math.sin(o.phase * PULSE_K + ph) * mAmp,
      py(my) + Math.cos(o.phase * PULSE_K + ph * 1.4) * mAmp,
      2.4,
    ).fill({ color: WATER2, alpha: 0.85 });
  }

  // --- neck + seat lips, chamber walls (vent gaps y 250..266), bonnet --------------
  const steel = (segs: [number, number, number, number][]): void => {
    for (const [x1, y1, x2, y2] of segs)
      g.moveTo(px(x1), py(y1)).lineTo(px(x2), py(y2));
    g.stroke({ width: 2.2, color: STEEL, alpha: 0.88 });
  };
  steel([
    [285, 320, 285, 296],
    [315, 320, 315, 296],
    [272, 296, 285, 296],
    [315, 296, 328, 296], // neck + seat
    [250, 296, 250, 266],
    [250, 250, 250, 224],
    [350, 296, 350, 266],
    [350, 250, 350, 224], // chamber walls w/ vent gaps
    [250, 296, 272, 296],
    [328, 296, 350, 296],
    [250, 224, 272, 224],
    [328, 224, 350, 224], // chamber top/bottom corners
    [272, 224, 272, 154],
    [328, 224, 328, 154],
    [266, 154, 334, 154], // bonnet
  ]);

  // --- A/B leads to the side vents (structural pipes; current rides them below) -----
  const lc = mix(WATER, PALETTE.cyan, 0.3);
  pipeLead(g, [A, { x: px(250), y: py(258) }], 8, lc, WATER2, 0, 1, o.phase);
  pipeLead(g, [B, { x: px(350), y: py(258) }], 8, lc, WATER2, 0, 1, o.phase);

  // --- set screw (depth = clamp) + the THRESHOLD SPRING (tall readable coil) --------
  g.rect(px(300) - 7 * S, py(154), 14 * S, (screwBottom - 154) * S).fill({
    color: PALETTE.bronze,
    alpha: 0.9,
  });
  g.poly(vcoilPts(px(300), py(screwBottom), py(ptop), 7 * S, 5), false).stroke({
    width: 2.2,
    color: STEEL,
    alpha: 0.92,
  });

  // --- the poppet (cone) plugging the seat; pushed UP when it cracks ----------------
  const poppet = [
    px(278),
    py(by),
    px(322),
    py(by),
    px(314),
    py(ptop),
    px(286),
    py(ptop),
  ];
  g.poly(poppet).fill({
    color: conducting ? ORANGE : PALETTE.bronze,
    alpha: 0.95,
  });
  g.poly(poppet).stroke({ width: 1.4, color: WARM, alpha: 0.7 });

  // --- the current ACROSS the open valve: in the high vent, dip through the cracked
  // seat, out the low vent — ONE way, in the direction of the voltage. Only conducting.
  if (flow > 0.02 && conducting) {
    flowAlongPath(
      g,
      [
        A,
        { x: px(250), y: py(258) },
        { x: px(285), y: py(266) },
        { x: px(300), y: py(by + 6) },
        { x: px(315), y: py(266) },
        { x: px(350), y: py(258) },
        B,
      ],
      flow,
      vdir,
      o.phase,
      WATER,
      2.6,
    );
  }

  stud(g, A.x, A.y, PALETTE.bronze);
  stud(g, B.x, B.y, PALETTE.bronze);
}

// ============================================================================
// Potentiometer (POT) — ported from potentiometer-tiers.html tier 2: a PACKED PIPE.
// The full track is a pipe between the two ends (A↔B) packed with resistance posts;
// water (the current) is forced through and loses head along the way. A sliding WIPER
// taps the head at its position — the tapped level is the divider output at W. The
// posts set how fast the head falls (the track resistance). Anchored A top-left, B
// top-right, W bottom-centre (the real pins).
//
// Live mapping (POT ElectricalState: current a→b = A→B, vAcross = V(A)−V(B); value =
// track Ω; wiper = tap position 0..1):
//   • wiper = o.wiper      → the wiper contact's x along the track.
//   • flow  = norm(|I|)    → water streaming A↔B, weaving past the posts.
//   • head  = vAcross      → the high end glows + the tapped level at the wiper.
//   • R     = value        → post density (more posts = more resistance per length).
// ============================================================================
function drawAnalogyPOT(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;
  const A = anchorPt(o, "A", -0.588, -0.95);
  const B = anchorPt(o, "B", 0.588, -0.95);
  const W = anchorPt(o, "W", 0, 0.95);
  const wiper = Math.max(0, Math.min(1, o.wiper ?? 0.5));
  const flow = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1;
  const head = Math.max(
    0,
    Math.min(1, Math.abs(o.electrical.vAcross) / V_SCALE),
  );
  const aHigh = o.electrical.vAcross >= 0; // A is the high-pressure end

  const yTrack = -hh * 0.16;
  const ph = Math.min(hw, hh) * 0.1;
  const xL = A.x;
  const xR = B.x;
  const xW = xL + (xR - xL) * wiper;

  // --- leads from the A / B pins down to the track ends ------------------------
  g.moveTo(A.x, A.y)
    .lineTo(A.x, yTrack)
    .moveTo(B.x, B.y)
    .lineTo(B.x, yTrack)
    .stroke({ width: 2.4, color: PALETTE.border, alpha: 0.85 });

  // --- source tank at the HIGH end (the supply head, fills with |V|) -----------
  const srcX = aHigh ? xL : xR;
  const tankTop = -hh * 0.7;
  const tankBot = yTrack - ph;
  const tw = hw * 0.16;
  g.roundRect(srcX - tw / 2, tankTop, tw, tankBot - tankTop, 3).stroke({
    width: 1.6,
    color: PALETTE.rail,
    alpha: 0.85,
  });
  const srcFill = head * (tankBot - tankTop);
  g.rect(srcX - tw / 2 + 2, tankBot - srcFill, tw - 4, srcFill).fill({
    color: WATER,
    alpha: 0.4,
  });

  // --- track pipe walls + end flanges + faint water fill -----------------------
  for (const s of [-1, 1]) {
    g.moveTo(xL, yTrack + s * ph)
      .lineTo(xR, yTrack + s * ph)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }
  for (const x of [xL, xR]) {
    g.moveTo(x, yTrack - ph)
      .lineTo(x, yTrack + ph)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }
  g.rect(xL, yTrack - ph + 1, xR - xL, 2 * ph - 2).fill({
    color: WATER,
    alpha: 0.12,
  });

  // --- resistance posts (density ~ track resistance): the obstacles the water must
  // weave around — MORE posts = more resistance per length. ----------------------
  const rNorm = o.value ? norm(o.value, 50000) : 0.5;
  const NP = Math.round(9 + 13 * rNorm);
  const postCol = mix(PALETTE.bronze, 0x8a6a40, 0.5);
  const posts: { x: number; y: number }[] = [];
  for (let k = 0; k < NP; k++) {
    posts.push({
      x: xL + ((k + 0.5) / NP) * (xR - xL),
      y: yTrack + (k % 2 ? -1 : 1) * ph * 0.34,
    });
  }
  for (const p of posts) {
    g.circle(p.x, p.y, 2.6).fill({ color: postCol, alpha: 0.9 });
  }

  // --- the flow: water slaloms A→wiper around the posts (the resistance) and then
  // SPLITS at the wiper — part carries on to B, part is tapped down the hose to W — in
  // exact proportion to each leg's current (the divider, made visible). The wiper
  // "steals" its share: more current out of W ⇒ more carriers peel off, fewer reach B.
  const postSpread = ((xR - xL) / NP) * 0.62;
  const slalomPts = (x0: number, x1: number): { x: number; y: number }[] => {
    const steps = Math.max(2, Math.round((Math.abs(x1 - x0) / (xR - xL)) * 18));
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = x0 + (x1 - x0) * (i / steps);
      const neck = 1 - 0.55 * Math.exp(-(((x - xW) / (ph * 1.6)) ** 2));
      pts.push({
        x,
        y: yTrack + scatterY(x, posts, postSpread, yTrack) * ph * 0.62 * neck,
      });
    }
    return pts;
  };
  // the flexible tap hose from the wiper contact down to the W pin (a cubic bezier)
  const c1 = { x: xW, y: yTrack + ph + hh * 0.3 };
  const c2 = { x: W.x, y: W.y - hh * 0.3 };
  const hose: { x: number; y: number }[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const u = 1 - t;
    hose.push({
      x:
        u * u * u * xW +
        3 * u * u * t * c1.x +
        3 * u * t * t * c2.x +
        t ** 3 * W.x,
      y:
        u * u * u * yTrack +
        3 * u * u * t * c1.y +
        3 * u * t * t * c2.y +
        t ** 3 * W.y,
    });
  }
  // hose structure (the tapped carriers ride it via the split below)
  g.poly(
    hose.flatMap((p) => [p.x, p.y]),
    false,
  ).stroke({ width: 7, color: PALETTE.rail, alpha: 0.5, cap: "round" });
  g.poly(
    hose.flatMap((p) => [p.x, p.y]),
    false,
  ).stroke({ width: 4, color: PALETTE.accent, alpha: 0.32, cap: "round" });
  // the proportional split, weighted by each leg's current (KCL: tap = A→W − W→B)
  const iAW = o.electrical.current;
  const iWB = o.electrical.legs?.[0] ?? iAW;
  flowSplit(
    g,
    slalomPts(xL, xW),
    [
      { path: slalomPts(xW, xR), weight: Math.abs(iWB) },
      { path: hose, weight: Math.abs(iAW - iWB) },
    ],
    flow,
    dir,
    o.phase,
    WATER2,
    2.4,
  );

  // --- the wiper STANDPIPE (rises to the tapped head) + contact -----------------
  // the head the wiper taps: the divider fraction (from the LOW end) of the supply head
  const tapped = (aHigh ? 1 - wiper : wiper) * head;
  const spTop = yTrack - hh * 0.46;
  const spW = hw * 0.05;
  const spLevel = yTrack - tapped * (yTrack - spTop);
  for (const s of [-1, 1]) {
    g.moveTo(xW + s * spW, yTrack)
      .lineTo(xW + s * spW, spTop)
      .stroke({ width: 1.6, color: PALETTE.rail, alpha: 0.8 });
  }
  g.rect(xW - spW + 1, spLevel, 2 * spW - 2, yTrack - spLevel).fill({
    color: PALETTE.accent,
    alpha: 0.4,
  });
  g.moveTo(xW - spW, spLevel)
    .lineTo(xW + spW, spLevel)
    .stroke({ width: 1.8, color: PALETTE.accent, alpha: 0.9 });
  g.circle(xW, yTrack, 4).fill({ color: PALETTE.accent, alpha: 0.95 });
  g.circle(xW, yTrack, 4).stroke({ width: 1, color: WARM, alpha: 0.7 });

  stud(g, A.x, A.y, PALETTE.bronze);
  stud(g, B.x, B.y, PALETTE.bronze);
  stud(g, W.x, W.y, PALETTE.accent);
}

// ============================================================================
// Thermistor (NTC/PTC) — a HEAT-ACTUATED SHUTTER VALVE on the pipe (ported from the
// thermistor-tiers reference sheets). A heater under the orifice is the temperature; the
// shutter plates set the channel width = the resistance. An NTC OPENS as it heats (R
// falls); the switching-ceramic PTC stays open until its Curie point then SNAPS shut (R
// jumps decades). One drawer serves both: the openness comes straight from R(T) via the
// shared thermistor model, so the two read as mirror images.
//
// Live mapping (thermistor ElectricalState + the temperature knob, value = nominal R):
//   • openness = openness(R(kind, value, temp))  → the shutter gap.
//   • heat     = tempNorm(kind, temp)            → heater glow + rising waves.
//   • flow     = norm(|I|)                       → carriers through the gap (sign = dir).
// ============================================================================
function drawAnalogyThermistor(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;
  const kind: ThermistorKind = o.kind === "PTC" ? "PTC" : "NTC";
  const tempC = o.temp ?? THERMISTOR_TEMP[kind].def;
  const r0 = o.value && o.value > 0 ? o.value : kind === "NTC" ? 10000 : 100;
  const open = thermistorOpenness(thermistorResistance(kind, r0, tempC));
  const tN = tempNorm(kind, tempC);
  const cur = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1;

  const A = anchorPt(o, "A", -0.588, 0);
  const B = anchorPt(o, "B", 0.588, 0);
  const lineY = (A.y + B.y) / 2;
  const cx = (A.x + B.x) / 2;
  const pipeHH = hh * 0.18;
  const bodyHW = hw * 0.2;
  const EMBER = PALETTE.bad;

  // --- pipe walls (A→chamber, chamber→B) + flange caps at the pins ---------------
  for (const s of [-1, 1]) {
    g.moveTo(A.x, lineY + s * pipeHH)
      .lineTo(cx - bodyHW, lineY + s * pipeHH)
      .moveTo(cx + bodyHW, lineY + s * pipeHH)
      .lineTo(B.x, lineY + s * pipeHH)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }
  for (const x of [A.x, B.x]) {
    g.moveTo(x, lineY - pipeHH)
      .lineTo(x, lineY + pipeHH)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }
  housing(
    g,
    cx - bodyHW,
    lineY - pipeHH - 8,
    bodyHW * 2,
    (pipeHH + 8) * 2,
    PALETTE.warn,
    7,
  );

  // --- heater under the orifice: coil + glow + rising waves (the temperature) -----
  const coilY = lineY + pipeHH + hh * 0.24;
  if (tN > 0.02) {
    g.circle(cx, coilY, hh * (0.13 + 0.26 * tN)).fill({
      color: EMBER,
      alpha: 0.1 + 0.3 * tN,
    });
  }
  g.poly(
    springPts(cx - bodyHW * 0.7, cx + bodyHW * 0.7, coilY, 5, 4),
    false,
  ).stroke({ width: 3, color: mix(PALETTE.rail, EMBER, tN), alpha: 0.9 });
  for (let i = 0; i < 3; i++) {
    const a = Math.max(0, (tN - 0.18) / 0.82) * 0.6 * (1 - i * 0.22);
    if (a <= 0) continue;
    const baseY = coilY - 9 - i * 9;
    const d: number[] = [];
    for (let k = 0; k <= 6; k++) {
      d.push(
        cx - 14 + k * 5,
        baseY + Math.sin(k * 0.9 + o.phase * PULSE_K + i) * 3,
      );
    }
    g.poly(d, false).stroke({
      width: 2,
      color: mix(EMBER, 0xffffff, 0.25),
      alpha: a,
    });
  }

  // The shutter gap (half-height): a fully-open valve clears the whole channel (the
  // plates retract out of sight), a shut one closes to a ~2 px slit. `fullGap` past the
  // pipe so the achievable openness range opens *all the way* before it pinches.
  const fullGap = pipeHH * 2.6;
  const half = (4 + open * (fullGap - 4)) / 2;
  // What the STREAM may use is bounded by the pipe; so when the gate is wider than the
  // pipe (fully open) the flow fills it uniformly — no residual pinch, "really open".
  const flowGap = Math.min(half, pipeHH - 1);

  // --- flow funnelling THROUGH the gap (current) — carriers ride the full channel,
  // squeeze through the gate, fan back out; the pinch IS the resistance. Drawn under
  // the plates so the plate edges crisply bound the gap. ---------------------------
  flowThroughGap(
    g,
    A.x,
    B.x,
    lineY,
    pipeHH,
    flowGap,
    cx,
    bodyHW * 1.7,
    cur,
    dir,
    o.phase,
    WATER,
    2.4,
  );

  // --- the shutter plates: close from each wall toward the axis as the valve shuts;
  // fully retracted (nothing drawn) once the gate clears the pipe. -----------------
  const plateInner = Math.min(half, pipeHH);
  if (pipeHH - plateInner > 0.5) {
    const plateCol = mix(PLATE, PALETTE.warn, tN * 0.6);
    const plateW = bodyHW * 1.2;
    for (const s of [-1, 1]) {
      const yEdge = lineY + s * plateInner; // inner (gap-side) edge
      const yWall = lineY + s * (pipeHH + 2); // outer (wall) edge, slight overhang
      g.rect(
        cx - plateW / 2,
        Math.min(yEdge, yWall),
        plateW,
        Math.abs(yWall - yEdge),
      ).fill({ color: plateCol, alpha: 0.92 });
      g.rect(
        cx - plateW / 2,
        Math.min(yEdge, yWall),
        plateW,
        Math.abs(yWall - yEdge),
      ).stroke({ width: 1.2, color: 0x8893a6, alpha: 0.6 });
    }
  }

  stud(g, A.x, A.y, PALETTE.bronze);
  stud(g, B.x, B.y, PALETTE.bronze);
}

/**
 * The analogy-tier drawers, keyed by kind — the middle sibling to DRAWERS /
 * DETAIL_DRAWERS, rendered full-panel like the reality tier. A kind absent here has
 * no rich analogy yet; the host falls back to the (scaled) board Factory glyph.
 */
const ANALOGY_DRAWERS: Record<string, (g: Graphics, o: AnalogyOpts) => void> = {
  R: drawAnalogyResistor,
  C: drawAnalogyCeramicCap,
  EC: drawAnalogyElectrolyticCap,
  L: drawAnalogyInductor,
  TR: drawAnalogyTransformer,
  D: drawAnalogyDiode,
  SD: drawAnalogyDiode,
  LED: drawAnalogyDiode,
  ZD: drawAnalogyZener,
  Q: drawAnalogyBjt,
  QP: drawAnalogyBjt,
  NM: drawAnalogyMosfet,
  PM: drawAnalogyMosfet,
  OA: drawAnalogyOA,
  MOV: drawAnalogyVaristor,
  POT: drawAnalogyPOT,
  NTC: drawAnalogyThermistor,
  PTC: drawAnalogyThermistor,
};

/** Whether a kind has a full-panel analogy illustration (vs. the board glyph). */
export function hasAnalogy(kind: string): boolean {
  return kind in ANALOGY_DRAWERS;
}

/**
 * Draw a kind's analogy illustration into the (pre-cleared) Graphics, animated from
 * the live `electrical` + shared `phase`. Returns true if an analogy drawer exists
 * (and ran); false if the caller should fall back to the board Factory glyph. Never
 * touches the sim — pure presentation.
 */
export function drawAnalogy(g: Graphics, o: AnalogyOpts): boolean {
  const drawer = ANALOGY_DRAWERS[o.kind];
  if (!drawer) return false;
  drawer(g, o);
  return true;
}

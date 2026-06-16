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
  type TierOpts as AnalogyOpts,
  anchorPt,
  belt,
  dotPresence,
  housing,
  mix,
  norm,
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
  const pipeL = aX + 4;
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

  // --- the pipe walls ----------------------------------------------------------
  for (const s of [-1, 1]) {
    g.moveTo(pipeL, s * pipeHH)
      .lineTo(pipeR, s * pipeHH)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.9 });
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
  const pipeL = aX + 4;
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

  // --- pipe walls --------------------------------------------------------------
  for (const s of [-1, 1]) {
    g.moveTo(pipeL, s * pipeHH)
      .lineTo(pipeR, s * pipeHH)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.9 });
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
// Electrolytic capacitor — ported from capacitor-electrolytic-tiers.html tier 2:
// TWO CONNECTED TANKS. The source tank feeds the capacitor tank through a valve
// (= series R); water flows until the two levels match, then stops. The level in
// the cap tank is Vc; a WIDER tank holds more for the same level — more capacitance.
//
// Live mapping (cap ElectricalState: current a→b, vAcross = Vc):
//   • level / Vc  = vAcross → the cap-tank water height.
//   • flow        = norm(|I|) → connecting-pipe dot density; sign sets dir + which
//     tank stands higher (charging: source above cap; discharging: below).
//   • capacitance = value (F) → the cap-tank width.
// ============================================================================
function drawAnalogyElectrolyticCap(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;

  const flow = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1;
  const level = Math.max(
    0,
    Math.min(1, o.electrical.vAcross / (V_SCALE * 1.6)),
  );

  const baseY = hh * 0.5; // tank floor
  const maxH = hh * 0.92; // full-scale water column (kept within bounds)
  const srcX = -hw * 0.66;
  const srcW = hw * 0.34;
  const capCx = hw * 0.34;
  const capHalf = hw * (0.12 + 0.2 * (o.value ? norm(o.value, 5e-4) : 0.5));
  const valveX = -hw * 0.02;
  const pipeY = baseY - 6;

  // Source level leads/lags the cap by the flow (drives the equalisation).
  const srcLevel = Math.max(0, Math.min(1, level + dir * 0.18 * flow));
  const capSurf = baseY - level * maxH;
  const srcSurf = baseY - srcLevel * maxH;

  // --- source tank (left) ------------------------------------------------------
  g.moveTo(srcX, baseY - maxH)
    .lineTo(srcX, baseY)
    .lineTo(srcX + srcW, baseY)
    .lineTo(srcX + srcW, baseY - maxH)
    .stroke({ width: 2.2, color: PALETTE.border, alpha: 0.9 });
  g.rect(srcX + 2, srcSurf, srcW - 4, baseY - srcSurf).fill({
    color: WATER,
    alpha: 0.5,
  });

  // --- capacitor tank (right): width = capacitance -----------------------------
  const capL = capCx - capHalf;
  const capR = capCx + capHalf;
  g.moveTo(capL, baseY - maxH)
    .lineTo(capL, baseY)
    .lineTo(capR, baseY)
    .lineTo(capR, baseY - maxH)
    .stroke({ width: 3, color: PLATE, alpha: 0.92 });
  g.rect(capL + 2, capSurf, 2 * capHalf - 4, baseY - capSurf).fill({
    color: WATER,
    alpha: 0.6,
  });

  // --- connecting pipe at the bottom + valve = series R ------------------------
  for (const yy of [pipeY - 6, pipeY + 6]) {
    g.moveTo(srcX + srcW, yy)
      .lineTo(capL, yy)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }
  g.moveTo(valveX, pipeY - 6)
    .lineTo(valveX, pipeY - 20)
    .stroke({ width: 4, color: PRESS, alpha: 0.85 });

  // --- the current through the connecting pipe ---------------------------------
  belt(
    g,
    srcX + srcW + 4,
    pipeY,
    capL - 4,
    pipeY,
    flow,
    dir,
    o.phase,
    WATER,
    2.6,
  );

  stud(g, srcX, baseY, PALETTE.bronze);
  stud(g, capR, baseY, PALETTE.bronze);
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
  const ballR = hh * 0.2;
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

  // --- the seat (two lips the ball seals against) ------------------------------
  for (const s of [-1, 1]) {
    g.poly([
      seatX - 10,
      s * (pipeHH + 6),
      seatX + 8,
      s * (pipeHH + 6),
      seatX + 3,
      s * pipeHH * 0.4,
      seatX - 5,
      s * pipeHH * 0.4,
    ]).fill({ color: PALETTE.rail, alpha: 0.9 });
  }

  // --- the spring (plunger → ball), compressed when the ball lifts --------------
  g.roundRect(plungerX, -ballR, 8, ballR * 2, 2).fill({
    color: PALETTE.rail,
    alpha: 0.9,
  });
  g.poly(springPts(liftX + ballR, plungerX, 0, ballR * 0.45, 6), false).stroke({
    width: 2.6,
    color: WARM,
    alpha: 0.85,
  });

  // --- water through when open, or a dammed trickle stalled at the seat ---------
  if (conducting) {
    belt(g, aX, 0, seatX - ballR, 0, fwd, 1, o.phase, WATER, 2.6);
    belt(g, liftX + ballR, 0, bX, 0, fwd, 1, o.phase, WATER, 2.6);
  } else if (breakdown) {
    belt(g, bX, 0, aX, 0, rev, -1, o.phase, PALETTE.bad, 2.6);
  } else {
    // blocked: a few dots pile up against the seat from the anode side
    for (let k = 0; k < 3; k++) {
      const t = (((k / 3 + o.phase * FLOW_SPEED) % 1) + 1) % 1;
      g.circle(aX + (seatX - ballR - aX) * t, 0, 2.2).fill({
        color: WATER,
        alpha: 0.3 * (1 - t),
      });
    }
  }

  // --- the ball + its highlight ------------------------------------------------
  const ballCol = conducting ? PALETTE.ok : breakdown ? PALETTE.bad : PLATE;
  g.circle(liftX, 0, ballR).fill({ color: ballCol, alpha: 0.92 });
  g.circle(liftX, 0, ballR).stroke({ width: 1.5, color: 0xdce3f0, alpha: 0.6 });
  g.circle(liftX - ballR * 0.34, -ballR * 0.34, ballR * 0.22).fill({
    color: 0xffffff,
    alpha: 0.7,
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
  const clamping = rev > 0.03;
  const vrev = Math.max(0, -o.electrical.vAcross); // reverse volts across the part
  const vz = o.value && o.value > 0 ? o.value : 5.1;
  const wall = Math.min(0.92, vz / (V_SCALE * 1.6)); // spillway-wall height frac
  const lvl = Math.min(1, vrev / (V_SCALE * 1.6)); // standpipe level

  // Terminals on the real pins: anode left, cathode right, both on the part's axis.
  const A = anchorPt(o, "A", -0.588, 0);
  const K = anchorPt(o, "K", 0.588, 0);
  const lineY = (A.y + K.y) / 2; // the forward valve runs along the pin axis
  const pipeHH = hh * 0.12;

  // --- forward check valve (left of centre): a compact spring valve on the axis --
  const bodyL = A.x + hw * 0.16;
  const bodyR = -hw * 0.04;
  const seatX = bodyL + 14;
  const ballR = hh * 0.15;
  const plungerX = bodyR - 6;
  const liftX = Math.min(
    plungerX - ballR - 4,
    seatX + ballR + 3 + hw * 0.12 * fwd,
  );
  // standpipe tap sits between the valve and the cathode
  const spX = hw * 0.34;
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
  housing(
    g,
    bodyL,
    lineY - pipeHH - 9,
    bodyR - bodyL,
    (pipeHH + 9) * 2,
    PALETTE.bronze,
    9,
  );
  for (const s of [-1, 1]) {
    g.poly([
      seatX - 8,
      lineY + s * (pipeHH + 5),
      seatX + 10,
      lineY + s * (pipeHH + 5),
      seatX + 4,
      lineY + s * pipeHH * 0.4,
      seatX - 4,
      lineY + s * pipeHH * 0.4,
    ]).fill({ color: PALETTE.rail, alpha: 0.9 });
  }
  g.roundRect(plungerX, lineY - ballR, 7, ballR * 2, 2).fill({
    color: PALETTE.rail,
    alpha: 0.9,
  });
  g.poly(
    springPts(liftX + ballR, plungerX, lineY, ballR * 0.4, 6),
    false,
  ).stroke({ width: 2.4, color: WARM, alpha: 0.85 });
  const ballCol = conducting ? PALETTE.ok : clamping ? PALETTE.warn : PLATE;
  g.circle(liftX, lineY, ballR).fill({ color: ballCol, alpha: 0.92 });
  g.circle(liftX, lineY, ballR).stroke({
    width: 1.4,
    color: 0xdce3f0,
    alpha: 0.6,
  });

  // --- reverse standpipe + spillway (rises up from the tap toward the cathode) ---
  const spW = hw * 0.2;
  const spBot = lineY - pipeHH;
  const spTop = -hh * 0.88;
  const span = spBot - spTop;
  g.moveTo(spX, lineY)
    .lineTo(spX, spBot)
    .stroke({ width: 2, color: PALETTE.border, alpha: 0.5 });
  for (const s of [-1, 1]) {
    g.moveTo(spX + (s * spW) / 2, spBot)
      .lineTo(spX + (s * spW) / 2, spTop)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.85 });
  }
  // the spillway wall at height Vz (the right lip the water pours over)
  const wallY = spBot - wall * span;
  g.moveTo(spX + spW / 2, wallY)
    .lineTo(spX + spW / 2 + 14, wallY)
    .stroke({ width: 3, color: PALETTE.accent, alpha: 0.9 });
  // water level = reverse voltage, held at the wall once reached (the clamp)
  const lvlY = spBot - Math.min(lvl, wall) * span;
  g.rect(spX - spW / 2 + 2, lvlY, spW - 4, spBot - lvlY).fill({
    color: WATER,
    alpha: 0.6,
  });
  g.moveTo(spX - spW / 2 + 2, lvlY)
    .lineTo(spX + spW / 2 - 2, lvlY)
    .stroke({ width: 1.6, color: WATER2, alpha: lvl > 0.05 ? 0.85 : 0 });

  // --- the cascade over the crest + the return path back to the anode -----------
  // (reverse current returns to the anode side once the level tops the Vz wall)
  if (clamping && lvl >= wall - 0.03) {
    const retY = -hh * 0.66;
    g.moveTo(spX + spW / 2 + 14, wallY)
      .lineTo(spX + spW / 2 + 14, retY)
      .lineTo(A.x + hw * 0.08, retY)
      .lineTo(A.x + hw * 0.08, lineY - pipeHH)
      .stroke({ width: 2, color: PALETTE.warn, alpha: 0.4 });
    for (let k = 0; k < 4; k++) {
      const t = (((k / 4 + o.phase * FLOW_SPEED) % 1) + 1) % 1;
      g.circle(
        spX + spW / 2 + 8 + t * 10,
        wallY + t * t * (spBot - wallY) * 0.7,
        2.4,
      ).fill({ color: WATER2, alpha: 0.75 * (1 - t * 0.5) });
    }
  }

  // --- flow: forward through the valve, or reverse backing up to the standpipe ---
  if (conducting) {
    belt(g, A.x, lineY, seatX - ballR, lineY, fwd, 1, o.phase, WATER, 2.6);
    belt(g, liftX + ballR, lineY, K.x, lineY, fwd, 1, o.phase, WATER, 2.6);
  } else if (clamping) {
    belt(g, K.x, lineY, spX, lineY, rev, -1, o.phase, PALETTE.warn, 2.4);
  }

  stud(g, A.x, A.y, PALETTE.bronze);
  stud(g, K.x, K.y, PALETTE.bronze);
}

// ============================================================================
// Bipolar transistor (BJT) — ported from transistor-tiers.html tier 2: an AMPLIFYING
// VALVE. A big vertical supply pipe (collector at top, emitter at bottom, pressure =
// V_CE) is sealed by a plug at a seat. A small BASE flow trickles through a check
// valve (cracks at ~0.7 V) into a side chamber; the rising level floats a linkage
// that lifts the plug, opening a LARGE collector flow. A small base flow commands a
// big collector flow — the gain β. I_E = I_C + I_B.
//
// Live mapping (BJT ElectricalState: current = I_C, vAcross = V_CE; value = β):
//   • collector = norm(|I_C|) → plug lift + the big collector/emitter flow density.
//   • base      = small proxy  → the chamber level + the thin base trickle.
//   • supply    = V_CE         → the reservoir fill at the top.
// ============================================================================
function drawAnalogyBjt(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;
  const npn = o.kind !== "QP";

  const ic = norm(o.electrical.current, CUR_SCALE);
  const vce = norm(o.electrical.vAcross, V_SCALE);
  // Gate opening: a SENSITIVE response to the collector current (steep near zero,
  // saturating) so the plug + chamber visibly track even small currents instead of
  // barely budging — the gate-lift is the teaching point.
  const lvl = norm(o.electrical.current, CUR_SCALE * 0.3);
  const conducting = ic > 0.03;

  const pipeX = hw * 0.34;
  const pipeHW = hw * 0.1;
  const pipeTop = -hh * 0.56;
  const pipeBot = hh * 0.56;
  const throatY = 0;
  const plugY = throatY - lvl * hh * 0.42; // lifts up off the seat as it opens
  const chamX = -hw * 0.42;
  const chamHW = hw * 0.16;
  const chamTop = -hh * 0.3;
  const chamBot = hh * 0.44;
  const waterY = chamBot - lvl * (chamBot - chamTop);

  // --- supply reservoir (pressure = V_CE) just beyond the supply end -----------
  const resH = hh * 0.16;
  const resY = npn ? pipeTop - resH : pipeBot; // above (NPN) / below (PNP) the pipe
  g.roundRect(pipeX - hw * 0.16, resY, hw * 0.32, resH, 3).stroke({
    width: 1.6,
    color: PALETTE.rail,
    alpha: 0.85,
  });
  g.rect(pipeX - hw * 0.15, resY + resH * (1 - vce), hw * 0.3, resH * vce).fill(
    {
      color: WATER,
      alpha: 0.45,
    },
  );

  // --- main pipe walls + seat + plug -------------------------------------------
  for (const s of [-1, 1]) {
    g.moveTo(pipeX + s * pipeHW, pipeTop)
      .lineTo(pipeX + s * pipeHW, pipeBot)
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
  // collector (large) + emitter flow around the plug, when open
  if (conducting) {
    belt(
      g,
      pipeX,
      npn ? pipeTop : pipeBot,
      pipeX,
      plugY - 12,
      ic,
      1,
      o.phase,
      WATER,
      2.8,
    );
    belt(
      g,
      pipeX,
      plugY + 12,
      pipeX,
      npn ? pipeBot : pipeTop,
      ic,
      1,
      o.phase,
      WATER,
      2.8,
    );
  }
  const plugCol = conducting ? PLATE : mix(PLATE, PALETTE.dim, 0.5);
  g.ellipse(pipeX, plugY, pipeHW * 1.3, 10).fill({
    color: plugCol,
    alpha: 0.95,
  });
  g.ellipse(pipeX, plugY, pipeHW * 1.3, 10).stroke({
    width: 1.2,
    color: PLATE,
    alpha: 0.6,
  });

  // --- the pilot chamber: base flow fills it, a float lifts the linkage ---------
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
  // float + linkage rod to the plug stem
  g.roundRect(chamX - chamHW + 4, waterY - 6, chamHW * 2 - 8, 10, 2).fill({
    color: PLATE,
    alpha: 0.9,
  });
  g.moveTo(chamX, waterY - 6)
    .lineTo(pipeX, plugY)
    .stroke({ width: 3, color: PLATE, alpha: 0.7 });

  // --- base inlet check valve (cracks at 0.7 V) feeding the chamber ------------
  const bvX = -hw + 14;
  const bvY = chamBot - 8;
  g.moveTo(bvX, bvY)
    .lineTo(chamX - chamHW, bvY)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.8 });
  g.circle(bvX + 22, bvY, 6).fill({
    color: conducting ? PALETTE.ok : PLATE,
    alpha: 0.9,
  });
  if (conducting) {
    belt(
      g,
      bvX,
      bvY,
      chamX - chamHW,
      bvY,
      Math.min(1, lvl * 0.7),
      1,
      o.phase,
      WATER,
      2.2,
    );
  }

  stud(g, bvX, bvY, PALETTE.accent);
  stud(g, pipeX, npn ? pipeTop : pipeBot, PALETTE.bronze);
  stud(g, pipeX, npn ? pipeBot : pipeTop, PALETTE.bronze);
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

  // --- supply→outlet stream around the plug, when the valve is open ------------
  if (conducting) {
    belt(g, pipeX, supplyY, pipeX, plugY - 12, id, 1, o.phase, WATER, 2.8);
    belt(g, pipeX, plugY + 12, pipeX, outletY, id, 1, o.phase, WATER, 2.8);
  }

  // --- the plug (lifts off the seat toward the supply) -------------------------
  g.ellipse(pipeX, plugY, pipeHW * 1.18, 11).fill({
    color: conducting ? PLATE : mix(PLATE, PALETTE.dim, 0.5),
    alpha: 0.95,
  });
  g.ellipse(pipeX, plugY, pipeHW * 1.18, 11).stroke({
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
// Op-amp — ported from opamp-tiers.html tier 2: a pilot SPOOL VALVE. Two sealed
// pilots push on a spool — V+ from one end, V− the other — and their tiny
// difference, times the gain, slides the spool, porting the +rail or −rail supply
// to the output. Push far enough and the spool hits an end stop: the output clips
// at a rail. The inputs are sealed (high-Z); they draw no flow.
//
// Live mapping (op-amp ElectricalState: current = Iout, vAcross = V(OUT)−V(IN−);
// value = ±Vsat rail):
//   • output = vAcross/Vsat → spool offset + the output-tank level (clamped at rails).
//   • drive  = norm(|Iout|) → ported flow to the tank; sign sets the direction.
//   • the WINNING input pushes harder (reconstructed from the output's sign).
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

  const spX = -hw * 0.08; // spool between the inputs (left) and the output (right)
  const spHW = hw * 0.085;
  const spTop = -hh * 0.6;
  const spBot = hh * 0.6;
  const cy = -swing * (hh * 0.4); // ported-channel centre: up for +out, down for −
  const gap = hh * 0.15;

  // --- supply rails: +rail bar at the top, −rail at the bottom (glow when clipped)
  for (const [ry, glow] of [
    [spTop, sat && posWins],
    [spBot, sat && !posWins],
  ] as const) {
    g.moveTo(spX - spHW - 5, ry)
      .lineTo(spX + spHW + 5, ry)
      .stroke({
        width: 3,
        color: glow ? PALETTE.accent : PALETTE.rail,
        alpha: glow ? 0.95 : 0.7,
      });
  }

  // --- input pilots (sealed, no flow): IN+ → top end, IN− → bottom end ----------
  const pushP = posWins ? 0.45 + 0.5 * Math.abs(swing) : 0.3;
  const pushN = posWins ? 0.3 : 0.45 + 0.5 * Math.abs(swing);
  for (const [an, end, push, col, s] of [
    [IP, spTop, pushP, POS, 1],
    [IM, spBot, pushN, NEG, -1],
  ] as const) {
    const portY = end + s * 8;
    g.moveTo(an.x, an.y)
      .lineTo(spX - spHW - 6, portY)
      .stroke({ width: 2, color: col, alpha: 0.4 });
    // pilot piston pressing on the spool end; the winner presses harder
    const tipX = spX - spHW - 3;
    const tailX = tipX - 7 - 12 * push;
    g.poly([tailX, portY - 4, tailX, portY + 4, tipX, portY]).fill({
      color: col,
      alpha: 0.9,
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
      {
        color: PLATE,
        alpha: 0.92,
      },
    );
  }
  // spool stem + gain knob (the difference, geared up by the open-loop gain)
  g.moveTo(spX, spTop)
    .lineTo(spX, spBot)
    .stroke({ width: 2.5, color: PLATE, alpha: 0.4 });
  g.circle(spX, cy, 6).fill({ color: 0x10131f, alpha: 0.8 });
  g.circle(spX, cy, 6).stroke({
    width: 1.6,
    color: PALETTE.accent,
    alpha: 0.85,
  });

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
  for (const ry of [tankT, tankB]) {
    g.moveTo(tankX - tankHW - 3, ry)
      .lineTo(tankX + tankHW + 3, ry)
      .stroke({ width: 2.5, color: PALETTE.rail, alpha: 0.8 });
  }
  const lvlY = -swing * (hh * 0.62);
  g.rect(
    tankX - tankHW + 2,
    Math.min(0, lvlY),
    tankHW * 2 - 4,
    Math.abs(lvlY),
  ).fill({ color: OUT, alpha: sat ? 0.5 : 0.3 });
  g.moveTo(tankX - tankHW - 3, lvlY)
    .lineTo(tankX + tankHW + 3, lvlY)
    .stroke({ width: 2.5, color: sat ? PALETTE.accent : WARM, alpha: 0.95 });

  // --- ported channel → output tank → the OUT lead -----------------------------
  if (drive > 0.03) {
    belt(g, spX + spHW, cy, tankX - tankHW, 0, drive, dir, o.phase, WATER, 2.6);
  }
  g.moveTo(tankX + tankHW, 0)
    .lineTo(OU.x, OU.y)
    .stroke({ width: 2, color: OUT, alpha: 0.5 });
  stud(g, OU.x, OU.y, OUT);
}

// ============================================================================
// Varistor (MOV) — ported from varistor-tiers.html tier 2: a PRESSURE RELIEF VALVE.
// The two leads pressurise a vessel; the pressure (the voltage) pushes up under a
// poppet held shut by a spring whose set point (a screw) is the clamp voltage. Below
// the clamp it stays sealed — no flow. Past the clamp the poppet cracks open and the
// body chamber vents hard out its side pipes, dumping the surplus to hold the pressure
// near the set point. It works for either polarity (no diode-like direction), so both
// leads feed the same vessel.
//
// Live mapping (MOV ElectricalState: current a→b, vAcross = V across; value = Vclamp):
//   • applied = |vAcross|         → vessel fill + the molecules' jiggle amplitude.
//   • over    = |vAcross|/Vclamp  → poppet lift; once >1 it cracks open and vents.
//   • clamp   = Vclamp            → the set-screw depth (spring preload).
//   • flow    = norm(|I|)         → the vent flow out the side pipes.
// ============================================================================
function drawAnalogyVaristor(g: Graphics, o: AnalogyOpts): void {
  const { hw, hh } = o.bounds;
  const applied = Math.abs(o.electrical.vAcross);
  const vclamp = o.value && o.value > 0 ? o.value : 5;
  const over = applied / vclamp;
  const flow = norm(o.electrical.current, CUR_SCALE);
  const venting = over > 0.95 && flow > 0.02;
  const appN = Math.min(1, applied / (vclamp * 1.5));

  // Both leads ride the real A/B pins (on the part's axis) and feed the vessel.
  const A = anchorPt(o, "A", -0.588, 0);
  const B = anchorPt(o, "B", 0.588, 0);
  const cx = (A.x + B.x) / 2;
  const lineY = (A.y + B.y) / 2;

  // Vertical stack: vessel (below) → neck/seat → body chamber w/ side vents → bonnet.
  const vesHW = hw * 0.2;
  const vesT = lineY + hh * 0.16;
  const vesB = lineY + hh * 0.86;
  const seatY = vesT;
  const lift = Math.min(1, Math.max(0, (over - 1) * 2)) * hh * 0.26;
  const poppetY = seatY - lift;
  const popHW = hw * 0.12;
  const chamHW = hw * 0.15;
  const chamT = lineY - hh * 0.52;
  const ventY = lineY - hh * 0.24;
  const bonnetY = chamT - hh * 0.06;

  // --- the two leads feed the vessel from each side (bidirectional) -------------
  for (const [an, s] of [
    [A, -1],
    [B, 1],
  ] as const) {
    g.moveTo(an.x, an.y)
      .lineTo(cx + s * (vesHW + 12), an.y)
      .lineTo(cx + s * (vesHW + 12), vesT + hh * 0.18)
      .lineTo(cx + s * vesHW, vesT + hh * 0.18)
      .stroke({ width: 2, color: PALETTE.border, alpha: 0.8 });
    stud(g, an.x, an.y, PALETTE.bronze);
  }

  // --- pressure vessel + fill + jiggling molecules -----------------------------
  g.moveTo(cx - vesHW, vesT)
    .lineTo(cx - vesHW, vesB)
    .lineTo(cx + vesHW, vesB)
    .lineTo(cx + vesHW, vesT)
    .stroke({ width: 2.5, color: PALETTE.border, alpha: 0.9 });
  g.rect(
    cx - vesHW + 2,
    vesB - appN * (vesB - vesT),
    vesHW * 2 - 4,
    appN * (vesB - vesT),
  ).fill({ color: WATER, alpha: 0.35 });
  const amp = 1.5 + 5 * appN;
  for (let k = 0; k < 9; k++) {
    const bx = cx + (-1 + (k % 3)) * vesHW * 0.6;
    const by = vesB - hh * 0.12 - Math.floor(k / 3) * hh * 0.18;
    const ph = k * 1.7;
    g.circle(
      bx + Math.sin(o.phase * PULSE_K + ph) * amp,
      by + Math.cos(o.phase * PULSE_K + ph * 1.4) * amp,
      2.4,
    ).fill({ color: WATER2, alpha: 0.85 });
  }

  // --- neck + seat lips the poppet seals against -------------------------------
  for (const s of [-1, 1]) {
    g.moveTo(cx + s * vesHW, vesT)
      .lineTo(cx + s * popHW, seatY)
      .stroke({ width: 2.5, color: PALETTE.rail, alpha: 0.9 });
  }

  // --- body chamber walls (with a vent gap) + the two side vent pipes ----------
  for (const s of [-1, 1]) {
    g.moveTo(cx + s * chamHW, seatY - 4)
      .lineTo(cx + s * chamHW, ventY + 7)
      .moveTo(cx + s * chamHW, ventY - 7)
      .lineTo(cx + s * chamHW, chamT)
      .stroke({ width: 2.2, color: PALETTE.border, alpha: 0.85 });
    g.moveTo(cx + s * chamHW, ventY - 5)
      .lineTo(cx + s * (chamHW + hw * 0.18), ventY - 5)
      .moveTo(cx + s * chamHW, ventY + 5)
      .lineTo(cx + s * (chamHW + hw * 0.18), ventY + 5)
      .stroke({ width: 2.2, color: PALETTE.border, alpha: 0.85 });
  }
  g.moveTo(cx - chamHW, chamT)
    .lineTo(cx + chamHW, chamT)
    .stroke({ width: 2.2, color: PALETTE.border, alpha: 0.85 });

  // --- the poppet (cone) at the seat, lifting when it cracks open --------------
  g.poly([
    cx - popHW,
    poppetY,
    cx + popHW,
    poppetY,
    cx + popHW * 0.55,
    poppetY - hh * 0.13,
    cx - popHW * 0.55,
    poppetY - hh * 0.13,
  ]).fill({ color: venting ? PALETTE.warn : PLATE, alpha: 0.92 });

  // --- bonnet + set screw (depth = clamp) + the threshold spring ---------------
  g.moveTo(cx - hw * 0.13, bonnetY)
    .lineTo(cx + hw * 0.13, bonnetY)
    .stroke({ width: 3, color: PALETTE.rail, alpha: 0.9 });
  const screwBot =
    bonnetY + 6 + Math.min(1, vclamp / (V_SCALE * 4)) * hh * 0.16;
  g.roundRect(cx - hw * 0.05, bonnetY, hw * 0.1, screwBot - bonnetY, 2).fill({
    color: PALETTE.bronze,
    alpha: 0.9,
  });
  g.poly(
    vSpringPts(cx, screwBot, poppetY - hh * 0.13, hw * 0.07, 5),
    false,
  ).stroke({ width: 2.4, color: SPRING, alpha: 0.85 });

  // --- venting: flow bursts out the side vent pipes once cracked open ----------
  if (venting) {
    for (const s of [-1, 1]) {
      belt(
        g,
        cx + s * chamHW,
        ventY,
        cx + s * (chamHW + hw * 0.18),
        ventY,
        flow,
        s,
        o.phase,
        WATER,
        2.4,
      );
    }
  }
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

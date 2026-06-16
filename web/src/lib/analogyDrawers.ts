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
  belt,
  dotPresence,
  mix,
  norm,
  stud,
  CUR_SCALE,
  FLOW_SPEED,
  FLOW_DOTS_MAX,
  V_SCALE,
} from "./tierKit";

// Shared analogy palette: water (cool flow), warm (the moving current/energy),
// pressure (the violet return / resistance), all from PALETTE so one source recolours.
const WATER = mix(PALETTE.cyan, PALETTE.violet, 0.22); // the medium in the pipes
const WARM = mix(PALETTE.bronze, 0xffffff, 0.45); // moving current / hot energy
const PRESS = PALETTE.violet; // pressure / resistance / return

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

/**
 * The analogy-tier drawers, keyed by kind — the middle sibling to DRAWERS /
 * DETAIL_DRAWERS, rendered full-panel like the reality tier. A kind absent here has
 * no rich analogy yet; the host falls back to the (scaled) board Factory glyph.
 */
const ANALOGY_DRAWERS: Record<string, (g: Graphics, o: AnalogyOpts) => void> = {
  R: drawAnalogyResistor,
  L: drawAnalogyInductor,
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

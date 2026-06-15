// SPDX-License-Identifier: Apache-2.0
// Construction-detail drawers: the "factory-building" view of a part's internals,
// animated from the LIVE per-frame ElectricalState so the inner workings show
// what is happening in real time (docs/ui/component-info-panel.md §3). This is a
// third sibling map alongside DRAWERS / FACTORY_DRAWERS in glyphs.ts — same
// `(g, o) => void` shape, but freed from the board's pin-geometry contract: a
// detail drawer paints an *illustration of the object* into a centred bounds, not
// a wired symbol. Hosted by InfoDiagram in its "detail" mode at a larger scale.
//
// Pure presentation, exactly like glyphs.ts / carrierOffset / phase: it only
// READS `electrical` to animate and NEVER feeds the sim, the netlist, or the
// snapshot hash. It recolours entirely from PALETTE — no hardcoded colours — and
// honours the bus-language discipline (docs/ui/visual-language.md): magnitude
// rides alpha / density / thickness, never speed; flow recirculates on the
// bounded `phase` clock at a constant calm rate.

import { Graphics } from "pixi.js";
import { PALETTE } from "./graph";
import { ZERO_ELECTRICAL, type ElectricalState } from "./glyphs";

/**
 * What a detail drawer is handed. A superset of the glyph's draw inputs, but with
 * a centred {@link DetailBounds} instead of pin coordinates — the illustration
 * owns its whole canvas. `color` is the kind's accent (PALETTE); `electrical` and
 * `phase` are the same live pair the glyphs animate from; `value`/`wiper` carry a
 * part's primary/secondary scalar for the few state-bearing kinds.
 */
export interface DetailOpts {
  kind: string;
  /** Drawing region, centred on the origin (the host translates to canvas centre). */
  bounds: DetailBounds;
  /** The kind's accent colour (PALETTE[colorKey]). */
  color: number;
  /** Live per-element readout — the source of all motion. */
  electrical: ElectricalState;
  /** Free-running animation phase (seconds); the bounded visual flow clock. */
  phase: number;
  /** The part's primary scalar (Component.value); most detail drawers ignore it. */
  value?: number;
  /** A potentiometer's wiper in [0,1]; only the POT detail reads it. */
  wiper?: number;
}

/** Half-extents of the centred drawing region, in local (pre-scale) px. */
export interface DetailBounds {
  hw: number;
  hh: number;
}

// --- shared scales + helpers (mirroring glyphs.ts, kept local) ----------------

// Saturating normalize: magnitude → 0..1 with a soft knee at `scale`.
function norm(x: number, scale: number): number {
  const a = Math.abs(x) / scale;
  return a / (1 + a);
}

const CUR_SCALE = 0.02; // ~20 mA reads as a strong current
const V_SCALE = 6; // ~6 V reads as a strong field/drop
const OUT_SCALE = 8; // op-amp output rails near ±8 V (teaching saturation)

// Constant recirculation per unit phase — NOT magnitude-scaled (the anti-pattern
// is speed-carries-magnitude; see docs/ui/visual-language.md). Magnitude is
// carried by density + alpha instead.
const FLOW_SPEED = 1.0;
const FLOW_DOTS_MIN = 2;
const FLOW_DOTS_MAX = 7;
// Breathing/pulse clock, on the same bounded phase (~1.3 visual Hz).
const PULSE_K = 2.2;

/** A 0xRRGGBB → {r,g,b} split, for cheap channel blends. */
function rgb(c: number): { r: number; g: number; b: number } {
  return { r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff };
}
/** Linear blend between two packed colours, t in [0,1]. */
function mix(a: number, b: number, t: number): number {
  const ca = rgb(a);
  const cb = rgb(b);
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(ca.r + (cb.r - ca.r) * k);
  const g = Math.round(ca.g + (cb.g - ca.g) * k);
  const bl = Math.round(ca.b + (cb.b - ca.b) * k);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Flowing carriers along a straight segment — the detail-view "belt". Density +
 * alpha ride `mag` (0..1); the belt always recirculates at the bounded rate.
 * `dir` (+1/−1) sets travel direction. `r` is the dot radius.
 */
function belt(
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
  const n = FLOW_DOTS_MIN + Math.round((FLOW_DOTS_MAX - FLOW_DOTS_MIN) * mag);
  for (let i = 0; i < n; i++) {
    const t = (((i / n + phase * FLOW_SPEED * dir) % 1) + 1) % 1;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    g.circle(x, y, r).fill({ color, alpha: 0.35 + 0.55 * mag });
  }
}

/** A terminal stud (dark disc + coloured core), the factory-style pin marker. */
function stud(g: Graphics, x: number, y: number, color: number): void {
  g.circle(x, y, 5).fill({ color: 0x101820 });
  g.circle(x, y, 5).stroke({ width: 1.5, color });
  g.circle(x, y, 2.4).fill({ color });
}

/** A factory machine-housing panel: dark body, accent edge, top depth highlight. */
function housing(
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

// ============================================================================
// Op-amp — THE exemplar. Ported from 1069ef5b-opampfactory.html: the two inputs
// stream in on the left (V+ cyan on top, V− amber on bottom), a differential core
// compares them, and the output puck slams toward whichever input is winning,
// pinning against ±Vsat — the enormous gain. The rose output belt leaves the apex.
//
// Live mapping (the op-amp ElectricalState carries Iout and V(OUT)−V(IN−)):
//   • output swing  = norm(vAcross, OUT_SCALE), sign → which rail it leans to.
//     This is the puck deflection + the rail-pin / saturation cue.
//   • output drive  = norm(current, CUR_SCALE)  → the output belt density + the
//     body's worked-glow. Sign sets the belt direction.
//   • the WINNING input (the side dragging the output) is the one whose belt runs
//     bright/dense; the other dims — reconstructed from the output's sign, so the
//     "inputs compete, output chases the difference" lesson animates from real
//     state. Both inputs always sense (high-Z), so both belts are present.
// ============================================================================
function drawDetailOA(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const POS = PALETTE.pos;
  const NEG = PALETTE.neg;
  const OUT = PALETTE.out;
  const RAIL = PALETTE.rail;

  // Layout (local coords, origin = centre). Inputs enter far left; the capsule
  // body sits centre; the output column + apex + output belt run right.
  const inX = -hw + 8; // input terminal studs
  const capL = -hw * 0.42; // capsule left wall
  const capR = hw * 0.18; // capsule right wall
  const capT = -hh * 0.74;
  const capB = hh * 0.74;
  const inPy = -hh * 0.42; // V+ lead height (top)
  const inMy = hh * 0.42; // V− lead height (bottom)
  const colX = hw * 0.02; // internal output column x
  const colT = -hh * 0.52;
  const colB = hh * 0.52;
  const apexX = capR + 6;
  const outX = hw - 8; // output terminal stud

  // The output swing relative to its supply rail. `vAcross` = V(OUT)−V(IN−), and
  // `value` = ±Vsat (the rail), so normalise against Vsat when it's known so the
  // puck pins to the rail exactly when the real output saturates; fall back to a
  // teaching scale otherwise. Pure read of live state — no sim coupling.
  const railV = o.value && o.value > 0.5 ? o.value : OUT_SCALE;
  const swing = o.electrical.vAcross / railV; // signed, ~[-1,1] past the rail
  const swingC = Math.max(-1, Math.min(1, swing));
  const sat = Math.abs(swing) >= 0.985; // pinned to a rail (comparator regime)
  const drive = norm(o.electrical.current, CUR_SCALE);
  const driveDir = o.electrical.current >= 0 ? 1 : -1;
  // Which input is winning: output high ⇒ + input is on top, so the + belt is hot.
  const posWins = swingC >= 0;
  const winMag = 0.35 + 0.55 * Math.abs(swingC);
  const loseMag = 0.2 + 0.15 * (1 - Math.abs(swingC));
  const iPos = posWins ? winMag : loseMag;
  const iNeg = posWins ? loseMag : winMag;

  // --- faint signal-path guides (the belts' lanes), color-coded ----------------
  g.moveTo(inX, inPy)
    .lineTo(capL, inPy)
    .stroke({ width: 5, color: POS, alpha: 0.14 });
  g.moveTo(inX, inMy)
    .lineTo(capL, inMy)
    .stroke({ width: 5, color: NEG, alpha: 0.14 });
  g.moveTo(apexX, 0)
    .lineTo(outX, 0)
    .stroke({ width: 5, color: OUT, alpha: 0.14 });

  // --- the rose saturation halo behind the body when railed --------------------
  if (sat) {
    const breathe = 0.8 + 0.2 * Math.sin(o.phase * PULSE_K);
    g.roundRect(
      capL - 6,
      capT - 6,
      capR - capL + 12,
      capB - capT + 12,
      16,
    ).fill({
      color: OUT,
      alpha: 0.1 * breathe,
    });
  }

  // --- the cyan capsule shell (the op-amp building) ----------------------------
  housing(g, capL, capT, capR - capL, capB - capT, POS, 16);
  // status light on the roof: green in the linear regime, rose when saturated.
  const statusCol = sat ? OUT : PALETTE.ok;
  g.circle((capL + capR) / 2, capT + 7, 4).fill({
    color: statusCol,
    alpha: 0.55 + 0.4 * Math.max(Math.abs(swingC), 0.3),
  });

  // --- input leads + studs + polarity marks ------------------------------------
  g.moveTo(inX, inPy).lineTo(capL, inPy);
  g.moveTo(inX, inMy).lineTo(capL, inMy);
  g.stroke({ width: 2, color: RAIL, alpha: 0.85 });
  stud(g, inX, inPy, POS);
  stud(g, inX, inMy, NEG);
  // '+' at the non-inverting input, '−' at the inverting input (inside the wall).
  const mk = capL + 9;
  g.moveTo(mk - 3, inPy)
    .lineTo(mk + 3, inPy)
    .moveTo(mk, inPy - 3)
    .lineTo(mk, inPy + 3);
  g.stroke({ width: 1.8, color: POS, alpha: 0.9 });
  g.moveTo(mk - 3, inMy).lineTo(mk + 3, inMy);
  g.stroke({ width: 1.8, color: NEG, alpha: 0.9 });

  // --- the differential core: the two input taps + a DIFF read-bar -------------
  const tapX = capL + 16;
  g.circle(tapX, inPy, 2).fill({ color: POS, alpha: 0.5 + 0.4 * iPos });
  g.circle(tapX, inMy, 2).fill({ color: NEG, alpha: 0.5 + 0.4 * iNeg });
  // a vertical "comparator gauge" between the taps, tinted toward the winner.
  const gaugeCol = mix(NEG, POS, (swingC + 1) / 2);
  g.moveTo(tapX, inPy + 3)
    .lineTo(tapX, inMy - 3)
    .stroke({
      width: 2,
      color: gaugeCol,
      alpha: 0.4 + 0.35 * Math.abs(swingC),
    });

  // --- the internal output column with ±Vsat rails -----------------------------
  g.moveTo(colX, colT).lineTo(colX, colB).stroke({ width: 2, color: 0x3b3560 });
  // rail caps: glow on the rail the output is pinned to.
  const railHiA = sat && swingC > 0 ? 0.9 : 0.32;
  const railLoA = sat && swingC < 0 ? 0.9 : 0.32;
  g.moveTo(colX - 9, colT)
    .lineTo(colX + 9, colT)
    .stroke({ width: 2, color: OUT, alpha: railHiA });
  g.moveTo(colX - 9, colB)
    .lineTo(colX + 9, colB)
    .stroke({ width: 2, color: OUT, alpha: railLoA });

  // --- the output puck: rides the column toward the winning input, pins to rail -
  // y maps swing −1..+1 to colB..colT (output high = up = + wins, like the mockup).
  const puckY = colT + ((1 - swingC) / 2) * (colB - colT);
  const mag = Math.abs(swingC);
  // connector from the puck to the apex (the output tap).
  g.moveTo(colX, puckY)
    .lineTo(apexX, 0)
    .stroke({ width: 2, color: OUT, alpha: 0.45 });
  g.circle(colX, puckY, 11 + 2 * mag).stroke({
    width: 1.5,
    color: OUT,
    alpha: 0.25 + 0.4 * mag,
  });
  g.circle(colX, puckY, 7 + 2 * mag).fill({ color: OUT, alpha: 0.85 });

  // --- output spur + stud, and the FAT output belt (width + density ~ |Iout|) --
  g.moveTo(apexX, 0)
    .lineTo(outX, 0)
    .stroke({ width: 2, color: RAIL, alpha: 0.85 });
  stud(g, outX, 0, OUT);
  const beltW = 2 + 8 * drive;
  if (drive > 0.02) {
    g.roundRect(apexX, -beltW / 2, outX - apexX, beltW, 2).fill({
      color: OUT,
      alpha: 0.18 + 0.28 * drive,
    });
  }

  // --- the live belts: inputs sense (sparse/bright by who's winning), output drives
  belt(g, inX, inPy, capL, inPy, iPos, 1, o.phase, POS, 2.6);
  belt(g, inX, inMy, capL, inMy, iNeg, 1, o.phase, NEG, 2.6);
  belt(g, apexX, 0, outX, 0, drive, driveDir, o.phase, OUT, 3.2);
}

// ============================================================================
// Diode — ported from a0e2e2c0-diodefactory.html: a one-way valve. The bus runs
// in on the anode (left) and out the cathode (right); the gate at the cathode bar
// OPENS (green) when forward-biased past the knee and current streams through,
// SHUTS (bronze) when blocking, and FAILS (red, smoking) in reverse breakdown.
//
// Live mapping (diode ElectricalState: current a→b = anode→cathode, vAcross =
// V(anode)−V(cathode)):
//   • forward conduction = norm(max(0, current))  → gate opens green, body glows,
//     warm packets stream anode→cathode.
//   • reverse breakdown  = norm(max(0, -current)) → gate fails red, smoke rises,
//     packets run backward.
//   • blocking (tiny |I|) → gate shut, packets stall against it.
//   • bias colour: anode bus cyan / cathode bus violet when forward; swapped in
//     reverse — the polarity read.
// ============================================================================
function drawDetailDiode(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const POS = PALETTE.pos; // forward / high-side bus tint
  const LOW = PALETTE.violet; // low-side bus tint
  const BRONZE = PALETTE.bronze;
  const GREEN = PALETTE.ok;
  const RED = PALETTE.bad;
  const isLED = o.kind === "LED";
  const emitCol = isLED ? o.color : BRONZE;

  const busY = 0;
  const aX = -hw + 8; // anode stud
  const kX = hw - 8; // cathode stud
  const boxL = -hw * 0.34;
  const boxR = hw * 0.34;
  const boxT = -hh * 0.62;
  const boxB = hh * 0.62;
  const triL = boxL + 8;
  const triR = boxR - 14;
  const gateX = boxR - 8; // cathode bar (the gate)

  const fwd = norm(Math.max(0, o.electrical.current), CUR_SCALE);
  const rev = norm(Math.max(0, -o.electrical.current), CUR_SCALE);
  const conducting = fwd > 0.03;
  const breakdown = rev > 0.03;
  const forwardBias = o.electrical.vAcross >= 0;

  // --- breakdown / emission halo behind the body -------------------------------
  if (breakdown) {
    const breathe = 0.8 + 0.2 * Math.sin(o.phase * PULSE_K);
    g.circle((boxL + boxR) / 2, busY, hh * 0.95).fill({
      color: RED,
      alpha: (0.18 + 0.4 * rev) * breathe,
    });
  } else if (conducting && isLED) {
    // The LED lamp: it visibly lights, the most rewarding detail to ship.
    const breathe = 0.82 + 0.18 * Math.sin(o.phase * PULSE_K);
    g.circle((boxL + boxR) / 2, busY, hh * 1.05).fill({
      color: o.color,
      alpha: 0.22 * fwd * breathe,
    });
    g.circle((boxL + boxR) / 2, busY, hh * 0.6).fill({
      color: o.color,
      alpha: 0.3 * fwd * breathe,
    });
  } else if (conducting) {
    g.circle((boxL + boxR) / 2, busY, hh * 0.7).fill({
      color: emitCol,
      alpha: 0.14 * fwd,
    });
  }

  // --- the two bus segments, recoloured by bias --------------------------------
  const leftCol = forwardBias ? POS : LOW;
  const rightCol = forwardBias ? LOW : POS;
  g.moveTo(aX, busY)
    .lineTo(boxL, busY)
    .stroke({ width: 6, color: leftCol, alpha: 0.85 });
  g.moveTo(boxR, busY)
    .lineTo(kX, busY)
    .stroke({ width: 6, color: rightCol, alpha: 0.85 });

  // --- the bronze epoxy body ---------------------------------------------------
  housing(g, boxL, boxT, boxR - boxL, boxB - boxT, BRONZE, 10);

  // --- the triangle (anode →) inside, glowing with forward current -------------
  const triPts = [triL, busY - hh * 0.34, triL, busY + hh * 0.34, triR, busY];
  g.poly(triPts).fill({ color: 0x2a1d12, alpha: 0.95 });
  if (conducting) {
    g.poly(triPts).fill({ color: emitCol, alpha: 0.22 + 0.5 * fwd });
  } else if (breakdown) {
    g.poly(triPts).fill({ color: RED, alpha: 0.3 + 0.45 * rev });
  }
  g.poly(triPts).stroke({ width: 2, color: BRONZE, alpha: 0.95 });

  // --- the cathode bar = the gate: green open / bronze shut / red failed --------
  const gateCol = conducting ? GREEN : breakdown ? RED : BRONZE;
  const gateGlow = conducting
    ? 0.4 + 0.45 * fwd
    : breakdown
      ? 0.5 + 0.4 * rev
      : 0;
  if (gateGlow > 0) {
    g.moveTo(gateX, busY - hh * 0.42)
      .lineTo(gateX, busY + hh * 0.42)
      .stroke({ width: 7, color: gateCol, alpha: gateGlow });
  }
  g.moveTo(gateX, busY - hh * 0.42)
    .lineTo(gateX, busY + hh * 0.42)
    .stroke({ width: 3.5, color: gateCol, alpha: 0.95 });

  // --- anode / cathode studs ---------------------------------------------------
  stud(g, aX, busY, BRONZE);
  stud(g, kX, busY, BRONZE);

  // --- smoke on breakdown (the "ordinary diode is destroyed" cue) --------------
  if (breakdown) {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = (((i / n + o.phase * 0.4) % 1) + 1) % 1;
      const sx =
        (boxL + boxR) / 2 + Math.sin(o.phase * 2 + i * 7) * hw * 0.12 * t;
      const sy = boxT - t * hh * 0.9;
      g.circle(sx, sy, 3 + 7 * t).fill({
        color: PALETTE.dim,
        alpha: 0.4 * rev * (1 - t),
      });
    }
  }

  // --- the current packets along the bus ---------------------------------------
  // Forward: anode→cathode. Reverse breakdown: cathode→anode. Blocking: a sparse
  // trickle that stalls AT the gate (it can't pass), on the biased side.
  if (conducting) {
    belt(
      g,
      aX,
      busY,
      kX,
      busY,
      fwd,
      1,
      o.phase,
      mix(emitCol, 0xffffff, 0.3),
      2.8,
    );
  } else if (breakdown) {
    belt(g, aX, busY, kX, busY, rev, -1, o.phase, RED, 2.8);
  } else {
    // blocked: packets crawl up to the gate from the biased side and stop.
    const fromX = forwardBias ? aX : kX;
    const toX = gateX;
    const n = 3;
    for (let i = 0; i < n; i++) {
      const t = (((i / n + o.phase * FLOW_SPEED) % 1) + 1) % 1;
      g.circle(fromX + (toX - fromX) * t, busY, 2.2).fill({
        color: PALETTE.dim,
        alpha: 0.32 * (1 - t),
      });
    }
  }
}

// ============================================================================
// Resistor — ported from 167fafa7-resistorfactory.html: current passes straight
// through at the SAME rate both sides (a resistor impedes, it doesn't consume),
// while the POTENTIAL drops across it (bus cyan-high in → violet-low out) and the
// lost energy leaves as HEAT — the body glows hotter, then shimmers, then smokes
// the harder it's pushed (P = I²R = V·I).
//
// Live mapping (resistor ElectricalState: current a→b, vAcross = V(a)−V(b)):
//   • current   = norm(current)  → warm packets, same rate + brightness both ends.
//   • heat/power= a power proxy norm(|V·I|) → the body's heat colour + halo +
//     shimmer + (over-driven) smoke. Magnitude rides colour/alpha, never speed.
//   • the bus tints high (cyan) on the high-potential end, low (violet) on the
//     low — the IR-drop read, oriented by the sign of vAcross.
// ============================================================================
function drawDetailResistor(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const HI = PALETTE.pos; // high-potential bus tint (cyan)
  const LOW = PALETTE.violet; // low-potential bus tint (violet)
  const BRONZE = PALETTE.bronze;
  const CUR = mix(BRONZE, 0xffffff, 0.55); // warm current packets
  const HOT = PALETTE.bad; // heat colour ceiling

  const busY = 0;
  const aX = -hw + 8;
  const bX = hw - 8;
  const boxL = -hw * 0.34;
  const boxR = hw * 0.34;
  const boxT = -hh * 0.62;
  const boxB = hh * 0.62;

  const cur = norm(o.electrical.current, CUR_SCALE);
  // Power proxy: |V·I| normalised on V_SCALE·CUR_SCALE so a hard-pushed resistor
  // (volts AND tens of mA) reads near full heat. Calm, qualitative — not calibrated.
  const power = norm(
    Math.abs(o.electrical.vAcross * o.electrical.current),
    V_SCALE * CUR_SCALE,
  );
  const hot = power; // 0..1 heat fraction
  const heatCol = mix(BRONZE, HOT, hot);
  // Orient the IR drop: the higher-potential terminal end runs cyan, the lower violet.
  const aHigh = o.electrical.vAcross >= 0;
  const dir = aHigh ? 1 : -1; // packet travel follows conventional current a→b sign
  const leftCol = aHigh ? HI : LOW;
  const rightCol = aHigh ? LOW : HI;

  // --- heat halo behind the body -----------------------------------------------
  if (hot > 0.04) {
    const r = hh * (0.9 + 0.5 * hot);
    g.circle((boxL + boxR) / 2, busY, r).fill({
      color: heatCol,
      alpha: Math.min(0.45, 0.5 * hot),
    });
  }

  // --- the bus: high-potential in, low-potential out ---------------------------
  g.moveTo(aX, busY)
    .lineTo(boxL, busY)
    .stroke({ width: 6, color: leftCol, alpha: 0.85 });
  g.moveTo(boxR, busY)
    .lineTo(bX, busY)
    .stroke({ width: 6, color: rightCol, alpha: 0.85 });

  // --- the ceramic body, heating with power ------------------------------------
  housing(g, boxL, boxT, boxR - boxL, boxB - boxT, BRONZE, 10);
  if (hot > 0.02) {
    g.roundRect(boxL + 5, boxT + 5, boxR - boxL - 10, boxB - boxT - 10, 7).fill(
      {
        color: heatCol,
        alpha: Math.min(0.7, 0.6 * hot),
      },
    );
  }
  // the resistive element: a colour-band rod with a hot core through the cutaway.
  const rodT = busY - hh * 0.16;
  const rodB = busY + hh * 0.16;
  g.roundRect(boxL + 8, rodT, boxR - boxL - 16, rodB - rodT, 3).fill({
    color: 0x2a1d12,
    alpha: 0.95,
  });
  // four colour bands (purely decorative "read the value" teach — token-coloured).
  const bands = [PALETTE.warn, PALETTE.bad, PALETTE.violet, PALETTE.bronze];
  const span = boxR - boxL - 28;
  for (let i = 0; i < bands.length; i++) {
    const bx = boxL + 16 + (span * (i + 0.5)) / bands.length;
    g.roundRect(bx - 2, rodT + 1, 3.5, rodB - rodT - 2, 1).fill({
      color: bands[i]!,
      alpha: 0.92,
    });
  }
  // the hot core glow at the element centre.
  if (hot > 0.02) {
    g.circle((boxL + boxR) / 2, busY, hh * (0.18 + 0.18 * hot)).fill({
      color: heatCol,
      alpha: Math.min(0.95, 0.3 + 0.6 * hot),
    });
  }

  // --- heat shimmer rising off the body (appears once warm) --------------------
  if (hot > 0.2) {
    const amp = 2 + 5 * hot;
    for (let s = -1; s <= 1; s++) {
      const sx = (boxL + boxR) / 2 + s * (boxR - boxL) * 0.22;
      g.moveTo(sx, boxT);
      for (let k = 1; k <= 4; k++) {
        const yy = boxT - k * hh * 0.2;
        const xx = sx + Math.sin(o.phase * 4 + s * 1.3 + k * 0.9) * amp;
        g.lineTo(xx, yy);
      }
      g.stroke({ width: 2, color: heatCol, alpha: Math.min(0.6, 0.4 * hot) });
    }
  }
  // --- smoke when over-driven (past the rating) --------------------------------
  if (hot > 0.85) {
    const over = (hot - 0.85) / 0.15;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = (((i / n + o.phase * 0.35) % 1) + 1) % 1;
      const sx =
        (boxL + boxR) / 2 + Math.sin(o.phase * 2 + i * 7) * hw * 0.12 * t;
      const sy = boxT - t * hh * 0.9;
      g.circle(sx, sy, 3 + 7 * t).fill({
        color: PALETTE.dim,
        alpha: 0.45 * over * (1 - t),
      });
    }
  }

  // --- terminal studs ----------------------------------------------------------
  stud(g, aX, busY, BRONZE);
  stud(g, bX, busY, BRONZE);

  // --- the current packets: SAME rate + brightness both sides (continuity) -----
  // Drawn with identical magnitude on both legs, so "current in == current out"
  // (a resistor impedes, it does not consume) reads straight off the matched belts.
  belt(g, aX, busY, boxL, busY, cur, dir, o.phase, CUR, 2.8);
  belt(g, boxR, busY, bX, busY, cur, dir, o.phase, CUR, 2.8);
}

/**
 * The construction-detail drawers, keyed by kind — the third sibling map to
 * DRAWERS / FACTORY_DRAWERS. A kind absent here has no detail view yet; the host
 * falls back to the schematic glyph (DETAIL ?? schematic), so nothing is blank.
 */
const DETAIL_DRAWERS: Record<string, (g: Graphics, o: DetailOpts) => void> = {
  OA: drawDetailOA,
  D: drawDetailDiode,
  SD: drawDetailDiode,
  LED: drawDetailDiode,
  ZD: drawDetailDiode,
  R: drawDetailResistor,
};

/** Whether a kind has a construction-detail (factory-internals) drawer. */
export function hasDetail(kind: string): boolean {
  return kind in DETAIL_DRAWERS;
}

/**
 * Draw a kind's construction-detail illustration into the (pre-cleared) Graphics,
 * animated from the live `electrical` + `phase`. Returns true if a detail drawer
 * exists for the kind (and ran); false if the caller should fall back to the
 * schematic glyph. Never touches the sim — pure presentation.
 */
export function drawDetail(g: Graphics, o: DetailOpts): boolean {
  const drawer = DETAIL_DRAWERS[o.kind];
  if (!drawer) return false;
  drawer(g, o);
  return true;
}

/** Re-exported for callers that want the zero state when nothing is selected. */
export { ZERO_ELECTRICAL };

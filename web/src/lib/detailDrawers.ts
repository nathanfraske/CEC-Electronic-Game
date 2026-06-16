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
import { ZERO_ELECTRICAL } from "./glyphs";
import {
  type TierOpts as DetailOpts,
  belt,
  dotPresence,
  housing,
  mix,
  norm,
  stud,
  CUR_SCALE,
  V_SCALE,
  OUT_SCALE,
  FLOW_SPEED,
  FLOW_DOTS_MAX,
  PULSE_K,
} from "./tierKit";

// The full-panel illustration primitives (TierOpts/TierBounds, the scales, and the
// belt/stud/housing/mix/norm/dotPresence helpers) live in ./tierKit, shared with
// the analogy tier. This module keeps only the reality-tier (device-internals)
// drawers below.

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
// Diode — ported from diode-factory.html: a PN-JUNCTION cutaway. The P side (holes)
// meets the N side (electrons) across a DEPLETION zone. Forward bias narrows the
// depletion and carriers pour across and RECOMBINE at the junction (an LED radiates
// that energy as light); reverse bias widens it and the flow stops (ordinary reverse
// breakdown forces a backward avalanche). A Schottky (SD) is a metal→N junction
// carried by electrons alone.
//
// Live mapping (diode ElectricalState: current a→b = anode→cathode, vAcross =
// V(anode)−V(cathode); the kind picks the junction type):
//   • forward = norm(max(0, I)) → carrier density across the junction + recombination
//     flashes (LED: photons leaving); the depletion narrows.
//   • reverse = norm(max(0,−I)) → depletion widens; breakdown drives a backward flow.
//   • bias    = sign(vAcross)   → which lead runs high + the depletion width.
// ============================================================================
function drawDetailDiode(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const isLED = o.kind === "LED";
  const isSchottky = o.kind === "SD";
  const ELEC = mix(PALETTE.cyan, 0xffffff, 0.3);
  const HOLE = mix(PALETTE.bad, PALETTE.warn, 0.4);

  const fwd = norm(Math.max(0, o.electrical.current), CUR_SCALE);
  const rev = norm(Math.max(0, -o.electrical.current), CUR_SCALE);
  const conducting = fwd > 0.03;
  const breakdown = rev > 0.03;
  const forwardBias = o.electrical.vAcross >= 0;

  const busY = 0;
  const aX = -hw + 8;
  const kX = hw - 8;
  const boxL = -hw * 0.58;
  const boxR = hw * 0.58;
  const boxT = -hh * 0.58;
  const boxB = hh * 0.58;
  const xJ = 0; // the junction, centre
  // depletion half-width: narrow under forward bias, wide under reverse
  const biasN = Math.max(-1, Math.min(1, o.electrical.vAcross / 2));
  const depHW = (boxR - boxL) * (0.13 - 0.1 * biasN) * 0.5;
  const laneSpan = (boxB - boxT) * 0.42;

  // --- emission / breakdown halo behind the body -------------------------------
  if (conducting && isLED) {
    const breathe = 0.82 + 0.18 * Math.sin(o.phase * PULSE_K);
    g.circle(xJ, busY, Math.min(hh * 0.95, hh * (0.7 + 0.4 * fwd))).fill({
      color: o.color,
      alpha: 0.24 * fwd * breathe,
    });
  } else if (breakdown) {
    const breathe = 0.8 + 0.2 * Math.sin(o.phase * PULSE_K);
    g.circle(xJ, busY, hh * 0.85).fill({
      color: PALETTE.bad,
      alpha: (0.16 + 0.4 * rev) * breathe,
    });
  }

  // --- the silicon body, split P | depletion | N -------------------------------
  housing(g, boxL, boxT, boxR - boxL, boxB - boxT, PALETTE.bronze, 8);
  const pCol = isSchottky ? PALETTE.dim : HOLE; // P side (metal for Schottky)
  g.rect(boxL + 2, boxT + 2, xJ - depHW - boxL - 2, boxB - boxT - 4).fill({
    color: pCol,
    alpha: 0.16,
  });
  g.rect(xJ + depHW, boxT + 2, boxR - 2 - (xJ + depHW), boxB - boxT - 4).fill({
    color: PALETTE.cyan,
    alpha: 0.12,
  });
  g.rect(xJ - depHW, boxT + 2, depHW * 2, boxB - boxT - 4).fill({
    color: 0x0e1018,
    alpha: 0.6,
  });
  for (const ex of [xJ - depHW, xJ + depHW]) {
    g.moveTo(ex, boxT + 2)
      .lineTo(ex, boxB - 2)
      .stroke({ width: 1, color: PALETTE.rail, alpha: 0.5 });
  }

  // --- leads, recoloured by bias -----------------------------------------------
  const leftCol = forwardBias ? PALETTE.pos : PALETTE.violet;
  const rightCol = forwardBias ? PALETTE.violet : PALETTE.pos;
  g.moveTo(aX, busY)
    .lineTo(boxL, busY)
    .stroke({ width: 6, color: leftCol, alpha: 0.85 });
  g.moveTo(boxR, busY)
    .lineTo(kX, busY)
    .stroke({ width: 6, color: rightCol, alpha: 0.85 });

  // --- carriers: holes (P→junction) + electrons (N→junction), recombining ------
  const lanes = [-0.5, 0, 0.5];
  if (conducting) {
    for (const lane of lanes) {
      const ly = busY + lane * laneSpan;
      if (!isSchottky) {
        belt(g, boxL + 6, ly, xJ - depHW, ly, fwd, 1, o.phase, HOLE, 2.6);
      }
      belt(g, boxR - 6, ly, xJ + depHW, ly, fwd, 1, o.phase, ELEC, 2.6);
    }
    // recombination flashes at the junction (LED: photons leave the body)
    const nF = 3;
    for (let k = 0; k < nF; k++) {
      const t = (((k / nF + o.phase * 0.6) % 1) + 1) % 1;
      const fy = busY + (((k * 0.37) % 1) - 0.5) * (boxB - boxT) * 0.7;
      const a = (1 - t) * fwd;
      g.circle(xJ, fy, 2 + 5 * t).fill({
        color: isLED ? o.color : 0xffffff,
        alpha: 0.7 * a,
      });
      if (isLED) {
        g.circle(
          xJ + Math.cos(k * 2) * t * hw * 0.5,
          fy - t * hh * 0.7,
          2,
        ).fill({
          color: o.color,
          alpha: 0.7 * a,
        });
      }
    }
  } else if (breakdown) {
    for (const lane of lanes) {
      const ly = busY + lane * laneSpan;
      belt(g, boxR - 6, ly, boxL + 6, ly, rev, 1, o.phase, PALETTE.bad, 2.6);
    }
  } else {
    // blocked: carriers sit back in their regions (a faint, static fill)
    for (const lane of lanes) {
      const ly = busY + lane * laneSpan;
      g.circle(boxL + (xJ - depHW - boxL) * 0.4, ly, 2).fill({
        color: pCol,
        alpha: 0.4,
      });
      g.circle(boxR - (boxR - (xJ + depHW)) * 0.4, ly, 2).fill({
        color: ELEC,
        alpha: 0.4,
      });
    }
  }

  // --- lead current + studs ----------------------------------------------------
  if (conducting) {
    belt(
      g,
      aX,
      busY,
      boxL,
      busY,
      fwd,
      1,
      o.phase,
      mix(ELEC, 0xffffff, 0.2),
      2.6,
    );
  } else if (breakdown) {
    belt(g, kX, busY, boxR, busY, rev, 1, o.phase, PALETTE.bad, 2.6);
  }
  stud(g, aX, busY, PALETTE.bronze);
  stud(g, kX, busY, PALETTE.bronze);
}

// ============================================================================
// Resistor — ported from resistor-tiers.html tier 3: a CONDUCTOR LATTICE with
// DRIFTING ELECTRONS. Fixed + ion cores form a lattice; the field pushes electrons
// through it and they keep SCATTERING off the (thermally jiggling) ions — that
// resistance dissipates the energy as HEAT (the lattice glows, then smokes when
// over-driven). The field points + → −; electrons drift toward +.
//
// Live mapping (resistor ElectricalState: current a→b, vAcross = V(a)−V(b)):
//   • current = norm(|I|)   → electron density/alpha drifting through the lattice.
//   • heat    = norm(|V·I|)  → ion glow + jiggle + heat halo + (over-driven) smoke.
//   • field   = norm(|V|)    → the E-field lines; sign of vAcross sets the drift and
//     which lead runs high (cyan) vs low (violet) — the IR-drop read.
// ============================================================================
function drawDetailResistor(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const ELEC = mix(PALETTE.cyan, 0xffffff, 0.3);
  const ION = PALETTE.bronze;

  const cur = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1; // conventional current a→b
  const power = norm(
    Math.abs(o.electrical.vAcross * o.electrical.current),
    V_SCALE * CUR_SCALE,
  );
  const vfield = norm(o.electrical.vAcross, V_SCALE);
  const aHigh = o.electrical.vAcross >= 0;
  const heatCol = mix(PALETTE.warn, PALETTE.bad, power);

  const busY = 0;
  const aX = -hw + 8;
  const bX = hw - 8;
  const boxL = -hw * 0.62;
  const boxR = hw * 0.62;
  const boxT = -hh * 0.56;
  const boxB = hh * 0.56;
  const inL = boxL + 10;
  const inR = boxR - 10;
  const inT = boxT + 8;
  const inB = boxB - 8;

  // --- heat halo behind the lattice --------------------------------------------
  if (power > 0.04) {
    g.roundRect(
      boxL - 6,
      boxT - 6,
      boxR - boxL + 12,
      boxB - boxT + 12,
      10,
    ).fill({
      color: heatCol,
      alpha: Math.min(0.4, 0.5 * power),
    });
  }

  // --- the conductor body + leads (high-potential in cyan, low out violet) -----
  housing(g, boxL, boxT, boxR - boxL, boxB - boxT, PALETTE.dim, 6);
  const leftCol = aHigh ? PALETTE.pos : PALETTE.violet;
  const rightCol = aHigh ? PALETTE.violet : PALETTE.pos;
  g.moveTo(aX, busY)
    .lineTo(boxL, busY)
    .stroke({ width: 6, color: leftCol, alpha: 0.85 });
  g.moveTo(boxR, busY)
    .lineTo(bX, busY)
    .stroke({ width: 6, color: rightCol, alpha: 0.85 });

  // --- E-field lines through the lattice (+ → −) -------------------------------
  if (vfield > 0.04) {
    const frows = 3;
    const segs = 7;
    for (let r = 0; r < frows; r++) {
      const fy = inT + ((r + 0.5) / frows) * (inB - inT);
      for (let s = 0; s < segs; s++) {
        const sx = inL + ((s + 0.2) / segs) * (inR - inL);
        g.moveTo(sx, fy).lineTo(sx + (inR - inL) / segs / 2, fy);
      }
    }
    g.stroke({ width: 1, color: PALETTE.violet, alpha: 0.1 + 0.4 * vfield });
  }

  // --- the lattice of thermally jiggling + ions --------------------------------
  const cols = 6;
  const rows = 3;
  const jig = 1 + power * 2.5;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const bx = inL + ((c + 0.5) / cols) * (inR - inL);
      const by = inT + ((r + 0.5) / rows) * (inB - inT);
      const ph = c * 1.7 + r * 2.3;
      const ix = bx + Math.sin(o.phase * 0.9 + ph) * jig;
      const iy = by + Math.cos(o.phase * 1.1 + ph) * jig;
      if (power > 0.03) {
        g.circle(ix, iy, 7 + power * 4).fill({
          color: heatCol,
          alpha: 0.12 + 0.35 * power,
        });
      }
      g.circle(ix, iy, 4).fill({ color: 0x231a0e });
      g.circle(ix, iy, 4).stroke({ width: 1.4, color: ION, alpha: 0.9 });
      g.moveTo(ix - 2, iy)
        .lineTo(ix + 2, iy)
        .moveTo(ix, iy - 2)
        .lineTo(ix, iy + 2)
        .stroke({ width: 1, color: mix(ION, 0xffffff, 0.4), alpha: 0.8 });
    }
  }

  // --- drifting electrons: through the lattice, toward + (against current) ------
  if (cur > 0.02) {
    const lanes = [-0.66, 0, 0.66];
    const eDir = -dir; // electrons drift opposite to conventional current
    const n = FLOW_DOTS_MAX;
    for (const lane of lanes) {
      const ly = busY + lane * (inB - inT) * 0.5;
      for (let k = 0; k < n; k++) {
        const present = dotPresence(k, cur);
        if (present <= 0) continue;
        const t = (((k / n + o.phase * FLOW_SPEED * eDir) % 1) + 1) % 1;
        const x = inL + t * (inR - inL);
        const y =
          ly + Math.sin(o.phase * 3 + k * 2 + lane * 4) * (2 + power * 3);
        g.circle(x, y, 2.6).fill({
          color: ELEC,
          alpha: (0.3 + 0.55 * cur) * present,
        });
      }
    }
  }

  // --- smoke when over-driven (past the rating) --------------------------------
  if (power > 0.85) {
    const over = (power - 0.85) / 0.15;
    for (let i = 0; i < 5; i++) {
      const t = (((i / 5 + o.phase * 0.35) % 1) + 1) % 1;
      const sx =
        (boxL + boxR) / 2 + Math.sin(o.phase * 2 + i * 7) * hw * 0.12 * t;
      const sy = boxT - t * hh * 0.9;
      g.circle(sx, sy, 3 + 7 * t).fill({
        color: PALETTE.dim,
        alpha: 0.45 * over * (1 - t),
      });
    }
  }

  // --- terminal studs + lead current -------------------------------------------
  stud(g, aX, busY, PALETTE.bronze);
  stud(g, bX, busY, PALETTE.bronze);
  belt(
    g,
    aX,
    busY,
    boxL,
    busY,
    cur,
    dir,
    o.phase,
    mix(ELEC, 0xffffff, 0.2),
    2.6,
  );
  belt(
    g,
    boxR,
    busY,
    bX,
    busY,
    cur,
    dir,
    o.phase,
    mix(ELEC, 0xffffff, 0.2),
    2.6,
  );
}

// ============================================================================
// Inductor — ported from inductor-tiers.html (tier 3, the air-core solenoid). The
// current spiralling through the turns builds a magnetic field that loops through
// the core and back around, and that field is where the energy is held. The coil
// only shows a voltage while the current is CHANGING (V = L·dI/dt), so V_L drives a
// "dI/dt" shimmer on the core while |I| drives the field, the flux, and the flow.
//
// Live mapping (the inductor ElectricalState carries I (a→b) and V_L = V(a)−V(b)):
//   • field / energy = norm(|I|, CUR_SCALE) → flux-loop brightness + core flux dots.
//   • flow / spiral  = same; sign of I sets the belt + spiral direction.
//   • "changing"     = norm(|V_L|, V_SCALE) → the dI/dt shimmer rising off the core.
// ============================================================================
function drawDetailInductor(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const BRONZE = PALETTE.bronze;
  const LEAD = PALETTE.violet;
  const FIELD = PALETTE.cyan;
  const FLUX = mix(PALETTE.cyan, 0xffffff, 0.4);
  const CUR = mix(BRONZE, 0xffffff, 0.55);

  const i = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1;
  const changing = norm(o.electrical.vAcross, V_SCALE);

  const axisY = 0;
  const coilL = -hw * 0.46;
  const coilR = hw * 0.46;
  const ry = hh * 0.5;
  const rx = 9;
  // More turns links more field per amp — so more inductance shows as more turns.
  const turns = o.value
    ? Math.max(5, Math.min(9, Math.round(5 + 4 * norm(o.value, 0.2))))
    : 7;

  // --- magnetic field loops behind the coil, blooming with |I| ------------------
  if (i > 0.03) {
    const loops = [
      { h: hh * 1.0, ext: hw * 0.12 },
      { h: hh * 1.7, ext: hw * 0.26 },
    ];
    for (const lp of loops) {
      for (const s of [-1, 1]) {
        g.moveTo(coilL, axisY)
          .bezierCurveTo(
            coilL - lp.ext,
            axisY + s * lp.h,
            coilR + lp.ext,
            axisY + s * lp.h,
            coilR,
            axisY,
          )
          .stroke({
            width: 1.4,
            color: FIELD,
            alpha: Math.min(0.5, 0.08 + i * 0.4),
          });
      }
    }
    // flux dots running the core axis (the field through the centre). Fixed slots,
    // faded by |I| — so a changing inductor current doesn't flip the count + jitter.
    const nf = FLOW_DOTS_MAX;
    for (let k = 0; k < nf; k++) {
      const present = dotPresence(k, i);
      if (present <= 0) continue;
      const t = (((k / nf + o.phase * FLOW_SPEED * dir) % 1) + 1) % 1;
      g.circle(coilL + (coilR - coilL) * t, axisY, 2.4).fill({
        color: FLUX,
        alpha: (0.3 + 0.5 * i) * present,
      });
    }
    // axis arrow — the field direction through the core
    const ax = (coilL + coilR) / 2 + dir * hw * 0.08;
    g.moveTo(ax - dir * 7, axisY - 5)
      .lineTo(ax + dir * 7, axisY)
      .lineTo(ax - dir * 7, axisY + 5)
      .fill({ color: FIELD, alpha: 0.3 + 0.6 * i });
  }

  // --- leads + terminal studs ---------------------------------------------------
  const aX = -hw + 8;
  const bX = hw - 8;
  g.moveTo(aX, axisY)
    .lineTo(coilL, axisY)
    .stroke({ width: 4, color: LEAD, alpha: 0.85 });
  g.moveTo(coilR, axisY)
    .lineTo(bX, axisY)
    .stroke({ width: 4, color: LEAD, alpha: 0.85 });
  stud(g, aX, axisY, BRONZE);
  stud(g, bX, axisY, BRONZE);

  // --- the coil: N turns as ellipses --------------------------------------------
  for (let k = 0; k < turns; k++) {
    const x = coilL + (turns === 1 ? 0.5 : k / (turns - 1)) * (coilR - coilL);
    g.ellipse(x, axisY, rx, ry).stroke({
      width: 3.2,
      color: BRONZE,
      alpha: 0.92,
    });
  }

  // --- dI/dt shimmer rising off the core while the current changes --------------
  if (changing > 0.06) {
    const amp = 2 + 5 * changing;
    for (let s = -1; s <= 1; s += 2) {
      const sx = (coilL + coilR) / 2 + s * (coilR - coilL) * 0.18;
      g.moveTo(sx, axisY - ry);
      for (let k = 1; k <= 4; k++) {
        const xx = sx + Math.sin(o.phase * 4 + s * 1.3 + k * 0.9) * amp;
        g.lineTo(xx, axisY - ry - k * hh * 0.18);
      }
      g.stroke({
        width: 1.8,
        color: FLUX,
        alpha: Math.min(0.6, 0.5 * changing),
      });
    }
  }

  // --- electrons spiralling through the turns (front bright, back dim) ----------
  // Fixed slot count so the spiral never re-spaces when |I| wiggles; the trailing
  // electrons fade in with current instead of popping in and shifting the rest.
  if (i > 0.02) {
    const ne = FLOW_DOTS_MAX + 2;
    for (let k = 0; k < ne; k++) {
      const present = dotPresence(k, i, ne);
      if (present <= 0) continue;
      const t = (((k / ne + o.phase * FLOW_SPEED * dir) % 1) + 1) % 1;
      const theta = t * turns * Math.PI * 2;
      const front = Math.sin(theta) > 0;
      g.circle(
        coilL + t * (coilR - coilL),
        axisY - ry * Math.cos(theta),
        2.6,
      ).fill({
        color: FIELD,
        alpha: (front ? 0.9 : 0.32) * (0.4 + 0.6 * i) * present,
      });
    }
  }

  // --- electron flow on the leads (same magnitude both sides) -------------------
  belt(g, aX, axisY, coilL, axisY, i, dir, o.phase, CUR, 2.4);
  belt(g, coilR, axisY, bX, axisY, i, dir, o.phase, CUR, 2.4);
}

// ============================================================================
// Ceramic capacitor (MLCC) — ported from capacitor-ceramic-tiers.html tier 3: a
// cutaway of the multilayer chip. Interleaved metal electrodes wire alternately to
// the + and − leads; between them the ceramic dielectric POLARISES — its dipoles
// swing into line with the field as the voltage rises. Electrons pile onto the
// plates wired to − and drain off those wired to +, but NONE cross the ceramic
// (which is what storing charge physically is). A wider chip is more capacitance.
//
// Live mapping (cap ElectricalState: current a→b, vAcross = Vc; value = C):
//   • charge      = norm(|Vc|) → plate +/electron marks, dipole alignment, field, halo.
//   • flow        = norm(|I|)  → electrons streaming along the leads; sign sets dir.
//   • capacitance = value      → chip width (plate area).
// ============================================================================
function drawDetailCeramicCap(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const POS = PALETTE.pos;
  const LOW = PALETTE.violet;
  const ELEC = mix(PALETTE.cyan, 0xffffff, 0.3);
  const METAL = mix(PALETTE.dim, 0xffffff, 0.45);

  const vFrac = norm(o.electrical.vAcross, V_SCALE);
  const flow = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1;
  const vHigh = o.electrical.vAcross >= 0; // terminal a is the + side

  const half = hw * (0.32 + 0.18 * (o.value ? norm(o.value, 5e-6) : 0.5));
  const x0 = -half;
  const x1 = half;
  const blockT = -hh * 0.62;
  const blockB = hh * 0.62;
  const aX = -hw + 8;
  const bX = hw - 8;
  const lBus = x0 + 16;
  const rBus = x1 - 16;
  const gap = (x1 - x0) * 0.18;
  const leftCol = vHigh ? POS : LOW;
  const rightCol = vHigh ? LOW : POS;

  // --- field halo + chip body --------------------------------------------------
  if (vFrac > 0.03) {
    g.roundRect(
      x0 - 6,
      blockT - 6,
      2 * half + 12,
      blockB - blockT + 12,
      12,
    ).fill({ color: POS, alpha: 0.05 + 0.22 * vFrac });
  }
  housing(g, x0, blockT, 2 * half, blockB - blockT, PALETTE.dim, 10);

  // --- leads + the two end-cap buses -------------------------------------------
  g.moveTo(aX, 0)
    .lineTo(lBus, 0)
    .stroke({ width: 4, color: leftCol, alpha: 0.85 });
  g.moveTo(rBus, 0)
    .lineTo(bX, 0)
    .stroke({ width: 4, color: rightCol, alpha: 0.85 });
  g.moveTo(lBus, blockT + 10)
    .lineTo(lBus, blockB - 10)
    .stroke({ width: 4, color: leftCol, alpha: 0.85 });
  g.moveTo(rBus, blockT + 10)
    .lineTo(rBus, blockB - 10)
    .stroke({ width: 4, color: rightCol, alpha: 0.85 });

  // --- interleaved electrode plates + their charge marks + the dielectric -------
  const nPlates = 5;
  const mL = lBus + gap + 6;
  const mR = rBus - gap - 6;
  for (let p = 0; p < nPlates; p++) {
    const py = blockT + ((blockB - blockT) * (p + 0.5)) / nPlates;
    const leftConn = p % 2 === 0;
    const px0 = leftConn ? lBus : lBus + gap;
    const px1 = leftConn ? rBus - gap : rBus;
    g.moveTo(px0, py)
      .lineTo(px1, py)
      .stroke({ width: 5, color: METAL, alpha: 0.92 });
    // the plate's charge: + when wired to the high terminal, electrons when low.
    const positive = leftConn === vHigh;
    const marks = 4;
    for (let j = 0; j < marks; j++) {
      const mx = mL + ((j + 0.5) / marks) * (mR - mL);
      const a = Math.min(1, Math.max(0, (vFrac - j * 0.04) * 1.2));
      if (a <= 0.02) continue;
      if (positive) {
        g.moveTo(mx - 3, py).lineTo(mx + 3, py);
        g.moveTo(mx, py - 3).lineTo(mx, py + 3);
        g.stroke({ width: 1.5, color: POS, alpha: a });
      } else {
        g.circle(mx, py, 2.6).fill({ color: ELEC, alpha: a });
      }
    }
    // the ceramic dielectric between this plate and the next: dipoles that swing
    // into line with the field as Vc rises, + faint field-line dashes.
    if (p < nPlates - 1) {
      const ymid = py + (blockB - blockT) / nPlates / 2;
      for (let d = 0; d < 4; d++) {
        const dx = mL + ((d + 0.5) / 4) * (mR - mL);
        const base = ((d * 53 + p * 29) % 180) - 90; // scattered when uncharged
        const ang = (base * (1 - vFrac) * Math.PI) / 180; // → 0 (aligned) as Vc↑
        const ca = Math.cos(ang + Math.PI / 2);
        const sa = Math.sin(ang + Math.PI / 2);
        const len = (blockB - blockT) / nPlates / 2 - 4;
        g.moveTo(dx - ca * len, ymid - sa * len)
          .lineTo(dx + ca * len, ymid + sa * len)
          .stroke({
            width: 1.8,
            color: PALETTE.dim,
            alpha: 0.35 + 0.4 * vFrac,
          });
        g.circle(dx + ca * len, ymid + sa * len, 1.8).fill({
          color: POS,
          alpha: 0.4 + 0.5 * vFrac,
        });
      }
    }
  }

  // --- electrons along the leads (none cross the ceramic) ----------------------
  belt(g, aX, 0, lBus, 0, flow, dir, o.phase, ELEC, 2.4);
  belt(g, rBus, 0, bX, 0, flow, dir, o.phase, ELEC, 2.4);
  stud(g, aX, 0, PALETTE.bronze);
  stud(g, bX, 0, PALETTE.bronze);
}

// ============================================================================
// Aluminium electrolytic capacitor — ported from capacitor-electrolytic-tiers.html
// tier 3: a cutaway of the wound foil. An etched aluminium anode (its area sets the
// capacitance) carries a very thin OXIDE as the dielectric; a conductive electrolyte
// is the other plate, with a cathode foil collecting it. Electrons move in the metal
// while ions split in the electrolyte; the oxide is what makes it polarised. Nothing
// crosses the thin oxide.
//
// Live mapping (cap ElectricalState: current a→b, vAcross = Vc; value = C):
//   • charge      = norm(|Vc|) → anode + marks, oxide field, ions splitting, halo.
//   • flow        = norm(|I|)  → electrons along the leads; sign sets dir.
//   • capacitance = value      → the etched-anode tooth count (area).
// ============================================================================
function drawDetailElectrolyticCap(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const POS = PALETTE.pos;
  const LOW = PALETTE.violet;
  const ELEC = mix(PALETTE.cyan, 0xffffff, 0.3);
  const METAL = mix(PALETTE.dim, 0xffffff, 0.45);
  const OXIDE = mix(PALETTE.warn, 0xffffff, 0.35);
  const TEAL = mix(PALETTE.cyan, PALETTE.ok, 0.5);

  const vFrac = norm(o.electrical.vAcross, V_SCALE);
  const flow = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1;

  const y0 = -hh * 0.56;
  const y1 = hh * 0.56;
  const aX = -hw + 8;
  const bX = hw - 8;
  const anodeBackX = -hw * 0.62;
  const toothTipX = -hw * 0.06; // etched teeth reach toward the electrolyte
  const elecL = hw * 0.02;
  const elecR = hw * 0.5;
  const cathL = hw * 0.54;
  const cathR = hw * 0.66;
  // more capacitance = more etched teeth (area)
  const teeth = Math.max(
    3,
    Math.round(3 + 5 * (o.value ? norm(o.value, 5e-4) : 0.5)),
  );

  if (vFrac > 0.03) {
    g.roundRect(
      anodeBackX - 6,
      y0 - 6,
      cathR - anodeBackX + 12,
      y1 - y0 + 12,
      10,
    ).fill({ color: POS, alpha: 0.05 + 0.2 * vFrac });
  }

  // --- etched aluminium anode (comb of teeth) + its thin oxide skin -------------
  const anode: number[] = [anodeBackX, y0];
  const oxide: number[] = [];
  for (let i = 0; i <= 2 * teeth; i++) {
    const yy = y0 + (i * (y1 - y0)) / (2 * teeth);
    const xx = i % 2 === 0 ? toothTipX - 14 : toothTipX;
    anode.push(xx, yy);
    oxide.push(xx + 5, yy);
  }
  anode.push(anodeBackX, y1);
  g.poly(anode).fill({ color: METAL, alpha: 0.85 });
  g.poly(anode).stroke({ width: 1.5, color: METAL, alpha: 0.95 });
  g.poly(oxide, false).stroke({ width: 3, color: OXIDE, alpha: 0.9 });

  // --- electrolyte (ions) + the cathode foil -----------------------------------
  g.rect(elecL, y0, elecR - elecL, y1 - y0).fill({ color: TEAL, alpha: 0.12 });
  g.rect(elecL, y0, elecR - elecL, y1 - y0).stroke({
    width: 1,
    color: PALETTE.border,
    alpha: 0.7,
  });
  housing(g, cathL, y0, cathR - cathL, y1 - y0, PALETTE.dim, 4);

  // --- leads (+ anode / − cathode) ---------------------------------------------
  g.moveTo(aX, 0)
    .lineTo(anodeBackX, 0)
    .stroke({ width: 4, color: POS, alpha: 0.85 });
  g.moveTo(cathR, 0)
    .lineTo(bX, 0)
    .stroke({ width: 4, color: LOW, alpha: 0.85 });

  // --- anode + marks + oxide field lines, growing with charge ------------------
  for (let i = 0; i < teeth; i++) {
    const yy = y0 + ((i + 0.5) * (y1 - y0)) / teeth;
    const a = Math.min(1, vFrac * 1.15);
    if (a > 0.04) {
      g.moveTo(toothTipX - 22, yy).lineTo(toothTipX - 16, yy);
      g.moveTo(toothTipX - 19, yy - 3).lineTo(toothTipX - 19, yy + 3);
      g.stroke({ width: 1.5, color: POS, alpha: a });
      g.moveTo(toothTipX + 6, yy)
        .lineTo(elecL + 6, yy)
        .stroke({
          width: 1.4,
          color: POS,
          alpha: 0.08 + 0.5 * vFrac,
        });
    }
  }

  // --- ions in the electrolyte: split toward the plates as Vc rises -------------
  const nIons = 8;
  const ionSpanX = Math.max(0, elecR - elecL - 36);
  const ionSpanY = Math.max(0, y1 - y0 - 28);
  for (let i = 0; i < nIons; i++) {
    const neg = i % 2 === 0;
    const homeX = elecL + 18 + ionSpanX * ((i * 0.618) % 1);
    const homeY = y0 + 14 + ionSpanY * ((i * 0.382) % 1);
    const targetX = neg ? elecL + 14 : elecR - 14;
    const x =
      homeX + (targetX - homeX) * vFrac + Math.sin(o.phase * 0.4 + i) * 2;
    const y = homeY + Math.cos(o.phase * 0.35 + i) * 2;
    g.circle(x, y, 4.5).fill({ color: neg ? LOW : POS, alpha: 0.9 });
    if (neg) {
      g.moveTo(x - 2.2, y)
        .lineTo(x + 2.2, y)
        .stroke({ width: 1.2, color: 0x0c0e1a });
    } else {
      g.moveTo(x - 2.2, y).lineTo(x + 2.2, y);
      g.moveTo(x, y - 2.2).lineTo(x, y + 2.2);
      g.stroke({ width: 1.2, color: 0x0c0e1a });
    }
  }

  // --- electrons along the metal leads -----------------------------------------
  belt(g, aX, 0, anodeBackX, 0, flow, dir, o.phase, ELEC, 2.4);
  belt(g, cathR, 0, bX, 0, flow, dir, o.phase, ELEC, 2.4);
  stud(g, aX, 0, PALETTE.bronze);
  stud(g, bX, 0, PALETTE.bronze);
}

// ============================================================================
// Transformer — ported from transformer-tiers.html tier 3: two windings on a shared
// iron core. The primary current builds a changing FLUX that loops around the core
// and threads the secondary; that changing flux induces the secondary voltage. The
// turns ratio sets the voltage ratio (its inverse the current), and the coupling is
// magnetic only — which is why the two circuits stay isolated. (Saturation — the
// flux winding to the core limit and holding — belongs to the ideal-vs-real work.)
//
// Live mapping (transformer ElectricalState: primary current Ip, vAcross = Vp;
// value = turns ratio n = Ns/Np):
//   • drive = norm(|Ip|) → flux-loop + winding-electron density/alpha.
//   • dir   = sign(Ip)   → flux + electron direction (reverses each AC half-cycle).
//   • ratio = value      → the secondary winding's turn count vs the primary's.
// ============================================================================
function rectPerimeter(
  t: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number } {
  const w = x1 - x0;
  const h = y1 - y0;
  const per = 2 * (w + h);
  let d = (((t % 1) + 1) % 1) * per;
  if (d < w) return { x: x0 + d, y: y0 };
  d -= w;
  if (d < h) return { x: x1, y: y0 + d };
  d -= h;
  if (d < w) return { x: x1 - d, y: y1 };
  d -= w;
  return { x: x0, y: y1 - d };
}

function drawDetailTransformer(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const ELEC = mix(PALETTE.cyan, 0xffffff, 0.3);
  const FLUX = mix(PALETTE.cyan, 0xffffff, 0.45);
  const BRONZE = PALETTE.bronze;

  const drive = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1;
  const n = Math.max(0.34, Math.min(3, o.value && o.value > 0 ? o.value : 1));
  const primTurns = 6;
  const secTurns = Math.max(2, Math.min(12, Math.round(primTurns * n)));
  // The core-flux loop reads the REAL magnetising current (flux) when the sim
  // exposes it — its magnitude sets the loop brightness, its sign the loop
  // direction (so a DC bias keeps it lit one way; AC reverses it) — else the
  // primary current stands in. The windings still animate from the primary current.
  const FLUX_SCALE = 0.3;
  const fluxMag =
    o.electrical.flux !== undefined
      ? norm(o.electrical.flux, FLUX_SCALE)
      : drive;
  const fluxDir =
    o.electrical.flux !== undefined ? (o.electrical.flux >= 0 ? 1 : -1) : dir;

  // --- the iron core (a thick rectangular ring) --------------------------------
  const x0 = -hw * 0.34;
  const x1 = hw * 0.34;
  const y0 = -hh * 0.6;
  const y1 = hh * 0.6;
  const lw = Math.min(hw, hh) * 0.13;
  g.roundRect(x0, y0, x1 - x0, y1 - y0, 8).stroke({
    width: lw,
    color: PALETTE.rail,
    alpha: 0.9,
  });

  // --- flux dots looping around the core (the REAL magnetising flux) -----------
  if (fluxMag > 0.02) {
    const mx0 = x0;
    const my0 = y0;
    const mx1 = x1;
    const my1 = y1;
    const nF = FLOW_DOTS_MAX;
    for (let k = 0; k < nF; k++) {
      const present = dotPresence(k, fluxMag);
      if (present <= 0) continue;
      const t = (((k / nF + o.phase * FLOW_SPEED * fluxDir) % 1) + 1) % 1;
      const pt = rectPerimeter(t, mx0, my0, mx1, my1);
      g.circle(pt.x, pt.y, 2.6).fill({
        color: FLUX,
        alpha: (0.35 + 0.5 * fluxMag) * present,
      });
    }
  }

  // --- AC drive (left) + load R (right), wired to the two legs -----------------
  const drvX = -hw + 14;
  g.circle(drvX, 0, 10).stroke({ width: 2, color: PALETTE.cyan, alpha: 0.8 });
  g.moveTo(drvX - 6, 0)
    .quadraticCurveTo(drvX - 3, -7, drvX, 0)
    .quadraticCurveTo(drvX + 3, 7, drvX + 6, 0)
    .stroke({ width: 1.8, color: PALETTE.cyan, alpha: 0.85 });
  g.moveTo(drvX + 10, 0)
    .lineTo(x0 - lw, 0)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.8 });
  const loadX = hw - 12;
  g.moveTo(x1 + lw, 0)
    .lineTo(loadX, 0)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.8 });
  g.roundRect(loadX - 6, -16, 12, 32, 3).stroke({
    width: 3,
    color: PALETTE.violet,
    alpha: 0.5 + 0.4 * drive,
  });

  // --- the two windings (turn counts in the turns ratio) -----------------------
  const wyT = y0 + lw + 6;
  const wyB = y1 - lw - 6;
  const drawWinding = (cx: number, turns: number): void => {
    for (let k = 0; k < turns; k++) {
      const wy = wyT + (wyB - wyT) * (turns === 1 ? 0.5 : k / (turns - 1));
      g.ellipse(cx, wy, 16, 5.5).stroke({
        width: 3,
        color: BRONZE,
        alpha: 0.92,
      });
    }
  };
  drawWinding(x0, primTurns);
  drawWinding(x1, secTurns);

  // --- electrons in each winding (primary down, secondary up), by drive --------
  belt(g, x0, wyT, x0, wyB, drive, dir, o.phase, ELEC, 2.4);
  belt(g, x1, wyB, x1, wyT, drive, dir, o.phase, ELEC, 2.4);
  stud(g, drvX, 0, PALETTE.bronze);
  stud(g, loadX, 0, PALETTE.bronze);
}

// ============================================================================
// Bipolar transistor (BJT) — ported from transistor-tiers.html tier 3: two junctions
// in one slab of silicon, EMITTER | thin BASE | COLLECTOR. The heavily-doped emitter
// injects majority carriers; because the base is THIN almost all of them cross it and
// are swept into the collector (that stream is I_C). A FEW recombine in the base — that
// trickle is I_B — and the ratio is the gain β. NPN carries electrons, PNP holes.
//
// Live mapping (BJT ElectricalState: current = I_C, vAcross = V_CE; value = β):
//   • conduction = norm(|I_C|) → the main carrier stream's density/alpha.
//   • base       = conduction/β → the sparse recombination flashes in the base.
//   • carrier    = kind (Q=NPN electrons, QP=PNP holes) → stream colour + doping.
// ============================================================================
function drawDetailBJT(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const npn = o.kind !== "QP";
  const ELEC = mix(PALETTE.cyan, 0xffffff, 0.3);
  const HOLE = mix(PALETTE.bad, PALETTE.warn, 0.4);
  const maj = npn ? ELEC : HOLE; // the carrier the main stream is made of
  const beta = o.value && o.value > 1 ? o.value : 100;

  // Sensitive knee so the carrier stream + recombination visibly respond to even a
  // small collector current (the device's response is the point), not just big ones.
  const ic = norm(o.electrical.current, CUR_SCALE * 0.3);
  const ib = Math.min(1, (ic / beta) * 40); // a small, visible base trickle
  const dir = o.electrical.current >= 0 ? 1 : -1;

  const regT = -hh * 0.5;
  const regB = hh * 0.5;
  const x0 = -hw * 0.7;
  const x1 = hw * 0.7;
  const eB = -hw * 0.12; // emitter|base boundary
  const bC = hw * 0.0; // base|collector boundary (base is the thin slab eB..bC)
  // n+/p/n (NPN) or p+/n/p (PNP) region tints
  const emCol = npn ? PALETTE.cyan : HOLE;
  const bsCol = npn ? HOLE : PALETTE.cyan;
  g.rect(x0, regT, eB - x0, regB - regT).fill({ color: emCol, alpha: 0.12 });
  g.rect(eB, regT, bC - eB, regB - regT).fill({ color: bsCol, alpha: 0.16 });
  g.rect(bC, regT, x1 - bC, regB - regT).fill({ color: emCol, alpha: 0.09 });
  g.rect(x0, regT, x1 - x0, regB - regT).stroke({
    width: 1.5,
    color: PALETTE.border,
    alpha: 0.8,
  });
  // the two junction lines (EB forward, BC reverse)
  for (const jx of [eB, bC]) {
    g.moveTo(jx, regT)
      .lineTo(jx, regB)
      .stroke({ width: 1.2, color: PALETTE.rail, alpha: 0.8 });
  }

  // --- contacts + leads: emitter (left), collector (right), base (top) ---------
  const eX = -hw + 8;
  const cX = hw - 8;
  const bX = (eB + bC) / 2;
  g.roundRect(x0 - 4, -hh * 0.2, 6, hh * 0.4, 2).fill({ color: PALETTE.dim });
  g.roundRect(x1 - 2, -hh * 0.2, 6, hh * 0.4, 2).fill({ color: PALETTE.dim });
  g.roundRect(bX - hw * 0.04, regT - 8, hw * 0.08, 8, 2).fill({
    color: PALETTE.dim,
  });
  g.moveTo(eX, 0)
    .lineTo(x0, 0)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });
  g.moveTo(x1, 0)
    .lineTo(cX, 0)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });
  g.moveTo(bX, regT - 8)
    .lineTo(bX, -hh + 6)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });

  // --- the main carrier stream: emitter → across the thin base → collector ------
  if (ic > 0.02) {
    const lanes = [-0.55, -0.18, 0.18, 0.55];
    for (const lane of lanes) {
      const ly = lane * (regB - regT) * 0.5;
      const nC = FLOW_DOTS_MAX;
      for (let k = 0; k < nC; k++) {
        const present = dotPresence(k, ic);
        if (present <= 0) continue;
        const t = (((k / nC + o.phase * FLOW_SPEED * dir) % 1) + 1) % 1;
        g.circle(x0 + 8 + t * (x1 - x0 - 16), ly, 2.4).fill({
          color: maj,
          alpha: (0.3 + 0.55 * ic) * present,
        });
      }
    }
  }

  // --- a few carriers recombine in the base (= I_B), flashing ------------------
  if (ib > 0.02) {
    const nR = 3;
    for (let k = 0; k < nR; k++) {
      const t = (((k / nR + o.phase * 0.5) % 1) + 1) % 1;
      const ry = (((k * 0.37) % 1) - 0.5) * (regB - regT) * 0.8;
      const rx = x0 + 8 + t * (bX - x0 - 8);
      const atBase = t > 0.82;
      g.circle(rx, ry, 2.4).fill({ color: maj, alpha: atBase ? 0 : 0.8 });
      if (atBase) {
        const f = (t - 0.82) / 0.18;
        g.circle(bX, ry, 3 + 5 * f).fill({
          color: 0xffffff,
          alpha: 0.6 * (1 - f),
        });
      }
    }
    // the base contact supplies the recombination partner from the top
    belt(g, bX, -hh + 6, bX, 0, ib, 1, o.phase, bsCol, 2.2);
  }

  // --- lead currents -----------------------------------------------------------
  belt(g, eX, 0, x0, 0, ic, dir, o.phase, maj, 2.4);
  belt(g, x1, 0, cX, 0, ic, dir, o.phase, maj, 2.4);
  stud(g, eX, 0, PALETTE.bronze);
  stud(g, cX, 0, PALETTE.bronze);
  stud(g, bX, -hh + 6, PALETTE.bronze);
}

// ============================================================================
// MOSFET — ported from mosfet-tiers.html tier 3: metal-oxide-silicon. The metal GATE
// sits behind a thin OXIDE over a doped body, between a SOURCE and a DRAIN. The gate
// draws no current — it only sets up a FIELD. Once that field is strong enough it
// pulls minority carriers up to the surface and inverts a CHANNEL between source and
// drain; current then flows, and the channel widens with more gate drive. None of
// the gate charge ever crosses the oxide. NM is n-channel (electrons), PM p-channel
// (holes).
//
// Live mapping (MOSFET ElectricalState: current = I_D, vAcross = V_DS):
//   • drive = norm(|I_D|) → channel brightness/width + gate-plate charge + the field.
//     (A conducting device has an inverted channel and a charged gate — the live
//     drain current is the visible proxy for "the gate has cleared threshold".)
//   • carrier = kind (NM electrons / PM holes) → channel + stream colour, gate sign.
// ============================================================================
function drawDetailMOSFET(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const nch = o.kind !== "PM";
  const ELEC = mix(PALETTE.cyan, 0xffffff, 0.3);
  const HOLE = mix(PALETTE.bad, PALETTE.warn, 0.4);
  const carrier = nch ? ELEC : HOLE;
  const OXIDE = mix(PALETTE.warn, 0xffffff, 0.2);

  // Sensitive knee so the channel width + carrier stream visibly track even a small
  // drain current, not only large ones (the gate-controlled response is the point).
  const id = norm(o.electrical.current, CUR_SCALE * 0.3);
  const dir = o.electrical.current >= 0 ? 1 : -1;
  const on = id > 0.03;

  const bodyT = -hh * 0.16;
  const bodyB = hh * 0.6;
  const x0 = -hw * 0.74;
  const x1 = hw * 0.74;
  const xL = -hw * 0.3; // channel left (source/channel edge)
  const xR = hw * 0.3; // channel right (drain/channel edge)
  const surf = bodyT; // the silicon surface

  // --- the doped body (p-type for n-channel, n-type for p-channel) -------------
  housing(g, x0, bodyT, x1 - x0, bodyB - bodyT, PALETTE.dim, 6);
  // source + drain wells (n+/p+) at the surface
  const wellH = (bodyB - bodyT) * 0.42;
  g.rect(x0 + 3, surf, xL - x0 - 5, wellH).fill({
    color: carrier,
    alpha: 0.18,
  });
  g.rect(xR + 2, surf, x1 - xR - 5, wellH).fill({
    color: carrier,
    alpha: 0.18,
  });

  // --- the inversion channel (tapered), lit once the gate inverts it ------------
  if (on) {
    const w = 4 + 8 * id;
    // tapered toward the drain in saturation (pinch-off) — taper rides drive
    g.poly([
      xL,
      surf + 2,
      xR,
      surf + 2,
      xR,
      surf + 2 + w * 0.4,
      xL,
      surf + 2 + w,
    ]).fill({ color: carrier, alpha: 0.25 + 0.4 * id });
  }

  // --- thin oxide + metal gate on top of the channel ---------------------------
  g.rect(xL - 5, surf - 9, xR - xL + 10, 7).fill({ color: OXIDE, alpha: 0.6 });
  g.rect(xL - 5, surf - 9, xR - xL + 10, 7).stroke({
    width: 1,
    color: OXIDE,
    alpha: 0.9,
  });
  g.roundRect(xL - 5, surf - 26, xR - xL + 10, 17, 2).fill({
    color: 0x2a2740,
    alpha: 0.95,
  });
  g.roundRect(xL - 5, surf - 26, xR - xL + 10, 17, 2).stroke({
    width: 1.2,
    color: PALETTE.rail,
    alpha: 0.9,
  });

  // --- gate-plate charge + field lines through the oxide (none cross) ----------
  const gateCharge = id; // a conducting device has a charged gate
  const nMarks = 6;
  for (let k = 0; k < nMarks; k++) {
    const gx = xL + 8 + ((k + 0.5) / nMarks) * (xR - xL - 16);
    const a = Math.min(1, gateCharge * 1.2);
    if (a <= 0.03) continue;
    // + on the gate for n-channel (electrons pulled up), − for p-channel
    g.moveTo(gx - 3, surf - 17).lineTo(gx + 3, surf - 17);
    if (nch) g.moveTo(gx, surf - 20).lineTo(gx, surf - 14);
    g.stroke({ width: 1.5, color: PALETTE.accent, alpha: a });
    // dashed field line reaching down through the oxide (charge does NOT cross)
    g.moveTo(gx, surf - 8)
      .lineTo(gx, surf)
      .stroke({ width: 1, color: OXIDE, alpha: 0.2 + 0.6 * gateCharge });
  }

  // --- gate / source / drain leads + studs -------------------------------------
  const gX = (xL + xR) / 2;
  const sX = -hw + 8;
  const dX = hw - 8;
  g.moveTo(gX, surf - 26)
    .lineTo(gX, -hh + 6)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });
  g.moveTo(sX, surf + wellH / 2)
    .lineTo(x0, surf + wellH / 2)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });
  g.moveTo(x1, surf + wellH / 2)
    .lineTo(dX, surf + wellH / 2)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });

  // --- the carrier stream: source → through the channel → drain ----------------
  if (on) {
    const sy = surf + wellH / 2;
    const cy = surf + 4;
    // source lead in
    belt(g, sX, sy, x0 + 6, sy, id, dir, o.phase, carrier, 2.4);
    // up into the channel, across, and down to the drain (3 hops)
    belt(g, xL, cy, xR, cy, id, dir, o.phase, carrier, 2.4);
    belt(g, x1 - 6, sy, dX, sy, id, dir, o.phase, carrier, 2.4);
  }

  stud(g, sX, surf + wellH / 2, PALETTE.bronze);
  stud(g, dX, surf + wellH / 2, PALETTE.bronze);
  stud(g, gX, -hh + 6, PALETTE.bronze);
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
  C: drawDetailCeramicCap,
  EC: drawDetailElectrolyticCap,
  L: drawDetailInductor,
  TR: drawDetailTransformer,
  Q: drawDetailBJT,
  QP: drawDetailBJT,
  NM: drawDetailMOSFET,
  PM: drawDetailMOSFET,
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

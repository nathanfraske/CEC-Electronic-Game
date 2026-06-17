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
  anchorPt,
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
// Op-amp — THE exemplar. Ported from opamp-tiers.html tier 3: the real silicon is a
// LONG-TAILED DIFFERENTIAL PAIR. Two transistors Q+ and Q− share a constant tail
// current sunk to the −12 V rail; their collectors pull up to +12 V. Each base is one
// input. The pair is a current see-saw: whichever base sits higher steals the tail
// current, so the tail crowds into Q+ (V+ higher) or Q− (V− higher), and the output
// taps Q−'s collector — the tiny base difference swings the whole tail, the enormous
// gain, until one side hogs it all and the output pins to a rail. Anchored to the
// real pins (IN+ top-left base of Q+, IN− bottom-left base of Q−, OUT right).
//
// Live mapping (op-amp ElectricalState: current = Iout, vAcross = V(OUT)−V(IN−);
// value = ±Vsat rail):
//   • steer = ½ + ½·(vAcross/Vsat) → the tail split f into Q+ vs (1−f) into Q−:
//     region glow + branch-stream density on each transistor.
//   • drive = norm(|Iout|)         → the output belt off Q−'s collector; sign = dir.
//   • sat   = |swing|≈1            → all tail in one side; the rose rail-pin halo.
// ============================================================================
function drawDetailOA(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const POS = PALETTE.pos;
  const NEG = PALETTE.neg;
  const OUT = PALETTE.out;
  const RAIL = PALETTE.rail;
  const ELEC = mix(PALETTE.cyan, 0xffffff, 0.3);
  const HOLE = mix(PALETTE.bad, PALETTE.warn, 0.4);

  const railV = o.value && o.value > 0.5 ? o.value : OUT_SCALE;
  const swing = o.electrical.vAcross / railV;
  const swingC = Math.max(-1, Math.min(1, swing));
  const sat = Math.abs(swing) >= 0.985;
  const drive = norm(o.electrical.current, CUR_SCALE);
  const driveDir = o.electrical.current >= 0 ? 1 : -1;
  // The tail current splits between Q+ (f) and Q− (1−f); the higher base steals it.
  const f = 0.5 + 0.5 * swingC;
  const rL = f; // Q+ share
  const rR = 1 - f; // Q− share

  // Terminals on the real pins: IN+ top-left → Q+ base, IN− bottom-left → Q− base,
  // OUT right → Q−'s collector tap.
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

  // --- geometry: two transistor stacks between the supply rails ----------------
  const ySup = -hh * 0.8; // +12 V rail
  const yNeg = hh * 0.88; // −12 V (tail return)
  const qpx = -hw * 0.24;
  const qnx = hw * 0.16;
  const regHW = hw * 0.15;
  const yC0 = -hh * 0.44; // collector top
  const yC1 = -hh * 0.06; // collector / base
  const yB1 = hh * 0.06; // base / emitter
  const yE1 = hh * 0.44; // emitter bottom
  const tailX = (qpx + qnx) / 2;
  const yTail = hh * 0.5;

  // --- rose rail-pin halo when the output is railed ----------------------------
  if (sat) {
    const breathe = 0.8 + 0.2 * Math.sin(o.phase * PULSE_K);
    g.roundRect(
      qpx - regHW - 8,
      yC0 - 8,
      qnx - qpx + 2 * regHW + 16,
      yE1 - yC0 + 16,
      14,
    ).fill({
      color: OUT,
      alpha: 0.09 * breathe,
    });
  }

  // --- supply rails ------------------------------------------------------------
  g.moveTo(qpx - regHW - 10, ySup)
    .lineTo(qnx + regHW + 10, ySup)
    .stroke({ width: 2.5, color: RAIL, alpha: 0.85 });
  g.moveTo(tailX - 34, yNeg)
    .lineTo(tailX + 34, yNeg)
    .stroke({ width: 2.5, color: RAIL, alpha: 0.85 });

  // --- base leads from the pins (drawn first; the silicon overlays them) --------
  // IN+ runs straight to Q+'s left; IN− routes down the centre gap to Q−'s left.
  g.moveTo(IP.x, IP.y)
    .lineTo(qpx - regHW, 0)
    .stroke({ width: 2, color: POS, alpha: 0.7 });
  const gapX = (qpx + regHW + (qnx - regHW)) / 2;
  g.moveTo(IM.x, IM.y)
    .lineTo(gapX, IM.y)
    .lineTo(gapX, 0)
    .lineTo(qnx - regHW, 0)
    .stroke({ width: 2, color: NEG, alpha: 0.7 });

  // --- the two transistor stacks (collector n / base p / emitter n+) -----------
  for (const [cx, r] of [
    [qpx, rL],
    [qnx, rR],
  ] as const) {
    g.rect(cx - regHW, yC0, regHW * 2, yC1 - yC0).fill({
      color: ELEC,
      alpha: 0.08 + 0.2 * r,
    });
    g.rect(cx - regHW, yC1, regHW * 2, yB1 - yC1).fill({
      color: HOLE,
      alpha: 0.12 + 0.16 * r,
    });
    g.rect(cx - regHW, yB1, regHW * 2, yE1 - yB1).fill({
      color: ELEC,
      alpha: 0.1 + 0.2 * r,
    });
    g.rect(cx - regHW, yC0, regHW * 2, yE1 - yC0).stroke({
      width: 1.5,
      color: 0x4a4470,
      alpha: 0.9,
    });
    // base-emitter junction glow (brighter the harder this side conducts)
    g.rect(cx - regHW, yB1 - 3, regHW * 2, 6).fill({
      color: PALETTE.ok,
      alpha: 0.12 + 0.5 * r,
    });
    // collector lead up to the +rail, emitter lead down to the shared tail node
    g.moveTo(cx, yC0)
      .lineTo(cx, ySup)
      .stroke({ width: 2, color: RAIL, alpha: 0.7 });
    g.moveTo(cx, yE1)
      .lineTo(tailX, yTail)
      .stroke({ width: 2, color: RAIL, alpha: 0.7 });
  }

  // --- the constant tail current source, sunk to the −rail ---------------------
  g.moveTo(tailX, yTail)
    .lineTo(tailX, yTail + 6)
    .stroke({ width: 2, color: RAIL, alpha: 0.7 });
  g.circle(tailX, yTail + 18, 11).fill({ color: 0x10131f, alpha: 0.8 });
  g.circle(tailX, yTail + 18, 11).stroke({
    width: 1.5,
    color: RAIL,
    alpha: 0.85,
  });
  g.moveTo(tailX, yTail + 25)
    .lineTo(tailX, yTail + 11)
    .stroke({ width: 2, color: PALETTE.ok, alpha: 0.85 });
  g.poly([tailX - 4, yTail + 15, tailX + 4, yTail + 15, tailX, yTail + 9]).fill(
    {
      color: PALETTE.ok,
      alpha: 0.85,
    },
  );
  g.moveTo(tailX, yTail + 29)
    .lineTo(tailX, yNeg)
    .stroke({ width: 2, color: RAIL, alpha: 0.7 });

  // --- base tap markers (brighten with each side's drive) ----------------------
  g.circle(qpx - regHW, 0, 2.4).fill({ color: POS, alpha: 0.55 + 0.4 * rL });
  g.circle(qnx - regHW, 0, 2.4).fill({ color: NEG, alpha: 0.55 + 0.4 * rR });

  // --- Vout taps Q−'s collector and runs to the OUT pin ------------------------
  g.moveTo(qnx, yC0 + 10)
    .lineTo(qnx + regHW, yC0 + 10)
    .lineTo(OU.x, OU.y)
    .stroke({ width: 2, color: OUT, alpha: 0.55 });
  const beltW = 2 + 8 * drive;
  if (drive > 0.02) {
    g.roundRect(
      qnx + regHW,
      OU.y - beltW / 2,
      OU.x - qnx - regHW,
      beltW,
      2,
    ).fill({ color: OUT, alpha: 0.16 + 0.26 * drive });
  }

  // --- electron streams: constant tail up, then split up each transistor -------
  belt(g, tailX, yNeg, tailX, yTail, 0.6, 1, o.phase, PALETTE.ok, 3);
  belt(g, qpx, yE1, qpx, ySup, rL, 1, o.phase, ELEC, 3);
  belt(g, qnx, yE1, qnx, ySup, rR, 1, o.phase, ELEC, 3);
  belt(g, qnx + regHW, OU.y, OU.x, OU.y, drive, driveDir, o.phase, OUT, 3.2);

  stud(g, IP.x, IP.y, POS);
  stud(g, IM.x, IM.y, NEG);
  stud(g, OU.x, OU.y, OUT);
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

  // Oriented to the real pins: collector TOP, emitter BOTTOM (carriers cross the thin
  // base vertically between them), base on the LEFT. Regions stack top→bottom:
  // collector / thin base / emitter.
  const C = anchorPt(o, "C", 0.588, -0.95);
  const E = anchorPt(o, "E", 0.588, 0.95);
  const B = anchorPt(o, "B", -0.588, 0);

  const regL = -hw * 0.06;
  const regR = hw * 0.6;
  const bodyT = -hh * 0.52;
  const bodyB = hh * 0.52;
  const Hb = bodyB - bodyT;
  const yCB = bodyT + Hb * 0.44; // collector|base boundary
  const yBE = yCB + Hb * 0.12; // base|emitter boundary (thin base between)
  const byMid = (yCB + yBE) / 2;
  const midX = (regL + regR) / 2;
  const cLeadX = Math.min(regR - 8, C.x);
  const eLeadX = Math.min(regR - 8, E.x);
  // n/p/n (NPN) or p/n/p (PNP) region tints — they brighten as the device conducts.
  const emCol = npn ? PALETTE.cyan : HOLE;
  const bsCol = npn ? HOLE : PALETTE.cyan;
  const glow = 0.1 + 0.24 * ic;
  g.rect(regL, bodyT, regR - regL, yCB - bodyT).fill({
    color: emCol,
    alpha: glow * 0.8,
  });
  g.rect(regL, yCB, regR - regL, yBE - yCB).fill({
    color: bsCol,
    alpha: glow + 0.05,
  });
  g.rect(regL, yBE, regR - regL, bodyB - yBE).fill({
    color: emCol,
    alpha: glow,
  });
  g.rect(regL, bodyT, regR - regL, bodyB - bodyT).stroke({
    width: 1.5,
    color: PALETTE.border,
    alpha: 0.8,
  });
  // the two junction lines (BC reverse on top, EB forward below)
  for (const jy of [yCB, yBE]) {
    g.moveTo(regL, jy)
      .lineTo(regR, jy)
      .stroke({ width: 1.2, color: PALETTE.rail, alpha: 0.8 });
  }

  // --- contacts + leads: collector (top), emitter (bottom), base (left) --------
  g.roundRect(regL, bodyT - 4, regR - regL, 6, 2).fill({ color: PALETTE.dim });
  g.roundRect(regL, bodyB - 2, regR - regL, 6, 2).fill({ color: PALETTE.dim });
  g.roundRect(regL - 8, byMid - hh * 0.04, 8, hh * 0.08, 2).fill({
    color: PALETTE.dim,
  });
  g.moveTo(cLeadX, bodyT)
    .lineTo(C.x, C.y)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });
  g.moveTo(eLeadX, bodyB)
    .lineTo(E.x, E.y)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });
  g.moveTo(regL - 8, byMid)
    .lineTo(B.x, B.y)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });

  // --- the main carrier stream: emitter (bottom) → thin base → collector (top) --
  if (ic > 0.02) {
    const lanes = [-0.55, -0.18, 0.18, 0.55];
    for (const lane of lanes) {
      const lx = midX + lane * (regR - regL) * 0.5;
      const nC = FLOW_DOTS_MAX;
      for (let k = 0; k < nC; k++) {
        const present = dotPresence(k, ic);
        if (present <= 0) continue;
        const t = (((k / nC + o.phase * FLOW_SPEED * dir) % 1) + 1) % 1;
        g.circle(lx, bodyB - 8 - t * (bodyB - bodyT - 16), 2.4).fill({
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
      const rx = midX + (((k * 0.37) % 1) - 0.5) * (regR - regL) * 0.8;
      const ry = bodyB - 8 - t * (bodyB - byMid - 8);
      const atBase = t > 0.82;
      g.circle(rx, ry, 2.4).fill({ color: maj, alpha: atBase ? 0 : 0.8 });
      if (atBase) {
        const f = (t - 0.82) / 0.18;
        g.circle(rx, byMid, 3 + 5 * f).fill({
          color: 0xffffff,
          alpha: 0.6 * (1 - f),
        });
      }
    }
    // the base contact supplies the recombination partner from the left
    belt(g, B.x, B.y, regL, byMid, ib, 1, o.phase, bsCol, 2.2);
  }

  // --- lead currents -----------------------------------------------------------
  belt(g, E.x, E.y, eLeadX, bodyB, ic, dir, o.phase, maj, 2.4);
  belt(g, cLeadX, bodyT, C.x, C.y, ic, dir, o.phase, maj, 2.4);
  stud(g, C.x, C.y, PALETTE.bronze);
  stud(g, E.x, E.y, PALETTE.bronze);
  stud(g, B.x, B.y, PALETTE.bronze);
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

  // Oriented to the real pins: drain TOP, source BOTTOM (the vertical channel runs
  // between them down the surface), gate on the LEFT (its plate faces the channel).
  const D = anchorPt(o, "D", 0.588, -0.95);
  const S = anchorPt(o, "S", 0.588, 0.95);
  const G = anchorPt(o, "G", -0.588, 0);

  const bodyL = -hw * 0.06; // the silicon surface (channel face, toward the gate)
  const bodyR = hw * 0.6; // into the bulk
  const bodyT = -hh * 0.56;
  const bodyB = hh * 0.56;
  const bandH = (bodyB - bodyT) * 0.2;
  const dBandB = bodyT + bandH; // drain well (top) lower edge
  const sBandT = bodyB - bandH; // source well (bottom) upper edge
  const surf = bodyL; // channel hugs the left (surface) face
  const dLeadX = Math.min(bodyR - 8, D.x);
  const sLeadX = Math.min(bodyR - 8, S.x);

  // --- the doped body + the drain (top) / source (bottom) wells ----------------
  housing(g, bodyL, bodyT, bodyR - bodyL, bodyB - bodyT, PALETTE.dim, 6);
  g.rect(bodyL + 2, bodyT + 3, bodyR - bodyL - 4, bandH - 3).fill({
    color: carrier,
    alpha: 0.18,
  });
  g.rect(bodyL + 2, sBandT, bodyR - bodyL - 4, bandH - 3).fill({
    color: carrier,
    alpha: 0.18,
  });

  // --- the inversion channel (vertical, PINCHED at the drain), lit by the gate ---
  if (on) {
    // Full at the source (bottom) and pinching toward the drain (top) the harder
    // it's driven; both width and brightness ride the drain current.
    const wS = 3 + 16 * id; // source-side (bottom) width
    const wD = wS * (0.62 - 0.4 * id); // drain-side (top) width (pinch-off)
    g.poly([
      surf + 2,
      sBandT,
      surf + 2 + wS,
      sBandT,
      surf + 2 + wD,
      dBandB,
      surf + 2,
      dBandB,
    ]).fill({ color: carrier, alpha: 0.3 + 0.5 * id });
    // a thin depletion band hugging the inversion layer to the right
    g.poly([
      surf + 2 + wS,
      sBandT,
      surf + 2 + wS + 13,
      sBandT,
      surf + 2 + wD + 10,
      dBandB,
      surf + 2 + wD,
      dBandB,
    ]).fill({ color: PALETTE.violet, alpha: 0.1 + 0.1 * id });
  }

  // --- thin oxide + metal gate on the LEFT face of the channel ------------------
  g.rect(surf - 7, dBandB, 5, sBandT - dBandB).fill({
    color: OXIDE,
    alpha: 0.6,
  });
  g.rect(surf - 7, dBandB, 5, sBandT - dBandB).stroke({
    width: 1,
    color: OXIDE,
    alpha: 0.9,
  });
  g.roundRect(surf - 24, dBandB, 17, sBandT - dBandB, 2).fill({
    color: 0x2a2740,
    alpha: 0.95,
  });
  g.roundRect(surf - 24, dBandB, 17, sBandT - dBandB, 2).stroke({
    width: 1.2,
    color: PALETTE.rail,
    alpha: 0.9,
  });

  // --- gate-plate charge + field lines through the oxide (none cross) ----------
  const gateCharge = id;
  const nMarks = 5;
  for (let k = 0; k < nMarks; k++) {
    const gy = dBandB + 8 + ((k + 0.5) / nMarks) * (sBandT - dBandB - 16);
    const a = Math.min(1, gateCharge * 1.2);
    if (a <= 0.03) continue;
    // + on the gate for n-channel (carriers pulled to the surface), − for p-channel
    g.moveTo(surf - 18, gy).lineTo(surf - 12, gy);
    if (nch) g.moveTo(surf - 15, gy - 3).lineTo(surf - 15, gy + 3);
    g.stroke({ width: 1.5, color: PALETTE.accent, alpha: a });
    // field line reaching right through the oxide (charge does NOT cross)
    g.moveTo(surf - 7, gy)
      .lineTo(surf, gy)
      .stroke({ width: 1, color: OXIDE, alpha: 0.2 + 0.6 * gateCharge });
  }

  // --- gate / drain / source leads + studs -------------------------------------
  g.moveTo(surf - 24, 0)
    .lineTo(G.x, G.y)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });
  g.moveTo(dLeadX, bodyT)
    .lineTo(D.x, D.y)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });
  g.moveTo(sLeadX, bodyB)
    .lineTo(S.x, S.y)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });

  // --- carrier stream: source (bottom) → up the channel → drain (top) ----------
  if (on) {
    const cx = surf + 4;
    belt(g, S.x, S.y, sLeadX, sBandT, id, dir, o.phase, carrier, 2.4);
    belt(g, sLeadX, sBandT, cx, sBandT, id, dir, o.phase, carrier, 2.4);
    belt(g, cx, sBandT, cx, dBandB, id, dir, o.phase, carrier, 2.4);
    belt(g, cx, dBandB, dLeadX, dBandB, id, dir, o.phase, carrier, 2.4);
    belt(g, dLeadX, dBandB, D.x, D.y, id, dir, o.phase, carrier, 2.4);
  }

  stud(g, D.x, D.y, PALETTE.bronze);
  stud(g, S.x, S.y, PALETTE.bronze);
  stud(g, G.x, G.y, PALETTE.bronze);
}

// ============================================================================
// Varistor (MOV) — ported from varistor-tiers.html tier 3: ZINC OXIDE GRAINS. A MOV
// is a pressed block of ZnO grains: each grain is conductive n-type, but the BOUNDARY
// between two grains holds off ~3.2 V like a back-to-back diode pair. Stack N of them
// in series and the block blocks until the voltage clears ≈ N×3.2 V (the clamp); past
// that the boundaries break down and it conducts hard, both polarities.
//
// Live mapping (MOV ElectricalState: current a→b, vAcross = V across; value = Vclamp):
//   • clamp  = value → the boundary count N ≈ Vclamp/3.2 (capped for display).
//   • broken = |vAcross| ≥ Vclamp → boundaries glow + electrons stream through.
//   • flow   = norm(|I|) → electron density; sign sets the drift direction.
// ============================================================================
function drawDetailVaristor(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const ELEC = mix(PALETTE.cyan, 0xffffff, 0.3);
  const ZINC = mix(PALETTE.cyan, PALETTE.dim, 0.5);

  const applied = Math.abs(o.electrical.vAcross);
  const vclamp = o.value && o.value > 0 ? o.value : 5;
  const cur = norm(o.electrical.current, CUR_SCALE * 0.3);
  const dir = o.electrical.current >= 0 ? 1 : -1;
  const broken = applied >= vclamp * 0.9;
  const N = Math.max(1, Math.min(6, Math.round(vclamp / 3.2)));

  const cx = 0;
  const elecHW = hw * 0.48;
  const topY = -hh * 0.74;
  const botY = hh * 0.74;
  // --- electrodes + leads ------------------------------------------------------
  g.roundRect(cx - elecHW, topY - 8, elecHW * 2, 8, 2).fill({
    color: PALETTE.dim,
  });
  g.roundRect(cx - elecHW, botY, elecHW * 2, 8, 2).fill({ color: PALETTE.dim });
  g.moveTo(cx, topY - 8)
    .lineTo(cx, -hh + 4)
    .moveTo(cx, botY + 8)
    .lineTo(cx, hh - 4)
    .stroke({ width: 3, color: PALETTE.border, alpha: 0.85 });

  // --- the ZnO grain chain: N+1 grains, N boundaries ---------------------------
  const H = botY - topY;
  const bh = H / (N + 1);
  const grainHW = hw * 0.34;
  for (let gi = 0; gi <= N; gi++) {
    const gy0 = topY + gi * bh;
    const gy1 = topY + (gi + 1) * bh;
    g.poly([
      cx - grainHW,
      gy0 + 3,
      cx + grainHW,
      gy0 + 1,
      cx + grainHW * 0.9,
      gy1 - 2,
      cx - grainHW * 0.9,
      gy1 - 1,
    ])
      .fill({ color: ZINC, alpha: 0.16 + (broken ? 0.14 * cur : 0) })
      .stroke({ width: 1.2, color: ZINC, alpha: 0.7 });
  }
  for (let b = 1; b <= N; b++) {
    const by = topY + b * bh;
    g.moveTo(cx - grainHW * 0.95, by)
      .lineTo(cx + grainHW * 0.95, by)
      .stroke({
        width: 3.4,
        color: broken ? PALETTE.warn : mix(PALETTE.bad, 0x000000, 0.35),
        alpha: broken ? 0.6 + 0.4 * cur : 0.85,
      });
  }

  // --- electrons stream through once the boundaries break down -----------------
  if (broken && cur > 0.02) {
    belt(g, cx, topY, cx, botY, cur, dir, o.phase, ELEC, 2.8);
  }
  stud(g, cx, -hh + 4, PALETTE.bronze);
  stud(g, cx, hh - 4, PALETTE.bronze);
}

// ============================================================================
// Potentiometer (POT) — ported from potentiometer-tiers.html tier 3: a RESISTIVE
// FILM. The track is a strip of carbon film between the two ends (A↔B); a potential
// gradient falls across it, electrons drift through, scattering off the fixed atom
// lattice (that scattering IS the resistance), and a sprung metal WIPER presses on
// the film and picks off the local potential. Anchored A top-left, B top-right, W
// bottom-centre (the real pins).
//
// Live mapping (POT ElectricalState: current a→b = A→B, vAcross = V(A)−V(B); value =
// track Ω; wiper = 0..1):
//   • wiper = o.wiper   → the wiper contact's x on the film.
//   • flow  = norm(|I|) → drifting-electron density (they drift toward the + end,
//     opposite the conventional current).
//   • grad  = vAcross   → the potential gradient brightening toward the high end.
//   • R     = value     → atom-lattice density (more scattering centres).
// ============================================================================
function drawDetailPOT(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const ELEC = mix(PALETTE.cyan, 0xffffff, 0.3);
  const OXIDE = mix(PALETTE.warn, 0xffffff, 0.2);
  const WARM = mix(PALETTE.bronze, 0xffffff, 0.4);
  const FILM = mix(PALETTE.bronze, 0x000000, 0.45);

  const A = anchorPt(o, "A", -0.588, -0.95);
  const B = anchorPt(o, "B", 0.588, -0.95);
  const W = anchorPt(o, "W", 0, 0.95);
  const wiper = Math.max(0, Math.min(1, o.wiper ?? 0.5));
  const flow = norm(o.electrical.current, CUR_SCALE);
  const drop = Math.max(-1, Math.min(1, o.electrical.vAcross / V_SCALE));

  const yF = -hh * 0.34;
  const fhh = Math.min(hw, hh) * 0.16;
  const xL = A.x;
  const xR = B.x;
  const xW = xL + (xR - xL) * wiper;

  // --- leads from the A / B pins down to the film ends -------------------------
  g.moveTo(A.x, A.y)
    .lineTo(A.x, yF - fhh)
    .moveTo(B.x, B.y)
    .lineTo(B.x, yF - fhh)
    .stroke({ width: 2.4, color: PALETTE.border, alpha: 0.85 });

  // --- carbon film body + potential-gradient bands (brighter toward + end) -----
  g.rect(xL, yF - fhh, xR - xL, 2 * fhh).fill({ color: FILM, alpha: 0.32 });
  const NB = 14;
  for (let i = 0; i < NB; i++) {
    const pv = drop >= 0 ? 1 - (i + 0.5) / NB : (i + 0.5) / NB;
    g.rect(
      xL + (i / NB) * (xR - xL),
      yF - fhh,
      (xR - xL) / NB + 0.6,
      2 * fhh,
    ).fill({ color: WARM, alpha: 0.04 + 0.22 * pv * Math.abs(drop) });
  }
  g.rect(xL, yF - fhh, xR - xL, 2 * fhh).stroke({
    width: 1.5,
    color: PALETTE.border,
    alpha: 0.8,
  });

  // --- the fixed atom lattice (density ~ resistance) ---------------------------
  const rNorm = o.value ? norm(o.value, 50000) : 0.5;
  const NA = Math.round(34 + 50 * rNorm);
  for (let k = 0; k < NA; k++) {
    const ax = xL + 4 + ((k * 0.61803398875) % 1) * (xR - xL - 8);
    const ay = yF - fhh + 4 + ((k * 0.39 + 0.13) % 1) * (2 * fhh - 8);
    g.circle(ax, ay, 1.3).fill({ color: OXIDE, alpha: 0.5 });
  }

  // --- drifting electrons toward the + end (opposite the conventional current) --
  if (flow > 0.02) {
    const n = FLOW_DOTS_MAX;
    const ddir = o.electrical.current >= 0 ? -1 : 1; // e⁻ drift opposes I
    for (const lane of [-0.5, 0, 0.5]) {
      for (let k = 0; k < n; k++) {
        const present = dotPresence(k, flow);
        if (present <= 0) continue;
        const t = (((k / n + o.phase * FLOW_SPEED * ddir) % 1) + 1) % 1;
        const x = xL + t * (xR - xL);
        const jig = Math.sin(o.phase * PULSE_K * 3 + k * 1.7 + lane * 5) * 2;
        g.circle(x, yF + lane * fhh + jig, 2.3).fill({
          color: ELEC,
          alpha: (0.35 + 0.5 * flow) * present,
        });
      }
    }
  }

  // --- the sprung metal wiper: contact on the film → spring → arm to the W pin --
  const cy = yF + fhh;
  // spring (a short zig-zag) just below the contact
  const sTop = cy + 2;
  const sBot = cy + 14;
  const sp: number[] = [xW, sTop];
  for (let k = 1; k <= 6; k++) {
    const yy = sTop + ((sBot - sTop) * k) / 6;
    sp.push(k === 6 ? xW : xW + (k % 2 ? -5 : 5), yy);
  }
  g.poly(sp, false).stroke({ width: 1.6, color: PALETTE.dim, alpha: 0.85 });
  // arm down to the fixed wiper terminal W
  const midY = (sBot + W.y) / 2;
  g.moveTo(xW, sBot)
    .lineTo(xW, midY)
    .lineTo(W.x, midY)
    .lineTo(W.x, W.y)
    .stroke({ width: 2.5, color: PALETTE.dim, alpha: 0.85 });
  // contact bead on the film
  g.circle(xW, cy, 4).fill({ color: WARM, alpha: 0.95 });
  g.circle(xW, cy, 4).stroke({ width: 0.8, color: 0xffffff, alpha: 0.5 });

  stud(g, A.x, A.y, PALETTE.bronze);
  stud(g, B.x, B.y, PALETTE.bronze);
  stud(g, W.x, W.y, PALETTE.accent);
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
  MOV: drawDetailVaristor,
  POT: drawDetailPOT,
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

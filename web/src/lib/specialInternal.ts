// SPDX-License-Identifier: Apache-2.0
// In-app INTERNAL VIEW for the special analog / mixed-signal ICs whose reality tier is a small
// device, not a flat symbol: the comparator (CMP), the clocked sampler (SAMP) and the analog
// switch (ASW). The matching five-tier refsheets (comparator-ic.html, sampler-ic.html,
// analog-switch-ic.html in docs/ui/parts/) teach the device tier this redraws on the board:
//   - CMP  -> a long-tailed differential pair feeding a regenerative latch + output stage, with a
//             hysteresis (Schmitt) band note (value = V_H).
//   - SAMP -> a CLK-gated sampling switch charging a hold capacitor, read out by a buffer that
//             thresholds the held level against an on-chip reference (value = threshold V).
//   - ASW  -> a CMOS transmission gate: an NMOS valve in parallel with a PMOS valve, the NMOS
//             gated by CTRL and the PMOS by NOT-CTRL, conducting A<->B when CTRL is high
//             (value = R_on).
// Same shape as logicInternal.ts / detailDrawers.ts (drawDetailOA is the exemplar): a per-kind
// (g, o) => void that paints an illustration of the object into a centred bounds, anchors each
// lead to the real pin via o.anchors, and animates purely from the live ElectricalState + the
// bounded phase clock. Pure presentation -- it never feeds the sim, the netlist or the snapshot
// hash, and recolours only from PALETTE (bus-language discipline: magnitude rides alpha / density
// / thickness, never speed). The parent registers this module alongside DETAIL_DRAWERS.

import { Graphics } from "pixi.js";
import { PALETTE } from "./graph";
import {
  type TierOpts as DetailOpts,
  belt,
  mix,
  norm,
  CUR_SCALE,
  OUT_SCALE,
  PULSE_K,
} from "./tierKit";

/** The special-IC kinds this module supplies an internal (device-tier) view for. */
export const SPECIAL_INTERNAL_KINDS: string[] = ["CMP", "SAMP", "ASW"];

// Shared carrier tints (mirror detailDrawers.ts): electrons cyan-white, holes amber-red.
const ELEC = mix(PALETTE.cyan, 0xffffff, 0.3);
const HOLE = mix(PALETTE.bad, PALETTE.warn, 0.4);

/**
 * Resolve a named pin's anchor (host-supplied, so the lead lands on the real footprint pin) or a
 * fallback at the given fraction of the bounds -- the logicInternal.ts `anchor()` / drawDetailOA
 * `pick()` pattern. `frag` is matched as a substring so a label like "IN+" still resolves; the
 * caller passes the unambiguous fragment.
 */
function anchor(
  o: DetailOpts,
  frag: string,
  fx: number,
  fy: number,
): { x: number; y: number } {
  const hit = o.anchors?.find((p) => p.label.includes(frag));
  return hit
    ? { x: hit.x, y: hit.y }
    : { x: fx * o.bounds.hw, y: fy * o.bounds.hh };
}

/** Match the IN- input only (a label that has "IN" but not "+"), so it never collides with IN+. */
function pickInMinus(
  o: DetailOpts,
  fx: number,
  fy: number,
): { x: number; y: number } {
  const hit = o.anchors?.find(
    (p) => p.label.includes("IN") && !p.label.includes("+"),
  );
  return hit
    ? { x: hit.x, y: hit.y }
    : { x: fx * o.bounds.hw, y: fy * o.bounds.hh };
}

/**
 * A single small MOSFET cell: a channel bar + a gate stub on its left, lit by `on`. A compact
 * mirror of logicInternal.ts's `mos()` so the transmission gate / discharge transistors read as
 * real valves. Centred at (x, y), half-size `r`.
 */
function mosCell(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  on: boolean,
  color: number,
): void {
  const lit = on ? color : mix(PALETTE.rail, color, 0.18);
  g.roundRect(x - r * 0.5, y - r, r, 2 * r, 1.5)
    .fill({ color: mix(0x141022, lit, on ? 0.5 : 0.16), alpha: 0.95 })
    .stroke({ width: 1, color: lit, alpha: 0.9 });
  g.moveTo(x - r * 1.1, y)
    .lineTo(x - r * 0.5, y)
    .stroke({ width: 1, color: lit, alpha: 0.85 });
}

// ============================================================================
// Comparator (CMP) -- the latched-comparator device tier (comparator-ic.html t4). A long-tailed
// NMOS DIFFERENTIAL PAIR (gates IN+ / IN-) shares a constant tail current to GND; whichever input
// sits higher steals the tail, and a REGENERATIVE cross-coupled latch snaps that tiny imbalance to
// a full rail, which an output stage drives out to OUT. Unlike the linear op-amp the decision is
// hard (rail-to-rail); the optional input HYSTERESIS band (value = V_H) is the Schmitt identity.
//
// Live mapping (CMP ElectricalState: current = Iout on OUT, vAcross = V(OUT)-V(IN-); value = V_H):
//   - decision = sign(vAcross)        -> which input side hogs the tail (region glow) + the latch
//     state; |vAcross|/rail sets how hard it has snapped.
//   - drive    = norm(|Iout|)         -> the output belt off the latch to OUT; sign = belt dir.
//   - hyst     = value                -> the width of the Schmitt band drawn at the inputs.
// Anchors: IN+, IN-, OUT, VCC, GND.
// ============================================================================
function drawComparator(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const POS = PALETTE.pos; // IN+ identity (cyan)
  const NEG = PALETTE.neg; // IN- identity (warm)
  const OUT = PALETTE.out; // output identity (rose)
  const RAIL = PALETTE.rail;

  const railV = o.value && o.value > 0.5 ? o.value : OUT_SCALE;
  const swing = Math.max(-1, Math.min(1, o.electrical.vAcross / railV));
  // High when OUT is above IN- (the +side won); the latch glow follows the decision.
  const high = swing >= 0;
  const decided = Math.abs(swing); // how hard it has snapped to a rail (0..1)
  const drive = norm(o.electrical.current, CUR_SCALE);
  const driveDir = o.electrical.current >= 0 ? 1 : -1;
  // The tail current crowds into the winning side: f into Q+, (1-f) into Q-.
  const f = 0.5 + 0.5 * swing;
  const rL = f;
  const rR = 1 - f;
  const hyst = o.value ? Math.max(0, Math.min(1, o.value / 0.5)) : 0; // V_H legibility

  // Pins.
  const IP = anchor(o, "+", -0.62, -0.62);
  const IM = pickInMinus(o, -0.62, 0.62);
  const OU = anchor(o, "OUT", 0.62, 0);
  const VC = anchor(o, "VCC", 0, -0.92);
  const GN = anchor(o, "GND", 0, 0.92);

  // --- geometry ----------------------------------------------------------------
  const ySup = -hh * 0.78; // +rail
  const yGnd = hh * 0.86; // GND / tail return
  const qpx = -hw * 0.4; // diff-pair Q+ column
  const qnx = -hw * 0.04; // diff-pair Q- column
  const regHW = hw * 0.12;
  const yC0 = -hh * 0.34; // collector top
  const yE1 = hh * 0.22; // emitter bottom
  const tailX = (qpx + qnx) / 2;
  const yTail = hh * 0.4;
  const latchX = hw * 0.34; // the regenerative latch / output column

  // --- rails -------------------------------------------------------------------
  g.moveTo(-hw * 0.92, ySup)
    .lineTo(hw * 0.92, ySup)
    .stroke({ width: 2.4, color: RAIL, alpha: 0.85 });
  g.moveTo(-hw * 0.92, yGnd)
    .lineTo(hw * 0.92, yGnd)
    .stroke({ width: 2.4, color: RAIL, alpha: 0.85 });
  g.moveTo(VC.x, VC.y)
    .lineTo(VC.x, ySup)
    .stroke({ width: 1.6, color: RAIL, alpha: 0.6 });
  g.moveTo(GN.x, GN.y)
    .lineTo(GN.x, yGnd)
    .stroke({ width: 1.6, color: RAIL, alpha: 0.6 });

  // --- input leads to the two gates --------------------------------------------
  g.moveTo(IP.x, IP.y)
    .lineTo(qpx - regHW - 4, IP.y)
    .lineTo(qpx - regHW - 4, 0)
    .lineTo(qpx - regHW, 0)
    .stroke({ width: 2, color: POS, alpha: 0.7 });
  g.moveTo(IM.x, IM.y)
    .lineTo(qnx - regHW - 4, IM.y)
    .lineTo(qnx - regHW - 4, 0)
    .lineTo(qnx - regHW, 0)
    .stroke({ width: 2, color: NEG, alpha: 0.7 });

  // --- the two differential-pair transistors -----------------------------------
  for (const [cx, r, col] of [
    [qpx, rL, POS],
    [qnx, rR, NEG],
  ] as const) {
    g.rect(cx - regHW, yC0, regHW * 2, yE1 - yC0).fill({
      color: col,
      alpha: 0.08 + 0.26 * r,
    });
    g.rect(cx - regHW, yC0, regHW * 2, yE1 - yC0).stroke({
      width: 1.4,
      color: 0x4a4470,
      alpha: 0.9,
    });
    // collector up to +rail, emitter down to the shared tail node
    g.moveTo(cx, yC0)
      .lineTo(cx, ySup)
      .stroke({ width: 1.8, color: RAIL, alpha: 0.7 });
    g.moveTo(cx, yE1)
      .lineTo(tailX, yTail)
      .stroke({ width: 1.8, color: RAIL, alpha: 0.7 });
    // gate tap brightens with this side's share
    g.circle(cx - regHW, 0, 2.4).fill({ color: col, alpha: 0.55 + 0.4 * r });
  }

  // --- the constant tail current sink to GND -----------------------------------
  g.circle(tailX, yTail + 16, 10).fill({ color: 0x10131f, alpha: 0.8 });
  g.circle(tailX, yTail + 16, 10).stroke({
    width: 1.5,
    color: RAIL,
    alpha: 0.85,
  });
  g.poly([tailX - 4, yTail + 13, tailX + 4, yTail + 13, tailX, yTail + 8]).fill(
    { color: PALETTE.ok, alpha: 0.85 },
  );
  g.moveTo(tailX, yTail + 26)
    .lineTo(tailX, yGnd)
    .stroke({ width: 1.8, color: RAIL, alpha: 0.7 });

  // --- the regenerative cross-coupled latch (two back-to-back inverters) --------
  // Drawn as a pair of cells whose bubbles cross-wire; the WINNING side lights hot.
  const latchCol = high ? POS : NEG;
  const lyT = -hh * 0.2;
  const lyB = hh * 0.2;
  const lr = Math.max(5, Math.min(hw, hh) * 0.08);
  mosCell(g, latchX, lyT, lr, !high, NEG);
  mosCell(g, latchX, lyB, lr, high, POS);
  // cross-coupling links (each cell's output feeds the other's gate)
  g.moveTo(latchX - lr * 1.1, lyT)
    .lineTo(latchX - lr * 2.0, lyT)
    .lineTo(latchX - lr * 2.0, lyB)
    .lineTo(latchX - lr * 1.1, lyB)
    .stroke({ width: 1.2, color: mix(RAIL, latchCol, 0.4), alpha: 0.6 });
  // a regeneration glow on the settled node
  if (decided > 0.05) {
    const breathe = 0.8 + 0.2 * Math.sin(o.phase * PULSE_K);
    g.circle(latchX, high ? lyB : lyT, lr * (1.4 + 0.6 * decided)).fill({
      color: latchCol,
      alpha: 0.12 * (0.4 + 0.6 * decided) * breathe,
    });
  }
  // feed from the diff-pair Q- collector into the latch input
  g.moveTo(qnx + regHW, yC0 + 6)
    .lineTo(latchX - lr * 0.5, yC0 + 6)
    .lineTo(latchX - lr * 0.5, lyT)
    .stroke({ width: 1.6, color: mix(RAIL, latchCol, 0.5), alpha: 0.5 });

  // --- the Schmitt hysteresis band note at the inputs --------------------------
  if (hyst > 0.02) {
    const hbx = qpx - regHW - 10;
    const hbh = hh * 0.1 * (0.4 + 0.6 * hyst);
    g.moveTo(hbx - 5, 0 + hbh)
      .lineTo(hbx, 0 + hbh)
      .lineTo(hbx, 0 - hbh)
      .lineTo(hbx + 5, 0 - hbh)
      .stroke({
        width: 1.4,
        color: mix(PALETTE.dim, OUT, 0.5),
        alpha: 0.4 + 0.4 * hyst,
      });
  }

  // --- output stage: latch -> OUT, the drive belt ------------------------------
  g.moveTo(latchX + lr * 0.6, high ? lyB : lyT)
    .lineTo(latchX + lr * 1.6, 0)
    .lineTo(OU.x, OU.y)
    .stroke({ width: 2, color: OUT, alpha: 0.5 + 0.3 * decided });

  // --- electron streams: tail up, split up each transistor, output belt --------
  belt(g, tailX, yGnd, tailX, yTail, 0.6, 1, o.phase, PALETTE.ok, 3);
  belt(g, qpx, yE1, qpx, ySup, rL, 1, o.phase, ELEC, 3);
  belt(g, qnx, yE1, qnx, ySup, rR, 1, o.phase, ELEC, 3);
  belt(g, latchX + lr * 1.6, 0, OU.x, OU.y, drive, driveDir, o.phase, OUT, 3.2);
}

// ============================================================================
// Clocked sampler (SAMP) -- the sample-and-hold device tier (sampler-ic.html t2/t4). A CLK-gated
// sampling SWITCH connects the analog input IN to a HOLD CAPACITOR; on each clock the switch
// closes ("track"), the cap charges to V(IN), then the switch opens ("hold") freezing that level,
// which a BUFFER reads out and thresholds against an on-chip reference (value = threshold V) to
// drive the digital OUT. The classic acquire-then-quantize chain.
//
// Live mapping (SAMP ElectricalState: current = Iout on OUT; value = threshold V):
//   - drive  = norm(|Iout|)            -> the output belt off the buffer to OUT; sign = dir.
//   - clock  = cos(phase)              -> the sample switch opening (hold) / closing (track), a
//     cosmetic gate animation on the bounded phase (never encodes magnitude).
//   - hold   = the cap fill            -> reads the buffer output level (drive) as the held charge.
// Anchors: IN, CLK, OUT. (No VCC / GND pins on this part.)
// ============================================================================
function drawSampler(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const INC = PALETTE.cyan; // analog input identity
  const CLKC = PALETTE.violet; // clock identity
  const OUT = PALETTE.out;
  const RAIL = PALETTE.rail;

  const drive = norm(o.electrical.current, CUR_SCALE);
  const driveDir = o.electrical.current >= 0 ? 1 : -1;
  // Cosmetic track/hold gate on the bounded phase: >0 = tracking (switch closed).
  const tracking = Math.sin(o.phase * PULSE_K) >= 0;
  const held = drive; // the held level proxy (the buffer's drive)

  // Pins.
  const IN = anchor(o, "IN", -0.62, -0.55);
  const CK = anchor(o, "CLK", -0.62, 0.55);
  const OU = anchor(o, "OUT", 0.62, 0);

  const busY = 0;
  const swX = -hw * 0.34; // sampling switch
  const capX = hw * 0.04; // hold capacitor node
  const bufX = hw * 0.34; // buffer
  const capTop = -hh * 0.12;
  const capBot = hh * 0.5;
  const gndY = hh * 0.74;

  // --- input lead to the switch ------------------------------------------------
  g.moveTo(IN.x, IN.y)
    .lineTo(swX - 14, IN.y)
    .lineTo(swX - 14, busY)
    .lineTo(swX - 8, busY)
    .stroke({ width: 2, color: INC, alpha: 0.75 });

  // --- the CLK-gated sampling switch (a tilting blade) -------------------------
  g.circle(swX - 8, busY, 2.4).fill({ color: INC });
  g.circle(swX + 8, busY, 2.4).fill({ color: OUT });
  const bladeTipY = tracking ? busY : busY - 10; // lifts off when holding
  g.moveTo(swX - 8, busY)
    .lineTo(swX + 8, bladeTipY)
    .stroke({
      width: 2.4,
      color: tracking ? PALETTE.ok : RAIL,
      alpha: 0.95,
    });
  // CLK pilots the blade (dashed control line down from the CLK pin)
  g.moveTo(CK.x, CK.y)
    .lineTo(swX, CK.y)
    .lineTo(swX, busY + 4)
    .stroke({ width: 1.6, color: CLKC, alpha: 0.55 });
  // a rising-edge tick by the CLK pin
  g.moveTo(CK.x + 4, CK.y + 3)
    .lineTo(CK.x + 7, CK.y + 3)
    .lineTo(CK.x + 7, CK.y - 3)
    .lineTo(CK.x + 10, CK.y - 3)
    .stroke({ width: 1.4, color: CLKC, alpha: 0.7 });

  // --- the hold capacitor (two plates to GND) ----------------------------------
  g.moveTo(swX + 8, busY)
    .lineTo(capX, busY)
    .lineTo(capX, capTop)
    .stroke({ width: 2, color: OUT, alpha: 0.7 });
  const plateW = hw * 0.14;
  const pgap = 6;
  g.moveTo(capX - plateW, capTop)
    .lineTo(capX + plateW, capTop)
    .stroke({ width: 3, color: mix(PALETTE.dim, 0xffffff, 0.4), alpha: 0.9 });
  g.moveTo(capX - plateW, capTop + pgap)
    .lineTo(capX + plateW, capTop + pgap)
    .stroke({ width: 3, color: mix(PALETTE.dim, 0xffffff, 0.4), alpha: 0.9 });
  // dielectric charge fill between the plates, riding the held level
  if (held > 0.02) {
    g.rect(capX - plateW + 2, capTop + 1, (plateW - 2) * 2, pgap - 2).fill({
      color: OUT,
      alpha: 0.12 + 0.5 * held,
    });
  }
  g.moveTo(capX, capTop + pgap)
    .lineTo(capX, capBot)
    .lineTo(capX, gndY)
    .stroke({ width: 2, color: RAIL, alpha: 0.6 });
  // a little ground symbol
  for (let k = 0; k < 3; k++) {
    const w = 9 - k * 3;
    g.moveTo(capX - w, gndY + k * 3)
      .lineTo(capX + w, gndY + k * 3)
      .stroke({ width: 1.4, color: RAIL, alpha: 0.7 });
  }

  // --- the buffer (a triangle reading the held node), thresholding it ----------
  const bt = hh * 0.2;
  g.moveTo(bufX - bt * 0.7, -bt)
    .lineTo(bufX + bt, busY)
    .lineTo(bufX - bt * 0.7, bt)
    .closePath()
    .fill({ color: OUT, alpha: 0.1 + 0.18 * held })
    .stroke({ width: 2, color: OUT, alpha: 0.9 });
  // tap from the hold node into the buffer input
  g.moveTo(capX, busY)
    .lineTo(bufX - bt * 0.7, busY)
    .stroke({ width: 1.8, color: mix(RAIL, OUT, 0.5), alpha: 0.55 });
  // a small threshold reference tick on the buffer input
  g.moveTo(bufX - bt * 0.7 + 2, -3)
    .lineTo(bufX - bt * 0.7 + 8, -3)
    .stroke({ width: 1.4, color: OUT, alpha: 0.6 });

  // --- output drive to OUT -----------------------------------------------------
  g.moveTo(bufX + bt, busY)
    .lineTo(OU.x, OU.y)
    .stroke({ width: 2, color: OUT, alpha: 0.5 + 0.3 * held });

  // --- carriers: IN -> switch (only while tracking), buffer -> OUT -------------
  if (tracking) {
    belt(g, swX - 8, busY, capX, busY, drive, 1, o.phase, ELEC, 2.6);
  }
  belt(g, bufX + bt, busY, OU.x, OU.y, drive, driveDir, o.phase, OUT, 3.0);
}

// ============================================================================
// Analog switch (ASW) -- the CMOS transmission-gate device tier (analog-switch-ic.html t3/t4). Two
// MOSFET valves in PARALLEL bridge A<->B: an NMOS (gate driven by CTRL) and a PMOS (gate driven by
// NOT-CTRL). When CTRL is high both turn on and the pair passes the full analog swing with a low
// R_on (value); when CTRL is low both shut and the path is open. The complementary pair is what
// keeps R_on flat across the whole signal range (each device covers where the other dies).
//
// Live mapping (ASW ElectricalState: current = I(A->B), vAcross ~ 0 closed / full node diff open;
// value = R_on):
//   - closed = |vAcross| small         -> both valves lit + the channel passes; else open/dark.
//   - cond   = norm(|I|)               -> the through-stream density/alpha on both valves.
//   - dir    = sign(I)                 -> the bidirectional flow direction A<->B.
// Anchors: A, B, CTRL, VCC, GND.
// ============================================================================
function drawAnalogSwitch(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const SIG = PALETTE.cyan; // signal path identity
  const CTL = PALETTE.violet; // control identity
  const RAIL = PALETTE.rail;

  // A conducting switch drops ~0 V across A<->B; an open one stands the full node diff.
  const closed = Math.abs(o.electrical.vAcross) < 0.25;
  const cond = norm(o.electrical.current, CUR_SCALE);
  const dir = o.electrical.current >= 0 ? 1 : -1;

  // Pins.
  const A = anchor(o, "A", -0.62, 0);
  const B = anchor(o, "B", 0.62, 0);
  const CT = anchor(o, "CTRL", -0.62, 0.62);
  const VC = anchor(o, "VCC", 0, -0.92);
  const GN = anchor(o, "GND", 0, 0.92);

  const busY = 0;
  const inX = -hw * 0.34; // left contact (A side)
  const outX = hw * 0.34; // right contact (B side)
  const nY = -hh * 0.26; // NMOS valve lane (upper)
  const pY = hh * 0.26; // PMOS valve lane (lower)
  const ySup = -hh * 0.82;
  const yGnd = hh * 0.82;
  const r = Math.max(5, Math.min(hw, hh) * 0.1);

  // --- power rails (the gate drive comes from these) ---------------------------
  g.moveTo(-hw * 0.92, ySup)
    .lineTo(hw * 0.92, ySup)
    .stroke({ width: 2, color: RAIL, alpha: 0.7 });
  g.moveTo(-hw * 0.92, yGnd)
    .lineTo(hw * 0.92, yGnd)
    .stroke({ width: 2, color: RAIL, alpha: 0.7 });
  g.moveTo(VC.x, VC.y)
    .lineTo(VC.x, ySup)
    .stroke({ width: 1.4, color: RAIL, alpha: 0.6 });
  g.moveTo(GN.x, GN.y)
    .lineTo(GN.x, yGnd)
    .stroke({ width: 1.4, color: RAIL, alpha: 0.6 });

  // --- the A and B contacts + the leads in ------------------------------------
  g.moveTo(A.x, A.y)
    .lineTo(inX, busY)
    .stroke({ width: 2.4, color: SIG, alpha: 0.8 });
  g.moveTo(outX, busY)
    .lineTo(B.x, B.y)
    .stroke({ width: 2.4, color: SIG, alpha: 0.8 });
  g.circle(inX, busY, 2.6).fill({ color: SIG });
  g.circle(outX, busY, 2.6).fill({ color: SIG });

  // --- the two parallel valves (NMOS upper, PMOS lower) ------------------------
  // Each valve bridges the A node to the B node through its channel.
  for (const [vy, on, col, label] of [
    [nY, closed, ELEC, "N"],
    [pY, closed, HOLE, "P"],
  ] as const) {
    void label;
    // contact stubs from the A / B nodes up/down into the valve lane
    g.moveTo(inX, busY)
      .lineTo(inX, vy)
      .lineTo(-r, vy)
      .stroke({ width: 1.6, color: mix(RAIL, col, 0.4), alpha: 0.55 });
    g.moveTo(outX, busY)
      .lineTo(outX, vy)
      .lineTo(r, vy)
      .stroke({ width: 1.6, color: mix(RAIL, col, 0.4), alpha: 0.55 });
    // the valve cell itself
    mosCell(g, 0, vy, r, on, col);
    // the open channel bar between the contacts when conducting
    if (closed) {
      g.roundRect(-r, vy - 2.5, 2 * r, 5, 2).fill({
        color: col,
        alpha: 0.18 + 0.4 * cond,
      });
    }
  }

  // --- CTRL drives the NMOS gate directly, the PMOS gate via an inverter -------
  // CTRL line in, branching to the NMOS gate (direct) and through a bubble to the PMOS gate.
  g.moveTo(CT.x, CT.y)
    .lineTo(-hw * 0.5, CT.y)
    .lineTo(-hw * 0.5, (nY + pY) / 2)
    .stroke({ width: 1.8, color: CTL, alpha: 0.7 });
  // direct branch to the NMOS gate stub
  g.moveTo(-hw * 0.5, nY)
    .lineTo(-r * 1.1, nY)
    .stroke({ width: 1.4, color: CTL, alpha: closed ? 0.8 : 0.4 });
  // inverter bubble feeding the PMOS gate (NOT-CTRL)
  const invX = -hw * 0.5;
  g.circle(invX, pY, r * 0.34)
    .fill({ color: mix(0x141022, CTL, 0.3) })
    .stroke({ width: 1, color: CTL, alpha: 0.85 });
  g.moveTo(invX + r * 0.34, pY)
    .lineTo(-r * 1.1, pY)
    .stroke({ width: 1.4, color: CTL, alpha: closed ? 0.8 : 0.4 });

  // --- the through-stream on both valves (bidirectional), only when closed -----
  if (closed && cond > 0.02) {
    belt(g, -r, nY, r, nY, cond, dir, o.phase, ELEC, 2.6);
    belt(g, -r, pY, r, pY, cond, dir, o.phase, HOLE, 2.6);
    // the merged A<->B lead current
    belt(
      g,
      A.x,
      A.y,
      inX,
      busY,
      cond,
      dir,
      o.phase,
      mix(SIG, 0xffffff, 0.2),
      2.6,
    );
    belt(
      g,
      outX,
      busY,
      B.x,
      B.y,
      cond,
      dir,
      o.phase,
      mix(SIG, 0xffffff, 0.2),
      2.6,
    );
  }
}

/**
 * Dispatch to the right special-IC internal drawer by `o.kind`. A no-op for any kind not in
 * {@link SPECIAL_INTERNAL_KINDS} (the parent only calls this for those kinds). Pure presentation,
 * animated from the live `electrical` + `phase`; never touches the sim.
 */
export function drawSpecialInternal(g: Graphics, o: DetailOpts): void {
  switch (o.kind) {
    case "CMP":
      drawComparator(g, o);
      break;
    case "SAMP":
      drawSampler(g, o);
      break;
    case "ASW":
      drawAnalogSwitch(g, o);
      break;
    default:
      break;
  }
}

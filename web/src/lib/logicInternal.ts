// SPDX-License-Identifier: Apache-2.0
// In-app INTERNAL VIEW for the basic logic gates — the reality/device tier the gate refsheets
// (and-ic.html, nand-ic.html, …) teach: a CMOS pull-up / pull-down pair. Plugs into the existing
// tier-zoom system (registered in DETAIL_DRAWERS), so a gate zoomed in under the reality lens opens
// to this instead of the flat symbol. Pure presentation, animated from the live ElectricalState:
// the gate's output level (vAcross / rail) lights whichever network is currently pulling the output
// — PUN (to VCC) when the output is high, PDN (to GND) when low — and the output drive feeds the
// belt out to Y. (The refsheets stay the codex reference; this is the in-board redraw of their
// device tier, in the house style via tierKit.)
import { Graphics } from "pixi.js";
import { PALETTE } from "./graph";
import { type TierOpts as DetailOpts, mix, norm, CUR_SCALE } from "./tierKit";

// Gate function codes (mirror GATE_AUX in netlist.ts).
const FUNC: Record<string, number> = {
  AND: 0,
  OR: 1,
  NAND: 2,
  NOR: 3,
  XOR: 4,
  XNOR: 5,
  NOT: 6,
  BUF: 7,
  IMPLY: 8,
  NIMPLY: 9,
  NAND3: 2, // 3-input NAND — drawn as the NAND topology with 3 inputs
  XORPASS: 4, // pass-transistor XOR — drawn as the XOR cell
};

/** The gate kinds this module supplies an internal view for. */
export const GATE_INTERNAL_KINDS = Object.keys(FUNC);

// Per-function CMOS topology: input count, whether the pull-up / pull-down nets are series or
// parallel, and whether the output is inverting (gets a bubble). AND/OR are the inverting core
// plus an output inverter stage; XOR/XNOR are a compound cell (shown abstractly as a 2-net pair).
interface Topo {
  nIn: number;
  punSeries: boolean; // PMOS pull-up network: series (NOR-like) vs parallel (NAND-like)
  inverting: boolean; // output bubble
  stage2: boolean; // AND/OR: an extra inverter stage after the inverting core
}
function topo(func: number, nIn: number): Topo {
  switch (func) {
    case 6: // NOT
      return { nIn: 1, punSeries: false, inverting: true, stage2: false };
    case 7: // BUF
      return { nIn: 1, punSeries: false, inverting: false, stage2: true };
    case 2: // NAND (PUN parallel, PDN series)
      return { nIn, punSeries: false, inverting: true, stage2: false };
    case 3: // NOR (PUN series, PDN parallel)
      return { nIn, punSeries: true, inverting: true, stage2: false };
    case 0: // AND = NAND + inverter
      return { nIn, punSeries: false, inverting: false, stage2: true };
    case 1: // OR = NOR + inverter
      return { nIn, punSeries: true, inverting: false, stage2: true };
    case 4: // XOR
    case 5: // XNOR
      return { nIn: 2, punSeries: false, inverting: func === 5, stage2: false };
    default: // IMPLY / NIMPLY and any other 2-in cell
      return { nIn: 2, punSeries: false, inverting: func === 9, stage2: false };
  }
}

/** Draw a single MOSFET symbol (a channel bar + gate stub) centred at (x, y). */
function mos(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  on: boolean,
  color: number,
): void {
  const lit = on ? color : mix(PALETTE.rail, color, 0.18);
  // channel bar
  g.roundRect(x - r * 0.5, y - r, r, 2 * r, 1.5)
    .fill({ color: mix(0x141022, lit, on ? 0.5 : 0.16), alpha: 0.95 })
    .stroke({ width: 1, color: lit, alpha: 0.9 });
  // gate stub
  g.moveTo(x - r * 1.1, y)
    .lineTo(x - r * 0.5, y)
    .stroke({ width: 1, color: lit, alpha: 0.85 });
}

/**
 * Draw a gate's CMOS internal (pull-up over pull-down) into the pre-cleared Graphics, live-lit by
 * the output level. Anchors the output to the Y pin and the supply/ground to VCC/GND when the host
 * supplies pin anchors; otherwise uses default edge placement.
 */
export function drawGateInternal(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const func = FUNC[o.kind] ?? 0;
  const nIn = o.kind === "NAND3" ? 3 : 2;
  const t = topo(func, nIn);

  const rail = o.value && o.value > 0.5 ? o.value : 5;
  const outHi = Math.max(0, Math.min(1, o.electrical.vAcross / rail));
  const drive = norm(o.electrical.current, CUR_SCALE);

  const VCC = PALETTE.bad; // +rail identity (red), matching the bus colour code
  const GND = PALETTE.rail;
  const HOT = PALETTE.cyan;

  const anchor = (
    frag: string,
    fx: number,
    fy: number,
  ): { x: number; y: number } => {
    const hit = o.anchors?.find((p) => p.label.toUpperCase().includes(frag));
    return hit ? { x: hit.x, y: hit.y } : { x: fx * hw, y: fy * hh };
  };
  const yVcc = -hh * 0.82;
  const yGnd = hh * 0.82;
  const outX = hw * 0.34;
  const outY = 0;

  // Supply + ground rails.
  g.moveTo(-hw * 0.9, yVcc)
    .lineTo(hw * 0.9, yVcc)
    .stroke({ width: 2, color: VCC, alpha: 0.7 });
  g.moveTo(-hw * 0.9, yGnd)
    .lineTo(hw * 0.9, yGnd)
    .stroke({ width: 2, color: GND, alpha: 0.7 });

  const r = Math.max(5, Math.min(hw, hh) * 0.1);
  // Pull-up network (PMOS, to VCC) lit when the output is HIGH; pull-down (NMOS, to GND) when LOW.
  const punOn = outHi > 0.5;
  const pdnOn = outHi <= 0.5;
  const punCx = -hw * 0.1;
  const layout = (
    series: boolean,
    top: boolean,
  ): { x: number; y: number }[] => {
    const pts: { x: number; y: number }[] = [];
    const yBase = top ? yVcc + r * 1.6 : yGnd - r * 1.6;
    const ySpan = top ? hh * 0.28 : -hh * 0.28;
    for (let i = 0; i < t.nIn; i++) {
      if (series)
        pts.push({ x: punCx, y: yBase + (ySpan * i) / Math.max(1, t.nIn - 1) });
      else pts.push({ x: punCx + (i - (t.nIn - 1) / 2) * r * 1.8, y: yBase });
    }
    return pts;
  };
  for (const p of layout(t.punSeries, true)) mos(g, p.x, p.y, r, punOn, VCC);
  for (const p of layout(!t.punSeries, false)) mos(g, p.x, p.y, r, pdnOn, HOT);

  // The pulled OUT node + its wire to VCC (when high) or GND (when low), lit by the active net.
  const pullColor = punOn ? VCC : HOT;
  g.moveTo(punCx, punOn ? yVcc : yGnd)
    .lineTo(punCx, outY)
    .lineTo(outX, outY)
    .stroke({
      width: 1.6,
      color: pullColor,
      alpha: 0.5 + 0.4 * Math.abs(outHi - 0.5) * 2,
    });

  // Inverting bubble at the output.
  if (t.inverting) {
    g.circle(outX + r * 0.5, outY, r * 0.4)
      .fill({ color: mix(0x141022, pullColor, 0.3) })
      .stroke({ width: 1, color: pullColor, alpha: 0.9 });
  }

  // OUT node + the drive belt out to the Y pin.
  const Y = anchor("Y", 0.92, 0);
  g.circle(outX, outY, 2).fill({ color: mix(GND, HOT, outHi) });
  g.moveTo(outX + (t.inverting ? r : 0), outY)
    .lineTo(Y.x, Y.y)
    .stroke({
      width: 1.4,
      color: mix(PALETTE.rail, HOT, outHi),
      alpha: 0.5 + 0.4 * drive,
    });

  // Input lines from the A/B(/C) pins to the networks' gate stubs.
  const inLabels =
    t.nIn === 1 ? ["A"] : t.nIn === 3 ? ["A", "B", "C"] : ["A", "B"];
  for (let i = 0; i < inLabels.length; i++) {
    const a = anchor(
      inLabels[i]!,
      -0.92,
      (i - (inLabels.length - 1) / 2) * 0.6,
    );
    g.moveTo(a.x, a.y)
      .lineTo(punCx - r * 1.3, a.y)
      .stroke({ width: 1.2, color: mix(PALETTE.rail, HOT, 0.5), alpha: 0.5 });
  }

  // Supply / ground anchor stubs.
  const vcc = anchor("VCC", 0, -0.95);
  const gnd = anchor("GND", 0, 0.95);
  g.moveTo(vcc.x, vcc.y)
    .lineTo(vcc.x, yVcc)
    .stroke({ width: 1.4, color: VCC, alpha: 0.6 });
  g.moveTo(gnd.x, gnd.y)
    .lineTo(gnd.x, yGnd)
    .stroke({ width: 1.4, color: GND, alpha: 0.6 });

  // The extra inverter stage for AND/OR (the non-inverting families).
  if (t.stage2) {
    g.circle(outX + r * 0.5, outY, r * 0.4)
      .fill({ color: mix(0x141022, HOT, 0.3) })
      .stroke({ width: 1, color: HOT, alpha: 0.7 });
  }
}

// SPDX-License-Identifier: Apache-2.0
// Pinout geometry for the info panel: a labelled, oriented terminal diagram built
// purely from a kind's `PART_KINDS.pins` and the placed part's rotation. It is
// reference, not telemetry — a pure function of (kind, rot), with no live
// `ElectricalState` and nothing that touches the sim, the netlist, or the golden.
// The HUD renders the returned coordinates as an SVG body + dots + leader lines
// with DOM text labels (so they stay selectable / screen-reader legible).

import { PART_KINDS, PALETTE, rotateOffset } from "./graph";

/** One terminal in the laid-out diagram. Coordinates are in SVG/px units. */
export interface PinoutPin {
  label: string;
  /** Short human meaning of this leg, or "" when none is authored for the kind. */
  gloss: string;
  /** The pin dot. */
  x: number;
  y: number;
  /** Where the text label anchors (just outside the dot, away from the body). */
  lx: number;
  ly: number;
  /** CSS transform to position the label box relative to (lx, ly). */
  tx: string;
  ty: string;
}

export interface Pinout {
  pins: PinoutPin[];
  /** The package silhouette rectangle (rounded in the view). */
  body: { x: number; y: number; w: number; h: number };
  width: number;
  height: number;
  /** Kind accent as a CSS hex string, e.g. "#46d2e6". */
  color: string;
}

// One grid cell → this many px in the diagram; margin leaves room for labels.
const CELL = 30;
const MARGIN = 46;
const LABEL_GAP = 20;

// Per-kind, per-label glosses for the parts where the leg identity *is* the
// lesson. Anything absent simply shows its bare label (never a wrong gloss).
const DIODE = { A: "anode", K: "cathode" };
const MOSFET = { D: "drain", S: "source", G: "gate" };
const BJT = { C: "collector", E: "emitter", B: "base" };
const GATE = {
  Y: "output",
  A: "input A",
  B: "input B",
  VCC: "power + (supply rail)",
  GND: "power − (0 V)",
};
const GATE1 = {
  Y: "output",
  A: "input",
  NC: "no-connect",
  VCC: "power + (supply rail)",
  GND: "power − (0 V)",
};
const GLOSS: Record<string, Record<string, string>> = {
  D: DIODE,
  SD: DIODE,
  LED: DIODE,
  ZD: DIODE,
  NM: MOSFET,
  PM: MOSFET,
  Q: BJT,
  QP: BJT,
  OA: { OUT: "output", "IN−": "inverting in", "IN+": "non-inverting in" },
  V: { "+": "positive", "−": "negative" },
  I: { A: "current out", B: "current in" },
  EC: { "+": "+ anode (polarity!)", "−": "− cathode" },
  TR: {
    "P+": "primary +",
    "P−": "primary −",
    "S+": "secondary +",
    "S−": "secondary −",
  },
  POT: { A: "end A", B: "end B", W: "wiper" },
  FF: { Q: "output", Q̅: "inverted out", D: "data in", CLK: "clock" },
  AND: GATE,
  OR: GATE,
  NAND: GATE,
  NOR: GATE,
  XOR: GATE,
  XNOR: GATE,
  NOT: GATE1,
  BUF: GATE1,
  LS: { OUT: "shifted output (rail B)", IN: "input (rail A)" },
  PU: { "●": "to the net (pulls up to Vcc)" },
};

/**
 * Lay out the pinout for a kind at a given rotation, or `null` for an unknown /
 * pinless kind. Pins are rotated to match the placed part's orientation, centred,
 * and scaled to px; each gets a dot, an outward-pointing label anchor, and a CSS
 * transform that flips the label box to the correct side.
 */
export function pinoutOf(kind: string, rot: number): Pinout | null {
  const pk = PART_KINDS[kind];
  if (!pk || pk.pins.length === 0) return null;

  const pos = pk.pins.map((p) => {
    const r = rotateOffset(p.dx, p.dy, rot);
    return { label: p.label, col: r.col, row: r.row };
  });
  const cols = pos.map((p) => p.col);
  const rows = pos.map((p) => p.row);
  const minC = Math.min(...cols);
  const maxC = Math.max(...cols);
  const minR = Math.min(...rows);
  const maxR = Math.max(...rows);
  const cx = (minC + maxC) / 2;
  const cy = (minR + maxR) / 2;

  const toX = (c: number): number => MARGIN + (c - minC) * CELL;
  const toY = (r: number): number => MARGIN + (r - minR) * CELL;
  const width = 2 * MARGIN + (maxC - minC) * CELL;
  const height = 2 * MARGIN + (maxR - minR) * CELL;

  const pins: PinoutPin[] = pos.map((p) => {
    const x = toX(p.col);
    const y = toY(p.row);
    // Outward direction from the body centre; a centred lone pin pushes down.
    let dx = p.col - cx;
    let dy = p.row - cy;
    if (dx === 0 && dy === 0) dy = 1;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    return {
      label: p.label,
      gloss: GLOSS[kind]?.[p.label] ?? "",
      x,
      y,
      lx: x + dx * LABEL_GAP,
      ly: y + dy * LABEL_GAP,
      // Flip the label box to the outward side: right of / left of / over / under.
      tx: dx > 0.3 ? "0" : dx < -0.3 ? "-100%" : "-50%",
      ty: dy > 0.3 ? "0" : dy < -0.3 ? "-100%" : "-50%",
    };
  });

  // Package silhouette: the pin bounding box, inset so the legs poke out, with a
  // floor thickness so a 2-pin (collinear) part still reads as a body, not a line.
  let b0c = minC + 0.45;
  let b1c = maxC - 0.45;
  if (b1c - b0c < 0.7) {
    b0c = cx - 0.4;
    b1c = cx + 0.4;
  }
  let b0r = minR + 0.45;
  let b1r = maxR - 0.45;
  if (b1r - b0r < 0.7) {
    b0r = cy - 0.4;
    b1r = cy + 0.4;
  }
  const body = {
    x: toX(b0c),
    y: toY(b0r),
    w: (b1c - b0c) * CELL,
    h: (b1r - b0r) * CELL,
  };

  const color = "#" + PALETTE[pk.colorKey].toString(16).padStart(6, "0");
  return { pins, body, width, height, color };
}

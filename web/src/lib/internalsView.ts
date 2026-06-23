// SPDX-License-Identifier: Apache-2.0
// Draw the LIVE internal sub-circuit of a sealed composite IC — the "zoom-to-open"
// mini-mode (ADR 0005 phase 2). A composite (a CEC_COMP part: half-adder, mux, JK
// flip-flop, R-2R DAC, …) is simulated as its real discrete sub-elements; this view
// reveals them, wired together, animating from the SAME per-frame snapshot the board
// already reads — node voltages colour the wires by level, the flow clock pulses them.
//
// Self-contained and render-only: it draws an element-and-node graph inside the chip
// footprint, with the package pins anchored at their real board positions so you see
// the inside wired straight out to the boundary pins. No new simulation, no hashing —
// the seal is purely a drawing over the same netlist (ADR 0005 "seal-as-same-netlist").
import { Graphics } from "pixi.js";
import { PALETTE } from "./graph";
import type { CompositeInternals } from "./netlist";

// Sim element type codes (mirror netlist.ts).
const T_RESISTOR = 1;
const T_CAPACITOR = 2;
const T_GATE = 17;
const T_DFF = 19;
const T_ASWITCH = 24;

// Gate function codes (mirror GATE_AUX): the inverting ones get an output bubble.
const INVERTING = new Set([2, 3, 5, 6]); // NAND, NOR, XNOR, NOT
const OR_FAMILY = new Set([1, 3, 4, 5]); // OR, NOR, XOR, XNOR
const EXCLUSIVE = new Set([4, 5]); // XOR, XNOR (extra back arc)

/** Linear blend of two PIXI hex ints, t in [0,1]. */
function mix(a: number, b: number, t: number): number {
  t = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (
    ((Math.round(ar + (br - ar) * t) << 16) |
      (Math.round(ag + (bg - ag) * t) << 8) |
      Math.round(ab + (bb - ab) * t)) >>>
    0
  );
}

export interface InternalsOpts {
  internals: CompositeInternals;
  /** node voltages, indexed by node number (the sim snapshot's `state`). */
  nodeV: Float64Array;
  /** footprint pin positions (glyph-local px), by external pin index. */
  pins: { x: number; y: number }[];
  wPx: number;
  hPx: number;
  /** the board's bounded flow clock, for animating carriers along the wires. */
  phase: number;
  /** the live-signal "hot" colour, skinned by lens (analogy water vs reality electron). */
  accent: number;
}

/** Draw a small logic-gate body centred at (cx, cy). */
function gateSymbol(
  g: Graphics,
  func: number,
  cx: number,
  cy: number,
  r: number,
  fill: number,
  line: number,
): void {
  const L = cx - r;
  const R = cx + r;
  const h = r * 1.7;
  const T = cy - h / 2;
  const B = cy + h / 2;
  if (func === 6 || func === 7) {
    // NOT / BUF: a triangle pointing right.
    g.moveTo(L, T).lineTo(R, cy).lineTo(L, B).closePath();
  } else if (OR_FAMILY.has(func)) {
    // OR / NOR / XOR / XNOR: a curved shield with a concave back.
    g.moveTo(L, T)
      .quadraticCurveTo(cx + r * 0.2, T, R, cy)
      .quadraticCurveTo(cx + r * 0.2, B, L, B)
      .quadraticCurveTo(cx - r * 0.35, cy, L, T)
      .closePath();
  } else {
    // AND / NAND (and any unknown): a D-shape.
    g.moveTo(L, T)
      .lineTo(cx, T)
      .quadraticCurveTo(R, T, R, cy)
      .quadraticCurveTo(R, B, cx, B)
      .lineTo(L, B)
      .closePath();
  }
  g.fill({ color: fill, alpha: 0.97 }).stroke({
    width: 1.1,
    color: line,
    alpha: 0.95,
  });
  if (INVERTING.has(func)) {
    g.circle(R + r * 0.3, cy, r * 0.24)
      .fill({ color: fill, alpha: 0.97 })
      .stroke({ width: 1, color: line, alpha: 0.95 });
  }
  if (EXCLUSIVE.has(func)) {
    g.moveTo(L - r * 0.3, T)
      .quadraticCurveTo(cx - r * 0.65, cy, L - r * 0.3, B)
      .stroke({ width: 1.1, color: line, alpha: 0.85 });
  }
}

/** Draw a non-gate sub-element symbol centred at (cx, cy). */
function partSymbol(
  g: Graphics,
  type: number,
  cx: number,
  cy: number,
  r: number,
  fill: number,
  line: number,
): void {
  if (type === T_RESISTOR) {
    // a zigzag resistor.
    const n = 6;
    const x0 = cx - r;
    const dy = r * 0.55;
    g.moveTo(x0, cy);
    for (let i = 0; i < n; i++) {
      g.lineTo(x0 + (2 * r * (i + 0.5)) / n, cy + (i % 2 === 0 ? -dy : dy));
    }
    g.lineTo(cx + r, cy).stroke({ width: 1.2, color: line, alpha: 0.95 });
    return;
  }
  // DFF / analog switch / capacitor / unknown: a rounded box, with a clock notch for a DFF.
  const w = r * 1.9;
  const hh = r * 1.6;
  g.roundRect(cx - w / 2, cy - hh / 2, w, hh, 1.5)
    .fill({ color: fill, alpha: 0.97 })
    .stroke({ width: 1.1, color: line, alpha: 0.95 });
  if (type === T_DFF) {
    g.moveTo(cx - w / 2, cy - hh * 0.22)
      .lineTo(cx - w / 2 + r * 0.6, cy)
      .lineTo(cx - w / 2, cy + hh * 0.22)
      .stroke({ width: 1, color: line, alpha: 0.9 });
  } else if (type === T_ASWITCH) {
    g.moveTo(cx - w * 0.3, cy + hh * 0.25)
      .lineTo(cx + w * 0.3, cy - hh * 0.25)
      .stroke({ width: 1, color: line, alpha: 0.9 });
  } else if (type === T_CAPACITOR) {
    g.moveTo(cx - r * 0.25, cy - hh / 2).lineTo(cx - r * 0.25, cy + hh / 2);
    g.moveTo(cx + r * 0.25, cy - hh / 2).lineTo(cx + r * 0.25, cy + hh / 2);
    g.stroke({ width: 1.2, color: line, alpha: 0.9 });
  }
}

/**
 * Draw the live internal sub-circuit into `g` (glyph-local coordinates). Pin nodes sit at the real
 * footprint pins; internal nodes and elements are laid out in the interior. Wires colour by node
 * level and carry flow dots; each element draws its symbol tinted by its output level.
 */
export function drawCompositeInternals(g: Graphics, o: InternalsOpts): void {
  const { internals, nodeV, pins, wPx, hPx, phase, accent } = o;
  const { elements, pinNodes, internalNodes, vccNode, gndNode } = internals;
  if (elements.length === 0) return;

  const vAt = (n: number): number => nodeV[n] ?? 0;
  const vlow = vAt(gndNode);
  // Normalise to the live rail: VCC if it is driven, else the peak among the touched nodes (so the
  // R-2R DAC, whose VCC is only nominal, still scales to its actual analog swing). Floored so a
  // quiet chip doesn't blow tiny noise up to full scale.
  let rail = vAt(vccNode) - vlow;
  const touched = [...pinNodes, ...internalNodes];
  for (const n of touched) rail = Math.max(rail, vAt(n) - vlow);
  rail = Math.max(rail, 1);
  const level = (n: number): number =>
    Math.max(0, Math.min(1, (vAt(n) - vlow) / rail));

  // Node positions: pins anchored at the real footprint pins; elements in a centred interior grid;
  // each internal node at the centroid of the elements that touch it.
  const pos = new Map<number, { x: number; y: number }>();
  for (let i = 0; i < pinNodes.length; i++) {
    const p = pins[i];
    if (p) pos.set(pinNodes[i]!, { x: p.x, y: p.y });
  }
  const n = elements.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const insetX = wPx * 0.3;
  const insetY = hPx * 0.28;
  const spanX = Math.max(1, wPx - 2 * insetX);
  const spanY = Math.max(1, hPx - 2 * insetY);
  const ePos = elements.map((_, k) => {
    const c = k % cols;
    const r = Math.floor(k / cols);
    return {
      x: insetX + (cols === 1 ? spanX / 2 : (spanX * c) / (cols - 1)),
      y: insetY + (rows === 1 ? spanY / 2 : (spanY * r) / (rows - 1)),
    };
  });
  for (const inode of internalNodes) {
    let sx = 0;
    let sy = 0;
    let cnt = 0;
    elements.forEach((el, k) => {
      if (el.nodes.includes(inode)) {
        sx += ePos[k]!.x;
        sy += ePos[k]!.y;
        cnt++;
      }
    });
    pos.set(
      inode,
      cnt ? { x: sx / cnt, y: sy / cnt } : { x: wPx / 2, y: hPx / 2 },
    );
  }

  const sym = Math.max(3, Math.min(wPx, hPx) * 0.11); // element symbol half-size

  // Wires: element terminal -> its node. For a gate, terminal 0 is the output (flows outward),
  // 1 and 2 are inputs (flow inward); other terminals (power) are skipped. For a two-terminal part
  // the first three terminals are drawn. Colour + flow track the node's live level.
  for (let k = 0; k < elements.length; k++) {
    const el = elements[k]!;
    const ep = ePos[k]!;
    const isGate = el.type === T_GATE;
    // How many terminals actually carry signal: a gate uses out + 2 ins; a DFF/switch 3; a
    // two-terminal part (resistor/cap) only a/b. The unused terminals hold filler node refs (the
    // core ignores them), so drawing them would add phantom wires — cap the loop per type.
    const nTerm = isGate || el.type === T_DFF || el.type === T_ASWITCH ? 3 : 2;
    for (let ti = 0; ti < nTerm; ti++) {
      const nd = el.nodes[ti];
      if (nd === undefined) continue;
      const np = pos.get(nd);
      if (!np) continue;
      const lv = level(nd);
      const col = mix(PALETTE.rail, accent, lv);
      g.moveTo(ep.x, ep.y)
        .lineTo(np.x, np.y)
        .stroke({ width: 1.3, color: col, alpha: 0.45 + 0.45 * lv });
      if (lv > 0.12) {
        const outward = !isGate || ti === 0;
        const ax = outward ? ep.x : np.x;
        const ay = outward ? ep.y : np.y;
        const bx = outward ? np.x : ep.x;
        const by = outward ? np.y : ep.y;
        for (let d = 0; d < 3; d++) {
          const f = (((phase * 0.6 + d / 3) % 1) + 1) % 1;
          g.circle(ax + (bx - ax) * f, ay + (by - ay) * f, 0.9).fill({
            color: accent,
            alpha: 0.75 * lv,
          });
        }
      }
    }
  }

  // Node dots (pins + internal), coloured by level.
  for (const [, p] of pos) {
    g.circle(p.x, p.y, 1.4).fill({ color: PALETTE.dim, alpha: 0.7 });
  }

  // Element symbols, tinted by output level (terminal 0).
  for (let k = 0; k < elements.length; k++) {
    const el = elements[k]!;
    const ep = ePos[k]!;
    const out = level(el.nodes[0] ?? gndNode);
    const fill = mix(0x141022, accent, 0.14 + 0.4 * out);
    const line = mix(PALETTE.border, accent, 0.3 + 0.6 * out);
    if (el.type === T_GATE) gateSymbol(g, el.func, ep.x, ep.y, sym, fill, line);
    else partSymbol(g, el.type, ep.x, ep.y, sym, fill, line);
  }
}

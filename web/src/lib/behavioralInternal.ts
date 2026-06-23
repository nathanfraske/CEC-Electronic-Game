// SPDX-License-Identifier: Apache-2.0
// In-app INTERNAL VIEW for the BEHAVIORAL logic ICs (ELEM_BEHAVIORAL, sim type 25): the
// programmable / protocol blocks the part refsheets (lut-ic.html, spi-master-ic.html,
// spi-slave-ic.html, uart-ic.html, sar-adc-ic.html) teach. These are functional blocks, not a
// transistor schematic, so each opens to a clean BLOCK DIAGRAM of its architecture: the LUT is a
// 16:1 mux tree selected by the 4 inputs (+ an output register), an SPI master is a shift register
// + clock divider + control FSM, a SAR ADC is a comparator + SAR register + internal DAC in a
// feedback loop, and so on. Plugs into the existing tier-zoom system the same way logicInternal.ts
// does (the parent registers this module in DETAIL_DRAWERS), so a behavioral chip zoomed in under
// the reality / analogy lens opens to this instead of the flat IC-card glyph.
//
// Pure presentation, exactly like logicInternal.ts / detailDrawers.ts: it only READS the live
// ElectricalState + phase and NEVER feeds the sim, the netlist, or the snapshot hash. It recolours
// from PALETTE (no hardcoded colours) and honours the bus-language discipline
// (docs/ui/visual-language.md): magnitude rides alpha / density / thickness, NEVER speed; flow
// recirculates on the bounded `phase` clock at a constant calm rate.
import { Graphics } from "pixi.js";
import { PALETTE } from "./graph";
import {
  type TierOpts as DetailOpts,
  belt,
  flowAlongPath,
  mix,
  norm,
  CUR_SCALE,
  PULSE_K,
} from "./tierKit";

// ============================================================================
// Shared furniture for the block diagrams.
// ============================================================================

// The signal-path palette these blocks use: a calm data-bus body (violet, the behavioral family's
// accent), a hot carrier colour for live data, clock pulses in cyan, control in amber, and the
// muted rail/ground grey. All from PALETTE so the views recolour from one source.
const BODY = PALETTE.violet;
const DATA = mix(PALETTE.cyan, 0xffffff, 0.25); // live data carriers
const CLK = PALETTE.cyan; // clock / sample edges
const CTRL = PALETTE.warn; // control FSM / framing
const RAILC = PALETTE.rail; // supply / ground rails
const PANEL = 0x141022; // block interior fill (matches logicInternal's mos body base)

/**
 * Resolve a named terminal's anchor by a label fragment (case-insensitive `includes`), falling
 * back to a fraction of the bounds when the host supplies no anchors - the same degrade-gracefully
 * pattern as logicInternal.ts's `anchor()` and drawDetailOA's `pick()`. `frag` is matched against
 * the catalog pin labels (e.g. "SCLK", "MOSI", "VCC").
 */
function anchorOf(
  o: DetailOpts,
  frag: string,
  fx: number,
  fy: number,
): { x: number; y: number } {
  const up = frag.toUpperCase();
  const hit = o.anchors?.find((p) => p.label.toUpperCase().includes(up));
  return hit
    ? { x: hit.x, y: hit.y }
    : { x: fx * o.bounds.hw, y: fy * o.bounds.hh };
}

/**
 * An EXACT-label anchor lookup (avoids "I0"/"I1"/"I2" colliding under `includes`, and "MOSI"
 * matching an "OS" fragment). Falls back to the fraction of the bounds when absent.
 */
function anchorExact(
  o: DetailOpts,
  label: string,
  fx: number,
  fy: number,
): { x: number; y: number } {
  const up = label.toUpperCase();
  const hit = o.anchors?.find((p) => p.label.toUpperCase() === up);
  return hit
    ? { x: hit.x, y: hit.y }
    : { x: fx * o.bounds.hw, y: fy * o.bounds.hh };
}

/** A functional block box (dark interior + a coloured edge + a faint top depth line). */
function block(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  fill = 0.1,
): void {
  g.roundRect(x, y, w, h, 3).fill({ color: PANEL, alpha: 0.95 });
  g.roundRect(x, y, w, h, 3).fill({ color, alpha: fill });
  g.roundRect(x, y, w, h, 3).stroke({ width: 1.3, color, alpha: 0.85 });
  g.moveTo(x + 4, y + 3)
    .lineTo(x + w - 4, y + 3)
    .stroke({ width: 1, color, alpha: 0.28 });
}

/** A short input/output stub from a pin anchor to a block edge, plus its terminal dot. */
function stubTo(
  g: Graphics,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: number,
  alpha = 0.6,
): void {
  g.moveTo(from.x, from.y)
    .lineTo(to.x, from.y)
    .lineTo(to.x, to.y)
    .stroke({ width: 1.3, color, alpha });
  g.circle(from.x, from.y, 2).fill({ color, alpha: 0.7 });
}

/** A connecting wire between two interior points (orthogonal one-bend route). */
function wire(
  g: Graphics,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color: number,
  alpha = 0.5,
): void {
  g.moveTo(ax, ay).lineTo(bx, ay).lineTo(bx, by).stroke({
    width: 1.2,
    color,
    alpha,
  });
}

/**
 * A small register-cell row: `n` little squares whose lit fraction reads the current 0..1
 * magnitude (more cells light as the word fills) - the picture of a shift / SAR register marching
 * data. `lit` in 0..1; cells fill MSB-first (left to right). Pure cosmetic level meter.
 */
function regCells(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  n: number,
  lit: number,
  color: number,
): void {
  const gap = 2;
  const cw = (w - gap * (n - 1)) / n;
  const onCount = lit * n;
  for (let i = 0; i < n; i++) {
    const cx = x + i * (cw + gap);
    const on = Math.max(0, Math.min(1, onCount - i));
    g.roundRect(cx, y, cw, h, 1.5)
      .fill({ color: mix(PANEL, color, 0.2 + 0.6 * on), alpha: 0.9 })
      .stroke({ width: 0.8, color, alpha: 0.6 });
  }
}

/**
 * A blinking clock indicator: a small disc that pulses on the bounded phase (a cosmetic edge
 * marker, NOT the signal frequency). `mag` rides the alpha floor so a running clock reads brighter.
 */
function clockDot(
  g: Graphics,
  x: number,
  y: number,
  mag: number,
  phase: number,
): void {
  const beat = 0.5 + 0.5 * Math.sin(phase * PULSE_K);
  g.circle(x, y, 3.2).fill({ color: CLK, alpha: (0.25 + 0.55 * mag) * beat });
  g.circle(x, y, 3.2).stroke({ width: 1, color: CLK, alpha: 0.5 });
}

/** Live output drive (0..1) from the output current, and the high/low output level (0..1). */
function live(o: DetailOpts): { drive: number; dir: number; level: number } {
  const rail = o.value && o.value > 0.5 ? o.value : 5;
  return {
    drive: norm(o.electrical.current, CUR_SCALE),
    dir: o.electrical.current >= 0 ? 1 : -1,
    level: Math.max(0, Math.min(1, o.electrical.vAcross / rail)),
  };
}

/** Supply + ground stubs from the VCC/GND pins to a top/bottom rail line. */
function supplyRails(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const vcc = anchorOf(o, "VCC", 0, -0.95);
  const gnd = anchorOf(o, "GND", 0, 0.95);
  const yV = -hh * 0.9;
  const yG = hh * 0.9;
  g.moveTo(-hw * 0.92, yV)
    .lineTo(hw * 0.92, yV)
    .stroke({ width: 1.6, color: PALETTE.bad, alpha: 0.4 });
  g.moveTo(-hw * 0.92, yG)
    .lineTo(hw * 0.92, yG)
    .stroke({ width: 1.6, color: RAILC, alpha: 0.45 });
  g.moveTo(vcc.x, vcc.y)
    .lineTo(vcc.x, yV)
    .stroke({ width: 1.2, color: PALETTE.bad, alpha: 0.4 });
  g.circle(vcc.x, vcc.y, 2).fill({ color: PALETTE.bad, alpha: 0.6 });
  g.moveTo(gnd.x, gnd.y)
    .lineTo(gnd.x, yG)
    .stroke({ width: 1.2, color: RAILC, alpha: 0.45 });
  g.circle(gnd.x, gnd.y, 2).fill({ color: RAILC, alpha: 0.6 });
}

// ============================================================================
// LUT - FPGA logic cell: a 16:1 multiplexer tree selected by the 4 inputs (I0 = LSB select),
// optionally captured by an output flip-flop on CLK. Pins: OUT, I0, I1, I2, I3, CLK, VCC, GND.
// The 16 config-SRAM bits feed a 4-stage 2:1-select tree (16->8->4->2->1); each input drives one
// stage's selects; the final bit goes to OUT (through the FF when CLK is wired).
//
// Live mapping: drive = norm(|Iout|) -> the selected-path carrier belt to OUT; level = V(OUT)/rail
// -> which truth-table bit reads "1" (the lit config cells) + the OUT level dot.
// ============================================================================
function drawLUT(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const { drive, dir, level } = live(o);

  supplyRails(g, o);

  // The mux tree occupies the centre; inputs enter on the left, OUT on the right.
  const treeL = -hw * 0.36;
  const treeR = hw * 0.42;
  const colW = (treeR - treeL) / 4; // four select stages
  const top = -hh * 0.5;
  const bot = hh * 0.5;

  // 16 config-SRAM cells down the far left (the truth table). Lit fraction reads the OUT level so
  // a high output looks like it "selected a 1".
  const cellX = -hw * 0.84;
  const cellW = hw * 0.16;
  for (let i = 0; i < 16; i++) {
    const cy = top + ((bot - top) * i) / 15;
    const on = i % 2 === 0 ? level : 1 - level; // alternating bits, biased by the live level
    g.roundRect(cellX, cy - 2.5, cellW, 5, 1)
      .fill({ color: mix(PANEL, BODY, 0.2 + 0.5 * on), alpha: 0.85 })
      .stroke({ width: 0.6, color: BODY, alpha: 0.5 });
  }
  // Label rail behind the tree (a faint backdrop box).
  block(g, treeL - 4, top - 6, treeR - treeL + 8, bot - top + 12, BODY, 0.05);

  // The narrowing 2:1-select tree: stage s collapses 2^(4-s) nodes to 2^(3-s). Draw each stage's
  // nodes and the converging wires; the surviving path (lit) carries the live carrier stream.
  let nodesX = cellX + cellW;
  const stageNodeX: number[] = [];
  for (let s = 0; s <= 4; s++) {
    const count = 16 >> s;
    const x = s === 0 ? cellX + cellW + 6 : treeL + colW * s;
    stageNodeX.push(x);
    for (let i = 0; i < count; i++) {
      const cy = top + ((bot - top) * (i + 0.5)) / count;
      const onPath = Math.abs(i - (count - 1) * level) < 1.0; // the selected node near this stage
      g.circle(x, cy, s === 4 ? 4 : 2.2).fill({
        color: mix(RAILC, DATA, onPath ? 0.9 : 0.25),
        alpha: 0.8,
      });
      if (s > 0) {
        // converge from the two parents in the previous stage
        const pc = 16 >> (s - 1);
        const py0 = top + ((bot - top) * (2 * i + 0.5)) / pc;
        const py1 = top + ((bot - top) * (2 * i + 1.5)) / pc;
        const col = mix(RAILC, DATA, onPath ? 0.6 : 0.16);
        g.moveTo(nodesX, py0)
          .lineTo(x, cy)
          .stroke({ width: 1, color: col, alpha: 0.5 });
        g.moveTo(nodesX, py1)
          .lineTo(x, cy)
          .stroke({ width: 1, color: col, alpha: 0.5 });
      }
    }
    nodesX = x;
  }

  // Inputs I0..I3 enter on the left and drive each stage's select line (vertical ticks).
  const inLabels = ["I0", "I1", "I2", "I3"];
  for (let s = 0; s < 4; s++) {
    const a = anchorExact(o, inLabels[s]!, -0.92, -0.6 + 0.4 * s);
    const sx = stageNodeX[s + 1]!;
    g.moveTo(a.x, a.y)
      .lineTo(sx, a.y)
      .stroke({ width: 1.2, color: CTRL, alpha: 0.55 });
    g.moveTo(sx, top - 4)
      .lineTo(sx, bot + 4)
      .stroke({ width: 0.8, color: CTRL, alpha: 0.3 });
    g.circle(a.x, a.y, 2).fill({ color: CTRL, alpha: 0.7 });
  }

  // Optional output flip-flop, clocked by CLK. The final mux node feeds it; OUT taps its Q.
  const ffX = treeR + hw * 0.05;
  const ffY = -hh * 0.16;
  const ffW = hw * 0.18;
  const ffH = hh * 0.32;
  block(g, ffX, ffY, ffW, ffH, CLK, 0.08 + 0.18 * level);
  const clk = anchorOf(o, "CLK", 0.92, 0.5);
  stubTo(g, clk, { x: ffX + ffW * 0.5, y: ffY + ffH }, CLK, 0.55);
  clockDot(g, ffX + ffW * 0.5, ffY + ffH - 5, drive, o.phase);
  // wire the last mux node into the FF's D
  wire(g, treeR, 0, ffX, ffY + ffH * 0.5, DATA, 0.5);

  // OUT path off the FF's Q, carrying the live drive belt.
  const out = anchorOf(o, "OUT", 0.92, 0);
  g.moveTo(ffX + ffW, ffY + ffH * 0.5)
    .lineTo(out.x, ffY + ffH * 0.5)
    .lineTo(out.x, out.y)
    .stroke({ width: 1.4, color: mix(RAILC, DATA, level), alpha: 0.6 });
  belt(
    g,
    ffX + ffW,
    ffY + ffH * 0.5,
    out.x,
    ffY + ffH * 0.5,
    drive,
    dir,
    o.phase,
    DATA,
    2.6,
  );
  // carriers down the selected mux path into the FF
  belt(
    g,
    stageNodeX[0]!,
    0,
    treeR,
    0,
    0.3 + 0.5 * level,
    1,
    o.phase,
    DATA,
    2.2,
  );
  g.circle(out.x, out.y, 2.4).fill({ color: mix(RAILC, DATA, level) });
}

// ============================================================================
// SPI master (Mode 0): a control FSM + clock divider drive an 8-bit shift register; on a START
// edge it loads the TX word, asserts CS low, and clocks bits out MOSI (MSB first) while shifting
// MISO in. Pins: SCLK, MOSI, MISO, CS, START, VCC, GND.
//
// Live mapping: drive = norm(|Iout|) -> the SCLK pulse + the MOSI carrier belt; level = output
// rail fraction -> the register fill (how much of the word has marched out).
// ============================================================================
function drawSPIM(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const { drive, dir, level } = live(o);

  supplyRails(g, o);

  // Clock divider (top-left) -> SCLK; control FSM (bottom-left) frames CS / START; shift register
  // (centre) marches the word; MOSI exits right, MISO enters right.
  const divX = -hw * 0.78;
  const divY = -hh * 0.5;
  const divW = hw * 0.42;
  const divH = hh * 0.3;
  block(g, divX, divY, divW, divH, CLK, 0.08 + 0.2 * drive);
  clockDot(g, divX + divW - 8, divY + divH * 0.5, drive, o.phase);

  const fsmX = -hw * 0.78;
  const fsmY = hh * 0.18;
  const fsmW = hw * 0.42;
  const fsmH = hh * 0.32;
  block(g, fsmX, fsmY, fsmW, fsmH, CTRL, 0.1);

  // 8-bit shift register across the middle.
  const regX = -hw * 0.2;
  const regY = -hh * 0.12;
  const regW = hw * 0.95;
  const regH = hh * 0.24;
  block(g, regX, regY, regW, regH, BODY, 0.08);
  regCells(g, regX + 4, regY + 4, regW - 8, regH - 8, 8, level, DATA);

  // SCLK rail from the divider down to the register clock + out to the SCLK pin.
  const sclk = anchorExact(o, "SCLK", 0.92, -0.55);
  wire(g, divX + divW, divY + divH * 0.5, regX + regW * 0.5, regY, CLK, 0.5);
  g.moveTo(divX + divW, divY + divH * 0.5)
    .lineTo(sclk.x, divY + divH * 0.5)
    .lineTo(sclk.x, sclk.y)
    .stroke({ width: 1.3, color: CLK, alpha: 0.55 });
  belt(
    g,
    divX + divW,
    divY + divH * 0.5,
    sclk.x,
    divY + divH * 0.5,
    drive,
    dir,
    o.phase,
    CLK,
    2.4,
  );
  g.circle(sclk.x, sclk.y, 2.4).fill({ color: CLK, alpha: 0.8 });

  // START -> FSM, CS <- FSM.
  const start = anchorExact(o, "START", -0.92, 0.55);
  stubTo(g, start, { x: fsmX, y: fsmY + fsmH * 0.5 }, CTRL, 0.55);
  const cs = anchorExact(o, "CS", 0.92, 0.2);
  g.moveTo(fsmX + fsmW, fsmY + fsmH * 0.4)
    .lineTo(cs.x, fsmY + fsmH * 0.4)
    .lineTo(cs.x, cs.y)
    .stroke({ width: 1.3, color: CTRL, alpha: 0.55 });
  g.circle(cs.x, cs.y, 2.4).fill({ color: CTRL, alpha: 0.7 });

  // MOSI out (MSB end), MISO in (LSB end) - the full-duplex pair.
  const mosi = anchorExact(o, "MOSI", 0.92, -0.15);
  g.moveTo(regX + regW, regY + regH * 0.5)
    .lineTo(mosi.x, regY + regH * 0.5)
    .lineTo(mosi.x, mosi.y)
    .stroke({ width: 1.4, color: mix(RAILC, DATA, level), alpha: 0.6 });
  belt(
    g,
    regX + regW,
    regY + regH * 0.5,
    mosi.x,
    regY + regH * 0.5,
    drive,
    dir,
    o.phase,
    DATA,
    2.6,
  );
  g.circle(mosi.x, mosi.y, 2.4).fill({ color: mix(RAILC, DATA, level) });

  const miso = anchorExact(o, "MISO", 0.92, 0.55);
  g.moveTo(miso.x, miso.y)
    .lineTo(miso.x, regY + regH + 8)
    .lineTo(regX + regW - 6, regY + regH + 8)
    .lineTo(regX + regW - 6, regY + regH)
    .stroke({ width: 1.2, color: mix(RAILC, DATA, 0.4), alpha: 0.45 });
  g.circle(miso.x, miso.y, 2).fill({ color: DATA, alpha: 0.6 });
  // MISO carriers stream IN toward the register.
  belt(
    g,
    miso.x,
    regY + regH + 8,
    regX + regW - 6,
    regY + regH + 8,
    0.25 + 0.4 * level,
    -1,
    o.phase,
    DATA,
    2.2,
  );
}

// ============================================================================
// SPI slave (Mode 0): no clock of its own - the master's SCLK + CS drive an edge detector and bit
// counter; on each SCLK edge it samples MOSI into the RX register and shifts its reply out MISO;
// RXVALID pulses once a full word lands. Pins: MISO, RXV, SCLK, MOSI, CS, VCC, GND.
//
// Live mapping: drive -> the MISO reply belt; level -> the RX register fill + the RXVALID lamp.
// ============================================================================
function drawSPIS(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const { drive, dir, level } = live(o);

  supplyRails(g, o);

  // Edge detector (left, on the incoming SCLK) + bit counter feed the two registers (centre): the
  // RX register (samples MOSI) and the reply register (drives MISO).
  const edX = -hw * 0.8;
  const edY = -hh * 0.5;
  const edW = hw * 0.34;
  const edH = hh * 0.3;
  block(g, edX, edY, edW, edH, CLK, 0.08 + 0.18 * drive);
  clockDot(g, edX + edW - 7, edY + edH * 0.5, drive, o.phase);

  const cntX = -hw * 0.8;
  const cntY = hh * 0.2;
  const cntW = hw * 0.34;
  const cntH = hh * 0.3;
  block(g, cntX, cntY, cntW, cntH, CTRL, 0.1);

  // RX register (top centre) and reply register (bottom centre).
  const regX = -hw * 0.36;
  const rxY = -hh * 0.42;
  const txY = hh * 0.1;
  const regW = hw * 0.62;
  const regH = hh * 0.26;
  block(g, regX, rxY, regW, regH, BODY, 0.08);
  regCells(g, regX + 4, rxY + 4, regW - 8, regH - 8, 8, level, DATA);
  block(g, regX, txY, regW, regH, BODY, 0.08);
  regCells(g, regX + 4, txY + 4, regW - 8, regH - 8, 8, 1 - level, DATA);

  // Incoming SCLK / MOSI / CS on the left side.
  const sclk = anchorExact(o, "SCLK", -0.92, -0.55);
  stubTo(g, sclk, { x: edX, y: edY + edH * 0.5 }, CLK, 0.55);
  const mosi = anchorExact(o, "MOSI", -0.92, 0);
  g.moveTo(mosi.x, mosi.y)
    .lineTo(regX - 6, mosi.y)
    .lineTo(regX - 6, rxY + regH * 0.5)
    .lineTo(regX, rxY + regH * 0.5)
    .stroke({ width: 1.3, color: mix(RAILC, DATA, level), alpha: 0.55 });
  g.circle(mosi.x, mosi.y, 2).fill({ color: DATA, alpha: 0.7 });
  belt(
    g,
    mosi.x,
    mosi.y,
    regX - 6,
    mosi.y,
    0.25 + 0.4 * level,
    1,
    o.phase,
    DATA,
    2.2,
  );
  const cs = anchorExact(o, "CS", -0.92, 0.55);
  stubTo(g, cs, { x: cntX, y: cntY + cntH * 0.5 }, CTRL, 0.5);

  // Wire the edge detector to both registers' clocks.
  wire(g, edX + edW, edY + edH * 0.5, regX + regW * 0.5, rxY, CLK, 0.4);
  wire(g, edX + edW, edY + edH * 0.5, regX + regW * 0.5, txY + regH, CLK, 0.4);

  // MISO reply out (top-right) + RXVALID lamp.
  const miso = anchorExact(o, "MISO", 0.92, -0.2);
  g.moveTo(regX + regW, txY + regH * 0.5)
    .lineTo(miso.x, txY + regH * 0.5)
    .lineTo(miso.x, miso.y)
    .stroke({ width: 1.4, color: mix(RAILC, DATA, level), alpha: 0.6 });
  belt(
    g,
    regX + regW,
    txY + regH * 0.5,
    miso.x,
    txY + regH * 0.5,
    drive,
    dir,
    o.phase,
    DATA,
    2.6,
  );
  g.circle(miso.x, miso.y, 2.4).fill({ color: mix(RAILC, DATA, level) });

  const rxv = anchorExact(o, "RXV", 0.92, 0.4);
  const validLit = level > 0.5 ? level : 0.15;
  g.moveTo(regX + regW, rxY + regH * 0.5)
    .lineTo(rxv.x, rxY + regH * 0.5)
    .lineTo(rxv.x, rxv.y)
    .stroke({ width: 1.2, color: PALETTE.ok, alpha: 0.4 + 0.4 * validLit });
  g.circle(rxv.x, rxv.y, 3).fill({
    color: PALETTE.ok,
    alpha: 0.2 + 0.6 * validLit,
  });
  g.circle(rxv.x, rxv.y, 3).stroke({ width: 1, color: PALETTE.ok, alpha: 0.6 });
}

// ============================================================================
// UART (8-N-1, async, full-duplex): an internal baud generator clocks a TX framing FSM (START low,
// 8 data bits LSB-first, STOP high) and an RX edge detector + mid-bit sampler. No clock wire. Pins:
// TX, RX, RXV, SEND, VCC, GND.
//
// Live mapping: drive -> the TX frame belt + the baud metronome brightness; level -> the TX/RX
// shift fill + the RXVALID lamp.
// ============================================================================
function drawUART(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const { drive, dir, level } = live(o);

  supplyRails(g, o);

  // Baud generator (centre, the internal metronome with no external pin); TX chain (top) framed by
  // the TX FSM; RX chain (bottom) gated by the edge detector + mid-bit sampler.
  const baudX = -hw * 0.18;
  const baudY = -hh * 0.13;
  const baudW = hw * 0.36;
  const baudH = hh * 0.26;
  block(g, baudX, baudY, baudW, baudH, CLK, 0.08 + 0.2 * drive);
  clockDot(g, baudX + baudW * 0.5, baudY + baudH * 0.5, drive, o.phase);
  // a few divider ticks under the metronome
  for (let i = 0; i < 4; i++) {
    const tx = baudX + 6 + i * 5;
    g.moveTo(tx, baudY + baudH - 4)
      .lineTo(tx, baudY + baudH - 4 - 4 * ((i % 2) + 1))
      .stroke({ width: 0.8, color: CLK, alpha: 0.4 });
  }

  // TX path (top): SEND triggers the framing FSM -> shift register -> TX pin.
  const txFsmX = -hw * 0.74;
  const txY = -hh * 0.56;
  const fsmW = hw * 0.34;
  const rowH = hh * 0.24;
  block(g, txFsmX, txY, fsmW, rowH, CTRL, 0.1);
  const txRegX = -hw * 0.2;
  const txRegW = hw * 0.55;
  block(g, txRegX, txY, txRegW, rowH, BODY, 0.08);
  regCells(g, txRegX + 4, txY + 4, txRegW - 8, rowH - 8, 8, level, DATA);

  const send = anchorExact(o, "SEND", -0.92, 0.45);
  stubTo(g, send, { x: txFsmX, y: txY + rowH * 0.5 }, CTRL, 0.55);
  wire(
    g,
    baudX + baudW * 0.5,
    baudY,
    txRegX + txRegW * 0.5,
    txY + rowH,
    CLK,
    0.35,
  );
  const tx = anchorExact(o, "TX", 0.92, -0.55);
  g.moveTo(txRegX + txRegW, txY + rowH * 0.5)
    .lineTo(tx.x, txY + rowH * 0.5)
    .lineTo(tx.x, tx.y)
    .stroke({ width: 1.4, color: mix(RAILC, DATA, level), alpha: 0.6 });
  belt(
    g,
    txRegX + txRegW,
    txY + rowH * 0.5,
    tx.x,
    txY + rowH * 0.5,
    drive,
    dir,
    o.phase,
    DATA,
    2.6,
  );
  g.circle(tx.x, tx.y, 2.4).fill({ color: mix(RAILC, DATA, level) });

  // RX path (bottom): RX line -> edge detector + sampler -> shift register -> RXVALID.
  const rxDetX = -hw * 0.74;
  const rxY = hh * 0.32;
  block(g, rxDetX, rxY, fsmW, rowH, CLK, 0.08);
  const rxRegX = -hw * 0.2;
  const rxRegW = hw * 0.55;
  block(g, rxRegX, rxY, rxRegW, rowH, BODY, 0.08);
  regCells(g, rxRegX + 4, rxY + 4, rxRegW - 8, rowH - 8, 8, 1 - level, DATA);

  const rx = anchorExact(o, "RX", -0.92, -0.45);
  g.moveTo(rx.x, rx.y)
    .lineTo(rxDetX, rx.y)
    .lineTo(rxDetX, rxY + rowH * 0.5)
    .stroke({ width: 1.3, color: mix(RAILC, DATA, 0.4), alpha: 0.5 });
  g.circle(rx.x, rx.y, 2).fill({ color: DATA, alpha: 0.7 });
  belt(
    g,
    rx.x,
    rxY + rowH * 0.5,
    rxDetX,
    rxY + rowH * 0.5,
    0.25 + 0.4 * level,
    1,
    o.phase,
    DATA,
    2.2,
  );
  wire(
    g,
    baudX + baudW * 0.5,
    baudY + baudH,
    rxRegX + rxRegW * 0.5,
    rxY,
    CLK,
    0.35,
  );

  const rxv = anchorExact(o, "RXV", 0.92, 0.45);
  const validLit = level > 0.5 ? level : 0.15;
  g.moveTo(rxRegX + rxRegW, rxY + rowH * 0.5)
    .lineTo(rxv.x, rxY + rowH * 0.5)
    .lineTo(rxv.x, rxv.y)
    .stroke({ width: 1.2, color: PALETTE.ok, alpha: 0.4 + 0.4 * validLit });
  g.circle(rxv.x, rxv.y, 3).fill({
    color: PALETTE.ok,
    alpha: 0.2 + 0.6 * validLit,
  });
  g.circle(rxv.x, rxv.y, 3).stroke({ width: 1, color: PALETTE.ok, alpha: 0.6 });
}

// ============================================================================
// SAR ADC: a comparator + 3-bit SAR register + internal R-2R DAC in a FEEDBACK LOOP. The clock
// sequencer tries each bit MSB-first; the DAC turns the trial code into a trial voltage that the
// comparator weighs against VIN; keep-or-drop feeds back into the register. DONE rises when the
// search settles. Pins: VIN, CLK, D2, D1, D0, DONE, VCC, GND.
//
// Live mapping: drive -> the data-out belts to D2..D0; level -> the settled code (DAC fill + the
// register cells + the DONE lamp); the feedback loop carriers ride the bounded phase.
// ============================================================================
function drawSAR(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const { drive, dir, level } = live(o);

  supplyRails(g, o);

  // Comparator (left, apex right) weighs VIN (top input) against the DAC trial voltage (bottom
  // input). Its result drives the SAR register (centre), which selects the DAC (bottom) whose
  // output returns to the comparator's - input: a closed loop.
  const cmpX = -hw * 0.72;
  const cmpCy = -hh * 0.18;
  const cmpW = hw * 0.3;
  const cmpH = hh * 0.5;
  // triangle comparator
  g.poly([
    cmpX,
    cmpCy - cmpH * 0.5,
    cmpX,
    cmpCy + cmpH * 0.5,
    cmpX + cmpW,
    cmpCy,
  ])
    .fill({ color: mix(PANEL, PALETTE.accent, 0.12), alpha: 0.92 })
    .stroke({ width: 1.3, color: PALETTE.accent, alpha: 0.85 });

  // VIN -> comparator + input.
  const vin = anchorExact(o, "VIN", -0.92, -0.5);
  g.moveTo(vin.x, vin.y)
    .lineTo(cmpX - 4, vin.y)
    .lineTo(cmpX - 4, cmpCy - cmpH * 0.22)
    .lineTo(cmpX, cmpCy - cmpH * 0.22)
    .stroke({ width: 1.4, color: PALETTE.pos, alpha: 0.65 });
  g.circle(vin.x, vin.y, 2.4).fill({ color: PALETTE.pos, alpha: 0.8 });
  belt(
    g,
    vin.x,
    vin.y,
    cmpX - 4,
    vin.y,
    0.3 + 0.4 * level,
    1,
    o.phase,
    PALETTE.pos,
    2.2,
  );

  // SAR register (centre): 3 cells, MSB-first, filled by the settled code.
  const regX = -hw * 0.26;
  const regY = -hh * 0.5;
  const regW = hw * 0.34;
  const regH = hh * 0.26;
  block(g, regX, regY, regW, regH, BODY, 0.08);
  regCells(g, regX + 4, regY + 4, regW - 8, regH - 8, 3, level, DATA);
  // comparator result -> register (the keep/drop decision)
  wire(g, cmpX + cmpW, cmpCy, regX, regY + regH * 0.5, PALETTE.accent, 0.55);
  belt(
    g,
    cmpX + cmpW,
    cmpCy,
    regX,
    cmpCy,
    drive,
    dir,
    o.phase,
    PALETTE.accent,
    2.2,
  );

  // Clock sequencer (top right) steps the search.
  const seqX = hw * 0.18;
  const seqY = -hh * 0.5;
  const seqW = hw * 0.3;
  const seqH = hh * 0.26;
  block(g, seqX, seqY, seqW, seqH, CLK, 0.08 + 0.18 * drive);
  clockDot(g, seqX + seqW - 7, seqY + seqH * 0.5, drive, o.phase);
  const clk = anchorExact(o, "CLK", -0.92, 0.5);
  g.moveTo(clk.x, clk.y)
    .lineTo(-hw * 0.04, clk.y)
    .lineTo(-hw * 0.04, hh * 0.62)
    .stroke({ width: 1, color: CLK, alpha: 0.4 });
  // route the clock up the right side into the sequencer
  g.moveTo(-hw * 0.04, clk.y)
    .lineTo(seqX + seqW * 0.5, clk.y)
    .lineTo(seqX + seqW * 0.5, seqY + seqH)
    .stroke({ width: 1.2, color: CLK, alpha: 0.45 });
  g.circle(clk.x, clk.y, 2.4).fill({ color: CLK, alpha: 0.8 });
  wire(g, seqX, seqY + seqH * 0.5, regX + regW, regY + regH * 0.5, CLK, 0.35);

  // Internal R-2R DAC (bottom): the register selects its taps; its trial voltage returns to the
  // comparator's - input (the feedback leg).
  const dacX = -hw * 0.26;
  const dacY = hh * 0.04;
  const dacW = hw * 0.34;
  const dacH = hh * 0.3;
  block(g, dacX, dacY, dacW, dacH, PALETTE.bronze, 0.08);
  // a little ladder motif inside the DAC
  for (let i = 0; i < 3; i++) {
    const lx = dacX + 6 + i * ((dacW - 12) / 2);
    g.moveTo(lx, dacY + 4)
      .lineTo(lx, dacY + dacH - 4)
      .stroke({ width: 1, color: PALETTE.bronze, alpha: 0.4 + 0.3 * level });
  }
  // register -> DAC (the code in)
  wire(g, regX + regW * 0.5, regY + regH, dacX + dacW * 0.5, dacY, DATA, 0.45);
  belt(
    g,
    regX + regW * 0.5,
    regY + regH,
    dacX + dacW * 0.5,
    dacY,
    0.3 + 0.4 * level,
    1,
    o.phase,
    DATA,
    2.0,
  );
  // DAC trial voltage -> comparator - input (feedback loop, routed under the comparator)
  const fbY = cmpCy + cmpH * 0.22;
  const loop = [
    { x: dacX, y: dacY + dacH * 0.5 },
    { x: dacX - hw * 0.06, y: dacY + dacH * 0.5 },
    { x: dacX - hw * 0.06, y: fbY },
    { x: cmpX, y: fbY },
  ];
  g.moveTo(loop[0]!.x, loop[0]!.y);
  for (let i = 1; i < loop.length; i++) g.lineTo(loop[i]!.x, loop[i]!.y);
  g.stroke({ width: 1.3, color: PALETTE.neg, alpha: 0.6 });
  flowAlongPath(g, loop, 0.3 + 0.4 * level, 1, o.phase, PALETTE.neg, 2.2);

  // Data outputs D2..D0 + DONE on the right.
  const outs = ["D2", "D1", "D0"];
  for (let i = 0; i < outs.length; i++) {
    const a = anchorExact(o, outs[i]!, 0.92, -0.2 + i * 0.25);
    const sy = regY + regH * (0.3 + 0.2 * i);
    g.moveTo(regX + regW, sy)
      .lineTo(a.x - 6, sy)
      .lineTo(a.x - 6, a.y)
      .lineTo(a.x, a.y)
      .stroke({ width: 1.3, color: mix(RAILC, DATA, level), alpha: 0.55 });
    belt(g, regX + regW, sy, a.x - 6, sy, drive, dir, o.phase, DATA, 2.2);
    g.circle(a.x, a.y, 2.4).fill({ color: mix(RAILC, DATA, level) });
  }
  const done = anchorExact(o, "DONE", 0.92, 0.55);
  const doneLit = level > 0.5 ? level : 0.15;
  g.moveTo(seqX + seqW, seqY + seqH * 0.5)
    .lineTo(done.x, seqY + seqH * 0.5)
    .lineTo(done.x, done.y)
    .stroke({ width: 1.2, color: PALETTE.ok, alpha: 0.35 + 0.4 * doneLit });
  g.circle(done.x, done.y, 3).fill({
    color: PALETTE.ok,
    alpha: 0.2 + 0.6 * doneLit,
  });
  g.circle(done.x, done.y, 3).stroke({
    width: 1,
    color: PALETTE.ok,
    alpha: 0.6,
  });
}

// ============================================================================
// Sigma-delta ADC (1st order): a 1-bit modulator (integrator + comparator + 1-bit feedback DAC)
// makes the density of 1s on the bit stream BS equal VIN/VCC; a decimation counter counts the 1s
// over the conversion window into a 3-bit code. (No refsheet - standard 1st-order topology.)
// Pins: VIN, CLK, D2, D1, D0, BS, VCC, GND.
//
// Live mapping: drive -> the BS bit-stream belt + the decimator out; level -> the integrator fill
// (the ramp), the 1-bit comparator state, and the decimated code cells.
// ============================================================================
function drawSDM(g: Graphics, o: DetailOpts): void {
  const { hw, hh } = o.bounds;
  const { drive, dir, level } = live(o);

  supplyRails(g, o);

  // Summing node (left) subtracts the 1-bit feedback from VIN, feeds the integrator (centre-left);
  // a 1-bit comparator (clocked) quantises -> the bit stream BS; the modulator loop feeds a 1-bit
  // DAC back to the summer; a decimation counter (right) counts 1s -> D2..D0.
  const sumX = -hw * 0.66;
  const sumCy = -hh * 0.1;
  const sumR = Math.min(hw, hh) * 0.08;
  g.circle(sumX, sumCy, sumR)
    .fill({ color: mix(PANEL, PALETTE.accent, 0.1), alpha: 0.92 })
    .stroke({ width: 1.2, color: PALETTE.accent, alpha: 0.8 });
  g.moveTo(sumX - sumR * 0.5, sumCy)
    .lineTo(sumX + sumR * 0.5, sumCy)
    .stroke({ width: 1, color: PALETTE.accent, alpha: 0.7 });
  g.moveTo(sumX, sumCy - sumR * 0.5)
    .lineTo(sumX, sumCy + sumR * 0.5)
    .stroke({ width: 1, color: PALETTE.accent, alpha: 0.7 });

  // VIN -> summing node.
  const vin = anchorExact(o, "VIN", -0.92, -0.5);
  g.moveTo(vin.x, vin.y)
    .lineTo(sumX, vin.y)
    .lineTo(sumX, sumCy - sumR)
    .stroke({ width: 1.4, color: PALETTE.pos, alpha: 0.65 });
  g.circle(vin.x, vin.y, 2.4).fill({ color: PALETTE.pos, alpha: 0.8 });
  belt(
    g,
    vin.x,
    vin.y,
    sumX,
    vin.y,
    0.3 + 0.4 * level,
    1,
    o.phase,
    PALETTE.pos,
    2.2,
  );

  // Integrator block (a box with a rising ramp inside whose fill reads `level`).
  const intX = -hw * 0.46;
  const intY = -hh * 0.32;
  const intW = hw * 0.3;
  const intH = hh * 0.44;
  block(g, intX, intY, intW, intH, BODY, 0.08);
  // ramp meter inside the integrator
  const rampH = (intH - 8) * level;
  g.poly([
    intX + 5,
    intY + intH - 5,
    intX + intW - 5,
    intY + intH - 5,
    intX + intW - 5,
    intY + intH - 5 - rampH,
  ]).fill({ color: DATA, alpha: 0.35 });
  wire(g, sumX + sumR, sumCy, intX, intY + intH * 0.5, PALETTE.pos, 0.55);

  // 1-bit comparator (quantiser), clocked.
  const qX = -hw * 0.08;
  const qCy = -hh * 0.1;
  const qW = hw * 0.24;
  const qH = hh * 0.34;
  g.poly([qX, qCy - qH * 0.5, qX, qCy + qH * 0.5, qX + qW, qCy])
    .fill({ color: mix(PANEL, PALETTE.accent, 0.12), alpha: 0.92 })
    .stroke({ width: 1.3, color: PALETTE.accent, alpha: 0.85 });
  wire(g, intX + intW, intY + intH * 0.5, qX, qCy, PALETTE.pos, 0.5);
  const clk = anchorExact(o, "CLK", -0.92, 0.5);
  g.moveTo(clk.x, clk.y)
    .lineTo(qX + qW * 0.4, clk.y)
    .lineTo(qX + qW * 0.4, qCy + qH * 0.5)
    .stroke({ width: 1.2, color: CLK, alpha: 0.45 });
  g.circle(clk.x, clk.y, 2.4).fill({ color: CLK, alpha: 0.8 });
  clockDot(g, qX + qW * 0.4, qCy + qH * 0.5 - 5, drive, o.phase);

  // BS bit stream out (the modulator output) - toward the BS pin AND down to the decimator.
  const bs = anchorExact(o, "BS", 0.92, 0.55);
  const bsX = qX + qW;
  g.moveTo(bsX, qCy)
    .lineTo(bs.x - 6, qCy)
    .lineTo(bs.x - 6, bs.y)
    .lineTo(bs.x, bs.y)
    .stroke({ width: 1.4, color: mix(RAILC, DATA, level), alpha: 0.6 });
  belt(g, bsX, qCy, bs.x - 6, qCy, drive, dir, o.phase, DATA, 2.4);
  g.circle(bs.x, bs.y, 2.4).fill({ color: mix(RAILC, DATA, level) });

  // 1-bit feedback DAC: the BS sense -> a small DAC box -> back to the summing node (the loop).
  const fbDacX = -hw * 0.12;
  const fbDacY = hh * 0.34;
  const fbDacW = hw * 0.2;
  const fbDacH = hh * 0.2;
  block(g, fbDacX, fbDacY, fbDacW, fbDacH, PALETTE.bronze, 0.08);
  wire(g, bsX, qCy + qH * 0.3, fbDacX + fbDacW * 0.5, fbDacY, DATA, 0.4);
  const fb = [
    { x: fbDacX, y: fbDacY + fbDacH * 0.5 },
    { x: sumX, y: fbDacY + fbDacH * 0.5 },
    { x: sumX, y: sumCy + sumR },
  ];
  g.moveTo(fb[0]!.x, fb[0]!.y);
  for (let i = 1; i < fb.length; i++) g.lineTo(fb[i]!.x, fb[i]!.y);
  g.stroke({ width: 1.3, color: PALETTE.neg, alpha: 0.6 });
  flowAlongPath(g, fb, 0.3 + 0.4 * level, 1, o.phase, PALETTE.neg, 2.2);

  // Decimation counter (right): counts the 1s over the window into a 3-bit code on D2..D0.
  const decX = hw * 0.4;
  const decY = -hh * 0.5;
  const decW = hw * 0.32;
  const decH = hh * 0.3;
  block(g, decX, decY, decW, decH, CLK, 0.08 + 0.15 * drive);
  regCells(g, decX + 4, decY + decH - 9, decW - 8, 5, 3, level, DATA);
  // BS into the decimator
  g.moveTo(bsX, qCy - qH * 0.3)
    .lineTo(decX + decW * 0.5, qCy - qH * 0.3)
    .lineTo(decX + decW * 0.5, decY + decH)
    .stroke({ width: 1.1, color: DATA, alpha: 0.4 });
  belt(
    g,
    bsX,
    qCy - qH * 0.3,
    decX + decW * 0.5,
    qCy - qH * 0.3,
    0.25 + 0.4 * drive,
    dir,
    o.phase,
    DATA,
    2.0,
  );

  // Data outputs D2..D0.
  const outs = ["D2", "D1", "D0"];
  for (let i = 0; i < outs.length; i++) {
    const a = anchorExact(o, outs[i]!, 0.92, -0.2 + i * 0.25);
    const sy = decY + decH * (0.3 + 0.2 * i);
    g.moveTo(decX + decW, sy)
      .lineTo(a.x - 6, sy)
      .lineTo(a.x - 6, a.y)
      .lineTo(a.x, a.y)
      .stroke({ width: 1.3, color: mix(RAILC, DATA, level), alpha: 0.55 });
    belt(g, decX + decW, sy, a.x - 6, sy, drive, dir, o.phase, DATA, 2.2);
    g.circle(a.x, a.y, 2.4).fill({ color: mix(RAILC, DATA, level) });
  }
}

// ============================================================================
// Dispatch + manifest.
// ============================================================================

const DRAWERS: Record<string, (g: Graphics, o: DetailOpts) => void> = {
  LUT: drawLUT,
  SPIM: drawSPIM,
  SPIS: drawSPIS,
  UART: drawUART,
  SAR: drawSAR,
  SDM: drawSDM,
};

/** The behavioral-IC kinds this module supplies an internal block-diagram view for. */
export const BEHAVIORAL_INTERNAL_KINDS: string[] = Object.keys(DRAWERS);

/**
 * Draw a behavioral chip's internal block diagram into the (pre-cleared) Graphics, dispatched on
 * `o.kind`, live-animated from `o.electrical` + `o.phase`. A no-op for an unhandled kind (the host
 * registers only {@link BEHAVIORAL_INTERNAL_KINDS}, so this never sees a stranger). Pure
 * presentation - never touches the sim, the netlist, or the snapshot hash.
 */
export function drawBehavioralInternal(g: Graphics, o: DetailOpts): void {
  DRAWERS[o.kind]?.(g, o);
}

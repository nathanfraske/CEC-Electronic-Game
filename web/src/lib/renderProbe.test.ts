// SPDX-License-Identifier: Apache-2.0
// Validates the headless render probe AND uses it to assert on the REAL glyph drawers — geometry checks
// with no browser/canvas, the way netlist.test.ts checks the netlist. Catches the exact bug classes from
// the free-form-render / gate-symbol work (symbol overflows its body, wrong colour, nothing drawn).
import { describe, it, expect } from "vitest";
import { Graphics } from "pixi.js";
import { probe, probeCenter } from "./renderProbe";
import { drawGateBodySymbol, drawUserIcPackageBody } from "./glyphs";

describe("renderProbe (the headless probe itself)", () => {
  it("records a simple rect's bounds + fill colour with no renderer", () => {
    const p = probe((g: Graphics) => {
      g.rect(0, 0, 10, 20).fill(0xff0000);
    });
    expect(p.empty).toBe(false);
    expect(p.bounds.x).toBeCloseTo(0, 1);
    expect(p.bounds.y).toBeCloseTo(0, 1);
    expect(p.bounds.width).toBeCloseTo(10, 1);
    expect(p.bounds.height).toBeCloseTo(20, 1);
    expect(p.fillColors).toContain(0xff0000);
  });

  it("reports an empty draw (no instructions) as empty", () => {
    const p = probe(() => {
      /* draw nothing */
    });
    expect(p.empty).toBe(true);
    expect(p.instructionCount).toBe(0);
  });
});

describe("drawGateBodySymbol geometry (the body gate face)", () => {
  const HW = 20;
  const HH = 16;
  const COLOR = 0x3344ff;

  it("a NAND symbol is centred and stays within its half-extents (+ stroke), in its colour", () => {
    const p = probe((g) => drawGateBodySymbol(g, "NAND", 0, 0, HW, HH, COLOR));
    expect(p.empty).toBe(false);
    const c = probeCenter(p);
    expect(c.x).toBeCloseTo(0, 0); // centred on (0,0) within ~1px
    expect(c.y).toBeCloseTo(0, 0);
    // Never overflow the allotted half-extents by more than the stroke half-width (~1px) + the bubble.
    expect(p.box.minX).toBeGreaterThanOrEqual(-HW - 3);
    expect(p.box.maxX).toBeLessThanOrEqual(HW + 3);
    expect(p.box.minY).toBeGreaterThanOrEqual(-HH - 3);
    expect(p.box.maxY).toBeLessThanOrEqual(HH + 3);
    expect(p.strokeColors).toContain(COLOR);
  });

  it("every recognised gate family draws something; an unrecognised name draws nothing", () => {
    for (const name of [
      "AND",
      "NAND",
      "OR",
      "NOR",
      "XOR",
      "XNOR",
      "NOT",
      "BUFFER",
    ]) {
      const p = probe((g) => drawGateBodySymbol(g, name, 0, 0, HW, HH, COLOR));
      expect(p.empty, `${name} should draw`).toBe(false);
    }
    // recognizeGate yields "LOW"/"HIGH" for constants — drawGateBodySymbol has no shape for those.
    expect(
      probe((g) => drawGateBodySymbol(g, "LOW", 0, 0, HW, HH, COLOR)).empty,
    ).toBe(true);
    expect(
      probe((g) => drawGateBodySymbol(g, "ZZZ", 0, 0, HW, HH, COLOR)).empty,
    ).toBe(true);
  });

  it("an inverted gate (NAND) draws the output bubble (an extra op) but still fits the half-extent", () => {
    const and = probe((g) => drawGateBodySymbol(g, "AND", 0, 0, HW, HH, COLOR));
    const nand = probe((g) =>
      drawGateBodySymbol(g, "NAND", 0, 0, HW, HH, COLOR),
    );
    // The bubble is an extra stroked circle, so NAND emits more instructions than AND…
    expect(nand.instructionCount).toBeGreaterThan(and.instructionCount);
    // …yet both stay within the allotted half-width (the body is pulled in to make room for the bubble).
    expect(nand.box.maxX).toBeLessThanOrEqual(HW + 3);
    expect(and.box.maxX).toBeLessThanOrEqual(HW + 3);
  });
});

describe("drawUserIcPackageBody geometry (free-form vs the pin bbox)", () => {
  // A free-form part: a tall box (wPx=14·, hPx=16·) whose pins sit only in a MIDDLE band — the exact shape
  // that used to render as a short, wide blob. The body must be the AUTHORED box, not the pin bbox.
  const wPx = 140;
  const hPx = 160;
  const COLOR = 0xff66aa;
  // pins on the left/right walls, middle-band y (like the Inv Latch).
  const midBandPins = [
    { x: 0, y: 70 },
    { x: wPx, y: 80 },
    { x: 0, y: 100 },
    { x: wPx, y: 130 },
  ];

  it("free-form body spans the full authored box height, not the pin band", () => {
    const p = probe((g) =>
      drawUserIcPackageBody(g, midBandPins, wPx, hPx, COLOR, true),
    );
    expect(p.empty).toBe(false);
    // The body card reaches y=0..hPx (the authored box), even though the pins only span y≈70..130.
    expect(p.box.minY).toBeLessThanOrEqual(5);
    expect(p.box.maxY).toBeGreaterThanOrEqual(hPx - 5);
    // …and it's PORTRAIT (taller than wide), like the authored box — not a landscape blob.
    expect(p.bounds.height).toBeGreaterThan(p.bounds.width);
    expect(p.strokeColors).toContain(COLOR); // the body ring is the part colour
  });
});

// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { PITCH } from "./boardRender";
import {
  MM_PER_TOP_CELL,
  mmPerScreenPx,
  magnification,
  niceLength,
  formatMm,
  formatMag,
  scaleBar,
} from "./zoomMeter";

describe("zoomMeter", () => {
  it("niceLength snaps DOWN to 1/2/5 × 10^k", () => {
    expect(niceLength(1)).toBe(1);
    expect(niceLength(1.9)).toBe(1);
    expect(niceLength(2)).toBe(2);
    expect(niceLength(4.9)).toBe(2);
    expect(niceLength(5)).toBe(5);
    expect(niceLength(9.9)).toBe(5);
    expect(niceLength(37)).toBe(20);
    expect(niceLength(0.07)).toBeCloseTo(0.05, 12);
    expect(niceLength(0)).toBe(0);
    expect(niceLength(-3)).toBe(0);
    expect(niceLength(Number.NaN)).toBe(0);
  });

  it("formatMm ramps m → mm → µm → nm by magnitude", () => {
    expect(formatMm(2000)).toBe("2 m");
    expect(formatMm(5)).toBe("5 mm");
    expect(formatMm(1)).toBe("1 mm");
    expect(formatMm(0.5)).toBe("500 µm"); // 0.5 mm
    expect(formatMm(0.002)).toBe("2 µm");
    expect(formatMm(5e-6)).toBe("5 nm"); // 5e-6 mm
  });

  it("formatMag is compact across decades", () => {
    expect(formatMag(1)).toBe("×1");
    expect(formatMag(2.5)).toBe("×2.5");
    expect(formatMag(42)).toBe("×42");
    expect(formatMag(1200)).toBe("×1.2k");
    expect(formatMag(3e6)).toBe("×3M");
    expect(formatMag(0)).toBe("×1");
  });

  it("magnification = zoom / viewScale (grows with zoom and with depth)", () => {
    expect(magnification(1, 1)).toBeCloseTo(1, 12);
    expect(magnification(5, 1)).toBeCloseTo(5, 12);
    // inside an IC shrunk to 0.1: same camera zoom reads 10× the magnification.
    expect(magnification(5, 0.1)).toBeCloseTo(50, 12);
  });

  it("mmPerScreenPx: one board cell at zoom 1 spans PITCH px and MM_PER_TOP_CELL mm", () => {
    // mm per px × PITCH px = mm per cell.
    expect(mmPerScreenPx(1, 1) * PITCH).toBeCloseTo(MM_PER_TOP_CELL, 12);
    // doubling zoom halves the physical size per screen px.
    expect(mmPerScreenPx(2, 1)).toBeCloseTo(mmPerScreenPx(1, 1) / 2, 12);
    // descending a level (viewScale 0.1) shrinks the physical size per px 10×.
    expect(mmPerScreenPx(1, 0.1)).toBeCloseTo(mmPerScreenPx(1, 1) / 10, 12);
  });

  it("scaleBar shows CELLS on the open board and a snapped px width near target", () => {
    const bar = scaleBar(1, 1, 90);
    expect(bar.cells).toBe(true);
    expect(bar.label).toMatch(/cells?$/);
    // 90px target / 26px-per-cell ≈ 3.46 cells → snaps to 2 cells → 52px.
    expect(bar.px).toBeCloseTo(2 * PITCH, 9);
    expect(bar.label).toBe("2 cells");
  });

  it("scaleBar switches to physical units once inside an IC, staying near target width", () => {
    const bar = scaleBar(8, 0.05, 90);
    expect(bar.cells).toBe(false);
    expect(bar.label).toMatch(/(mm|µm|nm)$/);
    // the snapped bar is within the same decade as the target (snap is DOWN, so ≥ target/5).
    expect(bar.px).toBeGreaterThan(90 / 5);
    expect(bar.px).toBeLessThanOrEqual(90);
  });

  it("scaleBar label is a round 1/2/5 value", () => {
    const bar = scaleBar(8, 0.05, 90);
    const n = parseFloat(bar.label);
    const mantissa = n / Math.pow(10, Math.floor(Math.log10(n)));
    expect([1, 2, 5]).toContain(Math.round(mantissa));
  });
});

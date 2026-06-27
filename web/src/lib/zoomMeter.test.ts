// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { PITCH } from "./boardRender";
import {
  MM_PER_TOP_CELL,
  MIN_FEATURE_MM,
  CHIP_MM,
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
    expect(formatMm(0.002)).toBe("2 µm");
    expect(formatMm(5e-6)).toBe("5 nm"); // 5e-6 mm
  });

  it("formatMm keeps sub-mm in mm down to 0.1 so the gauge reads monotonically", () => {
    // The bug: flipping the unit at 1 made `1 mm → 0.5 mm` render as `1 → 500 µm`,
    // reading like the gauge jumped UP as you zoomed in. Sub-mm now stays in mm
    // until 0.1, so the ladder is 1 → 0.5 → 0.2 → 0.1 mm → 50 → 20 µm — strictly smaller.
    expect(formatMm(0.5)).toBe("0.5 mm");
    expect(formatMm(0.2)).toBe("0.2 mm");
    expect(formatMm(0.1)).toBe("0.1 mm");
    expect(formatMm(0.05)).toBe("50 µm");
    expect(formatMm(0.02)).toBe("20 µm");
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

  it("scaleBar is metric on the open board too (mm), snapped near the target width", () => {
    const bar = scaleBar(1, 1, 90);
    expect(bar.label).toMatch(/(m|mm|µm|nm)$/);
    // 90px target × (2.5mm / 26px) ≈ 8.65 mm → snaps to 5 mm.
    expect(bar.label).toBe("5 mm");
    // snapped DOWN, so the bar width is within the same decade as the target (≥ target/5, ≤ target).
    expect(bar.px).toBeGreaterThan(90 / 5);
    expect(bar.px).toBeLessThanOrEqual(90);
  });

  it("scaleBar ramps to smaller units as you dive into nested ICs", () => {
    const bar = scaleBar(8, 0.05, 90);
    expect(bar.label).toMatch(/(mm|µm|nm)$/);
    expect(bar.px).toBeGreaterThan(90 / 5);
    expect(bar.px).toBeLessThanOrEqual(90);
  });

  it("scaleBar label is a round 1/2/5 value", () => {
    const bar = scaleBar(8, 0.05, 90);
    const n = parseFloat(bar.label);
    const mantissa = n / Math.pow(10, Math.floor(Math.log10(n)));
    expect([1, 2, 5]).toContain(Math.round(mantissa));
  });

  it("scaleBar FLOORS at the process node — deep nesting never reports sub-node features", () => {
    // A CPU nested ~8 deep + zoomed hard: the raw scale is far below a nanometre, but the rule clamps at
    // MIN_FEATURE_MM (the idealized node) and reads it instead of "0.01 nm".
    const deep = scaleBar(3000, 1e-6, 90);
    expect(deep.label).toBe(formatMm(MIN_FEATURE_MM));
    // The bar never overflows: it widens at most to 2× the target, then holds.
    expect(deep.px).toBeLessThanOrEqual(90 * 2 + 1e-6);
    // Just ABOVE the floor the rule is untouched (normal µm/nm readout, bar ≈ the target width).
    const shallow = scaleBar(8, 0.05, 90);
    expect(parseFloat(shallow.label)).toBeGreaterThan(0);
    expect(shallow.px).toBeLessThanOrEqual(90);
  });

  it("scaleBar RE-ANCHORS to the opened cell's package width — depth-independent (#71)", () => {
    // Same package width on screen ⇒ same reading no matter the global zoom/viewScale: each baked chip is
    // its own scale universe, so a transistor reads ~the same regardless of how deep it's nested.
    expect(CHIP_MM).toBeGreaterThan(0);
    const shallowCell = scaleBar(2, 0.5, 90, 800);
    const deepCell = scaleBar(3000, 1e-6, 90, 800);
    expect(deepCell.label).toBe(shallowCell.label);
    expect(deepCell.px).toBeCloseTo(shallowCell.px, 6);
    // A near-full-screen package (≈800px) reads as a fraction of CHIP_MM — sane mm/µm, not nm and not metres.
    expect(shallowCell.label).toMatch(/mm|µm/);
    // anchorPx 0 (the open board) keeps the top-down bench anchor.
    expect(scaleBar(1, 1, 90, 0).label).toBe(scaleBar(1, 1, 90).label);
  });
});

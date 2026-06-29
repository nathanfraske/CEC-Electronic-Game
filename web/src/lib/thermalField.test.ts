// SPDX-License-Identifier: Apache-2.0
// The board heat-FIELD: a hot source spreads to its neighbours (diffusion), the field decays back to
// ambient when the source is removed (convection), it stays stable at any dt, and it's deterministic.
import { describe, it, expect } from "vitest";
import { ThermalField, infernoCssGradient } from "./thermalField";
import { T_AMBIENT_C } from "./thermal";

describe("board heat field (thermal-lens overlay)", () => {
  it("a sustained source heats its cell and spreads to neighbours over time", () => {
    const f = new ThermalField(11, 11);
    const src = [{ col: 5, row: 5, tempC: 200 }];
    // Before stepping, neighbours are ambient.
    expect(f.at(5, 5)).toBe(T_AMBIENT_C);
    for (let i = 0; i < 60; i++) f.step(src, 0.05); // ~3 s of sim time
    const centre = f.at(5, 5);
    const near = f.at(6, 5);
    const far = f.at(8, 5);
    expect(centre).toBeGreaterThan(150); // the source cell is hot
    expect(near).toBeGreaterThan(T_AMBIENT_C + 10); // heat reached the neighbour
    expect(near).toBeLessThan(centre); // …but cooler than the source (a real gradient)
    expect(far).toBeLessThan(near); // and cooler still further out
  });

  it("decays back toward ambient once the source is removed (still-air convection)", () => {
    const f = new ThermalField(11, 11);
    for (let i = 0; i < 60; i++) f.step([{ col: 5, row: 5, tempC: 200 }], 0.05);
    expect(f.peak()).toBeGreaterThan(100);
    for (let i = 0; i < 400; i++) f.step([], 0.05); // load off, let it cool
    expect(f.peak()).toBeLessThan(T_AMBIENT_C + 2);
  });

  it("stays finite and bounded at a large dt (unconditionally stable)", () => {
    const f = new ThermalField(9, 9);
    f.step([{ col: 4, row: 4, tempC: 300 }], 100); // absurd dt
    let max = -Infinity;
    let min = Infinity;
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++) {
        const v = f.at(c, r);
        expect(Number.isFinite(v)).toBe(true);
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
    expect(max).toBeLessThanOrEqual(300 + 1e-6); // never amplifies past the source
    expect(min).toBeGreaterThanOrEqual(T_AMBIENT_C - 1e-6);
  });

  it("reset returns the whole field to ambient", () => {
    const f = new ThermalField(8, 8);
    for (let i = 0; i < 40; i++) f.step([{ col: 4, row: 4, tempC: 180 }], 0.05);
    expect(f.peak()).toBeGreaterThan(T_AMBIENT_C + 20);
    f.reset();
    expect(f.peak()).toBe(T_AMBIENT_C);
  });

  it("writeImage is transparent at ambient and opaque/hot where heated (inferno)", () => {
    const n = 15;
    // A fresh (all-ambient) field paints fully transparent everywhere — a cold board shows no overlay.
    const cold = new ThermalField(n, n);
    const coldRgba = new Uint8ClampedArray(n * n * 4);
    cold.writeImage(coldRgba, 200);
    for (let i = 0; i < n * n; i++) expect(coldRgba[i * 4 + 3]).toBe(0);
    // After heating, the centre is opaque + bright, and far cells are dimmer than the centre (a gradient).
    const f = new ThermalField(n, n);
    const mid = (n - 1) / 2;
    for (let i = 0; i < 60; i++)
      f.step([{ col: mid, row: mid, tempC: 200 }], 0.05);
    const rgba = new Uint8ClampedArray(n * n * 4);
    f.writeImage(rgba, 200);
    const c = (mid * n + mid) * 4;
    expect(rgba[c + 3]).toBeGreaterThan(150); // centre alpha (opaque)
    expect(rgba[c + 0]).toBeGreaterThan(150); // centre red channel is high when hot
  });

  it("copper conduction: heat follows a copper trace, not the bare board across the gap", () => {
    const n = 21;
    const f = new ThermalField(n, n);
    const mid = (n - 1) / 2;
    // A horizontal copper trace along the middle row; everything else is bare board.
    const copper = new Float32Array(n * n); // 0 = bare
    for (let c = 0; c < n; c++) copper[mid * n + c] = 1; // the trace
    const src = [{ col: 1, row: mid, tempC: 200 }]; // a hot part at the trace's left end
    for (let i = 0; i < 80; i++) f.step(src, 0.05, copper);
    // Heat conducted well ALONG the trace (same row, several cells down it)…
    const alongTrace = f.at(8, mid);
    // …but barely off the trace into the bare board the same distance perpendicular from the source.
    const offTrace = f.at(1, mid - 7);
    expect(alongTrace).toBeGreaterThan(T_AMBIENT_C + 25); // the copper carried the heat down the trace
    expect(offTrace).toBeLessThan(alongTrace - 30); // the bare board did not — a sharp copper/board split
    expect(offTrace).toBeLessThan(T_AMBIENT_C + 5); // heat stayed on the copper
  });

  it("infernoCssGradient mirrors the colourmap as evenly-spaced CSS stops (legend ↔ heatmap sync)", () => {
    const g = infernoCssGradient("to top");
    expect(g.startsWith("linear-gradient(to top, ")).toBe(true);
    // The cold floor and white-hot ceiling of the inferno table, at 0% and 100%.
    expect(g).toContain("rgb(0, 0, 4) 0.0%");
    expect(g).toContain("rgb(255, 255, 224) 100.0%");
    // 10 stops → 9 even segments; the second stop sits at 1/9 ≈ 11.1%.
    expect(g).toContain("11.1%");
    expect((g.match(/rgb\(/g) ?? []).length).toBe(10);
    // Direction is parameterised (the legend strip paints bottom→top = ambient→peak).
    expect(
      infernoCssGradient("to right").startsWith("linear-gradient(to right, "),
    ).toBe(true);
  });

  it("is deterministic — the same drive reproduces the same field exactly", () => {
    const run = () => {
      const f = new ThermalField(13, 9);
      const trace: number[] = [];
      for (let i = 0; i < 200; i++) {
        const src = i < 120 ? [{ col: 6, row: 4, tempC: 180 }] : [];
        f.step(src, 0.02);
        trace.push(f.peak(), f.at(8, 4));
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});

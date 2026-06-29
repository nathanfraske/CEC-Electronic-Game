// SPDX-License-Identifier: Apache-2.0
// The board heat-FIELD: a hot source spreads to its neighbours (diffusion), the field decays back to
// ambient when the source is removed (convection), it stays stable at any dt, and it's deterministic.
import { describe, it, expect } from "vitest";
import { ThermalField } from "./thermalField";
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
    expect(rgba[0 * 4 + 3]).toBeLessThan(rgba[c + 3]); // the corner is dimmer than the centre
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

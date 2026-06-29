// SPDX-License-Identifier: Apache-2.0
/// <reference types="node" />
// The self-heating pipeline end-to-end: build a netlist, solve it on the wasm core, attribute per-part
// dissipated power P = V·I via electricalMap, and integrate each part's body temperature with the lumped
// thermal model. Proves the marquee lesson — a part that burns watts (a low-value "power" resistor)
// heats to Tamb + P·θ_JA, while a high-value resistor and the ideal source stay cool — emerges purely
// from P = V·I, no special-casing. Real mode only.
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { initSync, Simulation } from "../wasm/sim_wasm.js";
import { BoardGraph } from "./graph";
import { buildNetlist, electricalMap } from "./netlist";
import {
  T_AMBIENT_C,
  advanceTemps,
  dissipatedPower,
  steadyTemp,
} from "./thermal";

beforeAll(() => {
  initSync({
    module: readFileSync(new URL("../wasm/sim_wasm_bg.wasm", import.meta.url)),
  });
});

describe("self-heating pipeline (P=V·I → Tj)", () => {
  it("a power resistor heats to its steady Tj; a high-value resistor and the source stay cool", () => {
    const g = new BoardGraph();
    const gnd = g.place("GND", { col: 0, row: 0 })!;
    const v = g.place("V", { col: 0, row: 4 })!;
    v.value = 5;
    // Power resistor: 25 Ω across 5 V → 0.2 A → 1 W dissipated.
    const rPow = g.place("R", { col: 6, row: 2 })!;
    rPow.value = 25;
    // High-value resistor: 10 kΩ → 0.5 mA → 2.5 mW (negligible heat).
    const rCool = g.place("R", { col: 6, row: 6 })!;
    rCool.value = 10000;
    for (const r of [rPow, rCool]) {
      g.connect(
        { componentId: v.id, pinIndex: 0 },
        { componentId: r.id, pinIndex: 0 },
      );
      g.connect(
        { componentId: r.id, pinIndex: 1 },
        { componentId: gnd.id, pinIndex: 0 },
      );
    }
    g.connect(
      { componentId: v.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );

    const nl = buildNetlist(g, true, false)!;
    const sim = new Simulation(0);
    let temps = new Map<number, number>();
    const parts = [
      { id: v.id, kind: "V" },
      { id: rPow.id, kind: "R" },
      { id: rCool.id, kind: "R" },
    ];
    try {
      sim.set_netlist_pefgh(
        nl.nodeCount,
        nl.types,
        nl.a,
        nl.b,
        nl.c,
        nl.d,
        nl.e,
        nl.f,
        nl.g,
        nl.h,
        nl.values,
        nl.aux,
        nl.params,
      );
      // Settle the (purely resistive) circuit electrically — a few ticks is plenty.
      for (let i = 0; i < 200; i++) sim.step();
      const elec = electricalMap(nl, sim.state(), sim.element_currents());
      const powerOf = (id: number) =>
        dissipatedPower(elec.get(id) ?? { current: 0, vAcross: 0 });

      // The power resistor really is burning ~1 W.
      expect(powerOf(rPow.id)).toBeGreaterThan(0.9);
      expect(powerOf(rPow.id)).toBeLessThan(1.1);
      expect(powerOf(rCool.id)).toBeLessThan(0.01);

      // Integrate Tj over ~18 s of SIM time (well past τ≈2.4 s) at a fixed dt — the loop's job.
      const dt = 0.05;
      for (let t = 0; t < 18; t += dt) {
        temps = advanceTemps(temps, parts, powerOf, dt, /*real=*/ true);
      }

      const tPow = temps.get(rPow.id)!;
      const tCool = temps.get(rCool.id)!;
      const tSrc = temps.get(v.id)!;
      // The power resistor settles at Tamb + P·θ_JA ≈ 105 °C.
      expect(tPow).toBeCloseTo(steadyTemp("R", powerOf(rPow.id)), 0);
      expect(tPow).toBeGreaterThan(100);
      // The high-value resistor barely warms; the ideal source never self-heats.
      expect(tCool).toBeLessThan(T_AMBIENT_C + 1);
      expect(tSrc).toBe(T_AMBIENT_C);
    } finally {
      sim.free();
    }
  });

  it("Ideal mode: nothing heats (every part stays at ambient)", () => {
    const g = new BoardGraph();
    const gnd = g.place("GND", { col: 0, row: 0 })!;
    const v = g.place("V", { col: 0, row: 4 })!;
    v.value = 5;
    const r = g.place("R", { col: 6, row: 2 })!;
    r.value = 25;
    g.connect(
      { componentId: v.id, pinIndex: 0 },
      { componentId: r.id, pinIndex: 0 },
    );
    g.connect(
      { componentId: r.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
    g.connect(
      { componentId: v.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
    const nl = buildNetlist(g, false, false)!;
    const sim = new Simulation(0);
    try {
      sim.set_netlist_pefgh(
        nl.nodeCount,
        nl.types,
        nl.a,
        nl.b,
        nl.c,
        nl.d,
        nl.e,
        nl.f,
        nl.g,
        nl.h,
        nl.values,
        nl.aux,
        nl.params,
      );
      for (let i = 0; i < 200; i++) sim.step();
      const elec = electricalMap(nl, sim.state(), sim.element_currents());
      const powerOf = (id: number) =>
        dissipatedPower(elec.get(id) ?? { current: 0, vAcross: 0 });
      let temps = new Map<number, number>();
      const parts = [
        { id: v.id, kind: "V" },
        { id: r.id, kind: "R" },
      ];
      for (let t = 0; t < 18; t += 0.05) {
        temps = advanceTemps(temps, parts, powerOf, 0.05, /*real=*/ false);
      }
      // Ideal mode: the resistor dissipates power, but self-heating is gated off → stays ambient.
      expect(powerOf(r.id)).toBeGreaterThan(0.9);
      expect(temps.get(r.id)!).toBe(T_AMBIENT_C);
    } finally {
      sim.free();
    }
  });
});

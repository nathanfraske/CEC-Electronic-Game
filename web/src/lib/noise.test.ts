// SPDX-License-Identifier: Apache-2.0
/// <reference types="node" />
// Resistor thermal (Johnson) noise. buildNetlist installs a per-resistor noise-current amplitude in the
// noise slot ONLY in Realistic mode; sim-core injects a deterministic, zero-mean per-tick current, so the
// resistor's node fuzzes. This proves (1) the Real-mode-only emission + the 1/√R and tier ordering, and
// (2) the end-to-end behaviour: a divider midpoint visibly varies in Real mode but holds dead steady in
// Ideal mode (a pure resistive divider has no reactive state, so any per-tick variation IS the noise).
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { initSync, Simulation } from "../wasm/sim_wasm.js";
import { BoardGraph } from "./graph";
import { buildNetlist } from "./netlist";
import { resistorNoiseAmp } from "./tiers";

const PARAM_STRIDE = 8;
const NOISE_SLOT = 6;

beforeAll(() => {
  initSync({
    module: readFileSync(new URL("../wasm/sim_wasm_bg.wasm", import.meta.url)),
  });
});

describe("resistor thermal-noise amplitude (tiers.ts)", () => {
  it("is silent at non-positive resistance and scales as 1/√R", () => {
    expect(resistorNoiseAmp(0, 1)).toBe(0);
    expect(resistorNoiseAmp(-5, 1)).toBe(0);
    // Johnson current ∝ 1/√R: a 4× resistance halves the current amplitude.
    const a = resistorNoiseAmp(1_000, 1);
    const b = resistorNoiseAmp(4_000, 1);
    expect(a).toBeGreaterThan(0);
    expect(b / a).toBeCloseTo(0.5, 6);
  });

  it("saturates the lone-resistor node-voltage noise above the knee (a multi-MΩ node can't swing volts)", () => {
    // dv_lone(R) = amp(R)·R. Below the 1 MΩ knee this grows as √R; above it, it must stay bounded so a
    // 9.1 MΩ budget pulldown can't peak into the logic mid-rail (the 3.46σ peak is dv·2√3).
    const dvLone = (r: number, tier: number) => resistorNoiseAmp(r, tier) * r;
    // Below the knee: √R growth (100 kΩ noisier than 10 kΩ).
    expect(dvLone(100_000, 1)).toBeGreaterThan(dvLone(10_000, 1));
    // Above the knee: bounded — a 9.1 MΩ budget node's 3.46σ peak stays clear of the 1.8 V mid-rail floor.
    const peak91MegBudget = dvLone(9_100_000, 0) * 2 * Math.sqrt(3);
    expect(peak91MegBudget).toBeLessThan(1.8);
    // The cap is monotone (more R never reduces it) and tracks tier.
    expect(dvLone(9_100_000, 0)).toBeGreaterThan(dvLone(9_100_000, 3));
  });

  it("a worse grade is noisier (budget > mid > high-end > lab)", () => {
    const r = 10_000;
    const budget = resistorNoiseAmp(r, 0);
    const mid = resistorNoiseAmp(r, 1);
    const high = resistorNoiseAmp(r, 2);
    const lab = resistorNoiseAmp(r, 3);
    expect(budget).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
    expect(high).toBeGreaterThan(lab);
  });
});

describe("resistor noise emission (Real mode only)", () => {
  it("buildNetlist installs the noise amplitude in Real mode and omits it in Ideal mode", () => {
    const g = new BoardGraph();
    const gnd = g.place("GND", { col: 0, row: 0 })!;
    const src = g.place("V", { col: 2, row: 0 })!;
    src.value = 5;
    const r = g.place("R", { col: 8, row: 4 })!;
    r.value = 10_000;
    g.connect(
      { componentId: src.id, pinIndex: 0 },
      { componentId: r.id, pinIndex: 0 },
    );
    g.connect(
      { componentId: r.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
    g.connect(
      { componentId: src.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );

    const real = buildNetlist(g, true, false)!;
    const ideal = buildNetlist(g, false, false)!;
    const ei = real.elemOfComponent.get(r.id)!;
    expect(real.params[ei * PARAM_STRIDE + NOISE_SLOT]).toBeGreaterThan(0);
    expect(ideal.params[ei * PARAM_STRIDE + NOISE_SLOT]).toBe(0);
  });

  it("installs a diode's shot-noise scale in Real mode and omits it in Ideal mode", () => {
    // V → R → D → gnd. The diode (kind "D") gets a shot-noise scale in slot 6 (Real only); sim-core
    // multiplies it by √|I| of the live current.
    const g = new BoardGraph();
    const gnd = g.place("GND", { col: 0, row: 0 })!;
    const src = g.place("V", { col: 2, row: 0 })!;
    src.value = 5;
    const r = g.place("R", { col: 6, row: 0 })!;
    r.value = 100;
    const d = g.place("D", { col: 10, row: 0 })!;
    g.connect(
      { componentId: src.id, pinIndex: 0 },
      { componentId: r.id, pinIndex: 0 },
    );
    g.connect(
      { componentId: r.id, pinIndex: 1 },
      { componentId: d.id, pinIndex: 0 },
    );
    g.connect(
      { componentId: d.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
    g.connect(
      { componentId: src.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );

    const real = buildNetlist(g, true, false)!;
    const ideal = buildNetlist(g, false, false)!;
    const ei = real.elemOfComponent.get(d.id)!;
    expect(real.params[ei * PARAM_STRIDE + NOISE_SLOT]).toBeGreaterThan(0);
    expect(ideal.params[ei * PARAM_STRIDE + NOISE_SLOT]).toBe(0);
  });
});

// A 100k/100k divider; sample the midpoint node over many ticks. Returns the peak-to-peak range.
function dividerMidpointRange(real: boolean): number {
  const g = new BoardGraph();
  const gnd = g.place("GND", { col: 0, row: 0 })!;
  const src = g.place("V", { col: 2, row: 0 })!;
  src.value = 5;
  const r1 = g.place("R", { col: 6, row: -2 })!;
  r1.value = 100_000;
  const r2 = g.place("R", { col: 6, row: 2 })!;
  r2.value = 100_000;
  g.connect(
    { componentId: src.id, pinIndex: 0 },
    { componentId: r1.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: r1.id, pinIndex: 1 },
    { componentId: r2.id, pinIndex: 0 },
  ); // midpoint
  g.connect(
    { componentId: r2.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: src.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );

  const nl = buildNetlist(g, real, false)!;
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
    // The midpoint = r1.pin1 = r2.pin0. Find its node from the netlist's element-b of r1.
    const ei1 = nl.elemOfComponent.get(r1.id)!;
    const midNode = nl.b[ei1];
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 400; i++) {
      sim.step();
      const v = (sim.node_voltages() as Float64Array)[midNode];
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    return max - min;
  } finally {
    sim.free();
  }
}

describe("resistor noise end-to-end (buildNetlist → wasm)", () => {
  it("a divider midpoint fuzzes in Real mode and holds steady in Ideal mode", () => {
    const idealRange = dividerMidpointRange(false);
    const realRange = dividerMidpointRange(true);
    // Ideal: a pure resistive divider settles to exactly 2.5 V every tick — no variation at all.
    expect(idealRange).toBeLessThan(1e-9);
    // Real: the noise visibly fuzzes the midpoint (tens of mV).
    expect(realRange).toBeGreaterThan(5e-3);
  });
});

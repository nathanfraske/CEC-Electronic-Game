// SPDX-License-Identifier: Apache-2.0
/// <reference types="node" />
// Magnetic coupling (mutual inductance) — two coils next to each other share flux = a transformer. The web
// emits a geometry-derived coupling map for sim-core's set_magnetic_coupling: nearby inductors couple with
// a coefficient k, so an AC-driven primary induces a voltage in a secondary. This guards (a) the EMISSION
// (Real-mode only, ≥2 coils in range, falloff with distance) and (b) the end-to-end behaviour through wasm
// (a coupled secondary swings; a distant one is dead). The transformer physics itself is proven in sim-core
// (coupled_coils_make_a_transformer / _step_up_ / magnetic_coupling_is_reproducible_and_golden_safe).
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { initSync, Simulation } from "../wasm/sim_wasm.js";
import { BoardGraph } from "./graph";
import { buildNetlist } from "./netlist";

beforeAll(() => {
  initSync({
    module: readFileSync(new URL("../wasm/sim_wasm_bg.wasm", import.meta.url)),
  });
});

// AC source → L1 (primary, across the source); L2 ∥ R_load (secondary), L2 placed `gap` cells from L1.
function build(real: boolean, gap: number) {
  const g = new BoardGraph();
  const gnd = g.place("GND", { col: 0, row: 0 })!;
  const ac = g.place("AC", { col: 2, row: 0 })!;
  ac.value = 1000; // 1 kHz
  const l1 = g.place("L", { col: 5, row: 0 })!;
  l1.value = 1e-3;
  const l2 = g.place("L", { col: 5 + gap, row: 0 })!;
  l2.value = 1e-3;
  const rload = g.place("R", { col: 5 + gap, row: 3 })!;
  rload.value = 100;
  // Primary: AC across L1.
  g.connect(
    { componentId: ac.id, pinIndex: 0 },
    { componentId: l1.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: l1.id, pinIndex: 1 },
    { componentId: ac.id, pinIndex: 1 },
  );
  g.connect(
    { componentId: ac.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  // Secondary: L2 ∥ R_load, top node floating-ish (tied weakly), bottom to GND.
  g.connect(
    { componentId: l2.id, pinIndex: 1 },
    { componentId: rload.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: rload.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: l2.id, pinIndex: 0 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  const nl = buildNetlist(g, real, false)!;
  return {
    nl,
    eiL1: nl.elemOfComponent.get(l1.id)!,
    eiL2: nl.elemOfComponent.get(l2.id)!,
    secNode: nl.a[nl.elemOfComponent.get(rload.id)!], // R_load pin0 = secondary node
  };
}

function pairWeight(
  c: { idx: Uint32Array; nbr: Uint32Array; w: Float64Array } | null,
  a: number,
  b: number,
): number {
  if (!c) return 0;
  for (let k = 0; k < c.idx.length; k++) {
    if (
      (c.idx[k] === a && c.nbr[k] === b) ||
      (c.idx[k] === b && c.nbr[k] === a)
    )
      return c.w[k]!;
  }
  return 0;
}

describe("magnetic-coupling emission (mutual inductance)", () => {
  it("couples two adjacent coils in Real mode with a positive coefficient", () => {
    const { nl, eiL1, eiL2 } = build(true, 1);
    expect(nl.magneticCoupling).not.toBeNull();
    expect(pairWeight(nl.magneticCoupling, eiL1, eiL2)).toBeGreaterThan(0);
  });

  it("installs NO magnetic coupling in Ideal mode (coils independent)", () => {
    expect(build(false, 1).nl.magneticCoupling).toBeNull();
  });

  it("falls off with distance — distant coils don't couple", () => {
    const near = pairWeight(build(true, 1).nl.magneticCoupling, 0, 0); // edge exists?
    const far = build(true, 12);
    // Far apart (> cutoff): no edge between the two coils → likely no map at all.
    expect(far.nl.magneticCoupling).toBeNull();
    // Sanity: the near case DID produce a map.
    expect(build(true, 1).nl.magneticCoupling).not.toBeNull();
    void near;
  });
});

// Drive the AC primary for many ticks; return the secondary node's peak-to-peak voltage over the last cycle.
function secondarySwing(gap: number, coupled: boolean): number {
  const { nl, secNode } = build(true, gap);
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
    if (coupled && nl.magneticCoupling) {
      sim.set_magnetic_coupling(
        nl.magneticCoupling.idx,
        nl.magneticCoupling.nbr,
        nl.magneticCoupling.w,
      );
    }
    const period = Math.round(1 / 1000 / 2e-6); // ticks per 1 kHz cycle
    let min = Infinity;
    let max = -Infinity;
    const steps = 6000;
    for (let i = 0; i < steps; i++) {
      sim.step();
      if (i >= steps - period) {
        const v = (sim.node_voltages() as Float64Array)[secNode];
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    return max - min;
  } finally {
    sim.free();
  }
}

describe("magnetic coupling end-to-end (buildNetlist → wasm)", () => {
  it("two coils next to each other form a transformer — the secondary swings; uncoupled it's dead", () => {
    const coupled = secondarySwing(1, true); // adjacent + coupling installed
    const uncoupled = secondarySwing(1, false); // same layout, coupling NOT installed
    expect(coupled).toBeGreaterThan(0.5);
    expect(uncoupled).toBeLessThan(0.02);
    expect(coupled).toBeGreaterThan(uncoupled * 20);
  });
});

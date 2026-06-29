// SPDX-License-Identifier: Apache-2.0
/// <reference types="node" />
// The buildable coupled-coil transformer part (XF): a single placeable component that expands into two
// magnetically-coupled inductors (primary + secondary) with an always-on tight coupling, so an AC-driven
// primary induces a voltage in the secondary. Unlike the proximity coupling between loose coils, the XF's
// windings couple in BOTH fidelity modes (a transformer always transforms). Guards the expansion + coupling
// emission and the end-to-end transformer action through wasm.
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { initSync, Simulation } from "../wasm/sim_wasm.js";
import { BoardGraph } from "./graph";
import { buildNetlist } from "./netlist";

const ELEM_INDUCTOR = 3;

beforeAll(() => {
  initSync({
    module: readFileSync(new URL("../wasm/sim_wasm_bg.wasm", import.meta.url)),
  });
});

// AC → XF primary (P+/P−); secondary (S+/S−) → R_load to ground (S− grounded). `n` = turns ratio.
function build(real: boolean, n: number) {
  const g = new BoardGraph();
  const gnd = g.place("GND", { col: 0, row: 0 })!;
  const ac = g.place("AC", { col: 2, row: 0 })!;
  ac.value = 1000; // 1 kHz
  const xf = g.place("XF", { col: 6, row: 0 })!;
  xf.value = n;
  const rload = g.place("R", { col: 12, row: 0 })!;
  rload.value = 1000;
  // Primary: AC across P+/P−.
  g.connect(
    { componentId: ac.id, pinIndex: 0 },
    { componentId: xf.id, pinIndex: 0 },
  ); // P+
  g.connect(
    { componentId: xf.id, pinIndex: 1 },
    { componentId: ac.id, pinIndex: 1 },
  ); // P−
  g.connect(
    { componentId: ac.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  // Secondary: S+ → R_load → GND; S− → GND.
  g.connect(
    { componentId: xf.id, pinIndex: 2 },
    { componentId: rload.id, pinIndex: 0 },
  ); // S+
  g.connect(
    { componentId: rload.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: xf.id, pinIndex: 3 },
    { componentId: gnd.id, pinIndex: 0 },
  ); // S−
  const nl = buildNetlist(g, real, false)!;
  const priIdx = nl.elemOfComponent.get(xf.id)!;
  const secIdx = nl.legsOfComponent.get(xf.id)![0]!;
  return { nl, priIdx, secIdx, secNode: nl.a[secIdx] };
}

describe("coupled-coil transformer part (XF)", () => {
  it("expands into two inductors coupled in BOTH fidelity modes (a transformer always couples)", () => {
    for (const real of [true, false]) {
      const { nl, priIdx, secIdx } = build(real, 2);
      // Both expanded windings are inductors.
      expect(nl.types[priIdx]).toBe(ELEM_INDUCTOR);
      expect(nl.types[secIdx]).toBe(ELEM_INDUCTOR);
      // A coupling edge between them is installed regardless of mode.
      expect(nl.magneticCoupling).not.toBeNull();
      let found = false;
      const c = nl.magneticCoupling!;
      for (let k = 0; k < c.idx.length; k++) {
        if (
          (c.idx[k] === priIdx && c.nbr[k] === secIdx) ||
          (c.idx[k] === secIdx && c.nbr[k] === priIdx)
        ) {
          found = true;
          expect(c.w[k]).toBeGreaterThan(0.5); // a tight, fixed coupling
        }
      }
      expect(found).toBe(true);
    }
  });

  it("sets the secondary inductance by the turns ratio (L ∝ N²)", () => {
    const a = build(true, 1); // 1:1 → equal inductances
    const b = build(true, 2); // 1:2 → secondary 4×
    expect(a.nl.values[a.secIdx]).toBeCloseTo(a.nl.values[a.priIdx]!, 9);
    expect(b.nl.values[b.secIdx] / b.nl.values[b.priIdx]!).toBeCloseTo(4, 6);
  });

  it("transforms end-to-end: an AC primary drives the secondary (~n× the primary swing)", () => {
    const n = 2;
    const { nl, secNode } = build(true, n);
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
      if (nl.magneticCoupling) {
        sim.set_magnetic_coupling(
          nl.magneticCoupling.idx,
          nl.magneticCoupling.nbr,
          nl.magneticCoupling.w,
        );
      }
      const period = Math.round(1 / 1000 / 2e-6);
      let min = Infinity;
      let max = -Infinity;
      const steps = 8000;
      for (let i = 0; i < steps; i++) {
        sim.step();
        if (i >= steps - period) {
          const v = (sim.node_voltages() as Float64Array)[secNode];
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
      // The secondary develops a clear AC swing (a step-up, so several volts pp).
      expect(max - min).toBeGreaterThan(2);
    } finally {
      sim.free();
    }
  });
});

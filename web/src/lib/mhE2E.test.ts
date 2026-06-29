// SPDX-License-Identifier: Apache-2.0
/// <reference types="node" />
// Mutual heating end-to-end (buildNetlist coupling → wasm set_thermal_coupling → solve). A high-impedance
// NTC divider barely self-heats, so on its own it reads ~ambient and its midpoint sits at ~½ Vcc. Install
// the geometry-derived coupling from a hot resistor beside it and the NTC SENSES that heat: its Tj climbs,
// its R(T) drops, and the divider midpoint it sits in moves — a temperature reading that re-enters the
// solve. Proves the whole chain the unit tests only cover in pieces (emission in netlist, physics in
// sim-core); the binding wiring (set_thermal_coupling across the wasm boundary) is exercised here.
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

function drive(
  coupled: boolean,
  steps: number,
): { mid: number; ntcTj: number } {
  const g = new BoardGraph();
  const gnd = g.place("GND", { col: 0, row: 0 })!;
  const v = g.place("V", { col: 2, row: 0 })!;
  v.value = 10;
  const rtop = g.place("R", { col: 6, row: 0 })!;
  rtop.value = 10000;
  const ntc = g.place("NTC", { col: 10, row: 0 })!;
  ntc.value = 10000;
  const rhot = g.place("R", { col: 12, row: 0 })!;
  rhot.value = 20;
  g.connect(
    { componentId: v.id, pinIndex: 0 },
    { componentId: rtop.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: rtop.id, pinIndex: 1 },
    { componentId: ntc.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: ntc.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: rhot.id, pinIndex: 0 },
    { componentId: v.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: rhot.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: v.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  const nl = buildNetlist(g, true, false)!;
  const eiNtc = nl.elemOfComponent.get(ntc.id)!;
  const midNode = nl.a[eiNtc]; // NTC pin0 = divider midpoint
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
    if (coupled && nl.coupling) {
      sim.set_thermal_coupling(nl.coupling.idx, nl.coupling.nbr, nl.coupling.w);
    }
    for (let i = 0; i < steps; i++) sim.step();
    return {
      mid: (sim.node_voltages() as Float64Array)[midNode],
      ntcTj: sim.element_temperature(eiNtc),
    };
  } finally {
    sim.free();
  }
}

describe("mutual heating end-to-end (buildNetlist → wasm)", () => {
  it("a thermistor senses a hot neighbour — its Tj climbs and the divider it sits in shifts", () => {
    const n = 600_000; // ~½ the thermal time constant: the NTC partly heats, plenty to read
    const un = drive(false, n); // no coupling installed (control)
    const co = drive(true, n); // coupling from the hot resistor installed
    // Uncoupled: the high-impedance NTC barely self-heats → near ambient, midpoint ≈ ½ Vcc.
    expect(un.ntcTj).toBeLessThan(28);
    expect(un.mid).toBeGreaterThan(4.5);
    // Coupled: the NTC senses the hot resistor → Tj climbs well above the uncoupled case...
    expect(co.ntcTj).toBeGreaterThan(un.ntcTj + 8);
    // ...its R(T) drops, so the divider midpoint moves a clear, readable amount (the sensor output).
    expect(un.mid - co.mid).toBeGreaterThan(1);
  });
});

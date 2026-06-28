// SPDX-License-Identifier: Apache-2.0
/// <reference types="node" />
// Headless test for the RAM chip (ELEM_MEMORY) end-to-end: place a RAM part, build the web netlist, install
// it on a wasm Simulation, drive the address/WE/D_in terminals, and read the stored bit back on D_out. Proves
// the buildNetlist → ELEM_MEMORY emission + params wire up to the real engine. (sim-core's own memory tests
// cover the element; this covers the web emission path.)
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

// RAM pins (graph.ts PART_KINDS.RAM): 0=D_out, 1=A0, 2=A1, 3=A2, 4=WE, 5=D_in, 6=VCC, 7=GND.
function doutAfterWrite(dinV: number): number {
  const g = new BoardGraph();
  const ram = g.place("RAM", { col: 20, row: 10 })!;
  const gnd = g.place("GND", { col: 0, row: 0 })!;
  const mkV = (v: number, col: number, pin: number) => {
    const s = g.place("V", { col, row: 0 })!;
    s.value = v;
    g.connect(
      { componentId: s.id, pinIndex: 0 },
      { componentId: ram.id, pinIndex: pin },
    );
    g.connect(
      { componentId: s.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
  };
  mkV(5, 2, 6); // VCC
  g.connect(
    { componentId: ram.id, pinIndex: 7 },
    { componentId: gnd.id, pinIndex: 0 },
  ); // GND
  mkV(5, 4, 4); // WE high (write enabled)
  mkV(dinV, 6, 5); // D_in
  mkV(0, 8, 1); // A0 = 0
  mkV(0, 10, 2); // A1 = 0
  mkV(0, 12, 3); // A2 = 0  → address 0
  const r = g.place("R", { col: 14, row: -5 })!; // D_out load so its node is defined
  r.value = 1e6;
  g.connect(
    { componentId: r.id, pinIndex: 0 },
    { componentId: ram.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: r.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );

  const nl = buildNetlist(g, false, false)!;
  expect(nl).toBeTruthy();
  const dout = nl.nodesOfComponent.get(ram.id)![0];
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
    for (let i = 0; i < 20; i++) sim.step();
    return sim.state()[dout] ?? 0;
  } finally {
    sim.free();
  }
}

describe("RAM chip (ELEM_MEMORY) web netlist path", () => {
  it("writes a 1 and reads it back on D_out", () => {
    expect(doutAfterWrite(5)).toBeGreaterThan(2.5);
  });
  it("writes a 0 and reads it back on D_out", () => {
    expect(doutAfterWrite(0)).toBeLessThan(2.5);
  });
});

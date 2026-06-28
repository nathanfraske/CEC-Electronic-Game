// SPDX-License-Identifier: Apache-2.0
/// <reference types="node" />
// The NAND flash chip (ELEM_MEMORY mode 4) end-to-end: place a FLASH part, build the web netlist, install on
// a wasm Simulation, drive the ERASE / WE / D_in / address terminals, and read D_out. Proves the
// buildNetlist → mode-4 emission (the ERASE pin on terminal h, addrWidth 2) wires to the engine's flash
// physics: program clears bits (1→0), ERASE restores 1s, and a 0→1 program without erasing FAILs.
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

// FLASH pins (graph.ts PART_KINDS.FLASH): 0=D, 1=A0, 2=A1, 3=WE, 4=DI, 5=ERASE, 6=VCC, 7=GND.
function flashDrive(o: {
  we: number;
  din: number;
  a0: number;
  a1: number;
  erase: number;
  seed: number[];
}): { dout: number; failed: boolean } {
  const g = new BoardGraph();
  const flash = g.place("FLASH", { col: 20, row: 10 })!;
  const gnd = g.place("GND", { col: 0, row: 0 })!;
  const mkV = (v: number, col: number, pin: number) => {
    const s = g.place("V", { col, row: 0 })!;
    s.value = v;
    g.connect(
      { componentId: s.id, pinIndex: 0 },
      { componentId: flash.id, pinIndex: pin },
    );
    g.connect(
      { componentId: s.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
  };
  mkV(5, 2, 6); // VCC
  g.connect(
    { componentId: flash.id, pinIndex: 7 },
    { componentId: gnd.id, pinIndex: 0 },
  ); // GND
  mkV(o.we, 4, 3); // WE
  mkV(o.din, 6, 4); // D_in
  mkV(o.a0, 8, 1); // A0
  mkV(o.a1, 10, 2); // A1
  mkV(o.erase, 12, 5); // ERASE
  const r = g.place("R", { col: 14, row: -5 })!; // D_out load so its node is defined
  r.value = 1e6;
  g.connect(
    { componentId: r.id, pinIndex: 0 },
    { componentId: flash.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: r.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );

  const nl = buildNetlist(g, false, false)!;
  const dout = nl.nodesOfComponent.get(flash.id)![0];
  const elem = nl.elemOfComponent.get(flash.id)!;
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
    if (o.seed.length) sim.load_memory(elem, new Uint32Array(o.seed));
    for (let i = 0; i < 20; i++) sim.step();
    return { dout: sim.state()[dout] ?? 0, failed: sim.failed() };
  } finally {
    sim.free();
  }
}

describe("NAND flash chip (ELEM_MEMORY mode 4) web netlist path", () => {
  it("ERASE resets a word to 1 (D_out reads high)", () => {
    const r = flashDrive({
      we: 0,
      din: 0,
      a0: 0,
      a1: 0,
      erase: 5,
      seed: [0, 0, 0, 0],
    });
    expect(r.dout).toBeGreaterThan(2.5);
  });
  it("program clears a bit 1→0 (D_out reads low)", () => {
    // Erased word (1) programmed with D_in=0 → 0.
    const r = flashDrive({
      we: 5,
      din: 0,
      a0: 0,
      a1: 0,
      erase: 0,
      seed: [1, 1, 1, 1],
    });
    expect(r.dout).toBeLessThan(2.5);
  });
  it("a 0→1 program without erasing first is a no-op that FAILs the device", () => {
    const r = flashDrive({
      we: 5,
      din: 5,
      a0: 0,
      a1: 0,
      erase: 0,
      seed: [0, 1, 1, 1],
    });
    expect(r.dout).toBeLessThan(2.5); // the bit stayed 0 — you cannot just overwrite
    expect(r.failed).toBe(true); // erase-before-write violation flags the chip
  });
});

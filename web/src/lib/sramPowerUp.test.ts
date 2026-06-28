// SPDX-License-Identifier: Apache-2.0
/// <reference types="node" />
// An UNWRITTEN transistor 6T SRAM cell powers up to a definite bit in Realistic mode (the metastability
// break), but sits at the metastable mid-rail in Ideal mode. Place the owner's 6T SRAM prefab, hold the
// word-line LOW (the cell is isolated — never written), power it up, step, and read the internal storage
// nodes. In Real mode buildNetlist emits a per-device Vth mismatch (slot 1) and sim-core's
// `break_metastable_latches` drops the cross-coupled pair onto a rail; in Ideal mode every device is
// nominal and the symmetric cell holds Q ≈ Q̄ ≈ VCC/2. Also checks the power-up bit is deterministic.
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initSync, Simulation } from "../wasm/sim_wasm.js";
import { BoardGraph } from "./graph";
import { buildNetlist } from "./netlist";
import { PREFAB_USER_ICS, registerPrefabLibrary } from "./circuits/prefabs";
import { unregisterUserIc } from "./userIc";

beforeAll(() => {
  initSync({
    module: readFileSync(new URL("../wasm/sim_wasm_bg.wasm", import.meta.url)),
  });
  registerPrefabLibrary();
});
afterAll(() => {
  for (const ic of PREFAB_USER_ICS) unregisterUserIc(ic.tag);
});

// 6T SRAM prefab pins: WL(0), VCC(1), GND(2), BLB(3), BL(4). Power it up with the word-line held LOW
// (access transistors off → the cell is isolated and never written). The bit-lines are tied to ground
// through large resistors so their nodes are defined without driving the cell. Returns every node
// voltage after settling — the unwritten power-up state.
function powerUpState(real: boolean): number[] {
  const g = new BoardGraph();
  const sram = g.place("6T SRAM", { col: 20, row: 10 })!;
  const gnd = g.place("GND", { col: 0, row: 0 })!;
  const dc = (v: number, col: number, pin: number) => {
    const s = g.place("V", { col, row: 0 })!;
    s.value = v;
    g.connect(
      { componentId: s.id, pinIndex: 0 },
      { componentId: sram.id, pinIndex: pin },
    );
    g.connect(
      { componentId: s.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
  };
  dc(5, 2, 1); // VCC
  g.connect(
    { componentId: sram.id, pinIndex: 2 },
    { componentId: gnd.id, pinIndex: 0 },
  ); // GND
  dc(0, 4, 0); // WL held LOW — the cell is never written
  // Tie each bit-line to ground through a large resistor (defines the node; isolated by the off
  // access transistors, so it cannot write the cell).
  for (const pin of [3, 4]) {
    const r = g.place("R", { col: 6 + pin, row: -5 })!;
    r.value = 1e6;
    g.connect(
      { componentId: r.id, pinIndex: 0 },
      { componentId: sram.id, pinIndex: pin },
    );
    g.connect(
      { componentId: r.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
  }

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
    // It really is the transistor-level cell (6 MOSFETs), not a collapsed behavioral box.
    const nMos = nl.types.filter((t: number) => t === 11 || t === 12).length;
    expect(nMos).toBe(6);
    for (let i = 0; i < 60; i++) sim.step();
    return Array.from(sim.state() as Float64Array);
  } finally {
    sim.free();
  }
}

// Count internal nodes stuck in the metastable band (mid-rail, ~VCC/2). The two cross-coupled storage
// nodes Q / Q̄ land here iff the cell never picked a bit.
const midRailCount = (v: number[]) =>
  v.filter((x) => x > 1.8 && x < 3.2).length;

describe("unwritten transistor 6T SRAM power-up (metastability break)", () => {
  it("Ideal mode: a perfectly symmetric cell sits at the metastable mid-rail", () => {
    const v = powerUpState(false);
    // Q and Q̄ both float to ~VCC/2 — no definite bit.
    expect(midRailCount(v)).toBeGreaterThanOrEqual(2);
  });

  it("Real mode: fab mismatch makes it power up to a definite, complementary bit", () => {
    const v = powerUpState(true);
    // No storage node left stuck mid-rail — the cross-coupled pair latched to the rails.
    expect(midRailCount(v)).toBe(0);
    // A clean stored high and a clean stored low both exist (a real, complementary bit).
    expect(v.some((x) => x > 4.5)).toBe(true);
    expect(v.some((x) => x > -0.5 && x < 0.5)).toBe(true);
  });

  it("Real mode: the power-up bit is deterministic (same state every boot)", () => {
    const a = powerUpState(true);
    const b = powerUpState(true);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 6);
  });
});

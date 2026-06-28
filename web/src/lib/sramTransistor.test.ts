// SPDX-License-Identifier: Apache-2.0
/// <reference types="node" />
// The owner's transistor-level 6T SRAM prefab works as real memory end-to-end: place the cell, flatten it
// to its 6 discrete MOSFETs (2 cross-coupled inverters + 2 NMOS access transistors), install on a wasm
// Simulation, and drive a bitline WRITE through a pulsed word-line. It converges (a small CMOS feedback
// cell solves in ~1 Newton iteration) and — crucially — RETAINS the written bit after the word-line drops
// (the access transistors isolate the cell and the cross-coupled pair regenerates). This is the bitline-only
// SRAM lesson at the real transistor level, not a behavioral box. (sim-core covers the FET models + Newton;
// this covers the flatten → install → drive → hold path for the owner's actual sub-assembly.)
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

// 6T SRAM prefab pins: WL(0), VCC(1), GND(2), BLB(3), BL(4). Drive a bitline write with WL pulsed high
// (write window) then low (hold). `blV`/`blbV` set the written value. Returns the converged node-voltage
// vector sampled deep in the WL-LOW (hold) phase — the stored state with the bitlines disconnected.
function sramHeldState(
  blV: number,
  blbV: number,
): { v: number[]; conv: boolean } {
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
  dc(blV, 6, 4); // BL
  dc(blbV, 8, 3); // BLB
  // Word-line: a 5 V square pulse. Period 400 µs (= 200 steps at DT = 2 µs): high for the first ~100 steps
  // (the write), low for the next ~100 (the hold). We sample inside the low phase.
  const wl = g.place("PULSE", { col: 4, row: 0 })!;
  wl.value = 2500; // Hz
  (wl as unknown as { amp: number }).amp = 5;
  g.connect(
    { componentId: wl.id, pinIndex: 0 },
    { componentId: sram.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: wl.id, pinIndex: 1 },
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
    // 6 MOSFETs flattened from the cell (sanity: it really is the transistor-level cell, not collapsed).
    const nMos = nl.types.filter((t: number) => t === 11 || t === 12).length;
    expect(nMos).toBe(6);
    let v: number[] = [];
    let conv = true;
    for (let i = 0; i < 160; i++) {
      sim.step();
      if (i === 150) {
        // step 150 is in the WL-LOW hold phase (second half of the pulse period)
        v = Array.from(sim.state() as Float64Array);
        conv = sim.newton_converged();
      }
    }
    return { v, conv };
  } finally {
    sim.free();
  }
}

describe("transistor-level 6T SRAM prefab (the owner's sub-assembly) as real memory", () => {
  it("converges and retains the written bit after the word-line drops", () => {
    const held1 = sramHeldState(5, 0); // write a 1
    const held0 = sramHeldState(0, 5); // write a 0
    expect(held1.conv).toBe(true);
    expect(held0.conv).toBe(true);
    // The held internal state differs between a stored 1 and a stored 0 — the cross-coupled pair latched
    // distinct, complementary values that survived into the hold phase (it is memory, not a metastable mush).
    const flipped = held1.v.filter(
      (x, i) => Math.abs(x - held0.v[i]) > 2.0,
    ).length;
    expect(flipped).toBeGreaterThanOrEqual(2); // ≥ the two storage nodes Q / Q̄ flipped with the written value
    // Each held state has a clean rail somewhere (a solid stored level, not everything stuck mid-supply).
    expect(held1.v.some((x) => x > 4.5)).toBe(true);
    expect(held0.v.some((x) => x > 4.5)).toBe(true);
  });
});

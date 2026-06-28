// SPDX-License-Identifier: Apache-2.0
/// <reference types="node" />
// Capacitor leakage (Real mode) + a transistor 1T1C DRAM cell that decays. buildNetlist installs a
// per-tier self-discharge time constant in the cap's leak slot ONLY in Realistic mode; sim-core stamps
// a parallel G = C/tau, so a charged cap bleeds off. This proves (1) the Real-mode-only emission and
// (2) the end-to-end DRAM behaviour: a written 1T1C cell loses its bit over time in Real mode (refresh
// or it rots) but holds forever in Ideal mode.
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { initSync, Simulation } from "../wasm/sim_wasm.js";
import { BoardGraph } from "./graph";
import { buildNetlist } from "./netlist";

const PARAM_STRIDE = 8;
const CAP_LEAK_SLOT = 5;

beforeAll(() => {
  initSync({
    module: readFileSync(new URL("../wasm/sim_wasm_bg.wasm", import.meta.url)),
  });
});

describe("capacitor leakage emission (Real mode only)", () => {
  it("buildNetlist installs the cap leak tau in Real mode and omits it in Ideal mode", () => {
    const g = new BoardGraph();
    const gnd = g.place("GND", { col: 0, row: 0 })!;
    const cap = g.place("C", { col: 8, row: 4 })!;
    cap.value = 1e-6;
    cap.tier = 0; // budget → leakiest
    const src = g.place("V", { col: 2, row: 0 })!;
    src.value = 5;
    g.connect(
      { componentId: src.id, pinIndex: 0 },
      { componentId: cap.id, pinIndex: 0 },
    );
    g.connect(
      { componentId: src.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
    g.connect(
      { componentId: cap.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );

    const real = buildNetlist(g, true, false)!;
    const ideal = buildNetlist(g, false, false)!;
    const ei = real.elemOfComponent.get(cap.id)!;
    expect(real.params[ei * PARAM_STRIDE + CAP_LEAK_SLOT]).toBeGreaterThan(0);
    expect(ideal.params[ei * PARAM_STRIDE + CAP_LEAK_SLOT]).toBe(0);
  });
});

// Transistor 1T1C DRAM cell: access NMOS (D=bit-line, S=storage node, G=word-line) + storage cap. A
// long word-line pulse writes BL=5 onto the cap, then holds (access OFF) while we watch the storage
// node. Returns SN early in the hold and deep in the hold.
function dramHold(real: boolean): { early: number; late: number } {
  const g = new BoardGraph();
  const gnd = g.place("GND", { col: 0, row: 0 })!;
  const fet = g.place("NM", { col: 10, row: 5 })!;
  const cap = g.place("C", { col: 14, row: 8 })!;
  cap.value = 1e-9;
  cap.tier = 0; // budget cap → shortest tau (most visible decay)
  g.connect(
    { componentId: cap.id, pinIndex: 0 },
    { componentId: fet.id, pinIndex: 1 },
  ); // cap+ → storage node (NMOS S)
  g.connect(
    { componentId: cap.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  const bl = g.place("V", { col: 4, row: 0 })!;
  bl.value = 5;
  g.connect(
    { componentId: bl.id, pinIndex: 0 },
    { componentId: fet.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: bl.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  // Word-line: a slow square pulse (2 Hz → 0.5 s period = 250k steps; high first ~125k = write, low
  // next ~125k = hold). We sample inside the long hold.
  const wl = g.place("PULSE", { col: 4, row: 4 })!;
  wl.value = 2;
  (wl as unknown as { amp: number }).amp = 5;
  g.connect(
    { componentId: wl.id, pinIndex: 0 },
    { componentId: fet.id, pinIndex: 2 },
  );
  g.connect(
    { componentId: wl.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );

  const nl = buildNetlist(g, real, false)!;
  const sn = nl.nodesOfComponent.get(cap.id)![0];
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
    let early = 0;
    let late = 0;
    for (let i = 0; i <= 240_000; i++) {
      if (i === 130_000) early = sim.state()[sn] ?? 0; // just after the write, into hold
      sim.step();
    }
    late = sim.state()[sn] ?? 0; // ~110k steps deeper into the same hold
    return { early, late };
  } finally {
    sim.free();
  }
}

describe("transistor 1T1C DRAM cell retention", () => {
  it("Real mode: the written charge decays during the hold (refresh or it rots)", () => {
    const r = dramHold(true);
    // The cell was written to the NMOS-passed weak-1 (~3 V), then leaked measurably over the hold.
    expect(r.early).toBeGreaterThan(2.0);
    expect(r.late).toBeLessThan(r.early - 0.3); // clearly decayed
  });

  it("Ideal mode: the cell holds its bit indefinitely (perfect cap, no leak)", () => {
    const r = dramHold(false);
    expect(r.early).toBeGreaterThan(2.0);
    expect(Math.abs(r.late - r.early)).toBeLessThan(0.02); // rock-steady
  });
});

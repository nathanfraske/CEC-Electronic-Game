// SPDX-License-Identifier: Apache-2.0
/// <reference types="node" />
// BJT thermal runaway, end-to-end (buildNetlist → wasm). The web tags a BJT with its Is-tempco γ in
// Realistic mode only (slot TEMPCO_SLOT), and sim-core's per-tick Is(T) feedback then makes the collector
// current climb with junction temperature. This proves the two compose: a Real-mode BJT at a fixed base
// bias has its collector measurably dragged down (Ic running away) while an Ideal-mode BJT holds dead
// steady, and an emitter ballast resistor suppresses the runaway. (The full collapse / settling Tj is
// proven deterministically in sim-core's bjt_thermal_runaway; here we only need the trend to confirm the
// emission reaches the solve — a short horizon keeps it fast.)
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
  real: boolean,
  re: number,
  steps: number,
): { vc0: number; vcN: number } {
  const g = new BoardGraph();
  const gnd = g.place("GND", { col: 0, row: 0 })!;
  const vcc = g.place("V", { col: 2, row: 0 })!;
  vcc.value = 24;
  const rc = g.place("R", { col: 4, row: 0 })!;
  rc.value = 15;
  const vb = g.place("V", { col: 2, row: 4 })!;
  vb.value = 0.78;
  const q = g.place("Q", { col: 8, row: 0 })!;
  // Vcc+ → Rc → collector(0); base(2) ← Vb+; emitter(1) → Re → GND (or GND directly).
  g.connect(
    { componentId: vcc.id, pinIndex: 0 },
    { componentId: rc.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: rc.id, pinIndex: 1 },
    { componentId: q.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: q.id, pinIndex: 2 },
    { componentId: vb.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: vcc.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: vb.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  if (re > 0) {
    const reR = g.place("R", { col: 8, row: 4 })!;
    reR.value = re;
    g.connect(
      { componentId: q.id, pinIndex: 1 },
      { componentId: reR.id, pinIndex: 0 },
    );
    g.connect(
      { componentId: reR.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
  } else {
    g.connect(
      { componentId: q.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
  }
  const nl = buildNetlist(g, real, false)!;
  const eiQ = nl.elemOfComponent.get(q.id)!;
  const cNode = nl.a[eiQ]; // collector node
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
    const vAt = () => (sim.node_voltages() as Float64Array)[cNode];
    sim.step();
    const vc0 = vAt();
    for (let i = 0; i < steps; i++) sim.step();
    return { vc0, vcN: vAt() };
  } finally {
    sim.free();
  }
}

describe("BJT thermal runaway end-to-end (buildNetlist → wasm)", () => {
  it("a Real-mode BJT's collector runs away while an Ideal one holds steady, and a ballast tames it", () => {
    const n = 400_000; // short horizon: enough for the feedback to engage measurably, far before full settling
    const ideal = drive(false, 0, n);
    const real = drive(true, 0, n);
    const ballast = drive(true, 4.7, n);
    const dIdeal = ideal.vc0 - ideal.vcN;
    const dReal = real.vc0 - real.vcN;
    const dBallast = ballast.vc0 - ballast.vcN;
    // Ideal mode arms no thermal feedback (Is = BJT_IS), so the collector is dead steady tick-to-tick.
    expect(Math.abs(dIdeal)).toBeLessThan(1e-6);
    // Real mode: Is(T) climbs with the self-heating Tj → Ic rises → the collector is pulled measurably down.
    expect(dReal).toBeGreaterThan(0.05);
    // An emitter ballast resistor suppresses the runaway: the collector barely moves vs the unballasted case.
    expect(dBallast).toBeLessThan(dReal / 3);
  });
});

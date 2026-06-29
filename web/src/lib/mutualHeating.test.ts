// SPDX-License-Identifier: Apache-2.0
// Mutual heating — the geometry-derived thermal-coupling map buildNetlist emits for sim-core's
// set_thermal_coupling. A hot part heats a nearby thermistor, which SENSES it (its R(T) shifts the
// circuit). This guards the EMISSION: edges appear (a) only in Real mode, (b) only when a part whose Tj
// re-enters the solve (a thermistor / BJT) is present, (c) between parts within the proximity cutoff and
// not between distant ones, and (d) with normalised, passive (< 1) weights. The runaway/sensor BEHAVIOUR
// itself is proven deterministically in sim-core (thermistor_senses_neighbor_heat / mutual_heating_*).
import { describe, it, expect } from "vitest";
import { BoardGraph } from "./graph";
import { buildNetlist } from "./netlist";

// A divider V → R_top → NTC → GND, plus a hot resistor R_hot from Vcc to GND placed `gap` cells from the
// NTC. Returns the built netlist (Real or Ideal).
function build(real: boolean, gap: number) {
  const g = new BoardGraph();
  const gnd = g.place("GND", { col: 0, row: 0 })!;
  const v = g.place("V", { col: 2, row: 0 })!;
  v.value = 10;
  const rtop = g.place("R", { col: 6, row: 0 })!;
  rtop.value = 10000;
  const ntc = g.place("NTC", { col: 10, row: 0 })!;
  ntc.value = 10000;
  const rhot = g.place("R", { col: 10 + gap, row: 0 })!;
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
  const nl = buildNetlist(g, real, false)!;
  return {
    nl,
    eiNtc: nl.elemOfComponent.get(ntc.id)!,
    eiHot: nl.elemOfComponent.get(rhot.id)!,
  };
}

// Does the coupling contain a directed edge (receiver → source) with a positive weight?
function edgeWeight(
  coupling: { idx: Uint32Array; nbr: Uint32Array; w: Float64Array } | null,
  receiver: number,
  source: number,
): number {
  if (!coupling) return 0;
  for (let k = 0; k < coupling.idx.length; k++) {
    if (coupling.idx[k] === receiver && coupling.nbr[k] === source)
      return coupling.w[k]!;
  }
  return 0;
}

describe("thermal-coupling emission (mutual heating)", () => {
  it("couples a thermistor to a nearby hot resistor in Real mode (both directions, positive weight)", () => {
    const { nl, eiNtc, eiHot } = build(true, 2); // adjacent
    expect(nl.coupling).not.toBeNull();
    expect(edgeWeight(nl.coupling, eiNtc, eiHot)).toBeGreaterThan(0); // NTC senses the hot resistor
    expect(edgeWeight(nl.coupling, eiHot, eiNtc)).toBeGreaterThan(0); // mutual (symmetric)
  });

  it("installs NO coupling in Ideal mode (golden-clean — heat never re-enters the solve)", () => {
    const { nl } = build(false, 2);
    expect(nl.coupling).toBeNull();
  });

  it("installs NO coupling without a sensing part (plain resistors only → no circuit effect)", () => {
    // V → R → R → GND: two resistors, no thermistor/BJT, so coupling would be pure cost — omitted.
    const g = new BoardGraph();
    const gnd = g.place("GND", { col: 0, row: 0 })!;
    const v = g.place("V", { col: 2, row: 0 })!;
    v.value = 10;
    const r1 = g.place("R", { col: 5, row: 0 })!;
    const r2 = g.place("R", { col: 7, row: 0 })!;
    g.connect(
      { componentId: v.id, pinIndex: 0 },
      { componentId: r1.id, pinIndex: 0 },
    );
    g.connect(
      { componentId: r1.id, pinIndex: 1 },
      { componentId: r2.id, pinIndex: 0 },
    );
    g.connect(
      { componentId: r2.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
    g.connect(
      { componentId: v.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
    expect(buildNetlist(g, true, false)!.coupling).toBeNull();
  });

  it("falls off with distance — a far hot resistor couples far weaker than an adjacent one", () => {
    const near = build(true, 2);
    const far = build(true, 8);
    const wNear = edgeWeight(near.nl.coupling, near.eiNtc, near.eiHot);
    const wFar = edgeWeight(far.nl.coupling, far.eiNtc, far.eiHot);
    expect(wNear).toBeGreaterThan(wFar);
  });

  it("keeps weights passive — every part's incoming row sum stays below 1 (can't blow up)", () => {
    const { nl } = build(true, 2);
    const rowSum = new Map<number, number>();
    for (let k = 0; k < nl.coupling!.idx.length; k++) {
      const i = nl.coupling!.idx[k]!;
      rowSum.set(i, (rowSum.get(i) ?? 0) + nl.coupling!.w[k]!);
    }
    for (const s of rowSum.values()) expect(s).toBeLessThan(1);
  });
});

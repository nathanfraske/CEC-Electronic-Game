// SPDX-License-Identifier: Apache-2.0
// Thermistor thermal-runaway tempco emission. A thermistor expands to a plain resistor; buildNetlist tags
// that element with a self-heating temperature coefficient α (slot TEMPCO_SLOT) ONLY in Realistic mode,
// so sim-core's per-tick R(T) feedback runs (an NTC runs away, a PTC self-limits). The runaway BEHAVIOUR
// itself is proven in sim-core (ntc_resistor_thermal_runaway / ptc_resistor_self_limits); this guards the
// Real-mode-only emission and the NTC-negative / PTC-positive sign convention.
import { describe, it, expect } from "vitest";
import { BoardGraph } from "./graph";
import { buildNetlist } from "./netlist";

const PARAM_STRIDE = 8;
const TEMPCO_SLOT = 7;

function thermistorAlpha(kind: string, real: boolean): number {
  const g = new BoardGraph();
  const gnd = g.place("GND", { col: 0, row: 0 })!;
  const src = g.place("V", { col: 2, row: 0 })!;
  src.value = 5;
  const th = g.place(kind, { col: 8, row: 0 })!;
  th.value = 100;
  g.connect(
    { componentId: src.id, pinIndex: 0 },
    { componentId: th.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: th.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: src.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  const nl = buildNetlist(g, real, false)!;
  const ei = nl.elemOfComponent.get(th.id)!;
  return nl.params[ei * PARAM_STRIDE + TEMPCO_SLOT];
}

describe("thermistor thermal-runaway tempco emission (Real mode only)", () => {
  it("an NTC gets a NEGATIVE tempco in Real mode (R drops with heat → runaway)", () => {
    expect(thermistorAlpha("NTC", true)).toBeLessThan(0);
  });
  it("a PTC gets a POSITIVE tempco in Real mode (R rises with heat → self-limits)", () => {
    expect(thermistorAlpha("PTC", true)).toBeGreaterThan(0);
  });
  it("neither emits a tempco in Ideal mode (no feedback, golden-clean)", () => {
    expect(thermistorAlpha("NTC", false)).toBe(0);
    expect(thermistorAlpha("PTC", false)).toBe(0);
  });
});

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

// A BJT reuses TEMPCO_SLOT for its Is(T) runaway seed γ: at a fixed base bias the collector current
// climbs with junction temperature → Vce·Ic dissipation climbs → hotter (runaway). The runaway BEHAVIOUR
// is proven in sim-core (bjt_thermal_runaway / bjt_emitter_ballast_tames_runaway); this guards the
// Real-mode-only emission and that it lands on the BJT's element (γ > 0, positive — Is always rises).
function bjtGamma(kind: string, real: boolean): number {
  const g = new BoardGraph();
  const gnd = g.place("GND", { col: 0, row: 0 })!;
  const vcc = g.place("V", { col: 2, row: 0 })!;
  vcc.value = 12;
  const rc = g.place("R", { col: 4, row: 0 })!;
  rc.value = 1000;
  const q = g.place(kind, { col: 8, row: 0 })!;
  // Vcc+ → Rc → collector(pin 0); emitter(pin 1) → GND; base(pin 2) → Vcc+ (stiff bias); Vcc− → GND.
  g.connect(
    { componentId: vcc.id, pinIndex: 0 },
    { componentId: rc.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: rc.id, pinIndex: 1 },
    { componentId: q.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: q.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: q.id, pinIndex: 2 },
    { componentId: vcc.id, pinIndex: 0 },
  );
  g.connect(
    { componentId: vcc.id, pinIndex: 1 },
    { componentId: gnd.id, pinIndex: 0 },
  );
  const nl = buildNetlist(g, real, false)!;
  const ei = nl.elemOfComponent.get(q.id)!;
  return nl.params[ei * PARAM_STRIDE + TEMPCO_SLOT];
}

describe("BJT thermal-runaway Is-tempco emission (Real mode only)", () => {
  it("an NPN gets a POSITIVE Is-tempco γ in Real mode (Is rises with heat → runaway)", () => {
    expect(bjtGamma("Q", true)).toBeGreaterThan(0);
  });
  it("a PNP gets the same positive γ in Real mode (Is is a junction property, polarity-independent)", () => {
    expect(bjtGamma("QP", true)).toBeGreaterThan(0);
  });
  it("neither emits a tempco in Ideal mode (Is = BJT_IS, golden-clean)", () => {
    expect(bjtGamma("Q", false)).toBe(0);
    expect(bjtGamma("QP", false)).toBe(0);
  });
});

// SPDX-License-Identifier: Apache-2.0
// Headless tests for the STARTER GATE TEMPLATES (gateTemplates.ts). Like netlist.test.ts these run in
// node (buildNetlist / dieTestGraph / the graph compile there — glyphs import as types only), so we
// verify each template (a) seeds a die that COMPILES TO A SOLVABLE NETLIST with its preset stimuli, and
// (b) has the correct CMOS FET TOPOLOGY (the right count of ELEM_NMOS=11 / ELEM_PMOS=12). A correct
// topology + a solvable netlist is exactly "the seeded die solves and switches" (the sim's FET model is
// already proven by the CEC_COMP.INV path). Golden-safe: no template is placed by the golden circuit.
import { describe, it, expect } from "vitest";
import { BoardGraph } from "./graph";
import { buildNetlist } from "./netlist";
import { dieTestGraph, dieIsSealable } from "./dieEditor";
import {
  gateTemplate,
  GATE_TEMPLATE_KINDS,
  type GateTemplateKind,
} from "./gateTemplates";

const ELEM_NMOS = 11;
const ELEM_PMOS = 12;

/** Build a template, inject its preset stimuli, and return the compiled netlist's element types. */
function templateTypes(kind: GateTemplateKind): number[] {
  const die = gateTemplate(kind);
  expect(die, `${kind} template built`).toBeDefined();
  const withStim = dieTestGraph(die!.snapshot, die!.frameId);
  // The injected stimuli must make the die a real, sealable IC (a solvable netlist).
  expect(dieIsSealable(withStim), `${kind} die is sealable`).toBe(true);
  const g = new BoardGraph();
  g.restore(withStim);
  const nl = buildNetlist(g, false);
  expect(nl, `${kind} netlist compiles`).not.toBeNull();
  return [...nl!.types];
}

describe("starter gate templates — solvable CMOS die graphs", () => {
  it("exposes exactly INV / NAND2 / NOR2", () => {
    expect(GATE_TEMPLATE_KINDS).toEqual(["INV", "NAND2", "NOR2"]);
  });

  it("INV = 1 PMOS (pull-up) + 1 NMOS (pull-down)", () => {
    const types = templateTypes("INV");
    expect(types.filter((t) => t === ELEM_PMOS).length).toBe(1);
    expect(types.filter((t) => t === ELEM_NMOS).length).toBe(1);
  });

  it("NAND2 = 2 PMOS (parallel pull-up) + 2 NMOS (series pull-down)", () => {
    const types = templateTypes("NAND2");
    expect(types.filter((t) => t === ELEM_PMOS).length).toBe(2);
    expect(types.filter((t) => t === ELEM_NMOS).length).toBe(2);
  });

  it("NOR2 = 2 PMOS (series pull-up) + 2 NMOS (parallel pull-down)", () => {
    const types = templateTypes("NOR2");
    expect(types.filter((t) => t === ELEM_PMOS).length).toBe(2);
    expect(types.filter((t) => t === ELEM_NMOS).length).toBe(2);
  });

  it("a template with no injected stimuli is NOT yet solvable (needs power) — proves the presets matter", () => {
    // Without dieTestGraph's VCC/GND/IN the die has no ground reference, so it is not sealable on its
    // own; the preset stimuli are what make the seeded die live in the editor.
    const die = gateTemplate("INV")!;
    expect(dieIsSealable(die.snapshot)).toBe(false);
  });
});

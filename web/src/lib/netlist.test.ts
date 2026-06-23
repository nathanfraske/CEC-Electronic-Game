// SPDX-License-Identifier: Apache-2.0
// Headless tests for the netlist compiler. The netlist chain imports glyphs as TYPES only, so
// buildNetlist runs in node (no PixiJS) — letting us verify determinism-critical compilation
// (e.g. the IC-maker seal expands to the SAME netlist as the inline circuit) without a browser.
import { describe, it, expect } from "vitest";
import { BoardGraph } from "./graph";
import type { Component } from "./graph";
import { buildNetlist } from "./netlist";
import {
  registerUserIc,
  unregisterUserIc,
  captureSeal,
  getUserIc,
} from "./userIc";

function place(
  g: BoardGraph,
  kind: string,
  col: number,
  row: number,
  value?: number,
): Component {
  const c = g.place(kind, { col, row });
  if (!c) throw new Error("unknown kind: " + kind);
  if (value !== undefined) c.value = value;
  return c;
}

function connect(
  g: BoardGraph,
  a: Component,
  ai: number,
  b: Component,
  bi: number,
): void {
  g.connect(
    { componentId: a.id, pinIndex: ai },
    { componentId: b.id, pinIndex: bi },
  );
}

describe("buildNetlist (headless smoke)", () => {
  it("compiles a V + R + GND loop", () => {
    const g = new BoardGraph();
    const v = place(g, "V", 0, 0, 5);
    const r = place(g, "R", 4, 0, 1000);
    const gnd = place(g, "GND", 0, 4);
    connect(g, v, 0, r, 0); // V+ -> R.A
    connect(g, r, 1, gnd, 0); // R.B -> GND
    connect(g, v, 1, gnd, 0); // V- -> GND
    const nl = buildNetlist(g, false);
    expect(nl).not.toBeNull();
    expect(nl!.types.length).toBe(2); // V + R (GND is not an element)
  });
});

describe("IC maker — seal-as-same-netlist", () => {
  it("a sealed resistor-in-a-package compiles to the same netlist as the inline circuit", () => {
    // Seal: a SOT-23-3 frame with a 1 kOhm resistor between pins 1 and 2 (a "resistor in a package").
    const inner = new BoardGraph();
    const frame = place(inner, "SOT23_3", 0, 0);
    const r = place(inner, "R", 4, 0, 1000);
    connect(inner, frame, 0, r, 0); // frame pin 1 (index 0) -> R.A
    connect(inner, frame, 1, r, 1); // frame pin 2 (index 1) -> R.B
    registerUserIc({
      tag: "TESTRPKG",
      name: "Test R Package",
      package: { archetype: "SOT-23", pinCount: 3 },
      frameId: frame.id,
      graph: inner.serialize(),
    });

    try {
      // Sealed: V+ -> IC.pin1, IC.pin2 -> GND, V- -> GND.
      const sealed = new BoardGraph();
      const vs = place(sealed, "V", 0, 0, 5);
      const ic = place(sealed, "TESTRPKG", 4, 0);
      const g1 = place(sealed, "GND", 0, 6);
      connect(sealed, vs, 0, ic, 0);
      connect(sealed, ic, 1, g1, 0);
      connect(sealed, vs, 1, g1, 0);
      const a = buildNetlist(sealed, false);

      // Inline: the same V + 1 kOhm R + GND, no IC.
      const flat = new BoardGraph();
      const vf = place(flat, "V", 0, 0, 5);
      const rf = place(flat, "R", 4, 0, 1000);
      const g2 = place(flat, "GND", 0, 6);
      connect(flat, vf, 0, rf, 0);
      connect(flat, rf, 1, g2, 0);
      connect(flat, vf, 1, g2, 0);
      const b = buildNetlist(flat, false);

      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      // The sealed IC expands to its real parts: identical element types + values to the inline build.
      expect([...a!.types]).toEqual([...b!.types]);
      expect([...a!.values]).toEqual([...b!.values]);
      expect(a!.types.length).toBe(2); // V + the IC's inner R
    } finally {
      unregisterUserIc("TESTRPKG");
    }
  });

  it("flattening is a strict no-op when no sealed IC is placed", () => {
    const g = new BoardGraph();
    const vs = place(g, "V", 0, 0, 5);
    const r = place(g, "R", 4, 0, 1000);
    const gnd = place(g, "GND", 0, 6);
    connect(g, vs, 0, r, 0);
    connect(g, r, 1, gnd, 0);
    connect(g, vs, 1, gnd, 0);
    // buildNetlist runs flattenUserIcs internally; with no sealed IC it must be unchanged.
    const nl = buildNetlist(g, false);
    expect(nl).not.toBeNull();
    expect(nl!.types.length).toBe(2); // V + R, exactly as without the flatten pass
  });
});

describe("IC maker — captureSeal (capture end-to-end)", () => {
  it("captures a frame's wired circuit and seals to the same netlist as the inline build", () => {
    // Author inside a frame: a SOT-23-3 frame with TWO 1 kOhm resistors in series between pins 1
    // and 2 (pin1 -> R1 -> R2 -> pin2). The interior node between R1 and R2 has no wire to the
    // frame, so the BFS must walk through R1 to reach R2 — proving capture gathers the whole
    // connected sub-graph, not just the frame's direct neighbours.
    const author = new BoardGraph();
    const frame = place(author, "SOT23_3", 0, 0);
    const r1 = place(author, "R", 2, 0, 1000);
    const r2 = place(author, "R", 4, 0, 1000);
    connect(author, frame, 0, r1, 0); // frame pin 1 -> R1.A
    connect(author, r1, 1, r2, 0); // R1.B -> R2.A (interior node, no frame wire)
    connect(author, r2, 1, frame, 1); // R2.B -> frame pin 2

    const cap = captureSeal(author, frame.id, "TESTSEAL");
    expect(cap).not.toBeUndefined();

    try {
      expect(cap!.tag).toBe("TESTSEAL");
      // The capture folded in the frame + both resistors (3 components) and all 3 wires.
      expect(cap!.capturedComponentIds.length).toBe(3);
      expect(cap!.capturedWireIds.length).toBe(3);
      // The registered IC carries the frame's package and the authored sub-graph.
      const ic = getUserIc("TESTSEAL");
      expect(ic).not.toBeUndefined();
      expect(ic!.package).toEqual({ archetype: "SOT-23", pinCount: 3 });
      expect(ic!.graph.components.length).toBe(3); // frame + R1 + R2

      // Place the sealed instance (as board.ts's collapse would) and wire it like the inline
      // circuit: V+ -> IC.pin1, IC.pin2 -> GND, V- -> GND.
      const sealed = new BoardGraph();
      const vs = place(sealed, "V", 0, 0, 5);
      const ic1 = place(sealed, "TESTSEAL", 4, 0);
      const g1 = place(sealed, "GND", 0, 6);
      connect(sealed, vs, 0, ic1, 0);
      connect(sealed, ic1, 1, g1, 0);
      connect(sealed, vs, 1, g1, 0);
      const a = buildNetlist(sealed, false);

      // Inline: the same V + two series 1 kOhm Rs + GND, no IC.
      const flat = new BoardGraph();
      const vf = place(flat, "V", 0, 0, 5);
      const rf1 = place(flat, "R", 2, 0, 1000);
      const rf2 = place(flat, "R", 4, 0, 1000);
      const g2 = place(flat, "GND", 0, 6);
      connect(flat, vf, 0, rf1, 0);
      connect(flat, rf1, 1, rf2, 0);
      connect(flat, rf2, 1, g2, 0);
      connect(flat, vf, 1, g2, 0);
      const b = buildNetlist(flat, false);

      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      // Seal-as-same-netlist: the captured IC expands to its real parts — identical element types
      // + values to the inline build.
      expect([...a!.types]).toEqual([...b!.types]);
      expect([...a!.values]).toEqual([...b!.values]);
      expect(a!.types.length).toBe(3); // V + the IC's two inner Rs
    } finally {
      unregisterUserIc("TESTSEAL");
    }
  });

  it("auto-names an unnamed seal with the CEC9xxx house id", () => {
    const author = new BoardGraph();
    const frame = place(author, "DIP8", 0, 0);
    const r = place(author, "R", 2, 0, 1000);
    connect(author, frame, 0, r, 0);
    connect(author, r, 1, frame, 1);
    const cap = captureSeal(author, frame.id); // no name -> auto id
    expect(cap).not.toBeUndefined();
    try {
      expect(cap!.tag).toMatch(/^CEC9\d+$/);
      expect(getUserIc(cap!.tag)).not.toBeUndefined();
    } finally {
      unregisterUserIc(cap!.tag);
    }
  });

  it("returns undefined when the id is not a frame", () => {
    const g = new BoardGraph();
    const r = place(g, "R", 0, 0, 1000);
    expect(captureSeal(g, r.id)).toBeUndefined();
  });
});

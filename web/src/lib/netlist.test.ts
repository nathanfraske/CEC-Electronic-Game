// SPDX-License-Identifier: Apache-2.0
// Headless tests for the netlist compiler. The netlist chain imports glyphs as TYPES only, so
// buildNetlist runs in node (no PixiJS) — letting us verify determinism-critical compilation
// (e.g. the IC-maker seal expands to the SAME netlist as the inline circuit) without a browser.
import { describe, it, expect } from "vitest";
import { BoardGraph, rotateOffset } from "./graph";
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

  it("exposes the sealed IC's authored inner circuit (userIcInternals) for the zoom-to-open mini-board, without changing the crossing arrays", () => {
    // Seal a V + R + GND loop INSIDE a SOT-23-3 frame, so the sealed chip carries a real authored
    // circuit (a source, a resistor, a ground) to draw a miniature of.
    const inner = new BoardGraph();
    const frame = place(inner, "SOT23_3", 0, 0);
    const vin = place(inner, "V", 0, 4, 5);
    const rin = place(inner, "R", 4, 4, 2200);
    const gin = place(inner, "GND", 0, 8);
    connect(inner, frame, 0, vin, 0); // frame pin 1 -> V+
    connect(inner, vin, 1, gin, 0); // V- -> GND
    connect(inner, frame, 0, rin, 0); // frame pin 1 -> R.A (shares V+)
    connect(inner, rin, 1, frame, 1); // R.B -> frame pin 2
    registerUserIc({
      tag: "TESTMINI",
      name: "Test Mini IC",
      package: { archetype: "SOT-23", pinCount: 3 },
      frameId: frame.id,
      graph: inner.serialize(),
    });

    try {
      // Place the sealed instance on a fresh board and tie pin 2 to GND (so the inner R has a return).
      const board = new BoardGraph();
      const ic = place(board, "TESTMINI", 4, 0);
      const gnd = place(board, "GND", 0, 6);
      connect(board, ic, 1, gnd, 0); // IC pin 2 -> GND
      const a = buildNetlist(board, false);
      expect(a).not.toBeNull();

      // The mini-board map carries an entry for the placed instance.
      const mini = a!.userIcInternals.get(ic.id);
      expect(mini).not.toBeUndefined();
      // Its parts are the authored inner discretes (V + R + GND — the frame is excluded), each with
      // resolved node indices (one per pin).
      const kinds = mini!.parts.map((p) => p.kind).sort();
      expect(kinds).toEqual(["GND", "R", "V"]);
      const rPart = mini!.parts.find((p) => p.kind === "R");
      expect(rPart).not.toBeUndefined();
      expect(rPart!.value).toBe(2200);
      expect(rPart!.nodes.length).toBe(2); // a node resolved per pin
      // The wires + external pin anchors are present and resolved.
      expect(mini!.wires.length).toBeGreaterThan(0);
      expect(mini!.pinNodes.length).toBe(3); // SOT-23-3 has 3 leads
      // The bbox spans a real authored extent (not a degenerate point).
      expect(mini!.bbox.maxCol).toBeGreaterThan(mini!.bbox.minCol);

      // Determinism: building the SAME board with NO sink request (the map is render-only) yields
      // byte-identical crossing arrays — the userIcInternals construction never perturbs the netlist
      // the core sees. Compare against the inline equivalent: V + 2.2k R + GND, pin2->GND.
      const flat = new BoardGraph();
      const vf = place(flat, "V", 0, 0, 5);
      const rf = place(flat, "R", 4, 0, 2200);
      const gf = place(flat, "GND", 0, 6);
      connect(flat, vf, 0, rf, 0); // V+ -> R.A (the inner V+ net)
      connect(flat, rf, 1, gf, 0); // R.B -> GND (the IC pin2 -> GND tie)
      connect(flat, vf, 1, gf, 0); // V- -> GND
      const b = buildNetlist(flat, false);
      expect(b).not.toBeNull();
      // Seal-as-same-netlist: identical element types + values to the inline build.
      expect([...a!.types]).toEqual([...b!.types]);
      expect([...a!.values]).toEqual([...b!.values]);
      expect(a!.types.length).toBe(2); // V + the IC's inner R (GND is not an element)
    } finally {
      unregisterUserIc("TESTMINI");
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

describe("mirror / flip (horizontal reflection)", () => {
  it("rotateOffset(..., mirror=true) equals the x-negated rotation", () => {
    // The mirror is a reflect-then-rotate: orient(dx,dy,rot,true) = rotateOffset(-dx, dy, rot).
    const cases: [number, number, number][] = [
      [1, 0, 0],
      [1, 0, 1],
      [2, 3, 0],
      [2, 3, 1],
      [3, -1, 2],
      [0, 2, 3],
    ];
    for (const [dx, dy, rot] of cases) {
      expect(rotateOffset(dx, dy, rot, true)).toEqual(
        rotateOffset(-dx, dy, rot),
      );
    }
    // rot=0 mirror just negates x; rot=1 (CW) then sends (x,y)->(-y,x). Normalize the
    // result (+0) so a mathematically-zero coord doesn't trip toEqual's -0/+0 distinction.
    const norm = (r: { col: number; row: number }) => ({
      col: r.col + 0,
      row: r.row + 0,
    });
    expect(norm(rotateOffset(1, 0, 0, true))).toEqual({ col: -1, row: 0 });
    expect(norm(rotateOffset(1, 0, 1, true))).toEqual({ col: 0, row: -1 });
    // mirror=false is the plain rotation (the 3-arg behaviour is unchanged).
    expect(rotateOffset(1, 0, 1, false)).toEqual(rotateOffset(1, 0, 1));
  });

  it("a mirrored component's pinCell is the reflected cell", () => {
    const g = new BoardGraph();
    // N-MOSFET has an asymmetric pinout (D top, S bottom, G left at dx<0), so a flip
    // actually moves pins. Pin 2 (G) sits at dx=0, dy=1 (left of the body's centre column).
    const m = place(g, "NM", 5, 5);
    const kind = g.kindOf(m)!;
    const gate = kind.pins[2]!; // G at (dx=0, dy=1)
    const drain = kind.pins[0]!; // D at (dx=2, dy=0)
    // Un-mirrored: anchor + raw offset (rot=0).
    expect(g.pinCell(m, drain)).toEqual({ col: 5 + 2, row: 5 + 0 });
    // Mirror: dx negates first, so D (dx=2) reflects to the left of the anchor.
    m.mirror = true;
    expect(g.pinCell(m, drain)).toEqual({ col: 5 - 2, row: 5 + 0 });
    // G sat at dx=0, so the flip leaves it on the same column (only dy carries).
    expect(g.pinCell(m, gate)).toEqual({ col: 5 + 0, row: 5 + 1 });
  });

  it("serialize -> restore round-trips mirror (and drops a falsy flip)", () => {
    const g = new BoardGraph();
    const flipped = place(g, "R", 0, 0, 1000);
    const plain = place(g, "R", 4, 0, 1000);
    flipped.mirror = true;
    const snap = g.serialize();
    // Serialized only on the flipped part (the optional-field pattern: a falsy flip is absent).
    const sFlipped = snap.components.find((c) => c.id === flipped.id)!;
    const sPlain = snap.components.find((c) => c.id === plain.id)!;
    expect(sFlipped.mirror).toBe(true);
    expect(sPlain.mirror).toBeUndefined();
    // Restore brings the flip back faithfully.
    const g2 = new BoardGraph();
    g2.restore(snap);
    expect(g2.components.get(flipped.id)!.mirror).toBe(true);
    expect(g2.components.get(plain.id)!.mirror).toBeUndefined();
  });

  it("determinism: flipping a component does not touch the netlist", () => {
    // A small circuit with an asymmetric part: V -> N-MOSFET (drain), source -> GND,
    // gate -> a resistor divider tap. Connectivity is by pin INDEX, never position.
    const build = (mirror: boolean) => {
      const g = new BoardGraph();
      const v = place(g, "V", 0, 0, 5);
      const m = place(g, "NM", 4, 0);
      const r = place(g, "R", 8, 0, 1000);
      const gnd = place(g, "GND", 0, 6);
      if (mirror) m.mirror = true;
      connect(g, v, 0, m, 0); // V+ -> NM.Drain
      connect(g, m, 1, gnd, 0); // NM.Source -> GND
      connect(g, m, 2, r, 0); // NM.Gate -> R.A
      connect(g, r, 1, gnd, 0); // R.B -> GND
      connect(g, v, 1, gnd, 0); // V- -> GND
      return buildNetlist(g, false);
    };
    const base = build(false);
    const flip = build(true);
    expect(base).not.toBeNull();
    expect(flip).not.toBeNull();
    // The crossing arrays + node count are byte-identical — mirror is geometry only.
    expect([...flip!.types]).toEqual([...base!.types]);
    expect([...flip!.values]).toEqual([...base!.values]);
    expect([...flip!.a]).toEqual([...base!.a]);
    expect([...flip!.b]).toEqual([...base!.b]);
    expect([...flip!.c]).toEqual([...base!.c]);
    expect(flip!.nodeCount).toBe(base!.nodeCount);
  });
});

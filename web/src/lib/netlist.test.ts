// SPDX-License-Identifier: Apache-2.0
// Headless tests for the netlist compiler. The netlist chain imports glyphs as TYPES only, so
// buildNetlist runs in node (no PixiJS) — letting us verify determinism-critical compilation
// (e.g. the IC-maker seal expands to the SAME netlist as the inline circuit) without a browser.
import { describe, it, expect } from "vitest";
import {
  BoardGraph,
  rotateOffset,
  footprintCenter,
  rotateInPlaceShift,
  flipInPlaceShift,
} from "./graph";
import type { Component } from "./graph";
import { buildNetlist, userIcGeometry } from "./netlist";
import {
  registerUserIc,
  unregisterUserIc,
  captureSeal,
  getUserIc,
  userIcsForGraph,
  registerUserIcs,
  resealUserIc,
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

  it("every GND symbol is the SAME global ground (node 0) — no wire needed between them", () => {
    // Two independent V+R branches, each returning to its OWN ground symbol, NOT wired together.
    // Real schematic convention: every GND is the same node, so they share one reference and the
    // board solves — without the player hand-tying the grounds (the owner's "sources can't share a
    // common ground" trap, now fixed).
    const g = new BoardGraph();
    const v1 = place(g, "V", 0, 0, 5);
    const r1 = place(g, "R", 4, 0, 1000);
    const gndA = place(g, "GND", 0, 4);
    connect(g, v1, 0, r1, 0);
    connect(g, r1, 1, gndA, 0);
    connect(g, v1, 1, gndA, 0);

    const v2 = place(g, "V", 0, 10, 3);
    const r2 = place(g, "R", 4, 10, 2200);
    const gndB = place(g, "GND", 0, 14); // a SECOND ground symbol, NOT wired to gndA
    connect(g, v2, 0, r2, 0);
    connect(g, r2, 1, gndB, 0);
    connect(g, v2, 1, gndB, 0);

    const nl = buildNetlist(g, false);
    expect(nl).not.toBeNull();
    // Both resistors' "B" leads return to ground — and both grounds are the SAME node 0.
    expect(nl!.nodesOfComponent.get(r1.id)![1]).toBe(0); // R1.B -> node 0 (gndA)
    expect(nl!.nodesOfComponent.get(r2.id)![1]).toBe(0); // R2.B -> node 0 (gndB), unified w/ gndA
    // Exactly three nodes: the one shared ground + each source's hot node (4 only if NOT unified).
    expect(nl!.nodeCount).toBe(3);
  });

  it("lone floating ground symbols don't make a disconnected board falsely solve", () => {
    // Two GND symbols, nothing else wired to either, and no V source → no real reference.
    const g = new BoardGraph();
    place(g, "GND", 0, 0);
    place(g, "GND", 4, 0);
    expect(buildNetlist(g, false)).toBeNull();
  });

  it("circuitOfNode keeps separate circuits in separate groups (per-circuit gauge scaling)", () => {
    const g = new BoardGraph();
    // Circuit A: V(5) -> R1 -> R2 -> GND (an intermediate net M between the resistors).
    const vA = place(g, "V", 0, 0, 5);
    const r1 = place(g, "R", 4, 0, 1000);
    const r2 = place(g, "R", 8, 0, 1000);
    const gndA = place(g, "GND", 0, 6);
    connect(g, vA, 0, r1, 0); // V+ -> R1.a (net X)
    connect(g, r1, 1, r2, 0); // R1.b -> R2.a (net M)
    connect(g, r2, 1, gndA, 0); // R2.b -> GND
    connect(g, vA, 1, gndA, 0); // V- -> GND
    // Circuit B: a SEPARATE V(3) -> R -> its own GND (it shares ONLY ground with A — not a bridge).
    const vB = place(g, "V", 0, 12, 3);
    const rB = place(g, "R", 4, 12, 2200);
    const gndB = place(g, "GND", 0, 18);
    connect(g, vB, 0, rB, 0);
    connect(g, rB, 1, gndB, 0);
    connect(g, vB, 1, gndB, 0);

    const nl = buildNetlist(g, false);
    expect(nl).not.toBeNull();
    const co = nl!.circuitOfNode;
    const X = nl!.nodesOfComponent.get(vA.id)![0]; // V_A +
    const M = nl!.nodesOfComponent.get(r1.id)![1]; // between R1 and R2
    const Y = nl!.nodesOfComponent.get(vB.id)![0]; // V_B +
    // A's two nets are one circuit; B is a different circuit (sharing only ground, which doesn't bridge).
    expect(co[X]).toBe(co[M]);
    expect(co[X]).not.toBe(co[Y]);
    // Ground (node 0) is its own group, not merged into either circuit.
    expect(co[0]).toBe(0);
    expect(co[X]).not.toBe(0);
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

  it("userIcGeometry builds the SAME authored geometry as the live builder, but NODE-FREE (the unpowered zoom-to-open fallback)", () => {
    // Same V + R + GND loop sealed in a SOT-23-3 frame as the live-internals test above.
    const inner = new BoardGraph();
    const frame = place(inner, "SOT23_3", 0, 0);
    const vin = place(inner, "V", 0, 4, 5);
    const rin = place(inner, "R", 4, 4, 2200);
    const gin = place(inner, "GND", 0, 8);
    connect(inner, frame, 0, vin, 0);
    connect(inner, vin, 1, gin, 0);
    connect(inner, frame, 0, rin, 0);
    connect(inner, rin, 1, frame, 1);
    registerUserIc({
      tag: "TESTGEO",
      name: "Test Geo IC",
      package: { archetype: "SOT-23", pinCount: 3 },
      frameId: frame.id,
      graph: inner.serialize(),
    });

    try {
      // LIVE internals (node-resolved): place on a SOLVING board so buildNetlist resolves nodes.
      const board = new BoardGraph();
      const ic = place(board, "TESTGEO", 4, 0);
      const gnd = place(board, "GND", 0, 6);
      connect(board, ic, 1, gnd, 0);
      const a = buildNetlist(board, false);
      const live = a!.userIcInternals.get(ic.id);
      expect(live).not.toBeUndefined();

      // STATIC geometry: node-free, from the registry def directly (NO solve) — what the board falls
      // back to when the outer circuit doesn't solve, so a placed chip still opens to its real circuit.
      const geo = userIcGeometry(getUserIc("TESTGEO")!);

      // Identical authored GEOMETRY to the live builder: same parts (kinds/cells/values, frame
      // excluded, same order), same wire endpoint cells, same bbox extent.
      expect(geo.parts.map((p) => p.kind)).toEqual(
        live!.parts.map((p) => p.kind),
      );
      expect(geo.parts.map((p) => p.cell)).toEqual(
        live!.parts.map((p) => p.cell),
      );
      expect(geo.parts.map((p) => p.value)).toEqual(
        live!.parts.map((p) => p.value),
      );
      expect(geo.wires.map((w) => w.from)).toEqual(
        live!.wires.map((w) => w.from),
      );
      expect(geo.wires.map((w) => w.to)).toEqual(live!.wires.map((w) => w.to));
      expect(geo.bbox).toEqual(live!.bbox);
      // The frame's authored pin cells (where the leads bridge to in the 1:1 zoom-in replica) match
      // the live builder's exactly, one per package lead.
      expect(geo.pinCells).toEqual(live!.pinCells);
      expect(geo.pinCells.length).toBe(3); // SOT-23-3 has 3 leads

      // ...but every NODE field is zeroed (no netlist): the view renders it at level 0 (static).
      expect(geo.parts.every((p) => p.nodes.every((n) => n === 0))).toBe(true);
      expect(geo.wires.every((w) => w.node === 0)).toBe(true);
      expect(geo.pinNodes).toEqual([]);
      expect(geo.gndNode).toBe(0);
      // The per-pin node arrays keep the live builder's LENGTH (shape matches), just zero-filled.
      const rLive = live!.parts.find((p) => p.kind === "R")!;
      const rGeo = geo.parts.find((p) => p.kind === "R")!;
      expect(rGeo.nodes.length).toBe(rLive.nodes.length);
    } finally {
      unregisterUserIc("TESTGEO");
    }
  });

  it("recursive nesting: a sealed IC placed INSIDE another sealed IC inlines to the fully-flat netlist", () => {
    // Inner IC: a 1 kOhm R in a SOT-23-3 package (pin1 -> R -> pin2).
    const innerDie = new BoardGraph();
    const innerFrame = place(innerDie, "SOT23_3", 0, 0);
    const r = place(innerDie, "R", 4, 0, 1000);
    connect(innerDie, innerFrame, 0, r, 0); // pin 1 -> R.A
    connect(innerDie, r, 1, innerFrame, 1); // R.B -> pin 2
    registerUserIc({
      tag: "INNERPKG",
      name: "Inner Pkg",
      package: { archetype: "SOT-23", pinCount: 3 },
      frameId: innerFrame.id,
      graph: innerDie.serialize(),
    });

    // Outer IC: a SOT-23-3 package that itself PLACES an INNERPKG instance, wiring outer pin1 ->
    // inner pin1 and inner pin2 -> outer pin2. So OUTERPKG is "a package wrapping a package wrapping a
    // 1 kOhm R" — the one-pass flatten would leave the nested INNERPKG an empty hub (no R); the
    // recursive flatten must inline BOTH layers down to the real resistor.
    const outerDie = new BoardGraph();
    const outerFrame = place(outerDie, "SOT23_3", 0, 0);
    const innerInst = place(outerDie, "INNERPKG", 6, 0);
    connect(outerDie, outerFrame, 0, innerInst, 0); // outer pin1 -> inner pin1
    connect(outerDie, innerInst, 1, outerFrame, 1); // inner pin2 -> outer pin2
    registerUserIc({
      tag: "OUTERPKG",
      name: "Outer Pkg",
      package: { archetype: "SOT-23", pinCount: 3 },
      frameId: outerFrame.id,
      graph: outerDie.serialize(),
    });

    try {
      // Place the OUTER IC on a board: V+ -> OUTER.pin1, OUTER.pin2 -> GND, V- -> GND.
      const sealed = new BoardGraph();
      const vs = place(sealed, "V", 0, 0, 5);
      const ic = place(sealed, "OUTERPKG", 4, 0);
      const gnd = place(sealed, "GND", 0, 6);
      connect(sealed, vs, 0, ic, 0);
      connect(sealed, ic, 1, gnd, 0);
      connect(sealed, vs, 1, gnd, 0);
      const a = buildNetlist(sealed, false);

      // Inline reference: the same V + 1 kOhm R + GND, no ICs at all.
      const flat = new BoardGraph();
      const vf = place(flat, "V", 0, 0, 5);
      const rf = place(flat, "R", 4, 0, 1000);
      const gf = place(flat, "GND", 0, 6);
      connect(flat, vf, 0, rf, 0);
      connect(flat, rf, 1, gf, 0);
      connect(flat, vf, 1, gf, 0);
      const b = buildNetlist(flat, false);

      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      // Both package layers vanish recursively, leaving the real inner R fused across V+ and GND:
      // identical element types + values to the fully-inline build.
      expect([...a!.types]).toEqual([...b!.types]);
      expect([...a!.values]).toEqual([...b!.values]);
      expect(a!.types.length).toBe(2); // V + the doubly-nested R (one-pass would give just V)
      // The render-only mini-board map carries an entry for BOTH the placed OUTER instance and the
      // (inlined) nested INNER instance, so a future recursive zoom can descend into either.
      expect(a!.userIcInternals.get(ic.id)).not.toBeUndefined();
      const nestedTags = [...a!.userIcInternals.values()].map((m) =>
        m.parts
          .map((p) => p.kind)
          .sort()
          .join(","),
      );
      // One internals view is the OUTER (containing the nested INNERPKG hub), one is the INNER
      // (containing the real R). The INNER's parts include the discrete R.
      expect(nestedTags.some((t) => t.includes("R"))).toBe(true);
    } finally {
      unregisterUserIc("OUTERPKG");
      unregisterUserIc("INNERPKG");
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

describe("IC maker — persistence (save/reload round-trip)", () => {
  it("survives a JSON round-trip + fresh session: the placed instance still expands to the inline netlist", () => {
    // Seal a V + R loop inside a SOT-23-3 die (the authored circuit), so its def round-trips through
    // a save. captureSeal registers it and hands back a real UserIc (its graph + frameId).
    const author = new BoardGraph();
    const frame = place(author, "SOT23_3", 0, 0);
    const vin = place(author, "V", 0, 4, 5);
    const rin = place(author, "R", 4, 4, 1000);
    const gin = place(author, "GND", 0, 8);
    connect(author, frame, 0, vin, 0); // pin 1 -> V+
    connect(author, vin, 1, gin, 0); // V- -> GND
    connect(author, vin, 0, rin, 0); // V+ -> R.A (shares pin-1 net)
    connect(author, rin, 1, frame, 1); // R.B -> pin 2
    const cap = captureSeal(author, frame.id, "TESTPERSIST");
    expect(cap).not.toBeUndefined();

    try {
      // A board that PLACES the sealed IC. userIcsForGraph picks out exactly the def it uses.
      const board = new BoardGraph();
      const ic = place(board, "TESTPERSIST", 4, 0);
      const gnd = place(board, "GND", 0, 6);
      connect(board, ic, 1, gnd, 0); // pin 2 -> GND (the inner R's return)
      const snap = board.serialize();
      const defs = userIcsForGraph(snap);
      expect(defs.map((d) => d.tag)).toEqual(["TESTPERSIST"]); // exactly the placed IC

      // Serialize the embedded library, then simulate a FRESH session: drop the registry entry and
      // re-register only from the parsed JSON (the save envelope's userIcs).
      const wire = JSON.parse(JSON.stringify(defs)) as typeof defs;
      unregisterUserIc("TESTPERSIST");
      expect(getUserIc("TESTPERSIST")).toBeUndefined(); // gone, as after a reload
      registerUserIcs(wire);
      expect(getUserIc("TESTPERSIST")).not.toBeUndefined(); // restored from the save

      // The restored kind still expands seal-as-same-netlist: the placed instance equals the inline
      // V + 1k R + GND (pin2 -> GND) reference.
      const a = buildNetlist(board, false);
      const flat = new BoardGraph();
      const vf = place(flat, "V", 0, 0, 5);
      const rf = place(flat, "R", 4, 0, 1000);
      const gf = place(flat, "GND", 0, 6);
      connect(flat, vf, 0, rf, 0);
      connect(flat, rf, 1, gf, 0);
      connect(flat, vf, 1, gf, 0);
      const b = buildNetlist(flat, false);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect([...a!.types]).toEqual([...b!.types]);
      expect([...a!.values]).toEqual([...b!.values]);
      expect(a!.types.length).toBe(2); // V + the IC's inner R
    } finally {
      unregisterUserIc("TESTPERSIST");
    }
  });
});

describe("IC maker — reseal updates the existing def", () => {
  it("resealUserIc swaps the inner circuit in place (one entry; placed instances recompile to the new value)", () => {
    // Seal tag T with a 1k inner R.
    const a1 = new BoardGraph();
    const f1 = place(a1, "SOT23_3", 0, 0);
    const r1 = place(a1, "R", 4, 0, 1000);
    connect(a1, f1, 0, r1, 0); // pin 1 -> R.A
    connect(a1, r1, 1, f1, 1); // R.B -> pin 2
    const cap = captureSeal(a1, f1.id, "TESTRESEAL");
    expect(cap).not.toBeUndefined();

    try {
      expect(getUserIc("TESTRESEAL")!.graph.components.length).toBe(2); // frame + 1k R

      // A new authored die for the SAME package, now a 2k R: serialize it and RE-SEAL into tag T.
      const a2 = new BoardGraph();
      const f2 = place(a2, "SOT23_3", 0, 0);
      const r2 = place(a2, "R", 4, 0, 2000);
      connect(a2, f2, 0, r2, 0);
      connect(a2, r2, 1, f2, 1);
      resealUserIc("TESTRESEAL", a2.serialize(), f2.id);

      // Still exactly ONE registry entry for T, and its graph now reflects the 2k value (not a dup).
      const def = getUserIc("TESTRESEAL");
      expect(def).not.toBeUndefined();
      const innerR = def!.graph.components.find((c) => c.kind === "R");
      expect(innerR!.value).toBe(2000);

      // A placed instance of T now compiles the 2k resistor (the def was updated, not duplicated):
      // assert against the inline V + 2k R + GND reference.
      const board = new BoardGraph();
      const vs = place(board, "V", 0, 0, 5);
      const ic = place(board, "TESTRESEAL", 4, 0);
      const gnd = place(board, "GND", 0, 6);
      connect(board, vs, 0, ic, 0);
      connect(board, ic, 1, gnd, 0);
      connect(board, vs, 1, gnd, 0);
      const a = buildNetlist(board, false);

      const flat = new BoardGraph();
      const vf = place(flat, "V", 0, 0, 5);
      const rf = place(flat, "R", 4, 0, 2000);
      const gf = place(flat, "GND", 0, 6);
      connect(flat, vf, 0, rf, 0);
      connect(flat, rf, 1, gf, 0);
      connect(flat, vf, 1, gf, 0);
      const b = buildNetlist(flat, false);

      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect([...a!.types]).toEqual([...b!.types]);
      expect([...a!.values]).toEqual([...b!.values]); // 2000, not 1000
    } finally {
      unregisterUserIc("TESTRESEAL");
    }
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

describe("in-place rotate / flip (pivot about the footprint centre)", () => {
  // The world cell of a part's footprint centre = anchor cell + the oriented centre offset.
  // rotateInPlaceShift / flipInPlaceShift keep THIS fixed (within rounding) as rot/mirror change.
  const centerCell = (
    cell: { col: number; row: number },
    center: { cx: number; cy: number },
    rot: number,
    mirror: boolean,
  ) => {
    const o = rotateOffset(center.cx, center.cy, rot, mirror);
    return { col: cell.col + o.col, row: cell.row + o.row };
  };

  it("a 2-pin R's footprint centre is preserved across each rotate, and the netlist is byte-identical", () => {
    const g = new BoardGraph();
    const v = place(g, "V", 0, 0, 5);
    const r = place(g, "R", 4, 0, 1000);
    const gnd = place(g, "GND", 0, 6);
    connect(g, v, 0, r, 0);
    connect(g, r, 1, gnd, 0);
    connect(g, v, 1, gnd, 0);
    const before = buildNetlist(g, false);
    expect(before).not.toBeNull();

    const center = footprintCenter(g.kindOf(r)!); // R: pins (0,0)+(2,0) → centre (1,0)
    expect(center).toEqual({ cx: 1, cy: 0 });
    const center0 = centerCell(r.cell, center, r.rot, !!r.mirror);

    // Rotate through all four quarter-turns the way rotateSelection does: shift the cell to
    // compensate, then bump rot. The footprint centre must stay put each step (within rounding).
    for (let i = 0; i < 4; i++) {
      const newRot = (r.rot + 1) % 4;
      const s = rotateInPlaceShift(center, r.rot, newRot, !!r.mirror);
      r.cell = { col: r.cell.col + s.col, row: r.cell.row + s.row };
      r.rot = newRot;
      const c = centerCell(r.cell, center, r.rot, !!r.mirror);
      // |Δ| ≤ 1 cell per axis (Math.round on a fractional centre), and ~0 for this symmetric R.
      expect(Math.abs(c.col - center0.col)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.row - center0.row)).toBeLessThanOrEqual(1);
    }
    // A full turn lands back at rot 0 and the exact starting centre.
    expect(r.rot).toBe(0);
    expect(centerCell(r.cell, center, r.rot, !!r.mirror)).toEqual(center0);

    // Geometry only: pins keep their INDEX, so the compiled netlist is byte-identical.
    const after = buildNetlist(g, false);
    expect(after).not.toBeNull();
    expect([...after!.types]).toEqual([...before!.types]);
    expect([...after!.values]).toEqual([...before!.values]);
    expect([...after!.a]).toEqual([...before!.a]);
    expect([...after!.b]).toEqual([...before!.b]);
    expect(after!.nodeCount).toBe(before!.nodeCount);
  });

  it("a flip preserves the footprint centre and leaves the netlist byte-identical", () => {
    const g = new BoardGraph();
    const v = place(g, "V", 0, 0, 5);
    const r = place(g, "R", 4, 0, 1000);
    const gnd = place(g, "GND", 0, 6);
    connect(g, v, 0, r, 0);
    connect(g, r, 1, gnd, 0);
    connect(g, v, 1, gnd, 0);
    const before = buildNetlist(g, false);
    expect(before).not.toBeNull();

    const center = footprintCenter(g.kindOf(r)!);
    const center0 = centerCell(r.cell, center, r.rot, !!r.mirror);

    // Flip the way flipSelection does: shift the cell to compensate, then toggle mirror.
    const newMirror = !r.mirror;
    const s = flipInPlaceShift(center, r.rot, !!r.mirror, newMirror);
    r.cell = { col: r.cell.col + s.col, row: r.cell.row + s.row };
    r.mirror = newMirror;
    expect(r.mirror).toBe(true);
    // The centre is preserved exactly (the R centre dx=1 reflects to an integer shift).
    expect(centerCell(r.cell, center, r.rot, !!r.mirror)).toEqual(center0);

    const after = buildNetlist(g, false);
    expect(after).not.toBeNull();
    expect([...after!.types]).toEqual([...before!.types]);
    expect([...after!.values]).toEqual([...before!.values]);
    expect([...after!.a]).toEqual([...before!.a]);
    expect([...after!.b]).toEqual([...before!.b]);
    expect(after!.nodeCount).toBe(before!.nodeCount);
  });
});

describe("graph — dissolveJunction (remove a junction, keep the wire)", () => {
  it("heals a 2-way junction into one wire and preserves the netlist", () => {
    const g = new BoardGraph();
    const v = place(g, "V", 0, 0, 5);
    const r = place(g, "R", 6, 0, 1000);
    const gnd = place(g, "GND", 0, 6);
    // V+ -> J -> R.A (a junction splitting that run); R.B -> GND; V- -> GND.
    const j = g.addJunction({ col: 3, row: 0 }, true);
    g.connect({ componentId: v.id, pinIndex: 0 }, { junctionId: j.id });
    g.connect({ junctionId: j.id }, { componentId: r.id, pinIndex: 0 });
    connect(g, r, 1, gnd, 0);
    connect(g, v, 1, gnd, 0);

    const before = buildNetlist(g)!;
    expect(before).not.toBeNull();
    const wiresBefore = g.serialize().wires.length;

    expect(g.dissolveJunction(j.id)).toBe(true);

    const snap = g.serialize();
    expect(snap.junctions?.length ?? 0).toBe(0); // the dot is gone
    expect(snap.wires.length).toBe(wiresBefore - 1); // its two wires merged into one

    const after = buildNetlist(g)!;
    // Connectivity preserved -> byte-identical netlist (a 2-way junction is a pure pass-through).
    expect([...after.types]).toEqual([...before.types]);
    expect([...after.values]).toEqual([...before.values]);
    expect(after.nodeCount).toBe(before.nodeCount);
  });

  it("falls back to a destructive remove for a real 3-way branch", () => {
    const g = new BoardGraph();
    const v = place(g, "V", 0, 0, 5);
    const r1 = place(g, "R", 6, 0, 1000);
    const r2 = place(g, "R", 6, 6, 1000);
    const gnd = place(g, "GND", 0, 10);
    // A real branch: J fans V+ out to both R1 and R2 (three wire-ends on the junction).
    const j = g.addJunction({ col: 3, row: 0 }, true);
    g.connect({ componentId: v.id, pinIndex: 0 }, { junctionId: j.id });
    g.connect({ junctionId: j.id }, { componentId: r1.id, pinIndex: 0 });
    g.connect({ junctionId: j.id }, { componentId: r2.id, pinIndex: 0 });
    connect(g, r1, 1, gnd, 0);
    connect(g, r2, 1, gnd, 0);
    connect(g, v, 1, gnd, 0);

    expect(g.dissolveJunction(j.id)).toBe(false); // 3-way: not a clean pass-through
    expect(g.serialize().junctions?.length ?? 0).toBe(0); // still removed
  });
});

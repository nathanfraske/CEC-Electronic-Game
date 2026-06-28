// SPDX-License-Identifier: Apache-2.0
// Headless tests for Cable P0 (docs/ui/bus-scaling-design.md): the data layer + deriveCableLinks. Proves a
// Cable lowers to per-bit net-label pairs that buildNetlist unions into N INDEPENDENT nets — node-for-node
// identical to N hand-wires — and that a cable-free graph round-trips byte-identical (golden-safe). Pure
// graph + buildNetlist; no sim/wasm.
import { describe, it, expect } from "vitest";
import { BoardGraph } from "./graph";
import type { Component, PinRef } from "./graph";
import { registerUserIc, unregisterUserIc } from "./userIc";
import { buildNetlist } from "./netlist";

function place(
  g: BoardGraph,
  kind: string,
  col: number,
  row: number,
): Component {
  const c = g.place(kind, { col, row });
  if (!c) throw new Error("unknown kind: " + kind);
  return c;
}
function registerBus8(tag: string) {
  const inner = new BoardGraph();
  const frame = place(inner, "DIP8", 0, 0);
  registerUserIc({
    tag,
    name: tag,
    package: { archetype: "DIP", pinCount: 8 },
    frameId: frame.id,
    graph: inner.serialize(),
    pinNames: ["A0", "A1", "A2", "A3", "VCC", "GND", "EN", "CLK"],
    pinRoles: ["in", "in", "in", "in", "vcc", "gnd", "in", "clk"],
    role: "subassembly",
  });
}

/** Read the netlist node of each (componentId, pinIndex) by hanging a high-Z sense resistor on it (the
 *  sweepNetlist idiom): the sense resistor's first node IS that pin's net. Mutates `g`. */
function pinNodes(g: BoardGraph, pins: PinRef[]): (number | undefined)[] {
  const gnd = place(g, "GND", -20, -20);
  const senseIds = pins.map((p, k) => {
    const r = place(g, "R", -22, -22 - k);
    r.value = 1e9;
    g.connect({ componentId: r.id, pinIndex: 0 }, p);
    g.connect(
      { componentId: r.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
    return r.id;
  });
  const nl = buildNetlist(g, false)!;
  return senseIds.map((id) => nl.nodesOfComponent.get(id)?.[0]);
}

describe("Cable P0: serialize / golden-safety", () => {
  it("a cable-free graph emits no cables key (byte-identical round-trip)", () => {
    const g = new BoardGraph();
    place(g, "R", 0, 0);
    const snap = g.serialize();
    expect("cables" in snap).toBe(false);
    expect("nextCableId" in snap).toBe(false);
  });

  it("a graph with a cable serializes + restores the cable and its owned labels", () => {
    registerBus8("CBL1");
    try {
      const g = new BoardGraph();
      const a = place(g, "CBL1", 0, 0);
      const b = place(g, "CBL1", 20, 0);
      g.addCable({
        base: "A",
        width: 4,
        route: [{ col: 10, row: 0 }],
        src: { componentId: a.id, pinIndices: [0, 1, 2, 3] },
        dst: { componentId: b.id, pinIndices: [0, 1, 2, 3] },
      });
      // 4 bits × 2 ends = 8 owner-tagged labels.
      expect(
        [...g.netLabels.values()].filter((l) => l.ownerId !== undefined),
      ).toHaveLength(8);
      const snap = g.serialize();
      expect(snap.cables).toHaveLength(1);
      const g2 = new BoardGraph();
      g2.restore(snap);
      expect(g2.cables.size).toBe(1);
      expect(
        [...g2.netLabels.values()].filter((l) => l.ownerId !== undefined),
      ).toHaveLength(8);
    } finally {
      unregisterUserIc("CBL1");
    }
  });
});

describe("Cable P0: deriveCableLinks idempotency", () => {
  it("re-running is a no-op (stable label count, names, and next id)", () => {
    registerBus8("CBL2");
    try {
      const g = new BoardGraph();
      const a = place(g, "CBL2", 0, 0);
      const b = place(g, "CBL2", 20, 0);
      g.addCable({
        base: "A",
        width: 4,
        route: [],
        src: { componentId: a.id, pinIndices: [0, 1, 2, 3] },
        dst: { componentId: b.id, pinIndices: [0, 1, 2, 3] },
      });
      const before = [...g.netLabels.values()]
        .map((l) => `${l.id}:${l.name}`)
        .sort()
        .join(",");
      g.deriveCableLinks();
      g.deriveCableLinks();
      const after = [...g.netLabels.values()]
        .map((l) => `${l.id}:${l.name}`)
        .sort()
        .join(",");
      expect(after).toBe(before); // identical labels + ids → no node-numbering drift
    } finally {
      unregisterUserIc("CBL2");
    }
  });
});

describe("Cable P0: connectivity equivalence (cable === N hand-wires)", () => {
  it("connects bit-i src↔dst, keeps bits independent, identical to hand-wires", () => {
    registerBus8("CBL3");
    try {
      const mk = (mode: "cable" | "wires") => {
        const g = new BoardGraph();
        const a = place(g, "CBL3", 0, 0);
        const b = place(g, "CBL3", 20, 0);
        if (mode === "cable") {
          g.addCable({
            base: "A",
            width: 4,
            route: [],
            src: { componentId: a.id, pinIndices: [0, 1, 2, 3] },
            dst: { componentId: b.id, pinIndices: [0, 1, 2, 3] },
          });
        } else {
          for (let i = 0; i < 4; i++)
            g.connect(
              { componentId: a.id, pinIndex: i },
              { componentId: b.id, pinIndex: i },
            );
        }
        const pins: PinRef[] = [];
        for (let i = 0; i < 4; i++)
          pins.push({ componentId: a.id, pinIndex: i });
        for (let i = 0; i < 4; i++)
          pins.push({ componentId: b.id, pinIndex: i });
        return pinNodes(g, pins); // [a0,a1,a2,a3, b0,b1,b2,b3]
      };
      const check = (n: (number | undefined)[]) => {
        // each bit: a.Ai === b.Ai (connected by the cable/wire)
        for (let i = 0; i < 4; i++) expect(n[i]).toBe(n[4 + i]);
        // bits are independent: the four bit-nodes are all distinct
        expect(new Set([n[0], n[1], n[2], n[3]]).size).toBe(4);
      };
      const cable = mk("cable");
      const wires = mk("wires");
      check(cable);
      check(wires);
      // and the SAME node partition shape (canonicalized) — cable is electrically the N-wire circuit
      const canon = (n: (number | undefined)[]) => {
        const seen = new Map<number, number>();
        return n
          .map((x) => {
            if (x === undefined) return -1;
            if (!seen.has(x)) seen.set(x, seen.size);
            return seen.get(x)!;
          })
          .join(",");
      };
      expect(canon(cable)).toBe(canon(wires));
    } finally {
      unregisterUserIc("CBL3");
    }
  });
});

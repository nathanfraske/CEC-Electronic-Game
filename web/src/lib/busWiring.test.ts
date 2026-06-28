// SPDX-License-Identifier: Apache-2.0
// Headless tests for the bus-wiring planner (the "draw one → wire the whole bus" tedium-killer). Pure
// graph reads, no sim/wasm — runs in node like the other netlist/userIc tests.
import { describe, it, expect } from "vitest";
import { BoardGraph } from "./graph";
import type { Component, PinRef } from "./graph";
import { registerUserIc, unregisterUserIc } from "./userIc";
import { parseBusLabel, busOfPin, planBusAutocomplete } from "./busWiring";

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

// Register an 8-pin user IC whose first four pads are the bus A0..A3 (pins 4..7 are non-bus controls).
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

describe("busWiring: parseBusLabel", () => {
  it("splits a name into base + trailing index, else null", () => {
    expect(parseBusLabel("A0")).toEqual({ base: "A", index: 0 });
    expect(parseBusLabel("SUM3")).toEqual({ base: "SUM", index: 3 });
    expect(parseBusLabel("Q12")).toEqual({ base: "Q", index: 12 });
    expect(parseBusLabel("R 0")).toEqual({ base: "R", index: 0 });
    expect(parseBusLabel("CLK")).toBeNull();
    expect(parseBusLabel("3")).toBeNull(); // a bare number isn't a bus member
    expect(parseBusLabel("")).toBeNull();
    expect(parseBusLabel(undefined)).toBeNull();
  });
});

describe("busWiring: busOfPin + planBusAutocomplete", () => {
  it("groups indexed pins into a bus and plans the sibling strands", () => {
    registerBus8("BUSX");
    try {
      const g = new BoardGraph();
      const a = place(g, "BUSX", 0, 0);
      const b = place(g, "BUSX", 20, 0);

      // busOfPin: pin 0 (A0) belongs to the 4-wide bus A (pins 0..3); CLK (pin 7) is not a bus.
      const bus = busOfPin(g, { componentId: a.id, pinIndex: 0 });
      expect(bus?.base).toBe("A");
      expect(bus?.members.map((m) => m.pinIndex)).toEqual([0, 1, 2, 3]);
      expect(busOfPin(g, { componentId: a.id, pinIndex: 7 })).toBeNull();

      // Drawing A0(a) → A0(b) plans the other three strands, paired by index.
      const plan = planBusAutocomplete(
        g,
        { componentId: a.id, pinIndex: 0 },
        { componentId: b.id, pinIndex: 0 },
      );
      expect(plan).not.toBeNull();
      expect(plan!.map(([s, d]) => [s.pinIndex, d.pinIndex])).toEqual([
        [1, 1],
        [2, 2],
        [3, 3],
      ]);
    } finally {
      unregisterUserIc("BUSX");
    }
  });

  it("preserves the index offset the player drew (A0→A1 ⇒ A1→A2, A2→A3)", () => {
    registerBus8("BUSY");
    try {
      const g = new BoardGraph();
      const a = place(g, "BUSY", 0, 0);
      const b = place(g, "BUSY", 20, 0);
      const plan = planBusAutocomplete(
        g,
        { componentId: a.id, pinIndex: 0 }, // A0
        { componentId: b.id, pinIndex: 1 }, // A1  → offset +1
      );
      // A1→A2, A2→A3 (A3 would need A4 on the dest — absent → that bit is dropped, so the whole plan
      // is refused as not-clean). Offset connections only complete when EVERY bit has an aligned partner.
      expect(plan).toBeNull();
    } finally {
      unregisterUserIc("BUSY");
    }
  });

  it("refuses to clobber: a sibling already wired ⇒ no auto-complete", () => {
    registerBus8("BUSZ");
    try {
      const g = new BoardGraph();
      const a = place(g, "BUSZ", 0, 0);
      const b = place(g, "BUSZ", 20, 0);
      // Pre-wire A1(a) → A1(b): now drawing A0→A0 must NOT auto-complete (a strand is occupied).
      g.connect(
        { componentId: a.id, pinIndex: 1 },
        { componentId: b.id, pinIndex: 1 },
      );
      const plan = planBusAutocomplete(
        g,
        { componentId: a.id, pinIndex: 0 },
        { componentId: b.id, pinIndex: 0 },
      );
      expect(plan).toBeNull();
    } finally {
      unregisterUserIc("BUSZ");
    }
  });

  it("a non-bus pin (CLK) draws a single wire — no plan", () => {
    registerBus8("BUSW");
    try {
      const g = new BoardGraph();
      const a = place(g, "BUSW", 0, 0);
      const b = place(g, "BUSW", 20, 0);
      const plan = planBusAutocomplete(
        g,
        { componentId: a.id, pinIndex: 7 } as PinRef, // CLK
        { componentId: b.id, pinIndex: 7 } as PinRef,
      );
      expect(plan).toBeNull();
    } finally {
      unregisterUserIc("BUSW");
    }
  });
});

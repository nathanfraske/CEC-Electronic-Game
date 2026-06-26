// SPDX-License-Identifier: Apache-2.0
// Unit tests for the sequential-cell analyzer (lib/cellAnalysis.ts). The headline case is the owner's
// transmission-gate D-LATCH (two inverters closed by a feedback pass-gate, with EN/ENB control + a Q
// output) — which a combinational sweep wrongly collapsed to a buffer. analyzeCell must (1) detect the
// feedback loop ⇒ sequential, (2) recognise EN/ENB as a complementary clock pair, and (3) pick Q (with no
// Q̄). Plus a combinational control (no loop) and a Q/Q̄ output case.
import { describe, it, expect } from "vitest";
import { analyzeCell, type ResolvedCell } from "./cellAnalysis";
import type { GraphSnapshot } from "./graph";

// Sub-cell defs the latch is built from: a transmission gate (in/out pass, NO behavior) and an inverter
// (a characterized gain stage — behavior present). Matches the owner's saved cec-circuit.
const resolveCell = (tag: string): ResolvedCell | undefined => {
  if (tag === "TG") return { pinRoles: ["in", "out"] }; // [IN, OUT, SEL_BAR, SEL] — no behavior ⇒ pass
  if (tag === "INV")
    return { pinRoles: ["out", "vcc", "in", "gnd"], behavior: { word: 1 } };
  return undefined;
};

// The D-latch inner graph (frame id 1; TGs 2/3; inverters 4/5), wired exactly like the owner's cell:
//   D --TG(in,EN)--> A --INV4--> B --INV5--> Q --TG(fb,EN̄)--> A   (feedback)
// Frame pins: [D, GND, VCC, Q, EN, ENB]. TG pins [IN,OUT,SEL_BAR,SEL]; INV pins [OUT,VCC,IN,GND].
function dLatchGraph(): GraphSnapshot {
  const c = (id: number, kind: string) => ({
    id,
    kind,
    cell: { col: 0, row: 0 },
    value: 0,
    rot: 0,
  });
  const w = (id: number, from: unknown, to: unknown) => ({ id, from, to });
  const pin = (componentId: number, pinIndex: number) => ({
    componentId,
    pinIndex,
  });
  const j = (id: number) => ({ junctionId: id });
  return {
    components: [
      c(1, "__DIE_FF_D LATCH"),
      c(2, "TG"),
      c(3, "TG"),
      c(4, "INV"),
      c(5, "INV"),
    ],
    wires: [
      w(1, pin(4, 0), pin(5, 2)), // inv4.OUT — inv5.IN   (net B)
      w(2, pin(2, 1), j(1)), // TG(in).OUT — j1
      w(3, j(1), pin(4, 2)), // j1 — inv4.IN          (net A)
      w(35, j(1), pin(3, 0)), // j1 — TG(fb).IN        (net A)
      w(40, pin(5, 0), j(18)), // inv5.OUT — j18
      w(42, j(18), pin(1, 3)), // j18 — frame.Q        (net Q)
      w(44, pin(3, 1), j(18)), // TG(fb).OUT — j18      (net Q)
      w(46, pin(1, 0), pin(2, 0)), // frame.D — TG(in).IN  (net D)
      w(45, pin(1, 4), j(16)), // frame.EN — j16
      w(37, j(16), pin(2, 3)), // j16 — TG(in).SEL       (net EN)
      w(39, pin(3, 2), j(16)), // TG(fb).SEL_BAR — j16   (net EN)
      w(26, j(12), pin(1, 5)), // j12 — frame.ENB
      w(27, pin(2, 2), j(12)), // TG(in).SEL_BAR — j12   (net ENB)
      w(30, pin(3, 3), j(12)), // TG(fb).SEL — j12       (net ENB)
    ],
    junctions: [1, 18, 16, 12].map((id) => ({ id, cell: { col: 0, row: 0 } })),
    netLabels: [],
  } as unknown as GraphSnapshot;
}

describe("analyzeCell — D latch (the buffer-bug case)", () => {
  const a = analyzeCell({
    graph: dLatchGraph(),
    frameId: 1,
    pinRoles: ["in", "gnd", "vcc", "out"], // EN/ENB (4,5) deliberately UNTAGGED — the real bug
    pinNames: ["D", "GND", "VCC", "Q", "EN", "ENB"],
    resolveCell,
  });

  it("detects the feedback loop ⇒ sequential", () => {
    expect(a.sequential).toBe(true);
    expect(a.reason).toMatch(/storage loop|feedback/i);
  });

  it("recognises EN/ENB as a complementary clock pair (clock = EN, complement = ENB)", () => {
    expect(a.clockPin).toBe(4);
    expect(a.clockComplementPin).toBe(5);
  });

  it("picks Q as the output, with no Q̄ available", () => {
    expect(a.outPin).toBe(3);
    expect(a.qbarPin).toBe(-1);
  });

  it("sweeps D as the lone data input, and finds the rails", () => {
    expect(a.dataInputs).toEqual([0]);
    expect(a.gndPin).toBe(1);
    expect(a.vccPin).toBe(2);
  });
});

describe("analyzeCell — combinational + Q/Q̄", () => {
  it("a single inverter (no loop) is NOT sequential", () => {
    const graph = {
      components: [
        {
          id: 1,
          kind: "__DIE_FF_INVx",
          cell: { col: 0, row: 0 },
          value: 0,
          rot: 0,
        },
        { id: 2, kind: "INV", cell: { col: 0, row: 0 }, value: 0, rot: 0 },
      ],
      wires: [
        {
          id: 1,
          from: { componentId: 1, pinIndex: 0 },
          to: { componentId: 2, pinIndex: 2 },
        }, // IN→inv.IN
        {
          id: 2,
          from: { componentId: 2, pinIndex: 0 },
          to: { componentId: 1, pinIndex: 1 },
        }, // inv.OUT→OUT
      ],
      junctions: [],
      netLabels: [],
    } as unknown as GraphSnapshot;
    const a = analyzeCell({
      graph,
      frameId: 1,
      pinRoles: ["in", "out", "vcc", "gnd"],
      pinNames: ["A", "Y", "VCC", "GND"],
      resolveCell,
    });
    expect(a.sequential).toBe(false);
    expect(a.dataInputs).toEqual([0]);
    expect(a.outPin).toBe(1);
  });

  it("recognises a Q / Q̄ complementary output pair", () => {
    const a = analyzeCell({
      graph: {
        components: [],
        wires: [],
        junctions: [],
        netLabels: [],
      } as unknown as GraphSnapshot,
      frameId: 1,
      pinRoles: ["in", "clk", "gnd", "vcc", "out", "out"],
      pinNames: ["D", "CLK", "GND", "VCC", "Q", "QB"],
      resolveCell,
    });
    expect(a.clockPin).toBe(1);
    expect(a.outPin).toBe(4); // Q
    expect(a.qbarPin).toBe(5); // Q̄
  });
});

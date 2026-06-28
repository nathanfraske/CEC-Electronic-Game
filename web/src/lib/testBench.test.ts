// SPDX-License-Identifier: Apache-2.0
// Headless tests for the test-bench grading engine. The wasm core loads in node via initSync (the
// "APP-ONLY" caveat is obsolete), so the full drive→settle→read→compare loop is unit-testable. Fixture:
// a cell wrapping a built-in NAND gate (a real ELEM_GATE), graded by gradeCombinational.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { initSync } from "../wasm/sim_wasm.js";
import { BoardGraph } from "./graph";
import type { Component } from "./graph";
import {
  gradeCombinational,
  pinsFromRoles,
  expectedWordForOp,
} from "./testBench";

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

// A cell whose inner circuit is one built-in NAND gate, frame pins [0 OUT, 1 IN, 2 IN, 3 VCC, 4 GND].
function nandCell(): {
  graph: ReturnType<BoardGraph["serialize"]>;
  frameId: number;
} {
  const inner = new BoardGraph();
  const frame = place(inner, "DIP8", 0, 0);
  const g = place(inner, "NAND", 6, 0); // pins: Y=0, A=1, B=2, VCC=3, GND=4
  connect(inner, frame, 0, g, 0); // OUT  ↔ Y
  connect(inner, frame, 1, g, 1); // IN0  ↔ A
  connect(inner, frame, 2, g, 2); // IN1  ↔ B
  connect(inner, frame, 3, g, 3); // VCC  ↔ VCC
  connect(inner, frame, 4, g, 4); // GND  ↔ GND
  return { graph: inner.serialize(), frameId: frame.id };
}

const ROLES = ["out", "in", "in", "vcc", "gnd"] as const;

beforeAll(() => {
  initSync({
    module: readFileSync(new URL("../wasm/sim_wasm_bg.wasm", import.meta.url)),
  });
});

describe("testBench: expectedWordForOp", () => {
  it("maps named ops to truth words (combo encoding)", () => {
    expect(expectedWordForOp("AND", 2)).toBe(0x8);
    expect(expectedWordForOp("OR", 2)).toBe(0xe);
    expect(expectedWordForOp("NOR", 2)).toBe(0x1);
    expect(expectedWordForOp("NAND", 2)).toBe(0x7);
    expect(expectedWordForOp("XOR", 2)).toBe(0x6);
    expect(expectedWordForOp("NOT", 1)).toBe(0b01);
    expect(expectedWordForOp("BUF", 1)).toBe(0b10);
    expect(expectedWordForOp("ADD", 2)).toBeNull(); // not a 1-bit primitive
  });
});

describe("testBench: pinsFromRoles", () => {
  it("accepts a powered single-output ≤4-input cell", () => {
    const p = pinsFromRoles(["out", "in", "in", "vcc", "gnd"]);
    expect("pins" in p && p.k).toBe(2);
  });
  it("rejects no-output, multi-output, and inout cells with a reason", () => {
    expect("error" in pinsFromRoles(["in", "in", "vcc", "gnd"])).toBe(true);
    expect("error" in pinsFromRoles(["out", "out", "in", "gnd"])).toBe(true);
    expect("error" in pinsFromRoles(["inout", "in", "gnd"])).toBe(true);
  });
});

describe("testBench: gradeCombinational", () => {
  it("recognizes a NAND cell and settles every vector", () => {
    const { graph, frameId } = nandCell();
    const r = gradeCombinational(graph, frameId, [...ROLES]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.inputs).toBe(2);
    expect(r.word).toBe(0x7); // NAND
    expect(r.recognizedAs).toBe("NAND");
    expect(r.allSettled).toBe(true);
    expect(r.unsettled).toEqual([]);
    expect(r.vectors).toHaveLength(4);
    expect(r.vectors.every((v) => v.settled)).toBe(true);
  });

  it("grades PASS when the expected op matches (test as NAND)", () => {
    const { graph, frameId } = nandCell();
    const r = gradeCombinational(graph, frameId, [...ROLES], {
      expectedWord: expectedWordForOp("NAND", 2)!,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.allPass).toBe(true);
    expect(r.firstFail).toBe(-1);
    expect(r.vectors.every((v) => v.pass)).toBe(true);
  });

  it('grades "Not yet" with the first failing vector when the expected op is wrong (test as AND)', () => {
    const { graph, frameId } = nandCell();
    const r = gradeCombinational(graph, frameId, [...ROLES], {
      expectedWord: expectedWordForOp("AND", 2)!,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.allPass).toBe(false);
    // NAND (0x7) vs AND (0x8) differ at every combo, so the first failure is combo 0.
    expect(r.firstFail).toBe(0);
    // Each vector carries its own expected + pass for the per-bit grid.
    expect(r.vectors[0].expected).toBe(0); // AND(0,0)=0; NAND(0,0)=1 → fail
    expect(r.vectors[0].out).toBe(1);
    expect(r.vectors[0].pass).toBe(false);
  });

  it("refuses a multi-output cell with a reason (Door-2 territory)", () => {
    const { graph, frameId } = nandCell();
    const r = gradeCombinational(graph, frameId, [
      "out",
      "out",
      "in",
      "vcc",
      "gnd",
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/output/i);
  });
});

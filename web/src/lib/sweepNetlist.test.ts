// SPDX-License-Identifier: Apache-2.0
// Headless tests for the SEQUENTIAL characterization wiring (Option A1). sweepNetlist.ts is wasm-free
// (it only builds netlists), so the determinism-critical wiring — the square clock landing on the CLK
// pin, the sense resistor on Q — is testable in node; the live wasm sweep (characterize.ts) is
// app-verified, exactly like the combinational characterizer.
import { describe, it, expect } from "vitest";
import { BoardGraph } from "./graph";
import type { Component } from "./graph";
import {
  sequentialSweepNetlist,
  classifySequentialSamples,
  type SweepPins,
} from "./sweepNetlist";

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

const ELEM_ACSOURCE = 7; // the square clock compiles to an AC source (PULSE → ELEM_ACSOURCE)
const ELEM_DFF = 19;

describe("classifySequentialSamples (Option A1, fail-safe)", () => {
  it("accepts a settled Q and reports the bit", () => {
    expect(classifySequentialSamples([1, 1, 1, 1])).toEqual({
      ok: true,
      bit: 1,
    });
    expect(classifySequentialSamples([0, 0, 0, 0])).toEqual({
      ok: true,
      bit: 0,
    });
    // a leading transient before it latches is fine — only the tail must be settled
    expect(classifySequentialSamples([0, 0, 1, 1, 1])).toEqual({
      ok: true,
      bit: 1,
    });
  });

  it("refuses a toggling / self-dependent cell (Q keeps changing across edges)", () => {
    expect(classifySequentialSamples([0, 1, 0, 1, 0, 1]).ok).toBe(false);
    expect(classifySequentialSamples([1, 1, 0]).ok).toBe(false); // unsettled tail
  });

  it("refuses too few samples (can't confirm stability)", () => {
    expect(classifySequentialSamples([1]).ok).toBe(false);
  });
});

describe("sequentialSweepNetlist wiring", () => {
  // A plain D flip-flop cell in a DIP8 die: Q→OUT(0), D→IN(2), CLK→pin4. Frame 1=VCC, 3=GND.
  function dffDie(): {
    snap: ReturnType<BoardGraph["serialize"]>;
    frameId: number;
    ffId: number;
  } {
    const inner = new BoardGraph();
    const frame = place(inner, "DIP8", 0, 0);
    const ff = place(inner, "FF", 4, 0);
    connect(inner, ff, 0, frame, 0); // Q → OUT
    connect(inner, ff, 1, frame, 2); // D → IN
    connect(inner, ff, 2, frame, 4); // CLK → frame pin 4
    return { snap: inner.serialize(), frameId: frame.id, ffId: ff.id };
  }

  const pins: SweepPins = {
    inPins: [2],
    outPin: 0,
    gndPin: 3,
    vccPin: 1,
    clkPin: 4,
  };

  it("adds a square clock on the CLK pin and a sense resistor on Q", () => {
    const { snap, frameId, ffId } = dffDie();
    const built = sequentialSweepNetlist(snap, frameId, pins, 0);
    expect(built).not.toBeNull();
    const types = [...built!.nl.types];
    expect(types).toContain(ELEM_ACSOURCE); // the clock got compiled in
    expect(types).toContain(ELEM_DFF); // the flop is still there (discrete)
    // The sense node IS the flop's Q net…
    const qNet = built!.nl.nodesOfComponent.get(ffId)?.[0];
    expect(built!.outNode).toBe(qNet);
    // …and the clock source (id = senseId+1, per the builder) is wired into the circuit on a real net
    // (not floating). (nodesOfComponent records 2-terminal a/b nodes; the clock's + node is its [0].)
    const clkNode = built!.nl.nodesOfComponent.get(built!.senseId + 1)?.[0];
    expect(typeof clkNode).toBe("number");
    expect(clkNode).toBeGreaterThan(0); // a driven node, not ground/unconnected
  });

  it("returns null when no clock pin is declared (not a sequential sweep)", () => {
    const { snap, frameId } = dffDie();
    const combo = 0;
    expect(
      sequentialSweepNetlist(snap, frameId, { ...pins, clkPin: -1 }, combo),
    ).toBeNull();
  });
});

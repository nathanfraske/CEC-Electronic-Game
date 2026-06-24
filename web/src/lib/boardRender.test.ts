// SPDX-License-Identifier: Apache-2.0
// Headless tests for the bridge over/under draw order (pure id-ordering, no PixiJS render needed).
import { describe, it, expect } from "vitest";
import { wireDrawOrder } from "./boardRender";

describe("wireDrawOrder — bridges draw OVER the traces they hop", () => {
  it("no crossings → original order, unchanged", () => {
    expect(wireDrawOrder([1, 2, 3], [])).toEqual([1, 2, 3]);
  });
  it("a hopping wire is drawn AFTER the wire it hops", () => {
    // wire 1 hops wire 2 → 1 must come after 2 (so 1's bump paints on top)
    expect(wireDrawOrder([1, 2], [[1, 2]])).toEqual([2, 1]);
  });
  it("an already-correct order is preserved", () => {
    expect(wireDrawOrder([2, 1], [[1, 2]])).toEqual([2, 1]);
  });
  it("bus: many horizontals hop one vertical → vertical first, horizontals after (stable order)", () => {
    expect(
      wireDrawOrder(
        [1, 2, 3, 10],
        [
          [1, 10],
          [2, 10],
          [3, 10],
        ],
      ),
    ).toEqual([10, 1, 2, 3]);
  });
  it("chain: 3-after-2-after-1 resolves topologically", () => {
    expect(
      wireDrawOrder(
        [3, 2, 1],
        [
          [3, 2],
          [2, 1],
        ],
      ),
    ).toEqual([1, 2, 3]);
  });
  it("cycle (mutual hops) terminates and emits every id exactly once", () => {
    const out = wireDrawOrder(
      [1, 2],
      [
        [1, 2],
        [2, 1],
      ],
    );
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(out.length).toBe(2);
  });
  it("L-wire chain: hopped-and-hopper resolves (v before w before h)", () => {
    // w hops v (w after v); h hops w (h after w) → v, w, h
    expect(
      wireDrawOrder(
        [10, 20, 30],
        [
          [20, 10],
          [30, 20],
        ],
      ),
    ).toEqual([10, 20, 30]);
  });
  it("unknown ids in overpasses are ignored (robust to stale edges)", () => {
    expect(
      wireDrawOrder(
        [1, 2],
        [
          [1, 99],
          [99, 2],
        ],
      ),
    ).toEqual([1, 2]);
  });
  it("a self-edge is ignored", () => {
    expect(wireDrawOrder([1, 2], [[1, 1]])).toEqual([1, 2]);
  });
  it("duplicate edges are harmless", () => {
    expect(
      wireDrawOrder(
        [1, 2],
        [
          [1, 2],
          [1, 2],
          [1, 2],
        ],
      ),
    ).toEqual([2, 1]);
  });
});

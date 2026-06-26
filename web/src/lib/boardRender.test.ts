// SPDX-License-Identifier: Apache-2.0
// Headless tests for the bridge over/under draw order (pure id-ordering, no PixiJS render needed).
import { describe, it, expect } from "vitest";
import {
  wireDrawOrder,
  snapToBoxEdge,
  firstFreePerimeterCell,
} from "./boardRender";

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

describe("snapToBoxEdge — Alt-drag a free-form pin to the nearest box edge", () => {
  // Box 6 wide × 8 tall: cols 0..5, rows 0..7. A pin must always land ON the perimeter.
  it("snaps a point already on an edge to that edge", () => {
    expect(snapToBoxEdge(0, 3, 6, 8)).toEqual({ dx: 0, dy: 3 }); // left
    expect(snapToBoxEdge(5, 2, 6, 8)).toEqual({ dx: 5, dy: 2 }); // right
    expect(snapToBoxEdge(3, 0, 6, 8)).toEqual({ dx: 3, dy: 0 }); // top
    expect(snapToBoxEdge(2, 7, 6, 8)).toEqual({ dx: 2, dy: 7 }); // bottom
  });
  it("projects an interior point onto the nearest edge", () => {
    expect(snapToBoxEdge(3, 1, 6, 8)).toEqual({ dx: 3, dy: 0 }); // 1 from top wins
    expect(snapToBoxEdge(4, 4, 6, 8)).toEqual({ dx: 5, dy: 4 }); // 1 from right wins
  });
  it("clamps a point dragged OUTSIDE the box back onto the perimeter", () => {
    expect(snapToBoxEdge(-3, 2, 6, 8)).toEqual({ dx: 0, dy: 2 }); // off the left → left edge
    expect(snapToBoxEdge(10, 9, 6, 8)).toEqual({ dx: 5, dy: 7 }); // off bottom-right → corner
  });
  it("resolves edge ties top → bottom → left → right", () => {
    expect(snapToBoxEdge(0, 0, 6, 8)).toEqual({ dx: 0, dy: 0 }); // top-left corner → top
    expect(snapToBoxEdge(2, 2, 6, 6)).toEqual({ dx: 2, dy: 0 }); // equidistant → top
  });
});

describe("firstFreePerimeterCell — where a newly-added free-form pin lands", () => {
  // Box 5 wide × 4 tall: cols 0..4, rows 0..3.
  it("fills the TOP edge left→right first", () => {
    expect(firstFreePerimeterCell([], 5, 4)).toEqual({ dx: 0, dy: 0 });
    expect(firstFreePerimeterCell([{ dx: 0, dy: 0 }], 5, 4)).toEqual({
      dx: 1,
      dy: 0,
    });
  });
  it("flows onto the RIGHT, then BOTTOM, then LEFT edges as the top fills", () => {
    const top = [0, 1, 2, 3, 4].map((dx) => ({ dx, dy: 0 }));
    expect(firstFreePerimeterCell(top, 5, 4)).toEqual({ dx: 4, dy: 1 }); // right edge
    const topRight = [
      ...top,
      { dx: 4, dy: 1 },
      { dx: 4, dy: 2 },
      { dx: 4, dy: 3 },
    ];
    expect(firstFreePerimeterCell(topRight, 5, 4)).toEqual({ dx: 3, dy: 3 }); // bottom edge R→L
  });
  it("skips occupied cells and never returns an interior cell", () => {
    const cell = firstFreePerimeterCell(
      [
        { dx: 0, dy: 0 },
        { dx: 1, dy: 0 },
      ],
      5,
      4,
    );
    expect(cell).toEqual({ dx: 2, dy: 0 });
    const onEdge = (c: { dx: number; dy: number }): boolean =>
      c.dx === 0 || c.dx === 4 || c.dy === 0 || c.dy === 3;
    expect(onEdge(cell)).toBe(true);
  });
  it("falls back to the top-left corner when the whole perimeter is taken", () => {
    const all: { dx: number; dy: number }[] = [];
    for (let dx = 0; dx < 5; dx++)
      for (let dy = 0; dy < 4; dy++) all.push({ dx, dy });
    expect(firstFreePerimeterCell(all, 5, 4)).toEqual({ dx: 0, dy: 0 });
  });
});

// SPDX-License-Identifier: Apache-2.0
// Headless test for the geometry-undo mechanism (Chip Bench Phase 0): box/pin geometry lives in the global
// free-form registry, not the graph, so undo snapshots it via captureFreeFormGeoms / restoreFreeFormGeoms.
import { describe, it, expect } from "vitest";
import {
  BoardGraph,
  registerFreeFormFrame,
  freeFormGeom,
  captureFreeFormGeoms,
  restoreFreeFormGeoms,
  FREE_FORM_DIE_PREFIX,
} from "./graph";

describe("captureFreeFormGeoms / restoreFreeFormGeoms — geometry undo", () => {
  it("captures the live geom of placed free-form frames, deep-cloned, and restores it", () => {
    const subTag = "GeomUndo";
    const dieTag = FREE_FORM_DIE_PREFIX + subTag;
    registerFreeFormFrame(subTag, {
      w: 5,
      h: 9,
      pins: [
        { dx: 0, dy: 4, name: "IN" },
        { dx: 4, dy: 4, name: "OUT" },
      ],
    });
    // A graph that places the free-form die frame.
    const g = new BoardGraph();
    g.place(dieTag, { col: 0, row: 0 });
    const snap = g.serialize();

    // Snapshot the geometry (what the undo entry stores alongside the graph).
    const captured = captureFreeFormGeoms(snap);
    expect(captured).toHaveLength(1);
    expect(captured[0]![0]).toBe(dieTag);
    expect(captured[0]![1].w).toBe(5);

    // Mutate the geometry (a box-resize + pin-move): grow to 7×11, slide IN to the bottom.
    registerFreeFormFrame(subTag, {
      w: 7,
      h: 11,
      pins: [
        { dx: 3, dy: 10, name: "IN" },
        { dx: 6, dy: 5, name: "OUT" },
      ],
    });
    expect(freeFormGeom(dieTag)!.w).toBe(7);
    expect(freeFormGeom(dieTag)!.pins[0]).toEqual({
      dx: 3,
      dy: 10,
      name: "IN",
    });
    // The earlier capture must be UNAFFECTED by that mutation (deep clone).
    expect(captured[0]![1].w).toBe(5);
    expect(captured[0]![1].pins[0]).toEqual({ dx: 0, dy: 4, name: "IN" });

    // Undo: restore the captured geometry → the registry is back to the original.
    restoreFreeFormGeoms(captured);
    const back = freeFormGeom(dieTag)!;
    expect(back.w).toBe(5);
    expect(back.h).toBe(9);
    expect(back.pins[0]).toEqual({ dx: 0, dy: 4, name: "IN" });
    expect(back.pins[1]).toEqual({ dx: 4, dy: 4, name: "OUT" });
  });

  it("captures nothing for a board with no free-form chips", () => {
    const g = new BoardGraph();
    g.place("R", { col: 0, row: 0 });
    expect(captureFreeFormGeoms(g.serialize())).toEqual([]);
  });
});

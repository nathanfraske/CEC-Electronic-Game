// SPDX-License-Identifier: Apache-2.0
// Headless test for overworld device-geometry editing (Chip Bench Phase 1a): setUserIcFreeForm edits a
// placed subassembly's DEFINITION (propagating to the footprint + die-frame), and captureUserIcGeoms /
// restoreUserIcGeoms make that undoable (a placed chip's kind is the user-IC tag, which Phase 0's
// die-frame capture misses).
import { describe, it, expect } from "vitest";
import {
  BoardGraph,
  freeFormGeom,
  FREE_FORM_DIE_PREFIX,
  type GraphSnapshot,
} from "./graph";
import {
  registerUserIc,
  unregisterUserIc,
  getUserIc,
  setUserIcFreeForm,
  captureUserIcGeoms,
  restoreUserIcGeoms,
  type UserIc,
} from "./userIc";

const EMPTY_GRAPH = {
  components: [],
  wires: [],
  junctions: [],
  netLabels: [],
  nextComponentId: 1,
  nextWireId: 1,
  nextJunctionId: 1,
  nextNetLabelId: 1,
} as unknown as GraphSnapshot;

function devDef(): UserIc {
  return {
    tag: "DevEdit",
    name: "DevEdit",
    package: { archetype: "BLOCK", pinCount: 2 },
    frameId: 1,
    graph: EMPTY_GRAPH,
    freeForm: {
      w: 5,
      h: 9,
      pins: [
        { dx: 0, dy: 4, name: "IN" },
        { dx: 4, dy: 4, name: "OUT" },
      ],
    },
    role: "ic",
  };
}

describe("setUserIcFreeForm / capture / restore — overworld device geometry", () => {
  it("edits the def + die-frame and round-trips through undo", () => {
    registerUserIc(devDef());
    const dieTag = FREE_FORM_DIE_PREFIX + "DevEdit";
    try {
      // The def + die-frame both start at 5×9.
      expect(getUserIc("DevEdit")?.freeForm?.w).toBe(5);
      expect(freeFormGeom(dieTag)?.w).toBe(5);

      // A board placing the chip → capture its def geometry (what the undo entry stores).
      const g = new BoardGraph();
      g.place("DevEdit", { col: 0, row: 0 });
      const captured = captureUserIcGeoms(g.serialize());
      expect(captured).toHaveLength(1);
      expect(captured[0]![0]).toBe("DevEdit");
      expect(captured[0]![1].w).toBe(5);

      // Resize to 7×11, slide IN to the bottom — propagates to BOTH the def and the die-frame.
      expect(
        setUserIcFreeForm("DevEdit", {
          w: 7,
          h: 11,
          pins: [
            { dx: 3, dy: 10, name: "IN" },
            { dx: 6, dy: 5, name: "OUT" },
          ],
        }),
      ).toBe(true);
      expect(getUserIc("DevEdit")?.freeForm?.w).toBe(7);
      expect(getUserIc("DevEdit")?.freeForm?.pins[0]).toEqual({
        dx: 3,
        dy: 10,
        name: "IN",
      });
      expect(freeFormGeom(dieTag)?.w).toBe(7); // die-frame followed too
      // The earlier capture is unaffected (deep clone).
      expect(captured[0]![1].w).toBe(5);

      // Undo: restore the captured def geometry → both back to 5×9.
      restoreUserIcGeoms(captured);
      expect(getUserIc("DevEdit")?.freeForm?.w).toBe(5);
      expect(getUserIc("DevEdit")?.freeForm?.pins[0]).toEqual({
        dx: 0,
        dy: 4,
        name: "IN",
      });
      expect(freeFormGeom(dieTag)?.w).toBe(5);
    } finally {
      unregisterUserIc("DevEdit");
    }
  });

  it("setUserIcFreeForm is a no-op for an unknown or non-free-form tag", () => {
    expect(setUserIcFreeForm("NopeTag", { w: 3, h: 3, pins: [] })).toBe(false);
  });
});

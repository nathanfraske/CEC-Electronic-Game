// SPDX-License-Identifier: Apache-2.0
// Headless tests for the IC-maker DIE EDITOR model layer (lib/dieEditor.ts). Like netlist.test.ts
// these run in node (no PixiJS): the die helpers + the seal engine import glyphs as TYPES only, so
// the determinism-critical bits — the fresh-die init, the seal gate, and the re-kind-on-seal
// collapse expanding to the SAME netlist as the inline circuit — are verifiable without a browser.
// The navigation/rendering (drill in/out, the walls, the back bar) is UI and is NOT covered here.
import { describe, it, expect } from "vitest";
import { BoardGraph, framePackage } from "./graph";
import type { Component, GraphSnapshot } from "./graph";
import { buildNetlist } from "./netlist";
import {
  freshDieGraph,
  findDieFrameId,
  dieBounds,
  dieIsSealable,
  unusedDiePins,
} from "./dieEditor";
import { getUserIc, unregisterUserIc, captureSeal } from "./userIc";

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

describe("die editor — fresh die init", () => {
  it("starts a fresh die with just the package's own frame", () => {
    const die = freshDieGraph("SOT23_6");
    expect(die).not.toBeUndefined();
    // One component (the die frame), no wires/junctions yet.
    expect(die!.snapshot.components.length).toBe(1);
    expect(die!.snapshot.wires.length).toBe(0);
    const frame = die!.snapshot.components[0]!;
    expect(frame.id).toBe(die!.frameId);
    expect(frame.kind).toBe("SOT23_6");
    // The die frame carries the same package as the placed outer frame.
    expect(framePackage(frame.kind)).toEqual({
      archetype: "SOT-23",
      pinCount: 6,
    });
  });

  it("refuses a non-frame tag", () => {
    expect(freshDieGraph("R")).toBeUndefined();
    expect(freshDieGraph("not-a-kind")).toBeUndefined();
  });

  it("findDieFrameId resolves the die frame in a re-entered graph", () => {
    const die = freshDieGraph("DIP8")!;
    // Round-trip through a snapshot (as re-entering a saved in-progress die would).
    const g = new BoardGraph();
    g.restore(die.snapshot);
    place(g, "R", 4, 4, 1000); // add some interior parts
    const snap = g.serialize();
    expect(findDieFrameId(snap)).toBe(die.frameId);
  });

  it("findDieFrameId is undefined when there is no frame", () => {
    const g = new BoardGraph();
    place(g, "R", 0, 0, 1000);
    expect(findDieFrameId(g.serialize())).toBeUndefined();
  });
});

describe("die editor — bounds (walls)", () => {
  it("derives a buildable box around the die frame's footprint", () => {
    const die = freshDieGraph("SOT23_6")!;
    const b = dieBounds(die.snapshot, die.frameId)!;
    expect(b).not.toBeUndefined();
    const frame = die.snapshot.components[0]!;
    // The box brackets the frame's anchor on every side (margin > 0), so the interior is roomy.
    expect(b.minCol).toBeLessThan(frame.cell.col);
    expect(b.minRow).toBeLessThan(frame.cell.row);
    expect(b.maxCol).toBeGreaterThan(frame.cell.col);
    expect(b.maxRow).toBeGreaterThan(frame.cell.row);
  });

  it("has no bounds for a non-frame id", () => {
    const die = freshDieGraph("SOT23_6")!;
    expect(dieBounds(die.snapshot, 999)).toBeUndefined();
  });
});

describe("die editor — seal gate (sealable = solvable)", () => {
  it("an empty die is NOT sealable", () => {
    const die = freshDieGraph("SOT23_3")!;
    expect(dieIsSealable(die.snapshot)).toBe(false);
  });

  it("a die with a real, reference-anchored circuit IS sealable", () => {
    // Inside a SOT-23-3 die: V+ -> pin1, V- -> GND, pin2 -> R -> GND, pin3 wired to the R node.
    const g = new BoardGraph();
    const die = freshDieGraph("SOT23_3")!;
    g.restore(die.snapshot);
    const frame = g.components.get(die.frameId)!;
    const v = place(g, "V", 30, 8, 5);
    const r = place(g, "R", 30, 12, 1000);
    const gnd = place(g, "GND", 30, 16);
    connect(g, v, 0, frame, 0); // V+ -> pin1
    connect(g, v, 1, gnd, 0); // V- -> GND
    connect(g, frame, 1, r, 0); // pin2 -> R.A
    connect(g, r, 1, gnd, 0); // R.B -> GND
    expect(dieIsSealable(g.serialize())).toBe(true);
  });
});

describe("die editor — unused pins advisory", () => {
  it("counts the package leads with no wire", () => {
    const g = new BoardGraph();
    const die = freshDieGraph("SOT23_6")!; // 6 leads
    g.restore(die.snapshot);
    const frame = g.components.get(die.frameId)!;
    const r = place(g, "R", 30, 8, 1000);
    connect(g, frame, 0, r, 0); // wire only pin 1 (index 0)
    connect(g, frame, 2, r, 1); // and pin 3 (index 2)
    const unused = unusedDiePins(g.serialize(), die.frameId);
    // Pins 1 + 3 (indices 0, 2) are wired; the other four are unused.
    expect(unused).toEqual([1, 3, 4, 5]);
  });

  it("reports every lead unused for a bare die", () => {
    const die = freshDieGraph("SOT23_3")!;
    expect(unusedDiePins(die.snapshot, die.frameId)).toEqual([0, 1, 2]);
  });
});

describe("die editor — seal + collapse (seal-as-same-netlist)", () => {
  it("sealing a built die and re-kinding the outer frame yields the inline netlist", () => {
    // Build a die for a SOT-23-3 frame: a single 1 kOhm resistor between pins 1 and 2 (the "resistor
    // in a package" the existing seal tests use, but constructed via the die-editor entry point).
    const inner = new BoardGraph();
    const die = freshDieGraph("SOT23_3")!;
    inner.restore(die.snapshot);
    const frame = inner.components.get(die.frameId)!;
    const r = place(inner, "R", 30, 8, 1000);
    connect(inner, frame, 0, r, 0); // pin1 -> R.A
    connect(inner, frame, 1, r, 1); // pin2 -> R.B

    // Seal the live inner graph (what dieSeal does: captureSeal on the board's live die graph).
    const cap = captureSeal(inner, die.frameId, "DIEPKG");
    expect(cap).not.toBeUndefined();

    try {
      const ic = getUserIc("DIEPKG");
      expect(ic).not.toBeUndefined();
      expect(ic!.package).toEqual({ archetype: "SOT-23", pinCount: 3 });

      // Model the outer board: an OUTER frame placeholder of the same package, plus V + GND wired to
      // its pins. dieSeal re-kinds the placeholder (id -> the sealed tag) on exit.
      const outer = new BoardGraph();
      const v = place(outer, "V", 0, 0, 5);
      const placeholder = place(outer, "SOT23_3", 4, 0); // the empty frame the player drilled into
      const gnd = place(outer, "GND", 0, 6);
      connect(outer, v, 0, placeholder, 0); // V+ -> pin1
      connect(outer, placeholder, 1, gnd, 0); // pin2 -> GND
      connect(outer, v, 1, gnd, 0); // V- -> GND

      // Apply the SAME re-kind transform exitDie() uses (snapshot.components.map: the frame's kind ->
      // the sealed tag), then load it back and build.
      const snap = outer.serialize();
      const rekinded: GraphSnapshot = {
        ...snap,
        components: snap.components.map((c) =>
          c.id === placeholder.id ? { ...c, kind: cap!.tag } : c,
        ),
      };
      const sealedBoard = new BoardGraph();
      sealedBoard.restore(rekinded);
      const a = buildNetlist(sealedBoard);

      // Inline reference: the same V + 1 kOhm R + GND, no IC.
      const flat = new BoardGraph();
      const vf = place(flat, "V", 0, 0, 5);
      const rf = place(flat, "R", 4, 0, 1000);
      const g2 = place(flat, "GND", 0, 6);
      connect(flat, vf, 0, rf, 0);
      connect(flat, rf, 1, g2, 0);
      connect(flat, vf, 1, g2, 0);
      const b = buildNetlist(flat);

      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      // The sealed-from-die IC expands to its real parts — identical element types + values.
      expect([...a!.types]).toEqual([...b!.types]);
      expect([...a!.values]).toEqual([...b!.values]);
      expect(a!.types.length).toBe(2); // V + the IC's inner R
    } finally {
      unregisterUserIc("DIEPKG");
    }
  });
});

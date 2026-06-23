// SPDX-License-Identifier: Apache-2.0
// Headless tests for the IC-maker DIE EDITOR model layer (lib/dieEditor.ts). Like netlist.test.ts
// these run in node (no PixiJS): the die helpers + the seal engine import glyphs as TYPES only, so
// the determinism-critical bits — the fresh-die init, the seal gate, and the re-kind-on-seal
// collapse expanding to the SAME netlist as the inline circuit — are verifiable without a browser.
// The navigation/rendering (drill in/out, the walls, the back bar) is UI and is NOT covered here.
import { describe, it, expect } from "vitest";
import {
  BoardGraph,
  framePackage,
  isFrame,
  isDieFrame,
  dieFrameTag,
  PART_KINDS,
} from "./graph";
import type { Component, GraphSnapshot } from "./graph";
import { packageLayout, dieLayout } from "./packages";
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
    // The die frame is the INTERNAL perimeter variant of the placeable frame (pins on the walls),
    // but still a frame that resolves to the SAME package as the placed outer frame.
    expect(frame.kind).toBe(dieFrameTag("SOT23_6"));
    expect(isFrame(frame.kind)).toBe(true);
    expect(isDieFrame(frame.kind)).toBe(true);
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
  it("walls the die's body box with every package lead sitting ON the wall", () => {
    const die = freshDieGraph("SOT23_6")!;
    const b = dieBounds(die.snapshot, die.frameId)!;
    expect(b).not.toBeUndefined();
    const frame = die.snapshot.components[0]!;
    // The walls ARE the die body box: anchored at the frame, positive area (a roomy build interior).
    expect(b.minCol).toBe(frame.cell.col);
    expect(b.minRow).toBe(frame.cell.row);
    expect(b.maxCol).toBeGreaterThan(b.minCol);
    expect(b.maxRow).toBeGreaterThan(b.minRow);
    // Every die-frame pin lands ON the wall rectangle (pins on the walls), not inset from it.
    const k = PART_KINDS[frame.kind]!;
    for (const p of k.pins) {
      const col = frame.cell.col + p.dx;
      const row = frame.cell.row + p.dy;
      const onWall =
        col === b.minCol ||
        col === b.maxCol ||
        row === b.minRow ||
        row === b.maxRow;
      expect(onWall).toBe(true);
    }
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

describe("packages — dieLayout (perimeter relayout)", () => {
  // Every starter package: the die layout must carry the SAME pin numbers in the SAME index order
  // as the production layout (only the positions differ), so a sealed die maps each lead straight
  // through to the chip's matching pin (the seal-as-same-netlist contract). Also: the die is larger
  // (roomy interior) and every pin sits on a perimeter EDGE (dx or dy at an extreme).
  const cases: { archetype: string; pinCount: number }[] = [
    { archetype: "SOT-23", pinCount: 3 },
    { archetype: "SOT-23", pinCount: 5 },
    { archetype: "SOT-23", pinCount: 6 },
    { archetype: "VSSOP", pinCount: 8 },
    { archetype: "DIP", pinCount: 8 },
    { archetype: "DIP", pinCount: 14 },
    { archetype: "DIP", pinCount: 16 },
  ];

  for (const { archetype, pinCount } of cases) {
    it(`${archetype}-${pinCount}: same pin count + numbering/index order as packageLayout`, () => {
      const prod = packageLayout(archetype, pinCount);
      const die = dieLayout(archetype, pinCount);
      expect(die.pins.length).toBe(prod.pins.length);
      expect(die.pinCount).toBe(prod.pinCount);
      // Index i -> the same package pin NUMBER in both layouts (the load-bearing invariant).
      expect(die.pins.map((p) => p.number)).toEqual(
        prod.pins.map((p) => p.number),
      );
    });

    it(`${archetype}-${pinCount}: a roomy die with every pin on a perimeter edge`, () => {
      const prod = packageLayout(archetype, pinCount);
      const die = dieLayout(archetype, pinCount);
      // The die body is at least as large as the production footprint (and, for multi-pin parts,
      // strictly larger on the pin axis), so the interior is buildable.
      expect(die.w).toBeGreaterThanOrEqual(prod.w);
      expect(die.h).toBeGreaterThanOrEqual(prod.h);
      // Every pin sits on an outer edge of the die's bounding box (dx in {0,w} or dy in {0,h}).
      for (const p of die.pins) {
        const onEdge =
          p.dx === 0 || p.dx === die.w || p.dy === 0 || p.dy === die.h;
        expect(onEdge).toBe(true);
      }
      // Pins are actually spread apart (no two share a cell) — the whole point of the relayout.
      const cells = new Set(die.pins.map((p) => p.dx + "," + p.dy));
      expect(cells.size).toBe(die.pins.length);
    });
  }

  it("the generated die-frame kind uses the dieLayout pins (perimeter), distinct from the production frame", () => {
    const prodKind = PART_KINDS["DIP8"]!;
    const dieKind = PART_KINDS[dieFrameTag("DIP8")]!;
    expect(prodKind).toBeDefined();
    expect(dieKind).toBeDefined();
    // Same number of pins + same labels (the package numbers), but a larger footprint.
    expect(dieKind.pins.length).toBe(prodKind.pins.length);
    expect(dieKind.pins.map((p) => p.label)).toEqual(
      prodKind.pins.map((p) => p.label),
    );
    expect(dieKind.h).toBeGreaterThan(prodKind.h);
    // The die-frame kind resolves to the same package and is recognised as a (die) frame.
    expect(isFrame(dieFrameTag("DIP8"))).toBe(true);
    expect(isDieFrame(dieFrameTag("DIP8"))).toBe(true);
    expect(isDieFrame("DIP8")).toBe(false);
  });
});

describe("die editor — user-labelled pins -> sealed-chip labels", () => {
  it("carries the die frame's pin names through captureSeal onto the sealed kind's pin labels", () => {
    // Build a sealable SOT-23-3 die (V -> pin1, pin2 -> R -> GND), then NAME two of its pads.
    const g = new BoardGraph();
    const die = freshDieGraph("SOT23_3")!;
    g.restore(die.snapshot);
    const frame = g.components.get(die.frameId)!;
    const v = place(g, "V", 30, 8, 5);
    const r = place(g, "R", 30, 12, 1000);
    const gnd = place(g, "GND", 30, 16);
    connect(g, v, 0, frame, 0); // V+ -> pin1 (index 0)
    connect(g, v, 1, gnd, 0);
    connect(g, frame, 1, r, 0); // pin2 (index 1) -> R.A
    connect(g, r, 1, gnd, 0);
    // Name pin index 0 "VCC" and pin index 2 "OUT"; leave index 1 unnamed (falls back to "2").
    frame.pinNames = ["VCC", "", "OUT"];

    const cap = captureSeal(g, die.frameId, "NAMEPKG");
    expect(cap).not.toBeUndefined();
    try {
      const ic = getUserIc("NAMEPKG")!;
      // The names rode through onto the UserIc.
      expect(ic.pinNames).toEqual(["VCC", "", "OUT"]);
      // ...and onto the placeable kind's pin LABELS, with the package number as the fallback.
      const labels = PART_KINDS["NAMEPKG"]!.pins.map((p) => p.label);
      expect(labels).toEqual(["VCC", "2", "OUT"]);
    } finally {
      unregisterUserIc("NAMEPKG");
    }
  });

  it("a die with no pin names seals with the package numbers as labels (and no pinNames on the IC)", () => {
    const g = new BoardGraph();
    const die = freshDieGraph("SOT23_3")!;
    g.restore(die.snapshot);
    const frame = g.components.get(die.frameId)!;
    const r = place(g, "R", 30, 8, 1000);
    const v = place(g, "V", 30, 12, 5);
    const gnd = place(g, "GND", 30, 16);
    connect(g, v, 0, frame, 0);
    connect(g, frame, 1, r, 0);
    connect(g, r, 1, gnd, 0);
    connect(g, v, 1, gnd, 0);

    const cap = captureSeal(g, die.frameId, "PLAINPKG");
    expect(cap).not.toBeUndefined();
    try {
      const ic = getUserIc("PLAINPKG")!;
      expect(ic.pinNames).toBeUndefined();
      expect(PART_KINDS["PLAINPKG"]!.pins.map((p) => p.label)).toEqual([
        "1",
        "2",
        "3",
      ]);
    } finally {
      unregisterUserIc("PLAINPKG");
    }
  });
});

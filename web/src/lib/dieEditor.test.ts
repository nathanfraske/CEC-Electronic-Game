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
import { packageLayout, dieLayout, DIE_SCALE } from "./packages";
import { buildNetlist } from "./netlist";
import {
  freshDieGraph,
  findDieFrameId,
  dieBounds,
  dieIsSealable,
  unusedDiePins,
  dieTestGraph,
  innerDiesForSave,
  restoreInnerDies,
  isStandaloneDieGraph,
  placeableFrameTag,
  type InnerDie,
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
  it("every lead sits inside the die's wall box, which has buildable interior room", () => {
    // The walls are the package BODY box (dieLayout's scaled w×h, anchored at the frame). The
    // proportional die editor places every lead INSIDE that box — containment for the soft-placement
    // check + the seal mapping — and the box is strictly larger than the lead span on both axes, so
    // there's room to author the circuit between the leads.
    for (const tag of ["SOT23_6", "DIP8", "VSSOP8"]) {
      const die = freshDieGraph(tag)!;
      const b = dieBounds(die.snapshot, die.frameId)!;
      const frame = die.snapshot.components[0]!;
      expect(b.maxCol).toBeGreaterThan(b.minCol);
      expect(b.maxRow).toBeGreaterThan(b.minRow);
      const k = PART_KINDS[frame.kind]!;
      for (const p of k.pins) {
        const col = frame.cell.col + p.dx;
        const row = frame.cell.row + p.dy;
        // Inside the body box (so containment + the seal mapping see every lead).
        expect(col).toBeGreaterThanOrEqual(b.minCol);
        expect(col).toBeLessThanOrEqual(b.maxCol);
        expect(row).toBeGreaterThanOrEqual(b.minRow);
        expect(row).toBeLessThanOrEqual(b.maxRow);
      }
      // The interior is at least as large as the lead span on both axes — room between the leads.
      const dxs = k.pins.map((p) => p.dx);
      const dys = k.pins.map((p) => p.dy);
      const leadW = Math.max(...dxs) - Math.min(...dxs);
      const leadH = Math.max(...dys) - Math.min(...dys);
      expect(b.maxCol - b.minCol).toBeGreaterThanOrEqual(leadW);
      expect(b.maxRow - b.minRow).toBeGreaterThanOrEqual(leadH);
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

describe("die editor — test stimuli (dieTestGraph) power an isolated die", () => {
  it("a power-fed die (no internal reference) is NOT sealable raw, but IS once a pin is marked GND", () => {
    // Model a logic-IC-like die: the internals (two resistors hung off three leads) have NO ground
    // reference of their own — the real chip takes GND/VCC from OUTSIDE its package — so solved in
    // isolation buildNetlist returns null. Marking pin1 as the GND reference + pin2 as VCC injects
    // the missing supply so it powers up and the Seal gate passes.
    const g = new BoardGraph();
    const die = freshDieGraph("SOT23_3")!;
    g.restore(die.snapshot);
    const frame = g.components.get(die.frameId)!;
    // pin2 (VCC) -> R1 -> pin3 -> R2 -> pin1 (GND): a divider with no on-die reference.
    const r1 = place(g, "R", 30, 8, 1000);
    const r2 = place(g, "R", 30, 12, 1000);
    connect(g, frame, 1, r1, 0); // pin2 -> R1.A
    connect(g, frame, 2, r1, 1); // pin3 -> R1.B
    connect(g, frame, 2, r2, 0); // pin3 -> R2.A
    connect(g, frame, 0, r2, 1); // pin1 -> R2.B
    const rawSnap = g.serialize();

    // Raw, in isolation: no reference -> not solvable -> not sealable.
    expect(dieIsSealable(rawSnap)).toBe(false);

    // Mark pin1 (index 0) as GND and pin2 (index 1) as a 5 V supply.
    frame.pinTests = [
      { role: "gnd", value: 0 },
      { role: "vcc", value: 5 },
      null,
    ];
    const stimSnap = g.serialize();

    // Injected, the die now has a reference (+ a supply) -> solvable -> sealable.
    expect(dieIsSealable(dieTestGraph(stimSnap, die.frameId))).toBe(true);
    // The injected graph added the virtual sources (the shared GND + the VCC source); the RAW graph
    // is untouched (still has only its authored parts), so the seal capture path stays pristine.
    const injected = dieTestGraph(stimSnap, die.frameId);
    expect(injected.components.length).toBeGreaterThan(
      stimSnap.components.length,
    );
    expect(stimSnap.components.length).toBe(rawSnap.components.length);
  });

  it("an `in` stimulus alone (a settable input drive + its return) makes a referenceless die solvable", () => {
    // A single resistor between two leads, no reference. An IN drive on one lead (its V− tied to the
    // shared virtual ground) supplies both the missing reference and a drive voltage.
    const g = new BoardGraph();
    const die = freshDieGraph("SOT23_3")!;
    g.restore(die.snapshot);
    const frame = g.components.get(die.frameId)!;
    const r = place(g, "R", 30, 8, 1000);
    connect(g, frame, 0, r, 0); // pin1 -> R.A
    connect(g, frame, 1, r, 1); // pin2 -> R.B
    expect(dieIsSealable(g.serialize())).toBe(false);
    frame.pinTests = [
      { role: "in", value: 3.3 },
      { role: "gnd", value: 0 },
      null,
    ];
    expect(dieIsSealable(dieTestGraph(g.serialize(), die.frameId))).toBe(true);
  });

  it("dieTestGraph is a STRICT no-op (returns the same reference) when there are no pinTests", () => {
    // No stimuli set -> the injected graph IS the input snapshot, unchanged (no extra components,
    // same object). This is what keeps an already-solvable / fully-wired die byte-identical.
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
    const snap = g.serialize();
    // No pinTests at all -> same reference back.
    expect(dieTestGraph(snap, die.frameId)).toBe(snap);
    // An all-null pinTests array is also a no-op.
    frame.pinTests = [null, null, null];
    const snap2 = g.serialize();
    expect(dieTestGraph(snap2, die.frameId)).toBe(snap2);
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

describe("packages — dieLayout (proportional enlargement)", () => {
  // Every starter package: the die layout is the production footprint scaled up PROPORTIONALLY by
  // DIE_SCALE — SAME pin numbers in the SAME index order, SAME relative positions + aspect ratio,
  // just roomy. That's what lets a sealed die map each lead straight through to the chip's matching
  // pin (seal-as-same-netlist) AND lets the zoom-to-open replica scale the circuit back onto the
  // package pins with no re-routing.
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

    it(`${archetype}-${pinCount}: a proportional enlargement of the production footprint`, () => {
      const prod = packageLayout(archetype, pinCount);
      const die = dieLayout(archetype, pinCount);
      // The die IS the production footprint scaled about cell 0 by DIE_SCALE: an n-cell span becomes
      // (n-1)*s+1 cells (the +1 keeps the inclusive cell dimension). Same aspect ratio, roomy interior.
      expect(die.w).toBe((prod.w - 1) * DIE_SCALE + 1);
      expect(die.h).toBe((prod.h - 1) * DIE_SCALE + 1);
      // At least as large as the production body (strictly larger on any multi-cell axis), so buildable.
      expect(die.w).toBeGreaterThanOrEqual(prod.w);
      expect(die.h).toBeGreaterThanOrEqual(prod.h);
      // Every lead is its production position scaled by DIE_SCALE — the SAME relative spot on the body,
      // which is exactly what makes the zoom-to-open replica line up by pure scaling (no re-routing).
      for (let i = 0; i < die.pins.length; i++) {
        expect(die.pins[i]!.dx).toBe(prod.pins[i]!.dx * DIE_SCALE);
        expect(die.pins[i]!.dy).toBe(prod.pins[i]!.dy * DIE_SCALE);
      }
      // Pins stay spread apart (no two share a cell) — proportional scaling preserves distinctness.
      const cells = new Set(die.pins.map((p) => p.dx + "," + p.dy));
      expect(cells.size).toBe(die.pins.length);
    });
  }

  it("die proportions match the real package aspect (SOT-23 landscape, DIP/VSSOP portrait)", () => {
    // The drill-in die is scaled to the real package's proportions (owner: "scaled in proportion to
    // the actual dimensions"): a SOT-23 is WIDER than tall (a few lead columns on the long edges, a
    // short lead span across); a DIP/VSSOP is TALLER than the gap between its two pin columns.
    for (const pinCount of [3, 5, 6]) {
      const d = dieLayout("SOT-23", pinCount);
      expect(d.w).toBeGreaterThan(d.h); // landscape
    }
    for (const [archetype, pinCount] of [
      ["VSSOP", 8],
      ["DIP", 8],
      ["DIP", 14],
      ["DIP", 16],
    ] as const) {
      const d = dieLayout(archetype, pinCount);
      expect(d.h).toBeGreaterThan(d.w); // portrait
    }
  });

  it("the generated die-frame kind uses the dieLayout pins (scaled up), distinct from the production frame", () => {
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

describe("packages — sot23 real pinouts", () => {
  // The placed SOT-23 footprint must match the JEDEC pinouts (owner feedback): -3 = two bottom
  // corners + one centred on top; -5 = bottom row + the two OUTER top slots (top-middle empty);
  // -6 = all six. Map pin NUMBER -> "dx,dy"; positions only — the index->number order is unchanged.
  const posByNumber = (pinCount: number): Map<number, string> => {
    const m = new Map<number, string>();
    for (const p of packageLayout("SOT-23", pinCount).pins) {
      m.set(p.number, `${p.dx},${p.dy}`);
    }
    return m;
  };

  it("SOT-23-3: bottom-left, bottom-right, top-centre", () => {
    const m = posByNumber(3);
    expect(m.get(1)).toBe("0,1"); // bottom-left
    expect(m.get(2)).toBe("2,1"); // bottom-right
    expect(m.get(3)).toBe("1,0"); // top-centre
  });

  it("SOT-23-5: full bottom row + OUTER top pins (top-middle empty)", () => {
    const m = posByNumber(5);
    expect(m.get(1)).toBe("0,1");
    expect(m.get(2)).toBe("1,1");
    expect(m.get(3)).toBe("2,1");
    expect(m.get(4)).toBe("2,0"); // top-right
    expect(m.get(5)).toBe("0,0"); // top-left
    // The defining gap: no lead sits at the top-middle slot (1,0).
    const cells = new Set(
      packageLayout("SOT-23", 5).pins.map((p) => `${p.dx},${p.dy}`),
    );
    expect(cells.has("1,0")).toBe(false);
  });

  it("SOT-23-6: all six slots filled (bottom 1-3, top 4-6 right->left)", () => {
    const m = posByNumber(6);
    expect(m.get(1)).toBe("0,1");
    expect(m.get(2)).toBe("1,1");
    expect(m.get(3)).toBe("2,1");
    expect(m.get(4)).toBe("2,0");
    expect(m.get(5)).toBe("1,0");
    expect(m.get(6)).toBe("0,0");
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

describe("die editor — persisting in-progress (unsealed) dies", () => {
  it("round-trips an innerDies payload: a WIP die survives JSON + restore", () => {
    // Build a fresh die for a frame and add a part inside it (the half-built work-in-progress).
    const inner = new BoardGraph();
    const die = freshDieGraph("SOT23_5")!;
    inner.restore(die.snapshot);
    const frame = inner.components.get(die.frameId)!;
    const r = place(inner, "R", 30, 8, 4700);
    connect(inner, frame, 0, r, 0); // pin1 -> R.A (some real WIP wiring)
    const wip = inner.serialize();

    // Stash it in an innerGraphs map keyed by an OUTER frame id (the key the save uses), then marshal
    // -> JSON -> parse -> restore, exactly as a board Save + reload does.
    const OUTER_ID = 7;
    const innerGraphs = new Map<number, GraphSnapshot>([[OUTER_ID, wip]]);

    // The outer board must actually PLACE that frame, or innerDiesForSave drops it as stale.
    const outer = new BoardGraph();
    const placeholder = outer.place("SOT23_5", { col: 4, row: 0 })!;
    // Force the placeholder id to match the map key (place() assigns 1 on a fresh board).
    const outerSnap = outer.serialize();
    const outerWithKey: GraphSnapshot = {
      ...outerSnap,
      components: outerSnap.components.map((c) =>
        c.id === placeholder.id ? { ...c, id: OUTER_ID } : c,
      ),
    };

    const innerDies = innerDiesForSave(innerGraphs, outerWithKey);
    expect(innerDies.length).toBe(1);
    expect(innerDies[0]!.frameId).toBe(OUTER_ID);

    // Serialize the whole save payload + read it back.
    const roundTripped = JSON.parse(JSON.stringify({ innerDies })) as {
      innerDies: InnerDie[];
    };
    const restored = new Map<number, GraphSnapshot>();
    restoreInnerDies(roundTripped.innerDies, restored);

    // The restored map yields the same inner graph: the WIP (frame + the 4.7k R + its wire) survived.
    expect(restored.has(OUTER_ID)).toBe(true);
    const back = restored.get(OUTER_ID)!;
    expect(back.components.length).toBe(wip.components.length);
    expect(back.wires.length).toBe(wip.wires.length);
    const backFrameId = findDieFrameId(back);
    expect(backFrameId).toBe(die.frameId); // ids preserved, so re-drilling keys line up
    const backR = back.components.find((c) => c.kind === "R");
    expect(backR?.value).toBe(4700);
  });

  it("innerDiesForSave keeps only dies whose frame is still PLACED on the board", () => {
    const die = freshDieGraph("SOT23_3")!;
    const innerGraphs = new Map<number, GraphSnapshot>([
      [10, die.snapshot], // a frame still on the board
      [11, die.snapshot], // a frame the player deleted (stale entry)
    ]);
    // Outer board places only frame id 10 (a real frame kind).
    const outer = new BoardGraph();
    const f = outer.place("SOT23_3", { col: 0, row: 0 })!;
    const snap = outer.serialize();
    const placed: GraphSnapshot = {
      ...snap,
      components: snap.components.map((c) =>
        c.id === f.id ? { ...c, id: 10 } : c,
      ),
    };
    const dies = innerDiesForSave(innerGraphs, placed);
    expect(dies.map((d) => d.frameId)).toEqual([10]); // the stale id 11 is dropped
  });

  it("restoreInnerDies clears the map first (an absent/empty payload empties it)", () => {
    const die = freshDieGraph("DIP8")!;
    const m = new Map<number, GraphSnapshot>([[1, die.snapshot]]);
    restoreInnerDies(undefined, m);
    expect(m.size).toBe(0); // a save with no innerDies loads to an empty map
    restoreInnerDies([{ frameId: 5, graph: die.snapshot }], m);
    expect([...m.keys()]).toEqual([5]);
  });

  it("placeableFrameTag is the inverse of the die-frame prefix", () => {
    expect(placeableFrameTag(dieFrameTag("SOT23_5"))).toBe("SOT23_5");
    expect(placeableFrameTag(dieFrameTag("DIP14"))).toBe("DIP14");
    // A non-die tag (a placeable frame or a normal part) has no die prefix to strip.
    expect(placeableFrameTag("SOT23_5")).toBeUndefined();
    expect(placeableFrameTag("R")).toBeUndefined();
  });
});

describe("die editor — recognising a raw saved DIE graph", () => {
  it("a bare die snapshot (just the die frame) is a standalone die graph", () => {
    const die = freshDieGraph("SOT23_5")!;
    expect(isStandaloneDieGraph(die.snapshot)).toBe(true);
  });

  it("a built-but-unsealed die snapshot is still a standalone die graph", () => {
    const inner = new BoardGraph();
    const die = freshDieGraph("DIP8")!;
    inner.restore(die.snapshot);
    const frame = inner.components.get(die.frameId)!;
    const r = place(inner, "R", 30, 8, 1000);
    connect(inner, frame, 0, r, 0);
    expect(isStandaloneDieGraph(inner.serialize())).toBe(true);
  });

  it("a normal board (no die-frame) is NOT a standalone die graph", () => {
    const g = new BoardGraph();
    place(g, "V", 0, 0, 5);
    place(g, "R", 4, 0, 1000);
    place(g, "GND", 0, 6);
    expect(isStandaloneDieGraph(g.serialize())).toBe(false);
  });

  it("a board that merely places an empty PLACEABLE frame is NOT a standalone die graph", () => {
    // A placeable frame (SOT23_5) is a frame but NOT the internal __DIE_ variant, so a board carrying
    // one must still load flat — only an isolated __DIE_* snapshot opens in the builder.
    const g = new BoardGraph();
    place(g, "SOT23_5", 2, 2);
    place(g, "V", 0, 0, 5);
    expect(isStandaloneDieGraph(g.serialize())).toBe(false);
  });
});

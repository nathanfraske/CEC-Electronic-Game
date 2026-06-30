// SPDX-License-Identifier: Apache-2.0
// Regression: the bus-cable UNZIP must never draw one strand crossing another, at ANY bus width — odd or
// even, 2-bit through a ridiculous 64-bit — and across straight / bent / too-close layouts. This guards the
// "bowtie" bug (the perpendicular offset of a backtrack-spur trunk crossed the lanes at a bend) and proves
// the width-agnostic claim the owner asked about (5-bit, 10-bit, 64-bit). Pure geometry, no browser.
import { describe, it, expect } from "vitest";
import { Point } from "pixi.js";
import {
  buildCableTrunk,
  cableStrandRoutes,
  cableCornerRoutes,
  strandCrossings,
} from "./cableGeometry";

const PITCH = 26;
// Every width that matters: odd + even, tiny + huge. 64 is the "ridiculous" one.
const WIDTHS = [2, 3, 4, 5, 7, 8, 10, 12, 16, 24, 32, 48, 64];

/** A vertical pin column (the bus port) of `n` pins centred on `centerY`. */
function pinColumn(x: number, centerY: number, n: number): Point[] {
  const mid = (n - 1) / 2;
  return Array.from(
    { length: n },
    (_, j) => new Point(x, centerY + (j - mid) * PITCH),
  );
}

/** Replicates board.ts `gatherAxis` for a vertical pin column (axis "h"): the gather sits on the column's
 *  centre line, pushed toward the partner by the cluster's own spread + a cell — so wider buses push the
 *  gather proportionally further out (the same room the belt-fan gets in the live layout). */
function gatherH(pins: Point[], towardX: number): Point {
  const cx = pins.reduce((s, p) => s + p.x, 0) / pins.length;
  const cy = pins.reduce((s, p) => s + p.y, 0) / pins.length;
  const spread = Math.max(
    PITCH,
    ...pins.map((p) => Math.hypot(p.x - cx, p.y - cy)),
  );
  const d = spread + PITCH;
  return new Point(cx + Math.sign(towardX - cx || 1) * d, cy);
}

/** A horizontal pin ROW (the bus port of a VERTICAL-approach bus) of `n` pins centred on `centerX`. */
function pinRow(centerX: number, y: number, n: number): Point[] {
  const mid = (n - 1) / 2;
  return Array.from(
    { length: n },
    (_, j) => new Point(centerX + (j - mid) * PITCH, y),
  );
}

/** board.ts `gatherAxis` for a horizontal pin row (axis "v"): the gather sits on the row's centre line,
 *  pushed toward the partner (in Y) by the cluster's own spread + a cell — the vertical analogue of gatherH. */
function gatherV(pins: Point[], towardY: number): Point {
  const cx = pins.reduce((s, p) => s + p.x, 0) / pins.length;
  const cy = pins.reduce((s, p) => s + p.y, 0) / pins.length;
  const spread = Math.max(
    PITCH,
    ...pins.map((p) => Math.hypot(p.x - cx, p.y - cy)),
  );
  const d = spread + PITCH;
  return new Point(cx, cy + Math.sign(towardY - cy || 1) * d);
}

/** Count inter-strand crossings — the same proper-intersection counter the board uses to auto-orient a
 *  corner cable (shared endpoints / collinear touches don't count). */
const crossings = strandCrossings;

/** Every interior trunk vertex must be a genuine 90° turn — dir_in ⟂ dir_out. A collinear vertex (dot ±1)
 *  is redundant; a 180° reversal (dot −1) is a backtrack spur (the bowtie). Both must be gone. */
function trunkIsClean(trunk: Point[]): boolean {
  for (let i = 1; i < trunk.length - 1; i++) {
    const ax = Math.sign(trunk[i]!.x - trunk[i - 1]!.x);
    const ay = Math.sign(trunk[i]!.y - trunk[i - 1]!.y);
    const bx = Math.sign(trunk[i + 1]!.x - trunk[i]!.x);
    const by = Math.sign(trunk[i + 1]!.y - trunk[i]!.y);
    if (ax * bx + ay * by !== 0) return false;
  }
  return true;
}

const SEP = 1100; // columns far enough apart that even a 64-wide bus has room to belt-fan (not run-through)

describe("cable strand geometry is crossing-free at any width", () => {
  it.each(WIDTHS)("straight aligned bus — width %i", (n) => {
    const srcW = pinColumn(-SEP, 0, n);
    const dstW = pinColumn(SEP, 0, n);
    const trunk = buildCableTrunk(
      gatherH(srcW, SEP),
      gatherH(dstW, -SEP),
      [],
      "h",
      "h",
    );
    expect(trunkIsClean(trunk)).toBe(true);
    expect(crossings(cableStrandRoutes(srcW, dstW, trunk, PITCH))).toBe(0);
  });

  // The exact shape that produced the bowtie: the gathers sit at the pin centroids, but the user's route
  // waypoints sit on the anchor rows the OTHER side of the source gather — an elbow would hook out-and-back.
  it.each(WIDTHS)("Z-bent bus (the spur/bowtie scenario) — width %i", (n) => {
    const srcW = pinColumn(-SEP, -PITCH / 2, n);
    const dstW = pinColumn(SEP, PITCH * 3.5, n);
    const route = [new Point(0, -PITCH * 3), new Point(0, PITCH * 3)];
    const trunk = buildCableTrunk(
      gatherH(srcW, SEP),
      gatherH(dstW, -SEP),
      route,
      "h",
      "h",
    );
    expect(trunkIsClean(trunk)).toBe(true); // the backtrack spur is collapsed away
    expect(crossings(cableStrandRoutes(srcW, dstW, trunk, PITCH))).toBe(0);
  });

  it.each(WIDTHS)("too-close pair → straight run-through — width %i", (n) => {
    const srcW = pinColumn(-60, 0, n);
    const dstW = pinColumn(60, 0, n);
    const trunk = buildCableTrunk(
      new Point(-8, 0),
      new Point(8, 0),
      [],
      "h",
      "h",
    );
    expect(crossings(cableStrandRoutes(srcW, dstW, trunk, PITCH))).toBe(0);
  });
});

// VERTICAL-approach bus (pins stacked horizontally, strands run up↕down) — the transpose of the horizontal
// case (`cableStrandRoutes(..., "v")` reflects across y=x, solves the one belt-fan, reflects back). These
// mirror the horizontal cases exactly; a reflection preserves orthogonality + distances, so crossing-free
// must carry over unchanged. (The board only unzips when BOTH ends share an approach axis.)
describe("cable strand geometry is crossing-free for a vertical-approach bus", () => {
  it.each(WIDTHS)("straight aligned vertical bus — width %i", (n) => {
    const srcW = pinRow(0, -SEP, n);
    const dstW = pinRow(0, SEP, n);
    const trunk = buildCableTrunk(
      gatherV(srcW, SEP),
      gatherV(dstW, -SEP),
      [],
      "v",
      "v",
    );
    expect(trunkIsClean(trunk)).toBe(true);
    expect(crossings(cableStrandRoutes(srcW, dstW, trunk, PITCH, "v"))).toBe(0);
  });

  it.each(WIDTHS)(
    "Z-bent vertical bus (spur/bowtie scenario) — width %i",
    (n) => {
      const srcW = pinRow(-PITCH / 2, -SEP, n);
      const dstW = pinRow(PITCH * 3.5, SEP, n);
      const route = [new Point(-PITCH * 3, 0), new Point(PITCH * 3, 0)];
      const trunk = buildCableTrunk(
        gatherV(srcW, SEP),
        gatherV(dstW, -SEP),
        route,
        "v",
        "v",
      );
      expect(trunkIsClean(trunk)).toBe(true);
      expect(crossings(cableStrandRoutes(srcW, dstW, trunk, PITCH, "v"))).toBe(
        0,
      );
    },
  );

  it.each(WIDTHS)(
    "too-close vertical pair → straight run-through — width %i",
    (n) => {
      const srcW = pinRow(0, -60, n);
      const dstW = pinRow(0, 60, n);
      const trunk = buildCableTrunk(
        new Point(0, -8),
        new Point(0, 8),
        [],
        "v",
        "v",
      );
      expect(crossings(cableStrandRoutes(srcW, dstW, trunk, PITCH, "v"))).toBe(
        0,
      );
    },
  );
});

// PACKED RIBBON (the collapsed/zoomed-out look): the same belt-fan but `lanePack < 1` tightens the lanes (and,
// since the chevron stagger derives from the lane gap, the whole convergence) into a dense ribbon. A uniform
// scale of the perpendicular offsets keeps the lanes monotonic in rank, so it must stay crossing-free — guard
// it at the live RIBBON_PACK (0.4) across widths, straight + bent, both axes.
const RIBBON_PACK = 0.4;
describe("packed-ribbon belt-fan is crossing-free", () => {
  it.each(WIDTHS)("packed straight bus (h) — width %i", (n) => {
    const srcW = pinColumn(-SEP, 0, n);
    const dstW = pinColumn(SEP, 0, n);
    const trunk = buildCableTrunk(
      gatherH(srcW, SEP),
      gatherH(dstW, -SEP),
      [],
      "h",
      "h",
    );
    expect(
      crossings(cableStrandRoutes(srcW, dstW, trunk, PITCH, "h", RIBBON_PACK)),
    ).toBe(0);
  });

  it.each(WIDTHS)("packed Z-bent bus (h) — width %i", (n) => {
    const srcW = pinColumn(-SEP, -PITCH / 2, n);
    const dstW = pinColumn(SEP, PITCH * 3.5, n);
    const route = [new Point(0, -PITCH * 3), new Point(0, PITCH * 3)];
    const trunk = buildCableTrunk(
      gatherH(srcW, SEP),
      gatherH(dstW, -SEP),
      route,
      "h",
      "h",
    );
    expect(
      crossings(cableStrandRoutes(srcW, dstW, trunk, PITCH, "h", RIBBON_PACK)),
    ).toBe(0);
  });

  it.each(WIDTHS)("packed straight vertical bus (v) — width %i", (n) => {
    const srcW = pinRow(0, -SEP, n);
    const dstW = pinRow(0, SEP, n);
    const trunk = buildCableTrunk(
      gatherV(srcW, SEP),
      gatherV(dstW, -SEP),
      [],
      "v",
      "v",
    );
    expect(
      crossings(cableStrandRoutes(srcW, dstW, trunk, PITCH, "v", RIBBON_PACK)),
    ).toBe(0);
  });
});

// MIXED-AXIS CORNER (the bus "comes up short" + turns a sharp 90°): one end horizontal, the other vertical.
// Each bit is a single staggered L. When the pin pairing matches the corner — top source ↔ far-side dest
// (the owner's hand-wired reference) — the Ls nest without crossing at any width. A pairing that does NOT
// match the corner genuinely crosses (the function does not reorder), which the negative case asserts.
describe("mixed-axis corner cable is crossing-free when paired to the corner", () => {
  it.each(WIDTHS)("┐ corner (h→v), matched pairing — width %i", (n) => {
    const mid = (n - 1) / 2;
    const below = (mid + 3) * PITCH; // dst row sits below EVERY source pin → every strand turns DOWN
    const srcW = pinColumn(-SEP, 0, n); // vertical source column, top→bottom
    const dstW = [...pinRow(SEP, below, n)].reverse(); // dst row right→left ⇒ src top ↔ rightmost dst
    expect(crossings(cableCornerRoutes(srcW, dstW, "h"))).toBe(0);
  });

  it("a corner pairing that fights the geometry DOES cross (no silent reorder)", () => {
    const srcW = pinColumn(-SEP, 0, 4);
    const dstW = pinRow(SEP, 3 * PITCH, 4); // left→right ⇒ src top ↔ leftmost dst (wrong for a ┐) ⇒ crossings
    expect(crossings(cableCornerRoutes(srcW, dstW, "h"))).toBeGreaterThan(0);
  });

  // The board's auto-orient logic (board.ts `autoOrientCablePairing`): route the dst pins both ways and keep
  // the order with fewer crossings. Here the natural (name-aligned, left→right) order crosses and the reverse
  // is clean, so the picker must choose the reverse.
  it.each(WIDTHS)(
    "auto-orient picks the crossing-free dst order — width %i",
    (n) => {
      const srcW = pinColumn(-SEP, 0, n);
      const natural = pinRow(SEP, ((n - 1) / 2 + 3) * PITCH, n); // left→right (crosses for a ┐)
      const reversed = [...natural].reverse();
      const cNat = crossings(cableCornerRoutes(srcW, natural, "h"));
      const cRev = crossings(cableCornerRoutes(srcW, reversed, "h"));
      expect(cRev).toBeLessThan(cNat); // the picker prefers `reversed`
      expect(cRev).toBe(0); // …and it is crossing-free
    },
  );
});

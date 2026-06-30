// SPDX-License-Identifier: Apache-2.0
// Regression: the bus-cable UNZIP must never draw one strand crossing another, at ANY bus width — odd or
// even, 2-bit through a ridiculous 64-bit — and across straight / bent / too-close layouts. This guards the
// "bowtie" bug (the perpendicular offset of a backtrack-spur trunk crossed the lanes at a bend) and proves
// the width-agnostic claim the owner asked about (5-bit, 10-bit, 64-bit). Pure geometry, no browser.
import { describe, it, expect } from "vitest";
import { Point } from "pixi.js";
import { buildCableTrunk, cableStrandRoutes } from "./cableGeometry";

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

/** Strict proper-intersection (collinear / shared-endpoint touches don't count). Two DIFFERENT strands
 *  share no endpoint, so any true intersection here is a visible cable-over-cable cross. */
function segsCross(p: Point, q: Point, r: Point, s: Point): boolean {
  const o = (a: Point, b: Point, c: Point): number =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const d1 = o(p, q, r);
  const d2 = o(p, q, s);
  const d3 = o(r, s, p);
  const d4 = o(r, s, q);
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

/** Count inter-strand crossings across all strand routes. */
function crossings(routes: Point[][]): number {
  const segs: { ri: number; a: Point; b: Point }[] = [];
  routes.forEach((r, ri) => {
    for (let k = 1; k < r.length; k++)
      segs.push({ ri, a: r[k - 1]!, b: r[k]! });
  });
  let hits = 0;
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i]!.ri === segs[j]!.ri) continue; // a strand's own corners are fine
      if (segsCross(segs[i]!.a, segs[i]!.b, segs[j]!.a, segs[j]!.b)) hits++;
    }
  return hits;
}

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

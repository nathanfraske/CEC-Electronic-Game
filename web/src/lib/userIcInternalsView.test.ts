// SPDX-License-Identifier: Apache-2.0
// Headless test for the opened-IC lead-connector edge assignment (pinLeadRoot): a free-form box with pins
// on ALL FOUR edges (IN/OUT on the sides, VCC/GND top & bottom) must route each lead to its OWN edge —
// the bug was the package-wide `alongX` dropping the mid-height IN/OUT leads onto the bottom edge.
import { describe, it, expect } from "vitest";
import { userIcBodyBox, pinLeadRoot } from "./glyphs";
import { PITCH } from "./boardRender";

describe("pinLeadRoot — per-pin lead edge for a 4-edge free-form box", () => {
  // The owner's inverter: w=5,h=9; OUT(4,4) right-mid, VCC(3,0) top, IN(0,4) left-mid, GND(3,8) bottom.
  const geom = [
    { dx: 4, dy: 4, name: "OUT" },
    { dx: 3, dy: 0, name: "VCC" },
    { dx: 0, dy: 4, name: "IN" },
    { dx: 3, dy: 8, name: "GND" },
  ];
  const pins = geom.map((p) => ({ x: p.dx * PITCH, y: p.dy * PITCH }));
  const body = userIcBodyBox(pins, (5 - 1) * PITCH, (9 - 1) * PITCH);

  it("routes each frame pin to the edge it actually sits on", () => {
    const [out, vcc, inp, gnd] = pins.map((pp) => pinLeadRoot(pp, body));
    // IN / OUT are on the LEFT / RIGHT edges (horizontal staple), at their own height — NOT the bottom.
    expect(inp.vertical).toBe(false);
    expect(inp.x).toBeCloseTo(body.x); // left edge
    expect(inp.y).toBeCloseTo(pins[2]!.y); // stays at mid-height
    expect(out.vertical).toBe(false);
    expect(out.x).toBeCloseTo(body.x + body.w); // right edge
    expect(out.y).toBeCloseTo(pins[0]!.y);
    // VCC / GND are on the TOP / BOTTOM edges (vertical staple).
    expect(vcc.vertical).toBe(true);
    expect(vcc.y).toBeCloseTo(body.y); // top edge
    expect(gnd.vertical).toBe(true);
    expect(gnd.y).toBeCloseTo(body.y + body.h); // bottom edge
  });

  it("the old package-wide alongX WOULD have dropped IN/OUT to the bottom (regression guard)", () => {
    // alongX = (#distinct X >= #distinct Y); here 3 == 3 → true → every pin treated as a top/bottom lead.
    expect(body.alongX).toBe(true);
    const bcy = body.y + body.h / 2;
    // Under the old rule a mid-height side pin (pp.y === bcy) resolved to the BOTTOM edge — the bug.
    for (const i of [0, 2]) {
      const pp = pins[i]!;
      const oldRootY = pp.y < bcy ? body.y : body.y + body.h;
      expect(oldRootY).toBeCloseTo(body.y + body.h); // would have gone to the bottom
      // The fix sends them to a side edge instead.
      expect(pinLeadRoot(pp, body).vertical).toBe(false);
    }
  });
});

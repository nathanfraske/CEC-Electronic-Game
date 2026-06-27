// SPDX-License-Identifier: Apache-2.0
// Headless tests for the bridge over/under draw order (pure id-ordering, no PixiJS render needed).
import { describe, it, expect } from "vitest";
import { Point } from "pixi.js";
import {
  wireDrawOrder,
  snapToBoxEdge,
  firstFreePerimeterCell,
  solveWireFlow,
  cleanRouteWaypoints,
  planSegmentDrag,
  emptyLazyRoute,
  extendLazyTrail,
  lazyWaypoints,
  applyCrossings,
} from "./boardRender";
import type { Wire, Endpoint, Cell } from "./graph";

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

describe("solveWireFlow — per-wire branch current by spanning-forest KCL", () => {
  // The pure flow solver shared by the board and the zoom-to-open replica (so an opened sub-assembly's
  // wires animate by the SAME KCL the board runs). Endpoints span pins (compId:pinIndex) and junctions.
  const pin = (componentId: number, pinIndex: number): Endpoint => ({
    componentId,
    pinIndex,
  });
  const jct = (junctionId: number): Endpoint => ({ junctionId });
  const wire = (id: number, from: Endpoint, to: Endpoint): Wire => ({
    id,
    from,
    to,
  });

  it("no electrical → every wire reads zero (the unpowered look)", () => {
    const flow = solveWireFlow([wire(1, pin(1, 0), pin(2, 0))], []);
    expect(Math.abs(flow.get(1)!.current)).toBe(0); // ±0 both fine (idle wire)
  });

  it("series source↔load: each wire carries the element current", () => {
    // source(1) and resistor(2) share two nets (a loop); each wire carries |I|.
    const I = 0.005;
    const flow = solveWireFlow(
      [wire(1, pin(1, 0), pin(2, 0)), wire(2, pin(1, 1), pin(2, 1))],
      [
        [1, { current: I }],
        [2, { current: I }],
      ],
    );
    expect(Math.abs(flow.get(1)!.current)).toBeCloseTo(I, 9);
    expect(Math.abs(flow.get(2)!.current)).toBeCloseTo(I, 9);
  });

  it("KCL split at a junction: the trunk carries the sum of the branches", () => {
    // source(1) → J1 → two loads R2 (20 mA) + R3 (10 mA): trunk = 30 mA = branchB + branchC.
    const flow = solveWireFlow(
      [
        wire(10, pin(1, 1), jct(1)), // trunk
        wire(20, jct(1), pin(2, 0)), // branch to R2
        wire(30, jct(1), pin(3, 0)), // branch to R3
      ],
      [
        [1, { current: 0.03 }],
        [2, { current: 0.02 }],
        [3, { current: 0.01 }],
      ],
    );
    expect(Math.abs(flow.get(10)!.current)).toBeCloseTo(0.03, 9);
    expect(Math.abs(flow.get(20)!.current)).toBeCloseTo(0.02, 9);
    expect(Math.abs(flow.get(30)!.current)).toBeCloseTo(0.01, 9);
    expect(Math.abs(flow.get(10)!.current)).toBeCloseTo(
      Math.abs(flow.get(20)!.current) + Math.abs(flow.get(30)!.current),
      9,
    );
  });

  it("an AC element tints its wire's freq + acFrac; a pure DC element does not", () => {
    const flow = solveWireFlow(
      [wire(1, pin(1, 0), pin(2, 0)), wire(2, pin(1, 1), pin(2, 1))],
      [
        [
          1,
          {
            current: 0.01,
            ac: { valid: true, iamp: 0.01, freq: 1000, imean: 0 },
          },
        ],
        [
          2,
          {
            current: 0.01,
            ac: { valid: true, iamp: 0.01, freq: 1000, imean: 0 },
          },
        ],
      ],
    );
    expect(flow.get(1)!.freq).toBeCloseTo(1000, 6);
    expect(flow.get(1)!.acFrac).toBeGreaterThan(0.9);

    const dc = solveWireFlow(
      [wire(1, pin(1, 0), pin(2, 0)), wire(2, pin(1, 1), pin(2, 1))],
      [
        [1, { current: 0.01 }],
        [2, { current: 0.01 }],
      ],
    );
    expect(dc.get(1)!.freq).toBe(0);
    expect(dc.get(1)!.acFrac).toBe(0);
  });
});

describe("cleanRouteWaypoints — minimise an orthogonal route after a segment drag (3C)", () => {
  const c = (col: number, row: number): Cell => ({ col, row });

  it("empty waypoints stay empty", () => {
    expect(cleanRouteWaypoints(c(0, 0), [], c(5, 0))).toEqual([]);
  });

  it("drops a bend colinear with its neighbours", () => {
    // a — wp — b all on row 0: the middle bend is redundant.
    expect(cleanRouteWaypoints(c(0, 0), [c(3, 0)], c(6, 0))).toEqual([]);
    // A real corner (off the a→b line) is kept.
    expect(cleanRouteWaypoints(c(0, 0), [c(3, 2)], c(6, 0))).toEqual([c(3, 2)]);
  });

  it("drops a point coincident with its predecessor (zero-length step)", () => {
    // The first wp equals the from-endpoint, the second is a real corner.
    expect(cleanRouteWaypoints(c(0, 0), [c(0, 0), c(0, 4)], c(5, 4))).toEqual([
      c(0, 4),
    ]);
  });

  it("collapses a U-turn spike — out to a tip and immediately back", () => {
    // From a, out to the tip (3,3), then back to (0,0)=a, then on to a real corner. The tip is a
    // doubled-back spur (prev===next around it) and the return point coincides with a — both drop.
    expect(
      cleanRouteWaypoints(c(0, 0), [c(3, 3), c(0, 0), c(0, 6)], c(5, 6)),
    ).toEqual([c(0, 6)]);
  });

  it("keeps a genuine staple (two real corners offset from the endpoints)", () => {
    // a(0,0) → (0,3) → (5,3) → b(5,0): a clean orthogonal staple, both corners real.
    expect(cleanRouteWaypoints(c(0, 0), [c(0, 3), c(5, 3)], c(5, 0))).toEqual([
      c(0, 3),
      c(5, 3),
    ]);
  });

  it("returns copies, not aliases of the input cells", () => {
    const wps = [c(3, 2)];
    const out = cleanRouteWaypoints(c(0, 0), wps, c(6, 0));
    expect(out).toEqual([c(3, 2)]);
    expect(out[0]).not.toBe(wps[0]);
  });
});

describe("planSegmentDrag — grab a wire segment; junction ends move, pin ends fold (3A)", () => {
  const P = 26; // PITCH
  const c = (col: number, row: number): Cell => ({ col, row });
  const w = (col: number, row: number) => ({ x: col * P, y: row * P });

  it("returns null for a wire with no drawable route", () => {
    expect(planSegmentDrag([], c(0, 0), c(1, 0), false, false, 0, 0)).toBe(
      null,
    );
  });

  it("a JUNCTION end is flagged to MOVE (no fold) — a vertical tap whose top sits on a bus", () => {
    // Wire pin(5,10) → junction(5,5); grab the single vertical segment. The pin end folds (spliced
    // bracket), the junction end is flagged "hi" so the caller slides the junction — no stub on the bus.
    const route = [w(5, 10), w(5, 5)];
    const plan = planSegmentDrag(
      route,
      c(5, 10), // from = pin
      c(5, 5), // to = junction
      false,
      true,
      5 * P,
      7 * P,
    )!;
    expect(plan.axis).toBe("v");
    expect(plan.moveEnds).toEqual(["hi"]);
    // Pin end spliced inward → [pin, pin', junction], grabbed segment = pts[1]→pts[2].
    expect(plan.pts).toEqual([c(5, 10), c(5, 10), c(5, 5)]);
    expect(plan.bi).toBe(1);
  });

  it("BOTH ends junctions → both move, no brackets spliced", () => {
    const route = [w(2, 2), w(8, 2)];
    const plan = planSegmentDrag(
      route,
      c(2, 2),
      c(8, 2),
      true,
      true,
      5 * P,
      2 * P,
    )!;
    expect(plan.axis).toBe("h");
    expect(new Set(plan.moveEnds)).toEqual(new Set(["lo", "hi"]));
    expect(plan.pts).toEqual([c(2, 2), c(8, 2)]); // untouched — both ends slide their junctions
    expect(plan.bi).toBe(0);
  });

  it("BOTH ends fixed pins → a clean staple (both brackets spliced, no junction move)", () => {
    const route = [w(0, 0), w(5, 0)];
    const plan = planSegmentDrag(
      route,
      c(0, 0),
      c(5, 0),
      false,
      false,
      2 * P,
      0,
    )!;
    expect(plan.moveEnds).toEqual([]);
    // [from, from', to', to] — grabbed segment pts[1]→pts[2] drags between the two spliced brackets.
    expect(plan.pts).toEqual([c(0, 0), c(0, 0), c(5, 0), c(5, 0)]);
    expect(plan.bi).toBe(1);
  });

  it("a MIDDLE segment touches no endpoint → nothing spliced, nothing moved", () => {
    // pin(0,0) → (0,3) → (5,3) → pin(5,0); grab the middle horizontal leg.
    const route = [w(0, 0), w(0, 3), w(5, 3), w(5, 0)];
    const plan = planSegmentDrag(
      route,
      c(0, 0),
      c(5, 0),
      false,
      false,
      2 * P,
      3 * P,
    )!;
    expect(plan.moveEnds).toEqual([]);
    expect(plan.bi).toBe(1);
    expect(plan.pts).toEqual([c(0, 0), c(0, 3), c(5, 3), c(5, 0)]);
  });
});

describe("lazy-follow router — sketch a route with the mouse, bake bends as waypoints (no junctions)", () => {
  const c = (col: number, row: number): Cell => ({ col, row });
  const start = c(0, 0);

  it("the first move locks the heading to the dominant axis", () => {
    expect(extendLazyTrail(start, emptyLazyRoute(), c(5, 1)).heading).toBe("h");
    expect(extendLazyTrail(start, emptyLazyRoute(), c(1, 5)).heading).toBe("v");
  });

  it("no movement leaves the route untouched", () => {
    const r = extendLazyTrail(start, emptyLazyRoute(), c(0, 0));
    expect(r.trail).toEqual([]);
    expect(r.heading).toBe(null);
  });

  it("a straight pull adds NO waypoints (plain wire, no junctions)", () => {
    let r = extendLazyTrail(start, emptyLazyRoute(), c(3, 0));
    r = extendLazyTrail(start, r, c(6, 0));
    expect(r.trail).toEqual([]);
    // Ends on the heading row ⇒ no elbow either.
    expect(lazyWaypoints(start, r, c(6, 0))).toEqual([]);
  });

  it("turning past the threshold commits ONE corner (a clean L)", () => {
    // Pull right along row 0, then stray 3 rows down (≥ turn=2) ⇒ corner where it leaves the row.
    let r = extendLazyTrail(start, emptyLazyRoute(), c(5, 0));
    r = extendLazyTrail(start, r, c(5, 3));
    expect(r.heading).toBe("v");
    expect(r.trail).toEqual([c(5, 0)]);
    expect(lazyWaypoints(start, r, c(5, 3))).toEqual([c(5, 0)]); // (0,0)→(5,0)→(5,3)
  });

  it("a one-cell jitter off the run does NOT turn (hysteresis)", () => {
    let r = extendLazyTrail(start, emptyLazyRoute(), c(5, 0));
    r = extendLazyTrail(start, r, c(6, 1)); // only 1 row off → below the turn threshold
    expect(r.heading).toBe("h");
    expect(r.trail).toEqual([]);
  });

  it("right→up→right sketches a two-corner staircase", () => {
    let r = extendLazyTrail(start, emptyLazyRoute(), c(5, 0)); // run right
    r = extendLazyTrail(start, r, c(5, 3)); // turn up → corner (5,0)
    r = extendLazyTrail(start, r, c(8, 3)); // turn right → corner (5,3)
    expect(r.trail).toEqual([c(5, 0), c(5, 3)]);
    expect(lazyWaypoints(start, r, c(8, 3))).toEqual([c(5, 0), c(5, 3)]);
  });

  it("lazyWaypoints adds the open segment's elbow before a corner is committed", () => {
    // Heading locked horizontal, cursor off the row but not yet past the turn threshold: the PREVIEW
    // still routes as an L (elbow at the cursor column on the anchor row).
    const r = { trail: [], heading: "h" as const };
    expect(lazyWaypoints(start, r, c(5, 3))).toEqual([c(5, 0)]);
  });

  it("does not mutate the input route", () => {
    const prev = { trail: [c(5, 0)], heading: "v" as const };
    const r = extendLazyTrail(start, prev, c(8, 3));
    expect(prev.trail).toEqual([c(5, 0)]); // unchanged
    expect(r.trail).not.toBe(prev.trail);
  });

  it("going back over a locked-in segment RETRACTS the trail (no double-back)", () => {
    // Draw an L: run right, turn up → one corner at (5,0).
    let r = extendLazyTrail(start, emptyLazyRoute(), c(5, 0));
    r = extendLazyTrail(start, r, c(5, 3));
    expect(r.trail).toEqual([c(5, 0)]);
    expect(r.heading).toBe("v");
    // Come back DOWN onto the corner's row, then travel back along the locked-in run → pop the corner.
    r = extendLazyTrail(start, r, c(5, 0)); // collapse the open run onto the corner (no pop yet)
    expect(r.trail).toEqual([c(5, 0)]);
    r = extendLazyTrail(start, r, c(2, 0)); // back along row 0 → corner pops, horizontal run reopens
    expect(r.trail).toEqual([]);
    expect(r.heading).toBe("h");
    // The route is one clean segment back to (2,0) — not a doubled stub over (5,0)→…→(2,0).
    expect(lazyWaypoints(start, r, c(2, 0))).toEqual([]);
  });

  it("extending the open run (not retracing) never pops a corner", () => {
    let r = extendLazyTrail(start, emptyLazyRoute(), c(5, 0));
    r = extendLazyTrail(start, r, c(5, 3)); // corner (5,0), heading v
    r = extendLazyTrail(start, r, c(5, 6)); // keep going up — extends the open run
    expect(r.trail).toEqual([c(5, 0)]);
    expect(r.heading).toBe("v");
  });

  it("retraction unwinds a multi-corner staircase one corner per move", () => {
    let r = extendLazyTrail(start, emptyLazyRoute(), c(5, 0)); // right
    r = extendLazyTrail(start, r, c(5, 3)); // corner (5,0), heading v
    r = extendLazyTrail(start, r, c(9, 3)); // corner (5,3), heading h
    expect(r.trail).toEqual([c(5, 0), c(5, 3)]);
    r = extendLazyTrail(start, r, c(5, 6)); // back onto col 5 (last corner's col) → pop (5,3)
    expect(r.trail).toEqual([c(5, 0)]);
    expect(r.heading).toBe("v");
    r = extendLazyTrail(start, r, c(2, 0)); // back onto row 0 (first corner's row) → pop (5,0)
    expect(r.trail).toEqual([]);
    expect(r.heading).toBe("h");
  });
});

describe("applyCrossings — bridge hops cluster into arches; dense crossings notch instead (4A/4C)", () => {
  const hWire = (y: number, x0: number, x1: number): Point[] => [
    new Point(x0, y),
    new Point(x1, y),
  ];
  const vWire = (x: number, y0: number, y1: number): Point[] => [
    new Point(x, y0),
    new Point(x, y1),
  ];
  const crestYs = (route: Point[]): number[] =>
    route.filter((p) => p.y < 99).map((p) => p.y); // points lifted above the y=100 run

  it("a lone different-net crossing → one small dome (4 bump points), hopper draws OVER", () => {
    const routes = new Map([
      [1, hWire(100, 0, 300)],
      [2, vWire(150, 0, 200)],
    ]);
    const { dots, overpasses } = applyCrossings(
      routes,
      new Map([
        [1, 1],
        [2, 2],
      ]),
      () => 0,
    );
    expect(routes.get(1)!.length).toBe(6); // 2 ends + 4 dome points
    expect(crestYs(routes.get(1)!).length).toBe(2); // a flat crest plateau (2 raised corners)
    expect(overpasses).toEqual([[1, 2]]); // horizontal hops the vertical
    expect(dots).toEqual([]);
  });

  it("two CLOSE crossings merge into ONE arch (still 4 points, crest spans both)", () => {
    const routes = new Map([
      [1, hWire(100, 0, 300)],
      [2, vWire(150, 0, 200)],
      [3, vWire(170, 0, 200)], // 20px away ⇒ same cluster
    ]);
    applyCrossings(
      routes,
      new Map([
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
      () => 0,
    );
    const r = routes.get(1)!;
    expect(r.length).toBe(6); // ONE merged arch, not two stacked domes (which would be 10)
    const crest = r.filter((p) => p.y < 99);
    expect(crest.length).toBe(2);
    expect(crest[0]!.x).toBeLessThan(150); // crest plateau brackets both crossings
    expect(crest[1]!.x).toBeGreaterThan(170);
  });

  it("FAR-apart crossings stay separate domes", () => {
    const routes = new Map([
      [1, hWire(100, 0, 360)],
      [2, vWire(100, 0, 200)],
      [3, vWire(260, 0, 200)], // 160px away ⇒ separate clusters
    ]);
    applyCrossings(
      routes,
      new Map([
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
      () => 0,
    );
    expect(routes.get(1)!.length).toBe(10); // 2 ends + two 4-point domes
  });

  it("a DENSE cluster (4 crossings) drops the hump → flat hopper notches each under-wire", () => {
    const routes = new Map([
      [1, hWire(100, 0, 400)],
      [2, vWire(150, 0, 200)],
      [3, vWire(170, 0, 200)],
      [4, vWire(190, 0, 200)],
      [5, vWire(210, 0, 200)], // 4 within one cluster ⇒ dense
    ]);
    const { overpasses } = applyCrossings(
      routes,
      new Map([
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 5],
      ]),
      () => 0,
    );
    expect(routes.get(1)!.length).toBe(2); // hopper left FLAT — no bumps
    expect(overpasses.length).toBe(4); // …but still drawn OVER all four (the casing knocks them out)
  });

  it("a SAME-net crossing ties a junction dot, never a bridge", () => {
    const routes = new Map([
      [1, hWire(100, 0, 300)],
      [2, vWire(150, 0, 200)],
    ]);
    const { dots, overpasses } = applyCrossings(
      routes,
      new Map([
        [1, 7],
        [2, 7], // same net
      ]),
      () => 0xabcdef,
    );
    expect(routes.get(1)!.length).toBe(2); // no bump
    expect(overpasses).toEqual([]);
    expect(dots).toEqual([{ x: 150, y: 100, color: 0xabcdef }]);
  });
});

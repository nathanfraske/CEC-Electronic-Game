// SPDX-License-Identifier: Apache-2.0
// Worked examples: small, prebuilt circuits the player can load to see a working
// board before building their own. Each is just a BoardGraph (parts + wires +
// ideal values) serialized to a snapshot — the board, the solver, and the
// animations do the rest. Keep this list short and the blurbs plain.

import { BoardGraph, type Component, type GraphSnapshot } from "./graph";

export interface ExampleSpec {
  id: string;
  name: string;
  /** One or two plain sentences on what the circuit is. */
  blurb: string;
  /** A concrete thing to watch once it runs. */
  watch: string;
  build(): GraphSnapshot;
}

function comp(
  g: BoardGraph,
  kind: string,
  col: number,
  row: number,
  value: number,
): Component {
  const c = g.place(kind, { col, row });
  if (!c) throw new Error("unknown kind: " + kind);
  c.value = value;
  return c;
}

function wire(
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

export const EXAMPLES: ExampleSpec[] = [
  {
    id: "divider",
    name: "Voltage Divider",
    blurb:
      "Two resistors in series across a 5 V source. The middle node sits at a fraction of the supply set by the ratio R2 / (R1 + R2).",
    watch: "the mid node settles to 3.33 V (R1 = 1 kΩ, R2 = 2 kΩ).",
    build() {
      const g = new BoardGraph();
      const v = comp(g, "V", 3, 8, 5);
      const r1 = comp(g, "R", 8, 5, 1000);
      const r2 = comp(g, "R", 8, 9, 2000);
      wire(g, v, 0, r1, 0); // V+ → R1.A
      wire(g, r1, 1, r2, 0); // R1.B → R2.A (the mid node)
      wire(g, r2, 1, v, 1); // R2.B → V−
      return g.serialize();
    },
  },
  {
    id: "rc",
    name: "RC Charge",
    blurb:
      "A 5 V source charges a capacitor through a resistor. The capacitor voltage rises on the classic exponential curve, not in a straight line.",
    watch: "V(cap) climb toward 5 V with a time constant τ = R·C = 1 ms.",
    build() {
      const g = new BoardGraph();
      const v = comp(g, "V", 3, 7, 5);
      const r = comp(g, "R", 8, 7, 1000);
      const c = comp(g, "C", 13, 7, 1e-6);
      wire(g, v, 0, r, 0); // V+ → R.A
      wire(g, r, 1, c, 0); // R.B → C.+
      wire(g, c, 1, v, 1); // C.− → V−
      return g.serialize();
    },
  },
  {
    id: "rl",
    name: "RL Current Rise",
    blurb:
      "A 5 V source drives current through a resistor and an inductor. The inductor resists sudden change, so the current ramps up instead of jumping.",
    watch: "the current ease up to 50 mA (τ = L/R = 1 ms, I = V/R).",
    build() {
      const g = new BoardGraph();
      const v = comp(g, "V", 3, 7, 5);
      const r = comp(g, "R", 8, 7, 100);
      const l = comp(g, "L", 13, 7, 0.1);
      wire(g, v, 0, r, 0); // V+ → R.A
      wire(g, r, 1, l, 0); // R.B → L.A
      wire(g, l, 1, v, 1); // L.B → V−
      return g.serialize();
    },
  },
];

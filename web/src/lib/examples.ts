// SPDX-License-Identifier: Apache-2.0
// Worked examples: small, prebuilt circuits the player can either watch run or
// build themselves step by step. Each is a BoardGraph (parts + wires + ideal
// values) serialized to a snapshot, plus a short ordered build script. The
// board, the solver, and the animations do the rest. Keep the lists short and
// the language plain.

import { BoardGraph, type Component, type GraphSnapshot } from "./graph";

/** Live progress passed to a build step's completion check. */
export interface BuildProgress {
  /** Count of placed components by kind tag. */
  count: Record<string, number>;
  /** Number of wires on the board. */
  wires: number;
  /** True once the board's topology matches the example's target shape. */
  complete: boolean;
}

/** One guided step: what to do, why it matters, and when it's satisfied. */
export interface BuildStep {
  do: string;
  why: string;
  done(p: BuildProgress): boolean;
}

export interface ExampleSpec {
  id: string;
  name: string;
  /** One or two plain sentences on what the circuit is. */
  blurb: string;
  /** A concrete thing to watch once it runs. */
  watch: string;
  /** The finished circuit, for "Watch" and for the build's target shape. */
  build(): GraphSnapshot;
  /** Ordered guided-build steps for "Build". */
  steps: BuildStep[];
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

const at = (p: BuildProgress, kind: string): number => p.count[kind] ?? 0;

export const EXAMPLES: ExampleSpec[] = [
  {
    id: "divider",
    name: "Voltage Divider",
    blurb:
      "Two resistors in series across a 5 V source. The middle node sits at a fraction of the supply set by the ratio R2 / (R1 + R2).",
    watch:
      "the mid node hold at 3.33 V — R2 to ground is what lets current flow and drop the rest across R1.",
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
    steps: [
      {
        do: "Place a Voltage Source (V).",
        why: "Every circuit starts with a source — the push that drives current around the loop.",
        done: (p) => at(p, "V") >= 1,
      },
      {
        do: "Place two Resistors (R).",
        why: "Two resistors in series will share the source voltage between them.",
        done: (p) => at(p, "R") >= 2,
      },
      {
        do: "Wire the source + pin to the first resistor.",
        why: "Current leaves the source's + terminal and enters the top of the divider.",
        done: (p) => p.wires >= 1,
      },
      {
        do: "Wire the two resistors together in series.",
        why: "Their junction is the divider's output — the node whose voltage you're setting.",
        done: (p) => p.wires >= 2,
      },
      {
        do: "Close the loop back to the source − pin.",
        why: "Current must return to the source; its − pin is your 0 V ground reference.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "rc",
    name: "RC Charge",
    blurb:
      "A 5 V source charges a capacitor through a resistor. The capacitor voltage rises on the classic exponential curve, not in a straight line.",
    watch:
      "the current fall to zero as V(cap) reaches the rail — a charged capacitor is an open, not a short.",
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
    steps: [
      {
        do: "Place a Voltage Source (V).",
        why: "The source provides the voltage that will charge the capacitor.",
        done: (p) => at(p, "V") >= 1,
      },
      {
        do: "Place a Resistor (R).",
        why: "The resistor limits the current, setting how fast the capacitor charges.",
        done: (p) => at(p, "R") >= 1,
      },
      {
        do: "Place a Capacitor (C).",
        why: "The capacitor stores charge; its voltage can't change instantly.",
        done: (p) => at(p, "C") >= 1,
      },
      {
        do: "Wire source + → resistor → capacitor.",
        why: "Current flows through R to pile charge onto C — that's the RC path.",
        done: (p) => p.wires >= 2,
      },
      {
        do: "Close the loop back to the source −.",
        why: "Completing the loop lets current flow and the capacitor charge on its curve.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "rl",
    name: "RL Current Rise",
    blurb:
      "A 5 V source drives current through a resistor and an inductor. The inductor resists sudden change, so the current ramps up instead of jumping.",
    watch:
      "the current ease up to 50 mA instead of jumping — the inductor fights the sudden change.",
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
    steps: [
      {
        do: "Place a Voltage Source (V).",
        why: "The source drives the current through the coil.",
        done: (p) => at(p, "V") >= 1,
      },
      {
        do: "Place a Resistor (R).",
        why: "The resistor sets the final current (I = V/R) and the time constant.",
        done: (p) => at(p, "R") >= 1,
      },
      {
        do: "Place an Inductor (L).",
        why: "The inductor opposes sudden change, so the current ramps instead of jumping.",
        done: (p) => at(p, "L") >= 1,
      },
      {
        do: "Wire source + → resistor → inductor.",
        why: "Current flows through the resistor and the coil in series.",
        done: (p) => p.wires >= 2,
      },
      {
        do: "Close the loop back to the source −.",
        why: "Closing the loop lets current build up through the inductor.",
        done: (p) => p.complete,
      },
    ],
  },
];

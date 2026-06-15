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
  /** Optional one-toggle demo (e.g. lift a part from ground to show its effect). */
  demo?: {
    label: string;
    on: string;
    off: string;
    alt(): GraphSnapshot;
  };
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
    id: "primer",
    name: "Voltage & Current",
    blurb:
      "The simplest loop there is: a source pushing current through one resistor. A first look at what voltage and current actually are.",
    watch:
      "the arrows flowing along the wire — that's current — and the wire's colour, its voltage, dropping from the rail to ground across the resistor.",
    build() {
      // Rectangular loop: R across the top, V at the bottom-left, GND at the
      // bottom-right, joined by a left and a right vertical rail.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 1000);
      const v = comp(g, "V", 2, 6, 5);
      const gnd = comp(g, "GND", 6, 6, 0);
      wire(g, v, 0, r, 0); // V+ → R.A (left rail)
      wire(g, r, 1, v, 1); // R.B → V− (right rail)
      wire(g, v, 1, gnd, 0); // V− → GND (the 0 V reference)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V).",
        why: "A source is a pump — it pushes on the charges, creating a voltage: an electrical 'pressure'.",
        done: (p) => at(p, "V") >= 1,
      },
      {
        do: "Place a Resistor (R).",
        why: "Something for the current to flow through; the resistor sets how much.",
        done: (p) => at(p, "R") >= 1,
      },
      {
        do: "Wire them into a loop: V+ → R → V−.",
        why: "Current only flows in a complete loop. The moving arrows ARE the current; the wire's colour is the voltage.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "divider",
    name: "Voltage Divider",
    blurb:
      "Two resistors in series across a 5 V source. The middle node sits at a fraction of the supply set by the ratio R2 / (R1 + R2).",
    watch:
      "the mid node hold at 3.33 V — R2 to ground is what lets current flow and drop the rest across R1.",
    build() {
      // R1 and R2 in series across the top; the tap between them is the output.
      const g = new BoardGraph();
      const r1 = comp(g, "R", 2, 0, 1000);
      const r2 = comp(g, "R", 6, 0, 2000);
      const v = comp(g, "V", 2, 6, 5);
      const gnd = comp(g, "GND", 8, 6, 0);
      wire(g, v, 0, r1, 0); // V+ → R1.A (left rail)
      wire(g, r1, 1, r2, 0); // R1.B → R2.A (the divider tap)
      wire(g, r2, 1, gnd, 0); // R2.B → GND (right rail)
      wire(g, v, 1, gnd, 0); // V− → GND (reference, bottom rail)
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
    demo: {
      label: "R2 → ground",
      on: "R2 grounded — current flows and the divider splits the voltage.",
      off: "R2 lifted from ground — no current path, so the output floats up to the full rail.",
      alt() {
        const g = new BoardGraph();
        const r1 = comp(g, "R", 2, 0, 1000);
        const r2 = comp(g, "R", 6, 0, 2000);
        const v = comp(g, "V", 2, 6, 5);
        const gnd = comp(g, "GND", 8, 6, 0);
        wire(g, v, 0, r1, 0);
        wire(g, r1, 1, r2, 0);
        wire(g, v, 1, gnd, 0); // V− → GND keeps the reference
        // R2.B intentionally left unconnected — lifted from ground.
        return g.serialize();
      },
    },
  },
  {
    id: "rc",
    name: "RC Charge",
    blurb:
      "A 5 V source charges a capacitor through a resistor. The capacitor voltage rises on the classic exponential curve, not in a straight line.",
    watch:
      "the current fall to zero as V(cap) reaches the rail — a charged capacitor is an open, not a short.",
    build() {
      // R then C across the top; the R–C junction is the capacitor node.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 1000);
      const c = comp(g, "C", 6, 0, 1e-6);
      const v = comp(g, "V", 2, 6, 5);
      const gnd = comp(g, "GND", 8, 6, 0);
      wire(g, v, 0, r, 0); // V+ → R.A (left rail)
      wire(g, r, 1, c, 0); // R.B → C.+ (the cap node)
      wire(g, c, 1, gnd, 0); // C.− → GND (right rail)
      wire(g, v, 1, gnd, 0); // V− → GND (reference, bottom rail)
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
      // R then L across the top; the inductor current ramps through the loop.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 100);
      const l = comp(g, "L", 6, 0, 0.1);
      const v = comp(g, "V", 2, 6, 5);
      const gnd = comp(g, "GND", 8, 6, 0);
      wire(g, v, 0, r, 0); // V+ → R.A (left rail)
      wire(g, r, 1, l, 0); // R.B → L.A
      wire(g, l, 1, gnd, 0); // L.B → GND (right rail)
      wire(g, v, 1, gnd, 0); // V− → GND (reference, bottom rail)
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
  {
    id: "parallel",
    name: "Parallel Resistors",
    blurb:
      "Two resistors share one 5 V source. Each sees the full rail, so their currents add — and the shared supply rail carries the sum, thinning past each tap.",
    watch:
      "the supply rail thicken toward the source as the two branch currents add up (KCL), then split again at each resistor.",
    build() {
      // A ladder: two rungs (R1, R2) between a left (+) rail and a right (−)
      // rail, with V and GND at the bottom. Daisy-chaining the rails lets the
      // KCL flow show the current accumulating toward the source.
      const g = new BoardGraph();
      const r1 = comp(g, "R", 2, 0, 1000);
      const r2 = comp(g, "R", 2, 2, 2000);
      const v = comp(g, "V", 2, 6, 5);
      const gnd = comp(g, "GND", 6, 6, 0);
      wire(g, v, 0, r2, 0); // V+ → R2.A (rail segment carrying both currents)
      wire(g, r2, 0, r1, 0); // R2.A → R1.A (segment carrying R1 only)
      wire(g, r1, 1, r2, 1); // R1.B → R2.B (return rail)
      wire(g, r2, 1, v, 1); // R2.B → V−
      wire(g, v, 1, gnd, 0); // V− → GND
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V).",
        why: "One source will drive both resistors at the same time.",
        done: (p) => at(p, "V") >= 1,
      },
      {
        do: "Place two Resistors (R).",
        why: "In parallel, each resistor sees the full source voltage.",
        done: (p) => at(p, "R") >= 2,
      },
      {
        do: "Wire both resistors across the source (+ rail to − rail).",
        why: "Equal voltage across each means their currents add up in the shared rail.",
        done: (p) => p.wires >= 4,
      },
      {
        do: "Add a Ground (GND) on the − rail.",
        why: "Ground is the 0 V reference the node voltages are measured against.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "isource",
    name: "Current Source",
    blurb:
      "An ideal current source pushes a fixed 5 mA through a resistor no matter what. The voltage it develops is whatever it takes: V = I · R.",
    watch:
      "the current pinned at 5 mA and 5 V across R (5 mA × 1 kΩ) — the mirror image of a voltage source.",
    build() {
      // I drives R; GND pins the reference (a current-only loop has no V to
      // borrow one from). I.A sits on the 0 V rail, I.B drives R high.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 1000);
      const i = comp(g, "I", 2, 6, 5e-3);
      const gnd = comp(g, "GND", 0, 6, 0);
      wire(g, i, 0, r, 0); // I.A → R.A (0 V rail)
      wire(g, i, 1, r, 1); // I.B → R.B (driven rail)
      wire(g, i, 0, gnd, 0); // I.A → GND (reference)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Current Source (I).",
        why: "Unlike a voltage source, it fixes the current and lets the voltage be whatever it must.",
        done: (p) => at(p, "I") >= 1,
      },
      {
        do: "Place a Resistor (R).",
        why: "The forced current has to flow through something; R turns it into a voltage.",
        done: (p) => at(p, "R") >= 1,
      },
      {
        do: "Add a Ground (GND) for the reference.",
        why: "A current-only loop has no voltage source to borrow a 0 V reference from — GND provides it.",
        done: (p) => at(p, "GND") >= 1,
      },
      {
        do: "Wire the source across the resistor, GND on one rail.",
        why: "The forced current runs through R, and V = I·R appears across it.",
        done: (p) => p.complete,
      },
    ],
  },
];

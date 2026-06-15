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
  rot = 0,
): Component {
  const c = g.place(kind, { col, row });
  if (!c) throw new Error("unknown kind: " + kind);
  c.value = value;
  c.rot = rot;
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
  {
    id: "buck",
    name: "Buck Converter",
    blurb:
      "A switch chops a 10 V rail on and off; an inductor + diode catch each pulse and a capacitor smooths it, stepping the rail down to ≈ 4 V (the 40% duty cycle). Every part is animated.",
    watch:
      "the switch flick on/off, the inductor scoop a 'bucket' of energy each cycle and the diode hand it on when the switch opens — the output settles near 4 V = 10 V × 40%.",
    build() {
      // Vin+ → SW → (switch node) → L → OUT; the freewheel diode catches the
      // node when the switch opens; C + R load smooth and draw the output. Vin /
      // C / R / D are placed vertical so the rails read top-to-bottom.
      const g = new BoardGraph();
      const vin = comp(g, "V", 1, 1, 10, 1); // vertical, + at top
      const sw = comp(g, "SW", 4, 1, 0.4); // 40% duty
      const l = comp(g, "L", 12, 1, 1e-3);
      const d = comp(g, "D", 8, 4, 0, 3); // freewheel: anode low, cathode up
      const c = comp(g, "C", 12, 3, 22e-6, 1);
      const r = comp(g, "R", 14, 3, 100, 1);
      const gnd = comp(g, "GND", 8, 6, 0);
      wire(g, vin, 0, sw, 0); // Vin+ → SW.A
      wire(g, sw, 1, l, 0); // SW.B → L.A (the switch node)
      wire(g, sw, 1, d, 1); // SW.B → D.K (freewheel cathode)
      wire(g, l, 1, c, 0); // L.B → C.+ (the output)
      wire(g, l, 1, r, 0); // L.B → R.A (the load)
      wire(g, vin, 1, gnd, 0); // Vin− → GND
      wire(g, d, 0, gnd, 0); // D.A → GND
      wire(g, c, 1, gnd, 0); // C.− → GND
      wire(g, r, 1, gnd, 0); // R.B → GND
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V) — the 10 V input rail.",
        why: "The buck steps this rail down to a lower, steady output.",
        done: (p) => at(p, "V") >= 1,
      },
      {
        do: "Place a Switch (SW) — the chopper.",
        why: "Rapidly switching the rail on and off is how a buck moves energy in packets without wasting it as heat.",
        done: (p) => at(p, "SW") >= 1,
      },
      {
        do: "Place an Inductor (L) and a Diode (D).",
        why: "L is the 'bucket' that scoops energy while the switch is on; D hands it to the output when the switch opens.",
        done: (p) => at(p, "L") >= 1 && at(p, "D") >= 1,
      },
      {
        do: "Place the output Capacitor (C) and a load Resistor (R).",
        why: "C smooths the pulses into a steady voltage; R is what you're powering.",
        done: (p) => at(p, "C") >= 1 && at(p, "R") >= 1,
      },
      {
        do: "Add a Ground (GND) and wire the buck up.",
        why: "Switch → inductor → output, with the diode and ground completing the freewheel path. Watch it settle to Vin × duty.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "rlc",
    name: "RLC Ringing",
    blurb:
      "A 5 V source kicks a series resistor, inductor and capacitor. With the resistance small the loop is underdamped, so the capacitor voltage rings — a decaying sine — before settling.",
    watch:
      "the scope draw a damped sine: V(cap) overshoots 5 V, swings back, and rings down over a few cycles as the small resistance bleeds the energy away.",
    build() {
      // Single series loop: R then L then C across the top, V at the bottom-left,
      // GND bottom-right. One loop, one mesh current shared by every part.
      //   nets: N1 = V+ = R.A ; N2 = R.B = L.A ; N3 = L.B = C.+ ;
      //         GND(0) = C.− = V−.
      // L = 1 mH, C = 1 µF → f0 = 1/(2π√LC) ≈ 5.0 kHz (period ≈ 199 µs,
      // ~100 fixed steps/cycle so backward-Euler adds negligible damping).
      // ζ = (R/2)·√(C/L) = 5·√(1e-6/1e-3) ≈ 0.16 — well underdamped, Q ≈ 3, so
      // it rings ~3 visible cycles. Steady state: current → 0, V(cap) → 5 V (a
      // charged cap is an open), the energy having sloshed L↔C and died in R.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 10);
      const l = comp(g, "L", 6, 0, 1e-3);
      const c = comp(g, "C", 10, 0, 1e-6);
      const v = comp(g, "V", 2, 6, 5);
      const gnd = comp(g, "GND", 12, 6, 0);
      wire(g, v, 0, r, 0); // V+ → R.A (left rail)
      wire(g, r, 1, l, 0); // R.B → L.A
      wire(g, l, 1, c, 0); // L.B → C.+ (the cap node that rings)
      wire(g, c, 1, gnd, 0); // C.− → GND (right rail)
      wire(g, v, 1, gnd, 0); // V− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V).",
        why: "The source's sudden turn-on is the 'kick' that starts the loop ringing.",
        done: (p) => at(p, "V") >= 1,
      },
      {
        do: "Place a Resistor (R) — keep it small.",
        why: "R is the only thing that drains energy; small R means a long, lively ring instead of a quick settle.",
        done: (p) => at(p, "R") >= 1,
      },
      {
        do: "Place an Inductor (L) and a Capacitor (C).",
        why: "L and C trade energy back and forth — current vs charge — and that exchange is the oscillation.",
        done: (p) => at(p, "L") >= 1 && at(p, "C") >= 1,
      },
      {
        do: "Wire one series loop: V+ → R → L → C → V−.",
        why: "A single loop forces one shared current through all three; L and C set the pitch, R the decay.",
        done: (p) => p.wires >= 4,
      },
      {
        do: "Add a Ground (GND) on the bottom rail.",
        why: "Ground is the 0 V reference the ringing cap voltage is measured against.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "pwm-average",
    name: "PWM Dimmer",
    blurb:
      "A switch chops a 10 V rail at 10 kHz with a 30% duty cycle; a resistor and capacitor low-pass the choppy square wave into a steady DC level. The output parks at roughly duty × Vin.",
    watch:
      "the switch node slam between 10 V and 0 V while the smoothed output holds near 3 V (30% of 10 V) with just a little ripple riding on top.",
    build() {
      // SW chops Vin onto node X; a pull-down resistor yanks X to ground while the
      // switch is open, so X is a clean 0↔10 V square. R + C then average it.
      //   nets: N1 = Vin+ = SW.A ; X = SW.B = Rpd.A = R.A ;
      //         OUT = R.B = C.+ ; GND(0) = Rpd.B = C.− = Vin−.
      // Switch period = 50 ticks = 100 µs (10 kHz). Low-pass RC = 1 kΩ·1 µF =
      // 1 ms ≈ 10 switch periods → strong averaging with a small, watchable
      // ripple. Rpd = 100 Ω ≪ R so the off-state pulls X near 0 V without much
      // skew. Steady state: V(OUT) ≈ duty × Vin ≈ 3 V (a touch high, ~3.2 V,
      // since the 100 Ω pull-down can't reach a perfect 0 V), small 10 kHz ripple.
      const g = new BoardGraph();
      const sw = comp(g, "SW", 6, 0, 0.3); // 30% duty
      const r = comp(g, "R", 10, 0, 1000);
      const vin = comp(g, "V", 2, 6, 10);
      const rpd = comp(g, "R", 6, 3, 100, 1); // vertical pull-down on X
      const c = comp(g, "C", 12, 3, 1e-6, 1); // vertical output cap
      const gnd = comp(g, "GND", 12, 6, 0);
      wire(g, vin, 0, sw, 0); // Vin+ → SW.A (left rail)
      wire(g, sw, 1, r, 0); // SW.B → R.A (the chopped node X)
      wire(g, sw, 1, rpd, 0); // SW.B → Rpd.A (pull X to ground when open)
      wire(g, r, 1, c, 0); // R.B → C.+ (the smoothed output)
      wire(g, rpd, 1, gnd, 0); // Rpd.B → GND
      wire(g, c, 1, gnd, 0); // C.− → GND (output reference)
      wire(g, vin, 1, gnd, 0); // Vin− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V) — the 10 V rail.",
        why: "This is the full-strength rail the dimmer will average down.",
        done: (p) => at(p, "V") >= 1,
      },
      {
        do: "Place a Switch (SW) and set a 30% duty.",
        why: "On 30% of the time, off 70%: the rail spends most of each cycle disconnected, so its average drops.",
        done: (p) => at(p, "SW") >= 1,
      },
      {
        do: "Place two Resistors (R) and a Capacitor (C).",
        why: "One resistor pulls the switch node down when it opens; the other plus the cap form the smoothing low-pass.",
        done: (p) => at(p, "R") >= 2 && at(p, "C") >= 1,
      },
      {
        do: "Wire SW → node, pull-down to ground, then R → C to the output.",
        why: "The switch node becomes a clean square wave; the RC averages it to a steady level.",
        done: (p) => p.wires >= 5,
      },
      {
        do: "Add a Ground (GND) and finish the rails.",
        why: "Ground references the output and completes the pull-down path. Watch it settle near duty × Vin.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "diode-clamp",
    name: "Diode Clamp",
    blurb:
      "A 5 V source feeds a resistor into a node, and a diode ties that node to ground. The diode won't conduct until ~0.6 V, then holds firm — so the node is clamped at one diode drop no matter how hard the rail pushes.",
    watch:
      "the node pinned near 0.6 V (not 5 V) while ~4.4 mA flows: the diode is a one-way valve that simply refuses to let the node climb past its forward voltage.",
    build() {
      // V → R → node N; the diode shunts N to ground (anode N, cathode GND), so N
      // is clamped at the diode's forward drop.
      //   nets: N1 = V+ = R.A ; N = R.B = D.A ; GND(0) = D.K = V−.
      // The diode makes this nonlinear (Newton solve). Hand-solving the loop:
      // I = (5 − Vd)/1kΩ and Vd = Vt·ln(I/Is) settle at Vd ≈ 0.57 V, I ≈ 4.4 mA —
      // so N parks near 0.57 V while the resistor drops the remaining ~4.4 V.
      // Every node has a real current path: V→R→D→GND. Steady = same (DC).
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 1000);
      const d = comp(g, "D", 6, 0, 0); // anode A → cathode K (value unused)
      const v = comp(g, "V", 2, 6, 5);
      const gnd = comp(g, "GND", 6, 6, 0);
      wire(g, v, 0, r, 0); // V+ → R.A (left rail)
      wire(g, r, 1, d, 0); // R.B → D.A (the clamped node N)
      wire(g, d, 1, gnd, 0); // D.K → GND (clamp to 0 V reference)
      wire(g, v, 1, gnd, 0); // V− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V).",
        why: "The 5 V rail is what tries to drive the node high.",
        done: (p) => at(p, "V") >= 1,
      },
      {
        do: "Place a Resistor (R).",
        why: "It limits the current into the diode so the clamp can't draw an unbounded spike.",
        done: (p) => at(p, "R") >= 1,
      },
      {
        do: "Place a Diode (D).",
        why: "The diode is a one-way valve with a ~0.6 V threshold — that threshold is the clamp level.",
        done: (p) => at(p, "D") >= 1,
      },
      {
        do: "Wire V+ → R → node, then the diode from the node down to ground.",
        why: "The diode shunts everything above its forward drop to ground, pinning the node there.",
        done: (p) => p.wires >= 3,
      },
      {
        do: "Add a Ground (GND) for the diode's cathode and the reference.",
        why: "Ground is both the clamp target and the 0 V the node is measured against.",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Diode → ground",
      on: "Diode grounded — it clamps the node at one forward drop, about 0.6 V.",
      off: "Diode lifted — nothing shunts the node, so it floats up to the full 5 V rail.",
      alt() {
        const g = new BoardGraph();
        const r = comp(g, "R", 2, 0, 1000);
        const d = comp(g, "D", 6, 0, 0);
        const v = comp(g, "V", 2, 6, 5);
        const gnd = comp(g, "GND", 6, 6, 0);
        wire(g, v, 0, r, 0);
        wire(g, r, 1, d, 0); // R.B → D.A keeps the node fed
        wire(g, v, 1, gnd, 0); // V− → GND keeps the reference
        // D.K intentionally left unconnected — the clamp is lifted, node floats.
        return g.serialize();
      },
    },
  },
];

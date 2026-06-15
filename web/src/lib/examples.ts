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
        why: "A source is a pump — it pushes on the charges, creating a voltage: an electrical 'pressure'. Nothing flows yet: there's no loop for current to take.",
        done: (p) => at(p, "V") >= 1,
      },
      {
        do: "Place a Resistor (R).",
        why: "Something for the current to flow through; the resistor sets how much.",
        done: (p) => at(p, "R") >= 1,
      },
      {
        do: "Wire them into a loop: V+ → R → V−, then press Run.",
        why: "Current only flows in a complete loop. Watch the arrows start moving — that IS the current — and the wire's colour drop from rail to grey across R: that's the voltage falling.",
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
        do: "Place two Resistors (R) stacked in a column.",
        why: "Stacked in series they'll share the source voltage; the joint between them is the tap you're setting.",
        done: (p) => at(p, "R") >= 2,
      },
      {
        do: "Wire the chain: V+ → top R → bottom R, joint left open for now.",
        why: "Current leaves V+, enters the top resistor, and lands on the middle joint — but until the bottom reaches ground there's no loop, so nothing flows yet.",
        done: (p) => p.wires >= 2,
      },
      {
        do: "Ground the bottom of the chain, close to V−, and press Run.",
        why: "Now the loop is complete: watch current flow and the middle tap settle at 3.33 V — R2 to ground is exactly what lets the rest drop across R1.",
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
        do: "Wire source + → resistor → capacitor (cap node still off ground).",
        why: "This stages the RC path: current will flow through R to pile charge onto C — but the loop isn't closed yet, so it sits idle.",
        done: (p) => p.wires >= 2,
      },
      {
        do: "Close the loop: cap → ground → source −, then press Run.",
        why: "Watch the cap voltage ramp up on its curve — fast at first, then easing in — while the current fades to zero. A charged cap is an open, not a short.",
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
        do: "Wire source + → resistor → inductor (coil end still off ground).",
        why: "This stages the series path through R and the coil — but the loop is open, so no current builds yet.",
        done: (p) => p.wires >= 2,
      },
      {
        do: "Close the loop back to the source −, then press Run.",
        why: "Watch the current ease up to 50 mA instead of snapping there — the coil fights the sudden change, then relaxes once the current is steady.",
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
        why: "One source will drive every resistor we hang across it at the same time.",
        done: (p) => at(p, "V") >= 1,
      },
      {
        do: "Place ONE Resistor (R) and a Ground (GND); wire it across the source, then press Run.",
        why: "A single branch first: watch its current flow and the whole supply rail carry just that one branch's draw (2.5 mA through 2 kΩ).",
        done: (p) => at(p, "R") >= 1 && at(p, "GND") >= 1 && p.wires >= 3,
      },
      {
        do: "Place a second Resistor (R) and wire it across the same two rails.",
        why: "Both now see the full rail, so their currents add (KCL). Run again and watch the rail thicken toward the source as the sum builds, then split at each tap.",
        done: (p) => at(p, "R") >= 2 && p.complete,
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
        do: "Wire the source across the resistor with GND on one rail, then press Run.",
        why: "Watch the current pin at exactly 5 mA while 5 V develops across R (5 mA × 1 kΩ) — push a bigger resistor in later and the current won't budge; only the voltage climbs.",
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
        why: "The buck steps this rail down to a lower, steady output. We'll build it one part at a time and run it after each, so you SEE what each part does.",
        done: (p) => at(p, "V") >= 1,
      },
      {
        do: "Build the forward path first: Switch (SW) → Inductor (L) → load Resistor (R) → Ground, and Vin− → Ground. Then press Run.",
        why: "Watch the switch flick on and off and the inductor current sawtooth up while it's on — but when the switch opens, the coil's current has nowhere to go, so the switch node spikes and the current goes ragged. That missing piece is the whole point of the next step.",
        done: (p) =>
          at(p, "SW") >= 1 &&
          at(p, "L") >= 1 &&
          at(p, "R") >= 1 &&
          p.wires >= 5,
      },
      {
        do: "Add the freewheel Diode (D): cathode to the switch node, anode to ground. Run again.",
        why: "Now when the switch opens the diode catches the coil's current and lets it freewheel to ground. Watch the spike vanish and the inductor current settle into a clean, steady sawtooth — the 'bucket' of energy is handed on instead of slamming shut.",
        done: (p) => at(p, "D") >= 1 && p.wires >= 7,
      },
      {
        do: "Add the output Capacitor (C) across the output to ground. Run once more.",
        why: "The cap soaks up the sawtooth ripple. Watch the output stop wobbling and settle to a steady ≈ 4 V — that's 10 V × the 40% duty cycle. You've built a buck.",
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
        do: "Wire one series loop: V+ → R → L → C → V− (cap still off ground).",
        why: "A single loop forces one shared current through all three; L and C will set the pitch, R the decay. It stays quiet until the loop reaches ground.",
        done: (p) => p.wires >= 4,
      },
      {
        do: "Add a Ground (GND) to close the loop, then press Run.",
        why: "Watch the scope draw a damped sine: V(cap) overshoots 5 V, swings back, and rings down over a few cycles as the small resistance bleeds the energy away.",
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
        do: "Place a Switch (SW, 30% duty) and a pull-down Resistor (R) with a Ground. Wire Vin+ → SW → node → R → GND, and Vin− → GND. Then press Run.",
        why: "On 30% of the time, off 70%. With the pull-down yanking the node low whenever the switch opens, watch that node slam cleanly between 10 V and 0 V — a square wave, not yet smoothed.",
        done: (p) => at(p, "SW") >= 1 && at(p, "R") >= 1 && p.wires >= 4,
      },
      {
        do: "Add the smoothing low-pass: a second Resistor (R) from the node into a Capacitor (C) to ground. Run again.",
        why: "The RC averages the choppy square wave. Watch the output stop slamming and hold near 3 V (30% of 10 V) with just a little ripple riding on top.",
        done: (p) => at(p, "R") >= 2 && at(p, "C") >= 1 && p.complete,
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
        do: "Place a Voltage Source (V) and a Resistor (R).",
        why: "The 5 V rail tries to drive the node high; R limits the current into the diode so the clamp can't draw an unbounded spike.",
        done: (p) => at(p, "V") >= 1 && at(p, "R") >= 1,
      },
      {
        do: "Place a Diode (D) and a Ground (GND). Wire V+ → R → node → diode anode, and V− → GND — but leave the diode's cathode OPEN. Then press Run.",
        why: "With the diode's far end dangling, no current flows through it: watch the node float all the way up to the full 5 V rail. Nothing is holding it back yet.",
        done: (p) =>
          at(p, "V") >= 1 &&
          at(p, "R") >= 1 &&
          at(p, "D") >= 1 &&
          at(p, "GND") >= 1 &&
          p.wires >= 3,
      },
      {
        do: "Now wire the diode's cathode down to ground, and Run again.",
        why: "The diode is a one-way valve: above ~0.6 V it conducts hard and shunts the rest to ground. Watch the node snap down from 5 V and pin near 0.6 V while ~4.4 mA flows.",
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
  // ── AC track ────────────────────────────────────────────────────────────
  // The AC source is the time-varying twin of V: kind "AC", pins + = 0 / − = 1,
  // fixed 5 V peak, and its `value` is the frequency in Hz. Every frequency below
  // is kept in the watchable ~50 Hz–5 kHz band (DT = 2 µs ⇒ 500_000/f ticks per
  // period), and an ideal AC source never sits directly across a bare C or L —
  // examples 3–6 always put a series R in the loop (it doubles as the current
  // probe), and the pure RLC loop (7) shares one mesh current like `rlc`.
  {
    id: "ac-resistor",
    name: "AC Across a Resistor",
    blurb:
      "An AC source — a 5 V-peak sine — pushes current through a single resistor. The voltage rises, falls, and reverses sign; through a pure resistor the current just tracks it, in phase, flowing backward every half-cycle.",
    watch:
      "the node draw a clean sine swinging +5 V to −5 V — it dips below ground — while the current speeds up, stalls, and reverses twice per period. Voltage and current peak together: a resistor has no memory.",
    build() {
      // The `primer` loop, but with an AC source: R across the top, AC at the
      // bottom-left, GND bottom-right.
      //   nets: N1 = AC.+ = R.A ; GND(0) = R.B = AC.−.
      // AC = 500 Hz (1000 ticks/period), R = 1 kΩ → 5 mA peak, in phase.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 1000);
      const ac = comp(g, "AC", 2, 6, 500);
      const gnd = comp(g, "GND", 6, 6, 0);
      wire(g, ac, 0, r, 0); // AC+ → R.A (left rail)
      wire(g, r, 1, ac, 1); // R.B → AC− (right rail)
      wire(g, ac, 1, gnd, 0); // AC− → GND (the 0 V reference)
      return g.serialize();
    },
    steps: [
      {
        do: "Place an AC Source (AC).",
        why: "Unlike the DC source you've used, this one doesn't hold still — it pushes, eases off, then pushes the other way, over and over. Nothing flows yet; there's no loop.",
        done: (p) => at(p, "AC") >= 1,
      },
      {
        do: "Place a Resistor (R).",
        why: "A path for the current, and a pure one — it has no memory, so whatever the source does, the current copies instantly.",
        done: (p) => at(p, "R") >= 1,
      },
      {
        do: "Wire the loop AC+ → R → AC− with a Ground, then press Run.",
        why: "Watch the scope draw a full sine, dipping below ground on every other half-cycle, and watch the current arrows halt and reverse each time the voltage flips. That reversal is the whole idea of AC.",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Slow it down",
      on: "500 Hz — the sine fills the scope quickly.",
      off: "100 Hz — same height, but stretched out: frequency is the horizontal axis, amplitude is fixed.",
      alt() {
        const g = new BoardGraph();
        const r = comp(g, "R", 2, 0, 1000);
        const ac = comp(g, "AC", 2, 6, 100); // slowed to 100 Hz
        const gnd = comp(g, "GND", 6, 6, 0);
        wire(g, ac, 0, r, 0);
        wire(g, r, 1, ac, 1);
        wire(g, ac, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  {
    id: "ac-rms",
    name: "RMS & Heating",
    blurb:
      "A 5 V-peak sine heats a resistor exactly like a 3.54 V DC source would — its RMS value, peak ÷ √2. Two independent loops on one board, an AC source and a quiet DC source, push the same average power through identical resistors.",
    watch:
      "the AC node peak at ±5 V while the DC node sits flat at 3.54 V — clearly lower than the AC peak — yet the average current and heating match. It's the average of the square that's equal, not the peak.",
    build() {
      // Two independent loops, clearly separated columns so they compare directly.
      //   left:  N1 = AC.+ = R1.A ; GND(0) = R1.B = AC.−
      //   right: N2 = V.+  = R2.A ; GND(0) = R2.B = V.−
      // AC = 500 Hz, V = 3.54 V (RMS of 5 V peak), R1 = R2 = 1 kΩ.
      // Average power each ≈ Vrms²/R ≈ 12.5 mW. The shared GND ties both loops to
      // one reference without coupling their currents.
      const g = new BoardGraph();
      const r1 = comp(g, "R", 2, 0, 1000); // AC loop, left column
      const ac = comp(g, "AC", 2, 6, 500);
      const r2 = comp(g, "R", 9, 0, 1000); // DC loop, right column
      const v = comp(g, "V", 9, 6, 3.54);
      const gnd = comp(g, "GND", 6, 6, 0); // shared reference, between the columns
      // Left loop: AC+ → R1 → AC−, with AC− grounded.
      wire(g, ac, 0, r1, 0); // AC+ → R1.A
      wire(g, r1, 1, ac, 1); // R1.B → AC−
      wire(g, ac, 1, gnd, 0); // AC− → GND
      // Right loop: V+ → R2 → V−, with V− on the same ground.
      wire(g, v, 0, r2, 0); // V+ → R2.A
      wire(g, r2, 1, v, 1); // R2.B → V−
      wire(g, v, 1, gnd, 0); // V− → GND (shared)
      return g.serialize();
    },
    steps: [
      {
        do: "Build the DC reference first: V (3.54 V) → R → GND, then press Run.",
        why: "A plain steady current, a flat line — our yardstick for 'this much heating.'",
        done: (p) => at(p, "V") >= 1 && at(p, "R") >= 1 && p.wires >= 3,
      },
      {
        do: "Now build the AC loop beside it: AC (500 Hz) → R → the same Ground. Run.",
        why: "The AC source swings higher than the DC line (±5 V vs 3.54 V), but watch the two currents: averaged over a cycle they carry the same load.",
        done: (p) => at(p, "V") >= 1 && at(p, "AC") >= 1 && p.complete,
      },
      {
        do: "Compare the heating, not the heights.",
        why: "That 3.54 V is the RMS of a 5 V peak sine — peak ÷ √2 — the DC value that does equal work.",
        done: (p) => at(p, "V") >= 1 && at(p, "AC") >= 1 && p.complete,
      },
    ],
    demo: {
      label: "Match the heat",
      on: "DC at 3.54 V — the honest RMS equivalent: same average heating as the ±5 V sine.",
      off: "DC at 5.0 V — the flat line now sits at the AC's peak and plainly out-heats it. Peak ≠ RMS.",
      alt() {
        const g = new BoardGraph();
        const r1 = comp(g, "R", 2, 0, 1000);
        const ac = comp(g, "AC", 2, 6, 500);
        const r2 = comp(g, "R", 9, 0, 1000);
        const v = comp(g, "V", 9, 6, 5); // raised to the AC's peak
        const gnd = comp(g, "GND", 6, 6, 0);
        wire(g, ac, 0, r1, 0);
        wire(g, r1, 1, ac, 1);
        wire(g, ac, 1, gnd, 0);
        wire(g, v, 0, r2, 0);
        wire(g, r2, 1, v, 1);
        wire(g, v, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  {
    id: "ac-cap",
    name: "Capacitor Reactance",
    blurb:
      "A capacitor opposes AC with reactance Xc = 1/(2πfC) that falls as frequency rises — an open to DC, a short to fast AC. The current leads the voltage by 90°: it peaks while the cap voltage is crossing zero, because i = C·dv/dt.",
    watch:
      "the cap voltage trail the source, while the current (the wire through R, and the slope of the cap voltage) runs fastest exactly as the cap voltage crosses zero and stalls at its peaks — current leads voltage by a quarter cycle.",
    build() {
      // Series R then C; the cap node is the output. The small R makes the phase
      // legible and keeps the ideal source off a bare reactance (it is the cap's
      // current probe).
      //   nets: N1 = AC.+ = R.A ; OUT = R.B = C.+ ; GND(0) = C.− = AC.−.
      // AC = 500 Hz, R = 330 Ω, C = 0.1 µF → Xc ≈ 3.2 kΩ ≫ R, so the cap voltage
      // nearly equals the source and the current leads it by ~90°.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 330);
      const c = comp(g, "C", 6, 0, 0.1e-6);
      const ac = comp(g, "AC", 2, 6, 500);
      const gnd = comp(g, "GND", 8, 6, 0);
      wire(g, ac, 0, r, 0); // AC+ → R.A (left rail)
      wire(g, r, 1, c, 0); // R.B → C.+ (the cap node / output)
      wire(g, c, 1, gnd, 0); // C.− → GND (right rail)
      wire(g, ac, 1, gnd, 0); // AC− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place an AC Source (AC) and a small Resistor (R).",
        why: "R is our current probe — the wire through it shows the cap's current — and it keeps the ideal source from staring into a bare capacitor.",
        done: (p) => at(p, "AC") >= 1 && at(p, "R") >= 1,
      },
      {
        do: "Place a Capacitor (C) and wire AC+ → R → C → GND. Run.",
        why: "Watch the cap voltage trail the source, and watch the current run fastest as the cap voltage passes through zero — i = C·dv/dt, so current leads by a quarter cycle.",
        done: (p) => p.complete,
      },
      {
        do: "Use the demo to sweep the frequency up.",
        why: "Reactance isn't a fixed resistance — crank f up and the cap fights the current less (Xc = 1/2πfC drops).",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Raise the frequency",
      on: "500 Hz — Xc ≈ 3.2 kΩ ≫ R, so nearly the whole swing lands on the cap.",
      off: "3 kHz — Xc ≈ 530 Ω, comparable to R, so the cap voltage shrinks while the current grows. Reactance falls with frequency.",
      alt() {
        const g = new BoardGraph();
        const r = comp(g, "R", 2, 0, 330);
        const c = comp(g, "C", 6, 0, 0.1e-6);
        const ac = comp(g, "AC", 2, 6, 3000); // raised to 3 kHz
        const gnd = comp(g, "GND", 8, 6, 0);
        wire(g, ac, 0, r, 0);
        wire(g, r, 1, c, 0);
        wire(g, c, 1, gnd, 0);
        wire(g, ac, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  {
    id: "ac-ind",
    name: "Inductor Reactance",
    blurb:
      "The mirror image of the capacitor. An inductor opposes AC with reactance Xl = 2πfL that rises with frequency — a short to DC, an open to fast AC. The current lags the voltage by 90°, because v = L·di/dt: it can't turn around until the voltage has led the way.",
    watch:
      "the current (the wire through R, in phase with the R voltage) peak a quarter-cycle after the source voltage — it lags. Sweep f up and the current shrinks: a coil chokes high frequencies, the exact opposite of the capacitor.",
    build() {
      // Series R then L; the inductor carries the loop current. R is the current
      // probe and keeps the ideal source off the bare coil.
      //   nets: N1 = AC.+ = R.A ; MID = R.B = L.A ; GND(0) = L.B = AC.−.
      // AC = 500 Hz, R = 100 Ω, L = 100 mH → Xl ≈ 314 Ω, a few × R, so the loop
      // current lags the source by most of 90°.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 100);
      const l = comp(g, "L", 6, 0, 0.1);
      const ac = comp(g, "AC", 2, 6, 500);
      const gnd = comp(g, "GND", 8, 6, 0);
      wire(g, ac, 0, r, 0); // AC+ → R.A (left rail)
      wire(g, r, 1, l, 0); // R.B → L.A
      wire(g, l, 1, gnd, 0); // L.B → GND (right rail)
      wire(g, ac, 1, gnd, 0); // AC− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place an AC Source (AC) and a small Resistor (R).",
        why: "Again R is the current probe and a gentle limit; the action is the coil.",
        done: (p) => at(p, "AC") >= 1 && at(p, "R") >= 1,
      },
      {
        do: "Place an Inductor (L) and wire AC+ → R → L → GND. Run.",
        why: "The coil resists change, so the current can't follow the voltage instantly — watch it lag a quarter cycle behind.",
        done: (p) => p.complete,
      },
      {
        do: "Compare with the capacitor example.",
        why: "Cap current leads, coil current lags; cap reactance falls with f, coil reactance rises. They are duals.",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Raise the frequency",
      on: "500 Hz — Xl ≈ 314 Ω, a few × R, so the current lags but still flows freely.",
      off: "2 kHz — Xl ≈ 1.3 kΩ ≫ R, so the current shrinks hard: a coil blocks high frequencies.",
      alt() {
        const g = new BoardGraph();
        const r = comp(g, "R", 2, 0, 100);
        const l = comp(g, "L", 6, 0, 0.1);
        const ac = comp(g, "AC", 2, 6, 2000); // raised to 2 kHz
        const gnd = comp(g, "GND", 8, 6, 0);
        wire(g, ac, 0, r, 0);
        wire(g, r, 1, l, 0);
        wire(g, l, 1, gnd, 0);
        wire(g, ac, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  {
    id: "ac-lowpass",
    name: "RC Low-Pass Filter",
    blurb:
      "Series R into a shunt C is a frequency-dependent voltage divider: at low f the cap's Xc is huge and the output ≈ input; at high f Xc collapses and the output is shorted down. Highs are cut. The corner fc = 1/(2πRC) is where the output has fallen to ~70%.",
    watch:
      "input and output on the scope. At the low default the output nearly overlaps the input — passed. Flip the demo to a high frequency and the output collapses to a fraction (and lags): the filter is throwing the highs away.",
    build() {
      // Same wiring as ac-cap, reframed as a filter: the R–C junction is the
      // filtered output.
      //   nets: N1 = AC.+ = R.A ; OUT = R.B = C.+ ; GND(0) = C.− = AC.−.
      // R = 1 kΩ, C = 0.1 µF → fc ≈ 1.6 kHz, mid-band with margin both sides.
      // Default-run low (300 Hz, well under fc) so the output starts near full.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 1000);
      const c = comp(g, "C", 6, 0, 0.1e-6);
      const ac = comp(g, "AC", 2, 6, 300);
      const gnd = comp(g, "GND", 8, 6, 0);
      wire(g, ac, 0, r, 0); // AC+ → R.A (left rail)
      wire(g, r, 1, c, 0); // R.B → C.+ (the filtered output)
      wire(g, c, 1, gnd, 0); // C.− → GND (right rail)
      wire(g, ac, 1, gnd, 0); // AC− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place an AC Source (AC), a Resistor (R), and a Capacitor (C).",
        why: "The same three parts as the cap-reactance demo — wired as a divider they become a filter.",
        done: (p) => at(p, "AC") >= 1 && at(p, "R") >= 1 && at(p, "C") >= 1,
      },
      {
        do: "Wire AC+ → R → C → GND, with the R–C junction as the output. Run at a low frequency.",
        why: "Low frequencies sail through — watch the output ride almost on top of the input.",
        done: (p) => p.complete,
      },
      {
        do: "Flip the demo to a high frequency.",
        why: "Now Xc is tiny and shorts the output down — watch the output sine shrink away. This is a low-pass: lows pass, highs are cut, the knee is fc = 1/(2πRC).",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Sweep low ↔ high",
      on: "300 Hz — well below the 1.6 kHz corner, so the output passes nearly full size.",
      off: "5 kHz — well above the corner, so Xc shorts the output down to a fraction. Same circuit, highs crushed.",
      alt() {
        const g = new BoardGraph();
        const r = comp(g, "R", 2, 0, 1000);
        const c = comp(g, "C", 6, 0, 0.1e-6);
        const ac = comp(g, "AC", 2, 6, 5000); // swept up to 5 kHz
        const gnd = comp(g, "GND", 8, 6, 0);
        wire(g, ac, 0, r, 0);
        wire(g, r, 1, c, 0);
        wire(g, c, 1, gnd, 0);
        wire(g, ac, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  {
    id: "ac-highpass",
    name: "RC High-Pass Filter",
    blurb:
      "Swap the two parts and you get the opposite filter. With C in series and R to ground, DC and low f are blocked by the cap — its Xc is huge, dropping the whole swing — and only high f gets through. Same corner fc = 1/(2πRC), opposite slope. It also teaches AC coupling.",
    watch:
      "input and output on the scope. At the high default the output ≈ input — passed. Demo down to a low frequency and the output shrinks: the series cap is blocking it. The mirror of the low-pass.",
    build() {
      // C and R swapped vs the low-pass; the resistor node is the output. The loop
      // is R + C in series, so the ideal source never faces a bare reactance.
      //   nets: N1 = AC.+ = C.+ ; OUT = C.− = R.A ; GND(0) = R.B = AC.−.
      // C = 0.1 µF, R = 1 kΩ → fc ≈ 1.6 kHz (same corner as the low-pass, by
      // design). Default-run high (5 kHz, above fc) so the output starts near full.
      const g = new BoardGraph();
      const c = comp(g, "C", 2, 0, 0.1e-6);
      const r = comp(g, "R", 6, 0, 1000);
      const ac = comp(g, "AC", 2, 6, 5000);
      const gnd = comp(g, "GND", 8, 6, 0);
      wire(g, ac, 0, c, 0); // AC+ → C.+ (left rail)
      wire(g, c, 1, r, 0); // C.− → R.A (the filtered output)
      wire(g, r, 1, gnd, 0); // R.B → GND (right rail)
      wire(g, ac, 1, gnd, 0); // AC− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place an AC Source (AC), a Capacitor (C), and a Resistor (R).",
        why: "The same parts as the low-pass — but this time the cap is in series and the resistor goes to ground.",
        done: (p) => at(p, "AC") >= 1 && at(p, "C") >= 1 && at(p, "R") >= 1,
      },
      {
        do: "Wire AC+ → C → R → GND, with the C–R junction as the output. Run at a high frequency.",
        why: "Fast wiggles slip through the cap — watch the output track the input.",
        done: (p) => p.complete,
      },
      {
        do: "Flip the demo to a low frequency.",
        why: "Now the cap's Xc is huge and eats the whole swing — the output collapses. A high-pass: it also blocks any steady DC level (AC coupling).",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Sweep high ↔ low",
      on: "5 kHz — well above the 1.6 kHz corner, so the cap passes the output nearly full size.",
      off: "300 Hz — well below the corner, so the cap's huge Xc eats the swing and the output collapses.",
      alt() {
        const g = new BoardGraph();
        const c = comp(g, "C", 2, 0, 0.1e-6);
        const r = comp(g, "R", 6, 0, 1000);
        const ac = comp(g, "AC", 2, 6, 300); // swept down to 300 Hz
        const gnd = comp(g, "GND", 8, 6, 0);
        wire(g, ac, 0, c, 0);
        wire(g, c, 1, r, 0);
        wire(g, r, 1, gnd, 0);
        wire(g, ac, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  {
    id: "ac-resonance",
    name: "Series RLC Resonance",
    blurb:
      "Put R, L and C in one series loop and drive it with AC. The coil's Xl (rising with f) and the cap's Xc (falling with f) cancel at one special frequency f0 = 1/(2π√(LC)). There the impedance collapses to just R and the current peaks — the circuit is tuned, ringing loudest at one note.",
    watch:
      "the loop current and the R voltage. At f0 the current is largest and the source voltage and current are in phase — the reactances have cancelled. The L and C nodes can swing larger than the 5 V source (the Q boost). Detune and the current drops off.",
    build() {
      // Single series loop, same shape as the `rlc` example but driven by AC and
      // hunted for its peak (rather than kicked by a DC step).
      //   nets: N1 = AC.+ = R.A ; N2 = R.B = L.A ; N3 = L.B = C.+ ;
      //         GND(0) = C.− = AC.−.
      // R = 47 Ω, L = 10 mH, C = 1 µF → f0 = 1/(2π√(LC)) ≈ 1.59 kHz. At resonance
      // Xl = Xc ≈ 100 Ω; with R = 47 Ω that's Q ≈ 2 — a clear but not needle-thin
      // peak that keeps the L/C node overshoot on-scope. Default-run at f0.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 47);
      const l = comp(g, "L", 6, 0, 10e-3);
      const c = comp(g, "C", 10, 0, 1e-6);
      const ac = comp(g, "AC", 2, 6, 1600);
      const gnd = comp(g, "GND", 12, 6, 0);
      wire(g, ac, 0, r, 0); // AC+ → R.A (left rail)
      wire(g, r, 1, l, 0); // R.B → L.A
      wire(g, l, 1, c, 0); // L.B → C.+
      wire(g, c, 1, gnd, 0); // C.− → GND (right rail)
      wire(g, ac, 1, gnd, 0); // AC− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place an AC Source (AC), a small Resistor (R), an Inductor (L), and a Capacitor (C).",
        why: "The coil and cap are opposites — together in a loop they fight, and at one frequency they exactly cancel.",
        done: (p) =>
          at(p, "AC") >= 1 &&
          at(p, "R") >= 1 &&
          at(p, "L") >= 1 &&
          at(p, "C") >= 1,
      },
      {
        do: "Wire one series loop AC+ → R → L → C → GND, then Run at the resonant frequency.",
        why: "With Xl and Xc cancelled, only the little R is left — watch the current surge to its maximum and fall in step with the voltage.",
        done: (p) => p.complete,
      },
      {
        do: "Detune with the demo.",
        why: "Move off f0 either way and one reactance wins; the loop impedance climbs and the current dies back. The circuit is tuned — it favours one frequency. f0 = 1/(2π√(LC)).",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Detune",
      on: "1.6 kHz (f0) — Xl and Xc cancel, the current is large and in phase: resonance.",
      off: "800 Hz — well below f0, so Xc dominates, the impedance climbs and the current shrinks and shifts.",
      alt() {
        const g = new BoardGraph();
        const r = comp(g, "R", 2, 0, 47);
        const l = comp(g, "L", 6, 0, 10e-3);
        const c = comp(g, "C", 10, 0, 1e-6);
        const ac = comp(g, "AC", 2, 6, 800); // detuned below f0
        const gnd = comp(g, "GND", 12, 6, 0);
        wire(g, ac, 0, r, 0);
        wire(g, r, 1, l, 0);
        wire(g, l, 1, c, 0);
        wire(g, c, 1, gnd, 0);
        wire(g, ac, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  {
    id: "ac-rectifier",
    name: "Half-Wave Rectifier",
    blurb:
      "A diode is a one-way valve: it passes the positive half-cycles to the load and blocks the negatives, so a symmetric ±5 V sine becomes a train of positive-only humps. The first step of every power supply.",
    watch:
      "input vs output. The input is a full ±5 V sine; the output is positive humps only — the bottom halves sliced off flat at ground, the tops a diode-drop (~0.6 V) below the input peak, so ~4.4 V not 5 V. The current pulses once per period, one direction only.",
    build() {
      // AC → diode → load R to ground; the cathode is the rectified node.
      //   nets: N1 = AC.+ = D.A ; OUT = D.K = R.A ; GND(0) = R.B = AC.−.
      // AC = 200 Hz (fat, easy-to-read humps), R = 1 kΩ. Positive peaks reach
      // ≈ 4.4 V (5 V peak − ~0.6 V Shockley drop, Is = 1e-12 A); negative
      // half-cycles clamp to ~0 V (only −Is leakage). Nonlinear → Newton solve.
      const g = new BoardGraph();
      const d = comp(g, "D", 2, 0, 0);
      const r = comp(g, "R", 6, 0, 1000);
      const ac = comp(g, "AC", 2, 6, 200);
      const gnd = comp(g, "GND", 8, 6, 0);
      wire(g, ac, 0, d, 0); // AC+ → D.A (anode)
      wire(g, d, 1, r, 0); // D.K → R.A (cathode / the rectified node)
      wire(g, r, 1, gnd, 0); // R.B → GND (right rail)
      wire(g, ac, 1, gnd, 0); // AC− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place an AC Source (AC) and a load Resistor (R) to Ground.",
        why: "The alternating source and something to deliver power to. On its own the load would just see the full back-and-forth sine.",
        done: (p) => at(p, "AC") >= 1 && at(p, "R") >= 1,
      },
      {
        do: "Insert a Diode (D) between the source and the load — anode to the source, cathode to the load. Run.",
        why: "The diode only lets current through one way, so it passes the up-swings and blocks the down-swings — watch the output become positive humps with the bottoms cut off. The current pulses one direction only.",
        done: (p) => p.complete,
      },
      {
        do: "Read the peak.",
        why: "The humps top out ~0.6 V below the source peak — the diode's forward drop — so ~4.4 V, not 5 V. It's DC-ish now (always ≥ 0) but very lumpy. The next example smooths it.",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Flip the diode",
      on: "Anode to the source — it passes the positive humps.",
      off: "Reversed (anode to the load) — now it passes the negative humps instead. The valve has a direction.",
      alt() {
        // Swap which diode pins are wired so anode and cathode exchange ends; the
        // valve now conducts on the negative half-cycles.
        //   nets: N1 = AC.+ = D.K ; OUT = D.A = R.A ; GND(0) = R.B = AC.−.
        const g = new BoardGraph();
        const d = comp(g, "D", 2, 0, 0);
        const r = comp(g, "R", 6, 0, 1000);
        const ac = comp(g, "AC", 2, 6, 200);
        const gnd = comp(g, "GND", 8, 6, 0);
        wire(g, ac, 0, d, 1); // AC+ → D.K (cathode now faces the source)
        wire(g, d, 0, r, 0); // D.A → R.A (anode now feeds the load)
        wire(g, r, 1, gnd, 0);
        wire(g, ac, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  {
    id: "ac-supply",
    name: "Smoothed Supply",
    blurb:
      "The finale: add one capacitor across the rectifier's output and the lumps fill in. The cap charges on each hump's peak and holds the voltage up through the gap, until the next hump tops it back up. A roughly steady DC rail with a little ripple — a tiny power supply.",
    watch:
      "the output node. Where the bare rectifier dropped to zero between humps, the cap now lifts the valleys: it climbs to each peak (~4.4 V) then sags only gently, a shallow sawtooth. The diode current changes to short, tall spikes at each peak.",
    build() {
      // The half-wave rectifier with a smoothing cap added across the load —
      // mirrors how `buck` adds its output cap last.
      //   nets: N1 = AC.+ = D.A ; OUT = D.K = R.A = C.+ ;
      //         GND(0) = R.B = C.− = AC.−.
      // AC = 200 Hz (5 ms period), R = 1 kΩ, C = 22 µF → load time constant
      // R·C = 22 ms ≫ the period, so the cap holds well between humps (strong
      // smoothing, a few hundred mV of ripple on a ~4 V rail).
      const g = new BoardGraph();
      const d = comp(g, "D", 2, 0, 0);
      const r = comp(g, "R", 6, 0, 1000);
      const c = comp(g, "C", 10, 0, 22e-6);
      const ac = comp(g, "AC", 2, 6, 200);
      const gnd = comp(g, "GND", 12, 6, 0);
      wire(g, ac, 0, d, 0); // AC+ → D.A (anode)
      wire(g, d, 1, r, 0); // D.K → R.A (the rectified output)
      wire(g, d, 1, c, 0); // D.K → C.+ (reservoir cap ∥ the load)
      wire(g, r, 1, gnd, 0); // R.B → GND
      wire(g, c, 1, gnd, 0); // C.− → GND
      wire(g, ac, 1, gnd, 0); // AC− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Start from the half-wave rectifier: AC → D → R → GND. Run.",
        why: "Recall the lumpy positive-only humps — usable as DC, but it drops to zero between every one. We're going to fill those gaps.",
        done: (p) =>
          at(p, "AC") >= 1 &&
          at(p, "D") >= 1 &&
          at(p, "R") >= 1 &&
          p.wires >= 4,
      },
      {
        do: "Add a Capacitor (C) across the load (output to ground). Run again.",
        why: "The cap stores charge at each peak and feeds the load during the gaps — watch the valleys lift and the output settle into a nearly steady rail with a little ripple.",
        done: (p) => at(p, "C") >= 1 && p.complete,
      },
      {
        do: "Note the ripple.",
        why: "The bigger the cap (or the lighter the load), the flatter the rail — ripple ∝ 1/(f·R·C). You've turned AC into DC: a tiny power supply.",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Lift the smoothing cap",
      on: "Cap in place — it bridges the gaps into a nearly flat DC rail with a little ripple.",
      off: "Cap lifted — back to the bare rectifier's positive humps, dropping to zero between each one.",
      alt() {
        // Omit the reservoir cap, returning to the bare half-wave rectifier.
        const g = new BoardGraph();
        const d = comp(g, "D", 2, 0, 0);
        const r = comp(g, "R", 6, 0, 1000);
        const ac = comp(g, "AC", 2, 6, 200);
        const gnd = comp(g, "GND", 8, 6, 0);
        wire(g, ac, 0, d, 0);
        wire(g, d, 1, r, 0);
        wire(g, r, 1, gnd, 0);
        wire(g, ac, 1, gnd, 0);
        // C intentionally omitted — the smoothing reservoir is lifted out.
        return g.serialize();
      },
    },
  },
];

/** Display order of example categories for the collapsible browser. */
export const EXAMPLE_CATEGORIES = [
  "Fundamentals",
  "Sources & Current",
  "Capacitors & Inductors",
  "Diodes",
  "Power & Switching",
  "AC Fundamentals",
  "Reactance",
  "Filters",
  "Resonance",
  "Rectification",
];

/** Which category each example belongs to, keyed by id. */
export const EXAMPLE_CATEGORY: Record<string, string> = {
  primer: "Fundamentals",
  divider: "Fundamentals",
  parallel: "Sources & Current",
  isource: "Sources & Current",
  rc: "Capacitors & Inductors",
  rl: "Capacitors & Inductors",
  rlc: "Capacitors & Inductors",
  "diode-clamp": "Diodes",
  buck: "Power & Switching",
  "pwm-average": "Power & Switching",
  "ac-resistor": "AC Fundamentals",
  "ac-rms": "AC Fundamentals",
  "ac-cap": "Reactance",
  "ac-ind": "Reactance",
  "ac-lowpass": "Filters",
  "ac-highpass": "Filters",
  "ac-resonance": "Resonance",
  "ac-rectifier": "Rectification",
  "ac-supply": "Rectification",
};

/** The category an example belongs to (falls back to "Other"). */
export function categoryOf(id: string): string {
  return EXAMPLE_CATEGORY[id] ?? "Other";
}

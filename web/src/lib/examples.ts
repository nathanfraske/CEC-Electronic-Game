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
      // node when the switch opens; C + R load smooth and draw the output. The
      // forward path SW→L runs straight along the top rail; Vin / D / C / R are
      // placed vertical so each rail reads top-to-bottom, and the freewheel diode
      // drops straight to the ground directly beneath the switch node.
      const g = new BoardGraph();
      const vin = comp(g, "V", 0, 0, 10, 1); // vertical, + at top
      const sw = comp(g, "SW", 2, 0, 0.4); // 40% duty
      const d = comp(g, "D", 6, 2, 0, 3); // freewheel: anode low, cathode up
      const l = comp(g, "L", 10, 0, 1e-3);
      const c = comp(g, "C", 14, 0, 22e-6, 1);
      const r = comp(g, "R", 16, 0, 100, 1);
      const gnd = comp(g, "GND", 6, 5, 0); // directly below the freewheel diode
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
    id: "ec-decoupling",
    name: "Electrolytic Decoupling",
    blurb:
      "A half-wave rectified supply feeding a load, with a big electrolytic capacitor across it to smooth the ripple. The electrolytic stores charge at each hump's peak and feeds the load through the gaps — a roughly steady DC rail. But its real series resistance (ESR) drops a little voltage on every charging surge, which is exactly why a real cap can never flatten the ripple completely.",
    watch:
      "the output settle into a nearly steady rail (~4 V) with a shallow sawtooth ripple, instead of the bare rectifier's drop-to-zero humps. Compare with the ideal RC cap: the electrolytic's ESR adds a small extra wobble on each refill spike — a perfectly flat rail isn't free.",
    build() {
      // The half-wave rectifier with a bulk electrolytic (EC) across the load.
      // Same shape as `ac-supply` but with a real-ESR electrolytic in place of the
      // ideal ceramic, so the ESR's effect on ripple is the lesson.
      //   nets: N1 = AC.+ = D.A ; OUT = D.K = R.A = EC.+ ;
      //         GND(0) = R.B = EC.− = AC.−.
      // AC = 200 Hz (5 ms period), R = 1 kΩ, EC = 100 µF → load time constant
      // R·C = 100 ms ≫ the period, so the cap holds well between humps. Peaks reach
      // ≈ 4.4 V (5 V peak − ~0.6 V diode drop). The EC expands to an ideal 100 µF
      // cap in series with a 0.5 Ω ESR; the tall refill spikes (≫ the ~4.4 mA load)
      // push a small IR drop across that ESR — visible ripple the ideal cap lacks.
      // The rectified output runs along the top rail; the load R and the reservoir
      // EC hang as vertical rungs down to the ground rail, the electrolytic dropping
      // straight to GND so its smoothing path reads cleanly top-to-bottom.
      const g = new BoardGraph();
      const d = comp(g, "D", 2, 0, 0);
      const r = comp(g, "R", 8, 0, 1000, 1); // vertical load rung
      const ec = comp(g, "EC", 12, 0, 100e-6, 1); // vertical reservoir rung
      const ac = comp(g, "AC", 2, 6, 200);
      const gnd = comp(g, "GND", 12, 6, 0); // straight below the electrolytic
      wire(g, ac, 0, d, 0); // AC+ → D.A (anode)
      wire(g, d, 1, r, 0); // D.K → R.A (the rectified output)
      wire(g, d, 1, ec, 0); // D.K → EC.+ (reservoir electrolytic ∥ the load)
      wire(g, r, 1, gnd, 0); // R.B → GND
      wire(g, ec, 1, gnd, 0); // EC.− → GND
      wire(g, ac, 1, gnd, 0); // AC− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Build a half-wave rectifier first: AC (200 Hz) → Diode (D) → load Resistor (R) → GND, and AC− → GND. Run.",
        why: "Recall the lumpy positive-only humps that drop to zero between each one — usable as DC, but far too rough to power anything.",
        done: (p) =>
          at(p, "AC") >= 1 &&
          at(p, "D") >= 1 &&
          at(p, "R") >= 1 &&
          p.wires >= 4,
      },
      {
        do: "Add an Electrolytic Cap (EC) across the load (output to ground). Run again.",
        why: "The big electrolytic charges at each peak and holds the rail up through the gaps — watch the valleys lift into a nearly steady ~4 V rail with only a shallow ripple.",
        done: (p) => at(p, "EC") >= 1 && p.complete,
      },
      {
        do: "Select the electrolytic and read its ESR row in the Info panel.",
        why: "A real electrolytic has a small series resistance (ESR). On every charging surge that ESR drops a little voltage, so the rail can't be perfectly flat — bigger C and lower ESR both shrink the ripple, which is the whole engineering game in a power-supply filter.",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Lift the electrolytic",
      on: "Electrolytic in place — it bridges the gaps into a nearly flat DC rail with a little ripple.",
      off: "Electrolytic lifted — back to the bare rectifier's positive humps, dropping to zero between each one.",
      alt() {
        // Omit the reservoir electrolytic, returning to the bare half-wave rectifier.
        // The load R and GND keep the main build's cells, so toggling the
        // electrolytic only adds/removes it — nothing else jumps.
        const g = new BoardGraph();
        const d = comp(g, "D", 2, 0, 0);
        const r = comp(g, "R", 8, 0, 1000, 1); // vertical load rung (unchanged cell)
        const ac = comp(g, "AC", 2, 6, 200);
        const gnd = comp(g, "GND", 12, 6, 0);
        wire(g, ac, 0, d, 0);
        wire(g, d, 1, r, 0);
        wire(g, r, 1, gnd, 0);
        wire(g, ac, 1, gnd, 0);
        // EC intentionally omitted — the smoothing reservoir is lifted out.
        return g.serialize();
      },
    },
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
      // Vin feeds SW along the top rail; the pull-down hangs straight down through
      // node X to ground, while R carries the chopped square on to the output cap.
      const g = new BoardGraph();
      const vin = comp(g, "V", 0, 0, 10, 1); // vertical, + at top
      const sw = comp(g, "SW", 2, 0, 0.3); // 30% duty
      const rpd = comp(g, "R", 4, 2, 100, 1); // vertical pull-down, in-line under X
      const r = comp(g, "R", 6, 0, 1000);
      const c = comp(g, "C", 10, 0, 1e-6, 1); // vertical output cap
      const gnd = comp(g, "GND", 4, 6, 0); // below the pull-down / node X
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
      const gnd = comp(g, "GND", 8, 6, 0); // below D.K so the clamp drops straight
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
        const gnd = comp(g, "GND", 8, 6, 0); // same cell as the main build
        wire(g, v, 0, r, 0);
        wire(g, r, 1, d, 0); // R.B → D.A keeps the node fed
        wire(g, v, 1, gnd, 0); // V− → GND keeps the reference
        // D.K intentionally left unconnected — the clamp is lifted, node floats.
        return g.serialize();
      },
    },
  },
  {
    id: "led-limit",
    name: "LED Current-Limiting",
    blurb:
      "The classic first build: a 5 V source, a series resistor, and an LED. The resistor is what keeps the LED alive — it soaks up the rail left over after the LED's ~1.9 V drop and sets the current (and so the brightness). Pick R wrong and the LED is either dark or fried.",
    watch:
      "the LED light up, and the resistor's job: the rail drops ~1.9 V across the LED and the remaining ~3.1 V across R, setting ~20 mA. Watch the current and the LED's glow rise together — brightness tracks current.",
    build() {
      // V → R → LED → GND. R = 150 Ω with a 5 V rail and a ~1.9 V LED gives
      // (5 − 1.9)/150 ≈ 21 mA — right in the ~10–20 mA band where a standard LED
      // is bright but safe. The LED makes the loop nonlinear (Newton solve).
      //   nets: N1 = V+ = R.A ; N2 = R.B = LED.A ; GND(0) = LED.K = V−.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 150);
      const led = comp(g, "LED", 6, 0, 0); // anode A → cathode K (value unused)
      const v = comp(g, "V", 2, 6, 5);
      const gnd = comp(g, "GND", 8, 6, 0);
      wire(g, v, 0, r, 0); // V+ → R.A (left rail)
      wire(g, r, 1, led, 0); // R.B → LED.A (the LED's anode)
      wire(g, led, 1, gnd, 0); // LED.K → GND (right rail)
      wire(g, v, 1, gnd, 0); // V− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V) and a Resistor (R, ~150 Ω).",
        why: "The 5 V rail will drive the LED, but an LED has almost no resistance of its own once it conducts — without R to limit the current it would draw a destructive spike. R is the safety valve.",
        done: (p) => at(p, "V") >= 1 && at(p, "R") >= 1,
      },
      {
        do: "Place an LED and a Ground (GND). Wire V+ → R → LED anode → LED cathode → GND, and V− → GND. Then press Run.",
        why: "Watch the LED light up. The rail splits: ~1.9 V across the LED (its fixed forward drop) and the rest across R, which sets the current at ~20 mA. The glow tracks that current.",
        done: (p) => at(p, "LED") >= 1 && p.complete,
      },
      {
        do: "Select the resistor and try a bigger value, then a smaller one.",
        why: "Bigger R → less current → dimmer LED; smaller R → more current → brighter (and eventually too much). The LED's voltage barely moves — it's R that sets the operating point.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "manual-switch-led",
    name: "Manual Switch + LED",
    blurb:
      "The first thing every switch does: make and break a loop. A 5 V source drives an LED through a current-limiting resistor, and a manual switch sits in series with the load. Closed, the switch is a near-ideal wire — the loop is complete and the LED lights. Open, it's a break in the circuit — no current can flow and the LED goes dark. Click the switch to flip it.",
    watch:
      "the LED while you click the switch. Closed completes the loop and ~20 mA flows, lighting the LED; open breaks the loop and the current — and the light — drop to zero. The switch either is the wire or it isn't.",
    build() {
      // V → R → LED → MSW → GND. Same current-limited LED branch as the LED
      // example, with a manual switch in series with the load to make/break it.
      // Default CLOSED (value 1): the loop is complete, so I ≈ (5 − 1.9)/150 ≈
      // 21 mA and the LED is lit. Flip the switch open (value 0) to break it.
      //   nets: N1 = V+ = R.A ; N2 = R.B = LED.A ; N3 = LED.K = MSW.A ;
      //         GND(0) = MSW.B = V−.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 150);
      const led = comp(g, "LED", 6, 0, 0); // anode A → cathode K (value unused)
      const msw = comp(g, "MSW", 10, 0, 1); // value 1 = closed (the wire is made)
      const v = comp(g, "V", 2, 6, 5);
      const gnd = comp(g, "GND", 10, 6, 0);
      wire(g, v, 0, r, 0); // V+ → R.A (left rail)
      wire(g, r, 1, led, 0); // R.B → LED.A (the LED's anode)
      wire(g, led, 1, msw, 0); // LED.K → MSW.A
      wire(g, msw, 1, gnd, 0); // MSW.B → GND (right rail)
      wire(g, v, 1, gnd, 0); // V− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V, 5 V), a Resistor (R, ~150 Ω), and an LED.",
        why: "This is the load branch: the 5 V rail drives the LED, and R limits the current so the LED is bright but safe (~20 mA).",
        done: (p) => at(p, "V") >= 1 && at(p, "R") >= 1 && at(p, "LED") >= 1,
      },
      {
        do: "Place a Manual Switch (MSW) and a Ground (GND). Wire V+ → R → LED → MSW → GND, and V− → GND. Then press Run.",
        why: "The switch starts closed, so the loop is complete: current flows and the LED lights. The closed switch is just a wire in the path.",
        done: (p) => at(p, "MSW") >= 1 && at(p, "LED") >= 1 && p.complete,
      },
      {
        do: "Click the manual switch to open it, then click again to close it.",
        why: "Open, the switch is a break — no current flows and the LED is dark. Close it and the loop is whole again and the LED relights. That make-or-break is the whole job of a switch.",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Switch closed / open",
      on: "Switch CLOSED — the loop is complete, current flows and the LED is lit.",
      off: "Switch OPEN — the loop is broken: no current, the LED is dark.",
      alt() {
        // Same board, but the manual switch is open (value 0): the loop is broken,
        // so no current flows and the LED is dark.
        const g = new BoardGraph();
        const r = comp(g, "R", 2, 0, 150);
        const led = comp(g, "LED", 6, 0, 0);
        const msw = comp(g, "MSW", 10, 0, 0); // value 0 = open (the break)
        const v = comp(g, "V", 2, 6, 5);
        const gnd = comp(g, "GND", 10, 6, 0);
        wire(g, v, 0, r, 0);
        wire(g, r, 1, led, 0);
        wire(g, led, 1, msw, 0);
        wire(g, msw, 1, gnd, 0);
        wire(g, v, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  {
    id: "schottky-vs-silicon",
    name: "Schottky vs Silicon",
    blurb:
      "Two diodes, same drive, side by side: a silicon diode and a Schottky. Both pass the same current through identical resistors, but the Schottky's metal–semiconductor junction conducts at about half the voltage — ~0.3 V versus silicon's ~0.7 V.",
    watch:
      "the two cathode nodes: the Schottky branch sits noticeably lower than the silicon branch. Same current, less drop — that lower forward voltage is the Schottky's whole advantage (less wasted power).",
    build() {
      // One source feeds two parallel branches, each a 1 kΩ series R into a diode
      // to ground — silicon on the left, Schottky on the right — so the two
      // forward drops read off directly against each other. Both nonlinear.
      //   left:  N1 = V+ = R1.A ; ND = R1.B = D.A ; GND(0) = D.K
      //   right: N1 = V+ = R2.A ; NS = R2.B = SD.A ; GND(0) = SD.K = V−
      const g = new BoardGraph();
      const r1 = comp(g, "R", 2, 0, 1000); // silicon branch (left)
      const d = comp(g, "D", 6, 0, 0);
      const r2 = comp(g, "R", 2, 3, 1000); // Schottky branch (right)
      const sd = comp(g, "SD", 6, 3, 0);
      const v = comp(g, "V", 2, 6, 5);
      const gnd = comp(g, "GND", 8, 6, 0);
      wire(g, v, 0, r1, 0); // V+ → R1.A
      wire(g, r1, 1, d, 0); // R1.B → D.A (silicon)
      wire(g, d, 1, gnd, 0); // D.K → GND
      wire(g, v, 0, r2, 0); // V+ → R2.A (same rail)
      wire(g, r2, 1, sd, 0); // R2.B → SD.A (Schottky)
      wire(g, sd, 1, gnd, 0); // SD.K → GND
      wire(g, v, 1, gnd, 0); // V− → GND (reference)
      return g.serialize();
    },
    steps: [
      {
        do: "Build the silicon branch first: V+ → R (1 kΩ) → Diode (D) → GND, and V− → GND. Run.",
        why: "A reference reading: note the diode's cathode parks about 0.7 V below where the resistor feeds it — that's silicon's forward drop.",
        done: (p) =>
          at(p, "V") >= 1 && at(p, "R") >= 1 && at(p, "D") >= 1 && p.wires >= 4,
      },
      {
        do: "Add a parallel Schottky branch: V+ → a second R (1 kΩ) → Schottky Diode (SD) → GND. Run again.",
        why: "Same rail, same resistor, same current — but watch the Schottky's node sit lower, near 0.3 V. Its large saturation current lets it conduct at half the voltage.",
        done: (p) => at(p, "SD") >= 1 && at(p, "R") >= 2 && p.complete,
      },
      {
        do: "Compare the two drops.",
        why: "~0.3 V vs ~0.7 V at the same current means the Schottky wastes less power — which is exactly why it's the catch diode in switching regulators.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "zener-shunt",
    name: "Zener Shunt Reference",
    blurb:
      "The classic regulator: a 12 V supply feeds a resistor into a Zener diode to ground. Reverse-biased, the Zener won't conduct until the node reaches its breakdown voltage Vz — then it conducts hard and pins the node right there. The resistor soaks up the difference, so the output holds near Vz (5.1 V) even though the supply is more than double that.",
    watch:
      "the output node clamp at ~5.1 V, far below the 12 V rail — the Zener's breakdown voltage. The resistor drops the remaining ~6.9 V, and that ~6.9 mA shunts straight down through the Zener to ground.",
    build() {
      // V → R → node N; the Zener shunts N to ground (cathode K at N, anode A at
      // GND), so N reverse-biases it and is clamped at Vz. Mirrors the sim-core
      // `zener_clamps_reverse_voltage` test exactly. The Zener is drawn vertically,
      // cathode-up (rot 3): R feeds the cathode along the top rail and the anode
      // drops straight to ground — the textbook shunt-reference orientation.
      //   nets: N1 = V+ = R.A ; N = R.B = ZD.K ; GND(0) = ZD.A = V−.
      // Hand-check: the Zener holds N ≈ Vz = 5.1 V, so I = (12 − 5.1)/1kΩ ≈ 6.9 mA
      // flows through R and sinks into the Zener (KCL). Nonlinear → Newton solve.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 1000);
      const zd = comp(g, "ZD", 6, 2, 5.1, 3); // value = Vz; vertical, cathode up
      const v = comp(g, "V", 2, 6, 12);
      const gnd = comp(g, "GND", 6, 6, 0); // directly below the Zener's anode
      wire(g, v, 0, r, 0); // V+ → R.A (left rail)
      wire(g, r, 1, zd, 1); // R.B → ZD.K (the regulated node N)
      wire(g, zd, 0, gnd, 0); // ZD.A → GND (Zener shunts the excess to 0 V)
      wire(g, v, 1, gnd, 0); // V− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V, 12 V) and a Resistor (R, ~1 kΩ).",
        why: "The 12 V rail is well above the voltage we want. R is the series element that will drop the excess once the Zener starts clamping.",
        done: (p) => at(p, "V") >= 1 && at(p, "R") >= 1,
      },
      {
        do: "Place a Zener Diode (ZD) and a Ground (GND). Wire V+ → R → the Zener's CATHODE, the Zener's ANODE → GND, and V− → GND. Then press Run.",
        why: "The node reverse-biases the Zener. Below Vz it blocks, so the node would float toward 12 V — but the moment it reaches ~5.1 V the Zener conducts hard and refuses to let it climb further. Watch the node pin at Vz while the rest drops across R.",
        done: (p) => at(p, "ZD") >= 1 && p.complete,
      },
      {
        do: "Select the Zener and try a different Vz (e.g. 6.2 V or 9.1 V).",
        why: "The regulated node tracks whatever Vz you pick — that's the whole point of a shunt reference. The supply can wander; the Zener holds the output.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "surge-clamp",
    name: "Varistor Surge Clamp",
    blurb:
      "The surge protector in every power strip: a varistor (MOV) wired across the line. A 36 V 'spike' feeds a series resistor into the MOV to ground. Below its clamp voltage Vc the MOV is nearly an open circuit, so the node would float to the full supply — but the instant it reaches Vc (18 V) the MOV conducts hard and pins the node there, sinking the surge's energy through itself. Lift it out and the node swings all the way to 36 V.",
    watch:
      "the node clamp at ~18 V, only half the 36 V spike — the MOV's clamp voltage Vc. The resistor drops the remaining ~18 V, and that ~18 mA dumps straight down through the MOV to ground. Toggle the MOV out and watch the node leap to the full, un-clamped 36 V.",
    build() {
      // V → R → node N; the MOV shunts N to ground, so N is clamped near +Vc. The
      // varistor is symmetric (it would clamp a negative spike to −Vc just the
      // same), drawn vertically (rot 3) so R feeds it along the top rail and it
      // drops straight to ground — the across-the-line surge-protector orientation.
      //   nets: N1 = V+ = R.A ; N = R.B = MOV.B ; GND(0) = MOV.A = V−.
      // Hand-check: the MOV holds N ≈ Vc = 18 V (the positive-side breakdown
      // junction I = MOV_IK·exp((V−Vc)/MOV_VTH) reaches the ~18 mA load at V ≈
      // 18.1 V), so I = (36 − 18)/1kΩ ≈ 18 mA flows through R and sinks into the
      // MOV (KCL). Nonlinear → Newton solve. Stamps type 16, c = 0, aux = 0.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 1000);
      const mov = comp(g, "MOV", 6, 2, 18, 3); // value = Vc; vertical
      const v = comp(g, "V", 2, 6, 36);
      const gnd = comp(g, "GND", 6, 6, 0); // directly below the varistor
      wire(g, v, 0, r, 0); // V+ → R.A (left rail)
      wire(g, r, 1, mov, 1); // R.B → MOV.B (the clamped node N)
      wire(g, mov, 0, gnd, 0); // MOV.A → GND (varistor shunts the surge to 0 V)
      wire(g, v, 1, gnd, 0); // V− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V, 36 V) and a Resistor (R, ~1 kΩ).",
        why: "Treat the 36 V rail as the incoming spike. R is the series element that will drop the excess once the varistor starts clamping (a real surge has source impedance; R stands in for it).",
        done: (p) => at(p, "V") >= 1 && at(p, "R") >= 1,
      },
      {
        do: "Place a Varistor (MOV) and a Ground (GND). Wire V+ → R → the MOV, the MOV's other end → GND, and V− → GND. Then press Run.",
        why: "Below Vc the MOV barely conducts, so the node would float toward 36 V — but the moment it reaches ~18 V the MOV conducts hard and refuses to let it climb. Watch the node pin at Vc while the rest drops across R, the surge current dumping to ground.",
        done: (p) => at(p, "MOV") >= 1 && p.complete,
      },
      {
        do: "Select the varistor and try a different clamp Vc (e.g. 24 V or 36 V).",
        why: "The clamped node tracks Vc. Raise Vc above the spike and the MOV never conducts — the node rides the full rail. The MOV only earns its keep when the surge exceeds what the load can take.",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Varistor → ground",
      on: "Varistor in place — it clamps the node near its clamp voltage, ~18 V, half the spike.",
      off: "Varistor lifted — nothing shunts the node, so it floats up to the full, un-clamped 36 V spike.",
      alt() {
        const g = new BoardGraph();
        const r = comp(g, "R", 2, 0, 1000);
        const mov = comp(g, "MOV", 6, 2, 18, 3); // same cell as the main build
        const v = comp(g, "V", 2, 6, 36);
        const gnd = comp(g, "GND", 6, 6, 0);
        wire(g, v, 0, r, 0); // V+ → R.A keeps the node fed
        wire(g, r, 1, mov, 1); // R.B → MOV.B keeps the node where it was
        wire(g, v, 1, gnd, 0); // V− → GND keeps the reference
        // MOV.A intentionally left unconnected — the clamp is lifted, node floats.
        return g.serialize();
      },
    },
  },
  {
    id: "led-series",
    name: "Two LEDs in Series",
    blurb:
      "Stack two LEDs in one series string off a 9 V rail through a single resistor. Forward voltage drops add, so the two LEDs together drop ~3.8 V (about 1.9 V each) — and because they share one loop they carry the exact same current, so they light equally bright.",
    watch:
      "both LEDs light up together at the same brightness — one current, one string. The rail splits ~1.9 V + ~1.9 V across the two LEDs and the remaining ~5.2 V across R, setting ~19 mA.",
    build() {
      // V → R → LED1 → LED2 → GND. Two ~1.9 V forward drops in series = ~3.8 V;
      // with a 9 V rail and R = 270 Ω the current is (9 − 3.8)/270 ≈ 19 mA — right
      // in the safe ~20 mA band. Both LEDs see the same series current.
      //   nets: N1 = V+ = R.A ; N2 = R.B = LED1.A ; N3 = LED1.K = LED2.A ;
      //         GND(0) = LED2.K = V−.
      const g = new BoardGraph();
      const r = comp(g, "R", 2, 0, 270);
      const led1 = comp(g, "LED", 6, 0, 0);
      const led2 = comp(g, "LED", 10, 0, 0);
      const v = comp(g, "V", 2, 6, 9);
      const gnd = comp(g, "GND", 12, 6, 0);
      wire(g, v, 0, r, 0); // V+ → R.A (left rail)
      wire(g, r, 1, led1, 0); // R.B → LED1.A
      wire(g, led1, 1, led2, 0); // LED1.K → LED2.A (the series joint)
      wire(g, led2, 1, gnd, 0); // LED2.K → GND (right rail)
      wire(g, v, 1, gnd, 0); // V− → GND (reference, bottom rail)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V, 9 V) and a Resistor (R, ~270 Ω).",
        why: "One resistor will limit the current for the whole string — in a series chain there's only one current to set.",
        done: (p) => at(p, "V") >= 1 && at(p, "R") >= 1,
      },
      {
        do: "Place TWO LEDs and a Ground (GND). Wire V+ → R → LED1 → LED2 → GND, and V− → GND. Then press Run.",
        why: "Watch both LEDs light at once, equally bright — the same current runs through both. The two forward drops add (~1.9 V + ~1.9 V), so R only has to drop what's left of the 9 V rail.",
        done: (p) => at(p, "LED") >= 2 && p.complete,
      },
      {
        do: "Note why a 9 V rail (not 5 V) is needed.",
        why: "Two LEDs need ~3.8 V just to turn on, plus headroom across R to set the current. Stack too many for the rail and none of them light — the drops have to fit under the supply.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "mosfet-switch",
    name: "MOSFET as a Switch",
    blurb:
      "A logic-level signal on the gate switches an LED hard on and off. The N-MOSFET sits in the low side of the load: drive the gate above its ~2 V threshold and the channel turns on, completing the loop so the LED lights; drop the gate to 0 V and the channel cuts off, so no current flows and the LED goes dark. The gate itself draws no current — a tiny control voltage commands the whole load.",
    watch:
      "the LED light up while the gate is high and the MOSFET pulls its drain down near 0 V (a closed switch). Flip the gate low and watch it snap off — cutoff, no current, the drain released. The gate sources nothing either way.",
    build() {
      // VDD → R (current limit) → LED → NMOS.drain ; NMOS.source → GND ; a second
      // source Vg drives the gate. Gate HIGH (5 V > VTO ≈ 2 V) → the FET is on, the
      // loop closes, the LED lights at ~18 mA and the drain sits ~0.3 V (a closed
      // switch). The LED makes the loop nonlinear; the FET adds the Newton MOSFET.
      //   nets: N1 = VDD+ = R.A ; N2 = R.B = LED.A ; N3 = LED.K = NM.drain ;
      //         GND(0) = NM.source = VDD− = Vg− ; NG = Vg+ = NM.gate.
      // Hand-check (gate high): in the on state the NMOS in triode drops ~0.3 V, so
      // I ≈ (5 − 1.9(LED) − 0.3)/150 ≈ 18 mA — bright, safe. Gate low → cutoff, I≈0.
      const g = new BoardGraph();
      const vdd = comp(g, "V", 0, 0, 5, 1); // vertical 5 V rail, + at top
      const r = comp(g, "R", 2, 0, 150); // LED current-limit
      const led = comp(g, "LED", 6, 0, 0); // the switched load
      const nm = comp(g, "NM", 10, 0, 0, 0); // low-side switch (D top, S bottom)
      const vg = comp(g, "V", 6, 6, 5); // the gate drive (HIGH = on)
      const gnd = comp(g, "GND", 10, 6, 0);
      wire(g, vdd, 0, r, 0); // VDD+ → R.A
      wire(g, r, 1, led, 0); // R.B → LED.A
      wire(g, led, 1, nm, 0); // LED.K → NM.drain (pin 0)
      wire(g, nm, 1, gnd, 0); // NM.source (pin 1) → GND
      wire(g, vg, 0, nm, 2); // Vg+ → NM.gate (pin 2)
      wire(g, vg, 1, gnd, 0); // Vg− → GND
      wire(g, vdd, 1, gnd, 0); // VDD− → GND (reference)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V, 5 V), a series Resistor (R, ~150 Ω), and an LED — the load that will switch.",
        why: "This is the load branch the transistor will make or break. The resistor limits the LED current once the loop is completed.",
        done: (p) => at(p, "V") >= 1 && at(p, "R") >= 1 && at(p, "LED") >= 1,
      },
      {
        do: "Place an N-MOSFET (NM) below the LED, a second Voltage Source (V) for the gate, and a Ground. Wire VDD+ → R → LED → MOSFET DRAIN, MOSFET SOURCE → GND, gate source → MOSFET GATE, and both source −'s → GND. Set the gate source to 5 V and press Run.",
        why: "The gate sits above the ~2 V threshold, so the channel turns on and completes the loop. Watch the LED light up and the MOSFET's drain drop near 0 V — a closed switch — while ~18 mA flows. Notice the gate lead carries no current of its own.",
        done: (p) => at(p, "NM") >= 1 && at(p, "V") >= 2 && p.complete,
      },
      {
        do: "Select the gate source and set it to 0 V (or use the toggle below).",
        why: "Now Vgs is below threshold: the channel cuts off, no current can flow, and the LED goes dark. A voltage that costs nothing to hold has switched the whole load off.",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Gate high / low",
      on: "Gate HIGH (5 V) — the channel is on, the loop closes and the LED lights.",
      off: "Gate LOW (0 V) — below threshold, the channel cuts off: no current, the LED is dark.",
      alt() {
        // Same board, but the gate source is 0 V: Vgs < VTO → cutoff, LED off.
        const g = new BoardGraph();
        const vdd = comp(g, "V", 0, 0, 5, 1);
        const r = comp(g, "R", 2, 0, 150);
        const led = comp(g, "LED", 6, 0, 0);
        const nm = comp(g, "NM", 10, 0, 0, 0);
        const vg = comp(g, "V", 6, 6, 0); // gate driven LOW
        const gnd = comp(g, "GND", 10, 6, 0);
        wire(g, vdd, 0, r, 0);
        wire(g, r, 1, led, 0);
        wire(g, led, 1, nm, 0);
        wire(g, nm, 1, gnd, 0);
        wire(g, vg, 0, nm, 2);
        wire(g, vg, 1, gnd, 0);
        wire(g, vdd, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  {
    id: "mosfet-cs-amp",
    name: "Common-Source Amplifier",
    blurb:
      "An N-MOSFET biased in saturation, with a drain resistor, makes a voltage amplifier. A small change on the gate makes a much larger, inverted change at the drain — the transconductance gm turns gate volts into drain current, and the drain resistor turns that current back into volts. This gain-from-a-controlled-current is what a transistor is for.",
    watch:
      "the drain settle around 3.9 V (not the 5 V rail) — the device is in saturation, sinking ~11 mA through the 100 Ω drain resistor. Nudge the gate bias up a little and the drain swings down much harder: that ratio is the voltage gain, and it inverts.",
    build() {
      // The textbook common-source stage, matching the sim-core
      // `nmos_saturation_operating_point_matches_square_law` layout:
      //   VDD(5 V) → RD(100 Ω) → NM.drain (the output) ; NM.source → GND ;
      //   gate bias Vgg(3 V) → NM.gate ; all −'s → GND.
      //   nets: N1 = VDD+ = RD.A ; OUT = RD.B = NM.drain ;
      //         GND(0) = NM.source = VDD− = Vgg− ; NG = Vgg+ = NM.gate.
      // Hand-check: Vgg = 3 V ⇒ Vov = Vgg − VTO = 1 V (saturation, Vds ≥ Vov).
      // Id ≈ ½·KP·Vov²·(1+λ·Vds) ≈ 0.01·(1+0.02·3.9) ≈ 10.8 mA, and
      // Vds = 5 − Id·100 ≈ 3.9 V — the drain parks well below the rail. The
      // small-signal gain is −gm·(RD‖ro) ≈ −0.0216·98 ≈ −2.1 (inverting). Nonlinear
      // → the MOSFET Newton path runs.
      const g = new BoardGraph();
      const vdd = comp(g, "V", 0, 0, 5, 1); // vertical 5 V rail, + at top
      const rd = comp(g, "R", 2, 0, 100); // drain resistor (the load)
      const nm = comp(g, "NM", 6, 0, 0, 0); // common-source device
      const vgg = comp(g, "V", 6, 6, 3); // the gate bias (3 V → saturation)
      const gnd = comp(g, "GND", 6, 4, 0);
      wire(g, vdd, 0, rd, 0); // VDD+ → RD.A
      wire(g, rd, 1, nm, 0); // RD.B → NM.drain (pin 0) — the output node
      wire(g, nm, 1, gnd, 0); // NM.source (pin 1) → GND
      wire(g, vgg, 0, nm, 2); // Vgg+ → NM.gate (pin 2)
      wire(g, vgg, 1, gnd, 0); // Vgg− → GND
      wire(g, vdd, 1, gnd, 0); // VDD− → GND (reference)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V, 5 V) for the rail and a drain Resistor (R, ~100 Ω).",
        why: "The drain resistor is what converts the transistor's drain current back into an output voltage — no load resistor, no voltage gain.",
        done: (p) => at(p, "V") >= 1 && at(p, "R") >= 1,
      },
      {
        do: "Place an N-MOSFET (NM), a second Voltage Source (V) for the gate bias, and a Ground. Wire VDD+ → R → MOSFET DRAIN, MOSFET SOURCE → GND, gate source → MOSFET GATE, both source −'s → GND. Set the gate bias to ~3 V and press Run.",
        why: "A 3 V gate sits 1 V above threshold and puts the device in saturation. Watch the drain settle near 3.9 V — pulled below the rail because the transistor is steadily sinking ~11 mA through the drain resistor. That's the bias point an amplifier swings around.",
        done: (p) => at(p, "NM") >= 1 && at(p, "V") >= 2 && p.complete,
      },
      {
        do: "Select the gate source and nudge its voltage up a little, then back down.",
        why: "A small gate change moves the drain current (gm = dId/dVgs), and the drain resistor turns that into a larger, inverted voltage swing at the output — the gain is roughly −gm·RD. A little push on the gate, a big swing at the drain: that's amplification.",
        done: (p) => p.complete,
      },
    ],
  },
  // ── BJT (bipolar transistor) track ──────────────────────────────────────
  // The NPN is kind "Q", the PNP "QP"; both are 3-pin parts ordered C, E, B —
  // pin 0 = Collector, pin 1 = Emitter, pin 2 = Base — matching the Ebers-Moll
  // core (main current a→b = collector→emitter, β ≈ 100). A small base current
  // controls a much larger collector current; the base-emitter junction has to
  // clear its ~0.6–0.7 V knee before any of it flows.
  {
    id: "bjt-switch",
    name: "Transistor as a Switch",
    blurb:
      "A small base current switches a much larger load current. A logic source drives the NPN's base through a base resistor; that tiny base current (β ≈ 100 times smaller than the load) is enough to turn the transistor full on, completing the loop so the LED lights. Drop the base drive to 0 V and the transistor cuts off — no base current, no collector current, the LED dark. The β-makes-a-switch idea: a milliamp of base commands tens of milliamps of load.",
    watch:
      "the LED light while the base is driven high and the NPN pulls its collector down near 0 V (a closed switch, saturated). Flip the base low and watch it snap off — cutoff, no current. The base resistor passes only a fraction of a milliamp, yet it controls the whole ~18 mA load.",
    build() {
      // VDD → R (LED current-limit) → LED → NPN.collector ; NPN.emitter → GND ; a
      // base source Vb drives the base through RB. Base HIGH (5 V) → Ib ≈
      // (5 − 0.7)/10k ≈ 0.43 mA, and β·Ib ≈ 43 mA far exceeds what the LED branch
      // can pass, so the NPN saturates: the LED lights at ~18 mA and the collector
      // bottoms out near 0.1 V (a closed switch). The LED makes the loop nonlinear;
      // the NPN adds the Ebers-Moll Newton path.
      //   nets: N1 = VDD+ = R.A ; N2 = R.B = LED.A ; N3 = LED.K = Q.collector ;
      //         GND(0) = Q.emitter = VDD− = Vb− ; NB = RB.B = Q.base ; NG = Vb+ = RB.A.
      const g = new BoardGraph();
      const vdd = comp(g, "V", 0, 0, 5, 1); // vertical 5 V rail, + at top
      const r = comp(g, "R", 2, 0, 150); // LED current-limit
      const led = comp(g, "LED", 6, 0, 0); // the switched load
      const q = comp(g, "Q", 10, 0, 0, 0); // low-side NPN switch (C top, E bottom)
      const rb = comp(g, "R", 6, 4, 10000); // base resistor (sets the base current)
      const vb = comp(g, "V", 2, 6, 5); // the base drive (HIGH = on)
      const gnd = comp(g, "GND", 10, 6, 0);
      wire(g, vdd, 0, r, 0); // VDD+ → R.A
      wire(g, r, 1, led, 0); // R.B → LED.A
      wire(g, led, 1, q, 0); // LED.K → Q.collector (pin 0)
      wire(g, q, 1, gnd, 0); // Q.emitter (pin 1) → GND
      wire(g, vb, 0, rb, 0); // Vb+ → RB.A
      wire(g, rb, 1, q, 2); // RB.B → Q.base (pin 2)
      wire(g, vb, 1, gnd, 0); // Vb− → GND
      wire(g, vdd, 1, gnd, 0); // VDD− → GND (reference)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V, 5 V), a series Resistor (R, ~150 Ω), and an LED — the load that will switch.",
        why: "This is the load branch the transistor will make or break. The resistor limits the LED current once the loop is completed.",
        done: (p) => at(p, "V") >= 1 && at(p, "R") >= 1 && at(p, "LED") >= 1,
      },
      {
        do: "Place an NPN Transistor (Q) below the LED, a base Resistor (R, ~10 kΩ), a second Voltage Source (V) for the base drive, and a Ground. Wire VDD+ → R → LED → COLLECTOR, EMITTER → GND, base drive → base resistor → BASE, and both source −'s → GND. Set the base drive to 5 V and press Run.",
        why: "The base resistor passes a small base current — under half a milliamp — once the base-emitter junction clears ~0.7 V. With β ≈ 100 that's enough to turn the transistor full on: watch the LED light and the collector drop near 0 V (saturated, a closed switch) while ~18 mA flows. The base current is a fraction of the load.",
        done: (p) => at(p, "Q") >= 1 && at(p, "V") >= 2 && p.complete,
      },
      {
        do: "Select the base-drive source and set it to 0 V (or use the toggle below).",
        why: "Now the base sits at 0 V: the base-emitter junction is below its knee, no base current flows, so no collector current can flow either — cutoff. The LED goes dark. A milliamp of base commanded the whole load, and removing it shuts everything off.",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Base high / low",
      on: "Base HIGH (5 V) — a small base current turns the NPN full on, the loop closes and the LED lights.",
      off: "Base LOW (0 V) — below the ~0.7 V knee, no base current: the transistor cuts off, the LED is dark.",
      alt() {
        // Same board, but the base drive is 0 V: Vbe < knee → cutoff, LED off.
        const g = new BoardGraph();
        const vdd = comp(g, "V", 0, 0, 5, 1);
        const r = comp(g, "R", 2, 0, 150);
        const led = comp(g, "LED", 6, 0, 0);
        const q = comp(g, "Q", 10, 0, 0, 0);
        const rb = comp(g, "R", 6, 4, 10000);
        const vb = comp(g, "V", 2, 6, 0); // base driven LOW
        const gnd = comp(g, "GND", 10, 6, 0);
        wire(g, vdd, 0, r, 0);
        wire(g, r, 1, led, 0);
        wire(g, led, 1, q, 0);
        wire(g, q, 1, gnd, 0);
        wire(g, vb, 0, rb, 0);
        wire(g, rb, 1, q, 2);
        wire(g, vb, 1, gnd, 0);
        wire(g, vdd, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  {
    id: "bjt-ce-amp",
    name: "Common-Emitter Amplifier",
    blurb:
      "An NPN biased in its active region, with a collector resistor, makes a voltage amplifier. A bias current into the base sets a steady collector current (Ic ≈ β·Ib); the collector resistor turns that current into a voltage, parking the collector partway down the rail. Nudge the base a little and the collector swings much harder — and inverts: more base drive means more collector current, which pulls the collector down. That gain is what a transistor is for.",
    watch:
      "the collector settle around 6 V — partway down the 12 V rail, not slammed to either end — because the NPN is steadily sinking ~1.3 mA through the 4.7 kΩ collector resistor. Nudge the base bias up a little and watch the collector swing down much further: a small base change, a large inverted collector change. That ratio is the voltage gain.",
    build() {
      // The textbook common-emitter stage, biased in the active region:
      //   VCC(12 V) → RC(4.7 kΩ) → Q.collector (the output) ; Q.emitter → GND ;
      //   base bias Vbb(2 V) → RB(100 kΩ) → Q.base ; all −'s → GND.
      //   nets: N1 = VCC+ = RC.A ; OUT = RC.B = Q.collector ;
      //         GND(0) = Q.emitter = VCC− = Vbb− ; NB = RB.B = Q.base ; NG = Vbb+ = RB.A.
      // Hand-check: Ib ≈ (Vbb − Vbe)/RB ≈ (2 − 0.7)/100k ≈ 13 µA, so with β ≈ 100,
      // Ic ≈ β·Ib ≈ 1.3 mA and Vce = 12 − Ic·4.7k ≈ 12 − 6.1 ≈ 5.9 V — the
      // collector parks mid-rail, the bias point an amplifier swings around. The
      // small-signal gain is −gm·RC with gm = Ic/Vt ≈ 0.05 S, so ≈ −235 (inverting),
      // limited in practice by the headroom. Nonlinear → the BJT Newton path runs.
      const g = new BoardGraph();
      const vcc = comp(g, "V", 0, 0, 12, 1); // vertical 12 V rail, + at top
      const rc = comp(g, "R", 2, 0, 4700); // collector resistor (the load)
      const q = comp(g, "Q", 6, 0, 0, 0); // common-emitter device
      const rb = comp(g, "R", 6, 4, 100000); // base bias resistor
      const vbb = comp(g, "V", 10, 6, 2); // the base bias (2 V → active region)
      const gnd = comp(g, "GND", 6, 8, 0);
      wire(g, vcc, 0, rc, 0); // VCC+ → RC.A
      wire(g, rc, 1, q, 0); // RC.B → Q.collector (pin 0) — the output node
      wire(g, q, 1, gnd, 0); // Q.emitter (pin 1) → GND
      wire(g, vbb, 0, rb, 0); // Vbb+ → RB.A
      wire(g, rb, 1, q, 2); // RB.B → Q.base (pin 2)
      wire(g, vbb, 1, gnd, 0); // Vbb− → GND
      wire(g, vcc, 1, gnd, 0); // VCC− → GND (reference)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V, 12 V) for the rail and a collector Resistor (R, ~4.7 kΩ).",
        why: "The collector resistor is what converts the transistor's collector current back into an output voltage — no collector load, no voltage gain.",
        done: (p) => at(p, "V") >= 1 && at(p, "R") >= 1,
      },
      {
        do: "Place an NPN Transistor (Q), a base Resistor (R, ~100 kΩ), a second Voltage Source (V) for the base bias, and a Ground. Wire VCC+ → RC → COLLECTOR, EMITTER → GND, base bias → base resistor → BASE, and both source −'s → GND. Set the base bias to ~2 V and press Run.",
        why: "The base resistor trickles ~13 µA into the base; with β ≈ 100 that sets ~1.3 mA of collector current. Watch the collector settle around 6 V — pulled partway down the rail because the transistor is steadily sinking that current through RC. That mid-rail point is the bias an amplifier swings around.",
        done: (p) => at(p, "Q") >= 1 && at(p, "V") >= 2 && p.complete,
      },
      {
        do: "Select the base-bias source and nudge its voltage up a little, then back down.",
        why: "A small base change moves the base current, β multiplies it into a much larger collector-current change, and RC turns that into a big, inverted voltage swing at the collector — the gain is roughly −gm·RC. A little push on the base, a big swing at the collector: that's amplification.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "bjt-mirror",
    name: "Current Mirror",
    blurb:
      "Two matched NPNs sharing one base node copy a current. The left transistor is diode-connected (its base tied to its collector) so a reference resistor sets a known current through it; because the two transistors share the same base-emitter voltage and are identical, the right transistor is forced to carry that same current — mirrored into its own branch, almost regardless of its load. It's the workhorse bias block of every analog chip, and the moment where matching matters.",
    watch:
      "both branches carry the same current. The reference branch sets ~0.9 mA through its resistor; watch the output branch mirror it — the same ~0.9 mA — so its collector node sits at the same height. The shared base node settles at one diode drop (~0.7 V), the Vbe both transistors obey.",
    build() {
      // A two-NPN current mirror. The reference NPN is diode-connected (base tied
      // to its own collector) so Rref sets Iref; the shared base node forces the
      // output NPN to the same Vbe, mirroring the current into the Rload branch.
      //   ref:  N1 = VCC+ = Rref.A = Rload.A ; REF = Rref.B = Q1.collector = Q1.base
      //         = Q2.base ; GND(0) = Q1.emitter = Q2.emitter = VCC−.
      //   out:  OUT = Rload.B = Q2.collector.
      // Hand-check: Iref ≈ (VCC − Vbe)/Rref ≈ (5 − 0.7)/4.7k ≈ 0.91 mA. Matched
      // transistors share Vbe, so Iout ≈ Iref ≈ 0.91 mA and OUT ≈ 5 − Iout·4.7k ≈
      // 0.7 V. (A little base current is skimmed off the reference — the classic
      // mirror error — so Iout is a hair under Iref.) Nonlinear → the BJT Newton path.
      const g = new BoardGraph();
      const vcc = comp(g, "V", 0, 0, 5, 1); // vertical 5 V rail, + at top
      const rref = comp(g, "R", 2, 0, 4700); // reference resistor (sets Iref)
      const rload = comp(g, "R", 8, 0, 4700); // output-branch load resistor
      const q1 = comp(g, "Q", 4, 4, 0, 0); // reference NPN (diode-connected)
      const q2 = comp(g, "Q", 8, 4, 0, 0); // output NPN (mirrors Iref)
      const gnd = comp(g, "GND", 6, 8, 0);
      wire(g, vcc, 0, rref, 0); // VCC+ → Rref.A
      wire(g, vcc, 0, rload, 0); // VCC+ → Rload.A (same rail)
      wire(g, rref, 1, q1, 0); // Rref.B → Q1.collector (pin 0) = REF node
      wire(g, q1, 2, q1, 0); // Q1.base (pin 2) → Q1.collector (diode-connected)
      wire(g, q1, 2, q2, 2); // Q1.base → Q2.base (the shared mirror node)
      wire(g, rload, 1, q2, 0); // Rload.B → Q2.collector (pin 0) = OUT node
      wire(g, q1, 1, gnd, 0); // Q1.emitter (pin 1) → GND
      wire(g, q2, 1, gnd, 0); // Q2.emitter (pin 1) → GND
      wire(g, vcc, 1, gnd, 0); // VCC− → GND (reference)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V, 5 V) and a reference Resistor (R, ~4.7 kΩ).",
        why: "The reference resistor is what sets the current we're going to copy — (VCC − 0.7 V)/R, about 0.9 mA.",
        done: (p) => at(p, "V") >= 1 && at(p, "R") >= 1,
      },
      {
        do: "Place the reference NPN (Q) and wire it diode-connected: Rref → its COLLECTOR, its BASE tied to that same collector, its EMITTER → GND, and VCC− → GND. Run.",
        why: "Tying the base to the collector turns the transistor into a diode that the resistor drives — it pins the shared base node at one Vbe (~0.7 V) and sets the reference current. This is the template the second transistor will copy.",
        done: (p) => at(p, "Q") >= 1 && at(p, "R") >= 1 && p.wires >= 4,
      },
      {
        do: "Place the output NPN (Q) and a load Resistor (R, ~4.7 kΩ): VCC → Rload → its COLLECTOR, its EMITTER → GND, and its BASE wired to the FIRST transistor's base (the shared node). Run again.",
        why: "Both transistors now share the same Vbe — and being matched, the same Vbe means the same current. Watch the output branch carry the same ~0.9 mA as the reference, mirrored across with no direct connection but the shared base. Matching is everything: if the two devices differ, so do the currents.",
        done: (p) => at(p, "Q") >= 2 && at(p, "R") >= 2 && p.complete,
      },
    ],
  },
  // ── Op-amp track ──────────────────────────────────────────────────────────
  // The op-amp is kind "OA", a 3-pin part ordered OUT, IN−, IN+ — pin 0 = Output,
  // pin 1 = inverting input, pin 2 = non-inverting input — matching the core
  // (ELEM_OPAMP=15: a=OUT, b=IN−, c=IN+; output drives V(a) toward
  // Vsat·tanh(A·(V₊−V₋)/Vsat), A ≈ 1e5, `value` = Vsat). Three faces of the same
  // part: a unity buffer and a resistor-ratio amplifier (both with negative
  // feedback to IN−, the virtual short), and an open-loop comparator that rails.
  {
    id: "opamp-follower",
    name: "Op-Amp Voltage Follower",
    blurb:
      "Wire the output straight back to the inverting input and the op-amp becomes a buffer: the output copies the voltage on the + input exactly, gain of one. It seems pointless until you notice what changed — the + input draws no current, so the source driving it is completely unloaded, while the output can drive a real load stiffly. It's the impedance buffer that lets a delicate signal source talk to a heavy load without sagging.",
    watch:
      "the output node sit at the same 3 V as the input — a perfect copy — while the output stiffly drives ~3 mA into the load resistor. The + input, meanwhile, sources nothing: the whole load current comes out of the op-amp, not the signal source.",
    build() {
      // Unity-gain buffer: IN+ driven by Vin, OUT tied back to IN− (full
      // feedback). The virtual short forces V(IN−) = V(IN+), and since OUT = IN−,
      // Vout = Vin. A load resistor to ground makes the output current visible.
      //   nets: INP = Vin+ = OA.IN+ ; OUT = OA.OUT = OA.IN− = Rload.A ;
      //         GND(0) = Vin− = Rload.B.
      // Hand-check: Vout = Vin = 3 V; Iout = 3 V / 1 kΩ = 3 mA, sourced entirely by
      // the op-amp output (the + input draws ~0). Nonlinear → the op-amp Newton path.
      const g = new BoardGraph();
      const vin = comp(g, "V", 0, 0, 3, 1); // vertical 3 V input, + at top
      const oa = comp(g, "OA", 5, 0, 12); // Vsat = 12 V
      const rload = comp(g, "R", 10, 0, 1000, 1); // output load (vertical)
      const gnd = comp(g, "GND", 10, 4, 0);
      wire(g, vin, 0, oa, 2); // Vin+ → OA.IN+ (pin 2)
      wire(g, oa, 0, oa, 1); // OA.OUT (pin 0) → OA.IN− (pin 1) — feedback
      wire(g, oa, 0, rload, 0); // OA.OUT → Rload.A
      wire(g, rload, 1, gnd, 0); // Rload.B → GND
      wire(g, vin, 1, gnd, 0); // Vin− → GND (reference)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V, 3 V) for the input signal and an Op-Amp (OA).",
        why: "The op-amp has two inputs — non-inverting (+) and inverting (−) — and one output. On its own its gain is enormous; feedback is what tames it into something useful.",
        done: (p) => at(p, "V") >= 1 && at(p, "OA") >= 1,
      },
      {
        do: "Wire Vin+ → the + input (IN+), then wire the OUTPUT straight back to the − input (IN−). Add a load Resistor (R, ~1 kΩ) from the output to a Ground, and Vin− → GND. Run.",
        why: "Tying the output to the − input closes the loop. The huge gain now drives the output until the two inputs match — the 'virtual short' — so the output lands at exactly the + input's 3 V. Watch the output node copy the input while it stiffly drives the load.",
        done: (p) => at(p, "OA") >= 1 && at(p, "R") >= 1 && p.complete,
      },
      {
        do: "Select the input source and change its voltage; watch the output track it one-for-one.",
        why: "Whatever you set the + input to, the output follows — gain of exactly one. The point isn't the voltage (it's unchanged); it's that the output now sources the load current the fragile input never could. That's buffering.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "opamp-noninverting",
    name: "Non-Inverting Amplifier",
    blurb:
      "Add a feedback divider and the op-amp multiplies. A fraction of the output is fed back to the − input; the virtual short forces that fraction to equal the + input, so the output has to be larger than the input by exactly the inverse of the divider — a gain of 1 + Rf/Rg, set entirely by two resistors. The op-amp's own gain is huge and imprecise; the resistor ratio is what you actually get, accurate and stable.",
    watch:
      "the input sit at 1 V while the output settles at 3 V — a gain of ×3, which is 1 + 20 kΩ/10 kΩ. The feedback node (the − input) holds at 1 V too, matching the + input: the virtual short the whole result rests on.",
    build() {
      // Non-inverting amp: gain = 1 + Rf/Rg. Vin on IN+, feedback divider from OUT
      // (Rf) to IN− to GND (Rg). The virtual short pins V(IN−) = V(IN+) = Vin, so
      // the divider forces Vout = Vin·(1 + Rf/Rg). A load resistor makes Iout show.
      //   nets: INP = Vin+ = OA.IN+ ; FB = OA.IN− = Rf.B = Rg.A ;
      //         OUT = OA.OUT = Rf.A = Rload.A ; GND(0) = Vin− = Rg.B = Rload.B.
      // Hand-check: Vin = 1 V, Rf = 20 kΩ, Rg = 10 kΩ → gain = 1 + 2 = 3, Vout = 3 V.
      // Rg current = 1 V/10 kΩ = 0.1 mA flows on through Rf (none into IN−), so
      // Vout = 1 + 0.1 mA·20 kΩ = 3 V. Nonlinear → the op-amp Newton path.
      const g = new BoardGraph();
      const vin = comp(g, "V", 0, 0, 1, 1); // vertical 1 V input, + at top
      const oa = comp(g, "OA", 5, 0, 12); // Vsat = 12 V
      const rf = comp(g, "R", 8, 4, 20000); // feedback resistor (OUT → IN−)
      const rg = comp(g, "R", 4, 4, 10000); // ground-leg resistor (IN− → GND)
      const rload = comp(g, "R", 11, 0, 3300, 1); // output load (vertical)
      const gnd = comp(g, "GND", 8, 8, 0);
      wire(g, vin, 0, oa, 2); // Vin+ → OA.IN+ (pin 2)
      wire(g, oa, 0, rf, 0); // OA.OUT (pin 0) → Rf.A
      wire(g, rf, 1, oa, 1); // Rf.B → OA.IN− (pin 1) — the feedback node
      wire(g, rf, 1, rg, 0); // Rf.B → Rg.A (same FB node)
      wire(g, rg, 1, gnd, 0); // Rg.B → GND
      wire(g, oa, 0, rload, 0); // OA.OUT → Rload.A
      wire(g, rload, 1, gnd, 0); // Rload.B → GND
      wire(g, vin, 1, gnd, 0); // Vin− → GND (reference)
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V, 1 V) for the input and an Op-Amp (OA).",
        why: "Same op-amp as the buffer — but this time the feedback won't be a plain wire. A resistor divider in the feedback is what sets a gain bigger than one.",
        done: (p) => at(p, "V") >= 1 && at(p, "OA") >= 1,
      },
      {
        do: "Wire Vin+ → IN+. Then build the feedback divider: OUTPUT → Rf (~20 kΩ) → IN−, and IN− → Rg (~10 kΩ) → Ground. Add a load Resistor (~3.3 kΩ) from OUTPUT to GND, and Vin− → GND. Run.",
        why: "Only a fraction of the output, Rg/(Rf+Rg), reaches the − input. The virtual short forces that fraction to equal the 1 V input, so the output must rise to 1 + Rf/Rg = 3× the input. Watch the output settle at 3 V and the feedback node hold at 1 V.",
        done: (p) => at(p, "OA") >= 1 && at(p, "R") >= 3 && p.complete,
      },
      {
        do: "Swap Rf or Rg for a different value and watch the gain change.",
        why: "The output is always 1 + Rf/Rg times the input — double Rf and the gain climbs, regardless of the op-amp's own (enormous, imprecise) gain. Two resistors set the answer: that's why feedback amplifiers are precise.",
        done: (p) => p.complete,
      },
    ],
  },
  {
    id: "opamp-comparator",
    name: "Op-Amp Comparator",
    blurb:
      "Take the feedback away and the op-amp stops being gentle. With nothing to tame it, its huge gain slams the output to one rail or the other depending only on which input is higher: + above −, the output pins to +Vsat; + below −, it drops to −Vsat. It's a one-bit decision — an analog voltage in, a hard yes/no out — the bridge from the analog world to the digital one.",
    watch:
      "the output slammed hard to the +12 V rail because the 4 V signal sits above the 2.5 V reference. There's no in-between: the output isn't amplifying the 1.5 V difference, it's just reporting its sign. Drop the signal below the reference (toggle below) and the output snaps to the opposite rail.",
    build() {
      // Open-loop comparator: no feedback. A signal on IN+ is compared against a
      // reference on IN−; the output rails to ±Vsat by the sign of (V+ − V−).
      //   nets: SIG = Vsig+ = OA.IN+ ; REF = Vref+ = OA.IN− ;
      //         OUT = OA.OUT = Rload.A ; GND(0) = Vsig− = Vref− = Rload.B.
      // Hand-check: V+ = 4 > V− = 2.5 ⇒ Vout → +Vsat = +12 V; Iout = 12 V/4.7 kΩ ≈
      // 2.55 mA into the load. Flip Vsig below 2.5 V and Vout → −Vsat. Nonlinear →
      // the op-amp Newton path (a stiff 1e5 gain that saturates cleanly).
      const g = new BoardGraph();
      const vsig = comp(g, "V", 0, 0, 4, 1); // signal, + at top → IN+
      const vref = comp(g, "V", 0, 6, 2.5); // reference → IN−
      const oa = comp(g, "OA", 5, 0, 12); // Vsat = 12 V, open loop
      const rload = comp(g, "R", 10, 0, 4700, 1); // output load (vertical)
      const gnd = comp(g, "GND", 10, 4, 0);
      wire(g, vsig, 0, oa, 2); // Vsig+ → OA.IN+ (pin 2)
      wire(g, vref, 0, oa, 1); // Vref+ → OA.IN− (pin 1)
      wire(g, oa, 0, rload, 0); // OA.OUT → Rload.A
      wire(g, rload, 1, gnd, 0); // Rload.B → GND
      wire(g, vsig, 1, gnd, 0); // Vsig− → GND
      wire(g, vref, 1, gnd, 0); // Vref− → GND
      return g.serialize();
    },
    steps: [
      {
        do: "Place two Voltage Sources — a signal (V, 4 V) and a reference (V, 2.5 V) — and an Op-Amp (OA).",
        why: "A comparator weighs one voltage against another. The reference is the threshold; the signal is what you're testing against it.",
        done: (p) => at(p, "V") >= 2 && at(p, "OA") >= 1,
      },
      {
        do: "Wire the signal → IN+ and the reference → IN−. Add a load Resistor (~4.7 kΩ) from OUTPUT to a Ground, and both sources' −'s → GND. Leave the output unconnected to the inputs (no feedback). Run.",
        why: "With no feedback, nothing tames the gain. The 4 V signal is above the 2.5 V reference, so the output slams to the positive rail (+12 V) — not 1.5 V amplified, just a hard 'yes, + is higher'. Watch it pin to the rail and drive the load.",
        done: (p) => at(p, "OA") >= 1 && at(p, "V") >= 2 && p.complete,
      },
      {
        do: "Select the signal source and set it below 2.5 V (or use the toggle below).",
        why: "The moment the signal crosses below the reference, the output flips to the other rail. No gradual slope — a clean threshold. That all-or-nothing decision is how an analog level becomes a digital bit.",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Signal above / below",
      on: "Signal 4 V (above the 2.5 V reference) — the output rails HIGH to +12 V.",
      off: "Signal 1 V (below the reference) — the output snaps LOW to −12 V.",
      alt() {
        // Same comparator, signal dropped below the reference: output rails low.
        const g = new BoardGraph();
        const vsig = comp(g, "V", 0, 0, 1, 1); // signal now below the reference
        const vref = comp(g, "V", 0, 6, 2.5);
        const oa = comp(g, "OA", 5, 0, 12);
        const rload = comp(g, "R", 10, 0, 4700, 1);
        const gnd = comp(g, "GND", 10, 4, 0);
        wire(g, vsig, 0, oa, 2);
        wire(g, vref, 0, oa, 1);
        wire(g, oa, 0, rload, 0);
        wire(g, rload, 1, gnd, 0);
        wire(g, vsig, 1, gnd, 0);
        wire(g, vref, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  // ── Logic track ───────────────────────────────────────────────────────────
  // Logic gates are kinds AND/OR/NAND/NOR/XOR (3-pin: pin 0 = Y output, pin 1 = A,
  // pin 2 = B) and NOT (2-pin: pin 0 = Y, pin 1 = A). All map to solver type 17;
  // `value` is the logic-high rail (5 V here). Inputs are thresholded at half the
  // rail, read from the previous tick (one tick of propagation delay); the output
  // is driven hard to the rail or ground. A driven Voltage Source above the
  // threshold is a logic 1, below it a logic 0.
  {
    id: "logic-inverter",
    name: "Inverter (NOT Gate)",
    blurb:
      "The simplest logic: an inverter flips its input. Drive its input low and the output goes high; drive it high and the output goes low. Wired to an LED, the surprise is that the light is ON when you're NOT driving the input — the gate manufactures a high output from a low input. It reads the input as a 1 only above half the supply rail, so anything below counts as 0.",
    watch:
      "the LED lit even though the input source sits at 0 V — the inverter drives its output HIGH (5 V) because the input is LOW. Raise the input above ~2.5 V (the toggle below) and the output snaps low, and the LED goes dark: the opposite of its input, always.",
    build() {
      // Vin → NOT.A ; NOT.Y → R → LED → GND. Input LOW (0 V) ⇒ NOT drives Y high
      // (5 V) ⇒ the LED lights through the 330 Ω limiter (~9 mA). The LED makes the
      // loop nonlinear, so the gate stamps on the Newton path.
      //   nets: IN = Vin+ = NOT.A ; Y = NOT.Y = R.A ; R.B = LED.A ; GND = LED.K = Vin−.
      const g = new BoardGraph();
      const vin = comp(g, "V", 0, 0, 0, 1); // input source, LOW (0 V), + at top
      const inv = comp(g, "NOT", 4, 0, 5); // inverter, 5 V logic rail
      const r = comp(g, "R", 8, 0, 330); // LED current-limit
      const led = comp(g, "LED", 12, 0, 0);
      const gnd = comp(g, "GND", 12, 4, 0);
      wire(g, vin, 0, inv, 1); // Vin+ → NOT.A (pin 1)
      wire(g, inv, 0, r, 0); // NOT.Y (pin 0) → R.A
      wire(g, r, 1, led, 0); // R.B → LED.A
      wire(g, led, 1, gnd, 0); // LED.K → GND
      wire(g, vin, 1, gnd, 0); // Vin− → GND
      return g.serialize();
    },
    steps: [
      {
        do: "Place a Voltage Source (V) for the input, a NOT gate, then an LED with a series Resistor (R, ~330 Ω).",
        why: "The source is the logic input — above half the rail it's a 1, below it a 0. The gate will invert whatever level it reads.",
        done: (p) => at(p, "V") >= 1 && at(p, "NOT") >= 1 && at(p, "LED") >= 1,
      },
      {
        do: "Wire Vin+ → the gate's A input, the gate's Y output → R → LED → Ground, and Vin− → GND. Leave the input source at 0 V and press Run.",
        why: "With the input at 0 V (a logic 0), the inverter drives its output to a logic 1 — about 5 V — and the LED lights. The output is the opposite of the input.",
        done: (p) => at(p, "NOT") >= 1 && at(p, "LED") >= 1 && p.complete,
      },
      {
        do: "Select the input source and set it to 5 V (or use the toggle below).",
        why: "Now the input is a logic 1, so the inverter drives its output to a logic 0 (~0 V) and the LED goes dark. High in, low out — and a moment later, because the gate's decision lags its input by one tick (its propagation delay).",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Input low / high",
      on: "Input 0 V (logic 0) — the inverter outputs HIGH, the LED is lit.",
      off: "Input 5 V (logic 1) — the inverter outputs LOW, the LED is dark.",
      alt() {
        const g = new BoardGraph();
        const vin = comp(g, "V", 0, 0, 5, 1); // input HIGH
        const inv = comp(g, "NOT", 4, 0, 5);
        const r = comp(g, "R", 8, 0, 330);
        const led = comp(g, "LED", 12, 0, 0);
        const gnd = comp(g, "GND", 12, 4, 0);
        wire(g, vin, 0, inv, 1);
        wire(g, inv, 0, r, 0);
        wire(g, r, 1, led, 0);
        wire(g, led, 1, gnd, 0);
        wire(g, vin, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  {
    id: "logic-and",
    name: "AND Gate Interlock",
    blurb:
      "An AND gate is a two-key interlock: its output goes high only when BOTH inputs are high. Tie its output to an LED and the light comes on only when both switches are thrown — exactly the safety logic that keeps a machine off unless every guard is in place. Drop either input and the output falls.",
    watch:
      "the LED lit because BOTH inputs sit at 5 V (logic 1) — AND(1,1) = 1. Drop either input to 0 V (the toggle below) and the output collapses to 0 and the LED goes dark: with an AND, every input must be high or nothing is.",
    build() {
      // V_A, V_B (both HIGH) → AND.A, AND.B ; AND.Y → R → LED → GND. AND(1,1)=1 ⇒
      // the LED lights. Drop an input and AND→0 ⇒ dark. Nonlinear (LED) ⇒ Newton.
      //   nets: A = Va+ = AND.A ; B = Vb+ = AND.B ; Y = AND.Y = R.A ;
      //         R.B = LED.A ; GND = LED.K = Va− = Vb−.
      const g = new BoardGraph();
      const va = comp(g, "V", 0, 0, 5, 1); // input A, HIGH
      const vb = comp(g, "V", 0, 4, 5, 1); // input B, HIGH
      const and = comp(g, "AND", 4, 0, 5); // 5 V logic rail
      const r = comp(g, "R", 8, 0, 330);
      const led = comp(g, "LED", 12, 0, 0);
      const gnd = comp(g, "GND", 8, 5, 0);
      wire(g, va, 0, and, 1); // Va+ → AND.A (pin 1)
      wire(g, vb, 0, and, 2); // Vb+ → AND.B (pin 2)
      wire(g, and, 0, r, 0); // AND.Y (pin 0) → R.A
      wire(g, r, 1, led, 0); // R.B → LED.A
      wire(g, led, 1, gnd, 0); // LED.K → GND
      wire(g, va, 1, gnd, 0); // Va− → GND
      wire(g, vb, 1, gnd, 0); // Vb− → GND
      return g.serialize();
    },
    steps: [
      {
        do: "Place two Voltage Sources (V) for the two inputs, an AND gate, and an LED with a series Resistor (R, ~330 Ω).",
        why: "The two sources are the two conditions. The AND gate will light the LED only when both are satisfied (both above half the rail).",
        done: (p) => at(p, "V") >= 2 && at(p, "AND") >= 1 && at(p, "LED") >= 1,
      },
      {
        do: "Wire each source's + into one of the gate's inputs (A and B), the gate's Y output → R → LED → Ground, and both sources' −'s → GND. Set both sources to 5 V and Run.",
        why: "Both inputs are now logic 1, so AND(1,1) = 1: the gate drives its output high and the LED lights. Both keys are in.",
        done: (p) => at(p, "V") >= 2 && at(p, "AND") >= 1 && p.complete,
      },
      {
        do: "Select one input source and set it to 0 V (or use the toggle below).",
        why: "With one input now a logic 0, AND(1,0) = 0: the output falls and the LED goes dark. An AND needs every input high — drop one and the whole thing is off.",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "Both high / one low",
      on: "Both inputs 5 V — AND(1,1) = 1, the LED is lit.",
      off: "One input 0 V — AND(1,0) = 0, the LED is dark.",
      alt() {
        const g = new BoardGraph();
        const va = comp(g, "V", 0, 0, 5, 1);
        const vb = comp(g, "V", 0, 4, 0, 1); // input B dropped LOW
        const and = comp(g, "AND", 4, 0, 5);
        const r = comp(g, "R", 8, 0, 330);
        const led = comp(g, "LED", 12, 0, 0);
        const gnd = comp(g, "GND", 8, 5, 0);
        wire(g, va, 0, and, 1);
        wire(g, vb, 0, and, 2);
        wire(g, and, 0, r, 0);
        wire(g, r, 1, led, 0);
        wire(g, led, 1, gnd, 0);
        wire(g, va, 1, gnd, 0);
        wire(g, vb, 1, gnd, 0);
        return g.serialize();
      },
    },
  },
  {
    id: "logic-half-adder",
    name: "Half-Adder (XOR + AND)",
    blurb:
      "Two gates add two bits. An XOR gives the SUM (high when the inputs differ) and an AND gives the CARRY (high only when both are 1) — together they compute 1 + 1 = binary 10. It's the first real datapath: feed the same two inputs to both gates and read the two-bit answer off their outputs. Every adder in every CPU is built from this cell.",
    watch:
      "with both inputs high (1 + 1), the CARRY LED lit and the SUM LED dark — binary 10, which is two. The XOR sees its inputs matching, so the sum bit is 0; the AND sees both high, so the carry is 1. Flip one input low (the toggle) and it swaps: 1 + 0 = 01, sum lit, carry dark.",
    build() {
      // Half-adder: Sum = A XOR B, Carry = A AND B. A and B each fan out to both
      // gates; each gate output drives its own LED through a limiter.
      //   nets: A = Va+ = XOR.A = AND.A ; B = Vb+ = XOR.B = AND.B ;
      //         SUM = XOR.Y = Rs.A ; CARRY = AND.Y = Rc.A ; GND common.
      // A=1,B=1 ⇒ Sum=XOR(1,1)=0 (dark), Carry=AND(1,1)=1 (lit): 1+1 = 10.
      const g = new BoardGraph();
      const va = comp(g, "V", 0, 0, 5, 1); // input A, HIGH
      const vb = comp(g, "V", 0, 8, 5, 1); // input B, HIGH
      const xor = comp(g, "XOR", 4, 0, 5); // Sum = A XOR B
      const and = comp(g, "AND", 4, 6, 5); // Carry = A AND B
      const rs = comp(g, "R", 8, 0, 330); // sum LED limiter
      const leds = comp(g, "LED", 11, 0, 0); // SUM
      const rc = comp(g, "R", 8, 6, 330); // carry LED limiter
      const ledc = comp(g, "LED", 11, 6, 0); // CARRY
      const gnd = comp(g, "GND", 14, 4, 0);
      // Inputs fan out to both gates.
      wire(g, va, 0, xor, 1); // A → XOR.A
      wire(g, va, 0, and, 1); // A → AND.A
      wire(g, vb, 0, xor, 2); // B → XOR.B
      wire(g, vb, 0, and, 2); // B → AND.B
      // Sum branch.
      wire(g, xor, 0, rs, 0); // XOR.Y → Rs
      wire(g, rs, 1, leds, 0);
      wire(g, leds, 1, gnd, 0);
      // Carry branch.
      wire(g, and, 0, rc, 0); // AND.Y → Rc
      wire(g, rc, 1, ledc, 0);
      wire(g, ledc, 1, gnd, 0);
      // References.
      wire(g, va, 1, gnd, 0);
      wire(g, vb, 1, gnd, 0);
      return g.serialize();
    },
    steps: [
      {
        do: "Place two Voltage Sources (V) for inputs A and B, an XOR gate (the sum) and an AND gate (the carry), and an LED + Resistor for each gate's output.",
        why: "The same two input bits feed both gates: XOR computes the sum bit, AND computes the carry bit. Two gates, a two-bit answer.",
        done: (p) =>
          at(p, "V") >= 2 &&
          at(p, "XOR") >= 1 &&
          at(p, "AND") >= 1 &&
          at(p, "LED") >= 2,
      },
      {
        do: "Wire input A to BOTH gates' A inputs and input B to BOTH gates' B inputs (each input fans out to two pins). Send XOR.Y → Rs → SUM LED → GND and AND.Y → Rc → CARRY LED → GND, then both sources' −'s → GND. Set both inputs to 5 V and Run.",
        why: "Both inputs are 1. XOR(1,1) = 0 so the SUM LED is dark; AND(1,1) = 1 so the CARRY LED lights. That's 1 + 1 = binary 10 — two — read off the two LEDs.",
        done: (p) =>
          at(p, "XOR") >= 1 &&
          at(p, "AND") >= 1 &&
          at(p, "LED") >= 2 &&
          p.complete,
      },
      {
        do: "Select input B and set it to 0 V (or use the toggle below).",
        why: "Now the inputs differ: XOR(1,0) = 1 lights the SUM LED, and AND(1,0) = 0 darkens the CARRY. That's 1 + 0 = binary 01 — one. The same cell, a different sum.",
        done: (p) => p.complete,
      },
    ],
    demo: {
      label: "1+1 / 1+0",
      on: "Both inputs 1 — SUM = 0 (dark), CARRY = 1 (lit): 1 + 1 = 10.",
      off: "Inputs differ (1 and 0) — SUM = 1 (lit), CARRY = 0 (dark): 1 + 0 = 01.",
      alt() {
        const g = new BoardGraph();
        const va = comp(g, "V", 0, 0, 5, 1);
        const vb = comp(g, "V", 0, 8, 0, 1); // B dropped LOW
        const xor = comp(g, "XOR", 4, 0, 5);
        const and = comp(g, "AND", 4, 6, 5);
        const rs = comp(g, "R", 8, 0, 330);
        const leds = comp(g, "LED", 11, 0, 0);
        const rc = comp(g, "R", 8, 6, 330);
        const ledc = comp(g, "LED", 11, 6, 0);
        const gnd = comp(g, "GND", 14, 4, 0);
        wire(g, va, 0, xor, 1);
        wire(g, va, 0, and, 1);
        wire(g, vb, 0, xor, 2);
        wire(g, vb, 0, and, 2);
        wire(g, xor, 0, rs, 0);
        wire(g, rs, 1, leds, 0);
        wire(g, leds, 1, gnd, 0);
        wire(g, and, 0, rc, 0);
        wire(g, rc, 1, ledc, 0);
        wire(g, ledc, 1, gnd, 0);
        wire(g, va, 1, gnd, 0);
        wire(g, vb, 1, gnd, 0);
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
        do: "Drop a Diode (D) right onto the wire between the source and the load — it splices itself in-line, anode toward the source, cathode toward the load. Run.",
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
      // The rectified output runs along the top rail; the load R and the reservoir
      // cap hang as vertical rungs down to the ground rail, the cap dropping straight
      // to GND so the smoothing path reads cleanly top-to-bottom.
      const g = new BoardGraph();
      const d = comp(g, "D", 2, 0, 0);
      const r = comp(g, "R", 8, 0, 1000, 1); // vertical load rung
      const c = comp(g, "C", 12, 0, 22e-6, 1); // vertical reservoir rung
      const ac = comp(g, "AC", 2, 6, 200);
      const gnd = comp(g, "GND", 12, 6, 0); // straight below the reservoir cap
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
        // Omit the reservoir cap, returning to the bare half-wave rectifier. The
        // load R and GND keep the main build's cells, so toggling the cap only
        // adds/removes it — nothing else jumps.
        const g = new BoardGraph();
        const d = comp(g, "D", 2, 0, 0);
        const r = comp(g, "R", 8, 0, 1000, 1); // vertical load rung (unchanged cell)
        const ac = comp(g, "AC", 2, 6, 200);
        const gnd = comp(g, "GND", 12, 6, 0);
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
  "Op-Amps",
  "Logic & ICs",
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
  "ec-decoupling": "Capacitors & Inductors",
  "diode-clamp": "Diodes",
  "led-limit": "Diodes",
  "schottky-vs-silicon": "Diodes",
  "led-series": "Diodes",
  "zener-shunt": "Diodes",
  "surge-clamp": "Diodes",
  buck: "Power & Switching",
  "pwm-average": "Power & Switching",
  "manual-switch-led": "Power & Switching",
  "mosfet-switch": "Power & Switching",
  "mosfet-cs-amp": "Power & Switching",
  "bjt-switch": "Power & Switching",
  "bjt-ce-amp": "Power & Switching",
  "bjt-mirror": "Power & Switching",
  "opamp-follower": "Op-Amps",
  "opamp-noninverting": "Op-Amps",
  "opamp-comparator": "Op-Amps",
  "logic-inverter": "Logic & ICs",
  "logic-and": "Logic & ICs",
  "logic-half-adder": "Logic & ICs",
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

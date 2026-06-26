// SPDX-License-Identifier: Apache-2.0
// The WASM-FREE half of the characterization sweep (§2.9). For ONE input combination, clone the cell's die
// graph, drive its rails + inputs as pinTests, add a high-impedance SENSE resistor across OUT→GND, inject
// the virtual sources via `dieTestGraph`, and compile to a netlist — returning the built netlist plus the
// OUT node to read. Split out from `characterize.ts` (which imports the wasm `Simulation`) so this — the
// part that carries the determinism-critical wiring — is headless-testable: `buildNetlist` runs in node,
// so a vitest can assert the sense node lands on the gate OUTPUT net and not a supply rail.
import { BoardGraph } from "./graph";
import type { GraphSnapshot, PinTest } from "./graph";
import { buildNetlist, type BuiltNetlist } from "./netlist";
import { dieTestGraph } from "./dieEditor";

/** Sweep supply / input-HIGH level (volts); the half-rail digital threshold is SWEEP_VCC/2. */
export const SWEEP_VCC = 5;

/** The frame-pin indices a sweep drives/observes, parsed from the cell's semantic pin roles. */
export interface SweepPins {
  /** input pins, in role order (i0, i1, …). */
  inPins: number[];
  /** the single OUTPUT pin (read, never driven). */
  outPin: number;
  /** the ground-reference pin. */
  gndPin: number;
  /** the VCC pin, or -1 if the cell self-powers / needs none. */
  vccPin: number;
  /** the clock pin for a SEQUENTIAL sweep (driven by a square clock source), or -1/absent for a
   * combinational cell. See {@link sequentialSweepNetlist} and Option A1. */
  clkPin?: number;
  /** the clock's COMPLEMENT pin (e.g. EN̄/CLK̄): driven as NOT(clk) by an injected powered inverter, so a
   * cell that takes a complementary clock PAIR (a transmission-gate latch's EN/ENB) is exercised correctly.
   * -1/absent when the cell has no separate complement pin (the clock stands alone). */
  clkComplementPin?: number;
}

/** A square clock for a sequential sweep: amplitude = {@link SWEEP_VCC}, 50% duty, referenced to the
 * cell's GND pin. The frequency is set so each half-period is a fixed number of fixed-step ticks (the
 * caller settles within a half-period before sampling Q). */
export const SWEEP_CLK_HALF_STEPS = 64;
/** Sim fixed step (s), mirrored from sim-core `DT` (2 µs) — to convert the half-period in ticks to Hz. */
const SWEEP_DT = 2e-6;
/** The square-clock frequency (Hz) for {@link SWEEP_CLK_HALF_STEPS} ticks per half-period. */
export const SWEEP_CLK_FREQ = 1 / (2 * SWEEP_CLK_HALF_STEPS * SWEEP_DT);

/** A compiled sweep vector: the netlist to install + the node whose voltage is the gate output. */
export interface SweepBuild {
  nl: BuiltNetlist;
  /** the node index to read for the output level (the sense resistor's OUT-side node). */
  outNode: number;
  /** the sense resistor's component id (its first node is {@link outNode}). */
  senseId: number;
}

/**
 * Build the scratch netlist for ONE input combination. Drives `pins.gndPin`→0, `pins.vccPin`→{@link
 * SWEEP_VCC}, and each input pin to `SWEEP_VCC` or 0 per `combo`'s bits; leaves the OUTPUT pin un-driven so
 * it settles to whatever the gate computes. A 1 GΩ SENSE resistor is wired OUT→GND: it's high-Z (can't
 * perturb the gate's own drive) and its first node in the built netlist IS the output net — the clean way
 * to find the output node without a sim-core change. Returns null if the frame is missing or the gate
 * doesn't compile.
 *
 * IMPORTANT (the bug that made every gate read "always HIGH" / word 0x3): `dieTestGraph` allocates its
 * injected GND + V-source ids from `snapshot.nextComponentId` and its wire ids from `nextWireId`. So after
 * appending the sense resistor we MUST advance both counters — otherwise dieTestGraph reuses the sense
 * resistor's id for the first injected supply (the VCC source), `BoardGraph.restore` collapses the
 * collision, and `nodesOfComponent.get(senseId)` then resolves to the VCC net (a stiff 5 V) → every vector
 * reads HIGH.
 */
export function sweepNetlist(
  graph: GraphSnapshot,
  frameId: number,
  pins: SweepPins,
  combo: number,
): SweepBuild | null {
  // A throwaway copy of the die graph per vector (≤16 cheap builds for a ≤4-in gate).
  const snap = structuredClone(graph);
  const frame = snap.components.find((c) => c.id === frameId);
  if (!frame) return null;

  // Drive the rails + this combination's inputs as virtual sources (dieTestGraph reads pinTests). The
  // OUTPUT pin is left un-driven so it's free to settle to whatever the gate computes.
  const tests: (PinTest | null)[] = (frame.pinTests ?? []).slice();
  tests[pins.gndPin] = { role: "gnd", value: 0 };
  if (pins.vccPin >= 0) tests[pins.vccPin] = { role: "vcc", value: SWEEP_VCC };
  pins.inPins.forEach((p, idx) => {
    tests[p] = { role: "in", value: (combo >> idx) & 1 ? SWEEP_VCC : 0 };
  });
  frame.pinTests = tests;

  // The high-Z sense resistor OUT→GND. Allocate its id + wire-ids from the snapshot counters AND advance
  // them, so dieTestGraph's injected sources/wires (which start from the same counters) can't alias it.
  const senseId = (snap.nextComponentId ?? 1_000_000) + 1;
  snap.components.push({
    id: senseId,
    kind: "R",
    cell: { col: -16, row: -16 },
    value: 1e9,
    rot: 0,
  } as (typeof snap.components)[number]);
  snap.nextComponentId = senseId + 1;
  const wId = (snap.nextWireId ?? 1_000_000) + 1;
  snap.wires.push({
    id: wId,
    from: { componentId: senseId, pinIndex: 0 },
    to: { componentId: frameId, pinIndex: pins.outPin },
  });
  snap.wires.push({
    id: wId + 1,
    from: { componentId: senseId, pinIndex: 1 },
    to: { componentId: frameId, pinIndex: pins.gndPin },
  });
  snap.nextWireId = wId + 2;

  const bg = new BoardGraph();
  bg.restore(dieTestGraph(snap, frameId));
  const nl = buildNetlist(bg, false);
  if (!nl) return null;
  const outNode = nl.nodesOfComponent.get(senseId)?.[0] ?? 0;
  return { nl, outNode, senseId };
}

/**
 * Build the scratch netlist for ONE input combination of a SEQUENTIAL cell (Option A1): exactly like
 * {@link sweepNetlist} — rails + this combo's inputs driven, a high-Z sense resistor on OUT (= Q) —
 * but ALSO drives a square clock source onto `pins.clkPin` (referenced to the GND pin) so STEPPING the
 * scratch sim produces rising clock edges. The caller installs this once, steps across several clock
 * periods, and samples Q after edges; a stable Q (independent of how many edges) means a pure D-type
 * next-state, the only sequential class A1 collapses to a single registered LUT (a self-dependent
 * toggle/counter never settles → the caller refuses it). The clock pin is NOT a swept data input
 * (`combo` covers only `pins.inPins`). Returns null if the frame is missing, the cell doesn't compile,
 * or no clock pin is declared.
 */
export function sequentialSweepNetlist(
  graph: GraphSnapshot,
  frameId: number,
  pins: SweepPins,
  combo: number,
): SweepBuild | null {
  const clkPin = pins.clkPin ?? -1;
  if (clkPin < 0) return null; // not a sequential sweep
  const snap = structuredClone(graph);
  const frame = snap.components.find((c) => c.id === frameId);
  if (!frame) return null;

  // Drive rails + this combination's inputs as virtual DC sources (dieTestGraph reads pinTests). OUT
  // (= Q) is left un-driven so the sense resistor reads it; the clock pin is driven by the PULSE below.
  const tests: (PinTest | null)[] = (frame.pinTests ?? []).slice();
  tests[pins.gndPin] = { role: "gnd", value: 0 };
  if (pins.vccPin >= 0) tests[pins.vccPin] = { role: "vcc", value: SWEEP_VCC };
  pins.inPins.forEach((p, idx) => {
    tests[p] = { role: "in", value: (combo >> idx) & 1 ? SWEEP_VCC : 0 };
  });
  frame.pinTests = tests;

  // High-Z sense resistor OUT(Q)→GND (same id/wire-counter discipline as sweepNetlist, so dieTestGraph's
  // injected sources can't alias it).
  const senseId = (snap.nextComponentId ?? 1_000_000) + 1;
  snap.components.push({
    id: senseId,
    kind: "R",
    cell: { col: -16, row: -16 },
    value: 1e9,
    rot: 0,
  } as (typeof snap.components)[number]);
  // The square clock: a PULSE source (variant 0 ⇒ square in buildNetlist), amp = SWEEP_VCC, + onto the
  // clk pin and − onto the GND pin (the cell's ground reference). Stepping the sim oscillates it.
  const clkId = senseId + 1;
  snap.components.push({
    id: clkId,
    kind: "PULSE",
    cell: { col: -16, row: -18 },
    value: SWEEP_CLK_FREQ,
    amp: SWEEP_VCC,
    duty: 0.5,
    variant: 0,
    rot: 0,
  } as (typeof snap.components)[number]);
  // Complementary clock: if the cell takes a separate EN̄/CLK̄ pin, drive it as NOT(clk) with an injected
  // POWERED inverter (kind "NOT": web pins [Y, A, B(NC), VCC, GND]) — A reads the clk pin, Y drives the
  // complement pin, rails from VCC/GND. So a transmission-gate latch's pass gates see a clean EN/EN̄ pair.
  const cmpPin = pins.clkComplementPin ?? -1;
  let notId = -1;
  if (cmpPin >= 0 && pins.vccPin >= 0) {
    notId = clkId + 1;
    snap.components.push({
      id: notId,
      kind: "NOT",
      cell: { col: -18, row: -16 },
      value: 0,
      rot: 0,
    } as (typeof snap.components)[number]);
    snap.nextComponentId = notId + 1;
  } else {
    snap.nextComponentId = clkId + 1;
  }

  const wId = (snap.nextWireId ?? 1_000_000) + 1;
  snap.wires.push({
    id: wId,
    from: { componentId: senseId, pinIndex: 0 },
    to: { componentId: frameId, pinIndex: pins.outPin },
  });
  snap.wires.push({
    id: wId + 1,
    from: { componentId: senseId, pinIndex: 1 },
    to: { componentId: frameId, pinIndex: pins.gndPin },
  });
  snap.wires.push({
    id: wId + 2,
    from: { componentId: clkId, pinIndex: 0 },
    to: { componentId: frameId, pinIndex: clkPin },
  });
  snap.wires.push({
    id: wId + 3,
    from: { componentId: clkId, pinIndex: 1 },
    to: { componentId: frameId, pinIndex: pins.gndPin },
  });
  let nextW = wId + 4;
  if (notId >= 0) {
    // NOT.A (pin 1) ← clk pin; NOT.Y (pin 0) → complement pin; rails on pins 3 (VCC) / 4 (GND).
    snap.wires.push({
      id: nextW,
      from: { componentId: notId, pinIndex: 1 },
      to: { componentId: frameId, pinIndex: clkPin },
    });
    snap.wires.push({
      id: nextW + 1,
      from: { componentId: notId, pinIndex: 0 },
      to: { componentId: frameId, pinIndex: cmpPin },
    });
    snap.wires.push({
      id: nextW + 2,
      from: { componentId: notId, pinIndex: 3 },
      to: { componentId: frameId, pinIndex: pins.vccPin },
    });
    snap.wires.push({
      id: nextW + 3,
      from: { componentId: notId, pinIndex: 4 },
      to: { componentId: frameId, pinIndex: pins.gndPin },
    });
    nextW += 4;
  }
  snap.nextWireId = nextW;

  const bg = new BoardGraph();
  bg.restore(dieTestGraph(snap, frameId));
  const nl = buildNetlist(bg, false);
  if (!nl) return null;
  const outNode = nl.nodesOfComponent.get(senseId)?.[0] ?? 0;
  return { nl, outNode, senseId };
}

/**
 * Classify the Q samples taken across successive clock edges for ONE input combination (Option A1, a
 * PURE helper so it is headless-testable). `samples` are the quantized Q levels (0/1) read after each
 * sampled rising edge, in order. A pure D-type next-state settles to a single value and stays there;
 * a self-dependent cell (toggle/JK/counter) keeps changing. Returns the settled bit, or a refusal
 * reason — the fail-safe contract: anything not provably stable is refused (the cell stays discrete).
 */
export function classifySequentialSamples(
  samples: number[],
): { ok: true; bit: number } | { ok: false; reason: string } {
  if (samples.length < 2)
    return {
      ok: false,
      reason: "too few clock samples to confirm a stable next-state",
    };
  const last = samples[samples.length - 1];
  // Require the final stretch of samples to agree — a settled, edge-count-independent Q.
  const tail = samples.slice(-Math.min(3, samples.length));
  if (tail.some((s) => s !== last))
    return {
      ok: false,
      reason:
        "Q changes across clock edges for fixed inputs — a self-dependent/oscillating cell (toggle, counter, latch). A1 collapses only pure D-type next-state; build it as a fabric (A2) or keep it discrete.",
    };
  if (last !== 0 && last !== 1)
    return { ok: false, reason: "Q did not settle to a clean logic level" };
  return { ok: true, bit: last };
}

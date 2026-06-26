// SPDX-License-Identifier: Apache-2.0
// CHARACTERIZATION SWEEP (§2.9, the engine's "1"). For a player-built combinational gate cell, drive every
// input combination through a SCRATCH Simulation, read the output level, and assemble the 16-bit prog-4 LUT
// truth-table word the cell can collapse to (see UserIc.behavior / flattenUserIcs). The scratch sim is a
// SECOND, throwaway Simulation — it never touches the global hashed instance, so the golden is untouched.
//
// APP-ONLY: this uses the wasm `Simulation`, which is initialised only in the running app — it can't run in
// the headless test suite. The determinism-critical wiring (the per-vector netlist build + the OUT-node
// pick) lives in `sweepNetlist.ts`, which is wasm-free and headless-tested; here we only drive the sim.
import { Simulation } from "../wasm/sim_wasm.js";
import type { GraphSnapshot, PinRole } from "./graph";
import {
  sweepNetlist,
  sequentialSweepNetlist,
  classifySequentialSamples,
  SWEEP_VCC,
  SWEEP_CLK_HALF_STEPS,
  type SweepPins,
} from "./sweepNetlist";
import { cellBehaviorSig, type CellBehavior } from "./userIc";

/** Ticks (DT = 2µs each) run per input vector to settle a combinational gate before reading the output. */
const SETTLE_STEPS = 64;

/** One swept input combination and the output level it produced (for the truth-table panel). */
export interface SweepVector {
  /** input bits in pin-role order (i0, i1, …). */
  in: number[];
  /** the settled output level (0/1). */
  out: number;
}

export type CharacterizeResult =
  | {
      ok: true;
      behavior: CellBehavior;
      /** number of input pins swept (k ≤ 4). */
      inputs: number;
      /** every input combination + its output, in index order (for the live truth-table). */
      vectors: SweepVector[];
    }
  | { ok: false; reason: string };

/** Parse the per-frame-pin semantic roles into the pins a sweep drives/observes. */
function parsePins(pinRoles: (PinRole | undefined)[]): SweepPins {
  const inPins: number[] = [];
  let outPin = -1;
  let gndPin = -1;
  let vccPin = -1;
  let clkPin = -1;
  for (let i = 0; i < pinRoles.length; i++) {
    const r = pinRoles[i];
    if (r === "in") inPins.push(i);
    else if (r === "out" && outPin < 0) outPin = i;
    else if (r === "gnd" && gndPin < 0) gndPin = i;
    else if (r === "vcc" && vccPin < 0) vccPin = i;
    else if (r === "clk" && clkPin < 0) clkPin = i;
  }
  return { inPins, outPin, gndPin, vccPin, clkPin };
}

/**
 * Sweep a small COMBINATIONAL gate cell into a prog-4 LUT word. `graph` is the cell's inner die graph,
 * `frameId` its die frame, `pinRoles` the per-frame-pin semantic roles. Returns the {@link CellBehavior} to
 * store on the def (so {@link flattenUserIcs} can collapse placed instances) plus the per-vector results.
 * Refuses (ok:false + reason) a cell with no output/ground, no inputs, more than 4 inputs, or one that won't
 * solve. APP-ONLY (spins up scratch Simulations).
 */
export function characterizeCell(
  graph: GraphSnapshot,
  frameId: number,
  pinRoles: (PinRole | undefined)[],
): CharacterizeResult {
  const pins = parsePins(pinRoles);
  // Characterization captures a COMBINATIONAL, single-output, powered, ≤4-input truth table. Refuse the
  // cases that would otherwise sweep into a wrong/garbage LUT, with a message that says WHY (audit fixes):
  const outCount = pinRoles.filter((r) => r === "out").length;
  if (pins.outPin < 0)
    return { ok: false, reason: "tag one pin OUT (no output to read)" };
  if (outCount > 1)
    return {
      ok: false,
      reason: `${outCount} outputs — characterize captures ONE output. Build a multi-output cell (adder, decoder, register) from single-output LUT cells.`,
    };
  if (pins.gndPin < 0)
    return {
      ok: false,
      reason:
        "no GND pin — characterize needs a powered cell with a ground reference and a driven output. A pass gate / transmission gate (no VCC/GND, just passes a signal) has no logic output to sweep.",
    };
  if (pins.inPins.length === 0)
    return { ok: false, reason: "no input pins to sweep" };
  if (pins.inPins.length > 4)
    return {
      ok: false,
      reason: `${pins.inPins.length} inputs — only ≤4-input gates collapse to one LUT. Split it into chained ≤4-input cells.`,
    };

  // SEQUENTIAL (Option A1): a clocked cell collapses to a REGISTERED LUT — but ONLY if it is a pure
  // D-type next-state (Q+ = f(inputs), no self-dependence). characterizeSequential FAILS SAFE: any
  // cell it can't prove is a pure D-type is refused (stays discrete), never mischaracterized.
  if (pins.clkPin !== undefined && pins.clkPin >= 0)
    return characterizeSequential(graph, frameId, pins);

  const k = pins.inPins.length;
  let word = 0;
  const vectors: SweepVector[] = [];

  for (let combo = 0; combo < 1 << k; combo++) {
    const built = sweepNetlist(graph, frameId, pins, combo);
    if (!built)
      return {
        ok: false,
        reason: `the gate doesn't solve at input ${combo} — wire it up so it has a complete path`,
      };
    const { nl, outNode } = built;

    const sim = new Simulation(0);
    try {
      const ok = sim.set_netlist_pefgh(
        nl.nodeCount,
        nl.types,
        nl.a,
        nl.b,
        nl.c,
        nl.d,
        nl.e,
        nl.f,
        nl.g,
        nl.h,
        nl.values,
        nl.aux,
        nl.params,
      );
      if (!ok)
        return { ok: false, reason: "couldn't install the sweep netlist" };
      for (let s = 0; s < SETTLE_STEPS; s++) sim.step();
      const v = sim.state()[outNode] ?? 0;
      const bit = v >= SWEEP_VCC / 2 ? 1 : 0;
      if (bit) word |= 1 << combo;
      vectors.push({
        in: pins.inPins.map((_, idx) => (combo >> idx) & 1),
        out: bit,
      });
    } finally {
      sim.free(); // don't leak the wasm object across the 2^k vectors
    }
  }

  return {
    ok: true,
    behavior: { prog: 4, word, mode: 0, sig: cellBehaviorSig(graph) },
    inputs: k,
    vectors,
  };
}

/** Clock periods (= 2× {@link SWEEP_CLK_HALF_STEPS} ticks) sampled per input vector. Q is read once
 * per half-period; {@link classifySequentialSamples} requires the tail to be settled, so a few extra
 * periods give the flop time to latch and expose any toggling. */
const SEQ_SAMPLES = 8;

/**
 * Sweep a clocked cell's NEXT-STATE into a REGISTERED prog-4 LUT (Option A1, APP-ONLY — spins up a
 * scratch {@link Simulation} with a running clock, so it can't run headless). For each input
 * combination it installs {@link sequentialSweepNetlist} (rails + inputs driven, a square clock on the
 * CLK pin), steps across {@link SEQ_SAMPLES} clock half-periods sampling Q, and {@link
 * classifySequentialSamples} decides the settled next-state bit — or REFUSES (a self-dependent
 * toggle/counter never settles). Emits `mode:1` (registered) so {@link flattenUserIcs} drives the LUT's
 * Q from the held bit and latches on the cell's CLK pin. Fail-safe: any uncertainty ⇒ ok:false ⇒ the
 * cell stays discrete (correct, just not cheap).
 */
function characterizeSequential(
  graph: GraphSnapshot,
  frameId: number,
  pins: SweepPins,
): CharacterizeResult {
  const k = pins.inPins.length;
  let word = 0;
  const vectors: SweepVector[] = [];

  for (let combo = 0; combo < 1 << k; combo++) {
    const built = sequentialSweepNetlist(graph, frameId, pins, combo);
    if (!built)
      return {
        ok: false,
        reason: `the cell doesn't solve at input ${combo} — wire it up so it has a complete path`,
      };
    const { nl, outNode } = built;

    const sim = new Simulation(0);
    try {
      const ok = sim.set_netlist_pefgh(
        nl.nodeCount,
        nl.types,
        nl.a,
        nl.b,
        nl.c,
        nl.d,
        nl.e,
        nl.f,
        nl.g,
        nl.h,
        nl.values,
        nl.aux,
        nl.params,
      );
      if (!ok)
        return {
          ok: false,
          reason: "couldn't install the sequential sweep netlist",
        };
      // Step half a clock period at a time, sampling Q after each — the running clock latches the flop
      // on its rising edges; a pure D-type settles, a toggle/counter keeps flipping.
      const samples: number[] = [];
      for (let s = 0; s < SEQ_SAMPLES; s++) {
        for (let t = 0; t < SWEEP_CLK_HALF_STEPS; t++) sim.step();
        const v = sim.state()[outNode] ?? 0;
        samples.push(v >= SWEEP_VCC / 2 ? 1 : 0);
      }
      const cls = classifySequentialSamples(samples);
      if (!cls.ok)
        return { ok: false, reason: `input ${combo}: ${cls.reason}` };
      if (cls.bit) word |= 1 << combo;
      vectors.push({
        in: pins.inPins.map((_, idx) => (combo >> idx) & 1),
        out: cls.bit,
      });
    } finally {
      sim.free();
    }
  }

  // mode:1 ⇒ a REGISTERED LUT (latch-on-CLK), the canonical FPGA logic element.
  return {
    ok: true,
    behavior: { prog: 4, word, mode: 1, sig: cellBehaviorSig(graph) },
    inputs: k,
    vectors,
  };
}

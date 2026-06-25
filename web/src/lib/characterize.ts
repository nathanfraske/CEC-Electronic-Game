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
import { sweepNetlist, SWEEP_VCC, type SweepPins } from "./sweepNetlist";
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
  for (let i = 0; i < pinRoles.length; i++) {
    const r = pinRoles[i];
    if (r === "in") inPins.push(i);
    else if (r === "out" && outPin < 0) outPin = i;
    else if (r === "gnd" && gndPin < 0) gndPin = i;
    else if (r === "vcc" && vccPin < 0) vccPin = i;
  }
  return { inPins, outPin, gndPin, vccPin };
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
  if (pins.outPin < 0)
    return { ok: false, reason: "tag one pin OUT (no output to read)" };
  if (pins.gndPin < 0)
    return { ok: false, reason: "tag one pin GND (no reference)" };
  if (pins.inPins.length === 0)
    return { ok: false, reason: "no input pins to sweep" };
  if (pins.inPins.length > 4)
    return {
      ok: false,
      reason: `${pins.inPins.length} inputs — only ≤4-input gates collapse to one LUT`,
    };

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

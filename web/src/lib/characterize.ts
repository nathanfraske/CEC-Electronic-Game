// SPDX-License-Identifier: Apache-2.0
// CHARACTERIZATION SWEEP (§2.9, the engine's "1"). For a player-built combinational gate cell, drive every
// input combination through a SCRATCH Simulation, read the output level, and assemble the 16-bit prog-4 LUT
// truth-table word the cell can collapse to (see UserIc.behavior / flattenUserIcs). The scratch sim is a
// SECOND, throwaway Simulation — it never touches the global hashed instance, so the golden is untouched.
//
// APP-ONLY: this uses the wasm `Simulation`, which is initialised only in the running app — it can't run in
// the headless test suite. So the sweep itself is verified in-app; the surrounding logic (pin-role parsing,
// guards, the LUT-word indexing) is plain TS.
import { Simulation } from "../wasm/sim_wasm.js";
import { BoardGraph } from "./graph";
import type { GraphSnapshot, PinRole, PinTest } from "./graph";
import { buildNetlist } from "./netlist";
import { dieTestGraph } from "./dieEditor";
import { cellBehaviorSig, type CellBehavior } from "./userIc";

/** Sweep supply / input-HIGH level (volts) and the half-rail digital threshold. */
const SWEEP_VCC = 5;
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
  if (outPin < 0)
    return { ok: false, reason: "tag one pin OUT (no output to read)" };
  if (gndPin < 0)
    return { ok: false, reason: "tag one pin GND (no reference)" };
  if (inPins.length === 0)
    return { ok: false, reason: "no input pins to sweep" };
  if (inPins.length > 4)
    return {
      ok: false,
      reason: `${inPins.length} inputs — only ≤4-input gates collapse to one LUT`,
    };

  const k = inPins.length;
  let word = 0;
  const vectors: SweepVector[] = [];

  for (let combo = 0; combo < 1 << k; combo++) {
    // A throwaway copy of the die graph per vector (≤16 cheap builds for a ≤4-in gate).
    const snap = structuredClone(graph);
    const frame = snap.components.find((c) => c.id === frameId);
    if (!frame) return { ok: false, reason: "die frame missing" };
    // Drive the rails + this combination's inputs as virtual sources (dieTestGraph reads pinTests). The
    // OUTPUT pin is left un-driven so it's free to settle to whatever the gate computes.
    const tests: (PinTest | null)[] = (frame.pinTests ?? []).slice();
    tests[gndPin] = { role: "gnd", value: 0 };
    if (vccPin >= 0) tests[vccPin] = { role: "vcc", value: SWEEP_VCC };
    inPins.forEach((p, idx) => {
      tests[p] = { role: "in", value: (combo >> idx) & 1 ? SWEEP_VCC : 0 };
    });
    frame.pinTests = tests;
    // A 1 GΩ SENSE resistor OUT→GND: high-Z (it can't disturb the gate's drive), and its node[0] in the
    // built netlist IS the OUT net — the clean way to find the output node without a sim-core change.
    const senseId = (snap.nextComponentId ?? 1_000_000) + 1;
    snap.components.push({
      id: senseId,
      kind: "R",
      cell: { col: -16, row: -16 },
      value: 1e9,
      rot: 0,
    } as (typeof snap.components)[number]);
    const wId = (snap.nextWireId ?? 1_000_000) + 1;
    snap.wires.push({
      id: wId,
      from: { componentId: senseId, pinIndex: 0 },
      to: { componentId: frameId, pinIndex: outPin },
    });
    snap.wires.push({
      id: wId + 1,
      from: { componentId: senseId, pinIndex: 1 },
      to: { componentId: frameId, pinIndex: gndPin },
    });

    const bg = new BoardGraph();
    bg.restore(dieTestGraph(snap, frameId));
    const nl = buildNetlist(bg, false);
    if (!nl)
      return {
        ok: false,
        reason: `the gate doesn't solve at input ${combo} — wire it up so it has a complete path`,
      };
    const outNode = nl.nodesOfComponent.get(senseId)?.[0] ?? 0;

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
        in: inPins.map((_, idx) => (combo >> idx) & 1),
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

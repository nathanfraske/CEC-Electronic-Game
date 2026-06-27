// SPDX-License-Identifier: Apache-2.0
// SEQUENTIAL BEHAVIOR TRACE — drive a cell's DISCRETE circuit through a running clock and RECORD the
// per-clock Q response for every input combination, so the UI can show a NEXT-STATE TABLE and a WAVEFORM
// side by side. Unlike characterize.ts (which COLLAPSES a pure D-type next-state to a registered LUT and
// REFUSES anything self-dependent), this only OBSERVES the real circuit — so it works for ANY sequential
// cell (a load-enable register, a toggle, a counter), characterized or not. The numbers it shows are the
// genuine flattened-circuit response, not an approximation.
//
// APP-ONLY: spins up a scratch wasm Simulation (initialised only in the running app), exactly like
// characterize.ts — the determinism-critical per-vector netlist build + OUT-node pick live in the
// headless-tested sweepNetlist.ts; here we only drive the sim and tabulate what it does.
import { Simulation } from "../wasm/sim_wasm.js";
import type { GraphSnapshot, PinRole } from "./graph";
import {
  sequentialSweepNetlist,
  classifySequentialSamples,
  SWEEP_VCC,
  SWEEP_CLK_HALF_STEPS,
  type SweepPins,
} from "./sweepNetlist";
import { analyzeCell, type ResolvedCell } from "./cellAnalysis";

/** Clock HALF-periods sampled per input combination — matches characterizeSequential's settle window, so a
 * pure D-type settles within it and a toggle/counter visibly keeps flipping. */
const SEQ_SAMPLES = 8;

/** A trace beyond this many data inputs is refused — 2^k rows blows up (and the panel can't show it). */
const MAX_TRACE_INPUTS = 6;

/** One input combination's recorded response. */
export interface TraceRow {
  /** the data-input bits, in sweep (pin) order — column values for the next-state table. */
  in: number[];
  /** Q sampled (0/1) after each of {@link SEQ_SAMPLES} clock half-periods — the row's waveform. */
  q: number[];
  /** the SETTLED next-state bit, or `null` when Q never settles (a self-dependent toggle/counter — the
   * waveform still tells the story even though there's no single next-state value). */
  settled: number | null;
}

/** A cell's observed sequential behavior: the swept signals + one {@link TraceRow} per input combination. */
export interface CellTrace {
  /** data-input pin NAMES, in sweep order (the table's input columns). */
  inputNames: string[];
  /** the clock pin name (driven as the square clock). */
  clockName: string;
  /** the observed output pin name (Q). */
  outName: string;
  /** clock half-periods per row (the waveform length). */
  samples: number;
  /** one row per input combination (2^inputs), in index order. */
  rows: TraceRow[];
}

export type TraceResult =
  | { ok: true; trace: CellTrace }
  | { ok: false; reason: string };

/**
 * Observe a clocked cell's behavior over every input combination: for each, install
 * {@link sequentialSweepNetlist} (rails + inputs driven, a square clock on the CLK pin), step across
 * {@link SEQ_SAMPLES} clock half-periods sampling Q, and record the full trace + its settled next-state.
 * Routes the clock/data/output by {@link analyzeCell} (so a CLK-by-name pin is the clock, not a swept
 * input). Returns a {@link CellTrace} for the table + waveform UI, or a reason it can't be traced.
 * APP-ONLY (scratch {@link Simulation}).
 */
export function traceSequentialCell(
  graph: GraphSnapshot,
  frameId: number,
  pinRoles: (PinRole | undefined)[],
  opts?: {
    pinNames?: (string | undefined)[];
    resolveCell?: (tag: string) => ResolvedCell | undefined;
  },
): TraceResult {
  const a = analyzeCell({
    graph,
    frameId,
    pinRoles,
    pinNames: opts?.pinNames,
    resolveCell: opts?.resolveCell,
  });
  if (a.clockPin < 0)
    return {
      ok: false,
      reason:
        "no clock pin — name it CLK (or tag its role) so the trace can drive it",
    };
  if (a.outPin < 0)
    return { ok: false, reason: "no output (Q) pin to observe" };
  if (a.gndPin < 0) return { ok: false, reason: "no GND reference pin" };
  const k = a.dataInputs.length;
  if (k > MAX_TRACE_INPUTS)
    return {
      ok: false,
      reason: `${k} data inputs — only ≤${MAX_TRACE_INPUTS} fit a per-combination trace. Trace a slice.`,
    };

  const pins: SweepPins = {
    inPins: a.dataInputs,
    outPin: a.outPin,
    gndPin: a.gndPin,
    vccPin: a.vccPin,
    clkPin: a.clockPin,
    clkComplementPin: a.clockComplementPin,
  };
  const nameOf = (i: number): string => opts?.pinNames?.[i]?.trim() || `p${i}`;

  const rows: TraceRow[] = [];
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
        return { ok: false, reason: "couldn't install the trace netlist" };
      const q: number[] = [];
      for (let s = 0; s < SEQ_SAMPLES; s++) {
        for (let t = 0; t < SWEEP_CLK_HALF_STEPS; t++) sim.step();
        q.push((sim.state()[outNode] ?? 0) >= SWEEP_VCC / 2 ? 1 : 0);
      }
      const cls = classifySequentialSamples(q);
      rows.push({
        in: a.dataInputs.map((_, idx) => (combo >> idx) & 1),
        q,
        settled: cls.ok ? cls.bit : null,
      });
    } finally {
      sim.free(); // don't leak the wasm object across the 2^k combinations
    }
  }

  return {
    ok: true,
    trace: {
      inputNames: a.dataInputs.map(nameOf),
      clockName: nameOf(a.clockPin),
      outName: nameOf(a.outPin),
      samples: SEQ_SAMPLES,
      rows,
    },
  };
}

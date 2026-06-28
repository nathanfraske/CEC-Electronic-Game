// SPDX-License-Identifier: Apache-2.0
// testBench.ts — the chip TEST BENCH grading engine (§2 of docs/ui/test-bench-design.md). The headless,
// golden-safe drive→settle→read→compare loop that every bench "door" (one-button "Check It", the vector
// grid, divide-and-conquer) sits on.
//
// Distinct from characterize.ts: that EXTRACTS a LUT word with a FIXED settle count (SWEEP_STEPS); this
// GRADES a cell against an expected answer and, crucially, STEPS UNTIL STABLE. Step-until-stable is the
// hard-won lesson from the 4-bit ALU debug — a premature read of a deep cell is a FALSE FAILURE (it nearly
// mis-blamed a correct AND gate). The bench must never report an unsettled read as a result; it reports
// "did not settle" honestly (the debugging analogue of the honest "—").
//
// APP-ONLY in the same sense as characterize: it spins up a SCRATCH `Simulation` (a second, throwaway
// instance — never the global hashed one) and reads only `state()` (node voltages, not hashed). It installs
// no global netlist and folds nothing into `snapshot_hash`, so the golden is untouched. (The wasm core also
// loads headless in node via `initSync`, so this whole engine is unit-testable without a browser.)
import { Simulation } from "../wasm/sim_wasm.js";
import type { GraphSnapshot, PinRole } from "./graph";
import { sweepNetlist, SWEEP_VCC, type SweepPins } from "./sweepNetlist";
import { recognizeGate } from "./userIc";

/** Consecutive quiet ticks before a rig is declared settled (doc §2: `quietN ≈ 8`). */
export const SETTLE_QUIET_N = 8;
/** Hard tick ceiling per vector so a never-settling (oscillating / unstable) rig can't hang the bench. */
export const SETTLE_MAX_TICKS = 4096;

/**
 * Per-node "is it still moving?" tolerance (doc §2): ~10× the solver's `NEWTON_RELTOL` (1e-6) with the
 * abstol lifted off `1e-9 V`, so the bench declares "settled" the moment motion drops below what the solve
 * itself can resolve — it never chases sub-tolerance numerical noise. Clean digital levels (0 / VCC) settle
 * far inside this; it is the analog-rig safety margin.
 */
const settleEps = (v: number): number => 1e-6 + 1e-5 * Math.abs(v);

/**
 * Step a freshly-installed scratch `Simulation` until its node voltages stop moving (below {@link settleEps})
 * for {@link SETTLE_QUIET_N} consecutive ticks, or give up at {@link SETTLE_MAX_TICKS}. Returns whether it
 * settled and how many ticks it took. One batched `state()` read per tick — no per-node boundary crossing.
 */
export function settleUntilStable(
  sim: Simulation,
  opts: { quietN?: number; maxTicks?: number } = {},
): { settled: boolean; ticks: number } {
  const quietN = opts.quietN ?? SETTLE_QUIET_N;
  const maxTicks = opts.maxTicks ?? SETTLE_MAX_TICKS;
  let prev = sim.state().slice();
  let quiet = 0;
  for (let t = 1; t <= maxTicks; t++) {
    sim.step();
    const cur = sim.state();
    let moving = false;
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i] ?? 0;
      const b = prev[i] ?? 0;
      if (Math.abs(a - b) > settleEps(Math.max(Math.abs(a), Math.abs(b)))) {
        moving = true;
        break;
      }
    }
    // copy for the next comparison (state() is a view onto wasm memory; reuse the buffer)
    if (prev.length === cur.length) prev.set(cur);
    else prev = cur.slice();
    if (moving) quiet = 0;
    else if (++quiet >= quietN) return { settled: true, ticks: t };
  }
  return { settled: false, ticks: maxTicks };
}

/** Parse semantic pin roles into the bench/sweep pins. Returns null (with a reason) for a cell the
 *  combinational bench can't grade: no output, no ground, no inputs, >4 inputs, >1 output, or a
 *  bidirectional pin. (Multi-output / wide cells — e.g. a 4-bit ALU — take the Door-2 record-a-run path.) */
export function pinsFromRoles(
  roles: (PinRole | undefined)[],
): { pins: SweepPins; k: number } | { error: string } {
  const inPins: number[] = [];
  let outPin = -1;
  let gndPin = -1;
  let vccPin = -1;
  let clkPin = -1;
  let outCount = 0;
  for (let i = 0; i < roles.length; i++) {
    const r = roles[i];
    if (r === "in") inPins.push(i);
    else if (r === "out") {
      outCount++;
      if (outPin < 0) outPin = i;
    } else if (r === "gnd" && gndPin < 0) gndPin = i;
    else if (r === "vcc" && vccPin < 0) vccPin = i;
    else if (r === "clk" && clkPin < 0) clkPin = i;
    else if (r === "inout")
      return {
        error:
          "this cell has a bidirectional (inout) pin — it both drives and reads, so the combinational bench can't grade it. Record a known-good run instead.",
      };
  }
  if (outPin < 0) return { error: "no output pin to read — tag one pin OUT." };
  if (gndPin < 0)
    return {
      error:
        "no ground pin — the bench needs a powered cell with a ground reference.",
    };
  if (inPins.length === 0) return { error: "no input pins to drive." };
  if (outCount > 1)
    return {
      error: `${outCount} outputs — the one-button bench grades ONE output (a multi-output cell like an adder/ALU uses the vector grid + record-a-run).`,
    };
  if (inPins.length > 4)
    return {
      error: `${inPins.length} inputs — only ≤4-input cells sweep to a single truth table.`,
    };
  return { pins: { inPins, outPin, gndPin, vccPin, clkPin }, k: inPins.length };
}

/** A graded input vector. */
export interface BenchVector {
  /** input bits in pin-role order (i0, i1, …). */
  in: number[];
  /** the settled output level (0/1). */
  out: number;
  /** did this vector's solve stabilize within the tick budget? */
  settled: boolean;
  /** the expected output (only when grading against an op / oracle). */
  expected?: number;
  /** out === expected (only when expected is set). */
  pass?: boolean;
}

export type BenchResult =
  | {
      ok: true;
      /** number of input pins swept (k ≤ 4). */
      inputs: number;
      /** every input combination + its settled output, in combo index order. */
      vectors: BenchVector[];
      /** the swept truth-table word (`out` bit per combo). */
      word: number;
      /** the name `recognizeGate` gives the swept word (AND/OR/NAND/XOR/…), or null. */
      recognizedAs: string | null;
      /** every vector stabilized within budget. */
      allSettled: boolean;
      /** combo indices that never settled (the honest "did not settle"). */
      unsettled: number[];
      /** when graded against an expected op: did every (settled) vector match? */
      allPass?: boolean;
      /** combo index of the first mismatch, or -1. */
      firstFail?: number;
    }
  | { ok: false; reason: string };

/**
 * Grade a small COMBINATIONAL cell: drive every input combination, STEP UNTIL STABLE, read the output, and
 * (optionally) compare to an expected truth word. `graph` is the cell's inner die graph, `frameId` its die
 * frame, `roles` the per-frame-pin semantic roles. Returns the per-vector results + the recognized op +
 * (when `opts.expectedWord` is given) the pass/fail grading. Uses a SCRATCH sim per vector (golden-safe).
 */
export function gradeCombinational(
  graph: GraphSnapshot,
  frameId: number,
  roles: (PinRole | undefined)[],
  opts: { expectedWord?: number; quietN?: number; maxTicks?: number } = {},
): BenchResult {
  const parsed = pinsFromRoles(roles);
  if ("error" in parsed) return { ok: false, reason: parsed.error };
  const { pins, k } = parsed;

  const vectors: BenchVector[] = [];
  const unsettled: number[] = [];
  let word = 0;
  let allPass = opts.expectedWord !== undefined ? true : undefined;
  let firstFail = -1;

  for (let combo = 0; combo < 1 << k; combo++) {
    const built = sweepNetlist(graph, frameId, pins, combo);
    if (!built)
      return {
        ok: false,
        reason: `the cell doesn't solve at input ${combo} — wire it so it has a complete path.`,
      };
    const { nl, outNode } = built;
    const sim = new Simulation(0);
    try {
      const installed = sim.set_netlist_pefgh(
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
      if (!installed)
        return { ok: false, reason: "couldn't install the bench netlist." };
      const { settled } = settleUntilStable(sim, opts);
      const v = sim.state()[outNode] ?? 0;
      const out = v >= SWEEP_VCC / 2 ? 1 : 0;
      if (out) word |= 1 << combo;
      if (!settled) unsettled.push(combo);
      const vec: BenchVector = {
        in: pins.inPins.map((_, idx) => (combo >> idx) & 1),
        out,
        settled,
      };
      if (opts.expectedWord !== undefined) {
        const expected = (opts.expectedWord >> combo) & 1;
        vec.expected = expected;
        vec.pass = out === expected;
        if (!vec.pass) {
          allPass = false;
          if (firstFail < 0) firstFail = combo;
        }
      }
      vectors.push(vec);
    } finally {
      sim.free();
    }
  }

  return {
    ok: true,
    inputs: k,
    vectors,
    word,
    recognizedAs: recognizeGate(word, k),
    allSettled: unsettled.length === 0,
    unsettled,
    ...(opts.expectedWord !== undefined ? { allPass, firstFail } : {}),
  };
}

/** The 2^k truth-table word for a named primitive op (combo encoding `bit(i0 | i1<<1 | …)`), so a player
 *  can pick "test as AND/NOR/…" and the bench GENERATES the answer key. Mirrors {@link recognizeGate}'s
 *  encoding. Returns null for an unknown name/arity. */
export function expectedWordForOp(op: string, inputs: number): number | null {
  const o = op.trim().toUpperCase();
  if (inputs === 1) {
    if (o === "NOT" || o === "INV" || o === "INVERTER") return 0b01;
    if (o === "BUF" || o === "BUFFER") return 0b10;
    return null;
  }
  if (inputs === 2) {
    switch (o) {
      case "AND":
        return 0x8;
      case "OR":
        return 0xe;
      case "NOR":
        return 0x1;
      case "NAND":
        return 0x7;
      case "XOR":
        return 0x6;
      case "XNOR":
        return 0x9;
      default:
        return null;
    }
  }
  return null;
}

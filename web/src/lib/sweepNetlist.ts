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
}

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

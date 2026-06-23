// SPDX-License-Identifier: Apache-2.0
// Die editor: the "drill INTO the package to build the IC inside it" model layer (ADR 0006 /
// docs/ui/ic-maker-guide.md). The player places an empty package FRAME on the outer board, then
// "Build"s it to open that frame's own inner canvas — a DIE whose perimeter pins are the package
// leads and whose bounded interior is where the sub-circuit is wired. This module is the pure,
// presentation-free part of that flow (so it is headless-testable, like netlist.ts):
//
//   - {@link freshDieGraph}  : the inner graph a brand-new frame starts with (just the die itself,
//                              a frame of the same package, positioned roomily so its pins are
//                              spaced + reachable).
//   - {@link dieBounds}      : the buildable interior box (the walls) for a die graph, used by the
//                              renderer to draw the boundary and by the soft containment check.
//   - {@link dieIsSealable}  : the Seal gate — the inner circuit must compile to a real netlist
//                              ({@link buildNetlist} non-null/solvable).
//   - {@link unusedDiePins}  : which package leads the player left unwired (the "all pins used"
//                              advisory before sealing).
//
// The seal ENGINE itself (captureSeal / registerUserIc / flattenUserIcs in userIc.ts) is reused
// unchanged — this module only sets up the die and validates it. Determinism is untouched: a die
// is an ordinary BoardGraph, and a sealed die expands to its real authored netlist exactly as a
// frame sealed inline would (seal-as-same-netlist), so the golden never moves.

import {
  BoardGraph,
  framePackage,
  isFrame,
  isPinRef,
  type GraphSnapshot,
  type Cell,
} from "./graph";
import { packageLayout } from "./packages";
import { buildNetlist } from "./netlist";

/**
 * Slack (in grid cells) left between the die's perimeter pins and the buildable-interior wall, on
 * every side. A frame's footprint is tight to its pins; the die opens a roomy interior so the
 * player can place + wire parts without immediately bumping the walls. Purely presentation/UX —
 * it never affects the netlist (the inner graph is an ordinary board).
 */
export const DIE_INTERIOR_MARGIN = 6;

/**
 * Where the die's own frame is anchored inside the inner canvas. Offset a little from the origin
 * so the boundary box (which extends {@link DIE_INTERIOR_MARGIN} above/left of pin 1) stays in
 * positive grid space and the view frames it nicely on entry.
 */
export const DIE_FRAME_ORIGIN: Cell = { col: 8, row: 8 };

/** The inner graph + the id of the die frame within it (its pins are the package leads). */
export interface DieGraph {
  snapshot: GraphSnapshot;
  /** The die frame component's id inside {@link DieGraph.snapshot}. */
  frameId: number;
}

/**
 * The inner graph a freshly-built frame starts with: a single frame of the SAME package as the
 * placed outer frame (the die), anchored roomily so its perimeter pins are spaced and reachable.
 * The player builds their circuit around/inside this die and wires nets out to its pins; sealing
 * captures the die + everything wired to it (the existing {@link captureSeal} BFS).
 *
 * `frameTag` is the outer frame's kind (e.g. "SOT23_6", "DIP8"); a non-frame tag yields undefined.
 */
export function freshDieGraph(frameTag: string): DieGraph | undefined {
  const pkg = framePackage(frameTag);
  if (!pkg) return undefined;
  const g = new BoardGraph();
  const frame = g.place(frameTag, { ...DIE_FRAME_ORIGIN });
  if (!frame) return undefined;
  return { snapshot: g.serialize(), frameId: frame.id };
}

/**
 * The id of the die frame within an inner graph (the single frame whose pins are the package
 * leads), or undefined if the graph has no frame. A die always contains exactly one frame (the die
 * itself), so this resolves it when re-entering a saved in-progress inner graph (where the original
 * {@link freshDieGraph} frame id is no longer at hand). Returns the lowest-id frame if, defensively,
 * more than one is present.
 */
export function findDieFrameId(snapshot: GraphSnapshot): number | undefined {
  let best: number | undefined;
  for (const c of snapshot.components) {
    if (isFrame(c.kind) && (best === undefined || c.id < best)) best = c.id;
  }
  return best;
}

/**
 * The buildable-interior box (the "walls") for a die, in grid cells: the die frame's footprint
 * grown by {@link DIE_INTERIOR_MARGIN} on every side. The renderer draws this as the boundary and
 * the soft-containment check keeps placement inside it. Returns undefined if `frameId` isn't a
 * frame in the snapshot (so a graph with no die has no walls to draw).
 *
 * The box is derived from the die frame's package layout (not hand-tuned), so it always matches
 * the pin spread — wider packages get wider dies.
 */
export function dieBounds(
  snapshot: GraphSnapshot,
  frameId: number,
):
  | { minCol: number; minRow: number; maxCol: number; maxRow: number }
  | undefined {
  const frame = snapshot.components.find((c) => c.id === frameId);
  if (!frame || !isFrame(frame.kind)) return undefined;
  const pkg = framePackage(frame.kind);
  if (!pkg) return undefined;
  const lay = packageLayout(pkg.archetype, pkg.pinCount);
  // The frame's own footprint extent (pin offsets are >= 0 from its anchor cell).
  let maxDx = 0;
  let maxDy = 0;
  for (const p of lay.pins) {
    maxDx = Math.max(maxDx, p.dx);
    maxDy = Math.max(maxDy, p.dy);
  }
  const m = DIE_INTERIOR_MARGIN;
  return {
    minCol: frame.cell.col - m,
    minRow: frame.cell.row - m,
    maxCol: frame.cell.col + maxDx + m,
    maxRow: frame.cell.row + maxDy + m,
  };
}

/** True if a grid cell sits inside (or on) the die's walls. Used for the soft containment check. */
export function cellInDie(
  cell: Cell,
  bounds: { minCol: number; minRow: number; maxCol: number; maxRow: number },
): boolean {
  return (
    cell.col >= bounds.minCol &&
    cell.col <= bounds.maxCol &&
    cell.row >= bounds.minRow &&
    cell.row <= bounds.maxRow
  );
}

/**
 * Whether a die's inner circuit is a real, sealable IC: it must compile to a solvable netlist
 * ({@link buildNetlist} non-null). This is the hard Seal gate — a die with no return path / no
 * elements / nothing wired to the frame can't become a chip. Reuses the production compiler, so
 * "sealable" means exactly "the sim can run it".
 */
export function dieIsSealable(snapshot: GraphSnapshot): boolean {
  const g = new BoardGraph();
  g.restore(snapshot);
  return buildNetlist(g) !== null;
}

/**
 * The package-lead pin indices the player left unwired in the die (no wire touches that frame pin).
 * Returned in ascending pin index. The Seal flow surfaces this as a soft advisory ("3 of 6 pins
 * used") — leaving leads as no-connects is allowed (the guide's `nc` role), so it never blocks the
 * seal; it just warns. Returns [] for a non-frame id.
 */
export function unusedDiePins(
  snapshot: GraphSnapshot,
  frameId: number,
): number[] {
  const frame = snapshot.components.find((c) => c.id === frameId);
  if (!frame || !isFrame(frame.kind)) return [];
  const pkg = framePackage(frame.kind);
  if (!pkg) return [];
  const pinCount = packageLayout(pkg.archetype, pkg.pinCount).pins.length;
  const wired = new Set<number>();
  for (const w of snapshot.wires) {
    for (const e of [w.from, w.to]) {
      if (isPinRef(e) && e.componentId === frameId) wired.add(e.pinIndex);
    }
  }
  const unused: number[] = [];
  for (let i = 0; i < pinCount; i++) {
    if (!wired.has(i)) unused.push(i);
  }
  return unused;
}

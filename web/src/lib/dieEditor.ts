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
  PART_KINDS,
  dieFrameTag,
  framePackage,
  isFrame,
  isPinRef,
  type GraphSnapshot,
  type Cell,
} from "./graph";
import { buildNetlist } from "./netlist";

/**
 * Slack (in grid cells) left between the die's perimeter pins and the buildable-interior wall, on
 * every side. The die FRAME itself is the roomy perimeter (its pins are spread on the edges via
 * {@link dieLayout}); this margin just sets the walls a little OUTSIDE those edge pins so they sit
 * comfortably inside the boundary rather than on the wall line, and gives a small build apron.
 * Purely presentation/UX — it never affects the netlist (the inner graph is an ordinary board).
 */
export const DIE_INTERIOR_MARGIN = 2;

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
 * The inner graph a freshly-built frame starts with: a single DIE-FRAME of the same package as the
 * placed outer frame, but laid out with its pins on the PERIMETER edges and the interior empty for
 * building ({@link dieFrameTag} / {@link dieLayout}) — the wall you author the IC's circuit inside.
 * The player wires internal nets out to its edge pins; sealing captures the die + everything wired
 * to it (the existing {@link captureSeal} BFS).
 *
 * `frameTag` is the outer frame's PLACEABLE kind (e.g. "SOT23_6", "DIP8"); the die uses its paired
 * internal perimeter kind. The die frame carries the SAME package + SAME pin index order as the
 * outer frame, so the seal maps each lead straight through (this is a visual relayout only). A
 * non-frame tag yields undefined.
 */
export function freshDieGraph(frameTag: string): DieGraph | undefined {
  const pkg = framePackage(frameTag);
  if (!pkg) return undefined;
  const g = new BoardGraph();
  const frame = g.place(dieFrameTag(frameTag), { ...DIE_FRAME_ORIGIN });
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
  const k = PART_KINDS[frame.kind];
  if (!k) return undefined;
  // The die frame's OWN footprint extent — its pins sit on the perimeter edges (dieLayout), so the
  // box already brackets the spread; the margin just pushes the walls a little beyond the edge pins.
  let maxDx = 0;
  let maxDy = 0;
  for (const p of k.pins) {
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
  const k = PART_KINDS[frame.kind];
  if (!k) return [];
  const pinCount = k.pins.length;
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

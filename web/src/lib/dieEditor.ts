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
//   - {@link dieTestGraph}   : injects the frame's per-pin TEST STIMULI (GND / VCC / Input drive)
//                              as virtual sources so a die that is normally powered from OUTSIDE
//                              (a logic IC's VCC/GND) can solve, animate, and pass the Seal gate
//                              while authored in isolation. AUTHORING-ONLY — never sealed.
//
// The seal ENGINE itself (captureSeal / registerUserIc / flattenUserIcs in userIc.ts) is reused
// unchanged — this module only sets up the die and validates it. Determinism is untouched: a die
// is an ordinary BoardGraph, and a sealed die expands to its real authored netlist exactly as a
// frame sealed inline would (seal-as-same-netlist), so the golden never moves. The test stimuli
// are likewise determinism-safe: they are injected ONLY for the live editor solve + the Seal gate,
// NEVER before {@link captureSeal} (which reads the RAW live die graph), so the sealed netlist is
// exactly the player's real discrete parts.

import {
  BoardGraph,
  PART_KINDS,
  DIE_FRAME_PREFIX,
  dieFrameTag,
  framePackage,
  freeFormGeom,
  isDieFrame,
  isFrame,
  isPinRef,
  type GraphSnapshot,
  type Cell,
  type Component,
  type Wire,
} from "./graph";
import { dieLayout } from "./packages";
import { buildNetlist } from "./netlist";
import { PITCH } from "./boardRender";
// The SEALED package body's margins (px), so the die-editor walls track the SAME body box the seal
// fits the inner circuit into — see `userIcBodyBox` in glyphs.ts. (Keeps drill-in == sealed, no overhang.)
import { IC_BODY_PAD, IC_LEAD_LEN } from "./glyphs";

/**
 * Breathing room (in grid cells) the die-editor CAMERA leaves around the die body when it frames
 * the view on entry — NOT a wall offset. The walls now sit exactly on the die body box so the
 * package leads land ON them ({@link dieBounds} / {@link dieLayout}); this pad only keeps the walls
 * off the very edge of the screen. Purely presentation/UX — it never affects the netlist.
 */
export const DIE_INTERIOR_MARGIN = 2;

/**
 * Where the die's own frame is anchored inside the inner canvas. Offset from the origin so the
 * whole die body (anchored here and extending right/down to its package footprint) sits in positive
 * grid space and the view frames it nicely on entry.
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

/** The package-body margins the die walls use, IN CELLS — derived from the SEALED body's px margins
 * (`userIcBodyBox`, glyphs.ts) so the drill-in buildable area IS the region the seal fits the circuit
 * into (no authoring into margin that overhangs the real body). `DIE_BODY_PAD` overhangs the LONG
 * (array) axis past the end leads (the card overhang); `DIE_LEAD_INSET` pulls the SHORT (lead-stick)
 * axis IN off the lead line, so the leads stick OUT past the body like a real package. */
const DIE_BODY_PAD = IC_BODY_PAD / PITCH; // array-axis overhang (~0.38 cell)
const DIE_LEAD_INSET = IC_LEAD_LEN / PITCH; // stick-axis inset (~0.62 cell)

/**
 * The buildable-interior box (the "walls") for a die, in grid cells: the package BODY box, anchored at
 * the frame. The renderer draws this as the boundary and the soft-containment check keeps placement
 * inside it. Returns undefined if `frameId` isn't a frame in the snapshot (so a graph with no die has
 * no walls to draw).
 *
 * This box matches `userIcBodyBox` (glyphs.ts) — the SAME body box the sealed IC / its zoom-to-open
 * replica fits the inner circuit into — so what you author against the walls is exactly what the seal
 * keeps, with no overhang (owner: "the drill in is wider than the real thing"). The long (array) axis
 * overhangs the end leads by {@link DIE_BODY_PAD} (corner leads inset, never jammed); the short
 * (lead-stick) axis insets by {@link DIE_LEAD_INSET} so the leads cross the wall and stick OUT.
 */
export function dieBounds(
  snapshot: GraphSnapshot,
  frameId: number,
):
  | { minCol: number; minRow: number; maxCol: number; maxRow: number }
  | undefined {
  const frame = snapshot.components.find((c) => c.id === frameId);
  if (!frame || !isFrame(frame.kind)) return undefined;
  // Free-form (box-captured) subassembly: the walls ARE the captured box (§4.10), exactly — no package
  // layout, no lead overhang/inset (its pins already sit on the box edge).
  const ff = freeFormGeom(frame.kind);
  if (ff) {
    return {
      minCol: frame.cell.col,
      minRow: frame.cell.row,
      maxCol: frame.cell.col + (ff.w - 1),
      maxRow: frame.cell.row + (ff.h - 1),
    };
  }
  const pkg = framePackage(frame.kind);
  if (!pkg) return undefined;
  const { w, h } = dieLayout(pkg.archetype, pkg.pinCount);
  // dieLayout pins span [0, w-1] × [0, h-1]. Overhang the array axis by DIE_BODY_PAD; INSET the stick
  // axis by DIE_LEAD_INSET — exactly the margins userIcBodyBox applies to the sealed package body.
  const alongX = w >= h;
  const pad = DIE_BODY_PAD;
  const inset = DIE_LEAD_INSET;
  return {
    minCol: frame.cell.col - (alongX ? pad : -inset),
    minRow: frame.cell.row - (alongX ? -inset : pad),
    maxCol: frame.cell.col + (w - 1) + (alongX ? pad : -inset),
    maxRow: frame.cell.row + (h - 1) + (alongX ? -inset : pad),
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
 * A COPY of the die graph with the frame's per-pin TEST STIMULI injected as virtual sources, so a
 * die that is normally powered from OUTSIDE its package (a logic IC takes VCC/GND from the board it
 * sits on) can be solved, animated, and Seal-gated while authored in ISOLATION in the die editor.
 *
 * Each non-null {@link PinTest} on `frame.pinTests` becomes a virtual source wired to that lead:
 *   - `gnd` → a wire from a single shared virtual {@link BoardGraph} `GND` part to the pin (a 0 V
 *     reference, the thing a logic die lacks on its own — this is what makes it solvable);
 *   - `vcc` / `in` → a `V` source at the pin's voltage (its `+` to the lead, its `−` to that same
 *     shared ground), so the die powers up / sees an input drive.
 * (`buildNetlist` roots node 0 on a wired GND part, else a V source's `−` pin — netlist.ts lines
 * 797-819 — so the shared ground anchors the reference and every V source hangs off it.)
 *
 * **STRICT NO-OP** when the frame has no stimuli (absent or all-null `pinTests`): returns the input
 * `snapshot` UNCHANGED (same reference), so a fully-powered die (one wired up the ordinary way) is
 * byte-identical and nothing is ever added to an already-solvable graph.
 *
 * **AUTHORING-ONLY — the result is NEVER sealed.** The seal capture ({@link captureSeal}) reads the
 * RAW live die graph, not this injected copy, so the sealed IC stays exactly the player's real
 * discrete parts and the sim-core golden is untouched (the hard determinism rule, ADR 0005). This
 * graph is used ONLY for the live editor solve and the {@link dieIsSealable} gate.
 *
 * The injected parts are placed at far-off negative cells (well outside the build area) so they
 * never overlap the authored circuit or each other; the returned snapshot advances
 * `nextComponentId` / `nextWireId` past them. Returns `snapshot` unchanged if `frameId` is missing.
 */
export function dieTestGraph(
  snapshot: GraphSnapshot,
  frameId: number,
): GraphSnapshot {
  const frame = snapshot.components.find((c) => c.id === frameId);
  const tests = frame?.pinTests;
  // Strict no-op: no frame, or no non-null stimulus → hand back the same snapshot untouched.
  if (!frame || !tests || !tests.some((t) => t)) return snapshot;

  const components: Component[] = snapshot.components.map((c) => ({ ...c }));
  const wires: Wire[] = snapshot.wires.map((w) => ({ ...w }));
  let nextC = snapshot.nextComponentId;
  let nextW = snapshot.nextWireId;

  // One shared virtual ground (node 0), far off-grid so it never overlaps the build area. Every
  // `gnd` pin and every V source's `−` lead ties back to this single reference.
  const gndId = nextC++;
  components.push({
    id: gndId,
    kind: "GND",
    cell: { col: -8, row: -8 },
    value: 0,
    rot: 0,
  });

  const wire = (a: Wire["from"], b: Wire["to"]): void => {
    wires.push({ id: nextW++, from: a, to: b });
  };

  // Walk pins low→high; lay each injected V source at its own far-off cell so none collide.
  let vCol = -12;
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    if (!t) continue;
    if (t.role === "gnd") {
      // Tie the lead straight to the shared ground (a 0 V reference for this pin).
      wire(
        { componentId: gndId, pinIndex: 0 },
        { componentId: frameId, pinIndex: i },
      );
    } else {
      // A virtual supply / input drive: V's `+` (pin 0) to the lead, V's `−` (pin 1) to ground.
      const vId = nextC++;
      components.push({
        id: vId,
        kind: "V",
        cell: { col: vCol, row: -10 },
        value: t.value,
        rot: 0,
      });
      vCol -= 2; // next source one cell-pair further out, so injected parts never overlap
      wire(
        { componentId: vId, pinIndex: 0 },
        { componentId: frameId, pinIndex: i },
      );
      wire(
        { componentId: vId, pinIndex: 1 },
        { componentId: gndId, pinIndex: 0 },
      );
    }
  }

  return {
    ...snapshot,
    components,
    wires,
    nextComponentId: nextC,
    nextWireId: nextW,
  };
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

// --- Persisting in-progress (unsealed) dies with the board -----------------------------------------
//
// A sealed IC's authored circuit rides in the save's `userIcs` (the registry def). But an UNSEALED
// frame's work-in-progress die lives only in the in-memory `innerGraphs` map in App.svelte, keyed by
// the OUTER frame's component id — so without help it is lost on save+reload (the frame re-opens
// blank). These pure helpers (headless-testable, no Pixi) marshal that map to/from the save envelope.
// Determinism is untouched: this is graph/save plumbing — an unsealed frame still has no sim element,
// and once sealed/placed an IC flattens to its real parts at buildNetlist, so the golden cannot move.

/**
 * One in-progress die for the save envelope: the OUTER frame component id it belongs to (the key into
 * App.svelte's `innerGraphs`) and the work-in-progress inner graph (the die frame + everything the
 * player has wired inside it). Plain JSON — round-trips through the downloaded save / localStorage.
 */
export interface InnerDie {
  /** the OUTER frame component id this die belongs to (preserved by serialize/restore, so it still
   * matches the placed frame on reload — the `innerGraphs` key lines up again). */
  frameId: number;
  /** the work-in-progress inner graph (the die frame + the authored sub-circuit). */
  graph: GraphSnapshot;
}

/**
 * The in-progress dies to embed in a save: one {@link InnerDie} per entry of `innerGraphs` whose frame
 * id is actually PLACED in `graph` (a frame still on the outer board). Filtering to placed frames keeps
 * the save tight — it never carries a die for a frame the player deleted (its `innerGraphs` entry is
 * stale once the frame is gone). Returns `[]` when no placed frame has a stashed die, so a plain board
 * embeds no `innerDies` and its save shape is unchanged.
 */
export function innerDiesForSave(
  innerGraphs: ReadonlyMap<number, GraphSnapshot>,
  graph: GraphSnapshot,
): InnerDie[] {
  const placed = new Set<number>();
  for (const c of graph.components) {
    if (isFrame(c.kind)) placed.add(c.id);
  }
  const out: InnerDie[] = [];
  for (const [frameId, inner] of innerGraphs) {
    if (placed.has(frameId)) out.push({ frameId, graph: inner });
  }
  return out;
}

/**
 * Rebuild the live `innerGraphs` map from a save's `innerDies` (in place): clear it, then install each
 * saved WIP die under its outer-frame id. Called on every load BEFORE/while restoring the outer board,
 * so re-drilling a placed frame finds its saved work-in-progress (the frame keeps its id across
 * serialize/restore, so the key matches). A no-op clear when `innerDies` is absent/empty — an older
 * save with no field simply leaves the map empty, exactly as today.
 */
export function restoreInnerDies(
  innerDies: InnerDie[] | undefined,
  innerGraphs: Map<number, GraphSnapshot>,
): void {
  innerGraphs.clear();
  for (const d of innerDies ?? []) innerGraphs.set(d.frameId, d.graph);
}

/**
 * The PLACEABLE frame tag a die-frame tag pairs with — the inverse of {@link dieFrameTag}, i.e. the die
 * tag with its {@link DIE_FRAME_PREFIX} stripped (e.g. "__DIE_SOT23_5" -> "SOT23_5"). Used to recover a
 * raw saved die snapshot into the builder: it tells us which placeable frame to synthesize on a fresh
 * outer board so we can drill back into the loaded die. Returns undefined for a non-die tag.
 */
export function placeableFrameTag(dieTag: string): string | undefined {
  if (!isDieFrame(dieTag)) return undefined;
  return dieTag.slice(DIE_FRAME_PREFIX.length);
}

/**
 * Whether a loaded snapshot is a DIE graph saved in ISOLATION (the owner's existing `__DIE_*` saves) —
 * a graph whose only frame is the internal die-frame variant, rather than a normal outer board. The
 * loader uses this to OPEN such a file straight into the die builder (synthesize an outer context +
 * drill in) instead of dropping the die-frame onto a flat board as a placed part. True only when
 * {@link findDieFrameId} resolves a frame AND that frame is a die-frame ({@link isDieFrame}); a normal
 * board never contains a `__DIE_*` frame (those are interior-only, never placeable), so this is false
 * for every ordinary save — including one that merely places sealed ICs or empty placeable frames.
 */
export function isStandaloneDieGraph(snapshot: GraphSnapshot): boolean {
  const fid = findDieFrameId(snapshot);
  if (fid === undefined) return false;
  const frame = snapshot.components.find((c) => c.id === fid);
  return !!frame && isDieFrame(frame.kind);
}

// SPDX-License-Identifier: Apache-2.0
// User-authored ICs (the IC maker, ADR 0006 / docs/ui/ic-maker-guide.md). A sealed IC is a circuit
// the player built inside a frame: the frame's pins are the package leads, and the components wired
// to them are the IC's internals. Sealing stores that inner circuit as a `UserIc` and registers a
// placeable kind (package footprint + pins). When a sealed IC is placed, `flattenUserIcs` inlines its
// inner circuit into the board BEFORE `buildNetlist` runs, fusing each frame pin to the placed
// instance's matching pin. So the sim sees the real discrete parts, wired exactly as authored — this
// is ADR 0005's "seal-as-same-netlist": the seal is bookkeeping, the netlist is the genuine circuit.
//
// Determinism: flattening is a pure graph->graph transform (deterministic id remap in sorted order);
// it is a strict no-op when no sealed IC is placed, so every existing circuit (and the golden) is
// byte-identical. One-layer nesting (an inner circuit never contains another user IC) keeps it a
// single pass.
import {
  BoardGraph,
  PART_KINDS,
  isJunctionRef,
  type GraphSnapshot,
  type Endpoint,
  type PartKind,
  type Pin,
} from "./graph";
import { packageLayout } from "./packages";

/** A sealed, user-authored IC. */
export interface UserIc {
  /** the placeable kind tag (e.g. an auto "CEC9001" or a free-form name). */
  tag: string;
  name: string;
  package: { archetype: string; pinCount: number };
  /** the frame component's id WITHIN `graph` — its pins are the package leads. */
  frameId: number;
  /** the inner circuit, INCLUDING the frame (the authored sub-graph). */
  graph: GraphSnapshot;
}

/** tag -> sealed IC definition. Populated by `registerUserIc` (sealing / loading a saved library). */
const REGISTRY = new Map<string, UserIc>();

/** Whether a kind tag is a sealed user IC (a flatten-on-build composite, no sim element of its own). */
export function isUserIc(tag: string): boolean {
  return REGISTRY.has(tag);
}

/** The sealed IC for a tag, or undefined. */
export function getUserIc(tag: string): UserIc | undefined {
  return REGISTRY.get(tag);
}

/** All registered sealed IC tags (for the part bin / persistence). */
export function userIcTags(): string[] {
  return [...REGISTRY.keys()];
}

/** Build the placeable `PartKind` for a sealed IC from its package (footprint + numbered pins). */
function userIcPartKind(ic: UserIc): PartKind {
  const lay = packageLayout(ic.package.archetype, ic.package.pinCount);
  const pins: Pin[] = lay.pins.map((p, i) => ({
    index: i,
    label: String(p.number),
    dx: p.dx,
    dy: p.dy,
  }));
  const w = pins.reduce((m, p) => Math.max(m, p.dx), 0) + 1;
  const h = pins.reduce((m, p) => Math.max(m, p.dy), 0) + 1;
  // accent-tinted so a sealed user IC reads as a distinct (player-made) part; no value/unit, and
  // deliberately absent from TYPE_OF so buildNetlist treats the placed instance as a no-element hub.
  return {
    tag: ic.tag,
    name: ic.name,
    colorKey: "accent",
    pins,
    w,
    h,
    defaultValue: 0,
    unit: "",
    ideal: true,
  };
}

/** Register a sealed IC: store its definition and make it a placeable kind. Idempotent per tag. */
export function registerUserIc(ic: UserIc): void {
  REGISTRY.set(ic.tag, ic);
  PART_KINDS[ic.tag] = userIcPartKind(ic);
}

/** Forget a sealed IC (and unregister its kind). */
export function unregisterUserIc(tag: string): void {
  REGISTRY.delete(tag);
  delete PART_KINDS[tag];
}

/**
 * Inline every placed sealed-IC instance's inner circuit into a copy of `graph`, ready for
 * `buildNetlist`. For each instance: its inner components/wires are added with offset ids, and each
 * inner wire that touched the frame is re-pointed at the placed instance's matching pin — so the
 * external board net and the inner net become one (the pad-to-lead fusion). The instance itself stays
 * as a no-element hub (its kind has no `TYPE_OF`). A strict no-op (returns the input) when no sealed
 * IC is placed, so normal circuits are unaffected.
 */
export function flattenUserIcs(graph: BoardGraph): BoardGraph {
  let any = false;
  for (const c of graph.components.values()) {
    if (REGISTRY.has(c.kind)) {
      any = true;
      break;
    }
  }
  if (!any) return graph;

  const snap = graph.serialize();
  const comps = [...snap.components];
  const wires = [...snap.wires];
  const junctions = [...(snap.junctions ?? [])];

  // Deterministic per-instance id offset (instances processed in id order). The base sits well above
  // any realistic hand/saved id; each instance gets its own stride so inner ids never collide.
  const STRIDE = 1_000_000;
  let off = STRIDE;
  const instances = snap.components
    .filter((c) => REGISTRY.has(c.kind))
    .sort((a, b) => a.id - b.id);

  for (const inst of instances) {
    const def = REGISTRY.get(inst.kind)!;
    const inner = def.graph;
    const o = off;
    off += STRIDE;
    // An inner endpoint -> outer: the frame's pins become the placed instance's pins (same index);
    // every other inner component/junction is offset into a private id range.
    const remap = (e: Endpoint): Endpoint =>
      isJunctionRef(e)
        ? { junctionId: e.junctionId + o }
        : {
            componentId:
              e.componentId === def.frameId ? inst.id : e.componentId + o,
            pinIndex: e.pinIndex,
          };
    for (const ic of inner.components) {
      if (ic.id === def.frameId) continue; // the frame is replaced by the placed instance
      comps.push({ ...ic, id: ic.id + o, cell: { ...ic.cell } });
    }
    for (const j of inner.junctions ?? []) {
      junctions.push({ ...j, id: j.id + o, cell: { ...j.cell } });
    }
    for (const w of inner.wires) {
      wires.push({
        id: w.id + o,
        from: remap(w.from),
        to: remap(w.to),
        ...(w.waypoints && w.waypoints.length > 0
          ? { waypoints: w.waypoints.map((c) => ({ ...c })) }
          : {}),
      });
    }
  }

  const out = new BoardGraph();
  out.restore({
    ...snap,
    components: comps,
    wires,
    junctions,
    nextComponentId: off,
    nextWireId: off,
    nextJunctionId: off,
  });
  return out;
}

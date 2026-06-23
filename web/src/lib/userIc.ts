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
  isPinRef,
  framePackage,
  type GraphSnapshot,
  type Endpoint,
  type PartKind,
  type Pin,
  type Wire,
  type Junction,
  type NetLabel,
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

/** The house auto-id counter for unnamed seals: the next number in the `CEC9xxx` series
 * (ADR 0006 / docs/ui/ic-maker-guide.md §6). Starts at 9001 and increments per auto-named
 * seal; bumped past any collision so an auto id never lands on a tag already in use. */
let autoSeq = 9001;

/** The next free `CEC9xxx` auto tag, skipping any already taken (manual reuse, a reload).
 * Advances {@link autoSeq} so successive unnamed seals get CEC9001, CEC9002, ... */
function nextAutoTag(): string {
  let tag = "CEC" + autoSeq;
  while (REGISTRY.has(tag) || PART_KINDS[tag]) {
    autoSeq++;
    tag = "CEC" + autoSeq;
  }
  autoSeq++;
  return tag;
}

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

/** What {@link captureSeal} sealed: the new IC's `tag` plus the LIVE-graph ids it consumed,
 * so the caller (board.ts) can collapse the frame + its circuit — delete those, drop a placed
 * instance of `tag` where the frame sat, and re-point any external wires onto the instance. */
export interface SealCapture {
  /** the placeable kind tag the seal registered (the auto `CEC9xxx`, or the chosen name). */
  tag: string;
  /** ids of the live components folded INTO the IC (the frame + all its wired internals). */
  capturedComponentIds: number[];
  /** ids of the live wires folded into the IC (a wire with BOTH ends inside the capture). */
  capturedWireIds: number[];
  /** ids of the live junctions folded into the IC (every junction reached by the BFS). */
  capturedJunctionIds: number[];
  /** the cell the frame occupied — where the collapsed instance should land. */
  frameCell: { col: number; row: number };
}

/**
 * Capture the circuit a player built inside a frame as a sealed {@link UserIc}, ready to place.
 *
 * Starting at the frame, a breadth-first search walks the board's WIRES (through junctions) to
 * gather the connected sub-graph — the frame plus every component, wire, and junction reachable
 * from its pins. That set IS the IC's internals; its frame pins are the package leads. The
 * sub-graph is snapshotted verbatim (ids preserved, so `frameId` still addresses the frame), the
 * package is read back from the frame's kind via {@link framePackage}, and the seal is registered
 * (which makes `tag` a placeable kind). Returns the {@link SealCapture} the board uses to collapse
 * the live graph (it does NOT mutate `graph` — capture is read-only; the board does the removal +
 * instance placement so the whole thing is one undo step).
 *
 * `name` is the free-form part name; omitted, it auto-assigns the next house `CEC9xxx` id (and the
 * tag matches). Returns undefined only if `frameId` isn't a live frame component.
 *
 * NB: connectivity here is the physical wire graph (the v1 authoring model — ICs are built
 * standalone). A net-label GLOBAL alias (two same-named labels with no wire between them) is not a
 * traversal edge, so a sub-circuit joined only by such an alias would not be pulled in; that is an
 * out-of-scope authoring style for now. Labels sitting ON captured endpoints are carried along so
 * their net names survive the round-trip.
 */
export function captureSeal(
  graph: BoardGraph,
  frameId: number,
  name?: string,
): SealCapture | undefined {
  const frame = graph.components.get(frameId);
  if (!frame) return undefined;
  const pkg = framePackage(frame.kind);
  if (!pkg) return undefined; // not a frame kind -> nothing to seal

  // BFS over the physical graph: components and junctions are the nodes; a wire is an edge
  // between its two endpoints. Seed with the frame; pull in whatever each frontier node's wires
  // reach. Junctions are nodes too (a wire-to-wire tie), so a circuit joined through a junction
  // dot is captured whole.
  const comps = new Set<number>([frameId]);
  const juncs = new Set<number>();
  const wireIds = new Set<number>();
  const wires = [...graph.wires.values()];

  // The component / junction an endpoint belongs to (a pin -> its component; a junction -> itself),
  // so a wire can be followed from either side.
  const endComp = (e: Endpoint): number | undefined =>
    isPinRef(e) ? e.componentId : undefined;
  const endJunc = (e: Endpoint): number | undefined =>
    isJunctionRef(e) ? e.junctionId : undefined;

  // Repeat the relaxation until no new node is reached. Each pass scans every wire and, if one of
  // its ends is already inside the set, adds the other end's node (and marks the wire captured).
  let grew = true;
  while (grew) {
    grew = false;
    for (const w of wires) {
      const fc = endComp(w.from);
      const fj = endJunc(w.from);
      const tc = endComp(w.to);
      const tj = endJunc(w.to);
      const fromIn =
        (fc !== undefined && comps.has(fc)) ||
        (fj !== undefined && juncs.has(fj));
      const toIn =
        (tc !== undefined && comps.has(tc)) ||
        (tj !== undefined && juncs.has(tj));
      if (!fromIn && !toIn) continue;
      if (!wireIds.has(w.id)) {
        wireIds.add(w.id);
        grew = true;
      }
      // Pull the not-yet-seen node on each end into the set.
      for (const [c, j] of [
        [fc, fj],
        [tc, tj],
      ] as const) {
        if (c !== undefined && !comps.has(c)) {
          comps.add(c);
          grew = true;
        }
        if (j !== undefined && !juncs.has(j)) {
          juncs.add(j);
          grew = true;
        }
      }
    }
  }

  // Snapshot just the captured nodes/edges, preserving ids (so `frameId` still points at the frame
  // and the inner ids match the wires' endpoint refs). Build it off a full serialize, then filter.
  const full = graph.serialize();
  const capComps = full.components
    .filter((c) => comps.has(c.id))
    .map((c) => ({ ...c, cell: { ...c.cell } }));
  const capJuncs: Junction[] = (full.junctions ?? [])
    .filter((j) => juncs.has(j.id))
    .map((j) => ({
      id: j.id,
      cell: { ...j.cell },
      ...(j.free ? { free: true } : {}),
    }));
  const capWires: Wire[] = full.wires
    .filter((w) => wireIds.has(w.id))
    .map((w) => ({
      id: w.id,
      from: { ...w.from },
      to: { ...w.to },
      ...(w.waypoints && w.waypoints.length > 0
        ? { waypoints: w.waypoints.map((c) => ({ ...c })) }
        : {}),
    }));
  // Carry along any net labels anchored ON a captured endpoint (so the inner nets keep their
  // names); a label whose anchor is outside the capture is left on the board.
  const capLabels: NetLabel[] = (full.netLabels ?? [])
    .filter((l) => {
      const c = endComp(l.at);
      const j = endJunc(l.at);
      return (
        (c !== undefined && comps.has(c)) || (j !== undefined && juncs.has(j))
      );
    })
    .map((l) => ({
      id: l.id,
      name: l.name,
      at: { ...l.at },
      ...(l.pos ? { pos: { ...l.pos } } : {}),
      ...(l.tagOff ? { tagOff: { ...l.tagOff } } : {}),
      ...(l.color !== undefined ? { color: l.color } : {}),
    }));

  // Id counters that clear every captured id, so the snapshot is a self-consistent graph.
  const maxId = (ids: number[]): number =>
    ids.reduce((m, id) => Math.max(m, id), 0);
  const snapshot: GraphSnapshot = {
    components: capComps,
    wires: capWires,
    junctions: capJuncs,
    netLabels: capLabels,
    nextComponentId: maxId(capComps.map((c) => c.id)) + 1,
    nextWireId: maxId(capWires.map((w) => w.id)) + 1,
    nextJunctionId: maxId(capJuncs.map((j) => j.id)) + 1,
    nextNetLabelId: maxId(capLabels.map((l) => l.id)) + 1,
  };

  const tag = name && name.trim() ? name.trim() : nextAutoTag();
  registerUserIc({
    tag,
    name: name && name.trim() ? name.trim() : tag,
    package: pkg,
    frameId,
    graph: snapshot,
  });

  return {
    tag,
    capturedComponentIds: [...comps],
    capturedWireIds: [...wireIds],
    capturedJunctionIds: [...juncs],
    frameCell: { col: frame.cell.col, row: frame.cell.row },
  };
}

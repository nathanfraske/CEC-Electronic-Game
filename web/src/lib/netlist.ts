// SPDX-License-Identifier: Apache-2.0
// Compile the interactive board into a solver netlist. Pins joined by wires form
// nets (nodes); the ideal two-terminal kinds (V/R/C/L/I) become elements. Ground
// (node 0) is an explicit GND part's net if one is present, else the fallback of
// the first voltage source's "−" pin — so current-source-only circuits, which
// have no voltage source to borrow a reference from, are still simulatable.
// Returns the flat arrays the wasm `set_netlist` wants, plus the maps the
// renderer needs to attribute per-element current and per-net voltage back to
// each component.

import { BoardGraph, endpointKey } from "./graph";
import type { ElectricalState } from "./glyphs";

// Solver element types, keyed by part tag. Only kinds listed here become
// elements; 1-pin reference parts (GND) are deliberately absent so the element
// loop skips them. Mirrors the `ELEM_*` constants in `crates/sim-core/src/lib.rs`.
const TYPE_OF: Record<string, number> = {
  V: 0,
  R: 1,
  C: 2,
  L: 3,
  I: 4,
  D: 5, // diode (nonlinear; engages the Newton solve)
  SW: 6, // clock-driven switch; value = duty cycle
  AC: 7, // sinusoidal voltage source; value = frequency (Hz)
  SD: 8, // Schottky diode (nonlinear; low ~0.3 V forward drop)
  LED: 9, // LED (nonlinear; ~1.9 V drop, brightness tracks forward current)
};

export interface BuiltNetlist {
  nodeCount: number;
  types: Uint8Array;
  a: Uint32Array;
  b: Uint32Array;
  values: Float64Array;
  /** component id → element index (into `element_currents`). */
  elemOfComponent: Map<number, number>;
  /** component id → [nodeA, nodeB] (into `node_voltages`). */
  nodesOfComponent: Map<number, [number, number]>;
  /** Current-source component ids whose forced current has no return path. */
  floatingSources: number[];
  /** Topology+values signature; unchanged across pure moves so the sim isn't reset. */
  sig: string;
}

export function buildNetlist(graph: BoardGraph): BuiltNetlist | null {
  // Union-find over wire endpoints: pins (keyed "componentId:pinIndex") AND
  // junctions (keyed "j<id>"). A junction is not an element — it only joins the
  // wire-ends that meet at it into one net, exactly like a wire does.
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k);
    if (p === undefined) {
      parent.set(k, k);
      return k;
    }
    if (p === k) return k;
    const root = find(p);
    parent.set(k, root);
    return root;
  };
  const union = (x: string, y: string): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };
  const key = (compId: number, pin: number): string => compId + ":" + pin;

  const sorted = [...graph.components.values()].sort((p, q) => p.id - q.id);
  const junctions = [...graph.junctions.values()].sort((p, q) => p.id - q.id);
  for (const c of sorted) {
    const kind = graph.kindOf(c);
    if (!kind) continue;
    for (const p of kind.pins) find(key(c.id, p.index));
  }
  // Seed each junction as its own singleton so a junction joining only wires
  // (no pin yet) is still a real net node, numbered deterministically below.
  for (const j of junctions) find(endpointKey({ junctionId: j.id }));
  for (const w of graph.wires.values()) {
    union(endpointKey(w.from), endpointKey(w.to));
  }

  // How many pins share each net, so we can tell a ground that's actually wired
  // into the circuit from one just sitting on the board.
  const netSize = new Map<string, number>();
  for (const c of sorted) {
    const kind = graph.kindOf(c);
    if (!kind) continue;
    for (const p of kind.pins) {
      const r = find(key(c.id, p.index));
      netSize.set(r, (netSize.get(r) ?? 0) + 1);
    }
  }

  // Ground (node 0): a *connected* explicit GND part's net wins if one is placed
  // — this is what lets a current-source-only loop simulate (no voltage source to
  // borrow a reference from). A GND floating on the board with nothing wired to it
  // is ignored, so it can't make a disconnected circuit falsely "solve". Otherwise
  // fall back to the first voltage source's "−" pin (index 1).
  let groundRoot: string | null = null;
  for (const c of sorted) {
    if (c.kind !== "GND") continue;
    const r = find(key(c.id, 0)); // GND is a 1-pin part
    if ((netSize.get(r) ?? 0) > 1) {
      groundRoot = r; // wired to at least one other pin
      break;
    }
  }
  if (groundRoot === null) {
    for (const c of sorted) {
      if (c.kind === "V") {
        groundRoot = find(key(c.id, 1));
        break;
      }
    }
  }
  if (groundRoot === null) return null; // no reference → not simulatable

  const nodeIndex = new Map<string, number>([[groundRoot, 0]]);
  let next = 1;
  for (const c of sorted) {
    const kind = graph.kindOf(c);
    if (!kind) continue;
    for (const p of kind.pins) {
      const r = find(key(c.id, p.index));
      if (!nodeIndex.has(r)) nodeIndex.set(r, next++);
    }
  }
  // Number any net rooted only at a junction (one that joins wires reaching no
  // pin). Junctions sorted by id keeps this deterministic and move-invariant.
  for (const j of junctions) {
    const r = find(endpointKey({ junctionId: j.id }));
    if (!nodeIndex.has(r)) nodeIndex.set(r, next++);
  }
  const nodeCount = next;

  const types: number[] = [];
  const aArr: number[] = [];
  const bArr: number[] = [];
  const values: number[] = [];
  const elemOfComponent = new Map<number, number>();
  const nodesOfComponent = new Map<number, [number, number]>();
  for (const c of sorted) {
    const t = TYPE_OF[c.kind];
    if (t === undefined) continue;
    const kind = graph.kindOf(c);
    if (!kind || kind.pins.length < 2) continue;
    const na = nodeIndex.get(find(key(c.id, 0))) ?? 0;
    const nb = nodeIndex.get(find(key(c.id, 1))) ?? 0;
    const idx = types.length;
    types.push(t);
    aArr.push(na);
    bArr.push(nb);
    values.push(c.value);
    elemOfComponent.set(c.id, idx);
    nodesOfComponent.set(c.id, [na, nb]);
  }
  if (types.length === 0) return null;

  // Incomplete-circuit check: an ideal current source whose forced current has no
  // return path (its two nodes aren't joined through any *other* element) makes
  // the system singular → a confident but meaningless reading. Find such sources
  // by union-finding nodes over every non-current-source element, then testing
  // whether each current source's two nodes are connected without it.
  const parent2 = Array.from({ length: nodeCount }, (_, i) => i);
  const f2 = (x: number): number => {
    while (parent2[x] !== x) {
      parent2[x] = parent2[parent2[x]!]!;
      x = parent2[x]!;
    }
    return x;
  };
  const u2 = (x: number, y: number): void => {
    parent2[f2(x)] = f2(y);
  };
  for (const c of sorted) {
    const t = TYPE_OF[c.kind];
    if (t === undefined || t === 4) continue; // skip non-elements and I sources
    const kind = graph.kindOf(c);
    if (!kind || kind.pins.length < 2) continue;
    const na = nodeIndex.get(find(key(c.id, 0)));
    const nb = nodeIndex.get(find(key(c.id, 1)));
    if (na !== undefined && nb !== undefined) u2(na, nb);
  }
  const floatingSources: number[] = [];
  for (const c of sorted) {
    if (c.kind !== "I") continue;
    const na = nodeIndex.get(find(key(c.id, 0)));
    const nb = nodeIndex.get(find(key(c.id, 1)));
    if (na !== undefined && nb !== undefined && f2(na) !== f2(nb)) {
      floatingSources.push(c.id);
    }
  }

  const sig =
    nodeCount +
    "|" +
    types.join(",") +
    "|" +
    aArr.join(",") +
    "|" +
    bArr.join(",") +
    "|" +
    values.join(",");

  return {
    nodeCount,
    types: Uint8Array.from(types),
    a: Uint32Array.from(aArr),
    b: Uint32Array.from(bArr),
    values: Float64Array.from(values),
    elemOfComponent,
    nodesOfComponent,
    floatingSources,
    sig,
  };
}

/**
 * A coarse topology signature (sorted element types + node count), used by the
 * guided build to recognise when the player's circuit matches the target shape,
 * independent of node numbering and component values.
 */
export function graphShape(graph: BoardGraph): string {
  const nl = buildNetlist(graph);
  if (!nl) return "";
  return [...nl.types].sort((x, y) => x - y).join(",") + "#" + nl.nodeCount;
}

/**
 * Attribute the solver's per-element current and per-net voltage back to each
 * component, so the renderer can animate each glyph with its real electrical
 * state. Built fresh per frame from one batched snapshot.
 */
export function electricalMap(
  netlist: BuiltNetlist,
  nodeVoltages: Float64Array,
  elementCurrents: Float64Array,
): Map<number, ElectricalState> {
  const map = new Map<number, ElectricalState>();
  for (const [compId, ei] of netlist.elemOfComponent) {
    const nodes = netlist.nodesOfComponent.get(compId);
    const vAcross = nodes
      ? (nodeVoltages[nodes[0]] ?? 0) - (nodeVoltages[nodes[1]] ?? 0)
      : 0;
    map.set(compId, { current: elementCurrents[ei] ?? 0, vAcross });
  }
  return map;
}

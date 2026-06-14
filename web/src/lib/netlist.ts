// SPDX-License-Identifier: Apache-2.0
// Compile the interactive board into a solver netlist. Pins joined by wires form
// nets (nodes); the four ideal kinds (V/R/C/L) become two-terminal elements. The
// net touching the first voltage source's "−" pin is ground (node 0). Returns
// the flat arrays the wasm `set_netlist` wants, plus the maps the renderer needs
// to attribute per-element current and per-net voltage back to each component.

import { BoardGraph } from "./graph";
import type { ElectricalState } from "./glyphs";

const TYPE_OF: Record<string, number> = { V: 0, R: 1, C: 2, L: 3 };

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
  /** Topology+values signature; unchanged across pure moves so the sim isn't reset. */
  sig: string;
}

export function buildNetlist(graph: BoardGraph): BuiltNetlist | null {
  // Union-find over pins, keyed "componentId:pinIndex".
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
  for (const c of sorted) {
    const kind = graph.kindOf(c);
    if (!kind) continue;
    for (const p of kind.pins) find(key(c.id, p.index));
  }
  for (const w of graph.wires.values()) {
    union(
      key(w.from.componentId, w.from.pinIndex),
      key(w.to.componentId, w.to.pinIndex),
    );
  }

  // Ground = the net of the first voltage source's "−" pin (pin index 1).
  let groundRoot: string | null = null;
  for (const c of sorted) {
    if (c.kind === "V") {
      groundRoot = find(key(c.id, 1));
      break;
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
    sig,
  };
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

// SPDX-License-Identifier: Apache-2.0
// Compile the interactive board into a solver netlist. Pins joined by wires form
// nets (nodes); the ideal two-terminal kinds (V/R/C/L/I) become elements. Ground
// (node 0) is an explicit GND part's net if one is present, else the fallback of
// the first voltage source's "−" pin — so current-source-only circuits, which
// have no voltage source to borrow a reference from, are still simulatable.
// Returns the flat arrays the wasm `set_netlist` wants, plus the maps the
// renderer needs to attribute per-element current and per-net voltage back to
// each component.

import {
  AC_DEFAULT_AMP,
  BoardGraph,
  endpointKey,
  isJunctionRef,
} from "./graph";
import type { Endpoint } from "./graph";
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
  ZD: 10, // Zener diode (nonlinear; reverse breakdown clamps at value = Vz)
  // Varistor (MOV): a 2-terminal *symmetric* voltage clamp (nonlinear; Newton).
  // High resistance while |V| < value = Vc, then conducts hard above ±Vc to pin
  // the node near ±Vc — the symmetric cousin of the Zener (two oppositely-facing
  // breakdown junctions). Like every 2-pin element it leaves c = 0 (ground), and
  // it carries no second `aux` scalar (aux = 0), so buildNetlist stamps it like
  // any other passive: type 16 across its two nets, c = 0, aux = 0.
  MOV: 16, // varistor (nonlinear; symmetric clamp at value = Vc)
  // The 3-terminal MOSFET family (level-1 square-law VCCS, Newton solve). Pins
  // are ordered D, S, G so the pin→terminal map is direct: pin 0 → a = Drain,
  // pin 1 → b = Source, pin 2 → c = Gate. They are the only kinds whose third
  // pin's node is stamped into the `c` array below; every two-terminal element
  // leaves c = 0 (ground), where the core ignores it.
  NM: 11, // N-channel MOSFET (conducts when Vgs > +VTO ≈ 2 V)
  PM: 12, // P-channel MOSFET (the high-side mirror; conducts when Vgs < −|VTO|)
  // The 3-terminal BJT family (Ebers-Moll, Newton solve). Pins are ordered C, E,
  // B so the pin→terminal map matches the core exactly: pin 0 → a = Collector,
  // pin 1 → b = Emitter, pin 2 → c = Base. Like the MOSFETs they stamp their
  // third pin's node into the `c` array below (the base); the main current is
  // Ic, oriented a→b = collector→emitter. A small base current controls a much
  // larger collector current (Ic ≈ β·Ib in the active region).
  Q: 13, // NPN BJT (conducts when the base is ~0.6–0.7 V above the emitter)
  QP: 14, // PNP BJT (the mirror; conducts when the base is below the emitter)
  // NOTE: EC (electrolytic cap) is deliberately ABSENT here. It has no single
  // element type — it expands below into an ideal capacitor (type 2) in series
  // with an ESR resistor (type 1) sharing a private internal node.
};

/**
 * Element types that carry a third (control) terminal `c`: the MOSFETs (gate)
 * and the BJTs (base). For all of them pin 2 → c, and that pin's node is the one
 * stamped into the `c` array; every two-terminal element leaves c = 0 (ground),
 * where the core ignores it.
 */
const THREE_PIN_TYPES = new Set<number>([11, 12, 13, 14]);

// Element types the EC (electrolytic cap) expansion stamps directly.
const ELEM_RESISTOR = 1;
const ELEM_CAPACITOR = 2;

// Electrolytic-cap parasitic series resistance (ESR), in ohms. A real bulk
// electrolytic has a few hundred mΩ of ESR; we model a fixed, small 0.5 Ω so the
// honest "a real cap can't perfectly flatten ripple" lesson is visible without
// dominating the operating point. Kept a fixed constant (not a function of C) for
// simplicity — see docs/parts-catalog-ideation.md §2.1.
const EC_ESR_OHMS = 0.5;

export interface BuiltNetlist {
  nodeCount: number;
  types: Uint8Array;
  a: Uint32Array;
  b: Uint32Array;
  /**
   * Control-terminal node per element, parallel to `a`/`b`: for a 3-pin device
   * (a MOSFET or a BJT) it is the node of its third pin (the gate / the base);
   * for every 2-pin element it is `0` (ground), which the core ignores.
   * Pin→terminal convention matches the core exactly: pin 0 → a (drain /
   * collector), pin 1 → b (source / emitter), pin 2 → c (gate / base).
   */
  c: Uint32Array;
  values: Float64Array;
  /**
   * Second per-element scalar, parallel to `values`: an AC source's peak
   * amplitude in volts; `0` for every other element (where the core ignores it,
   * so `0` cannot change a non-AC element). Built in lockstep with `values`.
   */
  aux: Float64Array;
  /** component id → element index (into `element_currents`). */
  elemOfComponent: Map<number, number>;
  /** component id → [nodeA, nodeB] (into `node_voltages`). */
  nodesOfComponent: Map<number, [number, number]>;
  /**
   * Net-label display name per node index (into `node_voltages`): a node carrying
   * one or more {@link NetLabel}s reports that name (e.g. `VCC`) so the scope and
   * telemetry can show it instead of `Node 3`. Built from the labels after node
   * numbering; when several differing names land on one node the lowest label id
   * wins (deterministic). Nodes with no label are absent from the map.
   */
  nodeNames: Map<number, string>;
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

  // Net labels — the KiCad two-flavour feature. SECOND union pass, by NAME:
  // every label whose endpoint still exists is unioned to the first label seen
  // with the same name, so **all labels sharing a name collapse onto one net,
  // with no wire between them** (the global-alias payoff). Sorted by id so the
  // representative endpoint (and thus the result) is deterministic and
  // move-invariant. A label on an already-wired net just *names* it (flavour 1);
  // a second label of the same name elsewhere *aliases* into it (flavour 2).
  const labels = [...graph.netLabels.values()]
    .filter((l) => endpointExists(graph, l.at))
    .sort((p, q) => p.id - q.id);
  const firstOfName = new Map<string, string>();
  for (const l of labels) {
    const k = endpointKey(l.at);
    find(k); // make sure the endpoint participates even if it has no wire
    const rep = firstOfName.get(l.name);
    if (rep === undefined) firstOfName.set(l.name, k);
    else union(k, rep);
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
  // Each electrolytic cap (EC) is modelled honestly as an ideal cap in series
  // with its ESR, which needs one PRIVATE internal node between the two. Allocate
  // those after every pin/junction node — in sorted-component-id order so the
  // numbering is deterministic and unaffected by pure moves — and bump nodeCount.
  // ecInternal: EC component id → its internal node index.
  const ecInternal = new Map<number, number>();
  for (const c of sorted) {
    if (c.kind !== "EC") continue;
    const kind = graph.kindOf(c);
    if (!kind || kind.pins.length < 2) continue;
    ecInternal.set(c.id, next++);
  }
  const nodeCount = next;

  // Net name per node: each label maps its endpoint to a node index and names it.
  // Same-named labels already share a node (the name union above), so they agree;
  // when two *different* names land on one physical net the lowest label id wins
  // (the `labels` list is sorted by id and we keep the first name set per node),
  // which is deterministic. This is what lets the scope/telemetry show `VCC`.
  const nodeNames = new Map<number, string>();
  for (const l of labels) {
    const node = nodeIndex.get(find(endpointKey(l.at)));
    if (node !== undefined && !nodeNames.has(node)) nodeNames.set(node, l.name);
  }

  const types: number[] = [];
  const aArr: number[] = [];
  const bArr: number[] = [];
  // The control terminal, parallel to a/b. Pushed in lockstep with every element
  // stamp so the arrays stay aligned; 0 (ground) for everything except a 3-pin
  // device (a MOSFET or a BJT), whose entry holds its control node (pin 2 — the
  // gate / the base). The core ignores c for 2-pin types.
  const cArr: number[] = [];
  const values: number[] = [];
  // The second per-element scalar, parallel to `values`: an AC source's peak
  // amplitude (volts); 0 for every other element. Pushed in lockstep with each
  // element stamp so the arrays stay aligned. The core ignores it for non-AC
  // kinds, so a 0 there cannot change anything.
  const auxArr: number[] = [];
  const elemOfComponent = new Map<number, number>();
  const nodesOfComponent = new Map<number, [number, number]>();
  for (const c of sorted) {
    const kind = graph.kindOf(c);
    if (!kind || kind.pins.length < 2) continue;
    const na = nodeIndex.get(find(key(c.id, 0))) ?? 0;
    const nb = nodeIndex.get(find(key(c.id, 1))) ?? 0;

    // Electrolytic cap: expand into TWO elements on a shared internal node —
    // an ideal capacitor (+pin → internal, value = C) and the ESR resistor
    // (internal → −pin). The cap element carries the series current, so it is the
    // one mapped for the glyph/inspector; vAcross is read across the whole part
    // (+pin → −pin) via nodesOfComponent so it includes the ESR drop.
    if (c.kind === "EC") {
      const mid = ecInternal.get(c.id);
      if (mid === undefined) continue; // 1-pin guard rejected it above
      const capIdx = types.length;
      types.push(ELEM_CAPACITOR);
      aArr.push(na);
      bArr.push(mid);
      cArr.push(0); // 2-terminal: no control node
      values.push(c.value); // capacitance
      auxArr.push(0); // not an AC source: no amplitude
      types.push(ELEM_RESISTOR);
      aArr.push(mid);
      bArr.push(nb);
      cArr.push(0); // 2-terminal: no control node
      values.push(EC_ESR_OHMS); // parasitic series resistance
      auxArr.push(0); // not an AC source: no amplitude
      elemOfComponent.set(c.id, capIdx); // series current = the cap's current
      nodesOfComponent.set(c.id, [na, nb]); // V across the whole part
      continue;
    }

    const t = TYPE_OF[c.kind];
    if (t === undefined) continue;
    // The third terminal: a 3-pin device stamps its control node — pin 2 → c. For
    // a MOSFET (pins ordered D, S, G) that is the GATE; for a BJT (pins ordered C,
    // E, B) that is the BASE. A 2-pin part has no third pin, so c = 0 (ground),
    // which the core ignores. Guard on the actual pin count so only true 3-pin
    // kinds take the control path. (elemOfComponent maps to this element: for a
    // MOSFET its current is Id oriented a→b = drain→source and nodesOfComponent =
    // [drain, source] so vAcross reads Vds; for a BJT its current is Ic oriented
    // a→b = collector→emitter and nodesOfComponent = [collector, emitter] so
    // vAcross reads Vce.)
    const nc =
      THREE_PIN_TYPES.has(t) && kind.pins.length >= 3
        ? (nodeIndex.get(find(key(c.id, 2))) ?? 0)
        : 0;
    // The second scalar: an AC source emits its peak amplitude (volts), defaulting
    // to 5 V when a (legacy) source carries none; every other kind emits 0, which
    // the core ignores. Kept parallel to `values`.
    const aux = c.kind === "AC" ? (c.amp ?? AC_DEFAULT_AMP) : 0;
    const idx = types.length;
    types.push(t);
    aArr.push(na);
    bArr.push(nb);
    cArr.push(nc);
    values.push(c.value);
    auxArr.push(aux);
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
    const kind = graph.kindOf(c);
    if (!kind || kind.pins.length < 2) continue;
    const na = nodeIndex.get(find(key(c.id, 0)));
    const nb = nodeIndex.get(find(key(c.id, 1)));
    if (na === undefined || nb === undefined) continue;
    // An EC is a cap+ESR series path between its two pins: it ties na↔nb (through
    // its internal node) for the return-path test, like any other passive element.
    if (c.kind === "EC") {
      const mid = ecInternal.get(c.id);
      if (mid !== undefined) {
        u2(na, mid);
        u2(mid, nb);
      }
      continue;
    }
    const t = TYPE_OF[c.kind];
    if (t === undefined || t === 4) continue; // skip non-elements and I sources
    u2(na, nb);
    // A 3-pin device also pulls its control net (pin 2 → c — a MOSFET's gate or a
    // BJT's base) into the same component: all three of its nodes participate in
    // the topology, so a return path can run through that net too. (A MOSFET gate
    // draws no DC current and a BJT base draws only a small one, but for the
    // *connectivity* test the control terminal is still a real wired terminal.)
    if (THREE_PIN_TYPES.has(t) && kind.pins.length >= 3) {
      const ncc = nodeIndex.get(find(key(c.id, 2)));
      if (ncc !== undefined) u2(na, ncc);
    }
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

  // Fold the net labels into the signature (each as name→node, sorted by id),
  // so adding, renaming, or re-aliasing a label is recognised as a topology
  // change and the sim is rebuilt — while a pure move (which changes no name and
  // no node numbering) leaves it unchanged. Aliasing also already shifts the node
  // assignments via the name union above, but pinning name→node here makes a
  // rename that doesn't move a node (e.g. renaming `VCC`→`VBAT` in place) rebuild
  // too, so the displayed name refreshes. With no labels this contributes nothing,
  // so every label-free circuit (every existing example) keeps its exact old sig.
  const labelSig = labels
    .map((l) => l.name + ">" + (nodeIndex.get(find(endpointKey(l.at))) ?? -1))
    .join(",");

  // Fold the second scalar `aux` (the AC amplitudes) into the signature, so
  // re-tuning an AC source's amplitude is recognised as a change and the sim is
  // rebuilt — while a pure move (which never changes any aux) leaves it unchanged.
  // Appended only when some element actually carries a non-zero aux, so every
  // aux-free circuit (no AC source) keeps its exact old signature.
  const auxSig = auxArr.some((x) => x !== 0) ? auxArr.join(",") : "";

  // Fold the control terminal `c` into the signature too, so wiring (or rewiring)
  // a 3-pin device's control net — a MOSFET's gate or a BJT's base — to a
  // different net is recognised as a topology change and the sim is rebuilt —
  // while a pure move (which never changes any node) still leaves the whole
  // signature, c included, unchanged.
  const sig =
    nodeCount +
    "|" +
    types.join(",") +
    "|" +
    aArr.join(",") +
    "|" +
    bArr.join(",") +
    "|" +
    cArr.join(",") +
    "|" +
    values.join(",") +
    (labelSig ? "|" + labelSig : "") +
    (auxSig ? "|aux:" + auxSig : "");

  return {
    nodeCount,
    types: Uint8Array.from(types),
    a: Uint32Array.from(aArr),
    b: Uint32Array.from(bArr),
    c: Uint32Array.from(cArr),
    values: Float64Array.from(values),
    aux: Float64Array.from(auxArr),
    elemOfComponent,
    nodesOfComponent,
    nodeNames,
    floatingSources,
    sig,
  };
}

/**
 * Whether a wire endpoint (pin or junction) still resolves to a live component
 * pin or junction in the graph. A local mirror of the graph's private check, used
 * to skip net labels whose anchor was deleted. (Labels are normally pruned with
 * their anchor, but this keeps {@link buildNetlist} robust to any stale label.)
 */
function endpointExists(graph: BoardGraph, e: Endpoint): boolean {
  if (isJunctionRef(e)) return graph.junctions.has(e.junctionId);
  const c = graph.components.get(e.componentId);
  if (!c) return false;
  const kind = graph.kindOf(c);
  return !!kind && e.pinIndex >= 0 && e.pinIndex < kind.pins.length;
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

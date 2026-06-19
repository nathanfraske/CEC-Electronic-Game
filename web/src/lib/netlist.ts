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
import type { AcReadout, ElectricalState } from "./glyphs";
import { isThermistor, thermistorResistance } from "./thermistor";
import {
  tierParams,
  ecEsr,
  resistorTolerance,
  DEFAULT_TIER,
  PARAM_STRIDE,
} from "./tiers";

/** Deterministic per-component pseudo-random in [-1, 1] (a 32-bit integer hash of the id),
 * stable across rebuilds — so a resistor's tolerance deviation is fixed for that part, not
 * re-rolled on every edit and not tied to the (unstable) element index. */
function jitter(id: number): number {
  let h = (id ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 0x1_0000_0000) * 2 - 1;
}

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
  // Manual switch: the SAME solver element as SW (type 6), but the player flips
  // its `value` between 1 (closed) and 0 (open) by clicking it. The core reads
  // `value` as the duty cycle, so value = 1 is always-closed (duty 100%) and
  // value = 0 always-open (duty 0%) — a manual switch is just a clock switch the
  // player parks at one extreme. No new sim element; the golden is unchanged.
  MSW: 6, // manual switch; value = state (1 = closed, 0 = open) — duty 1/0
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
  // The 3-terminal op-amp (behavioural high-gain VCCS, Newton solve). Pins are
  // ordered OUT, IN−, IN+ so the pin→terminal map matches the core exactly: pin 0
  // → a = Output, pin 1 → b = IN− (inverting), pin 2 → c = IN+ (non-inverting).
  // Like the MOSFETs/BJTs it stamps its third pin's node into the `c` array (the
  // non-inverting input); the output current it sources at `a` is `GOUT·(Vtarget −
  // V(a))`, driving V(a) toward `Vsat·tanh(GAIN·(V(c)−V(b))/Vsat)` (`value` = Vsat).
  OA: 15, // op-amp (nonlinear; output swings within ±Vsat = value)
  // Logic gates: all share solver type 17 (the behavioral digital gate); the
  // boolean function is selected per part by the `aux` code (see GATE_AUX). Pins
  // are ordered OUT, IN1, IN2 (pin 0 → a = output, 1 → b = input A, 2 → c = input
  // B). `value` is the logic-high rail (volts). The two-input gates are 3-pin (so
  // their IN2 stamps into `c`); the inverter NOT is 2-pin (c = ground, ignored).
  AND: 17,
  OR: 17,
  NAND: 17,
  NOR: 17,
  XOR: 17,
  XNOR: 17,
  NOT: 17,
  BUF: 17,
  // Level shifter: pins OUT, IN (pin 0 → a, 1 → b). `value` = input rail A; the
  // output rail B rides in `aux` (set below).
  LS: 20,
  // Pull-up: one terminal (pin 0 → a). `value` = Vcc; pulls the net up through a
  // fixed resistance.
  PU: 21,
  // Transformer: the first FOUR-terminal element (coupled inductors). Pins are
  // ordered primary+, primary−, secondary+, secondary− → pin 0 → a, 1 → b, 2 → c,
  // 3 → d. `value` is the turns ratio n = Ns/Np.
  TR: 18,
  // D flip-flop: four-terminal sequential IC. Pins ordered Q, D, CLK, Q̄ (pin 0 →
  // a = Q output, 1 → b = D input, 2 → c = CLK input, 3 → d = Q̄ output). `value` is
  // the logic rail. Uses `d`, so it joins FOUR_PIN_TYPES below.
  FF: 19,
  // NOTE: EC (electrolytic cap) is deliberately ABSENT here. It has no single
  // element type — it expands below into an ideal capacitor (type 2) in series
  // with an ESR resistor (type 1) sharing a private internal node.
};

/**
 * Element types that carry a third (control) terminal `c`: the MOSFETs (gate),
 * the BJTs (base), and the op-amp (its non-inverting input IN+). For all of them
 * pin 2 → c, and that pin's node is the one stamped into the `c` array; every
 * two-terminal element leaves c = 0 (ground), where the core ignores it.
 */
const THREE_PIN_TYPES = new Set<number>([11, 12, 13, 14, 15, 17]);

/**
 * Element types that carry a **fourth** terminal `d`: the transformer (type 18,
 * pin 3 = secondary−) and the D flip-flop (type 19, pin 3 = Q̄). Pin 3 → d, stamped
 * into the `d` array; every element with three or fewer terminals leaves d = 0
 * (ground), where the core ignores it.
 */
const FOUR_PIN_TYPES = new Set<number>([18, 19]);

/**
 * Logic-gate boolean function codes, keyed by part tag, written into each gate's
 * second scalar `aux`. Mirrors `gate_logic` in `crates/sim-core/src/lib.rs`:
 * 0 AND, 1 OR, 2 NAND, 3 NOR, 4 XOR, 5 XNOR, 6 NOT, 7 BUF. Every gate part maps to
 * solver type 17; this code is what makes one an AND and another an XOR.
 */
const GATE_AUX: Record<string, number> = {
  AND: 0,
  OR: 1,
  NAND: 2,
  NOR: 3,
  XOR: 4,
  XNOR: 5,
  NOT: 6,
  BUF: 7,
};

// Element types the EC (electrolytic cap) expansion stamps directly.
const ELEM_RESISTOR = 1;
const ELEM_CAPACITOR = 2;

// (Electrolytic-cap ESR is now graded by tier — see `ecEsr` in lib/tiers.ts.)

// Minimum resistance of either potentiometer leg, in ohms — a small wiper-contact
// floor so an end-stop wiper (t → 0 or 1) reads as a near-short rather than an
// exact 0 Ω (which the resistor stamp would treat as an open). Also keeps the wiper
// node referenced through both legs at the extremes.
const POT_WIPER_MIN = 0.5;

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
  /**
   * Fourth-terminal node per element, parallel to `a`/`b`/`c`: for the transformer
   * (the only 4-pin element) it is the node of its pin 3 (secondary−); for every
   * element with fewer pins it is `0` (ground), which the core ignores. Pin 3 → d.
   */
  d: Uint32Array;
  values: Float64Array;
  /**
   * Second per-element scalar, parallel to `values`: an AC source's peak
   * amplitude in volts, or a logic gate's function code; `0` for every other
   * element (where the core ignores it). Built in lockstep with `values`.
   */
  aux: Float64Array;
  /**
   * Per-element model-parameter block (`PARAM_STRIDE` f64s per element, in element order)
   * from each component's quality tier — handed to `set_netlist_p`. All-zero for an
   * untiered circuit (so the core uses every kind default). See {@link tierParams}.
   */
  params: Float64Array;
  /** component id → element index (into `element_currents`). */
  elemOfComponent: Map<number, number>;
  /**
   * component id → the EXTRA element indices for a part that splits into several legs,
   * so the renderer can read each leg's current and show the split proportionally (the
   * POT's W→B leg beside its A→W main; a future device's per-branch currents). The
   * main current stays in {@link BuiltNetlist.elemOfComponent}; these are the rest, in
   * a part-specific order the drawer knows. Absent for ordinary single-element parts.
   */
  legsOfComponent: Map<number, number[]>;
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

export function buildNetlist(
  graph: BoardGraph,
  real = false,
): BuiltNetlist | null {
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
  // The fourth-terminal array, parallel to `a`/`b`/`c`: a 4-pin device (the
  // transformer) stamps its pin-3 node (secondary−); every other element leaves it
  // 0 (ground), ignored by the core. Pushed in lockstep with each element stamp.
  const dArr: number[] = [];
  const values: number[] = [];
  // The second per-element scalar, parallel to `values`: an AC source's peak
  // amplitude (volts); 0 for every other element. Pushed in lockstep with each
  // element stamp so the arrays stay aligned. The core ignores it for non-AC
  // kinds, so a 0 there cannot change anything.
  const auxArr: number[] = [];
  const elemOfComponent = new Map<number, number>();
  const legsOfComponent = new Map<number, number[]>();
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
      dArr.push(0); // 2-terminal: no fourth node
      values.push(c.value); // capacitance
      auxArr.push(0); // not an AC source: no amplitude
      types.push(ELEM_RESISTOR);
      aArr.push(mid);
      bArr.push(nb);
      cArr.push(0); // 2-terminal: no control node
      dArr.push(0); // 2-terminal: no fourth node
      values.push(ecEsr(c.tier ?? DEFAULT_TIER)); // ESR (graded by the part's tier)
      auxArr.push(0); // not an AC source: no amplitude
      elemOfComponent.set(c.id, capIdx); // series current = the cap's current
      nodesOfComponent.set(c.id, [na, nb]); // V across the whole part
      continue;
    }

    // Potentiometer: expand into TWO resistors meeting at the (external) wiper node
    // W — A→W = R·t and W→B = R·(1−t), where t = wiper position (0..1) and R = the
    // total resistance (value). No new solver element; just the existing resistor
    // stamp. The wiper position rides into `values` (so changing it rebuilds the
    // sim via the value signature). The A→W (upper) leg is mapped for the
    // glyph/inspector current; vAcross is read across the whole track (A → B).
    if (c.kind === "POT") {
      const nw = nodeIndex.get(find(key(c.id, 2))) ?? 0; // wiper node
      const tpos = Math.min(0.999, Math.max(0.001, c.wiper ?? 0.5));
      const rAW = Math.max(c.value * tpos, POT_WIPER_MIN);
      const rWB = Math.max(c.value * (1 - tpos), POT_WIPER_MIN);
      const upIdx = types.length;
      types.push(ELEM_RESISTOR);
      aArr.push(na);
      bArr.push(nw);
      cArr.push(0);
      dArr.push(0);
      values.push(rAW);
      auxArr.push(0);
      types.push(ELEM_RESISTOR);
      aArr.push(nw);
      bArr.push(nb);
      cArr.push(0);
      dArr.push(0);
      values.push(rWB);
      auxArr.push(0);
      elemOfComponent.set(c.id, upIdx); // A→W leg current (the main)
      legsOfComponent.set(c.id, [upIdx + 1]); // W→B leg → wiper tap = A→W − W→B
      nodesOfComponent.set(c.id, [na, nb]); // V across the whole track
      continue;
    }

    // Thermistor (NTC/PTC): stamp ONE plain resistor whose resistance is the live R(T)
    // computed from the part's nominal value and its body temperature — the same web-
    // only expansion as the POT, so the sim sees an ordinary resistor (no new element,
    // no golden change). R(T) rides into `values`, so changing the temperature rebuilds
    // the sim via the value signature. (Today the temperature is the inspector knob;
    // a future self-heating model would feed the same field — see thermistor.ts.)
    if (isThermistor(c.kind)) {
      const reff = Math.max(
        1e-3,
        thermistorResistance(c.kind, c.value, c.temp ?? 25),
      );
      const idx = types.length;
      types.push(ELEM_RESISTOR);
      aArr.push(na);
      bArr.push(nb);
      cArr.push(0);
      dArr.push(0);
      values.push(reff);
      auxArr.push(0);
      elemOfComponent.set(c.id, idx);
      nodesOfComponent.set(c.id, [na, nb]);
      continue;
    }

    const t = TYPE_OF[c.kind];
    if (t === undefined) continue;
    // The third terminal: any device with a pin 2 stamps it as node c. For a 3-pin
    // device that is the control node — a MOSFET's GATE (pins D, S, G), a BJT's BASE
    // (pins C, E, B), an op-amp's non-inverting input IN+ (pins OUT, IN−, IN+). For a
    // 4-pin device it is a real signal terminal — the transformer's SECONDARY+ (pins
    // P+, P−, S+, S−) and the D flip-flop's CLK (pins Q, D, CLK, Q̄). A 2-pin part has
    // no pin 2, so c = 0 (ground), which the core ignores. **Both** 3- and 4-pin kinds
    // must take this path: omitting the 4-pin kinds grounds the transformer's S+ (and
    // the flip-flop's CLK), silently collapsing a bridge to half-wave and stopping a
    // flip-flop from ever clocking. (elemOfComponent maps to this element: for a
    // MOSFET its current is Id oriented a→b = drain→source and nodesOfComponent =
    // [drain, source] so vAcross reads Vds; for a BJT its current is Ic oriented
    // a→b = collector→emitter and nodesOfComponent = [collector, emitter] so
    // vAcross reads Vce; for an op-amp its current is the output drive Iout sourced
    // at a = OUT and nodesOfComponent = [OUT, IN−], so vAcross reads V(OUT)−V(IN−).)
    const nc =
      (THREE_PIN_TYPES.has(t) || FOUR_PIN_TYPES.has(t)) && kind.pins.length >= 3
        ? (nodeIndex.get(find(key(c.id, 2))) ?? 0)
        : 0;
    // The fourth terminal: a 4-pin device (the transformer) stamps its pin-3 node
    // (secondary−); every element with fewer pins leaves d = 0 (ground, ignored).
    const nd =
      FOUR_PIN_TYPES.has(t) && kind.pins.length >= 4
        ? (nodeIndex.get(find(key(c.id, 3))) ?? 0)
        : 0;
    // The second scalar: an AC source emits its peak amplitude (volts, defaulting
    // to 5 V when a legacy source carries none); a logic gate / flip-flop emits its
    // function code (GATE_AUX) in the low bits PLUS its logic-family index in the
    // upper bits (`func + 16*family`, matching `gate_family_index`/`gate_func_code`
    // in sim-core); every other kind emits 0, which the core ignores. Kept parallel
    // to `values`.
    const aux =
      c.kind === "AC"
        ? (c.amp ?? AC_DEFAULT_AMP)
        : c.kind === "LS"
          ? (c.amp ?? 5) // a level shifter's output rail B (its second scalar)
          : (GATE_AUX[c.kind] ?? 0) +
            16 * (c.family ?? 0) +
            (c.openDrain ? 256 : 0);
    // Resistor tolerance (Realistic mode only): the actual value deviates deterministically
    // (per component id) within the tier's band — budget parts loose, lab parts tight. Ideal
    // mode keeps every resistor exact.
    const value =
      real && c.kind === "R"
        ? c.value *
          (1 + resistorTolerance(c.tier ?? DEFAULT_TIER) * jitter(c.id))
        : c.value;
    const idx = types.length;
    types.push(t);
    aArr.push(na);
    bArr.push(nb);
    cArr.push(nc);
    dArr.push(nd);
    values.push(value);
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
    // A POT is two resistors meeting at the wiper W: it ties A↔W↔B for the
    // return-path test, like any other passive path.
    if (c.kind === "POT") {
      const nw = nodeIndex.get(find(key(c.id, 2)));
      if (nw !== undefined) {
        u2(na, nw);
        u2(nw, nb);
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
      // Force the dead branch to read 0. An ideal current source with no return
      // path makes the MNA system singular (KCL can't balance at the orphaned
      // node), and the solver's deterministic zero-pivot fallback then reports a
      // confident-looking phantom — the full forced current "flowing" through a
      // branch that can't carry it, plus a huge IR voltage. A current that cannot
      // circulate is physically 0, so we zero the source's injection: the readout
      // becomes an honest 0 mA / 0 V and the `floatingSources` warning banner
      // explains *why* (incomplete loop). The moment the loop is closed the source
      // drops out of this set and its real value is restored. Zeroed before the
      // signature below, so "floating at any set current" is one state (all such
      // currents solve identically to 0) and closing the loop still rebuilds.
      const idx = elemOfComponent.get(c.id);
      if (idx !== undefined) values[idx] = 0;
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

  // Fold the fourth terminal `d` in the same way: appended only when some element
  // actually carries a non-zero d (i.e. a transformer is placed), so every
  // transformer-free circuit keeps its exact old signature, while rewiring a
  // transformer's secondary− net rebuilds the sim.
  const dSig = dArr.some((x) => x !== 0) ? dArr.join(",") : "";

  // Fold the control terminal `c` into the signature too, so wiring (or rewiring)
  // a 3-pin device's control net — a MOSFET's gate or a BJT's base — to a
  // different net is recognised as a topology change and the sim is rebuilt —
  // while a pure move (which never changes any node) still leaves the whole
  // signature, c included, unchanged.
  // Per-element model-parameter block from each component's quality tier (main gameplay),
  // aligned to the MAIN element of each component (its `elemOfComponent` index); an
  // expansion element (an EC's ESR resistor, a POT's legs) keeps its all-zero block, i.e.
  // sim-core defaults. Empty-valued unless a tiered part is placed.
  const params = new Float64Array(types.length * PARAM_STRIDE);
  for (const comp of sorted) {
    const tp = tierParams(comp.kind, comp.tier ?? DEFAULT_TIER);
    const ei = elemOfComponent.get(comp.id);
    if (!tp || ei === undefined) continue;
    for (let k = 0; k < PARAM_STRIDE; k++) {
      params[ei * PARAM_STRIDE + k] = tp[k] ?? 0;
    }
  }
  // Fold the params into the signature so changing a tier reinstalls the sim (a no-op
  // string when nothing tiered is placed, so plain circuits keep their old signature).
  let paramsSig = "";
  for (let i = 0; i < params.length; i++) {
    if (params[i] !== 0) {
      paramsSig = "|p:" + params.join(",");
      break;
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
    cArr.join(",") +
    "|" +
    values.join(",") +
    (labelSig ? "|" + labelSig : "") +
    (auxSig ? "|aux:" + auxSig : "") +
    (dSig ? "|d:" + dSig : "") +
    paramsSig;

  return {
    nodeCount,
    types: Uint8Array.from(types),
    a: Uint32Array.from(aArr),
    b: Uint32Array.from(bArr),
    c: Uint32Array.from(cArr),
    d: Uint32Array.from(dArr),
    values: Float64Array.from(values),
    aux: Float64Array.from(auxArr),
    params,
    elemOfComponent,
    legsOfComponent,
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
  failedMask?: Uint8Array,
  reactiveCurrents?: Float64Array,
  acMeasurements?: Float64Array,
  acFields?: number,
): Map<number, ElectricalState> {
  const map = new Map<number, ElectricalState>();
  for (const [compId, ei] of netlist.elemOfComponent) {
    const nodes = netlist.nodesOfComponent.get(compId);
    const vAcross = nodes
      ? (nodeVoltages[nodes[0]] ?? 0) - (nodeVoltages[nodes[1]] ?? 0)
      : 0;
    // Extra per-leg currents for parts that split (POT: its W→B leg), so the drawer
    // can show the current dividing between exits in proportion. Absent for the rest.
    const legIdx = netlist.legsOfComponent.get(compId);
    const legs = legIdx?.map((i) => elementCurrents[i] ?? 0);
    map.set(compId, {
      current: elementCurrents[ei] ?? 0,
      vAcross,
      ...(legs ? { legs } : {}),
      // The transformer's magnetising current / inductor branch current (its real
      // flux), when the core exposes it — lets the transformer tier read true flux.
      flux: reactiveCurrents ? (reactiveCurrents[ei] ?? 0) : undefined,
      // The per-element AC measurements over the last cycle (RMS/power/phase/freq),
      // sliced from the flat boundary array — drives the shimmer/phasor render.
      ...(acReadout(acMeasurements, acFields, ei) ?? {}),
      // The element-indexed FAIL mask, mapped back to its component (the renderer
      // boxes any part whose element hit the bound).
      failed: failedMask ? (failedMask[ei] ?? 0) !== 0 : false,
    });
  }
  return map;
}

/**
 * Slice element `ei`'s {@link AcReadout} out of the flat `ac_measurements` boundary
 * array (`AC_FIELDS` values per element, in the documented order). Returns `{ ac }`
 * for spreading into an {@link ElectricalState}, or `undefined` when the core sent no
 * AC data (so the field stays absent).
 */
function acReadout(
  ac: Float64Array | undefined,
  fields: number | undefined,
  ei: number,
): { ac: AcReadout } | undefined {
  if (!ac || !fields || fields < 12) return undefined;
  const o = ei * fields;
  if (o + 12 > ac.length) return undefined;
  return {
    ac: {
      vrms: ac[o]!,
      irms: ac[o + 1]!,
      vmean: ac[o + 2]!,
      imean: ac[o + 3]!,
      vamp: ac[o + 4]!,
      iamp: ac[o + 5]!,
      preal: ac[o + 6]!,
      pf: ac[o + 7]!,
      zmag: ac[o + 8]!,
      phase: ac[o + 9]!,
      freq: ac[o + 10]!,
      valid: (ac[o + 11] ?? 0) !== 0,
    },
  };
}

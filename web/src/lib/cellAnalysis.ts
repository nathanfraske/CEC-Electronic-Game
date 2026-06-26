// SPDX-License-Identifier: Apache-2.0
// CELL ANALYSIS — the "is this cell sequential, and how do I drive it?" pass that decides whether the
// characterizer should sweep a cell as COMBINATIONAL or route it to the SEQUENTIAL (registered) path.
// Pure + wasm-free (it reads the cell's saved graph + pin roles/names), so it's headless-unit-tested.
//
// Two jobs:
//  1. SEQUENTIAL DETECTION (structural): combinational logic is a DAG; MEMORY needs a feedback loop through
//     a GAIN stage. We build the cell's signal-net graph — a gate / characterized sub-cell is a DIRECTED
//     in→out edge; a transmission gate / un-characterized pass cell is a BIDIRECTIONAL edge — drop the
//     power rails, and look for a gain edge that sits on a cycle. The classic TG D-latch (two inverters
//     closed by a feedback pass-gate) is exactly such a loop, so it's caught — and a plain pass-gate or a
//     pure combinational gate (no gain-in-a-cycle) is not.
//  2. PIN CLASSIFICATION (name + role): which frame pins are DATA inputs, the CLOCK/ENABLE (+ its
//     complement, e.g. EN/ENB — recognised as a pair and driven oppositely), the output Q (+ Q̄ if a
//     complementary output exists, so "Q available, Q̄ not" is handled), and the GND/VCC rails.
//
// The characterizer uses this to STOP mischaracterizing a latch as a buffer: a detected loop (or a clear
// clock/enable) routes to the sequential sweep instead of emitting a combinational LUT.
import type { GraphSnapshot, PinRole } from "./graph";

/** What `analyzeCell` needs to know about a placed sub-cell: its pin roles (in/out/control…) and whether
 * it's been characterized (has a behavior word ⇒ a DIRECTED gain stage, vs an un-characterized pass cell).
 * In the app this is `getUserIc(tag)`; a test passes a literal map. */
export interface ResolvedCell {
  pinRoles?: (PinRole | undefined)[];
  behavior?: unknown; // presence (truthy) ⇒ a characterized, directed logic stage
}

export interface CellAnalysis {
  /** A feedback loop through a gain stage was found ⇒ the cell has memory (a latch / flop / SR), so it
   * must NOT be swept as a combinational truth table. */
  sequential: boolean;
  /** Human explanation (shown when the characterizer refuses / escalates). */
  reason: string;
  /** frame-pin indices of the DATA inputs to sweep (role/name = in/D/A/B…), excluding the clock pair. */
  dataInputs: number[];
  /** the clock / enable pin to drive (square clock in a sequential sweep), or -1. */
  clockPin: number;
  /** the clock's COMPLEMENT pin (EN̄/CLK̄), driven as NOT(clock); -1 when the cell has no separate one. */
  clockComplementPin: number;
  /** the output to observe (Q if present, else the lone output / Q̄), or -1. */
  outPin: number;
  /** the complementary output Q̄ if the cell exposes one, else -1 ("Q available, Q̄ not" ⇒ -1). */
  qbarPin: number;
  gndPin: number;
  vccPin: number;
}

/** Uppercase + strip a leading active-low marker (/CLK, ~CLK, !CLK, #CLK) for name matching. */
function norm(name: string | undefined): string {
  return (name ?? "")
    .trim()
    .toUpperCase()
    .replace(/^[/~!#]+/, "");
}

/** The common "bar" / active-low spellings of a base signal name (EN → ENB/ENBAR/ENN/EN_B/EN_N/NEN/…). Used
 * to recognise a complementary PAIR (EN/ENB, CLK/CLKB, Q/QBAR, Q/NQ) among the cell's pins. */
function barForms(base: string): string[] {
  return [
    base + "B",
    base + "BAR",
    base + "N",
    base + "_B",
    base + "_BAR",
    base + "_N",
    base + "BARRED",
    "N" + base,
  ];
}

/** True when names `a` and `b` are a signal and its complement (either order), e.g. EN/ENB, CLK/CLKB. */
function isComplementName(
  a: string | undefined,
  b: string | undefined,
): boolean {
  const A = norm(a);
  const B = norm(b);
  if (!A || !B || A === B) return false;
  return barForms(A).includes(B) || barForms(B).includes(A);
}

/** True when `name` is the BAR (active-low) member of a pair — it carries a bar marker. */
function looksBarred(name: string | undefined): boolean {
  const raw = (name ?? "").trim();
  if (/^[/~!#]/.test(raw)) return true;
  const N = norm(name);
  return /(_?BAR|_B|_N|[A-Z]B|N[A-Z]+)$/.test(N) && N.length >= 2;
}

const CLOCKY = new Set([
  "CLK",
  "CK",
  "CLOCK",
  "EN",
  "ENA",
  "ENABLE",
  "LE",
  "G",
  "GATE",
  "PHI",
  "STROBE",
  "STB",
  "WR",
  "WE",
  "LD",
  "LOAD",
]);

/** Is this pin name a clock / enable (or the complement of one)? */
function isClocky(name: string | undefined): boolean {
  const N = norm(name).replace(/[_]?(B|BAR|N)$/, "");
  return CLOCKY.has(N) || CLOCKY.has(norm(name));
}

/** Web gate kinds (powered logic) — a DIRECTED gain stage in the signal graph: pin 0 = OUT, 1/2 = IN. */
const LOGIC_GATES = new Set([
  "NOT",
  "BUF",
  "AND",
  "NAND",
  "OR",
  "NOR",
  "XOR",
  "XNOR",
  "MAJ",
]);

/** Per-pin roles for a PRIMITIVE kind (best-effort; the powered logic gates are the cases that matter for a
 * gate-built latch). Returns undefined for kinds we don't model (they contribute no signal edges — a
 * conservative miss, never a false loop). */
function primitiveRoles(kind: string): (PinRole | undefined)[] | undefined {
  if (LOGIC_GATES.has(kind)) return ["out", "in", "in", "vcc", "gnd"]; // [Y, A, B(NC), VCC, GND]
  return undefined;
}

/**
 * Analyse a cell's inner graph + its frame-pin roles/names. Decides whether it's SEQUENTIAL (a feedback
 * loop through a gain stage) and classifies the frame pins (data / clock+complement / Q+Q̄ / rails) so the
 * characterizer can drive it correctly. Pure — safe in node + the browser.
 */
export function analyzeCell(opts: {
  graph: GraphSnapshot;
  frameId: number;
  pinRoles: (PinRole | undefined)[];
  pinNames?: (string | undefined)[];
  resolveCell?: (tag: string) => ResolvedCell | undefined;
}): CellAnalysis {
  const { graph, frameId, pinRoles, pinNames = [], resolveCell } = opts;

  // --- 1. classify the FRAME pins (the cell's external pins) by role first, then name --------------------
  const roleOf = (i: number): PinRole | undefined => pinRoles[i];
  const nameOf = (i: number): string | undefined => pinNames[i];
  const n = Math.max(pinRoles.length, pinNames.length);

  let gndPin = -1;
  let vccPin = -1;
  const outs: number[] = [];
  const clocks: number[] = [];
  const dataInputs: number[] = [];

  for (let i = 0; i < n; i++) {
    const r = roleOf(i);
    const nm = norm(nameOf(i));
    if (r === "gnd" || nm === "GND" || nm === "VSS") {
      if (gndPin < 0) gndPin = i;
      continue;
    }
    if (r === "vcc" || nm === "VCC" || nm === "VDD") {
      if (vccPin < 0) vccPin = i;
      continue;
    }
    if (r === "out" || nm === "Q" || nm.startsWith("Q")) {
      outs.push(i);
      continue;
    }
    if (r === "clk" || isClocky(nameOf(i))) {
      clocks.push(i);
      continue;
    }
    // everything else that isn't a rail is a data input (role "in", or an unroled D/A/B/… pin).
    if (r === "in" || r === undefined || r === "inout") dataInputs.push(i);
  }

  // --- 2. pick the clock + its complement, and Q + Q̄ ---------------------------------------------------
  // Clock pair: among clocky pins, a complementary name pair (EN/ENB) ⇒ clock = the non-barred one, its
  // complement = the barred one. A lone clocky pin drives alone (no complement).
  let clockPin = -1;
  let clockComplementPin = -1;
  outer: for (let a = 0; a < clocks.length; a++) {
    for (let b = 0; b < clocks.length; b++) {
      if (a === b) continue;
      if (isComplementName(nameOf(clocks[a]), nameOf(clocks[b]))) {
        const barA = looksBarred(nameOf(clocks[a]));
        clockPin = barA ? clocks[b] : clocks[a];
        clockComplementPin = barA ? clocks[a] : clocks[b];
        break outer;
      }
    }
  }
  if (clockPin < 0 && clocks.length > 0) clockPin = clocks[0]; // lone clock, no complement

  // Output: prefer a true Q (named "Q" exactly, or a non-barred output) and record Q̄ if a complementary
  // output exists ("Q available, Q̄ not" ⇒ qbarPin stays -1).
  let qbarPin = -1;
  const exactQ = outs.find((i) => norm(nameOf(i)) === "Q");
  const nonBarOut = outs.find((i) => !looksBarred(nameOf(i)));
  const outPin = exactQ ?? nonBarOut ?? (outs.length ? outs[0] : -1);
  for (const i of outs) {
    if (
      i !== outPin &&
      (looksBarred(nameOf(i)) || isComplementName(nameOf(i), nameOf(outPin)))
    ) {
      qbarPin = i;
      break;
    }
  }

  // --- 3. SEQUENTIAL DETECTION: a gain edge that lies on a feedback cycle -------------------------------
  const { sequential, loopReason } = detectFeedbackLoop(
    graph,
    frameId,
    resolveCell,
  );

  // --- 4. compose ---------------------------------------------------------------------------------------
  let reason: string;
  if (sequential) {
    reason =
      clockPin >= 0
        ? `sequential: ${loopReason}. Driving ${nameOf(clockPin) || `pin ${clockPin}`}${clockComplementPin >= 0 ? ` / ${nameOf(clockComplementPin)} (complement)` : ""} as the clock, observing ${nameOf(outPin) || `pin ${outPin}`}.`
        : `sequential: ${loopReason}, but no clock/enable pin is identifiable (name one CLK/EN, or tag its role).`;
  } else {
    reason = "combinational: no feedback loop through a gain stage.";
  }

  return {
    sequential,
    reason,
    dataInputs,
    clockPin,
    clockComplementPin,
    outPin,
    qbarPin,
    gndPin,
    vccPin,
  };
}

/**
 * Build the cell's signal-net graph and report whether a GAIN edge (a gate / characterized sub-cell's
 * in→out) lies on a feedback cycle — the structural signature of memory. Nets are union-found over the
 * wires/junctions; the frame and the power rails contribute no edges. A directed (gain) edge a→b means
 * "b is computed from a"; a bidirectional edge (a transmission gate / un-characterized pass cell) means
 * signal flows both ways. The cell has memory iff some gain edge a→b has a path b⇝a.
 */
function detectFeedbackLoop(
  graph: GraphSnapshot,
  frameId: number,
  resolveCell?: (tag: string) => ResolvedCell | undefined,
): { sequential: boolean; loopReason: string } {
  // union-find over endpoints (pins + junctions), keyed by string.
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = parent.get(k);
    if (r === undefined) {
      parent.set(k, k);
      return k;
    }
    while (r !== parent.get(r)) {
      const gp = parent.get(parent.get(r) as string) as string;
      parent.set(r, gp);
      r = gp;
    }
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const pinKey = (cid: number, pin: number): string => `c${cid}:${pin}`;
  type EP = { componentId: number; pinIndex: number } | { junctionId: number };
  const epKey = (ep: EP): string =>
    "componentId" in ep
      ? pinKey(ep.componentId, ep.pinIndex)
      : `j${ep.junctionId}`;

  for (const j of graph.junctions ?? []) find(`j${j.id}`);
  // wired pins per component (we only need pins that actually carry a wire).
  const compPins = new Map<number, Set<number>>();
  const reg = (ep: EP): void => {
    if ("componentId" in ep) {
      find(pinKey(ep.componentId, ep.pinIndex));
      let s = compPins.get(ep.componentId);
      if (!s) compPins.set(ep.componentId, (s = new Set()));
      s.add(ep.pinIndex);
    } else find(`j${ep.junctionId}`);
  };
  for (const w of graph.wires) {
    reg(w.from as EP);
    reg(w.to as EP);
    union(epKey(w.from as EP), epKey(w.to as EP));
  }

  // Build the directed adjacency (bidirectional pass edges add both directions) and remember which edges
  // are GAIN edges (the ones whose presence-on-a-cycle means memory).
  const adj = new Map<string, Set<string>>();
  const addDir = (a: string, b: string): void => {
    if (a === b) return;
    let s = adj.get(a);
    if (!s) adj.set(a, (s = new Set()));
    s.add(b);
  };
  const gainEdges: Array<[string, string]> = [];
  let gainLabel = "a feedback loop through a gain stage";

  for (const c of graph.components) {
    if (c.id === frameId) continue;
    const def = resolveCell?.(c.kind);
    const roles = def?.pinRoles ?? primitiveRoles(c.kind);
    if (!roles) continue; // unmodelled kind ⇒ no edges (conservative)
    const hasGain = !!def?.behavior || LOGIC_GATES.has(c.kind);
    const wired = [...(compPins.get(c.id) ?? [])];
    const inNets = wired
      .filter((p) => roles[p] === "in")
      .map((p) => find(pinKey(c.id, p)));
    const outNets = wired
      .filter((p) => roles[p] === "out")
      .map((p) => find(pinKey(c.id, p)));
    if (hasGain) {
      for (const a of inNets)
        for (const b of outNets) {
          addDir(a, b);
          gainEdges.push([a, b]);
        }
    } else if (inNets.length && outNets.length) {
      // an un-characterized pass cell (transmission gate) — signal flows both ways across it.
      for (const a of inNets)
        for (const b of outNets) {
          addDir(a, b);
          addDir(b, a);
        }
    }
  }

  // Memory iff some gain edge a→b has a return path b⇝a.
  const reaches = (start: string, target: string): boolean => {
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop() as string;
      if (cur === target) return true;
      for (const nx of adj.get(cur) ?? [])
        if (!seen.has(nx)) {
          seen.add(nx);
          stack.push(nx);
        }
    }
    return false;
  };
  for (const [a, b] of gainEdges) {
    if (reaches(b, a)) {
      gainLabel =
        "a gain stage's output feeds back to its own input (a storage loop)";
      return { sequential: true, loopReason: gainLabel };
    }
  }
  return { sequential: false, loopReason: gainLabel };
}

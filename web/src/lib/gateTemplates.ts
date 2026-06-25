// SPDX-License-Identifier: Apache-2.0
// STARTER GATE TEMPLATES (cell-characterization arc, §4.10 "gate-friendly path"). "New gate ▸ INV /
// NAND2 / NOR2" seeds the EXISTING one-level die editor with a pre-wired CMOS pull-up/pull-down DIE
// GRAPH — placed N-MOSFET (NM → ELEM_NMOS 11) / P-MOSFET (PM → ELEM_PMOS 12) parts, wires, the die
// frame with named pins (Y / A / B / VCC / GND) and PRESET test stimuli (dieTestGraph injects VCC/GND/
// IN) — so the seeded die SOLVES and SWITCHES immediately. The player edits/observes, then Seals via
// the ordinary flow: a gate is authored IN a package, so its Seal yields role='ic' DIRECTLY (no Tape
// out). It is the smallest tangible step of "build all the gates as subassemblies."
//
// Determinism: pure web data — a programmatically-built `GraphSnapshot` of placed NM/PM parts. The
// template is instantiated ONLY when the player picks it; the golden circuit places none, so the
// snapshot hash is untouched. The FET topology mirrors the CEC_COMP.INV reference (netlist.ts): an
// INV is PMOS(pull-up)+NMOS(pull-down) sharing drain Y, gates tied to A; NAND2 = series-NMOS /
// parallel-PMOS; NOR2 = parallel-NMOS / series-PMOS.
import { BoardGraph, dieFrameTag, framePackage, type PinTest } from "./graph";
import { DIE_FRAME_ORIGIN, type DieGraph } from "./dieEditor";

export type GateTemplateKind = "INV" | "NAND2" | "NOR2";

/** The package every starter gate is authored in: SOT-23-5, the real single-gate-logic body
 * (74LVC1G04 inverter / 1G00 NAND / 1G02 NOR all ship in SOT-23-5). 5 pins cover Y/A/B/VCC/GND; an
 * INV uses 4 + one NC. The player can re-package later. */
const FRAME_TAG = "SOT23_5";

interface TemplateSpec {
  /** display name for the "New gate" menu + the seal default name. */
  name: string;
  /** pin labels by die-frame pin index (→ the sealed chip's pin names). */
  pins: string[];
  /** preset per-pin stimuli (→ `dieTestGraph` virtual sources) so the seeded die solves + switches.
   * Output pin = null (observed); VCC = vcc@5; GND = gnd; inputs = in@(0|5). */
  tests: (PinTest | null)[];
  /** place the CMOS FETs (NM/PM) and wire them to the frame pins + each other. */
  build: (g: BoardGraph, frameId: number) => void;
}

/** N-MOSFET / P-MOSFET pin order is D(0), S(1), G(2) — see PART_KINDS NM/PM in graph.ts. */
const D = 0;
const S = 1;
const G = 2;

/** Frame pin indices (shared layout: Y=0, A=1, then B/VCC/GND). */
const Y = 0;
const A = 1;

const SPECS: Record<GateTemplateKind, TemplateSpec> = {
  // INV (74LVC1G04): PMOS pull-up + NMOS pull-down, drains shared at Y, gates tied to A.
  // Pins Y(0) A(1) VCC(2) GND(3) NC(4).
  INV: {
    name: "Inverter",
    pins: ["Y", "A", "VCC", "GND", "NC"],
    tests: [
      null,
      { role: "in", value: 0 },
      { role: "vcc", value: 5 },
      { role: "gnd", value: 0 },
      null,
    ],
    build(g, frame) {
      const VCC = 2;
      const GND = 3;
      const p = g.place("PM", { col: 12, row: 9 });
      const n = g.place("NM", { col: 12, row: 13 });
      if (!p || !n) throw new Error("INV template: FET placement failed");
      const w = wirer(g);
      // PMOS: D→Y, S→VCC, G→A
      w(p.id, D, frame, Y);
      w(p.id, S, frame, VCC);
      w(p.id, G, frame, A);
      // NMOS: D→Y, S→GND, G→A
      w(n.id, D, frame, Y);
      w(n.id, S, frame, GND);
      w(n.id, G, frame, A);
    },
  },
  // NAND2 (74LVC1G00): pull-up = 2 PMOS in PARALLEL (VCC→Y), pull-down = 2 NMOS in SERIES (Y→mid→GND).
  // Pins Y(0) A(1) B(2) VCC(3) GND(4).
  NAND2: {
    name: "NAND (2-input)",
    pins: ["Y", "A", "B", "VCC", "GND"],
    tests: [
      null,
      { role: "in", value: 5 },
      { role: "in", value: 5 },
      { role: "vcc", value: 5 },
      { role: "gnd", value: 0 },
    ],
    build(g, frame) {
      const B = 2;
      const VCC = 3;
      const GND = 4;
      const pA = g.place("PM", { col: 12, row: 9 });
      const pB = g.place("PM", { col: 16, row: 9 });
      const nA = g.place("NM", { col: 12, row: 13 });
      const nB = g.place("NM", { col: 16, row: 13 });
      if (!pA || !pB || !nA || !nB)
        throw new Error("NAND2 template: FET placement failed");
      const w = wirer(g);
      // pull-up parallel: both PMOS source→VCC, drain→Y, gates A / B
      w(pA.id, D, frame, Y);
      w(pA.id, S, frame, VCC);
      w(pA.id, G, frame, A);
      w(pB.id, D, frame, Y);
      w(pB.id, S, frame, VCC);
      w(pB.id, G, frame, B);
      // pull-down series: nA drain→Y gate→A ; nB source→GND gate→B ; mid = nA.S — nB.D
      w(nA.id, D, frame, Y);
      w(nA.id, G, frame, A);
      w(nB.id, S, frame, GND);
      w(nB.id, G, frame, B);
      g.connect(
        { componentId: nA.id, pinIndex: S },
        { componentId: nB.id, pinIndex: D },
      );
    },
  },
  // NOR2 (74LVC1G02): pull-up = 2 PMOS in SERIES (VCC→mid→Y), pull-down = 2 NMOS in PARALLEL (Y→GND).
  // Pins Y(0) A(1) B(2) VCC(3) GND(4).
  NOR2: {
    name: "NOR (2-input)",
    pins: ["Y", "A", "B", "VCC", "GND"],
    tests: [
      null,
      { role: "in", value: 0 },
      { role: "in", value: 0 },
      { role: "vcc", value: 5 },
      { role: "gnd", value: 0 },
    ],
    build(g, frame) {
      const B = 2;
      const VCC = 3;
      const GND = 4;
      const pA = g.place("PM", { col: 12, row: 9 });
      const pB = g.place("PM", { col: 16, row: 9 });
      const nA = g.place("NM", { col: 12, row: 13 });
      const nB = g.place("NM", { col: 16, row: 13 });
      if (!pA || !pB || !nA || !nB)
        throw new Error("NOR2 template: FET placement failed");
      const w = wirer(g);
      // pull-up series: pA source→VCC gate→A ; pB drain→Y gate→B ; mid = pA.D — pB.S
      w(pA.id, S, frame, VCC);
      w(pA.id, G, frame, A);
      w(pB.id, D, frame, Y);
      w(pB.id, G, frame, B);
      g.connect(
        { componentId: pA.id, pinIndex: D },
        { componentId: pB.id, pinIndex: S },
      );
      // pull-down parallel: both NMOS drain→Y source→GND, gates A / B
      w(nA.id, D, frame, Y);
      w(nA.id, S, frame, GND);
      w(nA.id, G, frame, A);
      w(nB.id, D, frame, Y);
      w(nB.id, S, frame, GND);
      w(nB.id, G, frame, B);
    },
  },
};

/** A tiny `connect(compPin → framePin)` helper bound to a graph. */
function wirer(g: BoardGraph) {
  return (comp: number, ci: number, frame: number, fi: number): void => {
    g.connect(
      { componentId: comp, pinIndex: ci },
      { componentId: frame, pinIndex: fi },
    );
  };
}

/** The display name of a starter-gate kind (for the "New gate" menu). */
export function gateTemplateName(kind: GateTemplateKind): string {
  return SPECS[kind].name;
}

/** All starter-gate kinds, in menu order. */
export const GATE_TEMPLATE_KINDS: GateTemplateKind[] = ["INV", "NAND2", "NOR2"];

/**
 * The {@link DieGraph} a "New gate ▸ <kind>" seeds the die editor with: a SOT-23-5 die frame (named
 * pins + preset stimuli) pre-wired with the gate's CMOS FETs, so the die solves and switches on entry.
 * Mirrors {@link freshDieGraph}'s frame placement, then lays the transistors over it. Returns undefined
 * only if the frame package is somehow unavailable (never, for the fixed SOT-23-5).
 */
export function gateTemplate(kind: GateTemplateKind): DieGraph | undefined {
  const spec = SPECS[kind];
  if (!spec || !framePackage(FRAME_TAG)) return undefined;
  const g = new BoardGraph();
  const frame = g.place(dieFrameTag(FRAME_TAG), { ...DIE_FRAME_ORIGIN });
  if (!frame) return undefined;
  spec.build(g, frame.id);
  frame.pinNames = [...spec.pins];
  frame.pinTests = spec.tests.map((t) => (t ? { ...t } : null));
  return { snapshot: g.serialize(), frameId: frame.id };
}

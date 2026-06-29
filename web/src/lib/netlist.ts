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
  PART_KINDS,
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
  capLeakTau,
  ecLeakTau,
  resistorNoiseAmp,
  DEFAULT_TIER,
  PARAM_STRIDE,
} from "./tiers";
import { diodeVariant, RATED_CURRENT_SLOT, DIODE_TT_SLOT } from "./diodes";
import {
  flattenUserIcs,
  getUserIc,
  isUserIc,
  type FlattenRecord,
  type UserIc,
} from "./userIc";

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

/** Peak MOSFET threshold-voltage mismatch (volts) emitted per device in Realistic mode — a
 * deterministic fab-variation spread (`MOSFET_VTH_MISMATCH * jitter(id)`, ±this). A few percent of
 * the ~2 V threshold: negligible for logic noise margins, but enough to break a cross-coupled latch's
 * perfect symmetry so an unwritten transistor 6T SRAM / flip-flop powers up to a definite, layout-
 * determined bit instead of the metastable mid-rail (sim-core `break_metastable_latches` reads slot 1
 * raw/signed). Omitted in Ideal mode → every device is its nominal self and an ideal symmetric cell is
 * honestly metastable. */
const MOSFET_VTH_MISMATCH = 0.03;

// Solver element types, keyed by part tag. Only kinds listed here become
// elements; 1-pin reference parts (GND) are deliberately absent so the element
// loop skips them. Mirrors the `ELEM_*` constants in `crates/sim-core/src/lib.rs`.
const TYPE_OF: Record<string, number> = {
  V: 0,
  R: 1,
  // Current-sense shunt: the SAME solver element as R (a plain resistor), distinguished only by
  // its milliohm value. In Real mode every resistor carries a ~10 nH lead inductance in the AC
  // solve, so a low-value shunt develops a visible high-frequency phase lag while a normal R does
  // not. No new sim element; the golden is unchanged.
  SHUNT: 1,
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
  // Pulse / clock generator: the SAME solver element as AC (a time-varying voltage source),
  // distinguished only by its waveform param (slot 1 = 1 square / 2 triangle) and duty (slot 3),
  // written below. value = frequency (Hz), aux = amplitude (V). No new sim element.
  PULSE: 7,
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
  IMPLY: 17,
  NIMPLY: 17,
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
  // Clocked sampler: a THREE-terminal clocked 1-bit quantizer (the ADC atom). Pins
  // ordered OUT, IN, CLK (pin 0 → a = OUT, 1 → b = IN, 2 → c = CLK). `value` = the
  // comparison threshold (volts). Uses `c` (its CLK), so it joins THREE_PIN_TYPES below.
  SAMP: 22,
  // Analog switch: a FIVE-terminal node-gated transmission gate. Pins ordered A, B,
  // CTRL, VCC, GND (pin 0 → a, 1 → b = signal path, 2 → c = CTRL, 3 → d = VCC, 4 → e =
  // GND). `value` = the on-resistance R_on (Ω). Uses `c`/`d`/`e`, so it joins
  // FIVE_PIN_TYPES below.
  ASW: 24,
  // Comparator: a FIVE-terminal powered open-loop comparator. Pins ordered OUT, IN+,
  // IN−, VCC, GND (pin 0 → a = OUT, 1 → b = IN+, 2 → c = IN−, 3 → d = VCC, 4 → e = GND).
  // `value` = the input hysteresis V_H. Uses `c`/`d`/`e`, so it joins FIVE_PIN_TYPES
  // below; the latch-enable terminal `f` is left unwired (ground), so the core reads it
  // as transparent (a continuous compare).
  CMP: 23,
  // NOTE: EC (electrolytic cap) is deliberately ABSENT here. It has no single
  // element type — it expands below into an ideal capacitor (type 2) in series
  // with an ESR resistor (type 1) sharing a private internal node.
};

/**
 * Element types that carry a third (control) terminal `c`: the MOSFETs (gate),
 * the BJTs (base), the op-amp (its non-inverting input IN+), and the clocked sampler
 * (type 22, its CLK). For all of them pin 2 → c, and that pin's node is the one
 * stamped into the `c` array; every two-terminal element leaves c = 0 (ground), where
 * the core ignores it. (A 4-/5-pin device also stamps its pin-2 node via this set —
 * see the `nc` computation below — so the transformer, flip-flop, and analog switch
 * route through their FOUR_/FIVE_PIN_TYPES membership, not this set.)
 */
const THREE_PIN_TYPES = new Set<number>([11, 12, 13, 14, 15, 17, 22]);

/**
 * Element types that carry a **fourth** terminal `d`: the transformer (type 18,
 * pin 3 = secondary−) and the D flip-flop (type 19, pin 3 = Q̄). Pin 3 → d, stamped
 * into the `d` array; every element with three or fewer terminals leaves d = 0
 * (ground), where the core ignores it.
 */
const FOUR_PIN_TYPES = new Set<number>([18, 19]);

/**
 * Element types that carry a **fifth** terminal `e`: the powered logic gate (type 17,
 * pins OUT, IN1, IN2, VCC, GND), the analog switch (type 24, pins A, B, CTRL, VCC, GND),
 * and the comparator (type 23, pins OUT, IN+, IN−, VCC, GND). For all, pin 3 → d = VCC
 * and pin 4 → e = GND. The `nc`/`nd`/`ne` computations
 * below all test FIVE_PIN_TYPES membership, so adding a kind here emits its full
 * c (pin 2) / d (pin 3) / e (pin 4) trio. Every element with fewer pins leaves e = 0
 * (ground), where the core ignores it. Pin 4 → e.
 */
const FIVE_PIN_TYPES = new Set<number>([17, 23, 24]);

/**
 * Logic-gate boolean function codes, keyed by part tag, written into each gate's
 * second scalar `aux`. Mirrors `gate_logic` in `crates/sim-core/src/lib.rs`:
 * 0 AND, 1 OR, 2 NAND, 3 NOR, 4 XOR, 5 XNOR, 6 NOT, 7 BUF, 8 IMPLY, 9 NIMPLY. Every gate part maps to
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
  IMPLY: 8,
  NIMPLY: 9,
};

// Element type for a powered logic gate (the CEC composites stamp these).
const ELEM_GATE = 17;
// Element type for a behavioral block (LUT / SPI / UART), run by an FSM in the core.
const ELEM_BEHAVIORAL = 25;
// Element type for a behavioral MEMORY array (ROM/RAM/EEPROM/DRAM), contents in a heap store.
const ELEM_MEMORY = 26;

/**
 * CEC composite logic ICs (`docs/ui/cec-teaching-ics.md`) — house teaching parts with no single
 * discrete equivalent — expand into a small network of **powered `ELEM_GATE`s** wired through
 * private internal nodes, exactly like the EC/POT expansions but multi-gate. There is no new
 * sim-core element (golden-safe); each is `buildNetlist` composition. A `GateStep` is
 * `[funcCode, out, in1, in2]`; a terminal ref is a **pin index** (`>= 0`) or an **internal node**
 * (`< 0`, where `-1` → internal[0], `-2` → internal[1], …). The expander resolves refs, routes the
 * part's VCC/GND pins to every sub-gate's `d`/`e`, and emits one `ELEM_GATE` per step. `primary` is
 * the step whose element backs the part's glyph/inspector current; `voutPin` the pin read for
 * `vAcross`. (Gate func codes mirror `GATE_AUX`: AND 0, OR 1, NOR 3, XOR 4, NOT 6. A NOT step
 * ignores `in2`, so it is set equal to `in1`.)
 *
 * A few composites need **non-gate** elements too (the JK flip-flop's `ELEM_DFF`, the tri-state
 * buffer's `ELEM_ASWITCH` + pull-down resistor + an internally-railed buffer). Those go in the
 * optional `extra` list as **raw element steps** — `{ t, a, b, c, d, e, value, aux }` with every
 * terminal an explicit ref (pin index or internal node) — emitted verbatim after the gates. `primary`
 * indexes the COMBINED emission order (gates first, then extra), so it can point at a raw element.
 */
type GateStep = [func: number, out: number, in1: number, in2: number];
interface RawStep {
  t: number; // sim element type
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  value: number;
  aux: number;
}
interface CecComp {
  internal: number; // private internal node count
  vccPin: number;
  gndPin: number;
  voutPin: number; // pin whose voltage is the part's "output" (for vAcross)
  primary: number; // index into the combined (gates then extra) emission backing the part current
  gates: GateStep[];
  extra?: RawStep[]; // non-gate elements (DFF, analog switch, resistor), emitted after the gates
}
// Internal-node ref helper: internal node k → the ref value the expander resolves.
const NI = (k: number): number => -(k + 1);
const CEC_COMP: Record<string, CecComp> = {
  // Half-adder (CEC2024): pins SUM(0) GND(1) A(2) B(3) COUT(4) VCC(5). SUM = A^B, COUT = A&B.
  HADD: {
    internal: 0,
    vccPin: 5,
    gndPin: 1,
    voutPin: 0,
    primary: 0,
    gates: [
      [4, 0, 2, 3], // SUM = XOR(A, B)
      [0, 4, 2, 3], // COUT = AND(A, B)
    ],
  },
  // Full-adder (CEC2018): pins SUM(0) GND(1) A(2) B(3) CIN(4) COUT(5) VCC(6).
  // SUM = A^B^CIN; COUT = majority(A,B,CIN) = AB + CIN(A^B). Reuses t0 = A^B.
  FADD: {
    internal: 3,
    vccPin: 6,
    gndPin: 1,
    voutPin: 0,
    primary: 1,
    gates: [
      [4, NI(0), 2, 3], // t0 = XOR(A, B)
      [4, 0, NI(0), 4], // SUM = XOR(t0, CIN)
      [0, NI(1), 2, 3], // t1 = AND(A, B)
      [0, NI(2), 4, NI(0)], // t2 = AND(CIN, t0)
      [1, 5, NI(1), NI(2)], // COUT = OR(t1, t2)
    ],
  },
  // Inverter (CEC9002): pins Y(0) A(1) VCC(2) GND(3). The real CMOS complementary pair — PMOS
  // (drain=Y, source=VCC, gate=A) pulls Y up when A is low; NMOS (drain=Y, source=GND, gate=A) pulls Y
  // down when A is high; the shared drain Y is the push-pull output. No gates, no new sim element
  // (ELEM_PMOS=12 / ELEM_NMOS=11 already exist) → golden-safe. compositeInternals records the two FETs,
  // so zoom-to-open draws the real transistors with live currents (and Phase 3 hands off to silicon).
  INV: {
    internal: 0,
    vccPin: 2,
    gndPin: 3,
    voutPin: 0,
    primary: 0, // the PMOS backs the part's glyph current
    gates: [],
    extra: [
      // ELEM_PMOS (12): a=drain=Y(0), b=source=VCC(2), c=gate=A(1). value unused (square-law model).
      { t: 12, a: 0, b: 2, c: 1, d: 0, e: 0, value: 0, aux: 0 },
      // ELEM_NMOS (11): a=drain=Y(0), b=source=GND(3), c=gate=A(1). value unused.
      { t: 11, a: 0, b: 3, c: 1, d: 0, e: 0, value: 0, aux: 0 },
    ],
  },
  // 2:1 mux (CEC2031): pins Y(0) GND(1) A(2) B(3) SEL(4) VCC(5). Y = A&~SEL | B&SEL.
  MUX2: {
    internal: 3,
    vccPin: 5,
    gndPin: 1,
    voutPin: 0,
    primary: 3,
    gates: [
      [6, NI(0), 4, 4], // nsel = NOT(SEL)
      [0, NI(1), 2, NI(0)], // t1 = AND(A, nsel)
      [0, NI(2), 3, 4], // t2 = AND(B, SEL)
      [1, 0, NI(1), NI(2)], // Y = OR(t1, t2)
    ],
  },
  // 1:2 demux / 1-of-2 decoder (CEC2032): pins Y0(0) GND(1) Y1(2) D(3) SEL(4) VCC(5).
  DMUX: {
    internal: 1,
    vccPin: 5,
    gndPin: 1,
    voutPin: 0,
    primary: 1,
    gates: [
      [6, NI(0), 4, 4], // nsel = NOT(SEL)
      [0, 0, 3, NI(0)], // Y0 = AND(D, nsel)
      [0, 2, 3, 4], // Y1 = AND(D, SEL)
    ],
  },
  // SR latch (CEC3007): pins Q(0) GND(1) S(2) R(3) VCC(4). Two cross-coupled NORs —
  // Q = NOR(R, Qbar), Qbar = NOR(S, Q). Qbar is the one internal node. The digital
  // sub-solve settles the feedback; S=R=1 drives both low (the forbidden state).
  SRL: {
    internal: 1,
    vccPin: 4,
    gndPin: 1,
    voutPin: 0,
    primary: 1,
    gates: [
      [3, NI(0), 2, 0], // Qbar = NOR(S, Q)
      [3, 0, 3, NI(0)], // Q = NOR(R, Qbar)
    ],
  },
  // D-latch (CEC3014): pins Q(0) GND(1) D(2) EN(3) Qbar(4) VCC(5). A gated SR latch —
  // steering ANDs (S = D·EN, R = ¬D·EN) into the cross-coupled NOR pair. Transparent
  // (Q follows D) while EN high; holds when EN low (both steering terms forced low).
  DLATCH: {
    internal: 3,
    vccPin: 5,
    gndPin: 1,
    voutPin: 0,
    primary: 3,
    gates: [
      [6, NI(0), 2, 2], // nd = NOT(D)
      [0, NI(1), 2, 3], // s = AND(D, EN)
      [0, NI(2), NI(0), 3], // r = AND(nd, EN)
      [3, 0, NI(2), 4], // Q = NOR(r, Qbar)
      [3, 4, NI(1), 0], // Qbar = NOR(s, Q)
    ],
  },
  // Majority / voter (CEC2046, 74-series gate order): pins A(0) B(1) GND(2) C(3) Y(4) VCC(5).
  // Y = AB + BC + CA.
  MAJ3: {
    internal: 4,
    vccPin: 5,
    gndPin: 2,
    voutPin: 4,
    primary: 4,
    gates: [
      [0, NI(0), 0, 1], // t0 = AND(A, B)
      [0, NI(1), 1, 3], // t1 = AND(B, C)
      [0, NI(2), 3, 0], // t2 = AND(C, A)
      [1, NI(3), NI(0), NI(1)], // t3 = OR(t0, t1)
      [1, 4, NI(3), NI(2)], // Y = OR(t3, t2)
    ],
  },
  // JK / T flip-flop (CEC3076): pins Q(0) GND(1) J(2) K(3) CLK(4) Q̄(5) VCC(6). A D
  // flip-flop fed by JK steering: D = J·Q̄ + ¬K·Q. The steering is four powered gates;
  // the memory is a raw ELEM_DFF (Q=a, D=b, CLK=c, Q̄=d). The edge trigger makes J=K=1
  // a clean toggle. Tie J=K for a T flip-flop. Internals: nk, t1, t2, D = 4 nodes.
  JKFF: {
    internal: 4,
    vccPin: 6,
    gndPin: 1,
    voutPin: 0,
    primary: 4, // the DFF (4 gate steps precede it in the combined order)
    gates: [
      [6, NI(0), 3, 3], // nk = NOT(K)
      [0, NI(1), 2, 5], // t1 = AND(J, Q̄)
      [0, NI(2), NI(0), 0], // t2 = AND(nk, Q)
      [1, NI(3), NI(1), NI(2)], // D = OR(t1, t2)
    ],
    extra: [
      // ELEM_DFF (19): Q=a, D=b, CLK=c, Q̄=d. Powered by its `value` logic rail (it has
      // no VCC/GND pins); the steering gates use the part's wired VCC/GND.
      { t: 19, a: 0, b: NI(3), c: 4, d: 5, e: 0, value: 5, aux: 0 },
    ],
  },
  // Tri-state buffer (CEC2057): pins Y(0) GND(1) A(2) OE(3) VCC(4). A buffer whose VCC
  // rail is gated by OE (the dead-rail-Z trick): an ELEM_ASWITCH passes VCC onto a private
  // rail node when OE is high, a large pull-down collapses that rail when OE is low, and a
  // BUF gate powered from that rail drives Y = A (OE high) or releases to Z (OE low, rail
  // below the gate's operating minimum). Internal: the gated rail node = 1.
  TRI: {
    internal: 1,
    vccPin: 4,
    gndPin: 1,
    voutPin: 0,
    primary: 2, // the buffer (the two raw switch/resistor steps precede it; 0 gates)
    gates: [],
    extra: [
      // ASWITCH (24): a/b = VCC↔rail, c = OE (control), d = VCC, e = GND. Small R_on so the
      // rail sits at ~VCC when closed.
      { t: 24, a: 4, b: NI(0), c: 3, d: 4, e: 1, value: 10, aux: 0 },
      // Pull-down resistor (1) rail→GND: large, so an open switch collapses the rail to ~0.
      { t: 1, a: NI(0), b: 1, c: 0, d: 0, e: 0, value: 1e5, aux: 0 },
      // BUF gate (17, func 7) Y = A, powered from the GATED rail (d = rail, e = GND): dead
      // (output Z) when the rail collapses, drives A when the rail is up.
      { t: 17, a: 0, b: 2, c: 2, d: NI(0), e: 1, value: 5, aux: 7 },
    ],
  },
  // R-2R ladder DAC (CEC1083): pins AOUT(0) GND(1) D0(2) D1(3) D2(4) VCC(5). Pure resistors —
  // a 3-bit R-2R ladder turns the binary code D2 D1 D0 into AOUT = (4·D2 + 2·D1 + D0)/8 · Vhigh,
  // where Vhigh is the high level external logic drives onto the D pins. Two R form the A-B-C
  // spine (node A = AOUT; B, C internal), four 2R are the bit legs (A→D2, B→D1, C→D0) plus the
  // C→GND termination; each step toward the LSB halves a bit's weight, giving binary weighting
  // from one repeated R-2R cell. No gates, no new sim element — golden-safe. VCC is nominal here
  // (the real reference is the external logic's high level); a 1 MΩ bleeder ties it to GND so the
  // pin is never an isolated node. Internals: B, C = 2.
  DAC: {
    internal: 2,
    vccPin: 5,
    gndPin: 1,
    voutPin: 0,
    primary: 0, // the A-B spine resistor (no gates precede it) — its current backs the part
    gates: [],
    extra: [
      // Spine: two R. A(AOUT) - B - C.
      { t: 1, a: 0, b: NI(0), c: 0, d: 0, e: 0, value: 10000, aux: 0 }, // R: A - B
      { t: 1, a: NI(0), b: NI(1), c: 0, d: 0, e: 0, value: 10000, aux: 0 }, // R: B - C
      // Bit legs: four 2R. A→D2 (MSB at the output node), B→D1, C→D0, and C→GND (termination).
      { t: 1, a: 0, b: 4, c: 0, d: 0, e: 0, value: 20000, aux: 0 }, // 2R: A - D2
      { t: 1, a: NI(0), b: 3, c: 0, d: 0, e: 0, value: 20000, aux: 0 }, // 2R: B - D1
      { t: 1, a: NI(1), b: 2, c: 0, d: 0, e: 0, value: 20000, aux: 0 }, // 2R: C - D0
      { t: 1, a: NI(1), b: 1, c: 0, d: 0, e: 0, value: 20000, aux: 0 }, // 2R: C - GND
      // Bleeder: keep VCC referenced (never an isolated node) without loading the ladder.
      { t: 1, a: 5, b: 1, c: 0, d: 0, e: 0, value: 1e6, aux: 0 }, // 1 MΩ VCC - GND
    ],
  },
  // 3-bit flash ADC (CEC1080), the DISCRETE remake (ADR 0005 phase 4): a real comparator-bank
  // converter so the chip can open to its true internals. Pins VIN(0) VREF(1) D2(2) D1(3) D0(4)
  // VCC(5) GND(6). An 8-resistor ladder VREF->GND makes 7 taps (k/8·VREF); 7 transparent
  // comparators (IN+ = VIN, IN- = tap_k) form the thermometer code th_k = (VIN > k/8·VREF); a gate
  // encoder turns thermometer -> binary: D2 = th4, D1 = th2·¬th4 + th6, D0 = th1·¬th2 + th3·¬th4 +
  // th5·¬th6 + th7. c4 drives D2 directly (so th4 = the D2 pin). Internals (22): tap1..7 = NI0..6;
  // th1,2,3,5,6,7 = NI7..12; ¬th2,¬th4,¬th6 = NI13,14,15; a1 = NI16; a2,a3,a4 = NI17,18,19;
  // o1,o2 = NI20,21. No new sim element (comparators + resistors + powered gates); golden-safe.
  ADC: {
    internal: 22,
    vccPin: 5,
    gndPin: 6,
    voutPin: 4, // D0
    primary: 0, // the first encoder gate (no meaningful single "part current" for a converter)
    gates: [
      [6, NI(13), NI(8), NI(8)], // ¬th2 = NOT(th2)
      [6, NI(14), 2, 2], // ¬th4 = NOT(D2)  (th4 is the D2 pin)
      [6, NI(15), NI(11), NI(11)], // ¬th6 = NOT(th6)
      [0, NI(16), NI(8), NI(14)], // a1 = AND(th2, ¬th4)
      [1, 3, NI(16), NI(11)], // D1 = OR(a1, th6)
      [0, NI(17), NI(7), NI(13)], // a2 = AND(th1, ¬th2)
      [0, NI(18), NI(9), NI(14)], // a3 = AND(th3, ¬th4)
      [0, NI(19), NI(10), NI(15)], // a4 = AND(th5, ¬th6)
      [1, NI(20), NI(17), NI(18)], // o1 = OR(a2, a3)
      [1, NI(21), NI(19), NI(12)], // o2 = OR(a4, th7)
      [1, 4, NI(20), NI(21)], // D0 = OR(o1, o2)
    ],
    extra: [
      // R-2R... no: a uniform 8-resistor ladder, GND -> tap1..tap7 -> VREF (taps at k/8·VREF).
      { t: 1, a: 6, b: NI(0), c: 0, d: 0, e: 0, value: 10000, aux: 0 },
      { t: 1, a: NI(0), b: NI(1), c: 0, d: 0, e: 0, value: 10000, aux: 0 },
      { t: 1, a: NI(1), b: NI(2), c: 0, d: 0, e: 0, value: 10000, aux: 0 },
      { t: 1, a: NI(2), b: NI(3), c: 0, d: 0, e: 0, value: 10000, aux: 0 },
      { t: 1, a: NI(3), b: NI(4), c: 0, d: 0, e: 0, value: 10000, aux: 0 },
      { t: 1, a: NI(4), b: NI(5), c: 0, d: 0, e: 0, value: 10000, aux: 0 },
      { t: 1, a: NI(5), b: NI(6), c: 0, d: 0, e: 0, value: 10000, aux: 0 },
      { t: 1, a: NI(6), b: 1, c: 0, d: 0, e: 0, value: 10000, aux: 0 },
      // 7 transparent comparators: OUT, IN+ = VIN(0), IN- = tap_k, VCC(5), GND(6). value = 0 (no
      // hysteresis); f left unwired by the expander (ground) => continuous compare.
      { t: 23, a: NI(7), b: 0, c: NI(0), d: 5, e: 6, value: 0, aux: 0 }, // th1
      { t: 23, a: NI(8), b: 0, c: NI(1), d: 5, e: 6, value: 0, aux: 0 }, // th2
      { t: 23, a: NI(9), b: 0, c: NI(2), d: 5, e: 6, value: 0, aux: 0 }, // th3
      { t: 23, a: 2, b: 0, c: NI(3), d: 5, e: 6, value: 0, aux: 0 }, // th4 -> D2 pin
      { t: 23, a: NI(10), b: 0, c: NI(4), d: 5, e: 6, value: 0, aux: 0 }, // th5
      { t: 23, a: NI(11), b: 0, c: NI(5), d: 5, e: 6, value: 0, aux: 0 }, // th6
      { t: 23, a: NI(12), b: 0, c: NI(6), d: 5, e: 6, value: 0, aux: 0 }, // th7
    ],
  },
};

/**
 * Behavioral blocks (`ELEM_BEHAVIORAL`, `docs/ui/cec-teaching-ics.md` / sim-core `BEH_PROG_*`) — a
 * tiny FSM in the core selected by the **program id** in `value`. Each is a single 8-terminal
 * element. `term` maps each sim terminal `a..h` to a **visual pin index** (`-1` = ground/unused), so
 * the catalog pinout can read naturally while buildNetlist routes pins to the core's fixed terminal
 * order. `value` is the fixed program id (NOT a logic rail); `aux` is the data word — the LUT's
 * 16-bit truth table or the serial blocks' data word — taken from `Component.word` (default
 * `defWord`). The LUT's combinational/registered choice rides `Component.mode` → `params[4]`.
 */
interface BehSpec {
  prog: number; // program id → value (1 SPI master, 2 SPI slave, 3 UART, 4 LUT)
  term: number[]; // length 8: terminal a..h ← visual pin index (-1 = ground/unused)
  defWord: number; // default aux (truth table / data word) when Component.word is unset
}
const BEH_LUT_MODE_SLOT = 4; // params slot: >= 1 → registered, else combinational (sim-core)
const CAP_LEAK_SLOT = 5; // params slot: capacitor self-discharge tau (s); 0 = no leak (mirror sim-core)
const NOISE_SLOT = 6; // params slot: thermal-noise current amplitude (A); 0 = silent (mirror sim-core)
// A diode's SHOT-noise scale (a √A): sim-core injects `SHOT_NOISE_SCALE · √|I| · sample` (the shot-noise
// current ∝ √I). Game-scaled for legibility; a junction property, not a quality grade, so it's a constant.
const SHOT_NOISE_SCALE = 0.02;
const TEMPCO_SLOT = 7; // params slot: resistor self-heating temperature coefficient α (1/°C); 0 = none
// Self-heating temperature coefficients (1/°C) — the thermal-runaway feedback (sim-core uses
// R(T) = value·(1 + α·(Tj − 25))). NTC: a strong NEGATIVE α makes a dominant thermistor run away (heat ⇒
// R drops ⇒ V²/R climbs ⇒ more heat). PTC: a POSITIVE α self-limits (heat ⇒ R rises ⇒ current falls).
// Game-scaled (a legible linear slope, not the part's full β-model R(T)).
const NTC_TEMPCO = -0.05;
const PTC_TEMPCO = 0.03;
// A BJT reuses TEMPCO_SLOT for its OWN runaway seed: the saturation-current temperature coefficient γ
// (1/°C), feeding sim-core's Is(T) = BJT_IS·exp(γ·(Tj − 25)). At a fixed base bias the collector current
// climbs with junction temperature → Vce·Ic dissipation climbs → hotter (runaway), tamed by an emitter
// ballast. γ ≈ ln(2)/10 ⇒ Is roughly doubles every ~10 °C (the textbook rule). Game-scaled like the
// thermistor α; Real-mode only (Ideal / golden ⇒ 0 ⇒ Is = BJT_IS, byte-identical).
const BJT_IS_TEMPCO = 0.07;
const BEH_SPEC: Record<string, BehSpec> = {
  // FPGA logic cell (prog 4): a=OUT b=CLK c=I3 d=VCC e=GND f=I0 g=I1 h=I2.
  // Visual pins [OUT, I0, I1, I2, I3, CLK, VCC, GND]. Default table = 2-input XOR (0x6666).
  LUT: { prog: 4, term: [0, 5, 4, 6, 7, 1, 2, 3], defWord: 0x6666 },
  // SPI master (prog 1): a=SCLK b=MOSI c=CS d=VCC e=GND f=MISO g=START (h unused).
  // Visual pins [SCLK, MOSI, MISO, CS, START, VCC, GND].
  SPIM: { prog: 1, term: [0, 1, 3, 5, 6, 2, 4, -1], defWord: 0xa5 },
  // SPI slave (prog 2): a=MISO b=RXVALID d=VCC e=GND f=SCLK g=MOSI h=CS (c unused).
  // Visual pins [MISO, RXV, SCLK, MOSI, CS, VCC, GND].
  SPIS: { prog: 2, term: [0, 1, -1, 5, 6, 2, 3, 4], defWord: 0x3c },
  // UART (prog 3): a=TX b=RXVALID d=VCC e=GND f=RX g=SEND (c, h unused).
  // Visual pins [TX, RX, RXV, SEND, VCC, GND].
  UART: { prog: 3, term: [0, 2, -1, 4, 5, 1, 3, -1], defWord: 0x55 },
  // (The 3-bit flash ADC, formerly behavioral prog 5, is now a DISCRETE composition — see
  // CEC_COMP.ADC — so it opens to its real comparator bank + ladder + encoder in the zoom-to-open
  // view, ADR 0005 phase 4. sim-core prog 5 is retained, golden-safe, just no longer web-wired.)
  // 3-bit SAR ADC (prog 6): a=D0 b=D1 c=D2 d=VCC e=GND f=VIN g=DONE h=CLK. The committed result
  // register drives D0/D1/D2 and the DONE strobe (a FOURTH behavioral output on g); VIN is the
  // analog sense, CLK steps the 3-clock binary search, VCC is the full-scale reference. No data
  // word (aux unused). Visual pins [VIN, CLK, D2, D1, D0, DONE, VCC, GND].
  SAR: { prog: 6, term: [4, 3, 2, 6, 7, 0, 5, 1], defWord: 0 },
  // 3-bit binary counter (prog 7): a=Q0 b=Q1 c=Q2 d=VCC e=GND f=CLK g=RESET (h unused). The
  // committed count drives Q0/Q1/Q2 on a/b/c (the generic output path); CLK increments, RESET
  // (active-high) async-clears. No data word (aux unused). Visual pins [CLK, RESET, Q2, Q1, Q0,
  // VCC, GND].
  CTR: { prog: 7, term: [4, 3, 2, 5, 6, 0, 1, -1], defWord: 0 },
  // 1st-order sigma-delta ADC (prog 8): a=D0 b=D1 c=D2 d=VCC e=GND f=VIN g=BS h=CLK. The decimated
  // code drives D0/D1/D2 and the 1-bit modulator stream drives BS (a FOURTH output on g, like the
  // SAR's DONE — same term map). VCC is the reference. No data word (aux unused). Visual pins
  // [VIN, CLK, D2, D1, D0, BS, VCC, GND].
  SDM: { prog: 8, term: [4, 3, 2, 6, 7, 0, 5, 1], defWord: 0 },
};

/**
 * Behavioral MEMORY arrays (`ELEM_MEMORY`, `docs/memory-characterization-design.md`) — one 8-terminal
 * element whose contents live in a heap store, NOT the MNA matrix. `term` maps each sim terminal a..h to a
 * visual pin index (the cell-level core map: a=D_out, b=WE, c=D_in, d=VCC, e=GND, f=A0, g=A1, h=A2);
 * `mode` is the sim-core param-slot-0 identity (1 RAM(SRAM) / 0 ROM / 2 EEPROM / 3 DRAM); `addrWidth`
 * (slot 1) sets depth `2^addrWidth`, `wordWidth` (slot 3) the bits per word. The chip-level pinout is
 * address + data + control — real chips never expose bitlines, which are internal to the collapsed grid.
 */
interface MemSpec {
  term: number[]; // length 8: terminal a..h ← visual pin index (-1 = ground/unused)
  mode: number; // sim-core ELEM_MEMORY param slot 0 (0 ROM / 1 RAM / 2 EEPROM / 3 DRAM)
  addrWidth: number; // param slot 1 → depth 2^addrWidth
  wordWidth: number; // param slot 3
  retention?: number; // DRAM only: param slot 4 = retention_ticks (Real-mode non-ideality)
}
const MEM_ADDR_SLOT = 1; // ELEM_MEMORY param slots (mirror sim-core)
const MEM_WORD_SLOT = 3;
const MEM_RETENTION_SLOT = 4;
const MEM_SPEC: Record<string, MemSpec> = {
  // RAM chip: visual pins [D, A0, A1, A2, WE, DI, VCC, GND] (graph.ts PART_KINDS.RAM). 8×1 SRAM.
  RAM: { term: [0, 4, 5, 6, 7, 1, 2, 3], mode: 1, addrWidth: 3, wordWidth: 1 },
  // DRAM chip: same cell-level interface; mode 3 → a row not re-accessed within `retention` ticks rots
  // (sim-core eager decay). Retention is a Real-mode non-ideality (Ideal mode = nominal, no decay).
  DRAM: {
    term: [0, 4, 5, 6, 7, 1, 2, 3],
    mode: 3,
    addrWidth: 3,
    wordWidth: 1,
    retention: 1000,
  },
  // NAND flash chip (mode 4): non-volatile, but a program can only CLEAR bits (1→0) and a high on ERASE
  // resets the whole block to 1s. Visual pins [D, A0, A1, WE, DI, ERASE, VCC, GND] (graph.ts PART_KINDS.FLASH).
  // The toy reserves the 3rd address bit's slot for ERASE, so it addresses on A0/A1 only (addrWidth 2 →
  // depth 4); sim terminal h = ERASE. Try to program a 0→1 and the device FAILs ("erase the block first").
  FLASH: {
    term: [0, 3, 4, 6, 7, 1, 2, 5],
    mode: 4,
    addrWidth: 2,
    wordWidth: 1,
  },
};

// Element types the EC (electrolytic cap) expansion stamps directly.
const ELEM_RESISTOR = 1;
const ELEM_CAPACITOR = 2;
const ELEM_ISOURCE = 4;

// (Electrolytic-cap ESR is now graded by tier — see `ecEsr` in lib/tiers.ts.)

// Minimum resistance of either potentiometer leg, in ohms — a small wiper-contact
// floor so an end-stop wiper (t → 0 or 1) reads as a near-short rather than an
// exact 0 Ω (which the resistor stamp would treat as an open). Also keeps the wiper
// node referenced through both legs at the extremes.
const POT_WIPER_MIN = 0.5;

// Tier params that change the TRANSIENT operating point — a source's output impedance, a
// MOSFET's transconductance Kp, a BJT's gain β — and so are applied ONLY in Real (realistic)
// mode; in Ideal mode every such part is its nominal self (the sim-core default) regardless of
// tier. The other tiered kinds (op-amp GBW, cap ESR/ESL, inductor DCR/Cw) are AC-only and gate
// inside sim-core's `ac_solve` instead, so their param block is installed in both modes (it is
// harmless to the transient solve, which never reads those slots).
const TRANSIENT_TIER_KINDS = new Set(["V", "AC", "NM", "PM", "Q", "QP"]);

/**
 * One sub-element inside an expanded composite IC, for the zoom-to-open "mini-mode" view
 * (ADR 0005). `index` is into `element_currents` (the live sub-element current); `nodes` are its
 * resolved terminal node indices into `node_voltages`, in a..e order (for a gate: out, in1, in2,
 * VCC, GND). `func` is the gate function code for an `ELEM_GATE`, else the element's `aux`.
 */
export interface CompositeSubElement {
  index: number;
  type: number;
  func: number;
  nodes: number[];
}

/**
 * The internal topology of one expanded composite IC (`CEC_COMP`), recorded so the zoom-to-open
 * view can draw the chip's real sub-circuit live from the same snapshot the board already reads
 * (ADR 0005 phase 1). All node indices are into `node_voltages`, all element indices into
 * `element_currents`. Built only for composites; absent for behavioral blocks (one opaque element)
 * and leaf parts. Render-side only — never crosses to the core, never hashed.
 */
export interface CompositeInternals {
  /** node index per external pin, by pin index (the package boundary). */
  pinNodes: number[];
  /** the private internal node indices (from `cecInternal`). */
  internalNodes: number[];
  /** the VCC / GND rail node indices, so the view can normalise a node to a logic level. */
  vccNode: number;
  gndNode: number;
  /** the sub-elements (gates first, then `extra`), in emission order. */
  elements: CompositeSubElement[];
}

/** One inner part of a sealed USER IC, for the zoom-to-open mini-board: the authored discrete part
 * with its authored grid position/rotation/value and resolved per-pin node indices. Unlike a built-in
 * composite's {@link CompositeSubElement} (a generic-grid sub-element), this keeps the real kind tag
 * and the player's drawn position so the view can render the EXACT circuit's glyphs in place. */
export interface UserIcInnerPart {
  /** the inner component's AUTHORED graph id (`Component.id` within `innerGraph`), so the zoom-to-open
   * replica can inject this part's current at its pin endpoints when solving per-inner-wire branch flow
   * (`solveWireFlow`) — the wires reference these same authored ids. Render-only; never hashed. */
  id: number;
  /** the inner component's kind tag (a real part — keys `PART_KINDS`). */
  kind: string;
  /** the authored anchor cell (the inner graph's component cell, the part's footprint top-left). */
  cell: { col: number; row: number };
  /** the authored orientation (90° clockwise steps, 0..3). */
  rot: number;
  /** the authored horizontal flip. The replica must orient the glyph EXACTLY as the die editor does —
   * canonical pins drawn into a rotated+mirrored holder — or a drawer that infers orientation from pin
   * positions (e.g. the MOSFET) renders a rotated/mirrored part wrong. Render-only. */
  mirror: boolean;
  /** the authored primary scalar (`Component.value`), so the glyph reads e.g. a switch's state. */
  value: number;
  /** resolved node index per pin (by pin index), into `node_voltages` / the snapshot `state`. */
  nodes: number[];
  /** This inner part's FLATTENED element index in the build's netlist (`elemOfComponent.get(comp.id +
   * offset)`), so the zoom-to-open replica can read the part's REAL solved current from the snapshot's
   * `elementCurrents[elemIndex]` and animate its glyph (e.g. a MOSFET's lit channel + drifting carriers,
   * per its refsheet). Absent for a nested-IC hub (no element of its own) and the static fallback (no
   * flatten ran). Render-only; never hashed. */
  elemIndex?: number;
  /** When this inner part is ITSELF a sealed user IC, its FLATTENED hub id within this build's netlist
   * — the key into the netlist's `Map<number, UserIcInternals>` (board.ts `userIcInternals`), so the
   * zoom-to-open replica can RECURSE into its inner circuit (Phase 2 Part A). It equals the nested
   * instance's own `FlattenRecord.instanceId` (the inner component inlined at `comp.id + offset`), so
   * `allInternals.get(flatId)` resolves to the nested IC's `UserIcInternals`. Absent for a plain part
   * and for the static (unpowered) fallback (no flatten ran). Render-only; never hashed. */
  flatId?: number;
}

/** One authored wire of a sealed USER IC, for the zoom-to-open mini-board: its two endpoint cells
 * (resolved from the pin/junction the wire touches) and a node to colour it by live level. */
export interface UserIcInnerWire {
  /** the authored cell of the `from` endpoint (a pin's cell, or a junction's cell). */
  from: { col: number; row: number };
  /** the authored cell of the `to` endpoint. */
  to: { col: number; row: number };
  /** a node index (one endpoint's net) for colouring the wire by voltage level. */
  node: number;
}

/**
 * The authored inner circuit of one sealed USER IC instance, for the zoom-to-open mini-board (the
 * owner's "show a miniature version of your exact circuit inside, scaled properly"). Built from the
 * IC's authored sub-graph plus the flatten id offset, so every node index references the SAME
 * `node_voltages` the rest of the renderer reads. Render-side only — never crosses to the core, never
 * hashed (exactly like {@link CompositeInternals}).
 */
export interface UserIcInternals {
  /** the inner parts at their authored positions (every inner component except the frame). */
  parts: UserIcInnerPart[];
  /** the authored wires (endpoint cells + a node for colouring). */
  wires: UserIcInnerWire[];
  /** node per EXTERNAL package pin index (the placed instance's pins), for anchoring leads. */
  pinNodes: number[];
  /** the authored extent in cells (incl. the frame's pins), for the fit-to-footprint scale. */
  bbox: { minCol: number; minRow: number; maxCol: number; maxRow: number };
  /** a reference low node for the voltage "level" normalisation (0 if unknown). */
  gndNode: number;
  /** the frame's authored pin CELLS (the die-editor perimeter positions), by EXTERNAL pin index —
   * WHERE the authored wires actually land. Lets the zoom-to-open replica anchor each package pin (its
   * dot + lead + label) exactly on the lead bridging into it, a 1:1 of the die the player built. */
  pinCells: { col: number; row: number }[];
  /** the reconstructed inner sub-graph (frame included), so the zoom-to-open replica can route the REAL
   * inner `Wire`s — with waypoints + the die down-bend — through the shared `routeForWire`, instead of
   * the lossy `wires` projection above (which drops waypoints). Render-only, never hashed. */
  innerGraph: BoardGraph;
  /** resolve an inner-graph endpoint to its OUTER node index (into the snapshot `state`), or `null` when
   * the endpoint sits on no solved net (a genuinely floating inner wire — live — or the whole static
   * fallback, which carries no nodes). `null` is load-bearing for the replica: it colours floating runs
   * cyan (the die editor's unconnected cue) and, crucially, lets `applyCrossings` tell distinct nets
   * apart — a `0` fallback would alias every unresolved run to ground and sprout phantom tie-dots at
   * different-net crossings. Mirrors the board's `endpointNode` (also `number | null`). Render-only. */
  nodeOfInner: (e: Endpoint) => number | null;
  /** the inner graph's die-frame component id (`UserIc.frameId`), so the replica can tell a frame pad
   * from an inner pin when routing (the down-bend) — what `routeForWire` needs as its `dieFrameId`. */
  frameId: number;
}

/** The frame's authored pin cells (die-editor perimeter positions), by external pin index. The seal
 * keeps pin index order, so `pinCells[i]` is the same lead as external pin `i`. Render-only. */
function framePinCells(
  innerGraph: BoardGraph,
  frameId: number,
): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  const frame = innerGraph.components.get(frameId);
  const kind = frame ? innerGraph.kindOf(frame) : undefined;
  if (frame && kind) {
    for (const p of kind.pins) {
      const c = innerGraph.pinCell(frame, p);
      out.push({ col: c.col, row: c.row });
    }
  }
  return out;
}

/**
 * A NODE-FREE {@link UserIcInternals} built purely from a sealed user IC's authored graph — the same
 * parts / wire-cells / bbox geometry the in-netlist builder produces, but with every node field
 * zeroed (no solve needed). The zoom-to-open miniature uses this as the fallback so a placed chip
 * still reveals "the circuit as you built it" even when the outer board doesn't solve (unpowered):
 * the view ({@link drawUserIcInternals}) draws it STATICALLY — level 0, no live colour/flow — when no
 * `nodeV` snapshot is passed. Render-only, never hashed (exactly like the live builder above).
 */
export function userIcGeometry(def: UserIc): UserIcInternals {
  const innerGraph = new BoardGraph();
  innerGraph.restore(def.graph);
  // Parts: every inner component except the frame, at its authored cell/rot/value. Nodes are zeroed
  // (a static render reads no live level), one per pin so the shape matches the live struct.
  const parts: UserIcInnerPart[] = [];
  for (const comp of def.graph.components) {
    if (comp.id === def.frameId) continue;
    const kind = PART_KINDS[comp.kind];
    if (!kind) continue;
    parts.push({
      id: comp.id,
      kind: comp.kind,
      cell: { col: comp.cell.col, row: comp.cell.row },
      rot: comp.rot,
      mirror: !!comp.mirror,
      value: comp.value,
      nodes: kind.pins.map(() => 0),
    });
  }
  const cellOf = (e: Endpoint): { col: number; row: number } => {
    const c = innerGraph.endpointCell(e);
    return c ? { col: c.col, row: c.row } : { col: 0, row: 0 };
  };
  const wires: UserIcInnerWire[] = def.graph.wires.map((w) => ({
    from: cellOf(w.from),
    to: cellOf(w.to),
    node: 0,
  }));
  // Authored extent over every inner component's pin cells + junction cells (frame included), so the
  // fit-to-footprint scale spans the whole drawn circuit — identical to the live builder.
  let minCol = Infinity;
  let minRow = Infinity;
  let maxCol = -Infinity;
  let maxRow = -Infinity;
  const grow = (c: { col: number; row: number }): void => {
    if (c.col < minCol) minCol = c.col;
    if (c.row < minRow) minRow = c.row;
    if (c.col > maxCol) maxCol = c.col;
    if (c.row > maxRow) maxRow = c.row;
  };
  for (const comp of innerGraph.components.values()) {
    const kind = innerGraph.kindOf(comp);
    if (!kind) continue;
    for (const p of kind.pins) grow(innerGraph.pinCell(comp, p));
  }
  for (const j of innerGraph.junctions.values()) grow(j.cell);
  if (!isFinite(minCol)) {
    minCol = 0;
    minRow = 0;
    maxCol = 1;
    maxRow = 1;
  }
  return {
    parts,
    wires,
    pinNodes: [],
    bbox: { minCol, minRow, maxCol, maxRow },
    gndNode: 0,
    pinCells: framePinCells(innerGraph, def.frameId),
    // Static (unpowered) fallback: carry the already-built inner graph + the frame id, but every endpoint
    // resolves to `null` (no solve, no nodes) — the view then draws every run at its `nodeV`-absent at-rest
    // grey and, because the net is `null` not `0`, `applyCrossings` adds no phantom tie-dots between the
    // authored runs (a `0` for all would alias the whole circuit into one net).
    innerGraph,
    nodeOfInner: () => null,
    frameId: def.frameId,
  };
}

/**
 * Recursive STATIC geometry: {@link userIcGeometry} for `def` PLUS a `flatId`-keyed map of every nested
 * sealed sub-IC's static geometry, so the zoom-to-open replica can RECURSE into nested subassemblies even
 * when the board is UNPOWERED. The live flatten that assigns `flatId`s and builds the `allInternals` map
 * only runs when the board solves; this mints the same structure node-free, so a placed (or floating)
 * subassembly still opens chip-within-chip down to its leaf devices. Each DISTINCT nested def is built
 * ONCE (memoised by tag) and shares one `flatId` across its instances, bounding the work to O(distinct
 * defs); the per-part `flatId` points every instance at that shared inner geometry. Depth-capped to match
 * the renderer's `RECURSE_MAX_DEPTH`. Render-only — no nodes, never hashed.
 */
export function userIcGeometryDeep(def: UserIc): {
  internals: UserIcInternals;
  all: Map<number, UserIcInternals>;
} {
  const all = new Map<number, UserIcInternals>();
  const flatOfTag = new Map<string, number>();
  let nextFlatId = 1;
  const MAX_DEPTH = 24; // mirrors RECURSE_MAX_DEPTH in userIcInternalsView.ts
  const build = (d: UserIc, depth: number): UserIcInternals => {
    const internals = userIcGeometry(d);
    if (depth >= MAX_DEPTH) return internals;
    for (const part of internals.parts) {
      const nestedDef = getUserIc(part.kind);
      if (!nestedDef) continue; // a leaf device (FET, gate, …), not a nested sub-IC
      let flatId = flatOfTag.get(part.kind);
      if (flatId === undefined) {
        flatId = nextFlatId++;
        flatOfTag.set(part.kind, flatId); // set BEFORE building so a (defensive) self-reference can't loop
        all.set(flatId, build(nestedDef, depth + 1));
      }
      part.flatId = flatId; // every instance of this tag opens the same shared inner geometry
    }
    return internals;
  };
  const internals = build(def, 0);
  return { internals, all };
}

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
  /**
   * Fifth-terminal node per element, parallel to the rest: for a powered logic gate
   * (the only 5-pin element) it is the node of its pin 4 (GND); every other element
   * leaves it `0` (ground), which the core ignores. Pin 4 → e.
   */
  e: Uint32Array;
  /**
   * Sixth/seventh/eighth-terminal nodes per element (`f`/`g`/`h`), parallel to the rest.
   * Provisioned by ADR 0002's wire-format widening; NO current kind reads them, so every
   * entry is `0` (ground) and the core ignores them. Built in lockstep with `a`..`e` (one
   * entry per element) so the install's length validation accepts them, and carried so the
   * boundary install (`set_netlist_pefgh`) is exercised end to end — future 6/7/8-terminal
   * parts populate these without another wire-format change.
   */
  f: Uint32Array;
  g: Uint32Array;
  h: Uint32Array;
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
   * component id → the internal topology of an expanded composite IC (`CEC_COMP`), for the
   * zoom-to-open "mini-mode" view (ADR 0005): its sub-elements (each with resolved terminal nodes
   * and gate func) plus the internal and pin node indices, all referencing the same
   * `node_voltages` / `element_currents` the rest of the renderer uses. Absent for non-composite
   * parts. Render-side only; never crosses to the core, never hashed.
   */
  compositeInternals: Map<number, CompositeInternals>;
  /**
   * component id → the authored inner circuit of a sealed USER IC instance, for the zoom-to-open
   * mini-board: the real inner parts at their authored positions + the authored wires, each with
   * node indices into the SAME `node_voltages` the rest of the renderer reads (resolved via the
   * flatten id offset). The user-IC twin of {@link compositeInternals}. Absent for non-user-IC parts.
   * Render-side only — never crosses to the core, never hashed.
   */
  userIcInternals: Map<number, UserIcInternals>;
  /**
   * Net-label display name per node index (into `node_voltages`): a node carrying
   * one or more {@link NetLabel}s reports that name (e.g. `VCC`) so the scope and
   * telemetry can show it instead of `Node 3`. Built from the labels after node
   * numbering; when several differing names land on one node the lowest label id
   * wins (deterministic). Nodes with no label are absent from the map.
   */
  nodeNames: Map<number, string>;
  /**
   * Pinned colour (a PIXI hex int) per node index, for nodes whose {@link NetLabel}
   * carries a `color`. Built in parallel with {@link nodeNames} off the same
   * authoritative node numbering — so the override survives the renderer's wire-hop
   * BFS (it's keyed on the final node index). Lowest label id wins, mirroring the
   * name rule. Nodes with no colour-bearing label are absent. Render-side only:
   * never crosses the wasm boundary, never enters the snapshot hash.
   */
  nodeColors: Map<number, number>;
  /** Current-source component ids whose forced current has no return path. */
  floatingSources: number[];
  /**
   * The CIRCUIT a node belongs to, by node index — a representative root so two nodes share a value
   * iff an element bridges them (a maximal connected component of the board, ground EXCLUDED as a
   * bridge so two separate loops that only share a ground stay distinct circuits). Lets a voltage
   * gauge scale to the max rail of ITS OWN circuit, not the whole board. Render-side only: never
   * crosses the wasm boundary, never enters the snapshot hash. Ground (node 0) maps to itself.
   */
  circuitOfNode: number[];
  /** Topology+values signature; unchanged across pure moves so the sim isn't reset. */
  sig: string;
}

export function buildNetlist(
  graph: BoardGraph,
  real = false,
  preferBehavioral = false,
): BuiltNetlist | null {
  // Seal expansion (IC maker, ADR 0006): inline any placed sealed-IC instance's authored inner
  // circuit before compiling, so the sim sees the real discrete parts (seal-as-same-netlist). A
  // strict no-op when no sealed IC is placed, so every normal circuit (and the golden) is unchanged.
  // The `flatSink` collects each instance's id offset (render-only — it does not change the flatten's
  // element output) so we can build the zoom-to-open mini-board map (`userIcInternals`) below.
  const flatSink: FlattenRecord[] = [];
  graph = flattenUserIcs(graph, flatSink, preferBehavioral);
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

  // Every GND symbol is the SAME global ground — real-schematic convention (and what a breadboard
  // does): several ground symbols form ONE common reference WITHOUT a wire between them, so the
  // player needn't hand-tie every ground together (that surprise is exactly the "my sources can't
  // share a ground" trap). Union all GND pins onto the first; whether that net is the node-0
  // reference (vs. a lone floating ground) is decided below. Deterministic — `sorted` is by id.
  let gndKey: string | null = null;
  for (const c of sorted) {
    if (c.kind !== "GND") continue;
    const k = key(c.id, 0); // GND is a 1-pin part
    find(k);
    if (gndKey === null) gndKey = k;
    else union(k, gndKey);
  }

  // How many pins share each net, and which nets carry a NON-GND pin — so we can tell a ground that
  // is actually wired into the circuit from one (or several) just sitting on the board.
  const netSize = new Map<string, number>();
  const netHasNonGnd = new Set<string>();
  for (const c of sorted) {
    const kind = graph.kindOf(c);
    if (!kind) continue;
    for (const p of kind.pins) {
      const r = find(key(c.id, p.index));
      netSize.set(r, (netSize.get(r) ?? 0) + 1);
      if (c.kind !== "GND") netHasNonGnd.add(r);
    }
  }

  // Ground (node 0): the unified GND net wins when it is actually wired into the circuit (it carries
  // at least one non-GND pin) — this is what lets a current-source-only loop simulate (no voltage
  // source to borrow a reference from). Ground symbols sitting on the board with nothing else wired
  // to them are ignored, so they can't make a disconnected circuit falsely "solve". Otherwise fall
  // back to the first voltage source's "−" pin (index 1).
  let groundRoot: string | null = null;
  if (gndKey !== null) {
    const r = find(gndKey);
    if (netHasNonGnd.has(r)) groundRoot = r;
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
  // Each CEC composite logic IC (half-adder, mux, …) expands into a small network of
  // powered gates wired through PRIVATE internal nodes (the intermediate signals between
  // its sub-gates). Allocate that many per instance — after the pin/junction/EC nodes, in
  // sorted-component-id order so numbering stays deterministic and move-invariant.
  // cecInternal: composite component id → its array of internal node indices.
  const cecInternal = new Map<number, number[]>();
  for (const c of sorted) {
    const comp = CEC_COMP[c.kind];
    if (!comp) continue;
    const arr: number[] = [];
    for (let k = 0; k < comp.internal; k++) arr.push(next++);
    cecInternal.set(c.id, arr);
  }
  const nodeCount = next;

  // Net name per node: each label maps its endpoint to a node index and names it.
  // Same-named labels already share a node (the name union above), so they agree;
  // when two *different* names land on one physical net the lowest label id wins
  // (the `labels` list is sorted by id and we keep the first name set per node),
  // which is deterministic. This is what lets the scope/telemetry show `VCC`.
  // Net colour override per node: built in parallel with the names off the same
  // resolved node index, so a pinned label colour follows its net through the
  // renderer's wire-hop BFS. Same lowest-id-wins rule as the names (labels sorted
  // by id; keep the first colour set per node). Render-side only — never crosses
  // the wasm boundary; the override paints the wire but does not affect the solve.
  const nodeNames = new Map<number, string>();
  const nodeColors = new Map<number, number>();
  for (const l of labels) {
    // Cable-owned labels (deriveCableLinks) carry an internal namespaced token, not a display name — they
    // still drive the connectivity union above, but must NOT name the net in the scope/telemetry.
    if (l.ownerId !== undefined) continue;
    const node = nodeIndex.get(find(endpointKey(l.at)));
    if (node === undefined) continue;
    if (!nodeNames.has(node)) nodeNames.set(node, l.name);
    if (l.color !== undefined && !nodeColors.has(node))
      nodeColors.set(node, l.color);
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
  // transformer) or a powered logic gate's VCC pin stamps its pin-3 node; every other
  // element leaves it 0 (ground), ignored by the core. Pushed in lockstep.
  const dArr: number[] = [];
  // The fifth-terminal array, parallel to the rest: a powered logic gate's GND pin
  // (pin 4) stamps its node here; every other element leaves it 0 (ground), ignored by
  // the core. Pushed in lockstep with each element stamp.
  const eArr: number[] = [];
  // The sixth/seventh/eighth-terminal arrays (`f`/`g`/`h`), parallel to the rest. ADR 0002
  // provisioned them in the wire format; only the behavioral blocks (`ELEM_BEHAVIORAL`) wire
  // them — every other element leaves all three at 0 (ground), and the core ignores them. They
  // MUST stay length-synced with `a`..`e` (one entry per element), so they are pushed in lockstep
  // at every element stamp below via `pushFGH()`. This is the array-sync contract the POT
  // regression broke for `e`; keeping the pushes in a single helper called beside every other
  // terminal push makes a future desync hard.
  const fArr: number[] = [];
  const gArr: number[] = [];
  const hArr: number[] = [];
  // Push the sixth/seventh/eighth terminals for one element (default ground). Called once per
  // element, right beside its `a`..`e` pushes, so all eight terminal arrays advance together and
  // stay exactly `types.length` long. The behavioral branch passes real f/g/h nodes; everyone
  // else calls it bare (all three ground).
  const pushFGH = (nf = 0, ng = 0, nh = 0): void => {
    fArr.push(nf);
    gArr.push(ng);
    hArr.push(nh);
  };
  const values: number[] = [];
  // The second per-element scalar, parallel to `values`: an AC source's peak
  // amplitude (volts); 0 for every other element. Pushed in lockstep with each
  // element stamp so the arrays stay aligned. The core ignores it for non-AC
  // kinds, so a 0 there cannot change anything.
  const auxArr: number[] = [];
  const elemOfComponent = new Map<number, number>();
  const legsOfComponent = new Map<number, number[]>();
  const nodesOfComponent = new Map<number, [number, number]>();
  const compositeInternals = new Map<number, CompositeInternals>();
  for (const c of sorted) {
    const kind = graph.kindOf(c);
    if (!kind || kind.pins.length < 2) continue;
    const na = nodeIndex.get(find(key(c.id, 0))) ?? 0;
    const nb = nodeIndex.get(find(key(c.id, 1))) ?? 0;

    // Electronic load: a web-only mapping onto an existing element, chosen by its MODE —
    // no sim-core "load" element (like SHUNT → resistor, PULSE → AC source). Pin + (a)
    // sinks current down to − (b). CC → a current sink (ELEM_ISOURCE: a positive `value`
    // drains terminal a); STEPPING between base (`value`) and peak (`amp`) when loadHz > 0
    // (the dynamic params are written into the source's param block below). CR → a plain
    // resistor at `value` Ω. The mode rides into `types`/`values`, so flipping it rebuilds
    // the sim via the signature.
    if (c.kind === "LOAD") {
      const idx = types.length;
      if ((c.mode ?? 0) === 1) {
        // CR: a resistor (floored to a tiny positive R so an end-stop never opens).
        types.push(ELEM_RESISTOR);
        values.push(Math.max(c.value, 1e-3));
        auxArr.push(0);
      } else {
        // CC: a current sink. Static = `value` A; dynamic = base `value` → peak `amp`.
        types.push(ELEM_ISOURCE);
        values.push(c.value);
        auxArr.push((c.loadHz ?? 0) > 0 ? (c.amp ?? c.value) : 0); // peak (dynamic only)
      }
      aArr.push(na);
      bArr.push(nb);
      cArr.push(0);
      dArr.push(0);
      eArr.push(0);
      pushFGH();
      elemOfComponent.set(c.id, idx);
      nodesOfComponent.set(c.id, [na, nb]);
      continue;
    }

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
      eArr.push(0); // not a powered gate: no fifth node
      pushFGH(); // sixth/seventh/eighth terminals unused (ground)
      values.push(c.value); // capacitance
      auxArr.push(0); // not an AC source: no amplitude
      types.push(ELEM_RESISTOR);
      aArr.push(mid);
      bArr.push(nb);
      cArr.push(0); // 2-terminal: no control node
      dArr.push(0); // 2-terminal: no fourth node
      eArr.push(0); // not a powered gate: no fifth node
      pushFGH(); // sixth/seventh/eighth terminals unused (ground)
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
      eArr.push(0);
      pushFGH();
      values.push(rAW);
      auxArr.push(0);
      types.push(ELEM_RESISTOR);
      aArr.push(nw);
      bArr.push(nb);
      cArr.push(0);
      dArr.push(0);
      eArr.push(0);
      pushFGH();
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
      eArr.push(0);
      pushFGH();
      values.push(reff);
      auxArr.push(0);
      elemOfComponent.set(c.id, idx);
      nodesOfComponent.set(c.id, [na, nb]);
      continue;
    }

    // CEC composite logic IC (half-adder, full-adder, mux, demux, majority, …): expand into
    // its network of powered gates per CEC_COMP, wired through the private internal nodes
    // allocated above. No new sim element — every step is a powered ELEM_GATE with the part's
    // VCC/GND pins routed to its d/e, so the sub-gates share the part's rail.
    const comp = CEC_COMP[c.kind];
    if (comp) {
      const internals = cecInternal.get(c.id) ?? [];
      const nodeOfPin = (pinIdx: number): number =>
        nodeIndex.get(find(key(c.id, pinIdx))) ?? 0;
      // Resolve a gate-step terminal ref: pin index (>= 0) or internal node (< 0).
      const resolve = (r: number): number =>
        r >= 0 ? nodeOfPin(r) : (internals[-r - 1] ?? 0);
      const nVcc = nodeOfPin(comp.vccPin);
      const nGnd = nodeOfPin(comp.gndPin);
      const family = c.family ?? 0;
      const firstIdx = types.length;
      // Record each sub-element's index + resolved terminal nodes for the zoom-to-open view
      // (ADR 0005). The emission below is byte-identical to before — the recording only reads
      // the same resolved refs — so the netlist crossing to the core (and the golden) is unchanged.
      const subElements: CompositeSubElement[] = [];
      for (const [func, out, in1, in2] of comp.gates) {
        const oN = resolve(out);
        const i1 = resolve(in1);
        const i2 = resolve(in2);
        const ei = types.length;
        types.push(ELEM_GATE);
        aArr.push(oN);
        bArr.push(i1);
        cArr.push(i2);
        dArr.push(nVcc);
        eArr.push(nGnd);
        pushFGH();
        values.push(c.value); // vestigial logic rail (the gate is powered through d/e)
        auxArr.push(func + 16 * family);
        subElements.push({
          index: ei,
          type: ELEM_GATE,
          func,
          nodes: [oN, i1, i2, nVcc, nGnd],
        });
      }
      // Non-gate elements (a DFF, an analog switch, a pull-down resistor, an internally-railed
      // buffer): each raw step lists every terminal explicitly, emitted verbatim after the gates.
      for (const rs of comp.extra ?? []) {
        const ra = resolve(rs.a);
        const rb = resolve(rs.b);
        const rc = resolve(rs.c);
        const rd = resolve(rs.d);
        const re = resolve(rs.e);
        const ei = types.length;
        types.push(rs.t);
        aArr.push(ra);
        bArr.push(rb);
        cArr.push(rc);
        dArr.push(rd);
        eArr.push(re);
        pushFGH();
        values.push(rs.value);
        auxArr.push(rs.aux);
        subElements.push({
          index: ei,
          type: rs.t,
          func: rs.aux,
          nodes: [ra, rb, rc, rd, re],
        });
      }
      elemOfComponent.set(c.id, firstIdx + comp.primary);
      nodesOfComponent.set(c.id, [nodeOfPin(comp.voutPin), nGnd]);
      compositeInternals.set(c.id, {
        pinNodes: kind.pins.map((p) => nodeOfPin(p.index)),
        internalNodes: internals,
        vccNode: nVcc,
        gndNode: nGnd,
        elements: subElements,
      });
      continue;
    }

    // Behavioral block (LUT / SPI / UART): a single ELEM_BEHAVIORAL using all eight terminals.
    // `value` = the fixed program id; `aux` = the data word (Component.word, default per kind);
    // the visual pins route to the core's terminal order a..h via BEH_SPEC.term (-1 → ground).
    // The LUT's combinational/registered mode rides Component.mode → params[4] (in the params loop).
    const beh = BEH_SPEC[c.kind];
    if (beh) {
      const nodeOfPin = (pinIdx: number): number =>
        pinIdx < 0 ? 0 : (nodeIndex.get(find(key(c.id, pinIdx))) ?? 0);
      const tm = beh.term;
      const ei = types.length;
      types.push(ELEM_BEHAVIORAL);
      aArr.push(nodeOfPin(tm[0]!));
      bArr.push(nodeOfPin(tm[1]!));
      cArr.push(nodeOfPin(tm[2]!));
      dArr.push(nodeOfPin(tm[3]!)); // VCC
      eArr.push(nodeOfPin(tm[4]!)); // GND
      pushFGH(nodeOfPin(tm[5]!), nodeOfPin(tm[6]!), nodeOfPin(tm[7]!));
      values.push(beh.prog);
      auxArr.push(c.word ?? beh.defWord);
      elemOfComponent.set(c.id, ei);
      // vAcross read as the primary output (terminal a) relative to the GND pin (terminal e).
      nodesOfComponent.set(c.id, [nodeOfPin(tm[0]!), nodeOfPin(tm[4]!)]);
      continue;
    }

    // Behavioral MEMORY array (ELEM_MEMORY): one element whose contents live in the core's heap store,
    // not the MNA matrix. Visual pins route to the cell-level terminal map via MEM_SPEC.term (a=D_out,
    // b=WE, c=D_in, d=VCC, e=GND, f/g/h=A0..A2); mode/addrWidth/wordWidth ride params (set in the params
    // loop). RAM starts zeroed; ROM/EEPROM image seeding (load_memory) is a later phase.
    const mem = MEM_SPEC[c.kind];
    if (mem) {
      const nodeOfPin = (pinIdx: number): number =>
        pinIdx < 0 ? 0 : (nodeIndex.get(find(key(c.id, pinIdx))) ?? 0);
      const tm = mem.term;
      const ei = types.length;
      types.push(ELEM_MEMORY);
      aArr.push(nodeOfPin(tm[0]!));
      bArr.push(nodeOfPin(tm[1]!));
      cArr.push(nodeOfPin(tm[2]!));
      dArr.push(nodeOfPin(tm[3]!)); // VCC
      eArr.push(nodeOfPin(tm[4]!)); // GND
      pushFGH(nodeOfPin(tm[5]!), nodeOfPin(tm[6]!), nodeOfPin(tm[7]!));
      values.push(0);
      auxArr.push(0);
      elemOfComponent.set(c.id, ei);
      // vAcross read as D_out (terminal a) relative to the GND pin (terminal e).
      nodesOfComponent.set(c.id, [nodeOfPin(tm[0]!), nodeOfPin(tm[4]!)]);
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
      (THREE_PIN_TYPES.has(t) ||
        FOUR_PIN_TYPES.has(t) ||
        FIVE_PIN_TYPES.has(t)) &&
      kind.pins.length >= 3
        ? (nodeIndex.get(find(key(c.id, 2))) ?? 0)
        : 0;
    // The fourth terminal: a 4-pin device (the transformer) stamps its pin-3 node
    // (secondary−), and a powered gate stamps its VCC pin; every element with fewer
    // pins leaves d = 0 (ground, ignored).
    const nd =
      (FOUR_PIN_TYPES.has(t) || FIVE_PIN_TYPES.has(t)) && kind.pins.length >= 4
        ? (nodeIndex.get(find(key(c.id, 3))) ?? 0)
        : 0;
    // The fifth terminal: a powered gate stamps its GND pin (pin 4); everything else
    // leaves e = 0 (ground, ignored — and so a gate with no power pins stays legacy).
    const ne =
      FIVE_PIN_TYPES.has(t) && kind.pins.length >= 5
        ? (nodeIndex.get(find(key(c.id, 4))) ?? 0)
        : 0;
    // The second scalar: an AC source emits its peak amplitude (volts, defaulting
    // to 5 V when a legacy source carries none); a logic gate / flip-flop emits its
    // function code (GATE_AUX) in the low bits PLUS its logic-family index in the
    // upper bits (`func + 16*family`, matching `gate_family_index`/`gate_func_code`
    // in sim-core); every other kind emits 0, which the core ignores. Kept parallel
    // to `values`.
    const aux =
      c.kind === "AC" || c.kind === "PULSE"
        ? (c.amp ?? AC_DEFAULT_AMP) // source peak amplitude / pulse high level
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
    eArr.push(ne);
    pushFGH(); // f/g/h provisioned but unused by every current kind → ground
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
    // A CEC composite (a network of powered gates) or a behavioral block (a powered IC):
    // for the return-path test treat the whole IC as one connected blob (its powered output
    // and rails tie its nodes together), so a source returning through any pin finds a path —
    // the same spirit as the EC/POT passive-path unions above.
    if (CEC_COMP[c.kind] || BEH_SPEC[c.kind]) {
      for (const p of kind.pins) {
        const np = nodeIndex.get(find(key(c.id, p.index)));
        if (np !== undefined) u2(na, np);
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
  // The fifth terminal `e` (a powered gate's GND pin) folds in the same way, and only
  // when non-zero — so a gate-free (or unpowered-legacy) circuit keeps its old signature,
  // while wiring/rewiring a gate's power pins rebuilds the sim.
  const eSig = eArr.some((x) => x !== 0) ? eArr.join(",") : "";
  // The sixth/seventh/eighth terminals `f`/`g`/`h` (a behavioral block's serial/LUT inputs)
  // fold in the same way, and only when non-zero — so every behavioral-free circuit keeps its
  // exact old signature, while rewiring a LUT input or a SPI/UART line rebuilds the sim. Without
  // these, moving a behavioral input wire would not change a/b/c/values/aux and the stale sim
  // would not reinstall.
  const fSig = fArr.some((x) => x !== 0) ? fArr.join(",") : "";
  const gSig = gArr.some((x) => x !== 0) ? gArr.join(",") : "";
  const hSig = hArr.some((x) => x !== 0) ? hArr.join(",") : "";

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
    const ei = elemOfComponent.get(comp.id);
    if (ei === undefined) continue;
    // Quality-tier params (per-kind param block). The transient-affecting ones (source output
    // impedance, MOSFET Kp, BJT β) only bite in Real mode — in Ideal mode leave the part
    // nominal. The AC-only params (cap/inductor/op-amp), which sim-core gates inside the AC
    // analysis, are installed in both modes (harmless to the transient solve).
    const tp = tierParams(comp.kind, comp.tier ?? DEFAULT_TIER);
    if (tp && !(TRANSIENT_TIER_KINDS.has(comp.kind) && !real)) {
      for (let k = 0; k < PARAM_STRIDE; k++) {
        params[ei * PARAM_STRIDE + k] = tp[k] ?? 0;
      }
    }
    // MOSFET threshold mismatch (Realistic mode only): a deterministic per-device Vth offset (slot 1)
    // modelling fab variation — deviated per component id (stable across rebuilds via `jitter`), the
    // same pattern as resistor tolerance. Omitted in Ideal mode (every device nominal). Beyond a
    // realistic threshold spread, this is the seed that lets sim-core break a cross-coupled latch's
    // symmetry, so an unwritten transistor 6T SRAM / flip-flop powers up to a definite bit.
    if ((comp.kind === "NM" || comp.kind === "PM") && real) {
      params[ei * PARAM_STRIDE + 1] = MOSFET_VTH_MISMATCH * jitter(comp.id);
    }
    // Capacitor leakage (Realistic mode only): the self-discharge time constant tau (s) in the
    // reserved leak slot, per quality tier — sim-core stamps a parallel G = C/tau, so a charged cap
    // bleeds off (a DRAM 1T1C cell / sample-and-hold loses its value; a budget electrolytic droops
    // faster than a film cap) while a filter cap (tau ≫ signal period) is unaffected. Omitted in Ideal
    // mode → perfect caps. EC's element is its expanded ideal-cap (`ei` = capIdx), so this lands on it.
    if ((comp.kind === "C" || comp.kind === "EC") && real) {
      const tier = comp.tier ?? DEFAULT_TIER;
      params[ei * PARAM_STRIDE + CAP_LEAK_SLOT] =
        comp.kind === "EC" ? ecLeakTau(tier) : capLeakTau(tier);
    }
    // Resistor thermal (Johnson) noise (Realistic mode only): a noise-current amplitude (slot NOISE_SLOT)
    // sim-core injects as a deterministic, zero-mean per-tick current — the resistor's node fuzzes. The
    // amplitude ∝ 1/√R so the resulting node-VOLTAGE noise grows with R (a bigger resistor is noisier),
    // and a better grade is quieter. Omitted in Ideal mode (silent, golden-clean). `comp.value` is the
    // nominal resistance in ohms.
    if (comp.kind === "R" && real) {
      params[ei * PARAM_STRIDE + NOISE_SLOT] = resistorNoiseAmp(
        comp.value,
        comp.tier ?? DEFAULT_TIER,
      );
    }
    // Thermistor self-heating temperature coefficient → THERMAL RUNAWAY (Realistic mode only). A
    // thermistor expands to a plain resistor (above); here we tag that element with its tempco α (slot
    // TEMPCO_SLOT), so sim-core's per-tick R(T) feedback runs: an NTC that dominates its loop runs away
    // (heat ⇒ R drops ⇒ V²/R climbs ⇒ more heat ⇒ OVERHEAT/vent), a PTC self-limits. Omitted in Ideal
    // mode (no feedback, golden-clean). `elemOfComponent` maps the thermistor to its expanded resistor.
    if ((comp.kind === "NTC" || comp.kind === "PTC") && real) {
      params[ei * PARAM_STRIDE + TEMPCO_SLOT] =
        comp.kind === "NTC" ? NTC_TEMPCO : PTC_TEMPCO;
    }
    // BJT saturation-current tempco γ → THERMAL RUNAWAY (Realistic mode only). The same TEMPCO_SLOT the
    // thermistor uses, but for a BJT sim-core reads it as γ (Is(T) = BJT_IS·exp(γ·ΔTj)) instead of a
    // linear α: at fixed base bias the collector current climbs with Tj → Vce·Ic dissipation climbs →
    // hotter → runaway (an emitter ballast resistor tames it). Omitted in Ideal mode (Is = BJT_IS,
    // golden-clean). A BJT maps to a single ELEM_NPN/ELEM_PNP element, so `ei` is its element index.
    if ((comp.kind === "Q" || comp.kind === "QP") && real) {
      params[ei * PARAM_STRIDE + TEMPCO_SLOT] = BJT_IS_TEMPCO;
    }
    // Diode TYPE params: the forward junction (Is/n → forward drop) is the part's identity, so
    // it is installed in both modes; the current rating is a Real-mode non-ideality (an
    // over-rated diode FAILs), so it is omitted in Ideal mode (leaving the part unrated).
    const dv = diodeVariant(comp.kind, comp.variant ?? 0);
    if (dv) {
      params[ei * PARAM_STRIDE + 0] = dv.is;
      params[ei * PARAM_STRIDE + 1] = dv.n;
      // The current rating (FAIL), the transit time (reverse recovery), and shot noise are all Real-mode
      // non-idealities — an Ideal diode is unrated, recovers instantly, and is silent.
      if (real) {
        params[ei * PARAM_STRIDE + RATED_CURRENT_SLOT] = dv.ratedA;
        params[ei * PARAM_STRIDE + DIODE_TT_SLOT] = dv.tt;
        // Shot noise: a junction's noise current ∝ √I (sim-core multiplies this scale by √|I| of the live
        // current). Fundamental to the junction (not a quality grade), so a single game-scaled constant.
        params[ei * PARAM_STRIDE + NOISE_SLOT] = SHOT_NOISE_SCALE;
      }
    }
    // Pulse / clock generator: the AC-source element's waveform (slot 1: 1 = square, 2 =
    // triangle) and duty (slot 3). Part identity, so installed in both fidelity modes. (A plain
    // AC source leaves slot 1 at 0 = sine, so it is untouched.)
    if (comp.kind === "PULSE") {
      params[ei * PARAM_STRIDE + 1] = (comp.variant ?? 0) === 1 ? 2 : 1;
      params[ei * PARAM_STRIDE + 3] = comp.duty ?? 0.5;
    }
    // Electronic load, dynamic step (CC mode): the current sink's step frequency (slot 0)
    // and duty (slot 3). loadHz = 0 leaves slot 0 at 0, so the sink holds its base `value`
    // (a static load). Part behaviour, so installed in both fidelity modes.
    if (
      comp.kind === "LOAD" &&
      (comp.mode ?? 0) === 0 &&
      (comp.loadHz ?? 0) > 0
    ) {
      params[ei * PARAM_STRIDE + 0] = comp.loadHz!;
      params[ei * PARAM_STRIDE + 3] = comp.duty ?? 0.5;
    }
    // FPGA logic cell: combinational by default; mode = 1 latches the LUT output into the
    // cell's register on the rising CLK edge (params slot 4 ≥ 1 → registered in sim-core).
    if (comp.kind === "LUT" && (comp.mode ?? 0) >= 1) {
      params[ei * PARAM_STRIDE + BEH_LUT_MODE_SLOT] = 1;
    }
    // Behavioral MEMORY array: identity params — mode (slot 0), addrWidth (slot 1 → depth 2^addrWidth),
    // wordWidth (slot 3). Installed in both fidelity modes (the array is its nominal self regardless of
    // tier); slot 2 (RATED_CURRENT) is left 0 = unrated, as P1 intends.
    const memSpec = MEM_SPEC[comp.kind];
    if (memSpec) {
      params[ei * PARAM_STRIDE + 0] = memSpec.mode;
      params[ei * PARAM_STRIDE + MEM_ADDR_SLOT] = memSpec.addrWidth;
      params[ei * PARAM_STRIDE + MEM_WORD_SLOT] = memSpec.wordWidth;
      // DRAM retention is a Real-mode non-ideality: in Ideal mode the array is nominal (no decay), so
      // slot 4 stays 0 and the cell holds forever, like SRAM. Bites only in Real mode.
      if (memSpec.retention && real) {
        params[ei * PARAM_STRIDE + MEM_RETENTION_SLOT] = memSpec.retention;
      }
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

  // Zoom-to-open mini-board (the owner's "show a miniature version of your exact circuit inside"):
  // for each placed sealed USER IC instance, record its authored inner circuit — the real inner parts
  // at their authored positions + the authored wires — with node indices into THIS netlist's
  // `node_voltages` (resolved via the flatten id offset `flatSink` captured above). Render-only: it
  // reads only the resolved node numbering, never an element array, so the netlist crossing to the
  // core (and the golden) is unchanged. Empty unless a user IC is placed (`flatSink` is empty then).
  const userIcInternals = new Map<number, UserIcInternals>();
  for (const rec of flatSink) {
    const def = getUserIc(rec.tag);
    if (!def) continue;
    const o = rec.offset;
    // Reconstruct the IC's authored sub-graph so its pin/junction geometry helpers are available
    // (the snapshot is plain data). The frame is included so its pins frame the bbox + anchor leads.
    const innerGraph = new BoardGraph();
    innerGraph.restore(def.graph);
    // An inner endpoint's FLATTENED key: the frame's pins are the placed instance's pins (same
    // index); every other inner component/junction is offset by `o`. Mirrors `flattenUserIcs`'s remap
    // so the resolved net matches the compiled netlist exactly.
    const flatKey = (e: Endpoint): string =>
      isJunctionRef(e)
        ? endpointKey({ junctionId: e.junctionId + o })
        : endpointKey({
            componentId:
              e.componentId === def.frameId
                ? rec.instanceId
                : e.componentId + o,
            pinIndex: e.pinIndex,
          });
    const nodeOfEndpoint = (e: Endpoint): number =>
      nodeIndex.get(find(flatKey(e))) ?? 0;
    // The authored cell of a wire endpoint (a pin's absolute cell, or a junction's cell), in the
    // inner graph's own coordinates — what the mini-board lays out and scales.
    const cellOfEndpoint = (e: Endpoint): { col: number; row: number } => {
      const c = innerGraph.endpointCell(e);
      return c ? { col: c.col, row: c.row } : { col: 0, row: 0 };
    };

    // Parts: every inner component except the frame, at its authored cell/rot/value, with each pin
    // resolved to its node via the flattened key (so the glyph animates from the live snapshot).
    const parts: UserIcInnerPart[] = [];
    for (const comp of def.graph.components) {
      if (comp.id === def.frameId) continue;
      const kind = PART_KINDS[comp.kind];
      if (!kind) continue;
      parts.push({
        id: comp.id,
        kind: comp.kind,
        cell: { col: comp.cell.col, row: comp.cell.row },
        rot: comp.rot,
        mirror: !!comp.mirror,
        value: comp.value,
        nodes: kind.pins.map((p) =>
          nodeOfEndpoint({ componentId: comp.id, pinIndex: p.index }),
        ),
        // The inner part's flattened element index — keyed by the same `comp.id + o` the flatten remap
        // inlined it at — so the replica can read its live current from `elementCurrents` and animate it
        // (a leaf part resolves; a nested-IC hub has no element of its own → undefined).
        elemIndex: elemOfComponent.get(comp.id + o),
        // When this inner part is itself a sealed user IC, its FLATTENED hub id is `comp.id + o` (the id
        // `flattenUserIcs`'s remap inlined it at — the same id the nested instance's own FlattenRecord
        // carries). That keys `userIcInternals`, so the zoom-to-open replica can recurse into it (Part A).
        ...(isUserIc(comp.kind) ? { flatId: comp.id + o } : {}),
      });
    }
    // Wires: authored endpoint cells + a node (the `from` endpoint's net) for level colouring.
    const wires: UserIcInnerWire[] = def.graph.wires.map((w) => ({
      from: cellOfEndpoint(w.from),
      to: cellOfEndpoint(w.to),
      node: nodeOfEndpoint(w.from),
    }));
    // External pin nodes: the placed instance's per-pin nodes (the package boundary leads). The
    // instance survives the flatten as a no-element hub, so it is present; guard defensively anyway.
    const instComp = graph.components.get(rec.instanceId);
    const instKind = instComp ? graph.kindOf(instComp) : undefined;
    const pinNodes = instKind
      ? instKind.pins.map(
          (p) => nodeIndex.get(find(key(rec.instanceId, p.index))) ?? 0,
        )
      : [];
    // Authored extent over every inner component's pin cells + junction cells (frame included), so
    // the fit-to-footprint scale spans the whole drawn circuit.
    let minCol = Infinity;
    let minRow = Infinity;
    let maxCol = -Infinity;
    let maxRow = -Infinity;
    const grow = (c: { col: number; row: number }): void => {
      if (c.col < minCol) minCol = c.col;
      if (c.row < minRow) minRow = c.row;
      if (c.col > maxCol) maxCol = c.col;
      if (c.row > maxRow) maxRow = c.row;
    };
    for (const comp of innerGraph.components.values()) {
      const kind = innerGraph.kindOf(comp);
      if (!kind) continue;
      for (const p of kind.pins) grow(innerGraph.pinCell(comp, p));
    }
    for (const j of innerGraph.junctions.values()) grow(j.cell);
    if (!isFinite(minCol)) {
      minCol = 0;
      minRow = 0;
      maxCol = 1;
      maxRow = 1;
    }
    // A reference low node for level normalisation: the inner GND part's net if one is present, else
    // node 0 (the netlist's ground).
    let gndNode = 0;
    for (const comp of def.graph.components) {
      if (comp.kind !== "GND") continue;
      gndNode = nodeOfEndpoint({ componentId: comp.id, pinIndex: 0 });
      break;
    }
    userIcInternals.set(rec.instanceId, {
      parts,
      wires,
      pinNodes,
      bbox: { minCol, minRow, maxCol, maxRow },
      gndNode,
      pinCells: framePinCells(innerGraph, def.frameId),
      // Render-only: carry the reconstructed inner graph + the frame id so the replica can route the real
      // wires. `nodeOfInner` is the same flatten-aware resolver `nodeOfEndpoint` uses, but kept NULLABLE
      // (no `?? 0` fallback): a floating inner endpoint must resolve to `null`, not ground, so the replica
      // colours it cyan and `applyCrossings` doesn't alias distinct floating runs into one phantom net.
      innerGraph,
      nodeOfInner: (e) => {
        const n = nodeIndex.get(find(flatKey(e)));
        return n === undefined ? null : n;
      },
      frameId: def.frameId,
    });
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
    (eSig ? "|e:" + eSig : "") +
    (fSig ? "|f:" + fSig : "") +
    (gSig ? "|g:" + gSig : "") +
    (hSig ? "|h:" + hSig : "") +
    paramsSig;

  // Per-net CIRCUIT grouping (render-only): two nets are the SAME circuit when an element bridges
  // them, so a voltage gauge can scale to the max rail of ITS OWN circuit rather than the whole board
  // (two separate loops keep separate references). Ground (node 0) does NOT propagate — circuits
  // joined only by a shared ground stay distinct (the owner's separate AC + DC boards). Derived from
  // the existing terminal arrays; never crosses the wasm boundary, never enters the hash.
  const cuf = Array.from({ length: nodeCount }, (_, i) => i);
  const cfind = (x: number): number => {
    let r = x;
    while (cuf[r] !== r) r = cuf[r]!;
    while (cuf[x] !== r) {
      const nx = cuf[x]!;
      cuf[x] = r;
      x = nx;
    }
    return r;
  };
  const cunion = (x: number, y: number): void => {
    if (x === 0 || y === 0) return; // ground is not a circuit bridge
    const rx = cfind(x);
    const ry = cfind(y);
    if (rx !== ry) cuf[rx] = ry;
  };
  for (let i = 0; i < aArr.length; i++) {
    const terms = [aArr[i]!, bArr[i]!, cArr[i]!, dArr[i]!, eArr[i]!];
    let base = 0;
    for (const t of terms) {
      if (t !== 0) {
        base = t;
        break;
      }
    }
    if (base !== 0) for (const t of terms) cunion(base, t);
  }
  const circuitOfNode = Array.from({ length: nodeCount }, (_, i) => cfind(i));

  return {
    nodeCount,
    types: Uint8Array.from(types),
    a: Uint32Array.from(aArr),
    b: Uint32Array.from(bArr),
    c: Uint32Array.from(cArr),
    d: Uint32Array.from(dArr),
    e: Uint32Array.from(eArr),
    f: Uint32Array.from(fArr),
    g: Uint32Array.from(gArr),
    h: Uint32Array.from(hArr),
    values: Float64Array.from(values),
    aux: Float64Array.from(auxArr),
    params,
    elemOfComponent,
    legsOfComponent,
    nodesOfComponent,
    compositeInternals,
    userIcInternals,
    nodeNames,
    nodeColors,
    floatingSources,
    circuitOfNode,
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

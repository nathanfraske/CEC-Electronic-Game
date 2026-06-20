// SPDX-License-Identifier: Apache-2.0
// Board model: the pure data layer for the interactive board (M1). Holds placed
// components, their pins, the wires that join pins into nets, and each part's
// ideal value. No PixiJS or DOM here — this is presentation-free state so the
// renderer and the simulation netlist builder can both read it. Grid snapping
// and the CEC palette mirror live here as plain values for the GPU layer.

/** Logical grid cell. The board is an integer lattice; geometry is derived. */
export interface Cell {
  col: number;
  row: number;
}

/** A pin is an anchored terminal on a component, addressed by a local index. */
export interface Pin {
  /** Index of the owning component's pin (0-based, stable per component kind). */
  index: number;
  /** Human label shown on hover / debug (e.g. "A", "K", "C", "E", "B"). */
  label: string;
  /** Offset from the component's anchor cell, in whole grid cells. */
  dx: number;
  dy: number;
}

/** A part kind: the static template a placed component is instantiated from. */
export interface PartKind {
  tag: string;
  name: string;
  /** CEC palette key; resolved to a hex color via {@link PALETTE}. */
  colorKey: PaletteKey;
  pins: Pin[];
  /** Footprint in cells, used to size the rendered node body. */
  w: number;
  h: number;
  /** Default ideal value (volts / ohms / farads / henries / amps). 0 if not electrical. */
  defaultValue: number;
  /** SI unit symbol for the value ("V", "Ω", "F", "H", "A"); "" if none. */
  unit: string;
  /** True for the ideal primitives the solver understands today (incl. GND). */
  ideal: boolean;
}

/** A placed component instance on the board. */
export interface Component {
  id: number;
  /** The kind tag this instance was placed from (keys into {@link PART_KINDS}). */
  kind: string;
  /** Anchor cell (top-left of footprint) after snapping. */
  cell: Cell;
  /** Ideal value (volts / ohms / farads / henries). For an AC source this is the
   * frequency in Hz; the peak amplitude is the separate {@link Component.amp}. */
  value: number;
  /**
   * The AC source's second scalar: its peak amplitude in volts. Only meaningful
   * for kind `"AC"` (where `value` is the frequency); other kinds leave it
   * undefined. A new AC source defaults to {@link AC_DEFAULT_AMP} (5 V), so an AC
   * source that never touches the amplitude inspector swings +/- 5 V exactly as
   * before. Optional so older snapshots without it round-trip to the default.
   */
  amp?: number;
  /**
   * The potentiometer's wiper position in `[0, 1]`: the fraction of the total
   * resistance ({@link Component.value}) between the A end and the wiper. `0` puts
   * the wiper at A, `1` at B, `0.5` centres it. Only meaningful for kind `"POT"`
   * (where {@link buildNetlist} splits it into two resistors); other kinds leave it
   * undefined. A new POT defaults to centred (0.5). Optional so older snapshots
   * round-trip to the default.
   */
  wiper?: number;
  /**
   * A thermistor's body temperature in °C: the second scalar for kinds `"NTC"` and
   * `"PTC"` (where {@link Component.value} is the nominal resistance). The user sets it
   * directly for now (the inspector's temperature knob); {@link buildNetlist} turns it
   * into the live R(T) and stamps a plain resistor — the same web-only expansion as the
   * POT's wiper, so no sim-core/golden change. Left undefined on other kinds; a new
   * thermistor defaults to 25 °C. Optional so older snapshots round-trip to the default.
   * (Prep for a future self-heating model: this same field would then be sim-driven.)
   */
  temp?: number;
  /**
   * The logic family of a digital part (gate or flip-flop): an index into the
   * {@link LOGIC_FAMILIES} table — `0` = Ideal (the half-rail default), `1` = CMOS,
   * `2` = TTL. Only meaningful for the logic gates and the D flip-flop; other kinds
   * leave it undefined. Encoded into `aux`'s upper bits by {@link buildNetlist}
   * (`func + 16*family`), matching `FAMILIES` in `crates/sim-core/src/lib.rs`. A new
   * gate defaults to Ideal, so any part that never touches the family picker behaves
   * exactly as before. Optional so older snapshots round-trip to Ideal.
   */
  family?: number;
  /**
   * Open-drain (open-collector) output mode for a logic gate: when `true`, the gate
   * pulls its output LOW but RELEASES (high-impedance) instead of driving it high — the
   * high comes from an external pull-up resistor. Open-drain gates sharing a net form a
   * wired-AND bus (the I²C / interrupt-line idiom). Encoded into `aux` bit 8 (`+256`) by
   * {@link buildNetlist}, matching `gate_open_drain` in `crates/sim-core/src/lib.rs`.
   * Only meaningful for the logic gates; undefined elsewhere defaults to push-pull, so
   * existing parts are unchanged and older snapshots round-trip.
   */
  openDrain?: boolean;
  /** Orientation in 90° clockwise steps (0..3). */
  rot: number;
  /**
   * Optional custom label the player gives this part (e.g. `"R1"`, `"Vin"`, `"Load"`).
   * Shown on the board in place of the kind tag when set. **Pure presentation** — it has
   * no effect on the netlist or the sim. Optional, so older snapshots and parts that were
   * never named round-trip unchanged (`serialize`/`restore` spread it through for free).
   */
  label?: string;
  /**
   * Quality **tier** of this part for main gameplay: an index into {@link TIER_LABELS}
   * — `0` budget, `1` mid-range, `2` high-end, `3` lab-grade. Each tier is a preset
   * bundle of the device's model parameters (an op-amp's GBW, a cap's ESR/ESL, an
   * inductor's DCR/winding-C), mapped by {@link tierParams} into the per-element param
   * block {@link buildNetlist} hands the core. A better tier = a better (and, later,
   * pricier) part. Only the tiered kinds read it; others ignore it. Undefined → mid-range
   * (the default), so older snapshots and untouched parts round-trip unchanged. In the
   * sandbox the raw params are still editable; this is the curated choice for gameplay.
   */
  tier?: number;
  /**
   * The device **sub-type / variant** index, interpreted per kind: for a diode (`"D"`) it
   * picks the diode TYPE (switching / rectifier / fast-recovery / power — each a preset of
   * forward `Is`/`n` and a current rating); for an `"LED"` it picks the COLOUR (which sets its
   * forward voltage and emitted tint). A param preset, mapped by {@link diodeVariant} into the
   * per-element block {@link buildNetlist} hands the core. Only multi-variant kinds read it;
   * others ignore it. Undefined → variant 0 (the first/default type), so older snapshots and
   * untouched parts round-trip unchanged.
   */
  variant?: number;
  /**
   * The pulse / clock generator's **duty cycle** in `[0, 1]`: the fraction of each period the
   * square output is high (and the symmetry point of the triangle). Only meaningful for kind
   * `"PULSE"` (where {@link buildNetlist} writes it into the waveform param block); other kinds
   * leave it undefined. A new pulse source defaults to 0.5 (50 %). Optional so older snapshots
   * round-trip unchanged.
   */
  duty?: number;
}

/** Default peak amplitude (volts) of a freshly placed AC source — mirrors the
 * core's `AC_AMPLITUDE`, so an AC source left untouched swings +/- 5 V. */
export const AC_DEFAULT_AMP = 5;

/** Fully-qualified address of a pin on a placed component. */
export interface PinRef {
  componentId: number;
  pinIndex: number;
}

/**
 * A junction: a free point on the grid that wires can end on, just like a pin.
 * It is NOT an element — it only ties the wire-ends that meet at it into one net
 * (KiCad's wire-to-wire junction dot). Created when a wire is dropped onto an
 * existing wire, which splits that wire so both halves terminate here.
 */
export interface Junction {
  id: number;
  cell: Cell;
  /**
   * A deliberate *free wire-end* (a dangling endpoint, KiCad-style): a junction
   * that terminates a single wire on purpose, e.g. the cut left behind when one
   * segment of a multi-bend wire is deleted ({@link BoardGraph.deleteWireSegment}).
   * Unlike an ordinary junction it earns its keep with only one incident wire, so
   * {@link BoardGraph.pruneJunctions} does not sweep it (and its lone wire) away.
   * Absent (falsy) for the usual ≥2-wire tie points. It still collapses normally
   * once its wire is removed (incidence 0 ⇒ pruned).
   */
  free?: boolean;
}

/** Address of a junction, the wire-endpoint counterpart to {@link PinRef}. */
export interface JunctionRef {
  junctionId: number;
}

/**
 * A wire endpoint: either a component pin or a junction. The two are
 * distinguished structurally — {@link isJunctionRef} narrows by the presence of
 * `junctionId`. Wire-ends sharing a net (pin or junction) are electrically one
 * node.
 */
export type Endpoint = PinRef | JunctionRef;

/** Type guard: an endpoint that addresses a junction rather than a pin. */
export function isJunctionRef(e: Endpoint): e is JunctionRef {
  return (e as JunctionRef).junctionId !== undefined;
}

/** Type guard: an endpoint that addresses a component pin. */
export function isPinRef(e: Endpoint): e is PinRef {
  return (e as PinRef).componentId !== undefined;
}

/** Stable union-find / map key for a wire endpoint (pin or junction). */
export function endpointKey(e: Endpoint): string {
  return isJunctionRef(e)
    ? "j" + e.junctionId
    : e.componentId + ":" + e.pinIndex;
}

/** True if two endpoints address the same pin or the same junction. */
export function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  if (isJunctionRef(a) && isJunctionRef(b))
    return a.junctionId === b.junctionId;
  if (isPinRef(a) && isPinRef(b)) return samePin(a, b);
  return false;
}

/**
 * A net label (KiCad-style): a name attached to a wire endpoint (a pin or a
 * junction — the natural connection points). It has two roles, both realised in
 * {@link buildNetlist}:
 *
 * 1. **Net name (local label):** the net it sits on is *displayed* by this name
 *    (the scope/telemetry show `VCC` instead of `Node 3`).
 * 2. **Alias (global label):** **any labels sharing the same `name` are the same
 *    net, with no wire between them** — label a point `VCC` here and `VCC` there
 *    and they are electrically one node. This is the decluttering payoff.
 *
 * Two labels with the same name collapse onto one net; the netlist's name
 * union-find treats matching names as if a wire joined their endpoints.
 */
export interface NetLabel {
  id: number;
  /** The displayed name; also the alias key (same name ⇒ same net). */
  name: string;
  /** The net the label names, addressed by an endpoint on it: a pin, a junction,
   * or — for a label dropped on a bare trace — that wire's `from` endpoint (which
   * shares the wire's net). All the netlist/union machinery keys off this. */
  at: Endpoint;
  /**
   * Optional draw position (grid cell) overriding the anchor's: set when the label
   * sits on a wire trace rather than at a pin/junction, so the pill is drawn at the
   * clicked point along the trace while `at` still resolves its net. Absent for a
   * label that lives at its endpoint.
   */
  pos?: Cell;
  /**
   * Optional draggable offset (world px) of the tag pill from its anchor point
   * (`pos ?? endpointCell(at)`). Lets a label be moved KiCad-style while the dot +
   * leader stay pinned to what it names. Absent ⇒ the default up-and-right offset.
   */
  tagOff?: { dx: number; dy: number };
}

/**
 * A wire joins two endpoints — pins and/or junctions. Wires are the edges;
 * connected wires form a net.
 */
export interface Wire {
  id: number;
  from: Endpoint;
  to: Endpoint;
  /**
   * Ordered manual routing waypoints (interior grid cells the orthogonal route
   * bends through, from→to). Set by dragging a trace segment; empty/absent means
   * the auto L-route is used. Purely cosmetic — they never affect connectivity or
   * the solver netlist. (Supersedes the legacy single `mid` waypoint, which
   * `restore` still reads from older snapshots.)
   */
  waypoints?: Cell[];
}

/**
 * A wire as it may appear in an OLD serialized snapshot: it might still carry a
 * single `mid` waypoint instead of the `waypoints` array. {@link BoardGraph.restore}
 * accepts this shape and folds a lone `mid` into a one-element `waypoints` array.
 */
type LegacyWire = Omit<Wire, "waypoints"> & {
  waypoints?: Cell[];
  mid?: Cell;
};

/** A serialized copy of the whole graph, used for undo/redo. */
export interface GraphSnapshot {
  components: Component[];
  /**
   * The wires. {@link BoardGraph.serialize} always writes the current
   * {@link Wire} shape (a `waypoints` array); {@link BoardGraph.restore} also
   * tolerates legacy wires carrying a single `mid` (see {@link LegacyWire}).
   */
  wires: LegacyWire[];
  /** Free wire-to-wire junctions. Absent in older snapshots (treated as []). */
  junctions?: Junction[];
  /** Net labels (names + global aliases). Absent in older snapshots (treated as []). */
  netLabels?: NetLabel[];
  nextComponentId: number;
  nextWireId: number;
  /** Next junction id. Absent in older snapshots (rederived from junctions). */
  nextJunctionId?: number;
  /** Next net-label id. Absent in older snapshots (rederived from netLabels). */
  nextNetLabelId?: number;
}

/**
 * The CEC palette mirrored as hex for the GPU, matching the OKLCH tokens in
 * `app.css` (kept in lockstep with the hexes already used by the renderer).
 */
export const PALETTE = {
  accent: 0xf5247a,
  cyan: 0x46d2e6,
  violet: 0x9a78ff,
  ok: 0x3ad39a,
  warn: 0xe6a23a,
  bronze: 0xc9a76a,
  bad: 0xe0533a,
  dim: 0x9c93b8,
  border: 0x3b3560,
  // Power-bus / signal-path identities (docs/ui/visual-language.md, CLAUDE.md):
  // the colour code the construction-detail drawers use for live signal paths —
  // + input / +5 V rail (cyan), − input / +12 V rail (amber), op-amp output
  // (rose), and the GND rail (muted violet-grey). These mirror the owner mockups'
  // --pos/--neg/--out/--rail tokens so the detail views recolour from one source.
  pos: 0x46d2e6,
  neg: 0xd8a24a,
  out: 0xf5247a,
  rail: 0x6b6488,
} as const;

export type PaletteKey = keyof typeof PALETTE;

/**
 * Pin templates per part tag. Two-terminal passives get a left/right pin pair;
 * the active/digital parts get a small, readable pinout. Footprints are sized so
 * pins land on grid intersections. These mirror the tech-tree bin in App.svelte.
 *
 * The ideal primitives (V, R, C, L, I) carry default values and are the parts
 * the solver simulates today; GND is a 1-pin reference (node 0, not an element);
 * the rest are placeholders for later tiers.
 */
export const PART_KINDS: Record<string, PartKind> = {
  V: kind("V", "Voltage Source", "warn", twoPin("+", "−"), 5, "V", true),
  // Sine source (ideal, 5 V peak); `value` is the frequency in Hz.
  AC: kind("AC", "AC Source", "accent", twoPin("+", "−"), 500, "Hz", true),
  // Pulse / clock generator: a unipolar square (or triangle) source — `value` is the
  // frequency (Hz), `amp` the high level (V), `variant` the waveform (0 square / 1 triangle),
  // `duty` the duty cycle. In the netlist it is an AC-source element with the waveform param
  // set (so the deterministic core treats it as one more time-varying voltage source).
  PULSE: kind(
    "PULSE",
    "Pulse / Clock Gen",
    "violet",
    twoPin("+", "−"),
    1000,
    "Hz",
    true,
  ),
  R: kind("R", "Resistor", "bronze", twoPin("A", "B"), 1000, "Ω", true),
  // Current-sense shunt: a precision *milliohm* resistor placed in series with a load so the
  // small voltage across it (V = I·R) reads the current through it. Electrically a plain resistor
  // (buildNetlist maps it to ELEM_RESISTOR), so it inherits the Real-mode lead inductance — and
  // because its R is tiny, the ωL term swings the phase visibly at high frequency (a normal
  // resistor's stays ~0°). Bronze, the resistor family.
  SHUNT: kind(
    "SHUNT",
    "Current Shunt",
    "bronze",
    twoPin("A", "B"),
    0.01,
    "Ω",
    true,
  ),
  C: kind("C", "Capacitor", "cyan", twoPin("+", "−"), 1e-6, "F", true),
  // Electrolytic cap: a big polarized bulk cap with a real parasitic ESR. `value`
  // is the capacitance (F); the ESR is fixed in the netlist. Pins are polarized
  // (+ / −). In `buildNetlist` it expands to an ideal C in series with the ESR R.
  EC: kind(
    "EC",
    "Electrolytic Cap",
    "cyan",
    twoPin("+", "−"),
    100e-6,
    "F",
    true,
  ),
  L: kind("L", "Inductor", "violet", twoPin("A", "B"), 1e-3, "H", true),
  // Ideal DC current source: arrow points a -> b, default 10 mA. Its dual is V.
  I: kind("I", "Current Source", "warn", twoPin("A", "B"), 1e-2, "A", true),
  // Explicit ground reference: a single pin whose net becomes node 0. Not a
  // solver element (1 pin, absent from TYPE_OF) — it only anchors the reference.
  GND: kind("GND", "Ground", "dim", onePin("⏚"), 0, "", true),
  // Diode: nonlinear (Shockley); anode A -> cathode K. Engages the Newton solve.
  D: kind("D", "Diode", "warn", twoPin("A", "K"), 0, "", true),
  // Schottky diode: same Newton junction as D but a low ~0.3 V drop (metal–
  // semiconductor). Cyan reads as the cool, low-loss/fast variant vs silicon's amber.
  SD: kind("SD", "Schottky Diode", "cyan", twoPin("A", "K"), 0, "", true),
  // LED: a diode that emits light; ~1.9 V drop, brightness tracks forward current.
  // The vivid accent rose is the "emitting" hue.
  LED: kind("LED", "LED", "accent", twoPin("A", "K"), 0, "", true),
  // Zener: a diode whose REVERSE breakdown is the feature — once reverse-biased to
  // its `value` (Vz, in volts) it conducts hard and clamps the node, the basis of a
  // shunt voltage reference. Forward it is an ordinary ~0.7 V diode. Bronze keeps
  // it in the silicon-junction family while reading apart from the plain diode.
  ZD: kind("ZD", "Zener Diode", "bronze", twoPin("A", "K"), 5.1, "V", true),
  // Varistor (MOV): a two-terminal *symmetric* voltage clamp — the across-the-line
  // surge protector. Very high resistance until |V| reaches its clamp voltage Vc
  // (`value`, in volts, default 18 V), then it conducts hard in either polarity to
  // pin the node near ±Vc and absorb the surge. The symmetric cousin of the Zener;
  // oriented a→b but bidirectional, so its pins are the neutral A/B pair. Amber
  // `warn` reads as the protective/caution hue and sets the Protection family
  // apart from the silicon-junction diodes.
  MOV: kind("MOV", "Varistor", "warn", twoPin("A", "B"), 18, "V", true),
  // NTC thermistor: a metal-oxide resistor whose resistance FALLS as it heats
  // (R = R0·exp(B(1/T−1/T0))). `value` is the nominal R at 25 °C (default 10 kΩ); the
  // second scalar {@link Component.temp} is its body temperature, set by the inspector
  // knob for now. buildNetlist turns R(T) into a plain resistor — web-only, like the
  // POT, so no sim-core/golden change. Amber `warn` reads as the thermal/sensing hue.
  NTC: kind(
    "NTC",
    "NTC Thermistor",
    "warn",
    twoPin("A", "B"),
    10000,
    "Ω",
    true,
  ),
  // PTC thermistor (switching ceramic): low R until its Curie point, then a several-
  // decade JUMP (the resettable-fuse snap). `value` is the low-state R (default 100 Ω);
  // `temp` is the body temperature. Same web-only R(T) expansion as the NTC.
  PTC: kind("PTC", "PTC Thermistor", "warn", twoPin("A", "B"), 100, "Ω", true),
  // Clock-driven (PWM) switch; `value` is the duty cycle in [0,1].
  SW: kind("SW", "Switch", "ok", twoPin("A", "B"), 0.5, "", true),
  // Manual switch: a player-operated SPST switch. Reuses the SW solver element
  // (type 6) but `value` is its STATE — 1 = closed (always conducting), 0 = open
  // (always blocking) — flipped by clicking the part on the board. Default closed
  // (1). Violet reads it apart from the clock switch's green while keeping it in
  // the switching family. See `web/src/lib/netlist.ts` (MSW maps to type 6).
  MSW: kind("MSW", "Manual Switch", "violet", twoPin("A", "B"), 1, "", true),
  // N-channel MOSFET: the first three-terminal solver element. A voltage on the
  // gate (Vgs vs the ~2 V threshold) controls the drain→source current. Pins are
  // ordered D, S, G — pin 0 = Drain (a), pin 1 = Source (b), pin 2 = Gate (c) —
  // so buildNetlist's pin→terminal map is direct. Drain at top, source at bottom,
  // gate on the left, matching the schematic. `value` is unused (fixed model).
  // The `ok` green reads as the "switching/gain" family.
  NM: kind(
    "NM",
    "N-MOSFET",
    "ok",
    [pin("D", 2, 0), pin("S", 2, 2), pin("G", 0, 1)],
    0,
    "",
    true,
  ),
  // P-channel MOSFET: the high-side mirror of the NMOS — it conducts when the gate
  // is pulled *below* the source by more than |VTO|. Same D, S, G pin order and
  // the same fixed model; `value` unused.
  PM: kind(
    "PM",
    "P-MOSFET",
    "ok",
    [pin("D", 2, 0), pin("S", 2, 2), pin("G", 0, 1)],
    0,
    "",
    true,
  ),
  // NPN bipolar transistor: a three-terminal current-controlled device. A small
  // base current controls a much larger collector→emitter current (Ic ≈ β·Ib,
  // β ≈ 100). Pins are ordered C, E, B — pin 0 = Collector (a), pin 1 = Emitter
  // (b), pin 2 = Base (c) — so buildNetlist's pin→terminal map is direct and
  // matches the core (Ebers-Moll, main current a→b = collector→emitter). Collector
  // at top, emitter at bottom, base on the left, mirroring the schematic. `value`
  // is unused (fixed model). The vivid accent rose marks the gain/switching family.
  Q: kind(
    "Q",
    "NPN Transistor",
    "accent",
    [pin("C", 2, 0), pin("E", 2, 2), pin("B", 0, 1)],
    0,
    "",
    true,
  ),
  // PNP bipolar transistor: the polarity mirror of the NPN — it turns on when the
  // base is pulled *below* the emitter, and is the natural high-side partner. Same
  // C, E, B pin order and the same fixed Ebers-Moll model; `value` unused.
  QP: kind(
    "QP",
    "PNP Transistor",
    "accent",
    [pin("C", 2, 0), pin("E", 2, 2), pin("B", 0, 1)],
    0,
    "",
    true,
  ),
  // Op-amp: the flagship analog IC and the first behavioural 3-terminal *active*
  // building block. A huge open-loop gain drives the output until the difference
  // between its two inputs is (almost) nulled, the basis of every feedback
  // amplifier, buffer, and comparator. Pins are ordered OUT, IN−, IN+ — pin 0 =
  // Output (a), pin 1 = Inverting input (b), pin 2 = Non-inverting input (c) —
  // so buildNetlist's pin→terminal map matches the core exactly (ELEM_OPAMP=15:
  // a=OUT, b=IN−, c=IN+). `value` is the saturation rail Vsat in volts (the output
  // swings within ±Vsat). The output is on the right vertex of the triangle, the
  // two inputs on the left edge (IN+ top, IN− bottom). Cyan reads as the clean
  // analog signal-processing block, apart from the green switches and rose BJTs.
  OA: kind(
    "OA",
    "Op-Amp",
    "cyan",
    [pin("OUT", 2, 1), pin("IN−", 0, 2), pin("IN+", 0, 0)],
    12,
    "V",
    true,
  ),
  // Logic gates: the first behavioural digital ICs (sim type 17). Pins are ordered
  // OUT, IN1, IN2 — pin 0 = output Y (a), pin 1 = input A (b), pin 2 = input B (c)
  // — so buildNetlist's pin→terminal map is direct and the per-tag function code is
  // stamped into `aux` (see GATE_AUX in netlist.ts). `value` is the logic-high rail
  // in volts (default 5). Inputs are thresholded at half the rail, read from the
  // previous tick (one tick of propagation delay). The two-input gates are 3-pin
  // (Y right, A top-left, B bottom-left); the inverter NOT is 2-pin (Y, A). Green
  // `ok` marks the digital-logic family.
  AND: kind(
    "AND",
    "AND Gate",
    "ok",
    [pin("Y", 2, 1), pin("A", 0, 0), pin("B", 0, 2)],
    5,
    "V",
    true,
  ),
  OR: kind(
    "OR",
    "OR Gate",
    "ok",
    [pin("Y", 2, 1), pin("A", 0, 0), pin("B", 0, 2)],
    5,
    "V",
    true,
  ),
  NAND: kind(
    "NAND",
    "NAND Gate",
    "ok",
    [pin("Y", 2, 1), pin("A", 0, 0), pin("B", 0, 2)],
    5,
    "V",
    true,
  ),
  NOR: kind(
    "NOR",
    "NOR Gate",
    "ok",
    [pin("Y", 2, 1), pin("A", 0, 0), pin("B", 0, 2)],
    5,
    "V",
    true,
  ),
  XOR: kind(
    "XOR",
    "XOR Gate",
    "ok",
    [pin("Y", 2, 1), pin("A", 0, 0), pin("B", 0, 2)],
    5,
    "V",
    true,
  ),
  // XNOR (equality): the complement of XOR — output high when the inputs match.
  // Same 3-pin shape and function-code family (aux = 5 in GATE_AUX).
  XNOR: kind(
    "XNOR",
    "XNOR Gate",
    "ok",
    [pin("Y", 2, 1), pin("A", 0, 0), pin("B", 0, 2)],
    5,
    "V",
    true,
  ),
  // The inverter (NOT): single input. Pin order OUT, IN — pin 0 = Y (a), pin 1 = A
  // (b); the unused third terminal c defaults to ground in buildNetlist.
  NOT: kind(
    "NOT",
    "NOT Gate",
    "ok",
    [pin("Y", 2, 1), pin("A", 0, 1)],
    5,
    "V",
    true,
  ),
  // The buffer (BUF): single input, non-inverting — the output follows the input.
  // Same 2-pin shape as NOT without the inversion bubble (aux = 7 in GATE_AUX); a
  // line driver / one-tick delay element.
  BUF: kind(
    "BUF",
    "Buffer",
    "ok",
    [pin("Y", 2, 1), pin("A", 0, 1)],
    5,
    "V",
    true,
  ),
  // Transformer: the first FOUR-terminal part — two magnetically coupled windings.
  // Pins are ordered primary+, primary−, secondary+, secondary− so buildNetlist's
  // pin→terminal map is direct (pin 0 → a, 1 → b, 2 → c, 3 → d), matching the core
  // (ELEM_TRANSFORMER=18: primary a/b, secondary c/d). `value` is the turns ratio
  // n = Ns/Np (default 2, a step-up); the inspector shows it as Np:Ns. The primary
  // winding is on the left (P+ top, P− bottom), the secondary on the right. Violet
  // marks the magnetic/reactive family alongside the inductor.
  TR: kind(
    "TR",
    "Transformer",
    "violet",
    [pin("P+", 0, 0), pin("P−", 0, 2), pin("S+", 2, 0), pin("S−", 2, 2)],
    2,
    "",
    true,
  ),
  // Potentiometer: a three-terminal variable resistor — two ends A, B and a movable
  // wiper W that taps somewhere along the track. Pins ordered A, B, W (pin 0 = A,
  // 1 = B, 2 = W). `value` is the total end-to-end resistance; the wiper position
  // (Component.wiper, 0..1) sets where W sits. buildNetlist expands it into two
  // resistors — A→W = R·t and W→B = R·(1−t) — so there's no new solver element. The
  // classic divider/knob. Bronze, the resistor family.
  POT: kind(
    "POT",
    "Potentiometer",
    "bronze",
    [pin("A", 0, 0), pin("B", 2, 0), pin("W", 1, 2)],
    10000,
    "Ω",
    true,
  ),
  // D flip-flop: the first sequential IC (sim type 19, four-terminal). Pins are
  // ordered Q, D, CLK, Q̄ so buildNetlist's pin→terminal map is direct (pin 0 → a =
  // Q, 1 → b = D, 2 → c = CLK, 3 → d = Q̄), matching the core. On each rising clock
  // edge it samples D and presents it on Q (Q̄ the complement). `value` is the logic
  // rail. Outputs on the right (Q top, Q̄ bottom), inputs on the left (D top, the
  // edge-clock CLK bottom). Cyan, the memory/clocked family.
  FF: kind(
    "FF",
    "D Flip-Flop",
    "cyan",
    [pin("Q", 2, 0), pin("D", 0, 0), pin("CLK", 0, 2), pin("Q̅", 2, 2)],
    5,
    "V",
    true,
  ),
  // Level shifter (sim type 20): translates a logic level across rails. Pins OUT,
  // IN (pin 0 → a = output, 1 → b = input). `value` is the INPUT rail (rail A, the
  // threshold side); the OUTPUT rail (rail B) is the second scalar (Component.amp,
  // stamped into `aux` by buildNetlist). Reads at rail A, re-drives at rail B — a
  // 1.8 V high in becomes a clean 5 V high out (or vice versa). Green logic family.
  LS: kind(
    "LS",
    "Level Shifter",
    "ok",
    [pin("OUT", 2, 1), pin("IN", 0, 1)],
    1.8,
    "V",
    true,
  ),
  // Pull-up (sim type 21): a one-terminal resistor to an internal Vcc at `value`
  // volts — the companion to an open-drain bus (wired-AND). Bronze, the resistor
  // family. The single pin attaches to the net being pulled up.
  PU: kind("PU", "Pull-up", "bronze", onePin("●"), 5, "V", true),
  FP: kind(
    "FP",
    "FPGA Fabric",
    "violet",
    [pin("0", 0, 0), pin("1", 0, 2), pin("2", 2, 0), pin("3", 2, 2)],
    0,
    "",
    false,
  ),
  uC: kind(
    "uC",
    "Microcontroller",
    "accent",
    [pin("RX", 0, 0), pin("TX", 0, 2), pin("IO", 2, 0), pin("CLK", 2, 2)],
    0,
    "",
    false,
  ),
};

function pin(label: string, dx: number, dy: number): Pin {
  return { index: 0, label, dx, dy };
}

function twoPin(a: string, b: string): Pin[] {
  return [pin(a, 0, 0), pin(b, 2, 0)];
}

/** A single-terminal part (e.g. an explicit ground reference). */
function onePin(a: string): Pin[] {
  return [pin(a, 0, 0)];
}

function kind(
  tag: string,
  name: string,
  colorKey: PaletteKey,
  pins: Pin[],
  defaultValue: number,
  unit: string,
  ideal: boolean,
): PartKind {
  // Re-index pins so each carries its own ordinal, and derive the footprint
  // from the furthest pin offset (+1 cell of slack on each axis).
  const indexed = pins.map((p, i) => ({ ...p, index: i }));
  const w = indexed.reduce((m, p) => Math.max(m, p.dx), 0) + 1;
  const h = indexed.reduce((m, p) => Math.max(m, p.dy), 0) + 1;
  return {
    tag,
    name,
    colorKey,
    pins: indexed,
    w,
    h,
    defaultValue,
    unit,
    ideal,
  };
}

/** Snap a continuous coordinate to the nearest cell index for the given pitch. */
export function snap(value: number, pitch: number): number {
  return Math.round(value / pitch);
}

/** Rotate an (dx,dy) offset by `rot` 90° clockwise steps: (x,y) → (−y,x). */
export function rotateOffset(
  dx: number,
  dy: number,
  rot: number,
): { col: number; row: number } {
  let x = dx;
  let y = dy;
  const k = ((rot % 4) + 4) % 4;
  for (let i = 0; i < k; i++) {
    const t = x;
    x = -y;
    y = t;
  }
  return { col: x, row: y };
}

/** Format an ideal value in engineering notation, e.g. 1000 Ω -> "1 kΩ". */
export function formatValue(value: number, unit: string): string {
  if (!unit) return "";
  if (value === 0) return "0 " + unit;
  const prefixes: [number, string][] = [
    [1e9, "G"],
    [1e6, "M"],
    [1e3, "k"],
    [1, ""],
    [1e-3, "m"],
    [1e-6, "µ"],
    [1e-9, "n"],
    [1e-12, "p"],
  ];
  const abs = Math.abs(value);
  for (const [scale, p] of prefixes) {
    if (abs >= scale) {
      const v = value / scale;
      const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
      // Strip trailing zeros only *after a decimal point* ("4.70"->"4.7", "1.00"->"1",
      // "50.0"->"50"); never from an integer mantissa — "470" must stay "470", not
      // become "47" (the old `/\.?0+$/` ate integer zeros, showing 470 µF as "47 µF",
      // 100 Ω as "1 Ω", 120 V as "12 V", …).
      const trimmed = s.includes(".") ? s.replace(/\.?0+$/, "") : s;
      return trimmed + " " + p + unit;
    }
  }
  return value.toExponential(1) + " " + unit;
}

/**
 * The board graph: placed components and the wires between their pins. Pure
 * model — it allocates stable ids, prevents duplicate/self wires, and answers
 * geometric queries the renderer needs (pin positions, hit testing) given a
 * pitch. It never touches the GPU.
 */
export class BoardGraph {
  private nextComponentId = 1;
  private nextWireId = 1;
  private nextJunctionId = 1;
  private nextNetLabelId = 1;
  readonly components = new Map<number, Component>();
  readonly wires = new Map<number, Wire>();
  readonly junctions = new Map<number, Junction>();
  readonly netLabels = new Map<number, NetLabel>();

  /** Place a new component of `kind` anchored at the given (already-snapped) cell. */
  place(kind: string, cell: Cell): Component | undefined {
    const template = PART_KINDS[kind];
    if (!template) return undefined;
    const component: Component = {
      id: this.nextComponentId++,
      kind,
      cell,
      value: template.defaultValue,
      rot: 0,
      // An AC source carries a second scalar (its peak amplitude), defaulting to
      // 5 V so a freshly placed source swings +/- 5 V exactly as before. Other
      // kinds leave it undefined.
      ...(kind === "AC" ? { amp: AC_DEFAULT_AMP } : {}),
      ...(kind === "PULSE" ? { amp: AC_DEFAULT_AMP, duty: 0.5 } : {}),
      // A level shifter carries its OUTPUT rail (rail B) as the second scalar,
      // defaulting to 5 V — so a fresh shifter translates its 1.8 V input up to 5 V.
      ...(kind === "LS" ? { amp: 5 } : {}),
      // A potentiometer carries its wiper position, defaulting to centred (0.5).
      ...(kind === "POT" ? { wiper: 0.5 } : {}),
      // A thermistor carries its body temperature, defaulting to 25 °C.
      ...(kind === "NTC" || kind === "PTC" ? { temp: 25 } : {}),
    };
    this.components.set(component.id, component);
    return component;
  }

  /** Move an existing component to a new anchor cell. */
  move(id: number, cell: Cell): void {
    const c = this.components.get(id);
    if (c) c.cell = cell;
  }

  /**
   * Move a free junction to a new (already-snapped) grid cell. Incident wires
   * reference the junction by id, so they re-route to follow automatically; only
   * the geometry changes, never the connectivity — so the netlist `sig` (built
   * from topology + node numbering, not positions) stays stable and the running
   * sim isn't reset.
   */
  moveJunction(id: number, cell: Cell): void {
    const j = this.junctions.get(id);
    if (j) j.cell = { ...cell };
  }

  /** Remove a component and any wires touching its pins (and tidy junctions). */
  removeComponent(id: number): void {
    this.components.delete(id);
    for (const [wid, w] of this.wires) {
      if (endpointHasComponent(w.from, id) || endpointHasComponent(w.to, id)) {
        this.wires.delete(wid);
      }
    }
    // Drop any net labels pinned to this component's pins — their anchor is gone.
    for (const [lid, l] of this.netLabels) {
      if (endpointHasComponent(l.at, id)) this.netLabels.delete(lid);
    }
    this.pruneJunctions();
  }

  /** Resolve the part template for a placed component. */
  kindOf(component: Component): PartKind | undefined {
    return PART_KINDS[component.kind];
  }

  /**
   * Add a wire between two distinct endpoints (pins and/or junctions); rejects
   * self- and duplicate links, and ends that no longer exist.
   */
  connect(from: Endpoint, to: Endpoint): Wire | undefined {
    if (sameEndpoint(from, to)) return undefined;
    if (!this.endpointExists(from) || !this.endpointExists(to))
      return undefined;
    for (const w of this.wires.values()) {
      if (
        (sameEndpoint(w.from, from) && sameEndpoint(w.to, to)) ||
        (sameEndpoint(w.from, to) && sameEndpoint(w.to, from))
      ) {
        return undefined;
      }
    }
    const wire: Wire = { id: this.nextWireId++, from, to };
    this.wires.set(wire.id, wire);
    return wire;
  }

  /** Remove a wire and tidy any junction left dangling (<2 incident wires). */
  removeWire(id: number): void {
    this.wires.delete(id);
    this.pruneJunctions();
  }

  /** True if an endpoint still resolves to a live pin or junction. */
  private endpointExists(e: Endpoint): boolean {
    if (isJunctionRef(e)) return this.junctions.has(e.junctionId);
    return this.components.has(e.componentId);
  }

  /**
   * Replace a wire's ordered manual routing waypoints (the interior grid cells
   * its orthogonal route bends through). An empty array clears them, returning the
   * wire to its auto L-route. Cells are copied so the caller can't alias them.
   */
  setWireWaypoints(id: number, cells: Cell[]): void {
    const w = this.wires.get(id);
    if (!w) return;
    if (cells.length === 0) delete w.waypoints;
    else w.waypoints = cells.map((c) => ({ ...c }));
  }

  /** Drop all of a wire's manual waypoints, returning it to the auto route. */
  clearWireWaypoints(id: number): void {
    const w = this.wires.get(id);
    if (w) delete w.waypoints;
  }

  /** Absolute cell of a pin (anchor + rotated pin offset). */
  pinCell(component: Component, pin: Pin): Cell {
    const r = rotateOffset(pin.dx, pin.dy, component.rot);
    return {
      col: component.cell.col + r.col,
      row: component.cell.row + r.row,
    };
  }

  /** Resolve a {@link PinRef} to its absolute cell, if both ends still exist. */
  pinRefCell(ref: PinRef): Cell | undefined {
    const c = this.components.get(ref.componentId);
    if (!c) return undefined;
    const k = this.kindOf(c);
    const p = k?.pins[ref.pinIndex];
    if (!p) return undefined;
    return this.pinCell(c, p);
  }

  /** Resolve any wire endpoint (pin or junction) to its absolute cell. */
  endpointCell(e: Endpoint): Cell | undefined {
    if (isJunctionRef(e)) {
      const j = this.junctions.get(e.junctionId);
      return j ? { ...j.cell } : undefined;
    }
    return this.pinRefCell(e);
  }

  /**
   * The pin (if any) of some *other* component sitting exactly on `cell`. Used by
   * auto-splice at placement to decide precedence (an existing pin at the landing
   * cell is wired to directly). `exceptComponentId` skips the part being placed so
   * its own pin doesn't match. Returns the first such pin in component-id order.
   */
  pinAtCell(cell: Cell, exceptComponentId?: number): PinRef | undefined {
    const sorted = [...this.components.values()].sort((p, q) => p.id - q.id);
    for (const c of sorted) {
      if (c.id === exceptComponentId) continue;
      const k = this.kindOf(c);
      if (!k) continue;
      for (const p of k.pins) {
        const pc = this.pinCell(c, p);
        if (pc.col === cell.col && pc.row === cell.row) {
          return { componentId: c.id, pinIndex: p.index };
        }
      }
    }
    return undefined;
  }

  /** The junction (if any) sitting exactly on `cell`, in junction-id order. */
  junctionAtCell(cell: Cell): Junction | undefined {
    const sorted = [...this.junctions.values()].sort((p, q) => p.id - q.id);
    for (const j of sorted) {
      if (j.cell.col === cell.col && j.cell.row === cell.row) return j;
    }
    return undefined;
  }

  /**
   * Create a junction at a grid cell and return it. `free` marks it a deliberate
   * dangling wire-end (see {@link Junction.free}) that survives pruning with a
   * single incident wire; the default is an ordinary tie point.
   */
  addJunction(cell: Cell, free = false): Junction {
    const j: Junction = {
      id: this.nextJunctionId++,
      cell: { ...cell },
      ...(free ? { free: true } : {}),
    };
    this.junctions.set(j.id, j);
    return j;
  }

  /**
   * Drop a junction onto an existing wire: create a junction at `cell`, split the
   * target wire into target.from→J and J→target.to (preserving its waypoint on
   * the half that still needs it), and — when an incoming `from` endpoint is given
   * — connect it to the new junction. Returns the junction, or undefined if
   * anything is stale.
   *
   * With `from` it is the KiCad-style wire-to-wire (T) junction made by ending a
   * new wire on a trace. Without `from` (the "place junction" tool) it simply
   * splits the wire in place: both halves now terminate at the junction, so it
   * has the two incident wire-ends it needs to survive {@link pruneJunctions}.
   */
  junctionOnWire(
    targetWireId: number,
    cell: Cell,
    from?: Endpoint,
  ): Junction | undefined {
    const target = this.wires.get(targetWireId);
    if (!target) return undefined;
    if (from !== undefined && !this.endpointExists(from)) return undefined;
    const j = this.addJunction(cell);
    const jref: JunctionRef = { junctionId: j.id };
    // Split: keep the original wire as from→J, add a second J→to. The wire's
    // ordered bend waypoints lie along its run; re-home those before the split
    // point to the first half and those after it to the second.
    const origTo = target.to;
    const origWps = target.waypoints ?? [];
    const a = this.endpointCell(target.from);
    const b = this.endpointCell(origTo);
    const splitAt = a && b ? waypointSplitIndex(origWps, a, b, cell) : 0;
    const firstWps = origWps.slice(0, splitAt);
    const secondWps = origWps.slice(splitAt);
    target.to = { ...jref };
    if (firstWps.length > 0) target.waypoints = firstWps.map((c) => ({ ...c }));
    else delete target.waypoints;
    const second: Wire = {
      id: this.nextWireId++,
      from: { ...jref },
      to: origTo,
      ...(secondWps.length > 0
        ? { waypoints: secondWps.map((c) => ({ ...c })) }
        : {}),
    };
    this.wires.set(second.id, second);
    // `target` was mutated in place (it is the same object the map holds). With an
    // incoming endpoint, tie it to the junction; without one (the place-junction
    // tool) the two split halves alone give the junction its two incident ends.
    if (from !== undefined) this.connect(from, { ...jref });
    return j;
  }

  /**
   * Delete a single straight *leg* of a wire (a multi-bend run), leaving the rest
   * intact — the model side of "Delete removes only the clicked segment, not the
   * whole pin-to-pin wire". The run reads `from → wp0 → … → wp(n-1) → to`, so it has
   * `n + 1` legs; `legIndex` (0-based, in route order) selects the one to drop.
   *
   * The two flanking runs survive as their own wires, each terminating in a
   * **free** junction ({@link Junction.free}) placed at the deleted leg's boundary
   * (a former bend, or the kept side of a pin). Those cut junctions persist with a
   * single wire so the remaining run isn't swept away by {@link pruneJunctions}.
   * When the deleted leg touches an endpoint (the first or last leg) that side has
   * no flanking run — the wire simply retreats from that pin/junction. A straight
   * wire with no bends has a single leg, so deleting it removes the whole wire (the
   * caller falls back here when there is nothing finer to cut). Out-of-range indices
   * are treated the same way. Pieces are created before the original is removed so an
   * endpoint shared with the kept side never momentarily drops below its incidence.
   */
  deleteWireSegment(wireId: number, legIndex: number): void {
    const w = this.wires.get(wireId);
    if (!w) return;
    const wps = (w.waypoints ?? []).map((c) => ({ ...c }));
    const legCount = wps.length + 1;
    // No interior bends, or an index with nothing finer to cut: drop the whole wire.
    if (wps.length === 0 || legIndex < 0 || legIndex >= legCount) {
      this.removeWire(wireId);
      return;
    }
    // Leg `k` joins anchor k and k+1 of [from, wp0, …, wp(n-1), to]. The leg's start
    // anchor is `from` when k===0 else wp(k-1); its end anchor is `to` when k===n
    // else wp(k). A flanking run exists only on a side whose boundary is a waypoint.
    const k = legIndex;
    const n = wps.length;
    // Left run: from `from` up to (and terminating at) a free junction at wp(k-1).
    if (k > 0) {
      const jl = this.addJunction(wps[k - 1]!, true);
      const leftWps = wps.slice(0, k - 1); // bends strictly before the cut
      const left: Wire = {
        id: this.nextWireId++,
        from: { ...w.from },
        to: { junctionId: jl.id },
        ...(leftWps.length > 0 ? { waypoints: leftWps } : {}),
      };
      this.wires.set(left.id, left);
    }
    // Right run: from a free junction at wp(k) through the later bends to `to`.
    if (k < n) {
      const jr = this.addJunction(wps[k]!, true);
      const rightWps = wps.slice(k + 1); // bends strictly after the cut
      const right: Wire = {
        id: this.nextWireId++,
        from: { junctionId: jr.id },
        to: { ...w.to },
        ...(rightWps.length > 0 ? { waypoints: rightWps } : {}),
      };
      this.wires.set(right.id, right);
    }
    // Original gone last so a shared kept-side endpoint keeps its incidence
    // throughout. removeWire prunes, but the new cut junctions are `free`, so they
    // (and their flanking runs) stay; an endpoint that lost its only wire collapses
    // exactly as a normal delete would.
    this.removeWire(wireId);
  }

  /**
   * Remove junctions that no longer earn their keep. A junction needs at least
   * two incident wire-ends to tie nets together; with one it is a dangling stub
   * (drop the junction and that lone wire), with none just drop the junction.
   * Looped because deleting a stub wire can in turn strand another junction.
   */
  pruneJunctions(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const j of [...this.junctions.values()]) {
        const incident: Wire[] = [];
        for (const w of this.wires.values()) {
          if (junctionTouches(w.from, j.id) || junctionTouches(w.to, j.id)) {
            incident.push(w);
          }
        }
        // A junction carrying a net label earns its keep even with <2 wires: the
        // label is a real connection point (it can alias to another net by name).
        if (this.junctionHasLabel(j.id)) continue;
        // A deliberate free wire-end (e.g. a segment-delete cut) also stays while it
        // still terminates a wire; only once its wire is gone (incidence 0) does it
        // collapse like any other orphan.
        if (j.free && incident.length >= 1) continue;
        if (incident.length >= 2) continue;
        if (incident.length === 1) {
          // Lone wire ending on the junction is pointless — drop it too.
          this.wires.delete(incident[0]!.id);
        }
        this.junctions.delete(j.id);
        changed = true;
      }
    }
  }

  /** Delete a junction outright, severing every wire that ends on it. */
  removeJunction(id: number): void {
    if (!this.junctions.delete(id)) return;
    for (const [wid, w] of this.wires) {
      if (junctionTouches(w.from, id) || junctionTouches(w.to, id)) {
        this.wires.delete(wid);
      }
    }
    // Drop any net labels pinned to this junction — their anchor is gone.
    for (const [lid, l] of this.netLabels) {
      if (junctionTouches(l.at, id)) this.netLabels.delete(lid);
    }
    this.pruneJunctions();
  }

  /** True if any net label is attached to the given junction. */
  private junctionHasLabel(junctionId: number): boolean {
    for (const l of this.netLabels.values()) {
      if (junctionTouches(l.at, junctionId)) return true;
    }
    return false;
  }

  /**
   * Attach a net label with `name` at an endpoint (a pin or a junction). Rejects a
   * stale endpoint, an empty name, or a duplicate label already on that exact
   * endpoint (one label per point). Returns the new label, or undefined.
   */
  addNetLabel(at: Endpoint, name: string, pos?: Cell): NetLabel | undefined {
    const n = name.trim();
    if (!n) return undefined;
    if (!this.endpointExists(at)) return undefined;
    const atKey = endpointKey(at);
    for (const l of this.netLabels.values()) {
      if (endpointKey(l.at) === atKey) return undefined;
    }
    const label: NetLabel = {
      id: this.nextNetLabelId++,
      name: n,
      at: { ...at },
      ...(pos ? { pos: { ...pos } } : {}),
    };
    this.netLabels.set(label.id, label);
    return label;
  }

  /**
   * Move a net label's tag pill to a world-px offset from its anchor (KiCad-style:
   * the dot + leader stay pinned to what the label names; only the pill moves). A
   * (near-)default offset clears the override so it snaps back to the tidy default.
   */
  moveNetLabel(id: number, dx: number, dy: number): void {
    const l = this.netLabels.get(id);
    if (!l) return;
    if (Math.abs(dx - 12) < 4 && Math.abs(dy + 18) < 4) delete l.tagOff;
    else l.tagOff = { dx, dy };
  }

  /**
   * Rename a net label. An empty name removes it (an unnamed label means nothing,
   * and clears the alias). Removing may strand a label-only junction, so prune.
   */
  renameNetLabel(id: number, name: string): void {
    const l = this.netLabels.get(id);
    if (!l) return;
    const n = name.trim();
    if (!n) {
      this.removeNetLabel(id);
      return;
    }
    l.name = n;
  }

  /** Remove a net label, then tidy any junction it was the sole reason to keep. */
  removeNetLabel(id: number): void {
    if (!this.netLabels.delete(id)) return;
    this.pruneJunctions();
  }

  /** The net label (if any) attached to a given endpoint, in label-id order. */
  netLabelAt(at: Endpoint): NetLabel | undefined {
    const atKey = endpointKey(at);
    const sorted = [...this.netLabels.values()].sort((p, q) => p.id - q.id);
    for (const l of sorted) {
      if (endpointKey(l.at) === atKey) return l;
    }
    return undefined;
  }

  clear(): void {
    this.components.clear();
    this.wires.clear();
    this.junctions.clear();
    this.netLabels.clear();
    this.nextComponentId = 1;
    this.nextWireId = 1;
    this.nextJunctionId = 1;
    this.nextNetLabelId = 1;
  }

  /** Deep-copy the whole graph (for the undo stack). */
  serialize(): GraphSnapshot {
    return {
      components: [...this.components.values()].map((c) => ({
        ...c,
        cell: { ...c.cell },
      })),
      wires: [...this.wires.values()].map((w) => ({
        id: w.id,
        from: { ...w.from },
        to: { ...w.to },
        ...(w.waypoints && w.waypoints.length > 0
          ? { waypoints: w.waypoints.map((c) => ({ ...c })) }
          : {}),
      })),
      junctions: [...this.junctions.values()].map((j) => ({
        id: j.id,
        cell: { ...j.cell },
        ...(j.free ? { free: true } : {}),
      })),
      netLabels: [...this.netLabels.values()].map((l) => ({
        id: l.id,
        name: l.name,
        at: { ...l.at },
        ...(l.pos ? { pos: { ...l.pos } } : {}),
        ...(l.tagOff ? { tagOff: { ...l.tagOff } } : {}),
      })),
      nextComponentId: this.nextComponentId,
      nextWireId: this.nextWireId,
      nextJunctionId: this.nextJunctionId,
      nextNetLabelId: this.nextNetLabelId,
    };
  }

  /** Replace the graph contents from a serialized snapshot. */
  restore(s: GraphSnapshot): void {
    this.components.clear();
    this.wires.clear();
    this.junctions.clear();
    this.netLabels.clear();
    for (const c of s.components) {
      this.components.set(c.id, { ...c, cell: { ...c.cell } });
    }
    for (const j of s.junctions ?? []) {
      this.junctions.set(j.id, {
        id: j.id,
        cell: { ...j.cell },
        ...(j.free ? { free: true } : {}),
      });
    }
    // Net labels are absent in older snapshots (treated as none), exactly like
    // the junction legacy handling above.
    for (const l of s.netLabels ?? []) {
      this.netLabels.set(l.id, {
        id: l.id,
        name: l.name,
        at: { ...l.at },
        ...(l.pos ? { pos: { ...l.pos } } : {}),
        ...(l.tagOff ? { tagOff: { ...l.tagOff } } : {}),
      });
    }
    for (const w of s.wires) {
      // Tolerate legacy snapshots: a wire may carry the new ordered `waypoints`
      // array OR an old single `mid` (fold that lone bend into a 1-element array).
      const wps =
        w.waypoints && w.waypoints.length > 0
          ? w.waypoints.map((c) => ({ ...c }))
          : w.mid
            ? [{ ...w.mid }]
            : [];
      this.wires.set(w.id, {
        id: w.id,
        from: { ...w.from },
        to: { ...w.to },
        ...(wps.length > 0 ? { waypoints: wps } : {}),
      });
    }
    this.nextComponentId = s.nextComponentId;
    this.nextWireId = s.nextWireId;
    // Older snapshots carry no junction counter; derive a safe next id.
    this.nextJunctionId =
      s.nextJunctionId ??
      [...this.junctions.keys()].reduce((m, id) => Math.max(m, id + 1), 1);
    // Likewise for net labels — derive a safe next id from the restored labels.
    this.nextNetLabelId =
      s.nextNetLabelId ??
      [...this.netLabels.keys()].reduce((m, id) => Math.max(m, id + 1), 1);
  }
}

function samePin(a: PinRef, b: PinRef): boolean {
  return a.componentId === b.componentId && a.pinIndex === b.pinIndex;
}

/** True if `e` is a pin endpoint on the given component. */
function endpointHasComponent(e: Endpoint, componentId: number): boolean {
  return isPinRef(e) && e.componentId === componentId;
}

/** True if `e` is the given junction's endpoint. */
function junctionTouches(e: Endpoint, junctionId: number): boolean {
  return isJunctionRef(e) && e.junctionId === junctionId;
}

/**
 * Where to cut a wire's ordered waypoint list when it is split at grid cell
 * `cell`. The route runs `from(a) → wp[0] → … → wp[n-1] → to(b)`; `cell` lies on
 * one of those legs. Returns the split index `k` so `wp[0..k)` re-home to the
 * first half (from→J) and `wp[k..n)` to the second (J→to). A leg is identified by
 * the bounding-box test (each leg is one orthogonal segment), scanning in route
 * order so the first containing leg wins. Falls back to the nearest waypoint by
 * Manhattan distance if no leg's box contains `cell` (e.g. an off-route split).
 */
function waypointSplitIndex(wps: Cell[], a: Cell, b: Cell, cell: Cell): number {
  const seq = [a, ...wps, b];
  for (let i = 0; i + 1 < seq.length; i++) {
    if (manhattanOnLeg(cell, seq[i]!, seq[i + 1]!)) return i;
  }
  // No leg box contained the cell: split before the closest waypoint so the
  // halves stay balanced rather than dumping every bend onto one side.
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < wps.length; i++) {
    const d =
      Math.abs(wps[i]!.col - cell.col) + Math.abs(wps[i]!.row - cell.row);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Is grid point `p` on the orthogonal L-route between `a` and `b`? The auto
 * route bends once, so `p` lies on it iff it shares a row or column with both
 * within the bounding box — a cheap test used to keep a split wire's waypoints on
 * the correct half.
 */
function manhattanOnLeg(p: Cell, a: Cell, b: Cell): boolean {
  const inX =
    p.col >= Math.min(a.col, b.col) && p.col <= Math.max(a.col, b.col);
  const inY =
    p.row >= Math.min(a.row, b.row) && p.row <= Math.max(a.row, b.row);
  return inX && inY;
}

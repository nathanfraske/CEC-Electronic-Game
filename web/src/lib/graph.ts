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
  /** Ideal value (volts / ohms / farads / henries). */
  value: number;
  /** Orientation in 90° clockwise steps (0..3). */
  rot: number;
}

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
  nextComponentId: number;
  nextWireId: number;
  /** Next junction id. Absent in older snapshots (rederived from junctions). */
  nextJunctionId?: number;
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
  R: kind("R", "Resistor", "bronze", twoPin("A", "B"), 1000, "Ω", true),
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
  // Clock-driven (PWM) switch; `value` is the duty cycle in [0,1].
  SW: kind("SW", "Switch", "ok", twoPin("A", "B"), 0.5, "", true),
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
  Q: kind(
    "Q",
    "NPN Transistor",
    "accent",
    [pin("B", 0, 1), pin("C", 2, 0), pin("E", 2, 2)],
    0,
    "",
    false,
  ),
  "&": kind(
    "&",
    "Logic Gate",
    "ok",
    [pin("A", 0, 0), pin("B", 0, 2), pin("Y", 2, 1)],
    0,
    "",
    false,
  ),
  FF: kind(
    "FF",
    "D Flip-Flop",
    "cyan",
    [pin("D", 0, 0), pin("CLK", 0, 2), pin("Q", 2, 0), pin("Q̅", 2, 2)],
    0,
    "",
    false,
  ),
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
      return s.replace(/\.?0+$/, "") + " " + p + unit;
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
  readonly components = new Map<number, Component>();
  readonly wires = new Map<number, Wire>();
  readonly junctions = new Map<number, Junction>();

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

  /** Create a free junction at a grid cell and return it. */
  addJunction(cell: Cell): Junction {
    const j: Junction = { id: this.nextJunctionId++, cell: { ...cell } };
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
    this.pruneJunctions();
  }

  clear(): void {
    this.components.clear();
    this.wires.clear();
    this.junctions.clear();
    this.nextComponentId = 1;
    this.nextWireId = 1;
    this.nextJunctionId = 1;
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
      })),
      nextComponentId: this.nextComponentId,
      nextWireId: this.nextWireId,
      nextJunctionId: this.nextJunctionId,
    };
  }

  /** Replace the graph contents from a serialized snapshot. */
  restore(s: GraphSnapshot): void {
    this.components.clear();
    this.wires.clear();
    this.junctions.clear();
    for (const c of s.components) {
      this.components.set(c.id, { ...c, cell: { ...c.cell } });
    }
    for (const j of s.junctions ?? []) {
      this.junctions.set(j.id, { id: j.id, cell: { ...j.cell } });
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

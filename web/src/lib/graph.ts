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

/** A wire joins two pins. Wires are the edges; connected wires form a net. */
export interface Wire {
  id: number;
  from: PinRef;
  to: PinRef;
  /**
   * Optional manual routing waypoint (a grid cell the orthogonal route bends
   * through). Set by dragging the wire; absent means the auto L-route is used.
   * Purely cosmetic — it never affects connectivity or the solver netlist.
   */
  mid?: Cell;
}

/** A serialized copy of the whole graph, used for undo/redo. */
export interface GraphSnapshot {
  components: Component[];
  wires: Wire[];
  nextComponentId: number;
  nextWireId: number;
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
  R: kind("R", "Resistor", "bronze", twoPin("A", "B"), 1000, "Ω", true),
  C: kind("C", "Capacitor", "cyan", twoPin("+", "−"), 1e-6, "F", true),
  L: kind("L", "Inductor", "violet", twoPin("A", "B"), 1e-3, "H", true),
  // Ideal DC current source: arrow points a -> b, default 10 mA. Its dual is V.
  I: kind("I", "Current Source", "warn", twoPin("A", "B"), 1e-2, "A", true),
  // Explicit ground reference: a single pin whose net becomes node 0. Not a
  // solver element (1 pin, absent from TYPE_OF) — it only anchors the reference.
  GND: kind("GND", "Ground", "dim", onePin("⏚"), 0, "", true),
  D: kind("D", "Diode", "warn", twoPin("A", "K"), 0, "", false),
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
  readonly components = new Map<number, Component>();
  readonly wires = new Map<number, Wire>();

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

  /** Remove a component and any wires touching its pins. */
  removeComponent(id: number): void {
    this.components.delete(id);
    for (const [wid, w] of this.wires) {
      if (w.from.componentId === id || w.to.componentId === id) {
        this.wires.delete(wid);
      }
    }
  }

  /** Resolve the part template for a placed component. */
  kindOf(component: Component): PartKind | undefined {
    return PART_KINDS[component.kind];
  }

  /** Add a wire between two distinct pins; rejects self- and duplicate links. */
  connect(from: PinRef, to: PinRef): Wire | undefined {
    if (samePin(from, to)) return undefined;
    if (!this.components.has(from.componentId)) return undefined;
    if (!this.components.has(to.componentId)) return undefined;
    for (const w of this.wires.values()) {
      if (
        (samePin(w.from, from) && samePin(w.to, to)) ||
        (samePin(w.from, to) && samePin(w.to, from))
      ) {
        return undefined;
      }
    }
    const wire: Wire = { id: this.nextWireId++, from, to };
    this.wires.set(wire.id, wire);
    return wire;
  }

  removeWire(id: number): void {
    this.wires.delete(id);
  }

  /** Set/update a wire's manual routing waypoint (the grid cell it bends through). */
  setWireMid(id: number, cell: Cell): void {
    const w = this.wires.get(id);
    if (w) w.mid = { ...cell };
  }

  /** Drop a wire's manual waypoint, returning it to the auto orthogonal route. */
  clearWireMid(id: number): void {
    const w = this.wires.get(id);
    if (w) delete w.mid;
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

  clear(): void {
    this.components.clear();
    this.wires.clear();
    this.nextComponentId = 1;
    this.nextWireId = 1;
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
        ...(w.mid ? { mid: { ...w.mid } } : {}),
      })),
      nextComponentId: this.nextComponentId,
      nextWireId: this.nextWireId,
    };
  }

  /** Replace the graph contents from a serialized snapshot. */
  restore(s: GraphSnapshot): void {
    this.components.clear();
    this.wires.clear();
    for (const c of s.components) {
      this.components.set(c.id, { ...c, cell: { ...c.cell } });
    }
    for (const w of s.wires) {
      this.wires.set(w.id, {
        id: w.id,
        from: { ...w.from },
        to: { ...w.to },
        ...(w.mid ? { mid: { ...w.mid } } : {}),
      });
    }
    this.nextComponentId = s.nextComponentId;
    this.nextWireId = s.nextWireId;
  }
}

function samePin(a: PinRef, b: PinRef): boolean {
  return a.componentId === b.componentId && a.pinIndex === b.pinIndex;
}

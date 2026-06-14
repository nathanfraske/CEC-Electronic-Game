// SPDX-License-Identifier: Apache-2.0
// Board model: the pure data layer for the interactive board (M1). Holds placed
// components, their pins, and the wires that join pins into nets. No PixiJS or
// DOM here — this is presentation-free state so the renderer and the (future)
// simulation engine can both read it. Grid snapping and the CEC palette mirror
// live here as plain values for the GPU layer.

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
}

/** A placed component instance on the board. */
export interface Component {
  id: number;
  /** The kind tag this instance was placed from (keys into {@link PART_KINDS}). */
  kind: string;
  /** Anchor cell (top-left of footprint) after snapping. */
  cell: Cell;
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
 */
export const PART_KINDS: Record<string, PartKind> = {
  R: kind("R", "Resistor", "bronze", twoPin("A", "B")),
  C: kind("C", "Capacitor", "cyan", twoPin("+", "−")),
  L: kind("L", "Inductor", "violet", twoPin("A", "B")),
  D: kind("D", "Diode", "warn", twoPin("A", "K")),
  Q: kind("Q", "NPN Transistor", "accent", [
    pin("B", 0, 1),
    pin("C", 2, 0),
    pin("E", 2, 2),
  ]),
  "&": kind("&", "Logic Gate", "ok", [
    pin("A", 0, 0),
    pin("B", 0, 2),
    pin("Y", 2, 1),
  ]),
  FF: kind("FF", "D Flip-Flop", "cyan", [
    pin("D", 0, 0),
    pin("CLK", 0, 2),
    pin("Q", 2, 0),
    pin("Q̅", 2, 2),
  ]),
  FP: kind("FP", "FPGA Fabric", "violet", [
    pin("0", 0, 0),
    pin("1", 0, 2),
    pin("2", 2, 0),
    pin("3", 2, 2),
  ]),
  uC: kind("uC", "Microcontroller", "accent", [
    pin("RX", 0, 0),
    pin("TX", 0, 2),
    pin("IO", 2, 0),
    pin("CLK", 2, 2),
  ]),
};

function pin(label: string, dx: number, dy: number): Pin {
  return { index: 0, label, dx, dy };
}

function twoPin(a: string, b: string): Pin[] {
  return [pin(a, 0, 0), pin(b, 2, 0)];
}

function kind(
  tag: string,
  name: string,
  colorKey: PaletteKey,
  pins: Pin[],
): PartKind {
  // Re-index pins so each carries its own ordinal, and derive the footprint
  // from the furthest pin offset (+1 cell of slack on each axis).
  const indexed = pins.map((p, i) => ({ ...p, index: i }));
  const w = indexed.reduce((m, p) => Math.max(m, p.dx), 0) + 1;
  const h = indexed.reduce((m, p) => Math.max(m, p.dy), 0) + 1;
  return { tag, name, colorKey, pins: indexed, w, h };
}

/** Snap a continuous coordinate to the nearest cell index for the given pitch. */
export function snap(value: number, pitch: number): number {
  return Math.round(value / pitch);
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
    if (!(kind in PART_KINDS)) return undefined;
    const component: Component = { id: this.nextComponentId++, kind, cell };
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

  /** Absolute cell of a pin (anchor + pin offset). */
  pinCell(component: Component, pin: Pin): Cell {
    return {
      col: component.cell.col + pin.dx,
      row: component.cell.row + pin.dy,
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
}

function samePin(a: PinRef, b: PinRef): boolean {
  return a.componentId === b.componentId && a.pinIndex === b.pinIndex;
}

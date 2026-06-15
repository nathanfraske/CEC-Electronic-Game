// SPDX-License-Identifier: Apache-2.0
// PixiJS board renderer + interaction. A transformable `world` container holds
// the grid, wires, components and selection (so the view can zoom and pan); a
// screen-space overlay holds the scope. It owns place / wire / move / select /
// delete / undo, all inside the canvas Svelte owns — it never appends DOM
// nodes. Presentation + input only: it reads simulation snapshots and mutates
// the BoardGraph, but never drives the core.

import {
  Application,
  Container,
  Graphics,
  Text,
  Rectangle,
  Point,
  type FederatedPointerEvent,
} from "pixi.js";
import type { Snapshot } from "../sim/loop";
import {
  BoardGraph,
  PALETTE,
  snap,
  formatValue,
  rotateOffset,
  type Component,
  type PinRef,
  type Cell,
  type Wire,
  type GraphSnapshot,
} from "./graph";
import {
  drawGlyph,
  isSymbol,
  ZERO_ELECTRICAL,
  type ElectricalState,
} from "./glyphs";

/** Interaction modes surfaced as a toolbar in the HUD. */
export type Mode = "select" | "place" | "wire" | "measure";

/** A multimeter lead anchored to a pin (which it follows) or a point on a net. */
interface ProbePoint {
  node: number;
  x: number;
  y: number;
  ref: PinRef | null;
}

/** Grid pitch in pixels — the cell size everything snaps to. */
const PITCH = 26;
const PIN_R = 4.5;
const MAX_SAMPLES = 240;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3.5;
const UNDO_LIMIT = 60;
/**
 * Flow-phase advance per simulated tick. Ties the current arrows/dots to the
 * timeline: forward when the tick advances (running or scrubbing forward),
 * reverse when stepping/scrubbing back. Small so a single tick is a gentle nudge
 * while a full scrub reads as fast flow.
 */
const TICK_FLOW = 0.006;
/**
 * Base Text resolution (device pixels per CSS pixel). Floored at 2 so labels are
 * supersampled and stay sharp even on 1x displays, capped at 3 to bound texture
 * size. The zoom factor multiplies this for crisp text when zoomed in.
 */
const DPR = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
/** Cap on Text resolution once multiplied by zoom, to bound texture size. */
const MAX_TEXT_RES = 4;

// Multimeter lead colours: red "+" and steel "−", like a real DMM.
const PROBE_PLUS = 0xe0533a;
const PROBE_MINUS = 0x7c90a4;

/** Trace palette for the scope widget; cycled over a variable-length state. */
const CHANNEL_COLORS = [
  PALETTE.accent,
  PALETTE.cyan,
  PALETTE.violet,
  PALETTE.ok,
  PALETTE.warn,
  PALETTE.bronze,
];

/** The lone selected component, surfaced so the HUD can show a value inspector. */
export interface SelectedPart {
  id: number;
  kind: string;
  value: number;
}

export interface BoardCallbacks {
  /** Fired after the model changes so the HUD can reflect counts, etc. */
  onChange?: (graph: BoardGraph) => void;
  /** Fired when the selection changes; `single` is set iff exactly one part (and
   * no wires) is selected, so an inspector can edit its value. */
  onSelect?: (sel: {
    components: number;
    wires: number;
    single?: SelectedPart;
  }) => void;
  /** Fired when the board itself changes the armed part (e.g. right-click disarm). */
  onArm?: (kind: string | null) => void;
}

export class Board {
  private readonly world = new Container();
  private readonly grid = new Graphics();
  private readonly wireLayer = new Graphics();
  private readonly groundLayer = new Graphics();
  private readonly groundLabels: Text[] = [];
  private readonly selectionLayer = new Graphics();
  private readonly pendingWire = new Graphics();
  private readonly componentLayer = new Container();
  private readonly probeLayer = new Graphics();
  private readonly probeText = new Text({
    text: "",
    style: {
      fill: PALETTE.accent,
      fontFamily: "IBM Plex Mono, monospace",
      fontSize: 12,
      fontWeight: "600",
    },
  });
  private readonly scope = new Container();
  private readonly scopeTraces = new Graphics();
  private readonly scopeFrame = new Graphics();
  private readonly scopeLabels: Text[] = [];
  private readonly scopeLegend: Text[] = [];

  private readonly graph = new BoardGraph();
  private readonly nodes = new Map<number, ComponentNode>();
  private readonly selected = new Set<number>();
  private readonly selectedWires = new Set<number>();
  // Per-tick scope history (one entry per simulated tick, not per render frame)
  // so the scope freezes when paused and aligns to the timeline.
  private scopeSamples: { tick: number; values: number[] }[] = [];
  private scopeCursor = 0;
  // Per-node scope controls, driven from the telemetry panel: custom names,
  // hidden traces, and an enlarged scope.
  private readonly nodeLabels = new Map<number, string>();
  private readonly nodeHidden = new Set<number>();
  private scopeExpanded = false;

  private w = 0;
  private h = 0;
  private mode: Mode = "select";
  // The armed part kind: while set, clicking an empty cell drops it (place-and-
  // repeat). The mode buttons are gone; this is the "Place mode" replacement.
  private armed: string | null = null;
  private viewportDirty = true;
  // `phase` is the effective animation phase used by every drawer; `realPhase`
  // is the wall-clock part that only advances while running. The simulated tick
  // contributes the timeline-tracking part (see `update`).
  private phase = 0;
  private realPhase = 0;
  private lastTime = 0;
  private textRes = DPR;

  // Interaction state.
  private dragging: {
    ids: number[];
    grab: Cell;
    origins: Map<number, Cell>;
    moved: boolean;
  } | null = null;
  private wiring: { from: PinRef } | null = null;
  // Dragging an existing wire to reshape its route (creates/moves its waypoint).
  private wireDrag: { id: number; grab: Cell; moved: boolean } | null = null;
  private panning: { lastX: number; lastY: number } | null = null;
  private pendingUndo: GraphSnapshot | null = null;
  private pointer = new Point(0, 0);
  private readonly undoStack: GraphSnapshot[] = [];

  // Probe (measure mode): two draggable DMM leads that snap to a pin or trace.
  private probeA: ProbePoint | null = null;
  private probeB: ProbePoint | null = null;
  private draggingProbe: "A" | "B" | null = null;
  private probeNodes: Map<number, [number, number]> | null = null;
  private lastState: Float64Array = new Float64Array();
  private electrical: Map<number, ElectricalState> | undefined;

  constructor(
    private readonly app: Application,
    private readonly cb: BoardCallbacks = {},
  ) {
    this.world.addChild(this.grid);
    this.world.addChild(this.wireLayer);
    this.world.addChild(this.groundLayer);
    this.world.addChild(this.selectionLayer);
    this.world.addChild(this.componentLayer);
    this.world.addChild(this.pendingWire);
    this.world.addChild(this.probeLayer);
    this.world.addChild(this.probeText);
    this.probeText.anchor.set(0.5);
    this.probeText.resolution = DPR;
    this.probeText.visible = false;
    for (let i = 0; i < 4; i++) {
      const t = new Text({
        text: "",
        style: {
          fill: 0x9c93b8,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 9,
        },
      });
      t.anchor.set(0.5, 0);
      t.resolution = DPR;
      t.visible = false;
      this.groundLabels.push(t);
      this.world.addChild(t);
    }
    app.stage.addChild(this.world);
    this.scope.addChild(this.scopeFrame);
    this.scope.addChild(this.scopeTraces);
    for (let i = 0; i < 4; i++) {
      const t = new Text({
        text: "",
        style: {
          fill: PALETTE.dim,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 9,
        },
      });
      t.resolution = DPR;
      t.visible = false;
      this.scopeLabels.push(t);
      this.scope.addChild(t);
    }
    for (let i = 0; i < 8; i++) {
      const t = new Text({
        text: "",
        style: {
          fill: PALETTE.dim,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 10,
          fontWeight: "600",
        },
      });
      t.resolution = DPR;
      t.visible = false;
      this.scopeLegend.push(t);
      this.scope.addChild(t);
    }
    app.stage.addChild(this.scope);

    app.stage.eventMode = "static";
    app.stage.hitArea = new Rectangle(
      0,
      0,
      app.screen.width,
      app.screen.height,
    );
    app.stage.on("pointerdown", this.onPointerDown);
    app.stage.on("pointermove", this.onPointerMove);
    app.stage.on("pointerup", this.onPointerUp);
    app.stage.on("pointerupoutside", this.onPointerUp);
    app.stage.on("rightdown", this.onRightDown);
    app.canvas.addEventListener("wheel", this.onWheel, { passive: false });

    this.drawGrid();
  }

  // --- public API ---------------------------------------------------------

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode !== "wire") this.cancelWiring();
    if (mode !== "measure") this.clearProbe();
    this.updateCursor();
  }

  /** Arm a part kind: clicking empty board cells now drops it (place-and-repeat). */
  setArmed(kind: string | null): void {
    this.armed = kind;
    this.updateCursor();
  }

  /** Esc: cancel an in-progress wire, otherwise clear the selection. */
  escape(): void {
    if (this.wiring) {
      this.cancelWiring();
      return;
    }
    this.clearSelection();
  }

  private updateCursor(): void {
    this.app.stage.cursor = this.armed
      ? "copy"
      : this.mode === "measure"
        ? "crosshair"
        : "default";
  }

  /** Supply the pin→net mapping so the probe can read net voltages. */
  setProbeNodes(map: Map<number, [number, number]> | null): void {
    this.probeNodes = map;
    this.clearProbe();
  }

  /** Rename a scope node; an empty name restores the default "Node i". */
  setNodeLabel(node: number, name: string): void {
    const n = name.trim();
    if (n) this.nodeLabels.set(node, n);
    else this.nodeLabels.delete(node);
  }

  /** Show or hide a node's scope trace (the value readout stays either way). */
  setNodeHidden(node: number, hidden: boolean): void {
    if (hidden) this.nodeHidden.add(node);
    else this.nodeHidden.delete(node);
  }

  /** Toggle the enlarged scope; returns the new expanded state. */
  toggleScopeExpanded(): boolean {
    this.scopeExpanded = !this.scopeExpanded;
    this.layoutScope();
    return this.scopeExpanded;
  }

  /** A node's display name: its custom label, or GND / "Node i" by default. */
  private nodeName(i: number): string {
    return this.nodeLabels.get(i) ?? (i === 0 ? "GND" : "Node " + i);
  }

  placeAt(
    kind: string,
    screenX: number,
    screenY: number,
  ): Component | undefined {
    return this.placeCell(kind, this.screenToCell(screenX, screenY));
  }

  /** Place a part at a grid cell, recording undo and refreshing the view. */
  private placeCell(kind: string, cell: Cell): Component | undefined {
    const before = this.graph.serialize();
    const c = this.graph.place(kind, cell);
    if (c) {
      this.pushUndo(before);
      this.addNode(c);
      this.redrawWires();
      this.cb.onChange?.(this.graph);
    }
    return c;
  }

  clear(): void {
    if (this.graph.components.size === 0 && this.graph.wires.size === 0) return;
    this.pushUndo(this.graph.serialize());
    this.graph.clear();
    this.rebuildNodes();
    this.clearSelection();
    this.redrawWires();
    this.cb.onChange?.(this.graph);
  }

  /** Delete the current selection (components + wires). */
  deleteSelection(): void {
    if (this.selected.size === 0 && this.selectedWires.size === 0) return;
    this.pushUndo(this.graph.serialize());
    for (const id of this.selected) this.graph.removeComponent(id);
    for (const id of this.selectedWires) this.graph.removeWire(id);
    this.rebuildNodes();
    this.clearSelection();
    this.redrawWires();
    this.cb.onChange?.(this.graph);
  }

  /** Rotate the selected components 90° clockwise (connectivity is unchanged). */
  rotateSelection(): void {
    if (this.selected.size === 0) return;
    this.pushUndo(this.graph.serialize());
    for (const id of this.selected) {
      const c = this.graph.components.get(id);
      if (c) c.rot = (c.rot + 1) % 4;
      this.nodes.get(id)?.reposition();
    }
    this.redrawWires();
    this.redrawSelection();
    this.cb.onChange?.(this.graph);
  }

  /**
   * Keyboard nudge: shift the selected components by whole cells (connectivity
   * unchanged, so the sim isn't reset). With nothing selected, pan the view so
   * the arrow keys always do something useful.
   */
  nudge(dc: number, dr: number): void {
    if (this.selected.size > 0) {
      this.pushUndo(this.graph.serialize());
      for (const id of this.selected) {
        const c = this.graph.components.get(id);
        if (!c) continue;
        this.graph.move(id, { col: c.cell.col + dc, row: c.cell.row + dr });
        this.nodes.get(id)?.reposition();
      }
      this.redrawWires();
      this.redrawSelection();
      this.cb.onChange?.(this.graph);
    } else {
      this.world.position.x -= dc * PITCH * this.world.scale.x;
      this.world.position.y -= dr * PITCH * this.world.scale.x;
      this.viewportDirty = true;
    }
  }

  /** Undo the last mutating action. */
  undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.graph.restore(snapshot);
    this.rebuildNodes();
    this.clearSelection();
    this.redrawWires();
    this.cb.onChange?.(this.graph);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Replace the whole board with a prebuilt graph (e.g. a worked example). */
  loadGraph(snapshot: GraphSnapshot): void {
    this.pushUndo(this.graph.serialize());
    this.graph.restore(snapshot);
    this.rebuildNodes();
    this.clearSelection();
    this.redrawWires();
    this.resetView();
    this.cb.onChange?.(this.graph);
  }

  /** Reset zoom and pan to the identity view. */
  resetView(): void {
    this.world.scale.set(1);
    this.world.position.set(0, 0);
    this.viewportDirty = true;
    this.applyTextRes();
  }

  /**
   * Once-per-frame snapshot read. Generalized to a variable-length state. The
   * optional `electrical` map carries per-component current/voltage from the
   * solver to drive the glyph animations (absent until the netlist is wired).
   */
  update(
    snap: Snapshot,
    electrical?: Map<number, ElectricalState>,
    running = true,
  ): void {
    const now = performance.now();
    const dt = this.lastTime ? Math.min(0.05, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    if (running) this.realPhase += dt;
    // Tie the flow phase to the simulated timeline so the arrows/dots track
    // delta-T: they advance as the tick advances (running OR scrubbing forward)
    // and run in reverse when stepping/scrubbing back. Real time keeps them alive
    // smoothly while running; when paused they move only with the timeline.
    this.phase = this.realPhase + Number(snap.tick) * TICK_FLOW;

    if (this.app.screen.width !== this.w || this.app.screen.height !== this.h) {
      this.viewportDirty = true;
      this.layoutScope();
      this.app.stage.hitArea = new Rectangle(
        0,
        0,
        this.app.screen.width,
        this.app.screen.height,
      );
    }
    if (this.viewportDirty) {
      this.drawGrid();
      this.viewportDirty = false;
    }

    this.lastState = snap.state;
    this.electrical = electrical;
    this.redrawWires();
    this.drawGround();
    for (const [id, node] of this.nodes) {
      node.update(
        electrical?.get(id) ?? ZERO_ELECTRICAL,
        this.phase,
        this.selected.has(id),
      );
    }

    this.recordScope(snap);
    this.drawScope();
    this.drawProbe();
  }

  destroy(): void {
    this.app.stage.off("pointerdown", this.onPointerDown);
    this.app.stage.off("pointermove", this.onPointerMove);
    this.app.stage.off("pointerup", this.onPointerUp);
    this.app.stage.off("pointerupoutside", this.onPointerUp);
    this.app.stage.off("rightdown", this.onRightDown);
    this.app.canvas.removeEventListener("wheel", this.onWheel);
    for (const node of this.nodes.values()) node.destroy();
    this.nodes.clear();
    this.world.destroy({ children: true });
    this.scope.destroy({ children: true });
  }

  // --- viewport -----------------------------------------------------------

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0012);
    const cur = this.world.scale.x;
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cur * factor));
    // Keep the world point under the cursor fixed while zooming.
    const wx = (sx - this.world.position.x) / cur;
    const wy = (sy - this.world.position.y) / cur;
    this.world.scale.set(next);
    this.world.position.set(sx - next * wx, sy - next * wy);
    this.viewportDirty = true;
    this.applyTextRes();
  };

  /**
   * Keep world-space Text crisp: resolution = base DPR times the zoom (so text
   * re-rasterizes sharper as you zoom in), capped and quantized to avoid churn.
   * Screen-space scope labels keep the constant base resolution.
   */
  private applyTextRes(): void {
    const r = Math.min(MAX_TEXT_RES, DPR * Math.max(1, this.world.scale.x));
    const rounded = Math.round(r * 2) / 2; // 0.5 steps limit re-rasterization
    if (rounded === this.textRes) return;
    this.textRes = rounded;
    this.probeText.resolution = rounded;
    for (const t of this.groundLabels) t.resolution = rounded;
    for (const node of this.nodes.values()) node.setTextRes(rounded);
  }

  private screenToWorld(sx: number, sy: number): Point {
    const s = this.world.scale.x;
    return new Point(
      (sx - this.world.position.x) / s,
      (sy - this.world.position.y) / s,
    );
  }

  // --- geometry helpers ---------------------------------------------------

  private screenToCell(sx: number, sy: number): Cell {
    const w = this.screenToWorld(sx, sy);
    return { col: snap(w.x, PITCH), row: snap(w.y, PITCH) };
  }

  private cellToWorld(cell: Cell): Point {
    return new Point(cell.col * PITCH, cell.row * PITCH);
  }

  /** Bounding box of a placed component, in world coordinates. */
  private componentBox(c: Component): Rectangle {
    const kind = this.graph.kindOf(c);
    const o = this.cellToWorld(c.cell);
    // Single-pin parts (e.g. GND) draw their symbol around/below the lone pin and
    // are otherwise a tiny, fiddly target — give them a generous square grab box.
    if ((kind?.pins.length ?? 0) <= 1) {
      return new Rectangle(o.x - 18, o.y - 18, 36, 48);
    }
    let minx = 0;
    let miny = 0;
    let maxx = 0;
    let maxy = 0;
    for (const p of kind?.pins ?? []) {
      const r = rotateOffset(p.dx, p.dy, c.rot);
      minx = Math.min(minx, r.col);
      miny = Math.min(miny, r.row);
      maxx = Math.max(maxx, r.col);
      maxy = Math.max(maxy, r.row);
    }
    return new Rectangle(
      o.x + minx * PITCH - 14,
      o.y + miny * PITCH - 16,
      (maxx - minx) * PITCH + 28,
      (maxy - miny) * PITCH + 32,
    );
  }

  private pinHitTest(wx: number, wy: number): PinRef | null {
    const r2 = (PIN_R * 2.6) ** 2;
    let best: PinRef | null = null;
    let bestD = r2;
    for (const c of this.graph.components.values()) {
      const kind = this.graph.kindOf(c);
      if (!kind) continue;
      for (const p of kind.pins) {
        const pos = this.cellToWorld(this.graph.pinCell(c, p));
        const d = (pos.x - wx) ** 2 + (pos.y - wy) ** 2;
        if (d <= bestD) {
          bestD = d;
          best = { componentId: c.id, pinIndex: p.index };
        }
      }
    }
    return best;
  }

  private bodyHitTest(wx: number, wy: number): Component | null {
    let best: Component | null = null;
    for (const c of this.graph.components.values()) {
      const box = this.componentBox(c);
      if (box.contains(wx, wy)) best = c; // later components are on top
    }
    return best;
  }

  private wireHitTest(wx: number, wy: number): number | null {
    const tol = 7;
    let best: number | null = null;
    for (const w of this.graph.wires.values()) {
      const route = this.routeForWire(w);
      for (let i = 0; i + 1 < route.length; i++) {
        const p0 = route[i]!;
        const p1 = route[i + 1]!;
        if (distToSegment(wx, wy, p0.x, p0.y, p1.x, p1.y) <= tol) {
          best = w.id;
          break;
        }
      }
    }
    return best;
  }

  // --- selection ----------------------------------------------------------

  private clearSelection(): void {
    this.selected.clear();
    this.selectedWires.clear();
    this.redrawSelection();
    this.emitSelect();
  }

  private emitSelect(): void {
    let single: SelectedPart | undefined;
    if (this.selected.size === 1 && this.selectedWires.size === 0) {
      const id = [...this.selected][0]!;
      const c = this.graph.components.get(id);
      if (c) single = { id: c.id, kind: c.kind, value: c.value };
    }
    this.cb.onSelect?.({
      components: this.selected.size,
      wires: this.selectedWires.size,
      single,
    });
  }

  /** Set a placed component's value (from the inspector); rebuilds the netlist. */
  setComponentValue(id: number, value: number): void {
    const c = this.graph.components.get(id);
    if (!c || c.value === value) return;
    this.pushUndo(this.graph.serialize());
    c.value = value;
    this.nodes.get(id)?.setValue(value);
    this.cb.onChange?.(this.graph);
    this.emitSelect(); // refresh the inspector's displayed value
  }

  private selectComponent(id: number, additive: boolean): void {
    if (additive) {
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
    } else {
      this.selected.clear();
      this.selectedWires.clear();
      this.selected.add(id);
    }
    this.redrawSelection();
    this.emitSelect();
  }

  private selectWire(id: number, additive: boolean): void {
    if (additive) {
      if (this.selectedWires.has(id)) this.selectedWires.delete(id);
      else this.selectedWires.add(id);
    } else {
      this.selected.clear();
      this.selectedWires.clear();
      this.selectedWires.add(id);
    }
    this.redrawSelection();
    this.emitSelect();
  }

  private redrawSelection(): void {
    const g = this.selectionLayer;
    g.clear();
    for (const id of this.selected) {
      const c = this.graph.components.get(id);
      if (!c) continue;
      const box = this.componentBox(c);
      g.roundRect(box.x, box.y, box.width, box.height, 5);
      g.fill({ color: PALETTE.accent, alpha: 0.08 });
      g.roundRect(box.x, box.y, box.width, box.height, 5);
      g.stroke({ width: 1.5, color: PALETTE.accent, alpha: 0.9 });
    }
    for (const id of this.selectedWires) {
      const w = this.graph.wires.get(id);
      if (!w) continue;
      const route = this.routeForWire(w);
      if (route.length < 2) continue;
      polyline(g, route);
      g.stroke({ width: 5, color: PALETTE.accent, alpha: 0.5 });
      // A handle dot at the waypoint so it reads as draggable.
      if (w.mid) {
        const m = this.cellToWorld(w.mid);
        g.circle(m.x, m.y, 4).fill({ color: PALETTE.accent, alpha: 0.9 });
      }
    }
  }

  // --- probe (measure mode) -----------------------------------------------

  /** Press in measure mode: grab a nearby lead to drag, or drop the next lead. */
  private measurePress(wx: number, wy: number): boolean {
    const grab = this.probeLeadAt(wx, wy);
    if (grab) {
      this.draggingProbe = grab;
      return true;
    }
    const target = this.snapProbe(wx, wy);
    if (!target) return false;
    if (!this.probeA) this.probeA = target;
    else if (!this.probeB) this.probeB = target;
    else this.probeA = target;
    return true;
  }

  private clearProbe(): void {
    this.probeA = null;
    this.probeB = null;
    this.draggingProbe = null;
    this.probeLayer.clear();
    this.probeText.visible = false;
  }

  private nodeVoltage(node: number): number | null {
    if (node < 0 || node >= this.lastState.length) return null;
    return this.lastState[node] ?? 0;
  }

  private pinNode(ref: PinRef): number | null {
    const nodes = this.probeNodes?.get(ref.componentId);
    if (!nodes) return null;
    return nodes[ref.pinIndex] ?? null;
  }

  private pinVoltage(ref: PinRef): number | null {
    const node = this.pinNode(ref);
    return node === null ? null : this.nodeVoltage(node);
  }

  /** Snap a world point to the nearest pin or trace, resolving its net node. */
  private snapProbe(wx: number, wy: number): ProbePoint | null {
    const pin = this.pinHitTest(wx, wy);
    if (pin) {
      const cell = this.graph.pinRefCell(pin);
      const node = this.pinNode(pin);
      if (cell && node !== null) {
        const p = this.cellToWorld(cell);
        return { node, x: p.x, y: p.y, ref: pin };
      }
    }
    const wireId = this.wireHitTest(wx, wy);
    if (wireId !== null) {
      const w = this.graph.wires.get(wireId);
      const node = w ? this.pinNode(w.from) : null;
      const route = w ? this.routeForWire(w) : [];
      if (w && node !== null && route.length >= 2) {
        const cp = closestOnPolyline(route, wx, wy);
        return { node, x: cp.x, y: cp.y, ref: null };
      }
    }
    return null;
  }

  /** A lead's live position, following its pin if it is attached to one. */
  private leadPos(p: ProbePoint): { x: number; y: number; node: number } {
    if (p.ref) {
      const cell = this.graph.pinRefCell(p.ref);
      if (cell) {
        const w = this.cellToWorld(cell);
        return { x: w.x, y: w.y, node: this.pinNode(p.ref) ?? p.node };
      }
    }
    return { x: p.x, y: p.y, node: p.node };
  }

  private probeLeadAt(wx: number, wy: number): "A" | "B" | null {
    const r2 = 16 * 16;
    if (this.probeB) {
      const lp = this.leadPos(this.probeB);
      if ((lp.x - wx) ** 2 + (lp.y - wy) ** 2 <= r2) return "B";
    }
    if (this.probeA) {
      const lp = this.leadPos(this.probeA);
      if ((lp.x - wx) ** 2 + (lp.y - wy) ** 2 <= r2) return "A";
    }
    return null;
  }

  /** Draw one DMM lead: a wire to a handle knob, a metal needle tip, a ring. */
  private drawLead(x: number, y: number, color: number): void {
    const g = this.probeLayer;
    const hx = x - 18;
    const hy = y - 26;
    g.moveTo(hx, hy).lineTo(x, y);
    g.stroke({ width: 3.5, color: 0x141019, alpha: 0.9 });
    g.moveTo(hx, hy).lineTo(x, y);
    g.stroke({ width: 1.6, color, alpha: 0.95 });
    g.poly([x, y, x - 8, y - 10, x - 3, y - 12]).fill({ color: 0xcdd8e2 });
    g.circle(hx, hy, 4.5).fill({ color });
    g.circle(hx, hy, 4.5).stroke({ width: 1, color: 0x0d0b16, alpha: 0.7 });
    g.circle(x, y, PIN_R + 3).stroke({ width: 2, color });
  }

  private drawProbe(): void {
    const g = this.probeLayer;
    g.clear();
    if (this.mode !== "measure") {
      this.probeText.visible = false;
      return;
    }
    const a = this.probeA ? this.leadPos(this.probeA) : null;
    const b = this.probeB ? this.leadPos(this.probeB) : null;
    if (a) this.drawLead(a.x, a.y, PROBE_PLUS);
    if (b) this.drawLead(b.x, b.y, PROBE_MINUS);

    if (a && b) {
      const va = this.nodeVoltage(a.node) ?? 0;
      const vb = this.nodeVoltage(b.node) ?? 0;
      this.probeText.text = "ΔV " + fmtSI(va - vb, "V");
      this.probeText.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 - 16);
      this.probeText.visible = true;
    } else if (a) {
      const va = this.nodeVoltage(a.node);
      this.probeText.text =
        va === null ? "no reading" : fmtSI(va, "V") + " vs GND";
      this.probeText.position.set(a.x, a.y - 18);
      this.probeText.visible = true;
    } else {
      this.probeText.visible = false;
    }
  }

  // --- input handlers -----------------------------------------------------

  private readonly onPointerDown = (e: FederatedPointerEvent): void => {
    const wp = this.screenToWorld(e.global.x, e.global.y);
    this.pointer.copyFrom(wp);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    // Middle button always pans.
    if (e.button === 1) {
      this.panning = { lastX: e.global.x, lastY: e.global.y };
      return;
    }
    if (this.mode === "measure") {
      if (this.measurePress(wp.x, wp.y)) return;
      if (!additive) this.panning = { lastX: e.global.x, lastY: e.global.y };
      return;
    }

    const pin = this.pinHitTest(wp.x, wp.y);
    if (pin && (this.mode === "wire" || this.mode === "select")) {
      this.wiring = { from: pin };
      return;
    }

    const body = this.bodyHitTest(wp.x, wp.y);
    if (body) {
      if (additive) {
        this.selectComponent(body.id, true);
        return;
      }
      if (!this.selected.has(body.id)) this.selectComponent(body.id, false);
      this.beginDrag(body, wp);
      return;
    }

    const wireId = this.wireHitTest(wp.x, wp.y);
    if (wireId !== null) {
      this.selectWire(wireId, additive);
      // A non-additive press also arms a wire-drag, so dragging the belt bends
      // it through a waypoint (drag it back onto the straight line to undo).
      if (!additive) {
        this.wireDrag = {
          id: wireId,
          grab: { col: snap(wp.x, PITCH), row: snap(wp.y, PITCH) },
          moved: false,
        };
        this.pendingUndo = this.graph.serialize();
      }
      return;
    }

    // Empty space. With a part armed, drop it here and stay armed — Factorio-style
    // place-and-repeat. Otherwise clear the selection and begin a pan.
    if (this.armed && !additive) {
      this.placeCell(this.armed, {
        col: snap(wp.x, PITCH),
        row: snap(wp.y, PITCH),
      });
      return;
    }
    if (!additive) this.clearSelection();
    this.panning = { lastX: e.global.x, lastY: e.global.y };
  };

  private beginDrag(body: Component, wp: Point): void {
    const ids = this.selected.has(body.id) ? [...this.selected] : [body.id];
    const origins = new Map<number, Cell>();
    for (const id of ids) {
      const c = this.graph.components.get(id);
      if (c) origins.set(id, { ...c.cell });
    }
    this.dragging = {
      ids,
      grab: { col: snap(wp.x, PITCH), row: snap(wp.y, PITCH) },
      origins,
      moved: false,
    };
    this.pendingUndo = this.graph.serialize();
  }

  private readonly onPointerMove = (e: FederatedPointerEvent): void => {
    const wp = this.screenToWorld(e.global.x, e.global.y);
    this.pointer.copyFrom(wp);

    if (this.draggingProbe) {
      const target = this.snapProbe(wp.x, wp.y) ?? {
        node: -1,
        x: wp.x,
        y: wp.y,
        ref: null,
      };
      if (this.draggingProbe === "A") this.probeA = target;
      else this.probeB = target;
      return;
    }

    if (this.wireDrag) {
      const cell = { col: snap(wp.x, PITCH), row: snap(wp.y, PITCH) };
      if (
        cell.col !== this.wireDrag.grab.col ||
        cell.row !== this.wireDrag.grab.row
      ) {
        this.wireDrag.moved = true;
      }
      if (this.wireDrag.moved) {
        this.graph.setWireMid(this.wireDrag.id, cell);
        this.redrawWires();
        this.redrawSelection();
      }
      return;
    }

    if (this.panning) {
      this.world.position.x += e.global.x - this.panning.lastX;
      this.world.position.y += e.global.y - this.panning.lastY;
      this.panning = { lastX: e.global.x, lastY: e.global.y };
      this.viewportDirty = true;
      this.drawGrid();
      this.viewportDirty = false;
      return;
    }

    if (this.dragging) {
      const cell = { col: snap(wp.x, PITCH), row: snap(wp.y, PITCH) };
      const dc = cell.col - this.dragging.grab.col;
      const dr = cell.row - this.dragging.grab.row;
      if (dc !== 0 || dr !== 0) this.dragging.moved = true;
      for (const id of this.dragging.ids) {
        const o = this.dragging.origins.get(id);
        if (!o) continue;
        this.graph.move(id, { col: o.col + dc, row: o.row + dr });
        this.nodes.get(id)?.reposition();
      }
      this.redrawWires();
      this.redrawSelection();
      return;
    }

    if (this.wiring) this.drawPendingWire();
  };

  private readonly onPointerUp = (e: FederatedPointerEvent): void => {
    if (this.draggingProbe) {
      this.draggingProbe = null;
      return;
    }
    if (this.wireDrag) {
      if (this.wireDrag.moved && this.pendingUndo) {
        // Dropping the waypoint back on the straight pin-to-pin line straightens it.
        const w = this.graph.wires.get(this.wireDrag.id);
        if (w && this.midIsRedundant(w)) this.graph.clearWireMid(w.id);
        this.commitUndo(this.pendingUndo);
        this.redrawWires();
        this.redrawSelection();
        this.cb.onChange?.(this.graph);
      }
      this.wireDrag = null;
      this.pendingUndo = null;
      return;
    }
    if (this.panning) {
      this.panning = null;
      return;
    }
    if (this.dragging) {
      if (this.dragging.moved && this.pendingUndo) {
        this.commitUndo(this.pendingUndo);
        this.cb.onChange?.(this.graph);
      }
      this.dragging = null;
      this.pendingUndo = null;
      return;
    }
    if (this.wiring) {
      const wp = this.screenToWorld(e.global.x, e.global.y);
      const target = this.pinHitTest(wp.x, wp.y);
      if (target) {
        const before = this.graph.serialize();
        const wire = this.graph.connect(this.wiring.from, target);
        if (wire) {
          this.pushUndo(before);
          this.redrawWires();
          this.cb.onChange?.(this.graph);
        }
      }
      this.cancelWiring();
    }
  };

  private readonly onRightDown = (e: FederatedPointerEvent): void => {
    e.preventDefault?.();
    // While a part is armed, right-click disarms instead of deleting.
    if (this.armed) {
      this.setArmed(null);
      this.cb.onArm?.(null);
      return;
    }
    const wp = this.screenToWorld(e.global.x, e.global.y);
    const wireId = this.wireHitTest(wp.x, wp.y);
    if (wireId !== null) {
      this.pushUndo(this.graph.serialize());
      this.graph.removeWire(wireId);
      this.selectedWires.delete(wireId);
      this.redrawWires();
      this.redrawSelection();
      this.cb.onChange?.(this.graph);
      return;
    }
    const body = this.bodyHitTest(wp.x, wp.y);
    if (body) {
      this.pushUndo(this.graph.serialize());
      this.graph.removeComponent(body.id);
      this.nodes.get(body.id)?.destroy();
      this.nodes.delete(body.id);
      this.selected.delete(body.id);
      this.redrawWires();
      this.redrawSelection();
      this.cb.onChange?.(this.graph);
    }
  };

  private cancelWiring(): void {
    this.wiring = null;
    this.pendingWire.clear();
  }

  // --- undo ---------------------------------------------------------------

  private pushUndo(before: GraphSnapshot): void {
    this.undoStack.push(before);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  private commitUndo(before: GraphSnapshot): void {
    this.pushUndo(before);
  }

  // --- drawing ------------------------------------------------------------

  private addNode(c: Component): void {
    const node = new ComponentNode(c, this.graph, () =>
      this.cellToWorld(c.cell),
    );
    node.setTextRes(this.textRes);
    this.nodes.set(c.id, node);
    this.componentLayer.addChild(node.view);
  }

  private rebuildNodes(): void {
    for (const node of this.nodes.values()) node.destroy();
    this.nodes.clear();
    for (const c of this.graph.components.values()) this.addNode(c);
  }

  /**
   * Orthogonal "belts": each trace routes at 90°, colours by its net voltage,
   * and carries the KCL branch current as thickness + flow chevrons whose
   * density + direction track that current — so a shared rail visibly thickens
   * toward a source and thins past each tap. Factorio belts, but electricity.
   * Redrawn every frame so it stays live.
   */
  private redrawWires(): void {
    const g = this.wireLayer;
    g.clear();
    const currents = this.computeWireCurrents();
    for (const w of this.graph.wires.values()) {
      const route = this.routeForWire(w);
      if (route.length < 2) continue;
      const v = this.pinVoltage(w.from);
      const color = v === null ? PALETTE.cyan : voltageColor(v);

      const cur = currents.get(w.id) ?? 0;
      const normC = saturate(Math.abs(cur) / 0.01);
      const width = 1.6 + 3.4 * normC; // thickness tracks the branch current
      polyline(g, route);
      g.stroke({ width: width + 4, color, alpha: 0.16 });
      polyline(g, route);
      g.stroke({ width, color, alpha: 0.95 });

      if (normC > 0.02) {
        // Density (how many chevrons) tracks the current; speed tracks voltage.
        const normV = saturate(Math.abs(v ?? 0) / 6);
        const len = routeLength(route);
        const spacing = 40 - 28 * normC;
        const n = Math.max(1, Math.floor(len / spacing));
        const dir = cur >= 0 ? 1 : -1;
        const speed = 0.08 + normV * 0.6;
        for (let i = 0; i < n; i++) {
          const t = (((i / n + this.phase * speed * dir) % 1) + 1) % 1;
          const s = sampleRoute(route, t);
          drawChevron(
            g,
            s.x,
            s.y,
            s.dx * dir,
            s.dy * dir,
            color,
            0.4 + 0.5 * normC,
          );
        }
      }
    }
  }

  /** A 90° (Manhattan) route between two pins: leave along the dominant axis. */
  private wireRoute(pa: Point, pb: Point): Point[] {
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    if (Math.abs(dx) < 1 || Math.abs(dy) < 1) return [pa, pb];
    if (Math.abs(dx) >= Math.abs(dy)) {
      const mx = pa.x + dx / 2;
      return [pa, new Point(mx, pa.y), new Point(mx, pb.y), pb];
    }
    const my = pa.y + dy / 2;
    return [pa, new Point(pa.x, my), new Point(pb.x, my), pb];
  }

  /**
   * The full orthogonal polyline for a wire: the auto L-route, or — if the wire
   * carries a manual waypoint — two orthogonal legs bending through it. Empty if
   * either endpoint has gone missing. This is the single source of wire geometry.
   */
  private routeForWire(w: Wire): Point[] {
    const a = this.graph.pinRefCell(w.from);
    const b = this.graph.pinRefCell(w.to);
    if (!a || !b) return [];
    const pa = this.cellToWorld(a);
    const pb = this.cellToWorld(b);
    if (!w.mid) return this.wireRoute(pa, pb);
    const pm = this.cellToWorld(w.mid);
    return [...this.wireRoute(pa, pm), ...this.wireRoute(pm, pb).slice(1)];
  }

  /** True if a wire's waypoint sits essentially on the straight pin-to-pin line. */
  private midIsRedundant(w: Wire): boolean {
    if (!w.mid) return false;
    const a = this.graph.pinRefCell(w.from);
    const b = this.graph.pinRefCell(w.to);
    if (!a || !b) return false;
    return (
      distToSegment(w.mid.col, w.mid.row, a.col, a.row, b.col, b.row) < 0.5
    );
  }

  /**
   * KCL-aware per-wire current. Each element injects its current into the net at
   * its two pins (−i at pin a, +i at pin b). Within a net the wires form a graph;
   * routing those injections along a spanning tree gives the true branch current
   * in every wire segment (it accumulates toward a source and splits at taps),
   * with cycle (redundant) wires left at 0. Render-only — never touches the sim.
   * Returns wireId → current oriented from→to.
   */
  private computeWireCurrents(): Map<number, number> {
    const out = new Map<number, number>();
    const wires = [...this.graph.wires.values()].sort((p, q) => p.id - q.id);
    for (const w of wires) out.set(w.id, 0);
    if (!this.electrical || wires.length === 0) return out;

    // Current each element pushes into the net at each pin (the "injection").
    const inj = new Map<string, number>();
    const bump = (k: string, v: number): void => {
      inj.set(k, (inj.get(k) ?? 0) + v);
    };
    for (const [compId, e] of this.electrical) {
      bump(compId + ":0", -e.current); // pin a: current leaves the net
      bump(compId + ":1", +e.current); // pin b: current enters the net
    }

    // Adjacency over pins, edges = wires (record from/to orientation per edge).
    interface Edge {
      other: string;
      wireId: number;
      otherIsFrom: boolean;
    }
    const adj = new Map<string, Edge[]>();
    const node = (k: string): Edge[] => {
      let l = adj.get(k);
      if (!l) {
        l = [];
        adj.set(k, l);
      }
      return l;
    };
    for (const k of inj.keys()) node(k);
    for (const w of wires) {
      const f = w.from.componentId + ":" + w.from.pinIndex;
      const t = w.to.componentId + ":" + w.to.pinIndex;
      node(f).push({ other: t, wireId: w.id, otherIsFrom: false });
      node(t).push({ other: f, wireId: w.id, otherIsFrom: true });
    }

    // Spanning forest by BFS; each tree edge carries the injection sum of the
    // subtree beyond it (oriented child → parent).
    const visited = new Set<string>();
    for (const root of [...adj.keys()].sort()) {
      if (visited.has(root)) continue;
      const order: string[] = [];
      const parent = new Map<
        string,
        { pin: string; wireId: number; childIsFrom: boolean }
      >();
      visited.add(root);
      const queue = [root];
      while (queue.length) {
        const u = queue.shift()!;
        order.push(u);
        for (const e of adj.get(u) ?? []) {
          if (visited.has(e.other)) continue;
          visited.add(e.other);
          // The child is e.other; otherIsFrom already says whether it is the
          // wire's "from" endpoint (used to map child→parent flow onto from→to).
          parent.set(e.other, {
            pin: u,
            wireId: e.wireId,
            childIsFrom: e.otherIsFrom,
          });
          queue.push(e.other);
        }
      }
      // Reverse-BFS (post-order): each node's subtree sum is final by the time we
      // reach it, so record its parent edge's current, then roll it up.
      const sub = new Map<string, number>();
      for (const u of order) sub.set(u, inj.get(u) ?? 0);
      for (let i = order.length - 1; i >= 0; i--) {
        const u = order[i]!;
        const p = parent.get(u);
        if (!p) continue;
        const s = sub.get(u)!;
        out.set(p.wireId, p.childIsFrom ? s : -s); // child→parent mapped to from→to
        sub.set(p.pin, (sub.get(p.pin) ?? 0) + s);
      }
    }
    return out;
  }

  /** Draw a schematic ground symbol + "GND 0 V" at every node-0 source pin. */
  private drawGround(): void {
    const g = this.groundLayer;
    g.clear();
    for (const t of this.groundLabels) t.visible = false;
    if (!this.probeNodes) return;
    let li = 0;
    for (const c of this.graph.components.values()) {
      if (c.kind !== "V") continue;
      const nodes = this.probeNodes.get(c.id);
      const kind = this.graph.kindOf(c);
      if (!nodes || !kind) continue;
      for (const p of kind.pins) {
        if (nodes[p.index] !== 0) continue;
        const pos = this.cellToWorld(this.graph.pinCell(c, p));
        this.drawGroundSymbol(g, pos.x, pos.y);
        const t = this.groundLabels[li];
        if (t) {
          li++;
          t.text = "GND 0 V";
          t.position.set(pos.x, pos.y + 26);
          t.visible = true;
        }
      }
    }
  }

  private drawGroundSymbol(g: Graphics, x: number, y: number): void {
    g.moveTo(x, y).lineTo(x, y + 10);
    const ws = [9, 6, 3];
    const ys = [14, 18, 22];
    for (let i = 0; i < 3; i++) {
      g.moveTo(x - ws[i]!, y + ys[i]!).lineTo(x + ws[i]!, y + ys[i]!);
    }
    g.stroke({ width: 2, color: 0x6b6488, alpha: 0.95 });
  }

  private drawPendingWire(): void {
    const g = this.pendingWire;
    g.clear();
    if (!this.wiring) return;
    const start = this.graph.pinRefCell(this.wiring.from);
    if (!start) return;
    const ps = this.cellToWorld(start);
    const snapTo = this.pinHitTest(this.pointer.x, this.pointer.y);
    const end = snapTo
      ? this.cellToWorld(this.graph.pinRefCell(snapTo) ?? start)
      : this.pointer;
    const route = this.wireRoute(ps, end);
    polyline(g, route);
    g.stroke({ width: 6, color: PALETTE.accent, alpha: 0.16 });
    polyline(g, route);
    g.stroke({ width: 1.6, color: PALETTE.accent, alpha: 0.9 });
    if (snapTo) {
      g.circle(end.x, end.y, PIN_R + 2).stroke({
        width: 1.5,
        color: PALETTE.accent,
        alpha: 0.9,
      });
    }
  }

  private drawGrid(): void {
    this.w = this.app.screen.width;
    this.h = this.app.screen.height;
    const g = this.grid;
    g.clear();
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(this.w, this.h);
    const x0 = Math.floor(tl.x / PITCH) * PITCH;
    const y0 = Math.floor(tl.y / PITCH) * PITCH;

    for (let x = x0; x <= br.x; x += PITCH) g.moveTo(x, tl.y).lineTo(x, br.y);
    for (let y = y0; y <= br.y; y += PITCH) g.moveTo(tl.x, y).lineTo(br.x, y);
    g.stroke({ width: 1 / this.world.scale.x, color: 0x2a2640, alpha: 0.35 });

    const major = PITCH * 4;
    const mx0 = Math.floor(tl.x / major) * major;
    const my0 = Math.floor(tl.y / major) * major;
    for (let x = mx0; x <= br.x; x += major) g.moveTo(x, tl.y).lineTo(x, br.y);
    for (let y = my0; y <= br.y; y += major) g.moveTo(tl.x, y).lineTo(br.x, y);
    g.stroke({
      width: 1 / this.world.scale.x,
      color: PALETTE.border,
      alpha: 0.5,
    });
  }

  // --- scope widget (screen-space overlay) --------------------------------

  /** Record one scope sample per advancing tick; track the displayed cursor. */
  private recordScope(snap: Snapshot): void {
    const tick = Number(snap.tick);
    const last = this.scopeSamples[this.scopeSamples.length - 1];
    if (!last || tick > last.tick) {
      this.scopeSamples.push({ tick, values: Array.from(snap.state) });
      if (this.scopeSamples.length > MAX_SAMPLES) this.scopeSamples.shift();
    } else if (last && tick < (this.scopeSamples[0]?.tick ?? 0)) {
      // Scrubbed before the retained window (or the run was reset): start over.
      this.scopeSamples = [{ tick, values: Array.from(snap.state) }];
    }
    let idx = this.scopeSamples.length - 1;
    for (let i = this.scopeSamples.length - 1; i >= 0; i--) {
      if (this.scopeSamples[i]!.tick <= tick) {
        idx = i;
        break;
      }
    }
    this.scopeCursor = idx;
  }

  private scopeRect(): Rectangle {
    const pad = 12;
    if (this.scopeExpanded) {
      const sw = Math.max(280, this.w * 0.6);
      const sh = Math.max(190, this.h * 0.62);
      return new Rectangle(this.w - sw - pad, this.h - sh - pad, sw, sh);
    }
    const sw = Math.min(320, Math.max(200, this.w * 0.36));
    const sh = Math.min(170, Math.max(104, this.h * 0.3));
    return new Rectangle(this.w - sw - pad, this.h - sh - pad, sw, sh);
  }

  private layoutScope(): void {
    const r = this.scopeRect();
    const g = this.scopeFrame;
    g.clear();
    g.roundRect(r.x, r.y, r.width, r.height, 3);
    g.fill({ color: 0x0d0b16, alpha: 0.8 });
    g.stroke({ width: 1, color: PALETTE.border, alpha: 0.85 });
  }

  private scopeLabel(i: number, text: string, x: number, y: number): void {
    const t = this.scopeLabels[i];
    if (!t) return;
    t.text = text;
    t.position.set(x, y);
    t.visible = true;
  }

  /** Scope: node voltages vs tick, numbered, frozen when paused, with a cursor. */
  private drawScope(): void {
    const r = this.scopeRect();
    const g = this.scopeTraces;
    g.clear();
    for (const t of this.scopeLabels) t.visible = false;
    for (const t of this.scopeLegend) t.visible = false;

    const samples = this.scopeSamples;
    if (samples.length < 2) return;

    const padL = 32;
    const padR = 8;
    const padT = 16;
    const padB = 14;
    const x0 = r.x + padL;
    const y0 = r.y + padT;
    const iw = r.width - padL - padR;
    const ih = r.height - padT - padB;

    const chans = samples[samples.length - 1]!.values.length;
    let lo = 0;
    let hi = 1;
    for (const s of samples) {
      for (let c = 1; c < s.values.length; c++) {
        if (this.nodeHidden.has(c)) continue; // autoscale to visible traces only
        const v = s.values[c] ?? 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const span = hi - lo || 1;
    const xAt = (i: number): number => x0 + (i / (MAX_SAMPLES - 1)) * iw;
    const yAt = (v: number): number => y0 + (1 - (v - lo) / span) * ih;

    if (lo < 0) {
      const yz = yAt(0);
      g.moveTo(x0, yz).lineTo(x0 + iw, yz);
      g.stroke({ width: 1, color: PALETTE.border, alpha: 0.4 });
    }

    // Channel traces (skip node 0, the flat ground reference, and hidden nodes).
    for (let c = 1; c < chans; c++) {
      if (this.nodeHidden.has(c)) continue;
      const color = CHANNEL_COLORS[(c - 1) % CHANNEL_COLORS.length] ?? 0xffffff;
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i]!.values[c] ?? 0;
        if (i === 0) g.moveTo(xAt(i), yAt(v));
        else g.lineTo(xAt(i), yAt(v));
      }
      g.stroke({ width: 1.4, color, alpha: 0.95 });
    }

    // Cursor at the displayed tick.
    const cx = xAt(this.scopeCursor);
    g.moveTo(cx, y0).lineTo(cx, y0 + ih);
    g.stroke({ width: 1, color: PALETTE.accent, alpha: 0.85 });

    const cur = samples[this.scopeCursor]!;
    this.scopeLabel(0, fmtSI(hi, "V"), r.x + 4, y0 - 5);
    this.scopeLabel(1, fmtSI(lo, "V"), r.x + 4, y0 + ih - 5);
    this.scopeLabel(
      2,
      "t " + cur.tick,
      Math.min(cx + 3, r.x + r.width - 42),
      r.y + r.height - 12,
    );

    // Legend along the top: a coloured dot + (custom) name per visible node.
    let li = 0;
    let lx = r.x + padL;
    const ly = r.y + 3;
    for (let c = 1; c < chans && li < this.scopeLegend.length; c++) {
      if (this.nodeHidden.has(c)) continue;
      const color = CHANNEL_COLORS[(c - 1) % CHANNEL_COLORS.length] ?? 0xffffff;
      g.circle(lx, ly + 6, 3).fill({ color });
      const t = this.scopeLegend[li++]!;
      t.text = this.nodeName(c);
      t.position.set(lx + 7, ly);
      t.visible = true;
      lx += 7 + t.text.length * 6 + 14;
    }
  }
}

/**
 * The rendered view for one placed component: an animated glyph, a tag label and
 * (for the ideal primitives) a value readout. The Board repositions it on drag
 * and ticks it each frame with the element's electrical state.
 */
class ComponentNode {
  readonly view = new Container();
  private readonly glyphHolder = new Container();
  private readonly glyph = new Graphics();
  private readonly label: Text;
  private readonly value: Text | null;
  private readonly meter: Text;
  private readonly pinPositions: { x: number; y: number }[] = [];
  private readonly wPx: number;
  private readonly hPx: number;
  private readonly color: number;
  private readonly kindTag: string;
  private readonly unit: string;

  constructor(
    private readonly component: Component,
    graph: BoardGraph,
    private readonly anchor: () => Point,
  ) {
    const kind = graph.kindOf(component);
    this.color = kind ? PALETTE[kind.colorKey] : PALETTE.dim;
    this.kindTag = kind?.tag ?? "?";
    this.unit = kind?.unit ?? "";
    this.wPx = ((kind?.w ?? 1) - 1) * PITCH;
    this.hPx = ((kind?.h ?? 1) - 1) * PITCH;
    for (const p of kind?.pins ?? []) {
      this.pinPositions.push({ x: p.dx * PITCH, y: p.dy * PITCH });
    }

    this.glyphHolder.addChild(this.glyph);
    this.view.addChild(this.glyphHolder);
    const symbol = isSymbol(this.kindTag);
    this.label = new Text({
      text: this.kindTag,
      style: {
        fill: this.color,
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: symbol ? 10 : 12,
        fontWeight: "600",
      },
    });
    this.label.anchor.set(0.5);
    this.label.resolution = DPR;
    this.view.addChild(this.label);

    if (symbol && kind?.unit) {
      this.value = new Text({
        text: formatValue(component.value, kind.unit),
        style: {
          fill: PALETTE.dim,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 9,
        },
      });
      this.value.anchor.set(0.5);
      this.value.resolution = DPR;
      this.view.addChild(this.value);
    } else {
      this.value = null;
    }

    // Live "across / through" readout, shown only while the part is selected.
    this.meter = new Text({
      text: "",
      style: {
        fill: PALETTE.dim,
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 10,
        fontWeight: "500",
      },
    });
    this.meter.anchor.set(0.5);
    this.meter.resolution = DPR;
    this.meter.visible = false;
    this.view.addChild(this.meter);

    this.layoutLabels();
    // pin dots
    for (const p of this.pinPositions) {
      this.glyph.circle(p.x, p.y, PIN_R);
    }
    this.reposition();
  }

  private layoutLabels(): void {
    if (isSymbol(this.kindTag)) {
      const p1 = this.pinPositions[1] ?? { x: this.wPx, y: 0 };
      const r = rotPx(p1.x, p1.y, this.component.rot);
      const cx = r.x / 2;
      const cy = r.y / 2;
      this.label.position.set(cx, cy - 18);
      this.value?.position.set(cx, cy + 18);
      this.meter.position.set(cx, cy - 34);
    } else {
      this.label.position.set(this.wPx / 2, this.hPx / 2);
    }
  }

  reposition(): void {
    const p = this.anchor();
    this.view.position.set(p.x, p.y);
    this.glyphHolder.rotation = (this.component.rot * Math.PI) / 2;
    this.layoutLabels();
  }

  /** Re-rasterize the labels at the given resolution (driven by DPR × zoom). */
  setTextRes(r: number): void {
    this.label.resolution = r;
    if (this.value) this.value.resolution = r;
    this.meter.resolution = r;
  }

  /** Refresh the on-board value label after an inspector edit. */
  setValue(value: number): void {
    if (this.value) this.value.text = formatValue(value, this.unit);
  }

  update(electrical: ElectricalState, phase: number, selected: boolean): void {
    const g = this.glyph;
    g.clear();
    drawGlyph(g, {
      kind: this.kindTag,
      pins: this.pinPositions,
      wPx: this.wPx,
      hPx: this.hPx,
      color: this.color,
      electrical,
      phase,
    });
    // pin dots on top of the glyph
    for (const p of this.pinPositions) {
      g.circle(p.x, p.y, PIN_R + 2).fill({ color: 0x0d0b16, alpha: 1 });
      g.circle(p.x, p.y, PIN_R).fill({ color: this.color });
    }
    // While selected, show the live voltage *across* the part and the current
    // *through* it — the two quantities words can't make intuitive.
    if (selected && isSymbol(this.kindTag)) {
      this.meter.text =
        fmtSI(electrical.vAcross, "V") +
        "  ·  " +
        fmtSI(electrical.current, "A");
      this.meter.visible = true;
    } else {
      this.meter.visible = false;
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

/** Distance from point (px,py) to segment (ax,ay)-(bx,by). */
function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Rotate a pixel offset by `rot` 90° clockwise steps: (x,y) → (−y,x). */
function rotPx(x: number, y: number, rot: number): { x: number; y: number } {
  let rx = x;
  let ry = y;
  const k = ((rot % 4) + 4) % 4;
  for (let i = 0; i < k; i++) {
    const t = rx;
    rx = -ry;
    ry = t;
  }
  return { x: rx, y: ry };
}

/** Closest point on a polyline to (px,py). */
function closestOnPolyline(
  pts: Point[],
  px: number,
  py: number,
): { x: number; y: number } {
  let best = { x: pts[0]?.x ?? px, y: pts[0]?.y ?? py };
  let bestD = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - p0.x) * dx + (py - p0.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = p0.x + t * dx;
    const cy = p0.y + t * dy;
    const d = (px - cx) ** 2 + (py - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { x: cx, y: cy };
    }
  }
  return best;
}

/** Format a live measurement in engineering notation, e.g. 0.00167 A → "1.67 mA". */
function fmtSI(value: number, unit: string): string {
  const a = Math.abs(value);
  if (a < 1e-12) return "0 " + unit;
  const steps: [number, string][] = [
    [1, ""],
    [1e-3, "m"],
    [1e-6, "µ"],
    [1e-9, "n"],
  ];
  let scale = 1;
  let prefix = "";
  for (const [s, p] of steps) {
    if (a >= s) {
      scale = s;
      prefix = p;
      break;
    }
  }
  const v = value / scale;
  const mag = Math.abs(v);
  const s = mag >= 100 ? v.toFixed(0) : mag >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s + " " + prefix + unit;
}

// --- trace ("belt") geometry + colour ---------------------------------------

interface RouteSample {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

function saturate(x: number): number {
  return x / (1 + x);
}

function polyline(g: Graphics, pts: Point[]): void {
  if (pts.length < 2) return;
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
}

function routeLength(pts: Point[]): number {
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    len += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
  }
  return len;
}

/** Position + unit direction at fraction `t` of a polyline's arc length. */
function sampleRoute(pts: Point[], t: number): RouteSample {
  let target = t * routeLength(pts);
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const seg = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (seg <= 0) continue;
    if (target <= seg) {
      const f = target / seg;
      return {
        x: p0.x + (p1.x - p0.x) * f,
        y: p0.y + (p1.y - p0.y) * f,
        dx: (p1.x - p0.x) / seg,
        dy: (p1.y - p0.y) / seg,
      };
    }
    target -= seg;
  }
  const last = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2] ?? last;
  const dl = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
  return {
    x: last.x,
    y: last.y,
    dx: (last.x - prev.x) / dl,
    dy: (last.y - prev.y) / dl,
  };
}

/** A flow chevron (arrowhead) at (x,y) pointing along (dx,dy). */
function drawChevron(
  g: Graphics,
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: number,
  alpha: number,
): void {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const s = 4;
  const bx = x - ux * s;
  const by = y - uy * s;
  g.moveTo(bx + px * s, by + py * s)
    .lineTo(x, y)
    .lineTo(bx - px * s, by - py * s);
  g.stroke({ width: 2, color, alpha });
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const gg = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (gg << 8) | bl;
}

/** Map a net voltage to a colour: GND grey-violet → violet → cyan → amber. */
function voltageColor(v: number): number {
  const stops: [number, number][] = [
    [0, 0x6b6488],
    [2, 0x9a78ff],
    [5, 0x46d2e6],
    [12, 0xd8a24a],
  ];
  const cv = Math.max(0, Math.min(12, v));
  for (let i = 0; i + 1 < stops.length; i++) {
    const s0 = stops[i]!;
    const s1 = stops[i + 1]!;
    if (cv <= s1[0]) {
      return lerpColor(s0[1], s1[1], (cv - s0[0]) / (s1[0] - s0[0] || 1));
    }
  }
  return stops[stops.length - 1]![1];
}

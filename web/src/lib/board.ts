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

/** Grid pitch in pixels — the cell size everything snaps to. */
const PITCH = 26;
const PIN_R = 4.5;
const MAX_SAMPLES = 240;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3.5;
const UNDO_LIMIT = 60;

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

export interface BoardCallbacks {
  /** Fired after the model changes so the HUD can reflect counts, etc. */
  onChange?: (graph: BoardGraph) => void;
  /** Fired when the selection changes. */
  onSelect?: (sel: { components: number; wires: number }) => void;
}

export class Board {
  private readonly world = new Container();
  private readonly grid = new Graphics();
  private readonly wireLayer = new Graphics();
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

  private readonly graph = new BoardGraph();
  private readonly nodes = new Map<number, ComponentNode>();
  private readonly selected = new Set<number>();
  private readonly selectedWires = new Set<number>();
  private samples: number[][] = [];

  private w = 0;
  private h = 0;
  private mode: Mode = "select";
  private viewportDirty = true;
  private phase = 0;
  private lastTime = 0;

  // Interaction state.
  private dragging: {
    ids: number[];
    grab: Cell;
    origins: Map<number, Cell>;
    moved: boolean;
  } | null = null;
  private wiring: { from: PinRef } | null = null;
  private panning: { lastX: number; lastY: number } | null = null;
  private pendingUndo: GraphSnapshot | null = null;
  private pointer = new Point(0, 0);
  private readonly undoStack: GraphSnapshot[] = [];

  // Probe (measure mode): two leads reading the voltage between two pins.
  private probeA: PinRef | null = null;
  private probeB: PinRef | null = null;
  private probeNodes: Map<number, [number, number]> | null = null;
  private lastState: Float64Array = new Float64Array();
  private electrical: Map<number, ElectricalState> | undefined;

  constructor(
    private readonly app: Application,
    private readonly cb: BoardCallbacks = {},
  ) {
    this.world.addChild(this.grid);
    this.world.addChild(this.wireLayer);
    this.world.addChild(this.selectionLayer);
    this.world.addChild(this.componentLayer);
    this.world.addChild(this.pendingWire);
    this.world.addChild(this.probeLayer);
    this.world.addChild(this.probeText);
    this.probeText.anchor.set(0.5);
    this.probeText.visible = false;
    app.stage.addChild(this.world);
    this.scope.addChild(this.scopeFrame);
    this.scope.addChild(this.scopeTraces);
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
    this.app.stage.cursor = mode === "place" ? "copy" : "default";
  }

  /** Supply the pin→net mapping so the probe can read net voltages. */
  setProbeNodes(map: Map<number, [number, number]> | null): void {
    this.probeNodes = map;
    this.clearProbe();
  }

  placeAt(
    kind: string,
    screenX: number,
    screenY: number,
  ): Component | undefined {
    const cell = this.screenToCell(screenX, screenY);
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
  }

  /**
   * Once-per-frame snapshot read. Generalized to a variable-length state. The
   * optional `electrical` map carries per-component current/voltage from the
   * solver to drive the glyph animations (absent until the netlist is wired).
   */
  update(snap: Snapshot, electrical?: Map<number, ElectricalState>): void {
    const now = performance.now();
    const dt = this.lastTime ? Math.min(0.05, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    this.phase += dt;

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
    for (const [id, node] of this.nodes) {
      node.update(
        electrical?.get(id) ?? ZERO_ELECTRICAL,
        this.phase,
        this.selected.has(id),
      );
    }

    this.growSamples(snap.state.length);
    for (let c = 0; c < this.samples.length; c++) {
      const buf = this.samples[c];
      if (!buf) continue;
      buf.push(snap.state[c] ?? 0);
      if (buf.length > MAX_SAMPLES) buf.shift();
    }
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
  };

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
    const wpx = ((kind?.w ?? 1) - 1) * PITCH;
    const hpx = ((kind?.h ?? 1) - 1) * PITCH;
    return new Rectangle(o.x - 14, o.y - 16, wpx + 28, hpx + 32);
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
      const a = this.graph.pinRefCell(w.from);
      const b = this.graph.pinRefCell(w.to);
      if (!a || !b) continue;
      const route = this.wireRoute(this.cellToWorld(a), this.cellToWorld(b));
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
    this.cb.onSelect?.({
      components: this.selected.size,
      wires: this.selectedWires.size,
    });
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
      const a = this.graph.pinRefCell(w.from);
      const b = this.graph.pinRefCell(w.to);
      if (!a || !b) continue;
      polyline(g, this.wireRoute(this.cellToWorld(a), this.cellToWorld(b)));
      g.stroke({ width: 5, color: PALETTE.accent, alpha: 0.5 });
    }
  }

  // --- probe (measure mode) -----------------------------------------------

  private setProbe(pin: PinRef): void {
    // First click sets the red (+) lead; second sets the steel (−) reference;
    // a third starts over. Moving the − lead is how "voltage across" is taught.
    if (!this.probeA || this.probeB) {
      this.probeA = pin;
      this.probeB = null;
    } else {
      this.probeB = pin;
    }
  }

  private clearProbe(): void {
    this.probeA = null;
    this.probeB = null;
    this.probeLayer.clear();
    this.probeText.visible = false;
  }

  private pinVoltage(ref: PinRef | null): number | null {
    if (!ref) return null;
    const nodes = this.probeNodes?.get(ref.componentId);
    if (!nodes) return null;
    const node = nodes[ref.pinIndex];
    if (node === undefined) return null;
    return this.lastState[node] ?? 0;
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
    if (this.mode !== "measure" || !this.probeA) {
      this.probeText.visible = false;
      return;
    }
    const cellA = this.graph.pinRefCell(this.probeA);
    if (!cellA) {
      this.clearProbe();
      return;
    }
    const pa = this.cellToWorld(cellA);
    const vA = this.pinVoltage(this.probeA);

    if (this.probeB) {
      const cellB = this.graph.pinRefCell(this.probeB);
      if (!cellB) {
        this.probeB = null;
        return;
      }
      const pb = this.cellToWorld(cellB);
      const vB = this.pinVoltage(this.probeB);
      this.drawLead(pa.x, pa.y, PROBE_PLUS);
      this.drawLead(pb.x, pb.y, PROBE_MINUS);
      this.probeText.text = "ΔV " + fmtSI((vA ?? 0) - (vB ?? 0), "V");
      this.probeText.position.set((pa.x + pb.x) / 2, (pa.y + pb.y) / 2 - 16);
    } else {
      this.drawLead(pa.x, pa.y, PROBE_PLUS);
      this.probeText.text =
        vA === null ? "no reading" : fmtSI(vA, "V") + " vs GND";
      this.probeText.position.set(pa.x, pa.y - 18);
    }
    this.probeText.visible = true;
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
      const pin = this.pinHitTest(wp.x, wp.y);
      if (pin) this.setProbe(pin);
      else if (!additive)
        this.panning = { lastX: e.global.x, lastY: e.global.y };
      return;
    }

    if (this.mode === "place") return; // placement driven by HUD drop/click

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
      return;
    }

    // Empty space: clear selection (unless additive) and begin panning.
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
   * and carries flow chevrons whose direction + density track the current —
   * Factorio belts, but electricity. Redrawn every frame so it stays live.
   */
  private redrawWires(): void {
    const g = this.wireLayer;
    g.clear();
    for (const w of this.graph.wires.values()) {
      const ca = this.graph.pinRefCell(w.from);
      const cb = this.graph.pinRefCell(w.to);
      if (!ca || !cb) continue;
      const route = this.wireRoute(this.cellToWorld(ca), this.cellToWorld(cb));
      const v = this.pinVoltage(w.from);
      const color = v === null ? PALETTE.cyan : voltageColor(v);
      polyline(g, route);
      g.stroke({ width: 6, color, alpha: 0.16 });
      polyline(g, route);
      g.stroke({ width: 2, color, alpha: 0.95 });

      const cur = this.wireCurrent(w);
      const norm = saturate(Math.abs(cur) / 0.02);
      if (norm > 0.02) {
        const len = routeLength(route);
        const n = Math.max(2, Math.round((len / 30) * (0.5 + norm)));
        const dir = cur >= 0 ? 1 : -1;
        const speed = 0.2 + norm * 0.9;
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
            0.35 + 0.55 * norm,
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

  /** Signed current along the wire from→to, from whichever end is an element. */
  private wireCurrent(w: Wire): number {
    const ea = this.electrical?.get(w.from.componentId);
    if (ea) return ea.current * (w.from.pinIndex === 1 ? 1 : -1);
    const eb = this.electrical?.get(w.to.componentId);
    if (eb) return -(eb.current * (w.to.pinIndex === 1 ? 1 : -1));
    return 0;
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

  private growSamples(len: number): void {
    while (this.samples.length < len) this.samples.push([]);
    if (this.samples.length > len) this.samples.length = len;
  }

  private scopeRect(): Rectangle {
    const sw = Math.min(280, Math.max(160, this.w * 0.32));
    const sh = Math.min(150, Math.max(90, this.h * 0.28));
    const pad = 12;
    return new Rectangle(this.w - sw - pad, this.h - sh - pad, sw, sh);
  }

  private layoutScope(): void {
    const r = this.scopeRect();
    const g = this.scopeFrame;
    g.clear();
    g.roundRect(r.x, r.y, r.width, r.height, 3);
    g.fill({ color: 0x0d0b16, alpha: 0.72 });
    g.stroke({ width: 1, color: PALETTE.border, alpha: 0.8 });
    g.moveTo(r.x, r.y + r.height / 2).lineTo(r.x + r.width, r.y + r.height / 2);
    g.stroke({ width: 1, color: PALETTE.border, alpha: 0.45 });
  }

  private drawScope(): void {
    const r = this.scopeRect();
    const g = this.scopeTraces;
    g.clear();
    const pad = 8;
    const x0 = r.x + pad;
    const y0 = r.y + pad;
    const iw = r.width - 2 * pad;
    const ih = r.height - 2 * pad;

    for (let c = 0; c < this.samples.length; c++) {
      const buf = this.samples[c];
      if (!buf || buf.length < 2) continue;

      let lo = Infinity;
      let hi = -Infinity;
      for (const v of buf) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      let range = hi - lo;
      if (range < 1e-9) range = 1;

      const color = CHANNEL_COLORS[c % CHANNEL_COLORS.length] ?? 0xffffff;
      const trace = (): void => {
        for (let i = 0; i < buf.length; i++) {
          const x = x0 + (i / (MAX_SAMPLES - 1)) * iw;
          const norm = ((buf[i] ?? 0) - lo) / range;
          const y = y0 + (1 - norm) * ih;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
      };
      trace();
      g.stroke({ width: 3, color, alpha: 0.12 });
      trace();
      g.stroke({ width: 1.25, color, alpha: 0.92 });
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
  private readonly glyph = new Graphics();
  private readonly label: Text;
  private readonly value: Text | null;
  private readonly meter: Text;
  private readonly pinPositions: { x: number; y: number }[] = [];
  private readonly wPx: number;
  private readonly hPx: number;
  private readonly color: number;
  private readonly kindTag: string;

  constructor(
    private readonly component: Component,
    graph: BoardGraph,
    private readonly anchor: () => Point,
  ) {
    const kind = graph.kindOf(component);
    this.color = kind ? PALETTE[kind.colorKey] : PALETTE.dim;
    this.kindTag = kind?.tag ?? "?";
    this.wPx = ((kind?.w ?? 1) - 1) * PITCH;
    this.hPx = ((kind?.h ?? 1) - 1) * PITCH;
    for (const p of kind?.pins ?? []) {
      this.pinPositions.push({ x: p.dx * PITCH, y: p.dy * PITCH });
    }

    this.view.addChild(this.glyph);
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
      const cx = this.wPx / 2;
      this.label.position.set(cx, -18);
      this.value?.position.set(cx, 18);
    } else {
      this.label.position.set(this.wPx / 2, this.hPx / 2);
    }
  }

  reposition(): void {
    const p = this.anchor();
    this.view.position.set(p.x, p.y);
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
      this.meter.position.set(this.wPx / 2, -34);
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

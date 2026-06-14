// SPDX-License-Identifier: Apache-2.0
// PixiJS board renderer. Draws the bench grid, the placed components and the
// wires between their pins, plus a small live scope widget. It also owns board
// interaction (place / wire / delete) entirely inside the canvas Svelte owns —
// it never appends DOM nodes. Presentation + input only: it reads simulation
// snapshots and mutates the BoardGraph model, but never drives the core.

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
  type Component,
  type PinRef,
  type Cell,
} from "./graph";

/** Interaction modes surfaced as a toolbar in the HUD. */
export type Mode = "select" | "place" | "wire";

/** Grid pitch in pixels — the cell size everything snaps to. */
const PITCH = 26;
const PIN_R = 4.5;
const MAX_SAMPLES = 240;

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
}

export class Board {
  private readonly grid = new Graphics();
  private readonly wireLayer = new Graphics();
  private readonly pendingWire = new Graphics();
  private readonly componentLayer = new Container();
  private readonly scope = new Container();
  private readonly scopeTraces = new Graphics();
  private readonly scopeFrame = new Graphics();

  private readonly graph = new BoardGraph();
  private readonly nodes = new Map<number, ComponentNode>();
  /** Per-channel ring buffers for the scope; grown to match snapshot length. */
  private samples: number[][] = [];

  private w = 0;
  private h = 0;
  private mode: Mode = "select";

  // Drag state for placing/moving a component.
  private dragging: {
    id: number;
    offsetCol: number;
    offsetRow: number;
  } | null = null;
  // Drag state for drawing a wire from a starting pin.
  private wiring: { from: PinRef } | null = null;
  private pointer = new Point(0, 0);

  constructor(
    private readonly app: Application,
    private readonly cb: BoardCallbacks = {},
  ) {
    app.stage.addChild(this.grid);
    app.stage.addChild(this.wireLayer);
    app.stage.addChild(this.componentLayer);
    app.stage.addChild(this.pendingWire);
    this.scope.addChild(this.scopeFrame);
    this.scope.addChild(this.scopeTraces);
    app.stage.addChild(this.scope);

    // The stage is the single interactive surface; per-node hit testing is done
    // against rendered geometry. This keeps all input inside the canvas.
    app.stage.eventMode = "static";
    app.stage.hitArea = new Rectangle(
      0,
      0,
      this.app.screen.width,
      this.app.screen.height,
    );
    app.stage.on("pointerdown", this.onPointerDown);
    app.stage.on("pointermove", this.onPointerMove);
    app.stage.on("pointerup", this.onPointerUp);
    app.stage.on("pointerupoutside", this.onPointerUp);
    app.stage.on("rightdown", this.onRightDown);

    this.drawGrid();
  }

  // --- public API ---------------------------------------------------------

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode !== "wire") this.cancelWiring();
    this.app.stage.cursor = mode === "place" ? "copy" : "default";
  }

  /**
   * Place a component at a screen-space point (e.g. a drop from the HUD bin).
   * Coordinates are snapped to the grid. Returns the new component, if created.
   */
  placeAt(
    kind: string,
    screenX: number,
    screenY: number,
  ): Component | undefined {
    const cell = this.screenToCell(screenX, screenY);
    const c = this.graph.place(kind, cell);
    if (c) {
      this.addNode(c);
      this.redrawWires();
      this.cb.onChange?.(this.graph);
    }
    return c;
  }

  /** Remove everything from the board. */
  clear(): void {
    this.graph.clear();
    for (const node of this.nodes.values()) node.destroy();
    this.nodes.clear();
    this.redrawWires();
    this.cb.onChange?.(this.graph);
  }

  /** Once-per-frame snapshot read. Generalized to a variable-length state. */
  update(snap: Snapshot): void {
    if (this.app.screen.width !== this.w || this.app.screen.height !== this.h) {
      this.drawGrid();
      this.layoutScope();
      this.app.stage.hitArea = new Rectangle(0, 0, this.w, this.h);
    }
    this.growSamples(snap.state.length);
    for (let c = 0; c < this.samples.length; c++) {
      const buf = this.samples[c];
      if (!buf) continue;
      buf.push(snap.state[c] ?? 0);
      if (buf.length > MAX_SAMPLES) buf.shift();
    }
    this.drawScope();
  }

  destroy(): void {
    this.app.stage.off("pointerdown", this.onPointerDown);
    this.app.stage.off("pointermove", this.onPointerMove);
    this.app.stage.off("pointerup", this.onPointerUp);
    this.app.stage.off("pointerupoutside", this.onPointerUp);
    this.app.stage.off("rightdown", this.onRightDown);
    for (const node of this.nodes.values()) node.destroy();
    this.nodes.clear();
    this.grid.destroy();
    this.wireLayer.destroy();
    this.pendingWire.destroy();
    this.componentLayer.destroy({ children: true });
    this.scope.destroy({ children: true });
  }

  // --- geometry helpers ---------------------------------------------------

  private screenToCell(x: number, y: number): Cell {
    return { col: snap(x, PITCH), row: snap(y, PITCH) };
  }

  private cellToScreen(cell: Cell): Point {
    return new Point(cell.col * PITCH, cell.row * PITCH);
  }

  /** Find the pin nearest to a screen point within a small radius, if any. */
  private pinHitTest(x: number, y: number): PinRef | null {
    const r2 = (PIN_R * 2.4) ** 2;
    let best: PinRef | null = null;
    let bestD = r2;
    for (const c of this.graph.components.values()) {
      const kind = this.graph.kindOf(c);
      if (!kind) continue;
      for (const p of kind.pins) {
        const pos = this.cellToScreen(this.graph.pinCell(c, p));
        const d = (pos.x - x) ** 2 + (pos.y - y) ** 2;
        if (d <= bestD) {
          bestD = d;
          best = { componentId: c.id, pinIndex: p.index };
        }
      }
    }
    return best;
  }

  /** Find the topmost component whose body contains a screen point, if any. */
  private bodyHitTest(x: number, y: number): Component | null {
    let best: Component | null = null;
    for (const c of this.graph.components.values()) {
      const kind = this.graph.kindOf(c);
      if (!kind) continue;
      const o = this.cellToScreen(c.cell);
      const w = (kind.w - 1) * PITCH;
      const h = (kind.h - 1) * PITCH;
      if (
        x >= o.x - 12 &&
        x <= o.x + w + 12 &&
        y >= o.y - 12 &&
        y <= o.y + h + 12
      ) {
        best = c; // later components are on top
      }
    }
    return best;
  }

  // --- input handlers -----------------------------------------------------

  private readonly onPointerDown = (e: FederatedPointerEvent): void => {
    const { x, y } = e.global;
    this.pointer.set(x, y);

    if (this.mode === "place") return; // placement is driven by HUD drops

    const pin = this.pinHitTest(x, y);
    if (this.mode === "wire") {
      if (pin) this.wiring = { from: pin };
      return;
    }

    // select mode: start a wire if a pin was grabbed, else drag the body.
    if (pin) {
      this.wiring = { from: pin };
      return;
    }
    const body = this.bodyHitTest(x, y);
    if (body) {
      const cell = this.screenToCell(x, y);
      this.dragging = {
        id: body.id,
        offsetCol: cell.col - body.cell.col,
        offsetRow: cell.row - body.cell.row,
      };
    }
  };

  private readonly onPointerMove = (e: FederatedPointerEvent): void => {
    const { x, y } = e.global;
    this.pointer.set(x, y);

    if (this.dragging) {
      const cell = this.screenToCell(x, y);
      this.graph.move(this.dragging.id, {
        col: cell.col - this.dragging.offsetCol,
        row: cell.row - this.dragging.offsetRow,
      });
      this.nodes.get(this.dragging.id)?.reposition();
      this.redrawWires();
      return;
    }
    if (this.wiring) {
      this.drawPendingWire();
    }
  };

  private readonly onPointerUp = (e: FederatedPointerEvent): void => {
    const { x, y } = e.global;
    if (this.dragging) {
      this.dragging = null;
      this.cb.onChange?.(this.graph);
      return;
    }
    if (this.wiring) {
      const target = this.pinHitTest(x, y);
      if (target) {
        const wire = this.graph.connect(this.wiring.from, target);
        if (wire) {
          this.redrawWires();
          this.cb.onChange?.(this.graph);
        }
      }
      this.cancelWiring();
    }
  };

  private readonly onRightDown = (e: FederatedPointerEvent): void => {
    e.preventDefault?.();
    const { x, y } = e.global;
    // Right-click deletes: a pin's wires first, otherwise the body under cursor.
    const wireId = this.wireHitTest(x, y);
    if (wireId !== null) {
      this.graph.removeWire(wireId);
      this.redrawWires();
      this.cb.onChange?.(this.graph);
      return;
    }
    const body = this.bodyHitTest(x, y);
    if (body) {
      this.graph.removeComponent(body.id);
      this.nodes.get(body.id)?.destroy();
      this.nodes.delete(body.id);
      this.redrawWires();
      this.cb.onChange?.(this.graph);
    }
  };

  /** Distance-to-segment hit test against drawn wires; returns a wire id. */
  private wireHitTest(x: number, y: number): number | null {
    const tol = 7;
    for (const w of this.graph.wires.values()) {
      const a = this.graph.pinRefCell(w.from);
      const b = this.graph.pinRefCell(w.to);
      if (!a || !b) continue;
      const pa = this.cellToScreen(a);
      const pb = this.cellToScreen(b);
      if (distToSegment(x, y, pa.x, pa.y, pb.x, pb.y) <= tol) return w.id;
    }
    return null;
  }

  private cancelWiring(): void {
    this.wiring = null;
    this.pendingWire.clear();
  }

  // --- drawing ------------------------------------------------------------

  private addNode(c: Component): void {
    const node = new ComponentNode(c, this.graph, () =>
      this.cellToScreen(c.cell),
    );
    this.nodes.set(c.id, node);
    this.componentLayer.addChild(node.view);
  }

  private redrawWires(): void {
    const g = this.wireLayer;
    g.clear();
    for (const w of this.graph.wires.values()) {
      const a = this.graph.pinRefCell(w.from);
      const b = this.graph.pinRefCell(w.to);
      if (!a || !b) continue;
      const pa = this.cellToScreen(a);
      const pb = this.cellToScreen(b);
      // Glow underlay then a bright core for the neon polyline look.
      g.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y);
      g.stroke({ width: 6, color: PALETTE.cyan, alpha: 0.14 });
      g.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y);
      g.stroke({ width: 1.8, color: PALETTE.cyan, alpha: 0.95 });
    }
  }

  private drawPendingWire(): void {
    const g = this.pendingWire;
    g.clear();
    if (!this.wiring) return;
    const start = this.graph.pinRefCell(this.wiring.from);
    if (!start) return;
    const ps = this.cellToScreen(start);
    const snapTo = this.pinHitTest(this.pointer.x, this.pointer.y);
    const end = snapTo
      ? this.cellToScreen(this.graph.pinRefCell(snapTo) ?? start)
      : this.pointer;
    g.moveTo(ps.x, ps.y).lineTo(end.x, end.y);
    g.stroke({ width: 6, color: PALETTE.accent, alpha: 0.16 });
    g.moveTo(ps.x, ps.y).lineTo(end.x, end.y);
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
    const w = (this.w = this.app.screen.width);
    const h = (this.h = this.app.screen.height);
    const g = this.grid;
    g.clear();

    for (let x = 0; x <= w; x += PITCH) g.moveTo(x, 0).lineTo(x, h);
    for (let y = 0; y <= h; y += PITCH) g.moveTo(0, y).lineTo(w, y);
    g.stroke({ width: 1, color: 0x2a2640, alpha: 0.35 });

    const major = PITCH * 4;
    for (let x = 0; x <= w; x += major) g.moveTo(x, 0).lineTo(x, h);
    for (let y = 0; y <= h; y += major) g.moveTo(0, y).lineTo(w, y);
    g.stroke({ width: 1, color: PALETTE.border, alpha: 0.5 });
  }

  // --- scope widget (variable-length state) -------------------------------

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
 * The rendered view for one placed component: a body card, a label, and pin
 * dots. It draws into its own Container at the component's screen position; the
 * Board repositions it on drag. No interactivity lives here — the Board hit
 * tests against geometry so all input stays on one surface.
 */
class ComponentNode {
  readonly view = new Container();
  private readonly body = new Graphics();
  private readonly pins = new Graphics();
  private readonly label: Text;

  constructor(
    private readonly component: Component,
    private readonly graph: BoardGraph,
    private readonly anchor: () => Point,
  ) {
    this.view.addChild(this.body);
    this.view.addChild(this.pins);
    const kind = graph.kindOf(component);
    this.label = new Text(kind?.tag ?? "?", {
      fill: kind ? PALETTE[kind.colorKey] : PALETTE.dim,
      fontFamily: "IBM Plex Mono, monospace",
      fontSize: 12,
      fontWeight: "600",
    });
    this.label.anchor.set(0.5);
    this.view.addChild(this.label);
    this.draw();
    this.reposition();
  }

  reposition(): void {
    const p = this.anchor();
    this.view.position.set(p.x, p.y);
  }

  private draw(): void {
    const kind = this.graph.kindOf(this.component);
    if (!kind) return;
    const color = PALETTE[kind.colorKey];
    const w = (kind.w - 1) * PITCH;
    const h = (kind.h - 1) * PITCH;

    const b = this.body;
    b.clear();
    b.roundRect(-10, -10, w + 20, h + 20, 4);
    b.fill({ color: 0x16121f, alpha: 0.92 });
    b.stroke({ width: 1.5, color, alpha: 0.85 });
    // accent edge along the left, echoing the bin cards
    b.moveTo(-10, -10).lineTo(-10, h + 10);
    b.stroke({ width: 2, color, alpha: 0.95 });

    this.label.position.set(w / 2, h / 2);

    const pg = this.pins;
    pg.clear();
    for (const p of kind.pins) {
      const px = p.dx * PITCH;
      const py = p.dy * PITCH;
      pg.circle(px, py, PIN_R + 2).fill({ color: 0x0d0b16, alpha: 1 });
      pg.circle(px, py, PIN_R).fill({ color });
      pg.circle(px, py, PIN_R).stroke({
        width: 1,
        color: 0x0d0b16,
        alpha: 0.6,
      });
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

/** Squared-free distance from point (px,py) to segment (ax,ay)-(bx,by). */
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

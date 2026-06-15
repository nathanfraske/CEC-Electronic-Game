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
import type { Snapshot, SubFrameSample } from "../sim/loop";
import {
  BoardGraph,
  PALETTE,
  PART_KINDS,
  snap,
  formatValue,
  rotateOffset,
  isJunctionRef,
  endpointKey,
  type Component,
  type PinRef,
  type Endpoint,
  type Cell,
  type Wire,
  type GraphSnapshot,
} from "./graph";
import {
  drawGlyph,
  isSymbol,
  setGlyphStyle,
  ZERO_ELECTRICAL,
  type ElectricalState,
  type GlyphStyle,
} from "./glyphs";
import { hasValue } from "./values";

/** Interaction modes surfaced as a toolbar in the HUD. */
export type Mode = "select" | "place" | "wire" | "measure" | "junction";

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
/** Radius of the filled wire-to-wire junction dot (KiCad-style). */
const JUNCTION_R = 4;
const MAX_SAMPLES = 240;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3.5;
const UNDO_LIMIT = 60;
/** Max gap (ms) between two presses on a junction to count as a double-click. */
const DOUBLE_CLICK_MS = 350;
/** Alpha the armed-part placement ghost is drawn at (a faint translucent preview). */
const GHOST_ALPHA = 0.32;
/**
 * Visual flow clock. The animated belts/dots/pulses advance off a *bounded* phase
 * that ticks at a fixed wall-clock rate, NOT at the playback ticks-per-second and
 * NOT scaled by V/I. `FLOW_HZ` is that rate in visual phase-units per real second;
 * at the drawers' unit rates this lands the recirculation in the readable
 * ~0.3–1.5 visual-Hz band for every current and every playback speed.
 *
 * Why this exists: magnitude used to ride *speed* (glyph `flow()` speed ∝ current)
 * AND the phase used to ride *tps* (`tick·TICK_FLOW`). Their product blew up — at
 * high V/I or high tps the flow was unreadable. Magnitude now lives on density +
 * thickness + alpha (see `flow()` and `redrawWires`), and the timeline only sets
 * the *direction* of this clock (see `update`), so scrubbing still runs it back.
 *
 * Effective recirculation (cycles/sec), old vs new, over tps × current:
 *           OLD glyph@1A  OLD carrier@1A | NEW (any I, any tps)
 *   tps=10      1.1            0.5        |  glyph 0.60, carrier 0.60, energy 0.66
 *   tps=50      1.3            0.7        |  glyph 0.60, carrier 0.60, energy 0.66
 *   tps=500     4.1            2.0        |  glyph 0.60, carrier 0.60, energy 0.66
 *   tps=5000    6.2            3.0        |  glyph 0.60, carrier 0.60, energy 0.66
 * (OLD @1 mA stayed ~0.2–0.3, which is why lowering tps never fixed the *high*-
 * current cases.) NEW pins every cell in the readable 0.3–1.5 band, tps-invariant.
 */
const FLOW_HZ = 0.6;
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

// The belt carries two layers: charge carriers (voltage-coloured chevrons) and
// the energy they deliver (warm-orange dots). `*_PX_RATE` are belt speeds in
// PIXELS per unit of the bounded visual phase — crucially NOT a route *fraction*
// per unit, which is what made the flow run faster on longer traces (pixel speed
// = routeLength × fraction-rate). The per-wire offsets are stored in pixels and
// advanced by `dir · flowDelta · *_PX_RATE`, so a long and a short trace carrying
// the same current glide at the same on-screen speed. With FLOW_HZ (~0.6) these
// rates land the carriers around ~60 px/s — a calm, readable glide that matches
// the old feel on a ~100px wire, now length-independent.
//
// Crucially the advance uses only the SIGN of current / of power v·i (see the
// saturating direction factors below) — never their magnitude — so the belts move
// at a constant calm rate while still: carriers reverse on AC (signed current
// flips each half-cycle) and energy streams steadily to a resistive load (v·i sign
// stays positive). Magnitude is shown by thickness + density + alpha, never speed.
const ENERGY_COLOR = 0xff8a3d;
const CARRIER_PX_RATE = 100; // px advanced per phase-unit ⇒ ~60 px/s at FLOW_HZ
const ENERGY_PX_RATE = 110; // slightly faster so the two layers stay distinguishable
const I_REF = 0.01; // 10 mA — same reference the thickness/density use
const V_REF = 6; // ~one rail; net voltage above this saturates the energy layer
// Saturate the direction factor: any current/power past this small fraction of the
// reference moves at full constant speed; smaller values ramp smoothly so an AC
// zero-crossing eases through zero instead of snapping (it never sets the rate).
const FLOW_DIR_SAT = 0.05;
// Largest belt advance allowed in a single frame, in pixels. On AC the direction
// reverses each half-cycle; at high tps a frame can otherwise span many cycles and
// the eased reversal would still read as a hard jump. Clamping the per-frame pixel
// delta keeps the reversal a smooth back-and-forth slosh at any ticks-per-second
// without affecting the steady DC stream (whose per-frame delta stays well under).
const MAX_FLOW_PX_PER_FRAME = 14;
// Belt thickness range (px): a near-zero current reads as a thin hair, a current
// at/above the saturation reference as a bold bus. Wider than before so amperage
// is legible at a glance (saturating normalization keeps a huge current bounded).
const BELT_WIDTH_MIN = 1.4;
const BELT_WIDTH_MAX = 7.0;
// Chevron (arrowhead) half-size range (px): scales with current so more amps draw
// visibly bigger arrows, bounded by the same saturating normalization.
const CHEVRON_SIZE_MIN = 3.0;
const CHEVRON_SIZE_MAX = 6.5;
// Carrier chevron spacing range (px): denser for more current (constant
// arrows-per-pixel at a given current, so equal-current segments match regardless
// of length). Placed at absolute arc-length so density never depends on length.
const CARRIER_SPACING_MAX = 46; // sparse at low current
const CARRIER_SPACING_MIN = 16; // dense at high current
const ENERGY_SPACING = 34; // energy-dot spacing in px (absolute arc-length)
// Safety cap on dots per belt so a very long trace can't spawn unbounded graphics.
const MAX_BELT_DOTS = 64;

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

/** Screen-space (CSS px, canvas-relative) rect of the lone selected part, for
 * anchoring a floating HUD popover above it. */
export interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
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
  /** Per-frame screen rect of the lone selected part (or null) to anchor a popover. */
  onAnchor?: (rect: AnchorRect | null) => void;
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
  // Translucent placement preview ("ghost") of the armed part at the snapped
  // cursor cell. A dedicated low-alpha layer holding one reused Graphics — no DOM,
  // and it rotates the held part's glyph in place via the holder's rotation.
  private readonly ghostLayer = new Container();
  private readonly ghostGlyph = new Graphics();
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
  private readonly selectedJunctions = new Set<number>();
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
  // Placement rotation (0..3, 90° CW steps) for the armed part: R rotates it while
  // a part is armed and nothing is selected, the ghost reflects it, and the part
  // is dropped at this rotation. Independent of any selected part's rotation.
  private armedRot = 0;
  // Whether the pointer is currently over the board, so the ghost shows only while
  // hovering and hides the moment the pointer leaves.
  private pointerInside = false;
  private viewportDirty = true;
  // `phase` is the bounded visual flow clock fed to every drawer: it advances at a
  // fixed wall-clock rate (FLOW_HZ), so the flow reads at a constant calm pace no
  // matter the playback tps or the V/I magnitude. Its *direction* tracks the
  // timeline — forward while the tick advances, reverse when stepping/scrubbing
  // back — via the sign of the tick change (see `update`). `prevTick` remembers
  // the last displayed tick so that sign can be computed.
  private phase = 0;
  private prevTick = 0;
  private prevPhase = 0;
  // Signed change in `phase` over the current frame, consumed once by the belt
  // animation so it integrates exactly once per frame (drag-driven redraws, which
  // also call redrawWires, leave it zero and just reposition the dots).
  private flowDelta = 0;
  // Per-wire integrated offsets in PIXELS (arc-length) for the two belt layers, so
  // flow speed is constant in pixels regardless of trace length. Carriers integrate
  // signed current (stream on DC, slosh on AC); energy integrates signed power v·i
  // (streams to the load on a resistor, sloshes on a reactive part). Keyed by wire.
  private carrierOffset = new Map<number, number>();
  private energyOffset = new Map<number, number>();
  private lastTime = 0;
  private textRes = DPR;
  private lastAnchorKey = ""; // change-detect the popover anchor rect

  // Interaction state.
  private dragging: {
    ids: number[];
    grab: Cell;
    origins: Map<number, Cell>;
    moved: boolean;
  } | null = null;
  private wiring: { from: Endpoint } | null = null;
  // Dragging one SEGMENT of a wire to reshape its route, KiCad-style: the grabbed
  // segment translates along its perpendicular axis while its two endpoints (pins/
  // junctions) stay put and the bracketing segments stretch. `pts` is the working
  // anchor list [fromCell, ...interior waypoints, toCell] with the dragged
  // segment's two brackets already guaranteed to be *interior* (a bracket that was
  // an endpoint had a coincident waypoint spliced in, so the endpoint stays fixed
  // and the route just bends near it). The dragged segment lies between pts[bi] and
  // pts[bi+1]; `axis` is its run ("h" ⇒ move it in row/Y, "v" ⇒ move it in col/X).
  private wireDrag: {
    id: number;
    pts: Cell[];
    bi: number;
    axis: "h" | "v";
    moved: boolean;
  } | null = null;
  // Dragging a junction (started by a double-click on it) to a new grid cell; its
  // incident wires follow because they reference it by id. `moved` gates the undo.
  private junctionDrag: { id: number; moved: boolean } | null = null;
  // Timestamp + id of the last junction press, to detect a double-click (a second
  // press on the same junction within DOUBLE_CLICK_MS grabs it for dragging).
  private lastJunctionTap: { id: number; t: number } | null = null;
  private panning: { lastX: number; lastY: number } | null = null;
  private pendingUndo: GraphSnapshot | null = null;
  private pointer = new Point(0, 0);
  private readonly undoStack: GraphSnapshot[] = [];

  // Probe (measure mode): two draggable DMM leads that snap to a pin or trace.
  private probeA: ProbePoint | null = null;
  private probeB: ProbePoint | null = null;
  private draggingProbe: "A" | "B" | null = null;
  // Meter function: "V" reads voltage between two leads; "A" reads the current
  // through the clicked element/wire (an ammeter). `lastWireCurrents` is cached
  // from the per-frame KCL solve so the ammeter can read a wire's branch current.
  private probeMode: "V" | "A" = "V";
  private ammeter: { kind: "comp" | "wire"; id: number } | null = null;
  private lastWireCurrents = new Map<number, number>();
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
    // The ghost rides above the components so the preview is never occluded, and
    // below the pending-wire/probe overlays. It is non-interactive and starts hidden.
    this.ghostLayer.addChild(this.ghostGlyph);
    this.ghostLayer.eventMode = "none";
    this.ghostLayer.alpha = GHOST_ALPHA;
    this.ghostLayer.visible = false;
    this.world.addChild(this.ghostLayer);
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
    // Track pointer presence on the canvas so the placement ghost shows only while
    // the cursor is over the board and vanishes the instant it leaves.
    app.canvas.addEventListener("pointerenter", this.onPointerEnter);
    app.canvas.addEventListener("pointerleave", this.onPointerLeave);

    this.drawGrid();
  }

  // --- public API ---------------------------------------------------------

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode !== "wire") this.cancelWiring();
    if (mode !== "measure") this.clearProbe();
    this.updateCursor();
    this.updateGhost();
  }

  /** Arm a part kind: clicking empty board cells now drops it (place-and-repeat). */
  setArmed(kind: string | null): void {
    // Arming a fresh kind starts it at rotation 0 (R then rotates from there);
    // re-arming the same kind keeps the rotation the player dialled in.
    if (kind !== this.armed) this.armedRot = 0;
    this.armed = kind;
    this.updateCursor();
    this.updateGhost();
  }

  /**
   * Rotate the *placement* rotation of the armed part 90° CW. Used by R while a
   * part is armed and nothing is selected; the ghost reflects it immediately and
   * the part drops at this rotation. No-op when nothing is armed.
   */
  rotateArmed(): void {
    if (!this.armed) return;
    this.armedRot = (this.armedRot + 1) % 4;
    this.updateGhost();
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
      : this.mode === "measure" || this.mode === "junction"
        ? "crosshair"
        : "default";
  }

  private readonly onPointerEnter = (): void => {
    this.pointerInside = true;
    this.updateGhost();
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.updateGhost();
  };

  /**
   * Draw the translucent placement preview of the armed part at the grid-snapped
   * cursor cell, reusing the real glyph drawer at a low alpha on the ghost layer.
   * Shown only while a part is armed and the pointer is over the board; hidden
   * otherwise. The held part's placement rotation rotates the glyph in place, and
   * it snaps to `cellToWorld(cell)` so it sits exactly where a drop would land.
   */
  private updateGhost(): void {
    const show = this.armed !== null && this.pointerInside;
    this.ghostLayer.visible = show;
    if (!show || this.armed === null) {
      this.ghostGlyph.clear();
      return;
    }
    const kind = PART_KINDS[this.armed];
    if (!kind) {
      this.ghostLayer.visible = false;
      this.ghostGlyph.clear();
      return;
    }
    const cell = {
      col: snap(this.pointer.x, PITCH),
      row: snap(this.pointer.y, PITCH),
    };
    const o = this.cellToWorld(cell);
    this.ghostLayer.position.set(o.x, o.y);
    // Rotate the glyph in place exactly like a placed component's holder does, so
    // the preview matches the orientation the part will be dropped at.
    this.ghostGlyph.rotation = (this.armedRot * Math.PI) / 2;
    const color = PALETTE[kind.colorKey];
    const pins = kind.pins.map((p) => ({ x: p.dx * PITCH, y: p.dy * PITCH }));
    const g = this.ghostGlyph;
    g.clear();
    drawGlyph(g, {
      kind: this.armed,
      pins,
      wPx: (kind.w - 1) * PITCH,
      hPx: (kind.h - 1) * PITCH,
      color,
      electrical: ZERO_ELECTRICAL,
      phase: 0,
    });
    // Pin dots, matching the real node so the ghost reads as the same part.
    for (const p of pins) g.circle(p.x, p.y, PIN_R).fill({ color });
  }

  /** Supply the pin→net mapping so the probe can read net voltages. */
  setProbeNodes(map: Map<number, [number, number]> | null): void {
    this.probeNodes = map;
    this.clearProbe();
  }

  /** Switch the meter between voltmeter ("V") and ammeter ("A"). */
  setProbeMode(mode: "V" | "A"): void {
    this.probeMode = mode;
    this.clearProbe();
  }

  /** Switch the component art style (schematic symbols ↔ factory machines). The
   * glyphs redraw with it next frame; pins and wiring are unchanged. */
  setStyle(style: GlyphStyle): void {
    setGlyphStyle(style);
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

  /**
   * Place a part at a grid cell, recording undo and refreshing the view. `rot`
   * (90° CW steps) sets the dropped orientation — the armed placement rotation, so
   * a part lands at the angle the ghost previewed; it defaults to 0 (drag-drop).
   */
  private placeCell(kind: string, cell: Cell, rot = 0): Component | undefined {
    const before = this.graph.serialize();
    const c = this.graph.place(kind, cell);
    if (c) {
      // Drop at the requested orientation (the armed placement rotation) so the
      // part lands exactly as the ghost previewed it; addNode reads c.rot.
      c.rot = ((rot % 4) + 4) % 4;
      // Auto-splice: if a pin landed on an existing pin / junction / trace, wire it
      // in (splitting a trace through the pin's cell). Done before the undo push so
      // a single undo reverts the whole drop-and-splice.
      this.spliceOnPlace(c);
      this.pushUndo(before);
      this.addNode(c);
      this.redrawWires();
      this.cb.onChange?.(this.graph);
    }
    return c;
  }

  /**
   * Wire a freshly-placed component into whatever its pins landed on. For each pin,
   * by precedence at the landing cell: an existing **pin** (of another part) → wire
   * the two together; a **junction** → wire to it; a **wire passing through** the
   * cell mid-run (not at its own endpoint) → split that wire at the cell and tie
   * the pin in (the `junctionOnWire` create+split path, the same as a T-junction);
   * an empty cell → nothing. So dropping a part so a pin bridges a trace splices it
   * in-line; if both pins land on traces, both are spliced. Reuses the junction
   * machinery, so the result composes with undo/redo and `buildNetlist` ties the
   * spliced pin and the two wire halves into one node. Pins are processed in order
   * and the graph re-queried per pin, since an earlier splice can change it.
   */
  private spliceOnPlace(c: Component): void {
    const kind = this.graph.kindOf(c);
    if (!kind) return;
    for (const p of kind.pins) {
      const pinRef: PinRef = { componentId: c.id, pinIndex: p.index };
      const cell = this.graph.pinCell(c, p);
      // 1) An existing pin of another component at this exact cell → connect to it.
      const hitPin = this.graph.pinAtCell(cell, c.id);
      if (hitPin) {
        this.graph.connect(pinRef, hitPin);
        continue;
      }
      // 2) An existing junction at this cell → connect to it.
      const hitJ = this.graph.junctionAtCell(cell);
      if (hitJ) {
        this.graph.connect(pinRef, { junctionId: hitJ.id });
        continue;
      }
      // 3) A wire passing through this cell mid-run (excluding its endpoints) →
      //    split it here and tie the pin in. Skip wires already incident to this
      //    pin (none yet on a fresh part, but cheap insurance for re-entrancy).
      const wireId = this.wireThroughCell(cell, pinRef);
      if (wireId !== null) {
        this.graph.junctionOnWire(wireId, cell, pinRef);
      }
      // 4) Empty cell: normal placement, nothing to splice.
    }
  }

  /**
   * The id of a wire whose orthogonal route passes through grid `cell` at a point
   * that is NOT one of its own endpoint cells (those are pin/junction hits, handled
   * by their own precedence), or null. Excludes any wire already incident to
   * `exclude`. Used by auto-splice to find a trace to break a landed pin into.
   */
  private wireThroughCell(cell: Cell, exclude: Endpoint): number | null {
    const p = this.cellToWorld(cell);
    const excludeKey = endpointKey(exclude);
    const tol = PITCH * 0.3; // well under half a cell: the cell must lie on the run
    for (const w of this.graph.wires.values()) {
      if (
        endpointKey(w.from) === excludeKey ||
        endpointKey(w.to) === excludeKey
      ) {
        continue;
      }
      const a = this.graph.endpointCell(w.from);
      const b = this.graph.endpointCell(w.to);
      if (!a || !b) continue;
      // Skip if the cell IS one of this wire's endpoints (an endpoint coincidence
      // is a pin/junction hit, not a mid-run split).
      if (
        (a.col === cell.col && a.row === cell.row) ||
        (b.col === cell.col && b.row === cell.row)
      ) {
        continue;
      }
      const route = this.routeForWire(w);
      for (let i = 0; i + 1 < route.length; i++) {
        if (
          distToSegment(
            p.x,
            p.y,
            route[i]!.x,
            route[i]!.y,
            route[i + 1]!.x,
            route[i + 1]!.y,
          ) <= tol
        ) {
          return w.id;
        }
      }
    }
    return null;
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

  /** Delete the current selection (components + wires + junctions). */
  deleteSelection(): void {
    if (
      this.selected.size === 0 &&
      this.selectedWires.size === 0 &&
      this.selectedJunctions.size === 0
    ) {
      return;
    }
    this.pushUndo(this.graph.serialize());
    for (const id of this.selected) this.graph.removeComponent(id);
    for (const id of this.selectedWires) this.graph.removeWire(id);
    for (const id of this.selectedJunctions) this.graph.removeJunction(id);
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

  /** Snapshot the whole board (for the save-to-file feature). */
  serialize(): GraphSnapshot {
    return this.graph.serialize();
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
   * The optional `scopeBatch` carries every tick stepped this frame (already read,
   * downsampled in the loop) so the scope charts at sub-frame resolution instead
   * of aliasing AC at high ticks-per-second — pure JS routing, no wasm crossing.
   */
  update(
    snap: Snapshot,
    electrical?: Map<number, ElectricalState>,
    running = true,
    scopeBatch?: SubFrameSample[],
  ): void {
    const now = performance.now();
    const dt = this.lastTime ? Math.min(0.05, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    // Advance the bounded visual flow clock at a FIXED wall-clock rate (FLOW_HZ) —
    // never scaled by playback tps or by V/I, so the flow reads at a constant calm
    // pace everywhere. Only the *direction* tracks the timeline: forward while
    // running (a smooth glide even at low tps, where most frames cross no tick),
    // and on the sign of the displayed-tick change when paused, so stepping/
    // scrubbing back runs the flow backward and an idle pause freezes it.
    const tick = Number(snap.tick);
    let dir = 0;
    if (running) dir = 1;
    else if (tick > this.prevTick) dir = 1;
    else if (tick < this.prevTick) dir = -1;
    this.prevTick = tick;
    this.phase += dir * FLOW_HZ * dt;
    // How far the belt advances this frame: forward while running, backward when
    // stepping/scrubbing back, frozen when paused. redrawWires consumes it once.
    this.flowDelta = this.phase - this.prevPhase;
    this.prevPhase = this.phase;

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

    this.recordScope(snap, scopeBatch);
    this.drawScope();
    this.drawProbe();
    this.emitAnchor();
  }

  destroy(): void {
    this.app.stage.off("pointerdown", this.onPointerDown);
    this.app.stage.off("pointermove", this.onPointerMove);
    this.app.stage.off("pointerup", this.onPointerUp);
    this.app.stage.off("pointerupoutside", this.onPointerUp);
    this.app.stage.off("rightdown", this.onRightDown);
    this.app.canvas.removeEventListener("wheel", this.onWheel);
    this.app.canvas.removeEventListener("pointerenter", this.onPointerEnter);
    this.app.canvas.removeEventListener("pointerleave", this.onPointerLeave);
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

  /** Nearest junction within grab range of a world point, else null. */
  private junctionHitTest(wx: number, wy: number): number | null {
    const r2 = (JUNCTION_R * 2.4) ** 2;
    let best: number | null = null;
    let bestD = r2;
    for (const j of this.graph.junctions.values()) {
      const p = this.cellToWorld(j.cell);
      const d = (p.x - wx) ** 2 + (p.y - wy) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = j.id;
      }
    }
    return best;
  }

  // --- selection ----------------------------------------------------------

  private clearSelection(): void {
    this.selected.clear();
    this.selectedWires.clear();
    this.selectedJunctions.clear();
    this.redrawSelection();
    this.emitSelect();
  }

  private emitSelect(): void {
    let single: SelectedPart | undefined;
    // Junctions count as edge selections (folded into `wires`) so the inspector
    // only opens for a lone component with nothing else picked.
    const edges = this.selectedWires.size + this.selectedJunctions.size;
    if (this.selected.size === 1 && edges === 0) {
      const id = [...this.selected][0]!;
      const c = this.graph.components.get(id);
      if (c) single = { id: c.id, kind: c.kind, value: c.value };
    }
    this.cb.onSelect?.({
      components: this.selected.size,
      wires: edges,
      single,
    });
  }

  /** Project the lone selected part's box to screen space for the value popover. */
  private emitAnchor(): void {
    let rect: AnchorRect | null = null;
    const busy =
      this.dragging || this.panning || this.wiring || this.draggingProbe;
    if (
      this.selected.size === 1 &&
      this.selectedWires.size === 0 &&
      this.selectedJunctions.size === 0 &&
      this.mode !== "measure" &&
      !busy
    ) {
      const id = [...this.selected][0]!;
      const c = this.graph.components.get(id);
      if (c) {
        const box = this.componentBox(c);
        const s = this.world.scale.x;
        rect = {
          x: this.world.position.x + box.x * s,
          y: this.world.position.y + box.y * s,
          width: box.width * s,
          height: box.height * s,
        };
      }
    }
    const key = rect
      ? `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`
      : "null";
    if (key !== this.lastAnchorKey) {
      this.lastAnchorKey = key;
      this.cb.onAnchor?.(rect);
    }
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
      this.selectedJunctions.clear();
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
      this.selectedJunctions.clear();
      this.selectedWires.add(id);
    }
    this.redrawSelection();
    this.emitSelect();
  }

  private selectJunction(id: number, additive: boolean): void {
    if (additive) {
      if (this.selectedJunctions.has(id)) this.selectedJunctions.delete(id);
      else this.selectedJunctions.add(id);
    } else {
      this.selected.clear();
      this.selectedWires.clear();
      this.selectedJunctions.clear();
      this.selectedJunctions.add(id);
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
      // A handle dot at each manual bend so the shaped route reads as draggable.
      for (const wp of w.waypoints ?? []) {
        const m = this.cellToWorld(wp);
        g.circle(m.x, m.y, 4).fill({ color: PALETTE.accent, alpha: 0.9 });
      }
    }
  }

  // --- probe (measure mode) -----------------------------------------------

  /** Press in measure mode: grab a nearby lead to drag, or drop the next lead. */
  private measurePress(wx: number, wy: number): boolean {
    if (this.probeMode === "A") {
      // Ammeter: point at a part (current through it) or a wire (branch current).
      const body = this.bodyHitTest(wx, wy);
      if (body) {
        this.ammeter = { kind: "comp", id: body.id };
        return true;
      }
      const wid = this.wireHitTest(wx, wy);
      if (wid !== null) {
        this.ammeter = { kind: "wire", id: wid };
        return true;
      }
      return false;
    }
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
    this.ammeter = null;
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

  /**
   * Net node for any wire endpoint (pin or junction). `probeNodes` only maps
   * *element* pins to nodes, so a junction — and any pin not in that map —
   * resolves by hopping across wires (a small BFS) to the first element pin on
   * the same net. Render-only; null when the net touches no element pin.
   */
  private endpointNode(e: Endpoint): number | null {
    if (!isJunctionRef(e)) {
      const direct = this.pinNode(e);
      if (direct !== null) return direct;
    }
    const seen = new Set<string>();
    const startKey = endpointKey(e);
    seen.add(startKey);
    let frontier: Endpoint[] = [e];
    while (frontier.length) {
      const nextFrontier: Endpoint[] = [];
      for (const cur of frontier) {
        const curKey = endpointKey(cur);
        for (const w of this.graph.wires.values()) {
          const fk = endpointKey(w.from);
          const tk = endpointKey(w.to);
          let other: Endpoint | null = null;
          if (fk === curKey) other = w.to;
          else if (tk === curKey) other = w.from;
          if (!other) continue;
          const ok = endpointKey(other);
          if (seen.has(ok)) continue;
          seen.add(ok);
          if (!isJunctionRef(other)) {
            const node = this.pinNode(other);
            if (node !== null) return node;
          }
          nextFrontier.push(other);
        }
      }
      frontier = nextFrontier;
    }
    return null;
  }

  private pinVoltage(e: Endpoint): number | null {
    const node = this.endpointNode(e);
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
      const node = w ? this.endpointNode(w.from) : null;
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
    if (this.probeMode === "A") {
      this.drawAmmeter(g);
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

  /** Probe readout: a ring on the clicked part/wire showing its current AND its
   * voltage at once (a real meter needs separate ports — a teaching note). */
  private drawAmmeter(g: Graphics): void {
    if (!this.ammeter) {
      this.probeText.visible = false;
      return;
    }
    let cur = 0;
    let volt = 0;
    let x = 0;
    let y = 0;
    let ok = false;
    if (this.ammeter.kind === "comp") {
      const c = this.graph.components.get(this.ammeter.id);
      if (c) {
        const e = this.electrical?.get(c.id);
        cur = e?.current ?? 0;
        volt = e?.vAcross ?? 0;
        const box = this.componentBox(c);
        x = box.x + box.width / 2;
        y = box.y + box.height / 2;
        ok = true;
      }
    } else {
      const w = this.graph.wires.get(this.ammeter.id);
      if (w) {
        cur = this.lastWireCurrents.get(w.id) ?? 0;
        volt = this.pinVoltage(w.from) ?? 0;
        const route = this.routeForWire(w);
        if (route.length >= 2) {
          const m = sampleRoute(route, 0.5);
          x = m.x;
          y = m.y;
          ok = true;
        }
      }
    }
    if (!ok) {
      this.probeText.visible = false;
      return;
    }
    g.circle(x, y, 12).fill({ color: 0x161020, alpha: 0.55 });
    g.circle(x, y, 12).stroke({ width: 2.5, color: PROBE_PLUS, alpha: 0.95 });
    this.probeText.text = "I " + fmtSI(cur, "A") + "  ·  V " + fmtSI(volt, "V");
    this.probeText.position.set(x, y - 22);
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
      if (this.measurePress(wp.x, wp.y)) return;
      if (!additive) this.panning = { lastX: e.global.x, lastY: e.global.y };
      return;
    }

    // Junction tool: a non-additive click drops a junction at the nearest grid
    // point on the clicked wire (the KiCad "place junction" action) — the same
    // create+split path as ending a wire on a wire, but with no incoming wire.
    // Falls through to pan when not over a wire (and shift-click still selects).
    if (this.mode === "junction" && !additive) {
      if (this.placeJunctionAt(wp.x, wp.y)) return;
      this.panning = { lastX: e.global.x, lastY: e.global.y };
      return;
    }

    const pin = this.pinHitTest(wp.x, wp.y);
    if (pin && (this.mode === "wire" || this.mode === "select")) {
      this.wiring = { from: pin };
      return;
    }

    // A junction acts like a pin: a plain press starts a branch wire from it; a
    // shift/ctrl press selects it (so the Delete key can remove it). A *double*-
    // click instead grabs it for dragging (move the junction; its incident wires
    // follow). It is tested before wires/bodies because it sits atop its wire.
    const jid = this.junctionHitTest(wp.x, wp.y);
    if (jid !== null) {
      if (additive) {
        this.selectJunction(jid, true);
        return;
      }
      if (this.mode === "wire" || this.mode === "select") {
        const now = performance.now();
        const dbl =
          this.lastJunctionTap !== null &&
          this.lastJunctionTap.id === jid &&
          now - this.lastJunctionTap.t < DOUBLE_CLICK_MS;
        if (dbl) {
          // Second click on the same junction: grab it for dragging instead of
          // starting a wire. (The first click's wire was a no-op release-in-place.)
          this.lastJunctionTap = null;
          this.cancelWiring();
          this.junctionDrag = { id: jid, moved: false };
          this.pendingUndo = this.graph.serialize();
          return;
        }
        this.lastJunctionTap = { id: jid, t: now };
        this.wiring = { from: { junctionId: jid } };
        return;
      }
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
      // A non-additive press also arms a segment-drag: grab THIS segment of the
      // trace and drag it perpendicular (KiCad-style), the endpoints staying put.
      // Drag a segment back in line with its neighbours to straighten it (cleaned
      // on drop). No-op arming if the wire has no drawable route.
      if (!additive) {
        const wire = this.graph.wires.get(wireId);
        const begun = wire ? this.beginWireSegmentDrag(wire, wp.x, wp.y) : null;
        if (begun) {
          this.wireDrag = {
            id: wireId,
            pts: begun.pts,
            bi: begun.bi,
            axis: begun.axis,
            moved: false,
          };
          this.pendingUndo = this.graph.serialize();
        }
      }
      return;
    }

    // Empty space. With a part armed, drop it here and stay armed — Factorio-style
    // place-and-repeat. Otherwise clear the selection and begin a pan.
    if (this.armed && !additive) {
      this.placeCell(
        this.armed,
        { col: snap(wp.x, PITCH), row: snap(wp.y, PITCH) },
        this.armedRot,
      );
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
      // Has the dragged segment actually shifted along its perpendicular axis?
      const d = this.wireDrag;
      const lo = d.pts[d.bi]!;
      const target = d.axis === "h" ? snap(wp.y, PITCH) : snap(wp.x, PITCH);
      const cur = d.axis === "h" ? lo.row : lo.col;
      if (target !== cur) d.moved = true;
      // Only reshape once the segment has truly moved, so a bare click (press +
      // release in place) never injects redundant colinear brackets into the wire.
      if (d.moved) this.updateWireSegmentDrag(wp.x, wp.y);
      return;
    }

    if (this.junctionDrag) {
      const cell = { col: snap(wp.x, PITCH), row: snap(wp.y, PITCH) };
      const j = this.graph.junctions.get(this.junctionDrag.id);
      if (j && (cell.col !== j.cell.col || cell.row !== j.cell.row)) {
        this.junctionDrag.moved = true;
        this.graph.moveJunction(this.junctionDrag.id, cell);
        // Incident wires reference the junction by id, so re-routing them is just
        // a redraw — connectivity (and thus the netlist) is untouched.
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
    // Idle hover: keep the placement ghost glued to the snapped cursor cell.
    if (this.armed) this.updateGhost();
  };

  private readonly onPointerUp = (e: FederatedPointerEvent): void => {
    if (this.draggingProbe) {
      this.draggingProbe = null;
      return;
    }
    if (this.wireDrag) {
      if (this.wireDrag.moved && this.pendingUndo) {
        // Collapse any bends that ended up colinear with their neighbours (e.g. a
        // segment dragged back in line, or the coincident endpoint-brackets left
        // un-offset) so the route stays minimal.
        const w = this.graph.wires.get(this.wireDrag.id);
        if (w) this.graph.setWireWaypoints(w.id, this.cleanWaypoints(w));
        this.commitUndo(this.pendingUndo);
        this.redrawWires();
        this.redrawSelection();
        this.cb.onChange?.(this.graph);
      }
      this.wireDrag = null;
      this.pendingUndo = null;
      return;
    }
    if (this.junctionDrag) {
      // Commit the move only if it actually moved (so a stray micro-drag from the
      // double-click doesn't push an empty undo). Topology is unchanged, so the
      // netlist `sig` is stable and the running sim isn't reset.
      if (this.junctionDrag.moved && this.pendingUndo) {
        this.commitUndo(this.pendingUndo);
        this.cb.onChange?.(this.graph);
      }
      this.junctionDrag = null;
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
      const pinTarget = this.pinHitTest(wp.x, wp.y);
      const jidTarget =
        pinTarget === null ? this.junctionHitTest(wp.x, wp.y) : null;
      const target: Endpoint | null = pinTarget
        ? pinTarget
        : jidTarget !== null
          ? { junctionId: jidTarget }
          : null;
      if (target) {
        const before = this.graph.serialize();
        const wire = this.graph.connect(this.wiring.from, target);
        if (wire) {
          this.pushUndo(before);
          this.redrawWires();
          this.cb.onChange?.(this.graph);
        }
      } else {
        this.finishWireOnWire(wp.x, wp.y);
      }
      this.cancelWiring();
    }
  };

  /**
   * Junction tool: drop a junction at the nearest grid point on the wire under
   * the cursor, reusing the same `junctionOnWire` create+split path as ending a
   * wire on a wire — but with no incoming wire, so it just taps the trace in place
   * (KiCad "place junction"). The two split halves give the junction its two
   * incident ends, so it survives pruning and ties those wires into one net.
   * Returns true if a junction was placed (i.e. the cursor was over a wire).
   */
  private placeJunctionAt(wx: number, wy: number): boolean {
    const wireId = this.wireHitTest(wx, wy);
    if (wireId === null) return false;
    const w = this.graph.wires.get(wireId);
    if (!w) return false;
    const route = this.routeForWire(w);
    if (route.length < 2) return false;
    const cp = closestOnPolyline(route, wx, wy);
    const cell = { col: snap(cp.x, PITCH), row: snap(cp.y, PITCH) };
    const before = this.graph.serialize();
    const j = this.graph.junctionOnWire(wireId, cell);
    if (!j) return false;
    this.pushUndo(before);
    this.redrawWires();
    this.cb.onChange?.(this.graph);
    return true;
  }

  /**
   * Finish an in-progress wire on an existing wire (a KiCad-style T): drop a
   * junction at the nearest grid point on the target wire's route, split that
   * wire so both halves meet the junction, and connect the new wire's end to it.
   * No-op if the release isn't over a wire (or is over the dragged wire's own
   * endpoint's wires only).
   */
  private finishWireOnWire(wx: number, wy: number): void {
    if (!this.wiring) return;
    const wireId = this.wireHitTest(wx, wy);
    if (wireId === null) return;
    const w = this.graph.wires.get(wireId);
    if (!w) return;
    // Don't junction onto a wire already incident to the start endpoint — that
    // would just fold a wire back on itself.
    const fromKey = endpointKey(this.wiring.from);
    if (endpointKey(w.from) === fromKey || endpointKey(w.to) === fromKey)
      return;
    const route = this.routeForWire(w);
    if (route.length < 2) return;
    const cp = closestOnPolyline(route, wx, wy);
    const cell = { col: snap(cp.x, PITCH), row: snap(cp.y, PITCH) };
    const before = this.graph.serialize();
    const j = this.graph.junctionOnWire(wireId, cell, this.wiring.from);
    if (j) {
      this.pushUndo(before);
      this.redrawWires();
      this.cb.onChange?.(this.graph);
    }
  }

  private readonly onRightDown = (e: FederatedPointerEvent): void => {
    e.preventDefault?.();
    // While a part is armed, right-click disarms instead of deleting.
    if (this.armed) {
      this.setArmed(null);
      this.cb.onArm?.(null);
      return;
    }
    const wp = this.screenToWorld(e.global.x, e.global.y);
    // Junction sits atop the wire it splits, so test it first.
    const jid = this.junctionHitTest(wp.x, wp.y);
    if (jid !== null) {
      this.pushUndo(this.graph.serialize());
      this.graph.removeJunction(jid);
      this.selectedJunctions.delete(jid);
      this.redrawWires();
      this.redrawSelection();
      this.cb.onChange?.(this.graph);
      return;
    }
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
   * and carries the KCL branch current as thickness + two flowing layers —
   * charge carriers and the energy they deliver. So a shared rail visibly
   * thickens toward a source and thins past each tap. Factorio belts, but
   * electricity. Redrawn every frame so it stays live.
   *
   * The two layers are the loop-tile idea (`docs/ui/visual-language.md`):
   * carriers integrate the
   * *signed* current, so they stream on DC and slosh in place on AC (the current
   * reverses each half-cycle). Energy integrates the *signed* power v·i: on a
   * resistor v and i reverse together, so the product stays positive and energy
   * streams steadily to the load even while the carriers slosh; on a reactive
   * part v and i are a quarter-cycle apart, so the energy sloshes in and back out
   * with no net delivery. Energy rides the high-potential wire (v≈0 returns carry
   * charge but little energy), which is exactly where the power flows.
   */
  private redrawWires(): void {
    const g = this.wireLayer;
    g.clear();
    const currents = this.computeWireCurrents();
    this.lastWireCurrents = currents;
    const fd = this.flowDelta;
    for (const w of this.graph.wires.values()) {
      const route = this.routeForWire(w);
      if (route.length < 2) continue;
      const v = this.pinVoltage(w.from);
      const color = v === null ? PALETTE.cyan : voltageColor(v);

      const cur = currents.get(w.id) ?? 0;
      const normC = saturate(Math.abs(cur) / I_REF);
      // Thickness tracks current over a wide range so amperage is legible at a
      // glance (bounded by the saturating normC — a huge current stays on-screen).
      const width = BELT_WIDTH_MIN + (BELT_WIDTH_MAX - BELT_WIDTH_MIN) * normC;
      polyline(g, route);
      g.stroke({ width: width + 4, color, alpha: 0.16 });
      polyline(g, route);
      g.stroke({ width, color, alpha: 0.95 });

      const len = routeLength(route);
      if (len <= 0) continue;
      const iNorm = Math.max(-1, Math.min(1, cur / I_REF));
      const vNorm = Math.max(-1, Math.min(1, (v ?? 0) / V_REF));
      // Direction factors: the SIGN of current (carriers) and of power v·i (energy),
      // saturated to ±1 just past FLOW_DIR_SAT so any real flow advances at the same
      // constant rate — magnitude never sets speed. The smooth ramp through zero
      // lets an AC half-cycle ease across the reversal instead of snapping.
      const carrierDir = Math.max(-1, Math.min(1, iNorm / FLOW_DIR_SAT));
      const energyDir = Math.max(
        -1,
        Math.min(1, (vNorm * iNorm) / FLOW_DIR_SAT),
      );

      // Carriers (charge): chevrons that stream on DC and slosh on AC. The offset is
      // an ABSOLUTE arc-length in pixels, advanced by `dir · flowDelta · PX_RATE`, so
      // pixel speed = constant (independent of trace length) — the root-cause fix.
      // The per-frame delta is clamped so an AC reversal at high tps eases instead of
      // jumping. Arrow size grows with current; spacing shrinks with current (so the
      // arrows-per-pixel is constant for equal current, matching across lengths).
      if (normC > 0.02) {
        const co = advanceBeltOffset(
          this.carrierOffset.get(w.id) ?? 0,
          carrierDir * fd * CARRIER_PX_RATE,
          len,
        );
        this.carrierOffset.set(w.id, co);
        const spacing =
          CARRIER_SPACING_MAX -
          (CARRIER_SPACING_MAX - CARRIER_SPACING_MIN) * normC;
        const size =
          CHEVRON_SIZE_MIN + (CHEVRON_SIZE_MAX - CHEVRON_SIZE_MIN) * normC;
        const alpha = 0.32 + 0.42 * normC;
        const dir = cur >= 0 ? 1 : -1;
        for (const d of beltDots(len, spacing, co)) {
          const s = sampleRouteAt(route, d);
          drawChevron(g, s.x, s.y, s.dx * dir, s.dy * dir, color, alpha, size);
        }
      }

      // Energy (power): warm-orange dots. Travel follows the *sign* of power v·i at
      // the constant belt rate (also pixel-based), so on a resistor (v,i reverse
      // together → product stays positive) they stream steadily to the load even
      // while the carriers slosh; on a reactive part the sign alternates and they
      // slosh in and back out. Density/alpha still encode how much power (|v·i|).
      const pNorm = Math.abs(vNorm * iNorm);
      if (pNorm > 0.012) {
        const eo = advanceBeltOffset(
          this.energyOffset.get(w.id) ?? 0,
          energyDir * fd * ENERGY_PX_RATE,
          len,
        );
        this.energyOffset.set(w.id, eo);
        for (const d of beltDots(len, ENERGY_SPACING, eo)) {
          const s = sampleRouteAt(route, d);
          g.circle(s.x, s.y, 2.4).fill({
            color: ENERGY_COLOR,
            alpha: 0.5 + 0.4 * pNorm,
          });
        }
      }
    }
    this.drawJunctions(g);
    // Drop offsets for wires that no longer exist (after a delete), so the maps
    // can't grow without bound across a long editing session.
    if (this.carrierOffset.size > this.graph.wires.size) {
      for (const id of this.carrierOffset.keys()) {
        if (!this.graph.wires.has(id)) {
          this.carrierOffset.delete(id);
          this.energyOffset.delete(id);
        }
      }
    }
    // Consumed: a same-frame redraw (e.g. mid-drag) must not advance the belt.
    this.flowDelta = 0;
  }

  /**
   * Draw the wire-to-wire junction dots (KiCad style): a small filled disc where
   * three+ wire-ends tie together, in the net's voltage colour so it reads as one
   * with the belt. A dark backing ring keeps it legible over the flowing belt.
   */
  private drawJunctions(g: Graphics): void {
    for (const j of this.graph.junctions.values()) {
      const p = this.cellToWorld(j.cell);
      const v = this.pinVoltage({ junctionId: j.id });
      const color = v === null ? PALETTE.cyan : voltageColor(v);
      const hot = this.selectedJunctions.has(j.id);
      g.circle(p.x, p.y, JUNCTION_R + 1.5).fill({ color: 0x0d0b16, alpha: 1 });
      g.circle(p.x, p.y, JUNCTION_R).fill({ color });
      if (hot) {
        g.circle(p.x, p.y, JUNCTION_R + 3).stroke({
          width: 1.5,
          color: PALETTE.accent,
          alpha: 0.9,
        });
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
   * The full orthogonal polyline for a wire: the auto L-route when it has no
   * manual waypoints, otherwise an orthogonal leg bending through each waypoint in
   * order (from → wp[0] → … → wp[n-1] → to). Empty if either endpoint has gone
   * missing. This is the single source of wire geometry (draw / hit-test /
   * selection handles / probe-snap).
   */
  private routeForWire(w: Wire): Point[] {
    const a = this.graph.endpointCell(w.from);
    const b = this.graph.endpointCell(w.to);
    if (!a || !b) return [];
    const wps = w.waypoints ?? [];
    const anchors = [a, ...wps, b].map((c) => this.cellToWorld(c));
    if (anchors.length === 2) return this.wireRoute(anchors[0]!, anchors[1]!);
    // Chain an orthogonal leg through each consecutive anchor pair, dropping the
    // duplicated joint between legs so the polyline is continuous.
    const out: Point[] = [];
    for (let i = 0; i + 1 < anchors.length; i++) {
      const leg = this.wireRoute(anchors[i]!, anchors[i + 1]!);
      if (i === 0) out.push(...leg);
      else out.push(...leg.slice(1));
    }
    return out;
  }

  /**
   * Drop redundant bends from a wire's waypoint list: any waypoint that sits on
   * the straight line between its neighbours (a colinear/straightened point) adds
   * nothing to the orthogonal route, so it is collapsed. Run on drop so dragging a
   * segment back into line with its neighbours cleans the route. Neighbours are the
   * endpoints for the first/last waypoint. Returns the cleaned array (possibly
   * empty, which clears the wire back to its auto L-route).
   */
  private cleanWaypoints(w: Wire): Cell[] {
    const a = this.graph.endpointCell(w.from);
    const b = this.graph.endpointCell(w.to);
    const wps = (w.waypoints ?? []).map((c) => ({ ...c }));
    if (!a || !b || wps.length === 0) return wps;
    const kept: Cell[] = [];
    for (let i = 0; i < wps.length; i++) {
      const prev = kept.length > 0 ? kept[kept.length - 1]! : a;
      const next = i + 1 < wps.length ? wps[i + 1]! : b;
      // Colinear with its neighbours (within half a cell) ⇒ the bend is redundant.
      if (
        distToSegment(
          wps[i]!.col,
          wps[i]!.row,
          prev.col,
          prev.row,
          next.col,
          next.row,
        ) < 0.5
      ) {
        continue;
      }
      kept.push(wps[i]!);
    }
    return kept;
  }

  /**
   * Begin a KiCad-style segment drag on wire `w` at world point (wx,wy). Picks the
   * grabbed segment of the drawn route, materializes the route's interior corners
   * as explicit grid waypoints (so the polyline corners become movable points), and
   * guarantees the grabbed segment's two brackets are *interior* waypoints — if a
   * bracket was the from/to endpoint, a coincident waypoint is spliced in so the
   * endpoint stays fixed and the route bends near it. Returns the working state, or
   * null if the wire has no drawable route. Only horizontal/vertical segments are
   * grabbable (the route is orthogonal).
   */
  private beginWireSegmentDrag(
    w: Wire,
    wx: number,
    wy: number,
  ): { pts: Cell[]; bi: number; axis: "h" | "v" } | null {
    const route = this.routeForWire(w);
    if (route.length < 2) return null;
    // Find the grabbed drawn segment.
    let segIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i + 1 < route.length; i++) {
      const d = distToSegment(
        wx,
        wy,
        route[i]!.x,
        route[i]!.y,
        route[i + 1]!.x,
        route[i + 1]!.y,
      );
      if (d < bestD) {
        bestD = d;
        segIdx = i;
      }
    }
    const s0 = route[segIdx]!;
    const s1 = route[segIdx + 1]!;
    // Run of the grabbed segment: horizontal (same Y) drags in row, vertical in col.
    const axis: "h" | "v" =
      Math.abs(s1.y - s0.y) <= Math.abs(s1.x - s0.x) ? "h" : "v";
    // Materialize every drawn corner as a grid cell: [fromCell, ...corners, toCell].
    // Endpoints keep their exact pin/junction cell; interior corners snap to grid
    // (each is already an orthogonal step, so this preserves the Manhattan shape).
    const pts: Cell[] = route.map((p, i) => {
      if (i === 0) return { ...this.graph.endpointCell(w.from)! };
      if (i === route.length - 1) return { ...this.graph.endpointCell(w.to)! };
      return { col: snap(p.x, PITCH), row: snap(p.y, PITCH) };
    });
    let bi = segIdx;
    // Ensure the right bracket is interior first (splice before touching the left,
    // so the left index is unaffected). Then ensure the left bracket is interior.
    if (bi + 1 === pts.length - 1) {
      pts.splice(bi + 1, 0, { ...pts[bi + 1]! }); // duplicate the to-endpoint inward
    }
    if (bi === 0) {
      pts.splice(1, 0, { ...pts[0]! }); // duplicate the from-endpoint inward
      bi = 1;
    }
    return { pts, bi, axis };
  }

  /**
   * Translate the dragged segment to the snapped pointer position along its
   * perpendicular axis, moving both bracket waypoints (interior, so the endpoints
   * stay put) and letting the neighbouring segments stretch. Writes the resulting
   * interior waypoints to the wire and redraws. Keeps the route orthogonal.
   */
  private updateWireSegmentDrag(wx: number, wy: number): void {
    const d = this.wireDrag;
    if (!d) return;
    const pts = d.pts;
    const lo = pts[d.bi]!;
    const hi = pts[d.bi + 1]!;
    if (d.axis === "h") {
      const row = snap(wy, PITCH);
      lo.row = row;
      hi.row = row;
    } else {
      const col = snap(wx, PITCH);
      lo.col = col;
      hi.col = col;
    }
    // Interior points are the waypoints; the two ends stay the pins/junctions.
    this.graph.setWireWaypoints(d.id, pts.slice(1, -1));
    this.redrawWires();
    this.redrawSelection();
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
      // Endpoint keys span pins and junctions; a junction injects nothing, so it
      // is just a KCL pass-through node where the branch current splits/merges.
      const f = endpointKey(w.from);
      const t = endpointKey(w.to);
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
    const start = this.graph.endpointCell(this.wiring.from);
    if (!start) return;
    const ps = this.cellToWorld(start);
    const snapTo = this.pinHitTest(this.pointer.x, this.pointer.y);
    // Preview a wire-to-wire junction: when releasing over a wire (not a pin),
    // snap the end to the nearest grid point on that wire's route and show a dot.
    let junctionPt: Point | null = null;
    if (!snapTo) {
      const wid = this.wireHitTest(this.pointer.x, this.pointer.y);
      const w = wid !== null ? this.graph.wires.get(wid) : undefined;
      const fromKey = endpointKey(this.wiring.from);
      if (
        w &&
        endpointKey(w.from) !== fromKey &&
        endpointKey(w.to) !== fromKey
      ) {
        const route = this.routeForWire(w);
        if (route.length >= 2) {
          const cp = closestOnPolyline(route, this.pointer.x, this.pointer.y);
          const cell = { col: snap(cp.x, PITCH), row: snap(cp.y, PITCH) };
          junctionPt = this.cellToWorld(cell);
        }
      }
    }
    const end = snapTo
      ? this.cellToWorld(this.graph.pinRefCell(snapTo) ?? start)
      : (junctionPt ?? this.pointer);
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
    } else if (junctionPt) {
      // A filled dot previewing the junction that the release will create.
      g.circle(junctionPt.x, junctionPt.y, JUNCTION_R).fill({
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

  /**
   * Record scope samples and track the displayed cursor. When the frame stepped
   * several ticks, `batch` carries each one (downsampled in the loop) so the scope
   * records at sub-frame resolution and AC charts cleanly at high ticks-per-second
   * instead of aliasing on one-sample-per-frame. Paused/scrubbing frames pass no
   * batch and record the single displayed snapshot. Either way the cursor is set
   * to the displayed tick afterward.
   */
  private recordScope(snap: Snapshot, batch?: SubFrameSample[]): void {
    const tick = Number(snap.tick);
    if (batch && batch.length > 0) {
      for (const s of batch) this.pushScopeSample(s.tick, s.state);
    } else {
      this.pushScopeSample(tick, snap.state);
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

  /** Append one scope sample for an advancing tick (or restart the window if the
   * timeline jumped before it, e.g. a scrub-back or reset). */
  private pushScopeSample(tick: number, state: ArrayLike<number>): void {
    const last = this.scopeSamples[this.scopeSamples.length - 1];
    if (!last || tick > last.tick) {
      this.scopeSamples.push({ tick, values: Array.from(state) });
      if (this.scopeSamples.length > MAX_SAMPLES) this.scopeSamples.shift();
    } else if (last && tick < (this.scopeSamples[0]?.tick ?? 0)) {
      // Scrubbed before the retained window (or the run was reset): start over.
      this.scopeSamples = [{ tick, values: Array.from(state) }];
    }
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
      // Place labels just outside the part's rotated extent — tag above the top,
      // value below the bottom, centred — so they never overlap the body at any
      // rotation (the cause of the rotated-number jumble).
      let minX = 0;
      let maxX = 0;
      let minY = 0;
      let maxY = 0;
      for (const p of this.pinPositions) {
        const r = rotPx(p.x, p.y, this.component.rot);
        minX = Math.min(minX, r.x);
        maxX = Math.max(maxX, r.x);
        minY = Math.min(minY, r.y);
        maxY = Math.max(maxY, r.y);
      }
      const cx = (minX + maxX) / 2;
      this.label.position.set(cx, minY - 16);
      this.value?.position.set(cx, maxY + 16);
      this.meter.position.set(cx, minY - 30);
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
    // Live "V across · I through" only for parts that have NO value popover (the
    // popover carries the readout for the rest, so this avoids the overlap).
    if (selected && isSymbol(this.kindTag) && !hasValue(this.kindTag)) {
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

/**
 * Advance a belt's absolute arc-length offset (pixels) by `delta`, clamping the
 * per-frame step so an AC reversal at high tps stays a smooth slosh instead of a
 * jump, then wrap into `[0, len)`. Pixel speed is `|delta|` and is independent of
 * `len`, so equal-current traces flow at the same on-screen speed at any length.
 */
function advanceBeltOffset(offset: number, delta: number, len: number): number {
  const step = Math.max(
    -MAX_FLOW_PX_PER_FRAME,
    Math.min(MAX_FLOW_PX_PER_FRAME, delta),
  );
  const next = offset + step;
  return ((next % len) + len) % len;
}

/**
 * Absolute arc-length positions (px) of belt dots along a trace of length `len`,
 * at the given pixel `spacing` and arc-length `offset`. Spacing is the spacing the
 * current asks for, so equal-current segments draw the same arrows-per-pixel at any
 * length (constant density). If that would exceed `MAX_BELT_DOTS` (a very long, high-
 * current trace) the spacing is stretched to spread exactly the cap evenly over the
 * whole belt — density degrades gracefully instead of leaving the tail bare, and the
 * graphics count stays bounded. Positions wrap through `offset` so the belt scrolls.
 */
function beltDots(len: number, spacing: number, offset: number): number[] {
  const want = Math.max(1, Math.ceil(len / spacing));
  const n = Math.min(MAX_BELT_DOTS, want);
  const step = n >= want ? spacing : len / n; // stretch only when capped
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((i * step + offset) % len);
  return out;
}

/** Position + unit direction at fraction `t` of a polyline's arc length. */
function sampleRoute(pts: Point[], t: number): RouteSample {
  return sampleRouteAt(pts, t * routeLength(pts));
}

/**
 * Position + unit direction at an absolute arc-length `dist` (in pixels) along a
 * polyline. Belt dots are placed by absolute distance — not a route fraction — so
 * a given current draws the same on-screen spacing and speed at every trace length.
 */
function sampleRouteAt(pts: Point[], dist: number): RouteSample {
  let target = dist;
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

/**
 * A flow chevron (arrowhead) at (x,y) pointing along (dx,dy). `size` is the
 * arrowhead half-length in pixels — it scales with current so amperage reads as
 * bigger arrows (never as faster ones); the stroke width tracks it so the glyph
 * stays proportioned. Defaults preserve the previous fixed size.
 */
function drawChevron(
  g: Graphics,
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: number,
  alpha: number,
  size = 4,
): void {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const s = size;
  const bx = x - ux * s;
  const by = y - uy * s;
  g.moveTo(bx + px * s, by + py * s)
    .lineTo(x, y)
    .lineTo(bx - px * s, by - py * s);
  g.stroke({ width: Math.max(2, s * 0.5), color, alpha });
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

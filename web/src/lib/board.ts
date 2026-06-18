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
import { drawDetail, hasDetail } from "./detailDrawers";
import { drawAnalogy, hasAnalogy } from "./analogyDrawers";
import { apparentFreq, blurFactor, mix, setStudsVisible } from "./tierKit";

/** Interaction modes surfaced as a toolbar in the HUD. */
export type Mode =
  | "select"
  | "place"
  | "wire"
  | "measure"
  | "junction"
  | "label"
  | "pan";

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
/**
 * The board's detail LENS — which of the owner's three fidelity tiers placed parts
 * render in. "schematic" is the always-on board symbol; "analogy"/"reality" swap a
 * part to its full-panel illustration ONCE zoomed in past {@link TIER_ZOOM} (a
 * working level-of-detail: zoom in to add factory/reality detail, zoom out for a
 * clean, cheap overview). Mirrors the info panel's `DiagramMode`.
 */
export type BoardLens = "schematic" | "analogy" | "reality";
/** World zoom at/above which analogy/reality parts swap to the full illustration. */
const TIER_ZOOM = 2.2;
/** Deeper still: the tier illustration also gets its simple pinout labels (the
 * "full detail" LOD). Below this you get the cleaner label-free illustration. */
const DETAIL_ZOOM = 4.5;
/** Radius of the filled wire-to-wire junction dot (KiCad-style). */
const JUNCTION_R = 4;
const MAX_SAMPLES = 240;
// Fixed integration step (s) — the determinism contract's dt. Display-only here
// (ticks → seconds for the scope's time-window label); never feeds the sim.
const DT_SECONDS = 2e-6;
// Selectable scope time windows, in ticks: 0.48 ms / 4.8 ms / 48 ms / 0.48 s. The
// first equals the original fixed window, so the default changes nothing; the
// longer spans are *decimated* down to ~MAX_SAMPLES points so a low-frequency AC
// cycle (which the short window can't fit) becomes visible without a huge buffer.
const SCOPE_SPAN_TICKS = [240, 2400, 24000, 240000];
// Auto time-base: fit this many full periods of the dominant trace in the window,
// clamped to a sane tick range (≈ the preset extremes, a touch wider).
const AUTO_CYCLES = 3;
const AUTO_SPAN_MIN = 120;
const AUTO_SPAN_MAX = 1_200_000;
const MIN_SCALE = 0.35;
// Zoom further in than before so the full-detail tier (with pinout labels) has room
// to read. The LOD swaps still gate on TIER_ZOOM / DETAIL_ZOOM, well below this.
const MAX_SCALE = 8;
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
// Faint shimmer-band vibration rate on the bounded flow clock — a "too fast to
// resolve" wobble for the high-frequency carrier→band handoff, NOT a real cycle.
const SHIMMER_VIB = 9;

// --- conduit skin (analogy/reality LOD) --------------------------------------
// Zoomed in under the analogy/reality lens, a bare trace is re-skinned as the same
// conduit the components become: an ANALOGY pipe (steel wall + dark bore + voltage-
// tinted water, carriers flowing WITH the current) or a REALITY metal conductor
// (bright sheath + glowing core, an electron gas drifting AGAINST the current). Both
// keep the bus language — colour = net voltage, density/thickness = current — just
// re-skinned to match the part illustrations. Kicks in at the same `TIER_ZOOM`.
const PIPE_WALL = 0x6b6488; // steel pipe wall
const PIPE_WATER = 0x8fd6ff; // bright water carriers
const COND_CASING = 0xc8915a; // copper conductor sheath (reads as real wire)
const COND_ELEC = 0x9fe6ff; // electron carriers (drift against the current)

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
  /** Orientation in 90° CW steps (0..3), so the info-panel pinout can be drawn
   * matching the way the part actually points on the board. */
  rot: number;
  /** An AC source's peak amplitude in volts (its second scalar, beside `value` =
   * frequency). Undefined for kinds that have no amplitude. */
  amp?: number;
  /** A potentiometer's wiper position in [0,1] (its second scalar, beside `value` =
   * total resistance). Undefined for kinds with no wiper. */
  wiper?: number;
  /** A thermistor's body temperature in °C (its second scalar, beside `value` =
   * nominal resistance). Undefined for non-thermistor kinds. */
  temp?: number;
  /** A digital part's logic-family index (0 = Ideal, 1 = CMOS, 2 = TTL). Undefined
   * for non-digital kinds. */
  family?: number;
  /** A logic gate's open-drain output mode (true = open-drain, else push-pull).
   * Undefined for non-gate kinds. */
  openDrain?: boolean;
  /** The player's custom label for this part (shown in place of the kind tag).
   * Undefined when unnamed. */
  label?: string;
}

/** A relocatable copy of a board fragment: the selected components (with their
 * placement + scalars), the wires whose *both* ends are pins of those components
 * (their internal traces), and any net labels pinned to those pins. Coordinates are
 * absolute cells; paste re-anchors them with a growing offset. In-memory only. */
interface ClipboardSnippet {
  comps: {
    oldId: number;
    kind: string;
    col: number;
    row: number;
    value: number;
    rot: number;
    amp?: number;
    wiper?: number;
    temp?: number;
    family?: number;
    openDrain?: boolean;
    label?: string;
  }[];
  wires: { aId: number; aPin: number; bId: number; bPin: number }[];
  labels: { compId: number; pin: number; name: string }[];
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
  /** Fired when the board changes its own mode (e.g. the Pan tool yields to Build
   * when you grab a part/wire), so the HUD's tool selector follows. */
  onMode?: (mode: Mode) => void;
  /** A presentation-only change that must persist (e.g. dragging a net label's tag):
   * the HUD should save the board + refresh undo state, but NOT rebuild the netlist or
   * rewind the clock the way {@link BoardCallbacks.onChange} does. */
  onPersist?: (graph: BoardGraph) => void;
  /** Per-frame screen rect of the lone selected part (or null) to anchor a popover. */
  onAnchor?: (rect: AnchorRect | null) => void;
  /** Open the deep info panel for a component — fired by a double-click on its body
   * (the part is also made the lone selection first, so the panel and the board
   * agree on which part). The HUD decides what "open" means (sets `infoOpen`). */
  onInspect?: (id: number) => void;
  /**
   * Open the inline net-label name editor. Fired when a label-mode click lands on
   * a pin/junction (or an existing tag): the HUD shows a small input seeded with
   * `initial` at `rect`, and on commit calls back `addLabel`/`renameLabel`. `id` is
   * the existing label id when editing one, else null (a new label to create at
   * `at`). A null payload closes the editor. The endpoint `at` is plain data.
   */
  onLabelEdit?: (
    req: {
      id: number | null;
      at: Endpoint;
      initial: string;
      rect: AnchorRect;
    } | null,
  ) => void;
}

export class Board {
  private readonly world = new Container();
  private readonly grid = new Graphics();
  private readonly wireLayer = new Graphics();
  private readonly groundLayer = new Graphics();
  private readonly groundLabels: Text[] = [];
  private readonly selectionLayer = new Graphics();
  private readonly marqueeLayer = new Graphics();
  private readonly pendingWire = new Graphics();
  private readonly componentLayer = new Container();
  // Translucent placement preview ("ghost") of the armed part at the snapped
  // cursor cell. A dedicated low-alpha layer holding one reused Graphics — no DOM,
  // and it rotates the held part's glyph in place via the holder's rotation.
  private readonly ghostLayer = new Container();
  // The floating paste preview: a translucent glyph per clipboard component, drawn
  // at the cursor and draggable/rotatable until a click drops the group.
  private readonly pasteGhostLayer = new Container();
  private readonly pasteGhostGlyphs: Graphics[] = [];
  private readonly ghostGlyph = new Graphics();
  // Net-label name tags ("VCC" etc.): a Graphics for each tag's pill background +
  // leader, plus a growable pool of Text for the names. Drawn in the world so they
  // pan/zoom with the board; pooled like the scope legend so re-layout is cheap.
  private readonly netLabelLayer = new Container();
  private readonly netLabelGfx = new Graphics();
  private readonly netLabelTexts: Text[] = [];
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
  // The ammeter has its own readout (in the clamp's red) so it can show at the
  // same time as the voltmeter's ΔV rather than fighting over one label.
  private readonly ammText = new Text({
    text: "",
    style: {
      fill: PROBE_PLUS,
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
  private readonly selectedLabels = new Set<number>();
  // The net label whose name is being edited in the HUD input right now (its tag
  // text is hidden on the board meanwhile). Null when no editor is open.
  private editingLabelId: number | null = null;
  // The pending label edit: the endpoint to attach to and the existing label id
  // (null ⇒ create a new one on commit). Set when the HUD editor opens; consumed
  // by commitLabel / cleared by cancelLabelEdit.
  private pendingLabel: {
    id: number | null;
    at: Endpoint;
    pos?: Cell;
  } | null = null;
  // Per-tick scope history (one entry per simulated tick, not per render frame)
  // so the scope freezes when paused and aligns to the timeline.
  private scopeSamples: { tick: number; values: number[] }[] = [];
  // Per-node scope controls, driven from the telemetry panel: custom names,
  // hidden traces, and an enlarged scope.
  private readonly nodeLabels = new Map<number, string>();
  private readonly nodeHidden = new Set<number>();
  private scopeExpanded = false;
  // Index into SCOPE_SPAN_TICKS — the visible scope time window (decimated record).
  private scopeSpanIdx = 0;
  // The latest displayed tick (true sim tick, advances every frame — not just when a
  // decimated sample lands). The scope's x-axis maps by TICK against this, so the
  // trace pans smoothly at any span/rate instead of stepping once per decimated sample.
  private scopeTick = 0;
  // Auto time-base: when on, the span is set so ~AUTO_CYCLES periods of the
  // biggest-swinging trace are visible; `scopeAutoSpan` is the smoothed live value.
  private scopeAuto = false;
  private scopeAutoSpan = SCOPE_SPAN_TICKS[1]!;
  // Net names per node from the netlist's net labels (e.g. node 3 → "VCC"): the
  // display name for a labelled net, used when the node has no explicit telemetry
  // rename. Refreshed whenever the netlist rebuilds (see setNetNames).
  private netNames = new Map<number, string>();

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
  // The last conduit DRAW path per wire (nudged + bridged + rounded), cached each
  // redraw so hit-testing can pick the pipe where it's actually drawn — not the logical
  // route it was offset from (otherwise the nudged pipe feels unclickable / floating).
  // Empty in schematic mode, where the logical route is exactly what's drawn.
  private conduitDrawRoutes = new Map<number, Point[]>();
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
  // KiCad-style click-to-continue wiring tracks, per press, whether the pointer left
  // the cell it went down in. A press+release IN PLACE (a click) leaves the wire
  // *pending* so the next click extends it (drop corners, T into a trace, finish on a
  // pin); a press-move-release (a drag) is the classic drag-to-wire and completes the
  // segment on release. `wiringDownCell` is the snapped down-cell used to detect that
  // movement. Both are reset each time a wiring press begins/continues.
  private wiringMoved = false;
  private wiringDownCell: Cell | null = null;
  // The wire + world point the last press landed on, so Delete can drop *only that
  // segment* of a multi-bend run rather than the whole pin-to-pin wire. The leg is
  // resolved from this point against the wire's *current* geometry at delete time
  // (so a reshape between click and delete can't make it stale). Set whenever a wire
  // is clicked; cleared when the selection clears.
  private lastWireClick: { wireId: number; x: number; y: number } | null = null;
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
  // Dragging a net label's tag pill (it follows the cursor; the anchor stays put).
  private labelDrag: { id: number; moved: boolean } | null = null;
  // Timestamp + id of the last junction press, to detect a double-click (a second
  // press on the same junction within DOUBLE_CLICK_MS grabs it for dragging).
  private lastJunctionTap: { id: number; t: number } | null = null;
  // Last component-body press (id + time), so a second press on the same body
  // within DOUBLE_CLICK_MS is recognised as a double-click → open its info panel.
  private lastBodyTap: { id: number; t: number } | null = null;
  private panning: { lastX: number; lastY: number } | null = null;
  // Marquee (rubber-band) selection: a drag on empty space in Select mode sweeps a
  // box; on release every component inside it (and every wire wholly inside) is
  // selected. World coords; `additive` keeps the prior selection (shift-drag).
  private marquee: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    additive: boolean;
  } | null = null;
  // In-memory copy/paste clipboard: a relocatable snippet of the board (components
  // + their internal wires + net labels on their pins). `pasteSeq` grows the paste
  // offset so repeated pastes fan out instead of stacking exactly.
  private clipboard: ClipboardSnippet | null = null;
  private pasteSeq = 0;
  // Active paste placement: the floating clipboard group following the cursor, with
  // its own added rotation, anchored to the clipboard's top-left reference cell.
  private pasting: {
    snippet: ClipboardSnippet;
    refCol: number;
    refRow: number;
    rot: number;
  } | null = null;
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
  // Per-node RMS voltage over this frame's sub-frame batch (non-aliased, unlike the
  // once-per-frame `snap.state`). Used to stabilise the wire colour on fast AC so a
  // rapidly-reversing voltage stops strobing the hue. Undefined when no batch (paused
  // / scrubbing) — the colour then tracks the instantaneous voltage as before.
  private nodeVrms: Float64Array | undefined;

  constructor(
    private readonly app: Application,
    private readonly cb: BoardCallbacks = {},
  ) {
    this.world.addChild(this.grid);
    this.world.addChild(this.wireLayer);
    this.world.addChild(this.groundLayer);
    this.world.addChild(this.selectionLayer);
    this.world.addChild(this.componentLayer);
    // Net-label tags ride above the components so the name is never occluded, and
    // below the ghost / pending-wire / probe overlays. Non-interactive (hit-testing
    // is by endpoint, not the tag glyph).
    this.netLabelLayer.addChild(this.netLabelGfx);
    this.netLabelLayer.eventMode = "none";
    this.world.addChild(this.netLabelLayer);
    // The marquee rubber-band rides above everything but the ghost/probe overlays;
    // non-interactive and hidden until a select-mode empty drag begins.
    this.marqueeLayer.eventMode = "none";
    this.world.addChild(this.marqueeLayer);
    // The ghost rides above the components so the preview is never occluded, and
    // below the pending-wire/probe overlays. It is non-interactive and starts hidden.
    this.ghostLayer.addChild(this.ghostGlyph);
    this.ghostLayer.eventMode = "none";
    this.ghostLayer.alpha = GHOST_ALPHA;
    this.ghostLayer.visible = false;
    this.world.addChild(this.ghostLayer);
    this.pasteGhostLayer.eventMode = "none";
    this.pasteGhostLayer.alpha = GHOST_ALPHA;
    this.pasteGhostLayer.visible = false;
    this.world.addChild(this.pasteGhostLayer);
    this.world.addChild(this.pendingWire);
    this.world.addChild(this.probeLayer);
    this.world.addChild(this.probeText);
    this.probeText.anchor.set(0.5);
    this.probeText.resolution = DPR;
    this.probeText.visible = false;
    this.world.addChild(this.ammText);
    this.ammText.anchor.set(0.5);
    this.ammText.resolution = DPR;
    this.ammText.visible = false;
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
    if (mode !== "label") this.endLabelEdit();
    this.updateCursor();
    this.updateGhost();
  }

  /** Arm a part kind: clicking empty board cells now drops it (place-and-repeat). */
  setArmed(kind: string | null): void {
    // Arming a part and a floating paste are mutually exclusive placements.
    if (kind !== null) this.cancelPaste();
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

  /** Esc: cancel an open label editor, then an in-progress wire, else clear the
   * selection. */
  escape(): void {
    if (this.pasting) {
      this.cancelPaste();
      return;
    }
    if (this.editingLabelId !== null || this.pendingLabel !== null) {
      this.endLabelEdit();
      return;
    }
    if (this.wiring) {
      this.cancelWiring();
      return;
    }
    this.clearSelection();
  }

  private updateCursor(): void {
    this.app.stage.cursor =
      this.armed || this.pasting
        ? "copy"
        : this.mode === "pan"
          ? "grab"
          : this.mode === "measure" ||
              this.mode === "junction" ||
              this.mode === "label"
            ? "crosshair"
            : "default";
  }

  private readonly onPointerEnter = (): void => {
    this.pointerInside = true;
    this.updateGhost();
    this.updatePasteGhost();
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.updateGhost();
    this.updatePasteGhost();
  };

  /**
   * Draw the translucent placement preview of the armed part at the grid-snapped
   * cursor cell, reusing the real glyph drawer at a low alpha on the ghost layer.
   * Shown only while a part is armed and the pointer is over the board; hidden
   * otherwise. The held part's placement rotation rotates the glyph in place, and
   * it snaps to `cellToWorld(cell)` so it sits exactly where a drop would land.
   */
  private updateGhost(): void {
    const g = this.ghostGlyph;
    // Armed-part placement ghost: the real glyph at the snapped cell.
    if (this.armed !== null && this.pointerInside) {
      const kind = PART_KINDS[this.armed];
      if (kind) {
        const cell = {
          col: snap(this.pointer.x, PITCH),
          row: snap(this.pointer.y, PITCH),
        };
        const o = this.cellToWorld(cell);
        const color = PALETTE[kind.colorKey];
        const pins = kind.pins.map((p) => ({
          x: p.dx * PITCH,
          y: p.dy * PITCH,
        }));
        g.clear();
        // Rotate the glyph in place exactly like a placed component's holder
        // does, so the preview matches the orientation it will be dropped at.
        g.rotation = (this.armedRot * Math.PI) / 2;
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
        this.ghostLayer.alpha = GHOST_ALPHA;
        this.ghostLayer.position.set(o.x, o.y);
        this.ghostLayer.visible = true;
        return;
      }
    }
    // Junction-placer ghost: a translucent junction snapped to the wire under the
    // cursor (or the grid), so the tool reads as active instead of looking inert.
    if (this.armed === null && this.mode === "junction" && this.pointerInside) {
      const pos = this.junctionGhostPos();
      g.clear();
      g.rotation = 0;
      g.circle(0, 0, JUNCTION_R + 1.5).fill({ color: 0x0d0b16, alpha: 1 });
      g.circle(0, 0, JUNCTION_R).fill({ color: PALETTE.cyan });
      this.ghostLayer.alpha = 0.55;
      this.ghostLayer.position.set(pos.x, pos.y);
      this.ghostLayer.visible = true;
      return;
    }
    // Label ghost: a translucent name-pill at the point a click would attach it (a
    // pin, a junction, or a bare trace), so the tool reads as active and shows where
    // the label will land.
    if (this.armed === null && this.mode === "label" && this.pointerInside) {
      const pos = this.labelGhostPos();
      g.clear();
      g.rotation = 0;
      const px = 12;
      const py = -18;
      const w = 34;
      const h = 18;
      g.circle(0, 0, 2.4).fill({ color: PALETTE.cyan });
      g.moveTo(0, 0)
        .lineTo(px, py + h / 2)
        .stroke({ width: 1, color: PALETTE.cyan, alpha: 0.6 });
      g.roundRect(px, py, w, h, 3).fill({ color: 0x0d0b16, alpha: 0.9 });
      g.roundRect(px, py, w, h, 3).stroke({
        width: 1,
        color: PALETTE.cyan,
        alpha: 0.7,
      });
      for (let i = 0; i < 3; i++) {
        g.circle(px + 9 + i * 7, py + h / 2, 1.4).fill({
          color: PALETTE.cyan,
          alpha: 0.5,
        });
      }
      this.ghostLayer.alpha = 0.55;
      this.ghostLayer.position.set(pos.x, pos.y);
      this.ghostLayer.visible = true;
      return;
    }
    this.ghostLayer.visible = false;
    g.clear();
  }

  /** Where the label-tool ghost sits: a pin, then a junction, then the grid-snapped
   * point on the wire under the cursor — matching where a click would attach the
   * label. Falls back to the bare grid cell. */
  private labelGhostPos(): Point {
    const pin = this.pinHitTest(this.pointer.x, this.pointer.y);
    if (pin) {
      const c = this.graph.endpointCell(pin);
      if (c) return this.cellToWorld(c);
    }
    const jid = this.junctionHitTest(this.pointer.x, this.pointer.y);
    if (jid !== null) {
      const c = this.graph.endpointCell({ junctionId: jid });
      if (c) return this.cellToWorld(c);
    }
    return this.cellToWorld({
      col: snap(this.pointer.x, PITCH),
      row: snap(this.pointer.y, PITCH),
    });
  }

  /** Where the junction-placer ghost sits: snapped to the wire under the cursor
   * (where a click would drop a junction), else the bare grid cell. */
  private junctionGhostPos(): Point {
    const wireId = this.wireHitTest(this.pointer.x, this.pointer.y);
    if (wireId !== null) {
      const w = this.graph.wires.get(wireId);
      if (w) {
        const route = this.routeForWire(w);
        if (route.length >= 2) {
          const cp = closestOnPolyline(route, this.pointer.x, this.pointer.y);
          return this.cellToWorld({
            col: snap(cp.x, PITCH),
            row: snap(cp.y, PITCH),
          });
        }
      }
    }
    return this.cellToWorld({
      col: snap(this.pointer.x, PITCH),
      row: snap(this.pointer.y, PITCH),
    });
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

  /** The active detail lens (schematic / analogy / reality); see {@link BoardLens}. */
  private lens: BoardLens = "schematic";

  /** Switch the component art style (schematic symbols ↔ factory machines). The
   * glyphs redraw with it next frame; pins and wiring are unchanged. */
  setStyle(style: GlyphStyle): void {
    setGlyphStyle(style);
  }

  /** Set the board's detail lens. The small on-board glyph is always the schematic
   * symbol; analogy/reality only change which full-panel illustration a part morphs
   * into when zoomed in past {@link TIER_ZOOM}. Parts pick it up next frame. */
  setLens(lens: BoardLens): void {
    this.lens = lens;
    setGlyphStyle("schematic");
  }

  /** Whether the zoom level-of-detail is active. Off ⇒ every part stays the clean
   * schematic symbol at any zoom (the lens is ignored), for a distraction-free board. */
  private lodEnabled = true;
  setLod(enabled: boolean): void {
    this.lodEnabled = enabled;
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

  /** Advance the scope's visible time window to the next preset, then to AUTO, then
   * wrap. Clears the trace so it refills at the new decimation. Returns the new label. */
  cycleScopeSpan(): string {
    if (this.scopeAuto) {
      this.scopeAuto = false;
      this.scopeSpanIdx = 0;
    } else if (this.scopeSpanIdx >= SCOPE_SPAN_TICKS.length - 1) {
      this.scopeAuto = true; // last preset → auto time-base
    } else {
      this.scopeSpanIdx += 1;
    }
    this.clearScope();
    // The button shows a static "auto" (the live, adapting window is drawn in the
    // scope overlay instead); presets show their fixed window.
    return this.scopeAuto ? "auto" : this.scopeSpanLabel();
  }

  /** The visible window in ticks: the auto-fit span when AUTO, else the preset. */
  private effectiveScopeSpan(): number {
    return this.scopeAuto
      ? Math.max(1, Math.round(this.scopeAutoSpan))
      : SCOPE_SPAN_TICKS[this.scopeSpanIdx]!;
  }

  /** Human label for the current scope time window (e.g. "4.8 ms" or "auto · 60 ms"). */
  scopeSpanLabel(): string {
    const s = this.effectiveScopeSpan() * DT_SECONDS;
    const win =
      s < 1e-3
        ? `${(s * 1e6).toFixed(0)} µs`
        : s < 1
          ? `${(s * 1e3).toFixed(s * 1e3 < 10 ? 1 : 0)} ms`
          : `${s.toFixed(2)} s`;
    return this.scopeAuto ? `auto · ${win}` : win;
  }

  /**
   * Auto time-base: size the window to ~{@link AUTO_CYCLES} periods of the
   * biggest-swinging visible trace. The period comes from the average spacing of its
   * upward mid-crossings (interpolated to sub-tick); the span eases toward the target
   * so it doesn't twitch. No oscillation (DC / flat) ⇒ leave the span as-is; too few
   * crossings (window too short) ⇒ widen to search. Pure display — no sim coupling.
   */
  private updateAutoSpan(): void {
    const samples = this.scopeSamples;
    if (samples.length < 4) return;
    const chans = samples[samples.length - 1]!.values.length;
    let bestC = -1;
    let bestPP = 0;
    let bestLo = 0;
    let bestHi = 0;
    for (let c = 1; c < chans; c++) {
      if (this.nodeHidden.has(c)) continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (const s of samples) {
        const v = s.values[c] ?? 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > bestPP) {
        bestPP = hi - lo;
        bestC = c;
        bestLo = lo;
        bestHi = hi;
      }
    }
    if (bestC < 0 || bestPP < 0.05) return; // DC / flat: keep the current span
    const mid = (bestLo + bestHi) / 2;
    let firstT = -1;
    let lastT = -1;
    let n = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!.values[bestC] ?? 0;
      const b = samples[i]!.values[bestC] ?? 0;
      if (a < mid && b >= mid) {
        const ta = samples[i - 1]!.tick;
        const tb = samples[i]!.tick;
        const tc = ta + (tb - ta) * ((mid - a) / (b - a || 1));
        if (firstT < 0) firstT = tc;
        lastT = tc;
        n++;
      }
    }
    if (n < 2 || lastT <= firstT) {
      // too few crossings: the window may be shorter than a period — widen to search.
      const target = Math.min(AUTO_SPAN_MAX, this.scopeAutoSpan * 1.8);
      this.scopeAutoSpan += (target - this.scopeAutoSpan) * 0.1;
      return;
    }
    const period = (lastT - firstT) / (n - 1);
    const target = Math.max(
      AUTO_SPAN_MIN,
      Math.min(AUTO_SPAN_MAX, period * AUTO_CYCLES),
    );
    this.scopeAutoSpan += (target - this.scopeAutoSpan) * 0.15;
  }

  /**
   * A node's display name, in precedence order: an explicit telemetry rename, then
   * its net label name (e.g. `VCC` from a {@link NetLabel}), then GND / "Node i".
   */
  private nodeName(i: number): string {
    return (
      this.nodeLabels.get(i) ??
      this.netNames.get(i) ??
      (i === 0 ? "GND" : "Node " + i)
    );
  }

  /** Install the net-label names per node (node index → name) from the netlist,
   * so the scope legend shows `VCC` instead of `Node 3` for a labelled net. */
  setNetNames(map: Map<number, string> | null): void {
    this.netNames = map ? new Map(map) : new Map();
  }

  /**
   * Drop the scope's recorded sample history so the trace starts fresh. Called
   * whenever the circuit actually changes — an example loaded, the board cleared, or
   * a component value / net edited (i.e. the netlist signature changed and the sim
   * was reinstalled). Without this the scope keeps the previous circuit's samples
   * and only overwrites them once the new run's tick passes the old window's end,
   * leaving stale data on screen in the meantime. The node count and meaning can
   * change across circuits, so the old samples aren't comparable anyway — clear them.
   */
  clearScope(): void {
    this.scopeSamples = [];
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
    // Junction each pin got tied into when it split a trace (case 3). Used after
    // the loop to curtail any segment of one wire that spanned *between* two of
    // this part's pins (which would otherwise short them in parallel with the part).
    const splitJunctions: number[] = [];
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
        const j = this.graph.junctionOnWire(wireId, cell, pinRef);
        if (j) splitJunctions.push(j.id);
      }
      // 4) Empty cell: normal placement, nothing to splice.
    }
    this.removeSpannedSegments(splitJunctions);
  }

  /**
   * After {@link spliceOnPlace} ties a part's pins into split junctions, drop any
   * wire now running *directly between two of those junctions* — the stretch of an
   * existing track that lay between two pins of the just-placed part. Left in place
   * it shorts those pins in parallel with the new part; removing it makes the part
   * bridge those nodes (inserted in series into the track), which is what dropping a
   * component across a trace should mean. Connectivity is preserved: each junction
   * keeps its pin-wire plus the outer half of the original run, so the two track ends
   * still reach the part's pins through the junctions (and `buildNetlist` ties them
   * into the right nets).
   *
   * The incidence guard keeps a removal from orphaning a junction: each end must
   * retain ≥2 incident wires (its pin-wire + an outer half) so it survives pruning
   * and the landed pin stays joined to its net. The common two-pin "insert across a
   * trace" case leaves both ends exactly that; only a rarer 3+ collinear-pins-on-one-
   * wire case could strand a middle junction, and there the segment is left intact
   * rather than disconnect a pin. No-op for fewer than two split junctions.
   */
  private removeSpannedSegments(junctionIds: number[]): void {
    if (junctionIds.length < 2) return;
    const set = new Set(junctionIds);
    for (const w of [...this.graph.wires.values()]) {
      if (
        isJunctionRef(w.from) &&
        isJunctionRef(w.to) &&
        set.has(w.from.junctionId) &&
        set.has(w.to.junctionId) &&
        this.junctionIncidence(w.from.junctionId) > 2 &&
        this.junctionIncidence(w.to.junctionId) > 2
      ) {
        this.graph.removeWire(w.id);
      }
    }
  }

  /** How many wires are incident to a junction (both ends counted per wire). */
  private junctionIncidence(junctionId: number): number {
    let n = 0;
    for (const w of this.graph.wires.values()) {
      if (
        (isJunctionRef(w.from) && w.from.junctionId === junctionId) ||
        (isJunctionRef(w.to) && w.to.junctionId === junctionId)
      ) {
        n++;
      }
    }
    return n;
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
    if (
      this.graph.components.size === 0 &&
      this.graph.wires.size === 0 &&
      this.graph.netLabels.size === 0
    ) {
      return;
    }
    this.pushUndo(this.graph.serialize());
    this.endLabelEdit();
    this.graph.clear();
    this.rebuildNodes();
    this.clearSelection();
    this.redrawWires();
    this.cb.onChange?.(this.graph);
  }

  /** Delete the current selection (components + wires + junctions + net labels). */
  deleteSelection(): void {
    if (
      this.selected.size === 0 &&
      this.selectedWires.size === 0 &&
      this.selectedJunctions.size === 0 &&
      this.selectedLabels.size === 0
    ) {
      return;
    }
    // Lone wire selected with a known clicked leg: drop only that segment of the run
    // (split the multi-bend wire there), not the whole pin-to-pin wire. A straight
    // wire has a single leg, so this still removes it entirely; a multi-select or a
    // wire-plus-other-things selection takes the wholesale path below instead.
    if (
      this.selected.size === 0 &&
      this.selectedWires.size === 1 &&
      this.selectedJunctions.size === 0 &&
      this.selectedLabels.size === 0 &&
      this.lastWireClick !== null &&
      this.selectedWires.has(this.lastWireClick.wireId)
    ) {
      const w = this.graph.wires.get(this.lastWireClick.wireId);
      const leg = w
        ? this.wireLegIndexAt(w, this.lastWireClick.x, this.lastWireClick.y)
        : null;
      if (w && leg !== null) {
        this.pushUndo(this.graph.serialize());
        this.graph.deleteWireSegment(w.id, leg);
        this.rebuildNodes();
        this.clearSelection();
        this.redrawWires();
        this.cb.onChange?.(this.graph);
        return;
      }
    }
    this.pushUndo(this.graph.serialize());
    for (const id of this.selectedLabels) this.graph.removeNetLabel(id);
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
    this.endLabelEdit();
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
    this.endLabelEdit();
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

  /** The current camera (pan + zoom) as plain numbers, for persistence. */
  getCamera(): { x: number; y: number; scale: number } {
    return {
      x: this.world.position.x,
      y: this.world.position.y,
      scale: this.world.scale.x,
    };
  }

  /** Restore a saved camera (pan + zoom), clamped to the valid zoom range and
   * ignoring a malformed value (so a corrupt save can't break the view). */
  setCamera(cam: { x: number; y: number; scale: number } | undefined): void {
    if (
      !cam ||
      !Number.isFinite(cam.scale) ||
      !Number.isFinite(cam.x) ||
      !Number.isFinite(cam.y)
    ) {
      return;
    }
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale));
    this.world.scale.set(s);
    this.world.position.set(cam.x, cam.y);
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
    // Per-net RMS over the sub-frame batch: at high tps a frame spans many AC cycles,
    // so this is a stable voltage level where the instantaneous sample aliases. O(batch
    // × nodes), tiny for teaching boards. Absent batch ⇒ no stabilisation this frame.
    if (scopeBatch && scopeBatch.length > 0) {
      const n = snap.state.length;
      const sumsq = new Float64Array(n);
      for (const s of scopeBatch) {
        const st = s.state;
        const m = Math.min(n, st.length);
        for (let i = 0; i < m; i++) sumsq[i] += st[i]! * st[i]!;
      }
      const vrms = new Float64Array(n);
      for (let i = 0; i < n; i++)
        vrms[i] = Math.sqrt(sumsq[i]! / scopeBatch.length);
      this.nodeVrms = vrms;
    } else {
      this.nodeVrms = undefined;
    }
    this.redrawWires();
    this.drawGround();
    this.drawNetLabels();
    // LOD off ⇒ force the schematic lens (clean symbols at any zoom).
    const effLens: BoardLens = this.lodEnabled ? this.lens : "schematic";
    for (const [id, node] of this.nodes) {
      node.update(
        electrical?.get(id) ?? ZERO_ELECTRICAL,
        this.phase,
        this.selected.has(id),
        effLens,
        this.world.scale.x,
      );
    }

    this.recordScope(snap, scopeBatch);
    this.drawScope();
    this.drawProbe();
    this.emitAnchor();
  }

  /**
   * The bounded visual flow clock (see `phase`). Exposed so the info-panel
   * diagram can share the SAME timeline-respecting clock the board's belts ride:
   * it advances at the calm fixed rate while running, freezes when paused, and
   * runs backward when stepping/scrubbing back — so the part-internals animation
   * pauses and flows with time exactly like the board, instead of free-running.
   */
  flowPhase(): number {
    return this.phase;
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
    this.ammText.resolution = rounded;
    for (const t of this.groundLabels) t.resolution = rounded;
    for (const t of this.netLabelTexts) t.resolution = rounded;
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
    // In conduit mode, test against the DRAWN pipe path (nudged + bridged + rounded)
    // with a tolerance covering the pipe's width, so clicking the pipe selects its wire
    // even though that pipe was offset from the logical route. Schematic mode tests the
    // logical route, which is exactly what's drawn.
    if (this.conduitDrawRoutes.size > 0) {
      for (const [id, route] of this.conduitDrawRoutes) {
        for (let i = 0; i + 1 < route.length; i++) {
          const p0 = route[i]!;
          const p1 = route[i + 1]!;
          if (distToSegment(wx, wy, p0.x, p0.y, p1.x, p1.y) <= 11) return id;
        }
      }
      return null;
    }
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

  /**
   * Which *anchor leg* of a wire a world point sits on — the index into the route
   * `[from, …waypoints, to]` so that the click lies on the leg between anchor `i`
   * and `i+1`. The drawn route inserts an L-corner inside each leg, so a leg can be
   * two on-screen segments; this maps the click back to the single model leg by
   * testing each leg's own drawn geometry in order. Returns the closest leg, or
   * null if the wire has fewer than two anchors. Used so Delete can drop just the
   * clicked leg of a multi-bend run (see {@link BoardGraph.deleteWireSegment}).
   */
  private wireLegIndexAt(w: Wire, wx: number, wy: number): number | null {
    const a = this.graph.endpointCell(w.from);
    const b = this.graph.endpointCell(w.to);
    if (!a || !b) return null;
    const anchors = [a, ...(w.waypoints ?? []), b];
    let bestLeg: number | null = null;
    let bestD = Infinity;
    for (let leg = 0; leg + 1 < anchors.length; leg++) {
      const sub = this.wireRoute(
        this.cellToWorld(anchors[leg]!),
        this.cellToWorld(anchors[leg + 1]!),
      );
      for (let i = 0; i + 1 < sub.length; i++) {
        const d = distToSegment(
          wx,
          wy,
          sub[i]!.x,
          sub[i]!.y,
          sub[i + 1]!.x,
          sub[i + 1]!.y,
        );
        if (d < bestD) {
          bestD = d;
          bestLeg = leg;
        }
      }
    }
    return bestLeg;
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

  /**
   * The net label whose tag pill is under a world point, else null. The pill sits
   * up-and-right of the endpoint (see {@link drawNetLabels}); we test only that box,
   * NOT the anchor dot — so a click on the pin/junction itself keeps its normal
   * action (start a wire, select the part) rather than being shadowed by a label on
   * it. Later labels (higher id) win, matching the draw order. Render-only geometry.
   */
  private labelHitTest(wx: number, wy: number): number | null {
    let best: number | null = null;
    for (const l of this.graph.netLabels.values()) {
      const cell = l.pos ?? this.graph.endpointCell(l.at);
      if (!cell) continue;
      const o = this.cellToWorld(cell);
      // The pill: ~7px per mono char + padding, ~18px tall, at the (draggable) offset.
      const w = Math.max(28, l.name.length * 7 + 12);
      const px = o.x + (l.tagOff?.dx ?? 12);
      const py = o.y + (l.tagOff?.dy ?? -18);
      if (
        wx >= px - 3 &&
        wx <= px + w + 3 &&
        wy >= py - 3 &&
        wy <= py + 18 + 3
      ) {
        best = l.id; // later (top-most) label wins
      }
    }
    return best;
  }

  // --- selection ----------------------------------------------------------

  private clearSelection(): void {
    this.selected.clear();
    this.selectedWires.clear();
    this.selectedJunctions.clear();
    this.selectedLabels.clear();
    this.lastWireClick = null;
    this.redrawSelection();
    this.emitSelect();
  }

  private emitSelect(): void {
    let single: SelectedPart | undefined;
    // Junctions and net labels count as edge selections (folded into `wires`) so
    // the inspector only opens for a lone component with nothing else picked.
    const edges =
      this.selectedWires.size +
      this.selectedJunctions.size +
      this.selectedLabels.size;
    if (this.selected.size === 1 && edges === 0) {
      const id = [...this.selected][0]!;
      const c = this.graph.components.get(id);
      if (c)
        single = {
          id: c.id,
          kind: c.kind,
          value: c.value,
          rot: c.rot,
          amp: c.amp,
          wiper: c.wiper,
          temp: c.temp,
          family: c.family,
          openDrain: c.openDrain,
          label: c.label,
        };
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
      this.selectedLabels.size === 0 &&
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

  /** Set a placed component's custom label (from the inspector). Pure presentation: it
   *  isn't in the netlist, so this goes through `onPersist` (cosmetic — save + refresh
   *  undo, NO netlist rebuild and NO sim rewind), exactly like a net-label drag. Empty/
   *  blank clears it back to the kind tag. Undoable. */
  setComponentLabel(id: number, label: string): void {
    const c = this.graph.components.get(id);
    const next = label.trim() || undefined;
    if (!c || c.label === next) return;
    this.pushUndo(this.graph.serialize());
    c.label = next;
    this.nodes.get(id)?.setLabel(next);
    this.cb.onPersist?.(this.graph);
    this.emitSelect(); // refresh the inspector's displayed label
  }

  /**
   * Flip a manual switch (kind `MSW`) between closed (value 1) and open (value 0).
   * Routed through {@link setComponentValue}, so the flip is undoable and rebuilds
   * the netlist exactly like an inspector value edit — the sim sees the new state
   * (an always-closed vs always-open switch, duty 1 vs 0) immediately. No-op on any
   * other kind. Returns true if it toggled a manual switch.
   */
  private toggleManualSwitch(id: number): boolean {
    const c = this.graph.components.get(id);
    if (!c || c.kind !== "MSW") return false;
    this.setComponentValue(id, c.value >= 0.5 ? 0 : 1);
    return true;
  }

  /**
   * Set an AC source's peak amplitude `amp` (volts) — its second scalar, beside
   * `value` (frequency) — from the inspector; rebuilds the netlist so the new
   * amplitude takes effect. The amplitude isn't drawn on the glyph (the sine art
   * is fixed), so unlike {@link setComponentValue} there is no node-side label to
   * refresh. No-op if unchanged.
   */
  setComponentAmp(id: number, amp: number): void {
    const c = this.graph.components.get(id);
    if (!c || c.amp === amp) return;
    this.pushUndo(this.graph.serialize());
    c.amp = amp;
    this.cb.onChange?.(this.graph);
    this.emitSelect(); // refresh the inspector's displayed amplitude
  }

  /**
   * Set a digital part's logic-family index (0 = Ideal, 1 = CMOS, 2 = TTL) from the
   * inspector. The family is packed into `aux` by {@link buildNetlist}, so this
   * rebuilds the netlist (the gate's thresholds and output levels change). No-op if
   * unchanged.
   */
  setComponentFamily(id: number, family: number): void {
    const c = this.graph.components.get(id);
    if (!c || (c.family ?? 0) === family) return;
    this.pushUndo(this.graph.serialize());
    c.family = family;
    this.cb.onChange?.(this.graph);
    this.emitSelect(); // refresh the inspector's displayed family
  }

  /**
   * Set a logic gate's open-drain output mode from the inspector. Packed into `aux`
   * bit 8 by {@link buildNetlist}, so this rebuilds the netlist (an open-drain output
   * releases its high side instead of driving it). No-op if unchanged.
   */
  setComponentOpenDrain(id: number, openDrain: boolean): void {
    const c = this.graph.components.get(id);
    if (!c || (c.openDrain ?? false) === openDrain) return;
    this.pushUndo(this.graph.serialize());
    c.openDrain = openDrain;
    this.cb.onChange?.(this.graph);
    this.emitSelect(); // refresh the inspector's displayed output mode
  }

  /**
   * Set a potentiometer's wiper position `wiper` (0..1) — its second scalar, beside
   * `value` (the total resistance) — from the inspector; rebuilds the netlist (the
   * two leg resistances change) so the new split takes effect. The glyph reads the
   * wiper live each frame, so the wiper slides on its own; no node-side label.
   * No-op if unchanged.
   *
   * `recordUndo` is `false` for the live intermediate steps of a slider drag (so a
   * single drag pushes only one undo, captured on the first move) and `true` for a
   * discrete set or the start of a drag.
   */
  setComponentWiper(id: number, wiper: number, recordUndo = true): void {
    const c = this.graph.components.get(id);
    if (!c || c.wiper === wiper) return;
    if (recordUndo) this.pushUndo(this.graph.serialize());
    c.wiper = wiper;
    this.cb.onChange?.(this.graph);
    this.emitSelect(); // refresh the inspector's displayed wiper position
  }

  /**
   * Set a thermistor's body temperature (°C) — its second scalar. Mirrors
   * {@link setComponentWiper}: one undo per drag (recorded on the first move), live
   * thereafter. {@link buildNetlist} turns the new temperature into R(T), so the sim
   * rebuilds and the reading follows.
   */
  setComponentTemp(id: number, temp: number, recordUndo = true): void {
    const c = this.graph.components.get(id);
    if (!c || c.temp === temp) return;
    if (recordUndo) this.pushUndo(this.graph.serialize());
    c.temp = temp;
    this.cb.onChange?.(this.graph);
    this.emitSelect(); // refresh the inspector's displayed temperature
  }

  /**
   * Commit the open net-label editor with `name` (from the HUD input). For a new
   * label (pending id null) it adds one at the pending endpoint; for an existing
   * one it renames it (an empty name removes it — see {@link BoardGraph}). No-op if
   * nothing meaningful changed (e.g. an empty name on a not-yet-created label), so
   * a stray blur doesn't push an empty undo. Closes the editor either way.
   */
  commitLabel(name: string): void {
    const pending = this.pendingLabel;
    this.endLabelEdit();
    if (!pending) return;
    const trimmed = name.trim();
    if (pending.id === null) {
      if (!trimmed) return; // nothing to add (empty name on a not-yet-created label)
      this.pushUndo(this.graph.serialize());
      const l = this.graph.addNetLabel(pending.at, trimmed, pending.pos);
      this.redrawWires();
      if (l) this.selectLabel(l.id, false);
      this.cb.onChange?.(this.graph);
    } else {
      const existing = this.graph.netLabels.get(pending.id);
      if (existing && existing.name === trimmed) return; // unchanged
      this.pushUndo(this.graph.serialize());
      this.graph.renameNetLabel(pending.id, trimmed);
      this.redrawWires();
      this.cb.onChange?.(this.graph);
    }
  }

  /** Cancel the open net-label editor without changing anything. */
  cancelLabelEdit(): void {
    this.endLabelEdit();
  }

  /** Close the inline label editor: clear the editing/pending state + tell the HUD. */
  private endLabelEdit(): void {
    this.editingLabelId = null;
    this.pendingLabel = null;
    this.cb.onLabelEdit?.(null);
  }

  /**
   * Open the inline label editor for an endpoint. If a label already sits there,
   * edit it; otherwise prepare to create a new one on commit. Computes the on-screen
   * rect of the anchor cell so the HUD can position the input, and fires onLabelEdit.
   */
  private beginLabelEdit(at: Endpoint, pos?: Cell): void {
    // `pos` (set when labelling a bare trace) overrides where the editor/pill sit;
    // `at` still resolves the net. An existing label at this anchor keeps its own pos.
    const existing = this.graph.netLabelAt(at);
    const cell = existing?.pos ?? pos ?? this.graph.endpointCell(at);
    if (!cell) return;
    this.editingLabelId = existing?.id ?? null;
    this.pendingLabel = {
      id: existing?.id ?? null,
      at: { ...at },
      ...(pos ? { pos: { ...pos } } : {}),
    };
    if (existing) this.selectLabel(existing.id, false);
    else this.clearSelection();
    const o = this.cellToWorld(cell);
    const s = this.world.scale.x;
    const rect: AnchorRect = {
      x: this.world.position.x + (o.x + 12) * s,
      y: this.world.position.y + (o.y - 18) * s,
      width: 90 * s,
      height: 20 * s,
    };
    this.cb.onLabelEdit?.({
      id: existing?.id ?? null,
      at: { ...at },
      initial: existing?.name ?? "",
      rect,
    });
  }

  private selectComponent(id: number, additive: boolean): void {
    if (additive) {
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
    } else {
      this.selected.clear();
      this.selectedWires.clear();
      this.selectedJunctions.clear();
      this.selectedLabels.clear();
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
      this.selectedLabels.clear();
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
      this.selectedLabels.clear();
      this.selectedJunctions.add(id);
    }
    this.redrawSelection();
    this.emitSelect();
  }

  private selectLabel(id: number, additive: boolean): void {
    if (additive) {
      if (this.selectedLabels.has(id)) this.selectedLabels.delete(id);
      else this.selectedLabels.add(id);
    } else {
      this.selected.clear();
      this.selectedWires.clear();
      this.selectedJunctions.clear();
      this.selectedLabels.clear();
      this.selectedLabels.add(id);
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
    this.ammText.visible = false;
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
      this.ammText.visible = false;
      return;
    }
    // The voltmeter (two leads, ΔV) and the ammeter (a clamp, current only) are
    // independent instruments — both are drawn and read every frame, so they can
    // be on the board at the same time. The V/A toggle only chooses which one a
    // click places.
    this.drawVoltmeter();
    this.drawAmmeter(g);
  }

  private drawVoltmeter(): void {
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

  /** Ammeter readout: a clamp ring on the clicked part/wire showing the current
   * through it — current only (the voltmeter is its own instrument). */
  private drawAmmeter(g: Graphics): void {
    if (!this.ammeter) {
      this.ammText.visible = false;
      return;
    }
    let cur = 0;
    let x = 0;
    let y = 0;
    let ok = false;
    if (this.ammeter.kind === "comp") {
      const c = this.graph.components.get(this.ammeter.id);
      if (c) {
        cur = this.electrical?.get(c.id)?.current ?? 0;
        const box = this.componentBox(c);
        x = box.x + box.width / 2;
        y = box.y + box.height / 2;
        ok = true;
      }
    } else {
      const w = this.graph.wires.get(this.ammeter.id);
      if (w) {
        cur = this.lastWireCurrents.get(w.id) ?? 0;
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
      this.ammText.visible = false;
      return;
    }
    g.circle(x, y, 12).fill({ color: 0x161020, alpha: 0.55 });
    g.circle(x, y, 12).stroke({ width: 2.5, color: PROBE_PLUS, alpha: 0.95 });
    this.ammText.text = "I " + fmtSI(cur, "A");
    this.ammText.position.set(x, y - 22);
    this.ammText.visible = true;
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

    // Floating paste: a left click drops the clipboard group at the cursor.
    if (this.pasting && e.button === 0) {
      this.commitPaste();
      return;
    }

    // Click-to-continue wiring (KiCad-style): a left press WHILE a wire is already in
    // progress completes the current segment at whatever is under the cursor — a pin
    // or existing junction finishes it; a bare trace T's in with an auto-junction and
    // keeps going; empty space just keeps the wire rubber-banding. This runs before
    // the normal pin/junction/body handling so a press mid-route never starts a brand
    // new wire over the top of the one being drawn. (Wiring is only ever active in the
    // wire/select/pan tools; entering any other tool cancels it — see setMode.)
    if (this.wiring && e.button === 0) {
      // A second press on the same junction the wire started from is the
      // double-click-to-drag gesture, not a (no-op) continue onto itself: hand off to
      // a junction drag instead of routing. (The first click left the wire pending.)
      const jid = this.junctionHitTest(wp.x, wp.y);
      if (jid !== null) {
        const now = performance.now();
        const dbl =
          this.lastJunctionTap !== null &&
          this.lastJunctionTap.id === jid &&
          now - this.lastJunctionTap.t < DOUBLE_CLICK_MS;
        if (dbl) {
          this.lastJunctionTap = null;
          this.cancelWiring();
          this.junctionDrag = { id: jid, moved: false };
          this.pendingUndo = this.graph.serialize();
          return;
        }
      }
      this.continueOrFinishWiring(wp.x, wp.y, false);
      if (this.wiring) {
        // Still routing: arm this press so a drag from here is a drag-to-wire and a
        // release in place leaves the next click to continue. Remember a junction
        // we're now routing from, so a follow-up double-click on it can grab it.
        this.wiringDownCell = {
          col: snap(wp.x, PITCH),
          row: snap(wp.y, PITCH),
        };
        this.wiringMoved = false;
        if (isJunctionRef(this.wiring.from)) {
          this.lastJunctionTap = {
            id: this.wiring.from.junctionId,
            t: performance.now(),
          };
        }
      }
      return;
    }

    // Pan tool: the neutral navigation tool Esc lands on. It does NOT blanket-grab
    // — dragging a PART BODY or empty space pans, but the build flow still works:
    // starting a wire from a pin/junction, reshaping a trace, and dropping an armed
    // part all fall through to their normal handlers below (which now also accept
    // "pan"). Only an outright body/empty drag reaches the pan at the very end.
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

    // Label tool: a non-additive click attaches (or edits) a net label. Precedence
    // mirrors the natural connection points: an existing tag → edit it; otherwise a
    // pin or a junction under the cursor → label that endpoint and open the inline
    // name editor. Off any of those, fall through to pan. (Shift/ctrl still selects.)
    if (this.mode === "label" && !additive) {
      const hit = this.labelHitTest(wp.x, wp.y);
      if (hit !== null) {
        const l = this.graph.netLabels.get(hit);
        if (l) this.beginLabelEdit(l.at);
        return;
      }
      const pin = this.pinHitTest(wp.x, wp.y);
      if (pin) {
        this.beginLabelEdit(pin);
        return;
      }
      const jid = this.junctionHitTest(wp.x, wp.y);
      if (jid !== null) {
        this.beginLabelEdit({ junctionId: jid });
        return;
      }
      // Off a pin/junction but on a bare trace: label that wire's net, drawn at the
      // clicked point on the trace (anchored to the wire's `from`, which shares its
      // net). Lets you name a long run anywhere along it.
      const wid = this.wireHitTest(wp.x, wp.y);
      if (wid !== null) {
        const w = this.graph.wires.get(wid);
        if (w) {
          const cell = { col: snap(wp.x, PITCH), row: snap(wp.y, PITCH) };
          this.beginLabelEdit(w.from, cell);
          return;
        }
      }
      this.panning = { lastX: e.global.x, lastY: e.global.y };
      return;
    }

    // In Select mode, clicking a net label's tag selects it (so Delete works and
    // the accent ring shows); right-click deletes it in any mode (see onRightDown).
    if (this.mode === "select") {
      const hitLabel = this.labelHitTest(wp.x, wp.y);
      if (hitLabel !== null) {
        this.selectLabel(hitLabel, additive);
        // A plain press also grabs the tag for dragging (KiCad-style): the pill
        // follows the cursor while the dot + leader stay pinned to the net it names.
        // Shift/ctrl just (de)selects.
        if (!additive) {
          this.labelDrag = { id: hitLabel, moved: false };
          this.pendingUndo = this.graph.serialize();
        }
        return;
      }
    }

    const pin = this.pinHitTest(wp.x, wp.y);
    if (
      pin &&
      (this.mode === "wire" || this.mode === "select" || this.mode === "pan")
    ) {
      this.startWiring(pin, wp);
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
      if (
        this.mode === "wire" ||
        this.mode === "select" ||
        this.mode === "pan"
      ) {
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
        this.startWiring({ junctionId: jid }, wp);
        return;
      }
    }

    // In pan mode a body press is NOT a grab — it falls through to the empty-space
    // branch below and pans, so the hand tool never accidentally drags a part.
    // (Shift/ctrl still selects so multi-select works from any tool.)
    const body = this.bodyHitTest(wp.x, wp.y);
    // Double-click a component body opens its info panel — works from Select and Pan
    // alike, before the mode-specific handling below. The first click selects (and,
    // for a manual switch, toggles) as usual; the second click within the window
    // makes it the lone selection, opens info, and is swallowed here (no drag, and
    // no second MSW flip), so double-click is a clean, universal "inspect" gesture.
    if (body && !additive) {
      const now = performance.now();
      const dbl =
        this.lastBodyTap !== null &&
        this.lastBodyTap.id === body.id &&
        now - this.lastBodyTap.t < DOUBLE_CLICK_MS;
      if (dbl) {
        this.lastBodyTap = null;
        this.selectComponent(body.id, false);
        this.cb.onInspect?.(body.id);
        return;
      }
      this.lastBodyTap = { id: body.id, t: now };
    }
    // Pan tool yields to direct manipulation: a plain click on a part grabs it and
    // switches to Build/Select so you can move it (the toolbar follows via onMode).
    // Empty space still pans; this only fires when actually over a body.
    if (body && this.mode === "pan" && !additive) this.yieldPanToSelect();
    if (body && (this.mode !== "pan" || additive)) {
      if (additive) {
        this.selectComponent(body.id, true);
        return;
      }
      if (!this.selected.has(body.id)) this.selectComponent(body.id, false);
      this.beginDrag(body, wp);
      return;
    }

    // With a part armed, a plain click PLACES it — even directly on a trace, where
    // the drop splits the wire so the part inserts inline — rather than selecting the
    // wire under the cursor. (Pins / junctions / bodies above keep their behaviour;
    // shift-click still falls through so you can multi-select while armed.)
    if (this.armed && !additive) {
      this.placeCell(
        this.armed,
        { col: snap(wp.x, PITCH), row: snap(wp.y, PITCH) },
        this.armedRot,
      );
      return;
    }

    const wireId = this.wireHitTest(wp.x, wp.y);
    if (wireId !== null) {
      // Same yield for wires: clicking a trace in Pan switches to Build and grabs
      // the segment to reshape (KiCad-style), rather than just panning the view.
      if (this.mode === "pan" && !additive) this.yieldPanToSelect();
      this.selectWire(wireId, additive);
      // Remember where on the run the click landed, so Delete can drop just that leg
      // of a multi-bend wire (resolved against the live geometry at delete time).
      this.lastWireClick = { wireId, x: wp.x, y: wp.y };
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

    // Empty space (armed placement handled above). A SHIFT-drag in Select mode
    // rubber-bands a marquee that ADDS the enclosed parts to the selection; a plain
    // drag just clears the selection and pans the view (in any tool), so the marquee
    // never fights ordinary panning.
    if (this.mode === "select" && additive) {
      this.marquee = { x0: wp.x, y0: wp.y, x1: wp.x, y1: wp.y, additive: true };
      this.drawMarquee();
      return;
    }
    if (!additive) this.clearSelection();
    this.panning = { lastX: e.global.x, lastY: e.global.y };
  };

  /** Leave the Pan tool for Build/Select (and tell the HUD), used when a Pan-mode
   * click lands directly on a part or wire so it grabs instead of panning. */
  private yieldPanToSelect(): void {
    this.setMode("select");
    this.cb.onMode?.("select");
  }

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

  // --- marquee selection --------------------------------------------------

  /** Redraw the rubber-band rectangle for the in-progress marquee. */
  private drawMarquee(): void {
    const m = this.marquee;
    const g = this.marqueeLayer;
    g.clear();
    if (!m) return;
    const x = Math.min(m.x0, m.x1);
    const y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0);
    const h = Math.abs(m.y1 - m.y0);
    g.rect(x, y, w, h).fill({ color: PALETTE.accent, alpha: 0.08 });
    g.rect(x, y, w, h).stroke({ width: 1, color: PALETTE.accent, alpha: 0.7 });
  }

  /** Pick everything the marquee box encloses: a component whose grab-box centre
   * is inside, a wire whose *both* endpoints are inside, and a junction inside. A
   * box too small to be a real sweep is treated as a plain click (no-op — the press
   * already cleared the selection unless it was additive). */
  private finalizeMarquee(): void {
    const m = this.marquee;
    if (!m) return;
    const x = Math.min(m.x0, m.x1);
    const y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0);
    const h = Math.abs(m.y1 - m.y0);
    if (w < 3 && h < 3) return;
    const inside = (px: number, py: number): boolean =>
      px >= x && px <= x + w && py >= y && py <= y + h;
    for (const c of this.graph.components.values()) {
      const box = this.componentBox(c);
      if (inside(box.x + box.width / 2, box.y + box.height / 2)) {
        this.selected.add(c.id);
      }
    }
    for (const wire of this.graph.wires.values()) {
      const a = this.graph.endpointCell(wire.from);
      const b = this.graph.endpointCell(wire.to);
      if (!a || !b) continue;
      const pa = this.cellToWorld(a);
      const pb = this.cellToWorld(b);
      if (inside(pa.x, pa.y) && inside(pb.x, pb.y))
        this.selectedWires.add(wire.id);
    }
    for (const j of this.graph.junctions.values()) {
      const p = this.cellToWorld(j.cell);
      if (inside(p.x, p.y)) this.selectedJunctions.add(j.id);
    }
    this.redrawSelection();
    this.emitSelect();
  }

  // --- copy / paste -------------------------------------------------------

  /** Copy the selected components, their *internal* wires (both ends on selected
   * components), and the net labels pinned to their pins into the in-memory
   * clipboard. (Junction-anchored wires/labels are skipped — v1 copies part
   * fragments.) Same-named labels still alias their nets on paste, by design. */
  copySelection(): void {
    if (this.selected.size === 0) return;
    const sel = new Set(this.selected);
    const comps: ClipboardSnippet["comps"] = [];
    for (const id of sel) {
      const c = this.graph.components.get(id);
      if (!c) continue;
      comps.push({
        oldId: id,
        kind: c.kind,
        col: c.cell.col,
        row: c.cell.row,
        value: c.value,
        rot: c.rot,
        amp: c.amp,
        wiper: c.wiper,
        temp: c.temp,
        family: c.family,
        openDrain: c.openDrain,
        label: c.label,
      });
    }
    if (comps.length === 0) return;
    const wires: ClipboardSnippet["wires"] = [];
    for (const w of this.graph.wires.values()) {
      if (isJunctionRef(w.from) || isJunctionRef(w.to)) continue;
      if (sel.has(w.from.componentId) && sel.has(w.to.componentId)) {
        wires.push({
          aId: w.from.componentId,
          aPin: w.from.pinIndex,
          bId: w.to.componentId,
          bPin: w.to.pinIndex,
        });
      }
    }
    const labels: ClipboardSnippet["labels"] = [];
    for (const l of this.graph.netLabels.values()) {
      if (isJunctionRef(l.at)) continue;
      if (sel.has(l.at.componentId)) {
        labels.push({
          compId: l.at.componentId,
          pin: l.at.pinIndex,
          name: l.name,
        });
      }
    }
    this.clipboard = { comps, wires, labels };
    this.pasteSeq = 0;
  }

  /** Cut: copy the selection, then delete it. */
  cutSelection(): void {
    if (this.selected.size === 0) return;
    this.copySelection();
    this.deleteSelection();
  }

  /** Begin a paste: float the clipboard group as a translucent ghost that tracks the
   * cursor (rotate with R, drop on click), anchored to the clipboard's top-left cell.
   * The actual placement + wire/label remap happens in {@link commitPaste} on click. */
  paste(): void {
    const clip = this.clipboard;
    if (!clip || clip.comps.length === 0) return;
    // A floating paste and an armed part are mutually exclusive — clear the arm.
    if (this.armed) {
      this.armed = null;
      this.cb.onArm?.(null);
      this.updateGhost();
    }
    const refCol = Math.min(...clip.comps.map((c) => c.col));
    const refRow = Math.min(...clip.comps.map((c) => c.row));
    this.pasting = { snippet: clip, refCol, refRow, rot: 0 };
    this.updateCursor();
    this.updatePasteGhost();
  }

  /** Drop the floating paste group at the cursor: place each component with fresh ids
   * at its (group-rotated) offset, remap the internal wires + labels, select the new
   * group, and leave paste mode. */
  private commitPaste(): void {
    const p = this.pasting;
    if (!p) return;
    const anchor = {
      col: snap(this.pointer.x, PITCH),
      row: snap(this.pointer.y, PITCH),
    };
    this.pushUndo(this.graph.serialize());
    const map = new Map<number, number>();
    for (const cc of p.snippet.comps) {
      const rel = rotateOffset(cc.col - p.refCol, cc.row - p.refRow, p.rot);
      const nc = this.graph.place(cc.kind, {
        col: anchor.col + rel.col,
        row: anchor.row + rel.row,
      });
      if (!nc) continue;
      nc.value = cc.value;
      nc.rot = (cc.rot + p.rot) % 4;
      if (cc.amp !== undefined) nc.amp = cc.amp;
      if (cc.wiper !== undefined) nc.wiper = cc.wiper;
      if (cc.temp !== undefined) nc.temp = cc.temp;
      if (cc.family !== undefined) nc.family = cc.family;
      if (cc.openDrain !== undefined) nc.openDrain = cc.openDrain;
      if (cc.label !== undefined) nc.label = cc.label;
      map.set(cc.oldId, nc.id);
    }
    for (const w of p.snippet.wires) {
      const na = map.get(w.aId);
      const nb = map.get(w.bId);
      if (na === undefined || nb === undefined) continue;
      this.graph.connect(
        { componentId: na, pinIndex: w.aPin },
        { componentId: nb, pinIndex: w.bPin },
      );
    }
    for (const l of p.snippet.labels) {
      const nid = map.get(l.compId);
      if (nid === undefined) continue;
      this.graph.addNetLabel({ componentId: nid, pinIndex: l.pin }, l.name);
    }
    this.selected.clear();
    this.selectedWires.clear();
    this.selectedJunctions.clear();
    this.selectedLabels.clear();
    for (const id of map.values()) this.selected.add(id);
    this.pasting = null;
    this.pasteGhostLayer.visible = false;
    this.updateCursor();
    this.rebuildNodes();
    this.redrawWires();
    this.redrawSelection();
    this.emitSelect();
    this.cb.onChange?.(this.graph);
  }

  /** Rotate the floating paste group 90° CW. Returns true iff a paste was active
   * (so the HUD's R hotkey can fall through to the armed-part / selection rotate). */
  rotatePaste(): boolean {
    if (!this.pasting) return false;
    this.pasting.rot = (this.pasting.rot + 1) % 4;
    this.updatePasteGhost();
    return true;
  }

  /** Abort a floating paste without placing anything. */
  private cancelPaste(): void {
    if (!this.pasting) return;
    this.pasting = null;
    this.pasteGhostLayer.visible = false;
    this.updateCursor();
  }

  /** Redraw the floating paste ghost: one translucent glyph per component at its
   * group-rotated offset from the cursor. Hidden when the cursor is off-board. */
  private updatePasteGhost(): void {
    const p = this.pasting;
    if (!p || !this.pointerInside) {
      this.pasteGhostLayer.visible = false;
      return;
    }
    const anchor = {
      col: snap(this.pointer.x, PITCH),
      row: snap(this.pointer.y, PITCH),
    };
    let i = 0;
    for (const cc of p.snippet.comps) {
      const kind = PART_KINDS[cc.kind];
      if (!kind) continue;
      const rel = rotateOffset(cc.col - p.refCol, cc.row - p.refRow, p.rot);
      const o = this.cellToWorld({
        col: anchor.col + rel.col,
        row: anchor.row + rel.row,
      });
      const g = this.pasteGlyph(i++);
      g.clear();
      g.position.set(o.x, o.y);
      g.rotation = (((cc.rot + p.rot) % 4) * Math.PI) / 2;
      const color = PALETTE[kind.colorKey];
      const pins = kind.pins.map((pp) => ({
        x: pp.dx * PITCH,
        y: pp.dy * PITCH,
      }));
      drawGlyph(g, {
        kind: cc.kind,
        pins,
        wPx: (kind.w - 1) * PITCH,
        hPx: (kind.h - 1) * PITCH,
        color,
        electrical: ZERO_ELECTRICAL,
        phase: 0,
        value: cc.value,
        wiper: cc.wiper,
      });
      for (const pp of pins) g.circle(pp.x, pp.y, PIN_R).fill({ color });
      g.visible = true;
    }
    for (; i < this.pasteGhostGlyphs.length; i++) {
      this.pasteGhostGlyphs[i]!.visible = false;
    }
    this.pasteGhostLayer.visible = true;
  }

  /** Pooled child Graphics for the paste ghost (one per component). */
  private pasteGlyph(i: number): Graphics {
    let g = this.pasteGhostGlyphs[i];
    if (!g) {
      g = new Graphics();
      this.pasteGhostGlyphs[i] = g;
      this.pasteGhostLayer.addChild(g);
    }
    return g;
  }

  /** Whether the clipboard holds anything to paste (for HUD enablement). */
  hasClipboard(): boolean {
    return this.clipboard !== null && this.clipboard.comps.length > 0;
  }

  private readonly onPointerMove = (e: FederatedPointerEvent): void => {
    const wp = this.screenToWorld(e.global.x, e.global.y);
    this.pointer.copyFrom(wp);

    if (this.marquee) {
      this.marquee.x1 = wp.x;
      this.marquee.y1 = wp.y;
      this.drawMarquee();
      return;
    }

    if (this.pasting) {
      this.updatePasteGhost();
      return;
    }

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

    if (this.labelDrag) {
      const l = this.graph.netLabels.get(this.labelDrag.id);
      const cell = l ? (l.pos ?? this.graph.endpointCell(l.at)) : null;
      if (l && cell) {
        // Offset = cursor relative to the anchor; the dot + leader stay, the pill moves.
        const o = this.cellToWorld(cell);
        this.graph.moveNetLabel(l.id, wp.x - o.x, wp.y - o.y);
        this.labelDrag.moved = true;
        this.drawNetLabels();
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

    if (this.wiring) {
      // Note whether this press has left its down-cell: that turns the gesture into
      // a drag-to-wire (completed on release) rather than a click (left pending).
      if (
        this.wiringDownCell &&
        (snap(wp.x, PITCH) !== this.wiringDownCell.col ||
          snap(wp.y, PITCH) !== this.wiringDownCell.row)
      ) {
        this.wiringMoved = true;
      }
      this.drawPendingWire();
    }
    // Idle hover: keep the placement / junction / label ghost glued to the cursor
    // (snapped to the cell or the endpoint a click would attach to). Every tool
    // that draws a ghost must refresh here or its preview freezes in place.
    if (this.armed || this.mode === "junction" || this.mode === "label")
      this.updateGhost();
  };

  private readonly onPointerUp = (e: FederatedPointerEvent): void => {
    if (this.marquee) {
      this.finalizeMarquee();
      this.marquee = null;
      this.marqueeLayer.clear();
      return;
    }
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
    if (this.labelDrag) {
      // Moving the tag is presentation only (the net is unchanged), so commit just an
      // undo point; no netlist rebuild. A press-without-move leaves it a plain select.
      if (this.labelDrag.moved && this.pendingUndo) {
        this.commitUndo(this.pendingUndo);
        this.cb.onPersist?.(this.graph);
      }
      this.labelDrag = null;
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
      } else if (!this.dragging.moved && this.dragging.ids.length === 1) {
        // A press-and-release in place (a click, not a drag) on a lone manual
        // switch flips it open/closed. The pointer-down already selected it, so
        // this both toggles AND selects — a click on the part does the obvious
        // thing. (The flip carries its own undo via setComponentValue, so the
        // unmoved drag's pendingUndo is simply discarded below.) Any other part,
        // or a multi-selection drag, is untouched.
        this.toggleManualSwitch(this.dragging.ids[0]!);
      }
      this.dragging = null;
      this.pendingUndo = null;
      return;
    }
    if (this.wiring) {
      // A press+release IN PLACE (a click) leaves the wire pending so the next click
      // continues it (KiCad click-to-continue). A press-move-release (a drag) is the
      // classic drag-to-wire: complete this segment now — finishing on a pin/junction,
      // T-ing into a bare trace and continuing, or abandoning if released in space.
      if (this.wiringMoved) {
        const wp = this.screenToWorld(e.global.x, e.global.y);
        this.continueOrFinishWiring(wp.x, wp.y, true);
      }
      this.wiringMoved = false;
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
   * Returns the new junction's id (so the caller can continue routing from it), or
   * null if the point isn't over an eligible wire (off any trace, or over one already
   * incident to the start endpoint, which would just fold a wire back on itself).
   */
  private finishWireOnWire(wx: number, wy: number): number | null {
    if (!this.wiring) return null;
    const wireId = this.wireHitTest(wx, wy);
    if (wireId === null) return null;
    const w = this.graph.wires.get(wireId);
    if (!w) return null;
    // Don't junction onto a wire already incident to the start endpoint — that
    // would just fold a wire back on itself.
    const fromKey = endpointKey(this.wiring.from);
    if (endpointKey(w.from) === fromKey || endpointKey(w.to) === fromKey)
      return null;
    const route = this.routeForWire(w);
    if (route.length < 2) return null;
    const cp = closestOnPolyline(route, wx, wy);
    const cell = { col: snap(cp.x, PITCH), row: snap(cp.y, PITCH) };
    const before = this.graph.serialize();
    const j = this.graph.junctionOnWire(wireId, cell, this.wiring.from);
    if (j) {
      this.pushUndo(before);
      this.redrawWires();
      this.cb.onChange?.(this.graph);
      return j.id;
    }
    return null;
  }

  /**
   * Begin a new wire from `from` (a pin or junction press), recording the down-cell
   * so the press/release-in-place vs press-drag-release distinction works. A plain
   * release in place leaves the wire pending for KiCad-style click-to-continue; a
   * drag completes it on release (see {@link onPointerUp}).
   */
  private startWiring(from: Endpoint, wp: Point): void {
    this.wiring = { from };
    this.wiringDownCell = { col: snap(wp.x, PITCH), row: snap(wp.y, PITCH) };
    this.wiringMoved = false;
    this.drawPendingWire();
  }

  /**
   * Complete the in-progress wire's current segment at world point (wx,wy), then
   * either FINISH or CONTINUE per what's under the cursor — the shared core of both
   * the click-to-continue press and the drag-to-wire release:
   *
   * - a **pin** or an existing **junction** is a definite node → connect and finish;
   * - a **bare trace** → drop an auto-junction (a T) and CONTINUE a fresh wire from
   *   it, so you can keep routing;
   * - **empty space** → keep the wire pending (rubber-banding) for a click, or, when
   *   `abandonOnEmpty` is set (a drag that ended in space), cancel it — preserving the
   *   old "drag a wire off into nothing and let go to give up" behaviour.
   *
   * A target identical to the start endpoint is ignored (you can't end a wire on its
   * own start), leaving the wire pending. Each committed segment carries its own undo
   * (via `connect`/`finishWireOnWire`).
   */
  private continueOrFinishWiring(
    wx: number,
    wy: number,
    abandonOnEmpty: boolean,
  ): void {
    if (!this.wiring) return;
    const fromKey = endpointKey(this.wiring.from);
    const pin = this.pinHitTest(wx, wy);
    const target: Endpoint | null = pin
      ? pin
      : (() => {
          const jid = this.junctionHitTest(wx, wy);
          return jid !== null ? { junctionId: jid } : null;
        })();
    if (target) {
      // Ignore a release/click back on the start endpoint itself (keep routing).
      if (endpointKey(target) === fromKey) return;
      const before = this.graph.serialize();
      const wire = this.graph.connect(this.wiring.from, target);
      if (wire) {
        this.pushUndo(before);
        this.redrawWires();
        this.cb.onChange?.(this.graph);
      }
      this.cancelWiring(); // a pin/existing junction is a definite end → finish
      return;
    }
    // Bare trace: T in with an auto-junction and continue routing from it. The new
    // junction becomes the start, so re-anchor the down-cell to it (a drag-release
    // continue leaves the pointer up; the next press re-arms anyway).
    const newJ = this.finishWireOnWire(wx, wy);
    if (newJ !== null) {
      this.wiring = { from: { junctionId: newJ } };
      const jc = this.graph.endpointCell(this.wiring.from);
      if (jc) this.wiringDownCell = { ...jc };
      this.wiringMoved = false;
      this.drawPendingWire();
      return;
    }
    // Empty space: a CLICK drops a free-floating wire-end — a `free` junction at the
    // grid point (KiCad dangling end) — and keeps routing from it, so a wire can end
    // at, or bend through, a point wired to nothing. A drag that releases into space is
    // an accidental gesture, so it's abandoned as before.
    if (abandonOnEmpty) {
      this.cancelWiring();
      return;
    }
    const cell = { col: snap(wx, PITCH), row: snap(wy, PITCH) };
    const fromCell = this.graph.endpointCell(this.wiring.from);
    if (fromCell && fromCell.col === cell.col && fromCell.row === cell.row) {
      return; // dropping on the start cell is a no-op — keep routing
    }
    const before = this.graph.serialize();
    const j = this.graph.addJunction(cell, true);
    const wire = this.graph.connect(this.wiring.from, { junctionId: j.id });
    if (!wire) {
      this.graph.removeJunction(j.id);
      return;
    }
    this.pushUndo(before);
    this.wiring = { from: { junctionId: j.id } };
    this.wiringDownCell = { ...cell };
    this.wiringMoved = false;
    this.redrawWires();
    this.cb.onChange?.(this.graph);
    this.drawPendingWire();
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
    // Net-label tags sit on top of everything, so test them first: right-click
    // deletes the label (mirrors junction/wire delete).
    const lid = this.labelHitTest(wp.x, wp.y);
    if (lid !== null) {
      this.pushUndo(this.graph.serialize());
      this.graph.removeNetLabel(lid);
      this.selectedLabels.delete(lid);
      this.redrawWires();
      this.redrawSelection();
      this.cb.onChange?.(this.graph);
      return;
    }
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
    this.wiringDownCell = null;
    this.wiringMoved = false;
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
    const flow = this.computeWireFlow();
    const currents = new Map<number, number>();
    for (const [id, f] of flow) currents.set(id, f.current);
    this.lastWireCurrents = currents;
    const fd = this.flowDelta;
    // Re-skin bare traces as conduits (pipes / metal conductors) when zoomed into the
    // analogy/reality lens — the same threshold + gating the parts morph at.
    const effLens = this.lodEnabled ? this.lens : "schematic";
    const conduit: BoardLens | null =
      effLens !== "schematic" && this.world.scale.x >= TIER_ZOOM
        ? effLens
        : null;
    this.conduitDrawRoutes.clear();
    // Which cardinal arms each junction actually uses, so a conduit junction can cap
    // the unused ones (a 4-way fitting). Accumulated from the wires' end directions.
    const junctionDirs = new Map<number, number>();
    // Conduit draw routes (logical route + pin-align stubs), fanned apart where they
    // share a channel, computed once up front so the per-wire draw below just uses them.
    const condRoutes = new Map<number, Point[]>();
    // Where each junction hub actually draws: a junction is a free routing vertex, so
    // when its runs are fanned into lanes the hub rides along (filled in below). Empty ⇒
    // the hub stays on its cell (schematic, or an unnudged junction).
    const junctionPos = new Map<number, Point>();
    let conduitCrossDots: { x: number; y: number; color: number }[] = [];
    if (conduit) {
      const nets = new Map<number, number | null>();
      const wireColor = new Map<number, number>();
      // Junction run-ends, with the connecting leg's axis (recorded pre-nudge from the
      // logical route), so the follow-pass below can shift the hub by each run's offset.
      const jRecs: {
        wid: number;
        jid: number;
        from: boolean;
        vertical: boolean;
      }[] = [];
      for (const w of this.graph.wires.values()) {
        const route = this.routeForWire(w);
        if (route.length < 2) continue;
        condRoutes.set(
          w.id,
          conduitDrawRoute(
            route,
            this.pinOutward(w.from),
            this.pinOutward(w.to),
          ),
        );
        if (isJunctionRef(w.from))
          jRecs.push({
            wid: w.id,
            jid: w.from.junctionId,
            from: true,
            vertical: (dirBit(route[0]!, route[1]!) & 5) !== 0,
          });
        if (isJunctionRef(w.to))
          jRecs.push({
            wid: w.id,
            jid: w.to.junctionId,
            from: false,
            vertical:
              (dirBit(route[route.length - 1]!, route[route.length - 2]!) &
                5) !==
              0,
          });
        const node = this.endpointNode(w.from);
        nets.set(w.id, node);
        const nv = node === null ? null : this.nodeVoltage(node);
        wireColor.set(w.id, nv === null ? PALETTE.cyan : voltageColor(nv));
      }
      nudgeParallel(condRoutes);
      // Follow-pass: each junction's shift = the perpendicular offset its runs picked up
      // in nudgeParallel, averaged PER AXIS (so a T/+ where runs enter on different axes
      // composes, and parallel runs into one hub split the difference). Derived from the
      // nudge, so it never fights it. Then snap the hub AND every connected run-end onto
      // that point so they stay joined.
      const jAcc = new Map<
        number,
        { dx: number; dy: number; nx: number; ny: number }
      >();
      for (const rec of jRecs) {
        const pts = condRoutes.get(rec.wid);
        if (!pts || pts.length < 2) continue;
        const ei = rec.from ? 0 : pts.length - 1;
        const J = pts[ei]!;
        const nb = pts[rec.from ? 1 : pts.length - 2]!;
        const acc = jAcc.get(rec.jid) ?? { dx: 0, dy: 0, nx: 0, ny: 0 };
        if (rec.vertical) {
          acc.dx += nb.x - J.x;
          acc.nx++;
        } else {
          acc.dy += nb.y - J.y;
          acc.ny++;
        }
        jAcc.set(rec.jid, acc);
      }
      for (const [jid, acc] of jAcc) {
        const j = this.graph.junctions.get(jid);
        if (!j) continue;
        const base = this.cellToWorld(j.cell);
        junctionPos.set(
          jid,
          new Point(
            base.x + (acc.nx ? acc.dx / acc.nx : 0),
            base.y + (acc.ny ? acc.dy / acc.ny : 0),
          ),
        );
      }
      for (const rec of jRecs) {
        const jp = junctionPos.get(rec.jid);
        const pts = condRoutes.get(rec.wid);
        if (!jp || !pts || pts.length < 2) continue;
        pts[rec.from ? 0 : pts.length - 1] = new Point(jp.x, jp.y);
      }
      // Same-net crossings → junction dots; different-net crossings → a bridge hop
      // baked into the horizontal wire's route.
      conduitCrossDots = applyCrossings(
        condRoutes,
        nets,
        (id) => wireColor.get(id) ?? PALETTE.cyan,
      );
    }
    for (const w of this.graph.wires.values()) {
      const route = this.routeForWire(w);
      if (route.length < 2) continue;
      if (conduit) {
        if (isJunctionRef(w.from)) {
          const id = w.from.junctionId;
          junctionDirs.set(
            id,
            (junctionDirs.get(id) ?? 0) | dirBit(route[0]!, route[1]!),
          );
        }
        if (isJunctionRef(w.to)) {
          const id = w.to.junctionId;
          junctionDirs.set(
            id,
            (junctionDirs.get(id) ?? 0) |
              dirBit(route[route.length - 1]!, route[route.length - 2]!),
          );
        }
      }
      const v = this.pinVoltage(w.from);
      let color = v === null ? PALETTE.cyan : voltageColor(v);

      const cur = currents.get(w.id) ?? 0;
      const normC = saturate(Math.abs(cur) / I_REF);
      // Thickness tracks current over a wide range so amperage is legible at a
      // glance (bounded by the saturating normC — a huge current stays on-screen).
      const width = BELT_WIDTH_MIN + (BELT_WIDTH_MAX - BELT_WIDTH_MIN) * normC;
      // The carrier→shimmer blur for this wire: its AC current's APPARENT rate
      // (signal Hz × playback-speed scale) handed through the same smoothstep the tier
      // drawers use. DC/slow wires → 0 (carriers stream/slosh as before); fast AC under
      // a high tickrate → 1 (a shimmer band, no aliased strobing). Slowing the tickrate
      // drops it back to visible sloshing (see tierKit `apparentFreq`).
      const wf = flow.get(w.id);
      const blur =
        wf && wf.freq > 0 ? blurFactor(apparentFreq(wf.freq)) * wf.acFrac : 0;
      // Stabilise the colour the SAME way as the carriers: voltage aliases frame-to-
      // frame on fast AC (`voltageColor` is magnitude-based, so the hue strobes 0↔peak),
      // so blend toward the net's RMS voltage (from the non-aliased sub-frame batch) as
      // the blur rises — the voltage-domain twin of the carrier→shimmer handoff.
      if (blur > 0.02 && v !== null && this.nodeVrms) {
        const node = this.endpointNode(w.from);
        if (node !== null && node >= 0 && node < this.nodeVrms.length) {
          color = lerpColor(color, voltageColor(this.nodeVrms[node]!), blur);
        }
      }
      // The path actually drawn (and walked by the carriers): in conduit mode it is the
      // logical route + aligning pin stubs, rounded into elbows; in schematic mode the
      // plain route. Sampling the carriers on THIS keeps the particles on the pipe
      // through its bends.
      let sampleRoute = route;
      if (conduit) {
        const pw = 5 + 6 * normC;
        const rd = condRoutes.get(w.id) ?? route;
        sampleRoute = roundedPoints(rd, Math.min(pw * 2, PITCH * 0.7));
        this.drawConduitSkin(g, sampleRoute, color, pw, conduit);
        this.conduitDrawRoutes.set(w.id, sampleRoute);
      } else {
        polyline(g, route);
        g.stroke({ width: width + 4, color, alpha: 0.16 });
        polyline(g, route);
        g.stroke({ width, color, alpha: 0.95 });
      }

      const len = routeLength(sampleRoute);
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
        // Reality electrons drift AGAINST the conventional current; the analogy water
        // and the schematic chevrons stream WITH it.
        const adv = conduit === "reality" ? -carrierDir : carrierDir;
        const co = advanceBeltOffset(
          this.carrierOffset.get(w.id) ?? 0,
          adv * fd * CARRIER_PX_RATE,
          len,
        );
        this.carrierOffset.set(w.id, co);
        const spacing =
          CARRIER_SPACING_MAX -
          (CARRIER_SPACING_MAX - CARRIER_SPACING_MIN) * normC;
        const size =
          CHEVRON_SIZE_MIN + (CHEVRON_SIZE_MAX - CHEVRON_SIZE_MIN) * normC;
        // Fade the discrete carriers out as the shimmer band fades in (blur → 1).
        const fade = 1 - blur;
        const alpha = (0.32 + 0.42 * normC) * fade;
        const dir = cur >= 0 ? 1 : -1;
        if (blur < 0.98) {
          for (const d of beltDots(len, spacing, co)) {
            const s = sampleRouteAt(sampleRoute, d);
            if (!conduit) {
              drawChevron(
                g,
                s.x,
                s.y,
                s.dx * dir,
                s.dy * dir,
                color,
                alpha,
                size,
              );
            } else if (conduit === "analogy") {
              g.circle(s.x, s.y, 2 + 1.6 * normC).fill({
                color: PIPE_WATER,
                alpha: (0.45 + 0.4 * normC) * fade,
              });
            } else {
              g.circle(s.x, s.y, 1.7 + 1.2 * normC).fill({
                color: COND_ELEC,
                alpha: (0.5 + 0.4 * normC) * fade,
              });
            }
          }
        }
        // Shimmer band: at a high apparent rate the carriers dissolve into a bright
        // glowing band — a voltage-tinted aura around a WHITE-HOT core (so it reads as
        // an energised wire, clearly different from a plain trace, not just "the
        // chevrons vanished"), plus a few drifting sparkle specks. Fast AC reads as a
        // live band, not aliased strobing dots. Shown in every lens.
        if (blur > 0.02) {
          const vib = 0.9 + 0.1 * Math.sin(this.phase * SHIMMER_VIB);
          const half = (width * 0.6 + 4 + 5 * normC) * vib;
          const glow = mix(color, 0xffffff, 0.35);
          const hot = mix(color, 0xffffff, 0.75);
          const stroke = (w: number, c: number, a: number): void => {
            polyline(g, sampleRoute);
            g.stroke({
              width: w,
              color: c,
              alpha: a,
              cap: "round",
              join: "round",
            });
          };
          stroke(3 * half, color, blur * (0.1 + 0.08 * normC)); // wide voltage aura
          stroke(2 * half, glow, blur * (0.2 + 0.18 * normC)); // brightened glow
          stroke(Math.max(1.2, 0.84 * half), hot, blur * (0.5 + 0.3 * normC)); // hot core
          const sparks = 3 + Math.round(3 * normC);
          for (let k = 0; k < sparks; k++) {
            const d = (((k / sparks + this.phase * 0.3) % 1) + 1) % 1;
            const s = sampleRouteAt(sampleRoute, d * len);
            g.circle(s.x, s.y, 1.6).fill({
              color: 0xffffff,
              alpha: blur * 0.55,
            });
          }
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
          const s = sampleRouteAt(sampleRoute, d);
          g.circle(s.x, s.y, 2.4).fill({
            color: ENERGY_COLOR,
            alpha: 0.5 + 0.4 * pNorm,
          });
        }
      }
    }
    this.drawJunctions(g, conduit, junctionDirs, junctionPos);
    // Same-net conduit crossings tie with a junction dot (the different-net ones bridged
    // over via the baked-in hop).
    for (const d of conduitCrossDots) {
      g.circle(d.x, d.y, 4.5).fill({ color: 0x0d0b16, alpha: 0.9 });
      g.circle(d.x, d.y, 3).fill({ color: d.color });
    }
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
   * The outward (away-from-the-body) cardinal direction of a pin endpoint in world
   * space — the pin's facing, rotated with the part. Null for a junction, a centred
   * lone pin, or a corner pin with no clear single facing. Used to add the small
   * aligning stub so a conduit enters a part straight along its pin axis.
   */
  private pinOutward(ep: Endpoint): Dir | null {
    if (isJunctionRef(ep)) return null;
    const c = this.graph.components.get(ep.componentId);
    if (!c) return null;
    const kind = this.graph.kindOf(c);
    const pin = kind?.pins[ep.pinIndex];
    if (!kind || !pin) return null;
    const ox = pin.dx - (kind.w - 1) / 2;
    const oy = pin.dy - (kind.h - 1) / 2;
    if (ox === 0 && oy === 0) return null;
    const rr = rotateOffset(ox, oy, c.rot);
    const ax = Math.abs(rr.col);
    const ay = Math.abs(rr.row);
    if (Math.abs(ax - ay) < 0.4) return null; // corner pin → ambiguous facing
    return ax > ay
      ? { x: Math.sign(rr.col), y: 0 }
      : { x: 0, y: Math.sign(rr.row) };
  }

  /**
   * Re-skin a bare trace as a conduit: an ANALOGY pipe (steel wall, dark bore,
   * voltage-tinted water) or a REALITY metal conductor (bright sheath, glowing core, a
   * sheen highlight). Constant-width strokes — Pixi rounds the bends and the ends —
   * plus a port collar at each end so the conduit merges smoothly into the part (or
   * junction) it plugs into, the "adaptive taper" without per-part port geometry.
   */
  private drawConduitSkin(
    g: Graphics,
    rp: Point[],
    color: number,
    pw: number,
    lens: BoardLens,
  ): void {
    const cap = "round" as const;
    const join = "round" as const;
    const coreAlpha = lens === "analogy" ? 0.32 : 0.36;
    const wallCol = lens === "analogy" ? PIPE_WALL : COND_CASING;
    // `rp` is the already-rounded draw path (aligning stubs + rounded elbows). Two
    // translucent layers only — a faint wall rim + a voltage-tinted fill (no dark bore;
    // the stacked bore muddied the pipe and made crossings read opaque). The grid +
    // overlaps show through; the fill colour + the carriers (which walk this same path)
    // stay the readable part.
    polyline(g, rp);
    g.stroke({ width: pw + 3, color: wallCol, alpha: 0.3, cap, join });
    polyline(g, rp);
    g.stroke({
      width: Math.max(1, pw - 1),
      color,
      alpha: coreAlpha,
      cap,
      join,
    });
    if (lens === "reality") {
      polyline(g, rp);
      g.stroke({ width: 1.2, color: 0xffffff, alpha: 0.08, cap, join });
    }
    // Taper each end into a port mouth, oriented along the end segment — the conduit
    // flares open where it plugs into a part (or junction), so it reads as connected.
    const mouthR = PITCH * 0.34;
    const ph = (pw + 5) / 2;
    for (const [ei, ni] of [
      [0, 1],
      [rp.length - 1, rp.length - 2],
    ] as const) {
      const e = rp[ei];
      const nb = rp[ni];
      if (!e || !nb) continue;
      const d = Math.hypot(nb.x - e.x, nb.y - e.y) || 1;
      const ux = (nb.x - e.x) / d;
      const uy = (nb.y - e.y) / d;
      const px = -uy;
      const py = ux;
      const fl = Math.min(14, d * 0.8);
      const bx = e.x + ux * fl;
      const by = e.y + uy * fl;
      // Keep the flare translucent: it STACKS over the two pipe-body strokes, so a
      // heavy fill here composites far denser than the run and reads as a cloudy blob.
      // Light wall + a faint voltage tint just hint the port mouth opening.
      g.poly([
        e.x + px * mouthR,
        e.y + py * mouthR,
        e.x - px * mouthR,
        e.y - py * mouthR,
        bx - px * ph,
        by - py * ph,
        bx + px * ph,
        by + py * ph,
      ]).fill({ color: wallCol, alpha: 0.16 });
      const im = mouthR - 2.5;
      const ip = Math.max(0.5, ph - 2.5);
      g.poly([
        e.x + px * im,
        e.y + py * im,
        e.x - px * im,
        e.y - py * im,
        bx - px * ip,
        by - py * ip,
        bx + px * ip,
        by + py * ip,
      ]).fill({ color, alpha: coreAlpha * 0.4 });
    }
  }

  /**
   * Draw the wire-to-wire junction dots (KiCad style): a small filled disc where
   * three+ wire-ends tie together, in the net's voltage colour so it reads as one
   * with the belt. A dark backing ring keeps it legible over the flowing belt.
   */
  private drawJunctions(
    g: Graphics,
    conduit: BoardLens | null,
    junctionDirs: Map<number, number>,
    junctionPos: Map<number, Point>,
  ): void {
    for (const j of this.graph.junctions.values()) {
      // Use the nudged hub position when its runs were fanned into lanes (so the hub
      // sits on its pipes), else the plain cell.
      const p = junctionPos.get(j.id) ?? this.cellToWorld(j.cell);
      const v = this.pinVoltage({ junctionId: j.id });
      const color = v === null ? PALETTE.cyan : voltageColor(v);
      const hot = this.selectedJunctions.has(j.id);
      if (conduit) {
        this.drawJunctionConduit(
          g,
          p,
          color,
          junctionDirs.get(j.id) ?? 0,
          conduit,
        );
      } else {
        g.circle(p.x, p.y, JUNCTION_R + 1.5).fill({
          color: 0x0d0b16,
          alpha: 1,
        });
        g.circle(p.x, p.y, JUNCTION_R).fill({ color });
      }
      if (hot) {
        g.circle(p.x, p.y, (conduit ? 9 : JUNCTION_R) + 3).stroke({
          width: 1.5,
          color: PALETTE.accent,
          alpha: 0.9,
        });
      }
    }
  }

  /**
   * A conduit junction: a clean rounded hub where the wire conduits meet. Each unused
   * cardinal direction gets a SHORT round-capped blanking nub (the rounded end is the
   * cap — no harsh perpendicular plate, which read as a cluttered asterisk). Kept
   * translucent to match the pipes.
   */
  private drawJunctionConduit(
    g: Graphics,
    p: Point,
    color: number,
    used: number,
    lens: BoardLens,
  ): void {
    const cap = "round" as const;
    const wallCol = lens === "analogy" ? PIPE_WALL : COND_CASING;
    const coreAlpha = lens === "analogy" ? 0.34 : 0.38;
    const pw = 6;
    const arm = PITCH * 0.32;
    const dirs: [number, number, number][] = [
      [1, 0, -1],
      [2, 1, 0],
      [4, 0, 1],
      [8, -1, 0],
    ];
    for (const [bit, ux, uy] of dirs) {
      if (used & bit) continue; // a used arm is the wire conduit itself
      const ex = p.x + ux * arm;
      const ey = p.y + uy * arm;
      g.moveTo(p.x, p.y).lineTo(ex, ey);
      g.stroke({ width: pw + 3, color: wallCol, alpha: 0.22, cap });
      g.moveTo(p.x, p.y).lineTo(ex, ey);
      g.stroke({
        width: Math.max(1, pw - 2),
        color,
        alpha: coreAlpha * 0.5,
        cap,
      });
    }
    // Hub: the nubs already overlap here (up to four arms over the run ends), so a
    // heavy fill piles into an opaque dot. Keep it translucent to match the pipes.
    g.circle(p.x, p.y, pw / 2 + 3.5).fill({ color: wallCol, alpha: 0.2 });
    g.circle(p.x, p.y, pw / 2 + 1).fill({ color, alpha: coreAlpha * 0.5 });
  }

  /**
   * Draw the net-label name tags (KiCad-style local/global labels). Each label is
   * a small pill — name in mono on a dark backing, ringed in the net's voltage
   * colour so it reads as part of the bus — set just above-right of its endpoint
   * with a short leader line. Two labels sharing a name show the *same* text, which
   * is the visible cue that they are one net (the alias). A selected label gets an
   * accent ring + the label currently being edited is dimmed (its text lives in the
   * HUD input). Text objects are pooled and grown on demand, like the scope legend.
   */
  private drawNetLabels(): void {
    const g = this.netLabelGfx;
    g.clear();
    for (const t of this.netLabelTexts) t.visible = false;
    const labels = [...this.graph.netLabels.values()].sort(
      (p, q) => p.id - q.id,
    );
    let ti = 0;
    for (const l of labels) {
      // A trace label draws at its `pos` on the wire; a pin/junction label at its
      // anchor. Either way the colour/voltage comes from the net (its `at` endpoint).
      const cell = l.pos ?? this.graph.endpointCell(l.at);
      if (!cell) continue;
      const o = this.cellToWorld(cell);
      const v = this.pinVoltage(l.at);
      const color = v === null ? PALETTE.cyan : voltageColor(v);
      const t = this.netLabelText(ti++);
      const editing = this.editingLabelId === l.id;
      t.text = l.name;
      t.style.fill = color;
      // Offset the pill from the anchor (default up-and-right so it clears the dot
      // and any wire through it; or wherever the player dragged it). A leader ties it
      // back to the anchor, KiCad-style — the dot stays on what the label names.
      const px = o.x + (l.tagOff?.dx ?? 12);
      const py = o.y + (l.tagOff?.dy ?? -18);
      const padX = 6;
      const padY = 3;
      const w = t.width + padX * 2;
      const h = t.height + padY * 2;
      t.position.set(px + padX, py + padY);
      t.visible = !editing; // the editor shows the text while typing
      const hot = this.selectedLabels.has(l.id);
      // Leader from the anchor dot to the pill's near corner.
      g.moveTo(o.x, o.y).lineTo(px, py + h / 2);
      g.stroke({ width: 1, color, alpha: 0.6 });
      g.roundRect(px, py, w, h, 3).fill({ color: 0x0d0b16, alpha: 0.92 });
      g.roundRect(px, py, w, h, 3).stroke({
        width: hot ? 1.6 : 1,
        color: hot ? PALETTE.accent : color,
        alpha: hot ? 0.95 : 0.7,
      });
      // A small filled tick at the anchor so the labelled point reads as connected.
      g.circle(o.x, o.y, 2.4).fill({ color });
    }
  }

  /** Fetch (or lazily create) the pooled net-label Text at index `i`. */
  private netLabelText(i: number): Text {
    let t = this.netLabelTexts[i];
    if (!t) {
      t = new Text({
        text: "",
        style: {
          fill: PALETTE.cyan,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 11,
          fontWeight: "600",
        },
      });
      t.resolution = this.textRes;
      this.netLabelTexts[i] = t;
      this.netLabelLayer.addChild(t);
    }
    return t;
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
   * Per-wire flow from one KCL spanning-forest pass over the per-component injections:
   * the branch current (signed, from→to — accumulating toward a source, splitting at
   * taps, redundant cycle wires at 0), the **apparent AC frequency** of that current
   * (the AC-amplitude-weighted mean of the elements' measured `ac.freq` in the wire's
   * subtree — `0` for a DC branch, the source freq on a single-source AC path), and the
   * **AC fraction** (how AC-dominated the wire is: AC amplitude vs |DC current|, so a
   * rectifier's DC rail with a little 2f ripple does not shimmer like a true AC line).
   * Render-only — never touches the sim. The shimmer handoff (`redrawWires`) reads all
   * three; the ammeter still reads the cached currents (`lastWireCurrents`).
   */
  private computeWireFlow(): Map<
    number,
    { current: number; freq: number; acFrac: number }
  > {
    const out = new Map<
      number,
      { current: number; freq: number; acFrac: number }
    >();
    const wires = [...this.graph.wires.values()].sort((p, q) => p.id - q.id);
    for (const w of wires) out.set(w.id, { current: 0, freq: 0, acFrac: 0 });
    if (!this.electrical || wires.length === 0) return out;

    // Per-pin injections routed through the forest: signed current (`inj`), AC-amplitude
    // weight (`fm`), freq-weighted amplitude (`fw`), and signed DC/mean current (`dm`).
    const inj = new Map<string, number>();
    const fm = new Map<string, number>();
    const fw = new Map<string, number>();
    const dm = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, v: number): void => {
      m.set(k, (m.get(k) ?? 0) + v);
    };
    for (const [compId, e] of this.electrical) {
      add(inj, compId + ":0", -e.current); // pin a: current leaves the net
      add(inj, compId + ":1", +e.current); // pin b: current enters the net
      // AC weight: the element's measured AC current amplitude carries its frequency;
      // DC elements contribute amplitude ~0 (and freq 0), so they don't tint a wire AC.
      const amp = e.ac?.valid ? Math.abs(e.ac.iamp) : 0;
      const f = e.ac?.valid ? e.ac.freq : 0;
      // DC (mean) current: the element's own DC component when measured, else its plain
      // current — separates a true AC line from a DC rail carrying a little ripple.
      const dc = e.ac?.valid ? e.ac.imean : e.current;
      add(dm, compId + ":0", -dc);
      add(dm, compId + ":1", +dc);
      for (const pin of [":0", ":1"]) {
        add(fm, compId + pin, amp);
        add(fw, compId + pin, amp * f);
      }
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
    // subtree beyond it (oriented child → parent), plus the unsigned AC-weight sums.
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
      // Reverse-BFS (post-order): each node's subtree sums are final by the time we
      // reach it, so record its parent edge's flow, then roll it up.
      const sub = new Map<string, number>();
      const subFM = new Map<string, number>();
      const subFW = new Map<string, number>();
      const subDM = new Map<string, number>();
      for (const u of order) {
        sub.set(u, inj.get(u) ?? 0);
        subFM.set(u, fm.get(u) ?? 0);
        subFW.set(u, fw.get(u) ?? 0);
        subDM.set(u, dm.get(u) ?? 0);
      }
      for (let i = order.length - 1; i >= 0; i--) {
        const u = order[i]!;
        const p = parent.get(u);
        if (!p) continue;
        const s = sub.get(u)!;
        const sm = subFM.get(u)!;
        const sfw = subFW.get(u)!;
        const sdc = Math.abs(subDM.get(u)!);
        out.set(p.wireId, {
          current: p.childIsFrom ? s : -s, // child→parent mapped to from→to
          freq: sm > 1e-12 ? sfw / sm : 0, // AC-amplitude-weighted mean frequency
          acFrac: sm + sdc > 1e-12 ? sm / (sm + sdc) : 0, // AC vs DC dominance
        });
        sub.set(p.pin, (sub.get(p.pin) ?? 0) + s);
        subFM.set(p.pin, (subFM.get(p.pin) ?? 0) + sm);
        subFW.set(p.pin, (subFW.get(p.pin) ?? 0) + sfw);
        subDM.set(p.pin, (subDM.get(p.pin) ?? 0) + (subDM.get(u) ?? 0));
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
    this.scopeTick = tick; // the true displayed tick, for the tick-based x-axis
    if (batch && batch.length > 0) {
      for (const s of batch) this.pushScopeSample(s.tick, s.state);
    } else {
      this.pushScopeSample(tick, snap.state);
    }
  }

  /** Append one scope sample for an advancing tick (or restart the window if the
   * timeline jumped before it, e.g. a scrub-back or reset). */
  private pushScopeSample(tick: number, state: ArrayLike<number>): void {
    const last = this.scopeSamples[this.scopeSamples.length - 1];
    // Decimate: keep one point per `stride` ticks so a long span still fits in
    // ~MAX_SAMPLES points. At the base span stride = 1, so this is exactly the old
    // per-tick behaviour; wider spans skip the in-between ticks.
    const stride = Math.max(
      1,
      Math.floor(this.effectiveScopeSpan() / MAX_SAMPLES),
    );
    if (!last || tick >= last.tick + stride) {
      this.scopeSamples.push({ tick, values: Array.from(state) });
      if (this.scopeSamples.length > MAX_SAMPLES) this.scopeSamples.shift();
    } else if (tick < (this.scopeSamples[0]?.tick ?? 0)) {
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
    // Autoscale Y to the visible traces' true min/max across the retained window,
    // so a big AC or switching swing fits instead of clipping against the frame.
    // Seeded empty (not [0,1]) so the full amplitude drives the scale; ground is
    // then kept in view as the baseline, and the range is padded with ~8% headroom
    // top and bottom so peaks never sit right on the frame edge.
    let vlo = Infinity;
    let vhi = -Infinity;
    for (const s of samples) {
      for (let c = 1; c < s.values.length; c++) {
        if (this.nodeHidden.has(c)) continue; // autoscale to visible traces only
        const v = s.values[c] ?? 0;
        if (v < vlo) vlo = v;
        if (v > vhi) vhi = v;
      }
    }
    if (!Number.isFinite(vlo) || !Number.isFinite(vhi)) {
      // No visible signal yet (all-ground, or every trace hidden): a calm 0..1 window.
      vlo = 0;
      vhi = 1;
    }
    // Keep ground in frame as the reference, then guard a perfectly flat signal so
    // it centres as a line rather than collapsing the range.
    vlo = Math.min(vlo, 0);
    vhi = Math.max(vhi, 0);
    if (vhi - vlo < 1e-9) {
      vhi += 0.5;
      vlo -= 0.5;
    }
    const pad = (vhi - vlo) * 0.08;
    const lo = vlo - pad;
    const hi = vhi + pad;
    const span = hi - lo || 1;
    // Tick-based x-axis: map each sample by its TICK within the window
    // [winEnd − spanTicks, winEnd], winEnd = the live displayed tick. The window
    // slides every frame (winEnd advances continuously), so the trace PANS smoothly
    // instead of stepping once per decimated sample — the slow/zoomed-out jitter fix.
    if (this.scopeAuto) this.updateAutoSpan();
    const spanTicks = Math.max(1, this.effectiveScopeSpan());
    const winEnd = this.scopeTick;
    const winStart = winEnd - spanTicks;
    const xAt = (tick: number): number =>
      x0 + ((tick - winStart) / spanTicks) * iw;
    const yAt = (v: number): number => y0 + (1 - (v - lo) / span) * ih;

    if (lo < 0 && hi > 0) {
      const yz = yAt(0);
      g.moveTo(x0, yz).lineTo(x0 + iw, yz);
      g.stroke({ width: 1, color: PALETTE.border, alpha: 0.4 });
    }

    // Channel traces (skip node 0 ground + hidden nodes). Only in-window samples are
    // drawn, so when scrubbed back the not-yet-reached 'future' samples stay hidden.
    for (let c = 1; c < chans; c++) {
      if (this.nodeHidden.has(c)) continue;
      const color = CHANNEL_COLORS[(c - 1) % CHANNEL_COLORS.length] ?? 0xffffff;
      let started = false;
      for (let i = 0; i < samples.length; i++) {
        const t = samples[i]!.tick;
        if (t < winStart || t > winEnd) continue;
        const v = samples[i]!.values[c] ?? 0;
        if (!started) {
          g.moveTo(xAt(t), yAt(v));
          started = true;
        } else {
          g.lineTo(xAt(t), yAt(v));
        }
      }
      if (started) g.stroke({ width: 1.4, color, alpha: 0.95 });
    }

    // Cursor at the displayed tick (the window's right edge).
    const cx = xAt(winEnd);
    g.moveTo(cx, y0).lineTo(cx, y0 + ih);
    g.stroke({ width: 1, color: PALETTE.accent, alpha: 0.85 });

    this.scopeLabel(0, fmtSI(hi, "V"), r.x + 4, y0 - 5);
    this.scopeLabel(1, fmtSI(lo, "V"), r.x + 4, y0 + ih - 5);
    this.scopeLabel(
      2,
      "t " + winEnd,
      Math.min(cx + 3, r.x + r.width - 42),
      r.y + r.height - 12,
    );
    // The visible time window (decimated span), bottom-left, so a long window reads
    // as deliberate rather than a stretched trace.
    this.scopeLabel(
      3,
      "◄ " + this.scopeSpanLabel() + " ►",
      r.x + padL,
      y0 + ih + 2,
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
/** FAIL-box pulse rate (Hz) — a calm-but-urgent breathe on a free wall-clock, so it
 *  keeps pulsing even though a FAIL freezes the run (the flow phase is frozen then). */
const FAIL_PULSE_HZ = 1.4;

class ComponentNode {
  readonly view = new Container();
  private readonly glyphHolder = new Container();
  // A short pipe stub from each pin toward the body, drawn BEHIND the tier illustration
  // so it bridges the gap between the board's wire-pipes and the part — the illustration
  // masks it wherever it has its own detail, so a zoomed-in part reads as one continuous
  // flowing run with its wires instead of a body floating free of the pipes.
  private readonly connectorGlyph = new Graphics();
  // The full-panel analogy/reality illustration, centred on the part and shown only
  // when the lens + zoom call for it (below the schematic glyph so pin dots sit on top).
  private readonly tierGlyph = new Graphics();
  private readonly glyph = new Graphics();
  private readonly failBox = new Graphics();
  private readonly label: Text;
  private readonly value: Text | null;
  private readonly meter: Text;
  private readonly failText: Text;
  private readonly pinPositions: { x: number; y: number }[] = [];
  private readonly pinLabels: string[] = [];
  // Small pin-name labels (A/K, B/C/E, …) drawn over the part at the deepest LOD.
  private readonly pinTexts: Text[] = [];
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
      this.pinLabels.push(p.label);
    }

    this.tierGlyph.position.set(this.wPx / 2, this.hPx / 2);
    this.glyphHolder.addChild(this.connectorGlyph);
    this.glyphHolder.addChild(this.tierGlyph);
    this.glyphHolder.addChild(this.glyph);
    this.view.addChild(this.glyphHolder);
    // Pinout labels live on `view` (not the rotated `glyphHolder`) so they stay
    // upright; positioned at the rotated pin and shown only at the deepest zoom.
    for (const lbl of this.pinLabels) {
      const t = new Text({
        text: lbl,
        style: {
          fill: this.color,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 9,
          fontWeight: "600",
        },
      });
      t.anchor.set(0.5);
      t.visible = false;
      this.pinTexts.push(t);
      this.view.addChild(t);
    }
    const symbol = isSymbol(this.kindTag);
    this.label = new Text({
      // The custom label if the player named this part, else the kind tag.
      text: this.component.label ?? this.kindTag,
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

    // FAIL overlay (drawn last → on top): a pulsing red box + "FAIL" label shown
    // whenever this part hits the FAIL bound. In `view` space (un-rotated) so the box
    // stays axis-aligned around the rotated part.
    this.view.addChild(this.failBox);
    this.failText = new Text({
      text: "FAIL",
      style: {
        fill: PALETTE.bad,
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 1,
      },
    });
    this.failText.anchor.set(0.5);
    this.failText.resolution = DPR;
    this.failText.visible = false;
    this.view.addChild(this.failText);

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
    this.failText.resolution = r;
    for (const t of this.pinTexts) t.resolution = r;
  }

  /** Refresh the on-board value label after an inspector edit. */
  setValue(value: number): void {
    if (this.value) this.value.text = formatValue(value, this.unit);
  }

  /** Refresh the on-board label after an inspector rename: the custom name if set,
   *  else the kind tag. */
  setLabel(label: string | undefined): void {
    this.label.text = label && label.length > 0 ? label : this.kindTag;
    this.layoutLabels();
  }

  update(
    electrical: ElectricalState,
    phase: number,
    selected: boolean,
    lens: BoardLens,
    zoom: number,
  ): void {
    const g = this.glyph;
    g.clear();

    // LOD: zoomed in under an analogy/reality lens, the part morphs into its
    // full-panel tier illustration (centred on the part, animated from the same live
    // state + phase); zoomed out — or in the schematic lens, or for a kind with no
    // such tier — it stays the clean, cheap schematic symbol. So the board overview
    // reads, and zooming into a part reveals the chosen tier.
    const tier =
      lens === "reality" && hasDetail(this.kindTag)
        ? "reality"
        : lens === "analogy" && hasAnalogy(this.kindTag)
          ? "analogy"
          : null;
    if (tier !== null && zoom >= TIER_ZOOM) {
      const tg = this.tierGlyph;
      tg.clear();
      // Render at a fixed REFERENCE size (≈ the info panel's), then scale the result
      // down onto the part footprint. The drawers carry fixed-pixel details (studs,
      // throats, spring/piston clamps like `anchorX − 40`); at the tiny footprint
      // bounds those dominate and distort the layout, so the board view drifted out
      // of alignment with the info panel. Rendering big + scaling keeps them matched.
      const REF_HW = 130;
      const REF_HH = 80;
      const targetHW = this.wPx / 2 + PITCH * 0.7;
      const scale = targetHW / REF_HW;
      // Each real pin's position in the illustration's REF space, so a multi-terminal
      // drawer can route its leads onto the actual footprint pins (the alignment the
      // owner asked for). The tier glyph is centred on the footprint and scaled by
      // `scale`, so a pin at glyph-local (p − footprint-centre) is (that / scale) in
      // REF px. Carries each pin's label so the drawer matches them up by name.
      const anchors = this.pinPositions.map((p, i) => ({
        label: this.pinLabels[i] ?? "",
        x: (p.x - this.wPx / 2) / scale,
        y: (p.y - this.hPx / 2) / scale,
      }));
      const opts = {
        kind: this.kindTag,
        bounds: { hw: REF_HW, hh: REF_HH },
        color: this.color,
        electrical,
        phase,
        value: this.component.value,
        wiper: this.component.wiper,
        temp: this.component.temp,
        anchors,
      };
      // Hide the illustration's own decorative studs on the board — the real pin
      // dots below mark the connections (and avoid the doubled-terminal clutter).
      setStudsVisible(false);
      if (tier === "reality") drawDetail(tg, opts);
      else drawAnalogy(tg, opts);
      setStudsVisible(true);
      tg.scale.set(scale);
      tg.visible = true;
      // Bridge each pin to the body with a pipe stub BEHIND the illustration, so the
      // wire-pipes flow continuously into the part (the illustration masks the inner
      // length where it has its own detail; only the pin→body gap shows). Matches the
      // wire conduit: steel wall + a faint water/electron core, width tracking current.
      const cg = this.connectorGlyph;
      cg.clear();
      const bodyCx = this.wPx / 2;
      const bodyCy = this.hPx / 2;
      const pw = 5 + 5 * Math.min(1, Math.abs(electrical.current) / 0.02);
      const core = tier === "reality" ? COND_ELEC : PIPE_WATER;
      for (const p of this.pinPositions) {
        const ex = p.x + (bodyCx - p.x) * 0.62;
        const ey = p.y + (bodyCy - p.y) * 0.62;
        cg.moveTo(p.x, p.y).lineTo(ex, ey);
        cg.stroke({
          width: pw + 3,
          color: PIPE_WALL,
          alpha: 0.3,
          cap: "round",
        });
        cg.moveTo(p.x, p.y).lineTo(ex, ey);
        cg.stroke({ width: pw, color: core, alpha: 0.16, cap: "round" });
      }
      cg.visible = true;
    } else {
      this.connectorGlyph.visible = false;
      this.tierGlyph.visible = false;
      drawGlyph(g, {
        kind: this.kindTag,
        pins: this.pinPositions,
        wPx: this.wPx,
        hPx: this.hPx,
        color: this.color,
        electrical,
        phase,
        // The manual switch draws its open/closed blade from its commanded state
        // rather than inferring it from the voltage across (so it reads right with
        // no current). Pass the live value through; other glyphs ignore it.
        value: this.component.value,
        // The potentiometer draws its wiper where it actually sits; other glyphs
        // ignore this.
        wiper: this.component.wiper,
      });
    }
    // pin dots on top (over either the schematic glyph or the tier illustration) —
    // they mark the real connection points the wires meet.
    for (const p of this.pinPositions) {
      g.circle(p.x, p.y, PIN_R + 2).fill({ color: 0x0d0b16, alpha: 1 });
      g.circle(p.x, p.y, PIN_R).fill({ color: this.color });
    }
    // The deepest LOD: a simple pin-name label by each pin (A/K, B/C/E, …), upright
    // at the rotated pin. Only with a tier illustration showing and zoomed in far.
    const showPins = tier !== null && zoom >= DETAIL_ZOOM;
    for (let i = 0; i < this.pinTexts.length; i++) {
      const t = this.pinTexts[i]!;
      const p = this.pinPositions[i];
      if (showPins && p) {
        const r = rotPx(p.x, p.y, this.component.rot);
        t.position.set(r.x, r.y - 9);
        t.visible = true;
      } else {
        t.visible = false;
      }
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
    // FAIL overlay: a pulsing red box + "FAIL" around the part's rotated extent. It
    // hit the FAIL bound — an ideal part with no series impedance pushed past physics.
    // The pulse runs on a free wall-clock so it breathes even though a FAIL freezes
    // the run (the flow `phase` is frozen while paused).
    if (electrical.failed) {
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
      const pad = 13;
      const pulse =
        0.5 +
        0.5 *
          Math.sin((performance.now() / 1000) * Math.PI * 2 * FAIL_PULSE_HZ);
      this.failBox.clear();
      this.failBox
        .roundRect(
          minX - pad,
          minY - pad,
          maxX - minX + 2 * pad,
          maxY - minY + 2 * pad,
          4,
        )
        .fill({ color: PALETTE.bad, alpha: 0.08 })
        .stroke({ color: PALETTE.bad, width: 2, alpha: 0.35 + 0.65 * pulse });
      this.failBox.visible = true;
      this.failText.position.set((minX + maxX) / 2, minY - pad - 9);
      this.failText.alpha = 0.55 + 0.45 * pulse;
      this.failText.visible = true;
    } else {
      this.failBox.visible = false;
      this.failText.visible = false;
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

/**
 * A rounded version of `pts` as a tessellated polyline: each interior vertex becomes a
 * quadratic-arc elbow (tangent to both legs, pulled back by up to `r`, capped at half
 * the shorter leg), sampled into `steps` segments. Returning points (not drawing) lets
 * the conduit be BOTH stroked and walked by the carriers along the exact same path, so
 * the particles follow the rounded pipe through its bends.
 */
function roundedPoints(pts: Point[], r: number, steps = 6): Point[] {
  if (pts.length < 3 || r <= 0.5) return pts.slice();
  const out: Point[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]!;
    const v = pts[i]!;
    const n = pts[i + 1]!;
    const d1 = Math.hypot(v.x - p.x, v.y - p.y) || 1;
    const d2 = Math.hypot(n.x - v.x, n.y - v.y) || 1;
    const r1 = Math.min(r, d1 / 2);
    const r2 = Math.min(r, d2 / 2);
    const ax = v.x + ((p.x - v.x) / d1) * r1;
    const ay = v.y + ((p.y - v.y) / d1) * r1;
    const bx = v.x + ((n.x - v.x) / d2) * r2;
    const by = v.y + ((n.y - v.y) / d2) * r2;
    out.push(new Point(ax, ay));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push(
        new Point(
          u * u * ax + 2 * u * t * v.x + t * t * bx,
          u * u * ay + 2 * u * t * v.y + t * t * by,
        ),
      );
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Cardinal-direction bit (N=1,E=2,S=4,W=8) of the step from `a` toward `b`. */
function dirBit(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 2 : 8;
  return dy >= 0 ? 4 : 1;
}

type Dir = { x: number; y: number };

const NUDGE_SPACING = 9; // px between conduits sharing a channel

/**
 * Fan apart conduits that run along the SAME grid line (overlapping collinear segments)
 * so parallel pipes don't stack into one muddy band. Operates on the orthogonal draw
 * routes (before rounding), perpendicular-offsetting each overlapping INTERIOR segment
 * into its own lane. Because an orthogonal route alternates H/V, moving a segment's two
 * corner points along the perpendicular axis just lengthens the adjacent (perpendicular)
 * legs — the route stays orthogonal and the pin terminals stay put. Render-only:
 * `routes` holds per-wire Point copies, never the graph.
 */
function nudgeParallel(routes: Map<number, Point[]>): void {
  type Seg = { id: number; iA: number; iB: number; lo: number; hi: number };
  const hGroups = new Map<number, Seg[]>();
  const vGroups = new Map<number, Seg[]>();
  const push = (m: Map<number, Seg[]>, key: number, s: Seg): void => {
    const arr = m.get(key);
    if (arr) arr.push(s);
    else m.set(key, [s]);
  };
  for (const [id, pts] of routes) {
    for (let i = 0; i + 1 < pts.length; i++) {
      // Skip the two end legs so the pin terminals never move.
      if (i === 0 || i + 1 === pts.length - 1) continue;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 2) {
        push(hGroups, Math.round(a.y / 4) * 4, {
          id,
          iA: i,
          iB: i + 1,
          lo: Math.min(a.x, b.x),
          hi: Math.max(a.x, b.x),
        });
      } else if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 2) {
        push(vGroups, Math.round(a.x / 4) * 4, {
          id,
          iA: i,
          iB: i + 1,
          lo: Math.min(a.y, b.y),
          hi: Math.max(a.y, b.y),
        });
      }
    }
  }
  const apply = (groups: Map<number, Seg[]>, axis: "x" | "y"): void => {
    for (const segs of groups.values()) {
      if (segs.length < 2) continue;
      segs.sort((p, q) => p.lo - q.lo);
      let cluster: Seg[] = [];
      let hi = -Infinity;
      const flush = (): void => {
        const ids = [...new Set(cluster.map((s) => s.id))].sort(
          (p, q) => p - q,
        );
        if (cluster.length >= 2 && ids.length >= 2) {
          const lane = new Map(
            ids.map((id, k) => [
              id,
              (k - (ids.length - 1) / 2) * NUDGE_SPACING,
            ]),
          );
          for (const s of cluster) {
            const off = lane.get(s.id) ?? 0;
            const pts = routes.get(s.id)!;
            pts[s.iA]![axis] += off;
            pts[s.iB]![axis] += off;
          }
        }
        cluster = [];
      };
      for (const s of segs) {
        if (cluster.length && s.lo > hi + 2) flush();
        cluster.push(s);
        hi = Math.max(hi, s.hi);
      }
      flush();
    }
  };
  apply(hGroups, "y");
  apply(vGroups, "x");
}

const BUMP_W = 8; // hop half-width
const BUMP_H = 11; // hop height

interface ConduitSeg {
  i: number;
  axis: "H" | "V";
  fixed: number;
  lo: number;
  hi: number;
}
function conduitSegs(pts: Point[]): ConduitSeg[] {
  const out: ConduitSeg[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 2)
      out.push({
        i,
        axis: "H",
        fixed: a.y,
        lo: Math.min(a.x, b.x),
        hi: Math.max(a.x, b.x),
      });
    else if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 2)
      out.push({
        i,
        axis: "V",
        fixed: a.x,
        lo: Math.min(a.y, b.y),
        hi: Math.max(a.y, b.y),
      });
  }
  return out;
}

/**
 * Resolve conduit crossings (a perpendicular intersection of two DIFFERENT wires' draw
 * routes): a SAME-net crossing becomes a junction dot (returned); a DIFFERENT-net
 * crossing gets a "bridge" — the horizontal wire hops over the vertical one, a small
 * up-bump inserted into its route (so the pipe and its carriers ride over, not through).
 * Mutates `routes` with the bumps; the crossing must be interior to both segments (a
 * shared endpoint already connects, so it is skipped).
 */
function applyCrossings(
  routes: Map<number, Point[]>,
  nets: Map<number, number | null>,
  colorOf: (id: number) => number,
): { x: number; y: number; color: number }[] {
  const ids = [...routes.keys()];
  const cache = new Map(ids.map((id) => [id, conduitSegs(routes.get(id)!)]));
  const dots: { x: number; y: number; color: number }[] = [];
  const bumps = new Map<number, Map<number, number[]>>(); // wireId → segIdx → x list
  const addBump = (id: number, seg: number, x: number): void => {
    let m = bumps.get(id);
    if (!m) bumps.set(id, (m = new Map()));
    const arr = m.get(seg);
    if (arr) arr.push(x);
    else m.set(seg, [x]);
  };
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const A = ids[i]!;
      const B = ids[j]!;
      const na = nets.get(A);
      const sameNet = na != null && na === nets.get(B);
      for (const sa of cache.get(A)!) {
        for (const sb of cache.get(B)!) {
          if (sa.axis === sb.axis) continue;
          const h = sa.axis === "H" ? sa : sb;
          const vv = sa.axis === "H" ? sb : sa;
          if (
            vv.fixed > h.lo + 3 &&
            vv.fixed < h.hi - 3 &&
            h.fixed > vv.lo + 3 &&
            h.fixed < vv.hi - 3
          ) {
            if (sameNet) {
              dots.push({ x: vv.fixed, y: h.fixed, color: colorOf(A) });
            } else {
              addBump(sa.axis === "H" ? A : B, h.i, vv.fixed);
            }
          }
        }
      }
    }
  }
  for (const [id, segMap] of bumps) {
    const pts = routes.get(id)!;
    const out: Point[] = [pts[0]!];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const xs = segMap.get(i);
      if (xs && xs.length) {
        const dir = Math.sign(b.x - a.x) || 1;
        const hy = a.y;
        const inter: Point[] = [];
        for (const bx of xs) {
          inter.push(new Point(bx - BUMP_W, hy));
          inter.push(new Point(bx, hy - BUMP_H));
          inter.push(new Point(bx + BUMP_W, hy));
        }
        inter.sort((p, q) => dir * (p.x - q.x));
        for (const p of inter) out.push(p);
      }
      out.push(b);
    }
    routes.set(id, out);
  }
  return dots;
}

/** The short aligning stub from a pin: when the route leaves the pin perpendicular to
 *  the pin's facing `out`, return a point a little way along `out` (so the conduit
 *  exits straight, then bends). Null when it already leaves aligned (or opposite, which
 *  would hairpin). */
function alignStub(pin: Point, other: Point, out: Dir): Point | null {
  const dx = other.x - pin.x;
  const dy = other.y - pin.y;
  const d = Math.hypot(dx, dy) || 1;
  const dot = (dx / d) * out.x + (dy / d) * out.y;
  if (Math.abs(dot) > 0.5) return null;
  const len = Math.min(PITCH * 0.9, d * 0.5);
  return new Point(pin.x + out.x * len, pin.y + out.y * len);
}

/** The route a conduit is DRAWN along: the logical route plus a small aligning stub at
 *  each pin end (see {@link alignStub}). Rendering-only — the logical route (hit-test,
 *  waypoints, carriers) is unchanged. */
function conduitDrawRoute(
  route: Point[],
  out0: Dir | null,
  out1: Dir | null,
): Point[] {
  if (route.length < 2 || (!out0 && !out1)) return route;
  const pts = route.slice();
  if (out1) {
    const s = alignStub(pts[pts.length - 1]!, pts[pts.length - 2]!, out1);
    if (s) pts.splice(pts.length - 1, 0, s);
  }
  if (out0) {
    const s = alignStub(pts[0]!, pts[1]!, out0);
    if (s) pts.splice(1, 0, s);
  }
  return pts;
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

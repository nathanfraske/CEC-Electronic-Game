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
  Sprite,
  Texture,
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
  footprintCenter,
  rotateInPlaceShift,
  flipInPlaceShift,
  isJunctionRef,
  isPinRef,
  isFrame,
  isDieFrame,
  endpointKey,
  framePackage,
  frameTag,
  dieFrameTag,
  ensureFrameKind,
  registerFreeFormFrame,
  freeFormGeom,
  isFreeFormFrame,
  FREE_FORM_DIE_PREFIX,
  captureFreeFormGeoms,
  restoreFreeFormGeoms,
  type Component,
  type PinRef,
  type Endpoint,
  type Cell,
  type Wire,
  type GraphSnapshot,
  type PinTest,
  type FreeFormGeom,
} from "./graph";
import { BLOCK_ARCHETYPE, BLOCK_MAX_PINS } from "./packages";
import {
  captureSeal,
  captureRegion,
  previewRegion,
  isUserIc,
  resolveUserIc,
  cellSymbol,
  type UserIc,
  type RegionCapture,
  type RegionBox,
} from "./userIc";
import { DIE_INTERIOR_MARGIN, dieBounds, findDieFrameId } from "./dieEditor";
import { planBusCable } from "./busWiring";
import {
  drawGlyph,
  drawCellSymbol,
  drawCellLiveBits,
  flowStabilized,
  isSymbol,
  setGlyphStyle,
  ZERO_ELECTRICAL,
  type ElectricalState,
  type GlyphStyle,
} from "./glyphs";
import {
  storedOutputs,
  formatStoredValue,
  type StoredState,
  type OutputLevel,
} from "./cellState";
import { hasValue } from "./values";
import { drawDetail, hasDetail } from "./detailDrawers";
import { drawAnalogy, hasAnalogy } from "./analogyDrawers";
import { apparentFreq, blurFactor, mix, setStudsVisible } from "./tierKit";
import { DEFAULT_TIER } from "./tiers";
import { ledTint } from "./diodes";
import { drawCompositeInternals } from "./internalsView";
import { drawUserIcInternals } from "./userIcInternalsView";
import { logAction } from "./feedback";
import {
  type CompositeInternals,
  type UserIcInternals,
  userIcGeometryDeep,
} from "./netlist";
import {
  T_AMBIENT_C,
  T_MAX_C,
  glowFactor,
  stepTemp,
  dissipatedPower,
  partHeats,
  heatsinkFactor,
} from "./thermal";
import { ThermalField, type FieldSource } from "./thermalField";
// The shared, `this`-free board render engine (geometry / carriers / conduit skins),
// extracted so the sealed-IC opened view can run the SAME wire pipeline. board.ts keeps
// thin wrappers for the few `this`-bound route helpers; everything else is used directly.
import {
  PITCH,
  PIPE_WALL,
  PIPE_WATER,
  COND_ELEC,
  saturate,
  polyline,
  roundedPoints,
  dirBit,
  nudgeParallel,
  applyCrossings,
  wireDrawOrder,
  conduitDrawRoute,
  routeLength,
  advanceBeltOffset,
  beltDots,
  sampleRoute,
  sampleRouteAt,
  drawChevron,
  solveWireFlow,
  drawConduitSkin,
  drawJunctionConduit,
  cellToWorld,
  pinOutward,
  pinExit,
  wireRoute,
  dieFramePinExit,
  frameLeadRoute,
  routeForWire,
  cleanRouteWaypoints,
  planSegmentDrag,
  emptyLazyRoute,
  extendLazyTrail,
  lazyWaypoints,
  chainOrthoRoute,
  type LazyRoute,
  snapToBoxEdge,
  firstFreePerimeterCell,
  voltageColor,
  type Dir,
  type BoardLens,
  type WireFlow,
} from "./boardRender";
// Re-export so existing importers of `BoardLens` from `./board` keep working (the type
// itself now lives in `./boardRender`, the shared `this`-free home).
export type { BoardLens } from "./boardRender";

/** Interaction modes surfaced as a toolbar in the HUD. */
export type Mode =
  | "select"
  | "place"
  | "wire"
  | "measure"
  | "junction"
  | "label"
  | "region"
  | "pan";

/** A multimeter lead anchored to a pin (which it follows) or a point on a net. */
interface ProbePoint {
  node: number;
  x: number;
  y: number;
  ref: PinRef | null;
}

/**
 * the tap point on the pipe `(tx,ty)`, the gauge base `(bx,by)` a short stub out along the
 * chosen outward normal `(ox,oy)` (unit; up unless flipped/slid to dodge parts + pipes).
 */
interface GaugeAnchor {
  tx: number;
  ty: number;
  bx: number;
  by: number;
  ox: number;
  oy: number;
}

const PIN_R = 4.5;
/** Chip Bench builder (the Chip-Bench design brief, §8.1): grab radius (SCREEN px, ÷ zoom at draw/hit) of a
 * free-form die's fat pin BEAD — ≥44px diameter so it's a finger-big SHAPE/WIRE target at any zoom. */
const BEAD_HIT_PX = 22;
/** Grab tolerance (SCREEN px, ÷ zoom) for the resize GRAB-RAIL — the right/bottom die walls themselves are
 * the resize handle (§11A "grab the wall/corner"), so the grab zone sits ON the boundary, not floating. */
const RESIZE_GRIP_PX = 12;
// `BoardLens` (the board's detail lens: schematic / analogy / reality — mirrors the info
// panel's `DiagramMode`) is defined in `./boardRender` and imported + re-exported above.
/** World zoom at/above which analogy/reality parts swap to the full illustration. */
const TIER_ZOOM = 2.2;
/** Deeper still: the tier illustration also gets its simple pinout labels (the
 * "full detail" LOD). Below this you get the cleaner label-free illustration. A FOCUSED part (hovered /
 * selected / being wired) reveals its labels from here; an AMBIENT part waits for {@link AMBIENT_LABEL_ZOOM}
 * so an overview of a dense board stays uncluttered (the owner's "labels aren't aware of their neighbours"
 * — Phase 3 / option 1: ambient parts show only essentials, full labels fade in on focus or deep zoom). */
const DETAIL_ZOOM = 4.5;
/** An AMBIENT (un-focused) part only auto-labels its pins once it's zoomed in this close — by which point
 * it's a large, near-isolated thing on screen, so its labels don't collide with neighbours. Below this an
 * ambient part shows just its symbol + pin dots (+ a sequential cell's LED bit); hover/select it to read
 * the pinout sooner. Sits between {@link LABEL_CAP_ZOOM} and {@link INTERNALS_ZOOM} (the open-replica bar,
 * which labels its own edge pins). */
const AMBIENT_LABEL_ZOOM = 7;
/** WORLD-SCALE threshold past which a sealed IC opens to its live internal sub-circuit (zoom-to-open,
 * ADR 0005) instead of staying its black-box SYMBOL. Set so a chip opens only once it's a COMFORTABLY
 * LARGE on-screen size (body roughly screen-filling), not the old ×2.5 that split while the chip was
 * still small. NB this is world.scale; the zoom METER reads ×M = world.scale / viewScale, and once you're
 * inside the opened body viewScale drops to its fit-scale (~0.2), so the meter shows ~×50 there — what the
 * owner called "split at ~50×." Each nested level opens the same way (its on-screen `absScale` crossing
 * this same bar), so the dive reads as discrete layers. */
const INTERNALS_ZOOM = 8;
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
// Zoom deep enough to DIVE the recursive IC zoom all the way to the FET silicon (Phase 2): each nested level
// opens once its on-screen size crosses INTERNALS_ZOOM (world-scale 8), and each level is shrunk by its
// fit-scale (~0.1–0.16 — a chip's body is far smaller than the circuit it abstracts), so reaching depth N
// needs camera zoom roughly INTERNALS_ZOOM / fitScale^N — ≈ ×6.3 more per level (measured on the 4-bit
// adder: depth-1 children open at ~×900, depth-2 ~×5.6k, depth-3 ~×35k, depth-4 ~×220k). A full player
// hierarchy (ALU→full-adder→half-adder→gate→sub-gate→FET, ~6 levels) reaches its transistors near ~×220k
// and reads them comfortably by ~×1M — hence the 1e6 ceiling (was 50000, which bottomed out ~4 levels in;
// owner ask: "increase the magnification more, it stops at only a few layers down"). Verified float-clean:
// Pixi v8 composes worldTransforms in float64 and batches Graphics into SCREEN space (small float32 coords),
// so a huge `world.position` (= screenCentre − boardCoord·scale) is differenced away before the float32
// upload — no breakup/jitter was observed anywhere from ×50k to ×5M (lines stay crisp, fills clean). LOD
// swaps gate on TIER_ZOOM / INTERNALS_ZOOM, far below this. (Wheel zoom is exponential, so a bigger ceiling
// is just more notches, same feel.) NB the deepest dives still want careful aim — a chip's geometric centre
// is often a routing gap between sub-cells, so zooming dead-centre can dive into empty space; aim at the
// sub-cell you want. A future ergonomic win is a "snap into this cell" affordance (see TODOS).
const MAX_SCALE = 1_000_000;
/** Max free-form subassembly box dimension (cells, per axis). A PRESENTATION ceiling — the box is canvas
 * room for the inner circuit, not a pin budget — so it's deliberately large: a multi-gate cell (D-latch,
 * register, a CPU block) needs space to lay out its sub-cells + wiring. (Old cap was BLOCK_MAX_PINS+6 = 30,
 * which a player hit building a latch.) */
const FREE_FORM_MAX_BOX = 96;
/** Which wall/corner of the free-form box a resize grab targets. A vertical part ('n'/'s') optionally
 * prefixes a horizontal one ('e'/'w') for the four corners ('ne','nw','se','sw'). The dragged edge(s)
 * track the cursor; the OPPOSITE edge is anchored. */
type BoxAxis = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
/** CSS resize cursor per grab axis (the hover affordance — the box reads as draggable from any side). */
const RESIZE_CURSORS: Record<BoxAxis, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};
const UNDO_LIMIT = 60;
/** One undo step: the graph snapshot + the free-form box/pin geometry registered at the same instant (the
 * geometry isn't in the graph), so a box-resize / pin-move can be reverted (Chip Bench Phase 0). */
interface UndoEntry {
  graph: GraphSnapshot;
  /** free-form DIE-FRAME geoms (die-editor box/pin edits) — keyed by `__DIE_FF_*` tag. */
  geoms: [string, FreeFormGeom][];
}
/** Max gap (ms) between two presses on a junction to count as a double-click. */
const DOUBLE_CLICK_MS = 350;
/** Alpha the armed-part placement ghost is drawn at (a faint translucent preview). */
const GHOST_ALPHA = 0.32;
/** Alpha an OFF-net part recedes to under the KiCad-style net highlight (a gentle dim — it should recede,
 * not vanish — while the highlighted net's own parts stay full + ringed). */
const NET_DIM_ALPHA = 0.45;
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
/** Past this world zoom a PIN LABEL stops riding the camera: it counter-scales BOTH its size and its
 * pin offset to a constant on-screen size + distance (anchored at its pin), and rasterizes at that scale,
 * so it stays crisp + readable near the pin instead of ballooning blurry as you dive deep into a chip
 * (owner: "text should scale and move after about ×7, but stay near the pin"). */
const LABEL_CAP_ZOOM = 7;
/** In WIRE mode every pin label on the CURRENT layer is forced visible at any zoom (so you can see what
 * you're connecting). To keep them legible when revealed zoomed-OUT, their on-screen size never drops
 * below this multiple of the base glyph — the floor the constant-size counter-scale clamps up to. Above
 * this zoom the labels just ride the camera as usual, so toggling wire mode is seamless past it. */
const WIRE_LABEL_MIN = 2.5;

// Multimeter lead colours: red "+" and steel "−", like a real DMM.
const PROBE_PLUS = 0xe0533a;
const PROBE_MINUS = 0x7c90a4;

// The live region tool's overlay colour — the teal the BLOCK subassembly body uses (glyphs.ts
// BLOCK_BODY_COLOR), so the rectangle you draw reads as "this becomes a teal subassembly".
const REGION_COLOR = 0x49a08c;

/** Re-pin a free-form lead onto a RESIZED box's perimeter (pin/box editing). Keeps the wall the pin was
 * on — a pin on the right/bottom wall follows that wall outward on grow / inward on shrink — and clamps an
 * along-edge coordinate into the new range. Growing keeps a pin's absolute position (so it can't collide);
 * a hard shrink may stack two leads on one edge cell (rare with ±1 steps — a visual nit, never a netlist
 * one: leads stay distinct by INDEX). Pure geometry. */
function clampPinToBox(
  p: { dx: number; dy: number; name?: string },
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
): { dx: number; dy: number; name?: string } {
  let dx = p.dx;
  let dy = p.dy;
  if (dx >= oldW - 1)
    dx = newW - 1; // right wall → follow it
  else if (dx <= 0)
    dx = 0; // left wall
  else dx = Math.min(dx, newW - 1); // mid top/bottom wall → clamp inside
  if (dy >= oldH - 1)
    dy = newH - 1; // bottom wall → follow it
  else if (dy <= 0)
    dy = 0; // top wall
  else dy = Math.min(dy, newH - 1);
  return { ...p, dx, dy };
}

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
// EMA weight for the per-wire running RMS current (`wireMs`). Only consulted where the
// shimmer blur is non-zero (apparent rate ≳10 Hz), and there one frame steps a large
// fraction of a cycle, so this short tail still settles to a stable RMS within a few
// frames (≤~3% residual ripple at the blur onset) while staying responsive to real changes.
const WIRE_RMS_ALPHA = 0.04;
const V_REF = 6; // ~one rail; net voltage above this saturates the energy layer
// Saturate the direction factor: any current/power past this small fraction of the
// reference moves at full constant speed; smaller values ramp smoothly so an AC
// zero-crossing eases through zero instead of snapping (it never sets the rate).
const FLOW_DIR_SAT = 0.05;
// `MAX_FLOW_PX_PER_FRAME` (largest belt advance per frame) now lives in `./boardRender`.
// Belt thickness range (px): a near-zero current reads as a thin hair, a current
// at/above the saturation reference as a bold bus. Wider than before so amperage
// is legible at a glance (saturating normalization keeps a huge current bounded).
const BELT_WIDTH_MIN = 1.4;
const BELT_WIDTH_MAX = 7.0;
// Free-form frame-pin PINOUT legs never draw thinner than this: a zero-current digital input (a CMOS gate
// draws ~no DC current) would otherwise collapse to a wispy hairline. A current-carrying lead (VCC/OUT)
// already exceeds it, so its heavier current-scaled width is untouched — only the thin legs are floored.
const LEAD_WIDTH_FLOOR = 3.0;
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
// `MAX_BELT_DOTS` (per-belt dot cap) now lives in `./boardRender`.
// Faint shimmer-band vibration rate on the bounded flow clock — a "too fast to
// resolve" wobble for the high-frequency carrier→band handoff, NOT a real cycle.
const SHIMMER_VIB = 9;

// --- reality LED voltage bar-gauge -------------------------------------------
// One small segmented bar per NET, drawn at the net's representative anchor in the
// REALITY lens only — the pre-attentive MAGNITUDE channel for voltage (the rail-identity
// COLOUR already rides the conduit via `voltageColor`). RMS is the solid lit fill; the
// peak swing (Vmin..Vmax) is a translucent envelope band above it; a bipolar AC net
// (swings through ground) is drawn centre-zero. Geometry is in WORLD px (the bar only
// shows past TIER_ZOOM, where the world is magnified, so it stays a readable size).
const BAR_HALF = 18; // half-height (px): a full unipolar bar is ~2× this tall
const BAR_W = 7; // bar width (px)
const BAR_SEGS = 8; // number of stacked segments (the "LED" look)
const BAR_SEG_GAP = 1; // gap between lit segments (px)
// Placement: the gauge taps off the pipe along a short stub, then the column extends
// outward. The collision box is the column's reach plus the stub plus a little padding;
// if an UP gauge would hit a part or another pipe we flip it DOWN, and failing that slide
// the anchor along the net's route (these fractions of the route length, each side of the
// midpoint) until an up- or down-gauge box is clear.
const GAUGE_STUB = 7; // px stub from the pipe to the gauge base (reads as a tap)
const GAUGE_BOX_PAD = 4; // px padding around the collision box (breathing room)
const GAUGE_BOX_W = 13; // px collision-box half-width (covers SP_W/BAR_W + the "~"/surface)
const GAUGE_NUDGE_FRACS = [0.18, -0.18, 0.32, -0.32, 0.42, -0.42]; // along-route slides tried
const GAUGE_PIPE_CLEAR = 5; // px: a route point this close to the box counts as a hit
// Magnitude is shown as a fraction of the CIRCUIT's max rail (|level| / vMax), so the gauges
// track the closed circuit's actual range — see `circuitVMax`. (The earlier fixed-reference
// soft-saturation volts→px flattened every low-voltage circuit; it was replaced by this.)
// A net counts as "appreciable swing" (envelope band + "~" AC badge) when its peak-to-peak
// exceeds this fraction of the bar's full scale; below it the net reads as flat DC.
const BAR_SWING_EPS = 0.02;
// A net is bipolar AC (centre-zero) when it swings through ground (Vmin<0<Vmax) AND its DC
// mean is small versus the swing — |mean| under this fraction of the half peak-to-peak.
const BAR_BIPOLAR_MEAN_FRAC = 0.35;
const BAR_FILL_ALPHA = 0.95; // solid RMS segments
const BAR_ENV_ALPHA = 0.3; // translucent peak-envelope segments
const BAR_OFF_ALPHA = 0.14; // unlit segment track (the "off LED")
const BAR_OFF_COLOR = 0x6b6488; // unlit track / notch colour (the rail muted-violet)
const BAR_NOTCH_COLOR = 0xe9e4ff; // the always-drawn zero-notch line

// --- analogy water standpipe voltage gauge -----------------------------------
// The analogy twin of the reality LED bar: one thin glass/steel STANDPIPE per NET, drawn at
// the same placement-aware per-net anchor (and on the same reach, BAR_HALF→H) in the ANALOGY
// lens only, so the two lenses agree on size + magnitude. HEIGHT = water pressure = VOLTAGE,
// scaled to the circuit max (`circuitVMax`). A ground line at the base is the zero level; the
// column fills OUTWARD along the tap normal (the rail), draining into a SUMP back toward the
// pipe for a bipolar AC net. The calm fill rises to the RMS level (the effective pressure —
// matches the bar + the inspector number) with a bright surface band at the waterline; a
// translucent "splash zone" (the tide / wet-mark) reaches on to the peak (Vmax) and into the
// sump to Vmin. DC ⇒ no wet-mark, just the calm level.
const SP_W = 9; // standpipe inner bore width (px)
const SP_WALL_W = 1.3; // housing wall stroke width (px)
const SP_WALL_ALPHA = 0.55; // housing wall (PIPE_WALL) alpha
const SP_WATER_ALPHA = 0.92; // calm RMS water fill
const SP_WET_ALPHA = 0.26; // translucent splash/tide band (peak envelope)
const SP_SURFACE_ALPHA = 0.95; // the bright surface band at the calm waterline
const SP_SURFACE_H = 2.2; // surface-band thickness (px)
const SP_GROUND_ALPHA = 0.8; // the always-drawn ground (zero-level) line
const SP_TINT = 0.5; // blend the surface band PIPE_WATER→rail colour by this much

// --- conduit skin (analogy/reality LOD) --------------------------------------
// Zoomed in under the analogy/reality lens, a bare trace is re-skinned as the same
// conduit the components become: an ANALOGY pipe (steel wall + dark bore + voltage-
// tinted water, carriers flowing WITH the current) or a REALITY metal conductor
// (bright sheath + glowing core, an electron gas drifting AGAINST the current). Both
// keep the bus language — colour = net voltage, density/thickness = current — just
// re-skinned to match the part illustrations. Kicks in at the same `TIER_ZOOM`.
// (`PIPE_WALL`/`PIPE_WATER`/`COND_CASING`/`COND_ELEC` now live in `./boardRender`.)

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
  /** Horizontal flip (mirror), so the info-panel pinout matches the board. Undefined →
   * not flipped. Presentation only (pins keep their index). */
  mirror?: boolean;
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
  /** The part's quality tier (0 budget … 3 lab-grade). Undefined → mid-range. Only the
   * tiered kinds (see {@link hasTiers}) use it. */
  tier?: number;
  /** The part's device variant (a diode's type / an LED's colour). Undefined → 0. Only the
   * multi-variant kinds (see {@link hasDiodeTypes}) use it. */
  variant?: number;
  /** The part's heatsink level (0 none … 2 large) — a thermal management lever that lowers θ_JA.
   * Undefined → 0. Only self-heating kinds (see {@link partHeats}) use it, in Real mode. */
  heatsink?: number;
  /** The pulse generator's duty cycle (0..1). Undefined → 0.5. Only kind `"PULSE"` uses it.
   * The electronic load `"LOAD"` reuses it as its dynamic load-step duty. */
  duty?: number;
  /** The electronic load's mode (0 = constant-current CC, 1 = constant-resistance CR). Undefined
   * → CC. Only kind `"LOAD"` uses it; it decides the value's unit and the netlist element. */
  mode?: number;
  /** The electronic load's dynamic step frequency in Hz (0 = static; > 0 steps base→peak current).
   * Undefined → static. Only kind `"LOAD"` in CC mode uses it. */
  loadHz?: number;
  /** A behavioral block's data word: the LUT's 16-bit truth table or a SPI/UART data word
   * (→ the behavioral element's aux). Undefined → the kind's default. Only the behavioral
   * kinds (`"LUT"`, `"SPIM"`, `"SPIS"`, `"UART"`) use it. */
  word?: number;
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
    mirror?: boolean;
    amp?: number;
    wiper?: number;
    temp?: number;
    family?: number;
    openDrain?: boolean;
    label?: string;
    tier?: number;
    variant?: number;
    heatsink?: number;
    duty?: number;
    mode?: number;
    loadHz?: number;
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
  /** Live state of the region tool's pending rectangle (the free-form subassembly the player is mapping
   * out on the board): `null` when there's no rectangle, else its inferred pin count + a refusal reason
   * (too few / too many crossings) so the HUD can show a "Seal region" affordance or explain why not.
   * Render-only — sealing happens via {@link Board.sealPendingRegion}. */
  onRegion?: (info: { pinCount: number; reason?: string } | null) => void;
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
      /** The label's pinned colour (PIXI hex int) when editing one that has one, so
       * the HUD swatch shows the current value; null for a new label or an unpinned one. */
      initialColor: number | null;
      rect: AnchorRect;
    } | null,
  ) => void;
  /**
   * Open the inline DIE-PIN name editor (IC-maker port-pad naming). Fired by a double-click on a
   * die frame's perimeter pin: the HUD shows a small input seeded with `initial` (the pin's current
   * name, or its package number) at `rect`, and on commit calls back {@link Board.commitPinName}.
   * `componentId`/`pinIndex` identify the pad. A null payload closes the editor. Presentation only.
   */
  onPinNameEdit?: (
    req: {
      componentId: number;
      pinIndex: number;
      /** the package pin number shown as the placeholder/fallback when the name is blank. */
      number: number;
      initial: string;
      /** the pad's current TEST STIMULUS (die-editor authoring-only) so the popover can seed its
       * role/value controls; null when the pin has no stimulus. See {@link Board.setComponentPinTest}. */
      test: PinTest | null;
      rect: AnchorRect;
    } | null,
  ) => void;
}

export class Board {
  private readonly world = new Container();
  private readonly grid = new Graphics();
  // Thermal-lens heat-field overlay (web-only, presentational): an inferno board heatmap shown when the
  // lens is "thermal". A coarse field diffuses heat from the hot parts across the board; it is rendered
  // via a small canvas-texture sprite stretched over the board content bbox (so it pans/zooms with the
  // board, behind the wires + components which stay distinct on top). Built lazily — the grid is sized to
  // the content bbox on first use. See thermalField.ts + docs/heat-on-the-board-ideation.md (§1 B).
  private readonly heatSprite = new Sprite();
  private heatField: ThermalField | null = null;
  private heatCanvas: HTMLCanvasElement | null = null;
  private heatCtx: CanvasRenderingContext2D | null = null;
  private heatTexture: Texture | null = null;
  private heatImage: ImageData | null = null;
  private heatCols = 0;
  private heatRows = 0;
  // The live thermal-lens readout, for the °C colour-scale legend: the hottest cell on the board and the
  // temperature mapped to the top (white-hot) of the inferno scale the overlay is painted with (so the
  // legend's labels line up with the overlay's colours). Ambient when the lens is off.
  private heatPeakC = T_AMBIENT_C;
  private heatScaleTopC = T_AMBIENT_C + 80;
  // The die-editor boundary ("walls"): drawn behind everything but the grid when the board is the
  // inner canvas of an IC-maker frame (ADR 0006). Empty/invisible on the normal outer board.
  private readonly dieWallLayer = new Graphics();
  private readonly wireLayer = new Graphics();
  private readonly groundLayer = new Graphics();
  private readonly groundLabels: Text[] = [];
  private readonly selectionLayer = new Graphics();
  private readonly marqueeLayer = new Graphics();
  // The live region tool's overlay: the pending rectangle + a dot marker per inferred boundary pin,
  // drawn ABOVE the parts so the player sees where pins will land as they size the box. The labels
  // (GND / VCC / Pn) are a growable Text pool, like the net-label tags.
  private readonly regionLayer = new Graphics();
  private readonly regionLabels: Text[] = [];
  private readonly pendingWire = new Graphics();
  private readonly componentLayer = new Container();
  // KiCad-style NET FOCUS overlay: amber rings on every pin of the net brought forward (the in-progress
  // wire's source net, or the net under an idle hover). Drawn ABOVE the component bodies so the rings sit
  // on top of the pins they mark; the net's TRACES get their halo on `wireLayer` (below) and off-net parts
  // are dimmed via each node's `view.alpha`.
  private readonly netFocusLayer = new Graphics();
  // Translucent placement preview ("ghost") of the armed part at the snapped
  // cursor cell. A dedicated low-alpha layer holding one reused Graphics — no DOM,
  // and it rotates the held part's glyph in place via the holder's rotation.
  private readonly ghostLayer = new Container();
  // The floating paste preview: a translucent glyph per clipboard component, drawn
  // at the cursor and draggable/rotatable until a click drops the group.
  private readonly pasteGhostLayer = new Container();
  private readonly pasteGhostGlyphs: Graphics[] = [];
  private readonly ghostGlyph = new Graphics();
  // Holds the ghost's glyph + tier illustration and carries the rotation/flip (scale.x),
  // exactly like a placed ComponentNode's `glyphHolder` — so the tier glyph can use the same
  // centre-position + uniform-scale and compose identically under mirror + rotation.
  private readonly ghostGlyphHolder = new Container();
  // The ghost's tier illustration (analogy/reality), drawn under the same rotation/flip as
  // the schematic ghost glyph when the active lens + zoom call for it, so the preview shows
  // what the placed part will actually look like (drawDetail/drawAnalogy). Hidden otherwise.
  private readonly ghostTierGlyph = new Graphics();
  // Upright pin-name labels for the armed ghost (A/K, D/S/G, …) at its rotated/flipped pin
  // positions, matching the placed-part `pinTexts` look — so the pinout reads before dropping.
  // A growable pool, sized on demand to the armed kind's pin count.
  private readonly ghostPinTexts: Text[] = [];
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
  // Composite-IC internal topology (component id → its sub-elements + node indices) from the
  // netlist, so a sealed chip can open to its live sub-circuit when zoomed in under the reality
  // lens (ADR 0005). Refreshed on rebuild (setCompositeInternals); render-only, never hashed.
  private compositeInternals?: Map<number, CompositeInternals>;
  // Sealed USER-IC inner circuits (component id → the authored parts/wires + node indices) from the
  // netlist, so a placed sealed chip opens to a scaled miniature of the EXACT circuit the player
  // drew when zoomed in (the owner's zoom-to-open ask). Refreshed on rebuild (setUserIcInternals);
  // render-only, never hashed.
  private userIcInternals?: Map<number, UserIcInternals>;
  // Per-node pinned colour overrides (node index → PIXI hex int) from the net
  // labels' `color`. When a node is present here the renderer paints its whole net
  // this colour instead of the voltage colour. Refreshed on rebuild (setNodeColors);
  // honoured at every colour choke-point via nodeColor/endpointColor. Render-only.
  private nodeColorOverrides = new Map<number, number>();

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
  // Placement mirror (horizontal flip) for the armed part: F flips it while armed, the
  // ghost reflects it, and the part drops pre-flipped. Resets with the rotation when a
  // fresh kind is armed; independent of any selected part's mirror.
  private armedMirror = false;
  // Accumulated grid-cell shift that keeps the armed part's footprint CENTRE fixed under
  // the cursor as it is rotated/flipped in place (the same compensation rotateSelection
  // applies to a placed part's `cell`). Applied to the snapped drop cell in BOTH the ghost
  // render and the drop, so the part lands exactly where the ghost previewed. Resets to
  // (0,0) with armedRot/armedMirror when a fresh kind is armed.
  private armedCellShift: Cell = { col: 0, row: 0 };
  // Arm-time configurator: the player's pre-placement choices for the armed part on
  // the config axes (variant / tier / family / openDrain / mode / loadHz / duty / amp).
  // Threaded into `graph.place` on every drop so place-and-repeat carpets the configured
  // part, and read by the ghost (an LED preview tints by its chosen colour). Set by
  // {@link setArmed}/{@link setArmedConfig} from the UI; empty = the per-kind defaults.
  private armedConfig: Partial<Component> = {};
  // Whether the pointer is currently over the board, so the ghost shows only while
  // hovering and hides the moment the pointer leaves.
  private pointerInside = false;
  private viewportDirty = true;
  // The cumulative fit-scale of the deepest OPENED IC level under the view centre (1 ⇒ the open board),
  // latched each frame by the zoom-meter probe in `update`. Read via `getViewMetrics` for the HUD.
  private viewScale = 1;
  /** The deepest opened cell's package WIDTH on screen (px), 0 on the open board — the meter anchors it to
   * a fixed chip size so each baked cell is its own scale universe (package ~mm → transistors ~node)
   * regardless of nesting depth (#71). Latched per frame from the same `viewProbe` as {@link viewScale}. */
  private viewAnchorPx = 0;
  /** The deepest OPENED nesting level under the view centre this frame (0 ⇒ the open board, 1 ⇒ inside a
   * top-level chip, 2 ⇒ inside one of its sub-cells, …). Latched from the same `viewProbe` as
   * {@link viewScale}; render-only (never hashed). Exposed via `getViewMetrics` so the harness can assert
   * how deep the recursive zoom-to-open actually reached at a given camera scale. */
  private viewDepth = 0;
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
  // Per-wire running mean-square branch current → its RMS smooths the thickness/density
  // off fast-AC aliasing (see `redrawWires`). Advanced once per frame in `advanceWireRms`
  // (NOT in redrawWires, which fires on every interaction), so the EMA rate stays tied to
  // wall-clock frames rather than redraw count.
  private wireMs = new Map<number, number>();
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
  // The component under an idle hover (its body or one of its pins) — so a FOCUSED part reveals its full
  // pin labels + value chip while ambient parts stay decluttered (Phase 3 label reveal). Recomputed each
  // idle move; null off any part.
  private hoverComponentId: number | null = null;
  // KiCad-style click-to-continue wiring tracks, per press, whether the pointer left
  // the cell it went down in. A press+release IN PLACE (a click) leaves the wire
  // *pending* so the next click extends it (drop corners, T into a trace, finish on a
  // pin); a press-move-release (a drag) is the classic drag-to-wire and completes the
  // segment on release. `wiringDownCell` is the snapped down-cell used to detect that
  // movement. Both are reset each time a wiring press begins/continues.
  private wiringMoved = false;
  private wiringDownCell: Cell | null = null;
  // KiCad-style "lazy-follow" routing: while a wire is pending, the pointer's path is accumulated into a
  // heading-locked orthogonal staircase (`extendLazyTrail`) so a freehand drag sketches clean bends. On
  // finish the trail is baked as the segment's WAYPOINTS (not junctions). Reset at the start of each
  // pending segment; empty ⇒ the wire falls back to its plain auto L/Z route.
  private lazyRoute: LazyRoute = emptyLazyRoute();
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
    // Brackets that coincide with a JUNCTION endpoint of the wire: dragging the segment MOVES
    // that junction (all its incident wires follow) instead of folding a stub over the tapped
    // wire — the "over-lappy" segment-drag bug. `end` is which bracket (lo=pts[bi], hi=pts[bi+1]).
    moveJunctions: { end: "lo" | "hi"; id: number }[];
    moved: boolean;
  } | null = null;
  // Dragging a junction (started by a double-click on it) to a new grid cell; its
  // incident wires follow because they reference it by id. `moved` gates the undo.
  private junctionDrag: { id: number; moved: boolean } | null = null;
  // Dragging a net label's tag pill (it follows the cursor; the anchor stays put).
  private labelDrag: { id: number; moved: boolean } | null = null;
  // Dragging a FREE-FORM die-frame PIN bead along the box edge (Chip Bench builder, SHAPE mode): rewrites
  // the frame's stored geom so the pin slides to the nearest perimeter cell; incident wires follow because
  // they reference it by index (connectivity/the netlist is untouched). `moved` gates the undo/persist.
  private pinDrag: { pinIndex: number; moved: boolean } | null = null;
  /** Chip Bench builder mode bit (the design brief §2): in a FREE-FORM die a pin-bead drag means SHAPE
   * (move the pin) when true — the geometry-first default — or WIRE (start a wire) when false. Replaces the
   * cut Alt-drag; flipped by the die-bar toggle. Irrelevant outside a free-form die. */
  private shapeMode = true;
  // Dragging the open FREE-FORM die's resize GRAB-RAIL (§11A "grab the wall/corner"): `axis` is which of
  // the 8 walls/corners is grabbed (the dragged edge tracks the cursor, the opposite edge anchors);
  // `moved` gates the one undo. The target is always the open die frame (`dieFrameId`), so no id is stored.
  private boxHandleDrag: {
    axis: BoxAxis;
    moved: boolean;
  } | null = null;
  // Timestamp + id of the last junction press, to detect a double-click (a second
  // press on the same junction within DOUBLE_CLICK_MS grabs it for dragging).
  private lastJunctionTap: { id: number; t: number } | null = null;
  // Last component-body press (id + time), so a second press on the same body
  // within DOUBLE_CLICK_MS is recognised as a double-click → open its info panel.
  private lastBodyTap: { id: number; t: number } | null = null;
  // Last die-frame pin press (component + pin index + time), so a second press on the same
  // perimeter pin within DOUBLE_CLICK_MS opens its name editor (IC-maker port-pad naming). Only
  // tracked while editing a die; a single press still starts a wire from the pin.
  private lastPinTap: { id: number; pin: number; t: number } | null = null;
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
  // The live region tool's pending rectangle (world coords), the free-form subassembly the player is
  // mapping out on the board. It PERSISTS after the drag (unlike the marquee) so the pins preview live
  // and the player can re-draw / seal when ready. `regionDrawing` is true only mid-drag.
  private pendingRegion: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null = null;
  private regionDrawing = false;
  // The region rectangle in effect when the current draw-drag STARTED, restored if that drag turns out to
  // be a mere click (sub-cell) — so a stray click in region mode doesn't wipe a box you'd already drawn.
  private regionPrev: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null = null;
  // The last region state pushed to the HUD, so a drag that doesn't change the pin count/refusal doesn't
  // churn Svelte reactivity every pointer-move.
  private lastRegionKey = "";
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
  // An undo entry pairs the graph snapshot with the free-form box/pin GEOMETRY captured at the same instant
  // (that geometry lives in the global registry, not the graph, so a box-resize / pin-move is invisible to a
  // plain `graph.serialize()` — see Chip Bench Phase 0). `geoms` is empty for boards with no free-form chips.
  private pendingUndo: UndoEntry | null = null;
  private pointer = new Point(0, 0);
  private readonly undoStack: UndoEntry[] = [];
  // IC-maker die editor (ADR 0006 / dieEditor.ts): when the active graph is a frame's inner canvas,
  // this is the die frame's id (its pins are the package leads); null on the normal outer board.
  // Drives the wall rendering + the soft containment check. App.svelte owns the drill-in/out
  // navigation (the outer snapshot/camera stash); the Board only tracks which die it is showing.
  private dieFrameId: number | null = null;

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
  /** Circuit-group root per node index (the netlist's `circuitOfNode`) so a voltage gauge scales to
   * its OWN circuit's max rail, not the whole board's. Null until a netlist installs it. */
  private circuitOfNode: number[] | null = null;
  private lastState: Float64Array = new Float64Array();
  private electrical: Map<number, ElectricalState> | undefined;
  // Per-node RMS voltage over this frame's sub-frame batch (non-aliased, unlike the
  // once-per-frame `snap.state`). Used to stabilise the wire colour on fast AC so a
  // rapidly-reversing voltage stops strobing the hue. Undefined when no batch (paused
  // / scrubbing) — the colour then tracks the instantaneous voltage as before.
  private nodeVrms: Float64Array | undefined;
  // Per-node AC statistics over the same sub-frame batch, parallel to `nodeVrms`: the DC
  // mean (the baseline / sign reference) and the swing extremes (min/max = the peak
  // envelope). Used for the rail colour's sign and for the magnitude channels (the LED bar /
  // standpipe envelope + bipolar centre-zero). Undefined when no batch ran (paused/scrubbing).
  private nodeVmean: Float64Array | undefined;
  private nodeVmin: Float64Array | undefined;
  private nodeVmax: Float64Array | undefined;

  constructor(
    private readonly app: Application,
    private readonly cb: BoardCallbacks = {},
  ) {
    this.world.addChild(this.grid);
    // The thermal heat-field overlay sits just above the grid and below the wires/parts, so the board
    // heatmap reads as a background field with the traces + components distinct on top. Non-interactive;
    // hidden unless the lens is "thermal".
    this.heatSprite.eventMode = "none";
    this.heatSprite.visible = false;
    this.world.addChild(this.heatSprite);
    // The die boundary sits just above the grid and below the wires/parts, so it reads as the
    // canvas's "wall" the circuit is built inside. Non-interactive; invisible unless in die mode.
    this.dieWallLayer.eventMode = "none";
    this.world.addChild(this.dieWallLayer);
    this.world.addChild(this.wireLayer);
    this.world.addChild(this.groundLayer);
    this.world.addChild(this.selectionLayer);
    this.world.addChild(this.componentLayer);
    // The net-focus pin rings sit just above the parts (on top of the pins they mark) and below the
    // net-label tags / overlays. Non-interactive — purely a highlight.
    this.netFocusLayer.eventMode = "none";
    this.world.addChild(this.netFocusLayer);
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
    // The region tool's overlay (pending rectangle + boundary-pin markers) rides just above the marquee
    // so its dots/labels read over the parts. Non-interactive; empty until the player draws a region.
    this.regionLayer.eventMode = "none";
    this.world.addChild(this.regionLayer);
    // The ghost rides above the components so the preview is never occluded, and
    // below the pending-wire/probe overlays. It is non-interactive and starts hidden.
    // The holder carries the rotation/flip; inside it the tier illustration sits BELOW the
    // schematic glyph (so the glyph's pin dots draw on top). Upright pin labels live on the
    // ghost layer itself (not the rotated holder) so they stay readable, added on demand.
    this.ghostGlyphHolder.addChild(this.ghostTierGlyph);
    this.ghostGlyphHolder.addChild(this.ghostGlyph);
    this.ghostLayer.addChild(this.ghostGlyphHolder);
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
    // The region rectangle PERSISTS across tool switches (so you can draw it, wire/edit the circuit with
    // its pins updating live, then come back and seal) — it's dropped only by Esc, Seal, or a drill-in,
    // not by leaving the tool. If a drag was mid-flight when the tool changed, settle it.
    this.regionDrawing = false;
    this.updateCursor();
    this.updateGhost();
  }

  /**
   * Arm a part kind: clicking empty board cells now drops it (place-and-repeat).
   * `config` (the arm-time configurator's pre-placement choices) is applied to every
   * drop and reflected in the ghost; disarming (`kind === null`) clears it.
   */
  setArmed(kind: string | null, config?: Partial<Component>): void {
    // Arming a part and a floating paste are mutually exclusive placements.
    if (kind !== null) this.cancelPaste();
    // Arming a fresh kind starts it at rotation 0 / un-flipped (R / F then adjust from
    // there); re-arming the same kind keeps the orientation the player dialled in.
    if (kind !== this.armed) {
      this.armedRot = 0;
      this.armedMirror = false;
      this.armedCellShift = { col: 0, row: 0 };
    }
    this.armed = kind;
    this.armedConfig = kind !== null ? (config ?? {}) : {};
    this.updateCursor();
    this.updateGhost();
  }

  /** Update just the armed part's configurator choices (without re-arming), so changing
   * a chip while armed re-tints the ghost and carries into the next drop. No-op when
   * nothing is armed. */
  setArmedConfig(config: Partial<Component>): void {
    if (this.armed === null) return;
    this.armedConfig = config;
    this.updateGhost();
  }

  /**
   * Rotate the *placement* rotation of the armed part 90° CW. Used by R while a
   * part is armed and nothing is selected; the ghost reflects it immediately and
   * the part drops at this rotation. No-op when nothing is armed.
   */
  rotateArmed(): void {
    if (!this.armed) return;
    const kind = PART_KINDS[this.armed];
    const newRot = (this.armedRot + 1) % 4;
    // Pivot the ghost about the footprint centre under the cursor (not the anchor), so
    // it doesn't swing away on rotate — accumulate the same cell shift a placed part gets.
    if (kind) {
      const s = rotateInPlaceShift(
        footprintCenter(kind),
        this.armedRot,
        newRot,
        this.armedMirror,
      );
      this.armedCellShift = {
        col: this.armedCellShift.col + s.col,
        row: this.armedCellShift.row + s.row,
      };
    }
    this.armedRot = newRot;
    this.updateGhost();
  }

  /**
   * Horizontally flip (mirror) the armed part's placement. Used by F while a part is
   * armed and nothing is selected; the ghost reflects it immediately and the part drops
   * pre-flipped. No-op when nothing is armed.
   */
  flipArmed(): void {
    if (!this.armed) return;
    const kind = PART_KINDS[this.armed];
    const newMirror = !this.armedMirror;
    // Pivot the ghost about the footprint centre under the cursor (not the anchor), so it
    // doesn't jump sideways on flip — accumulate the same cell shift a placed part gets.
    if (kind) {
      const s = flipInPlaceShift(
        footprintCenter(kind),
        this.armedRot,
        this.armedMirror,
        newMirror,
      );
      this.armedCellShift = {
        col: this.armedCellShift.col + s.col,
        row: this.armedCellShift.row + s.row,
      };
    }
    this.armedMirror = newMirror;
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
    if (this.pendingRegion !== null) {
      this.clearPendingRegion();
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
              this.mode === "label" ||
              this.mode === "region"
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
    this.hoverComponentId = null; // …and the label-reveal focus
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
    const tg = this.ghostTierGlyph;
    // Armed-part placement ghost: the real glyph at the snapped cell.
    if (this.armed !== null && this.pointerInside) {
      const kind = PART_KINDS[this.armed];
      if (kind) {
        // Snap to the cursor cell, then apply the in-place rotate/flip compensation so the
        // ghost (and the drop) pivots about the footprint centre, not the anchor.
        const cell = {
          col: snap(this.pointer.x, PITCH) + this.armedCellShift.col,
          row: snap(this.pointer.y, PITCH) + this.armedCellShift.row,
        };
        const o = this.cellToWorld(cell);
        // The ghost reflects the arm-time configurator where it's cheap: an LED previews
        // its chosen colour (the same `ledTint(variant)` the live LED glyph uses), so you
        // see the part's identity before dropping. Other kinds keep their palette colour —
        // the diode-type/tier/etc. choice rides the configurator panel + the dropped part
        // (the diode symbol itself doesn't vary by type in the glyph).
        const color =
          this.armed === "LED"
            ? ledTint(this.armedConfig.variant ?? 0)
            : PALETTE[kind.colorKey];
        const wPx = (kind.w - 1) * PITCH;
        const hPx = (kind.h - 1) * PITCH;
        const pins = kind.pins.map((p) => ({
          x: p.dx * PITCH,
          y: p.dy * PITCH,
        }));
        g.clear();
        tg.clear();
        // Orient via the holder exactly like a placed component (flip BEFORE rotate — PixiJS
        // applies scale before rotation), so both the schematic glyph and the tier
        // illustration ride the same transform and the preview matches the drop. The glyph +
        // tier sit at the holder's origin; the holder carries mirror + rotation.
        const holder = this.ghostGlyphHolder;
        holder.scale.x = this.armedMirror ? -1 : 1;
        holder.rotation = (this.armedRot * Math.PI) / 2;
        g.scale.x = 1;
        g.rotation = 0;
        // Follow the active lens like a placed part does (ComponentNode.update): once
        // zoomed in past TIER_ZOOM under the analogy/reality lens, preview the tier
        // illustration (drawDetail/drawAnalogy) so the ghost matches the placed part;
        // otherwise fall back to the schematic glyph.
        const effLens: BoardLens =
          this.lodEnabled && this.lens !== "thermal" ? this.lens : "schematic";
        const tier =
          effLens === "reality" && hasDetail(this.armed)
            ? "reality"
            : effLens === "analogy" && hasAnalogy(this.armed)
              ? "analogy"
              : null;
        const showTier = tier !== null && this.world.scale.x >= TIER_ZOOM;
        if (showTier) {
          // Mirror ComponentNode.update's tier render: draw at a fixed REFERENCE size,
          // then scale down onto the footprint so the fixed-pixel details stay matched.
          const REF_HW = 130;
          const REF_HH = 80;
          const targetHW = wPx / 2 + PITCH * 0.7;
          const scale = targetHW / REF_HW;
          const anchors = pins.map((p, i) => ({
            label: kind.pins[i]?.label ?? "",
            x: (p.x - wPx / 2) / scale,
            y: (p.y - hPx / 2) / scale,
          }));
          const opts = {
            kind: this.armed,
            bounds: { hw: REF_HW, hh: REF_HH },
            color,
            electrical: ZERO_ELECTRICAL,
            phase: 0,
            value: kind.defaultValue,
            wiper: this.armedConfig.wiper,
            temp: this.armedConfig.temp,
            anchors,
            // Same on-screen magnification the placed part passes, so the ghost previews the
            // same tier (device → silicon) the drop will show. ZERO_ELECTRICAL keeps it idle.
            absScale: this.world.scale.x,
          };
          tg.position.set(wPx / 2, hPx / 2);
          setStudsVisible(false);
          if (tier === "reality") drawDetail(tg, opts);
          else drawAnalogy(tg, opts);
          setStudsVisible(true);
          // Uniform scale only — the holder already carries the mirror + rotation, exactly
          // like the placed-part tierGlyph (a child of its glyphHolder).
          tg.scale.set(scale);
          tg.visible = true;
        } else {
          tg.visible = false;
          drawGlyph(g, {
            kind: this.armed,
            pins,
            wPx,
            hPx,
            color,
            electrical: ZERO_ELECTRICAL,
            phase: 0,
          });
        }
        // Pin dots, matching the real node so the ghost reads as the same part (on top of
        // either the schematic glyph or the tier illustration).
        for (const p of pins) g.circle(p.x, p.y, PIN_R).fill({ color });
        // Pin-name labels at the (rotated/flipped) pin positions, matching the placed-part
        // pinTexts look, so the pinout is visible before dropping.
        this.layoutGhostPinLabels(kind, color);
        this.ghostLayer.alpha = GHOST_ALPHA;
        this.ghostLayer.position.set(o.x, o.y);
        this.ghostLayer.visible = true;
        return;
      }
    }
    // Not the armed-part ghost: hide its tier glyph + pin labels, and reset the holder to
    // identity so the junction/label tool ghosts below (which reuse `this.ghostGlyph` and
    // draw at the origin) aren't rotated/flipped by a leftover armed transform.
    tg.visible = false;
    for (const t of this.ghostPinTexts) t.visible = false;
    this.ghostGlyphHolder.scale.x = 1;
    this.ghostGlyphHolder.rotation = 0;
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

  /**
   * Lay out the armed ghost's upright pin-name labels (A/K, D/S/G, …) at its rotated /
   * flipped pin positions, matching the placed-part `pinTexts` look (IBM Plex Mono 9px,
   * weight 600, anchored centre, parked 9px above the pin). The labels live on `ghostLayer`
   * (un-rotated, like a placed node's `view`), so each is positioned at `rotPx(pin)` —
   * staying readable while the glyph itself spins. The pool grows on demand to the kind's
   * pin count; unused entries are hidden.
   */
  private layoutGhostPinLabels(
    kind: (typeof PART_KINDS)[string],
    color: number,
  ): void {
    const pins = kind.pins;
    // Grow the pool to cover this kind's pins.
    while (this.ghostPinTexts.length < pins.length) {
      const t = new Text({
        text: "",
        style: {
          fill: color,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 9,
          fontWeight: "600",
        },
      });
      t.anchor.set(0.5);
      t.resolution = DPR;
      t.visible = false;
      this.ghostPinTexts.push(t);
      this.ghostLayer.addChild(t);
    }
    for (let i = 0; i < this.ghostPinTexts.length; i++) {
      const t = this.ghostPinTexts[i]!;
      const p = pins[i];
      if (p) {
        t.text = p.label;
        t.style.fill = color;
        const r = rotPx(
          p.dx * PITCH,
          p.dy * PITCH,
          this.armedRot,
          this.armedMirror,
        );
        t.position.set(r.x, r.y - 9);
        t.visible = true;
      } else {
        t.visible = false;
      }
    }
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

  /** Supply the per-node circuit grouping (the netlist's `circuitOfNode`) so each voltage gauge
   * scales to its OWN circuit's max rail. Null clears it (gauges fall back to one global reference). */
  setCircuitOfNode(c: number[] | null): void {
    this.circuitOfNode = c;
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

  /** Install the composite-IC internal topology (component id → {@link CompositeInternals}) from
   * the netlist, so a sealed chip can open to its live sub-circuit when zoomed in (ADR 0005).
   * Refreshed whenever the netlist rebuilds; render-only. */
  setCompositeInternals(map: Map<number, CompositeInternals> | null): void {
    this.compositeInternals = map ?? undefined;
  }

  /** Install the sealed USER-IC inner circuits (component id → {@link UserIcInternals}) from the
   * netlist, so a placed sealed chip can open to a scaled miniature of its exact authored circuit
   * when zoomed in (the owner's zoom-to-open ask). Refreshed whenever the netlist rebuilds;
   * render-only. */
  setUserIcInternals(map: Map<number, UserIcInternals> | null): void {
    this.userIcInternals = map ?? undefined;
  }

  /** Install the per-node colour overrides (node index → PIXI hex int) from the
   * netlist's labelled-net colours, so a pinned net paints its chosen colour
   * instead of its voltage colour. Refreshed whenever the netlist rebuilds. */
  setNodeColors(map: Map<number, number> | null): void {
    this.nodeColorOverrides = map ? new Map(map) : new Map();
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

  /** Re-drive a captured `place` action (route replay): drop `kind` at an exact grid `cell` through the
   * real placement path. Cell-based, so it's camera-independent — see scripts/replay.mjs / lib/feedback.ts. */
  replayPlace(kind: string, cell: Cell): Component | undefined {
    return this.placeCell(kind, cell);
  }

  /** Re-drive a captured `wire` action: re-issue the same connection. Tries the raw endpoint ref first
   * (ids align when the whole route replays from empty); else resolves the pin BY its captured absolute
   * CELL (`pinAtCell`), so wiring replays even when ids differ. Returns false if an end can't be resolved. */
  replayWire(
    from: Endpoint,
    to: Endpoint,
    fromCell?: Cell,
    toCell?: Cell,
  ): boolean {
    const resolve = (ep: Endpoint, cell?: Cell): Endpoint | undefined => {
      if (this.graph.endpointCell(ep)) return ep; // ref still valid
      const pin = cell ? this.graph.pinAtCell(cell) : undefined;
      return pin ?? undefined;
    };
    const f = resolve(from, fromCell);
    const t = resolve(to, toCell);
    if (!f || !t) return false;
    const before = this.graph.serialize();
    const wire = this.graph.connect(f, t);
    if (!wire) return false;
    this.pushUndo(before);
    this.rebuildNodes();
    this.redrawWires();
    this.cb.onChange?.(this.graph);
    return true;
  }

  /**
   * Place a part at a grid cell, recording undo and refreshing the view. `rot`
   * (90° CW steps) sets the dropped orientation — the armed placement rotation, so
   * a part lands at the angle the ghost previewed; it defaults to 0 (drag-drop).
   * `mirror` drops the part pre-flipped (the armed placement flip); defaults false.
   */
  private placeCell(
    kind: string,
    cell: Cell,
    rot = 0,
    mirror = false,
  ): Component | undefined {
    const before = this.graph.serialize();
    // Soft containment (IC-maker die editor, ADR 0006): inside a die, clamp the drop anchor to the
    // walls so new parts land in the buildable interior. Identity on the normal outer board.
    cell = this.containInDie(cell);
    // Apply the arm-time configurator's choices when dropping the armed kind — both
    // place-and-repeat (click) and a drag-from-bin of the armed part carpet the
    // configured part; dragging a *different* kind gets its plain per-kind defaults.
    const overrides = kind === this.armed ? this.armedConfig : undefined;
    const c = this.graph.place(kind, cell, overrides);
    if (c) {
      // Drop at the requested orientation (the armed placement rotation + flip) so the
      // part lands exactly as the ghost previewed it; addNode reads c.rot/c.mirror.
      c.rot = ((rot % 4) + 4) % 4;
      if (mirror) c.mirror = true;
      // Auto-splice: if a pin landed on an existing pin / junction / trace, wire it
      // in (splitting a trace through the pin's cell). Done before the undo push so
      // a single undo reverts the whole drop-and-splice.
      this.spliceOnPlace(c);
      this.pushUndo(before);
      this.addNode(c);
      this.redrawWires();
      this.cb.onChange?.(this.graph);
      // Journal the semantic op (kind + grid cell) for the bug-bundle route — cell-based, so it reads
      // cleanly and is camera-independent (cf. lib/feedback.ts).
      logAction("place", kind, { cell: { col: cell.col, row: cell.row } });
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

  /** The ids of the currently-selected COMPONENTS (the marquee/box selection), for the overworld
   * "Make subassembly" capture (§4.9). Wires/junctions/labels are excluded — `captureRegion` infers
   * the internal wiring itself. */
  getSelectedComponentIds(): number[] {
    return [...this.selected];
  }

  /** Capture the current box selection as a bare subassembly (§4.9): infer the pinout from the nets
   * crossing the selection boundary and register a `role='subassembly'` cell. NON-DESTRUCTIVE — the
   * board is untouched (the subassembly is added to the library; the player places it / Tapes it out
   * later). Returns the capture (tag + pin count) or null if there's no usable region (empty
   * selection, or nothing leaves the boundary). */
  makeSubassemblyFromSelection(name?: string): RegionCapture | null {
    return captureRegion(this.graph, [...this.selected], name) ?? null;
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
        logAction("delete", "wire-segment");
        return;
      }
    }
    const counts = {
      parts: this.selected.size,
      wires: this.selectedWires.size,
      junctions: this.selectedJunctions.size,
      labels: this.selectedLabels.size,
    };
    this.pushUndo(this.graph.serialize());
    for (const id of this.selectedLabels) this.graph.removeNetLabel(id);
    for (const id of this.selected) this.graph.removeComponent(id);
    for (const id of this.selectedWires) this.graph.removeWire(id);
    for (const id of this.selectedJunctions) this.graph.dissolveJunction(id);
    this.rebuildNodes();
    this.clearSelection();
    this.redrawWires();
    this.cb.onChange?.(this.graph);
    logAction("delete", undefined, counts);
  }

  /**
   * Rotate the selected components 90° clockwise, **in place** about each part's
   * footprint centre rather than its anchor (≈ pin 0). The anchor `cell` is shifted to
   * compensate (in grid space, so the pin cells AND the glyph — both derived from
   * `cell + rotateOffset(offset, rot, mirror)` — stay perfectly consistent), so a part
   * pivots under itself instead of swinging away. Geometry only: the cell shift is a tiny
   * move, pins keep their INDEX, so connectivity and the netlist are unchanged. One undo.
   */
  rotateSelection(): void {
    if (this.selected.size === 0) return;
    this.pushUndo(this.graph.serialize());
    for (const id of this.selected) {
      const c = this.graph.components.get(id);
      if (c) {
        const kind = this.graph.kindOf(c);
        const newRot = (c.rot + 1) % 4;
        if (kind) {
          const s = rotateInPlaceShift(
            footprintCenter(kind),
            c.rot,
            newRot,
            !!c.mirror,
          );
          c.cell = { col: c.cell.col + s.col, row: c.cell.row + s.row };
        }
        c.rot = newRot;
      }
      this.nodes.get(id)?.reposition();
    }
    this.redrawWires();
    this.redrawSelection();
    this.cb.onChange?.(this.graph);
  }

  /**
   * Horizontally flip (mirror) the selected components — toggle each part's `mirror`,
   * **in place** about its footprint centre (the `cell` shifted to compensate, exactly
   * like {@link rotateSelection}) so a part flips under itself instead of jumping sideways.
   * Geometry/render only: pins keep their INDEX, so connectivity and the netlist are
   * unchanged; one undo covers the whole flip.
   */
  flipSelection(): void {
    if (this.selected.size === 0) return;
    this.pushUndo(this.graph.serialize());
    for (const id of this.selected) {
      const c = this.graph.components.get(id);
      if (c) {
        const kind = this.graph.kindOf(c);
        const newMirror = !c.mirror;
        if (kind) {
          const s = flipInPlaceShift(
            footprintCenter(kind),
            c.rot,
            !!c.mirror,
            newMirror,
          );
          c.cell = { col: c.cell.col + s.col, row: c.cell.row + s.row };
        }
        c.mirror = newMirror;
      }
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
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.endLabelEdit();
    // Restore captured free-form box/pin GEOMETRY first (it lives in the global registry, not the graph),
    // so the re-registered frame kinds are in place before the graph + nodes rebuild against them — this is
    // what makes a box-resize / pin-move undoable (Chip Bench Phase 0).
    restoreFreeFormGeoms(entry.geoms);
    this.graph.restore(entry.graph);
    this.rebuildNodes();
    this.clearSelection();
    this.redrawWires();
    this.drawDieWalls(); // a box-resize undo changes the wall rectangle; no-op outside die mode
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

  /**
   * Swap the active graph as part of a die-editor drill IN/OUT navigation (IC maker, ADR 0006 /
   * docs/ui/dieEditor.ts): replace the contents with `snapshot` and restore `camera` (or frame the
   * view if none). Unlike {@link loadGraph} this does NOT push a cross-boundary undo and it CLEARS
   * the undo stack — so a Ctrl+Z can never undo across the boundary into the other canvas (which
   * would mix the inner die and the outer board). The caller (App.svelte) stashes the OUTER
   * snapshot + camera itself and hands them back on drill-out, so the navigation is reversible at
   * the App level without corrupting either graph. Fires `onChange` so the HUD/netlist follow the
   * newly-active graph.
   */
  swapGraph(
    snapshot: GraphSnapshot,
    camera?: { x: number; y: number; scale: number },
  ): void {
    this.endLabelEdit();
    // Close any open die port-pad name editor too, so it doesn't linger across the boundary.
    this.cb.onPinNameEdit?.(null);
    // Nothing transient may cross the die boundary (audit): a pending wire, an in-flight drag, or stale
    // double-tap history from the OLD canvas would otherwise act on the NEW graph's ids.
    this.cancelWiring();
    this.pinDrag = null;
    this.boxHandleDrag = null;
    this.lastPinTap = null;
    this.lastJunctionTap = null;
    this.graph.restore(snapshot);
    this.rebuildNodes();
    this.clearSelection();
    this.redrawWires();
    // Undo must not cross the die boundary: drop the previous canvas's history.
    this.undoStack.length = 0;
    this.pendingUndo = null;
    if (camera) this.setCamera(camera);
    else this.frameDieView(snapshot);
    this.cb.onChange?.(this.graph);
  }

  /**
   * Frame the view on a freshly-entered die: centre the loaded graph's components in the canvas at
   * a comfortable zoom, so the die's perimeter pins are visible and roomy on entry. A best-effort
   * fit — falls back to the identity view for an empty graph.
   */
  private frameDieView(snapshot: GraphSnapshot): void {
    const cells = snapshot.components.map((c) => c.cell);
    if (cells.length === 0) {
      this.resetView();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of cells) {
      const p = this.cellToWorld(cell);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    // Fold in the die's WALLS (its body box) so the whole, now-roomy package frames on entry — the
    // bare anchor cells above only cover the placed parts, not the package perimeter the pins ride.
    const dieId = findDieFrameId(snapshot);
    const walls = dieId !== undefined ? dieBounds(snapshot, dieId) : undefined;
    if (walls) {
      const tl = this.cellToWorld({ col: walls.minCol, row: walls.minRow });
      const br = this.cellToWorld({ col: walls.maxCol, row: walls.maxRow });
      minX = Math.min(minX, tl.x);
      minY = Math.min(minY, tl.y);
      maxX = Math.max(maxX, br.x);
      maxY = Math.max(maxY, br.y);
    }
    // A little breathing room so the walls don't kiss the screen edge.
    const pad = DIE_INTERIOR_MARGIN * PITCH * 1.5;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const sx = this.app.screen.width / bw;
    const sy = this.app.screen.height / bh;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(sx, sy)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.world.scale.set(scale);
    this.world.position.set(
      this.app.screen.width / 2 - cx * scale,
      this.app.screen.height / 2 - cy * scale,
    );
    this.viewportDirty = true;
    this.applyTextRes();
  }

  /**
   * Frame the view on ALL placed components (the long-reserved "0" fit-to-content + a deterministic seam
   * for the screenshot harness). Centres the content in the canvas at a comfortable zoom over every
   * component's pin cells; best-effort — a no-op for an empty board. Render-only (camera pan/zoom).
   */
  fitView(): void {
    const comps = [...this.graph.components.values()];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of comps) {
      const kind = this.graph.kindOf(c);
      const cells = kind
        ? kind.pins.map((p) => this.graph.pinCell(c, p))
        : [c.cell];
      for (const cell of cells) {
        const p = this.cellToWorld(cell);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    if (!Number.isFinite(minX)) return; // nothing placed
    const pad = DIE_INTERIOR_MARGIN * PITCH * 1.5;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const scale = Math.max(
      MIN_SCALE,
      Math.min(
        MAX_SCALE,
        Math.min(this.app.screen.width / bw, this.app.screen.height / bh),
      ),
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.world.scale.set(scale);
    this.world.position.set(
      this.app.screen.width / 2 - cx * scale,
      this.app.screen.height / 2 - cy * scale,
    );
    this.viewportDirty = true;
    this.applyTextRes();
  }

  /** Harness/test accessor (render tools): centre the camera on a placed component at a given zoom scale,
   * so a headless screenshot can reach the deep-zoom LoD (pin labels, conduit skins, zoom-to-open
   * internals) that `fitView` never gets to for a single small part. Centres on the part's pin-bbox centre
   * (not its anchor) so the body sits mid-view. No-op for an unknown id. */
  centerOnComponent(id: number, scale: number): void {
    const c = this.graph.components.get(id);
    if (!c) return;
    const kind = this.graph.kindOf(c);
    const cells = kind
      ? kind.pins.map((p) => this.graph.pinCell(c, p))
      : [c.cell];
    let sx = 0;
    let sy = 0;
    for (const cell of cells) {
      const p = this.cellToWorld(cell);
      sx += p.x;
      sy += p.y;
    }
    const cx = sx / cells.length;
    const cy = sy / cells.length;
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    this.world.scale.set(s);
    this.world.position.set(
      this.app.screen.width / 2 - cx * s,
      this.app.screen.height / 2 - cy * s,
    );
    this.viewportDirty = true;
    this.applyTextRes();
  }

  /**
   * The live board graph (read-only use by the HUD): lets the die editor capture the in-place inner
   * circuit with {@link captureSeal} while it is the active graph, without a serialize round-trip.
   * Callers must not mutate it directly — go through the Board's edit methods so undo/redraw stay
   * consistent.
   */
  liveGraph(): BoardGraph {
    return this.graph;
  }

  /**
   * Re-kind a placed component in place (IC maker collapse-to-chip): change its `kind` tag, keeping
   * its cell + rotation, then rebuild its node and recompile. Used on Seal to turn the outer
   * placeholder FRAME into the sealed chip once its die has been sealed (so the frame visibly
   * becomes the IC where it sat). One undo step. No-op on a missing id or an unknown tag.
   */
  setComponentKind(id: number, tag: string): void {
    const c = this.graph.components.get(id);
    if (!c || !PART_KINDS[tag] || c.kind === tag) return;
    this.pushUndo(this.graph.serialize());
    c.kind = tag;
    // Re-default the part's primary value to the new kind's default (a sealed IC has no value
    // picker, so this just keeps the field sane); geometry (cell/rot) is preserved.
    c.value = PART_KINDS[tag]!.defaultValue;
    this.rebuildNodes();
    this.redrawWires();
    this.clearSelection();
    this.selected.add(id);
    this.redrawSelection();
    this.cb.onChange?.(this.graph);
    this.emitSelect();
    this.emitAnchor();
  }

  /**
   * Mark (or clear) which frame in the active graph is the die being edited (IC maker, ADR 0006).
   * Set to a frame id when the board is showing a frame's inner canvas — the renderer then draws
   * the boundary walls and placement is softly contained inside them; pass null on the normal outer
   * board. Redraws the walls immediately so the change is visible without waiting for a sim frame.
   */
  setDieFrame(frameId: number | null): void {
    // A persisted region rectangle belongs to the OUTER board; drilling into a die (or the graph swap that
    // comes with it) would leave a stale overlay over the inner canvas — drop it on entry.
    if (frameId !== null) this.clearPendingRegion();
    if (frameId !== null) this.shapeMode = true; // §2: geometry-first — every drill-in starts in SHAPE
    this.dieFrameId = frameId;
    this.drawDieWalls();
    // Draw (or clear) the Chip Bench builder overlay — it keys off `dieFrameId`, not selection, so a
    // free-form die shows its grab-rails + beads the moment you drill in and drops them on the way out.
    this.redrawSelection();
  }

  /**
   * Grow/shrink the pin count of a FREE-FORM (BLOCK) subassembly die (§4.10 "expandable boundaries") by
   * re-kinding its die frame to `BLOCK_<newCount>` (registered on-demand). On shrink, wires landing on a
   * removed pin (index ≥ newCount) are dropped and the pin names/tests are truncated. The frame node +
   * walls redraw. No-op (returns null) unless drilled into a BLOCK die and `1 ≤ newCount ≤ BLOCK_MAX_PINS`
   * and it actually changes. Returns the NEW placeable frame tag (e.g. `"BLOCK7"`) so the caller can keep
   * its breadcrumb / drill state in sync. Presentation/registry only — never the solve or hash; the new
   * pin is unconnected (NC), so the netlist is unchanged until the player wires it.
   */
  setDieFramePins(newCount: number): string | null {
    if (this.dieFrameId === null) return null;
    const fid = this.dieFrameId;
    const frame = this.graph.components.get(fid);
    if (!frame) return null;
    // A FREE-FORM (box-captured) die also reports archetype BLOCK, but its pins live at arbitrary cells —
    // re-kinding it to a stock BLOCK layout here would DESTROY its captured geometry. Free-form dies grow
    // via resizeFreeFormBox (box) / pin editing instead, so refuse them outright.
    if (isFreeFormFrame(frame.kind)) return null;
    const pkg = framePackage(frame.kind);
    if (!pkg || pkg.archetype !== BLOCK_ARCHETYPE) return null; // only a generic BLOCK is pin-expandable
    if (newCount < 1 || newCount > BLOCK_MAX_PINS || newCount === pkg.pinCount)
      return null;
    this.pushUndo(this.graph.serialize());
    ensureFrameKind(BLOCK_ARCHETYPE, newCount);
    // On shrink, drop wires touching a now-removed frame pin, and truncate the pin names/tests.
    if (newCount < pkg.pinCount) {
      const removed = (e: Endpoint): boolean =>
        isPinRef(e) && e.componentId === fid && e.pinIndex >= newCount;
      for (const w of [...this.graph.wires.values()]) {
        if (removed(w.from) || removed(w.to)) this.graph.removeWire(w.id);
      }
      if (frame.pinNames) frame.pinNames = frame.pinNames.slice(0, newCount);
      if (frame.pinTests) frame.pinTests = frame.pinTests.slice(0, newCount);
    }
    frame.kind = dieFrameTag(frameTag(BLOCK_ARCHETYPE, newCount));
    // Rebuild the frame node (so its pins reflect the new count) + walls + wires.
    const node = this.nodes.get(fid);
    if (node) {
      node.destroy();
      this.nodes.delete(fid);
      this.addNode(frame);
    }
    this.drawDieWalls();
    this.redrawWires();
    this.redrawSelection();
    this.cb.onChange?.(this.graph); // pin count changed → re-evaluate the die's sealable status
    this.cb.onPersist?.(this.graph);
    this.emitSelect();
    return frameTag(BLOCK_ARCHETYPE, newCount);
  }

  /** True when the die being edited is a FREE-FORM (box-captured) subassembly — gates the box/pin editing
   * controls (a stock package's footprint is fixed; only a free-form box resizes). */
  isFreeFormDie(): boolean {
    if (this.dieFrameId === null) return false;
    const frame = this.graph.components.get(this.dieFrameId);
    return !!frame && isFreeFormFrame(frame.kind);
  }

  /** The free-form die's current box size in cells + pin count (for the editor's "Box W×H" / "Pins"
   * readouts), or null when the die isn't free-form. */
  freeFormBoxSize(): { w: number; h: number; pins: number } | null {
    if (this.dieFrameId === null) return null;
    const frame = this.graph.components.get(this.dieFrameId);
    if (!frame || !isFreeFormFrame(frame.kind)) return null;
    const geom = freeFormGeom(frame.kind);
    return geom ? { w: geom.w, h: geom.h, pins: geom.pins.length } : null;
  }

  /** The open free-form die's box in WORLD coordinates (left/top/right/bottom px) — the rect whose walls +
   * corner/edge handles resize it. Public companion to {@link freeFormBoxSize} for an overlay/tooling layer
   * (compose with {@link getCamera} for screen coords). Null outside a free-form die. */
  freeFormBoxWorldRect(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null {
    return this.dieWallRect();
  }

  /**
   * Resize a FREE-FORM die frame's box by (dw, dh) cells — the "expand and contract the size of the
   * block" of pin/box editing (§4.10). Re-registers the free-form frame IN PLACE: the pin COUNT is
   * unchanged, so the kind tag (and every inner wire's frame-pin index) is untouched — only the box
   * `w×h` and the pin cells move. Any pin that sat on a now-shrunk edge is re-pinned onto the new
   * perimeter (its side preserved, along-edge position clamped) so leads never end up off the box.
   * No-op (returns false) unless the die is free-form and the size actually changes. Render/registry
   * only — never the solve or the hash; reseal reads the new geometry off the frame kind.
   */
  resizeFreeFormBox(dw: number, dh: number): boolean {
    if (this.dieFrameId === null) return false;
    const frame = this.graph.components.get(this.dieFrameId);
    if (!frame || !isFreeFormFrame(frame.kind)) return false;
    const geom = freeFormGeom(frame.kind);
    if (!geom) return false;
    return this.setDieFrameBox(geom.w + dw, geom.h + dh, true);
  }

  /**
   * Set the open FREE-FORM die's box to an ABSOLUTE `w×h` in cells — the shared core of the die-bar
   * steppers ({@link resizeFreeFormBox}) and the in-die resize-handle DRAG (Chip Bench bloom). Clamps the
   * size, re-pins each lead onto the new perimeter ({@link clampPinToBox}), and re-registers the die-frame
   * geom IN PLACE (pin COUNT/indices unchanged → the kind tag and every inner wire's frame-pin index are
   * untouched), then rebuilds the frame node and redraws walls + wires + the bloom. `recordUndo` pushes a
   * one-step undo BEFORE the edit (the stepper passes true; the drag passes false and commits its single
   * `pendingUndo` itself on the first move). No-op (false) outside a free-form die or at the clamp / no
   * change. Render + registry only — never the solve or the hash; reseal reads the new geom off the frame.
   */
  private setDieFrameBox(w: number, h: number, recordUndo: boolean): boolean {
    if (this.dieFrameId === null) return false;
    const frame = this.graph.components.get(this.dieFrameId);
    if (!frame || !isFreeFormFrame(frame.kind)) return false;
    // Grow/shrink with the TOP-LEFT origin fixed (the die-bar W±/H± steppers + the E/S handles).
    return this.setDieFrameBoxAbs(
      frame.cell.col,
      frame.cell.row,
      w,
      h,
      recordUndo,
    );
  }

  /**
   * Set the open FREE-FORM die's box to an ABSOLUTE rectangle — top-left at (`leftCol`,`topRow`) cells,
   * `w×h` in cells. Generalises {@link setDieFrameBox} so a resize can move the ORIGIN (a W/N/corner drag
   * grows/shrinks from the left/top), not just the far walls. Clamps the size (presentation ceiling, not a
   * pin budget), re-pins each lead onto the new perimeter ({@link clampPinToBox} — side preserved, so a
   * left-wall pin rides the moving left wall while a right-wall pin keeps its absolute spot), moves
   * `frame.cell`, and re-registers the geom IN PLACE (pin COUNT/indices unchanged → kind tag + inner-wire
   * frame-pin indices untouched). No-op (false) outside a free-form die or at no change. Render + registry
   * only — never the solve or the hash.
   */
  private setDieFrameBoxAbs(
    leftCol: number,
    topRow: number,
    w: number,
    h: number,
    recordUndo: boolean,
  ): boolean {
    if (this.dieFrameId === null) return false;
    const fid = this.dieFrameId;
    const frame = this.graph.components.get(fid);
    if (!frame || !isFreeFormFrame(frame.kind)) return false;
    const geom = freeFormGeom(frame.kind);
    if (!geom) return false;
    const MIN = 2;
    const MAX = FREE_FORM_MAX_BOX; // a generous PRESENTATION ceiling — canvas room, not a pin budget.
    const nw = Math.max(MIN, Math.min(MAX, Math.round(w)));
    const nh = Math.max(MIN, Math.min(MAX, Math.round(h)));
    const nLeft = Math.round(leftCol);
    const nTop = Math.round(topRow);
    if (
      nw === geom.w &&
      nh === geom.h &&
      nLeft === frame.cell.col &&
      nTop === frame.cell.row
    )
      return false; // no change
    if (recordUndo) this.pushUndo(this.graph.serialize());
    // How far the ORIGIN moved (a W/N/corner drag shifts it; an E/S drag / the steppers don't → 0).
    const dCol = frame.cell.col - nLeft;
    const dRow = frame.cell.row - nTop;
    const pins = geom.pins.map((p) => {
      const c = clampPinToBox(p, geom.w, geom.h, nw, nh);
      // A pin on a wall PERPENDICULAR to a moved origin would otherwise RIDE the shifting origin (the bug:
      // dragging the LEFT wall slid the top/bottom pins). Shift a MID top/bottom pin by the column delta and
      // a MID left/right pin by the row delta so it holds its absolute spot — exactly like the E/S drag,
      // where dCol = dRow = 0 makes this a no-op. (A wall-hugging pin rides its own wall, as before.)
      const dx =
        c.dx > 0 && c.dx < nw - 1
          ? Math.max(0, Math.min(nw - 1, c.dx + dCol))
          : c.dx;
      const dy =
        c.dy > 0 && c.dy < nh - 1
          ? Math.max(0, Math.min(nh - 1, c.dy + dRow))
          : c.dy;
      return { ...c, dx, dy };
    });
    frame.cell = { col: nLeft, row: nTop };
    this.reregisterFreeForm(frame, fid, { w: nw, h: nh, pins });
    return true;
  }

  /** Re-register the open free-form die frame with new geometry and refresh everything: rebuild the frame
   * node (so its pins reflect the new box/count), redraw walls + wires + the bloom, and fire change /
   * persist / inspector. Shared by {@link setDieFrameBox} (box) and {@link addFreeFormPin} /
   * {@link removeFreeFormPin} (pin count). Render + registry only — the pin INDEX order is preserved, so
   * inner wires follow and the kind tag is stable; never the solve or the hash. */
  private reregisterFreeForm(
    frame: Component,
    fid: number,
    geom: FreeFormGeom,
  ): void {
    registerFreeFormFrame(frame.kind.slice(FREE_FORM_DIE_PREFIX.length), geom);
    const node = this.nodes.get(fid);
    if (node) {
      node.destroy();
      this.nodes.delete(fid);
      this.addNode(frame);
    }
    this.drawDieWalls();
    this.redrawWires();
    this.redrawSelection();
    this.cb.onChange?.(this.graph);
    this.cb.onPersist?.(this.graph);
    this.emitSelect();
  }

  /**
   * Add a pin to the open FREE-FORM die (the §4.10 builder's "add a pin"): append a lead at the first free
   * perimeter cell ({@link firstFreePerimeterCell}, so it doesn't stack on an existing one), re-register the
   * frame geom in place, and refresh. The new pin is the HIGHEST index (unconnected / NC), so every existing
   * wire's frame-pin index is untouched and the netlist is unchanged until the player wires it. No-op
   * (false) outside a free-form die or at {@link BLOCK_MAX_PINS}. Undoable; render + registry only.
   */
  addFreeFormPin(): boolean {
    if (this.dieFrameId === null) return false;
    const fid = this.dieFrameId;
    const frame = this.graph.components.get(fid);
    if (!frame || !isFreeFormFrame(frame.kind)) return false;
    const geom = freeFormGeom(frame.kind);
    if (!geom || geom.pins.length >= BLOCK_MAX_PINS) return false;
    this.pushUndo(this.graph.serialize());
    const cell = firstFreePerimeterCell(geom.pins, geom.w, geom.h);
    const pins = [...geom.pins.map((p) => ({ ...p })), { ...cell }];
    this.reregisterFreeForm(frame, fid, { w: geom.w, h: geom.h, pins });
    return true;
  }

  /**
   * Remove the HIGHEST-index pin from the open FREE-FORM die (the §4.10 builder's "remove a pin"): drop any
   * wire landing on it and truncate the frame's pin names/tests (mirrors {@link setDieFramePins}'s shrink),
   * pop the geom pin, re-register, and refresh. Removing the TOP index leaves every lower pin's index — and
   * thus every other incident wire — untouched. No-op (false) outside a free-form die or at one pin (a chip
   * needs a lead). Undoable; render + registry only.
   */
  removeFreeFormPin(): boolean {
    if (this.dieFrameId === null) return false;
    const fid = this.dieFrameId;
    const frame = this.graph.components.get(fid);
    if (!frame || !isFreeFormFrame(frame.kind)) return false;
    const geom = freeFormGeom(frame.kind);
    if (!geom || geom.pins.length <= 1) return false;
    this.pushUndo(this.graph.serialize());
    const last = geom.pins.length - 1;
    const onRemoved = (e: Endpoint): boolean =>
      isPinRef(e) && e.componentId === fid && e.pinIndex === last;
    for (const w of [...this.graph.wires.values()]) {
      if (onRemoved(w.from) || onRemoved(w.to)) this.graph.removeWire(w.id);
    }
    if (frame.pinNames) frame.pinNames = frame.pinNames.slice(0, last);
    if (frame.pinTests) frame.pinTests = frame.pinTests.slice(0, last);
    const pins = geom.pins.slice(0, last).map((p) => ({ ...p }));
    this.reregisterFreeForm(frame, fid, { w: geom.w, h: geom.h, pins });
    return true;
  }

  /**
   * Delete ONE specific free-form pin (the §4.10 "pick a pin and delete it" affordance), not just the
   * last: drops any wire incident on that pad, shifts every higher pin index down by one (so wires on the
   * survivors still point at the right pad), and splices the pad out of the geom / pinNames / pinTests.
   * No-op (false) unless the die is free-form, the index is valid, and >1 pin remains. Render/registry +
   * undo only — never the solve or hash.
   */
  removeFreeFormPinAt(pinIndex: number): boolean {
    if (this.dieFrameId === null) return false;
    const fid = this.dieFrameId;
    const frame = this.graph.components.get(fid);
    if (!frame || !isFreeFormFrame(frame.kind)) return false;
    const geom = freeFormGeom(frame.kind);
    if (!geom || geom.pins.length <= 1) return false;
    if (pinIndex < 0 || pinIndex >= geom.pins.length) return false;
    this.pushUndo(this.graph.serialize());
    const framePin = (e: Endpoint): e is PinRef & { componentId: number } =>
      isPinRef(e) && e.componentId === fid;
    for (const w of [...this.graph.wires.values()]) {
      if (
        (framePin(w.from) && w.from.pinIndex === pinIndex) ||
        (framePin(w.to) && w.to.pinIndex === pinIndex)
      ) {
        this.graph.removeWire(w.id); // a wire on the removed pad goes with it
        continue;
      }
      // Survivors above the gap shift down one index so they keep pointing at the right pad.
      if (framePin(w.from) && w.from.pinIndex > pinIndex) w.from.pinIndex -= 1;
      if (framePin(w.to) && w.to.pinIndex > pinIndex) w.to.pinIndex -= 1;
    }
    if (frame.pinNames)
      frame.pinNames = frame.pinNames.filter((_, i) => i !== pinIndex);
    if (frame.pinTests)
      frame.pinTests = frame.pinTests.filter((_, i) => i !== pinIndex);
    const pins = geom.pins
      .filter((_, i) => i !== pinIndex)
      .map((p) => ({ ...p }));
    this.reregisterFreeForm(frame, fid, { w: geom.w, h: geom.h, pins });
    return true;
  }

  /**
   * Live step of an Alt-drag of a free-form frame pin (see `pinDrag`): slide pin `pinDrag.pinIndex` to the
   * nearest perimeter cell under the cursor, rewrite the frame's geom, and redraw. Re-registers the
   * free-form frame kind in place — the pin INDEX is unchanged, so incident wires / pinTests / pinNames
   * stay bound (it's the same mechanism `resizeFreeFormBox` uses, for one pin). No-op while the cursor
   * stays on the same cell, so a slow drag doesn't thrash the registry.
   */
  private movePinDrag(wp: Point): void {
    if (this.pinDrag === null || this.dieFrameId === null) return;
    const frame = this.graph.components.get(this.dieFrameId);
    if (!frame || !isFreeFormFrame(frame.kind)) return;
    const geom = freeFormGeom(frame.kind);
    if (!geom) return;
    const i = this.pinDrag.pinIndex;
    const cur = geom.pins[i];
    if (!cur) return;
    const { dx, dy } = snapToBoxEdge(
      snap(wp.x, PITCH) - frame.cell.col,
      snap(wp.y, PITCH) - frame.cell.row,
      geom.w,
      geom.h,
    );
    if (dx === cur.dx && dy === cur.dy) return; // still on the same cell — nothing to redraw
    this.pinDrag.moved = true;
    this.lastPinTap = null; // a real drag isn't a tap — don't let a quick follow-up tap read as a double-tap
    const pins = geom.pins.map((p, k) => (k === i ? { ...p, dx, dy } : p));
    registerFreeFormFrame(frame.kind.slice(FREE_FORM_DIE_PREFIX.length), {
      w: geom.w,
      h: geom.h,
      pins,
    });
    // Rebuild the frame node so its pin graphics sit at the new cell; re-route incident wires (they follow
    // by index) and refresh the selection halo. The box/walls are unchanged, so no drawDieWalls needed.
    const node = this.nodes.get(this.dieFrameId);
    if (node) {
      node.destroy();
      this.nodes.delete(this.dieFrameId);
      this.addNode(frame);
    }
    this.redrawWires();
    this.redrawSelection();
  }

  /** True when the board is currently editing an IC-maker die (its inner canvas). */
  inDie(): boolean {
    return this.dieFrameId !== null;
  }

  /**
   * Draw the die's boundary walls (the buildable interior box) in world space, behind the wires and
   * parts. A clear when not in die mode (or the die frame is gone). The box comes from
   * {@link dieBounds} (the die frame's footprint grown by the interior margin), so it tracks the
   * package's pin spread. Pure presentation — it never affects connectivity or the netlist.
   */
  private drawDieWalls(): void {
    const g = this.dieWallLayer;
    g.clear();
    if (this.dieFrameId === null) return;
    const bounds = dieBounds(this.graph.serialize(), this.dieFrameId);
    if (!bounds) return;
    // The walls sit on the die BODY box, which {@link dieBounds} now matches to `userIcBodyBox` (the
    // sealed package body) so the buildable area equals what the seal keeps — no overhang. The leads
    // overhang slightly past the array ends and cross OUT past the stick-axis walls, like a real package.
    const x = bounds.minCol * PITCH;
    const y = bounds.minRow * PITCH;
    const w = (bounds.maxCol - bounds.minCol) * PITCH;
    const h = (bounds.maxRow - bounds.minRow) * PITCH;
    // A faint die fill so the buildable area reads as a surface, plus a single bright border ON the
    // pin line — the wall the leads ride and you build inside. (No second concentric ring: it read
    // as a misaligned border floating beside the pins.)
    g.roundRect(x, y, w, h, 6);
    g.fill({ color: 0x1a1730, alpha: 0.45 });
    g.roundRect(x, y, w, h, 6);
    g.stroke({
      width: 2 / this.world.scale.x,
      color: PALETTE.accent,
      alpha: 0.7,
    });
  }

  /**
   * Soft containment for the die editor: clamp a candidate placement/move cell to inside the die's
   * walls (ADR 0006 — "a soft containment check is fine for v1"). Outside die mode it is the
   * identity, so the normal board is unaffected. The clamp keeps a part's ANCHOR inside the box (a
   * wide part may still overhang slightly — acceptable for v1; the walls are guidance, not a hard
   * DRC).
   */
  private containInDie(cell: Cell): Cell {
    if (this.dieFrameId === null) return cell;
    const bounds = dieBounds(this.graph.serialize(), this.dieFrameId);
    if (!bounds) return cell;
    return {
      col: Math.max(bounds.minCol, Math.min(bounds.maxCol, cell.col)),
      row: Math.max(bounds.minRow, Math.min(bounds.maxRow, cell.row)),
    };
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

  /** The HUD zoom meter's inputs (Phase 5): `zoom` = camera scale (screen px per world px); `viewScale`
   * = the cumulative fit-scale of the opened-IC level under the view centre (1 on the open board, the
   * product of the fit-scales you've descended through once inside nested ICs). Render-only; feeds
   * `lib/zoomMeter.ts`. */
  getViewMetrics(): {
    zoom: number;
    viewScale: number;
    anchorPx: number;
    depth: number;
  } {
    return {
      zoom: this.world.scale.x,
      viewScale: this.viewScale,
      // The opened cell's package width on screen (0 on the open board) — the meter anchors it to a fixed
      // chip size so each baked cell reads as its own ~mm chip regardless of nesting depth.
      anchorPx: this.viewAnchorPx,
      // The deepest opened nesting level under the view centre (0 on the open board) — render-only; lets
      // the harness assert how far the recursive zoom-to-open reached at a given camera scale.
      depth: this.viewDepth,
    };
  }

  /** Harness accessor (render/test tools): begin a wire from a pin (leaving it mid-drag) so a headless
   * bench can capture the net highlight + the wiring pin-focus. */
  startWireFromPin(componentId: number, pinIndex: number): void {
    const from = { componentId, pinIndex };
    const cell = this.graph.pinRefCell(from);
    if (cell) this.startWiring(from, this.cellToWorld(cell));
  }

  /** Harness accessor (render/test tools): the live voltage at every pin of a placed cell, keyed by the
   * cell's pin NAME — so a headless bench can assert a clocked register actually loaded its bit. */
  cellPinVoltages(id: number): Record<string, number | null> | null {
    const comp = this.graph.components.get(id);
    if (!comp) return null;
    const def = resolveUserIc(comp.kind, comp.variant ?? 0);
    const out: Record<string, number | null> = {};
    (def?.pinNames ?? []).forEach((nm, i) => {
      out[nm || `p${i}`] = this.pinVoltage({ componentId: id, pinIndex: i });
    });
    return out;
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

  /** Center the camera on a placed component at an absolute `scale` (px per world px) — a "zoom to this
   * part" primitive (also how the render harness drives a deep zoom-to-open for validation). Returns false
   * if the id isn't placed. Clamped to the valid zoom range. */
  focusComponent(id: number, scale: number): boolean {
    const c = this.graph.components.get(id);
    if (!c) return false;
    const box = this.componentBox(c);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    this.world.scale.set(s);
    this.world.position.set(
      this.app.screen.width / 2 - cx * s,
      this.app.screen.height / 2 - cy * s,
    );
    this.viewportDirty = true;
    this.applyTextRes();
    return true;
  }

  /** Re-derive every placed node's body label — called after a My-ICs RENAME changes a kind's display
   * name, so already-placed instances pick up the new name LIVE (the tag, and the netlist, never move).
   * A per-instance label (`component.label`) is preserved; only the kind-name fallback re-resolves. */
  refreshLabels(): void {
    for (const [id, node] of this.nodes) {
      node.setLabel(this.graph.components.get(id)?.label);
    }
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
    real = false,
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
    // Heat-integrator time-step. Thermal τ is realistically SECONDS, but the sim's DT is 2 µs (electrical),
    // so pure sim-time heat (Δticks·DT) is invisible at the slow playback you actually watch at and only
    // appears if you crank to ~500K ticks/s. So advance on the GREATER of sim-time and a WALL-CLOCK floor
    // (the clamped real frame `dt`) while the sim is playing: at slow speeds the wall floor dominates, so a
    // part warms over a few real seconds (watchable, realistic real-world pace); fast-forwarding past
    // real-time lets sim-time take over and ages it faster; paused/scrubbing freezes it (both terms 0).
    // Presentational + golden-safe — the web heat model (glow / vent / lens field) never re-enters the
    // solve or the snapshot hash (see ComponentNode `tj`/`vented`), so decoupling it from ticks is safe.
    const simDt = Math.max(0, tick - this.prevTick) * DT_SECONDS;
    const thermalDt = Math.max(simDt, running ? dt : 0);
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
      const sum = new Float64Array(n);
      const vmin = new Float64Array(n).fill(Infinity);
      const vmax = new Float64Array(n).fill(-Infinity);
      for (const s of scopeBatch) {
        const st = s.state;
        const m = Math.min(n, st.length);
        for (let i = 0; i < m; i++) {
          const x = st[i]!;
          sumsq[i] += x * x;
          sum[i] += x;
          if (x < vmin[i]!) vmin[i] = x;
          if (x > vmax[i]!) vmax[i] = x;
        }
      }
      const vrms = new Float64Array(n);
      const vmean = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        vrms[i] = Math.sqrt(sumsq[i]! / scopeBatch.length);
        vmean[i] = sum[i]! / scopeBatch.length;
      }
      this.nodeVrms = vrms;
      this.nodeVmean = vmean;
      this.nodeVmin = vmin;
      this.nodeVmax = vmax;
    } else {
      this.nodeVrms = undefined;
      this.nodeVmean = undefined;
      this.nodeVmin = undefined;
      this.nodeVmax = undefined;
    }
    this.redrawWires();
    this.advanceWireRms();
    this.drawGround();
    // Keep the die walls crisp as the view zooms (the wall stroke is scale-dependent). A clear no-op
    // outside die mode.
    if (this.dieFrameId !== null) this.drawDieWalls();
    this.drawNetLabels();
    // LOD off ⇒ force the schematic lens (clean symbols at any zoom).
    const effLens: BoardLens =
      this.lodEnabled && this.lens !== "thermal" ? this.lens : "schematic";
    // Per-frame view state shared across every node: the screen rect (for the opened-IC view cull) and
    // ONE zoom-meter probe (Phase 5) seeded at the view centre. Each opened IC writes the probe if its
    // body contains the centre and it's the deepest level seen, so after the loop `scale` is the
    // cumulative fit-scale of the level you're looking into (1 ⇒ the open board).
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const viewport = { w: sw, h: sh };
    const viewProbe = {
      cx: sw / 2,
      cy: sh / 2,
      depth: -1,
      scale: 1,
      anchorPx: 0,
    };
    // KiCad-style "bring the net forward": when a net is highlighted (routing / hover), parts with NO pin
    // on it recede to a gentle dim so the net's own parts (kept bright, pins ringed, traces haloed) pop.
    // null ⇒ nothing highlighted ⇒ every part at full alpha. The die frame never dims (it's the wall).
    const dimNet = this.highlightNet();
    for (const [id, node] of this.nodes) {
      const e = electrical?.get(id) ?? ZERO_ELECTRICAL;
      // Ease the glyph's flow/heat toward its measured RMS as the part's AC outruns the
      // eye — the per-component twin of the wire stabilisation above. The blur tracks the
      // part's own apparent rate, down-weighted by how AC-dominated it is (a DC rail with
      // a little ripple keeps streaming), so it matches the carrier→shimmer handoff.
      const ac = e.ac;
      let blurC = 0;
      if (ac?.valid) {
        const mean = Math.abs(ac.imean);
        const acFrac = ac.iamp + mean > 1e-12 ? ac.iamp / (ac.iamp + mean) : 0;
        blurC = blurFactor(apparentFreq(ac.freq)) * acFrac;
      }
      node.update(
        flowStabilized(e, blurC),
        this.phase,
        this.selected.has(id),
        effLens,
        this.world.scale.x,
        this.compositeInternals?.get(id),
        snap.state,
        this.userIcInternals?.get(id),
        this.userIcInternals,
        viewport,
        viewProbe,
        snap.elementCurrents,
        // Bring every pin's label into focus in WIRE mode OR while actively dragging a wire (so you can
        // see where you're routing), regardless of the current tool.
        this.mode === "wire" || this.wiring !== null,
        this.cellLiveState(id),
        // FOCUSED: hovered or selected → reveal this part's full pin labels + value chip even at mid zoom
        // (ambient parts wait for AMBIENT_LABEL_ZOOM, so a dense board's overview stays uncluttered).
        this.selected.has(id) || this.hoverComponentId === id,
        thermalDt,
        real,
      );
      // Off-net parts recede under the net highlight (the node's own per-child fades compose with this
      // container alpha). On-net parts, the die frame, and the no-highlight case stay fully opaque.
      node.view.alpha =
        dimNet === null ||
        id === this.dieFrameId ||
        this.componentOnNet(id, dimNet)
          ? 1
          : NET_DIM_ALPHA;
    }
    // Thermal-lens heat-field overlay: now that every node has integrated its body temperature this
    // frame, diffuse those into the board heat field and paint it (a no-op outside the thermal lens).
    this.updateHeatOverlay(thermalDt, real);
    this.deOverlapLabels();
    // Latch the metered depth for the HUD — STICKY so the readout doesn't flap. The probe reports the
    // deepest opened cell whose body contains the view CENTRE; a chip's centre is often a routing GAP
    // between sub-cells, so a frame where no body claims the centre (depth −1) must NOT reset the scale to
    // the board's mm — that's what made the gauge jump "up and down arbitrarily" as you panned/zoomed past
    // gaps. So: update on a hit; HOLD on a gap while still zoomed in; reset to the bench scale only once
    // fully zoomed out (nothing is open below INTERNALS_ZOOM). The magnification readout is driven off the
    // camera zoom directly (pan-invariant) — see App.svelte; this latch feeds the per-cell feature-size bar.
    if (viewProbe.depth >= 0) {
      this.viewScale = viewProbe.scale;
      this.viewAnchorPx = viewProbe.anchorPx;
      this.viewDepth = viewProbe.depth;
    } else if (this.world.scale.x < INTERNALS_ZOOM) {
      this.viewScale = 1;
      this.viewAnchorPx = 0;
      this.viewDepth = 0;
    }

    this.recordScope(snap, scopeBatch);
    this.drawScope();
    this.drawProbe();
    this.emitAnchor();
  }

  /**
   * Phase 3b — DE-OVERLAP the on-board labels across ALL parts. Each node has just positioned its own pin
   * names + value chip (blind to its neighbours); this cross-part pass collects every visible one with a
   * priority (focused part > ambient; output pin > input/other > value chip — {@link ComponentNode.collectLabels}),
   * keeps them greedily high-to-low, and HIDES whichever lower-priority label's screen box overlaps one
   * already kept. The pin DOTS stay (only the name text yields), and it runs before the frame paints, so the
   * render is already de-clashed. Re-evaluated every frame (the nodes re-show their labels next frame), so it
   * tracks zoom/pan/selection live. Mostly a no-op until a board is dense enough to crowd labels — focus
   * reveal already shows few at once.
   */
  private deOverlapLabels(): void {
    const labels: { text: Text; prio: number }[] = [];
    for (const node of this.nodes.values()) node.collectLabels(labels);
    if (labels.length < 2) return;
    const items = labels.map((l) => {
      const b = l.text.getBounds();
      return {
        text: l.text,
        prio: l.prio,
        minX: b.minX,
        minY: b.minY,
        maxX: b.maxX,
        maxY: b.maxY,
      };
    });
    items.sort((a, b) => b.prio - a.prio); // highest priority first
    const PAD = 1; // a hair of breathing room counts as a clash
    const kept: typeof items = [];
    for (const it of items) {
      const clash = kept.some(
        (k) =>
          it.minX < k.maxX + PAD &&
          it.maxX > k.minX - PAD &&
          it.minY < k.maxY + PAD &&
          it.maxY > k.minY - PAD,
      );
      if (clash) it.text.visible = false;
      else kept.push(it);
    }
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

  /** The live self-heating body temperature (°C) of a component — ambient if unknown or in Ideal mode.
   *  Read by the inspector to show a "Body temp" line. */
  bodyTempOf(id: number): number {
    return this.nodes.get(id)?.bodyTemp ?? T_AMBIENT_C;
  }

  /** The live heat-field readout for the thermal-lens °C legend: `peakC` is the hottest PART's junction
   *  temperature (so the legend's over-temp ⚠ flips together with the per-part OVERHEAT box) and
   *  `scaleTopC` is the temperature mapped to the top (white-hot) of the inferno colour scale the overlay
   *  is painted with — so the legend's tick labels line up with the overlay's colours. Both are ambient
   *  when the lens is off. Presentation only. */
  heatReadout(): { peakC: number; scaleTopC: number } {
    return { peakC: this.heatPeakC, scaleTopC: this.heatScaleTopC };
  }

  /** Reset every part's self-heating temperature to ambient — on a sim restart or netlist rebuild, so
   *  the board doesn't keep a stale glow from before the change. */
  resetThermals(): void {
    for (const node of this.nodes.values()) node.resetThermal();
    this.heatField?.reset();
    this.heatPeakC = T_AMBIENT_C;
    this.heatScaleTopC = T_AMBIENT_C + 80;
  }

  /**
   * The thermal-lens board heat-field overlay. When the lens is "thermal", build a coarse heat field
   * over the content bbox, inject each hot part as a held-temperature source, diffuse it `dtSec` of sim
   * time, and paint it as an inferno heatmap stretched under the wires/parts; the board itself is dimmed
   * so the field reads while the components stay distinct on top. A no-op (overlay hidden) otherwise.
   * Presentation only — never re-enters the solve.
   */
  private updateHeatOverlay(dtSec: number, real: boolean): void {
    const on = this.lens === "thermal" && real;
    // Dim the board under the heat camera so the field dominates; restore otherwise.
    this.grid.alpha = on ? 0.32 : 1;
    this.wireLayer.alpha = on ? 0.4 : 1;
    if (!on || this.nodes.size === 0) {
      this.heatSprite.visible = false;
      this.heatPeakC = T_AMBIENT_C;
      this.heatScaleTopC = T_AMBIENT_C + 80;
      return;
    }
    // Content bbox covering BOTH the part footprints AND every wire's routed polyline (+ a margin so the
    // field extends past the outermost copper). It MUST include the traces' true extent, not just the part
    // centres: a loop whose wires bow outside the parts would otherwise fall outside the grid, and
    // `buildCopperGrid`'s `toCol/toRow` clamp those off-box points onto the boundary cells — smearing heat
    // along the clipped edge instead of letting it follow the trace (the heat-doesn't-follow-traces bug).
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const grow = (x: number, y: number): void => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (const node of this.nodes.values()) {
      const b = node.worldBox;
      grow(b.x, b.y);
      grow(b.x + b.w, b.y + b.h);
    }
    for (const wire of this.graph.wires.values()) {
      for (const p of this.routeForWire(wire)) grow(p.x, p.y);
    }
    const margin = PITCH * 3;
    minX -= margin;
    minY -= margin;
    maxX += margin;
    maxY += margin;
    const w = maxX - minX;
    const h = maxY - minY;
    // One heat cell per ~half a pitch, clamped — coarse enough to be cheap, fine enough to read.
    const cell = PITCH * 0.6;
    const cols = Math.max(8, Math.min(120, Math.round(w / cell)));
    const rows = Math.max(8, Math.min(120, Math.round(h / cell)));
    if (
      !this.heatField ||
      cols !== this.heatCols ||
      rows !== this.heatRows ||
      !this.heatCanvas ||
      !this.heatCtx
    ) {
      this.heatCols = cols;
      this.heatRows = rows;
      this.heatField = new ThermalField(cols, rows);
      this.heatCanvas = document.createElement("canvas");
      this.heatCanvas.width = cols;
      this.heatCanvas.height = rows;
      this.heatCtx = this.heatCanvas.getContext("2d");
      this.heatImage = this.heatCtx?.createImageData(cols, rows) ?? null;
      this.heatTexture?.destroy();
      this.heatTexture = Texture.from(this.heatCanvas);
      this.heatTexture.source.scaleMode = "linear";
      this.heatSprite.texture = this.heatTexture;
    }
    const field = this.heatField;
    const ctx = this.heatCtx;
    const img = this.heatImage;
    if (!field || !ctx || !img) {
      this.heatSprite.visible = false;
      this.heatPeakC = T_AMBIENT_C;
      this.heatScaleTopC = T_AMBIENT_C + 80;
      return;
    }
    // Each hot part is a held-temperature source at its grid cell. Track the hottest PART (node Tj) for
    // the legend's PEAK read — the diffused field peak sags slightly below the source's held temperature,
    // so the PEAK must come from the parts, not the field, to flip its over-temp ⚠ in step with the
    // per-part OVERHEAT box.
    const sources: FieldSource[] = [];
    let maxTj = T_AMBIENT_C;
    for (const node of this.nodes.values()) {
      const tj = node.bodyTemp;
      if (tj > maxTj) maxTj = tj;
      if (tj <= T_AMBIENT_C + 0.5) continue;
      const { x, y } = node.center;
      sources.push({
        col: Math.floor(((x - minX) / w) * cols),
        row: Math.floor(((y - minY) / h) * rows),
        tempC: tj,
      });
    }
    // The copper mask (traces + part pads) makes heat conduct along the wiring, not across bare board.
    const copper = this.buildCopperGrid(cols, rows, minX, minY, w, h);
    field.step(sources, dtSec, copper);
    const peakC = Math.max(field.peak(), T_AMBIENT_C + 80);
    // Publish the legend readout: PEAK = the hottest PART (so its ⚠ flips with the OVERHEAT box), scale
    // top = the value the colourmap is painted with (so the gradient tick labels line up with the colours).
    this.heatPeakC = maxTj;
    this.heatScaleTopC = peakC;
    field.writeImage(img.data, peakC);
    ctx.putImageData(img, 0, 0);
    this.heatTexture!.source.update();
    // Stretch the cols×rows texture over the world-space content bbox (it pans/zooms with the board).
    this.heatSprite.position.set(minX, minY);
    this.heatSprite.width = w;
    this.heatSprite.height = h;
    this.heatSprite.visible = true;
  }

  /** Rasterise the COPPER (traces + part pads) into a `cols×rows` mask (1 = copper, 0 = bare board) over
   *  the same world bbox as the heat field, so the field conducts heat along the wiring. Part footprints
   *  are pads; each wire's routed polyline is drawn as a slightly-dilated line (the trace). */
  private buildCopperGrid(
    cols: number,
    rows: number,
    minX: number,
    minY: number,
    w: number,
    h: number,
  ): Float32Array {
    const cu = new Float32Array(cols * rows);
    const toCol = (x: number) =>
      Math.min(cols - 1, Math.max(0, Math.floor(((x - minX) / w) * cols)));
    const toRow = (y: number) =>
      Math.min(rows - 1, Math.max(0, Math.floor(((y - minY) / h) * rows)));
    const mark = (c: number, r: number) => {
      if (c >= 0 && c < cols && r >= 0 && r < rows) cu[r * cols + c] = 1;
    };
    // Part footprints = copper pads/leads.
    for (const node of this.nodes.values()) {
      const b = node.worldBox;
      const c0 = toCol(b.x);
      const c1 = toCol(b.x + b.w);
      const r0 = toRow(b.y);
      const r1 = toRow(b.y + b.h);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) mark(c, r);
    }
    // Wire routes = traces: rasterise each segment of each wire's routed polyline, dilated by one cell so
    // a thin diagonal/orthogonal run stays a continuous copper path.
    for (const wire of this.graph.wires.values()) {
      const route = this.routeForWire(wire);
      for (let k = 0; k + 1 < route.length; k++) {
        const ca = toCol(route[k]!.x);
        const ra = toRow(route[k]!.y);
        const cb = toCol(route[k + 1]!.x);
        const rb = toRow(route[k + 1]!.y);
        const steps = Math.max(Math.abs(cb - ca), Math.abs(rb - ra), 1);
        for (let s = 0; s <= steps; s++) {
          const c = Math.round(ca + ((cb - ca) * s) / steps);
          const r = Math.round(ra + ((rb - ra) * s) / steps);
          mark(c, r);
          mark(c - 1, r);
          mark(c + 1, r);
          mark(c, r - 1);
          mark(c, r + 1);
        }
      }
    }
    return cu;
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
    for (const t of this.regionLabels) t.resolution = rounded;
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
    return cellToWorld(cell);
  }

  /** Bounding box of a placed component, in world coordinates. */
  private componentBox(c: Component): Rectangle {
    const kind = this.graph.kindOf(c);
    const o = this.cellToWorld(c.cell);
    let rect: Rectangle;
    // Single-pin parts (e.g. GND) draw their symbol around/below the lone pin and
    // are otherwise a tiny, fiddly target — give them a generous square grab box.
    if ((kind?.pins.length ?? 0) <= 1) {
      rect = new Rectangle(o.x - 18, o.y - 18, 36, 48);
    } else {
      let minx = 0;
      let miny = 0;
      let maxx = 0;
      let maxy = 0;
      // The grab/selection box spans the part's FOOTPRINT. For a USER IC use its kind.w/h box corners (the
      // authored box) — a free-form subassembly's pins needn't reach the box edges (e.g. a latch with pins
      // only in a middle band), so a pin bbox would be too short and miss the box's top/bottom. For stock
      // parts the pins ARE the footprint extremes, so iterate them. (For a stock-package user IC, kind.w/h
      // equals the pin bbox, so this is a no-op there.)
      const corners: ReadonlyArray<readonly [number, number]> =
        kind && isUserIc(c.kind)
          ? [
              [0, 0],
              [kind.w - 1, 0],
              [0, kind.h - 1],
              [kind.w - 1, kind.h - 1],
            ]
          : (kind?.pins ?? []).map((p) => [p.dx, p.dy] as const);
      for (const [dx, dy] of corners) {
        const r = rotateOffset(dx, dy, c.rot, c.mirror);
        minx = Math.min(minx, r.col);
        miny = Math.min(miny, r.row);
        maxx = Math.max(maxx, r.col);
        maxy = Math.max(maxy, r.row);
      }
      rect = new Rectangle(
        o.x + minx * PITCH - 14,
        o.y + miny * PITCH - 16,
        (maxx - minx) * PITCH + 28,
        (maxy - miny) * PITCH + 32,
      );
    }
    // Hit-target floor (the design brief §7.1/§8.1) for USER-IC subassemblies: their footprint compacts with
    // their integration tier (a ULSI tile is ~0.15×), so floor the grab box to a constant ≥44px ON-SCREEN
    // size (2×BEAD_HIT_PX ÷ zoom), centred, so even a tiny compacted tile stays selectable/movable at any
    // zoom. Pure enlargement (never shrinks a box); scoped to user ICs so stock parts are unchanged.
    if (isUserIc(c.kind)) {
      const minWorld = (BEAD_HIT_PX * 2) / (this.world.scale.x || 1);
      if (rect.width < minWorld || rect.height < minWorld) {
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const w = Math.max(rect.width, minWorld);
        const h = Math.max(rect.height, minWorld);
        rect = new Rectangle(cx - w / 2, cy - h / 2, w, h);
      }
    }
    return rect;
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
      // The die frame being edited is NOT a grabbable body: it is the build boundary, so it must be
      // click-through (no select / move / rotate / delete) — only its PINS are interactive. Without
      // this its full-interior box swallowed every click on empty space or a wire inside the die.
      if (this.dieFrameId !== null && c.id === this.dieFrameId) continue;
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
      if (l.ownerId !== undefined) continue; // cable-owned labels aren't user-pickable
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
          mirror: c.mirror,
          amp: c.amp,
          wiper: c.wiper,
          temp: c.temp,
          family: c.family,
          openDrain: c.openDrain,
          label: c.label,
          tier: c.tier,
          variant: c.variant,
          heatsink: c.heatsink,
          duty: c.duty,
          mode: c.mode,
          loadHz: c.loadHz,
          word: c.word,
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
   * Name a die frame's port pad (the IC-maker die editor): set pin `pinIndex`'s user name on
   * component `id`, which becomes that lead's LABEL on the sealed chip ({@link captureSeal} ->
   * {@link UserIc.pinNames}). Pure presentation — like {@link setComponentLabel} it persists
   * cosmetically (NO netlist rebuild / sim rewind) and is undoable. A blank name clears the slot
   * back to the package pin number. Rebuilds the node so the perimeter pin re-labels, and refreshes
   * the inspector. No-op on a missing component, an out-of-range pin, or an unchanged name.
   */
  setComponentPinName(id: number, pinIndex: number, name: string): void {
    const c = this.graph.components.get(id);
    if (!c) return;
    const k = this.graph.kindOf(c);
    if (!k || pinIndex < 0 || pinIndex >= k.pins.length) return;
    const next = name.trim();
    const cur = c.pinNames?.[pinIndex] ?? "";
    if (cur === next) return;
    this.pushUndo(this.graph.serialize());
    // Materialize a full-length names array (sparse slots as ""), set the slot, then drop the array
    // entirely if nothing is named (keeps the common case off the snapshot).
    const names = (c.pinNames ?? []).slice();
    while (names.length < k.pins.length) names.push("");
    names[pinIndex] = next;
    c.pinNames = names.some((n) => n && n.trim()) ? names : undefined;
    // Rebuild this node so its pin labels reflect the new name (NodeView reads pinNames at build).
    const node = this.nodes.get(id);
    if (node) {
      node.destroy();
      this.nodes.delete(id);
      this.addNode(c);
    }
    this.redrawWires();
    this.redrawSelection();
    this.cb.onPersist?.(this.graph);
    this.emitSelect();
  }

  /**
   * Set a die frame's port-pad TEST STIMULUS (the IC-maker die editor): pin `pinIndex` on component
   * `id` gets a {@link PinTest} (`gnd` / `vcc` / `in`) or `null` to clear it. Unlike a pin NAME (pure
   * presentation), a stimulus changes the SOLVE — {@link dieTestGraph} injects it as a virtual source
   * so a power-fed die powers up + passes the Seal gate. So after updating `c.pinTests` (materialize a
   * full-length array of nulls, set the slot, drop to undefined if all null) this rebuilds the node
   * (so the pad re-renders) AND fires {@link BoardCallbacks.onChange} (NOT just onPersist) so App's
   * `rebuildNetlist` recompiles the injected die and the live readout updates. Undoable. No-op on a
   * missing component or an out-of-range pin. (Authoring-only — never sealed; see {@link dieTestGraph}.)
   */
  setComponentPinTest(
    id: number,
    pinIndex: number,
    test: PinTest | null,
  ): void {
    const c = this.graph.components.get(id);
    if (!c) return;
    const k = this.graph.kindOf(c);
    if (!k || pinIndex < 0 || pinIndex >= k.pins.length) return;
    this.pushUndo(this.graph.serialize());
    // Materialize a full-length tests array (sparse slots as null), set the slot, then drop the
    // array entirely if nothing is set (keeps the common case off the snapshot).
    const tests: (PinTest | null)[] = (c.pinTests ?? []).slice();
    while (tests.length < k.pins.length) tests.push(null);
    tests[pinIndex] = test;
    c.pinTests = tests.some((t) => t) ? tests : undefined;
    // Rebuild this node (mirrors setComponentPinName) so the pad reflects the change.
    const node = this.nodes.get(id);
    if (node) {
      node.destroy();
      this.nodes.delete(id);
      this.addNode(c);
    }
    this.redrawWires();
    this.redrawSelection();
    // A stimulus changes the netlist (the injected die solves differently), so rebuild — onChange,
    // not just onPersist.
    this.cb.onChange?.(this.graph);
    this.emitSelect();
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
   * Set a part's quality **tier** (0 budget … 3 lab-grade) from the inspector. The tier
   * maps to a per-device parameter preset in {@link buildNetlist}, so this rebuilds the
   * netlist (the part's ESR/ESL/GBW/etc. change). No-op if unchanged.
   */
  setComponentTier(id: number, tier: number): void {
    const c = this.graph.components.get(id);
    if (!c || (c.tier ?? DEFAULT_TIER) === tier) return;
    this.pushUndo(this.graph.serialize());
    c.tier = tier;
    this.cb.onChange?.(this.graph);
    this.emitSelect(); // refresh the inspector's displayed tier
  }

  /**
   * Set a part's device **variant** (a diode's type, an LED's colour) from the inspector. The
   * variant maps to a per-device parameter preset in {@link buildNetlist} (forward Is/n + a
   * current rating), so this rebuilds the netlist. No-op if unchanged.
   */
  setComponentVariant(id: number, variant: number): void {
    const c = this.graph.components.get(id);
    if (!c || (c.variant ?? 0) === variant) return;
    this.pushUndo(this.graph.serialize());
    c.variant = variant;
    this.cb.onChange?.(this.graph);
    this.emitSelect(); // refresh the inspector's displayed variant
  }

  /**
   * Set a part's **heatsink** level (a thermal management lever) from the inspector. Purely thermal —
   * `θ_JA` is web-side and never enters the netlist — so this does NOT rebuild/`onChange` (no Tj reset):
   * the live `ComponentNode` reads `component.heatsink` each frame, so the part just re-stabilises toward
   * its new, lower steady temperature. Undo-tracked.
   */
  setComponentHeatsink(id: number, level: number): void {
    const c = this.graph.components.get(id);
    if (!c || (c.heatsink ?? 0) === level) return;
    this.pushUndo(this.graph.serialize());
    c.heatsink = level;
    this.emitSelect(); // refresh the inspector's displayed heatsink
  }

  /**
   * Set a pulse generator's **duty cycle** (0..1) from the inspector. Written into the AC-source
   * element's waveform param in {@link buildNetlist}, so this rebuilds the netlist. No-op if
   * unchanged (within a small epsilon, since it comes from a slider).
   */
  setComponentDuty(id: number, duty: number): void {
    const c = this.graph.components.get(id);
    const next = Math.max(0.01, Math.min(0.99, duty));
    if (!c || Math.abs((c.duty ?? 0.5) - next) < 1e-4) return;
    this.pushUndo(this.graph.serialize());
    c.duty = next;
    this.cb.onChange?.(this.graph);
    this.emitSelect(); // refresh the inspector's displayed duty
  }

  /**
   * Set an electronic load's **mode** (0 = constant-current CC, 1 = constant-resistance CR) from
   * the inspector. The mode decides which element {@link buildNetlist} emits (a current sink vs a
   * resistor) and what `value`'s unit means (A vs Ω), so this rebuilds the netlist. No-op if
   * unchanged.
   */
  setComponentMode(id: number, mode: number): void {
    const c = this.graph.components.get(id);
    if (!c || (c.mode ?? 0) === mode) return;
    this.pushUndo(this.graph.serialize());
    c.mode = mode;
    this.cb.onChange?.(this.graph);
    this.emitSelect(); // refresh the inspector's displayed mode
  }

  /**
   * Set an electronic load's **dynamic step frequency** in Hz (0 = static, > 0 steps the CC draw
   * between its base `value` and peak `amp`) from the inspector. Written into the current source's
   * waveform param in {@link buildNetlist}, so this rebuilds the netlist. No-op if unchanged.
   */
  setComponentLoadHz(id: number, hz: number): void {
    const c = this.graph.components.get(id);
    if (!c || (c.loadHz ?? 0) === hz) return;
    this.pushUndo(this.graph.serialize());
    c.loadHz = hz;
    this.cb.onChange?.(this.graph);
    this.emitSelect(); // refresh the inspector's displayed step frequency
  }

  /**
   * Set a behavioral block's **data word** (the LUT's 16-bit truth table, or a SPI/UART data
   * word) from the inspector. Written into the behavioral element's `aux` by {@link buildNetlist}
   * (folded into the netlist signature, so the sim reinstalls), so this rebuilds the netlist.
   * No-op if unchanged.
   */
  setComponentWord(id: number, word: number): void {
    const c = this.graph.components.get(id);
    const next = Math.round(word);
    if (!c || c.word === next) return;
    this.pushUndo(this.graph.serialize());
    c.word = next;
    this.cb.onChange?.(this.graph);
    this.emitSelect(); // refresh the inspector's displayed word
  }

  /** Re-emit the current graph through `onChange` without any edit — used when the
   * Ideal/Real fidelity mode flips, which recompiles the netlist (resistor tolerances
   * appear/vanish, etc.) even though the board itself is unchanged. */
  emitChange(): void {
    this.cb.onChange?.(this.graph);
  }

  /**
   * Seal an IC-maker frame and its wired circuit into one placeable sealed IC (ADR 0006 /
   * docs/ui/ic-maker-guide.md). {@link captureSeal} BFSs the connected sub-graph (the frame +
   * its internals), snapshots it, and registers the new kind `tag`; this method then COLLAPSES
   * the live board: it drops the captured components / wires / junctions, places a fresh instance
   * of `tag` where the frame sat, and re-points any EXTERNAL wire (one end on a frame pin, the
   * other outside the capture) onto the instance's matching pin (same package-pin index) — so the
   * outside circuit stays connected straight through. Because the seal has no element of its own
   * and `flattenUserIcs` re-inlines the authored parts at build time, the netlist is byte-identical
   * to the inline circuit (seal-as-same-netlist; the golden is untouched).
   *
   * One undo step (the whole collapse). The new instance is left selected so the inspector follows
   * it. No-op (returns null) on any id that isn't a live frame. `name` is the free-form part name;
   * omit it for the next auto `CEC9xxx`. Returns the registered tag.
   */
  sealFrame(
    frameId: number,
    name?: string,
    intoFamily?: string,
  ): string | null {
    const frame = this.graph.components.get(frameId);
    if (!frame || !isFrame(frame.kind)) return null;

    const before = this.graph.serialize();

    // Capture the connected sub-graph + register the kind FIRST (read-only; the graph is untouched
    // so the external-wire scan below still sees the original wiring). `intoFamily` (when set) appends
    // the captured die as a new VARIANT of an existing family instead of a fresh tag (cap.tag is then
    // the family tag); a package mismatch / unknown family makes captureSeal refuse (null).
    const cap = captureSeal(this.graph, frameId, name, intoFamily);
    if (!cap) return null;
    const captured = new Set(cap.capturedComponentIds);
    const capturedJ = new Set(cap.capturedJunctionIds);

    // External wires: a wire touching a FRAME pin whose OTHER end is outside the capture (an
    // endpoint on a component/junction not folded in). Record (frame pin index -> outside endpoint)
    // so we can re-home them onto the placed instance after the collapse. (v1 ICs are authored
    // standalone, so usually none — but a frame wired out to the rest of the board is handled.)
    const inside = (e: Endpoint): boolean =>
      isPinRef(e) ? captured.has(e.componentId) : capturedJ.has(e.junctionId);
    const externals: { pinIndex: number; outside: Endpoint }[] = [];
    for (const w of this.graph.wires.values()) {
      const ends: [Endpoint, Endpoint][] = [
        [w.from, w.to],
        [w.to, w.from],
      ];
      for (const [end, other] of ends) {
        if (isPinRef(end) && end.componentId === frameId && !inside(other)) {
          externals.push({ pinIndex: end.pinIndex, outside: { ...other } });
        }
      }
    }

    // Collapse: drop the folded-in wires, junctions, and components. removeComponent also sweeps a
    // component's incident wires (including the external ones), so the external endpoints are left
    // bare — we re-wire them to the instance below.
    for (const id of cap.capturedWireIds) this.graph.removeWire(id);
    for (const id of cap.capturedComponentIds) this.graph.removeComponent(id);
    for (const id of cap.capturedJunctionIds) this.graph.removeJunction(id);

    // Place the sealed instance where the frame sat. Its pins come from the same package layout as
    // the frame, so pin index i on the instance is the same package lead as frame pin index i.
    const inst = this.graph.place(cap.tag, {
      col: cap.frameCell.col,
      row: cap.frameCell.row,
    });
    if (inst) {
      for (const ex of externals) {
        // Skip a stale outside endpoint (its node may have been pruned with the capture).
        if (
          isPinRef(ex.outside)
            ? this.graph.components.has(ex.outside.componentId)
            : this.graph.junctions.has(ex.outside.junctionId)
        ) {
          this.graph.connect(
            { componentId: inst.id, pinIndex: ex.pinIndex },
            ex.outside,
          );
        }
      }
    }

    // Rebuild the visual nodes (the captured glyphs are gone, the instance is new), refresh wires,
    // and push the single undo, then recompile + select the new chip.
    this.pushUndo(before);
    this.rebuildNodes();
    this.redrawWires();
    // Reselect just the new instance so the inspector follows the chip the seal produced.
    this.selected.clear();
    this.selectedWires.clear();
    this.selectedJunctions.clear();
    this.selectedLabels.clear();
    this.lastWireClick = null;
    if (inst) this.selected.add(inst.id);
    this.redrawSelection();
    this.cb.onChange?.(this.graph);
    this.emitSelect();
    this.emitAnchor();
    return cap.tag;
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
   * Commit the open net-label editor with `name` (from the HUD input) and an optional
   * pinned net `color` (a PIXI hex int; `undefined` ⇒ "Auto", the voltage colour). For
   * a new label (pending id null) it adds one at the pending endpoint carrying the
   * colour; for an existing one it renames it (an empty name removes it — see
   * {@link BoardGraph}) and updates its colour. No-op if nothing meaningful changed
   * (name AND colour unchanged, or an empty name on a not-yet-created label), so a
   * stray blur doesn't push an empty undo. Closes the editor either way.
   */
  commitLabel(name: string, color?: number): void {
    const pending = this.pendingLabel;
    this.endLabelEdit();
    if (!pending) return;
    const trimmed = name.trim();
    if (pending.id === null) {
      if (!trimmed) return; // nothing to add (empty name on a not-yet-created label)
      this.pushUndo(this.graph.serialize());
      const l = this.graph.addNetLabel(pending.at, trimmed, pending.pos, color);
      this.redrawWires();
      if (l) this.selectLabel(l.id, false);
      this.cb.onChange?.(this.graph);
    } else {
      const existing = this.graph.netLabels.get(pending.id);
      // Unchanged ⇒ skip the undo entry: both the name and the pinned colour match.
      if (existing && existing.name === trimmed && existing.color === color) {
        return;
      }
      this.pushUndo(this.graph.serialize());
      this.graph.renameNetLabel(pending.id, trimmed);
      // renameNetLabel removes the label when the name is empty; only recolour a
      // label that still exists (a non-empty name).
      if (this.graph.netLabels.has(pending.id)) {
        this.graph.setNetLabelColor(pending.id, color);
      }
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
      initialColor: existing?.color ?? null,
      rect,
    });
  }

  /**
   * Open the inline name editor for a die frame's port pad (the IC-maker pin-naming affordance).
   * Computes the pad's on-screen rect (like {@link beginLabelEdit}) so the HUD positions a small
   * input seeded with the pin's current name; the package pin number is sent as the placeholder.
   * On commit the HUD calls {@link commitPinName}. No-op on a non-frame component / out-of-range pin.
   */
  private beginPinNameEdit(componentId: number, pinIndex: number): void {
    const c = this.graph.components.get(componentId);
    if (!c) return;
    const k = this.graph.kindOf(c);
    const p = k?.pins[pinIndex];
    if (!k || !p) return;
    const cell = this.graph.pinCell(c, p);
    const o = this.cellToWorld(cell);
    const s = this.world.scale.x;
    const rect: AnchorRect = {
      x: this.world.position.x + (o.x + 12) * s,
      y: this.world.position.y + (o.y - 18) * s,
      width: 90 * s,
      height: 20 * s,
    };
    // The die-frame kind's default pin label IS the package number; the override (if any) lives on
    // the component. Seed the input with the current name; show the number as the placeholder.
    const number = Number(p.label);
    this.cb.onPinNameEdit?.({
      componentId,
      pinIndex,
      number: Number.isFinite(number) ? number : pinIndex + 1,
      initial: c.pinNames?.[pinIndex] ?? "",
      test: c.pinTests?.[pinIndex] ?? null,
      rect,
    });
  }

  /** Commit (or clear) a die-pin name from the inline editor, then close it. Routes through
   * {@link setComponentPinName} (undoable, cosmetic-persist, re-labels the pad). A blank name clears
   * it back to the package number. Always closes the editor (a null onPinNameEdit payload). */
  commitPinName(componentId: number, pinIndex: number, name: string): void {
    this.cb.onPinNameEdit?.(null);
    this.setComponentPinName(componentId, pinIndex, name);
  }

  /** Close the die-pin name editor without changing anything (Escape / outside click). */
  cancelPinNameEdit(): void {
    this.cb.onPinNameEdit?.(null);
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
    this.drawBloom(g);
  }

  /** The open FREE-FORM die's wall rectangle in WORLD coordinates (the box the player sees + grabs), or null
   * outside a free-form die. The resize grab-rails + the pin beads hang off this. */
  private dieWallRect(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null {
    if (this.dieFrameId === null) return null;
    const frame = this.graph.components.get(this.dieFrameId);
    if (!frame || !isFreeFormFrame(frame.kind)) return null;
    const b = dieBounds(this.graph.serialize(), this.dieFrameId);
    if (!b) return null;
    return {
      left: b.minCol * PITCH,
      top: b.minRow * PITCH,
      right: b.maxCol * PITCH,
      bottom: b.maxRow * PITCH,
    };
  }

  /** Draw the Chip Bench BUILDER overlay inside a free-form drill (the design brief §1/§11A): ALL FOUR
   * walls become a "grab-rail" with a solid handle on every corner (resize both axes) and wall midpoint
   * (resize that axis) — so the box reads as draggable from ANY side/corner — and every frame pin wears a
   * fat ≥44px BEAD as the SHAPE/WIRE grab target (brighter in SHAPE, where a bead-drag moves the pin).
   * Co-located with the box the player sees — nothing shadowing the pins. No-op outside a free-form die. */
  private drawBloom(g: Graphics): void {
    const r = this.dieWallRect();
    if (r === null || this.dieFrameId === null) return;
    const frame = this.graph.components.get(this.dieFrameId);
    const kind = frame ? this.graph.kindOf(frame) : undefined;
    if (!frame || !kind) return;
    const s = this.world.scale.x || 1;
    // Grab-rails: ALL FOUR walls drawn as an accent rail = "grab any wall to resize" (was right+bottom only).
    g.moveTo(r.left, r.top).lineTo(r.right, r.top);
    g.moveTo(r.left, r.bottom).lineTo(r.right, r.bottom);
    g.moveTo(r.left, r.top).lineTo(r.left, r.bottom);
    g.moveTo(r.right, r.top).lineTo(r.right, r.bottom);
    g.stroke({ width: 2.5 / s, color: PALETTE.accent, alpha: 0.45 });
    // Solid HANDLES so the box reads as draggable at a glance: a bright filled square on each corner
    // (resize both axes) and a smaller one at each wall midpoint (resize that axis) — pull from any side.
    const midX = (r.left + r.right) / 2;
    const midY = (r.top + r.bottom) / 2;
    const corner = 7 / s;
    for (const [hx, hy] of [
      [r.left, r.top],
      [r.right, r.top],
      [r.left, r.bottom],
      [r.right, r.bottom],
    ])
      g.rect(hx - corner, hy - corner, corner * 2, corner * 2);
    g.fill({ color: PALETTE.accent, alpha: 0.95 });
    const edge = 5 / s;
    for (const [hx, hy] of [
      [midX, r.top],
      [midX, r.bottom],
      [r.left, midY],
      [r.right, midY],
    ])
      g.rect(hx - edge, hy - edge, edge * 2, edge * 2);
    g.fill({ color: PALETTE.accent, alpha: 0.7 });
    // Fat draggable bead on each frame pin (the ≥44px SHAPE/WIRE target). Brighter in SHAPE (drag = move).
    const beadR = BEAD_HIT_PX / s;
    const beadAlpha = this.shapeMode ? 0.5 : 0.22;
    for (const p of kind.pins) {
      const w = this.cellToWorld(this.graph.pinCell(frame, p));
      g.circle(w.x, w.y, beadR);
      g.stroke({ width: 2 / s, color: PALETTE.accent, alpha: beadAlpha });
    }
  }

  /** The frame-pin index (if any) whose fat BEAD world-point `wp` grabs — nearest frame pin within the
   * ≥44px bead radius. Tested BEFORE the resize rails so a bead is always grabbable (a pin sitting on a wall
   * isn't swallowed by edge-resize). Null outside a free-form die or off every bead. */
  private pinBeadHit(wp: Point): number | null {
    if (this.dieFrameId === null) return null;
    const frame = this.graph.components.get(this.dieFrameId);
    const kind = frame ? this.graph.kindOf(frame) : undefined;
    if (!frame || !kind || !isFreeFormFrame(frame.kind)) return null;
    const tol = BEAD_HIT_PX / (this.world.scale.x || 1);
    let best = -1;
    let bestD = tol * tol;
    for (const p of kind.pins) {
      const w = this.cellToWorld(this.graph.pinCell(frame, p));
      const d2 = (wp.x - w.x) ** 2 + (wp.y - w.y) ** 2;
      if (d2 <= bestD) {
        bestD = d2;
        best = p.index;
      }
    }
    return best >= 0 ? best : null;
  }

  /** Which resize axis (if any) world-point `wp` grabs on the open free-form die's grab-rails: any of the 8
   * walls/corners ('n'/'s'/'e'/'w' + 'ne'/'nw'/'se'/'sw'), or null. Tolerance is a constant SCREEN distance
   * off the wall, so the rail stays catchable at any zoom. Caller tests {@link pinBeadHit} first, so a bead
   * on a wall wins. Null outside a free-form die or off the rails. */
  private wallResizeHit(wp: Point): BoxAxis | null {
    const r = this.dieWallRect();
    if (r === null) return null;
    const tol = RESIZE_GRIP_PX / (this.world.scale.x || 1);
    const inY = wp.y >= r.top - tol && wp.y <= r.bottom + tol;
    const inX = wp.x >= r.left - tol && wp.x <= r.right + tol;
    const nearLeft = Math.abs(wp.x - r.left) <= tol && inY;
    const nearRight = Math.abs(wp.x - r.right) <= tol && inY;
    const nearTop = Math.abs(wp.y - r.top) <= tol && inX;
    const nearBottom = Math.abs(wp.y - r.bottom) <= tol && inX;
    const vert = nearTop ? "n" : nearBottom ? "s" : "";
    const horiz = nearLeft ? "w" : nearRight ? "e" : "";
    const axis = `${vert}${horiz}`;
    return axis === "" ? null : (axis as BoxAxis);
  }

  /** Live step of an in-die resize drag: the grabbed wall/corner edge(s) track the snapped cursor cell
   * while the OPPOSITE edge anchors — so an E/S drag grows from the top-left, a W/N drag moves the origin,
   * and a corner moves two edges. Clamped to [MIN, MAX] against the anchored edge. Commits the single drag
   * undo on the first cell that actually resizes; `setDieFrameBoxAbs(false)` re-pins + redraws each step. */
  private moveBoxHandleDrag(wp: Point): void {
    const d = this.boxHandleDrag;
    if (d === null || this.dieFrameId === null) return;
    const frame = this.graph.components.get(this.dieFrameId);
    const geom = frame ? freeFormGeom(frame.kind) : undefined;
    if (!frame || !geom) return;
    const MIN = 2;
    const MAX = FREE_FORM_MAX_BOX;
    // The four current edges (absolute cells). The grabbed edge(s) track the snapped cursor cell; the
    // OPPOSITE edge anchors. Clamp the dragged edge so width/height stay within [MIN, MAX] without moving
    // the anchor (so dragging the left wall right past the min just stops, it doesn't shove the right wall).
    let left = frame.cell.col;
    let top = frame.cell.row;
    let right = left + geom.w - 1;
    let bottom = top + geom.h - 1;
    const cx = snap(wp.x, PITCH);
    const cy = snap(wp.y, PITCH);
    if (d.axis.includes("e"))
      right = Math.max(left + MIN - 1, Math.min(left + MAX - 1, cx));
    if (d.axis.includes("w"))
      left = Math.min(right - MIN + 1, Math.max(right - MAX + 1, cx));
    if (d.axis.includes("s"))
      bottom = Math.max(top + MIN - 1, Math.min(top + MAX - 1, cy));
    if (d.axis.includes("n"))
      top = Math.min(bottom - MIN + 1, Math.max(bottom - MAX + 1, cy));
    if (
      this.setDieFrameBoxAbs(
        left,
        top,
        right - left + 1,
        bottom - top + 1,
        false,
      )
    ) {
      if (!d.moved && this.pendingUndo) {
        this.commitUndo(this.pendingUndo);
        d.moved = true;
      }
    }
  }

  /** Chip Bench builder mode (§2): SHAPE (true) = a free-form pin-bead drag moves the pin; WIRE (false) = it
   * starts a wire. The die-bar toggle calls this; entering a die resets to SHAPE (geometry-first). */
  setShapeMode(on: boolean): void {
    this.shapeMode = on;
    this.redrawSelection(); // beads re-tint for the active mode
  }

  /** The current builder mode bit (for the die-bar toggle's pressed state). */
  isShapeMode(): boolean {
    return this.shapeMode;
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

  /**
   * A net's **signed effective** voltage for the rail-identity COLOUR: the RMS magnitude —
   * steady on AC, where the instantaneous value strobes 0↔peak — carried with the DC mean's
   * sign. So a −5 V rail stays cyan (not red), a +12 V rail with ripple stays yellow, and a
   * symmetric AC net (mean ≈ 0) colours by its RMS identity (mains reads as its ~230 V, not
   * its ±325 V peak). Falls back to the instantaneous value when no sub-frame batch ran this
   * frame (paused/scrubbing), where RMS == the frozen value anyway.
   */
  private nodeColorVoltage(node: number): number {
    const inst = this.nodeVoltage(node) ?? 0;
    if (
      !this.nodeVrms ||
      !this.nodeVmean ||
      node < 0 ||
      node >= this.nodeVrms.length
    ) {
      return inst;
    }
    const rms = this.nodeVrms[node]!;
    return (this.nodeVmean[node] ?? 0) >= 0 ? rms : -rms;
  }

  /**
   * The display colour of a net node: its pinned override (a labelled net's `color`)
   * when set, else its rail-identity voltage colour ({@link nodeColorVoltage} →
   * {@link voltageColor}). The single colour choke-point — every wire/gauge/junction/
   * label colour routes through here (or {@link endpointColor}) so the override is
   * honoured in exactly one place. Magnitude/voltage logic at the call sites is
   * unaffected; only the hue is overridden.
   */
  private nodeColor(node: number): number {
    const ov = this.nodeColorOverrides.get(node);
    return ov ?? voltageColor(this.nodeColorVoltage(node));
  }

  /**
   * The display colour of the net an endpoint sits on — {@link nodeColor} of its
   * resolved node, or {@link PALETTE.cyan} for an unconnected endpoint (matching the
   * renderer's prior null-net default at every colour site). The colour twin of
   * {@link pinVoltage}.
   */
  private endpointColor(ep: Endpoint): number {
    const node = this.endpointNode(ep);
    return node === null ? PALETTE.cyan : this.nodeColor(node);
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

  /** The electrical NET (node) to bring forward, KiCad-style — its traces get a halo (`redrawWires`), its
   * pins get focus rings ({@link drawNetFocus}), and off-net parts dim (the node loop in {@link update}).
   * It's the net of the in-progress wire's source pin while ROUTING; nothing otherwise. By real
   * connectivity (the node), NOT by name: two separate "GND" nets that aren't actually joined stay
   * distinct. Null when nothing is brought forward. */
  private highlightNet(): number | null {
    // KiCad-style: ONLY the net you are actively WIRING is brought forward (its traces halo, its pins
    // ring, off-net parts dim). An idle hover-over no longer highlights the whole net — that read as noisy
    // "walk-over" flicker; KiCad ties the cross-probe highlight to an action (here, drawing the wire), not
    // passive cursor motion. The hovered PART still reveals its pin labels (`hoverComponentId`), a separate,
    // calmer affordance.
    return this.wiring ? this.endpointNode(this.wiring.from) : null;
  }

  /** Is any pin of component `id` on net `node`? (Element pins resolve directly through `probeNodes`.) Used
   * to decide whether a part stays bright or dims under the net highlight, and which pins get focus rings. */
  private componentOnNet(id: number, node: number): boolean {
    const c = this.graph.components.get(id);
    if (!c) return false;
    const kind = this.graph.kindOf(c);
    if (!kind) return false;
    for (const p of kind.pins) {
      if (this.pinNode({ componentId: id, pinIndex: p.index }) === node)
        return true;
    }
    return false;
  }

  /** Lay the net-focus PIN RINGS: an amber ring on every element pin sitting on the brought-forward net,
   * so the whole net's pins read at a glance (KiCad "bring the net forward"). Cleared + redrawn each frame
   * from {@link highlightNet}; a no-op (just a clear) when nothing is highlighted. */
  private drawNetFocus(node: number | null): void {
    const g = this.netFocusLayer;
    g.clear();
    if (node === null) return;
    for (const c of this.graph.components.values()) {
      if (c.id === this.dieFrameId) continue; // the die wall isn't a part — skip its frame pins
      const kind = this.graph.kindOf(c);
      if (!kind) continue;
      for (const p of kind.pins) {
        if (this.pinNode({ componentId: c.id, pinIndex: p.index }) !== node)
          continue;
        const pos = this.cellToWorld(this.graph.pinCell(c, p));
        // A dark backing ring + bright amber ring on top, so the marker reads against ANY net colour (the
        // net's traces are already amber-rail-coloured, where a plain amber ring would vanish) and the dark
        // board alike.
        g.circle(pos.x, pos.y, PIN_R + 3.5);
        g.stroke({ width: 4, color: 0x0a0814, alpha: 0.7 });
        g.circle(pos.x, pos.y, PIN_R + 3.5);
        g.stroke({ width: 2, color: PALETTE.warn, alpha: 0.95 });
      }
    }
  }

  /**
   * Live SYMBOL-STATE for a placed cell: the bit(s) a recognised SEQUENTIAL cell (flip-flop / latch /
   * register) is currently storing, read off the sim at its OUTPUT pins. Resolves the selected variant's
   * def, confirms it wears a stateful symbol, then samples each `out`-role pin's voltage against the
   * cell's own VCC/2 threshold (default 1.5 V when unpowered/unknown) and folds them into the stored word
   * ({@link storedOutputs} drops the Q̄ bar + orders MSB-first). Undefined for any non-sequential or
   * un-recognised part, so the body shows nothing. Render-only — pure read of the displayed node voltages.
   */
  private cellLiveState(id: number): StoredState | undefined {
    const comp = this.graph.components.get(id);
    if (!comp || !isUserIc(comp.kind)) return undefined;
    const def = resolveUserIc(comp.kind, comp.variant ?? 0);
    // Any RECOGNISED cell (it wears a symbol) shows its live output: a register's stored Q, a gate's Y,
    // an adder's sum/carry — read from the `out` pins below.
    if (!def || !cellSymbol(def)) return undefined;
    const roles = def.pinRoles ?? [];
    const vccIdx = roles.indexOf("vcc");
    const vcc =
      vccIdx >= 0
        ? (this.pinVoltage({ componentId: id, pinIndex: vccIdx }) ?? 0)
        : 0;
    const thresh = vcc > 0.5 ? vcc * 0.5 : 1.5;
    const outs: OutputLevel[] = [];
    roles.forEach((r, i) => {
      if (r !== "out") return;
      const v = this.pinVoltage({ componentId: id, pinIndex: i });
      if (v === null) return;
      outs.push({
        name: def.pinNames?.[i]?.trim() || `O${i}`,
        level: v > thresh ? 1 : 0,
      });
    });
    const s = storedOutputs(outs);
    return s.bits.length > 0 ? s : undefined;
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

    // Chip Bench builder (the design brief §2/§11A), FREE-FORM die only: in SHAPE mode a press on a fat pin
    // BEAD MOVES that pin along the rim (the geometry-first default, replacing the cut Alt-drag); a
    // double-tap on a bead opens its name pad. A press on the resize GRAB-RAIL (right/bottom wall, SE
    // corner) stretches the box — in either mode, since it's geometry. Tested FIRST (before the pending-wire
    // + generic pin/body branches) so the fat ≥44px targets win and a bead/rail is never shadowed; gated to
    // `!this.wiring` so a wire mid-route still completes normally. WIRE-mode frame pins fall through to the
    // ordinary wiring flow. `pinBeadHit`/`wallResizeHit` are null outside a free-form die, so nothing else
    // is affected.
    if (
      e.button === 0 &&
      !this.wiring &&
      (this.mode === "wire" || this.mode === "select")
    ) {
      if (this.shapeMode) {
        const bead = this.pinBeadHit(wp);
        if (bead !== null && this.dieFrameId !== null) {
          const now = performance.now();
          const dbl =
            this.lastPinTap !== null &&
            this.lastPinTap.id === this.dieFrameId &&
            this.lastPinTap.pin === bead &&
            now - this.lastPinTap.t < DOUBLE_CLICK_MS;
          if (dbl) {
            this.lastPinTap = null;
            this.beginPinNameEdit(this.dieFrameId, bead);
            return;
          }
          this.lastPinTap = { id: this.dieFrameId, pin: bead, t: now };
          this.pinDrag = { pinIndex: bead, moved: false };
          this.pendingUndo = this.snapshotEntry();
          return;
        }
      }
      // The resize grab-rail yields to a pin BEAD that shares the wall: in SHAPE the bead branch above
      // already grabbed it; in WIRE the bead branch is skipped, so suppressing resize here lets the press
      // fall through to the normal wiring flow — otherwise a frame pin on the right/bottom wall could never
      // be wired (the rail stole it). Resize only fires on a bare wall gap / corner.
      const axis = this.wallResizeHit(wp);
      if (axis && this.pinBeadHit(wp) === null) {
        this.boxHandleDrag = { axis, moved: false };
        this.pendingUndo = this.snapshotEntry();
        return;
      }
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
          this.pendingUndo = this.snapshotEntry();
          return;
        }
      }
      // Inside a die: a second press back on the SAME die-frame pin the wire started from is the
      // name-pad gesture (not a no-op continue onto itself) — cancel the pending wire and open the
      // port-pad name editor. Mirrors the junction double-click-to-drag above. (The first click left
      // the wire pending; nothing was committed, so cancelling loses nothing.)
      if (this.dieFrameId !== null && isPinRef(this.wiring.from)) {
        const pinHit = this.pinHitTest(wp.x, wp.y);
        if (
          pinHit &&
          pinHit.componentId === this.dieFrameId &&
          this.lastPinTap !== null &&
          this.lastPinTap.id === pinHit.componentId &&
          this.lastPinTap.pin === pinHit.pinIndex &&
          performance.now() - this.lastPinTap.t < DOUBLE_CLICK_MS
        ) {
          this.lastPinTap = null;
          this.cancelWiring();
          this.beginPinNameEdit(pinHit.componentId, pinHit.pinIndex);
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

    // Pan tool: pure navigation — it interacts with NOTHING. A press anywhere (over a part,
    // a wire, a pin, or empty space) only pans the view; the Build/Wire/Junction/Label/Measure
    // tools are how you touch the circuit. The ONLY way into Pan is to pick it (H or the
    // toolbar) — Escape returns to Build, not Pan. (A mode switch cancels any in-progress wire,
    // so none is ever pending here.)
    if (this.mode === "pan") {
      this.panning = { lastX: e.global.x, lastY: e.global.y };
      return;
    }
    // Region tool: a press anywhere (over a part or empty space) starts a fresh rectangle — the whole
    // tool is "drag a box round the circuit you want to bottle up". A re-draw replaces the prior pending
    // rect, so you size it by dragging again; the box persists on release for the live pin preview.
    if (this.mode === "region") {
      this.regionPrev = this.pendingRegion; // restore it if this press is just a click (no real drag)
      this.regionDrawing = true;
      this.pendingRegion = { x0: wp.x, y0: wp.y, x1: wp.x, y1: wp.y };
      this.drawPendingRegion();
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
          this.pendingUndo = this.snapshotEntry();
        }
        return;
      }
    }

    // (The Chip Bench builder gestures — SHAPE pin-bead move, resize grab-rail — are handled at the TOP of
    // this method, before the pending-wire branch, so they can't be pre-empted by a pending wire.)
    const pin = this.pinHitTest(wp.x, wp.y);
    if (pin && (this.mode === "wire" || this.mode === "select")) {
      // Inside a die: remember this press on the die frame's perimeter pin so a SECOND press on it
      // (which, the wire now pending, lands in the wiring branch above) is recognised as the
      // double-click "name this pad" gesture. The first click still starts a wire as usual.
      if (
        !additive &&
        this.dieFrameId !== null &&
        pin.componentId === this.dieFrameId
      ) {
        this.lastPinTap = {
          id: pin.componentId,
          pin: pin.pinIndex,
          t: performance.now(),
        };
      }
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
      if (this.mode === "select") {
        // Select/Build: a junction is a draggable node. Select it and arm a move so a plain DRAG
        // repositions it (its incident wires follow by reference) and a click just selects it —
        // Delete or right-click then removes it, HEALING the wire it joined (`dissolveJunction`).
        // Branch-wiring out of a junction is the Wire tool's job.
        if (!this.selectedJunctions.has(jid)) this.selectJunction(jid, false);
        this.junctionDrag = { id: jid, moved: false };
        this.pendingUndo = this.snapshotEntry();
        return;
      }
      if (this.mode === "wire") {
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
          this.pendingUndo = this.snapshotEntry();
          return;
        }
        this.lastJunctionTap = { id: jid, t: now };
        this.startWiring({ junctionId: jid }, wp);
        return;
      }
    }

    // Alt-click is "reach the wire behind the part": with Alt held we skip the body hit-test, so a
    // press over a component falls through to the wire/empty handling below and grabs the occluded
    // trace instead of the part on top of it. (Pin/junction above still win — they're the real nodes.)
    const body = e.altKey ? null : this.bodyHitTest(wp.x, wp.y);
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
    if (body) {
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
      // Drop where the ghost previewed: the snapped cursor cell + the in-place rotate/flip
      // compensation, so the part lands centred under the cursor exactly like the ghost.
      this.placeCell(
        this.armed,
        {
          col: snap(wp.x, PITCH) + this.armedCellShift.col,
          row: snap(wp.y, PITCH) + this.armedCellShift.row,
        },
        this.armedRot,
        this.armedMirror,
      );
      return;
    }

    const wireId = this.wireHitTest(wp.x, wp.y);
    if (wireId !== null) {
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
            moveJunctions: begun.moveJunctions,
            moved: false,
          };
          this.pendingUndo = this.snapshotEntry();
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
    this.pendingUndo = this.snapshotEntry();
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
      if (this.dieFrameId !== null && c.id === this.dieFrameId) continue; // never marquee the die frame
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

  // --- region tool (live free-form subassembly) ---------------------------

  /** The normalized pending-region rectangle in WORLD coords, or null when there's no region or it's
   * still too tiny to be a real box (a stray click / the very start of a drag). */
  private regionRectWorld(): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null {
    const r = this.pendingRegion;
    if (!r) return null;
    const minX = Math.min(r.x0, r.x1);
    const minY = Math.min(r.y0, r.y1);
    const maxX = Math.max(r.x0, r.x1);
    const maxY = Math.max(r.y0, r.y1);
    if (maxX - minX < PITCH / 2 && maxY - minY < PITCH / 2) return null;
    return { minX, minY, maxX, maxY };
  }

  /** The pending region's member component ids (footprint centre inside the rect, like the marquee) and
   * its box in board CELLS (the drawn rect snapped to the grid) — the inputs to {@link captureRegion} /
   * {@link previewRegion}. Null when there's no real rectangle yet. */
  private regionIdsAndBox(): { ids: number[]; box: RegionBox } | null {
    const w = this.regionRectWorld();
    if (!w) return null;
    const inside = (px: number, py: number): boolean =>
      px >= w.minX && px <= w.maxX && py >= w.minY && py <= w.maxY;
    const ids: number[] = [];
    for (const c of this.graph.components.values()) {
      if (this.dieFrameId !== null && c.id === this.dieFrameId) continue;
      const box = this.componentBox(c);
      if (inside(box.x + box.width / 2, box.y + box.height / 2)) ids.push(c.id);
    }
    const box: RegionBox = {
      minCol: Math.round(w.minX / PITCH),
      minRow: Math.round(w.minY / PITCH),
      maxCol: Math.round(w.maxX / PITCH),
      maxRow: Math.round(w.maxY / PITCH),
    };
    return { ids, box };
  }

  /** True when the region tool has a rectangle drawn (gates the HUD's "Seal region" affordance). */
  hasPendingRegion(): boolean {
    return this.pendingRegion !== null;
  }

  /** Drop the pending-region rectangle + clear its overlay (Esc, cancel, a seal, or a drill-in). */
  clearPendingRegion(): void {
    this.pendingRegion = null;
    this.regionDrawing = false;
    this.regionLayer.clear();
    for (const t of this.regionLabels) t.visible = false;
    this.emitRegion(null);
  }

  /** Re-derive the persisted region overlay against the CURRENT board, so its boundary pins follow LIVE
   * as you wire / move / delete parts with a region pending (the rectangle outlives the tool switch).
   * Called from the HUD's onChange. A no-op when no region is pending or a drag is in flight (the
   * pointer-move handler already redraws then). */
  refreshRegionOverlay(): void {
    if (this.pendingRegion !== null && !this.regionDrawing)
      this.drawPendingRegion();
  }

  /** Seal the pending region into a free-form subassembly (the drawn rect IS the box, pins where wires
   * cross it). Returns the capture (the HUD adds it to the library) or null if there's no usable region
   * (nothing inside, or no net crosses the box). Clears the rectangle on success. */
  sealPendingRegion(name?: string): RegionCapture | null {
    const ib = this.regionIdsAndBox();
    if (!ib || ib.ids.length === 0) return null;
    const cap = captureRegion(this.graph, ib.ids, name, ib.box) ?? null;
    if (cap) this.clearPendingRegion();
    return cap;
  }

  /** Render the pending region: the box rectangle (cell-snapped, WYSIWYG with what seals) + a dot marker
   * and label at each inferred boundary pin (from {@link previewRegion}, so the preview matches the seal
   * pin-for-pin). Emits {@link BoardCallbacks.onRegion} with the live pin count / refusal so the HUD can
   * show a "Seal region (N pins)" button. Render-only. */
  private drawPendingRegion(): void {
    const g = this.regionLayer;
    g.clear();
    for (const t of this.regionLabels) t.visible = false;
    const ib = this.regionIdsAndBox();
    if (!ib) {
      // A rectangle exists but is still sub-cell (the very start of a drag): draw nothing yet.
      this.emitRegion(
        this.pendingRegion === null
          ? null
          : { pinCount: 0, reason: "drag a box around some parts" },
      );
      return;
    }
    const { ids, box } = ib;
    const pre = previewRegion(this.graph, ids, box);
    // The box to DRAW: the preview's ACTUAL box when it resolved (it may have grown the drag rect to
    // swallow a part that pokes out, and the pins sit on THAT edge), else the raw drag rect so the player
    // still sees the rectangle they're sweeping. Drawing the same box the pins reference keeps them in
    // sync (no markers floating outside the wall).
    const bb = pre.ok
      ? {
          minCol: pre.minCol,
          minRow: pre.minRow,
          maxCol: pre.minCol + pre.w - 1,
          maxRow: pre.minRow + pre.h - 1,
        }
      : box;
    // The box rectangle, snapped to cells (its edges sit on the pin grid the seal will use).
    const x = bb.minCol * PITCH;
    const y = bb.minRow * PITCH;
    const w = (bb.maxCol - bb.minCol) * PITCH;
    const h = (bb.maxRow - bb.minRow) * PITCH;
    g.roundRect(x, y, w, h, 4).fill({ color: REGION_COLOR, alpha: 0.1 });
    g.roundRect(x, y, w, h, 4).stroke({
      width: 2 / this.world.scale.x,
      color: REGION_COLOR,
      alpha: 0.9,
    });

    if (!pre.ok) {
      const reason =
        pre.reason === "empty"
          ? "no parts inside the box"
          : pre.reason === "no-boundary"
            ? "no wires cross the box"
            : "too many crossings (max " + BLOCK_MAX_PINS + ")";
      this.emitRegion({ pinCount: 0, reason });
      return;
    }
    // A dot + label at each boundary pin (where a wire crosses the box edge — the future package lead).
    let li = 0;
    for (const p of pre.pins) {
      const px = p.col * PITCH;
      const py = p.row * PITCH;
      g.circle(px, py, 5).fill({ color: REGION_COLOR, alpha: 1 });
      g.circle(px, py, 5).stroke({
        width: 1.5 / this.world.scale.x,
        color: 0xffffff,
        alpha: 0.95,
      });
      const t = this.regionLabelAt(li++);
      t.text = p.name;
      t.position.set(px + 8, py - 8);
      t.visible = true;
    }
    this.emitRegion({ pinCount: pre.pins.length });
  }

  /** A pooled upright Text for a region pin label, grown on demand (mirrors the ghost pin-text pool). */
  private regionLabelAt(i: number): Text {
    let t = this.regionLabels[i];
    if (!t) {
      t = new Text({
        text: "",
        style: {
          fill: 0xffffff,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 11,
          fontWeight: "600",
        },
      });
      t.resolution = DPR;
      t.eventMode = "none";
      this.regionLabels[i] = t;
      this.regionLayer.addChild(t);
    }
    return t;
  }

  /** Push the region tool's live state to the HUD, deduped so an unchanged drag doesn't churn Svelte. */
  private emitRegion(info: { pinCount: number; reason?: string } | null): void {
    const key = info ? `${info.pinCount}|${info.reason ?? ""}` : "null";
    if (key === this.lastRegionKey) return;
    this.lastRegionKey = key;
    this.cb.onRegion?.(info);
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
        mirror: c.mirror,
        amp: c.amp,
        wiper: c.wiper,
        temp: c.temp,
        family: c.family,
        openDrain: c.openDrain,
        label: c.label,
        tier: c.tier,
        variant: c.variant,
        heatsink: c.heatsink,
        duty: c.duty,
        mode: c.mode,
        loadHz: c.loadHz,
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
      this.armedConfig = {};
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
      // Carry each part's own horizontal flip (no group reflection — paste only rotates
      // the group). Pins keep their index, so the pasted netlist is unchanged.
      if (cc.mirror) nc.mirror = true;
      if (cc.amp !== undefined) nc.amp = cc.amp;
      if (cc.wiper !== undefined) nc.wiper = cc.wiper;
      if (cc.temp !== undefined) nc.temp = cc.temp;
      if (cc.family !== undefined) nc.family = cc.family;
      if (cc.openDrain !== undefined) nc.openDrain = cc.openDrain;
      if (cc.label !== undefined) nc.label = cc.label;
      if (cc.tier !== undefined) nc.tier = cc.tier;
      if (cc.variant !== undefined) nc.variant = cc.variant;
      if (cc.heatsink !== undefined) nc.heatsink = cc.heatsink;
      if (cc.duty !== undefined) nc.duty = cc.duty;
      if (cc.mode !== undefined) nc.mode = cc.mode;
      if (cc.loadHz !== undefined) nc.loadHz = cc.loadHz;
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
      // Flip BEFORE rotate (scale precedes rotation in PixiJS), matching the live holder,
      // so a pasted part's flip previews correctly. The group rotation `p.rot` is added on.
      g.scale.x = cc.mirror ? -1 : 1;
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

    if (this.regionDrawing && this.pendingRegion) {
      this.pendingRegion.x1 = wp.x;
      this.pendingRegion.y1 = wp.y;
      this.drawPendingRegion();
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

    if (this.boxHandleDrag) {
      this.moveBoxHandleDrag(wp);
      return;
    }

    if (this.pinDrag) {
      this.movePinDrag(wp);
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
        // Soft containment in the die editor: keep dragged parts inside the walls (identity on the
        // outer board). The die frame itself is left where it is — dragging it is meaningless.
        this.graph.move(
          id,
          id === this.dieFrameId
            ? { col: o.col, row: o.row }
            : this.containInDie({ col: o.col + dc, row: o.row + dr }),
        );
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
      // Lazy-follow: feed the snapped cursor into the staircase so the pending wire sketches the bends
      // the pointer traces (baked as waypoints on finish — no per-corner junctions).
      const startCell = this.graph.endpointCell(this.wiring.from);
      if (startCell) {
        this.lazyRoute = extendLazyTrail(startCell, this.lazyRoute, {
          col: snap(wp.x, PITCH),
          row: snap(wp.y, PITCH),
        });
      }
      this.drawPendingWire();
    }
    // Free-form box resize-handle hover: show a directional resize cursor (ew/ns/nesw/nwse) so the box
    // reads as draggable from any side or corner. A pin bead wins (it's the SHAPE/WIRE target); off the
    // handles, restore the mode's normal cursor.
    if (this.dieFrameId !== null && !this.wiring) {
      const ax = this.pinBeadHit(wp) === null ? this.wallResizeHit(wp) : null;
      if (ax) this.app.stage.cursor = RESIZE_CURSORS[ax];
      else this.updateCursor();
    }
    // Idle hover: keep the placement / junction / label ghost glued to the cursor
    // (snapped to the cell or the endpoint a click would attach to). Every tool
    // that draws a ghost must refresh here or its preview freezes in place.
    if (this.armed || this.mode === "junction" || this.mode === "label")
      this.updateGhost();
    // The part under the cursor (its body, or one of its pins just outside it) gets its full pin labels +
    // value chip revealed (Phase 3) — ambient parts stay decluttered. Same idle-only gate as the net hover.
    this.hoverComponentId =
      this.mode === "select" || this.mode === "wire"
        ? (this.pinHitTest(wp.x, wp.y)?.componentId ??
          this.bodyHitTest(wp.x, wp.y)?.id ??
          null)
        : null;
  };

  private readonly onPointerUp = (e: FederatedPointerEvent): void => {
    if (this.marquee) {
      this.finalizeMarquee();
      this.marquee = null;
      this.marqueeLayer.clear();
      return;
    }
    if (this.regionDrawing) {
      // Keep the rectangle (the pending region) so its pins preview live and the player can seal it. But
      // if this "drag" never grew past a cell (a click), restore the box that was there before — a stray
      // click in region mode must not wipe an already-drawn region.
      this.regionDrawing = false;
      if (this.regionRectWorld() === null && this.regionPrev !== null) {
        this.pendingRegion = this.regionPrev;
      }
      this.regionPrev = null;
      this.drawPendingRegion();
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
    if (this.boxHandleDrag) {
      // The single drag undo was already committed on the first resizing move (moveBoxHandleDrag); a bare
      // click on a handle resized nothing, so there's nothing to commit here. Just end the gesture.
      this.boxHandleDrag = null;
      this.pendingUndo = null;
      return;
    }
    if (this.pinDrag) {
      // Commit only if the pin actually slid to a new cell (a bare Alt-click leaves it put). The pin
      // INDEX is unchanged, so wire connectivity / the netlist `sig` are stable — this is pure geometry.
      if (this.pinDrag.moved && this.pendingUndo) {
        this.commitUndo(this.pendingUndo);
        this.cb.onChange?.(this.graph);
        this.cb.onPersist?.(this.graph);
      }
      this.pinDrag = null;
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
    this.lazyRoute = emptyLazyRoute();
    this.redrawWires(); // light up the source pin's net (KiCad-style highlight)
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
    // Land on whichever is actually NEAREST the cursor — NOT pin-always-first. A dense sub-assembly packs
    // pins and junctions close together, so pin-first made junctions unreachable there ("wire to junctions,
    // only the pins" bug); nearest-wins lets you land on the junction you're aiming at (ties → junction, so
    // a junction sitting on a pin's cell still tees in). Empty ⇒ null (falls through to T / dangling below).
    const pinHit = this.pinHitTest(wx, wy);
    const jidHit = this.junctionHitTest(wx, wy);
    let target: Endpoint | null = null;
    if (pinHit || jidHit !== null) {
      const d2 = (
        c: { col: number; row: number } | null | undefined,
      ): number => {
        if (!c) return Infinity;
        const p = this.cellToWorld(c);
        return (p.x - wx) ** 2 + (p.y - wy) ** 2;
      };
      const pd = pinHit ? d2(this.graph.pinRefCell(pinHit)) : Infinity;
      const jd =
        jidHit !== null ? d2(this.graph.junctions.get(jidHit)?.cell) : Infinity;
      target = jd <= pd ? { junctionId: jidHit! } : pinHit;
    }
    if (target) {
      // Ignore a release/click back on the start endpoint itself (keep routing).
      if (endpointKey(target) === fromKey) return;
      const before = this.graph.serialize();
      const from = this.wiring.from;
      const wire = this.graph.connect(from, target);
      if (wire) {
        // Keep the lazy-follow sketch: bake the trail as this wire's bend waypoints before redraw.
        this.bakeLazyIntoWire(from, target);
        // BUS CABLE (docs/ui/bus-scaling-design.md, P1): if this single strand cleanly connects two
        // same-width name-indexed buses (A0→A0 …, siblings free), REPLACE it with ONE Cable that owns the
        // drawn route. The cable carries all N bits via auto net-labels (deriveCableLinks) and renders as a
        // single trunk fanning out to strands at each end — no N independently-routed wires (the clutter
        // the 212 revert removed). A deliberate single-bit wire returns null here → left as a plain wire.
        if (isPinRef(from) && isPinRef(target)) {
          const plan = planBusCable(this.graph, from, target);
          if (plan) {
            const route = (wire.waypoints ?? []).map((c) => ({ ...c }));
            this.graph.removeWire(wire.id);
            this.graph.addCable({
              base: plan.base,
              width: plan.width,
              route,
              src: {
                componentId: from.componentId,
                pinIndices: plan.srcPinIndices,
              },
              dst: {
                componentId: target.componentId,
                pinIndices: plan.dstPinIndices,
              },
            });
          }
        }
        this.pushUndo(before);
        this.redrawWires();
        this.cb.onChange?.(this.graph);
        // Capture the endpoints AND their absolute cells so the route is faithfully re-drivable: on a
        // clean-boot replay element ids differ, so replayWire resolves the pin BY CELL. See replayWire /
        // scripts/replay.mjs.
        logAction("wire", undefined, {
          from,
          to: target,
          fromCell: this.graph.endpointCell(from) ?? undefined,
          toCell: this.graph.endpointCell(target) ?? undefined,
        });
      }
      this.cancelWiring(); // a pin/existing junction is a definite end → finish
      return;
    }
    // Bare trace: T in with an auto-junction and continue routing from it. The new
    // junction becomes the start, so re-anchor the down-cell to it (a drag-release
    // continue leaves the pointer up; the next press re-arms anyway).
    const tFrom = this.wiring.from;
    const newJ = this.finishWireOnWire(wx, wy);
    if (newJ !== null) {
      // Bake the sketched bends into the segment that just teed in (then the trail resets for the
      // next leg, which starts fresh at the new junction).
      this.bakeLazyIntoWire(tFrom, { junctionId: newJ });
      this.wiring = { from: { junctionId: newJ } };
      const jc = this.graph.endpointCell(this.wiring.from);
      if (jc) this.wiringDownCell = { ...jc };
      this.wiringMoved = false;
      this.redrawWires();
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
    const dFrom = this.wiring.from;
    const j = this.graph.addJunction(cell, true);
    const wire = this.graph.connect(dFrom, { junctionId: j.id });
    if (!wire) {
      this.graph.removeJunction(j.id);
      return;
    }
    // Bake the sketched bends into this leg before continuing from the new dangling junction.
    this.bakeLazyIntoWire(dFrom, { junctionId: j.id });
    this.pushUndo(before);
    this.wiring = { from: { junctionId: j.id } };
    this.wiringDownCell = { ...cell };
    this.wiringMoved = false;
    this.redrawWires();
    this.cb.onChange?.(this.graph);
    logAction("wire", "dangling", { cell: { col: cell.col, row: cell.row } });
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
      // Remove the junction but heal the wire it joined (keep the connection); right-click on a
      // real 3+-way branch falls back to dropping the incident wires (dissolveJunction).
      this.graph.dissolveJunction(jid);
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
    this.lazyRoute = emptyLazyRoute();
    this.pendingWire.clear();
    this.redrawWires(); // clear the net highlight
  }

  /**
   * Bake the current lazy-follow trail into the just-committed wire between `from` and `to` as its bend
   * waypoints (so the sketched route is kept — no per-corner junctions), then reset the trail for the
   * next segment. The waypoint list is ordered from→to; if the stored wire runs to→from it is reversed.
   * A no-op (beyond the reset) when the trail is straight or the wire can't be found.
   */
  private bakeLazyIntoWire(from: Endpoint, to: Endpoint): void {
    const sc = this.graph.endpointCell(from);
    const tc = this.graph.endpointCell(to);
    if (sc && tc) {
      const wps = lazyWaypoints(sc, this.lazyRoute, tc);
      if (wps.length > 0) {
        const fk = endpointKey(from);
        const tk = endpointKey(to);
        const wire = [...this.graph.wires.values()].find((w) => {
          const a = endpointKey(w.from);
          const b = endpointKey(w.to);
          return (a === fk && b === tk) || (a === tk && b === fk);
        });
        if (wire) {
          const ordered =
            endpointKey(wire.from) === fk ? wps : [...wps].reverse();
          this.graph.setWireWaypoints(wire.id, ordered);
        }
      }
    }
    this.lazyRoute = emptyLazyRoute();
  }

  // --- undo ---------------------------------------------------------------

  /** Bundle a graph snapshot with the free-form geometry registered RIGHT NOW into one undo step. Pass the
   * graph snapshot for the immediate `pushUndo` path (taken before the mutation); omit it for a deferred
   * drag (captured at pointer-down, before the geometry moves). */
  private snapshotEntry(graph?: GraphSnapshot): UndoEntry {
    const g = graph ?? this.graph.serialize();
    return {
      graph: g,
      geoms: captureFreeFormGeoms(g),
    };
  }

  private pushUndo(before: GraphSnapshot): void {
    // `before` was serialized before this op mutated anything, so its geoms (read live here) are the
    // pre-op geometry — correct for box-resize, which pushes BEFORE re-registering the new geom.
    this.commitUndo(this.snapshotEntry(before));
  }

  private commitUndo(entry: UndoEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
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
   * Step each wire's running mean-square branch current one frame toward the latest
   * |i|² (from `lastWireCurrents`, which `redrawWires` just refreshed). Called exactly
   * once per rendered frame — keeping it out of `redrawWires` (which also fires on every
   * pan/drag/edit) so the EMA advances at a steady wall-clock rate. `redrawWires` only
   * reads `wireMs`; this is the sole writer. Stale wires are pruned like the belt offsets.
   */
  private advanceWireRms(): void {
    for (const [id, cur] of this.lastWireCurrents) {
      const inst2 = cur * cur;
      const prev = this.wireMs.get(id);
      this.wireMs.set(
        id,
        prev === undefined ? inst2 : prev + (inst2 - prev) * WIRE_RMS_ALPHA,
      );
    }
    if (this.wireMs.size > this.graph.wires.size) {
      for (const id of this.wireMs.keys())
        if (!this.graph.wires.has(id)) this.wireMs.delete(id);
    }
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
    const effLens =
      this.lodEnabled && this.lens !== "thermal" ? this.lens : "schematic";
    const conduit: BoardLens | null =
      effLens !== "schematic" && this.world.scale.x >= TIER_ZOOM
        ? effLens
        : null;
    // Inside a FREE-FORM (box-captured) subassembly die, the wires that land on a frame pin are the
    // package's PINOUT leads, not internal board traces — so they draw as plain schematic leads even when
    // the lens skins everything else as conduits (owner round 2: "just pinouts, not solder traces"). The
    // internal circuit still gets the conduit treatment.
    const freeFormDie =
      this.dieFrameId !== null &&
      isFreeFormFrame(this.graph.components.get(this.dieFrameId)?.kind ?? "");
    this.conduitDrawRoutes.clear();
    // Conduit draw routes (logical route + pin-align stubs), fanned apart where they
    // share a channel, computed once up front so the per-wire draw below just uses them.
    const condRoutes = new Map<number, Point[]>();
    // Wire → net node (or null for an unconnected wire). Hoisted to function scope so the
    // reality LED-bar pass below can group wires by net and read the per-net voltage.
    const nets = new Map<number, number | null>();
    // Where each junction hub actually draws: a junction is a free routing vertex, so
    // when its runs are fanned into lanes the hub rides along (filled in below). Empty ⇒
    // the hub stays on its cell (schematic, or an unnudged junction).
    const junctionPos = new Map<number, Point>();
    let conduitCrossDots: { x: number; y: number; color: number }[] = [];
    // Wire draw order. Conduit bridges (the up-bump at a different-net crossing) must paint OVER the
    // trace they hop, so a hopping wire is drawn AFTER the wire it hops (set below from applyCrossings).
    // Default = the graph's natural order (schematic mode has no bridges).
    let wireOrder: number[] = [...this.graph.wires.keys()];
    if (conduit) {
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
            pinExit(w.from, this.graph, this.dieFrameId),
            pinExit(w.to, this.graph, this.dieFrameId),
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
        wireColor.set(
          w.id,
          node === null ? PALETTE.cyan : this.nodeColor(node),
        );
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
      const cross = applyCrossings(
        condRoutes,
        nets,
        (id) => wireColor.get(id) ?? PALETTE.cyan,
      );
      conduitCrossDots = cross.dots;
      wireOrder = wireDrawOrder([...this.graph.wires.keys()], cross.overpasses);
    }
    // KiCad-style NET HIGHLIGHT: lay a bright halo UNDER every trace on the brought-forward net (the wire
    // being routed, or the net under an idle hover — resolved by node, not name) so the whole net pops.
    // Drawn first so the real traces paint on top of the glow; the net's PIN RINGS + off-net dimming are
    // applied alongside ({@link drawNetFocus} + the node loop in {@link update}).
    const activeNode = this.highlightNet();
    if (activeNode !== null) {
      for (const w of this.graph.wires.values()) {
        if (this.endpointNode(w.from) !== activeNode) continue;
        const route = this.routeForWire(w);
        if (route.length < 2) continue;
        polyline(g, route);
        g.stroke({ width: 10, color: PALETTE.warn, alpha: 0.5 });
      }
    }
    this.drawNetFocus(activeNode);
    for (const id of wireOrder) {
      const w = this.graph.wires.get(id);
      if (!w) continue;
      const route = this.routeForWire(w);
      if (route.length < 2) continue;
      // A lead onto a free-form subassembly's frame pin renders as a schematic pinout (see `freeFormDie`).
      const frameLead =
        freeFormDie &&
        ((isPinRef(w.from) && w.from.componentId === this.dieFrameId) ||
          (isPinRef(w.to) && w.to.componentId === this.dieFrameId));
      // Colour by the net's SIGNED-RMS effective voltage (rail identity), not the
      // instantaneous value — steady on AC at every speed, so the hue never strobes 0↔peak.
      // A pinned net-label colour overrides this (endpointColor); else it's the rail hue.
      const color = this.endpointColor(w.from);
      // The INSTANTANEOUS net voltage stays the energy-flow direction (the power v·i sign that
      // sloshes the energy belt) — that reversal SHOULD track the live cycle, unlike the hue.
      const v = this.pinVoltage(w.from);

      const cur = currents.get(w.id) ?? 0;
      // The carrier→shimmer blur for this wire: its AC current's APPARENT rate
      // (signal Hz × playback-speed scale) handed through the same smoothstep the tier
      // drawers use. DC/slow wires → 0 (carriers stream/slosh as before); fast AC under
      // a high tickrate → 1 (a shimmer band, no aliased strobing). Slowing the tickrate
      // drops it back to visible sloshing (see tierKit `apparentFreq`).
      const wf = flow.get(w.id);
      const blur =
        wf && wf.freq > 0 ? blurFactor(apparentFreq(wf.freq)) * wf.acFrac : 0;
      // Magnitude (thickness + carrier density/alpha) tracks current — but |i| aliases
      // 0↔peak on fast AC exactly the way the colour does, so ease it toward the branch
      // RMS current as the blur rises (the current-domain twin of the vrms colour blend
      // below). The RMS is a running mean-square (`wireMs`, advanced once per frame in
      // `advanceWireRms` — the sub-frame batch carries only voltages, so there is no
      // per-tick branch current to average directly). The SIGN stays instantaneous, so
      // the carriers still slosh; only the amount it draws stops strobing.
      const irmsW = Math.sqrt(this.wireMs.get(w.id) ?? cur * cur);
      const magC = Math.abs(cur) * (1 - blur) + irmsW * blur;
      const normC = saturate(magC / I_REF);
      // Thickness tracks current over a wide range so amperage is legible at a
      // glance (bounded by the saturating normC — a huge current stays on-screen).
      const width = BELT_WIDTH_MIN + (BELT_WIDTH_MAX - BELT_WIDTH_MIN) * normC;
      // (The colour is already the net's signed-RMS rail identity — see `cv` above — so it
      // is stable on AC at every speed; no per-frame de-strobe blend is needed any more.)
      // The path actually drawn (and walked by the carriers): in conduit mode it is the
      // logical route + aligning pin stubs, rounded into elbows; in schematic mode the
      // plain route. Sampling the carriers on THIS keeps the particles on the pipe
      // through its bends.
      let sampleRoute = route;
      if (conduit && !frameLead) {
        // Narrower than before (was 5 + 6·normC) so parallel/overlapping pipes pile up
        // into far less haze while a high-current bus is still visibly fatter.
        const pw = 4 + 5 * normC;
        const rd = condRoutes.get(w.id) ?? route;
        sampleRoute = roundedPoints(rd, Math.min(pw * 2, PITCH * 0.7));
        this.drawConduitSkin(g, sampleRoute, color, pw, conduit);
        this.conduitDrawRoutes.set(w.id, sampleRoute);
      } else {
        // A free-form frame-pin lead drawn as a thin schematic PINOUT leg (round 2: "just pinouts, not
        // solder traces"). In the conduit lens, route it along the SAME nudged + rounded path the pipes
        // use — `condRoutes` already carries the parallel-nudge + junction-follow for every wire — so a
        // lead into a fanned-out junction (the input net) bends, fans, and lands EXACTLY like the internal
        // pipes instead of cutting its own un-nudged, sharp-cornered path (owner: the input leg should
        // "look identical to the others" and "respect the pipe auto-nudge and bend rules"). Plain
        // schematic route when the lens itself is schematic (no conduit routes computed).
        const legRoute =
          conduit && condRoutes.has(w.id)
            ? roundedPoints(condRoutes.get(w.id)!, Math.min(8, PITCH * 0.7))
            : route;
        sampleRoute = legRoute;
        // Floor a FRAME-PIN leg's width so a no-current digital input reads as a solid pinout leg, not a
        // hairline; a current-carrying lead (VCC/OUT) already exceeds the floor, so it stays untouched.
        const legWidth = frameLead ? Math.max(width, LEAD_WIDTH_FLOOR) : width;
        polyline(g, legRoute);
        g.stroke({ width: legWidth + 4, color, alpha: 0.16 });
        polyline(g, legRoute);
        g.stroke({ width: legWidth, color, alpha: 0.95 });
        // Register the DRAWN route in conduitDrawRoutes so the conduit-mode hit-test (which only knows
        // that map) can still select these pinout leads — otherwise they become un-clickable (round 3).
        if (conduit) this.conduitDrawRoutes.set(w.id, legRoute);
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
              // Smaller + dimmer than before (was r 2+1.6·, α 0.45+0.4·): the carriers now ride the
              // OPAQUE core, so they stay legible at lower strength and stop dominating dense clusters.
              g.circle(s.x, s.y, 1.6 + 1.2 * normC).fill({
                color: PIPE_WATER,
                alpha: (0.3 + 0.32 * normC) * fade,
              });
            } else {
              g.circle(s.x, s.y, 1.4 + 1 * normC).fill({
                color: COND_ELEC,
                alpha: (0.32 + 0.32 * normC) * fade,
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
          // Capped so a dense AC region's auras don't bloom into a wall of light.
          const half = Math.min(16, (width * 0.6 + 4 + 5 * normC) * vib);
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
          stroke(1.8 * half, color, blur * (0.06 + 0.05 * normC)); // narrower, dimmer voltage aura
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
    this.drawJunctions(g, conduit, junctionPos);
    // Same-net conduit crossings tie with a junction dot (the different-net ones bridged
    // over via the baked-in hop).
    for (const d of conduitCrossDots) {
      g.circle(d.x, d.y, 4.5).fill({ color: 0x0d0b16, alpha: 0.9 });
      g.circle(d.x, d.y, 3).fill({ color: d.color });
    }
    // Per-net voltage MAGNITUDE gauge, drawn on top of the conduit at each net's anchor:
    // the reality lens gets the LED bar, the analogy lens its water-standpipe twin (height =
    // pressure = voltage). Schematic shows neither. Both share `netGaugeAnchors`.
    if (conduit === "reality") this.drawNetBars(g, nets, condRoutes);
    else if (conduit === "analogy") this.drawNetStandpipes(g, nets, condRoutes);
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
    // Bus cables overlay the wire layer: one trunk per cable, fanning to individual strands at each end.
    this.drawCables(g);
    // Consumed: a same-frame redraw (e.g. mid-drag) must not advance the belt.
    this.flowDelta = 0;
  }

  /**
   * Draw the bus CABLES (docs/ui/bus-scaling-design.md, P1): each cable is ONE trunk through its drawn
   * route, fanning out to the individual pin strands at both ends — "combine as one for routing, fan out
   * where you plug in." Every conductor is still drawn (the fans are individual strands; bit 0 IS the
   * trunk), so "show the wires" holds. Connectivity is the cable's auto net-labels (deriveCableLinks), not
   * these strokes — this is pure presentation. (P2 adds the conduit skin + zoom LoD + ×N badge.)
   */
  private drawCables(g: Graphics): void {
    if (this.graph.cables.size === 0) return;
    type XY = { x: number; y: number };
    const centroid = (ps: XY[]): XY => ({
      x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
      y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
    });
    // The gather sits on the pin-array CENTRE line, pushed OUT toward the partner part by the cluster's own
    // spread + a cell — leaving room for the orthogonal comb to fan between the spread-out pins and the
    // gather. The fan AXIS is set by the array's own orientation (a vertical pin column — more Y-spread — is
    // approached HORIZONTALLY and fans vertically), NOT the run direction, so a route jog can't flip it; the
    // partner direction only chooses which side (sign). Snapped to H/V → the whole breakout is on-grid.
    const gatherAxis = (
      ctr: XY,
      toward: XY,
      pins: XY[],
    ): { pt: XY; axis: "h" | "v" } => {
      let sx = 0;
      let sy = 0;
      for (const p of pins) {
        sx += Math.abs(p.x - ctr.x);
        sy += Math.abs(p.y - ctr.y);
      }
      const axis: "h" | "v" = sy >= sx ? "h" : "v"; // ⟂ the dominant pin-array spread
      const spread = Math.max(
        PITCH,
        ...pins.map((p) => Math.hypot(p.x - ctr.x, p.y - ctr.y)),
      );
      const d = spread + PITCH;
      const pt: XY =
        axis === "h"
          ? { x: ctr.x + Math.sign(toward.x - ctr.x || 1) * d, y: ctr.y }
          : { x: ctr.x, y: ctr.y + Math.sign(toward.y - ctr.y || 1) * d };
      return { pt, axis };
    };
    // One orthogonal "comb tooth" per conductor: pin → out along the run axis → turn once (an L) into the
    // gather, so every strand follows the same Manhattan rules as a hand-drawn wire — no diagonals, and
    // BOTH ends fan identically. The shared leg into the gather reads as the bus manifold.
    const comb = (pins: XY[], gp: XY, axis: "h" | "v") => {
      for (const p of pins) {
        if (axis === "h")
          g.moveTo(p.x, p.y).lineTo(gp.x, p.y).lineTo(gp.x, gp.y);
        else g.moveTo(p.x, p.y).lineTo(p.x, gp.y).lineTo(gp.x, gp.y);
      }
    };
    for (const c of this.graph.cables.values()) {
      const worldOf = (componentId: number, pinIndex: number): Point | null => {
        const cell = this.graph.pinRefCell({ componentId, pinIndex });
        return cell ? this.cellToWorld(cell) : null;
      };
      const srcW = c.src.pinIndices
        .map((i) => worldOf(c.src.componentId, i))
        .filter((p): p is Point => p !== null);
      const dstW = c.dst.pinIndices
        .map((i) => worldOf(c.dst.componentId, i))
        .filter((p): p is Point => p !== null);
      if (srcW.length === 0 || dstW.length === 0) continue;
      const color = c.color ?? PALETTE.accent;
      const sc = centroid(srcW);
      const dc = centroid(dstW);
      const routeW = c.route.map((cell) => this.cellToWorld(cell));
      // Each end's gather sits on the pin-array CENTRE line, pushed out toward the PARTNER part — so the
      // trunk meets each array at its centre and the comb fans symmetrically either side, identically at
      // both ends, no matter how the route jogs in between.
      const src = gatherAxis(sc, dc, srcW);
      const dst = gatherAxis(dc, sc, dstW);
      // End fans: an orthogonal comb at BOTH ends — every conductor on-grid, symmetric about the centre.
      comb(srcW, src.pt, src.axis);
      comb(dstW, dst.pt, dst.axis);
      g.stroke({ width: 2, color, alpha: 0.75 });
      // Trunk (thick): src-centre gather → the user's drawn route bends → dst-centre gather, walked as an
      // ORTHOGONAL polyline. Any diagonal segment (notably the leg from the route's end to the centre-line
      // gather) gets an inserted elbow, so the trunk is pure Manhattan and meets each comb spine head-on —
      // the leg touching a gather leaves/enters along that end's fan axis. Already-orthogonal user bends are
      // untouched. Render-only; the stored route (manipulable) is unchanged.
      const pts: XY[] = [src.pt, ...routeW, dst.pt];
      const trunk: XY[] = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const a = trunk[trunk.length - 1];
        const b = pts[i];
        if (a.x !== b.x && a.y !== b.y) {
          const corner =
            i === pts.length - 1
              ? dst.axis === "h"
                ? { x: a.x, y: b.y }
                : { x: b.x, y: a.y }
              : i === 1
                ? src.axis === "h"
                  ? { x: b.x, y: a.y }
                  : { x: a.x, y: b.y }
                : { x: b.x, y: a.y };
          trunk.push(corner);
        }
        trunk.push(b);
      }
      g.moveTo(trunk[0].x, trunk[0].y);
      for (let i = 1; i < trunk.length; i++) g.lineTo(trunk[i].x, trunk[i].y);
      g.stroke({ width: 6, color, alpha: 0.9 });
    }
  }

  /**
   * A net's voltage statistics for the LED bar — the RMS magnitude, the DC mean (sign
   * reference), and the swing extremes (peak envelope). Reads the sub-frame batch arrays
   * when present; when they are absent (paused / scrubbing) it falls back to the frozen
   * instantaneous value, which collapses the bar to a flat DC reading (no swing).
   */
  private netVStats(node: number): {
    vrms: number;
    vmean: number;
    vmin: number;
    vmax: number;
  } {
    const inst = this.nodeVoltage(node) ?? 0;
    const arrays =
      this.nodeVrms &&
      this.nodeVmean &&
      this.nodeVmin &&
      this.nodeVmax &&
      node >= 0 &&
      node < this.nodeVrms.length;
    if (!arrays) {
      return { vrms: Math.abs(inst), vmean: inst, vmin: inst, vmax: inst };
    }
    return {
      vrms: this.nodeVrms![node]!,
      vmean: this.nodeVmean![node]!,
      vmin: this.nodeVmin![node]!,
      vmax: this.nodeVmax![node]!,
    };
  }

  /**
   * Shared swing classification for a net's voltage gauge — the reality LED bar
   * ({@link drawNetBars}) AND the analogy water standpipe ({@link drawNetStandpipes}) read it from
   * here so the two lenses never diverge. `bipolar` — a centre-zero AC net (it swings through ground
   * AND its DC mean is small versus the swing) → the gauge fills each way from a midpoint. `swinging`
   * — the net has appreciable peak-to-peak (the envelope/tide band + the **"~" AC badge** show), and
   * only when a sub-frame batch actually ran.
   *
   * Peak-to-peak is `vmax − vmin` (always ≥ 0) → it is **0 for a DC rail**, so a pure DC net is
   * neither bipolar nor swinging: no tide band, no "~". (The old `|vmax| + |vmin|` only equalled
   * peak-to-peak for a centre-zero net; on a +5 V DC rail it read 10, far over the threshold, so the
   * "~" badge fired on every non-zero DC net — the owner's DC-loop bug.)
   */
  private netSwing(
    s: { vmean: number; vmin: number; vmax: number },
    vMax: number,
    live: boolean,
  ): { bipolar: boolean; swinging: boolean } {
    const ptp = s.vmax - s.vmin; // true peak-to-peak (≥ 0); exactly 0 for DC
    const bipolar =
      s.vmin < 0 &&
      s.vmax > 0 &&
      Math.abs(s.vmean) < BAR_BIPOLAR_MEAN_FRAC * (ptp / 2);
    const swinging = live && ptp / vMax > BAR_SWING_EPS;
    return { bipolar, swinging };
  }

  /**
   * One representative, **placement-aware** gauge anchor per NET — the single source of
   * truth shared by the reality LED bar ({@link drawNetBars}) and the analogy water
   * standpipe ({@link drawNetStandpipes}) so the two lenses agree on where a net's gauge
   * sits AND on which way it branches. Wires are grouped by node; each net's longest drawn
   * conduit route wins. The gauge taps off the pipe: from the tap point `(tx,ty)` a short
   * stub runs along the **outward normal** `(ox,oy)` to the gauge **base** `(bx,by)`, where
   * the column extends a further `reach` px. The normal defaults to screen-UP and is flipped
   * DOWN — or the tap slid along the route — when an upward box would clip a placed part or
   * another wire's pipe (see {@link gaugeBoxClear}). Ground (node 0) IS gauged — it reads
   * empty (0 V, the zero reference made visible); only unconnected wires (null) get no gauge.
   *
   * @param reach the column reach (px) past the base — the height the collision box must clear.
   */
  private netGaugeAnchors(
    nets: Map<number, number | null>,
    condRoutes: Map<number, Point[]>,
    reach: number,
  ): Map<number, GaugeAnchor> {
    // Group every gauged wire's drawn route BY NODE, longest first. The longest route is the most
    // central place to tap, but when it's crowded a shorter route of the SAME net is a valid fallback
    // tap — so we keep all of a net's routes and try each in turn (the owner: the GND standpipe should
    // relocate to a clear stretch instead of sitting on top of another pipe).
    const routesByNode = new Map<number, { route: Point[]; len: number }[]>();
    for (const [wid, node] of nets) {
      // Include ground (node 0): it gets an EMPTY gauge (0 V → a drained standpipe / all-off
      // bar), the zero reference made visible — the user asked for it explicitly. Only null
      // (unconnected) and any negative sentinel are skipped.
      if (node === null || node < 0) continue;
      const route = condRoutes.get(wid);
      if (!route || route.length < 2) continue;
      const len = routeLength(route);
      if (len <= 0) continue;
      const arr = routesByNode.get(node) ?? [];
      arr.push({ route, len });
      routesByNode.set(node, arr);
    }
    for (const arr of routesByNode.values()) arr.sort((a, b) => b.len - a.len);

    // Static obstacles, gathered once: every placed part's padded footprint box, and the
    // OTHER wires' drawn routes (a gauge may sit on its own pipe but must clear the rest).
    const partBoxes: Rectangle[] = [];
    for (const c of this.graph.components.values()) {
      if (this.dieFrameId !== null && c.id === this.dieFrameId) continue; // the die frame isn't an obstacle
      partBoxes.push(this.componentBox(c));
    }
    const allRoutes = [...condRoutes.values()].filter((r) => r.length >= 2);

    const anchors = new Map<number, GaugeAnchor>();
    for (const [node, routes] of routesByNode) {
      let chosen: GaugeAnchor | null = null;
      let fallback: GaugeAnchor | null = null;
      // Try the net's routes longest-first; on each, the midpoint then slides along the route,
      // and at each spot prefer UP then DOWN. First clear box anywhere on any route wins.
      for (const best of routes) {
        const ownRoute = best.route;
        const fracs = [0.5, ...GAUGE_NUDGE_FRACS.map((f) => 0.5 + f)];
        for (const f of fracs) {
          const s = sampleRouteAt(
            ownRoute,
            best.len * Math.min(0.95, Math.max(0.05, f)),
          );
          // Perpendicular unit normal to the route here; "up" is whichever sense points −y.
          let nx = -s.dy;
          let ny = s.dx;
          if (ny > 0) {
            nx = -nx;
            ny = -ny; // orient the primary candidate toward screen-up
          }
          for (const sign of [1, -1] as const) {
            const ox = nx * sign;
            const oy = ny * sign;
            const cand = {
              tx: s.x,
              ty: s.y,
              bx: s.x + ox * GAUGE_STUB,
              by: s.y + oy * GAUGE_STUB,
              ox,
              oy,
            };
            // Keep the very first candidate as the least-bad fallback (longest route, midpoint, up).
            fallback ??= cand;
            if (
              this.gaugeBoxClear(cand, reach, ownRoute, partBoxes, allRoutes)
            ) {
              chosen = cand;
              break;
            }
          }
          if (chosen) break;
        }
        if (chosen) break;
      }
      anchors.set(node, chosen ?? fallback!);
    }
    return anchors;
  }

  /**
   * Cheap collision heuristic for a placement-aware gauge: is the gauge's world-space box —
   * the stub + column reaching `reach` px out from the base along the outward normal, padded,
   * `GAUGE_BOX_W` wide each side — clear of every placed part's footprint and of every drawn
   * pipe **except its own**? Parts test as AABB overlap; pipes test as a sampled point-to-
   * segment distance under {@link GAUGE_PIPE_CLEAR}. Correctness over completeness — these are
   * small teaching boards, so a slightly conservative box is fine.
   */
  private gaugeBoxClear(
    a: GaugeAnchor,
    reach: number,
    ownRoute: Point[],
    partBoxes: Rectangle[],
    allRoutes: Point[][],
  ): boolean {
    // Box spans from the tap (so the stub is covered) out to the column tip.
    const tipX = a.bx + a.ox * reach;
    const tipY = a.by + a.oy * reach;
    const minX = Math.min(a.tx, tipX) - GAUGE_BOX_W - GAUGE_BOX_PAD;
    const maxX = Math.max(a.tx, tipX) + GAUGE_BOX_W + GAUGE_BOX_PAD;
    const minY = Math.min(a.ty, tipY) - GAUGE_BOX_W - GAUGE_BOX_PAD;
    const maxY = Math.max(a.ty, tipY) + GAUGE_BOX_W + GAUGE_BOX_PAD;
    for (const r of partBoxes) {
      if (
        minX < r.x + r.width &&
        maxX > r.x &&
        minY < r.y + r.height &&
        maxY > r.y
      ) {
        return false;
      }
    }
    // Pipe clearance: sample the box's centre line (base→tip) and reject if any sample sits
    // within GAUGE_PIPE_CLEAR + half-width of a foreign route segment. Skip the own route.
    const clr = GAUGE_PIPE_CLEAR + GAUGE_BOX_W;
    const N = 5;
    for (const route of allRoutes) {
      if (route === ownRoute) continue;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const sx = a.bx + a.ox * reach * t;
        const sy = a.by + a.oy * reach * t;
        for (let j = 0; j + 1 < route.length; j++) {
          const p0 = route[j]!;
          const p1 = route[j + 1]!;
          if (distToSegment(sx, sy, p0.x, p0.y, p1.x, p1.y) < clr) {
            return false;
          }
        }
      }
    }
    return true;
  }

  /**
   * Reality-lens pass: one segmented **LED voltage bar-gauge** per NET — the pre-attentive
   * MAGNITUDE channel for voltage (the rail-identity COLOUR already rides the conduit). Nets
   * are grouped from the wire→node map; the bar taps off the net's longest drawn conduit
   * route via a short stub at its placement-aware anchor ({@link netGaugeAnchors}), branching
   * up or down to stay clear of parts + other pipes. Fills are a **fraction of the circuit's
   * max rail** ({@link circuitVMax}) — the hottest net fills the whole bar, ground reads
   * empty — so the gauges actually differ across a circuit. The solid lit segments read RMS
   * (a per-frame scalar, so it never strobes on AC); a translucent envelope band extends to
   * the peak swing; a net that swings through ground is drawn centre-zero (the geometry
   * itself signals bipolar AC). DC is the swing→0 limit of the same path.
   */
  private drawNetBars(
    g: Graphics,
    nets: Map<number, number | null>,
    condRoutes: Map<number, Point[]>,
  ): void {
    const H = 2 * BAR_HALF; // full container reach (px) from the base outward
    const anchors = this.netGaugeAnchors(nets, condRoutes, H);
    // Scale every bar to the max rail magnitude of ITS OWN circuit so the fills actually differ AND
    // a separate board doesn't borrow this one's range: the hottest rail in each circuit fills its
    // whole bar, ground reads empty, the rest are proportional.
    const vMaxByGroup = this.circuitVMaxByGroup(anchors.keys());

    const segH = H / BAR_SEGS; // one segment slot's height (along the column)
    const live = this.nodeVrms !== undefined; // a sub-frame batch ran (not paused)

    for (const [node, a] of anchors) {
      const vMax = vMaxByGroup.get(this.circuitGroup(node)) ?? 1e-3;
      // The column runs from the base (a.bx,a.by — past the stub) OUTWARD along (a.ox,a.oy).
      // We lay it out along that axis as a signed coordinate `u` (0 at base, +H at the tip),
      // then map every (x,y) back through the normal. The cross axis is the perpendicular.
      const ux = a.ox;
      const uy = a.oy;
      const px = -uy; // unit cross axis (bar width direction)
      const py = ux;
      // Map a column-space point (along-axis u from base, cross-axis c from centre) to world.
      const pt = (u: number, c: number) => ({
        x: a.bx + ux * u + px * c,
        y: a.by + uy * u + py * c,
      });

      const { vrms, vmean, vmin, vmax } = this.netVStats(node);
      // Tint by the net's pinned colour override when set, else the rail voltage
      // colour; the gauge fill/magnitude below stays voltage-driven (unchanged).
      const color = this.nodeColor(node);

      // Bipolar AC ⇒ centre-zero (grows each way from a midpoint notch); a swing shows the envelope
      // band + "~" badge. Both come from the shared classifier, so the bar + standpipe never diverge
      // and a DC rail (peak-to-peak 0) shows neither.
      const { bipolar, swinging } = this.netSwing(
        { vmean, vmin, vmax },
        vMax,
        live,
      );

      // Fill fractions of vMax → px. A net AT the circuit max fills the whole reach; ground
      // (0 V) → empty. Bipolar splits the reach about the centre notch (half each way).
      const fr = (v: number, full: number) =>
        Math.min(full, (Math.abs(v) / vMax) * full);
      // `u0` is the along-axis coordinate of the zero notch; solid/env grow OUT (+) and,
      // when bipolar, also back toward the base (−) into the sump.
      let u0: number; // along-axis position of the zero notch
      let solidOut: number;
      let envOut: number;
      let solidIn = 0; // only the bipolar case fills toward the sump
      let envIn = 0;
      if (bipolar) {
        u0 = BAR_HALF; // notch at the column's midpoint
        const rms = fr(vrms, BAR_HALF);
        solidOut = rms;
        solidIn = rms;
        envOut = Math.max(rms, fr(vmax, BAR_HALF));
        envIn = Math.max(rms, fr(-vmin, BAR_HALF));
      } else {
        u0 = 0; // notch at the base
        const rms = fr(vrms, H);
        // The peak reaches the most-extreme sample on the rail's (mean's) side.
        const peak = fr(vmean >= 0 ? vmax : vmin, H);
        solidOut = rms;
        envOut = Math.max(rms, peak);
      }

      // 0) The tap stub from the pipe to the base, so the bar reads as branching off the pipe.
      g.moveTo(a.tx, a.ty).lineTo(a.bx, a.by);
      g.stroke({ width: 1.4, color, alpha: 0.55, cap: "round" });

      // The off-track + lit segments. Each slot is lit solid (RMS), a translucent envelope
      // band (peak swing), or a dim off-segment, by where its centre's signed level (out from
      // the notch) falls relative to the extents. When swing≈0 the env collapses onto solid.
      const w = BAR_W;
      for (let i = 0; i < BAR_SEGS; i++) {
        const segU = i * segH + segH / 2; // segment centre along the axis (from base)
        const lvl = segU - u0; // + = outward of the notch, − = inward (sump)
        const mag = Math.abs(lvl);
        const solid = lvl >= 0 ? solidOut : solidIn;
        const env = lvl >= 0 ? envOut : envIn;
        let segColor = BAR_OFF_COLOR;
        let segAlpha = BAR_OFF_ALPHA;
        if (mag <= solid) {
          segColor = color;
          segAlpha = BAR_FILL_ALPHA;
        } else if (swinging && mag <= env) {
          segColor = color;
          segAlpha = BAR_ENV_ALPHA;
        }
        // The segment slot, centred on the column axis (rotated rect via a 4-point poly).
        const lo = i * segH + BAR_SEG_GAP / 2;
        const hi = (i + 1) * segH - BAR_SEG_GAP / 2;
        const c0 = pt(lo, -w / 2);
        const c1 = pt(hi, -w / 2);
        const c2 = pt(hi, w / 2);
        const c3 = pt(lo, w / 2);
        g.poly([c0.x, c0.y, c1.x, c1.y, c2.x, c2.y, c3.x, c3.y]).fill({
          color: segColor,
          alpha: segAlpha,
        });
      }

      // The zero notch — always drawn — a crisp line across the bar at the baseline.
      const n0 = pt(u0, -(w / 2 + 1));
      const n1 = pt(u0, w / 2 + 1);
      g.moveTo(n0.x, n0.y).lineTo(n1.x, n1.y);
      g.stroke({ width: 1, color: BAR_NOTCH_COLOR, alpha: 0.85 });

      // "~" AC badge beside the bar iff the net has an appreciable swing (DC ⇒ none).
      if (swinging) {
        const b = pt(u0, w / 2 + 7);
        this.drawTildeBadge(g, b.x, b.y, color);
      }
    }
  }

  /**
   * The maximum rail magnitude PER CIRCUIT — `max |nodeColorVoltage|` over the nets in each connected
   * circuit ({@link circuitGroup} groups them via the netlist's `circuitOfNode`, ground excluded as a
   * bridge) — with a tiny floor so an all-zero board can't divide by zero. A gauge fills as a fraction
   * of ITS OWN circuit's max, so two physically separate boards (e.g. an AC loop and a DC loop) each
   * read against their own range, not a shared global reference. Returns a map keyed by group root;
   * pair it with {@link circuitGroup} per net. (Was a single whole-board max — the bug where a DC
   * standpipe read low next to a higher-peak AC one it wasn't even wired to.)
   */
  private circuitVMaxByGroup(nodes: Iterable<number>): Map<number, number> {
    const byGroup = new Map<number, number>();
    for (const node of nodes) {
      const g = this.circuitGroup(node);
      const v = Math.abs(this.nodeColorVoltage(node));
      byGroup.set(g, Math.max(byGroup.get(g) ?? 1e-3, v));
    }
    return byGroup;
  }

  /** The circuit-group a node belongs to (its `circuitOfNode` root). With no netlist grouping
   * installed every net falls into one global group (0) — the old whole-board behaviour. */
  private circuitGroup(node: number): number {
    const co = this.circuitOfNode;
    return co && node >= 0 && node < co.length ? co[node]! : 0;
  }

  /**
   * Analogy-lens pass: one **water standpipe** voltage gauge per NET — the analogy twin of
   * the reality LED bar. HEIGHT = water pressure = VOLTAGE, **as a fraction of the circuit's
   * max rail** ({@link circuitVMax}), so the hottest net fills the glass and ground reads
   * empty. A thin glass/steel housing taps off the pipe at the net's placement-aware anchor
   * (shared with the bar via {@link netGaugeAnchors}); a ground line across the base marks
   * the zero level. The calm water rises to the RMS level (the effective pressure) with a
   * bright rail-tinted surface band at the waterline; a translucent splash zone (the tide /
   * wet-mark) reaches on to the peak (Vmax) and, for a bipolar AC net, into the SUMP back
   * toward the pipe down to Vmin. The column fills OUTWARD along the tap normal; a bipolar
   * net drains into the sump. DC degrades cleanly — no wet-mark, just the calm level, the
   * surface band, and the ground line (the swing→0 limit of the same path).
   */
  private drawNetStandpipes(
    g: Graphics,
    nets: Map<number, number | null>,
    condRoutes: Map<number, Point[]>,
  ): void {
    const H = 2 * BAR_HALF; // full column reach (px) from the base outward — matches the bar
    const anchors = this.netGaugeAnchors(nets, condRoutes, H);
    // Scale every standpipe to the max rail magnitude of ITS OWN circuit (not the whole board): the
    // hottest rail in each circuit fills its pipe, ground reads empty, the rest proportional — so a
    // DC loop no longer reads low beside a higher-peak AC loop it isn't wired to (the two lenses agree).
    const vMaxByGroup = this.circuitVMaxByGroup(anchors.keys());
    const live = this.nodeVrms !== undefined; // a sub-frame batch ran (not paused)

    for (const [node, a] of anchors) {
      const vMax = vMaxByGroup.get(this.circuitGroup(node)) ?? 1e-3;
      // Column axis (a.ox,a.oy) runs OUTWARD from the base (a.bx,a.by — the ground/zero
      // level, past the stub); `u` is along it (0 at base = ground, + outward, − into the
      // sump toward the pipe), `c` is the cross axis. Fills are rotated rects via `pt`.
      const ux = a.ox;
      const uy = a.oy;
      const px = -uy;
      const py = ux;
      const pt = (u: number, c: number) => ({
        x: a.bx + ux * u + px * c,
        y: a.by + uy * u + py * c,
      });
      // A band of the column between along-axis u0..u1, full SP_W wide → a 4-point poly.
      const band = (u0: number, u1: number, hw = SP_W / 2) => {
        const p0 = pt(u0, -hw);
        const p1 = pt(u1, -hw);
        const p2 = pt(u1, hw);
        const p3 = pt(u0, hw);
        return [p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y];
      };

      const { vrms, vmean, vmin, vmax } = this.netVStats(node);
      // Tint by the net's pinned colour override when set, else the rail voltage
      // colour; the gauge fill/magnitude below stays voltage-driven (unchanged).
      const color = this.nodeColor(node);

      // Bipolar AC ⇒ centre-zero (calm level at the mean ≈ the baseline); a swing shows the tide band
      // + "~" badge. Shared with the LED bar so the two lenses agree — and a DC rail (peak-to-peak 0)
      // shows neither.
      const { bipolar, swinging } = this.netSwing(
        { vmean, vmin, vmax },
        vMax,
        live,
      );

      // Fill fractions of vMax → px (the net AT the circuit max fills the whole reach; ground
      // → empty). `calmOut/In` is the RMS waterline; `wet*` the splash/tide envelope (peak).
      // Bipolar centres the calm band on the ground line and sloshes the envelope into the
      // sump; unipolar fills outward only. Swing≈0 collapses the wet extents onto the calm.
      const fr = (v: number, full: number) =>
        Math.min(full, (Math.abs(v) / vMax) * full);
      let calmOut: number; // px outward from the ground line (the rail direction)
      let wetOut: number;
      let calmIn = 0; // only the bipolar case fills toward the sump
      let wetIn = 0;
      if (bipolar) {
        const rms = fr(vrms, BAR_HALF);
        calmOut = rms;
        calmIn = rms;
        wetOut = Math.max(rms, fr(vmax, BAR_HALF));
        wetIn = Math.max(rms, fr(-vmin, BAR_HALF));
      } else {
        const rms = fr(vrms, H);
        const peak = fr(vmean >= 0 ? vmax : vmin, H);
        calmOut = rms;
        wetOut = Math.max(rms, peak);
      }

      // FIXED full-scale housing: the glass always spans the whole reach so its TOP marks the
      // circuit's max rail (vMax) and every net's waterline reads against the SAME scale — the hottest
      // rail brims, ground sits empty, the rest fill proportionally. (Was sized to the fill, so each
      // glass had its own height and you couldn't compare levels at a glance.) `fullOut` is the vMax
      // level outward; a bipolar net also reaches `fullIn` into the sump for −vMax.
      const fullOut = bipolar ? BAR_HALF : H;
      const fullIn = bipolar ? BAR_HALF : 0;
      const uTop = fullOut + 3; // outward housing end (along +u) — vMax + a little headroom
      const uBot = -(fullIn + 3); // sump-side housing end (along −u)
      const surfCol = mix(PIPE_WATER, color, SP_TINT); // rail-tinted surface band + cap

      // 0) The tap stub from the pipe to the base (ground line), reads as branching off.
      g.moveTo(a.tx, a.ty).lineTo(a.bx, a.by);
      g.stroke({ width: 1.4, color: surfCol, alpha: 0.5, cap: "round" });

      // 1) The splash / tide band (translucent) — the swing envelope, drawn FIRST so the calm
      //    fill + surface band sit crisply on top. From the calm waterline out to the peak,
      //    and (bipolar) into the sump down to Vmin.
      if (swinging) {
        if (wetOut > calmOut) {
          g.poly(band(calmOut, wetOut)).fill({
            color: PIPE_WATER,
            alpha: SP_WET_ALPHA,
          });
        }
        if (wetIn > calmIn) {
          g.poly(band(-calmIn, -wetIn)).fill({
            color: PIPE_WATER,
            alpha: SP_WET_ALPHA,
          });
        }
      }

      // 2) The calm water — solid RMS fill from the ground line out to calmOut and into the
      //    sump to calmIn.
      if (calmOut > 0) {
        g.poly(band(0, calmOut)).fill({
          color: PIPE_WATER,
          alpha: SP_WATER_ALPHA,
        });
      }
      if (calmIn > 0) {
        g.poly(band(0, -calmIn)).fill({
          color: PIPE_WATER,
          alpha: SP_WATER_ALPHA,
        });
      }

      // 3) The bright rail-tinted surface band at each calm waterline (the meniscus carrying
      //    the rail identity). Drawn where there is calm water on that side.
      const halfSurf = SP_SURFACE_H / 2;
      if (calmOut > 0) {
        g.poly(band(calmOut - halfSurf, calmOut + halfSurf)).fill({
          color: surfCol,
          alpha: SP_SURFACE_ALPHA,
        });
      }
      if (calmIn > 0) {
        g.poly(band(-calmIn - halfSurf, -calmIn + halfSurf)).fill({
          color: surfCol,
          alpha: SP_SURFACE_ALPHA,
        });
      }

      // 4) The glass/steel housing outline (PIPE_WALL) over the whole reach.
      g.poly(band(uBot, uTop)).stroke({
        width: SP_WALL_W,
        color: PIPE_WALL,
        alpha: SP_WALL_ALPHA,
      });

      // 5) The ground (zero-level) line — always drawn — across the housing at the base.
      const gl0 = pt(0, -(SP_W / 2 + 1.5));
      const gl1 = pt(0, SP_W / 2 + 1.5);
      g.moveTo(gl0.x, gl0.y).lineTo(gl1.x, gl1.y);
      g.stroke({ width: 1, color: BAR_NOTCH_COLOR, alpha: SP_GROUND_ALPHA });

      // 5b) Half-scale marker(s): a faint tick across the glass at vMax/2 (and −vMax/2 for a bipolar
      //     net), so the waterline reads against a fixed scale — top = the loop's max rail, this = half.
      const halfTick = (uu: number): void => {
        const m0 = pt(uu, -(SP_W / 2 + 1.5));
        const m1 = pt(uu, SP_W / 2 + 1.5);
        g.moveTo(m0.x, m0.y).lineTo(m1.x, m1.y);
        g.stroke({
          width: 1,
          color: BAR_NOTCH_COLOR,
          alpha: SP_GROUND_ALPHA * 0.5,
        });
      };
      halfTick(fullOut / 2);
      if (bipolar) halfTick(-fullIn / 2);

      // "~" AC badge beside the standpipe iff the net has an appreciable swing (DC ⇒ none).
      if (swinging) {
        const b = pt(0, SP_W / 2 + 7);
        this.drawTildeBadge(g, b.x, b.y, surfCol);
      }
    }
  }

  /** A small "~" glyph — the AC badge beside an LED bar with an appreciable swing. */
  private drawTildeBadge(
    g: Graphics,
    x: number,
    cy: number,
    color: number,
  ): void {
    const w = 8; // glyph width (px)
    const a = 2.4; // wave amplitude (px)
    const n = 10; // samples across the sine
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x + t * w;
      const py = cy - Math.sin(t * Math.PI * 2) * a;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke({ width: 1.4, color, alpha: 0.9, cap: "round", join: "round" });
  }

  /**
   * The outward (away-from-the-body) cardinal direction of a pin endpoint in world
   * space — the pin's facing, rotated with the part. Null for a junction, a centred
   * lone pin, or a corner pin with no clear single facing. Used to add the small
   * aligning stub so a conduit enters a part straight along its pin axis.
   */
  private pinOutward(ep: Endpoint): Dir | null {
    return pinOutward(ep, this.graph);
  }

  /**
   * Re-skin a bare trace as a conduit (analogy pipe / reality conductor). Thin wrapper
   * over the shared, `this`-free {@link drawConduitSkin} in `./boardRender` so the sealed-IC
   * opened view can run the SAME skin; every internal call site is unchanged.
   */
  private drawConduitSkin(
    g: Graphics,
    rp: Point[],
    color: number,
    pw: number,
    lens: BoardLens,
  ): void {
    drawConduitSkin(g, rp, color, pw, lens);
  }

  /**
   * Draw the wire-to-wire junction dots (KiCad style): a small filled disc where
   * three+ wire-ends tie together, in the net's voltage colour so it reads as one
   * with the belt. A dark backing ring keeps it legible over the flowing belt.
   */
  private drawJunctions(
    g: Graphics,
    conduit: BoardLens | null,
    junctionPos: Map<number, Point>,
  ): void {
    for (const j of this.graph.junctions.values()) {
      // Use the nudged hub position when its runs were fanned into lanes (so the hub
      // sits on its pipes), else the plain cell.
      const p = junctionPos.get(j.id) ?? this.cellToWorld(j.cell);
      const color = this.endpointColor({ junctionId: j.id });
      const hot = this.selectedJunctions.has(j.id);
      if (conduit) {
        this.drawJunctionConduit(g, p, color, conduit);
      } else {
        g.circle(p.x, p.y, JUNCTION_R + 1.5).fill({
          color: 0x0d0b16,
          alpha: 1,
        });
        g.circle(p.x, p.y, JUNCTION_R).fill({ color });
      }
      if (hot) {
        // Hug the conduit hub — its dark collar disc reads ~radius 6, so 6+3 clears it by 3px.
        g.circle(p.x, p.y, (conduit ? 6 : JUNCTION_R) + 3).stroke({
          width: 1.5,
          color: PALETTE.accent,
          alpha: 0.9,
        });
      }
    }
  }

  /**
   * A conduit junction hub. Thin wrapper over the shared, `this`-free
   * {@link drawJunctionConduit} in `./boardRender` so the sealed-IC opened view can draw the
   * SAME hub; every internal call site is unchanged.
   */
  private drawJunctionConduit(
    g: Graphics,
    p: Point,
    color: number,
    lens: BoardLens,
  ): void {
    drawJunctionConduit(g, p, color, lens);
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
      // Cable-owned labels are internal connectivity tokens (deriveCableLinks), not user-facing pills —
      // the Cable draws its own trunk + fans, so these never render.
      if (l.ownerId !== undefined) continue;
      // A trace label draws at its `pos` on the wire; a pin/junction label at its
      // anchor. Either way the colour/voltage comes from the net (its `at` endpoint).
      const cell = l.pos ?? this.graph.endpointCell(l.at);
      if (!cell) continue;
      const o = this.cellToWorld(cell);
      const color = this.endpointColor(l.at);
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
  // The route family lives in `./boardRender` (the shared, `this`-free home) so the sealed-IC
  // opened view can route its inner graph with the SAME geometry. These thin wrappers pass the
  // `Board`'s `graph` / `dieFrameId`, keeping every internal call site byte-identical.

  private wireRoute(pa: Point, pb: Point): Point[] {
    return wireRoute(pa, pb);
  }

  /** See {@link dieFramePinExit} in `./boardRender`. */
  private dieFramePinExit(ep: Endpoint): "v" | "h" | null {
    return dieFramePinExit(ep, this.graph, this.dieFrameId);
  }

  /** See {@link frameLeadRoute} in `./boardRender`. */
  private frameLeadRoute(
    pa: Point,
    pb: Point,
    exitFrom: "v" | "h" | null,
    exitTo: "v" | "h" | null,
  ): Point[] {
    return frameLeadRoute(pa, pb, exitFrom, exitTo);
  }

  /** See {@link routeForWire} in `./boardRender` — the single source of wire geometry. */
  private routeForWire(w: Wire): Point[] {
    return routeForWire(w, this.graph, this.dieFrameId);
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
    const wps = w.waypoints ?? [];
    if (!a || !b || wps.length === 0) return wps.map((c) => ({ ...c }));
    // Pure, unit-tested minimiser (drops zero-length steps, U-turn spikes, colinear bends) — 3C.
    return cleanRouteWaypoints(a, wps, b);
  }

  /**
   * Begin a KiCad-style segment drag on wire `w` at world point (wx,wy). Delegates the geometry to the
   * pure {@link planSegmentDrag} (pick the grabbed segment, materialise the drawn corners as grid
   * brackets) and resolves each grabbed-segment end: a bracket on a fixed PIN gets a coincident interior
   * waypoint spliced in (the endpoint holds, the route bends near it); a bracket on a JUNCTION is mapped
   * to that junction's id in `moveJunctions`, so the drag slides the junction (its incident wires follow)
   * instead of folding a stub over the tapped wire. Returns null if the wire has no drawable route.
   */
  private beginWireSegmentDrag(
    w: Wire,
    wx: number,
    wy: number,
  ): {
    pts: Cell[];
    bi: number;
    axis: "h" | "v";
    moveJunctions: { end: "lo" | "hi"; id: number }[];
  } | null {
    const route = this.routeForWire(w);
    const a = this.graph.endpointCell(w.from);
    const b = this.graph.endpointCell(w.to);
    if (!a || !b) return null;
    // Pure planner (unit-tested): picks the grabbed segment, materialises grid brackets, and decides
    // each end — a FIXED pin gets a spliced interior bracket (the route bends near it); a JUNCTION end
    // is flagged so we slide the junction with the drag instead of folding a stub over the tapped wire.
    const plan = planSegmentDrag(
      route,
      a,
      b,
      isJunctionRef(w.from),
      isJunctionRef(w.to),
      wx,
      wy,
    );
    if (!plan) return null;
    // Map each flagged bracket end back to its junction id. The planner only flags an end whose
    // endpoint is a junction, so the matching from/to is always a JunctionRef here.
    const moveJunctions: { end: "lo" | "hi"; id: number }[] = [];
    for (const end of plan.moveEnds) {
      const ep = end === "lo" ? w.from : w.to;
      if (isJunctionRef(ep)) moveJunctions.push({ end, id: ep.junctionId });
    }
    return { pts: plan.pts, bi: plan.bi, axis: plan.axis, moveJunctions };
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
    // A bracket that coincides with a junction endpoint slides the JUNCTION itself (kept in lockstep
    // with the bracket cell), so the segment translates cleanly and the junction's other wires follow —
    // instead of folding a stub over the tapped wire. moveJunction copies the cell, so aliasing is safe.
    for (const mj of d.moveJunctions) {
      this.graph.moveJunction(mj.id, mj.end === "lo" ? lo : hi);
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
  private computeWireFlow(): Map<number, WireFlow> {
    // The per-wire branch-current solve is pure graph math (`solveWireFlow`, shared with the zoom-to-open
    // replica so the inner circuit animates by the SAME KCL). Feed it this board's wires + element
    // electrical; with no solve (`electrical` absent) the empty injection set yields all-zero flow.
    return solveWireFlow(
      this.graph.wires.values(),
      this.electrical ?? new Map(),
    );
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
    let junctionCell: Cell | null = null;
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
          junctionCell = { col: snap(cp.x, PITCH), row: snap(cp.y, PITCH) };
          junctionPt = this.cellToWorld(junctionCell);
        }
      }
    }
    const end = snapTo
      ? this.cellToWorld(this.graph.pinRefCell(snapTo) ?? start)
      : (junctionPt ?? this.pointer);
    // The grid cell the wire would END at — a snapped pin, the previewed junction, or the snapped cursor.
    const endCell: Cell = snapTo
      ? (this.graph.pinRefCell(snapTo) ?? start)
      : (junctionCell ?? {
          col: snap(this.pointer.x, PITCH),
          row: snap(this.pointer.y, PITCH),
        });
    // Lazy-follow: once the pointer has sketched any bends, preview the route through those baked
    // waypoints (orthogonal chain). With no bends yet, keep the plain auto route — including the
    // die-frame pad's perpendicular down-bend exit, shown live so the builder reads the exit as you drag.
    const lazyWps = lazyWaypoints(start, this.lazyRoute, endCell);
    const exitFrom = this.dieFramePinExit(this.wiring.from);
    const exitTo = snapTo ? this.dieFramePinExit(snapTo) : null;
    const route =
      lazyWps.length > 0
        ? chainOrthoRoute(
            [start, ...lazyWps, endCell].map((c) => this.cellToWorld(c)),
          )
        : exitFrom || exitTo
          ? this.frameLeadRoute(ps, end, exitFrom, exitTo)
          : this.wireRoute(ps, end);
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

/** Sustained over-temperature SIM-time (s) a part survives past `T_MAX_C` before it VENTS — the magic
 *  smoke escapes and it's destroyed for the run. Accumulated by the sim-tick delta (replay-safe), so a
 *  brief spike is survivable but a sustained overload kills it. Game-scaled to the thermal τ (~2.4 s). */
const VENT_SECONDS = 1.6;

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
  // The optional GATE SYMBOL for a CHARACTERIZED cell recognised as a gate (NAND/XOR/…), drawn centred
  // on the body and faded with the name label as you zoom toward the open replica.
  private readonly symbolGlyph = new Graphics();
  // The zoom-to-open mini-board's inner-part glyphs (a pool of scaled child Graphics, one per inner
  // part). Lives under the rotated glyph holder so the miniature inherits the instance's rotation;
  // populated by `drawUserIcInternals` only for a sealed USER IC zoomed in (hidden otherwise).
  private readonly userIcGlyphs = new Container();
  private readonly glyph = new Graphics();
  private readonly failBox = new Graphics();
  // Self-heating body glow: a warm incandescence ramp behind the part body, invisible at ambient and
  // brightening (bronze→amber→red→white) as the part dissipates power. Presentation-only — `tj` is the
  // live junction temperature integrated each frame from `P=V·I` (Real mode); it never re-enters the
  // solve. See `web/src/lib/thermal.ts`.
  private readonly heatGlow = new Graphics();
  private tj = T_AMBIENT_C;
  // Web-side thermal-death flag: this part has cooked past T_MAX_C (Real-mode self-heating). Drives the
  // distinct OVERHEAT box below (separate from the red over-current FAIL). Presentational only — like the
  // FAIL flag it only marks the part and never re-enters the solve, so it stays golden-safe + replay-safe.
  private overTemp = false;
  private readonly overheatBox = new Graphics();
  private readonly overheatText: Text;
  // Thermal-death VENT: accumulated over-temp sim-time (s); once it passes VENT_SECONDS the part is
  // destroyed for the run (`vented` latched) — the magic smoke escapes (the `smoke` puff animation + a
  // charred body). Replay-safe (ventHeat is advanced by the sim-tick delta); presentational, never the solve.
  private ventHeat = 0;
  private vented = false;
  private readonly smoke = new Graphics();
  private readonly label: Text;
  private readonly value: Text | null;
  /** The live stored-value chip ("Q=…") a recognised sequential cell shows under its body symbol; it
   * fades IN as you zoom toward the part (the LED bits carry the state when zoomed out). */
  private readonly stateLabel: Text;
  private readonly meter: Text;
  private readonly failText: Text;
  private readonly pinPositions: { x: number; y: number }[] = [];
  private readonly pinLabels: string[] = [];
  // Small pin-name labels (A/K, B/C/E, …) drawn over the part at the deepest LOD.
  private readonly pinTexts: Text[] = [];
  // Backing plates + short leaders for the pin labels (owner: a high-pin-count chip's names were hard to
  // read and didn't visibly connect to their pin). Sits BEHIND the pin texts; redrawn each frame in
  // `update` since the labels reflow with zoom/rotation.
  private readonly pinLabelDeco = new Graphics();
  private readonly wPx: number;
  private readonly hPx: number;
  private readonly color: number;
  private readonly kindTag: string;
  private readonly unit: string;
  /** Cached node-free authored geometry for the zoom-to-open miniature when the board doesn't solve
   * (no live internals map). Rebuilt only when the registry def changes — a reseal mints a new UserIc
   * object, so a reference compare catches it. */
  private staticUserIc?: UserIcInternals;
  private staticUserIcDef?: UserIc;
  /** The static (unpowered) recursion map: nested sub-ICs' static geometry by flatId, so a placed
   * subassembly opens chip-within-chip even when the board doesn't solve (built beside staticUserIc). */
  private staticUserIcAll?: Map<number, UserIcInternals>;
  /** Which way pin LABELS push to sit OUTSIDE the body (datasheet edge-mount): `true` = up/down (pins
   * arrayed along the wide axis, on the top/bottom edges, e.g. SOT-23), `false` = left/right (pins on
   * the left/right edges, e.g. DIP). Derived once from the pin spread in the constructor. */
  private labelPushVertical = true;
  /** Whether this part is currently FOCUSED (hovered / selected). Latched each `update` so the board's
   * label de-overlap pass ({@link collectLabels}) can rank a focused part's labels above ambient ones. */
  private focused = false;

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
      // A die frame's pins can carry a player-given name (the IC-maker port-pad label); show it in
      // place of the kind's default label (the package pin number) when set. Other parts have no
      // pinNames, so this is the kind label as before.
      const named = component.pinNames?.[p.index]?.trim();
      this.pinLabels.push(named ? named : p.label);
    }
    // Edge-mount axis for the pin labels: if the pins spread wider in X than Y they sit in rows on
    // the top/bottom edges (SOT-23, SIP) → labels push vertically out of those edges; otherwise they
    // sit in columns on the left/right edges (DIP/VSSOP) → labels push horizontally. Datasheet style.
    {
      let lminX = Infinity;
      let lmaxX = -Infinity;
      let lminY = Infinity;
      let lmaxY = -Infinity;
      for (const pp of this.pinPositions) {
        lminX = Math.min(lminX, pp.x);
        lmaxX = Math.max(lmaxX, pp.x);
        lminY = Math.min(lminY, pp.y);
        lmaxY = Math.max(lmaxY, pp.y);
      }
      this.labelPushVertical = lmaxX - lminX >= lmaxY - lminY;
    }

    this.tierGlyph.position.set(this.wPx / 2, this.hPx / 2);
    this.glyphHolder.addChild(this.connectorGlyph);
    this.glyphHolder.addChild(this.tierGlyph);
    this.glyphHolder.addChild(this.glyph);
    this.glyphHolder.addChild(this.symbolGlyph); // the gate face sits ON the package body
    // The mini-board's inner-part glyphs sit ABOVE the wires drawn into `glyph` (symbols on top of
    // their traces, like internalsView) but start hidden — only a zoomed-in sealed USER IC shows them.
    this.userIcGlyphs.visible = false;
    this.glyphHolder.addChild(this.userIcGlyphs);
    this.view.addChild(this.glyphHolder);
    // Heat glow sits at the very back of the node (behind the body symbol), so a hot part reads as
    // glowing from within without obscuring its glyph.
    this.view.addChildAt(this.heatGlow, 0);
    // Pinout labels live on `view` (not the rotated `glyphHolder`) so they stay
    // upright; positioned at the rotated pin and shown only at the deepest zoom. The backing/leader deco
    // sits just behind them (added first), so each plate lifts its name off the busy copper.
    this.view.addChild(this.pinLabelDeco);
    for (const lbl of this.pinLabels) {
      const t = new Text({
        text: lbl,
        style: {
          // A calm telemetry grey + a dark halo so the pin name reads cleanly OVER the pink leads/symbol
          // around it instead of merging with them (owner: keep the labels visually distinct).
          fill: PALETTE.dim,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 9,
          fontWeight: "600",
          stroke: { color: 0x0d0b16, width: 3 },
        },
      });
      t.anchor.set(0.5);
      t.visible = false;
      this.pinTexts.push(t);
      this.view.addChild(t);
    }
    const symbol = isSymbol(this.kindTag);
    this.label = new Text({
      // The custom label if the player named this part, else the kind's fallback (its tag, or
      // nothing for a die frame — see defaultLabel).
      text: this.component.label ?? this.defaultLabel(),
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

    // The live value chip a recognised cell shows ("Q=…" / "Y=…"), set + faded each frame in `update`. A
    // soft dark drop-shadow keeps it legible over the package body it sits on (it shares the crowded body
    // region with the pinout text — the readability is the point).
    this.stateLabel = new Text({
      text: "",
      style: {
        fill: this.color,
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 9,
        fontWeight: "600",
        dropShadow: {
          color: 0x0a0814,
          alpha: 0.85,
          blur: 3,
          distance: 0,
          angle: 0,
        },
      },
    });
    this.stateLabel.anchor.set(0.5);
    this.stateLabel.resolution = DPR;
    this.stateLabel.visible = false;
    this.view.addChild(this.stateLabel);

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

    // OVERHEAT overlay: a pulsing amber/char box + "OVERHEAT" label when this part cooks past T_MAX_C
    // (Real-mode self-heating). Distinct from the red over-current FAIL above; shown only when not also
    // over-current-failed, so a part shows one box, not two.
    this.view.addChild(this.overheatBox);
    this.overheatText = new Text({
      text: "OVERHEAT",
      style: {
        fill: PALETTE.warn,
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 1,
      },
    });
    this.overheatText.anchor.set(0.5);
    this.overheatText.resolution = DPR;
    this.overheatText.visible = false;
    this.view.addChild(this.overheatText);
    // Smoke puffs (drawn on top) for a vented/destroyed part.
    this.smoke.eventMode = "none";
    this.smoke.visible = false;
    this.view.addChild(this.smoke);

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
        const r = rotPx(p.x, p.y, this.component.rot, this.component.mirror);
        minX = Math.min(minX, r.x);
        maxX = Math.max(maxX, r.x);
        minY = Math.min(minY, r.y);
        maxY = Math.max(maxY, r.y);
      }
      const cx = (minX + maxX) / 2;
      this.label.position.set(cx, minY - 16);
      this.value?.position.set(cx, maxY + 16);
      this.meter.position.set(cx, minY - 30);
    } else if (isDieFrame(this.kindTag)) {
      // Park the die's name just BELOW the bottom wall, outside the build area — like a chip's part
      // designator under the package — so it never sits over the circuit you build inside.
      let maxY = 0;
      for (const p of this.pinPositions) maxY = Math.max(maxY, p.y);
      this.label.position.set(this.wPx / 2, maxY + 18);
    } else {
      this.label.position.set(this.wPx / 2, this.hPx / 2);
    }
  }

  reposition(): void {
    const p = this.anchor();
    this.view.position.set(p.x, p.y);
    // Horizontal flip BEFORE rotation: PixiJS applies scale before rotation in the
    // local→parent matrix, so `scale.x = −1` then `rotation` composes exactly like
    // `rotateOffset(dx, dy, rot, mirror)` (reflect dx, then rotate) — the mirrored body
    // lines up with the pin dots/labels (which use that same orient) at all 4 rotations.
    this.glyphHolder.scale.x = this.component.mirror ? -1 : 1;
    this.glyphHolder.rotation = (this.component.rot * Math.PI) / 2;
    this.layoutLabels();
  }

  /** Re-rasterize the labels at the given resolution (driven by DPR × zoom). */
  setTextRes(r: number): void {
    this.label.resolution = r;
    if (this.value) this.value.resolution = r;
    this.meter.resolution = r;
    this.failText.resolution = r;
    this.overheatText.resolution = r;
    // Pin labels manage their OWN resolution + counter-scale in the layout loop (LABEL_CAP_ZOOM), so they
    // stay crisp + constant-size near the pin past the zoom where this shared, MAX_TEXT_RES-capped value
    // would blur and balloon them.
  }

  /** Refresh the on-board value label after an inspector edit. */
  setValue(value: number): void {
    if (this.value) this.value.text = formatValue(value, this.unit);
  }

  /** Refresh the on-board label after an inspector rename: the custom name if set,
   *  else the kind's fallback ({@link defaultLabel}). */
  setLabel(label: string | undefined): void {
    this.label.text = label && label.length > 0 ? label : this.defaultLabel();
    this.layoutLabels();
  }

  /** The label shown when the part carries no custom name: its kind tag — EXCEPT a die frame, which
   *  shows its PACKAGE name (e.g. "DIP-14"), never the internal "__DIE_*" tag. layoutLabels parks a
   *  die frame's label just below the bottom wall (outside the build area). */
  private defaultLabel(): string {
    if (isDieFrame(this.kindTag)) return PART_KINDS[this.kindTag]?.name ?? "";
    // A sealed USER IC shows its DISPLAY NAME (resolved via the tag), not the raw tag — so renaming the
    // subassembly in My ICs backfills to every placed instance. The tag stays the stable internal identity
    // key (connectivity/netlist never move); the name is purely the editable label. Falls back to the kind
    // name, then the tag. A stock part keeps showing its tag (`R`, `LED`), the established board shorthand.
    if (isUserIc(this.kindTag)) {
      const def = resolveUserIc(this.kindTag, this.component.variant ?? 0);
      return (
        def?.name?.trim() ||
        PART_KINDS[this.kindTag]?.name?.trim() ||
        this.kindTag
      );
    }
    return this.kindTag;
  }

  /** Phase 3b — push this part's currently-VISIBLE labels (pin names + the value chip) with a de-overlap
   * PRIORITY, for the board's cross-part label de-clash pass: a FOCUSED part outranks ambient, and within a
   * part an OUTPUT pin name beats an input/other name beats the value chip (the owner's priority order). The
   * pass keeps labels high-to-low and hides whichever lower-priority one is cramped — the pin DOTS stay, so
   * only the name text yields. */
  collectLabels(out: { text: Text; prio: number }[]): void {
    const base = this.focused ? 1000 : 0;
    const def = isUserIc(this.kindTag)
      ? resolveUserIc(this.kindTag, this.component.variant ?? 0)
      : null;
    const roles = def?.pinRoles ?? [];
    for (let i = 0; i < this.pinTexts.length; i++) {
      const t = this.pinTexts[i]!;
      if (!t.visible) continue;
      const rank = roles[i] === "out" ? 30 : 20; // output names win over input/other names
      out.push({ text: t, prio: base + rank - i * 0.01 }); // stable tiebreak by pin index
    }
    if (this.stateLabel.visible && this.stateLabel.alpha > 0.05)
      out.push({ text: this.stateLabel, prio: base + 10 }); // the value chip is lowest
  }

  /** The live self-heating body temperature (°C). Ambient unless the part is dissipating in Real mode. */
  get bodyTemp(): number {
    return this.tj;
  }

  /** The part's body centre in world coordinates — the heat-field overlay's source location. */
  get center(): { x: number; y: number } {
    return { x: this.view.x + this.wPx / 2, y: this.view.y + this.hPx / 2 };
  }

  /** The part's footprint box in world coordinates — copper pad/leads for the heat-field's copper mask. */
  get worldBox(): { x: number; y: number; w: number; h: number } {
    return { x: this.view.x, y: this.view.y, w: this.wPx, h: this.hPx };
  }

  /** Reset the body temperature to ambient (on a sim restart / netlist rebuild). */
  resetThermal(): void {
    this.tj = T_AMBIENT_C;
    this.overTemp = false;
    this.ventHeat = 0;
    this.vented = false;
    this.heatGlow.clear();
    this.overheatBox.clear();
    this.overheatBox.visible = false;
    this.overheatText.visible = false;
    this.smoke.clear();
    this.smoke.visible = false;
  }

  /** Draw a few rising, fading smoke puffs above a vented (destroyed) part — the magic smoke escaping. On
   *  a free wall-clock (pure presentation), so it animates even while a FAIL freezes the run. */
  private drawSmoke(cx: number, topY: number): void {
    this.smoke.clear();
    const t = performance.now() / 1000;
    const puffs = 4;
    for (let i = 0; i < puffs; i++) {
      const phase = (t * 0.55 + i / puffs) % 1; // 0 (born at the body) → 1 (faded out, high up)
      const rise = phase * PITCH * 2.4;
      const r = PITCH * 0.26 * (0.45 + phase);
      // Fade in over the first slice, then out toward the top.
      const fade = (phase < 0.18 ? phase / 0.18 : 1) * (1 - phase);
      const drift = Math.sin((t * 1.3 + i) * Math.PI) * PITCH * 0.3 * phase;
      this.smoke
        .circle(cx + drift, topY - rise, r)
        .fill({ color: 0x7a7a7a, alpha: 0.4 * fade });
    }
  }

  /** Draw the warm incandescence halo behind the body, scaled by how hot the part is. Invisible at
   *  ambient; ramps bronze → amber → red → white as `Tj` climbs toward the max junction temperature.
   *  A few concentric falloff rings approximate a soft radial glow (Pixi Graphics has no gradient). */
  private drawHeatGlow(): void {
    const f = glowFactor(this.tj);
    this.heatGlow.clear();
    if (f <= 0.002) return;
    const col =
      f < 0.5
        ? mix(PALETTE.bronze, PALETTE.warn, f / 0.5)
        : f < 0.8
          ? mix(PALETTE.warn, PALETTE.bad, (f - 0.5) / 0.3)
          : mix(PALETTE.bad, 0xffffff, (f - 0.8) / 0.2);
    const cx = this.wPx / 2;
    const cy = this.hPx / 2;
    const base = Math.max(this.wPx, this.hPx) / 2 + PITCH * 0.7;
    const rings = 4;
    for (let i = rings; i >= 1; i--) {
      this.heatGlow
        .circle(cx, cy, base * (i / rings))
        .fill({ color: col, alpha: f * 0.28 * (1 - (i - 1) / rings) });
    }
  }

  update(
    electrical: ElectricalState,
    phase: number,
    selected: boolean,
    lens: BoardLens,
    zoom: number,
    internals?: CompositeInternals,
    nodeV?: Float64Array,
    userIc?: UserIcInternals,
    allUserIcInternals?: Map<number, UserIcInternals>,
    viewport?: { w: number; h: number },
    viewProbe?: {
      cx: number;
      cy: number;
      depth: number;
      scale: number;
      anchorPx: number;
    },
    elemCurrents?: Float64Array,
    wireMode = false,
    liveState?: StoredState,
    focused = false,
    dtSec = 0,
    real = false,
  ): void {
    this.focused = focused; // latched for the board's label de-overlap ranking
    // Self-heating (Real mode only): advance this part's body temperature toward Tamb + P·θ_JA on its
    // thermal time constant, from the dissipated power P = max(0, V·I) of its live electrical state, then
    // draw the warm body glow. `dtSec` is the frame's SIM-time delta (Δticks·DT, never wall-clock), so Tj
    // tracks the deterministic sim clock. Ideal mode (or a non-dissipating kind) holds at ambient.
    const heatPower =
      real && partHeats(this.kindTag) ? dissipatedPower(electrical) : 0;
    // A heatsink (the part's management lever) scales θ_JA down, so the same power settles at a lower Tj.
    const sink = heatsinkFactor(this.component.heatsink);
    this.tj = real
      ? stepTemp(this.kindTag, this.tj, heatPower, dtSec, T_AMBIENT_C, sink)
      : T_AMBIENT_C;
    // Thermal-death flag: cooked past the max junction temperature (Real mode only). Purely a render flag
    // (the OVERHEAT box + the inspector readout) — never re-enters the solve, so golden-safe + replay-safe.
    this.overTemp = real && this.tj >= T_MAX_C;
    // Accumulate over-temp sim-time toward the VENT (magic smoke). Sustained over-temp destroys the part
    // (latched for the run); a brief spike recovers (ventHeat decays when back under T_MAX). Advanced by
    // the sim-tick delta → replay-safe. `vented` is presentational only (shown Real-mode only below).
    if (this.overTemp) {
      this.ventHeat += dtSec;
      if (this.ventHeat >= VENT_SECONDS) this.vented = true;
    } else if (!this.vented) {
      this.ventHeat = Math.max(0, this.ventHeat - dtSec);
    }
    // The per-part incandescence halo is the SCHEMATIC heat cue. Under the thermal lens the board
    // heat-field overlay carries the heat (colour contrast only), so the halo is suppressed there to
    // avoid double-drawing — Tj is still integrated above for the field's sources.
    if (lens === "thermal") this.heatGlow.clear();
    else this.drawHeatGlow();
    const g = this.glyph;
    g.clear();
    // Default the mini-board glyphs hidden every frame; the zoom-to-open USER-IC branch below turns
    // them on (via `drawUserIcInternals`). So a chip that scrolls out of zoom-to-open, or any
    // non-user-IC part, never leaves stale inner glyphs showing.
    this.userIcGlyphs.visible = false;

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
    // Zoom-to-open (ADR 0005): a sealed composite IC, zoomed in past INTERNALS_ZOOM under either
    // non-schematic lens, opens to its live internal sub-circuit — the real gates/resistors it is
    // simulated as, animated from the same snapshot — instead of the black-box symbol. The wires
    // are skinned to the lens: water carriers (analogy) or electron drift (reality).
    const showInternals =
      !!internals &&
      internals.elements.length > 0 &&
      nodeV !== undefined &&
      (lens === "reality" || lens === "analogy") &&
      zoom >= INTERNALS_ZOOM;
    // Zoom-to-open for a sealed USER IC: zoomed in past INTERNALS_ZOOM under a non-schematic lens, a
    // placed sealed chip opens to a scaled miniature of the EXACT circuit the player authored — its
    // real part glyphs at their authored positions + the authored wires, animated from the same
    // snapshot — instead of the black-box symbol. (A user IC is never a CEC_COMP, so `showInternals`
    // above is false for it; the two zoom-to-open paths are mutually exclusive.)
    // C-2: the opened replica fires under ALL THREE lenses (reality, analogy AND schematic) — the
    // schematic lens draws the inner circuit as plain orthogonal traces + junction dots (the replica's
    // schematic branch) instead of staying a blank black-box. (The CEC_COMP composite path above stays
    // non-schematic; the two zoom-to-open paths remain mutually exclusive.)
    const wantUserIc = isUserIc(this.kindTag) && zoom >= INTERNALS_ZOOM;
    // Prefer the LIVE node-resolved internals (animated from the snapshot). When the board doesn't
    // solve there is no live map, so fall back to the authored circuit's STATIC geometry (node-free),
    // cached and rebuilt only when the registry def changes (a reseal mints a new object — caught by a
    // reference compare). So a placed chip still opens to "the circuit as you built it" unpowered (the
    // view draws it at level 0 when `nodeV` is absent).
    let effUserIc = userIc;
    if (wantUserIc && !effUserIc) {
      // Resolve the SELECTED variant (a multi-variant family member opens to ITS authored circuit, not the
      // family default) — the static zoom-to-open was variant-blind (it used the family tag's default).
      const def = resolveUserIc(this.kindTag, this.component.variant ?? 0);
      if (def) {
        if (def !== this.staticUserIcDef) {
          // Build the static geometry RECURSIVELY (def + every nested sub-IC by flatId), so the
          // unpowered replica can open chip-within-chip exactly as the live (solved) path does.
          const deep = userIcGeometryDeep(def);
          this.staticUserIc = deep.internals;
          this.staticUserIcAll = deep.all;
          this.staticUserIcDef = def;
        }
        effUserIc = this.staticUserIc;
      }
    }
    const showUserIc = wantUserIc && !!effUserIc;
    // A sealed USER IC's package designator (parked at the body centre) fades out as you zoom in toward
    // the open replica, so the inner circuit isn't covered by the part name (owner: "when you zoom in
    // the text on the package should become transparent"). Non-ICs keep their label fully opaque.
    this.symbolGlyph.clear();
    this.symbolGlyph.visible = false;
    this.stateLabel.visible = false; // turned on only by the live-state branch below
    if (isUserIc(this.kindTag)) {
      const fadeStart = INTERNALS_ZOOM * 0.8; // hold the symbol full until ~80% of the open zoom, then fade
      const fadeAlpha = Math.max(
        0,
        Math.min(1, 1 - (zoom - fadeStart) / (INTERNALS_ZOOM - fadeStart)),
      );
      // A recognised cell wears its schematic SYMBOL on its body (a gate face, or a DFF/latch/register/mux/
      // adder/… face from `cellSymbol`), in place of the name designator, fading with the SAME rule as the
      // label. Resolve the SELECTED variant so a family member shows ITS own face, not the default's.
      const gdef = resolveUserIc(this.kindTag, this.component.variant ?? 0);
      const gname = gdef ? cellSymbol(gdef) : null;
      if (gname) {
        this.symbolGlyph.visible = true;
        this.symbolGlyph.alpha = fadeAlpha;
        const s = Math.min(this.wPx, this.hPx);
        const cx = this.wPx / 2;
        const cy = this.hPx / 2;
        const hw = s * 0.34;
        const hh = s * 0.27;
        // ORTHOGONAL LEADS from the symbol's I/O to the cell's real pins (by role) — refined from the old
        // diagonal spokes to clean right-angle routes that read like a schematic: each runs out to a stub
        // line just past the symbol's back (inputs) / front (outputs) edge, along that line to the I/O
        // attach height, then a short stub INTO the edge (a gate-style entry). Drawn FIRST so the symbol
        // body covers their roots; every segment is collected into `leadSegs` so the value chip can route
        // clear of them (owner: "be aware of the traces it auto-generates").
        const roles = gdef?.pinRoles ?? [];
        const inPins = this.pinPositions.filter((_, i) => roles[i] === "in");
        const outPins = this.pinPositions.filter((_, i) => roles[i] === "out");
        const lead = { width: 1.5, color: this.color, alpha: 0.55 };
        const STUB = Math.max(4, hw * 0.18); // how far the route stands off the symbol edge
        const leadSegs: { ax: number; ay: number; bx: number; by: number }[] =
          [];
        const routeLead = (pts: { x: number; y: number }[]): void => {
          this.symbolGlyph.moveTo(pts[0]!.x, pts[0]!.y);
          for (let k = 1; k < pts.length; k++) {
            this.symbolGlyph.lineTo(pts[k]!.x, pts[k]!.y);
            leadSegs.push({
              ax: pts[k - 1]!.x,
              ay: pts[k - 1]!.y,
              bx: pts[k]!.x,
              by: pts[k]!.y,
            });
          }
          this.symbolGlyph.stroke(lead);
        };
        inPins.forEach((pin, k) => {
          const ay =
            inPins.length > 1
              ? cy - hh * 0.5 + (hh * k) / (inPins.length - 1)
              : cy;
          const bx = cx - hw - STUB; // stub line just behind the symbol's back edge
          routeLead([
            pin,
            { x: bx, y: pin.y },
            { x: bx, y: ay },
            { x: cx - hw, y: ay },
          ]);
        });
        for (const pin of outPins) {
          const fx = cx + hw + STUB; // stub line just past the symbol's front tip
          routeLead([
            pin,
            { x: fx, y: pin.y },
            { x: fx, y: cy },
            { x: cx + hw, y: cy },
          ]);
        }
        drawCellSymbol(this.symbolGlyph, gname, cx, cy, hw, hh, this.color);

        // Smart in-body placement shared by the NAME label and the value chip: score a grid of interior
        // spots by clearance from the symbol box, the auto-routed leads, the pins, AND any already-placed
        // label, and take the roomiest that stays inside the body and off the glyph. So both the name and
        // the stored-Q/Y readout sit INSIDE the box, threaded clear of everything and of each other (owner:
        // name inside, placed smartly, not interfering with the Q value).
        const bestBodySpot = (
          halfW: number,
          halfH: number,
          avoid: { x: number; y: number }[],
        ): { x: number; y: number } => {
          const xMin = cx - this.wPx / 2 + halfW;
          const xMax = cx + this.wPx / 2 - halfW;
          const yMin = cy - this.hPx / 2 + halfH;
          const yMax = cy + this.hPx / 2 - halfH;
          let bx = cx;
          let by = cy + this.hPx / 2 - halfH; // fallback: inner bottom edge
          if (xMax > xMin && yMax > yMin) {
            let best = -Infinity;
            const NX = 5;
            const NY = 5;
            for (let gi = 0; gi < NX; gi++) {
              for (let gj = 0; gj < NY; gj++) {
                const qx = xMin + ((xMax - xMin) * gi) / (NX - 1);
                const qy = yMin + ((yMax - yMin) * gj) / (NY - 1);
                if (
                  Math.abs(qx - cx) < hw + halfW &&
                  Math.abs(qy - cy) < hh + halfH
                )
                  continue; // off the symbol glyph
                let d = Math.hypot(
                  Math.max(Math.abs(qx - cx) - hw, 0),
                  Math.max(Math.abs(qy - cy) - hh, 0),
                );
                for (const sg of leadSegs)
                  d = Math.min(
                    d,
                    distToSegment(qx, qy, sg.ax, sg.ay, sg.bx, sg.by),
                  );
                for (const pp of this.pinPositions)
                  d = Math.min(d, Math.hypot(qx - pp.x, qy - pp.y));
                for (const a of avoid)
                  d = Math.min(d, Math.hypot(qx - a.x, qy - a.y));
                const score = d - Math.abs(qx - cx) * 0.015;
                if (score > best) {
                  best = score;
                  bx = qx;
                  by = qy;
                }
              }
            }
          }
          return { x: bx, y: by };
        };

        // NAME the symbol IN the box, in the clearest gap — the glyph alone can't tell a NAND from a NOR, so
        // show WHAT it is (the symbol's function name). Mapped through the part's rotate/mirror (it lives on
        // the un-rotated `view`) and faded with the symbol.
        this.label.text = gname ?? this.component.label ?? this.defaultLabel();
        const nameSpot = bestBodySpot(
          (this.label.text.length * 6) / 2 + 2,
          11 / 2 + 2,
          [],
        );
        const nameRp = rotPx(
          nameSpot.x,
          nameSpot.y,
          this.component.rot,
          this.component.mirror,
        );
        this.label.position.set(nameRp.x, nameRp.y);
        this.label.alpha = fadeAlpha;
        // Live SYMBOL-STATE: a recognised cell shows its live OUTPUT bit(s) on its body — a register's
        // stored Q, a gate's output Y, an adder's sum/carry. The LED bits sit inside the box and carry the
        // state at a glance when zoomed OUT (riding the symbol fade); the mono value chip ("Q=1"/"Y=0…")
        // fades IN as you zoom toward the part (the two reads combined across zoom). Both gone by the time
        // the open replica takes over.
        if (liveState) {
          drawCellLiveBits(
            this.symbolGlyph,
            cx,
            cy,
            hw,
            hh,
            this.color,
            liveState.bits,
            fadeAlpha,
          );
          // The value chip is the LOWEST-priority body label (output > input pins > value chip — Phase 3 /
          // option 2), so it only reveals when the cell is FOCUSED (hovered / selected) or zoomed in close
          // (AMBIENT_LABEL_ZOOM); ambient cells keep just the LED bit. This is exactly the owner's "Q=1
          // landing among the pin labels" — it no longer floats there on an overview, only when you focus.
          const revealChip = focused || zoom >= AMBIENT_LABEL_ZOOM;
          const textIn = revealChip
            ? Math.max(0, Math.min(1, (zoom - 3.5) / 2)) // fades in over zoom 3.5 → 5.5
            : 0;
          const ta = textIn * fadeAlpha;
          if (ta > 0.02) {
            this.stateLabel.text = formatStoredValue(liveState);
            this.stateLabel.style.fill = this.color;
            // Park the chip INSIDE the body in the clearest gap — same scorer as the name label, but ALSO
            // avoiding the name's spot so the two readouts never overlap (owner: not interfering with Q).
            const chipSpot = bestBodySpot(
              (this.stateLabel.text.length * 6) / 2 + 2,
              11 / 2 + 2,
              [nameSpot],
            );
            const localX = chipSpot.x;
            const localY = chipSpot.y;
            // Crispness + a fixed on-screen size, exactly the way the pin labels do it (counter-scale by
            // `cs`, resolution tracks the capped on-screen scale) — so the chip stops blurring and ballooning
            // as you zoom (owner: "its resolution does not scale properly like the pin text does").
            const capHi = Math.min(zoom, LABEL_CAP_ZOOM);
            const effChip = Math.max(1, capHi);
            const csChip = effChip / Math.max(1, zoom);
            // The chip lives in the UN-rotated `view`, so run its body-local spot through the part's
            // rotate+mirror (the same `rotPx` the pins/symbol use) and keep the text itself upright — so a
            // rotated/flipped part still parks its readout in the right place.
            const rp = rotPx(
              localX,
              localY,
              this.component.rot,
              this.component.mirror,
            );
            this.stateLabel.position.set(rp.x, rp.y);
            this.stateLabel.scale.set(csChip);
            this.stateLabel.resolution = DPR * effChip;
            this.stateLabel.alpha = ta;
            this.stateLabel.visible = true;
          }
        }
      } else {
        this.label.alpha = fadeAlpha;
      }
    } else {
      this.label.alpha = 1;
    }
    if (showInternals && internals && nodeV !== undefined) {
      this.connectorGlyph.visible = false;
      this.tierGlyph.visible = false;
      drawCompositeInternals(g, {
        internals,
        nodeV,
        pins: this.pinPositions,
        wPx: this.wPx,
        hPx: this.hPx,
        phase,
        accent: lens === "analogy" ? PIPE_WATER : COND_ELEC,
      });
    } else if (showUserIc && effUserIc) {
      this.connectorGlyph.visible = false;
      this.tierGlyph.visible = false;
      drawUserIcInternals(g, {
        internals: effUserIc,
        nodeV,
        elemCurrents,
        pins: this.pinPositions,
        wPx: this.wPx,
        hPx: this.hPx,
        color: this.color,
        phase,
        accent: lens === "analogy" ? PIPE_WATER : COND_ELEC,
        // The inner parts follow the board lens: analogy → factory machines, else schematic symbols.
        style: lens === "analogy" ? "factory" : "schematic",
        // The conduit skin follows the board lens too (analogy pipes vs reality conductors).
        lens,
        partLayer: this.userIcGlyphs,
        // Phase 2 / C-1: the camera transform + the tier threshold, so the replica can swap each inner
        // part to its tier-DETAIL illustration once `s · cameraZoom ≥ TIER_ZOOM`, exactly as the die
        // editor does past TIER_ZOOM. `zoom` is already `this.world.scale.x` (no loop.ts change).
        cameraZoom: zoom,
        tierZoom: TIER_ZOOM,
        // Phase 2 Part A: the recursion's open threshold + the full inner-circuit map, so a nested
        // sealed-IC inner part (carrying `flatId`) can look up ITS internals and open in turn once it
        // grows large enough on screen. Top level is depth 0, cumulativeScale 1 (the opts defaults).
        internalsZoom: INTERNALS_ZOOM,
        // Live map when the board solved; else the static recursion map so an unpowered placed
        // subassembly still opens its nested sub-ICs (chip-within-chip) down to the leaf devices.
        allInternals: allUserIcInternals ?? this.staticUserIcAll,
        // The screen rect for the A.4 view cull (skip off-screen inner parts so deep zoom into one
        // nested cell doesn't redraw every off-screen sibling's subtree each frame).
        viewport,
        // The HUD zoom-meter probe: records the deepest opened level under the view centre (Phase 5).
        viewProbe,
      });
    } else if (tier !== null && zoom >= TIER_ZOOM) {
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
        // On-screen magnification (px-per-world-px) so a detail drawer can hand off to its
        // silicon leaf when the part grows big enough (Phase 3). At the board level the world
        // scale IS that magnification; `zoom` is already `this.world.scale.x`.
        absScale: zoom,
      };
      // Hide the illustration's own decorative studs on the board — the real pin
      // dots below mark the connections (and avoid the doubled-terminal clutter).
      setStudsVisible(false);
      if (tier === "reality") drawDetail(tg, opts);
      else drawAnalogy(tg, opts);
      setStudsVisible(true);
      tg.scale.set(scale);
      tg.visible = true;
      // (Removed the per-pin pipe stubs that used to bridge each pin into the body — they read as odd
      // translucent "tubes" into every part. The wire conduits already land on the pins via their own
      // port-mouth flare, so the flow still reads continuous into the part without them.)
      this.connectorGlyph.visible = false;
    } else if (isDieFrame(this.kindTag)) {
      // A die frame draws NO body glyph: the die-editor WALLS (drawDieWalls) are its outline and its
      // pin dots (added just below) are the port pads. A generic IC-card rect here would be a second,
      // offset rectangle floating over the build area, occluding the wires + parts inside it.
      this.connectorGlyph.visible = false;
      this.tierGlyph.visible = false;
      // …but DO draw the package's rectangular SOLDER LEADS sticking OUT past each port pad (owner
      // nicety: "would be cool in the builder to see the rectangular traces out from it"). A flat metal
      // tab runs from each pad OUTWARD (away from the build-area centre, perpendicular to its edge), so
      // the frame reads as the real chip you build inside — the external tabs you'll wire to once sealed.
      // EXCEPT a FREE-FORM (box-captured) subassembly: it's a logical grouping, NOT a physical package,
      // so its boundary pins are plain pinout pads (the dots below), no solder tabs (owner round 2).
      const pp = this.pinPositions;
      if (pp.length > 0 && !isFreeFormFrame(this.kindTag)) {
        let lminX = Infinity;
        let lmaxX = -Infinity;
        let lminY = Infinity;
        let lmaxY = -Infinity;
        for (const p of pp) {
          if (p.x < lminX) lminX = p.x;
          if (p.x > lmaxX) lmaxX = p.x;
          if (p.y < lminY) lminY = p.y;
          if (p.y > lmaxY) lmaxY = p.y;
        }
        const leadAlongX = lmaxX - lminX >= lmaxY - lminY;
        const lcx = (lminX + lmaxX) / 2;
        const lcy = (lminY + lmaxY) / 2;
        const LEAD_OUT = PITCH * 1.1; // how far the tab sticks out past the pad
        const LEAD_WID = PITCH * 0.45; // tab width
        for (const p of pp) {
          let rx: number;
          let ry: number;
          let rw: number;
          let rh: number;
          if (leadAlongX) {
            const down = p.y >= lcy; // bottom pads stick down, top pads stick up
            rx = p.x - LEAD_WID / 2;
            rw = LEAD_WID;
            ry = down ? p.y : p.y - LEAD_OUT;
            rh = LEAD_OUT;
          } else {
            const right = p.x >= lcx; // right pads stick right, left pads stick left
            ry = p.y - LEAD_WID / 2;
            rh = LEAD_WID;
            rx = right ? p.x : p.x - LEAD_OUT;
            rw = LEAD_OUT;
          }
          g.rect(rx, ry, rw, rh).fill({ color: 0x9a93b3, alpha: 0.9 });
          g.rect(rx, ry, rw, rh).stroke({
            width: 1,
            color: 0x6f6a8a,
            alpha: 0.8,
          });
        }
      }
    } else {
      this.connectorGlyph.visible = false;
      this.tierGlyph.visible = false;
      drawGlyph(g, {
        kind: this.kindTag,
        pins: this.pinPositions,
        wPx: this.wPx,
        hPx: this.hPx,
        // An LED is tinted by its colour variant (live, so the inspector updates it on the
        // next frame); every other part uses its kind's palette colour.
        color:
          this.kindTag === "LED"
            ? ledTint(this.component.variant ?? 0)
            : this.color,
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
    // pin dots on top (over either the schematic glyph or the tier illustration) — they mark the real
    // connection points the wires meet. A USER IC draws NONE: its pins ARE the outer lead TIPS (the
    // rectangular tabs the package glyph draws sticking out of the body), which are the only visible
    // connection — no round pad, so nothing sits inside the body to overlap the circuit (owner ask).
    if (!isUserIc(this.kindTag)) {
      for (const p of this.pinPositions) {
        g.circle(p.x, p.y, PIN_R + 2).fill({ color: 0x0d0b16, alpha: 1 });
        g.circle(p.x, p.y, PIN_R).fill({ color: this.color });
      }
    }
    // The deepest LOD: a simple pin-name label by each pin (A/K, B/C/E, …), upright
    // at the rotated pin. Only with a tier illustration showing and zoomed in far —
    // EXCEPT a die frame, whose perimeter pins are the port pads being named, so their
    // labels (the package number or the player's name) show at the working die zoom.
    // A sealed USER IC always labels its pins at detail zoom (its pinout IS the player's pad names —
    // "the chip, labelled how you built it"), without needing the zoom-to-open miniature to be open.
    // WIRE mode reveals every pin label on the CURRENT layer regardless of zoom (owner: "wire mode should
    // show all pin labels regardless of zoom level, but only those of the current layer") — these placed
    // nodes ARE the current layer; the recursive zoom-to-open sub-cell labels (userIcInternalsView) are a
    // deeper layer and stay zoom-gated, so they're not forced here.
    // Phase 3 label reveal: a FOCUSED part (hovered / selected) reveals its labels from DETAIL_ZOOM as
    // before; an AMBIENT part holds off until AMBIENT_LABEL_ZOOM so a dense board's overview isn't a wall of
    // overlapping pin names ("the labels aren't aware of their neighbours"). Wire mode + the open replica +
    // the die frame are unchanged (wiring needs every pin; the replica/ die frame label their own pads).
    const labelZoom = focused ? DETAIL_ZOOM : AMBIENT_LABEL_ZOOM;
    // MOSFETs label their D/S/G terminals at the same zoom as a tiered part — schematics flip transistors
    // around constantly, so spelling out which lead is gate/drain/source (owner ask) removes the guesswork.
    const isFet = this.kindTag === "NM" || this.kindTag === "PM";
    const showPins =
      wireMode ||
      (isDieFrame(this.kindTag)
        ? zoom >= TIER_ZOOM
        : showUserIc || // the zoom-to-open replica always labels its edge pins (its 1:1 pinout)
          ((tier !== null ||
            showInternals ||
            isUserIc(this.kindTag) ||
            isFet) &&
            zoom >= labelZoom));
    const lcx = this.wPx / 2;
    const lcy = this.hPx / 2;
    const LABEL_MARGIN = 14; // px the label sits OUTSIDE the body edge (datasheet-style edge mount)
    const LEAD_CLEAR = 7; // px the label slides ALONGSIDE its lead so the trace doesn't pierce the text
    this.pinLabelDeco.clear(); // rebuilt per frame (labels reflow with zoom/rotation)
    for (let i = 0; i < this.pinTexts.length; i++) {
      const t = this.pinTexts[i]!;
      // Park the label at the PACKAGE pin position (the compact footprint edge — spread across the
      // body) so the pinout stays readable. The zoom-to-open replica's own inner pins are the
      // die-editor layout scaled into this small footprint — far too tightly packed to label without
      // the names colliding (a SOT-23 die crushes to a few px), so the label rides the package edge.
      const p = this.pinPositions[i];
      if (showPins && p) {
        // Place the label OUTSIDE the chip and BESIDE its lead, never on top of it, oriented ALONGSIDE the
        // pin. Classify THIS pin's edge from its offset to the footprint centre (a 4-edge chip needs a
        // per-pin decision, not one per-part axis; a perfect corner tie falls back to the part's dominant
        // edge axis): push it outboard on the lead's axis (LABEL_MARGIN) and nudge it sideways off the
        // lead (LEAD_CLEAR). A top/bottom-edge pin (vertical lead) turns its label 90° to run up the lead;
        // a left/right-edge label stays flat. Rotate the offset point with the part so placement tracks
        // rotation/mirror (the text itself lives on the un-rotated `view`).
        const dx = p.x - lcx;
        const dy = p.y - lcy;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const horizontalEdge =
          adx === ady ? !this.labelPushVertical : adx > ady;
        let ox: number;
        let oy: number;
        if (horizontalEdge) {
          ox = dx >= 0 ? LABEL_MARGIN : -LABEL_MARGIN;
          oy = (dy >= 0 ? 1 : -1) * LEAD_CLEAR;
        } else {
          oy = dy >= 0 ? LABEL_MARGIN : -LABEL_MARGIN;
          ox = (dx >= 0 ? 1 : -1) * LEAD_CLEAR;
        }
        // CONSTANT on-screen size + distance past LABEL_CAP_ZOOM (owner: "scale and move after ~×7, stay
        // near the pin"): below it the label rides the camera (natural growth); above, counter-scale BOTH
        // its glyph size AND its pin offset by `cs` so it holds a fixed on-screen size and stays the same
        // small distance from the pin instead of ballooning away. Resolution tracks the capped on-screen
        // scale so the texture stays crisp at any depth (the shared MAX_TEXT_RES cap blurred it past ~×7).
        // WIRE mode adds a LOWER floor (WIRE_LABEL_MIN): a label revealed zoomed-out for wiring counter-
        // scales UP to a readable minimum instead of shrinking with the camera. The two agree at any zoom
        // ≥ WIRE_LABEL_MIN, so toggling wire mode never resizes a label that was already on-screen.
        const capHi = Math.min(zoom, LABEL_CAP_ZOOM);
        const eff = wireMode
          ? Math.max(WIRE_LABEL_MIN, capHi)
          : Math.max(1, capHi);
        const cs = wireMode ? eff / zoom : eff / Math.max(1, zoom);
        const r = rotPx(
          p.x + ox * cs,
          p.y + oy * cs,
          this.component.rot,
          this.component.mirror,
        );
        t.position.set(r.x, r.y);
        t.scale.set(cs);
        t.resolution = DPR * eff;
        // A vertical-lead label runs alongside the lead (−90°, reading bottom-up); an edge label stays
        // flat. (Orientation from the un-rotated edge — correct for an upright chip; a rotated user-IC
        // chip keeps correct PLACEMENT, an accepted edge case for the glyph orientation.)
        t.rotation = horizontalEdge ? 0 : -Math.PI / 2;
        t.visible = true;
        // Deco (owner: connect the name to its pin + lift it off the busy copper). A short LEADER runs
        // from the pin to the label, then a BACKING PLATE (drawn after, so it caps the leader's inner end)
        // sits behind the text. Sized from the string (IBM Plex Mono 9px ≈ 5.4px/char) and counter-scaled
        // by `cs` so it holds a fixed on-screen size like the label; the box swaps W/H for a vertical label.
        const pr = rotPx(p.x, p.y, this.component.rot, this.component.mirror);
        const natW = String(t.text).length * 5.4;
        const bw = (horizontalEdge ? natW : 11) * cs + 6 * cs;
        const bh = (horizontalEdge ? 11 : natW) * cs + 4 * cs;
        this.pinLabelDeco.moveTo(pr.x, pr.y).lineTo(r.x, r.y);
        this.pinLabelDeco.stroke({
          width: Math.max(1, 1.2 * cs),
          color: PALETTE.rail,
          alpha: 0.7,
        });
        this.pinLabelDeco.roundRect(r.x - bw / 2, r.y - bh / 2, bw, bh, 3 * cs);
        this.pinLabelDeco.fill({ color: 0x0d0b16, alpha: 0.82 });
        this.pinLabelDeco.stroke({
          width: Math.max(0.75, cs),
          color: PALETTE.border,
          alpha: 0.55,
        });
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
        const r = rotPx(p.x, p.y, this.component.rot, this.component.mirror);
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
    // THERMAL-DEATH overlay (self-heating past T_MAX_C, Real mode, when NOT already over-current-FAILed —
    // that red box dominates). Two stages, both distinct from the FAIL red; web-side + presentational
    // (only ever a render flag, never the solve):
    //   1. OVERHEAT — a transient pulsing amber/char warning box while the part is still cooking.
    //   2. DESTROYED — sustained over-temp (`vented`) lets the magic smoke out: a steady charred box +
    //      rising smoke puffs, latched for the run (the part is cooked).
    if (real && !electrical.failed && (this.overTemp || this.vented)) {
      let minX = 0;
      let maxX = 0;
      let minY = 0;
      let maxY = 0;
      for (const p of this.pinPositions) {
        const r = rotPx(p.x, p.y, this.component.rot, this.component.mirror);
        minX = Math.min(minX, r.x);
        maxX = Math.max(maxX, r.x);
        minY = Math.min(minY, r.y);
        maxY = Math.max(maxY, r.y);
      }
      const pad = 13;
      const cx = (minX + maxX) / 2;
      this.overheatBox.clear();
      if (this.vented) {
        // Destroyed: a steady, deeply-charred box + smoke + "DESTROYED" (no pulse — it's dead, not alarming).
        this.overheatBox
          .roundRect(
            minX - pad,
            minY - pad,
            maxX - minX + 2 * pad,
            maxY - minY + 2 * pad,
            4,
          )
          .fill({ color: 0x120a05, alpha: 0.72 })
          .stroke({ color: PALETTE.bronze, width: 2, alpha: 0.6 });
        if (this.overheatText.text !== "DESTROYED")
          this.overheatText.text = "DESTROYED";
        this.overheatText.alpha = 0.92;
        this.drawSmoke(cx, minY - pad);
        this.smoke.visible = true;
      } else {
        // Still cooking: a pulsing amber/char scorch box warning the part is over-temp.
        const pulse =
          0.5 +
          0.5 *
            Math.sin((performance.now() / 1000) * Math.PI * 2 * FAIL_PULSE_HZ);
        this.overheatBox
          .roundRect(
            minX - pad,
            minY - pad,
            maxX - minX + 2 * pad,
            maxY - minY + 2 * pad,
            4,
          )
          .fill({ color: 0x1a0d06, alpha: 0.5 })
          .stroke({
            color: PALETTE.warn,
            width: 2,
            alpha: 0.35 + 0.65 * pulse,
          });
        if (this.overheatText.text !== "OVERHEAT")
          this.overheatText.text = "OVERHEAT";
        this.overheatText.alpha = 0.55 + 0.45 * pulse;
        this.smoke.visible = false;
      }
      this.overheatBox.visible = true;
      this.overheatText.position.set(cx, minY - pad - 9);
      this.overheatText.visible = true;
    } else {
      this.overheatBox.visible = false;
      this.overheatText.visible = false;
      this.smoke.visible = false;
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

/**
 * Orient a pixel offset: a horizontal flip (`x → −x`, when `mirror`) applied FIRST, then
 * `rot` 90°-CW steps `(x,y) → (−y,x)`. The pixel-space twin of {@link rotateOffset}, used to
 * place the upright pin labels / FAIL box over the glyph (whose holder uses `scale.x = −1`
 * then `rotation`, the same reflect-before-rotate order). `mirror` defaults false.
 */
function rotPx(
  x: number,
  y: number,
  rot: number,
  mirror = false,
): { x: number; y: number } {
  let rx = mirror ? -x : x;
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
// `voltageColor` (the rail-identity net colour) now lives in `boardRender.ts` so the sealed-IC
// opened view colours its inner wires with the exact same function — imported above.

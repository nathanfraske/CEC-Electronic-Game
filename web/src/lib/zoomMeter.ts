// SPDX-License-Identifier: Apache-2.0
//
// Zoom-meter math (Phase 5 of docs/recursive-ic-lod-plan.md). Turns the camera zoom + the cumulative
// fit-scale of whatever nesting level you're inside into (a) a magnification readout ×M and (b) a
// snapped scale bar whose unit ramps board-cells → mm → µm → nm as you dive toward the silicon. Pure
// functions, render-only — no sim, nothing hashed. The board feeds `zoom` (= world.scale.x) and
// `viewScale` (1 on the open board; the product of the fit-scales you've descended through once inside
// nested ICs — recorded by the renderer at the view centre, so it stays honest at any depth).

import { PITCH } from "./boardRender";

/** THE physical anchor for the whole scale: one TOP-LEVEL board cell (PITCH world px) is this many
 * millimetres. 2.5 mm ≈ the 0.1" (2.54 mm) breadboard / DIP pin pitch — the universal electronics grid
 * — so the board reads at bench scale (a 4-cell resistor ≈ 10 mm, a DIP-8 ≈ 10×5 mm). Everything metric
 * hangs off this: as you open ICs the current level's cell is `viewScale` times smaller (viewScale = ∏
 * of the fit-scales you've descended through), so the same screen length crosses mm → µm → nm decade by
 * decade. Tunable: it sets only where the unit boundaries fall, never the rendered geometry. */
export const MM_PER_TOP_CELL = 2.5;

/** The idealized SMALLEST feature the scale rule will ever claim — a process-node FLOOR (default 100 nm, a
 * legible "classic" node; NOT cutting-edge). The recursive bake-and-nest zoom multiplies the fit-scale
 * every level you descend, so the implied feature size would otherwise fall below a nanometre and keep
 * going (a CPU nested ~8 deep → 0.01 nm transistors). The rule clamps here and then just WIDENS on screen
 * as you keep zooming — the node getting bigger — instead of reporting impossible sizes. Tunable: bump it
 * for a chunkier (older-node) feel, drop it toward 7 nm for modern silicon. Render-only; sets only the
 * floor of the readout, never the rendered geometry or the simulation. */
export const MIN_FEATURE_MM = 1e-4;

const EPS = 1e-12;

/** Physical millimetres represented by one SCREEN pixel at the current view. One world cell = PITCH
 * world px stands for `MM_PER_TOP_CELL · viewScale` mm, and `zoom` is screen px per world px, so
 * mm/screenpx = MM_PER_TOP_CELL · viewScale / (PITCH · zoom). */
export function mmPerScreenPx(zoom: number, viewScale: number): number {
  return (MM_PER_TOP_CELL * viewScale) / (PITCH * Math.max(zoom, EPS));
}

/** On-screen magnification ×M relative to the default world-scale view (zoom 1 on the open board):
 * `M = zoom / viewScale`. Grows as you zoom in (zoom↑) and as you descend into shrunk nested levels
 * (viewScale↓), so "×6" then "×900" reads how deep you are. */
export function magnification(zoom: number, viewScale: number): number {
  return Math.max(zoom, EPS) / Math.max(viewScale, EPS);
}

/** Snap a positive length DOWN to the nearest "nice" 1 / 2 / 5 × 10^k (a map / micrograph scale-bar
 * rule), so the bar always reads a round number. Returns 0 for a non-positive / non-finite input. */
export function niceLength(len: number): number {
  if (!(len > 0) || !Number.isFinite(len)) return 0;
  const pow = Math.pow(10, Math.floor(Math.log10(len)));
  const mantissa = len / pow; // 1 .. <10
  const snapped = mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1;
  return snapped * pow;
}

/** Render a magnitude as a tidy string: integers print bare, otherwise up to 2 decimals trimmed of
 * trailing zeros. Inputs here are always 1 / 2 / 5 × 10^k, so this stays clean. */
function fmtNum(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/** Format a physical length given in MILLIMETRES with the tier-appropriate unit (m / mm / µm / nm).
 * Each unit holds DOWN to 0.1 of itself (so the bar reads `1 mm → 0.5 mm → 0.2 mm → 0.1 mm → 50 µm`,
 * monotonically smaller) rather than flipping units at 1 — which made `1 mm → 0.5 mm` render as
 * `1 → 500 µm` and look like the gauge jumped UP as you zoomed in. */
export function formatMm(mm: number): string {
  const abs = Math.abs(mm);
  if (abs >= 1000) return `${fmtNum(mm / 1000)} m`;
  if (abs >= 0.1) return `${fmtNum(mm)} mm`;
  if (abs >= 1e-4) return `${fmtNum(mm * 1e3)} µm`;
  return `${fmtNum(mm * 1e6)} nm`;
}

/** Format a magnification ×M compactly: ×2.5, ×42, ×1.2k, ×3M. */
export function formatMag(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return "×1";
  if (m >= 1e6) return `×${fmtNum(m / 1e6)}M`;
  if (m >= 1e3) return `×${fmtNum(m / 1e3)}k`;
  if (m >= 10) return `×${Math.round(m)}`;
  return `×${fmtNum(m)}`;
}

export interface ScaleBar {
  /** Width of the bar in SCREEN px (already snapped to the nice length). */
  px: number;
  /** The bar's metric label, e.g. "5 mm", "200 µm", "10 nm". */
  label: string;
}

/** Build the scale bar: aim for ~`targetPx` screen px, snap the length to a nice 1 / 2 / 5 value, and
 * return the snapped bar's pixel width + label. Always METRIC, anchored on one board cell =
 * {@link MM_PER_TOP_CELL} mm: the open board reads in mm, then µm → nm as you dive into nested ICs. */
export function scaleBar(
  zoom: number,
  viewScale: number,
  targetPx = 90,
): ScaleBar {
  const mmpp = mmPerScreenPx(zoom, viewScale);
  // Clamp the bar's physical length at the process-node floor (see MIN_FEATURE_MM): below it the rule
  // stops shrinking and reads the floor (e.g. "0.1 µm") instead of "0.01 nm". Above the floor the snapped
  // length is ≤ the target px; once floored it would widen without bound (floor / mmpp), so cap the drawn
  // bar at 2× the target — it grows a touch (the node getting bigger) then holds, never overflowing.
  const niceMm = Math.max(niceLength(targetPx * mmpp) || mmpp, MIN_FEATURE_MM);
  return { px: Math.min(niceMm / mmpp, targetPx * 2), label: formatMm(niceMm) };
}

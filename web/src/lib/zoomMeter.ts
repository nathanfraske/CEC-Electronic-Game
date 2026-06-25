// SPDX-License-Identifier: Apache-2.0
//
// Zoom-meter math (Phase 5 of docs/recursive-ic-lod-plan.md). Turns the camera zoom + the cumulative
// fit-scale of whatever nesting level you're inside into (a) a magnification readout ×M and (b) a
// snapped scale bar whose unit ramps board-cells → mm → µm → nm as you dive toward the silicon. Pure
// functions, render-only — no sim, nothing hashed. The board feeds `zoom` (= world.scale.x) and
// `viewScale` (1 on the open board; the product of the fit-scales you've descended through once inside
// nested ICs — recorded by the renderer at the view centre, so it stays honest at any depth).

import { PITCH } from "./boardRender";

/** Teaching anchor: the physical size one TOP-LEVEL board cell (PITCH world px) stands for. A real
 * 0.1" component pitch is 2.54 mm; this single calibration is what the whole physical ramp hangs off.
 * As you open ICs the current level's cell is `viewScale` times smaller (viewScale = ∏ of the fit
 * scales you've descended through), so the same screen length crosses mm → µm → nm decade by decade.
 * Tunable: it sets only where the unit boundaries fall, never the rendered geometry. */
export const MM_PER_TOP_CELL = 2.54;

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

/** Format a physical length given in MILLIMETRES with the tier-appropriate unit (m / mm / µm / nm). */
export function formatMm(mm: number): string {
  const abs = Math.abs(mm);
  if (abs >= 1000) return `${fmtNum(mm / 1000)} m`;
  if (abs >= 1) return `${fmtNum(mm)} mm`;
  if (abs >= 1e-3) return `${fmtNum(mm * 1e3)} µm`;
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
  /** The bar's label, e.g. "5 cells", "2 mm", "200 µm", "10 nm". */
  label: string;
  /** True on the open board (abstract board cells); false once inside an IC (physical units). */
  cells: boolean;
}

/** Build the scale bar: aim for ~`targetPx` screen px, snap the length to a nice 1 / 2 / 5 value, and
 * return the snapped bar's pixel width + label. On the open board (viewScale ≥ 1) the unit is abstract
 * board CELLS; once inside an IC (viewScale < 1) it's physical mm → µm → nm. */
export function scaleBar(
  zoom: number,
  viewScale: number,
  targetPx = 90,
): ScaleBar {
  if (viewScale >= 1) {
    // Top board: a cell is the natural unit. cellPx = screen px per board cell.
    const cellPx = PITCH * Math.max(zoom, EPS);
    const cells = niceLength(targetPx / cellPx) || 1;
    return {
      px: cells * cellPx,
      label: cells === 1 ? "1 cell" : `${fmtNum(cells)} cells`,
      cells: true,
    };
  }
  const mmpp = mmPerScreenPx(zoom, viewScale);
  const niceMm = niceLength(targetPx * mmpp) || mmpp; // guard a degenerate view
  return { px: niceMm / mmpp, label: formatMm(niceMm), cells: false };
}

// SPDX-License-Identifier: Apache-2.0
// A coarse 2D heat FIELD over the board, for the thermal-lens overlay (the "see the whole power budget"
// view). Hot parts inject heat at their grid cell; it DIFFUSES laterally across the board each step (so
// you watch it spread, not just glow per-part) and convects back toward still-air ambient. Rendered as
// an inferno heatmap behind the components (which stay distinct on top).
//
// Pure + deterministic + tick-driven: the field is advanced by the elapsed SIM time (Δticks·DT, never
// wall-clock), so its trajectory is a function of the per-part Tj history — replay-safe, and golden-safe
// (presentation only, never re-enters the solve). The per-part Tj already lives in the renderer; this
// just spreads it into a field. See docs/heat-on-the-board-ideation.md (§1 option B, the thermal lens).

import { T_AMBIENT_C } from "./thermal";

/** A heat source on the grid: a hot part pins its cell toward `tempC` (its body temperature). */
export interface FieldSource {
  col: number;
  row: number;
  tempC: number;
}

// Diffusivity (cells²/s, game-scaled) — how fast heat spreads across the board. Convection (1/s) — how
// fast a cell relaxes back to ambient in still air. Tuned so heat from a sustained source spreads a few
// cells and pools over ~seconds, matching the per-part Tj timescale.
const DIFFUSIVITY = 9.0;
const CONVECTION = 0.45;
// Per-step explicit-diffusion stability cap (2D): the relaxation factor must stay ≤ 0.25.
const MAX_ALPHA = 0.22;

export class ThermalField {
  readonly cols: number;
  readonly rows: number;
  private temp: Float32Array;
  private scratch: Float32Array;
  private ambient: number;

  constructor(cols: number, rows: number, ambientC = T_AMBIENT_C) {
    this.cols = Math.max(1, Math.floor(cols));
    this.rows = Math.max(1, Math.floor(rows));
    this.ambient = ambientC;
    this.temp = new Float32Array(this.cols * this.rows).fill(ambientC);
    this.scratch = new Float32Array(this.cols * this.rows);
  }

  /** Reset every cell to ambient (on a sim restart / netlist rebuild). */
  reset(ambientC = this.ambient): void {
    this.ambient = ambientC;
    this.temp.fill(ambientC);
  }

  /** The temperature (°C) at a grid cell (clamped to the grid). */
  at(col: number, row: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, col | 0));
    const r = Math.min(this.rows - 1, Math.max(0, row | 0));
    return this.temp[r * this.cols + c]!;
  }

  /** The hottest cell in the field — drives the legend / colour-scale peak. */
  peak(): number {
    let m = this.ambient;
    for (let i = 0; i < this.temp.length; i++)
      if (this.temp[i]! > m) m = this.temp[i]!;
    return m;
  }

  /**
   * Advance the field by `dtSeconds` of sim time. Each step: (1) pin every source cell to at least its
   * part's temperature (the part is a heat source held at its body temp); (2) diffuse laterally (an
   * explicit 5-point relaxation, sub-stepped so a large dt stays stable); (3) convect toward ambient.
   * `dtSeconds ≤ 0` (paused / scrubbing back) is a no-op.
   */
  step(sources: FieldSource[], dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    // Sub-step the diffusion so the per-step relaxation factor stays within the stability cap regardless
    // of dt (deterministic: the sub-step count is a pure function of dt).
    const want = DIFFUSIVITY * dtSeconds;
    const subSteps = Math.max(1, Math.ceil(want / MAX_ALPHA));
    const alpha = want / subSteps;
    const conv = 1 - Math.exp(-CONVECTION * (dtSeconds / subSteps));
    const { cols, rows, temp, scratch, ambient } = this;
    for (let s = 0; s < subSteps; s++) {
      // Re-pin sources each sub-step: a hot part is a HELD-temperature boundary, so its cell stays at its
      // body temperature throughout — it delivers whatever heat the diffusion+convection drains. (max so
      // two parts on one cell don't cancel; a part only ever heats its cell.)
      for (const src of sources) {
        if (src.tempC <= ambient) continue;
        const c = Math.min(cols - 1, Math.max(0, src.col | 0));
        const r = Math.min(rows - 1, Math.max(0, src.row | 0));
        const i = r * cols + c;
        if (src.tempC > temp[i]!) temp[i] = src.tempC;
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const v = temp[i]!;
          // Neighbour sum with reflective (insulated) edges — a board with no case loses heat only to
          // air (the convection term), not off its edges.
          const l = c > 0 ? temp[i - 1]! : v;
          const rt = c < cols - 1 ? temp[i + 1]! : v;
          const up = r > 0 ? temp[i - cols]! : v;
          const dn = r < rows - 1 ? temp[i + cols]! : v;
          const diffused = v + alpha * (l + rt + up + dn - 4 * v);
          scratch[i] = diffused + (ambient - diffused) * conv;
        }
      }
      temp.set(scratch);
    }
  }

  /**
   * Write the field into an RGBA buffer (`cols*rows*4`, row-major) using the **inferno** colourmap —
   * black → purple → red → orange → yellow-white as a cell heats. `peakC` sets the top of the scale
   * (cells at/above it read white-hot); ambient reads fully transparent so a cold board shows nothing.
   */
  writeImage(rgba: Uint8ClampedArray, peakC: number): void {
    const span = Math.max(1, peakC - this.ambient);
    for (let i = 0; i < this.temp.length; i++) {
      const f = (this.temp[i]! - this.ambient) / span;
      const [r, g, b, a] = infernoRGBA(f);
      const o = i * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = a;
    }
  }
}

// The inferno colourmap (matplotlib), as a small stop table — the standard heatmap and what fine
// electro-thermal solvers use. Alpha ramps in from 0 at ambient so cold areas are see-through.
const INFERNO: [number, number, number][] = [
  [0x00, 0x00, 0x04], // 0.0 near-black
  [0x1f, 0x0c, 0x48], // 0.17 deep indigo
  [0x55, 0x0f, 0x6d], // 0.33 purple
  [0x88, 0x22, 0x6a], // 0.5 magenta-red
  [0xba, 0x36, 0x55], // 0.6 red
  [0xe3, 0x55, 0x33], // 0.72 orange-red
  [0xf9, 0x7d, 0x16], // 0.83 orange
  [0xfc, 0xb5, 0x19], // 0.92 amber
  [0xf5, 0xf2, 0x6c], // 1.0 pale yellow
  [0xff, 0xff, 0xe0], // >1 white-hot
];

/** Inferno colour + alpha for a normalised heat value `f` (0 = ambient → transparent, 1 = peak). */
function infernoRGBA(f: number): [number, number, number, number] {
  const t = Math.min(1, Math.max(0, f));
  const n = INFERNO.length - 1;
  const x = t * n;
  const i = Math.min(n - 1, Math.floor(x));
  const k = x - i;
  const a = INFERNO[i]!;
  const b = INFERNO[i + 1]!;
  const r = Math.round(a[0] + (b[0] - a[0]) * k);
  const g = Math.round(a[1] + (b[1] - a[1]) * k);
  const bl = Math.round(a[2] + (b[2] - a[2]) * k);
  // Fade the overlay in over the first slice of the range so a barely-warm board stays subtle.
  const alpha = Math.round(255 * Math.min(1, t / 0.12) * 0.85);
  return [r, g, bl, alpha];
}

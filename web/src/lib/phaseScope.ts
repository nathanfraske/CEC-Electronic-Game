// SPDX-License-Identifier: Apache-2.0
// Canvas2D phase-domain scope. Plots each non-ground node's steady-state AC waveform over ONE
// cycle versus PHASE (0…2π), reconstructed from the complex node voltage at a single analysis
// frequency (`Sim::ac_solve` via `acSweep` at one frequency). Because it is drawn against phase
// rather than time, it is stable and legible at ANY frequency — including the MHz where PSU
// switching lives and the fixed 2 µs transient step can't reach (`ac_solve` is analytic, no
// Nyquist limit). The relative phase between nodes — a filter's input vs its lagging output —
// reads directly, the unrolled companion to the phasor inset. Pure presentation: it draws a flat
// `[re, im]`-per-non-ground-node buffer (one frequency's worth of the Bode sweep); no sim work.

export interface PhaseScopeOpts {
  /** Total node count including ground (node 0); non-ground nodes are 1..nodeCount-1. */
  nodeCount: number;
  /** Trace colour for a 1-based node index (matches the scope/Bode channel colours). */
  color: (node: number) => string;
  /** Whether to draw a given 1-based node (mirrors the scope's per-node visibility). */
  visible: (node: number) => boolean;
  /** Analysis frequency (Hz) — the dominant source frequency; shown in the corner label. */
  freq: number;
  /** Play-head phase θ ∈ [0, 2π): a cosmetic sweep on the bounded frame clock. */
  playhead: number;
}

const BG = "#0b0e15";
const GRID = "#241f38";
const GRID_HI = "#322b4e";
const AXIS = "#6f6790";
const HEAD = "#d8a24a"; // the +12V rail amber — reads as the live cursor

/** Compact Hz label: 1, 10, 100, 1k, 100k, 1M, 10M … */
function fmtHz(f: number): string {
  if (f >= 1e6) return `${+(f / 1e6).toFixed(2)}M`;
  if (f >= 1e3) return `${+(f / 1e3).toFixed(2)}k`;
  return `${+f.toFixed(1)}`;
}

/**
 * Draw the phase scope into a `ctx` of CSS size `w`×`h` (DPR-scaled by the caller). `data` is
 * one frequency's slice of the AC-sweep boundary buffer: `2·(nodeCount−1)` floats, `[re, im]`
 * per non-ground node (node `k≥1` at slot `k−1`). Each node's waveform is
 * `v(θ) = re·cos θ − im·sin θ` (= |V|·cos(θ+φ)), auto-scaled so the biggest swing fills the
 * window; the relative phase between traces is the lesson.
 */
export function drawPhaseScope(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  data: Float64Array,
  o: PhaseScopeOpts,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  ctx.font = "9px 'IBM Plex Mono', monospace";
  ctx.textBaseline = "middle";

  const nu = o.nodeCount - 1; // non-ground nodes
  if (nu <= 0 || data.length < nu * 2) {
    ctx.fillStyle = AXIS;
    ctx.textAlign = "center";
    ctx.fillText("place an AC or pulse source", w / 2, h / 2);
    return;
  }

  const padL = 30;
  const padR = 8;
  const padT = 14;
  const padB = 16;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const midY = padT + plotH / 2;
  const x0 = padL;
  const xAt = (theta: number): number => x0 + (theta / (2 * Math.PI)) * plotW;

  // Peak amplitude across the visible nodes sets the vertical scale (so the biggest swing
  // fills ~90% of the half-height); a flat/no-response circuit just shows the zero line.
  let peak = 0;
  for (let k = 1; k <= nu; k++) {
    if (!o.visible(k)) continue;
    const re = data[(k - 1) * 2] ?? 0;
    const im = data[(k - 1) * 2 + 1] ?? 0;
    peak = Math.max(peak, Math.hypot(re, im));
  }
  const scale = peak > 1e-12 ? (plotH / 2) * 0.9 : 0;

  // Phase grid: verticals at 0, π/2, π, 3π/2, 2π; the zero (mid) line.
  ctx.lineWidth = 1;
  for (let q = 0; q <= 4; q++) {
    const x = x0 + (q / 4) * plotW;
    ctx.strokeStyle = q === 0 || q === 4 ? GRID_HI : GRID;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
  }
  ctx.strokeStyle = GRID_HI;
  ctx.beginPath();
  ctx.moveTo(x0, midY);
  ctx.lineTo(x0 + plotW, midY);
  ctx.stroke();

  // Axis labels: phase across the bottom, the analysis frequency in the corner.
  ctx.fillStyle = AXIS;
  ctx.textAlign = "center";
  ctx.fillText("0", x0, h - padB / 2);
  ctx.fillText("π", x0 + plotW / 2, h - padB / 2);
  ctx.fillText("2π", x0 + plotW, h - padB / 2);
  ctx.textAlign = "left";
  ctx.fillText("V", 4, midY);
  ctx.textAlign = "right";
  ctx.fillStyle = HEAD;
  ctx.fillText(`@ ${fmtHz(o.freq)}Hz`, w - padR, padT / 2);

  if (scale === 0) return; // no AC response to draw (DC / open)

  // Each visible node: v(θ) = re·cos θ − im·sin θ across the cycle.
  const SEG = 96;
  for (let k = 1; k <= nu; k++) {
    if (!o.visible(k)) continue;
    const re = data[(k - 1) * 2] ?? 0;
    const im = data[(k - 1) * 2 + 1] ?? 0;
    ctx.strokeStyle = o.color(k);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let s = 0; s <= SEG; s++) {
      const theta = (s / SEG) * 2 * Math.PI;
      const v = re * Math.cos(theta) - im * Math.sin(theta);
      const x = xAt(theta);
      const y = midY - (v / peak) * scale;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // A dot at the play-head marks the instantaneous value, so the cursor reads each trace.
    const vh = re * Math.cos(o.playhead) - im * Math.sin(o.playhead);
    ctx.fillStyle = o.color(k);
    ctx.beginPath();
    ctx.arc(xAt(o.playhead), midY - (vh / peak) * scale, 2.2, 0, 2 * Math.PI);
    ctx.fill();
  }

  // The play-head: a vertical cursor sweeping the phase on the bounded frame clock.
  const hx = xAt(o.playhead % (2 * Math.PI));
  ctx.strokeStyle = HEAD;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(hx, padT);
  ctx.lineTo(hx, padT + plotH);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

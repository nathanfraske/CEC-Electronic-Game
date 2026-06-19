// SPDX-License-Identifier: Apache-2.0
// Canvas2D Bode plotter for the frequency-domain AC sweep (`Sim::ac_sweep` via the wasm
// `acSweep`). Plots each non-ground node's response magnitude (dBV = 20·log10|V|) against
// a log-frequency axis, so a part's reactance corner / a filter's −3 dB knee / an LC
// resonance peak read at a glance — the frequencies the 2 µs transient step can't reach.
// Pure presentation: it draws a flat `[re, im]`-per-node-per-frequency buffer; no sim or
// boundary work here. Dark bench-instrument palette (mirrors app.css tokens as hex).

export interface BodeOpts {
  /** Swept frequencies (Hz), ascending — typically log-spaced. */
  freqs: number[];
  /** Total node count including ground (node 0); non-ground nodes are 1..nodeCount-1. */
  nodeCount: number;
  /** Trace colour for a 1-based node index (matches the scope channel colours). */
  color: (node: number) => string;
  /** Whether to draw a given 1-based node (mirrors the scope's per-node visibility). */
  visible: (node: number) => boolean;
}

const BG = "#0b0e15";
const GRID = "#241f38";
const GRID_HI = "#322b4e";
const AXIS = "#6f6790";
const DB_SPAN = 80; // dB shown below the top of the window

/** Compact Hz label: 1, 10, 100, 1k, 100k, 1M, 10M … */
function fmtHz(f: number): string {
  if (f >= 1e6) return `${f / 1e6}M`;
  if (f >= 1e3) return `${f / 1e3}k`;
  return `${f}`;
}

/**
 * Draw the Bode magnitude plot into a `ctx` of CSS size `w`×`h` (DPR-scaled by the
 * caller). `sweep` is the flat boundary buffer: a block of `2·(nodeCount−1)` floats per
 * frequency, `[re, im]` per non-ground node (node `k≥1` at slot `k−1`), in `freqs` order.
 */
export function drawBode(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sweep: Float64Array,
  o: BodeOpts,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  const nu = o.nodeCount - 1; // non-ground nodes
  const np = o.freqs.length;
  ctx.font = "9px 'IBM Plex Mono', monospace";
  ctx.textBaseline = "middle";
  if (nu <= 0 || np < 2 || sweep.length < np * nu * 2) {
    ctx.fillStyle = AXIS;
    ctx.textAlign = "center";
    ctx.fillText("place an AC source to sweep", w / 2, h / 2);
    return;
  }

  const padL = 30;
  const padR = 8;
  const padT = 8;
  const padB = 16;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const dbAt = (j: number, k: number): number => {
    const base = (k * nu + j) * 2;
    return 20 * Math.log10(Math.hypot(sweep[base]!, sweep[base + 1]!) + 1e-12);
  };

  // Auto-scale the dB window to the data top (≈ the source level), showing DB_SPAN below.
  let maxDb = -Infinity;
  for (let j = 0; j < nu; j++) {
    if (!o.visible(j + 1)) continue;
    for (let k = 0; k < np; k++) maxDb = Math.max(maxDb, dbAt(j, k));
  }
  if (!Number.isFinite(maxDb)) maxDb = 0;
  const top = Math.ceil(maxDb / 10) * 10;
  const bot = top - DB_SPAN;

  const lx0 = Math.log10(o.freqs[0]!);
  const lx1 = Math.log10(o.freqs[np - 1]!);
  const xAt = (f: number): number =>
    padL + ((Math.log10(f) - lx0) / (lx1 - lx0)) * plotW;
  const yAt = (db: number): number =>
    padT + (1 - (Math.max(bot, Math.min(top, db)) - bot) / DB_SPAN) * plotH;

  // Decade gridlines + Hz labels.
  ctx.textAlign = "center";
  for (let e = Math.ceil(lx0); e <= Math.floor(lx1); e++) {
    const x = xAt(10 ** e);
    ctx.strokeStyle = GRID_HI;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillStyle = AXIS;
    ctx.fillText(fmtHz(10 ** e), x, h - padB / 2 + 1);
  }
  // Horizontal dB lines every 20 dB.
  ctx.textAlign = "right";
  for (let db = Math.ceil(bot / 20) * 20; db <= top; db += 20) {
    const y = yAt(db);
    ctx.strokeStyle = db === top ? GRID_HI : GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillStyle = AXIS;
    ctx.fillText(`${db}`, padL - 4, y);
  }

  // One trace per visible non-ground node.
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  for (let j = 0; j < nu; j++) {
    if (!o.visible(j + 1)) continue;
    ctx.strokeStyle = o.color(j + 1);
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    for (let k = 0; k < np; k++) {
      const x = xAt(o.freqs[k]!);
      const y = yAt(dbAt(j, k));
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Log-spaced frequency list (Hz), `points` entries from `fMin` to `fMax` inclusive. */
export function logFreqs(fMin: number, fMax: number, points: number): number[] {
  const a = Math.log10(fMin);
  const b = Math.log10(fMax);
  const out = new Array<number>(points);
  for (let i = 0; i < points; i++)
    out[i] = 10 ** (a + ((b - a) * i) / (points - 1));
  return out;
}

// SPDX-License-Identifier: Apache-2.0
// A lightweight Canvas2D twin of tierKit's `phasorInset` (the PixiJS one), for the
// floating inspector HUD where spinning up a Pixi Application per part would be
// wasteful. Same picture and discipline (docs/ui/high-frequency-render.md): a dial
// with V (warm) + I (cyan) arrows, a filled phase arc, and a decaying-alpha phosphor
// afterglow on the I tip; lengths ride the AC amplitudes, the angle between them is the
// measured V–I phase. Frequency-agnostic cosmetic spin on the bounded `phase`; magnitude
// never rides speed. Pure presentation — reads only an AcReadout + the phase clock.

import type { AcReadout } from "./glyphs";

const V_COLOR = "#d8a24a"; // warm rail tone for voltage
const I_COLOR = "#46d2e6"; // cyan for current
// Phase-wedge tint names the reactance at a glance: amber when the current LAGS
// (inductive), violet when it LEADS (capacitive), grey when ~in-phase (resistive).
const LAG_COLOR = "#d8a24a";
const LEAD_COLOR = "#9a78ff";
const FLAT_COLOR = "#6b6488";
const PHASOR_SPIN = 1.1; // cosmetic dial rotation per unit bounded phase
const TRAIL = 7; // phosphor samples behind the I tip
const TRAIL_DANG = 0.17; // angular spacing of the trail (rad)
const V_SCALE = 6; // ~6 V reads as a strong arrow
const CUR_SCALE = 0.02; // ~20 mA reads as a strong arrow

/** Saturating normalize → 0..1 with a soft knee at `scale` (mirrors tierKit.norm). */
function norm(x: number, scale: number): number {
  const a = Math.abs(x) / scale;
  return a / (1 + a);
}

function arrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ang: number,
  len: number,
  width: number,
  hue: string,
): void {
  const tx = cx + Math.cos(ang) * len;
  const ty = cy + Math.sin(ang) * len;
  ctx.strokeStyle = hue;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  const head = Math.min(7, len * 0.32);
  for (const s of [-1, 1]) {
    const ha = ang + Math.PI + s * 0.42;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + Math.cos(ha) * head, ty + Math.sin(ha) * head);
    ctx.stroke();
  }
}

/**
 * Draw the phasor into a `ctx` of CSS size `w`×`h` (already DPR-scaled by the caller).
 * `ac` is the part's last-cycle AC measurement; `phase` is the board's bounded flow
 * clock (so it pauses / reverses with playback). Clears its own area.
 */
export function drawPhasor2D(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ac: AcReadout,
  phase: number,
): void {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 4;
  if (radius <= 2) return;

  // Dial: filled bezel + tick ring.
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = "#0c0f16";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = "#2a2440";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.strokeStyle = "#3a3358";
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.75;
  for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    ctx.beginPath();
    ctx.moveTo(
      cx + Math.cos(a) * radius * 0.86,
      cy + Math.sin(a) * radius * 0.86,
    );
    ctx.lineTo(
      cx + Math.cos(a) * radius * 0.98,
      cy + Math.sin(a) * radius * 0.98,
    );
    ctx.stroke();
  }

  const vlen = radius * (0.34 + 0.6 * norm(ac.vamp, V_SCALE));
  const ilen = radius * (0.34 + 0.6 * norm(ac.iamp, CUR_SCALE));
  const spin = phase * PHASOR_SPIN;
  const thV = spin;
  const thI = spin - ac.phase; // I lags V by the measured phase

  // Phase arc (the V→I wedge), shortest sweep.
  let d = thI - thV;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const arcR = radius * 0.3;
  ctx.globalAlpha = 0.26;
  ctx.fillStyle =
    Math.abs(ac.phase) < 0.06
      ? FLAT_COLOR
      : ac.phase < 0
        ? LEAD_COLOR
        : LAG_COLOR;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, arcR, thV, thV + d, d < 0);
  ctx.closePath();
  ctx.fill();

  // Phosphor afterglow: the I tip's recent positions, decaying alpha (a pure function
  // of the bounded phase, so it rewinds with the clock).
  ctx.fillStyle = I_COLOR;
  for (let k = TRAIL; k >= 1; k--) {
    const th = thI - k * TRAIL_DANG;
    ctx.globalAlpha = 0.5 * (1 - k / (TRAIL + 1));
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(th) * ilen,
      cy + Math.sin(th) * ilen,
      1.8,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  arrow(ctx, cx, cy, thV, vlen, 2.2, V_COLOR);
  arrow(ctx, cx, cy, thI, ilen, 2.2, I_COLOR);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#bfb8d8";
  ctx.beginPath();
  ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
  ctx.fill();
}

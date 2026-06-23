// SPDX-License-Identifier: Apache-2.0
// Draw the LIVE inner circuit of a sealed USER IC — the "zoom-to-open" mini-board (the owner's
// "show a miniature version of your exact circuit inside, scaled properly"). Unlike a built-in
// composite (drawn as a generic grid by `internalsView.ts`), a user IC reveals the *authored*
// schematic: the real component glyphs at the positions the player drew them, plus the authored
// wires, shrunk to fit the chip footprint and animated from the SAME per-frame snapshot the board
// already reads — node voltages colour the wires by level and the flow clock pulses carriers along.
//
// Self-contained and render-only. The inner parts each draw their REAL glyph (`drawGlyph`) into a
// pooled child Graphics scaled onto the footprint, so the drawers' fixed-pixel detail stays in
// proportion (the same render-big-then-scale trick the tier illustration uses). Wires, node dots and
// the external-pin anchors are drawn straight into the passed Graphics. No new simulation, no
// hashing — the seal is purely a drawing over the same netlist (ADR 0005 "seal-as-same-netlist").
import { Container, Graphics } from "pixi.js";
import { PALETTE, PART_KINDS, rotateOffset } from "./graph";
import { drawGlyph, ZERO_ELECTRICAL, type ElectricalState } from "./glyphs";
import type { UserIcInternals } from "./netlist";

/** Grid pitch in pixels — mirrors `PITCH` in board.ts (the cell size everything snaps to). The
 * authored inner circuit lives on the same grid, so its cell extent × this is its pixel extent. */
const PITCH = 26;

/** Linear blend of two PIXI hex ints, t in [0,1]. (Mirrors `internalsView.mix` / `tierKit.mix` — a
 * tiny local copy keeps this view self-contained.) */
function mix(a: number, b: number, t: number): number {
  t = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (
    ((Math.round(ar + (br - ar) * t) << 16) |
      (Math.round(ag + (bg - ag) * t) << 8) |
      Math.round(ab + (bb - ab) * t)) >>>
    0
  );
}

export interface UserIcInternalsOpts {
  internals: UserIcInternals;
  /** node voltages, indexed by node number (the sim snapshot's `state`). */
  nodeV: Float64Array;
  /** footprint pin positions (glyph-local px), by external pin index. */
  pins: { x: number; y: number }[];
  wPx: number;
  hPx: number;
  /** the board's bounded flow clock, for animating carriers along the wires. */
  phase: number;
  /** the live-signal "hot" colour, skinned by lens (analogy water vs reality electron). */
  accent: number;
  /**
   * A persistent container (added under the instance's rotated glyph holder) into which the inner
   * parts' real glyphs are drawn. The view pools one child {@link Graphics} per part here and reuses
   * them across frames, so the immediate-mode `g` (cleared every frame) only carries the wires/dots
   * while the parts keep their own scaled transforms. The caller owns it (visibility, teardown).
   */
  partLayer: Container;
}

/**
 * Draw the live authored inner circuit into `g` (glyph-local coordinates) scaled into the chip
 * footprint. The inner parts' glyphs go into `opts.partLayer` (pooled, scaled); the wires, node dots
 * and external-pin anchors are drawn into `g`. Returns nothing.
 */
export function drawUserIcInternals(g: Graphics, o: UserIcInternalsOpts): void {
  const { internals, nodeV, pins, wPx, hPx, phase, accent, partLayer } = o;
  const { parts, wires, pinNodes, bbox, gndNode } = internals;

  // Pool: one child Graphics per inner part, reused across frames (cleared, not recreated). Shrink
  // the pool if the netlist now has fewer parts (e.g. a different IC under the cursor).
  while (partLayer.children.length < parts.length) {
    partLayer.addChild(new Graphics());
  }
  for (let i = partLayer.children.length - 1; i >= parts.length; i--) {
    partLayer.removeChildAt(i).destroy();
  }
  if (parts.length === 0 && wires.length === 0) {
    partLayer.visible = false;
    return;
  }
  partLayer.visible = true;

  // Authored extent (cells) → pixels. Fit it into the footprint with an inset margin, centred, at a
  // single uniform scale so the schematic keeps its drawn aspect ratio (the owner's "exact circuit").
  const cellsW = Math.max(1, bbox.maxCol - bbox.minCol);
  const cellsH = Math.max(1, bbox.maxRow - bbox.minRow);
  const srcW = cellsW * PITCH;
  const srcH = cellsH * PITCH;
  const insetX = wPx * 0.16 + 6;
  const insetY = hPx * 0.16 + 6;
  const dstW = Math.max(1, wPx - 2 * insetX);
  const dstH = Math.max(1, hPx - 2 * insetY);
  const scale = Math.min(dstW / srcW, dstH / srcH);
  // Centre the scaled drawing in the footprint.
  const offX = (wPx - srcW * scale) / 2;
  const offY = (hPx - srcH * scale) / 2;
  // Authored cell (col,row) → footprint pixel.
  const toPx = (col: number, row: number): { x: number; y: number } => ({
    x: offX + (col - bbox.minCol) * PITCH * scale,
    y: offY + (row - bbox.minRow) * PITCH * scale,
  });

  // Voltage "level" normalisation: low reference = the inner GND net; rail = the peak swing among
  // every touched net (so a 5 V logic IC and a ±12 V analog IC each scale to their own range).
  // Floored so a quiet chip doesn't blow tiny noise up to full scale.
  const vAt = (n: number): number => nodeV[n] ?? 0;
  const vlow = vAt(gndNode);
  let rail = 1;
  for (const p of parts)
    for (const n of p.nodes) rail = Math.max(rail, vAt(n) - vlow);
  for (const n of pinNodes) rail = Math.max(rail, vAt(n) - vlow);
  const level = (n: number): number =>
    Math.max(0, Math.min(1, (vAt(n) - vlow) / rail));

  // --- Wires: authored endpoint cells → mini coords, coloured by net level + flow carriers. ---
  for (const w of wires) {
    const a = toPx(w.from.col, w.from.row);
    const b = toPx(w.to.col, w.to.row);
    const lv = level(w.node);
    const col = mix(PALETTE.rail, accent, lv);
    g.moveTo(a.x, a.y)
      .lineTo(b.x, b.y)
      .stroke({ width: 1.4, color: col, alpha: 0.45 + 0.45 * lv });
    if (lv > 0.12) {
      for (let d = 0; d < 3; d++) {
        const f = (((phase * 0.6 + d / 3) % 1) + 1) % 1;
        g.circle(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, 0.9).fill({
          color: accent,
          alpha: 0.75 * lv,
        });
      }
    }
  }

  // --- External-pin anchors: tie each package lead to its inner net, so the inside visibly runs out
  // to the boundary pins (mirrors `internalsView`'s pin anchoring). ---
  const nAnchor = Math.min(pinNodes.length, pins.length);
  for (let i = 0; i < nAnchor; i++) {
    const p = pins[i];
    const nd = pinNodes[i];
    if (!p || nd === undefined) continue;
    const lv = level(nd);
    g.circle(p.x, p.y, 1.6).fill({ color: PALETTE.dim, alpha: 0.7 });
    // A short stub from the lead toward the centre, so a lead with a live net reads as energised
    // even before it reaches its first inner part.
    if (lv > 0.12) {
      const cx = wPx / 2;
      const cy = hPx / 2;
      const ex = p.x + (cx - p.x) * 0.18;
      const ey = p.y + (cy - p.y) * 0.18;
      g.moveTo(p.x, p.y)
        .lineTo(ex, ey)
        .stroke({
          width: 1.2,
          color: mix(PALETTE.rail, accent, lv),
          alpha: 0.5 * lv,
        });
    }
  }

  // --- Inner parts: each draws its REAL glyph into a pooled child Graphics, scaled onto the
  // footprint. The glyph is drawn at unit (PITCH) scale with pins at the part's rotated cell offsets,
  // then the child is scaled by `scale` and positioned at the part's authored anchor — so the
  // drawers' fixed-pixel detail (lead insets, zigzag amplitude) stays in proportion. ---
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]!;
    const child = partLayer.children[k] as Graphics;
    child.clear();
    const kind = PART_KINDS[part.kind];
    if (!kind) {
      child.visible = false;
      continue;
    }
    child.visible = true;
    // The part's anchor cell in footprint px (its top-left, pin offsets are relative to it).
    const anchor = toPx(part.cell.col, part.cell.row);
    child.position.set(anchor.x, anchor.y);
    child.scale.set(scale);
    // Per-pin glyph-local positions: authored pin offset rotated by the part's own rot, × PITCH
    // (unit scale — the child's transform does the shrink). drawGlyph routes the symbol between them.
    const glyphPins = kind.pins.map((pin) => {
      const r = rotateOffset(pin.dx, pin.dy, part.rot);
      return { x: r.col * PITCH, y: r.row * PITCH };
    });
    // A live electrical readout for the glyph: voltage across the part's first two terminals, sign
    // from their level difference. (Current isn't attributed per inner part here — the wire carriers
    // already show flow; the glyph reads vAcross for its field/charge animation.) Cheap + honest.
    const na = part.nodes[0];
    const nb = part.nodes[1];
    let electrical: ElectricalState = ZERO_ELECTRICAL;
    if (na !== undefined && nb !== undefined) {
      electrical = { current: 0, vAcross: vAt(na) - vAt(nb) };
    }
    const color = PALETTE[kind.colorKey];
    drawGlyph(child, {
      kind: part.kind,
      pins: glyphPins,
      wPx: (kind.w - 1) * PITCH,
      hPx: (kind.h - 1) * PITCH,
      color,
      electrical,
      phase,
      value: part.value,
    });
  }
}

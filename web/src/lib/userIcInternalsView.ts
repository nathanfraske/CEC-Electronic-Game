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
  /** node voltages, indexed by node number (the sim snapshot's `state`). ABSENT when the board does
   * not solve — the view then draws the authored circuit STATICALLY (every level 0: rail-coloured
   * wires, no flow carriers, parts at rest), so a placed chip still opens to "the circuit as you
   * built it" unpowered. */
  nodeV?: Float64Array;
  /** footprint pin positions (glyph-local px), by external pin index — the FALLBACK anchor used only
   * when the internals carry no authored `pinCells` (the package boundary positions). */
  pins: { x: number; y: number }[];
  /** OUTPUT: filled (by external pin index) with the glyph-local px where each package pin was drawn —
   * the die-editor position the authored lead bridges to — so the caller can park the pin LABEL there
   * (a 1:1 replica: dot + lead + label all on the same edge point). Cleared + rewritten each call. */
  outPinPx?: { x: number; y: number }[];
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
  const {
    internals,
    nodeV,
    pins,
    outPinPx,
    wPx,
    hPx,
    phase,
    accent,
    partLayer,
  } = o;
  const { parts, wires, pinNodes, bbox, gndNode, pinCells } = internals;
  if (outPinPx) outPinPx.length = 0;

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
  const vAt = (n: number): number => (nodeV ? (nodeV[n] ?? 0) : 0);
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

  // --- External package pins: anchor each lead WHERE THE AUTHORED WIRE LANDS (the frame's die-editor
  // pin cell), so the inner circuit visibly bridges out to the boundary pin — a 1:1 of the die the
  // player built. Falls back to the caller's footprint `pins` only when no authored pinCells exist.
  // The drawn px is reported via `outPinPx` so the caller parks the pin label on the same edge point. ---
  const extPx = pinCells.length
    ? pinCells.map((c) => toPx(c.col, c.row))
    : pins;
  for (let i = 0; i < extPx.length; i++) {
    const p = extPx[i];
    if (!p) continue;
    if (outPinPx) outPinPx[i] = { x: p.x, y: p.y };
    const nd = pinNodes[i];
    const lv = nd === undefined ? 0 : level(nd);
    // The package lead: a clear dot on the boundary, energised by its net level when live.
    g.circle(p.x, p.y, 2.4).fill({
      color: mix(PALETTE.dim, accent, lv),
      alpha: 0.9,
    });
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

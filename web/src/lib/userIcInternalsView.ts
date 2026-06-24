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
import {
  drawGlyph,
  drawUserIcPackageBody,
  ZERO_ELECTRICAL,
  type ElectricalState,
} from "./glyphs";
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
  wPx: number;
  hPx: number;
  /** the IC's identity colour, for the package body rim. */
  color: number;
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
  const { internals, nodeV, pins, wPx, hPx, color, phase, accent, partLayer } =
    o;
  const { parts, wires, pinNodes, gndNode, pinCells } = internals;

  // Draw the PACKAGE first: the leads out to the solder pins + the dark body. The authored circuit
  // then fills the body interior below, so it reads as the real chip opened up (leads on the outside).
  drawUserIcPackageBody(g, pins, wPx, hPx, color);

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

  // The authored circuit is laid out in die-editor cells, and the die editor is the production
  // footprint scaled up PROPORTIONALLY (DIE_SCALE). So map the FRAME-PIN extent (cells) straight onto
  // the PACKAGE-PIN extent (footprint px): every frame pin lands EXACTLY on its package pin and the
  // interior parts fall into place between them — the circuit lines up with the leads by pure scaling,
  // no re-routing. (`sx`/`sy` come out ≈ 1/DIE_SCALE since the layout is a proportional enlargement.)
  let fminC = Infinity;
  let fmaxC = -Infinity;
  let fminR = Infinity;
  let fmaxR = -Infinity;
  for (const c of pinCells) {
    if (c.col < fminC) fminC = c.col;
    if (c.col > fmaxC) fmaxC = c.col;
    if (c.row < fminR) fminR = c.row;
    if (c.row > fmaxR) fmaxR = c.row;
  }
  let pminX = Infinity;
  let pmaxX = -Infinity;
  let pminY = Infinity;
  let pmaxY = -Infinity;
  for (const p of pins) {
    if (p.x < pminX) pminX = p.x;
    if (p.x > pmaxX) pmaxX = p.x;
    if (p.y < pminY) pminY = p.y;
    if (p.y > pmaxY) pmaxY = p.y;
  }
  const haveMap =
    isFinite(fminC) && isFinite(pminX) && fmaxC > fminC && fmaxR > fminR;
  const sx = haveMap ? (pmaxX - pminX) / ((fmaxC - fminC) * PITCH) : 1;
  const sy = haveMap ? (pmaxY - pminY) / ((fmaxR - fminR) * PITCH) : 1;
  const partScale = Math.min(sx, sy);
  // Authored cell (col,row) → footprint px: frame pins map onto package pins, parts in between.
  const toPx = (col: number, row: number): { x: number; y: number } =>
    haveMap
      ? {
          x: pminX + (col - fminC) * PITCH * sx,
          y: pminY + (row - fminR) * PITCH * sy,
        }
      : { x: wPx / 2, y: hPx / 2 };

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

  // --- Wires: authored endpoint cells → footprint px, coloured by net level + flow carriers. A wire
  // endpoint that sits on a frame pin lands EXACTLY on that package pin under the proportional map
  // above (no special-casing needed) — so the inner circuit wires out to the leads by pure scaling. ---
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

  // --- External package pins: NO separate marker here. The package leads are the rectangular solder
  // tabs drawn by `drawUserIcPackageBody` above, the authored wires (drawn just above) carry the
  // internal circuit OUT to each lead (the proportional map lands a frame-pin endpoint exactly on its
  // package pin), and the board draws the rectangular solder PAD over the lead tip. So the internal
  // side shows only the connection from the inner circuit to the external lead — nothing more. ---

  // --- Inner parts: each draws its REAL glyph into a pooled child Graphics, scaled onto the
  // footprint. The glyph is drawn at unit (PITCH) scale with pins at the part's rotated cell offsets,
  // then the child is scaled by `partScale` and positioned at the part's authored anchor — so the
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
    child.scale.set(partScale);
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

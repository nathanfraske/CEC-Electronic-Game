// SPDX-License-Identifier: Apache-2.0
// The big animated component diagram for the info drawer. A tiny dedicated Pixi
// Application with two modes (docs/ui/component-info-panel.md §3):
//   • "schematic" — reuses the very same `drawGlyph` drawers the board uses, just
//     large and centred (the symbol you'll meet on a datasheet);
//   • "detail"    — the construction-internals "factory" view (DETAIL_DRAWERS),
//     drawn bigger and fed the SAME live ElectricalState + phase, so a part's
//     inner workings animate in real time. Falls back to the schematic glyph when
//     no detail drawer exists for the kind (DETAIL ?? schematic), so nothing is
//     ever blank.
// Both modes are fed the live pair handed in from the frame loop. No board state,
// no wasm crossing: it only draws what it's given.

import { Application, Container, Graphics } from "pixi.js";
import { PART_KINDS, PALETTE } from "./graph";
import { drawGlyph, ZERO_ELECTRICAL, type ElectricalState } from "./glyphs";
import { drawDetail } from "./detailDrawers";

const PITCH = 26; // mirrors the board's grid pitch
const SCALE = 2.8; // blow the schematic symbol up to fill the drawer
// The detail illustration fills the canvas to this fraction of its half-size, so
// the factory internals read big (the headline visual) with a little breathing room.
const DETAIL_FILL = 0.92;

/** Which picture the diagram shows: the schematic symbol, or the internals. */
export type DiagramMode = "schematic" | "detail";

export class InfoDiagram {
  private app: Application | undefined;
  private readonly holder = new Container();
  private readonly glyph = new Graphics();
  private kind = "";
  private mode: DiagramMode = "schematic";
  private electrical: ElectricalState = ZERO_ELECTRICAL;
  // The selected part's primary scalar (its `value`), forwarded to the drawer so
  // state-from-value glyphs (the manual switch) read correctly even when nothing is
  // running. Undefined until a part with a value is shown; other drawers ignore it.
  private value: number | undefined = undefined;
  // The potentiometer's wiper position, forwarded for the same reason. Optional.
  private wiper: number | undefined = undefined;
  private phase = 0;
  private raf = 0;
  private last = 0;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const app = new Application();
    await app.init({
      canvas,
      background: "#120f1c",
      antialias: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
      resizeTo: canvas.parentElement ?? canvas,
    });
    this.app = app;
    this.holder.addChild(this.glyph);
    app.stage.addChild(this.holder);
    this.loop();
  }

  setState(
    kind: string,
    e: ElectricalState,
    value?: number,
    wiper?: number,
  ): void {
    this.kind = kind;
    this.electrical = e;
    this.value = value;
    this.wiper = wiper;
  }

  /** Switch between the schematic symbol and the construction-internals view. */
  setMode(mode: DiagramMode): void {
    this.mode = mode;
  }

  private readonly loop = (): void => {
    const app = this.app;
    if (!app) return;
    const now = performance.now();
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    this.phase += dt;
    this.holder.position.set(app.screen.width / 2, app.screen.height / 2);
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    const app = this.app;
    if (!app) return;
    const g = this.glyph;
    g.clear();

    // Detail mode: try the construction-internals drawer first; on a hit, draw it
    // big and centred and we're done. On a miss, fall through to the schematic
    // glyph below (DETAIL ?? schematic) so the panel is never blank.
    if (this.mode === "detail" && this.kind) {
      const kind = PART_KINDS[this.kind];
      const color = kind ? PALETTE[kind.colorKey] : PALETTE.accent;
      this.holder.scale.set(1);
      const hw = (app.screen.width / 2) * DETAIL_FILL;
      const hh = (app.screen.height / 2) * DETAIL_FILL;
      const drew = drawDetail(g, {
        kind: this.kind,
        bounds: { hw, hh },
        color,
        electrical: this.electrical,
        phase: this.phase,
        value: this.value,
        wiper: this.wiper,
      });
      if (drew) return;
    }

    // Schematic mode (or the detail fallback): the board's glyph, scaled up.
    this.holder.scale.set(SCALE);
    const kind = PART_KINDS[this.kind];
    if (!kind) return;
    const color = PALETTE[kind.colorKey];
    // Pin offsets centred on the origin so scaling stays put.
    const pins = kind.pins.map((p) => ({
      x: (p.dx - (kind.w - 1) / 2) * PITCH,
      y: (p.dy - (kind.h - 1) / 2) * PITCH,
    }));
    const wPx = (kind.w - 1) * PITCH;
    const hPx = (kind.h - 1) * PITCH;
    drawGlyph(g, {
      kind: this.kind,
      pins,
      wPx,
      hPx,
      color,
      electrical: this.electrical,
      phase: this.phase,
      value: this.value,
      wiper: this.wiper,
    });
    for (const p of pins) {
      g.circle(p.x, p.y, 5).fill({ color: 0x120f1c });
      g.circle(p.x, p.y, 3.5).fill({ color });
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.app?.destroy({ removeView: false });
    this.app = undefined;
  }
}

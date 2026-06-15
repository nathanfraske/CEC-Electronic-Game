// SPDX-License-Identifier: Apache-2.0
// The big animated component diagram for the info drawer. A tiny dedicated Pixi
// Application that reuses the very same `drawGlyph` drawers the board uses — just
// large and centred — fed the live ElectricalState handed in from the frame loop.
// No board state, no wasm crossing: it only draws what it's given.

import { Application, Container, Graphics } from "pixi.js";
import { PART_KINDS, PALETTE } from "./graph";
import { drawGlyph, ZERO_ELECTRICAL, type ElectricalState } from "./glyphs";

const PITCH = 26; // mirrors the board's grid pitch
const SCALE = 2.8; // blow the symbol up to fill the drawer

export class InfoDiagram {
  private app: Application | undefined;
  private readonly holder = new Container();
  private readonly glyph = new Graphics();
  private kind = "";
  private electrical: ElectricalState = ZERO_ELECTRICAL;
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
    this.holder.scale.set(SCALE);
    app.stage.addChild(this.holder);
    this.loop();
  }

  setState(kind: string, e: ElectricalState): void {
    this.kind = kind;
    this.electrical = e;
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
    const g = this.glyph;
    g.clear();
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

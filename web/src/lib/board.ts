// SPDX-License-Identifier: Apache-2.0
// PixiJS board renderer. Draws the bench grid and live oscilloscope traces from
// the simulation snapshot. Pure presentation: it only reads snapshots, it never
// drives the core.

import { Application, Graphics } from "pixi.js";
import type { Snapshot } from "../sim/loop";

// One color per state channel, sampled from the CEC palette (rose, cyan,
// violet, green) as hex for the GPU.
const CHANNEL_COLORS = [0xf5247a, 0x46d2e6, 0x9a78ff, 0x3ad39a];
const MAX_SAMPLES = 360;

export class Board {
  private readonly grid = new Graphics();
  private readonly traces = new Graphics();
  private readonly samples: number[][] = [[], [], [], []];
  private w = 0;
  private h = 0;

  constructor(private readonly app: Application) {
    app.stage.addChild(this.grid);
    app.stage.addChild(this.traces);
    this.drawGrid();
  }

  update(snap: Snapshot): void {
    if (this.app.screen.width !== this.w || this.app.screen.height !== this.h) {
      this.drawGrid();
    }
    for (let c = 0; c < this.samples.length; c++) {
      const buf = this.samples[c];
      if (!buf) continue;
      buf.push(snap.state[c] ?? 0);
      if (buf.length > MAX_SAMPLES) buf.shift();
    }
    this.drawTraces();
  }

  private drawGrid(): void {
    const w = (this.w = this.app.screen.width);
    const h = (this.h = this.app.screen.height);
    const g = this.grid;
    g.clear();

    const minor = 26;
    for (let x = 0; x <= w; x += minor) g.moveTo(x, 0).lineTo(x, h);
    for (let y = 0; y <= h; y += minor) g.moveTo(0, y).lineTo(w, y);
    g.stroke({ width: 1, color: 0x2a2640, alpha: 0.35 });

    const major = minor * 4;
    for (let x = 0; x <= w; x += major) g.moveTo(x, 0).lineTo(x, h);
    for (let y = 0; y <= h; y += major) g.moveTo(0, y).lineTo(w, y);
    g.stroke({ width: 1, color: 0x3b3560, alpha: 0.5 });

    g.moveTo(0, h / 2).lineTo(w, h / 2);
    g.stroke({ width: 1, color: 0x4a3a66, alpha: 0.6 });
  }

  private drawTraces(): void {
    const { w, h } = this;
    const pad = 18;
    const g = this.traces;
    g.clear();

    for (let c = 0; c < this.samples.length; c++) {
      const buf = this.samples[c];
      if (!buf || buf.length < 2) continue;

      // Auto-range each channel so even tiny deterministic motion is visible.
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of buf) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      let range = hi - lo;
      if (range < 1e-9) range = 1;

      const trace = (): void => {
        for (let i = 0; i < buf.length; i++) {
          const x = (i / (MAX_SAMPLES - 1)) * w;
          const norm = ((buf[i] ?? 0) - lo) / range;
          const y = pad + (1 - norm) * (h - 2 * pad);
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
      };

      const color = CHANNEL_COLORS[c] ?? 0xffffff;
      trace();
      g.stroke({ width: 4, color, alpha: 0.1 });
      trace();
      g.stroke({ width: 1.5, color, alpha: 0.95 });
    }
  }

  destroy(): void {
    this.grid.destroy();
    this.traces.destroy();
  }
}

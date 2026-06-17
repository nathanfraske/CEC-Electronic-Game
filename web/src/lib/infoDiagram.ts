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
import { drawGlyphIn, ZERO_ELECTRICAL, type ElectricalState } from "./glyphs";
import { drawDetail } from "./detailDrawers";
import { drawAnalogy } from "./analogyDrawers";
import { setStudsVisible } from "./tierKit";

const PITCH = 26; // mirrors the board's grid pitch
const SCALE = 2.8; // blow the schematic symbol up to fill the drawer
// The detail illustration fills the canvas to this fraction of its half-size, so
// the factory internals read big (the headline visual) with a little breathing room.
const DETAIL_FILL = 0.92;

/**
 * Which tier of the component view the diagram shows (the owner's 3-tier model):
 *   • "schematic" — the datasheet symbol (DRAWERS);
 *   • "analogy"   — the Factory machine metaphor (FACTORY_DRAWERS), a teaching analogy;
 *   • "reality"   — the construction-internals "as close to reality" view
 *     (DETAIL_DRAWERS), animated from the live state. Falls back outward
 *     (reality → schematic) when a tier's art doesn't exist for the kind.
 */
export type DiagramMode = "schematic" | "analogy" | "reality";

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
  // A thermistor's body temperature (°C), forwarded so the preview tracks the knob.
  private temp: number | undefined = undefined;
  // The shared visual flow clock, handed in each frame from the board
  // (`Board.flowPhase()`) rather than free-run here. Riding the board's clock
  // makes the internals animation advance at the same calm rate, freeze when the
  // sim is paused, and run backward when scrubbing — i.e. pause and flow with time.
  private phase = 0;
  private raf = 0;

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
    temp?: number,
  ): void {
    this.kind = kind;
    this.electrical = e;
    this.value = value;
    this.wiper = wiper;
    this.temp = temp;
  }

  /** Switch the view tier: schematic symbol / Factory analogy / reality internals. */
  setMode(mode: DiagramMode): void {
    this.mode = mode;
  }

  /**
   * Adopt the board's shared visual flow clock (`Board.flowPhase()`), fed once per
   * frame. The internals then recirculate at the board's calm fixed rate, freeze
   * with a paused sim, and reverse when stepping/scrubbing back — pause-and-flow-
   * with-time, instead of a free-running wall-clock that ignored playback.
   */
  setPhase(phase: number): void {
    this.phase = phase;
  }

  private readonly loop = (): void => {
    const app = this.app;
    if (!app) return;
    this.holder.position.set(app.screen.width / 2, app.screen.height / 2);
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    const app = this.app;
    if (!app) return;
    const g = this.glyph;
    g.clear();

    // Reality + analogy tiers: try the full-panel illustration first (the device
    // internals for "reality", the factory-machine metaphor for "analogy"); on a
    // hit, draw it big and centred and we're done. On a miss, fall through to the
    // glyph below (reality → board factory glyph → schematic) so it's never blank.
    if (this.kind && (this.mode === "reality" || this.mode === "analogy")) {
      const kind = PART_KINDS[this.kind];
      const color = kind ? PALETTE[kind.colorKey] : PALETTE.accent;
      this.holder.scale.set(1);
      const hw = (app.screen.width / 2) * DETAIL_FILL;
      const hh = (app.screen.height / 2) * DETAIL_FILL;
      // Anchor each terminal at its catalog grid position, mapped into the panel —
      // the same per-pin layout the board uses, so a multi-terminal illustration
      // routes its leads the same way here (inputs/outputs on the matching sides)
      // and the info view stays consistent with the on-board one.
      const cw = (kind?.w ?? 1) - 1;
      const ch = (kind?.h ?? 1) - 1;
      const anchors = (kind?.pins ?? []).map((p) => ({
        label: p.label,
        x: cw > 0 ? ((p.dx - cw / 2) / (cw / 2)) * 0.6 * hw : 0,
        y: ch > 0 ? ((p.dy - ch / 2) / (ch / 2)) * 0.82 * hh : 0,
      }));
      const opts = {
        kind: this.kind,
        bounds: { hw, hh },
        color,
        electrical: this.electrical,
        phase: this.phase,
        value: this.value,
        wiper: this.wiper,
        temp: this.temp,
        anchors,
      };
      // The info panel has no separate pin dots, so the illustration's own studs
      // are its terminals — keep them (the board hides them; see tierKit).
      setStudsVisible(true);
      const drew =
        this.mode === "reality" ? drawDetail(g, opts) : drawAnalogy(g, opts);
      if (drew) return;
    }

    // Schematic tier (and the reality/analogy fallback): the board's glyph, scaled
    // up. The analogy fallback draws the Factory machine board art explicitly,
    // without touching the board's global lens.
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
    drawGlyphIn(
      g,
      {
        kind: this.kind,
        pins,
        wPx,
        hPx,
        color,
        electrical: this.electrical,
        phase: this.phase,
        value: this.value,
        wiper: this.wiper,
      },
      this.mode === "analogy" ? "factory" : "schematic",
    );
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

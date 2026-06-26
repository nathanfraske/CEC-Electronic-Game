// SPDX-License-Identifier: Apache-2.0
// HEADLESS RENDER PROBE — lets a test (and the agent) assert on the OUTPUT of the real PixiJS drawers with
// NO renderer, NO canvas, NO browser. A Pixi v8 `Graphics` records every draw op into `context.instructions`
// (action + style colour + path) and computes a true geometric extent via `getLocalBounds()` — both work in
// plain node, so the existing wasm-free vitest suite can check render geometry the way `netlist.test.ts`
// checks the netlist. Turns "the symbol overflowed the body" / "wrong ring colour" / "nothing drawn" from
// eyeball-only bugs into millisecond, deterministic assertions on the UNMODIFIED `glyphs.ts` / `board` /
// `userIcInternalsView` drawers. Render-only; never the sim/golden.
import { Graphics } from "pixi.js";

/** A drawer's recorded output: its extent (local bounds), how many draw ops it emitted, and the fill /
 * stroke colours it used. `empty` is the no-op case (a drawer that drew nothing — e.g. an unrecognised
 * gate name), which `getLocalBounds()` reports as a zero/!isFinite box. */
export interface RenderProbe {
  /** local-space extent of everything drawn (Pixi `getLocalBounds`), as plain numbers. */
  bounds: { x: number; y: number; width: number; height: number };
  /** minX/minY/maxX/maxY form of the same extent (handy for centre/edge assertions). */
  box: { minX: number; minY: number; maxX: number; maxY: number };
  /** number of recorded draw instructions (0 ⇒ the drawer was a no-op). */
  instructionCount: number;
  /** distinct fill colours used (in encounter order). */
  fillColors: number[];
  /** distinct stroke colours used (in encounter order). */
  strokeColors: number[];
  /** true when the drawer emitted nothing (no instructions / non-finite bounds). */
  empty: boolean;
}

/** Pull the colour off one recorded instruction's style, tolerating Pixi's shape variations. */
function colorOf(style: unknown): number | undefined {
  if (style && typeof style === "object" && "color" in style) {
    const c = (style as { color?: unknown }).color;
    if (typeof c === "number") return c;
  }
  return undefined;
}

/**
 * Run a Graphics drawer offscreen and read back what it produced. `draw` receives a fresh `Graphics` and
 * should call the real drawer (e.g. `(g) => drawGateBodySymbol(g, "NAND", 0, 0, 20, 16, 0xff0000)`). Pure +
 * headless; destroys the Graphics before returning so nothing leaks across tests.
 */
export function probe(draw: (g: Graphics) => void): RenderProbe {
  const g = new Graphics();
  draw(g);
  // `context.instructions` is the recorded op list (each `{ action, data }`); fills/strokes carry a style.
  const instr = (g.context?.instructions ?? []) as Array<{
    action?: string;
    data?: { style?: unknown };
  }>;
  const fillColors: number[] = [];
  const strokeColors: number[] = [];
  for (const ins of instr) {
    const c = colorOf(ins.data?.style);
    if (c === undefined) continue;
    if (ins.action === "fill" && !fillColors.includes(c)) fillColors.push(c);
    if (ins.action === "stroke" && !strokeColors.includes(c))
      strokeColors.push(c);
  }
  const b = g.getLocalBounds();
  const minX = b.minX;
  const minY = b.minY;
  const maxX = b.maxX;
  const maxY = b.maxY;
  const finite =
    Number.isFinite(minX) &&
    Number.isFinite(maxX) &&
    maxX > minX &&
    Number.isFinite(minY) &&
    Number.isFinite(maxY) &&
    maxY > minY;
  const result: RenderProbe = {
    bounds: {
      x: finite ? minX : 0,
      y: finite ? minY : 0,
      width: finite ? maxX - minX : 0,
      height: finite ? maxY - minY : 0,
    },
    box: finite
      ? { minX, minY, maxX, maxY }
      : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    instructionCount: instr.length,
    fillColors,
    strokeColors,
    empty: instr.length === 0 || !finite,
  };
  g.destroy();
  return result;
}

/** Centre of a probe's extent — for "the symbol is centred on (cx,cy)" assertions. */
export function probeCenter(p: RenderProbe): { x: number; y: number } {
  return { x: (p.box.minX + p.box.maxX) / 2, y: (p.box.minY + p.box.maxY) / 2 };
}

// SPDX-License-Identifier: Apache-2.0
// shoot.mjs — render the live app to a PNG the agent can Read, so render changes (board.ts / glyphs.ts /
// userIcInternalsView.ts / App.svelte) are SEEN, not guessed. Boots the Vite dev server, drives the
// pre-installed headless Chromium (PixiJS v8 over WebGL2/SwiftShader), optionally seeds a saved circuit,
// waits for the canvas to settle, and screenshots it.
//
//   pnpm -C web shoot --out /tmp/app.png
//   pnpm -C web shoot --out /tmp/latch.png --fixture ../path/to/ceccircuit.json --wait 2000
//
// Flags: --out <png> (default /tmp/cec-shot.png) · --fixture <cec-circuit .json> (seeds the board) ·
// --port <n> (5191) · --wait <ms> settle (1500) · --width/--height viewport (1280x900).
// NEVER run `playwright install` — Chromium is pre-provisioned at /opt/pw-browsers.
import { readFileSync } from "node:fs";
import { openApp } from "./lib/harness.mjs";

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const out = arg("out", "/tmp/cec-shot.png");
const fixturePath = arg("fixture", null);
const port = Number(arg("port", "5191"));
const settle = Number(arg("wait", "1500"));
const width = Number(arg("width", "1280"));
const height = Number(arg("height", "900"));
// Deep-zoom / lens / drill hooks (window.__cecView) so the harness can capture LoD-only render — pin-label
// deco, conduit pipes, zoom-to-open internals — that fitView never reaches: --zoom <scale> (screen px per
// world px), --lens <schematic|analogy|reality>, --center <componentId> (centre + zoom on a placed part).
const zoom = arg("zoom", null);
const lens = arg("lens", null);
const center = arg("center", null);
// Thermal-lens capture: --thermal turns on the heat-field overlay, --real flips Real-mode fidelity (parts
// only self-heat in Real mode), --run resumes the paused sim so Tj accumulates. Use a long --wait so the
// heat builds before the shot, e.g. `shoot --thermal --real --run --wait 6000`.
const flag = (k) => argv.includes(`--${k}`);
const thermal = flag("thermal");
const real = flag("real");
const run = flag("run");
const tps = arg("tps", null); // ticks/sec while running — high values let game-scaled (seconds) heat build fast
const democable = flag("democable"); // stand up a 4-bit bus cable (window.__cecDemoCable) before the shot

const fixture = fixturePath ? readFileSync(fixturePath, "utf8") : null;

const { page, errors, cleanup } = await openApp({
  fixture,
  port,
  width,
  height,
  settleMs: settle,
});
try {
  if (democable) {
    await page.evaluate(() => window.__cecDemoCable?.());
    await page.waitForTimeout(400); // let the place + cable derive + redraw settle
  }
  if (zoom || lens || center || thermal || real || run || tps) {
    await page.evaluate((o) => window.__cecView?.(o), {
      ...(zoom ? { zoom: Number(zoom) } : {}),
      ...(lens ? { lens } : {}),
      ...(center ? { centerId: Number(center) } : {}),
      ...(thermal ? { thermal: true } : {}),
      ...(real ? { real: true } : {}),
      ...(run ? { run: true } : {}),
      ...(tps ? { tps: Number(tps) } : {}),
    });
    await page.waitForTimeout(settle); // re-settle (+ let heat build under --thermal --run) after the change
  }
  await page.screenshot({ path: out, scale: "css" });
  console.log(`✓ shot → ${out} (${width}x${height})`);
  if (errors.length)
    console.log(
      `  ⚠ ${errors.length} page error(s):\n   ${errors.slice(0, 5).join("\n   ")}`,
    );
} finally {
  await cleanup();
}

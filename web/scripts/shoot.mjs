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

const fixture = fixturePath ? readFileSync(fixturePath, "utf8") : null;

const { page, errors, cleanup } = await openApp({
  fixture,
  port,
  width,
  height,
  settleMs: settle,
});
try {
  if (zoom || lens || center) {
    await page.evaluate((o) => window.__cecView?.(o), {
      ...(zoom ? { zoom: Number(zoom) } : {}),
      ...(lens ? { lens } : {}),
      ...(center ? { centerId: Number(center) } : {}),
    });
    await page.waitForTimeout(settle); // re-settle after the view change
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

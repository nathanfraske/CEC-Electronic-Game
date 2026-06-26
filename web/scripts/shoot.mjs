// SPDX-License-Identifier: Apache-2.0
// shoot.mjs — render the live app to a PNG the agent can Read, so render changes (board.ts / glyphs.ts /
// userIcInternalsView.ts / App.svelte) are SEEN, not guessed. Boots the Vite dev server, drives the
// pre-installed headless Chromium (PixiJS v8 over WebGL2/SwiftShader), optionally seeds a saved circuit,
// waits for the canvas to settle, and screenshots it.
//
//   pnpm -C web shoot --out /tmp/app.png
//   pnpm -C web shoot --out /tmp/latch.png --fixture ../path/to/ceccircuit.json --wait 2000
//
// Flags: --out <png> (default /tmp/cec-shot.png) · --fixture <cec-circuit .json> (seeds localStorage so the
// board loads it) · --port <n> (5191) · --wait <ms> settle (1500) · --width/--height viewport (1280x900).
// NEVER run `playwright install` — Chromium is pre-provisioned at /opt/pw-browsers.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

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

// Playwright lives in the global toolchain, not as a web/ dep — resolve it either way, tolerating
// CJS/ESM interop (the global build is CommonJS, so its exports land on `.default`).
const pickChromium = (m) => m?.chromium ?? m?.default?.chromium;
let chromium;
try {
  chromium = pickChromium(await import("playwright"));
} catch {
  /* not a local dep — fall through to the global path */
}
if (!chromium)
  chromium = pickChromium(
    await import("/opt/node22/lib/node_modules/playwright/index.js"),
  );
if (!chromium) throw new Error("could not load Playwright's chromium");

const fixture = fixturePath ? readFileSync(fixturePath, "utf8") : null;

// --- boot the dev server ---------------------------------------------------------------------------
const vite = spawn(
  "node_modules/.bin/vite",
  ["--port", String(port), "--strictPort"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let viteErr = "";
vite.stderr.on("data", (d) => (viteErr += d.toString()));

const base = `http://localhost:${port}/`;
async function waitForServer(timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(base);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > timeoutMs)
      throw new Error(`vite did not start on :${port}\n${viteErr}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

let browser;
try {
  await waitForServer(30000);
  browser = await chromium.launch({
    headless: true,
    // Force the software WebGL2 path: headless Chromium reports navigator.gpu, so Pixi v8 would otherwise
    // pick the flakier WebGPU-on-SwiftShader renderer (see the panel's risk note).
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--no-sandbox",
    ],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  // Before any app code runs: kill navigator.gpu (force WebGL) and seed the board fixture into the exact
  // localStorage key loadBoard() reads. A saved .json ({graph, userIcs}) loads directly — loadBoard reads
  // .graph and registers .userIcs; the extra format/version fields are ignored.
  await page.addInitScript((fx) => {
    try {
      Object.defineProperty(navigator, "gpu", {
        get: () => undefined,
        configurable: true,
      });
    } catch {
      /* ignore */
    }
    if (fx) {
      // The app's onMount honours __CEC_FIXTURE before the onboarding primer (deterministic), and we
      // also seed localStorage as a fallback for older builds.
      try {
        window.__CEC_FIXTURE = fx;
      } catch {
        /* ignore */
      }
      try {
        localStorage.setItem("cec.board.v1", fx);
      } catch {
        /* ignore */
      }
    }
  }, fixture);

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(base, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("canvas", { timeout: 15000 });
  await page.waitForTimeout(settle); // let the render loop + fonts settle
  await page.screenshot({ path: out, scale: "css" });
  console.log(`✓ shot → ${out} (${width}x${height})`);
  if (errors.length)
    console.log(
      `  ⚠ ${errors.length} page error(s):\n   ${errors.slice(0, 5).join("\n   ")}`,
    );
} finally {
  if (browser) await browser.close();
  vite.kill("SIGTERM");
}

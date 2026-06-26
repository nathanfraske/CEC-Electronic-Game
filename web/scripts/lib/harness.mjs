// SPDX-License-Identifier: Apache-2.0
// harness.mjs — shared headless-render plumbing for the agent's "see the render" tools (shoot.mjs,
// replay.mjs). Boots the Vite dev server, drives the pre-installed headless Chromium (PixiJS v8 over
// WebGL2/SwiftShader), seeds a board fixture, and waits for the app's own ready signal. Each tool layers
// its specific work on top (shoot → screenshot; replay → print the route, then screenshot).
//
// NEVER run `playwright install` — Chromium is pre-provisioned at /opt/pw-browsers.
import { spawn } from "node:child_process";

// Force the software WebGL2 path: headless Chromium reports navigator.gpu, so Pixi v8 would otherwise
// pick the flakier WebGPU-on-SwiftShader renderer.
export const LAUNCH_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--no-sandbox",
];

// Playwright lives in the global toolchain, not as a web/ dep — resolve it either way, tolerating
// CJS/ESM interop (the global build is CommonJS, so its exports land on `.default`).
const pickChromium = (m) => m?.chromium ?? m?.default?.chromium;
export async function loadChromium() {
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
  return chromium;
}

function startVite(port) {
  const vite = spawn(
    "node_modules/.bin/vite",
    ["--port", String(port), "--strictPort"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let err = "";
  vite.stderr.on("data", (d) => (err += d.toString()));
  return { vite, getErr: () => err };
}

async function waitForServer(base, timeoutMs, getErr) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(base);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > timeoutMs)
      throw new Error(`vite did not start\n${getErr()}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Boot the dev server + a headless page with the app loaded and settled. Returns the live `page`, the
 * collected `errors` (page errors + console.error), and a `cleanup()` that closes the browser and kills
 * vite. Callers MUST call `cleanup()` in a finally. `fixture` is a `cec-circuit` (or raw graph) JSON
 * string seeded before any app code runs — the app's onMount honours `window.__CEC_FIXTURE` ahead of the
 * onboarding primer, so the board renders an EXACT circuit deterministically.
 */
export async function openApp({
  fixture = null,
  port = 5191,
  width = 1280,
  height = 900,
  settleMs = 1500,
} = {}) {
  const chromium = await loadChromium();
  const { vite, getErr } = startVite(port);
  const base = `http://localhost:${port}/`;
  const errors = [];
  let browser;
  try {
    await waitForServer(base, 30000, getErr);
    browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    const page = await browser.newPage({ viewport: { width, height } });
    // Before any app code runs: kill navigator.gpu (force WebGL) and seed the board fixture into the
    // exact hook + localStorage key the app reads.
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

    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto(base, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("canvas", { timeout: 15000 });
    // Wait for the app's ready signal (board loaded + a frame painted) rather than guessing, then a
    // short settle for fonts + the render loop. Falls back to the fixed settle on an older build.
    await page
      .waitForFunction(() => window.__cecReady === true, { timeout: 8000 })
      .catch(() => {});
    if (settleMs) await page.waitForTimeout(settleMs);
    const cleanup = async () => {
      try {
        await browser.close();
      } finally {
        vite.kill("SIGTERM");
      }
    };
    return { page, errors, cleanup, base };
  } catch (err) {
    if (browser) await browser.close();
    vite.kill("SIGTERM");
    throw err;
  }
}

// SPDX-License-Identifier: Apache-2.0
// replay.mjs — hand the agent a bug/feedback bundle (downloaded from the in-app "Report bug" / "Give
// feedback" buttons) and this REPLAYS it for inspection. It prints the player's recent ROUTE (the action
// journal — the owner's "see exactly how I made the bug") + the captured errors, then either:
//   · default: renders the EXACT final board the bundle carries to a PNG; or
//   · --drive: RE-WALKS the route from a clean boot through the app's `__cecReplay` hook (the same
//     functions the UI calls), screenshotting the end state — so a SEQUENCE/STATE bug the final board
//     can't show (e.g. a builder-UI glitch) is reproduced and seen.
//
//   pnpm -C web replay --bundle ../path/to/cec-bug-2026-….json            # static final-board render
//   pnpm -C web replay --bundle x.json --drive --out /tmp/replay.png      # re-walk the route
//   pnpm -C web replay --bundle x.json --drive --filmstrip                # + a PNG per step
//
// Flags: --bundle <json> (a cec-feedback bundle OR a plain cec-circuit save) · --drive (re-walk) ·
// --filmstrip (PNG per step, with --drive) · --out <png> (/tmp/cec-replay.png) · --port <n> (5191) ·
// --wait <ms> settle (1500) · --step-wait <ms> per drive step (140) · --width/--height.
// Drive replays from EMPTY, so spatial ops resolve by captured CELL (camera/id-independent); steps with
// no faithful clean-boot replay (a file load, or a mid-session target) report "skip". NEVER run
// `playwright install` — Chromium is pre-provisioned at /opt/pw-browsers.
import { readFileSync } from "node:fs";
import { openApp } from "./lib/harness.mjs";

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const bundlePath = arg("bundle", null);
const out = arg("out", "/tmp/cec-replay.png");
const port = Number(arg("port", "5191"));
const settle = Number(arg("wait", "1500"));
const width = Number(arg("width", "1280"));
const height = Number(arg("height", "900"));
// --drive: actually RE-WALK the route from a clean (empty) boot via the app's `__cecReplay` hook,
// screenshotting the end state (and each step with --filmstrip). Default (no --drive) just renders the
// bundle's final board statically.
const drive = argv.includes("--drive");
const filmstrip = argv.includes("--filmstrip");
const stepWait = Number(arg("step-wait", "140"));

if (!bundlePath) {
  console.error(
    "usage: pnpm -C web replay --bundle <cec-feedback .json> [--out png]",
  );
  process.exit(2);
}

const raw = readFileSync(bundlePath, "utf8");
let bundle;
try {
  bundle = JSON.parse(raw);
} catch (err) {
  console.error(`✗ couldn't parse ${bundlePath}: ${err}`);
  process.exit(2);
}

// A cec-feedback bundle wraps the circuit in `.board`; a plain cec-circuit save IS the circuit. Accept
// either so the tool also doubles as a "render this saved board + (no) route" inspector.
const isFeedback = bundle?.format === "cec-feedback";
const board = isFeedback ? bundle.board : bundle;
const journal = Array.isArray(bundle?.journal) ? bundle.journal : [];
const errors = Array.isArray(bundle?.errors) ? bundle.errors : [];

// Mirror of lib/feedback.ts `formatJournal` (kept in sync; .mjs can't import the .ts at plain-node time).
function formatJournal(entries, errs) {
  if (!entries.length && !errs.length) return "(empty journal)";
  const t0 = entries[0]?.t ?? errs[0]?.t ?? 0;
  const rel = (t) => `+${((t - t0) / 1000).toFixed(1)}s`;
  const fmtVal = (v) =>
    v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);
  const lines = entries.map((e, i) => {
    const data =
      e.data && Object.keys(e.data).length
        ? "  " +
          Object.entries(e.data)
            .map(([k, v]) => `${k}=${fmtVal(v)}`)
            .join(" ")
        : "";
    const detail = e.detail ? ` ${e.detail}` : "";
    return `${String(i + 1).padStart(3)} ${rel(e.t).padStart(7)}  ${e.action}${detail}${data}`;
  });
  if (errs.length) {
    lines.push(`--- ${errs.length} error(s) ---`);
    for (const er of errs)
      lines.push(`    ${rel(er.t).padStart(7)}  ${er.msg}`);
  }
  return lines.join("\n");
}

// --- report the route + context BEFORE rendering, so the agent reads the "how" then sees the "what" ---
const hr = "─".repeat(72);
console.log(hr);
if (isFeedback) {
  console.log(
    `bundle: ${bundle.kind?.toUpperCase() ?? "?"}  @ ${bundle.at ?? "?"}`,
  );
  if (bundle.note) console.log(`note:   ${bundle.note}`);
  if (bundle.meta && Object.keys(bundle.meta).length)
    console.log(`meta:   ${JSON.stringify(bundle.meta)}`);
} else {
  console.log(`bundle: plain cec-circuit save (no route)`);
}
console.log(hr);
console.log("ROUTE (oldest → newest):");
console.log(formatJournal(journal, errors));
console.log(hr);

if (drive) {
  // --- RE-WALK the route from a clean (empty) boot via the app's __cecReplay hook -------------------
  const EMPTY = JSON.stringify({
    format: "cec-circuit",
    version: 3,
    graph: { components: [], wires: [] },
  });
  const {
    page,
    errors: pageErrors,
    cleanup,
  } = await openApp({
    fixture: EMPTY,
    port,
    width,
    height,
    settleMs: settle,
  });
  try {
    const hasHook = await page
      .waitForFunction(() => typeof window.__cecReplay === "function", {
        timeout: 8000,
      })
      .then(() => true)
      .catch(() => false);
    if (!hasHook)
      console.log(
        "  ⚠ no __cecReplay hook in this build — driving will skip everything.",
      );
    const dir = out.replace(/\.png$/, "");
    const counts = { ok: 0, skip: 0, fail: 0 };
    console.log("DRIVE (clean boot → re-walk the route):");
    for (let i = 0; i < journal.length; i++) {
      const e = journal[i];
      const before = pageErrors.length;
      let status = "skip";
      try {
        status =
          (await page.evaluate((entry) => window.__cecReplay(entry), e)) ??
          "skip";
      } catch {
        status = "fail";
      }
      counts[status] = (counts[status] ?? 0) + 1;
      await page.waitForTimeout(stepWait);
      const newErr =
        pageErrors.length > before
          ? `  ⚠ ${pageErrors[pageErrors.length - 1]}`
          : "";
      console.log(
        `${String(i + 1).padStart(3)} ${status.toUpperCase().padEnd(4)} ${e.action}${e.detail ? " " + e.detail : ""}${newErr}`,
      );
      if (filmstrip)
        await page.screenshot({
          path: `${dir}-step${String(i + 1).padStart(2, "0")}.png`,
          scale: "css",
        });
    }
    await page.screenshot({ path: out, scale: "css" });
    console.log(
      `✓ drove ${journal.length} step(s) [ok ${counts.ok}, skip ${counts.skip}, fail ${counts.fail}] → ${out} (${width}x${height})`,
    );
    if (pageErrors.length)
      console.log(
        `  ⚠ ${pageErrors.length} total page error(s):\n   ${pageErrors.slice(0, 5).join("\n   ")}`,
      );
  } finally {
    await cleanup();
  }
} else {
  if (!board || typeof board !== "object") {
    console.error(
      "✗ bundle has no renderable board — printed the route only. (Try --drive.)",
    );
    process.exit(journal.length ? 0 : 1);
  }
  // --- render the exact board the bundle carries (static) ------------------------------------------
  const {
    page,
    errors: pageErrors,
    cleanup,
  } = await openApp({
    fixture: JSON.stringify(board),
    port,
    width,
    height,
    settleMs: settle,
  });
  try {
    await page.screenshot({ path: out, scale: "css" });
    console.log(`✓ rendered the bundle's board → ${out} (${width}x${height})`);
    if (pageErrors.length)
      console.log(
        `  ⚠ ${pageErrors.length} page error(s) DURING re-render:\n   ${pageErrors.slice(0, 5).join("\n   ")}`,
      );
  } finally {
    await cleanup();
  }
}

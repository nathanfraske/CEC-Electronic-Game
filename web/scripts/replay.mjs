// SPDX-License-Identifier: Apache-2.0
// replay.mjs — hand the agent a bug/feedback bundle (downloaded from the in-app "Report bug" / "Give
// feedback" buttons) and this REPLAYS it for inspection: it prints the player's recent ROUTE (the action
// journal — the owner's "see exactly how I made the bug"), lists the captured console errors, then boots
// the app and renders the EXACT board the bundle carries to a PNG the agent Reads. One command turns a
// reported moment back into (a) a legible timeline and (b) a faithful screenshot.
//
//   pnpm -C web replay --bundle ../path/to/cec-bug-2026-….json
//   pnpm -C web replay --bundle x.json --out /tmp/replay.png
//
// Flags: --bundle <json> (a cec-feedback bundle OR a plain cec-circuit save) · --out <png>
// (default /tmp/cec-replay.png) · --port <n> (5191) · --wait <ms> settle (1500) · --width/--height.
// NOTE: replay re-renders the FINAL board state + reports the route; it does not re-drive pointer input
// (the bundle has no initial-state snapshot — a faithful event-sourced re-driver is a separate, larger
// telemetry feature). For most reported bugs the final board + the route are exactly what's needed.
// NEVER run `playwright install` — Chromium is pre-provisioned at /opt/pw-browsers.
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

if (!board || typeof board !== "object") {
  console.error("✗ bundle has no renderable board — printed the route only.");
  process.exit(journal.length ? 0 : 1);
}

// --- render the exact board the bundle carries ------------------------------------------------------
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

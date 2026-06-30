// SPDX-License-Identifier: Apache-2.0
// Ad-hoc: verify copy-paste reproduces the TRACE shape (hand-routed bends), not just the connection.
// Loads the L-turn fixture, duplicates the whole circuit via the harness hook, then asserts the wire
// waypoint total DOUBLED (the pasted traces kept their routes) and shoots the result.
import { openApp } from "./lib/harness.mjs";
import { readFileSync } from "node:fs";

const fixture = readFileSync(process.env.FIX || "/tmp/lturn.json", "utf8");
const OUT = process.env.OUT || "/tmp/copypaste.png";

const { page, errors, cleanup } = await openApp({ fixture, settleMs: 1600 });
try {
  const info = () => page.evaluate(() => window.__cecSelInfo?.() ?? null);
  const before = await info();
  console.log("before:", JSON.stringify(before));
  // Duplicate the whole circuit, offset down-right so it doesn't overlap the original.
  await page.evaluate(() => window.__cecDuplicateAll?.(2, 8));
  await page.waitForTimeout(300);
  const after = await info();
  console.log("after: ", JSON.stringify(after));
  // Frame both copies for the screenshot.
  await page.evaluate(() => window.__cecView?.({ zoom: 0.82 }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT });
  console.log("wrote", OUT);

  const ok =
    before &&
    after &&
    after.wireWps === before.wireWps * 2 &&
    after.wireWps > 0;
  console.log(
    ok
      ? `PASS — wire waypoints ${before.wireWps} → ${after.wireWps} (pasted traces kept their routes)`
      : `FAIL — wire waypoints ${before?.wireWps} → ${after?.wireWps} (expected doubling)`,
  );
  if (!ok) process.exitCode = 1;
  const fatal = errors.filter(
    (e) => !/favicon|Failed to load resource/.test(e),
  );
  if (fatal.length) console.log("PAGE ERRORS:\n" + fatal.join("\n"));
} finally {
  await cleanup();
}

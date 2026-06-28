// SPDX-License-Identifier: Apache-2.0
//
// cec-app — a minimal stdio MCP server that gives the agent a PERSISTENT, interactive handle on the live
// app (boots Vite + headless Chromium ONCE, then reuses the page across calls — no per-shot reboot, no
// throwaway fixture tests). Wraps the same harness as shoot.mjs/replay.mjs. Registered in
// .claude/settings.json so future sessions load it automatically; run standalone for a smoke test:
//
//   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | (cd web && node scripts/mcp-app.mjs)
//
// Tools:
//   cec_open      {fixture?, lens?}            — (re)boot the app; optional cec-circuit JSON + initial lens
//   cec_screenshot{lens?, zoom?, center?, out?}— apply the LoD view, screenshot to a PNG, return its path
//   cec_eval      {js}                         — run JS in the page (drive UI / read window.__cec* / state)
//   cec_close     {}                           — tear down the session
//
// stdout carries ONLY newline-delimited JSON-RPC; all diagnostics go to stderr. NEVER run playwright install.
import { openApp } from "./lib/harness.mjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Always run from web/ so the harness's relative `node_modules/.bin/vite` resolves, no matter the launch cwd.
try {
  process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
} catch {
  /* ignore */
}

const log = (...a) => process.stderr.write(a.join(" ") + "\n");
const SCRATCH = process.env.CEC_MCP_OUT || "/tmp/cec-mcp";
import { mkdirSync } from "node:fs";
try {
  mkdirSync(SCRATCH, { recursive: true });
} catch {
  /* ignore */
}

let session = null; // { page, errors, cleanup }
let shotN = 0;

async function ensureOpen(fixture = null) {
  if (session) return session;
  session = await openApp({ fixture, settleMs: 1800 });
  return session;
}

const TOOLS = [
  {
    name: "cec_open",
    description:
      "Boot (or reboot) the live CEC app in headless Chromium and keep it alive for subsequent calls. Pass a cec-circuit JSON string as `fixture` to seed an exact board (rebuilds the session), and an optional initial `lens` (reality|analogy|schematic).",
    inputSchema: {
      type: "object",
      properties: {
        fixture: {
          type: "string",
          description: "cec-circuit envelope JSON to seed the board",
        },
        lens: {
          type: "string",
          enum: ["reality", "analogy", "schematic"],
        },
      },
    },
  },
  {
    name: "cec_screenshot",
    description:
      "Apply a level-of-detail view (lens / zoom in px-per-world-px / center on a component id) and screenshot the live canvas to a PNG. Returns the file path — Read it to SEE the render.",
    inputSchema: {
      type: "object",
      properties: {
        lens: { type: "string", enum: ["reality", "analogy", "schematic"] },
        zoom: { type: "number", description: "screen px per world px" },
        center: { type: "number", description: "component id to centre on" },
        out: { type: "string", description: "output PNG path (optional)" },
      },
    },
  },
  {
    name: "cec_eval",
    description:
      "Evaluate JavaScript in the live app page and return the JSON result. Use to drive the UI, call window.__cecView / window.__cecReplay, or read board/sim state. The expression's value (or a Promise) is returned.",
    inputSchema: {
      type: "object",
      properties: { js: { type: "string" } },
      required: ["js"],
    },
  },
  {
    name: "cec_close",
    description: "Tear down the app session (browser + dev server).",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name, args) {
  if (name === "cec_open") {
    if (session) {
      await session.cleanup().catch(() => {});
      session = null;
    }
    const s = await ensureOpen(args.fixture ?? null);
    if (args.lens)
      await s.page
        .evaluate((l) => window.__cecView?.({ lens: l }), args.lens)
        .catch(() => {});
    return `app open (errors: ${s.errors.length}${s.errors.length ? " — " + s.errors.slice(0, 3).join(" | ") : ""})`;
  }
  if (name === "cec_screenshot") {
    const s = await ensureOpen();
    if (args.lens || args.zoom || args.center) {
      await s.page
        .evaluate(
          (o) => window.__cecView?.(o),
          {
            ...(args.lens ? { lens: args.lens } : {}),
            ...(args.zoom ? { zoom: Number(args.zoom) } : {}),
            ...(args.center != null ? { centerId: Number(args.center) } : {}),
          },
        )
        .catch(() => {});
      await s.page.waitForTimeout(1500);
    }
    const out = args.out || `${SCRATCH}/shot-${++shotN}.png`;
    await s.page.screenshot({ path: out, scale: "css" });
    return `shot → ${out}`;
  }
  if (name === "cec_eval") {
    const s = await ensureOpen();
    const r = await s.page.evaluate(
      (code) => Promise.resolve(eval(code)),
      args.js,
    );
    return typeof r === "string" ? r : JSON.stringify(r);
  }
  if (name === "cec_close") {
    if (session) {
      await session.cleanup().catch(() => {});
      session = null;
    }
    return "closed";
  }
  throw new Error(`unknown tool: ${name}`);
}

// --- newline-delimited JSON-RPC 2.0 over stdio --------------------------------
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => send({ jsonrpc: "2.0", id, result });
  const fail = (code, message) =>
    send({ jsonrpc: "2.0", id, error: { code, message } });
  try {
    if (method === "initialize") {
      reply({
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "cec-app", version: "0.1.0" },
      });
    } else if (method === "tools/list") {
      reply({ tools: TOOLS });
    } else if (method === "tools/call") {
      const text = await callTool(params.name, params.arguments || {});
      reply({ content: [{ type: "text", text }] });
    } else if (method === "ping") {
      reply({});
    } else if (id != null) {
      fail(-32601, `method not found: ${method}`);
    }
    // notifications (no id), e.g. notifications/initialized — nothing to reply
  } catch (e) {
    if (id != null) fail(-32603, String(e?.message || e));
    else log("error in notification", String(e));
  }
}

// Serialize handling: tool calls share the one app `session`, and a slow call (cec_open boots Vite +
// Chromium) must finish before the next runs. Each parsed message is chained onto `queue`.
let buf = "";
let queue = Promise.resolve();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log("bad JSON line:", line.slice(0, 120));
      continue;
    }
    queue = queue.then(() => handle(msg)).catch((e) => log("handle err", e));
  }
});
process.stdin.on("end", async () => {
  await queue.catch(() => {}); // let in-flight calls finish before tearing down
  if (session) await session.cleanup().catch(() => {});
  process.exit(0);
});
log("cec-app MCP server ready (stdio)");

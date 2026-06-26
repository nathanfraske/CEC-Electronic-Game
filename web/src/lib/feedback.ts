// SPDX-License-Identifier: Apache-2.0
// FEEDBACK / BUG-REPORT BUNDLE — one click hands the agent everything it needs to reproduce + understand
// a moment: the EXACT board (cec-circuit JSON, which the agent re-renders via `web/scripts/shoot.mjs
// --fixture`), the recent ACTION JOURNAL (the route the player took — the owner's "see exactly how I made
// the bug"), recent CONSOLE ERRORS, and a free-text note. Two flavours: a "bug" (something's wrong) and
// "feedback" (an improvement) — same bundle, different tag. Pure client capture; no network, never the sim.
const MAX = 80; // ring-buffer cap for errors + journal (recent context, not a full history)

interface Stamped {
  /** ms since epoch (UI-only; never folded into any reproducible value). */
  t: number;
}
interface ErrorEntry extends Stamped {
  msg: string;
}
interface ActionEntry extends Stamped {
  action: string;
  detail?: string;
  /** Optional structured payload (e.g. `{cell:{col,row}}` for a place, `{tag}` for a drill) — keeps the
   * route REPLAYABLE/legible: a semantic op + its arguments, not just a verb. Small & JSON-safe. */
  data?: Record<string, unknown>;
}

const errors: ErrorEntry[] = [];
const journal: ActionEntry[] = [];
let installed = false;

function ring<T>(arr: T[], item: T): void {
  arr.push(item);
  if (arr.length > MAX) arr.shift();
}

/** Start capturing uncaught errors / rejections / console.error into the ring buffer. Idempotent; a
 * no-op outside the browser. Call once on app mount. */
export function installFeedbackCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) =>
    ring(errors, {
      t: Date.now(),
      msg: String(e.message ?? e.error ?? e).slice(0, 600),
    }),
  );
  window.addEventListener("unhandledrejection", (e) =>
    ring(errors, {
      t: Date.now(),
      msg: `unhandledrejection: ${String(e.reason)}`.slice(0, 600),
    }),
  );
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    ring(errors, {
      t: Date.now(),
      msg: args.map(String).join(" ").slice(0, 600),
    });
    orig(...args);
  };
}

/** Record one player action into the journal (the replayable "route"). `action` is a short verb
 * (e.g. "tool", "place", "drill-in", "key"); `detail` is optional context (the kind, the key); `data`
 * is an optional structured payload (e.g. the grid cell of a place) that keeps the op replayable. Cheap;
 * call at the real dispatch sites. */
export function logAction(
  action: string,
  detail?: string,
  data?: Record<string, unknown>,
): void {
  ring(journal, { t: Date.now(), action, detail, ...(data ? { data } : {}) });
}

/** Render a journal (oldest→newest) as a compact human-readable timeline — the "route" the agent reads
 * when handed a bug bundle. Relative timestamps (`+1.2s` from the first entry), the verb, its detail,
 * and any structured `data`. Pure; safe in node + the browser. `errs` (optional) are appended as a tail
 * block so a route and the errors it produced read together. This is the CANONICAL formatter (the bundle
 * inspector `web/scripts/replay.mjs` mirrors it for plain-node use). */
export function formatJournal(
  entries: ActionEntry[],
  errs: ErrorEntry[] = [],
): string {
  if (!entries.length && !errs.length) return "(empty journal)";
  const t0 = entries[0]?.t ?? errs[0]?.t ?? 0;
  const rel = (t: number) => `+${((t - t0) / 1000).toFixed(1)}s`;
  const fmtVal = (v: unknown): string =>
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

/** The bundle the owner downloads + hands the agent. */
export interface FeedbackBundle {
  format: "cec-feedback";
  version: 1;
  kind: "bug" | "feedback";
  note: string;
  at: string;
  /** the EXACT board, as a `cec-circuit` envelope — the agent re-renders it with shoot.mjs --fixture. */
  board: unknown;
  /** the recent action route (oldest→newest), each `{t, action, detail}`. */
  journal: ActionEntry[];
  /** recent captured errors. */
  errors: ErrorEntry[];
  /** small context: tool/drill state, camera, viewport, agent string. */
  meta: Record<string, unknown>;
}

/** Assemble the bundle. `board` is the cec-circuit envelope (graph + userIcs + …) the caller already
 * builds for Save; `meta` is whatever lightweight UI context the caller has. */
export function buildFeedbackBundle(
  kind: "bug" | "feedback",
  note: string,
  board: unknown,
  meta: Record<string, unknown>,
): FeedbackBundle {
  return {
    format: "cec-feedback",
    version: 1,
    kind,
    note: note.trim(),
    at: new Date().toISOString(),
    board,
    journal: journal.slice(),
    errors: errors.slice(),
    meta: {
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      ...meta,
    },
  };
}

/** Trigger a download of the bundle as a `.json` file the owner can hand the agent. */
export function downloadFeedbackBundle(bundle: FeedbackBundle): void {
  if (typeof document === "undefined") return;
  const stamp = bundle.at.replace(/[:.]/g, "-");
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cec-${bundle.kind}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

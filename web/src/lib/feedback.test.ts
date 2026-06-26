// SPDX-License-Identifier: Apache-2.0
// Unit tests for the feedback/route capture (lib/feedback.ts): the action journal records structured
// ops, the bundle carries them, and the canonical `formatJournal` renders a legible timeline. These lock
// the capture contract that `web/scripts/replay.mjs` (the bundle inspector) and a future re-driver read.
import { describe, it, expect } from "vitest";
import { logAction, buildFeedbackBundle, formatJournal } from "./feedback";

describe("action journal", () => {
  it("records a verb, optional detail, and structured data", () => {
    logAction("tool", "wire");
    logAction("place", "INV", { cell: { col: 4, row: 2 } });
    const bundle = buildFeedbackBundle(
      "bug",
      " note ",
      { format: "cec-circuit" },
      {},
    );
    const j = bundle.journal;
    const place = j.find((e) => e.action === "place");
    expect(place).toBeTruthy();
    expect(place?.detail).toBe("INV");
    expect(place?.data).toEqual({ cell: { col: 4, row: 2 } });
    // a verb with no data carries no `data` key (kept lean)
    const tool = j.find((e) => e.action === "tool" && e.detail === "wire");
    expect(tool).toBeTruthy();
    expect(tool && "data" in tool).toBe(false);
  });

  it("trims the note and stamps the bundle shape", () => {
    const bundle = buildFeedbackBundle(
      "feedback",
      "  hi  ",
      { format: "cec-circuit" },
      { lens: "real" },
    );
    expect(bundle.format).toBe("cec-feedback");
    expect(bundle.version).toBe(1);
    expect(bundle.kind).toBe("feedback");
    expect(bundle.note).toBe("hi");
    expect(bundle.meta.lens).toBe("real");
    // the board envelope rides through untouched
    expect((bundle.board as { format: string }).format).toBe("cec-circuit");
    expect(typeof bundle.at).toBe("string");
  });
});

describe("formatJournal", () => {
  it("renders a relative-time timeline with detail + data", () => {
    const t0 = 1_000_000;
    const entries = [
      {
        t: t0,
        action: "drill-in",
        detail: "Inv Latch",
        data: { tag: "CEC9001", fresh: false },
      },
      {
        t: t0 + 2500,
        action: "place",
        detail: "INV",
        data: { cell: { col: 3, row: 1 } },
      },
      { t: t0 + 3000, action: "wire" },
    ];
    const out = formatJournal(entries);
    expect(out).toContain("drill-in Inv Latch");
    expect(out).toContain("tag=CEC9001");
    // relative stamp: the second entry is +2.5s after the first
    expect(out).toContain("+2.5s");
    expect(out).toContain('cell={"col":3,"row":1}');
    // ordered, one line per entry (+ no error block here)
    expect(out.split("\n")).toHaveLength(3);
  });

  it("appends a captured-error block", () => {
    const t0 = 5_000;
    const out = formatJournal(
      [{ t: t0, action: "key", detail: "s" }],
      [{ t: t0 + 1000, msg: "TypeError: boom" }],
    );
    expect(out).toContain("--- 1 error(s) ---");
    expect(out).toContain("TypeError: boom");
  });

  it("is safe on an empty journal", () => {
    expect(formatJournal([], [])).toBe("(empty journal)");
  });
});

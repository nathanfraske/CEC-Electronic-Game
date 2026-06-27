// SPDX-License-Identifier: Apache-2.0
//
// Live SYMBOL-STATE model — "what's happening inside" a recognised cell, shown on its body symbol on the
// board (no zoom needed). v1 covers the SEQUENTIAL cells: a flip-flop / latch / register surfaces the
// BIT(S) it is currently storing (its Q output level(s)), the way the part refsheets show "Q=0". Pure
// data: the board supplies the live output levels (read from the sim via `pinVoltage`); this picks the
// stored data bits out of the output pins and formats the value chip. No Pixi, no sim, nothing hashed.

import type { CellSymbolId } from "./glyphs";

/** The recognised cell symbols that HOLD state — the ones whose body shows a stored bit (v1). */
const SEQUENTIAL_CELL_SYMBOLS = new Set<string>([
  "DFF",
  "DLATCH",
  "REG",
] satisfies CellSymbolId[]);

/** Does this recognised-cell symbol id store a bit (so its body should show live state)? */
export function isSequentialCellSymbol(id: string | null | undefined): boolean {
  return !!id && SEQUENTIAL_CELL_SYMBOLS.has(id);
}

/** A live output pin: its authored name + its current logic level (0/1), read off the sim by the board. */
export interface OutputLevel {
  name: string;
  level: number;
}

/** The stored data the body shows: the bits (MSB-first) + the display label for the value chip. */
export interface StoredState {
  /** stored data bits, MSB-first (a flop/latch → 1 bit; a register → its word). */
  bits: number[];
  /** the value chip's label — the data output's base name ("Q"). */
  label: string;
}

/** Trailing-integer suffix of a pin name (Q3 → 3, Q → null). */
function suffixNum(name: string): number | null {
  const m = /(\d+)\s*$/.exec(name.trim());
  return m ? parseInt(m[1]!, 10) : null;
}

/** The base name with any trailing index / bar suffix stripped: Q3 → Q, Q_BAR → Q, QN → Q. */
function baseName(name: string): string {
  return (
    name
      .trim()
      .toUpperCase()
      .replace(/[_-]?(?:BAR)$/i, "")
      .replace(/(\d+)$/, "")
      .replace(/[_-]$/, "") || name.trim().toUpperCase()
  );
}

/** A complementary (Q̄) output — `QB`, `QN`, `Q_BAR`, `NQ` — NOT a stored data bit, so it's dropped from
 * the value (it just mirrors the true Q). Conservative: only fires on a Q-like complement, so a real
 * data output (Q, Q0…Q3, OUT, SUM, COUT) is never mistaken for one. */
function isBarOutput(name: string): boolean {
  const u = name.trim().toUpperCase();
  return /^N?Q[_-]?(?:BAR|B|N)$/.test(u) || /^NQ\d*$/.test(u);
}

/**
 * From a sequential cell's OUTPUT pins (name + live level) pick the stored data word: drop the
 * complementary bar outputs (Q̄/QN/…), order the rest by their name's numeric suffix **MSB-first**
 * (Q3 Q2 Q1 Q0), and derive a single value label from their shared base name. A lone unindexed output
 * (a flop's `Q`) yields one bit. Returns no bits when nothing data-like remains. Pure.
 */
export function storedOutputs(outs: OutputLevel[]): StoredState {
  const data = outs.filter((o) => !isBarOutput(o.name));
  if (data.length === 0) return { bits: [], label: "Q" };
  // MSB-first: highest numeric suffix first. Unindexed names keep their given order (stable sort).
  const ordered = data
    .map((o, i) => ({ o, i, n: suffixNum(o.name) }))
    .sort((a, b) => {
      if (a.n !== null && b.n !== null) return b.n - a.n;
      if (a.n !== null) return -1;
      if (b.n !== null) return 1;
      return a.i - b.i;
    })
    .map((e) => e.o);
  const label = baseName(ordered[0]!.name) || "Q";
  return { bits: ordered.map((o) => (o.level ? 1 : 0)), label };
}

/** The value-chip string for a stored state — `Q=1`, `Q=0101` (MSB-first) — or "" when there are no bits. */
export function formatStoredValue(s: StoredState): string {
  return s.bits.length > 0 ? `${s.label}=${s.bits.join("")}` : "";
}

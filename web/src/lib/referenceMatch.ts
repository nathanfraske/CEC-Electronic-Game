// SPDX-License-Identifier: Apache-2.0
//
// Functional identity-match oracle for the reference-library curriculum
// (docs/reference-library-curriculum.md §3) — the "did the player build the reference part?" test, and the
// first phase (P1) of the earn-it → unlock → behavioral-swap-in loop.
//
// A reference part and a player's hand-built cell are the SAME part when they compute the SAME function,
// regardless of transistor topology OR input pin order. We decide this on the CHARACTERIZED face
// (`CellBehavior` from `characterize.ts`): two cells match iff they agree on the program class (`prog`), the
// combinational/registered `mode`, the input arity, AND a CANONICAL truth table (minimised over input-bit
// permutations, so a NAND with its two inputs swapped still reads as a NAND). This is functional identity,
// not the structural `cellBehaviorSig` (which differs for two correct-but-differently-wired cells — that hash
// stays the "has THIS exact cell changed?" re-characterise trigger, not the "is it a NAND?" test).
//
// Pure data in, boolean out: deterministic, golden-safe (web-only, never crosses to sim-core), headless.

import type { CellBehavior } from "./userIc";

/** A cell's functional fingerprint: its characterized behavior plus the input arity the truth table spans. */
export interface FunctionalId {
  behavior: CellBehavior;
  /** number of logic INPUT pins the truth table is over (1..4) — disambiguates same-`word` different-arity
   * cells (a 1-input inverter and a 2-input NOR both have `word === 1`). */
  inputCount: number;
}

/** All permutations of `[0, 1, …, n-1]` (n ≤ 4, so ≤ 24 — cheap). */
function permutations(n: number): number[][] {
  if (n <= 1) return [Array.from({ length: n }, (_, i) => i)];
  const out: number[][] = [];
  const rest = permutations(n - 1);
  for (let i = 0; i < n; i++) {
    for (const p of rest) {
      // insert the new element `n-1` at position i of each (n-1)-permutation
      out.push([...p.slice(0, i), n - 1, ...p.slice(i)]);
    }
  }
  return out;
}

/**
 * Canonical form of a `≤4`-input truth table `word`, minimised over all permutations of the input bits.
 * Two cells computing the same function but with inputs wired to different pins produce permuted `word`s
 * that share one canonical form. `inputCount ≤ 1` (a buffer/inverter) has no permutation freedom, so `word`
 * is already canonical. Bit `i` of `word` is the output for the input vector whose bit `b` is input `b`
 * (`out = (word >> (i0 | i1<<1 | …)) & 1`), matching `CellBehavior.word`.
 */
export function canonicalTruthTable(word: number, inputCount: number): number {
  const n = Math.max(0, Math.min(4, inputCount));
  if (n <= 1) return word & ((1 << (1 << n)) - 1);
  const size = 1 << n; // truth-table rows
  const mask = (1 << size) - 1;
  let best = word & mask;
  for (const perm of permutations(n)) {
    let w = 0;
    for (let i = 0; i < size; i++) {
      if (((word >> i) & 1) === 0) continue;
      // remap input vector `i`'s bits through `perm` → its row index in the permuted table
      let j = 0;
      for (let b = 0; b < n; b++) if ((i >> b) & 1) j |= 1 << perm[b];
      w |= 1 << j;
    }
    if (w < best) best = w;
  }
  return best;
}

/**
 * Are two cells the SAME function? Agree on `prog` (LUT class), `mode` (combinational vs registered), input
 * arity, and canonical truth table. Order-independent on inputs. (Registered cells compare their next-state
 * table the same way; storage cells are matched separately via `MemBehavior`, not here.)
 */
export function functionallyIdentical(
  a: FunctionalId,
  b: FunctionalId,
): boolean {
  if (a.behavior.prog !== b.behavior.prog) return false;
  if (a.behavior.mode !== b.behavior.mode) return false;
  if (a.inputCount !== b.inputCount) return false;
  return (
    canonicalTruthTable(a.behavior.word, a.inputCount) ===
    canonicalTruthTable(b.behavior.word, b.inputCount)
  );
}

/** A reference part the player can unlock by building an equivalent: its tag + functional fingerprint. */
export interface ReferencePart {
  tag: string;
  id: FunctionalId;
}

/**
 * The proof oracle: which reference part(s) has the player's characterized cell PROVEN they can build?
 * Returns every reference tag that is functionally identical (usually 0 or 1; >1 only if the library has
 * duplicate functions under different names). The unlock layer (P2) flips these to "earned".
 */
export function matchingReferences(
  player: FunctionalId,
  references: readonly ReferencePart[],
): string[] {
  return references
    .filter((r) => functionallyIdentical(player, r.id))
    .map((r) => r.tag);
}

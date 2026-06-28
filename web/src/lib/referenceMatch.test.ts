// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import {
  canonicalTruthTable,
  functionallyIdentical,
  matchingReferences,
  type FunctionalId,
  type ReferencePart,
} from "./referenceMatch";

// CellBehavior.word: bit i = output for input vector i (i = i0 | i1<<1 | i2<<2 | i3<<3). 2-input gates:
const AND = 0b1000; //  out 00,10,01,11 = 0,0,0,1
const OR = 0b1110; //   0,1,1,1
const NAND = 0b0111; // 1,1,1,0
const NOR = 0b0001; //  1,0,0,0
const XOR = 0b0110; //  0,1,1,0
const XNOR = 0b1001; // 1,0,0,1
const INV = 0b01; //    1-input NOT: 0->1, 1->0
const IMPLY = 0b1101; // a->b = ¬a ∨ b : (00)=1,(10)=0,(01)=1,(11)=1
const IMPLY_SWAPPED = 0b1011; // inputs swapped = b->a = ¬b ∨ a

const fid = (
  word: number,
  inputCount: number,
  mode = 0,
  prog = 4,
): FunctionalId => ({
  behavior: { prog, word, mode, sig: 0 },
  inputCount,
});

describe("canonicalTruthTable", () => {
  it("leaves symmetric gates unchanged (input swap is a no-op)", () => {
    for (const w of [AND, OR, NAND, NOR, XOR, XNOR]) {
      expect(canonicalTruthTable(w, 2)).toBe(w);
    }
  });
  it("maps an asymmetric gate and its input-swap to the same canonical form", () => {
    // IMPLY with inputs wired the other way is the converse gate — the same 2-input part up to relabeling.
    expect(canonicalTruthTable(IMPLY, 2)).toBe(
      canonicalTruthTable(IMPLY_SWAPPED, 2),
    );
  });
  it("a 1-input cell has no permutation freedom", () => {
    expect(canonicalTruthTable(INV, 1)).toBe(INV);
  });
  it("canonicalises a 3-input asymmetric function stably (idempotent)", () => {
    const w = 0b10110100; // arbitrary 3-input table
    const c = canonicalTruthTable(w, 3);
    expect(canonicalTruthTable(c, 3)).toBe(c); // canonical form is its own canonical form
  });
});

describe("functionallyIdentical", () => {
  it("a gate matches itself", () => {
    expect(functionallyIdentical(fid(NAND, 2), fid(NAND, 2))).toBe(true);
  });
  it("distinguishes different 2-input gates", () => {
    expect(functionallyIdentical(fid(AND, 2), fid(NAND, 2))).toBe(false);
    expect(functionallyIdentical(fid(XOR, 2), fid(XNOR, 2))).toBe(false);
  });
  it("disambiguates same-word cells by input arity (INV vs NOR both have word === 1)", () => {
    expect(INV).toBe(NOR); // the trap: identical word values...
    expect(functionallyIdentical(fid(INV, 1), fid(NOR, 2))).toBe(false); // ...but different arity ⇒ not the same part
  });
  it("treats a combinational and a registered cell with the same word as different", () => {
    expect(functionallyIdentical(fid(NAND, 2, 0), fid(NAND, 2, 1))).toBe(false);
  });
  it("matches a correct cell wired with its inputs in a different order", () => {
    // A player who built an IMPLY gate with the two inputs swapped still built an IMPLY gate.
    expect(functionallyIdentical(fid(IMPLY, 2), fid(IMPLY_SWAPPED, 2))).toBe(
      true,
    );
  });
});

describe("matchingReferences (the proof oracle)", () => {
  const refs: ReferencePart[] = [
    { tag: "AND", id: fid(AND, 2) },
    { tag: "OR", id: fid(OR, 2) },
    { tag: "NAND", id: fid(NAND, 2) },
    { tag: "NOR", id: fid(NOR, 2) },
    { tag: "XOR", id: fid(XOR, 2) },
    { tag: "INV", id: fid(INV, 1) },
  ];
  it("unlocks exactly the reference the player proved", () => {
    expect(matchingReferences(fid(XOR, 2), refs)).toEqual(["XOR"]);
    expect(matchingReferences(fid(INV, 1), refs)).toEqual(["INV"]);
    // a NOR the player built with swapped inputs still unlocks NOR (and not the same-word INV)
    expect(matchingReferences(fid(NOR, 2), refs)).toEqual(["NOR"]);
  });
  it("unlocks nothing for a function not in the library", () => {
    const HALF = 0b0; // all-zero output: not any of the gates above
    expect(matchingReferences(fid(HALF, 2), refs)).toEqual([]);
  });
});

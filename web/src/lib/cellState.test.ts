// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import {
  isSequentialCellSymbol,
  storedOutputs,
  formatStoredValue,
  type OutputLevel,
} from "./cellState";

describe("cellState — the stored bit(s) a sequential cell shows on its body", () => {
  it("recognises the stateful cell symbols", () => {
    expect(isSequentialCellSymbol("DFF")).toBe(true);
    expect(isSequentialCellSymbol("DLATCH")).toBe(true);
    expect(isSequentialCellSymbol("REG")).toBe(true);
    expect(isSequentialCellSymbol("MUX")).toBe(false);
    expect(isSequentialCellSymbol("NAND")).toBe(false);
    expect(isSequentialCellSymbol(null)).toBe(false);
  });

  it("a flop's single Q → one bit, labelled Q", () => {
    const s = storedOutputs([{ name: "Q", level: 1 }]);
    expect(s.bits).toEqual([1]);
    expect(s.label).toBe("Q");
    expect(formatStoredValue(s)).toBe("Q=1");
  });

  it("drops the complementary Q̄ output (it just mirrors Q)", () => {
    const outs: OutputLevel[] = [
      { name: "Q", level: 0 },
      { name: "QB", level: 1 },
    ];
    const s = storedOutputs(outs);
    expect(s.bits).toEqual([0]); // QB dropped
    expect(formatStoredValue(s)).toBe("Q=0");
    // other bar spellings
    expect(
      storedOutputs([
        { name: "Q", level: 1 },
        { name: "QN", level: 0 },
      ]).bits,
    ).toEqual([1]);
    expect(
      storedOutputs([
        { name: "Q", level: 1 },
        { name: "Q_BAR", level: 0 },
      ]).bits,
    ).toEqual([1]);
    expect(
      storedOutputs([
        { name: "Q", level: 1 },
        { name: "NQ", level: 0 },
      ]).bits,
    ).toEqual([1]);
  });

  it("a register word orders bits MSB-first by suffix → Q3 Q2 Q1 Q0", () => {
    // Pins given in a jumbled order; level encodes the bit value.
    const outs: OutputLevel[] = [
      { name: "Q0", level: 1 },
      { name: "Q2", level: 1 },
      { name: "Q1", level: 0 },
      { name: "Q3", level: 0 },
    ];
    const s = storedOutputs(outs);
    expect(s.label).toBe("Q");
    expect(s.bits).toEqual([0, 1, 0, 1]); // Q3=0 Q2=1 Q1=0 Q0=1
    expect(formatStoredValue(s)).toBe("Q=0101");
  });

  it("never treats a real data output as a bar (OUT/SUM/COUT/Q0)", () => {
    expect(storedOutputs([{ name: "OUT", level: 1 }]).bits).toEqual([1]);
    expect(storedOutputs([{ name: "Q0", level: 1 }]).bits).toEqual([1]);
    expect(
      storedOutputs([
        { name: "SUM", level: 1 },
        { name: "COUT", level: 0 },
      ]).bits.length,
    ).toBe(2);
  });

  it("no data outputs → no bits, empty value string", () => {
    expect(storedOutputs([{ name: "QB", level: 1 }]).bits).toEqual([]);
    expect(formatStoredValue({ bits: [], label: "Q" })).toBe("");
  });
});

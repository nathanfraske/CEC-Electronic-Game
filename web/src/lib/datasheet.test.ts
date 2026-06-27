// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { buildDatasheet, type DatasheetChar } from "./datasheet";
import type { UserIc } from "./userIc";
import type { GraphSnapshot } from "./graph";

const emptyGraph: GraphSnapshot = {
  components: [],
  wires: [],
  junctions: [],
  netLabels: [],
  nextComponentId: 1,
  nextWireId: 1,
  nextJunctionId: 1,
  nextNetLabelId: 1,
};

function ic(over: Partial<UserIc>): UserIc {
  return {
    tag: "CEC9001",
    name: "TEST PART",
    package: { archetype: "DIP", pinCount: 0 },
    frameId: 0,
    graph: emptyGraph,
    ...over,
  };
}

describe("buildDatasheet — pinout + function table from a part def", () => {
  it("uses explicit pin roles + names for the pinout directions", () => {
    const ds = buildDatasheet(
      ic({
        name: "D FLOP",
        package: { archetype: "DIP", pinCount: 5 },
        pinNames: ["D", "CLK", "CLR", "Q", "QB"],
        pinRoles: ["in", "clk", "in", "out", "out"],
      }),
      null,
    );
    expect(ds.pins.map((p) => p.dir)).toEqual([
      "IN",
      "CLK",
      "IN",
      "OUT",
      "OUT",
    ]);
    expect(ds.pins.map((p) => p.name)).toEqual(["D", "CLK", "CLR", "Q", "QB"]);
    expect(ds.pins[0]!.number).toBe(1);
    expect(ds.pinCount).toBe(5);
  });

  it("INFERS roles from pin names when explicit roles are absent", () => {
    const ds = buildDatasheet(
      ic({
        package: { archetype: "DIP", pinCount: 6 },
        pinNames: ["D0", "CLK", "VCC", "GND", "Q0", "OE"],
        // no pinRoles → inferred via roleFromName
      }),
      null,
    );
    expect(ds.pins.map((p) => p.dir)).toEqual([
      "IN", // D0
      "CLK", // CLK
      "PWR", // VCC
      "GND", // GND
      "OUT", // Q0
      "IN", // OE (output-enable control → input)
    ]);
  });

  it("names unnamed pins `pin N`", () => {
    const ds = buildDatasheet(
      ic({ package: { archetype: "SOIC", pinCount: 3 } }),
      null,
    );
    expect(ds.pins.map((p) => p.name)).toEqual(["pin 1", "pin 2", "pin 3"]);
    expect(ds.pins.every((p) => p.dir === "—")).toBe(true);
  });

  it("formats the package label (packaged vs free-form)", () => {
    expect(
      buildDatasheet(ic({ package: { archetype: "dip", pinCount: 8 } }), null)
        .packageLabel,
    ).toBe("DIP-8");
    expect(
      buildDatasheet(
        ic({
          package: { archetype: "BLOCK", pinCount: 5 },
          freeForm: { w: 6, h: 5, pins: [] },
        }),
        null,
      ).packageLabel,
    ).toBe("free-form (5-pin)");
  });

  it("labels the kind IC vs Subassembly", () => {
    expect(buildDatasheet(ic({ role: "subassembly" }), null).kindLabel).toBe(
      "Subassembly",
    );
    expect(buildDatasheet(ic({ role: "ic" }), null).kindLabel).toBe("IC");
    expect(buildDatasheet(ic({}), null).kindLabel).toBe("IC"); // default
  });

  it("folds a characterization into the function table + summary", () => {
    const char: DatasheetChar = {
      inNames: ["A", "B"],
      outName: "Y",
      gate: "NAND",
      registered: false,
      rows: [
        { in: [0, 0], out: 1 },
        { in: [1, 0], out: 1 },
        { in: [0, 1], out: 1 },
        { in: [1, 1], out: 0 },
      ],
    };
    const ds = buildDatasheet(
      ic({ name: "MY NAND", package: { archetype: "DIP", pinCount: 3 } }),
      char,
    );
    expect(ds.table).not.toBeNull();
    expect(ds.table!.inputs).toEqual(["A", "B"]);
    expect(ds.table!.outputs).toEqual(["Y"]);
    expect(ds.table!.registered).toBe(false);
    expect(ds.table!.rows[3]).toEqual({ in: [1, 1], out: [0] });
    expect(ds.summary).toBe("NAND — 2-input");
  });

  it("marks a clocked function table and summarises it as registered", () => {
    const char: DatasheetChar = {
      inNames: ["D"],
      outName: "Q",
      gate: "D-TYPE",
      registered: true,
      rows: [
        { in: [0], out: 0 },
        { in: [1], out: 1 },
      ],
    };
    const ds = buildDatasheet(ic({ name: "DFF" }), char);
    expect(ds.summary).toBe("D-TYPE — 1-input, clocked");
    expect(ds.table!.registered).toBe(true);
  });

  it("summarises a part with no characterised behaviour by its package", () => {
    const ds = buildDatasheet(
      ic({ name: "OPAMP CELL", package: { archetype: "DIP", pinCount: 8 } }),
      null,
    );
    expect(ds.table).toBeNull();
    expect(ds.summary).toBe("8-pin ic");
  });

  it("falls back to the tag when the part has no name", () => {
    expect(buildDatasheet(ic({ name: "", tag: "CEC9009" }), null).name).toBe(
      "CEC9009",
    );
  });
});

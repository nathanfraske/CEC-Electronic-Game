// SPDX-License-Identifier: Apache-2.0
// Headless tests for the built-in prefab reference library: it ships the curated cells and registers them
// ADDITIVELY (never clobbering a player's same-tag cell).
import { describe, it, expect } from "vitest";
import {
  getUserIc,
  isUserIc,
  registerUserIc,
  unregisterUserIc,
} from "../userIc";
import { PREFAB_USER_ICS, registerPrefabLibrary } from "./prefabs";

const cleanup = () => {
  for (const ic of PREFAB_USER_ICS) unregisterUserIc(ic.tag);
};

describe("prefab reference library", () => {
  it("ships the 16 curated building blocks", () => {
    expect(PREFAB_USER_ICS).toHaveLength(16);
    const tags = PREFAB_USER_ICS.map((c) => c.tag);
    for (const t of [
      "Inverter",
      "NAND Gate",
      "AND-Gate",
      "FULL ADDER",
      "D-FLIPFLOP",
      "4:1 MUX",
      "6T SRAM",
    ])
      expect(tags).toContain(t);
  });

  it("6T SRAM is bitline-only (no Q pin; BL/BLB are inout)", () => {
    const sram = PREFAB_USER_ICS.find((c) => c.tag === "6T SRAM")!;
    // Forced bitline lesson: read AND write only through BL/BLB + WL — there is NO direct Q output pin.
    expect(sram.pinNames).toEqual(["WL", "VCC", "GND", "BLB", "BL"]);
    expect(sram.pinNames).not.toContain("Q");
    expect(sram.pinRoles).toEqual(["in", "vcc", "gnd", "inout", "inout"]);
    expect(sram.package.pinCount).toBe(5);
  });

  it("registers every prefab so they're placeable", () => {
    try {
      registerPrefabLibrary();
      for (const ic of PREFAB_USER_ICS) expect(isUserIc(ic.tag)).toBe(true);
      expect(getUserIc("FULL ADDER")).toBeTruthy();
      // idempotent: a second call is a no-op (no throw, still present)
      registerPrefabLibrary();
      expect(isUserIc("NAND Gate")).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("is additive — never overwrites a player's existing same-tag cell", () => {
    const tag = PREFAB_USER_ICS[0].tag;
    try {
      registerUserIc({ ...PREFAB_USER_ICS[0], name: "PLAYER'S OWN" });
      registerPrefabLibrary();
      expect(getUserIc(tag)?.name).toBe("PLAYER'S OWN"); // prefab skipped, player's cell kept
    } finally {
      cleanup();
    }
  });
});

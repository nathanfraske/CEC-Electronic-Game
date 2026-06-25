// SPDX-License-Identifier: Apache-2.0
// Headless tests for the IC LIBRARY + USER-SELECTED VARIANTS feature (docs/ic-library-and-variants.md).
// Like netlist.test.ts these run in node — buildNetlist / flattenUserIcs / userIc compile there (glyphs
// import as types only) — so we can prove the determinism contract (golden-safe no-op; single-variant
// byte-identity; variant selection is a pure graph→graph choice) and the family round-trip without a
// browser. Mirrors netlist.test.ts's place/connect helpers + register/unregister harness.
import { describe, it, expect } from "vitest";
import { BoardGraph } from "./graph";
import type { Component } from "./graph";
import { buildNetlist } from "./netlist";
import {
  registerUserIc,
  unregisterUserIc,
  registerUserIcFamily,
  resolveUserIc,
  userIcVariants,
  hasUserIcVariants,
  userIcsForGraph,
  userIcFamiliesForGraph,
  registerUserIcs,
  registerUserIcFamilies,
  getUserIc,
  captureSeal,
  captureRegion,
  tapeOut,
  isReservedTag,
  derivePinRoles,
  integrationTier,
  type UserIc,
} from "./userIc";

function place(
  g: BoardGraph,
  kind: string,
  col: number,
  row: number,
  value?: number,
): Component {
  const c = g.place(kind, { col, row });
  if (!c) throw new Error("unknown kind: " + kind);
  if (value !== undefined) c.value = value;
  return c;
}

function connect(
  g: BoardGraph,
  a: Component,
  ai: number,
  b: Component,
  bi: number,
): void {
  g.connect(
    { componentId: a.id, pinIndex: ai },
    { componentId: b.id, pinIndex: bi },
  );
}

/** Build a "resistor in a SOT-23-3 package" UserIc def (pin1 -> R -> pin2) at a given ohms value. */
function rPackageDef(tag: string, ohms: number): UserIc {
  const inner = new BoardGraph();
  const frame = place(inner, "SOT23_3", 0, 0);
  const r = place(inner, "R", 4, 0, ohms);
  connect(inner, frame, 0, r, 0); // pin 1 -> R.A
  connect(inner, r, 1, frame, 1); // R.B -> pin 2
  return {
    tag,
    name: tag,
    package: { archetype: "SOT-23", pinCount: 3 },
    frameId: frame.id,
    graph: inner.serialize(),
  };
}

/** The inline reference netlist: V(5) + R(ohms) + GND, pin layout matching a placed IC pin1->pin2. */
function inlineRefValues(ohms: number): number[] {
  const flat = new BoardGraph();
  const vf = place(flat, "V", 0, 0, 5);
  const rf = place(flat, "R", 4, 0, ohms);
  const gf = place(flat, "GND", 0, 6);
  connect(flat, vf, 0, rf, 0);
  connect(flat, rf, 1, gf, 0);
  connect(flat, vf, 1, gf, 0);
  const b = buildNetlist(flat, false);
  expect(b).not.toBeNull();
  return [...b!.values];
}

describe("IC variants — determinism contract", () => {
  it("flatten is a strict no-op when no IC is placed (golden-safe)", () => {
    // A plain V+R+GND with NO user IC registered — buildNetlist runs flattenUserIcs internally, and
    // with REGISTRY + FAMILIES empty for this graph the early no-op return must fire (the golden's
    // exact situation). The element count is V + R, identical to no flatten pass.
    const g = new BoardGraph();
    const vs = place(g, "V", 0, 0, 5);
    const r = place(g, "R", 4, 0, 1000);
    const gnd = place(g, "GND", 0, 6);
    connect(g, vs, 0, r, 0);
    connect(g, r, 1, gnd, 0);
    connect(g, vs, 1, gnd, 0);
    const nl = buildNetlist(g, false);
    expect(nl).not.toBeNull();
    expect(nl!.types.length).toBe(2);
  });

  it("a single-variant IC inlines byte-identically to the inline circuit (no FAMILIES row)", () => {
    registerUserIc(rPackageDef("SINGLEVAR", 1000));
    try {
      // Single-variant: no family registered, resolveUserIc returns the flat REGISTRY entry.
      expect(userIcVariants("SINGLEVAR")).toBeNull();
      expect(hasUserIcVariants("SINGLEVAR")).toBe(false);
      expect(resolveUserIc("SINGLEVAR")?.tag).toBe("SINGLEVAR");

      const sealed = new BoardGraph();
      const vs = place(sealed, "V", 0, 0, 5);
      const ic = place(sealed, "SINGLEVAR", 4, 0);
      const gnd = place(sealed, "GND", 0, 6);
      connect(sealed, vs, 0, ic, 0);
      connect(sealed, ic, 1, gnd, 0);
      connect(sealed, vs, 1, gnd, 0);
      const a = buildNetlist(sealed, false);
      expect(a).not.toBeNull();
      expect([...a!.values]).toEqual(inlineRefValues(1000));
      expect(a!.types.length).toBe(2); // V + the inner R
    } finally {
      unregisterUserIc("SINGLEVAR");
    }
  });

  it("resolveUserIc clamps an out-of-range variant deterministically", () => {
    registerUserIcFamily("CLAMPFAM", "Clamp Family", [
      rPackageDef("v0", 1000),
      rPackageDef("v1", 2000),
    ]);
    try {
      // In range.
      expect(resolveUserIc("CLAMPFAM", 0)?.graph.components.length).toBe(2);
      // Above range clamps to the LAST variant (index 1 -> 2k); negative clamps to 0; fractional rounds.
      const last = resolveUserIc("CLAMPFAM", 99);
      const lastR = last!.graph.components.find((c) => c.kind === "R");
      expect(lastR!.value).toBe(2000);
      const neg = resolveUserIc("CLAMPFAM", -5);
      const negR = neg!.graph.components.find((c) => c.kind === "R");
      expect(negR!.value).toBe(1000);
      // Deterministic: same input -> same def each call.
      expect(resolveUserIc("CLAMPFAM", 99)?.tag).toBe(
        resolveUserIc("CLAMPFAM", 99)?.tag,
      );
    } finally {
      unregisterUserIc("CLAMPFAM");
    }
  });

  it("a multi-variant family: variant 0 vs 1 inline the CORRECT distinct inner graph; switching is deterministic", () => {
    registerUserIcFamily("FAM", "Resistor Family", [
      rPackageDef("strong", 1000),
      rPackageDef("weak", 4700),
    ]);
    try {
      expect(hasUserIcVariants("FAM")).toBe(true);
      expect((userIcVariants("FAM") ?? []).length).toBe(2);

      const buildWith = (variant: number): number[] => {
        const g = new BoardGraph();
        const vs = place(g, "V", 0, 0, 5);
        const ic = place(g, "FAM", 4, 0);
        ic.variant = variant; // the placed instance's variant index
        const gnd = place(g, "GND", 0, 6);
        connect(g, vs, 0, ic, 0);
        connect(g, ic, 1, gnd, 0);
        connect(g, vs, 1, gnd, 0);
        const nl = buildNetlist(g, false);
        expect(nl).not.toBeNull();
        return [...nl!.values];
      };

      // Variant 0 inlines the 1k die; variant 1 inlines the 4.7k die — each equals its inline reference.
      expect(buildWith(0)).toEqual(inlineRefValues(1000));
      expect(buildWith(1)).toEqual(inlineRefValues(4700));
      // Default (no variant set) is variant 0.
      const g = new BoardGraph();
      const vs = place(g, "V", 0, 0, 5);
      const ic = place(g, "FAM", 4, 0); // no variant => 0
      const gnd = place(g, "GND", 0, 6);
      connect(g, vs, 0, ic, 0);
      connect(g, ic, 1, gnd, 0);
      connect(g, vs, 1, gnd, 0);
      const nl = buildNetlist(g, false);
      expect([...nl!.values]).toEqual(inlineRefValues(1000));
      // Switching is deterministic: building the same variant twice yields identical values.
      expect(buildWith(1)).toEqual(buildWith(1));
    } finally {
      unregisterUserIc("FAM");
    }
  });

  it("nested multi-variant userIcsForGraph embeds ALL variants of every placed family + recurses each variant's die (gap #3)", () => {
    // Two leaf single ICs the family variants will nest.
    registerUserIc(rPackageDef("LEAFA", 1000));
    registerUserIc(rPackageDef("LEAFB", 2000));

    // Build a family OUTER whose TWO variants each PLACE a DIFFERENT leaf inside their die — so the
    // transitive scan must (a) push both OUTER variants, (b) recurse into EACH variant's graph to find
    // its distinct leaf. The old family-tag dedup would visit OUTER once and miss variant 1's leaf.
    const variantDie = (leafTag: string): UserIc => {
      const die = new BoardGraph();
      const frame = place(die, "SOT23_3", 0, 0);
      const leaf = place(die, leafTag, 6, 0);
      connect(die, frame, 0, leaf, 0);
      connect(die, leaf, 1, frame, 1);
      return {
        tag: "ignored", // overwritten with the child tag by registerUserIcFamily
        name: "outer variant",
        package: { archetype: "SOT-23", pinCount: 3 },
        frameId: frame.id,
        graph: die.serialize(),
      };
    };
    registerUserIcFamily("OUTERFAM", "Outer Family", [
      variantDie("LEAFA"),
      variantDie("LEAFB"),
    ]);

    try {
      // A board that places ONLY the OUTERFAM family tag (the leaves live solely inside its variant dies).
      const board = new BoardGraph();
      const vs = place(board, "V", 0, 0, 5);
      const ic = place(board, "OUTERFAM", 4, 0);
      const gnd = place(board, "GND", 0, 6);
      connect(board, vs, 0, ic, 0);
      connect(board, ic, 1, gnd, 0);
      connect(board, vs, 1, gnd, 0);

      const defs = userIcsForGraph(board.serialize());
      const tags = defs.map((d) => d.tag).sort();
      // BOTH family-variant child defs AND BOTH transitively-nested leaves must be embedded.
      expect(tags).toContain("OUTERFAM#0");
      expect(tags).toContain("OUTERFAM#1");
      expect(tags).toContain("LEAFA");
      expect(tags).toContain("LEAFB"); // the gap-#3 failure: this would be DROPPED with family-tag dedup

      // The save sidecar carries the family in ORDER (the durable variant-index source of truth, gap #4).
      const sidecar = userIcFamiliesForGraph(board.serialize());
      const outer = sidecar.find((s) => s.family === "OUTERFAM");
      expect(outer).not.toBeUndefined();
      expect(outer!.variantTags).toEqual(["OUTERFAM#0", "OUTERFAM#1"]);
    } finally {
      unregisterUserIc("OUTERFAM");
      unregisterUserIc("LEAFA");
      unregisterUserIc("LEAFB");
    }
  });

  it("family save round-trip: variant index resolves to the SAME die after a fresh-session reload (gap #4)", () => {
    registerUserIcFamily("RTFAM", "Round Trip Family", [
      rPackageDef("a", 1000),
      rPackageDef("b", 3300),
    ]);
    try {
      const board = new BoardGraph();
      const vs = place(board, "V", 0, 0, 5);
      const ic = place(board, "RTFAM", 4, 0);
      ic.variant = 1; // pin the instance to variant 1 (the 3.3k die)
      const gnd = place(board, "GND", 0, 6);
      connect(board, vs, 0, ic, 0);
      connect(board, ic, 1, gnd, 0);
      connect(board, vs, 1, gnd, 0);

      const defs = userIcsForGraph(board.serialize());
      const sidecar = userIcFamiliesForGraph(board.serialize());

      // Fresh session: forget the family, then restore ONLY from the round-tripped envelope.
      const wireDefs = JSON.parse(JSON.stringify(defs)) as typeof defs;
      const wireSidecar = JSON.parse(JSON.stringify(sidecar)) as typeof sidecar;
      unregisterUserIc("RTFAM");
      expect(getUserIc("RTFAM")).toBeUndefined();
      registerUserIcs(wireDefs); // installs the flat child defs (skips nothing — `#` defs go via family)
      registerUserIcFamilies(wireSidecar); // regroups in sidecar order
      expect(hasUserIcVariants("RTFAM")).toBe(true);

      // The placed instance (still variant 1) must inline the 3.3k die — proving the integer index
      // still points at the SAME die after reload (order preserved).
      const a = buildNetlist(board, false);
      expect(a).not.toBeNull();
      expect([...a!.values]).toEqual(inlineRefValues(3300));
    } finally {
      unregisterUserIc("RTFAM");
    }
  });

  it("seal-as-variant-of (die-editor path): captureSeal(intoFamily) promotes a single IC into a family and round-trips", () => {
    // FIRST seal: a fresh single IC (1k R in SOT-23-3) via captureSeal (no intoFamily).
    const a1 = new BoardGraph();
    const f1 = place(a1, "SOT23_3", 0, 0);
    const r1 = place(a1, "R", 4, 0, 1000);
    connect(a1, f1, 0, r1, 0);
    connect(a1, r1, 1, f1, 1);
    const cap1 = captureSeal(a1, f1.id, "PROMO");
    expect(cap1).not.toBeUndefined();
    try {
      expect(hasUserIcVariants("PROMO")).toBe(false); // a single IC so far

      // SECOND seal INTO "PROMO" (a 2.2k R, SAME package): promotes it to a 2-variant family.
      const a2 = new BoardGraph();
      const f2 = place(a2, "SOT23_3", 0, 0);
      const r2 = place(a2, "R", 4, 0, 2200);
      connect(a2, f2, 0, r2, 0);
      connect(a2, r2, 1, f2, 1);
      const cap2 = captureSeal(a2, f2.id, "v2", "PROMO");
      expect(cap2).not.toBeUndefined();
      expect(cap2!.tag).toBe("PROMO"); // the placed instance is the FAMILY tag
      expect(hasUserIcVariants("PROMO")).toBe(true);
      expect((userIcVariants("PROMO") ?? []).length).toBe(2);
      // Variant 0 is the original 1k; variant 1 the new 2.2k.
      expect(
        resolveUserIc("PROMO", 0)!.graph.components.find((c) => c.kind === "R")!
          .value,
      ).toBe(1000);
      expect(
        resolveUserIc("PROMO", 1)!.graph.components.find((c) => c.kind === "R")!
          .value,
      ).toBe(2200);

      // A package MISMATCH is refused (v1 same-package constraint): an 8-pin DIP die can't join.
      const a3 = new BoardGraph();
      const f3 = place(a3, "DIP8", 0, 0);
      const r3 = place(a3, "R", 4, 0, 3300);
      connect(a3, f3, 0, r3, 0);
      connect(a3, r3, 1, f3, 1);
      expect(captureSeal(a3, f3.id, "v3", "PROMO")).toBeUndefined();
      expect((userIcVariants("PROMO") ?? []).length).toBe(2); // unchanged

      // ROUND-TRIP the promoted family via the board-embed + sidecar (the die-editor save path).
      const board = new BoardGraph();
      const vs = place(board, "V", 0, 0, 5);
      const ic = place(board, "PROMO", 4, 0);
      ic.variant = 1; // pin to the 2.2k die
      const gnd = place(board, "GND", 0, 6);
      connect(board, vs, 0, ic, 0);
      connect(board, ic, 1, gnd, 0);
      connect(board, vs, 1, gnd, 0);

      const defs = userIcsForGraph(board.serialize());
      const sidecar = userIcFamiliesForGraph(board.serialize());
      // Variant-0 def must carry its CHILD tag "PROMO#0" in the embed (not the family tag), else the
      // family can't regroup on reload.
      expect(defs.map((d) => d.tag).sort()).toEqual(["PROMO#0", "PROMO#1"]);
      expect(sidecar[0].variantTags).toEqual(["PROMO#0", "PROMO#1"]);

      const wireDefs = JSON.parse(JSON.stringify(defs)) as typeof defs;
      const wireSidecar = JSON.parse(JSON.stringify(sidecar)) as typeof sidecar;
      unregisterUserIc("PROMO");
      registerUserIcs(wireDefs);
      registerUserIcFamilies(wireSidecar);
      expect(hasUserIcVariants("PROMO")).toBe(true);

      // The placed variant-1 instance still inlines the 2.2k die after the round-trip.
      const a = buildNetlist(board, false);
      expect([...a!.values]).toEqual(inlineRefValues(2200));
    } finally {
      unregisterUserIc("PROMO");
    }
  });

  it("reserved-tag guard refuses a seal tag that collides with a built-in (gap #8)", () => {
    // isReservedTag knows the built-ins (R, V, GND), die-frames, and the `#` separator.
    expect(isReservedTag("R")).toBe(true);
    expect(isReservedTag("GND")).toBe(true);
    expect(isReservedTag("SOT23_3")).toBe(true); // a frame kind
    expect(isReservedTag("__DIE_SOT23_3")).toBe(true);
    expect(isReservedTag("FOO#0")).toBe(true);
    expect(isReservedTag("MyInverter")).toBe(false);

    // captureSeal must REFUSE a free-form name that collides with a built-in — so registerLibrary()
    // can never clobber `R` at startup. The frame is left un-sealed (returns undefined).
    const author = new BoardGraph();
    const frame = place(author, "SOT23_3", 0, 0);
    const r = place(author, "R", 4, 0, 1000);
    connect(author, frame, 0, r, 0);
    connect(author, r, 1, frame, 1);
    expect(captureSeal(author, frame.id, "R")).toBeUndefined();
    expect(captureSeal(author, frame.id, "GND")).toBeUndefined();
    // A non-reserved name seals fine.
    const cap = captureSeal(author, frame.id, "MyRpack");
    expect(cap).not.toBeUndefined();
    try {
      expect(cap!.tag).toBe("MyRpack");
    } finally {
      unregisterUserIc("MyRpack");
    }
  });

  it("role flag (P1): default seal is role-absent ('ic'); an explicit 'subassembly' round-trips on the def", () => {
    // Default seal: role is ABSENT so every existing save is byte-identical and the cell is board-placeable.
    const a1 = new BoardGraph();
    const f1 = place(a1, "SOT23_3", 0, 0);
    const r1 = place(a1, "R", 4, 0, 1000);
    connect(a1, f1, 0, r1, 0);
    connect(a1, r1, 1, f1, 1);
    const cap1 = captureSeal(a1, f1.id, "RoleDefault");
    expect(cap1).not.toBeUndefined();
    try {
      expect(getUserIc("RoleDefault")?.role).toBeUndefined(); // absent ⇒ 'ic'
    } finally {
      unregisterUserIc("RoleDefault");
    }

    // Explicit subassembly: the role bit persists on the def (read by entryRole for the bin split).
    const a2 = new BoardGraph();
    const f2 = place(a2, "SOT23_3", 0, 0);
    const r2 = place(a2, "R", 4, 0, 2200);
    connect(a2, f2, 0, r2, 0);
    connect(a2, r2, 1, f2, 1);
    const cap2 = captureSeal(a2, f2.id, "RoleSub", undefined, "subassembly");
    expect(cap2).not.toBeUndefined();
    try {
      expect(getUserIc("RoleSub")?.role).toBe("subassembly");
    } finally {
      unregisterUserIc("RoleSub");
    }
  });

  it("pin roles + integration tier (P3): derivePinRoles tags from stimulus+name; integrationTier counts devices", () => {
    // Stimulus authoritatively tags rails/inputs; the name fills in the output (which carries no test).
    const roles = derivePinRoles(
      ["Y", "A", "VCC", "GND"],
      [
        null,
        { role: "in", value: 0 },
        { role: "vcc", value: 5 },
        { role: "gnd", value: 0 },
      ],
      4,
    );
    expect(roles[0]).toBe("out"); // Y, by name (no stimulus on the output)
    expect(roles[1]).toBe("in"); // A, by stimulus
    expect(roles[2]).toBe("vcc");
    expect(roles[3]).toBe("gnd");

    // integrationTier counts active devices over the expansion (the die frame is skipped): a 1-part
    // cell is SSI.
    expect(integrationTier(rPackageDef("TierR", 1000))).toBe("SSI");
  });

  it("tape out (P3b): promotes a subassembly to a board IC; re-package grows pins; no-op on an IC", () => {
    // Seal a bare subassembly (role='subassembly') in a 3-pin package.
    const a = new BoardGraph();
    const f = place(a, "SOT23_3", 0, 0);
    const r = place(a, "R", 4, 0, 1500);
    connect(a, f, 0, r, 0);
    connect(a, r, 1, f, 1);
    const cap = captureSeal(a, f.id, "SubR", undefined, "subassembly");
    expect(cap).not.toBeUndefined();
    try {
      expect(getUserIc("SubR")?.role).toBe("subassembly");
      const devicesBefore = getUserIc("SubR")!.graph.components.length;

      // Tape out with a bigger package: promotes to 'ic', grows to 5 pins, preserves the inner circuit.
      const promoted = tapeOut("SubR", { archetype: "SOT-23", pinCount: 5 });
      expect(promoted?.role).toBe("ic");
      expect(promoted?.package).toEqual({ archetype: "SOT-23", pinCount: 5 });
      expect(getUserIc("SubR")?.role).toBe("ic");
      // Connectivity preserved (same component count — only the frame's body kind changed).
      expect(getUserIc("SubR")!.graph.components.length).toBe(devicesBefore);

      // Tape out is a no-op on a cell that is already an IC (nothing to promote).
      expect(tapeOut("SubR")).toBeUndefined();
    } finally {
      unregisterUserIc("SubR");
    }

    // Keep-package tape out (the common "confirm the pinout") leaves the package untouched.
    const b = new BoardGraph();
    const f2 = place(b, "SOT23_3", 0, 0);
    const r2 = place(b, "R", 4, 0, 2200);
    connect(b, f2, 0, r2, 0);
    connect(b, r2, 1, f2, 1);
    captureSeal(b, f2.id, "SubR2", undefined, "subassembly");
    try {
      const promoted = tapeOut("SubR2");
      expect(promoted?.role).toBe("ic");
      expect(promoted?.package).toEqual({ archetype: "SOT-23", pinCount: 3 });
    } finally {
      unregisterUserIc("SubR2");
    }
  });

  it("captureRegion (P4): box-select infers boundary pins, names rails, builds a correct subassembly", () => {
    // Board: V+ → R1 → R2 → GND (series), V− → GND. Select {R1, R2}: the R1–R2 net is internal; the
    // V-side and GND-side nets cross the boundary → two pins (VCC + GND).
    const b = new BoardGraph();
    const v = place(b, "V", 0, 0, 5);
    const r1 = place(b, "R", 4, 0, 1000);
    const r2 = place(b, "R", 8, 0, 2000);
    const gnd = place(b, "GND", 12, 0);
    connect(b, v, 0, r1, 0); // V+ → R1.A   (boundary: VCC)
    connect(b, r1, 1, r2, 0); // R1.B → R2.A (internal)
    connect(b, r2, 1, gnd, 0); // R2.B → GND  (boundary: GND)
    connect(b, v, 1, gnd, 0); // V− → GND

    const cap = captureRegion(b, [r1.id, r2.id], "SeriesR");
    expect(cap).not.toBeUndefined();
    try {
      expect(cap!.pinCount).toBe(2);
      const def = getUserIc("SeriesR")!;
      expect(def.role).toBe("subassembly");
      expect(def.package.pinCount).toBeGreaterThanOrEqual(2); // smallest covering package (SOT-23-3)
      expect(def.pinNames).toContain("VCC"); // outside V source → VCC pin
      expect(def.pinNames).toContain("GND"); // outside GND → GND pin

      // The subassembly flattens to the real 2-resistor series chain when placed + powered.
      const g = new BoardGraph();
      const vs = place(g, "V", 0, 0, 5);
      const gg = place(g, "GND", 0, 6);
      const sub = place(g, "SeriesR", 4, 0);
      const vccPin = def.pinNames!.indexOf("VCC");
      const gndPin = def.pinNames!.indexOf("GND");
      connect(g, vs, 0, sub, vccPin);
      connect(g, sub, gndPin, gg, 0);
      connect(g, vs, 1, gg, 0);
      const nl = buildNetlist(g, false);
      expect(nl).not.toBeNull();
      // V + R1 + R2 = 3 elements (the frame flattens away; GND is not an element).
      expect(nl!.types.length).toBe(3);
    } finally {
      unregisterUserIc("SeriesR");
    }

    // A region with NO boundary (select the WHOLE circuit) is refused — nothing leaves the selection.
    const b2 = new BoardGraph();
    const v2 = place(b2, "V", 0, 0, 5);
    const r = place(b2, "R", 4, 0, 1000);
    const gnd2 = place(b2, "GND", 8, 0);
    connect(b2, v2, 0, r, 0);
    connect(b2, r, 1, gnd2, 0);
    connect(b2, v2, 1, gnd2, 0);
    expect(captureRegion(b2, [v2.id, r.id, gnd2.id])).toBeUndefined();
    // An empty selection is refused too.
    expect(captureRegion(b2, [])).toBeUndefined();
  });

  it("registerUserIcs skips a def whose tag collides with a built-in (clobber-safety, gap #6)", () => {
    // A malicious/legacy save embedding a def tagged "R" must NOT overwrite the built-in resistor kind.
    const rogue: UserIc = rPackageDef("R", 1000); // tag "R" collides with the built-in
    registerUserIcs([rogue]);
    // The built-in R is untouched: a placed plain R still compiles to a normal resistor (no inner
    // package expansion), and "R" did not become a user IC.
    const g = new BoardGraph();
    const vs = place(g, "V", 0, 0, 5);
    const r = place(g, "R", 4, 0, 2200);
    const gnd = place(g, "GND", 0, 6);
    connect(g, vs, 0, r, 0);
    connect(g, r, 1, gnd, 0);
    connect(g, vs, 1, gnd, 0);
    const nl = buildNetlist(g, false);
    expect(nl).not.toBeNull();
    expect([...nl!.values]).toEqual(inlineRefValues(2200));
    expect(getUserIc("R")).toBeUndefined(); // "R" was NOT registered as a user IC
  });
});

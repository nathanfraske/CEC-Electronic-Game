// SPDX-License-Identifier: Apache-2.0
// Headless tests for the IC LIBRARY + USER-SELECTED VARIANTS feature (docs/ic-library-and-variants.md).
// Like netlist.test.ts these run in node — buildNetlist / flattenUserIcs / userIc compile there (glyphs
// import as types only) — so we can prove the determinism contract (golden-safe no-op; single-variant
// byte-identity; variant selection is a pure graph→graph choice) and the family round-trip without a
// browser. Mirrors netlist.test.ts's place/connect helpers + register/unregister harness.
import { describe, it, expect } from "vitest";
import {
  BoardGraph,
  registerFreeFormFrame,
  FREE_FORM_DIE_PREFIX,
} from "./graph";
import type { Component } from "./graph";
import { buildNetlist } from "./netlist";
import { sweepNetlist } from "./sweepNetlist";
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
  importUserIcs,
  applyTagRemap,
  getUserIc,
  captureSeal,
  captureRegion,
  previewRegion,
  cellBehaviorSig,
  recognizeGate,
  setUserIcBehavior,
  resealUserIc,
  tapeOut,
  isReservedTag,
  derivePinRoles,
  roleFromName,
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

  it("roleFromName recognizes the control-pin family + complemented (bar) names", () => {
    // The original synonyms still resolve.
    expect(roleFromName("VCC")).toBe("vcc");
    expect(roleFromName("GND")).toBe("gnd");
    expect(roleFromName("CLK")).toBe("clk");
    expect(roleFromName("Q")).toBe("out");
    expect(roleFromName("D")).toBe("in");
    // Clear / reset / preset / set are control INPUTS (the bug: "CLR" used to fall through to undefined,
    // so an added clear pin carried no role and the characterization sweep skipped it).
    for (const n of [
      "CLR",
      "CLEAR",
      "RST",
      "RESET",
      "MR",
      "PRE",
      "PRESET",
      "SET",
    ])
      expect(roleFromName(n)).toBe("in");
    // Enable / select / load / memory / FF+adder data — also inputs.
    for (const n of [
      "EN",
      "ENABLE",
      "OE",
      "SEL",
      "LD",
      "LOAD",
      "CE",
      "WE",
      "J",
      "K",
      "T",
      "CIN",
    ])
      expect(roleFromName(n)).toBe("in");
    // Complemented outputs (Q-bar) + adder outputs.
    for (const n of ["QB", "QN", "NQ", "SUM", "COUT"])
      expect(roleFromName(n)).toBe("out");
    // A trailing bar marker resolves to the BASE name's role (active-low input stays in; out-bar stays out).
    expect(roleFromName("EN_BAR")).toBe("in"); // enable complement
    expect(roleFromName("ENB")).toBe("in");
    expect(roleFromName("SEL_BAR")).toBe("in"); // the latch's select complement
    expect(roleFromName("Q_BAR")).toBe("out");
    expect(roleFromName("QBAR")).toBe("out");
    expect(roleFromName("CLK_N")).toBe("clk"); // clock complement keeps the clk role
    // A BUS INDEX resolves to the base letter's role (the 4-bit register's Q0..Q3 / D0..D3 bug).
    for (const n of ["Q0", "Q1", "Q2", "Q3"])
      expect(roleFromName(n)).toBe("out");
    for (const n of ["D0", "D3", "A1", "B2"])
      expect(roleFromName(n)).toBe("in");
    expect(roleFromName("Q0_BAR")).toBe("out"); // indexed + complemented
    expect(roleFromName("CLK0")).toBe("clk");
    // Still undefined for genuinely unknown names (no false positives), incl. the bare bar marker / index.
    expect(roleFromName("FOO")).toBeUndefined();
    expect(roleFromName("BAR")).toBeUndefined();
    expect(roleFromName("0")).toBeUndefined();
  });

  describe("importUserIcs — merge a save's library WITHOUT clobbering", () => {
    // A parent IC that PLACES a child IC inside its die (so we can test nested-reference remap). `childTag`
    // must already be a registered kind when this is built.
    const parentPlacing = (tag: string, childTag: string): UserIc => {
      const inner = new BoardGraph();
      const frame = place(inner, "SOT23_3", 0, 0);
      const child = place(inner, childTag, 4, 0);
      connect(inner, frame, 0, child, 0);
      connect(inner, child, 1, frame, 1);
      return {
        tag,
        name: tag,
        package: { archetype: "SOT-23", pinCount: 3 },
        frameId: frame.id,
        graph: inner.serialize(),
      };
    };
    const rOf = (tag: string): number | undefined =>
      getUserIc(tag)?.graph.components.find((c) => c.kind === "R")?.value;

    it("installs a NEW tag as-is (no conflict ⇒ empty remap)", () => {
      const { remap } = importUserIcs([rPackageDef("IMP_NEW", 1000)]);
      try {
        expect(remap.size).toBe(0);
        expect(rOf("IMP_NEW")).toBe(1000);
      } finally {
        unregisterUserIc("IMP_NEW");
      }
    });

    it("DEDUPS a structurally-identical re-import (no copy, no remap)", () => {
      registerUserIc(rPackageDef("IMP_DUP", 1000));
      try {
        const { remap } = importUserIcs([rPackageDef("IMP_DUP", 1000)]);
        expect(remap.size).toBe(0);
        expect(getUserIc("IMP_DUP (2)")).toBeUndefined(); // no duplicate minted
        expect(rOf("IMP_DUP")).toBe(1000);
      } finally {
        unregisterUserIc("IMP_DUP");
      }
    });

    it("a CONFLICTING tag imports under a fresh tag; the existing library version is untouched", () => {
      registerUserIc(rPackageDef("IMP_CONF", 1000)); // current library = 1k
      try {
        const { remap } = importUserIcs([rPackageDef("IMP_CONF", 4700)]); // incoming = 4.7k, same tag
        expect(remap.get("IMP_CONF")).toBe("IMP_CONF (2)");
        expect(rOf("IMP_CONF")).toBe(1000); // existing kept
        expect(rOf("IMP_CONF (2)")).toBe(4700); // incoming imported as a copy
      } finally {
        unregisterUserIc("IMP_CONF");
        unregisterUserIc("IMP_CONF (2)");
      }
    });

    it("rewrites a NESTED parent onto the remapped child (the whole loaded blob stays faithful)", () => {
      registerUserIc(rPackageDef("KID", 1000)); // current KID = 1k
      try {
        const parent = parentPlacing("MOM", "KID"); // MOM places KID
        // Incoming: a DIFFERENT KID (4.7k) + MOM. KID conflicts ⇒ KID (2); MOM's placed KID must follow.
        const { remap } = importUserIcs([rPackageDef("KID", 4700), parent]);
        try {
          expect(remap.get("KID")).toBe("KID (2)");
          expect(rOf("KID")).toBe(1000); // existing KID untouched
          expect(rOf("KID (2)")).toBe(4700); // imported KID copy
          // MOM installed, and its inner placed child now points at the imported KID (2), not the old KID.
          const momKinds = getUserIc("MOM")?.graph.components.map(
            (c) => c.kind,
          );
          expect(momKinds).toContain("KID (2)");
          expect(momKinds).not.toContain("KID");
        } finally {
          unregisterUserIc("MOM");
          unregisterUserIc("KID (2)");
        }
      } finally {
        unregisterUserIc("KID");
      }
    });

    it("applyTagRemap rewrites only the remapped component kinds (a no-op on an empty map)", () => {
      const board = {
        components: [
          {
            id: 1,
            kind: "IMP_CONF",
            cell: { col: 0, row: 0 },
            value: 0,
            rot: 0,
          },
          { id: 2, kind: "R", cell: { col: 4, row: 0 }, value: 1000, rot: 0 },
        ],
        wires: [],
        junctions: [],
        netLabels: [],
      } as unknown as Parameters<typeof applyTagRemap>[0];
      const out = applyTagRemap(board, new Map([["IMP_CONF", "IMP_CONF (2)"]]));
      expect(out.components[0]!.kind).toBe("IMP_CONF (2)");
      expect(out.components[1]!.kind).toBe("R"); // untouched
      expect(applyTagRemap(board, new Map())).toBe(board); // empty remap ⇒ same object
    });
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
      // Free-form block with EXACTLY its boundary pins (§4.10), not rounded up to a stock package.
      expect(def.package.archetype).toBe("BLOCK");
      expect(def.package.pinCount).toBe(2);
      expect(def.pinNames).toContain("VCC"); // outside V source → VCC pin
      expect(def.pinNames).toContain("GND"); // outside GND → GND pin

      // 1:1 copy: the captured graph holds R1 + R2 (+ the free-form frame) — the real parts, not a
      // re-laid-out fan. And it carries free-form geometry (a box + a pin per crossing).
      const nonFrame = def.graph.components.filter((c) => c.kind === "R");
      expect(nonFrame.length).toBe(2);
      expect(def.freeForm).toBeDefined();
      expect(def.freeForm!.pins.length).toBe(2);
      expect(def.freeForm!.w).toBeGreaterThan(0);
      expect(def.freeForm!.h).toBeGreaterThan(0);
      // Every pin sits ON the box edge (a crossing point), not floating inside.
      for (const p of def.freeForm!.pins) {
        const onEdge =
          p.dx === 0 ||
          p.dx === def.freeForm!.w - 1 ||
          p.dy === 0 ||
          p.dy === def.freeForm!.h - 1;
        expect(onEdge).toBe(true);
      }

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

  it("captureRegion audit fixes: distinct pins (same-side), reseal keeps freeForm/role, tape-out drops freeForm", () => {
    // Same-side collision: a resistor whose BOTH pins exit RIGHT to two GND parts on the same row —
    // before the fix both crossings resolved to the same edge cell. Pins must be pairwise-distinct.
    const c = new BoardGraph();
    const r = place(c, "R", 4, 4, 1000);
    const g1 = place(c, "GND", 10, 4);
    const g2 = place(c, "GND", 12, 4);
    connect(c, r, 0, g1, 0); // R.A → GND (right)
    connect(c, r, 1, g2, 0); // R.B → GND (right)
    const capC = captureRegion(c, [r.id], "Coll");
    expect(capC).not.toBeUndefined();
    try {
      const def = getUserIc("Coll")!;
      expect(def.freeForm!.pins.length).toBe(2);
      const cells = new Set(def.freeForm!.pins.map((p) => `${p.dx},${p.dy}`));
      expect(cells.size).toBe(2); // pairwise-distinct edge cells

      // Reseal (the standard die-editor edit path) must PRESERVE freeForm + role (audit blocker).
      resealUserIc("Coll", def.graph, def.frameId, def.pinNames);
      const after = getUserIc("Coll")!;
      expect(after.freeForm).toBeDefined();
      expect(after.role).toBe("subassembly");

      // Tape out onto a real package must DROP freeForm so the chosen package lays out the footprint.
      const promoted = tapeOut("Coll", { archetype: "SOT-23", pinCount: 5 });
      expect(promoted?.freeForm).toBeUndefined();
      expect(promoted?.package).toEqual({ archetype: "SOT-23", pinCount: 5 });
    } finally {
      unregisterUserIc("Coll");
    }
  });

  it("previewRegion (live tool): the overlay preview agrees pin-for-pin with the sealed capture", () => {
    // The live rectangle tool draws previewRegion's box + pins as you size the rect; sealing then runs
    // captureRegion. They MUST place the same pins at the same cells, or the overlay lies. Same series
    // R1→R2 board as the captureRegion test.
    const b = new BoardGraph();
    const v = place(b, "V", 0, 0, 5);
    const r1 = place(b, "R", 4, 0, 1000);
    const r2 = place(b, "R", 8, 0, 2000);
    const gnd = place(b, "GND", 12, 0);
    connect(b, v, 0, r1, 0);
    connect(b, r1, 1, r2, 0);
    connect(b, r2, 1, gnd, 0);
    connect(b, v, 1, gnd, 0);

    const pre = previewRegion(b, [r1.id, r2.id]);
    expect(pre.ok).toBe(true);
    if (!pre.ok) return;
    expect(pre.pins.length).toBe(2);
    expect(pre.pins.map((p) => p.name).sort()).toEqual(["GND", "VCC"]);

    const cap = captureRegion(b, [r1.id, r2.id], "PreSeal");
    expect(cap).not.toBeUndefined();
    try {
      const def = getUserIc("PreSeal")!;
      // The preview box (absolute cells) maps onto the sealed free-form box: same width/height, and each
      // preview pin's ABSOLUTE cell equals its box-relative (dx,dy) offset from the preview box origin.
      expect(pre.w).toBe(def.freeForm!.w);
      expect(pre.h).toBe(def.freeForm!.h);
      const sealedAbs = new Set(
        def.freeForm!.pins.map(
          (p) => `${pre.minCol + p.dx},${pre.minRow + p.dy}`,
        ),
      );
      for (const p of pre.pins)
        expect(sealedAbs.has(`${p.col},${p.row}`)).toBe(true);
    } finally {
      unregisterUserIc("PreSeal");
    }

    // Refusal reasons surface so the overlay can explain them: empty selection, and a no-boundary region.
    expect(previewRegion(b, [])).toEqual({ ok: false, reason: "empty" });
    expect(previewRegion(b, [v.id, r1.id, r2.id, gnd.id])).toEqual({
      ok: false,
      reason: "no-boundary",
    });
  });

  it("region pins land on the edge the trace EXITS (aligned to the wire, not the inside pin)", () => {
    // R inside the box: one lead wired straight UP to a GND above it, one wired straight RIGHT to a V on
    // the same row. The GND net must exit the TOP edge (a vertical trace), the V net the RIGHT edge (a
    // horizontal trace) — i.e. the pin sits where the wire crosses, not just "nearest the inside pin".
    const b = new BoardGraph();
    const r = place(b, "R", 5, 5, 1000);
    const gnd = place(b, "GND", 5, 0); // directly ABOVE R.A → vertical exit (top edge)
    const v = place(b, "V", 15, 5, 5); // to the RIGHT of R.B → horizontal exit (right edge)
    connect(b, r, 0, gnd, 0); // R.A (5,5) → GND (5,0)
    connect(b, r, 1, v, 0); // R.B → V (15,5)
    const cap = captureRegion(b, [r.id], "ExitDir");
    expect(cap).not.toBeUndefined();
    try {
      const def = getUserIc("ExitDir")!;
      const ff = def.freeForm!;
      const gndPin = ff.pins[def.pinNames!.indexOf("GND")];
      const vccPin = ff.pins[def.pinNames!.indexOf("VCC")];
      expect(gndPin).toBeDefined();
      expect(vccPin).toBeDefined();
      expect(gndPin.dy).toBe(0); // GND trace exits UP → top edge
      expect(vccPin.dx).toBe(ff.w - 1); // V trace exits RIGHT → right edge
    } finally {
      unregisterUserIc("ExitDir");
    }
  });

  it("capture preserves a JUNCTION 1:1 (a branched net keeps its junction, doesn't fan out)", () => {
    // V (outside) → junction J → R1.A and J → R2.A (both inside): the net BRANCHES at J inside the box.
    // The capture must keep J — one wire frame_pin→J, then J→R1 and J→R2 — not re-pin each resistor to
    // the frame separately (the fan-out the owner saw). Box drawn to ENCLOSE the junction.
    const b = new BoardGraph();
    const v = place(b, "V", 0, 5, 5);
    const r1 = place(b, "R", 10, 3, 1000);
    const r2 = place(b, "R", 10, 8, 2000);
    const gnd = place(b, "GND", 20, 5);
    const j = b.addJunction({ col: 8, row: 5 }); // inside the box, between V and the resistors
    b.connect({ componentId: v.id, pinIndex: 0 }, { junctionId: j.id }); // V → J (crosses the edge)
    b.connect({ junctionId: j.id }, { componentId: r1.id, pinIndex: 0 }); // J → R1.A (internal)
    b.connect({ junctionId: j.id }, { componentId: r2.id, pinIndex: 0 }); // J → R2.A (internal)
    b.connect(
      { componentId: r1.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
    b.connect(
      { componentId: r2.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );

    const cap = captureRegion(b, [r1.id, r2.id], "Junc", {
      minCol: 6,
      minRow: 1,
      maxCol: 16,
      maxRow: 11,
    });
    expect(cap).not.toBeUndefined();
    try {
      const def = getUserIc("Junc")!;
      // The branch junction survives in the captured graph (without the fix it was dissolved → fan-out).
      expect((def.graph.junctions ?? []).length).toBeGreaterThanOrEqual(1);
      // The branched net reaches the frame through the JUNCTION — exactly ONE frame-pin↔junction wire,
      // not one frame-pin lead per resistor.
      const frameJuncWires = def.graph.wires.filter((w) => {
        const fromFrame =
          "componentId" in w.from && w.from.componentId === def.frameId;
        const toFrame =
          "componentId" in w.to && w.to.componentId === def.frameId;
        return (
          (fromFrame && "junctionId" in w.to) ||
          ("junctionId" in w.from && toFrame)
        );
      });
      expect(frameJuncWires.length).toBe(1);
    } finally {
      unregisterUserIc("Junc");
    }
  });

  it("capture drops a crossing wire's OUTSIDE waypoints (the retargeted lead doesn't overshoot)", () => {
    // A crossing wire with a bend OUTSIDE the box used to keep that outside waypoint after retargeting to
    // the frame pin → the lead overshot past the pin (the owner's stray VCC stub). The outside routing
    // must be dropped; only the inside part survives.
    const b = new BoardGraph();
    const v = place(b, "V", 0, 5, 5);
    const r = place(b, "R", 12, 5, 1000);
    const gnd = place(b, "GND", 30, 5);
    const w = b.connect(
      { componentId: v.id, pinIndex: 0 },
      { componentId: r.id, pinIndex: 0 },
    );
    if (w) w.waypoints = [{ col: 3, row: 5 }]; // a bend OUTSIDE the box (between V and the left edge)
    b.connect(
      { componentId: r.id, pinIndex: 1 },
      { componentId: gnd.id, pinIndex: 0 },
    );
    const cap = captureRegion(b, [r.id], "Over", {
      minCol: 9,
      minRow: 2,
      maxCol: 18,
      maxRow: 8,
    });
    expect(cap).not.toBeUndefined();
    try {
      const def = getUserIc("Over")!;
      const lead = def.graph.wires.find(
        (wr) =>
          ("componentId" in wr.from && wr.from.componentId === def.frameId) ||
          ("componentId" in wr.to && wr.to.componentId === def.frameId),
      );
      expect(lead).toBeDefined();
      // The lone waypoint was outside the box → dropped, so the lead terminates cleanly at the frame pin.
      expect((lead!.waypoints ?? []).length).toBe(0);
    } finally {
      unregisterUserIc("Over");
    }
  });

  it("capture characterizes pins (VCC / output) + auto-sets the die's stimulus", () => {
    // V → R (inside) → an outside passive load. The V-side net is the SUPPLY (VCC, driven); the load-side
    // net has no outside driver → an OUTPUT (observed, named Y — not a bare "P1"). The frame's per-pin
    // TEST STIMULI are pre-set so the die auto-powers (no hand-dialling each pin).
    const b = new BoardGraph();
    const v = place(b, "V", 0, 0, 5);
    const r = place(b, "R", 6, 0, 1000);
    const load = place(b, "R", 14, 0, 2000); // outside passive load on the output
    const gnd = place(b, "GND", 0, 6);
    connect(b, v, 0, r, 0); // V+ → R.A  (VCC net)
    connect(b, r, 1, load, 0); // R.B → load (OUTPUT net — outside is passive)
    connect(b, load, 1, gnd, 0);
    connect(b, v, 1, gnd, 0);
    const cap = captureRegion(b, [r.id], "Char");
    expect(cap).not.toBeUndefined();
    try {
      const def = getUserIc("Char")!;
      expect(def.pinNames).toContain("VCC");
      expect(def.pinNames).toContain("Y"); // un-driven net → an OUTPUT, not "P1"
      const vccIdx = def.pinNames!.indexOf("VCC");
      const yIdx = def.pinNames!.indexOf("Y");
      expect(def.pinRoles![vccIdx]).toBe("vcc");
      expect(def.pinRoles![yIdx]).toBe("out");
      // The frame carries auto-stimulus: VCC driven (5 V), the output observed (null).
      const frame = def.graph.components.find((c) => c.id === def.frameId)!;
      expect(frame.pinTests![vccIdx]).toEqual({ role: "vcc", value: 5 });
      expect(frame.pinTests![yIdx]).toBeNull();
    } finally {
      unregisterUserIc("Char");
    }
  });

  it("captureRegion explicit box (live rect): the DRAWN rectangle becomes the subassembly box", () => {
    // The live tool passes the rectangle the player dragged. A rect LARGER than the parts must be used
    // verbatim (box = the rect), not shrink-wrapped to the parts' bbox.
    const b = new BoardGraph();
    const v = place(b, "V", 0, 0, 5);
    const r1 = place(b, "R", 4, 0, 1000);
    const r2 = place(b, "R", 8, 0, 2000);
    const gnd = place(b, "GND", 40, 0);
    connect(b, v, 0, r1, 0);
    connect(b, r1, 1, r2, 0);
    connect(b, r2, 1, gnd, 0);
    connect(b, v, 1, gnd, 0);

    // A generous rect spanning cols 2..16, rows -3..4 — wider/taller than the two resistors.
    const box = { minCol: 2, minRow: -3, maxCol: 16, maxRow: 4 };
    const cap = captureRegion(b, [r1.id, r2.id], "BoxR", box);
    expect(cap).not.toBeUndefined();
    try {
      const def = getUserIc("BoxR")!;
      // Box = the drawn rect exactly (it already encloses the parts, so the part-union doesn't grow it).
      expect(def.freeForm!.w).toBe(box.maxCol - box.minCol + 1); // 15
      expect(def.freeForm!.h).toBe(box.maxRow - box.minRow + 1); // 8
      // Pins still sit on the (now larger) box edge.
      for (const p of def.freeForm!.pins) {
        const onEdge =
          p.dx === 0 ||
          p.dx === def.freeForm!.w - 1 ||
          p.dy === 0 ||
          p.dy === def.freeForm!.h - 1;
        expect(onEdge).toBe(true);
      }
      // And it still flattens to the real series chain (box size is presentation; connectivity is by net).
      const g = new BoardGraph();
      const vs = place(g, "V", 0, 0, 5);
      const gg = place(g, "GND", 0, 6);
      const sub = place(g, "BoxR", 4, 0);
      connect(g, vs, 0, sub, def.pinNames!.indexOf("VCC"));
      connect(g, sub, def.pinNames!.indexOf("GND"), gg, 0);
      connect(g, vs, 1, gg, 0);
      const nl = buildNetlist(g, false);
      expect(nl!.types.length).toBe(3); // V + R1 + R2
    } finally {
      unregisterUserIc("BoxR");
    }
  });

  it("pin/box editing: resealing a free-form subassembly persists an EDITED box (read off the frame kind)", () => {
    // Capture a free-form subassembly, then simulate the die editor's box-resize: re-register its
    // free-form frame with a bigger box (what board.resizeFreeFormBox does). Reseal must read that NEW
    // geometry off the frame kind and persist it — not silently revert to the captured box.
    const b = new BoardGraph();
    const v = place(b, "V", 0, 0, 5);
    const r1 = place(b, "R", 4, 0, 1000);
    const r2 = place(b, "R", 8, 0, 2000);
    const gnd = place(b, "GND", 12, 0);
    connect(b, v, 0, r1, 0);
    connect(b, r1, 1, r2, 0);
    connect(b, r2, 1, gnd, 0);
    connect(b, v, 1, gnd, 0);
    const cap = captureRegion(b, [r1.id, r2.id], "EditBox");
    expect(cap).not.toBeUndefined();
    try {
      const def = getUserIc("EditBox")!;
      const oldW = def.freeForm!.w;
      const oldH = def.freeForm!.h;
      const frameKind = def.graph.components.find(
        (c) => c.id === def.frameId,
      )!.kind;
      expect(frameKind.startsWith(FREE_FORM_DIE_PREFIX)).toBe(true);

      // Resize the box (+3 W, +2 H), keeping the same pins — re-registers the frame kind in place.
      const subTag = frameKind.slice(FREE_FORM_DIE_PREFIX.length);
      registerFreeFormFrame(subTag, {
        w: oldW + 3,
        h: oldH + 2,
        pins: def.freeForm!.pins,
      });

      // Reseal the (unchanged) inner graph — the edited box must ride through onto the def.
      resealUserIc("EditBox", def.graph, def.frameId, def.pinNames);
      const after = getUserIc("EditBox")!;
      expect(after.freeForm!.w).toBe(oldW + 3);
      expect(after.freeForm!.h).toBe(oldH + 2);
      expect(after.role).toBe("subassembly"); // still a subassembly (audit blocker stays fixed)
      expect(after.freeForm!.pins.length).toBe(def.freeForm!.pins.length); // pin count unchanged
    } finally {
      unregisterUserIc("EditBox");
    }
  });

  it("characterization: cellBehaviorSig is deterministic + content-sensitive (logic, not the frame)", () => {
    // A tiny inner graph: a die frame + R(1k) wired to the frame pins.
    const g = new BoardGraph();
    const frame = place(g, "SOT23_3", 0, 0);
    const r = place(g, "R", 4, 0, 1000);
    connect(g, frame, 0, r, 0);
    connect(g, r, 1, frame, 1);
    const sig1 = cellBehaviorSig(g.serialize());
    expect(sig1).toBeGreaterThan(0);
    // Deterministic — the SAME graph hashes the same every time (not JS key order).
    expect(cellBehaviorSig(g.serialize())).toBe(sig1);
    // Content-sensitive — a different resistor value (the logic changed) hashes differently, so a reseal
    // would drop a stale swept word.
    const g2 = new BoardGraph();
    const f2 = place(g2, "SOT23_3", 0, 0);
    const r2 = place(g2, "R", 4, 0, 2200);
    connect(g2, f2, 0, r2, 0);
    connect(g2, r2, 1, f2, 1);
    expect(cellBehaviorSig(g2.serialize())).not.toBe(sig1);
    // A different topology (an extra part) also changes the sig.
    const g3 = new BoardGraph();
    const f3 = place(g3, "SOT23_3", 0, 0);
    const r3 = place(g3, "R", 4, 0, 1000);
    place(g3, "R", 8, 0, 1000); // an extra resistor (unwired, but present)
    connect(g3, f3, 0, r3, 0);
    connect(g3, r3, 1, f3, 1);
    expect(cellBehaviorSig(g3.serialize())).not.toBe(sig1);
  });

  it("characterization collapse: a placed cell with behavior + behavioral fidelity emits ONE LUT, not FETs", () => {
    const ELEM_BEHAVIORAL = 25;
    const ELEM_RESISTOR = 1;
    // A user-IC def with a dummy inner part + pin roles (out/in/vcc/gnd on pins 0..3) + a stored swept
    // behavior (the 16-bit word). When a placed instance opts into behavioral fidelity it must collapse to
    // ONE behavioral LUT instead of inlining the inner part.
    const inner = new BoardGraph();
    const frame = place(inner, "DIP8", 0, 0);
    const rIn = place(inner, "R", 6, 0, 1000);
    connect(inner, frame, 0, rIn, 0); // pin0 (OUT) ↔ R
    connect(inner, rIn, 1, frame, 1); // R ↔ pin1 (IN)
    registerUserIc({
      tag: "GATEX",
      name: "GATEX",
      package: { archetype: "DIP", pinCount: 8 },
      frameId: frame.id,
      graph: inner.serialize(),
      pinRoles: ["out", "in", "vcc", "gnd"],
      behavior: { prog: 4, word: 0x5555, mode: 0, sig: 0 },
      role: "subassembly",
    });
    try {
      const buildBoard = (behavioral: boolean): number[] => {
        const g = new BoardGraph();
        const v = place(g, "V", 0, 0, 5);
        const gg = place(g, "GND", 0, 6);
        const ic = place(g, "GATEX", 4, 0);
        if (behavioral)
          (ic as Component & { fidelity?: string }).fidelity = "behavioral";
        connect(g, v, 0, ic, 2); // V+ → VCC (pin 2)
        connect(g, ic, 3, gg, 0); // GND (pin 3) → GND
        connect(g, v, 0, ic, 1); // V+ → IN (pin 1)
        connect(g, ic, 0, gg, 0); // OUT (pin 0) → GND (a load)
        connect(g, v, 1, gg, 0);
        const nl = buildNetlist(g, false);
        expect(nl).not.toBeNull();
        return [...nl!.types];
      };
      // FULL fidelity (default): the inner R inlines → a resistor element, no behavioral block.
      const full = buildBoard(false);
      expect(full).toContain(ELEM_RESISTOR);
      expect(full).not.toContain(ELEM_BEHAVIORAL);
      // BEHAVIORAL fidelity: the cell collapses to exactly ONE behavioral LUT; the inner R is gone.
      const collapsed = buildBoard(true);
      expect(collapsed.filter((t) => t === ELEM_BEHAVIORAL).length).toBe(1);
      expect(collapsed).not.toContain(ELEM_RESISTOR);
    } finally {
      unregisterUserIc("GATEX");
    }
  });

  it("recognizeGate names the 1- and 2-input primitives from a swept word, null otherwise", () => {
    // 2-input words use the sweep's combo encoding bit(i0 | i1<<1): AND=0x8, OR=0xE, NAND=0x7, NOR=0x1,
    // XOR=0x6, XNOR=0x9. The NAND case is the owner's headline test (a built NAND must read "NAND").
    expect(recognizeGate(0x8, 2)).toBe("AND");
    expect(recognizeGate(0xe, 2)).toBe("OR");
    expect(recognizeGate(0x7, 2)).toBe("NAND");
    expect(recognizeGate(0x1, 2)).toBe("NOR");
    expect(recognizeGate(0x6, 2)).toBe("XOR");
    expect(recognizeGate(0x9, 2)).toBe("XNOR");
    // 1-input: bit0 = out(0), bit1 = out(1). NOT = 0b01, BUFFER = 0b10, constants for 0b00 / 0b11.
    expect(recognizeGate(0b01, 1)).toBe("NOT");
    expect(recognizeGate(0b10, 1)).toBe("BUFFER");
    expect(recognizeGate(0b00, 1)).toBe("LOW");
    expect(recognizeGate(0b11, 1)).toBe("HIGH");
    // An unnamed 2-input function and any ≥3-input table aren't named (the truth table stands alone).
    expect(recognizeGate(0x2, 2)).toBeNull(); // out only when i0=1 & i1=0 — no common name
    expect(recognizeGate(0x8000, 4)).toBeNull(); // 4-input AND — recognized only via the table
  });

  it("setUserIcBehavior stores/clears a swept word so the collapse fires only once bound (the sweep path)", () => {
    const ELEM_BEHAVIORAL = 25;
    const ELEM_RESISTOR = 1;
    // Mirrors the in-app SWEEP → store → collapse path: a def with pin roles but NO behavior yet. A
    // behavioral-fidelity instance can't collapse until setUserIcBehavior binds a word to the def.
    const inner = new BoardGraph();
    const frame = place(inner, "DIP8", 0, 0);
    const rIn = place(inner, "R", 6, 0, 1000);
    connect(inner, frame, 0, rIn, 0);
    connect(inner, rIn, 1, frame, 1);
    registerUserIc({
      tag: "GATEY",
      name: "GATEY",
      package: { archetype: "DIP", pinCount: 8 },
      frameId: frame.id,
      graph: inner.serialize(),
      pinRoles: ["out", "in", "vcc", "gnd"],
      role: "subassembly",
    });
    try {
      const buildBehavioral = (): number[] => {
        const g = new BoardGraph();
        const v = place(g, "V", 0, 0, 5);
        const gg = place(g, "GND", 0, 6);
        const ic = place(g, "GATEY", 4, 0);
        (ic as Component & { fidelity?: string }).fidelity = "behavioral";
        connect(g, v, 0, ic, 2);
        connect(g, ic, 3, gg, 0);
        connect(g, v, 0, ic, 1);
        connect(g, ic, 0, gg, 0);
        connect(g, v, 1, gg, 0);
        const nl = buildNetlist(g, false);
        expect(nl).not.toBeNull();
        return [...nl!.types];
      };
      // No behavior bound yet → even a behavioral instance inlines the inner R (nothing to collapse to).
      const before = buildBehavioral();
      expect(before).toContain(ELEM_RESISTOR);
      expect(before).not.toContain(ELEM_BEHAVIORAL);
      // Bind a swept word (what characterizeCell hands back) → now the instance collapses to ONE LUT.
      setUserIcBehavior("GATEY", { prog: 4, word: 0x7, mode: 0, sig: 0 });
      const bound = buildBehavioral();
      expect(bound.filter((t) => t === ELEM_BEHAVIORAL).length).toBe(1);
      expect(bound).not.toContain(ELEM_RESISTOR);
      // Clearing it (a stale-sig re-sweep) drops the word → back to inlining the discrete parts.
      setUserIcBehavior("GATEY", undefined);
      const cleared = buildBehavioral();
      expect(cleared).toContain(ELEM_RESISTOR);
      expect(cleared).not.toContain(ELEM_BEHAVIORAL);
    } finally {
      unregisterUserIc("GATEY");
    }
  });

  it("sweepNetlist reads the gate OUTPUT net, not a supply rail (id-collision regression)", () => {
    const ELEM_NMOS = 11;
    const ELEM_PMOS = 12;
    // The owner's CMOS inverter, in a DIP8 die: PMOS + NMOS with drains tied to OUT. Frame pins
    // 0=OUT, 1=VCC, 2=IN, 3=GND. Discrete MOSFET pins are 0=Drain, 1=Source, 2=Gate (glyphs.ts).
    const inner = new BoardGraph();
    const frame = place(inner, "DIP8", 0, 0);
    const pm = place(inner, "PM", 4, 0);
    const nm = place(inner, "NM", 4, 4);
    connect(inner, pm, 0, frame, 0); // PMOS drain → OUT
    connect(inner, pm, 1, frame, 1); // PMOS source → VCC
    connect(inner, pm, 2, frame, 2); // PMOS gate → IN
    connect(inner, nm, 0, frame, 0); // NMOS drain → OUT
    connect(inner, nm, 1, frame, 3); // NMOS source → GND
    connect(inner, nm, 2, frame, 2); // NMOS gate → IN
    const snap = inner.serialize();
    const pins = { inPins: [2], outPin: 0, gndPin: 3, vccPin: 1 };

    // Both input vectors: the sense node must be the FETs' shared DRAIN net (= OUT), never the VCC net.
    // Before the fix, the sense resistor's id collided with dieTestGraph's injected VCC source, so
    // nodesOfComponent(sense)[0] resolved to VCC (a stiff 5 V) → every vector read HIGH (word 0x3).
    for (const combo of [0, 1]) {
      const built = sweepNetlist(snap, frame.id, pins, combo);
      expect(built).not.toBeNull();
      const types = [...built!.nl.types];
      expect(types).toContain(ELEM_NMOS); // the gate compiled with its real FETs
      expect(types).toContain(ELEM_PMOS);
      const pmDrain = built!.nl.nodesOfComponent.get(pm.id)?.[0];
      const pmSource = built!.nl.nodesOfComponent.get(pm.id)?.[1]; // the VCC net
      const nmDrain = built!.nl.nodesOfComponent.get(nm.id)?.[0];
      expect(pmDrain).toBe(nmDrain); // drains tied = the OUTPUT net
      expect(built!.outNode).toBe(pmDrain); // the sense node IS that output net…
      expect(built!.outNode).not.toBe(pmSource); // …and NOT the VCC rail (the bug)
    }
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

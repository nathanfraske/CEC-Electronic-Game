// SPDX-License-Identifier: Apache-2.0

/**
 * Logic-family table for the front end — the level fractions mirror `FAMILIES` in
 * `crates/sim-core/src/lib.rs` (the same way the design-system colours are mirrored
 * for the GPU). The simulator owns behaviour; this is the presentation copy used to
 * label the family picker and to read out V_IL / V_IH / V_OL / V_OH and the noise
 * margins in the inspector. A part's `Component.family` indexes into this array
 * (`0` = Ideal default), and `buildNetlist` packs that index into `aux`'s upper bits
 * (`func + 16*family`). Keep these numbers in lockstep with the Rust `FAMILIES`.
 *
 * See `docs/ui/logic-analog-digital-nets.md` §7.5.
 */
export interface LogicFamily {
  /** Short display name for the picker chip. */
  name: string;
  /** Input reads LOW at/below this fraction of the rail (V_IL). */
  vIlFrac: number;
  /** Input reads HIGH above this fraction of the rail (V_IH). Between is the
   * forbidden band, read as indeterminate (X). For Ideal, `vIl === vIh` (no band). */
  vIhFrac: number;
  /** Output-low / output-high voltage as a fraction of the rail. */
  vOlFrac: number;
  vOhFrac: number;
}

/** The selectable families, indexed by `Component.family` (matches Rust `FAMILIES`). */
export const LOGIC_FAMILIES: LogicFamily[] = [
  // 0: Ideal — half-rail threshold, rail-to-ground output, no forbidden band.
  { name: "Ideal", vIlFrac: 0.5, vIhFrac: 0.5, vOlFrac: 0.0, vOhFrac: 1.0 },
  // 1: CMOS — ~30%/70% thresholds, near rail-to-rail output (rail-independent, so it
  //    also serves 3.3 V LVCMOS, 1.8 V, … by choosing the rail).
  { name: "CMOS", vIlFrac: 0.3, vIhFrac: 0.7, vOlFrac: 0.05, vOhFrac: 0.95 },
  // 2: TTL — 0.8 V / 2.0 V in, 0.4 V / 3.4 V out at a 5 V rail (thin low-side margin).
  { name: "TTL", vIlFrac: 0.16, vIhFrac: 0.4, vOlFrac: 0.08, vOhFrac: 0.68 },
];

/** The default family index for a freshly placed digital part (Ideal). */
export const DEFAULT_FAMILY = 0;

/** Absolute logic levels and noise margins (in volts) for a family at a given rail. */
export interface FamilyLevels {
  name: string;
  vIl: number;
  vIh: number;
  vOl: number;
  vOh: number;
  /** High-side noise margin `V_OH − V_IH` (≥ 0 when a high drives a same-family in). */
  nmHigh: number;
  /** Low-side noise margin `V_IL − V_OL`. */
  nmLow: number;
  /** True when the family has a forbidden/indeterminate input band (V_IL < V_IH). */
  hasBand: boolean;
}

/** Resolve a family index + rail to absolute levels and noise margins for display. */
export function familyLevels(familyIdx: number, rail: number): FamilyLevels {
  const f = LOGIC_FAMILIES[familyIdx] ?? LOGIC_FAMILIES[DEFAULT_FAMILY];
  const r = Math.max(rail, 0);
  const vIl = f.vIlFrac * r;
  const vIh = f.vIhFrac * r;
  const vOl = f.vOlFrac * r;
  const vOh = f.vOhFrac * r;
  return {
    name: f.name,
    vIl,
    vIh,
    vOl,
    vOh,
    nmHigh: vOh - vIh,
    nmLow: vIl - vOl,
    hasBand: f.vIhFrac > f.vIlFrac,
  };
}

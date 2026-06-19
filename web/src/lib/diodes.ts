// SPDX-License-Identifier: Apache-2.0
// Diode TYPE presets for main gameplay. The generic silicon diode kind "D" comes in the
// real-world flavours a bench actually stocks — a small switching diode, a standard mains
// rectifier, a fast-recovery rectifier, a heavy power rectifier. They differ mainly in
// **current rating** (and, later, reverse-recovery), with a small spread in forward drop. Each
// flavour is a preset of the device's forward junction params + a rating, selected by
// `Component.variant` and mapped into the per-element param block sim-core reads. The slot map
// mirrors `Element::params` in crates/sim-core/src/lib.rs: [0] = saturation current Is (A),
// [1] = emission coefficient n, and the general [RATED_CURRENT_SLOT] = rated current (A).

/** Param slot carrying a part's rated current (A) — mirrors sim-core's `RATED_CURRENT_SLOT`. */
export const RATED_CURRENT_SLOT = 2;

/** Param slot carrying a diode's transit time TT (s) — mirrors sim-core's `DIODE_TT_SLOT`. */
export const DIODE_TT_SLOT = 3;

/** One diode-family flavour: a forward junction (Is/n → forward drop), a current rating, a
 *  transit time (reverse recovery), and — for an LED — the emitted colour (render tint). */
export interface DiodeType {
  label: string;
  /** Saturation current Is (A) — param slot 0. A higher Is conducts at a lower forward drop. */
  is: number;
  /** Emission coefficient n — param slot 1 (forward `vth = n·Vt`). */
  n: number;
  /** Forward current rating (A): above this the part FAILs (Real mode only). */
  ratedA: number;
  /** Transit time `TT` (s) — the diffusion-charge time constant that gives the diode its
   *  REVERSE RECOVERY (param slot 3, Real mode only). `0` = no recovery (Schottky-like). The
   *  values are game-scaled to the engine's fixed timestep so the recovery spans several ticks
   *  and is visible; the realistic ordering (switching < fast-recovery < rectifier < power) is
   *  what matters. */
  tt: number;
  /** LED emission colour (0xRRGGBB) for the glyph tint; undefined for a plain diode. */
  tint?: number;
}

// Variant 0 is the plain silicon rectifier whose `is`/`n` EQUAL the sim-core defaults
// (DIODE_IS = 1e-12, DIODE_N = 1), so a freshly placed diode — and every older snapshot whose
// diodes carry no `variant` — behaves exactly as before. The others trade rating for size.
export const DIODE_TYPES: DiodeType[] = [
  // tt = transit time → reverse recovery (slow rectifier vs fast switching), game-scaled to µs.
  { label: "Rectifier", is: 1.0e-12, n: 1, ratedA: 1.0, tt: 5.0e-6 }, // 1N400x — slow recovery
  { label: "Switching", is: 3.0e-12, n: 1, ratedA: 0.2, tt: 0.5e-6 }, // 1N4148 — small, fast
  { label: "Fast-recovery", is: 1.0e-12, n: 1, ratedA: 1.0, tt: 1.0e-6 }, // UF400x — fast
  { label: "Power", is: 5.0e-13, n: 1, ratedA: 3.0, tt: 8.0e-6 }, // heavy rectifier — slowest, big
];

// LED COLOURS. An LED's colour sets its forward voltage (a wider-bandgap junction drops more):
// red ~1.9 V … blue/white ~3 V. We hold the colour at a fixed forward drop by choosing the
// saturation current `Is` for that Vf at a ~20 mA operating point (`Is = 20 mA / exp(Vf/(n·Vt))`,
// n = 2 like the LED kind), and carry the emitted tint for the glyph. Variant 0 = red at the
// sim-core `LED_IS` default (Vf ≈ 1.94 V), so an LED that never picks a colour is unchanged.
// LEDs are easy to burn out, so each carries a modest ~30 mA rating (bites in Real mode).
const LED_COLORS: DiodeType[] = [
  // LEDs carry no modelled reverse recovery (tt = 0); colour sets Is (forward drop) + tint.
  { label: "Red", is: 1.0e-18, n: 2, ratedA: 0.03, tt: 0, tint: 0xff4763 }, // ~1.94 V = LED default
  { label: "Yellow", is: 4.55e-20, n: 2, ratedA: 0.03, tt: 0, tint: 0xffc24a }, // ~2.1 V
  { label: "Green", is: 6.62e-21, n: 2, ratedA: 0.03, tt: 0, tint: 0x49e07a }, // ~2.2 V
  { label: "Blue", is: 8.7e-27, n: 2, ratedA: 0.03, tt: 0, tint: 0x4aa8ff }, // ~2.9 V
  { label: "White", is: 1.82e-28, n: 2, ratedA: 0.03, tt: 0, tint: 0xeaeaff }, // ~3.1 V
];

// Per-kind variant tables. A part's `variant` indexes its kind's table (diode TYPE / LED COLOUR).
const VARIANTS: Record<string, DiodeType[]> = {
  D: DIODE_TYPES,
  LED: LED_COLORS,
};

/** Whether a kind exposes selectable diode TYPES (the inspector shows a "diode type" picker). */
export function hasDiodeTypes(kind: string): boolean {
  return kind === "D";
}

/** Whether a kind exposes selectable LED COLOURS (the inspector shows a "colour" picker). */
export function hasLedColors(kind: string): boolean {
  return kind === "LED";
}

/** The variant table for a kind (so the inspector can list the labels), or `null`. */
export function variantList(kind: string): DiodeType[] | null {
  return VARIANTS[kind] ?? null;
}

/** The {@link DiodeType} for a diode-family part's `(kind, variant)`, or `null` if the kind has
 *  no variants. {@link buildNetlist} emits the forward `is`/`n` in both fidelity modes (a part's
 *  identity) but the current rating only in Real mode (the FAIL non-ideality). */
export function diodeVariant(kind: string, variant: number): DiodeType | null {
  const table = VARIANTS[kind];
  if (!table) return null;
  const t = Math.max(0, Math.min(table.length - 1, Math.round(variant)));
  return table[t] ?? null;
}

/** An LED's emitted colour (0xRRGGBB) for the given variant — the glyph tint. Falls back to the
 *  default red when out of range. */
export function ledTint(variant: number): number {
  const t = Math.max(0, Math.min(LED_COLORS.length - 1, Math.round(variant)));
  return LED_COLORS[t]?.tint ?? 0xff4763;
}

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

/** One diode flavour: a forward junction (Is/n → forward drop) and a current rating. */
export interface DiodeType {
  label: string;
  /** Saturation current Is (A) — param slot 0. A higher Is conducts at a lower forward drop. */
  is: number;
  /** Emission coefficient n — param slot 1 (forward `vth = n·Vt`). */
  n: number;
  /** Forward current rating (A): above this the part FAILs (Real mode only). */
  ratedA: number;
}

// Variant 0 is the plain silicon rectifier whose `is`/`n` EQUAL the sim-core defaults
// (DIODE_IS = 1e-12, DIODE_N = 1), so a freshly placed diode — and every older snapshot whose
// diodes carry no `variant` — behaves exactly as before. The others trade rating for size.
export const DIODE_TYPES: DiodeType[] = [
  { label: "Rectifier", is: 1.0e-12, n: 1, ratedA: 1.0 }, // 1N400x-class — the default
  { label: "Switching", is: 3.0e-12, n: 1, ratedA: 0.2 }, // 1N4148-class — small, fast, low current
  { label: "Fast-recovery", is: 1.0e-12, n: 1, ratedA: 1.0 }, // UF400x — recovery modelled later
  { label: "Power", is: 5.0e-13, n: 1, ratedA: 3.0 }, // heavy rectifier — higher drop, big current
];

/** Whether a kind exposes selectable diode TYPES (the inspector shows the type picker). */
export function hasDiodeTypes(kind: string): boolean {
  return kind === "D";
}

/** The {@link DiodeType} for a diode part's `(kind, variant)`, or `null` if the kind has no
 *  diode types. {@link buildNetlist} emits the forward `is`/`n` in both fidelity modes (a
 *  part's identity) but the current rating only in Real mode (the FAIL non-ideality). */
export function diodeVariant(kind: string, variant: number): DiodeType | null {
  if (!hasDiodeTypes(kind)) return null;
  const t = Math.max(0, Math.min(DIODE_TYPES.length - 1, Math.round(variant)));
  return DIODE_TYPES[t] ?? null;
}

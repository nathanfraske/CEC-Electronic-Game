// SPDX-License-Identifier: Apache-2.0
// Standard ("real") component values for the value Inspector. Resistors snap to
// the E24 series, capacitors and inductors to the looser E6; sources and the
// switch get curated lists. The Inspector chooses a *number*; `formatValue` in
// graph.ts owns the label ("4.7 kΩ"). Keeping this presentation-free and pure so
// it can be unit-tested and reused without the GPU layer.

/** E24 significands (±5 %), 24 per decade. */
const E24 = [
  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9,
  4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
];
/** E6 significands (±20 %), 6 per decade. */
const E6 = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8];

/** Decade multipliers (powers of ten) for each E-series part kind. */
const DECADES: Record<string, number[]> = {
  R: [1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6], // 1 Ω … 9.1 MΩ
  C: [1e-12, 1e-11, 1e-10, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4], // 1 pF … 680 µF
  L: [1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1], // 1 µH … 6.8 H
};

const SIGNIFICANDS: Record<string, number[]> = { R: E24, C: E6, L: E6 };

/** Curated flat lists for the parts that aren't an E-series sweep. */
const CURATED_FULL: Record<string, number[]> = {
  V: [1.2, 1.5, 1.8, 2.5, 3.3, 5, 9, 12, 15, 24, 48],
  I: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2],
  SW: [0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9],
  // AC frequency (Hz), kept in the ~50 Hz–5 kHz band the 2 µs step resolves well.
  AC: [50, 100, 200, 300, 500, 1000, 2000, 3000, 5000],
  // Zener breakdown voltage Vz (V): the common standard BZX-series values.
  ZD: [2.4, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 9.1, 12, 15],
  // Electrolytic capacitance (F): the common bulk values, 10 µF … 1000 µF.
  EC: [10e-6, 22e-6, 47e-6, 100e-6, 220e-6, 470e-6, 1000e-6],
};

/** The ~6–8 common values shown as chips up front (the calm default). */
const CURATED_CHIPS: Record<string, number[]> = {
  R: [100, 220, 470, 1e3, 2.2e3, 4.7e3, 10e3, 100e3],
  C: [1e-9, 10e-9, 100e-9, 1e-6, 10e-6, 100e-6],
  L: [10e-6, 100e-6, 1e-3, 10e-3, 100e-3],
  V: [3.3, 5, 9, 12],
  I: [0.001, 0.005, 0.01, 0.05],
  SW: [0.25, 0.5, 0.75],
  AC: [100, 500, 1000, 2000],
  // The classic Zener reference voltages people reach for first.
  ZD: [3.3, 4.7, 5.1, 6.2, 9.1, 12],
  EC: [10e-6, 47e-6, 100e-6, 220e-6, 470e-6, 1000e-6],
};

/**
 * Curated peak-amplitude chips (volts) for the AC source's *second* scalar — the
 * amplitude, distinct from its `value` (frequency, {@link CURATED_FULL}.AC). The
 * common rail-ish levels people reach for; 5 V is the default. Presented in the
 * inspector exactly like the frequency chips, with +/- stepping.
 */
export const AC_AMP_CHIPS = [1, 2, 3.3, 5, 9, 12];

/** The AC source's curated amplitude chips (volts). */
export const acAmpChips = (): number[] => AC_AMP_CHIPS;

/** Step to the next (`dir>0`) or previous curated AC amplitude from `amp`. */
export function stepAmp(amp: number, dir: number): number {
  // Index of the nearest current amplitude, then move one detent — the linear
  // analogue of `stepValue` (the amplitude list is a small curated linear set).
  let idx = 0;
  let bestD = Infinity;
  for (let i = 0; i < AC_AMP_CHIPS.length; i++) {
    const d = Math.abs(AC_AMP_CHIPS[i]! - amp);
    if (d < bestD) {
      bestD = d;
      idx = i;
    }
  }
  const next = Math.max(
    0,
    Math.min(AC_AMP_CHIPS.length - 1, idx + Math.sign(dir)),
  );
  return AC_AMP_CHIPS[next]!;
}

/** True if this part kind exposes an adjustable value at all. */
export function hasValue(kind: string): boolean {
  return kind in DECADES || kind in CURATED_FULL;
}

/** True if the kind is an E-series sweep (decade × significand UI). */
export function isESeries(kind: string): boolean {
  return kind in DECADES;
}

export const decadesOf = (kind: string): number[] => DECADES[kind] ?? [];
export const significandsOf = (kind: string): number[] =>
  SIGNIFICANDS[kind] ?? [];
export const chipsOf = (kind: string): number[] => CURATED_CHIPS[kind] ?? [];

/** The full ordered list of standard values for a kind (ascending). */
export function standardValues(kind: string): number[] {
  if (kind in CURATED_FULL) return CURATED_FULL[kind]!;
  const decades = DECADES[kind];
  const sig = SIGNIFICANDS[kind];
  if (!decades || !sig) return [];
  const out: number[] = [];
  for (const d of decades) for (const s of sig) out.push(s * d);
  return out;
}

/** The standard value nearest `value` (by log distance), for snapping input. */
export function nearestStandard(kind: string, value: number): number {
  const list = standardValues(kind);
  if (list.length === 0 || value <= 0) return value;
  let best = list[0]!;
  let bestD = Infinity;
  for (const v of list) {
    const d = Math.abs(Math.log(v) - Math.log(value));
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/** Step to the next (`dir>0`) or previous standard value from `value`. */
export function stepValue(kind: string, value: number, dir: number): number {
  const list = standardValues(kind);
  if (list.length === 0) return value;
  // Index of the nearest current value, then move one detent.
  let idx = 0;
  let bestD = Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = Math.abs(Math.log(list[i]!) - Math.log(value));
    if (d < bestD) {
      bestD = d;
      idx = i;
    }
  }
  const next = Math.max(0, Math.min(list.length - 1, idx + Math.sign(dir)));
  return list[next]!;
}

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
  // AC frequency (Hz). 50 + 60 are the mains line frequencies (EU/US). The list now runs up
  // into the **MHz** — where PSU switching lives — because frequency is also the analysis point
  // for the frequency-domain tools (the Bode sweep and the phase scope), which have **no Nyquist
  // limit** (`ac_solve` is analytic). Below ~62.5 kHz the 2 µs time-domain step also resolves it
  // (≥8 samples/cycle) so the board/time-scope show the live waveform; above that the *time*
  // domain aliases (expected — undersampling), and the MHz behaviour is read in the frequency
  // domain instead. The source's frequency sets where the phase scope / Bode analyse.
  AC: [
    50, 60, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000, 50000,
    100000, 250000, 500000, 1e6, 2e6, 5e6, 10e6,
  ],
  // Pulse / clock generator frequency (Hz): a clock/switcher, so its useful range is the
  // switching band — kHz up into the MHz (same frequency-domain reach as the AC source).
  PULSE: [
    100, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1e6, 2e6, 5e6,
    10e6,
  ],
  // Zener breakdown voltage Vz (V): the common standard BZX-series values.
  ZD: [2.4, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 9.1, 12, 15],
  // Varistor clamp voltage Vc (V): common MOV ratings, a superset of the chips.
  MOV: [12, 18, 24, 36, 48, 68, 100],
  // Op-amp saturation rail Vsat (V): the supply levels the output swings within.
  // Common single/dual-supply rails people reach for, with 12 V the default.
  OA: [3, 3.3, 5, 9, 12, 15, 18, 24],
  // Logic-gate high rail (V): the digital supply the output drives to and the
  // inputs threshold against (half-rail). The common logic families, 5 V default.
  AND: [1.8, 2.5, 3.3, 5, 12, 15],
  OR: [1.8, 2.5, 3.3, 5, 12, 15],
  NAND: [1.8, 2.5, 3.3, 5, 12, 15],
  NOR: [1.8, 2.5, 3.3, 5, 12, 15],
  XOR: [1.8, 2.5, 3.3, 5, 12, 15],
  XNOR: [1.8, 2.5, 3.3, 5, 12, 15],
  NOT: [1.8, 2.5, 3.3, 5, 12, 15],
  BUF: [1.8, 2.5, 3.3, 5, 12, 15],
  // D flip-flop logic rail (V): the digital supply its outputs drive to.
  FF: [1.8, 2.5, 3.3, 5, 12, 15],
  // Level shifter input rail A (V) — the threshold side; output rail B is the amp.
  LS: [1.8, 2.5, 3.3, 5, 12, 15],
  // Pull-up Vcc (V): the rail the resistor pulls its net toward.
  PU: [1.8, 2.5, 3.3, 5, 12, 15],
  // Transformer turns ratio n = Ns/Np: step-downs (< 1) through step-ups (> 1).
  TR: [0.1, 0.2, 0.25, 0.5, 1, 2, 4, 5, 10],
  // Potentiometer total resistance (Ω): the common bench pot values.
  POT: [100, 500, 1e3, 2e3, 5e3, 10e3, 20e3, 50e3, 100e3, 250e3, 500e3, 1e6],
  // Electrolytic capacitance (F): the common bulk values, 10 µF … 1000 µF.
  EC: [10e-6, 22e-6, 47e-6, 100e-6, 220e-6, 470e-6, 1000e-6],
  // Current-sense shunt resistance (Ω): the precision milliohm range, 1 mΩ … 250 mΩ. The low value
  // is the point — you read the current from the small V across it (V = I·R), and at high frequency
  // its ~10 nH lead inductance swings the phase (atan(ωL/R) is large only when R is tiny).
  SHUNT: [1e-3, 2e-3, 5e-3, 10e-3, 25e-3, 50e-3, 100e-3, 250e-3],
};

/** The ~6–8 common values shown as chips up front (the calm default). */
const CURATED_CHIPS: Record<string, number[]> = {
  R: [100, 220, 470, 1e3, 2.2e3, 4.7e3, 10e3, 100e3],
  C: [1e-9, 10e-9, 100e-9, 1e-6, 10e-6, 100e-6],
  L: [10e-6, 100e-6, 1e-3, 10e-3, 100e-3],
  V: [3.3, 5, 9, 12],
  I: [0.001, 0.005, 0.01, 0.05],
  SW: [0.25, 0.5, 0.75],
  AC: [100, 1000, 10000, 50000, 100000, 1e6],
  // Pulse/clock first-reach frequencies: a clock and the common switching bands.
  PULSE: [1000, 10000, 100000, 500000, 1e6],
  // The classic Zener reference voltages people reach for first.
  ZD: [3.3, 4.7, 5.1, 6.2, 9.1, 12],
  // The common varistor clamp voltages people reach for first.
  MOV: [12, 18, 24, 36, 48],
  // The op-amp supply rails people reach for first.
  OA: [3.3, 5, 9, 12, 15],
  // The logic rails people reach for first (5 V default, 3.3 V the modern norm).
  AND: [3.3, 5, 12],
  OR: [3.3, 5, 12],
  NAND: [3.3, 5, 12],
  NOR: [3.3, 5, 12],
  XOR: [3.3, 5, 12],
  XNOR: [3.3, 5, 12],
  NOT: [3.3, 5, 12],
  BUF: [3.3, 5, 12],
  FF: [3.3, 5, 12],
  LS: [1.8, 3.3, 5],
  PU: [3.3, 5, 12],
  // The turns ratios people reach for first: ¼, ½, 1:1, ×2, ×4.
  TR: [0.25, 0.5, 1, 2, 4],
  // The pot values people reach for first.
  POT: [1e3, 10e3, 50e3, 100e3, 1e6],
  EC: [10e-6, 47e-6, 100e-6, 220e-6, 470e-6, 1000e-6],
  // The shunt values people reach for first; 10 mΩ default (≈32° lead-L phase at 100 kHz).
  SHUNT: [1e-3, 10e-3, 50e-3, 100e-3],
};

/**
 * Curated **peak**-amplitude chips (volts) for the AC source's *second* scalar — the
 * amplitude, distinct from its `value` (frequency, {@link CURATED_FULL}.AC). The
 * common rail-ish levels people reach for; 5 V is the default. The three large values
 * are the **peaks of real mains** (RMS·√2): 170 V ≈ 120 Vrms (US), 311 V ≈ 220 Vrms,
 * 325 V ≈ 230 Vrms (EU) — so the sim emulates real line voltage. Presented in the
 * inspector exactly like the frequency chips, with +/- stepping.
 */
export const AC_AMP_CHIPS = [1, 2, 3.3, 5, 9, 12, 170, 311, 325];

/**
 * One-click mains presets: peak amplitude (V) + line frequency (Hz), labelled by the
 * familiar RMS nominal. Sets both scalars so "emulate real electricity" is one tap.
 */
export const AC_MAINS_PRESETS: { label: string; amp: number; freq: number }[] =
  [
    { label: "US 120 V / 60 Hz", amp: 170, freq: 60 },
    { label: "EU 230 V / 50 Hz", amp: 325, freq: 50 },
    { label: "220 V / 50 Hz", amp: 311, freq: 50 },
  ];

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
  // MSW (manual switch) has an adjustable value too — its state, 0 (open) or 1
  // (closed) — but it's a bespoke two-choice toggle, not a numeric E-series/curated
  // sweep, so it isn't in DECADES/CURATED_FULL (whose log-based steppers assume
  // positive values). The inspector renders its Open/Closed chips on a dedicated
  // branch; we only need to report here that it has a value popover at all.
  if (kind === "MSW") return true;
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

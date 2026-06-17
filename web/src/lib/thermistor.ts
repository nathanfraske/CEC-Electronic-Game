// SPDX-License-Identifier: Apache-2.0
// The thermistor resistance–temperature model, shared by the netlist (which stamps
// R(T) as a plain resistor — the POT-style, web-only expansion, so NO sim-core or
// golden change), the analogy drawer (valve openness from R), and the info panel.
// Kept in ONE place so a future SIM-SIDE temperature model (self-heating from I²R, the
// "knob → modelled temperature" upgrade the owner asked us to prep for) can reuse the
// exact same curves — see TODOS "thermistor temperature modelling".

export type ThermistorKind = "NTC" | "PTC";

/** Whether a kind tag is a thermistor (narrows to {@link ThermistorKind}). */
export function isThermistor(kind: string): kind is ThermistorKind {
  return kind === "NTC" || kind === "PTC";
}

const T0_K = 298.15; // 25 °C reference temperature

// NTC: a metal-oxide semiconductor whose resistance falls exponentially as it heats —
// R = R0·exp(B(1/T − 1/T0)), T in kelvin. B is the material constant (a common 10 kΩ).
const NTC_B = 3950; // K

// PTC switching ceramic (donor-doped barium titanate): low resistance below its Curie
// point, then an exponential jump of several decades over a few tens of degrees (the
// resettable-fuse "snap"). Modelled as the larger of a mild sub-Curie dip and the
// super-Curie jump — mirrors the reference sheet's switching-ceramic curve.
const PTC_CURIE_C = 100; // °C — fixed for now; a future per-part param
const PTC_BN = 900; // K, the gentle sub-Curie slope
const PTC_ALPHA = 0.4; // 1/K (~40 %/K), the steep super-Curie jump

/**
 * The thermistor's live resistance (Ω) at body temperature `tempC`, from its nominal
 * `r0` (NTC: resistance at 25 °C; PTC: the low-state resistance below the Curie point).
 */
export function thermistorResistance(
  kind: ThermistorKind,
  r0: number,
  tempC: number,
): number {
  const tK = tempC + 273.15;
  if (kind === "NTC") {
    return r0 * Math.exp(NTC_B * (1 / tK - 1 / T0_K));
  }
  const tcK = PTC_CURIE_C + 273.15;
  const rLow = r0 * Math.exp(PTC_BN * (1 / tK - 1 / tcK));
  const rHigh = r0 * Math.exp(PTC_ALPHA * (tempC - PTC_CURIE_C));
  return Math.max(rLow, rHigh);
}

// Display range for the analogy's "valve openness" map (Ω, on a log scale).
const R_OPEN = 10; // ≤ this reads as wide open
const R_SHUT = 1e5; // ≥ this reads as fully shut

/** Valve openness 0..1 from a resistance: 1 = low R (wide open), 0 = high R (shut). */
export function thermistorOpenness(rOhms: number): number {
  const r = Math.min(R_SHUT, Math.max(R_OPEN, rOhms));
  return 1 - Math.log(r / R_OPEN) / Math.log(R_SHUT / R_OPEN);
}

/** The user-set body-temperature knob's range (°C) per kind, with its default. */
export const THERMISTOR_TEMP: Record<
  ThermistorKind,
  { min: number; max: number; def: number }
> = {
  NTC: { min: -20, max: 120, def: 25 },
  PTC: { min: -20, max: 180, def: 25 },
};

/** Curie point (°C) of the switching-ceramic PTC — the analogy's snap-shut marker. */
export const PTC_CURIE = PTC_CURIE_C;

/** Normalised temperature 0..1 over a kind's knob range (for heater glow, waves). */
export function tempNorm(kind: ThermistorKind, tempC: number): number {
  const r = THERMISTOR_TEMP[kind];
  return Math.min(1, Math.max(0, (tempC - r.min) / (r.max - r.min)));
}

// SPDX-License-Identifier: Apache-2.0
// First-order lumped self-heating — the datasheet abstraction the game wants to teach. A part
// dissipating power P = V·I warms toward a steady junction temperature Tj = Tambient + P·θ_JA and
// relaxes there on a thermal time constant τ = θ_JA·Cth (the same RC shape the game already teaches with
// caps). Pure, deterministic, TICK-DRIVEN: the loop advances Tj a fixed Δt per simulated tick (never
// wall-clock), so the temperature trajectory is a pure function of the per-tick power history and is
// replay-safe — see docs/heat-on-the-board-ideation.md (Path 1, web-side, golden-safe).
//
// Why web-side / golden-safe: Tj never enters the deterministic core. Its only consequences in v1 are
// (a) a body heat-glow (pure presentation) and (b) an over-temperature / derated-current FAIL flag,
// which — like the existing rating FAIL — only *flags* a part and never alters the solve, so it is
// replay-safe even though Tj is accumulated outside sim-core. (Feeding Tj *back* into device values
// — R(T) drift, thermal runaway — would change the solve and is deferred to a future sim-core hashed-Tj
// model, where it can be advanced per-tick inside the solve.) Effects are Real-mode-only.

/** Board ambient temperature (°C) — a cold part sits here and shows no glow. */
export const T_AMBIENT_C = 25;

/** Junction temperature (°C) at/below which a part is "warm but fine" — derating starts above it. */
export const T_WARN_C = 85;
/** Junction temperature (°C) at which a part is cooked — full derate / thermal death. */
export const T_MAX_C = 150;

/** Heatsink levels (the picker labels): none / a heatsink / a large sink. A management lever. */
export const HEATSINK_LABELS = ["No sink", "Heatsink", "Large sink"] as const;
// θ_JA multiplier per heatsink level: a sink bonds the junction to far more surface area, dropping the
// junction-to-ambient resistance (so the same power yields a lower steady Tj). Game-scaled ordering.
const HEATSINK_FACTOR = [1, 0.4, 0.18];

/** The θ_JA multiplier for a heatsink level (0 none … 2 large) — multiplies a part's thermal resistance
 *  DOWN so it runs cooler for the same power. `1` (no sink) leaves the part's nominal θ_JA. */
export function heatsinkFactor(level: number | undefined): number {
  const l = Math.max(
    0,
    Math.min(HEATSINK_FACTOR.length - 1, Math.round(level ?? 0)),
  );
  return HEATSINK_FACTOR[l] ?? 1;
}

/** Per-kind lumped thermal parameters. */
export interface ThermalSpec {
  /** θ_JA — junction-to-ambient thermal resistance (°C/W). Higher = hotter per watt (a tiny SMD part);
   *  lower = a big / heatsinked part. */
  thetaJA: number;
  /** Cth — thermal mass (J/°C). Higher = slower to warm and cool (τ = θ_JA·Cth). */
  cth: number;
}

// Game-scaled defaults (realistic ORDERING — small parts run hotter and faster; the absolute °C/W and
// time constants are tuned so a ~0.5–2 W part visibly warms over a few seconds, like diode TT / cap leak
// are game-scaled). τ = θ_JA·Cth lands ~1–4 s so warm/cool is watchable.
const THERMAL_BY_KIND: Record<string, ThermalSpec> = {
  R: { thetaJA: 80, cth: 0.03 }, // generic resistor: ~2.4 s, ~80 °C/W
  SHUNT: { thetaJA: 80, cth: 0.03 },
  NTC: { thetaJA: 80, cth: 0.03 },
  PTC: { thetaJA: 80, cth: 0.03 },
  C: { thetaJA: 40, cth: 0.05 }, // caps barely dissipate (ESR only); cool & slow
  EC: { thetaJA: 40, cth: 0.05 },
  L: { thetaJA: 60, cth: 0.05 }, // winding DCR
  D: { thetaJA: 100, cth: 0.02 }, // small junction: hot & quick
  LED: { thetaJA: 100, cth: 0.02 },
  ZEN: { thetaJA: 90, cth: 0.025 },
  NM: { thetaJA: 120, cth: 0.02 }, // small-signal FET/BJT: hottest & fastest (no power variant yet)
  PM: { thetaJA: 120, cth: 0.02 },
  Q: { thetaJA: 120, cth: 0.02 },
  QP: { thetaJA: 120, cth: 0.02 },
  OA: { thetaJA: 70, cth: 0.04 }, // IC package: moderate
};
const DEFAULT_THERMAL: ThermalSpec = { thetaJA: 80, cth: 0.03 };

// Ideal / non-dissipating-on-the-board kinds: power sources, ground, and meters don't model self-heating
// (a supply's losses are internal, and the dissipation lesson is about the load). They stay at ambient.
const NO_HEAT = new Set([
  "V",
  "AC",
  "PULSE",
  "GND",
  "VM",
  "AM",
  "OM",
  "WM",
  "SCOPE",
  "PROBE",
]);

/** Whether a part kind models self-heating (false → it stays at ambient). */
export function partHeats(kind: string): boolean {
  return !NO_HEAT.has(kind);
}

/** The lumped thermal parameters for a part kind (a sensible default for unlisted kinds). */
export function thermalSpec(kind: string): ThermalSpec {
  return THERMAL_BY_KIND[kind] ?? DEFAULT_THERMAL;
}

/** The steady-state body temperature (°C) a part dissipating `powerW` settles at: Tamb + P·θ_JA.
 *  Negative power (a source delivering, a reactive part returning energy) contributes no heat. */
export function steadyTemp(
  kind: string,
  powerW: number,
  ambientC = T_AMBIENT_C,
): number {
  return ambientC + Math.max(0, powerW) * thermalSpec(kind).thetaJA;
}

/** Advance a part's temperature one tick of `dt` seconds toward its steady-state target (a stable,
 *  explicit backward-Euler-style relaxation). The step factor is clamped to ≤ 1 so a large dt relative
 *  to τ can approach but never overshoot the target — keeping the integrator unconditionally stable and
 *  monotonic. Deterministic: a pure function of (kind, current Tj, power, dt). */
export function stepTemp(
  kind: string,
  tjC: number,
  powerW: number,
  dt: number,
  ambientC = T_AMBIENT_C,
  thetaScale = 1,
): number {
  if (!partHeats(kind)) return ambientC;
  const s = thermalSpec(kind);
  // A heatsink (thetaScale < 1) lowers the effective θ_JA → a lower steady target (and, since τ = θ·Cth,
  // a faster relaxation, which reads as the sink whisking heat away).
  const theta = s.thetaJA * thetaScale;
  const tau = Math.max(dt, theta * s.cth);
  const target = ambientC + Math.max(0, powerW) * theta;
  const a = Math.min(1, dt / tau);
  return tjC + (target - tjC) * a;
}

/** The derated current-rating fraction (0..1) as a part heats: full rating at/below {@link T_WARN_C},
 *  ramping linearly down to `floor` at {@link T_MAX_C}. A hot part's effective rating shrinks, so the
 *  FAIL check trips sooner — the datasheet derating curve. */
export function derate(
  tjC: number,
  floor = 0.2,
  tWarnC = T_WARN_C,
  tMaxC = T_MAX_C,
): number {
  if (tjC <= tWarnC) return 1;
  if (tjC >= tMaxC) return floor;
  return 1 - (1 - floor) * ((tjC - tWarnC) / (tMaxC - tWarnC));
}

/** A 0..1 "how hot" factor for the body heat-glow: 0 at ambient (invisible — a cold board is unchanged),
 *  ramping to 1 at {@link T_MAX_C}. Presentation only. */
export function glowFactor(tjC: number, ambientC = T_AMBIENT_C): number {
  if (tjC <= ambientC) return 0;
  if (tjC >= T_MAX_C) return 1;
  return (tjC - ambientC) / (T_MAX_C - ambientC);
}

/** A part's dissipated power (W) from its live electrical state: `max(0, V_across · I_through)`. A
 *  resistor's `V·I = I²R > 0` heats it; a source delivering (the product is negative) contributes no
 *  self-heat (its losses are internal — see {@link partHeats}). */
export function dissipatedPower(e: {
  current: number;
  vAcross: number;
}): number {
  return Math.max(0, e.vAcross * e.current);
}

/** Advance every part's body temperature by one integration interval of `dtSeconds` (the elapsed
 *  **sim** time — `Δticks · DT`, never wall-clock — so the trajectory tracks the deterministic sim
 *  clock). Returns a fresh `id → Tj` map. In Ideal mode (or for a non-heating kind) parts stay at
 *  ambient. `power(id)` is the part's dissipated watts (e.g. {@link dissipatedPower} over the frame's
 *  electrical map). Pure: `(prev, power, dt) → next`. */
export function advanceTemps(
  prev: Map<number, number>,
  parts: Iterable<{ id: number; kind: string }>,
  power: (id: number) => number,
  dtSeconds: number,
  real: boolean,
): Map<number, number> {
  const next = new Map<number, number>();
  for (const p of parts) {
    if (!real || !partHeats(p.kind)) {
      next.set(p.id, T_AMBIENT_C);
      continue;
    }
    const tj = prev.get(p.id) ?? T_AMBIENT_C;
    next.set(p.id, stepTemp(p.kind, tj, power(p.id), dtSeconds));
  }
  return next;
}

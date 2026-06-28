// SPDX-License-Identifier: Apache-2.0
// Quality "tiers" for main gameplay: each tiered part kind comes in four grades — budget,
// mid-range, high-end, lab-grade — and each grade is a preset bundle of the device's model
// parameters (the per-element param block sim-core reads, PARAM_STRIDE wide). A better tier
// means a better part (and, later, a higher cost). The param SLOT meanings mirror
// `Element::params` in crates/sim-core/src/lib.rs; a slot of 0 means "use the kind default".
// In the sandbox the raw params stay editable — this is the curated set for the game.

/** Number of f64 model parameters per device — mirrors sim-core's `PARAM_STRIDE`.
 * Provisioned to 8 by ADR 0002 (was 4). MUST equal the sim-core constant: every element's
 * param block is emitted exactly `PARAM_STRIDE` wide and the core rejects any other length.
 * The per-tier param literals below stay ≤4 entries (slots 4–7 reserved); buildNetlist
 * zero-pads each block out to this stride, which is golden-safe (a 0 slot = the kind default). */
export const PARAM_STRIDE = 8;

/** The four grades, by index (0 budget … 3 lab-grade). */
export const TIER_LABELS = [
  "Budget",
  "Mid-range",
  "High-end",
  "Lab-grade",
] as const;

/** Tier a placed part uses until the player picks one (mid-range). */
export const DEFAULT_TIER = 1;

// Per kind, the param block for each of the four tiers. Slot meanings per kind:
//   OA (op-amp):       [0] = gain-bandwidth product (Hz)
//   C  (cap):          [0] = ESR (Ω), [1] = ESL (H)
//   L  (inductor):     [0] = DCR (Ω), [1] = winding capacitance (F)
//   NM/PM (MOSFET):    [0] = transconductance Kp (A/V²)
//   Q/QP  (BJT):       [0] = forward current gain β
// A kind absent here has no tiers (its params stay at the sim-core defaults).
const TIER_PARAMS: Record<string, number[][]> = {
  // Voltage / AC source: [0] = output impedance (Ω) — a budget supply sags under load, a
  // lab supply is stiff. TRANSIENT-affecting, so buildNetlist only applies it in Real mode.
  V: [
    [1.0, 0, 0, 0], // budget: 1 Ω — visibly sags
    [0.1, 0, 0, 0], // mid
    [0.02, 0, 0, 0], // high
    [0.005, 0, 0, 0], // lab: stiff
  ],
  AC: [
    [1.0, 0, 0, 0],
    [0.1, 0, 0, 0],
    [0.02, 0, 0, 0],
    [0.005, 0, 0, 0],
  ],
  OA: [
    [3e5, 0, 0, 0], // budget: 300 kHz — slow
    [1e6, 0, 0, 0], // mid: 1 MHz (the 741-class default)
    [1e7, 0, 0, 0], // high: 10 MHz
    [5e7, 0, 0, 0], // lab: 50 MHz — fast precision part
  ],
  C: [
    [0.3, 3.0e-9, 0, 0], // budget: lossy, high ESR/ESL → low self-resonance
    [0.05, 1.5e-9, 0, 0], // mid
    [0.01, 0.8e-9, 0, 0], // high
    [0.003, 0.4e-9, 0, 0], // lab: very low ESR/ESL — clean to high frequency
  ],
  L: [
    [1.0, 5.0e-12, 0, 0], // budget: resistive winding, high inter-turn C
    [0.3, 1.5e-12, 0, 0], // mid
    [0.1, 0.6e-12, 0, 0], // high
    [0.03, 0.2e-12, 0, 0], // lab
  ],
  // MOSFET transconductance Kp (A/V²): a stronger part drives more current per gate volt
  // (the analogue of a lower Rds(on)). Mid = the sim-core MOS_KP default (0.02), so existing
  // circuits are unchanged. TRANSIENT (operating-point) — buildNetlist applies it in Real mode.
  NM: [
    [0.01, 0, 0, 0], // budget: weak
    [0.02, 0, 0, 0], // mid (default)
    [0.04, 0, 0, 0], // high
    [0.08, 0, 0, 0], // lab: strong
  ],
  PM: [
    [0.01, 0, 0, 0],
    [0.02, 0, 0, 0],
    [0.04, 0, 0, 0],
    [0.08, 0, 0, 0],
  ],
  // BJT forward current gain β: a higher-gain part draws less base current for the same
  // collector current. Mid = the sim-core BJT_BF default (100), so existing circuits are
  // unchanged. TRANSIENT (operating-point) — buildNetlist applies it in Real mode.
  Q: [
    [60, 0, 0, 0], // budget: low gain
    [100, 0, 0, 0], // mid (default)
    [200, 0, 0, 0], // high
    [400, 0, 0, 0], // lab: high gain
  ],
  QP: [
    [60, 0, 0, 0],
    [100, 0, 0, 0],
    [200, 0, 0, 0],
    [400, 0, 0, 0],
  ],
};

// The electrolytic cap (EC) is graded WEB-SIDE rather than through the sim-core param
// block: buildNetlist already expands it into an ideal cap + a series ESR resistor, so its
// tier just sets that resistor's value (a budget bulk cap is lossy; a polymer/lab cap is
// tight). Mid-range = the old fixed `EC_ESR_OHMS` (0.5 Ω), so existing EC circuits are
// unchanged. (Devices graded by an expansion like this don't go through `tierParams`.)
const EC_ESR_BY_TIER = [1.0, 0.5, 0.1, 0.03]; // budget … lab, ohms

/** The ESR (Ω) for an electrolytic cap at the given tier — used by buildNetlist. */
export function ecEsr(tier: number): number {
  const t = Math.max(0, Math.min(EC_ESR_BY_TIER.length - 1, Math.round(tier)));
  return EC_ESR_BY_TIER[t] ?? 0.5;
}

// A resistor's quality is its tolerance. In REALISTIC mode buildNetlist deviates its actual
// value deterministically (per component id) within the band, so a budget part is imprecise
// and a lab part is tight; ideal mode keeps every resistor exact. Standard E-series grades.
const R_TOLERANCE_BY_TIER = [0.05, 0.01, 0.005, 0.001]; // ±fraction: budget … lab

/** The tolerance (± fraction) of a resistor at the given tier — used by buildNetlist. */
export function resistorTolerance(tier: number): number {
  const t = Math.max(
    0,
    Math.min(R_TOLERANCE_BY_TIER.length - 1, Math.round(tier)),
  );
  return R_TOLERANCE_BY_TIER[t] ?? 0.01;
}

// A capacitor's leakage is its insulation resistance, expressed as the self-discharge time constant
// tau = R_leak·C — a dielectric/quality property, independent of the capacitance value. In REALISTIC
// mode buildNetlist installs tau in the cap's leak slot (CAP_LEAK_SLOT), so a charged cap slowly
// self-discharges: a held cap (a DRAM 1T1C storage cell, a sample-and-hold, a bootstrap) loses its
// value and must be refreshed, while a filter/coupling cap (tau ≫ its signal period) is unaffected.
// Ideal mode = perfect, non-leaking caps. GAME-SCALED for legibility (seconds, not the real
// hours/days a film cap takes): the realistic ORDERING — budget < mid < high-end < lab-grade — is
// what matters, not the absolute time. Mirrors the diode reverse-recovery TT convention.
const CAP_LEAK_TAU_BY_TIER = [1.0, 8.0, 60.0, 600.0]; // budget … lab, seconds (self-discharge tau)

// An electrolytic's oxide dielectric leaks far more than a film/ceramic cap (lower insulation
// resistance), so its self-discharge tau is a fraction of the film-cap value at the same grade.
const EC_LEAK_FACTOR = 0.2;

/** The self-discharge time constant tau (s) for a film/ceramic cap (kind `C`) at the given tier —
 * buildNetlist installs it as the cap's leak (Real mode only). Larger tau = a better, less-leaky
 * part. */
export function capLeakTau(tier: number): number {
  const t = Math.max(
    0,
    Math.min(CAP_LEAK_TAU_BY_TIER.length - 1, Math.round(tier)),
  );
  return CAP_LEAK_TAU_BY_TIER[t] ?? 8.0;
}

/** The self-discharge tau (s) for an electrolytic cap (kind `EC`) at the given tier — leakier (a
 * shorter tau) than a film cap of the same grade. */
export function ecLeakTau(tier: number): number {
  return capLeakTau(tier) * EC_LEAK_FACTOR;
}

/** The param block for a part's `(kind, tier)`, or `null` if the kind has no tiers. */
export function tierParams(kind: string, tier: number): number[] | null {
  const grades = TIER_PARAMS[kind];
  if (!grades) return null;
  const t = Math.max(0, Math.min(grades.length - 1, Math.round(tier)));
  return grades[t] ?? null;
}

/** Whether a kind has quality tiers (so the inspector shows the tier picker). Covers both
 * param-block kinds ({@link TIER_PARAMS}) and web-expansion kinds (EC). */
export function hasTiers(kind: string): boolean {
  return kind in TIER_PARAMS || kind === "EC" || kind === "R";
}

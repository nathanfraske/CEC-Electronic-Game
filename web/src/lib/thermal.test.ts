// SPDX-License-Identifier: Apache-2.0
// The lumped self-heating model: steady-state Tj = Tamb + P·θ_JA, RC relaxation on τ = θ·Cth, derating,
// and determinism. Pure math, no wasm.
import { describe, it, expect } from "vitest";
import {
  T_AMBIENT_C,
  T_WARN_C,
  T_MAX_C,
  thermalSpec,
  steadyTemp,
  stepTemp,
  derate,
  partHeats,
  glowFactor,
} from "./thermal";

// Integrate Tj from ambient at constant power for `seconds` at a fixed dt — the tick-driven loop's job.
function warmUp(
  kind: string,
  powerW: number,
  seconds: number,
  dt = 0.01,
): number {
  let tj = T_AMBIENT_C;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) tj = stepTemp(kind, tj, powerW, dt);
  return tj;
}

describe("lumped self-heating model", () => {
  it("steady-state is Tamb + P·θ_JA", () => {
    expect(steadyTemp("R", 0)).toBe(T_AMBIENT_C);
    expect(steadyTemp("R", 1)).toBeCloseTo(
      T_AMBIENT_C + thermalSpec("R").thetaJA,
      6,
    );
    // Negative power (a source delivering) contributes no heat.
    expect(steadyTemp("R", -5)).toBe(T_AMBIENT_C);
  });

  it("relaxes toward steady state on the thermal time constant τ = θ·Cth (~63% after one τ)", () => {
    const s = thermalSpec("R");
    const tau = s.thetaJA * s.cth;
    const target = steadyTemp("R", 1); // 105 °C
    const afterTau = warmUp("R", 1, tau);
    // One τ → ~63.2% of the way from ambient to target.
    const frac = (afterTau - T_AMBIENT_C) / (target - T_AMBIENT_C);
    expect(frac).toBeGreaterThan(0.6);
    expect(frac).toBeLessThan(0.66);
    // Many τ → essentially at the target (within ~0.5 °C after 6τ).
    expect(warmUp("R", 1, 6 * tau)).toBeCloseTo(target, 0);
  });

  it("is monotonic and never overshoots the target (stable at any dt)", () => {
    let tj = T_AMBIENT_C;
    let prev = tj;
    const target = steadyTemp("R", 1);
    for (let i = 0; i < 1000; i++) {
      tj = stepTemp("R", tj, 1, 0.01);
      expect(tj).toBeGreaterThanOrEqual(prev - 1e-9); // monotonic up
      expect(tj).toBeLessThanOrEqual(target + 1e-9); // never overshoots
      prev = tj;
    }
    // A dt larger than τ clamps to the target exactly (no oscillation/overshoot).
    expect(stepTemp("R", T_AMBIENT_C, 1, 100)).toBeCloseTo(target, 6);
  });

  it("cools back toward ambient when the load drops (P = 0)", () => {
    const hot = warmUp("R", 2, 20); // get it hot
    expect(hot).toBeGreaterThan(100);
    let tj = hot;
    for (let i = 0; i < 4000; i++) tj = stepTemp("R", tj, 0, 0.01); // load off
    expect(tj).toBeCloseTo(T_AMBIENT_C, 0);
  });

  it("ideal/source kinds do not self-heat", () => {
    expect(partHeats("V")).toBe(false);
    expect(partHeats("GND")).toBe(false);
    expect(partHeats("R")).toBe(true);
    expect(stepTemp("V", T_AMBIENT_C, 100, 0.01)).toBe(T_AMBIENT_C); // huge power, still ambient
  });

  it("smaller parts run hotter and faster than larger ones at the same power", () => {
    // A FET (small junction) settles hotter than an IC package at the same dissipation.
    expect(steadyTemp("NM", 1)).toBeGreaterThan(steadyTemp("OA", 1));
  });

  it("derates the current rating above the warn temperature", () => {
    expect(derate(T_AMBIENT_C)).toBe(1);
    expect(derate(T_WARN_C)).toBe(1);
    expect(derate(T_MAX_C)).toBeCloseTo(0.2, 6);
    expect(derate((T_WARN_C + T_MAX_C) / 2)).toBeCloseTo(0.6, 6); // halfway → 1 - 0.8·0.5
    // Monotonically non-increasing in temperature.
    let prev = 1;
    for (let t = T_AMBIENT_C; t <= 200; t += 5) {
      const d = derate(t);
      expect(d).toBeLessThanOrEqual(prev + 1e-9);
      prev = d;
    }
  });

  it("glow is invisible at ambient and ramps to 1 at the max temperature", () => {
    expect(glowFactor(T_AMBIENT_C)).toBe(0);
    expect(glowFactor(T_AMBIENT_C - 10)).toBe(0);
    expect(glowFactor(T_MAX_C)).toBe(1);
    expect(glowFactor(T_MAX_C + 50)).toBe(1);
  });

  it("is deterministic — the same drive reproduces the same trajectory exactly", () => {
    const run = () => {
      let tj = T_AMBIENT_C;
      const trace: number[] = [];
      for (let i = 0; i < 500; i++) {
        const p = i < 250 ? 1.2 : 0; // a burst then cool
        tj = stepTemp("NM", tj, p, 0.005);
        trace.push(tj);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});

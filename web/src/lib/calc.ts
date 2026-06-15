// SPDX-License-Identifier: Apache-2.0
// Pure helper calculators for the info drawer's Calculators tab — voltage
// divider, Ohm's law, RC/RL time constant, reactance, resonance, RMS. Each is a
// descriptor the UI renders generically: input fields, a result, and the *worked
// substitution string* (always shown, so the calc teaches the relation instead of
// being a black-box answer machine). No DOM, trivially testable.

import { formatValue } from "./graph";

export interface CalcField {
  key: string;
  label: string;
  unit: string;
  /** A sensible starting value. */
  preset: number;
}

export interface CalcSpec {
  id: string;
  name: string;
  fields: CalcField[];
  resultUnit: string;
  /** The result and a "formula = substitution = value" line. */
  compute(v: Record<string, number>): { result: number; worked: string };
}

const f = formatValue;

export const CALCS: CalcSpec[] = [
  {
    id: "ohm",
    name: "Ohm's Law (V = I·R)",
    fields: [
      { key: "i", label: "I", unit: "A", preset: 0.005 },
      { key: "r", label: "R", unit: "Ω", preset: 1000 },
    ],
    resultUnit: "V",
    compute: (v) => {
      const result = v.i! * v.r!;
      return {
        result,
        worked: `V = I·R = ${f(v.i!, "A")} × ${f(v.r!, "Ω")} = ${f(result, "V")}`,
      };
    },
  },
  {
    id: "divider",
    name: "Voltage Divider",
    fields: [
      { key: "vin", label: "Vin", unit: "V", preset: 5 },
      { key: "r1", label: "R1", unit: "Ω", preset: 1000 },
      { key: "r2", label: "R2", unit: "Ω", preset: 2000 },
    ],
    resultUnit: "V",
    compute: (v) => {
      const result = (v.vin! * v.r2!) / (v.r1! + v.r2!);
      return {
        result,
        worked: `Vout = Vin·R2/(R1+R2) = ${f(v.vin!, "V")}·${f(v.r2!, "Ω")}/(${f(v.r1!, "Ω")}+${f(v.r2!, "Ω")}) = ${f(result, "V")}`,
      };
    },
  },
  {
    id: "tau-rc",
    name: "RC Time Constant",
    fields: [
      { key: "r", label: "R", unit: "Ω", preset: 1000 },
      { key: "c", label: "C", unit: "F", preset: 1e-6 },
    ],
    resultUnit: "s",
    compute: (v) => {
      const result = v.r! * v.c!;
      return {
        result,
        worked: `τ = R·C = ${f(v.r!, "Ω")} × ${f(v.c!, "F")} = ${f(result, "s")} (≈63% charged in 1τ)`,
      };
    },
  },
  {
    id: "tau-rl",
    name: "RL Time Constant",
    fields: [
      { key: "l", label: "L", unit: "H", preset: 1e-3 },
      { key: "r", label: "R", unit: "Ω", preset: 100 },
    ],
    resultUnit: "s",
    compute: (v) => {
      const result = v.l! / v.r!;
      return {
        result,
        worked: `τ = L/R = ${f(v.l!, "H")} / ${f(v.r!, "Ω")} = ${f(result, "s")}`,
      };
    },
  },
  {
    id: "xc",
    name: "Capacitive Reactance",
    fields: [
      { key: "freq", label: "f", unit: "Hz", preset: 500 },
      { key: "c", label: "C", unit: "F", preset: 1e-7 },
    ],
    resultUnit: "Ω",
    compute: (v) => {
      const result = 1 / (2 * Math.PI * v.freq! * v.c!);
      return {
        result,
        worked: `Xc = 1/(2π·f·C) = 1/(2π·${f(v.freq!, "Hz")}·${f(v.c!, "F")}) = ${f(result, "Ω")}`,
      };
    },
  },
  {
    id: "xl",
    name: "Inductive Reactance",
    fields: [
      { key: "freq", label: "f", unit: "Hz", preset: 500 },
      { key: "l", label: "L", unit: "H", preset: 0.1 },
    ],
    resultUnit: "Ω",
    compute: (v) => {
      const result = 2 * Math.PI * v.freq! * v.l!;
      return {
        result,
        worked: `Xl = 2π·f·L = 2π·${f(v.freq!, "Hz")}·${f(v.l!, "H")} = ${f(result, "Ω")}`,
      };
    },
  },
  {
    id: "resonance",
    name: "LC Resonance",
    fields: [
      { key: "l", label: "L", unit: "H", preset: 0.01 },
      { key: "c", label: "C", unit: "F", preset: 1e-6 },
    ],
    resultUnit: "Hz",
    compute: (v) => {
      const result = 1 / (2 * Math.PI * Math.sqrt(v.l! * v.c!));
      return {
        result,
        worked: `f₀ = 1/(2π·√(L·C)) = 1/(2π·√(${f(v.l!, "H")}·${f(v.c!, "F")})) = ${f(result, "Hz")}`,
      };
    },
  },
  {
    id: "rms",
    name: "Sine RMS",
    fields: [{ key: "peak", label: "Vpeak", unit: "V", preset: 5 }],
    resultUnit: "V",
    compute: (v) => {
      const result = v.peak! / Math.SQRT2;
      return {
        result,
        worked: `Vrms = Vpeak/√2 = ${f(v.peak!, "V")}/√2 = ${f(result, "V")}`,
      };
    },
  },
];

// SPDX-License-Identifier: Apache-2.0
// Per-part teaching content for the component info drawer. Each simulated kind
// carries its governing equation, that equation with the *live* numbers plugged
// in (`headline`), a *static* plain-language explanation, and a few derived rows
// — the live pieces are pure functions of the live ElectricalState
// ({ current, vAcross }) and the part's value, so the drawer needs no new data or
// wasm crossing. The prose is deliberately number-free so it never reflows as the
// readings change; all the changing numbers live in `headline` + `derived`, which
// the drawer groups into a separate "Right now" section. Presentation only.

import { formatValue } from "./graph";
import type { ElectricalState } from "./glyphs";

export interface DerivedRow {
  label: string;
  value: string;
}

export interface PartInfo {
  /** Human name (matches the bin). */
  name: string;
  /** The symbolic governing relation, e.g. "V = I · R". */
  equation: string;
  /** The relation with the live numbers substituted (goes in the live section). */
  headline(e: ElectricalState, value: number): string;
  /** Static plain-language explanation — no live numbers, so it never reflows. */
  plain(): string;
  /** Secondary live quantities (power, energy, τ, …) as label/value rows. */
  derived(e: ElectricalState, value: number): DerivedRow[];
}

const f = formatValue;
const conducting = (e: ElectricalState): boolean => Math.abs(e.current) > 1e-7;

export const PART_INFO: Record<string, PartInfo> = {
  R: {
    name: "Resistor",
    equation: "V = I · R",
    headline: (e, R) =>
      `${f(e.vAcross, "V")} = ${f(e.current, "A")} × ${f(R, "Ω")}`,
    plain: () =>
      "A resistor drops voltage in proportion to the current through it (Ohm's law), turning the V·I product into heat. It has no memory — the current tracks the voltage instantly.",
    derived: (e) => [
      { label: "Power P = V·I", value: f(e.vAcross * e.current, "W") },
    ],
  },
  C: {
    name: "Capacitor",
    equation: "i = C · dV/dt",
    headline: (e, C) =>
      `${f(e.current, "A")} = ${f(C, "F")} × ${f(C > 0 ? e.current / C : 0, "V/s")}`,
    plain: () =>
      "A capacitor stores energy in its electric field. Its current is set by how fast the voltage is changing (i = C·dV/dt), so a fully-charged cap looks like an open circuit while a sudden voltage step looks like a short.",
    derived: (e, C) => [
      {
        label: "Energy ½·C·V²",
        value: f(0.5 * C * e.vAcross * e.vAcross, "J"),
      },
      { label: "dV/dt = i/C", value: f(C > 0 ? e.current / C : 0, "V/s") },
    ],
  },
  L: {
    name: "Inductor",
    equation: "v = L · di/dt",
    headline: (e, L) =>
      `${f(e.vAcross, "V")} = ${f(L, "H")} × ${f(L > 0 ? e.vAcross / L : 0, "A/s")}`,
    plain: () =>
      "An inductor stores energy in its magnetic field. Its voltage is set by how fast the current is changing (v = L·di/dt), so it resists sudden change — a short to steady current, an open to a sudden step.",
    derived: (e, L) => [
      {
        label: "Energy ½·L·I²",
        value: f(0.5 * L * e.current * e.current, "J"),
      },
      { label: "di/dt = v/L", value: f(L > 0 ? e.vAcross / L : 0, "A/s") },
    ],
  },
  V: {
    name: "Voltage Source",
    equation: "V = const (forced)",
    headline: (e, V) => `Holds ${f(V, "V")} · sourcing ${f(e.current, "A")}`,
    plain: () =>
      "An ideal voltage source fixes its terminal voltage and supplies whatever current the circuit draws to hold it there.",
    derived: (e, V) => [
      { label: "Power delivered", value: f(Math.abs(V * e.current), "W") },
    ],
  },
  I: {
    name: "Current Source",
    equation: "I = const (forced)",
    headline: (e, I) => `Forces ${f(I, "A")} · develops ${f(e.vAcross, "V")}`,
    plain: () =>
      "An ideal current source is the dual of a voltage source: it pins the current at a fixed value and lets the voltage be whatever the load demands.",
    derived: (e, I) => [
      { label: "Power", value: f(Math.abs(I * e.vAcross), "W") },
    ],
  },
  AC: {
    name: "AC Source",
    equation: "v(t) = 5·sin(2π·f·t)",
    headline: (e, freq) =>
      `5 V peak @ ${f(freq, "Hz")} · now ${f(e.vAcross, "V")}`,
    plain: () =>
      "A sine source swings its voltage smoothly between +5 V and −5 V, reversing the current every half-cycle. Its RMS value (peak ÷ √2) is the steady voltage that would deliver the same power.",
    derived: (_e, freq) => [
      { label: "Period 1/f", value: f(freq > 0 ? 1 / freq : 0, "s") },
      { label: "RMS = peak/√2", value: f(5 / Math.SQRT2, "V") },
    ],
  },
  D: {
    name: "Diode",
    equation: "I = Is·(e^(V/n·Vt) − 1)",
    headline: (e) =>
      conducting(e)
        ? `Forward · ${f(e.vAcross, "V")} drop @ ${f(e.current, "A")}`
        : `Reverse · blocking (${f(e.vAcross, "V")})`,
    plain: () =>
      "A diode is a one-way valve for current: it conducts when forward-biased (anode positive, dropping ~0.6 V) and blocks when reverse-biased, passing only a tiny leakage. Current flows anode → cathode.",
    derived: (e) => [
      { label: "Power", value: f(Math.abs(e.vAcross * e.current), "W") },
    ],
  },
  SD: {
    name: "Schottky Diode",
    equation: "I = Is·(e^(V/n·Vt) − 1)",
    headline: (e) =>
      conducting(e)
        ? `Forward · ${f(e.vAcross, "V")} drop @ ${f(e.current, "A")}`
        : `Reverse · blocking (${f(e.vAcross, "V")})`,
    plain: () =>
      "A Schottky diode replaces one side of the junction with metal, so it conducts with only about a 0.3 V forward drop — roughly half a silicon diode's ~0.7 V. The much larger saturation current Is pulls that knee down (a bigger Is means the same current at a lower voltage). The low drop wastes less power and the metal junction switches fast, which is why Schottkys are the catch diode in switching supplies.",
    derived: (e) => [
      { label: "Power", value: f(Math.abs(e.vAcross * e.current), "W") },
    ],
  },
  LED: {
    name: "LED",
    equation: "I = Is·(e^(V/n·Vt) − 1)",
    headline: (e) =>
      conducting(e)
        ? `Lit · ${f(e.vAcross, "V")} drop @ ${f(e.current, "A")}`
        : `Off · blocking (${f(e.vAcross, "V")})`,
    plain: () =>
      "An LED is a diode that turns forward current into light. Its junction has a high forward drop — about 1.8–2 V, set by the semiconductor's band gap (a tiny Is and a wider junction push the knee up) — so it needs a series resistor to limit the current. The light output rises with the forward current, so the resistor sets both the operating current and the brightness. Current flows anode → cathode.",
    derived: (e) => [
      { label: "Power", value: f(Math.abs(e.vAcross * e.current), "W") },
      {
        // Radiant output tracks forward current; show it as a relative figure
        // against a ~20 mA full-brightness reference (presentation only).
        label: "Brightness (≈I/20 mA)",
        value:
          e.current > 0
            ? `${Math.round(Math.min(1, e.current / 0.02) * 100)}%`
            : "0%",
      },
    ],
  },
  SW: {
    name: "Switch",
    equation: "closed for duty × period",
    headline: (e, duty) =>
      `${Math.abs(e.vAcross) < 0.25 ? "Closed" : "Open"} · duty ${Math.round(duty * 100)}%`,
    plain: () =>
      "A clock-driven switch chops the circuit on and off at a fixed duty cycle (10 kHz here). Averaged over many cycles it delivers the duty fraction of the input — the basis of a switching regulator.",
    derived: () => [],
  },
  GND: {
    name: "Ground",
    equation: "V = 0 (reference)",
    headline: () => "0 V reference",
    plain: () =>
      "Ground: the 0 V reference that every other node's voltage is measured against. Not an element — it just anchors the circuit.",
    derived: () => [],
  },
};

export function partInfo(kind: string): PartInfo | undefined {
  return PART_INFO[kind];
}

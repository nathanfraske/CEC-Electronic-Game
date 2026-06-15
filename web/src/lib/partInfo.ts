// SPDX-License-Identifier: Apache-2.0
// Per-part teaching content for the component info drawer. Each simulated kind
// carries its governing equation, that equation with the *live* numbers plugged
// in, a plain "what's happening right now" sentence, and a few derived rows —
// all pure functions of the live ElectricalState ({ current, vAcross }) and the
// part's value, so the drawer needs no new data or wasm crossing. Presentation
// only; the words are authored, the numbers come from the same map the glyphs use.

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
  /** The relation with the live numbers substituted. */
  headline(e: ElectricalState, value: number): string;
  /** One or two plain sentences about what the part is doing this instant. */
  plain(e: ElectricalState, value: number): string;
  /** Secondary quantities (power, energy, τ, …) as label/value rows. */
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
    plain: (e) =>
      conducting(e)
        ? `Dropping ${f(e.vAcross, "V")} at ${f(e.current, "A")}, turning ${f(e.vAcross * e.current, "W")} into heat. A resistor has no memory — current tracks voltage instantly.`
        : "No current flowing, so no voltage drop. A resistor only acts when current passes through it.",
    derived: (e) => [
      { label: "Power P = V·I", value: f(e.vAcross * e.current, "W") },
    ],
  },
  C: {
    name: "Capacitor",
    equation: "i = C · dV/dt",
    headline: (e, C) =>
      `${f(e.current, "A")} = ${f(C, "F")} × ${f(C > 0 ? e.current / C : 0, "V/s")}`,
    plain: (e) =>
      `Charged to ${f(e.vAcross, "V")}, storing energy in its field. The current (${f(e.current, "A")}) is how fast that voltage is ${e.current >= 0 ? "rising" : "falling"} — a charged cap is an open, not a short.`,
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
    plain: (e) =>
      `Carrying ${f(e.current, "A")}, storing energy in its magnetic field. The voltage across it (${f(e.vAcross, "V")}) is what it takes to *change* that current — a coil resists sudden change.`,
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
    plain: (e) =>
      `An ideal source: it fixes its terminal voltage and supplies whatever current the circuit draws — ${f(Math.abs(e.current), "A")} right now.`,
    derived: (e, V) => [
      { label: "Power delivered", value: f(Math.abs(V * e.current), "W") },
    ],
  },
  I: {
    name: "Current Source",
    equation: "I = const (forced)",
    headline: (e, I) => `Forces ${f(I, "A")} · develops ${f(e.vAcross, "V")}`,
    plain: (e, I) =>
      `An ideal current source — the dual of a voltage source. It pins the current at ${f(I, "A")} and lets the voltage be whatever the load demands (${f(e.vAcross, "V")} now).`,
    derived: (e, I) => [
      { label: "Power", value: f(Math.abs(I * e.vAcross), "W") },
    ],
  },
  AC: {
    name: "AC Source",
    equation: "v(t) = 5·sin(2π·f·t)",
    headline: (e, freq) =>
      `5 V peak @ ${f(freq, "Hz")} · now ${f(e.vAcross, "V")}`,
    plain: (e, freq) =>
      `A sine source: the voltage swings between +5 V and −5 V at ${f(freq, "Hz")}, reversing the current every half-cycle. This instant it's at ${f(e.vAcross, "V")}.`,
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
    plain: (e) =>
      conducting(e)
        ? `Forward-biased and conducting: it drops ~0.6 V and passes ${f(e.current, "A")}. A one-way valve for current.`
        : "Reverse-biased: it blocks current (only a tiny leakage flows). Current can only pass anode → cathode.",
    derived: (e) => [
      { label: "Power", value: f(Math.abs(e.vAcross * e.current), "W") },
    ],
  },
  SW: {
    name: "Switch",
    equation: "closed for duty × period",
    headline: (e, duty) =>
      `${Math.abs(e.vAcross) < 0.25 ? "Closed" : "Open"} · duty ${Math.round(duty * 100)}%`,
    plain: (e, duty) =>
      `A clock-driven switch chopping at ${Math.round(duty * 100)}% duty (10 kHz). It's ${Math.abs(e.vAcross) < 0.25 ? "closed — passing current" : "open — blocking"} this instant; averaged, it delivers the duty fraction.`,
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

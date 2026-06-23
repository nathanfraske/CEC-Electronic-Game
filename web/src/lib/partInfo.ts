// SPDX-License-Identifier: Apache-2.0
// Per-part teaching content for the component info drawer. Each simulated kind
// carries its governing equation, that equation with the *live* numbers plugged
// in (`headline`), a *static* plain-language explanation, and a few derived rows
// — the live pieces are pure functions of the live ElectricalState
// ({ current, vAcross }) and the part's value, so the drawer needs no new data or
// wasm crossing. The prose is deliberately number-free so it never reflows as the
// readings change; all the changing numbers live in `headline` + `derived`, which
// the drawer groups into a separate "Right now" section. Presentation only.

import { AC_DEFAULT_AMP, formatValue } from "./graph";
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
  /**
   * The relation with the live numbers substituted (goes in the live section).
   * `value` is the part's primary scalar; `amp` is the optional second scalar (an
   * AC source's peak amplitude in volts), which only the AC source reads.
   */
  headline(e: ElectricalState, value: number, amp?: number): string;
  /** Static plain-language explanation — no live numbers, so it never reflows. */
  plain(): string;
  /** Secondary live quantities (power, energy, τ, …) as label/value rows. The
   * optional `amp` is the AC source's amplitude; other parts ignore it. */
  derived(e: ElectricalState, value: number, amp?: number): DerivedRow[];
}

const f = formatValue;
const conducting = (e: ElectricalState): boolean => Math.abs(e.current) > 1e-7;
// A thermistor's LIVE resistance from Ohm's law (V/I) — which reflects its R(T) since
// the netlist stamps R(T). Falls back to the nominal value when no current flows (R is
// unmeasurable open-circuit).
const liveR = (e: ElectricalState, nominal: number): number =>
  Math.abs(e.current) > 1e-9 ? Math.abs(e.vAcross / e.current) : nominal;

// MOSFET level-1 square-law constants, mirrored from crates/sim-core/src/lib.rs
// (MOS_KP, MOS_LAMBDA). The gate node isn't exposed to the inspector, so Vgs is
// unknown; but Id and Vds are, and in saturation the square law inverts to give
// the overdrive Vov and the transconductance gm = dId/dVgs — a useful live row.
const MOS_KP = 0.02; // A/V^2
const MOS_LAMBDA = 0.02; // 1/V

/**
 * Recover the saturation-region overdrive Vov and transconductance gm from the
 * measured drain current and |Vds|, by inverting Id = ½·KP·Vov²·(1+λ·Vds).
 * Returns zeros when there's no appreciable channel current (cutoff). This is a
 * presentation-only derivation — the solver owns the real operating point.
 */
function mosfetGm(e: ElectricalState): { vov: number; gm: number } {
  const id = Math.abs(e.current);
  if (id < 1e-9) return { vov: 0, gm: 0 };
  const vds = Math.abs(e.vAcross);
  const k = MOS_KP * (1 + MOS_LAMBDA * vds);
  const vov = Math.sqrt((2 * id) / k);
  const gm = k * vov; // gm = KP·Vov·(1+λ·Vds)
  return { vov, gm };
}

/**
 * The operating region named from what the inspector can see. Cutoff = no drain
 * current. Otherwise compare |Vds| to the recovered overdrive Vov: a saturated
 * device has Vds ≥ Vov (the channel pinched off), a triode device Vds < Vov (the
 * channel still ohmic). Matches the three regions in `mosfet_eval`.
 */
function mosfetRegion(e: ElectricalState): "cutoff" | "triode" | "saturation" {
  if (Math.abs(e.current) < 1e-9) return "cutoff";
  const { vov } = mosfetGm(e);
  return Math.abs(e.vAcross) >= vov ? "saturation" : "triode";
}

// BJT forward current gain, mirrored from crates/sim-core/src/lib.rs (BJT_BF).
// The base node isn't exposed to the inspector, so Ib is unknown directly; but in
// the active region Ic ≈ β·Ib, so the recovered base current is Ic/β — enough to
// state the gain that turned a small base current into the measured Ic.
const BJT_BF = 100; // β

/**
 * The operating region named from what the inspector can see: the collector
 * current Ic and the collector-emitter voltage Vce. Cutoff = no collector current
 * (the base-emitter junction is below its ~0.6 V knee). Otherwise a small |Vce|
 * (the device bottomed out, both junctions on) is saturation; a larger |Vce| with
 * current flowing is the forward-active region where the current gain lives. The
 * ~0.3 V corner mirrors the small Vce_sat the Ebers-Moll core settles at.
 */
function bjtRegion(e: ElectricalState): "cutoff" | "active" | "saturation" {
  if (Math.abs(e.current) < 1e-9) return "cutoff";
  return Math.abs(e.vAcross) < 0.3 ? "saturation" : "active";
}

// Format a transformer turns ratio n = Ns/Np as Np:Ns (a step-up n = 2 → "1:2",
// a step-down n = 0.5 → "2:1"), mirroring the inspector's `fmtVal`.
function ratioStr(n: number): string {
  const trim = (x: number): string =>
    (Number.isInteger(x) ? x.toString() : x.toFixed(2)).replace(/\.?0+$/, "");
  return n >= 1 ? "1:" + trim(n) : trim(1 / n) + ":1";
}

// Logic-gate info is shared but for the name, the boolean equation, and the prose:
// every gate shows the same live row — its logic-high rail, the half-rail switching
// threshold, and the output drive current — because the per-part lesson is the
// truth table (static), not a changing number. The chip is a real powered IC: its
// rail is the supply you wire across its VCC and GND pins (V(VCC) − V(GND)), and the
// live row still labels that rail off `value` for now (an acceptable approximation).
function gateInfo(name: string, equation: string, plain: string): PartInfo {
  return {
    name,
    equation,
    headline: (e, rail) =>
      `Rail ${f(rail, "V")} · threshold ${f(rail / 2, "V")} · drive ${f(e.current, "A")}`,
    plain: () => plain,
    derived: (e, rail) => [
      { label: "Output drive", value: f(e.current, "A") },
      { label: "Logic-high rail", value: f(rail, "V") },
      { label: "Switching threshold", value: f(rail / 2, "V") },
    ],
  };
}

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
  SHUNT: {
    name: "Current Shunt",
    equation: "I = V / R",
    headline: (e, R) =>
      `${f(e.current, "A")} = ${f(e.vAcross, "V")} ÷ ${f(R, "Ω")}`,
    plain: () =>
      "A current-sense shunt is a precision low-value resistor (a few milliohms) placed in series with a load. You don't use it to drop voltage — you read the tiny voltage across it and divide by its known resistance to measure the current (V = I·R, run backwards). Keeping R small keeps the inserted loss small. The catch: every resistor also has a little lead inductance, and because the shunt's R is so small, that ωL term swings the phase at high frequency — in Real mode a shunt reads an inductive lag where an ordinary resistor stays flat.",
    derived: (e, R) => [
      { label: "Sensed current I = V/R", value: f(e.current, "A") },
      { label: "Sense resistance", value: f(R, "Ω") },
      { label: "Burden voltage", value: f(e.vAcross, "V") },
      { label: "Power burden P = V·I", value: f(e.vAcross * e.current, "W") },
    ],
  },
  NTC: {
    name: "NTC Thermistor",
    equation: "R(T) = R₀·exp(B(1/T − 1/T₀))",
    headline: (e, r0) =>
      conducting(e)
        ? `${f(liveR(e, r0), "Ω")} now · ${f(e.current, "A")} through`
        : `${f(r0, "Ω")} nominal @ 25 °C`,
    plain: () =>
      "An NTC thermistor is a metal-oxide resistor whose resistance falls steeply as it heats — warmth shakes more charge carriers free, so it conducts better hot than cold. Cold it chokes the current; warm it and the current climbs. Set its temperature with the inspector knob.",
    derived: (e, r0) => [
      { label: "Resistance now", value: f(liveR(e, r0), "Ω") },
      { label: "Power P = V·I", value: f(e.vAcross * e.current, "W") },
    ],
  },
  PTC: {
    name: "PTC Thermistor",
    equation: "low R, then a jump above the Curie point",
    headline: (e, r0) =>
      conducting(e)
        ? `${f(liveR(e, r0), "Ω")} now · ${f(e.current, "A")} through`
        : `${f(r0, "Ω")} low-state @ 25 °C`,
    plain: () =>
      "A switching-ceramic PTC thermistor holds a low resistance until its Curie point, then snaps up several orders of magnitude over a few tens of degrees — the self-resetting fuse. Below Curie it passes current freely; cross it and the resistance jumps and chokes the current off. Set its temperature with the inspector knob.",
    derived: (e, r0) => [
      { label: "Resistance now", value: f(liveR(e, r0), "Ω") },
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
    equation: "v(t) = A·sin(2π·f·t)",
    headline: (e, freq, amp = AC_DEFAULT_AMP) =>
      `${f(amp, "V")} peak @ ${f(freq, "Hz")} · now ${f(e.vAcross, "V")}`,
    plain: () =>
      "A sine source swings its voltage smoothly between its positive and negative peak, reversing the current every half-cycle. Its RMS value (peak ÷ √2) is the steady voltage that would deliver the same power.",
    derived: (_e, freq, amp = AC_DEFAULT_AMP) => [
      { label: "Period 1/f", value: f(freq > 0 ? 1 / freq : 0, "s") },
      { label: "RMS = peak/√2", value: f(amp / Math.SQRT2, "V") },
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
  ZD: {
    name: "Zener Diode",
    equation: "reverse: clamp at Vz · forward: ~0.7 V diode",
    headline: (e, vz) => {
      // Forward = positive a→b current dropping the silicon knee. Breakdown = it
      // sinks current the other way (negative a→b) once reverse-biased to ~Vz.
      if (e.current > 1e-7) return `Forward · ${f(e.vAcross, "V")} drop`;
      if (e.current < -1e-7)
        return `Breakdown · clamping ≈ ${f(vz, "V")} (${f(e.vAcross, "V")})`;
      return `Blocking · Vz = ${f(vz, "V")} (${f(e.vAcross, "V")})`;
    },
    plain: () =>
      "A Zener diode turns reverse breakdown into a feature. Forward-biased it is an ordinary diode, dropping the usual ~0.7 V. Reverse-biased it stays blocking — only a tiny leakage — until the reverse voltage reaches its breakdown voltage Vz, where it suddenly conducts hard and holds the node right at Vz no matter how much more the rail pushes. Fed through a series resistor (which soaks up the excess), that clamp is the simplest shunt voltage reference.",
    derived: (e, vz) => [
      { label: "Breakdown Vz", value: f(vz, "V") },
      { label: "Power", value: f(Math.abs(e.vAcross * e.current), "W") },
    ],
  },
  MOV: {
    name: "Varistor",
    equation: "clamp at ±Vc (symmetric)",
    headline: (e, vc) => {
      // It conducts (sinks current) only while clamping a surge: positive current
      // means it is pinning a positive spike near +Vc, negative current a negative
      // spike near −Vc. Below the clamp it just leaks — idle. Report |V| vs Vc.
      if (conducting(e)) {
        const pol = e.current > 0 ? "+" : "−";
        return `Clamping ${pol}${f(vc, "V")} · ${f(e.vAcross, "V")} across`;
      }
      return `Idle · |V| ${f(Math.abs(e.vAcross), "V")} < Vc ${f(vc, "V")}`;
    },
    plain: () =>
      "A varistor (metal-oxide varistor, MOV) clamps voltage spikes. It is the across-the-line surge protector — the part wired straight across the rail in every power strip. Below its clamp voltage Vc it is almost an open circuit, passing only a tiny leakage, so it sits idle and invisible. But the moment the voltage across it reaches ±Vc — in EITHER polarity, the symmetric cousin of the Zener — it conducts hard and pins the rail near ±Vc, shunting the surge's energy through itself instead of into the load. A series element ahead of it soaks up the difference. (A real MOV slowly wears out as it absorbs joules; this ideal one does not.)",
    derived: (e, vc) => [
      { label: "Clamp Vc", value: f(vc, "V") },
      { label: "Power V·I", value: f(Math.abs(e.vAcross * e.current), "W") },
    ],
  },
  EC: {
    name: "Electrolytic Cap",
    equation: "i = C · dV/dt  (in series with ESR)",
    headline: (e, C) =>
      `${f(e.current, "A")} = ${f(C, "F")} × ${f(C > 0 ? e.current / C : 0, "V/s")}`,
    plain: () =>
      "An electrolytic capacitor stores a large amount of charge in a small package — the bulk-storage workhorse — but it is honest about its cost: a real parasitic series resistance (ESR) sits in series with the ideal capacitance. That ESR drops a little voltage whenever ripple current flows through it, dissipating heat and is exactly why a real cap can't perfectly flatten ripple. It is also polarized: the + terminal must stay positive.",
    derived: (e, C) => [
      {
        label: "Energy ½·C·V²",
        value: f(0.5 * C * e.vAcross * e.vAcross, "J"),
      },
      // The fixed parasitic series resistance modelled in buildNetlist (must match
      // EC_ESR_OHMS in netlist.ts). The little IR drop across it rides the current.
      { label: "ESR (parasitic)", value: f(0.5, "Ω") },
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
  MSW: {
    name: "Manual Switch",
    equation: "closed ⇒ wire · open ⇒ break",
    // The state is the part's `value` (1 = closed, 0 = open) — what the player
    // flipped it to — so it reads correctly even with no current flowing. When
    // closed, report the current it is passing; when open, that it is blocking.
    headline: (e, state) =>
      state >= 0.5
        ? `Closed · passing ${f(e.current, "A")}`
        : `Open · blocking (${f(e.vAcross, "V")} across)`,
    plain: () =>
      "A manual switch is a hand-operated SPST switch you flip by clicking it. Closed, it is a near-ideal wire — it conducts, dropping almost no voltage, so current flows freely through it. Open, it is a break in the circuit — an air gap that blocks all current, standing the full voltage across its contacts. It is the simplest control there is: click to make or break the loop.",
    derived: (e, state) => [
      { label: "State", value: state >= 0.5 ? "Closed" : "Open" },
      // Throughput when closed; an open switch passes nothing, so it dissipates
      // nothing either (V across, but I ≈ 0).
      { label: "Power V·I", value: f(Math.abs(e.vAcross * e.current), "W") },
    ],
  },
  NM: {
    name: "N-MOSFET",
    equation: "Id = ½·KP·(Vgs − Vth)²·(1 + λ·Vds)",
    headline: (e) => {
      const region = mosfetRegion(e);
      if (region === "cutoff")
        return `Cutoff · off · Vds = ${f(e.vAcross, "V")}`;
      const word = region === "saturation" ? "Saturation" : "Triode";
      return `${word} · Vds = ${f(e.vAcross, "V")} @ Id = ${f(e.current, "A")}`;
    },
    plain: () =>
      "An N-channel MOSFET is a voltage-controlled valve: the voltage on its insulated gate, relative to the source (Vgs), sets how much current flows from drain to source. Below a threshold of about 2 V the channel is off — cutoff, no current. Above it the channel opens, and how the device behaves depends on the drain-source voltage: with a small Vds it acts like a gate-controlled resistor (the triode region), and with a larger Vds the channel pinches off and the current levels out, set almost entirely by the gate (saturation). There the current follows a square law in the overdrive Vgs − Vth, and the transconductance gm = dId/dVgs measures the gain. Because the gate is insulated it draws no DC current at all — you steer a large drain current with a voltage that costs nothing to hold.",
    derived: (e) => {
      const { gm } = mosfetGm(e);
      return [
        { label: "Drain current Id", value: f(e.current, "A") },
        { label: "gm = dId/dVgs", value: f(gm, "S") },
        {
          label: "Power Vds·Id",
          value: f(Math.abs(e.vAcross * e.current), "W"),
        },
      ];
    },
  },
  PM: {
    name: "P-MOSFET",
    equation: "Id = ½·KP·(Vgs − Vth)²·(1 + λ·Vds), Vth < 0",
    headline: (e) => {
      const region = mosfetRegion(e);
      if (region === "cutoff")
        return `Cutoff · off · Vds = ${f(e.vAcross, "V")}`;
      const word = region === "saturation" ? "Saturation" : "Triode";
      return `${word} · Vds = ${f(e.vAcross, "V")} @ Id = ${f(e.current, "A")}`;
    },
    plain: () =>
      "A P-channel MOSFET is the mirror image of the N-channel one, and it's the natural high-side switch: it conducts when its gate is pulled below the source by more than about 2 V (a negative threshold). Tie the source to the positive rail and the device passes current to the load whenever the gate is dragged low, and blocks when the gate sits at the rail. The same three regions apply — cutoff, triode, saturation — and the same square law and transconductance gm govern it, just with the voltage signs flipped. Like the NMOS its insulated gate draws no DC current, so it holds its state for free.",
    derived: (e) => {
      const { gm } = mosfetGm(e);
      return [
        { label: "Drain current Id", value: f(e.current, "A") },
        { label: "gm = dId/dVgs", value: f(gm, "S") },
        {
          label: "Power Vds·Id",
          value: f(Math.abs(e.vAcross * e.current), "W"),
        },
      ];
    },
  },
  Q: {
    name: "NPN Transistor",
    equation: "Ic ≈ β·Ib (active) · β ≈ 100",
    headline: (e) => {
      const region = bjtRegion(e);
      if (region === "cutoff")
        return `Cutoff · off · Vce = ${f(e.vAcross, "V")}`;
      const word = region === "saturation" ? "Saturation" : "Active";
      return `${word} · Vce = ${f(e.vAcross, "V")} @ Ic = ${f(e.current, "A")}`;
    },
    plain: () =>
      "An NPN bipolar transistor is a current-controlled valve: a small current into the base controls a much larger current from the collector to the emitter. The base-emitter junction is a diode — it has to be forward-biased past its ~0.6–0.7 V knee before anything happens at all. Below that the transistor is off (cutoff, no collector current). Once the base conducts, the device enters the forward-active region, where the collector current is the base current multiplied by the current gain β (beta, around 100 here): Ic ≈ β·Ib. That multiplication is the whole point — a tiny base current commands a collector current a hundred times bigger, which makes the BJT both an amplifier and a switch. Drive the base hard enough that the collector can't supply β·Ib (the load resistor runs out of voltage) and it saturates: both junctions conduct, the collector-emitter voltage collapses to a few tenths of a volt, and it's a closed switch. Conventional current flows collector → emitter.",
    derived: (e) => {
      const region = bjtRegion(e);
      const ic = Math.abs(e.current);
      const rows: DerivedRow[] = [
        { label: "Collector current Ic", value: f(e.current, "A") },
      ];
      // The base node isn't exposed, so recover Ib from the gain in the active
      // region (Ic ≈ β·Ib). In saturation/cutoff that relation no longer sets the
      // current, so just state β rather than a misleading recovered Ib.
      if (region === "active") {
        rows.push({ label: "β = Ic/Ib", value: String(BJT_BF) });
        rows.push({
          label: "Base current Ib ≈ Ic/β",
          value: f(ic / BJT_BF, "A"),
        });
      } else {
        rows.push({ label: "Gain β (active region)", value: String(BJT_BF) });
      }
      rows.push({
        label: "Power Vce·Ic",
        value: f(Math.abs(e.vAcross * e.current), "W"),
      });
      return rows;
    },
  },
  QP: {
    name: "PNP Transistor",
    equation: "Ic ≈ β·Ib (active) · β ≈ 100 · signs flipped",
    headline: (e) => {
      const region = bjtRegion(e);
      if (region === "cutoff")
        return `Cutoff · off · Vce = ${f(e.vAcross, "V")}`;
      const word = region === "saturation" ? "Saturation" : "Active";
      return `${word} · Vce = ${f(e.vAcross, "V")} @ Ic = ${f(e.current, "A")}`;
    },
    plain: () =>
      "A PNP bipolar transistor is the polarity mirror of the NPN, and the natural high-side partner: it turns on when its base is pulled below the emitter by about 0.6–0.7 V (the emitter-base junction forward-biases), and current then flows emitter → collector — the opposite direction to the NPN. Tie the emitter to the positive rail and a small current pulled out of the base switches a much larger current down to the load. The same three regions apply — cutoff when the base sits at the rail, the forward-active region where the gain Ic ≈ β·Ib (β ≈ 100) holds, and saturation when it's driven hard and the collector-emitter voltage collapses — just with every voltage and current sign flipped relative to the NPN. The current gain, and the small base current that commands a large collector current, are exactly the same idea.",
    derived: (e) => {
      const region = bjtRegion(e);
      const ic = Math.abs(e.current);
      const rows: DerivedRow[] = [
        { label: "Collector current Ic", value: f(e.current, "A") },
      ];
      if (region === "active") {
        rows.push({ label: "β = Ic/Ib", value: String(BJT_BF) });
        rows.push({
          label: "Base current Ib ≈ Ic/β",
          value: f(ic / BJT_BF, "A"),
        });
      } else {
        rows.push({ label: "Gain β (active region)", value: String(BJT_BF) });
      }
      rows.push({
        label: "Power Vce·Ic",
        value: f(Math.abs(e.vAcross * e.current), "W"),
      });
      return rows;
    },
  },
  OA: {
    name: "Op-Amp",
    equation: "Vout = Vsat·tanh(A·(V₊ − V₋)/Vsat) · A ≈ 1e5",
    headline: (e, vsat) =>
      `Output drive ${f(e.current, "A")} · swing ±${f(Math.max(vsat, 1), "V")}`,
    plain: () =>
      "An op-amp is a differential amplifier with an enormous open-loop gain — around a hundred thousand here. It looks at the tiny difference between its two inputs, the non-inverting (+) and the inverting (−), and slams its output in whatever direction nulls that difference, until it either balances or hits a supply rail (±Vsat). Two facts explain almost every op-amp circuit. First, the inputs draw essentially no current — they only sense voltage, so the output does all the work. Second, when you wrap negative feedback from the output back to the inverting input, that huge gain forces the two inputs to nearly the same voltage: the 'virtual short'. Take it on faith and the math collapses — a follower copies its input, a non-inverting amp multiplies by 1 + Rf/Rg, an inverting amp by −Rf/Rin, all set by resistor ratios rather than the op-amp itself. Remove the feedback and the same huge gain makes a comparator: the output snaps to the positive rail when + is above −, and to the negative rail when it's below. Same part, two faces — a precise analog amplifier with feedback, a decisive digital-like switch without it.",
    derived: (e, vsat) => [
      { label: "Output drive Iout", value: f(e.current, "A") },
      { label: "Open-loop gain A₀", value: "≈ 100,000" },
      { label: "Output swing", value: `±${f(Math.max(vsat, 1), "V")}` },
    ],
  },
  AND: gateInfo(
    "AND Gate",
    "Y = A · B",
    "An AND gate drives its output high only when BOTH inputs are high; any low input forces the output low. It is a real powered chip — wire its VCC pin to a positive rail and its GND pin to ground, and the supply across those two pins (V(VCC) − V(GND)) becomes its logic rail. With no power wired the IC is dead and its output goes high-impedance, so always feed it VCC and GND first. It reads each input (measured against GND) as a 1 when the voltage is above half that rail and as a 0 below — a single clean threshold, no in-between. Like every gate here the inputs draw essentially no current (they only sense the voltage), while the output is driven hard toward VCC or GND through a low-impedance driver. The decision is taken from the previous tick's input levels, so the output lags its inputs by exactly one simulation step — the propagation delay every real gate has, and what makes chains of gates settle in sequence rather than all at once.",
  ),
  OR: gateInfo(
    "OR Gate",
    "Y = A + B",
    "An OR gate drives its output high when EITHER input is high (or both); only two low inputs give a low output. It is a powered chip — wire VCC to a positive rail and GND to ground, and the supply across them is the logic rail; until you do, the IC is dead and its output floats. Each input (measured against GND) is thresholded at half that rail — above is a 1, below a 0. The inputs draw essentially no current; the output is driven hard to VCC or to GND. The output follows the previous tick's inputs, so it lags by one simulation step — the gate's propagation delay.",
  ),
  NAND: gateInfo(
    "NAND Gate",
    "Y = (A · B)′",
    "A NAND gate is the inverse of AND: its output is low only when both inputs are high, and high in every other case. NAND is universal — every other gate, and so every digital circuit, can be built from NAND gates alone, which is why real logic families are full of them. It is a powered chip: wire VCC and GND across it and the supply between them is the logic rail — with no power the IC is dead and its output floats. Inputs (measured against GND) are thresholded at half that rail and draw no current; the output is driven hard to VCC or GND, one tick after the inputs change.",
  ),
  NOR: gateInfo(
    "NOR Gate",
    "Y = (A + B)′",
    "A NOR gate is the inverse of OR: its output is high only when BOTH inputs are low, and low otherwise. Like NAND it is universal — any logic can be built from NOR alone. It is a powered chip: wire VCC and GND across it and the supply between them sets the logic rail — unpowered, the IC is dead and its output floats. Inputs (measured against GND) are read against a half-rail threshold and draw no current; the output is driven hard to VCC or GND, lagging the inputs by one simulation step (the propagation delay).",
  ),
  XOR: gateInfo(
    "XOR Gate",
    "Y = A ⊕ B",
    "An XOR (exclusive-OR) gate drives its output high when its inputs DIFFER and low when they match. It is the heart of binary arithmetic — the sum bit of a half-adder is exactly A XOR B (and A AND B is the carry) — and the basis of parity and comparison logic. It is a powered chip: wire VCC and GND across it and the supply between them is the logic rail — without power the IC is dead and its output floats. Inputs (measured against GND) are thresholded at half that rail and draw no current; the output is driven hard to VCC or GND, one tick after the inputs settle.",
  ),
  XNOR: gateInfo(
    "XNOR Gate",
    "Y = (A ⊕ B)′",
    "An XNOR (exclusive-NOR, or equality) gate is the complement of XOR: it drives its output high when its inputs MATCH and low when they differ — a one-bit equality test. Chain them to compare multi-bit buses. It is a powered chip: wire VCC and GND across it and the supply between them is the logic rail — unpowered, the IC is dead and its output floats. Inputs (measured against GND) are thresholded at half that rail and draw no current; the output is driven hard to VCC or GND, one tick after the inputs settle.",
  ),
  IMPLY: gateInfo(
    "IMPLY Gate",
    "Y = A′ + B",
    "An IMPLY gate computes material implication, A → B: its output is high unless A is high and B is low — an OR with input A inverted. The only case that drives it low is the broken promise, A true while B is false; every other input leaves it high. It is a real powered chip — wire its VCC pin to a positive rail and its GND pin to ground, and the supply across those two pins (V(VCC) − V(GND)) is its logic rail; with no power the IC is dead and its output floats, so feed it VCC and GND first. Each input (measured against GND) is thresholded at half that rail — above is a 1, below a 0 — and draws essentially no current; the output is driven hard to VCC or GND, lagging the inputs by exactly one simulation step (the propagation delay).",
  ),
  NIMPLY: gateInfo(
    "NIMPLY Gate",
    "Y = A · B′",
    "A NIMPLY gate computes material nonimplication, A ↛ B: its output is high only when A is high and B is low — an AND with input B inverted. It is exactly the complement of IMPLY, firing on the one case implication forbids. It is a real powered chip — wire its VCC pin to a positive rail and its GND pin to ground, and the supply across those two pins (V(VCC) − V(GND)) is its logic rail; with no power the IC is dead and its output floats, so feed it VCC and GND first. Each input (measured against GND) is thresholded at half that rail — above is a 1, below a 0 — and draws essentially no current; the output is driven hard to VCC or GND, lagging the inputs by exactly one simulation step (the propagation delay).",
  ),
  NOT: gateInfo(
    "NOT Gate",
    "Y = A′",
    "A NOT gate (an inverter) drives its output to the opposite of its single input: high in gives low out, low in gives high out. It is the simplest active logic element and the building block of every more complex gate. It is a real powered chip — wire its VCC pin to a positive rail and its GND pin to ground, and the supply across them (V(VCC) − V(GND)) is its logic rail; with no power the IC is dead and its output floats, so feed it VCC and GND first. The input (measured against GND) is thresholded at half that rail and draws no current; the output is driven hard to VCC or GND, lagging the input by exactly one simulation step. Wire an inverter's output back to its input and that one-tick delay makes it oscillate — a ring oscillator.",
  ),
  BUF: gateInfo(
    "Buffer",
    "Y = A",
    "A buffer (BUF) drives its output to MATCH its single input — a non-inverting gate. It does no logic; it restores and re-drives a weak or loaded signal (a line driver) and adds exactly one simulation step of delay. It is a real powered chip — wire its VCC pin to a positive rail and its GND pin to ground, and the supply across them is its logic rail; with no power the IC is dead and its output floats. The input (measured against GND) is thresholded at half that rail and draws no current; the output is driven hard to VCC or GND.",
  ),
  TR: {
    name: "Transformer",
    equation: "Vs/Vp = Ns/Np = n · Vp·Ip = Vs·Is",
    headline: (e, n) =>
      `Ratio ${ratioStr(n)} · primary ${f(e.vAcross, "V")} → secondary ≈ ${f(n * e.vAcross, "V")}`,
    plain: () =>
      "A transformer is two coils wound on a shared magnetic core. An alternating current in the primary sets up a changing magnetic flux in the core, and that changing flux induces a voltage in the secondary — Faraday's law. The voltage scales with the turns ratio: a secondary with twice the primary's turns sees twice the voltage, and because power is conserved (apart from small losses) it then carries half the current. Crucially, only a *changing* flux induces anything, so a transformer passes AC but blocks DC — feed it a steady voltage and, once the primary current settles against the winding resistance, the secondary goes quiet. The two windings share no electrical connection, only the core, so a transformer also isolates: the secondary can float at its own reference. Step up for high-voltage transmission, step down for a safe supply rail, or wire it 1:1 purely to isolate.",
    derived: (e, n) => [
      { label: "Turns ratio Np:Ns", value: ratioStr(n) },
      { label: "Primary voltage Vp", value: f(e.vAcross, "V") },
      { label: "Secondary ≈ n·Vp", value: f(n * e.vAcross, "V") },
      { label: "Primary current Ip", value: f(e.current, "A") },
    ],
  },
  POT: {
    name: "Potentiometer",
    equation: "R(A→W) = R·t · R(W→B) = R·(1−t)",
    headline: (e, r) =>
      `${f(r, "Ω")} track · ${f(e.vAcross, "V")} across @ ${f(e.current, "A")}`,
    plain: () =>
      "A potentiometer is a resistor with a sliding wiper that taps the track somewhere between its two ends. Wire the two ends across a voltage and the wiper picks off an adjustable fraction of it — a variable divider, the workhorse 'knob' for volume, brightness, set-points, and bias. The wiper splits the total resistance into two pieces — R·t from the A end to the wiper and R·(1−t) from the wiper to B — so sliding it trades resistance from one side to the other while the total stays fixed. Use all three terminals as a divider, or just one end and the wiper as a plain adjustable resistor (a rheostat).",
    derived: (e, r) => [
      { label: "Total resistance", value: f(r, "Ω") },
      { label: "Voltage across A–B", value: f(e.vAcross, "V") },
      { label: "Current (A→W leg)", value: f(e.current, "A") },
    ],
  },
  FF: {
    name: "D Flip-Flop",
    equation: "Q ← D on ↑CLK · Q̄ = Q′",
    headline: (e, rail) =>
      `Rail ${f(rail, "V")} · clock-edge memory · Q drive ${f(e.current, "A")}`,
    plain: () =>
      "A D flip-flop is one bit of memory. On each rising edge of its clock it samples whatever is on its D input and locks that value onto its Q output (with Q̄ the complement); between edges it ignores D entirely and just holds. That 'capture on the edge, hold until the next one' is what makes synchronous digital systems possible — every register, counter, and state machine is built from flip-flops clocked together. Inputs are read against a half-rail threshold; the outputs are driven hard to the rail or ground one tick after the edge (the clock-to-output delay). Tie Q̄ back to D and it toggles on every clock — a divide-by-two, and the seed of every binary counter.",
    derived: (e, rail) => [
      { label: "Logic rail", value: f(rail, "V") },
      { label: "Q output drive", value: f(e.current, "A") },
      { label: "Switching threshold", value: f(rail / 2, "V") },
    ],
  },
  HADD: {
    name: "Half Adder",
    equation: "SUM = A ⊕ B · COUT = A · B",
    headline: (e, rail) =>
      `Rail ${f(rail, "V")} · A + B → {COUT, SUM} · drive ${f(e.current, "A")}`,
    plain: () =>
      "A half adder adds two bits and reports a sum and a carry-out — and that is all it does, with no carry-in. The sum is A XOR B (high when the inputs differ) and the carry-out is A AND B (high only when both are 1), so two bits add to 0, 1, or — when they are both 1 — a 2 carried out. It is the rung below the full adder: the cell at the very least-significant position of a ripple chain, where there is nothing yet to carry in. It is built from exactly an XOR and an AND, which is the lesson — meeting addition without the carry-in pin first makes the full adder's third input obvious. It is a real powered IC made of gates: wire VCC to a positive rail and GND to ground, and the supply across them (V(VCC) − V(GND)) is the logic rail every output swings within. Inputs are read against a half-rail threshold and draw essentially no current; the outputs are driven hard to VCC or GND, and lag the inputs by the internal gates' propagation delay.",
    derived: (e, rail) => [
      { label: "Logic rail", value: f(rail, "V") },
      { label: "Output drive", value: f(e.current, "A") },
      { label: "Switching threshold", value: f(rail / 2, "V") },
    ],
  },
  FADD: {
    name: "Full Adder",
    equation: "SUM = A ⊕ B ⊕ CIN · COUT = majority(A, B, CIN)",
    headline: (e, rail) =>
      `Rail ${f(rail, "V")} · A + B + CIN → {COUT, SUM} · drive ${f(e.current, "A")}`,
    plain: () =>
      "A full adder adds three bits — A, B, and a carry-in — and reports a sum and a carry-out. The sum is the three-way parity A XOR B XOR CIN (high when an odd number of inputs are 1) and the carry-out is the majority of the three (high when at least two are 1). That extra carry-in is what lets it chain: wire each stage's COUT into the next stage's CIN and N of them form an N-bit ripple-carry adder — the cell every ALU is built from. A full adder is literally two half-adders plus an OR on their carries. It is a real powered IC made of gates: wire VCC to a positive rail and GND to ground, and the supply across them (V(VCC) − V(GND)) is the logic rail the outputs swing within. Inputs are thresholded at half that rail and draw essentially no current; the outputs are driven hard to VCC or GND, lagging the inputs by the internal gates' propagation delay.",
    derived: (e, rail) => [
      { label: "Logic rail", value: f(rail, "V") },
      { label: "Output drive", value: f(e.current, "A") },
      { label: "Switching threshold", value: f(rail / 2, "V") },
    ],
  },
  MUX2: {
    name: "2:1 Mux",
    equation: "Y = (A · ¬SEL) + (B · SEL)",
    headline: (e, rail) =>
      `Rail ${f(rail, "V")} · Y = SEL ? B : A · drive ${f(e.current, "A")}`,
    plain: () =>
      "A 2:1 multiplexer passes one of its two data inputs to the output, chosen by a select line: SEL low forwards A, SEL high forwards B. It is the elemental router — the building block of every larger mux, every data-path 'pick a source,' and, fed back on itself, the lookup-table cell of an FPGA. Cascade them in a tree for a 4:1 or 8:1; this is the leaf. Internally it is an inverter on SEL, two AND gates (A·¬SEL and B·SEL) gating each input, and an OR that merges them. It is a real powered IC made of gates: wire VCC to a positive rail and GND to ground, and the supply across them (V(VCC) − V(GND)) is the logic rail the output swings within. The inputs are thresholded at half that rail and draw essentially no current; the output is driven hard to VCC or GND, lagging the inputs by the internal gates' propagation delay.",
    derived: (e, rail) => [
      { label: "Logic rail", value: f(rail, "V") },
      { label: "Output drive", value: f(e.current, "A") },
      { label: "Switching threshold", value: f(rail / 2, "V") },
    ],
  },
  DMUX: {
    name: "1:2 Demux",
    equation: "Y0 = D · ¬SEL · Y1 = D · SEL",
    headline: (e, rail) =>
      `Rail ${f(rail, "V")} · D → Y0/Y1 by SEL · drive ${f(e.current, "A")}`,
    plain: () =>
      "A 1:2 demultiplexer is the mirror image of the 2:1 mux: it steers one data input to one of two outputs by the select line. Y0 = D·¬SEL asserts when SEL is low, Y1 = D·SEL when SEL is high, and the unselected output stays low. Tie D high and it becomes a 1-of-2 decoder — exactly one output asserts for each address value, the one-hot primitive every memory address line and chip-select grows from. Distribution is the dual of selection, and meeting them as a matched pair makes that duality concrete. Internally it is an inverter on SEL and two AND gates. It is a real powered IC made of gates: wire VCC to a positive rail and GND to ground, and the supply across them (V(VCC) − V(GND)) is the logic rail the outputs swing within. Inputs are thresholded at half that rail and draw essentially no current; the outputs are driven hard to VCC or GND, lagging the inputs by the internal gates' propagation delay.",
    derived: (e, rail) => [
      { label: "Logic rail", value: f(rail, "V") },
      { label: "Output drive", value: f(e.current, "A") },
      { label: "Switching threshold", value: f(rail / 2, "V") },
    ],
  },
  MAJ3: {
    name: "Majority Gate",
    equation: "Y = AB + BC + CA",
    headline: (e, rail) =>
      `Rail ${f(rail, "V")} · high when ≥2 inputs high · drive ${f(e.current, "A")}`,
    plain: () =>
      "A majority gate outputs whatever the majority of its three inputs say: high when two or three of them are high, low otherwise. It is the heart of fault-tolerant logic — triple-modular redundancy votes out a single failed channel through exactly this gate, three copies of a signal reduced to the value at least two agree on — and, not coincidentally, it is the carry-out function of a full adder (COUT = majority(A, B, CIN)), so it ties arithmetic and reliability together. The function is monotone (no input inversion) and a primitive of threshold and neuromorphic logic. Internally it is three AND gates (AB, BC, CA) merged by an OR. It is a real powered IC made of gates: wire VCC to a positive rail and GND to ground, and the supply across them (V(VCC) − V(GND)) is the logic rail the output swings within. Inputs are thresholded at half that rail and draw essentially no current; the output is driven hard to VCC or GND, lagging the inputs by the internal gates' propagation delay.",
    derived: (e, rail) => [
      { label: "Logic rail", value: f(rail, "V") },
      { label: "Output drive", value: f(e.current, "A") },
      { label: "Switching threshold", value: f(rail / 2, "V") },
    ],
  },
  SRL: {
    name: "SR Latch",
    equation: "Q = NOR(R, Q̄) · Q̄ = NOR(S, Q)",
    headline: (e, rail) =>
      `Rail ${f(rail, "V")} · set/reset memory · Q drive ${f(e.current, "A")}`,
    plain: () =>
      "An SR latch is the first thing a circuit ever remembered: one bit of memory made of feedback. A pulse on SET drives the output high and it STAYS high after SET releases; a pulse on RESET drives it low and it stays. Hold both low and it remembers its last value. That persistence comes from two cross-coupled NOR gates, each feeding the other's input, so the pair has two stable states it locks into — the bistable cell every flip-flop, register, and SRAM bit grows from. The one rule: do not assert SET and RESET together (both high forces both outputs low and the next state is undefined as they release) — the forbidden state the clocked flip-flops were invented to tame. A real powered IC: wire VCC/GND and the output swings that rail.",
    derived: (e, rail) => [
      { label: "Logic rail", value: f(rail, "V") },
      { label: "Q output drive", value: f(e.current, "A") },
      { label: "Switching threshold", value: f(rail / 2, "V") },
    ],
  },
  DLATCH: {
    name: "D-Latch",
    equation: "Q follows D while EN=1, holds when EN=0",
    headline: (e, rail) =>
      `Rail ${f(rail, "V")} · transparent when EN high · Q drive ${f(e.current, "A")}`,
    plain: () =>
      "A D-latch stores one bit, but unlike a flip-flop it is LEVEL-sensitive: while its enable EN is high the latch is transparent — Q simply follows D — and the instant EN goes low it freezes the last value of D and holds it. It is the missing middle term between the SR latch (feedback memory, but no clean data input) and the edge-triggered D flip-flop (which samples D only on a clock EDGE). Meeting the transparent latch beside the edge flip-flop is the cleanest way to learn level- vs. edge-triggered — the single most confused distinction in sequential logic, and the source of every latch-vs-flop timing bug. Internally it is a gated SR latch: two steering AND gates (D·EN, ¬D·EN) feeding the cross-coupled NOR pair, so EN low forces both terms low and the latch holds. A real powered IC: wire VCC/GND and the outputs swing that rail.",
    derived: (e, rail) => [
      { label: "Logic rail", value: f(rail, "V") },
      { label: "Q output drive", value: f(e.current, "A") },
      { label: "Switching threshold", value: f(rail / 2, "V") },
    ],
  },
  JKFF: {
    name: "JK Flip-Flop",
    equation: "Q⁺ = J·Q̄ + K̄·Q · (tie J=K ⇒ T)",
    headline: (e, rail) =>
      `Rail ${f(rail, "V")} · edge-triggered J/K · Q drive ${f(e.current, "A")}`,
    plain: () =>
      "The JK is the universal flip-flop: on each rising clock edge J and K decide the next state — hold (0 0), set (1 0), reset (0 1), or TOGGLE (1 1), the one flip-flop that does all four. The toggle is the prize: tie J and K together as a single T input and it flips on every clock while T is high, so Q comes out at half the clock frequency — the divide-by-2 cell every binary counter and frequency divider is built from. It is the SR latch with its forbidden state redeemed: where set = reset = 1 was illegal, here J = K = 1 is the most useful case. Internally it is a D flip-flop fed by steering logic that computes D = J·Q̄ + ¬K·Q from the flop's own outputs; the edge trigger makes the toggle race-free. Wire VCC/GND to power the steering and clock it on the rising edge.",
    derived: (e, rail) => [
      { label: "Logic rail", value: f(rail, "V") },
      { label: "Q output drive", value: f(e.current, "A") },
      { label: "Switching threshold", value: f(rail / 2, "V") },
    ],
  },
  TRI: {
    name: "Tri-State Buffer",
    equation: "Y = A when OE=1 · Hi-Z when OE=0",
    headline: (e, rail) =>
      `Rail ${f(rail, "V")} · ${Math.abs(e.current) > 1e-7 ? "enabled" : "Hi-Z / idle"} · drive ${f(e.current, "A")}`,
    plain: () =>
      "A tri-state buffer is a buffer with a third output state: high-impedance. When OE (output enable) is high it passes A to Y as a clean logic level; when OE is low it RELEASES Y entirely — neither high nor low, just disconnected (Hi-Z). That third state is the whole idea of a shared bus: many tri-state drivers on one wire, only one enabled at a time, the rest electrically absent. It is the part that makes a data bus, a wired backplane, and the output-enable pin on every memory and register possible. Two enabled drivers fighting on one net is a bus conflict (the sim resolves it to the unknown state X). Internally the enable gates the buffer's supply rail — OE low collapses it so the output goes dark (Hi-Z) — the honest dead-rail realization of the third state.",
    derived: (e, rail) => [
      { label: "Logic rail", value: f(rail, "V") },
      { label: "Output drive", value: f(e.current, "A") },
      {
        label: "State",
        value: Math.abs(e.current) > 1e-7 ? "driving" : "Hi-Z / idle",
      },
    ],
  },
  SAMP: {
    name: "Clocked Sampler",
    equation: "OUT ← (IN > Vth) on ↑CLK",
    headline: (e, vth) =>
      `Threshold ${f(vth, "V")} · clock-edge quantize · OUT drive ${f(e.current, "A")}`,
    plain: () =>
      "A clocked sampler is the atom of an analog-to-digital converter: on each rising edge of its clock it compares its analog input against a fixed threshold and latches a single bit — high if the input is above the threshold, low if below — holding that bit on its output until the next edge. Between edges it ignores the input entirely. That is the two halves of digitising a signal in their simplest form: SAMPLE (freeze a value on the clock edge) and QUANTIZE (decide which side of a level it fell on). Chain many of these at staggered thresholds and you have a flash ADC; feed one a ramp and a comparator and you have the heart of a successive-approximation converter. The input is sensed, not loaded (it draws essentially no current); the output is driven hard to the rail or ground one tick after the edge.",
    derived: (e, vth) => [
      { label: "Comparison threshold", value: f(vth, "V") },
      { label: "Output drive", value: f(e.current, "A") },
      { label: "Output bit", value: e.current >= 0 ? "follows IN>Vth" : "—" },
    ],
  },
  ASW: {
    name: "Analog Switch",
    equation: "A↔B when CTRL high · R_on",
    headline: (e, ron) =>
      `R_on ${f(ron, "Ω")} · ${Math.abs(e.vAcross) < 0.25 ? "closed" : "open"} · ${f(e.current, "A")} through`,
    plain: () =>
      "An analog switch (a transmission gate) is a digitally-controlled connection between two nodes: a logic level on its control pin decides whether the A and B terminals are joined by a low resistance (closed) or isolated (open). Unlike a logic gate it does not produce a level — it PASSES whatever analog signal is on the path, in either direction, so it works as happily on a slow sensor voltage as on a logic line. It is the building block of analog multiplexers (steer one of several inputs to a shared output), sample-and-hold front ends (briefly close to charge a hold capacitor, then open to freeze the value), and programmable signal routing. When closed it is not ideal: it has a small on-resistance R_on in series, which forms a divider with whatever it feeds and limits how fast it can charge a capacitive load. It closes when the control rises above half the supply rail and opens below it.",
    derived: (e, ron) => [
      { label: "On-resistance R_on", value: f(ron, "Ω") },
      {
        label: "State",
        value: Math.abs(e.vAcross) < 0.25 ? "closed (A↔B)" : "open",
      },
      { label: "Through current", value: f(e.current, "A") },
    ],
  },
  CMP: {
    name: "Comparator",
    equation: "OUT → rail when IN+ > IN− · hyst V_H",
    headline: (e, vh) =>
      `Hysteresis ${f(vh, "V")} · open-loop compare · OUT drive ${f(e.current, "A")}`,
    plain: () =>
      "A comparator is the bridge from the analog world to the digital one: it watches two analog inputs and slams its output to one rail or the other depending on which is larger — high when IN+ sits above IN−, low when below. Unlike an op-amp it runs open-loop ON PURPOSE; there is no linear region, just a hard decision, so it turns a smooth voltage into a clean logic level. That makes it the front end of every ADC, every zero-crossing detector, threshold alarm, and on/off controller. Real comparators add HYSTERESIS — a small dead-band V_H around the switching point — so a noisy input wobbling near the threshold does not make the output chatter: once it flips high it will not flip back until the input falls a little below the level, and vice versa. Set V_H to 0 for an ideal comparator, or widen it to reject more noise (the Schmitt-trigger trick). The output swings the GND..VCC rail like a powered gate; wire the inputs and power and feed it a slow ramp against a reference to watch it snap.",
    derived: (e, vh) => [
      { label: "Hysteresis V_H", value: f(vh, "V") },
      {
        label: "Mode",
        value: vh > 0 ? "Schmitt (noise-immune)" : "plain (ideal)",
      },
      { label: "Output drive", value: f(e.current, "A") },
    ],
  },
  LUT: {
    name: "FPGA Logic Cell",
    equation: "OUT = table[ IN0 | IN1·2 | IN2·4 | IN3·8 ]",
    headline: (e) => `OUT ${f(e.vAcross, "V")} · drive ${f(e.current, "A")}`,
    plain: () =>
      "A look-up table is the atom of an FPGA: not a fixed gate but a tiny 16-cell memory whose contents ARE the truth table of any function of four inputs. The four inputs form a 4-bit address (IN0 the least-significant bit) and the addressed cell drives the output — so the same silicon becomes AND, OR, XOR, a full-adder bit, a 3-input majority voter, anything, depending only on which 16 bits you store. This is what 'field-programmable' means: an FPGA ships as a sea of these cells plus a configurable interconnect, and a bitstream fills in every table. Pick a function from the presets or type any of the 65 536 patterns straight into the hex field. Turn on the output register and the cell latches its result on the rising clock edge — a LUT plus a flip-flop, the exact 'logic element' an FPGA tiles by the thousand.",
    derived: (e) => [
      { label: "Output", value: f(e.vAcross, "V") },
      { label: "Output drive", value: f(e.current, "A") },
    ],
  },
  SPIM: {
    name: "SPI Master",
    equation: "4-wire serial · SCLK / MOSI / MISO / CS",
    headline: (e) => `SCLK ${f(e.vAcross, "V")} · drive ${f(e.current, "A")}`,
    plain: () =>
      "SPI is the workhorse short-range serial bus: four wires, full-duplex, no addressing. The master owns the clock. Pulse its START input and it pulls CS low, then shifts the data word out on MOSI most-significant-bit first, one bit per SCLK edge, while simultaneously clocking the slave's reply in on MISO — out and in on the same clocks, which is what 'full-duplex' buys you. Set the word it sends in hex; the clock rate and bit count come from sensible defaults. Wire its SCLK/MOSI/CS to a SPI slave (and MISO back) to watch a whole transaction. The trade against a UART is that SPI needs that shared clock wire, but in return it has no agreed baud rate to get wrong and runs much faster.",
    derived: (e) => [
      { label: "SCLK line", value: f(e.vAcross, "V") },
      { label: "Output drive", value: f(e.current, "A") },
    ],
  },
  SPIS: {
    name: "SPI Slave",
    equation: "shifts on SCLK · reply MSB-first on MISO",
    headline: (e) => `MISO ${f(e.vAcross, "V")} · drive ${f(e.current, "A")}`,
    plain: () =>
      "The other end of the SPI bus: a slave has no clock of its own — it is driven entirely by the master's SCLK. While CS is held low it samples MOSI on each clock edge to receive the incoming word, and at the same time shifts its own reply word out on MISO, most-significant-bit first, so a read and a write happen in the same transaction. RXVALID goes high once a full frame has landed. Set the reply word it returns in hex. Real SPI peripherals (sensors, flash, displays) are exactly this: you select the chip, clock out a command, and clock the answer back in on the same edges.",
    derived: (e) => [
      { label: "MISO line", value: f(e.vAcross, "V") },
      { label: "Output drive", value: f(e.current, "A") },
    ],
  },
  UART: {
    name: "UART",
    equation: "async serial · START + data(LSB) + STOP",
    headline: (e) => `TX ${f(e.vAcross, "V")} · drive ${f(e.current, "A")}`,
    plain: () =>
      "A UART is the classic asynchronous serial port — just two wires, TX and RX, and no shared clock at all. Instead both ends agree on a baud rate beforehand and frame each byte: the idle-high line is pulled low for one START bit (the receiver's cue to start sampling), then the data bits are sent least-significant-bit first, then a STOP bit returns the line high. The receiver waits for the falling start edge and samples each bit in the middle of its window, so small clock differences don't matter. Pulse SEND to transmit the data word (set it in hex); RXVALID pulses when a byte arrives on RX. This is what's under a serial console, GPS modules, and the venerable RS-232 port — slower than SPI but needing no clock wire.",
    derived: (e) => [
      { label: "TX line", value: f(e.vAcross, "V") },
      { label: "Output drive", value: f(e.current, "A") },
    ],
  },
  ADC: {
    name: "Flash ADC",
    equation: "code = floor(8 · VIN / VREF), clamped 0..7",
    headline: (e) =>
      `flash quantize · D0 ${f(e.vAcross, "V")} · drive ${f(e.current, "A")}`,
    plain: () =>
      "A flash ADC is the fastest way to turn a voltage into a number: it compares the input against every threshold at once. A reference ladder divides VREF into seven evenly-spaced levels; a bank of seven comparators each asks 'is VIN above my level?' in parallel; and a priority encoder turns that thermometer of yes/no answers into a 3-bit binary code on D2..D0 — all in a single step, with no clock and no searching. That parallelism is both its speed and its cost: an N-bit flash needs (2 to the N) minus 1 comparators, so flash is used where speed matters most (video, fast digitizers), while successive-approximation trades speed for far fewer parts at higher resolution. This one digitizes VIN against VREF into 8 levels (LSB = VREF/8); pair it with a 3-bit DAC to watch a voltage convert to a code and reconstruct back.",
    derived: (e) => [
      { label: "D0 (LSB) output", value: f(e.vAcross, "V") },
      { label: "Output drive", value: f(e.current, "A") },
    ],
  },
  DAC: {
    name: "R-2R DAC",
    equation: "AOUT = (4 · D2 + 2 · D1 + D0) / 8 · Vhigh",
    headline: (e) =>
      `R-2R reconstruct · AOUT ${f(e.vAcross, "V")} · ladder ${f(e.current, "A")}`,
    plain: () =>
      "A digital-to-analog converter turns a binary code back into a voltage — the reconstruct half of the converter pair with the flash ADC. This is the most honest DAC there is: nothing but a resistor R-2R ladder, no op-amp, no switches, no reference pin. Each input bit is an ordinary logic level (0 or the supply high), and the ladder weights them by powers of two — the MSB D2 counts for 4, D1 for 2, the LSB D0 for 1 — then sums them, so the output settles to eight evenly-spaced steps from 0 to 7/8 of full scale, one LSB = full-scale/8. The trick is the repeated R-2R cell: at every node, looking toward the LSB end the resistance is 2R, so each step down the ladder halves a bit's contribution — binary weighting from one two-value building block. Drive D2..D0 from a counter to watch AOUT climb the reconstruction staircase; feed it back into a comparator and you have the heart of a successive-approximation ADC.",
    derived: (e) => [
      { label: "AOUT (code · LSB)", value: f(e.vAcross, "V") },
      { label: "Ladder current", value: f(e.current, "A") },
    ],
  },
  SAR: {
    name: "SAR ADC",
    equation: "code = floor(8 · VIN / VCC), found bit-by-bit over 3 clocks",
    headline: (e) =>
      `successive approx · D0 ${f(e.vAcross, "V")} · drive ${f(e.current, "A")}`,
    plain: () =>
      "A successive-approximation (SAR) ADC converts by binary search — the speed-versus-parts opposite of the flash ADC. Instead of a bank of comparators it has just one, wired in a loop with a small internal DAC and a 3-bit register: on each clock it tries the next bit, most-significant first. Set the bit, let the DAC produce that trial voltage (the first trial is half scale, then a quarter, then an eighth), and ask the one comparator 'is VIN still above it?' — keep the bit if yes, drop it if no. After 3 clocks the register has homed in on the answer and DONE goes high; the result is floor(8 · VIN / VCC), clamped 0..7 — exactly the code the flash ADC finds in a single step, but reached with one comparator instead of seven. That is the classic trade: flash is fastest but costs (2 to the N) minus 1 comparators, while SAR needs only N clocks and a handful of parts, which is why most general-purpose ADCs are SAR. Drive CLK from a clock and hold VIN steady during the conversion (a real SAR samples and holds it); VCC is the full-scale reference.",
    derived: (e) => [
      { label: "D0 (LSB) output", value: f(e.vAcross, "V") },
      { label: "Output drive", value: f(e.current, "A") },
    ],
  },
  LS: {
    name: "Level Shifter",
    equation: "OUT @ rail B = IN @ rail A",
    headline: (e, railA, railB) =>
      `In ${f(railA, "V")} → out ${f(railB ?? 5, "V")} · ${f(e.current, "A")}`,
    plain: () =>
      "A level shifter (level translator) bridges two logic-voltage domains: it reads its input against the INPUT rail's threshold and re-drives its output cleanly at the OUTPUT rail. That is what lets a 1.8 V sensor talk to a 5 V microcontroller and back — a low-rail high that would be marginal or lost at the higher rail is restored to a full high, and a high-rail signal is brought down without over-driving the low-rail part. Set the input rail (A) and the output rail (B); it does no logic, just translation, with one tick of delay.",
    derived: (e, railA, railB) => [
      { label: "Input rail (A)", value: f(railA, "V") },
      { label: "Output rail (B)", value: f(railB ?? 5, "V") },
      { label: "Output drive", value: f(e.current, "A") },
    ],
  },
  PU: {
    name: "Pull-up",
    equation: "I = (Vcc − V) / R",
    headline: (e, vcc) => `Pull-up to ${f(vcc, "V")} · ${f(e.current, "A")}`,
    plain: () =>
      "A pull-up resistor ties a net to Vcc through a (here 4.7 kΩ) resistance. On its own it holds the net high; its real job is to partner an open-drain / open-collector output, which can only pull LOW or release (high-Z) — the pull-up provides the HIGH. Put several open-drain outputs and one pull-up on a net and you get a wired-AND bus: any driver pulling low takes the whole net low (its stiff ~1 Ω beats the pull-up), and the net floats high only when every driver releases. That is how I²C, 1-Wire, and shared interrupt lines work.",
    derived: (e, vcc) => [
      { label: "Pulls to (Vcc)", value: f(vcc, "V") },
      { label: "Resistance", value: "4.7 kΩ" },
      { label: "Source current", value: f(e.current, "A") },
    ],
  },
  LOAD: {
    name: "Electronic Load",
    equation: "I = V / R  (CC: I set · CR: I = V/R)",
    headline: (e) =>
      `${f(e.current, "A")} sunk · ${f(e.vAcross, "V")} across · ${f(e.vAcross * e.current, "W")}`,
    plain: () =>
      "A programmable electronic load is a controlled current/resistance sink — the bench instrument you wire across a supply to test it under load. In constant-current (CC) mode it draws a set current no matter the terminal voltage, so a supply sees a steady demand it must hold against; in constant-resistance (CR) mode it behaves like a fixed resistor, drawing I = V/R as the voltage moves. Its dynamic mode steps the current between a base and a peak level at a chosen rate — a square load-step that probes how a supply answers a sudden excursion: the rail sag, the recovery overshoot, the ringing. It dissipates everything it draws (V·I) as heat, which is the whole point — it stands in for a real load while you watch the source behave.",
    derived: (e) => [
      { label: "Current sunk", value: f(e.current, "A") },
      { label: "Voltage across", value: f(e.vAcross, "V") },
      { label: "Power dissipated V·I", value: f(e.vAcross * e.current, "W") },
    ],
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

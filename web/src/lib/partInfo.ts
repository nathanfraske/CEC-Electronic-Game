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

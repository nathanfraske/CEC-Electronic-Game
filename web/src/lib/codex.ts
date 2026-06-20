// SPDX-License-Identifier: Apache-2.0
// The Component Codex: the pure data/logic layer behind the browsable per-component
// reference (the "discovery museum"). It AGGREGATES every per-component datum already
// modelled elsewhere — quality tiers (tiers.ts), device variants/ratings (diodes.ts),
// standard value ranges (values.ts), logic-family levels (families.ts), the governing
// law + telemetry (partInfo.ts), the pinout (pinout.ts), and the catalog template
// (graph.ts) — and turns each into a display-ready summary string. No aesthetics here
// (the App.svelte overlay owns the look); no sim, no netlist, no wasm crossing — this is
// a presentation-free read of the existing model, so it stays unit-testable and cheap.
//
// The catalog metadata (categories, the learning-tier/desc per kind, the function
// synonyms) mirrors the small, stable maps in App.svelte. They are duplicated here on
// purpose — the originals live inside the App component's <script> (not exported), and
// these are tiny and change rarely — so the Codex is self-contained.

import { PART_KINDS, formatValue } from "./graph";
import {
  TIER_LABELS,
  hasTiers,
  tierParams,
  ecEsr,
  resistorTolerance,
} from "./tiers";
import {
  hasDiodeTypes,
  hasLedColors,
  variantList,
  type DiodeType,
} from "./diodes";
import { hasValue, isESeries, standardValues } from "./values";
import { familyLevels, LOGIC_FAMILIES } from "./families";

// ---------------------------------------------------------------------------
// Catalog metadata (mirrors App.svelte — see the file header).
// ---------------------------------------------------------------------------

/** The bin folders, in display order. Mirrors `PART_CATEGORIES` in App.svelte. */
export const PART_CATEGORIES = [
  "Sources",
  "Passives",
  "Diodes",
  "Protection",
  "Active & Switching",
  "Logic & ICs",
] as const;

/** tag → owning category. Mirrors `PART_CAT_OF` in App.svelte. */
export const PART_CAT_OF: Record<string, string> = {
  V: "Sources",
  AC: "Sources",
  PULSE: "Sources",
  I: "Sources",
  GND: "Sources",
  R: "Passives",
  SHUNT: "Passives",
  C: "Passives",
  EC: "Passives",
  L: "Passives",
  TR: "Passives",
  POT: "Passives",
  NTC: "Passives",
  PTC: "Passives",
  D: "Diodes",
  SD: "Diodes",
  LED: "Diodes",
  ZD: "Diodes",
  MOV: "Protection",
  SW: "Active & Switching",
  MSW: "Active & Switching",
  LOAD: "Active & Switching",
  NM: "Active & Switching",
  PM: "Active & Switching",
  Q: "Active & Switching",
  QP: "Active & Switching",
  OA: "Active & Switching",
  ASW: "Active & Switching",
  CMP: "Active & Switching",
  AND: "Logic & ICs",
  OR: "Logic & ICs",
  NAND: "Logic & ICs",
  NOR: "Logic & ICs",
  XOR: "Logic & ICs",
  XNOR: "Logic & ICs",
  IMPLY: "Logic & ICs",
  NIMPLY: "Logic & ICs",
  NOT: "Logic & ICs",
  BUF: "Logic & ICs",
  FF: "Logic & ICs",
  HADD: "Logic & ICs",
  FADD: "Logic & ICs",
  MUX2: "Logic & ICs",
  DMUX: "Logic & ICs",
  MAJ3: "Logic & ICs",
  SAMP: "Logic & ICs",
  LS: "Logic & ICs",
  PU: "Logic & ICs",
  FP: "Logic & ICs",
  uC: "Logic & ICs",
};

/** Per-kind one-line description + learning tier (I/II/III). Mirrors `PARTS` in
 *  App.svelte (the catalog the bin renders). The names + units + pins come from
 *  {@link PART_KINDS}, so only the prose `desc` and the learn `tier` live here. */
export const PART_META: Record<string, { desc: string; learnTier: string }> = {
  V: { desc: "Ideal fixed DC rail", learnTier: "I" },
  AC: { desc: "Sine source · set Hz", learnTier: "I" },
  PULSE: { desc: "Square/triangle · Hz + duty", learnTier: "I" },
  R: { desc: "Ideal ohms, no tolerance", learnTier: "I" },
  SHUNT: { desc: "Milliohm sense · reads I from V", learnTier: "II" },
  C: { desc: "RC charge curves", learnTier: "I" },
  EC: { desc: "Bulk storage + ESR", learnTier: "II" },
  L: { desc: "Stored current, saturation", learnTier: "I" },
  TR: { desc: "Couples AC · set turns ratio", learnTier: "II" },
  POT: { desc: "Variable divider · slide the wiper", learnTier: "II" },
  NTC: { desc: "R falls as it heats", learnTier: "II" },
  PTC: { desc: "Snaps high past its Curie point", learnTier: "II" },
  I: { desc: "Ideal fixed DC current", learnTier: "I" },
  LOAD: { desc: "CC / CR sink + load-step", learnTier: "II" },
  GND: { desc: "0 V reference (node 0)", learnTier: "I" },
  D: { desc: "One-way conduction", learnTier: "II" },
  SD: { desc: "Low ~0.3 V drop", learnTier: "II" },
  LED: { desc: "Lights with current", learnTier: "II" },
  ZD: { desc: "Clamps at Vz (reverse)", learnTier: "II" },
  MOV: { desc: "Clamps spikes at ±Vc", learnTier: "II" },
  SW: { desc: "Clock-driven (PWM)", learnTier: "II" },
  MSW: { desc: "Click to open / close", learnTier: "II" },
  NM: { desc: "Gate controls Id", learnTier: "II" },
  PM: { desc: "High-side switch", learnTier: "II" },
  Q: { desc: "Ib controls Ic (β≈100)", learnTier: "II" },
  QP: { desc: "High-side current gain", learnTier: "II" },
  OA: { desc: "Huge gain · feedback or compare", learnTier: "II" },
  ASW: { desc: "Node-gated · passes analog A↔B", learnTier: "II" },
  CMP: { desc: "Open-loop · IN+ vs IN− → rail", learnTier: "II" },
  AND: { desc: "High iff both inputs high", learnTier: "II" },
  OR: { desc: "High iff either input high", learnTier: "II" },
  NAND: { desc: "AND inverted · universal", learnTier: "II" },
  NOR: { desc: "OR inverted · universal", learnTier: "II" },
  XOR: { desc: "High iff inputs differ", learnTier: "II" },
  XNOR: { desc: "High iff inputs match", learnTier: "II" },
  IMPLY: { desc: "A → B (¬A ∨ B)", learnTier: "II" },
  NIMPLY: { desc: "A ↛ B (A ∧ ¬B)", learnTier: "II" },
  NOT: { desc: "Inverter · flips the input", learnTier: "II" },
  BUF: { desc: "Non-inverting line driver", learnTier: "II" },
  FF: { desc: "Latches D on the clock edge", learnTier: "II" },
  HADD: { desc: "Adds two bits → sum + carry", learnTier: "III" },
  FADD: { desc: "Adds A+B+carry-in → the ALU cell", learnTier: "III" },
  MUX2: { desc: "Picks A or B by select", learnTier: "III" },
  DMUX: { desc: "Routes D to Y0/Y1 · 1-of-2 decode", learnTier: "III" },
  MAJ3: { desc: "High when ≥2 of 3 inputs high", learnTier: "III" },
  SAMP: { desc: "Quantizes 1 bit on the clock edge", learnTier: "II" },
  LS: { desc: "Translates rail A → rail B", learnTier: "II" },
  PU: { desc: "Resistor to Vcc · open-drain bus", learnTier: "II" },
  FP: { desc: "Spatial, parallel logic", learnTier: "III" },
  uC: { desc: "Runs real firmware", learnTier: "III" },
};

/** tag → "also known as / used for" search synonyms. Mirrors `PART_SYNONYMS`
 *  in App.svelte; the Codex shows these as the part's aliases / common uses. */
export const PART_SYNONYMS: Record<string, string[]> = {
  V: ["supply", "rail", "battery", "power"],
  AC: ["sine", "oscillator", "mains", "wave"],
  PULSE: ["clock", "oscillator", "square", "timer", "pwm"],
  R: ["resistor", "pull-up", "pull-down", "divider"],
  SHUNT: ["current sense", "ammeter", "measure current"],
  C: ["decoupling", "bypass", "filter", "smoothing"],
  EC: ["decoupling", "bypass", "bulk", "smoothing", "reservoir"],
  L: ["choke", "coil", "filter", "energy storage"],
  TR: ["isolation", "step-up", "step-down", "couple"],
  POT: ["volume", "trimmer", "divider", "variable resistor"],
  NTC: ["temperature", "sensor", "inrush"],
  PTC: ["resettable fuse", "temperature", "overcurrent"],
  I: ["bias", "constant current", "source"],
  LOAD: ["sink", "dummy load", "tester", "burn-in"],
  GND: ["reference", "common", "earth", "0 v"],
  D: ["rectifier", "clamp", "one-way", "check valve", "protection"],
  SD: ["rectifier", "low drop", "fast", "freewheel"],
  LED: ["indicator", "light", "lamp", "status"],
  ZD: ["regulator", "reference", "clamp", "overvoltage"],
  MOV: ["surge", "spike", "transient", "protection", "clamp"],
  SW: ["chopper", "switch", "pwm"],
  MSW: ["toggle", "button", "switch"],
  NM: ["switch", "amplifier", "low-side"],
  PM: ["switch", "high-side", "load switch"],
  Q: ["switch", "amplifier", "current gain"],
  QP: ["switch", "high-side", "current gain"],
  OA: ["amplifier", "comparator", "buffer", "gain"],
  ASW: ["analog switch", "transmission gate", "mux", "sample and hold"],
  CMP: ["comparator", "schmitt", "threshold", "zero crossing", "adc"],
  AND: ["gate", "all"],
  OR: ["gate", "any"],
  NAND: ["universal", "gate"],
  NOR: ["universal", "gate"],
  XOR: ["gate", "difference", "parity"],
  XNOR: ["gate", "equality", "parity"],
  IMPLY: ["gate", "implication"],
  NIMPLY: ["gate", "inhibit"],
  NOT: ["inverter", "gate"],
  BUF: ["buffer", "line driver", "gate"],
  FF: ["latch", "register", "memory", "flip-flop"],
  HADD: ["adder", "half adder", "sum", "carry", "arithmetic"],
  FADD: ["adder", "full adder", "sum", "carry", "alu", "arithmetic"],
  MUX2: ["mux", "multiplexer", "select", "data selector"],
  DMUX: ["demux", "demultiplexer", "decoder", "one-hot", "address"],
  MAJ3: ["majority", "voter", "tmr", "redundancy", "carry"],
  SAMP: ["sampler", "adc", "sample and hold", "quantizer"],
  LS: ["translator", "level", "interface"],
  PU: ["regulator", "reference", "pull-up", "open-drain"],
  FP: ["fpga", "fabric", "parallel logic"],
  uC: ["mcu", "processor", "firmware", "computer"],
};

// ---------------------------------------------------------------------------
// Logic identity (mirrors App.svelte's digital-part / gate-function maps).
// ---------------------------------------------------------------------------

/** The kinds the simulator treats as digital (gates + the D flip-flop). A digital
 *  part shows the per-family logic-level table. */
const DIGITAL_KINDS = new Set([
  "AND",
  "OR",
  "NAND",
  "NOR",
  "XOR",
  "XNOR",
  "IMPLY",
  "NIMPLY",
  "NOT",
  "BUF",
  "FF",
]);

/** Whether a kind is a digital logic part (so the Codex shows logic levels). */
export function isDigital(kind: string): boolean {
  return DIGITAL_KINDS.has(kind);
}

// ---------------------------------------------------------------------------
// Refsheet linking.
// ---------------------------------------------------------------------------

/**
 * tag → the five-tier / teardown refsheet HTML file in `docs/ui/parts/` (served at
 * `/parts/*` by the vite plugin in web/vite.config.ts). A kind absent here has no
 * refsheet, so the detail pane shows no teardown link. Several kinds share a sheet
 * (a Schottky reuses the diode factory; a PNP reuses the BJT teardown).
 */
export const REFSHEET_OF: Record<string, string> = {
  NOT: "inv-ic.html",
  NAND: "nand-ic.html",
  NOR: "nor-ic.html",
  OR: "or-ic.html",
  XOR: "xor-ic.html",
  XNOR: "xnor-ic.html",
  IMPLY: "imply-ic.html",
  NIMPLY: "nimply-ic.html",
  AND: "and-ic.html",
  R: "resistor-tiers.html",
  C: "capacitor-ceramic-tiers.html",
  EC: "capacitor-electrolytic-tiers.html",
  L: "inductor-tiers.html",
  TR: "transformer-tiers.html",
  D: "diode-factory.html",
  SD: "diode-factory.html",
  ZD: "zener-tier2.html",
  MOV: "varistor-tiers.html",
  Q: "transistor-tiers.html",
  QP: "transistor-tiers.html",
  NM: "mosfet-tiers.html",
  PM: "mosfet-pmos-tiers.html",
  OA: "opamp-tiers.html",
};

// ---------------------------------------------------------------------------
// Category grouping.
// ---------------------------------------------------------------------------

export interface CodexCategory {
  category: string;
  kinds: string[];
}

/**
 * Every kind in {@link PART_KINDS}, grouped into its category and returned in the
 * `PART_CATEGORIES` display order. Within a category the kinds keep the bin's order
 * (the order they appear in `PART_META`). Categories with no members are dropped.
 */
export function codexCategories(): CodexCategory[] {
  const order = Object.keys(PART_META); // the catalog/bin order
  const byCat: Record<string, string[]> = {};
  for (const kind of order) {
    if (!(kind in PART_KINDS)) continue;
    const cat = PART_CAT_OF[kind] ?? "Logic & ICs";
    (byCat[cat] ??= []).push(kind);
  }
  const out: CodexCategory[] = [];
  for (const category of PART_CATEGORIES) {
    const kinds = byCat[category];
    if (kinds && kinds.length > 0) out.push({ category, kinds });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-kind tier param slot map (mirrors the slot comments in tiers.ts /
// crates/sim-core/src/lib.rs). Each entry turns a tier's param block into a
// human description. EC and R are web-expansion kinds (no param block) and are
// special-cased in `tierRows`.
// ---------------------------------------------------------------------------

interface TierSlotSpec {
  /** Param-block slot index. */
  slot: number;
  /** Row label, e.g. "GBW" or "ESR". */
  label: string;
  /** SI unit for `formatValue` (e.g. "Hz", "Ω", "F", "A/V²"). */
  unit: string;
}

// Per-kind, which param slots a tier varies — and how to label/format each.
const TIER_SLOTS: Record<string, TierSlotSpec[]> = {
  OA: [{ slot: 0, label: "Gain-bandwidth", unit: "Hz" }],
  C: [
    { slot: 0, label: "ESR", unit: "Ω" },
    { slot: 1, label: "ESL", unit: "H" },
  ],
  L: [
    { slot: 0, label: "DCR", unit: "Ω" },
    { slot: 1, label: "Winding C", unit: "F" },
  ],
  NM: [{ slot: 0, label: "Kp", unit: "A/V²" }],
  PM: [{ slot: 0, label: "Kp", unit: "A/V²" }],
  Q: [{ slot: 0, label: "β", unit: "" }],
  QP: [{ slot: 0, label: "β", unit: "" }],
  V: [{ slot: 0, label: "Output impedance", unit: "Ω" }],
  AC: [{ slot: 0, label: "Output impedance", unit: "Ω" }],
};

/** Format a unitless value (used for β, which has no SI unit) compactly. */
function fmtPlain(v: number): string {
  if (v === 0) return "0";
  return Number.isInteger(v)
    ? v.toString()
    : v.toFixed(2).replace(/\.?0+$/, "");
}

/** Format one tier-slot value with its unit (β is unitless → bare number). */
function fmtSlot(spec: TierSlotSpec, v: number): string {
  return spec.unit ? formatValue(v, spec.unit) : fmtPlain(v);
}

export interface TierRow {
  /** The grade label ("Budget" … "Lab-grade"). */
  tier: string;
  /** The concrete change at this grade, display-ready (e.g. "ESR 0.3 Ω · ESL 3 nF"). */
  change: string;
}

/**
 * The per-tier change table for a kind, or `[]` when the kind has no quality tiers.
 * Each row is one of the four {@link TIER_LABELS} grades with its concrete non-ideality
 * spelled out. Built from {@link tierParams} (param-block kinds) or the web-expansion
 * helpers ({@link ecEsr} for the electrolytic, {@link resistorTolerance} for the resistor).
 */
export function tierRows(kind: string): TierRow[] {
  if (!hasTiers(kind)) return [];

  // Resistor: tier = tolerance band (a ± fraction → percent).
  if (kind === "R") {
    return TIER_LABELS.map((tier, t) => ({
      tier,
      change: `Tolerance ±${fmtPlain(resistorTolerance(t) * 100)}%`,
    }));
  }
  // Electrolytic cap: tier = the parasitic series resistance (ESR), set web-side.
  if (kind === "EC") {
    return TIER_LABELS.map((tier, t) => ({
      tier,
      change: `ESR ${formatValue(ecEsr(t), "Ω")}`,
    }));
  }
  // Param-block kinds: read the tier's param block and describe its varied slots.
  const specs = TIER_SLOTS[kind];
  if (!specs) return [];
  return TIER_LABELS.map((tier, t) => {
    const params = tierParams(kind, t);
    const parts = specs.map((spec) => {
      const v = params?.[spec.slot] ?? 0;
      return `${spec.label} ${fmtSlot(spec, v)}`;
    });
    return { tier, change: parts.join(" · ") };
  });
}

// ---------------------------------------------------------------------------
// Variants / ratings (diode family, LED colour).
// ---------------------------------------------------------------------------

export interface VariantRow {
  /** The variant label ("Rectifier" / "Red" / …). */
  label: string;
  /** The variant's concrete params, display-ready (Is, n, rating, recovery / Vf). */
  detail: string;
}

/** A rough forward voltage (V) for an LED colour from its saturation current Is, by
 *  inverting the Shockley knee at a ~20 mA operating point with n = 2 (the LED kind).
 *  Vt ≈ 25.85 mV at room temperature. Presentation only — mirrors the diodes.ts comments. */
function ledVf(t: DiodeType): number {
  const VT = 0.02585;
  // I = Is·exp(Vf/(n·Vt))  ⇒  Vf = n·Vt·ln(I/Is), at I ≈ 20 mA.
  return t.n * VT * Math.log(0.02 / t.is);
}

/** Name a diode's reverse-recovery speed from its transit time TT (s). `0` = none
 *  (Schottky-like); larger TT = a slower, softer recovery. Mirrors the ordering note
 *  in diodes.ts (switching < fast-recovery < rectifier < power). */
function recoveryClass(tt: number): string {
  if (tt <= 0) return "no reverse recovery";
  if (tt < 0.8e-6) return `fast recovery (TT ${formatValue(tt, "s")})`;
  if (tt < 2e-6) return `medium recovery (TT ${formatValue(tt, "s")})`;
  return `slow recovery (TT ${formatValue(tt, "s")})`;
}

/**
 * The variant/rating table for a kind, or `[]` when the kind has no variants. For a
 * diode each row is a family flavour (Is, n, rated current, reverse-recovery class);
 * for an LED each row is a colour (≈Vf and its rated current). Built from
 * {@link variantList}.
 */
export function variantRows(kind: string): VariantRow[] {
  if (!hasDiodeTypes(kind) && !hasLedColors(kind)) return [];
  const list = variantList(kind);
  if (!list) return [];

  if (hasLedColors(kind)) {
    return list.map((t) => ({
      label: t.label,
      detail: `≈${formatValue(ledVf(t), "V")} forward · rated ${formatValue(
        t.ratedA,
        "A",
      )} · Is ${formatValue(t.is, "A")}`,
    }));
  }
  // Diode families: forward junction + rating + reverse recovery.
  return list.map((t) => ({
    label: t.label,
    detail: `Is ${formatValue(t.is, "A")} · n ${fmtPlain(
      t.n,
    )} · rated ${formatValue(t.ratedA, "A")} · ${recoveryClass(t.tt)}`,
  }));
}

// ---------------------------------------------------------------------------
// Logic-family levels (digital parts).
// ---------------------------------------------------------------------------

export interface FamilyRow {
  /** The family name ("Ideal" / "CMOS" / "TTL"). */
  family: string;
  /** The absolute thresholds, output levels, and noise margins at the rail. */
  detail: string;
}

/**
 * The per-family logic-level table for a digital kind at the given rail, or `[]` when
 * the kind isn't digital. Each row gives a family's input thresholds (Vil/Vih), output
 * levels (Vol/Voh) and the worst-case noise margins, computed via {@link familyLevels}.
 */
export function familyRows(kind: string, rail: number): FamilyRow[] {
  if (!isDigital(kind)) return [];
  return LOGIC_FAMILIES.map((_f, idx) => {
    const lv = familyLevels(idx, rail);
    const band = lv.hasBand
      ? `Vil ${formatValue(lv.vIl, "V")} / Vih ${formatValue(lv.vIh, "V")}`
      : `threshold ${formatValue(lv.vIh, "V")}`;
    const out = `out ${formatValue(lv.vOl, "V")}…${formatValue(lv.vOh, "V")}`;
    const nm = `noise margin ${formatValue(
      Math.min(lv.nmHigh, lv.nmLow),
      "V",
    )}`;
    return { family: lv.name, detail: `${band} · ${out} · ${nm}` };
  });
}

// ---------------------------------------------------------------------------
// Value range (E-series / curated sweeps).
// ---------------------------------------------------------------------------

/**
 * A one-line summary of a kind's standard value range — its min..max, the count of
 * standard values, and whether it snaps to an E-series (E24 for resistors, E6 for caps/
 * inductors) — or `null` when the kind has no adjustable numeric value. The unit comes
 * from {@link PART_KINDS}. Built from {@link standardValues}.
 */
export function valueSummary(kind: string): string | null {
  if (!hasValue(kind)) return null;
  const unit = PART_KINDS[kind]?.unit ?? "";
  const list = standardValues(kind);
  // MSW has a value (Open/Closed) but no numeric sweep — describe it plainly.
  if (list.length === 0) {
    if (kind === "MSW") return "Two states: Open (0) / Closed (1)";
    return null;
  }
  const min = list[0]!;
  const max = list[list.length - 1]!;
  const range = `${formatValue(min, unit)} … ${formatValue(max, unit)}`;
  const series = isESeries(kind)
    ? unit === "Ω"
      ? " · E24 series (±5%)"
      : " · E6 series (±20%)"
    : "";
  return `${range} · ${list.length} standard values${series}`;
}

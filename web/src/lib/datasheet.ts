// SPDX-License-Identifier: Apache-2.0
//
// Datasheet model (#70) — the "publish a datasheet" framing of the sand→CPU curriculum. Assembles a
// part's PINOUT (real pin names + directions) + a logic FUNCTION table from a user IC / sub-assembly def
// and (optionally) its characterization, so any built part can present a one-page datasheet beside the
// live Behavior panel. Pure data — no Svelte, no Pixi, no sim, nothing hashed: the panel just renders
// what this returns, and the model is unit-tested headlessly. Distinct from Behavior (which SHOWS/applies
// the runtime fast model); this is the static reference card.

import type { PinRole } from "./graph";
import { roleFromName, type UserIc } from "./userIc";

/** A pin's display direction on the datasheet — derived from its semantic {@link PinRole}. */
export type PinDir = "IN" | "OUT" | "I/O" | "CLK" | "PWR" | "GND" | "—";

export interface DatasheetPin {
  /** 1-based pin number (the authored pin order). */
  number: number;
  /** the author's name for the lead, or `pin N` when unnamed. */
  name: string;
  /** the resolved semantic role (from the def's roles, else the name), or null when unknown. */
  role: PinRole | null;
  /** the display direction shown in the pinout table. */
  dir: PinDir;
}

export interface DatasheetTable {
  /** input column names, in the rows' bit order (LSB first). */
  inputs: string[];
  /** output column name(s) — one today (the cell's single observed output). */
  outputs: string[];
  /** true ⇒ the table is the next-state Q⁺ latched on a clock (a register/flop), not combinational. */
  registered: boolean;
  /** the recognised function ("NAND", "D-TYPE"), or null. */
  gate: string | null;
  /** one row per input combination: the input bits + the settled output(s) (`null` ⇒ never settles). */
  rows: { in: number[]; out: (number | null)[] }[];
}

export interface DatasheetModel {
  name: string;
  tag: string;
  /** e.g. "DIP-8", "BLOCK-5", "free-form (5-pin)". */
  packageLabel: string;
  /** "IC" or "Subassembly". */
  kindLabel: string;
  pinCount: number;
  pins: DatasheetPin[];
  /** a one-line "what it is" summary. */
  summary: string;
  /** the logic function table, or null for a part with no characterised behaviour (passive / analog). */
  table: DatasheetTable | null;
}

/** The characterization slice the datasheet needs (reshaped from the Behavior panel / `characterizeCell`
 *  + `traceSequentialCell`), or null when the part has no readable logic function. */
export interface DatasheetChar {
  inNames: string[];
  outName: string;
  gate: string | null;
  registered: boolean;
  rows: { in: number[]; out: number | null }[];
}

/** Map a semantic role to its datasheet direction badge. */
function dirOf(role: PinRole | null): PinDir {
  switch (role) {
    case "in":
      return "IN";
    case "out":
      return "OUT";
    case "inout":
      return "I/O";
    case "clk":
      return "CLK";
    case "vcc":
      return "PWR";
    case "gnd":
      return "GND";
    default:
      return "—";
  }
}

/** A readable package label: free-form boxes read "free-form (N-pin)", packaged parts "ARCHETYPE-N". */
function packageLabel(ic: UserIc): string {
  const n = ic.package.pinCount;
  if (ic.freeForm) return `free-form (${n}-pin)`;
  const arch = (ic.package.archetype || "PKG").toUpperCase();
  return `${arch}-${n}`;
}

/** A one-line "what it is": the recognised function + clocked/combinational, or the bare pin/package shape. */
function summarize(
  ic: UserIc,
  kindLabel: string,
  table: DatasheetTable | null,
): string {
  if (table) {
    const fn =
      table.gate ??
      (table.registered ? "Sequential logic" : "Combinational logic");
    const nIn = table.inputs.length;
    const clocked = table.registered ? ", clocked" : "";
    return `${fn} — ${nIn}-input${clocked}`;
  }
  return `${ic.package.pinCount}-pin ${kindLabel.toLowerCase()}`;
}

/**
 * Build a part's datasheet model from its def + (optional) characterization. Resolves each pin's name +
 * direction (the def's explicit {@link UserIc.pinRoles} first, else inferred from the pin name), formats
 * the package, folds the characterization into a function table, and writes a one-line summary. Pure —
 * the panel renders the result; nothing here touches the sim or is hashed.
 */
export function buildDatasheet(
  ic: UserIc,
  char: DatasheetChar | null,
): DatasheetModel {
  const kindLabel = ic.role === "subassembly" ? "Subassembly" : "IC";
  const n = ic.package.pinCount;
  const pins: DatasheetPin[] = [];
  for (let i = 0; i < n; i++) {
    const named = ic.pinNames?.[i]?.trim();
    const role: PinRole | null =
      ic.pinRoles?.[i] ?? roleFromName((named ?? "").toUpperCase()) ?? null;
    pins.push({
      number: i + 1,
      name: named || `pin ${i + 1}`,
      role,
      dir: dirOf(role),
    });
  }
  const table: DatasheetTable | null = char
    ? {
        inputs: char.inNames,
        outputs: [char.outName],
        registered: char.registered,
        gate: char.gate,
        rows: char.rows.map((r) => ({ in: r.in, out: [r.out] })),
      }
    : null;
  return {
    name: ic.name || ic.tag,
    tag: ic.tag,
    packageLabel: packageLabel(ic),
    kindLabel,
    pinCount: n,
    pins,
    summary: summarize(ic, kindLabel, table),
    table,
  };
}

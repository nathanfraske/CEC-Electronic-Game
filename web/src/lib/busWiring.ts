// SPDX-License-Identifier: Apache-2.0
// busWiring.ts — "draw one → wire the whole bus" (the wiring tedium-killer). A BUS is a name-indexed pin
// group on ONE component: pins whose labels share a base name and end in a number — A0/A1/A2/A3, R0..R3,
// SUM0..SUM3, Q0..Q3. When the player draws a single strand between two pins that each belong to a bus
// (e.g. A0 → adder.A0), `planBusAutocomplete` returns the SIBLING pairs to wire too (A1→A1, A2→A2, …),
// so the board can lay the rest of the ribbon in one gesture / one undo.
//
// Design choices (owner): detect buses BY PIN-NAME INDEX; "draw one → auto-complete"; the strands stay
// INDIVIDUAL real wires (no bus abstraction) so they physically FAN OUT (the existing parallel-nudge
// router spaces them) and the netlist / KCL / signal-tracing are unchanged. This module is PURE (it reads
// the graph + PART_KINDS, mutates nothing) so it is headless-testable and golden-irrelevant; the caller
// (board.ts) creates the wires via `graph.connect` inside one undo.
import { PART_KINDS, isPinRef, type BoardGraph, type PinRef } from "./graph";

/** A pin label split into its bus BASE name + numeric INDEX, or null if it has no trailing number. The
 *  index is the trailing run of digits; the base is everything before it (trimmed). "A0"→{A,0};
 *  "SUM3"→{SUM,3}; "Q12"→{Q,12}; "CLK"→null; ""→null. */
export function parseBusLabel(
  label: string | undefined,
): { base: string; index: number } | null {
  const m = /^(.*?)(\d+)$/.exec((label ?? "").trim());
  if (!m) return null;
  const base = m[1].trim();
  if (!base) return null; // a bare number ("3") is not a bus member — needs a name
  return { base, index: Number(m[2]) };
}

/** The displayed label of a pin (the player's pin name on a sealed IC, else the package pin label). */
export function pinLabel(graph: BoardGraph, pin: PinRef): string | undefined {
  const c = graph.components.get(pin.componentId);
  if (!c) return undefined;
  return PART_KINDS[c.kind]?.pins[pin.pinIndex]?.label;
}

/** Whether a pin already has a wire on it (so auto-complete never clobbers existing connections). */
function pinIsWired(graph: BoardGraph, pin: PinRef): boolean {
  for (const w of graph.wires.values()) {
    if (
      isPinRef(w.from) &&
      w.from.componentId === pin.componentId &&
      w.from.pinIndex === pin.pinIndex
    )
      return true;
    if (
      isPinRef(w.to) &&
      w.to.componentId === pin.componentId &&
      w.to.pinIndex === pin.pinIndex
    )
      return true;
  }
  return false;
}

/** One pin of a bus: its pin index on the component + its numeric bus position. */
export interface BusMember {
  pinIndex: number;
  index: number;
}

/** The bus a pin belongs to: every pin on the SAME component sharing the pin's base name + a numeric
 *  index, ordered by index. Returns null if the pin has no indexed name or is the bus's only member (a
 *  lone `X0` isn't a bus). */
export function busOfPin(
  graph: BoardGraph,
  pin: PinRef,
): { base: string; members: BusMember[] } | null {
  const parsed = parseBusLabel(pinLabel(graph, pin));
  if (!parsed) return null;
  const c = graph.components.get(pin.componentId);
  const pins = c && PART_KINDS[c.kind]?.pins;
  if (!pins) return null;
  const members: BusMember[] = [];
  for (let i = 0; i < pins.length; i++) {
    const p = parseBusLabel(pins[i].label);
    if (p && p.base === parsed.base)
      members.push({ pinIndex: i, index: p.index });
  }
  if (members.length < 2) return null; // not a bus
  members.sort((a, b) => a.index - b.index);
  return { base: parsed.base, members };
}

/**
 * Given the single strand the player just drew (`fromPin` → `toPin`), return the ADDITIONAL pin pairs to
 * wire so the whole bus is connected — or null when this isn't a clean bus connection. Guards (so a
 * deliberate single-bit wire is never surprised into a ribbon): both endpoints belong to a bus on their
 * respective components; the two buses have the SAME width; and every sibling pair is currently UNWIRED.
 * Pairs preserve the index OFFSET the player established (A0→B1 ⇒ A1→B2, …) and exclude the drawn pair.
 */
export function planBusAutocomplete(
  graph: BoardGraph,
  fromPin: PinRef,
  toPin: PinRef,
): [PinRef, PinRef][] | null {
  if (fromPin.componentId === toPin.componentId) return null; // a bus connects two different parts
  const srcBus = busOfPin(graph, fromPin);
  const dstBus = busOfPin(graph, toPin);
  if (!srcBus || !dstBus) return null;
  if (srcBus.members.length !== dstBus.members.length) return null; // equal width only

  const srcIdx = parseBusLabel(pinLabel(graph, fromPin))!.index;
  const dstIdx = parseBusLabel(pinLabel(graph, toPin))!.index;
  const offset = dstIdx - srcIdx; // the bit alignment the player chose
  const dstByIndex = new Map(dstBus.members.map((m) => [m.index, m.pinIndex]));

  const pairs: [PinRef, PinRef][] = [];
  for (const m of srcBus.members) {
    if (m.index === srcIdx) continue; // the strand the player already drew
    const dstPinIndex = dstByIndex.get(m.index + offset);
    if (dstPinIndex === undefined) return null; // a bit has no aligned partner → not a clean bus connect
    const s: PinRef = {
      componentId: fromPin.componentId,
      pinIndex: m.pinIndex,
    };
    const d: PinRef = { componentId: toPin.componentId, pinIndex: dstPinIndex };
    if (pinIsWired(graph, s) || pinIsWired(graph, d)) return null; // don't clobber existing wires
    pairs.push([s, d]);
  }
  return pairs.length > 0 ? pairs : null;
}

// SPDX-License-Identifier: Apache-2.0
// THE CONTROL WORD — the set of "levers" the control unit asserts each micro-step (the owner's
// microcode-table screenshot, 2026-06-26). Every register/ALU on the shared 4-bit bus is driven by
// one or more of these bits: an OUT-enable drives the bus, a load reads it, never two drivers at once.
// The control unit is a ROM (the "control store") addressed by {opcode, step, flags}; each row is one
// control word. This module is the FORMAT of that word + the ROM ADDRESS — i.e. the machine-readable
// half of "a way to program the CPU's behaviour." Pure data/bit-twiddling, no sim/wasm — headless.
//
// Bit positions ARE the contract: when the player builds the control store, each ROM data-output bit
// drives the like-named lever. Change a position here only by also re-wiring the built control store.

/** The datapath + sequencing levers, each a single control-word bit. Names mirror the block diagram
 * (CO = PC out, MI = MAR in, …). `*I` = load this register FROM the bus; `*O` = drive the bus FROM
 * this register; the rest are sequencing/ALU-latch strobes. */
export const LEVER = {
  /** Halt: freeze the clock (HLT instruction). */
  HLT: 1 << 0,
  /** Program-counter count-enable: PC += 1 on this step (FETCH T1). */
  PCE: 1 << 1,
  /** PC out → bus (FETCH T0, "CO"). */
  CO: 1 << 2,
  /** PC jump-load ← bus (JCC, "J"). */
  J: 1 << 3,
  /** MAR load ← bus ("MI"). */
  MI: 1 << 4,
  /** RAM write ← bus ("RI"). */
  RI: 1 << 5,
  /** RAM read → bus ("RO"). */
  RO: 1 << 6,
  /** IR load ← bus (FETCH T1, "II"). */
  II: 1 << 7,
  /** IR operand → bus ("IO" — the low nibble / address field; the opcode goes straight to control). */
  IO: 1 << 8,
  /** Accumulator A load ← bus ("AI"). */
  AI: 1 << 9,
  /** Accumulator A out → bus ("AO"). */
  AO: 1 << 10,
  /** ALU operand B load ← bus ("BI"). */
  BI: 1 << 11,
  /** ALU result → bus ("EO"). */
  EO: 1 << 12,
  /** OUT register load ← bus ("OI"). Defined by the datapath; the provided microcode never asserts it
   * (room for an OUT instruction). */
  OI: 1 << 13,
  /** Flags load: latch C,Z from the ALU ("FI" — only ADD/NOR assert it, so JCC sees the last arith C). */
  FI: 1 << 14,
  /** Reset the micro-step counter to T0 (end of an instruction → next thing to run is FETCH). */
  RST: 1 << 15,
} as const;

export type LeverName = keyof typeof LEVER;

/** Lever names in bit order (for decoding/printing a control word back to its asserted levers). */
export const LEVER_NAMES = Object.keys(LEVER) as LeverName[];

/** The ALU function sub-field (bits 16+). A 74181-style unit: `M` picks arithmetic vs logic, `S1:S0`
 * the operation, `AINV`/`BINV` invert the inputs, `CIN` is the carry-in. This CPU needs only ADD
 * (M=0, CIN=0) and NOR (M=1, op=AND, AINV=1, BINV=1 ⇒ ¬A·¬B = ¬(A+B)); the field is general so other
 * ops drop in. */
export const ALU = {
  /** Mode: 0 = arithmetic (adder), 1 = logic. */
  M: 1 << 16,
  /** Function select bit 0. */
  S0: 1 << 17,
  /** Function select bit 1. */
  S1: 1 << 18,
  /** Invert the A input. */
  AINV: 1 << 19,
  /** Invert the B input. */
  BINV: 1 << 20,
  /** Carry-in. */
  CIN: 1 << 21,
} as const;

export type AluBitName = keyof typeof ALU;

/** Total control-word width in bits (datapath levers + ALU field). The control store's data port is
 * this wide. */
export const CONTROL_WORD_BITS = 22;

/** A control word is a non-negative integer with {@link LEVER} / {@link ALU} bits set. `0` = idle
 * (no driver, no load — a legal "do nothing" step). */
export type ControlWord = number;

/** OR together the named levers/ALU bits into one control word. */
export function controlWord(...bits: number[]): ControlWord {
  return bits.reduce((w, b) => w | b, 0);
}

/** Decode a control word back to the list of asserted lever names (for the listing/teaching panel). */
export function leversOf(word: ControlWord): LeverName[] {
  return LEVER_NAMES.filter((n) => (word & LEVER[n]) !== 0);
}

/** Decode the ALU sub-field of a control word to its asserted bit names. */
export function aluBitsOf(word: ControlWord): AluBitName[] {
  return (Object.keys(ALU) as AluBitName[]).filter(
    (n) => (word & ALU[n]) !== 0,
  );
}

// --- The control-store ROM address: {opcode, step, flags} -----------------------------------------
// "address (opcode, step, flags) picks a row" (the screenshot). The control store is addressed by the
// instruction's opcode (from IR), the micro-step counter, and the latched flags. This is the address
// FORMAT the player wires into the control store's address port.

/** Micro-step counter width: T0..T5 need 3 bits (0..7). */
export const STEP_BITS = 3;
/** Flag inputs into the control store: C (carry) and Z (zero) — 2 bits. */
export const FLAG_BITS = 2;
/** Opcode width: a 4-bit opcode (high nibble of the instruction word). */
export const OPCODE_BITS = 4;

/** Latched-flag bit positions within the {@link FLAG_BITS}-wide flag field of the control-store
 * address (and the flags register). */
export const FLAG = { C: 1 << 0, Z: 1 << 1 } as const;
export type FlagName = keyof typeof FLAG;

/** Total control-store address width (= log2 of the number of ROM rows). */
export const CONTROL_STORE_ADDR_BITS = OPCODE_BITS + STEP_BITS + FLAG_BITS;
/** Number of rows in the control store (every possible {opcode, step, flags}). */
export const CONTROL_STORE_ROWS = 1 << CONTROL_STORE_ADDR_BITS;

/**
 * Pack {opcode, step, flags} into the control-store ROM address. Layout (MSB→LSB):
 * `[opcode | step | flags]` — opcode in the high bits, flags in the low bits, so a given opcode's
 * rows are contiguous and a given (opcode,step)'s flag variants are adjacent (handy for the listing).
 */
export function controlStoreAddr(
  opcode: number,
  step: number,
  flags: number,
): number {
  return (
    ((opcode & ((1 << OPCODE_BITS) - 1)) << (STEP_BITS + FLAG_BITS)) |
    ((step & ((1 << STEP_BITS) - 1)) << FLAG_BITS) |
    (flags & ((1 << FLAG_BITS) - 1))
  );
}

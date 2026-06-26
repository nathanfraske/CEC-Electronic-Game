// SPDX-License-Identifier: Apache-2.0
// THE MICROCODE TABLE — transcribed verbatim from the owner's "MICROCODE TABLE" screenshot
// (2026-06-26): one row per micro-step, the asserted levers per row. "address (opcode, step, flags)
// picks a row; the row's bits drive the levers; this table is the whole CPU behaviour."
//
// buildControlStore() expands this table into the control-store ROM IMAGE — the array the player loads
// into the control unit's memory to give the machine its behaviour (the second half of "a way to
// program it": the assembler programs RAM, this programs the control store). Pure data — headless.

import {
  LEVER,
  ALU,
  controlWord,
  controlStoreAddr,
  CONTROL_STORE_ROWS,
  FLAG,
  STEP_BITS,
  FLAG_BITS,
  type LeverName,
  type AluBitName,
  type FlagName,
  type ControlWord,
} from "./controlWord";
import { OPCODES } from "./isa";

/** One micro-step: the levers it asserts, an optional ALU function setting, and an optional flag
 * condition that gates the WHOLE step ("only if C=0" ⇒ when the condition fails the step is idle). */
export interface MicroStep {
  /** Datapath/sequencing levers asserted this step. */
  levers: LeverName[];
  /** ALU sub-field bits asserted this step (ADD/NOR set the operation here). */
  alu?: AluBitName[];
  /** Gate the whole step on a latched flag (JCC: only act when C is clear). */
  cond?: { flag: FlagName; value: 0 | 1 };
  /** The plain-language effect (the screenshot's right column). */
  note: string;
}

/**
 * FETCH runs before every instruction (micro-steps T0, T1) and is opcode-independent, so the same two
 * words sit at step 0/1 of every opcode's block. T1 also increments the PC (PCE).
 */
export const FETCH: MicroStep[] = [
  { levers: ["CO", "MI"], note: "PC -> MAR" }, // T0
  { levers: ["RO", "II", "PCE"], note: "RAM[MAR] -> IR, PC++" }, // T1
];

/** Per-instruction micro-steps, STARTING AT T2 (T0/T1 are the shared FETCH above). Keyed by mnemonic;
 * the opcode comes from {@link OPCODES}. RST drops the step counter to T0 (→ next is FETCH). */
export const MICROCODE: Record<string, MicroStep[]> = {
  // LDA n — load A from memory.
  LDA: [
    { levers: ["IO", "MI"], note: "IR address -> MAR" }, // T2
    { levers: ["RO", "AI"], note: "RAM[MAR] -> A" }, // T3
    { levers: ["RST"], note: "done, restart fetch" }, // T4
  ],
  // STA n — store A to memory.
  STA: [
    { levers: ["IO", "MI"], note: "IR address -> MAR" },
    { levers: ["AO", "RI"], note: "A -> RAM[MAR]" },
    { levers: ["RST"], note: "done" },
  ],
  // ADD n — A = A + mem[n]. ALU arithmetic (M=0), carry-in 0; latch flags (FI).
  ADD: [
    { levers: ["IO", "MI"], note: "IR address -> MAR" },
    { levers: ["RO", "BI"], note: "RAM[MAR] -> B" },
    {
      levers: ["EO", "AI", "FI"],
      alu: [], // M=0, CIN=0, no inversion ⇒ A + B
      note: "M0 Cin0: A + B -> A, latch C,Z",
    },
    { levers: ["RST"], note: "done" },
  ],
  // NOR n — A = A NOR mem[n]. ALU logic (M=1), op AND with both inputs inverted ⇒ ¬A·¬B = ¬(A+B).
  NOR: [
    { levers: ["IO", "MI"], note: "IR address -> MAR" },
    { levers: ["RO", "BI"], note: "RAM[MAR] -> B" },
    {
      levers: ["EO", "AI", "FI"],
      alu: ["M", "AINV", "BINV"], // M=1 logic, S=AND (S1:S0=0), invert A & B ⇒ A NOR B
      note: "M1 AND Ainv1 Binv1: A NOR B -> A",
    },
    { levers: ["RST"], note: "done" },
  ],
  // JCC n — jump if carry clear. T2 acts ONLY when C=0 (else nothing), then restart.
  JCC: [
    {
      levers: ["IO", "J"],
      cond: { flag: "C", value: 0 },
      note: "address -> PC (else do nothing)",
    },
    { levers: ["RST"], note: "done" },
  ],
  // HLT — stop the machine (freeze the clock).
  HLT: [{ levers: ["HLT"], note: "stop the machine" }],
};

/** Resolve one {@link MicroStep} to its control word, given the latched flags (for `cond`). */
function microStepWord(step: MicroStep, flags: number): ControlWord {
  if (step.cond) {
    const bit = FLAG[step.cond.flag];
    const isSet = (flags & bit) !== 0 ? 1 : 0;
    if (isSet !== step.cond.value) return 0; // condition fails ⇒ idle step
  }
  const leverBits = step.levers.map((n) => LEVER[n]);
  const aluBits = (step.alu ?? []).map((n) => ALU[n]);
  return controlWord(...leverBits, ...aluBits);
}

/**
 * The control word for a given {opcode, step, flags} — the heart of the control unit. Steps 0/1 are
 * the shared FETCH (opcode-independent); steps ≥2 index the opcode's microcode (step−2). A step past
 * the end of an instruction (it RST'd already) is idle (0) — a don't-care the counter never reaches.
 */
export function microword(
  opcode: number,
  step: number,
  flags: number,
): ControlWord {
  if (step < FETCH.length) return microStepWord(FETCH[step], flags);
  const mnem = Object.keys(OPCODES).find((m) => OPCODES[m].opcode === opcode);
  if (!mnem) return 0; // unused opcode
  const steps = MICROCODE[mnem];
  const idx = step - FETCH.length;
  if (idx >= steps.length) return 0; // after RST
  return microStepWord(steps[idx], flags);
}

/**
 * Expand the whole table into the control-store ROM image: `image[controlStoreAddr(opcode,step,flags)]`
 * = the control word for that row. Every address is filled (FETCH replicated across opcodes; unused
 * opcodes / post-RST steps are 0). This array IS the control-unit program to load.
 */
export function buildControlStore(): ControlWord[] {
  const image = new Array<ControlWord>(CONTROL_STORE_ROWS).fill(0);
  const stepCount = 1 << STEP_BITS;
  const flagCount = 1 << FLAG_BITS;
  for (const def of Object.values(OPCODES)) {
    for (let step = 0; step < stepCount; step++) {
      for (let flags = 0; flags < flagCount; flags++) {
        image[controlStoreAddr(def.opcode, step, flags)] = microword(
          def.opcode,
          step,
          flags,
        );
      }
    }
  }
  return image;
}

// SPDX-License-Identifier: Apache-2.0
// Headless tests for the CPU programmer (ISA + assembler + microcode/control-store). Pure
// string/number work — no sim, no wasm — so it runs in node like the netlist tests.
import { describe, it, expect } from "vitest";
import {
  OPCODES,
  CPU_SPEC,
  encodeInstruction,
  decodeInstruction,
  assemble,
  disassemble,
} from "./isa";
import {
  LEVER,
  ALU,
  FLAG,
  controlWord,
  leversOf,
  aluBitsOf,
  controlStoreAddr,
  CONTROL_STORE_ROWS,
  CONTROL_STORE_ADDR_BITS,
} from "./controlWord";
import { microword, buildControlStore, FETCH, MICROCODE } from "./microcode";

describe("ISA encode/decode", () => {
  it("packs opcode high nibble | operand low nibble", () => {
    expect(encodeInstruction("LDA", 4)).toBe(0x04);
    expect(encodeInstruction("ADD", 5)).toBe(0x25);
    expect(encodeInstruction("STA", 6)).toBe(0x16);
    expect(encodeInstruction("HLT")).toBe(0x50);
  });

  it("round-trips through decode", () => {
    for (const [mnem, def] of Object.entries(OPCODES)) {
      const operand = def.operand ? 0xa : 0;
      const word = encodeInstruction(mnem, operand);
      const d = decodeInstruction(word);
      expect(d.mnemonic).toBe(mnem);
      expect(d.opcode).toBe(def.opcode);
      expect(d.operand).toBe(operand);
    }
  });

  it("masks the operand to the field width", () => {
    // operand 0x1F masked to 4 bits ⇒ 0xF
    expect(encodeInstruction("LDA", 0x1f) & 0xf).toBe(0xf);
  });
});

describe("assembler", () => {
  it("assembles a small program with labels, ORG, and DB", () => {
    const src = `
      ; A = 5 + 3, store, halt
      ORG 0
      LDA five
      ADD three
      STA result
      HLT
      five:   DB 5
      three:  DB 3
      result: DB 0
    `;
    const r = assemble(src);
    expect(r.errors).toEqual([]);
    expect(r.symbols).toMatchObject({ FIVE: 4, THREE: 5, RESULT: 6 });
    expect(r.image.slice(0, 7)).toEqual([0x04, 0x25, 0x16, 0x50, 5, 3, 0]);
    // unused tail is zero-filled to the full RAM width
    expect(r.image).toHaveLength(CPU_SPEC.ramWords);
    expect(r.image.slice(7).every((w) => w === 0)).toBe(true);
  });

  it("honors ORG to place code/data at an address", () => {
    const r = assemble("ORG 8\nHLT");
    expect(r.errors).toEqual([]);
    expect(r.image[8]).toBe(0x50);
    expect(r.image[0]).toBe(0);
  });

  it("supports a label on its own line and forward references", () => {
    const r = assemble(`
      JCC done
      HLT
      done: HLT
    `);
    expect(r.errors).toEqual([]);
    // JCC -> done (addr 2); HLT at 1; HLT at 2
    expect(r.image.slice(0, 3)).toEqual([
      encodeInstruction("JCC", 2),
      0x50,
      0x50,
    ]);
  });

  it("reports unknown mnemonics, missing/extra operands, range, and unknown labels", () => {
    expect(assemble("FOO 1").errors[0].message).toMatch(/unknown mnemonic/i);
    expect(assemble("LDA").errors[0].message).toMatch(/needs an operand/i);
    expect(assemble("HLT 3").errors[0].message).toMatch(/takes no operand/i);
    expect(
      assemble("LDA 99").errors.some((e) => /outside/i.test(e.message)),
    ).toBe(true);
    expect(assemble("LDA nowhere").errors[0].message).toMatch(/unknown label/i);
  });

  it("parses hex/binary literals", () => {
    expect(assemble("LDA 0xA").image[0]).toBe(0x0a);
    expect(assemble("DB 0b1010").image[0]).toBe(0xa);
    expect(assemble("DB $0f").image[0]).toBe(0xf);
  });

  it("disassembles an image back to mnemonics", () => {
    const r = assemble("LDA 3\nHLT");
    const text = disassemble(r.image);
    expect(text.split("\n")[0]).toMatch(/00: 03\s+LDA 3/);
    expect(text.split("\n")[1]).toMatch(/01: 50\s+HLT/);
  });
});

describe("control word", () => {
  it("ORs named levers and decodes them back", () => {
    const w = controlWord(LEVER.CO, LEVER.MI);
    expect(leversOf(w).sort()).toEqual(["CO", "MI"]);
    expect(aluBitsOf(w)).toEqual([]);
  });

  it("keeps the ALU sub-field separate from datapath levers", () => {
    const w = controlWord(LEVER.EO, LEVER.AI, ALU.M, ALU.AINV, ALU.BINV);
    expect(leversOf(w).sort()).toEqual(["AI", "EO"]);
    expect(aluBitsOf(w).sort()).toEqual(["AINV", "BINV", "M"]);
  });
});

describe("microcode (matches the screenshot)", () => {
  it("FETCH is shared by every opcode: T0=CO MI, T1=RO II PCE", () => {
    for (const def of Object.values(OPCODES)) {
      expect(microword(def.opcode, 0, 0)).toBe(controlWord(LEVER.CO, LEVER.MI));
      expect(microword(def.opcode, 1, 0)).toBe(
        controlWord(LEVER.RO, LEVER.II, LEVER.PCE),
      );
    }
  });

  it("ADD T4 = EO AI FI with arithmetic ALU (no ALU bits set)", () => {
    const w = microword(OPCODES.ADD.opcode, 4, 0); // T4 = step index 2 after the 2 FETCH steps
    expect(leversOf(w).sort()).toEqual(["AI", "EO", "FI"]);
    expect(aluBitsOf(w)).toEqual([]); // M=0, Cin=0 ⇒ A + B
  });

  it("NOR T4 = EO AI FI with M, AINV, BINV (¬A·¬B = A NOR B)", () => {
    const w = microword(OPCODES.NOR.opcode, 4, 0);
    expect(leversOf(w).sort()).toEqual(["AI", "EO", "FI"]);
    expect(aluBitsOf(w).sort()).toEqual(["AINV", "BINV", "M"]);
  });

  it("JCC T2 jumps only when carry is clear", () => {
    const op = OPCODES.JCC.opcode;
    expect(microword(op, 2, 0)).toBe(controlWord(LEVER.IO, LEVER.J)); // C=0 ⇒ jump
    expect(microword(op, 2, FLAG.Z)).toBe(controlWord(LEVER.IO, LEVER.J)); // Z set, C clear ⇒ still jumps
    expect(microword(op, 2, FLAG.C)).toBe(0); // C set ⇒ do nothing
  });

  it("HLT T2 asserts HLT; every instruction RSTs at its last step", () => {
    expect(microword(OPCODES.HLT.opcode, 2, 0)).toBe(controlWord(LEVER.HLT));
    // LDA's last step (T4) is RST; ADD/NOR RST at T5.
    expect(microword(OPCODES.LDA.opcode, 4, 0)).toBe(controlWord(LEVER.RST));
    expect(microword(OPCODES.ADD.opcode, 5, 0)).toBe(controlWord(LEVER.RST));
  });

  it("every table step is reachable within the step counter width", () => {
    for (const steps of Object.values(MICROCODE)) {
      expect(FETCH.length + steps.length).toBeLessThanOrEqual(1 << 3); // STEP_BITS = 3 ⇒ ≤ 8 steps
    }
  });
});

describe("control store image", () => {
  it("has one row per {opcode, step, flags} address", () => {
    const rom = buildControlStore();
    expect(rom).toHaveLength(CONTROL_STORE_ROWS);
    expect(CONTROL_STORE_ROWS).toBe(1 << CONTROL_STORE_ADDR_BITS);
  });

  it("places each microword at its control-store address", () => {
    const rom = buildControlStore();
    expect(rom[controlStoreAddr(OPCODES.ADD.opcode, 4, 0)]).toBe(
      controlWord(LEVER.EO, LEVER.AI, LEVER.FI),
    );
    expect(rom[controlStoreAddr(OPCODES.JCC.opcode, 2, FLAG.C)]).toBe(0);
    expect(rom[controlStoreAddr(OPCODES.JCC.opcode, 2, 0)]).toBe(
      controlWord(LEVER.IO, LEVER.J),
    );
  });

  it("replicates FETCH across every opcode block", () => {
    const rom = buildControlStore();
    const fetch0 = controlWord(LEVER.CO, LEVER.MI);
    for (const def of Object.values(OPCODES)) {
      expect(rom[controlStoreAddr(def.opcode, 0, 0)]).toBe(fetch0);
    }
  });
});

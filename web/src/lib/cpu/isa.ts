// SPDX-License-Identifier: Apache-2.0
// THE INSTRUCTION SET + ASSEMBLER — "a way to program it" (owner ask, 2026-06-26). The CPU's RAM holds
// a program of 8-bit instruction words: opcode in the HIGH nibble (→ control unit), operand in the LOW
// nibble (→ the 4-bit bus via IO). This module turns assembly text into the 16-word RAM image the
// player loads into the machine's memory. Pure string/number work — no sim, no wasm — so it is
// headless-testable (vitest) exactly like buildNetlist.
//
// WIDTH ASSUMPTION (state it plainly so it's easy to retune): the shared bus / data path is 4-bit
// (16 words of memory, 4-bit operands & data), but an instruction WORD is 8-bit so opcode+operand fit
// in one fetch — the opcode wire goes straight to the control unit, IO drives only the operand nibble.
// If the target machine differs, change CPU_SPEC.

/** Machine geometry. Defaults match the owner's 4-bit SAP-style core; retune here if the build differs. */
export const CPU_SPEC = {
  /** Data path / bus width (bits): operands, data, addresses. */
  dataBits: 4,
  /** Instruction word width (bits): opcode nibble + operand nibble. */
  wordBits: 8,
  /** Operand / address field width (bits) = low nibble of the word. */
  operandBits: 4,
  /** Opcode field width (bits) = high nibble of the word. */
  opcodeBits: 4,
  /** Words of main memory (RAM). 4-bit address ⇒ 16. */
  ramWords: 16,
} as const;

/** One instruction's static description. `operand` says whether a line needs an argument. */
export interface OpDef {
  /** 4-bit opcode value (the high nibble; also the control-store address's opcode field). */
  readonly opcode: number;
  /** Human name shown in the microcode table / listing. */
  readonly name: string;
  /** Does the mnemonic take an operand (an address or immediate)? HLT does not. */
  readonly operand: boolean;
}

/**
 * The opcode map. Values are MINE (the screenshot fixes the microcode rows, not the numeric opcodes);
 * they are contiguous from 0 so the control store stays small, and they double as the opcode field of
 * the control-store address. Re-number freely — the assembler and {@link buildControlStore} both read
 * this one table, so they can't drift.
 */
export const OPCODES: Record<string, OpDef> = {
  LDA: { opcode: 0x0, name: "load A from memory", operand: true },
  STA: { opcode: 0x1, name: "store A to memory", operand: true },
  ADD: { opcode: 0x2, name: "A = A + mem[n]", operand: true },
  NOR: { opcode: 0x3, name: "A = A NOR mem[n]", operand: true },
  JCC: { opcode: 0x4, name: "jump if carry clear", operand: true },
  HLT: { opcode: 0x5, name: "stop the machine", operand: false },
};

/** Reverse map opcode value → mnemonic (for disassembly / the listing). */
export const MNEMONIC_OF: Record<number, string> = Object.fromEntries(
  Object.entries(OPCODES).map(([m, d]) => [d.opcode, m]),
);

const OPERAND_MASK = (1 << CPU_SPEC.operandBits) - 1;

/** Pack a mnemonic + operand into one 8-bit instruction word (opcode high nibble | operand low). */
export function encodeInstruction(mnemonic: string, operand = 0): number {
  const def = OPCODES[mnemonic.toUpperCase()];
  if (!def) throw new Error(`unknown mnemonic "${mnemonic}"`);
  return (def.opcode << CPU_SPEC.operandBits) | (operand & OPERAND_MASK);
}

/** Split an 8-bit instruction word into its opcode value + operand nibble. */
export function decodeInstruction(word: number): {
  opcode: number;
  mnemonic?: string;
  operand: number;
} {
  const opcode =
    (word >> CPU_SPEC.operandBits) & ((1 << CPU_SPEC.opcodeBits) - 1);
  return {
    opcode,
    mnemonic: MNEMONIC_OF[opcode],
    operand: word & OPERAND_MASK,
  };
}

/** One assembled word + where it came from (for the listing panel). */
export interface AsmLine {
  /** Memory address (word index) this line assembled to. */
  addr: number;
  /** The assembled 8-bit word. */
  word: number;
  /** 1-based source line number. */
  line: number;
  /** The trimmed source text. */
  text: string;
}

/** An assembler error tied to a source line. */
export interface AsmError {
  line: number;
  message: string;
}

/** The result of {@link assemble}: a RAM image plus a listing, symbol table, and any errors. */
export interface AsmResult {
  /** {@link CPU_SPEC.ramWords} words, default 0 — the image to load into RAM. */
  image: number[];
  /** Per-emitted-word listing, in address order. */
  listing: AsmLine[];
  /** Label → address. */
  symbols: Record<string, number>;
  /** Errors (empty ⇒ clean assembly). */
  errors: AsmError[];
}

/** Parse a numeric literal: decimal, `0x..` hex, `0b..` binary, or `$..` hex. Returns null if not one. */
function parseNumber(tok: string): number | null {
  const t = tok.trim().toLowerCase();
  let n: number;
  if (t.startsWith("0x")) n = parseInt(t.slice(2), 16);
  else if (t.startsWith("$")) n = parseInt(t.slice(1), 16);
  else if (t.startsWith("0b")) n = parseInt(t.slice(2), 2);
  else if (/^-?\d+$/.test(t)) n = parseInt(t, 10);
  else return null;
  return Number.isNaN(n) ? null : n;
}

/**
 * Assemble a program into a RAM image. Grammar (one statement per line, case-insensitive mnemonics):
 *
 *   ; comment            — to end of line (also `//`)
 *   label:               — define a label at the current address (own line or before a statement)
 *   ORG n                — set the location counter to n
 *   DB v[, v...]         — emit raw data word(s) (variables, constants, tables); also `.byte`/`DATA`
 *   MNEMONIC [operand]   — emit an instruction; operand is a number or a label reference
 *
 * Two passes: pass 1 fixes label addresses, pass 2 resolves operands and emits words. Out-of-range
 * values/addresses and unknown labels/mnemonics are reported (not thrown) so the UI can show them.
 */
export function assemble(source: string): AsmResult {
  const image = new Array(CPU_SPEC.ramWords).fill(0);
  const symbols: Record<string, number> = {};
  const errors: AsmError[] = [];
  const listing: AsmLine[] = [];

  // A statement after label/comment stripping, with its resolved address (pass 1) for pass 2.
  interface Stmt {
    line: number;
    text: string;
    addr: number;
    /** raw tokens of the statement body (mnemonic/DB + args), already comment/label-stripped. */
    body: string;
  }
  const stmts: Stmt[] = [];

  // --- Pass 1: strip comments/labels, assign addresses, collect symbols. ---
  let loc = 0;
  const rawLines = source.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    let text = rawLines[i];
    // Strip comments (; or //).
    const semi = text.search(/;|\/\//);
    if (semi >= 0) text = text.slice(0, semi);
    text = text.trim();
    if (!text) continue;

    // Leading label(s): "name:" — may be followed by a statement on the same line.
    let body = text;
    let m: RegExpMatchArray | null;
    while ((m = body.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*/))) {
      const label = m[1].toUpperCase();
      if (label in symbols)
        errors.push({ line: lineNo, message: `duplicate label "${m[1]}"` });
      symbols[label] = loc;
      body = body.slice(m[0].length);
    }
    body = body.trim();
    if (!body) continue; // a label-only line

    // ORG sets the location counter and emits nothing.
    const orgM = body.match(/^ORG\s+(.+)$/i);
    if (orgM) {
      const n = parseNumber(orgM[1]);
      if (n === null)
        errors.push({
          line: lineNo,
          message: `ORG needs a number, got "${orgM[1]}"`,
        });
      else loc = n;
      continue;
    }

    // DB / .byte / DATA emits one word per comma-separated value.
    const dbM = body.match(/^(?:DB|\.BYTE|DATA)\s+(.+)$/i);
    if (dbM) {
      const parts = dbM[1].split(",");
      for (const p of parts) {
        stmts.push({ line: lineNo, text, addr: loc, body: `DB ${p.trim()}` });
        loc++;
      }
      continue;
    }

    // Otherwise an instruction — one word.
    stmts.push({ line: lineNo, text, addr: loc, body });
    loc++;
  }

  // --- Pass 2: resolve operands, emit words. ---
  const resolveOperand = (tok: string, lineNo: number): number => {
    const num = parseNumber(tok);
    if (num !== null) return num;
    const sym = tok.toUpperCase();
    if (sym in symbols) return symbols[sym];
    errors.push({ line: lineNo, message: `unknown label/number "${tok}"` });
    return 0;
  };

  for (const s of stmts) {
    if (s.addr < 0 || s.addr >= CPU_SPEC.ramWords) {
      errors.push({
        line: s.line,
        message: `address ${s.addr} is outside 0..${CPU_SPEC.ramWords - 1}`,
      });
      continue;
    }
    let word: number;
    const dbM = s.body.match(/^DB\s+(.+)$/i);
    if (dbM) {
      word =
        resolveOperand(dbM[1].trim(), s.line) & ((1 << CPU_SPEC.wordBits) - 1);
    } else {
      const toks = s.body.split(/\s+/);
      const mnem = toks[0].toUpperCase();
      const def = OPCODES[mnem];
      if (!def) {
        errors.push({ line: s.line, message: `unknown mnemonic "${toks[0]}"` });
        continue;
      }
      let operand = 0;
      if (def.operand) {
        if (toks.length < 2)
          errors.push({ line: s.line, message: `${mnem} needs an operand` });
        else operand = resolveOperand(toks[1], s.line);
      } else if (toks.length > 1) {
        errors.push({ line: s.line, message: `${mnem} takes no operand` });
      }
      if (def.operand && (operand < 0 || operand > OPERAND_MASK))
        errors.push({
          line: s.line,
          message: `operand ${operand} is outside 0..${OPERAND_MASK} (${CPU_SPEC.operandBits}-bit)`,
        });
      word = encodeInstruction(mnem, operand);
    }
    image[s.addr] = word;
    listing.push({ addr: s.addr, word, line: s.line, text: s.text });
  }

  listing.sort((a, b) => a.addr - b.addr);
  return { image, listing, symbols, errors };
}

/** Render a RAM image as a hex dump (one line per word: `addr: word  mnemonic operand`). */
export function disassemble(image: number[]): string {
  return image
    .map((word, addr) => {
      const d = decodeInstruction(word);
      const asm = d.mnemonic
        ? `${d.mnemonic}${OPCODES[d.mnemonic].operand ? " " + d.operand : ""}`
        : `DB 0x${word.toString(16)}`;
      return `${addr.toString(16).padStart(2, "0")}: ${word
        .toString(16)
        .padStart(2, "0")}  ${asm}`;
    })
    .join("\n");
}

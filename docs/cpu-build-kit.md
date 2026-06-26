<!-- SPDX-License-Identifier: Apache-2.0 -->
# CPU Build Kit — building the 4-bit SAP-style core from stock parts

**Status:** build companion, owner-directed 2026-06-26 (the "CPU CORE" block diagram + "MICROCODE
TABLE" screenshots). The owner builds the CPU by hand in the subassembly builder; this doc turns the
two diagrams into a concrete, buildable spec **mapped onto the parts that already exist**, plus the
programmer (`web/src/lib/cpu/`) that gives "a way to program it." Read with
`docs/cell-characterization-and-integration-hierarchy.md` (how a built block collapses to a cheap face)
and `docs/sequential-cell-characterization-plan.md` (Option A, the sequential collapse).

> **The good news up front:** nearly every block in the diagram already exists as a placeable part.
> The shared-bus discipline, registers, the ALU, decode, and the program counter are all buildable
> from stock parts **today**. The one genuine gap is **RAM** (and the wide microcode control-store
> ROM, which is buildable from LUTs but painful). §6 lays out the options and the recommended
> primitive (for your greenlight — not built unattended).

---

## 1. The target machine (from the diagram)

A Simple-As-Possible 4-bit core: every register and the ALU sit on **one shared 4-bit bus**; an
output-enable drives the bus, a load reads it, never two drivers at once. A microcoded control unit
asserts the right control-word bits each step; that, plus the clock, is the entire machine in motion.

| Block | Role | Bus interface |
| --- | --- | --- |
| **PC** | program counter (4-bit) | `CO` out, `J` jump-load, `PCE` count-enable |
| **MAR** | memory address register | `MI` load |
| **RAM** | main memory (16 × 8-bit words) | `RI` write, `RO` read |
| **IR** | instruction register | `II` load; opcode → control unit; `IO` operand → bus |
| **A** | accumulator | `AI` load, `AO` out |
| **B** | ALU operand | `BI` load |
| **ALU** | add / NOR, carry, flags | `EO` out; `M S1 S0 Ainv Binv Cin` function; `FI` latch C,Z |
| **flags** | C, Z | `FI` latch; C,Z → control unit |
| **OUT** | output register | `OI` load |
| **control unit** | microcode: step counter + control store | drives every lever |
| **clock** | step / run | clocks every register |

**Word-width reading (state it so it's easy to retune).** The bus/data path is **4-bit** (16 words of
memory, 4-bit operands and data). An **instruction word is 8-bit** so opcode + operand fit in one
fetch: the **opcode nibble goes straight to the control unit** (the yellow "opcode" wire in the
diagram), and **`IO` drives only the operand nibble** onto the 4-bit bus. RAM words are therefore 8-bit
(holding instructions); data values are the low nibble. This is the standard SAP arrangement and it
matches the diagram's wiring. If you actually want a 4-bit instruction word, change `CPU_SPEC` in
`web/src/lib/cpu/isa.ts` and the control-store address width in `controlWord.ts`.

---

## 2. The parts you build each block from (all exist today)

Inventory of the stock parts (file anchors in `web/src/lib/graph.ts` `PART_KINDS`):

| Need | Stock part | Pins | Notes |
| --- | --- | --- | --- |
| Register bit | **`FF`** (D flip-flop, `ELEM_DFF` 19) | Q, D, CLK, Q̄ | edge-triggered; one per bit. **Cheap** (digital, out of the analog matrix). |
| Bus driver | **`TRI`** (tri-state buffer) | Y, A, OE, VCC, GND | Y = A when OE high, **high-Z** when OE low. **Wire several Y pins to one net = the shared bus.** |
| Adder | **`FADD`** / **`HADD`** | SUM, A, B, CIN, COUT, VCC, GND | ripple-chain COUT→CIN for a 4-bit add. Combinational ⇒ **characterizes** to a cheap LUT. |
| Logic / decode / mux | gate set **`AND/OR/NAND/NOR/XOR/XNOR/NOT/BUF`** (`ELEM_GATE` 17) | Y, A, B, VCC, GND | 5-pin powered gates; build the ALU's NOR/invert/mux and the instruction decoder. |
| Programmable logic / ROM cell | **`LUT`** (`ELEM_BEHAVIORAL` prog 4) | OUT, I0..I3, CLK, VCC, GND | 4-input truth table (`Component.word`); combinational **or** registered (`Component.mode`). |
| Counter | **`CTR`** (`ELEM_BEHAVIORAL` prog 7) | CLK, RESET, Q0..Q2, VCC, GND | 3-bit only — extend the PC to 4-bit with an FF chain (or two CTRs / a custom subassembly). |
| Transmission gate | **`ASWITCH`** (TG, 24) | a, b, CTRL, VCC, GND | analog pass-gate; useful for pass logic, not needed for the core. |

**What's missing:** **RAM** (no memory primitive) and a wide **microcode ROM**. See §6.

### The shared bus (the load-bearing discipline)

There is no special "bus" type — a bus is just **one net with many `TRI` outputs wired to it** and many
register `D` inputs reading it. The control unit guarantees **exactly one OE asserted at a time**
(`CO`/`RO`/`IO`/`AO`/`EO` are mutually exclusive each step — see the microcode), so there's never bus
contention. Each register is **`TRI` × 4 (output stage, gated by its `*O` lever) + `FF` × 4 (storage,
clocked when its `*I` lever is asserted)**. Name the four bus nets `BUS0..BUS3` with net labels for
sanity. (For the curious: open-drain gates + a pull-up give a wired-OR bus instead; the `TRI` approach
is cleaner and matches the diagram's triangle symbols.)

### A register, concretely

A 4-bit register with load-enable + output-enable = the most-reused block (PC/MAR/IR/A/B/OUT are all
this, ± extras):

- **Storage:** 4 × `FF`, all clocked by the system clock.
- **Load enable (`*I`):** the cleanest build is a **2:1 mux on each D**: `D = load ? BUSi : Q`
  (feed Q back so the bit holds when not loading). Mux = a few gates or one `LUT`. *(This makes the
  bit self-dependent — see §6.2 on why that matters for the cheap face. The simpler "gated clock"
  alternative — `CLK·load` into the FF — keeps each bit a pure D-FF, which Option A A1 collapses, but
  gated clocks are glitchy; prefer the mux and lean on stock `FF` cheapness or Option A A2.)*
- **Output enable (`*O`):** 4 × `TRI`, A=Q, OE=the `*O` lever, Y→BUSi.

Seal it once as a **`Register` subassembly**, then place it six times. (PC adds count/jump; IR splits
opcode off to the control unit; OUT may drop the output stage.)

---

## 3. The ISA and machine code (`web/src/lib/cpu/isa.ts`)

Six instructions, opcode in the high nibble, operand (an address) in the low nibble:

| Mnemonic | Opcode | Effect |
| --- | --- | --- |
| `LDA n` | 0x0 | A ← mem[n] |
| `STA n` | 0x1 | mem[n] ← A |
| `ADD n` | 0x2 | A ← A + mem[n]; latch C,Z |
| `NOR n` | 0x3 | A ← A NOR mem[n]; latch C,Z |
| `JCC n` | 0x4 | if C=0: PC ← n |
| `HLT` | 0x5 | stop the clock |

(`NOR` + `JCC` is Turing-complete; `OI` exists in the datapath for a future `OUT` instruction the
shown microcode doesn't use.) The opcode **values** are ours (the screenshot fixes the microcode rows,
not the numbers) and live in one table both the assembler and the control-store builder read, so they
can't drift.

**The assembler** (`assemble(source)`): `; comments`, `label:`, `ORG n`, `DB v[,v…]`, and
`MNEMONIC [operand]` with number (`10` / `0xA` / `0b1010` / `$0f`) or label operands; two passes;
reports unknown mnemonics, missing/extra operands, out-of-range operands, and unknown labels. Output =
a 16-word RAM image + a listing + the symbol table. `disassemble(image)` is the inverse.

```
; A = 5 + 3 → result, then halt
        ORG 0
        LDA  five
        ADD  three
        STA  result
        HLT
five:   DB 5
three:  DB 3
result: DB 0
```
→ `image[0..6] = [0x04, 0x25, 0x16, 0x50, 5, 3, 0]`.

---

## 4. The control word and microcode (`controlWord.ts`, `microcode.ts`)

**The control word** is the set of levers asserted per micro-step (the "MICROCODE TABLE"). Datapath
bits `HLT PCE CO J MI RI RO II IO AI AO BI EO OI FI RST` (bits 0–15) + an ALU sub-field `M S0 S1 AINV
BINV CIN` (bits 16–21). The **bit positions are the contract**: when you build the control store, each
ROM data-output bit drives the like-named lever.

**The control store** is a ROM addressed by `{opcode, step, flags}` (`controlStoreAddr` packs them
`[opcode(4) | step(3) | flags(2)]` = a 9-bit / 512-row ROM). `buildControlStore()` expands the
microcode table into that full ROM image — **the program inside the control unit**. The table is
transcribed verbatim from the screenshot:

- **FETCH** (T0/T1, every opcode): `CO MI` → `RO II PCE`.
- **LDA**: `IO MI` → `RO AI` → `RST`. **STA**: `IO MI` → `AO RI` → `RST`.
- **ADD**: `IO MI` → `RO BI` → `EO AI FI` (M0 Cin0 ⇒ A+B) → `RST`.
- **NOR**: `IO MI` → `RO BI` → `EO AI FI` (M1, AND, Ainv Binv ⇒ ¬A·¬B) → `RST`.
- **JCC**: `IO J` *(only if C=0, else idle)* → `RST`. **HLT**: `HLT`.

So **programming the CPU is two memory images**: the assembler's output → **RAM**, and
`buildControlStore()` → the **control store**. Both are plain arrays a loader drops into the
respective memory's initial contents.

---

## 5. A way to program it — the loader

The programmer module produces the two images representation-independently. Loading them into the
machine = setting the initial contents of the memory the player builds:

- **RAM image → main memory.** Once a RAM block exists (§6), its initial contents are the assembled
  image. A small UI panel (assemble text → show listing/errors → "load into RAM") is the natural
  front-end; the core (`assemble`) is done and tested.
- **Control-store image → control unit.** `buildControlStore()` is the ROM image; the control store is
  effectively fixed (it *is* the CPU's behaviour), so it's authored once.

Until the memory primitive lands, the images are still useful: they validate the ISA/microcode, drive
tests, and can initialize a LUT-fabric or DFF-array memory's cells.

---

## 6. Engine readiness — what runs today vs the gap

### 6.1 Runnable today (stock parts, cheap)

- **Registers (PC/MAR/IR/A/B/OUT)** from stock `FF` + `TRI`: the `FF` is a **digital** element (out of
  the dense analog matrix), so dozens of them are cheap. A whole register file of stock flops runs fine
  today — **no Option A needed for a first working CPU.**
- **ALU + decoders + muxes**: combinational gate networks → **characterize to cheap LUTs** (P7, already
  shipped). A 4-bit `FADD` chain + NOR/invert logic seals and collapses.
- **PC**: stock `CTR` (3-bit) or an `FF` toggle-chain + load.
- **Bus**: `TRI` outputs on shared nets, today.

### 6.2 The genuine gaps

1. **RAM (16 × 8-bit).** No memory primitive. Two ways:
   - **Build from stock `FF` + decode + `TRI` read** — works today; 128 flops + a 4→16 decoder
     (characterized LUTs) + read muxes. Cheap-ish (flops are digital) but a lot to wire.
   - **A RAM/ROM behavioral primitive** *(recommended; needs your greenlight — sim-core change).* A new
     `ELEM_BEHAVIORAL` program (appended, default-off) is **golden-safe by construction** (the golden
     places no behavioral block, so the hash folds zero extra bytes — the same discipline programs 1–8
     followed). A 16 × 8-bit RAM = 128 bits = 4 of the 16 `BEH_STATE_WORDS`, so it fits one element;
     ROM contents (the control store / a fixed program) would need a small **contents array** field
     across the wasm boundary (params aren't hashed, so fixed contents are golden-safe; RAM's mutable
     contents fold into `beh_state`). This is the highest-leverage next step: it gives **cheap RAM, a
     cheap wide control store, and the natural "load a program" surface** in one primitive.
2. **The microcode control store (512 × 22-bit ROM).** Buildable from `LUT`s, but each control bit is a
   function of 9 address bits (>4 inputs) → a **fabric/tree of LUTs** per output bit (painful by hand).
   A ROM primitive (above) collapses this to one part whose contents = `buildControlStore()`.

### 6.3 How Option A (sequential collapse) fits

Per `docs/sequential-cell-characterization-plan.md`: **A1** (single registered LUT) collapses a
**pure D-type** cell (`Q+ = f(inputs)`, no self-dependence) — e.g. a pure D-FF or a gated-clock
register bit. **A2** (the LUT+FF fabric) collapses **self-dependent / multi-bit** cells — a
load-enable register bit (`Q+ = load?D:Q`), a counter, a shift register. For *this* CPU: registers
built with the **load-enable mux** are self-dependent (A2), but you can sidestep that entirely by using
**stock `FF`s** (already cheap) for storage. So the CPU is runnable without Option A; A1/A2 are the
"build the flops from gates too" purity path and the way characterized custom sequential blocks stay
cheap.

---

## 7. Suggested build order (for tomorrow)

1. **Register subassembly** (`FF`×4 + load-mux + `TRI`×4). Test it loads/holds/drives on the bus. Seal.
2. **Bus**: drop two registers on shared `BUS0..3`, prove one drives while the other loads (the OE/load
   discipline).
3. **ALU** (`FADD`×4 ripple + NOR/invert + an M/S mux for ADD-vs-NOR + C,Z flag logic). Characterize it.
4. **PC** (register + count + `J` load), **MAR**, **IR** (+ opcode tap), **A/B/OUT**.
5. **RAM** — decide §6.1 stock-build vs greenlight the primitive.
6. **Control unit** — the step counter (`CTR`/FFs) + the control store (LUT-fabric, or the ROM
   primitive) loaded with `buildControlStore()`.
7. **Clock**, wire the control word to every lever, load a program (`assemble`) into RAM, run.

---

## 8. Where the code lives

- `web/src/lib/cpu/isa.ts` — `CPU_SPEC`, `OPCODES`, `encodeInstruction`/`decodeInstruction`,
  `assemble`, `disassemble`.
- `web/src/lib/cpu/controlWord.ts` — `LEVER`/`ALU` bitfields, `controlWord`/`leversOf`,
  `controlStoreAddr` + the address-width constants.
- `web/src/lib/cpu/microcode.ts` — `FETCH`, `MICROCODE` (the table), `microword`, `buildControlStore`.
- `web/src/lib/cpu/cpu.test.ts` — headless tests (ISA round-trip, assembler, the microcode rows, the
  control-store image).

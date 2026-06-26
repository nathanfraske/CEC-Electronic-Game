<!-- SPDX-License-Identifier: Apache-2.0 -->
# Memory + Assembly integration plan (instruction store, word reading, EEPROM)

**Status:** design / planning. No code yet. Owner-greenlight gated (touches `sim-core`, so
determinism-sensitive — see §6). Supersedes the bare "RAM/ROM behavioral primitive" backlog item (#47)
and connects the already-built assembler (#44) to the running circuit.

This plan answers one question with three faces the owner raised: **how do we integrate (a) assembly, (b)
instruction storage + word reading, and (c) EEPROM?** They are all the same missing piece — an
**addressable word memory** — plus the pipeline that loads an assembled image into it.

---

## 1. What already exists (and the gap)

**Built + tested, but DISCONNECTED (`web/src/lib/cpu/`, headless tests pass):**
- `isa.ts` — `assemble(src)` → a **16-word × 8-bit RAM image** (`opcode<<4 | operand`), plus listing,
  symbol table, errors; `disassemble()`.
- `controlWord.ts` / `microcode.ts` — `buildControlStore()` → a **512-row × 22-bit control-store ROM
  image** (addressed by `[opcode(4) | step(3) | flags(2)]`).
- **No path** from either image to the simulation. Nothing reads them; no UI loads them.

**The engine (`crates/sim-core`):**
- `Element` has **8 terminals** (`a..h`), `value`, `aux` (one f64), `params[8]`. (`lib.rs:2512`)
- Behavioral element `ELEM_BEHAVIORAL` (id 25): programmable (prog 4 = LUT, 1/2 = SPI, 3 = UART, 6 = SAR,
  7 = counter, 8 = ΣΔ). Per-element integer state = `beh_state: [u32; BEH_STATE_WORDS=16]` (= **512 bits**).
  LUT read = quantize inputs in the **commit phase** → drive output as a **constant digital Thévenin**
  (fast linear path, no Newton); registered mode latches on a CLK edge. (`lib.rs:948+`, `1539+`)
- `Component.word` (web) is **16 bits** — the only image hook today. (`graph.ts:175`)

**The three hard gaps:**
1. **Capacity.** A program image (128 bits) or control store (≈11,264 bits) does **not** fit in `aux`
   (one f64) or `beh_state` (512 bits). Memory needs a *new, larger, per-element store* + a *load channel*.
2. **Width.** A parallel memory wants address + data **buses** (e.g. 4 addr + 8 data + control ≈ 14 nodes)
   — but an `Element` has only **8 terminals**. Real serial EEPROMs (I²C/SPI) fit; parallel ROM/RAM does not.
3. **Determinism.** Memory contents are *sequential state* → they must fold into `snapshot_hash`
   (`GOLDEN_HASH = 0xeaac_3764_99e4_fa24`, seed 42, 1000 steps) **append-only**, so circuits with no
   memory element fold **zero extra bytes** and stay byte-identical. (`docs/determinism.md`, `lib.rs:7338`)

---

## 2. The unifying model: one `ELEM_MEMORY` primitive, three modes

Add **one** new sim-core element, `ELEM_MEMORY` (id **26**, append-only), a deterministic **addressable
word array** configured by a **mode** param:

| mode | name | reads | writes | persistence |
| --- | --- | --- | --- | --- |
| 0 | **ROM** | yes (image) | no | image loaded at build (program ROM, control store) |
| 1 | **RAM** | yes | yes (WE edge) | volatile — cleared on reset/power |
| 2 | **EEPROM** | yes | yes (gated, "slow") | **non-volatile** — contents saved with the circuit |

Contents live in a **new per-element store** `mem_data: Vec<Vec<u32>>` (one ragged word-array per memory
element; `addrWidth`/`wordWidth` in `params`). Word reading is the LUT pattern: in the **commit phase**,
quantize the address pins → index → drive the data pins from `mem_data[idx]` as constant digital Thévenins
(fast linear path, no Newton). RAM/EEPROM latch `data_in → mem_data[addr]` on a **write-enable edge**
(one tick of delay, exactly like the DFF/registered-LUT — so a rewind onto the edge replays bit-for-bit).

This single primitive is the instruction store, the control-store ROM, the scratch RAM, **and** the EEPROM
— the mode + the loaded image are the only differences.

---

## 3. The interface fork (the real architectural decision)

An `Element` has 8 terminals; a parallel address+data memory needs ~12–24 nodes. Two complementary
answers — **recommend doing serial first, parallel second:**

### 3A. Serial EEPROM (SPI/I²C) — realistic, fits today, ship first
Real EEPROMs *are* serial (24Cxx I²C, 25xx SPI). A serial memory needs only **CS, SCLK, SI, SO, VCC,
GND** (6 terminals) — it fits the existing model with **zero terminal/boundary change**, reusing the
exact behavioral-block machinery the SPI/UART programs already use. This is literally the "EEPROM" the
owner named, and it teaches the real thing: address/data shifted in, data shifted out, write-enable,
non-volatility. **Lowest risk, highest realism — the recommended first deliverable.** It also proves the
two pieces the parallel case needs: the `mem_data` store, the load channel (§4), and the hash fold (§6).

### 3B. Parallel ROM/RAM for the CPU — needs a width story
The SAP CPU fetches in **parallel** (address bus → data bus, combinational read), and the **control
store** must present a 22-bit control word combinationally each step. Two ways to get wide I/O without a
24-terminal element:

- **(Recommended) Bus-port via param-encoded node ranges.** Keep the element at a few *control* terminals
  (WE/OE/CLK/VCC/GND) and carry the **address bus + data bus as contiguous node-index ranges** named in
  `params` (`addrBase, addrWidth, dataOutBase, dataInBase, wordWidth`). `buildNetlist` numbers a bus's
  bit-nets **consecutively** and writes the bases into the element's params; the engine reads/drives
  `node_v[base .. base+width]` directly. No new terminals, no `set_netlist` change → **golden byte-identical**.
  Cost: `buildNetlist` must learn to allocate contiguous node ranges for a declared bus (a localized
  numbering special-case).
- **(Alternative) Widen the element model.** Append terminal arrays `i, j, …` to `set_netlist_pefgh`
  (default-empty → existing netlists pass none → byte-identical). Simpler engine-side indexing, but a
  wider wire format and still capped (~16 terminals ≠ a 16-bit bus).
- **(For the small SAP RAM only) Web-side macro expansion.** Expand a "RAM16×8" block to DFFs + a 4→16
  decoder + an output mux (golden-safe, *no* sim-core change — the #48 "fabric" idea). Fine for 16×8
  (~150 elements); **not** for the 512×22 control store (~11k bits → thousands of elements) — that wants
  the behavioral ROM element.

**Recommendation:** 3A (serial EEPROM) ships the realistic teaching artifact now; 3B uses the **bus-port**
approach for the CPU's instruction store + control store, built on the same `mem_data`/load/hash infra.

---

## 4. Loading an image (the assembly → silicon channel)

`set_netlist*` stays **untouched** (golden-safe). Add a **new wasm side-call**:

```
load_memory(elemIndex: u32, words: Uint32Array) -> bool   // seed one ELEM_MEMORY's mem_data
```

Called once per memory element right after `set_netlist`, before stepping. ROM/EEPROM get their image;
RAM starts zeroed (or also seeded). Because it's a separate call, a circuit with no memory element makes
no call and is bit-identical to today.

**Where the image lives (web):** a new `Component.memImage?: number[]` (or a base64/packed field) on the
placed memory part, so it **saves + loads with the circuit** (this is exactly EEPROM persistence — the
image is part of the saved board). `buildNetlist` reads it and `loop.ts` issues the `load_memory` call.
`Component.word` (16-bit) is retired for this use.

---

## 5. The assembly pipeline + UI

A **"Program" panel** (sibling of the characterization panel) closes the loop:

1. Editor textarea → `assemble(src)` → show the **listing + symbol table + errors** (already produced by
   `isa.ts`).
2. **"Load into …"** → write `AsmResult.image` to the selected placed **memory part's** `memImage`
   (→ `load_memory` next build). Same flow for `buildControlStore()` → a control-store ROM part.
3. Round-trip: `disassemble(memImage)` to view/verify what a memory part currently holds; a hex view for
   RAM/EEPROM live contents (read back from a snapshot).

This is the "way to program it" (#44) finally wired to a running CPU: write asm → assemble → load into the
program ROM/RAM → the CPU fetches + executes it in the deterministic sim.

---

## 6. Determinism / golden contract (the sacred part)

Every step here is designed to keep `GOLDEN_HASH = 0xeaac_3764_99e4_fa24` **unchanged**:
- **New element id 26**, appended — never reorder existing ids.
- **`mem_data` folds into `snapshot_hash` AFTER the behavioral block's words**, in fixed element order,
  emitting **zero bytes when no `ELEM_MEMORY` is present** → existing circuits (incl. the golden) are
  byte-identical. (Mirrors how DFF/sampler/comparator/behavioral state was added forward-stably.)
- **`set_netlist*` unchanged**; the image rides a separate `load_memory` call; new `params` slots default
  `0` (`param_or` → kind default).
- **Reads are constant stamps** (no Newton, fast linear path); **writes latch in the commit phase** with
  one tick of delay → rewind/replay-exact (the snapshot-history scrubber keeps working).
- The golden is regenerated **only** if we ever deliberately change dynamics — this design's contract is
  *zero delta* for every existing circuit. New `sim-core` tests: a memory read-back determinism test +
  a reproducibility test for a small program ROM driving a fetch.

---

## 7. EEPROM specifics (the owner called it out)

EEPROM = mode 2, and what makes it *EEPROM* rather than RAM:
- **Non-volatile:** `memImage` is saved with the component → survives save/load and a sim "power cycle"
  (RAM clears, EEPROM keeps). This is the headline teaching point.
- **Write-gated:** writes require a write-enable (and optionally a write-protect pin); model a
  **game-scaled write time** (a write isn't instant — a busy/RDY bit), teaching in-system programming.
- **Endurance (optional, Real-mode, golden-safe):** a per-word write counter can flag wear via the
  existing **FAIL mask** (`failed_elements` is *not* hashed → golden-safe) — teaches finite endurance
  without touching the solve.
- Serial (3A) is the realistic EEPROM; a parallel EEPROM (mode 2 on the 3B bus-port) is the same store
  with a parallel interface.

---

## 8. Phasing (each phase independently shippable + golden-safe)

- **P1 — Memory infra + serial EEPROM (3A).** `ELEM_MEMORY` id 26, `mem_data`, hash fold, `load_memory`,
  serial (SPI/I²C) read/write, `memImage` save/load, sim-core determinism tests. Ships the EEPROM.
- **P2 — Assembly pipeline + Program panel (§5).** Wire `assemble()`/`buildControlStore()` → `memImage`
  → `load_memory`; listing/errors/disassemble UI. (Web-only; rides on P1's element.)
- **P3 — Parallel bus-port (3B).** `buildNetlist` contiguous-bus numbering + param bases; parallel
  ROM/RAM read/write. Unlocks the SAP instruction fetch + the control-store ROM at native width.
- **P4 — CPU starter templates (#45) on top.** Pre-wired program-ROM + control-store + register blocks
  using the memory element, so a player drops a working skeleton and fills in the datapath.

**Recommended start:** P1 (serial EEPROM) — it's the realistic artifact the owner named, the lowest-risk
sim-core change, and it builds the exact infra (store + load + hash fold) that P3's parallel CPU memory
reuses.

---

## 9. Open decisions for the owner

1. **Serial-first (P1) vs parallel-first?** Recommend serial EEPROM first (realism + lowest risk); the
   CPU's parallel memory (P3) reuses its infra.
2. **Parallel width:** bus-port (param node-ranges, recommended) **or** widen the terminal set?
3. **Sizes:** cap memory at (say) 256 words × 16 bits for P1? The control store needs 512×22 — confirm the
   word-width ceiling (22 fits in one u32).
4. **Greenlight the `sim-core` change** (id 26 + `mem_data` + hash fold + `load_memory`). The design is
   contract-zero-delta, but it IS a core change — your call per the determinism rule.

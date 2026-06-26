<!-- SPDX-License-Identifier: Apache-2.0 -->
# IC reference library — owner-authored reference-design chips

**Purpose.** The owner is producing a **reference library**: every IC-class part in the game re-built by
hand in the IC editor as a polished **reference-design chip** — real package, datasheet pinout, clean glyph
— instead of a default/auto representation. This file is the **master checklist** of every part to (re)make,
its current state, and the pinout it carries. The owner works through it; agents keep it current.

**Two intents this list serves:**
1. **The reference-library project** (owner) — remake ALL the ICs below as reference designs.
2. **The convenience-primitive convention** (agents, also in `CLAUDE.md`) — whenever an agent adds a
   *convenience primitive* (a behavioral element / pseudo-part / drop-in block), it ships a working default
   representation AND gets an entry here marked `needs-chip`.

A re-skin is a **visual/package wrapper only** — it maps the owner's pin layout to the part's existing
terminal order (`ELEM_GATE` pins, `CEC_COMP` pinout, or `BEH_SPEC.term`); it never changes the `ELEM_*` or
the golden. Build per `docs/ui/ic-glyph-spec.md` (five-tier glyph, datasheet-verified pinout).

**Status key:** `needs-chip` (default/auto art, awaiting owner) · `refined` (owner reference chip landed) ·
`planned` (designed, not built yet). Never delete rows — flip them to `refined`.

---

## 1. Logic gates (`ELEM_GATE`)
Powered five-pin gates. (These already have datasheet-style glyphs per `ic-glyph-spec.md`; listed so the
library is complete — mark `refined` if their current glyph already qualifies.)

| Part | tag | function | status |
| --- | --- | --- | --- |
| Inverter | `INV` | Y = ¬A | needs-chip |
| Buffer | `BUF` | Y = A | needs-chip |
| AND | `AND` | Y = A·B | needs-chip |
| NAND | `NAND` | Y = ¬(A·B) | needs-chip |
| OR | `OR` | Y = A+B | needs-chip |
| NOR | `NOR` | Y = ¬(A+B) | needs-chip |
| XOR | `XOR` | Y = A⊕B | needs-chip |
| XNOR | `XNOR` | Y = ¬(A⊕B) | needs-chip |

## 2. Analog / mixed-signal ICs
| Part | tag | what it is | status |
| --- | --- | --- | --- |
| Op-Amp | `OA` | operational amplifier (`ELEM_OPAMP`) | needs-chip |
| Comparator | `CMP` | latched comparator (`ELEM_COMPARATOR`) | needs-chip |
| Analog Switch | `ASW` | transmission gate (`ELEM_ASWITCH`) | needs-chip |

> Also confirm whether standalone D-Flip-Flop (`ELEM_DFF`), Sampler (`ELEM_SAMPLER`), and Level-Shifter
> (`ELEM_LEVELSHIFT`) are exposed as bin parts — if so, add them here.

## 3. Composite ICs (`CEC_COMP`, expand to a real sub-circuit)
Pinouts as defined in `web/src/lib/netlist.ts` (`CEC_COMP`).

| Part | tag | pinout | status |
| --- | --- | --- | --- |
| Half-adder | `CEC2024` | SUM, GND, A, B, COUT, VCC | needs-chip |
| Full-adder | `CEC2018` | SUM, GND, A, B, CIN, COUT, VCC | needs-chip |
| Inverter (CMOS pair) | `CEC9002` | Y, A, VCC, GND | needs-chip |
| 2:1 MUX | `CEC2031` | Y, GND, A, B, SEL, VCC | needs-chip |
| 1:2 demux / decoder | `CEC2032` | Y0, GND, Y1, D, SEL, VCC | needs-chip |
| SR latch | `CEC3007` | Q, GND, S, R, VCC | needs-chip |
| D-latch | `CEC3014` | Q, GND, D, EN, Q̄, VCC | needs-chip |
| Majority / voter | `CEC2046` | A, B, GND, C, Y, VCC | needs-chip |
| JK / T flip-flop | `CEC3076` | Q, GND, J, K, CLK, Q̄, VCC | needs-chip |
| Tri-state buffer | `CEC2057` | Y, GND, A, OE, VCC | needs-chip |
| R-2R ladder DAC | `CEC1083` | AOUT, GND, D0, D1, D2, VCC | needs-chip |
| 3-bit flash ADC | `CEC1080` | (comparator bank + ladder + encoder) | needs-chip |

## 4. Convenience / behavioral primitives (`ELEM_BEHAVIORAL` + pseudo-parts)
Terminal order = `BEH_SPEC.term` in `web/src/lib/netlist.ts`.

| Part | tag | element | role | status |
| --- | --- | --- | --- | --- |
| FPGA Logic Cell | `LUT` | prog 4 | 4-input / registered LUT (characterization target) | needs-chip |
| SPI Master | `SPIM` | prog 1 | SPI controller | needs-chip |
| SPI Slave | `SPIS` | prog 2 | SPI peripheral | needs-chip |
| UART | `UART` | prog 3 | async serial | needs-chip |
| SAR ADC | `SAR` | prog 6 | successive-approx ADC | needs-chip |
| Counter | `CTR` | prog 7 | binary counter | needs-chip |
| Sigma-Delta ADC | `SDM` | prog 8 | ΣΔ ADC | needs-chip |
| Pulse/Clock | `PULSE` | `ELEM_ACSOURCE` + waveform param | square/triangle clock (no element of its own) | needs-chip |
| Current-sense shunt | `SHUNT` | `ELEM_RESISTOR` (mΩ) | milliohm sense resistor (no element of its own) | needs-chip |

## 5. Planned — memory + assembly feature (`docs/memory-and-assembly-plan.md`, greenlight-gated)
| Part | tag (proposed) | what it is | pinout it needs | status |
| --- | --- | --- | --- | --- |
| Serial EEPROM | `EEPROM` | non-volatile serial memory (`ELEM_MEMORY` mode 2) | CS, SCLK, SI, SO, WP?, VCC, GND (25xx/24Cxx) | planned |
| Program ROM | `ROM` | read-only word store, image-loaded (mode 0) | addr, data, OE, CE, VCC, GND (27Cxx) | planned |
| Scratch RAM | `RAM` | volatile read/write store (mode 1) | addr, data, WE, OE, CE, VCC, GND (6116/62xx) | planned |
| Control-store ROM | (wide `ROM`) | 512×22 microcode store | addr(9), data(22), OE, VCC, GND | planned |

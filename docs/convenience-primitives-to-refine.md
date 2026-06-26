<!-- SPDX-License-Identifier: Apache-2.0 -->
# Convenience primitives → owner chip-art refinement list

**Purpose.** Some parts are **convenience primitives** — a behavioral/engine shortcut (one `ELEM_*` that
does the work of a whole circuit) given a *default, auto-generated package + glyph* so it's usable
immediately. The owner wants to **remake each one by hand in the IC editor** so it carries a proper
**reference-design chip representation** (real package, datasheet pinout, clean glyph) instead of a janky
auto-box. This file is the running checklist of every such part + the pinout it needs, so the owner can work
through them.

**Convention (also in `CLAUDE.md`).** Whenever an agent adds a convenience primitive (a behavioral element,
a pseudo-part, a "drop-in block"), it ships with a **working default representation** AND gets an entry
here marked **`needs-chip`**. The owner re-authors the chip in the IC editor and flips it to **`refined`**.
The underlying `ELEM_*` is unchanged by the re-skin — the hand-built chip is the *visual/package wrapper*
that maps the owner's pin layout to the element's terminal order (`BEH_SPEC.term` / the kind's pins).

Status key: **needs-chip** (default auto-art, awaiting owner) · **refined** (owner-authored chip landed) ·
**planned** (designed, not built yet).

---

## Planned — memory + assembly feature (`docs/memory-and-assembly-plan.md`, greenlight-gated)

These are the parts that feature will add. Each ships default-skinned + listed `needs-chip`.

| Part | tag (proposed) | what it is | pinout it needs (owner authors layout) | status |
| --- | --- | --- | --- | --- |
| Serial EEPROM | `EEPROM` | non-volatile serial memory (`ELEM_MEMORY` mode 2) | CS, SCLK, SI(MOSI), SO(MISO), WP?, VCC, GND — like a 25xx/24Cxx | planned |
| Program ROM | `ROM` | read-only word store, image-loaded (`ELEM_MEMORY` mode 0) | addr bus, data bus, OE, CE, VCC, GND (parallel) — like a 27Cxx | planned |
| Scratch RAM | `RAM` | volatile read/write word store (`ELEM_MEMORY` mode 1) | addr bus, data bus, WE, OE, CE, VCC, GND — like a 6116/62xx | planned |
| Control-store ROM | (a wide `ROM`) | 512×22 microcode store for the SAP control unit | addr (9), data (22), OE, VCC, GND | planned |

---

## Existing convenience primitives (also candidates to re-skin)

The behavioral blocks + pseudo-parts already in the parts bin. Default art today; owner may want each as a
reference-design chip. (Terminal order = `BEH_SPEC.term` in `web/src/lib/netlist.ts`; the kind's visual
pins are in `web/src/lib/graph.ts`.)

| Part | tag | element | role | status |
| --- | --- | --- | --- | --- |
| FPGA Logic Cell | `LUT` | `ELEM_BEHAVIORAL` prog 4 | 4-input LUT / registered LUT (the characterization target) | needs-chip |
| SPI Master | `SPIM` | prog 1 | SPI controller | needs-chip |
| SPI Slave | `SPIS` | prog 2 | SPI peripheral | needs-chip |
| UART | `UART` | prog 3 | async serial | needs-chip |
| SAR ADC | `SAR` | prog 6 | successive-approx ADC | needs-chip |
| Counter | `CTR` | prog 7 | binary counter | needs-chip |
| Sigma-Delta ADC | `SDM` | prog 8 | ΣΔ ADC | needs-chip |
| Pulse/Clock | `PULSE` | `ELEM_ACSOURCE` + waveform param | square/triangle clock generator (no element of its own) | needs-chip |
| Current-sense shunt | `SHUNT` | `ELEM_RESISTOR` (mΩ) | milliohm sense resistor (no element of its own) | needs-chip |

> Note: the stock logic gates (`NAND`/`NOR`/`NOT`/… `ELEM_GATE`) already have datasheet-style five-pin IC
> glyphs (see `docs/ui/ic-glyph-spec.md`) and are NOT in scope here unless the owner says otherwise.

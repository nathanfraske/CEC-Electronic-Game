<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: CEC2064 4-input LUT, five-tier IC glyph

A standalone brief for the design agent. Build a five-tier IC glyph for the **CEC2064 Configurable
Logic Cell (4-input LUT + register)** — the house programmable-logic part, the first one backed by
the behavioral engine rather than fixed gates. Read this top to bottom; it gives the part, the
package frame, the live model, the five-tier arc, the controls/scope, and the validation gates. For
the verbatim house infrastructure (CSS, fonts, helpers, scope chrome, frame loop) and the exact
validation commands, follow **`ic-glyph-spec.md`**; for the part spec of record, see **CEC2064** in
**`cec-teaching-ics.md`** (the "CEC programmable logic" section).

- **Output file:** `docs/ui/parts/lut-ic.html`
- **`<title>`:** `4-input LUT, five layers` — set this correctly. (Earlier uploads shipped with a
  copy-pasted leftover title from their template — `dff-ic` said "Schmitt inverter", `buf-ic` said
  "NOT gate", `jkff-ic` carried stale D-FF pinout comments. The `<title>`, the `<h1 class="lede">`,
  the `chipType` label, the part name in the device tier, and the `names` map must all say
  **4-input LUT / CEC2064** — and grep the finished file for stale template strings before handing
  back.)

---

## 0. The one idea

**A LUT is a memory you address with your inputs.** Sixteen stored config bits (the truth table); the
four inputs form a 4-bit address; the addressed bit is the output. That is the whole of combinational
logic in one structure — *any* function of four inputs is just a different set of sixteen bits. The
hardware that does the addressing is a **16:1 multiplexer tree** (four stages of 2:1 selects, one per
input). Optionally a flip-flop registers the output. Every tier should carry the same through-line:
**logic is a lookup; the inputs pick one of sixteen stored bits.**

This is the part the CEC2031 mux pointed at ("how muxes build the FPGA lookup table") — the LUT is
that mux grown to 16:1, with the data inputs frozen into config memory.

## 1. Build approach (this one is mostly NEW — read carefully)

Unlike the JK (which was "the D flip-flop plus a steering front-end"), the LUT has **no single
existing template** — its device is a mux tree over a config-bit memory, which no shipped sheet
draws. So:

- **Take the house shell** (CSS, fonts, `el`/`drawPkg`/helpers, the scope chrome, the frame loop,
  the controls scaffolding) from **`dff-ic.html`** — it is digital, it already has a **timing-diagram
  scope** (not the analog transfer-curve scope, which is wrong here), and it contains two pieces you
  will **reuse**:
  - its **flip-flop** (master-slave latch) → the LUT's **optional output register** (registered
    mode, tiers 4–5);
  - its **cross-coupled-inverter storage cell** (tier 5) → the LUT's **config-bit SRAM cells** (the
    truth table is stored in exactly these).
- **Build the device model and tiers 2–4 fresh** around the **16:1 mux tree**. Keep it legible: do
  not draw sixteen fully-detailed cells at every tier. Show the sixteen config bits as a compact
  bank, and the four select stages as a funnel (16 to 8 to 4 to 2 to 1) with the **active path
  highlighted** (the path the current input address selects) and the inactive branches dimmed. The
  highlighted path is the lesson made visible.

## 2. The part — CEC2064 4-input LUT + register

- **Combinational function.** Address `n = 8·I3 + 4·I2 + 2·I1 + I0` (I0 is the LSB). Output
  `Y = T[n]`, where `T[0..15]` is the configured 16-bit truth table.
- **Registered mode** (a config option, not a pin): the looked-up bit is latched into an output
  flip-flop on each rising CLK edge — `Y` then holds between edges. A LUT followed by a flip-flop is
  the FPGA **logic element**; a fabric of them is any sequential machine.
- **Every fixed gate is one truth table** (use these as tier-1 presets — all verified):
  AND `0x8888` · OR `0xEEEE` · XOR `0x6666` · XNOR `0x9999` · NAND `0x7777` · NOR `0x1111` ·
  3-input majority `0xE8E8` · buffer of I0 `0xAAAA` · inverter of I0 `0x5555`. Unwired inputs read
  low, so a 2- or 3-input function just uses a table that ignores the unused high inputs.
- **Why a house part:** no discrete single LUT is sold (the closest real parts are configurable-logic
  gates like the 74LVC1G97, or the LUT blocks inside a GreenPAK), so CEC lays one cell open. It is
  the first CEC part backed by the behavioral engine, not a gate composition.

## 3. Package frame and pinout (shared by all five tiers)

**8-pin (SOT-23-8 / MSOP-8), all eight leads used.** Pin 1 indicator at the lower-left; rotate into
landscape as the other sheets do. House pin order (output on pin 1, GND pin 2, VCC last):

| Pin | Name | Function | Connection contract (every tier wires to this) |
|---|---|---|---|
| 1 | **Y** | output = the addressed truth-table bit (registered: the latched bit) | right-margin output node + the live Y readout |
| 2 | **GND** | ground / 0 V | bottom rail / cell-ground side |
| 3 | **I0** | address bit 0 (LSB) | select line of mux-tree **stage 0** |
| 4 | **I1** | address bit 1 | select line of **stage 1** |
| 5 | **I2** | address bit 2 | select line of **stage 2** |
| 6 | **I3** | address bit 3 (MSB) | select line of **stage 3** |
| 7 | **CLK** | clock (registered mode only; latches Y on the LOW-to-HIGH edge; ignored when combinational) | the output flip-flop's clock |
| 8 | **VCC** | supply (1.8 V–15 V) | top supply rail |

The **truth table** and the **mode** (combinational vs registered) are **configuration**, not pins —
a real LUT's table lives in config SRAM, not on a wire. Expose them as controls (section 7).

Adapt `drawPkg` per `ic-glyph-spec.md` §7.3 for the 8-lead frame; update `chipType`, the `names` map,
and the device-tier part name to **CEC2064**.

## 4. The live model (interactive state, per frame)

Digital — no square-law analog model. Internal state: the 16-bit truth table `T` (from the controls),
the registered bit `q`, and `clkPrev`.

```js
// inputs this frame: i0,i1,i2,i3 (booleans from the input toggles); CLK; mode; VDD.
var n = (i0?1:0) | (i1?2:0) | (i2?4:0) | (i3?8:0);   // 4-bit address, I0 = LSB
var lut = (T >> n) & 1;                               // the addressed config bit
if (registered) {
  if (CLK && !clkPrev) q = lut;                       // latch on the rising edge
  clkPrev = CLK;
  var Ybit = q;
} else {
  var Ybit = lut;                                     // combinational: follows the address now
}
// Y = Ybit ? VDD : 0 ;
```

Expose on the model record `s`: `n` (the address), `lut` (the addressed bit), `Ybit`, `T`, the four
input bits, `CLK`, `registered`, and `VDD`. Also expose which **path** through the mux tree the
address selects (the four stage choices `[i0,i1,i2,i3]`), so tiers 2–4 can highlight it.

## 5. The five-tier arc (the mux tree over a config memory)

Through-line: sixteen stored bits, a 4-stage mux funnel, the inputs choosing the path to one bit.

**Tier 1 — symbol + pinout + truth table.**
- The LUT **symbol**: a box with I0–I3 on the left, Y on the right, CLK at the bottom (a dynamic
  triangle when registered). Wire each to its real pin via the package frame.
- The **truth table is the star**: render all 16 entries (address `0000`..`1111` and the stored bit),
  with the **currently-addressed row highlighted** by the live inputs, and the output bit called out.
- A **preset selector** (control, section 7) loads AND / OR / XOR / XNOR / MAJ3 / buffer / inverter
  (the hexes in §2) so "one cell, any gate" lands immediately; a "configured as: XOR" readout.
- State note: the current address and the bit it returns ("address 0110 -> stored 1 -> Y high").

**Tier 2 — flow network (the mux funnel).**
- Sixteen **config reservoirs** in a compact row at the top, each full (1) or empty (0) per the
  truth table.
- A **four-stage funnel** beneath them (16 to 8 to 4 to 2 to 1): each stage is a rank of selector
  junctions gated by one input (stage 0 by I0 … stage 3 by I3), passing one of each pair downstream.
- Highlight the **active path** (the route the current address opens) bright; dim the rest. The
  surviving reservoir's level fills the **output chamber** -> Y. The point: your inputs open a
  channel from one stored bit to the output.

**Tier 3 — pressure-pilot valves.**
- The same funnel, one stage opened up as **pilot valves**: each 2:1 select is a pair of valves
  driven by an input and its complement (one open, one shut), passing the chosen upstream line.
- Show one stage in full valve detail and the rest as the compact funnel (keep it legible); label
  "select = I_k" on each stage. The config reservoirs are the sealed source pressures at the top.

**Tier 4 — real device (the FPGA logic element).**
- The actual architecture: a **bank of 16 SRAM config cells** (reuse the cross-coupled-inverter cell
  from `dff-ic.html` tier 5; draw a few in detail and the rest as a labelled "×16" bank) feeding a
  **transmission-gate / pass-transistor mux tree** (four stages selected by I0–I3 and their
  complements) into the output. Then the **optional output flip-flop** (reuse the D-FF's master-slave)
  on a registered-mode branch, clocked by CLK.
- This is the literal FPGA LUT4 + register, and it matches the sim backend (section 6). Draw the
  config-load path faintly and note it is volatile (SRAM).

**Tier 5 — silicon.**
- Cross-section of **one SRAM config cell** (the cross-coupled-inverter pair — the same storage
  primitive as the D-FF and the SR latch; tie it back) plus **one pass transistor** of the mux as
  MOS devices on the die.
- Teaching point: the truth table lives in **volatile SRAM**, which is why an FPGA reloads its
  configuration at power-up; the "logic" is just stored bits and pass gates. A LUT is a memory with a
  mux bolted on.

## 6. Sim backend mapping (keep the glyph faithful to it)

The web part maps to `ELEM_BEHAVIORAL` **program 4** (`BEH_PROG_LUT`) — the LUT is a real engine
element, not a gate composition. The truth table rides in `aux` (low 16 bits), the mode in
`params[4]` (≥ 1 → registered), and the pins map **Y→a · GND→e · I0/I1/I2→f/g/h · I3→c · CLK→b ·
VCC→d**. The address is `f | g<<1 | h<<2 | c<<3` (I0 = LSB = `f`). Combinational mode drives Y from
the live address; registered mode latches on the CLK edge. Golden-safe: integer state only (the
registered `q`/`clk_prev`, or none when combinational). Draw tier 4 as this exact structure.

## 7. Controls and scope

- **Controls:** four **input toggles** I0–I3; a **truth-table** control — at minimum a **preset
  selector** (AND/OR/XOR/XNOR/MAJ3/buffer/inverter), ideally also a **16-cell editable grid** so a
  learner can author an arbitrary function and watch it take effect; a **combinational / registered**
  mode switch; a **CLK** (run/pause + single-step) that is active only in registered mode; a **VDD**
  slider. Drop the analog `vin`/`vt` sliders — meaningless here.
- **Scope:** the **timing-diagram** chrome from `dff-ic.html` — traces I0–I3 (or the 4-bit address),
  CLK, and Y over time. Make the **combinational-vs-registered** difference the demo: in combinational
  mode Y follows the address immediately; flip to registered and Y updates only on the clock edge.

## 8. House style and validation (all must pass before handback)

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** on line 1: `<!-- SPDX-License-Identifier: Apache-2.0 -->`.
- **Design tokens / fonts / CSS:** copy verbatim from `dff-ic.html` (use the `--bg`/`--surface`/
  `--accent`/signal tokens; do not hardcode colors). Saira / Saira Condensed / IBM Plex Mono.
- **Forbidden glyphs in the HTML** (the §10 python check must report `none` and `0`): em-dash
  (U+2014), en-dash (U+2013), arrows (U+2192 / U+2190), the minus sign (U+2212), smart quotes
  (U+2018/2019/201C/201D), and the entities `&mdash;`/`&ndash;`. Use the ASCII hyphen-minus, write
  ranges as "1.8 V to 15 V", and write "to" instead of an arrow (or an SVG triangle marker).
  **Allowed** (used in the existing sheets): middle dot `·` and `&middot;`, `⊕`/`&#x2295;`, an
  overbar via `&#x0305;`.
- **§10 gates:** (1) `node --check` on the extracted script; (2) the forbidden-glyph python check;
  (3) structure counts — `grep -c "drawPkg(gT"` must be **5**; (4) per-tier member consistency
  (every `tN.member` read in `updateTN` is created in `buildTN`); (5) a Playwright render of all five
  tiers with the console/page-error listener (mandatory — `node --check` does not catch
  undefined-at-runtime). Sweep the inputs and a few preset tables across tiers; screenshot and fix any
  collision or off-canvas label (the 16-cell bank and the funnel are the dense spots — check them).

## 9. Handback checklist

Flag in the handback: the title / lede / chipType / part-name all read 4-input LUT / CEC2064 (no
template leftover — grep for stray "Schmitt", "NOT gate", "74AUP", "D flip-flop", "5-lead"); the
active mux-tree path is visibly highlighted in tiers 2–4; the truth-table presets demonstrate "one
cell, any gate" in tier 1; the registered-vs-combinational difference is demonstrable in the scope;
the config bits are drawn as the cross-coupled-inverter SRAM cell in tiers 4–5 (tying back to the
D-FF / SR latch storage primitive); any compactness tradeoffs in the 16-cell bank; and all §10 gates
pass clean.

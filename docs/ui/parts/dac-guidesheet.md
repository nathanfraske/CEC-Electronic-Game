<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: CEC1083 3-bit R-2R ladder DAC, five-tier IC glyph

A standalone brief for the design agent. Build a five-tier IC glyph for the **CEC1083 3-Bit Ladder DAC**
-- a digital-to-analog converter made of nothing but a resistor R-2R ladder. It is the reconstruct half
of the converter pair with the CEC1080 flash ADC. Read this top to bottom. For the house infrastructure
follow **`ic-glyph-spec.md`** (note §1 tier zoom-pairs); for the authoritative part spec follow the **CEC
Foundations catalogue** (`cec-teaching-ics.md`, in the kit).

**The defining fact: this part is PURE RESISTORS -- no transistors, no op-amp, no reference pin.** So,
unlike the comparator or the ADC, its "real device" is a resistor ladder, and its silicon tier is matched
resistors, not FETs. The standard "analogy down to the FETs" does not apply (there are no FETs); the
analogy here is **binary-weighted mixing** and the R-2R **current-halving** ladder. Crucially, the glyph's
tier 4 IS the sim: the simulator models the CEC1083 as exactly this R-2R resistor network (a `buildNetlist`
composition), so draw the real ladder and it matches the sim one-to-one.

- **Output file:** `docs/ui/parts/dac-ic.html`
- **`<title>`:** `Ladder DAC, five layers`. Make the `<h1 class="lede">`, header `chipType` (**CEC1083**),
  device-tier name, and `names` map match. CEC house part: no real-manufacturer name. Grep for stale
  strings from whatever you clone, and update the model COMMENT block.

**Reference sheets in the kit:** **`resistor-tiers.html`** (PART 3) is the building block -- the resistor,
its tiers, and its silicon (the ladder is six of these). **`flash-adc-ic.html`** (PART 4) is the converter
partner -- reuse its data-conversion framing and its staircase scope (the DAC's transfer is the inverse
staircase: code in, voltage out). The standard canvas (780x540) is fine here -- this glyph is far simpler
than the ADC, so do NOT need the oversized frame.

---

## 0. The one idea

**A weighted ladder of resistors turns a binary code into a voltage.** Each input bit is an ordinary logic
level (0 or VCC). An R-2R ladder weights them by powers of two -- the MSB counts for 4, the next for 2,
the LSB for 1 -- and sums them, so the output settles to `AOUT = (4*D2 + 2*D1 + 1*D0) / 8 * VCC`: eight
evenly-spaced steps from 0 to 7/8 VCC, one LSB = VCC/8. No op-amp, no switches, no reference pin (VCC is
the reference). It is the most honest DAC there is -- you can point at each resistor doing its job. Every
tier shows the same thing: **three weighted bits, summed by a ladder, into one analog level.**

## 1. The exact circuit (tier 4 must match this AND the sim)

A 3-bit R-2R ladder. Pick a base resistance R (e.g. 10 k) and use R and 2R (= 2*R) only -- that two-value
simplicity is the whole point of R-2R. Topology, MSB nearest the output:

```
  AOUT (node A) ---[ R ]--- node B ---[ R ]--- node C
       |                      |                   |
     [ 2R ]                 [ 2R ]              [ 2R ]
       |                      |                   |
      D2 (MSB)               D1                  D0 (LSB)
                                                  |
                                               [ 2R ]
                                                  |
                                                 GND   (termination)
```

- Six resistors total: **two R** (A-B, B-C) and **four 2R** (A-D2, B-D1, C-D0, C-GND).
- The inputs **D2/D1/D0 are driven 0 or VCC by external logic**; the ladder weights and sums them.
- Output **AOUT = node A**, unbuffered (source impedance ~R; it feeds a high-Z load like a scope or the
  comparator in a SAR loop). Result: `AOUT = (4*D2 + 2*D1 + 1*D0)/8 * VCC`.
- Why it works (the teaching point): at every node, looking toward the LSB end the resistance is 2R, so
  each step down the ladder **halves** a bit's contribution -- D2 reaches the output at full weight, D1 is
  halved once, D0 halved twice. Binary weighting from one repeated R-2R cell.

(The sim models the CEC1083 as this exact resistor network -- so tier 4 is a literal picture of the sim,
no "behavioral" caveat. The functional part is a `buildNetlist` resistor composition.)

## 2. Package frame and pinout (shared by all five tiers)

**6-pin (SOT-23-6 / SC70-6)**, CEC house order (output on pin 1):

| Pin | Name | Function | Connection contract |
|---|---|---|---|
| 1 | **AOUT** | analog output = (code/8) * VCC | node A of the ladder; the live AOUT readout |
| 2 | **GND** | ground / 0 V | the ladder termination (2R from node C) |
| 3 | **D0** | data bit 0 (LSB, weight 1) | 2R from node C |
| 4 | **D1** | data bit 1 (weight 2) | 2R from node B |
| 5 | **D2** | data bit 2 (MSB, weight 4) | 2R from node A (the output node) |
| 6 | **VCC** | supply; the ladder's full-scale reference | the bit-high level (D inputs swing 0..VCC) |

Adapt `drawPkg` to the 6-lead frame; set `chipType` = CEC1083.

## 3. The live model (interactive state, per frame)

State: the three input bits D2/D1/D0 (toggles) and VCC. The output is pure arithmetic:

```js
var code = (d2 << 2) | (d1 << 1) | d0;     // 0..7
var aout = (code / 8) * vcc;               // 0 .. 7/8 VCC, one LSB = VCC/8
```

Expose on the model record `s`: `d2`, `d1`, `d0`, `code`, `aout`, and `vcc`. Every tier animates from
this: the bit switches, the weighted contributions (4/2/1), the ladder node voltages, and the AOUT level /
staircase dot. A "count up" mode that walks the code 0->7 makes the staircase sweep. Scaled for legibility.

## 4. The five tiers

**Tier 1 -- symbol + pinout + the staircase.** Center: the DAC block (trapezoid, wide side = the 3-bit
input D2/D1/D0 on the left, point = AOUT on the right), VCC top / GND bottom, on the real pinout. Caption
the transfer `AOUT = (4*D2 + 2*D1 + 1*D0)/8 * VCC`. The scope (the staircase, section 5) is the payoff.

**Tier 2 -- flow network (analogy): binary-weighted mixing.** The whole DAC as three weighted taps feeding
one output tank: D2 opens a **wide** tap (weight 4), D1 a **medium** tap (weight 2), D0 a **narrow** tap
(weight 1); the tank level = their sum, scaled so all three full = 7/8 of the way up. Toggle a bit and its
weighted contribution adds or removes. (This is the binary weighting as plumbing -- the ladder that
produces it opens up in tier 3.)

**Tier 3 -- the R-2R current-halving ladder (zoom of tier 2).** Open the weighting mechanism: the R-2R
ladder shown as a chain where the current/contribution **halves at each rung**. Draw the three rungs with
their relative strengths (D2 full, D1 half, D0 quarter) and the repeated R-2R cell that creates the
halving. Keep it the flow/weighting picture (resistor "channels" of equal width but the ladder geometry
doing the halving), bridging to the literal schematic in tier 4. (No FET valves here -- this part has no
transistors; the mechanism is the resistor ladder itself.)

**Tier 4 -- real device: the R-2R schematic (the literal sim).** Draw the exact network of section 1: node
A (=AOUT) - R - node B - R - node C, with 2R legs A->D2, B->D1, C->D0, and the 2R termination C->GND.
Label every resistor R or 2R, label nodes A/B/C, route D2/D1/D0 in from the pins (MSB D2 at the output
node), AOUT out to its pin, VCC as the bit-high reference, GND at the termination. Light each 2R leg by
its bit (from `s`), and show the node voltages adding up to AOUT. This is the honest device -- all six
resistors visible, each doing its job -- and it is exactly what the simulator builds.

**Tier 5 -- silicon: the matched resistor ladder.** The R and 2R as **matched on-die resistors** (poly or
diffused strips; draw 2R as two R strips in series so the matching is literal), laid out so ratios track
with temperature -- the property that makes the DAC monotonic and accurate. Reuse `resistor-tiers.html`
tier 5 for the resistor cross-section. Real resistor structures (no FETs), with a note that matching, not
absolute value, sets the accuracy.

## 5. The scope -- the reconstruction staircase (the payoff)

Plot the **transfer**: the 3-bit **code on the x-axis (0..7)**, **AOUT on the y-axis (0 to VCC)**, as an
**8-step staircase** rising in equal LSB steps (VCC/8 each). Put a **live dot at the current (code, AOUT)**;
in count-up mode it climbs the stairs. This is the inverse of the flash ADC's staircase (ADC: voltage ->
code; DAC: code -> voltage) -- call that pairing out, since CEC1080 + CEC1083 are the convert/reconstruct
duo. (A nice optional overlay: the ideal straight line through the step midpoints, showing the DAC is
monotonic and evenly spaced.)

## 6. Sim backend mapping (already specified; tier 4 matches it exactly)

The CEC1083 maps to a `buildNetlist` **R-2R resistor composition** (the network of section 1; each 2R leg
tied to its D input net, driven 0/VCC by external logic). No new sim-core element -- it reuses the
resistor model, golden-safe. Because the sim IS the ladder, tier 4 is a one-to-one picture of it (state
the alignment in the footnote). (Functional wiring of the part is a follow-up to this glyph; the topology
here is the spec for it.)

## 7. House style, validation, handback

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** line 1. **CSS/fonts/tokens** from the house shell (do not hardcode colors); Saira / Saira
  Condensed / IBM Plex Mono; Critical Error brand mark. Standard 780x540 scene (this glyph is simple).
- **Forbidden glyphs** (§10 check `none`/`0`): em-dash, en-dash, arrows (U+2192/2190/2194), the minus sign
  (U+2212), smart quotes, `&mdash;`/`&ndash;`. ASCII hyphen-minus and "to"; the middle dot `·` is fine;
  write the weight as `*` or `&times;` and resistor values as "2R" / "10 k".
- **§10 gates:** (1) `node --check`; (2) forbidden-glyph check; (3) `grep -c "drawPkg(gT"` = **5**;
  (4) per-tier member consistency; (5) a **Playwright render of all five tiers** (mandatory) -- walk the
  code 0..7 and confirm AOUT steps evenly and the staircase dot climbs; screenshot each tier and fix any
  collision / off-canvas label. If you cannot run the render, say so.
- **Handback checklist:**
  - **Circuit exact:** the R-2R network of section 1 (two R, four 2R; MSB at the output node; 2R
    termination to GND); tier 4 matches it and the sim; AOUT = (4*D2+2*D1+1*D0)/8 * VCC.
  - **Pure-resistor honesty:** no transistors anywhere; tier 5 is matched resistors (2R drawn as two R in
    series); the "no FET analogy" is intentional and noted.
  - **No stubs:** every pin (AOUT, GND, D0, D1, D2, VCC) traces to its place in the ladder.
  - **CEC identity:** chipType/title/lede/device-tier/`names` = CEC1083 / ladder DAC; brand mark; no
    real-manufacturer name; pin order per the catalogue.
  - **The lesson lands:** the staircase scope is the centerpiece, binary weighting (4/2/1) is visible, the
    R-2R halving is shown, and the convert/reconstruct pairing with the CEC1080 ADC is called out.
  - **All §10 gates pass clean** (or the render is flagged for the owner).

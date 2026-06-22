<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: CEC1080 3-bit flash ADC, five-tier IC glyph

A standalone brief for the design agent. Build a five-tier IC glyph for the **CEC1080 3-Bit Flash ADC**
-- the parallel analog-to-digital converter, and the densest glyph in the set. Read this top to bottom.
For the verbatim house infrastructure follow **`ic-glyph-spec.md`** (note §1 tier zoom-pairs + FET-level
analogy); for the authoritative part spec follow the **CEC Foundations catalogue** (`cec-teaching-ics.md`,
in the kit). This brief is **deliberately prescriptive about layout** -- the flash ADC has a ladder, seven
comparators, and a thermometer-to-binary encoder to place, so the per-tier sections below say exactly what
goes where. Follow them.

**You have permission to break the standard 780x540 canvas for this part.** It is the busiest glyph in the
library, so do NOT cram it into the default frame. Use a **larger scene viewBox (recommended ~1100 x 820)
AND size the rendered scene panel up to match** (widen `.wrap` / the scene column in the CSS so the SVG
renders large, not scaled down to cram) -- the goal is that every comparator, tap, and gate is legible at
the rendered size, and still rewards zooming. Keep all five tiers sharing the one (now larger) package
frame, and keep the scope as its own sidebar panel. Scale `drawPkg` and the margins proportionally to the
new viewBox.

- **Output file:** `docs/ui/parts/flash-adc-ic.html`
- **`<title>`:** `Flash ADC, five layers`. Make the `<h1 class="lede">`, header `chipType` (**CEC1080**),
  device-tier name, and `names` map match. CEC house part: no real-manufacturer name. Grep for stale
  strings from whatever you clone, and update the model COMMENT block.

**Reference sheets in the kit:** **`comparator-ic.html`** (PART 3) is your comparator -- the ADC is a bank
of seven of them; reuse its comparator symbol, its diff-pair FET-valve analogy (tier 3), and its silicon.
**`jkff-ic.html`** (PART 4) has the `andG` / `orG` / `invTri` gate-symbol helpers and the CEC house shell
for the encoder. The ladder is just a vertical string of resistor symbols.

---

## 0. The one idea

**A flash ADC measures every threshold at once.** A reference ladder cuts VREF into seven evenly-spaced
levels; seven comparators each ask, in parallel, "is VIN above my level?"; the result is a **thermometer
code** (a stack of 1s from the bottom up to wherever VIN sits); and a **priority encoder** folds that
thermometer into a 3-bit binary number on D2/D1/D0. No clock, no searching -- the answer appears in one
step. That parallelism is the whole story: speed bought with 2^N - 1 comparators. Every tier shows the
same chain: **VIN against a ladder of levels, a column of comparators, a thermometer, an encoder, a code.**

## 1. The tier framing (zoom-pairs + FET-level analogy)

Per spec §1: tier 4 is the zoom-in of tier 1 (the symbol opened into the real ladder + comparator-bank +
encoder schematic); tier 3 is the zoom-in of tier 2 (the measuring-column analogy opened into its working
comparator-valves). Tier 5 is the silicon. Carry the analogy down to the FETs: in tier 3 each comparator
is its **diff-pair pressure-pilot valves** (from `comparator-ic.html`), not an opaque box; the encoder
gates open to their gate-symbols. Build it complete and zoomable -- with the larger canvas you have room to
show all seven comparators, not a token few (see the per-tier counts below).

## 2. The architecture (exact -- tier 4 must match this and the sim)

Three stages, left to right:

1. **Reference ladder.** Eight equal resistors in series from **VREF (top)** to **GND (bottom)**. The
   seven internal nodes are the **taps**, at k/8 of VREF for k = 1..7 (tap1 = 1/8 VREF at the bottom,
   tap7 = 7/8 VREF at the top). Label each tap with its fraction.
2. **Comparator bank.** Seven comparators, comp1..comp7. **Every comparator's `+` input is VIN**
   (a shared vertical VIN bus); comp_k's `-` input is **tap_k**. Output T_k = 1 when VIN > tap_k. Because
   the taps increase up the ladder, the outputs form a thermometer: T1..Tm = 1 and the rest 0 when VIN
   sits between tap_m and tap_(m+1) (the code is m).
3. **Priority (thermometer-to-binary) encoder.** Folds T1..T7 into D2 D1 D0. Use exactly this logic
   (draw these gates in tier 4):
   - **D2 (MSB) = T4** -- a direct wire from comp4's output. (High iff the count is >= 4.)
   - **D1 = OR( T6 , AND( T2 , NOT T4 ) )** -- one inverter (NOT T4), one AND, one OR.
   - **D0 (LSB) = OR( AND(T1, NOT T2) , AND(T3, NOT T4) , AND(T5, NOT T6) , T7 )** -- inverters NOT T2 and
     NOT T6 (NOT T4 is shared with D1), three ANDs, and a 4-input OR (draw as an OR tree). High iff the
     count is odd.
   (Encoder gate count: 3 inverters, 4 ANDs, 4 ORs -- about eleven gates plus the D2 wire.)

This is the literal flash ADC, and it matches the sim (program 5 computes `code = floor(8 * (VIN - GND) /
(VREF - GND))`, clamped 0..7 -- the same code the comparator bank + encoder produce).

## 3. Package frame and pinout (shared by all five tiers)

**7-pin (SOT-23-8 with one N.C., or MSOP-8)**, CEC house order (output on pin 1 side):

| Pin | Name | Function | Connection contract |
|---|---|---|---|
| 1 | **VIN** | analog input (sensed, high-Z), measured against VREF | the shared VIN bus to all 7 comparator `+` inputs |
| 2 | **VREF** | reference / full scale | the top of the ladder |
| 3 | **D2** | output code bit 2 (MSB) | from T4 |
| 4 | **D1** | output code bit 1 | from the D1 encoder cluster |
| 5 | **D0** | output code bit 0 (LSB) | from the D0 encoder cluster |
| 6 | **VCC** | positive supply | top rail; powers the comparators + encoder |
| 7 | **GND** | ground / 0 V | bottom rail; the ladder bottom |

(The sim terminal map is a=D0, b=D1, c=D2, d=VCC, e=GND, f=VIN, g=VREF -- already wired; the glyph just
needs to draw to the pin names above.) Adapt `drawPkg` to the larger frame; set `chipType` = CEC1080.

## 4. The live model (interactive state, per frame)

State: VIN (drive it as a slow on-screen ramp/triangle so the staircase sweeps, plus a manual slider),
VREF (a control, default = VCC), and the derived thermometer + code.

```js
var span = Math.max(vref - vgnd, 1e-6);
var frac = clamp((vin - vgnd) / span, 0, 1);
var code = Math.min(Math.floor(frac * 8), 7);          // 0..7
var therm = [1,2,3,4,5,6,7].map(function(k){ return (frac > k/8) ? 1 : 0; }); // T1..T7
var bits = { d2:(code>>2)&1, d1:(code>>1)&1, d0:code&1 };
```

Expose on the model record `s`: `vin`, `vref`, `frac`, `code`, `therm` (the 7 comparator outputs), and
`bits`. Every tier animates from this: the fill level (tier 2), which comparator-valves have tripped
(tier 3), the lit comparator outputs + encoder nodes (tier 4), the staircase marker (scope). Scaled
teaching animation.

## 5. The five tiers -- exact layout (what goes where)

Coordinates below assume an ~1100 x 820 scene viewBox with the package frame near the top; adjust
proportionally but keep the **left-to-right stage flow** (ladder -> comparators -> thermometer -> encoder
-> outputs) and the **vertical comparator stack**.

**Tier 1 -- symbol + pinout + the staircase.** Center: the ADC block (a wide trapezoid or box) labeled
"3-BIT FLASH ADC / CEC1080", VIN entering on the left (draw a small analog ramp on the input lead), VREF
on the upper left, D2/D1/D0 leaving on the right (label MSB..LSB), VCC top / GND bottom, all to the real
pins. Put the function `code = floor(8 * VIN / VREF)` as a caption. The scope (the staircase, section 6)
is the payoff here.

**Tier 2 -- flow network: the measuring column (analogy of the whole).** Left-center: a tall vertical
**measuring column** (a standpipe) whose **fill level = VIN** (animate it from `s.frac`). Up its side draw
**seven graduated marks** at 1/8..7/8 of full height -- the ladder taps -- each labeled with its fraction;
the top (8/8) is VREF. The submerged marks (level above them) are the tripped comparators; show the
**count of submerged marks = the code** as a big readout, with the 3-bit value beside it. A small inlet
labeled VIN fills the column; VREF sets the rim height. The teaching beat: raise VIN and watch marks
submerge one by one, the code stepping up. (This is the whole flash idea as one picture; the comparators
are still just "marks" here -- they open up in tier 3.)

**Tier 3 -- pressure-pilot valves: the comparator bank (zoom of tier 2, down to the FETs).** Replace each
mark with a real **comparator-valve**. Draw the **seven comparators as a vertical stack** of
pressure-pilot pairs (reuse `comparator-ic.html` tier 3): each compares the **VIN pressure** (a shared
vertical VIN manifold on the left) against its **tap pressure** (from a small ladder of seven reference
pressures), tripping its output valve when VIN exceeds the tap. Light the tripped ones from `s.therm` so
the thermometer is visible as a stack of open valves. To the right, the **encoder as a valve/logic
network** folding the seven thermometer pipes into three output pipes (D2/D1/D0). Show all seven (you have
the room); if any one is shown in full diff-pair-valve detail, make it a representative one labeled "x7".

**Tier 4 -- real device: the full schematic (the detailed tier; place precisely).** Left to right:
- **Ladder (far left, x ~60-130).** Eight resistor symbols stacked vertically between **VREF (top)** and
  **GND (bottom)**; mark the seven taps (tap7 near top ... tap1 near bottom) and label each k/8 VREF.
- **VIN bus (x ~150).** A vertical wire from the VIN pin running the full height, stubbing right into
  every comparator `+` input. Color it as the analog input.
- **Comparator bank (x ~200-460).** Seven comparator triangles stacked vertically (comp7 top aligned to
  tap7 ... comp1 bottom to tap1). Each: `+` from the VIN bus, `-` from its tap (short horizontal lead from
  the ladder). Output T_k to the right. Light each from `s.therm[k]`. These are the seven real comparators
  -- draw them as comparator symbols (they open to diff-pair FETs per the framing; cite the comparator
  sheet rather than redrawing all 7 at transistor level).
- **Thermometer bus (x ~480-540).** The seven outputs T1..T7 routed right, labeled.
- **Encoder (x ~560-900).** Draw the gates of section 2, grouped by output: **D2** = a plain wire from T4
  straight to the D2 pin (label "= T4"); **D1** = the NOT/AND/OR cluster (upper); **D0** = the larger
  NOT/AND/OR-tree cluster (lower). Use `andG`/`orG`/`invTri`. Label internal nodes. Keep the three output
  rows horizontally aligned to D2/D1/D0.
- **Outputs (far right, x ~940).** D2/D1/D0 to their pins (MSB top). 
- **Rails.** VCC across the top, GND across the bottom, powering the comparators and every encoder gate
  (no stubs -- the comparators and gates visibly draw from the rails).
Animate: as VIN rises, comparators light bottom-up, the encoder nodes follow, the three output bits update.

**Tier 5 -- silicon.** The two things flash silicon is about: the **matched reference ladder** -- a string
of identical diffused/poly resistors (emphasize that matching sets the ADC's accuracy) -- and the
**comparator array** -- a representative comparator's diff-pair in metal-oxide cross-section (reuse
`comparator-ic.html` tier 5), noted "x7 in parallel". Add a representative encoder gate's CMOS. Real
structures (resistor strips + MOS cross-sections), not a block diagram; note that the whole bank converts
in one pass.

## 6. The scope -- the quantization staircase (the payoff)

Plot the **transfer function**: VIN on the x-axis (0 to VREF), the output **code on the y-axis (0 to 7)**,
as an **8-step staircase** (each step one LSB = VREF/8 wide and one code tall). Mark the **seven comparator
thresholds** at the step risers (k/8 VREF). Put a **live dot at the current (VIN, code)** so sweeping VIN
walks the staircase. Optionally, a thin second strip under it showing the **thermometer** (seven cells
filling bottom-up as VIN climbs) so the viewer sees thermometer -> code. This staircase is the iconic ADC
graphic; make it the centerpiece and tie the live dot to the lit comparators in tier 4. (Quantization
error -- the sawtooth between the smooth input and the stair -- is a nice optional overlay.)

## 7. Sim backend mapping (already wired; the glyph should agree)

The `ADC` part is live as `ELEM_BEHAVIORAL` program 5: it reads VIN (f) and VREF (g), computes
`code = floor(8 * (VIN - GND) / (VREF - GND))` clamped 0..7, and drives D0/D1/D2 on a/b/c -- combinational
(no clock). VREF falls back to the VCC rail if unwired. The glyph teaches the ladder + comparator-bank +
encoder that produces exactly that code (the sim does the quantization directly; the architecture is what
the glyph shows). Note that in the footnote.

## 8. House style, validation, handback

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** line 1. **CSS/fonts/tokens** from the house shell (do not hardcode colors); Saira / Saira
  Condensed / IBM Plex Mono; Critical Error brand mark. The **larger viewBox is an intentional deviation**
  for this part -- note it in the handback so it is not mistaken for a mistake.
- **Forbidden glyphs** (§10 check `none`/`0`): em-dash, en-dash, arrows (U+2192/2190/2194), the minus sign
  (U+2212), smart quotes, `&mdash;`/`&ndash;`. ASCII hyphen-minus and "to"; the middle dot `·` is fine;
  write "VIN > tap" with the ASCII greater-than and fractions as "1/8 VREF".
- **§10 gates:** (1) `node --check`; (2) forbidden-glyph check; (3) `grep -c "drawPkg(gT"` = **5**;
  (4) per-tier member consistency; (5) a **Playwright render of all five tiers** (mandatory) -- sweep VIN
  from 0 to VREF and confirm the comparators light bottom-up, the code steps 0..7, and the staircase dot
  tracks; screenshot each tier and fix any collision or off-canvas label (budget the layout -- this is the
  densest sheet; the larger canvas is there for exactly this).
- **Handback checklist:**
  - **Architecture exact:** ladder (8 resistors, 7 taps at k/8), seven comparators (`+`=VIN, `-`=tap_k),
    the encoder logic of section 2 (D2 = T4; D1 and D0 clusters drawn as real gates). Tier 4 matches the
    sim's code.
  - **All seven comparators are shown** (not a token subset) in tiers 3-4; the analogy reaches the
    diff-pair FET level (tier 3) and real silicon (tier 5); no opaque encoder block.
  - **No stubs:** every pin (VIN, VREF, D2, D1, D0, VCC, GND) traces to its role; rails power the
    comparators and gates.
  - **CEC identity:** chipType/title/lede/device-tier/`names` = CEC1080 / flash ADC; brand mark; no
    real-manufacturer name; the larger canvas noted.
  - **The lesson lands:** the staircase scope is the centerpiece, the thermometer-to-code chain is visible
    end to end, and sweeping VIN animates it.
  - **All §10 gates pass clean** (or the render is flagged for the owner).

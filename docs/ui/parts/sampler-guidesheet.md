<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: CEC1041 clocked 1-bit quantizer, five-tier IC glyph

A standalone brief for the design agent. Build a five-tier IC glyph for the **CEC1041 Clocked 1-Bit
Quantizer** -- a **CEC house-brand teaching chip** (the Foundations Series, data-conversion 1xxx line),
the keystone atom of an analog-to-digital converter. This is the glyph for the game's `SAMP` part. Read
this top to bottom. For the verbatim house infrastructure (CSS, fonts, helpers, scope chrome, frame loop)
and the validation commands, follow **`ic-glyph-spec.md`**; for the part's authoritative spec and the CEC
house conventions, follow the **CEC Foundations Series catalogue** (the `cec-teaching-ics.md` entry for
CEC1041, reproduced in the build kit).

**This is a CEC house part, not a real commercial chip.** The CEC1041 has no real single-chip equivalent
-- a "1-bit quantizer chip" is not something you buy; it is the conceptual atom, so Critical Error
Computing vendors one as a teaching part (exactly as the catalogue vendors the CEC2024 half-adder, the
CEC3007 SR latch, etc.). Give it the CEC identity throughout: `chipType` = **CEC1041**, the house brand
mark, the house pin convention (output on pin 1). Do NOT name a real manufacturer's part.

**You are not starting from scratch -- two existing sheets do most of the work:**

- **`dff-ic.html` is the shell base.** It has the **timing-diagram scope** (the quantizer's scope is a
  timing trace) and the **edge-triggered capture** (SAMPLE on the rising clock edge, HOLD between edges --
  exactly the CEC1041). Take its CSS, fonts, helpers, scope chrome, frame loop.
- **`comparator-ic.html` is the device reference.** The CEC1041's front end IS a comparator (IN vs an
  internal reference) and its hold is a clock-driven regenerative sense latch -- the diff-pair +
  cross-coupled sense latch that sheet draws as real transistors in tiers 4-5. The CEC1041's realistic
  tiers are that schematic with **VN replaced by the internal ½·VCC reference** and **LE replaced by CLK**.

- **Output file:** `docs/ui/parts/sampler-ic.html`
- **`<title>`:** `Clocked quantizer, five layers` -- set this correctly; make the `<h1 class="lede">`, the
  header `chipType` (**CEC1041**), the device-tier part name, and the `names` map all read **CEC1041 /
  clocked quantizer**. Grep the finished file for stale strings ("D flip-flop", "comparator", "ADCMP601",
  "Q latched from D", "74") before handing back, since you start from those two sheets.

---

## 0. The one idea

**The instant the analog world becomes a number.** On each rising edge of CLK the CEC1041 compares its
analog input IN against its **internal half-rail reference (½·VCC)** and latches the result on Q -- high
if IN is above ½·VCC, low if below -- holding that bit until the next edge. Between edges it ignores the
input. That is SAMPLE (freeze on the edge) plus QUANTIZE (which side of the threshold), the two irreducible
halves of digitising a signal. **Stack eight against a resistor ladder and you have a flash ADC; wrap one
in a feedback loop with a DAC and you have successive approximation.** Every tier carries that arc: **an
analog input, the ½·VCC threshold, a clock edge that captures one bit and holds it.**

## 1. The real-device mandate (same split as the comparator/switch sheets)

- **Tiers 2-3 (the analogy view) are intentional abstraction -- build them rich, do not schematize.** The
  quantizer as a **sample-and-hold dipper** scooping the input level on the clock tick and comparing it to
  the ½·VCC mark (tier 2), and as **pressure-pilot valves** -- the comparison balance plus the clock-gated
  capture (tier 3). No lazy basic-symbol shortcut standing in for the mechanism.
- **Tiers 4-5 (the realistic view) must be the ACTUAL devices, correctly typed -- no basic symbols.** The
  real cell is a **clocked comparator**: a real **NMOS differential pair** (IN on one gate, the internal
  **½·VCC reference** on the other) feeding a **CLK-clocked regenerative cross-coupled sense latch** drawn
  as its **four explicit transistors** (NMOS pair + PMOS pair), over a **CLK-gated NMOS tail**, into an
  output buffer that holds the captured bit on Q. Every transistor via the spec's **§7.4 `mosfet` helper**,
  correctly typed (PMOS = gate bubble), labeled. **Tier 5 is real MOS cross-sections** (the diff pair +
  sense latch on the die), not a block diagram. This is `comparator-ic.html` tiers 4-5 with CLK driving the
  latch and the ½·VCC node as one input -- reuse that work.

## 2. The part -- CEC1041 (house teaching chip) and its real internal cell

- **Identity:** **CEC1041 Clocked 1-Bit Quantizer**, Critical Error Computing, Foundations Series
  (data-conversion 1xxx line). Tagline: *"the instant the analog world becomes a number."* Single supply,
  rail-to-rail push-pull output, **internal ½·VCC threshold (no reference pin)**, edge-triggered 1-bit
  capture, output holds between clocks. There is no real single-chip equivalent; that is why CEC vendors it.
- **The real internal cell (draw this in tiers 4-5):**
  1. **A 2-resistor reference divider** from VCC to GND (two matched resistors), tapping **½·VCC** -- the
     internal threshold, shown on-chip (this is the "no reference pin" detail made concrete).
  2. **Input differential pair -- two matched NMOS (M1/M2).** One gate is **IN**, the other the **½·VCC**
     tap.
  3. **Regenerative cross-coupled sense latch -- NMOS pair (M3/M4) + PMOS pair (M5/M6)**, the four explicit
     transistors, outputs cross-wired (the positive-feedback cell that slams the small IN-vs-½·VCC
     difference to a full bit).
  4. **Clock (sample) switch -- one NMOS (M7) gated by CLK.** The rising edge fires the latch (SAMPLE);
     between edges the tail is off and the node is held (HOLD).
  5. **Output buffer** driving Q rail-to-rail (push-pull), holding the bit between edges.
- **Device family:** all **CMOS** -- the sense-amp comparator is the canonical implementation and reuses
  the §7.4 helper.

## 3. Package frame and pinout (shared by all five tiers -- the CEC house spec)

**5-pin SC70-5 / SOT-23-5**, the **CEC house pin convention** (output on pin 1), per the catalogue entry:

| Pin | Name | Function | Connection contract |
|---|---|---|---|
| 1 | **Q** | latched 1-bit output; holds between clock edges; rail-to-rail push-pull | left/output node + the live Q readout |
| 2 | **GND** | ground / 0 V reference | bottom rail; the reference divider's bottom |
| 3 | **IN** | analog input (sensed, **high-Z -- draws ~no current**), compared against ½·VCC | right input, into the diff pair (M1 gate) |
| 4 | **CLK** | sampling clock; captures on the **LOW->HIGH edge** | the sense latch's clock (M7 gate) |
| 5 | **VCC** | positive supply (1.8 V to 15 V); **also sets the ½·VCC threshold** | top rail; the reference divider's top |

Adapt the verbatim SOT-23-5 `drawPkg` (from `inv-ic.html`, spec §7.3) for this CEC pin order. Set
`chipType` = CEC1041 and the `names` map. Stress that **IN is a sense node, not a load**, and that **VCC
sets the threshold** (move VCC and the ½·VCC decision level moves with it).

## 4. The live model (interactive state, per frame)

A clocked quantizer with the threshold pinned to half the supply. State: the analog input `Vin` (drive it
as a slow on-screen ramp or sine so the sampling is visible, plus a manual slider), the supply `VCC` (a
control -- it sets both the rail and the threshold), the clock `clk` (free-running, or a step button), the
previous clock level, and the held bit `q`.

```js
var Vth = VCC/2;                                           // the internal half-rail reference
if (clk === 1 && clkPrev === 0) q = (Vin > Vth) ? 1 : 0;   // SAMPLE + QUANTIZE on the rising edge
clkPrev = clk;
// Q = q ? VCC : 0 (push-pull) ; Vin is sensed (no load) ; between edges q is held
```

Expose on the model record `s`: `Vin`, `Vth` (= VCC/2), `VCC`, `clk`, `q`, whether this frame was a
sampling edge. A brief metastable hint (Vin very close to ½·VCC at the edge takes longer to resolve) is
nice but keep it light. Flag the time base as a scaled teaching animation.

## 5. The five-tier arc

**Tier 1 -- symbol + pinout + scope.** The quantizer symbol (a comparator triangle with a clock notch
reads well) on the CEC1041 5-pin pinout, the ½·VCC threshold marked, plus a plain note ("on CLK rising:
Q = 1 if IN > ½·VCC, else 0; held until the next edge"). Scope = the timing diagram (section 7).

**Tier 2 -- flow network (analogy, build rich).** The **sample-and-hold dipper**: a scoop on the clock arm
dips into the input reservoir once per tick, grabs the current level, compares it to the **½·VCC mark**,
and holds the resulting bit on Q until the next dip. SAMPLE (only at the tick) and QUANTIZE (above/below
the mark) as plumbing.

**Tier 3 -- pressure-pilot valves (analogy, build rich).** The comparison as a **pressure-pilot balance**
(IN pressure versus the ½·VCC reference), admitted only when the **clock gate** opens on the tick, the
result held in a detented latch. The clocked-capture mechanism as valves, not a schematic.

**Tier 4 -- real device (the actual transistors; no basic symbols).** The clocked comparator as real,
correctly-typed MOSFETs via the §7.4 helper: the on-chip **½·VCC reference divider** (two matched
resistors), the **NMOS diff pair (M1/M2)** comparing **IN** to that ½·VCC tap, feeding the **cross-coupled
sense latch as its four explicit transistors (NMOS M3/M4 + PMOS M5/M6)** over the **CLK-gated NMOS tail
(M7)**, into the push-pull output buffer holding Q. Animate from the model: the winning side conducts, the
tail fires on the clock edge, the captured node holds between edges. Lift from `comparator-ic.html` tier 4
(CLK for LE, the ½·VCC tap for VN).

**Tier 5 -- silicon (real cross-sections).** The diff pair and the cross-coupled sense latch as **real MOS
cross-sections** (poly over thin oxide, n+/p+ in the well/substrate), the matched diff-pair geometry, the
cross-coupled cell that is the same silicon that stores a bit in an SRAM/flip-flop. Reuse
`comparator-ic.html` tier 5. Real structures, not a block diagram. Closing note: a flash ADC tiles this
slice down a reference ladder.

## 6. Sim backend mapping (already wired -- the glyph just needs to agree)

The game's `SAMP` part is live: `ELEM_SAMPLER` (sim type 22), pins **a=OUT, b=IN, c=CLK**, `value` = the
comparison threshold (V), `aux` = the output logic-high rail. The CEC1041 is exactly this with the
**threshold wired to ½·rail** (the catalogue says so), and the rail = VCC. It is an edge-triggered 1-bit
comparator; **IN is a high-Z sense node** (not driven, no Newton current). (The sim element is the 3-signal
core, OUT/IN/CLK; the CEC1041 chip adds the explicit VCC/GND pins and the on-chip ½·VCC reference the
glyph teaches -- the same atom, drawn as the full house part.) Tier 4's schematic should match: diff pair
compares IN to ½·VCC, the clock captures, the output holds.

## 7. Controls and scope

- **Controls:** an **IN** source (a slow ramp or sine is best so the sampling is visible, plus a manual
  slider), a **VCC** control (it sets the rail AND the ½·VCC threshold -- show the threshold line move with
  it), and a **CLK** (free-running clock, with a single-step button as a nice extra). Drop any gate-style
  logic-input sliders; there is no separate threshold control (it is ½·VCC by construction).
- **Scope -- the sampling timing diagram (the payoff).** Plot **IN** (the analog ramp/sine) with the
  **½·VCC** level as a dashed line, the **CLK** trace beneath it, and **Q** (the held bit) on a shared time
  axis -- Q updating only on each rising edge to whichever side of ½·VCC the input was at that instant,
  then holding flat. The iconic picture of 1-bit quantization: a staircase of held decisions against the
  smooth input. Moving VCC (and so the threshold) and the clock rate visibly changes which samples read
  high. (Optional second view: several stacked thresholds to suggest the flash-ADC ladder.)

## 8. House style and validation (all must pass before handback)

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** on line 1: `<!-- SPDX-License-Identifier: Apache-2.0 -->`.
- **Design tokens / fonts / CSS:** copy verbatim from `dff-ic.html` (the `--bg`/`--surface`/`--accent`/
  signal tokens; do not hardcode colors). Saira / Saira Condensed / IBM Plex Mono. Keep the Critical Error
  house brand mark; this is a CEC house part.
- **Forbidden glyphs** (the §10 python check must report `none` and `0`): em-dash (U+2014), en-dash
  (U+2013), arrows (U+2192 / U+2190 / U+2194), the minus sign (U+2212), smart quotes
  (U+2018/2019/201C/201D), and the entities `&mdash;`/`&ndash;`. Use the ASCII hyphen-minus; write
  "IN > ½·VCC" with the ASCII greater-than (the fraction ½ and middle dot · are allowed), ranges as
  "1.8 V to 15 V", and "to" instead of an arrow. Watch the device labels and net names.
- **§10 gates:** (1) `node --check` on the extracted script; (2) the forbidden-glyph python check;
  (3) `grep -c "drawPkg(gT"` must be **5**; (4) per-tier member consistency (every `tN.member` read in
  `updateTN` is created in `buildTN`); (5) a **Playwright render of all five tiers** with the
  console/page-error listener (mandatory). Sweep IN through ½·VCC and run the clock in every tier;
  screenshot and fix any collision or off-canvas label.

## 9. Handback checklist

Flag in the handback:

- **CEC house identity:** `chipType` / title / lede / device-tier name / `names` map all read CEC1041 /
  clocked quantizer; the house brand mark is present; NO real-manufacturer part name appears; the pinout
  is the CEC house order (Q on pin 1).
- **Real devices in the realistic view, no basic symbols:** tier 4 draws the clocked comparator as actual
  correctly-typed MOSFETs (the ½·VCC reference divider, the NMOS diff pair comparing IN to ½·VCC, the
  four-device cross-coupled sense latch, the CLK-gated tail, the push-pull output) via the §7.4 helper;
  tier 5 is real MOS cross-sections.
- **Analogy tiers kept:** tiers 2-3 still tell the sample-and-hold-dipper / pressure-pilot-valve story.
- **The arc lands:** the timing-diagram scope shows Q capturing one bit per rising edge and holding it, the
  threshold pinned at ½·VCC (and moving with VCC), IN shown as a sense node (no load), and the flash-ADC
  framing appears at least once.
- **Sim agreement noted:** `ELEM_SAMPLER`, OUT/IN/CLK, threshold = ½·rail, rail = `aux`, IN high-Z sense,
  rising-edge capture.
- **All §10 gates pass clean**, including the mandatory five-tier Playwright render with no console/page
  errors and no off-canvas or colliding labels.

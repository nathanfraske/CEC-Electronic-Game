<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: CEC1108 3-bit SAR ADC, five-tier IC glyph

A standalone brief for the design agent. Build a five-tier IC glyph for the **CEC1108 3-Bit SAR ADC** --
the successive-approximation converter, a binary search done by one comparator, an R-2R DAC, and a 3-bit
register in a feedback loop. It is the sequential cousin of the CEC1080 flash ADC (same code, one
comparator instead of seven, N clocks instead of one). Read this top to bottom. Infrastructure:
**`ic-glyph-spec.md`** (§1 tier zoom-pairs + FET-level analogy); part spec: the **CEC Foundations
catalogue** (`cec-teaching-ics.md`, in the kit).

**This brief is written to be unusually explicit about HOW EACH TIER SHOULD LOOK** -- composition, what
sits where, what moves, colors, and the animation -- because the SAR is a *loop* and the payoff is seeing
the search converge. Treat the "how it looks" paragraphs as the spec, not suggestions. When in doubt,
prefer clarity of the loop and the convergence over packing detail.

- **Output file:** `docs/ui/parts/sar-adc-ic.html`
- **`<title>`:** `SAR ADC, five layers`. Header `chipType` = **CEC1108**; the `<h1 class="lede">`,
  device-tier name, and `names` map all read CEC1108 / SAR ADC. CEC house part: no real-manufacturer name.
  Grep for stale strings; update the model COMMENT block.
- **Canvas:** standard 780x540 is the target; you MAY go modestly larger (up to ~900x640) if the loop
  gets cramped, but this is far lighter than the flash ADC -- do not oversize it. Keep the scope sidebar.

**Reference sheets in the kit:** **`comparator-ic.html`** (PART 3) -- the SAR's one comparator (reuse its
symbol + diff-pair FET-valve analogy + silicon). **`dac-ic.html`** (PART 4) -- the SAR's feedback DAC
(the CEC1083 R-2R ladder that makes the trial voltage; reuse its ladder drawing). **`dff-ic.html`**
(PART 5) -- the SAR register's flip-flops and the timing-diagram scope. (The CEC1080 flash ADC is the
contrast to name in prose -- parallel vs sequential -- but it is not in this kit.)

---

## 0. The one idea

**Successive approximation is a binary search for a voltage.** Instead of comparing against every level at
once (flash), the SAR makes ONE comparator do the work over several clocks: it guesses the most-significant
bit, builds that guess into a trial voltage with a DAC, compares it to VIN, and **keeps the bit if VIN is
still higher, drops it if not** -- then moves to the next bit. Three guesses pin a 3-bit code; N guesses an
N-bit one. One comparator and a DAC, the speed-for-parts opposite of flash. Every tier shows the same
loop: **guess a bit, make it a voltage, compare, keep or drop, repeat -- closing in on VIN.**

## 1. The architecture and the exact search (tier 4 must match this)

Four blocks in a **loop**:
- **Comparator:** `+` = VIN, `-` = the DAC output. Its result each clock is "VIN above the trial?"
- **SAR register + control:** a 3-bit register and a small controller. It drives the trial code MSB-first
  and uses the comparator result to keep or clear the bit under test.
- **DAC (R-2R):** the CEC1083 ladder; turns the current trial code into the trial voltage = code/8 * VCC.
- The loop: register -> DAC -> comparator(-); VIN -> comparator(+); comparator -> control -> register.

The exact 3-bit search (MSB-first), one bit per CLK rising edge:
1. **Try D2:** set code = 100 (4). DAC = 4/8 * VCC = VCC/2. If VIN > DAC keep D2 = 1, else D2 = 0.
2. **Try D1:** set code = (D2,1,0) i.e. add 010. DAC = (D2*4 + 2)/8 * VCC. If VIN > DAC keep D1, else clear.
3. **Try D0:** add 001. DAC = (D2*4 + D1*2 + 1)/8 * VCC. If VIN > DAC keep D0, else clear.
4. **DONE** pulses; the register holds the final code = floor(8 * VIN / VCC), clamped 0..7.

So the DAC trial steps VCC/2, then +/- VCC/4, then +/- VCC/8 -- halving the search interval each clock,
homing in on VIN. (Same final code as the CEC1080 flash, reached in 3 clocks with 1 comparator.)

## 2. Pinout (shared by all five tiers)

**8-pin (SOT-23-8 / MSOP-8):**

| Pin | Name | Function | Connection contract |
|---|---|---|---|
| 1 | **VIN** | analog input (sensed, high-Z) | comparator `+` |
| 2 | **CLK** | conversion clock (one bit per rising edge) | the SAR controller |
| 3 | **D2** | result bit 2 (MSB) | SAR register, also to the DAC MSB |
| 4 | **D1** | result bit 1 | SAR register / DAC |
| 5 | **D0** | result bit 0 (LSB) | SAR register / DAC |
| 6 | **DONE** | end-of-conversion (high when the result is valid) | the controller |
| 7 | **VCC** | supply; the DAC full-scale reference | top rail |
| 8 | **GND** | ground / 0 V | bottom rail |

## 3. The live model (interactive state, per frame)

A clocked binary search. State: VIN (a slider, plus a "convert" trigger), VCC, the bit under test
`step` (2,1,0 then idle), the trial code, and the kept code.

```js
// On each CLK rising edge while converting (step from 2 down to 0):
trial = kept | (1 << step);           // set the bit under test
dac   = (trial / 8) * vcc;            // the DAC trial voltage
if (vin > dac) kept = trial;          // keep the bit ... else leave it cleared
step--;                               // next bit; when step < 0 -> DONE, code = kept
```

Expose on `s`: `vin`, `vcc`, `step` (which bit is being tried), `trial`, `dac`, `kept`, the comparator
result this step, and `done`. Drive a self-running "convert" loop (re-trigger on VIN change) so the search
animates. Scaled teaching animation.

## 4. The five tiers -- composition and exact look

**Tier 1 -- symbol + pinout + the convergence scope. How it looks:** centered, a block labeled
"3-BIT SAR ADC / CEC1108" with VIN (analog ramp lead) and CLK entering left, D2/D1/D0 + DONE leaving
right, VCC/GND top/bottom, on the real pinout. Caption: "successive approximation: 1 comparator, 3 clocks."
The scope (section 5) is the payoff. Keep it calm and legible -- this tier orients.

**Tier 2 -- flow network: the balance (analogy). How it looks:** a **balance scale** centered. **VIN sits
on the left pan** (a fixed weight, drawn from the input). On the right pan the SAR drops **binary trial
weights** in order: a big "4" weight first, then "2", then "1". After each drop, if the right pan is still
lighter than VIN (VIN higher), the weight **stays** (glows kept); if it tips past VIN, the weight is
**lifted off** (greyed). The kept weights spell the code. Animate one weight per clock; show the running
"kept" code as a 3-bit readout under the scale. This is the whole SAR idea as one picture -- guess big,
keep or drop, refine. (The comparator is the balance beam here; it opens up in tier 3.)

**Tier 3 -- pressure-pilot valves: the loop mechanism (zoom of tier 2). How it looks:** open the balance
into the real loop, still mechanical. Left: the **comparator as a diff-pair pressure balance** (reuse
`comparator-ic.html` tier 3) -- VIN pressure vs the DAC trial pressure, its output tipping a way each
clock. Right of it: the **SAR register as a 3-position sequencer** (a stepper that points at D2, then D1,
then D0 on successive clocks) that sets/holds the trial. Below: the **DAC as the R-2R ladder** turning the
trial code into the trial pressure fed back to the comparator. **Draw the feedback loop as a closed cycle**
(comparator -> sequencer -> DAC -> back to comparator) -- the loop is the lesson; make the cycle visually
obvious (a clear ring of connections). Light the active bit and the current trial each step.

**Tier 4 -- real device: the SAR loop schematic. How it looks:** the literal block diagram / schematic of
the loop, laid out as a ring so the feedback reads at a glance:
- **VIN** enters top-left into the **comparator** `+` (draw the comparator symbol, openable to its diff
  pair per the FET-analogy framing; cite `comparator-ic.html`).
- The **comparator output** runs right into the **SAR control + 3-bit register** (three flip-flops, reuse
  the `dff-ic.html` flip-flop symbol, plus a little control logic / a ring counter selecting the bit).
- The **register outputs D2/D1/D0** run down into the **R-2R DAC** (draw the CEC1083 ladder: two R, four
  2R, MSB at the output -- reuse `dac-ic.html`).
- The **DAC output** runs back left/up into the comparator `-` -- closing the loop.
- The register also drives the output pins D2/D1/D0 and the controller drives DONE; VCC/GND rails power
  the comparator, register, and DAC.
Animate from the model: highlight the bit under test, show the trial code on the register and the trial
voltage on the DAC node, and the comparator decision each clock. No stubs: every pin and the whole loop
are wired. This is the tier that matches the sim's SAR loop.

**Tier 5 -- silicon. How it looks:** the three sub-blocks as their real silicon, side by side with a
label each: the **comparator diff-pair** in MOS cross-section (reuse `comparator-ic.html` tier 5), the
**R-2R DAC** as matched resistor strips (reuse `dac-ic.html` tier 5), and the **register** as a
representative flip-flop's CMOS. A caption notes the SAR is a small system on one die: one comparator +
ladder + register, reused over clocks.

## 5. The scope -- the successive-approximation convergence (the payoff)

This is the iconic SAR graphic; make it the centerpiece. Plot, on a shared time axis over the 3 clocks:
- **VIN** as a flat horizontal reference line.
- the **DAC trial voltage** as a stepped trace that starts at VCC/2, then jumps by VCC/4, then VCC/8 --
  **homing in on the VIN line** (each step halving the gap), each step labeled with the bit (D2, D1, D0)
  and a keep/drop tag from the comparator.
- the **3-bit code building up** MSB-first beneath it (D2 decided at clock 1, D1 at 2, D0 at 3), with
  **DONE** rising at the end.
The teaching beat: the trace zig-zags in toward VIN and settles on the code. Call out the contrast with
the flash ADC's instant staircase (CEC1080): same code, parallel-and-instant there vs serial-and-searching
here. A "convert" button (or auto-loop) replays the search; moving VIN re-runs it to a new code.

## 6. Sim backend mapping (the loop the glyph should match)

The CEC1108 maps to a `buildNetlist` loop of existing elements -- one `ELEM_COMPARATOR`, the CEC1083 R-2R
DAC, and a 3-bit successive-approximation register/controller driving the DAC from the comparator result
(or a small behavioral SAR program). No new sim-core element. Tier 4 draws exactly that loop. (Functional
wiring of the part is a follow-up to this glyph; the loop and search here are the spec for it. The final
code equals the flash ADC's floor(8 * VIN / VCC).)

## 7. House style, validation, handback

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** line 1. **CSS/fonts/tokens** from the house shell (no hardcoded colors); Saira / Saira
  Condensed / IBM Plex Mono; Critical Error brand mark.
- **Forbidden glyphs** (§10 check `none`/`0`): em-dash, en-dash, arrows (U+2192/2190/2194), the minus sign
  (U+2212), smart quotes, `&mdash;`/`&ndash;`. ASCII hyphen-minus and "to"; middle dot `·` fine; write
  "VIN > DAC" with the ASCII greater-than and "VCC/2" as a fraction.
- **§10 gates:** (1) `node --check`; (2) forbidden-glyph check; (3) `grep -c "drawPkg(gT"` = **5**;
  (4) per-tier member consistency; (5) a **Playwright render of all five tiers** (mandatory) -- run a
  conversion and confirm the trial trace converges on VIN over 3 clocks, the code builds MSB-first, and
  DONE rises; screenshot each tier and fix collisions / off-canvas labels. If you cannot run the render,
  say so.
- **Handback checklist:**
  - **The loop is the star:** tiers 3 and 4 show the closed comparator -> register -> DAC -> comparator
    cycle, drawn so the feedback reads at a glance; the active bit and the trial are animated.
  - **Search exact:** MSB-first keep/drop over 3 clocks; DAC trial steps VCC/2, VCC/4, VCC/8; final code =
    floor(8*VIN/VCC). Tier 4 matches the sim loop; the DAC sub-block is the CEC1083 R-2R ladder.
  - **Convergence scope** is the centerpiece (trial zig-zagging onto VIN, code building, DONE), with the
    flash-vs-SAR contrast called out.
  - **No stubs;** sub-blocks cite the comparator / DAC / flip-flop sheets; FET-analogy depth on the
    comparator, resistor honesty on the DAC.
  - **CEC identity:** chipType/title/lede/device-tier/`names` = CEC1108 / SAR ADC; brand mark; no
    real-manufacturer name; pinout per the catalogue.
  - **All §10 gates pass clean** (or the render is flagged for the owner).

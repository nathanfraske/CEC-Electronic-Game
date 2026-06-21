<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: clocked sampler (the ADC atom), five-tier IC glyph

A standalone brief for the design agent. Build a five-tier IC glyph for the **clocked sampler** (the
game's `SAMP` part) -- a 1-bit clocked comparator, the keystone atom of an analog-to-digital converter.
Read this top to bottom. For the verbatim house infrastructure (CSS, fonts, helpers, scope chrome, frame
loop) and the exact validation commands, follow **`ic-glyph-spec.md`**.

**You are not starting from scratch -- two existing sheets do most of the work:**

- **`dff-ic.html` is the shell base.** It already has a **timing-diagram scope** (the sampler's scope is
  a timing trace, not a static transfer curve) and the **edge-triggered capture** mechanism (the sampler
  SAMPLES on the rising clock edge and HOLDS between edges, exactly like the D flip-flop). Take its CSS,
  fonts, helpers, scope chrome, and frame loop.
- **`comparator-ic.html` is the device reference.** The sampler's front end IS a comparator (it decides
  IN vs a threshold), and its hold element is a clock-driven regenerative latch -- the same diff-pair +
  cross-coupled sense latch that sheet now draws as real transistors in tiers 4 and 5. The sampler's
  realistic tiers are that schematic with **VN replaced by the internal threshold reference** and **LE
  replaced by CLK**. Lift it.

- **Output file:** `docs/ui/parts/sampler-ic.html`
- **`<title>`:** `Clocked sampler, five layers` -- set this correctly; make the `<h1 class="lede">`, the
  header `chipType`, the device-tier part name, and the `names` map all read **clocked sampler** (see the
  part-identity note in section 2). Grep the finished file for stale template strings ("D flip-flop",
  "comparator", "ADCMP601", "Q latched", "74") before handing back, since you start from those two sheets.

---

## 0. The one idea

**A clocked sampler is the atom of analog-to-digital conversion: SAMPLE plus QUANTIZE, once per clock
edge.** On each rising edge of CLK it freezes the analog input (SAMPLE) and decides which side of a fixed
threshold it fell on (QUANTIZE), latching a single bit -- high if IN is above the threshold, low if below
-- and holds that bit on OUT until the next edge. Between edges it ignores the input. Those are the two
irreducible halves of digitising a signal. **Stack N of these at staggered thresholds (a resistor-ladder
of references) and you have a flash ADC**; put one in a feedback loop with a DAC and you have the heart of
a successive-approximation converter. Every tier should carry that arc: **an analog input, a threshold, a
clock edge that captures one bit and holds it.**

## 1. The real-device mandate (same split as the comparator/switch sheets)

- **Tiers 2-3 (the analogy view) are intentional abstraction -- build them rich, do not schematize.** The
  sampler as a **sample-and-hold dipper** that scoops the input level on the clock tick and a comparison
  against a threshold mark (tier 2), and as **pressure-pilot valves** -- the comparison balance plus the
  clock-gated capture (tier 3). The only rule: no lazy basic-symbol shortcut standing in for the mechanism.
- **Tiers 4-5 (the realistic view) must be the ACTUAL devices, correctly typed -- no basic symbols.** The
  real device is a **clocked comparator**: a real **NMOS differential pair** (IN on one gate, the
  threshold reference on the other) feeding a **CLK-clocked regenerative cross-coupled sense latch** drawn
  as its **four explicit transistors** (NMOS pair + PMOS pair), over a **CLK-gated NMOS tail**, into an
  output buffer that holds the captured bit. Every transistor via the spec's **§7.4 `mosfet` helper**,
  correctly typed (PMOS = gate bubble), labeled. **Tier 5 is real MOS cross-sections** (the diff pair +
  the sense latch on the die), not a block diagram. This is exactly `comparator-ic.html` tiers 4-5 with
  CLK driving the latch and one input being the on-chip threshold reference -- reuse that work.

## 2. The part and its real internal cell

- **Part identity.** The sampler is an architectural ATOM, not a standalone catalogue chip with a fixed
  3-pin package -- so name it the **clocked sampler / 1-bit ADC comparator slice**, and in the device
  tier draw it as **one comparator slice of a flash ADC**. Note in the footnote that real embodiments are
  (a) a **latched comparator** (the ADCMP-class part, clocked continuously -- the sampler is literally
  that with CLK as its latch clock) and (b) **one of the N comparators inside a flash ADC**, each tied to
  a tap of a reference resistor ladder. Do NOT invent a fake commercial 3-pin pinout; the three signals
  OUT / IN / CLK plus the on-chip threshold reference are the teaching contract.
- **The real internal cell (draw this in tiers 4-5):**
  1. **Input differential pair -- two matched NMOS (M1/M2).** One gate is **IN**, the other the on-chip
     **threshold reference Vth** (shown coming from a resistor-ladder tap -- the flash-ADC ladder).
  2. **Regenerative cross-coupled sense latch -- NMOS pair (M3/M4) + PMOS pair (M5/M6)**, the four
     explicit transistors, outputs cross-wired (the positive-feedback cell that slams the small IN-vs-Vth
     difference to a full bit).
  3. **Clock (sample) switch -- one NMOS (M7) gated by CLK.** The rising edge fires the latch (SAMPLE);
     between edges the tail is off and the captured node is held (HOLD).
  4. **Output buffer** that drives OUT to the rail (`aux`, default 5 V) or ground, holding the bit.
- **Device family:** all **CMOS** -- the sense-amp comparator is the canonical real implementation and
  reuses the §7.4 helper. (A flash ADC's comparators are exactly these clocked sense-amp latches.)

## 3. Package frame and pinout (shared by all five tiers)

Three signals, drawn on a clean teaching layout (a small DIP/SOT-style frame is fine -- this is an atom,
not a specific package). The threshold is an internal reference, set by the part's `value`, shown in the
device tier as a ladder tap (not a pin).

| Pin | Name | Function | Connection contract |
|---|---|---|---|
| - | **IN** | analog input (sensed, **high-Z -- draws ~no current**) | right input, into the diff pair (M1 gate) |
| - | **CLK** | sample clock; the **rising edge** captures one bit | the sense latch's clock (M7 gate) |
| - | **OUT** | the latched 1-bit result, held between edges | the output node + the live OUT readout |

Adapt `drawPkg` per `ic-glyph-spec.md` §7.3 for the 3-lead teaching frame; set `chipType` (clocked
sampler / ADC slice) and the `names` map. Stress that **IN is a sense node, not a load** (the spec's
sampler engages no Newton current on IN).

## 4. The live model (interactive state, per frame)

A clocked sampler. State: the analog input `Vin` (drive it as a slow on-screen ramp or sine so the
sampling is visible, with a manual override slider), the threshold `Vth` (a control), the clock `clk`
(free-running, or a step button), the previous clock level (edge detect), and the held bit `q`.

```js
// rising-edge capture: SAMPLE Vin, QUANTIZE against Vth, latch one bit; HOLD between edges
if (clk === 1 && clkPrev === 0) q = (Vin > Vth) ? 1 : 0;   // sample + quantize on the rising edge
clkPrev = clk;
// OUT = q ? rail : 0 ; Vin is sensed (no load) ; between edges q is unchanged (hold)
```

Expose on the model record `s`: `Vin`, `Vth`, `clk`, `q`, whether this frame was a sampling edge, and the
output rail. The metastable case (Vin very close to Vth at the edge) is worth a brief visual (the latch
takes longer to resolve) but keep it light. Flag the time base as a scaled teaching animation.

## 5. The five-tier arc

**Tier 1 -- symbol + pinout + scope.** The comparator/sampler symbol (a comparator triangle with a clock
notch on it reads well) wired to OUT / IN / CLK, the threshold marked, plus a plain-language note ("on the
clock edge: OUT = 1 if IN > Vth, else 0; held until the next edge"). The scope is the timing diagram
(section 7).

**Tier 2 -- flow network (analogy, build rich).** The **sample-and-hold dipper**: a scoop on the clock
arm dips into the input reservoir once per tick and grabs the current level; that captured level is
compared to a fixed **threshold mark**; the resulting bit is held on the output until the next dip.
SAMPLE (only at the tick) and QUANTIZE (above/below the mark) shown as plumbing.

**Tier 3 -- pressure-pilot valves (analogy, build rich).** The comparison as a **pressure-pilot balance**
(IN pressure versus the threshold reference), admitted only when the **clock gate** opens on the tick, the
result held in a detented latch. The clocked-capture mechanism as valves -- not a schematic.

**Tier 4 -- real device (the actual transistors; no basic symbols).** The clocked comparator as real,
correctly-typed MOSFETs via the §7.4 helper: the **NMOS diff pair (M1/M2)** comparing **IN** to the
**threshold reference** (drawn from a resistor-ladder tap -- the flash-ADC context), feeding the
**cross-coupled sense latch as its four explicit transistors (NMOS M3/M4 + PMOS M5/M6)** over the
**CLK-gated NMOS tail (M7)**, into the output buffer holding OUT. Animate from the model: the winning side
conducts, the tail fires on the clock edge, the captured node holds between edges. This is the tier that
answers the brief -- lift it from `comparator-ic.html` tier 4 (CLK for LE, Vth for VN).

**Tier 5 -- silicon (real cross-sections).** The diff pair and the cross-coupled sense latch as **real MOS
cross-sections** (poly over thin oxide, n+/p+ in the well/substrate), the matched diff-pair geometry, the
cross-coupled cell that is the same silicon that stores a bit in an SRAM/flip-flop. Reuse
`comparator-ic.html` tier 5. Real structures, not a block diagram. A nice closing note: a flash ADC tiles
this slice N times down a reference ladder.

## 6. Sim backend mapping (already wired -- the glyph just needs to agree)

The `SAMP` part is live: `ELEM_SAMPLER` (sim type 22), pins **a=OUT, b=IN, c=CLK**, `value` = the
**comparison threshold** (V), `aux` = the **output logic-high rail** (default 5 V). It is an
**edge-triggered 1-bit comparator**: on the rising CLK edge it latches `IN > Vth` onto OUT and holds it;
**IN is a high-Z sense node** (not driven, draws no current, engages no Newton). Tier 4's schematic should
match that (diff pair compares IN to Vth, clock captures, output holds). The spec notes "a flash ADC is N
samplers at staggered thresholds" -- echo that framing.

## 7. Controls and scope

- **Controls:** an **IN** source (a slow ramp or sine is best so the sampling is visible, plus a manual
  slider), a **threshold Vth** control, and a **CLK** (free-running clock, with a single-step button as a
  nice extra). An output-rail control is optional. Drop any gate-style logic-input sliders.
- **Scope -- the sampling timing diagram (the payoff).** Plot **IN** (the analog ramp/sine) with the
  **Vth** level drawn as a dashed line, the **CLK** trace beneath it, and **OUT** (the held bit) on a
  shared time axis -- OUT updating only on each rising edge to whichever side of Vth the input was at that
  instant, then holding flat. This is the iconic picture of 1-bit quantization: the staircase of held
  decisions against the smooth input. Make moving Vth and the clock rate visibly change which samples read
  high. (An optional second view: several stacked thresholds to suggest the flash-ADC ladder.)

## 8. House style and validation (all must pass before handback)

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** on line 1: `<!-- SPDX-License-Identifier: Apache-2.0 -->`.
- **Design tokens / fonts / CSS:** copy verbatim from `dff-ic.html` (the `--bg`/`--surface`/`--accent`/
  signal tokens; do not hardcode colors). Saira / Saira Condensed / IBM Plex Mono.
- **Forbidden glyphs** (the §10 python check must report `none` and `0`): em-dash (U+2014), en-dash
  (U+2013), arrows (U+2192 / U+2190 / U+2194), the minus sign (U+2212), smart quotes
  (U+2018/2019/201C/201D), and the entities `&mdash;`/`&ndash;`. Use the ASCII hyphen-minus; write
  "IN > Vth" with the ASCII greater-than, ranges as "0 V to VCC", and "to" instead of an arrow; the
  middle dot `·`/`&middot;` and `*`/`&times;` are allowed. Watch the device labels and net names.
- **§10 gates:** (1) `node --check` on the extracted script; (2) the forbidden-glyph python check;
  (3) `grep -c "drawPkg(gT"` must be **5**; (4) per-tier member consistency (every `tN.member` read in
  `updateTN` is created in `buildTN`); (5) a **Playwright render of all five tiers** with the
  console/page-error listener (mandatory). Sweep IN through Vth and run the clock in every tier;
  screenshot and fix any collision or off-canvas label.

## 9. Handback checklist

Flag in the handback:

- **Real devices in the realistic view, no basic symbols:** tier 4 draws the clocked comparator as actual
  correctly-typed MOSFETs (NMOS diff pair comparing IN to Vth, four-device cross-coupled sense latch,
  CLK-gated tail, real output buffer) via the §7.4 helper; tier 5 is real MOS cross-sections.
- **Analogy tiers kept:** tiers 2-3 still tell the sample-and-hold-dipper / pressure-pilot-valve story,
  not a schematic.
- **The arc lands:** the timing-diagram scope shows OUT capturing one bit per rising edge and holding it,
  the SAMPLE-and-QUANTIZE split is explicit, IN is shown as a sense node (no load), and the flash-ADC
  framing (N slices on a ladder) appears at least once.
- **Identity clean:** title / lede / `chipType` / device-tier name / `names` map all read clocked sampler;
  grep for stray "D flip-flop", "comparator", "ADCMP601", "74", "Q latched" from the base sheets.
- **Sim agreement noted:** `ELEM_SAMPLER`, OUT/IN/CLK, threshold = `value`, rail = `aux`, IN high-Z sense,
  rising-edge capture.
- **All §10 gates pass clean**, including the mandatory five-tier Playwright render with no console/page
  errors and no off-canvas or colliding labels.

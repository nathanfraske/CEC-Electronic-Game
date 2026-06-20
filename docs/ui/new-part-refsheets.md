<!-- SPDX-License-Identifier: Apache-2.0 -->

# New-part refsheets: per-part authoring cards

The **WHAT-to-build** companion to `ic-glyph-spec.md` (the HOW). For every new
component on the reality roadmap, this gives the owner a design card so an IC-glyph
refsheet starts from hooks, not a blank page: a real exemplar to model the
package/pinout on, a five-tier arc tuned to **this** device, the governing relation
for the equation tier, the tier/variant axes worth showing, and the one to three
concepts the part teaches best.

## How this doc pairs

- **`ic-glyph-spec.md`** is the build spec: the five fixed tiers
  (symbol -> flow -> valves -> device -> silicon), the OKLCH house style, the shared
  `drawPkg` package frame, the verbatim helper library, the device-model scaffold, and
  the validation gates (its section 10). Read it before building any glyph. **This doc
  does not restate it** -- it only says, per part, what each tier should depict.
- **`reality-roadmap.md`** is the scope: which parts are coming, the build arc (compose
  first, then the clocked-sampler keystone, then the cascade), and the determinism
  guardrails. The cards below cross-reference its mechanisms (the **clocked sampler**,
  the rating->FAIL path, the external-input channel) so each refsheet's behaviour matches
  how the part will actually be simulated.
- **Precedent for non-IC parts.** Several roadmap parts are discrete or two/three-terminal,
  not logic ICs. The existing **per-kind tier studies** in `docs/ui/parts/` are the model
  for those: `resistor-tiers.html`, `capacitor-ceramic-tiers.html`,
  `capacitor-electrolytic-tiers.html`, `inductor-tiers.html`, `transformer-tiers.html`,
  `diode-factory.html`, `diode-tier2-study.html`, `zener-tier2.html`, `varistor-tiers.html`,
  `mosfet-tiers.html`, `mosfet-pmos-tiers.html`, `transistor-tiers.html`, `opamp-tiers.html`.
  The full IC-glyph examples are `inv-ic.html` (canonical template), `buf-ic.html`, `nand-ic.html`,
  `nand3-ic.html`, `nor-ic.html`, `or-ic.html`, `and-ic.html`, `xor-ic.html`, `xnor-ic.html`,
  `xorpass-ic.html`, `imply-ic.html`, `nimply-ic.html`, `schmitt-ic.html` (Schmitt inverter),
  `comparator-ic.html` (ADCMP601, the first analog/boundary part), `dff-ic.html` (74AUP1G79,
  the first **sequential** part — master-slave latches + a live timing diagram), and `jkff-ic.html`
  (CEC3076 JK/T — the D flip-flop with a JK steering front-end; toggle / divide-by-2). When a card below
  says "non-IC: follow the part-study precedent," it means use those, not the five logic-tier arc,
  for the package frame and slider set.

## Two refsheet shapes (pick per part)

The spec's five tiers were authored for a CMOS gate. Most new parts are **not** a single
gate, so adapt the arc, keeping the spec's invariant: the **real package frame is shared by
every tier; only the internals change, and every tier routes to the same pins.**

1. **IC-glyph arc** (a real chip with a pinout): keep the five named tiers but re-read
   each per the card. `symbol` = the part's schematic block; `flow` = its signal/charge
   path as plumbing; `valves` = its switching/gain elements as pilot valves; `device` =
   the transistor-level schematic; `silicon` = the die cross-section / process.
2. **Part-study arc** (a discrete or 2-3 terminal part, the `*-tiers.html` shape): a
   zoom from schematic symbol down to physics, over the real package, with the
   tier/variant axis foregrounded (e.g. the diode family, the cap dielectric). Tier
   count and names are looser here; match the nearest existing study.

**Standing rule (from the spec, restated because it is the easiest to skip):** the
exemplars below are starting points. **Verify the pinout against the datasheet when
authoring** -- `ic-glyph-spec.md` forbids recalling pinouts from memory; pull the part
datasheet and cite the package drawing for pin order and the revision in the footnote.
ASCII-only labels, OKLCH palette, the three named fonts, and the spec's validation gates
apply to every sheet.

---

# Verified minimum-pin exemplars (datasheet-checked)

The smallest single-function REAL chip for each part, confirmed by extracting the
manufacturer datasheet PDFs (these supersede any suggestion in the cards below).
RE-VERIFY each pinout against the datasheet PDF when authoring (per section 10) -- two
intermediate fetches hallucinated pins (a phantom Q-bar on the 1G80, a wrong ADC pin
count), so trust the PDF connection diagram + pin-function table over any summary.

| Part | Min-pin chip (backup) | Package . pins | Interface | Sim backend |
|---|---|---|---|---|
| Plain comparator | ADCMP600 (TLV3201) | SC70-5 . 5 | analog | ELEM_COMPARATOR (LE unwired) |
| Latched comparator | ADCMP601 | SC70-6 . 6 | analog | ELEM_COMPARATOR (done) |
| Schmitt inverter | 74LVC1G14 (74AUP1G14) | SC70-5 . 5 (1 NC) | logic | ELEM_GATE / comparator hyst |
| 555 timer | NE555 (LMC555 / TLC555 CMOS) | DIP-8 / SOIC-8 . 8 | mixed | composition |
| D flip-flop | 74LVC1G80 (inv) / 74AUP1G79 (non-inv) | SOT-23-5 . 5 | logic | ELEM_DFF (done) |
| D-FF + Qn/set/reset | 74LVC1G74 | SC70-8 . 8 | logic | ELEM_DFF |
| JK / T flip-flop | none single; dual 74x112 (house single = CEC3076) | DIP/SO . 16 | logic | ELEM_DFF + steering |
| SAR ADC | ADC081S021 (MCP3201) | SOT-23-6 . 6 | SPI | protocol engine (later) |
| DAC | MCP4725 (DAC081S101) | SOT-23-6 . 6 | I2C / SPI | protocol engine (later) |
| Counter | 74HC4040 | DIP/SO . 16 | parallel | ELEM_DFF composition |
| Shift register | 74HC595 | DIP/SO . 16 | serial-in/parallel-out | ELEM_DFF composition |

**Pinouts (datasheet-verified pin order):**

- **ADCMP600** (5): 1 Q | 2 GND | 3 VP/IN+ | 4 VN/IN- | 5 VCC
- **ADCMP601** (6): 1 Q | 2 VEE | 3 VP/IN+ | 4 VN/IN- | 5 LE/HYS | 6 VCC
- **74LVC1G14** (5): 1 NC | 2 A/IN | 3 GND | 4 Y/OUT | 5 VCC
- **NE555 / LMC555 / TLC555** (8, identical pinout across all variants, TI datasheet-verified):
  1 GND | 2 TRIG (fires at 1/3 VCC) | 3 OUT | 4 !RESET (active-low) | 5 CTRL (control voltage) |
  6 THRES (resets at 2/3 VCC) | 7 DISCH | 8 VCC
- **74LVC1G80** (5, inverting; 74AUP1G79 = non-inverting, same pin order): 1 D | 2 CP | 3 GND | 4 Q | 5 VCC
- **74LVC1G74** (8, full FF): D, CP, SD (set), RD (reset), Q, Qn, VCC, GND
- **ADC081S021** (6, SPI): 1 VA | 2 GND | 3 VIN | 4 SCLK | 5 SDATA | 6 CS
- **MCP4725** (6, I2C): 1 VOUT | 2 VSS | 3 VDD | 4 SDA | 5 SCL | 6 A0
- **DAC081S101** (6, SPI): 1 VOUT | 2 GND | 3 VA | 4 DIN | 5 SCLK | 6 SYNC
- **74HC4040** (16): 1 CP | 2 MR | 3-7 Q0-Q4 | 8 GND | 9-15 Q5-Q11 | 16 VCC
- **74HC595** (16): 1-7 Q1-Q7 | 8 GND | 9 Q7S | 10 MR | 11 SHCP | 12 STCP | 13 OE | 14 DS | 15 Q0 | 16 VCC

**Honest-minimum note.** A multi-bit counter / shift register has no small single-function
form (every bit is a parallel pin); the minimum-pin teaching primitive for both is the
single D flip-flop (74LVC1G80, 5-pin): Qn->D makes a divide-by-2 counter stage, D-in/Q-out
makes a 1-bit shift stage, and the 16-pin parts are that one stage tapped N deep. Likewise
the minimum-pin ADC/DAC are SERIAL (SPI/I2C) and need the protocol engine; the parallel
flash ADC (comparators + encoder) and R-2R DAC (resistor ladder) are the no-new-backend
teaching builds. And the CEC house-brand teaching ICs in `cec-teaching-ics.md` cover the
gaps where no clean minimum-pin real part exists (e.g. the 1-bit clocked quantizer).

---

# First-arc parts (build thoroughly)

These are the roadmap's "recommended first arc": the zero-core-code composition wins, the
clocked-sampler keystone (ADC/DAC), and the cascade that falls out (comparator/Schmitt, 555,
FF types, switched-cap). Each gets a full card.

---

## Comparator / Schmitt trigger

**Part + real exemplar(s).** Open-loop comparator: **LM393** (dual) / **LM339** (quad),
open-collector output, the canonical jellybean. Push-pull rail-to-rail alternative:
**TLV3201**. Schmitt-input logic gate (built-in hysteresis, no external feedback):
**74HC14** hex inverting Schmitt, or **SN74LVC1G17** single non-inverting Schmitt buffer.
*Verify the pinout against the datasheet when authoring.*

**Package / pinout sketch.** LM393 in SOIC-8 / DIP-8: 1 OUT_A, 2 IN_A-, 3 IN_A+, 4 GND,
5 IN_B+, 6 IN_B-, 7 OUT_B, 8 VCC. 74HC14 in SOIC-14 / DIP-14: six inverters, pin 7 GND,
pin 14 VCC, inputs/outputs alternating. SN74LVC1G17 in SOT-23-5: reuse the inverter frame
(1 NC or per datasheet, 2 A, 3 GND, 4 Y, 5 VCC -- confirm). *Confirm before drawing.*

**The five-tier arc.**
- **symbol:** the comparator triangle with + and - inputs and one output; for the Schmitt
  part, the gate symbol with the **hysteresis-loop glyph** inside the body. Show the two
  thresholds V_t+ and V_t- as a band, not one line.
- **flow:** a balance/see-saw -- the two inputs are pan heights; the output snaps fully to
  one rail the instant one pan outweighs the other. For the Schmitt, draw the snap-back
  band so the tip-over point moves depending on which way it last fell (the memory).
- **valves:** the input long-tailed pair as two pilot valves sharing a tail-current source;
  the imbalance steers the tail current to one side, which slams the output stage open or
  shut. Open-collector vs push-pull is the **output-stage** valve set (a single pull-down to
  GND that needs an external pull-up, vs a complementary pair).
- **device:** the differential input pair (two BJTs or MOSFETs, common tail), a current
  mirror as the active load, and the output transistor. For the Schmitt, show the positive
  feedback path (output tapped back to the + input through a resistor divider) that creates
  the two thresholds.
- **silicon:** bipolar (LM393) or CMOS (TLV/74HC) die; the matched input pair as adjacent
  identical structures (matching is the whole game) and the output stage.

**Model / behaviour.** Open-loop: `Vout = rail_high if V+ > V-, else rail_low`, with a
finite gain ramp through the crossover (reuse the op-amp Newton model at very high gain).
Hysteresis: with positive feedback the trip points split to
`V_t+ = Vref + (Vout_high)*R1/(R1+R2)` and `V_t- = Vref - (Vout_low)*...`; the output state
is **history-dependent**, so it is the first part here that needs a latched bit (the DFF /
clocked-sampler keystone holds it; or model the hysteresis band directly).

**Tiers / variants.** Output stage: **open-collector/open-drain** (wired-OR, needs pull-up;
the I2C-bus enabler in the roadmap) vs **push-pull**. Speed/precision grades (input offset,
propagation delay). Single vs dual vs quad.

**Teaching points.** (1) **Positive feedback and hysteresis** -- why a noisy slow input does
not chatter the output. (2) **Open-collector wired logic** and the pull-up. (3) Comparator
vs op-amp: open-loop, no linear region by design.

---

## 555 timer

**Part + real exemplar(s).** **NE555** (bipolar, the original) and **ICM7555** / **TLC555**
(CMOS, low-power). The canonical analog<->digital teaching IC. *Verify the pinout against the
datasheet when authoring.*

**Package / pinout sketch.** DIP-8 / SOIC-8: 1 GND, 2 TRIG, 3 OUT, 4 RESET, 5 CTRL (control
voltage), 6 THRES (threshold), 7 DISCH (discharge), 8 VCC. (TRIG fires at 1/3 VCC, THRES at
2/3 VCC.) *Confirm pin order before drawing.*

**The five-tier arc.** (This is the spec's own worked example for a non-gate IC -- follow it.)
- **symbol:** the timer block box: the three-resistor divider tap points (1/3 and 2/3 VCC),
  the two comparator inputs, the SR latch, OUT, and DISCH. Astable wiring (R_A, R_B, C
  external) shown as the canonical hookup.
- **flow:** the external timing capacitor's **charge/discharge loop** -- C charges toward VCC
  through R_A+R_B, the upper comparator trips at 2/3 VCC and sets the latch, the discharge
  transistor opens and C drains through R_B until the lower comparator trips at 1/3 VCC and
  resets. The chamber fill level is V_C; the output is the latch state.
- **valves:** the two comparators as pressure-pilot valves watching the 1/3 and 2/3 taps, the
  **SR latch** as a two-state detented mechanism, and the **discharge transistor** as the
  drain valve the latch commands.
- **device:** the internal three 5k resistor ladder (the "555" name), the two comparators
  (long-tailed pairs), the SR flip-flop, the discharge NPN, and the output totem-pole/push-pull
  stage. Bipolar vs CMOS internal differences.
- **silicon:** bipolar process for the NE555 (the matched 5k ladder, the comparator pairs);
  contrast the CMOS 7555 die (much lower Iq, can run faster, no discharge current spike).

**Model / behaviour.** Astable frequency `f = 1.44 / ((R_A + 2*R_B) * C)`; duty
`D = (R_A + R_B)/(R_A + 2*R_B)`. Monostable pulse width `T = 1.1 * R * C`. The latch is the
sequential element -- model on the DFF/SR-latch primitive (roadmap: "more FF types" + the
existing hashed DFF). The two comparator trips are level events on V_C.

**Tiers / variants.** **Bipolar (NE555)** vs **CMOS (7555/TLC555)**: supply range, Iq,
max frequency, output drive, the discharge-current glitch. Astable vs monostable vs
PWM (CTRL pin) wiring as **mode variants** of the same chip.

**Teaching points.** (1) **Comparators + a latch = an oscillator** (the analog/digital bridge).
(2) RC time constants set frequency and duty. (3) The internal voltage divider as a ratiometric
reference (CTRL pin moves the thresholds).

---

## Clocked comparator (latched comparator)

**Part + real exemplar(s).** **TLV3501** (high-speed, with **LATCH** pin) or **MAX9601**;
the strobed/latched comparator is the discrete face of the ADC's sampling instant.
*Verify the pinout against the datasheet when authoring.*

**Package / pinout sketch.** TLV3501 in SOT-23-6 / SOIC-8: IN+, IN-, OUT, VCC, GND, and the
**LATCH/!LATCH** pin that freezes the output on an edge. *Confirm exact pin numbers.*

**The five-tier arc.**
- **symbol:** the comparator triangle plus a clocked **latch** symbol on the output (a D-latch
  fed by the comparator decision, gated by LATCH).
- **flow:** the see-saw of the comparator (as above) whose decision is **sampled and held** on
  the latch edge -- between edges the output is frozen regardless of input wander.
- **valves:** the differential pair steering tail current, feeding a **regenerative latch**
  (cross-coupled pair) that, on the clock edge, snaps to a full rail by positive feedback
  (the same cross-coupled-inverter bistable as the SRAM cell -- cross-reference).
- **device:** the input pair, the track-and-latch stage (cross-coupled transistors with a clock
  switch), and the output buffer. This is literally **one bit-slice of a flash ADC**.
- **silicon:** CMOS die; the matched input pair and the regenerative latch laid out symmetrically.

**Model / behaviour.** Decision `b = (V+ > V-)` is **captured on the clock edge** and held;
this is the **clocked sampler keystone** from the roadmap (generalize the DFF from "latch a bit"
to "latch a comparator decision"). Metastability when inputs are within a hair at the edge -- the
regenerative latch's resolution time is the teaching hook.

**Tiers / variants.** Speed grade (resolution time), latch vs continuous mode, hysteresis option.

**Teaching points.** (1) **The sampling instant** -- a continuous comparison becomes a discrete bit
at the clock edge (the seed of all ADCs). (2) **Regenerative positive feedback** resolves a small
difference to a full bit. (3) **Metastability**.

---

## ADC -- flash and SAR

**Part + real exemplar(s).** Flash (parallel): teach the architecture from a resistor ladder +
comparator bank (no single jellybean; the **inside** of any flash part, e.g. a video-rate ADC).
SAR: **ADC0804** (8-bit, parallel out, classic teaching part) or **MCP3001/MCP3201** (SPI, 10/12-bit,
tiny). Both ride the clocked-sampler keystone. *Verify the pinout against the datasheet when
authoring.*

**Package / pinout sketch.** ADC0804 in DIP-20: CS, RD, WR, CLK_IN, INTR, V_IN(+), V_IN(-),
A_GND, V_REF/2, D_GND, DB0..DB7, CLK_R, VCC. MCP3201 in SOIC-8: V_REF, IN+, IN-, VSS, !CS,
D_OUT, CLK, VDD. *Confirm pin order and the reference pin before drawing.*

**The five-tier arc.**
- **symbol:** the ADC box: analog in, V_REF, clock, and the N-bit digital bus out. Show the
  quantizer staircase glyph (continuous in, stepped out) inside the body.
- **flow (the architecture split -- the most useful tier here):**
  - **Flash:** a **resistor-ladder reference** (2^N taps) feeding **2^N comparators in parallel**,
    all firing at once; a thermometer-to-binary encoder. One clock, one conversion -- fast, big.
  - **SAR:** a single comparator + a DAC in a **binary-search feedback loop**; on each clock the
    SAR register guesses the next bit (MSB first), the DAC plays the guess back, the comparator
    keeps or drops it. N clocks per conversion -- compact, slower. Animate the binary search.
- **valves:** the comparator bank (flash) or the one comparator (SAR) as the decision valves; the
  **sample-and-hold** front end as a clocked input valve (the keystone) that freezes V_IN during
  conversion.
- **device:** flash = ladder + comparator array + encoder logic; SAR = S/H + comparator + SAR
  logic (a shift-register state machine) + the internal DAC (cross-reference the R-2R card).
- **silicon:** the matched resistor ladder and the comparator array (flash) -- area scales as 2^N,
  the reason flash stops at ~8 bits; or the compact SAR die.

**Model / behaviour.** Quantize: `code = round(V_IN / V_REF * (2^N - 1))`, clamped. Flash does it in
**one** clock with 2^N comparators; SAR does it in **N** clocks by binary search. Both are built on the
roadmap's **clocked sampler** ("ADC + DAC on it as the proof... sampling / quantization / Nyquist").
Quantization error is +/- 1/2 LSB; the sample rate sets the Nyquist limit.

**Tiers / variants.** **Architecture** (flash vs SAR vs sigma-delta -- see summary table) as the
primary axis. **Resolution** (bits) and **speed** (samples/s) as grades; the area/speed/power
trade across architectures is the lesson.

**Teaching points.** (1) **Quantization** -- a continuous voltage becomes a finite code, with error.
(2) **Sampling and Nyquist** (cross-reference the two-frequency-regime note in the roadmap / CLAUDE.md:
the time-domain solve aliases above ~62.5 kHz). (3) **Architecture trade-offs** -- flash is fast but
2^N comparators; SAR trades clocks for area.

---

## DAC -- R-2R ladder

**Part + real exemplar(s).** **DAC0808** (8-bit current-output, the textbook R-2R) or **AD558**
(complete voltage-output). The roadmap calls R-2R "a gem" -- zero core code, pure composition.
*Verify the pinout against the datasheet when authoring.*

**Package / pinout sketch.** DAC0808 in DIP-16: A1..A8 (digital inputs, A1 = MSB), V_REF(+),
V_REF(-), I_OUT, COMP, V_EE, V_CC, GND. *Confirm pin order; note the current output.*

**The five-tier arc.**
- **symbol:** the DAC box: N digital input lines, V_REF, analog out; the **inverse staircase** glyph
  (stepped code in, smooth-ish voltage out).
- **flow:** the **R-2R ladder** as a binary current splitter -- at every node the resistance looking
  two ways is equal, so the current halves at each rung; each bit switch routes its rung's current
  either to the output sum or to ground. Animate the current weights 1/2, 1/4, 1/8 ... down the ladder.
- **valves:** the per-bit **SPDT switches** (one per bit) as two-position pilot valves steering each
  binary-weighted current to OUT or GND, commanded by the digital input bits.
- **device:** the resistor ladder (only two resistor values, R and 2R -- the elegance), the bit
  switches (CMOS transmission gates or BJT current steering), and the output op-amp (current-to-voltage,
  the AD558 has it on-die).
- **silicon:** the matched R/2R resistor array (ratio matching is everything; absolute value does not
  matter) and the switch transistors.

**Model / behaviour.** `V_OUT = V_REF * code / 2^N` (or a current `I_OUT` in DAC0808). The R-2R network
needs **only two resistor values** and gives perfectly binary-weighted contributions -- the whole point.
Builds from existing resistor + switch elements (roadmap: "R-2R DAC... zero core code"); pairs with the
SAR ADC, which contains a DAC.

**Tiers / variants.** **Current-output (DAC0808)** vs **voltage-output (AD558)**. Resolution (bits).
Monotonicity / matching grades (resistor tolerance maps to the `resistorTolerance` web-tier axis).

**Teaching points.** (1) **Binary weighting from one repeated motif** -- R-2R needs only two values, vs
a binary-weighted ladder needing 2^N distinct values. (2) **Resistor ratio matching** (not absolute value)
sets accuracy. (3) **Digital -> analog reconstruction** as the mirror of the ADC.

---

## Counter

**Part + real exemplar(s).** **74HC163** (synchronous 4-bit binary, the well-behaved teaching counter)
and **CD4029** (presettable up/down binary/BCD). Ripple counter contrast: **74HC393**. *Verify the
pinout against the datasheet when authoring.*

**Package / pinout sketch.** 74HC163 in SOIC-16 / DIP-16: CLK, !MR(or SR), P0..P3 (parallel load), PE,
CEP, CET, Q0..Q3, TC (terminal count), VCC, GND. *Confirm pin order before drawing.*

**The five-tier arc.**
- **symbol:** the counter box with CLK in, the parallel Q0..Q3 out, load/enable/reset controls, and TC;
  a small running-count readout glyph.
- **flow:** the count rippling/advancing on each clock edge -- show the binary state stepping
  0000 -> 0001 -> 0010 ... and rolling over. Synchronous = all flops clock together; ripple = each
  flop clocks the next (show the propagation delay walking down the chain).
- **valves:** each bit is a **toggle (T) flip-flop**; the synchronous carry logic (AND chain) gates which
  flops toggle this edge. The clock edge is the pilot that commands the toggles.
- **device:** the chain of edge-triggered flip-flops (built on the existing hashed **DFF**), plus the
  next-state AND/XOR logic for synchronous load/up/down. This is a direct DFF-composition.
- **silicon:** (optional / coarse) the flip-flop cells and routing -- usually the device tier is the
  payoff for sequential parts; keep silicon light or fold it into a die-photo style.

**Model / behaviour.** Each edge: `count = (count + 1) mod 2^N` (or load/down per controls); TC asserts at
terminal count. Pure DFF + gate composition -- the roadmap's **best ratio** ("counters/shift registers...
unlocks all sequential logic," zero core code).

**Tiers / variants.** **Synchronous** (74HC163, all flops on one clock, clean) vs **ripple/asynchronous**
(74HC393, carry propagates, fast but glitchy). Binary vs **BCD/decade** (CD4029). Up vs up/down.

**Teaching points.** (1) **State and clocking** -- a register that remembers and advances. (2)
**Synchronous vs ripple** (skew, glitches, max frequency). (3) **Modulo / rollover** and terminal-count
carry for cascading.

---

## Shift register

**Part + real exemplar(s).** **74HC595** (serial-in, parallel-out, with output latch -- the GPIO-expander
favourite) and **74HC165** (parallel-in, serial-out, the input counterpart). *Verify the pinout against the
datasheet when authoring.*

**Package / pinout sketch.** 74HC595 in SOIC-16 / DIP-16: SER (data in), SRCLK (shift clock), RCLK
(latch/storage clock), !OE, !SRCLR, QA..QH (parallel out), QH' (serial cascade out), VCC, GND. *Confirm
pin order before drawing.*

**The five-tier arc.**
- **symbol:** the register box: serial data in, shift clock, latch clock, OE, the parallel Q outs, and the
  cascade-out. Show the bit-conveyor glyph inside.
- **flow:** bits **marching down a conveyor** one stage per shift-clock edge (serial in pushing the chain
  along); the storage latch snapshots the chain to the outputs on the latch clock (so outputs do not glitch
  mid-shift). For the 595 show the two-clock (shift vs latch) separation clearly.
- **valves:** each stage is a D flip-flop whose D is the previous stage's Q; the shift clock is the pilot
  that advances all stages together; the output latch is a second rank of flops gated by the latch clock.
- **device:** the chain of D flip-flops (the existing **DFF**) plus the parallel storage-latch rank and the
  three-state output buffers (OE). Direct DFF composition.
- **silicon:** (light) the flip-flop cells in a row -- as with the counter, the device tier carries the lesson.

**Model / behaviour.** Each shift edge: `chain = (chain << 1) | SER`; each latch edge: `Q[] = chain`.
Serial<->parallel conversion. Pure DFF composition (roadmap, same line as counters).

**Tiers / variants.** **SIPO (595)** vs **PISO (165)** vs **SISO/universal**; with vs without an output
storage latch; three-state vs plain outputs.

**Teaching points.** (1) **Serial <-> parallel conversion** (turn N wires into one wire + a clock -- the basis
of SPI). (2) **Two-clock latching** (shift vs latch) to avoid output glitches. (3) **Cascading** registers via
the serial-out.

---

## JK / T flip-flops (FF type family)

**Part + real exemplar(s).** **74HC73** (dual JK with clear) or **74LS76**; D-type reference **74HC74**;
the T flip-flop is a JK with J=K=1 (usually shown built from a D or JK, not its own chip). *Verify the
pinout against the datasheet when authoring.*

**Package / pinout sketch.** 74HC73 in DIP-14: per flop -- CLK, J, K, !CLR, Q, !Q, plus VCC/GND (note the
74xx73's nonstandard pinout: VCC and GND are not the usual corner pins -- check the datasheet carefully).
*Confirm pin order before drawing.*

**The five-tier arc.**
- **symbol:** the FF box with J, K (or T), CLK (edge wedge), CLR, and Q/!Q; the characteristic table inside
  (J,K -> hold/reset/set/toggle).
- **flow:** the edge as a **shutter** that samples the J/K commands and updates the stored bit -- show the
  four JK behaviours (00 hold, 01 reset, 10 set, 11 toggle) as four routings; for T, every edge flips.
- **valves:** the master-slave (or edge-detect) structure as two gated latches in series; the clock edge
  pilots the handoff master->slave so the output updates once per edge, not transparently.
- **device:** the gate-level master-slave JK (cross-coupled NAND latches with the J/K steering gates), built
  on the existing hashed **DFF** primitive (the roadmap notes JK/T/SR are a **trivial DFF variant**).
- **silicon:** (light) the latch cells; or skip and let the device tier carry it.

**Model / behaviour.** JK next-state `Q+ = J*!Q + !K*Q`; T: `Q+ = Q XOR T`; SR with the illegal 11 state
flagged; D: `Q+ = D`. Edge-triggered. All are **one-line variants of the existing DFF** (roadmap: "More FF
types... trivial extension of the existing hashed DFF").

**Tiers / variants.** **The FF family itself is the variant axis**: D vs JK vs T vs SR vs gated D-latch.
Master-slave vs edge-triggered; with/without async preset/clear.

**Teaching points.** (1) **The four sequential behaviours** (hold/set/reset/toggle) and how D/T/SR are
special cases of JK. (2) **Edge-triggering vs transparency** (master-slave). (3) Toggle = divide-by-two (the
counter primitive).

---

## Current mirror

**Part + real exemplar(s).** Discrete: a matched pair, e.g. **2x BC847** (or a **BCM847** dual in one
package -- matching is the point), or **2x 2N3904**. Conceptually it is the **inside** of nearly every
analog IC (bias network). *Verify the pinout against the datasheet when authoring (non-IC: follow the
part-study precedent, e.g. `transistor-tiers.html`).*

**Package / pinout sketch.** For a dual-transistor exemplar (e.g. SOT-363 dual BJT): two BJTs, bases tied,
emitters to the common rail; the reference transistor diode-connected. Or draw it as a two-discrete schematic
over a generic frame. *Confirm the dual's pinout if using a real dual.*

**The five-tier arc.** (Part-study-leaning -- the matching is the lesson.)
- **symbol:** the two-transistor mirror schematic: reference side (diode-connected, sets I_REF) and the
  output/mirror side delivering I_OUT = I_REF.
- **flow:** a **water analogy of copied current** -- the reference branch sets a level (Vbe) that the mirror
  branch sees on its base, forcing it to pass the same current; show I_OUT tracking I_REF as the reference is
  swept.
- **valves:** the two transistors as matched valves with their gate/base pressures tied -- identical pilot
  pressure forces identical flow (the matching assumption made visible).
- **device:** the BJT pair with bases joined and the reference collector tied to the bases (diode-connected);
  show base-current error (beta) and the Early-effect mismatch (output not perfectly flat) -- and the Widlar /
  cascode improvements as variants.
- **silicon:** two **adjacent identical transistors** on one die (the entire reason mirrors live inside ICs:
  on-die devices match far better than discretes); thermal coupling.

**Model / behaviour.** Ideal `I_OUT = I_REF` (set by `I_REF = (V - Vbe)/R`); real mirror has a finite output
resistance (Early voltage) and a base-current error `~2/beta`. Builds from existing BJT elements (roadmap:
"current mirror... build-from-parts, zero core code").

**Tiers / variants.** **Simple** vs **Widlar** (emitter degeneration for small currents) vs **cascode**
(higher output resistance) vs **Wilson**. Discrete (poor matching) vs on-die (good matching) as the headline
contrast.

**Teaching points.** (1) **Device matching** -- why analog ICs exist (on-die matching). (2) **Current as a
copied/biased quantity** (the bias-network workhorse). (3) **Output resistance / Early effect** -- an ideal
current source is an approximation.

---

## Instrumentation amplifier

**Part + real exemplar(s).** **INA128** / **INA126** (Texas Instruments) or **AD620** (Analog Devices) --
the classic three-op-amp in-amp with one external gain resistor. *Verify the pinout against the datasheet
when authoring.*

**Package / pinout sketch.** AD620 / INA128 in SOIC-8 / DIP-8: 1 R_G, 2 IN-, 3 IN+, 4 V-, 5 REF, 6 OUT,
7 V+, 8 R_G. (The single resistor between pins 1 and 8 sets the gain.) *Confirm pin order before drawing.*

**The five-tier arc.**
- **symbol:** the in-amp box: differential IN+/IN-, the external R_G, REF, and single-ended OUT; the gain
  equation glyph.
- **flow:** the **difference taken, common-mode rejected** -- show two signals riding on a large shared
  (common-mode) offset, and the in-amp subtracting them so only the difference reaches OUT (the offset
  cancels). Animate a common-mode bounce that the output ignores.
- **valves:** the two input buffer op-amps (gain stage, set by R_G) feeding the difference op-amp -- as gain
  and subtraction valves; the matched feedback resistors as the balance that gives high CMRR.
- **device:** the **three-op-amp topology**: two non-inverting input buffers sharing R_G (so they amplify only
  the difference, gain `1 + 2R/R_G`), then a unity difference amplifier with matched resistors. Built on the
  existing op-amp element.
- **silicon:** (light / die-photo) the matched on-die resistor network (laser-trimmed) that sets the CMRR --
  matching again is the lesson; contrast with a discrete diff-amp's poor CMRR.

**Model / behaviour.** `V_OUT = (1 + 2R/R_G) * (V+ - V-) + V_REF`; CMRR is set by resistor matching in the
difference stage. Builds from existing op-amp + resistor elements (roadmap: "instrumentation amp...
build-from-parts, zero core code").

**Tiers / variants.** Gain set by R_G (a continuous "variant"); precision grades (offset, CMRR, drift).
Three-op-amp vs two-op-amp vs current-feedback in-amp topologies.

**Teaching points.** (1) **Common-mode rejection** -- pull a tiny difference off a big shared offset (sensor
bridges, ECG). (2) **Why matched resistors matter** (CMRR depends on ratio matching). (3) Difference vs
single-ended signaling.

---

## LDO (low-dropout linear regulator)

**Part + real exemplar(s).** **LM317** (adjustable, the teaching classic) and **AMS1117** /
**LM1117** (fixed, ubiquitous on dev boards); micropower contrast **MCP1700**. *Verify the pinout against
the datasheet when authoring.*

**Package / pinout sketch.** LM317 in SOT-223 / TO-220: ADJ, OUT, IN (note: the tab is OUT on the TO-220).
AMS1117 in SOT-223: GND/ADJ, OUT, IN (tab = OUT). *Confirm pin order and the tab connection before drawing.*

**The five-tier arc.**
- **symbol:** the regulator box: V_IN, V_OUT, GND/ADJ; for the LM317 the external R1/R2 divider setting
  V_OUT; a "regulated rail" glyph (flat output despite wavy input).
- **flow:** a **pressure regulator on a pipe** -- the pass element is a variable restriction the feedback loop
  squeezes to hold the output pressure constant as input pressure or load draw varies; show **dropout** as the
  input sagging too close to the output (the valve already fully open, regulation lost).
- **valves:** the series **pass transistor** as the controlled valve, piloted by the error amplifier that
  compares V_OUT (via the divider) to the internal bandgap reference; the loop closes the valve when output
  rises, opens it when output sags.
- **device:** the bandgap reference, the error op-amp, and the pass transistor (PNP/PMOS for true low dropout,
  NPN/Darlington for the older LM317). Built from existing op-amp + BJT/MOSFET + reference (a bandgap is a
  roadmap thermal-axis payoff).
- **silicon:** (light) the pass-device area (sets the current and the thermal path) and the bandgap structure;
  thermal shutdown / SOA ties to the roadmap rating->FAIL and Tj axes.

**Model / behaviour.** `V_OUT = V_REF * (1 + R2/R1)` (adjustable) or fixed; regulates while
`V_IN - V_OUT > V_dropout`. Quiescent current Iq is wasted; power dissipated in the pass device is
`(V_IN - V_OUT) * I_LOAD` (the efficiency penalty vs a buck). Builds from existing parts; the **buck**
card is the switching contrast.

**Tiers / variants.** **Dropout voltage** (standard LM317 ~2 V vs true-LDO ~0.1-0.3 V) and **Iq** (bench vs
micropower) as the grade axes; **adjustable vs fixed**; NPN vs PMOS pass element. Current limit / thermal
shutdown ratings (rating->FAIL).

**Teaching points.** (1) **Closed-loop regulation** (negative feedback holds a rail). (2) **Dropout and the
linear efficiency penalty** (heat = (Vin-Vout)*I) -- the motivation for the buck. (3) The **bandgap reference**
as the stable anchor.

---

## Buck converter (built-from-parts)

**Part + real exemplar(s).** Built from primitives, **not a single chip for the teaching version**:
a high-side switch (MOSFET) + an inductor + a catch diode (or synchronous low-side MOSFET) + an output
capacitor, driven by a PWM source. Packaged controller contrast for later: **LM2596** or **MP1584**.
*If/when packaging the controller, verify its pinout against the datasheet.*

**Build-from-parts note.** This is a **composition glyph**, not an IC glyph: the roadmap ships an
**open-loop buck** as a worked example from existing elements (switch + L + D + C + PWM), zero core code,
before any controller IC. Author it in the part-study style over a small breadboard/schematic frame, with
the PWM duty as the live control (reuse the `PULSE` part -> square-wave source). Closed-loop control waits on
the behavioral-MCU/multi-rate engine.

**The five-tier arc (adapted -- topology zoom, not silicon).**
- **symbol:** the buck schematic: PWM-driven high-side switch, inductor, catch diode, output cap, load;
  the "step-down, high efficiency" glyph.
- **flow:** the inductor as a **flywheel for current** -- when the switch is on, current ramps up and energy
  stores in L (and charges C / feeds the load); when the switch opens, L keeps current flowing through the
  catch diode (freewheel). Output voltage = input * duty. Animate the two phases (on/off) and the inductor
  current triangle wave.
- **valves:** the high-side switch and the catch diode (or synchronous switch) as the two alternating
  valves the PWM commands; the inductor as the momentum element that smooths the chopped input into a steady
  output.
- **device:** the MOSFET switch (gate drive), the diode/synchronous MOSFET, L, C, and the PWM source; show
  the inductor ripple current and the output ripple voltage. (Real engine: time-domain at DT = 2 us handles a
  switching buck below the ~62.5 kHz Nyquist; note this so the refsheet's frequency is legible.)
- **silicon:** (skip or light) -- for a built-from-parts converter the payoff is the **topology and waveform**
  tiers; if packaging a controller later, add the controller die.

**Model / behaviour.** Continuous-conduction `V_OUT = V_IN * D` (D = duty cycle); inductor ripple
`dI = (V_IN - V_OUT)*D*T / L`; the catch diode freewheels during off-time. Open-loop here (D is a slider);
closed loop needs the controller engine. Built from switch + L + D + C (roadmap: "open-loop buck/boost...
primitives already exist").

**Tiers / variants.** **Asynchronous** (catch diode) vs **synchronous** (low-side MOSFET, higher efficiency);
**CCM vs DCM** (continuous vs discontinuous inductor current) as operating modes; switching frequency.

**Teaching points.** (1) **Switching vs linear regulation** -- efficiency (the buck moves energy, the LDO
burns it). (2) **The inductor as an energy-storage flywheel** and the freewheel path. (3) **Duty cycle sets
the ratio**; ripple sets L and C.

---

## Photodiode / phototransistor (light input)

**Part + real exemplar(s).** Photodiode: **BPW34** (the classic large-area Si photodiode). Phototransistor:
**TEPT4400** or **TEPT5600** (ambient-light phototransistor). The roadmap's **first non-electrical input**.
*Verify the pinout/polarity against the datasheet when authoring (non-IC: follow the part-study precedent,
e.g. `diode-factory.html`).*

**Package / pinout sketch.** BPW34: two-lead photodiode, cathode-marked; often a clear/tinted package with the
active area visible. TEPT4400: phototransistor, collector/emitter leads (base usually not brought out).
*Confirm polarity and lead identification before drawing.*

**The five-tier arc.** (Part-study-leaning, with a light-input control.)
- **symbol:** the photodiode/phototransistor symbol with the **incoming-light arrows**; a "lux -> current"
  glyph. Add a **light-level slider** (the roadmap's external-input channel -- the UI scalar that drives the
  device, default 0).
- **flow:** photons arriving at the junction **freeing carriers** -> a photocurrent proportional to light;
  the phototransistor then **multiplies** that photocurrent by beta (more sensitive, slower). Animate light
  intensity -> carrier generation -> output current.
- **valves:** light as the **pilot that opens the valve** (replacing the usual gate/base voltage) -- the first
  non-electrical pilot; for the phototransistor, the base photocurrent commands the larger collector current.
- **device:** the reverse-biased PN junction (photodiode) generating carriers in the depletion region; the
  phototransistor as a photodiode driving a BJT base. Photoconductive vs photovoltaic operating points.
- **silicon:** the junction cross-section with the **light entering the depletion region**, the wide intrinsic
  region (PIN) for collection efficiency, carriers swept by the field.

**Model / behaviour.** Photocurrent `I_ph = R * E_e * A` (responsivity x irradiance x area); the diode I-V is
shifted down by I_ph (the photovoltaic/photoconductive curve). Needs the roadmap's **external-input channel**
(a per-element UI scalar, default 0, plumbed through `aux`/`params`) to feed light in; golden-safe when default.
Phototransistor adds a beta multiply (slower).

**Tiers / variants.** **Photodiode** (fast, linear, low output) vs **phototransistor** (sensitive, slower,
nonlinear) vs **photoresistor/LDR** (very slow). Photovoltaic (zero-bias) vs photoconductive (reverse-biased)
operating modes; spectral response.

**Teaching points.** (1) **Light as an input** -- transducing a non-electrical quantity (the sensor family
opens here). (2) **Photodiode speed/linearity vs phototransistor gain** trade. (3) Depletion-region carrier
generation (ties to the diode/junction physics already taught).

---

## Relay / opto-isolator

**Part + real exemplar(s).** Relay: a generic **SPDT signal relay** (e.g. an Omron G5V-1 class). Opto-isolator:
**PC817** (single transistor-output optocoupler) or **TLP521**; logic-output **6N137** for speed. *Verify the
pinout against the datasheet when authoring.*

**Package / pinout sketch.** PC817 in DIP-4: 1 anode, 2 cathode (input LED), 3 emitter, 4 collector (output
phototransistor). Relay: coil pins (2) + common/NO/NC contact pins (3). *Confirm pin order before drawing.*

**The five-tier arc.** (Both teach **galvanic isolation** -- input and output share no electrical path.)
- **symbol:** relay = coil + the switched SPDT contact, with the **isolation gap** drawn; opto = the input LED
  facing the output phototransistor across a **dashed isolation barrier**. Show the input and output ground
  symbols as **separate** (the key idea).
- **flow:** relay = coil current -> magnetic field -> armature pulls the contact over (an electromagnet moving
  a mechanical switch); opto = input current -> LED light -> across the barrier -> phototransistor current.
  In both, the energy crosses as **field/light, never as conduction**. Animate the coil pulling in / the photons
  crossing the gap.
- **valves:** the controlled contact (relay) or the phototransistor (opto) as the output valve, **piloted from
  the isolated input side** with no shared wire -- the isolation made visible.
- **device:** relay = coil inductance + back-EMF + the mechanical contact (bounce, arc, the flyback diode the
  coil needs); opto = the input LED + the output phototransistor and its current-transfer ratio (CTR). Built
  from existing L/diode (relay) and LED/phototransistor (opto) elements.
- **silicon:** opto = the LED die and the phototransistor die on opposite sides of a transparent isolation
  dielectric; relay = (mechanical, so a labelled cutaway of coil/armature/contacts rather than silicon).

**Model / behaviour.** Relay: coil energizes above a pull-in current, contact transfers; the coil is an
inductor needing a **flyback diode** for the turn-off back-EMF (ties to the existing diode/inductor elements
and reverse-recovery). Opto: `I_out = CTR * I_LED`; isolation voltage rating is the headline spec. Both compose
from existing elements (relay = coil + contact + flyback; opto = LED + phototransistor).

**Tiers / variants.** Relay: SPST/SPDT/DPDT, coil voltage, contact rating, latching vs non-latching. Opto:
transistor vs Darlington vs logic-gate vs triac output; CTR grade; isolation-voltage rating.

**Teaching points.** (1) **Galvanic isolation** -- control one domain from another with no shared ground
(safety, ground-loop breaking). (2) **Energy crossing as field or light**, not conduction. (3) The relay
**flyback diode** (inductive turn-off) -- a concrete reason diodes guard coils.

---

## SRAM cell (cross-coupled inverters)

**Part + real exemplar(s).** Not a packaged single cell -- it is the **bistable core** inside every SRAM /
register / latch: the classic **6T cell** (two cross-coupled CMOS inverters + two access transistors). Teach
it as the storage primitive; a packaged exemplar for context is any async SRAM (e.g. a small **23LC512** SPI
SRAM) but the **cell** is the subject. *If referencing a packaged SRAM, verify its pinout against the datasheet.*

**The five-tier arc.** (IC-glyph-leaning, building directly on the inverter glyph -- the closest existing
template is `inv-ic.html`.)
- **symbol:** two inverters **mouth-to-tail** (each drives the other's input) forming a bistable, plus the two
  access transistors gated by the word line, connecting the two internal nodes to the bit lines. The two stable
  states (0/1) as the storage.
- **flow:** a **two-detent toggle / over-center latch** -- the loop has two stable resting positions and snaps
  to whichever it is pushed past; show a write pulling one node high (and the feedback slamming the other low),
  and the state holding after the push is removed.
- **valves:** the four inverter transistors as the cross-coupled valve pair whose feedback **forces each other**
  into complementary states (the same regenerative positive feedback as the clocked-comparator latch --
  cross-reference); the two access valves (word-line-gated) for read/write.
- **device:** the **6T schematic**: two CMOS inverters (4 transistors) cross-coupled, two NMOS access
  transistors to the bit/bit-bar lines, gated by the word line. Built from the existing gate/MOSFET elements
  (roadmap: "an SRAM cell from cross-coupled inverters," zero core code).
- **silicon:** the six-transistor layout on one die (the canonical compact SRAM cell), the cross-coupling
  metal, the bit/word lines; read/write disturb and static noise margin as the physical lesson.

**Model / behaviour.** Two cross-coupled inverters have **two stable states** (Q,!Q) and hold a bit as long as
power is applied (static, no refresh, unlike DRAM). Write by forcing the bit lines through the access
transistors; read by sensing. Pure inverter/gate composition; the **regenerative feedback** is shared with the
clocked comparator and the comparator's latch.

**Tiers / variants.** 6T (standard) vs 4T (older, resistor-load) vs 8T/10T (decoupled read, low-voltage); static
vs dynamic (DRAM) as the storage-class contrast.

**Teaching points.** (1) **Bistability / positive feedback as memory** -- two inverters in a loop store one bit.
(2) **Static vs dynamic** storage (SRAM holds without refresh; DRAM leaks). (3) **Noise margin** and read/write
disturb.

---

# Broader roadmap set (summary table)

The rest of the roadmap, one line each, so nothing is forgotten. Format: **part -> real exemplar
(verify pinout) -> one-line five-tier hint -> chief teaching point.** Promote any of these to a full card when
it reaches the build queue. Several depend on roadmap mechanisms not yet built (the thermal `Tj` axis, the seeded
PRNG for noise, the behavioral-MCU / multi-rate engine, the external-input channel) -- noted as **[needs: ...]**.

| Part | Real exemplar (verify pinout) | Five-tier hint (symbol / flow / valves / device / silicon) | Teaches |
| --- | --- | --- | --- |
| **Sigma-delta ADC** | ADS1115, AD7124 | quantizer box / 1-bit loop oversampling + decimation / integrator + comparator + 1-bit DAC feedback valves / the modulator loop (on the **clocked sampler**) / CMOS die | Oversampling, noise-shaping, trading speed for resolution. **[needs: clocked sampler; noise PRNG for the dither/quantization-noise story]** |
| **Switched-capacitor (filter / charge pump)** | LTC1043, MAX660, ICL7660 | block / charge ferried in packets by a flying cap on a clock / the two-phase switches as alternating valves / flying-cap + switches + clock / die | A switched cap **emulates a resistor** (R = 1/(f*C)); charge pumps make negative/boosted rails. **[needs: clocked sampler / two-phase clock]** |
| **Analog mux / demux** | 74HC4051 (8:1), CD4066 (quad switch) | router box / one of N paths opened to the common / the per-channel transmission-gate valves selected by the address / CMOS transmission gates + 3-to-8 decoder / die | Bidirectional analog routing; on-resistance; address decoding. **[compose: gates + transmission gates]** |
| **Decoder / encoder** | 74HC138 (3-to-8), 74HC148 (priority enc) | block / one-hot fan-out from a binary address / the AND-term valves selecting the active line / gate array / die | Address decoding (one-hot), priority encoding (the inverse). **[compose: gates]** |
| **JFET** | 2N5457 (N-ch), J201 | symbol (depletion) / channel pinched by a reverse-biased gate / the gate-depletion valve (normally-on, pinches off) / the junction-gated channel / cross-section | Depletion-mode (normally-on) vs the enhancement MOSFET; gate junction. **[needs: JFET element or MOSFET-variant model]** |
| **SCR / thyristor** | 2N5060, BT151 | symbol / latches on with a gate pulse, stays on until current drops / the regenerative PNPN latch valves / the two-transistor (NPN+PNP) latch model / 4-layer cross-section | Latching with positive feedback; holding current; phase control. **[needs: PNPN latch / regenerative model]** |
| **TRIAC (+ DIAC)** | BT136 (TRIAC), DB3 (DIAC) | symbol (bidirectional) / conducts both half-cycles, gate-triggered / back-to-back SCR valves / the bidirectional latch / cross-section | AC power/phase control (dimmers); bidirectional latching. **[needs: bidirectional PNPN]** |
| **Temperature sensor** | LM35, TMP36, DS18B20 | block / Tj/ambient -> a proportional voltage or digital word / the bandgap-referenced sense valve / bandgap + amp (or 1-Wire digital) / die | Transducing temperature; the bandgap reference. **[needs: thermal `Tj` axis; DS18B20 also the protocol engine]** |
| **Hall sensor** | A1302, DRV5053, A3144 (switch) | block / magnetic field -> Hall voltage -> output / the field-piloted sense valve / Hall plate + amp (linear) or + comparator (switch) / die | Magnetic-field input; linear vs latch/switch output. **[needs: external-input channel (field)]** |
| **Strain/pressure bridge** | generic Wheatstone + in-amp | bridge symbol / a tiny differential imbalance on a big common mode / the four-arm balance + in-amp valve / bridge + instrumentation amp / (sensor element) | Ratiometric bridge sensing; pairs with the **instrumentation-amp** card. **[needs: external-input channel; compose with in-amp]** |
| **Voltage reference (bandgap / shunt)** | LM4040 (shunt), REF3025, TL431 | symbol / a flat reference voltage held over temperature/load / the bandgap loop valves balancing two temperature slopes / bandgap core (Vbe + PTAT) / die | A stable reference independent of supply/temperature (the anchor for ADC/DAC/LDO). **[needs: thermal `Tj` for the real temperature-cancellation story]** |
| **I2C / SPI / UART peripheral** | PCF8574 (I2C GPIO), MCP23S17 (SPI) | block / framed bytes shifted on the bus per protocol / the open-drain/ push-pull bus-line valves / shift registers + bus state machine / die | Serial protocols; wired-AND open-drain bus (I2C is **partway enabled** today via open-drain + pull-up). **[needs: behavioral-MCU / multi-rate engine]** |
| **MCU / FPGA** | (uC, FP placeholders today) | block / firmware/logic driving the pins / (behavioral, not transistor) / register-transfer model / die | Programmable behavior; the systems tier. **[needs: behavioral-MCU / multi-rate engine -- `docs/sim/multi-rate-domains.md`]** |
| **Boost / buck-boost / flyback** | (built-from-parts; LT1370, etc.) | schematic / energy pumped up via the inductor each cycle / switch + diode alternating valves / switch+L+D+C+PWM / (topology, light silicon) | Step-up switching; the inductor flywheel again. **[compose: switch + L + D + C; closed loop needs the controller engine]** |
| **Op-amp oscillators / active filters** | (built from the op-amp element) | block / phase-shift/Wien feedback sustaining oscillation, or a tuned response / the gain + feedback valves / op-amp + RC network / (light) | Feedback, Barkhausen, filter poles. **[compose: op-amp + R + C; pairs with the Bode/phase-scope frequency tools]** |

---

## Authoring checklist (per new sheet)

Quick gate before handing a sheet back. The full procedure is `ic-glyph-spec.md` sections 10-12.

1. **Datasheet first.** Record exact part number + package variant, the pin-function table, supply range, the
   governing equation, and (for ICs) the logic/transfer behaviour from the datasheet. **Do not proceed on a
   recalled pinout.** Cite the datasheet revision in the footnote.
2. **Pick the shape** (IC-glyph arc vs part-study arc) and the nearest existing file to clone
   (`inv-ic.html` for gate-like ICs; the matching `*-tiers.html` for discretes).
3. **Honour the invariant:** one shared package frame, every tier routes to the same pins; tiers go abstract
   (symbol) -> physical (silicon).
4. **Match the model to the sim.** If the part rides a roadmap mechanism (clocked sampler, rating->FAIL,
   external-input channel, thermal `Tj`, noise PRNG), make the refsheet's behaviour and the equation tier
   consistent with how it will actually be simulated -- and note any **[needs: ...]** dependency in the footnote.
5. **House style + ASCII labels + the three fonts + OKLCH palette.** Run the spec's **validation gates**
   (syntax, forbidden-glyph scan, structure counts, member consistency, Playwright render + screenshot sweep).
6. **Flag tradeoffs** in the handback: compactness choices, schematic crossings without junction dots,
   left/right device placement vs textbook, normalized (not absolute) current scales.

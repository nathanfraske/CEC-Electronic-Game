<!-- SPDX-License-Identifier: Apache-2.0 -->

# CEC Foundations Series — house-brand teaching ICs

Custom integrated circuits by **Critical Error Computing (CEC)** — invented parts
built *to teach*, not to sell. Each one isolates a single concept at the minimum
honest pin count, so a learner meets the idea without a datasheet's worth of
distraction. They are the house counterpart to the real-part refsheets in
`new-part-refsheets.md`; the owner draws each as a five-tier IC glyph
(`ic-glyph-spec.md`), and each maps to a sim-core element (noted per part).

**CEC house pin convention** (consistent across the whole family, itself a teaching
aid): **pin 1 = primary OUTPUT · pin 2 = GND · middle = inputs/controls · last pin =
VCC.** Every part is single-supply powered (VCC/GND), exactly like the logic gates —
a CEC part is never a bare two-terminal; it always has a rail, so "where does it get
its energy" is always answerable. Logic levels swing GND..VCC; supply 1.8 V–15 V.

**Packages.** Each part ships in a standard small-outline package, drawn over a real frame
per `ic-glyph-spec.md` (a breadboard-friendly DIP exists for the bench): **CEC1041** and
**CEC3007** in **SOT-23-5**, **CEC1083** in **SOT-23-6**, **CEC2018** in **SOT-23-8** (one
N.C.). The two CEC **logic gates** (below) take the **SOT-23-5** gate footprint and the
74-series single-gate pinout (`1 A · 2 B · 3 GND · 4 Y · 5 VCC`) so they sit beside the real
gates — the output-on-pin-1 convention above is the Foundations Series' own; the gates keep
the JEDEC gate order.

> These are fictional teaching parts. "Specs" are pedagogical, not manufacturing.
> The numbering is `CEC` + a 4-digit code: **1xxx** data-conversion, **2xxx**
> arithmetic/logic, **3xxx** memory/sequential, **4xxx** analog/signal.

---

## CEC1041 — Clocked 1-Bit Quantizer

*Critical Error Computing · "the instant the analog world becomes a number."*

**Description.** The CEC1041 captures one bit of the analog world on command. On the
rising edge of CLK it compares IN against its internal half-rail reference (½·VCC) and
latches the result on Q, which then holds until the next edge. It is the *atom* of
analog-to-digital conversion: stack eight of them against a resistor ladder for a flash
ADC, or wrap one in a feedback loop for successive approximation. There is no real
single-chip equivalent — that is exactly why it exists.

**Features.** Edge-triggered 1-bit capture · output holds between clocks · internal
½·VCC threshold (no reference pin) · rail-to-rail push-pull output · single supply.

**Pin configuration — 5-pin (SC70-5 / SOT-23-5):**

| Pin | Name | Function |
|---|---|---|
| 1 | **Q** | Latched 1-bit output; holds its value between clock edges. |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **IN** | Analog input. Compared against ½·VCC. |
| 4 | **CLK** | Sampling clock. Captures on the LOW→HIGH edge. |
| 5 | **VCC** | Positive supply (1.8–15 V); also sets the ½·VCC threshold. |

**Function.** On CLK↑: `Q ← (V(IN) > VCC/2)`. Otherwise `Q` holds.

**Abs max:** VCC 16 V · IN −0.3 V to VCC+0.3 V · per-clock acquisition is instantaneous
in-sim (the real-world aperture is a teaching annotation).

**In the sim:** maps to `ELEM_SAMPLER` (threshold wired to ½·rail). Golden-safe additive.
**Teaches:** sampling, quantization, the Nyquist limit, the analog↔digital boundary.

---

## CEC1083 — 3-Bit Ladder DAC

*Critical Error Computing · "three switches and a ladder make a voltage."*

**Description.** The CEC1083 turns a 3-bit code into a voltage with nothing but a
resistor R-2R ladder — the most honest digital-to-analog converter there is, because
you can see every resistor doing its job. AOUT settles to the binary-weighted sum of the
three inputs. Pairs naturally with the CEC1041 (quantize in, reconstruct out).

**Features.** Pure R-2R ladder (no op-amp, no reference pin — VCC is the reference) ·
monotonic by construction · inputs are ordinary logic levels · single supply.

**Pin configuration — 6-pin (SOT-23-6 / SC70-6):**

| Pin | Name | Function |
|---|---|---|
| 1 | **AOUT** | Analog output = (code / 8) · VCC. |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **D0** | Data bit 0 (LSB, weight 1). |
| 4 | **D1** | Data bit 1 (weight 2). |
| 5 | **D2** | Data bit 2 (MSB, weight 4). |
| 6 | **VCC** | Positive supply; the ladder's full-scale reference. |

**Transfer:** `AOUT = (D0·1 + D1·2 + D2·4) / 8 · VCC` — eight steps, 0 V to 7/8·VCC, one
LSB = VCC/8.

**Abs max:** VCC 16 V · D0..D2 are logic inputs (0 / VCC).

**In the sim:** a `buildNetlist` composition — an R-2R network of resistors with each 2R
leg tied to its D input net (driven 0/VCC by external logic). No new sim-core element;
reuses the resistor model. **Teaches:** digital→analog, binary weighting, the R-2R ladder,
resolution vs. LSB size.

---

## CEC2018 — 1-Bit Full Adder

*Critical Error Computing · "the smallest piece of arithmetic that still counts."*

**Description.** The CEC2018 adds three bits — A, B, and a carry-in — and reports a sum
and a carry-out. Chain N of them carry-to-carry and you have an N-bit adder; it is the
cell every ALU is built from. One glyph, the whole of binary addition.

**Features.** A + B + CIN → {COUT, SUM} · ripple-carry chainable (COUT→CIN of the next) ·
purely combinational · single supply.

**Pin configuration — 7-pin (SC70-8 with one N.C., or MSOP-8):**

| Pin | Name | Function |
|---|---|---|
| 1 | **SUM** | Sum output = A ⊕ B ⊕ CIN. |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **A** | Addend bit A. |
| 4 | **B** | Addend bit B. |
| 5 | **CIN** | Carry input (from the next-lower stage). |
| 6 | **COUT** | Carry output = majority(A, B, CIN). |
| 7 | **VCC** | Positive supply. |

**Truth table** (A B CIN → COUT SUM): 000→00 · 001→01 · 010→01 · 011→10 · 100→01 ·
101→10 · 110→10 · 111→11.

**In the sim:** a `buildNetlist` composition of gates (SUM = two XOR; COUT = two AND + OR).
No new sim-core element. **Teaches:** binary addition, carry propagation, how logic
becomes arithmetic, the path to an ALU.

---

## CEC3007 — SR Latch (1-Bit Cell)

*Critical Error Computing · "the first thing a circuit ever remembered."*

**Description.** The CEC3007 is one bit of memory made of feedback: SET drives the output
high and it *stays* high after SET releases; RESET drives it low and it stays. Hold both
low and it remembers. It is the cross-coupled-gate primitive that every flip-flop,
register, and SRAM cell grows from — bistability you can hold in your hand.

**Features.** Set/Reset with hold · active-high inputs · the bistable building block ·
single supply.

**Pin configuration — 5-pin (SC70-5 / SOT-23-5):**

| Pin | Name | Function |
|---|---|---|
| 1 | **Q** | Latched output (the remembered bit). |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **S** | Set input (HIGH → Q latches HIGH). |
| 4 | **R** | Reset input (HIGH → Q latches LOW). |
| 5 | **VCC** | Positive supply. |

**Function** (S R → Q): 0 0 → hold · 1 0 → 1 · 0 1 → 0 · 1 1 → *invalid* (forbidden; both
gates fight — a deliberate teaching hazard the sim shows as contention).

**In the sim:** a `buildNetlist` composition of two cross-coupled NOR gates (existing
`ELEM_GATE`), the 1 1 case resolving through the four-state `combine` → `X`. No new
sim-core element. **Teaches:** feedback, bistability, the birth of memory, why the
forbidden state is forbidden.

---

## CEC logic gates (non-standard functions)

Eight of the ten gates ship as real 74-series single-gate parts; two functions have **no
discrete real chip**, so CEC makes them. Each is a 2-input powered gate in the **SOT-23-5**
gate footprint, 74-series pinout (`1 A · 2 B · 3 GND · 4 Y · 5 VCC`), mapping to `ELEM_GATE`
(its function code already lives in the sim). Refsheets: `imply-ic.html`, `nimply-ic.html`.

### CEC2110 — Implication Gate (A → B)

*Critical Error Computing · "if A, then B — in one gate."* `Y = (NOT A) OR B`: low in exactly
one case (A high, B low), high in the other three — the material conditional. Negative-unate
in A, positive-unate in B; the static-CMOS cell is an inverter on B feeding a NAND with A.
**Package:** SOT-23-5. **Truth** (A B → Y): 00→1 · 01→1 · 10→0 · 11→1.

### CEC2111 — Inhibit Gate (A AND NOT B)

*Critical Error Computing · "A, unless B says no."* `Y = A AND (NOT B)`: high in exactly one
case (A high, B low) — the NIMPLY / inhibition function, IMPLY's mirror (it inverts A and
uses a NOR core). **Package:** SOT-23-5. **Truth** (A B → Y): 00→0 · 01→0 · 10→1 · 11→0.

---

## The arc

Read together, the four are a tiny computer in kit form: **CEC1041** quantizes the world
in, **CEC2018** computes on it, **CEC3007** remembers the result, **CEC1083** turns it
back into a voltage. Convert → compute → store → reconstruct, each a single CEC glyph,
each at its minimum honest pin count — and (with the existing sampler/gate/resistor
elements) each buildable in-sim today, golden-safe, the moment its refsheet is drawn.

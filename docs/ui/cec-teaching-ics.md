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
**CEC3007** in **SOT-23-5**, **CEC1083** in **SOT-23-6**, **CEC2018** and **CEC3076**
(7-pin, one N.C. each) and **CEC2064** (all eight pins used) in **SOT-23-8**. The two CEC **logic gates** (below) take the **SOT-23-5** gate footprint and the
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

## CEC logic & routing (arithmetic, selection, busing)

Five combinational gaps where no clean discrete single-function chip exists at the minimum
pin count — the arithmetic atom below the full adder, the two routing primitives (select and
distribute), the fault-tolerance gate, and the bus driver. Each is a `buildNetlist`
composition of the existing powered `ELEM_GATE` (golden-safe additive), and — like the two
CEC gates above — each keeps the **74-series gate pin order** where it is a single logic
function (`1 A · 2 B · 3 GND · … · VCC last`) so it sits beside the real gates; the wider
parts (mux/demux/latch with a select or enable) revert to the **CEC house convention**
(output pin 1, GND pin 2, VCC last) because they are no longer a bare 2-input gate.

### CEC2024 — 1-Bit Half-Adder

*Critical Error Computing · "addition before it learned to carry in."*

**Description.** The CEC2024 adds two bits and reports a sum and a carry-out — and that is
*all* it does, with no carry-in. It is the rung below the CEC2018 full adder: the half-adder
is the cell at the very least-significant position of a ripple chain (where there is nothing
to carry in yet), and a full adder is literally two half-adders plus an OR. Meeting addition
without the carry-in pin first makes the full adder's third input obvious. There is no
discrete single-gate half-adder chip — it has always been "an XOR and an AND" you wire
yourself, which is exactly the lesson.

**Features.** A + B → {COUT, SUM} · SUM = A ⊕ B, COUT = A · B · purely combinational ·
the bottom rung of a ripple-carry adder · single supply.

**Pin configuration — 6-pin (SOT-23-6 / SC70-6):**

| Pin | Name | Function |
|---|---|---|
| 1 | **SUM** | Sum output = A ⊕ B. |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **A** | Addend bit A. |
| 4 | **B** | Addend bit B. |
| 5 | **COUT** | Carry output = A · B (chains into a CEC2018's CIN). |
| 6 | **VCC** | Positive supply (also the output logic-high rail). |

(A half-adder's defining feature is the carry-*out*, so both outputs are brought out — this is
the cell at the bottom of a ripple chain; add a carry-in and it becomes the CEC2018 full adder.)

**Truth table** (A B → COUT SUM): 00→00 · 01→01 · 10→01 · 11→10.

**In the sim:** a `buildNetlist` composition of two gates — `SUM` = one **XOR**(A,B),
`COUT` = one **AND**(A,B), each a powered `ELEM_GATE` swinging GND..VCC (this is already shipped
as the `logic-half-adder` worked example). No new sim-core element; golden-safe additive.
**Teaches:** binary addition, sum vs. carry, why the full adder needs a third (carry-in) input.

### CEC2031 — 2:1 Multiplexer

*Critical Error Computing · "two wires in, one chosen out."*

**Description.** The CEC2031 passes one of two inputs to the output, chosen by a select line:
`SEL` low forwards A, `SEL` high forwards B. It is the elemental router — the building block
of every larger mux, every data-path "pick a source," and (fed back) the lookup-table cell of
an FPGA. Cascade them in a tree for a 4:1 or 8:1; this is the leaf. No discrete 1-bit 2:1 mux
chip exists at this pin count (the smallest real parts are quad), so CEC lays the single bit
bare.

**Features.** Y = SEL ? B : A · one select line · combinational · the leaf cell of any mux
tree / LUT · single supply.

**Pin configuration — 6-pin (SOT-23-6 / SC70-6):**

| Pin | Name | Function |
|---|---|---|
| 1 | **Y** | Output: forwards A when SEL = 0, B when SEL = 1. |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **A** | Data input 0 (selected when SEL = 0). |
| 4 | **B** | Data input 1 (selected when SEL = 1). |
| 5 | **SEL** | Select line (0 → A, 1 → B). |
| 6 | **VCC** | Positive supply. |

**Function:** `Y = (A · ¬SEL) + (B · SEL)`. **Truth** (SEL → Y): 0 → A · 1 → B.

**In the sim:** a `buildNetlist` composition of gates — an inverter on SEL, two ANDs
(`A·¬SEL`, `B·SEL`), and an OR to merge — all powered `ELEM_GATE`. No new sim-core element;
golden-safe additive. **Teaches:** data selection/routing, the select line, how muxes build
the FPGA lookup table.

### CEC2032 — 1:2 Demultiplexer / 1-of-2 Decoder

*Critical Error Computing · "one wire in, sent to where you point it."*

**Description.** The CEC2031's mirror image. With `D` as data, the CEC2032 steers it to Y0 or
Y1 by the select line (demux); tie `D` high and it becomes a 1-of-2 **decoder** — exactly one
output asserts for each address, the one-hot primitive every memory address line and chip-select
grows from. Distribution is the dual of selection, and meeting them as a matched pair (CEC2031
↔ CEC2032) makes the duality concrete.

**Features.** Demux: routes D to Y0/Y1 by SEL · Decoder (D = 1): one-hot 1-of-2 by address ·
combinational · the address-decode primitive · single supply.

**Pin configuration — 6-pin (SOT-23-6 / SC70-6):**

| Pin | Name | Function |
|---|---|---|
| 1 | **Y0** | Output 0 = D · ¬SEL (asserts when SEL = 0). |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **Y1** | Output 1 = D · SEL (asserts when SEL = 1). |
| 4 | **D** | Data input (tie HIGH to use as a pure 1-of-2 decoder). |
| 5 | **SEL** | Select / address line. |
| 6 | **VCC** | Positive supply. |

**Function:** `Y0 = D · ¬SEL`, `Y1 = D · SEL`. **Decode** (D = 1, SEL → Y1 Y0): 0 → 01 · 1 → 10.

**In the sim:** a `buildNetlist` composition — an inverter on SEL and two AND gates
(`D·¬SEL`, `D·SEL`), all powered `ELEM_GATE`. No new sim-core element; golden-safe additive.
**Teaches:** data distribution (the dual of the mux), one-hot decoding, address lines /
chip-select.

### CEC2046 — Majority / Voting Gate (3-input)

*Critical Error Computing · "democracy in a gate — two out of three wins."*

**Description.** The CEC2046 outputs whatever the **majority** of its three inputs say:
high if two or three are high, low otherwise. It is the heart of fault-tolerant logic —
triple-modular redundancy votes out a single failed channel through exactly this gate — and,
not coincidentally, it *is* the carry-out function of a full adder (`COUT = majority(A,B,CIN)`),
so it ties arithmetic and reliability together. No discrete majority-gate chip exists; the
function is fundamental enough (it is monotone, and a primitive of threshold/neuromorphic logic)
to deserve its own glyph.

**Features.** Y = majority(A, B, C) = AB + BC + CA · three inputs · monotone (no inversion) ·
the TMR voter and the full-adder carry · single supply.

**Pin configuration — 6-pin (SOT-23-6 / SC70-6), 74-series-style gate order:**

| Pin | Name | Function |
|---|---|---|
| 1 | **A** | Input A. |
| 2 | **B** | Input B. |
| 3 | **GND** | Ground / 0 V reference. |
| 4 | **C** | Input C. |
| 5 | **Y** | Majority output (HIGH when ≥ 2 inputs HIGH). |
| 6 | **VCC** | Positive supply. |

(Three inputs + output exceeds the 5-pin single-gate footprint, so it takes the SOT-23-6 gate
frame; pin order follows the gate convention — inputs and GND first, output then VCC — to sit
beside the real 74-series gates rather than the output-on-pin-1 house convention.)

**Truth table** (A B C → Y): 000→0 · 001→0 · 010→0 · 011→1 · 100→0 · 101→1 · 110→1 · 111→1.

**In the sim:** a `buildNetlist` composition — three two-input **AND** gates (AB, BC, CA) into
a three-input **OR** (itself a tree of two OR gates), all powered `ELEM_GATE` (identical to the
CEC2018 carry network). No new sim-core element; golden-safe additive. **Teaches:** majority/
threshold logic, triple-modular redundancy (voting out a fault), the full-adder carry as a vote.

### CEC2057 — Tri-State Buffer (with Output Enable)

*Critical Error Computing · "drive it, or get off the bus."*

**Description.** The CEC2057 is a buffer with a third output state: **high-impedance**. When
`OE` is high it passes A to Y (a clean 0 or VCC); when `OE` is low it **releases** Y entirely —
neither high nor low, just disconnected (Hi-Z). That third state is the whole idea of a shared
**bus**: many tri-state drivers on one wire, only one enabled at a time, the rest electrically
absent. It is the part that makes a data bus, a wired backplane, and the `OE` pin on every
memory and register possible. Hi-Z has no waveform, so it must be met as a *concept*, which is
why it earns a dedicated glyph.

**Features.** Y = A when OE = 1; **Hi-Z** when OE = 0 · three output states (0, 1, Z) · the bus
driver / wired-OR enabler · single supply.

**Pin configuration — 5-pin (SOT-23-5 / SC70-5):**

| Pin | Name | Function |
|---|---|---|
| 1 | **Y** | Three-state output: A when enabled, **high-impedance** when not. |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **A** | Data input. |
| 4 | **OE** | Output enable (HIGH = drive Y; LOW = release Y to Hi-Z). |
| 5 | **VCC** | Positive supply. |

**Function** (OE A → Y): 0 X → **Z** · 1 0 → 0 · 1 1 → 1. Two or more CEC2057 outputs may share
one net (a bus) provided **at most one** is enabled; two enabled drivers in disagreement is a
**bus conflict** (the sim resolves it to `X` — a deliberate teaching hazard).

**In the sim:** a `buildNetlist` composition over the existing digital domain's **four-state
`Z`**. The honest, golden-safe build is a powered `ELEM_GATE` **buffer** whose VCC rail is
**gated by `OE`** (OE low collapses the rail below `GATE_MIN_RAIL`, so the gate goes
**dead-rail → releases its output to `Z`** — the existing unpowered-gate mechanism); OE high
restores the rail and it drives A. Two such outputs on a net resolve through the IEEE-1164
`combine()` rule (`Z` yields to any real driver; two disagreeing strong drivers → `X`). No new
sim-core element. *(A cleaner native build — a direct `OE`-gated Z without rail-collapse — is
noted in the engine as a future "tri-state buffer with OE" refinement using a dedicated enable
pin; the dead-rail composition above teaches the same Hi-Z behaviour today.)* **Teaches:** the
high-impedance state, shared buses and output-enable, bus contention.

---

## CEC programmable logic (the configurable cell)

One gap the fixed-function parts above leave open: a gate you **program** instead of pick. Where
every part so far computes one wired-in function, the cell below becomes *any* function you load
into it — and it is the first CEC part backed by the **behavioral engine** (ADR 0004) rather than a
`buildNetlist` gate composition. It is the capstone the CEC2031 mux pointed at ("how muxes build the
FPGA lookup table").

### CEC2064 — Configurable Logic Cell (4-Input LUT + register)

*Critical Error Computing · "sixteen bits that become any gate you can name."*

**Description.** The CEC2064 is a blank gate you fill in. Four inputs address a **sixteen-entry
truth table** loaded at config time, and the addressed bit *is* the output — so one chip is *any*
boolean function of up to four inputs at once: AND, XOR, a 3-input majority, a full-adder carry, a
2:1 mux, anything sixteen bits can describe. Switch on its **registered** mode and the looked-up bit
is latched on each clock edge instead of flowing straight through — a LUT followed by a flip-flop,
which is exactly the **logic element** an FPGA is tiled from. A whole FPGA is a fabric of these cells
plus programmable wiring; meeting one bare is meeting programmable hardware itself. No discrete
single-LUT chip is sold (the closest real parts are configurable-logic gates like the 74LVC1G97, or
the LUT blocks inside a GreenPAK), which is exactly why CEC lays one cell open.

**Features.** Any boolean function of ≤ 4 inputs from a 16-bit truth table · combinational **or**
registered output (a LUT, or a LUT+flip-flop "logic element") · every fixed gate is one table
(AND = `0x8888`, XOR = `0x6666`, 3-input majority = `0xE8E8`) · a fabric of these is any logic or
state machine · single supply.

**Pin configuration — 8-pin (SOT-23-8 / MSOP-8):**

| Pin | Name | Function |
|---|---|---|
| 1 | **Y** | Logic output — the addressed truth-table bit (registered mode: the latched bit, held between clocks). |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **I0** | Input bit 0 — truth-table index LSB. |
| 4 | **I1** | Input bit 1. |
| 5 | **I2** | Input bit 2. |
| 6 | **I3** | Input bit 3 — truth-table index MSB. |
| 7 | **CLK** | Clock — registered mode only: latches Y on the LOW→HIGH edge; ignored when combinational. |
| 8 | **VCC** | Positive supply (also the output logic-high rail). |

**Configuration** (set at config time, not pins — a real LUT's truth table lives in config memory,
not on a wire): the **16-bit truth table** `T[0..15]`, and the **mode** (combinational vs registered).

**Function.** Index `n = 8·I3 + 4·I2 + 2·I1 + I0`. Combinational: `Y = T[n]`. Registered: on CLK↑,
`Q ← T[n]`, and `Y = Q` (held until the next edge). Unwired inputs read LOW, so a 2- or 3-input
function just loads a table that ignores the unused high inputs (e.g. XOR(I0,I1) = `0x6666`).

**Abs max:** VCC 16 V · inputs −0.3 V to VCC+0.3 V · the truth table is a config property, not a
runtime signal.

**In the sim:** maps to `ELEM_BEHAVIORAL` **program 4** (`BEH_PROG_LUT`) — the truth table rides in
`aux` (low 16 bits), the mode in `params[4]` (≥ 1 → registered), and the pins map **Y→a · GND→e ·
I0/I1/I2→f/g/h · I3→c · CLK→b · VCC→d**. A combinational cell carries no state; a registered one
folds only its `Q`/`clk_prev`, through the existing `beh_state` hash loop — **golden-safe by
construction** (no golden circuit carries a behavioral block). The first CEC part backed by the
behavioral engine rather than a gate composition. **Teaches:** that all combinational logic is a
lookup table; programmability (one cell, any function); the FPGA logic element (LUT + register); how
a fabric of LUTs becomes any circuit (the path to a soft core). **Refsheet:** `lut-ic.html`.

---

## CEC memory & sequential (level vs. edge)

### CEC3014 — Transparent D-Latch

*Critical Error Computing · "memory with the door propped open."*

**Description.** The CEC3014 stores one bit, but unlike a flip-flop it is **level-sensitive**:
while `EN` is high the latch is *transparent* — Q simply follows D — and the instant `EN` goes
low it **freezes** the last value of D and holds it. It is the missing middle term between the
CEC3007 (an SR latch — feedback memory, but no clean data input) and an edge-triggered D
flip-flop (the 74LVC1G80, which samples D only on a clock *edge*). Putting the transparent latch
beside the edge flip-flop is the cleanest way to teach **level- vs. edge-triggered** — the
single most confused distinction in sequential logic (and the source of every latch-vs-flop
timing bug). No discrete single D-latch is sold at this pin count.

**Features.** Transparent when EN = 1 (Q follows D), holds last D when EN = 0 · level-sensitive
(not edge) · the gated-latch building block (a flip-flop is two of these) · single supply.

**Pin configuration — 6-pin (SOT-23-6 / SC70-6):**

| Pin | Name | Function |
|---|---|---|
| 1 | **Q** | Latched output: follows D while EN = 1, holds when EN = 0. |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **D** | Data input. |
| 4 | **EN** | Enable / gate (HIGH = transparent, LOW = hold). |
| 5 | **Q̄** | Complementary output. |
| 6 | **VCC** | Positive supply. |

**Function** (EN D → Q): 1 0 → 0 · 1 1 → 1 · 0 X → **hold**.

**In the sim:** a `buildNetlist` composition of gates — a gated SR latch: two steering ANDs
(`D·EN`, `¬D·EN`) into the cross-coupled NOR pair of the CEC3007 (so when EN = 0 both set/reset
terms are forced low and the latch *holds*; when EN = 1 it tracks D). All powered `ELEM_GATE`,
resolving through the four-state `combine`. No new sim-core element; golden-safe additive.
(The level-sensitive latch the engine already implements inside `ELEM_COMPARATOR`'s active-low
`LE` enable is the *analog* cousin of this digital latch — same transparent-vs-hold idea.)
**Teaches:** level- vs. edge-triggered storage, transparency vs. hold, that a flip-flop is two
latches in series.

### CEC3076 — JK / T Flip-Flop (the universal flip-flop)

*Critical Error Computing · "every flip-flop in one — and the toggle that counts."*

**Description.** The CEC3076 is the **universal** edge-triggered flip-flop: on each rising CLK edge
J and K choose the next state — hold (0 0), set (1 0), reset (0 1), or **toggle** (1 1) — the one
flip-flop that does all four. The toggle is the prize: tie **J and K together** and it becomes a
**T (toggle) flip-flop**, flipping its output on every clock while T = 1, so Q emerges at **half the
clock frequency** — the divide-by-2 cell every binary counter and frequency divider is built from.
The JK is also the SR latch with its forbidden state redeemed: where SET = RESET = 1 was illegal on
the CEC3007, here J = K = 1 is the *most useful* case of all. No single JK is sold at this pin count
(the real parts — 74x76, 74x112, CD4027 — are all **duals**), so CEC brings one flop out bare; it is
the edge-triggered companion to the real D flip-flop (`dff-ic.html`, 74AUP1G79).

**Features.** Edge-triggered J/K — hold / set / reset / **toggle** · tie J = K for a **T flip-flop**
(divide-by-2) · the universal flip-flop (D and T are both special cases) · complementary Q̄ for
divider chains · single supply.

**Pin configuration — 7-pin (SC70-8 with one N.C., or MSOP-8):**

| Pin | Name | Function |
|---|---|---|
| 1 | **Q** | Latched output (updates only on the clock edge). |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **J** | Set-side input (J = 1, K = 0 → Q latches HIGH). |
| 4 | **K** | Reset-side input (J = 0, K = 1 → Q latches LOW). **Tie to J for T-mode.** |
| 5 | **CLK** | Clock — samples J/K on the LOW→HIGH edge. |
| 6 | **Q̄** | Complementary output (chain Q̄→CLK of the next stage for a ripple counter). |
| 7 | **VCC** | Positive supply. |

**Function** (J K, on CLK↑ → next Q): 0 0 → Q (hold) · 1 0 → 1 (set) · 0 1 → 0 (reset) · 1 1 → Q̄
(toggle). Characteristic equation `Q⁺ = J·Q̄ + K̄·Q`. **T-mode** (J = K = T): `Q⁺ = T ⊕ Q` — toggles
when T = 1, holds when T = 0.

**Abs max:** VCC 16 V · inputs −0.3 V to VCC+0.3 V.

**In the sim:** a `buildNetlist` composition — an edge-triggered `ELEM_DFF` (the memory; `Q = a`,
`D = b`, `CLK = c`, `Q̄ = d`) fed by JK **steering logic** that computes its D input
`D = (J · Q̄) + (¬K · Q)` from powered `ELEM_GATE`s (an inverter on K, two ANDs, an OR), with the
DFF's own Q (`a`) and Q̄ (`d`) closing the feedback. Because the DFF samples only on the edge, the
J = K = 1 case is a clean **toggle** with no latch race — the master-slave problem the real JK
solved, here solved for free by the edge trigger. No new sim-core element; golden-safe additive.
**Teaches:** the universal flip-flop and its four modes, toggle / divide-by-2 (the counter cell),
how D and T are JK special cases, and why the SR forbidden state becomes JK's most useful one.
**Refsheet:** `jkff-ic.html`.

---

## CEC analog & signal (sources, references, detectors)

Five analog gaps. Each maps to a real sim-core element or a short composition, and each is
single-supply powered (the CEC rule — a reference or a current source you can ask "where does
its energy come from").

### CEC4007 — Constant-Current Source/Sink

*Critical Error Computing · "amps held as steady as a reference holds volts."*

**Description.** The CEC4007 pushes (or pulls) a **fixed current** through whatever you connect
to IOUT, regardless of the load voltage — the current-domain dual of a voltage reference. Drive
an LED at a constant brightness, bias a sensor, charge a capacitor into a perfect linear ramp,
or set the tail current of a differential pair: anywhere the *current* must be the controlled
quantity, not a by-product of `V/R`. Real "current sources" are awkward (a current-regulator
diode is a depletion JFET; a current mirror needs matched transistors) — CEC gives you the ideal
behaviour laid bare so you meet the *idea* of a held current before its imperfect
implementations.

**Features.** Fixed IOUT independent of load voltage (ideal source impedance) · source **or**
sink by orientation · compliance set by the supply rail · the dual of a voltage reference ·
single supply.

**Pin configuration — 4-pin (SOT-23-5 with one N.C., or SOT-23 leadframe):**

| Pin | Name | Function |
|---|---|---|
| 1 | **IOUT** | Constant-current terminal (delivers/draws the set current). |
| 2 | **GND** | Ground / 0 V reference and return. |
| 3 | **ISET** | Sets the output current (a resistor to GND, or a fixed internal value). |
| 4 | **VCC** | Positive supply; sets the output-voltage compliance range. |

**Transfer:** `IOUT = I_set` for all load voltages within compliance (`0 < V(IOUT) < VCC − V_dropout`);
the source "runs out of headroom" (drops out of regulation) outside that window — a teaching
annotation.

**In the sim:** maps directly to **`ELEM_ISOURCE`** (an ideal DC current source: a pure
right-hand-side KCL stamp, no branch unknown, no reactive state — `value` is the set current in
amps). This is exactly how the existing electronic-**LOAD** part in CC mode already maps. No new
sim-core element; golden-safe additive. **Teaches:** current as a controlled quantity, source
vs. sink, compliance/headroom, the duality with a voltage reference.

### CEC4012 — Buffered Voltage Reference

*Critical Error Computing · "one voltage you can trust, on tap."*

**Description.** The CEC4012 produces a **stable, low-impedance reference voltage** on VREF —
the anchor every ADC, DAC, comparator threshold and regulator measures against. Unlike a bare
shunt reference (e.g. the real LM4040, a two-terminal part that needs an external bias resistor
and sinks into a high impedance), the CEC4012 buffers its internal reference so VREF is a
**ready-to-use output** you can wire straight to a divider or an ADC pin — the teaching-optimized
abstraction: the concept "a fixed voltage, independent of supply and load," with the bias network
hidden. Its precision (and, in Real mode, its tempco) is the lesson in *why* references are hard.

**Features.** Fixed VREF independent of supply (above dropout) and of load (buffered, low-Z out) ·
the measurement anchor for ADC/DAC/regulator · internal shunt core, buffered to an output · single
supply.

**Pin configuration — 4-pin (SOT-23-5 with one N.C., or SC70):**

| Pin | Name | Function |
|---|---|---|
| 1 | **VREF** | Buffered reference output (fixed voltage, low impedance). |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **SET** | Selects the reference value (internal tap; pin reserved for trim/option). |
| 4 | **VCC** | Positive supply (must exceed VREF + dropout). |

**Transfer:** `VREF = V_ref` (a fixed value, e.g. 2.5 V), held flat while `VCC > VREF + V_dropout`
and across rated load current.

**In the sim:** a `buildNetlist` composition — an **`ELEM_ZENER`** (its `value` = the breakdown
`Vz`, the stable reference core) biased from VCC through a resistor, then **buffered by an
`ELEM_OPAMP`** in a unity follower so VREF is low-impedance. Both are existing elements; the
Zener's reverse-breakdown model and the op-amp follower are already in the solve. No new sim-core
element; golden-safe additive. (A real temperature-stable bandgap reference — where two opposing
tempcos cancel — is the Real-mode / thermal-`Tj` refinement noted on the roadmap; the Zener core
here teaches the *function* of a reference today.) **Teaches:** a supply-independent reference,
why downstream accuracy rides on it, shunt core vs. buffered output, source/load regulation.

### CEC4023 — Window Comparator

*Critical Error Computing · "in range, or out — one bit for both edges."*

**Description.** The CEC4023 asserts a single output when the input sits **between** a low and a
high threshold, and de-asserts when it strays past either — a "good/bad," "in-band," or "valid
range" detector in one part. A plain comparator answers *above or below one level*; the window
comparator answers *inside or outside a band*, which is what undervoltage/overvoltage supervision,
go/no-go testing, and bracketed alarms actually need. Building it from two comparators makes the
band visible as two stacked thresholds.

**Features.** GOOD = (V_LO < IN < V_HI) · two thresholds bracketing a band · combinational
decision · the supervisor / go-no-go primitive · single supply.

**Pin configuration — 6-pin (SOT-23-6 / SC70-6):**

| Pin | Name | Function |
|---|---|---|
| 1 | **GOOD** | Output: HIGH while V_LO < IN < V_HI, else LOW. |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **IN** | Analog input to test against the window. |
| 4 | **VLO** | Lower threshold (analog). |
| 5 | **VHI** | Upper threshold (analog). |
| 6 | **VCC** | Positive supply (output logic-high rail). |

**Transfer:** `GOOD = (IN > VLO) AND (IN < VHI)` — high only inside the band, low above VHI or
below VLO.

**In the sim:** a `buildNetlist` composition of **two `ELEM_COMPARATOR`** (the ADCMP601-modelled
latched comparator, used in plain mode: `value` = 0 for no hysteresis, `LE` unwired so it runs
transparent) — one testing `IN > VLO`, one testing `VHI > IN` — merged by one powered **AND**
`ELEM_GATE`. All existing elements; the comparators drive clean digital levels the gate ANDs. No
new sim-core element; golden-safe additive. **Teaches:** thresholds and bands, combining
comparisons, voltage supervision (UV/OV), go/no-go testing.

### CEC4031 — Peak Detector

*Critical Error Computing · "it remembers the highest it ever saw."*

**Description.** The CEC4031 captures and **holds the peak** of its input: as IN rises, OUT
follows it up; when IN falls, OUT *stays* at the highest value reached (until reset). It is how
an envelope is extracted from a waveform — AM demodulation, an audio VU/peak meter, capturing a
transient's amplitude, an envelope follower. The mechanism is a one-way valve into a reservoir
(charge the cap on the way up, block it on the way down), so the part teaches rectify-and-store
directly. No tidy single-chip peak detector exists in jellybean form; it has always been a diode,
a capacitor, and (for precision) an op-amp.

**Features.** OUT tracks IN upward, holds the maximum when IN falls · diode-into-capacitor
charge store · envelope / peak capture · optional reset · single supply.

**Pin configuration — 5-pin (SOT-23-5 / SC70-5):**

| Pin | Name | Function |
|---|---|---|
| 1 | **OUT** | Peak output: rises with IN, holds the maximum reached. |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **IN** | Analog input whose peak is captured. |
| 4 | **RST** | Reset (discharges the hold capacitor toward GND). |
| 5 | **VCC** | Positive supply. |

**Transfer:** `OUT = max(IN)` since the last reset (precision version cancels the diode drop);
`OUT` decays slowly per the hold time (a teaching annotation) and snaps to ~0 on RST.

**In the sim:** a `buildNetlist` composition of existing elements — an **`ELEM_DIODE`** (one-way
charge path) into an **`ELEM_CAPACITOR`** (the reservoir, a backward-Euler companion that *holds*
charge between updates), with RST modelled as a switched/resistive bleed to GND; the **precision**
variant wraps an **`ELEM_OPAMP`** around the diode (the follower charges the cap to the true peak,
cancelling the forward drop). All existing elements; the cap's reactive state is what gives the
hold. No new sim-core element; golden-safe additive. **Teaches:** rectify-and-store, envelope
detection, the diode as a one-way valve, capacitor charge storage / hold.

### CEC4044 — Transconductance Cell (V→I)

*Critical Error Computing · "voltage in, current out — the thing a transistor really is."*

**Description.** The CEC4044 turns an input **voltage** into an output **current**: `IOUT = gm ·
VIN`. That voltage-to-current conversion — *transconductance* — is the actual primitive a
transistor performs (a MOSFET's gate voltage sets its drain current; the engine literally
linearizes every active device into a `gm`), and it is the core of an operational transconductance
amplifier (OTA), a gm-C filter, and a multiplier. Exposing gm by itself — as a single cell whose
output is a current you watch flow — demystifies what "gain" is before it is buried inside an
op-amp. The real OTA (e.g. an LM13700) is a multi-pin dual with bias and buffer pins; CEC strips
it to the one idea.

**Features.** IOUT = gm · VIN (voltage controls a current) · the OTA / gm-C core · the
transistor's defining action laid bare · single supply.

**Pin configuration — 5-pin (SOT-23-5 / SC70-5):**

| Pin | Name | Function |
|---|---|---|
| 1 | **IOUT** | Output current, proportional to VIN (sourced/sunk into the load). |
| 2 | **GND** | Ground / 0 V reference and source return. |
| 3 | **VIN** | Control input voltage (relative to GND). |
| 4 | **IABC** | Sets gm (amplifier bias current); pin reserved for the gm control. |
| 5 | **VCC** | Positive supply. |

**Transfer:** `IOUT = gm · VIN` over the linear range (square-law/tanh roll-off at large |VIN|,
exactly as the device model bends — a teaching annotation), with gm set by IABC.

**In the sim:** maps to a single **`ELEM_NMOS`** (drain = IOUT, source = GND, gate = VIN): the
MOSFET *is* a transconductor — the core linearizes it into a transconductance `gm` (from the gate)
and an output conductance `gds`, which is precisely `IOUT = gm·VGS`. (A more ideal V→I — a true
voltage-controlled current source independent of output voltage — is an op-amp + sense-resistor
Howland composition, also from existing elements, if `gds`-flatness matters.) No new sim-core
element; golden-safe additive. **Teaches:** transconductance (V→I), what gain *is* at the device
level, the OTA / gm-C building block.

### CEC4055 — Analog Sample-and-Hold

*Critical Error Computing · "a voltage, frozen in time."*

**Description.** The CEC4055 follows its analog input while TRACK is high and, the instant TRACK
goes low, **freezes** the input's value on OUT and holds it steady. It is the front end of every
ADC (catch the input so it cannot move mid-conversion), the deglitcher on a DAC, and the analog
memory in any multiplexed measurement. Where the CEC1041 captures one *bit*, the CEC4055 holds the
full analog *value*.

**Features.** Track-and-hold of an analog value · follows IN when TRACK = 1, freezes when TRACK = 0
· the ADC front-end / analog memory · single supply.

**Pin configuration — 5-pin (SOT-23-5 / SC70-5):**

| Pin | Name | Function |
|---|---|---|
| 1 | **OUT** | Held analog output (follows IN, or holds the frozen value). |
| 2 | **GND** | Ground / 0 V reference. |
| 3 | **IN** | Analog input to track / sample. |
| 4 | **TRACK** | HIGH = follow IN (sample); LOW = freeze (hold). |
| 5 | **VCC** | Positive supply. |

**Function.** TRACK = 1 → `OUT` tracks `IN`; TRACK = 0 → `OUT` holds the last sampled value.

**In the sim:** a `buildNetlist` composition of existing elements — the new **`ELEM_ASWITCH`**
(CTRL = TRACK) feeding a hold **`ELEM_CAPACITOR`** to GND, buffered by an **`ELEM_OPAMP`** unity
follower so OUT is low-impedance and never loads the cap. TRACK high closes the switch and the cap
follows IN; TRACK low opens it and the cap's backward-Euler companion **holds** the charge — the
exact mechanism the gated switch was built for (proven by the `aswitch_sample_and_hold` test). No
new sim-core element; golden-safe additive. **Teaches:** track-and-hold, analog memory, the ADC
front end, why the hold cap and a clean switch matter.

---

## Parts that wait on an engine mechanism

The **gated analog switch landed** (`ELEM_ASWITCH`), so the sample-and-hold above — and with it
**switched-capacitor** circuits (switches + caps standing in for resistors) and the **analog mux**
(one switch per channel + a decoder) — are now buildable from existing elements. What still waits
on a not-yet-built mechanism is **named here but not given a full card** (it would otherwise
mis-teach against the sim):
- **Voltage-controlled oscillator (V→frequency)** — every time-varying source (`ELEM_ACSOURCE`,
  the PULSE/SWITCH mapping) takes its frequency as a **fixed param**, a pure function of `tick`, not
  of a live node voltage. A true VCO is **[needs: a voltage-controlled time-varying source]** (a
  frequency that reads a control node each tick) — deferred with the behavioral/multi-rate work.
- **Monostable one-shot** (retriggerable edge → fixed-width pulse) — the *core* is buildable today
  (comparator + RC + the CEC3007 SR latch), but a clean **retriggerable** one-shot wants the same
  edge-to-timer plumbing the 555 monostable uses; partially buildable, deprioritized in favour of
  using the real **LMC555** (which has a clean minimum-pin part) for timing.
- **Clock divider (÷N)** — deliberately **skipped**: the single D flip-flop (real **74LVC1G80**,
  5-pin) with `Q̄→D` already *is* the ÷2 divider stage, so a CEC version would duplicate a clean
  real minimum-pin exemplar (see `new-part-refsheets.md`). Chain N flip-flops for ÷2ⁿ.

---

## The arc

Read together, the original four are a tiny computer in kit form: **CEC1041** quantizes the
world in, **CEC2018** computes on it, **CEC3007** remembers the result, **CEC1083** turns it
back into a voltage. Convert → compute → store → reconstruct, each a single CEC glyph,
each at its minimum honest pin count — and (with the existing sampler/gate/resistor
elements) each buildable in-sim today, golden-safe, the moment its refsheet is drawn.

The second wave widens that spine into the rest of the curriculum without leaving the same
ground: **route and compute** (the half-adder CEC2024, the mux/demux pair CEC2031/CEC2032,
the voter CEC2046, the bus driver CEC2057), **the level-vs-edge bridge in memory** (the
transparent latch CEC3014, sitting between the SR latch and the flip-flop), and **the analog
anchors and detectors** (a held current CEC4007, a buffered reference CEC4012, a window
CEC4023, a peak hold CEC4031, and transconductance itself CEC4044). Every one is the same
contract as the first four — minimum honest pins, always powered, output-on-pin-1 (or the
74-series order for a bare gate), and a real sim backend: a powered-gate composition, a single
`ELEM_ISOURCE` / `ELEM_ZENER` / `ELEM_NMOS`, or a pair of `ELEM_COMPARATOR`s — all golden-safe
additive. The gated analog switch (`ELEM_ASWITCH`) since landed, pulling the sample-and-hold
(and switched-cap, and the analog mux) onto that same ground. The few honest gaps that remain (a
true V→frequency VCO, a retriggerable one-shot) are named, not faked: they wait on a named engine
mechanism so no glyph ever teaches something the simulator cannot do.

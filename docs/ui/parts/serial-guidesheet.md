<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: CEC serial blocks (SPI master/slave + UART), three five-tier IC glyphs

A standalone brief for the design agent. Build **three** five-tier IC glyphs for the CEC Foundations
Series **serial blocks** -- house teaching chips that move a word over wires one bit at a time. Read this
top to bottom. For the verbatim house infrastructure follow **`ic-glyph-spec.md`**; for the authoritative
part specs and CEC house conventions follow the **CEC Foundations catalogue** (`cec-teaching-ics.md`, in
the kit -- the new `5xxx` interface/communication section).

**The three deliverables (each a standalone self-contained HTML file):**

| Output file | Part | Function |
|---|---|---|
| `docs/ui/parts/spi-master-ic.html` | **CEC5021** SPI Master | owns SCLK; START shifts a word out MSB-first on MOSI, reads MISO, CS frames |
| `docs/ui/parts/spi-slave-ic.html` | **CEC5022** SPI Slave | clocked by external SCLK; shifts reply out on MISO, receives MOSI, RXVALID |
| `docs/ui/parts/uart-ic.html` | **CEC5232** UART | async, no clock; SEND frames a byte on TX (start + data LSB-first + stop), receives RX |

These are **CEC house parts** (no real-manufacturer names): `chipType` = the CEC number, the Critical
Error brand mark. Build the **SPI master first as the worked template** (section 5), then the SPI slave and
the UART as deltas (section 6).

**You are not starting from scratch:**

- **`dff-ic.html` is the primary base.** A serial block is a **shift register + a control FSM**, and the
  shift register is a chain of D flip-flops -- exactly the cell `dff-ic` draws. Take its shell, its DFF
  symbol/drawing, and -- crucially -- its **timing-diagram scope** (a serial block's scope is a protocol
  waveform).
- **`jkff-ic.html` is the gate/sequential-composite reference** -- the `andG`/`orG`/`invTri` helpers, the
  CEC branding, the powered gate-level wiring style for the counter and the FSM logic.

- **`<title>`s:** `SPI master, five layers` · `SPI slave, five layers` · `UART, five layers`. Make the
  `<h1 class="lede">`, header `chipType` (CEC5021 / CEC5022 / CEC5232), device-tier name, and `names` map
  match. **Grep each finished file for stale strings from whatever you cloned, and update the model
  COMMENT block, not just visible text** (recent builds left stale `// CECxxxx ...` comments above correct
  models; do not repeat that).

---

## 0. The shared idea

**Serial is a parallel word sent one bit at a time through a shift register.** Load a register with a
word; clock it, and each tick the bits march one position and the end bit falls onto the wire; clock N
times and the whole word has gone out, most- or least-significant-bit first. Receiving is the reverse:
shift the incoming line in, one bit per clock, until the register is full. Everything else is **framing
and timing**:

- **SPI (CEC5021 master / CEC5022 slave)** is **synchronous** -- the master sends a clock (SCLK) alongside
  the data, so there is no rate to agree on; MSB-first; full-duplex (out on MOSI and in on MISO on the
  same edges); CS frames the transfer. Master and slave are the two ends of one bus.
- **UART (CEC5232)** is **asynchronous** -- no clock wire at all. Both ends agree a baud rate; each byte is
  framed by a START bit and a STOP bit so the receiver can find it; LSB-first; the receiver samples each
  bit mid-window so small clock differences do not matter.

## 1. The "real device" for a behavioral FSM block = the REGISTER-TRANSFER LEVEL

These parts are not a single transistor cell (like the comparator) nor a flat gate composition (like the
half-adder) -- they are **finite-state machines**. Drawing every transistor (thousands) or every gate
(hundreds) would teach nothing. So the honest "real device" tier is the **register-transfer level (RTL)**:

- **Tier 4 (real device) = the RTL datapath.** Draw the **shift register as a chain of real D flip-flops**
  (use the `dff-ic` flip-flop symbol; 8 cells for a byte is concrete and enough), the **bit counter** (a
  few flip-flops or a labeled counter block), and the **control logic** (the clock generator / edge
  detector / framing FSM) drawn from the gate-symbol helpers. Wire the protocol pins to it. This is the
  device a digital engineer actually sees -- registers and control, not a transistor sea.
- **Tier 5 (silicon) = one representative cell in real silicon.** Expand **one flip-flop of the shift
  register** to its CMOS (the master-slave latch pair, n-well PMOS / p-substrate NMOS), with a note that
  the register is N of these. This is where RTL becomes silicon -- the bridge, via one honest cell.

(Tiers 2-3 stay the analogy, section 4.)

**Apply the spec's tier zoom-pairs and FET-level analogy (spec section 1).** Tier 4 is the zoom-in of
tier 1 (the symbol opened into the full datapath) and tier 3 is the zoom-in of tier 2 (the flow analogy
opened into its working parts) -- same part, same pins, more detail. And carry the analogy all the way
down: the glyph is made to be zoomed, so build it complete and let every component open, never an opaque
block. At the RTL scale you decompose to flip-flops and gates rather than drawing a thousand transistors,
but each of those still has its FET-level valve form (a D flip-flop is a pair of cross-coupled latches,
each a few pressure-pilot valves) -- so in the analogy track draw the shift/framing mechanism as real
analogy parts (a flip-flop as its latch-valves where it fits), not labeled rectangles, so a learner
zooming in keeps seeing mechanism down to the FET, not a dead end.

## 1b. THE NO-STUBS MANDATE (carry it forward; these parts have the most pins)

**Every pin must be drawn fully connected to the working datapath and shown doing its job. Nothing is a
decorative stub; nothing is simplified out -- VCC and GND especially.** VCC/GND are real rails powering
the flip-flops and the FSM logic (these are powered blocks); every bus pin -- SCLK, MOSI, MISO, CS, START,
RXVALID, TX, RX, SEND -- traces by an unbroken wire from the package to where it drives or is driven in the
datapath. The render is the test: point at any pin and follow an unbroken wire to its real role. (Recent
latch builds shipped with a tier-2 output pin and a tier-5 fed-back signal left as dangling stubs -- the
render caught them; do not ship them.)

## 2. The shared build approach

- Shell, the **DFF symbol**, and the **timing-diagram scope** from `dff-ic.html`; the gate helpers
  (`andG`/`orG`/`invTri`), CEC branding, and powered-wiring style from `jkff-ic.html`.
- **The live model is the FSM** (a small state machine you write): a shift register (an array of bits), a
  bit counter, a clock/baud counter, and the control state (idle / active, CS, framing). Advance it per
  frame; drive the pins and the scope from it. It is a **scaled** teaching animation (bits visibly march),
  not real ns/baud.
- Each maps to an `ELEM_BEHAVIORAL` program (section 8); the RTL in tier 4 should picture that FSM.

## 3. CEC house identity and pinouts (from the catalogue)

- **CEC5021** SPI master -- 7-pin (SOT-23-8, one N.C.): `1 SCLK · 2 MOSI · 3 MISO · 4 CS · 5 START ·
  6 VCC · 7 GND`. Tagline: *"one clock to run the bus."*
- **CEC5022** SPI slave -- 7-pin (SOT-23-8, one N.C.): `1 MISO · 2 RXVALID · 3 SCLK · 4 MOSI · 5 CS ·
  6 VCC · 7 GND`. Tagline: *"speak only when clocked."*
- **CEC5232** UART -- 6-pin (SOT-23-6): `1 TX · 2 RX · 3 RXVALID · 4 SEND · 5 VCC · 6 GND`. Tagline:
  *"two wires, no clock, an agreement on speed."*

`chipType` = the CEC number; no real-manufacturer name. Adapt `drawPkg` per `ic-glyph-spec.md` §7.3.

## 4. The five-tier arc (shared pattern)

**Tier 1 -- symbol + pinout + the protocol waveform.** The block symbol on the CEC pinout, a one-line
function note, and the **protocol timing diagram** as the scope (section 7) -- this is the signature of a
serial part and the payoff.

**Tier 2 -- flow network (analogy, build rich, no stubs).** The shift register as a **bit conveyor / bucket
brigade**: a parallel word loaded into a row of buckets, marching one position per clock tick and tipping
the end bit onto the output wire; framing (CS, or START/STOP) as the gate that opens the stream. The clock
is the conveyor's drive.

**Tier 3 -- pressure-pilot valves (analogy, build rich, no stubs).** The clocked-shift mechanism as
pressure-pilot valves: each tick a valve advances every stage by one; the framing valve admits the stream
only during a transfer.

**Tier 4 -- RTL datapath (real flip-flops + control, powered, no stubs).** The shift register as a chain of
real D flip-flops, the bit counter, and the clock/edge/framing logic from the gate helpers; the protocol
pins wired in; VCC/GND powering every flip-flop and gate. Animate from the model: the bit marching through
the register, the counter advancing, CS/START (or START/STOP) framing.

**Tier 5 -- silicon (one real flip-flop cell).** One shift-register flip-flop expanded to CMOS (the
master-slave latch pair), real cross-section, with "x N for the register" noted.

## 5. Worked template -- CEC5021 SPI Master (build this first, in full)

- **Pinout:** `1 SCLK · 2 MOSI · 3 MISO · 4 CS · 5 START · 6 VCC · 7 GND` (7-pin, SOT-23-8 + N.C.).
- **The datapath (tier 4):** an **8-bit shift register** holding the TX word, its MSB driving **MOSI**; a
  parallel path shifting **MISO** into a receive register; a **bit counter** (counts the 8 bits); a **clock
  generator** that toggles **SCLK** at the half-period while active; and the **control FSM**: a rising edge
  on **START** asserts **CS** low and runs SCLK for 8 bits (each falling/rising edge shifts), then releases
  CS. Mode 0 (SCLK idles low; MOSI changes on the falling edge, MISO sampled on the rising). Draw all of
  it, powered, every pin wired.
- **Model:** state = {idle/active, the 8-bit TX register, the RX register, bit index, SCLK level, CS}. On
  START edge -> active, CS low, load TX word; each step toggles SCLK, and on the sampling edge shifts MOSI
  out (MSB first) and MISO in; after 8 bits -> idle, CS high.
- **Scope -- the SPI waveform (the payoff):** **CS** going low to frame, **SCLK** pulsing 8 times, **MOSI**
  presenting the 8 bits MSB-first aligned to the clock, **MISO** the reply -- the classic SPI transaction.
  Make pressing START run one visible byte; show the bits leaving the shift register.
- **Teaches:** synchronous serial, the shift register as parallel-to-serial, full-duplex, CS framing,
  master clocking.

## 6. Deltas

**CEC5022 SPI Slave** -- *"speak only when clocked."* 7-pin `1 MISO · 2 RXVALID · 3 SCLK · 4 MOSI · 5 CS ·
6 VCC · 7 GND`. Same shift-register datapath, but **no clock generator** -- SCLK is an **input**; add an
**edge detector** on SCLK (rising edge = shift). While CS low, each SCLK rising edge shifts MOSI into the
receive register and shifts the reply register out on MISO (MSB first); at the 8th bit, raise **RXVALID**.
Tier 4: the shift register clocked by the external SCLK edge-detect, the bit counter, RXVALID logic, CS
gating. Scope: the master's SCLK/CS driving it, MOSI in, MISO reply out, RXVALID pulsing at frame end.
Teaches the slave half: it is the same register, clocked from outside.

**CEC5232 UART** -- *"two wires, no clock."* 6-pin `1 TX · 2 RX · 3 RXVALID · 4 SEND · 5 VCC · 6 GND`. The
asynchronous one: **no shared clock**, so add a **baud-rate counter** (divides the system tick down to one
bit-time) that paces everything. TX path: on **SEND** rising, load the word and frame it on TX -- a START
bit (low), then 8 data bits **LSB-first**, then a STOP bit (high), one bit per baud period; idle high
between. RX path: watch **RX** for the falling START edge, then sample each of 8 bits at **mid-bit** (1.5
bit-times after the edge, then every bit-time), assembling LSB-first, and pulse **RXVALID** when the byte
lands. Tier 4: the TX shift register + the framing FSM + the baud counter + the RX sampler (start-edge
detect + mid-bit sample + RX register). Scope: the framed **TX** byte (mark the START / data / STOP bits)
and an **RX** byte arriving with RXVALID. Teaches async serial, START/STOP framing, baud, mid-bit sampling.

## 7. Controls and scope

- **Controls:** a **trigger** (START for the master, SEND for the UART; a single-step or run button), and
  a small **data-word** control (the byte being sent -- a few preset bytes or a hex entry is enough). The
  SPI slave is driven by an incoming SCLK/CS, so give it a **"clock a frame in"** button (simulate the
  master). A clock-rate / baud control is a nice extra. No analog sliders.
- **Scope -- the protocol timing diagram (the payoff, per part).** SPI: CS, SCLK, MOSI, MISO on a shared
  time axis, one byte framed. UART: TX (with the START / data / STOP bits marked) and RX with RXVALID.
  This iconic waveform is the whole point of a serial part; make the trigger produce one clean, legible
  transaction and tie it to the bits moving through the tier-4 shift register.

## 8. Sim backend mapping (already wired; the glyph should agree)

Each maps to `ELEM_BEHAVIORAL` (sim type 25), a small FSM in the core, selected by the program id in
`value`: **SPI master = 1, SPI slave = 2, UART = 3**. The transmitted/reply word is `aux`; the config
(SPI half-period + bit count; UART baud + bit count) is in `params`. The terminal map routes the pins to
the core's 8 terminals (the web `BEH_SPEC` already does this). The glyph teaches the same FSM the core
runs: a shift register clocked out/in with framing. (No new sim-core element; the parts are already
placeable.)

## 9. House style, validation, handback (per part)

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** line 1. **CSS/fonts/tokens** verbatim from `dff-ic.html`; Saira / Saira Condensed / IBM Plex
  Mono; keep the Critical Error brand mark.
- **Forbidden glyphs** (§10 check `none`/`0`): em-dash, en-dash, arrows (U+2192/2190/2194), the minus sign
  (U+2212), smart quotes, `&mdash;`/`&ndash;`. ASCII hyphen-minus and "to"; the middle dot `·` is fine.
- **§10 gates, on EACH file:** (1) `node --check`; (2) forbidden-glyph check; (3) `grep -c "drawPkg(gT"` =
  **5**; (4) per-tier member consistency; (5) a **Playwright render of all five tiers** (mandatory) --
  trigger a transaction and watch one byte move through every tier; screenshot and fix collisions /
  off-canvas labels (the RTL tier is the densest -- budget the layout). If you cannot run the render, say
  so per file.
- **Handback checklist (per part):**
  - **No stubs:** every pin (VCC, GND, and every bus pin) traces by an unbroken wire to where it does work;
    VCC/GND power every flip-flop and gate; nothing simplified out.
  - **CEC house identity:** chipType/title/lede/device-tier/`names` = the CEC number + function; brand mark;
    no real-manufacturer name; pin order per the catalogue. Model COMMENT block updated.
  - **Real device = RTL:** tier 4 is the shift-register + counter + control datapath drawn with real
    flip-flop symbols and gates, powered; tier 5 is one real flip-flop cell in silicon.
  - **Analogy tiers kept;** the protocol-timing scope shows one clean transaction tied to the bits moving in
    tier 4; the per-part lesson (synchronous full-duplex / clocked slave / async framing) is explicit.
  - **All §10 gates pass clean** (or the render is flagged for the owner).

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: CEC2057 tri-state buffer, five-tier IC glyph

A standalone brief for the design agent. Build a five-tier IC glyph for the **CEC2057 Tri-State Buffer**
-- a CEC house teaching chip: a buffer with a third output state, **high-impedance (Hi-Z)**. Read this
top to bottom. For the verbatim house infrastructure follow **`ic-glyph-spec.md`** (note the section 1
tier zoom-pairs + FET-level analogy); for the authoritative part spec and CEC house conventions follow
the **CEC Foundations catalogue** (`cec-teaching-ics.md`, in the kit).

**You are not starting from scratch:**

- **`buf-ic.html` is the base.** A tri-state buffer is a buffer (A to Y) with an output stage that can be
  released. Take its shell, the SOT-23-5 `drawPkg`, the CMOS buffer drawing, the valve/device/silicon
  tiers, and the scope chrome.
- **`inv-ic.html` is the canonical CMOS-stage reference** -- the pressure-pilot valve analogy (tier 3),
  the CMOS schematic (tier 4), and the metal-oxide cross-section (tier 5) for a complementary stage, plus
  the inverter you need for the not-OE control line.

- **Output file:** `docs/ui/parts/tri-state-ic.html`
- **`<title>`:** `Tri-state buffer, five layers` -- set this; make the `<h1 class="lede">`, header
  `chipType` (**CEC2057**), device-tier name, and `names` map match. CEC house part: no real-manufacturer
  name. Grep for stale strings from `buf-ic` ("buffer, five" only where right; no "NOT gate", "inverter,
  five", "74") and update the model COMMENT block.

---

## 0. The one idea

**A third output state: high-impedance.** A plain buffer always drives its output to 0 or 1. The CEC2057
adds an enable: when **OE is high it drives Y = A**; when **OE is low it RELEASES Y entirely** -- not high,
not low, just **electrically disconnected** from both rails (Hi-Z). That third state is the whole idea of a
shared **bus**: many tri-state drivers on one wire, exactly one enabled at a time, the rest absent. Hi-Z
has no waveform, so it must be met as a concept -- and the cleanest way to *see* it is at the FET level:
**both output transistors turned off, so Y hangs on nothing.**

## 1. The real device + the new tier framing (FET-level Hi-Z is the whole point)

Per spec section 1: the tiers are zoom-pairs -- tier 4 is the zoom-in of tier 1, tier 3 the zoom-in of
tier 2 -- and the analogy carries all the way down to the FETs. For this part that pays off beautifully,
because **Hi-Z is a FET-level event**:

- **Tiers 2-3 (analogy, build rich).** The buffer as a flow network (tier 2) with OE as a master control;
  tier 3 opens the output stage as its two **pressure-pilot valves** -- a pull-up valve (to VCC) and a
  pull-down valve (to GND). The key frame: when OE is low, **both valves are shut**, so Y is connected to
  neither tank -- it just floats (Hi-Z). When OE is high, exactly one valve opens per the input, driving Y.
  Draw the float state explicitly (no flow path to Y, Y greyed/dotted).
- **Tiers 4-5 (real, FET-level).** Tier 4 is the real **OE-gated CMOS output stage**: an output **PMOS**
  (to VCC) and output **NMOS** (to GND) driving Y, with the gating logic that forces **both off** when OE
  is low. Tier 5 is the metal-oxide cross-section of that PMOS/NMOS pair, with the inversion channels
  **both absent** in the Hi-Z case. Drawn via the spec's `mosfet` helper; show Y disconnected when OE low.

No stubs: every pin (Y, GND, A, OE, VCC) traces by an unbroken wire to its role; VCC/GND power the stage;
the Y pin clearly shows its three states (driven high, driven low, released).

## 2. The part and its real internal cell

- **Identity:** **CEC2057 Tri-State Buffer**, tagline *"drive it, or get off the bus."* Single supply;
  three output states (0, 1, Z); the bus-driver / output-enable primitive.
- **The real OE-gated output stage (draw this in tiers 4-5):** the classic CMOS tri-state.
  - Output **PMOS** (source to VCC, drain to Y) with gate = **NAND(A, OE)**: when OE = 1 the gate is
    not-A, so the PMOS pulls Y high for A = 1; when OE = 0 the gate is forced high, PMOS **off**.
  - Output **NMOS** (source to GND, drain to Y) with gate = **NOR(A, not-OE)** (i.e. not-A AND OE): when
    OE = 1 it pulls Y low for A = 0; when OE = 0 the gate is forced low, NMOS **off**.
  - A small **not-OE inverter** feeds the NOR. (So OE = 1 makes the stage a buffer, Y = A; OE = 0 turns
    both output FETs off, Y = Hi-Z.)
  - Draw the **output PMOS/NMOS as explicit FETs** (this is where Hi-Z lives -- both off, Y floating); the
    NAND / NOR / inverter control may be drawn as gate symbols that each open to their own FET-valves
    (per the spec's "decompose to gates, each opening to FETs" rule).
- **Device family:** all **CMOS**; reuse the `mosfet` helper.

## 3. Package frame and pinout (shared by all five tiers)

**5-pin SOT-23-5 / SC70-5**, CEC house order (output on pin 1):

| Pin | Name | Function | Connection contract |
|---|---|---|---|
| 1 | **Y** | three-state output: A when enabled, **Hi-Z** when not | the output node + the live state (0 / 1 / Z) |
| 2 | **GND** | ground / 0 V | bottom rail; the output NMOS source |
| 3 | **A** | data input | into the buffer / the gating logic |
| 4 | **OE** | output enable (HIGH = drive Y; LOW = release to Hi-Z) | the gating logic (NAND + NOR + the not-OE inverter) |
| 5 | **VCC** | positive supply | top rail; the output PMOS source |

Adapt the `buf-ic` SOT-23-5 `drawPkg`; set `chipType` = CEC2057 and the `names` map.

## 4. The live model (interactive state, per frame)

A buffer with an enable and three output states. State: input `A`, enable `OE`, and the resulting output
which is one of **drive-high / drive-low / Hi-Z**.

```js
// OE high: Y follows A (driven). OE low: Y released (Hi-Z) - neither rail.
var out = (OE === 0) ? 'Z' : (A ? 1 : 0);
// expose: out ('0' | '1' | 'Z'), and per-device: pullUpOn = (OE&&A), pullDownOn = (OE&&!A), both off => Z
```

Expose on the model record `s`: `A`, `OE`, `out`, and the two output-device states (`pullUpOn`,
`pullDownOn`) so the valve/FET tiers light the right transistor and show **both off** in Hi-Z. For the bus
demo (section 7), a second driver and a shared net are useful. Scaled teaching animation.

## 5. The five-tier arc

**Tier 1 -- symbol + pinout + function table.** The tri-state buffer symbol (a buffer triangle with the OE
enable line into its side) on the CEC pinout, the function table **OE A -> Y** including the **Z** row
(0 X -> Z, 1 0 -> 0, 1 1 -> 1), and a live state note (driving 0 / driving 1 / **Hi-Z released**).

**Tier 2 -- flow network (analogy, build rich).** The buffer as plumbing with OE as a master control;
when OE drops, the output is cut off from both the supply tank and the drain -- Y floats. Show the float.

**Tier 3 -- pressure-pilot valves (analogy, FET-level).** The output stage as a pull-up valve (to VCC)
and a pull-down valve (to GND). OE high: one valve opens per A, driving Y. **OE low: both valves shut, Y
connected to nothing -- Hi-Z.** This shut-both-valves picture is the teaching heart; make it unmistakable.

**Tier 4 -- real device (OE-gated CMOS output stage, FET-level).** The output PMOS (to VCC) and NMOS (to
GND) driving Y, gated by NAND(A,OE) and NOR(A,not-OE) with the not-OE inverter; via the `mosfet` helper.
Light the conducting output FET when OE high; show **both off and Y disconnected** when OE low. No stubs.

**Tier 5 -- silicon.** The metal-oxide cross-section of the output PMOS/NMOS pair (n-well PMOS, p-substrate
NMOS); show the inversion channels present (driving) vs **both absent** (Hi-Z, Y on nothing).

## 6. Hi-Z is the lesson -- make it visible, and put it on a bus

Hi-Z has no waveform, so do not try to scope it as one. Instead:
- **Show the released output:** in every tier, when OE is low, Y is visibly disconnected (greyed/dotted,
  no flow path, both FETs off) -- distinct from a driven 0 (low but connected). The 0 / 1 / **Z** trichotomy
  must read at a glance.
- **The bus payoff (section 7):** the reason Hi-Z exists is the shared bus -- so the headline visual is
  several tri-state drivers on one wire, one enabled, the rest released.

## 7. Controls and scope

- **Controls:** input **A** and enable **OE** toggles. For the bus demo, a small **second driver** (its
  own A and OE) sharing the Y net is the ideal extra control.
- **Scope -- the shared bus (the payoff).** Instead of a waveform, draw the **bus picture**: two (or
  three) CEC2057 buffers wired to one shared net, each with its A and OE; the enabled one drives the bus
  to its A, the others sit Hi-Z (released, drawn disconnected). Toggle which is enabled and the bus value
  follows it. Show the **bus-conflict hazard**: enable two with different A and the net resolves to **X**
  (contention) -- the deliberate teaching hazard. This bus diagram is the iconic tri-state lesson; make it
  the centerpiece (a simple 0/1/Z/X readout on the shared net).

## 8. Sim backend mapping (already wired; behavior must agree)

The `TRI` part is live as a `buildNetlist` composition over the digital domain's four-state `Z`: the
honest, golden-safe build is a powered buffer whose **VCC rail is gated by OE** (OE low collapses the rail
below the gate's operating minimum, so the gate goes **dead-rail and releases Y to Z**; OE high restores
it and drives A). Two enabled drivers on a net resolve through the IEEE-1164 `combine()` rule (Z yields to
a real driver; two disagreeing strong drivers -> X). **The glyph teaches the real OE-gated output stage**
(the standard tri-state), which gives the identical Y = A / Hi-Z behavior; note in the footnote that the
sim achieves the same Hi-Z via the dead-rail composition (and that a native OE-gated Z is a noted future
engine refinement). Either way the lesson -- drive, or release to Hi-Z -- is the same.

## 9. House style, validation, handback

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** line 1. **CSS/fonts/tokens** verbatim from `buf-ic.html`; Saira / Saira Condensed / IBM Plex
  Mono; keep the Critical Error brand mark.
- **Forbidden glyphs** (§10 check `none`/`0`): em-dash, en-dash, arrows (U+2192/2190/2194), the minus sign
  (U+2212), smart quotes, `&mdash;`/`&ndash;`. ASCII hyphen-minus and "to"; the middle dot `·` is fine.
  Write "Hi-Z" with the ASCII hyphen.
- **§10 gates:** (1) `node --check`; (2) forbidden-glyph check; (3) `grep -c "drawPkg(gT"` = **5**;
  (4) per-tier member consistency; (5) a **Playwright render of all five tiers** (mandatory) -- toggle OE
  (and the bus drivers) in every tier; screenshot and fix collisions / off-canvas labels. If you cannot
  run the render, say so.
- **Handback checklist:**
  - **CEC identity:** chipType/title/lede/device-tier/`names` = CEC2057 / tri-state buffer; brand mark; no
    real-manufacturer name; pin order per the catalogue. Model COMMENT block updated.
  - **FET-level Hi-Z:** tier 3 shows both output valves shut (Y floating) when OE low; tier 4 the real
    OE-gated PMOS/NMOS output stage both-off; tier 5 the channels both absent. Hi-Z is unmistakable and
    distinct from a driven 0.
  - **No stubs:** every pin traces to its role; VCC/GND power the stage; Y shows 0 / 1 / Z.
  - **The bus lesson lands:** the shared-bus diagram is the centerpiece, with the two-driver contention
    -> X hazard shown.
  - **All §10 gates pass clean** (or the render is flagged for the owner).

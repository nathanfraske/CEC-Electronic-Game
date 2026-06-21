<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: CEC combinational composites (5 five-tier IC glyphs)

A standalone brief for the design agent. Build **five** five-tier IC glyphs for the CEC Foundations
Series **combinational composites** -- house teaching chips that combine logic-gate primitives into a
function. Read this top to bottom. For the verbatim house infrastructure follow **`ic-glyph-spec.md`**;
for the authoritative part specs and CEC house conventions follow the **CEC Foundations catalogue**
(`cec-teaching-ics.md`, in the kit).

**The five deliverables (each a standalone self-contained HTML file):**

| Output file | Part | Function |
|---|---|---|
| `docs/ui/parts/half-adder-ic.html` | **CEC2024** 1-Bit Half-Adder | SUM = A ⊕ B, COUT = A · B |
| `docs/ui/parts/full-adder-ic.html` | **CEC2018** 1-Bit Full Adder | SUM = A ⊕ B ⊕ CIN, COUT = majority(A,B,CIN) |
| `docs/ui/parts/mux-ic.html` | **CEC2031** 2:1 Multiplexer | Y = SEL ? B : A |
| `docs/ui/parts/demux-ic.html` | **CEC2032** 1:2 Demultiplexer | Y0 = D·¬SEL, Y1 = D·SEL |
| `docs/ui/parts/majority-ic.html` | **CEC2046** Majority / Voter | Y = AB + BC + CA |

These are **CEC house parts** (no real-manufacturer names): `chipType` = the CEC number, the Critical
Error brand mark, the house pin convention. Build the **half-adder first as the worked template**
(section 5), then the other four as deltas (section 6) -- they share ~90% of the structure.

**You are not starting from scratch:**

- **`jkff-ic.html` is the composite-structure base.** It is a CEC house composite (CEC3076) whose tier 4
  is a **gate-level schematic drawn with logic-gate-symbol helpers** -- `andG`, `orG`, `invTri` (AND, OR,
  inverter) -- wired by labeled internal nets, and whose tier 5 is **real MOS silicon**. Copy its CSS,
  fonts, helpers, the CEC branding, those gate-symbol helpers, and the composite tier arc.
- **`xor-ic.html` is the combinational-gate reference.** It has the **XOR shield symbol** (the adders need
  it -- jkff has no XOR helper), a **truth-table tier 1** (combinational, what these parts use instead of
  a timing diagram), and the **gate silicon** cross-section style for tier 5.

---

## 0. The shared idea

**Logic composes.** Each of these is a small-scale-integration part that wires a handful of gate
primitives into one useful function -- arithmetic (the adders), selection (the mux), distribution (the
demux), or voting (the majority). The lesson at every tier is the **composition**: how AND/OR/NOT/XOR
combine so that gates become arithmetic and control. There is no exotic device here; the teaching is the
wiring.

## 1. The real-device split for a COMPOSITE (read this carefully)

Same top-level split as the other sheets -- analogy stays abstract, realism gets real -- but "real" means
something specific for a gate composition:

- **Tiers 2-3 (the analogy view) are rich abstraction -- do not schematize.** The function as a flow
  network (tier 2) and as pressure-pilot valves (tier 3). No lazy basic-symbol shortcut.
- **Tier 4 (real device) = the GATE-LEVEL SCHEMATIC.** Draw the actual interconnected gates as **proper
  logic-gate symbols** (`andG`, `orG`, `invTri` from `jkff-ic.html`; the **XOR shield** from
  `xor-ic.html`), with the internal nets labeled (e.g. the half-adder's two gates both fed by A and B).
  **For a gate-composition SSI part the gates ARE the real device** -- this is the honest device view, not
  a "basic symbol" shortcut. (The "no inverter triangles" rule from the comparator brief applied to a
  *single transistor cell* where a triangle stood in for a transistor latch; here the gates are the
  genuine components, so proper gate symbols are correct and required. Do not draw vague boxes; draw real
  gate symbols.)
- **Tier 5 (silicon) = real MOS cross-sections** of a **representative gate** expanded to its CMOS
  transistors (n-well PMOS over p-substrate NMOS, poly over oxide), as in `jkff-ic.html` / `xor-ic.html`
  tier 5, with a note that the other gates tile likewise. This is where the gates become transistors --
  the bridge from the gate-level schematic to silicon. Not a block diagram.

## 2. The shared build approach

- Take the **shell** (CSS, fonts, `el`/`drawPkg`/helpers, the CEC brand mark, the frame loop) and the
  **gate-symbol helpers** (`andG`, `orG`, `invTri`) and the **composite tier-4 wiring style** (labeled
  internal nets between gates) from `jkff-ic.html`.
- Take the **XOR shield symbol**, the **truth-table tier 1**, and the **gate silicon** cross-section from
  `xor-ic.html`.
- These parts are **combinational** -- no clock, no held state. The "scope" is the **truth table** with
  the row matching the live inputs highlighted (section 7). Controls are input toggles.
- Each part maps to a `buildNetlist` **gate composition** (already wired in the sim, section 6); tier 4
  should draw exactly that composition so the glyph and the sim agree.

## 3. CEC house identity and pinouts (from the catalogue)

All are **6-pin SOT-23-6 / SC70-6** except the full adder (**7-pin**). `chipType` = the CEC number; house
pin convention (output on pin 1) EXCEPT the majority gate, which keeps the **74-series gate pin order**
(inputs + GND first, output then VCC) to sit beside the real gates -- match the catalogue exactly:

- **CEC2024** half-adder: `1 SUM · 2 GND · 3 A · 4 B · 5 COUT · 6 VCC`
- **CEC2018** full adder (7-pin SC70-8/MSOP-8, one N.C.): `1 SUM · 2 GND · 3 A · 4 B · 5 CIN · 6 COUT · 7 VCC`
- **CEC2031** mux: `1 Y · 2 GND · 3 A · 4 B · 5 SEL · 6 VCC`
- **CEC2032** demux: `1 Y0 · 2 GND · 3 Y1 · 4 D · 5 SEL · 6 VCC`
- **CEC2046** majority (74-series order): `1 A · 2 B · 3 GND · 4 C · 5 Y · 6 VCC`

Adapt `drawPkg` per `ic-glyph-spec.md` §7.3 for the 6- (or 7-) lead frame. Set `chipType` and the `names`
map per part. No real-manufacturer name anywhere.

## 4. The five-tier arc (shared pattern)

**Tier 1 -- symbol + pinout + truth table.** The part's logic symbol (adders: the Σ box; mux: the
trapezoid; demux: the mirror trapezoid; majority: a gate body labeled "MAJ") on the CEC pinout, plus the
**truth table** with the live-input row highlighted, and a one-line state note.

**Tier 2 -- flow network (analogy, build rich).** The function as plumbing -- per part (section 5 gives
each). E.g. the mux as a **two-way selector valve** routing one of two input streams to the output; the
adder as streams combining with a carry overflow.

**Tier 3 -- pressure-pilot valves (analogy, build rich).** The same function as detailed pressure-pilot
valves -- the gates as valves piloted by the inputs. Keep it the valve metaphor, not a schematic.

**Tier 4 -- gate-level schematic (real gate symbols).** The exact gate composition (section 5/6) drawn
with `andG`/`orG`/`invTri`/XOR-shield, internal nets labeled, inputs from the pins, outputs to the pins.
Light the gates/nets from the live inputs (which gate is asserting). **This is the device tier.**

**Tier 5 -- silicon (real cross-sections).** A representative gate of the composition expanded to CMOS
(n-well PMOS / p-substrate NMOS), real cross-section, with a note that the rest tile likewise.

## 5. Worked template -- CEC2024 Half-Adder (build this first, in full)

*Tagline: "two bits in, a sum and a carry out."*

- **Pinout:** `1 SUM · 2 GND · 3 A · 4 B · 5 COUT · 6 VCC` (SOT-23-6).
- **Composition (tier 4):** exactly **two gates, both fed by A and B** -- an **XOR** (A,B) -> **SUM**, and
  an **AND** (A,B) -> **COUT**. No internal nets between them; both read the inputs directly. (This is the
  whole half-adder: the sum is "A differs from B," the carry is "both A and B.")
- **Truth table (A B -> COUT SUM):** 00->00 · 01->01 · 10->01 · 11->10.
- **Tier 2 analogy:** two input streams; SUM is the "exactly one" overflow channel, COUT the "both"
  channel. **Tier 3:** the XOR and AND as two pilot valves watching A and B.
- **Tier 5:** show the XOR's CMOS (the characteristic gate) plus the AND, real cross-section.
- **Teaches:** the half-adder is the bottom rung of binary addition; chain a carry-in and it becomes the
  CEC2018 full adder.

## 6. The other four (deltas from the template)

**CEC2018 Full Adder** -- *"the smallest piece of arithmetic that still counts."* 7-pin
`1 SUM · 2 GND · 3 A · 4 B · 5 CIN · 6 COUT · 7 VCC`. Composition (5 gates, reusing t0 = A⊕B): XOR(A,B)=t0;
XOR(t0,CIN)=**SUM**; AND(A,B)=t1; AND(CIN,t0)=t2; OR(t1,t2)=**COUT** (= majority of A,B,CIN). Truth table
A B CIN -> COUT SUM: 000->00, 001->01, 010->01, 011->10, 100->01, 101->10, 110->10, 111->11. Tier 4 shows
the two-XOR sum path and the AND-OR carry path sharing t0. Teaches carry propagation; ripple-chain
COUT->CIN for an N-bit adder. Tier 2: two addends plus a carry-in stream, a sum and a carry-out.

**CEC2031 2:1 Mux** -- *"one wire, your choice of two."* 6-pin `1 Y · 2 GND · 3 A · 4 B · 5 SEL · 6 VCC`.
Composition (4 gates): NOT(SEL)=nsel; AND(A,nsel)=t1; AND(B,SEL)=t2; OR(t1,t2)=**Y**. Tier 2 analogy: a
**two-way selector valve** -- SEL throws the valve so either the A stream or the B stream reaches Y.
Teaches selection; the leaf cell of any mux tree and of the CEC2064 LUT.

**CEC2032 1:2 Demux / Decoder** -- *"one in, routed to one of two."* 6-pin
`1 Y0 · 2 GND · 3 Y1 · 4 D · 5 SEL · 6 VCC`. Composition (3 gates): NOT(SEL)=nsel; AND(D,nsel)=**Y0**;
AND(D,SEL)=**Y1**. Tier 2: a **diverter valve** sending the D stream down one of two pipes by SEL (tie D
high and it is a 1-of-2 address decoder). The mux's mirror image -- selection's dual is distribution.

**CEC2046 Majority / Voter** -- *"the will of the majority, in silicon."* 6-pin, **74-series order**
`1 A · 2 B · 3 GND · 4 C · 5 Y · 6 VCC`. Composition (5 gates): AND(A,B)=t0; AND(B,C)=t1; AND(C,A)=t2;
OR(t0,t1)=t3; OR(t3,t2)=**Y**. Y is high when >= 2 of the 3 inputs are high. Tier 2: three input
pressures, the output following whichever way the majority pushes. Teaches voting / triple-modular
redundancy; it is also the full adder's carry function (majority(A,B,CIN)).

## 7. Controls and scope

- **Controls:** **input toggles** -- A/B (half-adder); A/B/CIN (full adder); A/B/SEL (mux); D/SEL (demux);
  A/B/C (majority). No clock (these are combinational). A VCC control is optional.
- **Scope -- the truth table (the payoff).** Show the full truth table with the **row matching the live
  inputs highlighted**, updating as toggles change, and the live output(s) called out. (For the adders a
  small "A + B (+ CIN) = COUT SUM" arithmetic readout is a nice touch.) This is the combinational analogue
  of the timing scope; make toggling inputs visibly move the highlighted row and the gate activity in
  tier 4.

## 8. House style and validation (per part, all must pass)

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** line 1. **CSS/fonts/tokens** copied verbatim from `jkff-ic.html` (do not hardcode colors);
  Saira / Saira Condensed / IBM Plex Mono; keep the Critical Error brand mark.
- **Forbidden glyphs** (the §10 python check must report `none` and `0`): em-dash (U+2014), en-dash
  (U+2013), arrows (U+2192/2190/2194), the minus sign (U+2212), smart quotes. Use the ASCII hyphen-minus
  and "to"; the middle dot `·`, `⊕`/`&oplus;` (XOR), and `*`/`&times;` are acceptable in labels, but
  prefer writing logic as "A xor B" / "A and B" in prose. Watch net labels.
- **§10 gates, run on EACH of the five files:** (1) `node --check`; (2) the forbidden-glyph check;
  (3) `grep -c "drawPkg(gT"` = **5**; (4) per-tier member consistency; (5) a **Playwright render of all
  five tiers** (mandatory) -- toggle the inputs across the truth table in every tier; screenshot and fix
  collisions / off-canvas labels. If you cannot run the render, say so per file and the owner will.

## 9. Handback checklist (per part)

- **CEC house identity:** `chipType`/title/lede/device-tier/`names` map = the CEC number + function; brand
  mark present; no real-manufacturer name; pin order per the catalogue (majority keeps 74-series order).
- **Tier 4 is the real gate-level schematic:** proper gate symbols (andG/orG/invTri/XOR shield), the exact
  composition from sections 5/6, internal nets labeled -- not vague boxes; tier 5 is real MOS silicon of a
  representative gate.
- **Analogy tiers kept:** tiers 2-3 tell the flow / pressure-pilot-valve story per part.
- **The lesson lands:** the truth table highlights the live row, toggling inputs moves it and lights the
  tier-4 gates, and the per-part teaching point (addition / selection / distribution / voting) is explicit.
- **Sim agreement:** tier 4 matches the `buildNetlist` composition (section 6).
- **All §10 gates pass clean** on all five files, including the five-tier render (or it is flagged for the
  owner).

## (Reference) Sim backend mapping -- section 6 anchor

Each part is already wired as a `buildNetlist` gate composition (`CEC_COMP` in `web/src/lib/netlist.ts`),
no new sim element, golden-safe: half-adder = XOR + AND; full adder = 2 XOR + 2 AND + OR; mux = NOT + 2 AND
+ OR; demux = NOT + 2 AND; majority = 3 AND + 2 OR. The sub-gates are powered `ELEM_GATE`s sharing the
part's VCC/GND. Tier 4's schematic is a 1:1 picture of that composition.

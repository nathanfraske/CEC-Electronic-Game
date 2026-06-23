<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: 6-pin latched comparator, five-tier IC glyph

A standalone brief for the design agent. This is a **targeted revision** of the existing
`docs/ui/parts/comparator-ic.html` (real part: **ADCMP601**, a rail-to-rail latched comparator in a
six-pin SC70-6 / SOT23-6 package). The package, pinout, live model, scope, the tier 1 symbol, and the
**tier 2 + tier 3 hydraulic analogy are all good and stay** — the abstraction is the teaching point, so
do **not** convert the analogy tiers into schematics. The job is narrow: **make the REALISTIC views
(tier 4 device, tier 5 silicon) show the actual, correctly-typed transistors and real silicon, instead
of the "basic symbol" schematic simplifications they use today** (the cross-coupled latch is drawn as
generic inverter triangles; that is the thing to replace). Read this top to bottom. For the verbatim
house infrastructure follow **`ic-glyph-spec.md`**; the real MOSFET symbol you will lean on is its
**§7.4 `mosfet` helper** (already present in the file).

- **Output file:** `docs/ui/parts/comparator-ic.html` (revise in place).
- **`<title>`:** `Latched comparator, five layers` (already correct). Update the header `chipType`
  (currently `COMP`) to the real part number **`ADCMP601`**; keep the `<h1 class="lede">`, the
  device-tier part name, and the `names` map reading **latched comparator / ADCMP601**. Grep the finished
  file for stale template strings before handing back.

---

## 0. The one idea

**A comparator is a one-bit converter; a latched comparator remembers the bit.** The defining heart is a
**regenerative cross-coupled latch** — a positive-feedback pair that drives a tiny input difference to a
full rail in nanoseconds, the same cross-coupled cell that stores a bit in a flip-flop. A
**differential input pair** tips the balance; the **latch-enable (LE)** strobe decides whether the result
regenerates and is held (latched) or tracks live (transparent). Near-equal inputs leave the latch hanging
near mid-rail — the **metastable** state. Every tier carries that arc: **a differential tip, a
regenerative slam to the rails, an LE that holds it** — the analogy tiers tell it as plumbing, the
realistic tiers tell it as transistors.

## 1. The one change: real devices in the REALISTIC view (not basic symbols)

**Keep the abstraction where it belongs and make the realism real.** Two different jobs:

- **Tiers 2-3 (the analogy / "Analogy" view) are intentional abstraction — leave them.** The fluid
  chambers, the cross-piloted levels, the pressure-pilot valves, the LE tail valve: that hydraulic
  picture is the whole point of those tiers and it already reads well. **Do not replace it with a
  transistor schematic.** The only rule here is the same one as everywhere: it must stay a *proper, rich*
  abstraction — do not drop a lazy basic symbol into it as a shortcut.

- **Tiers 4-5 (the realistic / schematic + silicon view) must use the ACTUAL devices.** This is where the
  fix lives. Today the regenerative latch is drawn as two generic **inverter triangles** — a basic-symbol
  simplification of what is really a four-transistor cross-coupled cell. **Replace those (and any
  anonymous box) with the real, correctly-typed transistors**, drawn with the §7.4 `mosfet` helper:
  - if a device is an **NMOS**, draw an NMOS (no gate bubble); if **PMOS**, draw a PMOS (gate bubble);
    label each one and give it its real role. No inverter triangles standing in for transistor pairs, no
    featureless boxes standing in for the diff pair or the tail.
  - **Tier 5 must be real MOS cross-sections** (poly gate over thin oxide, n+/p+ diffusions in the
    well/substrate), as in `mosfet-tiers.html` and the inverter sheet's silicon tier — not a block
    diagram.

Call `mosfet(group,gx,topY,botY,nodeY,isP)` once per transistor and place them per the network (vertical
stack = series, side by side = the pair). Its `chan` element (opacity raised when the device is on) is
your per-device "this transistor is conducting" animation, driven from the live model.

## 2. The part and the real schematic to draw in tiers 4-5

- **Real exemplar (package + pinout):** **ADCMP601** (Analog Devices), rail-to-rail latched comparator,
  **SC70-6 / SOT23-6**, ~3.5 ns, with a latch-enable pin. Keep the pinout the file already uses
  (section 3).
- **Real internal schematic to render (the canonical clocked regenerative / "sense-amp" latch — all real
  MOSFETs):**
  1. **Input differential pair — two matched NMOS, M1/M2.** Gates are **VP** and **VN**; sources join at
     the shared **tail** node; drains are the two latch nodes (Qa, Qb).
  2. **Regenerative cross-coupled latch — an NMOS pair (M3/M4) + a PMOS pair (M5/M6)**: two cross-coupled
     inverters drawn as their **four explicit transistors**, outputs cross-wired to inputs (this is the
     piece that replaces the inverter triangles).
  3. **Tail switch — one NMOS, M7, gated by LE.** LE high → tail on → the stage evaluates and regenerates;
     LE low → tail off → the decision is held.
  4. **Precharge / reset — two PMOS, M8/M9**, pulling Qa/Qb up to VCC while LE is low, so each evaluation
     starts defined.
  5. **Output stage — a small cross-coupled SR (NAND/NOR) latch + buffer** that captures the regenerated
     decision into a stable, held **Q**. Draw it as real gates/devices, not a triangle.
- **Device-family note (decide once, be consistent, state it):** the schematic above is **CMOS**
  (NMOS/PMOS), the dominant real implementation, which teaches cleanly and reuses the §7.4 helper — **use
  it unless told otherwise.** The ADCMP601's own process is SiGe-bipolar; if strict fidelity to that exact
  part is preferred, draw the bipolar equivalent instead (an **NPN** diff pair, an **NPN** cross-coupled
  CML latch, an **NPN** LE-gated tail current source, an emitter-follower output) with a real BJT symbol
  (see `transistor-tiers.html` for the BJT symbol + cross-section). Do not mix families and do not draw a
  generic device that is neither. Flag the choice in the handback.

## 3. Package frame and pinout (shared by all five tiers — already verified, keep)

**6-pin SC70-6 / SOT23-6**, datasheet-verified, as the file already draws it via `drawPkg`. This is the
game's 6-pin **latched** comparator (the `CMP` part's LATCHED variant, LE = the sixth terminal). Keep the
existing pin map:

| Pin | Name | Function | Connection contract |
|---|---|---|---|
| 1 | **Q** | latched 1-bit output (high when VP > VN, held when LE low) | left/output node + the live Q readout |
| 2 | **GND** | ground / 0 V | the bottom rail |
| 3 | **VP** | non-inverting analog input (+) | right input, into the diff pair (M1 gate) |
| 4 | **VN** | inverting analog input (-) | right input, into the diff pair (M2 gate) |
| 5 | **LE** | latch enable: **high = track/compare, low = latch/hold** | the tail switch gate + the precharge devices |
| 6 | **VCC** | supply | the top rail |

Keep `drawPkg` as is; update only `chipType` to `ADCMP601`.

## 4. The live model (keep it; expose a little device-level state for tiers 4-5)

The existing regenerative-latch model is good: differential compare → positive-feedback regeneration →
held output, with a metastable band widened "for the eye" (the real input offset is only a few
millivolts — keep that note). **Do not rip it out.** For the realistic tiers, expose a few more reads on
the model record `s` so each transistor can animate truthfully (presentation-only, no new physics):

- `compareMode` (LE high) vs latched (LE low) — drives the **tail M7** channel glow and the **precharge
  M8/M9** on/off.
- which side won (`stored`, `resolve`/`regen`) — drives which cross-coupled devices (M3/M5 vs M4/M6)
  conduct and which diff-pair leg (M1 vs M2) carries more current.
- tail-on / `Ibias` — drives the tail device glow.

Each `mosfet().chan` opacity should come from one of these real quantities, so the schematic lights up by
what the circuit is actually doing.

## 5. The five-tier arc (only 4-5 change)

**Tier 1 — symbol + pinout + decision table + scope. KEEP.** Comparator triangle on the real SC70-6
pinout, the LE latch box, the VP-vs-VN decision table, the metastable note, the scope.

**Tier 2 — flow network. KEEP (analogy).** Two cross-coupled latch-node chambers whose fluid levels are
the node voltages; the differential input tips the balance; the LE valve holds it. This is the intended
abstraction — leave the plumbing as plumbing.

**Tier 3 — pressure-pilot valves. KEEP (analogy).** The differential pair as pressure-pilot valves (the
higher input lifts its plug more and drains its node), the LE-gated tail, the cross-pilot regeneration.
The rich valve mechanism is the teaching point here — do not turn it into a schematic.

**Tier 4 — real device (REWORK: real transistors, no basic symbols).** The full clocked regenerative
latch as **explicit, correctly-typed transistors**: the **NMOS diff pair (M1/M2)** feeding the
**cross-coupled latch drawn as its four real devices — NMOS M3/M4 + PMOS M5/M6** (outputs cross-wired to
inputs), over the **LE tail NMOS (M7)**, with the **precharge PMOS (M8/M9)** to VCC and the real
**output SR latch/buffer** holding Q. Every transistor via the §7.4 `mosfet` helper, PMOS with the gate
bubble, each labeled by role. **This is the tier that answers the brief: the cross-coupled latch is four
named transistors, not two inverter triangles.** Animate: the winning side's devices conduct, precharge
switches with LE, the tail glows when enabled, everything freezes when LE latches.

**Tier 5 — silicon (REWORK: real cross-sections).** The diff pair and the cross-coupled latch as **real
MOS device cross-sections**: poly gates over thin gate-oxide, n+ source/drain in the p-well/substrate for
the NMOS, p+ in an n-well for the PMOS, the matched diff-pair geometry (mentioning common-centroid layout
is a nice touch). Reuse the cross-section style from `mosfet-tiers.html` / the inverter sheet's tier 5.
Teaching point: the regenerative latch is the same cross-coupled silicon cell that stores a bit in an
SRAM/flip-flop — show that kinship. **Real structures, not a block diagram.**

## 6. Sim backend mapping (context for the eventual 6-pin web part, not a task here)

The game already has the comparator element (`ELEM_COMPARATOR`); the **6-pin LATCHED variant adds LE as
the sixth terminal (`f`)** — the f/g/h emission infrastructure now exists (HANDOFFS 72). The eventual web
wiring is a 6-pin `CMP` variant `OUT, IN-, IN+, VCC, GND, LE` with LE on terminal `f`, plus an
**unconnected-LE check** so an *unwired* LE reads "transparent / not latched" rather than "ground =
permanently latched." Tier 4's schematic should match what the sim models (diff pair → regenerative latch
→ LE-gated hold) so the glyph and the part agree.

## 7. Controls and scope (keep)

- **Controls:** the existing **VP / VN** input sliders and the **LE** latch control (high = track, low =
  hold). That is the whole story; the metastable band shows when VP and VN are within the (exaggerated)
  offset.
- **Scope:** keep the existing trace. Toggling **LE** must visibly freeze the output (and, in tiers 4-5,
  freeze the per-device channel glows); nearly-equal inputs must visibly hang in the metastable band.

## 8. House style and validation (all must pass before handback)

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** on line 1 (already present). **Design tokens / fonts / CSS:** unchanged (use the
  `--bg`/`--surface`/`--accent`/signal tokens; do not hardcode colors). Saira / Saira Condensed / IBM
  Plex Mono.
- **Forbidden glyphs** (the §10 python check must report `none` and `0`): em-dash (U+2014), en-dash
  (U+2013), arrows (U+2192 / U+2190 / U+2194), the minus sign (U+2212), smart quotes
  (U+2018/2019/201C/201D), and the entities `&mdash;`/`&ndash;`. Use the ASCII hyphen-minus; write ranges
  as "0 V to VCC" and "to" instead of an arrow; the middle dot `·`/`&middot;` and `*`/`&times;` are
  allowed. Watch the new device labels and net names.
- **§10 gates:** (1) `node --check` on the extracted script; (2) the forbidden-glyph python check;
  (3) `grep -c "drawPkg(gT"` must be **5**; (4) per-tier member consistency (every `tN.member` read in
  `updateTN` is created in `buildTN`) — you are adding many device members to tiers 4-5, so this matters;
  (5) a **Playwright render of all five tiers** with the console/page-error listener (mandatory). Sweep
  VP/VN through the metastable band and toggle LE in every tier; screenshot and fix any collision or
  off-canvas label (the schematic tiers are now denser than before — budget the layout).

## 9. Handback checklist

Flag in the handback:

- **Analogy tiers untouched in spirit:** tiers 2-3 still tell the hydraulic story (chambers, cross-pilot
  levels, pressure-pilot valves, LE tail valve) — the abstraction was kept, not schematized.
- **Realistic tiers are real devices, not basic symbols:** tier 4 draws the comparator as actual
  correctly-typed transistors (NMOS diff pair, four-device cross-coupled NMOS/PMOS latch, LE tail NMOS,
  precharge PMOS, real output stage) via the §7.4 `mosfet` helper — **the inverter triangles are gone**;
  tier 5 is real MOS cross-sections, not a block diagram.
- **Device family is consistent and stated** (CMOS sense-amp latch recommended; or bipolar NPN if chosen
  for strict ADCMP601 fidelity) — no mixed or generic devices.
- **The arc still reads:** differential tip → regenerative slam → LE holds; toggling LE freezes the
  output and the device-channel glows; near-equal inputs hang in the (exaggerated) metastable band; the
  cross-coupled latch is visibly the same cell that stores a bit in a flip-flop.
- **Identity clean:** title / lede / `chipType` (ADCMP601) / device-tier part name / `names` map all read
  latched comparator / ADCMP601; grep for stray template strings ("inverter", "NOT gate", "Schmitt",
  "74AUP", "NAND").
- **All §10 gates pass clean**, including the mandatory five-tier Playwright render with no console/page
  errors and no off-canvas or colliding labels in the denser schematic tiers.

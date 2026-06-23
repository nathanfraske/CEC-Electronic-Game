<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: analog switch (CMOS transmission gate), five-tier IC glyph

A standalone brief for the design agent. Build a five-tier IC glyph for the **analog switch** (the
game's `ASW` part), a single SPST CMOS **transmission gate** controlled by a digital level. Read this top
to bottom. For the verbatim house infrastructure (CSS, fonts, helpers, scope chrome, frame loop) and the
exact validation commands, follow **`ic-glyph-spec.md`**.

**You are not starting from scratch — two existing sheets already solve almost all of this:**

- **`docs/ui/parts/xorpass-ic.html` is the primary base.** It already draws **transmission gates as real
  NMOS+PMOS valve pairs** (tier 3), as a real **schematic** (tier 4), and as a real **metal-oxide
  cross-section** (tier 5), and its live model already computes the per-device NMOS/PMOS on-states. The
  analog switch is literally **one** of that sheet's two transmission gates plus its control inverter,
  brought out as a standalone SPST switch. Lift those patterns.
- **`docs/ui/parts/inv-ic.html` supplies the package + the control inverter.** It has the verbatim
  **SOT-23-5** `drawPkg` (the analog switch is also a 5-pin part), and it *is* the control inverter the
  transmission gate needs (CTRL drives the NMOS directly and an inverter drives the PMOS).

- **Output file:** `docs/ui/parts/analog-switch-ic.html`
- **`<title>`:** `Analog switch, five layers` — set this correctly, and make the `<h1 class="lede">`, the
  header `chipType`, the device-tier part name, and the `names` map all read **analog switch / the chosen
  part number**. Grep the finished file for stale template strings ("XOR", "inverter", "NOT gate",
  "74LVC1G04", "pass-transistor XOR") before handing back, since you are starting from those two sheets.

---

## 0. The one idea

**A transmission gate passes an analog signal in either direction, controlled by a digital level — and
it takes BOTH an NMOS and a PMOS to do it.** An NMOS passes a strong low but a weak high (it weakens as
the signal nears VCC); a PMOS passes a strong high but a weak low (it weakens near GND). Wire them in
**parallel**, drive their gates with **complementary** controls (CTRL to the NMOS, NOT-CTRL to the PMOS,
so both turn on together), and the pair passes the **full rail-to-rail** signal at a low, roughly flat
**on-resistance R_on**. Open the gate and A and B are isolated. That complementary N+P pair, and the
**complementary R_on curve** it produces (each device's resistance blowing up at its own rail, the
parallel pair staying low across the whole swing), is the whole lesson and must be the payoff of the realistic
tiers and the scope.

## 1. The real-device mandate (the point of this build)

Same split as the other sheets — keep the abstraction where it teaches, make the realism real:

- **Tiers 2-3 (the analogy view) are intentional abstraction — build them rich, do not schematize.** The
  switch as a **gated pipe** (tier 2) and as **pressure-pilot valve(s)** (tier 3). The only rule: no lazy
  basic-symbol shortcut standing in for the mechanism.
- **Tiers 4-5 (the realistic view) must be the ACTUAL devices, correctly typed — no basic symbols.** The
  transmission gate is drawn as its **real transistors**: an **NMOS in parallel with a PMOS** (the pass
  pair, A on one side, B on the other), plus the **control inverter** (itself an NMOS + a PMOS) that makes
  the PMOS's complementary gate drive. That is **four real MOSFETs**, each via the **§7.4 `mosfet`
  helper**, correctly typed (PMOS = gate bubble), each labeled, with the real bulk/body ties (the pass
  NMOS body to GND, the pass PMOS body to VCC). **Tier 5 is real MOS cross-sections** (poly over thin
  oxide, n+/p+ in well/substrate), as in `xorpass-ic.html` / `mosfet-tiers.html` — not a block diagram.
  `xorpass-ic.html` already draws exactly this for its transmission gates; reuse it.

## 2. The part and its real internal cell

- **Real exemplars (pick one for the package/pinout, datasheet-verify it):** a single **SPST CMOS analog
  switch** — the **CD4066B** quad bilateral switch (the sim's stated model); one cell of it IS a single SPST
  switch, so draw ONE of its four identical cells on the game's five-pin teaching layout (A and B = a
  switch's two interchangeable terminals, e.g. CD4066B pins 1 and 2; CTRL = its control pin 13; VCC =
  pin 14, GND = pin 7, shared across all four). NOT the **TS5A3160**, which is an SPDT 2:1 mux, not an
  SPST; the single-SPST **ADG801 / ADG802** or **MAX4626** are the same cell in a 6-pin package if you
  prefer a single-switch part.
- **The internal cell is the classic CD4066-style transmission gate** — the sim itself models the `ASW`
  as "a CD4066-style transmission gate" (see `crates/sim-core/src/lib.rs`, `ELEM_ASWITCH`). So name the
  **CD4066B** as the canonical teaching reference for the cell even if you draw a single-SPST package
  around it. The real cell is exactly:
  1. **The pass pair:** one **NMOS** and one **PMOS** in parallel. Their source/drain pairs are tied so
     the channel runs **A to B** (bidirectional — there is no fixed source/drain, which is the point).
  2. **The control inverter:** an **NMOS + PMOS** inverter turning CTRL into NOT-CTRL.
  3. **Complementary drive:** CTRL to the **NMOS** pass gate; NOT-CTRL to the **PMOS** pass gate. Both on
     together (closed) or both off (open).
  4. **Bulk ties:** pass-NMOS body to GND (VSS), pass-PMOS body to VCC.
- **Device family:** all **CMOS** (NMOS/PMOS) — that is what a transmission gate is, so there is no
  bipolar variant to consider here. Reuse the §7.4 `mosfet` helper throughout.

## 3. Package frame and pinout (shared by all five tiers)

**5-pin SOT-23-5 / SC70-5** (adapt the verbatim `drawPkg` from `inv-ic.html`, §7.3 of the spec for the
lead map). This is the game's 5-pin `ASW`. Map the chosen real part's pins onto these roles (verify the
exact pin numbers from its datasheet):

| Pin | Name | Function | Connection contract |
|---|---|---|---|
| - | **A** | one side of the switched path (COM) | left signal terminal; bidirectional |
| - | **B** | other side of the switched path (NO) | right signal terminal; bidirectional |
| - | **CTRL** | digital control (IN): **high = closed, low = open** | the NMOS pass gate + the control-inverter input |
| - | **VCC** | supply (V+) | top rail; the control inverter + the PMOS bulk |
| - | **GND** | ground | bottom rail; the NMOS bulk |

(The game's terminal order is A, B, CTRL, VCC, GND. The real part will name them COM/NO/IN/V+/GND; state
the mapping in the device tier.) Update `chipType` and the `names` map to the chosen part.

## 4. The live model (interactive state, per frame)

A transmission gate with a **per-device** on-resistance, so the R_on curve falls out for the scope and
the device tiers. `xorpass-ic.html` already has the per-device on-state math — adapt it for one gate.
State: the control level `Vc`, the passed signal voltage `Vsig` (the analog level on A, a control), the
supply `VDD`, and the nominal `R_on`.

```js
// closed when CTRL is above half the rail (mirrors the sim's aswitch_closed rule)
var closed = (Vc > VDD/2);
// per-device on-resistance vs the passed signal (the complementary curves): each device weakens as the
// signal nears the rail where its overdrive collapses. Scaled for legibility, not SI ohms.
var ovN = closed ? Math.max(0, (VDD - Vsig) - Vtn) : 0;   // NMOS overdrive: gate at VDD, dies near VDD
var ovP = closed ? Math.max(0, (Vsig - 0)   - Vtp) : 0;   // PMOS overdrive: gate at 0,  dies near GND
var gN = ovN>0 ? ovN : 0, gP = ovP>0 ? ovP : 0;            // each device's conductance ~ overdrive
var Ron = closed ? Ron0 / Math.max(gN + gP, 1e-3) : 1e12;  // parallel; huge when open
```

Expose on the model record `s`: `closed`, `Vsig`, `Ron`, and **`gN`/`gP` separately** (which device is
carrying — the higher input leans on the PMOS, the lower on the NMOS), so the device tiers can light the
NMOS and PMOS channels independently and the scope can plot the two device curves plus their parallel sum.
Flag the model as a scaled teaching animation, not SI ohms.

## 5. The five-tier arc

**Tier 1 — symbol + pinout + scope.** The analog-switch symbol (the SPST switch / bidirectional bilateral
switch symbol) wired to the real 5-pin pinout, with CTRL toggling it open/closed and a plain-language
note ("CTRL high: A-B closed, R_on ohms" / "CTRL low: open"). The scope shows the R_on curve (see
section 7).

**Tier 2 — flow network (analogy, build rich).** The switch as a **gated pipe between A and B**. CTRL is
the pilot that opens or shuts the gate; when open, fluid flows **either direction** A to B (stress the
bidirectionality — unlike a logic gate it has no source/drain, no preferred direction); the slight
constriction even when open is R_on. When CTRL is low the pipe is blocked. Keep it plumbing.

**Tier 3 — pressure-pilot valves (analogy, build rich; foreshadow the pair).** The detailed mechanism:
the transmission gate as a **pilot-operated valve** — and a nice bridge to the real device is to show it
as **two complementary pilot valves in parallel**, one that passes well from the high side and one from
the low side, so together they pass the full range (the analogy of why you need both N and P). Still the
valve metaphor, not a schematic; this is `xorpass-ic.html` tier 3's "NMOS and PMOS valve pair," reused
for one gate.

**Tier 4 — real device (the actual transistors; no basic symbols).** The full cell as real, correctly-
typed MOSFETs via the §7.4 helper: the **pass NMOS ∥ pass PMOS** (channels tied A-to-B, bidirectional),
the **control inverter** (NMOS + PMOS) generating NOT-CTRL, the complementary gate wiring (CTRL to the
NMOS, NOT-CTRL to the PMOS), and the bulk ties (NMOS body to GND, PMOS body to VCC). Label each device.
Animate: both pass channels light when closed; as `Vsig` sweeps, the NMOS channel dims toward VCC and the
PMOS channel dims toward GND (lit from `s.gN`/`s.gP`) — the viewer sees the hand-off that keeps R_on low.
This is the tier that carries the brief; lift it from `xorpass-ic.html`'s tier 4.

**Tier 5 — silicon (real cross-sections).** The pass NMOS and pass PMOS as **real MOS cross-sections**
side by side (poly gates over thin oxide, n+ S/D in the p-well/substrate, p+ S/D in the n-well), with the
two channels' conduction overlapping across the signal range. Note the bidirectionality (symmetric S/D)
and that the body ties set the well biases. Reuse `xorpass-ic.html` / `mosfet-tiers.html` tier-5 style.
Real structures, not a block diagram.

## 6. Sim backend mapping (already wired — the glyph just needs to agree)

The `ASW` part is already live: `ELEM_ASWITCH` (sim type 24), pins **a=A, b=B, c=CTRL, d=VCC, e=GND**,
`value` = the **on-resistance R_on** (Ω), closed when **V(CTRL) - V(GND) > half the rail** (an unpowered
switch falls back to a fixed mid-level threshold). ON stamps a symmetric `1/R_on` between A and B; OFF
stamps a tiny leak. The sim uses a **single lumped R_on** (it does not curve R_on with the signal), so be
clear that the **R_on curve in this glyph is the real device's truth being taught**, while the game's
solver uses the flat middle value. Tier 4's schematic should match the sim's model (a CTRL-gated
bidirectional path A-B), so the glyph and the part agree.

## 7. Controls and scope

- **Controls:** a **CTRL** toggle (open / closed), a **passed-signal voltage `Vsig`** slider (sweeps A's
  analog level across 0 to VCC — this is what drives the curve), and optionally an **R_on** (quality)
  control. A VCC slider is a nice extra. Drop any gate-style logic-input sliders.
- **Scope — the complementary R_on curve (the payoff).** Plot **R_on versus the passed signal voltage**
  across 0 to VCC: the **NMOS-only** curve rising steeply toward VCC (its overdrive `VCC-Vsig-Vtn`
  collapses at the high rail), the **PMOS-only** curve rising toward GND (mirror image), the two crossing
  in an **X** near mid-rail, and their **parallel sum** sitting **below both and staying low across the
  whole swing** — lowest at each rail (where one device is at full overdrive) with at most a gentle
  mid-rail rise. (NOT a bathtub: the resistance does not rise at the ends — at each rail one device is at
  maximum overdrive, so the pair is at its lowest there.) Mark the live `Vsig` point so moving the slider
  shows which device is carrying. This single graphic is why the transmission gate needs both devices;
  make it the centerpiece.
  (A second optional trace: the pass transfer — output following input as a straight diagonal when
  closed, flat when open — like `xorpass-ic.html`'s transfer curve.)

## 8. House style and validation (all must pass before handback)

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** on line 1: `<!-- SPDX-License-Identifier: Apache-2.0 -->`.
- **Design tokens / fonts / CSS:** copy verbatim from `xorpass-ic.html` (the `--bg`/`--surface`/
  `--accent`/signal tokens; do not hardcode colors). Saira / Saira Condensed / IBM Plex Mono.
- **Forbidden glyphs** (the §10 python check must report `none` and `0`): em-dash (U+2014), en-dash
  (U+2013), arrows (U+2192 / U+2190 / U+2194), the minus sign (U+2212), smart quotes
  (U+2018/2019/201C/201D), and the entities `&mdash;`/`&ndash;`. Use the ASCII hyphen-minus; write ranges
  as "0 V to VCC" and "to" instead of an arrow; the middle dot `·`/`&middot;` and `*`/`&times;` are
  allowed. Watch the device labels and net names.
- **§10 gates:** (1) `node --check` on the extracted script; (2) the forbidden-glyph python check;
  (3) `grep -c "drawPkg(gT"` must be **5**; (4) per-tier member consistency (every `tN.member` read in
  `updateTN` is created in `buildTN`); (5) a **Playwright render of all five tiers** with the
  console/page-error listener (mandatory). Sweep `Vsig` 0 to VCC and toggle CTRL in every tier;
  screenshot and fix any collision or off-canvas label.

## 9. Handback checklist

Flag in the handback:

- **Real devices in the realistic view, no basic symbols:** tier 4 draws the cell as four real,
  correctly-typed MOSFETs (pass NMOS ∥ pass PMOS + the control inverter, complementary gate drive, real
  bulk ties) via the §7.4 helper; tier 5 is real MOS cross-sections — not a block diagram.
- **Analogy tiers kept:** tiers 2-3 still tell the gated-pipe / pressure-pilot-valve story (the
  complementary pair shown as two valves), not a schematic.
- **The lesson lands:** the complementary R_on curve is the scope centerpiece (NMOS rises to VCC, PMOS rises to
  GND, parallel stays flat), the channels light independently as `Vsig` sweeps, and the bidirectional
  "passes, does not pull" nature is explicit (it produces no level of its own; A-B carry either way).
- **Identity clean:** title / lede / `chipType` / device-tier part name / `names` map all read analog
  switch / the chosen part; grep for stray "XOR", "pass-transistor XOR", "inverter", "NOT gate",
  "74LVC1G04".
- **Agreement with the sim noted:** the glyph teaches the per-signal R_on curve; the game's
  `ELEM_ASWITCH` uses the lumped flat R_on (`value`) and the half-rail close rule — both stated.
- **All §10 gates pass clean**, including the mandatory five-tier Playwright render with no console/page
  errors and no off-canvas or colliding labels.

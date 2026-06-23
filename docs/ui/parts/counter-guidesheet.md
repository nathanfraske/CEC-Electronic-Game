<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: CEC3161 3-bit binary counter, five-tier IC glyph

A standalone brief for the design agent. Build a five-tier IC glyph for the **CEC3161 3-Bit Binary
Counter** — a clocked register that counts 0..7 and rolls over. Read this top to bottom; it gives the
part, the package frame, the live model, the five-tier arc, the controls/scope, and the validation gates.
For the verbatim house infrastructure (CSS, fonts, helpers, scope chrome, frame loop) and the exact
validation commands, follow **`ic-glyph-spec.md`** (PART 2 of the kit). For the part spec of record, see
**CEC3161** in **`cec-teaching-ics.md`** (PART 3).

- **Output file:** `docs/ui/parts/counter-ic.html`
- **`<title>`:** `3-bit binary counter, five layers` — set this correctly. The `<title>`, the
  `<h1 class="lede">`, the `chipType` (**CEC3161**), the part name in the device tier, and the `names`
  map must ALL say "3-bit binary counter" / CEC3161. Grep the file for any stale string carried over from
  whatever you clone (past uploads shipped with a leftover `<title>` from their template — do not repeat
  that). CEC house part: no real-manufacturer name.

---

## 0. The one idea

**A binary counter is a cascade of divide-by-2 toggles.** Each bit flips half as often as the one below
it: the lowest bit toggles on every clock, the next on every second clock, the next on every fourth. Read
the three bits together and they spell the binary numbers 0, 1, 2 … 7 and roll over — counting IS repeated
halving of frequency. Every tier should make the **cascade** visible: three identical toggle stages in a
row, a **carry rippling** from each stage to the next, and the output bits stepping through the count. The
divide-by-2 stage is a **T (toggle) flip-flop** — so this part is literally **three flip-flops in a chain**,
which is why you build it from the flip-flop glyphs, not from a gate.

## 1. Start from `dff-ic.html` (and `jkff-ic.html`), NOT `inv-ic.html`

This is the most important instruction. The five-tier patterns in `ic-glyph-spec.md` §8 are written for a
**combinational CMOS gate** (transistor PUN/PDN networks, an analog transfer curve). A counter is
**sequential** — no transfer curve; it has a clock, internal state, and a **timing diagram**. Two shipped
sequential glyphs already solved all of that, and they are in this kit:

- **`dff-ic.html`** (PART 4 — the 74AUP1G79 D flip-flop): the **master-slave edge-triggered flip-flop**,
  adapted across all five tiers, plus the **timing-diagram scope**. This is your per-stage skeleton.
- **`jkff-ic.html`** (PART 5 — the CEC3076 JK/T flip-flop): shows how to draw the **toggle feedback**
  (`Q̄ → D`) and a sequential part's controls/scope. The counter's stage is exactly its **T-mode**.

**The counter's stage is a T flip-flop = a D flip-flop with `Q̄` wired back to `D`** (the `dff-toggle`
worked example). On each clock it loads the opposite of what it holds, so it flips — divide-by-2. You do
**not** need the full JK steering (inverter + 2 ANDs + OR); a T flip-flop is just the D-FF master-slave core
+ one feedback wire. Reuse the D-FF core **verbatim**, three times.

**What you build that is new (no existing glyph has it):** the **three-stage cascade** and the **ripple
carry** between stages, plus a **count read-out**. That is the creative delta. Lay the three stages out
left-to-right (bit 0 / LSB on the left, bit 2 / MSB on the right, or vice-versa — pick one and label it),
share the CLK / RESET / VDD rails across all three, and draw the carry wire from each stage to the next.
**This is the most multi-part glyph yet — use a wider canvas if you need it** (the flash ADC did; see
`ic-glyph-spec.md` on the scene size). Do not crowd three flip-flops into the inverter's footprint.

## 2. The part — CEC3161 3-bit binary counter

- **Function (positive-edge-triggered up-counter).** On each rising CLK edge the count advances:
  `count = (count + 1) mod 8`. The three outputs are the binary count: `Q2 Q1 Q0`.
- **RESET (active-high, asynchronous):** while RESET is high the count is forced to 0 immediately
  (independent of the clock). Leave RESET low/unwired and the counter free-runs.
- **The divide-by-2 chain:** `Q0 = CLK/2`, `Q1 = CLK/4`, `Q2 = CLK/8`. Each output is a clock half the
  speed of the previous bit — a counter is also a frequency-divider chain. (Write division as `/2`, `/4`,
  `/8`, or the `÷` sign, which is allowed; do NOT use the forbidden minus sign U+2212.)
- **The count table** (drive a row-highlight off the live count):

  | count | Q2 | Q1 | Q0 |
  |---|---|---|---|
  | 0 | 0 | 0 | 0 |
  | 1 | 0 | 0 | 1 |
  | 2 | 0 | 1 | 0 |
  | 3 | 0 | 1 | 1 |
  | 4 | 1 | 0 | 0 |
  | 5 | 1 | 0 | 1 |
  | 6 | 1 | 1 | 0 |
  | 7 | 1 | 1 | 1 |

- **Why a house part:** the real 4-bit binary counters (74x161 / 163 / 393) are the cousins; CEC brings a
  bare 3-bit one to match the 3-bit converters (it drives the CEC1083 DAC for a ramp generator).

## 3. Package frame and pinout (shared by all five tiers)

**7-pin, drawn on an 8-lead frame (SC70-8 with one N.C., or MSOP-8).** Pin 1 indicator at the lower-left;
rotate into landscape exactly as `dff-ic.html` does. House pin order (inputs first, supplies last):

| Pin | Name | Function | Connection contract (every tier wires to this) |
|---|---|---|---|
| 1 | **CLK** | clock; increments on the LOW-to-HIGH edge | the clock-phase driver feeding stage 0 |
| 2 | **RESET** | asynchronous active-high clear (HIGH = count 0) | the clear line into all three stages |
| 3 | **Q2** | count bit 2 (MSB); also CLK/8 | stage-2 output node + the live Q2 readout |
| 4 | **Q1** | count bit 1; also CLK/4 | stage-1 output node + the live Q1 readout |
| 5 | **Q0** | count bit 0 (LSB); also CLK/2 | stage-0 output node + the live Q0 readout |
| 6 | **VCC** | positive supply (1.8 V to 15 V) | the top supply rail/tank shared by all stages |
| 7 | **GND** | ground / 0 V | the bottom reservoir / NMOS-source / substrate side |
| 8 | **N.C.** | no connect | leave unwired |

Adapt `drawPkg` per `ic-glyph-spec.md` §7.3: set the `pin(...)` calls to these numbers/names/x positions,
keep the top-pin-above-bottom-pin alignment, add a `PIN` lookup, and set `chipType`, the `names` map, and
the device-tier part name to **CEC3161**. **Every pin must trace to its role in every tier — no stubs**
(CLK to stage 0, RESET to all stages, each Q to its stage's output, VCC/GND to the shared rails).

## 4. The live model (interactive state, per frame)

Edge-triggered and digital — mirror `dff-ic.html`'s model; do **not** use the square-law analog model.
Internal state: the three stored bits and the clock-edge companion.

```js
// inputs this frame: CLK (boolean, from the clock generator), RESET (boolean, from the button),
//                    VDD (from the slider).
// state: q0, q1, q2 (the three bits), clkPrev.
if (RESET) {
  q0 = 0; q1 = 0; q2 = 0;           // asynchronous active-high clear
} else if (CLK && !clkPrev) {        // rising edge only
  // model it as a RIPPLE so the cascade is literal: bit 0 toggles every edge; a bit that
  // toggles 1->0 carries (clocks) the next bit.
  const c0 = q0;            q0 = q0 ? 0 : 1;          // stage 0 toggles every clock
  const c1 = c0 && !q0;     if (c1) q1 = q1 ? 0 : 1;  // carry when q0 fell 1->0
  const c2 = c1 && !q1;     if (c2) q2 = q2 ? 0 : 1;  // carry when q1 fell 1->0
}
clkPrev = CLK;
// derived: count = (q2<<2)|(q1<<1)|q0 ;  outputs Qk = qk ? VDD : 0.
```

Expose, for the tiers to read off the model record `s`: `q0`, `q1`, `q2`, `count` (0..7), the per-stage
**carry** flags (so tier 2/3 can light the ripple), `CLK`, `RESET`, and `VDD`. (Modelling it as a ripple
is a teaching choice — it makes the carry visible; the sim's behavioral counter reaches the same count.)

## 5. The five-tier arc (D-FF core ×3 + ripple carry)

Keep `dff-ic.html`'s master-slave core for **each of the three stages**; the new content is the cascade,
the carry, and the count.

**Tier 1 — symbol + pinout + timing diagram.**
- The counter **logic symbol**: a rectangle labelled `CTR` (or `÷8`), CLK with the **dynamic clock
  triangle** (the `>` notch) and RESET on the left, **Q0/Q1/Q2 on the right**. Wire each to its real pin
  via the package frame.
- The **scope is a timing diagram** (reuse the D-FF's): stacked traces **CLK, Q0, Q1, Q2** scrolling in
  time. This is the headline: Q0 is half the clock, Q1 a quarter, Q2 an eighth — read the three together
  top-to-bottom and they count up in binary. A live **decimal count read-out (0..7)** beside the scope.
- The **count table** (§2) with the row matching the live count highlighted.

**Tier 2 — flow network (analogy): the ripple cascade.**
- Three **toggle chambers** in a row (the D-FF's tier-2 master-slave two-chamber latch, instanced ×3),
  bit 0 to bit 2. Each chamber flips between two levels.
- Draw the **carry pipe** from each stage to the next: when a stage flips back to empty (1 to 0) it
  **kicks** the next stage. Light the carry pipe on the frame a carry fires. The reading: stage 0 flips
  every clock, stage 1 only when stage 0 rolls over, stage 2 only when stage 1 rolls over — so each fills
  half as often. (An odometer is the everyday analogy: each wheel rolls 9 to 0 and nudges the next; here
  the wheels are binary, 1 to 0.)

**Tier 3 — the divide-by-2 mechanism (zoom of tier 2).**
- Open each chamber into the **master-slave valve mechanism** (the D-FF's tier 3), and add the **toggle
  feedback** (`Q̄` routed back to the stage's own input) so each stage is plainly a **T flip-flop dividing
  by 2**. Three of them, with the **ripple-carry** wire (each stage's output clocks the next).
- Label the rates `/2`, `/4`, `/8` (or `÷2`, `÷4`, `÷8`) along the chain — the mechanism that produces the
  binary count is cascaded halving.

**Tier 4 — real device (schematic): three T flip-flops.**
- Draw **three edge-triggered flip-flops** in a row, each a **D flip-flop with `Q̄` wired back to `D`**
  (the D-FF's tier-4 transmission-gate master-slave core, reused verbatim per stage; the toggle feedback
  is the one added wire — see how `jkff-ic.html` draws its feedback).
- Wire the **ripple chain**: CLK drives stage 0; **each stage's `Q̄` clocks the next stage** (so stage 1
  sees an edge only when stage 0 rolls over, etc.). Route Q0/Q1/Q2 out to their pins. Draw the **RESET
  line** into all three latches' clear. Mark crossings with junction dots only where wires connect.
- This is the literal "a counter is three toggle flip-flops" build. (Tier 4 is the canonical flip-flop
  chain the behavioral sim emulates — see §6.)

**Tier 5 — silicon.**
- Keep the flip-flop's **CMOS storage cell** (the D-FF's tier 5: cross-coupled inverters / master-slave
  transmission-gate latch) for **one** stage, drawn in full, and indicate **"x3 — one per bit"** (the
  three cells side by side, or one detailed with two ghosted behind it).
- Annotate that the storage primitive is unchanged: a counter is just **three flip-flop cells plus the
  carry wiring on one die**. The regenerative bistable at the heart of each latch is the same one the
  D flip-flop and SR latch use.

## 6. Sim backend mapping (keep the glyph faithful to it)

The web part is **`ELEM_BEHAVIORAL` program 7** (no new sim-core element, golden-safe): a clocked integer
register that does `count = (count + 1) mod 8` on each rising CLK, asynchronously cleared by RESET, driving
Q0/Q1/Q2. The behavioral block emulates the flip-flop chain you draw in tier 4 — so tier 4 should draw the
**canonical three-T-flip-flop counter** (it is the "real device" the sim stands in for), exactly as the
flash-ADC and SAR glyphs draw their real architectures over a behavioral backing. State this alignment in
a footnote. (Pins: CLK = `f`, RESET = `g`, Q0/Q1/Q2 = `a`/`b`/`c`, VCC/GND = `d`/`e`.)

## 7. Controls and scope

- **Controls:** a **clock** (run/pause; a **single-step** button is strongly recommended so a viewer can
  watch each carry ripple one edge at a time), a **RESET** button, and a **VDD** slider for the rail. Drop
  the analog `vin`/`vt` sliders — meaningless for an edge-triggered part (same as `dff-ic.html`).
- **Scope:** the **timing diagram** (CLK, Q0, Q1, Q2 over time) plus the **decimal count read-out**. The
  default demo: run the clock and let the count climb 0 to 7 and wrap, with the timing diagram clearly
  showing each higher bit at half the rate of the one below. A reset mid-run should visibly snap the count
  to 0.

## 8. House style and validation (all must pass before handback)

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** on line 1: `<!-- SPDX-License-Identifier: Apache-2.0 -->`.
- **Design tokens / fonts / CSS:** copy verbatim from `dff-ic.html` (do not hardcode colors; use the
  `--bg`/`--surface`/`--accent`/signal tokens). Saira / Saira Condensed / IBM Plex Mono.
- **Forbidden glyphs in the HTML** (the §10 check must report `none`/`0`): em-dash (U+2014), en-dash
  (U+2013), arrows (U+2192/U+2190/U+2194), the minus sign (U+2212), smart quotes (U+2018/2019/201C/201D),
  and the entities `&mdash;`/`&ndash;`. Use the ASCII hyphen-minus; write ranges as "1.8 V to 15 V".
  **Allowed** (used freely in the existing sheets): the middle dot `·`, `×`, the division sign `÷`, `⊕`,
  `¬`, and the overlined `Q̄` (render an overbar as an SVG `<tspan>` or write "NOT").
- **§10 gates:** (1) `node --check` on the extracted script; (2) the forbidden-glyph check; (3) structure
  counts — `grep -c "drawPkg(gT"` must be **5**; (4) per-tier member consistency (every `tN.member` read
  in `updateTN` is created in `buildTN`); (5) a **Playwright render of all five tiers** with the
  console/page-error listener (mandatory — `node --check` does not catch undefined-at-runtime). Sweep the
  clock (and hit reset) across all tiers; screenshot and fix any collision or off-canvas label. If you
  cannot run the render, say so in the handback.

## 9. Handback checklist

- **Identity:** title / lede / `chipType` / device-tier name / `names` all read CEC3161 / 3-bit binary
  counter (no template leftover); grep confirms no stale clone strings.
- **The cascade is the star:** three identical toggle stages, the ripple carry drawn between them, and the
  count visible — in every tier, not just tier 1.
- **Circuit honesty:** tier 4 is three T flip-flops (D-FF master-slave + `Q̄ → D`) ripple-chained, RESET
  into all three; tier 5 is the flip-flop storage cell noted x3; the behavioral-sim alignment is
  footnoted.
- **No stubs:** every pin (CLK, RESET, Q0, Q1, Q2, VCC, GND) traces to its role in all five tiers.
- **The lesson lands:** the timing-diagram scope shows Q0/Q1/Q2 at CLK /2, /4, /8; the decimal count
  climbs 0 to 7 and wraps; a single-step makes one carry ripple visible; reset snaps to 0.
- **All §10 gates pass clean** (or the render is flagged for the owner).

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: NE555 timer, five-tier IC glyph

A standalone brief for the design agent. Build a five-tier IC glyph for the **555 timer** (real part:
**NE555**, the canonical analog-to-digital teaching IC). Read this top to bottom. For the verbatim
house infrastructure (CSS, fonts, helpers, scope chrome, frame loop) and the exact validation
commands, follow **`ic-glyph-spec.md`**; the part is the **555 timer** card in
**`new-part-refsheets.md`** (which carries the five-tier arc this brief expands), and its pinout is in
the verified-exemplar chart of that same file.

- **Output file:** `docs/ui/parts/ne555-ic.html`
- **`<title>`:** `555 timer, five layers` — set this correctly. (Earlier uploads shipped a leftover
  template title or stale pinout comments: `dff-ic` said "Schmitt inverter", `buf-ic` said "NOT
  gate", `jkff-ic` carried stale D-FF pinout comments. The `<title>`, the `<h1 class="lede">`, the
  `chipType` label, the part name in the device tier, and the `names` map must all say
  **555 timer / NE555** — and grep the finished file for stale template strings before handing back.)

---

## 0. The one idea

**Two comparators plus a latch make an oscillator.** A three-resistor divider sets two thresholds at
**1/3 VCC** and **2/3 VCC**. An external capacitor charges and discharges between them; one comparator
trips when the cap reaches 2/3 (reset), the other when it falls to 1/3 (set); the latch between them
remembers which way the cap is going and drives the output and a discharge switch. That is the whole
of the 555, and the whole bridge from the analog world (a ramping voltage) to the digital one (a
square wave). Every tier should carry that bridge: **a ramping cap voltage, two threshold trips, a
latch that squares it off.**

## 1. Build approach (mixed-signal; mostly a fresh build)

The 555 is neither a CMOS gate nor a flip-flop nor a LUT — it is a small **mixed-signal block**
(divider + two comparators + an SR latch + a discharge transistor + an output stage) wrapped around an
**external R-C**. There is no single template, so:

- **Take the house shell** (CSS, fonts, `el`/`drawPkg`/helpers, the scope chrome, the frame loop,
  controls scaffolding) from a digital sheet with a **timing-diagram scope** — `dff-ic.html` is a good
  base (the 555's scope is a timing trace, not the analog transfer curve of the gate sheets).
- **Reuse two pieces** where you can: the **comparator** tier patterns from `comparator-ic.html` for
  the two comparator blocks, and a **cross-coupled-gate SR latch** (the same bistable as the D-FF /
  the CEC3007 SR latch) for the latch between them.
- **The live model is a small RC-oscillator simulation** you write fresh (section 4) — an Euler
  charge/discharge of the cap with the two threshold trips flipping the latch. It is a *scaled*
  animation (legible on screen), not real seconds.
- **The timing capacitor and resistors are EXTERNAL** (R_A, R_B, C) — draw the canonical **astable**
  hookup as the default, and let them be the controls. The internal 555 is the divider + comparators
  + latch + discharge + output.

## 2. The part — 555 timer (NE555)

- **Real exemplars:** **NE555** (bipolar, the original); **ICM7555 / TLC555** (CMOS, low-power). Same
  pinout. Datasheet-verified; the pinout is invariant across every variant.
- **Astable behaviour (the default demo).** The cap charges toward VCC through R_A + R_B and
  discharges through R_B:
  - frequency `f = 1.44 / ((R_A + 2*R_B) * C)`
  - duty `D = (R_A + R_B) / (R_A + 2*R_B)` (always > 50% in the basic astable)
  - monostable pulse width (a mode variant) `T = 1.1 * R * C`
- **Thresholds:** TRIG fires when its pin falls below **1/3 VCC**; THRES fires when its pin rises
  above **2/3 VCC** (both set by the internal 3x 5k divider — the "555" name). The CTRL pin, if
  driven, overrides the 2/3 VCC reference.

## 3. Package frame and pinout (shared by all five tiers)

**8-pin DIP-8 / SOIC-8**, datasheet-verified, identical across NE555 / LMC555 / TLC555. Pin 1
indicator at the lower-left; landscape rotation like the other sheets. **This is a real part, so it
uses the real 555 pin order — NOT the CEC house convention.**

| Pin | Name | Function | Connection contract |
|---|---|---|---|
| 1 | **GND** | ground / 0 V | the bottom rail |
| 2 | **TRIG** | trigger; sets the latch when it drops below 1/3 VCC | the lower comparator's input |
| 3 | **OUT** | output (the square wave) | the right-margin output node + the live OUT readout |
| 4 | **!RESET** | active-low reset; low forces OUT low | the latch's async reset |
| 5 | **CTRL** | control voltage; overrides the 2/3 VCC reference | the upper divider tap |
| 6 | **THRES** | threshold; resets the latch when it rises above 2/3 VCC | the upper comparator's input |
| 7 | **DISCH** | discharge; the latch grounds it to drain the cap | the discharge transistor's drain |
| 8 | **VCC** | supply | the top rail |

In the canonical **astable** wiring: R_A from VCC to (DISCH=7); R_B from (DISCH=7) to (THRES=6 tied to
TRIG=2); C from that node to GND. So the cap node is TRIG+THRES, charged through R_A+R_B, discharged
through R_B into DISCH. Draw this external network in tier 1 (and as the source of the cap node in the
flow tiers).

Adapt `drawPkg` per `ic-glyph-spec.md` §7.3 for the 8-lead frame; update `chipType` (NE555), the
`names` map, and the device-tier part name.

## 4. The live model (interactive state, per frame)

A scaled RC oscillator. State: the cap voltage `vc` and the latch bit `q` (1 = charging / OUT high /
discharge off; 0 = discharging / OUT low / discharge on).

```js
// inputs: RA, RB, C (control values, scaled), VCC, dt (a fixed scaled timestep), reset (pin 4 low?).
var hi = (2/3)*VCC, lo = (1/3)*VCC;        // the divider thresholds (CTRL overrides hi)
if (reset) { q = 0; vc = 0; }              // async reset (pin 4 low)
else if (q === 1) {                        // charging toward VCC through RA+RB
  vc += (VCC - vc) * dt / ((RA + RB) * C);
  if (vc >= hi) q = 0;                      // upper comparator trips -> reset latch, discharge ON
} else {                                   // discharging toward 0 through RB
  vc += (0 - vc) * dt / (RB * C);
  if (vc <= lo) q = 1;                      // lower comparator trips -> set latch, discharge OFF
}
// OUT = q ? VCC : 0 ;  DISCH node = q ? floating : ~0 (transistor on) ;  vc is the analog ramp.
```

Pick `dt` and the R/C ranges so a full charge/discharge cycle takes a second or two on screen (a
*scaled* time base — flag it as such). Expose on the model record `s`: `vc`, `q`, the thresholds
`hi`/`lo`, which comparator most recently tripped, the discharge state, and `VCC`.

## 5. The five-tier arc (from the 555 card; the spec's non-gate worked example)

**Tier 1 — symbol + pinout + the astable hookup + the scope.** The timer block: the three-resistor
divider tap points (1/3 and 2/3 VCC), the two comparator inputs, the SR latch, OUT, and DISCH. Draw
the external **astable wiring** (R_A, R_B, C) as the canonical hookup. The **scope** (section 7) shows
the cap ramp between the two thresholds and the squared output.

**Tier 2 — flow network (the charge/discharge loop).** The external timing cap as a chamber: it
**charges toward VCC through R_A+R_B**; the upper comparator trips at the 2/3 tap and **sets the
discharge**, draining C through R_B until the lower comparator trips at 1/3 and starts charging again.
The chamber fill level is V_C; the output is the latch state. Show the two divider taps as fixed
reference levels on the chamber.

**Tier 3 — pressure-pilot valves.** The two comparators as pressure-pilot valves watching the 1/3 and
2/3 taps; the **SR latch** as a two-state detented mechanism (it stays put until a comparator pushes
it over); the **discharge transistor** as the drain valve the latch commands.

**Tier 4 — real device.** The internal block diagram: the three 5k resistor ladder (the "555" name),
the two comparators (long-tailed pairs), the SR flip-flop, the discharge NPN, and the output
push-pull stage. Note the bipolar-vs-CMOS internal difference (the CMOS 7555 has no discharge-current
spike).

**Tier 5 — silicon.** The bipolar NE555 process — the matched 5k ladder and the comparator
long-tailed pairs on the die; contrast the CMOS 7555 die (much lower Iq, faster, no discharge-current
spike). This tier can stay block/structure level (comparators + ladder + latch) rather than a single
transistor cross-section, since the 555's lesson is the architecture, not one device — flag that
choice in the handback.

## 6. Sim backend mapping (for the eventual web part)

The 555 is a `buildNetlist` **composition** of existing elements (no new sim-core element,
golden-safe): the **3x divider resistors** (`ELEM_RESISTOR`) tapping 1/3 and 2/3 VCC; the **two
comparators** (`ELEM_COMPARATOR` — the lower watching TRIG vs the 1/3 tap, the upper watching THRES vs
the 2/3 tap); the **SR latch** (cross-coupled powered `ELEM_GATE`s, the CEC3007 build); the
**discharge transistor** (an `ELEM_MOSFET` or gated switch the latch drives, grounding DISCH); and the
**output buffer**. The timing **R_A / R_B / C are external user-placed components**. Tier 4 should draw
exactly these blocks so the glyph and the eventual sim part agree.

## 7. Controls and scope

- **Controls:** **R_A**, **R_B**, **C** (the timing network — they set frequency and duty), a **VCC**
  slider, and a **!RESET** button. A **CTRL-voltage** slider is a nice advanced control (it bends the
  2/3 threshold and so the frequency/duty — the PWM trick). Optionally an **astable / monostable**
  mode toggle (monostable adds a trigger button and shows the one-shot pulse). Drop the analog
  `vin`/`vt` sliders.
- **Scope:** the **timing diagram** — plot **V_C** (the cap ramp, with dashed guide lines at 1/3 and
  2/3 VCC) and **OUT** (the square wave) on a shared time axis. This is the iconic 555 trace and the
  payoff of the whole sheet; make moving R_A/R_B/C visibly change the frequency and duty.

## 8. House style and validation (all must pass before handback)

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** on line 1: `<!-- SPDX-License-Identifier: Apache-2.0 -->`.
- **Design tokens / fonts / CSS:** copy verbatim from `dff-ic.html` (use the `--bg`/`--surface`/
  `--accent`/signal tokens; do not hardcode colors). Saira / Saira Condensed / IBM Plex Mono.
- **Forbidden glyphs in the HTML** (the §10 python check must report `none` and `0`): em-dash
  (U+2014), en-dash (U+2013), arrows (U+2192 / U+2190), the minus sign (U+2212), smart quotes
  (U+2018/2019/201C/201D), and the entities `&mdash;`/`&ndash;`. Use the ASCII hyphen-minus, write
  ranges as "4.5 V to 16 V" and fractions as "1/3 VCC" / "2/3 VCC", and "to" instead of an arrow.
  **Allowed:** middle dot `·`/`&middot;`, multiplication as `*` or `&times;`.
- **§10 gates:** (1) `node --check` on the extracted script; (2) the forbidden-glyph python check;
  (3) `grep -c "drawPkg(gT"` must be **5**; (4) per-tier member consistency (every `tN.member` read in
  `updateTN` is created in `buildTN`); (5) a Playwright render of all five tiers with the
  console/page-error listener (mandatory). Sweep R_A/R_B/C and VCC across tiers; screenshot and fix any
  collision or off-canvas label.

## 9. Handback checklist

Flag in the handback: the title / lede / chipType / part-name all read 555 timer / NE555 (grep for
stray "Schmitt", "NOT gate", "74AUP", "D flip-flop", "5-lead"); the cap ramp visibly oscillates
between the 1/3 and 2/3 thresholds and the output squares it off; moving R_A/R_B/C changes the
frequency/duty in the scope; the SR latch is drawn as the cross-coupled bistable (tying back to the FF
/ SR-latch storage primitive); the time base is scaled (not real seconds) and any block-level-vs-
transistor-level choice in the silicon tier; and all §10 gates pass clean.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# AC curriculum — build-and-observe examples

Status: **draft / spec**. Design for a ground-up alternating-current track, to be
implemented later as `ExampleSpec`s in `web/src/lib/examples.ts`. No code here —
this is the curriculum, the topologies, the values, and the `steps[]` sketches.

## The new part

We are adding one element to round out the analog set:

| Tag | Name | `value` means | Fixed | Pins |
| --- | --- | --- | --- | --- |
| `AC` | AC Source | **frequency in Hz** | **5 V peak** amplitude, ideal sine, no series R | `+`, `−` (like `V`) |

It is the time-varying twin of the DC `V` source: instead of holding a constant
level it sweeps `v(t) = 5·sin(2π·f·t)` volts between its two pins, a pure
deterministic function of the tick (`t = tick · DT`). Like `V` it is **ideal** —
zero source impedance — so it is treated exactly like the existing ideal sources
when paired with reactive loads (see "Care" below).

Simulating parts available to draw from: `V, AC, R, C, L, I, D` (diode,
nonlinear), `SW` (PWM switch), `GND`.

## The one constraint that sets every frequency: DT = 2 µs

The core integrates at a **fixed 2 µs step** (`docs/determinism.md`,
`const DT = 2.0e-6`). One period of a sine at frequency `f` therefore spans

```
ticks/period = (1/f) / DT = 500_000 / f
```

To draw a recognisable sine on the scope you want **≥ ~20 samples/period**; for
the smooth, pretty curves these examples lean on, aim for **100–1000+**. That
puts the usable, teachable band at roughly **50 Hz – 5 kHz**:

| f | ticks/period | samples/period | verdict |
| --- | --- | --- | --- |
| 50 Hz | 10 000 | 10 000 | luxuriously smooth; slow to fill a screen |
| 200 Hz | 2 500 | 2 500 | smooth; good "mains-ish" default |
| 500 Hz | 1 000 | 1 000 | smooth, fills the scope quickly — **the workhorse** |
| 1 kHz | 500 | 500 | smooth |
| 2 kHz | 250 | 250 | smooth |
| 5 kHz | 100 | 100 | still clean; near the comfortable floor |
| 25 kHz | 20 | 20 | ragged — the 20-sample wall; avoid |

Anything above ~5 kHz starts to look polygonal, and RF/MHz would need a smaller
DT (out of scope). **Keep every AC frequency in these examples between ~50 Hz and
~5 kHz.** Pick the default near **500 Hz** unless a filter/resonance example
needs a specific corner.

A second, subtler timescale note: the reactive companions are **backward-Euler**,
which adds a touch of numerical damping per step. With hundreds of steps per
period that damping is negligible (the existing `rlc` example relies on exactly
this — ~100 steps/cycle keeps the ring honest), so staying in-band protects the
solver's fidelity as well as the picture.

### A note on choosing R, C, L so the effect is visible

Reactances at our frequencies:

```
Xc = 1 / (2π f C)      Xl = 2π f L      f0 = 1 / (2π √(LC))
```

Rule of thumb used throughout: **pick the reactance to be the same order as the
series resistance at the chosen frequency** (so the phase shift / divider ratio
is large and obvious), and **pick component sizes so the corner or resonance
sits inside the 50 Hz – 5 kHz band**. Handy anchors at **500 Hz**:

- `C = 0.1 µF` → `Xc ≈ 3.2 kΩ`
- `C = 1 µF` → `Xc ≈ 320 Ω`
- `L = 100 mH` → `Xl ≈ 314 Ω`
- `L = 10 mH` → `Xl ≈ 31 Ω`

These are the values the examples below reach for.

---

## The arc

Nine examples, four categories, strictly ordered so each builds on the last.
"AC Fundamentals" first (what a sine even is, then RMS), then reactance of the
two energy-storage parts, then the filters they make, then resonance, then
rectification (turning AC back into DC — a tiny power supply at the end).

| # | id | Title | Category |
| --- | --- | --- | --- |
| 1 | `ac-resistor` | AC Across a Resistor | AC Fundamentals |
| 2 | `ac-rms` | RMS & Heating | AC Fundamentals |
| 3 | `ac-cap` | Capacitor Reactance | Reactance |
| 4 | `ac-ind` | Inductor Reactance | Reactance |
| 5 | `ac-lowpass` | RC Low-Pass Filter | Filters |
| 6 | `ac-highpass` | RC High-Pass Filter | Filters |
| 7 | `ac-resonance` | Series RLC Resonance | Resonance |
| 8 | `ac-rectifier` | Half-Wave Rectifier | Rectification |
| 9 | `ac-supply` | Smoothed Supply | Rectification |

Implementation conventions inherited from the existing examples: rectangular
loop layout (`AC`/source bottom-left, `GND` bottom-right, parts across the top),
connectivity by **pin reference** not position, `comp(g, kind, col, row, value,
rot?)` and `wire(g, a, ai, b, bi)` helpers, and `done(p)` checks that lean on
`at(p, kind)`, `p.wires`, and `p.complete`. Pin indices: two-pin parts are
`0 = first label`, `1 = second` (`AC`/`V`: `+ = 0, − = 1`; `R/L`: `A = 0, B = 1`;
`C`: `+ = 0, − = 1`; `D`: `A(anode) = 0, K(cathode) = 1`).

---

## 1. AC Across a Resistor — `ac-resistor`

**Category:** AC Fundamentals
**Teaches:** what "alternating" means. The source voltage rises and falls and
**reverses sign**; through a pure resistor the current is just `v/R`, so it
tracks the voltage exactly — same shape, **in phase**, and it **flows backward
every half-cycle**. First contact with a waveform instead of a flat DC level.

**Topology** (one loop, the `primer` example but with an AC source):

```
nets:  N1 = AC.+ = R.A
       GND(0) = R.B = AC.−
```

- `AC` at 500 Hz (5 V peak)
- `R` = 1 kΩ
- `GND` on the return rail

**Suggested values:** AC = 500 Hz, R = 1 kΩ → peak current 5 mA, in phase.
(Frequency is the one knob; 500 Hz fills the scope in ~1000 ticks.)

**Watch:** the node `N1` trace draw a clean sine swinging **+5 V to −5 V** (not a
flat line, and crucially it goes *negative* — below ground), while the wire's
current animation **speeds up, stops, and reverses direction** twice per period.
Voltage and current peak together: a resistor has no memory.

**`steps[]` sketch:**

1. **Place an AC Source (AC).** *Why:* unlike the DC source you've used, this one
   doesn't hold still — it pushes, eases off, then pushes the *other* way, over
   and over. Nothing flows yet; there's no loop.
2. **Place a Resistor (R).** *Why:* a path for the current, and a pure one — it
   has no memory, so whatever the source does, the current copies instantly.
3. **Wire the loop AC+ → R → AC− with a Ground, then Run.** *Why:* watch the
   scope draw a full sine, dipping *below* ground on every other half-cycle, and
   watch the current arrows halt and reverse each time the voltage flips. That
   reversal is the whole idea of AC. `done: p.complete`.

**`demo`:** *"Slow it down"* — toggle AC frequency 500 Hz ↔ 100 Hz so the sine
visibly stretches/compresses while keeping the same height; reinforces that
frequency is the horizontal axis and amplitude is fixed.

---

## 2. RMS & Heating — `ac-rms`

**Category:** AC Fundamentals
**Teaches:** AC delivers real power even though it averages to zero volts. A 5 V
**peak** sine heats a resistor like a **3.54 V DC** source would (`Vrms =
Vpeak/√2`). Side-by-side: the swinging source and a quiet DC source set to that
RMS value push the **same average power** through identical resistors.

**Topology** (two independent loops drawn on one board so they compare directly):

```
left loop:   N1 = AC.+ = R1.A ;  GND(0) = R1.B = AC.−
right loop:  N2 = V.+  = R2.A ;  GND(0) = R2.B = V.−
```

- Loop A: `AC` 500 Hz → `R1` 1 kΩ
- Loop B: `V` = **3.54 V** (the RMS of a 5 V peak sine) → `R2` 1 kΩ
- Shared `GND`

**Suggested values:** AC = 500 Hz, V = 3.54 V, R1 = R2 = 1 kΩ. Average power each
≈ `Vrms²/R` ≈ 12.5 mW.

**Watch:** the AC node sine peaks at ±5 V while the DC node sits as a flat line at
3.54 V — clearly *lower* than the AC peak — yet the **average** current/heating is
the same. The instantaneous AC current overshoots the DC for part of the cycle
and undershoots (even reverses) the rest; it's the **average of the square** that
matches, not the peak. (Conceptually the "fair" comparison; the scope shows why
5 V peak ≠ 5 V DC.)

**`steps[]` sketch:**

1. **Build the DC reference first: V (3.54 V) → R → GND, then Run.** *Why:* a
   plain steady current, a flat line — our yardstick for "this much heating."
2. **Now build the AC loop beside it: AC (500 Hz) → R → the same Ground. Run.**
   *Why:* the AC source swings *higher* than the DC line (±5 V vs 3.54 V), but
   watch the two currents: averaged over a cycle they carry the **same** load.
3. *(done: `at(p,"V")>=1 && at(p,"AC")>=1 && p.complete`).* *Why:* that 3.54 V is
   the **RMS** of a 5 V peak sine — `peak/√2` — the DC value that does equal work.

**`demo`:** *"Match the heat"* — toggle the DC source 3.54 V ↔ 5.0 V; at 5 V DC
the flat line sits at the AC's *peak* and now plainly out-heats it, driving home
that RMS (not peak) is the honest equivalent.

---

## 3. Capacitor Reactance — `ac-cap`

**Category:** Reactance
**Teaches:** a capacitor opposes AC with **reactance** `Xc = 1/(2πfC)` that
**falls as frequency rises** (a cap is an open to DC, a short to fast AC), and the
current **leads** the voltage by 90° — the current peaks while the cap voltage is
crossing zero, because `i = C·dv/dt`.

**Topology** (series R then C; the cap node is the output; the small R both makes
the phase legible and keeps the ideal source off a bare reactance):

```
nets:  N1 = AC.+ = R.A
       OUT = R.B = C.+
       GND(0) = C.− = AC.−
```

- `AC` at 500 Hz
- `R` = 330 Ω (sense/limit; small vs Xc so most of the swing lands on C)
- `C` = 0.1 µF → `Xc ≈ 3.2 kΩ` at 500 Hz

**Suggested values:** AC = 500 Hz, R = 330 Ω, C = 0.1 µF. The R current is the
cap current; with `Xc ≫ R` the cap voltage nearly equals the source, and the
**current leads it by ~90°**.

**Watch:** put the source node and the cap node on the scope together. The cap
voltage lags; the **current** (wire animation through R, and the slope of the cap
voltage) is **fastest exactly when the cap voltage crosses zero** and **stalls at
the cap's peaks** — current leads voltage. Then use the demo to *raise f* and
watch the cap voltage shrink (its share of the divider drops as `Xc` falls).

**`steps[]` sketch:**

1. **Place an AC Source (AC) and a small Resistor (R).** *Why:* R is our current
   probe — the wire through it shows the cap's current — and it keeps the ideal
   source from staring into a bare capacitor.
2. **Place a Capacitor (C) and wire AC+ → R → C → GND. Run.** *Why:* watch the
   cap voltage trail the source, and watch the current run *fastest as the cap
   voltage passes through zero* — `i = C·dv/dt`, so current **leads** by a
   quarter cycle. `done: p.complete`.
3. *(Use the demo to sweep frequency.)* *Why:* reactance isn't a fixed resistance
   — crank f up and the cap fights the current less (`Xc = 1/2πfC` drops).

**`demo`:** *"Raise the frequency"* — toggle AC 500 Hz ↔ 3 kHz. At 3 kHz `Xc ≈
530 Ω`, comparable to R, so the cap voltage visibly **shrinks** while the current
grows: reactance falling with frequency, made visual. **Care:** with C = 0.1 µF
both endpoints' corners stay in-band.

---

## 4. Inductor Reactance — `ac-ind`

**Category:** Reactance
**Teaches:** the mirror image of #3. An inductor opposes AC with reactance `Xl =
2πfL` that **rises with frequency** (a coil is a short to DC, an open to fast AC),
and the current **lags** the voltage by 90° — because `v = L·di/dt`, the current
can't turn around until the voltage has already led the way.

**Topology** (series R then L; the inductor carries the loop current):

```
nets:  N1 = AC.+ = R.A
       MID = R.B = L.A
       GND(0) = L.B = AC.−
```

- `AC` at 500 Hz
- `R` = 100 Ω (sense/limit)
- `L` = 100 mH → `Xl ≈ 314 Ω` at 500 Hz

**Suggested values:** AC = 500 Hz, R = 100 Ω, L = 100 mH. With `Xl` (~314 Ω) a
few × R, the loop current lags the source voltage by most of 90°.

**Watch:** the source-node sine vs the current (wire animation; or the voltage
across R, which is in phase with current). The **current peaks a quarter-cycle
*after* the voltage** — it lags. Sweep f *up* with the demo and the current
**shrinks** (`Xl` grows, the coil chokes high frequencies) — the exact opposite
of the capacitor's response, which is the point of placing them adjacent.

**`steps[]` sketch:**

1. **Place an AC Source (AC) and a small Resistor (R).** *Why:* again R is the
   current probe and a gentle limit; the action is the coil.
2. **Place an Inductor (L) and wire AC+ → R → L → GND. Run.** *Why:* the coil
   resists *change*, so the current can't follow the voltage instantly — watch it
   **lag a quarter cycle behind**. `done: p.complete`.
3. *(Compare to the capacitor example.)* *Why:* cap current *leads*, coil current
   *lags*; cap reactance *falls* with f, coil reactance *rises*. They are duals.

**`demo`:** *"Raise the frequency"* — toggle AC 500 Hz ↔ 2 kHz. At 2 kHz `Xl ≈
1.3 kΩ ≫ R`, so the current **shrinks** hard: a coil blocks high frequencies. Pair
mentally with #3's demo for the contrast.

---

## 5. RC Low-Pass Filter — `ac-lowpass`

**Category:** Filters
**Teaches:** the first useful circuit built from reactance. Series `R` into a
shunt `C` is a frequency-dependent voltage divider: at low f the cap's `Xc` is
huge and the output ≈ input; at high f `Xc` collapses and the output is **shorted
down** — high frequencies are attenuated. The **corner** `fc = 1/(2πRC)` is where
the output has fallen to ~70%.

**Topology** (identical wiring to #3, reframed as a filter — same parts, the cap
node is now "the filtered output"):

```
nets:  N1 = AC.+ = R.A
       OUT = R.B = C.+
       GND(0) = C.− = AC.−
```

- `AC` (the swept input)
- `R` = 1 kΩ
- `C` = 0.1 µF → **`fc ≈ 1.6 kHz`** — sits squarely in-band, with room to show
  "well below" and "well above" the corner.

**Suggested values:** R = 1 kΩ, C = 0.1 µF (`fc ≈ 1.6 kHz`). Default-run at a
**low** frequency (e.g. 300 Hz, well under `fc`) so the output starts out nearly
full size.

**Watch:** input node and output node on the scope. At the **low** default the
output sine nearly **overlaps** the input (passed). Hit the demo to jump to a
**high** frequency and the output sine **collapses to a fraction** of the input
(and lags) — the filter is throwing the highs away. Right at `fc` the output is
~0.707× and lags 45°.

**`steps[]` sketch:**

1. **Place an AC Source (AC), a Resistor (R), and a Capacitor (C).** *Why:* the
   same three parts as the cap-reactance demo — wired as a divider they become a
   *filter*.
2. **Wire AC+ → R → C → GND, with the R–C junction as the output. Run at a low
   frequency.** *Why:* low frequencies sail through — watch the output ride
   almost on top of the input. `done: p.complete`.
3. *(Flip the demo to a high frequency.)* *Why:* now `Xc` is tiny and shorts the
   output down — watch the output sine shrink away. This is a **low-pass**: lows
   pass, highs are cut, the knee is `fc = 1/(2πRC)`.

**`demo`:** *"Sweep low ↔ high"* — toggle AC **300 Hz ↔ 5 kHz** (well below vs
well above the 1.6 kHz corner). The single clearest "filter" reveal: same circuit,
output goes from full to crushed. **Care:** C is chosen so `fc ≈ 1.6 kHz` lands
**inside** the 50 Hz–5 kHz band with usable margin on both sides; both demo
endpoints stay sampleable (5 kHz = 100 samples/period).

---

## 6. RC High-Pass Filter — `ac-highpass`

**Category:** Filters
**Teaches:** swap the two parts and you get the **opposite** filter. With `C` in
series and `R` to ground, DC and low f are **blocked** by the cap (its `Xc` is
huge, dropping the whole swing) and only high f gets through. Same corner formula
`fc = 1/(2πRC)`, opposite slope — and it teaches **AC coupling** (the cap passes
the wiggle, blocks any DC offset).

**Topology** (C and R swapped vs #5; the resistor node is the output):

```
nets:  N1 = AC.+ = C.+
       OUT = C.− = R.A
       GND(0) = R.B = AC.−
```

- `AC` (swept input)
- `C` = 0.1 µF (series)
- `R` = 1 kΩ (to ground) → **`fc ≈ 1.6 kHz`** (same corner as #5, by design)

**Suggested values:** C = 0.1 µF, R = 1 kΩ. Default-run at a **high** frequency
(e.g. 5 kHz, above `fc`) so the output starts out nearly full size, then drop low.

**Watch:** at the **high** default the output ≈ input (passed). Demo down to a
**low** frequency and the output **shrinks** — the series cap is blocking it. The
mirror of #5: place them back-to-back in the browser and the symmetry sells
itself.

**`steps[]` sketch:**

1. **Place an AC Source (AC), a Capacitor (C), and a Resistor (R).** *Why:* the
   same parts as the low-pass — but this time the **cap is in series** and the
   resistor goes to ground.
2. **Wire AC+ → C → R → GND, with the C–R junction as the output. Run at a high
   frequency.** *Why:* fast wiggles slip through the cap — watch the output track
   the input. `done: p.complete`.
3. *(Flip the demo to a low frequency.)* *Why:* now the cap's `Xc` is huge and
   eats the whole swing — the output collapses. A **high-pass**: it also blocks
   any steady DC level (AC coupling).

**`demo`:** *"Sweep high ↔ low"* — toggle AC **5 kHz ↔ 300 Hz** (above vs below
the 1.6 kHz corner), opposite sense to #5. **Care:** same C-sizing constraint as
#5 keeps `fc` in-band; keeping R and C identical to #5 lets the two filters share
a corner and read as a matched pair.

---

## 7. Series RLC Resonance — `ac-resonance`

**Category:** Resonance
**Teaches:** the headline. Put `R`, `L`, and `C` in one series loop and drive it
with AC. The coil's `Xl` (rising with f) and the cap's `Xc` (falling with f)
**cancel** at one special frequency `f0 = 1/(2π√(LC))`. There the loop impedance
collapses to just `R`, so the current **peaks** — the circuit is **selective**,
ringing loudest at one note. (Distinct from the existing `rlc` example, which
*kicks* the loop with a DC step and watches it ring down; here we *drive* it and
hunt the peak.)

**Topology** (single series loop, same as the `rlc` example):

```
nets:  N1 = AC.+ = R.A
       N2 = R.B = L.A
       N3 = L.B = C.+
       GND(0) = C.− = AC.−
```

- `AC` (swept across `f0`)
- `R` = 47 Ω (small, so the resonant peak is sharp — high Q)
- `L` = 10 mH
- `C` = 1 µF → **`f0 = 1/(2π√(LC)) ≈ 1.59 kHz`**, comfortably in-band

**Suggested values:** R = 47 Ω, L = 10 mH, C = 1 µF → `f0 ≈ 1.59 kHz`. At
resonance `Xl = Xc ≈ 100 Ω`; with R = 47 Ω that's `Q ≈ 2`, a clear but not
needle-thin peak. Default-run **at `f0`** (≈ 1.6 kHz) so the player sees the loud
case first.

**Watch:** the loop current (wire animation) and the voltage across R. At `f0` the
current is **largest** and the source voltage and current are **in phase** (the
reactances have cancelled — the loop looks purely resistive). The cap and inductor
nodes can swing *larger than the 5 V source* (the `Q` boost). Detune with the demo
(below or above `f0`) and the current **drops off** — the resonance is sharp.

**`steps[]` sketch:**

1. **Place an AC Source (AC), a small Resistor (R), an Inductor (L), and a
   Capacitor (C).** *Why:* the coil and cap are opposites (#3 vs #4) — together in
   a loop they fight, and at one frequency they exactly cancel.
2. **Wire one series loop AC+ → R → L → C → GND, then Run at the resonant
   frequency.** *Why:* with `Xl` and `Xc` cancelled, only the little R is left —
   watch the current surge to its **maximum** and fall in step with the voltage.
   `done: p.complete`.
3. *(Detune with the demo.)* *Why:* move off `f0` either way and one reactance
   wins; the loop impedance climbs and the current dies back. The circuit is
   **tuned** — it favours one frequency. `f0 = 1/(2π√(LC))`.

**`demo`:** *"Detune"* — toggle AC **1.6 kHz (`f0`) ↔ 800 Hz** (well below
resonance). On-resonance the current is large and in phase; off-resonance it
shrinks and shifts. **Care:** L and C are chosen so `f0 ≈ 1.6 kHz` lands mid-band;
keep R small (47 Ω) for a visible Q but **not** so small the L/C node voltages
blow far past the scope's vertical range — `Q ≈ 2` keeps the overshoot readable.

---

## 8. Half-Wave Rectifier — `ac-rectifier`

**Category:** Rectification
**Teaches:** turning AC back into (lumpy) DC. A diode is a one-way valve: it
passes the **positive** half-cycles to the load and **blocks** the negatives, so a
symmetric ±5 V sine becomes a train of **positive-only humps**. The first step of
every power supply, and a payoff for the diode the player met in `diode-clamp`.

**Topology** (AC → diode → load R to ground):

```
nets:  N1 = AC.+ = D.A           (anode)
       OUT = D.K = R.A           (cathode / the rectified node)
       GND(0) = R.B = AC.−
```

- `AC` at **200 Hz** (slow enough that each hump is fat and easy to read)
- `D` (Shockley diode; `Is = 1e-12 A`, ~0.6 V forward drop at these currents)
- `R` = 1 kΩ (the load)

**Suggested values:** AC = 200 Hz, R = 1 kΩ. Positive peaks reach ≈ **4.4 V**
(5 V peak minus ~0.6 V diode drop); negative half-cycles are clamped to ~0 V (the
diode blocks, only `−Is` leakage flows).

**Watch:** input node vs output node. The input is a full ±5 V sine; the **output
is positive humps only** — the bottom halves are sliced off flat at ground, and
the tops sit a diode-drop (~0.6 V) below the input peak (so ~4.4 V, not 5 V). The
wire current pulses **once per period, one direction only** — never reverses.
This is nonlinear, so it engages the Newton solve (a nice callback to the diode's
behaviour from `diode-clamp`).

**`steps[]` sketch:**

1. **Place an AC Source (AC) and a load Resistor (R) to Ground.** *Why:* the
   alternating source and something to deliver power *to*. On its own the load
   would just see the full back-and-forth sine.
2. **Insert a Diode (D) between the source and the load — anode to the source,
   cathode to the load. Run.** *Why:* the diode only lets current through *one
   way*, so it passes the up-swings and blocks the down-swings — watch the output
   become **positive humps with the bottoms cut off**. The current pulses one
   direction only. `done: p.complete`.
3. *(Read the peak.)* *Why:* the humps top out ~0.6 V below the source peak — the
   diode's forward drop — so ~4.4 V, not 5 V. It's DC-ish now (always ≥ 0) but
   very lumpy. The next example smooths it.

**`demo`:** *"Flip the diode"* — toggle the diode's orientation (anode↔cathode);
reversed, it passes the **negative** humps instead, proving the valve has a
direction. (Implement as an `alt()` that swaps the two diode pins, or sets the
diode `rot` so `D.A`/`D.K` exchange ends.)

---

## 9. Smoothed Supply — `ac-supply`

**Category:** Rectification
**Teaches:** the finale — add **one capacitor** across the rectifier's output and
the lumps fill in. The cap **charges** on each hump's peak and **holds** the
voltage up through the gap (discharging slowly into the load) until the next hump
tops it back up. The result is a **roughly steady DC rail** with a little
sawtooth **ripple** — you've built a tiny **power supply** (AC in, DC out).

**Topology** (the half-wave rectifier of #8 with a smoothing cap added across the
load — directly parallels how `buck` adds its output cap last):

```
nets:  N1 = AC.+ = D.A
       OUT = D.K = R.A = C.+       (reservoir cap in parallel with the load)
       GND(0) = R.B = C.− = AC.−
```

- `AC` at **200 Hz**
- `D` (rectifier)
- `R` = 1 kΩ (load)
- `C` = **22 µF** → load time constant `R·C = 22 ms` ≫ the 5 ms period, so the cap
  holds well between humps (strong smoothing, small ripple)

**Suggested values:** AC = 200 Hz, R = 1 kΩ, C = 22 µF. With `R·C` (22 ms) ≈ 4×
the period, ripple is a few hundred mV on a ~4 V rail. (Smaller C → more ripple,
which is exactly what the demo shows.)

**Watch:** the output node. Where #8 was bare humps, the cap now **lifts the
valleys**: the output climbs to each peak (~4.4 V) then **sags only gently** until
the next hump, tracing a shallow sawtooth instead of dropping to zero. The diode
current changes character too — it now flows in **short, tall spikes** right at
each peak (topping the cap back up) rather than a smooth hump. A near-flat DC rail
from an AC source: a power supply.

**`steps[]` sketch:**

1. **Start from the half-wave rectifier: AC → D → R → GND. Run.** *Why:* recall
   the lumpy positive-only humps — usable as DC, but it drops to zero between every
   one. We're going to fill those gaps.
2. **Add a Capacitor (C) across the load (output to ground). Run again.** *Why:*
   the cap stores charge at each peak and **feeds the load during the gaps** —
   watch the valleys lift and the output settle into a nearly steady rail with a
   little ripple. `done: at(p,"C")>=1 && p.complete`.
3. *(Note the ripple.)* *Why:* the bigger the cap (or the lighter the load), the
   flatter the rail — `ripple ∝ 1/(f·R·C)`. You've turned AC into DC: a tiny power
   supply.

**`demo`:** *"Lift the smoothing cap"* — toggle the reservoir cap in/out
(`alt()` omits `C`, returning to #8's bare humps). The single most satisfying
before/after in the set: **flat rail with cap ↔ humps without it.** This mirrors
the `buck` and `pwm-average` pattern of revealing the smoothing element by its
absence. **Care:** size C so `R·C` is several periods (22 µF here) for obvious
smoothing; too large and the initial charge-up takes many cycles to fill the
scope, too small and there's barely any flattening — 22 µF at 200 Hz / 1 kΩ is the
sweet spot. (An alternate demo, *"Bigger reservoir"* toggling C 22 µF ↔ 1 µF, also
reads well if a single-circuit comparison is preferred.)

---

## Categories for the example browser

For the future collapsible browser, these nine group into four sections (listed in
teaching order). The first three categories double as the existing analog set's
home, so a unified browser might interleave the DC examples; the AC track stands on
its own as listed:

| Category | Examples | One-line |
| --- | --- | --- |
| **AC Fundamentals** | `ac-resistor`, `ac-rms` | what a sine is; why peak ≠ DC (RMS) |
| **Reactance** | `ac-cap`, `ac-ind` | how C and L oppose AC (lead vs lag) |
| **Filters** | `ac-lowpass`, `ac-highpass` | shaping by frequency; the RC corner |
| **Resonance** | `ac-resonance` | the tuned RLC peak at `f0` |
| **Rectification** | `ac-rectifier`, `ac-supply` | AC → DC; a tiny power supply |

(If the browser prefers broader buckets, **Reactance + Filters + Resonance** all
fold naturally under a single **"AC & Filters"** heading, with **Rectification**
kept separate as the applied capstone.)

## Cross-cutting implementation notes & care

- **Default frequency ≈ 500 Hz** unless a corner/resonance dictates otherwise
  (#5 starts low, #6 starts high, #7–#9 sit near their `f0`/run slow for fat
  humps). Never exceed ~5 kHz in any default or demo endpoint (≥ ~100
  samples/period); never go so low that a screen takes ages to fill (≳ 100–200 Hz
  is a good floor for watchability).
- **Ideal AC source + bare reactance is stiff.** Always put a series `R` between
  an ideal `AC` and a lone `C` or `L` (examples #3, #4 do — it doubles as the
  current sense). The pure RLC loop (#7) is fine because L, C and R share one mesh
  current, exactly like the existing `rlc` example.
- **Diode numbers** (#8, #9) follow the core's fixed Shockley constants (`Is =
  1e-12 A`, `n = 1`, `Vt ≈ 0.02585 V`): expect a ~0.6 V forward drop at a few mA,
  hence ~4.4 V rectified peaks from a 5 V source. These are nonlinear and engage
  the Newton solve — no special handling needed, but note the slightly-below-peak
  output in the copy so it isn't read as a bug.
- **Filter corner sizing** (#5, #6): `C = 0.1 µF` with `R = 1 kΩ` puts `fc ≈
  1.6 kHz` mid-band with margin both sides — the single most important value
  choice in the set. Keep #5 and #6 sharing R and C so they read as a matched
  low/high pair.
- **Resonance Q** (#7): keep R small for a visible peak but mind that a too-high Q
  drives the L/C node voltages well past 5 V; `Q ≈ 2` (R = 47 Ω) keeps the
  overshoot on-scope.
- **`demo` toggles** are recommended on **#1 (slow it), #3 (raise f), #4 (raise
  f), #5 (sweep low↔high), #6 (sweep high↔low), #7 (detune), #8 (flip diode), and
  #9 (lift the cap)** — i.e. almost all of them, because AC is inherently about
  *change* and a hi/lo toggle is the most direct way to show frequency dependence
  or the role of a part. #2's demo (DC 3.54 V ↔ 5 V) is the only non-frequency
  toggle.
- **Scope is the star.** Every example is framed around the node-voltage-vs-tick
  trace plus the animated wire current; the copy should always say *what to watch*
  in those two channels (height/shape on the scope, speed/direction/thickness on
  the wires), consistent with `docs/ui/visual-language.md`.

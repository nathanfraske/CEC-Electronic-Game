<!-- SPDX-License-Identifier: Apache-2.0 -->

# Frequency morph — components becoming their high-frequency selves

Status: **design** (2026-06-18). From the owner: "show the components literally
morphing into their high-frequency counterparts at those speeds — a shunt morphing
into a shunt + inductor at high speeds." The render of *why ideal parts stop being
ideal* as the frequency climbs. Sits beside the high-frequency render
(`docs/ui/high-frequency-render.md`, the shimmer/phasor) and rides the same
apparent-rate signal; its honest version depends on the Ideal/Real fidelity ladder
(`docs/sim/ideal-vs-real-parts.md`). Must honour `docs/determinism.md`.

## TL;DR

Every real passive is secretly an R–L–C, and as the frequency climbs past its
**self-resonant frequency (SRF)** it stops behaving like the part you drew and
**becomes its dual** — a capacitor turns inductive, an inductor turns capacitive, a
resistor/shunt grows a series inductance. The morph is the **render of that flip**:
the symbol/illustration grows its hidden parasitics and (past SRF) crosses over into
the other element, driven by the same apparent-rate signal the shimmer uses.

Two ways to do it, and the choice is the whole design:

- **Depicted** (render-only): the symbol morphs even though the solver still computes
  the ideal part. Cheap, unbounded, teaches the *concept* — but the meter won't
  confirm it, so the picture slightly lies.
- **Computed** (solver-backed): the **Real** model actually stamps the parasitics, the
  morph *visualises the equivalent circuit the solver is using*, and the multimeter
  **reads** the effect (a current shunt's value goes wrong at high dI/dt). Honest and
  powerful — and it is the natural **payoff of the Ideal/Real fidelity flag**.

Recommendation: build it as a Layer-3 render that *renders the Real model* — so it
lands as the visible reward for turning a part Real — with a render-only "preview"
toggle available first as a teaser. Lead with the **SRF flip** (cap ⇄ inductor) as the
headline and anchor the first build on the **current shunt** (shunt → shunt + L).

## The physics: at SRF a passive becomes its dual

Every passive has parasitics (lead/winding inductance, inter-electrode/winding
capacitance, series resistance). Their reactances cross over at the part's SRF, so the
impedance magnitude is V-shaped (or Λ-shaped) and the part *changes species*:

| Part | Below SRF | At SRF | Above SRF | The hidden elements |
| --- | --- | --- | --- | --- |
| **Capacitor** | a cap (Z ↓ with f) | pure **ESR** (a resistor) | an **inductor** (Z ↑ with f) | ESR (series R) + **ESL** (series L) |
| **Inductor** | an inductor (Z ↑) | parallel resonance (high Z) | a **capacitor** (Z ↓) | winding **C** (parallel) + series R |
| **Resistor / shunt** | a resistor | — | **R + series L** (Z ↑) | lead/body **ESL**; (HF: parallel C too) |
| **Wire / PCB trace** | a wire (~0 Ω) | — | a **transmission line** | distributed L–C → delay, reflections, Z₀ |

The headline lesson is the **cap ⇄ inductor flip**: "your 100 nF decoupling capacitor
is an inductor above ~8 MHz." The shunt is the headline *failure*: its ESL adds
`L·dI/dt` to the measured `I·R`, so a current-sense shunt reads the wrong current at
high dI/dt — the textbook "why HF current measurement is hard."

## The fork: depicted vs computed (the two homes again)

This lands exactly on the two homes for fidelity (`docs/sim/fidelity-ceiling.md`):

- **Depicted morph** — a *drawing*. The drawer grows the parasitics as a function of
  apparent frequency; the solver is untouched (still ideal). It teaches the idea and is
  unbounded, but a meter probe wouldn't show the parasitic effect, so it can drift from
  the math. Good as an **explanatory preview / teaching toggle** (like the "render:
  literal" aliasing demo).
- **Computed morph** — the *render of a real computation*. The Ideal/Real flag's **Real**
  model stamps `R + ESL (+ C)`; the morph visualises that very equivalent circuit, and
  the measurement confirms it (the shunt's reading diverges, the cap stops decoupling).
  Bounded by the solver's lumped/real-time wall, but **honest** — terminal behaviour and
  picture agree. This is the version worth building, and it is the **payoff** of the
  fidelity flag rather than separate work.

So: the parasitics live in the **solver** (Layer 1, the Ideal/Real ladder); the morph is
their **render** (Layer 3). Build the flag, then this renders it.

## The mechanism

1. **A high-frequency equivalent per kind.** Each part carries a small parasitic set
   with values (from its Real model, or teaching defaults): `R → {esl}`, `C → {esr,
   esl}`, `L → {cpar, rs}`, plus a derived **SRF** (`f_srf = 1/(2π√(LC))` for the
   reactive pair). These are the same numbers the Real stamp uses — one source of truth.
2. **A morph factor `m ∈ [0,1]` per part**, a smoothstep of the **apparent** frequency
   about the part's SRF (`m = smoothstep(f_srf/k, f_srf·k, f_apparent)`), reusing
   `tierKit.apparentFreq` / the same `apparentRateScale` the shimmer already sets each
   frame. So the morph is **tickrate-coupled too**: slow the playback and the part
   relaxes back to ideal; speed past its SRF and it crosses over. (For the shunt/resistor
   there is no resonance, just a monotonic ramp as `ωL` approaches `R`.)
3. **Drawer interpolation.** The kind's drawer blends ideal → equivalent on `m`:
   - **Sprout** (low–mid `m`): the hidden element fades/scales into the lead (a resistor
     grows a small series coil; a cap grows an ESR block + a short ESL coil), alpha/size
     on `m`, on the bounded `phase` like every other animation.
   - **Flip** (m past ~0.5 ≈ SRF): the dominant element *crosses over* — a capacitor's
     plates dissolve into a coil (and an inductor's coil opens into plates). A crossfade,
     not a snap, so it reads as a transformation.
   - **Glow-by-contribution**: the parasitic brightens in proportion to its share of the
     impedance (`ωL` vs `R`, or `1/ωC` vs `ωL`), so it appears exactly when it starts to
     matter — and on the shunt it lights up exactly as the measurement goes wrong.
4. **Tie to a measurable failure.** The shunt is the anchor demo: place a sense shunt,
   push high-dI/dt current, watch it morph to shunt + L while the probe reading diverges
   from the true current — the parasitic L glowing with its `L·dI/dt` error voltage. This
   couples the morph to the FAIL/measurement pedagogy instead of being decoration.

## Where it shows

- **Schematic symbol** (board + info panel): the cleanest place for the *flip* — the
  symbol literally becomes the other symbol. Best at the schematic tier.
- **Reality tier** (`detailDrawers.ts`): the parasitics shown as their physical origin —
  lead inductance as the literal leads, ESR as the foil/electrolyte resistance, winding
  capacitance between turns — the "why" behind the lumped element.
- Not the analogy tier by default (the factory metaphor doesn't have a natural "parasitic"
  vocabulary yet; revisit later).

## Determinism

- **Depicted** version: pure presentation — `m` is a function of (apparent frequency,
  bounded `phase`); it never feeds the sim or the hash, and it rewinds with the clock,
  exactly like the shimmer.
- **Computed** version: the parasitics are **Real-model** stamps, governed by the
  Ideal/Real ladder's "additive, golden-safe" rule — an *Ideal* part is unchanged, so the
  analog golden never moves; only a part switched to Real gains the parasitic (with its
  own reproducibility coverage). The morph render reads that solved state; it adds no
  nonlinearity of its own.

## Build order

1. **Ideal/Real fidelity flag** (Layer 1, already the next critical-path item) — adds the
   parasitic Real models (`esl`/`esr`/`cpar`) and the SRF. The honest morph needs this.
2. **`morphFactor(kind, apparentFreq)` + a `morph` input on `TierOpts`/glyph opts**
   (Layer 3) — the shared signal, beside `blurFactor`.
3. **Per-kind morph in the drawers**, kind by kind: resistor/shunt → +L first (the
   owner's example + the headline failure), then cap (→ ESR/ESL, the SRF flip), then
   inductor (→ winding C). Each is a drawer change + a catalog parasitic row.
4. **Render-only preview toggle** can ship *before* step 1 as a teaser (depicted morph on
   teaching-default parasitics), clearly marked "preview" so it never claims the meter
   agrees.

## See also

- `docs/ui/high-frequency-render.md` — the shimmer/phasor; shares the apparent-rate signal.
- `docs/sim/ideal-vs-real-parts.md` — the Ideal/Real ladder that supplies the parasitics.
- `docs/sim/fidelity-ceiling.md` — the two homes (depicted vs computed) this doc turns on.
- `docs/sim/multi-rate-domains.md` — why true distributed/RF stays out (the wire → real
  transmission line is approximated by a lumped L–C ladder, not a field solve).
- `docs/determinism.md` — the contract both the render and the Real stamps preserve.

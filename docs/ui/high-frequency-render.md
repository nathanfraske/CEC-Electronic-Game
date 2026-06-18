<!-- SPDX-License-Identifier: Apache-2.0 -->

# High-frequency render — making fast current, power, and phase legible

Status: **design** (2026-06-17). From the owner's render study (`acrender.html`).
The framework for drawing AC and fast-switching current/power on the board without
aliasing. Extends the flow language in `docs/ui/visual-language.md` and the tier
drawers; depends on the **AC analysis** measurement framework
(`docs/frameworks-roadmap.md`, Layer 2).

## The problem

Slow AC reads fine as carriers **sloshing** back and forth — the current *is* the
back-and-forth. But once the cycle rate climbs past what the eye can track
(~10–15 apparent Hz), animating every reversal at the true rate becomes **aliased
jitter**: the dots stutter and strobe, and the picture lies. Switching converters,
mains-and-up AC, and anything past a few hundred Hz all live here. We need a render
that stays honest and calm at any frequency, on the same fixed visual clock the rest
of the board uses.

## The key idea: decouple into three stable channels

The mistake is trying to animate the *waveform*. Instead, split the thing into the
**three quantities that actually matter**, each on its own non-aliasing channel:

| Quantity | Channel | Reads as |
| --- | --- | --- |
| **Current amplitude** \|I\| | **shimmer width** (+ pipe thickness) | a glowing band that gets fatter with current |
| **Real power** P = VI·cosϕ | **energy drift** (the orange belt) | a slow net drift that stalls as the load goes reactive |
| **Phase** ϕ (V vs I) | **phasor angle** (+ phosphor trail) | the angle between two arrows, opening past the reactive corner |

None of these three needs to move at the signal frequency, so none aliases. This is
the whole trick: **stop drawing the cycle; draw amplitude, power, and phase.**

## Channel 1 — the carrier → shimmer handoff

A single **blur factor** `b = smoothstep(b_lo, b_hi, f_apparent)` drives a smooth
hand-off from discrete carriers to a shimmer band (the study uses
`smoothstep(15, 300, f)`):

- **Low f (`b → 0`): discrete carriers slosh.** Today's flow rendering — dots sloshing
  back and forth, slosh amplitude = current amplitude. The current *is* the motion.
- **As f rises:** each carrier's slosh amplitude shrinks (`× (1−b)`), its radius grows
  (`+ b·k`), and its opacity fades — so the individual dots *dissolve* into a band
  rather than snapping off.
- **High f (`b → 1`): a shimmer band.** A soft-glow band (`feGaussianBlur`) whose
  **height/width tracks \|I\|**, with a faint fast vibration on the bounded phase clock
  (the "shimmer", not a real cycle). The eye reads blur, which is the honest picture of
  motion too fast to resolve.

The pipe itself carries two of the DC cues unchanged: **thickness = current
amplitude**, **fill colour = voltage**.

`b` is driven by the *apparent* rate (cycles/second as the player would see them),
derived from the AC analysis frequency — not by the solver Δt, so it's pure
presentation and frequency-stable.

## Channel 2 — real power as the energy drift

The board already has the orange **energy belt** (density/sign ∝ power, constant belt
rate — `docs/ui/visual-language.md`). It keeps working at high f and carries the load
the shimmer can't: when the current is just shimmering (no visible net motion), the
**orange drift still shows real power flowing**, and it **stalls as the load turns
reactive** — energy sloshing in and out of the field with no net delivery. So the two
channels say different true things: the shimmer says "lots of current," the drift says
"…but little of it is doing work." That contrast *is* the power-factor lesson.

(Discipline note: magnitude stays on density/alpha per the visual language; the drift
is the existing constant-rate power belt, not a magnitude-as-speed cheat.)

## Channel 3 — the phasor pair + phosphor persistence

A small phasor inset (a clock face) with two arrows — **V (warm)** and **I (cyan)**:

- The rotation is **cosmetic** and frequency-agnostic (slow, fixed rate). What carries
  the physics is the **lengths** (the amplitudes) and the **angle between them** — the
  phase ϕ the reactance adds, which **opens as you cross the reactive corner**
  (ϕ = atan(X/R)). A filled arc shows ϕ; the readout names it in degrees.
- **Phosphor persistence (the owner's ask):** the **I** arrow's tip leaves a fading
  trail, like analog-scope phosphor — successive positions decay over a few frames — so
  you literally *see* I trailing V around the dial. This is the at-a-glance read of
  "current lags voltage," with the lag length = ϕ. (Cheap: a short ring buffer of tip
  positions drawn at decaying alpha; deterministic since it's a fixed-length history of
  a value-derived point.)

Because the phasor is frequency-agnostic, it's the **one stable picture of the V–I
relationship at every frequency** — it reads identically at 1 Hz and 1 MHz.

## The phase-domain scope

The side scope plots **V and I over one cycle vs phase (0…2π), not time** — so it's
stable at any frequency and shows the waveforms + the phase shift directly. A play-head
sweeps the phase. (This is the analytic companion to the phasor: phasor = the vectors,
scope = the unrolled waveforms.)

## What it needs from Layer 2 (AC analysis)

The render is driven by a handful of **measured** quantities from the live time-domain
waveforms (a running, per-net/per-element analysis over a cycle — `frameworks-roadmap.md`
Layer 2):

- `f_apparent` (cycle rate) → the blur factor `b`.
- \|V\|, \|I\| (peak/RMS) → pipe thickness, shimmer width, phasor lengths.
- **ϕ** (V–I phase lag) → the phasor angle + the scope offset.
- **P_real**, power factor, \|Z\| → the energy drift + telemetry.

In the standalone study these come from a closed-form R–L model (`ϕ = atan(f/f_c)`);
on the real board they're **measured** from the solver's V/I (zero-crossing phase detect +
synchronous RMS over the last full cycle). **That measurement is now built** — a per-element
running analyzer (`AcMeas`) in `crates/sim-core`, read out by `Sim::ac_measurements()` as a
flat `[nElements × AC_FIELDS]` array (Vrms, Irms, Vmean, Imean, Vamp, Iamp, Preal, PF, |Z|,
phase, freq, valid). It is unhashed/golden-safe and crosses the wasm boundary once per frame
(`loop.ts` → `Snapshot.acMeasurements`). The render below is the **remaining Layer-3 piece**:
pure presentation of those numbers.

## Determinism

All presentation, all on the bounded visual `phase` clock, no solver change:

- The blur factor, shimmer, drift, phasor rotation, and phosphor trail are functions of
  (measured quantities, bounded phase) — they never feed the sim or the hash.
- The phosphor trail is a fixed-length history of a derived point → reproducible and it
  rewinds with the phase clock, like every other flow animation.
- The AC analysis (Layer 2) reads the snapshot only; it adds no nonlinearity to the
  solve. Per `docs/determinism.md`, nothing here can move the analog golden.

## The "literal" failure, kept as a teaching toggle

The study keeps a **render: literal** toggle that animates every reversal at the true
rate — which visibly **aliases into jitter above ~10 apparent Hz**. Worth keeping as an
optional demo: it shows *why* the handoff exists (the same "show the failure" pedagogy
as the FAIL box and the ideal-into-cap blow-up).

## Implementation sketch

1. **Layer 2:** ✅ **built** — AC analysis per element (`AcMeas` → `Sim::ac_measurements`),
   yielding RMS, \|V\|/\|I\|, ϕ, P_real, PF, \|Z\|, freq. Deterministic, snapshot-only;
   crosses the boundary as `Snapshot.acMeasurements` and is attributed per component by
   `electricalMap` into `ElectricalState.ac` (`AcReadout`).
2. **Flow framework:** ✅ **built** — `tierKit.shimmerFlow(...)` (the carrier↔band handoff
   on `b = blurFactor(apparentFreq(f))`, byte-for-byte `belt` at `b = 0`) beside
   `belt`/`flowAlongPath`, and the `tierKit.phasorInset(...)` widget (V/I arrows + phase
   arc + decaying-alpha I-tip trail, a pure function of the bounded phase → rewinds). The
   blur tracks the **apparent** rate, not the raw signal Hz: the host sets the sim-Hz →
   apparent-Hz scale `tps · DT` each frame (`setApparentRateScale`, from the playback
   tickrate), so deep slow-mo drops a fast signal back to visible sloshing carriers and
   speeding past the eye's band returns it to a shimmer — the owner's tickrate behaviour.
3. **Wire-pipe + tier drawers:** ◐ **mostly built** — the **board wires** hand off
   carriers→shimmer per wire: `Board.computeWireFlow` attributes each wire an apparent AC
   frequency (AC-amplitude-weighted mean of the element `ac.freq` in its KCL subtree) and
   an AC-fraction (AC amplitude vs DC current, so a rectifier's DC rail stays carriers),
   and `redrawWires` fades the chevrons/dots into a voltage-tinted glow band at high blur —
   in all three lenses, energy belt unchanged. The **inductor** analogy drawer does the
   same on its pipe; the **phasor inset** overlays the info panel for reactive parts
   (C, EC, L, TR) once a cycle is measured. *Still open:* the cap/transformer drawers
   adopting `shimmerFlow`.
4. **Scope:** ☐ plot V/I vs phase (already the right idea in `ac-curriculum.md`).

## See also

- `docs/ui/visual-language.md` — the discipline (the new channels obey it).
- `docs/ui/ac-curriculum.md` — the AC build-and-observe track this renders for.
- `docs/frameworks-roadmap.md` — where AC analysis (L2) + this render (L3) sit.
- `docs/sim/fidelity-ceiling.md` — why fast *analog* stays time-domain at one Δt and we
  render the apparent rate rather than chase it.

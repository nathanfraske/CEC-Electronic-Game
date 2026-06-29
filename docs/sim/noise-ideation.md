<!-- SPDX-License-Identifier: Apache-2.0 -->
# Device noise — deterministic, replay-exact, golden-safe

A teaching circuit game has to eventually show **noise**: why you can't read a
microvolt off a megohm, why a quiet op-amp costs more, why a 1-bit ADC dithers.
Noise is the biggest *analog* reality the engine still doesn't model. This note
is the design contract for adding it without breaking determinism.

## The hard constraint

The engine is **deterministic and replay-exact** (a recorded action journal
must re-solve bit-for-bit), and the **golden** snapshot hash
(`0xeaac_3764_99e4_fa24`, a linear RC circuit) must not move. Noise is random —
so the *only* admissible noise is a **seeded, deterministic** pseudo-random
function of `(element, tick)`: same circuit + same tick ⇒ same sample ⇒ same
hash, on every machine. We use no transcendentals (no `sin`/`exp` Box–Muller):
an **Irwin–Hall** sum of four `splitmix64` uniforms, centred and scaled, is an
approx-Gaussian built from adds/multiplies only, so it is IEEE-deterministic.

## v1 scope — Johnson (thermal) noise on resistors

The canonical, most teachable noise, and the one that pairs with the thermal
self-heating work already landed (Johnson noise *is* thermal noise). A
resistor's thermal noise is modelled as its **Norton equivalent**: a current
source `i_n` in parallel with `R`. Per tick we inject

```
i_n(e, tick) = params[NOISE_SLOT] · noise_sample(element_index, tick)
```

into the resistor's two nodes (a Norton current source, exactly the
`ELEM_ISOURCE` RHS stamp). It is **independent of the unknowns**, so it adds to
the RHS only — no matrix change, no Newton feedback, no convergence risk. The
resulting node-voltage noise is the injected current shaped by the network
(`v ≈ i_n / G_node`), which for a lone `R` to ground is `i_n·R` — so a current
amplitude `∝ 1/√R` gives a voltage `∝ √R`, the correct Johnson ordering
(bigger R ⇒ noisier).

`noise_sample` is zero-mean, ~unit-variance. The amplitude (`params[6]`, amps)
is **game-scaled** web-side for legibility — like diode `TT` and cap `tau`, the
realistic *ordering* (bigger R, hotter, cheaper grade ⇒ noisier) is what
matters, not the literal `√(4kTRΔf)` microvolts.

**Soft saturation (the high-impedance guardrail).** A lone resistor's
node-voltage noise is `≈ NOISE_I_SCALE·√R·tier·sample`, so it grows as `√R` —
and the part picker reaches **9.1 MΩ**, where the `3.46σ` peak (`|sample|` is
hard-bounded at `2√3`) would be **volts**. That is unphysical for the game and
could push a high-impedance node (a directly-tied CMOS input / latch storage
node) into the logic mid-rail and metastabilise it. So `resistorNoiseAmp`
**saturates above a knee** (`NOISE_R_KNEE = (NOISE_V_MAX/NOISE_I_SCALE)² =
1 MΩ`): below it the current is `∝ 1/√R` (the Johnson ordering, unchanged);
above it the current is `∝ 1/R`, so the lone-resistor node-voltage noise caps
at `NOISE_V_MAX·tier` (the two branches meet continuously at the knee). `≤ 1 MΩ
is byte-identical` to the un-clamped scale (so the 6T-SRAM 1 MΩ bit-line, the
golden, and the live-verified ≤ 100 kΩ dividers are unchanged); a 9.1 MΩ budget
node's `3.46σ` peak now stays clear of the `1.8 V` mid-rail floor.

## Why it's golden-safe

- New param **slot 6** (`NOISE_SLOT`), default `0`. `param_or`/direct read of an
  unset slot is `0` ⇒ no injection ⇒ byte-identical. Every existing netlist, the
  golden, and every **Ideal-mode** part has `0` here (the web emits it Real-mode
  only), so they are untouched.
- A `has_noise` install flag (mirrors `has_nonlinear`): when no element is noisy
  the transient solve **never calls** the noise path at all — zero added work,
  airtight byte-identity.
- Injected **only in the transient solves** (`solve_into_readout` /
  `solve_into_readout_newton`), never the **operating point**
  (`solve_operating_point` / `_newton`) — so the DC starting point stays clean
  and noise appears on top of it, exactly like `TT` uses `inv_dt = 0` at the OP.
- The sample is keyed on `self.tick` (reset to 0 on install/reset), so a replay
  re-walks the same tick sequence ⇒ the same noise. A noisy run's hash differs
  from a clean run — that is the point (noise is real, it enters the solve) —
  but it is *reproducible*, which is what the determinism contract requires.

## Determinism test matrix

- `golden_snapshot_hash_is_stable` — unchanged (noise slot `0` on the golden).
- `noisy_resistor_run_is_reproducible` — same drive twice ⇒ identical hash with
  noise **on**.
- a noise-actually-bites test — a Real-mode noisy resistor's node voltage has
  non-zero variance / its hash differs from the same circuit with noise off.

## Web side

`buildNetlist` emits `params[6]` on resistors **in Real mode only**,
tier-coupled (better grade ⇒ lower noise, like ESR), scaled `∝ 1/√R`. Added to
`TRANSIENT_TIER_KINDS`. Ideal mode emits nothing ⇒ ambient-clean. The scope
shows the fuzz directly (the noise is in `node_v`); no new render path needed.

## Later (not v1)

- **Shot noise** (`√(2qIΔf)`, current-dependent) — **LANDED** (2026-06-29) for **diodes**:
  `add_noise_currents` scales the slot by `√|I|` of the device's previous-tick committed `currents[i]`
  for `is_diode` kinds, so Johnson (fixed) and shot (`∝√I`) share `NOISE_SLOT`; `buildNetlist` emits a
  `SHOT_NOISE_SCALE` on diodes in Real mode (a junction property, not a tier). Tests:
  `shot_noise_needs_current` (the defining property — a conducting diode is noisy, an off one quiet) +
  `shot_noise_diode_run_is_reproducible`. Golden-safe (the golden has no diode; an Ideal diode emits 0).
- **Flicker / 1-f** (needs a shaping filter with `reactive_state`) — still later.
- An **RMS-noise readout** in the inspector — **LANDED** (2026-06-29): the std of a selected resistor's
  V-across over a sliding window ("Noise (RMS)", Real mode).
- Noise on more devices (op-amp input-referred, BJT shot) via the same slot.

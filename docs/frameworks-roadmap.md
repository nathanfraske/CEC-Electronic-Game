<!-- SPDX-License-Identifier: Apache-2.0 -->

# Frameworks roadmap — the foundations under the game

Status: **planning** (2026-06-17). The master dependency map for "build the
frameworks first, then the game." Stitches together the per-system design docs
(it does not replace them). Owner thesis: *the game is systems, and systems are
cheap once the frameworks exist* — so push the engine / render / data frameworks
to the point where a part, a contract, or a mechanic is **config**, then author
content on top.

## The thesis

A circuit-teaching game is two things stacked: a **substrate** (a deterministic
solver + a way to draw what it computes + a way to measure it) and **content**
(parts, examples, contracts, a progression). The content is the easy, high-volume
layer — but only if the substrate exposes the right *extension points*, so adding a
part is a stamp + a drawer + a catalog row, not an engine project. This doc is the
ordered list of substrate frameworks: what's **built**, what's **specced** (has a
design doc), what's **open**, and the critical path through them.

Status legend: ✅ built · 📐 specced (design doc) · ☐ open · ◐ partial.

## The four layers

```
  Layer 4  GAME SYSTEMS      contracts · economy · progression · grading      (content)
              ▲
  Layer 3  RENDER            tiers · flow primitives · AC handoff · FAIL box
              ▲
  Layer 2  MEASUREMENT       per-element V/I · per-leg currents · AC analysis
              ▲
  Layer 1  SOLVER CORE       MNA + backward-Euler + Newton · fidelity · coupling
```

Each layer only depends downward. Content (Layer 4) is deliberately last and
deliberately thin.

## Layer 1 — solver core (`crates/sim-core`)

The deterministic engine and its extension points. Every item here is bounded by
`docs/determinism.md` and the three walls in `docs/sim/fidelity-ceiling.md`.

| | Framework | Enables | Doc |
| --- | --- | --- | --- |
| ✅ | Fixed-step MNA + backward-Euler companions + Newton outer loop + FNV-1a hash | the whole deterministic substrate | `docs/architecture.md`, `docs/determinism.md` |
| ✅ | Element set (V/R/C/L/I, diodes, FET, BJT, op-amp, transformer, switch, gates, FF, MOV, zener; POT/EC/thermistor as netlist expansions) | today's catalog | `docs/parts-roadmap.md` |
| ✅ | FAIL clamp (engine half — `FAIL_LIMIT`, `flag_and_clamp_fails`) | NaN-free, platform-identical failure | `docs/sim/ideal-vs-real-parts.md` |
| 📐 | **Ideal/Real fidelity flag** — a `real?` bit per part selecting an Ideal vs Real stamp (parasitics element-internal or by netlist expansion) | **the progression lever** — the whole "fidelity is difficulty" pillar | `docs/sim/ideal-vs-real-parts.md` |
| ✅ | **Floating-component `GMIN`** — one weak ground tie per floating connected component (`floating_refs` → `stamp_floating_refs`, golden-safe) | isolation, floating transformer secondary, the Rogowski output | `crates/sim-core` · `docs/sim/floating-networks.md` |
| 📐 | **Sensor / transducer framework** — current-sense (Rogowski), controlled sources (CCVS/VCVS), derivative sources | probes, isolation amps, sense elements | `docs/sim/floating-networks.md` |
| 📐 | **Thermal / self-heating domain** — a lumped thermal node per part, a slow multi-rate domain coupled to the electrical (I²R in, R(T)/ratings out) | the thermistor payoff, resistor power rating, thermal runaway | (to write; seeded by the thermistor `temp` field + multi-rate) |
| 📐 | **Multi-rate + mixed-signal** — digital clock domains; boundary converters (ADC/DAC/comparator/buffer); behavioral CPU/FPGA | the digital/IC tier without breaking the analog Δt | `docs/sim/multi-rate-domains.md` |
| ☐ | **Deterministic noise** — seeded per-part thermal/shot/flicker | the "real bench" feel; Real-tier realism | `docs/sim/ideal-vs-real-parts.md` (Real column) |

## Layer 2 — measurement / analysis (derived from the solve)

What turns raw node voltages + branch currents into the quantities the render and
the grader want. Pure functions of the snapshot — no new physics.

| | Framework | Enables | Doc |
| --- | --- | --- | --- |
| ✅ | Per-element current + per-net voltage attribution (`electricalMap`) | every glyph animating from its real state | `web/src/lib/netlist.ts` |
| ✅ | **Per-leg currents** (`legsOfComponent` → `ElectricalState.legs`) | proportional-split flow (the POT wiper "stealing") | `docs/sim/...` (PR #99) |
| ✅ | **AC analysis** — per-element running RMS, peak, **phase lag (V vs I)**, real power, power factor, \|Z\|, frequency measured over a cycle from the live waveforms (`AcMeas` → `Sim::ac_measurements`, unhashed/golden-safe) | the phasor + high-frequency render + AC telemetry + AC grading | `crates/sim-core` · `docs/ui/high-frequency-render.md` |
| ☐ | FAIL mask across the wasm boundary | the visible FAIL state | `docs/sim/ideal-vs-real-parts.md` |

## Layer 3 — render frameworks (`web/src/lib`)

The tier illustrations and the flow language. Governed by `docs/ui/visual-language.md`
(magnitude rides density/alpha/thickness, never speed).

| | Framework | Enables | Doc |
| --- | --- | --- | --- |
| ✅ | Tier system (schematic / analogy / reality) + per-kind drawer maps + `InfoDiagram` | the three views of every part | `docs/ui/component-info-panel.md` |
| ✅ | Flow primitives (`belt`, `flowAlongPath`, `flowAroundPlug/Ball`, `flowThroughGap`, `scatterY`, `pipeLead`, `flowSplit`) | every animated drawer | `tierKit.ts` |
| ✅ | Proportional-split flow (`flowSplit` + `legs`) | divider/sense splits drawn to scale | (PR #99) |
| ✅ | Connector pipe (parts join the wire-pipes) | nothing looks "broken up" | (PR #96) |
| ◐ | **High-frequency AC render** — the carrier→shimmer handoff + phasor pair + phosphor persistence | switching/AC legible without aliasing | `docs/ui/high-frequency-render.md` |
| 📐 | **Frequency morph** — parts visibly becoming their HF selves at SRF (cap ⇄ inductor, shunt → shunt + L), on the same apparent-rate signal | the render of *why ideal parts stop being ideal* — the payoff of the Real flag | `docs/ui/frequency-morph.md` |
| ◐ | Per-part flowing pipe-leads sweep (MOV/POT/caps/EC done) | transformer, transistors, op-amp, sources, switches still thin | (TODOS) |
| ☐ | FAIL box (pulsing red + `FAIL`) on flagged parts | the honest failure signal | `docs/sim/ideal-vs-real-parts.md` |

## Layer 4 — game systems (content on the substrate)

Deliberately last and thin. These are "just systems": once Layers 1–3 expose the
hooks (a part is a stamp+drawer+row; a measurement is a Layer-2 readout; a FAIL is
a flag), contracts/economy/progression are configuration + UI.

- 📐 Contracts · economy · Lux · rewards — `docs/game-contracts-economy.md`,
  `docs/game-rewards.md`, `docs/game-progression.md`, `docs/game-design.md`
  (Pillar 2: *fidelity is the progression*).
- 📐 Grading / verification — sample measurements under stated conditions, replayed
  deterministically (`docs/determinism.md`). Built on Layer 2.
- 📐 Curricula (AC track, etc.) authored as `ExampleSpec`s — `docs/ui/ac-curriculum.md`.

## Critical path (suggested build order)

Ordered by *unblocking power per unit effort*, not by glamour:

1. **Floating-component `GMIN`** (L1). Smallest engine change, golden-safe, and it
   immediately fixes the floating transformer secondary + any isolation circuit.
2. **AC analysis** (L2) → **high-frequency AC render** (L3). The owner's shimmer/
   phasor design; high visual payoff, and AC analysis also feeds AC grading later.
3. **Ideal/Real fidelity flag** (L1). The progression lever — most of the game's
   depth curve rides on it, and the Ideal models already exist (golden-safe).
4. **Thermal / self-heating domain** (L1, needs multi-rate scaffolding). Cashes in
   the thermistor `temp` prep, the resistor power rating, the fire FAIL.
5. **Sensor framework + Rogowski** (L1, needs #1). Probes + isolation parts.
6. **Multi-rate + boundary converters** (L1). Opens the CPU/FPGA/ADC tier.
7. **Finish the render sweeps** (L3): remaining pipe-leads, reality drawers, the
   FAIL box, deterministic noise.
8. **Then the game** (L4): contracts, economy, progression, grading, curricula —
   authored on the now-complete substrate.

Steps 1–3 are the high-leverage near-term cluster; 4–6 are the "more reality" depth;
7 is polish; 8 is content.

## The discipline that spans every engine framework

From `docs/determinism.md`, restated because every Layer-1/2 item must hold it:
fixed Δt (no adaptive step), timing from **structure not values**, seeded RNG only,
FNV-1a hashing, reverse = rewind. New behaviour gets its own `*_run_is_reproducible`
coverage; the **Ideal** models stay bit-identical so the analog golden never moves
unless a change is deliberate and documented.

## See also

- `docs/sim/fidelity-ceiling.md` — what bounds Layer 1 (and why the reality tier is
  unbounded).
- `docs/sim/ideal-vs-real-parts.md` — the per-part fidelity ladder (the L1 lever).
- `docs/sim/floating-networks.md` — floating subnets + Rogowski (L1).
- `docs/sim/multi-rate-domains.md` — the timing/mixed-signal ceiling (L1).
- `docs/ui/high-frequency-render.md` — the AC render framework (L2→L3).
- `docs/ui/visual-language.md` — the render discipline all of L3 obeys.

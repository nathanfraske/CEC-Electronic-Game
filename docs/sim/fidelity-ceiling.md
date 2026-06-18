<!-- SPDX-License-Identifier: Apache-2.0 -->

# The fidelity ceiling — how real can this sim get, and where it stops

Status: **architecture note** (2026-06-17). Answers the owner question "how *real*
can we make this sim, how much reality can we add, where's the stopping point?" This
is the map; the device-by-device fidelity ladder lives in
`docs/sim/ideal-vs-real-parts.md`, and the timing-domain ceiling in
`docs/sim/multi-rate-domains.md`. This doc is the synthesis: what bounds the whole
thing, and the one structural insight that buys back most of the apparent limits.

## The short answer

There are **two homes for fidelity**, and they have very different ceilings:

- **The solver** (`crates/sim-core`): a deterministic, real-time, **lumped** MNA engine.
  Its ceiling is roughly **SPICE Level-1–3 compact models** — ideal parts, then their
  real parasitics, lumped magnetic/thermal coupling, and digital domains to GHz via the
  event kernel. It does **not** do adaptive timestep, distributed/EM fields, huge
  netlists, RF, or true device physics.
- **The visualization** (the reality tiers in `analogyDrawers.ts` / `detailDrawers.ts`):
  essentially **unbounded**, because it is a *drawing*, not a computation. It can depict
  zinc-oxide grains breaking down, carriers hopping across grain boundaries, a poppet
  cracking, heat shimmering — physics the solver never computes — purely for teaching.

So the stopping point isn't one line. **Computed** reality stops at the lumped /
deterministic / real-time wall. **Depicted** reality stops only where it stops teaching.
Most "can we make it more real?" questions are answered by choosing the right home.

## The three walls that bound the *solver*

Everything the solver can or can't do falls out of three hard constraints. They are
features, not accidents — each is load-bearing for the game.

### 1. Determinism (the golden contract — `docs/determinism.md`)

Pause, single-step, rewind, and grading all replay from one design, bit-for-bit, on any
machine. That forces:

- **A fixed integration step.** No adaptive Δt. This is the single biggest divider
  between us and SPICE: SPICE shrinks Δt through an inrush or a fast edge; we can't,
  because two machines would pick different steps and diverge (`multi-rate-domains.md`).
  Timing may depend on circuit **structure**, never on solved **values**.
- **Fixed order + stable hashing.** No hashed-iteration-order dependence; FNV-1a over
  the snapshot, never the std hasher.
- **Bounded nonlinear solve.** Newton-Raphson with a hard iteration cap and fixed
  tolerances; the count is data-dependent but each step is deterministic.
- **Reverse = rewind, not back-integration.** Dissipative circuits are unstable
  backward, so we re-simulate forward from keyframes.

**What this rules out:** adaptive timestep; any value-dependent branching in the
schedule; unseeded randomness (noise is fine *only* as a deterministic, seeded source).
**What it permits:** anything whose behaviour is a pure function of (structure, tick,
fixed constants) — which is most of analog and digital electronics.

### 2. Real-time in WebAssembly

The whole solve runs every frame in a browser tab. The core is a **dense** MNA matrix
factored by Gaussian elimination (O(n³)). That caps:

- **Circuit size** — hundreds of nodes, not the millions a chip-level tool handles. Fine
  for a teaching board; a hard wall for VLSI-scale nets.
- **Per-step cost** — Newton iterations × matrix factorisations per tick must fit a
  frame. Rules out heavy per-frame iterative physics (field solves, big optimisation).

Sparse factorisation and partitioning could push `n` up if we ever need it, but the
real point is that the *target circuits are small*, so this wall is rarely felt.

### 3. Lumped, not distributed

MNA is **lumped**: nodes have one potential, elements connect nodes, KCL/KVL hold
instantly. That excludes everything where *position inside a wire* matters: transmission
lines, controlled-impedance traces, reflections, radiation/antennas, skin effect, true
wave propagation. Those need a different solver entirely (telegrapher's equations / FDTD
/ method-of-moments). You can *approximate* a distributed effect with a lumped ladder (a
transmission line as N×LC segments), but true EM is out of scope for a real-time browser
teaching sim — and almost never the lesson.

## The fidelity axes, and how far each can actually go

| Axis | Where it can go (computed) | The wall |
| --- | --- | --- |
| **Device models** | Lots of headroom: ideal → parasitics → tolerance, thermal drift, saturation, SOA, GBW/slew, β-rolloff, breakdown. The main "more reality" lever. | Compact/behavioral models (SPICE L1–3). **Not** TCAD device physics or carrier-level Monte Carlo. |
| **Parasitic coupling** | Lumped mutual L (transformer, Rogowski — `floating-networks.md`), inter-net capacitance, declared crosstalk. | Coupling must be a **placed component**, not derived from layout geometry / fields. |
| **Floating / isolation** | Yes, with one `GMIN` per floating component (`floating-networks.md`): isolated supplies, instrumentation front-ends, Rogowski outputs. | The reference is a tiny tie, not a true infinite-impedance float. |
| **Timescales** | Digital to GHz via the **event kernel**; analog at one fixed µs Δt; a slow thermal domain as another fixed rate (`multi-rate-domains.md`). | Fast *analog* (RF) needs a tiny Δt → infeasible real-time; use behavioral/envelope models. Adaptive Δt never. |
| **Thermal / self-heating** | A lumped thermal state per part, coupled to the electrical as a slow multi-rate domain (the thermistor `temp` field is the seed). I²R heating, ratings, thermal runaway, the resistor-fire FAIL. | 3-D heat-flow / inter-part thermal networks are heavy; a lumped node per part is the practical ceiling. |
| **Noise** | Thermal/shot/flicker as a **deterministic seeded** source (per-part seed, like Real tolerance). | True stochastic ensembles / Monte-Carlo spreads are out; a seeded realisation is in. |
| **Mixed-signal** | ADC/DAC/comparator as honest **boundary** parts; behavioral CPU/FPGA in the digital kernel (`multi-rate-domains.md`). | No magic analog↔digital crossing without a converter part — by design. |
| **Sub-device physics** | — | Quantum / TCAD / semiconductor process physics: **never computed.** This is the visualization's job (below). |

## The structural insight: push physics into the *picture*, not the *solver*

The reality tiers already do this and it's the key to "how real can it look without
breaking the sim." The solver treats an NTC thermistor as a plain resistor whose value
is `R(T)`; the **reality drawer** shows the polycrystalline grain chain with carriers
funnelling through grain-boundary necks (`detailDrawers.ts`). The solver treats a varistor
as a clamp; the reality tier shows zinc-oxide grain boundaries breaking down. None of that
grain physics is *computed* — it's *depicted*, driven by the few real numbers the solver
does produce (V, I, R, temperature).

This is the escape hatch for almost every "can it be more real?" request:

- If the realism changes **terminal behaviour** (what the meter reads, how the circuit
  settles) → it belongs in the **solver**, and it's bounded by the three walls above.
- If the realism is **explanatory** (what's happening *inside* the part, *why* it
  behaves that way) → it belongs in the **reality tier**, where it's bounded only by
  teaching value and animation budget, and can show physics the solver will never touch.

A Rogowski coil is a good test of the seam: its *terminal* behaviour (non-loading sense,
`M·dI/dt`, floating output) is a solver feature (`floating-networks.md`); its
*explanation* (flux threading a toroid, why it ignores DC) is a reality-tier drawing.

## So: where's the stopping point?

- **Computed (solver):** stop at lumped, deterministic, real-time. That still reaches a
  long way — real parasitics, tolerance, saturation, lumped coupling, isolation, slow
  thermal, GHz digital, mixed-signal via converters. It deliberately stops short of
  adaptive timestep, distributed EM, RF, VLSI-scale nets, and device-physics-level models.
- **Depicted (reality tiers):** stop where it stops teaching. There is effectively no
  technical ceiling — it's a drawing — so the limit is editorial: does showing this
  *help someone understand the part?*
- **The pacing** is `ideal-vs-real-parts.md`'s "fidelity is the progression curve":
  start pure-ideal, carry essential parasitics past the basics, layer full Real models as
  advanced unlocks. Added realism past the point where it teaches (or where it threatens
  determinism / the frame budget) is the actual stopping point — not a physics limit but a
  design one.

## See also

- `docs/sim/ideal-vs-real-parts.md` — the per-part ideal→real ladder (the main lever).
- `docs/sim/multi-rate-domains.md` — the timing-domain ceiling and the analog/digital split.
- `docs/sim/floating-networks.md` — floating subnets + the Rogowski coil.
- `docs/determinism.md` — the contract that sets wall #1.

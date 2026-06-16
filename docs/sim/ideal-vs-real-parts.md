# Ideal vs Real parts — the fidelity ladder

Status: **design + brainstorm** (2026-06-16). The FAIL-state engine foundation is
**shipped**; the part-family split and the realistic models are **not built yet**.
This doc is the plan.

This is the concrete mechanic for the "fidelity is the progression" pillar in
`docs/design/game-design.md` and the "Real variants of Tier I" tech-tree tier in
`docs/design/game-contracts-economy.md`. It turns the whole class of
ideal-source-into-a-diode blow-ups (see `docs/sim/transformer-bridge-convergence.md`
and the FAIL-state work below) from a bug into the curriculum.

## The idea

Every part exists in two families, toggled in the bin (and per-part in the inspector):

- **Ideal** — a perfect textbook element. No series resistance, no leakage, no
  parasitic L/C, no tolerance. It does exactly what the equation says. When an ideal
  configuration is *unphysical* — an ideal diode with no series resistance charging a
  cap, an ideal source into a short — it does not silently fudge a finite answer; it
  **FAILs**: the whole sim enters a FAIL state and each offending part is wrapped in a
  pulsing red box labelled `FAIL`. The failure *is* the lesson — "ideal parts have no
  impedance, so this draws infinite current; that's why real circuits need some."
- **Real** — a bench part with the parasitics that bound it: winding/bulk/output
  resistance, leakage and core loss, ESR/ESL, junction capacitance, finite
  gain-bandwidth, tolerance. It behaves like hardware and stays bounded where the ideal
  one fails.

The progression from ideal → real is the fidelity ladder: you learn the clean concept
on ideal parts, then confront *why* real ones differ (and why a design that works ideal
can fail real, and vice-versa).

### Decisions (owner, 2026-06-16)

- **FAIL is whole-sim**, not per-reading: any part hitting its bound puts the sim into a
  FAIL state, with the failing component(s) boxed by a **pulsing red box showing `FAIL`**
  above them. (The sim should pause/freeze in FAIL rather than keep computing garbage.)
- **Mixing ideal and real is allowed but warned** — not hard-blocked. A wire between an
  ideal-domain pin and a real-domain pin connects, but is flagged (warning / distinct
  wire colour), since a deliberate mix is occasionally instructive. (Earlier sketch was a
  hard "won't connect"; softened to allow-but-warn.)
- An **ideal part with no series impedance reads an insanely large value → FAIL** is the
  intended, honest behaviour. The cure in-circuit is to add real impedance — a literal
  resistor, or a Real part.

## The FAIL state (engine foundation — SHIPPED)

`crates/sim-core/src/lib.rs`, merged in PR #70:

- `const FAIL_LIMIT: f64 = 1.0e9` — a solved magnitude at/beyond this (or non-finite) is
  a FAIL.
- `flag_and_clamp_fails()` runs at the end of every `step()`: it screens every
  displaying/propagating quantity (node voltages, per-element currents, `reactive_state`,
  `secondary_state`), **clamps** any non-finite or out-of-bound value to `±FAIL_LIMIT` so a
  `NaN` can never carry into the next step (which used to delete traces on wasm), raises
  the whole-sim `failed` flag, and marks each offending element in `failed_elements`.
- Public API: `failed() -> bool` and `failed_element_mask() -> Vec<u8>` (parallel to
  `element_currents()`).
- **Determinism win:** the clamp is a fixed bound, so native and wasm now agree exactly
  on a FAIL — `NaN` was the one thing that differed across platforms and the root of
  every "works locally, breaks live" failure. Well-behaved circuits never reach the
  bound, so the snapshot hash and the analog golden are unchanged (verified; 102 tests).

### FAIL — still TODO (the visible half)

1. **Wasm boundary** (`crates/sim-wasm`): expose `failed()` and the failing-element mask
   so the front end can read them once per frame (keep the boundary coarse — fold into
   the existing snapshot read in `web/src/sim/loop.ts`).
2. **Renderer** (`web/src/lib/board.ts`): when `failed()` is set, enter the global FAIL
   state and draw a **pulsing red box + `FAIL` label** on each flagged component. Show
   `+FAIL` / `-FAIL` on the offending readout (sign of the clamped value) instead of the
   raw `1e9`.
3. **Loop** (`web/src/sim/loop.ts`): pause/freeze the run on FAIL (stop stepping) so the
   FAIL state holds for inspection; resume on edit/clear.

## Parts catalogue: ideal model today → real parasitics to add

> The "current model" column is confirmed by the parts audit (2026-06-16). The **Ideal**
> variant is each part's current model; the **Real** column is the brainstorm of what to
> layer on.
>
> The audit found only **six parts purely ideal** — `V`, `AC`, `R`, `C`, `L`, `I` (no
> parasitics at all). These are the cleanest Ideal variants and where the
> ideal-source/component-into-a-load FAIL originates; they're the priority to "solidify as
> the ideal variant" with a Real counterpart. Many other parts already carry *incidental*
> realism that mostly exists for conditioning: **transformer** (5 mH leakage + 5 Ω winding
> R), **EC** (0.5 Ω ESR), **POT** (0.5 Ω wiper floor), **op-amp** (~1 Ω output Z via
> `GOUT`), **switch** (0.01 Ω on-R + 1 nS off-leak), **logic gates/FF** (~1 Ω drive +
> 1-tick delay + selectable family), **pull-up** (4.7 kΩ). The device-physics parts
> (diodes, MOSFETs with `LAMBDA`, BJTs via Ebers-Moll, MOV/Zener breakdown) are already
> nonlinear models — their *Ideal* variant is today's model (which still FAILs into a cap,
> having **no series Rs**), and *Real* adds Rs / junction capacitance / the rest.

### Passives

- **R (resistor)** — *ideal:* `G = 1/value`. *Real:* E-series **tolerance** (±5% / ±1%,
  deterministic per-part seed), **temperature coefficient** (drift with dissipated
  power), **power rating** (heats, then FAILs / opens above its watt rating — a great
  teaching FAIL), parasitic **series L** + **parallel C** at HF.
- **C (capacitor)** — *ideal:* `Q = C·V`. *Real:* **ESR** (series, the loss), **ESL**
  (series, self-resonance), **leakage** (parallel R, slow self-discharge), **voltage
  rating** (FAIL / short on over-voltage), tolerance, dielectric type (ceramic vs film).
- **EC (electrolytic)** — *already real-ish:* cap + **0.5 Ω ESR** (netlist expansion).
  *Real adds:* **polarity** (reverse-bias → FAIL, the classic pop), bigger ESR + leakage,
  voltage rating, large tolerance (−20/+80%).
- **L (inductor)** — *ideal:* `V = L·di/dt`. *Real:* **DCR** (winding resistance), **core
  saturation** (L collapses above I_sat → inrush surge), **self-resonance** (parallel
  parasitic C), core loss.

### Diodes

- **D (diode)** — *ideal:* Shockley exponential + `GMIN`. *Real:* **bulk series Rs** (the
  one that bounds the ideal-into-cap FAIL), **junction capacitance** Cj, **reverse
  breakdown** at V_R, reverse-recovery, power/thermal limit.
- **LED** — *ideal:* diode (~1.9 V) + brightness ∝ I. *Real:* + **Rs**, **max forward
  current** (over → FAIL / burns out — visceral lesson), Vf spread by colour.
- **ZD (zener)** — *Real:* + dynamic impedance Z_zt (the knee isn't vertical), Rs, power.
- **SD (schottky)** — *Real:* + Rs, higher reverse leakage (the schottky trade-off).

### Sources

- **V (voltage source)** — *ideal:* perfect EMF, **zero output impedance** (this is what
  makes ideal-source-into-a-load FAIL). *Real:* **output resistance** (Thévenin), a
  **current limit** (compliance), maybe internal-R that droops under load.
- **AC** — *ideal:* perfect sine, zero impedance. *Real:* **source impedance** (mains has
  it — *why* a real bridge inrush is bounded), current limit. (NB: peak-amplitude, with
  the "≈ X V RMS" label; presets are correct.)
- **I (current source)** — *ideal:* perfect current. *Real:* finite **output impedance**
  (parallel R), **compliance-voltage** limit (can't force I past its rail → FAIL).

### Active

- **NM / PM (MOSFET)** — *ideal:* square-law + λ (channel-length mod). *Real:* **gate
  capacitance** (Ciss/Coss/Crss — switching speed), **Rds(on)** floor, **body diode**,
  threshold spread, safe-operating-area / power limit.
- **Q / QP (BJT)** — *ideal:* Ebers-Moll, β≈100. *Real:* **Early effect** (V_A, output
  conductance), junction caps, **β rolloff** with I_c, Vce(sat), SOA / power.
- **OA (op-amp)** — *ideal:* high open-loop gain + limiter. *Real:* finite **GBW / slew
  rate**, **input offset** V_os, **input bias** I_b, output impedance + **output current
  limit**, hard **rail clipping**, CMRR.

### Magnetics & electromechanical

- **TR (transformer)** — *already real-ish:* ideal-T + **leakage** (5 mH) + **winding R**
  (5 Ω). *Real adds:* **core saturation** (magnetising current runs away near B_sat),
  **core loss** (hysteresis + eddy → a shunt loss), interwinding capacitance, leakage that
  scales with turns ratio. The **Ideal TR** drops leakage + winding R → FAILs on bridge
  inrush (honest), which is exactly the bug-turned-lesson from this session.
- **SW (switch)** — *ideal:* PWM conductance. *Real:* on-resistance, off-leakage, finite
  switching, optional contact bounce.
- **MOV (varistor)** — *Real:* energy/joule rating (FAIL after absorbing too much), leakage.

### Three/four-terminal & digital

- **POT (potentiometer)** — *ideal:* two perfect resistors at the wiper. *Real:*
  tolerance, **taper** (log vs linear), wiper contact resistance.
- **Logic gates / FF** — these are *behavioral* (already have one-tick propagation delay
  and logic families). "Real" here means richer timing: finite **drive strength** (output
  R), **input capacitance** (RC of the driven net), real **propagation delay** spread,
  metastability on a flip-flop's setup/hold violation.

## Implementation approach

1. **The `real` flag.** Add `real?: boolean` to the web `Component` (like `family` /
   `openDrain`), and pack it into the element `aux` bits sent across the boundary (or a
   parallel field), so sim-core can select the Ideal vs Real stamp per element. The bin
   shows an Ideal/Real toggle; placing while toggled sets the flag; the inspector flips it
   per-part. Default family is a product decision (probably **Ideal** first — it matches
   the clean textbook intro and the existing golden).
2. **Stamping the parasitics.** Two routes per part:
   - *Element-internal* (preferred for 1–2 parasitics): the Real stamp adds the extra
     terms in the same element, like the transformer's `TRANSFORMER_LLEAK` companion or a
     diode's series `Rs` (an internal node or a limited conductance). No new node count
     across the boundary for series-R/leakage that fold into the branch.
   - *Netlist expansion* (for multi-parasitic parts): expand a Real part into ideal-core +
     parasitic elements on internal nodes, exactly like **EC → cap + ESR** and **POT →
     two resistors** already do in `web/src/lib/netlist.ts`. Clean, reuses tested stamps,
     costs internal nodes.
3. **Determinism / golden.** The **Ideal** models are today's models, unchanged → the
   analog golden and every `*_run_is_reproducible` stay bit-identical. Real models are new
   behaviour (new element variants), so they need their own reproducibility coverage but
   never touch the ideal golden. Per-part tolerance must be a **deterministic** function of
   a per-component seed (never the std hasher — see `docs/determinism.md`), so a given
   board reproduces.
4. **Mixing (allow but warn).** `BoardGraph.connect()` permits an ideal↔real wire but
   tags the net/wire so the renderer can warn (distinct colour). No solver effect; it's a
   UI cue.
5. **FAIL coupling.** Ideal parts reach `FAIL_LIMIT` in pathological configs (already
   handled by the shipped clamp); the per-part FAIL box surfaces it. Real parts stay
   bounded, so they don't trip it — which is the whole point.

## Suggested build order

1. **Finish FAIL visibly** (wasm boundary + red-box renderer + pause) — the foundation is
   in; make it show. Small, high-value, unblocks the whole feature.
2. **Diverge the transformer** (the part that started this): Ideal TR (no leakage/loss,
   FAILs on inrush) vs Real TR (current leakage+winding-R model, retuned for realistic
   mains inrush). Seeds the `real` flag end-to-end on one part.
3. **The bin toggle + per-part inspector toggle + allow-but-warn mixing.**
4. **Roll out Real variants** in fidelity order: diode (Rs) and source (output Z) first
   (they bound the most common FAILs), then R (tolerance/power), C/EC (ESR/rating),
   MOSFET/BJT/op-amp parasitics, inductor saturation.

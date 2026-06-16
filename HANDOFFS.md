# HANDOFFS

The most recent handoff is at the **top**. When you stop work, prepend a new
dated section so the next agent can pick up cleanly. Keep it concise and current.

---

## 2026-06-16 (night) — Visible FAIL UI built (pushed, NOT yet merged)

**State:** 🟢 Green (fmt, build:wasm, web check/lint/build). Branch `claude/kind-turing-hdelb3`,
ahead of `main`; **NOT merged** — owner is mid a manual examples-cleanup pass, so coordinate
before merging, and **keep hands off `web/src/lib/examples.ts`.**

**Built the visible FAIL UI** (the engine clamp shipped in PR #70; this is the front end):
- `crates/sim-wasm`: `failed()` + `failed_element_mask()` passthroughs.
- `web/src/sim/loop.ts`: `Snapshot.failed` + `failedMask`, read each frame; **the run freezes on
  FAIL** (`if (at(cursor)?.failed) running = false`) — the whole-sim FAIL state.
- `web/src/lib/glyphs.ts` + `netlist.ts`: `ElectricalState.failed`; `electricalMap` maps the
  per-element FAIL mask back to each component.
- `web/src/lib/board.ts`: `ComponentNode` draws a **pulsing red `FAIL` box + label** on any
  flagged part (`PALETTE.bad`; the pulse runs on a free wall-clock so it breathes even while the
  run is frozen — the flow phase is frozen when paused).
- `web/src/App.svelte`: passes `snap.failedMask` into `electricalMap`.
- **Deferred polish:** the `+FAIL/−FAIL` numeric-readout swap (the meter still shows the clamped
  number when a failed part is selected) and a global FAIL banner — the box + freeze already read
  clearly. Couldn't verify the visual live (no browser here); it compiles and the engine FAIL is
  unit-tested. Owner to confirm the red box on the deployed build.

**Owner asks logged (TODOS):** component **labels / renaming** (a per-part custom label, like net
labels — "a big one"); owner is also doing a manual pass to label/clean the **examples**.

**NEXT:** coordinate + merge the FAIL UI; then curriculum tiering (ideal-basics vs reality-carried)
+ the first additive Real-variant upgrades. (The entry below has the Ideal-vs-Real resolution +
the multi-rate architecture note.)

---

## 2026-06-16 (night) — Ideal-vs-Real RESOLVED (fidelity gradient) + multi-rate note

**State:** 🟢 Green; clean tree after this. Branch `claude/kind-turing-hdelb3` (ahead of `main`
by docs only since PR #70). A **design-conversation** stretch — two design docs, no engine code.

**Ideal-vs-Real RESOLVED** (`docs/sim/ideal-vs-real-parts.md`): owner's call is **fidelity is the
progression curve**, not a global Ideal/Real toggle. Basics (R/C/L/V/I) are pure ideal and
*self-regularize*; past-basics parts carry their essential parasitics by default (no manual
resistors); advanced play unlocks more reality (tolerance/ESR/ratings/saturation) along the
tech-tree. **Research (CircuitJS source + ngspice manual, primary) confirms the mechanism:**
energy-storage elements get a companion resistance for free from the discretization
(`R_cap = Δt/C`, `R_ind ∝ L/Δt`) so they're never zero-impedance — *we already do this*;
semiconductors get GMIN; ideal sources stay pure and a genuine short / source-loop is left
singular → FAIL (correct). So the **"ideal transformer" worry dissolves** — a transformer is
reality-carried by default and its current leakage-floor model is right for its tier; no
zero-leakage variant needed. FAIL narrows to a rare, correct backstop.

**Multi-rate architecture note** (`docs/sim/multi-rate-domains.md`): how to host a GHz CPU and a
µs analog net deterministically. Key: **multi-rate ≠ adaptive** — fixed integer rate ratios are
structure-not-value, so deterministic; adaptive Δt is not. Two kernels (continuous analog MNA at
fixed Δt + discrete event-driven digital sub-stepping a fixed integer per analog tick), meeting
only at **boundary nets**. Owner's insight, now the centerpiece: the analog↔digital boundary **is
a real converter** (ADC/comparator/Schmitt/DAC) — you must place one to cross, exactly as in
hardware, so it's physically honest and falls out for free. Forward-looking (CPU/FPGA/ADC tier).

**NEXT (unchanged priority):** the **visible FAIL UI** — wasm boundary exposes `failed()` +
`failed_element_mask()`, `board.ts` draws the pulsing red `FAIL` box on flagged parts + shows
`+FAIL/−FAIL` on the readout, `loop.ts` pauses the run on FAIL. Engine half shipped (PR #70).
Then curriculum tiering (ideal-basics vs reality-carried examples) + the first additive
Real-variant upgrades. The catalogue roadmap (7-seg, >4-pin keystone, …) is still queued.

---

## 2026-06-16 (later) — c-terminal + FAIL fixes SHIPPED (PR #70); Ideal-vs-Real design underway

**State:** 🟢 Green (fmt, clippy, **102 sim-core tests**, golden stable, wasm, web). **Merged to
`main` via PR #70**. Branch `claude/kind-turing-hdelb3`.

**Two fixes shipped (PR #70):**
1. **Four-pin c-terminal grounded** (`web/src/lib/netlist.ts`): pin 2 → node `c` was computed
   only for `THREE_PIN_TYPES`, so the transformer's **S+** and the DFF's **CLK** (both pin 2 on
   four-pin devices) silently mapped to **ground**. Transformer → bridge collapsed to **half-wave**
   (the owner's "top-right terminal does nothing / one diode conducts"); DFF → never clocked. Fix:
   `nc` now includes `FOUR_PIN_TYPES`, mirroring `nd`. The sim-core bridge tests passed because they
   hand-wire c/d, bypassing the web netlist — **a real web-side coverage gap (no netlist test exists).**
2. **FAIL state** (`crates/sim-core/src/lib.rs`): `flag_and_clamp_fails()` at the end of `step()`
   clamps any non-finite/`> FAIL_LIMIT` (1e9) value to a finite bound (so a NaN can't propagate and
   delete traces), raises `failed()`, and marks `failed_element_mask()`. Deterministic → **native and
   wasm now agree** (NaN was the platform split behind every "live-only" failure). Golden untouched.

**Ideal-vs-Real direction (owner's framing):** two part families toggled in the bin. Ideal = no
parasitics, reads **+FAIL/−FAIL** (whole-sim FAIL state + pulsing red box on the culprit) when pushed
past physics. Real = realistic parasitics, bounded. Mixing **allowed but warned**. Design doc:
**`docs/sim/ideal-vs-real-parts.md`** (mechanic + FAIL foundation + per-part catalogue/brainstorm +
build order). Parts audit done: only **6 parts purely ideal** — V, AC, R, C, L, I; the rest carry
incidental parasitics (TR leakage+RWIND, EC ESR, op-amp output-Z, switch Ron, gate drive, POT wiper,
pull-up). The TR and EC seed their Real variant.

**OPEN DESIGN QUESTION (owner raised, being researched):** the divergence is a **fixed-Δt transient**
artifact (SPICE dodges it with *adaptive* timestepping, which we can't use — it'd break determinism).
Real parts always have inherent R/L, so requiring users to add resistors is counterintuitive. Two
reconciliations: **(A)** purist ideal = zero parasitics, FAILs (you add impedance); **(B)** ideal
carries a tiny *universal* lead/wire R(+L) so it just works, Real adds full parasitics; FAIL becomes a
rare backstop. Possibly both via an Ideal-mode toggle. **A background research agent is investigating
how ngspice/LTspice, Falstad CircuitJS, Multisim, and EE curricula handle this** — decide A/B/both on
its findings.

**NEXT:** (1) research lands → pick A/B/both for ideal-mode; (2) build the **ideal transformer**
(its leakage floor depends on A vs B — the `tr-bridge-supply` example is already bounded+full-wave
post-#70, so it won't insta-die); (3) the **visible FAIL UI** — wasm boundary exposes `failed()` +
mask, `board.ts` draws the pulsing red FAIL box, `loop.ts` pauses on FAIL; (4) the bin Ideal/Real
toggle + allow-but-warn mixing; (5) roll out Real variants (diode Rs, source output-Z first). Also
worth adding: a **web-side netlist test harness** (the c-terminal bug had zero web coverage).

---

## 2026-06-16 (late) — Transformer inrush fix SHIPPED (PR #69) + transistor curriculum

**State:** 🟢 Green (fmt, clippy, **100 sim-core tests**, golden stable, wasm, web). **Merged
to `main` via PR #69** (Pages deploy rebuilds wasm → live). Branch `claude/kind-turing-hdelb3`.

**The bug (owner-reported, live):** the `tr-bridge-supply` example diverged — **~61 kA on
wasm**, traces vanishing mid-run (NaN propagation) — at high step-up / high frequency.
Native was bounded (~50 A) at the same point: the platform split flagged an **ill-conditioned
inrush solve**, NOT stale cache (owner cleared cache + hard-reloaded; still broke).

**Root cause:** the ideal-T fix made the secondary a **hard, zero-impedance** EMF (rs=0, to
keep full-wave). Charging an empty reservoir cap through the bridge at high step-up is then a
near-impulse — a stiff Newton step that tips to garbage under wasm's float rounding. The
secondary branch row also had **no diagonal** (a bare voltage constraint).

**Fix:** a small **secondary leakage inductance** `TRANSFORMER_LLEAK = 5 mH`, a backward-Euler
companion in series in the secondary branch (sign convention matches the magnetiser's `rp`:
**negative** diagonal `-g_leak`, history term subtracted — I first got the sign +g_leak and it
grew an LC oscillation; flipping it fixed it). Leakage has **zero DC drop**, so unlike series
*resistance* (which sags the EMF → half-wave, the reason rs was removed) it leaves full-wave
rectification untouched — it only limits secondary di/dt (inrush) and conditions the row.
`Is` is now a **second reactive state** (`secondary_state`, parallels `reactive_state`;
reflected in `node_v`, NOT hashed → snapshot-hash format + analog golden UNCHANGED).
n=4/1 kHz inrush **49.8 A → 4.3 A**. New regressions: `transformer_bridge_high_stepup_inrush_bounded`
(1 kHz ratio sweep) + `transformer_bridge_isolated_primary_stays_bounded` (floating primary) —
the corners the old 60 Hz / n≤2 bridge tests missed.

**Also shipped (same PR):** the **"Logic from Transistors" curriculum** (owner picked it off the
roadmap) — CMOS inverter/NAND/NOR from raw MOSFETs + an SR latch (cross-coupled NOR, behavioral
gates) in `examples.ts`. Pure content; MOSFET model already does CMOS rail-to-rail as-is.

**Roadmap status (from the 4 research agents — see chat):** owner confirmed the economy model
(seal = FPGA; everyday ICs unlocked via Lux-gated tech tree after a build-from-primitives
contract; IC costs Lux once / cheaper Credits-per-placement than discrete — the integration
lesson). NEXT off the roadmap: the **>4-terminal `Element` keystone** (an optional per-element
extra-nodes side-table — unlocks wide counters/muxes/decoders + the **BCD→7-seg decoder**), the
**7-seg display** (S7 = 7-LED netlist expansion + per-segment GlyphOpts), the small ≤4-pin (B)
digital parts (D-latch, Schmitt, tri-state, 2-bit counter), and on the analog side the
**reusable magnetic core** (generalize the ideal-T to N windings) + relay (P6 latch pioneer).

**NEXT:** confirm the Pages deploy went green and owner sees sane bridge currents after a
refresh. Then resume the roadmap (owner picks the next item).

---

## 2026-06-16 (night) — Stage 4 COMPLETE: open-drain + level-shifter + pull-up

**State:** 🟢 Green (fmt, clippy, **98 sim-core tests**, wasm, web). Branch
`claude/kind-turing-hdelb3`, a few commits ahead of `main` (PR #67's big batch is already
live). Stage 4's digital-interface ground rules are **all in**, with **tier-1 schematic
symbols** (owner will do a tier 2/3 art pass later — that was the explicit ask).

**The set:**
- **Open-drain output mode** (per-gate toggle, aux bit 8) → wired-AND bus with a pull-up.
- **Level shifter** (`ELEM_LEVELSHIFT=20`, digital, 2-pin OUT/IN): reads input at rail A
  (`value`), re-drives at rail B (`aux`) — the conversion lives in its pins (Ideal
  receiver/driver). Web: `value` = input rail (chips), `amp` = output rail (a dedicated
  picker); glyph = the buffer triangle (placeholder). Test `level_shifter_translates_rails`.
- **Pull-up** (`ELEM_PULLUP=21`, analog, 1-pin): resistor to internal Vcc (`value`) through
  `PULLUP_R=4.7k`, stamped as a constant Thévenin in the 4 assembly sites. Glyph = a
  resistor up to a Vcc bar. Test `pullup_takes_net_to_vcc_unless_pulled`.

**Architecture note (confirmed with owner):** the analog↔digital boundary lives in the
gate/FF/shifter **pins** (receiver = quantize voltage→Level on inputs; driver = stamp
Level→voltage on outputs). The pull-up is a **plain analog resistor**, NOT a boundary
marker — it just sets a net's voltage so an all-released open-drain bus reads high.

**aux bit layout (digital elements):** func bits 0–3 · family bits 4–7 · open-drain bit 8
(masked by `aux_bits`/`gate_func_code`/`gate_family_index`/`gate_open_drain`). The level
shifter (a non-gate) instead uses `aux` = output rail B (like AC uses aux for amplitude).

**NEXT:** owner is drafting **new symbols** — when they land, do the **tier-2 (factory) +
tier-3 (real) glyph pass** for LS/PU (currently LS aliases the buffer, PU is a custom
schematic; factory falls back to schematic). Also still open: lifting pure-digital nets
out of MNA (hash-neutral perf), the FBR curriculum example, the digital Tier-A ladder
(counters/shift registers/decoders — now all golden-**additive** on this foundation).
Ship Stage 4 whenever the owner wants (a few commits ahead of `main`; merge via PR like #67).

---

## 2026-06-16 (night) — Big batch SHIPPED (PR #67) + Stage 4 open-drain ground rule

**State:** 🟢 Green (fmt, clippy, **96 sim-core tests**, wasm, web). **The whole prior
batch is LIVE** — audit cleared it (ship-ready), and it merged to `main` via **PR #67**
(`main` couldn't take a direct push — branch-protected — so the "merge to main now" ask
went through a PR + immediate merge). That shipped: transformer ideal-T bridge fix,
digital scheduler Stages 1–2, XNOR/BUF, logic families + picker. Owner reviews on live.

**Stage 4 — open-drain / wired-AND ground rule (DONE, on branch, 1 commit ahead of main):**
The owner asked to "get the ground rules going before we add more stuff," so this lands the
open-drain mechanic (the foundation for buses / I²C / interrupt lines) as a per-gate
*output-mode toggle* — **no new part or symbol** (the owner is drafting symbols separately).
- **sim-core:** `aux` now packs three masked fields — func (bits 0–3), family (4–7),
  **open-drain (bit 8)** — via `aux_bits`/`gate_func_code`/`gate_family_index`/
  `gate_open_drain` (the family decode now masks, fixing a latent leak). `eval_digital`
  maps an open-drain High → `Z` (release); `stamp_digital` leaves the net to an external
  pull-up. New per-gate `gate_gout` makes the displayed gate current family/mode-aware
  (a released output reads ~0 A; also tidies the audit's gate-current note). Default
  push-pull → goldens unchanged. Test `gate_open_drain_wired_and_bus` (bus = A AND B).
- **web:** `Component.openDrain` → `aux` bit 8 in `buildNetlist`; `board.setComponentOpenDrain`
  + emitSelect/clipboard/serialize threading; inspector "output" toggle (Push-pull /
  Open-drain) for gates + a "add a pull-up" hint.

**NEXT (Stage 4 remainder, deferred per "ground rules first"):** a **level-shifter** part
(reads a logic level at rail A, re-drives at rail B — needs a two-rail design, e.g. a
4-pin VccA/IN/VccB/OUT element or a 2-pin part whose `value` is the output rail); maybe a
convenience **pull-up** part. Hold on these until the owner's new symbols land. Also still
open: lifting pure-digital nets out of MNA (hash-neutral perf), the FBR curriculum example.

---

## 2026-06-16 (eve) — Stage 3 DONE; whole batch ready to ship (review audit pending)

**State:** 🟢 Green (fmt, clippy, **95 sim-core tests**, wasm, web check/lint/build).
Branch `claude/kind-turing-hdelb3` is **~18 commits ahead of `main`** and **not merged**
— so NONE of this is live yet (GitHub Pages deploys from `main`). The owner wants to
**ship the whole batch together after a review audit**.

**The full unshipped batch (oldest→newest):** transformer ideal-T bridge fix + audit
follow-ups → digital scheduler Stages 1–2 (net classification, event engine,
level-bearing hash, 4-state DFF) → XNOR/BUF gates → logic-families foundation →
logic-family picker UI.

**Stage 3 (this batch) — logic families, DONE:**
- **XNOR + BUF** surfaced on the board (closed the GATE_AUX gap): graph.ts PART_KINDS,
  netlist.ts type-17 map + codes 5/7, glyphs ×2 (XNOR = XOR + bubble; BUF = NOT triangle,
  no bubble), palette/category, partInfo, pinout, value chips.
- **sim-core families:** `const FAMILIES` (0 Ideal / 1 CMOS / 2 TTL), per-element family
  packed in `aux`'s upper bits (`func + 16*family`, decoded by `gate_family_index`/
  `gate_func_code`) — **no wasm-boundary change**. Wired through `eval_digital`/
  `stamp_digital`/`commit_net_levels`/DFF latch via a per-net `digital_family`. Default
  Ideal → goldens unchanged. Test `gate_family_levels_and_mixed_rail` (CMOS V_OH≈0.95·rail;
  1.8 V high LOST into a 12 V part).
- **Family UI:** `web/src/lib/families.ts` mirrors the Rust fractions; `Component.family`;
  `buildNetlist` packs aux; `board.setComponentFamily` + clipboard/serialize threading;
  App.svelte family chip picker (Ideal/CMOS/TTL) + live V_IL/V_IH/V_OL/V_OH + noise-margin
  readout for digital parts.

**NEXT:** the owner asked for a **review audit that everything works** before shipping —
then merge `claude/kind-turing-hdelb3` → `main` (one batch) to deploy. Do NOT merge
without the owner's explicit go-ahead.

**Stage 4 (follow-up, not started):** open-drain driver mode (release high → Z) + a
wired-AND bus (open-drain + pull-up, resolved by the MNA solve) + a level-shifter part —
all golden-additive. Lifting pure-digital nets out of MNA stays a hash-neutral perf option.

---

## 2026-06-16 (eve) — Digital scheduler Stage 2 SHIPPED (event engine + level hash)

**State:** 🟢 Green (fmt, clippy, **94 sim-core tests** + 1 ignored, wasm, web). Pushed
to `claude/kind-turing-hdelb3`. **Stages 1–2 (the full scheduler) are done.**

**What landed (sim-core, the Option A2 design in `logic-analog-digital-nets.md §7`):**
- **`Level` {Low,High,Z,X}** (`#[repr(u8)]`, no float compares in the digital domain);
  **`combine`** resolution table (Z yields; disagreeing strong → X); 4-state
  **`gate_logic_level`** (reduces to the old boolean table on Low/High).
- **`LogicFamily`** gained **`v_il_frac`** + **`quantize`** (receiver, forbidden band → X)
  + **`drive_level`** (driver: Thévenin for High/Low, mid-rail for X, None=release for Z).
  LEGACY is byte-identical to the old half-rail/`GATE_GOUT` behaviour.
- **Net-centric engine:** `eval_digital` reads each gate's inputs as Levels from the
  committed previous-tick voltages (per-reader rail = one tick of delay), resolves every
  net's drive via `combine` in element order, and `stamp_digital` drives each
  Digital/Boundary net **once** — replacing the 4 per-gate stamp sites + 4 `stamp_dff`
  calls. Two outputs on a net now **resolve** instead of fighting. Still linear fast path.
- **4-state DFF:** `ff_q` + `ff_clk_prev` (Level), latched via `quantize`; **both now in
  the hash**. `snapshot_hash` folds node_v for analog/boundary, the discrete Level (u8)
  for each pure-digital net, and the DFF state. **RC golden `0xeaac` untouched.**
- Removed superseded `gate_logic`/`gate_target_level`/`reads_high`/`drive`/`stamp_dff`.
- **New tests:** ring oscillator oscillates; multi-driver resolves (agree→level,
  conflict→mid-rail X); per-tick **lockstep replay** of a clocked DFF. All prior
  gate/DFF behaviour + reproducibility tests stayed green.
- **Note:** the predicted "deliberate golden break" needed **no golden regeneration** —
  digital tests are behaviour + self-consistency, and the only fixed golden (RC) has no
  digital parts. The GMIN-bookkeeping change shifted digital node_v at 1e-12 but no test
  pins a digital node to a fixed value.

**Still pure-MNA-resident:** pure-digital nets still occupy MNA rows (driven + solved +
quantised). Lifting them OUT of the matrix is a **hash-neutral** future optimisation
(the hash already folds their discrete Level, not node_v) — do it only if perf needs it.

**NEXT — Stages 3–4 (follow-ups, golden-additive / presentation):**
- **Stage 3 (web):** thread a per-gate family index through `set_netlist`
  (sim-wasm → loop.ts → netlist.ts) + a family chip in the inspector; noise-margin /
  forbidden-band readouts (read the snapshot, presentation-only); surface XNOR(5)/BUF(7)
  as board parts (the `GATE_AUX` gap in `web/src/lib/netlist.ts`). Real families
  (TTL/CMOS/LVCMOS) become selectable here — the `quantize`/`drive_level`/X machinery is
  already in place; just add the `FAMILIES` table + per-element index.
- **Stage 4 (sim-core, additive):** open-drain driver mode (release high → Z) + wired-AND
  bus (open-drain + pull-up resistor, resolved by the MNA solve); a level-shifter part.
- **Renderer:** `Sim::net_class(n)` (0/1/2) is already exposed for drawing digital nets /
  boundary buffers distinctly.

---

## 2026-06-16 (pm) — Digital scheduler: research synthesized + Stage 1 shipped

**State:** 🟢 Green (all gates: fmt, clippy, 92 sim-core tests + 1 ignored, wasm, web).
Pushed to `claude/kind-turing-hdelb3` (3 commits this batch). The owner asked to build
the digital scheduler; chose scope **Stages 1–2 (full scheduler)**.

**Done:**
- **Research (6 agents) → `docs/ui/logic-analog-digital-nets.md` §7** — the
  research-validated design + build plan. Read §7 first; it is the authoritative spec.
  Headline: the fixed 2 µs step collapses all the variable-timestep mixed-mode machinery
  to a strict per-tick lock-step; unit-delay two-pass evaluate→commit is provably
  order-independent; digitaljs is the working precedent; Falstad (gates in the MNA matrix
  + RNG) is the anti-pattern we're leaving.
- **Stage 1 — net classification (golden-stable), shipped.** `classify_nets` in `install`
  labels each node Analog/Digital/Boundary deterministically; `is_digital(kind)`;
  `NetClass` enum; `Sim::net_class(n)->u8` accessor; `net_classes` field. Computed but
  **not yet acted on** (pure-digital nets still stamp into MNA), so every golden is
  bit-identical (0xeaac RC, gate/DFF reproducibility all unchanged). Test
  `net_classification_separates_domains`.

**NEXT — Stage 2: the event engine + level-bearing hash (the one deliberate break).**
This is the determinism-sacred core; do it deliberately, not rushed. Full spec in §7
(esp. §7.3 phase order, §7.5 models, §7.6 corrections, §7.7 test bar). Concrete plan:

- **Model:** `#[repr(u8)] enum Level{Low,High,Z,X}`; `LogicFamily.quantize(v,vhigh)->Level`
  (needs a new **`v_il_frac`** field; LEGACY sets `v_il_frac=v_ih_frac=0.5` → no X band →
  identical); a `combine(Level,Level)->Level` resolution table (Z yields; disagreeing
  strong → X — table in §7.6). DFF state becomes 4-state `Level` (`ff_q` + `ff_clk_prev`),
  replacing the f64 `ff_bit`/`ff_clk_high`.
- **Engine (per tick, in `step`):** evaluate-all double-buffer in **element-index order**:
  (1) each gate's output Level from committed input net-levels (4-state `gate_logic`);
  (2) each DFF Q/Q̄ from `ff_q`, with edge-detect on the committed CLK net-level;
  (3) **resolve per net** by folding all drivers via `combine` → `digital_drive[node]`;
  (4) the four MNA stamp sites stamp **each digital/boundary net once** from its resolved
  level (LEGACY Thévenin = today's `GATE_GOUT`), replacing the per-gate/DFF stamps;
  (5) after the solve, commit each digital/boundary net-level = `quantize(node_v)`.
- **⚠ GMIN gotcha (the trap):** today each gate stamps `GMIN` on *each* input it reads, so
  a net read by K gates gets K·GMIN on its diagonal. A net-centric restructure that floors
  each net once gives 1·GMIN → `node_v` differs at the 1e-12 level → **every digital hash
  changes**. So the restructure *is* the deliberate break (regenerate digital trajectories;
  there is **no fixed digital golden** — gate/DFF tests are self-consistency `run==run` +
  behavior, and the only fixed golden is RC/0xeaac which has no digital parts and stays).
  Either replicate K·GMIN exactly (ugly) or accept the regen (cleaner) — accept it.
- **Hash (`snapshot_hash`, lib.rs:3548):** fold `node_v` for Analog+Boundary nodes (as
  today) **plus** one `u8` Level per **pure-Digital** net **plus** each DFF's `ff_q` and
  `ff_clk_prev` (u8). Forward-stable, append-only; RC golden untouched.
- **Exact touchpoint map (verified @ commit 51c54dc — re-grep before editing, they drift):**
  - *Substrate:* `struct LogicFamily` 444, `const LEGACY` 462 (add `v_il_frac` here =
    `v_ih_frac`), `reads_high` 474 + `drive` 482 (add `quantize`/`combine` near these),
    `gate_target_level` 809, `ff_bit`/`ff_clk_high` fields 1394/1398 + inits 1488/1489
    (→ become 4-state `ff_q`/`ff_clk_prev`). Already present to leverage: `NetClass` 852,
    `classify_nets` 865, `Sim::net_class` accessor, `is_digital`.
  - *The 4 MNA solve sites* (each has a gate STAMP arm + gate READOUT arm + a `stamp_dff`
    call + a DFF READOUT arm): linear-OP, linear-transient, Newton-OP, Newton-transient.
    Gate stamp arms at **1894 / 2074 / 2901 / 3128**; `stamp_dff` def **3365** (called at
    all 4); commit/latch DFF arm **3452**; `snapshot_hash` **3548**. So it's ~16 match arms
    + stamp_dff + commit + hash — sizeable; a shared `stamp_digital(mat,rhs,dim)` helper +
    a precomputed `digital_drive: Vec<Level>` (resolved per node once per tick) keeps the
    4 sites to one call each.
  - *Baseline is green @ 51c54dc:* 91 sim-core tests, clippy, fmt, wasm, web all pass — so
    any red during Stage 2 is attributable to the restructure.
- **Tests (§7.7):** ring-oscillator oscillates (no hang/deadlock); gate-only stays on the
  **linear fast path** (no Newton); 4-state resolution table; multi-driver wired-AND
  (open-drain+pull-up); per-family `*_run_is_reproducible`; and **rewind-across-a-clock-edge
  → identical hash** (store `ff_q`+`ff_clk_prev` in the keyframe — the most likely replay
  bug). Existing gate/DFF behavior + self-consistency tests must stay green.
- **Sequencing tip:** because of the GMIN gotcha there is no clean golden-stable sub-split;
  do the restructure + hash as one focused commit, leaning on the existing behavior/
  self-consistency tests + the new test bar to prove correctness and determinism.

Stages 3–4 (web threading; open-drain/level-shifter parts) remain follow-ups.

---

## 2026-06-16 — Transformer→bridge FIXED (ideal-T, hard secondary)

**State:** 🟢 Green (all gates: fmt, clippy, 90 sim-core tests + 1 ignored, wasm build,
web check/lint/build). Pushed to `claude/kind-turing-hdelb3` (2 commits). **Audit agent
done** (owner asked for one) — verdict: fix correct, no defects; its findings are folded
in (see "Audit follow-ups" below).

**What changed (`crates/sim-core/src/lib.rs`):** rewrote the transformer from a
coupled-inductor pair to an **ideal-T model**. Two branches: magnetising `Im` (a→b, the
only reactive state) + secondary `Is` (c→d, algebraic). Magnetiser row is a backward-
Euler inductor companion with primary winding R `rp`; the **secondary is a HARD
differential** `V(c)−V(d) = n·V_Lm` where `V_Lm = g_mag·(Im−Im_prev)` is the magnetiser
voltage (NOT the terminal voltage — coupling to `V_Lm` is what blocks DC). Primary KCL
draws `Im + n·Is`; current readout = `Im + n·Is`.

**Two hard-won refinements** (full writeup: `docs/sim/transformer-bridge-convergence.md`
§7; the §6 verification already killed the §1–§4 "secondary→ground resistor" idea):
1. **Secondary has zero series resistance.** A `rs·Is` term softens the differential →
   under a bridge charging a cap it latches the wrong diode pair and runs away (positive
   feedback, `Is` climbed past 25 A in the trace). `rs = 0` makes the wrong state
   algebraically impossible. `rp` (primary) still gives loss + DC-block.
2. **No common-mode reference resistor.** Proved via a floating-AC-source baseline that
   the bridge rectifies full-wave on the GMIN-only floor; an interim 1 MΩ tie was added
   then **removed** (preserves galvanic isolation, diode currents become exactly
   symmetric). §4 of the research note was a red herring for a *hard* source.

Removed now-dead `TRANSFORMER_K` + `transformer_inductances`. Updated all transformer
doc-comments. `transformer_scales_ac_by_turns_ratio` now expects ratio = **n** (no k).
New regression **`transformer_bridge_rectifies_full_wave`**: 12 V-pk / n=1 / bridge /
100 µF / 1 kΩ → Vout 9.96–10.85 V, ripple ~0.9 V, **all 4 diodes** (0.12/0.155 A),
Iprim ~0.19 A, no spike/runaway. **Main analog-RC golden `run_is_reproducible`
untouched** (no transformer in it); `transformer_run_is_reproducible` still self-checks.

**Audit follow-ups (all done):** the audit confirmed the stamp math sign-by-sign, the
hard-differential reasoning, and zero determinism risk. Folded in: (1) new
`transformer_bridge_full_wave_scales_with_ratio` test (step-up n=2 + step-down n=0.5 —
exercises the `n·g_mag` / `n·Is` terms; refactored both bridge tests onto a
`bridge_rectifier_run(n, amp)` helper); (2) removed the now-dead `reactive_state_b`
field (secondary is algebraic — it was written every step but never meaningfully read)
and simplified `stamp_transformer_op`; (3) fixed stale "coupled-inductor / mutual-M"
comments and the doc §6 `n·V_p`→`n·V_Lm` prose mismatch.

**Next:** the owner's next ask is the **digital scheduler** ("we can do the scheduler
after"). Optional leftovers: the FBR curriculum example + reusable magnetic core (TODOS),
and a possible secondary copper-loss model via an internal node (deferred — would restore
winding R without softening the forced differential).

---

## 2026-06-15 (eve) — Merged to live (#63), 3-tier info panel, onboarding MVP

**State:** 🟢 Green (all gates). **PR #63 merged to `main` → deployed to live** for
owner review. Branch `claude/kind-turing-hdelb3` continues past the merge.

**Shipped this batch:**
- **3-tier component view** (owner's model) in the info panel: `Symbol · Factory ·
  Real` selector (`glyphs.ts drawGlyphIn`, `InfoDiagram` modes schematic/analogy/
  reality, outward fallback), defaults to Real; pinout + equation + "Right now" stay.
  The carriers-vs-energy **power primer moved out** to a "Reading the board" legend in
  the telemetry panel. Decision + reality-art framework in `component-info-panel.md`.
  (Reality art is owner-provided per component later — each is one `DETAIL_DRAWERS` entry.)
- **Onboarding MVP (pull-based, no levels)** — `concepts.ts` + App wiring: four
  first-encounter cards (source/ground/loop/reading) offered the moment the board can
  show each true, deduped via a queue + persisted `seenConcepts`; single
  `explainAsYouGo` mute; an always-on **"?" Help handle** (mute / replay tips / re-show
  intro). Settings load+persist via `storage.ts`. Cards hold off until the intro is
  dismissed. See `onboarding-first-run.md` §10.
- **Double-click info pipeline** checked: smooth (open via double-click/`I`/ⓘ, then it
  re-targets on every single-click); double-click now always re-asserts the Real view.

### Scoped wiring/placement fixes — INTEGRATED + on live (#64)
The worktree agent's **3 fixes** landed (cherry-picked clean, gates pass, merged to
live in #64): drop-on-track splits + de-shorts; segment-precise wire delete (adds
`Junction.free` + `graph.deleteWireSegment`); **KiCad click-to-continue wiring**
(press-while-routing completes-then-continues; classic drag-to-wire + junction
double-click-drag preserved). Note the new **click-based wiring is "sticky"** mid-route
(finish on a pin or Esc) — KiCad-faithful, as the owner asked; watch for feedback.

### Still open
- **Digital scheduler** (Phase 1+, the dedicated session; `logic-…-nets.md` §6).
- **Onboarding heavier pieces** (deferred): cold-open auto-play, the guided first-build
  wiring affordances (pin-glow, next-edge ghost), bin-narrowing/pre-arm (§1–§3, §6).

---

## 2026-06-15 (pm) — QoL batch (partial) + scope time window

**State:** 🟢 Green (full CI suite passed). Branch pushed. Shipped from the owner's
QoL batch:
- **Pan yields to Build on a grab** — clicking a part/wire in Pan switches to
  Build/Select and grabs it (move/reshape); empty still pans. New `onMode` callback.
- **R rotates the ghost** whenever a part is armed (was rotating a leftover selection).
- **Scope selectable time window** — decimated spans 0.48 ms/4.8 ms/48 ms/0.48 s (base
  = old behaviour), ⏱ button cycles, duration labelled. Fits a full low-f AC cycle.
- **Open-loop current-source fix re-verified** (harness: open 0 mA/0 V, closed 10 mA).

**Deferred (interaction-model changes — analysis in TODOS "QoL / fixes batch"):**
drop-on-track segment split (#4), delete-only-segment-to-junction (#5), KiCad
click-to-continue wiring (#6 — needs `onPointerDown` reworked to complete-while-wiring).
Plus the still-pending **onboarding** (pull-based; `docs/ui/onboarding-first-run.md`)
and the **digital scheduler** (Phase 1+, the dedicated session; `logic-…-nets.md` §6).

---

## 2026-06-15 (later) — Logic-family decision + Phase 0, marquee/copy-paste, factory internals

**State:** 🟢 Green. sim-core 88 tests pass, golden `0xeaac…fa24` **unchanged**; all
web gates pass. Branch `claude/kind-turing-hdelb3` (pushed).

**Shipped this batch:**
- **Marquee select + copy/paste/cut** (`board.ts`/`App.svelte`): Select-mode empty
  drag rubber-bands a box (shift = additive); `Ctrl/Cmd-C/V/X` copy/paste/cut an
  in-memory fragment (components + internal wires + net labels), paste with fresh ids
  at a growing offset. Group drag already worked.
- **Logic-gate analog/digital architecture — DECIDED + Phase 0.** Owner chose the
  **full separated digital domain** (families + driver/receiver boundary + a
  deterministic event scheduler + level-bearing hash) **now**, with a **legacy-ideal
  default** (existing circuits identical; only gate/DFF goldens regenerate when the
  scheduler lands; future digital parts are golden-additive). Decision + concrete
  build order recorded in **`docs/ui/logic-analog-digital-nets.md` §6**.
  - **Phase 0 landed (golden-stable):** `LogicFamily { v_ih_frac, v_ol/v_oh_frac,
    g_ol, g_oh }` + `LEGACY` const reproducing the original gate exactly;
    `gate_target_level` routes through `LEGACY.reads_high`/`.drive`. Byte-identical,
    golden unchanged, `legacy_family_matches_original_gate` guards it.
- **Live construction-detail ("factory internals") views** integrated from a worktree
  agent: `web/src/lib/detailDrawers.ts` (new) — animated op-amp/diode/LED/Schottky/
  Zener/resistor internals driven by live `ElectricalState`; `InfoDiagram` detail mode
  + `DETAIL ?? schematic` fallback; a **Symbol⇄Inside** toggle (defaults to Inside).
  Composed with info-panel Phase 1: drawer = toggle → diagram → pinout → equation.
- **Earlier this session (already pushed):** pan-regression + label-ghost fixes,
  open-loop current-source zeroing, POT non-bug (answered), phase-shift example,
  info-panel Phase 1 (double-click/`I`/ⓘ + pinout).

### Pick up here — the digital domain (the big, risky part; do it fresh)
The determinism-critical work remains: **Phase 1** receiver/driver split + in-core net
classification (analog / pure-digital / boundary), **Phase 2** the **deterministic
event scheduler** (integer-tick buckets, enum `Level{Low,High,Z,X}`, element-index
order, one-tick-delay feedback) + fold digital net levels into `fnv1a` → **regenerate
gate/DFF goldens** (the one deliberate break), **Phase 3** boundary threading to web
(family chip, noise-margin readout) + surface XNOR(5)/BUF(7) (the `GATE_AUX` gap),
**Phase 4** open-drain/Z/wired-AND + level-shifter. The acceptance bar + exact design
are in `logic-analog-digital-nets.md` §6. Do this with full budget — never land a
half-built scheduler. Also still queued: **onboarding** (pull-based, no levels;
`docs/ui/onboarding-first-run.md`), more parts/ICs.

---

## 2026-06-15 — Editor fixes, open-loop source, phase-shift example, info-panel Phase 1

**State:** 🟢 Green. All web gates pass (`check`/`lint`/`build`); sim-core untouched
this batch, golden `0xeaac376499e4fa24` unchanged. Branch `claude/kind-turing-hdelb3`.

**Shipped (pushed to the feature branch):**
- **Pan regression fix.** The pan tool (Esc default) no longer blanket-grabs
  pointerdown: a pin/junction press starts a wire, a wire press reshapes, an armed
  click places, and only a body / empty drag pans. `arm()` leaves pan for select.
  (board.ts onPointerDown pin/junction now accept `"pan"`; body-press in pan falls
  through to pan unless additive.)
- **Label ghost fix.** onPointerMove now refreshes the ghost in `label` mode too
  (was only `armed`/`junction`), so the name-pill preview tracks the cursor + snaps.
- **Open-loop current source.** `buildNetlist` now zeroes the forced current of any
  `floatingSources` (a current source whose loop isn't closed) so the dead branch
  reads an honest **0 mA / 0 V** instead of the singular-matrix phantom (10 kV/10 mA).
  Closing the loop restores the real value. Verified via the wasm solver.
- **POT B-terminal — NOT a bug (answered).** Reproduced through the real solver:
  a properly-wired W→B leg conducts (B→R10k→GND reads 0.31 mA); the user's `~0`
  reading reproduces *exactly* the **B-floating** case (rheostat mode = legitimate).
  No code change; it was a wiring near-miss. (POT expansion in netlist.ts is correct.)
- **Phase-shift example** (`phase-shift`, **Filters**). The user's 3-stage RC ladder
  (4.7 kΩ / 0.1 µF) mislabeled 60/120/180 at 1 kHz; corrected to **138 Hz**
  (= 1/(2πRC√6)) with honest 56°/112°/180° tap labels + the 1/29 attenuation lesson,
  and a detune-to-1 kHz demo. Verified end-to-end (transient sim: −180.0°, 1/29.1).
- **Component info panel — Phase 1** (per `docs/ui/component-info-panel.md`):
  - **Double-click a part** opens its info drawer (new `onInspect` board callback;
    works from Select + Pan; first click selects/toggles, second opens info and is
    swallowed — MSW carve-out handled). **`I`** hotkey toggles it; **ⓘ chip** on the
    value popover is the third door. **Esc closes the drawer first** (then disarm/clear).
  - **Pinout** (`web/src/lib/pinout.ts`): lays out `PART_KINDS.pins` rotated to the
    placed part (SelectedPart gains `rot`) → SVG body + legs + dots with DOM labels
    and per-leg glosses (anode/cathode, D/G/S, electrolytic polarity, transformer
    P/S, …). Pure reference; no live state, no sim, no golden.

**Reusable harness (not committed):** a Node script under `web/src/lib/_repro.ts`
(deleted after each use) imports `graph.ts`/`netlist.ts`/`examples.ts` + the built
wasm and runs real sims — drive it with `node --loader /tmp/tsresolve.mjs …` (a tiny
extensionless-`.ts` resolver). Invaluable for verifying circuits/netlists end-to-end.
Used to settle the POT, the open-loop source, and the phase-shift example.

### Pick up here (the remaining queue)
- **Info panel Phase 2** — `DETAIL_DRAWERS` construction cutaways (cap spiral / MLCC
  stack / LED lamp first) + static ratings block. Big; see the doc §3–4.
- **Onboarding** (pull-based, no levels) per `docs/ui/onboarding-first-run.md`.
- **Copy/paste + marquee select + group drag** (TODOS top entry).
- Remaining parts/ICs (relay, programmable load, ferrite, fuse/thermistor/LDR/…,
  counter/555/regulator/comparator/DAC/ADC/H-bridge/memory/MCU/FPGA).

---

## 2026-06-15 — Op-amp shipped end-to-end + scope autoscale (#47–#50)

**State:** 🟢 Green. Golden `0xeaac376499e4fa24` unchanged; 72 sim-core tests. The
op-amp is now a fully playable part, and the scope no longer clips big swings.

**Shipped (all on `main`):**
- **Op-amp sim-core** (#47): `ELEM_OPAMP=15` — smooth-clamped transconductance
  VCCS, `Vtarget = Vsat·tanh(GAIN·Vd/Vsat)` driven through finite `OPAMP_GOUT`;
  3-terminal a=OUT/b=IN−/c=IN+; per-iteration `Vd` step limiter for feedback
  robustness. 6 tests (follower, non-inv, inv, comparator, validate, reproduce).
  (Fixed a companion-stamp sign bug that railed the comparator backwards.)
- **Manual switch** (#48): `MSW` web part, reuses `ELEM_SWITCH=6` at value 0/1 +
  click-toggle. Open/Closed chips, LED example.
- **Op-amp web** (#49): `OA` placeable part (triangle glyph + factory comparator
  station), `value` = Vsat, added to `THREE_PIN_TYPES` (pin 2 = IN+ → `c`),
  curated Vsat rails, partInfo (virtual short / comparator prose), and a new
  **"Op-Amps"** example category: voltage follower, non-inverting amp (×3),
  open-loop comparator (high/low demo).
- **Scope autoscale** (#50): Y now fits the visible traces' true min/max across
  the window with ~8% headroom (was seeded [0,1] with no margin → big AC/PWM
  swings clipped on the frame). Keeps the 0 baseline in view; web-only, golden safe.

### In flight / pick up here (preliminary ICs)
**Logic-gate sim-core has LANDED** (`ELEM_GATE=17`): a Tier-A behavioural digital
primitive (a=OUT, b=IN1, c=IN2; `value`=logic-high rail, `aux`=function code:
0 AND/1 OR/2 NAND/3 NOR/4 XOR/5 XNOR/6 NOT/7 BUF). It thresholds inputs at half
the rail read from the **committed previous-tick `node_v`**, drives OUT toward
0/Vhigh through `GATE_GOUT` — a constant Thévenin stamp (the switch's linear,
tick-determined shape) added to all 4 assembly sites + 4 readouts. One tick of
propagation delay, no persistent state, golden `0xeaac376499e4fa24` unchanged,
6 new tests (78 total). Also fixed a latent op-amp per-tick current readout
omission (readout-only, not hashed) while in those match blocks.

**Gate WEB wiring has LANDED too** — placeable AND/OR/NAND/NOR/XOR/NOT parts (each
→ `ELEM_GATE` with its `aux` code via `GATE_AUX`; `value`=rail; 17 added to
`THREE_PIN_TYPES`), distinct boolean-symbol schematic glyphs + a Factorio
decider/sorter, partInfo (truth table + half-rail threshold + one-tick delay), and
a new **"Logic & ICs"** example set: inverter→LED, AND interlock, and an XOR+AND
**half-adder** (1+1=10). Replaced the non-simulated `"&"` placeholder.

**Transformer has LANDED (full feature, in this PR).** The **4th terminal `d`**
boundary bump is done end-to-end (Element + `set_netlist` + sim-wasm + `loop.ts` +
`netlist.ts` `FOUR_PIN_TYPES` + App.svelte — golden-safe, also unlocks the relay).
`ELEM_TRANSFORMER=18` is **two magnetically coupled inductors** (primary a/b,
secondary c/d; `value` = turns ratio n): two coupled branch currents + two reactive
states (`reactive_state_b`), backward-Euler companion cross-linked by M=k·√(L₁L₂),
per-winding resistance so it **blocks DC** (primary current saturates) and **scales
AC by ~k·n**. Stamped in all 4 assembly paths (transient = coupled branches, OP =
current sources). 4 new tests (AC scaling, DC blocking, validation, reproduce) — 83
total, golden `0xeaac376499e4fa24` unchanged. Web: `TR` part (4-pin, two-coil + core
glyph + factory converter), turns-ratio value shown as **Np:Ns** (`fmtVal`), partInfo,
and a **"Transformers"** example — a **full-bridge rectifier with a tunable turns
ratio** (the owner's centerpiece request). Also restored the op-amp per-tick current
readout.

**Owner ideas captured in TODOS (not yet built):** reusable **ferrite/magnetic-core**
element (one core abstraction → transformer / common-mode choke / ferrite bead /
cored inductor) + build-transformer-from-two-coils example; **potentiometer** (3-term
wiper divider) and a **programmable/electronic load** (CC/CP sink) for building &
load-testing **VRMs**.

**Next: the next IC rungs** — D flip-flop (clocked 1-bit state; tick-grid edge detect
— first sequential element) → counter/shift (bus ports) → 555 → linear regulator.
Then the deferred discretes (fuse, thermistor, LDR, 7-seg) and the **relay** (reuses
the now-built 4th terminal `d`). The modular ferrite-core, pot, and programmable load
are strong near-term adds (see TODOS).

---

## 2026-06-15 — Parts blitz: transistors, varistor, net labels, AC amplitude (#37–#46)

**State:** 🟢 Green. Golden `0xeaac376499e4fa24` unchanged throughout (verified via
`print_golden` on every sim-core change); 66 sim-core tests. A sustained autonomous
push toward "the whole parts selection + ICs + examples". Sim primitives land one
at a time on `lib.rs` (each golden-verified by me, then shipped), web wiring and
examples follow; the PR list on `main` is the running record.

**Shipped since the MOSFET batch (all on `main`):**
- **Multi-terminal infra + MOSFET** (#37/#38): `Element` gained a 3rd terminal
  `c`; `set_netlist` + sim-wasm + `loop.ts` carry it (trailing-optional). `ELEM_NMOS=11`,
  `ELEM_PMOS=12` (level-1 square-law VCCS companion). Placeable, examples.
- **BJT NPN/PNP** (#40/#43): `ELEM_NPN=13`, `ELEM_PNP=14` (Ebers-Moll, two coupled
  diode junctions reusing `pnjlim`; a=C, b=E, c=B). Placeable (`Q`/`QP`), examples
  (switch, common-emitter, current mirror).
- **Varistor (MOV)** (#42/#46): `ELEM_VARISTOR=16` (symmetric clamp, Zener-style
  dual-junction limiting). Placeable (`MOV`, new **Protection** category), surge example.
- **Net labels** (#41): KiCad-style names + global aliases. `NetLabel{id,name,at:Endpoint}`,
  second union-find pass in `buildNetlist` collapses same-named labels onto one node,
  `nodeNames` surfaced in scope/telemetry, **Label tool** + `L` hotkey + inline editor.
- **Tunable AC amplitude** (#44): a 2nd per-element scalar **`aux`** threaded
  sim-core→wasm→loop→netlist (mirrors `c`); AC source EMF uses it (default 5 V);
  `Component.amp` + inspector chips (1/2/3.3/5/9/12 V).
- Fixes: scope ↔ telemetry **node-color alignment** (#45, ground muted, palette
  from node 1); independent coexisting ammeter+voltmeter (#39); junction-tool ghost.

**In flight:** **op-amp** sim-core (`ELEM_OPAMP=15`, smooth-clamped transconductance
VCCS, 3-terminal a=OUT/b=IN−/c=IN+, must converge in feedback) on `lib.rs`;
**manual switch** web (`MSW`, reuses `ELEM_SWITCH=6` at value 0/1 + click-toggle) on the web.

### Pick up here (remaining parts, then ICs)
- After op-amp sim → op-amp web. Then 2-terminal parts (thermistor, fuse, LDR — P7
  thermal/light state) and **7-seg** (multi-terminal + P8).
- **Relay + transformer** need a **4th terminal `d`** (a boundary bump like `c`) —
  4 nodes (2 coil/primary + 2 contact/secondary). Sequence that on `lib.rs`.
- Then the **preliminary ICs** (ic-buildings §5: gates → flip-flop → counters → 555
  → linear regulator) as behavioral buildings + examples.
- Element-type registry so far: 0–7 base, 8 Schottky, 9 LED, 10 Zener, 11 NMOS,
  12 PMOS, 13 NPN, 14 PNP, 15 op-amp (in flight), 16 varistor. Next free: 17.

---

## 2026-06-15 — MOSFET (NMOS/PMOS) web/UI integration (sim types 11 & 12)

**State:** 🟢 Green. **crates/ untouched** — built on the committed sim-core
level-1 MOSFET (`ELEM_NMOS = 11`, `ELEM_PMOS = 12`; drain `a`, source `b`, gate
`c`), golden `0xeaac376499e4fa24` unchanged; 53 sim-core tests (52 pass / 1
ignored `print_golden`); fmt/clippy clean; build:wasm, web format/check/lint/build
all pass. The first **three-terminal** part is now placeable, simulated, animated,
explained, and has examples.

**The third terminal through `buildNetlist` (`web/src/lib/netlist.ts`):**
- `BuiltNetlist` gains **`c: Uint32Array`**, parallel to `a`/`b`. For each
  element it is pushed in lockstep (EC's two stamps each push `c = 0`). A **3-pin
  device** (a MOSFET, `THREE_PIN_TYPES = {11,12}` and `kind.pins.length >= 3`)
  stamps `c` = its **gate** node (pin 2); every **2-pin** part stamps `c = 0`
  (ground), which the core ignores.
- **Pin→terminal convention matches the core exactly:** pin 0 → a = **Drain**,
  pin 1 → b = **Source**, pin 2 → c = **Gate**. `PART_KINDS` `NM`/`PM` define
  pins in that order (labelled D, S, G), so the map is direct.
- `elemOfComponent` → the MOSFET element (current = `Id`, oriented a→b =
  drain→source); `nodesOfComponent` → `[drain, source]`, so `vAcross` reads
  `Vds`.
- `c` folds into the topology **`sig`** (rewiring the gate to a new net rebuilds
  the netlist; a pure move leaves every node — c included — unchanged, so the sim
  isn't reset). The MOSFET also unions its **gate net** into the floating-source
  return-path check (all three nodes participate).
- `web/src/App.svelte`: both `setNetlist` call sites updated — the live one passes
  **`nl.c`**, the quiet ground-only fallback passes a new empty `Uint32Array`.
  (`loop.ts setNetlist` already took the trailing optional `c?`.)

**Parts / glyphs / info / bin:**
- `graph.ts PART_KINDS` `NM` ("N-MOSFET") + `PM` ("P-MOSFET"), `ok`/green
  ("switching/gain" family), 3 pins **D, S, G**, `value` unused (fixed model),
  `ideal: true`. `netlist.ts TYPE_OF` `NM:11`, `PM:12`. App `PARTS` bin + the
  **Active & Switching** category (`PART_CAT_OF`).
- `glyphs.ts` (`DRAWERS` + `FACTORY_DRAWERS`): **schematic** = the standard
  enhancement MOSFET symbol (insulated gate bar off a broken channel, drain
  up/source down, the body/channel arrow N-in vs P-out, the channel fingers
  retract = choke shut in cutoff). **Factory** = a gain-assembler/valve: a thin
  gate control belt lifts a sluice that opens a **fat drain→source main belt**
  whose width + flow density track `Id` and choke shut below threshold. All
  motion on the bounded `o.phase` clock — magnitude is width/density/alpha/glow,
  never speed.
- `partInfo.ts` `NM`/`PM`: teach Vgs vs the ~2 V threshold controlling Id;
  cutoff/triode/saturation; the square law + transconductance gm; the insulated
  gate draws no DC current. Live `headline` = the operating region + Vds/Id;
  derived rows = Id, a **recovered gm** (inverts the saturation square law from
  the measured Id/Vds, since the gate node isn't exposed to the inspector), and
  power Vds·Id.

**Examples (`examples.ts`, under Power & Switching, hand-checked):**
- **MOSFET as a Switch** (`mosfet-switch`) — VDD 5 V → R 150 Ω → LED → NMOS
  (low-side), gate driven by a second V source; gate HIGH (5 V > VTO) closes the
  channel (LED lit, ~18 mA, drain ≈0.3 V), gate LOW cuts off (dark). A
  gate-high/low `demo` toggle.
- **Common-Source Amplifier** (`mosfet-cs-amp`) — VDD 5 V → RD 100 Ω → NMOS
  drain (output), source → GND, gate bias Vgg 3 V (Vov = 1 V → saturation). Drain
  parks ≈3.9 V @ Id ≈11 mA; a small gate nudge swings the drain ~2× harder and
  inverts (gain ≈ −gm·(RD‖ro)). Mirrors the sim-core
  `nmos_saturation_operating_point_matches_square_law` layout.

### Pick up here
- The MOSFET `value` field is unused (fixed VTO/KP/λ). A per-device params block
  (P2) would let learners sweep threshold/size — the natural fidelity upgrade, and
  it would also let `partInfo` show a true Vgs/region instead of the
  recovered-gm derivation (the gate node could then be exposed in
  `nodesOfComponent`).
- The BJT (`Q`, 3 pins) is still a placeholder — the next multi-terminal part now
  that the 3-terminal netlist seam exists. Same owner-driven UI backlog as below.

## 2026-06-15 — Board interaction: placement ghost, junction drag, junction tool

**State:** 🟢 Green. **crates/ untouched** — render/interaction/graph only; golden
`0xeaac376499e4fa24` unchanged, `cargo test -p sim-core` 44 pass / 1 ignored;
fmt + clippy clean; `build:wasm`, web format/check/lint/build all pass. Three
features, all in `web/src/lib/board.ts`, `web/src/lib/graph.ts`,
`web/src/App.svelte`:

1. **Translucent placement ghost.** A non-interactive `ghostLayer` + reused
   `ghostGlyph` in the world container (above components, below pending-wire/
   probe; `alpha = GHOST_ALPHA`). `updateGhost()` redraws the armed part with the
   real `drawGlyph` at the grid-snapped cursor cell (`cellToWorld`) and rotates it
   by the new `armedRot`. Visible only while a part is armed AND the pointer is
   over the canvas — `pointerInside` tracked via canvas `pointerenter`/
   `pointerleave`; refreshed each `pointermove`. **Placement rotation:** `armedRot`
   (0..3); `setArmed` zeroes it on a new kind (keeps it when re-arming the same
   kind); `rotateArmed()` advances it. App's R calls `rotateArmed()` when
   `armedPart && selCount === 0`, else the old `rotateSelection()`. The drop passes
   it through `placeCell(kind, cell, rot)` (sets `c.rot` before `addNode`, whose
   ctor reads it).
2. **Double-click a junction to drag it.** `graph.ts` gains
   `moveJunction(id, cell)` — mutates only `j.cell`; incident wires reference the
   junction by id so they re-route by redraw; topology (and `sig`) unchanged.
   `board.ts` `junctionDrag` + `lastJunctionTap`: a 2nd press on the same junction
   within `DOUBLE_CLICK_MS` (350 ms) grabs it; move snaps + `moveJunction` +
   redraw; up commits to undo only if it moved. **Single-click still starts a wire
   from the junction** (unchanged).
3. **Junction placer tool + `J`.** `Mode` gains `"junction"`; App adds the toolbar
   button (mirrors Wire: `.btn`/`is-active` + `.hk` badge), `enterJunction()`, and
   `J` in `onKey`. In junction mode a wire click → `placeJunctionAt` →
   `junctionOnWire(wireId, cell)`. **`junctionOnWire`'s `from` is now optional**:
   without it the wire is split in place (`A→J`, `J→B`), giving the junction its 2
   incident ends so it survives `pruneJunctions` and `buildNetlist` keeps the two
   halves one net via J.

**Notes / deferred:** `onChange` still rewinds the clock to t=0 for *every* edit
(existing app-wide convention) — a junction drag does too, exactly like a part
move; but `sig` is stable so the solver netlist isn't rebuilt. Double-click is
timing-based (no Pixi `dblclick` on the federated stage). No new CSS — the
Junction button reuses existing `.btn`/`.hk` styles.

## 2026-06-15 — Zener (`ZD`) + electrolytic-cap (`EC`) web/UI integration

**State:** 🟢 Green (fmt/clippy/test incl. golden + 44 sim-core tests — 43 pass,
1 ignored `print_golden`; build:wasm, web format/check/lint/build). **crates/
untouched** — built on the committed Zener element (`ELEM_ZENER = 10`, `value` =
Vz), golden `0xeaac376499e4fa24` unchanged. Mirrors the Schottky/LED integration
below.

Two new parts are now placeable, simulated, animated, and explained:

- **Zener `ZD` (sim type 10).** `netlist.ts` `TYPE_OF ZD:10`; `graph.ts`
  `PART_KINDS` (bronze, `twoPin("A","K")`, **`value` = breakdown voltage Vz**,
  default 5.1 V); App bin (tier II, diode group); `values.ts` curated Vz set
  (2.4…15 V, chips 3.3/4.7/5.1/6.2/9.1/12). **Glyphs** (`glyphs.ts`): schematic =
  diode triangle + the **Z-bent cathode bar**, with a warm forward glow and a
  cyan reverse-breakdown bloom (each keyed to its current magnitude as alpha);
  factory = the check-valve gate **plus a side spillway/weir that opens on reverse
  breakdown** and pours the excess to the drain (per parts-catalog-ideation §1).
  `partInfo.ts`: static prose (forward = ordinary ~0.7 V diode; reverse blocks
  until Vz then clamps the node — the shunt-reference basis); live `headline`
  reports forward / blocking / in-breakdown + Vz, plus a power row.
- **Electrolytic `EC` (NO new sim type — netlist expansion).** Modelled honestly
  as an **ideal capacitor in series with a fixed 0.5 Ω ESR** (`EC_ESR_OHMS` in
  `netlist.ts`; fixed, not a function of C). In `buildNetlist`, each `EC`
  allocates **one internal node** (after all pin/junction nodes; bumps
  `nodeCount`; ordered by sorted component id so it's deterministic and
  move-invariant) and emits **two elements** — a capacitor (`+`pin → internal,
  value = C) and a resistor=ESR (internal → `−`pin). `elemOfComponent[EC]` = the
  **capacitor** element (its current is the series current the glyph/inspector
  read); `nodesOfComponent[EC]` = `[+pin, −pin]` so `vAcross` spans the whole part
  (incl. the ESR drop). The two stamps + the bumped `nodeCount` fold into the
  topology `sig`, so pure moves still don't reset the sim; the EC also unions its
  internal path in the floating-source check. `graph.ts` (cyan, polarized
  `twoPin("+","−")`, **`value` = C**, default 100 µF); bin (tier II); `values.ts`
  (10 µF…1000 µF). **Glyphs:** schematic = the polarized symbol (one **curved**
  plate + one straight plate + a "+" mark) reusing the cap charge-fill; factory =
  a **big ribbed pressure tank** that fills with stored voltage, ESR as a narrow
  throat at the inlet (per parts-catalog-ideation §2.1). `partInfo.ts`: teaches
  C + ESR (stores charge, but the series ESR drops a little on ripple surges — why
  a real cap can't perfectly flatten ripple); derived energy ½CV² + the ESR.
- **`examples.ts` (3 new).** **Zener Shunt Reference** (12 V → 1 kΩ → ZD→GND, node
  clamps ≈5.1 V, ~6.9 mA shunts through the Zener — mirrors the sim-core
  `zener_clamps_reverse_voltage` layout) and **Two LEDs in Series** (9 V → 270 Ω →
  LED → LED → GND, drops add to ~3.8 V, ~19 mA, both light equally) under
  **Diodes**; **Electrolytic Decoupling** (200 Hz AC → diode → load ∥ EC, ripple
  smoothing + the ESR keeps it from being perfectly flat, with a lift-the-cap
  demo) under **Capacitors & Inductors**. All operating points hand-checked.
- Every glyph rides the bounded `o.phase` clock; magnitude = fill / brightness /
  density / thickness, never speed (honours the flow-rate decoupling). `PALETTE`/
  token colors only; SPDX headers intact.

### Pick up here
- Owner-driven: the remaining parts catalog (`docs/parts-catalog-ideation.md`) —
  the next cheap-first wins are MOV (P1, like the Zener), then the multi-terminal
  lift (P3: BJT/MOSFET) and controlled sources (P4). Same UI backlog as below.
- The EC's ESR is a single fixed 0.5 Ω constant; a per-C ESR or a P2 param block
  is the natural fidelity upgrade if/when per-device params land.

---

## 2026-06-15 — Schottky + LED web/UI integration (sim types 8 & 9)

**State:** 🟢 Green (fmt/clippy/test incl. golden + 42 sim-core tests — 41 pass,
1 ignored `print_golden`; build:wasm, web format/check/lint/build). **crates/
untouched** — built on the committed sim-core diode family (`ELEM_SCHOTTKY = 8`,
`ELEM_LED = 9`), golden `0xeaac376499e4fa24` unchanged.

The two new diode-family parts are now placeable, simulated, animated, and
explained — the web layer mirrors how the silicon diode `D` is wired:

- **`netlist.ts`** — `TYPE_OF` gains `SD: 8`, `LED: 9`. An `LED` placed in
  V→R→LED→GND maps to element type 9; a Schottky to type 8 (both `twoPin("A","K")`,
  value unused, so they pass the 2-pin element guard in `buildNetlist`).
- **`graph.ts` + App bin** — `PART_KINDS` gains `SD` ("Schottky Diode", **cyan**,
  the cool low-loss variant) and `LED` ("LED", **accent** rose, the emitting hue);
  both added to the `PARTS` bin in the diode group (tier II) next to `D`.
- **`glyphs.ts`** — schematic + factory drawers for both, in `DRAWERS` and
  `FACTORY_DRAWERS`. Schottky: diode triangle + the bent-flag (S) cathode bar /
  a leaner open-throat check-valve. **LED: diode triangle + bar with two arrows
  radiating outward, and an emit glow (layered halo + white core) whose
  brightness = `norm(forwardCurrent, CUR_SCALE)`** — bright with current, dark when
  reverse/off; factory twin is a gate with a roof beacon lamp. All motion rides the
  bounded `o.phase` clock (breathe = `sin(phase·PULSE_K)`); magnitude is
  brightness/alpha/length, **never speed** (honours the flow-rate decoupling).
- **`partInfo.ts`** — `SD` teaches the ~0.3 V metal–semiconductor knee (large Is)
  vs silicon's ~0.7 V + a power row; `LED` teaches the ~1.8–2 V band-gap drop, that
  light tracks current, + a relative-brightness derived row (≈I/20 mA, presentation
  figure). Prose stays static; live numbers only in `headline`/`derived`.
- **`examples.ts`** — **"LED Current-Limiting"** (V 5 V → R 150 Ω → LED → GND,
  ≈20 mA, visibly lit — the classic first contract) and **"Schottky vs Silicon"**
  (parallel R+diode branches, reads the two forward drops side by side), both under
  the **Diodes** category.

### Pick up here
- Owner-driven: next nonlinear parts on the Newton engine (Zener, BJT/MOSFET) and
  the parts/IC roadmap (`docs/parts-roadmap.md`, the two ideation docs).
- Same outstanding UI backlog as below (more demo pages; optional energy-layer
  toggle).

---

## 2026-06-15 — Animation-rate fix + info-panel (static prose, live section, belt note)

**State:** 🟢 Green (fmt/clippy/test incl. golden + 38 sim-core tests, build:wasm,
web check/lint/build). sim-core untouched — golden `0xeaac376499e4fa24` unchanged.

- **Animation rate decoupled from magnitude + tps** (was unreadably fast on
  high-V/I examples; lowering tps didn't help). One **bounded visual flow clock**
  drives glyph flow dots, belt chevrons, energy dots, pulses — fixed wall-clock
  `FLOW_HZ ≈ 0.6`, independent of V/I/tps. Timeline gives **direction only**
  (forward running; sign of tick-change when scrubbing). Magnitude now reads as
  density + thickness + alpha. Carrier/energy slosh preserved by integrating the
  **saturated sign** of current / power v·i (`FLOW_DIR_SAT`), so AC still reverses
  and resistor energy still streams. `glyphs.ts` `flow()` constant-speed +
  density; `board.ts` `update()`/`redrawWires` rewrite. Spec in
  `docs/ui/visual-language.md` → *Decoupling flow rate from magnitude* (~0.3–1.5
  visual Hz across all I and tps). (Built by a worktree agent, reviewed +
  cherry-picked.)
- **Info panel jitter fixed:** the plain explanation embedded live numbers, so the
  prose reflowed every frame. Prose is now **static concept text** (`partInfo.ts`
  `plain()` no longer takes args); all changing numbers (headline relation +
  derived rows) are grouped into a dedicated **"Right now"** section below it.
- **Belt explainer:** always-on "carriers & energy" note in the Info tab —
  what the two layers are, and why energy flows forward on AC's negative
  half-cycle (P = V·I; negative × negative = positive). New `--energy` token.

- **Parts/IC ideation (no code, owner-driven):** `docs/parts-catalog-ideation.md`
  (discrete/analog menagerie → 8 new sim primitives; first 5 parts:
  per-device params → Schottky → LED → Zener → electrolytic-w/-ESR) and
  `docs/ic-buildings-ideation.md` (ICs as assemblers; black-box → macro →
  seal-a-sub-circuit-into-a-chip ladder; first ICs: gates → flip-flop → 555).

### Pick up here
- **More demo pages** (capacitor, inductor, RC/RL) in the dark style; link from app.
- Optional **toggle** for the energy layer if the belt is busy on dense boards.
- **Parts roadmap** (owner-driven): steer which parts/ICs first; the gating sim
  primitives are P3 multi-terminal + P4 controlled sources (see the two ideation
  docs + `parts-roadmap.md`).
- Owner-driven backlog unchanged (contracts prototype, per-island ΔT).

---

## 2026-06-15 — Interaction polish, carrier/energy belt, demo pages

**State:** 🟢 Green (fmt/clippy/test incl. golden + 38 sim-core tests, build:wasm,
web check/lint/build). sim-core untouched — golden `0xeaac376499e4fa24` unchanged.

- **Fixes batch (#22):** flow-jitter at high playback speed (per-frame phase-delta
  cap + chevrons capped to 14/wire); rotated parts lay labels/value/meter against
  the *rotated* pin bounds; on-board meter gated to parts without an editable
  value (the popover already shows V·A); top selector chips wrap instead of
  scrolling; **reset-on-edit** — any change (place/move/rotate/rewire/value)
  rewinds the scope + clock to t=0 (App `onChange`).
- **Carrier/energy belt (loop-tile):** each wire animates two layers — *carriers*
  (voltage-coloured chevrons, position integrates **signed current** → stream on
  DC, slosh on AC) and *energy* (warm-orange dots, travel integrates **signed
  power v·i** → steady delivery to the load on a resistor even while carriers
  slosh; sloshes on a reactive part). Per-wire phase accumulators
  (`carrierOffset`/`energyOffset`) off the same timeline-relative phase, consumed
  once/frame, pruned on delete. Encoding in `docs/ui/visual-language.md`.
- **Demo pages:** `docs/visuals/resistor.html` (heating, I²R) + `docs/visuals/
  diode.html` (half-wave + smoothing cap), standalone, in the **dark HUD** style
  (matches the app, not the light reference docs).

### Pick up here
- **More demo pages** in the same dark style (capacitor, inductor, RC/RL — the
  user asked for "a couple more"); consider linking them from the app.
- A **toggle** for the energy layer if the belt reads too busy on dense boards.
- Same owner-driven backlog as below (contracts prototype, per-island ΔT).

---

## 2026-06-15 — AC track (sine source + 9-example curriculum) + game-design ideation

**State:** 🟢 Green (fmt/clippy/test incl. golden + 38 sim-core tests, build:wasm,
web check/lint/build). Also shipped this session: the value Inspector (#13), an
ammeter + live guided builds (#14), custom rate + progressive examples (#15), the
value-popover (#16), the incomplete-circuit warning (#17), and collapsible
example categories (#18).

- **AC source** (`sim-core` type 7): ideal sine `5·sin(2π·f·t)`, `value` = freq,
  deterministic, golden unchanged. Wired through netlist `AC:7` / `PART_KINDS` /
  `drawAC` glyph / bin / inspector frequencies. **9 build-and-observe AC examples**
  (`docs/ui/ac-curriculum.md`) under AC Fundamentals / Reactance / Filters /
  Resonance / Rectification.
- **Time/measure/UX this session:** ticks-per-**second** playback driven by real
  elapsed time + a custom-rate input; an O(1) ring so the timeline reaches t=0; a
  wall-clock "Sim time" readout (`DT_SECONDS`); the **ammeter** (Measure → V/A);
  the **value Inspector** as a floating **popover** anchored above the part
  (`board.onAnchor` projects to screen space); and the incomplete-circuit amber
  warning (`netlist.floatingSources`).
- **Design ideation (no code):** `docs/game-factory-loop.md` +
  `docs/game-contracts-economy.md` explore the Factorio/Shapez sandbox+contracts
  vision (owner-driven; not greenlit to build).

### Pick up here
- **Sandbox ΔT model** (TODOS): per-electrical-island adaptive ΔT + a shared
  physical-time clock; black-boxing validated sub-circuits as a scale + ΔT lever.
  Owner wants to steer the game direction before implementation begins.
- **Game MVP** (if greenlit): a parametric contract generator + pin-sampling
  grader off the deterministic replay.

---

## 2026-06-15 — Buck converter: diode + PWM switch wired up, animated demo

**State:** 🟢 Green (fmt/clippy/test incl. golden + the new buck/switch tests,
build:wasm, web check/lint/build).

- **Switch element** (`sim-core` type 6, cherry-picked): time-varying linear
  conductance, a pure function of the tick (`SWITCH_PERIOD_TICKS = 50` ≈ 10 kHz,
  `value` = duty, `Ron 0.01 Ω` / `Goff 1e-9`), stamped in all four solve paths.
  Golden unchanged; 31 tests incl. `switch_buck_converter_steps_down_and_is_finite`.
- **Diode + switch in the web**: `netlist.ts` `D:5` / `SW:6`; animated `drawD`
  (triangle + cathode bar, forward glow/flow) and `drawSW` (lever flicks
  open/closed off live `vAcross`); both placeable in the bin.
- **Buck Converter example**: Vin → SW → L → OUT, freewheel diode, smoothing cap +
  load, GND; vertical V/C/R/D via a new optional `rot` on the example `comp()`.
  Steps 10 V → ≈4 V at 40 % duty. (Connectivity is by pin-ref, so the rotations are
  visual-only — the netlist is a correct buck regardless of layout.)
- **Design notes added** (no code yet): `docs/ui/value-picker.md`,
  `docs/ui/incomplete-circuits.md` (recommended fix for the V-loop/I-one-sided
  asymmetry: a topology pre-check for a current-source terminal with no DC path +
  a deterministic `singular()` flag from the solver, folded into the once-per-frame
  snapshot read; surface an amber hint, don't halt the sim, don't hash the flag).

### Pick up here
- Build the **value Inspector** (`docs/ui/value-picker.md`) and the
  **incomplete-circuit affordance** (`docs/ui/incomplete-circuits.md`).
- More nonlinear parts (LED, BJT/MOSFET) now that the Newton engine exists.

---

## 2026-06-15 — Scope/telemetry upgrade + value-picker design; solver upgrade in flight

**State:** 🟢 Green (web check/lint/build; Rust unchanged this batch). Scope panel
on the branch.

- **Scope/telemetry**: the scope can **Expand** (~60% of the board) from a
  telemetry button; each node has a **show/hide** checkbox and a **rename** input
  in the telemetry panel; the scope autoscales to visible traces and draws a
  coloured **legend** of node names. `board.ts`: `setNodeLabel` / `setNodeHidden`
  / `toggleScopeExpanded` + a `scopeLegend` Text pool + `nodeName()`. `App.svelte`:
  per-node controls (node 0 / GND stays fixed).

### Landed / in flight
- **Solver upgrade → nonlinear Newton engine** — ✅ merged into the branch.
  Deterministic Newton–Raphson loop, engaged only when a nonlinear element is
  present; the linear fast-path is byte-identical so the golden `0xeaac…` is
  unchanged. **Diode** (type 5: Shockley + `gmin` + `pnjlim` limiting, 100-iter
  cap) is the first nonlinear element. 25 sim-core tests pass incl.
  `diode_run_is_reproducible`. Next: wire the diode into the web (netlist
  `TYPE_OF D:5`, `drawD` glyph, bin) so it's placeable.
- **Value picker** design is in `docs/ui/value-picker.md` (recommended: an
  Inspector with curated chips + ▲▼ stepper + "More values ▸" decade×significand;
  E24 R / E6 C·L). Build the Inspector next.

### Backlog (owner)
- **Buck converter demo** — fully-animated, energy moved in "buckets" to a new
  voltage. Needs switching (switch/MOSFET + diode + L + C) → follows the solver
  upgrade + a switch part. Fun, lower priority.

---

## 2026-06-15 — KCL-aware belt flow, finer ΔT, readable example layouts + new examples

**State:** 🟢 Green (fmt/clippy/test incl. new golden, build:wasm, web
check/lint/build). On the branch; merge to `main` for the live site.

- **KCL-aware wire flow** (`board.ts computeWireCurrents`): each element injects
  its current at its two pins; routing those injections along a per-net spanning
  tree gives the true branch current in every wire segment. A shared rail now
  visibly **thickens toward a source and thins past each tap** (thickness +
  chevron density + direction). Render-only; cycle/redundant wires read 0.
- **Finer ΔT**: `DT` 10 µs → **2 µs**. Golden regenerated to
  `0xeaac376499e4fa24` (justified: deliberate fidelity change). Monotonic-RC test
  now runs 15000 × 2 µs (same physical time). Playback compensated to keep the
  wall-clock pace: default `tpf` 0.5, `SPEEDS` [0.5,1,2,5,20], `TICK_FLOW` 0.006.
- **Examples relaid** as readable rectangular loops with **explicit GND**
  (primer/divider/RC/RL), plus two new ones: **Parallel Resistors** (shows the
  new KCL rail accumulation) and **Current Source** (the `I` part, V = I·R).

### Pick up here — outstanding owner requests
- **Scope/telemetry panel** (asked, not yet built): make the right panel a
  bigger/expandable box housing the scope; **toggle each node** on/off; **label
  each node**. Touches `board.ts` (scope draw respects visibility + names) and
  `App.svelte` (telemetry: per-node checkboxes + name inputs + expand control).
- **Per-component value editing from real values** (asked): an inspector that
  lets you pick a component's value from standard/E-series options per type (no
  arbitrary 100.56 Ω). New values table + App inspector + a `board` setter.
- **Next parts batch** (asked): switch / push-button (stateful click-to-toggle —
  needs board interaction + netlist invalidation), then the nonlinear
  diode/LED/BJT (needs a Newton loop in sim-core). See `docs/parts-roadmap.md`.

---

## 2026-06-15 — Draggable wires, timeline-relative flow, crisp text, hotkeys + new I/GND parts

**State:** 🟢 Green (fmt/clippy/test incl. golden + 4 new current-source tests,
build:wasm, web check/lint/build). Phase 0 is on `main` (PR #5). This session's
work is on the branch, to ship as **one combined merge**:

- **Draggable wires:** `Wire.mid` optional waypoint — drag a wire to bend its
  orthogonal belt through a grid cell; drop it back on the straight pin-to-pin
  line to straighten. `routeForWire` is now the single source of wire geometry
  (draw / hit-test / selection-with-handle-dot / probe-snap). Cosmetic only — the
  netlist signature ignores `mid`, so the sim never resets.
- **Timeline-relative flow:** the flow phase is `realPhase + tick*TICK_FLOW`, so
  the arrows/dots track ΔT — forward as the tick advances (running OR scrubbing
  forward), reverse when stepping/scrubbing back — instead of freezing on pause.
- **Crisp text (round 2):** Text resolution floored at 2× and multiplied by zoom
  (`applyTextRes` + `ComponentNode.setTextRes`); the old cap-at-2 mismatched the
  hi-DPI renderer. Labels stay sharp when zoomed.
- **Hotkeys:** Space play/pause · arrows nudge the selection (or pan when empty,
  `board.nudge`) · `,`/`.` step a tick back/forward.
- **New ideal elements** (parallel worktree agent, cherry-picked clean): ideal DC
  **current source** (`I`, sim-core type 4, animated arrow) and an **explicit
  ground** (`GND`, 1-pin reference; `buildNetlist` prefers it for node 0). RC
  golden unchanged. See `docs/parts-roadmap.md`.

### Pick up here
- Combined PR → `main` is the next action (user chose one combined merge); then the
  live Pages site has everything.
- Modeless **Phase 1** still open (`docs/ui/mode-flow.md`): ghost preview + pin
  hover-snap. Per-component **value editing** is now more valuable (I/GND/V/R/C/L
  all carry values). The rail chevron density still reflects a *single* element's
  current, not the KCL sum along a shared net — a known visualization gap.

---

## 2026-06-14 — Modeless interaction (Phase 0): Build + Measure, armed parts

**State:** 🟢 Green (fmt/clippy/test + golden, build:wasm, web check/lint/build all
pass); pushed. Phase 0 of `docs/ui/mode-flow.md` — the clunky 4-mode toolbar
(Select/Place/Wire/Measure) is collapsed into a Factorio-style modeless board:

- **Build (default) + Measure toggle** replace the four mode buttons. The `Mode`
  type keeps `place`/`wire` internally, but `App.svelte` only ever sets
  `select`/`measure`.
- **Armed-part model** (replaces Place mode): clicking a bin row *arms* that kind
  (click again / Esc to disarm); clicking an empty board cell drops it and stays
  armed (place-and-repeat). Drag-from-bin still one-shots. New on the board:
  `setArmed`, `placeCell`, an `onArm` callback (so a board-side right-click disarm
  mirrors back into the HUD), and `escape()`.
- **`onPointerDown`**: the `place` early-return is gone. Pin → wire, body →
  select/move, wire → select all run as before; an empty-cell press with a part
  armed now places. Right-click disarms when armed (else deletes under cursor).
- **Discoverability:** per-context cursor (`copy` armed / `crosshair` measuring /
  default), a one-line **hint** in the board overlay, and an **armed-part chip**
  (× to disarm) in the toolbar. **Esc** = disarm → cancel wiring → clear selection.

### Pick up here
- **Phase 1** (feedback): a translucent **ghost** of the armed part snapping to the
  cell under the cursor, and **pin hover** highlight + snap-ring. **Phase 2**
  (speed): click→click chained wiring, `1`–`9` hotbar + `Q` pipette, Shift-drag
  box-select, Space-pan. Then retire the unused `place`/`wire` `Mode` variants.
- This is on `claude/kind-turing-hdelb3`, ahead of `main`. No PR opened this
  session (open/merge when the owner wants the live Pages site updated).

---

## 2026-06-14 — Playtest overhaul: belts, scope, primer, probes, ground, reset/speed

**State:** 🟢 Green; pushed. A large pass on the look + feel from hands-on feedback
("think Factorio with belts, but electricity"):
- **HiDPI** rendering (devicePixelRatio + autoDensity) — no more blur.
- **Belts:** traces route at 90° (`wireRoute`), are coloured by net voltage
  (`voltageColor`), and carry flow chevrons whose direction + density track the
  current (`redrawWires`, redrawn each frame off the live snapshot).
- **Scope** rewritten: per-tick samples (freezes on pause, scrubs with the
  timeline), a cursor line, numbered V axis + tick label.
- **Reset Run** (↺) + `loop.restart()`; **fractional** ticks-per-frame and a much
  slower default (0.25×).
- **Ground** symbol + "GND 0 V" at the source's node-0 pin (`drawGround`).
- **Panel** unified: the guided panel floats over the board (`.guided-overlay`)
  so the Parts bin stays visible; a **"Voltage & Current" primer** opens running
  (the first thing you see is current flowing) with a dismissible intro banner.
- **Probes** are now draggable leads that snap to a **pin or a trace**
  (`ProbePoint`, `snapProbe`, `measurePress`); a pin-attached lead follows the part.

### Now also done
- **Component rotation** shipped (R hotkey + Rotate button): `rot` on the component,
  rotated `pinCell`/`componentBox`, a rotated glyph sub-container with upright labels;
  connectivity is unchanged so the sim isn't reset. **Watch starts paused** now.
- **Mode-flow brainstorm** captured in `docs/ui/mode-flow.md` — collapse
  Select/Place/Wire into one armed-part "Build" mode + a Measure tool (Factorio-style).
  Phase 0 (small, mostly deletes the mode buttons) is the next UX task.

---

## 2026-06-14 — Pedagogy demos: "across/through" readout, DMM probe, divider R2 toggle, concept beats

**State:** 🟢 Green; pushed. A "show don't tell" layer over the board + examples:
- **Live readout on select** (`board.ts` ComponentNode `meter`): selecting a part shows its
  **V across · I through** — watch the RC cap's current fall to 0 (an open at DC, not a short).
- **DMM probe** — Measure mode in `board.ts`: red (+) / steel (−) leads with needle tips and
  handle knobs. Click two pins → live **ΔV** between them; one pin → vs GND. App passes the
  pin→net map via `board.setProbeNodes(netlist.nodesOfComponent)`. Teaches "voltage is a
  difference across two points / ground is just the reference you picked."
- **Divider R2-to-ground toggle** (`examples.ts` `demo` + App `toggleDemo`): lifts/restores
  R2's ground wire — OFF floats the output to the full rail (no current), ON divides to 3.33 V.
- **Guided concept beat:** the Build panel shows "Open loop — no current" until you close it
  to ground, then "Loop closed — current flows", matching the readouts that sit at 0 until then.

Next demonstrative ideas: extend demos to RC/RL (short the cap / open the coil); a movable
probe that snaps to whole nets; per-part value editing so learners can sweep R/C/L live.

---

## 2026-06-14 — Interactive board comes alive: viewport, scrubber, selection, solver, examples + guided build

**State:** 🟢 Green (cargo fmt/clippy/test, build:wasm, web check/lint/build). Pushed to
`claude/kind-turing-hdelb3` (ahead of `main`; no new PR opened this session).

### What's new
- **Viewport:** wheel zoom (to cursor) + pan (drag empty space / middle-drag) via a
  transformable `world` container in `web/src/lib/board.ts`.
- **Voltage source + values:** ideal `V` in the bin; every part carries a value + unit;
  `graph.ts` gains serialize/restore (used by undo + examples).
- **Time:** paused by default; a bottom **tick scrubber** (per-tick step back/forward)
  backed by a bounded snapshot history in `loop.ts`.
- **Editing:** click / shift+ctrl multi-select with highlight, **Delete**, **Ctrl+Z** undo
  (undo stack in `board.ts`).
- **Animated glyphs** (`web/src/lib/glyphs.ts`): R/C/L/V draw their schematic symbol plus a
  state-driven animation (current flow, charge fill, field halo, source pulse).
- **Solver wired:** `web/src/lib/netlist.ts` compiles the `BoardGraph` into the MNA netlist
  (ground = the first voltage source's − net). `sim-core` is generalized to an arbitrary
  ideal netlist (`set_netlist` / `node_voltages` / `element_currents`); golden
  `0x6d055513f0613902`. Per-element current/voltage feeds the glyph animations, so placed
  circuits and examples **simulate for real**.
- **Examples** (`web/src/lib/examples.ts`): a Parts/Examples tab; each example offers
  **Watch** (load + run) and **Build** (guided, auto-advancing checklist with a "why" per
  step) — Voltage Divider, RC, RL.

### Seam notes / gotchas
- The netlist is rebuilt only when topology or a value changes (a `sig`), so dragging parts
  never resets the sim. An empty board keeps the built-in demo RC; parts with no source go
  quiet (ground-only netlist).
- `state()` is now node voltages (variable length, index 0 = ground); telemetry labels are
  node-indexed.
- Ground convention: the net on the **first voltage source's − pin**. No dedicated GND part yet.
- `cap_voltage()` was removed from the wasm API (it was RC-specific); nothing in web used it.

### Pick up here
- Top of `TODOS.md`: a value-editing inspector, the diode (nonlinear), the power-bus visual
  language on wires, the digital/MCU engines, and the first graded challenge.
- GitHub Pages still needs the owner to flip Settings → Pages → Source: GitHub Actions.

---

## 2026-06-14 — PR #1 opened, Pages wired, bus visual-language reference added

- **PR #1** opened (`claude/kind-turing-hdelb3` → `main`):
  https://github.com/nathanfraske/CEC-Electronic-Game/pull/1
- **GitHub Pages** deploy added (`.github/workflows/pages.yml` + env-driven Vite
  `base`). After merge and enabling Pages (Settings → Pages → Source: GitHub
  Actions), the site deploys to https://nathanfraske.github.io/CEC-Electronic-Game/.
- **Bus visual language**: the owner provided a draft reference for showing
  voltage and current — `docs/ui/dc-bus-reference.html` (interactive) distilled
  into `docs/ui/visual-language.md`. Voltage = net level (height + rail color +
  number); current = flow + thickness + number; KCL at taps; IR-drop sag. Draft,
  not final. Implement in the PixiJS renderer once the board graph feeds the solver.

---

## 2026-06-14 — Parallel panel landed: M1 + M2 + design polish

**State:** 🟢 Green. Three parallel agents (isolated git worktrees) integrated
cleanly into this branch; the full gate suite passes on the integrated tree.

### What changed since the bootstrap
- **M2 — analog core (Lane A).** `crates/sim-core` now runs a real deterministic
  analog engine: backward-Euler companion models assembled by Modified Nodal
  Analysis, solved each fixed tick by a bounded dense Gaussian elimination
  (fixed order, partial pivot). Circuit = RC charge (V → R → C → gnd).
  `state()` = `[v(n1), v(cap), i(src), v(rail)]` (volts/amps). Committed golden
  `0x92349dbbbf5a8293` (seed 42, 1000 steps). `sim-wasm` adds `cap_voltage()`;
  all prior method names unchanged.
- **M1 — interactive board (Lane B).** `web/src/lib/graph.ts` (board model) plus
  a rewritten `board.ts` (PixiJS scene + input). Drag a part from the bin to
  place it, click-drag pin→pin to wire, drag to move, right-click to delete,
  Select/Place/Wire mode toggle + Clear. Renderer & telemetry iterate the live
  `state().length` (no hardcoded channel count).
- **Polish (Lane C).** Fonts self-hosted under `web/public/fonts/` (Google CDN
  removed); CRT/scanline scope frame, full button/chip/telemetry state matrices,
  neon glows, `prefers-reduced-motion`. Token values unchanged.

### ⚠️ Important seam for the next agent
The interactive board and the simulator are **not yet connected.** The core
solves a *fixed* RC circuit; placing/wiring parts builds a `BoardGraph` that is
**not yet fed to the solver.** The top backlog item is to compile the board
graph into a netlist the core solves (see `TODOS.md`).

### Integration mechanics (FYI)
Each lane worked in an isolated worktree branched from the bootstrap base and was
cherry-picked here (the lanes touched disjoint files, so no conflicts). The
ephemeral worktrees under `.claude/worktrees/` are gitignored and were removed
after integration.

How to verify is unchanged (see CLAUDE.md). Branch `claude/kind-turing-hdelb3`; no PR opened.

---

## 2026-06-14 — Repository bootstrap + first design pass

**State:** 🟢 Green. Every verification gate passes from a clean checkout.

### What exists now
- **Cargo workspace** (`Cargo.toml`) with three crates:
  - `crates/sim-core` — deterministic fixed-step placeholder `Sim`, FNV-1a
    `snapshot_hash`, `run_is_reproducible` test, ignored `print_golden`. Added a
    read-only `state()` accessor for rendering (does not affect determinism).
  - `crates/sim-protocol` — wire types only (`PROTOCOL_VERSION`, `NodeId`, `PinId`).
  - `crates/sim-wasm` — wasm-bindgen `Simulation` exposing
    `step/tick/state/protocol_version/snapshot_hash`. `wasm-opt` disabled here.
- **Web app** (`web/`) — Vite 8 + Svelte 5 + TS + PixiJS 8. CEC-styled HUD:
  component bin (tech-tree preview), oscilloscope board rendering the live
  deterministic snapshot as auto-ranged traces, telemetry panel, and transport
  controls (run/pause/step + 1×/4×/16×/64× speed). The JS↔wasm boundary is
  crossed once per frame in `web/src/sim/loop.ts`.
- **Design system** mirrored from criticalerrorcomputing.com — tokens in
  `web/src/app.css`, hex mirrors in `web/src/lib/board.ts`.
- **CI** `.github/workflows/ci.yml` (`rust-core`, `web-build`).
- **Docs** `docs/architecture.md`, `docs/determinism.md`, `docs/adr/0001-tech-stack.md`,
  and `docs/game-design.md` (pillars, tech tree, challenge/grading, milestones M0–M5).
  Legal: `LICENSE` (canonical Apache-2.0), `NOTICE`, `README.md`, `CONTRIBUTING.md`.
- **Self-heal hook** `.claude/hooks/` + `.claude/settings.json` — installs the
  wasm toolchain on ephemeral containers and surfaces these docs at session start.

### How to verify (full list in CLAUDE.md)
```
cargo fmt --all -- --check
cargo clippy -p sim-core -p sim-protocol --all-targets -- -D warnings
cargo test -p sim-core -p sim-protocol
pnpm run build:wasm
pnpm -C web check && pnpm -C web lint && pnpm -C web build
```

### Intentional deviations from the runbook (all documented)
- `wasm-opt` disabled in `crates/sim-wasm/Cargo.toml` — binaryen is not fetchable
  in the sandbox. Re-enable when the build image provides it.
- Added `Simulation.state()` so the renderer can read the snapshot. Read-only.
- `lint` = Prettier + ESLint flat config (svelte + ts), both green.

### Pick up here
- The placeholder `Sim` is a scaffold. The next substantive work is the real
  **mixed-signal engine** — start in `crates/sim-core/src/lib.rs` against
  `docs/architecture.md`, preserving the determinism invariants.
- Branch: `claude/kind-turing-hdelb3`. No PR opened yet — open against `main`
  when the owner is ready (do not push to `main`).
- See `TODOS.md` for the prioritized backlog.

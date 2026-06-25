<!-- SPDX-License-Identifier: Apache-2.0 -->

# CEC Electronic Game — Master Implementation Plan

> **The planning capstone over the five design panels.** This is the consolidated owner-decision ledger plus the dependency-ordered master build plan for the whole game-design pass. **Planning only** — a roadmap and a decision list, no feature code. Resolution rule used throughout: where any panel conflicts, the call goes to **smallest fun slice first · golden-safe · planning-only**, and the conflict is named where it bites.

---

## 0. Purpose & scope

This doc sits over the five design panels (all docs-only, already landed on `claude/kind-turing-hdelb3`):

| Panel | Doc | One line |
| --- | --- | --- |
| **PROBE** | `docs/ui/probe-teaching-arc.md` | The failure-first hook: blow-up → resistor → divider → build-from-scratch; introduces **magic-smoke-over-FAIL**, the **seeded anti-copy generator**, and the **value-aware grader**. |
| **ONBOARD** | `docs/ui/beginner-onboarding-all-ages.md` | The system/journey: curriculum ramp, the durable **Probe coaching layer**, all-ages-by-pull, the accessibility/reach spec, retention. |
| **FUND** | `docs/ui/fundamentals-scaffold-arc.md` | Show-don't-tell teaching of place/wire/loop-ground/carriers/colours/voltage/current; the optional scaffold that opens at the Era-0→1 boundary; migrates the existing `concepts.ts` cards into **7 FUNDAMENTALS_IDS**. |
| **PROD** | `docs/game-product-simulation.md` | RMAs / EMI+UL cert / yield / reliability / recalls / reputation; the all-ages teaching bridge. EMI gate **blocked** on the invisible-electronics kernel. |
| **ECON** | `docs/game-economy-progression-implementation.md` | The tech-tree unlock DAG, Credits/Lux/standing, the contract loop (template/grader/FSM; satisfiability on a separate offscreen scratch `Simulation`), the **Reveal Engine**, `cec.game.v1` persistence. |

**Scope.** Everything below is **GAME-DESIGN / UX + web-side state**. Nothing here touches `crates/sim-core`, the netlist emission, or `snapshot_hash`. The Rust gates are the proof: they stay **GREEN UNCHANGED** every phase.

**Current code reality** (what we wire into, vs greenfield):

| Already built — *wire into these* | Greenfield — *to build* |
| --- | --- |
| FAIL mask (`flag_and_clamp_fails` / `failed_elements` unhashed / `RATED_CURRENT_SLOT`); `board.ts` FAIL box that freezes the run | Credits / Lux / standing; the tech-tree unlock DAG + gating |
| `electricalMap` (per-component V/I) + `graphShape` (topology oracle) in `netlist.ts` | The contract loop (template / generate / grade / FSM) |
| The web-side Tj **heat model** | The **seeded anti-copy generator** + value-aware **`SpecLine` grader** |
| Flow/carrier render (`FLOW_HZ`) + `voltageColor` rail identity + the standpipe magnitude bar | The **magic-smoke** presentation |
| The Build do/why/done engine (`startBuild`/`advanceBuild`, guided-open/done loop-closure flip) | The reliability / cert model (`reliability.ts`), the Lab Notebook codex |
| Armed ghost + pin snap-ring; the value picker; incomplete-circuit "—" | The **Reveal Engine**; the **by-feel target renderer** |
| Info drawer / value popover / `partInfo.ts` | — |
| **`concepts.ts` (PARTIALLY BUILT):** `CONCEPTS` (source/ground/loop/reading) + `CONCEPT_ORDER`, fired by `offerConcept`/`pumpConcepts`/`dismissConcept`/`replayConcepts`, deduped by `seenConcepts` | The 7-id **fundamentals** re-key + read-deeper rungs over it |
| `storage.ts` (`seenIntro`/`explainAsYouGo`/`seenConcepts` + board save); `PARTS` (tier I/II tags + category) + `PART_KINDS`; `EXAMPLE_CATEGORIES` | — |

---

## 1. ★ Consolidated OWNER-DECISIONS

> **Already decided — do not re-ask:** (1) the cold-open **fires on the player's own Run** (not a cutscene); (2) the **Probe voice is retro-robotic TTS**. Both are baked into the plan below.

Priority key: **BLOCKER** (nothing in its theme proceeds) · **PRE-BUILD** (decide before the named phase opens) · **TUNING** (decide during, safe to defer to a balance pass) · **LATER** (post-MVP).

### A — Onboarding / Probe hook
| # | Decision | Recommendation | Blocks | Pri |
| --- | --- | --- | --- | --- |
| A1 | Auto-mute the voiced Probe after first lessons? | Yes — auto-mute after the divider lesson; Help-handle re-arms. Tie to **competenceDetected** (F-table). | O4, O3 | TUNING |
| A2 | Exam placement — where does the only exam wall sit? | **Era-4 only**; all earlier era crossings are exam-free. | P2 | PRE-BUILD(P2) |
| A3 | Reduced-motion blow-up substitute | Static cooked glyph + named-cause chip + single flinch frame. | O1 | PRE-BUILD(O1) |
| A4 | Cold-open default entry — blow-up for everyone, or a "Show me how this works" fork (calm primer for "Let me build")? (probe §9 #2) | Keep **both** forks: the blow-up is the "Show me" thread; the calm primer is the "Let me build" / returner default. | O1 | PRE-BUILD(O1) |
| A5 | Naming label — the Probe (bench-bot mascot) vs the DMM probe leads (`probeA`/`probeB`)? (probe §9 #14) | Bless a distinguishing label; accept the in-doc convention until then. | O1 | PRE-BUILD(O1) |
| A6 | R3 fork default — `led-limit` (spectacle) or `rc` (scope-curve)? (beginner §9 #1) | Offer **both** as equal chips; do not pick a default. | O3 | TUNING |
| A7 | Who owns bespoke concept-card **copy + fire-order**? (fundamentals §10 #9) | Fundamentals **defers** wording to PROBE/ONBOARD (content ownership); it specs the mechanics only. | O0, O2 | PRE-BUILD(O0) |

### B — Contract loop & grader
| # | Decision | Recommendation | Blocks | Pri |
| --- | --- | --- | --- | --- |
| B1 | Grader tolerance band default | ±tol per `SpecLine`; default **±5%**, looser for Era-0 openers. | P0, P1 | PRE-BUILD(P0) |
| B2 | **Generalize the grader** from probe's single-Vout `specMet` to general `SpecLine[]`? | **Yes — build the general grader ONCE** in P0; probe is a one-line consumer. | P0 (all panels) | BLOCKER |
| B3 | The **JP judgement-part** primitive (named pads) — adopt? | Yes — `OUT/LOAD/RAIL/SENSE/GND`, tick-pure stimulus (`PULSE→ELEM_ACSOURCE`, `SHUNT→ELEM_RESISTOR`). | P0a | BLOCKER |
| B4 | Reveal-Engine fold — separate loop or fold into the concept-card drain? | **Fold** into the one-per-frame concept-card drain loop. | P2 | PRE-BUILD(P2) |
| B5 | Resistor value model for the from-scratch build — continuous ohms or an E-series/preferred-value bin? (probe §9 #5) | **Continuous for the opener**; offer the E-series bin as a later, more-honest reality rider. Shapes `generate`. | P1 | PRE-BUILD(P1) |

### C — Economy / progression balance
| # | Decision | Recommendation | Blocks | Pri |
| --- | --- | --- | --- | --- |
| **C1** | **The balance pass** — every econ number AND every PROD FIT/RMA/recall constant, in ONE `data/balance.ts`. | Single sheet; defer exact values to a dedicated tuning sweep after the vertical slice plays. | P3, PS-chain | TUNING |
| C2 | Anti-grind per-seed Lux decay curve | `max(0.1, 0.25·0.5^(n-1))` — floors at 0.1. | P3 | TUNING |
| C3 | Difficulty band shape | Continuous [0,1]; add a 2nd `SpecLine` at d > 0.6. | P3 | TUNING |
| C4 | Era-5 split order | Two sub-nodes, **logic first**. | P2 | PRE-BUILD(P2) |
| C5 | Do late eras require DELIVERED standing contracts (a `requiresStanding` floor on `TechNode`), or can a pure tinkerer climb on Lux+eureka alone? (economy §10 #3) | **Default OFF** (tinkerer can climb); keep the field optional so it can be flipped per node. | P2 | PRE-BUILD(P2) |

### D — Product-sim / reliability
| # | Decision | Recommendation | Blocks | Pri |
| --- | --- | --- | --- | --- |
| D1 | Recall trigger | systemic-share ≈ **40% AND** hard-safety `s > 1`. | PS4 | TUNING |
| D2 | Funded-quality levels | 4: skimp / standard / screened / burn-in; multiplies **only** infant-mortality + yield. | PS2 | PRE-BUILD(PS2) |
| D3 | UL/EMI life coupling | clamp `lifeMultiplier` 0.6..1.0, **worse-of** EMI/UL. | PS3a | TUNING |
| D4 | `fundedQualityLevel` enters `designHash`? | **Yes** — references **F1**. | PS2 | PRE-BUILD(PS2) |
| D5 | CEC-Certified — a hard cert-pass PRECONDITION, or just a bonus-tier input? (product-sim §9 #11) | **Hard precondition** — a comfortable EMI/UL pass gates CEC-Certified (couples `certBadge`/`lifeMultiplier` into P5 bonus tiers). | P5 | PRE-BUILD(P5) |
| D6 | Standing-contract RMA pacing — real-seconds-per-field-life-window (the 5-year fast-forward)? (product-sim §9 #9, distinct from econ §10 #9) | Prototype-driven; ship **only-while-focused** at MVP, defer the idle-accrual model. | P5 | TUNING |
| D7 | The recall / "make-100" JUICE trigger — every clean ship, or once-discovered → persistent handle? (product-sim §9 #13) | **Once-discovered → persistent handle** (avoids spam); the field-life fast-forward is opt-in. | PS1, PS4 | TUNING |

### E — Accessibility / voice / i18n
| # | Decision | Recommendation | Blocks | Pri |
| --- | --- | --- | --- | --- |
| E1 | Colour-vision channel | `railPatterns` **paired** with `voltageColor` (never colour-only). | O4 | PRE-BUILD(O4) |
| E2 | Captions model | captions **= the Probe card** (one string source, voiced + shown). | O4 | PRE-BUILD(O4) |
| E3 | i18n id space | **One id space** shared with concept/coaching strings from day one. | O0, O4 | PRE-BUILD(O0) |
| E4 | aria-live cadence | ~2 Hz first cut, reads `electricalMap` only. | O4 | TUNING |
| E5 | Screen-reader scope — the thin aria-live cut now, or the full board→prose engine? (beginner §9 #16) | **Thin aria-live now** (selected part V/I + loop/FAIL transitions); the full board→prose engine is UNDESIGNED, handed to a dedicated a11y panel. | O4 | thin PRE-BUILD(O4) / full LATER |
| E6 | Touch-first wiring + low-end static fallback — edge cases or MODAL? (beginner §9 #18) | **MODAL (blocking)** for the teen / 9–12 classroom device (touch + low-end Chromebook); treat as required for O4, not optional. | O4 | PRE-BUILD(O4) |

### F — Persistence & architecture (the load-bearing seams)
| # | Decision | Recommendation | Blocks | Pri |
| --- | --- | --- | --- | --- |
| **F1** | **The ONE seeding convention** — `designHash` formula + PRNG family, signed off across probe/econ/product-sim. | `mulberry32`+`xmur3`; `designHash = fnv1a32(canonical-netlist) XOR contractId XOR fidelityMode XOR fundedQualityLevel`. **Never** `SEED=1337`, never `snapshot_hash`, never two PRNG families. | P0a (all seeded work) | BLOCKER |
| **F2** | Persistence key & versioning | Sibling key **`cec.game.v1`** + `GAME_VERSION`; `BoardBlob.contract?`; degrade to `DEFAULT_GAME` on corrupt, never throw; **a malformed/absent `BoardBlob.contract` degrades to no-active-contract (the board still loads)**; independent of `cec.settings`. | P0a | BLOCKER |
| F3 | `competenceDetected` definition | Sticky boolean; trigger set = full-bin open · Tier-II arm · value-popover edit · expert hotkey · explicit skip. Help-handle un-sticks. **Non-persistent** (derived). | O3, A1 | PRE-BUILD(O3) |
| **F4** | **By-feel pays the same Lux as numeric** — one ruling across probe/fundamentals/onboarding. | **Yes** — by-feel and numeric read the identical hidden netlist, retire the same `seenConcepts` entry, pay the same Lux. | O2 | PRE-BUILD(O2) |
| F5 | EMI gate dependency | `emiChamber` is a **typed stub returning `'unavailable'`** until the external kernel lands; gates nothing else. | PS3b | LATER |
| F6 | Recession trigger weighting — does the first SHIP-IT alone retire the fundamentals family with INCOMPLETE `seenConcepts` (a recipe-copy clear)? (fundamentals §10 #1) | **No** — the SHIP-IT leg is gated `AND seenConcepts ⊇ FUNDAMENTALS_IDS`; the unconditional retire is `unlockNode('era1-tolerances')` OR the full concept set. | O2 | PRE-BUILD(O2) |

---

## 2. The MASTER IMPLEMENTATION PLAN

All work is **web-side only**. The Rust gates (`cargo fmt/clippy/test` incl. `run_is_reproducible` + `golden_snapshot_hash_is_stable`) stay **GREEN UNCHANGED** in every phase — that invariance is the proof of golden-safety. Web gate shorthand below = `pnpm run build:wasm · pnpm -C web check · pnpm -C web lint · pnpm -C web build · pnpm -C web test`.

**The smallest fun slice** — a working blow-up → fix → graded SHIP-IT — is reachable at **P0a + P0 + O1**. The demo spans two circuits: the `led-blowup` blow-up (O1) and the divider grade (P0); the "resistor fix" beat is the existing **`led-limit`** current-limiting example. Ship those first for the playable demo, then walk the spine.

### Phased milestone table

| # | Phase | What ships | Depends on | Golden-safety note | Verification gate (+ new vitest) | Panel(s) |
|---|-------|-----------|------------|--------------------|----------------------------------|-------------------|
| **0** | **P0a — Shared substrate** ⭐ROOT | The ONE seed convention (`mulberry32`+`xmur3`; `designHash`); `econ/state.ts` (GameState + DEFAULT_GAME + GAME_VERSION + pure reducers); `storage.ts` sibling key `cec.game.v1` + `BoardBlob.contract?`; the **'JP' judgement part** (named pads OUT/LOAD/RAIL/SENSE/GND, tick-pure stimulus) | nothing (foundation) | Seed is web-side, never `SEED=1337`, never `snapshot_hash`. JP is a tick-pure fixture → replays byte-identically. Versioned key degrades to DEFAULT_GAME on corrupt, never throws; independent of `cec.settings`. | web gates; **vitest:** reducers pure; JP board replays bit-identically; seed→same instance | ECON |
| **1** | **P0 — Grader + first SHIP-IT** | Value-aware **general `SpecLine[]` grader** (`econ/grader.ts`; PinAddr→snapshot index at grade time, window-slice, reduce verbs, target ±tol) — built ONCE; SHIP-IT count-up over the `loop.ts` scrubber on the divider (one fixed seed) | P0a | Reads `electricalMap` (already-batched, unhashed). Sits **beside** `graphShape`, gates **only** specMet, **never** flips `complete`/`buildDone`. No new wasm crossing. | web gates; **vitest:** in-ratio divider passes / values-in-wrong-rail fails; **for every `EXAMPLE_CATEGORIES` entry, `graphShape` is unchanged and `complete`/`buildDone` fire identically with the grader present vs absent** | PROBE, ECON |
| **2** | **PS1 — Reliability report card** ║parallel║ | `reliability.ts` stress→FIT→yield→RMA chain + Poisson sampler (canonical element-index draw order) + fleet-grid + RUN-SHIPPED cascade + failure-mode codex + Probe narration | P0 spine + P0a seed | Pure web-side sampler over unhashed margins; no new physics, no new currency. Real-mode-gated (Ideal: yield 100%, FIT~0). Wall-clock only for animation. | web gates; **vitest:** dark-dot count == round(field-fail%·N); sampler order reproducible | PROD |
| **3** | **O0 — Fundamentals migration** ║parallel║ | `concepts.ts` re-key CONCEPTS+CONCEPT_ORDER → 7 **FUNDAMENTALS_IDS** (place, wire, loop-ground, carriers, colours, voltage, current); one-time legacy-id migration on load; per-concept descriptor + separate TRIGGERS predicate map | existing concepts.ts + seenConcepts + storage | Re-keys the SAME `seenConcepts` set (no new state class); legacy ids migrated so returners aren't re-taught. Predicates read-only over the snapshot. | web gates; **vitest:** legacy-id migration; TRIGGERS pure over snapshot | FUND |
| **4** | **O1 — Cold-open blow-up + Probe persona** | **magic-smoke-over-FAIL** (particle pool + charred tint + `wasFailed` edge-bit, fire-on-Run); `led-blowup` ExampleSpec; Probe sprite + idle-bob (reduced-motion stilled); reduced-motion substitute | P0a; existing FAIL freeze loop, onMount load-PAUSED | Rides the **unhashed** FAIL flag; animation wall-clock (run frozen at FAIL). Two transient renderer-only flags, reset on rebuild, none hashed. No new boundary call. | web gates; **vitest:** wasFailed edge-detect; led-blowup replays bit-identically | PROBE, FUND(rides) |
| **5** | **P1 — Seeded generator** | `econ/generate.ts` (seeded θ + K=8 satisfiability on a **separate offscreen scratch Simulation**) + `econ/contracts.ts` schema/FSM + `templates/{fixedRail,rcTiming}.ts` | P0 grader; P0a seed | Per-attempt seed web-side `mulberry32`. Satisfiability sim is its own throwaway hash, never compared to golden, never the player board. | web gates; **vitest:** seed→same instance→same grade; satisfiability cached | PROBE, ECON |
| **6** | **P2 — Tech-tree + gating + Reveal Engine** | `data/techtree.ts` NODES (era0→7; Era5 two sub-nodes, **logic first**) + `econ/progression.ts` (canUnlock/unlockedTags/`unlockNode` — the only Lux debit); bin grey-gating; first-Lux; `econ/reveal.ts` **folded** into the concept-card drain; `gameState.svelte.ts` store; exam wall **Era-4-only** | P1; P0a state; existing PARTS tags | Gating is a **placement-UI filter**, NEVER a solve filter — a loaded board with a locked part solves identically. Firewall data-enforced (no Credits→Lux). Reveal persists in `cec.game.v1`. | web gates; **vitest:** every PARTS tag in exactly one node/Era0; canUnlock enforces prereqs+Lux+exam; no Credits→Lux | ECON, FUND(seam) |
| **7** | **O2 — Fundamentals scaffold + by-feel** | Per-concept show-don't-tell lessons; pin-reveal + next-edge ghost; **by-feel target renderer** (notched `voltageColor` bar/standpipe; notch IS the seed); recession wiring (hard retire at `unlockNode('era1-tolerances')`) | **O0, O1, AND P2's `unlockNode('era1-tolerances')`**; first-Lux | Presentation over Build engine + unhashed snapshot. By-feel and numeric read the **identical** hidden netlist; both pay one `seenConcepts` + same Lux **(F4)**. Recession reduces PUSH, never reachability. | web gates; **vitest:** by-feel/numeric retire same concept + same Lux; recession trigger | FUND, PROBE(by-feel) |
| **8** | **P3 — Offer queue + anti-grind** | OfferQueue store + difficulty band (continuous [0,1], +2nd spec line at d>0.6) + per-seed decay (`max(0.1, 0.25·0.5^(n-1))`) | P2 | Web-side numbers feeding ordinary values; decay floors at 0.1; `claimedLux` dedups Lux→0. No snapshot_hash touch. | web gates; **vitest:** decay floors at 0.1; band scaling | ECON |
| **9** | **O3 — Curriculum ramp + Probe coaching** | RAMP table beside EXAMPLE_CATEGORIES; dismissible "try this next →" / OFFER chip; `coaching.ts` registry; **competence-fade** (`competenceDetected` — sticky, Help-handle un-sticks) | O2, P2; ECON first-contract | Content + a derived **non-persistent** boolean; no new persisted coaching state beyond `explainAsYouGo`+`seenConcepts`. Chip is a PULL, never gates Run. | web gates; **vitest:** ramp de-dupe via seenConcepts; competence trigger set | PROBE, ONBOARD |
| **10** | **P4 — Lab Notebook + eureka** | `econ/labNotebook.ts` (~4 detectors: rectification/ripple/brownout/latch) + eureka writes + eureka discounts into canUnlock; sticker-book codex skin | P2 (Lux/reveal); P0 sampler | Detectors are samplers over the unhashed replay; never write BoardGraph/netlist. **Determinism review for any `node_v` detector.** | web gates; **vitest:** detector fires on golden replay; reads unhashed only | ECON |
| **11** | **PS2 — Funded quality + protection** | `QualityBudget` allocator (4-level) + `protectionPresent(graph)` collapse | PS1; protection spec | Multiplies ONLY infant-mortality + yield. `protectionPresent` reads `graphShape` + kind/variant (topology-only). Post-hoc multiplier, no fleet re-roll on refund. | web gates; **vitest:** protectionPresent topology recognition; budget multiplies only infant terms | PROD |
| **12** | **PS3a — UL gate** | `ulLab` (over-temp + protection-present + coarse per-net creepage) + fix-it-report shell + `lifeMultiplier` coupling (clamp 0.6..1.0; **worse-of** EMI/UL) | PS2 | Gate verdict is `sign(limit − measured)` — no PRNG. A FAIL blocks only the SHIP offer, never the sandbox. Coarse creepage until geometry kernel. | web gates; **vitest:** gate verdict = sign(limit−measured); FAIL blocks only ship | PROD |
| **13** | **PS4 — Reputation + recalls** | Reputation track + bands + recall event (systemic-share ≈40% **AND** s>1) + magic-smoke→autopsy→Lux flip | PS1, **P4** (autopsy↔notebook) | Reputation is a gauge (unspendable/unbought/decaying), golden-irrelevant. Autopsy pays the existing non-purchasable Lux, dedup'd. Recall flood respects reduced-motion + sensitive-child guard. | web gates; **vitest:** recall trigger floors; autopsy Lux dedup | PROD |
| **14** | **O4 — Accessibility + retention cluster** | Axis 2 motion (FLOW_HZ settable, CALM default); Axis 3 colour-vision (`railPatterns` paired); Axis 4 voiced Probe (SpeechSynthesis, captions=card); Axis 5 input (tap-to-wire, coarse hit-areas, keyboard); Axis 6 low-end fallback; Axis 7 aria-live ~2 Hz; Axis 8 i18n string table (one id space); PREFERENCES cluster | O3; TTS/rail-pattern/aria-live owners | Presentation + local state. Flow clock never feeds the sim (slow/freeze bit-identical). Input produces the SAME BoardGraph a mouse would. **Determinism review for any `node_v` aria detector.** | web gates; **vitest:** reduced-motion = bit-identical; aria-live reads electricalMap only | ONBOARD, FUND |
| **15** | **P5 — Standing + bonus tiers** | Standing scheduler (re-grade on tick-pure `conditionProfile(tick,seed)`) + bonus-tier multipliers (bronze/silver/gold) + greyed CEC-Certified | P3; reputation (PS4) | `conditionProfile` is a tick-pure θ-walk, never wall-clock; advances by integer run-interval-index. Persist OUTCOME not just seed. CEC greyed (needs deferred Monte-Carlo). | web gates; **vitest:** standing re-grade tick-pure; bonus tier derivation | ECON, PROD |
| **16** | **PS3b — EMI gate** 🔒EXTERNALLY BLOCKED | `emiChamber` + `emiLimitMath` + EMI fix-it report | **the invisible-electronics kernel (`coupling.ts`/`spectrum.ts`/`geometry.ts`) — ABSENT today** + PS3a | Until the kernel lands, a **typed stub returns `'unavailable'`** — no sim-core change. AC-only reads unhashed; transient golden untouched; Real-mode-gated. | web gates; **vitest:** stub returns 'unavailable' (until kernel) | PROD |
| **17** | **PS5 — Richer reliability** | Counterfeit / supplier-grade risk + true `geometry.ts` integer creepage + full tolerance-driven yield + MTBF standing contracts + CEC-Certified Monte-Carlo | P5; partly the geometry kernel | Web-side, Real-mode-gated; partly blocked on the geometry kernel; CEC grey until the Monte-Carlo bench lands. | web gates; **vitest:** yield = 1 − escape − (1−cov)·latent | PROD |

### Critical path

**The spine: `P0a → P0 → P1 → P2 → O2`.** The economy contract loop is the backbone every other panel consumes. `P0a` is the single root; `P0`'s grader is the shared surface; `O2`'s hard-retire **cannot close** until `P2` ships the `unlockNode('era1-tolerances')` signal. Smallest-fun-slice is reachable at **P0 + O1** — ship those first, then continue down the spine.

### Runs in parallel

- **PS1 report card** (phase 2) — reads existing heat + ratings + electricalMap; needs only P0's spine, blocks nothing on the teaching track. Earliest parallel product-sim win.
- **O0 fundamentals migration** (phase 3) — rides today's `concepts.ts` + render; needs neither P0a nor O1. Buildable immediately; only its **read-deeper rungs** consume Lux/predict-then-reveal, so those rungs gate behind P2 (resolved by sequencing O2 after P2).
- The **product-sim PS chain** (PS1→PS2→PS3a→PS4) runs as a lane alongside the onboarding lane (O1→O2→O3→O4) once both branch off P0.

### The shared grader + seed — build once, do NOT fork

The value-aware grader is specced in PROBE §3b but **implemented exactly once** as the general `econ/grader.ts` `grade(spec: SpecLine[], …)` in **P0**. PROBE, ECON, FUND, the by-feel renderer, the PS-cert gates, and the Notebook detectors are all **read-only consumers**. Likewise **one** seed mechanism (`mulberry32`+`xmur3`; `designHash = fnv1a32(canonical-netlist) XOR contractId XOR fidelityMode XOR fundedQualityLevel`) serves the anti-copy generator (P1), the daily/offer contracts (P3), the by-feel notch (O2 — the notch height **IS** the seed), and the fleet Poisson draw (PS1). Never `SEED=1337`, never `snapshot_hash`, never two PRNG families. Quality refund is a **post-hoc multiplier**, not a fleet re-roll.

### The EMI-kernel block

**PS3b (EMI gate)** is the **only** item blocked outside this web-side plan — on the invisible-electronics kernel (`coupling.ts`/`spectrum.ts`/`geometry.ts`), confirmed absent today. It gates **nothing else**: report card, funded quality, protection, UL, reputation, and recalls all ship unblocked, and `emiChamber` is a typed stub returning `'unavailable'` as a fast-follow until the kernel lands. The same kernel later gates **PS5**'s true-geometry creepage (coarse lookup suffices through PS3a).

---

## 3. The dependency graph (what-blocks-what)

```
                         ┌─────────────────────────────────────────────┐
                         │  P0a  Shared substrate  ⭐ROOT               │
                         │  (seed convention · state.ts · cec.game.v1 · │
                         │   JP judgement part)                         │
                         └───────┬───────────────────────────┬─────────┘
                                 │                            │
                    ┌────────────▼───────────┐                │
                    │  P0  SpecLine grader    │                │
                    │  + SHIP-IT (built ONCE) │                │
                    └───┬─────────┬───────┬───┘                │
          ┌─────────────┘         │       └──────────┐         │
          ▼                       ▼                  ▼         ▼
   ┌────────────┐         ┌──────────────┐    ┌───────────┐  (O0 needs
   │ PS1 report │║parallel║ O1 cold-open │    │ P1 seeded │   neither —
   │ card       │         │ blow-up +    │    │ generator │   parallel)
   │ (reads Tj) │         │ Probe persona│    └─────┬─────┘
   └──┬─────────┘         └──────┬───────┘          │
      │                          │                  ▼
      ▼                          │           ┌──────────────────────┐
  ┌────────┐                     │           │ P2 techtree+gating+   │
  │ PS2    │                     │           │ Reveal Engine         │
  │ quality│                     │           │ (unlockNode source)   │
  └──┬─────┘                     │           └───┬──────────┬────────┘
     ▼                           │               │          │
  ┌────────┐                     │ ┌─────────────▼──────┐   │
  │ PS3a UL│                     └─┤ O2 fundamentals    │   │
  └──┬─────┘                       │ scaffold + by-feel │   │  (needs O0+O1
     │   ╔══════════════╗          │ (HARD-RETIRE needs │◄──┘   AND P2's
     │   ║ PS3b EMI gate║          │  era1-tolerances)  │       unlockNode)
     │   ║ 🔒 BLOCKED on║          └────────────────────┘
     │   ║ EMI KERNEL   ║                  │
     │   ╚══════════════╝          ┌───────▼────────┐   ┌──────────┐
     │                             │ O3 ramp +      │   │ P3 offer │
     ▼                             │ coaching +     │◄──┤ queue +  │
  ┌────────────┐                   │ competence-fade│   │ anti-grind│
  │ PS4        │◄──────┐           └───────┬────────┘   └────┬─────┘
  │ reputation │       │                   │                 │
  │ + recalls  │   ┌───┴────┐      ┌───────▼────────┐  ┌─────▼──────┐
  └────────────┘   │ P4 Lab │      │ O4 a11y +      │  │ P5 standing│
                   │ Notebook│      │ retention      │  │ + bonus    │
                   │+ eureka │      └────────────────┘  └─────┬──────┘
                   └────┬────┘                                │
                        └──► PS4 autopsy↔notebook        ┌────▼─────┐
                                                          │ PS5 rich │
   EMI KERNEL (coupling/spectrum/geometry.ts) ──────────►│ reliab.  │
        (external — also gates PS5 true creepage)         └──────────┘
```

| Edge | Blocker → Blocked | Why |
| --- | --- | --- |
| spine | P0a → P0 → P1 → P2 → O2 | state+seed+JP → grader → generator → tree/unlockNode → scaffold hard-retire |
| cross-panel | P2 `unlockNode('era1-tolerances')` → O2 recession | by-feel/scaffold **cannot retire** without the Era-0→1 signal |
| cross-panel | P4 ↔ PS4 | autopsy↔notebook share the eureka/Lux flip |
| external | EMI kernel → PS3b, PS5(creepage) | the invisible-electronics kernel is absent today |
| parallel-OK | P0 → PS1, P0a → O0 | no spine dependency beyond root — early wins |

---

## 4. Reuse inventory vs net-new build inventory

| Reuse — existing machinery to wire into | Net-new — modules/files/symbols to build |
| --- | --- |
| `flag_and_clamp_fails` / `failed_elements` (unhashed) / `RATED_CURRENT_SLOT`; `board.ts` FAIL box freeze | `econ/state.ts` (`GameState`, `DEFAULT_GAME`, `GAME_VERSION`, pure reducers) |
| `electricalMap` + `graphShape` (`netlist.ts`) | `econ/grader.ts` (`grade(spec: SpecLine[])`, `SpecLine`, `PinAddr`) — **built once** |
| Tj heat model | `econ/generate.ts` (seeded θ + K=8 satisfiability on offscreen scratch `Simulation`) |
| `FLOW_HZ` flow/carrier render; `voltageColor`; standpipe magnitude bar | `econ/contracts.ts` (schema + FSM); `templates/{fixedRail,rcTiming}.ts` |
| Build engine (`startBuild`/`advanceBuild`, guided-open/done flip) | `econ/data/techtree.ts` (NODES) + `econ/progression.ts` (`canUnlock`/`unlockedTags`/`unlockNode`) |
| Armed ghost + pin snap-ring; value picker; incomplete-circuit "—" | `econ/reveal.ts` (folded into concept drain); `gameState.svelte.ts` store |
| Info drawer / value popover / `partInfo.ts` | `econ/labNotebook.ts` (~4 detectors); eureka writes |
| **`concepts.ts`** (`CONCEPTS`/`CONCEPT_ORDER`/`offerConcept`/`pumpConcepts`/`seenConcepts`) — re-keyed | **FUNDAMENTALS_IDS** re-key + `TRIGGERS` predicate map; legacy-id migration |
| `storage.ts` (`seenIntro`/`explainAsYouGo`/`seenConcepts` + board save) | `cec.game.v1` sibling key + `BoardBlob.contract?` |
| `PARTS` (tier I/II tags + category) + `PART_KINDS`; `EXAMPLE_CATEGORIES` | the **JP judgement part** (named pads); `data/balance.ts` (all econ + PROD constants) |
| `PULSE→ELEM_ACSOURCE`, `SHUNT→ELEM_RESISTOR` (tick-pure stimulus idioms) | `reliability.ts` (stress→FIT→yield→RMA + Poisson sampler + fleet grid); `QualityBudget`; `protectionPresent`; `ulLab`; reputation/recall; `emiChamber` (stub) |
| `ac_sweep` / `acMeasurements` (AC-only, unhashed) | by-feel target renderer (notched bar/standpipe); `coaching.ts` registry; `railPatterns`; i18n string table |

---

## 5. Golden-safety & determinism checklist

**The invariant every phase preserves:** nothing touches `crates/sim-core`, netlist emission, or `snapshot_hash` (golden `0xeaac…fa24`). The proof is mechanical — **the Rust gates stay GREEN UNCHANGED**:

```
cargo fmt --all -- --check
cargo clippy -p sim-core -p sim-protocol --all-targets -- -D warnings
cargo test -p sim-core -p sim-protocol      # incl. run_is_reproducible + golden_snapshot_hash_is_stable
```

Per-phase web-side invariants (each must hold before a phase is "done"):

- [ ] **Grading reads the existing batched snapshot only** — `electricalMap` + the `state` Float64Array, unhashed; no per-component or per-message boundary call. The JS↔wasm boundary stays coarse (one batched read/frame).
- [ ] **All new state is web-side** — `cec.game.v1` (sibling of `cec.settings`), never serialized into the sim, never into `snapshot_hash`.
- [ ] **Seeds are web-side PRNGs** — `mulberry32`+`xmur3` only; never the sim `SEED=1337`, never two PRNG families, never `snapshot_hash` as a seed.
- [ ] **Gating is a placement-UI filter, never a solve filter** — a loaded board with a locked part solves bit-identically.
- [ ] **Real-mode-gated non-idealities** — reliability/cert/quality bite only in Real mode; Ideal ships nominal.
- [ ] **Tick-pure where it crosses time** — the JP stimulus, `conditionProfile(tick,seed)`, and the standing re-grade advance by integer interval-index, never wall-clock; animation may use wall-clock only because the run is frozen / the value is non-outcome.
- [ ] **Determinism review required** for any detector that reads `node_v` (Notebook detectors, aria-live detectors).

**The CLAUDE.md verification gates each phase must pass** (the web gates are where each phase's work lands, each adding vitest):

```
pnpm run build:wasm
pnpm -C web check
pnpm -C web lint        # run pnpm -C web format first
pnpm -C web build
pnpm -C web test        # vitest — each phase adds the coverage named in its table row
```

---

## 6. Risks, sequencing traps & scoping cuts

| Trap | Where it bites | Mitigation |
| --- | --- | --- |
| **The shared grader/seed gets forked.** PROBE specs a single-Vout `specMet`; if each panel grows its own, three graders + three PRNGs drift and determinism rots. | P0 → all consumers | **Build the grader and the seed convention ONCE in P0/P0a** (B2, F1). Every later panel is a read-only consumer. Stated twice in this doc on purpose. |
| **Fundamentals read-deeper rungs gated on unbuilt Lux.** O0 looks fully parallel, but its predict-then-reveal rungs need first-Lux, and O2's hard-retire needs `unlockNode('era1-tolerances')` from P2. | O0/O2 ↔ P2 | Sequence the **migration** (O0) early/parallel, but the **read-deeper rungs + recession** (O2) only after P2 ships `unlockNode`. The graph edge is explicit. |
| **The EMI kernel.** PS3b looks like a normal product-sim phase but is blocked on an absent external kernel. Building it inline stalls the whole PS lane. | PS3b | **Typed stub returning `'unavailable'`** (F5); PS3b is a fast-follow. It gates nothing else — the PS lane ships PS1→PS2→PS3a→PS4 around it. |
| **Balance-before-fun.** Tuning every FIT/RMA/decay/difficulty constant before the slice plays is wasted motion against numbers that will move. | C1, C2, C3, D1, D3 | **One `data/balance.ts`** sheet; defer the sweep to *after* the vertical slice (P0+O1) plays. Mark all balance rows TUNING, not BLOCKER. |
| Quality refund re-rolls the fleet (looks fair, breaks reproducibility). | PS2 | Refund is a **post-hoc multiplier**, never a fleet re-roll. |
| Reveal Engine as a second loop competes with the concept-card drain. | P2 | **Fold** it into the one-per-frame drain (B4). |

**The first vertical slice — cut everything else.** Ship **P0a + P0 + O1** = blow-up → fix with a resistor → graded SHIP-IT on the divider, one fixed seed. That is the smallest fun, fully golden-safe, planning-complete slice. Defer to fast-follow: the seeded generator (P1), the tech tree (P2), the entire PS chain except a non-interactive PS1 report card, all of O2–O4, and every balance number. Build the slice, watch it play, *then* tune `data/balance.ts` and walk the spine.
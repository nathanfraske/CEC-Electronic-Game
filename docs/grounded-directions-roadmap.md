<!-- SPDX-License-Identifier: Apache-2.0 -->

# Grounded directions — the bridge from the idea well to a real plan

Status: **grounding synthesis** (no code). This is the producer's-eye reconciliation of five
grounding panels (sim/physics, gameplay modes, teaching/tools, content/social, platform/wild)
that each triaged the ~250-idea well in `docs/divergence-idea-bank.md`. The divergence panels'
job was to generate without a filter; this doc's job is the opposite — to judge every promising
idea against three walls and keep only what survives all three.

## How to read this

Each verdict here was forced through **three filters**, and an idea has to clear all three:

1. **Can the engine actually do it?** The committed core is a deterministic, fixed-step
   (`DT = 2 µs`) lumped MNA solver with bounded Newton, backward-Euler companions
   (`reactive_state[]`), a 5-terminal `Element` carrying a `[f64;4]` `params` block, and a
   four-state digital kernel on top (`docs/reality-roadmap.md`, `crates/sim-core/src/lib.rs`).
   Three golden-safe levers are proven and pre-decide most verdicts: a **zero param slot is the
   kind-default** (`param_or` → bit-identical), **ratings only flag** (`failed_elements` is
   unhashed), and the **`inv_dt` charge hook** (0 at DC, `1/DT` transiently) is the generic seam
   for new reactive terms. The hard walls are non-negotiable (`docs/sim/fidelity-ceiling.md`):
   **no adaptive Δt, no distributed-EM/RF time-domain solve, no VLSI-scale nets.** The standing
   escape hatch is *"push physics into the picture, not the solver."*
2. **Does it teach electronics for real?** Not "is it a teaching-shaped feature" — does it move
   *understanding*, ideally by killing a named misconception or surfacing a conserved law the
   solver already balances. A virtuous-feeling feature that doesn't move understanding is the
   most seductive kind of clutter.
3. **Does it fit the committed game?** The spine is settled (`docs/game-design-master-brainstorm.md`):
   **contracts-as-purchase-orders** is the transactional spine, **sandbox is the always-present
   substrate**, the **reality dial is the difficulty axis**, the **two-currency firewall**
   (Credits = breadth, Lux = depth) plus **Reputation-as-standing** is load-bearing, and the
   **sim is the sole judge** (no hand-authored puzzle logic). The biggest single gap is that
   there is **no publish/discover surface**; the biggest single dependency is that the
   Exchange / rosters / daily seeds need a **backend the static-wasm app lacks** (the call is
   file-based / offline-first MVP first).

"Grounded" does **not** mean "only safe." The moonshots (§4) genuinely bend a wall and are
funded as time-boxed spikes because their *kernel* is engine-native. The cuts (§5) are killed
with a one-line honest reason, not buried.

**The single highest-order finding across all five slices:** the readiness is concentrated in a
**small number of reusable mechanisms, not in 30 parts or 30 modes.** Build a handful of seams —
the external-input channel, the web-side thermal node, the replay/netlist codec, the
seeded-fault-on-a-reference-netlist — and dozens of "ideas" fall out as content or a UI gate
flip. The discipline of this roadmap is to fund *mechanisms*, then harvest *domains*.

---

## 1. The recommended slate (NOW / NEXT)

A slate, not a wishlist. Every entry is high-value **and** feasible **and** reinforces the
existing spine, and each rides one of a few shared primitives so they compound. Effort is
S / M / L in eng-weeks-ish. Ordered so that the **mechanism unlocks come before the domains that
cash them out.**

### NOW — the spine multipliers and the cheap mechanism seams

These are the things that make everything after them cheaper, plus the near-free pedagogy wins
that sharpen the predict→Lux loop the game already runs on.

| # | Idea | Slice | Effort | The one-line case |
|---|---|---|---|---|
| 1 | **The Replay/Netlist Codec** (`.cecr` / `.cecn` as documented, versioned formats) | platform | S–M | The artifact already exists in `sim-protocol`; formalizing it makes *every* async-social, teardown, embed, and interchange idea downstream-cheap. The highest-leverage plumbing in the whole bank, zero sim risk. **Build before anything social.** |
| 2 | **Debugging-as-a-verb** (seeded fault on a reference netlist → probe → fix) | gameplay | M | The corpus already commits this as the *second core verb*. A near-working board with one deterministic flaw, surfaced by the existing FAIL/heat/brown-out symptoms. It is the missing half of the inner loop, not a fork — and §II's whole detective season plus §III.F repair pedagogy come free once it exists. |
| 3 | **The Wager Strip** (one-tap higher/same/lower before every Run; reveal overlays guess on truth) | teaching | S | Predict-then-reveal is the documented highest-yield learning act and the named Lux source; typing is the friction that kills it; one tap removes it. A UI layer over *every* mode, zero engine. The cheapest learning-gain in the bank. |
| 4 | **KCL/KVL X-Ray** (tap a node → currents-in/out summing arrows; tap a loop → drops tiling to zero) | teaching | M | The solver *already balances these books* (per-element I, per-net V are live); this surfaces the conservation law it enforces invisibly. Kills the deepest misconception ("current gets used up"). Pure Layer-2 readout, golden-safe — the clearest learning-gain-per-effort win in the bank. |
| 5 | **Ideal-vs-Real A/B split-replay** (run the identical netlist at two reality levels, overlay, caliper the one divergence) | teaching | M | The named signature beat of the whole reality ramp. Because Ideal is byte-identical to today's solve, it is the instant-replay juice run twice; the one-cause-per-rung structure is what makes the divergence diagnosable. This is the teaching *engine*, not a feature. Prioritize with the dial. |
| 6 | **The external-input / Sensor Bench channel** (UI-driven scalar per element, default 0) | sim | M | The single highest-leverage new-domain mechanism: one channel → a whole catalog (LDR, photodiode, thermistor-exists, strain gauge, Hall, mic). Golden-safe (default 0). **Determinism caveat: a *scripted/contract* input hashes; a free slider does not — keep graded inputs tick-pure.** Build the channel, get the Sensor Garden as content. |
| 7 | **The web-side thermal node (`Tj`)** (a tick-driven `Tj` integrator riding the value signature) | sim | M | The highest teaching-per-engine-work item on the list. `Component.temp` exists, thermistor R(T) is factored, rating→FAIL is wired; Path-1 (web-side) needs **zero sim-core change and zero golden move**. Heat, derating, drift, runaway, magic-smoke all fall out of `P=V·I` honestly. Defer the hashed `Tj` (Path 2) until gameplay proves it. |
| 8 | **Colorblind-safe rail encoding** (pair every rail hue with a pattern/texture) | teaching | S | Not optional — the visual-language doc itself warns the wire-code must read without hue, and the whole magnitude channel rides color. Correctness, cheap, finishes a known gap. |

### NEXT — the domains and social loop those seams cash out

These are clear wins that wait on one of the NOW items (the codec, the thermal node, the
sensor channel, or the debugging verb) or on the backend decision.

| # | Idea | Slice | Effort | The one-line case (and its prerequisite) |
|---|---|---|---|---|
| 9 | **The Bench Exchange — file-based MVP** (publish / discover / fork a sealed chip as a `.json` module) | content | M | The biggest gap in the game; the file-based core needs *zero* backend (the `web/src/lib/circuits/` pattern already proves it). Importer re-verifies the manifest → no moderation tax. **Needs:** the Codec (#1). Hosted registry is a separate, explicit scope call. |
| 10 | **Fork-this-chip with lineage** (open the box, edit, re-seal) + **self-rendering datasheet** (the listing *is* the five-tier glyph) | content | M / S | The on-brand killer feature and *the* skill the game teaches; the zoom-to-open renderer + glyph spec already exist, so a fork is open→edit→re-seal and a listing is the glyph card for free. **Needs:** flatten-on-publish folded into the determinism contract. |
| 11 | **Mutators / Ascension Rails + the Constraint Dojo** (fog-of-war schematic, lying meter ±5%, no-electrolytics, +1 reality rung, One Rail, Five Parts, No-ICs Monastery) | gameplay | S–M | Each is *one boolean* in `buildNetlist` or the bin filter; together they give every mode a hard-mode and the reality dial a difficulty multiplier for free — exactly the corpus's "difficulty dial IS the reality level." Highest teaching-per-byte cluster (scarcity forces level-shifters, charge pumps, discrete logic). |
| 12 | **Optocoupler + photodiode/PV + solar/MPPT** | sim | M | Sits directly on the light channel (#6); the photodiode is the canonical receive part. Isolation barrier needs the floating-component GMIN (already specced, golden-safe). Teaches galvanic isolation / CTR / why your scope ground floats. **Needs:** #6. |
| 13 | **Saturating-core inductor → closed-loop SMPS + inrush/soft-start** | sim | M / S–M | "The diode, again": a nonlinear `L(I)` collapsing above a knee, reusing the existing Newton + `inv_dt` machinery; default knee = ∞ → golden-safe. The reason flyback converters explode and the prerequisite for honest SMPS. The closed loop is mostly composition (the latched comparator type 23 exists) + a phase/gain-margin overlay on the existing Bode (unhashed). **Pairs with:** #7 (saturation → I²R → heat). |
| 14 | **Time-to-Failure scrubber + Symptom→Cause decision tree** (auto-rewind to last-good, scrub forward to watch the failure form; guided "is it sagging? hot? stuck?") | teaching | S / M | Rides the FAIL mask + deterministic replay (both exist). Teaches *precursor signs* and a debugging *method* — the hardest, most transferable bench skills. The autopsy→Lux loop already wants this. **Needs:** #2. |
| 15 | **Teardown / reverse-engineer mode + Chip Archaeology daily** (locked published chip, submit a behavioral replica; daily seeded black box, share your probe trace) | content | M | The IC maker *inverted* — every piece exists (pin-grader + zoom-to-open + the daily seed is a static rotating constant offline). Teaches characterization, the most transferable skill; "stump the world" gives builders a creator niche. **Needs:** #1; **shares an engine with** #2. |
| 16 | **Design Duels + Co-Watch Scope** (async PvP on a seeded contract, replay-verified; annotation pins on a replay timeline) | content | S–M / S | Rated very-high feasibility / nearly-free: async + deterministic = no netcode for the core loop (compare two exported replays). The cheapest competitive on-ramp; pins are metadata on the replay. **Needs:** #1. |
| 17 | **Datasheet Reputation + dependency-count rep** (author writes the marketing spec, importer's sim stamps VERIFIED/OPTIMISTIC/FRAUDULENT; rank by *dependents*, not stars) | content | S–M / S | The manifest-honesty mechanic made a game — over-claiming earns a computed scarlet letter, not a moderator's. Dependency count is the one rating channel that resists gaming (a verifiable edge in the expansion graph). **Needs:** #9. |
| 18 | **Superposition Solo + Sensitivity Halos + Circuit Narrator** (zero all-but-one source as colored layers; hover a part → ∂V halos; trace the signal path in plain language) | teaching | M / M / M | All three are golden-safe re-solves or pure netlist+`plain()` readouts (superposition is exact for linear nets; perturbation is a nudge-and-diff; the narrator is graph + per-part strings). Each teaches a foundational technique by *doing* it. The Narrator is the novice's missing *reading order*. |
| 19 | **Standing-contract pacing as the honest idle texture** (a scheduler over the replay paying ₵/interval while the design holds spec under a walking load) | gameplay | M | NOT a new idle game — the already-committed Clock-2 standing contract. The one "idle" that's honest because it's the actual sim under a seeded load. Teaches why real boards carry margin/decoupling. |
| 20 | **Headless Grader container + Embeddable `<iframe>` + PWA** | platform | S / S–M | The core is *already* browser-free host-tested, so the grader is packaging not engineering (unblocks classroom autograding, CI replay grading, signed certs). The `<iframe>` ("the circuit *is* the figure, and it runs") and offline PWA are nearly free over static wasm — the highest teaching-reach-per-effort in the platform slice. |
| 21 | **Export-to-KiCad** (a validated board → real netlist / symbol / footprint) | platform | M | The thesis ("this teaches *real* electronics") made literally true; the element set maps to a netlist already, so it's a serializer, not new physics. The single best, bounded real-world bridge. |
| 22 | **Rubber-Duck Probe + Lux-priced Hint Ladder** (point the AI at a node, it narrates *what the sim says*; deeper hints cost the bonus ceiling) | teaching | S–M / M | The cheap, hallucination-proof floor of "AI tutoring": it reads measured state, never generates physics. The Hint Ladder is the right economic frame for *any* help (hints cost margin, not money). Captures ~70% of the tutor's value with none of the backend/hallucination risk. |

**Why this slate and not more.** Every NOW item is a mechanism unlock or a near-free predict/law
surfacing; every NEXT item cashes out a NOW mechanism or the backend decision. They share four
primitives — the **codec**, the **seeded-fault**, the **gate-flip mutator**, and the
**measurement-readout** — so they compound rather than sprawl: the debugging verb + mutators +
dailies + Exchange multiply into hundreds of hours with no new genre engine and no golden move.

---

## 2. LATER — good ideas that need a foundation first

Named with the specific prerequisite that gates each. None are cut; all are sequenced.

| Idea | Prerequisite that must land first |
|---|---|
| **Battery electrochemistry** (SOC integrator, OCV-vs-SOC, rising internal R, sag) | The web-side thermal-node integrator pattern (#7) — battery reuses that proven discipline rather than inventing a parallel one. |
| **Heat-Flow Lens** (FLIR false-color, heat conducting into neighbors) + **Whole-System Sankey** (watts → work vs heat vs EMI) | The thermal node (#7); the Sankey additionally needs EMI + switching-loss accounting. Don't build the lens before the model. |
| **Electron-Pressure Heatmap** (analogy lens as a continuous pressure field) | Nothing hard — but sequence behind the X-Ray/Narrator novice on-ramp; it extends the analogy lens that exists. |
| **Protocol Decoder Lens / logic-analyzer bus view** (SPI/I²C/UART decode) | NEXT-feasible (the behavioral block type 25 already runs SPI/UART, the four-state scheduler exists); **FPGA-grade setup/hold STA** is LATER, gated behind the multi-rate engine — and it must be *structural integer delay in the digital kernel*, never analog propagation. |
| **The Silicon Hall of Fame** (rebuild 555 / 741 / 6502) + **Chip Museum** | The IC-maker seal + multi-IC composition; 555/741 are M, the 6502 datapath is L (gated on multi-IC composition working). The Museum is the glyph cards the Exchange already renders, arranged. |
| **Worlds-as-presets** (Rover, Pacemaker, Robotics Yard) | Each is feasible *only as* a reality-dial floor + parts subset + stress profile + voice. Build 1–2 as proof that "world = preset"; Robotics Yard additionally needs the mechanical node (a moonshot, below). |
| **Teacher Dashboard / Assign-a-Contract / classroom roster** | The backend decision (replay-clustering and anti-cheat fall out of determinism for free, but rosters/submission need minimal hosting). The grading is local; gate only the hosting. |
| **The three-board Daily / Bench Streak / spaced-repetition retention** | A hosted daily-seed + a *population to retain*. The contract itself is offline; the leaderboard and SR scheduler are the backend-gated part. |
| **BOM Royalties / King of the Footprint / Patent Pool / Errata / EOL** | A mature hosted Exchange with a live dependency graph. Royalties must pay **Credits, never Lux** (firewall). Patent Pool additionally needs careful graph-canonicalization. |
| **Bench Buddy** (full grounded Socratic LLM tutor) | The deterministic-measurement scaffolding (#22) + a backend/LLM. Build the floor first; this is the slice's moonshot, below. |
| **The Synthwave Foundry / Metronome / audio worlds** | The **Ear Lens / audio sink** (see the cross-slice note below). Once audio ships, each is a parts-preset + spectral-distance grader and falls out cheaply. |
| **Native shells** (Tauri/Steam, Gamepad/Deck, Touch-First, Watch widget) | A proven core loop. Distribution polish, not the thing that makes the game good; Touch-First is the most justified (phone reach), still behind the core builder. |

---

## 3. The cross-slice reconciliations (where the panels disagreed or overlapped)

Made explicit, because the producer needs the conflicts resolved, not averaged.

- **The Ear Lens is an unfunded dependency three slices lean on.** Gameplay gates the Metronome
  behind it; content gates the Synthwave Foundry and the creative toys (Lissajous, Demoscene)
  behind it; platform flags it as "nearly free and the most visceral channel." **Resolution:**
  the **Ear Lens is the one non-slate item worth pulling forward as a cheap early spike** (the
  waveform exists; routing a ≤20 kHz node to audio is small). It is a *sim/UI* call (not owned by
  any one of these five slices), but it is the keystone that unlocks an entire content
  constellation, so it should be funded *before* the worlds and modes that depend on it. Until
  it ships, everything audio stays LATER — do not build the dependents first.

- **The debugging verb is claimed by both the gameplay and teaching slices — they describe the
  same feature.** Gameplay frames it as the "second pillar" (seeded fault + rewind scrubber);
  teaching frames it as Sabotage Mode + Time-to-Failure scrubber + Symptom→Cause tree.
  **Resolution:** these are *one* feature (slate #2 + #14). Build the seeded-fault-on-a-reference-
  netlist once; the gameplay "mode" and the teaching "method" are the same engine wearing two
  labels. This is also the same engine as Teardown (#15) — build once, get three features.

- **The AI tutor: teaching and platform agree, and agree on the de-risking.** Both rank the
  full **Bench Buddy** as a real moonshot whose kernel is unique to *this* engine (the LLM sees
  only the deterministic replay's measurements → constitutionally unable to hallucinate physics),
  and both insist the *force-multiplier* version is the cheap deterministic floor
  (Rubber-Duck + Hint Ladder, slate #22). **Resolution:** ship the floor; prototype the ceiling
  separately (§4); and keep **any fallible LLM off the highest-stakes grading path** — the
  "Explain it back" semantic gate is cut for now precisely because a false rejection at the top
  bonus tier poisons the brand promise that *the sim never lies to you*.

- **The backend is the one dependency smeared across a dozen "social" ideas.** Content and
  platform both flag it as the #1 infra dependency and both reach the same call: ship the
  **file-based / offline-first** versions first (Exchange-as-`.json`-module, replay-as-link),
  and make the **hosted layer one explicit, separate scope decision** — not quietly assumed by
  every feature. The slate is sequenced so nothing in NOW requires a server.

- **RF / transmission-line: sim cuts the solver, teaching cuts the spectacle lens — and they
  agree on the survivor.** The lumped wall kills the distributed *solver*; but the frequency
  domain is already analytic and unhashed (no Nyquist limit), so the *lesson* survives as a
  **Smith chart / S-parameter (`.s2p`) display on the existing AC tools** plus an LC-ladder
  "lumped transmission line" content demo. RF lives in the picture and the frequency domain,
  never the time-domain solve. (Teaching separately cuts the 3D **Impedance Terrain** as
  spectacle the existing Bode already teaches — consistent with this.)

- **The "world / city / MMO" framing is cut by content, gameplay, *and* platform in unison.**
  All three independently kill the shared-persistent-world grid (no backend for it, no honest
  continent-scale AC-grid model) while keeping its *verbs* — recall drama, your-work-is-load-
  bearing, sabotage-as-fault-finding — in their cheap async forms. No dissent to reconcile;
  this is a strong, triple-confirmed cut.

---

## 4. Moonshots worth a prototype

Wild but kernelled — each bends a wall, but the *mechanism* is engine-native and reusable. Fund
each as a **time-boxed spike with a single falsifiable question.**

1. **The Mechanical Node — prototype the voice-coil specifically.** *Spike tests:* can a second
   slow backward-Euler companion domain (`ω` from `torque = Kt·I − load`, back-EMF = `Kv·ω`)
   coexist with the analog solve and stay deterministic? The voice-coil is the ideal probe — the
   canonical electrical-RLC ↔ mass-spring-damper 2-port, half-covered by the transformer stamp,
   and it lights up the audio lens. **Sequence it after the thermal node (#7) proves the
   "second slow companion" pattern;** if the new state axis pays off, motors / steppers /
   solenoids / relay-dynamics become content on it. The one moonshot that adds a *sensation*
   (motion, sound) the genre is missing. Hashed state → Real-mode-gated, documented golden regen.

2. **The Replay Theater (seizable live world state).** *Spike tests:* can a viewer take the
   deterministic action+tick stream, pause at frame 4000, fork, and probe the streamer's board
   with their own meters? Genuinely unmatched — *only* determinism enables it. Small spike **if
   the Codec (#1) ships first** (it's a viewer over the artifact). Prototype the **local
   single-replay scrub-fork-probe** experience; defer the streaming/spectator backend. Could
   define the game's identity.

3. **The Bench Buddy (full grounded Socratic tutor).** *Spike tests:* can a prompt-grounded LLM,
   fed *only* the replay's measurements and scoped by the one-cause-at-a-time dial, stay Socratic
   and never assert a physics fact the sim didn't measure? The kernel is real and unique here;
   the risk is prompt discipline + a backend. Prototype *after* the deterministic-measurement
   floor (#22) exists; do not let it gate the slate.

4. **The Memristor / 4th element (`R(q)`).** *Spike tests:* does the "new hashed nonlinear state"
   seam work end-to-end (a nonlinear companion with one hashed charge-integral, reusing the
   diode reverse-recovery `inv_dt`/`reactive_state` machinery almost verbatim, default fixed →
   Real-mode-gated, golden regen as a documented act)? NEXT-tier feasibility, moonshot-tier
   novelty, with its own gorgeous pinched-hysteresis scope signature. Spike it as the *proof of
   the seam* that de-risks a whole class of future depth parts (and the Tube Lens after it).

5. **Hash Hunt (build any circuit whose FNV-1a snapshot-hash satisfies a property).** *Spike
   tests:* is a daily "land the hash in this band / spell these bytes" actually *engaging* (it's
   a determinism flex more than a lesson)? Tiny spike — the hash + a predicate + a daily seed.
   The lightest possible viral toy that *markets the engine's core promise*; judge engagement
   before investing more.

6. **Twin Bench (Arduino-in-the-loop, WebSerial/WebUSB) — fenced.** *Spike tests:* can the game
   drive a real MCU's pins and read its ADC back into a sim net ("domains meet only at the
   pins")? **The honest fence: real hardware is wall-clock/async, so the bridge breaks
   determinism — scope the spike as a sandbox/calibration demo, explicitly outside the graded
   economy.** Within that fence it's the most powerful "the gap collapses" moment in the bank
   and the whole Graduation Bridge. (Pair with the cheaper **Ghost Multimeter** sibling.)

*Honorable spikes, lower confidence:* **Circuit Genetics** (the deterministic grader *is* a
fitness function — a creative/UGC sandbox bet, not curriculum) and **SPICE import** (export is
easy/NEXT; import is the moonshot — re-mapping arbitrary decks onto 22 elements is a real
impedance mismatch).

---

## 5. Cuts & traps — what NOT to build, and the honest reason

| Idea | Why it's cut |
|---|---|
| **RF / transmission-line / eddy-current as a *solver*** | Wrong engine. MNA is lumped; reflections / radiation / true wave propagation / eddy-current field solves need telegrapher's / FDTD / method-of-moments — not real-time-deterministic in a browser. **Keep the lesson** in the analytic frequency domain (Smith chart, S-params) and reality-tier drawings (B-H loop, laminations driven by the V/I the solver *does* produce). |
| **Fab Tycoon / yield-curve management** | Second simulation paradigm. The committed Clock-3 product run is an honest deterministic report card off the design hash; a tycoon shell needs non-physical process→yield math the sim-is-sole-judge doctrine can't ground. The good 10% is already Clock 3. |
| **Idle clickers** (The Slow Cap, Electromigration Clicker) | Number-go-up masquerading as physics. "Buy faster resistors to charge faster" teaches nothing transferable and forks the game into an idle genre. The honest idle layer already exists (standing contracts, #19). |
| **City-builder / Circuit MMO / shared persistent world-grid** | Two unbuilt foundations stacked: a persistent shared-world backend the static app lacks *and* a continent-scale AC-grid model the engine can't do honestly. Triple-cut by content, gameplay, and platform. The layout-integrity lesson it gestures at is better served by the EMI/heat lenses on one board. |
| **Real-time PvP / battle-royale / live social-deduction** (Surge Siege live, Sabotage/Among-Us) | Needs netcode on a globally-instantaneous solve the architecture deliberately sidesteps. **Keep the verbs async:** tower-defense contract, Glitch Bounty Board, co-op-via-seal-boundary. |
| **Order-the-PCB (Gerber → fab → mailbox)** | Brutal value cliff: a game-validated board is nowhere near manufacturable (no layout, footprints, DRC, sourcing, assembly). KiCad-*export* (#21) delivers ~90% of the graduation emotion at ~10% of the risk. Revisit only as a far-future partner integration. |
| **Natural-Language HDL ("make a 4-bit counter")** | A feature on an unbuilt foundation — it targets the programmable-block tier that doesn't exist (`uC`/`FP` are render-only placeholders). Revisit only after the multi-rate engine lands. |
| **Parts-database oracle / Bring-Your-Own-Datasheet / Mouser bridge** | Mission drift + a rotting external dependency. Mapping tiers to live purchasable parts is procurement, not electronics teaching. (The *internal* "fit a SPICE model to the nearest tier and show the residual" has a LATER kernel.) |
| **Pi Pico co-processor / "Netlist" card game / webcam Breadboard Mirror** | Each is a separate product with a thin software tie-in (a novelty cartridge that solves no user problem; card design+fulfillment; an unsolved-in-practice CV problem). The honest Breadboard cut is the cheap **Photo Overlay**. |
| **Impedance Terrain (3D \|Z\| surface) + synesthesia re-skins** (Weather, City, Schrödinger's Rail) | Spectacle, not pedagogy. None kills a named misconception or surfaces a law; the existing Bode + phase scope already teach impedance. The re-skins are themes that may live as cosmetic skins, never as teaching. |
| **"Explain it back" semantic gate at the top bonus tier** | Puts a fallible LLM on the highest-stakes path. A false rejection where motivation peaks poisons the brand promise that *the sim never lies to you*. Revisit only behind a working tutor, as a low-stakes optional. |
| **Hand-authored campaign spine / scripted lab-restoration / hand-authored backstory mysteries** | The explicitly-dead genre (author-once, consume-once) the spine is built to avoid. **Keep the imagery** (lights flickering on as eras unlock) as a free skin over the tech tree; take the *mechanic* (one seeded fault) and drop the authoring. |
| **Superconductor / plasma / cryo-lab as a *world*** | A sim project wearing a world costume — needs exotic-device physics (binary-R quench, inverted heat node) that doesn't exist. The *negative-resistance I-V* (neon, tunnel diode) is a LATER exotica gem; the quench/arc spectacle is presentation, not a solver. |
| **Etymology Mode / dating sim / spellcasting / cooking re-skins** | Delightful ≠ teaching. Charming humanities/thematic flavor with ~zero electronics-understanding gain; easy to mistake for pedagogy. A bounded codex texture at most, never a force-multiplier. |

---

## 6. Three coherent directions — pick a thrust

The slate bundles into three near-term focuses. Each is internally coherent, ships something the
spine wants, and trades off against the others. They are **not mutually exclusive** — the four
NOW mechanism-seams (Codec, debugging verb, thermal node, sensor channel) plus the predict→Lux
pedagogy (#3–#5) underpin all three and should ship regardless of which thrust leads.

### Direction A — Deepen the reality ramp (the teaching moat)

**Thrust:** the thermal node (#7) + saturating core / SMPS (#13) + the sensor channel and opto/PV
cluster (#6, #12), all surfaced through the X-Ray / split-replay / superposition pedagogy
(#4, #5, #18) and the debugging verb (#2, #14). Spike the **memristor seam** and the
**mechanical node** off the thermal node's slow-companion pattern.

**Why:** it widens the single thing nothing else in the genre does — *honest physics you can
diagnose one cause at a time* — and every piece is golden-safe by construction (value-path,
AC-only, flag, or web-side integrator). This is the deepest defensible moat.

**Trade-off:** it is the most *single-player* and least *viral* thrust. It grows hour-1-to-hour-10
depth but does little for hour-50 retention or distribution, and it leans hardest on new sim work
(even if low-risk), so payoff is gated on the team's sim bandwidth.

### Direction B — Open the social / UGC loop (the retention engine)

**Thrust:** the Codec (#1) → Exchange file-based MVP (#9) → fork-with-lineage + self-rendering
datasheet (#10) → Teardown + Chip Archaeology (#15) → Duels + Co-Watch (#16) → Datasheet
Reputation + dependency-count rep (#17). Spike the **Replay Theater** off the Codec.

**Why:** it closes the biggest gap in the game (no publish surface) and turns the playerbase into
the inexhaustible content treadmill — and the determinism property means it runs *without* a
moderation / anti-cheat tax (every artifact is re-verified by the importer's engine). This is
what makes hour 50 fun.

**Trade-off:** the *file-based* core is genuinely backend-free, but the loop only fully ignites
with the hosted layer (registry, leaderboards, dailies) — so this thrust forces the one big infra
decision soonest, and its payoff curve is back-loaded behind that call. It also adds the least
*new electronics understanding* per feature (it's a distribution multiplier on understanding that
already exists).

### Direction C — Sharpen the learning loop + reach (the mission, broadest funnel)

**Thrust:** the predict→Lux spine (Wager Strip #3, KCL/KVL X-Ray #4, split-replay #5,
Narrator/Superposition/Halos #18), accessibility (#8), the cheap hallucination-proof tutor floor
(Rubber-Duck + Hint Ladder #22), plus the distribution/credibility layer (Headless Grader +
`<iframe>` + PWA #20, Export-to-KiCad #21). Spike the **Bench Buddy** and **Hash Hunt**.

**Why:** it most directly serves the stated mission (people genuinely *understand* electronics)
and the broadest funnel — the embeddable live-circuit figure and offline PWA put the bench in
front of the most new learners per unit effort, and the KiCad bridge + signed certs give the
"this is *real*" credibility that converts skeptics. Lowest engine risk of the three (almost
entirely Layer-2 readouts and packaging).

**Trade-off:** it is the least *gamey* thrust — it sharpens the toy and the teaching but adds no
new depth domain and no social loop, so it risks producing a superb *learning tool* that's a
thinner *game*. It's the safest and broadest, and the weakest on long-tail retention.

**The producer's call to make:** A is depth-and-moat (sim-bandwidth-bound), B is
retention-and-reach (forces the backend decision), C is mission-and-funnel (lowest risk, broadest,
least gamey). The recommended hedge, if forced: **ship the four NOW seams + the predict→Lux
pedagogy regardless** (they serve all three and are nearly all golden-safe), then **lead with C's
distribution layer to widen the funnel cheaply, fund A's thermal node as the one new-physics bet,
and stage B behind the single explicit backend decision** — so the social loop is *ready to
ignite* the moment that infra call is made, rather than blocking on it.

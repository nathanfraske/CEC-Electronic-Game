<!-- SPDX-License-Identifier: Apache-2.0 -->

# The Fundamentals Scaffold Arc — show-don't-tell, concept by concept, zero → ready

> **Status:** design synthesis (presentation/UX + game-design only). **Touches no Rust, no
> netlist, no `snapshot_hash`, no determinism golden.** See §9.
>
> **Panel inputs:** six design lenses — *place & wire* (the two core verbs), *the loop &
> ground* (why complete a circuit), *carriers/colours/voltage/current* (the "what am I
> looking at" four), *the optional non-hand-holdy scaffold & its recession*, *the seam into
> the main loop*, and *show-don't-tell pedagogy rigor* — synthesized toward **guided
> discovery** and **all-ages** wherever they conflicted (§6, §7, and noted at each fork).
>
> **What this panel DECIDES.** It deepens the **per-concept fundamentals teaching** that the
> sibling docs only gesture at: each of the owner's seven literal questions gets one concrete
> **SHOW** hook and one concrete **EXPERIMENT** the player *causes*, plus the always-presented
> read-deeper pull, plus the exact recession trigger that opens the game up at the Era-0→1
> boundary. It does **not** re-script the hook, re-derive the ramp, or re-author the economy.

---

## 0. Thesis, the north star, and what this panel decides

**Thesis.** A true novice does not need a manual; they need the bench to *answer their
questions by reacting to their own hands*. Every fundamental — place, wire, the loop &
ground, the carriers and their conduit, the colours, voltage, current — is already
**SHOWN** by machinery that exists in the renderer today. The fundamentals scaffold's job is
not to re-explain those in prose. It is to **(a) order** the reveal one concept at a time,
**(b) hand the player the one live knob** that makes each concept visible-and-true, and
**(c) name it in a single clause exactly where the eye already is**, with the number one
pull deeper.

> ## ★ NORTH STAR — **SHOW & EXPERIMENT, don't TELL.**
> Every concept is taught by **DOING / WATCHING**. The player **causes** the phenomenon with
> a knob, a wire, a toggle; the board reacts on the same frame. Prose is **only an optional
> pull-deeper**, never the teacher. The governing law everywhere below is
> **SHOW → NAME → NUMBER**, never NAME-before-SHOW.
>
> *(This law is this panel's crystallisation of [onboarding-first-run.md §4]'s "name things
> just-in-time" + the owner's show-don't-tell instinct — authored here and consistent with §4, not a
> pre-existing quoted invariant.)*

**Two things the north star does NOT mean** (resolved toward guided discovery — §6):

1. It is **not an unguided maze.** "Experiment, don't tell" without a legible next action
   strands novices (the classic minimal-guidance failure). The fix is **just-in-time
   scaffolds that fire AFTER the world has shown the phenomenon true** — the [next-edge
   ghost], [pin-reveal], the contextual hint line, the Probe's one-clause *located* nudge —
   affordances that say **what to try** without giving the answer. A player is never both
   unguided **and** unscaffolded: there is always a lit pin, a ghosted edge, or a pulled hint
   one tap away.
2. It is **not "narrate AND wall-of-text"** (the owner's exact instinct against prose, which
   is also Mayer's redundancy principle: simultaneous narration + on-screen prose *hurts*
   novices). One voice ([the Probe]), one clause per beat, the deep version always **one pull
   away** in the [info drawer]. Spectacle and prose **never co-occur**.

**This panel DECIDES:**

1. The **per-concept SHOW/EXPERIMENT mapping** (§1, §2) — for each of the seven fundamentals,
   the existing SHOW hook, the knob the player turns, and the one-clause NAME that lands after.
2. The **curious → read-deeper path** (§3) — always presented, one pull away, never forced.
3. The **scaffold's character and recession** (§4) — follow-along, ignorable in one tap, and
   the canonical **hard-retire at the Era-0→1 boundary** (`unlockNode('era1-tolerances')`).
4. The **seam into the main loop** (§5) — experimentation taught as a first-class verb
   *before* contracts, so the first contract OFFER reads "do the thing you already enjoy, for
   pay," paying front-loaded Credits + the first Lux + the first Lab Notebook page.

**Relationship to the sibling docs (build on, don't re-derive).**

| Sibling doc | What it owns | What THIS panel adds |
| --- | --- | --- |
| [onboarding-first-run.md] | the first-run cold-open; §2 coach-marks that **NAME** current/voltage/ground/colours; §3 the wiring lesson; §4 show→name→number; §10 the pull-not-pick correction (one sandbox, no levels) | deepens §2's *naming* into explicit per-concept **SHOW/EXPERIMENT mechanics**; subordinates the §2 coach-mark to the **second** beat (NAME-after-SHOW), never the opener |
| [probe-teaching-arc.md] | the **scripted 4-act hook** (proud broken LED → blow-up on Run → resistor → divider → rebuild) + the magic-smoke and the seeded anti-copy grader | this panel is the **concept-by-concept fundamentals teaching the hook rides on**; we reference the hook's beats, we do **not** re-script them |
| [beginner-onboarding-all-ages.md] | the system/journey, the curriculum ramp, the durable coaching layer, all-ages, the [Lab Notebook] codex | this panel is the **fundamentals rung** of that ramp, deepened into per-concept mechanics; §7 points back for the full all-ages matrix |
| [game-economy-progression-implementation.md] | the contract loop, the [Reveal Engine], the Era-0 ideal set (`ERA0_TAGS`) and the Era-0→1 boundary (`era1-tolerances`) | this panel **consumes** the boundary as the canonical scaffold-recession trigger and the seam where the game "opens up" |

Also leaned on: [visual-language.md] (owns the carriers/colours/standpipe encoding),
[incomplete-circuits.md] (the honest `—` / located-hint for an open loop), [teaching-tools.md]
and [component-info-panel.md] (the read-deeper surfaces), [value-picker.md] (the experiment
input).

**Golden-safety, stated up front (full statement §9):** every surface here is a **read-only
consumer of the once-per-frame batched `electricalMap`/snapshot** [web/src/sim/loop.ts]. The
flow/carrier phase accumulators (`carrierOffset`/`energyOffset`/`FLOW_HZ`) are presentation
clocks that never feed the sim. No `sim-core`/netlist/`snapshot_hash` touch; no new JS↔wasm
crossing.

---

## 1. The arc at a glance — the concept order, one table

The order is the order a novice's questions actually arrive: you place something, you wire
it, the loop **comes alive** (and you learn it needs ground), then you start *reading* the
living board (carriers → their conduit → their colours → voltage → current), then you learn
that **values matter**, then you're ready. Each row: the concept · the owner's literal
question · what the screen **SHOWS** · the **EXPERIMENT** the player causes · the optional
[Probe] nudge (one clause, pulled or fired-on-the-player's-own-phenomenon).

| # | Concept | The owner's question | SHOWN (existing machinery) | EXPERIMENT (the player causes it) | Probe nudge (optional, one clause) |
| --- | --- | --- | --- | --- | --- |
| 1 | **PLACE** | *How do I place things?* | the armed [ghost] glyph (`updateGhost`, `GHOST_ALPHA=0.32`) snaps translucent to the grid cell, previewing its own drop; the hint line reads `PLACING Resistor · click to drop · R to rotate` | sweep the cursor → ghost snaps cell-to-cell; `R` rotates the ghost in place; click drops. First build **pre-arms** the next part, no bin-hunt | *(none core — the ghost self-teaches; idle-armed >~4 s →)* "Drop it on the glowing square." |
| 2 | **WIRE** | *How do I wire things up?* | press a pin → `drawPendingWire` rubber-bands a routed trace; `pinHitTest` snaps to a target with the neon ring (`PIN_R+2` stroke); release-on-wire previews a `JUNCTION_R` dot | drag pin→pin; the trace follows, the ring confirms the catch. NEW: [pin-reveal] breathing rings + the [next-edge ghost] make "from here → to there" literal | "Drag from the glowing pin to the dashed one." |
| 3 | **THE LOOP & GROUND** | *Why complete a circuit with ground?* | the [guided-open ↔ guided-done] flip (`advanceBuild`): open = **dark / nothing flows** + the honest `—` and amber located-hint; closed = **alive** (chevrons start, rails light). GND drawn as the `GND 0 V` node whose standpipe is **empty** | close the last wire yourself → dark→alive. Then the [ground-lift toggle] (the demo one-toggle idiom): lift the return → board dies → restore → revives | "No loop to ground, no flow. Lift that wire — watch it go dark. Now put it back." |
| 4 | **THE CARRIERS & CONDUIT** | *What are these carriers moving through?* | the moving chevrons **ARE** the carriers (`FLOW_HZ`, magnitude-decoupled so a **single carrier is trackable**); past `TIER_ZOOM` the conduit re-skins by lens — analogy **pipe + water**, reality **metal conductor + electron gas** | zoom past `TIER_ZOOM`, flip the lens (analogy↔reality↔schematic) on the **same** live current — watch it re-skin water-in-a-pipe ↔ electrons-in-metal | *(pulled, on first zoom)* "Pick a skin — water in a pipe, or electrons in metal. Same current." |
| 5 | **THE COLOURS** | *Why are they different colours?* | `voltageColor` (the single colour choke-point) paints every wire by **rail identity** (bench wire-code, signed+unclamped); the hue **drops toward grey** across a resistor — colour is identity, **not** magnitude | raise the source value → the standpipe/bar **rises while the hue stays put** (identity vs magnitude, by your own hand); watch two distinct rail-hues meet at a node | *(first time two hues meet)* "Different colour = different rail. The bar says how much." |
| 6 | **VOLTAGE** | *What is voltage?* | three channels at once: wire **colour** (rail id) + a pre-attentive **magnitude** channel (LED bar `BAR_SEGS=8` in Reality / water **standpipe height** in Analogy, ground-line = zero) + the **volts number** in the inspector | raise the source → the column **rises** / more segments light / `V across` tracks. Then **load** the rail → watch it **sag** (IR drop) | *(after the height has already moved)* "That's voltage — the push. Higher column, harder push." |
| 7 | **CURRENT** | *What is current?* | chevron **density** + belt **thickness** + the **amps number**, never speed; the belt **divides** at a tap (KCL, in=out) and continues thinner | lower R (or raise V) → chevrons **thicken/densify**, `I through` climbs ("less resistance, more flow"); add a **parallel branch** → the trunk thickens, the belt splits | *(after the chevrons have responded)* "More resistance, less flow." |
| — | **VALUES-MATTER** *(the bridge)* | *Why do the numbers matter?* | every value edit reacts live across glyph + colour + carriers + meter **on the same frame** (the one [value picker] → once-per-frame `electricalMap`) | **predict-then-reveal**: guess a node voltage before Run → the green-band scope reveals truth → a close guess pays the first **Lux** | *(on a close guess)* "Called it. Physics agrees." |
| — | **READY** *(the seam)* | *Now what?* | the divider sits between two rails, a node at a target voltage — the fundamentals **capstone** | the divider OFFER glimmers as the **first contract**: ship it for front-loaded Credits + first Lux + first Notebook page | *(the offer)* "You already built this. Now build it for pay." |

> **Why this exact order.** Place and wire are *gesture* verbs with no number — they go first
> and self-teach. The loop/ground flip is the strongest live mechanic the game owns, so it is
> the moment the board "comes alive" and earns attention. Only **after** the board is alive do
> the reading concepts (carriers → conduit → colours → voltage → current) have anything to
> point at — every trigger below gates on **the screen already demonstrating it true**, which
> is how SHOW-before-NAME is enforced *by construction*.

---

## 2. Per-concept SHOW-DON'T-TELL lessons

Each subsection: **what the screen shows**, **the experiment the player does**, **why it
needs no wall of text**, and **the one-clause pulled nudge**. Every lesson reuses existing
machinery; the only new surfaces are flagged and itemised in §8.

### 2.1 PLACE — *parts are things you drop on a grid*

- **Shows.** Arming a part draws the real glyph as a translucent **ghost** (`updateGhost`,
  `GHOST_ALPHA=0.32` on `ghostLayer`) snapped to the grid cell under the cursor, complete with
  its pin dots (`circle(p, PIN_R)`) and pinout labels — the part **reads as itself before it
  exists**. The LED ghost even tints to its chosen colour: the place-action previews its own
  consequence. The hint line reads `PLACING Resistor · click to drop · R to rotate · Esc to
  cancel`.
- **Experiment.** Move the cursor — the ghost tracks and re-snaps cell-to-cell. Click to
  commit (or drag-from-bin → drop). Press `R` to watch it rotate **before** you drop it; `Esc`
  cancels with nothing placed. In the first guided build, the next step's part is **pre-armed**
  the instant the current placement step's `done(p)` passes — so after dropping V, the R ghost
  is already on the cursor. No bin-hunt; placement becomes a rhythm.
- **No wall of text.** The ghost **is** the lesson — it shows exactly what the click will do.
  The only words are the one-clause hint line, a label where the eye already is, not a lecture.
- **Pulled nudge.** *(none core; placement is the input UI, self-evident.)* If the player idles
  armed: "Drop it on the glowing square."

### 2.2 WIRE — *pins are connection points; you drag pin → pin*

- **Shows.** During the wiring step, **pins self-announce**: a soft breathing ring on the
  step's pins ([pin-reveal], reusing the exact `circle(end, PIN_R+2).stroke` snap-ring
  geometry). Pressing a pin starts a wire in both select and wire mode; `drawPendingWire`
  rubber-bands a **routed** trace to the cursor; nearing any pin, `pinHitTest` snaps and draws
  the confirming ring; releasing on a wire previews a `JUNCTION_R` junction dot. The
  [next-edge ghost] reads the build's known `buildTarget`/`graphShape` and draws the **next
  missing edge** — a brightened start-pin (+ a `start here` tick) and a faint **dashed**
  target-pin — so "from here → to there" is literal, drawn *ahead* of the gesture.
- **Experiment.** Press the brightened pin and drag — the trace chases the cursor; nearing the
  dashed target, the snap-ring locks on; release commits the edge and the ghost advances to the
  next missing edge. A multi-bend run is built leg-by-leg. **A player who ignores all coaching
  and just starts dragging still learns it** — the snap-ring fires on proximity regardless,
  teaching "pins join to pins" by the gesture succeeding.
- **No wall of text.** Glowing pins + the rubber-band following + the ring locking on **are**
  the lesson. The next-edge ghost makes the player *complete a picture* rather than parse an
  instruction. This is also the **guardrail against the maze**: a lost beginner always sees the
  next edge to draw.
- **Pulled nudge.** *(first wiring step)* "Drag from the glowing pin to the dashed one."

> **a11y.** Pair the dashed-ring hue with the **dash pattern** + the `start here` **tick**, so
> meaning never lives in colour alone; `prefers-reduced-motion` stills the breathe to a calm
> steady ring, never still-and-gone.

### 2.3 THE LOOP & GROUND — *why complete a circuit (and why ground)*

- **Shows.** The open→closed **FLIP** is the entire lesson and is already wired (`advanceBuild`):
  while open, the board sits **dark / idle**, the [guided-open] banner reads *"Open loop — no
  current flows until you close it to ground,"* and the dangling pin carries the honest amber
  *"nothing flows here yet"* ring + a `—` read ([incomplete-circuits.md] located-hint, **never a
  fake number**). The instant the last wire makes `graphShape===buildTarget`, `complete` fires,
  [guided-done] flips to *"✓ Loop closed — current flows,"* and the board **comes alive** —
  chevrons start, rails light. **Ground is shown experientially:** GND is node 0, drawn with the
  `GND 0 V` label, coloured the dark wire-code grey by `voltageColor`, and its **standpipe is an
  empty/drained column** at the always-drawn zero-line. Grey = zero is *seen*, never asserted.
- **Experiment.** The player **causes the flip themselves** by drawing the closing wire:
  dark→alive on their own edge. Then the dedicated **ground experiment** — the [ground-lift
  toggle], the same gesture as the seeded "lift R2 off ground" demo: lift the return → the whole
  board goes **dark** and the meter falls to `—`; restore it → the flow **revives**. The player
  kills and revives the circuit with their own hands, isolating ground as **the load-bearing
  wire**. Raising the source while watching every standpipe rise off the ground-line while GND
  stays pinned empty shows voltage as height **above** the zero baseline.
- **No wall of text.** The board going dark vs alive is the demonstration; the player's own
  closing wire (and their own lift) is the proof. The banner names it in one clause **after** the
  screen has shown it true. Three independent channels agree — motion stops, colour greys,
  height empties — so the lesson never lives in one channel alone.
- **Pulled nudge.** *(on the player's own open-loop Run / first ground-lift)* "Lift the road home
  and the traffic stops — current must get back to ground. Put it back."

> **Resolved fork (lens 1 vs lens 2 scope).** Is the closure flip alone enough for "why
> ground," or is the ground-lift a separate rung? **Resolved toward the deliberate experiment:**
> the owner asks "why complete with **ground**" as a distinct question the flip alone
> under-answers, so the ground-lift ships *in* the rung as the "why GROUND specifically" beat —
> reversible, always available, never a graded step.

### 2.4 THE CARRIERS & WHAT THEY MOVE THROUGH

- **Shows.** The moving **chevrons ARE the carriers** (`FLOW_HZ ≈ 0.6 Hz`, magnitude-decoupled
  from speed) — calm enough that a beginner can **follow one carrier around the loop**. Past
  `TIER_ZOOM` the bare trace **re-skins into the conduit the carriers ride**: in **Analogy** a
  **pipe** (steel wall, dark bore, voltage-tinted **water**, carriers flow *with* current); in
  **Reality** a **metal conductor** (bright sheath, glowing core, electron gas drifts *against*
  current); **Schematic** leaves a clean trace.
- **Experiment.** Zoom past `TIER_ZOOM` and **flip the lens** on the *same* live current — watch
  the identical flow re-skin water-in-a-pipe ↔ electron-gas-in-a-conductor. The medium is learned
  by **direct A/B comparison**, not prose. A one-clause [zoom invite] steers the novice in
  ("Zoom in to see what they move through") because the conduit only renders past `TIER_ZOOM`.
- **No wall of text.** Switching the lens shows the medium by comparison; the player *decides*
  what the carriers ride by toggling. The carrier is the show; nothing is told.
- **Pulled nudge.** *(first zoom past `TIER_ZOOM` with current flowing)* "Flip the lens — same
  current, your choice of picture."

> **Resolved fork (carriers vs energy).** The second, warm-orange **energy** layer (`#ff8a3d`,
> the sign of v·i: streams to a resistor, **sloshes** in-and-out of a reactive part) is genuinely
> advanced. **Resolved toward all-ages / guided-discovery: it is a CURIOUS-DEEPER pull only**
> (the belt legend / info drawer), **never a fired card** during fundamentals. The core carriers
> rung is **only** the single trackable chevron + the lens re-skin. Owner-confirm in §10.

### 2.5 THE COLOURS — *identity, not magnitude*

- **Shows.** `voltageColor` (the single colour choke-point) paints every wire and chevron by
  **rail identity** using the conventional bench wire-code (signed, unclamped). Two same-coloured
  wires are the **same rail**. The colour visibly **drops from rail-hue toward grey** across a
  resistor and at the `GND 0 V` node — potential falling along the loop, drawn. Magnitude lives on
  a **separate** channel: the LED-bar segments / standpipe height / the number.
- **Experiment.** Two manipulations dissociate the channels: **(1)** change the source value →
  the standpipe **rises / segments light while the hue stays put** — "colour says *which* rail,
  height says *how much*." **(2)** Place a divider so two differently-coloured nets **meet** at a
  node, or change one source and watch the **whole net recolour in lockstep** (one rail, one hue)
  while a loaded net downstream stays greyer (IR sag).
- **No wall of text.** The separation is **felt in the hands** — raising voltage moves the bar but
  not the colour. The recolour-in-lockstep proves "one rail, one colour" by manipulation; the
  colour-drop across R proves potential falls — both watched, never read.
- **Pulled nudge.** *(first time two hues meet)* "Same colour, same rail — where it fades, the
  pressure's dropping."

> **Fallback trigger.** If the player's first board is a single-rail loop (no two hues ever meet),
> name colour identity on the **IR colour-drop across the first resistor** instead. Owner-confirm.
>
> **a11y mandate.** Meaning is **never** in hue alone — every colour is backed by the bar height
> + the number + a marker. (The wire-code ramps *hotter* for higher rails; the experiment is built
> to dissociate "hotter hue" from "more volts" — raising V moves the **bar**, not the hue.)

### 2.6 VOLTAGE — *the push, and how to read it*

- **Shows.** Voltage is drawn three ways at once: the wire's rail-identity **colour**, a
  pre-attentive **magnitude** channel (segmented LED bar `BAR_SEGS=8` in Reality / **water
  standpipe height** in Analogy, ground-line at the base = zero), and the exact **volts** in the
  inspector. AC/PULSE make the standpipe rise and fall live. Voltage **"sags only under load"** —
  a rail droops on the gauge, past ~4 % reads `--warn` (IR drop).
- **Experiment.** Open the [value picker] on the source and raise the value — watch the column
  **rise / more segments light** and the `V across` number track on the same frame, **hue
  unchanged**. Then **load** the rail (add a parallel R) and watch it **sag** — voltage as a
  pressure that droops under draw, a built-in experiment. **Predict-then-reveal:** guess the node
  voltage before Run; a close guess pays the first Lux.
- **No wall of text.** The column rising as you turn the knob **is** the definition of
  voltage-as-magnitude, experienced by manipulation; the sag-under-load shows IR drop without a
  word. Show→name→number: the height moves first, the popover names `V across` on select, the
  number is the deepest pull.
- **Pulled nudge.** *(after the height has already moved)* "That's voltage — the push behind the
  flow. Crank it."

### 2.7 CURRENT — *the flow*

- **Shows.** Current is moving chevrons whose direction = sign of branch current; magnitude rides
  **three decoupled channels** — belt **thickness**, chevron **density**, alpha — plus the **amps
  number**, **never speed** (`FLOW_HZ` is fixed so one carrier stays trackable). At a tap the belt
  **divides** — KCL made visible, in=out — and the trunk continues **thinner**.
- **Experiment.** Lower R (or raise V) via the [value picker] → chevrons **thicken/densify** and
  `I through` climbs ("less resistance, more flow"). Add a **parallel branch** → the trunk thickens
  toward the source while the branches split (KCL by manipulation). The pot-dimmer slider is the
  strongest zero-reading version: slide the knob, watch current and LED brightness track together.
- **No wall of text.** The belt thickening as you turn the resistance knob **is**
  current-responds-to-the-circuit, caused and watched; KCL is shown by the belt splitting at the
  tap, not stated. Magnitude-on-density-not-speed keeps a single carrier followable, so "current =
  flow" is literally trackable.
- **Pulled nudge.** *(after the chevrons have responded)* "More resistance, less flow. Less room,
  less current."

---

## 3. The "curious → read deeper" path — always presented, one pull away, never forced

> **Dependency note.** The deepest read-deeper rung — **predict-then-reveal + the Lux faucet + the
> Lab Notebook codex** — is **specified-but-unbuilt** ([game-economy-progression-implementation.md]
> §3/§5; [probe-teaching-arc.md] §3); this panel **consumes** it. The shallower rungs (the live
> `.value-pop` `V·I` meter, the `.info-drawer` + [partInfo.ts]) exist today.

The read-deeper layer is **standing** (an entry point is always visible) and **layered, never
modal** (it never auto-opens, never blocks, `Esc`-dismissible with no penalty). Depth is always
**exactly one pull away**, and a player who never pulls loses nothing reachable.

**Per-PART pull — three escalating rungs** (already live; [teaching-tools.md] §1,
[component-info-panel.md]):

| Rung | Surface | Gesture | Holds |
| --- | --- | --- | --- |
| **GLANCE** | the anchored value popover `.value-pop` | single-click a part | the live `V across · I through` meter |
| **LEARN** | the right-side [info drawer] `.info-drawer` ([partInfo.ts]) | double-click / `I` hotkey / popover ⓘ chip | the animated glyph → equation → number-free `plain()` prose → the fenced **"Right now"** live block → ratings → belt explainer |
| **PIN-IT** | the toolbar toggle | keeps the drawer open while building | persistent reference |

**Per-CONCEPT pull — the gap this panel fills.** The fundamentals are **concepts that cut across
kinds**, but [partInfo.ts] is keyed by **kind**. Route: each fundamentals concept **card** carries
a "read deeper" chip → the matching [Lab Notebook] codex page **and**, where a part is selected, the
info-drawer's matching glyph tier. Targets, mapped:

| Concept | The pull surface | Read-deeper target |
| --- | --- | --- |
| place / wire | the contextual hint line + the guided why-string | the codex "how the bench works" page (no equation — input affordances) |
| loop / ground | the amber located-hint chip is **itself** the pull ([incomplete-circuits.md]) | the codex "a circuit is a loop to ground" page; the `—` on a readout is also a pull ("why a dash?") |
| carriers / conduit | the lens-toggle conduit re-skin (the show **is** the deeper view) + the belt "Reading the board" legend | the carriers-vs-energy explainer (the **only** home of the energy layer) |
| colours | the standpipe/bar caption | the codex "colour = which rail" page + the [visual-language.md] wire-code table |
| voltage / current | the value popover meter | [partInfo.ts] equation + the live "Right now" substitution; the [Calculators] tab's COMPUTED-beside-MEASURED `✓ matches` chip |

**The water analogy — opt-in only, with a hard fence.** Delivered as **one** light aside attached
at the carriers/loop concept (voltage ≈ pressure, current ≈ flow, wire ≈ pipe, loop ≈ closed
pipe-circuit), voiced **once** by the Probe, with the explicit **"stop before it breaks"** line
([onboarding §5]) — the analogy fails at caps/AC/reactive, which is exactly where the energy-slosh
layer takes over. Never auto-expanded; never re-surfaced as a recurring crutch.

**Predict-then-reveal — the deepest intrinsic pull (and the first Lux faucet).** The [Calculators]
tab auto-fills R1/R2 from a placed divider and shows COMPUTED beside MEASURED with a `✓ matches`
chip — always the worked substitution, never a bare answer. In the sandbox, guess a node voltage
before Run; the green-band scope reveals truth; a close guess pays the first Lux
(`predict:rc-rise` / `concept:divider`). The hook is *"I predicted it and physics agreed."* This is
the experimentation verb the scaffold hands off **into** (§5).

**Always presented, never forced.** The ⓘ chip is on every valued part; the persistent **Explain/?
handle** ([App.svelte] ~4695) holds *"Explain things as I go," "Replay the tips," "Show the intro
again";* the codex is browsable any time. Each first-encounter card logs a Notebook page — **one
event = card + page + Lux** — so the read-deeper path is also a durable, re-openable reference, not a
one-shot toast. Closing any of it returns to the board with no penalty.

---

## 4. The optional, non-hand-holdy scaffold — and how it OPENS UP

### 4.1 Character — a pulled follow-along layer, never a rail

The fundamentals scaffold is **not a tutorial mode**. It is the **first rung of the durable
coaching LAYER** ([beginner-onboarding-all-ages §3]), rendered through machinery that already
exists: the do/why/done **Build engine** (`startBuild`/`advanceBuild`) for the **offered** guided
build, **first-encounter concept cards** (the **existing** `concepts.ts` `CONCEPTS` registry, fired
by `offerConcept` / `pumpConcepts` in App.svelte, deduped by `seenConcepts`, gated by
`explainAsYouGo`), the chevron flow, `voltageColor` + standpipe, the armed ghost + snap-ring, and
the value picker. Its concepts are delivered as cards that **fire on the player's OWN phenomenon**
— the first time the screen can demonstrate the concept true (loop closes → loop/current cards;
two rail-hues meet → colours card; first zoom past `TIER_ZOOM` → conduit card; first value edit
moves the gauges → voltage/current). A player who ignores the guided build and drags random parts
**still collects each concept** in whatever order their own board produces it. The scaffold thus
"follows along" whatever the player actually does — this is the difference between **guided
discovery** and a tutorial maze: guidance arrives at the moment of need, then gets out of the way.

### 4.2 Optional, three distinct ways

1. **The input affordances are the UI, not the coaching.** The armed **ghost**, the on-proximity
   **snap-ring**, and the **next-edge ghost** are *how you build*, not *how you're taught* — they
   **remain for everyone, always**, even when coaching is muted. (Drawing the line explicitly: the
   **breathing pin-reveal**, the **concept cards**, and the **pre-arm** are coaching — they retire;
   the **armed ghost** and **on-proximity snap-ring** are input UI — they never do. Muting coaching
   must leave a fully usable place/wire mechanic.)
2. **Each card is one clause + dismissible** ("Got it"), never blocking, never eats board
   pointer-events outside its own rect, never swallows a shortcut (the same `Esc`/dismiss discipline
   as the info drawer).
3. **One `explainAsYouGo` tap mutes the entire fundamentals card family at once** — and the
   spectacle (chevrons, colour, the loop-flip) still plays, wordless. Content stays reachable via the
   persistent Explain/? handle.

### 4.3 Non-hand-holdy by construction

No levels, no picker, no mode you are "in" (PULL-NOT-PICK). The guided build is an **OFFER** with a
**Show-solution** escape hatch; it won't advance until the right edge exists, but the player is
**never blocked from abandoning it** — `Clear` and free-build are always one tap away. Competence is
**detected, not interrogated**: the **first advanced action** — full-bin open, Tier-II arm, a
value-popover "More values" edit, a Real-tier select, an expert hotkey, or an explicit skip —
**auto-mutes the family BEFORE its next card fires** ([beginner §3.7]). No quiz, no "are you an
expert?" wall, no countdown.

### 4.4 Recession — passive thinning **and** a hard retire (the load-bearing new wiring)

Define **`FUNDAMENTALS_IDS = { place, wire, loop-ground, carriers, colours, voltage, current }`**
(the seven `seenConcepts` ids that cut across kinds).

**Reconciliation with the EXISTING cards (load-bearing).** `concepts.ts` already ships **four**
cards — `source`, `ground`, `loop`, `reading` (+ `CONCEPT_ORDER`). `seenConcepts` is a flat string
set, so these seven must be a **migration** of those four, not a parallel set (else the legacy cards
double-fire and the readiness bar's `loop-ground ∈ seenConcepts` is never satisfied). The mapping:
`loop` **→ renamed** `loop-ground`; `ground` **→ absorbed** into `loop-ground`; `source` **→
renamed** `voltage` (the source's "push"); `reading` **→ split** into `voltage` + `current` (its
read-deeper role moves to §3); `place` / `wire` / `carriers` / `colours` are **new**. Update
`CONCEPTS` + `CONCEPT_ORDER` to the seven and one-time-migrate any persisted legacy ids on load
(`loop`→`loop-ground`, `source`→`voltage`, drop `ground`/`reading`) so a returning player isn't
re-taught. **"No new state class" still holds** — the same `seenConcepts` set, re-keyed.

Recession **composes two mechanisms**:

| Mechanism | Trigger | Effect |
| --- | --- | --- |
| **Passive, per-concept thinning** | each id entering `seenConcepts` (the concept shown true over the ideal set) | fewer cards have anything left to fire; coaching goes quiet **with no countdown** ([beginner §3.8]) |
| **Hard, all-at-once retire** | `unlockNode('era1-tolerances')` fires — the **canonical** signal; **OR** `seenConcepts ⊇ FUNDAMENTALS_IDS`; **OR** a SHIP-IT divider clear **AND** `seenConcepts ⊇ FUNDAMENTALS_IDS` (the SHIP-IT leg is gated so a *recipe-copy* clear can't strand an under-taught player — see §10) | the fundamentals card family **retires wholesale**; the Explain/? handle + Lab Notebook remain |

**Why `era1-tolerances` is the canonical boundary.** `ERA0_TAGS = [V, AC, PULSE, I, R, C, L, GND,
LOAD]` is the **ideal set** and is always-armable; `era1-tolerances` is the **±5 % fidelity tax** —
the first **non-ideal** thing past the ideal set ([game-economy §2.1]). Crossing it is the
**provable** signal that the player has left the ideal components the owner named — exactly the
boundary at which the game "should open up." This is the one genuinely new piece of wiring this
panel adds: join `unlockNode('era1-tolerances')` to the scaffold-recession trigger set.

> **Resolved fork (per-concept vs all-at-once).** All four lenses that touched recession recommend
> **BOTH composed** (passive thinning + a hard retire at the boundary), and flagged the exact
> trigger weighting as an **owner/telemetry call** ([beginner §3.8] "no countdown"). We carry that
> recommendation; the open question is the trigger weighting, not the shape — see §10.

### 4.5 Opens up — recession is a CONVERSION, not a vanish

When the scaffold recedes, the player **gains**: the bin **widens past the ideal set** (Real-mode
fidelity / the first tolerance non-ideality), **predict-then-reveal + the Lab Notebook** become the
primary self-directed verbs, and the tech-tree's `era:<id>:reachable` **edge-glows** replace
coach-marks as the new "what's next" signal. The breathing pin-reveal and the hand-held next-edge
ghost go quiet, but the **underlying verbs are unchanged** — the player keeps the raw ghost +
snap-ring forever and now wires freely without the training rings. The fundamentals scaffold
**becomes** the always-available pull layer (Explain/? handle + one-pull info drawer) + the tech-tree
pull. **Recession reduces the PUSH, never the reachability** — a false-positive retire is harmless
because the handle re-summons everything.

### 4.6 Reconciliations (stated on purpose)

- **vs the §2 naming coach-marks** ([onboarding §2]). That table is a **naming** surface ("name,
  don't lecture"). This panel **subordinates** it to show-then-name: the card NAME lands **after**
  the player has SEEN/CAUSED the phenomenon (the loop went alive, the standpipe rose, the chevrons
  thickened), **never as the primary teacher**. The card is the **second** beat of
  show→NAME→number, not the first.
- **vs the pull-not-pick / no-levels correction** ([onboarding §10]). The scaffold reuses the
  concept-card render path, the `explainAsYouGo` mute, and the `seenConcepts` once-each dedupe — **no
  new state class, no mode, no countdown.** The only new wiring is (a) the per-concept SHOW/EXPERIMENT
  mapping (§2), (b) the small presentation surfaces (pin-reveal, next-edge ghost, pre-arm, the
  ground-lift toggle framing, the zoom invite), and (c) the `era1-tolerances` recession hook.
- **vs the Reveal Engine** ([game-economy §5]). The scaffold rides the Reveal Engine as the seam
  controller (§5) and the post-recession "what's next" signal; it adds no reveal state beyond joining
  one event to the recession trigger set.

---

## 5. The seam into the main loop — readiness, experimentation as a verb, the rewarding first OFFER

> **Dependency note.** The rewarding first OFFER leans on the **contract loop, the Reveal Engine,
> Credits/Lux, and predict-then-reveal** — all **specified-but-unbuilt** in
> [game-economy-progression-implementation.md] §3–§5. This panel **consumes** them as a downstream
> client; only the SHOW/EXPERIMENT teaching in §1–§4 is buildable on today's render alone.

The arc terminates exactly where the three sibling docs already agree the seam is — **the divider**,
a complete-loop capstone — **offered, not gated**, as the first contract. Onboarding's job ends the
instant that offer is **shipped**; the scaffold doesn't vanish, it opens up (§4.5).

**Readiness bar — what the player must have SHOWN they can do** (detected, never quizzed; every row
is a behaviour the player has already *caused*, satisfied by `seenConcepts` membership):

| Readiness signal | Demonstrated by |
| --- | --- |
| can **place** | a committed drop (`place ∈ seenConcepts`) |
| can **wire** | a completed pin→pin edge (`wire`) |
| has closed a **loop** and seen it go alive | the dark→alive flip caused (`loop-ground`) |
| can read the **living board** | carriers/colours/voltage/current cards fired as their phenomena appeared |
| has **experimented** | at least one value edit that moved a gauge, or one predict-then-reveal |

**Experimentation taught as a first-class verb — BEFORE contracts.** The single new teaching verb is
**cause-then-watch** (turn a knob / toggle / lens-flip / close-the-loop, watch the show respond),
installed *before* any contract exists. Contracts are then **not a new screen** but the **same verb
with a target**: "you already do this — now do it on purpose, for pay." Predict-then-reveal (§3) is
the bridge — it makes *causing a phenomenon* the unit of fun, and pays the first Lux for it, so the
contract loop inherits an activity the player already enjoys.

**The first contract is a rewarding OFFER, not a wall.** The divider OFFER glimmers as the
fundamentals capstone and pays, on first clear, the **front-loaded first-clear Credits** (~168 ₵ for a
fresh `divider` seed, [game-economy §3.1]) in the **SHIP-IT** count-up (where `currency:credits`
reveals), the **first Lux** via predict-then-reveal (`predict:rc-rise`), and the **first Lab Notebook
page**. The wallet immediately buys ≈ a tier license + a couple of parts — the loop feels like reward,
not gate.

**The arc, absolute-zero → main loop** (rides, does not re-script, the [probe-teaching-arc] hook and
the [beginner] ramp):

1. **Cold-open blow-up on the player's own Run** ([probe-arc] Act 0) — teaches the transport ("how
   you start the sim") and "too much current breaks it," self-caused yet blameless.
2. **Add a current-limiting R** — *place / wire / loop+ground* cards fire as the loop closes and
   current flows.
3. **The divider** — *colours / voltage / current* cards fire as the colour drops and the node sits
   between rails; values-matter via predict-then-reveal.
4. **First contract OFFER = the divider as capstone** — ship it for the front-loaded Credits + first
   Lux + first Notebook page. **Onboarding ends and the game begins at that shipped offer.**

> **Resolved fork (cold-open).** The older [onboarding-first-run.md] opens on a calm primer; the
> [probe-arc] opens on the blow-up. **Resolved per [probe-arc] (owner-confirmed 2026-06-25):** the
> blow-up **is** the opener (fired on the player's own Run, never auto-run); the calm primer is the
> **post-blow-up rebuild**. This panel inherits that resolution and does not re-litigate it.

---

## 6. Pedagogy guardrails

- **Guided discovery, not an unguided maze.** Minimal-guidance sandboxes sink novices. The cure is
  **just-in-time, minimal scaffolds that fire AFTER the world shows the phenomenon true**, name it in
  one clause where the eye already is, and offer the number one pull deeper. A player is never both
  unguided and unscaffolded — there is always a lit pin, a ghosted edge, or a pulled hint (§0).
- **SHOW → NAME → NUMBER, never NAME-before-SHOW.** Every concept card's trigger predicate **gates on
  the screen already demonstrating it true** (loop card only after a loop closes; colours card only
  after two hues meet or a colour-drop appears; voltage card only after `TIER_ZOOM` + a gauge is on
  screen). The SHOW always precedes the NAME by construction of the predicate.
- **The redundancy principle.** Narrating **and** showing **and** a wall-of-text simultaneously splits
  attention and *reduces* learning. One voice (the Probe), one clause per beat, prose deferred to the
  pull layer; voiced Probe + DOM caption are the **same** content (a11y), not additive narration over
  text. Spectacle and prose never co-occur (segmenting).
- **The experiment is always primary; the coach-mark only NAMES.** Watching is weaker than
  predict-then-reveal self-explanation, so each concept ships an authored `{nudge, what-to-watch}`
  tying a specific **knob** (value picker, parallel-branch, pot slider, ground-lift toggle) to a
  specific observable, plus predict-then-reveal paying the first Lux for a correct guess. Productive
  failure (the Act-0 blow-up on the player's *own* Run) is the player's action, not a cutscene.
- **The guardrail against the "lost player."** Pulled hints + the **next-edge ghost** + the
  **pin-reveal** + the [Probe]'s one-clause *located* nudge always show **what to try** without giving
  the answer; the do/why/done Build is offered as a "show me" pull for the truly lost; the
  **Show-solution** overlay is the always-available escape hatch that wires the next edge for them.

---

## 7. All-ages note

Each show-don't-tell lesson **degrades across the spectrum by behavioural pull, not a picker** — one
sandbox serves a pre-reader and an EE; they meet the **identical** affordances and differ only in
**pull depth** (the full matrix lives in **[beginner-onboarding-all-ages.md] §4**; this is the
pointer, not the re-derivation).

| Lesson | Pre-reader (by-feel, voiced) | EE (numeric, silent) |
| --- | --- | --- |
| place / wire | gesture-only verbs with **no numeric target** — identical for both; the dual-form arguably doesn't apply here (confirm §10) | identical |
| loop / ground | "lights off / lights on" on the dark→alive flip and the ground-lift | the popover `I through` falls to `—` and snaps back |
| carriers / conduit | "water in a pipe" skin, by sight | the electron-gas / conductor skin + the belt legend |
| colours | watch the hue, watch the column | the wire-code table + the rail number |
| voltage | "raise it until the column reaches the notch" (by-feel) | set `V across` to `3.3 V` (numeric) |
| current | "grow the resistor, the arrows thin" | `I through` falls; KCL at the tap |

Every magnitude **experiment** has a **by-feel form beside the numeric**, both reading the **same
once-per-frame snapshot**, so the 5-year-old and the EE run the identical hidden netlist. By-feel is
default-prominent; **reaching for the number IS the pull** that promotes the numeric form. Voiced
[Probe] lines are the retro-robotic register, always **captioned in real DOM text** (`aria-live`
throttled ~2 Hz); reduced-motion degrades `FLOW_HZ` to **calm, not still**, and the blow-up to a
static cooked glyph + a named-cause chip.

---

## 8. Reuse vs new surface

Everything here is **reuse** except four small presentation-only additions and one piece of
recession wiring. Files/symbols named.

### Reuse (no change)

| Surface | Symbol / file | Carries |
| --- | --- | --- |
| armed **ghost** | `updateGhost`, `GHOST_ALPHA=0.32`, `ghostLayer` [board.ts] | PLACE (preview, pin dots, pinout labels, LED tint) |
| pin **snap-ring** | `circle(end, PIN_R+2).stroke`, `pinHitTest` [board.ts] | WIRE confirm-ring (pin-reveal reuses this exact geometry) |
| wiring mechanic | `onPointerDown → startWiring → drawPendingWire`, `JUNCTION_R` [board.ts] | WIRE (rubber-band + junction preview), untouched |
| **Build engine** do/why/done + loop-closure **flip** | `startBuild`/`advanceBuild`, `.guided-overlay`, guided-open↔guided-done (`done: p.complete`) [App.svelte] | the LOOP/GROUND lesson (dark→alive); the next-edge ghost reads `buildTarget`/`graphShape` |
| honest open-loop read | the located-hint chip + offending-pin ring + `—` [incomplete-circuits.md] | open-loop / lifted-ground state (never a fake number); the demo one-toggle idiom for the ground-lift |
| chevron belt | `FLOW_HZ`, `carrierOffset`/`energyOffset` [board.ts] | CURRENT (trackable carrier) + the carriers-medium/energy pull |
| colour + magnitude gauges | `voltageColor` (the colour choke-point), LED bar `BAR_SEGS=8`, water standpipe, `GND 0 V` label/zero-line [board.ts] | COLOURS, VOLTAGE, ground-as-zero |
| lens conduit re-skin | the analogy/reality/schematic conduit past `TIER_ZOOM` [board.ts] | CARRIERS' medium (A/B comparison) |
| read-deeper pull | `.value-pop` `V·I` meter, `.info-drawer` + [partInfo.ts], [Calculators] predict-then-reveal, [Lab Notebook] codex | the curious → read-deeper layer (no new floating panel) |
| coaching state | the single `explainAsYouGo` mute + the `seenConcepts` fire-once set + the Explain/? handle [App.svelte, storage.ts] | the whole card family (no new state class) |
| experiment input | the [value picker] (`setVal`/`stepVal`, relocated into `.value-pop`) + the once-per-frame `electricalMap` | every cause-then-watch experiment |
| seam controller | the [Reveal Engine] (`first-contract`, `currency:credits`, `era:<id>:reachable`), the seeded divider target + value-aware grader [game-economy §5; probe-arc §3a] | the rewarding first OFFER + the post-recession "what's next" |

### New (smallest surface, presentation-only, golden-safe)

| New surface | What it is | Notes |
| --- | --- | --- |
| **pin-reveal** | breathing rings on the **current build step's** pins | reuses the `PIN_R+2` snap-ring draw; gate behind `prefers-reduced-motion` → calm steady ring |
| **next-edge ghost** | brightened start-pin (+ `start here` tick) + **dashed** target-pin for the next missing edge | read from `buildTarget`/`graphShape`; pair hue with dash pattern + tick for a11y |
| **pre-arm** | arm step N+1's part when step N's `done(p)` passes | only inside the guided `startBuild` context; any player arm/`Clear`/`Esc` overrides it |
| **ground-lift toggle framing** | a labelled, reversible self-serve "lift the return" control on the alive board | reuses the demo one-toggle idiom (the "lift R2 off ground" gesture); framing only, no new mechanic |
| **zoom invite** | a one-clause dismissible nudge ("zoom in to see what they move through") | a coach-mark, not a mechanic; the conduit only renders past `TIER_ZOOM` |
| **fundamentals concept-card descriptor** | a per-concept registry (sibling to PartInfo) keyed by the seven `FUNDAMENTALS_IDS`, tying each concept to `{trigger-predicate over the snapshot, one-clause NAME, the SHOW hook, the read-deeper target}` | mounts on the existing `concepts.ts` `CONCEPTS` registry (content + a separate TRIGGERS predicate map); rides `seenConcepts`; **no new coaching machinery** |
| **the Era-0→1 recession hook** *(load-bearing)* | join `unlockNode('era1-tolerances')` (and first SHIP-IT, and `seenConcepts ⊇ FUNDAMENTALS_IDS`) to the recession trigger set | one derived boolean + a reveal binding; **no new persistent setting** |

**Nothing new in `sim-core`/netlist/`snapshot_hash`.** Every surface is web-side local state + reads
of the already-batched once-per-frame `electricalMap`/state Float64Array.

---

## 9. Determinism & golden-safety statement

This panel is **presentation / UX + game-design only**. It touches **no Rust, no netlist, no
`snapshot_hash`, no determinism golden**, and adds **no JS↔wasm crossing**.

- Every SHOW surface (chevrons, `voltageColor`, the LED-bar/standpipe gauges, the conduit re-skin,
  the loop-flip) is a **read-only consumer of the once-per-frame batched snapshot** read in
  [web/src/sim/loop.ts] — the JS↔wasm boundary stays coarse (golden rule 2).
- The flow/carrier phase accumulators (`carrierOffset`, `energyOffset`, `FLOW_HZ`, `this.phase`) are
  **wall-clock presentation clocks**; they never feed the sim.
- The **ground-lift** is a presentation-side wire removal: the solver already handles
  dangling/singular nets via [incomplete-circuits.md] (an **unhashed** bool, `—` substituted, the run
  stays finite). It **never branches the solve** and is **never added to `snapshot_hash`** — the
  golden is untouched (the doc's own invariant).
- The only new state is **web-side local**: the `FUNDAMENTALS_IDS` set, the per-concept card
  descriptors, the `era1-tolerances` → recession binding, and the derived `competenceDetected`
  boolean — **none hashed, none crossing the boundary.**
- `cargo test -p sim-core` (incl. `run_is_reproducible`) and the FNV-1a snapshot hash are **unaffected
  by construction** — there is no code path from any surface here into the deterministic core.

---

## 10. Open questions / owner hand-offs

1. **Recession trigger weighting** *(owner / telemetry call).* The recommendation is **per-concept
   passive thinning + a hard retire at `unlockNode('era1-tolerances')`**. Should the **first SHIP-IT
   clear** alone retire the family even if `seenConcepts` is incomplete (player shipped by copying a
   recipe without meeting all seven concepts)? Should `seenConcepts ⊇ FUNDAMENTALS_IDS` be a third
   OR-leg? Mirrors [beginner §3.8] "no countdown."
2. **By-feel vs numeric parity.** Does the perceptual/by-feel divider win (younger skin) retire the
   **same** seven fundamentals concepts and pay the **same** first Lux as the numeric win? Recommend
   **yes — understanding is understanding** ([probe-arc] open-Q #8) — but confirm it doesn't open a
   grind/exploit path for older players who'd rather match-by-feel than reason numerically. Confirm
   per-concept whether the dual-form shares one `seenConcepts` entry.
3. **Place/wire dual-form.** Place and wire are gesture-only verbs with **no numeric target**, so the
   dual-form arguably doesn't apply to **these** verbs. Confirm the pre-reader and the EE meet the
   **identical** place/wire affordances (they do) and that **no by-feel variant is needed** here.
4. **Carriers / energy scope.** Confirm the carriers rung is the **chevron + lens re-skin comparison
   only**, with the **energy-vs-charge two-layer belt deferred** to a curious-deeper pull (belt
   legend / info drawer), **never a fired card** during fundamentals — or should a *hint* of
   energy-flow land at the divider?
5. **Zoom invite.** Is a steering nudge to zoom past `TIER_ZOOM` ("see what they move through") worth
   a new affordance, or should the conduit re-skin be discovered organically? And is a one-shot
   **cursor-nudge** tracing pin→pin worth building **beyond** pin-reveal + next-edge ghost
   ([onboarding §9.5])? **Recommend** ship pin-reveal + next-edge ghost first; add the cursor-nudge
   only if playtests show first-wire stalls.
6. **Colours fallback trigger.** If the player's first board is a single-rail loop (no two hues ever
   meet), confirm naming colour identity on the **IR colour-drop across the first resistor** instead
   of the "two hues meet" trigger.
7. **Voltage dissociation gating.** Should the identity-vs-magnitude card **require** both
   manipulations (raise V, change rail) before firing, or fire on the first (height moves) and leave
   the rail-flip as the deeper pull? **Recommend** fire on the first raise.
8. **Ground-lift home.** Per-example demo affordance (only on seeded boards with a marked return, like
   the R2-lift example) or a general "lift any wire" gesture the player discovers in their own builds?
   **Recommend** ship first as the marked demo-toggle on the primer/divider boards, evaluate
   generalising.
9. **Concept-card copy + order.** This panel specifies the **mechanics** (the per-concept
   SHOW/EXPERIMENT mapping + the one-clause "short" intents + the Probe-nudge **intent**); the
   bespoke **copy and fire-order** are an owner/content hand-off, owned downstream by
   [probe-teaching-arc.md] / [beginner-onboarding-all-ages.md]. Confirm this panel **defers** card
   wording rather than authoring it.
10. **Descriptor mount.** Confirm the per-concept card descriptor mounts on the existing
    `concepts.ts` `CONCEPTS` registry (content + a separate TRIGGERS predicate map) rather than a new
    file/state class.
11. **Water-analogy depth.** Confirm the analogy is voiced **exactly once** (at the carriers/loop
    concept) with the "stop before it breaks" fence, attached to the carriers card (or the voltage
    card, or both?), and **never** re-surfaced for caps/AC/reactive.
12. **First-contracts shape at the seam.** Confirm the ideal-set capstone contracts
    (`fixedRail` / `divider` / `rcTiming`) each retire a fundamentals concept as they pay, and that
    the divider's **parametric** target ([probe-arc §3a] changed-numbers) is a genuine "size the
    divider" judgement (not a recipe), so the front-loaded ~168 ₵ + `predict:rc-rise` Lux + first
    Notebook page feels **earned**.

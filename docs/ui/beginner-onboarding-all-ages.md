<!-- SPDX-License-Identifier: Apache-2.0 -->

# The deeper intro — onboarding the whole spectrum of beginners

**Status:** design synthesis. **Layer:** presentation / UX + game-design only — never
sim-core, the netlist, or the determinism golden. **Spine:** the pull-not-pick correction
of [onboarding-first-run.md §10] — one sandbox, no levels, "self-select = what you PULL,
not what you pick." **Sibling:** [probe-teaching-arc.md] owns the scripted 4-act opening
hook (proud broken circuit → blow-up → add a resistor → divider → rebuild-with-changed-
numbers) and its two new mechanics (magic-smoke-over-FAIL, seeded parametric anti-copy
generator). This panel does **not** re-derive that hook; it builds the **system and
journey around it**.

---

## 0. Thesis — what this panel decides

The scripted Probe hook is a five-minute *spark*. It is not a curriculum, not a coach, and
not a reason to come back tomorrow. This panel decides the **system and journey** the spark
ignites:

1. **The CURRICULUM RAMP** the hook hands off into — what concepts arrive in what order,
   and how the opening dissolves into the existing graded [EXAMPLES] ladder, then into the
   game proper (contracts + tech tree) **without a cliff**.
2. **The DURABLE COACHING SYSTEM** — the Probe as one teacher across the *whole* game (not
   the first five minutes): the persistent [Explain/Help] handle, first-encounter concept
   cards, the [Lab Notebook] codex, the single [explainAsYouGo] mute — a layer that lasts
   hours and **recedes as competence grows**.
3. **ALL-AGES ADAPTATION without levels** — how *one* sandbox serves a pre-reader and an EE
   by behavioural **pull**, never a picker.
4. **ACCESSIBILITY & REACH** as a first-class checklist, not a retrofit.
5. **HOOK & RETENTION** for someone with **zero** prior interest in electronics — why they
   start, why they don't churn, why they return — with a **no-dark-patterns charter**.

**Relationship to [onboarding-first-run.md].** That doc establishes the first-run *cold
open* and the pull-not-pick *spine* (§10). This panel **extends it into a full beginner
JOURNEY and a durable coaching SYSTEM**: §10 says coaching is an always-available layer;
this panel specifies what that layer *contains* over hours, how it adapts across the whole
age/skill spread, and where the ramp seams into contracts and the tech tree. It contradicts
nothing in §10 — it adds exactly two new presentation-only surfaces (a "try this next →"
ramp pointer and a codex-keyed relaunch nudge), both pulls, never gates.

**Relationship to [probe-teaching-arc.md].** That panel owns the *scripted hook*. This
panel **seeds from it**: the divider the hook lands on **is** the first rung of our ramp and
**is** the first contract offer — one continuous board, no mode switch. We reference the
hook's beats (the blow-up, the changed-numbers generator) and specify their **durable
homes** (the Test Bench as a permanent destruction verb; a non-numeric variant of the
anti-copy target for pre-readers) — but we do not re-derive the 4-act script.

**The bet, stated plainly:** make *causing a phenomenon* the unit of fun; make the [Lab
Notebook] the visible record of it; make the cheapest reason to return be "fill the next
blank / make the smoke again / beat my own guess." A 5-year-old and an EE play the
**identical** sandbox and differ only in how much of one layer they pull.

---

## 1. The spectrum we serve — five personas as journey maps

We design for one continuous spread, not five tracks. The table below is the compact
journey-map; the full ramp/coaching/a11y/retention sections each carry an all-ages matrix
that maps every act back onto this spread.

| Persona | Entry | First 5 min | First session | What hooks | Churn risk | Success |
| --- | --- | --- | --- | --- | --- | --- |
| **Tablet Twosome** — ~5–7yo pre-reader + co-playing caregiver, touch-only, one device, one set of hands that can read | Adult put it in front of the child ("a game where you make lights turn on" / a classroom link); child did **not** self-select | Only two hook beats land: the **smoke** (pure spectacle, re-requested) and the **light coming on**. The reasoning between sails over a 5yo; the hook degrades to a delightful cause→effect toy | Caregiver-driven 15–30 min: poke [Run]→alive, wire the [pot-dimmer] together, the [POT] wiper slider becomes the toy, trip a vent for "smoke again," first codex page fires accidentally. Ends when attention lapses, gracefully | Motion/light on a poke; magic smoke; the [POT] slider; the [demo] one-toggle; the self-caused [LED]; the codex reskinned as a **sticker book**; time-as-a-toy | **Dead first frame** (paused primer + unreadable banner); **first poke opens a drawer** not Run; the **reading wall** (caregiver voices every word); touch drag-to-wire; motion overload with no calm path; low-end stall; no kid-legible closure | One self-caused "I made it happen" they ask to repeat; a filled sticker-slot; for the adult: low reading labor, never made to feel dumb, a reason to reopen |
| **Curious kid** — ~9–12, solo, reads fine, no algebra, short attention | A link, a friend, a classroom tab; came to make things light up and **explode**, not to "learn" | Wants the [LED] and the bang fast; rides [led-limit] "the classic first build" and its R-sweep; the [demo] one-toggle is the strongest pulled beat; prose mostly skipped | 20–40 min **phenomenon-collecting spree** (Plateau-1 archetype): place LED, sweep R, add a switch, blink it, hunt the explosion; [Lab Notebook] fills with a [Lux] ping per phenomenon; greyed tech-tree shows "how much more" | Arrows + glow on autoplay; poke-a-number-watch-it-change; the LED lighting; the blow-up as a **repeatable verb**; the Test Bench; the codex collection; greyed shelves; single-step as a toy | Any wall of text; **math in why-clauses**; contract-as-homework; low-end jank; drag-to-wire failure; no codex-keyed come-back nudge | Made the LED light, blew something up on purpose, filled ~3 codex pages unprompted, reopened because the codex had blanks. Understanding is a **byproduct** (eureka discounts) |
| **Teen / classroom** — ~13–17, algebra-capable, phone/Chromebook, **assigned**, skeptical, peers watching | Teacher pushed a link / Assign-a-Contract task; opens with "another boring edu thing" and a low patience budget | Runs the guided build, self-causes the first LED (relief + competence); pulls [Explain] **on demand** when a number surprises; the seeded changed-numbers generator makes copying a neighbour fail | 20–45 min class period: satisfy the assigned divider (Bronze), discover Gold, fork to [led-limit]/[rc], goof off in the Test Bench (autopsy→Lux turns goofing into curriculum), first codex pages, one "look at this" | Probe blow-up (shareable); anti-copy seeded numbers as **teaching pressure**; destruction paid in understanding; demo toggles; logic rungs as "build a tiny computer part"; Bronze/Gold; beat-a-friend's-ghost; predict-then-reveal | Any wall of text in 60s; feeling **lectured/quizzed**; Chromebook jank; touch wiring vs pinch-zoom; the Era-4 exam reintroducing "this is a test"; **public** wrong-answer shaming | Passed without feeling tutored; caused one unscripted phenomenon for fun; one peer "look at this"; one correct predict-then-reveal flipped "homework" → "I'm good at this"; **reopened unprompted** |
| **Adult novice / returning maker** — reads, motivated, wants to actually learn | Self-selected to learn or returning days later expecting their board back | Rides the **gentle** default: silent cards offer themselves and log to the codex; pulls full prose + the [info-drawer] when curious; builds by feel, verifies by number | Four-stage scaffold (guided → examples → free sandbox → contracts); category boundaries give "where am I" without a level menu; predict-then-reveal is the natural first [Lux] faucet | The alive-bench feel; category chapter beats; the codex as a durable record; session persistence; the "next rung" through-line | Losing their board/notebook on return; a ramp that stalls at "now what?"; prose that blocks rather than offers | Built their first thing at speed; pulled the full explain depth at their own pace; the codex is *their* record; the bench feels like theirs on return |
| **Expert EE / power user** — knows V=IR cold, mutes coaching instantly, wants a fast bench | Returning on a workstation to actually build/verify; the paused primer is a placeholder to clear | Clears the primer, drags real parts, pin-to-pin wires; the **implicit-skip** auto-mutes coaching *before* the first card; pulls **only** the deep [info-drawer] (Real cutaway + live calcs + ratings) | Builds a real circuit as a verification bench; accepts the first contract as an **offer**, chases Gold while a novice Bronzes the **same** contract; the codex fills passively | "Let me build" fork; greyed shelves as a real journey map; the **Real fidelity tier**; seeded contracts as real specs; Gold/CEC-Certified; failure-as-fun with autopsy→Lux | A card that **blocks** or fires after competence is signalled; the **Era-4 exam** as a mandatory gate; primer not instantly clearable; a narrowed bin as *the* bin; **no persistence**; prose that talks down | Forgets it's a "teaching game"; never gated/quizzed; chases Gold; the Era-4 exam **waived by eureka**; returns because his last board waits and there's more reality to unlock |

> The two endpoints — the Tablet Twosome and the Expert EE — are the **litmus**. If both are
> served by one sandbox with no picker, the spine holds. Every section below resolves its
> conflicts in favour of **all-ages reach + pull-not-pick** and says so.
>
> **Honest MVP caveat (the one place "all ages" is aspirational, not live today):** the
> **solo** pre-reader — a 5-year-old with *no* caregiver and *no* audio — is **not** fully
> served at MVP. At MVP the pre-reader leg is carried by **caregiver co-play** and/or the
> **voiced Probe** (§4.2, §5 Axis 4); a fully-solo, silent, non-reading path is a **post-MVP
> reach goal**, not a claim about today. Everywhere else, one sandbox serves the whole spread
> now.

---

## 2. The CURRICULUM RAMP — concept ladder from zero into the game proper

**The ladder already exists as data.** The ordered [EXAMPLES] array and its 14
[EXAMPLE_CATEGORIES] (Fundamentals outward), each rung a complete Watch/Build/demo
[ExampleSpec], *is* the curriculum middle. The deeper intro adds **no new tutorial content**
and **no sequence-lock**. It adds exactly **one** affordance — a **"next rung" pull** — so
the array order becomes a *suggested spine*, never a gate.

### 2.1 The rung order (reading-order over existing ids — not new content)

| Rung | Example id · category | Concept introduced | The "what-if" / payoff |
| --- | --- | --- | --- |
| **R0** | [primer] · Fundamentals | voltage = push, current = flow, loop required, ground = zero | the §5-minimum concept cards fire as the screen demonstrates each true |
| **R1** | [divider] · Fundamentals | the R2/(R1+R2) tap **and the first contract OFFER** (3.3 V from 5 V) | its [demo] (lift R2 from ground) — the first "what-if" beat |
| **R2** | [pot-dimmer] · Fundamentals | the fixed divider you just built, but with a **knob**, driving an LED | first self-caused light + first tactile slider |
| **R3** | **FORK** → [led-limit] · Diodes  **or**  [rc] · Caps & Inductors | "the classic first build" (glowing LED) **or** "first time the scope curves" | a **choice** of two rungs, never one forced path |

From **R3 onward the ramp dissolves** into the full [EXAMPLE_CATEGORIES] ladder + codex +
tech tree. The deeper intro **seeds only R0–R3** and trusts the existing library to carry
the rest (the ~50 already-authored examples).

### 2.2 The one new affordance — the "next rung →" offer

On finishing any rung's Build (the existing `guided-done` / `p.complete` flip), the Probe
shows a **single dismissible chip**: *"Liked that? Try [name] →"* linking the next
ExampleSpec(s). Properties:

- It is a **PULL, not a gate**: it never blocks; the full bin and the first contract stay
  reachable the entire time; it self-mutes under the existing [explainAsYouGo] flag and on
  the first advanced action, exactly like a concept card.
- **Authoring shape:** a tiny ordered table beside [EXAMPLE_CATEGORIES] in `examples.ts`:
  `RAMP: Array<{ from: id; next: id[]; line: string; short: string; glyph }>` — mirroring
  the `partInfo.ts` templated-descriptor discipline. **Only R0–R3 need bespoke copy**;
  everything else defaults `next` to the next id in EXAMPLE_CATEGORY order, so the whole
  library inherits a suggested spine **for free**.
- It reuses the concept-card render path, the [explainAsYouGo] mute, and the
  [seenConcepts]-style once-each de-dupe. **No new state class.**

### 2.3 The seam into contracts — no cliff

The **divider is the pivot**: example #2, the destination of the scripted hook, **and**
[game-progression §1.3]'s first contract. The handoff verb is already documented as the §6
4:00 beat — *"A customer needs 3.3 V from this 5 V rail. You've got the parts"* — an
**OFFER not a gate**. The deeper intro makes it explicit:

> Completing the divider Build fires the contract **offer chip** (Probe voice) right where
> the player is already looking, on the circuit they just understood. Accepting drops the
> **[judgement part]** ("the customer's probe point" — a first-encounter concept card logged
> to the codex) onto the **same board**. No mode switch, no new screen.

[game-contracts-economy.md §5.1]'s "each completed example issues a contract of that family"
is the durable seam: finishing [led-limit] offers an LED-spec contract; finishing [rc]
offers an RC-timing contract — **examples → contracts, one chip each**.

### 2.4 The seam into the tech tree — no cliff

The greyed locked shelves are the **visible progress bar from minute zero**
([game-progression §1.1]). The bridge that prevents a gate-feel is the **eureka discount**
([§5.2]): playing a ramp rung that demonstrates a phenomenon **discounts the matching
tech-tree node before the player ever takes that contract**. A beginner who tinkered up
R0–R3 has already pre-paid the first crossings without a single "lesson."

> **Recommendation (binding for this panel):** the first one or two era crossings are
> **Lux + eureka ALONE, NO competency exam**. The mandatory exam — which
> **[game-progression §3.2]** currently folds into *every* tier's unlock recipe — belongs only
> at **THE WALL** (Era 4, active tier), never at the seam. **This panel feeds that back as a
> constraint on [game-progression §7 open-Q #2]** (where to place the exam). The ramp **pulls**
> the learner up rather than walling them.

### 2.5 Category boundaries as chapter breaks (no new structure)

Use a category boundary as the natural "you've finished a chapter" beat in the "next rung"
chip (*"That's Fundamentals — want Sources & Current, or chase a phenomenon?"*). The owner's
two opinionated calls stand ([master-brainstorm §3.1]): **AC is a parallel side-rail**
(offered, not in the main DC ramp), and **"Logic from Transistors" precedes "Logic & ICs"**.

### 2.6 The part-by-part build pattern carries the multi-part rungs (reuse, don't invent)

The [buck] "build broken → see what's missing → add the part → see it fixed" structure, and
[rc] step 5 firing "a charged cap is an open not a short" *as the current fades*, are the
template for every later rung. The ramp **points at** them; a 3-part divider → multi-part
buck feels like the **same verb at higher amplitude**, not a new game.

### 2.7 Retention seam — why the ramp doesn't end at "now what?"

The first [Lab Notebook] page fires **before** Credits and any contract. The ramp's terminal
state is **not** "tutorial over" but *an unfinished codex + a greyed tree + a standing-
contract drip*. The "next rung" chip is reframed at the seam to "the Probe found 2 things
nearby to try," so **one affordance carries the learner from rung 1 to hour 10** without
becoming a level menu.

### 2.8 All-ages matrix for the ramp

| Persona | How the ramp is experienced |
| --- | --- |
| **Tablet Twosome** | Not climbed as curriculum — the dyad **grazes the spectacle layer** of R0–R3; the chip is **caregiver-facing** (a short, voiced line); the codex reskins as a sticker book so *collecting* replaces *progressing* |
| **Curious kid** | Climbs by **following spectacle**, not order; the chip defaults to the highest-spectacle adjacent rung with a glyph + one-clause body. The divider's math is framed as "a knob picks a fraction of the push" — algebra only in the pulled drawer |
| **Teen / classroom** | The graded campaign that never feels like levels. The assigned divider **is** the first contract; routes primer→divider with "do" visible and "why" pull-only, so seeded numbers bite against **comprehension**. A re-assigned week walks divider → led-limit → a logic rung |
| **Adult novice** | Category-boundary chapter beats give "where am I" without a menu; the four-stage scaffold is the explicit ladder; codex + standing-drip is the return reason |
| **Expert EE** | The ramp is **invisible**. The chip self-mutes on the first advanced action *before* it fires; the EE skips to the divider-as-real-contract and chases Gold. First tree crossing **eureka-waives** the exam |

---

## 3. The DURABLE COACHING SYSTEM — the Probe as one teacher across the whole game

Coaching is **not a tutorial that ends**; it is a thin, always-available **layer you PULL
on** — one **voice** (the Probe), one **mute** ([explainAsYouGo]), one **memory**
([seenConcepts] ⇄ the [Lab Notebook] codex). A first-encounter concept card and a codex page
are the **same** phenomenon-keyed event ([onboarding §10.1] + [game-progression §5.1]).

### 3.1 One voice, one register set

Today coaching prose lives in three voices — `partInfo.ts` `plain()`/`headline`,
`examples.ts` `blurb`/`watch`/`why`, the §2 coach-mark drafts. **Unify them under the
Probe** as the single narrator skinning every surface. The Probe never changes personality
across hour 1 → hour 10 — **that consistency is the all-ages through-line**.

### 3.2 The single state (extends [onboarding §10.4], adds nothing)

| State | Role |
| --- | --- |
| `explainAsYouGo` (mute family) | gentle-on default, instantly mutable; changes **whether/how** the Probe narrates, never **what** is reachable |
| `seenConcepts: Set<conceptId>` | de-dupes cards once each; the codex's memory |
| persistent [Explain/Help] handle | **routes** to existing surfaces; ambient insurance, unused by an EE |

`explainAsYouGo` and `seenConcepts` **already persist** to local storage [storage.ts:28,30];
the persistent handle is ambient UI. The *new* persistence work (§7) is the **board + bin +
notebook** — **not** these two. The coaching state budget is therefore **unchanged from
[onboarding §10.4]**, closing the EE/maker re-entry gap with the board/notebook save, not new
coaching state.

### 3.3 The authoring registry (one `coaching.ts`, mirroring `partInfo.ts`)

Resolves the §9.7 "where does coach-mark copy live" hand-off:

```
// content (data) — one row per concept, NO behaviour
{ id, trigger: triggerId, codexPage, short, body, why?, glyph }
// logic (code) — a separate map keeps the data table free of predicates
TRIGGERS: Record<triggerId, (snapshot) => boolean>
```

- The **content table holds no behaviour** — it names a `trigger`; the `fires` **predicates
  live in a separate code map** (the `partInfo.ts` data/logic discipline). Each predicate is
  **pure over the once-per-frame snapshot** read via the **shared sampler** (§10 —
  `electricalMap` + the `state` Float64Array): golden-safe, no new wasm crossing, no hash touch.
- `short` = one clause (≤ 7 words) + glyph, for low-reading/young pulls.
- `body` = the `plain()`-register clause. `why?` = the pulled second tier — **algebra lives
  ONLY here**.
- The **same entry feeds the card AND the codex page** — built once.

### 3.4 Fire-once, three effects, emergent order

A concept fires the first time `fires(snapshot)` is true **and** `id ∉ seenConcepts`. On
fire: **(a)** the Probe offers the card (unless muted), **(b)** `seenConcepts.add(id)`,
**(c)** the codex page fills + one-time [Lux] — **one event, three effects**. Order is
**emergent from play**. Cards fire one-at-a-time, never mid-drag, always dismissible,
**never block Run**.

### 3.5 The pull-ladder per surface (calm default, depth one tap away)

```
Probe offers `short`
   └─ pull the card → `body`
        └─ pull again (ⓘ / I-hotkey) → info drawer: `why` / equation / Right-now / ratings / Real cutaway
```

A 9yo stops at `short`; an EE skips straight to the drawer's Real tier. **One artifact,
self-selected by pull depth.**

### 3.6 The two-tier reading register — not a content fork

Every card carries `short` (one clause + glyph) **and** `body`. [explainAsYouGo] gains a
"short + (later) spoken" setting in the **same mute family** — **not** a separate kids track,
**not** a level. **This is the all-ages lever:** a caregiver and an adult novice read
different *depths of the same entry*.

### 3.7 The sticker-book skin of the codex (for non-readers)

The same phenomenon-fill event renders as a **filled slot + glyph + chime** for a pre-reader
(zero reading); the write-up is the adult's optional pulled layer. **One codex, two skins by
pull** — never two notebooks.

### 3.8 Graceful recession — competence detected, never interrogated

- **The first advanced action auto-mutes** [explainAsYouGo] (full bin, Tier-II arm, expert
  hotkey, value-popover More-values, Real-tier select). The **implicit-skip must fire BEFORE
  the first card** — an EE who opens the full bin in 20 s never sees "this pushes current."
- **Recession is also passive:** as `seenConcepts` fills, fewer cards have anything left to
  fire, so coaching thins toward only the [Explain/?] handle. **No mode, no countdown.**

### 3.9 The codex as the retention spine (the between-sessions hook)

On re-launch the Probe offers a **codex-keyed nudge** — *"you've found N of M; here are 2
nearby to try"* — distinct from the contract-shaped daily ([game-rewards §7]). (Specified in
§6.)

### 3.10 All-ages matrix for coaching

| Persona | What they pull |
| --- | --- |
| **Tablet Twosome** | only `short` + the sticker-book codex; caregiver voices `short`/`body`; the "short + spoken" setting (once TTS exists) voices the authored strings so the adult isn't the bottleneck |
| **Curious kid** | rides the **auto-coaching** path — cards fire on accidental phenomena and log to the codex with a Lux ping (the one place coaching reaches a non-puller); `why`/algebra stays pulled-only |
| **Teen / classroom** | mutes fast, pulls [Explain/?] once per surprising number; the codex is completion/status; failure reads as private ("—"); the codex is the come-BACK spine |
| **Adult novice** | rides the full pull-ladder short→body→why→drawer at their own pace; the codex is their durable record |
| **Expert EE** | implicit-skip auto-mutes **before** the first card; pulls only the deep end; the [Explain/?] handle sits unused. **Proof the spine works:** identical sandbox to the 5yo, differing only in pull depth |

---

## 4. ALL-AGES ADAPTATION without levels — pull-not-pick made concrete

The adaptation is **behavioural and PULLED, never chosen**. Age and skill are not
declarations — they are revealed by what the player *does*: which target they read (a glowing
bar vs a number), which input they use (big-tap vs precise drag), whether they touch the
explain layer, whether a second pair of hands is present. The system adapts the **same
content's presentation**, never its **reachability**.

This extends [onboarding §10] with **one added rule**: a small, legitimate **PREFERENCES**
cluster (input / voice / motion / reading-register) lives inside the [explainAsYouGo] family,
is **auto-seeded by behaviour**, always mutable — but **never gates anything**. A **TIER**
(any setting that changes *what* is reachable, the difficulty, the goal, or the bin) is
**forbidden**.

### 4.1 The enabling principle — the dual-form target

Every gradeable/teachable target is authored **once** as a value plus **two renderers**: a
**NUMERIC** form ("set OUT to 3.3 V") and a **BY-FEEL** form (a [voltageColor] segmented LED
bar / standpipe to fill to a **notch**; a brightness to match; a "kill the smoke" state).
Both read the **same once-per-frame snapshot the sibling's grader samples** (§10 — no new
wasm crossing). **By-feel is default-
prominent**; the exact number sits beside it dimmed and is **promoted the instant the player
edits a number** via [value-pop]. *Reaching for the number IS the pull that says "I read
numbers."*

**Changed-numbers, non-numeric variant (binding, coordinated with [probe-teaching-arc.md]):**
the seeded anti-copy generator must change a **visual** target for a pre-reader — the
reference LED's brightness, the notch height, the part that must stop venting. The grader
still samples node V / branch I at the [judgement part] pins; satisfied when the live bar
reaches the **seeded notch**. **A child matching a bar and an EE hitting 3.300 V exercise the
IDENTICAL hidden reference netlist** — neither can copy a neighbour.

### 4.2 The Probe's three voice states (one store)

| State | For | Mechanism |
| --- | --- | --- |
| **SILENT-TEXT** (default) | reader / EE who never pulls audio | on-screen text only |
| **VOICED** | pre-reader, ELL, low-vision, tired caregiver | presentation-only TTS of authored `plain()` + card strings, keyed by id |
| **MUTED** | the EE | existing [explainAsYouGo] = off |

VOICED is **auto-OFFERED, never forced**, the first time a phenomenon card fires AND a
coarse-pointer / large-tap signal is present; one tap arms it for the session.

### 4.3 By-feel vs numeric · voiced vs text · big-tap vs precise · caregiver co-play

- **By-feel vs numeric** — §4.1; neither ever hidden from anyone.
- **Voiced vs text** — §4.2; voice is always an **addition** over visible text.
- **Big-tap vs precise** — coarse-pointer / mis-hit signals auto-arm a **TOUCH-FIRST** input
  preference: enlarged hit-areas, **tap-pin → tap-pin** wiring, pinch-zoom that **yields to**
  the wire gesture, and a **guaranteed-Run rule** (a stray tap starts the sim rather than
  opening [value-pop]/[info-drawer] — the Twosome's whole hook is the dark→alive flip on a
  poke). Fine-pointer + precise drags + an expert hotkey leave this **off**.
- **Caregiver co-play** — voiced + large-tap (the co-play signature) surfaces a quiet
  **GROWN-UP** affordance inside the same [Explain/Help] handle: read-aloud on, enlarged
  targets, an optional adult-facing one-liner. A **different pull**, symmetric with the EE's
  mute. The codex reskins as the sticker/trophy surface (§3.7).

### 4.4 The "more/less explanation" knob is a MUTE, not a tier

| Position | Behaviour |
| --- | --- |
| **MORE** | voiced + short-or-full on pull |
| **GENTLE** (default) | silent cards offer themselves |
| **OFF** (the EE's mute) | nothing fires |

**This is the single [explainAsYouGo] mute family — a *coaching-verbosity* knob, NOT a
difficulty selector.** Everything — full bin, first contract, every example, the deep
drawer — **stays reachable in all three positions for everyone**; the knob changes only *how
much the Probe says*, never *what you can reach*. It is the one labelled selector in the whole
system, and it is legitimate **precisely because it gates nothing** (a three-position
*reachability* selector would be the forbidden tier; this is its inverse).

### 4.5 The small legitimate preference set vs the FORBIDDEN tiers

| ALLOWED (presentation / input / voice / motion / a11y — auto-seeded, instantly mutable, **none gates**) | FORBIDDEN (smells like a tier/level) |
| --- | --- |
| reading register (short+glyph / full prose) | a difficulty / age / grade picker |
| Probe voice (silent / voiced / muted) | a narrowed-vs-full bin chosen as a **mode** |
| input mode (precise-drag / big-tap touch-first) | goals or **tolerances** that differ by "level" |
| motion (full / calm / still — wired to [FLOW_HZ] + prefers-reduced-motion; **slow, not stop**) | gating any example / contract / part behind a setting |
| colour-independence ([voltageColor] + slate-#8 pattern; magnitude already off-hue) | a quiz / exam that **blocks** |
| aria-live telemetry track (a screen-reader mirror of the snapshot) | hiding the numeric form, or the by-feel form, from anyone |

> **On the narrowed bin (the one ambiguous case):** a *guided build* may **contextually** show
> only the parts that step uses (the [onboarding §7] stage-1 prop set). That is a **pulled,
> expandable default — identical for a 5-year-old and an EE — with the full bin one tap away at
> all times.** What is **forbidden** is a narrowed bin **locked as an age/difficulty mode**.
> Context-narrowing ≠ a tier; the test is "can anyone expand it right now?" (yes ⇒ allowed).

### 4.6 Auto-seeding, never interrogating

| Signal | Quiet offer (with visible undo, fired once) |
| --- | --- |
| coarse-pointer + mis-hits | offer big-tap + voiced |
| full-bin open / Tier-II arm / expert hotkey | **mute coaching and retire cards BEFORE they fire** |
| dismissed N full cards unread | drop to short register |
| editing a number | promote the numeric form |

### 4.7 The all-ages adaptation matrix (each act across the spread)

| Act / rung | Tablet Twosome (5–7, pre-reader) | Curious kid (9–12, no algebra) | Teen (13–17, assigned) | Adult novice | Expert EE |
| --- | --- | --- | --- | --- | --- |
| **Cold open (R0 primer)** | first-poke-**Runs**; dark→alive with zero reading; voiced offer if coarse-pointer | autoplay arrows + glow; poke-a-number | reads "a thing, not a worksheet"; one-clause banner never blocks Run | gentle silent cards offer themselves | primer is a placeholder; implicit-skip arms on first advanced action |
| **R1 divider / first contract** | grazes the spectacle (lift R2); contract invisible | "knob picks a fraction" — **no algebra shown** | the **assigned** task; seeded numbers bite against comprehension; Bronze | builds by feel, verifies by number | a real seeded spec; chases Gold |
| **R2 pot-dimmer** | the **[POT] slider** is the whole toy; by-feel | by-feel brightness; demo toggle first-class | by-feel + numeric; pulls drawer on surprise | both forms; predict-then-reveal | numeric only; verifies fidelity |
| **R3 fork** | grazes [led-limit] spectacle; sticker on first light | follows spectacle to whichever bangs | logic rung later = "build a computer part" | category chapter beat = "where am I" | skips to what he came to build |
| **Failure / smoke** | re-requested spectacle; sticker fills | repeatable verb in the Test Bench | autopsy→Lux = goofing is curriculum; private failure | autopsy as a lesson | "oh, it models real ratings" |
| **Explain layer** | `short` + voiced, caregiver-conduit | `short` + glyph; auto-coached via codex | on-demand once per surprising number | full pull-ladder at own pace | deep drawer only; coaching muted |

> **Resolved conflict:** where "spectacle for a 5yo" and "fast bench for an EE" pull against a
> single default, the **default favours all-ages reach** (by-feel prominent, gentle coaching
> on, first-poke-Runs) and the EE's **implicit-skip** retracts it instantly on the first
> advanced action. We do **not** add a picker to reconcile them — the pull does.

---

## 5. ACCESSIBILITY & REACH spec — the checklist

Accessibility is the **same lever** as pull-not-pick. Every reach affordance routes through
the existing always-available coaching layer and prose substrate — never a new mode, level,
or upfront a11y picker. All of it is presentation-only and golden-safe. **The single
highest-leverage move is voicing the already-authored `plain()` strings.**

> Companion doc: this section seeds a standalone **`docs/ui/accessibility-and-reach.md`**.

### Axis 1 — Reading load & the pre-reader path

- [ ] **Reading-load is a measurable contract.** Card BODY = one clause, ≤ 12 words; welcome
  line = one clause; `BuildStep.do` = one imperative clause; `BuildStep.why` = pull-only.
  `plain()` is the pulled-deep register. Resolves [onboarding §9 open-Q2] toward minimal
  default text for **every** persona.
- [ ] **Short-copy register** — one-clause + glyph variant keyed by the **same id** (a second
  field, **not** a content fork).
- [ ] **Pre-reader cold open** — Run is the largest glow-on-load target; a stray tap **Runs**,
  it does **not** select a part and throw up the 340 px [.info-drawer]; pair with one adult-
  facing line.
- [ ] **Sticker-book [Lab Notebook] skin** — glyph + chime per phenomenon; write-up demoted.

### Axis 2 — Motion reduction (incl. the CANVAS)

- [ ] **Today's gap:** `app.css` ~L1138 `prefers-reduced-motion` only quiets HUD/CSS chrome,
  **not** the PixiJS canvas flow.
- [ ] **Wire the flow clock to the OS query:** default to **CALM (slow), NOT STILL** — a
  frozen board kills the hook. Offer **full | calm | still**. *(`FLOW_HZ` is today a
  module-private `const = 0.6` [board.ts:194]; this needs it promoted to a settable/guarded
  value — a small new surface — golden-safe, since the flow clock never feeds the sim.)*
- [ ] **Motion-budget policy:** every animated cue collapses to an instant state change under
  reduced motion. **Motion is never the sole channel.**

### Axis 3 — Colour-vision safety

- [ ] **Confirmed redundancy** ([visual-language.md]): voltage **value** never rides on hue.
  **A colour-blind learner can read every value today.** The gap is **identity, not
  magnitude**.
- [ ] **Rail IDENTITY is hue-only** ([voltageColor]). Implement [slate #8, "not optional"]:
  pair each rail hue with a per-rail **pattern/texture**, toggled by `railPatterns`, default
  on under a colour-vision pull. Patterns **pair with**, never replace, the hues.
- [ ] **Non-hue redundancy audit** for FAIL boxes, `--ok`/`--warn`/`--bad`, op-amp tokens.
  Add a high-contrast HUD option.

### Axis 4 — Voiced Probe + captions

- [ ] **Voice the Probe** (highest-leverage; app has **no audio today**): presentation-only TTS
  of `plain()` + card bodies, keyed by id, gated by `readAloud`. Golden-safe; never drives
  sim input. **Voice direction (owner):** a deliberately **retro, clearly-robotic TTS** (old
  Microsoft "Sam"-era) — see §9 #7.
- [ ] **Audio is never the sole channel.** Every cue has a visual equivalent. **Captions:**
  read-aloud text **is** the on-screen card; non-speech sonification gets a visual caption.

### Axis 5 — Input across touch / mouse / keyboard-only / switch

- [ ] **Touch-first wiring** — a **tap-pin → tap-pin** alternative; enlarged hit-areas on
  `pointer: coarse`; pinch-zoom **yields to** the wire gesture.
- [ ] **Keyboard-only path** — extend the `role=toolbar` [hotbar]; a keyboard wiring path
  (focus pin → Enter → target → Enter); transport + `I` + tool-switch hotkeys; the global key
  handler **early-returns on INPUT/TEXTAREA**; Esc closes the ladder.
- [ ] **Switch-access** — keyboard path + single-switch scan; linear focus order; the canvas
  stops being an aria-hidden island (Axis 7).

### Axis 6 — Low-end device / perf

- [ ] **Target a sustained interactive frame rate** on a low-end Chromebook for the
  Fundamentals circuits — *proposed budget: ≥ 30 fps sustained on a ~2019 ARM/Celeron
  Chromebook for a ≤ 12-element circuit* (a concrete figure to confirm by measurement, not yet
  benchmarked).
- [ ] **Tiered/static render fallback** — degrade the *presentation*, never the physics (fewer
  chevrons, capped density); **doubles as** the motion "still" state. PWA/offline + no-account
  link entry [roadmap §20].

### Axis 7 — Screen-reader semantics (an accessible PARALLEL readout)

- [ ] **Today:** the canvas is `aria-hidden`/`tabindex=-1` — the core experience is
  **invisible to AT**.
- [ ] **MVP first cut (concrete, shippable):** an `aria-live="polite"` region announcing the
  **selected** part's V/I (from `electricalMap`) plus the **loop-closed / FAIL** transitions,
  debounced ≈ 2 Hz. Small, uses only existing reads.
- [ ] **The hard part (handed off — undesigned here, the honest hardest axis):** a full
  board→prose engine, i.e. the **state-to-prose mapping** (node→label, element→state-word,
  change-debounce) that narrates the *whole* board ("Loop closed — current flows. OUT settled
  to 3.3 V. LED is lit.") off the same once-per-frame snapshot. No parallel model; ≈ 2 Hz;
  announce **state changes**. Scope + own this in a dedicated screen-reader/keyboard panel
  (§9 #16).
- [ ] **SR a11y contract for every coaching surface** (focus order, announce-on-fire,
  dismiss-by-keyboard), reusing the established primitives.
- [ ] **Privacy of failure** ([incomplete-circuits.md]): "—" + a located hint — a **private**
  diagnostic, never a public wrong answer; also the SR-honest path.

### Axis 8 — Localization / i18n

- [ ] **Externalize strings** keyed by id, reusing the **same id space** as card/`partInfo`/
  read-aloud/codex (one id space serves dedupe, narration, **and** translation). The prose/
  number split keeps static prose reflow-free. Add `lang`; RTL mirrors layout, **not** the
  schematic. Localized TTS falls out for free.

### A11y all-ages matrix

| Persona | Leans on |
| --- | --- |
| **Tablet Twosome** | every axis at once — voiced Probe, short-copy, sticker-book codex, guaranteed-Run, touch-first wiring, **calm** (not still) motion, rail patterns, the grown-up co-play pull |
| **Curious kid** | short-copy (#1), voiced Probe, forgiving wiring, low-end fallback, canvas reduced-motion, rail patterns, a loud Show-solution escape |
| **Teen / classroom** | low-end + touch are **modal, not edge** (blocking deps); reading-load budget; ELL/plain-mode; silent-classroom operation; colourblind-safe rail identity; **privacy of failure**; no-account link entry |
| **Adult novice** | adult-prose register by default; optional read-aloud; aria-live if low-vision; session persistence; high-contrast HUD |
| **Expert EE** | keyboard-first power-use; an expert no-Probe-chrome / jump-to-equation view; motion control to cut noise; colourblind-safe rail identity; dense-display legibility; localization. Implicit-skip keeps the a11y layer dark unless pulled — symmetric with the caregiver enabling read-aloud |

---

## 6. HOOK & RETENTION — for an audience with zero prior interest

Two nested loops, both already half-built in-tree.

### 6.1 The moment-to-moment satisfaction loop — POKE → CHANGE → CAUSE → AGAIN

- **POKE** = a touch/click on a part, a value chip [.value-pop], the [POT] slider, a [demo]
  one-toggle, or [Run].
- **CHANGE** = the board answers **within the same frame** (arrows speed on [FLOW_HZ], hue
  shifts on [voltageColor], an LED brightens, a part vents).
- **CAUSE** = unambiguously tied to the player's own poke — **the "I did that" beat, the whole
  hook.**
- **AGAIN** = the repeat affordance is already under the finger; the loop closes in < 2 s with
  zero reading. Reachable by a **random poke**, not by reading a banner.

**Three guaranteed AGAIN affordances (all in-tree):** the **[POT] slider** (strongest zero-
reading loop), the **[demo] one-toggle**, and the **value stepper** [.value-pop].

> **Design ask:** promote `demo` + slider to **first-class prominent affordances** on the
> first ~5 rungs — currently buried.

**The cold open as ignition** — brief autoplay then pause; "success shown before it is
numbered." **Guarantee the first poke RUNS, not selects.**

**Failure-as-fun is a VERB, not a gag.** The scripted blow-up is owned by
[probe-teaching-arc.md]; **this panel owns its durable home** — the permanent **[Test Bench]**,
surfaced as a **kid on-ramp** ("break stuff here, nothing is lost"). Every vent is
deterministic = a repeatable lesson; the **[autopsy] pays [Lux] + a failure-mode codex page**
— *paid in understanding* for breaking it. **Build vent + autopsy together or not at all.**

**Time-as-a-toy** (run/pause/single-step/scrub) is a satisfaction multiplier from minute one;
transport lives in the always-visible HUD; scrubbing is itself a CHANGE.

**Predict-then-reveal** is the contract-free mastery rung: an optional one-tap guess; a close
call pays [Lux] with zero quiz-feel — the teen's "I called it and physics agreed" flip. An
invitation in the margin, never a gate, never a public wrong answer.

### 6.2 The first self-caused anchor — "I made it work"

- The **dark→lit flip on loop-closure** is both the lesson and the celebration; the
  destination is [pot-dimmer]/[led-limit] — light **they** caused. Anchors before any number,
  name, or contract.
- **Graceful no-goal closure** — on each self-caused win, a kid-legible "we did it!" (the
  [SHIP IT] cascade at a **lighter** register) and **persist the board on exit**. The
  celebration is for **causing**, not for completing a spec.
- The **first [Lab Notebook] page fires in the first session**, from accidental phenomenon-
  causing, **before** any Credits or contract.

### 6.3 The session-to-session return loop — the day-2 reason

- **The codex as a collection with visible blanks** — chased with **zero contracts**; the
  blanks **are** the standing goal. No streak, no timer; missing a day costs nothing.
- **The codex-keyed relaunch nudge** — one low-pressure Probe line (*"You've found N of M. I
  spotted 2 things nearby — want to see?"*) pointing at phenomena reachable from the last rung.
  Dismissible, **never guilt-framed**. Distinct from the contract-shaped daily.
- **Eureka discount as the silent return-reward** — yesterday's free play discounts the next
  node; surfaced gently ("the rectifier shelf is cheaper now") — a delight, not a nag.
- **The greyed shelves** are the second visible progress bar; on return they show what got
  closer.
- **Caregiver-mediated return** — the nudge gives the **adult** a reason and the **child** a
  craving; the sticker-book is the child's drive, the spoken one-liner the adult's low-labor
  re-entry. **No caregiver guilt mechanics.**

### 6.4 The no-dark-patterns charter

| BANNED | In-tree alternative |
| --- | --- |
| punishing streaks / "you'll lose your progress" | codex blanks simply **wait** (loss-free) |
| energy / timers / login-drip | the bench is **always fully available** ([game-rewards §8]) |
| FOMO / limited-time | the daily seeded contract is **optional**, ghost-replay-driven, never expiring |
| pay-to-skip-understanding | [Lux] is **non-purchasable** ([game-progression §0]) |
| public wrong-answer shaming | the honest-read "—" keeps failure **private** and diagnostic |

The **one allowed "pull"** is the relaunch nudge: a single dismissible Probe line, never a
modal, never repeated within a session, muted by [explainAsYouGo].

### 6.5 The Probe as one voice across both loops

The Probe narrates the card, the celebration, the codex write-up, the relaunch nudge, and
(when voiced) the read-aloud — **one mascot = the all-ages through-line.** Highest-leverage
golden-safe reach: **voice the Probe** (§5 Axis 4). A **short-copy register** serves the
5yo/9yo and an adult by what's **pulled**, never a separate kids track.

### 6.6 Retention all-ages matrix

| Persona | The arc for them |
| --- | --- |
| **Tablet Twosome** | rides the satisfaction loop almost entirely with zero reading; codex-as-sticker-book is the collection drive; return is caregiver-mediated. Anchor = delight + agency |
| **Curious kid** | the Plateau-1 spree — satisfaction loop + codex completionism; ignores contracts; return = visible blanks + the codex-keyed nudge; failure-as-fun is the highest-retention surface |
| **Teen / classroom** | comes in via assignment; hands off to a come-BACK pull (collection, predict-then-reveal, break-stuff-and-get-paid) **before the obligation expires**; privacy-of-failure is the anti-churn need; Bronze passes, Gold is the flex |
| **Adult novice** | the alive-bench converts skepticism; the anchor is the first self-caused build at speed; the nudge restores last board/notebook |
| **Expert EE** | pulls almost none of the scaffolding, never gated/quizzed; the loop reads as a fast bench; return = "fastest honest bench, my last board is waiting." Nudge + cards muted by the first advanced action. **Same sandbox, different pull** |

---

## 7. Reuse vs new surface

| Concern | Existing machinery (carries the load) | Smallest new surface |
| --- | --- | --- |
| **The curriculum ramp** | ordered [EXAMPLES] + [EXAMPLE_CATEGORIES] (`examples.ts`); [ExampleSpec] Watch/Build/demo; `startBuild`/`advanceBuild` + `guided-done`/`p.complete`; the §6 5-minute beat script; the §5 minimum-model card table | **a `RAMP` table** beside EXAMPLE_CATEGORIES in `web/src/lib/examples.ts` feeding **one dismissible "try this next →" chip**; only R0–R3 bespoke, rest default to category order |
| **The coaching registry** | [explainAsYouGo] mute + [seenConcepts] set (already persisted [storage.ts:28,30]) + persistent [Explain/Help] handle ([onboarding §10.4]); the once-per-frame batched snapshot (`electricalMap` + the `state` Float64Array) | **one `coaching.ts`** (content `{ id, trigger, codexPage, short, body, why?, glyph }` + a **separate** `TRIGGERS` predicate map); the **shared sampler** (§10, new code landing with the sibling's grader); the Probe-voice skin over existing surfaces |
| **The concept-card system** | first-encounter cards ([onboarding §10.1]) + `partInfo.ts` prose-number split | **a `short` + `glyph` field** on each card record (one field, not a fork) |
| **The Lab Notebook** | the phenomenon-keyed page store ([game-progression §5.1]); the [Lux] faucet | **a sticker-book render skin** + **a re-launch codex nudge** |
| **The a11y / voice layer** | `app.css` reduced-motion (HUD); [FLOW_HZ]; [voltageColor]; [incomplete-circuits.md] "—"; value-popover spinbutton/`aria-valuetext`; drawer Tab/Esc; PWA/no-account [roadmap §20] | **voiced-Probe TTS** (id-keyed); **the prefs cluster** under the Explain handle; **per-rail pattern** in `board.ts`; **reduced-motion wiring of [FLOW_HZ]** + calm/still control; **the aria-live telemetry track**; **a keyboard/touch wiring path**; **the i18n string-table seam**; **the static/reduced-flow low-end fallback** |
| **The by-feel target mode** | the **shared sampler** (§10) + the SHIP IT green tolerance band; [voltageColor] bar/standpipe; [value-pop] stepper as the "reach for the number" signal | **a `byFeel` renderer** (notched bar / standpipe / brightness) reading the existing snapshot; **a `byFeel` field** beside the numeric spec line |
| **Session persistence** | local-storage settings ([explainAsYouGo]/[seenConcepts] already persist [storage.ts:28,30]) | **persist** last board + bin + notebook on launch (the §10.4 coaching settings already persist — this adds only the board/bin/notebook) |

> **Every new item is a read-only consumer of the once-per-frame snapshot + static prose.**
> None touches sim-core, the netlist, or the snapshot hash. No new physics, no third
> currency, no new screen, no level/picker/gate.

---

## 8. Determinism & golden-safety statement

Everything in this panel is **presentation/UX + local-state only**, in the same discipline as
`carrierOffset`/phase — **golden rule #1 (determinism is sacred) and #2 (coarse JS↔wasm
boundary) are honoured throughout.**

- **No sim-core, netlist, or `snapshot_hash` change.** The ramp is a *reading-order* over
  existing [ExampleSpec]s (each already a BoardGraph the **unchanged** solver runs) plus one
  static-table chip. The dual-form/by-feel target, its notch, and its tolerance band are
  **read-only consumers** of the existing once-per-frame batched snapshot [loop.ts] and the
  **same** node-V/branch-I samples the sibling's grader greens (§10).
- **No per-component wasm crossing.** Every coaching number, `fires(snapshot)` predicate,
  codex detector, and relaunch-nudge computation reads the **once-per-frame** snapshot via the
  **shared sampler** (§10 — `electricalMap` + the `state` Float64Array; a thin read-only
  assembler, *new code* but **no** new wasm crossing). Any detector needing a new scalar folds **one** value into that
  snapshot and stays **out of** `snapshot_hash` (it only flags/narrates, never alters the
  solve) — the §7.5 determinism review applies to any predicate reading `node_v`.
  `failed_elements`-style flags stay unhashed.
- **The flow clock is already presentation-only** and must never feed the sim
  ([visual-language.md]); slowing/freezing it is **bit-identical**. The static/reduced-flow
  fallback degrades the *render*, never the physics.
- **Accessibility never DRIVES inputs.** Touch hit-areas, tap-to-wire, and the keyboard wiring
  path produce the **same BoardGraph** a mouse would — they are `board.ts` input handling, not
  scripted/timed solver inputs, so they never hash. Voiced narration, short-copy, the
  aria-live track, and i18n are read-only over authored strings keyed by id.
- **No new currency.** Codex/autopsy [Lux] is the existing understanding currency; the
  firewall (Lux non-purchasable) is untouched. **Local state only:** `explainAsYouGo`,
  `seenConcepts`, the prefs cluster, and persisted board/bin/notebook are local UI state, not
  hashed.

`cargo test -p sim-core`, `run_is_reproducible`, and the FNV-1a golden are **not in scope to
change.** Pull-not-pick is preserved end to end: every affordance is an always-available layer
toggled by what you pull (full bin + first contract reachable without any tutorial), never a
level, tier, mode-you're-in, or upfront picker.

---

## 9. Open questions / owner hand-offs

1. **R3 fork default direction.** [led-limit] (spectacle) or [rc] (scope curve) as
   pot-dimmer's lead "next →"? *Recommendation:* offer **both** as equal chips; do not pick a
   default. **Owner call.**
2. **"Next" chip copy register & voicing.** Ship the short-copy + glyph + read-aloud variant
   from day one, or text-first? *Recommendation:* author `short` alongside `line` (one field),
   default short under [explainAsYouGo]. **Hand-off to the read-aloud/TTS owner.**
3. **RAMP authoring shape.** Confirm only R0–R3 get hand-written `line`s; the rest (~47 of the
   ~50 examples) inherit next-in-category order. **Owner confirm.**
4. **First tier-crossing exam policy.** Confirm the first one or two crossings are **exam-free
   (Lux + eureka)** and the exam wall is **Era-4-only**, resolving the §3-vs-§10 contradiction
   in the post-intro learner's (and the EE's) favour. **Owner call.**
5. **Auto-mute trigger set.** Which actions retire cards *before* they fire? *Recommendation:*
   the five named (full-bin open, Tier-II arm, expert hotkey, More-values, Real-tier select).
   **Owner confirm.**
6. **Reading register default.** Ship `short` as the default for **all** pulls (adults then
   pull `body`), or detect behaviourally? *Recommendation:* short-default with `body` one pull
   deeper — never a picker. The ≤ 12-word cap and "is the welcome line too much" ([§9 open-Q2])
   remain open. **Owner confirm.**
7. **Read-aloud voice source — DIRECTION (owner, 2026-06-25): a deliberately *retro, robotic*
   TTS** (the old Microsoft "Sam" / SAPI4-era voice), not a warm VO — on-brand for the bench-bot
   + Critical**Error**Computing (see [probe-teaching-arc.md] §9 #11). *Engine still TBD:* browser
   `SpeechSynthesis` tuned ugly (golden-safe, localizes with the string table) vs a small bundled
   retro-formant TTS vs pre-rendered clips. *Caveat:* a retro English formant voice may not exist
   per-locale, so non-English falls back to the platform `SpeechSynthesis` voice. **Owner picks the
   engine.**
8. **Reduced-motion default.** Confirm **CALM (slow), not STILL**, with an explicit `still`
   toggle. **Owner sign-off.**
9. **Rail-pattern vocabulary.** Which texture set maps to which rail without clashing with
   chevron density / the AC slosh? Needs a [visual-language.md] addendum + dc-bus-reference
   variant. **Hand-off to the visual-language owner.**
10. **By-feel tolerance parity.** Wider band for the notch, or identical? *Recommendation:*
    **identical band, two visual densities** (same grade, only legibility differs). **Owner
    call.**
11. **Seeded visual target ownership.** Is the notch height itself the per-instance seed
    (cleanest) or a separate visual seed? *Recommendation:* the notch **is** the seed.
    **Confirm with the [probe-teaching-arc.md] owner.**
12. **Relaunch nudge.** MVP scope (single line vs adjacency ranking), cadence (once-per-
    session, dismissible, suppressed when muted), and "personal best" predict-then-reveal kept
    strictly in-session (never a streak). **Owner + telemetry call.**
13. **Celebration register.** Reuse the full [SHIP IT] cascade for non-contract wins, or a
    distinct lighter glyph+chime so shipping a real spec still feels bigger? *Recommendation:*
    distinct lighter variant. **Owner call.**
14. **Session persistence granularity & no-server.** Persist board + bin + notebook + the two
    §10.4 settings; do **not** persist a "you have unseen nudges" badge. Confirm the day-2 arc
    is **fully local** (PWA, no account). **Owner call.**
15. **Co-play detection.** Is "voiced + large-tap armed" a strong enough signature, or is an
    always-present manual caregiver toggle needed? *Recommendation:* offer-on-signature + a
    manual toggle, never an upfront picker. **Content owner for the caregiver register.**
16. **aria-live verbosity & ownership.** Default density; on-by-default (noisy) vs pull-only;
    and whether the full keyboard traversal + the aria-live track belong here or in a
    **dedicated screen-reader/keyboard panel**. *Recommendation:* a thin spec here, full
    traversal **handed to a focused a11y owner**; determinism review required for any `node_v`
    detector ([§7.5]).
17. **i18n scope & RTL.** Confirm the translatable surface is exactly HUD labels + teaching
    prose, one shared id space across card/`partInfo`/read-aloud/codex/translation, RTL mirrors
    layout but **not** the schematic, externalization in-scope-later (not blocking). **Owner to
    prioritize.**
18. **Blocking dependencies for the classroom modal device.** Touch-first wiring and the
    static/reduced-flow low-end fallback are **modal, not edge cases** for the teen and 9–12yo;
    flag both as **blocking** for those journeys ([idea-bank §VI; roadmap §20]).

---

## 10. Dependencies / blocked-on

This panel is the *system* around the scripted hook; two hard dependencies are landed or
specced **alongside** it, not assumed pre-existing:

1. **[probe-teaching-arc.md] (the sibling panel) — lands together with this doc.** Several
   beats referenced here (the blow-up, the changed-numbers generator, the judgement
   part / grader) are **owned and specced by the sibling**; this panel references their
   durable homes but does not re-derive them. Neither doc should land without the other.
2. **The shared value-aware grader + snapshot sampler — a NEW web-side surface, specced in
   the sibling.** Every `fires(snapshot)` predicate, the by-feel target renderer, and the
   codex detectors read the **existing once-per-frame batched snapshot** — `electricalMap`
   (per-component V/I, already consumed in `App.svelte`) plus the `state()` Float64Array
   (node voltages, `loop.ts`). The "sampler" is a **thin read-only assembler over those
   existing reads + a small predicate evaluator** — it is **not** pre-existing machinery and
   is **not** a new wasm crossing, but it **is new code** that lands with the sibling's
   grader. Until it lands, the coaching predicates and by-feel targets are blocked on it.

No other hard dependencies: the ramp, the coaching registry's content, the codex skins, and
the a11y/voice layer are all read-only consumers of existing surfaces (§7, §8).
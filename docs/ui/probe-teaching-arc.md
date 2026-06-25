<!-- SPDX-License-Identifier: Apache-2.0 -->

# The Probe — A Failure-First, All-Ages Teaching Arc

> **Status:** design synthesis (presentation/UX + game-design only). **Touches no Rust, no netlist hash, no determinism golden.** See §8.
>
> **Panel inputs:** five design lenses (early-childhood play-first; teen/adult self-directed novice; expert/EE skip-path; instructional-design/cognitive-science; systems/feasibility/golden-safety), synthesized against the owner's blow-up → resistor → divider → randomized-build spine.
>
> **Sibling panel:** **[beginner-onboarding-all-ages.md]** owns the *system & journey* around this scripted hook — the curriculum ramp the hook seeds, the durable coaching system, the all-ages adaptation, the accessibility/reach spec, and retention. This panel owns the **4-act hook + its two new mechanics** (the magic-smoke blow-up and the seeded anti-copy generator + grader); the two docs land **together** and share one new web-side surface (the value-aware grader / snapshot sampler, specced here in §3).

---

## 0. Thesis, and what this panel DECIDES

**Thesis:** The first thing a new player meets is not a calm working loop — it is **the Probe's proudly-broken circuit, which they press Run on, which blows up.** Productive failure (on *his* board, never theirs) earns the attention that a calm cold-open cannot, then the arc pays that attention back as understanding: a current-limiting resistor, a voltage divider, and a build-from-scratch whose **numbers change per session** so copying the layout provably fails. The whole arc is the **voice of the existing pull-not-pick coaching layer** — pulled, mutable, never a wall — and is **golden-irrelevant** end to end.

**This panel DECIDES:**

1. **The cold-open is failure-first, and it supersedes the working-primer cold open** for the scaffolded path. Today `onMount` auto-loads `'primer'` (a healthy V→R loop) **PAUSED** [App.svelte ~2098]. This panel replaces that *as the front door of the pulled/scaffolded arc* with a **new resistor-less `'led-blowup'` ExampleSpec, also loaded PAUSED** — and, **OWNER-CONFIRMED (2026-06-25): fired only on the player's own Run, never auto-run.** The player *must press play* — that **teaches the transport** (how you start the sim) on their very first interaction, and makes the blow-up **self-caused yet blameless** (it's the Probe's circuit; they just hit go at his proud invitation). The spectacle is **armed-but-paused**, so a competent user who starts building never sees it. This **refines [onboarding-first-run.md] §1's** "auto-play-then-pause" beat (resolved in §9 #1) and is the diegetic embodiment of **[game-progression.md] §1's** "the bench dares you."

2. **The Probe is the persona of the [onboarding §10] coaching layer**, not a new system or a chosen level. He renders into the **existing pull-surfaces** (the `.intro-banner`, the `.guided-overlay` why-strings, the coach-mark/anchor overlay, the Lab Notebook concept cards), is governed by the **single `explain as I go` mute**, and **retires on detected competence**. He is *pulled*, mutable, never gated.

3. **Two genuinely new web-side surfaces are introduced** (everything else is reuse): a **magic-smoke blow-up presentation** layered over the existing FAIL mask, and a **per-session seeded parametric-target generator + value-aware "hit-the-spec" grader** that sits **beside** the topology-only completion oracle, never inside it.

**Relationship to the existing docs.** This panel is downstream of and bound by **[onboarding-first-run.md]** — especially **§10 (no levels; pull-not-pick; one sandbox)**, **§4 (show → name → number)**, and **§7 (competence is detected, not interrogated)** — and it fills in **[game-progression.md] §1's** opening (sandbox-primary, the first contract is an OFFER, Credits-vs-Lux, the Lab Notebook). Where the owner's phrase "players who self-select into the scaffolded experience" reads like a chosen difficulty bucket, **this panel resolves it in favour of §10: "self-select into scaffolded" means the learner repeatedly PULLS the Probe** (the always-visible example, the why-strings, the Lab Notebook) and falls out the instant they mute or arm a Tier-II part. **We say so explicitly and we chose this resolution on purpose** (see §5).

---

## 1. The Probe — the mascot persona

**Who he is.** The Probe is CEC's mascot from **criticalerrorcomputing.com**: a cute, floating **bench-instrument probe-bot** — a little scope-glass eye on a probe tip, breathing with a soft neon glow. In-game he is the **teaching persona / narrator**: the friendly character who *built the broken board*, *flinches when it pops*, *owns the oops*, and *coaches you to the fix*.

**Naming disambiguation (load-bearing — the code already overloads the word).** Throughout this doc and in code comments, **"the Probe" = the bench-bot mascot-narrator**, distinct from **the DMM probe leads** (`probeA`/`probeB` in [board.ts], "Probe it in Measure"). Owner to bless a final distinguishing label; until then the in-doc convention is **"the Probe (the bench-bot, not the DMM lead)."**

**How he's drawn — grounded entirely in the existing identity.** No new palette, no foreign sprite vocabulary:

- **Body:** built FROM the `.brand-mark` breathing-glow + the scope-glass + graticule motif — a probe tip given an eye and an idle bob. Tokens only: `--accent` (rose `oklch(.64 .255 350)`), `--energy` (`#ff8a3d`), the surface OKLCH stack.
- **Register of motion:** a gentle idle-bob + soft hum (the `led-breathe` idiom), **stilled under `prefers-reduced-motion`**. The one place he breaks calm — the slapstick blow-up flinch/flip — is **reserved for the diegetic cold-open**, never ambient (this is the anti-Clippy guarantee, §4).
- **Speech:** real **DOM text** in the established coach-mark register (Saira body, IBM Plex Mono for any telemetry), plus, for pre-readers, **picture speech-bubbles** (an LED+smiley glyph, a "speed-bump" resistor glyph, a target-bar glyph) and an **optional spoken voice layer** (voice direction, owner 2026-06-25: a deliberately **retro, low-fi robotic TTS** — the old Microsoft "Sam"/SAPI4-era speech, *clearly a robot*; on-brand for a literal bench-bot and for Critical**Error**Computing — see §9 #11) — all **captioned in real DOM text** (`aria-live` throttled ~2 Hz, screen-reader-legible, translatable). Meaning never lives in his words, colour, or motion alone.

**Voice / register.** Wry, warm, proud-then-sheepish; a peer showing off, **never a teacher quizzing**. One clause of *what*, an optional pull deeper for *why* — **name, don't lecture**. His signature line — *"That's the magic smoke. It doesn't go back in."* — is engineered so the **one line an expert sees** lands as charming and *earns the mute* rather than provoking it.

**Critically: he is the VOICE of the pull-not-pick coaching layer, reconciled with [onboarding §10].** The Probe is not a parallel narration engine and not a difficulty mode. He is the *personified surface* of machinery that already exists:

| Coaching-layer surface ([onboarding §10]) | The Probe's expression of it |
| --- | --- |
| Persistent **Explain/Help handle** | The handle that **summons** the Probe (re-opens the walkthrough, replays the cold-open). |
| **First-encounter concept cards → Lab Notebook** | The Probe **narrates** the card the first time, then it's logged and silent. |
| Single **`explain as I go` mute** | **Mutes every Probe line at once**; the spectacle (smoke, FAIL box, board lighting) still plays — words are the mutable layer on top. |
| **Competence detected, not interrogated** ([§7]) | Any advanced action **retires** the Probe (see §5, §6). |
| **Never a dead-end** ([§10.3]) | Retiring mutes the **push**; the **pull** (handle, Notebook, replay) stays fully reachable. |

He adds **no new *coaching* state.** The coaching layer's persisted state stays exactly what **[onboarding §10.4]** promised — the `explainAsYouGo` mute + the `seenConcepts` set — riding on top of the cold-open's **already-existing** `showIntro` / `settings.seenIntro` gate [storage.ts:26; App.svelte:2076]. The only genuinely new state lives elsewhere and is audited in §8: a **derived, non-persistent `competenceDetected`** boolean (§5), a **per-attempt build seed** that rides the board/contract instance (§3a), and two **transient renderer-only** flags for the smoke (a per-`ComponentNode` `wasFailed` edge-bit + a charred tint, reset on rebuild). He adds **no level, tier, or difficulty state** — honouring §10 to the letter.

---

## 2. The teaching arc, act by act

> **Spine ordering (resolving the cognitive-science segmenting law, [onboarding §4]).** Every act runs **SHOW (motion/light, zero reading) → NAME (one clause where you're already looking) → NUMBER (one pull deeper, never unbidden)**. Spectacle and explanation **never co-occur** — the blow-up plays, *then* settles, *then* one text clause names the cause. This defeats Mayer's redundancy/split-attention failure mode.

### Act 0 — COLD OPEN: the Probe's proud broken board → the blow-up

**Framing (the emotional keystone, non-negotiable): PRODUCTIVE FAILURE that is BLAMELESS.** This is Kapur's designed impasse — the learner forms the wrong intuition ("a source and a light, it'll glow"), and the violation is what makes the later *why* stick. But productive failure backfires for young/anxious/low-prior-knowledge learners **the instant the failure feels like theirs.** So the failure is **diegetically and in-copy the PROBE's** — *his* proud board, *his* oops; the player is the **witness who pressed play on someone else's circuit.** The learner laughs *with* the Probe, never at themselves.

| Beat | Appears | Player does | Learns | Feels | Probe copy |
| --- | --- | --- | --- | --- | --- |
| **Set-up** | `onMount` auto-loads NEW `'led-blowup'` ExampleSpec **PAUSED** (V→LED, no R) in the slot `'primer'` uses today. The Probe bobs beside *his* board, proud. One big glowing **PLAY** affordance (green triangle, not the word "Run"). `intro-banner` suppressed for this variant. | Reads/hears one Probe line; presses PLAY (the only affordance). Audio rides this first gesture (autoplay unlock, §9). | Nothing yet — by design (Kapur's activation). The board is **HIS**; the bench is alive (power load-bearing from frame one). | Curiosity, ownership-by-proxy, zero pressure, zero reading. | *"Look look look! I built this ALL by myself. An LED, straight off the rail — clean, no clutter. Press the green go-button — go on!"* |
| **The blow-up** | On PLAY the **real solver runs**: near-zero series R once the LED conducts → runaway current → **`|I| > rated`** (Real mode) **or `FAIL_LIMIT` overflow** (Ideal — so the pop is **mode-robust**). [loop.ts ~405] sets `running=false` and **freezes**. NEW wall-clock one-shot (`performance.now`, like `FAIL_PULSE_HZ`, so it animates *across* the freeze) on the **rising edge of `failedMask[led]`**: over-bright white **flash** (the brightness-tracks-current channel slammed to max ~120 ms) → comic smoke puff + `--energy`/`--bronze` sparks → settle into the existing pulsing **`--bad` FAIL box** + a charred/dimmed LED tint. The Probe **yelps, flips upside-down with a dizzy spiral, rights himself.** | Watches. (Optionally taps the Probe to replay the yelp — it's a toy, not a gate.) | Implicit, pre-verbal: **too much went through and it broke.** SHOWN, never numbered. | **DELIGHT first** (the robot flipped and went *poof*), then a tiny pang ("poor little light"). **BLAMELESS** — his oops. | *(yelp)* *"WAAAH! — poof… (rights himself, sheepish) …okay. That was MY oops, not yours. I forgot something."* |
| **The name** | After the spectacle **settles** (segmenting — never during), ONE amber-chip-register clause names the cause **on the charred LED**, where the eye already is. The equation lives one pull deeper [partInfo.ts info drawer]. First-FAIL **concept card → Lab Notebook** ("too much current; it cooked"); the optional one-tap **Wager** ("with a resistor, will it survive?") is a **predict-then-reveal** that pays the **first Lux** ([game-progression §1.3]'s mechanism, applied to the blow-up) — breaking it is the player's **first understanding win**, before their first Credit. | Reads/hears the one clause. Optionally pulls the LED's `?` for `I = (V−Vf)/R`. Optionally takes a one-tap **Wager** ("with a resistor, will it survive?"). | The concept, minimally: **an LED has almost no resistance of its own once it conducts; with nothing to limit current it runs away.** A resistor is the safety valve. | Relief + insight — *"OH, that's why."* The aha is earned because the impasse preceded it. | *"That's the magic smoke — and it doesn't go back in. No resistor, so the current ran away and cooked it. A resistor is the safety valve — it sets the current. Want to see where it goes?"* |

### Act 1 — THE FIX: the current-limiting resistor

Reuses the existing **`'led-limit'`** topology (V→R→LED) and its do/why/done steps **verbatim**. The "where does R go" question is answered by a **single glowing drop-slot** (the §7 stage-1 prop set: bin narrowed to one part, pre-armed, pins glow, next-edge ghosted).

| Beat | Appears | Player does | Learns | Feels | Probe copy |
| --- | --- | --- | --- | --- | --- |
| **Place R** | The board rebuilds (clears the char). The Probe holds up a fat "speed-bump" resistor glyph and gestures at the **one** glowing series gap. No value picker — a kid-safe R is auto-chosen so the LED lands safely lit. Value-aware variant gated on `graphShape` (topology) **plus** the part being present. | Drags/taps the single glowing resistor into the single glowing gap (big target, can't-miss), presses PLAY. | **R is the safety valve** that sets the operating current/brightness; the LED's voltage barely moves — **it's R that sets the operating point** ([led-limit] copy, verbatim). | Agency + repair — *"I helped fix the robot's light."* First cause→effect they personally caused. | *"I KNOW what I forgot — a speed-bump! It soaks up the leftover voltage and sets the current. Pop it right HERE where it's glowing. Now press go."* |
| **Win** | Healthy solve; LED glows steady at a safe current. Reuse the **Ship-It juice triad** ([rewards §4]): net energizes, warm rising tone, happy chime; the Probe backflips / throws confetti-sparks in `--ok` green + `--accent` rose (no new palette). | Watches; can re-savor via PLAY; can tap the LED to hear how bright. | Closure: speed-bump in → light lives. The **blamed-then-fixed loop completes.** | **PRIDE + relief** — the light + sound + cheer dopamine triad, *every time.* | *(backflip)* *"YESSS! You SAVED it! The speed-bump kept it just-right-hot instead of too-hot. Bigger R → dimmer; smaller R → brighter, and eventually too much again."* |

### Act 2 — THE DIVIDER: where the final resistor goes

Reuses the existing **`'divider'`** ExampleSpec (R1/R2 series, the **3.33 V tap**) and its **R2-lift demo toggle** verbatim. The "where to place the final resistor" lesson is taught by **highlighting the to-ground resistor (R2)** and labelling the tap.

| Beat | Appears | Player does | Learns | Feels | Probe copy |
| --- | --- | --- | --- | --- | --- |
| **The relationship** | `'divider'` loaded in Watch. A coach-mark **rings R2's path to ground**; the tap is labelled `Vout`. The relationship surfaces as **selectable DOM text:** `Vout = Vin · R2/(R1+R2)`. | Watches the tap settle at 3.33 V; reads/selects the ratio line; optionally opens the drawer for the derivation `R2 = R1·Vout/(Vin−Vout)`. | The mid node sits at a **fraction set by the RATIO**, not the absolute ohms; **R2-to-ground is what lets the rest drop across R1.** | *"Now I see the rule."* Respected intelligence — one clause + one pull deeper. | *"This one splits the rail on purpose. The bottom resistor — to ground, highlighted — sets the tap: Vout = Vin · R2/(R1+R2). It's the ratio, not the ohms."* |
| **The failure-mode bridge** | The **R2-lift demo toggle**: lift R2 off ground → output **floats to the full rail** (the same "wrong voltage reaches the load" family as the blow-up, now miniature and SAFE). Bridges to the **first contract OFFER** ([game-progression §1.3]). | Toggles the demo; sees full-rail float (Probe shields his eyes — "too hot!"); drops it; sees 3.33 V return. | The division only happens when **current can flow through both** — no path to ground, no division. The placement of R2 *is* the lesson. | Intrigued — the blow-up taught "too much = bad"; now "just-right is a CHOICE you place." | *"Watch — lift R2 off ground and the tap floats all the way to the rail. WHOA, too hot, shield your eyes! Ground it… aah, just right. The middle spot is the picker."* |

### Act 3 — BUILD FROM SCRATCH: example always visible, numbers changed (anti-copy)

The arc's payoff: a **completion problem** (Sweller/Renkl) plus a **Bjork desirable difficulty** (changed numbers) that **provably defeats rote copying**. The worked `'divider'` example stays **persistently visible** (a pinned reference showing its *own* tidy numbers — a **method to apply, not a layout to trace**); the player's **target differs per session**.

| Beat | Appears | Player does | Learns | Feels | Probe copy |
| --- | --- | --- | --- | --- | --- |
| **Build to a changed spec** | The first **CONTRACT** as an OFFER in the margin, recast with a **per-session target** (e.g. *"hit {Vtarget} from this {Vrail} rail"* — say 5 V from 9 V, not 3.3 from 5). The example stays **pinned** — a **NEW non-destructive inset / read-only render of `ex.build()`** (NOT the existing `showSolution`, which is *destructive & terminal*: it `loadGraph`s the answer over your board and ends the build [App.svelte:3290–3297]). Topology still completes via `graphShape` (value-independent) so the loop closes and current flows; a **NEW value-aware grader bar** shows live `Vout` vs target with a tolerance band (green in-spec), and the **contract ships only when that `specMet` band holds** — copying the example's 1k/2k into a 9 V rail closes the loop but reads visibly out-of-spec. | Builds the divider topology (copying the *shape* works), then **sizes R1/R2 to hit THEIR target.** Copying the example's 1k/2k into a 9 V rail reads visibly wrong on the grader. Adjust until in-spec (numerically) or until the bars **click level** (by feel). | **TRANSFER — the relationship, not the layout.** Topology passes the shape check; only understanding passes the **spec** check. *(For pre-readers: the same lesson as "fatter speed-bump = dimmer, skinnier = brighter," aimed at a target glow.)* | **Earned mastery** — the good friction. *"I didn't copy it, I figured it."* Never stranded (pinned example, re-shown ghost on a wrong move, §10.3). | *"Real one now. Customer wants {Vtarget} from a {Vrail} rail — not my numbers. The example's pinned up there, but copying its resistors won't hit YOUR spec. You've got the rule — solve it, pick the parts, ship it. …Tap reads too high; which resistor moves it down?"* |

---

## 3. The randomized-build mechanic, in depth

The owner's "numbers change so copying fails" is the arc's **single beat that forces transfer instead of rewarding mimicry.** Two facts make it both necessary and feasible:

1. **The completion oracle is purely topological.** `graphShape` [netlist.ts ~1811] keys on sorted element **types** + `nodeCount` — a 150 Ω and a 1 MΩ resistor produce **identical shapes**. So today the build-from-scratch step would fire **"complete" on correct wiring regardless of value** — "copying fails because numbers differ" is **enforced by nothing.** The anti-copy mechanic must be a **NEW value-aware grader beside `done(p)`/`complete`, never folded into `graphShape`** (folding it in breaks every existing topology-only example).
2. **The value channel already exists web-side.** `electricalMap` [netlist.ts ~1822] returns `Map<componentId,{current,vAcross,…}>` from the **once-per-frame batched snapshot the renderer already reads** — so the grader needs **NO new wasm crossing.**

### 3a. The seeded parametric generator (the "changed numbers")

A small **deterministic web-side generator** picks the session's parameters — `(Vrail, Vtarget, tolerance)` for the divider; a `(target brightness rung)` for the pre-reader skin — **ONCE per attempt**, seeded by the **contract/attempt id** (NOT the sim tick, NOT anything hashed). Properties:

- **Frozen once, threaded everywhere.** `build()` is called multiple times (Watch, build-target, `showSolution`/pinned reference, grader). The seed is held in **App.svelte build-state (beside `buildEx`/`buildStep`), NOT in the ExampleSpec module**, and the *same* params object is passed into every call — so the prompt, the pinned example, and the grader **never drift.** It is **persisted with the board/contract instance** (the existing save path — `saveSettings`/`loadSettings` or the board blob), so a **refresh restores the same target**, not a fresh roll. (This is the one correctness trap; the fix is clean.)
- **Bounded to be solvable and sensible.** Targets are constrained to a band **reachable with the in-bin resistor values** and **comfortably below the rail** (no rail-clipping, no physically-silly divider). The delta from the worked example starts **small** (3.3 → 2.5, not 3.3 → 0.6) so the difficulty stays *desirable*, widening only as competence is detected.
- **Anti-copy guaranteed by construction.** The target is always **far enough from the example's value that the example's exact parts are wrong**, but **near enough that a one-or-two-step adjustment lands it.**
- **Seedable for classrooms.** The generator is a tiny **deterministic web-side PRNG** (e.g. `mulberry32`) seeded from a **stable string** (contract id + attempt index) → a teacher can hand out a seed and every student gets the **same** target. This is a *new* web-side convention: there is **no prior tick-pure seeded-stimulus precedent** in the tree — the only existing seed is the fixed global `SEED=1337` handed to `createSimulation`, which this **never touches** (see §8 for why it stays golden-irrelevant).

### 3b. The "hit-the-spec" relationship grader

A **parallel, additive** success predicate that fires **only after** `graphShape` confirms topology, then judges the **measured output of the graded net** against `target ± tol`:

- Reads `Vout` (or LED forward current) from `electricalMap`'s already-batched snapshot — **no new boundary call.**
- Drives a green **in-spec band** on the `.guided-overlay`. **The loop still closes on topology alone:** `advanceBuild` flips `buildDone` and resumes the run the instant `graphShape(graph) === buildTarget` [App.svelte:3309–3317], so the board **comes alive and current flows even with copied (wrong) values** — pedagogically vital: you *see* it run, but it is *a* circuit, not the *right* one. The **contract SHIP/win** (the Ship-It juice + Credits + Lux) is gated on a **NEW separate `specMet` predicate** layered *after* `buildDone` — never on `complete` itself.
- **Never feeds back into `graphShape`/`complete`** — purely additive, so every existing topology-only example is bit-for-bit untouched.
- **Measures the LIVE output against the per-session target — NEVER compares the player's component values to the example's.** *(This is the entire anti-copy mechanic; the inverse bug — comparing to the example's 1k/2k — would pass a diligent copier and fail a correct-but-different solution. Guarded with a vitest case, §7.)*
- **Debounced** (require N stable frames) so a transient never flickers the green; for the DC divider this is belt-and-suspenders.
- **Coaching, not bare pass/fail:** when out-of-spec, the grader names the **direction** in the amber hint-chip register (*"too high → grow R2 or shrink R1"*) — a rubber-duck that narrates the sim, never solves it.

### 3c. Why copying fails

The example is pinned and **necessary for the shape**; it is **insufficient for the answer.** `graphShape` passes the copied layout; the grader fails the copied *value* against *this session's* spec. Only applying the relationship passes both. The desirable difficulty is real and provable.

### 3d. Determinism & golden-irrelevance

The seed lives **web-side on the board/contract instance**, never enters `snapshot_hash`. A randomized component *value* crosses into the per-circuit solve **as an ordinary component value already does** — each player's run stays **internally deterministic** (same seed → same board → same solve). The grader **only reads** the already-batched snapshot. See §8.

### 3e. Scaling across ages — one widget, two channels

The perceptual target **IS** the number, shown two ways on **one** bar (the [visual-language] "magnitude channel + exact number" pairing):

- **Teens/adults/EEs** read the volts/mA printed on the bar and solve `R2/(R1+R2) = Vtarget/Vrail`.
- **Young kids (pre-readers)** **match by feel** — a side-by-side **matching meter** (their bar vs the target bar, or their LED glow vs a reference glow; colour **paired with a ring/marker**, never colour alone) gives **warmer/cooler** feedback; the win fires when measured **brightness ≈ I/20 mA** [partInfo.ts] lands within a **tolerance rung** of the seeded target. Because the target glow differs from the always-visible example, **copying the layout lands the wrong glow** — the same anti-copy WHY, **with zero arithmetic.**

**Same widget, same sandbox, no "kids mode."** The difference is *what channel you attend to*, not what's reachable — exactly **[onboarding §10]'s pull-not-pick.** Both wins fire the **same Lux faucet + same Lab Notebook page** — *understanding is the currency, however you reached it.*

---

## 4. The blow-up mechanic, in depth

**A one-shot, wall-clock-driven magic-smoke animation layered over the existing FAIL mask** — making failure **delightful AND blameless**, on a real measured outcome (the sim is the only judge).

**Presentation, layered on existing machinery:**
- Triggered on the **rising edge of `failedMask[i]`** (a new per-`ComponentNode` `wasFailed` boolean, client-only, reset on netlist rebuild) — i.e. on the false→true transition the existing FAIL path produces.
- Driven by **`performance.now()` (wall-clock, like `FAIL_PULSE_HZ`)**, **never tick** — because [loop.ts ~405] **freezes** the run at FAIL; a tick-driven effect would freeze too. Wall-clock lets the smoke animate *across* the frozen frame.
- Timeline: over-bright **flash** (the brightness-tracks-current channel slammed to max, ~120 ms) → a **small short-lived-`Graphics` particle pool** of smoke puffs + embers (`--energy #ff8a3d`, `--bronze`, `--bad`) → settle into the **existing pulsing `--bad` FAIL box** + a **persistent charred/dimmed glyph tint.**
- Centred on the part's **existing rotated FAIL bounding box** (`rotPx()` geometry [board.ts ~6843]) — no new geometry.

**The diegetic-vs-solved decision — RECOMMENDATION: solver-real, spectacle layered on top.** The real solver *should* FAIL underneath the animation — it is **pedagogically honest** ("smoke is information," not a cutscene) and **mode-robust** (the resistor-less LED trips `FAIL_LIMIT` overflow in **either** Ideal or Real mode; if a rating-driven pop is preferred, author the cold-open in Real mode). A fully-scripted blow-up is *technically possible* (the spectacle need not depend on solver values) but we **reject it**: the lens consensus is that the honest physics is the whole point, and it costs nothing extra.

**The Probe's reaction & blamelessness.** He **flinches/yelps/flips**, then **immediately rights himself and reassures** — *"That was MY oops, not yours."* The framing scales **up** the age range gracefully: pure comedy for a 5-year-old; an honest `|I|>rated` FAIL with a readable cause chip for a teen; just the existing FAIL box for an EE (who can mute the Probe). **Nobody is ever told THEY failed; the sim is the only judge** — the same non-punitive "smoke is information" stance, narrated not judged, across the whole spread.

**Making it delightful, not frightening (the sensitive-child guard).** Tune toward **comedy not horror**: bouncy yelp, comic flip, cartoon *POOF*, **warm not harsh** audio at modest volume; the LED is **fixable within seconds** (next beat), so the sad pang is brief and resolves into repair — **never linger on the charred state without the fix-offer present.** Under **`prefers-reduced-motion`**: drop to a gentle **dim + small puff, no spin, no particle storm** — a static "cooked/greyed" glyph + the named-cause text chip (meaning lives in **DOM text + the FAIL box, not the particles**; colour-blind/reduced-motion safe per roadmap #8).

**Expert safety (the single load-bearing choice).** The cold-open loads **PAUSED and does NOT auto-run.** The smoke fires only on the player's own **Run** (or the Probe's "play it"). **A competent user who starts building immediately never sees the blow-up.** A curious EE who *does* press Run gets a **2-second easter-egg they dismiss in one gesture** (clear, edit, or the "I know electronics" click) — it freezes the **sim, not the UI**, so they keep editing the frozen board at once. **OWNER-CONFIRMED (2026-06-25): fire-on-Run is the decision** — the player presses play (learning the transport on their first interaction); the cold-open never auto-runs. (Resolves §9 #1; refines [onboarding §1]'s "auto-play-then-pause".)

**Golden-safety.** `failed_elements` is **NOT in `snapshot_hash`**; the rating **only flags, never alters the solve.** Pure presentation on the unhashed mask, consuming the already-read snapshot — **no new boundary call, no sim/netlist/hash change.** See §8.

---

## 5. All ages, all skill — the pull-not-pick reconciliation

**The resolution this panel commits to (and we say we chose it).** The owner's "self-select into the SCAFFOLDED experience" and **[onboarding §10]'s** "no levels / pull-not-pick" are only in *apparent* tension. We resolve **in favour of §10 + the all-ages goal**: the scaffolded arc is **a PULLED behavioural state**, not a chosen tier. The cognitive-science lens makes this not merely a house rule but a *finding* — **expertise-reversal (Kalyuga)**: a worked example that *helps a novice measurably HURTS an expert.* So the system **must** let *competence, not a self-rating*, drive the fade. **The science and the §10 correction agree.** You **pull** the Probe (the always-visible example, the why-strings, the Notebook) and you **fall out** of the scaffold the instant you mute or arm a Tier-II part. **No age is ever asked; no level is ever picked.**

The mechanism is a single derived boolean, **`competenceDetected`** (NOT new persistent tier state), that flips true on the **first** of these **existing-call-site** events and then stops the Probe queuing into the narration slots:

- opening the **full parts bin** / leaving the narrowed V/R/GND subset;
- **`arm()`-ing a `tier:'II'` part** (the **tech-tree** `tier:'I'`/`'II'` tags already on `PARTS` [App.svelte:178+] — a free, exact signal; *note this is the tech-tree tier, distinct from a component's quality grade `Component.tier` budget/mid/high/lab, which is NOT a competence signal*);
- **editing a component value** via the value popover;
- any **expert hotkey** (hotbar 1–9, Q pipette, eyedropper);
- the explicit **"I know electronics / Skip the tour"** one-click on the Probe's first line.

It changes **WHETHER the Probe narrates, never WHAT is reachable.** A 10-year-old replaying their 4th session retires the Probe **identically** to an EE — *same sandbox, different amount of explanation pulled.*

**How EACH act degrades gracefully across the spread:**

| Act | Young child (pre/early reader) | Teen/adult novice | Expert / EE |
| --- | --- | --- | --- |
| **0 Cold open + blow-up** | Pure comedy + "the robot's oops"; spoken + picture-bubble; the *poof* is the hook, no reading. | Motion-first hook ("I get to run it"), then reads the one-clause cause; first Lux + Notebook page. | If they start building, **never sees it.** If they press Run: a 2 s easter-egg, dismissed in one gesture; the honest `\|I\|>rated` FAIL. Probe mute-able. |
| **1 The fix** | One big can't-miss "speed-bump" drop; "I fixed the robot's light." | Glowing slot + the safety-valve why-string + the R-sweep for the tinkerer. | A pre-retired non-event; they just place R if they want. |
| **2 The divider** | "Make it JUST this bright" by feel; the R2-lift demo = "too bright" warning (no re-failing). | `Vout = Vin·R2/(R1+R2)` as selectable DOM text; the demo proves the failure mode. | Silent; the relationship is obvious; the contract speaks in its own neutral voice. |
| **3 Build-from-scratch** | Match the **target glow/bar** by feel (warmer/cooler); copying the layout lands the wrong glow. | Solve the ratio for THEIR target; pinned example is a method; grader bar shows in-spec. | Reads the target as a plain spec line, sizes R in their head, ships. Un-narrated. |

**Cross-cutting accessibility (helps EVERYONE, not just little kids):**
- **Reading load:** zero required reading on the pre-reader critical path (voice + picture-bubbles carry it); all prose is **real DOM text** for older readers / AT; **`aria-live` throttled ~2 Hz.**
- **Motion:** every motion gated behind **`prefers-reduced-motion`** (blow-up → static cooked state; Probe idle-bob stills).
- **Audio:** **additive** — every voice line ships a real DOM caption **and** a picture-bubble, so meaning survives muted devices and deaf/HoH players. Muting `explainAsYouGo` silences the chatter for the EE.
- **Input:** **tap-not-type, ≥24 px hit targets, pre-armed single parts, can't-miss drop-slots** — the §7 stage-1 prop set as the **default**, faded by competence-detection (a motor-accessibility + touch win for all ages).
- **Colour:** never colour alone — the matching meter pairs colour with a **ring/marker** (roadmap #8); the blow-up pairs red/smoke with the **named-cause text chip.**

---

## 6. Scaffolding → independence

**How the Probe fades.** `competenceDetected` (§5) retires him on the first advanced action — he is **never modal, never a wall.** The fade is a **quiet, non-judgemental micro-transition** (his glow softens out) rather than an abrupt vanish, so the expert registers *"it noticed me"* positively, not *"it gave up on me."*

**The behavioural skip / mute.** The **single `explain as I go` mute** silences every Probe line at once (the spectacle still plays, wordless). His **first line carries "I know electronics / Skip the tour"** → sets the **existing** `seenIntro` (via `showIntro=false` [App.svelte:2076]), so he is **never re-prompted.** For a returning kid the same one-click means "I've seen this," not "I'm advanced" — **same affordance, no tier judgement.**

**The "I already know this" path.** One gesture from silence at every hinge: the first banner's ✕, the skip click, or simply *building.* Each Probe utterance carries a **visible one-gesture dismiss** (✕ / Esc / click-away). The arc must **still fully function with the Probe muted** — the cold-open still pops, the grader still grades, the contract still ships.

**Replayability (retire is never a dead-end, [§10.3]).** Retiring mutes the **push**; the **pull stays fully reachable:**
- the persistent **Explain/Help handle** **re-summons** the Probe, re-offers the guided build, and **replays the cold open** (clearing `seenConcepts` so a parent and child can replay together);
- the **Lab Notebook** re-shows any first-encounter concept card (the first-FAIL page can be a **picture comic** — zoom → poof → speed-bump → happy light — legible to a pre-reader too);
- the cold-open's **demo one-toggle** lets anyone **re-trigger the pop deliberately** (determinism makes it a *repeatable lesson*, a shareable easter-egg);
- the **randomized build re-rolls fresh numbers** on each attempt — **spaced retrieval practice of the same schema**, far better for durable transfer than one-shot mastery.

A competence **false-positive** (a novice fat-fingers the full bin) is therefore harmless: the handle re-summons everything. Retire is a fading behavioural state, **never a chosen bucket, never a dead-end.**

---

## 7. Reuse vs new surface

| Beat / capability | Existing machinery that carries the load | Smallest new surface |
| --- | --- | --- |
| **Probe persona** | Coach-mark/anchor plumbing (`emitAnchor`/`onAnchor`), the `.intro-banner` template, the `.guided-overlay` why-string slot, the Lab Notebook concept cards, the single `explainAsYouGo` mute + `seenConcepts` set, the `.brand-mark` breathing-glow + scope-glass tokens, the `prefers-reduced-motion` block. | A **Probe body sprite/skin** drawn FROM existing tokens + idle-bob; a **pull-to-summon** wiring of the Help handle; an **optional audio voice layer** (captioned); the **picture-bubble** skin. No new engine, no persistent state beyond what exists. |
| **Cold-open** | `onMount` auto-load-PAUSED pattern (today `'primer'` [App.svelte ~2098]); `fromSaved` deep-clone. | A NEW **`'led-blowup'` ExampleSpec** (V→LED, no R); the **armed-but-paused / fire-on-Run** guard (no auto-run). |
| **Blow-up spectacle** | The unhashed **FAIL flag** (`failed_elements`/`failedMask` in the snapshot); the **freeze-on-FAIL** + fix-then-Run recovery [loop.ts ~405]; the `FAIL_PULSE_HZ` free-wall-clock idiom; the FAIL-box `rotPx()` geometry [board.ts ~6843]; the brightness-tracks-current channel; `--bad`/`--warn`/`--bronze`/`--energy` tokens. | A per-`ComponentNode` **`wasFailed` edge-detect bool**; a **small short-lived-`Graphics` particle pool**; the **charred-glyph tint** state (reset on netlist rebuild); the Probe's reaction animation + audio. |
| **The fix** | `'led-limit'` ExampleSpec + its do/why/done steps verbatim; the arming/ghost surface (`setArmed`); `graphShape` completion. | A **value-aware pre-armed variant** (one part, glowing slot) gated on `graphShape` + part-present. |
| **The divider** | `'divider'` ExampleSpec + its **R2-lift demo toggle** verbatim; coach-mark anchoring; selectable DOM text. | A coach-mark **anchored on R2→GND**; the ratio line as DOM text (already-supported pattern). |
| **Randomized build** | `graphShape` [netlist.ts ~1811] as the value-independent topology gate; the do/why/done step engine; `electricalMap` [netlist.ts ~1822] (measured `Vout`/current from the once-per-frame snapshot); the contract-OFFER framing [game-progression §1.3]; the **Ship-It juice triad**. | The **per-attempt seeded generator** (held in App.svelte build-state, threaded through every `build()`); a **value-aware grader** (additive, beside `complete`); a **matching-meter** widget (pre-reader skin); a **non-destructive pinned-reference render** of `ex.build()` (distinct from the destructive, terminal `showSolution`). |
| **Anti-copy correctness guard** | The vitest suite (`web/src/lib/netlist.test.ts` pattern). | A **test:** a divider built with arbitrary in-ratio resistors (e.g. 5k/3.5k) **passes**; the example's 1k/2k into a different rail **fails** — locking the grader to measure-vs-spec, never compare-to-example. |
| **Competence fade** | §7's "advanced action quietly retires coach-marks"; the tech-tree `tier:'I'`/`'II'` tags on `PARTS`; the `arm()` choke point; the value popover; the existing `showIntro`/`seenIntro` gate. | One derived **`competenceDetected`** boolean + guards at those existing call sites. No new UI, no new persistent setting. |

**Net new surface:** the **Probe persona layer**, the **magic-smoke presentation**, and the **parametric generator + relationship grader** (with its correctness test). Everything else is reuse.

---

## 8. Determinism & golden-safety statement

> **This arc is presentation/UX + web-side game-design only. It touches no Rust, no netlist hash, and no determinism golden (`0xeaac…fa24`).**
>
> - **The blow-up rides the existing unhashed FAIL flag.** `failed_elements`/`failedMask` are **NOT in `snapshot_hash`**, and the rated-current check **only flags, never alters the solve.** The animation is **wall-clock-driven** (`performance.now`, never tick — the run is frozen at FAIL) and consumes the **already-batched once-per-frame snapshot** with **no new per-component boundary call.**
> - **Randomization sets web-side netlist VALUES only** — which already legitimately cross into the per-circuit solve as ordinary component values and **never enter `snapshot_hash`.** The seed is a **per-attempt board/contract-instance seed held in App.svelte build-state**, consumed by a tiny **web-side PRNG** (e.g. `mulberry32`); it **never reaches sim-core** (the only sim seed is the fixed global `SEED=1337` to `createSimulation`, untouched here), so **each player's run stays internally deterministic (same seed → same board → same solve).**
> - **The value-aware grader is a strictly additive web-side predicate** read from the already-batched `electricalMap` snapshot. It gates only the **contract ship** (`specMet`) — never `graphShape`, `complete`, or `buildDone` — so the loop still closes on topology and every existing topology-only example is **bit-for-bit unaffected.**
> - **No new persisted *coaching* state** beyond [onboarding §10.4]'s `explainAsYouGo` + `seenConcepts`. The genuinely new state is the **build/contract seed** (rides the board save), a **derived, non-persistent `competenceDetected`**, and **transient renderer-only** smoke flags — none hashed, none of it new coaching-persistence.
> - **No new JS↔wasm crossing.** Every value read (FAIL state, measured `Vout`/current) comes from the existing **once-per-frame batched snapshot** via `electricalMap` — the boundary stays coarse ([CLAUDE.md] golden rule 2).
> - **`graphShape` stays the value-independent completion oracle.** The value-aware grader is **strictly additive and separate** — it judges the number **only after** topological completion and **never flips `complete`**, so every existing topology-only example is **bit-for-bit unaffected.**
> - **`cargo test -p sim-core` (incl. `run_is_reproducible`) is unaffected** because **no sim-core code changes.** No new currency, no new physics, no new hashed state.

---

## 9. Open questions / owner hand-offs

1. **Cold-open auto-run vs fire-on-Run — ✅ DECIDED (owner, 2026-06-25): FIRE-ON-RUN.** The cold-open loads PAUSED; the player must **press play** so they learn how to start the sim on their first interaction, and the blow-up is **self-caused yet blameless** (the Probe's circuit). No auto-run. The earlier motion-first auto-play fallback is **dropped**. (Refines [onboarding §1]'s "auto-play-then-pause".)
2. **Does the blow-up REPLACE `'primer'` as the literal first sight for everyone**, or is it the **"Show me how this works" fork** while "Let me build" / returning users still get the calm primer (or a blank bench)? Central tension with [onboarding §1/§6] and the existing "Show me / Let me try" front door — **owner's call on default entry**, kept compatible with both forks.
3. **How does the blow-up reorder the existing 5-minute scripted on-ramp** ([onboarding §6]), which currently routes through the calm primer and puts the LED as the *second* build? Does the blow-up become minute 0:00, and does that compress the existing beats?
4. **Grader tolerance band.** What ±% on `Vout` counts as in-spec for the first contract — fixed, or tightening as the player ships more dividers? (The all-ages knob; **proposal: ±2–5% of target, debounced N frames.**) And does a near-miss give the novice a directional Probe nudge while the expert sees pass/fail?
5. **Resistor value model for the from-scratch build:** continuous (type any ohms) vs an **E-series/preferred-value bin** (a real engineering "pick the closest standard pair," more honest, harder for the youngest)? Which does the opening contract use?
6. **Seed source & convention.** Per-attempt vs per-day (daily-contract style) vs teacher-suppliable. Recommend **per-attempt** (fresh numbers each retry). **Confirm ONE golden-safe seeding convention shared** with the daily-contract/judgement-part precedent, so the changing-numbers (older) and changing-glow (younger) variants draw from the same web-side mechanism — and decide whether **classroom seed-sharing** is in scope for v1.
7. **Perceptual rungs & tolerance for the match-by-feel skin** — needs playtesting with real 5–8s to find the band that is **anti-copyable yet achievable by feel** (proposal: 3–4 visibly distinct brightness rungs, tolerance = one rung, target always ≥ one rung off the example). **Who owns the playtest?**
8. **Does the perceptual (match-by-feel) win pay the SAME Lux + Lab Notebook page as the numeric divider win?** Recommend **yes** (understanding is understanding) — but confirm it doesn't create a grind/exploit path for older players who'd rather match-by-feel than reason numerically.
9. **Generalize the grader now or keep it divider-specific for v1?** A reusable "hit-this-output" contract grader avoids a rewrite when the next parametric contract lands, but risks over-building before the second use case exists.
10. **HUD placement of the pinned worked-example reference** (inset on the board / re-openable side panel / ghost layer) — needs a [visual-language] pass to keep the calm instrument aesthetic and not crowd the bench with a second board. (It is a **NEW non-destructive read-only render** of `ex.build()`, **not** the destructive terminal `showSolution`.)
11. **Voice production — DIRECTION (owner, 2026-06-25): a deliberately bad, clearly-robotic *retro* TTS** (the old Microsoft "Sam" / SAPI4-era voice), NOT warm VO — a robot bench-bot *should* sound robotic; it's charming, on-brand for Critical**Error**Computing, and cheap. Still **TBD on the exact engine:** a web `SpeechSynthesis` voice tuned ugly vs a small bundled retro-formant TTS vs pre-rendered clips of one. Stays presentation-only / captioned / golden-safe. *Localization caveat:* a retro English formant voice may not exist per-locale — non-English likely falls back to the platform `SpeechSynthesis` voice. **Owner to pick the engine.**
12. **Audio autoplay policy:** browsers block autoplay-with-sound until a gesture; the cold-open's first line can ride the first PLAY tap — confirm the **silent-first-frame fallback** (captions + bubble) reads fine alone.
13. **`competenceDetected` persistence:** sticky across sessions (an EE never re-greeted) vs reset each session (a shared machine / returning kid gets a fresh greet)? **Recommend sticky, with a Help-handle "replay walkthrough" un-stick.** Also confirm the exact trigger set (is arming *any* `tier:'II'` part the right bar, or too eager?).
14. **Naming disambiguation** — bless a label distinguishing **the Probe (bench-bot mascot-narrator)** from the **DMM probe leads** (`probeA`/`probeB`, "Probe it in Measure"), or accept the in-doc convention "the Probe (the bench-bot, not the DMM lead)."
15. **Reduced-motion blow-up:** confirm a static "cooked/greyed" glyph + named-cause text chip is an acceptable substitute for the particle spectacle, and whether the Probe still flinches (a single static frame) or stays neutral.
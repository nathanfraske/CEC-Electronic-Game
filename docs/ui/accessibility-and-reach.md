<!-- SPDX-License-Identifier: Apache-2.0 -->

# Accessibility & Reach — the buildable spec

**Status:** design synthesis (presentation/UX + web-side game-design only). **Touches no
Rust, no netlist, no `snapshot_hash`, no determinism golden.** See §11.

**Layer:** the a11y/reach layer is the **same lever as pull-not-pick** — every affordance
routes through the existing always-available coaching surfaces and the prose/number substrate,
never a new mode, level, or upfront a11y picker. It is presentation + local-state only.

**This panel CONSOLIDATES and BUILDS OUT** [beginner-onboarding-all-ages.md §5] (the eight
a11y axes, left as a checklist) and §4 (all-ages adaptation, pull-not-pick) into a single
**implementable spec**, and **DESIGNS the genuinely-hard piece that §5 Axis 7 handed off
undesigned: the screen-reader board→prose engine.** It is bound by [onboarding-first-run.md
§10] (no levels; pull-not-pick; one sandbox), seeds from [fundamentals-scaffold-arc.md] (the
ramp the affordances ride), honours [visual-language.md] (colour is identity, magnitude is a
redundant off-hue channel), and gives the [probe-teaching-arc.md] retro-robotic Probe its
voice/caption contract.

**Sibling relationship.** [beginner-onboarding-all-ages.md] owns the *journey/system* and
names the eight axes; [probe-teaching-arc.md] owns the *scripted hook* and decided the Probe's
retro-TTS voice. **This doc owns the a11y/reach *build spec* + the player-facing ease-in for
every axis, and is where the board→prose engine is actually designed.** Nothing here
re-derives the hook or the ramp.

---

## 0. Thesis — what this panel decides

**Thesis:** Reach is not a settings screen. The player perceives the bench through **four
redundant channels** — **motion** (the flow clock), **colour** (rail identity), **the live
numbers** (telemetry), and **the Probe** (voice + prose) — and the a11y layer's whole job is
to guarantee that **every channel has a non-channel-locked twin**, so meaning survives the
loss of any one of them. Crucially, the project's own visual language **already** decouples
magnitude from hue and speed (`[visual-language.md]`: value lives on the bar/standpipe + the
exact number, never the colour or the flow rate) — so the colour-vision and reduced-motion
work is **mostly finishing an encoding the renderer already half-built**, not retrofitting.

**This panel DECIDES:**

1. **The eight axes become a buildable spec** — each with a `[machinery]`/`[new surface]`
   split, a player-facing ease-in, and a per-axis checklist (§2–§9).
2. **The board→prose engine is designed concretely** (§7): the **state-to-prose mapping**
   (node→label, element→state-word), a **change-debounce at ~2 Hz**, and the **announce-only-
   on-change** discipline — a read-only consumer of the once-per-frame batched snapshot, no
   parallel model, no new wasm crossing.
3. **Every reach affordance is PULL-NOT-PICK** (§10): auto-seeded by behaviour or offered with
   a visible undo, never a settings wall, never a chosen tier. The **one** legitimate
   preference cluster (input / voice / motion / reading-register) lives **inside the
   `explainAsYouGo` mute family**, is always mutable, and **gates nothing**.
4. **The canvas stops being an `aria-hidden` island** (§7) — today the main board `<canvas>`
   is invisible to AT; the parallel readout is the fix.

**The one new structural fact this panel commits to:** `FLOW_HZ` is today a **module-private
`const = 0.6` [board.ts:198]**. The reduced-motion canvas work **requires promoting it to a
settable/guarded value** wired to the OS `prefers-reduced-motion` query — a small new surface,
**golden-safe** (the flow clock is presentation-only and never feeds the sim, per
[visual-language.md]).

---

## 1. What the player perceives — the four channels and their redundant twins

The a11y contract, stated as a table: for each thing the player perceives, the channel that
carries it, **whether magnitude or identity rides on it**, and the **twin** that must carry
the same meaning when that channel is unavailable.

| Perceived | Channel | Carries | Already redundant? | The twin the a11y layer guarantees |
| --- | --- | --- | --- | --- |
| **Current flowing** | motion — chevron flow on `[FLOW_HZ]` | *direction + presence* (NOT magnitude — speed is decoupled) | partial — magnitude is on thickness/density/number | reduced-motion: **calm-then-still** flow; density/thickness/number persist; SR: "current flows" |
| **Current magnitude** | belt thickness + chevron density + **the number** | magnitude | **yes** — already off-motion, off-hue | the **number** is the canonical twin; SR reads it; by-feel bar mirrors it |
| **Voltage value** | bar/standpipe height + **the number** | magnitude | **yes** — never on hue ([visual-language.md]) | the number + the segmented-LED bar; SR reads "OUT = 3.3 V" |
| **Rail identity** | `voltageColor` hue (the bench wire code) | **identity** (the one hue-only channel) | **NO — the gap** | **per-rail pattern/texture** paired with the hue (§4); SR names the rail |
| **A part broke (FAIL)** | the pulsing `--bad` FAIL box + smoke | event | partial — box is shape+colour | named-cause text chip + SR "LED failed: over-current" (§4, §7) |
| **The Probe coaching** | DOM card text + (when voiced) retro-TTS + idle-bob | meaning | needs both | caption == the card text; meaning never in voice/motion/colour alone (§5) |
| **The live operating point** | telemetry numbers (IBM Plex Mono) | magnitude | **yes** | the canonical machine-readable twin; the aria-live track mirrors it (§7) |
| **"I caused that"** | the dark→alive flip + sound | the hook | needs all | guaranteed-Run input (§6); calm-not-still motion (§3); voiced/captioned (§5) |

**The load-bearing observation:** of the four channels, **only rail identity is genuinely
hue-locked today.** Magnitude is already off-hue and off-speed. So the colour-vision axis
(§4) is a **finish-the-encoding** job (add the pattern twin to identity), and the
reduced-motion axis (§3) is a **don't-kill-the-hook** job (slow, don't freeze) — neither is a
from-scratch rebuild. The genuinely-new build is the **SR board→prose engine** (§7).

---

## 2. Axis 1 — Reading load & the pre-reader path

**Goal:** zero *required* reading on the pre-reader critical path; minimal default text for
everyone; depth one pull away.

| | |
| --- | --- |
| `[machinery]` | `concepts.ts` id-keyed `ConceptCard {id,title,body}`; the `explainAsYouGo` mute + `seenConcepts` set; `partInfo.ts` `plain()`/headline prose-number split; the welcome banner. |
| `[new surface]` | a **`short` + `glyph` field** on each `ConceptCard` (one field, **not** a content fork — keyed by the same id); the **sticker-book codex skin** (glyph + chime, write-up demoted). |

**Reading-load is a measurable contract** (the buildable part):

| Surface | Default text budget |
| --- | --- |
| `ConceptCard.short` | one clause, **≤ 7 words** + glyph (the pre-reader/young pull) |
| `ConceptCard.body` | one clause, **≤ 12 words** (the `plain()` register) |
| `ConceptCard.why?` | pull-only — **algebra lives ONLY here** |
| welcome / banner line | one clause; **never blocks Run** |
| `BuildStep.do` | one imperative clause |

**Player-facing / ease-in.** The default a child meets is `short` + glyph + (if voiced) the
retro-Probe reading it; the adult **pulls** `body`, then the info-drawer for `why`. *Reaching
for the deeper text IS the pull that says "I read."* The sticker-book codex lets a non-reader
**collect** phenomena instead of reading about them — same id-keyed event, two skins.

**Checklist**
- [ ] `short` (≤7w) + `glyph` added to every `ConceptCard` record (one field, same id). **This is
  NEW authoring, not reuse** — the 4 existing cards (`source`/`ground`/`loop`/`reading`) each need a
  `short` written, and new cards ship with one. (Owner/content hand-off; small but real effort.)
- [ ] `body` capped ≤12 words; `why?`/algebra demoted to the pulled drawer.
- [ ] Welcome line ≤ one clause and never gates Run.
- [ ] Sticker-book codex skin renders glyph + chime; write-up is the pulled layer.
- [ ] No content fork — the youngest and the EE read **depths of one entry**, never two tracks.

---

## 3. Axis 2 — Motion reduction (including the PixiJS CANVAS)

**The gap, stated plainly.** `app.css` `prefers-reduced-motion` block **[app.css:1267]** quiets
only HUD/CSS chrome (transitions, glows). It does **not** touch the **PixiJS canvas flow** —
the chevrons, carriers, energy dots, and breathing pulses all run off **`FLOW_HZ`, a
module-private `const = 0.6` [board.ts:198]** that no OS query can reach. A reduced-motion user
gets a calm HUD over a fully-animated board. **This axis closes that gap.**

| | |
| --- | --- |
| `[machinery]` | the single bounded flow clock (`FLOW_HZ`) that drives **all** animated board things ([visual-language.md] "decoupling flow rate from magnitude"); the existing reduced-motion CSS block; the fact that magnitude is **already** carried by density/thickness/number, not motion. |
| `[new surface]` | **promote `FLOW_HZ` from a private `const` to a settable/guarded value** wired to `matchMedia('(prefers-reduced-motion: reduce)')` and a **full \| calm \| still** control in the prefs cluster; the **static/reduced-flow render fallback** (caps chevron density — doubles as the §8 low-end fallback). |

**The binding default: CALM (slow), NOT STILL.** A frozen board kills the hook (the
dark→alive flip is the whole moment-to-moment loop, [beginner §6.1]). So:

| Setting | Flow clock | Magnitude still readable via |
| --- | --- | --- |
| **full** (default, no RM signal) | `FLOW_HZ ≈ 0.6` | density + thickness + number |
| **calm** (default **under** `prefers-reduced-motion`) | `FLOW_HZ` slowed (e.g. ~0.15) | density + thickness + number (unchanged) |
| **still** (explicit pull, or low-end fallback) | flow paused; direction shown by a single static chevron | density + thickness + number (**the whole magnitude story survives**) |

Because magnitude was **never** on the flow rate ([visual-language.md]), slowing or freezing
the clock is **information-lossless** — and **bit-identical** to the sim (the clock is a
presentation phase accumulator that never feeds back). Every animated cue (FAIL pulse, smoke,
Ship-It juice, idle-bob) must **collapse to an instant state change** under reduced motion;
**motion is never the sole channel** for any meaning.

**Player-facing / ease-in.** No picker on entry. The OS `prefers-reduced-motion` signal
**auto-seeds calm** silently; the full \| calm \| still control sits in the prefs cluster for
anyone who wants to push further. The blow-up under reduced motion degrades per
[probe-teaching-arc.md §4/§15]: **dim + small puff, no spin, no particle storm** — meaning in
the FAIL box + named-cause chip, not the particles.

**Checklist**
- [ ] `FLOW_HZ` promoted to a guarded/settable value; **default still `0.6`** when no signal.
- [ ] Wired to `matchMedia('(prefers-reduced-motion: reduce)')` → **calm**, not still.
- [ ] **full \| calm \| still** control in the prefs cluster (slow, not stop, by default).
- [ ] Every board animation (flow, FAIL pulse, smoke, Ship-It, idle-bob) has a static collapse.
- [ ] Verified: with flow stilled, every magnitude is still readable (density/thickness/number).
- [ ] Determinism note in the PR: the flow clock never feeds the sim (bit-identical).

---

## 4. Axis 3 — Colour-vision safety

**The confirmed redundancy (the good news).** Per [visual-language.md], **voltage *value*
never rides on hue** — height + the number carry it. **A colour-blind learner can read every
*value* today.** The gap is **identity, not magnitude**: `voltageColor` maps each rail to a
hue from the bench wire code (+3.3 orange, +5 red, +12 yellow, GND dark, −12 blue…), and that
**identity** is the one hue-only channel.

| | |
| --- | --- |
| `[machinery]` | `voltageColor` rail-identity hue; the segmented-LED magnitude bar/standpipe (already off-hue); the FAIL box; the `--ok`/`--warn`/`--bad` semantic tokens; op-amp `--pos/--neg/--out` polarity tokens. |
| `[new surface]` | a **per-rail pattern/texture** in `board.ts`, toggled by `railPatterns`, **paired with** (never replacing) the hue; a **named-cause text chip** on FAIL; a **high-contrast HUD** option; a non-hue redundancy audit of the semantic tokens. |

**Implement the pattern twin for *identity*:** each rail hue gets a per-rail
pattern/texture (e.g. dash cadence, dot, hatch) so two rails differ by **shape as well as
hue**. The pattern **pairs with** the hue; it never replaces it. (Vocabulary hand-off:
[beginner §9.9] — the texture set must not clash with chevron density or the AC slosh; needs a
[visual-language.md] addendum.)

**Every semantic colour gets a non-hue twin:** FAIL = box **shape** + pulse + **named-cause
chip**; `--ok`/`--warn`/`--bad` = paired with an icon/word; the by-feel matching meter pairs
colour with a **ring/marker** ([probe-teaching-arc.md §3e]).

**Player-facing / ease-in.** `railPatterns` is **auto-seeded** if a colour-vision pull is
detected (or simply offered once, with a visible undo); never an entry picker. Because
magnitude was already safe, the colour-blind player's experience is **complete today for every
number** — the pattern work only sharpens *which rail is which*.

**Checklist**
- [ ] `railPatterns` per-rail texture added to `board.ts`, paired with `voltageColor`.
- [ ] Pattern vocabulary doesn't collide with chevron density / AC slosh (visual-language addendum).
- [ ] FAIL carries a **named-cause text chip**, not red alone.
- [ ] `--ok`/`--warn`/`--bad` and op-amp polarity tokens each paired with a non-hue cue.
- [ ] High-contrast HUD option in the prefs cluster.
- [ ] Documented: voltage **value** is already colour-safe; only **identity** needed the twin.

---

## 5. Axis 4 — The voiced retro-robotic Probe + captions

**The highest-leverage move in the whole panel:** the app has **no audio today**; voicing the
**already-authored** `plain()` + card strings, keyed by id, reaches pre-readers, ELL,
low-vision, and tired caregivers **at once**, and **localizes for free** with the string table
(§9).

**Voice direction (owner-decided, [probe-teaching-arc.md §9 #11]):** a deliberately **retro,
low-fi, clearly-robotic TTS** — the old Microsoft "Sam"/SAPI4-era voice. A bench-bot *should*
sound robotic; it is charming, on-brand for Critical**Error**Computing, and cheap. **Not** a
warm VO.

| | |
| --- | --- |
| `[machinery]` | the id-keyed `plain()`/card strings (one id space already shared by card/partInfo/codex); the `explainAsYouGo` mute family; the prefs cluster. |
| `[new surface]` | a **presentation-only TTS layer** gated by `readAloud`, keyed by id; the **three voice states** store; an **autoplay-unlock** ride on the first PLAY gesture; the captions contract. |

**The three voice states (one store, all in the `explainAsYouGo` family):**

| State | For | Mechanism |
| --- | --- | --- |
| **SILENT-TEXT** (default) | reader / EE who never pulls audio | on-screen card text only |
| **VOICED** | pre-reader, ELL, low-vision, tired caregiver | TTS of authored `plain()`/card strings, by id |
| **MUTED** | the EE | `explainAsYouGo` = off (no chatter, spectacle still plays) |

**Engine — still TBD (owner picks, [probe-teaching-arc.md §9 #11]):** web `SpeechSynthesis`
tuned ugly (golden-safe, localizes with the table) vs a small bundled retro-formant TTS vs
pre-rendered clips. **Localization caveat:** a retro English formant voice may not exist
per-locale; **non-English falls back to the platform `SpeechSynthesis` voice.** This panel's
build spec is **engine-agnostic** — it specifies the *contract*, not the codec.

**The captions contract (non-negotiable):**
- **Audio is never the sole channel.** Every voiced line **is** the on-screen card text —
  the caption is not a separate string, it is the same id-keyed `body`/`short`.
- The aria-live region (§7) and the card are the SR/deaf/HoH path; **meaning never lives in
  the voice alone** (nor in colour, nor in motion).
- Any non-speech sonification (chimes, the blow-up *poof*) gets a **visual caption**.

**Player-facing / ease-in.** VOICED is **auto-OFFERED, never forced** — the first time a
phenomenon card fires **and** a coarse-pointer/large-tap signal is present (the co-play/young
signature), one tap arms it for the session ([beginner §4.2]). Audio rides the **first PLAY
gesture** (browser autoplay unlock, [probe-teaching-arc.md §9 #12]); the **silent-first-frame
fallback** (captions + picture-bubble) must read fine alone.

**Checklist**
- [ ] `readAloud` flag in the `explainAsYouGo` family; TTS reads **id-keyed authored strings**.
- [ ] Three voice states (silent-text / voiced / muted) in one store.
- [ ] Caption == the card text (same id), always visible; never a second string to drift.
- [ ] Voiced offer is auto-seeded on coarse-pointer + first card; one tap, visible undo.
- [ ] Audio unlock rides the first PLAY; silent-first-frame fallback verified.
- [ ] Non-speech sonification has a visual caption.
- [ ] Engine choice deferred to owner; the contract is engine-agnostic and golden-safe.

---

## 6. Axis 5 — Input across touch / mouse / keyboard-only / switch

**Golden invariant for the whole axis:** every input path **produces the same `BoardGraph` a
mouse would.** Touch hit-areas, tap-to-wire, and the keyboard wiring path are `board.ts` input
handling — **never** a scripted or timed solver input — so they never hash (§11).

| | |
| --- | --- |
| `[machinery]` | the `role="toolbar"` hotbar [App.svelte:4522]; the pointer event plumbing; the value-popover spinbutton (`aria-valuetext`); the drawer Tab/Esc handling; the global key handler. |
| `[new surface]` | a **tap-pin → tap-pin** wiring path; **coarse-pointer hit-area enlargement**; a **keyboard wiring path** (focus pin → Enter → target → Enter); **switch-access** scan; the **guaranteed-Run** rule. |

**Touch-first (auto-seeded on `pointer: coarse` / mis-hits):**
- enlarged hit-areas (**≥ 24 px** targets, pre-armed single parts, can't-miss drop-slots);
- **tap-pin → tap-pin** wiring (no drag required);
- **pinch-zoom yields to** the wire gesture;
- the **guaranteed-Run rule** — a stray tap **starts the sim** rather than opening the 340 px
  info-drawer/value-pop (the Tablet-Twosome hook is the dark→alive flip on a poke, [beginner
  §4.3]).

**Keyboard-only:**
- extend the `role="toolbar"` hotbar; transport + `I` + tool-switch hotkeys;
- a **keyboard wiring path**: focus a pin → Enter → focus target pin → Enter to commit a wire;
- the global key handler **early-returns on INPUT/TEXTAREA** (no hotkey hijack while typing);
  **Esc** closes the pull-ladder;
- linear, predictable focus order; the canvas **stops being an `aria-hidden` island** (§7).

**Switch-access:** the keyboard path + a **single-switch linear scan** over the focus order;
no path requires simultaneous inputs or timing.

**Player-facing / ease-in.** The touch-first prop set (big-tap, pre-armed parts, can't-miss
slots) is the **§7-stage-1 default** for everyone — a motor-accessibility + young-child win at
once — and is **faded by competence-detection** (a fine-pointer + precise-drag + expert-hotkey
user leaves it off, [beginner §4.3]). Nobody picks "touch mode"; the pointer reveals it.

**Checklist**
- [ ] Tap-pin → tap-pin wiring lands the **same BoardGraph** as drag-to-wire (test).
- [ ] Coarse-pointer auto-enlarges hit-areas to ≥ 24 px; pinch-zoom yields to the wire gesture.
- [ ] Guaranteed-Run: a stray tap Runs, does **not** open the info-drawer/value-pop.
- [ ] Keyboard wiring path (focus pin → Enter → target → Enter) commits a wire.
- [ ] Global key handler early-returns on INPUT/TEXTAREA; Esc closes the ladder.
- [ ] Single-switch linear scan over a predictable focus order.
- [ ] All input paths verified to never feed scripted/timed solver input (golden-safe).

---

## 7. Axis 7 — The screen-reader board→prose engine (the hard, previously-undesigned piece)

> **This is the axis [beginner §5 Axis 7] explicitly handed off undesigned.** This section
> designs it concretely. It is a **read-only consumer of the once-per-frame batched snapshot**
> ([loop.ts]'s `electricalMap` + the `state()` Float64Array) — **no parallel sim model, no new
> wasm crossing, ~2 Hz, announce-only-on-change.**

**Today's state:** the main board `<canvas>` is `aria-hidden` / `tabindex=-1` (the canvas at
App.svelte:4369-area and the analysis canvases at 5382/5401/5411 are all `aria-hidden`) — the
**core experience is invisible to AT.** The engine below is the fix.

### 7.1 Two tiers — ship the cheap one first

| Tier | Scope | Cost |
| --- | --- | --- |
| **MVP first cut** (ship first) | an `aria-live="polite"` region announcing the **selected** part's V/I (from `electricalMap`) + the **loop-closed / FAIL** transitions, debounced ≈ 2 Hz | small; only existing reads |
| **Full board→prose** (this section) | narrate the **whole board** ("Loop closed — current flows. OUT settled to 3.3 V. LED is lit.") off the same snapshot | the designed engine below |

### 7.2 The state→prose mapping (the core design)

The engine is a **pure function of one snapshot frame → a short ordered list of prose
clauses.** Three mappers compose:

**(a) node → label.** Each net gets a stable, human label, resolved in priority order:
1. an **authored net name** if the BoardGraph carries one (e.g. `OUT`, `VCC`, `GND`);
2. else the **rail identity** from `voltageColor`'s bench-code (e.g. "the +5 V rail",
   "ground") — the **same identity** the colour names, now spoken;
3. else a **positional fallback** ("node 3", deterministic by the netlist's node index so the
   label is stable frame-to-frame).
The label names **identity**, never magnitude — magnitude is the spoken number (below).

**(b) element → state-word.** Each element maps to a tiny **state vocabulary** keyed off its
kind + its snapshot values (`current`, `vAcross` from `electricalMap`; node V from `state()`):

| Element | State-words (chosen by snapshot thresholds) |
| --- | --- |
| LED / lamp | `lit` / `dim` / `off` / **`failed (over-current)`** |
| resistor | `passing <I>` / `no current` / **`failed (over-current)`** |
| source | `driving <V>` / `off` |
| switch | `closed` / `open` |
| capacitor | `charging` / `charged (blocks DC)` / `discharging` |
| cap/inductor reactive | `storing` / `releasing` |
| any element | append **`failed: <named cause>`** when `failedMask[i]` is set |

The state-word is the **same fact** the glyph shows visually (lit LED, charred FAIL box) —
narrated, never re-derived from a second model.

**(c) magnitude → spoken number.** The exact value, rounded to the display precision the HUD
already uses (e.g. "3.3 volts", "12 milliamps"). This is the **canonical twin** of the bar
height and the on-screen number — magnitude always travels as the number, never as a hue or a
speed adjective.

**Composing a clause:** `<node-label> <verb> <number>` / `<element-label> is <state-word>` —
e.g. "OUT settled to 3.3 volts." / "The LED is lit, 12 milliamps." / "The resistor failed:
over-current."

**On a player-BUILT board (the dominant sandbox case — usually NO authored net names),** the
same mapper degrades gracefully via tiers 2–3: e.g. *"The +5 V rail is driving 5 volts. The node
between R1 and R2 settled to 2.5 volts. The LED is lit, 12 milliamps."* — the rail-identity label
and the positional / by-neighbour fallback carry it, so **nothing requires the player to have named
a net** for the readout to be legible.

### 7.3 The board summary — ordering & scope

A whole-board announcement is an **ordered, bounded** list:
1. **the loop verdict first** — "Loop closed, current flows" / "Loop open — no current" /
   "A part failed" (the single most important fact);
2. **the graded/selected net** next (the OUT the player is solving for);
3. then **changed elements** only (see debounce);
4. **cap the list** (e.g. ≤ 4 clauses per announcement) so AT is never flooded; overflow folds
   to "…and N more" with the rest reachable by **selecting** a part (the MVP per-part readout).

### 7.4 Change-debounce & the ~2 Hz cadence (the determinism-friendly part)

The engine runs off the **already-read once-per-frame snapshot** — it adds **no** boundary
call. But the sim steps far faster than a screen reader should speak, so:

- **Sample at ~2 Hz** (every ~500 ms wall-clock), not per sim tick — the same throttle the
  existing coaching aria-live uses.
- **Announce only on a *state change*.** Hold the previous frame's prose-state per element
  (a small client-only `Map<elementId, stateWord>` + last-spoken net values). Emit a clause
  **only** when an element's state-word flips (off→lit, ok→failed) or a graded net's number
  crosses a **quantization step** (e.g. ≥ 0.1 V or ≥ 5% change) — never re-announce a steady
  value. This kills the "3.30, 3.30, 3.30…" chatter.
- **Coalesce** within a sample window: all changes in the 500 ms window compose into **one**
  ordered announcement, not N interruptions.
- **Transition events** (loop-closed, FAIL rising edge) **preempt** to the front of the next
  announcement.

This is the same discipline as the visual FAIL/coaching debounce — **a presentation-only
sampler with local memory**, never feeding the sim.

### 7.5 The SR a11y contract for coaching surfaces

Every coaching surface (cards, the Probe, the by-feel target) carries: a predictable **focus
order**, **announce-on-fire** (the card is read when it appears), **dismiss-by-keyboard**
(Esc / the visible ✕), and the **privacy-of-failure** stance ([incomplete-circuits.md]) — a
wrong build reads as a **private** "—" + a located hint, **never** a public "WRONG."

### 7.6 Player-facing / ease-in

The aria-live track is **auto-on for AT users** (or pull-only to keep it quiet for sighted
keyboard users — owner call, [beginner §9.16]). It is **not** a separate "blind mode": it is a
parallel readout of the **same** snapshot everyone else sees, so a sighted caregiver and a
blind learner hear/read the **same facts** about the **same board**. Verbosity (loop-verdict-
only vs full-board) sits in the prefs cluster.

**Checklist**
- [ ] MVP cut shipped first: selected-part V/I + loop/FAIL transitions, `aria-live="polite"`, ~2 Hz.
- [ ] node→label mapper (authored name → rail identity → positional fallback; identity only).
- [ ] element→state-word vocabulary per kind, off the snapshot; FAIL appends named cause.
- [ ] magnitude→spoken number at HUD display precision (the canonical twin).
- [ ] board summary ordered (loop verdict → graded net → changed → "…N more"), capped ≤ ~4.
- [ ] ~2 Hz sample; **announce only on state-change / quantization-step crossing**; coalesce.
- [ ] previous-state `Map` is client-only, presentation memory — never feeds the sim.
- [ ] main board canvas exposed to AT (not an `aria-hidden` island); coaching SR contract met.
- [ ] failure stays **private** ("—" + located hint), never a public wrong-answer.

---

## 8. Axis 6 — Low-end device / perf budget

| | |
| --- | --- |
| `[machinery]` | the single bounded flow clock (cap density once); the deterministic fixed-step sim (cheap for small circuits); PWA/no-account link entry [roadmap §20]. |
| `[new surface]` | a **tiered/static render fallback** (fewer chevrons, capped density) — **doubles as the §3 "still" motion state**; a perf-budget watchdog. |

**Proposed budget (confirm by measurement, not yet benchmarked):** **≥ 30 fps sustained on a
~2019 ARM/Celeron Chromebook for a ≤ 12-element Fundamentals circuit.** The fallback **degrades
the *presentation*, never the physics** — fewer chevrons, capped flow density, the "still"
flow state — so the **solve is identical**; only the render thins. Low-end + touch are
**modal, not edge** for the teen/classroom and 9–12 journeys ([beginner §5 matrix, §9.18]) —
flag both as **blocking** for those personas.

**Player-facing / ease-in.** The fallback is **auto-seeded** by a dropped-frame watchdog (or
pairs with the OS reduced-motion signal), never a "low-end mode" picker. PWA + no-account link
entry means the classroom device just opens a URL.

**Checklist**
- [ ] Perf budget figure confirmed by measurement on a real low-end Chromebook.
- [ ] Static/reduced-flow fallback caps chevron density; reuses the §3 "still" state.
- [ ] Fallback degrades render only — sim/physics identical (golden-safe).
- [ ] Auto-seeded by a frame-rate watchdog, not a picker.
- [ ] PWA / no-account link entry verified for classroom devices.

---

## 9. Axis 8 — Localization / i18n

| | |
| --- | --- |
| `[machinery]` | the **one shared id space** already used by `concepts.ts` cards / `partInfo.ts` / read-aloud / codex — dedupe, narration, **and** translation share it; the prose/number split (numbers don't translate, so static prose reflows cleanly). |
| `[new surface]` | an **externalized string table** keyed by that id space; a `lang` attribute; **RTL** layout mirroring (**not** the schematic); localized TTS falling out for free. |

**The seam:** externalize HUD labels + teaching prose keyed by the **same id** as the cards /
`partInfo` / read-aloud / codex (**one id space serves dedupe, narration, translation, AND
the SR engine's labels**). The **prose/number split** is what makes this cheap: the number is
locale-neutral telemetry; only the prose moves. **RTL mirrors layout but NOT the schematic**
(a circuit's left-to-right current convention is physics, not reading direction). **Localized
TTS falls out for free** — the retro voice may not exist per-locale, so non-English voicing
**falls back to the platform `SpeechSynthesis` voice** (§5).

**Player-facing / ease-in.** Locale follows the platform; no in-game language picker is
required for v1 (the translatable surface is exactly HUD labels + teaching prose). The
translatable scope is bounded and non-blocking ([beginner §9.17]).

**Checklist**
- [ ] Strings externalized, keyed by the shared id space (card/partInfo/read-aloud/codex/SR).
- [ ] Prose/number split preserved (numbers stay locale-neutral telemetry).
- [ ] `lang` attribute set; RTL mirrors layout, **not** the schematic.
- [ ] Localized TTS rides the table; non-English falls back to platform `SpeechSynthesis`.
- [ ] Translatable surface scoped to HUD labels + teaching prose (bounded, non-blocking).

---

## 10. PULL-NOT-PICK — how each reach affordance eases the player in

**The rule (from [onboarding §10] + [beginner §4]):** a reach affordance is **auto-seeded by
behaviour** or **offered with a visible undo** — **never a settings wall, never a chosen
tier.** Age and skill are **revealed by what the player does**, never declared. The system
adapts the **same content's presentation**, never its **reachability**.

### 10.1 The one legitimate preference cluster

The **only** labelled selector cluster lives **inside the `explainAsYouGo` mute family** and
**gates nothing**:

| Preference | Values | Auto-seed signal | What it changes |
| --- | --- | --- | --- |
| reading register | short+glyph / full prose | dismissed-N-cards-unread; editing a number promotes numeric | how much text, never reachability |
| Probe voice | silent-text / voiced / muted | coarse-pointer + first card → offer voiced; advanced action → mute | whether the Probe speaks |
| motion | full / calm / still | OS `prefers-reduced-motion` → calm | flow-clock rate (slow, never stop, by default) |
| input | precise-drag / big-tap touch-first | `pointer: coarse` + mis-hits | hit-area size + wiring gesture |

Plus the **always-on** redundancy that needs no picker: rail patterns (auto on under a
colour-vision pull), the aria-live track, captions, high-contrast HUD.

### 10.2 The forbidden list (smells like a tier)

| FORBIDDEN | Why |
| --- | --- |
| a difficulty / age / grade picker | declares, doesn't reveal |
| a narrowed-vs-full bin **locked as a mode** | context-narrowing is fine **iff** anyone can expand it now; locking it is a tier |
| goals / tolerances that differ by "level" | the grade must be one grade, two legibilities |
| a quiz/exam that **blocks** | reach is never a gate |
| hiding the numeric form **or** the by-feel form from anyone | both always reachable |

> **The narrowed-bin test (the one ambiguous case):** a guided build may **contextually** show
> only the step's parts (the stage-1 prop set) — **allowed** because the full bin is one tap
> away **right now**, identical for a 5-year-old and an EE. The test is *"can anyone expand it
> this instant?"* (yes ⇒ allowed).

### 10.3 Auto-seeding table (never interrogating)

| Signal | Quiet offer / auto-change (visible undo, fired once) |
| --- | --- |
| coarse-pointer + mis-hits | offer big-tap + voiced |
| `prefers-reduced-motion` | set motion → **calm** (not still) |
| full-bin open / Tier-II arm / expert hotkey | **mute coaching + retire cards BEFORE they fire** |
| dismissed N full cards unread | drop to short register |
| editing a number | promote the numeric (vs by-feel) form |
| colour-vision pull | rail patterns on |
| dropped-frame watchdog | low-end / still-flow fallback |

### 10.4 Caregiver co-play (the symmetric pull)

The **voiced + large-tap** signature (the co-play signature) surfaces a quiet **GROWN-UP**
affordance inside the **same** Explain/Help handle: read-aloud on, enlarged targets, an
optional adult-facing one-liner, the sticker-book codex. It is a **different pull**, perfectly
**symmetric with the EE's mute** — one enables, the other silences, neither is a level. **No
caregiver-guilt mechanics** ([beginner §6.4 charter]).

**Checklist**
- [ ] The prefs cluster lives in the `explainAsYouGo` family and **gates nothing**.
- [ ] Every reach affordance is auto-seeded by a behavioural signal **or** offered with undo.
- [ ] No difficulty/age/grade picker; no locked-mode narrowed bin; no level-varying tolerances.
- [ ] Both numeric and by-feel target forms always reachable by everyone.
- [ ] Caregiver co-play is an offered pull on the co-play signature, symmetric with the EE mute.
- [ ] Failure is always private; no reach affordance ever becomes a gate.

---

## 11. Determinism & golden-safety statement

> **This panel is presentation/UX + web-side local-state only. It touches no Rust, no netlist,
> no `snapshot_hash`, and no determinism golden.** It honours [CLAUDE.md] golden rule #1
> (determinism is sacred) and #2 (coarse JS↔wasm boundary) throughout.

- **The flow clock is presentation-only.** Promoting `FLOW_HZ` to a guarded value and slowing
  or freezing it under reduced motion is **bit-identical** — the clock is a phase accumulator
  that **never feeds the sim** ([visual-language.md]). The static/reduced-flow low-end fallback
  degrades the *render*, never the physics.
- **No new JS↔wasm crossing.** Every a11y read — the SR board→prose engine, the aria-live
  track, the by-feel/numeric targets, FAIL state — consumes the **existing once-per-frame
  batched snapshot** (`electricalMap` per-component V/I + the `state()` Float64Array via
  [loop.ts]). The board→prose engine is a **read-only assembler + a prose mapper with local
  per-element state memory** — new code, but **no** boundary call and **no** parallel sim model.
- **Accessibility never DRIVES inputs.** Touch hit-areas, tap-to-wire, the keyboard wiring
  path, and switch scan produce the **same `BoardGraph` a mouse would** — they are `board.ts`
  input handling, **not** scripted or timed solver inputs, so they never hash.
- **Voiced narration, captions, short-copy, the aria-live track, and i18n are read-only over
  authored strings keyed by id.** Meaning is mirrored across channels; the sim is never
  consulted for a string and never altered by one.
- **No new persisted *coaching* state.** The prefs cluster, `readAloud`, `railPatterns`, and
  motion/input settings are **local UI state**, not hashed — alongside the existing
  `explainAsYouGo` + `seenConcepts` ([onboarding §10.4]).
- **`failed_elements`-style flags stay unhashed** — the SR engine *reads* the FAIL mask and the
  named cause; it never flips it.
- **`cargo test -p sim-core` (incl. `run_is_reproducible`) and the FNV-1a golden are unaffected**
  — no sim-core code changes, no new physics, no new hashed state.

---

## 12. Open questions / owner hand-offs

1. **aria-live verbosity default & ownership.** Loop-verdict-only (quiet) vs full-board (rich);
   on-by-default vs pull-only for sighted keyboard users. *Recommendation:* MVP per-part cut
   on for AT, full board→prose behind a verbosity pull. **Owner + a11y-owner call** (this panel
   designs the engine; default density is owner's).
2. **Board→prose change-thresholds.** The quantization step for "announce a number change"
   (≥ 0.1 V? ≥ 5%?) and the clause cap (≤ 4?) want playtesting with real screen-reader users.
   **Who owns the SR playtest?**
3. **TTS engine.** `SpeechSynthesis`-tuned-ugly vs bundled retro-formant vs pre-rendered clips
   — owner's call ([probe-teaching-arc.md §9 #11]); the spec is engine-agnostic. Confirm the
   non-English `SpeechSynthesis` fallback is acceptable.
4. **Reduced-motion default.** Confirm **CALM (slow), not STILL**, with an explicit `still`
   toggle, and that the blow-up's reduced-motion form (dim + small puff, no spin) is acceptable
   ([probe-teaching-arc.md §15]). **Owner sign-off.**
5. **Rail-pattern vocabulary.** Which texture set maps to which rail without clashing with
   chevron density / the AC slosh? **Hand-off to the [visual-language.md] owner** (addendum +
   a dc-bus-reference variant).
6. **Perf budget figure.** Confirm ≥ 30 fps / ≤ 12 elements / ~2019 Chromebook **by
   measurement**, and whether the watchdog auto-seeds the fallback or merely offers it.
7. **i18n scope & RTL.** Confirm translatable = HUD labels + teaching prose on one id space;
   RTL mirrors layout, not the schematic; externalization in-scope-later (non-blocking).
8. **Co-play detection.** Is "voiced + large-tap armed" a strong enough signature, or is an
   always-present manual caregiver toggle also needed? *Recommendation:* offer-on-signature +
   a manual toggle, never an upfront picker.
9. **Canvas exposure granularity.** Does exposing the main board to AT mean a focusable element
   per part (a focus tree) or a single live region + the per-part selected readout?
   *Recommendation:* single live region + selectable parts for MVP; per-part focus tree as a
   reach goal. **A11y-owner call.**
10. **Where the full keyboard traversal + aria-live track live long-term** — this panel or a
    dedicated SR/keyboard sub-panel? This doc provides the **buildable spec**; if a focused SR
    owner is assigned, §6–§7 are their charter. ([beginner §9.16].)

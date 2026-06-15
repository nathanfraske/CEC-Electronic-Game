<!-- SPDX-License-Identifier: Apache-2.0 -->

# Onboarding / first-run — teaching someone who knows nothing about electronics

Status: **design ideation. No code yet.** Owner-driven brief. The verbatim ask:

> "How to get someone who **literally knows nothing about electronics at all** to
> get the ball rolling. Like **how do you wire things up**, **what am I even
> looking at**, **what am I trying to read**, etc."

So the target user has **zero** electronics knowledge and **zero** familiarity
with this app. In the first few minutes, the experience must answer all of:

- **(a) What am I looking at?** — the board, the part glyphs, the scope, the live
  numbers, the HUD.
- **(b) How do I wire things together?** — the placement + pin-to-pin mechanic.
- **(c) What am I trying to do / read / achieve?** — the goal, the scope trace,
  what "it works" looks like.
- **(d) The absolute-minimum mental model of electricity itself** — what voltage
  and current even are — delivered just-in-time, never as a wall of text.

This note is **presentation / UX only**. It never touches `sim-core`, the
netlist, the snapshot hash, or the golden — same discipline as
`carrierOffset`/`phase`. It honours the design tokens (`web/src/app.css`), the
power-bus visual language (`docs/ui/visual-language.md`), and — critically — it
**reuses the machinery already in the tree** (the `primer` example, Build mode's
`do`/`why`/`done` steps, the intro banner, the value popover, the info drawer,
the incomplete-circuit affordances). It adds the *smallest* new surface that the
brief actually demands.

It is the presentation companion to `docs/game-progression.md` §1 ("The
opening"), which already specifies the *narrative* arc of the first session — the
t=0 inventory, the "bench dares you" beats, and the first "3.3 V from a 5 V rail"
contract. **That doc owns the what-happens-when; this doc owns the how-it-looks
and which-existing-pieces-carry-it.** Where the two touch, this note defers to
the progression doc's beats and fills in the UX underneath them.

---

## What the ground already gives us (read before judging the proposals)

The recommendations lean on each of these; none of it is hypothetical.

- **The board opens on the `primer`, paused.** `App.svelte` `onMount` ends with
  `EXAMPLES.find(e => e.id === "primer")` → `loadExample(primer)`, and
  `loadExample` calls `controls.pause()`. So the *very first thing on screen* is
  already a tiny, complete, **not-yet-running** circuit: a 5 V source pushing
  through one 1 kΩ resistor in a loop, with GND. The hook exists; we are tuning
  it, not inventing it.
- **The intro banner already names the two primitives.** `showIntro` renders the
  `.intro-banner`: *"This is electricity. The arrows … are current … The wire's
  colour is its voltage …"* with `--accent`/grey cues and a `▶ Run` /
  `Measure` / `Clear` call to action, dismissable with `×`. This is a first,
  rough version of "what am I looking at."
- **Build mode is a guided, checked, self-advancing tutorial engine.**
  `startBuild(ex)` clears the board, arms `V`, runs the sim live, and shows the
  `.guided-overlay`: an ordered `<ol>` of `steps`, each with a `do` (the
  instruction) and — only for the *current* step — a `why` (the teaching). As the
  player places parts and draws wires, `advanceBuild` re-derives `BuildProgress`
  (`count` by kind, `wires`, `complete`) and ticks `buildStep` forward when the
  current step's `done(p)` predicate passes. When the loop closes it shows
  `guided-done` (*"✓ Loop closed — current flows…"*); until then `guided-open`
  (*"Open loop — no current flows until you close it to ground."*). **This is the
  primary vehicle for onboarding.** The `primer` example's three steps already
  read as a from-zero lesson.
- **Wiring already works in the default (Build) tool.** `board.ts`
  `onPointerDown`: a press on a pin starts a wire **in both `wire` and `select`
  mode** (`if (pin && (mode === "wire" || mode === "select"))`). So a beginner who
  never touches a tool button can place parts and then **drag from a pin to a
  pin** to wire. `drawPendingWire` rubber-bands a routed trace to the cursor,
  **snaps to a target pin with a ring** (`circle(end, PIN_R+2)`), and previews a
  junction dot when releasing on a wire. The mechanic is sound; it is just not
  *announced*.
- **The armed-part ghost + contextual hint already exist.** Arming a part draws a
  translucent ghost glyph snapped to the grid cell under the cursor
  (`updateGhost`, `GHOST_ALPHA`), and the `hint` line under the board changes per
  context (`"PLACING Resistor · click to drop · R to rotate · Esc to cancel"` /
  `"BUILD · arm a part & click to place · drag a pin to wire …"`).
- **Selecting a part teaches it three ways already.** Single-click → the value
  popover (`.value-pop`) with a live `V across · I through` meter; the info drawer
  (`ⓘ Info`) with the part's equation, plain-language `plain()`, and a "Right now"
  live block from `partInfo.ts`; and the always-on **belt explainer**
  (carriers vs energy).
- **The scope / telemetry panel** shows per-node voltage traces, a snapshot hash,
  tick/sim-time, and per-node value bars (`App.svelte` telemetry aside +
  `recordScope` in `board.ts`).
- **Incomplete circuits have a planned honest read.** `docs/ui/incomplete-circuits.md`
  already specifies: an amber located hint chip, a ring on the offending pin, and
  `—` instead of a fake number. `circuitWarning` already fires this for a
  return-less current source. This vocabulary is exactly what "you haven't closed
  the loop yet" wants.
- **`mode-flow.md` already has pin-hover-snap on its roadmap.** Its Phase 1
  ("feedback, remaining") lists *"pin hover highlight + snap-ring"* and
  *"Pins **highlight on hover** with a snap-ring so the target is obvious."* The
  onboarding wiring lesson should **land that Phase-1 item** rather than invent a
  parallel highlight.

The headline: **almost everything onboarding needs already exists.** The job is
sequencing, restraint (hide most of it at first), three small affordances, and a
first-run flag.

---

## 1. The cold open (first 30 seconds)

### What it shows

Keep the existing decision — **auto-load the `primer`, paused** — but make it the
deliberate "here's what you're working toward" hook the brief asks for, and add
one thing it's missing: **show it alive first, then hand it over.**

Recommended cold open, concretely:

1. **On first ever launch, the `primer` is loaded and the sim auto-runs for a few
   seconds** (a `firstRun` flag flips the usual paused-on-load to a brief
   auto-play). The novice's literal first sight is **arrows crawling along a wire
   and the wire glowing amber then fading to grey across the resistor** — motion
   and colour, no reading required. This is the "this is what 'it works' looks
   like" promise, delivered before any words.
2. **A single welcome line**, not a manual. One sentence, in the display face,
   over a dimmed board:

   > **This is a circuit. It's running. Let's build one.**

   with two buttons: **`Show me` (Watch)** and **`Let me try` (Build)**. This is
   the "Watch / Try fork" — but defaulted and gentle, not a wall of choices.
3. **After ~4 seconds (or on any interaction) the auto-run pauses** and the
   existing `.intro-banner` text takes over as the persistent "what am I looking
   at" caption — but trimmed (see §2). The transport's `▶ Run` now pulses once to
   say *you* are in control of time.

### What it must NOT show

Progressive disclosure is the whole game here. On first run, **hide everything
that isn't the primer and its two primitives:**

- **Collapse the parts bin to the few parts the lesson uses.** The bin today
  renders all ~30 parts across six category folders. A novice confronted with
  `N-MOSFET`, `D Flip-Flop`, `FPGA Fabric` on second zero learns only that this is
  not for them. For first run, show **only `V`, `R`, `GND`** (the primer's parts),
  with the rest behind a quiet *"+ more parts (locked)"* affordance. This also
  exactly matches `game-progression.md` §1.1's t=0 inventory (ideal `V/I/R/C/L` +
  `GND`); onboarding can start *even narrower* than that and widen to it.
- **Hide the secondary tools.** `Wire`, `Junction`, `Label`, `Measure`, the
  `Factory`/`Schematic` lens, `Save`/`Load`, the rate presets, the scrubber — none
  of these belong in the first 30 seconds. Leave **`Run/Pause`, `Build`, and the
  three parts.** Everything else fades in as it becomes relevant (§7).
- **Don't show the raw scope/telemetry numbers yet.** The snapshot hash,
  `Tick 0 / 0`, six node-voltage bars — these are instrument-panel furniture that
  means nothing cold. Keep the telemetry panel collapsed until the first reading
  matters (the moment they press Run on their *own* circuit).

The principle: **the first screen has at most ~5 interactive things on it.** The
HUD the experienced user wants is *earned into view*, the same way the tech tree
earns parts.

---

## 2. "What am I even looking at?" — naming things just-in-time

A novice needs the board, a glyph, the scope, the numbers, and the HUD *named* —
but not all at once and not as a legend. Use **just-in-time coach-marks**: a
small, dismissable, anchored callout that fires the first time a thing becomes
relevant, names it in one phrase, and goes away forever once acknowledged.

This is a **new but tiny surface**: a single coach-mark / spotlight layer (a DOM
overlay sibling to `.value-pop` and `.guided-overlay`, `z-index` just above the
canvas), driven by a small ordered list of first-run "tips," each with a target
(a board anchor rect we already compute via `onAnchor`, or a fixed UI element), a
one-line body, and a `seen` flag persisted in `localStorage`. It reuses the
existing anchor-projection plumbing (`emitAnchor`/`onAnchor`) so a coach-mark can
point at a part on the board and track pan/zoom, exactly like the popover.

What gets named, in what order, triggered by what:

| # | Names | Triggered by | One-line body (draft) |
| --- | --- | --- | --- |
| 1 | **the wire / current** | cold-open auto-run | "These arrows are **current** — electric charge flowing." |
| 2 | **the wire colour / voltage** | same frame, 2 s later | "The wire's **colour** is its **voltage** — the push. Amber = high, grey = ground (zero)." |
| 3 | **a glyph** | first time the player arms or hovers a part | "This symbol is a **resistor**. Every part has a symbol like this — it's what engineers draw." |
| 4 | **the goal / what 'done' is** | entering the first Build | "You're closing a **loop** so current can flow all the way around." |
| 5 | **the live readout** | first time a part is selected | "The green line is what's happening to *this* part **right now** — volts across it, amps through it." |
| 6 | **the scope** | first time the player runs *their own* circuit | "This is a **scope** — it draws each wire's voltage over time, like a heart monitor." |
| 7 | **the HUD/tick** | deferred; only if the player opens telemetry | "Tick = one tiny step of simulated time. You can pause and step one at a time." |

Rules that keep this from becoming a clippy:

- **At most one coach-mark on screen at a time**, and never while the player is
  mid-drag (mid-wire, mid-place). They queue and fire on the next idle moment.
- **Each fires once, ever** (persisted), and the whole system is behind the
  `firstRun` flag — a returning or experienced user never sees them.
- **Every coach-mark is dismissable** (`×` / click-away / Esc) and **the sequence
  is skippable wholesale** from tip #1 ("Skip the tour"). See §7's
  "I-already-know-this" path.
- They **name, they don't lecture.** One clause of *what it is*, optionally one of
  *why you care*. The deep version is always one click away in the info drawer.

Coach-marks deliberately do **not** replace the `.intro-banner` or the
`guided-overlay` — they *layer*: the banner is the persistent caption, the guided
overlay is the step list, the coach-marks are the one-time "that thing right
there is called X" pointers.

---

## 3. "How do I wire things up?" — the hardest mechanic, hand-held

For a zero-prior user, "drag from a pin to a pin" is **not** discoverable on its
own: they don't know parts have pins, don't know pins are draggable, and don't
know what a wire is *for*. The good news (§"ground"): the mechanic already works
in the default tool and already has rubber-band + snap-ring feedback. The job is
to make the **first** wire feel like the game reaching out and guiding the
player's hand, then never needing to again.

### The hand-held first build (the `primer`, as a Build)

The `primer` already has exactly the right three steps. Onboarding makes the
**first** run of it a fully-guided, can't-fail wiring lesson by adding affordances
on top of the existing `do`/`why`/`done` engine:

1. **Place the source.** Step 1 (`"Place a Voltage Source (V)."`) — `V` is already
   auto-armed by `startBuild`. The ghost shows where it will land. A coach-mark on
   the board centre: *"Click the glowing square to drop it here."* `done` fires at
   `count.V >= 1`; the step list advances and the `why` rolls to the next step.
2. **Place the resistor.** Step 2 — arm `R` for them (a small new behaviour:
   onboarding can pre-arm the *next* step's part so the novice never has to find it
   in the bin). Ghost again, drop, advance.
3. **Wire the loop — the moment that matters.** Step 3 is
   `"Wire them into a loop: V+ → R → V−, then press Run."` This is where the new
   wiring affordances earn their keep:

   - **Pin reveal.** While this step is current, **make every relevant pin
     visible and breathing** — a soft pulsing ring on `V`'s two pins and `R`'s two
     pins (reuse the neon-glow motif; `PIN_R`-based rings like the snap-ring
     already drawn). The novice now *sees* there are connection points. This is
     the `mode-flow.md` Phase-1 "pin hover highlight + snap-ring," promoted to
     "pins glow during the wiring step" for first run.
   - **"Wire from here → to there" ghosting.** Highlight the **specific source
     pin to start from** (a brighter ring + a tiny "start here" tick) and **ghost
     the target pin** it should land on (a faint dashed ring). When the player
     presses the start pin, the existing `drawPendingWire` rubber-band takes over;
     as they near the target, the existing snap-ring confirms it. This is a thin
     presentational layer reading the example's known target topology (the build
     already knows `buildTarget` / `graphShape`), highlighting the next missing
     edge.
   - **A cursor nudge, once.** The very first time, a one-shot animated hint
     hand/dot can trace pin→pin to *show the gesture* (drag), then fade. Optional;
     the glowing pins + ghost target may be enough. Flag for the owner (§9).
   - **The open-loop read is the teacher.** Until the loop closes, the
     `guided-open` banner says *"Open loop — no current flows until you close it
     to ground,"* the board sits dark/idle, and (reusing
     `incomplete-circuits.md`) the dangling pins can carry the faint amber
     "nothing flows here yet" ring. The instant the last wire closes the loop,
     `done: p.complete` fires, `guided-done` flips to *"✓ Loop closed — current
     flows,"* and **the board comes alive** — arrows start, the wire colours light
     up. **That cause→effect is the entire lesson of wiring**, and it's already
     wired (pun intended) into `advanceBuild`'s `complete` flip.

### What makes wiring discoverable with zero priors

- **The pins announce themselves** (glow) instead of waiting to be hovered.
- **The next connection is pre-drawn as a ghost** so "wire from here to there" is
  literal, not inferred.
- **The feedback is immediate and physical**: open loop = dark and "nothing
  flows"; closed loop = light and motion. The novice learns "a circuit must be a
  complete loop" by *doing it*, not by being told.
- **They can't get lost**: the step won't advance until the right edge exists, the
  `why` explains *why* each edge matters, and **Show solution** (already in the
  guided overlay) is the escape hatch that wires it for them if they stall.

Crucially this needs **no change to the wiring mechanic** — only a first-run
highlight layer over pins and a ghost of the next target edge, both pure
presentation.

---

## 4. "What am I trying to read?" — interpreting success

A novice doesn't know what the scope trace, the readouts, or the flow animation
*mean*, or what "success" feels like. Teach reading by tying every channel to the
**concrete thing they just caused**, and by making success loud.

- **The flow animation is the first thing they read, and it reads itself.** Per
  `visual-language.md`: current = chevron **direction + density + thickness**;
  voltage = wire **colour + height + number**. The novice doesn't need the formal
  encoding yet — coach-marks #1/#2 already gave them "arrows = current, colour =
  voltage." Success at this stage *is* "the arrows are moving and the wire lit
  up." Lean on the calm, magnitude-decoupled flow clock (`FLOW_HZ`) — it never
  blurs, so even a beginner can track a single chevron.
- **The live readout is the second thing.** When they select their resistor, the
  popover's `V across · I through` meter and the info drawer's "Right now" block
  show the *actual* numbers (e.g. `5 V across · 5 mA through`). Coach-mark #5 names
  it. The lesson: *the picture and the numbers are the same fact* — the lit wire
  and "5 V" are one thing. This is the synchrony `teaching-tools.md` calls the
  point of keeping the board live beside the panel.
- **The scope is the third thing, and only when they own a circuit.** It earns its
  introduction when the player presses Run on something they built. Coach-mark #6
  ("heart monitor for voltage") + a single highlighted trace. For the `primer`
  (pure DC) the trace is a flat line at 5 V — which is itself a teachable "steady"
  shape; the first time it *curves* (the RC example) is when the scope becomes
  exciting, and that's deeper in (§7).
- **What "it works" looks and feels like.** Borrow the progression doc's "SHIP
  IT" beat language even for the tutorial win: when the first loop closes, do a
  small, on-brand celebration — the board lighting up *is* the celebration, plus
  a one-line confirmation (*"You made current flow. That's a working circuit."*)
  and the `guided-done` check. The first **self-caused** "I made the light turn
  on" is the emotional anchor; everything after is "do more of that, on purpose."
  (The literal "turn the light on" is the `led-limit` / `manual-switch-led`
  examples — a strong candidate for the *second* guided build, where the success
  signal is an actual glowing LED, not just moving arrows. See §6.)

The throughline: **success is always shown before it is numbered.** Motion and
light first; the green readout second; the scope trace third; the formal
encoding last (and optional).

---

## 5. The minimum mental model, just-in-time

The smallest viable model of electricity, and **the exact moment to introduce
each piece** — each tied to something happening on screen, never as a lecture.
The `primer`'s own `why` strings already do most of this; we are sequencing and
gently analogizing them.

| Concept | One-line framing | Introduced at | Anchored to |
| --- | --- | --- | --- |
| **Voltage = push / pressure** | "Voltage is the push — electrical pressure." | primer step 1 (`why`: *"A source is a pump… an electrical 'pressure'"*) — already there | the source glyph; the wire's colour/height |
| **Current = flow** | "Current is the flow that the push causes." | the instant Run is pressed and arrows move | the chevrons on the wire |
| **A loop is required** | "Current only flows in a complete loop." | the open→closed transition in the first build (`why` of primer step 3, already there) | the dark board → lit board flip |
| **Ground = the zero reference** | "Ground is where we call the voltage zero — what everything is measured against." | when GND is placed / the wire fades to grey at it | the grey end of the wire; `GND 0 V` label already drawn |
| **Resistance = how much flows** (optional, slightly later) | "More resistance, less flow." | only if/when they change R's value and watch the current move | the popover number changing live |

### The water analogy — yes, lean on it, lightly

Water is the right scaffold for this audience and it's already latent in the
copy (*"a source is a pump"*). Recommend a **light, opt-in** use:

- **Voltage ≈ water pressure, current ≈ flow rate (litres/sec), a wire ≈ a pipe,
  a resistor ≈ a narrow section, a loop ≈ the pipes must form a closed circuit
  for water to flow.** This maps cleanly to the first circuit and to the bus
  visual language (height = pressure/voltage; thickness = flow/current).
- Deliver it as **one optional coach-mark / info aside**, not a forced detour:
  a *"Think of it like water →"* expandable on the first build. Players who want
  the metaphor get it; players who'd rather just push the button aren't slowed.
- **Stop before it breaks.** Be explicit (one line) that the analogy is a
  crutch we'll outgrow — capacitors, AC, and reactive power are where water
  starts to mislead, and by then the player has the real picture. Don't build the
  whole curriculum on it; use it only for the first loop.

The rule: **introduce a concept the first time the player can watch it be true**,
in one sentence, where they're already looking — and never introduce one before
the screen can demonstrate it.

---

## 6. The 5-minute first-run script (the centerpiece)

Beat-by-beat, from cold open to the first self-caused win. Each beat: **what
appears · what the user does · what they learn · what they feel.** Existing
machinery is named in brackets.

**0:00 — Cold open.** *Appears:* the `primer`, **auto-running** — arrows crawling,
wire amber→grey [`primer` autoload + first-run auto-play]. A dimmed overlay with
one line, *"This is a circuit. It's running. Let's build one,"* and **`Show me` /
`Let me try`**. *Does:* watches (or clicks). *Learns:* circuits are alive and
visual. *Feels:* "oh, that's pretty — and not scary."

**0:10 — Name the two things.** *Appears:* coach-mark #1 on the wire (*"arrows =
current"*), then #2 (*"colour = voltage; grey = ground/zero"*) [coach-mark layer +
`onAnchor`]. *Does:* reads, dismisses. *Learns:* the two primitives, by name, on
the live picture. *Feels:* "I already understand what I'm seeing."

**0:30 — Take the controls.** *Appears:* auto-run pauses; `▶ Run` pulses once; the
trimmed intro banner persists [`.intro-banner`, `controls.pause()`]. *Does:*
presses Run / Pause a couple of times. *Learns:* *I* control time; current flows
only while it runs. *Feels:* agency.

**1:00 — "Let me try" → the first build begins.** *Appears:* board clears to a
near-empty bench; bin shows **only `V`, `R`, `GND`**; the guided overlay shows the
three primer steps; `V` is pre-armed with a ghost [`startBuild`, narrowed bin,
guided overlay]. *Does:* clicks to drop `V`. *Learns:* parts are things you place;
the source is the pump. *Feels:* "I'm building it myself now."

**1:30 — Drop the resistor.** *Appears:* step 2 highlights; `R` auto-armed; ghost
[pre-arm next part]. *Does:* drops `R`. *Learns:* a second part, named. *Feels:*
momentum.

**2:00 — Wire the loop (the hump).** *Appears:* step 3's `why`; **all four pins
glow**; the **start pin is brightened and the target pin ghosted** ("from here →
to there"); `guided-open` says *"no current flows until you close it"* [pin-reveal
+ next-edge ghost + existing pending-wire rubber-band/snap-ring + `guided-open`].
*Does:* drags pin→pin, two or three times, to close V+→R→V−→GND. *Learns:* parts
have pins; a wire joins them; **a circuit must be a closed loop.** *Feels:* a
small puzzle, with the answer visibly scaffolded — never lost.

**3:00 — It comes alive (the win).** *Appears:* the moment the loop closes,
`done: p.complete` fires; board lights up — arrows move, wire colours in;
`guided-done` flips to *"✓ Loop closed — current flows"*; a one-line
*"You made current flow. That's a working circuit."* [`advanceBuild` complete
flip]. *Does:* watches their own circuit run. *Learns:* **I caused this.** *Feels:*
the anchor win — "I made it work."

**3:30 — Read what they made.** *Appears:* coach-mark #5 on the resistor; they
select it; popover shows `5 V across · 5 mA through`; coach-mark #6 names the
scope (flat 5 V line) [value popover, scope]. *Does:* selects the part, glances at
the numbers. *Learns:* the picture and the numbers are the same fact; "steady" is
a flat scope line. *Feels:* "I can *read* this, not just look at it."

**4:00 — Hand off to the game.** *Appears:* the progression doc's first goal —
*"A customer needs 3.3 V from this 5 V rail. You've got the parts"* — as an
**offer, not a gate** [`game-progression.md` §1.3]; the bin quietly widens toward
the full Tier-I set; the rest of the HUD fades in. *Does:* takes the goal (or
keeps tinkering). *Learns:* there's a *reason* to build — a spec to hit. *Feels:*
"I'm playing the actual game now, and I'm ready for it."

**4:00–5:00 — Optional second build (light the LED).** For players who want one
more guided beat before going solo, offer `manual-switch-led` or `led-limit` as a
"now make a light turn on" follow-up — the success signal is a literally glowing
LED and a clickable switch, the most satisfying possible "it works." Lighter
scaffolding than the first (pins glow only on hover now, fewer coach-marks). This
is the bridge from full hand-holding to the examples library (§7).

Total: a novice goes from "I know nothing" to "I built a working circuit, read
its numbers, and have a goal" in **five minutes**, having been *told* almost
nothing and *shown* almost everything.

---

## 7. Scaffolding → independence

The hand-holding fades in deliberate stages; each removes a prop the previous
stage provided. Onboarding **ends** and the game **begins** at the first contract.

1. **Fully guided (first build, ~minutes 1–4).** Bin narrowed to 3 parts; next
   part pre-armed; pins glow; next edge ghosted; coach-marks fire; `Show solution`
   available. Can't fail, can't get lost.
2. **Lightly guided (second build / first examples).** Bin widens to Tier-I; parts
   no longer auto-armed (they find them — easy, the bin is small); pins glow only
   on hover (`mode-flow.md` Phase-1 default); fewer coach-marks; the guided overlay
   still narrates `do`/`why`. The `examples` library's **Watch / Build** modes are
   the natural home for this — a whole graded ladder of guided builds already
   exists, ordered from `Fundamentals` outward (`EXAMPLE_CATEGORIES`).
3. **Free sandbox + library (independence).** Full parts bin, all tools, no
   coach-marks. The player explores examples at will (Watch to see, Build to do),
   uses the info drawer to learn parts, and tinkers freely. The `demo` one-toggle
   on many examples (*"lift the cap," "switch open/closed"*) gives self-serve
   "what changes if…" experiments without any tutorial.
4. **The game proper (contracts + tech tree).** The first contract (3.3 V divider)
   hands off into `game-progression.md`'s loop: Credits widen the sandbox, Lux
   deepens it, eureka discounts reward tinkering, the codex/Lab Notebook turns
   "I wonder what happens if…" into progress. **Onboarding's job is done the moment
   the player accepts that first contract**; from there the progression and
   contract docs own the experience.

### The "I already know electronics" path (must-have)

A forced linear tutorial would insult a hobbyist or EE. So:

- **Tip #1 offers "Skip the tour" / "I know electronics."** One click sets
  `firstRun = false`, dismisses all coach-marks permanently, expands the full bin
  and HUD, and drops the player straight into the free sandbox (or the examples
  library) with the `primer` still loaded to play with.
- **The skip is also implicit:** any "advanced" action — opening the full bin,
  arming a Tier-II part, switching to the Factory lens, hitting an expert hotkey —
  is taken as a signal to **quietly retire the coach-marks** (they were never
  modal; they just stop queuing). Competence is detected, not interrogated.
- **Nothing is gated behind the tutorial.** The progression doc's first contract
  is an *offer*; the tutorial is *skippable*; the sandbox is *always* available.
  The hand-holding is a default for the lost, never a wall for the capable.

---

## 8. Reusing vs. extending — exactly what carries the load

**Carries the load (already in the tree, reused as-is or lightly tuned):**

- **The `primer` example** — the cold-open hook *and* the first guided build. Its
  `blurb`, `watch`, and three `do`/`why`/`done` steps are already from-zero
  teaching copy. No content change needed for MVP.
- **Build mode's `do`/`why`/`done` engine** (`startBuild`, `advanceBuild`,
  `.guided-overlay`, `guided-open`/`guided-done`) — the tutorial state machine. It
  already checks progress, advances steps, and flips on loop-closure. **This is
  the spine of onboarding.**
- **The intro banner** (`.intro-banner`) — the persistent "what am I looking at"
  caption (trimmed for first run).
- **The armed-part ghost + contextual `hint`** — already make placement legible.
- **The value popover + info drawer + belt explainer** — the "read it / understand
  it" layer (`partInfo.ts`), reused verbatim; coach-marks just *point* at them.
- **The incomplete-circuit affordances** (`incomplete-circuits.md`: located amber
  ring, `—` for unsolved nodes) — repurposed as the "open loop, nothing flows
  here yet" cue during wiring.
- **The examples library + Watch/Build + `demo` toggles** — the entire
  "scaffolding → independence" middle (stage 2–3).
- **`game-progression.md` §1** — owns the narrative beats and the first contract;
  this doc plugs the UX in underneath.

**Small new affordances needed (minimal, all presentation-only):**

1. **A `firstRun` flag** (persisted in `localStorage`) gating: cold-open
   auto-play, the narrowed bin, the coach-mark sequence, and pre-arming. Cleared by
   "Skip the tour" or any advanced action. *One boolean + a few guards.*
2. **A coach-mark / spotlight layer** — a DOM overlay sibling to `.value-pop`,
   driven by an ordered list of `{ target, body, seen }` tips, reusing
   `onAnchor` for board-anchored callouts. One at a time, once each, fully
   skippable. *The one genuinely new UI component, and it's small.*
3. **First-run wiring affordances** — (a) **pin reveal**: pulsing rings on the
   current build step's pins (extends `mode-flow.md` Phase-1 hover-snap to "glow
   during the wiring step"); (b) **next-edge ghost**: a faint dashed start-pin
   highlight + target-pin ghost for the next missing wire, read from the build's
   known `buildTarget`. Both are draws on existing layers; **no change to the
   wiring mechanic.**
4. **Bin-narrowing + pre-arm hooks** — show a subset of `PARTS` and auto-arm the
   next step's part during the first build. *Filtering an existing list + a setter
   call.*
5. **Cold-open auto-play + welcome line** — flip the load-time pause to a brief
   auto-run on first run, plus the one-line dimmed welcome with the Watch/Try
   fork. *A timer + one overlay.*

Everything else is sequencing and copy. No sim, netlist, snapshot, or golden
impact anywhere; nothing crosses the JS↔wasm boundary that doesn't already.

---

## 9. Open questions / hand-offs (for the owner to settle)

1. **Forced-linear vs. optional tutorial.** Recommendation: **optional and
   skippable**, default-on for first run, with a one-click "I know electronics"
   bail and implicit skip on advanced actions (§7). *Confirm* the tutorial is
   never a gate — that the sandbox and the first contract are reachable without
   completing it.

2. **How much reading is too much?** The whole design biases to **show, then name
   in one clause**, with depth deferred to the info drawer. *Confirm* the
   coach-mark register (one short sentence, name + optional why) and that the
   trimmed intro banner is the most prose a novice should meet before their first
   win. Is even the welcome line too much?

3. **Gate the full UI until after the first win, or just hide-and-fade?**
   Recommendation: **hide-and-fade, not hard-lock** — the bin/tools are *collapsed*
   and *fade in*, not *disabled*, so a curious or experienced user can always pop
   them open (which also doubles as the implicit skip). *Confirm* this over a hard
   gate.

4. **Cold open: auto-play first, or paused-with-prompt (today's behaviour)?**
   Recommendation: **brief auto-play, then pause** — motion-first is the stronger
   hook for a true novice and costs nothing (the primer's already loaded).
   *Confirm*, since it changes the literal first second.

5. **The "show the gesture" cursor nudge for wiring.** Is a one-shot animated
   pin→pin hand/dot worth it, or do glowing pins + a ghosted target edge already
   make the drag obvious enough? *Owner call* — it's the one affordance that risks
   feeling gimmicky.

6. **Second guided build: which example, and is it part of "onboarding" or the
   start of "the game"?** Recommendation: offer `manual-switch-led` or `led-limit`
   as an optional "now light a lamp" bridge (§6) — the literal "I made the light
   turn on." *Confirm* whether to script it as a tutorial beat or just let the
   examples library carry it.

7. **Where do coach-mark copy + the tip sequence live?** To keep the prose
   register consistent with `partInfo.ts` / `examples.ts`, recommend a single
   small authored list (id, target, body, optional `why`) alongside the other
   teaching content. *Confirm* the authoring shape.

---

## 10. Owner add-ons (2026-06-15): explore-as-you-learn, level select, replayable

Three owner requirements that sharpen §1/§2/§5/§7 into first-class features. They
fit together: the **level picker** sets the initial coaching *density*; the
**explore-as-you-learn** model means concepts still surface contextually whatever
the level; **replayability** means none of it is one-shot. All three are
presentation + a little local state — no sim/golden impact.

### 10.1 Learn-as-you-explore, not a rail (resolves open question #1)
The tutorial is **not a sequence-locked path** — it's a set of **contextual triggers
fired by what the player actually does**, with the sandbox and the full parts bin
reachable the entire time. Mechanics:

- **First-encounter concept cards.** Each core concept has a one-clause card that
  fires the *first time the screen can demonstrate it true* (§5): first source
  placed → "this pushes current"; first closed loop that lights up → "current needs
  a round trip"; first scope wiggle → "voltage over time." Tracked by a small
  `seenConcepts` set so each fires once. Order is *emergent* from the player's
  actions, not prescribed.
- **Coaching rides alongside free play.** The guided first build (§3) is *offered*,
  never forced; a player who ignores it and starts dragging random parts still gets
  the contextual cards as they stumble into phenomena. Wiring/placement affordances
  (glowing pins, ghost target) appear whenever relevant, not only inside a script.
- **Ties to the Lab Notebook codex** (`game-progression.md` §1): the same
  first-time-you-cause-a-phenomenon moment that fires a card also *logs* it in the
  notebook — so "concepts introduced as you go" and the exploration-reward codex are
  the **same system**, built once. The notebook is the durable record of what you've
  discovered by exploring.
- This makes the "tutorial" a **discovery layer over the sandbox**, which is exactly
  "introduces concepts as you go, but you're free to explore whatever you want."

### 10.2 Self-selected onboarding level at the start
A **one-time picker** on first launch (a small modal over the cold-open §1), setting
the **coaching density, not the content**:

| Level | What it sets |
| --- | --- |
| **Never touched electronics** | Full: the guided first build auto-offered, every concept card, pin/ghost spotlights, the bin pre-narrowed to V/R/GND (§1). |
| **I know some** | Light: bin opens fuller, the guided build is a dismissible suggestion, concept cards fire only for the less-obvious bits (ground reference, the scope), no hand spotlights. |
| **Skip it / I know electronics** | None: full bin + tools + scope open immediately, no cards, straight to the sandbox + first contract (the §7 "I already know electronics" path, chosen explicitly up front instead of bailed into). |

Stored as a single `onboardingLevel` setting. **Changeable later** (§10.3). It only
gates *how much fires*, never *what's reachable* — every level can reach the sandbox,
the examples library, and the first contract immediately (resolves open question #3
as hide-and-fade keyed to the level).

### 10.3 Replayable / never a dead-end
Nothing in onboarding is one-shot; a mistake re-arms the help instead of stranding:

- **Persistent "Help / show me again"** affordance (a corner button or `?` hotkey),
  always present, that can re-open the current step's coach-mark, re-offer the guided
  build, or replay the cold-open intro.
- **Re-triggerable pieces:** any concept card can be re-shown from the **Lab
  Notebook** (it's the codex of what you've met); any guided **example/Build** can be
  re-run from the library (already true — Build mode replays `do`/`why`/`done`); each
  guided step keeps its existing **"Show solution" / reset** escape hatch (§3), so a
  wrong wire just re-shows the target ghost rather than dead-ending.
- **Restart onboarding** in settings: clears `seenConcepts` and re-opens the level
  picker, so a returning or stuck player can take the whole ramp again.
- Implementation is tiny: the same `seenConcepts` set that de-dupes first-encounter
  cards is what "replay" clears or bypasses; no new content, just re-show paths.

### 10.4 Minimal new surface for §10
On top of the ~5 affordances the agent already scoped, these three add only: an
`onboardingLevel` + `seenConcepts` in local settings, the level-picker modal, and a
persistent Help button that routes to existing coach-marks / the notebook / the
example library. The Lab Notebook (already a planned progression reward) carries the
"concepts as you go" record, so 10.1 and the codex are one build.

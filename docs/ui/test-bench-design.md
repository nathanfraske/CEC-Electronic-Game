<!-- SPDX-License-Identifier: Apache-2.0 -->
# In-app Chip Test Bench — design (panel synthesis)

Status: **design / brainstorm**, not built. Synthesized from a 3-voice design panel
(UX & accessibility · engine & methodology · debugging pedagogy) plus the live
debugging of the player's 4-BIT FULL ALU that motivated it. Origin: the owner
observed that the headless "drive pins → step → read → compare → divide &
conquer" harness we used to verify the ALU *is* the tool the game should ship —
for **any age and any experience level**.

The north star: **make verifying and debugging a chip a first-class, teachable
verb** — the trust layer for "sand → CPU." A 7-year-old taps one button to learn
"does it work?"; an EE drives a vector grid and diffs a truth table; **both run
the same engine and the same divide-and-conquer method**, only the pull depth
differs.

---

## 1. One surface, two doors (the framing that drives everything)

Build it as **one panel with two doors**, never an age/difficulty picker (the
project's pull-not-pick law, `accessibility-and-reach.md §10`):

- **Door 1 — "Check It."** One button. The bench recognizes the chip (it already
  can — `recognizeGate`), picks the matching operation, runs every case, and
  answers in one sentence + a green/red strip. Zero typing, zero grid. The
  pre-reader / "I just want to know" door.
- **Door 2 — "Test Bench."** The full instrument: editable input columns,
  expected-output columns, per-bit pass/fail, record-a-run, presets. The
  teen/adult/EE door.

Door 2 is Door 1 with the advanced disclosure opened — **the same panel, same
engine** (mirrors the value-picker's "More ▸"). Legitimate because the full grid
is one tap away *right now*.

---

## 2. The engine — it largely already exists

**Key finding (engine panelist, verified against sim-core):** the headless
drive→step→read→compare loop is already in-tree and headless-tested:
`web/src/lib/characterize.ts` (combinational), `web/src/lib/sequentialTrace.ts`
(clocked), and the determinism-critical per-vector netlist build
`web/src/lib/sweepNetlist.ts`. `recognizeGate` already names AND/OR/NAND/XOR/…,
and pin roles (`PinRole = in|out|vcc|gnd|clk|inout`) are derived at seal time
(`derivePinRoles`). **So the test bench is mostly a new UX surface over an
existing engine + existing metadata** — that changes the cheap/expensive calculus.

The run loop per vector:
1. **Drive** the chip's input pins (high/low per the vector); auto-hold VCC/GND
   and a default clock so a beginner never wires power by hand (the harness had
   to — the tool must not).
2. **Step until STABLE** — *not* a fixed tick count. This is the hard-won lesson
   from the ALU debug: deep cells take many ticks to settle, and a premature read
   is a **false failure** (it nearly made us mis-blame a correct AND gate).
3. **Read** the output pins by role.
4. **Compare** to expected (truth table / named op / recorded golden), per output
   **bit**.

### Convergence detector (the must-build core)
The core exposes **no** converged flag to JS (verified), so the detector is
external:
- **Digital rigs:** declare "settled" when the **state portion of the snapshot
  hash is unchanged for `quietN` ticks**. `snapshot_hash` already folds quantized
  digital levels + discrete sequential state — but it also includes `tick`, so we
  need a tiny golden-irrelevant sim-core read-only accessor **`state_hash()`**
  (hash minus `tick`). Then "settled" = one BigInt compare per tick. *This is the
  single highest-value sim-core ask.* Until it lands, diff a sliced projection of
  the watched output nodes from `state()`.
- **Analog rigs:** "moving" only above the solver's own tolerance — use
  `eps ≈ 1e-6 + 1e-5·|V|` (~10× `NEWTON_RELTOL=1e-6`, abstol lifted off
  `1e-9 V`), so the bench never chases sub-tolerance solver noise.
- `quietN ≈ 8` quiet ticks; `maxTicks ≈ max(256, 64×depth)` with a hard ceiling
  (~10–20k) and a **"did not settle" verdict** (never silently report an
  unsettled read). Replaces the characterizer's fixed `SWEEP_CLK_HALF_STEPS=64`,
  which can under-settle a deep next-state cone.

### Determinism / boundary safety (verified golden-safe)
Run on a **scratch `Simulation`** (as `characterize`/`sequentialTrace` already
do): one batched `step()` + one `snapshot()` read per tick (no per-pin crossing).
Expected tables / recorded runs are **local state** (like `seenConcepts`), never
in `snapshot_hash`. Driving inputs = setting source/switch values + reinstalling
the netlist; reading = `state[node]` via `nodesOfComponent`. `element_currents`,
the FAIL mask, and the LUT state block are confirmed **not hashed**, so a bench
that reads them perturbs nothing. **No sim-core change required** beyond the
optional `state_hash()` accessor.

---

## 3. The UX surface

**Pick the chip:** select on board → "Test this chip" in the inspector popover;
or `▷ test` on a bin tile; or, inside a chip (zoom-to-open), "test just this
sub-cell" (the divide-and-conquer hook).

**Pin card (cheap win — pure presentation over `pinRoles` + `pinout.ts`):** the
chip body centred, pins grouped by role — **inputs left, outputs right, clock
bottom, power cornered**. Role badges are *text + shape + icon*, never colour
alone (`accessibility-and-reach.md §4`): `▸ in`, `● out`, `⎍ clk`, `⏚ pwr`. Power
& clock are **"handled for you"** by default (auto-detected from `pinRoles`).
Unknown-role pins get `[?]` + a one-tap in/out chooser (honest about the gap).
Plain-language aliases on hover (`VCC → "power +"`, `CIN → "carry in"`) via the
`GLOSS` table.

**Input deck — one value, many renderers** (the dual-form discipline; a child
toggling switches and an EE pasting a table exercise the same vectors):
toggles · multi-base number pad (BIN·DEC·HEX, auto-split across a bus — teaches
binary↔decimal by *doing*) · count-up · random · truth-table grid · "all cases"
(guarded by the existing 2^k cap).

**Expected outputs — three ways:** (a) **pick a named operation** (AND, ADD,
2:1 MUX, "store on clock"…) that *generates* the answer key — and pre-suggest it
via `recognizeGate` ("Looks like XOR — test as XOR?"); (b) **record a known-good
run** as the oracle (the divide-and-conquer companion; also "verify seal matches
source"); (c) **type/edit** the expected column (EE escape hatch).

**Verdict at three zoom levels, each redundant across colour + shape + text:**
- **Headline:** `✓ Works! All 17 cases correct.` / `✗ Not yet — 3 of 17 wrong.`
  Copy is **"Not yet," never "WRONG"** (failure is private + located, never
  shaming — `incomplete-circuits.md`).
- **Result strip:** one cell per vector, ✓/✗/– (colour + glyph + position).
- **Vector grid:** per-row AND **per-output-BIT** — the *differing bit* is
  boxed/underlined in both expected and actual, with a worded caret (`← bit 0
  (S0)`). A **"failure fingerprint"** turns rows into a diagnosis: *"S0 is wrong
  whenever A0 and B0 are both 1 — looks like the bit-0 adder."* (the bench doing
  the divide-and-conquer reasoning). "Open this case on the board" loads that
  vector live (on a scratch copy).

**Presets** keyed by recognized type: gate, n-bit adder, k:1 mux, register,
counter, ALU. The **ALU preset is the showcase** — sweep the op-select, group
results by operation, so a failure reads *"the ADD op is wrong; AND/OR/XOR
pass"* → points straight at the sub-cell.

---

## 4. Solving super-complex rigs — divide & conquer as a feature

The thing that actually cracked the ALU was **testing sub-cells standalone**.
Make that a verb:

- **Auto-bisection:** when a big chip fails, the bench offers *"test the parts
  inside one by one"* → it recursively benches each nested sub-chip against its
  recognized/recorded behavior and reports **the smallest failing piece**
  ("the bit-0 adder is the broken one"). This is the hand bisection we did,
  automated. It reuses the same engine pointed at a smaller boundary (the flatten
  can drive any sub-graph).
- **Breadcrumb:** `ALU ▸ Adder ▸ FullAdder[0]` so you always know which boundary
  you're testing, and can pop up.
- **The "it's not you" outcome must be reachable.** The ALU bug was *not* the
  player's design — every sub-piece passed in isolation and the fault only
  appeared with the clock. The helper must be able to land on *"your design is
  sound; this is a timing/engine interaction"* and **say so honestly** (the
  debugging analogue of the honest "—"). When it is a genuine engine bug, the
  repro **is** the bug report (a "copy repro" affordance; determinism makes a bug
  a tiny reproducible seed).

---

## 5. Teaching debugging to any age (the most transferable skill in the game)

The method that solved the ALU — **isolate · compare · one-variable · falsify ·
did-it-settle** — is a *life* engineering skill, not an electronics fact. Teach
it as a method, voiced by the existing **Probe** wearing a detective hat (a mode
of the same character, not a new voice).

**Three-question mental model** (fixed vocabulary across the whole game):
1. **"Does each piece work on its own?"** → *isolate.*
2. **"What changed?"** → *compare working vs broken.*
3. **"Did it finish thinking?"** → *settling.*
…plus *one thing at a time*, *smallest broken piece*, *a guess you can test*.

**The Debug Helper** — a Probe-narrated wizard (a mode of the existing guided
`{do, why, done}` overlay engine) walking the exact six steps that cracked the
ALU: **reproduce minimally → did it settle? → test each sub-chip alone → compare
working vs broken → change one variable → form & falsify a guess → celebrate the
find.** Suggestion + visualization + side-by-side, **never an auto-fixer** — the
player runs the method.

**Visualize the failing bit (mostly a cheap recombination of shipped
primitives):**
- **Spotlight the suspect, dim the rest** — reuse `NET_DIM_ALPHA = 0.45` +
  `highlightNet()`/`drawNetFocus()` pointed at the debug focus. *Single best
  effort:value move.*
- **Red the failing BIT, not the whole chip** — extend the FAIL-box (`failBox`,
  `FAIL_PULSE_HZ`) to ring the specific output pin + the input-combo row, paired
  with a ✗ marker (colour-blind-safe).
- **Trace it inward** — click the red bit → zoom-to-open the owning sub-chip with
  the red propagating to the internal failing cell (the bug's "address" as a
  descent).

**Age-tiered by pull depth, not by a picker** (same six steps, same six concept
ids, different renderer): a 7-year-old sees *"Try the small chip first" 🔬* and a
sticker; an EE sees the truth-table XOR diff + the offending vector + the repro
string, with the Probe muted. **Celebrate causing the isolation** ("You isolated
it!"), and celebrate a caught false-failure loudest ("you avoided a wrong
conclusion" is the deepest debugging win). Every FAIL is a debug on-ramp
("Debug this →" on the FAIL chip launches the helper pre-seeded).

**Ready-to-use tip copy** (Probe register, id-keyed, dismissible chips):
- *"Does it work by itself? Test the small piece before you blame the big one."*
- *"Did it finish thinking? Wait for the numbers to stop before you trust them."*
- *"Change one thing at a time, or you won't know which thing did it."*
- *"What's different when it works vs when it doesn't? The difference is your suspect."*
- *"Make it smaller. The fewest parts that still break it point right at the cause."*
- *"A good guess is one you can prove wrong. Think it's the clock? Turn it off and see."*
- *"Works alone but breaks together? The bug's between the pieces, not inside one."*
- *"It's not always you. If every piece checks out, your design might be fine."*

---

## 6. Build order (cheap wins first)

1. **Pin card** with role-grouped auto-labeled pins + auto power/clock hold. *Cheap.*
2. **Door 1 "Check It"** for recognized combinational chips (verdict UI over
   `recognizeGate` + `characterize`). *Cheap.*
3. **Input renderers** (toggles, multi-base pad, count-up, random, all-cases). *Cheap.*
4. **Per-bit fail highlight + "failure fingerprint" + "open this case on the
   board."** *Cheap–medium.*
5. **Spotlight-the-suspect** via the existing dim primitive; **"Debug this →"**
   on the FAIL chip; the **settle chip** ("settled ✓ / still settling…"). *Cheap.*
6. **Named-operation templates** (gate/adder/mux/register/counter). *Cheap–medium.*
7. **Door 2 vector grid + editable expected + record-a-good-run** (+ "seal matches
   source"). *Medium.*
8. **`state_hash()` accessor** (sim-core, golden-irrelevant) → one-compare settle
   detector. *Cheap sim-core, high value.*
9. **ALU template + divide-and-conquer auto-bisection** + red-propagation through
   zoom-to-open. *Medium–big; phase 2 — the "checker → debugger" leap.*
10. **Debug Helper wizard shell.** *Big lift; composes zoom-to-open + the grader +
    the guided overlay; the heart of the teaching tool.*

---

## 7. Open questions
- **Behavior panel overlap:** make the existing Behavior panel the read-only
  "here's what it does" view and the Test Bench the active "here's whether it does
  what it *should*" view, sharing table-rendering — don't build two truth-table
  widgets.
- **Unrecognized chips:** record-a-good-run is the universal fallback — make that
  path solid on day one so *every* chip is testable, template or not.
- **"Open this case on the board":** run on a **scratch copy**, don't mutate the
  player's board (with a "keep this" option).
- **Non-5V / analog sub-assemblies:** auto-power-hold defaults to logic rails;
  needs a smarter default or advanced override for analog.

---

*Panel grounding (files referenced by the panelists): `web/src/lib/characterize.ts`,
`sequentialTrace.ts`, `sweepNetlist.ts`, `userIc.ts` (`PinRole`, `derivePinRoles`,
`recognizeGate`), `pinout.ts` (`GLOSS`), `sim/loop.ts`; `board.ts`
(`NET_DIM_ALPHA`, `highlightNet`, `failBox`, `INTERNALS_ZOOM`, zoom-to-open);
`App.svelte` (`.guided-overlay`, `buildStep`); docs `probe-teaching-arc.md`,
`beginner-onboarding-all-ages.md`, `accessibility-and-reach.md`,
`incomplete-circuits.md`, `adr/0005-sealed-subcircuits-and-zoom.md`.*

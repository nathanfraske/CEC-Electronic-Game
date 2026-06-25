<!-- SPDX-License-Identifier: Apache-2.0 -->

# Mid-game, classroom & sharing

**One-line thesis:** *the mid-game, the classroom, and sharing are all the **same
machine you already have** — the deterministic contract loop and the portable
deterministic graph — pointed at three audiences (the returning solo player, the
teacher, and the community) and made **legible**. We build almost no new state; we
build **rhythm, roster, and transport** over a graph that already round-trips, and we
ease both players and teachers in by **pull, not pick**, with **no dark patterns**.*

This panel is a **synthesis**, not a re-derivation. Read the inherited docs first
(§0). Everything here is **web-side game-state + presentation** over the existing
deterministic core. **Nothing in this document touches `crates/sim-core`,
`sim-protocol` logic, `buildNetlist` emission, the netlist, or `snapshot_hash`** (see
§7). **Planning only — documentation, no implementation.**

---

## 0. Thesis & relationship to the rest of the design

### 0.1 What this panel inherits (read these first)

| Doc | What this panel reuses from it |
| --- | --- |
| `docs/game-progression.md` | the **era spine** (the tech tree of *more reality*), the **three axes** (Credits for what you ship, Lux for what you understand, codex for what you've seen), the **eureka discount** loop (§5.2), the **Lab Notebook codex with visible blanks** (§5.1). |
| `docs/game-rewards.md` | the **SHIP-IT** beat (§4), **failure-as-fun** (autopsy → Lux), the **daily seeded contract** + **ghost replays** (§7), retention framed as **genuine delight + mastery** (§8). |
| `docs/game-contracts-economy.md` | **standing vs batch** contracts, the **parametric contract** graded **at the pins** (topology-free), the **daily seeded contract**, the **anti-grind firewall** (Lux non-purchasable). |
| `docs/game-economy-progression-implementation.md` | the **contract loop** `generate(template, sessionSeed, difficulty)` with the `xmur3 → mulberry32` seed convention, **Credits / Lux / standing**, the **`cec.game.v1`** persistence (`GameState`), the fire-once **`RevealState`** drain. |
| `docs/ui/beginner-onboarding-all-ages.md` | the **teen/classroom persona** (§1), the **retention** section incl. the **no-dark-patterns charter** and the **relaunch nudge** (§6), **privacy-of-failure**. |
| `docs/grounded-directions-roadmap.md` | the **social / UGC thrust** (#9 hosted Exchange, #10 lineage-ranked discovery, #15 Chip Archaeology, #16 Duels/Co-Watch, #17 datasheet reputation), and **"the backend is the one dependency."** |

Existing **save/share machinery** this panel load-bears on (verified in-tree):
`BoardBlob { graph, userIcs?, userIcFamilies?, innerDies? }` + `saveBoard`/`loadBoard`
(`web/src/lib/storage.ts`); `userIcsForGraph` / `userIcFamiliesForGraph` collect
sealed defs; `restoreInnerDies` carries work-in-progress dies; the `cec.library.v1`
personal library with `LibraryEntry.source: 'sealed' | 'imported'` and
`importToLibrary(defs) → registerUserIcs` (`web/src/lib/userLibrary.ts`).

### 0.2 The relationship — this extends progression & rewards into three new rooms

```
   game-progression.md ──┐                            ┌── the MID-GAME (§1)
   game-rewards.md ──────┤   the contract loop +      │   the loop run LONG,
   game-contracts-       ├──►the deterministic graph ─┼── made into a felt CAMPAIGN
     economy.md          │   (already built / specced)│
   ...implementation.md ─┘                            ├── the CLASSROOM (§2)
                                                       │   a seed + a roster
                                                       │
                                                       └── SHARING / UGC (§3)
                                                           the graph IS the share
```

Three claims govern the whole panel:

1. **Sandbox-primary.** The bench is **always available**, always continuous. The
   campaign, the assignment, and the share are **offers with a board behind them** —
   never a walled mode, a level select, or an exam you can't leave. The only hard
   **progression** gate is the **Era-4 competency exam** (eureka can waive it); *offer
   availability* is **standing-gated** — a soft, rebuildable wall (`standing < 40` stops
   a customer offering; rebuild on easy batches), per the economy spec
   ([`game-economy-progression-implementation.md`] §3.3).
2. **Pull, not pick.** Depth is **surfaced as a consequence of play**, at the moment
   it's earned — a `RevealState` fire-once row, never a menu item the player must go
   hunt. Sharing appears at the seal/ship beat; classroom is a teacher's tool, not a
   player gate.
3. **No dark patterns.** Every reason to return is a **genuine standing thing-to-do**
   (a blank to fill, a thing to make, a guess to beat) — never a manufactured
   pressure (streak, timer, energy, FOMO, guilt, login-drip, pay-to-skip). Inherits the
   **no-dark-patterns charter** + the **one allowed pull** from
   `docs/ui/beginner-onboarding-all-ages.md` §6.4. See the charter, §4.2, proposed to be
   governed by the **30-day-gap test** — a **NEW gate this panel proposes** (not prior
   art), pending owner adoption (Q26).

---

# PART A — HOW TO BUILD IT

---

## 1. BUILD — the MID-GAME campaign & pacing (hour 2 → 10)

**The reframe.** The mid-game needs **no new state**. It is the existing contract
loop + the offer-queue difficulty band + the standing-contract drip + the eureka
discount + the codex — **run long**. The [contract loop], [offer queue], [standing
scheduler], [eureka/Lux discount], and [codex] already carry the whole hour-2→10
experience.

**The gap.** Those machines produce *contracts*; they do not, by themselves, produce a
**campaign** — a designed rhythm of beats a player can *feel*. A builder who ships
"the loop run long" ships **contract #14**, not **"I am running a company."** So the
mid-game adds three thin classes of web-side surface — **a named rhythm, a set of
emotional firsts, and two soft progress meters (portfolio + customer cast)** — every
one of them presentation + fire-once reveal state over the existing `GameState`. None
touches sim-core, the netlist, or `snapshot_hash` (§7).

### 1.1 The through-line, stated once (for the builder and the player)

> The campaign answers the journey **"I built a divider" → "I run a company shipping
> reliable products."**

It does this through a **repeating measure** (§1.2) played **in the key of each era**
(§1.3), punctuated by **second-wind firsts** (§1.4), made legible by a **soft progress
meter** (the standing portfolio, §1.6) and a **through-line cast** (recurring
customers, §1.5), with **chapter breaks** at era crossings (§1.7). That sentence is
also the player-facing orientation (§5.6) — the ease-in names the *arc*, not just the
next contract.

### 1.2 The repeating measure — the mid-game's 5-beat campaign unit

The mid-game's felt rhythm is **one measure, repeated per era band**. Name it
explicitly so a builder paces *the measure*, not *more contracts*. Each beat is
grounded in an existing mechanism — this is **legibility over machinery that exists**,
not new machinery.

| Beat | Name | What happens | Existing mechanism (the source) |
| --- | --- | --- | --- |
| 1 | **Debut** | A new template arrives as a **batch spike** — the lesson lands as a one-and-done job. | offer queue selects a template at the band's difficulty (`generate(...)`). |
| 2 | **Make it last** | The **standing** version of that template unlocks once the batch clears — robustness over a **ramping demand profile** = rent. *(game-progression §4.3: "batch debuts a concept; standing makes you engineer it to last" is the literal source of beats 1–2.)* | standing scheduler; `standing:unlocked` reveal. |
| 3 | **A new branch** | The next **offerable tree node** opens — surfaced spatially by the `era:<id>:reachable` shelf glow. | tech tree + `RevealState` edge-glow. |
| 4 | **A fresh phenomenon** | A new **codex page** becomes *causable on the bench* — the eureka half (curiosity is the fastest progression). | codex blanks + eureka discount (game-progression §5.1–5.2). |
| 5 | **A reputation milestone** | A **customer / portfolio tier ticks up** — the soft progress meter moves. | standing portfolio tier (§1.6); customer cast (§1.5). |

> [the measure] = `debut → make-it-last → new-branch → fresh-phenomenon →
> reputation-tier`. The **campaign is the measure played in the key of each era.**

**The measure must ESCALATE, not just repeat.** Each era band adds **one variation** so the
five beats don't read identically five times — the rhythm tightens as the company grows:

| Era band | The variation (what the measure gains) |
| --- | --- |
| **Era 4** | **recall / lapse pressure** arrives — beat 2's *make-it-last* now bites (hook **b**, §1.4b): a fragile design's standing drip can lapse under the ramping demand, a pressure earlier eras don't carry. |
| **mid-campaign** | a **"the OEM challenges your margin" reversal** — a recurring customer re-offers a *standing* version that demands tighter margin than your shipped batch part, turning *make-it-last* into *re-engineer it* (loss-free; §1.4b). |
| **Era 5** | the measure **inverts**: *debut → standing* becomes **author-your-own-template** — you seal an IC (hook **c**, §1.4c) and the *debut* beat is now **your** part entering the bin, not a customer's order. |

These are **presentation/sequencing variations on the existing beats** (reveal rows + offer
re-issue), not new machinery — the same golden-safe surfaces as §1.4 / §1.9.

### 1.3 The era arc as the campaign (the measure, per era band)

The pacing table below reads as **the measure, per era**. Wall-clock numbers are
**illustrative, not validated** — they need a balance pass + telemetry (§9). The
**"first you feel"** column is the load-bearing addition: it makes the table a
**campaign map**, not just an unlock schedule.

| Band (illustrative hours) | Era / what unlocks | Customer affinity (§1.5) | **First you FEEL (the second-wind hook, §1.4)** |
| --- | --- | --- | --- |
| **~0–1 (intro)** | Era 1 passives — divider, RC. *(the hour-1 spike; out of this panel's scope.)* | (no cast yet) | First **smoke / first Credit** — the intro spark (game-rewards). |
| **~2–3** | Era 2 — diode / rectifier work; first **standing** offer. | *the scrappy maker* | **First standing product-run** — "you now *manufacture* this." |
| **~3–5** | Era 3a/3b — transistor branch choice (BJT vs MOSFET path opens). | *the scrappy maker* + *the instrumentation house* warming up | **First branch-choice agency** — the tree forks and *you* pick. |
| **~5–7 (toward Era 4)** | Era 4 keystone — the **active tier** (regulators, op-amps); the **competency exam** appears (waivable by eureka). | *the power-supply OEM* arrives | **First portfolio that funds free play** / **first recall-and-re-engineer** (§1.4b). |
| **~7–10** | Era 5 — logic, sealed ICs, the IC-maker. | *the instrumentation house* (standing logic orders) | **First sealed IC** (authorship turn) / **first reputation tier**. |

**Era 4 is the centre of gravity** (the active tier is where "real electronics"
clicks). The crossing **into** Era 4 and **out the far side** each get a quiet
**chapter beat** (§1.7).

### 1.4 Second-wind hooks — the firsts beyond the intro spark

The intro's spike is **hour-1**. Hour 2→10 needs its **own emotional firsts** so each
stretch has a beat to reach for. Each is a **fire-once `RevealState` row** plus a
celebration register — **reuse the existing SHIP-IT cascade for the heavy ones, a
quieter register for the light ones, never a new modal**.

| # | Hook (reveal key) | Fires when | Register | Framing copy (Probe voice; owner-owned) |
| --- | --- | --- | --- | --- |
| a | **First standing product-run** (`standing:first-run`) | first standing acceptance — the drip starts | **SHIP-IT** (sparingly) | "This isn't one-and-done anymore — **you manufacture this now.**" |
| b | **First recall / lapse** (`standing:first-lapse`) | a standing contract's **ramping demand outgrows a fragile design** and the drip **lapses** | quiet, **not** a fail register | "**Demand outgrew your margin** — re-engineer it." (loss-free; the contract **re-offers**.) |
| c | **First sealed IC** (`ic:first-seal`) | first `userLibrary` seal | **SHIP-IT** | "You stopped **placing** parts and started **making** them." (the bridge to §3.) |
| d | **First reputation tier** (`portfolio:tier:<n>`) | the standing-portfolio meter crosses a named threshold (§1.6) | **SHIP-IT** at the threshold | "Your bench is a **workshop** now." |

**Hook (b) — the first lapse — is the single most important mid-game hook**, and the
**highest-risk**. It is what converts *"I built a divider"* into *"I run a company that
must build things to **last**."* It **must** be a **designed teaching beat, not a
punishment**:

- **Loss-free** — no Credits clawed back; the standing contract simply **re-offers** so
  you can re-engineer and re-commit.
- **Private** — per the privacy-of-failure axis (§2.4); never a public mark.
- **Framed as engineering, not defeat** — *"demand outgrew your margin"*, never *"you
  lost."*

This hook needs the **owner's explicit register sign-off** (§9) before it ships.

### 1.5 The customer cast — story without authored puzzles

The closest thing the **procedural** economy can honestly carry to a recurring
character is a **named, recurring customer themed to an era band**. The same customer
**returning with a harder / standing order** as you climb **is the felt narrative** of
*"I grew a client base."*

**This is not net-new state — it is the existing customer axis, named.** The economy
already models per-customer reputation as `standing: Record<CustomerId, number>`, already
carries `customer?: string` on the contract instance, and already gates offers/payout by
`standing[customer]` ([`game-economy-progression-implementation.md`] §3.3 / §4.1 schema).
So `customers.ts` is the **named/themed REGISTRY backing that existing `CustomerId` /
`standing[customer]` axis** — **not** a new optional tag bolted onto the offer. The cast's
era-band affinity **maps onto the existing per-customer standing**: *"the regulator OEM is
back with a standing order"* is **that axis surfaced**, not a second concept.

**Hard cap — to protect the determinism / sandbox-primary / anti-"one-true-answer"
brand:** a customer is **only** a `name` + an **era-band affinity** + a **visual tag**.
**NO scripted dialogue. NO branching narrative.** If a builder reaches for a dialogue
tree, this surface has failed. The cast is a **presentation tag** on the offer queue's
existing template selection — zero new economy.

| Customer (illustrative; owner-owned copy) | Era-band affinity | Domain / visual tag |
| --- | --- | --- |
| **the scrappy maker** | Era 2 | hobby diode / LED / rectifier work; warm, hand-soldered tag. |
| **the power-supply OEM** | Era 4 | regulators, op-amps, standing orders; clean industrial tag. |
| **the instrumentation house** | Era 5 | logic, sealed ICs, precision; cool lab-bench tag. |
| *(optional 4th–5th, owner call: a comms/RF house, an automotive shop)* | Era 4–5 | — |

> [data] `web/src/lib/customers.ts` — `~3–5` entries (`{ id, name, eraBand,
> visualTag }`) **keyed by the existing `CustomerId`** — the named/themed registry that
> backs the economy's `standing: Record<CustomerId, number>` axis, **not** a new tag. The
> contract instance **already** carries `customer?: string`
> ([`game-economy-progression-implementation.md`] §4.1 / §3.3); `customers.ts` only gives
> those ids a **name + era-band affinity + visual tag**. "The regulator OEM is back with a
> standing order" is the recurring character, told entirely by the **existing customer
> field + its standing** + the registry. **No currency, no scripted content, no new
> economy concept.**

### 1.6 The standing portfolio as the soft progress meter (the company's felt size)

The standing-portfolio **panel** is more than a dashboard — it is the mid-game's **soft
progress meter**, the scaled analog of the intro's **first-Credit** moment. The
**count + health + total drip** of committed standing contracts is the single number
that answers *"how big is my company."*

Define **~3–4 named portfolio tiers**, crossed by **breadth × health** (not raw
count), each a **fire-once celebration** (= hook **d** above). Names are quiet status,
**not** gamified rank-shouting (reputation ranks by reliability, never engagement):

| Tier (illustrative; owner-owned) | Crossed by (breadth × health) |
| --- | --- |
| **Bench** | 0–1 healthy standing products. |
| **Workshop** | a couple of healthy products holding their demand ramp. |
| **Shop** | several products, broad across era bands, mostly healthy. |
| **Firm** | a broad, healthy portfolio funding free play. |

> [meter] reads `GameState.standingRuns` (count, health, drip). [tier] is a **derived
> presentation threshold** — the only new persisted state is the **fired-reveal flag**
> per tier. Golden-safe; no new economy.

### 1.7 The era-crossing chapter beat (punctuation)

Band transitions get a **lighter register than SHIP-IT** — a quiet **"chapter" card**,
not a spike. A one-line **Act** marker that names what the next stretch is *about*,
fired once on **first reachability of the keystone** and once on **first node past
it**:

| Trigger (reuses `era:<id>:reachable`) | Reveal key | Card copy (illustrative) |
| --- | --- | --- |
| First reachability of the Era-4 keystone | `era:act:4` | "**Act II — the Active Tier.** Things start to amplify." |
| First node past the Era-4 keystone | `era:act:4-past` | "**The far side.** You're shipping active products now." |

Dismissible, **never modal**, **muted by `explainAsYouGo`**. This is the punctuation
that turns a flat band-table into a **felt arc with a middle and a far side.**

### 1.8 The daily seeded contract — the bridge that teaches the classroom muscle

The **daily seeded contract** (§3.6 / §6 detail) is one **rotating-offline-seeded**
problem the **whole world shares**, ghost-replay-driven, optional and **non-expiring**.
A solo player who has done a daily already understands *"everyone gets the same
problem; the physics judges fairly"* — which is **exactly the classroom contract**. The
daily is the **single-player on-ramp** to both the classroom (§2) and trustworthy
sharing (§3).

### 1.9 Wiring — all mid-game reveals into the existing fire-once drain

All new mid-game reveals are **rows in the existing `RevealState` table**, drained
**one per idle frame, never mid-drag, never stacked** (the §13-Q10 discipline):

```
standing:first-run   standing:first-lapse   ic:first-seal
portfolio:tier:<n>   era:act:<id>           era:act:<id>-past
```

> **Golden-safety line:** all are **web-side presentation flags in `cec.game.v1`**,
> guarded-degrade, never sim-core / netlist / `snapshot_hash`. **No new engine** —
> only new rows and their copy.

---

## 2. BUILD — the CLASSROOM / teacher mode (a seed + a roster, not a server)

**The reframe.** Classroom mode is **two existing web-side primitives pointed at a
teacher**, plus a roster:

1. The parametric contract generator `generate(templateId, sessionSeed, difficulty)`
   (the `xmur3 → mulberry32` PRNG). The **only new move** is choosing the
   `sessionSeed` **deliberately** instead of randomly. *A random seed = anti-copy solo
   play; a fixed **distributed** seed = the same problem for the whole class. Same
   machinery, opposite knob.*
2. The portable deterministic `BoardBlob` graph, which **re-solves byte-identically on
   any machine** — so a student's grade is **reproducible without trust**.

**Determinism replaces the entire backend an LMS would normally need:** no server runs
the sim, no anti-cheat watches for copying, no moderator verifies grades. **The physics
adjudicates.** A submission token is **self-verifying** because the teacher's own bench
can re-judge the shared graph and reproduce the grade — **a forged Gold is impossible
without a real Gold board.**

### 2.1 The three classroom primitives (all reuse the contract loop)

| Primitive | What it is | Reuses |
| --- | --- | --- |
| **Seeded class contract** | one deliberately-chosen `sessionSeed` → the **byte-identical** parametric contract (same θ / spec / par / hidden reference) for every student. | `generate(...)`; the offscreen scratch `Simulation` satisfiability check. |
| **Self-verifying submission** | on Ship, the student's board emits a token carrying its `GradeResult` + a `replayDigest` the teacher can **re-run**. | the `GradeResult` grader; the read-only snapshot sampler. |
| **Roster** | the teacher imports the pile of tokens → a sortable table → CSV. | pure `SubmissionToken[] → RosterRow[]`. |

### 2.2 The assignment artifact — a tiny **recipe**, not a circuit

> [module] `web/src/lib/classroom/assignment.ts` (host-testable; SPDX header).

```ts
interface Assignment {
  v: 1;
  templateId: string;
  sessionSeed: number;   // deliberately chosen → same problem for the class
  difficulty: number;    // a 3-notch teacher choice → an ERA-band offset/clamp, not a free global [0,1]
  mode: 'batch';         // a class period is a batch problem (standing = post-MVP)
  genVersion?: number;   // pins the generator so the seed reproduces forever (§9)
  title?: string;
  due?: string;          // PRESENTATION-ONLY — never a hard expiry / lockout
  rosterTag?: string;    // an OPAQUE class id, not a student profile
}
```

- **`encode` → a short `base64url` string** (paste into an LMS / chat / handout, or a
  QR). **`decode` → `generate(TEMPLATES[a.templateId], a.sessionSeed, a.difficulty)`**
  runs the satisfiability check **locally** on the existing offscreen scratch
  `Simulation`. **No server to generate, no account** — the assignment is
  self-contained data.
- **Fail closed on an unknown `templateId`** (a future-template assignment a stale
  client can't generate): a plain *"this assignment needs a newer version"* message,
  never a crash or a wrong contract.
- **`due` is presentation-only** — a late student gets the **identical fair problem**
  because the seed is reproducible forever (§9 — `genVersion` pinning).
- **The 3-notch `difficulty` maps to the era-appropriate `band`, not a free `[0,1]`.** The
  economy's `band` is *"global difficulty creep, clamped per era"*
  ([`game-economy-progression-implementation.md`] §2 state model / §4.2); the teacher's
  intro / standard / stretch picker is an **offset/clamp inside the template's per-era
  band**, so a teacher value can never fall outside the band the solo generator emits for
  that era. The picker is a notch on the existing band, **not** a global `[0,1]` the
  teacher sets free (Q12 / Q14).

### 2.3 The roster / dashboard — staged L0 → L1 → L2 (file-first)

Mirror the roadmap's **file-based-first** discipline. **Nothing in the MVP blocks on
infra.**

| Tier | What it is | Backend? |
| --- | --- | --- |
| **T1 (MVP)** | on Ship, the board emits a `SubmissionToken`; the student **pastes it back** (LMS / chat / paste box) **or** downloads a `.cecs` file to a dropbox; the teacher's **Roster tab imports the pile** → a sortable table → CSV. | **None.** |
| **T2 (post-MVP)** | the **same token POSTed** to a class **room code** for a live dashboard. | The **one explicit backend decision** (§6) — staged, never assumed. |

```ts
interface SubmissionToken {
  rosterTag: string;       // opaque class id
  studentLabel: string;    // cosmetic, self-declared
  assignmentHash: string;  // ties the token to the assignment
  grade: GradeResult;      // pass/fail + per-line margin + bonus tier + realism + parRatio
  replayDigest: string;    // a WEB-SIDE digest, NEVER snapshot_hash (§7)
}
```

> [modules] `classroom/submission.ts` (emit-on-ship token + `verify` re-judge) and
> `classroom/roster.ts` (pure `SubmissionToken[] → RosterRow[]` + CSV export).

**Self-verifying grades (determinism replaces anti-cheat).** The grade is **not a
number the student types** — it is a `GradeResult` over a `replayDigest` the teacher can
**re-run**: paste the student's shared board, the grader **reproduces the identical
grade** because the same graph re-solves identically. **A student cannot forge a Gold
without actually shipping a Gold-grade board.** Recommend **trust-the-token + on-demand
re-judge** as the audit path (auto-re-judge-all is slower; a perf call, §9).

### 2.4 Classroom-specific guardrails (built in, not bolted on)

| Axis | The guarantee |
| --- | --- |
| **No-account entry** | a student clicks an `?assign=<string>` link → the contract appears on a **fresh sandbox board**. No login, no install, no email, no student-identity store (`rosterTag` is **opaque**). On a Chromebook, the whole loop is **a link and a paste-back**. |
| **Sandbox-primary** | redeeming an assignment drops a contract onto the **same always-available continuous board**. The assigned student keeps the **full bin and the full sandbox** — fork, goof in the Test Bench (autopsy → Lux), chase codex pages. **An offer with a roster behind it, not a walled exam.** |
| **Topology-free grading** | the grader checks the spec **at the pins**, never the netlist topology — so **30 students all pass the same contract with 30 *different* circuits**. The seed makes the **problem** identical; the **solutions** stay plural. Predict-then-reveal Lux + par/elegance reward the student who **understood** it, so copying visible numbers doesn't beat understanding. |
| **Privacy of failure** | a non-shipping student reads a **private `—`** + a located hint — **never** a public wrong answer. The roster shows **"not-yet-shipped" as a *neutral* state**, never a red shaming mark to the room. *Guard this in the component, not just the doc.* |
| **Silent classroom** | no audio cue, no "X students are watching", no live presence. The roster updates from **pasted / imported tokens**, not a live socket — the room stays calm and private by default. |
| **Per-student anti-copy (optional)** | `sessionSeed = classSeed XOR studentId` gives each student a **different-but-comparable** problem. **Default = whole-class shared seed** (comparable + copy-visible); per-student is a **toggle** (§9). |

### 2.5 Module layout (classroom)

```
web/src/lib/classroom/
  assignment.ts        encode / decode / redeem (a recipe, not a circuit)
  submission.ts        emit-on-ship token + verify (local re-judge)
  roster.ts            SubmissionToken[] → RosterRow[] + CSV
  data/presets.ts      ~6 curated assignments + one-paragraph teacher notes
web/src/.../ClassroomPanel.svelte   Assign tab + Roster tab (teacher-facing)
```

> **Presets = the teacher's one-click path.** `classroom/data/presets.ts`: ~6 curated
> assignments (e.g. *"Voltage Divider — Intro"*), each with the **`sessionSeed` chosen
> FOR the teacher**, a **3-notch difficulty** (intro / standard / stretch) — *not* a raw
> `[0,1]` band — and a **one-paragraph teacher note** (what it teaches, what a good
> answer looks like, what the grades mean — Probe voice, adult register). **The teacher
> never grades physics; the fair judge does.**

---

## 3. BUILD — SHARING / UGC (the deterministic graph IS the share)

**The reframe.** Sharing is **not a feature to build — it is a property to expose.** A
circuit, a sealed IC, and a board **already** serialize to a portable, versioned,
self-contained **deterministic graph** (`BoardBlob` via `storage.ts`; the
`cec.library.v1` personal library whose `LibraryEntry` already carries a
`source:'sealed'|'imported'` field and an `importToLibrary()` entry point). Because the
determinism contract guarantees that graph **re-solves byte-identically on any
machine**, a shared artifact is **live, re-runnable, re-gradable, and tamper-evident
for free** — which collapses the three hardest problems of a sharing product
(**reproducibility, anti-cheat, moderation**) into **local re-computation**.

So sharing = **a transport + a wrapper + a UI over an artifact that already
round-trips.** The load-bearing remix culture is **reverse-engineering**: you arrive at
someone's circuit by **running it**, then fork it, open the sealed IC, read its
five-tier datasheet glyph, and **learn from the inside** — sharing feeds the **Lab Book
/ Teardown** loop (Chip Archaeology, roadmap #15), not a vanity feed.

### 3.1 What is already shareable (the foundation — verified in-tree)

| Already serializes | Carried by |
| --- | --- |
| the board's parts (the graph) | `BoardBlob.graph` |
| **sealed-IC defs** | `BoardBlob.userIcs?` (collected by `userIcsForGraph`) |
| sealed-IC **variant families** | `BoardBlob.userIcFamilies?` (`userIcFamiliesForGraph`) |
| **in-progress dies** (WIP) | `BoardBlob.innerDies?` (`restoreInnerDies`) |
| a sealed IC as a **placeable bin kind** | `cec.library.v1` + `importToLibrary` / `registerUserIcs` |

> The **optional-field discipline** (`userIcs?` / `userIcFamilies?` / `innerDies?` at
> `storage.ts`) means a **plain board's blob is byte-identical** with or without the
> wrapper — the back-compat / golden discipline (§7).

### 3.2 The transport — a versioned `ShareEnvelope`, not a new format

> [module] `web/src/lib/share/envelope.ts` (host-testable; SPDX header).

```ts
interface ShareEnvelope {
  v: 1;
  kind: 'board' | 'ic' | 'blueprint';
  title: string;
  author?: string;                 // cosmetic; identity is NEVER load-bearing
  lineage?: string[];              // parent envelope hashes — a verifiable DAG
  payload: BoardBlob | UserIc | BlueprintFragment;
  contract?: { templateId: string; sessionSeed: number; difficulty: number };
  replayDigest?: string;           // WEB-SIDE digest, never snapshot_hash (§7)
}
```

- **The `replayDigest` + `ShareEnvelope` SHOULD be the web-side surface of roadmap #1 —
  "The Replay/Netlist Codec"** (`.cecr` / `.cecn` versioned formats,
  [`grounded-directions-roadmap.md`] §1 #1). The digest spec is **OWNED there** and **shared
  by sharing + classroom roster + the daily leaderboard** — so the team builds **ONE codec,
  not two parallel digest formats**. This envelope is that codec's wrapper, not a rival.
- **Optional-field-only wrapper around the UNCHANGED graph** — a plain board's blob
  stays **byte-identical**.
- **`encode` → a `.cec` file OR a `base64url` link**; **`decode` → `loadBoard` /
  `importToLibrary`** with a **determinism re-verify**.
- **Import re-verify on decode:** re-solve the imported graph and confirm the embedded
  `replayDigest`. One honesty check proving the artifact **IS the graph it claims**, and
  it surfaces the **VERIFIED / OPTIMISTIC / FRAUDULENT** datasheet stamp (roadmap #17)
  when a self-declared spec rides along.
- **Sealed-IC share path = the existing library with an import button:** an `'ic'`
  envelope decodes straight into `importToLibrary(defs)` → registers a placeable kind in
  the bin. **The community library is literally the personal library + an import
  button.** The import path **must** reuse `userLibrary`'s reserved-tag + malformed-row
  guards and **bound die size** — never trust the envelope blindly (§9).
- **Large-artifact handoff:** small graphs inline in a link; **large / nested boards
  fall back to a `.cec` file** with a graceful *"too big for a link, here's a file"* —
  pin a **byte budget** so a link is never silently truncated (§9).

### 3.3 The community library (file-based MVP → hosted later)

| Tier | What it is | Backend? |
| --- | --- | --- |
| **L1 — personal + import** (~90% built) | the `cec.library.v1` personal library + the envelope + an **import UI** + a `?share=` URL param. | **None.** |
| **L2 — curated static bundles** | `.ts`-wraps-`.json` modules in `web/src/lib/circuits/` (the **existing saved-circuit pattern** = a cheap **pre-moderated starter shelf**). | **None.** |
| **L3 — hosted Exchange** (roadmap #9/#10/#17) | lineage-ranked discovery + a datasheet-reputation registry. | The **one explicit backend decision** (§6). |

> **Nothing in L1/L2 blocks on infra.** The file-first tiers **are** the MVP; the social
> loop is ready to ignite the moment infra is committed.

### 3.4 Blueprints (the reuse / UGC unit that doubles as a Credit sink)

A **blueprint** (`kind: 'blueprint'`) is a shareable **reuse unit**: store a
`GraphSnapshot` **fragment re-flattened by `buildNetlist` at stamp time** (so it
**inherits determinism** via the netlist.test.ts *"seal expands to the same netlist"*
guarantee) — **NOT** a frozen netlist. It **shares convenience / rebuild-time, never a
grade** (the spec still passes **at the pins**; par/elegance still judges the whole
BOM) — so it is **not a cheese vector**.

> **Gating:** the **blueprint determinism fold** is a change to the **determinism
> contract** and **must land before any stamp/share path ships** (§7, §9). It gates the
> blueprint phase, not the share/classroom MVP. Blueprints / royalties pay **Credits,
> never Lux** (the firewall holds).

### 3.5 Lineage & honesty as a game mechanic (no moderator needed)

- **Lineage** (`lineage?: string[]`) = parent envelope hashes — a **verifiable DAG**
  (fork-with-lineage, roadmap #10). **Reputation ranks by DEPENDENTS** (forks built on
  you — a verifiable edge in the expansion graph), **never by stars / followers.**
- **Honesty is computed by the sim** (the VERIFIED/OPTIMISTIC/FRAUDULENT stamp — a
  scarlet letter), **not policed by a report button** — so UGC needs **no moderation
  tax** in the file-first tiers.
- **Self-declared author handles are cosmetic.** Identity is **never load-bearing** for
  reputation; the **sim's verified stamp** is.
- **File-first scope:** show lineage as a **local credit chain only** (no dependents
  *ranking*) until the hosted registry (L3) exists — don't ship a **gameable
  half-reputation surface** (§9).

### 3.6 The daily seeded contract (the conceptual bridge into sharing)

The **daily seeded contract** is *a class-contract the whole world shares*: one rotating
**offline `sessionSeed`** (mulberry32, **never `SEED=1337`**), **ghost-replay-driven**, a
**cost / power / part-count / margin** leaderboard (never time-played), **replay-verified**,
**optional + non-expiring** (any past day's seed re-generates forever). It teaches the
exact muscle — *everyone gets the same problem; the physics judges fairly* — that makes a
**shared solution trustworthy without a server**, and that a **teacher** later assigns by
hand (§2). It is the **single-player on-ramp** to both classroom and sharing.

---

# PART B — PLAYER-FACING / EASING EVERYONE IN

---

## 4. RETENTION + the NO-DARK-PATTERNS charter

### 4.1 The day-2 loop — return reasons ranked by honesty

Every reason to return is a **genuine standing thing-to-do**, read from
**already-persisted state** (no timestamp gates, no new key). **Ranked by honesty:**

| Rank | Return reason | Why it's honest | Reads |
| --- | --- | --- | --- |
| **1 (primary)** | **The codex's visible blanks** — *a blank to fill.* | **zero contracts, zero economy, loss-free, never decays** — chaseable forever. | `cec.game.v1` codex (game-progression §5.1). |
| 2 | **Your board waits** — *a thing to make.* | restore-not-recap; the bench is simply there as you left it. | `cec.board.v1` (`loadBoard`). |
| 3 | **The eureka discount** — a node is **pre-paid** by yesterday's curiosity. | a **silent return-reward** (§4.3) — never a countdown. | `GameState` eureka state. |
| 4 | **The greyed shelf glow** — *one buy away.* | the **second progress bar** (§4.4); static, never-decaying. | `era:<id>:reachable` reveal. |
| 5 | **The optional daily** — a **guess to beat.** | **non-expiring**; any past seed re-generates forever. | the daily generator (§1.8 / §3.6). |

**Two always-true progress bars** orient a returning player **in seconds**, with **no
recap wall**:

- **Bar 1 — the codex ("N of M found")** = *understanding.* Empty slots are the
  standing goal. The blank's tooltip names the **phenomenon *category*** (e.g. *"a
  reverse-biased junction"*) — a genuine "go cause this" lead, **never the measured
  value** (which would spoil the eureka).
- **Bar 2 — the greyed-shelf glow ("one buy away")** = *capability.* The
  `era:<id>:reachable` edge-glow on the bin shelves. **No timer, no countdown.**

### 4.2 The NO-DARK-PATTERNS charter (this panel's surfaces)

> **The charter test for every surface — the 30-day-gap test:** *does it still make
> sense, **unchanged**, for a player returning after **30 days**?* If a surface
> **punishes the gap**, it is a dark pattern and is **cut.** This panel proposes it as a
> **normative review gate** every future retention surface must pass before shipping —
> **a NEW gate this panel proposes**, pending owner adoption (Q26), **not** inherited from
> `beginner-onboarding-all-ages.md` (which carries the no-dark-patterns charter §6.4 + the
> *one allowed pull*, but **not** this test).

| Banned (a dark pattern) | What we do instead |
| --- | --- |
| **Streaks / daily-login bribes** | the daily is **optional + non-expiring**; **any past seed re-generates**; **no streak counter anywhere**. |
| **Timers / energy / FOMO countdowns** | the eureka discount **never expires**; `due` is **presentation-only**. |
| **Guilt framing** ("you haven't played in 3 days") | the **one allowed pull** (§5.4) celebrates **progress** ("you've found N of M"), never scolds the gap. |
| **Pay-to-skip-understanding** | **Lux is non-purchasable** (the anti-grind firewall); no currency buys comprehension. |
| **Public wrong-answer shaming** | **privacy-of-failure** (§2.4): a wrong answer is **private**; the room never sees it; the roster shows not-yet-shipped as **neutral**. |
| **Caregiver-guilt notifications** ("your child hasn't played") | **charter-banned now**, before any notification infra exists; the kid's return is the **codex-as-sticker-book** + redo-the-smoke, surfaced **to the child**. |
| **Launch "share!" nags** | sharing is offered **only at the seal / Gold-ship beat** (§5.5); **pull, not pick**. |
| **Engagement-ranked reputation** | reputation ranks by **reliability / dependents**, never by post frequency, stars, or followers. |

### 4.3 The eureka discount as a **silent** return-reward

A loud discount is **FOMO in disguise.** Render the discount **on the node itself** (a
struck-through old price → new price), **discovered on look** — never pushed by a
relaunch line, never a "your discount is waiting / expiring" toast. **It never decays.**
Wire it as a **derived display off `GameState` eureka state**, not an event toast.

### 4.4 The greyed shelves as the second progress bar

The codex is the **first** progress bar (understanding); the **era-arc shelf-glow** is
the **second** (capability). Both are **static, always-true, never-decaying** surfaces a
returning player re-orients off in seconds. Reuse the existing `era:<id>:reachable`
`RevealState` edge-glow on the bin shelves — **no timer, no countdown** ever rendered.

---

## 5. PLAYER-FACING — easing players AND teachers in

### 5.1 Day-2 re-orientation for the solo player (restore, not recap)

On launch, **`loadBoard` (`cec.board.v1`) + `cec.game.v1` + `cec.library.v1`**
rehydrate the **board / bin / notebook / active contract / codex** — **the bench is
simply there as left.** **No "welcome back" modal.** The two progress bars (§4.1)
orient spatially in seconds. Three **honest return reasons** (already strong; preserved):

1. **Your board waits** (loss-free local persistence).
2. **Curiosity pre-paid your next step** (the silent eureka discount).
3. **There's a new problem if you want one** (the optional daily / next offer).

### 5.2 The "where was I" **resume line** (restore-of-the-STORY, not just the board)

Beyond restoring the board, **restore the campaign *thread*** in one line. The
standing-portfolio meter + era-arc glow already orient **spatially**; add **one Probe
line** that names the **narrative thread** — the customer, the ramping standing order,
the next reachable branch:

> *"You manufacture 2 products; the **regulator OEM's** order is ramping — your divider
> may need more margin."*

This is **restore-of-the-story, not just restore-of-the-board.** A returning player
**re-finds the campaign thread in one line**, loss-free and dismissible. (Owner confirm
whether the resume line names the customer/story thread or stays purely spatial — §9.)

### 5.3 "What's reachable next" — both **what to buy** and **what to play toward**

- **What to buy:** the **era-arc map glow** (`era:<id>:reachable`) shows the spatial
  *"one buy away."*
- **What to play toward:** on the reachable node, show the **eureka condition** as a
  gentle **quest-strip hint** — *"try this on the bench to discount it"* (the Civ-VI
  eureka loop from game-progression §5.2 **made visible**). This surfaces the
  **curiosity-is-fastest-progression** brand **at the re-orientation moment.** (Verbosity
  is an owner/voice call — §9.)

### 5.4 The **one allowed pull** — the codex-keyed relaunch nudge

Exactly **one** low-pressure Probe line, on relaunch only:

> *"You've found **N of M**. I spotted **2 nearby** to try."*

Sourced from **codex adjacency** to the last-touched rung. **Dismissible, never modal,
never repeated in-session, suppressed when `explainAsYouGo` is muted**, **never
guilt-framed** (celebrates progress, never scolds the gap). Fires through the
**one-reveal-per-idle-frame** drain; **never mid-drag, never stacked.** This is the
**single highest dark-pattern-risk surface** — lock its copy register to
**progress-celebration** (§9).

### 5.5 Surfacing sharing — **pull, not pick**

Sharing appears **only at moments of authorship and pride** — **never a launch nag.**
Three fire-once `RevealState` triggers:

| Trigger | Reveal key | The beat |
| --- | --- | --- |
| the player **seals an IC** | `share:offered` | the seal screen's natural next beat: *"add to your library — or **share** it?"* — **coincides with the FIRST-SEALED-IC hook** (§1.4c), the natural first share point. |
| the player **ships a Gold-grade board** | `share:offered` | a Gold SHIP-IT can end with a quiet *"share this solution?"* |
| a second build of a sub-circuit | `blueprint:offered` | *"save this as a blueprint?"* |

**Import is discovery, not obligation.** A `?share=` link/file opens directly onto a
**runnable** board (the determinism dividend) — the recipient **plays / scrubs / probes
it first**, then is offered *"fork it / add the IC to your bin."* **You arrive at
someone's circuit by running it, and you keep only what you USE.** Remix ties straight
to **reverse-engineer + the Lab Book**: opening a shared sealed IC renders its
**five-tier IC glyph** (`docs/ui/ic-glyph-spec.md`) — **the self-rendering datasheet** —
so you learn the chip from the inside (a teardown target, not a screenshot).

### 5.6 The through-line, stated once for the player

State the arc to the player **once** (not just to the builder): the campaign is
*"I built a divider" → "I run a company shipping reliable products,"* told by the
**repeating measure** (debut → make-it-last → new branch → fresh phenomenon →
reputation tier). The **standing-portfolio meter** and the **customer cast** are the
**player-facing surfaces that make the through-line felt** — name it in the ease-in so
a player orients to the **arc**, not just the next contract.

### 5.7 Onboarding a TEACHER (the new persona this panel must serve)

The teacher is a **distinct persona** — not the player, often non-technical,
time-pressured, on a school network. **One-click-out, one-paste-back-in** is the whole
loop:

| Step | What the teacher does | Why it's frictionless |
| --- | --- | --- |
| 1 | Pick **"Voltage Divider — Intro"** from presets. | the **seed is chosen for them**; difficulty is a **3-notch** picker (intro / standard / stretch), **not** a `[0,1]` slider. |
| 2 | **Copy the link / QR** in one click; distribute it. | no account, no install to generate. |
| 3 | Students **click → the contract appears** on a fresh sandbox board. | no login, no install (PWA/offline); a Chromebook needs only a link. |
| 4 | Students **paste a token back** (or drop a `.cecs` in an LMS dropbox). | both transports supported (paste for chat/LMS-text, file for dropbox). |
| 5 | Teacher **imports the pile** → sortable roster → **CSV** to the gradebook. | **the teacher never grades electronics** — the deterministic fair judge does; the preset's **teacher note** explains what the grades mean. |

**Privacy-of-failure for the teacher** (§2.4): the roster never shames a student to the
room; per-student detail is **teacher-private**. **Silent classroom** by default
(§2.4). **A late student gets the identical fair seeded problem** — `due` never locks
anyone out. **Day-2 for the student** mirrors the solo charter: their board + bin +
notebook + active assigned contract simply **wait** (loss-free local persistence) — no
streak, no "you'll lose progress", no daily-login bribe.

---

## 6. Reuse vs new surface (what needs a backend vs pure-client)

### 6.1 The single dependency line

> **The backend is the *one* dependency.** Stage **everything** file/link/offline so
> **nothing in the MVP blocks on infra**; the hosted layer (T2 roster, L3 Exchange,
> #17 reputation) is **one explicit, owner-owned scope call** (§9). If the team assumes
> the live roster is the MVP — **it is not.**

### 6.2 Reuse — what carries the load

| Reuse | Role |
| --- | --- |
| the **contract loop** (`generate(template, sessionSeed, difficulty)`, `xmur3 → mulberry32`) | the mid-game **is** this run long; classroom **is** this with a deliberate seed. **Documented-only today** — a hard prerequisite (§6.4). |
| the **offscreen scratch `Simulation`** satisfiability check | local validation at redeem time — no server. |
| the **`GradeResult` grader** + the read-only snapshot sampler (node V + branch I + failedMask) | roster columns **are** `GradeResult`; the optional re-judge runs the **same** grader. |
| `BoardBlob` + `saveBoard`/`loadBoard` back-compat | a board already serializes parts, sealed defs, families, WIP dies. |
| `cec.library.v1` + `importToLibrary`/`inLibrary`/`registerUserIcs` | the community library **is** the personal library + an import button (~90% built). |
| the `circuits/` `.ts`-wraps-`.json` pattern | the file-based **L2 curated-bundle** precedent (zero backend). |
| the fire-once **`RevealState`** drain | every new mid-game/sharing/classroom reveal is a **row**, not a new engine. |
| the **SHIP-IT** cascade | the celebration register for the heavy firsts (§1.4). |
| `GameState.standingRuns` | the data behind the standing-portfolio soft meter (§1.6). |
| the **daily seeded contract + ghost replay** (game-rewards §7) | the shared-seed muscle; add only the **"any past seed re-generatable"** non-expiry guarantee. |

### 6.3 New — the smallest honest surface (all web-side)

| New | What it is |
| --- | --- |
| `share/envelope.ts` | versioned wrapper + encode/decode + import re-verify. |
| `classroom/assignment.ts` · `submission.ts` · `roster.ts` · `data/presets.ts` | recipe + token + aggregate + ~6 curated assignments. |
| `ClassroomPanel.svelte` + the `?assign=` redeem box | teacher Assign/Roster tabs; student redeem. |
| `customers.ts` (~3–5 entries), keyed by the **existing `CustomerId`** | the named/themed **registry backing the economy's existing `standing[customer]` axis** (the contract already carries `customer?`; [`game-economy-progression-implementation.md`] §3.3) — name + era-band affinity + visual tag, **not** a new offer field (§1.5). |
| portfolio-tier thresholds + their copy; second-wind-hook reveal rows + copy; era-crossing **Act** cards | §1.4 / §1.6 / §1.7 — reveal rows + copy only. |
| the day-2 **resume line** + the eureka **quest-strip** hint on reachable nodes | §5.2 / §5.3 — read-only presentation. |

**New persisted state is minimal** and all sibling-keyed in `cec.*`, **guarded-degrade**
(corrupt/stale → fresh, never throws): **fired-reveal flags** (the new firsts/tiers) and
the **classroom/share envelopes & tokens** — all independent of the board/settings/economy/
library keys. (The customer cast adds **no** new offer field — it reuses the economy's
existing `customer?` / `standing[customer]`; §1.5.) **No new currency, no sim-core touch.**

### 6.4 The prerequisite gate (the one feasibility gap)

> **M1/M2 are BLOCKED on the contract loop existing in `web/src/lib`.** `generate(...)`,
> the satisfiability check, the `GradeResult` grader, `GameState`, and `RevealState` are
> **documented-only today** (they live in `game-economy-progression-implementation.md`,
> **not yet in code**). Classroom and sharing **cannot ship** until that greenfield core
> lands. **Promote this from a footnote to a named blocking dependency** in the phase
> table (§8).

---

## 7. Determinism & golden-safety

> **GOLDEN-SAFE BY CONSTRUCTION.** Every byte of the mid-game, classroom, and sharing
> surfaces is **web-side game-state + presentation**. **None touches `crates/sim-core`,
> `sim-protocol` logic, `buildNetlist` emission, the netlist, or `snapshot_hash`.**
> `cargo test -p sim-core` (including `run_is_reproducible`) and the **FNV-1a golden**
> are **out of scope to change** — there is **no Rust change** in this panel.

| Concern | Why it's safe |
| --- | --- |
| **The class / daily / share seed** | a web-side `mulberry32(xmur3(...))` seed — **explicitly never the sim's fixed `SEED=1337`** and **never anything feeding `snapshot_hash`**. |
| **The satisfiability check** | runs on a **separate offscreen scratch `Simulation`** whose **throwaway hash is never compared to the golden**. |
| **Grading & the roster re-judge** | a **read-only sampler** over the **already-batched, UNHASHED once-per-frame snapshot** (node V + branch I + failedMask via `electricalMap`) — never `snapshot_hash`. The **coarse JS↔wasm boundary holds** (one batched read per frame; golden rule #2). |
| **A shared circuit / IC / board** | **IS** the existing deterministic graph — it **re-solves byte-identically on any machine** *because of* the determinism contract. That property is what makes a share **reproducible AND tamper-evident**, and why file-first sharing needs **no moderation/anti-cheat backend** (**determinism replaces trust**). |
| **The `ShareEnvelope`** | adds **only optional wrapper fields** around an **unchanged `BoardBlob`** — a plain board's inner blob is **byte-identical** (the `userIcs?`/`innerDies?` optional-field discipline). *Assert this with a round-trip vitest: the inner blob is **byte-stable**, not just structurally equal — mirroring `netlist.test.ts`.* |
| **The sealed-IC seal guarantee** | *"the seal expands to the same netlist as the inline circuit"* (`netlist.test.ts`) is **inherited by every shared sealed chip** — trustworthy without moderation. |
| **No new sim element** | the seeded / judged part maps to an existing element via the **`PULSE → ELEM_ACSOURCE` / `SHUNT → ELEM_RESISTOR`** param-on-existing-element trick — in fact the customer cast and classroom touch **no sim element at all**. |
| **New persistence** | sibling-keyed plain TS data with the `loadSettings` **guarded-degrade** discipline (corrupt/stale → fresh, never throws), independent of board/settings/economy/library keys. **No new currency** (Lux/Credits/standing and the firewall are untouched). |
| **The first-lapse hook** | **loss-free and recoverable** (the standing contract re-offers) — it adds **no dark pattern**. |

**The one item that genuinely changes the determinism contract** is the **blueprint
fold** (§3.4): store a `GraphSnapshot` fragment **re-flattened by `buildNetlist` at
stamp time**, **inheriting** determinism rather than freezing a netlist. It **gates the
blueprint phase (M3), not the MVP**, and requires **determinism-owner sign-off** before
the stamp/share path ships.

**The load-bearing-but-unspecified primitive — `replayDigest` cross-machine
stability.** A tamper-evident share **and** a self-verifying submission token **both**
rest on a digest being **bit-identical on the recipient's machine**. If it hashes raw
f64 snapshot bytes at an **unpinned** tick, two honest importers could disagree and the
VERIFIED stamp becomes noise. It needs **one owned spec** (canonical serialization +
fixed warmup tick-count + which fields + float-canonicalization across toolchains),
**shared by sharing + roster + the daily leaderboard**, folded into the determinism
contract **before M1 ships** (§9). **This is the web-side surface of roadmap #1 — "The
Replay/Netlist Codec"** (`.cecr` / `.cecn`, [`grounded-directions-roadmap.md`] §1 #1): the
digest spec is OWNED there, so all three consumers share **ONE codec, not two**. **SPDX
header on every new `.ts` / `.svelte`.**

> **`sim-protocol` caveat — keep the safety claim precise.** Today this panel is **literally
> zero `sim-protocol`**: the digest is a **web-side** computation over the unhashed snapshot.
> **IF** the digest is later folded into the Codec (roadmap #1), which carries the `.cecr` /
> `.cecn` **wire types in `sim-protocol`**, that move **remains golden-safe** — `sim-protocol`
> holds **no solve logic** (it is wire types only) and the codec format is **not in
> `snapshot_hash`** — but it is then **no longer literally "zero `sim-protocol`."** The
> golden-safety claim survives; the "touches nothing in `sim-protocol`" phrasing does not, so
> state it as **golden-safe**, not as untouched-`sim-protocol`, once the fold lands.

---

## 8. Phased build path

| Phase | Deliverable | Backend? | Gated on |
| --- | --- | --- | --- |
| **M0 — Legibility** | the campaign rhythm made felt: the **standing-portfolio panel** (soft meter + tiers), the **era-arc map glow**, the **customer cast** tag (the existing standing axis, §1.5), the **second-wind-hook** reveals, the **era-crossing Act cards**, the **daily seeded contract** (**local / unverified** only in M0 — same-seed-for-all + a local best; its **replay-verified leaderboard waits on the digest spec, M1**), the day-2 **resume line** + eureka **quest-strip**. | None | the contract loop (§6.4). **M0 is digest-free** by keeping the daily's verified leaderboard out (it lands with the digest in M1). |
| **M1 — Share** | `ShareEnvelope` + `.cec`/`?share=` + import re-verify + the sealed-IC import button; the **`replayDigest` spec** must land first. | None | the contract loop; the digest spec. |
| **M2 — Classroom** | `assignment` + `submission` + `roster` + `presets` + `ClassroomPanel` + the `?assign=` redeem box (T1 file/link roster). | None | the contract loop + grader; M1's digest spec. |
| **M3 — Bundles & blueprints** | L2 curated `circuits/` bundles; the **blueprint** stamp/share path. | None | the **blueprint determinism fold** + determinism-owner sign-off. |
| **M4 — The one backend decision** | L3 hosted Exchange (#9), lineage-ranked discovery (#10), datasheet-reputation registry (#17), T2 hosted roster, Duels/Co-Watch (#16). | **Yes — the single explicit, owner-owned scope call.** | infra commitment. |

> **PREREQUISITE (hard blocker):** **M0–M2 cannot start until the contract loop**
> (`generate` + satisfiability + `GradeResult` grader + `GameState` + `RevealState`)
> **exists in `web/src/lib`** — it is **documented-only today** (§6.4).

---

## 9. Open questions / owner hand-offs

**Mid-game / campaign**

1. **Customer cast** — size (3 vs 5), named-vs-fully-procedural, visual treatment, and
   the **hard line that they carry NO scripted dialogue.** *Recommend ~3–5 named,
   era-band-themed, procedural, dialogue-free.* **Owner call.**
2. **First-recall/lapse register** — is the standing-demand-outgrows-fragile-design beat
   a **celebrated teaching moment** or too punishing for the charter? **The single most
   important — and riskiest — mid-game hook. Owner sign-off on framing required.**
3. **Standing-portfolio tier thresholds + names** (Bench→Workshop→Shop→Firm or
   otherwise) and how **breadth × health** maps to a tier — a pacing/balance call paired
   with the time-to-milestone yardstick.
4. **Era-crossing chapter beat register** — how loud is an "Act" card vs SHIP-IT?
   **Owner / telemetry call.**
5. **Eureka quest-strip verbosity** on reachable nodes — how much to surface "play toward
   this to discount it" without clutter. Pairs with §5.3.
6. **Day-2 resume line** — does it **name the customer/story thread** (recommended:
   restore-of-the-story) or stay **purely spatial** (era glow + portfolio meter)? **Owner
   confirm — it is this panel's core player-facing proposal.**
7. **Pacing-table wall-clock numbers are illustrative, not validated** — the
   "first-you-feel" column does **not** validate timing; time-to-milestone still needs a
   **balance pass + telemetry.** Don't let the richer table imply a validated schedule.
8. **Scope of this doc** — keep the four campaign under-specs (rhythm / firsts / cast /
   meter) in §1, or strip back to "loop run long + legibility panels"? **This panel
   recommends keeping them** — without them, hour 2→10 ships as **"more contracts," not a
   campaign.**

**Classroom**

9. **Per-student vs whole-class seed default** — recommend **whole-class shared**
   (comparable, copy-visible) with a `classSeed XOR studentId` toggle. **Owner confirm.**
10. **Submission transport at MVP** — paste-back token vs `.cecs` file vs **both**
    (recommended). Confirm the token carries a re-judgeable `replayDigest` so **no trust
    is needed.**
11. **Roster re-judge default** — auto-re-judge-all (slower, max-trust) vs **trust + on-
    demand audit re-judge** (recommended). **Owner + perf call.**
12. **Difficulty exposure** — a **3-notch picker** (recommended) vs the raw `[0,1]` band
    (which stays the solo adaptive mechanism). The 3 notches map to an **offset/clamp inside
    the template's per-era `band`** (per [`game-economy-progression-implementation.md`] §4.2),
    **never** a free global `[0,1]` — so a teacher value can't fall outside the per-era band
    the solo loop emits. **Owner confirm the band-offset semantics.**
13. **Forward-compat redeem** — confirm an unknown-`templateId` assignment **fails
    closed** with a "needs a newer version" message, never a crash / wrong contract.
14. **Generator version-pinning** — how is "a class seed reproduces the identical
    problem **forever**" guaranteed across deploys? Pin a `genVersion` in the
    `Assignment`, or freeze `generate()` per `templateId`? Confirm too that the teacher
    `difficulty` notch resolves to the **era band offset/clamp** (Q12) so a pinned seed +
    notch reproduce inside the same per-era band on every deploy. **Owner +
    determinism-owner.**
15. **Roster hosting tier for MVP** — confirm **T1 file/link** is the shipped MVP and
    **T2 hosted is the single backend decision**, not assumed by M2.
16. **Standing in the classroom** — is there ever a **standing class assignment**? Defer
    to post-MVP with the standing scheduler. **Owner call.**

**Sharing / UGC**

17. **`replayDigest` canonical spec** (which bytes, which warmup tick-count, float
    canonicalization across toolchains) — **determinism-owner-owned**, shared by sharing
    + roster + the daily leaderboard as **ONE spec**; **fold into the determinism
    contract before M1.** **This spec SHOULD live in roadmap #1 — "The Replay/Netlist
    Codec"** (`.cecr` / `.cecn`, [`grounded-directions-roadmap.md`] §1 #1): the
    `replayDigest` + `ShareEnvelope` are the **web-side surface of that codec**, so the
    team builds **ONE codec**, not a sharing digest and a separate roster digest. **Owner +
    determinism-owner — confirm the digest is owned in #1.**
18. **`ShareEnvelope` flatten-on-publish policy** — flatten sealed-IC defs **inline**
    (self-contained, larger; recommended, matches `userIcsForGraph`) or **reference**
    them (smaller, fragile)? **Owner confirm.**
19. **Link-vs-file size threshold** + the `.cec` handoff UX for large/nested boards — pin
    a **byte budget** and the graceful fallback.
20. **Import validation reuse** — the import path **must** run `userLibrary`'s
    reserved-tag + malformed-row guards and **bound die size** on the incoming `UserIc`.
    *Recommend yes — never trust the envelope blindly.* **Owner confirm.**
21. **File-first lineage UI scope** — show lineage as a **local credit chain only** (no
    dependents ranking) until L3, to avoid a **gameable half-reputation surface.** **Owner
    confirm.**
22. **Blueprint determinism fold sign-off** — determinism-owner confirms the
    `buildNetlist`-re-flattened `GraphSnapshot`-fragment approach lands in the
    determinism contract **before M3's stamp/share path.**

**Retention / charter**

23. **Relaunch nudge MVP scope** — single line vs adjacency-ranked top-2; confirm
    once-per-session, dismissible, suppressed-when-muted, **never a streak.** **Owner +
    telemetry.**
24. **Eureka-discount surfacing register** — struck-price-on-node only, or also a single
    neutral codex write-up line? *Recommend node-only + optional one-line write-up, never
    a toast.* **Owner confirm.**
25. **Daily seed non-expiry** — confirm the generator exposes **any past day's seed on
    demand** (no "today-only" lock) and the leaderboard is purely
    **cost/power/part-count/margin** (never time-played). **Owner confirm — charter +
    golden-safety.**
26. **The 30-day-gap test** — add it as a **normative charter gate** for every future
    retention surface? **Recommend yes. Owner confirm.**
27. **Codex blank tooltip copy** — **category-named** ("a reverse-biased junction";
    recommended, a genuine "go cause this" lead) vs fully blank. **Owner / voice call.**
28. **Caregiver-return register for kids** — confirm **child-facing-only** (sticker-book
    blanks + redo-the-smoke), with an explicit **charter ban on caregiver-facing
    obligation notifications.** **Owner call.**

**The one backend decision (spans all three)**

29. Confirm **L1/L2 + T1 ship fully file/link/offline**, and **L3 hosted Exchange +
    datasheet-reputation registry + T2 hosted roster** is a **separate, owned scope
    call** — **nothing in the MVP path assumes it.**

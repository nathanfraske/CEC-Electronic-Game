<!-- SPDX-License-Identifier: Apache-2.0 -->

# Lux & the Lab Book — the understanding faucet and the challenge codex

> **Read first:** the *spine* of this design is
> [`docs/game-economy-progression-implementation.md`](./game-economy-progression-implementation.md)
> (§3.2 Lux = fixed one-time event awards keyed by id, never spent down, that **license** tree
> tiers; §5 the Lab Notebook; the tree DAG whose `canUnlock` reads Lux). The *design intent* sits
> in [`docs/game-progression.md`](./game-progression.md) (§5 the tinkerer economy, §5.1 the Lab
> Notebook codex, §5.2 eureka discounts, §5.4 predict-then-reveal, §5.6 reverse-engineering, §5.7
> Lux-for-understanding) and [`docs/game-rewards.md`](./game-rewards.md) (Lux/juice, failure-as-fun,
> codex seeds). This file does **not** re-derive those; it deepens **the Lux faucet** and **the Lab
> Book as a challenge system**, and answers one owner question end to end.

---

## 0. Thesis — and the owner's question, answered

The owner asked:

> *"How do you earn Lux? Do you complete Lab Book challenges that can be used to unlock a new part?"*

**Yes — and the "unlock a part" half is true *indirectly, by design*.** A Lab Book challenge never
hands you a part. It pays a fixed, one-time **Lux** bounty when the sim *detects* you did the thing.
Lux is the single **gate currency** that **licenses a tech-tree tier**; licensing a tier un-greys a
part shelf in the bin. So the chain is:

```
complete a Lab Book challenge  ->  earn Lux (one-time, keyed by id)
   ->  Lux licenses a tech-tree tier (unlockNode debits Lux + Credits)
   ->  the tier's unlocksTags un-grey a part shelf  ->  the new part is armable
```

The indirection is **load-bearing**, not bureaucracy:

- **Lux stays fungible** — *any* faucet (a prediction, a phenomenon, an autopsy, a challenge) funds
  *any* tier. The player routes their own understanding into whichever depth they want next.
- **The firewall stays intact** — there is no per-challenge part handout to grind-farm. You cannot
  repeat one task for parts; each understanding-event pays **once**.
- **Pull-not-pick survives** — the player chooses *which* tier to spend on; the bin shows the whole
  greyed map and what each tier costs.

The two currencies split the game cleanly, and that split **is** the anti-grind firewall:

> **Credits buy BREADTH** (a bigger sandbox, more parts on the shelf you can afford).
> **Lux buys DEPTH** (the gate to the next era of physics).
> **Lux comes only from understanding** — never bought, never converted from Credits, never minted
> by raw playtime or repetition.

This doc **reuses** the already-built first-encounter machinery: `web/src/lib/concepts.ts` ships
`CONCEPTS` (`source` / `ground` / `loop` / `reading`, L21) + `CONCEPT_ORDER` (L45), fired by
`offerConcept`/`pumpConcepts` in `App.svelte`, deduped by `seenConcepts`. **That is the seed of the
Lab Book.** The Lab Book generalizes the fire-once `ConceptCard` into a **codex** (a page per
detected phenomenon) and a **challenge deck** (offered tasks), both riding the same pull-not-pick
drain. The [fundamentals doc](./game-progression.md) migrates the 4 cards into 7
`FUNDAMENTALS_IDS`; this design re-keys onto that, it does not fork a parallel set.

---

## 1. The Lux FAUCET catalog

Lux is minted **only** through `applyEarn({ kind: 'lux', id, amount })`. Every award is a **fixed
integer**, keyed by a **stable id**, and **deduped** against the flat `claimedLux: string[]` ledger
— *if the id is already claimed, the award is `0`*. There is no formula, no scaling with playtime,
no Credits input. Eight faucet rows across six families:

### 1.1 The faucet table

| # | Family | Event id (namespace) | Lux | The understanding it certifies |
|---|--------|----------------------|-----|--------------------------------|
| 1 | **Predict-then-reveal** | `predict:<id>` | **+2** | You guessed a node **V** / a period / a current *before* Run, and it landed inside the green tolerance band. **The correct guess *is* the understanding.** |
| 2 | **First-encounter phenomenon** | `phenomenon:<id>` | **+1** | The first time *you cause* a detectable phenomenon (rectification, oscillation, latch, resonance, brownout…). Detected on honest replay; cannot be faked or repeated. |
| 3 | **First-encounter concept** (the `concepts.ts` cards) | `concept:<id>` | **+1** | The first time the board demonstrates a fundamental true (voltage / ground / a complete loop / a reading — migrating to the 7 `FUNDAMENTALS_IDS`). One event = card **+** codex page **+** Lux. |
| 4 | **Eureka** *(not a wallet credit)* | *(folds into a `TechNode` discount)* | **—** | Demonstrating the *next* tier's physics **cheapens that tier** — lowers its `luxPrice` or waives its exam. It **discounts the gate; it never mints Lux.** (See §6 firewall rule 3.) |
| 5 | **Competency** | `par:<template>` / `edge:<anomaly>` / `firstprobe:<kind>` | **+1** | A par / sub-par solve of a contract template; an edge-case or anomaly you produced; the first probe of each kind (charged cap, reverse diode, saturated Q, floating node). |
| 6 | **Autopsy** | `autopsy:<mode>` | **+2** | Autopsy of a **vented** part — each *distinct* failure mode (over-V, reverse, over-I, over-temp, I²t) is its own page. Paid in understanding for *breaking it and reading the wreck.* |
| 7 | **Standing milestone** | `standing:<cust>:trusted` | **+1** | A 5-clean-ship streak (rep ≥ 80) with one customer. Standing's single Lux tap — reputation *feeds* Lux once, it is never *spent* as Lux. |
| 8 | **Lab Book challenge** | `challenge:<id>` | **+2–3** | Completing an **offered** Lab Book challenge (the five types in §2). The largest faucet, and the one surfaced as offered, pull-not-pick tasks. |

> **Magnitudes are illustrative**, pending one owner balance pass in `econ/data/balance.ts` (see §8).
> Rule of thumb: faucet events are 1–2 Lux; challenges 2–3; **licenses** cost 2–8 Lux per tier
> (Era1 = 2, Era2 = 3, Era3a/b = 2/2, Era4 = 5, Era5a/b = 6/4, Era6 = 4, Era7 = 8). *Two challenges'
> worth of Lux ≈ one early tier.*

### 1.2 ID namespaces — the firewall ledger

`claimedLux` is one flat `string[]`. Every minted id lives in **exactly one** namespace, so dedupe
is a single `includes()` and the namespaces never collide:

```
predict:<id>            phenomenon:<id>         concept:<id>
par:<template>          edge:<anomaly>          firstprobe:<kind>
autopsy:<mode>          standing:<cust>:trusted challenge:<id>
```

`applyEarn({ kind: 'lux', id, amount })` is the **only** mint path and **no-ops** when `id` is
already in `claimedLux`. Structurally, `EarnEvent` has **no** `placedPart`, `timePlayed`, or
`credits` member — **actions and Credits cannot earn Lux.** That absence *is* the firewall (§6).

### 1.3 The FIREWALL rule (stated once, here; proven in §6)

> **Lux is earned only from understanding-events the sim can detect.** It is **never** purchased,
> **never** converted from Credits, and **never** minted by raw playtime or repetition. Each award
> fires **once**. The grindable path (re-shipping the same easy contract) pays the **most Credits
> and zero Lux** — breadth without depth.

---

## 2. The LAB BOOK as a challenge system

The Lab Book is **two faces over one fire-once store**:

- **The CODEX** *(passive)* — a page per detectable phenomenon, filled the first time you cause it.
  This is the `concepts.ts` fire-once `ConceptCard` pattern, generalized: **one event = a permanent
  page + a one-time Lux award.** Ten authored detectors at MVP target (rectification, ripple,
  brownout, latch, oscillation, resonance, clamp, saturation, virtual-short, divider-tap).
- **The CHALLENGE DECK** *(active)* — **offered** named tasks, each a thin curated frame around a
  faucet, each paying `challenge:<id>`. A cleared challenge greys and pays `0` forever after.

Both ride the **already-built** pull machinery: `offerConcept` / `pumpConcepts` / `seenConcepts` /
the `explainAsYouGo` mute. The challenge deck is the same `{ id, title, body }`-shaped data card with
a `detect` predicate added.

### 2.1 A challenge is DATA, not behaviour

```ts
// econ/labNotebook.ts  (greenfield; SPDX header required)
interface Challenge {
  id: string;            // claimedLux dedupe key, e.g. "demo-rectification"
  type: ChallengeType;   // PREDICT | BUILD | BREAK | REVERSE | DEMONSTRATE
  title: string;         // two-tier reading register (short clause + glyph / pulled body)
  prompt: string;
  lux: number;           // 2..3, from balance.ts
  detect: TriggerId;     // names a predicate in the SEPARATE TRIGGERS map
  unlockedBy?: NodeId;   // gates OFFERABILITY only — never gates play
  blackbox?: SealedSpec; // REVERSE-ENGINEER only
}
```

The predicates live in a **separate** code map — the `partInfo.ts` content/logic split discipline:

```ts
const TRIGGERS: Record<TriggerId, (history: Snapshot[], maps: ElectricalMap) => boolean> = { … };
```

Each `detect` is a **pure read-only sampler** over the once-per-frame batched snapshot — the
**identical** sampler the grader and the codex detectors use. No new wasm crossing (§6).

### 2.2 The challenge-type table

| Type | What the player does | How it is **generated** | How it is **graded** (`detect`) | Pays |
|------|----------------------|-------------------------|---------------------------------|------|
| **PREDICT** | Guess a node **V** / period / current *before* Run; land in the green band. | **Parametric** via `mulberry32` (never `SEED=1337`) — endless deck off a stable key. | The **predict-then-reveal** window-reduce vs the guess ± tolerance. | `challenge:predict-<id>` **+2** |
| **BUILD-A-THING** | Build a circuit whose **behaviour** matches a target (e.g. *hold 3.3 V under a load step*). | **Parametric** via `mulberry32`. | A `SpecLine[]`-style **value-aware behaviour grade** at *named pins* on the **player's own board** — **never a reference topology.** | `challenge:build-<id>` **+2–3** |
| **BREAK-A-THING** | Drive a part past a rating until it **vents**, then autopsy it. | **Authored** — one row per failure mode. | The **unhashed** `failedMask` flag **+** the autopsy verb; each mode is its own id. | `challenge:break-<mode>` **+2**, plus `autopsy:<mode>` **+2** |
| **REVERSE-ENGINEER** | Probe a **sealed** chip (pins + hidden behaviour) and replicate/state its transfer. | **Authored** `SealedSpec` set (small at MVP). | Graded against the hidden reference's *measured* behaviour at the pins, on an **offscreen scratch `Simulation`** (its hash is **never** compared to the golden). | `challenge:blackbox-<id>` **+3** |
| **DEMONSTRATE** | Cause a **named phenomenon** on purpose (oscillate / latch / rectify / resonate). | **Authored** — one row per phenomenon. | The **matching phenomenon detector** (the same one that fills the codex page). | `challenge:demo-<phenom>` **+2** (+ first `phenomenon:<id>` — see §2.4) |

> **Authored vs generated split (recommended):** DEMONSTRATE + BREAK are **authored** (finite,
> curated — one row per phenomenon / failure mode). PREDICT + BUILD ride `mulberry32` (**endless**,
> but with a **capped / curated generated id space** — see the grind-around risk in §8).
> REVERSE-ENGINEER ships a **small authored `SealedSpec`** set at MVP.

### 2.3 Pull-not-pick presentation

Three rules, all riding the `concepts.ts` `offerConcept`/`pumpConcepts`/`seenConcepts` machinery:

1. **Offerable, not given.** A challenge's `unlockedBy` gates only whether it *can be offered*.
   Greyed **future** challenges show from minute 0 as a **visible progress bar** (the
   what-you-can't-do-yet idiom), so the deck is a map of the road ahead, never a wall.
2. **Pulled by play.** When the bench is *near* a challenge, it surfaces as a **non-modal margin
   glimmer** — *"you're one wire from oscillating — want to try?"* — the **what-if-seed idiom**:
   dismissible, muted by `explainAsYouGo`. The player can **also** open the Lab Book and **pull** any
   offerable challenge themselves.
3. **One at a time, fire-once, all-ages.** Offers drain **one per idle frame** via the `pumpConcepts`
   queue discipline — **never a stack, never mid-drag.** A cleared challenge greys and pays `0`. A
   **two-tier reading register** (short clause + glyph for a pre-reader; pulled body + *why* for an
   adult). **No challenge ever blocks Run, gates a part, or is mandatory.**

### 2.4 Dedupe, replay, and the double-pay rule

`claimedLux` is the single dedupe ledger; `challenge:<id>` and `phenomenon:<id>` dedupe
**independently**. So a **DEMONSTRATE** challenge that *first* causes a phenomenon pays **both**
`challenge:demo-<id>` **and** `phenomenon:<id>` — **each once** — the **deepest single aha**. It
never pays either twice. On any replay both are in `claimedLux` and the award is `0`: *insight does
not repeat.*

**One-shot for the guess-checked faucets (closes the brute-force leak).** A **PREDICT** id is
**committed before Run** and **consumed on the FIRST graded Run after the guess — win or lose.** A
wrong guess does **not** silently let you re-guess the same id into the band (no "spin the dial until
green"); the reveal is **post-grade.** **BUILD-A-THING** likewise claims its id on the first graded
submission — you may keep iterating the *circuit*, but Lux pays only if that first graded run lands
in-spec; re-attempts on a burned id pay `0`. This makes "fires once" mean *understanding*, not
*persistence* (resolves the PREDICT-farm leak).

> **DEMONSTRATE is also the eureka bridge.** Completing it fires the matching `TechNode`'s **eureka
> discount** (it lowers `luxPrice` / waives the exam — never mints Lux). This routes the *cheapest
> path up the tree* through **playing with the next tier's physics** — the Civ-VI "boost" feel, the
> closest the design comes to a felt *"this challenge → this part"* without hard-railing it.

### 2.5 The codex / sticker-book skin

The codex page-per-phenomenon fills passively on first cause. For a **pre-reader** it reskins as a
**sticker book**: a glyph + a chime, the write-up demoted. The two-tier reading register carries the
caregiver vs adult voice. The page is permanent; the Lux is one-time.

---

## 3. THE LOOP — challenge → Lux → license a tier → unlock a part

This is the mechanism, confirmed against the spine (`game-economy-progression-implementation.md`
§3.2), **not invented**:

```
1  PLAY / PULL a challenge.
2  The sim DETECTS it:  detect(history, maps)  — a pure read-only sampler over the
   honest once-per-frame replay (golden-safe, §6).
3  EARN:  applyEarn({ kind:'lux', id:'challenge:<id>', amount: 2..3 })
   — no-op if id already in claimedLux.
4  SPEND on a license:  unlockNode(nodeId)  — the ONLY Lux debit path.
   canUnlock(node, gs) is ok when:
        deps satisfied
        AND money.lux     >= node.luxPrice  (post-eureka discount)
        AND money.credits >= node.creditAfford
        AND exam passed   (eureka may waive)
   unlockNode debits Lux AND Credits together.
5  unlockedNodes gains nodeId
   ->  $derived unlockedTags gains node.unlocksTags
   ->  the bin's greyed part shelf UN-GREYS; the part is armable.
6  The new part makes new phenomena reachable  ->  new challenges become offerable
   ->  back to step 1.
```

### 3.1 The `canUnlock` / `unlockNode` wiring

```ts
function canUnlock(node: TechNode, gs: GameState): { ok: boolean; why?: string } {
  if (!node.deps.every((d) => gs.unlockedNodes.has(d))) return { ok: false, why: 'deps' };
  const owed = luxPrice(node, gs.eurekas);            // eureka discount applied here, never as a mint
  if (gs.money.lux < owed)                  return { ok: false, why: 'lux' };
  if (gs.money.credits < node.creditAfford) return { ok: false, why: 'credits' };
  if (node.exam && !examWaived(node, gs.eurekas) && !gs.examsPassed.has(node.id))
    return { ok: false, why: 'exam' };
  return { ok: true };
}

// the ONLY Lux debit in the codebase:
function unlockNode(nodeId: NodeId, gs: GameState) {
  const node = TECH_TREE[nodeId];
  const c = canUnlock(node, gs);
  if (!c.ok) return c;
  gs.money.lux     -= luxPrice(node, gs.eurekas);
  gs.money.credits -= node.creditAfford;
  gs.unlockedNodes.add(nodeId);   // $derived unlockedTags recomputes; the shelf un-greys
  return { ok: true };
}
```

`unlockedTags` is `$derived` from `unlockedNodes` (the union of each `node.unlocksTags`); the bin
greys any part whose tag is not in that set.

### 3.2 Worked example — Era0 → Diode Age via the Lab Book only

A **pure tinkerer**, zero contracts shipped.

1. Player wires an AC source through a single **diode** into a load.
2. The **rectification detector** sees a *bipolar* upstream node go *one-signed* downstream → fires
   `phenomenon:rectification` (**+1 Lux**, codex page fills; Probe offers a write-up card unless
   muted).
3. A margin glimmer had already offered the **DEMONSTRATE** challenge *"make a signal one-way."*
   Completing it fires `challenge:demo-rectification` (**+2 Lux**) **and**, because this was the
   first demonstration, the **eureka discount** on the **Diode-Age `TechNode`** (Era2: `luxPrice`
   3 → ~2).
4. Wallet now holds **3 Lux**. Player opens the tree. `canUnlock(era2)` sees `lux 3 ≥ owed ~2` **and**
   `credits ≥ creditAfford (120)` → `unlockNode(era2)` debits the discounted Lux + Credits.
5. `unlockedTags` gains the diode tags → **D / SD / LED / ZD / MOV un-grey** in the bin.

> **One demonstrated phenomenon paid three faces** — the challenge bounty, the codex page, **and**
> the eureka discount — and opened a part shelf. That is the owner's *"complete a Lab Book challenge
> → unlock a new part"* loop, made concrete.

### 3.3 Worked example — BUILD-A-THING is behaviour, not layout

The challenge *"build a node that holds 3.3 V under a load step"* is graded by sampling node **V** at
the named pin on the **player's own board** across the load-step window. A one-resistor-and-regulator
answer **and** a clever zener-clamp answer both pass and both pay `challenge:build-3v3` (2–3). **No
reference topology is matched.** You are paid for **the outcome the sim verifies**, never for copying
a recipe — so the *clever-by-half / one-part-wonder* achievement falls out for free.

### 3.4 Why "indirect" is the right answer (fungibility)

The same **5 Lux** can license **Era4 Active Tier** whether it came from two black-box challenges
(3 each), or from autopsies + competency badges + one prediction. There is **no rigid
`this-challenge → this-part` rail.** The player routes their own understanding into whichever depth
they want next, and the bin shows the whole greyed map so they always see what each tier costs.

---

## 4. All-ages & sandbox-primary

- **By-feel challenges** for pre-readers need no number entry: DEMONSTRATE *"match the glow"* /
  *"make it oscillate"*; BREAK *"break the light on purpose."* The detector reads the snapshot; the
  reward is a **sticker** (glyph + chime).
- **Pull-not-pick everywhere** — challenges glimmer as **dismissible margin cards**, never modal,
  muted by `explainAsYouGo`. The player can ignore the entire Lab Book and just play.
- **The bench is always available.** No challenge ever blocks **Run**, greys a part the player
  already owns, or is mandatory. The sandbox is **never gated by the book** — the book is an *offered
  layer over* free play, not a gate in front of it.
- **Two-tier reading register** on every card: short clause + glyph for the pre-reader; the pulled
  body + *why* for the adult.

---

## 5. Reuse vs. new surface

### 5.1 Reuse (do not fork)

| Reuse | Source (verified in-tree) | Role |
|-------|---------------------------|------|
| `CONCEPTS` + `CONCEPT_ORDER`, the fire-once `ConceptCard` | `web/src/lib/concepts.ts` (`CONCEPTS` L21, `CONCEPT_ORDER` L45) | Seed of the codex; generalized into phenomenon-page + `Challenge` shapes wholesale. |
| `offerConcept` / `pumpConcepts` / `seenConcepts` / `explainAsYouGo` mute | `web/src/App.svelte`, `web/src/lib/storage.ts` | The one-per-idle-frame drain, the fire-once dedupe set, the expert mute. The challenge deck **rides this**, it does not reimplement it. |
| `claimedLux: string[]` | mirrors the `seenConcepts` shape | The firewall dedupe ledger. |
| The once-per-frame batched snapshot + `electricalMap` | `web/src/sim/loop.ts`; `electricalMap` at `netlist.ts:1851` (params `elementCurrents`/`failedMask` ~L1854-55; reads ~L1869/L1871/L1882) | The **single read-only data source** for every detector / predicate / predict-check / grader. **No new wasm crossing.** |
| `mulberry32` PRNG family (never `SEED=1337`) | **NEW shared convention** (specced across the probe/econ docs; **not yet in `web/src`** — only `SEED=1337` exists today, `App.svelte:160`) | Parametric PREDICT / BUILD generation. |
| The `SpecLine[]` value-aware grader; the contract generator's offscreen-scratch-`Simulation` satisfiability discipline | `econ/contracts.ts` (planned) | BUILD-A-THING behaviour grading; REVERSE-ENGINEER black-box grading. |
| `persistSettings` / `cec.game.v1` localStorage, guarded-degrade | `web/src/lib/storage.ts` | Persist `money.lux` + `claimedLux` + the notebook slice (siblings of `seenConcepts`, none hashed). |

### 5.2 New (greenfield, all web-side)

- **`econ/labNotebook.ts`** — the phenomenon detectors + the challenge deck content + the `TRIGGERS`
  predicate map.
- **The Lux ledger** — `claimedLux` / `applyEarn` / the firewall reducer.
- **The tech-tree DAG** — `TECH_TREE` + `canUnlock` / `unlockNode` / `$derived unlockedTags`.
- **The Lab Book panel UI** — two faces (codex + deck), one store; the margin-glimmer offer surface.
- **The predict-then-reveal check**; the **autopsy UI** (the `failedMask` / ratings are already built
  in sim-core); the **`SealedSpec`** black-box blocks + the offscreen scratch grade verb.
- **Extend `concepts.ts`** — its 4 `CONCEPTS` → the 7 `FUNDAMENTALS_IDS` via a **one-time
  `seenConcepts` re-key migration** (migrate `claimedLux` concept keys in lockstep so no card or
  `concept:<id>` re-fires).

> **Naming:** `web/src/lib/codex.ts` **already exists** as the **part catalogue** — the discovery Lab
> Book / notebook slice must be a **separate module** (`econ/labNotebook.ts`) to avoid the collision.

---

## 6. Determinism & golden-safety

> **Golden-safe by construction. This is game-design / UX + web-side local state only.** It touches
> **no** `crates/sim-core`, **no** `buildNetlist` emission, **no** netlist, **no** `snapshot_hash`,
> **no** determinism golden, and adds **no** new JS↔wasm crossing (golden rule #2 — the boundary
> stays coarse; detectors sample the player board's existing history ring, never per-component /
> per-page / per-challenge).

Verified anchors:

- **Every Lux detector** — the phenomenon detectors, the predict-then-reveal check, every challenge
  `detect` predicate — is a **pure read-only sampler** over the existing once-per-frame batched
  snapshot: the `state` `Float64Array` (node voltages) + `elementCurrents` (branch currents) +
  `failedMask`, surfaced through `electricalMap` (`netlist.ts:1851`). `failed_elements` and
  `acMeasurements` are **already excluded from `snapshot_hash`** per CLAUDE.md.
- **A detector only flags / narrates / awards — it never alters the solve.** It sits *beside*
  `graphShape` / `complete` and never flips them, so every topology-only example stays bit-identical.
- **BREAK-A-THING reads the unhashed `failedMask`.** Confirmed at source: `flag_and_clamp_fails`
  (`crates/sim-core/src/lib.rs:6776`) writes `failed_elements` (L6807), and `snapshot_hash` (L7353)
  folds only `tick` + `node_v` + the DFF/sampler/comparator bits — **never `failed_elements`, currents,
  or AC.** (The invariant is also stated verbatim at lib.rs:2481.) A BREAK challenge **cannot** perturb
  `run_is_reproducible` or the golden.
- **REVERSE-ENGINEER is the SOLE faucet that spins a *separate* offscreen scratch `Simulation`** —
  every other faucet is a pure read of the existing once-per-frame player-board snapshot. Its hash is
  **never** compared to the golden and it is **determinism-isolated** (never in `run_is_reproducible`'s
  compared path); it is **deferred to post-MVP** precisely because it is the one place the read-only
  invariant is relaxed. The sealed chip on the player's board is a **real tick-pure fixture** (the
  `PULSE`/`SHUNT` param-on-existing-element trick — no new sim element) that replays byte-identically.
- **Any detector needing a new scalar** folds **one** value into the snapshot and stays **out** of
  `snapshot_hash` (the `failed_elements` unhashed-flag precedent — call this out as a PR review gate).
- `claimedLux`, the notebook slice, challenge state, and `seenConcepts` are all **web-side local
  state**, never hashed.
- **The firewall is data-enforced, not a slogan.** `EarnEvent` structurally has no
  `placedPart`/`timePlayed`/`credits` member; Lux is minted only by `applyEarn` lux-kind and debited
  only in `Sink.license`/`unlockNode`. Lock it with **vitest** cases (one per rule below).

`cargo test -p sim-core` (incl. `run_is_reproducible`) and the FNV-1a `snapshot_hash` are
**unaffected by construction** — there is no code path from any surface here into the deterministic
core. **SPDX `Apache-2.0` header on every new `.ts` / `.svelte` file.**

The three firewall invariants, each locked by a vitest case:

1. **No `Credits → Lux` edge** (and no license-without-Lux edge). Lux is raised only by `applyEarn`
   lux-kind, debited only inside `Sink.license`/`unlockNode` (which debits Lux **and** Credits
   together). Lux is **non-purchasable** (the no-dark-patterns charter bans pay-to-skip-understanding).
2. **Lux fires once.** `claimedLux` dedupes every id; re-causing a phenomenon / re-completing a
   challenge / re-shipping a seed all pay `0`. The grind has **no Lux gradient**.
3. **Eureka discounts the gate, never mints.** It lowers `luxPrice` or waives the exam, never adds
   Lux to the wallet, and the underlying phenomenon dedupes so it cannot be farmed.
4. **The generated id space is FINITE / CURATED (a hard constraint, not a balance knob).** PREDICT
   and BUILD ride `mulberry32` parametric decks; an *unbounded* unique-id stream would mint unbounded
   Lux from repetition, defeating invariant 2. So the generated deck is a **fixed bank of `N`
   parametric templates** (`id = template#instance`, capped), making total mintable Lux from
   generated challenges **bounded by construction.** Until that cap is set, invariants 1–3 are proven
   only for the **authored** faucets (DEMONSTRATE / BREAK / REVERSE / phenomena); the generated
   faucets are firewall-safe **only** with the cap. (Promoted from open-Q #11 — this is load-bearing.)

> **Firewall holding under a grind attempt:** a player ships the same easy contract 20 times.
> Credits accumulate (decayed by repetition), the sandbox can grow — but the **tree does not
> advance**: each ship re-fires no new Lux id, the contract pays only Credits, and
> `canUnlock(nextTier)` still returns `ok: false` because `money.lux < luxPrice`. There is no
> `Credits → Lux` reducer. The grind bought **breadth and zero depth** — the firewall, *data-enforced*.

---

## 7. Phased build

| Phase | Lands | Notes |
|-------|-------|-------|
| **P-now** (partly built) | `concepts.ts` cards = the predict-then-reveal + first-encounter seed. | Already shipping. |
| **P4** (rides the spine §P4) | `econ/labNotebook.ts` with **~4 authored detectors** (rectification, ripple, brownout, latch) + **DEMONSTRATE + PREDICT** challenges + the Lux ledger (`claimedLux`/`applyEarn`/firewall) + the tech-tree DAG (`canUnlock`/`unlockNode`/`unlockedTags`) + the eureka discount + the Lab Book panel. | MVP challenge slice: **Predict + Demonstrate + Break-it**. Migrate `concepts.ts` → 7 `FUNDAMENTALS_IDS`. |
| **P5** | **BREAK-A-THING** follows the autopsy UI; `autopsy:<mode>` pages. | Reads the unhashed `failedMask`. |
| **P6** | **BUILD-A-THING** rides the value-aware `SpecLine[]` grader. | Behaviour, never topology. |
| **P-post-MVP** | **REVERSE-ENGINEER** — `SealedSpec` blocks + offscreen scratch-`Simulation` grade; may need an AC-sweep input parked behind Era 4. | Riskiest; depends on the sealed-block / IC-maker mechanism. Do not let it block the MVP. |

---

## 8. Open questions / owner hand-offs

1. **Challenge Lux magnitudes & ramp** — recommended `challenge:<id>` = **2** (predict / break /
   demo), **3** (build / black-box). All illustrative pending **one owner balance pass** in
   `econ/data/balance.ts`. *Owner sign-off.*
2. **Confirm the double-pay rule** — a DEMONSTRATE challenge that *first* causes a phenomenon pays
   **both** `challenge:demo-<id>` and `phenomenon:<id>`, each once (recommended as the deepest aha).
   It is the one place two ids fire from one event; keep the namespaces disjoint. **The UI must
   narrate it as one celebrated event, not two stacked toasts.** *Owner confirm.*
3. **Authored vs generated split** — recommended DEMONSTRATE + BREAK **authored**, PREDICT + BUILD
   **parametric** via `mulberry32` (with a **capped/curated generated id space** — see risk below),
   REVERSE-ENGINEER a small authored `SealedSpec` set at MVP. *Owner / generator owner.*
4. **Eureka ↔ challenge coupling** — confirm completing a DEMONSTRATE challenge fires the matching
   `TechNode` eureka discount (recommended — the cheapest-path-up-the-tree bridge). Affects whether
   `labNotebook.ts` writes `eurekas[]`. **The discount must only ever cheapen `luxPrice` / waive the
   exam — never mint Lux**, or firewall rule 3 breaks. *Owner call.*
5. **Confirm the loop stays `challenge → Lux → tier → part`** (indirect, fungible) and **rejects any
   literal `this-challenge-hands-you-part-Y` rail** — a direct part handout would let one repeatable
   task grind-farm parts and break the firewall. The owner's question implies the indirect loop;
   **confirm it is intended.** *Owner call.*
6. **MVP challenge-kind subset** — recommended **Predict + Demonstrate + Break-it** first (land with
   P4's `labNotebook.ts`, ~4 detectors); Build / Reverse-engineer deferred. *Owner confirm the cut.*
7. **Naming** — `web/src/lib/codex.ts` already exists as the **part** catalogue; keep the discovery
   Lab Book / notebook slice in a **separate** module (`econ/labNotebook.ts`). *Enforce in review.*
8. **Fold `offerConcept`/`pumpConcepts` into one Lab Book drain loop, or run parallel?** — the only
   change that touches **built, working** onboarding code (`App.svelte`). Safer MVP: run the
   challenge pump **in parallel** reusing the same one-per-idle-frame discipline, defer the fold.
   Either way the `explainAsYouGo` mute must stay honored. *Owner refactor call.*
9. **Era-tag → tier coupling granularity** — how tightly should a challenge's `unlockedBy` era-tag
   *steer* which tier it helps license (soft, via the eureka discount only, vs a visible *"this
   challenge advances Diode Age"* hint in the book)? Affects legibility without hard-railing.
   *Owner call.*
10. **May a pure tinkerer license the keystone / FPGA tier (Era7) on Lab Book Lux alone**
    (`requiresStanding` floor **OFF** by default)? Flips whether challenges are a **complete** door
    up the tree or only a partial one. *Design-intent owner call.*
11. **Generated-deck grind-around — RESOLVED into firewall invariant 4 (§6):** the generated id space
    is a **finite, capped bank** of `N` parametric templates (`id = template#instance`), bounding total
    mintable Lux by construction. Open only the *value* of `N` per era and the curation list — *balance
    pass.* (Also resolved: the PREDICT brute-force leak, via the §2.4 one-shot rule.)
12. **Sticker-book skin** for BREAK/DEMONSTRATE for pre-readers (glyph + chime, write-up demoted) —
    *content owner for the caregiver register.*

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Game Economy & Progression — Implementation

> **Layer.** This is the *implementation* doc beneath the concept docs. The **WHY** lives in
> [`game-contracts-economy.md`] (§1 parametric contract, §2 standing vs batch, §3 currencies &
> unlocks, §4 anti-grind firewall, §6 MVP economy), [`game-progression.md`] (§0 three-axis model,
> §2 tech tree, §3 unlock recipe, §4 contract lifecycle, §5 tinkerer economy + Lab Notebook + eureka,
> §6 era spine), [`game-rewards.md`] (juice, SHIP-IT, failure-as-fun), and
> [`game-factory-loop.md`] (contracts-as-pull). This doc specifies the **HOW**: the data shapes,
> reducers, formulas with illustrative numbers, the module layout, the file integration points, and a
> phased MVP. Where the concept docs disagree with the code, **the code wins** — every line number and
> symbol below was read from the tree, not recalled.

---

## 0. Thesis + what this panel decides

**One web-side game-state tree, a few Svelte rune stores, one sibling `localStorage` key, and a grader
that only reads the snapshot we already batch once per frame.** That is the whole spine. The economy is
not a system bolted onto the sim — it is a *reading* of the sim's already-measured, unhashed outputs
plus a pile of pure reducers over plain TS data.

This panel decides:

1. **The state model** — exactly what `GameState` holds, which stores own it, where it persists.
2. **The tech tree** — a static hand-authored DAG (`NODES`), what unlocks what era-by-era, how gating
   is *evaluated* (a pure fold to a `Set<string>`), and how it *renders* (the bin greys locked shelves).
3. **Earning & spending** — concrete sources/sinks/formulas/numbers for [Credits], [Lux], [standing],
   and the **anti-grind firewall** as a data-enforced rule, not a slogan.
4. **The contract loop as the main loop** — the template/instance schema, seeded generation with a
   satisfiability check, the deterministic grader (the teaching panels' value-aware grader,
   *generalized* not forked), batch vs standing, the lifecycle FSM, the UI surface.
5. **Introduction & pacing** — the seam from the first contract into the full loop, era-by-era reveal as
   *pulled affordances*, greyed shelves from minute 0, the Probe + Lab Notebook narration.
6. **Persistence & the golden boundary** — the sibling key, the blob shape, backward-compat, restore,
   and why none of it can touch the golden.

**Relationship to the teaching panels.** This panel *consumes* three things the teaching panels
([`probe-teaching-arc.md`], [`beginner-onboarding-all-ages.md`]) already designed: (a) the
**value-aware contract grader** (a predicate over the live `electricalMap`), (b) the **judgement part**
(a real placeable fixture the player wires to), and (c) the **per-session seeded parametric generator**
(`mulberry32`). We do **not** reinvent them; we generalize the single-`Vout`-vs-target predicate into a
`SpecLine[]` grader and wrap the generator with a par/satisfiability pass.

**Current code reality (verified, June 2026).** The economy/progression/contract/unlock systems are
**greenfield**. What exists to wire into:

| Exists today | Where | What we do with it |
| --- | --- | --- |
| `PARTS` array (each part has a tech-tree `tier:'I'/'II'` tag + category + keywords) + `PART_KINDS` | `web/src/App.svelte:186` | the bin to lock-gate; the `tag` string is the *join key* to the tree. The `tier` tag is demoted to a coarse era-bucket hint. |
| `electricalMap` / `nodesOfComponent` / `elemOfComponent` / `nodeNames` / `graphShape` | `web/src/lib/netlist.ts:1822 / :809 / :799 / :833 / :1811` | the grader's *entire* input + pin/branch address book; `graphShape` is the topology oracle the value grader sits **beside**. |
| `Settings` (`seenIntro`, `explainAsYouGo`, `seenConcepts?`) + `SETTINGS_VERSION=1` + `loadSettings/saveSettings/resetAll` + `makeDebouncedBoardSaver` + `BoardBlob` | `web/src/lib/storage.ts:29 / :52 / :156 / :169 / :183 / :199 / :69` | the guarded-degrade persistence discipline to clone into a **sibling** key. |
| `EXAMPLE_CATEGORIES` + graded examples ladder + do/why/done Build engine + `ExampleSpec` | `web/src/lib/examples.ts` | the tutorial → earning seam (`ExampleSpec.issuesContract?`). |
| `codex.ts` part-catalogue | `web/src/lib/codex.ts` | **distinct** from the discovery Lab Notebook (which we build new). |

There is **no** Credits / Lux / standing / contract-loop / unlock-gating / reputation code yet. Quality-grade
`Component.tier` (budget/mid/high/lab, in `tiers.ts`) is a **different axis** and is never touched here.

---

## 1. The state model at a glance

One tree, four owning modules, one sibling key.

```
                          ┌─────────────────────── cec.game.v1 (localStorage) ───────────────────────┐
                          │  GameState { v, money, standing, unlockedNodes, passedExams, eurekas,     │
                          │              claimedLux, notebook, contractLog, band, seedClears,         │
                          │              active[], standingRuns[] }                                   │
                          └───────────────────────────────────────────────────────────────────────────┘
                                                       ▲  load/save (debounced, guarded-degrade)
                                                       │
   ┌──────────────┐   ┌───────────────┐   ┌────────────────┐   ┌──────────────┐
   │ economy.ts   │   │ progression.ts│   │ contracts.ts   │   │ labNotebook.ts│
   │ wallet +     │   │ tech-tree DAG │   │ template/inst  │   │ phenomenon    │
   │ earn/spend   │   │ + gating eval │   │ + generator    │   │ detectors     │
   │ + firewall   │   │ + unlockNode  │   │ + grader + FSM │   │ + eureka      │
   └──────┬───────┘   └──────┬────────┘   └──────┬─────────┘   └──────┬───────┘
          │   pure reducers over GameState (no module owns its own copy)│
          └───────────────────────────┬─────────────────────────────────┘
                                       ▼
                          gameState.svelte.ts  ($state store + $derived unlockedTags / offerable)
                                       ▼
                          App.svelte  (bin gating · offer cards · HUD chips · SHIP-IT beat)
                                       ▲
                          loop.ts  ── once-per-frame batched snapshot ──►  electricalMap (READ ONLY)
```

| State slice | Type | Owned by | Persisted in |
| --- | --- | --- | --- |
| `money` | `{ credits:number; lux:number }` | `economy.ts` | `cec.game.v1` |
| `standing` | `Record<CustomerId, number>` (0..100, default 50) | `economy.ts` | `cec.game.v1` |
| `unlockedNodes` | `string[]` (owned TechNode ids; Era0 implicit) | `progression.ts` | `cec.game.v1` |
| `passedExams` | `string[]` (cleared `examTemplateId`s) | `progression.ts` | `cec.game.v1` |
| `eurekas` | `Record<PhenomenonId, boolean>` | `labNotebook.ts` | `cec.game.v1` |
| `claimedLux` | `string[]` (one-time Lux event ids — **the firewall ledger**) | `economy.ts` | `cec.game.v1` |
| `notebook` | `Record<PhenomenonId, NotebookPage>` | `labNotebook.ts` | `cec.game.v1` |
| `contractLog` | `Record<string, ContractRecord>` (keyed `templateId:seed`) | `contracts.ts` | `cec.game.v1` |
| `seedClears` | `Record<string, number>` (`templateId:seed` → clear count) | `contracts.ts` | `cec.game.v1` |
| `band` | `number` (global difficulty creep, clamped per era) | `contracts.ts` | `cec.game.v1` |
| `active` | `ContractInstance[]` (offered/accepted/building) | `contracts.ts` | `cec.game.v1` + the active one rides `BoardBlob` |
| `standingRuns` | `StandingRun[]` (committed circuits, Phase 5) | `contracts.ts` | `cec.game.v1` |

**Module layout** (all under `web/src/lib/econ/`, all host-testable like `netlist.test.ts`, SPDX on each):

```
web/src/lib/econ/
  state.ts              GameState type + DEFAULT_GAME + GAME_VERSION + pure reducers
  gameState.svelte.ts   $state store wrapping GameState + $derived unlockedTags / offerable
  economy.ts            Wallet ledgers + earn/spend formulas + decay table + the firewall
  progression.ts        canUnlock / nodeState / unlockedTags / unlockNode (gating eval)
  contracts.ts          ContractTemplate/Instance + lifecycle FSM + generator + grader
  labNotebook.ts        phenomenon detectors over the snapshot stream + eureka write
  data/
    techtree.ts         the static NODES: TechNode[] DAG
    eras.ts             EraPacing table (drives reveals + grey-shelf layout)
    balance.ts          ALL tunable numbers (one editable table for the owner pass)
  templates/
    fixedRail.ts        MVP template
    rcTiming.ts         MVP template
  reveal.ts             fire-once Reveal Engine (sibling of seenConcepts)
```

`storage.ts` gains a sibling `cec.game.v1` key (`loadGameState`/`saveGameState`); `resetAll()` clears it
too. **It is NOT a field inside `Settings`** — so an economy schema bump can never nuke the board or the
onboarding flags, and vice-versa.

---

## 2. The TECH TREE

### 2.1 Data model — node + prereq DAG schema

The tree is **static authored data**, a `const NODES` array sibling to `EXAMPLES[]`. Each node names the
sim **primitive** it lifts (P1–P8), its prereq node ids (the DAG edges), and the **PART tags** it makes
armable. The authoritative gate is `node.unlocksTags`, **not** the existing `PARTS[].tier` tag — that
tag is too coarse (Eras 1–7 collapse to `'I'/'II'`), so it is demoted to a visual era-bucket hint for
grey-shelf grouping. The tag *string* on a part is the join key; no new PARTS field is needed.

```ts
// web/src/lib/econ/data/techtree.ts — the static DAG (authored like EXAMPLES[])
type EraId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
type Era   = '0' | '1' | '2' | '3a' | '3b' | '4' | '5' | '6' | '7'; // 3a/3b are parallel sub-eras
type Primitive =
  | 'P1' // i(v) nonlinear device           (diode family)
  | 'P2' // per-device real params          (tolerance, ESR)
  | 'P3' // multi-terminal active           (BJT/MOSFET)
  | 'P4' // controlled source               (op-amp / comparator)
  | 'P5' // mutual coupling M               (transformer)
  | 'P6' // latch / hysteresis / mechanical (switch / pot; relay = future part)
  | 'P7' // thermal scalar                  (thermistor: NTC / PTC)
  | 'P8' // light I/O                       (LED placed; LDR / photodiode = future P8 input parts);

interface TechNode {
  id: string;                  // stable key, e.g. 'era2-diode-age'
  era: Era;                    // ordered metadata for the bin's grey-shelf layout
  primitive: Primitive | null; // null for Era0 (in-core) and Era6 (rules-only, no parts)
  title: string;               // 'Diode Age'
  blurb: string;               // one-line CEC-voice copy for the lock card
  requires: string[];          // prereq node ids — the DAG edges
  unlocksTags: string[];       // PARTS[].tag values this node makes armable (THE gate)
  unlocksTemplates: string[];  // contract template ids this node makes offerable
  luxPrice: number;            // un-grindable license cost
  creditsAfford: number;       // Credits you must HOLD (affordance, not always spent) to open
  examTemplateId?: string;     // optional competency-exam contract (a fixed high-difficulty seed)
  eureka?: {                   // Civ-VI-style sandbox-demonstration discount
    phenomenon: string;        // PhenomenonId; demonstrating it discounts this node
    discount: { luxPct?: number; examWaived?: boolean };
  };
}
```

```ts
// the unlock state of a single node — a pure 3-state DERIVATION, never stored
type NodeState = 'locked' | 'available' | 'owned';

function nodeState(n: TechNode, gs: GameState): NodeState {
  if (gs.unlockedNodes.includes(n.id)) return 'owned';
  return n.requires.every(r => gs.unlockedNodes.includes(r)) ? 'available' : 'locked';
}

function canUnlock(n: TechNode, gs: GameState): {
  ok: boolean; needLux: number; needExam: boolean; needCredits: number;
} {
  const discounted = !!(n.eureka && gs.eurekas[n.eureka.phenomenon]);
  const luxOwed = discounted && n.eureka!.discount.luxPct
    ? Math.ceil(n.luxPrice * (1 - n.eureka!.discount.luxPct))
    : n.luxPrice;
  const examWaived = discounted && !!n.eureka!.discount.examWaived;
  const examOk = !n.examTemplateId || examWaived || gs.passedExams.includes(n.examTemplateId);
  const depsOk = n.requires.every(r => gs.unlockedNodes.includes(r));
  return {
    ok: depsOk && gs.money.lux >= luxOwed && examOk && gs.money.credits >= n.creditsAfford,
    needLux: luxOwed, needExam: !examOk, needCredits: n.creditsAfford,
  };
}
```

```ts
// the derived GATE the bin filters on — recomputed only when unlockedNodes changes (a $derived store)
const ERA0_TAGS = ['V', 'AC', 'PULSE', 'I', 'R', 'C', 'L', 'GND', 'LOAD'];

function unlockedTags(gs: GameState, nodes: TechNode[]): Set<string> {
  const s = new Set<string>(ERA0_TAGS); // always armable
  for (const id of gs.unlockedNodes)
    for (const t of nodes.find(n => n.id === id)?.unlocksTags ?? []) s.add(t);
  return s;
}
```

### 2.2 The concrete what-unlocks-what graph (era by era)

Grounded in the 8 primitives + the era spine ([`game-progression.md`] §6), edges = `requires`. PART tags
are the verified ones in `App.svelte:186`. **Numbers are illustrative** (one balance pass, §10).

| Node id | Era | Prim | Requires (edges) | Unlocks (tags) | Lux | ₵ afford | Exam | Eureka |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `era0-first-light` | 0 | — | — | V, AC, PULSE, I, R, C, L, GND, LOAD | 0 | 0 | — | — |
| `era1-tolerances` | 1 | P2 | era0 | EC + **Real-mode fidelity** (tolerance/ESR grades) † | 2 | 60 | — | `ripple` (luxPct .5) |
| `era2-diode-age` | 2 | P1 | era1 | D, SD, LED, ZD, MOV | 3 | 120 | `exam-rectifier` | `rectification` (examWaived) |
| `era3a-hands-on` | 3a | P6 | era1 | SW, MSW, POT | 2 | 80 | — | `latch` (examWaived) |
| `era3b-second-domains` | 3b | P7,P8 | era1 | NTC, PTC | 2 | 80 | — | `thermal-runaway` (examWaived) |
| `era4-active-tier` | 4 | P3,P4,P5 | era2, era3a, era3b | Q, QP, NM, PM, OA, CMP, ASW, TR, SHUNT | 5 | 300 | `exam-amplifier` | `saturation` (luxPct .4) |
| `era5a-logic` | 5 | — | era4 | AND…XNOR, NOT, BUF, FF, DLATCH, JKFF, SRL, HADD, FADD, MUX2, DMUX, MAJ3, CTR | 6 | 500 | — | — |
| `era5b-mixed` | 5 | — | era5a | ADC, DAC, SAR, SDM, SPIM, SPIS, UART, uC | 4 | 400 | — | — |
| `era6-design-rules` | 6 | null | era5b | *(no parts — adds DRC spec lines to the grader)* | 4 | 400 | — | — |
| `era7-fpga` | 7 | — | era6 | LUT, FP, sealed user ICs | 8 | 1000 | — | — |

† **Era 1 gates a MODE, not a part tag.** Resistor tolerance / cap ESR are **quality grades**
(`resistorTolerance` / `ecEsr` in `tiers.ts`), not placeable PARTS — so `era1-tolerances` unlocks the
**Real-mode fidelity** via a new `unlocksFidelity` flag on `TechNode` (gating the Real toggle / the non-mid
tier grades), **not** an `unlocksTags` entry. **Orphan + future tags:** the real tags `TRI`/`SAMP`/`LS`/`PU`
attach at their matching era (→ era4–5b); `LUT` → era7 (the FPGA enabler, added above); `relay`, `LDR`,
`photodiode` are **future parts** (parts-roadmap) that slot into 3a/3b once built.

**The shape that matters.** Era 1 is the *fidelity tax* (tolerances arrive **before** new devices, so the
first new thing is "your nominal resistor is now ±5%"). **Era 3a/3b are P3-independent and parallel** —
both only `require: era1`, so the player picks hands-on switches *or* thermal/light next, **in either order —
but both are prerequisites of the Era 4 keystone (the `requires:[era2,era3a,era3b]` edge is all-of), so the
choice is which to do *first*, not which to skip**.
**Era 4 is the single keystone** — it gates on *all of* era2 + era3a + era3b, so the active devices are the
reward for having toured passives, diodes, mechanics, and second domains. **Era 5 is split** (`era5a-logic`
ships the integer-exact logic library first for zero golden churn, `era5b-mixed` adds analog/mixed-signal
after). Era 6 adds **no parts** — it unlocks DRC *spec lines* the grader can demand.

### 2.3 Gating evaluation

A **pure fold, no per-frame cost.** `unlockedTags` is a `$derived` Svelte store keyed only on
`gs.unlockedNodes` — it recomputes ~once per *unlock*, never per frame. The three derivations:

- `nodeState(n, gs)` → `locked | available | owned` (for the tree panel + lock cards).
- `unlockedTags(gs)` → `Set<string>` (for the bin filter).
- `offerableTemplates(gs)` → template ids whose gating node is owned (for the generator's offer filter).

**Three-force unlock** ([`game-progression.md`] §3): `unlockNode(gs, id)` is the **only** Lux debit path.
It asserts `canUnlock(node, gs).ok`, debits `node.luxPrice` Lux (post-eureka), pushes `id` into
`unlockedNodes`, and re-derives the gate. Credits are an **affordance** check (`credits >= creditsAfford`,
*held* not spent) — you cannot Credit-grind *past* a tier (Lux is the hard gate), but a broke player can't
license toys they can't stock. The exam (`examTemplateId`) is a normal generated contract at a fixed high
difficulty whose pass appends to `passedExams`; a demonstrated eureka can waive it.

### 2.4 Greyed-shelf bin integration

The bin renders **every** part from minute 0 (the tree *is* the visible progress bar). The integration is
additive at three existing choke points in `App.svelte`:

| Choke point | Change |
| --- | --- |
| `familyGroups(cat)` (the bin row builder) | compute `locked = !$unlockedTags.has(part.tag)` per row |
| `partRow` snippet | `locked` rows get an `is-locked` class (greyed, `pointer-events` kept for the tooltip) and a Lux-cost **lock badge** replacing the `part-tier` span; the badge names the gating node (`'Diode Age · ◇3'`) |
| `arm` / `toggleArm` | early-return when `locked`, and instead **open the gating node's unlock card** — a click on a locked part is a *pull toward its unlock*, never a silent no-op |

```
BIN  (era-ordered shelves)
 ┌─ Era 0 · First Light ────────────────────────┐
 │ [V] [R] [C] [L] [I] [GND]  ← armable          │
 ├─ Era 1 · Tolerances ─── ◇2 ──────────────────┤
 │ [R 1%]🔒 [R 5%]🔒 [EC]🔒   ← greyed, pullable │  click → unlock card
 ├─ Era 2 · Diode Age ──── ◇3 + exam ───────────┤
 │ [D]🔒 [LED]🔒 [ZD]🔒 …      ← greyed          │
 └───────────────────────────────────────────────┘
```

### 2.5 Worked Era 0 → 2 slice

1. **Minute 0.** `unlockedNodes = []` (Era0 implicit). `unlockedTags = ERA0_TAGS`. Bin shows V/R/C/L/I/GND
   armable; everything else greyed under era shelves. Player drags an LED-less divider in pure sandbox.
2. **First ship.** Completing the Probe-arc divider pays the first ₵ and (via predict-then-reveal) the
   first Lux. `era1-tolerances` is now `available` in the bin (deps `[era0]` owned).
3. **Demonstrate `ripple`.** The player builds a rectifier+cap in the sandbox; the `ripple` detector fires
   → `eurekas.ripple = true`. `era1-tolerances` Lux drops from 2 to `ceil(2 × .5) = 1`.
4. **Unlock Era 1.** `canUnlock` ok (1 Lux held, 60 ₵ held, no exam). `unlockNode` debits 1 Lux,
   `unlockedNodes = ['era1-tolerances']`, `unlockedTags` gains `R-real(1%/5%)`, `EC`. The 5% resistor shelf
   un-greys; its first contract is now offerable.
5. **Toward Era 2.** `era2-diode-age` flips `locked → available` (deps `[era1]` met). Clicking a greyed
   `[D]` opens its card: *"Diode Age — 3 Lux + pass the Rectifier exam — unlocks D, SD, LED, ZD, MOV."*
   Demonstrating `rectification` in the sandbox waives the exam; otherwise the player accepts
   `exam-rectifier` (a normal contract) and ships it to fill `passedExams`.

---

## 3. EARNING & SPENDING

Three resources, three structurally-different earning paths, one firewall. **Credits** are a continuous
lump computed from contract difficulty × multiplicative quality × per-seed decay; spent on **breadth**.
**Lux** is never spent on consumables — awarded by one-time *insight events*, only ever buying licenses.
**Standing** is a per-customer 0..100 reputation; not spendable, it scales offers + a payout multiplier.

```ts
// web/src/lib/econ/economy.ts — the ONLY way value enters the wallet
type EarnEvent =
  | { kind: 'batchPass';    contract: ContractInstance; grade: GradeResult }
  | { kind: 'standingTick'; contract: ContractInstance; rampLevel: number }
  | { kind: 'lux';          id: string; amount: number } // id = 'predict:rc-rise' | 'concept:divider' | …
  | { kind: 'rma';          contract: ContractInstance; reason: 'vent' | 'oos' | 'lapse' };
// NOTE: there is deliberately NO 'placedPart' / 'timePlayed' member — actions cannot earn.

interface GradeResult {
  pass: boolean;
  lines: { ok: boolean; measured: number; margin: number /* signed frac to nearest tol edge */ }[];
  realism: 'ideal' | 'real5' | 'real1temp';
  parRatio: number;       // player BOM cost / contract.par.bomCost; <1 beats par
  sweepHeld: boolean;     // Monte-Carlo / worst-case corner held (deferred service)
  vented: boolean;        // any element tripped RATED_CURRENT FAIL (the unhashed failedMask)
  tier: 'bronze' | 'silver' | 'gold' | 'certified';
}

function applyEarn(gs: GameState, e: EarnEvent, customerId: string): {
  gs: GameState; toasts: Toast[];
}; // pure — returns a NEW GameState (Svelte reactivity + undo are trivial)
```

### 3.1 Credits — sources, sinks, formula

**Batch payout** ([`game-contracts-economy.md`] §1/§3, [`game-rewards.md`] §1):

```
payout = round( BASE(template) · (1 + 0.6·difficulty)
                · realismMult · eleganceMult · marginMult · standingMult · decay )
```

| Factor | Values (illustrative — live in `data/balance.ts`) |
| --- | --- |
| `BASE` per template | fixedRail 40 · divider 50 · rcTiming 70 · currentLimit 80 · rectifier 140 · regulator 180 · filter 220 · oscillator 260 · logicLevel 200 · timingClosure 300 |
| `difficulty` | `[0,1]` continuous — *the dial IS the campaign* |
| `realismMult` | ideal 1.0 · real5 (5% parts) 1.6 · real1temp (1% over-temp corner) 2.2 |
| `eleganceMult` | parRatio ≤ .7 → 1.5 · ≤ .85 → 1.3 · ≤ 1.0 → 1.15 · ≤ 1.3 → 1.0 · else 0.85 (a 50-cap brute-force tanks here — passes but never multiplies up) |
| `marginMult` | tightest line margin `[0,2%)` → 1.15 *survival* · `[2%,15%)` → 1.0 · `≥15%` → 1.25 *robustness* |
| `standingMult` | `0.9 + 0.2·(standing[customer]/100)` → 0.9 (rep 0) … 1.1 (rep 100) |
| `decay` | `n=seedClears[tpl:seed]`; `n===0 ? 1.0 : max(0.1, 0.25·0.5^(n-1))` → 1.0, .25, .125, .0625, floor .1 |

*Worked:* a `divider` (BASE 50) at difficulty 0.4, real5, parRatio 0.8, 18% margin, rep 70, first clear →
`round(50 · 1.24 · 1.6 · 1.3 · 1.25 · 1.04 · 1.0) = round(167.7) = 168 ₵`. Re-grinding that exact seed a
4th time → the same line × `decay 0.0625` ≈ **10 ₵**. *Playing a new seed is the only paying path.*

**Bonus TIER** is **derived** and gates which multipliers are live ([`game-rewards.md`] §3):

| Tier | Condition |
| --- | --- |
| bronze | pass only (ideal allowed) |
| silver | pass AND (real5+ OR margin <2% survival) |
| gold | pass AND real5+ AND parRatio ≤ 1.0 |
| certified | gold AND `sweepHeld` (needs the Monte-Carlo bench service — greyed pre-MVP) |

A degenerate pass is *structurally* bronze-capped because `parRatio > 1` forbids gold.

**Standing drip** (committed circuit, [`game-contracts-economy.md`] §2):
`drip = round( BASE(template) · 0.15 · (1 + 0.25·rampLevel) )`, paid per re-grade interval while the board
holds spec under a ramping `conditionProfile(tick, seed)` (a tick-pure θ-walk, the PWM/AC precedent).
`rampLevel` increments every K passing intervals (start K=4). A window FAIL → `lapsed` + an `rma` event.

**Credit SINKS** (the `Sink` union; spent on *breadth*):

```ts
type Sink =
  | { kind: 'part';       tag: string;  cost: number }   // stock a real part
  | { kind: 'area';       cells: number; cost: number }  // bigger board
  | { kind: 'instrument'; verb: string; cost: number }   // a scope/probe verb
  | { kind: 'service';    name: 'montecarlo' | 'tempsweep'; cost: number }
  | { kind: 'blueprint';  id: string;   cost: number }   // a saved sub-circuit stamp
  | { kind: 'license';    nodeId: string; lux: number; credits: number }; // the ONLY Lux debit
```

`spendCredits(gs, sink)` debits `credits` and **fails** (returns `gs` unchanged + an `insufficient` toast)
if `cost > credits`. **`spendLux` exists only inside the `license` branch** and debits both Lux *and*
Credits — there is no standalone `spendLux` export.

**Illustrative sink costs** (`data/balance.ts`, balance-pass): a real part stocks at ~`5–40 ₵` by family
(R/C ~5, diode ~12, MOSFET ~25, op-amp ~40); a board-area growth step ~`60 ₵`; an instrument verb (extra
scope trace / DMM mode) ~`80 ₵`; a bench service (Monte-Carlo / temp-sweep) ~`120 ₵`; a blueprint stamp
~`30 ₵`. One fresh divider (~168 ₵) buys ≈ *a tier license + a couple of parts* — the wallet always has a
destination.

**Anti-grind on DISTINCT easy seeds** (the same-seed `decay` only bounds re-grinding *one* seed). The real
bound is the **difficulty dial**: an easy seed (`difficulty→0`, ideal) earns the **floor** (`BASE · ~1.0`)
and — decisively — pays **zero Lux** (Lux is gated on understanding events, §3.2, never on Credits). So
farming many trivial distinct seeds is a slow flat Credit drip that buys breadth but **cannot climb the
tree**; that asymmetry *is* the firewall (§3.4). A stated time-to-milestone yardstick for the balance pass:
~3–5 clears → Era 1, ~12–18 → the Era 4 keystone (tune in §10 Q1).

### 3.2 Lux — sources, license tiers, never spent

Lux is **never a formula** — always a fixed one-time award keyed by event id, deduped against `claimedLux`
(if `id ∈ claimedLux`, award 0 — *insight does not repeat*, [`game-contracts-economy.md`] §4.3):

| Lux event id pattern | + | When |
| --- | --- | --- |
| `predict:<id>` | 2 | a correct predict-then-reveal (the single best understanding reward) |
| `concept:<id>` | 1 | first demonstration of a concept/phenomenon |
| `par:<template>` | 1 | a par/sub-par solve |
| `edge:<anomaly>` | 1 | an edge-case / anomaly produced |
| `autopsy:<mode>` | 2 | autopsy of a *vented* part (failure-as-fun refund, [`game-rewards.md`] §6) |
| `firstprobe:<kind>` | 1 | first probe of each KIND (charged cap, reverse diode, saturated Q, floating node) |
| `phenomenon:<id>` | 1 | a Lab Notebook phenomenon page fills |
| `standing:<cust>:trusted` | 1 | a 5-clean-ship streak (rep ≥ 80) — standing *feeds* Lux but is never spent |

Lux **spends only on licenses**, and a license also costs Credits (the 3-force recipe):

| License | Lux | + Credits |
| --- | --- | --- |
| Era1 Tolerances | 2 | 60 |
| Era2 Diode Age | 3 | 120 |
| Era3a / Era3b | 2 / 2 | 80 / 80 |
| Era4 Active Tier (keystone) | 5 | 300 |
| Era5a / Era5b | 6 / 4 | 500 / 400 |
| Era6 Design Rules | 4 | 400 |
| Era7 FPGA | 8 | 1000 |

### 3.3 Standing / reputation — sources, effects, the RMA crater

`standing[customer]` starts 50, clamped 0..100. **Asymmetric: slow build, fast loss** — reliability over a
*product run* matters.

| Event | Δ standing |
| --- | --- |
| clean batch ship | +4 base, +2 if gold+, +2 if on-time |
| 5-clean streak (rep ≥ 80) | one-time +1 Lux `standing:<cust>:trusted` |
| RMA — out-of-spec ship caught | −18 |
| RMA — standing-window lapse | −12 |
| **RMA — vent** (a Real-mode rating FAIL on `failedMask`) | **−25** + clawback of the last drip interval |

**Effects:** (1) *offer gating* — a customer's higher-difficulty/standing contracts surface only at
`standing ≥ 60`; below 40 the customer stops offering (rebuild on easy batches). (2) *payout* via
`standingMult` (0.9..1.1). (3) a *preferred-vendor* badge at `≥ 85` widens the generator's difficulty band.
The **vent → −25 + clawback** is the explicit downside that stops "always pick real parts" from dominating:
realism raises both the multiplier ceiling **and** the recall risk.

### 3.4 The anti-grind firewall — a concrete rule

Three data-enforced invariants, each locked by a vitest case:

1. **No Credits→Lux, no Credits→license edge.** Lux is raised *only* by `applyEarn({kind:'lux'})` and
   debited *only* inside `Sink.license`. The reducer signatures structurally cannot mint Lux from Credits.
2. **Lux fires once.** `applyEarn({kind:'lux', id})` no-ops when `id ∈ gs.claimedLux`. The `claimedLux` set
   *is* the firewall ledger (same fire-once shape as `Settings.seenConcepts`).
3. **Per-seed decay floors repeats.** `decay(seedClears[tpl:seed])` collapses a re-ground seed to a tenth
   after 4 clears. The biggest multipliers (`realismMult`, `marginMult`, `eleganceMult`) require
   realism/margin/par a single grind cannot fake. **New seeds are the rewarded path by design.**

---

## 4. THE CONTRACT LOOP

A contract is **DATA, not an authored puzzle.** A `ContractTemplate` is a pure-TS factory
(`sampleParams → buildSpec → buildReference → par`); a `ContractInstance` is one seeded freeze of it.

### 4.1 Template + instance schema

```ts
// web/src/lib/econ/contracts.ts
interface ContractTemplate {
  id: string;
  title: string;
  family: 'fixedRail' | 'divider' | 'rcTiming' | 'currentLimit' | 'rectifier'
        | 'regulator' | 'filter' | 'oscillator' | 'logicLevel' | 'timing';
  requiredTags: string[];                // ALL must be unlocked before this template is OFFERED
  minMode: 'ideal' | 'real';
  sampleParams(rng: () => number, difficulty: number): Params;
  buildSpec(p: Params): SpecLine[];
  buildBonus(p: Params): BonusLine[];
  buildReference(p: Params): GraphSnapshot; // the HIDDEN honesty/par/ghost circuit
  judgement(p: Params): JudgementSpec;      // which pads + stimulus + run_ticks
}

interface ContractInstance {
  id: string; templateId: string; seed: number; difficulty: number;
  mode: 'batch' | 'standing'; customer?: string;
  conditions: { supply: number; loadOhms: number; tempC: number; stimulus: StimulusSpec; runTicks: number };
  spec: SpecLine[]; bonus: BonusLine[];
  par: { parts: number; bomCost: number; power: number };
  pads: PadDecl[];                        // named OUT/LOAD/RAIL/SENSE/GND terminals the player wires to
  status: ContractStatus;
  judgementPartId?: number;              // component id once accepted
  lastGrade?: GradeResult; clears: number;
}

type Measure = 'nodeV' | 'branchI' | 'ripple' | 'risesToWithin' | 'period' | 'logicLevel';
type PinAddr =
  | { kind: 'pad';  pad: string }        // resolved through the judgement part's named-pin component id
  | { kind: 'net';  net: string }
  | { kind: 'pin';  ref: string; pin: number }
  | { kind: 'probe' };

interface SpecLine {
  measure: Measure; at: PinAddr; cmp: '==' | '<=' | '>='; target: number; tol: number;
  window?: [tickLo: number, tickHi: number];
  reduce?: 'last' | 'mean' | 'max' | 'min' | 'peakToPeak' | 'firstCross';
}

// the judgement part's tick-pure stimulus — reuses PULSE→ELEM_ACSOURCE / SHUNT→ELEM_RESISTOR, NO new element
type StimulusSpec = { kind: 'dc'|'square'|'tri'|'sine'|'loadStep'; vlow: number; vhigh: number; freqHz: number; duty: number; loadOhm: number };
type ContractStatus = 'offered'|'accepted'|'building'|'submitted'|'graded'|'shipped'|'failed'|'paid'
                    | 'committed'|'running'|'lapsed'|'retired'; // last four are standing-only
```

### 4.2 Generation — honest by construction

```ts
function generate(template: ContractTemplate, sessionSeed: number, difficulty: number): ContractInstance | null;
```

The seed is `mulberry32(xmur3(template.id + ':' + sessionSeed + ':' + difficulty))` — **the same PRNG
family as the probe arc, NEVER the sim's fixed `SEED=1337`, never `snapshot_hash`.** `params =
template.sampleParams(rng, difficulty)`.

**Satisfiability** is the honesty check: build `ref = template.buildReference(params)`, replay it on a
**separate, offscreen scratch `Simulation` instance** (a second `createSimulation` — **never** the player's
live sim / board / timeline) for a **capped** `runTicks` window collecting a `Snapshot[]` history, and grade
`template.buildSpec(params)` against it. The scratch instance is built, stepped, and **discarded** entirely
web-side at generate time; it computes its own `snapshot_hash` that is **never compared to the golden**, so it
is golden-irrelevant. *(Cost bound: one extra wasm instance per generate; cap the satisfiability pass to a
short **representative** window — not the full standing-length run — and/or generate on idle, so the worst case
is `K=8 × cappedTicks`, amortized by the once-at-generate-time caching below.)* If `!passed`, resample up to **K=8** times, then drop the template
this tick (guarantees *no impossible contract is ever offered*). On pass,
`par = { parts: ref.components.length, bomCost: bomOf(ref), power: meanPowerOf(history) }` and the ref
history is stashed as the **ghost** for the SHIP-IT replay. Satisfiability runs **once at generate time**
(cached on the frozen instance, which is persisted) — not per frame.

**Difficulty is continuous** ([`game-contracts-economy.md`] §1): `difficulty ∈ [0,1]` scales the sampled
bands — `tol = lerp(0.08, 0.01, d)` tightens, `iload` sweep widens, `runTicks` lengthens, and at `d > 0.6`
a second spec line stacks (e.g. a load-step droop ceiling).

### 4.3 The grader — deterministic, golden-safe, implements the teaching-panel design

```ts
function grade(
  spec: SpecLine[],
  history: Snapshot[],
  maps: { nodesOfComponent: Map<number,[number,number]>; elemOfComponent: Map<number,number>; nodeNames: Map<number,string> },
  padToComponent: Map<string, number>,
): GradeResult;
```

For each line: resolve `PinAddr` → snapshot index (a `pad` → componentId via `padToComponent`, then
`nodesOfComponent[id]` for `nodeV` / `elemOfComponent[id]` for `branchI`); slice `history` to the window;
`reduce`; compare to `target ± tol` with `cmp`; record `direction` on a miss for coaching. `passed =
lines.every(pass)`.

The value-aware grader + seeded generator are **specced by the teaching panels** (`probe-teaching-arc.md`
§3a/§3b) but **not yet built** — this is **NEW code implementing that design**, generalized from one `Vout`
line to a `SpecLine[]` list (*implement once; don't fork the design*). It reads **only** `Snapshot.state`
(node V) + `Snapshot.elementCurrents` (branch I) — **both optional on `Snapshot` per `web/src/sim/loop.ts`,
so a window with an undefined `elementCurrents`/`failedMask` frame is treated as not-ready / fail, never a
pass** — surfaced via `electricalMap` (`netlist.ts:1822`) — both already batched once per frame, both excluded
from `snapshot_hash`. It sits **beside** `graphShape` (`netlist.ts:1811`) and never flips `complete`, so
every existing topology-only example stays bit-for-bit unaffected.

**`reduce` verbs over a window:** `last` (value at last tick) · `mean` · `peakToPeak` (=ripple) · `min`/`max`
· `firstCross` (=risesToWithin: first tick where `|m-target| ≤ tol·|target|`, returned as a tick compared
`<=` against `byTick`) · `period` (ticks between two same-sign zero-crossings of `v-mean`). All are small
array reductions over the existing `loop.ts` history ring (the scrubber substrate).

**Crucial:** `PinAddr → index` is resolved at **grade time** from the *current* built netlist, never stored
— indices shift per build, so a player who rewires after submit is graded against the right nets.

### 4.4 Batch vs standing

| | **Batch** | **Standing** |
| --- | --- | --- |
| Pays | one lump on ship (§3.1) | a drip per re-grade interval (§3.1) |
| Gate to offer | a template's first **batch** instance | unlocks only after that template's first batch is `shipped` |
| Judge | `grade()` over the submitted history window | `grade()` over a *rolling* window every N intervals on a ramping `conditionProfile(tick, seed)` |
| Failure | `failed` (retry, board untouched) | `lapsed` + `rma` (standing −, drip clawback) |
| MVP | **Phase 0–3** | **Phase 5** (mode discriminant ships day 1; scheduler later) |

### 4.5 Lifecycle state machine

```
BATCH:
  offered ──accept()──► accepted ──(player builds)──► building ──submit()──► submitted
     ▲                     │ spawns judgement part on board                    │
     │ re-roll new seed    │ (status: a real component, captures               │ grade()
     │                     │  judgementPartId; bench KEEPS RUNNING)            ▼
  (OfferQueue)             └──────────────────────────────────────────────► graded
                                                          pass │           │ fail
                                                               ▼           ▼
                                                            shipped ──► failed (retry; board untouched)
                                                               │ pay()
                                                               ▼
                                                              paid  (++clears; first clear may fire Lux + notebook pages)

STANDING (Phase 5):  committed ──► running ──(rolling re-grade)──► running … │ window-fail ──► lapsed (rma)
```

`accept()` places the judgement part (a real fixture) on the **same** board — no scene switch. `submit()`
(the SHIP button) snapshots the current history window. `grade()` runs the §4.3 grader. `pay()` credits the
ledger and may fire Lux events + Lab-Notebook pages on a first clear.

### 4.6 The judgement part

**One generic placeable fixture** — a new `PARTS` entry + `PART_KIND` (tag `'JP'`) with **named pins**
(OUT/LOAD/RAIL/SENSE/GND). Electrically it maps to an **existing** element (ELEM_RESISTOR for a load-sweep /
ELEM_ACSOURCE for a stimulus) via the **PULSE→ELEM_ACSOURCE / SHUNT→ELEM_RESISTOR param-on-existing-element
trick** (CLAUDE.md Gotchas) — *no new sim element type*. Its waveform is tick-pure, so it hashes like any
element and replays byte-identically. `accept()` places it (capturing `judgementPartId`); `grade()` reads
node V + branch I **at its pins** via `nodesOfComponent[id]` + `electricalMap.get(id)`. Golden-safe because
it is a real element with a known waveform, not special-case core logic. *(A board containing a JP is not
hash-comparable to a bare board — fine; it is a real placed part. Documented in the determinism contract.)*

### 4.7 UI surface + the SHIP-IT beat

Offers arrive as **non-modal margin cards** (an "incoming contract" chip), never a modal that stops the
sandbox. The active-contract panel shows the spec lines as a live checklist (each greens as it passes).
The SHIP button → `submit()` → the **SHIP-IT beat** (pure choreography over `loop.ts` playback, *no new
sim*): (1) re-run from t=0, (2) drive the existing scrubber to walk the deterministic replay, (3) fire a
measurement cascade glow as each spec line's window passes (iterate `GradeResult.lines`, scrub to each
window), (4) draw the spec `target ± tol` as a green band on the scope, (5) animate the credit count-up,
(6) drop the **SHIP IT** stamp.

---

## 5. INTRODUCTION & PACING

Introduction is **one fire-once Reveal Engine, not a tutorial mode.** It piggybacks on the existing
concept-card machinery (`maybeShowConcept`, gated by `explainAsYouGo`, deduped by the `seenConcepts`
`SvelteSet`, persisted via `saveSettings`) so it inherits the proven mute + once-only + save path.

```ts
// web/src/lib/econ/reveal.ts — fire-once, sibling of seenConcepts
type RevealId =
  | 'first-contract'      // the divider OFFER appears (after a working divider on a sandbox board)
  | 'currency:credits'    // ₵ chip fades in (after the first payout count-up)
  | 'currency:lux'        // ◇ chip fades in (after the first Lux drop)
  | 'tree:opened'         // tech-tree panel becomes openable (after first Lux HELD)
  | 'standing:unlocked'   // Standing tab appears (after first batch of a template clears)
  | 'notebook:opened'     // Lab Notebook appears (after first phenomenon page fills)
  | `era:${Era}:reachable`;// an era's grey shelf lights 'almost' (deps met & one buy away)

interface RevealState { fired: string[]; pending: RevealId[]; } // pending drains ONE per idle frame
// persisted in cec.game.v1 — NOT cec.settings — so an economy bump can't nuke onboarding flags.
```

**`maybeReveal(id, payload?)`** mirrors `maybeShowConcept` exactly: early-return if in `fired[]`; else push
to `pending[]`. A drain loop pops **one** pending reveal per *idle* frame (a payout that earns ₵ + Lux + a
notebook page shows three reveals in sequence, never a stack). `explainAsYouGo` mutes the **Probe
narration** of a reveal but **never** the structural reveal — you can't hide the player's own credits.

### 5.1 Precondition → reveal map (pull-not-pick)

| Reveal | Fires when (a PLAY act, never a menu) |
| --- | --- |
| `first-contract` | `graphShape` first matches a divider AND the grader's specMet would pass a generated divider θ on the live board (so the offer only glimmers once the bench *could* serve it) |
| `currency:credits` | inside the first SHIP-IT payout count-up |
| `currency:lux` | the first Lux event — **`predict:rc-rise` for the opener** (the strongest reward, avoids double-firing with `concept:divider` at 4:00) |
| `tree:opened` | `lux ≥ 1` is HELD (you have something to spend → the deeper sandbox reveals) |
| `standing:unlocked` | a template's first batch reaches `shipped` |
| `notebook:opened` | the first phenomenon page fills |

### 5.2 The seam from the first contract into the full loop

The opening Probe arc (`led-pop → add-resistor → divider`) lands the player on a **working divider in pure
sandbox**. At that instant `first-contract` fires: a non-modal `OfferCard` glimmers in the HUD margin
(*"A customer needs 3.3 V from this 5 V rail — you've got the parts"*). **Accept** drops the judgement part
onto the **same board** (no new scene); the player's existing divider already nearly satisfies it; **Ship**
runs the deterministic replay and the SHIP-IT beat plays — and **that count-up is where
`currency:credits` reveals.** One board throughout, no mode switch ([`probe-teaching-arc.md`] §3,
[`game-progression.md`] §1.3).

`examples.ts` is the tutorial→earning seam: `ExampleSpec` gains an optional `issuesContract?: string`
(template id). Completing a worked example calls `contracts.offer(template)` to offer the matching family's
first batch instance — *"now do it to a spec."* `ExampleSpec.build()` doubles as that template's
`buildReference` for the satisfiability check.

### 5.3 Era-by-era reveal as pulled affordances

The contract generator only offers templates whose gating node is owned (`offerableTemplates`), so the
contract menu grows **with** the tree — an automatic personal curriculum ([`game-contracts-economy.md`]
§5). The bin's greyed shelves are the visible map of what's next; from minute 0 the player sees the whole
climb (Tolerances → Diode Age → … → FPGA) before earning a single ₵. A shelf transitions
`greyed → reachable` (a subtle accent edge-glow, the `era:<id>:reachable` reveal) the moment its deps are
owned and the player is one Lux/exam away — a *pull signal*, not an auto-buy. Era 3a/3b being parallel lets
the player choose hands-on or thermal/light next.

### 5.4 Nothing gated behind the economy

The bench is **never** blocked. The first ~4 minutes are pure play (drag R, Run, parallel R thickens the
bus, the cap charges on its RC curve) driven by the existing examples/Build engine, with **zero** economy
UI on screen. The first economic surface (the Credits chip) appears only *after* the player ships — the
economy is introduced as a *consequence of mastery*, not a precondition of play. Locked parts are visible +
greyed from minute 0 (offer-not-gate); a board *loaded from a save* that already contains a locked part
**solves identically** — the gate is a placement-UI filter, never a solve filter.

**Pacing guardrails:** (1) one reveal per idle frame; (2) no reveal fires during active wiring/dragging
(defer until idle); (3) currency chips, once revealed, are permanent + quiet (only deltas animate); (4) at
most one un-accepted offer glimmers in the opener (rest go to a browsable tray); (5) `explainAsYouGo` OFF =
veteran path — structural reveals still happen, Probe lines silent.

---

## 6. STATE, PERSISTENCE & ARCHITECTURE

### 6.1 The stores

`gameState.svelte.ts` holds **one** `$state` `GameState`; the module reducers are pure `(GameState, …) →
GameState`, applied by the store and persisted via a debounced saver (the `makeDebouncedBoardSaver`
discipline). `$derived` `unlockedTags` (bin filter), `offerableTemplates` (generator filter), and per-active
`nodeState` flow out of it. No module owns its own copy of state — they all operate on the one tree.

### 6.2 storage.ts save/blob shape + versioning

```ts
// storage.ts — a SIBLING key, NOT a Settings field
const GAME_KEY = 'cec.game.v1';
const GAME_VERSION = 1;
const DEFAULT_GAME: GameState = {
  v: 1,
  money: { credits: 0, lux: 0 },
  standing: {},                  // per-customer, default 50 on first contact
  unlockedNodes: [],             // Era0 implicit, not listed
  passedExams: [],
  eurekas: {},
  claimedLux: [],
  notebook: {},
  contractLog: {},
  seedClears: {},
  band: 0,
  active: [],
  standingRuns: [],
};

function loadGameState(): GameState {
  try {
    const raw = localStorage.getItem(GAME_KEY);
    if (!raw) return { ...DEFAULT_GAME };
    const obj = JSON.parse(raw) as GameState;
    if (!obj || obj.v !== GAME_VERSION) return { ...DEFAULT_GAME }; // version-mismatch → fresh
    return obj;
  } catch {
    return { ...DEFAULT_GAME };                                     // corrupt → fresh, never throws
  }
}
function saveGameState(gs: GameState): void { localStorage.setItem(GAME_KEY, JSON.stringify({ ...gs, v: GAME_VERSION })); }
// resetAll() ALSO removes GAME_KEY.
```

**Backward-compat.** The active `ContractInstance` (+ its seed) rides the **existing** `BoardBlob` as a new
**optional** field `contract?: ContractInstance` — omitted when none, so a plain board's blob is
**byte-unchanged** (the exact `userIcs?`/`innerDies?` optional-field trick at `storage.ts:69`). A refresh
restores the same offer/target. Because the economy lives in its **own** versioned key, a `SETTINGS_VERSION`
bump can't wipe economy progress, and a `GAME_VERSION` bump can't nuke the board or `seenIntro`/`seenConcepts`.

### 6.3 Restore + the golden boundary

Restore is `loadGameState()` (guarded-degrade) + reading `BoardBlob.contract` back into `active`. A
corrupt/stale blob degrades to `DEFAULT_GAME` rather than throwing — *exactly* `loadSettings`'
`obj.v !== VERSION → defaults`. **The golden boundary is structural, not policed:** every byte of
`GameState` is plain TS data + pure reducers; the only sim contact is *reading* the existing once-per-frame
`electricalMap`/`snap.state`. The grader and notebook detectors are samplers over that already-batched,
unhashed output — never a new wasm crossing, never a netlist/`snapshot_hash` touch.

---

## 7. Reuse vs new surface

| | Surface | File / symbol | Role |
| --- | --- | --- | --- |
| **REUSE** | `PARTS` `tier` tag | `App.svelte:186` | demoted to a coarse era-bucket *hint*; the `tag` string is the join key to `TechNode.unlocksTags`. No new PARTS field. |
| **REUSE** | bin render + placement choke points | `App.svelte` `familyGroups` / `partRow` / `arm` / `toggleArm` | add the `$unlockedTags.has(part.tag)` check → `is-locked` class + lock badge + click-opens-unlock-card |
| **REUSE** | grader/detector data source | `netlist.ts:1822` `electricalMap` (+ `:809` `nodesOfComponent`, `:799` `elemOfComponent`, `:833` `nodeNames`) | the grader's entire input + pin/branch address book, resolved at grade time |
| **REUSE** | topology oracle | `netlist.ts:1811` `graphShape` | the value-aware grader sits **beside** it; never flips `complete` |
| **REUSE** | snapshot history ring | `web/src/sim/loop.ts` `Snapshot{state, elementCurrents?, failedMask?}` (the latter two **optional**) | the grader's input + the SHIP-IT cascade substrate; no new crossing |
| **REUSE** | persistence discipline | `storage.ts:156/:169/:183/:199` `loadSettings`/`saveSettings`/`resetAll`/`makeDebouncedBoardSaver` + `:69` `BoardBlob` | cloned into the sibling `cec.game.v1` key + the optional `BoardBlob.contract` field |
| **REUSE** | fire-once dedup | `storage.ts:37` `Settings.seenConcepts` + the `SvelteSet` | the shape `claimedLux` and `RevealState.fired` copy |
| **REUSE** | tutorial → earning seam | `examples.ts` `ExampleSpec` + do/why/done Build engine | add optional `issuesContract?: string`; `build()` doubles as `buildReference` |
| **NEW** (design by teaching panels) | seeded generator + value-aware specMet | specced in `probe-teaching-arc.md` §3a/§3b — **not yet built** | *implemented* (not forked) as `contracts.ts` `generate`/`grade`, generalized to `SpecLine[]` |
| **REUSE** | param-on-existing-element trick | CLAUDE.md PULSE→ELEM_ACSOURCE / SHUNT→ELEM_RESISTOR | the judgement part's tick-pure stimulus — no new sim element |
| **REUSE** | SHIP-IT choreography | `loop.ts` scrubber + ghost-replay ring | the count-up hosts `currency:credits`; pure presentation |
| **REUSE** | segmented-LED bar | `board.ts` `voltageColor` / `docs/ui/visual-language.md` | the Standing 0..100 bar reads pre-attentively like a rail magnitude |
| **NEW** | tree + gating | `econ/progression.ts` + `econ/data/techtree.ts` | `NODES` + `nodeState`/`canUnlock`/`unlockedTags`/`unlockNode` |
| **NEW** | currency stores | `econ/economy.ts` + `econ/data/balance.ts` | `Wallet` + `applyEarn`/`spend*` + the BASE/multiplier table |
| **NEW** | contract module | `econ/contracts.ts` + `econ/templates/{fixedRail,rcTiming}.ts` | template/instance + generator + grader + FSM |
| **NEW** | Lab Notebook | `econ/labNotebook.ts` | phenomenon detectors over the snapshot + eureka write (distinct from `codex.ts`) |
| **NEW** | reveal engine | `econ/reveal.ts` | `RevealState` + `maybeReveal` + drain loop |
| **NEW** | store glue | `econ/gameState.svelte.ts` | `$state GameState` + `$derived` gates |
| **NEW** | persistence | `storage.ts` `cec.game.v1` (+ `BoardBlob.contract?`) | `loadGameState`/`saveGameState`; `resetAll` clears it |
| **NEW** | UI | a `TechTreePanel.svelte`, the `OfferCard` margin UI, the three HUD chips, lock-badge styling in `app.css`, one `'JP'` `PARTS`/`PART_KINDS` entry | the only UI additions |
| **NEW** | tests | `econ/*.test.ts` (vitest) | seed→same contract→same grade; in-ratio passes / copied-wrong-rail fails; firewall (no Credits→Lux); gating purity |

---

## 8. Determinism & golden-safety statement

> **Every byte of the economy/progression/contract/notebook spine is web-side game-state. It NEVER touches
> `crates/sim-core`, `buildNetlist` emission, the netlist, or `snapshot_hash`.** `cargo test -p sim-core`
> (incl. `run_is_reproducible`) is bit-identical and untouched — no Rust change.
>
> The grader, phenomenon detectors, and prediction check read **only** the already-batched, **unhashed**
> once-per-frame outputs (`Snapshot.state` node voltages + `Snapshot.elementCurrents` branch currents +
> `failedMask`, surfaced through `electricalMap`) — `failed_elements` and `acMeasurements` are already
> excluded from `snapshot_hash` per CLAUDE.md. The **JS↔wasm boundary stays coarse** (golden rule #2): the
> grader samples the player board's **existing** history ring; the satisfiability check runs on a **separate
> offscreen scratch `Simulation`** at generate time (its own throwaway history, its own `snapshot_hash` never
> compared to the golden). Neither adds any per-line, per-contract, or per-component crossing beyond the
> once-per-frame batch.
>
> The judgement part is a **real tick-pure fixture** reusing the PULSE/SHUNT param-on-existing-element
> trick — it hashes like any element (a board with a JP replays byte-identically; only cross-board
> comparison of a contract board vs a bare board is meaningless, which is fine and documented in the
> determinism contract). The per-attempt seed is a **web-side `mulberry32`** off a string-hashed contract
> id; it **never** reaches the fixed `SEED=1337` and never enters `snapshot_hash` — a randomized component
> *value* crosses the boundary exactly as any ordinary component value already does, so each player's run is
> internally deterministic.
>
> The value-aware grader is **strictly additive** beside `graphShape`/`complete` and gates **only** the
> contract ship — every existing topology-only example stays bit-for-bit unaffected (locked by a vitest
> case). Gating is a **placement-UI filter** (which PARTS rows are armable), **not** a solve filter: a board
> that already contains a part (loaded from a save, or the golden circuit) solves identically regardless of
> unlock state.
>
> Persistence degrades gracefully exactly like `storage.ts`: a corrupt/stale `cec.game.v1` blob resets to a
> fresh `GameState` rather than throwing, and lives in its **own** versioned key so an economy bump can't
> break the board and a board/Settings bump can't wipe economy progress. The firewall (no Credits→Lux, Lux
> one-time, per-seed decay) is **data-enforced and proven by a test**, not documented by slogan. SPDX
> `// SPDX-License-Identifier: Apache-2.0` header on every new `.ts`/`.svelte` file.

---

## 9. MVP & phased build path

**The smallest fun slice is ONE end-to-end loop, not one system:** pull a parametric divider contract (the
same 3.3 V-from-5 V the Probe arc lands on) → build on the continuous sandbox board → press Ship → the
value-aware `SpecLine[]` grader samples the existing replay at the judgement part's pins → SHIP-IT + Credits
count-up → Credits open the next bin shelf → re-roll a fresh seed. Each phase is **independently shippable
and additive.** ([`game-contracts-economy.md`] §6: ship a *generator*, not a hand-list.)

| Phase | Ships | Proves |
| --- | --- | --- |
| **P0** | `grader.ts` generalizing the probe-arc specMet + the SHIP-IT count-up on the existing divider (one template, one judgement part; may use **one fixed seed** to de-risk the grader) | the loop is fun |
| **P1** | `generate.ts` seeded θ + satisfiability check for **2 templates** (fixedRail + rcTiming) | honest parametric supply |
| **P2** | `techtree.ts` DAG + bin grey-gating + the first **Lux** event + `unlockNode` of one node | the tree moves; the firewall exists |
| **P3** | `OfferQueue` store + difficulty band + per-seed `decay` | endless curriculum + anti-grind |
| **P4** | `labNotebook.ts` (~4 detectors: rectification, ripple, brownout, latch) + eureka discounts | tinkerer economy |
| **P5** | standing scheduler + bonus-tier multipliers + (greyed) CEC-Certified | the long game |

**Build checklist (P0–P2 = the first shippable slice):**

- [ ] `econ/state.ts` — `GameState` + `DEFAULT_GAME` + `GAME_VERSION` + pure reducers (vitest: reducers pure).
- [ ] `storage.ts` — `cec.game.v1` sibling key + `loadGameState`/`saveGameState`; `resetAll` clears it; `BoardBlob.contract?`.
- [ ] `econ/grader.ts` — `grade(spec, history, maps, padToComponent)` (vitest: in-ratio divider **passes**, copied-values-into-wrong-rail **fails**).
- [ ] `'JP'` judgement part — `PARTS` + `PART_KINDS` entry, named pins, PULSE/SHUNT stimulus (vitest: JP board replays bit-identically).
- [ ] SHIP-IT beat over `loop.ts` scrubber + the Credits count-up.
- [ ] `econ/economy.ts` — `applyEarn`/`spend*` + `data/balance.ts` (vitest: seed→same payout, decay floors at 0.1, `claimedLux` dedups Lux to 0, **no** Credits→Lux path).
- [ ] `econ/contracts.ts` + `templates/{fixedRail,rcTiming}.ts` + `generate` with K=8 satisfiability (vitest: seed→same instance→same grade).
- [ ] `econ/data/techtree.ts` `NODES` + `econ/progression.ts` gating (vitest: every PARTS tag in exactly one node's `unlocksTags` or an Era0 tag; `canUnlock` enforces prereqs+Lux+exam).
- [ ] `econ/gameState.svelte.ts` `$state` + `$derived unlockedTags` wired into `App.svelte` bin (`is-locked` class + lock badge + click→unlock-card).
- [ ] `econ/reveal.ts` + `OfferCard` margin UI; `ExampleSpec.issuesContract?` seam.

---

## 10. Open questions / owner hand-offs

1. **All balance numbers are illustrative.** BASE payouts, the realism ladder (1.0/1.6/2.2), the
   elegance/par curve, the margin split, standing deltas, license Lux/Credit costs, and per-era difficulty
   ceilings need one owner sign-off pass. Ship them in **one editable table** (`data/balance.ts`) so tuning
   is a single file, never a re-architecture.
2. **Standing as third resource — confirm the model.** Per-customer reputation `Record<CustomerId, number>`
   (richer, needs a customer registry) vs one global scalar for MVP? **Recommend one global scalar at MVP**,
   refactor to per-customer when named customers ship. It is a *gauge*, never a spendable currency
   ([`game-progression.md`] §7.4).
3. **Can a pure tinkerer climb the tree on Lux+eureka alone, or do late eras require *delivered* standing
   contracts** (a `requiresStanding` floor on `TechNode`)? **Recommend default OFF** (tinkerer can climb);
   keep the field optional so the owner can flip it per node. Affects whether `canUnlock` reads
   `contractLog`/`standingRuns`.
4. **Eureka discount sizing.** Pre-pass the exam entirely (`examWaived`) vs only cheapen the Lux price
   (`luxPct`)? The data model supports both per node; **recommend `examWaived` for the first eureka** (to
   teach the mechanic), leave the Lux price. Needs a telemetry pass ([`game-progression.md`] §7.3).
5. **Competency-exam friction.** Mandatory exam per gated era, or Era1/3a/3b unlock on Lux+eureka alone to
   keep the sandbox-first feel? `examTemplateId` is optional per node, so both are supported — owner picks
   which eras carry one ([`game-progression.md`] §7.2).
6. **First-Lux source at the 4:00 beat.** Predict-then-reveal (`predict:rc-rise`) vs first-concept
   (`concept:divider`)? Both *can* fire (distinct ids), but the opener fires exactly one — **recommend
   `predict:rc-rise`** (strongest understanding reward, avoids a double-pop).
7. **Persistence key.** Sibling `cec.game.v1` (recommended) vs an `economy?` field inside `Settings` with a
   `SETTINGS_VERSION 1→2` migration. **Recommend sibling** (independent bumps); owner sign-off.
8. **CEC-Certified tier** depends on the deferred Monte-Carlo/worst-case sweep bench service — **grey it at
   MVP**, ship Bronze/Silver/Gold first, or stub a single-corner sweep?
9. **Standing-contract pacing** vs the fixed 2 µs tick grid: real-seconds-per-payout, and whether any idle
   income accrues while a board isn't the focused sim (background-tick budget vs only-while-focused).
   Prototype-driven; **MVP ships only-while-focused** (defer to P5).
10. **Frequency-domain grading.** Filter/oscillator templates want an AC-sweep amplitude-ratio verb the
    time-domain grader can't express off the 2 µs transient stream — park behind Era 4+, feed from the
    existing analytic `ac_solve`/Bode + `phaseScope.ts` as a later grader input. MVP (fixedRail + rcTiming)
    is pure time-domain, so deferrable.
11. **PinAddr / pad UI primitive.** Confirm the judgement part exposes named pads (OUT/LOAD/RAIL/SENSE/GND)
    the player wires to, and that spec lines address those pads by name (reusing the net-label surface)
    rather than guessing the player's topology. Confirm ONE generic fixture covers fixedRail + rcTiming for
    MVP, or whether a small per-family set is needed.
12. **Era5 split ordering.** Two sub-nodes (`era5a-logic` before `era5b-mixed`, recommended for golden-churn
    safety — the integer-exact logic library ships first) vs one node with staged `unlocksTags`. **Recommend
    two sub-nodes** (the DAG above already models this).
13. **Reveal-Engine generalization scope.** Fold the existing concept-card `maybeShowConcept` *into*
    `econ/reveal.ts` (one drain loop guarantees one-per-frame across both systems) vs keep them parallel and
    share only the pattern? **Recommend folding**, but it touches existing onboarding code — owner sign-off.
14. **Notebook MVP scope + a determinism review** of any detector reading `node_v`: confirm the first ~4
    phenomena (rectification, ripple, brownout, latch) and that every detector reads the unhashed replay
    only, never writes the BoardGraph/netlist.
15. **Blueprint determinism** (a saved parameterized sub-circuit must replay bit-identically when stamped):
    store a `GraphSnapshot` fragment re-flattened by `buildNetlist` at stamp time (inherits determinism) vs
    a frozen netlist. Fold into the determinism contract before shipping the Credit-sink automation.
    Post-MVP.

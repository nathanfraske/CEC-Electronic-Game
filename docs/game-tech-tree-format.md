<!--
  SPDX-License-Identifier: Apache-2.0
-->

# The Tech Tree — format & categorization

**The owner asked two questions:** *How should the Tech Tree be formatted? How should it be categorized?* This doc answers both, concretely, and recommends **one** format and **one** categorization.

It designs the **presentation** of the DAG, not the data model. The node schema (`TechNode` — `id / era / primitive / requires / unlocksTags / **unlocksFidelity** / unlocksTemplates / luxPrice / creditsAfford / examTemplateId / eureka`), the era-by-era unlock table, the three-state derivation (`locked | available | owned`), and the grey-shelf bin integration all already exist in [`game-economy-progression-implementation.md`] **§2** (`unlocksFidelity` is the Real-mode-toggle flag introduced in §2.2 for `era1-tolerances`). This panel **renders that DAG**. It is **golden-safe by construction** — web-side UI over existing authored data, no sim-core change, no JS↔wasm boundary change (§5).

> **What the format needs vs. the DAG as it stands (resolves the one data-model tension).** The authoritative DAG (impl §2.2) is **exactly 10 `TechNode` rows with ZERO AC nodes**. This panel adds **no new `TechNode`s**: the **AC side-rail is a RENDER overlay** drawn from `EXAMPLE_CATEGORIES`'s AC tail *inside the existing DC stations* (E0 AC source · E1 reactance via passives · E2 rectification via diodes · E4 transformers) — it is "build here" decoration, **not** new graph nodes. The only optional new field is the cosmetic `TechNode.domains?` (§7, an owner hand-off — not silently added).

**House position (don't relitigate):** the tree is a **journey-map + an OFFER**, never a forced gate. The bench is always available; locked parts are *pullable*, not walls ([`game-economy-progression-implementation.md`] §2.4). The format below is built to make that pull legible from minute 0.

---

## 0. Thesis — and the relationship to the economy / progression docs

> **One sentence:** *The Tech Tree is the [greyed bin zoomed out and made navigable] — a horizontal era spine you can walk into, coloured by the parts bin's own domains, that renders the existing `TechNode` DAG and adds no new taxonomy, no new state, and no data-model change.*

This doc is **presentation only**. It sits downstream of three authored artifacts and invents none of them:

| Upstream doc | What it owns | What this doc does with it |
| --- | --- | --- |
| [`game-economy-progression-implementation.md`] §2 | the `TechNode` DAG **data model** (`id/era/primitive/requires/unlocksTags/unlocksTemplates/luxPrice/creditsAfford/examTemplateId/eureka`), the era-by-era unlock table (§2.2), `nodeState`/`canUnlock`/`unlockedTags` derivations (§2.1/§2.3), the grey-shelf bin integration (§2.4) | **renders** it — the format keys every visual on those derivations and adds none |
| [`game-progression.md`] §2 / §6 | the era spine, the dependency graph, the three progression **axes** (breadth/depth/understanding), the AC parallel track | **lays it out** as the subway spine + AC side-rail |
| [`game-lux-and-lab-book.md`] | the **Lux faucet + Lab Book**, the *understanding-only* firewall, the eureka discounts | **surfaces** it — the unlock card's price/eureka shortcut is the SPEND end of that faucet |

**The economy contract this presentation must honour** (from [`game-lux-and-lab-book.md`] §1): **Credits buy BREADTH (a bigger sandbox); Lux buys DEPTH (the gate to the next era of physics); Lux comes ONLY from understanding.** The tree is where Lux is *spent*. So the format's job is to make the next Lux pull legible **and** to keep pointing the player back at the bench (where understanding — and therefore Lux — is earned), never at a grind. Every design choice below serves that: the single rose-pulse "do this next," the eureka-shortcut on the card, the eureka tag surfaced on locked shelves ahead.

**This is NOT a data-model change.** No new `TechNode` field is required to ship the recommendation. Every axis is an existing taxonomy (the era table, the bin's `PART_CATEGORIES`, the P1–P8 primitives, `EXAMPLE_CATEGORIES`, `PART_SYNONYMS`). One optional cosmetic field (`TechNode.domains?`) is flagged in §7 as an **owner hand-off**, not silently added.

### 0.1 TL;DR — the recommendation

> **FORMAT:** a **hybrid era-column journey-map** — a horizontal **subway/era spine** (Era 0 → 7, left to right) where each era is a *station*; expanding a station drops into a **DAG sub-graph** of that era's nodes. The *same widget*, at its most zoomed-out, **is** the greyed bin's section-header strip, so the bin and the tree are one continuous artifact (the bin is the tree's "ground floor"). [the subway map you can walk into]
>
> **CATEGORIZATION:** a **2-D scheme — ERA (the spine, primary ordering axis) × DOMAIN (the existing 7 `PART_CATEGORIES`, the secondary swim-lane axis)**, with **PRIMITIVE (P1–P8) as a node-level badge**, not an organizing axis. This *reuses both existing taxonomies verbatim* (the PARTS `PART_CATEGORIES` and the era table) instead of inventing a third.

The rest of the doc justifies and specifies this. The rejected alternatives are in §1.1 (format) and §2.4 (categorization).

### 0.2 The reconciliation constraint (read before §1)

There are **already three orderings** in the codebase. A new tech-tree taxonomy must *reconcile* with all three, not replace them:

| Existing ordering | Where | Shape | Role for the tree |
| --- | --- | --- | --- |
| **`PART_CATEGORIES`** (7) | `App.svelte:696` | DOMAIN buckets: Sources, Passives, Diodes, Protection, Active & Switching, Logic & ICs, IC Frames | the tree's **swim-lane / colour axis** — keep verbatim |
| **The era spine** (0–7) | [`game-progression.md`] §2/§6; impl §2.2 | a DAG by **capability** (P1–P8 unlocks) | the tree's **primary left→right axis** — keep verbatim |
| **`EXAMPLE_CATEGORIES`** (14) | `examples.ts` | the **examples ladder** (a teaching order) | the tree's **"what to build here" rail** per era — map onto it, do not duplicate |

**The two owner calls fall straight out of this:**

1. **AC is a parallel side-rail** (offered, not the main DC ramp). In `EXAMPLE_CATEGORIES` the AC block — *AC Fundamentals → Reactance → Filters → Resonance → Rectification → Transformers* — sits as a **contiguous tail after the DC ladder**, not interleaved. The tree mirrors this: a **second spine below the main DC era spine**, fed from Era 1 (you need passives) and Era 2 (rectification needs diodes), running in parallel. It is **enterable but never on the critical path** to Era 7. (Concretely: AC nodes `require` DC nodes but *nothing requires them back* — a true side-rail, matching `TR`/`transformer` already living in **Passives** + Era 4, and the AC source being an Era-0 part.)

2. **"Logic from Transistors" precedes "Logic & ICs".** This is *already* the shape: Era 4 (the Active Tier — BJT/MOSFET, the keystone) is a hard prerequisite of Era 5a (the logic library). The example ladder says it twice (`Logic from Transistors` then `Logic & ICs`), and the DAG edge `era5a-logic.requires = [era4-active-tier]` enforces it. The tree must **show this edge prominently** — it is the single most pedagogically load-bearing arrow in the graph (you *earn* the gate by building logic out of transistors first). See §2.3.

---

## 1. The FORMAT — the hybrid era-column journey-map

### 1.1 The layout metaphor — comparing the four candidates

Four metaphors were on the table. They are judged **purely** on which renders the *existing* `TechNode` DAG most legibly, makes the greyed journey-map readable from minute 0, and fits the dark bench-instrument HUD.

| Metaphor | What it is | Renders the climb? | Shows parallelism (3a∥3b, AC)? | Minute-0 journey-map? | HUD fit | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **Pure node-graph DAG** (Civ/PoE free-pan) | every `TechNode` on one canvas, all edges drawn | yes but buried | yes but unreadable | a *wall* at ~30 nodes + chips | needs its own taxonomy | **reject as primary** — keep SCOPED to one expanded era |
| **Pure era-column timeline** (eras stacked, one row each) | strict top-to-bottom checklist | yes (linear only) | **no** — flattens the 3a∥3b fork + the AC side-rail | yes, but a checklist not a map | loses the swim-lanes | **reject** — degrades a map into a list |
| **Pure shelves/aisles bench-store** | parts on aisles by domain, era = "back of store" | **no** — domain-primary scrambles dependency reading | partial | partial | this is the *bin's* metaphor | **reject for the tree** — right for the BIN, wrong for the TREE |
| **HYBRID — era spine + per-era DAG** | a subway spine (eras = stations); a station expands into its DAG | **yes** (era left→right = `requires` order) | **yes** (3a∥3b branch boxes; AC cyan side-rail) | **yes** (whole future greyed, minute 0) | calm, one-glow | **RECOMMEND** |

**Why the hybrid wins.** It is the *only* metaphor that simultaneously shows the **climb** (era left-to-right = the `requires` order), the **parallelism** (3a∥3b; the AC side-rail), the **whole journey greyed from minute 0** (the tree IS the progress bar), **and** reuses the bin verbatim as its ground floor — so we ship **zero new taxonomy** and **zero second greying/search system**. The pure DAG is kept, but *scoped* to one expanded era (it is exactly right at that scale and a wall at full scale). The pure column and the pure shelves each lose one of the two structural truths the DAG encodes.

- **Zoomed out (the default, the "you-are-here" view):** a **horizontal era spine** — Era 0 ▸ 1 ▸ 2 ▸ {3a ∥ 3b} ▸ 4 ▸ {5a ▸ 5b} ▸ 6 ▸ 7 — drawn as a **subway line**: stations (eras) connected by the critical-path edge, with the **AC side-rail** as a second cyan dashed line branching off below. This is a **journey-map**: owned eras are lit, the available one pulses, locked ones are greyed-but-present. You read your whole future in one glance, minute 0.

- **Zoomed in (click a station):** the station **expands in place** into the **DAG sub-graph of that era's nodes** — the individual `TechNode`s, their intra-era `requires` edges, and the **part chips** each node unlocks. This is where the node-graph DAG lives: small, scoped to one era, never the whole thing at once.

- **The bin IS the ground floor.** The greyed bin (impl §2.4, **specced — not yet built**) renders era-ordered shelves with lock badges. **The tree panel is that same strip, promoted to full-screen and made navigable.** No second taxonomy: the bin's `Era 0 · First Light` header *is* the tree's Era-0 station. Opening the tree is "zoom out from the shelf you're standing at." This is the core move that keeps us from inventing a third tree.

### 1.2 Three levels of detail (LOD)

Zoom ramps between three levels — the IC-glyph five-tier instinct, but only three here:

| LOD | What it shows | Mirrors |
| --- | --- | --- |
| **LOD 1 — spine** | the whole era spine + AC side-rail; you-are-here | the journey-map / progress bar |
| **LOD 2 — station** | one era expanded in place into its DAG sub-graph (nodes + intra-era edges + the part chips each node arms) | the per-era node-graph |
| **LOD 3 — chip** | a part chip → the bin / inspector detail for that part | the bin |

Default focus is the **available (pulsing)** era, centred. LOD 2 is always **scoped to one era** — this is the structural guard that keeps the per-era DAG from regressing into the rejected full-canvas wall (E5a logic alone is ~20 tags; lean on `familyGroups` to collapse gate families inside the station).

### 1.3 The node states (the unit of the tree)

The node is the unit. Its appearance is a **pure derivation** of `nodeState(n, gs)` (impl §2.1) — never stored. Identity (domain) lives on the **HUE**; state (owned/available/locked) lives on a **separate channel** (the ring / pulse / grey) — mirroring the power-bus visual-language rule (colour = identity, not magnitude).

| State | Look (dark bench-HUD) | Interaction |
| --- | --- | --- |
| **owned** | full-saturation domain-colour fill; thin `--ok` ring; era badge solid; part chips armable | click → jump bin to its parts |
| **available** | outline-only in the domain colour; **`--accent` rose pulse** glow (the one pre-attentive "do this next"); Lux/exam cost shown | click → **unlock card** (§1.4) |
| **locked** | greyed (`--dim` on `--surface-2`); faint era badge; **dependency edges dashed**; Lux lock badge `◇N` | click → unlock card, *but* opens **scrolled to the unmet prereq** ("first: own Era 4") — the pull points *backward up its own chain*, never a silent no-op |

This is the **greyed-locked journey-map**: every node visible from minute 0, locked ones legible as "later, here's the path." It will share the bin's `is-locked` class (impl §2.4, **to be built**) — same greying, same lock badge — so the tree and the bin are one visual system, not two.

**Node-state quick-read (the three looks at a glance):**

```
  OWNED      = solid domain fill + green --ok ring        (a lit station)
  AVAILABLE  = hollow domain outline + rose --accent pulse (the one thing breathing)
  LOCKED     = grey --dim, dashed edges, ◇N lux badge      (a station you can see, not yet board)
```

### 1.4 The unlock card — the OFFER

The card is the **OFFER** (never a forced modal — a dismissable peek; the bench stays live behind it). It is the expanded-station body lifted into a floating panel when reached from the bin instead of the tree — *one component, two entry points*. In CEC voice it names:

| Part | Content | Token / source |
| --- | --- | --- |
| **the lift** | primitive badge + one-line blurb (`P1 · one-way streets — the Newton loop you already paid for now bites`) | `node.primitive`, authored blurb |
| **the price** | `luxPrice` (post-eureka, **struck-through** if discounted); `creditsAfford` shown as **HELD, not spent**; the exam chip if `examTemplateId` set | IBM Plex Mono telemetry |
| **the affordance readout** | "you have: 4 Lux · 200₵" with a ✓/✗ | `gs.money` |
| **the eureka shortcut** | "demonstrate `ripple` in the sandbox → −50% Lux / waive exam" — a **pull toward the bench**, the house's anti-grind hook | `node.eureka`, [`game-lux-and-lab-book.md`] |
| **the payload** | the part chips it arms (domain-tinted) + the contract templates it offers (`unlocksTemplates`) + the `EXAMPLE_CATEGORIES` "build here" list | `unlocksTags`, `unlocksTemplates` |
| **the button** | **[ UNLOCK · N Lux ]**, enabled iff `canUnlock(n, gs).ok`; else the button **names the gap** ("need 1 more Lux", "pass Rectifier exam") | `canUnlock(n, gs)` |

The card **never says no.** When unaffordable it says *here is what stands between you and this, and here is the bench-shaped way to close it.*

### 1.5 Navigation & "you-are-here"

- **Default focus** = the **available** era (the pulsing station), centred. A `[◎ you-are-here]` button re-centres there from anywhere.
- **Zoom** = scroll/pinch ramps the three LODs (§1.2).
- **Pan** = horizontal drag along the spine; the AC side-rail tracks below.
- **Search** (`⌕`) **reuses the bin's `PART_SYNONYMS`** (`App.svelte:857`) — typing "rectifier" highlights the Era-2 station and the `D` chip and jumps you there. *Same index as the bin* — no second one.
- **Breadcrumb**: the panel header always reads `ERA 2 · DIODE AGE` so you never lose altitude.
- **Path-to-a-goal**: hovering/pinning a **locked** node lights its full `requires`-chain back along the spine as a brighter **rose-dashed trail** (the route you must climb) — so the player sees exactly which stations stand between here and the goal. The pull always points backward up its own chain.

### 1.6 The greyed journey-map from minute 0

Every node is visible at first paint; locked ones are legible as "later, here is the path." The bin **already** renders era-ordered shelves with lock badges (impl §2.4); the tree panel **is** that strip promoted to full-screen and made navigable — the bin's `Era 0 · First Light` header is the tree's E0 station. The whole future reads in one glance. **The tree is the progress bar.**

Hard experience invariant: **you can win the early game without ever opening the tree.** The bench runs from second one; the greyed bin shelves are the tree's ground floor, so the journey is a visible parts-catalogue teaser from minute 0 without a single tree click. The dedicated tree is the *optional* zoomed-out view of that same strip — a button you may press, not a screen you must clear.

### 1.7 ASCII mock — the zoomed-out spine (the journey-map, readable minute 0)

```
┌─ TECH TREE ───────────────────────────────────────  [⌕ search]  [you-are-here ◎] ─┐
│                                                                                     │
│  DC SPINE  (the main ramp — climb it to seal your own chips)                        │
│                                                                                     │
│   ◉━━━━━◉━━━━━◉━━━━━┳━━━◉━━━━━┳━━◉━━━◉━━━━━◯╌╌╌╌╌◯                                   │
│   E0    E1    E2    ┃   E4    ┃  E5a  E5b   E6    E7                                 │
│  First  Toler Diode ┃  ACTIVE ┃ Logic Mixed Rules FPGA                              │
│  Light  -ances Age  ┃  TIER★  ┃                                                     │
│  OWNED  OWNED  ▸AVL ┃ locked  ┃ locked locked    locked                            │
│                ┃    ┃         ┃                                                     │
│           ┌────┺─┐ ┌┺──────┐  ┃   ▲ the keystone edge: E4 ─▶ E5a                    │
│           │ E3a  │ │ E3b   │  ┃     "Logic FROM Transistors" before "Logic & ICs"   │
│           │HandsOn││Domains│  ┃                                                     │
│           │ ◯ ◇2 │ │ ◯ ◇2  │  ┃     (both 3a∥3b feed E4 — all-of join)             │
│           └──────┘ └───────┘  ┃                                                     │
│                                                                                     │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  AC SIDE-RAIL  (parallel — offered, never required to reach E7)                     │
│                                                                                     │
│       ┌╌╌E1╌╌╌▶ ◯╌╌╌╌╌◯╌╌╌╌╌◯╌╌╌╌╌◯╌╌╌╌╌◯╌╌╌╌╌◯                                     │
│                AC-Fund React. Filters Reson. Rectif. Xfmr                           │
│                (feeds from E1 passives; Rectif. also needs E2 diodes)               │
└─────────────────────────────────────────────────────────────────────────────────┘

  ◉ owned   ▸◯ available (pulsing)   ◯ locked   ◇N = Lux price   ★ keystone   ┃ all-of join
```

### 1.8 ASCII mock — a station expanded (LOD 2: the per-era DAG + unlock-card body)

```
┌─ ERA 2 · THE DIODE AGE ───────────────────────  ◇3 + Rectifier exam  [×] ─┐
│  P1 · piecewise i(v)  ·  requires: Era 1  ·  blurb:                         │
│  "One-way streets. The Newton loop you already paid for now bites."        │
│                                                                            │
│   ┌──────────────────────────────────────────────────────────────────┐    │
│   │  this node unlocks (part chips, domain-tinted):                   │    │
│   │   ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                              │    │
│   │   │ D  │ │ SD │ │LED │ │ ZD │ │MOV │   ← Diodes / Protection lanes │    │
│   │   └────┘ └────┘ └────┘ └────┘ └────┘                              │    │
│   └──────────────────────────────────────────────────────────────────┘    │
│                                                                            │
│   BUILD HERE (from EXAMPLE_CATEGORIES · "Diodes"):                          │
│     › diode-clamp   › led-limit   › schottky-vs-silicon   › zener-shunt     │
│                                                                            │
│   EUREKA: demonstrate `rectification` in the sandbox → waive the exam.      │
│                                                                            │
│   [ UNLOCK · 3 Lux ]   (hold 120₵)        ◇ you have: 4 Lux · 200₵ ✓        │
└────────────────────────────────────────────────────────────────────────────┘
```

### 1.9 Fit to the dark bench-instrument HUD

Use the tokens (`app.css`), never hardcode (CLAUDE.md design-system rule). The target texture: **a calm map where exactly one thing breathes.**

- **Surfaces:** spine on `--bg` (oklch .135 .022 285); stations on `--surface-2`; the expanded-station panel one layer up. Faint grid motif behind the spine (the "schematic graph paper" already in `board.ts`).
- **The spine line:** owned segments in `--ok` green; the next-edge to the available station in `--accent` rose (the single pulsing "go here"); locked segments `--dim`. The **AC side-rail line** in `--cyan`, **dashed** (it reads as "the other domain — optional").
- **Node fill = its domain colour** (§2.2) so a glance reads *what kind of thing* this era hands you. Identity on hue; state (owned/avail/locked) on the separate ring/pulse/grey channel — the power-bus rule.
- **Type:** `Saira Condensed` uppercase tracked for era/station labels (`THE DIODE AGE`); `IBM Plex Mono` for telemetry (`◇3`, `120₵`, Lux counts, the diamond-N badge); `Saira` for blurb copy.
- **Radii** 2–4px; neon glow **only** on the available node — the HUD stays calm, one thing glows (`led-breathe` on the available node, everything else steady-state readout).

---

## 2. The CATEGORIZATION — Era × Domain, Primitive as a badge

### 2.1 The recommended scheme

**Primary axis = ERA** (the left→right spine, the climb). **Secondary axis = DOMAIN** (the existing 7 `PART_CATEGORIES`, as node fill-colour and as the swim-lane a part chip lives in). **Primitive (P1–P8) = a node badge**, the "what capability this lifts" stamp, *not* an organizing axis.

Why these roles:

- **Era as primary** because the tree's *job* is to show a climb of "more reality" ([`game-progression.md`] thesis). Era is the dependency order; it is what `requires` edges encode; it is what the player advances through. Era row order **IS** the precedence — it makes "Logic from Transistors" (E4 build list) precede "Logic & ICs" (E5a) *for free* via the `era5a-logic.requires=[era4]` edge.
- **Domain as the colour/lane** because it is the taxonomy the player **already knows from the bin** (`PART_CATEGORIES`). Reusing it makes the tree and bin one mental model. It answers "what *kind* of thing is this era about" at a glance.
- **Primitive as a badge, not an axis**, because P1–P8 are an *engineering-cost* taxonomy (which sim machinery each lift costs — the Newton loop, controlled sources, mutual coupling), which is exactly right as a teaching stamp on a node but **wrong as a shelf** — players don't think "I want a P4 today." It earns a small `P4` chip on the node and a tooltip ("controlled source — the op-amp's trick"). The canonical P1–P8 definitions are impl §2.2 (L146–153).

**Why a 2-D scheme (and not any of the 1-D candidates)** — see §2.4.

### 2.2 The domain → colour map (reuse the bin's, verbatim)

The 7 `PART_CATEGORIES` become the 7 lane/fill colours. Reuse the *part colours already chosen in `PARTS`* so chips match the bin exactly:

| Domain (`PART_CATEGORIES`) | Lane colour (existing token) | Lives in eras |
| --- | --- | --- |
| **Sources** | `--warn` / `--accent` (V/AC) | E0 (+ AC source feeds the side-rail) |
| **Passives** | `--bronze` (R), `--cyan` (C), `--violet` (L) | E0, **E1** (real grades), side-rail (TR) |
| **Diodes** | `--warn` / `--accent` (LED) | **E2** |
| **Protection** | `--warn` (MOV) | E2 |
| **Active & Switching** | `--ok` (FETs), `--accent` (BJT), `--cyan` (OA) | **E3a** (SW), **E4** (the keystone) |
| **Logic & ICs** | `--ok` (gates), `--cyan` (seq), `--violet` (mixed/uC) | **E5a/E5b**, E7 (LUT/FPGA) |
| **IC Frames** | `--border` (neutral) | the IC-maker, a sandbox tool — sits *beside* the spine (a docked tool-shelf), lit at E7 |

(The existing `PART_CATEGORIES` has **no "Mechanical" or "Sensing" lane** — switches live in *Active & Switching*, thermistors in *Passives*. The tree **keeps that**; it does not invent the passives/active/diodes/logic/mixed/power/mechanical/sensing list the prompt floated. The *era* axis already separates hands-on (E3a) from second-domains (E3b) where the pedagogy needs it, so domain doesn't have to.)

**Verified note for the owner:** `App.svelte:696` lists **7** categories (including `IC Frames`); `codex.ts:38` mirrors only **6** (drops `IC Frames`). The **bin renderer (`App.svelte`) is canonical** for what the player sees, so the 7-domain count here is correct. The two lists are out of sync in the codebase — **flagged in §7, not silently resolved.**

### 2.3 The full Era × Domain grid (every node placed)

This is the categorization made concrete — every `TechNode` from impl §2.2, placed at its (era, domain) cell. **Reads exactly as the existing era table; the columns are the existing `PART_CATEGORIES`.**

| Era ↓ \ Domain → | Sources | Passives | Diodes | Protect | Active&Sw | Logic&ICs |
| --- | --- | --- | --- | --- | --- | --- |
| **E0** First Light | V·AC·PULSE·I·GND | R·C·L | — | — | LOAD | — |
| **E1** Tolerances `[P2]` | — | *real R/EC* | — | — | — | — |
| **E2** Diode Age `[P1]` | — | — | D·SD·LED·ZD | MOV | — | — |
| **E3a** Hands On `[P6]` | — | POT | — | — | SW·MSW | — |
| **E3b** 2nd Domains `[P7·P8]` | — | NTC·PTC | — | — | — | — |
| **E4** ★Active Tier `[P3·P4·P5]` | SHUNT | TR | — | — | Q·QP·NM·PM·OA·CMP·ASW | — |
| **E5a** Logic | — | — | — | — | — | AND…XNOR·NOT·BUF·FF·SRL·DLATCH·JKFF·HADD·FADD·MUX2·DMUX·MAJ3·CTR |
| **E5b** Mixed | — | — | — | — | — | ADC·DAC·SAR·SDM·SPIM·SPIS·UART·uC |
| **E6** Design Rules | *(no parts — DRC spec lines)* | | | | | |
| **E7** FPGA | — | — | — | — | — | LUT·FP·sealed ICs |
| **AC side-rail** (∥) | *(uses E0 AC + E1 passives + E2 diodes for rectif.)* — nodes: AC-Fund · Reactance · Filters · Resonance · Rectification · Transformers | | | | | |

Two things this grid makes visible, and the tree must therefore draw:

1. **The E4→E5a keystone edge** (Active & Switching → Logic & ICs): the *only* place a node leaps domains as a hard prereq. That is **"Logic from Transistors" → "Logic & ICs"** — render it as the thick rose critical edge.
2. **The all-of join at E4**: `{E2, E3a, E3b}` all feed E4 (the `requires:[era2,era3a,era3b]` all-of edge). Draw the `┃` join bar so the player sees E4 is the reward for touching diodes + mechanics + second-domains, in **any** order (the 3a∥3b parallelism).

**The primitive → home-era badge map** (P1–P8 as node stamps, not columns): P2 → E1 badge; P1 → E2; P6 → E3a; P7·P8 → E3b; **P3·P4·P5 → E4** (the keystone carries three). E0 is in-core, E6 is rules-only, E5/E7 are integer-exact library/FPGA — `primitive:null`, no badge.

### 2.4 Rejected categorization alternatives (and why)

| Alternative | What it is | Why rejected |
| --- | --- | --- |
| **By ERA only** (1-D) | the era table as a flat list | flattens the domain read and the 3a∥3b parallelism; loses the swim-lanes — degrades to a checklist |
| **By DOMAIN only** (1-D) | `PART_CATEGORIES` as the spine | scrambles the dependency climb — the game's whole "more-reality" thesis goes invisible. Right for the *bin*, wrong for the *tree* |
| **By PRIMITIVE only** (P1–P8 as the 8 columns) | organize by sim capability | players don't shop by "I want a P5 today"; engineering-cost is the wrong shelf. Kept as a node **badge** instead |
| **A new 8-domain functional list** (passives/active/diodes/logic/mixed/power/mechanical/sensing) | invent a richer domain axis | a *third* taxonomy nobody else uses; `PART_CATEGORIES` already exists and the era axis does the hands-on/sensing separation. Reject — reuse the 7 |

The **2-D Era × Domain** scheme is the only one that keeps the climb readable **and** ships the existing bin taxonomy as the colour lane.

### 2.5 Mapping the examples ladder onto the eras

`EXAMPLE_CATEGORIES` (14) is the **"build here" rail** inside each expanded station (§1.8) — *not* a fourth taxonomy. The mapping (near-1:1; the AC tail is the side-rail):

| Example category | Era station it appears under |
| --- | --- |
| Fundamentals | E0 |
| Sources & Current | E0 |
| Capacitors & Inductors | E0 → E1 |
| Diodes | E2 |
| Power & Switching | E3a + E4 |
| Op-Amps | E4 |
| **Logic from Transistors** | **E4** (the build-it-yourself precursor) |
| **Logic & ICs** | **E5a** |
| AC Fundamentals / Reactance / Filters / Resonance / Rectification / Transformers | **AC side-rail** |

So "Logic from Transistors" is literally an **E4 build list** (build a NAND from discrete MOSFETs) and "Logic & ICs" an **E5a build list** (sealed gates) — the example ladder *already encodes the owner's call*, and the tree just surfaces it as adjacent stations with the keystone edge between.

---

## 3. The player experience — pull, not pick

The tree is a **journey-map + an OFFER you pull from**, never a gate you pass through. This section is the *felt* loop — what it's like to climb, not how the DAG is drawn.

### 3.1 You-are-here, reachable-next, and the one glow

The panel opens centred on the one **available (rose-pulsing)** era; the `[◎ you-are-here]` button re-centres from anywhere; the breadcrumb always names the current era. The player answers "where am I / what's next" in **under one second, pre-attentively, from the single glow** — no reading required. Owned eras are lit-calm (`--ok` ring, no glow); locked eras are greyed-present; the available frontier is the **only** animated element.

### 3.2 Every locked thing is a pull, never a no-op

Clicking a locked part (bin) **or** a locked node (tree) opens the unlock card — and for a *locked* (not merely *available*) node it opens **scrolled to the unmet prereq** ("first: own Era 4"), so the pull points backward up its own chain and **teaches the path** instead of refusing. `arm`/`toggleArm` early-returns into this card (impl §2.4). There is no silent click, no greyed-out-and-dead, no modal wall — the bench stays live behind the card. (For a deep-locked click, the card makes the *immediate* next step — the nearest available prereq — the actionable one, so the player always gets one concrete bench-shaped move, not a five-step lecture.)

### 3.3 Eureka discounts surface on the locked shelves ahead

When bench play arms a phenomenon that would cheapen a future node (`eurekas` from the Lab Book — [`game-lux-and-lab-book.md`] §2/§3), that locked node/shelf gets a faint `◇ eureka available` tag and its **struck-through discounted price** shows on the locked card *before* it's reachable — "the rectifier shelf is cheaper now." This turns the tree into a **live readout of bench play** (the anti-grind hook made visible) and pulls the player back to the bench, not toward a grind.

> Worked moment: the player builds a rectifier + cap at the bench for fun; the ripple detector fires (Lab Book → `eurekas.ripple`). Without opening anything, the locked `Era 1 · Tolerances` badge updates `◇2` → struck-through `◇2̶ ◇1` with a faint eureka tag. The tree just rewarded bench play *in place*.

**Scope guard (against nag/FOMO):** only tag locked nodes whose discount is **currently claimable-by-demonstration at the bench**, and keep the tag faint (`--dim`), a whisper not a shout. (Owner confirm — §7.)

### 3.4 Threading to the contracts loop

Unlocking a node makes its `unlocksTemplates` **offerable** — so a fresh unlock visibly grows the contract `OfferCard` stream (a new glimmer in the HUD margin, *pull-not-pick*, sandbox still running per [`game-contracts-deep-dive.md`] §1 (the offer)). The unlock card **names** the contract templates it offers ("unlocks the Rectifier-PSU contract line"), and the fidelity-tier selector on every offer card (Ideal always; Real after `era1-tolerances`) shows **locked tiers greyed with their unlock badge** — the *same offer-not-gate dialect* as the bin and the tree. Tree, bin, and offer card speak one language of pull.

> Channel discipline: the tree's rose-pulse lives in the tree/bin surface; the offer glimmer lives in the HUD margin. Keep them in distinct zones so they read as "the climb" vs "the work," not two competing commands.

### 3.5 Threading to the Lab Book (the understanding firewall)

The Lux that buys the next node comes **only** from understanding ([`game-lux-and-lab-book.md`] §1 firewall: *Credits buy breadth, Lux buys depth, Lux comes only from understanding*). The unlock card's eureka shortcut is a direct hand-off to the Lab Book challenge layer: "demonstrate `ripple`" *is* a Lab Book entry. The card copy surfaces the through-line so the player feels it: **Lab Book challenge → Lux → license the node → the shelf un-greys.** The tree is the SPEND end of the same faucet the Lab Book fills; the next pull is always bench-shaped, never wallet-shaped.

### 3.6 Threading to product-sim / contracts validation

A node's `examTemplateId` (e.g. `exam-rectifier`, `exam-amplifier`) is a normal generated contract at a fixed high bar — passed at the bench, in the product simulation, against a `SpecLine[]` grader. The unlock card's exam chip is therefore *also* a pull to the bench: "pass the Rectifier exam (or demonstrate `rectification` to waive it)." The tree never asks the player to grind a number; it asks them to **build the thing once and understand it.**

### 3.7 Part-less / mode stations read as eras, not empty shelves

Two stations gate something other than a part-tag shelf; both get a **distinct glyph** so absence reads as *identity*, not a bug (owner confirm — §7):

- **E1 (Tolerances)** unlocks the **`EC` part chip AND gates a MODE** (`unlocksFidelity` = the Real-mode toggle via tolerance/ESR grades — impl §2.2). Render it as a **normal station carrying the `EC` chip *plus* a fidelity-toggle affordance** + its card ("you can now place an electrolytic, and your nominal parts gain ±5% tolerance"). It is **not** a chip-less vertebra — only **E6** (Design Rules, `primitive:null`, no parts) is genuinely part-less.
- **E6 (Design Rules)** unlocks **DRC spec lines**, not chips. Render it as a **`[DRC]` seal node**, blurb-only card, no part chips.

---

## 4. Reuse vs new surface

The recommendation is deliberately a thin render layer over machinery that already exists. The split:

### 4.1 Reuse — verbatim

| Reused | Where | Used for |
| --- | --- | --- |
| `nodeState` / `canUnlock` / `unlockedTags` | impl §2.1 / §2.3 (a `$derived` store) | every node look, the card's `[UNLOCK]` enablement + gap text, the bin filter |
| the bin's `is-locked` greying class + Lux lock badge | impl §2.4 | the tree's **locked** node look — one visual system, no new locked styling |
| `arm`/`toggleArm` locked early-return → opens card | impl §2.4 | the locked-click-is-a-pull behaviour (bin and tree share it) |
| `familyGroups(cat)` row builder | `App.svelte:830` | collapsing gate families inside an expanded station (keeps LOD 2 from becoming a wall) |
| `PART_SYNONYMS` search index | `App.svelte:857` | the tree's `⌕` — one index, not two |
| `PART_CATEGORIES` (7) + per-part colours | `App.svelte:696` | the domain lane/fill hue — chips match the bin pixel-for-pixel |
| `EXAMPLE_CATEGORIES` (14) | `examples.ts` | the per-station "build here" rail — not a fourth taxonomy |
| the contract `OfferCard` glimmer + pull-not-pick FSM | [`game-contracts-deep-dive.md`] | the "a new contract line opened" announcement channel |
| the Lab Book eureka detectors (`eurekas[phenomenon]`) | [`game-lux-and-lab-book.md`] §2/§3 | the on-shelf discount surfacing — the tree *consumes*, never detects |
| `app.css` tokens (`--ok/--accent/--cyan/--dim/--surface-2/--bg/--warn`) + the `board.ts` grid motif | `app.css` | all colour and the spine backdrop — zero hardcoded colour |

### 4.2 New — presentation-only, golden-safe

| New surface | What it is |
| --- | --- |
| `web/src/lib/components/TechTreePanel.svelte` | the spine + LOD host |
| `web/src/lib/components/TechNode.svelte` | one node: state-class + domain-fill + primitive badge + part chips |
| `web/src/lib/components/UnlockCard.svelte` | the floating OFFER — **the same component the bin's locked-part click opens** (one card, two entry points) |
| a `.tech-tree` block in `app.css` | the spine/station/edge styling (tokens only) |
| the three-LOD zoom controller, the you-are-here re-centre, the path-to-goal chain highlight | small interaction layer over the existing data |
| `techtree.ts` (the `NODES` array) | **authored data**, already specced in impl §2.1 — the panel *imports* it; this is authoring, not new machinery |

**No new derivation, no new store, no per-frame cost.** Every visual keys on the existing `$derived` store, recomputed **once per unlock** (when `gs.unlockedNodes` changes), never per frame — so the format never touches the once-per-frame JS↔wasm boundary in `loop.ts`.

### 4.3 New — but FLAGGED as an owner hand-off (do not silently add)

- An **optional** cosmetic `TechNode.domains?: string[]` hint for multi-domain rows (the E4 keystone spans Sources + Passives + Active&Switching; E5 spans several) **if** within-row sub-headers are wanted. The grid works without it (a node lists multiple lane-chips inline). **It is a data touch — do not add it without an owner call** (§7), and if added it must stay **off the gate path** (render-only; never read by `unlockedTags` or the solve).

---

## 5. Determinism and golden-safety

**Golden-safe by construction.** This is **web-side UI only** — a presentation layer rendered *over* the existing authored `TechNode` DAG.

- **No sim-core change.** Nothing in `crates/sim-core` is touched, so `cargo test -p sim-core` (including `run_is_reproducible`) and the FNV-1a snapshot golden are **untouched**.
- **No `sim-protocol` / `sim-wasm` change**, **no JS↔wasm boundary change.** The panel never calls across the boundary; it reads the same `$derived` `gameState` store the bin reads.
- **Not a `snapshot_hash` input.** Nothing the tree computes feeds the solve. Node fill-colour / lane / badge / state are all derived from existing fields (`era`, the part tag's domain via `PART_CAT_OF`, `primitive`) or from `nodeState`/`unlockedTags`/`eurekas`.
- **The gate is a placement-UI filter + a render — never a solve filter.** A board loaded from a save that contains a **locked** part still solves **bit-identically**: `unlockedTags` restricts *arming a NEW part*, not the netlist of an existing board. `buildNetlist` still emits a locked part that's already placed; the solver never sees the gate. The locked-part click is a *pull* (opens the card), never a silent no-op and never a netlist edit.
- **Zero per-frame cost.** Every visual keys on a `$derived` store recomputed **once per unlock**, never per frame, so the format adds nothing at the once-per-frame boundary in `loop.ts`.
- **Tokens only.** All colour comes from `app.css` custom properties — no hardcoded colour (the design-system rule), preserving the identity-on-hue / state-on-a-separate-channel discipline.

**Pin this invariant in the panel's header comment** so a future agent does not "optimize" the placement gate into the solver:

```
// SPDX-License-Identifier: Apache-2.0
// TechTreePanel: PRESENTATION ONLY over the authored TechNode DAG.
// The unlock gate is a PLACEMENT-UI FILTER + RENDER — never a solve filter.
// A save containing a locked part must solve bit-identically. Do NOT move the
// gate into buildNetlist or the wasm boundary. Golden-safe by construction.
```

---

## 6. Phased build

Each phase is **independently shippable** and **golden-safe**; each delivers value alone.

| Phase | Ships | Value | New surface |
| --- | --- | --- | --- |
| **P0** | the impl-§2.4 **bin grey-gating** alone (`is-locked` class + Lux lock badge + click-opens-card) | a complete, useful journey-map with **zero tree panel** — the bench teaser from minute 0 | (already specced in impl §2.4) |
| **P1** | a **flat vertical era-column** `TechTreePanel` (E0…E7 rows, each row = an era's nodes + chips, reusing `familyGroups` + `is-locked`) | the "checklist" tree — opens from a button, shares the bin's data + greying + search + card | `TechTreePanel.svelte` (column), `TechNode.svelte`, `UnlockCard.svelte` |
| **P2** | promote the column into the **horizontal subway spine** — the 3a∥3b branch, the E4 all-of join bar, the AC `--cyan` side-rail, click-to-expand per-era DAG, the three LODs, you-are-here, path-to-goal | the full hybrid journey-map | the spine renderer, the LOD controller |
| **P3** (optional) | the **eureka-on-locked-shelf** surfacing + the docked **IC-Frames tool-shelf** + the part-less-era glyphs (E1 vertebra, E6 `[DRC]` seal) | the anti-grind hook made visible + the last legibility polish | small render additions (each an owner-confirmed item from §7) |

The bin stays **flat** throughout (era shelves, no zoom); the **tree panel owns the zoom/LOD**. They share data + greying + card + search, but the tree is the *expanded view opened from a button*, not a bin replacement.

---

## 7. Open questions / owner hand-offs

1. **AC side-rail entry / cost.** Fed from **E1 (passives)**, with Rectification additionally needing **E2 (diodes)**. Free/auto the moment E1 is owned (no Lux — reinforces "offered, not gated"), or a cheap one-time `◇1` license so it still *feels* unlocked? **(Lean: free/auto — it's a side-rail, not a tier.)**
2. **IC Frames placement.** `PART_CATEGORIES` has IC Frames as the 7th domain, but the IC-maker is a *sandbox tool* gating at E7, not a per-era part unlock. Draw it as a **persistent tool-shelf docked to the panel edge** (lit at E7), or as an E7 station payload? **(Lean: docked tool-shelf — makes the lane-count question moot.)** *Also flag the separate `App.svelte:696` (7) vs `codex.ts:38` (6) mirror drift for a standalone fix.*
3. **Part-less stations.** Confirm **E1** renders as a **normal station (the `EC` chip + a fidelity-toggle affordance)** — NOT a chip-less vertebra — and **E6** as the genuinely part-less **`[DRC]` seal** node (blurb-only card, no chips), so neither reads as a missing/empty shelf.
4. **Eureka surfacing on locked nodes.** Show a faint `◇ eureka available` tag + struck-through price on locked nodes *ahead* (the anti-grind hook made visible, scoped to currently-demonstrable phenomena), or only inside the node's own card? **(Lean: the faint tag on the locked node.)**
5. **Pre-attentive "next" budget.** `--accent` rose-pulse is reserved for the next available node. If **3a∥3b are both available** at once (both only require E1), do **both** pulse (two equal offers) or only the cheaper/closer one? **(Lean: both pulse — the parallel choice is the design.)** Fallback if it dilutes the calm-map: pulse the *frontier* as one shape, two branch nodes sharing one breathing rhythm.
6. **Bin vs tree zoom ownership.** Confirm the bin stays **flat** (era shelves, no zoom) and the `TechTreePanel` owns the three-LOD zoom — shared data / greying / card / search, tree is the expandable view opened from a button.
7. **Optional `TechNode.domains?` hint.** For multi-domain rows (E4 keystone, E5) to drive within-row sub-headers — add a **render-only** cosmetic field, or keep DOMAIN single-valued and render lane-chips inline? **This is a data touch; do not add without an owner call.** If added, it must stay **off the gate path** (never read by `unlockedTags` or the solve). **(Lean: inline lane-chips first; add the field only if sub-headers prove needed.)**
8. **A player-facing "why this matters" line?** The card currently shows the engineering blurb; a one-line player hook ("one-way streets — the gate that makes power supplies possible") may pull harder. Render-only, but data-model-adjacent — **flagged, not added.**
9. **Tree auto-open?** Strictly player-initiated (the "never must open" invariant), or a one-time gentle reveal the first time an era becomes available, to teach the panel exists? **(Lean: player-initiated; the bin carries all teaching so the tree stays optional.)**

[`game-economy-progression-implementation.md`]: ./game-economy-progression-implementation.md
[`game-progression.md`]: ./game-progression.md
[`game-lux-and-lab-book.md`]: ./game-lux-and-lab-book.md
[`game-contracts-deep-dive.md`]: ./game-contracts-deep-dive.md
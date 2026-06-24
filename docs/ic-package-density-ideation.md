<!-- SPDX-License-Identifier: Apache-2.0 -->

# Package density / size-class variants for the IC maker — ideation

Status: ideation (no code). Captures the brainstorm behind "make larger/denser versions of each IC
package frame." Companion to **ADR 0006** (the IC maker) and the just-shipped zoom-to-open renderer.

## 0. Framing — what the owner is asking for, in this codebase's terms

The owner wants a **denser package** that **packs more sub-circuitry into the same chip**, visually
rendered as *the internals literally getting smaller* when you zoom in after sealing — paid for with
**cost, scarcity, and heat**.

Three of the four pieces already exist and line up exactly:

1. **"More fits inside"** is a property of the **drill-in build canvas** — `dieLayout()` in
   `web/src/lib/packages.ts` produces the roomy authoring frame, sized by `DIE_CROSS` (cross-axis) ×
   `edgeSpan(half)` (long-axis), `DIE_PIN_PITCH`/`DIE_CORNER_INSET`. A denser package = a *bigger
   interior at the same pin count*.
2. **"Internals get smaller when you zoom in"** is **already implemented**. `drawUserIcInternals()` in
   `web/src/lib/userIcInternalsView.ts` fits the authored sub-graph into the sealed footprint at a single
   uniform `scale = Math.min(dstW/srcW, dstH/srcH)`. More authored parts ⇒ a larger authored `bbox` ⇒ a
   *smaller* `scale` ⇒ each glyph shrinks. **The headline visual falls out of existing code for free** —
   density is just "the seal payload had a bigger bbox."
3. **"Same function, swappable presentation"** is the **package-as-parametric-library** decision (ADR
   0006): `UserIc.package = { archetype, pinCount }`, and `packageLayout`/`dieLayout` derive everything
   from those two scalars. Density is a **third scalar on the same record**.
4. **The tradeoffs** (cost / availability / heat) are the **one genuinely new surface**, and the economy
   doc (`docs/game-contracts-economy.md`) + reward doc (`docs/game-rewards.md`) give the hooks: BOM-cost
   par, Lux-gated tech tree, magic-smoke ratings via `RATED_CURRENT_SLOT`, and the per-element FAIL mask
   in `Sim::flag_and_clamp_fails`.

**Thesis:** density is a presentation+economy axis that rides the existing package library and zoom
renderer; the only sim-touching part (heat) reuses the rating/FAIL machinery additively, golden-safe.
The sealed netlist stays the real authored parts (seal-as-same-netlist) — density never changes the solve.

## 1. The capacity mechanic — how "more components fit"

Four candidate models. Not mutually exclusive, but one should be the spine.

| Model | What changes | Code touched | Forces density? | Delivers the zoom-shrink visual? | Verdict |
| --- | --- | --- | --- | --- | --- |
| **(a) Bigger build canvas** | `dieLayout` interior (`DIE_CROSS`, `edgeSpan`) × `dieScale` | `packages.ts` (+ `dieBounds` follows for free) | Affords, doesn't force | Indirectly (more parts ⇒ bigger bbox ⇒ smaller `scale`) | **Spine** |
| **(b) Finer sub-cell grid** | placement pitch inside die | graph.ts placement/wiring/DRC (deep) | Yes | Already free via renderer | Skip (invasive, redundant) |
| **(c) Area/part budget** | seal-gate capacity check | `dieEditor.ts`/`board.ts` seal flow + HUD | **Yes (hard cap)** | No (pairs with a) | **Spine, paired with (a)** |
| **(d) Shrink footprint** | `packageLayout` body + lead pitch; new QFN | `packages.ts` `PACKAGE_ARCHETYPES`/`dualLayout` | N/A (separate axis) | N/A | **Separate sub-axis (body size)** |

- **(a) Bigger drill-in build canvas.** Keep `DIE_PIN_PITCH`/`DIE_CROSS` as the *baseline (mid-density)*
  and multiply the interior by a per-class `dieScale` (e.g. compact ×0.7, standard ×1.0 = today, dense
  ×1.5, ultra ×2.2). Leads stay where the pin count puts them on the perimeter (seal mapping untouched —
  `dieLayout` already guarantees "pin index i is the same lead"); only the *interior area between the
  walls* grows. `dieBounds()` derives the walls straight from `dieLayout`'s `w×h`, so a bigger
  `dieLayout` gives a bigger walled build region with **zero changes to the DRC or seal**.
- **(b) Finer sub-cell grid.** The most literal "smaller features," but the board model is integer-cell
  (`Cell {col,row}`, union-find on `"componentId:pinIndex"`). A sub-cell grid is a large, invasive change
  for a cosmetic gain the renderer already delivers. **Skip as the spine.**
- **(c) Component-count / die-area budget.** Each density class gets a `capacityCells` budget (better: a
  die-area budget = Σ each inner part's footprint cells, since a power MOSFET eats more die than a signal
  transistor). The Seal gate enforces it like `dieIsSealable` already gates on "compiles." Turns density
  from soft affordance into a **hard, legible tradeoff**; trivial to implement (one comparison + a HUD
  readout "14 / 20 cells used").
- **(d) Shrink the footprint while keeping pins** (SOIC→TSSOP→QFN). The complement of (a): keep the
  canvas, shrink the **production footprint** + tighten pitch, so board real-estate drops. This is a
  distinct *body-size* axis — **treat it as its own sub-axis**, not conflated with die density.

**Recommended capacity mechanic: (a) + (c).** A density class sets both a `dieScale` (bigger walls — the
room *and* the zoom-shrink) and a `capacityCells` budget (the hard gate). They reinforce; (d) is offered
as an independent body-size selector.

## 2. Identity & naming — size class vs process node (both, as two sub-axes)

Real electronics has two orthogonal "smaller" axes; teaching value is highest if named separately:

- **Package body size (the *outside*)** — DIP → SOIC → SSOP → TSSOP → QFN: *same pin count, smaller body,
  finer lead pitch.* Model (d). About **board real-estate and assembly**.
- **Die density / process node (the *inside*)** — how much sub-circuitry the silicon holds per area; an
  older node fits less. Models (a)+(c). About **capacity, cost, yield, heat**.

A real part is a point in *both* axes. Expose two pickers, lead with **density**.

### Proposed density classes (the *inside* axis — the new field)

| Class | `dieScale` | `capacityCells` | Real-world flavour | The pitch to the player |
| --- | --- | --- | --- | --- |
| **Roomy** | ~0.7× | low | older / through-hole node | cheap, abundant, cool, holds little |
| **Standard** | **1.0× (today)** | medium | mainstream node | the baseline — *equals current behaviour* |
| **Dense** | ~1.5× | high | fine-pitch modern node | fits a lot more; costs more, scarcer, warmer |
| **Ultra** | ~2.2× | very high | bleeding-edge node | packs the most; premium, rare, real heat risk, lower yield |

**Standard is the default and equals today's `dieLayout` numbers verbatim** — existing sealed ICs, saved
circuits, and the golden are untouched (same discipline `tiers.ts` uses: "mid-range = the sim-core
default").

**Reconciling with the archetype library (recommended):** density is a *separate selector orthogonal to
the archetype*. `PACKAGE_ARCHETYPES` stays "lead layout family" (dual/sot23/sip/future quad); density is
a new independent parameter on `UserIc.package`, passed into `dieLayout(archetype, pinCount, density)`.
Any package can be any density (you can get a dense DIP-equivalent or a roomy QFN). **Body size = an
archetype choice (extend the table with the SOIC/TSSOP/QFN ladder); die density = a new scalar.**

## 3. The visual — concretely, on three surfaces

- **(i) The sealed chip's zoom-to-open (the headline) — mostly already done.** A denser package's seal
  payload simply has more parts and a larger authored bbox, so `scale` shrinks — glyphs render smaller
  with no renderer change. Add cheap polish: a **density tint/label** on the footprint + zoom HUD
  ("Ultra • 32-cell die"); at extreme shrink, fade tiny glyphs to schematic dots but keep the live wire
  colours (node-voltage colouring stays readable) — "you packed it so tight you only see the live nets,"
  which is itself the lesson.
- **(ii) The board footprint (the outside).** Density does *not* change the production footprint (a dense
  and standard DIP-8 occupy the same cells — density is interior silicon). Differentiate with a small
  **density pip/colour** on the body (like the tier picker / diode-variant tint). **Body size (axis d)**
  does shrink `packageLayout`'s `w×h` — a TSSOP-8 occupies fewer/narrower cells (the visible area win).
- **(iii) The drill-in build area.** `dieLayout(archetype, pinCount, density)` returns a larger `w×h` →
  `dieBounds` draws bigger walls → camera framing + soft containment scale automatically; the capacity
  budget HUD ("18 / 24 cells") sits in the editor chrome. Leads stay on the perimeter at the same
  indices, so re-entering a saved die and sealing are unchanged.

## 4. The tradeoffs — the heart of the ask (and the teaching payload)

| Tradeoff | Real lesson | Hook in this codebase | Sim-touching? |
| --- | --- | --- | --- |
| **Manufacturing cost** | denser silicon / finer process costs more per chip | BOM-cost par (`game-rewards`/`economy`); a `costMultiplier` per class | No — game-state |
| **Availability / supply** | bleeding-edge parts are scarce, have lead times | Lux-gated tech tree + contract gating; gate Ultra behind a Lux tier, rarer in the bin | No — game-state |
| **Power density → heat** | same dissipation in a smaller die ⇒ higher junction temp ⇒ derate or cook | **`RATED_CURRENT_SLOT` + `Sim::flag_and_clamp_fails`** — dense lowers the inner power parts' effective rating so the FAIL mask boxes sooner; pairs with magic-smoke | **Yes, additively** (only flags, never alters the solve; golden-safe) |
| **Yield / defect rate** | bigger/denser dies have more defects ⇒ lower yield ⇒ scrap | a per-seal yield roll costing extra Credits — **must be deterministic** (seed off `UserIc.tag` + design hash, never RNG/wall-clock) | No (but determinism-sensitive) |
| **Parasitics (composes with `tier`)** | finer pitch = lower L but more coupling C | the tier param system: density biases the AC-only ESR/ESL / `R_ESL` slots | **Yes, via the existing AC-only unhashed param path** (golden-safe) |
| **Routing difficulty** | cramming a circuit into a tiny die is hard | the containment DRC + the capacity budget — a compact die can't fit a big circuit | No — authoring-time |
| **Min feature size ⇒ which parts fit** | a coarse/power node can't pack fine logic; vice-versa | a per-class allow/deny list of inner part kinds, enforced at placement + seal | No — authoring-time |

The "why not always pick dense?" governor the docs want: **heat** (dense parts vent sooner under load — a
genuine gamble) and **cost/scarcity** (dense is gated + expensive).

### Heat, in detail (the only rich sim hook)

- **Derating is just a smaller rating.** In Real mode, when `buildNetlist` emits a dense IC's inner power
  elements, scale down `RATED_CURRENT_SLOT` by the class's derate factor (e.g. Ultra → ×0.6). The existing
  `flag_and_clamp_fails` check (`|I| > rated`) then boxes the part at a lower current — **no sim-core
  change** (rating is already a general per-element slot the web layer fills). This *is* "power density
  makes heat a concern," in the currency the game already has (FAIL/magic-smoke).
- **Optional richer model (later):** an aggregate **chip-level dissipation budget** — Σ V·I over the
  sealed inner elements (available render-side via `userIcInternals` node voltages + element currents),
  compared to a per-class thermal budget, tripping a chip-wide FAIL when exceeded. Keep it a *flag* read
  post-solve from the snapshot, never feeding back — the discipline `flag_and_clamp_fails` already uses.

(See the companion **heat-representation ideation** for the full thermal system.)

## 5. How it composes with `tier` and `variant`

The game has two orthogonal *per-part* axes on `Component`: `tier?` (quality grade, `tiers.ts`) and
`variant?` (device identity, `diodes.ts`). **Density is a natural third axis at a different level:** it's
a property of the **package** (the `UserIc` / the IC-maker frame), not the individual inner parts. Home it:

1. **On `UserIc.package`** — widen from `{ archetype, pinCount }` to `{ archetype, pinCount, density }`
   (optional, default Standard). Round-trips through the `SavedCircuit` contract + `framePackage`.
2. **On the IC-maker frame while authoring** — the empty frame carries the chosen density (so the die
   editor sizes the canvas + enforces the budget), most cleanly as a small dedicated `Component` field
   (mirroring the authoring-only `pinTests?`), not overloading `tier`.

**Payoff:** dense package + lab-grade inner parts = the premium chip (small, packs a lot, top-quality,
most expensive + scariest thermally — cost multipliers *stack*). Roomy + budget parts = the cheap-and-
cheerful jellybean. Density × tier multiply on **cost**; they *separately* perturb **parasitics** (tier =
the part's own ESR/ESL; density = the interconnect) — both through the AC-only unhashed path, golden-safe.

## 6. Determinism & integration — what touches what

Hard rule (CLAUDE.md golden rule 1; ADR 0006): the sealed netlist is the real authored parts; density must
not change the solve unless it's an explicit, golden-safe model param.

- **Pure presentation (no sim, no hash):** capacity/canvas size (`dieScale`), the zoom-shrink (already in
  `userIcInternalsView`), footprint glyph cues, the build-area walls (`dieBounds`).
- **Web-side economy / game-state (no sim, no hash):** cost multiplier, availability/Lux gating, yield
  rolls, the capacity-budget seal gate, the min-feature allow/deny list. *Determinism caveat:* anything
  stochastic (yield roll) seeds off stable design data (`UserIc.tag` + a hash of the authored graph),
  never `Math.random()`/wall-clock.
- **Sim-touching but golden-safe (additive, unhashed, default == current):** heat-as-derating (lower
  `RATED_CURRENT_SLOT` for dense inner power parts, Real mode only — `failed_elements` is not in
  `snapshot_hash`, the rating only flags; Standard applies no derate ⇒ bit-identical, **zero sim-core
  change**); density-biased parasitics (folded into the existing AC-only, Real-mode-gated, unhashed tier
  param slots — the same argument `tiers.ts` relies on).

**The invariant that keeps it safe:** density changes *how much you authored* and *how it's
drawn/priced/rated*, but `captureSeal` still snapshots the raw authored discrete parts, and
`flattenUserIcs` still expands them into the real element list. The core never learns the package got
denser — it just sees more elements (which it already handles). **Density is invisible to the solve by
construction.**

## 7. Phased build path (smallest shippable → richer)

1. **Density as a package scalar + the canvas/zoom (pure presentation).** Widen `UserIc.package` + the
   IC-maker frame with an optional `density` (default Standard = today). Thread into `dieLayout(archetype,
   pinCount, density)` → bigger walls via `dieScale`; `dieBounds` + the zoom renderer follow for free.
   Density picker in the die editor + a footprint/zoom label. **No sim, no hash, golden untouched.** This
   alone delivers the headline and is genuinely small.
2. **The capacity budget + seal gate (web-side, hard tradeoff).** `capacityCells` per class + a budget
   check in the seal flow, a HUD readout, a blocked-seal reason.
3. **Heat-as-derating (Real mode, golden-safe).** Scale `RATED_CURRENT_SLOT` down for dense inner power
   parts in Real mode. Reuses `flag_and_clamp_fails` + magic-smoke; **no sim-core edit.**
4. **Economy hooks (cost + availability).** Per-class cost multiplier feeding BOM-cost par; Lux-gate
   Ultra; rarer in the bin. Until the economy lands, surface as inspector/codex info-lines.
5. **Richer polish.** Body-size archetypes (SOIC→TSSOP→QFN); density-biased parasitics; deterministic
   yield rolls; the min-feature allow/deny list; aggregate chip-level thermal budget.

## 8. Recommendation

Ship density as a single optional scalar on the package record (`UserIc.package.density`, default Standard
= current behaviour), implemented as capacity model **(a)+(c)** — a per-class `dieScale` enlarging the
drill-in canvas + a `capacityCells` budget enforced at seal — with the tradeoffs layered in dependency
order: **heat-as-derating first** (golden-safe, reuses `RATED_CURRENT_SLOT` + the FAIL mask with zero
sim-core changes), then cost/availability via the economy layer.

Rationale: it rides what's already built (the zoom-shrink, the package-as-library decision, the wall
derivation, the rating/FAIL model); it's the right third axis (per-package, orthogonal to per-part
tier/variant, multiplicative on cost); it teaches real electronics (die area vs cost, process node vs
availability, power density vs junction temperature, fine pitch vs parasitics); and determinism is safe by
construction (the solver never sees "density"; the only sim hook is an additive, unhashed flag that's a
no-op at Standard).

One-liner: **"A denser package is the same chip on a finer process — you drill into a bigger room, pack
more parts, and they render shrunk-to-fit when you zoom back in; you pay for it in money, scarcity, and
heat (it derates and vents sooner). Standard density is exactly today's behaviour, so nothing you've
already built or sealed moves."**

# Recursive IC Level-of-Detail — master plan

**Status:** in progress (Phase 0). Owner-directed (2026-06-24). This is the durable plan for the
"zoom from a LUT to the doped silicon" feature; every step is gated **and** audited by a review panel.

## Vision

A sealed user IC, zoomed on the board, opens to its inner circuit — and you can keep zooming, descending
the **real cell hierarchy**: chip → cells → sub-cells → gates → transistors → **silicon**. Every level is
rendered by the **real board renderer** (not a separate imitation), just scaled. Nested cells show as
labelled boxes with pinouts until you zoom into them; a transistor, zoomed far enough, shows its actual
animated device/silicon.

## Why this unifies the two goals the owner raised

- **"Realistic without overcomplexity."** LoD *is* the abstraction: the SRAM cell is a labelled box until
  you choose to look inside, so a design is realistic all the way down yet never drowns the player. Reuse +
  nesting (a standard-cell library) keeps each canvas small.
- **"Rendered the exact same way."** Faithful rendering becomes the recursion's invariant: each level is
  the die-editor view, scaled. No separate renderer to drift.

It is the natural generalization of two things the game already has: **zoom-to-open** (today: one level)
and the **five-tier IC glyph** LoD (`docs/ui/ic-glyph-spec.md`, symbol→…→silicon, today hand-authored per
chip). The hierarchy supplies the intermediate tiers from the real circuit; the silicon tier is the leaf.

## Phases

### Phase 0 — Render ONE level via the real renderer (the base case)

From the investigation synthesis (Approach **A**: extract the real board render functions into a shared
`boardRender.ts` and run the actual wire pipeline over the reconstructed inner graph — sub-board rejected as
too `app`-coupled). Render-only; golden untouched.

- **0.1** Create `web/src/lib/boardRender.ts` — the `this`-free home: `PITCH`, conduit colour consts,
  `BoardLens`, and the already-pure engine (`polyline`, `roundedPoints`, `dirBit`, `mix`, `conduitDrawRoute`,
  `conduitSegs`, `nudgeParallel`, `applyCrossings`, `routeLength`, `beltDots`, `sampleRoute(At)`, …). Delete
  from `board.ts`, import back; re-export `BoardLens`.
- **0.2** Move `drawConduitSkin` + `drawJunctionConduit` (verified zero `this`) → `boardRender.ts`; thin
  `private` wrappers in `board.ts`.
- **0.3** Move the route family re-parameterised on `graph`/`dieFrameId` (`routeForWire`, `wireRoute`,
  `frameLeadRoute`, `dieFramePinExit`, `pinOutward`, free `cellToWorld`); keep wrappers so the ~13 board call
  sites are byte-identical.
- **0.4** `netlist.ts`: add `innerGraph` + `nodeOfInner` (+ `frameId`) to `UserIcInternals` (expose the
  builder's already-computed graph + `nodeOfEndpoint`); static fallback gets `()=>0`.
- **0.5** `userIcInternalsView.ts`: run the real pipeline over `internals.innerGraph` — `routeForWire` →
  scale points → `conduitDrawRoute` → `nudgeParallel` → junction follow → `applyCrossings` → `roundedPoints`
  → `drawConduitSkin`; junctions via `drawJunctionConduit`; colour via `nodeOfInner` + the existing `level()`;
  thread `lens`. (Gray pipes / straight wires / hand-drawn junction dots all vanish.)
- **0.6** Scale fix: fit to a target on-screen extent (mirror the tier glyph's `targetHW`), not the
  lead-inset interior (which collapses a SOT to ~1px); derive `pw`/junction sizes from `effPitch = PITCH*s`.

### Phase 1 — Recursive nesting (sealed cells inside cells)

Today `flattenUserIcs` is **one-pass** (`userIc.ts:12` — an inner circuit can't contain another user IC),
which is exactly why a LUT explodes to ~100 transistors on one canvas. Make flatten **recursive to a fixed
point**, depth-guarded against cycles; allow placing a sealed user IC inside a die; thread save/seal for
nested ICs. **Golden-safe:** flatten stays a strict no-op when no sealed IC is placed (the golden has none),
and recursive flatten of a placed nesting is still a pure, deterministic graph→graph transform.

### Phase 2 — Recursive zoom-to-open (LoD by on-screen size)

`drawUserIcInternals` recurses: a nested IC inside the replica, once its **on-screen size** (cumulative
fit-scale × camera zoom) crosses the open threshold, renders its **own** internals the same way — and so on
down. Auto-culls: only the levels currently large-enough-and-in-view are drawn, so infinite zoom stays
cheap. Live signals stay real at every depth — the flattened sim already holds every transistor-level node;
each level maps its view onto that state via the recursive `nodeOfInner`.

### Phase 3 — Silicon leaf

When a transistor (PM/NM) is big enough on screen, hand off from the symbol to its **device/silicon** detail
(the five-tier glyph's bottom tiers / the existing `detailDrawers`), animated from the real solved currents.

### Phase 4 — Realism polish (supports the LUT example)

A 4-pin package option (so an inverter doesn't waste a SOT-23-5 pin); the SRAM config-cell realism dial
(2-inverter latch + a settable stored bit, abstracting the bitstream write); the 4-LUT worked example
(INV → SRAM bit → MUX2 → 16-bit + 16:1 tree) as a built-once teardown that then becomes a primitive.

### Phase 5 — Zoom meter + scale reference (HUD)

Owner-directed (2026-06-24): as you descend the recursive LoD you lose your sense of "how deep am I." Add a
**HUD overlay** with two coupled readouts, render-only (no sim/golden touch):

- **Magnification meter** — the current on-screen magnification (camera zoom × the cumulative fit-scale of
  whatever nesting level you're inside), shown as a number (e.g. `×42` or `1 cell = 6.2 mm`). It reads the
  same camera transform the board already keeps, multiplied by the nested-container scales Phase 2 stacks,
  so it stays honest at any depth.
- **Scale bar** — a labelled reference rule (like a map's scale bar / a micrograph's µm bar) that grows and
  shrinks with zoom and **snaps to nice round physical units** as you cross decades: board cells at the top,
  then mm → µm → nm as you dive toward the silicon (tie the unit ramp to the five-tier glyph's package →
  device → silicon tiers so "you're now at the transistor's gate-oxide scale" is legible). Pre-attentive,
  uppercase-tracked HUD label per the design system (`docs/ui/visual-language.md`).

Lives in the HUD shell (`web/src/App.svelte` + a small `web/src/lib/*` helper), fed by the camera/zoom
state. Pairs naturally with Phase 2 (recursive zoom-to-open), which is what produces the multi-decade range
worth metering.

## Audit protocol — every step

After each step: (1) **gate** — `pnpm -C web check && lint && build && test`, plus `cargo` fmt/clippy and the
golden (`golden_snapshot_hash_is_stable`) for any non-web-only step; (2) **panel** — N independent reviewers
audit the diff against the plan for **correctness**, **behaviour-preservation / regressions**,
**determinism + golden safety**, **plan adherence**, and **subtle bugs**; a synthesizer returns a verdict
(PASS or a fix-list). (3) Fix any findings, re-audit if material, then commit + land via the usual PR flow.

## Golden-rule constraints

Determinism is sacred (`docs/determinism.md`). Phases 0/2/3 are render-only (no `sim-core`/`sim-protocol`, no
netlist element/value emission, nothing hashed). Phase 1's recursive flatten must stay deterministic
(sorted id remap) and a **strict no-op when no sealed IC is placed**, so the golden hash `0xeaac_3764_99e4_fa24`
never moves. All recursion is depth-guarded.

## Progress

- [x] Phase 0 (0.1–0.6) — rendering foundation: opened IC runs the real wire pipeline in a scaled
  container, coloured by the die editor's rail-identity `voltageColor`, faithful junction-follow-pass +
  crossing dots, null-aware nets (floating→cyan, no phantom ties). Audited by a 4-reviewer panel + a
  fix-verification pass. _(lead-connectors deferred to a phase-0 follow-up — see the TODO in
  `userIcInternalsView.ts`)_
- [ ] Phase 1 — recursive nesting
- [ ] Phase 2 — recursive zoom-to-open LoD
- [ ] Phase 3 — silicon leaf
- [ ] Phase 4 — realism polish + LUT example
- [x] Phase 5 — zoom meter + scale reference HUD (`lib/zoomMeter.ts` + a per-frame renderer probe at the
  view centre → `Board.getViewMetrics` → the bottom-left HUD; magnification ×M + a snapped rule ramping
  board-cells → mm → µm → nm. Render-only; golden untouched.)

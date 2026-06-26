# TODOS

Append-only work log. Newest day at the top. Completed items are **tombstoned**
(struck through with `~~...~~`) and kept for history — never deleted. Open items
use `[ ]`. This file is maintained by agents; see CLAUDE.md for the rule.

---

## 2026-06-26 (167) — New ▸ Subassembly = the FREE-FORM builder (hand-built pinout)

Owner building a transmission gate (4 pins, no VCC/GND): the region box refused (no crossings) and New ▸
Subassembly opened the stale generic-BLOCK builder, not the free-form one. Unified. Web/registry only,
golden untouched, 136 web tests, full gate green.
- ~~**New ▸ Subassembly births a FREE-FORM block**~~ — `createBlankFreeFormSubassembly()` (default box +
  4 edge pins, no def yet) + drill via the fresh-seal path (`frameId:-1`, no editingTag, `freshBlank`); the
  box/pin controls + resize bloom light up. Replaces `ensureFrameKind("BLOCK",8)`.
- ~~**Add/remove pins in the free-form builder**~~ — `addFreeFormPin`/`removeFreeFormPin` (board.ts) +
  `firstFreePerimeterCell` (boardRender.ts, tested) + die-bar "Pins" −/+ for free-form.
- ~~**captureSeal preserves free-form geometry**~~ — attaches `freeForm` to the sealed def (mirrors
  resealUserIc); else a fresh free-form seal lost the box/pins. Tested.
- ~~**Fresh subassembly seal bypasses the solvability gate**~~ — a power-less fragment (TG) banks; pill +
  gate in lock-step.
- [ ] **Eyeball (owner):** the in-drill builder feel; default box/pin layout; the bin-only result.
- [ ] Follow-ups: seal-time pin-role hints; Save-resume for a fresh blank (needs a placeholder); maybe a
  "place subassembly on the board directly" affordance vs Tape out.

---

## 2026-06-26 (166) — CHIP BENCH course-correct: strip overworld editing, move bloom into the drill

Owner: *"Strip the overworld and move the bloom and everything into the drill."* The overworld
(placed-chip) device editing of Phase 1a–1d caused edits-hit-all-copies, odd wire routing, pins moving on
resize, and "can't see what's changing inside the device". Web/registry only, golden untouched, 130 web
tests, full web gate green.
- ~~**Strip overworld editing**~~ — removed the App.svelte inspector Box stepper (`placedDeviceBox` /
  `changeDeviceBox`); removed board.ts placed-chip bloom (`bloomTarget`, pin beads, `bloomPinHit`,
  `devicePinDrag`/`moveDevicePinDrag`, `resizeUserIcBox`/`setDeviceBox`/`applyDeviceFreeForm`); removed the
  userIc.ts live def-propagate layer (`setUserIcFreeForm`/`captureUserIcGeoms`/`restoreUserIcGeoms`) and
  `UndoEntry.icGeoms`. Phase 0 die-frame geom undo kept. Deleted `userIc.deviceEdit.test.ts`.
- ~~**Move the bloom into the drill**~~ — resize handles float just OUTSIDE the open free-form die's walls
  (`dieResizeHandles` shared by `drawBloom`/`bloomHandleHit`); drag → `setDieFrameBox` (absolute-size core
  refactored out of `resizeFreeFormBox`); select+wire mode; one undo per drag; `setDieFrame` redraws the
  bloom on drill in/out. Pin moves stay on the existing in-die Alt-drag. Copies follow on reseal.
- [ ] **Eyeball pass (owner):** handle placement/feel inside the drill.
- [ ] Optional polish: in-drill pin bead (vs Alt), left/top handles (anchor move), keyboard/44px parity,
  role badges, reduced-motion. Then Chip Bench Phase 2/3.

---

## 2026-06-25 (152) — START: characterization engine ("1") — foundation

Following docs/cell-characterization-build-plan.md (engine = P5–P9). Web/registry only, golden untouched,
118 web tests.
- ~~**CellBehavior data model + sig**~~ — `CellBehavior {prog,word,mode,sig}` + `UserIc.behavior?`;
  `cellBehaviorSig` (FNV-1a, canonical-ordered, frame-excluded, content-sensitive). Tested.
- ~~**Collapse**~~ — `Component.fidelity?='behavioral'` + a def `behavior` ⇒ flattenUserIcs replaces the
  instance with a `LUT` component (word/mode), remaps its wires BY ROLE to `[OUT,I0..I3,CLK,VCC,GND]`,
  skips FET inlining; buildNetlist emits ONE ELEM_BEHAVIORAL. Golden-safe (gated, default-off). Tested.
  Known limit: collapsed cell's zoom-to-open FETs go static until the P6 local solve.
- ~~**Sweep**~~ (app-verified) — `characterize.ts:characterizeCell`: second web `Simulation`, drive 2^k
  input vectors (1 GΩ sense-R finds the OUT node), read OUT → 16-bit word → `setUserIcBehavior` stores it on
  the def. **⊨ Characterize** button on My-Subassemblies rows; `recognizeGate` (userIc.ts) names the word.
  Tested (sweep app-only; recognizeGate + setUserIcBehavior→collapse headless). See HANDOFFS (154).
- [ ] **Truth-table panel** — STATIC version done (`.char-panel`: full table + recognized-gate chip + LUT
  word). Still open: the **steppable** "watch-it-compute" view (light the conducting FET path, verify each
  row vs the intended gate live).
- [ ] **Fidelity toggle** — a placed instance has no UI to opt into `'behavioral'` yet, so the (landed)
  collapse never fires from the bench. Add an inspector toggle, or default characterized cells to collapse.

## 2026-06-25 (151) — FIX (owner): region seal controls → floating bar

Web/UI only, golden untouched, 117 web tests.
- ~~**Toolbar overlap**~~ — the region seal panel crammed in `.board-tools` overflowed/overlapped Info/Codex
  when a region was pending. Moved it to a floating `.region-bar` over the board (top-centre, mirrors
  `.die-bar`): REGION title + name + ⬡ Seal (N) + × + hint. The tool row is no longer crowded by it.

## 2026-06-25 (150) — FIX (owner round 3): lead overshoot + non-interactable frame-pin wires

Web only, golden untouched, 117 web tests.
- ~~**Overshoot**~~ — a crossing wire's OUTSIDE waypoints are now dropped (filtered to `inBox`), so the
  retargeted lead terminates cleanly at the frame pin instead of overshooting. Internal wires keep all
  waypoints 1:1. `analyzeRegion` returns `inBox`. Tested.
- ~~**Non-interactable frame-pin wires**~~ — a regression from PR #218: drawing frame-pin leads schematic
  skipped `conduitDrawRoutes`, and conduit-mode `wireHitTest` only checks that map → un-clickable. Now the
  schematic branch registers the route when conduit is active, so the leads are selectable again.

## 2026-06-25 (148) — FIX (owner round 2): capture junctions 1:1 + characterize + auto-stimulus

Web/registry only, golden untouched, 116 web tests.
- ~~**Junction 1:1**~~ — a junction is captured iff its cell is inside the box; the crossing retarget
  accepts a captured junction as the inside end. A branched net keeps its junction (no fan-out). Tested.
- ~~**Characterize + auto-stimulus**~~ — GND/VCC/IN/OUTPUT(Y) labels + roles; the frame gets auto pinTests
  (vcc 5 / gnd 0 / in 0; output null) so the die opens powered + "● solvable". Tested.
- ~~**Rendering (#31)**~~ — free-form frame pins draw plain pinout pads (no solder leads, gated
  `!isFreeFormFrame`); frame-pin leads draw schematic not conduit even in the lens (`frameLead`). Package
  dies unchanged. Visual-only; owner verifies in-app.
- [ ] **Device-aware characterization** (optional) — gate→in, drain→out, source-to-rail→supply, to nail
  VCC-vs-input for gate subassemblies (the static heuristic guesses; user swaps in the editor). AWAIT owner.

## 2026-06-25 (147) — FIX (owner-reported): region pin alignment + persistence

Web/render/registry only, golden untouched, 114 web tests.
- ~~**Pins align to traces**~~ — `analyzeRegion` now places each boundary pin where the wire's ROUTED path
  (endpoints + waypoints) actually crosses the box edge, not at the inside-pin's row/col. Fixes the "exits
  right but pin on the bottom" misplacement + junction-routed nets. Tested.
- ~~**Region persists**~~ — the rectangle survives tool switches (only Esc/Seal/Cancel/drill-in clear it);
  `refreshRegionOverlay` (from onChange) updates pins live as you wire; seal panel shows in any tool with a
  × Cancel; a stray click in region mode no longer wipes the box (regionPrev restore).
- [ ] **Pin-drag** (still) — needs Alt-drag (a plain frame-pin press starts a wire).
- [ ] **In-die Ctrl+Z of box-resize** (still) — geometry isn't in the undo stack.

## 2026-06-25 (145) — IMPLEMENT: live region tool + zoom-gauge fix

Web/render/registry only, golden `0xeaac…fa24` untouched, 112 web tests.
- ~~**Zoom gauge monotonic**~~ — `formatMm` holds each unit down to 0.1 (`0.5 mm → 0.2 mm → 0.1 mm → 50 µm`),
  killing the `1mm→500µm` number-jumps-up confusion. PR #213, merged.
- ~~**Live region tool**~~ — board `region` mode (⬓ Region / hotkey G, outer board): drag a box → live teal
  rect + a dot+label at each net crossing the edge → ⬡ Seal region → free-form subassembly. `captureRegion`
  gained an explicit `box` (the drawn rect IS the box); analysis extracted to `analyzeRegion`; new
  `previewRegion` feeds the overlay (preview == seal, tested). board.ts overlay + App.svelte panel.
- [ ] **Pin/box editing in the die** — open a captured subassembly, drag a pin along the edge + resize the
  box (re-`registerFreeFormFrame`; mirror `setDieFramePins`). Next in the push.
- [ ] **Region tool v2** — persist the rect across mode switches + live-update as you wire (today: single
  mode, draw→preview→seal, clears on switch).

## 2026-06-25 (146) — IMPLEMENT: free-form die box resize + clobber-bug fix

Web/render/registry only, golden untouched, 113 web tests.
- ~~**Box resize**~~ — free-form die editor shows a **Box W−/+ H−/+** stepper; `resizeFreeFormBox` re-registers
  the frame in place (pin count fixed → kind tag stable), `clampPinToBox` re-pins a lead on a shrunk wall.
  `resealUserIc` reads the edited box off the frame kind so it PERSISTS through reseal (tested).
- ~~**Latent clobber bug**~~ — a free-form die reports archetype BLOCK, so the generic Pins stepper showed
  for it and `setDieFramePins` would re-kind it to a stock BLOCK, destroying the captured box. Now refused
  (`isFreeFormFrame`); the Box stepper shows for free-form dies, the Pins stepper only for blank BLOCK dies.
- ~~**Bin-edit (reachability keystone)**~~ — "My Subassemblies" rows now have **⊡ Edit** → `editLibraryDie`
  opens the subassembly's die from the bin (no placed instance; synthesizes the outer context). Without it
  a captured subassembly was un-openable (nested-only), so box-resize/circuit-edit were unreachable.
- ~~**Discarded-resize revert**~~ — `dieBack` re-registers the unchanged def on a discarded editingTag exit
  so a box-resize that mutated the global frame registry reverts (Back no longer leaks the box).
- [ ] **Pin-drag** — move a pin along the box wall by dragging in the die editor (die-frame-pin hit-test +
  perimeter snap → re-`registerFreeFormFrame`). Needs a disambiguator (Alt-drag) — a plain press on a frame
  pin starts a WIRE today. Auto-placed pins are already correct (1:1), so this is refinement.
- [ ] **In-die undo of box-resize** — Ctrl+Z doesn't revert a resize (geometry lives in `FREE_FORM_GEOM`,
  not the graph/undo stack). Minor; re-resize to fix. Proper fix: carry the box in the graph.

## 2026-06-25 (141) — IMPLEMENT: build gates as subassemblies (P0–P4a ON MAIN)

From the 8-agent audit plan (`docs/cell-characterization-build-plan.md`). All web/doc, golden `0xeaac…fa24` untouched. PR #205
(P0–P3b) merged to main; P4a in a milestone-2 PR.
- ~~**P0** doc precision pass~~ — audit corrections folded into the design doc + ADR 0005/0006.
- ~~**P1** subassembly role flag + "My Subassemblies" bin~~ — `UserIc.role`, `entryRole`, board bin = ICs.
- ~~**P2** starter gate templates~~ — `gateTemplates.ts` (INV/NAND2/NOR2), "New gate ▸" seeds a solving
  CMOS die; tested (solvable netlist + FET counts).
- ~~**P3** pin roles + integration-tier badge~~ — `PinRole`, `derivePinRoles`, `integrationTier`.
- ~~**P3b** Tape out~~ — `tapeOut(tag, target?)` subassembly→IC; "⬡ Tape out" row control.
- ~~**P4a** seal-as-subassembly toggle~~ — die-editor seal panel; makes the loop usable.
- [ ] **P4 (full)** overworld box-capture — `captureRegion` (union-find boundary nets → pins, synth
  frame, re-id). Deferred (bug-prone graph surgery); design in doc §4.9.
- [ ] **P5–P9** Tier-1 telemetry → `solveCell` scratch-Sim → characterization sweep + truth-table panel →
  sequential → wide-cell fabric. P6–P9 touch sim-wasm/sim-core — land ATTENDED, per-phase gated PRs,
  re-run `golden_snapshot_hash_is_stable`. Steps in `docs/cell-characterization-build-plan.md` + doc §7.

## 2026-06-25 (140) — DESIGN: 4 player-facing/build panels

- ~~**Bench-realism + EMI kernel panel**~~ — DONE (`docs/bench-realism-and-emi-kernel.md`). Heat/reality/EMI
  instruments + the small-loop EMI estimator on the analytic AC path. Fixed: `drawJunctionConduit` lens already
  threaded; overlay lenses are NEW not REUSE; `acSweep` returns node voltages; thermistor `temp` hazard named.
- ~~**Accessibility & reach panel**~~ — DONE (`docs/ui/accessibility-and-reach.md`). 8 a11y axes + the board→prose
  engine. Fixed: player-built-board degrade example; `ConceptCard.short` is NEW authoring (4 cards need shorts).
- ~~**Mid-game + classroom + sharing panel**~~ — DONE (`docs/game-midgame-classroom-sharing.md`). Campaign pacing,
  seed-is-the-mechanism classroom, `ShareEnvelope` sharing. Fixed: digest ↔ Codec (roadmap #1); `customers.ts`
  backs the existing `standing[CustomerId]`; M0 daily local-only until the digest lands.
- ~~**Per-component reality curriculum panel**~~ — DONE (`docs/game-component-reality-curriculum.md`). Paced
  non-idealities, the order, the ease-in. BLOCKER fixed: op-amp slew NOT modeled → CLASS B; rail CLIP is the real
  time-domain bite; GBW is AC-only (Bode). Down-ranked unverified ZD/MOV/compliance.
- [ ] **Task #16 (deferred):** once the IC-maker/seal mechanic is built, design how to teach it; then fold all four
  panels' §Open-questions into `implementation-plan.md` (the single decision ledger).

---

## 2026-06-25 (139) — DESIGN: cell-char doc — §8 resolved + 3 new sections

- ~~**Resolve all §8 open questions**~~ — DONE. 14 owner decisions logged in a table at the top of §8
  (`docs/cell-characterization-and-integration-hierarchy.md`). Wide-cell = fabric; fidelity = per-instance;
  collapsed-zoom = (c) local-solve; truth-eval = Option A (TS port) + CI cross-check; etc.
- ~~**§2.9 characterization test-bench**~~ — DONE. Declare pin roles + supply; derive family/thresholds/
  voltage + auto-sweep; reuse shipped Phase-1 pin-stimuli on an offscreen scratch `Sim`; current = optional
  rating; exhaustive sweep = small-leaf-only → fabric for wide cells.
- ~~**§4.10 portrayal + proportional scale**~~ — DONE. footprint = content × σ(tier); side ∝ √(cell-count);
  σ = per-tier process-shrink = the SSI→ULSI badge; board IC = real package, subassembly = free-form box.
- ~~**§4.10a density-as-cost**~~ — DONE. heat = Real-mode derate of `RATED_CURRENT_SLOT` (FAIL mask, golden-
  safe); cost = economy. Folds in the existing density brainstorm below. Designed-around, not built.
- ~~**§4.9 overworld authoring**~~ — DONE. build → box-select → "Make subassembly"; pinout inferred from
  boundary-crossing nets; drill-in becomes re-open/inspect. The recommended easy on-ramp (Seal front-end).
- ~~**Naming**~~ — DONE. "Tape out" = packaging commit only; bare commit stays "Seal" (un-globalized).
- [ ] **NEW open (deferred, in §8):** characterization rating auto-measured vs manual; sequential sweep
  reset/enable pin; free-form box drag-anywhere vs gridded edge-pins. (Decide at build time.)
- [ ] **Cross-ref:** the "Denser/larger package variants" brainstorm below is now the build-backlog for
  §4.10a's density-as-cost design — keep them in sync.

## 2026-06-25 (138) — DESIGN: cell-characterization + integration-hierarchy exploration

- ~~**Cell characterization + live inner telemetry + integration hierarchy**~~ — DONE
  (`docs/cell-characterization-and-integration-hierarchy.md`). The "build a full CPU" mesh: sim and render are
  already decoupled, so it is a **LoD split, not a solver merge**. Dual-face cell (characterize → one
  `ELEM_BEHAVIORAL` LUT for scale; keep the discrete graph for the eye); on-zoom local DC solve on a separate
  hash-isolated scratch `Sim` for live inner V/I; subassembly-vs-IC `role` flag over the existing recursive
  sealed-cell system. 6-agent panel (SHIP-WITH-FIXES, determinism SOUND); I authored the file folding in the
  conversational refinements. Golden `0xeaac…fa24` untouched (web/render/doc only, append-and-default-off).
- ~~Powered-gate clarification~~ — captured (§2.0): "cheap digital solve" = logic-level eval of a *real powered*
  gate (VCC/GND kept; not a 3-pin teaching gate, not CMOS). ~~"Tape out" rename~~, ~~re-packaging~~,
  ~~chiplets-as-scale~~, ~~packaging-process promotion (not a one-click flip)~~ — all folded into §4.5/§4.5a/§4.9.
- [ ] **OWNER REVIEW** of the exploration (14 open questions in §8) before any implementation — owner framed this
  as "nail it on paper first; do NOT implement." Key calls to make: fidelity granularity, wide-cell route
  (LUT4 fabric vs new wider `BEH_PROG_*`), SSI→ULSI band thresholds, Tape-out button wording.
- [ ] **IF greenlit, smallest-first build order** (§7): ADR 0005/0006 reconciliation (doc) → `role` flag + "My
  Subassemblies" bin → SSI→ULSI tier badge → Tier-1 forward-eval telemetry → `solveCell` wasm + scratch `Sim` →
  the characterization sweep + flatten branch. The wide-cell **fabric** route is the real CPU-scale enabler.

## 2026-06-25 (137) — DESIGN: implementation plan + 4 deep brainstorms

- ~~**Master implementation plan**~~ — DONE (`docs/implementation-plan.md`). Consolidated owner-decision ledger
  (A–F) + the dependency-ordered build sequence. Workflow + 2 critics; restored ~12 dropped decisions.
- ~~**Contracts deep-dive**~~ — DONE (`docs/game-contracts-deep-dive.md`). Grading, the per-family SIM-PASS
  matrix, tiered-reality-vs-score (→ rider-hybrid). Fixed the aliasing clamp (all transient families) + SMPS
  harmonics → analytic path.
- ~~**Product-sim failure modes + economics**~~ — DONE (`docs/game-product-sim-failure-modes.md`). 12-mode
  catalog + reliability v2 + P&L. Fixed marginal-row recall-share + reputation scale.
- ~~**Lux + Lab Book**~~ — DONE (`docs/game-lux-and-lab-book.md`). Faucet + 5-type challenge deck → Lux →
  unlock. Firewall hardened (one-shot PREDICT/BUILD; capped generated deck).
- ~~**Tech-tree format + categorization**~~ — DONE (`docs/game-tech-tree-format.md`). Hybrid era-spine
  journey-map + era×domain. Fixed AC-render-overlay / bin-not-built / unlocksFidelity / Era-1-EC.
- [ ] **Fold the 4 brainstorms' open-questions into `implementation-plan.md`** so the ledger stays the single
  source of truth (deferred; each doc has its own §Open-questions now).
- [ ] **IMPLEMENT (cheapest first):** product-sim Phase-1 report card + the MVP economy loop (see the plan's
  phased table). Heads-up: docs referencing `coaching.ts` mean `concepts.ts` (partially built).

## 2026-06-25 (134) — DESIGN: fundamentals scaffold arc (show-don't-tell intro)

- ~~**Fundamentals scaffold arc**~~ — DONE (`docs/ui/fundamentals-scaffold-arc.md`). Show-don't-tell,
  concept-by-concept teaching (place/wire/loop-ground/carriers/colours/voltage/current) by doing+experimenting;
  read-deeper always presented; optional non-hand-holdy scaffold that **opens up at the Era-0→1 boundary**;
  lands in the contract loop. Workflow + 2 critics → fixed (machinery names `concepts.ts`/`offerConcept`;
  7-id migration of the existing 4 cards; specified-but-unbuilt dependency banners). Cross-ref in
  `onboarding-first-run.md` §11.
- **NOTE (impl):** the concept-card layer is **partially built** — `concepts.ts` `CONCEPTS`
  (source/ground/loop/reading) + `offerConcept`/`pumpConcepts`. The fundamentals doc migrates those into the
  seven fundamentals ids.
- [ ] **Doc cleanup (deferred):** beginner-onboarding §3.3 + the economy doc reference a hypothetical
  `coaching.ts` — it's actually `concepts.ts`. Minor.
- [ ] **OWNER CALLS:** unchanged — the economy balance pass + the panels' standing open-questions.

## 2026-06-25 (133) — DESIGN: product-sim + economy/progression implementation panels

- ~~**Product-simulation expansion**~~ — DONE (`docs/game-product-simulation.md`, pushed). EMI/UL cert gates,
  reliability model (FIT/RMA/recall), reputation, the all-ages teaching bridge (fleet-grid + Probe recall
  narration), golden-safe hash-seeded outcome. Canonical doc §8 points to it. Workflow + 2 critics → fixes applied.
- ~~**Economy/progression IMPLEMENTATION brainstorm**~~ — DONE (`docs/game-economy-progression-implementation.md`).
  Tree DAG + unlock table, Credits/Lux/standing earning+spending+sinks, contract loop (scratch-sim
  satisfiability), Reveal-Engine pacing, `cec.game.v1` persistence, MVP path. Workflow + 2 critics → MAJORs
  fixed (scratch-sim, part-tag reconciliation, tolerance-as-mode, credit-sink/anti-grind balance).
- [ ] **Fundamentals scaffold arc** (owner ask, IN FLIGHT) — show-don't-tell intro: place/wire/ground-loop/
  carriers/colours/voltage/current; optional, non-hand-holdy, opens up after ideal components; lands in the loop.
- [ ] **OWNER CALLS / balance pass:** economy numbers (payouts/costs/time-to-milestone), the unlock DAG order,
  product-sim tolerances; plus the panels' standing open-questions.
- [ ] **IMPLEMENT (cheapest first):** product-sim Phase-1 report card (heat+ratings); the MVP economy loop
  (ship divider → Credits → unlock a shelf). See each panel's reuse-vs-new + phased path.

## 2026-06-25 (130) — DESIGN PANELS: the Probe teaching arc + all-ages beginner onboarding
## 2026-06-25 (134) — Phase 4 Design 1: the INV (CMOS inverter) element

- ~~**INV element (Phase 4 Design 1)**~~ — DONE. First-class Inverter: 4-pin `[Y,A,VCC,GND]` (`PART_KINDS.INV`),
  expands via `CEC_COMP.INV` to a real PMOS(12)+NMOS(11) push-pull pair (golden-safe, no sim-core change); opens
  to its two FETs in zoom-to-open. Bin entry + "Logic & ICs" category; topology test in `netlist.test.ts`.
- [ ] **INV quality tiers** — map `INV.tier` onto both FETs' `Kp` (Real-mode, `tierParams("PM"/"NM")` at the two
  sub-element indices in the params loop); set `hasTiers` true. Mid = default ⇒ golden-safe. Small follow-up.
- [ ] **Phase 4 Design 2 — the 4-LUT teardown** (#11): `CEC_SRBIT` (2× INV cross-coupled + access switch, with a
  "Stored bit" inspector toggle) → `CEC_LUT4SLICE` → `CEC_LUT16` + the `examples.ts` "Inside a LUT" worked
  example. 21 user-IC instances ≪ MAX_INSTANCES; builds on the INV element just landed.
- [ ] **`inv-ic.html` 4-lead refsheet** — re-pin the canonical inverter glyph to 4 leads (docs polish).



- ~~**Probe failure-first teaching-arc panel**~~ — DONE. `docs/ui/probe-teaching-arc.md`: the 4-act hook
  (proud broken LED → blameless blow-up → resistor → divider → build-from-scratch w/ per-session **changed
  numbers**), the **Probe persona**, and two golden-safe web-side mechanics (magic-smoke over the **unhashed**
  FAIL mask; a **seeded parametric anti-copy generator + a `specMet` grader** gated *after* topology, so a copied
  layout closes the loop but misses the spec). Multi-lens workflow + 2 critics (SHIP-WITH-FIXES → fixed vs live code).
- ~~**All-ages beginner-onboarding panel**~~ — DONE. `docs/ui/beginner-onboarding-all-ages.md`: curriculum
  ramp, durable coaching system, all-ages-**by-pull** (no levels), accessibility/reach spec, no-dark-patterns
  retention, 5 persona journey maps. Cross-refs added to `onboarding-first-run.md` §11 + `game-progression.md` §1.3.
- [ ] **OWNER CALLS (open questions in both panels):** cold-open auto-run vs fire-on-Run (+ stated fallback);
  exam-placement feedback → `game-progression §7 #2`; the solo-pre-reader MVP caveat; grader tolerance band;
  seed & resistor value model (continuous vs E-series); Probe voice (TTS vs VO); the by-feel target tolerance
  for pre-readers.
- [ ] **IMPLEMENT (when greenlit) — smallest new surface (see each panel's reuse-vs-new table):** the Probe
  persona layer (over the coach-mark/anchor plumbing); the magic-smoke presentation (edge-detect on `failedMask`,
  wall-clock particles, charred tint); the shared grader/sampler + seeded parametric generator (web-side; reads
  the existing `electricalMap` + `state` Float64Array; never touches sim-core/golden). Reduced-motion + voiced
  Probe + the by-feel target renderer are the highest-leverage a11y/all-ages items.

---

## 2026-06-25 (129) — Owner: drill-in walls ≠ sealed body (WYSIWYG break → overhang)

- ~~**Die-editor walls must match the sealed package body** (#20)~~ — DONE. `dieBounds` now derives its box from
  the SEALED body margins (`IC_BODY_PAD`/`IC_LEAD_LEN` ÷ `PITCH`, exported from glyphs) instead of the 4-cell
  `DIE_END_MARGIN` — so the drill-in buildable area equals `userIcBodyBox` (the seal target): array axis overhangs
  by the small card pad, stick axis insets so the leads cross OUT (real-package look). No more authoring into
  margin that overhangs the real body. `dieEditor.test.ts` updated to the new contract. Render-only; golden ok.
- ~~**Phase 3 silicon zoom "does nothing"**~~ — DONE. `SILICON_ZOOM` 9→5, `SILICON_ZOOM_FULL` 15→8 so the
  silicon cross-section appears when a transistor reaches ~a quarter of the screen (was ~half), reachable on a
  normal zoom-in. NB it's a REALITY-lens tier (schematic/analogy never show it) — owner must be in reality lens.
  ORIGINAL ROOT CAUSE (for history): two regions use different margin conventions —
  - `dieBounds` (drill-in walls, `dieEditor.ts:122`): array axis `+DIE_END_MARGIN = 4 cells (104px)` each side;
    stick axis sits ON the lead line (0 inset).
  - `userIcBodyBox` (sealed body / opened-replica fit target, `glyphs.ts:1976`): array axis `+IC_BODY_PAD = 10px`
    each side; stick axis `−IC_LEAD_LEN = 16px` INSET each side.
  ⇒ the drill-in authoring surface is ~188px wider + 32px taller than the sealed body, so parts/wires placed in
  that extra margin fall outside the "real" package when sealed/opened. FIX (WYSIWYG): make the die-editor
  **buildable surface + soft containment** (`drawDieWalls` `board.ts:2042`, `containInDie`) track the SAME region
  the seal uses — derive the walls from `userIcBodyBox` geometry (in cells) rather than the raw `dieLayout`
  footprint + `DIE_END_MARGIN`. Keep the frame leads rendering OUT past the body (real-package look); only the
  buildable body region should shrink to the sealed body. Verify the opened replica then fills the body with no
  overhang and the existing examples/goldens are render-only-unaffected. **Queued behind the in-flight Phase 3 +
  IC-library workflows** (both touch `board.ts`/`userIcInternalsView.ts`); land after to avoid 3-way conflicts.


## 2026-06-25 (131) — IC library + user-selected variants (v1) IMPLEMENTED

- ~~**IC library + variants v1**~~ — DONE (branch `claude/ic-library-variants`). The LUT-enabler: persistent
  `localStorage` library (`userLibrary.ts`, key `cec.library.v1`) + "My ICs" bin category (places via the
  existing arm/drag path, package pin-ring glyph), auto-add on seal/reseal, `FAMILIES` registry in `userIc.ts`
  (`resolveUserIc`/`userIcVariants`/`hasUserIcVariants`/`appendUserIcVariant`/`registerUserIcFamilies`/
  `registerUserIcFamily`), flatten membership widened to `REGISTRY.has || FAMILIES.has` (golden-safe no-op
  intact), variant selection a pure graph→graph choice before `buildNetlist`, inspector + arm-time variant
  picker (reuses `selVariant`/`setVariant`), seal-panel "Variant of …" dropdown, `userIcFamilies` save sidecar
  (board blob + download envelope + load registration). Golden `0xeaac…fa24` unmoved. Gate green (web check 0,
  lint, build, test 94 — +9 `userIc.variants.test.ts`).
- All 8 cross-check gaps handled (see HANDOFFS 129). **Deferred:** `cec-iclib` export/import envelope,
  board-load "add to library" banner, per-row rename/delete chrome, cross-package variants (CRUD primitives
  kept exported + callable).

## 2026-06-24 (123) — Owner queue: opened-IC polish, bridges-over, mesh; reality-lens panel

- ~~**Opened-IC fit + part orientation**~~ — DONE (PR #189). Fit to the body rectangle; orient parts like the
  die editor (canonical pins + child rot/**mirror**); render-only `mirror` on `UserIcInnerPart`.
- ~~**Bridges render OVER not under**~~ — DONE (PR #190). `wireDrawOrder` topo draw order; 10-case test.
- ~~**Pipe↔component mesh coupling**~~ — DONE (PR #191). Flange collar at pin ends in `drawConduitSkin`
  (`ends` arg); 3-panel brainstorm. First cut — radii tunable.
- [ ] **Reality-lens + junction redesign** (#17) — panel → `docs/ui/reality-lens-and-junctions.md` → implement.
  Reality lens should read as real electronics (copper/solder/vias/pads/leads), distinct from analogy plumbing,
  at every tube/contact/junction; better junction forms (solder dome / tap-count manifold; 2-way invisible;
  small-scale fallback). Thread `lens` into `drawJunctionConduit` (the missing param).
- [ ] **Phase 2** recursive zoom-to-open (#9, flagship) — next after the reality-lens doc+first-cut.
- [ ] **Phase 5** zoom meter (#12), **Phase 3** silicon leaf (#10), **Phase 4** LUT + CEC9002→Inverter element
  (#11), **replica follow-ups** lead-connectors/gauges/flow-dots (#16).

## 2026-06-24 (122) — Recursive-IC LoD Phase 1 LANDED (recursive nesting)

- ~~**Phase 1: recursive `flattenUserIcs`**~~ — DONE, merged to main (PR #188, `a06b708`). Wave-based fixed
  point; nested cells inline to a fixed point. Bounds: MAX_INSTANCES=4096 (fan-out/cycle), MAX_DEPTH=24 +
  truncation warn, id-range disjoint bump. Golden-safe (single-level byte-identical).
- ~~**Nested save round-trip**~~ — DONE. `userIcsForGraph` collects nested defs transitively.
- ~~**Audit Phase 1 with a panel**~~ — DONE. 3 reviewers (determinism GOLDEN-SAFE, consumer SHIP, correctness)
  → all findings (DoS cap, depth warn, collision, save-embed) fixed + probe-verified.
- ~~**Phase 2 Part A** — recursive zoom-to-open LoD~~ — DONE (branch `claude/phase2-part-a`). `flatId` (=
  `comp.id + offset`) added to `UserIcInnerPart`; `drawUserIcInternals` recurses into a nested sealed-IC inner
  part when `cumulativeScale·s·cameraZoom ≥ INTERNALS_ZOOM`, depth-guarded at `RECURSE_MAX_DEPTH = 24`, pooled
  per-slot subtree destroyed on cull. Live signals free via each level's `nodeOfInner` + the same `nodeV`.
  Parts B/C of the doc were already landed in the base case. Golden untouched. **Cross-check follow-up (PR #197):**
  added the A.4 **VIEW cull** (`holderNearViewport` — skip + free off-screen inner parts via `worldTransform`, one
  full-viewport margin) so deep zoom into one cell doesn't redraw every off-screen sibling subtree; corrected the
  `s<1` termination comment (the real guarantee is `RECURSE_MAX_DEPTH` + view cull, not an `s<1` assumption).

## 2026-06-24 (121) — Recursive-IC LoD Phase 0 LANDED (opened IC via the real pipeline)

- ~~**Phase 0.1–0.4: extract `boardRender.ts`**~~ — DONE (commit 0ac09d0). `this`-free render engine + route
  family + `UserIcInternals.{innerGraph,nodeOfInner,frameId}`.
- ~~**Phase 0.5/0.6: opened IC runs the real board pipeline in a scaled container**~~ — DONE, merged to main
  (PR #187, `00c2940`). Rail-identity `voltageColor` (moved to boardRender), junction-follow-pass, crossing
  dots, null-aware nets (floating→cyan / static→grey, no phantom ties), fit floor + NaN guard.
- ~~**Audit every step with a panel**~~ — DONE. 4-reviewer panel + fix-verification → SHIP (0/0).
- [ ] **Phase 0 follow-up — lead-connectors** — restore the stub tying each inner net out to its package pin
  (deferred; `TODO(phase-0-followup)` in `userIcInternalsView.ts`). Owner to eyeball whether it's needed.
- [ ] **Phase 0 follow-up — per-net gauges/standpipes + carrier flow-dots** — need a per-inner-wire current
  the `UserIcInternals` struct doesn't carry yet.
- [ ] **Phase 1** — recursive `flattenUserIcs` (fixed-point, depth-guarded); golden-safe no-op when no sealed
  IC placed. (Unblocks nested cell libraries — the LUT-explosion fix.)
- ~~**Phase 5** (owner request 2026-06-24) — zoom meter (magnification readout) + scale-reference bar HUD.~~
  DONE. `web/src/lib/zoomMeter.ts` (pure, unit-tested) turns camera `zoom` + the nesting-level `viewScale`
  (recorded by a per-frame renderer probe at the view centre — deepest opened IC body under the centre) into
  `×M` + a snapped scale rule that ramps board-cells → mm → µm → nm. HUD pinned bottom-left (`App.svelte` +
  `.zoom-meter` in `app.css`). Render-only; golden untouched. Anchor `MM_PER_TOP_CELL = 2.54` is tunable.

## 2026-06-24 (118) — User IC: connection at the leads, pads removed, freed interior + conduit traces + lens

- ~~**Connection at the external leads, internal pads removed**~~ — DONE. `userIcPartKind` pushes pins out
  to the lead tips (`LEAD_GAP=1`); `userIcBodyBox` insets the body inside them (`IC_LEAD_LEN=16`/
  `IC_BODY_PAD=10`); `board.ts` draws no round pad for user ICs. Pads no longer overlap the internals.
- ~~**Circuit fills the full package interior**~~ — DONE. Replica affine retargeted to the body interior.
- ~~**Inner traces = proper conduit pipes + junctions**~~ — DONE. Moat + coloured core + carriers, grommet
  per end, junction hub where 3+ tie (was flat gray lines).
- ~~**Inner parts follow the board lens**~~ — DONE. `drawGlyphIn(child, opts, style)` with a lens-derived
  style (analogy → factory, else schematic).
- [ ] Owner eyeball the opened IC (leads-only connection, filled interior, pipe traces, lens-following parts).

## 2026-06-24 (117) — IC body = full-size frame card, pads inside, leads stick out

- ~~**Body = actual frame outline (not a sliver)**~~ — DONE (glyphs.ts). `userIcBodyBox` = pin bbox grown
  by `IC_BODY_PAD=10` every side (matches `drawCard`); SOT-23-5 body 72×46 (was a 12px sliver). Every
  archetype.
- ~~**Round pads INSIDE + rectangular leads OUT**~~ — DONE. Pads reverted to round (board.ts), leads stick
  out `IC_LEAD_LEN=11` past the body (glyphs.ts). Replica simplified (no snap/dot/pipe).
- [ ] **Connection pins at the OUTER lead tips** — wires still connect at the round pad inside the body
  (like the SOT23_5 ref). Moving the wire connection out to the lead tip = deeper change (board routes to
  the pin's grid cell). Pending owner confirm.
- [ ] Owner eyeball the full-size frame body + leads on a placed/opened IC, every archetype.

## 2026-06-24 (116) — Fix: IC body full-size, leads extend out

- ~~**Body narrowed instead of leads extending**~~ — DONE (glyphs.ts). `userIcBodyBox` now keeps the body
  FULL pin extent on the short axis; `drawUserIcPackageBody` draws the rectangular leads sticking OUT past
  the body (was: body inset by the lead length → thin sliver). SOT-23-5 body short side 26px (was 12).
- [ ] Owner eyeball the full-size body + extending leads (placed + opened).

## 2026-06-24 (115) — Taper panel fix + IC package connection redesign + standpipe auto-realign

- ~~**Jank tapers/junctions**~~ — DONE (board.ts, design-panel-led). Triangular port-mouth flare → round
  GROMMET disc; junction nubs+hub → dark collar disc + opaque swallowing hub. Dead `junctionDirs`/params
  removed.
- ~~**IC package connection redesign**~~ — DONE. Body overhangs end leads (corner leads inset); elongated
  rectangular leads (`IC_LEAD_LEN` 5→7); open replica draws internal connector DOT + short pipe → lead per
  pin (frame-pin wire-ends snap to the dot); `dieBounds` walls overhang end leads (`DIE_END_MARGIN=4`) so
  builder pads aren't in corners; die frame draws rectangular leads sticking out.
- ~~**Down-bend routing**~~ — DONE (board.ts). `dieFramePinExit` + `frameLeadRoute`: a die-frame-pad wire
  exits perpendicular with one elbow (committed + live preview); ordinary board untouched.
- ~~**Package text fades on zoom**~~ — DONE (board.ts). User-IC designator → transparent as zoom →
  INTERNALS_ZOOM.
- ~~**Standpipe/gauge auto-realign**~~ — DONE (board.ts `netGaugeAnchors`). Tries ALL of a net's routes
  (longest-first) + slides; GND gauge relocates off other pipes.
- [ ] **Owner eyeball** the IC redesign + builder + tapers/junctions + zoomed text + crowded GND gauge;
  fine-tune the lead/dot constants (`IC_LEAD_LEN`, `LEAD_W`, `DIE_END_MARGIN`, `dotInset` frac) if needed.

## 2026-06-24 (114) — IC internals proportional fit + rectangular leads + pipe-fix round 2

- ~~**IC internals align with the leads by pure scaling**~~ — DONE. `dieLayout` (packages.ts) is now the
  production footprint × `DIE_SCALE=8` (proportional, same aspect); `drawUserIcInternals` maps frame-pin
  bbox → package-pin bbox so frame pins land exactly on the leads with NO re-routing. Tests updated to the
  proportional contract (dieEditor.test.ts). Render-only; golden untouched.
- ~~**Rectangular solder leads + pads on user ICs**~~ — DONE. `drawUserIcPackageBody` (glyphs.ts) draws flat
  rectangular metal leads; `board.ts` draws a rectangular solder pad (not a round dot) at each lead tip; the
  internal side shows only the connecting wire out to the lead.
- ~~**Pipe taper translucency clash**~~ — DONE (board.ts). Port-mouth flare is now opaque (dark moat funnel +
  opaque core funnel) on pins-to-parts and junctions.
- ~~**Bridges layered-over / abrupt opacity near junctions**~~ — DONE (board.ts). Bumps resized (`BUMP_W`
  8→11, `BUMP_H` 11→17) + crossing dead-zone widened to `BUMP_W` so each hop fits inside its segment. Bridges
  kept (owner likes them).
- [ ] **Standpipe/gauge relocation** — the GND gauge still overlaps pipes. `netGaugeAnchors` should try ALL
  of the net's routes (not just the longest) and slide to the first clear box; fall back to the least-bad.
  (The 4th of the owner's pipe screenshots; deferred from this round.)

## 2026-06-24 (113) — Game-design brainstorm trilogy (docs)

- ~~**Game-design master brainstorm**~~ — DONE. `docs/game-design-master-brainstorm.md` (5-lens synthesis:
  contracts spine, fidelity-as-progression, two-currency economy, debugging-as-verb, wildcard appendix).
- ~~**Divergent idea bank**~~ — DONE. `docs/divergence-idea-bank.md` (~250 unfiltered ideas, 7 domains,
  constellations, wildest-25).
- ~~**Grounded directions roadmap**~~ — DONE. `docs/grounded-directions-roadmap.md` (triage → NOW/NEXT
  slate, LATER, 6 moonshots, cuts/traps, 3 pickable thrusts A/B/C). The actionable bridge from the well.
- [ ] **Owner decision:** pick a near-term thrust (A deepen reality ramp / B social-UGC loop / C learning
  loop+reach), or green-light the keystone cheap spikes (sensor channel, web-side thermal `Tj`, Ear Lens).

## 2026-06-24 (112) — Pipe quick-wins + remove device tubes + IC package leads/filled internals

- ~~**Pipe-legibility quick-wins**~~ — DONE (board.ts): opaque conduit core (QW1) + dark moat (QW2) so
  crossings occlude; opaque junction hub (QW5); `NUDGE_SPACING` 9→13 (QW4); quieter carriers (QW3) +
  capped/dimmer shimmer (QW8). Deferred: crossing hop-knockout (QW6/7), gauge-chrome cull (QW9).
- ~~**Remove "tubes into each component"**~~ — DONE. The per-pin `connectorGlyph` stubs are gone; wire
  conduits still land on the pins.
- ~~**IC package: leads on the outside + readable internals**~~ — DONE. New `userIcBodyBox` +
  `drawUserIcPackageBody` + `drawUserIcPackage` glyph (glyphs.ts): leads from each pin to a dark body;
  `userIcInternalsView` fills the BODY box with the circuit (was crammed into the whole footprint). All
  render-only; golden untouched. Owner to eyeball.
- [ ] **Follow-up (if internals still small on SOT-23):** enlarge the package body when zoomed into the
  replica (the short footprint limits a square circuit to the body height).

## 2026-06-24 (111) — IC pin-label overlap fix + per-circuit gauge scaling

- ~~**Placed user-IC pin labels overlapped at zoom-in**~~ — FIXED. The (108) 1:1 lead-bridging anchored
  the replica pins/labels at the die-editor layout scaled into the tiny SOT-23 footprint (~50× shrink →
  pins crushed together → labels collide). Reverted: labels + dots back at the spread COMPACT package
  positions; replica anchors at `pins` again; dead `miniPinPx`/`outPinPx` removed. (`pinCells` kept in
  `netlist.ts` for a future PROPER bridging — anchor leads to the package edges, route inner wires out.)
- [ ] **Follow-up (deferred): proper 1:1 lead-bridging** — anchor the inner circuit's frame-pin wires
  to the package edge positions (not the die layout scaled into the footprint), so leads visibly reach
  the edge pins without collapsing. Use `UserIcInternals.pinCells` (already built/tested).
- ~~**Standpipes shared one "highest voltage" across unconnected circuits**~~ — FIXED. A DC loop read low
  beside a higher-peak AC loop it wasn't wired to. `buildNetlist` now emits `circuitOfNode` (union-find
  over element terminals, ground NOT a bridge); `board.ts` scales each gauge to its OWN circuit's max
  (`circuitVMaxByGroup` + `circuitGroup`), wired via `setCircuitOfNode` in `rebuildNetlist`. Render-only;
  golden untouched. +1 test.

## 2026-06-24 (110) — Pipe-view legibility design review (doc) + OR-gate seal triage

- ~~**Design review: analogy pipe-view legibility in dense areas**~~ — DONE (doc). 3-lens workflow →
  `docs/pipe-legibility-review.md`. Root cause: one flat translucent Graphics, no opaque primitive, so
  overlapping pipes SUM into bloom instead of occluding. Ranked diagnosis + a quick-win bundle + structural
  options + recommendation, all render-side / golden-safe.
- [ ] **Implement the pipe-legibility quick-wins** (owner wants a before/after look first): QW1 opaque
  conduit core + QW2 dark moat + QW5 opaque junction hub (the structural trio); QW6/QW7 crossing
  dead-zone + hop knockout; QW4 `NUDGE_SPACING` 9→13; dimming polish QW3/QW8/QW9/QW10. See the doc §2/§4.
- [ ] **(structural, owner decides)** S2 hover/selection FOCUS-dim — bright the net you care about, wash the
  rest. The truest fix for "lots of things close together." Doc §3.
- **OR-gate "can't be sealed" (file cfdfd3ed)** — NOT a code bug: reproduced headlessly and the current
  branch seals it (`dieIsSealable(dieTestGraph(graph,1))`=true). It's the pre-`dbd916f` Seal-gate behaviour
  → owner's running build predates the reseal-gate fix; rebuild/redeploy from the branch.

## 2026-06-24 (109) — Voltage gauges: fixed full-scale standpipe + halfway marker, DC "~" bug

- ~~**"~" AC badge fired on a DC loop (owner bug)**~~ — FIXED. Both voltage gauges shared a swing test
  `(|vmax| + |vmin|)/vMax` that only equals peak-to-peak for a centre-zero net; on a +5 V DC rail it read
  ~2 → the badge + spurious tide band showed. New shared `netSwing` helper uses `vmax − vmin` (=0 for DC).
  Both `drawNetBars` + `drawNetStandpipes` call it (dedup), so DC shows neither the "~" nor the wet-mark,
  and real AC is unchanged.
- ~~**Standpipes now fixed full-scale with a halfway marker (owner ask)**~~ — DONE. The glass is a FIXED
  height (top = the loop's max rail `vMax`) instead of being sized to its fill, so every net's waterline
  reads against the same scale; fill = the node's voltage (already true); added a faint half-scale tick at
  vMax/2 (±vMax/2 for bipolar). LED bar unchanged (already segmented). Render-only; golden untouched.

## 2026-06-24 (107) — Deeper zoom + datasheet edge-mounted pin labels (+ connector/BGA ideation)

- ~~**Deeper zoom (fill the screen with an IC)**~~ — DONE. `MAX_SCALE` 8 → 20 in `board.ts` so you can
  zoom right into a placed chip to read its internals.
- ~~**Edge-mounted pin labels (datasheet style, not on top of the chip)**~~ — DONE. Pin labels now sit
  OUTSIDE the body on the edge each pin is on. New `labelPushVertical` (from the pin spread: SOT-23 ⇒
  vertical, DIP ⇒ horizontal); labels push `LABEL_MARGIN` out in local coords then `rotPx`-rotate so
  they track the real edge at every rotation/mirror, staying upright. Same across placed parts, sealed
  user ICs, and die frames.
- ~~**Literal 1:1 zoom-in lead-bridging**~~ — DONE. The zoom-to-open replica now draws each external
  package pin WHERE THE AUTHORED WIRE LANDS (the frame's die-editor pin cell), so the inner circuit
  visibly bridges out to the boundary pins — a 1:1 of the die you built. Added `pinCells` to
  `UserIcInternals` (frame's authored pin cells, computed via `framePinCells` in BOTH `userIcGeometry`
  and the live builder); `userIcInternalsView` anchors the dot + energised lead at `toPx(pinCells[i])`
  and reports the px via `outPinPx`; `board.ts` parks the pin LABEL there (reusing the `pinTexts` pool)
  and skips the compact pin dots when the replica is open (`showUserIc`), and labels the replica's pins
  whenever it's open (not gated on `DETAIL_ZOOM`). +1 assertion (geo/live `pinCells` match).
- ~~**Brainstorm: connectors + large/many-pin packages (BGA "and whatnot")**~~ — DONE. New
  `docs/connectors-and-large-packages-ideation.md`: data-driven layout engine, 4-side QFP, dedicated
  §2A BGA anti-clutter treatment (progressive-disclosure ball-map, X-ray/flip, fan-out stubs,
  pick-by-coordinate). Connectors (VGA/USB) repositioned as "later, fun." All no-element ⇒ golden-safe.

## 2026-06-24 (106) — Global ground unification + package/pinout verification

- ~~**Multiple GND symbols not sharing a reference (owner bug)**~~ — FIXED. An AND gate with three
  separate 5 V sources + a "common ground" wouldn't solve until all pins were linked to one source.
  Root cause: `buildNetlist` made only the FIRST wired GND part node 0; every other GND symbol was a
  separate isolated net, so a multi-symbol "common ground" floated as disconnected reference islands.
  Fix: union **every** `GND` pin onto one global ground (node 0) — real schematic convention, no wire
  needed between ground symbols. Node-0 selection now requires the unified ground to carry ≥1 non-GND
  pin (`netHasNonGnd`), so lone floating grounds don't falsely solve. Web-side (`netlist.ts`) only;
  deterministic; golden untouched. +2 tests (two un-wired grounds → one node 0; floating grounds → null).
  - Verified the non-bug half: voltage sources genuinely CAN share one ground (the owner's exact
    flattened netlist solves to Y≈5 V in sim-core; the solver handles parallel ideal sources w/o NaN).
  - Ground-loop sim is NOT blocked by this (loops need finite ground-trace impedance, a separate future
    mechanism; an ideal node can't show a loop regardless) — see invisible-electronics-ideation.md.
- ~~**Package/pinout + rotation-text verification (owner ask)**~~ — DONE, no change needed. Cross-checked
  `packages.ts` SOT-23-3/5/6, DIP/VSSOP-8/14/16 against JEDEC pinouts (all correct), and confirmed pin
  labels stay upright + aligned at all 4 rotations + mirror (`rotPx`, labels on the un-rotated `view`).

## 2026-06-24 (105) — IC reseal-gate fix + placed-IC pinout labels + unpowered zoom-to-open

- ~~**BUG: "die can't be sealed yet — doesn't solve" on Reseal (owner, af0060c9)**~~ — FIXED. The
  Seal/Reseal button's hard gate (`dieSeal` in `App.svelte`) still checked the RAW `buildNetlist(live)`
  (from the original IC-maker commit, pre-stimuli), so a logic die powered from OUTSIDE its package
  (CEC9001 AND gate — needs the frame's GND/VCC/input TEST STIMULI to solve) was blocked even though
  the `dieStatus` "● solvable" pill — which gates on the stimuli-aware `dieIsSealable(dieTestGraph(...))`
  — said it was fine. Now `dieSeal` gates on the SAME `dieIsSealable(dieTestGraph(live.serialize(),
  innerFrameId))`, so the pill and the button agree. Seal CAPTURE still reads the RAW graph (sealed IC
  = real discrete parts, ADR 0005, golden untouched). Invariant already covered by `dieEditor.test.ts`.
- ~~**Pinout labels on a placed sealed user IC (Task B)**~~ — DONE. `board.ts` `showPins` now includes
  `isUserIc(this.kindTag)`, so a placed CEC9xxx shows its pin names (the player's pad names A/B/GND/Y/
  VCC, already on `PART_KINDS[tag].pins[i].label`) at detail zoom — like a real datasheet pinout — not
  only when the zoom-to-open miniature is open.
- ~~**Zoom-to-open shows the authored circuit even UNPOWERED (Task C)**~~ — DONE. The mini-board used
  to require a live solve (the `userIcInternals` map is built inside `buildNetlist`; null when the board
  doesn't solve). New node-free `userIcGeometry(def)` in `netlist.ts` (same parts/wire-cells/bbox as the
  live builder, nodes zeroed); `userIcInternalsView.ts` `nodeV?` optional (draws at level 0 when absent
  — rail wires, no carriers); `board.ts` falls back to a cached `userIcGeometry(getUserIc(kindTag))`
  when there's no live map (rebuilt only on a reseal), and the `showUserIc` gate dropped its
  `nodeV !== undefined` requirement. So a chip placed without external power opens to its real circuit
  (static) instead of a black box. Built-in composite internals stay live-only (out of scope). +1 test.
- Determinism: presentation/web-side only — no `crates/` change; golden `0xeaac_3764_99e4_fa24`
  unchanged (188 Rust tests green).

## 2026-06-24 (104) — Persist in-progress (unsealed) dies + re-open a raw saved die into the builder

- ~~**Persist the in-progress (unsealed) WIP dies with the board**~~ — DONE. The WIP-die map
  (`innerGraphs` in `App.svelte`, keyed by OUTER frame id) is no longer in-memory-only: it now
  rides in the save's new `innerDies?: { frameId; graph }[]`. New pure, headless helpers in
  `dieEditor.ts`: `innerDiesForSave(innerGraphs, graph)` (the entries whose frame is still PLACED on
  the board — stale entries for deleted frames are dropped) + `restoreInnerDies(innerDies, map)`
  (clear + rebuild). Embedded at **all** save/load sites: the download envelope (`saveCircuit`,
  **version 2 → 3**) + `onLoadFile` in `App.svelte`; the localStorage blob (`saveBoard`/`loadBoard`
  in `storage.ts`, `loadBoard(innerGraphs?)` restores into the live map); and `fromSaved` in
  `examples.ts` (optional map param). The capture point already existed (`dieBack`/`dieSave` write
  `innerGraphs.set(frameId, board.serialize())` before `exitDie`, whose `swapGraph` then re-persists
  the outer board — now with the dies). **Backward-compat:** `innerDies` omitted when empty; any
  v1/v2 save loads exactly as before (an absent field clears the map to empty).
- ~~**Re-open a RAW saved `__DIE_*` graph straight into the die builder**~~ — DONE. New pure
  helpers `isStandaloneDieGraph(snap)` (only frame is the internal `__DIE_*` die-frame, vs a normal
  board) + `placeableFrameTag(dieTag)` (strip the `__DIE_` prefix). `onLoadFile` detects a die saved
  in isolation and calls the new `openDieGraphInBuilder(snap)` (App.svelte): synthesize a fresh outer
  board, place the matching PLACEABLE frame, stash the loaded die under its id, then drill in (mirrors
  `buildSelectedFrame`). So loading the owner's existing die files drops you into the editor with the
  circuit, ready to Seal — instead of a flat board with the die-frame as a placed part.
- ~~**Tests**~~ — DONE (`dieEditor.test.ts`, +8): innerDies round-trip (JSON stringify/parse → the
  WIP survives, ids/values intact), placed-vs-stale filtering, `restoreInnerDies` clears first,
  `placeableFrameTag` inverse, and `isStandaloneDieGraph` true/false cases (bare die, built die,
  normal board, board with an empty placeable frame).
  - **Owner visual review:** save an unsealed WIP (build inside a frame, exit, Save/refresh) →
    reload → re-drill the frame restores it; load a raw `__DIE_*` file → opens in the IC builder.
- Determinism: graph/save plumbing only — an unsealed frame has no sim element, and a sealed/placed
  IC still flattens to its real parts at `buildNetlist`. No `crates/` change; golden unchanged.

## 2026-06-24 (103) — Four rendering/UX QoL (rotate/flip in place, ghost pinout/lens, pipe declutter)

- ~~**Rotate & flip a part IN PLACE (about its footprint centre, not the anchor)**~~ — DONE. New
  pure helpers in `graph.ts`: `footprintCenter(kind)` (fractional bbox-centre of pin offsets) +
  `rotateInPlaceShift` / `flipInPlaceShift` (the rounded `cell` shift that holds the centre fixed
  across a rot/mirror change). Wired into `board.rotateSelection`/`flipSelection` (per selected
  part — each pivots about its own centre, was per-anchor swing) AND the armed ghost via a new
  `armedCellShift` accumulator (bumped in `rotateArmed`/`flipArmed`, added to the snapped cell in
  `updateGhost` + the drop). One undo. Geometry only (pins keep INDEX) → netlist byte-identical.
- ~~**Pin labels in the armed ghost**~~ — DONE. `ghostPinTexts` pool + `layoutGhostPinLabels` draw
  the pin names at the ghost's rotated/flipped pins, matching the placed-part `pinTexts` style.
- ~~**Ghost follows the active lens (reality/analogy)**~~ — DONE. New `ghostGlyphHolder` +
  `ghostTierGlyph`; `updateGhost` mirrors `ComponentNode.update`'s tier-selection (lens + TIER_ZOOM)
  and previews `drawDetail`/`drawAnalogy`, falling back to the schematic glyph.
- ~~**Pipe-view (conduit/analogy) declutter**~~ — DONE (visual tuning, palette tokens only):
  shrank the conduit junction node (`drawJunctionConduit` `pw` 6→5, shorter nubs, smaller hub),
  cleaned the device pipe-in stubs (`connectorGlyph` now starts inside the pin so it doesn't double
  the wire's port mouth — the MOSFET "doubled stub" — narrower + lower alpha), and reduced pipe
  width + wall/core alpha (`drawConduitSkin`). Exact constants in HANDOFFS (103) for easy nudging.
  - **Owner visual review:** in-place rotate/flip at all 4 rotations on asymmetric parts; the
    ghost pinout + lens preview; the pipe view under the analogy lens.

## 2026-06-24 (102) — Re-open + reseal a sealed user IC, and persist sealed-IC defs

- ~~**Persist sealed-IC definitions + re-drill to edit + reseal-updates-the-def**~~ — DONE.
  Three problems fixed for the IC maker (ADR 0006): (a) a sealed `CEC9xxx`'s inner definition
  lived only in the in-memory `userIc.ts` REGISTRY, so save+reload turned every placed instance
  into an unknown kind; (b) no way to re-open a sealed chip to edit it; (c) a reseal had to mint a
  new tag. All three shipped.
  - **Persist:** new `userIcsForGraph(graph): UserIc[]` (the defs for every distinct user IC
    PLACED in the graph) + `registerUserIcs(defs)` (idempotent batch register) in `userIc.ts`.
    The downloaded save envelope gained an optional `userIcs?: UserIc[]` (**version 1 → 2**;
    omitted when empty, so a plain board's save is byte-identical and an older save with no
    `userIcs` loads exactly as before). Embedded at the **three** load sites: the Download/Load
    file path (`saveCircuit`/`onLoadFile` in `App.svelte`), the **localStorage** autosave/restore
    (`saveBoard`/`loadBoard` in `storage.ts`, wrapped in a `{ graph, userIcs? }` blob that also
    accepts a legacy bare snapshot), and `savedExample`/`fromSaved` (`examples.ts`). Every loader
    re-registers the defs BEFORE the graph is restored, so the placed `CEC9xxx` kinds resolve.
  - **Edit (re-drill):** an **Edit ▸** button in the inspector for a placed sealed user IC
    (`isUserIc(selPart.kind)`), mirroring the frame's **Build**. `editUserIcSelected()` reuses the
    drill machinery — stash the outer board/camera, `swapGraph(structuredClone(ic.graph))` (a COPY
    so edits don't touch the registry until reseal), `setDieFrame(ic.frameId)`. The `drill` state
    gained `editingTag?: string` (the IC being edited; `buildSelectedFrame` leaves it undefined =
    "mint a new CEC9xxx on seal").
  - **Reseal:** new `resealUserIc(tag, graph, frameId, pinNames?)` in `userIc.ts` — swaps the
    existing `UserIc`'s graph + pin names while keeping its tag/name/package, then re-runs
    `registerUserIc` (re-derives `PART_KINDS[tag]`), so every placed instance follows. `dieSeal()`
    branches on `drill.editingTag`: reseal into the same tag + exit WITHOUT minting/re-kinding
    (instances are already kind=tag); the fresh-frame path is unchanged. Chosen over re-running
    `captureSeal` with the tag-as-name (which would force `name === tag`, losing a free-form name).
  - **UX:** back-bar breadcrumb reads **"Editing <tag>"** and the Seal button reads **"Reseal ✓"**
    when editing; the seal-name field + Save button are hidden in the edit flow (the tag is fixed).
    Edit is a no-op for a stale tag (`getUserIc` undefined).
  - **Determinism:** definition+presentation only — a sealed IC still flattens to its real discrete
    parts at `buildNetlist` (seal-as-same-netlist). **No sim-core change; golden
    `0xeaac_3764_99e4_fa24` unchanged.** New vitest (`netlist.test.ts`, +2 → **50**): a
    persistence round-trip (`userIcsForGraph` → JSON → `unregisterUserIc` → `registerUserIcs` →
    placed instance still equals the inline netlist) and a reseal-updates-the-def check (1k → 2k,
    one registry entry, placed instance recompiles the 2k).
  - **Owner visual review:** drill-into-a-sealed-IC, the Reseal flow, and that placed instances
    visibly update (footprint/pin labels) after a reseal.
  - Files: `web/src/lib/userIc.ts`, `web/src/lib/storage.ts`, `web/src/lib/examples.ts`,
    `web/src/App.svelte`, `web/src/lib/netlist.test.ts`.

## 2026-06-24 (100) — Mirror / flip a component (placement QoL)

- ~~**Mirror/flip a component**~~ — DONE. Any placed (or armed, or pasted) part can now be
  **horizontally flipped** beside rotation — notably to put a P-MOSFET source-up without the
  180° rotation also moving the gate. A new optional `Component.mirror` (a horizontal reflection
  `dx → −dx` applied BEFORE `rot`): `orient(dx,dy,rot,mirror) = rotateOffset(mirror ? −dx : dx, dy, rot)`,
  implemented as an optional 4th param on `rotateOffset` (graph.ts) and the pixel-space `rotPx`
  (board.ts), both defaulting false so every existing 3-arg caller is unchanged.
  - **Render:** `ComponentNode.reposition()` sets `glyphHolder.scale.x = mirror ? -1 : 1` THEN
    `rotation` — PixiJS applies scale before rotation, so it composes exactly like the reflect-then-
    rotate `rotateOffset`, and the body lines up with the pin dots/labels at all 4 rotations. Same
    `scale.x` on the armed ghost + the paste ghost so the preview shows the flip.
  - **Threaded** through every orientation site: `pinCell`, `componentBox`, gauge-routing
    (`pinOutward`), the `rotPx` callers (pin labels + FAIL box), the inspector reference pinout
    (`pinoutOf` gained an optional `mirror`; `SelectedPart.mirror` feeds it), serialize/restore
    (deep-copied, falsy flip dropped — mirrors the pinNames/pinTests pattern), and paste (each
    part carries its own `mirror`; no group reflection).
  - **Actions:** `board.flipSelection()` (toggles `mirror` on the selection, one undo) +
    `board.flipArmed()` (toggles `armedMirror`, refreshes the ghost; carried into `placeCell` so a
    part drops pre-flipped). `App.svelte`: an **F** keybind (armed → `flipArmed`, else `flipSelection`)
    beside R, a **Flip** button next to Rotate, and "F flip" added to the placement hints.
  - **Determinism:** geometry/render only — pins keep their INDEX, so wire endpoints (pin refs)
    and the union-find keys (`id:pinIndex`) are unchanged → connectivity + the compiled netlist are
    byte-identical regardless of flip, exactly like rotation. **No sim-core change; golden
    `0xeaac_3764_99e4_fa24` unchanged.** New vitest (`netlist.test.ts`, +4 → **46**): the
    x-negated-rotation identity, a mirrored `pinCell`, serialize→restore round-trip, and a
    flip-doesn't-move-the-netlist determinism check (types/values/a/b/c + nodeCount byte-identical).
  - **Owner visual review:** confirm a flipped glyph's body aligns with its pin dots/labels at all
    4 rotations for the asymmetric parts (PMOS/NMOS, BJT, op-amp, gates, transformer). The armed +
    paste ghosts mirror via `scale.x` like the live holder.
  - Files: `web/src/lib/graph.ts`, `web/src/lib/board.ts`, `web/src/lib/pinout.ts`,
    `web/src/App.svelte`, `web/src/lib/netlist.test.ts`.

---

## 2026-06-24 (98) — Settable per-pin TEST STIMULI in the IC-maker die editor

- ~~**Die-pin test stimuli (power a die in isolation so it solves + seals)**~~ — DONE. A logic IC is
  powered through its VCC/GND pins from OUTSIDE its package, so a die solved in isolation in the editor
  had no ground reference (`buildNetlist` → null → "not solvable", couldn't test or seal). Now each
  frame pad can carry a **TEST stimulus** — **GND** (0 V ref), **VCC** (settable supply), or **Input**
  (settable drive) — injected as virtual sources ONLY for the live die solve + the Seal gate.
  - `graph.ts`: new `PinTestRole` / `PinTest` types; `Component.pinTests?: (PinTest | null)[]` (sparse,
    by pin index), deep-copied in `serialize`/`restore` beside `pinNames`.
  - `dieEditor.ts`: new `dieTestGraph(snapshot, frameId)` returns a COPY with the frame's stimuli
    injected (one shared virtual `GND`; a `V` per VCC/IN pad, `+`→lead, `−`→that ground; a wire for
    each GND pad) at far-off cells — or the SAME snapshot reference (strict no-op) when there are no
    stimuli. Authoring-only; never fed to `captureSeal`.
  - `board.ts`: `setComponentPinTest(id, pinIndex, test)` (mirrors `setComponentPinName` but fires
    `onChange` so the netlist rebuilds); the `onPinNameEdit` payload gained `test: PinTest | null`.
  - `App.svelte`: `rebuildNetlist` + `dieStatus` solve/gate the INJECTED graph when drilled in
    (`dieSolveGraph` / `dieTestGraph`); a `boardRev` counter refreshes the seal advisory on a stimulus
    change; the pad popover gained a **None/GND/VCC/IN** role row + a volts input (live-applied), with a
    **guarded blur** so clicking a role/value doesn't close the panel under the player. New CSS in
    `app.css` (`.pin-test-*`).
  - **Determinism preserved (HARD RULE):** the seal capture path is untouched (raw die graph), so the
    sealed netlist + sim-core golden `0xeaac_3764_99e4_fa24` are unchanged. New `dieEditor.test.ts`
    cases: a power-fed die is NOT sealable raw but IS once a pad is GND/VCC; `dieTestGraph` is a strict
    no-op (same reference) with no stimuli.
- **OWNER VISUAL REVIEW:** drill into a powered-logic frame (e.g. a CMOS gate die), double-click a wall
  pad, set VCC + GND (+ an Input), confirm the die powers up / animates live and "● solvable" lights so
  it Seals — then confirm the **sealed chip** placed on the board is still your raw discrete parts (the
  stimuli are gone). Check the popover focus feel (role/value clicks don't close it; Esc cancels).

---

## 2026-06-23 (95) — Sealed USER-IC zoom-to-open: live scaled miniature of the exact authored circuit

- ~~**Sealed user IC "scale it properly" zoom**~~ — DONE. A placed sealed USER IC now OPENS, when zoomed in
  past `INTERNALS_ZOOM` under the reality/analogy lens, to a **faithful scaled miniature of the exact inner
  circuit the player drew** — the real component glyphs at their authored positions + the authored wires,
  animated live from the same per-frame snapshot, lens-skinned (water/electron). Mirrors the built-in
  composite zoom-to-open plumbing but lays parts at AUTHORED positions using the real `drawGlyph`, not a grid.
  - `userIc.ts`: `flattenUserIcs(graph, sink?)` gained an OPTIONAL out-param (`FlattenRecord[]`) exposing each
    instance's id offset — element output is byte-identical (the no-op early return leaves the sink empty).
  - `netlist.ts`: new render-only `BuiltNetlist.userIcInternals` map (+ exported `UserIcInnerPart` /
    `UserIcInnerWire` / `UserIcInternals` types), built from the sink: each inner part's authored cell/rot/value
    + per-pin nodes (resolved via the STRIDE offset), the authored wires (endpoint cells + a colour node), the
    external pin nodes, the authored bbox, and a GND reference. Never crosses the wasm boundary, never hashed.
  - new `userIcInternalsView.ts` `drawUserIcInternals(g, opts)`: fits the bbox into the footprint at a uniform
    scale, draws each part's REAL glyph into a pooled scaled child Graphics (render-big-then-scale, like the
    tier illustration), and the wires/anchors into `g`, coloured by node level with flow carriers.
  - `board.ts`: `setUserIcInternals` + a `userIcGlyphs` child container per node; a new `showUserIc` branch in
    `ComponentNode.update` (threaded a new optional `userIc` arg). `App.svelte`: `setUserIcInternals` beside
    `setCompositeInternals`.
  - **Determinism preserved:** sim-core golden `0xeaac_3764_99e4_fa24` unchanged (188 tests pass);
    `netlist.test.ts` seal-as-same-netlist + a new mini-board test (38 web tests). All gates green.
- **OWNER VISUAL REVIEW:** zoom into a placed sealed chip (reality + analogy lens) — confirm the miniature
  reads as YOUR circuit (parts in place, wires running to the leads), the fit/scale + inset look right, and
  the live colour/flow animates. Tune `INTERNALS_ZOOM` / the inset margins / per-part electrical readout if
  desired. (Current per-part glyph reads `vAcross` only — no per-inner-part current attribution; the wire
  carriers carry the flow story. A follow-up could attribute inner element currents for richer glyph flow.)

---

## 2026-06-23 (43) — DESIGN LIST: connector types + "sealing" boards (the seal mechanic, one level up)

Owner idea, parked for design (NOT yet built — the IC-maker drill-in editor is the active work).

- [ ] **Connector types** — a new part category for real-world I/O connectors, each with its true pinout:
  **RJ-45** (8p/4-pair Ethernet), **USB-C** (VBUS/GND/D+/D-/CC/SBU…), USB-A, **DC barrel jack** (tip/sleeve),
  3.5 mm audio, HDMI, pin headers, screw terminals, … They're the physical edge I/O of a board — what a
  cable plugs into. As parts: placeable connectors with their pin maps. As board I/O: they define a sealed
  board's external interface (the board-level analogue of an IC's pins).
- [ ] **Board sealing (board modules)** — the **seal mechanic one fractal level up**: components → ICs →
  **boards**. Define a **board outline** (the PCB shape/area = the containment, like the die walls but for a
  board), build the board (ICs + parts + connectors), then **seal** it into a locked **module** whose
  external interface is its **connectors** (not bare pins). A sealed board is a placeable module you wire to
  other boards/systems by **mating connectors** (USB-C ↔ USB-C receptacle, RJ-45 ↔ RJ-45, barrel ↔ barrel).
  Reuses the same engine: seal-as-same-netlist (the module flattens to its real board netlist), the
  generalized expander, the containment DRC, the drill-in editor — just at the board scale, with connectors
  as the ports. One-layer nesting still applies (a board contains ICs/parts/connectors; sealing yields a
  module; a module isn't built from other modules).
- **Where it slots:** extends ADR 0005 (seal) + ADR 0006 (maker) upward; the connector pinouts are a parts
  addition (like the package library). Likely its own ADR (0007) when it reaches a design pass. The
  `docs/ic-buildings-ideation.md` "fractal fidelity" vision already gestures at this (zoom out and see the
  sprawl you built from parts you understand) — board modules are the next rung.

---

## 2026-06-23 (42) — Sigma-delta ADC (CEC1110) — the ADC trilogy is complete

- ~~**Sigma-delta ADC**~~ — DONE. New **sim-core behavioral program 8** (`BEH_PROG_SIGMA_DELTA`): a
  1st-order ΣΔ — a 1-bit modulator (fixed-point **integer** integrator + 1-bit comparator + 1-bit
  feedback; the bit density = VIN/VCC) feeding a block decimator (count 1s over `SD_DECIM`=8 clocks →
  3-bit code). The 1-bit stream is exposed on a **4th output BS** (same drive pattern as the SAR's DONE);
  code on D0/D1/D2. Golden byte-identical (additive program; integer state). Test
  `behavioral_sigma_delta_oversamples` (dominant code at x∈{0,¼,½,¾,1} → {0,2,4,6,7}; BS density ≈ x).
  188 sim-core tests; fmt/clippy clean.
- **Web part `SDM`** ("Sigma-Delta ADC"): graph.ts kind (VIN/CLK/D2/D1/D0/BS/VCC/GND), `BEH_SPEC.SDM`
  (prog 8, `term:[4,3,2,6,7,0,5,1]` — same as SAR), partInfo, codex, App. Catalogue **CEC1110**.
- **Worked example `sigma-delta`**: fast clock + slow triangle → SDM → BS (density viz) + D0/D1/D2 → DAC →
  AOUT. Shows oversample → bitstream → code → reconstruct. Web gate green.
- **The ADC trilogy is COMPLETE:** flash (CEC1080, parallel) · SAR (CEC1108, binary search) · sigma-delta
  (CEC1110, oversampling). Plus DAC (CEC1083) and counter (CEC3161). Glyph for SDM deferred (follow-up).
- **Counter glyph kit DELIVERED** this session (`counter-guidesheet.md` committed; self-contained kit sent
  for download) — awaiting the built `counter-ic.html`.
- **NEXT — the SEAL / "mini-mode" idea (owner raised it).** Build an IC from discrete parts, then SEAL it
  into a zoomable black box: top = black box, zoom = analogy view, zoom more = the full discrete circuit
  running live. This is the **`docs/ic-buildings-ideation.md` seal-mechanic keystone** + the existing
  **five-tier glyph** zoom ladder, unified. Owner wants to remake some ICs as full discrete circuits and
  seal them. Needs a design pass (see HANDOFFS 80). Big, exciting, architectural.

---

## 2026-06-23 (41) — 3-bit binary counter (CEC3161) + counter→DAC ramp generator

Owner picked **counters + ramp generator** from the entry-78 menu.

- ~~**Counter part**~~ — DONE. New **sim-core behavioral program 7** (`BEH_PROG_COUNTER`): a clocked 3-bit
  up-counter. Each rising CLK (`f`) does `count = (count+1) mod 8`, driving Q0/Q1/Q2 on `a`/`b`/`c` via
  the **generic** output path (3 outputs fit a/b/c — no special drive branch like the SAR's DONE). RESET
  (`g`, active-high) async-clears; unwired = free-run. State = count + CLK_PREV; `beh_counter_step` in the
  commit phase. **Golden byte-identical** (additive program). Tests `behavioral_counter_counts_and_wraps`
  (+1 mod 8, wraps 7→0) and `behavioral_counter_reset_holds_zero`. 187 sim-core tests pass; fmt/clippy
  clean.
- **Web part `CTR`** ("Counter"): graph.ts kind (pins CLK/RESET/Q2/Q1/Q0/VCC/GND), `BEH_SPEC.CTR`
  (prog 7, `term:[4,3,2,5,6,0,1,-1]`), partInfo, codex, App rows. Renders as the generic IC card (violet).
- ~~**Counter → DAC ramp generator**~~ — DONE. Worked example **`counter-ramp`** ("Counter → DAC Ramp
  Generator"): a 2 kHz square clock → CTR → R-2R DAC → AOUT = an 8-step self-running sawtooth. The digital
  twin of the ADC→DAC staircase (code from a counter, not a measured input). 3 guided build steps.
- Catalogue **CEC3161** added (memory & sequential section). Web gate green.
- **Glyph not built** (deferred — counter five-tier IC glyph is a follow-up, like the others got).
- **NEXT options** unchanged from HANDOFFS 78/79 (sigma-delta ADC now has its counter/decimator
  prerequisite; S&H; analog building blocks). Owner to steer.

---

## 2026-06-23 (40) — Convert/reconstruct worked example (ADC → DAC staircase)

- ~~**Convert↔reconstruct demo**~~ — DONE. New worked example **`adc-dac-staircase`** ("ADC → DAC: Convert
  & Reconstruct") in `web/src/lib/examples.ts`, the capstone of the logic section: a 200 Hz unipolar
  triangle (PULSE) → flash ADC → 3-bit code → R-2R DAC → AOUT, all on one 5 V rail (also the ADC VREF and
  DAC reference). AOUT reconstructs VIN as an 8-step staircase (one LSB = 0.625 V; tops out at 4.375 V =
  7/8 FS — the quantisation-ceiling lesson). 3 guided build steps; net labels VIN/AOUT/+5V/GND.
- **Acceptance test** `adc_dac_reconstructs_quantised_staircase` (sim-core): builds the exact chain (flash
  ADC + the 6-resistor R-2R network buildNetlist composes) and asserts AOUT = code/8·5 across the range.
  Proves the ADC's 1 Ω logic driver holds the 20 k ladder legs cleanly (the two parts compose). 185
  sim-core tests pass; golden stable; fmt/clippy clean; web gate green.
- **NEXT (open question — owner to steer):** see HANDOFFS 78 for a menu of what to build next (S&H,
  counter, sigma-delta teaser, instrumentation amp, current mirror, Schmitt, SRAM cell, etc.).

---

## 2026-06-23 (39) — Functional SAR ADC wired (CEC1108 placeable, behavioral prog 6)

- ~~**Wire the functional SAR ADC (CEC1108)**~~ — DONE. The 3-bit successive-approximation ADC is now a
  placeable part. New **sim-core behavioral program 6** (`BEH_PROG_SAR_ADC`): clocked binary search,
  MSB-first, one bit per rising CLK, comparing VIN against an internal trial R-2R DAC level
  (`trial/8 · VCC`); after 3 clocks the register holds `floor(8·VIN/VCC)` (clamped 0..7 — the SAME code
  the flash ADC finds in parallel) and **DONE** goes high. Carries integer state (CODE/STEP/DONE/CLK_PREV
  in `beh_state`) advanced in the commit phase. **Golden byte-identical** (additive program; `beh_state`
  empty for existing circuits) — `golden_snapshot_hash_is_stable` + all `run_is_reproducible` green; new
  test `behavioral_sar_adc_3bit_successive_approximation` (reads gated on DONE so a mid-search register is
  never sampled). 184 sim-core tests pass; fmt/clippy clean.
- **DONE is a FOURTH behavioral output** (on terminal `g`). The generic behavioral path drives only a/b/c,
  so the SAR has its own eval branch (drives D0/D1/D2 + DONE) like the LUT's special-case; `classify_nets`
  already marks a/b/c/f/g/h as digital signal pins (so the DONE net classifies), and the digital stamp is
  generic per-node (`digital_net_thevenin`), so g stamps automatically. Added a targeted
  `mark(referenced, e.g)` for prog 6 only (other programs keep g as an input).
- **Web:** `SAR` kind (8 pins VIN/CLK/D2/D1/D0/DONE/VCC/GND), `BEH_SPEC.SAR` (prog 6,
  `term:[4,3,2,6,7,0,5,1]`), partInfo, codex, App rows. VCC is the full-scale reference (no VREF pin), per
  the catalogue. Renders as the generic IC card. Web gate green (check 0/0, lint, build, build:wasm).
- Catalogue CEC1108 "In the sim" note updated to the behavioral-prog-6 reality.

---

## 2026-06-23 (38) — Functional R-2R DAC wired (CEC1083 placeable)

- ~~**Wire the functional DAC (CEC1083)**~~ — DONE. The 3-bit R-2R ladder is now a placeable part,
  not just a glyph. Golden-safe `buildNetlist` resistor composition via a new `CEC_COMP.DAC` entry
  (two R spine A-B-C, four 2R legs A→D2/B→D1/C→D0 + C→GND termination, plus a 1 MΩ VCC-GND bleeder so
  the nominal VCC pin is never an isolated node). No sim-core change, no new program — pure
  `ELEM_RESISTOR`, so the golden is byte-identical by construction. New `DAC` kind in graph.ts
  (pins AOUT/GND/D0/D1/D2/VCC, fixed index order to match the CEC_COMP refs), partInfo, codex
  (cat/meta/synonyms), App.svelte (PARTS/cat/keywords). Renders as the generic IC card (drawCard
  fallback) like the ADC. Web gate green (check 0/0, lint clean, build ok). Note: a switch-less R-2R
  ladder scales AOUT with the **external logic's** high level on the D pins; wire VCC to that same
  rail and `AOUT = code/8 · VCC` holds exactly (matches the glyph tier-4 framing).
- ~~**Wire the functional SAR ADC (CEC1108)**~~ — DONE (see entry 39): behavioral program 6.
- ~~**Convert↔reconstruct demo** (flash ADC → DAC) as a worked example~~ — DONE (see entry 40).

---

## 2026-06-20 (37) — Protocol engine COMPLETE (all ADR-0004 phases)

- ~~**Phase 4: behavioral CPU / FPGA**~~ — DONE as the **FPGA logic element** (`BEH_PROG_LUT=4`):
  a 4-input LUT (truth table in `aux`) + optional registered output (LUT+FF), the universal
  user-programmable digital primitive. Golden byte-identical (existing `beh_state` fold covers it);
  182 tests pass debug+release; fmt/clippy clean; wasm builds. Combinational = gate-like live drive;
  registered = DFF-pattern latch on the sub-tick kernel. Rationale (LUT fabric over a baked ISA) in
  ADR 0004. The whole engine chain is now landed: SPI master/slave, UART, sub-ticking, FPGA LE.
- ~~**Web-wire the backed behavioral/mixed-signal parts**~~ — DONE (2026-06-20, see HANDOFFS 70-72).
  All placeable now: SAMP (sampler), ASW (gated switch), CMP (comparator); the 9 CEC composites
  (HADD/FADD/MUX2/DMUX/MAJ3/SRL/DLATCH/JKFF/TRI via a data-driven gate-network expander); and the 4
  behavioral blocks LUT/SPIM/SPIS/UART (8-terminal, `BEH_SPEC` term maps, `f/g/h` emission +
  signature). LUT editor = presets + hex truth table + combinational/registered toggle. Generic
  IC-card glyphs (bespoke glyphs/refsheets remain optional follow-ups). Remaining sub-items:
  comparator 6-pin LATCHED (LE=f, now unblocked, needs an unconnected-pin check); SPI/UART config
  knobs (nbits/baud/half-period — sim params left at defaults today).
- [ ] Minor cleanup: move `BEH_SUBTICK_RATE_SLOT` off the shared `RATED_CURRENT_SLOT` (slot 2) to a
  free slot (5-7); the LUT mode now occupies slot 4.

---

## 2026-06-20 (36) — "More reality" roadmap scoped (owner: "ADCs… what else?")

Architecture-grounded feasibility pass over `crates/sim-core` (22 element types, the
golden-safe levers, the determinism contract) → **`docs/reality-roadmap.md`**. Key finding:
most of the classic curriculum is already **buildable from the existing 22 elements** (the
DFF + four-state gate engine + Newton analog models span it), so a big slice ships as worked
examples with **zero core code**. The real investments are a few *mechanisms*, in priority:

- [ ] **(keystone) Generic clocked sampler / sample-and-hold** — generalize the DFF from
  "latch 1 bit" to "latch an N-bit code / analog level on a clock edge". Golden-safe-additive.
  **Unlocks ADC (flash/SAR), DAC, S&H, switched-cap, synchronous counters, sigma-delta input.**
- [ ] **ADC (flash/SAR) + packaged DAC** on the sampler — the mixed-signal headline.
- [ ] **Composition wins, zero core code (do first):** counters / shift registers / mux /
  decoders, R-2R DAC, current mirror, instrumentation amp, op-amp Schmitt, SRAM cell,
  open-loop buck/boost — worked examples + glyphs only.
- [ ] **More FF types** (JK/T/SR/D-latch) — trivial `ELEM_DFF` variants.
- [ ] **555 timer** (build-from-parts 🟢, or packaged 🟡 with one latched bit).
- [ ] **Depth (moves golden, gate to Real + regen):** per-device thermal `Tj` axis
  (self-heating / runaway / bandgap); a deterministic per-element **seeded PRNG** for noise
  (Johnson/shot/flicker — consider the unhashed frequency domain first).
- [ ] **External-input channel** (UI-driven scalar, default 0) → photodiode/phototransistor,
  the first non-electrical input; opens the sensor family.
- [ ] **Systems (long horizon):** the behavioral-MCU / multi-rate engine (`uC`/`FP`
  placeholders) → I²C/SPI/UART (open-drain+pull-up already half-enable I²C), firmware, FPGA.

## 2026-06-20 (35) — Parts-bin trilogy complete + owner's two quick fixes

The impact-ranked parts-bin plan from entry (34) is **DONE end to end**, plus two owner fixes from a
screenshot. All web-only; no sim/determinism surface; gates green. Pushed to
`claude/kind-turing-hdelb3` (not yet PR'd).

- ~~**Arm-time configurator + last-used memory** (#155), then **moved into the parts bin**: the
  variant/tier/family/mode chips for an armed-but-unplaced part now dock as an accent card at the top
  of the bin (`.bin-config`), right where you picked the part — not a top-toolbar popover. The shared
  `{#snippet partConfig}` was hoisted to the `<div class="workspace">` root so the bin card AND the
  board inspector both render it.~~
- ~~**Bin clutter relief** (#156): family rows + synonym search + category folders.~~
- ~~**Arm-and-preview**: the info drawer targets `infoKind = selPart?.kind ?? armedPart`; with a part
  armed it previews the unplaced part (symbol/internals via `infoDiagram.setState(armedPart,
  ZERO_ELECTRICAL, partValue)`, pinout, equation, plain) and swaps the live block for a "drop to see
  live numbers" note (`infoPreview`). Trigger: **I** key or the bin card's **ⓘ** button. The bin card
  now shows for any armed part (name + ⓘ + disarm ×); config chips only when `hasConfig`.~~
- ~~**Voltage gauges → scale to circuit max + placement-aware** (board.ts): the Reality LED bar and
  Analogy standpipe gated fill on a fixed ~12 V ref → static-looking on a 5 V board. Now both scale to
  `circuitVMax` (the closed circuit's hottest rail); they tap off the pipe via a stub and rotate
  up/down + slide along the route to dodge parts/other pipes (`netGaugeAnchors`/`gaugeBoxClear`).
  **Ground (node 0) now reads as an empty gauge** (the 0 V reference made visible).~~

**Open / next (deferred adjacencies, none started):** `1`–`9` hotbar of configured parts + `Q`
pipette; a Catalog/codex tab (reuse partInfo + the five-tier glyphs); progression gating; the CP
(constant-power) electronic-load mode (`ELEM_CPLOAD`); an ATX rail-transient demo; the per-net colour
override tied to net labels (entry 31/33). Owner decides priority.

---

## 2026-06-20 (34) — Parts-bin UX: brainstorm synthesis + impact-ranked plan (owner "all are the unlock")

Owner: the bin clutter ↔ variant-friction ↔ discovery tension. THREE brainstorm agents converged
hard. **Key reframe:** "clutter" is THREE problems wearing one word, each wanting its own surface —
(A) bin height, (B) variant friction ("place then open a submenu to pick the type"), (C) discovery
("show the types without placing"). The unifying distinction: **IDENTITY** (what a part *is* —
Schottky/Zener/LED — stays VISIBLE in the bin, it's the curriculum) vs **GRADE/MODE** (tier, CC/CR,
CMOS/TTL, open-drain — moves to ARM-TIME, out of the bin + the post-place submenu). Do NOT collapse
identities into one morphing "Diode" dropdown (kills the teaching taxonomy — all 3 agents agreed).

Crucial enabling fact (friction agent): the inspector variant chips + `setComponent*` setters already
target an *id*, not "a placed instance" — so **bind the same chips to the ARMED TEMPLATE** and the
whole configurator falls out with near-zero new logic. Clean model change: `place(kind, cell,
overrides?: Partial<Component>)` (serialize/restore already round-trip variant/tier/mode/family →
undo + save are free; web-only, no determinism surface).

**Impact-ranked build order:** ALL THREE SHIPPED — see entry (35).
- ~~**(1) Arm-time configurator** (centerpiece — kills friction B). Reuse the inspector
  variant/tier/mode/family/open-drain chips bound to a new `armedConfig` (App.svelte), shown on the
  armed-part chip; the ghost reflects it; `place(overrides)` applies it; place-and-repeat carpets the
  configured part. **+ last-used-variant memory** ships with it.~~ DONE (#155); later moved into the
  parts bin (entry 35).
- ~~**(2) Bin clutter relief** (A): a `common?` flag + per-category split, then **family rows**
  (collapse "Logic gates ×10", expand inline) + **synonym search**.~~ DONE (#156).
- ~~**(3) Arm-and-preview** (C — the honest "show the type without placing"): press `I` / the bin ⓘ on
  an armed-but-unplaced part → its info-panel cutaway + pinout BEFORE dropping. Reuses the info
  drawer.~~ DONE (entry 35; `infoKind`/`infoPreview` in App.svelte).
- [ ] **Later/committed adjacencies:** `1`–`9` **hotbar** of configured parts + `Q` pipette
  (`mode-flow.md`); a **Catalog/codex** tab (the discovery museum, reuses partInfo + the five-tier
  glyphs); **progression gating** (bin grows with the player — `game-progression.md` §1.1, needs the
  economy; keep a creative "show all" for sandbox).

**Verdict: enough brainstorm; the convergence is the signal — build.** Start with (1).

## 2026-06-20 (33) — Voltage overhaul shipped (owner "go big") — PRs #150–#153

The plan in entry (31) is **DONE** end to end. Voltage now reads at a glance: **colour = which rail**
(conventional PC code), **height/fill = how many volts** (LED bar in Reality, water standpipe in
Analogy), **RMS primary with the AC swing shown as an envelope**.

- ~~**#150 rail-identity colour:** rewrote `voltageColor` to the conventional PC/bench wire code
  (+3.3 orange, +5 red, +12 yellow, +1.8 violet, GND dark, −12 blue, −5 cyan; 24/48V→mains ramp
  hotter/whiter). Signed + unclamped — fixes the −V-looks-grounded bug.~~
- ~~**#151 signed-RMS colour + per-node stats:** wire colour tracks the net's signed-RMS effective
  voltage (steady on AC, no strobe; mean's sign keeps −5V cyan; mains reads as its 230V). Added
  per-node `nodeVmean`/`nodeVmin`/`nodeVmax` (mirror `nodeVrms`) — the baseline + peak envelope the
  gauges read. Re-anchored mains stops to RMS (120/230). Energy-flow dir stays instantaneous.~~
- ~~**#152 Reality LED bar** (`drawNetBars`): per-net segmented bar, RMS solid fill + translucent
  peak-envelope band, **bipolar centre-zero**, "~" badge, DC = zero-swing limit. `voltsToPx`
  soft-saturates (5V & 230V both fit). Reality lens only.~~
- ~~**#153 Analogy standpipe** (`drawNetStandpipes`): per-net water column, height = pressure =
  voltage, calm RMS level + peak **wet-mark/tide band**, **sump** below ground for negatives,
  bipolar slosh. Shares the factored `netGaugeAnchors` with the bar. Analogy lens only.~~
- **DONE.** All four squash-merged, branch re-synced; web gates green throughout (no sim change).
  - [ ] **Remaining brainstorm item (owner floated):** a **per-net colour OVERRIDE tied to net
    labels** — a `color?` on `NetLabel` (graph.ts) + a swatch in the label editor (App.svelte) +
    `colorVoltage`/`voltageColor` honouring it (board.ts) so a player can hand-colour a net. Also a
    follow-on: AC/RMS brainstorm extras not yet built (a swing bracket + `Vpk/Vrms` inspector row;
    per-node freq/valid to gate the badge more precisely than peak-to-peak).

## 2026-06-20 (32) — Electronic load, part 2: the LOAD part (CC / CR + dynamic load-step)

Part 2 of the electronic-load work (part 1 = the programmable current source, #145). The LOAD part
is now placeable and fully wired, end to end. CP (constant power) is still a future part 3.

- ~~**Data/sim (mine):** `graph.ts` kind `LOAD` (pins +/−, "bad" red); `Component.mode` (0=CC, 1=CR)
  + `Component.loadHz` (dynamic step Hz), reusing `amp` (peak A) + `duty`. `place()` defaults
  `{mode:0, amp:2, loadHz:0, duty:0.5}`. `loadUnit(mode)` → A/Ω/W. `netlist.ts` web-only mapping
  (no sim element, like SHUNT/PULSE): **CC → `ELEM_ISOURCE`** (drains the + pin; static `value` A,
  or steps `value`→`amp` at `loadHz`/`duty` via the source's `params[0]`/`params[3]` + `aux`=peak);
  **CR → `ELEM_RESISTOR`** at `value` Ω. `eArr` pushed in lockstep (if/else → one element per LOAD).
  `values.ts` `loadValues`/`loadChips` per mode (CC amps / CR ohms).~~
- ~~**UI (subagent):** `drawLOAD` glyph (instrument box + sink arrow + heat halo); PARTS bin +
  `PART_CAT_OF` (Active & Switching); inspector CC/CR mode picker, **mode-aware value unit** (Ω in CR
  via `loadUnit`/`loadChips`), and the **dynamic load-step** controls (freq Off/100/1k/10k/50k, peak
  amps, duty slider) shown in CC; board plumbing (`setComponentMode`/`setComponentLoadHz`, copy/paste,
  emitSelect) mirroring `duty`/`variant`; `partInfo` LOAD entry. (`setLoadMode`, not `setMode` — the
  latter is the tool-mode setter.)~~ **DONE.** All web gates green.
  - [ ] Follow-ons: an **ATX rail-transient demo** (12 V + output-Z + hold-up cap + the dynamic load
    stepping → watch the rail droop/recover); **CP mode** (`ELEM_CPLOAD` nonlinear, part 3); rating→
    FAIL + a min-operating-voltage non-ideality; treat a CR load as a conductive path / a CC load as
    a current-source for the web's floating-return-path checks (currently skipped — edge case).

## 2026-06-20 (31) — QUEUED: voltage representation overhaul (owner-directed, "go big")

Owner: the wire **color-coding** of voltage is unintuitive / not glance-readable. Brainstorm done
(agent); full write-up + ranked proposals captured below. Decision: **go big**, and **demote hue to
a distinct rail-identity channel** (not a magnitude ramp).

- **Root cause:** `board.ts` `voltageColor(v)` maps volts → a HUE, **clamped to [0,12]** — so negatives
  collapse to GND-grey (a −5 V rail *looks grounded* — a real bug), ≥12 V saturates, hue isn't
  quantitative, it collides with rail identity, and the drop across a part is invisible. Color is the
  ONLY net-potential channel; the per-part analogy drawers already use height/level well, but the
  connecting wires fall back to the clamped hue.
- **Direction (owner):** magnitude on a **pre-attentive position/height/fill** channel (current keeps
  flow+thickness). **Analogy:** A1 standpipes (height = pressure = voltage; grows down for −, bobs for
  AC; height step across a part = the drop) → later A2 2.5D height-field. **Reality:** R1 inline
  **LED bar-gauge** per net (VU-style, zero-notch, peak-hold for AC, HIGH/LOW collapse) + R2 glow
  brightness ramp. Fix the clamp (signed soft-saturate); always draw a zero baseline; drop-across-a-
  part as a first-class caliper.
- **Rail identity = conventional PC colors (owner):** **+12 V = yellow, +5 V = red, +3.3 V = orange**,
  GND black, etc. (ATX wire code) — replace the current cyan/violet/amber rail tokens; OR a distinct
  literal **per-net** color (KiCad-style net coloring) so nets are told apart by color, magnitude by
  height/bar. (Confirm which with the owner when building; the rail-by-voltage colors and per-net
  coloring are two different ideas the owner floated.)
- **Net coloring (owner refinement):** the **default** should **auto-colorize every net a distinct
  color** (conventional rail colors where they apply — +12 yellow / +5 red / +3.3 orange — and
  distinct colors otherwise), i.e. color = NET IDENTITY out of the box. Then make the color
  **per-net editable**: when you **label a net** (net labels already exist, `lib/graph.ts` NetLabel
  + the net-label UI), you should also be able to **set that net's color**. So: a `color?` on
  NetLabel / a per-net color override, a swatch in the net-label editor, and the renderer prefers
  the override → else the conventional rail color → else an auto-assigned distinct color.
- [ ] **Build order:** quick-win (luminance + identity hue + signed clamp) → auto per-net distinct
  coloring + conventional rail palette + per-net color override (tie to net labels) → A1 standpipes →
  R1 LED-bars. **Deferred until after the electronic-load web part** (owner chose the load next).

## 2026-06-20 (30) — FIX: POT (and EC / thermistor) circuits dead since the 5-pin gate PR

Owner: "no value of POT wiper changes anything." Regression from the powered-gate PR (#142): it
added the fifth-terminal `eArr` to `buildNetlist`, pushing it **only in the generic element loop**.
The web-expansion branches (EC → cap+ESR, **POT → two resistors**, thermistor → R(T)) push `types`
directly and were never updated, so `eArr` came out **shorter than `types`** whenever one of those
parts was present. `loop.ts` then saw a non-empty `e`, routed to `set_netlist_pe`, whose length
check (`e.len != n`) rejected the install → `install_empty` → the whole circuit went dead (nothing,
not just the wiper, did anything). The static gates passed because no JS test runs the sim.

- ~~`netlist.ts`: added the 5 missing `eArr.push(0)` (EC ×2, POT ×2, thermistor ×1) so `eArr` stays
  in lockstep with `types` (now 6 `types.push` ↔ 6 `eArr.push`, interleaved).~~
- ~~`loop.ts`: hardened the boundary routing — only use `set_netlist_pe` when `e.length ===
  types.length` AND `e` has a non-ground GND pin. A normal powered gate (GND on the common ground)
  leaves `e` all-zero and carries VCC on `d`, so it uses the ordinary boundary; a malformed `e` can
  no longer reject the whole install (fails safe).~~ **DONE.** All web gates green.
  - [ ] No web test runner exists, which is why this slipped — a small `buildNetlist`/install smoke
    harness (e.g. asserting `e.length === types.length` for a POT circuit) would have caught it.

## 2026-06-20 (29) — IMPLY + NIMPLY gates

Owner: "add IMPLY and NIMPLY gates, with ¬A and ¬B… specifically transmission-gate versions."
Researched (logic + TG): the verdict is **behavioral** — the level-1 MOSFET fixes terminal `b` as
source (no source/drain swap), so it can't model a pass transistor's swinging source; the
transmission-gate structure belongs in the refsheet's transistor tiers (owner-authored).

- ~~**sim-core:** two `gate_logic_level` arms — `8 => or(not(a), b)` (IMPLY, A→B = ¬A∨B) and
  `9 => and(a, not(b))` (NIMPLY, A↛B = A∧¬B). New func codes on the same `ELEM_GATE` (type 17), so
  they inherit the powered 5-pin model with no new element. X-propagation is automatic (the
  four-state and/or/not tables). Golden-safe (codes only fire when placed). Test
  `gate_imply_nimply_truth_tables` (full tables + X cases).~~
- ~~**web:** `TYPE_OF`/`GATE_AUX` (8/9); `PART_KINDS` (5-pin two-input); `gateSchematic` gained
  **input-bubble support** (`invIn?: [negA, negB]`) — IMPLY = OR body + A bubble, NIMPLY = AND body +
  B bubble; `drawIMPLY`/`drawNIMPLY` + DRAWERS (factory falls back to the schematic, keeping the
  bubble distinct); PARTS bin + `PART_CAT_OF` + `DIGITAL_KINDS` (family/open-drain pickers); partInfo,
  pinout, values. 138 sim tests, all web gates green.~~ **DONE.**
  - [ ] Owner heads-up: **no real IMPLY/NIMPLY discrete chip exists** — for a five-tier refsheet the
    spec forbids inventing a pinout; anchor on a real transmission-gate/bilateral-switch part
    (e.g. CD4066) and teach "built from TGs," or sign off on a package-less cell. General per-input
    negation (¬A/¬B on any gate via spare `aux` bits 9/10) is a feasible follow-up that reuses the
    new input-bubble helper.

## 2026-06-20 (28) — Electronic load, part 1: a programmable current source (core)

Owner: "implement a programmable / electronic load… eventually test the ATX 3.1 spec. See what we
can go to." Core enabler — a current source that can step between levels (the load-step /
power-excursion pattern). Researched first (three agents mapped ISOURCE, the Newton/CP path, and
the web part touch points).

- ~~`i_source_current(&self, e)` near `ac_source_emf`: a current source's instantaneous current.
  **Static by default** — step frequency (param slot 0) of `0` returns the plain DC `value`, so a
  plain current source and the RC golden are bit-for-bit unchanged. Positive frequency → a square
  step between **base** (`value`) and **peak** (`aux`) at that freq, peak for `params[3]` (duty) of
  each period, starting at base (so the operating point primes the rail at steady state). Slots:
  value=base, aux=peak, params[0]=freq, params[2]=`RATED_CURRENT_SLOT` (over-current FAIL for free),
  params[3]=duty. Orientation a→b: positive drains `a`, so a load wires a=rail, b=gnd.~~
- ~~Swapped the 8 stamp reads + 4 commit reads of ISOURCE `e.value` to `i_source_current(e)`.
  Golden-safe (ISOURCE absent from the golden; default params → `value`). Tests:
  `dynamic_current_load_steps_between_base_and_peak` (1 A↔3 A, rail sags 11 V↔9 V) +
  `dynamic_current_load_run_is_reproducible`. 137 sim-core tests; golden + all 4 existing
  current-source tests bit-identical.~~ **DONE (part 1).**
  - [ ] **Part 2 (web):** the **Electronic Load** part — modes CC (→ISOURCE) / CR (→RESISTOR) with a
    dynamic load-step sub-mode (base/peak/freq/duty), a mode-dependent unit (A/Ω/W), rating→FAIL,
    glyph, inspector, examples. **Part 3:** CP (constant power) = a new nonlinear `ELEM_CPLOAD`
    Newton element (I=P/V; needs V_MIN/I_MAX clamps + a step limiter — the first negative-conductance
    device). **ATX note:** DT=2µs → excursion durations/steps ≥ ~10µs resolve (a 100µs excursion =
    50 ticks); sub-µs slew aliases. Pair the dynamic load with a source output-Z + hold-up cap to
    watch a rail droop/recover under a load step.

## 2026-06-20 (26) — Powered 5-pin logic ICs, part 1: sim-core foundation (the 5th terminal)

Owner: "go ahead and do the 5 pins" — make logic gates real powered ICs (VCC/GND pins, rail from
the supply) matching the inverter/NAND/NOR refsheets. Doing it in two PRs; this is the sim-core
half.

- ~~**5th terminal `e`** on `Element` (a powered gate's GND pin; VCC reuses `d`). Threaded through a
  new `set_netlist_pe(..., e, ...)`; `set_netlist`/`set_netlist_p` delegate with `e=&[]` (all
  ground) so **every existing caller is untouched**. Range-validated like the others. wasm gains the
  matching `set_netlist_pe` binding.~~
- ~~**Powered-gate model**: `gate_rails(el, node_v)` → `(vlow, vhigh)`. A gate with power pins
  (`d`/`e` not both ground) takes rail = `V(VCC) − V(GND)`, thresholds inputs relative to `V(GND)`,
  and swings its output `vlow .. vlow+rail` (new `digital_vlow` GND-offset array, used in
  `eval_digital`/`stamp_digital`/`commit_net_levels`). A gate with **no** power pins
  (`d==0 && e==0`) falls back to the legacy `value` rail referenced to ground → **bit-identical**.~~
- ~~**Unpowered = dead**: rail below `GATE_MIN_RAIL` (0.3 V, e.g. VCC unwired → node floats ~0) →
  the IC releases its output (Z). `classify_nets` marks a gate's power pins **analog** (supply
  nodes, not digital signal nets); `floating_refs` no longer pins them (an unwired VCC floats to ~0
  rather than being held up).~~
- ~~**Golden-safe**: the RC golden is unchanged (no gates); all 12 legacy gate tests pass
  **unchanged**. Added 4 powered tests (inverter swings to VCC; unwired VCC is dead; 2-input NAND
  via the 5th terminal; offset-GND output window). 135 sim-core tests, all gates green.~~ **DONE
  (part 1).**
## 2026-06-20 (27) — Powered 5-pin logic ICs, part 2: the web side

Part 2 of the powered-gate work (part 1 = sim-core foundation, entry 26). Gates are now real
powered 5-pin ICs in the web, end to end.

- ~~**Pins:** every gate is 5-pin `[Y, A, B, VCC, GND]` (`graph.ts`), index → terminal direct
  (a,b,c,d,e). NOT/BUF's pin 2 is the package **NC** (matches the real SOT-23-5), ignored by the
  sim.~~
- ~~**Netlist:** `FIVE_PIN_TYPES`; `buildNetlist` emits the `e` (GND) node + `d` (VCC) for gates,
  adds `e` to `BuiltNetlist` + the change-detection signature; `loop.ts` routes to
  `set_netlist_pe` when an `e` array (or params) is present; `App.svelte` passes `nl.e`.~~
- ~~**Glyph:** `gateSchematic` draws VCC (warm) out the top and GND (grey) out the bottom on every
  gate, and a faint × NC stub on NOT/BUF; single-input gates no longer misread pin 2 as a second
  input.~~
- ~~**Examples:** the four gate examples (inverter, AND, half-adder, SR latch) migrated — a
  `powerGate(g, gate, supply, pin, gnd)` helper wires every gate's VCC→5 V supply and GND→ground in
  both `build()` and `demo.alt()`; steps/counts/prose updated (a logic IC is dead until powered).~~
- ~~**Content/audit:** all 8 gate `plain()` texts + `gateInfo` rewritten for the powered model;
  `pinout.ts` extended (GATE + GATE1 maps, VCC/GND/NC); swept the tree — `infoDiagram`, `board.ts`,
  `App.svelte` are all pin-count-agnostic, nothing else broke.~~ **DONE — powered 5-pin ICs
  COMPLETE.** 135 sim-core tests, all web gates green.
  - [ ] Follow-on: the gate inspector's live "rail" row still labels off the vestigial `value`
    (the real rail is `V(VCC)−V(GND)`, not exposed to `partInfo`); expose the wired rail to the
    inspector so it reads the true supply. The `value` picker could also be retired for gates.

## 2026-06-20 (25) — Saved circuits → examples, drop-in (owner workflow) + re-modelled pot dimmer

Owner: "make it so the JSON I save can be set as the example easily" (for tuning/adding examples),
and delivered a re-modelled **Potentiometer Dimmer** save (fixed placement, labels, net labels,
**starts with the wiper parked off** so you slide it to brighten the LED).

- ~~**Drop-in mechanism** (`examples.ts`): `SavedCircuit` (the Save-button envelope `{format,
  version, savedAt, graph}`), `fromSaved()` (unwrap + deep-clone to a fresh `GraphSnapshot`),
  `savedExample({id,name,blurb,watch,saved,steps?,demo?})` → `ExampleSpec` whose `build()` returns
  the saved graph. `steps` defaults to a generic place-then-wire guide (`defaultSteps`) derived
  from the circuit, so the minimum to add an example is: Save the JSON, paste into a
  `lib/circuits/<id>.ts` wrapper, write blurb/watch. No hand-translation to `place()`/`wire()`.~~
- ~~**Pot dimmer re-modelled** (`lib/circuits/pot-dimmer.ts` = the owner's exact save; `pot-dimmer`
  example now `savedExample(...)`). Starts `wiper:1` (LED dark); the watch/steps guide sliding the
  wiper to the supply end to bring the LED up from black. Owner's labels + net labels (V(p_in),
  V(p_out), V(led)) + routing waypoints preserved verbatim. Dropped the old bright/dim demo toggle
  — the slider IS the interaction now.~~ **DONE.** (chose `.ts` wrapper over raw `.json` import:
  `verbatimModuleSyntax` + no `resolveJsonModule` make `.json` imports fight svelte-check; the
  wrapper is zero-config, type-checked against `GraphSnapshot`, and still a paste-the-JSON step.)
  - [ ] Follow-on: migrate the other hand-coded examples to `savedExample` as the owner re-saves
    them; optional `demo` via a second saved circuit if a toggle is wanted.

## 2026-06-20 (24) — Two more IC glyph refsheets: NAND + NOR

Owner delivered two more five-tier IC glyphs built from the spec. Placed in `docs/ui/parts/`
(SPDX header prepended, matching the compliant siblings):

- ~~`nand-ic.html` — **74LVC1G00** single NAND gate.~~
- ~~`nor-ic.html` — **74LVC1G02** single NOR gate.~~
- ~~Static §10 gates pass on both: JS `node --check` OK, no forbidden glyphs / dash entities,
  `drawPkg(gT` = 5, `var t4=` = 1, member consistency clean (all tiers). Playwright render gate
  (§10.5) skipped — Playwright isn't provisioned here and these are owner-validated canonical
  files (same call as `inv-ic.html`).~~ **DONE.**

## 2026-06-20 (23) — Resistor lead inductance (Real mode) + a current-sense SHUNT part

Owner (same thread as 22): "we should probably also have shunts then so we can show that… But it
should have *some* inductance at 100 kHz, no?" Yes — a real resistor carries a small lead/body
inductance; it just never shows on a normal R until GHz, but a milliohm shunt makes it visible.

- ~~**sim-core lead inductance (AC-only, Real mode).** New `R_ESL = 10 nH` constant beside
  `CAP_ESL`. In `ac_solve_models` and `ac_element_measurements`, a Real-mode resistor stamps
  `Y = 1/(R + jωL)` (Ideal stays `1/R`). Same geometric parasitic on every resistor; only a
  low-value part swings the phase: ~+32° on a 10 mΩ shunt at 100 kHz, ~0° on a 10 kΩ. AC-only,
  unhashed → golden-safe. Test `resistor_lead_inductance_shows_only_on_a_shunt` (Real shunt ≈ 32°
  lag, the 10 kΩ ≈ 0°, Ideal shunt = 0). 131 sim-core tests green.~~
- ~~**SHUNT part (web).** A `"SHUNT"` kind that maps to `ELEM_RESISTOR` (type 1) with milliohm
  values — so it inherits the lead inductance for free, no sim-core part. `graph.ts` (PART_KINDS,
  default 10 mΩ), `netlist.ts` (`SHUNT: 1`), `values.ts` (1 mΩ…250 mΩ curated + chips),
  `glyphs.ts` (`drawSHUNT` — a thick metal strap with Kelvin sense taps, not the R zigzag),
  detail/analogy drawers (reuse the resistor's), `partInfo.ts` (current-sense teaching + the
  lead-inductance gotcha), `App.svelte` bin (Passives). Resistor-tolerance jitter is keyed on
  `kind === "R"`, so a shunt stays exact (precision part).~~
- ~~**Drive-by fix:** `PULSE` was missing from `App.svelte`'s `PART_CAT_OF`, so it only appeared in
  the bin via search, never in the categorised folders. Added `PULSE: "Sources"`.~~ **DONE.**
  - [ ] Follow-on: a graded "measure the current with a shunt" challenge; optional shunt tiers
    (precision class → tighter tolerance + lower lead-L); a 4-terminal Kelvin shunt once the
    Element gains a 5th terminal.

## 2026-06-20 (22) — AC phase artifact fix: a resistor read −14° LEAD at high frequency

Owner screenshot: a 10 kΩ resistor on a 20 kHz AC source showed **−14° LEAD** in the phasor inset,
in **IDEAL** mode — a pure measurement bug, not physics.

- ~~Root cause in `AcMeas::finalize` (`crates/sim-core/src/lib.rs`): the V−I phase was taken from
  the current's rising zero-crossing offset, `2π·(i_cross/period)`. For an **in-phase** current the
  rising crossing lands one sample shy of the cycle end (the window opens on V's rising crossing, so
  i_cross ≈ period−1), wrapping to a spurious `−2π/period` lead. At 20 kHz (DT=2µs → 25 samples/
  cycle) that is exactly −360°/25 = **−14.4°**. The existing 1 kHz test (500 samples/cycle → 0.72°)
  was under its 0.05 rad threshold, so it never caught it.~~
- ~~**Fix:** take the phase **magnitude** from `acos(pf)` (power factor = the V–I correlation =
  cos φ), which is **exact** for proportional signals (resistor pf=1 → 0, no sampling artifact); keep
  the **sign** from the crossing position (early ⇒ lag/inductive +, late ⇒ lead/capacitive −). Cap
  (pf≈0, late) still reads −90°, inductor (pf≈0, early) +90°.~~
- ~~Regression test `ac_analysis_resistor_phase_zero_at_high_frequency` (20 kHz, 25 samples/cycle,
  asserts |phase| < 0.05 — was −0.25 rad). 130 sim-core tests green; AcReadout is unhashed →
  golden-safe. All gates pass.~~ **DONE.**

## 2026-06-19 (21) — Current-channel legibility (3-part: A frozen-spring ✓, B flicker, C MHz)

Owner: components flicker when sped up; the circuit "dies" above ~100 kHz; and a big charged cap's
spring is frozen though it's still discharging. All one root: **current is its own render channel
and keeps going invisible** when the voltage/waveform motion stops telling the story.

- ~~**(A) Frozen-spring / always-show-current** — `trickleFlow(current, scale)` in
  `analogyDrawers.ts`: a FLOOR (0.15) on the carrier flow so any real current (|I| > 1e-9) keeps a
  faint slow trickle instead of fading to a frozen nothing; a true zero (no discharge path) stays
  still. Applied to the ceramic-cap (piston/spring) and electrolytic (reservoir) analogy drawers.
  A big cap bleeding down at µA now reads as "still discharging". PNG-verified (I=0 → bare leads;
  5/50 µA → visible trickle).~~
- ~~**(B) Component shimmer** — the shared schematic `flow()` (`glyphs.ts`) now does the wires'
  carrier→band handoff via `shimmerFlow`: it reads the per-glyph AC readout from a module value
  `drawGlyphIn` sets (no per-drawer churn across 52 call sites), computes the blur from the AC
  current's apparent rate (`blurFactor(apparentFreq(ac.freq)) · acFrac`), so sped-up playback fades
  the sloshing dots into a steady |I|-width band instead of strobing. Also floors small currents to
  a faint trickle (the schematic half of A — was a hard `mag < 0.02` dead-zone). Verified the blur
  flips 0→1 with apparent rate. Uses the existing AC readout (valid ≤ 62.5 kHz; > that needs C).~~
- ~~**(C) Frequency-domain render** — `Sim::ac_element_measurements(ω, real)` (frequency-domain
  twin of `ac_measurements`, same `[nElem × AC_FIELDS]` layout): `I = Y·ΔV` per 2-terminal kind
  (R/C/L/switch/diode/varistor) from the AC node voltages, sources via KCL — **no solver refactor**.
  Test `ac_element_measurements_series_rc` (series current equal, R in phase, C leads 90°). Bound
  as `acElementMeasurements`. Web caches `fdAc` at the source freq when `> 62.5 kHz` and substitutes
  it for the invalid time-domain `acMeasurements` in `electricalMap`, so the existing
  `flowStabilized` + shimmer (B) show current/phase at 100 kHz–MHz instead of dying. Analysis-only →
  golden-safe (129 sim-core tests, all reproducibility green).~~ **CURRENT-CHANNEL A–C COMPLETE.**
  - [ ] Follow-on: 3-terminal/transformer AC currents (left `valid=0`); stabilise `vAcross` too so
    a voltage glow (cap field) doesn't flicker above the ceiling; bin the actual waveform shape.

## 2026-06-19 (20) — Phase-domain scope + MHz source range (display fast signals)

Owner: "display signals at MHz+ (PSU switching), and let the sources bump up there." The
honest path per the design docs (`high-frequency-render.md`, `fidelity-ceiling.md`): the
*frequency domain* (no Nyquist limit), not chasing the waveform at one fixed Δt.

- ~~**Phase-domain scope** (`lib/phaseScope.ts` `drawPhaseScope`) — each non-ground node's
  steady-state waveform over one cycle **vs phase (0…2π)**, from `acSweep` at the dominant
  source frequency (`v(θ)=re·cosθ−im·sinθ`). Stable at ANY frequency; relative phase between
  nodes reads directly; play-head sweeps on the frame clock. Sits beside the Bode (shown when an
  AC/PULSE source is placed); recomputed on edit/fidelity toggle, repainted per frame. PNG-
  verified (`/tmp/harness/render-phasescope.js`). Web-only — `ac_solve` is golden-safe.~~
- ~~**Sources reach MHz** (`values.ts`) — AC + PULSE frequency lists now run to 10 MHz (the
  frequency-domain analysis point). **Fixed a gap from increment C: PULSE wasn't in `values.ts`
  at all** (`hasValue("PULSE")` was false → no frequency picker); now it has curated chips +
  full list. `bodeHasAc`/`phaseScopeFreq` detection includes PULSE. Above ~62.5 kHz the *time*
  domain aliases (expected undersampling); the phase scope + Bode are the MHz tools.~~
- [ ] **Follow-on:** overlay a selected element's **I(θ)** beside V(θ) (the V–I phase pair);
  bin the *actual* (non-sinusoidal) waveform by phase for signals the transient resolves
  (≤ ~50 kHz) vs today's small-signal sinusoid; a clearer "frequency-domain" indicator when a
  source is above the time-domain ceiling.

## 2026-06-19 (19) — Device-variety frontier: diode types + current rating/FAIL (increment A)

Owner audit flagged the engine's real gap is **device variety**, not the tier axis. Four
workstreams chosen: (A) diode types + ratings, (B) LED colour, (C) waveform/pulse source, (D)
diode reverse-recovery. This is **A**.

- ~~**Per-device diode forward params** — `diode_model(&Element)` reads `Is` (slot 0) and `n`
  (slot 1) via `param_or`, so one diode kind becomes a family. Golden-safe (slot 0 → kind
  default). Test `diode_is_param_sets_forward_drop`.~~
- ~~**Diode TYPE picker** (`web/src/lib/diodes.ts`): Rectifier / Switching / Fast-recovery /
  Power, each a preset of forward `Is`/`n` + a current rating. `Component.variant` selects it;
  inspector shows the picker + rating. Variant 0 = the silicon default (existing diodes
  unchanged).~~
- ~~**Component current rating → FAIL** — general `RATED_CURRENT_SLOT` (slot 2) read for every
  element in `flag_and_clamp_fails`; `|I| > rated` boxes the part. `0` = unrated (Ideal mode +
  default), so golden-safe (not hashed). Rating installed web-side only in Real mode. Test
  `diode_over_rated_current_flags_fail`.~~
- ~~**Copy/paste now carries `tier` + `variant`** (the noted polish) — clipboard snippet +
  paste reconstruction.~~
- ~~**(B) LED colour** — `variant` → per-colour forward voltage (red ~1.9 / yellow / green /
  blue / white ~3.1 V, via `Is`) + glyph tint (`ledTint` in the board render) + a ~30 mA rating.
  Reused the diode forward-param plumbing (buildNetlist auto-emits once LED joined the variants
  map). Test `led_colour_is_sets_higher_forward_drop` (blue's extreme small Is converges).~~
- ~~**(C) Waveform / pulse source** — a dedicated **Pulse / Clock Gen** part: unipolar square
  (duty-controlled) + triangle, adjustable frequency + duty. Implemented by mapping the web
  `PULSE` kind to `ELEM_ACSOURCE` with a **waveform param** (slot 1: 1 square / 2 triangle, slot
  3: duty) — `ac_source_emf` grew the square/triangle branches (default slot 1 = 0 = sine, so
  the AC source + golden are untouched). New `Component.duty` field, glyph `drawPulse`, inspector
  (level + waveform + duty slider). Tests `pulse_source_emits_square_wave` / `_triangle_wave`.~~
- ~~**(D) Diode reverse recovery (trr)** — a diffusion-charge backward-Euler companion on the
  diode (transit time `TT`, slot 3): a forward diode stores `q = TT·I`; switched off it sweeps
  that charge out as a reverse-current spike. Reuses `reactive_state[ei]`; `newton_iterate` gained
  an `inv_dt` arg (0 at the op-point so DC is unchanged, 1/DT transiently); op-point seeds the
  charge so t=0 doesn't glitch. `TT=0` (Ideal / Schottky / default) = today's diode, bit-for-bit
  (all reproducibility tests pass — no golden regen). DIODE_TYPES carry game-scaled `tt`; emitted
  Real-mode only. Inspector shows the recovery (none/fast/medium/slow). Test
  `diode_reverse_recovery_sources_reverse_current`.~~ **DEVICE-VARIETY PLAN (A–D) COMPLETE.**
- [ ] **Follow-on:** ratings for SD/LED/ZD (LED especially — easy burnout) once (B) lands;
  reverse-voltage (Vrrm) rating + avalanche FAIL; inspector "actual value" readout for a
  deviated resistor.

## 2026-06-19 (18) — Quality-tier rollout COMPLETE (all gradeable parts ship tiers)

The budget/mid-range/high-end/lab-grade quality tiers now cover **every gradeable component**,
each non-ideality gated on the global **Real (realistic) fidelity flag** (Ideal mode = nominal
part regardless of tier). See CLAUDE.md "Component grades (tiers)".

- ~~**Op-amp GBW, cap ESR/ESL, inductor DCR/Cw** — AC-only params, gated in sim-core
  `ac_solve_models(omega, real)`.~~
- ~~**Electrolytic ESR (`ecEsr`), resistor tolerance (`resistorTolerance` + deterministic
  per-id `jitter`)** — web-expansion kinds, applied in `buildNetlist` (R deviation Real-only).~~
- ~~**Source output impedance (V / AC)** — first transient param; sim-core branch stamp
  `mat[bi][bi] -= e.params[0]`; gated web-side in `buildNetlist` (Real only).~~
- ~~**MOSFET Kp (NM/PM), BJT β (Q/QP)** — `mosfet_op`/`bjt_op` now take `&Element` and read
  `param_or(&e.params, 0, MOS_KP/BJT_BF)`; tiers in `tiers.ts`; gated web-side via
  `TRANSIENT_TIER_KINDS` (Real only). Tests: `bjt_beta_param_pulls_collector_lower` (base via
  RB so Ic = β·Ib actually moves the collector). 122 sim-core tests green.~~
- **Transformer — assessed, deliberately NOT tiered.** The ideal-T model hard-couples the
  secondary (no series Is term) for full-wave-rectifier stability, so its safe knobs
  (`rp`/`Lmag`) don't droop the loaded output, and the knob that would (secondary leakage) is
  the inrush-stability control. A meaningful, safe transformer tier would need the model to
  expose load regulation, which it intentionally doesn't. Left for a future model change.

Remaining Real-variant work beyond tiers (separate from the quality grade): diode series Rs,
inductor saturation — see (the now mostly-done) item below.
- [ ] **Follow-up polish:** inspector "actual value" readout for a Real-mode deviated resistor
  (so the deviation isn't a mystery); ~~copy/paste carrying `tier`~~ (done in (19)).

## 2026-06-19 (17) — Frequency-domain AC analysis engine (sim-core)

- ~~**AC sweep engine** (`Sim::ac_solve(omega)`) — complex MNA for the passive network (R→G,
  C→jωC, L→jωL branch, V-source short, AC source stimulus); returns complex node voltages at any
  frequency, no time-stepping / no Nyquist wall. `Cplx` + `solve_dense_complex` added. Pure
  analysis, doesn't touch the hash. Tests: RC corner (−3 dB/−45°/−20 dB-dec), LC resonance.~~
- ~~**Wasm binding** — `Sim::ac_sweep(freqs)` + `Simulation::ac_sweep` + `SimHandle.acSweep`;
  flattened [re,im] per node per freq. Test `ac_sweep_matches_pointwise_solve`.~~
- ~~**Bode panel** (web) — `lib/bode.ts drawBode` (dBV vs log-f, decade grid, scope colours) in a
  Telemetry "Frequency response" section; recomputed on netlist change when an AC source exists.
  PNG-verified (RC knee, LC peak). Not yet eyeballed live.~~
- [ ] **Bode polish** — phase trace (second plot / toggle), corner-frequency markers, a
  transfer-function (Vout/Vin, 0 dB) mode, |Z|-of-selected-part mode. Hover readout.
- ~~**Nonlinear small-signal in `ac_solve`** — diode/varistor/MOSFET/BJT companions stamped at
  the transient solver's settled operating point (mirrors `newton_iterate`, real partials, no jω
  since no internal device C). Tests: diode divider, MOSFET CS gain, BJT CE (exact 2-node
  cross-check). Bode panel shows amplifier response with no UI change.~~
- ~~**Op-amp small-signal + GBW pole in `ac_solve`** — output diag +Gout, transconductance
  Gout·dT/(1+jω/ωp), ωp=2π·GBW/A0, GBW=1 MHz. AC-only (transient algebraic → golden safe). Test:
  inverting amp gain Rf/Rin, −3 dB at GBW/(1+Rf/Rin). (#118)~~
- ~~**Ideal/Real parasitics (AC, functional)** — `ac_solve_models(omega, real)`: cap ESL+ESR+C
  series (SRF → inductive), inductor DCR + parallel Cw (SRF → capacitive). `ac_sweep`/`acSweep`
  take `real`; App Bode "Ideal/Real" toggle; sweep widened to 1 GHz. Analysis-only (golden safe).
  Tests + PNG (SRF notch+rise).~~
- [ ] **Analogy "parasitic sleeve" rendering** (next) — subtle always-on ESR grit-throat / ESL
  inertia-paddle / parallel side-tank in analogyDrawers.ts, brighten-by-contribution; read the
  SAME parasitic values as sim-core (mirror the constants). Full plan in HANDOFFS (35).
- [ ] **Transient parasitics (optional)** — netlist expansion (C→ESL+ESR+C, L→DCR+Cw, hidden
  internal nodes) for time-domain ESR ripple/spikes. Deferred; the AC-stamp covers the Bode.
- [ ] **(other track) Transient time base + PSU rating** — selectable fine dt + auto-measurements
  (ripple Vpp, overshoot, settling, regulation). Still open; owner chose the AC engine first.

## 2026-06-19 (16) — AC frequency range → 50 kHz; switching flicker root-caused

- ~~**AC source frequencies** extended to 50 kHz (`values.ts`: +10 k/20 k/50 k, +10 kHz chip).
  1 GHz infeasible at the 2 µs step (AC detect caps 62.5 kHz; round MHz/GHz → `f·dt` int → dead
  0 V source). 50 kHz already shimmers fully.~~
- [ ] **Resistor flicker under high SWITCHING** (owner ask) — NOT the same bug as AC flicker.
  `ELEM_SWITCH` = fixed 10 kHz chopper → unipolar PWM → sinusoidal AC detector says DC/invalid →
  (30) RMS-averaging can't engage → strobes. Fix: (a) sim-core AC analysis report RMS+fundamental
  for non-sinusoidal periodic signals, or (b) render-side ripple-gated magnitude stabiliser not
  keyed on `ac.valid`. Offered to owner; awaiting pick.
- [ ] **Phasor sweep ideas (round 2)** — Xc/Xl+R split (trig, cheapest); |Z|-vs-f sparkline the
  phasor paints (needs HUD-side freq-history buffer, presentation-only); RMS-vs-peak shadow;
  cap↔ind crossover anim; reactance-corner marker; resonance-hunt glow; two-part overlay (needs
  2nd readout). Full round-1 list (impedance triangle, PF ring, P/Q bar) still open from (14)/(29).

## 2026-06-19 (15) — Magnitude-rides-RMS (thickness + flow) + phasor moved to Telemetry

- ~~**Wire thickness/density flickered on AC** — `normC` rode `|i_instantaneous|`. Now eases
  toward a per-wire running-RMS branch current (`wireMs`, EMA `WIRE_RMS_ALPHA=0.04`, advanced once
  per frame in `advanceWireRms`) by the shimmer `blur`, mirroring the vrms colour blend. Sign kept
  → carriers still slosh. (board.ts)~~
- ~~**Component flow/heat strobed on AC** — new `glyphs.flowStabilized(e, blur)` eases the glyph
  `current` magnitude toward measured `ac.irms` (sign kept) by the part's own apparent-rate blur.
  Wired in the board.ts node loop.~~
- ~~**Phasor placement** — moved out of the value popover into its own ~180 px `Phasor · <part>`
  section in the Telemetry aside (beside the scope), with a V/I + ϕ°/lag/lead legend.
  `drawPhasor2D` strokes now scale with radius.~~
- [ ] **Flow stabilisation gaps** — diode/LED flow still strobes on fast AC (the `max(0,current)`
  sign-gate zeroes the off-half); potentiometer `legs[]` divider flow isn't RMS-blended. Low
  priority; honest-ish as-is.
- [ ] **Pixel-verify the board** — wire/glyph averaging is read- + numerically-verified only (no
  headless Pixi render). Confirm on live that thickness/flow are steady on fast AC.

## 2026-06-18 (14) — High-frequency AC render primitives (Layer 3) shipped

- ~~**`tierKit.shimmerFlow`** — the carrier→shimmer-band handoff on
  `blurFactor(apparentFreq(f))` (smoothstep 15→300 **apparent** Hz). The handoff tracks the
  on-screen apparent rate `f·tps·DT` (`setApparentRateScale` set each frame from the playback
  tickrate in App.svelte), so slowing the tickrate drops a fast AC back to visible sloshing
  and speeding up returns it to a shimmer. At `b=0` byte-for-byte `belt` (no DC regression).
  **`tierKit.phasorInset`** — V/I arrows on a dial, angle = measured V–I phase, lengths = AC
  amplitudes, filled phase arc, decaying-alpha I-tip phosphor trail; a pure function of the
  bounded phase (rewinds, no mutable buffer).~~
- ~~Data path: `ElectricalState.ac` (`AcReadout`) added (glyphs); `electricalMap` slices the
  flat `acMeasurements` per element; `App.svelte` passes `snap.acMeasurements`/`acFields`.~~
- ~~Applied: the **inductor** analogy drawer's pipe flow uses `shimmerFlow` (reference home);
  the **phasor inset** overlays the InfoDiagram for reactive parts (C/EC/L/TR) once a cycle
  is measured. Verified with `/tmp/harness/dumpPhasor.js` (handoff + phase encoding) and the
  existing `run.js` drawer regression. All web gates green.~~
- [ ] **Open (render adoption):** ~~board wire-pipes' carrier→shimmer swap~~ **done (15)**;
  the cap/transformer drawers adopting `shimmerFlow`; the phase-domain scope (V/I vs phase).
  See `docs/ui/high-frequency-render.md` §implementation-sketch 3–4.

---

## 2026-06-18 (19) — Auto-averaging (RMS) inspector readouts; flailing numbers fixed

- ~~**V/I numbers flail at high speed** (owner) — the inspector/HUD + partInfo formulas read
  the instantaneous `e.vAcross`/`e.current`, so they're unreadable once the AC reverses fast.
  Fixed DMM-style: `glyphs.rmsStabilized(e)` swaps in the measured RMS (`ac.vrms`/`ac.irms`);
  App.svelte computes `selRmsMode = ac.valid && apparentFreq(ac.freq) > READOUT_RMS_HZ(4)` each
  frame and feeds `selDisplay` (RMS or live) to the HUD + the "Right now" partInfo, with an
  `rms` badge. Self-adapts to signal freq AND playback speed (apparent rate). For DC, ac.valid
  is false → live value (already steady). Resistive P=V·I rows stay correct (Vrms·Irms = real
  power); reactive dV/dt-style formulas are stable but abstract (future: use Preal/PF).~~
- ~~**Phasor placement** (owner answered: inspector HUD + broaden parts + brainstorm). Added a
  Canvas2D `hudPhasor.drawPhasor2D` (lightweight twin of the Pixi `phasorInset`) to the
  inspector value popover for any part with `ac.valid` (a resistor reads in-phase); broadened
  the info-panel phasor gate from reactive-only to any AC part. Quadrant-tinted wedge (amber =
  lagging/inductive, violet = leading/capacitive, grey = resistive) folded in from the
  brainstorm. Verified with a Canvas2D-mock PNG render (`/tmp/harness/render-hudphasor.js`).~~
- [ ] **Phasor upgrades (brainstormed, not yet done)** — impedance/power triangle (R–X legs +
  projection drop-lines from `zmag`/`phase`/`iamp`); PF ring + real-vs-reactive (P/Q) bar; tie
  the cosmetic spin to the shared flow clock; L/C corner glyph. SRF "species-flip" ghost needs
  the Real-model parasitics (frequency-morph). Full list in the (29) handoff.

---

## 2026-06-18 (18) — Shimmer deactivated while running (the lerp dropped acMeasurements)

- ~~**Root cause of "shimmer deactivates on slow-down, only a t=0 reset brings it back"**:
  `lerpSnapshot` (loop.ts) — used to interpolate the display on ~every *running* frame
  (`acc > 1e-4`) — rebuilt the Snapshot WITHOUT `acMeasurements`/`acFields`. So running →
  AC data undefined → blur 0 → no shimmer/RMS-colour; it only survived when paused or right
  after a reset (cursor 0 skips the lerp). Fixed: carry `acMeasurements` (blended like the
  currents) + `acFields` through `lerpSnapshot`. Both Snapshot constructors now include them.~~
- Also: patched `~/.claude/stop-hook-git-check.sh` to skip `noreply@github.com` (GitHub's
  own squash/merge commits) so it stops nagging on every PR merge.

---

## 2026-06-18 (17) — Shimmer band visible (real bug) + lens/camera persistence

- ~~**Shimmer band was invisible** — not just calibration: the band was the same voltage
  colour as the wire + low alpha, so at high blur it looked like a plain wire (chevrons just
  vanished). Found via a new pure-Node PNG rasterizer (`/tmp/harness/raster.js` +
  `render-band.js`, verified `band.png`). Redesigned the band (board.ts + tierKit
  `shimmerFlow`): voltage aura + WHITE-HOT core + sparkle specks → reads as an energised wire.
  Shown on all three lenses.~~
- ~~**Persistence**: tier lens toggle, LOD toggle, and camera (pan+zoom) survive refresh —
  `Settings` (storage.ts) gains `boardLens`/`lodOn`/`camera`; `Board.getCamera()`/`setCamera()`;
  restore on init; debounced camera save in the frame loop.~~
- ~~**Wire colour flicker on fast AC** (owner) — voltage aliases like the carriers did
  (`voltageColor` is magnitude-based, so the hue strobes 0↔peak). Fixed: blend the wire
  colour toward the net's **Vrms** as blur rises, Vrms computed web-side from the non-aliased
  sub-frame `scopeBatch` (`Board.nodeVrms`); no core change. Verified with a PNG render
  (`/tmp/harness/render-color.js` → flicker row vs steady RMS row).~~

---

## 2026-06-18 (16) — Shimmer calibration fix + frequency-morph doc

- ~~**Shimmer not visible on screen** — calibration cliff: with `AC_SHIMMER_HI=300`
  apparent Hz, the default 500 Hz source only shimmered at the very top tickrate. Recalibrated
  to `AC_SHIMMER_LO=10` / `HI=60` so the carrier→shimmer transition lands in the reachable
  speed range (500 Hz flips between tps 5000↔50000); bumped the board band alpha. Verified by
  a blur-vs-tps calc + a `computeWireFlow` freq/acFrac replication (`/tmp/harness`).~~ NB: not
  screenshot-verified live (no headless-browser tooling) — owner to re-test at ≥50k ticks/s.
- ~~**`docs/ui/frequency-morph.md`** — the owner's "parts morph into their HF counterparts"
  idea written up: SRF flip (cap ⇄ inductor, shunt → shunt + L), depicted vs computed, as the
  payoff of the Ideal/Real flag. Added to the roadmap (Layer 3).~~
- [ ] **Frequency morph implementation** — blocked on the Ideal/Real fidelity flag (Layer 1)
  for the honest/computed version; a render-only preview could come first. See the doc.

---

## 2026-06-18 (15) — Board-wide carrier→shimmer handoff

- ~~`Board.computeWireFlow` (was `computeWireCurrents`) now also attributes each wire an
  **apparent AC frequency** (AC-amplitude-weighted mean of the elements' `ac.freq` in the
  wire's KCL subtree) and an **AC fraction** (AC amp vs |DC current|), from the one
  spanning-forest pass. `redrawWires` fades the chevrons/water/electron carriers into a
  voltage-tinted glow band (`SHIMMER_VIB` wobble) at high `blurFactor(apparentFreq(freq))`
  — in all three lenses; the energy belt is untouched. The AC-fraction gate keeps a
  rectifier's DC rail (small 2f ripple) reading as streaming carriers, not a shimmer.~~
- ~~Tickrate-coupled like the tier drawers (shares tierKit's `apparentRateScale`), so
  slowing playback drops fast AC back to visible sloshing. All web gates green; tierKit +
  drawer harnesses pass.~~
- [ ] **Brainstorm (owner):** components visibly **morphing into their high-frequency
  counterparts** (parasitics) at high apparent rate — e.g. a resistor → R + series L, a
  cap → C + ESR + ESL. Needs a design doc (the Ideal/Real fidelity ladder already frames
  the parasitics; this is the *render* of the transition). See HANDOFFS.

---

## 2026-06-18 (13) — AC analysis (Layer 2 measurement) shipped

- ~~**AC analysis** (sim-core) — new `AcMeas` per-element running analyzer + `Sim::
  ac_measurements()` (flat `[nElements × AC_FIELDS=12]`: Vrms, Irms, Vmean, Imean, Vamp,
  Iamp, Preal, PF, |Z|, phase, freq, valid). Synchronous RMS/power/phase detector: cycles
  delimited by rising zero-crossings of V about the running mean; phase = signed sub-sample
  offset of I's crossing (>0 inductive lag, <0 capacitive lead); PF = V–I correlation; freq
  from the period. O(1)/tick, O(1) storage. Updated each `step()` after the FAIL clamp;
  unhashed (golden bit-identical), deterministic (reproduces + rewinds).~~
- ~~Boundary: `ac_measurements()` + `ac_fields()` on sim-wasm; `loop.ts` `Snapshot` gains
  `acMeasurements` + `acFields` (one batched read/frame).~~
- ~~Tests: `ac_analysis_resistor_is_resistive` (PF≈1, φ≈0, |Z|≈R, freq✓), `…capacitor_
  current_leads` (φ≈−π/2), `…inductor_current_lags` (φ≈+π/2), `…run_is_reproducible`
  (measurement bits folded into the replay accumulator). 109 sim-core tests; all gates green.~~
- [ ] **Next:** the `shimmerFlow` + `phasorInset` render primitives (L3) now have their data
  source. Phase-domain scope (V/I vs phase) also reads these.

---

## 2026-06-18 (12) — Floating-component GMIN (Part 1 of floating networks) shipped

- ~~**Floating-component `GMIN`** (sim-core) — implemented in `crates/sim-core/src/lib.rs`.
  New `floating_refs(node_count, elements)` runs union-find (union-by-min, deterministic)
  over potential-defining ties (R/C/L/V/AC/switch/diode-family/varistor union a–b;
  FET/BJT channel a–b with the gate/base marked device-referenced; transformer unions each
  winding separately; op-amp/digital/pull-up terminals marked referenced; ISOURCE skipped),
  then returns the lowest node of every component with no path to ground. Stamped as one
  `GMIN` per floating component in all four assembly paths via `stamp_floating_refs`. New
  `floating_refs` field on `Sim`, computed at install.~~
- ~~Tests: `floating_refs_identifies_isolated_subnets` (topology), `floating_divider_solves_
  with_defined_common_mode` (exact differential, common-mode pinned), `floating_transformer_
  secondary_is_reproducible` (the headline win). Golden bit-identical; all gates green.~~
- [ ] **`ELEM_ROGOWSKI`** is now UNBLOCKED (Part 2 of `floating-networks.md`) — the
  floating-reference prerequisite is in. Next sim-core element after AC analysis if the
  owner wants the Rogowski path, else continue the critical path (AC analysis → render).

---

## 2026-06-17 (11) — Frameworks roadmap + high-frequency AC render

- ~~`docs/frameworks-roadmap.md` — the master "build the frameworks, then the game"
  dependency map (4 layers: solver core → measurement → render → game systems), with
  status + critical path. Stitches the per-system docs together.~~
- ~~`docs/ui/high-frequency-render.md` — the owner's AC render framework: decouple into
  three non-aliasing channels (shimmer width = amplitude, energy drift = real power,
  phasor angle = phase) + a phosphor-persistence phasor + a phase-domain scope.~~
- ~~SPDX headers retrofitted onto `floating-networks.md` + `fidelity-ceiling.md`.~~
- ~~**AC analysis (Layer 2)** — running per-net/element RMS, peak, V–I phase ϕ, real/
  reactive power, PF, |Z|, apparent frequency from the live waveforms (snapshot-only,
  deterministic). Feeds the phasor/high-freq render + AC telemetry + AC grading.~~ **Done
  — see (13) below.**
- ~~**`shimmerFlow` + `phasorInset` render primitives** (tierKit/web) — the carrier↔band
  handoff on the blur factor, and the two-arrow + arc + decaying-tip-trail widget.~~ **Done
  — see (14) below.**

---

## 2026-06-17 (10) — Floating networks + Rogowski coil + fidelity-ceiling docs

- ~~Design docs written: `docs/sim/floating-networks.md` (floating subnets + Rogowski
  coil) and `docs/sim/fidelity-ceiling.md` (how real the solver vs the reality tiers can
  get — the "where's the stopping point" map).~~
- ~~**Floating-component `GMIN`** (sim-core) — the netlist picks ONE global ground, so
  an isolated subnet has a singular common-mode. Stamp one `GMIN` to ground per floating
  connected component (generalises the op-amp/MOSFET-input GMIN). Small, golden-safe
  (grounded circuits unaffected), and on its own it fixes a floating transformer
  secondary + any isolation circuit. **Do first.**~~ **Done — see (12) below.**
- [ ] **`ELEM_ROGOWSKI`** (sim-core) — a non-loading current-sense, derivative source:
  sense a pass-through branch's current, force `V_out = M·dI/dt` onto an isolated output
  winding (reuses the transformer's hard-secondary stamp + the inductor `dI/dt`
  companion + the floating-component GMIN). Ideal first; Real bandwidth/droop later.
  Needs the floating fix first. Determinism: new `*_run_is_reproducible` coverage; the
  ideal analog golden stays untouched.

---

## 2026-06-17 (9) — Proportional-split flow framework

- ~~**Framework**: per-leg currents (`BuiltNetlist.legsOfComponent` → `ElectricalState.legs`)
  + `tierKit.flowSplit` (carriers commit to an exit in proportion to its current). General;
  feed it `electrical.legs` as exit weights.~~
- ~~**POT** analogy + reality: the wiper now STEALS its share of the carriers in proportion
  to the tapped current (KCL: tap = A→W − W→B). Verified across no/half/heavy tap.~~
- [ ] **Extend the split to more parts** as their per-terminal currents become available:
  transformer (secondary `Is = n·Ip`, derivable now — good next candidate); transistors
  (`Ib` would need the solver to expose the base branch; β-derived ≈1%, low value).

---

## 2026-06-17 (8) — Owner-review fixes + proportional-flow plan

- ~~**Thermistors missing from the bin** — were in `PART_KINDS` but not App.svelte's UI
  `PARTS`/`PART_CAT_OF`. Added under Passives.~~
- ~~**MOV bypass** — leads bypassed the poppet (A→tank→B). Reworked: leads pressurize the
  tank from below, flow only exits UP through the popped valve to the vents; spring
  compresses sealed→popped.~~
- [ ] **Particles to the exits, proportionally** (owner "would be cool"): split each
  part's internal particle streams by the per-exit currents so you can SEE the POT wiper
  stealing them (and per-output splits on transistors etc.). FEASIBLE — all per-element
  currents are in `elementCurrents` (loop.ts); the POT already stamps both legs (A→W,
  W→B). Add an optional secondary-current to `ElectricalState`, thread netlist→loop→board
  →drawer, split the streams. Also align internal dot count with the in/out pipe counts.

---

## 2026-06-17 (7) — Flow cohesion sweep: dam, slalom, MOV, connector pipe, caps

Owner push: every part's particles should interact with what affects them, terminals
should look like flowing pipes that join the wire-pipes (never "broken up"), and flow
should respect orientation.

- ~~**Diode** reverse-block now DAMS UP (packed jittering column + pressure chevrons).~~
- ~~**POT** stream SLALOMS around the resistance posts (`tierKit.scatterY`) and SNAGS
  carriers off at the wiper down the hose to W (the divider).~~
- ~~**MOV** reads open/sealed (poppet cracks + seat glow), flowing **pipe leads**
  (`tierKit.pipeLead`), polarity-correct through-flow.~~
- ~~**Connector pipe** (board): a stub from each pin into the body BEHIND the tier
  illustration, bridging the wire-pipes to the part universally. (Needs in-app look.)~~
- ~~**Ceramic cap + inductor**: pipe bodies water-filled terminal-to-terminal.~~
- ~~**Electrolytic cap** redesigned to ONE big tank — flow in the +/out the − lead,
  water level = the voltage with a gauge marker.~~
- [ ] **Finish the flow sweep** (owner: "finish the part sweep") — give the REMAINING
  parts flowing pipe-leads + interacting particles: transformer, BJT/MOSFET, op-amp,
  sources (V/I/AC), level shifter, switches (SW/MSW), gates, flip-flop. Pattern: anchor
  to real pins, `pipeLead` terminals, particles that react to the inline mechanism.
- [ ] **Get at wires behind components** — a component hit always wins (board.ts ~2507),
  so an occluded wire (op-amp example) is unreachable. Owner chose modifier **click-
  through**, BUT wants it discoverable without knowing the hotkey (hover-fade/right-
  click/handle all rejected as distracting/gimmicky — open question how).
- [ ] **Junctions: delete + move** — a way to remove a junction and drag it around (no
  rush). (Owner request 2026-06-17.)
- [ ] **Orientation audit** — confirm flow direction on every part when rotated (MOV is
  fixed via polarity + the rotating glyph holder; verify the class).

---

## 2026-06-17 (6) — Thermistor reality tier, POT flow respects wiper, resistor fire

- ~~**Thermistor reality (tier 3)** `drawDetailThermistor` (NTC/PTC) — polycrystalline
  ceramic: a grain chain with grain-boundary necks the carriers funnel through. NTC =
  carrier population grows with heat (freed-carrier sparkle + denser drift); PTC = red
  boundary barriers close the necks past the Curie point (the switching-ceramic snap).~~
- ~~**POT flow now RESPECTS the wiper** (audit fix). Analogy + detail: the drift/stream
  NECKS through the wiper contact (pinch tracks the wiper as it slides) and a tap branch
  drains down the arm/hose to W. `tierKit.flowAlongPath` now used in the detail tier too.~~
- ~~**Resistor CATCHES FIRE** past the smoke (`drawDetailResistor` + `flameTongue`): layered
  flickering flame tongues + embers off the body, driven by the raw |V·I| ratio (real
  headroom past the saturating `power`) — smolder → flames → blaze → inferno.~~
- Audit (Explore agent) of all analogy/detail flow vs inline constrictions: POT was the
  one clear offender (now fixed); MOSFET/BJT/diode/zener/caps/thermistor already gate
  their flow on conduction/obstacle/valve state. Diode reverse-block is borderline-sparse
  but acceptable — left as-is.

---

## 2026-06-17 (5) — Thermistor flow funnels through the gate

- ~~**`tierKit.flowThroughGap`** + `drawAnalogyThermistor` rework: carriers now funnel
  THROUGH the shutter gap (wide uniform stream when open, pinched to a thread when shut —
  the PTC snaps tight past Curie). Plates retract fully when wide open. See HANDOFFS (10).~~

---

## 2026-06-17 (4) — NTC + PTC thermistors (schematic + analogy, temperature knob)

- ~~**NTC + PTC thermistor kinds** added end-to-end, web-only (no sim-core/golden):
  catalog (`PART_KINDS`), schematic glyph (`drawThermistor` — IEC box + the temperature
  arrow, −/+ for NTC/PTC), heat-valve analogy (`drawAnalogyThermistor`), partInfo, and a
  per-part **temperature knob** in the inspector (mirrors the POT wiper).~~
- ~~**Shared R(T) model** in `web/src/lib/thermistor.ts` (NTC exponential; PTC switching
  ceramic with a Curie snap). `buildNetlist` stamps R(T) as a plain resistor — the POT
  pattern — so temperature changes rebuild the sim with no new element.~~
- ~~`temp` scalar threaded like `wiper` (Component, SelectedPart, clipboard, serialize/
  restore, board opts, infoDiagram).~~
- ~~**Thermistor reality (tier 3)** — `drawDetailThermistor`: a polycrystalline grain
  chain; carriers funnel through grain-boundary necks; NTC grows its freed-carrier
  population with heat, PTC rears up red boundary barriers past Curie (the snap). See
  2026-06-17 (6).~~
- [ ] **Thermistor params** — expose B (NTC) and the Curie point (PTC) as part scalars;
  fixed defaults for now. Optional silistor PTC variant.

---

## 2026-06-17 (3) — Zener closed loop, diode valve template, conduit fittings

- ~~**Zener analogy rebuilt** as a closed-loop spillway (`drawAnalogyZener`): forward check
  valve + cathode-side standpipe filling to the Vz weir + a **return tube** that carries the
  spill back to the anode (matches `zener-tier2.html`; no more "spilling into nothing").
  Column rim tracks the crest, so no dead freeboard.~~
- ~~**Shared `forwardCheckValve()` diode template** (D/SD/LED/ZD): bronze seat + spring + ball;
  **smaller ball**; open flow **parts around the ball** via new `tierKit.flowAroundBall`
  (horizontal `flowAroundPlug`). Valve un-crammed (taller chamber, wider body).~~
- ~~**Conduit tapers + junction fittings made translucent** — the port-flare + hub/nub fills
  were stacking over the pipe and reading cloudy; lowered their alphas.~~
- ~~**Junctions nudge with their runs** — follow-pass in `redrawWires` shifts each junction hub
  (and snaps its run-ends) by the per-axis-averaged nudge offset of its runs; derived FROM the
  nudge so it never fights `nudgeParallel`. `drawJunctions` takes a `junctionPos` map.~~

---

## 2026-06-17 (2) — reality transistors rotated + flow around the plug

- ~~**Reality MOSFET + BJT rotated to vertical**, anchored to the pins (drain/collector top,
  source/emitter bottom, gate/base left) so they match the board orientation.~~
- ~~**Flow parts around the plug** in the MOSFET/BJT analogies (`tierKit.flowAroundPlug`);
  plug narrowed to a disc thinner than the pipe so there's a side gap to flow through.~~
- ~~**Board traces as conduits** — DONE. `redrawWires` re-skins bare traces when zoomed into
  the analogy/reality lens: analogy = steel water pipe (carriers WITH current), reality =
  copper conductor with electrons drifting AGAINST current. Bus language kept; port collars
  at the ends are the lightweight taper. (`drawConduitSkin`, gated at `TIER_ZOOM`.)~~
- ~~**Conduit polish** — DONE. Auto bend radius (`roundedPolyline`), port taper (flared mouths
  oriented along the end segment), 4-way junction fittings with capped unused arms
  (`drawJunctionConduit` + `junctionDirs`).~~
- ~~**Conduit translucency** (#88) — lowered wall/bore/casing/flare/junction alphas so pipes
  read translucent.~~
- ~~**Free wire-ends** (#88) — empty-space click while routing drops a `free` junction and keeps
  routing from it.~~
- ~~**Potentiometer tiers** — `drawAnalogyPOT` (packed pipe) + `drawDetailPOT` (resistive film),
  anchored A/B/W, driven by wiper + current + vAcross.~~
- ~~**Conduit cleanup** — dropped the muddy dark bore (translucent 2-layer pipes), softened
  junctions (round-capped nubs), and added the **pin auto-bend** (a small aligning stub via
  `pinOutward`/`conduitDrawRoute`, rendering-only).~~
- [ ] **Conduit: nudge parallel pipes apart** (owner) — a render-offset channel-routing pass for
  overlapping collinear segments. Bigger/riskier; deferred.
- [ ] **Conduit: true per-part port-width taper** — flare each conduit to the component's actual
  port radius (needs parts to expose it). The current taper is a standard `PITCH*0.34` mouth.
- [ ] **Owner eyeball** the rotated reality transistors + the plug-skirting flow.

## 2026-06-17 — op-amp: doc-faithful analogy + reality

- ~~**OA analogy** rebuilt to the opamp-tiers.html tier-2 spool valve (input reservoirs,
  ±supply reservoirs, gain knob, bronze spool lands, output tank, ported flow), anchored to
  the real pins. Each input steers the spool toward its own rail (IN+→+rail up, IN−→−rail down).~~
- ~~**OA reality** replaced the capsule/puck with the doc's tier-3 long-tailed differential pair
  (Q+/Q−, constant tail current to −12 V, collectors to +12 V, Vout taps Q− collector).~~
- [ ] **Owner eyeball** the new OA analogy + reality on the board (deep zoom) + info panel.
- [ ] If wanted: the other reality tiers are still the older "factory" style — only OA was
  switched to its exact design-doc tier-3 this pass.

## 2026-06-16 (evening) — analogy tier: pin-anchoring + faithful re-port

- ~~**Analogy tiers PM/NM/OA/ZD/MOV** — DONE. Re-ported faithfully to the design sheets and
  **anchored to the real pins** (new `TierOpts.anchors`, computed in board.ts/infoDiagram.ts,
  resolved via `tierKit.anchorPt`). MOSFET = pressure-pilot valve (N/P mirror); OA = pilot
  spool valve (OUT/IN±); ZD = check-valve on the pin axis + spillway w/ reverse return; MOV =
  relief valve (vessel+vents+bonnet/screw). All move from the right live values.~~
- ~~**BJT (Q/QP) analogy** — DONE (owner OK'd). Anchored C/E/B + re-ported to the amplifying-
  valve ref: base check valve → float chamber → plug linkage; PNP mirror. Verified by the
  headless harness (pins reached, in-bounds, responds to I_C).~~
- [ ] **Owner eyeball** the re-ported analogy tiers (NM/PM/OA/ZD/MOV/Q/QP) on the board (deep
  zoom) + info panel.

## 2026-06-16 (afternoon) — tiers on the board + owner review fixes

- ~~**Tiers on the board (LOD)** — DONE. 3-way board lens (Schematic/Analogy/Reality); a part
  morphs into its full-panel illustration once zoomed past `TIER_ZOOM` (board.ts), else the
  schematic symbol. `ComponentNode.tierGlyph` + `Board.setLens`. **Needs an owner eyeball:**
  threshold + footprint bounds + possible off-screen cull.~~
- ~~**Resistor reality** = conductor lattice + drifting electrons + heat (was a colour-band rod).~~
- ~~**Diode reality** = PN-junction cutaway (P|depletion|N, recombination, LED photons, Schottky).~~
- ~~**Info-panel clipping** fixed (electrolytic tanks, BJT/MOSFET reservoirs pulled in-bounds).~~
- ~~**Transformer analogy** rocks back-and-forth (AC hinge) on the shared clock; strap shuttles.~~
- ~~**Info tab defaults to the board lens** (untracked; still toggleable).~~
- ~~**Diode analogy** ball lifts downstream when forward (was backwards) + decluttered.~~
- ~~**Zener analogy** rebuilt to the check-valve+spillway doc (no longer scrunched).~~
- [ ] **Board-tier LOD polish (owner review):** tune `TIER_ZOOM`; consider a cross-fade across
  the threshold; cull off-screen parts when drawing tier illustrations on large boards (cost).

## 2026-06-16 (overnight) — part-demo tiers: animation fix + all batch-1/2 tiers built

- ~~**Animation feedback (owner): slow down, de-jitter, pause-and-flow-with-time** — DONE.
  `InfoDiagram` adopts the board's shared flow clock (`Board.flowPhase()` → `setPhase` each
  frame): calm `FLOW_HZ`, freezes paused, reverses on scrub. Detail dot-loops de-jittered with a
  fixed-slot `dotPresence` fade (no count-flip teleporting).~~
- ~~**Analogy tier = full-panel illustration (owner: "as detailed as the design doc")** — DONE.
  New `web/src/lib/analogyDrawers.ts` + shared `web/src/lib/tierKit.ts`; `InfoDiagram` analogy
  mode draws full-panel `drawAnalogy()` else falls back to the board Factory glyph; gate is
  `hasFactory || hasAnalogy`.~~
- ~~**Analogy drawers (full-panel):** R, C, EC, L, TR, D/SD/LED, ZD, Q/QP, NM/PM — DONE.~~
- ~~**Reality drawers:** C (MLCC), EC (Al-foil), TR (iron-core windings), Q/QP (BJT silicon),
  NM/PM (MOSFET silicon) — DONE, registered in `DETAIL_DRAWERS`.~~
- ~~**Batch 2 implemented** (diode/zener analogy, transistor + MOSFET analogy & reality);
  PMOS ref saved (`docs/ui/parts/mosfet-pmos-tiers.html`).~~
- [ ] **Board LOD — the gated decision point.** Working LOD (NOT hide-to-reveal): always visible
  + animating, zoom-IN adds factory→reality detail, zoom-OUT simplifies. Hook off `world.scale`
  in `Board.update()`; overlay the full-panel analogy/reality drawer (they take a centred
  `bounds`) over the zoomed part. Thresholds/blend are visual tuning — **owner to eyeball live.**
- [ ] **Tier-fidelity caveats to revisit** (need richer per-element state): BJT/MOSFET reality
  proxy gate/base off |I| (no Vgs/Ib); transformer reality uses |Ip| as a flux-activity proxy
  (true core-flux/saturation is the ideal-vs-real work).

## 2026-06-16 (night) — part-demo tiers (owner design)

- **Three-tier part demos — STARTED (refs + design).** Every part shown schematic / analogy /
  reality, live-animated, revealed by zooming into a placed part or via the info panel. Refs:
  `docs/ui/parts/*-tiers.html` (5: R, ceramic C, electrolytic C, L, TR — authoritative spec).
  Design + plan: `docs/ui/part-demos-tiers.md`. Extends App.svelte `infoDiagram` / `hasFactory` /
  `diagramMode`. Pure presentation → no golden impact. **Next batch of part sheets arrives once
  this 5 is implemented.**
  - ~~Map the existing system — DONE (agent): three-tier `InfoDiagram` (PixiJS) + `DRAWERS` /
    `FACTORY_DRAWERS` / `DETAIL_DRAWERS` is ~70-80% built; tier switcher (`Symbol/Factory/Real`) +
    live per-frame feed already exist. Reality drawers exist for OA/D/SD/LED/ZD/R.~~
  - **Reality-tier drawers** (`detailDrawers.ts` → `DETAIL_DRAWERS`, the `drawDetail<Kind>` pattern):
    - ~~**Inductor (L)** — DONE (`drawDetailInductor`; solenoid + field loops + flux + spiral + dI/dt
      shimmer). Gates green; needs an eyeball on the live render.~~
    - [ ] **Ceramic cap (C)**, [ ] **electrolytic cap (EC)**, [ ] **transformer (TR)**. (R pre-existing —
      diff vs its ref + enrich later.)
  - [ ] **Board LOD — a *working* LOD, NOT hide-to-reveal** (owner clarified): the part is always
    visible + animating; zoom-IN progressively reveals factory→reality detail (same live state),
    zoom-OUT simplifies for clarity + render cost; nothing hidden. Tune thresholds/blend on visual review.
  - [ ] **Batch 2 (queued)** in `docs/ui/parts/`: `diode-factory`, `diode-tier2-study`, `zener-tier2`
    (analogy → `FACTORY_DRAWERS`), `transistor-tiers` + `mosfet-tiers` (Q/QP/NM/PM reality — the N-MOSFET
    sheet has the full schematic/valve/silicon set). Implement after batch 1, in order. More may follow.
  - Switcher relabelled **Schematic / Analogy / Reality** (was Symbol / Factory / Real).

## 2026-06-16 (night) — design (Ideal-vs-Real + multi-rate)

- **Ideal-vs-Real RESOLVED** as a progression-driven **fidelity gradient** (not a global
  toggle). Doc: `docs/sim/ideal-vs-real-parts.md`. Basics (R/C/L/V/I) pure-ideal &
  self-regularizing; past-basics carry essential parasitics by default; advanced unlocks more.
  Research-backed (CircuitJS source + ngspice manual). Parts audit done (only 6 purely ideal).
  - ~~**Visible FAIL UI** — DONE. wasm boundary exposes `failed()` + `failed_element_mask()`;
    `electricalMap` carries per-part `failed`; `board.ts` draws a pulsing red `FAIL` box +
    label on each flagged part (`PALETTE.bad`, free wall-clock pulse so it breathes while the
    run is frozen); `loop.ts` **freezes the run on FAIL** (the whole-sim FAIL state). Deferred
    polish: the `+FAIL/−FAIL` numeric-readout swap and a global banner (box+pause already read
    clearly).~~
  - ~~**Component labels / renaming** (owner ask — "a big one") — DONE. `Component.label`
    (free persistence via the serialize/restore spread + the save format); the value popover
    now opens for **every** part (not just valued ones — diodes/GND too) with a label text
    field at the top (commits on blur; routed through `onPersist`, so naming never rebuilds the
    netlist or rewinds the running sim); on-board label shows the custom name in place of the
    kind tag; preserved through copy/paste + undo. (Couldn't verify live — no browser here;
    gates green.)~~ *(Owner is doing a manual pass to label/clean the examples — kept hands off
    `examples.ts`.)*
  - [ ] **Curriculum tiering**: sort examples/contracts into "ideal basics" vs "reality carried".
  - [ ] **Additive Real-variant upgrades** (tech-tree/Lux gated, golden-safe additive): diode
    Rs + junction cap, R tolerance/power, C/EC ESR/ESL + ratings, FET/BJT caps + SOA, op-amp
    GBW/offset/Ibias, L saturation, transformer core saturation/loss.
  - [ ] **Web netlist test harness** — the c-terminal bug had zero web coverage (sim-core
    hand-wires c/d, so UI-built circuits are untested).
- **Multi-rate / mixed-signal architecture captured**: `docs/sim/multi-rate-domains.md`. Fixed
  integer rate ratios = deterministic (vs adaptive Δt); analog MNA at fixed Δt + digital event
  kernel sub-stepping a fixed integer per tick; the **ADC/comparator/DAC = the boundary**.
  - [ ] Lands with the CPU (`uC`) / FPGA (`FP`) / ADC-DAC tier; builds on the digital scheduler.

## 2026-06-16 (later)

- ~~**Four-pin c-terminal grounded — FIXED + SHIPPED (PR #70).** `nc` (pin 2 → node c) was
  computed only for `THREE_PIN_TYPES`, so the transformer's S+ and the DFF's CLK mapped to
  ground → half-wave bridge ("one diode conducts") + a flip-flop that never clocks. `nc` now
  includes `FOUR_PIN_TYPES`. Owner found the root cause.~~
- ~~**FAIL state foundation — SHIPPED (PR #70).** `flag_and_clamp_fails()` clamps non-finite/
  `>FAIL_LIMIT` to a finite bound (no more NaN propagation/trace-deletion), raises `failed()` +
  `failed_element_mask()`; native==wasm now. Golden stable; +2 tests (102 total).~~
- **Ideal-vs-Real parts (owner ask) — design doc written; build pending a policy decision.**
  Doc: `docs/sim/ideal-vs-real-parts.md`. Parts audit done (only 6 purely ideal: V/AC/R/C/L/I).
  - [ ] **DECIDE ideal-mode policy A vs B** (research agent running): (A) pure ideal, FAILs / you
    add impedance; (B) tiny universal lead R(+L) baked in so it just works, Real adds full
    parasitics. Root cause is fixed-Δt transient (SPICE uses adaptive Δt; we can't — determinism).
  - [ ] **Ideal transformer** (leakage floor depends on A/B). Bridge example already bounded+full-wave.
  - [ ] **Visible FAIL UI:** wasm exposes `failed()`+mask → `board.ts` pulsing red FAIL box →
    `loop.ts` pauses on FAIL; show `+FAIL/−FAIL` on the readout.
  - [ ] **Bin Ideal/Real toggle** + per-part inspector toggle + allow-but-warn mixing in `connect()`.
  - **Roll out Real variants** — mostly DONE via the quality-tier system (see 2026-06-19 (18)):
    ~~source output-Z, R tolerance, C/EC ESR/ESL, FETs Kp, BJT β, op-amp GBW, inductor DCR/Cw~~
    all ship Real-gated tiers. Remaining: [ ] diode series Rs, [ ] inductor saturation (current-
    dependent L). (Transformer tier deliberately deferred — model hard-couples the secondary.)
  - [ ] **Web netlist test harness** — the c-terminal bug had zero web coverage (sim-core hand-wires c/d).

- ~~**Transformer bridge inrush runaway — FIXED + SHIPPED (PR #69).** Owner-reported live
  bug: `tr-bridge-supply` diverged to ~61 kA on wasm (bounded ~50 A native — an ill-conditioned
  inrush, not stale cache). The hard zero-impedance secondary drove a near-impulse charging the
  empty reservoir cap. Fix: secondary **leakage inductance** `TRANSFORMER_LLEAK = 5 mH` (BE
  companion, **negative** branch diagonal like the magnetiser's `rp`; zero DC drop → full-wave
  intact). `Is` now a 2nd reactive state (`secondary_state`); golden + hash format unchanged.
  n=4/1 kHz: 49.8 A → 4.3 A. +2 regressions (high-step-up sweep, floating-primary bridge).~~
- ~~**"Logic from Transistors" curriculum (owner ask) — SHIPPED (PR #69).** CMOS inverter/NAND/
  NOR from raw MOSFETs + SR latch (cross-coupled NOR) in `examples.ts`; new example category.
  Pure content (MOSFET model does CMOS rail-to-rail as-is).~~
- **Catalogue roadmap (4 research agents synthesized) — owner picked transistor curriculum
  first (done above). Remaining, in build order:**
  - [ ] **>4-terminal `Element` keystone** — optional per-element extra-nodes side-table
    (golden-neutral). Unlocks wide counters/muxes/decoders, the BCD→7-seg decoder, RAM.
  - [ ] **7-segment display** (`S7` = 7-LED netlist expansion) + per-segment `GlyphOpts`; then
    **BCD→7-seg decoder** (`ELEM_BCD7`, rides the keystone) → "watch a digit count" chain.
  - [ ] Small ≤4-pin (B) digital parts: transparent D-latch, Schmitt buf/inv, tri-state buffer,
    2-bit counter (all golden-additive).
  - [ ] Analog: **reusable magnetic core** (generalize ideal-T to N windings → autotransformer/
    variac, common-mode choke, center-tap); **relay** (P6 latch pioneer); buildable-today wins
    (battery V+R, CC programmable load, crystal-as-RLC).
  - Economy (owner-confirmed): seal = FPGA only; everyday ICs unlock via **Lux-gated tech tree**
    after a build-from-primitives contract; IC = Lux once / cheaper Credits-per-placement than
    discrete (the integration lesson). Matches `ic-buildings-ideation.md` + `game-contracts-economy.md`.

## 2026-06-16

- **Digital scheduler (owner ask) — research done + Stage 1 shipped; Stage 2 next.**
  Six research agents synthesized into `docs/ui/logic-analog-digital-nets.md` §7 (the
  authoritative design + build plan). Owner chose scope **Stages 1–2**.
  - ~~**Stage 1 — net classification (golden-stable).** `classify_nets`/`is_digital`/
    `NetClass`/`Sim::net_class` label each node Analog/Digital/Boundary; computed but not
    yet acted on, so every golden is bit-identical. Test added.~~
  - ~~**Stage 2 — event engine + level-bearing hash (the deliberate break).** Shipped:
    `Level` {Low,High,Z,X} + `combine` table + 4-state `gate_logic_level`;
    `LogicFamily.quantize`/`drive_level` + `v_il_frac`; net-centric `eval_digital` +
    `stamp_digital` (one resolved drive per net, replacing the 4 per-gate stamps + 4
    `stamp_dff`); 4-state DFF (`ff_q`+`ff_clk_prev`) hashed; `snapshot_hash` folds
    pure-digital Levels + DFF state. Multi-driver now resolves instead of fighting.
    Needed **no golden regen** (digital tests are behaviour + self-consistency; RC/0xeaac
    has no digital parts and is untouched). New tests: ring oscillator, multi-driver
    resolve, per-tick lockstep DFF replay. All gates green.~~
  - ~~**Stage 3 — logic families + XNOR/BUF.** Shipped: XNOR/BUF surfaced on the board
    (PART_KINDS, type-17 map, codes 5/7, glyphs, palette, partInfo, pinout, values);
    sim-core `FAMILIES` (Ideal/CMOS/TTL) packed in aux upper bits (`func + 16*family`),
    wired through eval_digital/stamp_digital/commit/DFF via per-net `digital_family`,
    golden-stable (Ideal default); web `families.ts` mirror + `Component.family` +
    buildNetlist aux pack + `setComponentFamily` + App.svelte family chip picker & noise-
    margin readout. Test `gate_family_levels_and_mixed_rail` (the level-shifter lesson).~~
  - **Stage 4 — digital-interface ground rules.** (Prior batch SHIPPED to live via **PR #67**.)
    - ~~**Open-drain output mode + wired-AND bus.** Per-gate open-drain (aux bit 8): pulls
      low, releases high → an external pull-up forms a wired-AND bus, resolved by the MNA
      solve. `aux` now masks func/family/open-drain; new `gate_gout` for a mode-aware
      current readout. Default push-pull → golden-stable. Inspector output toggle + web
      threading. Test `gate_open_drain_wired_and_bus` (bus = A AND B).~~
    - ~~**Level-shifter (`ELEM_LEVELSHIFT=20`) + pull-up (`ELEM_PULLUP=21`).** Level
      shifter: 2-pin, reads input at rail A (`value`), re-drives at rail B (`aux`) —
      conversion in its pins (Ideal receiver/driver); web `value`=input rail, `amp`=output
      rail picker. Pull-up: 1-pin resistor to internal Vcc through 4.7k, constant Thévenin
      in the 4 assembly sites. Both golden-additive; tier-1 schematic glyphs (LS = buffer
      placeholder, PU = resistor-to-Vcc). Tests `level_shifter_translates_rails`,
      `pullup_takes_net_to_vcc_unless_pulled`.~~
    - [ ] **Tier-2 (factory) + tier-3 (real) glyphs for LS/PU** — owner's symbol pass
      (LS currently aliases the buffer; factory falls back to schematic).

## 2026-06-15

### Bugs found via the full-bridge-rectifier review (2026-06-15 eve)
- ~~**`formatValue` ate integer trailing zeros** → 470 µF shown as "47 µF", 100 Ω as
  "1 Ω", 120 V as "12 V", 100 kΩ as "1 kΩ" (any 100–999 mantissa ending in 0, 10×
  too small). Fixed: only strip zeros after a decimal point. Web-only.~~
- ~~**sim-core: a diode bridge off a transformer doesn't rectify (HARD) — FIXED.**
  Rewrote `stamp_transformer`/`stamp_transformer_op` from coupled-inductor to the
  **ideal-T model**: a magnetising inductance `Im` (+ primary winding R `rp`) across the
  primary, the secondary EMF forced **hard** to `n·V_Lm` (n × the *magnetiser* voltage,
  NOT the terminal voltage — that's what keeps DC blocked), the secondary current
  reflected `n·Is` into the primary KCL. Readout = `Im + n·Is`. Two refinements the
  build forced (see `transformer-bridge-convergence.md` §7): (1) the secondary carries
  **zero** series resistance — a `rs·Is` term softens the differential and the bridge
  runs away (positive feedback `Is = [n·V_Lm+Vcap+2Vf]/rs` grows with the cap); `rp` on
  the primary still gives loss + DC-block saturation. (2) **No** secondary→ground
  common-mode resistor is needed (§4 was a red herring) — a floating AC-source baseline
  rectifies full-wave on the GMIN-only floor, so isolation is preserved. Removed the now-
  unused `TRANSFORMER_K`/`transformer_inductances`. New regression
  `transformer_bridge_rectifies_full_wave` (all 4 diodes conduct, Vout ≈ Vsec_pk−2Vf ≈
  10.4 V, ripple ~0.9 V, Iprim ~0.19 A, no spike/runaway) + `..._scales_with_ratio` (step-up
  n=2 / step-down n=0.5); `transformer_scales_ac` now expects ratio = n (no k). Main
  analog-RC golden untouched. **Audit agent passed** (owner asked): stamp math correct
  sign-by-sign, no determinism risk; findings folded in (ratio test, dead `reactive_state_b`
  removed, stale comments fixed). All gates green.~~

### QoL / fixes batch (owner, 2026-06-15 pm)
- ~~**Draggable net labels** (KiCad-style): drag the tag pill; the dot + leader stay
  pinned to what it names. `NetLabel.tagOff` + `graph.moveNetLabel` + a lightweight
  `onPersist` board callback (save+undo, no netlist rebuild / clock rewind). (#65)~~
- ~~**AC mains amplitudes**: 60 Hz freq; peak chips 170/311/325 V (= 120/220/230 Vrms);
  RMS readout beside the peak; one-tap US/EU mains presets (amp + freq). (#65)~~
- ~~**Pan yields to Build on a grab**: clicking a component or wire in Pan switches
  to Build/Select and grabs it (move/reshape); empty still pans. `onMode` callback.~~
- ~~**R rotates the ghost when a part is armed** (was rotating a leftover selection).~~
- ~~**Open-loop current-source fix verified** (re-ran harness: open = 0 mA/0 V, closed
  = 10 mA/10 kV). Residual: a return path that's topologically present but DC-broken
  by *value* (open switch / lone cap) isn't caught by the topology-only union-find —
  needs the value-aware singular detection already on the backlog.~~
- [ ] **Drop a component onto existing track(s) should split/remove the spanned
  segment**, not leave it shorting the pins (e.g. a Transformer across dual tracks —
  the wire between the corner pins must be cut so the part bridges them, not the wire).
  *Analysis:* `placeCell` needs a post-place pass that, for each placed pin landing on
  an existing wire's route, splits that wire at the pin (reuse `junctionOnWire`/the
  split path) and removes any wire segment that runs **between** two of the new part's
  own pins (that's the short). Medium-complex; touches `placeCell` + graph split.
- [ ] **Delete on a wire deletes only the segment up to the nearest junction(s)** on
  that run, not the whole pin-to-pin wire. *Analysis:* wires already SPLIT at junctions
  (`junctionOnWire`), so a junction-bounded segment is its own wire object and deletes
  alone — the gap is deleting a single **segment between waypoints/corners** of one
  multi-bend wire object: needs `deleteSelection` (or a wire-segment delete) to split
  the wire at the clicked segment and drop only that piece. Medium-complex.
- [ ] **Wiring auto-complete with a junction (KiCad continue)**: while drawing a wire,
  clicking an existing trace drops a junction, ends the wire there, and **continues** a
  new wire from it. *Analysis:* the current model is **drag-per-wire** (press a pin →
  drag → release completes in `onPointerUp`; `finishWireOnWire` then `cancelWiring`).
  KiCad continue needs (a) `finishWireOnWire` to RETURN the new junction and the
  up-handler to set `this.wiring = {from:{junctionId}}` instead of cancelling, AND
  (b) `onPointerDown` reworked so a press **while already wiring** COMPLETES at the
  target (pin/wire/junction) instead of overwriting `this.wiring` with a new start —
  i.e. a click-to-place mode. The (b) rework is the real work; do it deliberately.
- ~~**Scope time window**: selectable, decimated span (0.48 ms/4.8 ms/48 ms/0.48 s);
  base span = old per-tick behaviour; ⏱ button cycles it, duration labelled on scope.~~

### Shipped this session (editor fixes + phase-shift + info-panel P1)
- ~~**Pan tool regression**: the Esc-default pan no longer blanket-grabs pointerdown —
  pin/junction press starts a wire, wire press reshapes, armed click places; only a
  body/empty drag pans. `arm()` leaves pan for select. (board.ts + App.svelte.)~~
- ~~**Label ghost**: onPointerMove now refreshes the ghost in `label` mode, so the
  name-pill preview follows the cursor + snaps (was only `armed`/`junction`).~~
- ~~**Open-loop current source** zeroed (see deeper-#2 tombstone below).~~
- ~~**POT B-terminal investigation**: NOT a bug — a properly-wired W→B leg conducts
  (verified 0.31 mA via the wasm solver); the user's ~0 reading reproduces the
  B-floating (rheostat) case exactly. Wiring near-miss, no code change.~~
- ~~**Phase-shift example** (`phase-shift`, Filters): corrected to 138 Hz
  (= 1/(2πRC√6)) with honest 56°/112°/180° tap labels + the 1/29 attenuation lesson +
  a detune-to-1 kHz demo. Verified end-to-end (transient sim: −180.0°, 1/29.1).~~

### Logic gates: separated analog/digital domain — DECIDED, building (owner, 2026-06-15)
**Decision (doc §6):** build the **full** separated digital domain NOW (families +
driver/receiver boundary + deterministic event scheduler + level-bearing hash), with
a **legacy-ideal default** (existing circuits identical; only gate/DFF goldens regen
when the scheduler lands; future digital parts golden-additive). Owner: lowest risk
of a future re-break.
- ~~**Phase 0 — family substrate (golden-stable).** `LogicFamily`{v_ih/v_ol/v_oh
  frac, g_ol/g_oh} + `LEGACY` const reproducing the original gate exactly;
  `gate_target_level` routes through `LEGACY.reads_high`/`.drive`. Byte-identical,
  88 tests pass, golden unchanged; `legacy_family_matches_original_gate` guards it.~~
- [ ] **Phase 1** — receiver/driver split + in-core net classification (analog /
  pure-digital / boundary). Still LEGACY, still golden-stable.
- [ ] **Phase 2** — the deterministic **event scheduler** (integer-tick buckets, enum
  `Level{Low,High,Z,X}`, element-index order, one-tick-delay feedback) + fold digital
  net levels into `fnv1a`. **Regenerate gate/DFF goldens** (the one deliberate break).
  Extend to the DFF. Per-family `*_run_is_reproducible` + mixed-rail + open-drain tests.
- [ ] **Phase 3** — boundary threading to web (family value-chip, noise-margin /
  forbidden-band readouts) + surface **XNOR(5)/BUF(7)** (the `GATE_AUX` gap).
- [ ] **Phase 4** — open-drain / Z / wired-AND + a first-class **level-shifter** part
  (golden-additive).
- The acceptance bar + exact design are in `logic-analog-digital-nets.md` §6. Do the
  scheduler with full budget — never land a half-built non-deterministic engine.

<details><summary>Original brainstorm summary (superseded by the §6 decision)</summary>
Brainstorm doc **written** at **`docs/ui/logic-analog-digital-nets.md`** (agent).
Recommends a 4-phase path: **(0)** add a `const` logic-family descriptor defaulted to
a legacy-ideal family that reproduces today's numbers *exactly* (golden untouched —
same trick as the AC `aux`/4th-terminal `d`); **(1)** opt-in real families with honest
`V_IL/IH/OL/OH` + asymmetric pull-up/down + open-drain (a deliberate golden regen);
**(2)** noise-margin/forbidden-band warnings + a first-class **level-shifter** part
(mostly presentation); **(3)** only when digital gets big, a separate deterministic
event scheduler (the architecture doc's target; the one hash-changing, risky step).
Includes a debug/validation plan (per-family threshold tests, mixed-rail, open-drain,
reproducibility, a legacy-equivalence golden guard). Decide direction before Phase 1.
- [ ] **Latent bug the agent flagged:** XNOR/BUF exist in sim-core `gate_logic` but
  aren't wired in `GATE_AUX` (web), so they're unreachable as placed parts. Verify +
  wire them (or confirm intentional). Cheap; do alongside Phase 0/1.
Owner: the gates (`ELEM_GATE=17`) currently can't handle logic-high being anything
but their set HIGH value and low being exactly 0 — no V_IL/V_IH vs V_OL/V_OH, no
noise margin, no mixed-rail interfacing (a 3.3 V part driving a 5 V part), no notion
of a divided/pulled input. Likely endgame: a **separated analog vs digital net
system with boundary/barrier elements** (or a per-gate logic-family descriptor under
the single analog solve). Must stay **golden-stable** (any sim-core behaviour change
⇒ regenerate the golden + justify) and keep the coarse JS↔wasm boundary. Doc must
include a **debug/validation plan** (deterministic sim-core tests across families +
mixed-rail interface cases). Decide direction after reading the doc.
</details>

### Editor: copy/paste + marquee select + group drag (owner, 2026-06-15)
- ~~**Box / marquee select** (Select-mode empty drag; shift = additive): rubber-band
  rect selects components whose centre is inside + wires with both ends inside +
  junctions inside. `board.ts` marquee layer + `finalizeMarquee`.~~
- ~~**Group drag**: already worked — `beginDrag` grabs the whole selection; internal
  wires re-route via their pins. (No change needed.)~~
- ~~**Copy/paste/cut** (⌘/Ctrl-C / -V / -X): in-memory `ClipboardSnippet` (components +
  internal wires + net labels on their pins); paste with fresh ids at a growing offset,
  remapped onto the new ids, re-selects the group. Cut = copy + delete. Same-named
  labels still alias by design. Validated through the harness.~~
- ~~**Persist board state across refreshes.** `lib/storage.ts` saves the
  `BoardGraph.serialize()` to localStorage (debounced 400 ms) on every edit and
  restores it on load (falls back to the primer only on a true first visit). Guarded
  try/catch + light shape validation. Not cookies.~~
- [~] **Persist progress/tutorial state.** Versioned `Settings` blob
  (`seenIntro`/`explainAsYouGo`/`seenConcepts`) + `loadSettings`/`saveSettings`
  **scaffolded** in `lib/storage.ts`; onboarding wires its writes/reads when built.
- ~~**Reset-progress button.** A `↺ Reset` chip in the header → `resetAll()` (clears
  board + settings) + reload to a clean first-run; confirmed so it can't nuke a board
  by accident.~~

### Absolute-beginner onboarding / first-run (owner-driven; MVP shipped)
Design doc at **`docs/ui/onboarding-first-run.md`**. Pull-based discovery layer.
- ~~**Learn-as-you-explore, not a rail** + **NO levels — pull-based, one mute** +
  **replayable**: shipped as the MVP — `concepts.ts` (4 first-encounter cards:
  source/ground/loop/reading) offered the moment the board shows each true (reactive
  triggers on board state), deduped via queue + persisted `seenConcepts`; one
  `explainAsYouGo` mute; an always-on **"?" Help handle** (mute / replay tips / re-show
  intro); settings load+persist via `storage.ts`; cards hold off behind the cold open.~~
- [ ] **Heavier guided pieces (deferred, §1–§3/§6):** cold-open auto-play of the
  primer + the "Show me / Let me build" fork; the guided **first-build wiring
  affordances** (pin-glow on the active step, next-edge ghost "from here → to there");
  **bin-narrowing + pre-arm** for the first build; tie the cards to a Lab Notebook codex.

### Component info panel — frictionless trigger + pinout + construction cutaways (owner-greenlit, queued)
Full design in **`docs/ui/component-info-panel.md`** (ideation, brainstormed
2026-06-15). Make rich component info reachable without breaking build flow.
Owner-approved direction + defaults:
- ~~**Phase 1** — open the info drawer on **double-click** a component (`onInspect`
  board callback; works from Select + Pan), + an `I` hotkey toggle, + an `ⓘ` chip on
  the value popover. Reuse the right-side `.info-drawer`; Esc closes the drawer first.
  **Oriented labelled pinout** shipped (`web/src/lib/pinout.ts`: `PART_KINDS.pins`
  rotated by `selPart.rot` → SVG body+legs+dots + DOM labels + per-leg glosses).
  MSW 2nd-click-of-a-double suppressed so double-click stays universal.~~ (shipped)
- [ ] **Phase 2** — the **construction cutaways**: a third `DETAIL_DRAWERS` map
  (Pixi-drawn, parallel to `DRAWERS`/`FACTORY_DRAWERS`, hosted by a new "detail mode"
  on `InfoDiagram`, `DETAIL ?? schematic` fallback) + an in-panel schematic⇄cutaway
  toggle. First cutaways: the 3 capacitors (electrolytic rolled spiral, ceramic MLCC
  layer stack, film roll), diode/LED die, resistor color-bands. ~9 shared templates
  cover the ~30 kinds (see the doc's catalogue).
- [ ] **Phase 3** — fill the cutaway catalogue along the parts roadmap.
- Owner defaults locked: Pixi-drawn (not SVG); cutaway-with-toggle; click-away keeps
  it open; MSW 2nd-click suppressed. Presentation-only (no sim/golden impact).

### BUILD QUEUE — remaining catalog + ICs (owner: "go down the list we already had")
The full planned kit, from `docs/parts-catalog-ideation.md` and
`docs/ic-buildings-ideation.md`. **Done so far:** LED, Zener, Schottky, electrolytic
cap, BJT (NPN/PNP), MOSFET (N/P), op-amp, manual switch, varistor (MOV), logic gates
(AND/OR/NAND/NOR/XOR/NOT), transformer. Remaining, in rough build order (P-codes are
the enabling primitive from the catalog's §0 / §9 roadmap):

**Discrete parts still to build**
- [ ] **Relay** (catalog §5.2) — electromechanical: coil current pulls a contact
  (a 2nd, switched branch). **Unblocked now** (uses the 4th terminal `d`). Needs the
  stateful/hysteretic latch (P6, integer/threshold on the tick grid, hashed) + the
  flyback-diode lesson. The first stateful-conduction part. **Med.**
- ~~**Potentiometer** (`POT`) — 3-terminal wiper divider (A/B ends + wiper W);
  `buildNetlist` expands it to two resistors A→W=R·t, W→B=R·(1−t) (no new solver
  element). `Component.wiper` (0..1) + inspector % chips + the wiper slides live in
  the schematic/factory glyph. "Potentiometer Dimmer" example. Web-only; golden
  untouched.~~
- [ ] **Fuse** (catalog §6.1) — latched "blown" state (P6, + I²t thermal P7): once
  the current·time threshold trips, it stays open until replaced. **Med.**
- ~~**Thermistor NTC/PTC** (catalog §6.3) — placeable now: catalog + schematic glyph +
  heat-valve analogy + temperature knob, with R(T) stamped as a plain resistor (web-only,
  the POT pattern). See 2026-06-17 (4).~~ Still open: the SIM-SIDE thermal state P7
  (self-heating from I²R) so temperature is modelled, not just a knob — the `temp` field
  and `thermistor.ts` curves are already shaped for it. **Med.**
- [ ] **LDR / photoresistor** (catalog §7.1) — resistance vs light; needs the
  light/display I/O channel P8 (a player- or contract-driven light input). **Med.**
- [ ] **Photodiode** (catalog §1.4) — light-controlled current source (P8 + Newton). **Med.**
- [ ] **Seven-segment display** (catalog §7.2) — multi-terminal display, light I/O P8. **Med.**
- [ ] **Ceramic capacitor** (catalog §2.2) — low-ESR, non-polarized, voltage derating
  (P2 per-device params). **Low–med.**
- [ ] **JFET** (catalog §3.3) — depletion-mode FET (P3, MOSFET-like Newton path). **Med.**
- [ ] **Darlington pair** (catalog §3.4) — two cascaded BJTs, β≈β² (P3 composite). **Low–med.**
- [ ] **Programmable / electronic load** — commanded CC/CP/CR sink (for VRM load-testing). **Med.**
- [ ] **Autotransformer / true variac** — single tapped winding (see entry below). **Med.**
- [ ] **Reusable ferrite / magnetic core** — one core abstraction → transformer /
  common-mode choke / ferrite bead / cored inductor (see entry below). **Med–high.**

**ICs still to build** (`ic-buildings-ideation.md` §2.4 tier table, §3 entries) — all
Tier-A behavioral unless noted; build on the tick-pure digital pattern the gate set:
- ~~**D flip-flop** (`ELEM_DFF=19`, §3.2) — the first **sequential** element: 4-pin
  (Q=a, D=b, CLK=c, Q̄=d), `value`=rail. Samples D on the rising CLK edge into a
  stored bit (persistent unhashed state like the reactive companions), drives Q/Q̄
  through `GATE_GOUT` from the committed bit (constant stamp, no Newton); one-tick
  clk→Q delay. Edge-detect in the step commit. 4 tests (latch+hold, ÷2 toggle,
  validate, reproduce); golden unchanged. Web: `FF` part (clocked-box glyph + edge
  notch), partInfo, "Clocked Memory" + "Toggle (÷2 Counter)" examples. Reuses the
  a/b/c/d boundary (no wasm change).~~ (JK/latch variants still open.)
- [ ] **Shift register / counter / decoder / mux** (§3.3) — clocked integer state +
  **bus ports** (the §1.5 multi-bit belt renderer). **Low–med.**
- [ ] **555 timer** (§3.4) — internal comparators + SR latch + tick-derived output;
  R/C on the timing pins set the frequency. The "make it blink" win. **Med.**
- [ ] **Linear regulator (78xx)** (§3.5, Tier B) — controlled pass element holding
  Vout against load (output impedance + transient ride). The **VRM** thread. **Med.**
- [ ] **Comparator** — dedicated threshold→rail part with hysteresis (op-amp open-loop
  already does the basic job; this adds input loading + a clean schmitt). **Low.**
- [ ] **Switching regulator / buck-boost controller** (§2.4, C→A) — build the buck
  from discretes (we already simulate one) then seal it. **Med.**
- [ ] **DAC** (§2.4) — code → output voltage (a driven Thévenin source). **Low–med.**
- [ ] **ADC** (§2.4) — sample/quantize a node voltage → digital word on the tick grid. **Med.**
- [ ] **H-bridge / motor driver** (§2.4) — digital control of four switches + an
  inductive load. **Med.**
- [ ] **Memory (register file / SRAM)** (§2.4) — addressed array of bits. **Med.**
- [ ] **Microcontroller** (§3.11, emulator) — real C/Arduino firmware on an emulated
  core, a deterministic digital island. The sequential capstone. **High.**
- [ ] **FPGA** (Tier C) — the seal-a-built-subcircuit reprogrammable building; the
  spatial capstone. **High.**

### Owner requests — autotransformer + an ideal-vs-real fidelity pass
- [ ] **Autotransformer / true variac** (owner, 2026-06-15): a **single tapped
  winding** (top / tap / bottom — the tap is the 3rd terminal `c`), where the
  tap-to-bottom voltage is a chosen fraction of top-to-bottom. The authentic variac
  (continuously variable if paired with the pot), non-isolated, more copper-efficient
  than the two-winding transformer. Natural variant of the coupled-inductor math
  already built (one self-inductance + a tap fraction; or two series-coupled
  sub-windings sharing the tap node). **Note:** you can ALREADY rough one out today
  by **series-connecting the existing 2-winding transformer's windings** (tie P− to
  S+ → that junction is the tap) — a real technique ("transformer connected as an
  autotransformer"); the coupling does the work. A dedicated `AT` part would be the
  clean/authentic version.
- [ ] **Ideal-vs-real fidelity pass** (owner, 2026-06-15): a deliberate later pass
  that **separates the idealized parts from the realistic ones** and wires fidelity
  into **progression/tech-tree** (`docs/game-progression.md`, `docs/game-rewards.md`):
  ideal primitives early (ideal transformer ratio, lossless), real models later
  (winding R already in the transformer, leakage/saturation, ESR, tolerance, the
  realism multiplier in `game-rewards.md`). Catalog which parts have an ideal vs real
  tier and gate the real tier behind the tech tree. Do this when doing change/progress
  work, not now.

### Owner requests — potentiometer + programmable load (for VRMs/regulators)
- [ ] **Potentiometer** (owner, 2026-06-15): a player-adjustable 3-terminal variable
  resistor — two ends + a **wiper**, with a knob (0..1 wiper position) in the
  inspector. Model = two resistances `R·t` and `R·(1−t)` from the wiper to each end
  (reuses the existing resistor stamp; the wiper is the 3rd terminal `c`, already
  threaded). Gives variable dividers, adjustable bias/feedback, manual gain — and is
  the natural "knob" primitive. Low effort (no new sim primitive: expand to two Rs
  in `buildNetlist`, like the EC cap, OR add a tiny `ELEM_POT` if cleaner).
- [ ] **Programmable / electronic load** (owner, 2026-06-15): a sink that draws a
  *commanded* current (constant-current) — and ideally constant-power / constant-R
  modes — so you can **test supplies and build VRMs** (load-step response, regulation,
  efficiency). Model = a controlled current sink (a value-set current draw, possibly
  gated on its terminal voltage for CC vs CP). Pairs with the regulator IC + the
  buck we already simulate → "build a VRM and load-test it" contracts. Together with
  the pot, these unlock real power-supply design play.

### Owner requests — transformer phase (deferred; needs 4th terminal `d` + coupled-inductor model)
- [ ] **Full-bridge rectifier example with a tunable turns ratio.** Centerpiece of
  the transformer example set: a full-bridge rectifier fed from the transformer
  secondary, with the **turns ratio (N₂/N₁) as the tunable knob** so the player
  watches the turns-per-side step the AC up/down before the bridge rectifies it
  (step-down → bridge, DC output tracks the ratio). (Owner idea, 2026-06-15.)
- [ ] **Build-the-transformer-from-primitives example + a REUSABLE magnetic core.**
  Even cooler (owner, 2026-06-15): place **two coils (inductors) + a magnetic core**
  and watch the coupling come alive — model the **magnetic core as a placeable
  coupling element** that links windings via mutual inductance M = k·√(L₁L₂),
  rather than (or alongside) a monolithic 4-pin transformer. Owner follow-up: make
  that **core element reusable — e.g. a ferrite**. One core abstraction (winding
  count + coupling k + saturation curve) then covers a whole family: **transformer**
  (2 windings), **common-mode choke** (2 windings, EMI), **ferrite bead** (1 lossy
  winding, noise suppression), a **cored inductor** (1 winding, ↑L + saturation),
  **autotransformer**, **saturable reactor**. This strongly favors the **modular
  "core couples windings" architecture** over a sealed transformer part — more
  Factorio-ish, more teachable, and far more reusable. The monolithic 4-pin
  transformer (now in flight) is the fast first cut; design the modular ferrite-core
  element as the follow-on (it can share the coupled-inductor math already built).
  Owner: **finish logic gates first, then transformers.**

### IC ladder — logic gate (first behavioral digital IC)
- ~~**sim-core logic gate** (`ELEM_GATE = 17`, #51): Tier-A behavioral driver,
  a=OUT/b=IN1/c=IN2, `value` = logic-high rail, `aux` = function code (0 AND, 1 OR,
  2 NAND, 3 NOR, 4 XOR, 5 XNOR, 6 NOT, 7 BUF). Tick-pure boolean of the committed
  previous-tick inputs thresholded at half-rail; drives OUT toward 0/rail through
  `GATE_GOUT` (a constant Thévenin stamp = the switch's shape) in all 4 assembly
  sites + 4 readouts; one tick of propagation delay, no persistent state, golden
  unchanged. Also restored the op-amp's per-tick current readout.~~
- ~~**GMIN floor on gate inputs** (#52): a floating/undriven gate input was a
  singular row; floored each sensed input to ground with `GMIN` → non-singular,
  reads logic low. Golden unchanged; 79 tests.~~
- ~~**gate WEB wiring:** placeable AND/OR/NAND/NOR/XOR/NOT parts (each → type 17 +
  its `aux` code; `value` = rail, half-rail threshold), boolean-symbol schematic
  glyphs + Factorio decider/sorter, partInfo (truth table + threshold + 1-tick
  delay), and a "Logic & ICs" example set (inverter→LED, AND interlock, XOR+AND
  half-adder). Replaced the old non-simulated "&" placeholder.~~
- [ ] **Next IC rungs:** D flip-flop (clocked 1-bit state, edge detect on the tick
  grid) → counter/shift (bus ports) → 555 → linear regulator. Then the deferred
  discretes (fuse/thermistor/LDR/7-seg) and the 4th-terminal parts (relay,
  transformer — see the owner transformer requests above).

### Design ideation (no code) — ground returns + progression; MCU decision
- ~~**`docs/game-ground-returns.md`** — tiered grounding ladder G0 ideal-star → G1 lumped return R+L → G2 paintable ground-zone (the unlocked escape hatch) → G3 loop-area/EMI (integer shoelace × di/dt, deterministic) → G4 shared-ground noise budget; rejects full multi-layer PCB. Grounding is a **bonus/multiplier axis, not pass/fail**; violations located+explained; EMI scalar stays out of the golden.~~
- ~~**`docs/game-progression.md`** — 9-era tech-tree spine gating the ~8 sim primitives (not parts individually); unlock via credits + competency exams + discovery; the contract's **judgement part = a placeable acceptance fixture** whose pins are the harness. Exploration rewards: **Lab Notebook** codex (first time you cause a phenomenon), **Eureka boosts** (doing X discounts X's gate), **autopsy-for-Lux** (analyze a blown part), **Lux-vs-Credits** (deepen vs widen — a tinkerer can climb without shipping).~~
- ~~**MCU decision** captured in `ic-buildings-ideation.md` §3.11: real C/Arduino firmware at the top of the ladder, run on an emulated core as a fast deterministic digital island; MCU (sequential) + FPGA (spatial) are the two programmable capstones.~~
- ~~**NEXT (owner-greenlit): MOSFETs + transistors** — the multi-terminal (P3)
  lift, web/UI half. Built on the committed sim-core level-1 MOSFET
  (`ELEM_NMOS = 11`, `ELEM_PMOS = 12`; D=a, S=b, G=c; crates untouched, golden
  `0xeaac376499e4fa24` unchanged). **`buildNetlist` now carries a third terminal
  `c: Uint32Array`** — a 3-pin device (a MOSFET) stamps `c[i]` = its gate node
  (pin 2), a 2-pin part stamps `c[i] = 0` (ground, ignored by the core); pin→
  terminal map is direct (pin 0 → a/Drain, 1 → b/Source, 2 → c/Gate). `c` folds
  into the topology `sig` (so rewiring the gate rebuilds, a pure move doesn't),
  the MOSFET pulls its gate net into the floating-source union-find, and
  `elemOfComponent`/`nodesOfComponent` map to [drain, source] (current = Id a→b,
  vAcross = Vds). App passes `nl.c` at both `setNetlist` call sites (empty array
  for the ground-only fallback). `graph.ts PART_KINDS` `NM`/`PM` (ok/green, pins
  D,S,G, value unused) + bin + Active & Switching category. `glyphs.ts`:
  schematic = the standard MOSFET symbol (insulated gate bar, drain up/source
  down, body arrow N-in / P-out, channel chokes shut in cutoff); factory = a
  gain-assembler/valve (thin gate control belt opens a fat drain→source main
  belt whose width/density track Id, choking shut below threshold) — all on the
  bounded `o.phase` clock. `partInfo.ts` `NM`/`PM` (Vgs vs ~2 V threshold;
  cutoff/triode/saturation; square law + gm; insulated gate draws no current;
  live region + Vds/Id + a recovered-gm row). **Two `examples.ts` builds** under
  Power & Switching: **MOSFET as a Switch** (gate drives an LED hard on/off,
  gate-high/low toggle) and **Common-Source Amplifier** (NMOS + 100 Ω drain R,
  Vgg = 3 V → saturation, drain ≈3.9 V @ ~11 mA, small gate swing → larger
  inverted drain swing). All gates green (53 sim-core tests: 52 pass / 1 ignored;
  fmt/clippy; build:wasm; web format/check/lint/build).~~

### Done — three board-interaction features (ghost / junction-drag / junction tool)
- ~~**Translucent placement ghost for the armed part.** `board.ts` adds a
  non-interactive `ghostLayer`/`ghostGlyph` (above components, below pending-wire/
  probe; alpha `GHOST_ALPHA`), reusing `drawGlyph` at the grid-snapped cursor cell
  (`cellToWorld`). Shown only while a part is armed AND the pointer is over the
  canvas (tracked via `pointerenter`/`pointerleave` → `pointerInside`). New
  placement-rotation state `armedRot`: `setArmed` resets it to 0 on a fresh kind;
  `rotateArmed()` (R via App when armed + nothing selected) turns the ghost; the
  drop applies it via `placeCell(kind, cell, rot)`. R still rotates the selection
  when something is selected.~~
- ~~**Double-click a junction to drag it.** `graph.ts` `moveJunction(id, cell)`
  (updates only `j.cell`; incident wires reference it by id so they follow; `sig`
  built from topology, not position, stays stable). `board.ts`: `junctionDrag` +
  `lastJunctionTap` detect a 2nd press on the same junction within
  `DOUBLE_CLICK_MS` (350) → grab + drag (snap, re-route, undoable via pending
  snapshot, commit only if moved). Single-click on a junction still starts a wire.~~
- ~~**Junction placer tool + `J` hotkey.** Added `"junction"` to `Mode`; toolbar
  button (mirrors Wire, `is-active` + `.hk` badge) + `enterJunction()` + `J` in
  `onKey`. In junction mode a wire click drops a junction at the snapped point via
  `junctionOnWire(wireId, cell)` — `from` is now **optional**; with no incoming
  wire it splits the trace in place (both halves end at J → survives prune, ties
  the wires into one net). crates/ untouched; golden + all gates green.~~

### Done — Zener (`ZD`) + electrolytic-cap (`EC`) web/UI integration
- ~~**Zener diode (`ZD`, sim type 10) + electrolytic cap with ESR (`EC`, netlist
  expansion, no new sim type) wired through the whole web layer** (crates
  untouched; Zener `ELEM_ZENER = 10` was already committed, golden
  `0xeaac376499e4fa24` unchanged). **ZD:** `netlist.ts TYPE_OF ZD:10`; `graph.ts
  PART_KINDS` (bronze, `twoPin("A","K")`, `value` = Vz, default 5.1 V) + App bin +
  `values.ts` curated Vz chips (3.3/4.7/5.1/6.2/9.1/12 …); `glyphs.ts` schematic
  (triangle + Z-bent cathode bar, forward glow + cyan breakdown bloom) + factory
  (check-valve + side spillway/weir that opens on reverse breakdown);
  `partInfo.ts` (forward ~0.7 V diode / reverse blocks until Vz then clamps; Vz +
  power rows). **EC:** modelled honestly as an ideal cap **in series with a fixed
  0.5 Ω ESR**, built in `buildNetlist` — each `EC` allocates one internal node
  (after pin/junction nodes, bumps `nodeCount`, deterministic by sorted id) and
  emits TWO elements (capacitor `+`→internal, resistor=ESR internal→`−`);
  `elemOfComponent[EC]`→the cap (series current), `nodesOfComponent[EC]`=[+pin,−pin]
  (V across whole part); folded into the topology `sig` so pure moves don't reset.
  `graph.ts PART_KINDS` (cyan, polarized `twoPin("+","−")`, `value` = C, default
  100 µF) + bin + `values.ts` (10 µF…1000 µF); `glyphs.ts` schematic (curved + straight
  plate, "+" mark, charge fill) + factory (ribbed pressure tank, ESR throat at
  inlet); `partInfo.ts` (C + ESR; energy ½CV² + ESR rows). Three `examples.ts`
  builds: **Zener Shunt Reference** (12 V→1 kΩ→ZD→GND clamps ≈5.1 V, ~6.9 mA) and
  **Two LEDs in Series** (9 V→270 Ω→LED→LED→GND, ~19 mA, drops add) under Diodes;
  **Electrolytic Decoupling** (200 Hz AC→D→load∥EC, ripple + ESR can't perfectly
  flatten) under Capacitors & Inductors. All glyph motion rides the bounded
  `o.phase` clock — magnitude is fill/brightness/density/thickness, never speed.
  Full gate set green (44 sim-core tests, golden unchanged).~~

### Done — Schottky + LED web/UI integration (sim types 8/9)
- ~~**Schottky (`SD`) + LED (`LED`) wired through the whole web layer** on top of
  the finished sim-core diode family (`ELEM_SCHOTTKY = 8`, `ELEM_LED = 9`; crates
  untouched). `netlist.ts TYPE_OF SD:8 / LED:9`; `graph.ts PART_KINDS` (SD cyan,
  LED accent) + the App bin; `glyphs.ts` schematic + factory drawers for both
  (Schottky triangle + bent-flag cathode bar / low-loss check-valve; LED triangle
  + radiating arrows + **emit glow keyed to forward current** / gate-plus-beacon);
  `partInfo.ts` SD + LED descriptors (low ~0.3 V vs ~0.7 V; ~1.9 V band-gap drop +
  relative-brightness derived row); two `examples.ts` builds (**LED Current-
  Limiting** ≈20 mA, **Schottky vs Silicon**) under the Diodes category. All glyph
  motion rides the bounded `o.phase` clock — magnitude is brightness/density/alpha,
  never speed. Full gate set green (42 sim-core tests, golden unchanged).~~

### Design ideation (no code) — parts catalog + IC buildings, owner-driven
- ~~**`docs/parts-catalog-ideation.md`** — the discrete/analog menagerie (diode family, real caps, transistor zoo, op-amp, relays/switches, fuses/varistors/thermistors, LED/LDR/7-seg, transformer). Each part: concept, deterministic sim model, schematic symbol, Factorio building, visual-language fit, difficulty + deps. Reduces to **8 new sim primitives**; P1/P5/P6/P7/P8 are independent of the expensive multi-terminal lift (P3). Recommended first 5: per-device params → Schottky → LED → Zener → electrolytic-w/-ESR.~~
- ~~**`docs/ic-buildings-ideation.md`** — ICs as Factorio **assemblers** (named ports + recipe). Fidelity ladder: behavioral black box → macro-model → **player-builds-then-seals-into-a-chip**. Per-IC entries (gates, 555, op-amps, regulators, ADC/DAC, memory, µC, H-bridge). First ICs: logic gates → flip-flop → counters → 555 → linear regulator. The **seal mechanic** is the keystone. Open Qs (controlled sources, the seal's hash contract) left for owners.~~
- [ ] Owner to steer which parts/ICs to build first and the new sim primitives (esp. P3 multi-terminal + P4 controlled sources, which `parts-roadmap.md` already flags).

### Done — animation-rate decoupling, info-panel jitter, belt explainer
- ~~**Flow rate decoupled from magnitude + tps:** animations were unreadably fast at high V/I and high playback; lowering tps didn't help because magnitude still scaled in. One bounded visual flow clock (`FLOW_HZ`) now drives everything, independent of V/I/tps; timeline gives direction only (forward running / sign of tick-change on scrub); magnitude → density + thickness + alpha; carrier/energy slosh preserved via the saturated **sign** of current/power. `glyphs.ts flow()` + `board.ts update()/redrawWires`; spec in `docs/ui/visual-language.md`. Render-only, golden unchanged. (Agent-built, cherry-picked.)~~
- ~~**Info-panel jitter:** the plain explanation embedded live numbers → prose reflowed every frame. Prose now static (`partInfo.ts plain()` arg-free); changing numbers grouped into a "Right now" section. Always-on "carriers & energy" explainer added to the Info tab (covers why energy flows forward when V and I are both negative). New `--energy` token.~~

### Done — interaction polish (#22), carrier/energy belt, demo pages
- ~~**Fixes (#22):** flow-jitter cap (per-frame phase delta + ≤14 chevrons/wire); rotated-part labels against the rotated pin bounds; on-board meter gated to no-value parts (popover shows V·A); top selector chips wrap; **reset-on-edit** rewinds scope+clock to t=0 on any change (`App.onChange`).~~
- ~~**Carrier/energy belt (loop-tile):** two animated layers per wire — carriers (chevrons, integrate signed current → DC stream / AC slosh) + energy (orange dots, integrate signed power v·i → steady delivery on a resistor while carriers slosh, slosh on a reactive part). Per-wire accumulators off the timeline phase, pruned on delete; `docs/ui/visual-language.md` updated. Render-only, golden unchanged.~~
- ~~**Demo pages:** `docs/visuals/resistor.html` + `diode.html`, standalone, dark HUD style (agent-built on `claude/resistor-diode-visuals`, cherry-picked).~~
- [ ] **More demo pages** in the dark style (capacitor, inductor, RC/RL); link them from the app.
- [ ] Optional **toggle** for the energy layer if the belt is too busy on dense boards.

### Done — ammeter, custom rate, progressive guided builds
- ~~**Ammeter**: the Measure tool gains a V/A toggle; "A" reads the current through a clicked part or wire (KCL branch current) — `board.setProbeMode` + `drawAmmeter` + cached per-frame wire currents.~~
- ~~**Guided builds run the sim live** (`startBuild` resumes playback) so each added part comes alive in a working sub-circuit; **examples reworked into progressive/observable builds** (agent) — the buck now: forward path → ragged spike → add diode (spike vanishes) → add cap (smooths to ≈4 V). `steps[]`-only, topology unchanged, `done()` monotonic.~~
- ~~**Custom playback rate**: a ticks/second number input beside the rate presets.~~

### Done — collapsible example categories
- ~~Examples are grouped into collapsible `<details>` categories (Fundamentals / Sources & Current / Capacitors & Inductors / Diodes / Power & Switching) so people can work through them; `examples.ts` exports `EXAMPLE_CATEGORIES` + `categoryOf(id)`. AC categories land with the AC set.~~

### Done — AC track (source + 9-example ground-up curriculum)
- ~~**AC source** (sim-core type 7, `ELEM_ACSOURCE`): ideal sine `5·sin(2π·f·t)`, `value` = frequency, deterministic (pure fn of the tick), golden unchanged; 38 tests incl. sine-tracking, RMS, AC+diode rectifier convergence. Wired into the web: netlist `AC:7`, `PART_KINDS` AC (500 Hz default, "Hz"), animated `drawAC` glyph (circle + sine), bin entry, curated inspector frequencies.~~
- ~~**9 AC examples** (`docs/ui/ac-curriculum.md` → `examples.ts`), build-and-observe, under new categories **AC Fundamentals / Reactance / Filters / Resonance / Rectification**: ac-resistor, ac-rms, ac-cap, ac-ind, ac-lowpass, ac-highpass, ac-resonance, ac-rectifier, ac-supply. Every net + demo hand- and netlist-verified; all frequencies in the 50 Hz–5 kHz band.~~

### Design ideation (no code) — captured, owner-driven
- ~~Game-design exploration of the "Factorio (power-as-belts) + Shapez (contract deliverables)" sandbox: `docs/game-factory-loop.md` (cap=buffer-chest / inductor=flywheel, brownout=backpressure, black-box validated sub-circuits to scale) and `docs/game-contracts-economy.md` (parametric sim-graded contracts for an endless supply, standing production contracts, Credits+Lux + anti-grind firewall).~~

### Done — teaching tools (info drawer + calculators), popover + DMM fixes
- ~~**Component info drawer** (`partInfo.ts` + `infoDiagram.ts` + App): an ⓘ Info tool opens a right-side drawer with a big animated diagram (reuses the glyph drawers at scale in a tiny Pixi sub-app), the governing equation with **live numbers substituted**, a plain "right now" sentence, and derived rows (power/energy/τ/dV·dt) — all from the existing per-frame electrical map, no new wasm crossing.~~
- ~~**Calculators tab** (`calc.ts`): divider / Ohm / RC·RL τ / Xc·Xl / f₀ / RMS, each always showing the **worked substitution** (anti-cheat), with "↤ sel" to fill matching fields from the selected part.~~
- ~~**Value popover fixes**: removed the stray scrollbar (the caret was triggering it — scroll now only on the expanded grid), widened to 320 px with larger chips, and **restored the live "V across · I through" readout** at the top.~~
- ~~**Combined DMM probe**: the Measure "A" probe now reads a part/wire's **current AND voltage together** (with a teaching note that real meters use separate ports).~~

- ~~**Schematic ↔ Factory style toggle** (`docs/ui/teaching-tools.md` Tool 2): a parallel `FACTORY_DRAWERS` map in `glyphs.ts` (cap = buffer chest that fills, source = generator, R = throat, L = flywheel, D = check-valve, SW = door, GND = drain) sharing pin geometry + the same flow/charge animation; `board.setStyle` + `setGlyphStyle` + a toolbar toggle; default schematic. Wiring unchanged across styles.~~

### Pending / owner-driven
- [ ] **Review + integrate the contract prototype** (on worktree branch `worktree-agent-a8d3b4a8b025619c4`, commit `8872b3c`): Test Load judgement part + sweep grader + Contracts tab + Credits. Cherry-pick will conflict with the AC/info-drawer changes — resolve on integration. Then Lux + standing contracts + the firewall.
- [ ] **Sandbox model** (`docs/architecture.md`): per-island adaptive ΔT + shared physical-time clock.
- [ ] Calculator **solve-for → push-back** and the **per-tier Factory reveal** (once competency gates exist).
- [ ] **Sandbox simulation model** (from the ΔT-in-one-sandbox question): shard the sim **per electrical island** (connected component), each with its own **adaptive ΔT** sized to its fastest dynamics; drive the whole board off a **shared physical-time clock** (each island does however many of its own ΔT-steps to reach the target sim-time); wiring two islands merges them to the finer ΔT. MHz comes free per-island; a single ms→GHz *connected* net is the deferred multirate frontier. Capture in `docs/architecture.md`; black-boxing validated sub-circuits is also a ΔT/perf lever. (Owner to steer before building.)
- [ ] **Game MVP** (owner-driven, if greenlit): the smallest "not-a-puzzle" loop — a **parametric contract generator + pin-sampling grader** off the deterministic replay (start with one template, e.g. "hold 5 V ±2% under 0–100 mA").
- [ ] **Selectable / per-example DT** (for RF): DT is a fixed 2 µs global; to reach MHz/GHz cleanly each scenario wants its own DT. Make DT a netlist/scenario parameter (keep the golden pinned at 2 µs). Audio-range AC (≤ ~5 kHz) is fine at 2 µs today.
- ~~**Inspector popup over the component** (`docs/ui/inspector-popup.md`): the value picker now floats as a popover anchored above the selected part — `board.ts` projects `componentBox` through the world transform each frame (`onAnchor`, change-detected, null during gestures/Measure); `App.svelte` positions an absolutely-placed `.value-pop` in `.board-frame` with edge-flip + a caret. Removed from the telemetry panel.~~
- ~~**Incomplete-circuit affordance** (`docs/ui/incomplete-circuits.md`): `buildNetlist` now detects an ideal current source whose forced current has no return path (union-find over non-`I` elements; flags `floatingSources`), and App shows an amber "no return path — complete the loop" warning without halting the sim. (Deterministic solver `singular()` backstop is the remaining refinement.)~~

### Done — ticks/second playback, wall-clock readout, timeline-to-0, +3 examples
- ~~**Ticks-per-second playback**: rate is now ticks of sim time per *real* second (real-dt driven), presets [50, 500, 5k, 50k, 500k]/s (500k/s = real time at DT 2 µs), replacing the per-frame multiplier (`loop.ts setTicksPerSecond` + `MAX_STEPS_PER_FRAME`).~~
- ~~**Timeline reaches t=0**: history is now an O(1) circular ring with a large cap, so the scrubber spans 0→max in a normal session (no O(n) shift/tick). (True unbounded rewind via keyframes is still the deep-rewind backlog item.)~~
- ~~**Wall-clock readout**: `DT_SECONDS` exported; scrubber + telemetry show the displayed tick as a real-time duration (tick × DT); rate buttons tooltip their "× real time" factor.~~
- ~~**+3 examples** (agent): RLC ringing (underdamped, ζ≈0.16 — damped sine on the scope), PWM dimmer (SW→RC averages to ≈duty×Vin), diode clamp (node pinned at ~0.57 V, with a lift-the-diode demo). Each net hand- and numerically-verified.~~

### Done — scope/telemetry upgrade (expandable, per-node toggle + rename)
- ~~Scope can **expand** (≈60% of the board) from a telemetry button; per-node **show/hide** checkboxes and **rename** inputs in the telemetry panel; the scope autoscales to visible traces and draws a coloured **legend** of node names. `board.ts`: `setNodeLabel`/`setNodeHidden`/`toggleScopeExpanded` + `scopeLegend` pool; `App.svelte`: node controls (GND stays fixed).~~

### In flight / backlog (this session)
- ~~**Solver upgrade → nonlinear Newton engine** (sim-core): deterministic Newton–Raphson outer loop engaged only when a nonlinear element is present (linear fast-path kept byte-identical → golden unchanged), with the **diode** (type 5, Shockley + gmin + pnjlim limiting, 100-iter cap) as the first nonlinear element. 25 tests pass incl. `diode_run_is_reproducible`; `docs/architecture.md` + `docs/determinism.md` updated. Foundation for LED/BJT/MOSFET.~~
- ~~**Diode + switch wired into the web**: `netlist.ts` `D:5`/`SW:6`; animated `drawD` (triangle + cathode bar, forward-conduction glow/flow) and `drawSW` (lever flicks open/closed off live `vAcross`, flow when closed); both placeable in the bin.~~
- ~~**Clock-driven SWITCH element** (`sim-core`, type 6): time-varying linear conductance, pure function of the tick (`SWITCH_PERIOD_TICKS = 50` = 10 kHz, `value` = duty, Ron 0.01 Ω / Goff 1e-9). Golden unchanged; 31 tests incl. `switch_buck_converter_steps_down_and_is_finite` + `switch_run_is_reproducible`.~~
- ~~**Buck Converter example**: Vin → SW → L → OUT with a freewheel diode + smoothing cap + load + GND, vertical V/C/R/D via an optional `rot` on the example `comp()` helper. Steps down 10 V → ≈4 V at 40% duty; every part animated.~~
- ~~**LED** wired up with a current-limiting example (and a Schottky added alongside); see the 2026-06-15 Schottky+LED entry above.~~ Still open: other nonlinear parts (Zener, BJT/MOSFET) on the Newton engine.
- ~~**1-pin part hit box** (GND): `componentBox` now returns a generous 36×48 grab box for 1-pin parts, so GND is easy to click + drag.~~
- ~~**Floating GND no longer falsely grounds**: `buildNetlist` only accepts a GND as the reference if its net is wired to ≥1 other pin (net size > 1); a GND sitting unconnected on the board is ignored, so a disconnected circuit no longer falsely "solves" (was reading 10 V·10 mA on an open I→R chain).~~
- ~~**Dangling current-source affordance (deeper #2)**: an ideal current source whose forced current has no return loop made the MNA system singular → the deterministic zero-pivot fallback reported a phantom (full current "flowing" + huge IR voltage). `buildNetlist` now **zeroes the forced current** of every detected `floatingSources` member so the dead branch reads an honest 0 mA / 0 V (the amber "no return path" banner explains why); closing the loop restores the real value. Verified through the wasm solver (open: 0 mA; closed: 10 mA / 10 kV). Web-only, golden-safe.~~
- ~~**Value Inspector** shipped (`web/src/lib/values.ts` + board `setComponentValue`/`onSelect.single` + App): select one part → curated value chips + −/+ standard-value stepper + a "more values" decade×significand picker (E24 R / E6 C·L; curated lists for V/I and SW duty). Every valued part (V/R/C/L/I/SW) is now configurable; edits rebuild the netlist live.~~
- [ ] **Buck converter demo** (owner, "fun, less important"): a fully-animated buck converter showing energy moved in "buckets" to a new voltage — needs switching (switch/MOSFET + diode + L + C), so it follows the solver upgrade + a switch part.

### Done — KCL-aware belt flow, finer ΔT, readable example layouts + new examples
- ~~**KCL-aware wire flow:** `computeWireCurrents()` routes each element's injected current along a per-net spanning tree, so every wire segment shows its true branch current — the supply rail now visibly **thickens toward a source and thins past each tap** (thickness + chevron density + direction all track it). Replaces the old single-element `wireCurrent`. Render-only; never touches the sim.~~
- ~~**Finer ΔT:** `DT` 10 µs → **2 µs** (5× smoother dynamics). Golden regenerated `0xeaac376499e4fa24`; the monotonic-RC test now runs the same physical time (15000 × 2 µs). Playback compensated so wall-clock pace is unchanged: default `tpf` 0.1 → 0.5, `SPEEDS` [0.5,1,2,5,20], chevron `TICK_FLOW` 0.03 → 0.006.~~
- ~~**Readable examples:** primer/divider/RC/RL relaid as clean rectangular loops (loads on top, V bottom-left, **explicit GND** bottom-right). Added two new examples: **Parallel Resistors** (shows the KCL rail accumulation) and **Current Source** (the new `I` part, V = I·R).~~

### Done — draggable wires, timeline-relative flow, crisp text, hotkeys
- ~~**Draggable wires:** `Wire.mid` optional waypoint; dragging a wire bends its orthogonal belt through a grid cell, dropping it back on the straight line straightens it. One `routeForWire` is the single source of wire geometry (draw/hit-test/selection-with-handle/probe). Cosmetic only — netlist sig ignores it, so the sim never resets.~~
- ~~**Timeline-relative flow:** the flow phase is `realPhase + tick*TICK_FLOW`, so the current arrows/dots advance with ΔT — forward when the tick advances (running or scrubbing forward), reverse when stepping/scrubbing back — instead of freezing whenever paused.~~
- ~~**Crisp text (round 2):** Text resolution floored at 2× (supersampled, sharp on 1× displays) and multiplied by zoom + re-rasterized so labels stay sharp zoomed in (`applyTextRes`, `ComponentNode.setTextRes`); the prior cap-at-2 mismatched the hi-DPI renderer.~~
- ~~**Hotkeys:** Space = play/pause; arrows nudge the selection (or pan when empty, `board.nudge`); `,`/`.` step a tick back/forward.~~

### Done — new ideal elements (current source + ground), via parallel agent
- ~~**Ideal DC current source (`I`, type 4):** sim-core KCL stamp (no branch unknown, consistent across operating-point + transient, `currents = value`); validation + doc table; 4 new tests (I·R drop, KCL, a→b sign flip, linear cap ramp). Glyph `drawI` (circle + arrow, flow ∝ current). Golden `0x6d05…` unchanged.~~
- ~~**Explicit ground (`GND`):** 1-pin reference part; `buildNetlist` prefers a GND net for node 0, else falls back to the first V source's − pin — so current-source-only loops are now simulatable. Glyph `drawGND` (three-bar ⏚). Design note `docs/parts-roadmap.md`.~~

## 2026-06-14

### Done
- ~~Bootstrap the repository per AGENTRUNBOOK.md: Cargo workspace + three crates (sim-core, sim-protocol, sim-wasm).~~
- ~~sim-core: deterministic fixed-step placeholder, FNV-1a snapshot hash, reproducibility test (passing).~~
- ~~sim-wasm: wasm-bindgen bindings (step/tick/state/protocol_version/snapshot_hash).~~
- ~~WebAssembly build wiring (scripts/build-wasm.sh → web/src/wasm); disabled wasm-opt so build works offline.~~
- ~~Web app: Vite 8 + Svelte 5 + TypeScript + PixiJS 8, workspace wired with pnpm.~~
- ~~Apply the Critical Error Computing design system (OKLCH palette, Saira / Saira Condensed / IBM Plex Mono, HUD shell, grid + neon glows) to the web UI.~~
- ~~First design pass: component bin, live oscilloscope board (auto-ranged traces of the deterministic snapshot), telemetry panel, transport controls (run/pause/step/speed).~~
- ~~ESLint flat config (typescript-eslint + eslint-plugin-svelte) + Prettier; lint gate green.~~
- ~~CI workflow (.github/workflows/ci.yml): rust-core + web-build jobs.~~
- ~~Seed docs: architecture, determinism, ADR-0001. README/NOTICE/CONTRIBUTING with placeholders filled.~~
- ~~SessionStart hook: self-heal the wasm toolchain on ephemeral containers + surface the agent handoff docs.~~
- ~~All verification gates green from a clean checkout (fmt, clippy, test, build:wasm, check, lint, build).~~
- ~~Write the game design document (docs/game-design.md): pillars, fidelity-as-progression loop, tech tree, challenge/grading model, milestones M0–M5.~~

### Done — parallel agent panel (M1 + M2 + polish), integrated
- ~~M2 (Lane A): replace placeholder dynamics with a real deterministic analog engine — backward-Euler companion models via Modified Nodal Analysis, bounded dense solve. Circuit: RC charge (V → R → C → gnd). `state()` = [v(n1), v(cap), i(src), v(rail)].~~
- ~~M2: committed determinism golden `golden_snapshot_hash_is_stable` (seed 42, 1000 steps → 0x92349dbbbf5a8293); kept `run_is_reproducible`; added monotonic-charge, closed-form, and seed→rail tests.~~
- ~~M1 (Lane B): interactive board — TS board model (`web/src/lib/graph.ts`), drag-from-bin placement, click-drag wiring, move/delete, Select/Place/Wire mode toggle, and a renderer + telemetry generalized to a variable-length state vector.~~
- ~~Polish (Lane C): self-host the fonts (dropped the Google CDN), CRT/scanline scope frame, full button/chip/telemetry state matrices, neon glows, prefers-reduced-motion.~~
- ~~Integrate the three worktree branches into the feature branch (disjoint files → clean cherry-pick); rebuild wasm; full gate suite green; align telemetry labels to the core's state layout.~~

### Done — interactive features + solver integration (session 3)
- ~~Zoom + pan viewport (wheel zoom to cursor, drag-empty / middle-drag pan); grid redraws across the visible region.~~
- ~~Ideal fixed voltage source added to the bin; parts carry value + unit; graph gains serialize/restore.~~
- ~~Simulation paused by default; bottom timeline scrubber with per-tick step back/forward, backed by a bounded snapshot history.~~
- ~~Selection: click + shift/ctrl multi-select with highlight; Delete removes selection; Ctrl+Z undo.~~
- ~~Animated component glyphs (R zigzag + flow/heat, C plates + charge, L coil + field halo, V battery + pulse) driven by real per-element current/voltage.~~
- ~~Wire the board graph into the solver: `netlist.ts` compiles BoardGraph → MNA netlist (ground = first source's − net); sim-core generalized to an arbitrary ideal netlist (Lane A); new golden `0x6d055513f0613902`.~~
- ~~Examples panel: Watch (load + run) and guided Build (auto-advancing checklist with a per-step "why") for Voltage Divider, RC, RL.~~
- ~~"Show don't tell" demos: live V-across / I-through readout on a selected part; a DMM probe (Measure mode, red/steel leads, needle tips) reading voltage between any two pins; a divider R2-to-ground toggle; a guided open/closed-loop concept beat.~~

### Done — UX/visual overhaul (session 5, from playtest feedback)
- ~~HiDPI crispness (devicePixelRatio + autoDensity) — fixes the blur.~~
- ~~"Factorio belts": orthogonal 90° trace routing, voltage-coloured wires, current flowing as directional chevrons (density/speed/direction track the current).~~
- ~~Scope fixed: per-tick sampling (freezes on pause, scrubs with the timeline), cursor line, numbered V axis + tick label; skips the flat ground node.~~
- ~~Reset Run (↺) + loop.restart(); fractional ticks-per-frame with a much slower default (0.25×).~~
- ~~Ground symbol + "GND 0 V" drawn at the source's ground pin.~~
- ~~Panel unified: the guide floats over the board so the Parts bin stays visible; a "Voltage & Current" primer that opens running so the first thing you see is current flowing through a voltage-coloured wire (+ a dismissible intro banner naming both primitives).~~
- ~~Live "V across / I through" readout on a selected part; draggable DMM probes that snap to a pin or a trace.~~
- ~~Component rotation (R hotkey + Rotate button): `rot` on the component, rotated `pinCell`, rotated glyph with upright labels; connectivity unchanged so the sim isn't reset. Watch now starts paused.~~

### Done — modeless interaction, Phase 0 (session 6)
- ~~Collapse Select/Place/Wire into one contextual **Build** mode + a **Measure** toggle (the 4-mode toolbar is gone). `Mode` keeps `place`/`wire` internally but App only sets `select`/`measure`.~~
- ~~**Armed-part** model (replaces Place mode): click a bin row to arm a kind (toggle), then click empty board cells to drop it and stay armed (place-and-repeat); drag-from-bin still one-shots. `board.setArmed` + `placeCell`; `onArm` mirrors a board-side disarm (right-click) into the HUD.~~
- ~~**Esc** = universal cancel (disarm → cancel wiring → clear selection); right-click disarms when armed (else deletes under cursor). Per-context cursor (copy/crosshair/default), a one-line contextual **hint**, and an **armed-part chip** (× to disarm) for discoverability.~~

### Open / Next
- [ ] **Modeless flow, Phases 1–2** (`docs/ui/mode-flow.md`; Phase 0 shipped): ghost preview snapping to the cell under the cursor + pin hover highlight/snap-ring (Phase 1); click→click chained wiring, `1`–`9` hotbar + `Q` pipette, Shift-drag box-select, Space-pan (Phase 2). Cleanup: retire the unused `place`/`wire` `Mode` variants once convenient.
- [ ] **Make it a game, not just a sim (owner-driven).** Full brainstorm + backlog in `docs/game-rewards.md`. Core rule: the sim is the only judge — a reward is a number off a deterministic graded replay. Two currencies: **Credits** (spend) + **Lux** (earned only by understanding; **Lux gates the tech tree** = the anti-grind firewall). MVP order: (1) contract + spec-sheet grader (generalize the RC challenge); (2) Credits + "Ship It" juice (replay the winning run); (3) realism multiplier with one real 5% resistor (the pillar, made playable); (4) par score + replay-verified leaderboard; (5) predict-then-reveal + first Lux.
- [ ] Per-component **value editing** (click a part → set R/C/L/V); the model already carries values + units, expose a small inspector.
- [ ] Extend the "show don't tell" demos to RC/RL (short the cap to watch it discharge; open the coil for back-EMF); make the probe a movable meter that snaps to whole nets.
- [ ] Nonlinear devices: diode (then BJT) with a capped Newton solve in sim-core.
- [ ] **Power-bus visual language on wires/nets** (`docs/ui/visual-language.md`, ref `docs/ui/dc-bus-reference.html`): net voltage as level + color + number; branch current as flow + thickness + number; KCL at taps; IR-drop sag. Add rail tokens (`--r12/--r5/--r33/--gnd`) to `app.css`.
- [ ] Add the event-driven digital engine and the behavioral MCU emulator; meet the analog domain at the pins (docs/architecture.md).
- [ ] First graded challenge: "V(cap) reaches 90% of the rail within N ticks", verified by measurement + deterministic replay.
- [ ] sim-protocol: design the real snapshot/command wire schema; choose a serialization deliberately and record an ADR.
- [ ] Deep rewind via sparse keyframes (the scrubber currently replays a bounded snapshot history; keyframes give unbounded exact rewind).
- [ ] Re-enable `wasm-opt` once binaryen is provisioned in the build image.
- [ ] GitHub Pages: still needs the owner to set Settings → Pages → Source: GitHub Actions, then the `pages` workflow deploys.

- [ ] **Editing & tool UX (owner QoL batch).** ✅ Pan tool is now inert + opt-in (only via H/toolbar; Esc → Build; no yield-to-select). Default is already Build. ✅ **Mirror/flip a component** shipped (`Component.mirror`, F key + Flip button — entry (100)). Still open: **select a wire occluded behind a component** (hit-test reach-through); **remove a junction** from a wire (without nuking its wires); **move a junction** individually.
- [ ] **Denser / "larger" package variants (owner idea; full brainstorm done).** Density as an optional scalar on `UserIc.package` (default Standard = today's numbers): a bigger drill-in canvas (a `dieScale` on `dieLayout`) + a capacity budget at seal, with cost / availability / power-density-heat tradeoffs (heat = derate `RATED_CURRENT_SLOT` in Real mode → reuses the FAIL mask, **golden-safe**, zero sim-core change). The "internals shrink when you zoom" visual already falls out of `userIcInternalsView`'s fit-to-footprint scale. Phased: (1) density scalar + canvas/zoom (pure presentation); (2) capacity-budget seal gate; (3) heat-as-derating; (4) economy hooks; (5) body-size archetypes (SOIC→TSSOP→QFN) + density-biased parasitics. Density is a per-*package* axis, orthogonal to per-part `tier`/`variant`.
- [ ] **Pin test-stimuli Phase 2+** (base GND/VCC/Input shipped): Clock/Pulse + Sine/AC drives (test sequential + analog ICs; clock A@f and B@f/2 auto-cycles a 2-input truth table), then −V/VREF, pull-up/pull-down + output load.

Superseded earlier items (tombstoned):
- ~~Replace the placeholder dynamics with the real analog solver~~ → done (Lane A; arbitrary netlist).
- ~~Wire the board graph into the solver~~ → done (`netlist.ts` + integration).
- ~~Promote `print_golden` into a committed golden~~ → done.
- ~~Web: drag-from-bin placement + real board graph~~ → done (Lane B).
- ~~Self-host the fonts~~ → done (Lane C).
- ~~Web: rewind via the transport~~ → snapshot-history scrubber done; keyframe rewind still open above.

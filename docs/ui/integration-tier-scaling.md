# Integration-tier subassembly scaling — design brief (SSI→ULSI)

> Output of a seven-seat all-ages game-design panel (early-childhood 5–8, tween 9–13,
> teen power-creators 14–22, adult casual, older-adults/accessibility, learning-science,
> electronics-realism), a director synthesis, and a stress-test of that synthesis against
> the actual code. Goal: make a placed subassembly's on-bench footprint encode its real
> integration tier — so a CPU built honestly reads as a chip, not a continent — while a
> player of any age can always grab it, name it, and dive into it. Captured here so the
> design survives the session and guides the build. Reconcile with
> `docs/ui/device-editing-all-ages-panel.md` on the 44px floor (see §7.1) and with
> `docs/ui/visual-language.md` on the "hotter = more" channel (see §8).

**North star:** *A placed subassembly's on-bench footprint should encode its real
integration tier the way a real IC package hides its die: the more devices folded inside,
the smaller the shell — so a player of any age (5–70+) FEELS the SSI→ULSI ladder (Moore's
Law in the hand: more inside, smaller outside) by watching density, while the truth — the
real device-count decades — always rides along in the label, never implied by the pixels.
Compaction is always one tap from "dive in and see the swarm," and a part is always
grabbable no matter how tiny it looks.*

---

## 0. What this is, and what it is NOT (read first)

This brief defines **how a placed subassembly is SIZED on the bench from its integration
tier**, and how that resting size composes with the existing zoom-to-open dive. It is
**additive and render-only**.

- It does **not** change the netlist. `flattenUserIcs` (`web/src/lib/userIc.ts:834`) still
  inlines each sealed instance to the genuine discrete circuit; the flattened graph that
  crosses the wasm boundary stays **byte-identical** (golden rule #2, §6).
- It does **not** move pins off the snap grid. Logical footprint and pin cells
  (`PartKind.pins` in `userIcPartKind`, `userIc.ts:336`) are untouched; only the drawn
  package **body** compacts inside a fixed pin-cage (§5).
- It does **not** replace the recursive zoom-to-open LoD
  (`drawUserIcInternals`, `userIcInternalsView.ts:193`); it makes that path
  **tier-aware** (§6) and reuses its `cumulativeScale` plumbing unchanged.
- It **reuses** the existing `integrationTier` classifier
  (`userIc.ts:1120`, over `countDevices` at `userIc.ts:1101`) verbatim — the badge and the
  size are driven by the **same** never-hashed device count, so they always agree.

> **Engineer's one-sentence contract:** a placed subassembly's resting body draws at
> `content_extent × σ(tier)`, clamped to a hard ≥44px on-screen hit floor and a pin-cage
> perimeter floor; `σ` is a pure PixiJS display transform derived from `countDevices`,
> memoized on the `UserIc` def, and it never enters `snapshot_hash` or the netlist.

## 1. The two orthogonal scale systems (the load-bearing decision)

The panel's central fear — the teen and realism seats' **"double-shrink"** — is that if
nesting compounds footprint multiplicatively AND the recursive zoom already applies a
fit-scale per level, a 3–4 layer CPU collapses sub-pixel and becomes unselectable. We
resolve it by keeping **two scale systems that are NEVER multiplied together**:

| System | What it is | Driven by | Applied | Compounds? |
| --- | --- | --- | --- | --- |
| **FOOTPRINT** (`σ`) | the on-bench resting size of a placed part — *"how integrated is THIS part"* | the part's **own** total recursive `countDevices` | **once**, at placement/draw | **No** — re-bases to its own tier each level |
| **DRILL / ZOOM** (`cumulativeScale`) | how deep you are diving — *"how far into the silicon am I"* | the product of each opened level's fit-scale `s` | continuously, on zoom-to-open | **Yes** — `cumulativeScale = ∏ s` |

The realism seat's correct intuition that "deeper = more integration stacked" is honored on
the **DRILL** axis, where `cumulativeScale` (`userIcInternalsView.ts:106`, accumulated at
`:662`) genuinely multiplies as you descend. The on-bench identity is honored on the
**FOOTPRINT** axis, applied once and never stacked, so a part never vanishes. Identity is
per-part; compounding is per-dive. This is exactly the `userIcInternalsView.ts` note that
the fit-scale `s` (`:289`) is the drill-path container scale — `σ` only seeds the **resting**
body; `s` (= `fitW/domW`, `:286–291`) keeps doing the dive math unchanged.

## 2. The tier ladder (names, bands, scale)

Keep the **five real textbook bands verbatim** as the taught vocabulary and badge — they
are the existing `integrationTier` classifier (`userIc.ts:1120`), unchanged. Map each to a
**fixed per-tier process-shrink `σ`** on a log-perceptual curve where each tier is ~1.5–2×
more compact than the last:

| Tier | Game device band (`integrationTier`) | Real-world analog | `σ` (resting footprint) | Why |
| --- | --- | --- | --- | --- |
| **SSI** | `< 12` devices | a lone gate / quad-NAND (7400) | **1.0** | Full toy size, no compaction — honest, it really is a few gates. Anchors the ladder. |
| **MSI** | `12–99` | 4-bit adder / 7400-series | **0.6** | First clear step (~1.6× denser). |
| **LSI** | `100–999` | 8-bit CPU / 6502 | **0.4** | ~1.5× denser; stipple thickens, gates start to disappear into fabric. |
| **VLSI** | `1 000–99 999` | 386-class | **0.25** | ~1.6× denser; thousands fit a small tile *because* `σ` is tiny — the physical "why". |
| **ULSI** | `≥ 100 000` | Pentium+ / CPU-class | **0.15** | **Hard floor:** clearly-tiny-but-pokeable, never sub-pixel. |

Total SSI→ULSI span ≈ **6.7×**. These `σ` values map cleanly to the band edges in
`integrationTier` (`userIc.ts:1122–1126`); the badge **is** the `σ` selector.

### 2.1 Perceptual / log mapping math

The real ULSI:SSI device ratio is ~10⁶:1; rendering that literally makes VLSI sub-pixel and
the game unplayable. We deliberately compress it to ~6.7:1 on a **Weber–Fechner (log)
curve** so each real *decade* of integration buys a roughly equal perceptual *step* of
compaction. Conceptually:

```
σ_tier  = a fixed step per band, ~×0.6 per rung   (SSI 1.0 · MSI 0.6 · LSI 0.4 · VLSI 0.25 · ULSI 0.15)
```

The compression is the playability call; the **honesty lives in the labels** (§8), never in
the pixel ratio. The ~1.5–2×/tier step (not 10⁶) is also what keeps a realistic 4–6 level
CPU dive inside the `MAX_SCALE = 1000` camera ceiling (`board.ts:200`) — see §6.3.

### 2.2 Continuous-within-a-tier, discrete-step-across-tiers (the reconciliation)

The panel split hard on **continuous vs discrete** `σ`:

- **Tween / teen / realism / learning-science** wanted continuous (so a fuller MSI reads
  denser than an empty one, and a band edge doesn't "pop" like a bug).
- **Kids / accessibility / adult-casual** wanted five snappy discrete sizes (so size is
  reverse-readable to a tier and the board isn't a bell-curve of near-identical blobs).

**Resolved — it is genuinely BOTH:**

```
placedFootprint = clamp_to_band( contentExtent(deviceCount), tier ) × σ(tier)
```

- **WITHIN a band:** the content extent grows continuously with `√(deviceCount)` (anchored
  so side ∝ √n; see §3 and `MM_PER_TOP_CELL`-style anchoring in `lib/zoomMeter.ts`), so a
  full MSI is visibly denser than an empty MSI — but **clamped** to that band's allowed
  footprint window so within-band growth never visually crosses into the neighbouring
  tier's size.
- **ACROSS a band:** `σ` **jumps** discretely, so the five tiers stay five learnable,
  nameable, distinguishable footprints.

The band-edge discontinuity is converted from bug to **feature** by animating it as an
announced "promotion" with hysteresis (§4.2). Nobody loses.

## 3. Footprint tracks DEVICE COUNT, not layout extent

The learning-science seat flagged an "artifacts vs density" confound: a sprawling,
badly-routed 8-gate cell has a large authored bounding box, while a tight 8-gate cell is
small. If footprint were driven by **extent**, the player would learn "spread-out layout =
bigger" (floorplanning), not "more devices = bigger" (integration density).

**Decision:** the `√` size driver is the recursive `countDevices` (`userIc.ts:1101`) — the
same input the tier badge already uses. The authored **bounding box** (`internals.bbox`,
used by `drawUserIcInternals` at `userIcInternalsView.ts:273–278`) is used **only** as the
pin-perimeter floor (§5), never as the primary size driver. A tight 8-gate cell and a
sprawling 8-gate cell therefore render the **same** footprint.

## 4. Compaction is an EVENT, not a silent state

Every age-seat converged here: a box that resizes on its own reads as the app breaking.

### 4.1 At seal / reseal — the "die-shrink"

At `captureSeal` / `resealUserIc` (`userIc.ts:547`), the live sprawling circuit visibly
**folds** into its tier-scaled package: a "die-shrink squash" animation, the tier badge
landing, and a one-line caption with the **real** device count and analog part — e.g.
*"Sealed an MSI cell — 23 devices, the scale of a 7400-series chip."* The act of
integration becomes the teaching beat: *"I made all that into THIS tiny thing."* Under
`prefers-reduced-motion`, this is an instant static swap (matching the Chip-Bench reduced-
motion table, `device-editing-all-ages-panel.md §8.2`).

### 4.2 At a band crossing — the "promotion"

When an edit pushes a cell across a band boundary (`integrationTier` returns a new value),
the rebin is an **announced, animated promotion** — a rank chime + caption *"Promoted to
LSI — 312 devices on one chip!"* — with the placed instance's incident wires **re-routed
live** (the Chip-Bench "route incident wires live" guarantee), so the size change reads as
cause→effect, never as a glitch. The discontinuity is the lesson the learning-science seat
wants; the cause→effect framing kills the "glitch" read the other seats fear.

### 4.3 Hysteresis at band edges

A cell hovering at `n ≈ 100` must not flicker between MSI and LSI on every edit. Apply a
small **hysteresis** band around each `integrationTier` threshold (`userIc.ts:1122–1126`):
once promoted, a cell only demotes after dropping a few devices **below** the up-threshold.
Pre-readers get a redundant cue (the dot count, §8) so the size jump always has a visible
cause.

## 5. A literal uniform-scaled replica, floored to the grid (board-correctness, non-negotiable)

> **OWNER OVERRIDE of the panel's first cut.** The panel originally proposed "keep pins at full
> grid extent, shrink only the drawn body inside a *fixed* pin-cage." That is wire-safe but it
> does **not** reduce a part's board FOOTPRINT (the pins — hence the occupied cells — stay
> spread out), so it would not un-balloon a CPU, and it is **not** a literal smaller replica.
> The owner's rule wins: **the placed part is a LITERAL, uniformly-scaled replica of what was
> built — never a re-layout** — reusing the exact IC zoom-to-open "fit" so it shrinks like a real
> die into its package. The adult/tween seats' real concern (wires must not detach/kink) is
> honored by index-connectivity + a grid floor, below.

**Decision — one uniform scale on the whole footprint, floored so pins stay on distinct cells:**

- **Uniform scale, no relayout.** The footprint scales by ONE factor: box `w`/`h` **and** every
  pin `dx/dy` ×`σ_eff`, preserving every relative position, side, and index — the photographic
  reduction the IC view already does (`userIcInternalsView.ts` "the fit", a single
  `partLayer.scale.set(s)` over the whole inner graph drawn at world scale). **No** rounding-then-
  de-collide of individual pins (that was the relayout hiccup the owner flagged — explicitly
  banned).
- **Grid floor instead of de-collide.** Snap the scaled pins to integer cells for wiring; if any
  two would collide (or fall < 1 cell apart), the part simply scales LESS — raise `σ_eff` to the
  smallest uniform factor that keeps all pins on distinct grid cells: `σ_eff = max(σ(tier),
  σ_minDistinct)`. Still one uniform factor, so it stays a true replica — just not smaller than the
  pinout physically allows. A CPU's EXTERNAL pin count (its bus/control interface) is modest, so
  `σ_minDistinct` is small and the body shrinks a lot; a pad-limited part bottoms out at its pin
  perimeter (the realism seat's honesty note: the zoom-meter process-node reading is then
  approximate and must say so).
- **Short lead-stubs bridge to the grid.** Where a scaled pin sits sub-cell, a short lead-stub
  joins it to its snapped grid cell — exactly a real package's leads — so wiring lands on clean
  integer cells. The wireable `PartKind.pins` ARE those snapped cells (they DO move with `σ_eff`,
  which is the point); **connectivity is by pin INDEX**, so incident wires follow on every re-bin
  (re-routed live, §4.2) and the netlist/flatten never change (§6.4).

This is the concrete form of the §2.2 dial: `σ_eff = max(σ(tier), σ_minDistinct)`, applied as one
uniform transform to the whole replica.

## 6. Composition with zoom-to-open + determinism

### 6.1 Reuse the recursive LoD mechanism unchanged

The dive path is `drawUserIcInternals` (`userIcInternalsView.ts:193`), triggered when an
instance's on-screen scale crosses `INTERNALS_ZOOM = 2.5` (`board.ts:176`, gated at
`board.ts:7470`), with each opened level shrunk by its fit-scale `s`
(`userIcInternalsView.ts:289`) and recursing at `:644`. Mechanism is reused **verbatim**;
we make it **tier-aware** in two ways.

### 6.2 Tier-aware open trigger + auto-zoom

- **(a) Open on ON-SCREEN footprint size, not camera scale alone.** A tiny ULSI shell must
  open at the same apparent size as an MSI one. The recurse test already uses absolute
  on-screen scale (`absScale = s · cumulativeScale · cameraZoom ≥ internalsZoom`,
  `userIcInternalsView.ts:584, :617–620`); the top-level trigger (`board.ts:7470`) should
  likewise gate on the instance's on-screen body size (which now includes `σ`), so a tiny
  part is one tap from full view.
- **(b) Auto-zoom by ~1/σ on open** so internals fill the viewport at one consistent
  comfortable working size at every depth — the accessibility seat's "the camera does the
  work, not the player's eyes." The player never manually pinches to a punishing zoom;
  drill-OUT is as one-tap as drill-in.

### 6.3 Camera budget

Because the per-tier step is ~1.5–2× (not decades), a realistic 4–6 level CPU dive stays
well inside `MAX_SCALE = 1000` (`board.ts:200`) — the headroom is **for** this, as the
comment at `board.ts:194–199` anticipates. The continuous-within-band growth is clamped
(§2.2) so a denser-than-expected block can't blow the per-level budget.

### 6.4 Determinism / golden safety (golden rule #2)

- `σ` and `deviceCount` are **pure front-end PixiJS display transforms** in `board.ts` /
  `userIcInternalsView.ts`. They are derived from `countDevices` — already a never-hashed JS
  label (`userIc.ts:1101`, documented "never crosses the wasm boundary" at `:1116`).
- `σ` **never** enters `snapshot_hash`, **never** crosses the wasm boundary, and **never**
  feeds back into any layout the sim reads. The flattened netlist (`flattenUserIcs`,
  `userIc.ts:834`) is unchanged — a strict no-op when no user IC is placed, so the golden
  stays byte-identical.
- **Data-model home:** add an optional `UserIc.process?: { sigma: number }` (default `1.0`)
  beside the existing render-only fields like `pinNames`/`pinRoles` (`userIc.ts:43–94`).
  Default ⇒ every existing seal/save/golden is byte-identical (the `pinNames` precedent).
- **Memoize** `σ` (and the device count) **per `UserIc` def**, recomputing only on
  reseal/def-change — `countDevices` over a wide CPU is O(expansion); the existing path-set
  cycle guard (`userIc.ts:1102`) stays. Invalidate exactly when `getUserIc(tag)` returns a
  new object (the same `def !== this.staticUserIcDef` reference-compare the static fallback
  already uses, `board.ts:7480`).

## 7. Accessibility — readable & grabbable at every scale

### 7.1 Hard interaction floor, decoupled from visual scale

`σ` controls the **resting visual** and the zoom-to-open trigger, **never** legibility-at-
rest or grabbability. Selection / hit-test / pin-bloom / badge / inspector operate on a
**logical** part with a minimum on-screen target **≥ 44px diameter** regardless of `σ`,
reusing the existing `BEAD_HIT_PX = 22` (= 44px) pattern (`board.ts:163`, applied as
`BEAD_HIT_PX / s` at `:3670`, `:3687`). A ULSI tile can be a 0.15 speck visually but always
carries a ≥44px invisible tap zone and an always-legible text badge. This is a real clamp in
the render/hit path, not a heuristic. Reconcile up from `accessibility-and-reach.md §6`
(24px) exactly as the Chip-Bench brief does (`device-editing-all-ages-panel.md §8.1`).

### 7.2 Tier taught by three redundant, non-colour-alone channels

1. **Text badge** SSI/MSI/LSI/VLSI/ULSI — the primary, scale-invariant channel (the same
   `IntegrationTier` string already used in the bin). For pre-readers, a row of **1–5 filled
   dots** carries the meaning word-free; the acronym appears on long-press/hover.
2. **Die-rim fill-density / stipple** that visibly thickens up the ladder (SSI = a few gates
   showing through, ULSI = a dense uniform fab texture — *"you can no longer see individual
   gates" IS what V/ULSI means*). Reinforcement only; tuned to avoid moiré at small sizes
   and kept distinct from the faint-grid motif and the FAIL box.
3. **Live device-count telemetry** (IBM Plex Mono) on hover — the number the teen creators
   want.

### 7.3 Navigation & orientation

- A **breadcrumb tier-ladder** (`CPU › ALU › MUX › T-GATE`, or for pre-readers a trail of
  shrinking boxes biggest-to-smallest) is persistent during a dive; tap any crumb to pop
  back out. Nobody can get lost.
- The existing **zoom/scale-reference meter** (`getViewMetrics` → `lib/zoomMeter.ts`,
  `board.ts:2499–2505`, fed by the `viewProbe` at `userIcInternalsView.ts:118, :303–332`)
  labels the current tier and process node; its metric unit (2.5mm → µm → nm) **is** the
  honest process-node lesson for older players.

## 8. Honesty guardrail (the teach-HONESTLY mandate)

The perceptual `σ` deliberately compresses the real ~10⁶:1 ratio to ~6.7:1, so the truth
MUST live in the **labels**, never implied by pixels. Surface **both** the game-scaled band
AND the real textbook decade everywhere the tier is taught:

- An **era card on hover**: badge + real device-count band + representative part/year
  (*"LSI ~1971, Intel 4004 ~3500 transistors; game LSI 100–1000"*).
- A live **5-segment integration meter** in the seal panel, annotated with both the game
  band (`userIc.ts:1122–1126`) and the real decade.
- Help copy states it explicitly: **"we shrink the TILE, not the transistors."**

The density-as-heat channel (the "hotter = more" pre-attentive language in
`docs/ui/visual-language.md` / `board.ts:voltageColor`) is a natural future reinforcement
(a dense die runs hot) but is **deferred** (§11).

## 9. Determinism boundary recap (the one diagram to remember)

```
countDevices ─► σ(tier) ─► PixiJS body scale  (render only, memoized on UserIc def)
     │                                          never hashed, never crosses wasm
     └─► integrationTier ─► badge + dots + stipple
flattenUserIcs ─► discrete netlist ─► snapshot_hash   (UNCHANGED, byte-identical)
```

## 10. Phased build plan

- **Phase 0 — `σ` model + plumbing (no visible change yet).** Add `UserIc.process.sigma`
  (default 1.0, `userIc.ts:43`); add a memoized `tierSigma(def)` next to `integrationTier`
  (`userIc.ts:1120`), keyed on the def reference (invalidate on reseal). Add a `tierSigma`
  unit test in `web/src/lib/netlist.test.ts`-style headless suite asserting the band→σ map
  and that `σ` never appears in any serialized/hashed path. **Gate: golden + `cargo test -p
  sim-core` green; flattened netlist byte-identical.**
- **Phase 1 — Compact resting footprint (the on-bench identity).** Apply `body = max(content
  × σ, pin-perimeter)` to the drawn package body in the placed-glyph path, keeping
  `PartKind` pins on the grid (§5). Add the three teaching channels (§7.2). Add the ≥44px
  hit-floor clamp reusing `BEAD_HIT_PX` (`board.ts:163`). **Validate** that wires stay
  attached across a `σ` change and that a 0.15 ULSI tile is selectable.
- **Phase 2 — Compaction & promotion events.** Die-shrink at seal/reseal (`userIc.ts:547`);
  announced promotion + live wire re-route + hysteresis at band crossings (§4); reduced-
  motion static swaps.
- **Phase 3 — Tier-aware dive.** Make the open trigger gate on on-screen footprint size
  (`board.ts:7470`) and auto-zoom by ~1/σ on open (§6.2); breadcrumb tier-ladder; wire the
  tier/process-node label into the existing zoom meter (`board.ts:2499`, `zoomMeter.ts`).
- **Phase 4 — Honesty surfaces.** Era card on hover + dual-band integration meter in the
  seal panel + explicit "we shrink the tile, not the transistors" help copy (§8).
- **Phase 5 (optional, classroom) — "to-scale" toggle.** A one-button demo applying near-
  real `σ` decades ("see why VLSI is a miracle"), making the default compression explicit
  and consensual. Plus the accessibility "Flatten view" toggle (suspend `σ`-shrink, drill at
  one comfortable size) — needs its own spec (§12).

## 11. Open questions

1. **Density-as-cost (heat/money)** is explicitly **deferred** by the owner ("designed-
   around, not built"). It would ride the Real-mode `RATED_CURRENT_SLOT` FAIL contract but
   collides with the sub-tick rate slot (`BEH_SUBTICK_RATE_SLOT == slot 2`); wiring heat-on-
   dense-fabric is gated behind moving the sub-tick rate off slot 2. Out of scope here;
   flagged so the `σ` model and a future density-cost model stay one design.
2. **Within-band `√(content)` clamp windows** per tier need a tuning pass against real built
   chains (transmission-gate → mux → ALU → CPU) to confirm a 4–6 level dive lands cleanly
   inside `MAX_SCALE = 1000` and that within-band growth never visually collides with the
   neighbouring tier's size.
3. **Pin-perimeter floor formula** for pad-limited cells (wide bus, small die) needs the
   exact `max(content × σ, pin-perimeter)` rule plus an honesty note in the zoom meter.
4. **"Flatten view" / uniform-scale accessibility toggle** is endorsed in principle; its
   interaction with the breadcrumb and the auto-zoom-to-open needs a dedicated spec.
5. **Stipple/fill-density texture tuning** to avoid moiré at small sizes and confusion with
   the faint-grid motif and FAIL box — reinforcement only (text badge primary), but the
   exact per-tier texture needs a visual pass.

---

## Appendix — panel digest (each seat's north star + standout ideas)

- **Ages 5–8 (pre/early readers):** *a chip is a magic box — the more clever stuff packed
  in, the teenier the box, and you can always dive in to see the swarm.* → five fixed toy
  sizes (nesting-doll staircase), not a formula · **size-dot language** (1–5 dots) for pre-
  readers · zoom-to-open as a literal "fall into the box" dive · breadcrumb of shrinking
  boxes · seal = an animated "suck into a little box" event · nesting compounds by display
  only, never multiplied (5 × 0.4 → vanish). *Concern: hard min hit-area so a 0.15 ULSI box
  is still pokeable.*
- **Ages 9–13 (tween):** *every nest visibly SHRINKS and earns a tier rank — compaction is
  the reward and the lesson.* → continuous log scale + discrete tier badge · tier as a
  level-up ("Promoted to LSI — 312 devices!") · density-up as size-down (packed die look) ·
  tier passport / collection screen · continuous zoom-dive with a breadcrumb · min-scale
  floor + hover-magnify. *Concern: pins stay on the grid; threshold-snap must animate as a
  promotion, not a bug.*
- **Ages 14–22 (teen power-creators):** *footprint should encode the tier the way a package
  hides a die — learn the ladder by feeling density, not reading a table.* → continuous
  `1/(1+k·log10(n))` scale + discrete badge · footprint per-INSTANCE from its OWN expansion,
  applied once, NOT re-multiplied · triad cue (badge + edge material + live count) · "Shell
  density" inspector field bounded within the tier's window · seal-time teaching beat · tier-
  aware open trigger (gate on on-screen size). *Concern: double-shrink — keep footprint and
  zoom orthogonal; determinism — `σ` must stay a derived render label.*
- **Adult casual / parents:** *a placed part should take screen space proportional to how
  much I need to reason about it — my CPU stays a thing I can see whole.* → fixed per-tier
  footprint (tidy shelf, predictable) · honest-but-legible ~5× total ratio with real numbers
  on the label · calm neutral tier badge · nesting does NOT compound · zoom-to-open sets the
  open threshold · onboarding "integration shelf" reference. *Concern: pins stay full grid
  pitch (only the body compacts); reclassification must animate, never silently reflow; never
  imply pixels == transistors.*
- **Older adults / accessibility:** *no part may ever be smaller than a finger-sized, high-
  contrast, focusable target — tier sets how COMPACT a part portrays, never how hard it is to
  see/select/edit; the camera does the work.* → discrete five-tier `σ` (reverse-readable) ·
  HARD ≥44px on-screen floor overriding `σ` at rest (reuse `BEAD_HIT_PX`) · three redundant
  non-colour channels (text badge + stipple + outline) · auto-zoom by ~1/σ on open · select/
  edit fully decoupled from scale · "Flatten view" uniform-scale toggle. *Concern: the 44px
  floor must be a real clamp; deep `∏σ` dives must always auto-frame and offer one-tap drill-
  out.*
- **Learning-science:** *feel the ladder before you can name it — every drill-in is a
  repeatable "shrink event."* → two-part signal: `√(content)` WITHIN a band (area tracks
  count) + discrete `σ` jump ACROSS bands (denser process node) · narrated band-crossing
  event · tier-colour ramp reused as the bin badge · live integration meter showing BOTH game
  and real bands · `cumulativeScale = ∏ s` carries depth · optional "to-scale vs legible"
  classroom toggle. *Concern: footprint must track COUNT not extent (integration, not
  floorplanning); surface the REAL decades or teach a comfortable lie.*
- **Electronics-realism:** *a part shrinks because integration packed MORE into the same die
  area — map the true SSI→ULSI decades to a PERCEPTUAL (log) shrink, never the literal 10⁶
  lie.* → continuous log `σ` over real device count, bands as colour zones · anchor `σ` to
  real history (4 gates → 75 → 3500 → 275k → >1M) · render as die-vs-package (tiny shell,
  huge die on open) · era card with year/representative part · scale-ruler tie-in to the zoom
  meter (the metric unit IS the process node) · memoize `σ` (countDevices is O(expansion)).
  *Concern: camera budget — tune `σ` so a 4–6 level dive stays inside `MAX_SCALE`; honesty
  lives in the labels; pin-perimeter floor softens the meter for pad-limited parts.*

## Appendix — director synthesis (the resolved design)

- **Two orthogonal scale systems, never multiplied** (§1): FOOTPRINT (`σ`, identity, applied
  once, re-bases per level) vs DRILL (`cumulativeScale = ∏ s`, navigation, compounds on
  zoom). This single decision dissolves the "double-shrink" fear.
- **Footprint formula** (§2.2): `clamp_to_band(contentExtent(deviceCount), tier) × σ(tier)` —
  continuous-within-a-tier (`√n`), discrete-step-across-tiers (`σ`). Reconciles the
  continuous and discrete camps instead of picking one; the badge IS the `σ` selector so size
  and badge always agree.
- **Tier ladder & perceptual `σ`** (§2): the five real bands verbatim (the existing
  `integrationTier`, `userIc.ts:1120`) → `σ = {1.0, 0.6, 0.4, 0.25, 0.15}`, ~6.7× total,
  ULSI floored at 0.15.
- **Hard interaction floor** (§7.1): ≥44px on-screen target regardless of `σ`, reusing
  `BEAD_HIT_PX` (`board.ts:163`). `σ` governs resting visual + open trigger, never
  grabbability.
- **Pins on the grid, body compacts** (§5): `max(content × σ, pin-perimeter)`; logical
  `PartKind` pins unchanged so wires never break.
- **Determinism boundary** (§6.4, §9): `σ` derived from the never-hashed `countDevices`, home
  `UserIc.process.sigma` (default 1.0 ⇒ byte-identical), memoized per def, never in
  `snapshot_hash`, never crosses wasm; `flattenUserIcs` unchanged.
- **Compaction is an event** (§4): die-shrink at seal, announced promotion + live wire re-
  route + hysteresis at band crossings.
- **Zoom-to-open composes & stays constant-effort** (§6): reuse the recursive LoD verbatim,
  make it tier-aware (open on on-screen size; auto-zoom ~1/σ); the ~1.5–2×/tier step keeps a
  4–6 level dive inside `MAX_SCALE = 1000`.
- **Navigation + orientation** (§7.3): breadcrumb tier-ladder; the existing zoom meter labels
  the tier + process node.
- **Tier taught by redundant, non-colour-alone channels** (§7.2): text badge (primary, +
  dots for pre-readers), die-rim stipple density, live count telemetry.
- **Honesty guardrail** (§8): both the game band and the real decade in the era card +
  integration meter; explicit "we shrink the tile, not the transistors."

The deliverable is the markdown above; suggested home `docs/ui/integration-tier-subassembly-scaling.md`.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Analogy Pipe-View Legibility — Dense-Area Readability Review

**Scope:** the ANALOGY lens conduit/flow render only (`web/src/lib/board.ts`, plus `analogyDrawers.ts` glyphs). **Determinism:** every lever below is alpha/width/geometry/cull on the render side — none touch `crates/`, the netlist, the sub-frame batch, or `snapshot_hash`. **All proposals are presentation-only and golden-safe.** Three independent design lenses (additive-haze/opacity, density-LOD/focus, clean-topology) were reconciled; where they disagree it is noted inline.

---

## 1. Diagnosis — why dense areas haze (ranked, concrete)

The single root cause all three lenses converge on: **everything paints into one flat translucent `Graphics`** (`this.wireLayer`, declared `board.ts:457`, fetched as `g` at `:4559`, cleared once at `:4560`) in arbitrary `wires.values()` order (`:4685`), with PixiJS **default `'normal'` blend** and **no opaque primitive anywhere**. Compositing is source-over (`out = src·a + dst·(1−a)`), so overlapping translucent layers don't *occlude*, they *sum*. With ~8–12 translucent passes per route, all tinted toward the same `PIPE_WATER 0x8fd6ff` cyan or `PIPE_WALL`, a cluster's residual `(1−a)` products multiply down toward opaque pale-cyan and the dark grid gaps the eye uses to separate pipes fill in. The bloom is stacked alpha, not GPU-additive — but the visual result is the same.

Ranked sources:

1. **No opaque element → crossings sum instead of occlude.** The conduit core (`drawConduitSkin`, core stroke `:5505–5511`, `coreAlpha = 0.26` at `:5495`) is translucent by deliberate design (the dark "bore" was removed — see the in-code note `:5497–5501`). Where pipe B crosses pipe A, two 0.26 cores composite to ~0.45 — a *brighter knot*, not a clean over/under. This is the structural reason two pipes never read as two.

2. **Carrier water blobs are the dominant cluster-bloom primitive** (`:4810–4814`). Up to `MAX_BELT_DOTS = 64` per route, radius `2 + 1.6·normC`, `PIPE_WATER`, alpha `(0.45 + 0.4·normC)·fade` ≈ 0.45–0.85 — the most numerous, brightest, most-saturated layer, and densest *exactly where current is high* (where clusters form). Two crossing belts composite to ≈0.7–0.97 effective cyan.

3. **Parallel lanes are narrower than the pipes.** `nudgeParallel` fans co-channel routes only `NUDGE_SPACING = 9` px apart (`:7080`), but the wall rim is `pw+3` = up to 12 px wide (`:5503`). 9 px gap < 12 px body → "separated" lanes overlap their own wall rims and re-haze. Worse, the fan **skips the end legs** (`:7103`), so parallel buses fully re-converge at the part-pin clusters the owner flagged.

4. **Crossing machinery exists but is geometry-only.** `applyCrossings` (`:7206`) splices a 3-point up-bump (`BUMP_W=8`/`BUMP_H=11`, `:7261–7263`) into the horizontal wire so it arcs over the vertical — but draws **no knockout gap** under the bump, so the translucent apex still alpha-blends over the under-pipe (a brighter lump, not a bridge). It also has a **3 px dead-zone at both segment ends** (`:7234–7237`): crossings *right at junctions/pins/corners* — the densest spots — get neither a dot nor a hop and just blend. And the "over" choice is `horizontal-always-wins` (`:7242`), so a cluster's over/under is axis-arbitrary and inconsistent.

5. **Junction hubs are dimmer than the bloom they sit in.** `drawJunctionConduit` (`:5612`) hub core is `coreAlpha·0.5 ≈ 0.14` (`:5650–5651`) — fainter than the ~0.45 pipe pileup at a 3–4-way convergence. The tie node *sinks into* the haze instead of capping it. (The opaque same-net cross-dot recipe at `:4884–4886`, `0x0d0b16` backing + colour disc, already reads cleanly — proof that opacity works here.)

6. **Gauge chrome is now constant and maximal per net.** `drawNetStandpipes` (`:5262–5429`) recently went to **fixed-full-height housing** (`:5332–5340`): the glass outline (`SP_WALL_ALPHA 0.55`), ground line (`SP_GROUND_ALPHA 0.8`), and half-tick now draw at the full 36 px reach for *every* net including empty ground — large near-opaque `PIPE_WATER` slabs stacked on top of the pipe cluster. `netGaugeAnchors` has **no cull path** (`:5045`): it force-places at the least-bad spot even when no clear box exists, so in dense regions gauges are *forced* onto pipes. The taller `reach = H` collision box (`:5267`) makes placement harder → more fallbacks land in the worst zones.

7. **Shimmer triple-stroke** (`:5843–5845`, fast-AC only) — a ~40 px near-white aura+glow+hot-core. Dormant on DC, but the single most aggressive bloom source where it fires; dominates any dense AC region.

8. **Energy dots** (`:4873–4876`, warm `ENERGY_COLOR`, alpha ~0.5–0.9) — a second uncorrelated translucent fill; doesn't feed the cyan bloom but muddies it to dirty tan on overlap.

9. **Port-mouth flares** (`:5516–5560`) and **per-pin device stubs** (`connectorGlyph`, `:6734–6760`, wall+core *per pin* under every multi-pin part) — lower-alpha haze contributors, but they stack densest exactly where routes meet parts (MOSFET/BJT/op-amp = 3+ pins fanning to a centre = the densest ghost clusters in the screenshot).

> **Note on prior work:** HANDOFFS (103) already trimmed the junction/stub/body alphas once (junction `pw` 6→5, body wall 0.3→0.24, core 0.32→0.26, stub alphas cut). Further *alpha-cutting* on those layers has diminishing returns — the lenses agree the next gains come from **introducing opacity/contrast and from conditional strength**, not from thinning translucent layers further.

---

## 2. Quick wins (ship now)

Deduped across lenses, impact-ordered. All golden-safe.

| # | Change | Location | Effect | Risk | Effort |
|---|---|---|---|---|---|
| **QW1** | **Opaque conduit core.** Raise the `pw−1` core stroke to alpha ~1.0 in analogy (and darken the rail hue ~15% for the core so the translucent `pw+3` wall reads as a rim). A later-drawn pipe's opaque core then **knocks out** the earlier pipe at every crossing. | `drawConduitSkin`, `coreAlpha` `:5495`, core stroke `:5505–5511` | Two crossing pipes read as two with a clean over/under instead of summing to a brighter blob. The single highest-leverage "two pipes read as two" change. | med | S |
| **QW2** | **Dark moat under each pipe.** Before the wall rim, stroke a near-opaque dark casing slightly wider than the wall: `polyline(g,rp); g.stroke({width: pw+5, color: 0x0d0b16, alpha: 0.9})`. Each later route lays a dark trench that knocks back the previous pipe's halo, restoring inter-pipe grid darkness. | `drawConduitSkin`, new stroke before `:5502` | Re-creates the dark gap the eye uses to separate lanes, at every overlap. Pair with QW1 for full effect. | med | S |
| **QW3** | **Cut carrier-blob alpha + saturation.** `:4813` `(0.45 + 0.4·normC)·fade` → `(0.28 + 0.3·normC)·fade`; shrink radius `:4811` `2 + 1.6·normC` → `1.6 + 1.2·normC`; tint toward rail hue `mix(PIPE_WATER, color, 0.4)` so different nets' blobs don't all pile into the same cyan. | carrier block `:4810–4814` | De-hazes crossings/clusters at the #2 source. Density still encodes current (magnitude channel preserved); blobs sit on the now-opaque core so they survive at lower alpha. | low | S |
| **QW4** | **Widen parallel lanes past pipe width.** `NUDGE_SPACING` 9 → 13–14, so lanes clear the `pw+3` (≤12 px) wall + the new moat and leave a visible dark grid sliver. | `:7080` | Fanned parallel runs actually separate; one-constant edit. | low | S |
| **QW5** | **Opaque junction hub.** Replace the faint hub with the proven cross-dot recipe: dark backing disc `r=pw/2+2.5 @ 0x0d0b16 α0.85` then colour disc `r=pw/2+0.5 @ α~0.95`. The backing knocks out the pipe bloom directly under the node. | `drawJunctionConduit` hub fills `:5650–5651` | Every tie node reads as a crisp discrete dot above the haze instead of a dim spot in it. | low | S |
| **QW6** | **Shrink crossing dead-zone.** The 3 px end-margins → 1 px, so near-junction/near-corner crossings get resolved (dot or hop) instead of silently blending. 1 px still skips genuine shared endpoints (<0.5 px). | `applyCrossings` `:7234–7237` | Resolves the "near junctions and parts" crossings the owner specifically flagged. | low | S |
| **QW7** | **Knockout gap under the bridge hop.** Have the different-net branch collect crossing points (mirroring `conduitCrossDots`); draw a short dark stub (`~pw+6` wide, `~10` px, perpendicular, `0x0d0b16 α0.9`) over the *under* (vertical) pipe at each crossing, before the over-pipe's core. | `applyCrossings` hop splice `:7261–7263`; knockout pass before the skin loop `~:4684` | Turns the existing geometric hop into a true visual overpass — a clean break, not an extra translucent lump. The hop machinery is currently wasted without this. | med | M |
| **QW8** | **Tame the shimmer band.** Aura multiplier `3·half` → `~1.8·half`; clamp `half`'s max (e.g. cap at 16 px); scale the three alphas down ~0.6×. | shimmer `:5830` (`half`), `:5843–5845` | Kills the worst AC-cluster bloom while keeping the "live band" cue. | low | S |
| **QW9** | **Gauge chrome cull on empty/ground nets.** Skip the housing outline / ground line / half-tick on a near-empty or pure-ground net (wrap `:5397–5422` in an emptiness/zoom guard). Keep water level + surface band + number (the encoding). | `drawNetStandpipes` `:5397–5422` | Removes the newly-added constant chrome mass (#6) without touching the voltage encoding. | low | M |
| **QW10** | **Quiet multi-pin device stubs.** Drop the redundant `pw+3` wall stroke; keep only the core, bump its alpha 0.13 → 0.16 so the single stroke still reads. The illustration sits on top anyway. | `connectorGlyph` `:6751–6758` | Thins the densest ghost clusters (MOSFET/BJT/op-amp pin fans). | low | S |

**Reconciliation note (lens disagreement):** the opacity lens wants the conduit core **fully opaque** (QW1) for clean occlusion; the LOD/focus lens cautions that a hard opaque core/casing reintroduces the "dark-bore" look the team *deliberately removed* (`:5497–5501`) and would prefer to scope opacity to a focused net. **Resolution:** ship QW1+QW2 globally but conservatively (opaque core, but the *moat* near-opaque at α0.9 not 1.0, and the wall rim left translucent as the soft halo) — this gets clean crossings without the old muddy bore, since the bore was a *full-width dark fill under the core*, whereas the moat is a thin trench *outside* it. If it reads too "engineered," fall back to scoping opacity to the focused net (Structural S2).

---

## 3. Structural options (owner decides)

| Option | What it buys | Tradeoff | Effort |
|---|---|---|---|
| **S1 — Two-pass "casing then cores."** Pass 1 strokes every pipe's dark moat into `g`; pass 2 strokes every opaque core; carriers/energy/gauges after. Every core then sits in a uniformly dark trench regardless of route order. | The most robust "two pipes read as two": separation guaranteed independent of draw order, not dependent on the grid showing through. | Restructures `redrawWires` (`:4558–4904`) into accumulate-then-draw loops; port flares/junction nubs must join the casing pass. Visible art-direction shift (crisper, more "engineered" look) — owner sign-off. | L |
| **S2 — Hover/selection FOCUS dim.** Reuse the already-built `nets` (wire→node) map (`:4582/4627`), `this.selected*`, and `this.conduitDrawRoutes` (`:4749`). Focused net renders full-strength; every other net drops to a low-alpha context wash (`FOCUS_DIM ~0.35`). Selection-driven first (cheap, no input plumbing), then hover-resolver as the real fix. | Turns a dense cluster into an on-demand x-ray — legibility by **attention** not brightness. The truest answer to "hard to read when lots of things are close together." | Hover needs a per-pointermove hit-test + debounced redraw (and must not thrash the armed-part ghost). Selection version is the cheap stepping-stone. | M (select) / L (hover) |
| **S3 — Zoom-band LOD.** Single `lod = saturate((world.scale.x − TIER_ZOOM)/(LOD_FULL_ZOOM − TIER_ZOOM))` computed once at `~:4570`; multiply carrier alpha (`:4813`), energy alpha+gate (`:4864/4875`), carrier spacing (`:4787`), and shimmer (`:5843–5845`) by it. Near `TIER_ZOOM` (smallest pipe pitch, worst bloom) the most numerous primitives fade; at full zoom unchanged. | Attacks the #2/#8 sources precisely in the zoom band where pixels-per-pipe is smallest, with **zero** change to the encoding at working zoom. | Global LOD also thins a lone readable pipe when zoomed out; a *local-density* LOD (spatial bucket pass) targets only crowded cells but adds a hot-loop pass + popping/hysteresis concerns. | M (global) / L (local) |
| **S4 — Per-net z-separation.** Hash net-id into 3–4 sub-`Graphics` added in z-order; an opaque core in a higher layer fully covers a lower one → true over/under everywhere (parallel, crossing, cluster), and same-net pipes batch together. | True GPU occlusion without hand-detecting every overlap; makes S2's focus crisp at crossings. | More Graphics = more draw calls / less Pixi batching (perf on dense boards); needs a *stable* net→layer hash so over/under doesn't flicker; carriers/energy/gauges must slot into the right layer. Real `redrawWires` refactor. | L |
| **S5 — Filter-based single halo.** Replace the per-route 3–8 stacked translucent strokes (shimmer aura/glow/core, port flares, wall+core) with one soft outer stroke + a single Pixi `BlurFilter`/`AdvancedBloomFilter` on a dedicated highlight sublayer. | One bounded halo can't additively sum with itself; uniform glow. | Filter GPU cost + Pixi edge/padding/quality caveats; must exclude the opaque cores from the filter target; changes the energised-wire look. | L |

**Reconciliation note:** S1 (opacity-lens) and S4 (also opacity-lens) and S2 (LOD-lens) are not mutually exclusive — S1/S4 fix *static* separation, S2/S3 fix *attention/density*. The topology lens's vertical-hop variant and net-priority "over" rule (a refinement of QW7) fold into S4's z-order naturally and need not ship standalone.

---

## 4. Recommendation

**Ship immediately (one coherent "clean conduits" PR):**

The minimal trio that fixes the owner's complaint at the root — *no opacity, no dark gaps, faint junctions* — rather than nibbling alphas further:

- **QW1 opaque core + QW2 dark moat + QW5 opaque junction hub.** This is the structural win: a later pipe's opaque core now *occludes* the earlier one, the moat restores inter-pipe darkness, and the hub asserts over the convergence. All in `drawConduitSkin`/`drawJunctionConduit`.
- **QW6 dead-zone 3→1 px + QW7 hop knockout gap** — turns the existing-but-wasted crossing machinery into real overpasses and catches the near-junction crossings.
- **QW4 `NUDGE_SPACING` 9→13** so parallel lanes clear the body.

Bundle the cheap dimming polish in the same PR: **QW3 (carrier alpha/sat), QW8 (shimmer), QW9 (gauge chrome cull), QW10 (device stubs).**

All ten are render-side on Point copies / alpha / width / cull — **golden-safe; `cargo test -p sim-core` and the snapshot hash are untouched.** Run the standard web gates (`pnpm -C web format/lint/build/test`).

**Defer (owner sign-off):** S2 hover-FOCUS is the highest-value *next* move and the truest fix for "lots of things close together," but it's a UX decision (hover vs click trigger) and needs the resolver — validate the dim aesthetic with the cheap selection-driven version first. S1/S4 (guaranteed order-independent separation) only matters if QW1+QW2 prove insufficient on the very densest boards. S3 global LOD is a good low-risk follow-up but partly redundant once QW1/QW2 land. S5 is art-direction, not needed for legibility.

**Does this need a dedicated brainstorm/design pass?** **No — the quick-win bundle plus one structural follow-up (S2 FOCUS) suffices.** The diagnosis is unambiguous and the three lenses agree on the mechanism (stacked source-over alpha, no opacity, no occlusion). The only genuine open *taste* question is the QW1/QW2 "crisper, more engineered" look vs. the current soft wash — that's a single A/B screenshot for the owner against the same dense board, not a design pass. If the owner dislikes the crisp global look, the fallback (scope opacity to the focused net via S2) is already on the table. Recommend: ship the bundle behind one before/after screenshot, get the owner's read on the crispness, then green-light S2.
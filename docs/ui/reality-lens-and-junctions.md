<!-- SPDX-License-Identifier: Apache-2.0 -->

# Reality lens & junctions — design spec (render-only)

**Status:** spec (2026-06-24), from a 3-panel brainstorm. Owner-directed: make the **Reality** lens read as
*real electronics* (copper traces, solder, vias, pads, leads), clearly **distinct** from the **Analogy**
water-plumbing metaphor, at **every tube, contact, and junction** — and design better **junction** forms.

This is a **render-only** feature: it draws over the already-solved snapshot and touches no `sim-core` /
`sim-protocol` / `sim-wasm`, no `buildNetlist` / `Element::params`, and nothing across the `loop.ts` wasm
boundary. The golden hash `0xeaac_3764_99e4_fa24` does not move. It applies to the die editor **and** the
sealed-IC opened replica for free, because both run the shared `this`-free render core (`boardRender.ts`).

Refs: `docs/ui/visual-language.md` (power-bus language), `CLAUDE.md` "Design system" / "power-bus visual
language", `docs/determinism.md`.

## 1. The thesis (one rule that drives everything)

> **Analogy is a closed _volume_ carrying water** — round, walled, wet, a bright bore, couplings/confluences
> where parts join.
> **Reality is a flat _deposit_ on a board** — rectangular copper on soldermask, a matte rim + a single
> specular edge, and **solder wherever metal physically joins metal** (fillets at contacts, domes at
> junctions), with **vias** where a net changes layer (a thing plumbing cannot express).

Round-vs-flat, wet-vs-metallic, continuous-medium-vs-discrete-soldered-joints. If every element obeys that,
the lens reads as one PCB world rather than "the analogy pipe, recoloured copper" (which is the state today —
the two lenses share `drawConduitSkin` and differ only by a few colours + a faint centred sheen).

**Shared truths preserved in both lenses** (vary the _material/geometry_, never these): the electron-drift
carriers (same path + direction), the `voltageColor` rail-identity on the opaque core, the opaque core for
clean over/under occlusion, and the magnitude channel (reality = the LED bar `drawNetBars`; analogy = the
water standpipe). Magnitude rides thickness/density/number, never speed.

## 2. Lens model (where the art lives)

- `BoardLens = "schematic" | "analogy" | "reality"` (`boardRender.ts`).
- The `conduit` lens value is non-null **only** when `effLens !== "schematic"` and the camera is zoomed past
  `TIER_ZOOM` (`board.ts` `redrawWires`). **All lens art lives inside that guard**; `schematic` is the
  untouched `conduit === null` baseline and must never change.
- The shared core (`boardRender.ts`, header: "render-only; nothing here is hashed") is re-run verbatim by the
  replica (`userIcInternalsView.ts`) — so any reality variant added in the core lands in both views.

## 3. The shared Reality material kit (define once, used by every element)

The new reality "paints" — each replaces an analogy twin (in parens). Most are a stroke-cap change or one
extra pass over the **existing** layered-stroke / concentric-disc machinery, not new geometry.

| Paint | What it is | Replaces (analogy) | Cost |
| --- | --- | --- | --- |
| **Soldermask rim** | a thin dark near-black-green stroke just *outside* the copper, asymmetric (mask over board) | the symmetric steel `PIPE_WALL` halo | colour-only |
| **Copper strap** | the opaque `voltageColor` core, but a **flat band with square caps**, not a round bore | the round `PIPE_WATER` bore | cap swap |
| **Edge specular** | a thin bright line riding **one edge** of the strap (flat etched copper catches a rim light), not a centred glint | the centred reality sheen / the whole-bore water shine | offset pass |
| **Solder** | a warm cool-grey metallic fill + a tight white speck, used ONLY where metal meets metal | water meeting water (a confluence / meniscus) | one disc/arc |
| **Via ring** | an annulus: dark barrel centre + bright plated rim — "this net goes to another layer" | the vertical standpipe / down-pipe | two circles |

Suggested tones (sit in the dark blue-violet world without fighting the rose accent): soldermask rim
`~0x10241c`; solder `~0xb8b4c0` with a white speck; copper keeps `COND_CASING` for the wall, `voltageColor`
for the core. Tune in implementation.

## 4. Junction forms (per lens)

A junction is `drawJunctionConduit` (`boardRender.ts`) — two concentric discs (dark collar + opaque
net-colour hub), drawn **last** (on top of the pipe ends). Today it takes **no `lens` param** — that is the
single gap blocking a distinct reality junction (§6).

| | Schematic | Analogy | Reality |
| --- | --- | --- | --- |
| **form** | the plain dot (baseline, unchanged) | **tap-count flanged manifold** — a tee (3-way) / cross (4-way) with bolted flange faces on each occupied cardinal | **raised solder dome** — the hub + an offset bright crescent + a white speck so it reads convex & shiny (a reflowed joint) |
| **multi-layer tie** | — | a confluence chamber (water pools) | optional **plated-through via ring** (dark barrel + bright annulus) |
| **teaches** | connectivity | KCL + the 3-way vs 4-way tap count | "soldered = one node"; vias = layer change |

**Rules for both lenses:**
- **2-way "junctions" draw nothing** — a degree-2 tie is a pure pass-through; skip the hub so it reads as
  continuous pipe/trace.
- **Small-scale fallback is mandatory** — below a few px (the sealed-IC replica crushes junctions), every
  form collapses to the plain two-disc hub. Gate the dome crescent / manifold flanges on `pw` or zoom.
- **Honour colour identity** — the node centre carries the net `voltageColor` (favours the dome over a
  dark-centred via for the default same-layer tie).
- **Reuse the disc/flange DNA** — the dome and the manifold flanges are the grommet/pin-flange disc stack
  re-centred, so a junction, a pin-coupling, and a pipe-end read as **one coupling grammar**.
- The analogy tap-count flanges derive each flange's angle from the **actual run vector** (the `nb − J`
  deltas already computed in the nudge follow-pass), not assumed N/E/S/W, so fanned/nudged runs stay seated.

**Top picks:** reality = the **solder dome** (cheapest, most authentic, degrades to today's hub); analogy =
the **tap-count manifold** (teaches degree, reuses the pin-flange bolt vocabulary). They stack (dome hub +
analogy flanges) without conflict.

## 5. Reality per-element spec

For each element: the reality look, how it differs from the analogy twin, and the cost lane.

1. **Trace / tube** — a flat copper strap: **square caps**, opaque `voltageColor` band, **soldermask rim**,
   **one-edge specular**. _Differs:_ round→flat, symmetric steel halo→asymmetric green rim, bright-bore→
   bright-edge. _Cost:_ **high-impact, low-cost** — pure restyle of the existing 4-stroke layering in
   `drawConduitSkin` (swap `cap:"round"→"square"`, recolour the wall stroke to the rim, offset the sheen to
   one edge). Re-skins the whole board at once. **Do this first.**
2. **Pin contact** — a **copper pad + solder fillet**: a rounded-rect copper pad oriented to the pin facing
   (`pinOutward`), with a warm-grey **solder fillet** bulging where the trace lands + a white specular speck.
   _Differs:_ the analogy's round seated flange-collar (a fitting) → a flat pad with an asymmetric solder
   joint. _Cost:_ medium — the `ends[ei]` pin-end branch in `drawConduitSkin` already special-cases this
   spot; replace its concentric discs (reality only) with pad + fillet + speck. **Second.** Solder fillet is
   the single most "real board" tell.
3. **Junction** — see §4: a **solder dome** (default), or a **via ring** for a layer-transition tie.
4. **Crossing (over/under)** — boards don't arc copper over copper. _First cut:_ re-skin the existing
   `applyCrossings` up-bump as a **0-Ω jumper** (a tiny body + a solder foot-pad each side). _Defer
   (higher fidelity):_ **via-down/via-up** — the hopped net drops to another layer between two via rings,
   dimmed in the gap, while the over-trace stays flat & continuous (the most PCB-authentic option; the
   `[hopper, hopped]` data already exists). _Analogy keeps the smooth over-arc._
5. **Component lead / pad** — bright **formed metal leads** (gull-wing / J-lead) landing on copper pads with
   solder fillets, vs the analogy's water-pipe stub into a factory machine. _Cost:_ medium-high — the
   on-board glyph leads are currently forced schematic, so the big win (pads + fillets) should come from the
   shared conduit-contact layer (element 2, free for every part); the **lead metal restyle** (bright vs
   violet stick) is later glyph-level polish.

## 6. Integration — the choke-points

Nine lens sites. Most of the reality system reuses what is already lens-aware.

| Site (`file:fn`) | lens today | reality variant | blast radius |
| --- | --- | --- | --- |
| `boardRender.ts:drawConduitSkin` body/sheen | split (colour + sheen) | square caps, rim, edge specular | low (one fn, both views) |
| `boardRender.ts:drawConduitSkin` `ends` flange | colour-only disc | pad + solder fillet | low (pin ends only) |
| **`boardRender.ts:drawJunctionConduit`** | **NO lens param — the gap** | dome / via | **low, but needs the param threaded** |
| `board.ts:drawNetBars` (reality gauge) | reality-only | keep | none |
| `board.ts:drawNetStandpipes` (analogy gauge) | analogy-only | keep | none |
| `applyCrossings` bump + tie dot | colour-only | jumper / via-down | medium (defer) |
| pin pads (`board.ts`) | part-colour disc | optional rect SMD pad | medium (defer) |

**The one real gap — thread `lens` into `drawJunctionConduit`:** add a `lens: BoardLens` param to the shared
fn and its two callers — `board.ts` `drawJunctions` (where `conduit` is already in scope) + its private
wrapper, and `userIcInternalsView.ts` (where `lens` is already destructured). **Mechanical, no new data**;
the replica inherits the reality junction the moment it lands.

## 7. First cut vs defer

**First cut** (high-impact, low-cost — reuse existing layering; both views; no new pass, no new data):
1. **Trace strap** — square caps + soldermask rim + one-edge specular (reality branch of `drawConduitSkin`).
2. **`lens` → `drawJunctionConduit`** + the **reality solder-dome** (offset crescent + speck over the hub).
3. **Pin-contact solder fillet** — reality branch of the `ends` pin-end cap (pad + fillet + speck).

**Defer** (new geometry / new signal / blocked):
- The **via ring** for layer-transition ties and the **via-down/up** crossing (needs a "this is a layer
  change" signal — can piggyback `applyCrossings`' overpass data).
- The **0-Ω jumper** crossing restyle (reuses the bump points; medium).
- **Rect SMD pads** and the **formed-metal lead** restyle (needs the on-board glyph to become lens-aware).
- **Analogy tap-count manifold flanges** (per-cardinal pads keyed off the nudge follow-pass arm counts).
- **Replica gauges + flow-dots** (task #16 — blocked on a per-inner-wire current the struct doesn't carry).

## 8. Determinism & validation

**Render-only proof:** these functions consume the already-read per-frame snapshot and emit Pixi draw calls
only — no `sim-core`/`sim-protocol`/`sim-wasm`, no `buildNetlist`/`Element` emission, no `loop.ts` boundary,
nothing in the netlist `sig`. The golden hash cannot move.

**Gate (CLAUDE.md "Verification gates"), plus:**
```
cargo test -p sim-core golden_snapshot_hash_is_stable   # 0xeaac_3764_99e4_fa24 unmoved
pnpm -C web test                                        # incl. boardRender.test.ts + netlist.test.ts
```
Add a `drawJunctionConduit` lens-contract check to `boardRender.test.ts` where feasible (it imports
headlessly).

## 9. Risk register

- **Replica tiny scale** — every addition sized **proportional to `pw`**, never absolute px (the container
  scale shrinks them); validate on a sealed SOT/DIP.
- **Opaque-core occlusion** (`coreAlpha 0.95`) — reality strokes stay ≤ the wall radius, concentric, never
  proud of `pw+5`, so over/under crossings stay clean.
- **Multi-pin crowding** — inherit the half-pitch clamp (`PITCH*0.46`); validate on a DIP.
- **Schematic untouched** — every reality branch sits inside `lens === "reality"`; the `conduit === null`
  schematic path is the unchanged baseline.
- **Draw order** — the junction hub draws **last** (on top); keep reality junction art in that pass.
- **Gauge contract** — `netSwing` / `netGaugeAnchors` / per-group `circuitVMax` stay frozen so the lenses
  don't diverge on magnitude.

## 10. Open questions (owner)

- Reality pin end: keep the round collar, or go full **rectangular SMD pad**?
- Different-net crossing: a discrete **jumper glyph**, the **via-down/up**, or just re-skin the bump?
- **Via rings** on same-net ties by default, or only at explicit layer transitions?

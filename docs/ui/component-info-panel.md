<!-- SPDX-License-Identifier: Apache-2.0 -->

# Component info panel — pinout, construction cutaway, and a frictionless trigger

Status: **design ideation. No code yet.** Owner-driven brief. This is the
follow-on to two existing notes that already shaped today's surfaces:
`docs/ui/teaching-tools.md` (which proposed the **info drawer** + the
**schematic⇄factory lens** + calculators) and `docs/ui/inspector-popup.md`
(which proposed the **per-frame anchored value popover**). Both shipped. This
note layers three new things on top of them, all from the project owner:

1. a **low-friction trigger** to open the info panel *without breaking the flow
   of building a circuit* (the owner suggested double-click as one option);
2. a **pinout** — a labelled, oriented terminal diagram — in the panel;
3. a **construction/cutaway illustration** that shows the part in far more
   physical detail than the schematic glyph (a capacitor's rolled winding, an
   MLCC's layer stack, etc.) — teaching *what the real part looks like inside*.

Everything here is **presentation-only**. It never touches `sim-core`, the
netlist, the snapshot hash, or the golden — same discipline as
`carrierOffset`/`phase`. It honours the design tokens (`web/src/app.css`), the
power-bus visual language (`docs/ui/visual-language.md`), the schematic-vs-factory
lens, and the existing `partInfo` / `InfoDiagram` / glyph architecture. It builds
on what's there; it doesn't re-litigate it.

### What exists today (the ground we're standing on)

Read these before judging the proposals — the recommendations lean on each:

- **Single-click selects.** `board.ts` `emitSelect` → `App.svelte` `selPart`.
  Exactly-one-valued-component selection projects a screen rect each frame
  (`emitAnchor` → `onAnchor`) and floats the **value popover** (`.value-pop`,
  `App.svelte`) above the part — chips + −/+ stepper + "more values", plus a
  one-line `V across · I through` meter. It tracks pan/zoom/drag and closes on
  Esc / click-away / drag / wire / Measure. This is the **fast inline editor**.
- **The info drawer** (`.info-drawer`, a 340px right-side panel) toggles on the
  **`ⓘ Info` toolbar button** (`infoOpen`). Tabs: **Info** (the `InfoDiagram`
  canvas + `partInfo`'s `equation` / `plain()` / a separated **"Right now"** live
  block of `headline` + `derived` rows, then the always-on `belt-note` explainer)
  and **Calculators** (`CALCS`). This is the **deep view**.
- **`InfoDiagram`** (`web/src/lib/infoDiagram.ts`) is a tiny dedicated Pixi
  `Application` that calls the **same `drawGlyph` drawers the board uses**, at
  `SCALE = 2.8`, fed the selected part's live `ElectricalState`. It is "the
  schematic glyph, but big and centred." It draws pin dots but **no pin labels**.
- **`partInfo.ts`** keys teaching content per `kind`. **`graph.ts` `PART_KINDS`**
  carries, per kind, the `pins[]` (each with a human `label` — `"A"`,`"K"`,`"C"`,
  `"E"`,`"B"`,`"G"`,`"P+"`,`"S−"`,`"W"`,… — plus `dx`/`dy` grid offsets), the
  footprint `w`/`h`, `colorKey`, and `unit`. `rotateOffset(dx,dy,rot)` already
  rotates an offset by the placed part's orientation.
- **`glyphs.ts`** dispatches `drawGlyph` through two parallel maps —
  `DRAWERS` (schematic) and `FACTORY_DRAWERS` (Factorio art) — keyed by `kind`,
  picked by a module-level `currentStyle`. **This parallel-map pattern is the
  template for the cutaway system (§3).**
- **Double-click is partly spoken for.** In Wire/Select/Junction mode a
  double-click on a **junction** grabs it for dragging (`DOUBLE_CLICK_MS`,
  `lastJunctionTap` in `board.ts`). A single press-release-in-place on a
  **manual switch (`MSW`)** *toggles it* (`toggleManualSwitch`). So a
  double-click *on a component* is currently unused — but it is **not** free of
  collisions, and §1 must handle that.

---

## 1. Interaction model — info without breaking flow

The brief's hardest constraint: getting rich info must not interrupt a build.
"Build flow" here is the modeless loop — arm a part, click to drop, drag a pin to
wire, nudge, repeat — punctuated by single-click selection and the value popover.
The info panel must be **one cheap gesture away, and one cheaper gesture gone**,
and it must never steal a click that the build loop needed.

### The collision map (why "just use double-click" isn't free)

A single click already does real work, so any new trigger overloads an existing
gesture. The conflicts, concretely:

- **Single-click = select + popover.** Can't reuse it; it's the inline editor.
- **First click of a double-click still fires.** On an **`MSW`** the first press
  toggles the switch (`toggleManualSwitch` runs on the unmoved pointer-up). So a
  naive "double-click opens info" would *flip the switch twice* (back to where it
  was) and feel broken on exactly the part a learner most wants to poke.
- **Double-click on a junction is taken** (junction-drag). Components aren't
  junctions, so that specific path is clear — but it sets the precedent that
  double-click is a *grab/act* gesture in this app, not an *inspect* gesture.
- **Hover is precious during wiring.** A hover-peek that pops a big panel while
  the user is hunting a pin to wire to would be actively hostile.

### The options, evaluated

| Trigger | Friction | Collision | Verdict |
| --- | --- | --- | --- |
| **Double-click the part** | very low; discoverable; matches "open details" idiom everywhere | the MSW double-toggle; the "double-click = grab" precedent | **Primary**, with the MSW carve-out below |
| **`I` hotkey** (info) on the selected part | zero mouse travel; keyboard-friendly | none (`I` is free in the global handler) | **Secondary**, ship together |
| **`ⓘ` affordance on the popover** | one click after select; obvious | needs the popover open first (two gestures from cold) | **Tertiary** — the *discoverable* path that teaches the other two |
| **Hover-peek (timed)** | no click at all | fights wiring/placement; flicker; accidental triggers | **Reject as the opener.** Consider only as a tiny *pin-label tooltip* (§2), never the panel |
| **Existing `ⓘ Info` toolbar toggle** | already there | far from the part; a "mode" feeling | **Keep**, repurposed as the **pin/persistent toggle** (below) |

**Why not hover-to-open.** The board is a placement/wiring surface; the cursor is
constantly travelling over parts en route to somewhere else. A panel that opens on
dwell would strobe during every build. Hover's *only* defensible job here is the
lightweight **pin label tooltip** (show a terminal's name when you pause over its
dot) — small, local, non-occluding, and genuinely useful while wiring. The rich
panel needs an intentional gesture.

### Recommendation

**Primary: double-click a component opens the info panel for it.** **Secondary:
press `I` to open it for the current selection.** Both routes converge on the same
panel and the same `infoOpen` state. Keep the **`ⓘ` toolbar button** as the
explicit/persistent toggle (and the cold-start discovery path), and add a small
**`ⓘ` chip on the value popover** header so a user who selected a part to edit its
value sees the one-click door to "tell me more."

This gives a clean ladder of intent: *glance* (the popover's live `V/I` meter is
already there on select) → *learn* (double-click / `I` / the popover's `ⓘ`) →
*pin it* (the toolbar toggle keeps it open as you move on).

### How it opens, and where it appears

**Reuse the existing right-side `.info-drawer` — do not invent a new floating
panel.** `teaching-tools.md` already settled this and shipped it, for good
reasons that still hold:

- A construction cutaway + a pinout + prose + a "Right now" block + (optionally) a
  curve is **a lot of vertical content**. The anchored popover is a small
  screen-space island that flips/clamps against the frame; a tall rich panel
  fights that chrome and the board beneath it. The drawer has the room.
- **The board stays live beside it.** The synchrony between the panel's live
  numbers and the board's belts *is* the lesson (`teaching-tools.md`). A modal or
  lightbox would kill the "watch it run while I read" loop. Keep the drawer.
- It's where the deep view already lives — double-click just becomes a faster
  door to the same room.

So: double-click (or `I`) sets `infoOpen = true` **and** ensures the part is the
single selection (so the drawer, the popover, and the on-board selection halo all
agree on *which* part). On a part that's already selected, double-click is purely
"open the drawer."

**Drawer-vs-popover division of labour (unchanged, now explicit):**

- **Popover = fast edit.** Stays the inline value editor (chips/stepper). It is
  the thing you summon constantly mid-build and dismiss instantly.
- **Drawer = deep understanding.** Pinout, cutaway, equation, "Right now",
  ratings. Summoned deliberately, lingers while you keep building.

They coexist with no new collision: selecting a valued part shows the popover as
today; opening the drawer is an *additional* intentional act. When the drawer is
open and you select a different part, both re-target to it (the drawer already
re-renders from `selPart`; the popover already re-anchors).

### The MSW carve-out (the one real conflict)

A manual switch toggles on a single in-place click. Two clean options; **pick (a):**

- **(a) Suppress the toggle on the *second* click of a double.** Track the same
  `DOUBLE_CLICK_MS` window the junction code already uses: if a press lands on the
  same component within the window, treat it as "open info" and **don't** run the
  toggle for that second press. Net effect on an MSW double-click: it flips once
  (first click), opens info (second), and the user sees the switch *and* its
  detail — arguably the ideal outcome. Tunable: if even one flip feels wrong,
  debounce so a recognised double-click rolls the first flip back. This keeps
  double-click universal across *all* parts (no special-cased gesture per kind).
- **(b) Make the MSW's info trigger `I`-only / popover-`ⓘ`-only.** Simpler, but
  now the gesture is inconsistent ("double-click opens info on everything except
  switches"), which is exactly the kind of papercut that erodes a modeless UI.

### How it tracks the selected part

No new machinery. `infoOpen` already gates a drawer that reads `selPart` and the
live `ElectricalState` for that id from the per-frame `electrical` map — **no new
JS↔wasm crossing, no per-component read** (golden rule #2). Double-click/`I` only
flip `infoOpen` and set the selection. The pinout and the cutaway are pure
functions of `selPart.kind` (+ `rot` for orientation, + `value`/`wiper` for the
few state-bearing glyphs) and the same live pair the glyph already gets.

### How it's dismissed without losing your place

Dismissal must be as cheap as opening, and must **never** disturb the build:

- **Esc** closes the drawer. (Today Esc disarms/clears selection via the global
  handler; extend it so a first Esc closes the drawer if open, *then* the existing
  disarm/clear behaviour on a second press — closing the panel shouldn't also drop
  your armed part or selection. Order: drawer → armed → selection.)
- **The `×` / the `ⓘ` toggle / `I` again** all close it.
- **Click-away does *not* close the drawer.** The drawer is a deliberate,
  persistent instrument panel (unlike the popover, which is ephemeral and *does*
  close on click-away). You can keep building — placing, wiring, selecting other
  parts — with it open; it simply re-targets to whatever you select. This is the
  "stays out of the way while I work" property the brief asks for: open it once,
  glance at it as you go, close it when done.
- **It never eats board pointer events** outside its own rect (it's a sibling DOM
  panel over the canvas, `z-index: 6`), so the build loop underneath is untouched.

### Keyboard + armed-placement flow

- **`I`** joins the existing single-letter handler (`b/w/j/l/m`); it must
  early-return on INPUT/TEXTAREA (already the pattern) so typing a net label or a
  calculator value never opens the panel.
- **Armed placement is unaffected.** While a part is armed (placing), `I` should
  still open info **for the current selection** if any — it doesn't disarm. A nice
  affordance to consider later: with a part *armed but not yet placed*, `I` could
  preview that **kind's** pinout+cutaway (learn the part before you drop it) — a
  pure read of `armedPart`, no selection needed. Flagged as optional (§5).
- All chips/steppers in the drawer are real `<button>`s; Tab order puts the drawer
  right after the canvas; Esc exits. No focus trap.

---

## 2. Information architecture of the panel

The drawer already separates **static prose** from **rapidly-changing live
numbers** (the `belt`/`info-live` split) — a standing project principle
(`partInfo.ts` header: prose is number-free so it never reflows). The new sections
slot into that discipline. Top-to-bottom order, most-glanceable first:

1. **Header** — part name (`partName(kind)`) + the `×`. (Today's `.info-head`.)
2. **Construction cutaway** (§3) — the new hero illustration. Replaces /
   supersedes today's `.info-diagram` schematic-glyph canvas as the headline
   visual. *Decision point in §5:* does the cutaway **replace** the schematic
   `InfoDiagram`, or sit beside it? Recommendation below.
3. **Pinout** — a labelled, oriented terminal diagram (built from
   `PART_KINDS.pins`; details below). Small, static, sits directly under the
   cutaway so "what it looks like" and "which leg is which" read together.
4. **Equation** (`info.equation`, `.info-eq`) — the governing relation, symbolic.
5. **Plain-language** (`info.plain()`, `.info-plain`) — number-free "how it
   works." Unchanged.
6. **"Right now"** (`.info-live`) — `info.headline(e,…)` + `info.derived(e,…)`
   rows. The *only* place live numbers live, visually fenced off so the prose
   above never reflows. Unchanged — this is the principle, kept.
7. **Ratings / parameters** *(new, static)* — the part's defining static specs
   that aren't "right now" readings: a diode's family knee (~0.7 V Si / ~0.3 V
   Schottky / band-gap `Vf` for an LED), a Zener's `Vz`, an electrolytic's ESR +
   **polarity**, a transformer's turns ratio, a gate's logic-high rail + one-tick
   propagation delay. These are descriptors, not telemetry, so they go in a quiet
   static block (a `.info-spec` table) **above** "Right now", *not* mixed into it.
   Many already exist as `derived` rows that don't actually change (e.g. ESR,
   `Vz`, `β`); migrate those genuinely-static ones up into the ratings block so
   "Right now" holds only quantities that move. (Authoring note: extend the
   `PartInfo` descriptor with an optional `specs: {label,value}[]` — static, no
   `ElectricalState` argument — paralleling `derived`.)
8. **Belt explainer** (`.belt-note`) — the always-on carriers-vs-energy primer.
   Unchanged; stays at the bottom as general background.
9. **Calculators tab** — unchanged (`CALCS`), the second tab.

**Pinout — how to build it from `PART_KINDS.pins`.** Everything needed is already
in the model:

- Each `pin` has `{ label, dx, dy }`; the kind has `w`/`h`. Centre the offsets the
  way `InfoDiagram` already does (`(dx − (w−1)/2)·PITCH`, same for `dy`) so the
  diagram is centred and scalable.
- **Orient it like the placed part.** Apply `rotateOffset(dx, dy, selPart.rot)`
  so the pinout matches the orientation on the board — a learner reading "which
  physical leg is the cathode" needs it pointing the way their part points. (This
  is the one thing the diagram *must* track beyond `kind`.)
- Draw a small body silhouette (reuse the part's existing schematic outline, or a
  neutral rounded-rect package), put a **labelled callout** at each pin —
  `label` as DOM text (`A`,`K`,`C`,`E`,`B`,`G`,`OUT`,`IN+`,`P+`,`S−`,`W`,…) so
  it's selectable/translatable/screen-reader-legible (the a11y rule from
  `teaching-tools.md`), with a leader line to the pin dot, coloured by the kind's
  `PALETTE[colorKey]`.
- **Tie label → meaning** for the parts where the leg identity *is* the lesson:
  diode A/K (current flows A→K), BJT C/B/E, MOSFET D/G/S, op-amp IN+/IN−/OUT,
  electrolytic +/− (**polarity**), transformer primary/secondary pairs, pot A/W/B.
  A one-word gloss per pin (e.g. `K — cathode (current exits here)`) makes the
  pinout teach, not just label. This text can be authored alongside `partInfo`
  (an optional `pinNote(label)` map) or defaulted from a shared
  `label → human name` table (since labels are shared across kinds).
- **Hover tooltip tie-in (§1):** the same `label`s power a board-side pin tooltip
  on dwell — one source of truth for terminal names.

The pinout is **static** (it doesn't animate with `electrical`), which is correct:
it's reference, not telemetry. It can be drawn into the same Pixi sub-app as the
cutaway (a second region) or as inline SVG/DOM — see §3 + §5.

---

## 3. The construction-detail illustration system (the heart of it)

The schematic glyph answers *"what's its symbol and what's it doing?"* The cutaway
answers a different question the brief is explicit about: *"what does the real
part look like inside, and why is it built that way?"* A capacitor's symbol (two
plates) hides that an electrolytic is a **rolled foil-and-electrolyte spiral**,
that an MLCC is an **interleaved stack of electrode and dielectric layers**, that
a film cap is **rolled metallized film** — three radically different objects
behind one glyph. The detail view teaches the physical thing.

### Approach: a third parallel drawer map, mirroring the lens architecture

The renderer is *already shaped for exactly this*. `drawGlyph` dispatches through
`DRAWERS` and `FACTORY_DRAWERS` — two maps with identical keys and the same
`(g: Graphics, o: GlyphOpts) => void` signature, picked by `currentStyle`. The
cutaway is a **third sibling map**:

```
// glyphs.ts (sketch — illustrative, not final)
const DETAIL_DRAWERS: Record<string, (g: Graphics, o: DetailOpts) => void> = {
  C:  drawDetailMLCC,        // interleaved electrode/dielectric layer stack
  EC: drawDetailElectrolytic,// rolled foil + electrolyte spiral, polarity marked
  R:  drawDetailResistor,    // ceramic body + colour bands + end caps + leads
  D:  drawDetailJunctionDie, // P/N die on a lead frame in an epoxy body
  // …one per type or per shared template (see catalogue)
};
```

`InfoDiagram` is the natural host: it's a self-contained Pixi `Application` that
already takes a `kind`, a live `ElectricalState`, and a free-running `phase`. Add
a mode flag (`"schematic" | "detail"`) — in detail mode it calls
`DETAIL_DRAWERS[kind]` instead of `drawGlyph`, at a larger scale and *without* the
pin-dot overlay (the pinout region handles terminals). The drawer loop, the
device-pixel-ratio handling, the resize, and the teardown are all already there
and reused verbatim.

`DetailOpts` is a small superset of `GlyphOpts` — it still gets `color`,
`phase`, and the live pair (so a cutaway *can* animate: an electrolytic's spiral
can shimmer charge as it fills, exactly like `drawC`'s dielectric glow keyed to
`norm(vAcross, V_SCALE)`), plus a `scale`/`bounds` for the bigger canvas. Crucially
it needs **no pin geometry** — the cutaway is an *illustration of the object*, not
a wired symbol, so it's freed from the `o.pins` contract that constrains the board
glyphs. That's what lets it be genuinely richer.

### Pixi-drawn vs authored SVG vs hybrid — the trade-off

| Approach | Fidelity | Effort | Determinism | Reuse of `InfoDiagram` | Animation |
| --- | --- | --- | --- | --- | --- |
| **Pixi `Graphics` (`DETAIL_DRAWERS`)** | medium-high; procedural curves/spirals/bands look clean at any scale and recolour from tokens for free | medium per part, but shares the whole Pixi host + helpers (`flow`, `norm`, glow) | irrelevant (pure presentation, never hashes) — same as every glyph | **maximal** — same app, same loop, same `phase` | trivial (live `phase`/`electrical` already flow in) |
| **Authored SVG/PNG assets** | highest possible (an illustrator can make a beautiful cutaway) | high up-front per part + an **asset pipeline** the repo doesn't have yet; localisation of in-art labels is painful | irrelevant | low — bypasses Pixi; would render as `<img>`/inline SVG in the drawer DOM | hard (static unless hand-animated) |
| **Hybrid: Pixi for the live/structural layer, SVG/`<img>` only where an artist must** | high where it matters | medium, deferred | irrelevant | high | per-layer |

**Recommendation: ship Pixi-drawn `DETAIL_DRAWERS`.** Reasons:

- It **reuses the `InfoDiagram` host and the whole animation substrate** — the
  cheapest path to a *moving, live-reactive* cutaway (an electrolytic that
  visibly charges, a transformer whose core flux pulses with primary current),
  which the static glyphs already prove plays well with the bench aesthetic.
- It **recolours from `PALETTE` / `app.css` tokens automatically** — a hard
  constraint here ("use the CSS custom properties, do not hardcode colors") that
  hand-drawn raster assets would constantly violate.
- It **needs no new build/asset pipeline** (none exists; fonts are the only
  runtime asset, CDN-loaded). Procedural spirals, layer stacks, colour bands, and
  lead frames are all well within `Graphics`' arcs/polys/rects — the same
  primitives the glyphs already use.
- It scales crisply at any drawer width / DPR (vector, like the glyphs).
- **Keep the door open to the hybrid** for a future "beauty pass": a part whose
  cutaway really wants an illustrator can swap to an authored SVG layer behind the
  same drawer key without touching callers. But that's polish, not MVP, and it
  must respect the token palette and keep labels as DOM.

**Determinism note (so it's on the record):** the cutaway is pure presentation,
like `carrierOffset`/`phase`. It reads the live `ElectricalState` only to animate;
it **never** feeds the sim and **never** enters `snapshot_hash`. Nothing here can
touch `run_is_reproducible` or the golden. (Golden rules #1/#2 are unaffected.)

### Per-component-type cutaway catalogue

One or two sentences per type describing the cutaway it should show, and which
share a template. Grounded in the kinds in `PART_KINDS` / the parts bin and the
roadmap in `docs/parts-catalog-ideation.md`. Group by shared construction so we
author **templates**, not N bespoke drawers.

**Capacitors — three genuinely different objects (the owner's headline example):**

- **Ceramic / MLCC (`C`).** A **cross-section of the interleaved stack**:
  alternating metal **electrode** layers (combed from the two opposite end
  terminations) separated by **dielectric** layers, the whole block capped by the
  two silver end terminations. Animate the dielectric layers glowing with
  `norm(vAcross)` (the field building) — the layer stack *is* why MLCCs pack high
  capacitance in a chip. Tie the +/− here to "non-polarized."
- **Electrolytic (`EC`).** The **rolled (wound) cross-section**: a spiral of
  **anode foil / oxide dielectric / electrolyte-soaked paper / cathode foil**
  rolled into a cylinder, with the **+ (anode) lead** clearly marked and the can /
  vent. Call out **polarity** (the one fact that destroys the part if ignored) and
  show the **ESR** as the foil/electrolyte resistance the roll inevitably has —
  literally the parasitic the sim models. Charge shimmer can ride the spiral.
- **Film (`C` variant / future).** **Rolled metallized film**: two long
  metallized plastic films wound into a flattened roll, leads off each end — the
  "why film caps are physically big but stable and self-healing" picture.

> *Template sharing:* electrolytic and film share a **"rolled winding" template**
> (a spiral path with N turns, two coloured layers, a polarity flag toggled on);
> MLCC is a distinct **"layer stack" template**. Both are reused below.

**Resistors / pots / thermistors — body + element:**

- **Resistor (`R`).** A **ceramic rod body with the colour bands** painted on,
  end caps, and the axial leads — and, peeking through a cutaway window, the
  **carbon/metal-film element** (or a spiral-cut film) that is the actual
  resistance. The colour bands double as a mini "read the value" teach.
- **Potentiometer (`POT`).** The **resistive track (an arc/horseshoe) with the
  wiper** riding on it, the three terminals (A / W / B) brought out; the wiper
  position can track `selPart.wiper` so it *moves* — the same value the glyph
  animates. Shares the **band/element body** styling with the resistor.
- **Thermistor / LDR / MOV (future).** Body cutaways: thermistor = a bead/disc of
  metal-oxide ceramic with two leads + a "T°" heat cue; LDR = a serpentine
  photoconductive track under a window with incoming-light arrows; MOV = a
  metal-oxide disc between two electrodes (a "symmetric Zener" block). These reuse
  the **disc/bead body template** with different fills + a domain cue.

**Diodes / LEDs — junction + lead frame (one big shared template):**

- **Diode (`D`) / Schottky (`SD`) / Zener (`ZD`).** A cutaway of the **die on a
  lead frame** inside an epoxy/glass body: the **P and N regions meeting at the
  junction**, the cathode-band end marked, the two leads. Differentiate by a small
  inset: Schottky shows the **metal-semiconductor** contact (no second doped
  region); Zener marks the **reverse-breakdown** region. The depletion region at
  the junction can subtly widen/narrow with bias for the conducting cue.
- **LED (`LED`).** The classic **5 mm lamp cutaway**: the **die in the reflector
  cup** at the end of the **anvil (cathode) post**, the thin **bond wire** arcing
  to the **anode post**, the **epoxy dome lens**, and the flat-side / short-leg
  cathode marker. The die **emits** (reuse the LED's brightness-from-current
  glow), so the cutaway lights up — the single most rewarding detail view to ship.

> *Template sharing:* D/SD/ZD/LED all share a **"die + lead frame in a body"
> template**; the LED adds the dome + reflector cup + emission, the Schottky/Zener
> swap the junction inset. This one template covers the whole diode family.

**Transistors — die / package cross-section (shared 3-terminal template):**

- **BJT (`Q`/`QP`).** A **vertical NPN/PNP cross-section**: the emitter, base,
  and collector layers stacked, the two junctions visible, brought out to the
  three leads (C/B/E labelled to match the pinout). The "small base current steers
  a big collector current" idea reads off the thin base layer.
- **MOSFET (`NM`/`PM`).** A **planar MOS cross-section**: source/drain diffusions
  in the body, the **insulated gate** over the channel (the oxide layer drawn
  explicitly — *why no gate current flows*), the body/substrate. The channel can
  shade in/out with conduction (mirrors the glyph's choking-channel cue).
- **JFET (future).** Channel with the gate junctions pinching it — a restyle of
  the MOSFET template (no oxide bar).

> *Template sharing:* BJT and MOSFET share a **"semiconductor cross-section"
> template** (stacked doped regions + contacts + leads); the MOSFET adds the oxide
> layer, the BJT the angled junctions. Op-amp/ICs (below) reuse the **package**
> half of it.

**Magnetics — windings on a core (shared with the rolled template's cousin):**

- **Inductor (`L`).** A **wound coil on/around a core** (air or ferrite),
  cross-section showing the turns and the core; the field can breathe with current
  (reuse `drawL`'s halo idea at scale).
- **Transformer (`TR`).** **Two windings (primary / secondary) on a shared
  laminated core**, turns drawn, the **lamination stack** of the core shown, the
  two winding pairs brought out (P+/P−/S+/S−). The **turns ratio** (`selPart.value`)
  can set the visible turn counts; the core flux pulses with primary current
  (reuse `drawTR`'s flux glow). Teaches isolation + ratio physically.

**Switches / relays / fuses — mechanism cutaways:**

- **Manual switch (`MSW`) / clock switch (`SW`).** The **contacts and the blade
  /armature** — closed = blade bridging the two contacts, open = lifted with a
  visible air gap. For `MSW` the position tracks `selPart.value` (open/closed), so
  the cutaway shows the *commanded* state (same source the glyph uses).
- **Relay (future).** A **coil + armature + contact** cutaway: energising the coil
  pulls the armature to close the contact, the control and load sides physically
  separate (isolation). Shares the **coil** styling with the inductor and the
  **contact** styling with the switch.
- **Fuse (future).** The **element/wire inside the body**, intact vs the blown
  gap — the "sacrificial link" picture.

**Sources / ground / op-amp / logic — package or schematic-leaning:**

- **Op-amp (`OA`) / logic gates (`AND`/`OR`/…/`NOT`) / FF / FPGA / uC.** These are
  *ICs*, not discretes — their honest "construction" is a **package** (DIP/SOIC
  body, the die inside, the lead frame / bond wires fanning to the pins) plus a
  **functional block** hint (the gate's internal transistor pair, the op-amp's
  diff-pair-then-output-stage), kept schematic-ish because the teaching is the
  *function*, not the silicon layout. One shared **"IC package + die" template**.
- **Voltage / current / AC source (`V`/`I`/`AC`).** These are *idealisations*, not
  a single real object — there's no one cutaway. **Fall back to the rich schematic
  `InfoDiagram`** (battery cell stack for `V`, a labelled signal-generator block
  for `AC`). Don't force a fake cutaway; the schematic *is* the right detail here.
- **Ground (`GND`).** Reference, not a part — no cutaway; the schematic symbol +
  "this is the 0 V reference" prose is complete.

**Fallback.** Any kind without a `DETAIL_DRAWERS[kind]` entry **falls back to the
existing schematic `InfoDiagram`** (call `drawGlyph` as today). So the panel is
never empty — the cutaway is a *progressive enhancement* per type, exactly like
`FACTORY_DRAWERS` degrades to `DRAWERS` via `DETAIL ?? schematic`. This lets the
catalogue land incrementally (§4) with zero broken states.

### Template inventory (what we actually author)

The ~30 kinds collapse to a handful of templates plus a few specials:

1. **Rolled winding** (electrolytic, film) — spiral, two layers, optional polarity.
2. **Layer stack** (MLCC) — interleaved electrode/dielectric.
3. **Body + bands/element** (resistor, pot, thermistor, LDR, MOV disc).
4. **Die + lead frame in a body** (D, SD, ZD, LED — LED adds dome/emission).
5. **Semiconductor cross-section** (BJT, MOSFET, JFET).
6. **Windings on a laminated core** (inductor, transformer).
7. **Mechanism** (MSW/SW contacts, relay coil+armature, fuse element).
8. **IC package + die** (op-amp, gates, FF, FPGA, uC).
9. **Schematic fallback** (V, I, AC, GND, and any not-yet-authored kind).

Authoring eight or nine templates (each parameterised per kind — layer count,
colours from tokens, polarity flag, turn count, label set) covers the whole
catalogue far more cheaply than 30 one-offs, and keeps the look consistent.

---

## 4. Phasing / MVP

Incremental, aligned with the part roadmap (`parts-catalog-ideation.md`), each
phase shippable behind the existing gates and touching no sim/golden.

**Phase 1 — Trigger + pinout (the frictionless core).**
- Double-click a component opens the info drawer (with the **MSW carve-out**);
  add the **`I`** hotkey and the popover **`ⓘ`** chip; wire Esc-closes-drawer
  first. Keep the toolbar toggle.
- Build the **pinout** from `PART_KINDS.pins` + `rotateOffset`, with DOM labels +
  the shared `label → human name` glosses. Add the board-side **pin-name hover
  tooltip** off the same labels.
- This alone delivers the brief's asks #1 and #2 and reuses the live `electrical`
  map with no new boundary read.

**Phase 2 — First cutaways (asks #3, highest-reward types).**
- Stand up `DETAIL_DRAWERS` + the `InfoDiagram` detail mode + the
  `DETAIL ?? schematic` fallback.
- Author the **highest-teaching templates first**: the **three capacitor
  cutaways** (MLCC stack, electrolytic spiral, film roll — the owner's example),
  the **diode-family die+lead-frame** (with the **LED lamp** as the showpiece —
  it lights up), and the **resistor body+bands**. Everything else still falls back
  to the schematic `InfoDiagram`, so nothing looks broken.
- Add the static **ratings/parameters** block; migrate genuinely-static `derived`
  rows up out of "Right now".

**Phase 3 — Fill the catalogue along the part roadmap.**
- As each part tier lands (`parts-catalog-ideation.md` phases), add its template:
  BJT/MOSFET cross-sections, transformer/inductor windings, pot track+wiper, the
  switch/relay/fuse mechanisms, the IC package+die. Each is one more
  `DETAIL_DRAWERS` entry; no architecture change.

**Phase 4 — Polish (later, optional).**
- The **inline curve** (the IV line / charge curve with the live operating point)
  from `teaching-tools.md`'s layer 3 — a tap deeper in the drawer.
- **Armed-part preview** (`I` on an armed-but-unplaced kind previews its
  pinout+cutaway).
- A **beauty pass** swapping select cutaways to authored SVG behind the same
  drawer keys (hybrid), if an illustrator is available — still token-coloured,
  labels still DOM.
- Optional **exploded view** / construction-step animation for marquee parts.

---

## 5. Open questions / hand-offs (for the owner to settle)

1. **Cutaway vs schematic `InfoDiagram` — replace or coexist?** Recommendation:
   the **cutaway is the headline visual** when a `DETAIL_DRAWERS[kind]` exists, and
   the schematic is the **fallback** when it doesn't (and stays the right choice
   for the idealised sources `V`/`AC`/`I` and `GND`). A small **schematic⇄cutaway
   toggle** *inside the panel* (so a learner can flip "symbol I'll meet on a
   datasheet" ↔ "what's inside") is appealing and cheap given the parallel-map
   architecture — **worth confirming** whether to ship that toggle in Phase 2 or
   default to cutaway-with-fallback and add the toggle later.

2. **Pixi-drawn vs authored-SVG cutaways.** Recommendation: **Pixi-drawn**
   (`DETAIL_DRAWERS`) for token-colour compliance, animation, no asset pipeline,
   and `InfoDiagram` reuse — with a **hybrid escape hatch** later. **Confirm**
   there's no appetite to stand up an SVG/illustration asset pipeline now (it'd
   change the recommendation and the effort profile, and raises in-art label
   localisation issues).

3. **How much animation in the cutaway?** The structural drawing can be static, or
   it can ride the same live `electrical`/`phase` the glyphs use (electrolytic
   charging, transformer flux, LED emission, MOSFET channel). Recommendation:
   **animate where it teaches** (it's free given the host) but keep it calm and
   within the bus-language discipline (magnitude rides alpha/density, never speed —
   `visual-language.md`). **Confirm** the appetite per part.

4. **MSW double-click behaviour.** Recommendation **(a)**: the second click of a
   double opens info and is suppressed from toggling, so an MSW double-click flips
   once then opens info — keeping double-click *universal* across all kinds.
   **Confirm** that the one residual flip is acceptable, or whether to roll it back
   on a recognised double-click (slightly more code, zero flips).

5. **Does click-away close the drawer?** Recommendation: **no** — the drawer is a
   persistent instrument panel that re-targets as you select, so you can keep
   building with it open (the popover, by contrast, is ephemeral and *does* close
   on click-away). **Confirm** this matches the owner's mental model; it's the
   crux of "stays out of the way while wiring."

6. **Where do per-pin glosses and static specs live?** Recommendation: extend the
   `PartInfo` descriptor with optional `specs` (static ratings) and a per-pin
   `pinNote` map, defaulting pin names from a shared `label → human name` table
   (labels are shared across kinds). **Confirm** the authoring shape so the prose
   register stays consistent with `partInfo`/`examples.ts`.

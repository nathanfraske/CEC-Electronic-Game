<!--
  SPDX-License-Identifier: Apache-2.0
-->

# Understand-the-component tools — design ideation (draft)

Status: **design / brainstorm** (owner-driven). This note explores three tools
that all answer the same question from different angles — *what is this part
actually doing right now?* — and how each reuses what the board already has.

The board today gives you three readouts on a part: the **animated glyph**
(`web/src/lib/glyphs.ts` — per-kind `draw*` drawers fed live `electrical` state +
a free-running `phase`), the on-board **value label** (`formatValue`), and, while
selected, a one-line **`V across · I through` meter** (`ComponentNode.update` in
`board.ts`) plus the **value popover** (`onAnchor` projection in `board.ts`, the
`.value-pop` in `App.svelte`). All three are *what* but not *why*. These tools add
the *why*, the *math*, and the *game-feel lens* — without breaking the golden
rules: presentation-only, no extra JS↔wasm crossing, deterministic phase, design
tokens not hardcoded colors.

The three tools, and where they sit relative to existing surfaces:

| Tool | One-liner | Lives in | Reuses |
| --- | --- | --- | --- |
| **1. Component info** | big animated diagram + governing equation + plain-language "right now" | a side drawer (expanded inspector) | `electrical` map, glyph drawers, `formatValue`/`fmtSI`, examples' `why` prose |
| **2. Style toggle** | Schematic ⇄ Factory glyph set, same pins/wiring | global toolbar toggle | second `DRAWERS`-like map, `PART_KINDS` pin geometry, the whole `flow`/charge animation |
| **3. Calculators** | divider / Ohm / RC / Xc / f0 helpers that read the selection | a tab in the info drawer | selection + `electrical`, the inspector's `setVal` to push values back |

References throughout: `web/src/lib/glyphs.ts` (`GlyphOpts`, `ElectricalState`,
`DRAWERS`, `flow`, `norm`), `web/src/lib/board.ts` (`onAnchor`/`emitAnchor`,
`ComponentNode`, `fmtSI`, `setComponentValue`, `Mode`), `web/src/lib/graph.ts`
(`PART_KINDS`, `formatValue`), `web/src/App.svelte` (`selPart`, `.value-pop`,
`setVal`/`stepVal`), `web/src/lib/examples.ts` (the `blurb`/`watch`/`why` prose
register), and `docs/game-factory-loop.md` (the assembler/buffer-chest framing).

---

## 1. Component info tool — the explanatory view

**Goal.** Click a part (or pick an "Info" tool) and get a large, animated,
*explanatory* diagram: the **governing equation with the live numbers plugged
in**, the symbol drawn big enough to read its mechanism (plates filling, field
breathing, current dividing), and **one or two plain sentences about what's
happening this instant** — e.g. for a charging cap: `i = C·dV/dt`, the live
`i`, `C`, `dV/dt` substituted, plates ~63% filled, and *"the cap is 63% charged;
current has fallen to 1.2 mA as it approaches the rail."*

### Where it lives (three homes considered)

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Expand the value popover** | already anchored to the part (`onAnchor`); zero new projection; one click from select | the popover is small, screen-space, flips/clamps against the frame (see `inspector-popup.md`); a big animated diagram fights that chrome and the board underneath |
| **B. Modal / lightbox** | maximum room; can pause-and-teach | covers the board — kills the "watch it run while I read" loop that makes the sim worth it; modal feels like leaving the bench |
| **C. Side drawer (recommended)** | big canvas for the diagram; board stays visible and *live* beside it; natural home for the calculator tab (§3) and the equation; slides in/out like an instrument panel | a third panel competes for width on small screens (collapse the bin or overlay it) |

**Recommendation: a right-side info drawer** that opens on a dedicated **Info
tool** (an `i` toggle next to Build/Measure, or double-click a part). It replaces
nothing; the value popover stays the fast inline editor, the drawer is the deep
view. Keep the board running beside it so the diagram's live numbers and the
board's belts move together — that synchrony *is* the lesson.

### How it reuses the live electrical state

The drawer needs **no new data**. The same `Map<number, ElectricalState>` already
built each frame (`electricalMap` → `b.update`) and handed to the glyphs carries
`{ current, vAcross }` per component. The drawer subscribes to the selected id's
entry and re-renders its big diagram from it — identical source to the on-board
glyph, just larger and annotated. For `dV/dt`-type quantities (the cap's `i =
C·dV/dt`, the inductor's `v = L·di/dt`) the rate is **derivable two ways without
touching the sim**: invert the constitutive law from the live pair (`dV/dt = i /
C`) — exact, free, and the most honest framing since it *is* the equation we're
teaching — or finite-difference the value across frames as a fallback. Prefer the
inversion. Energy (`½CV²`, `½LI²`), time-constant progress, and power (`v·i`) are
all instantaneous functions of the same pair.

**Render the big symbol by reusing the drawers.** The `draw*` functions are
parameterised by `GlyphOpts` (pins, footprint, color, `electrical`, `phase`).
Call the same drawer into a larger `Graphics` with scaled-up pin spacing and a
bigger `wPx`/`hPx`, and the plates-filling / field-breathing / current-dividing
animation comes for free at diagram scale. The drawer is the single source of the
mechanism's look; the info view is "the glyph, but 6× and labelled."

### How deep the math goes (per-part, layered)

Depth must be **opt-in** so it teaches without overwhelming. A three-layer
disclosure, all reading the same live pair:

1. **Headline (always):** the one governing relation with numbers substituted,
   plus the plain sentence. R: `V = I·R` → `3.0 V = 2.0 mA × 1.5 kΩ`. C:
   `i = C·dV/dt`. L: `v = L·di/dt`. Diode: `I = Is·(e^(V/nVt) − 1)`, "forward,
   conducting." V/I source: the dual identity (forces V / forces I).
2. **Derived (one tap):** the secondary quantities — power `P = V·I`, stored
   energy, RC/RL `τ` and "% settled," reactance at the source frequency for
   AC. Each as `symbol = expression = value`.
3. **Curve (one more tap):** a small inline plot of the relevant law with a dot
   at the present operating point — the IV line for R/D, the `V(t)=V₀(1−e^(−t/τ))`
   charge curve for C with the live point riding it. This is the scope's drawing
   code (`drawScope`, `sampleRoute`) repurposed for a static analytic curve +
   live cursor.

Cap the per-part math at what the **sim actually models** — never show an
equation for a behavior the engine doesn't compute (that would be a lie the
determinism contract can't back). The ideal primitives (V/R/C/L/I) and the
modelled nonlinears (D, SW) get full treatment; Tier-II/III placeholders (Q, &,
FF, uC) get an identity card and "not simulated yet."

### Per-part-authored content vs templated layout

**Hybrid, leaning templated.** The *layout* is one generic component — header,
big diagram, equation rows, curve — driven by a small per-kind **descriptor**:

```
{ kind, equationLatexish, terms: [{sym, from(e)}], plain(e), curve?: {fn, axis} }
```

The descriptor is tiny per part (the equation string, which live terms to bind,
and a `plain(e)` that returns the "right now" sentence from the electrical pair).
This mirrors how `examples.ts` already carries plain teaching prose per circuit
(`blurb`, `watch`, each step's `why`) — that register and voice should be the
model for `plain(e)`, ideally reusing the same wording so a cap reads the same in
the RC example and in its info card. Authored where it matters (the words, the
relation), templated everywhere else (the frame, the bindings, the animation,
which all come from existing code). No per-part bespoke rendering.

### Accessibility

- The equation and the "right now" sentence are **real DOM text** in the drawer
  (not baked into the Pixi canvas), so they are selectable, screen-reader
  legible, and translatable. Render the substituted numbers with `fmtSI` so units
  match the rest of the HUD.
- The diagram canvas is decorative-with-a-caption: give the drawer an
  `aria-live="polite"` summary line ("Capacitor, 63% charged, 1.2 mA") that
  updates on a throttle (not every frame — coalesce to ~2 Hz so it doesn't spam
  assistive tech).
- Drawer is keyboard-reachable (Tab order right after the board; Esc closes,
  matching the popover's Esc contract); never trap focus.
- Don't rely on color to name a rail (the visual-language doc's own rule) — the
  equation carries the value; color only identifies.

### Recommendation + sketch

**Build the side drawer (Option C), templated layout + per-kind descriptor,
reading the existing `electrical` map.** Sketch:

1. **Descriptor table** `web/src/lib/partInfo.ts`: one entry per simulated kind —
   equation string, term bindings `(e) => number`, `plain(e) => string`, optional
   `curve`. Pull `plain` wording from the matching `examples.ts` prose.
2. **`App.svelte`**: add an `infoOpen` state + an Info tool button; when open and
   `selPart` is set, render an `<aside class="info-drawer">`. Feed it
   `selPart` + the live `ElectricalState` for that id (already in scope where the
   `electrical` map is built in the `runLoop` callback — pass the selected id's
   entry down as a prop, no new boundary read).
3. **Big diagram**: a small Pixi sub-app or a reused `Graphics` that calls the
   existing `DRAWERS[kind]` with scaled pins/footprint and the live `electrical` +
   `phase`. (Cleanest: a tiny dedicated `Application` sized to the drawer; it
   shares no state with the board except the values it's handed.)
4. **Equation rows + curve**: DOM rows (`symbol = expr = fmtSI(value)`); the curve
   is a 120×60 `Graphics` plotting the analytic law with a live dot.

**Do NOT** add a per-component wasm read for this (reuse the frame's `electrical`
map); **do NOT** re-implement the symbol art (call the drawers); **do NOT** show
math the engine doesn't simulate; **do NOT** cover the board (the live
side-by-side is the point); **do NOT** bake the equation text into the canvas
(keep it DOM for a11y).

---

## 2. Schematic ⇄ Factory style toggle

**Goal.** A **global style toggle** flips every component's art between
**Schematic** (the current IEC/ANSI-ish symbols — purist, learnable, transferable
to real bench work) and **Factory** (stylized buildings/assemblers, per
`game-factory-loop.md`: the cap as a **buffer chest**, the source as a
**generator**, an IC as an **assembler**, a diode as a **one-way conveyor/check
valve**). Wiring, pins, and the power-belt animation are **identical** in both —
only the body art changes.

### The architecture: a second drawers map, shared pin geometry

The current renderer is already perfectly shaped for this. `drawGlyph` dispatches
on `o.kind` through a `DRAWERS: Record<string, drawer>` map (`glyphs.ts`), and
every drawer reads pin positions from `o.pins` — which come from `PART_KINDS`
geometry (`board.ts` `ComponentNode` builds `pinPositions` from `kind.pins`). So:

- **Add a parallel `FACTORY_DRAWERS` map**, same keys (`V/R/C/L/I/AC/GND/D/SW`),
  same `(g, o: GlyphOpts) => void` signature. `drawGlyph` takes (or reads) the
  active style and picks the map: `const drawer = (style === "factory" ?
  FACTORY_DRAWERS : DRAWERS)[o.kind]`.
- **Pins are untouched.** Both styles draw the body *between* `o.pins[0]` and
  `o.pins[1]`; the pin dots are drawn by `ComponentNode` over the glyph
  regardless. Because pin geometry lives in `PART_KINDS`, **wiring is byte-for-bit
  identical** across styles — a board wired in Schematic looks correct the instant
  you flip to Factory, no re-route, no netlist change. This is the load-bearing
  property and it's already free.
- **Animation parity is automatic** because the animation lives in shared helpers
  (`flow`, the `norm`/`CUR_SCALE`/`V_SCALE` scaling, `phase`), not in the symbol
  art. A factory drawer calls the same `flow(...)` along its body, so current
  still chevrons through, charge still fills, fields still breathe — the belt
  language (`visual-language.md`) is style-independent by construction.

### What each part looks like in Factory mode (sketch)

Keep the **footprint and pin axis** identical (so the building occupies the same
cells); restyle the body. The factory framing in `game-factory-loop.md` already
assigns the metaphors:

- **V / I source → generator / power plant.** A boxy machine with a pulsing core;
  the current still flows out the leads. (Tier-0/1 "the belt's origin.")
- **R → lane limiter / regulator valve.** A narrow gate the belt squeezes
  through; the heat-halo (already keyed to `current` in `drawR`) becomes a
  glowing "working" tint.
- **C → buffer chest.** A chest/tank that visibly **fills** with the charge level
  (reuse the `charge = norm(vAcross, V_SCALE)` fill from `drawC`, drawn as a
  liquid/stack level instead of a dielectric glow). This is the single best
  metaphor in the whole game — the doc calls the cap *literally* the buffer chest.
- **L → flywheel.** A spinning rotor whose spin rate tracks `current` (reuse the
  breathing-field magnitude); stores in motion.
- **D → one-way conveyor / check valve.** A directional gate that lights when
  forward-biased (reuse `drawD`'s `cond` gating) and visibly blocks when reverse.
- **SW → gate/door.** Open/closed door driven by the same `closed` test as
  `drawSW`.
- **GND → sink / drain.** A grate the return belt pours into.

Each is a ~40-line factory drawer mirroring its schematic sibling's state
bindings — same inputs, different body.

### Where it lives + the learnability trade-off

| Where the toggle lives | Note |
| --- | --- |
| **Global toolbar toggle** (recommended) | one switch in the board tools row (near Reset View), persisted; it's a *view*, not a mode, so it never affects placement/wiring/sim |
| Per-part | rejected — mixing styles on one board is visual noise and defeats "read the whole base at a glance" |
| Settings-only | too buried for something meant as a fun lens |

**The trade-off (and the recommendation): default Schematic; Factory is an
opt-in lens, with a per-tier reveal as the bridge.** Reasoning:

- **Schematic must be the default** because the project's thesis is *real,
  transferable* electronics — a learner should see the symbol they'll meet on a
  real datasheet/bench. Factory-first would teach a metaphor instead of the thing.
- **Factory is the game-feel hook** — the `game-factory-loop.md` "build a living
  machine" fantasy lands harder when a cap is visibly a buffer chest filling up.
  As a toggle, it's a reward, not a crutch.
- **Per-tier reveal bridges them:** introduce a part in Schematic (learn the real
  symbol + equation via Tool 1), and *unlock* its Factory skin once you've used it
  in a working sub-circuit. The skin becomes a small "you understand this now"
  trophy — and switching back and forth reinforces that the chest *is* a cap. This
  ties to the `game-rewards.md` "earn the abstraction" idea (the same gate that
  lets you black-box a block could grant its Factory skin).

### Accessibility & cost

- The toggle is a labelled control with a persisted setting; announce the active
  style. Don't encode meaning *only* in the skin — values/equations (Tool 1) and
  belt encoding carry the real information either way.
- Factory art should respect the same palette tokens (`PALETTE` hex mirrors /
  `--r12/--r5/...` rails) — *do not hardcode new colors*; a buffer chest fills in
  the cap's existing cyan, a generator pulses the source's amber.
- Cost is bounded: ~9 new drawer functions, one map, one `style` param threaded
  into `drawGlyph` (and a matching label-style choice in `ComponentNode`). No sim,
  netlist, or boundary change. Determinism is untouched (art only).

### Recommendation + sketch

**Add `FACTORY_DRAWERS` and a global `style: "schematic" | "factory"` view flag;
default schematic; gate the Factory skins behind a per-part "used it" reveal
later.** Sketch:

1. **`glyphs.ts`**: add `FACTORY_DRAWERS` (same keys); change `drawGlyph(g, o)`
   to `drawGlyph(g, o, style)` (or read a module-level current style). Each
   factory drawer reuses the matching schematic drawer's state math (`norm`,
   `charge`, `cond`, `flow`) on a restyled body.
2. **`board.ts`**: `Board.setStyle(style)` stores it and passes it through
   `ComponentNode.update` → `drawGlyph`. Pin dots and meter are unchanged.
3. **`App.svelte`**: a toolbar toggle bound to a persisted `boardStyle` state →
   `board.setStyle(...)`.
4. **Reveal (later):** track per-kind "used in a working circuit" (the netlist
   already knows what's wired); unlock the skin and let the global toggle apply
   only unlocked skins.

**Do NOT** change pin geometry per style (wiring must stay identical — the whole
trick depends on shared `PART_KINDS` pins); **do NOT** fork the animation (reuse
`flow`/charge so belts behave the same); **do NOT** let styles mix per-part; **do
NOT** hardcode colors (use the tokens); **do NOT** make Factory the default
(teach the real symbol first); **do NOT** touch the sim/netlist (this is art).

---

## 3. Calculator / helper tools

**Goal.** Built-in calculators — **voltage divider**, **Ohm's law**, **RC/RL time
constant**, **reactance `Xc`/`Xl`**, **resonance `f₀`**, **RMS** — that ideally
**read from the selected components** (auto-fill `R1`/`R2` from a placed divider,
show the output node) and can **push a solved value back** onto a part via the
existing inspector. The hard constraint: it must **not become a cheat that skips
understanding** — it has to reinforce the teaching, not replace it.

### Which calculators are worth it

| Calculator | Worth it? | Why |
| --- | --- | --- |
| **Ohm's law** (V/I/R triangle) | yes | the atom; pairs with R's info card |
| **Voltage divider** `Vout = Vin·R2/(R1+R2)` | yes | the canonical first design task (the `divider` example) |
| **RC / RL time constant** `τ=RC`, `τ=L/R` | yes | makes the charge curve predictable; ties to `rc`/`rl` examples |
| **Reactance** `Xc=1/(2πfC)`, `Xl=2πfL` | yes (with AC) | the gateway to AC intuition (`ac-curriculum.md`) |
| **Resonance** `f₀=1/(2π√(LC))` | yes | the LC-tank payoff; one memorable number |
| **RMS** (sine ↔ RMS, P) | optional | useful once AC sources matter; lower priority |
| Power / energy | fold into Tool 1 | already instantaneous from `v·i`; not a standalone calc |

### Where they live + the three coupling modes

**Recommendation: a Calculators tab inside the info drawer (Tool 1)**, *not* a
free-floating palette. Co-locating them with the explanatory view is what keeps
them honest — the calculator sits next to the equation it embodies and the live
part it describes, so it reads as "the math you just learned, with a slot to try a
number," not a detached answer machine. Three escalating couplings:

1. **Standalone (always available).** Open the divider calc, type any `Vin/R1/R2`,
   see `Vout`. A scratchpad. Pure, no board link.
2. **Read from selection (the good magic).** With a relevant selection active,
   **auto-fill** from the board: select two series resistors → the divider calc
   pre-loads their `R`s and shows the *measured* mid-node voltage beside the
   *computed* one (read the mid node from the `electrical`/probe node map). Select
   an R+C → the RC calc fills `τ` and overlays "% settled" from the live cap
   voltage. This is the standout feature: **predict-then-reveal**, the deepest
   intrinsic hook in `game-factory-loop.md` §4 — the calc shows the formula's
   answer *and* what physics actually did, side by side, and they agree.
3. **Push back to a part (solve-for, then set).** Flip a calc to solve for an
   unknown (e.g. "I want `Vout = 3.3 V`, `Vin = 5 V`, `R1 = 1 kΩ` → `R2 ≈ 1.96
   kΩ`"), then a **"Set R2"** button calls the *existing* `setComponentValue`
   (snapped to the nearest standard E-series value via `nearestStandard`, exactly
   like the inspector's chips). One code path, already built — the calc just feeds
   it a number.

### Reusing what's already there

- **Selection + live state:** the `selPart`/selection set and the per-frame
  `electrical` map already say what's selected and its `V/I`; the calc reads them,
  no new plumbing. The probe's `pinNode`/node-voltage path (`board.ts`) already
  resolves a node's measured voltage for the "measured vs computed" overlay.
- **Push-back:** `setComponentValue` + `nearestStandard`/`stepValue` from the
  inspector (`App.svelte` `setVal`) are the write path — reuse verbatim so a
  solved value snaps to a real, buildable part value.
- **Formatting:** `formatValue` (component values) and `fmtSI` (live
  measurements) keep the calc's numbers consistent with the rest of the HUD.

### Keeping it from being a cheat (the design guardrails)

This is the crux. The calculator must **deepen** understanding:

- **Show the formula, always, with the substitution** — never just an output box.
  The calc *is* the equation from Tool 1 with editable terms; you can't get the
  number without seeing `Vout = Vin·R2/(R1+R2) = 5·1.96k/2.96k = 3.3 V`.
- **Lead with predict-then-reveal, not solve-for.** The primary mode reads the
  board and confirms physics; "solve-for-and-set" is secondary and explicitly
  framed as *design* (you still chose the topology and learned the relation).
- **Snap pushed values to standard parts** (E-series) — mirrors reality (you can't
  buy 1.96 kΩ), so the "answer" still requires the player to reason about
  tolerance and the nearest real value.
- **Tie unlocks to competency** (optional, `game-rewards.md`): a calc unlocks once
  you've built the thing once, so it's a power-tool you've earned, not a shortcut
  past the first encounter.

### Accessibility

- Calculators are **plain DOM forms** (labelled `<input>`s, real `<button>`s) — in
  the drawer, after the board in Tab order; the global key handler already
  early-returns on INPUT/TEXTAREA so typing a value never triggers Delete/R/Space.
- Each field labelled with its symbol *and* unit; results announced via the
  drawer's `aria-live` summary; the formula is selectable text.
- Don't gate meaning on color; "measured vs computed agree" must also read as text
  (a `✓ matches` chip), not just a green dot.

### Recommendation + sketch

**A Calculators tab in the info drawer, default to read-from-selection
(predict-then-reveal), with an explicit solve-for → `setComponentValue` push.**
Sketch:

1. **`web/src/lib/calc.ts`**: pure functions per calc (`divider`, `ohm`, `tau`,
   `reactance`, `resonance`, `rms`) — trivially unit-testable, no DOM.
2. **Drawer tab** in `App.svelte`: list relevant calcs for the current selection
   (e.g. show RC when an R and C are co-selected); pre-fill inputs from the
   selected components' `value`s and the live `electrical` map; render the
   substituted formula + result with `formatValue`/`fmtSI`.
3. **Measured overlay:** for divider/RC, read the relevant node voltage (probe
   node path) and show measured beside computed with a `✓ matches` / `Δ` chip.
4. **Push-back:** a "solve for X" toggle; the **Set** button calls
   `board.setComponentValue(id, nearestStandard(kind, solved))`.

**Do NOT** show a bare answer without the worked substitution (that's the cheat);
**do NOT** build a new value-write path (reuse `setComponentValue` +
`nearestStandard`); **do NOT** push un-snapped values (must land on a real part
value); **do NOT** put calculators in a detached floating palette (co-locate with
the equation + live part so they teach); **do NOT** add a sim/boundary read (read
the frame's `electrical` map).

---

## Prioritized build order (across all three)

1. **Component info drawer (Tool 1), headline layer only.** Highest teaching
   value per unit effort and the **foundation the other two lean on** (the
   equation + descriptor + drawer shell). Ship the side drawer, the per-kind
   descriptor table, the big reused-drawer diagram, and the "right now" sentence
   for the simulated primitives. ~Layer 1 of §1 alone is a complete, shippable
   win.
2. **Calculators tab in that drawer (Tool 3), standalone + read-from-selection.**
   Reuses the drawer shell and the same equations; the predict-then-reveal
   coupling is the strongest hook and needs only the selection + `electrical` map
   already in scope. Defer the solve-for/push-back to a fast follow.
3. **Info drawer depth (Tool 1 layers 2–3)** — derived quantities + the inline
   curve with the live operating point. Pure additive polish on an existing
   surface.
4. **Style toggle (Tool 2), global, default-schematic.** Most *fun*, most
   isolated (art-only, no shared dependency), and safe to land anytime — but it's
   game-feel, not comprehension, so it follows the teaching tools. Ship the
   `FACTORY_DRAWERS` map + toolbar toggle.
5. **Calc push-back + per-tier Factory reveal** — the "earn it / set it" loops
   that tie into `game-rewards.md`; do these once the economy/competency gates
   exist, since both want that hook.

**The thread:** Tool 1's drawer + descriptor is the spine — Tool 3 is a tab on it,
Tool 1's curve is a tap deeper, and Tool 2 is the independent fun lens that can
slot in beside any of them. Build the spine first; everything else hangs off it
and reuses the live `electrical` state, the glyph drawers, `formatValue`/`fmtSI`,
and the inspector's value-write path that already exist.

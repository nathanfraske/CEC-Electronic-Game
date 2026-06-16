# Part demos — the three fidelity tiers (schematic · analogy · reality)

Status: **refs + design landed; implementation starting** (2026-06-16). This is the
visual companion to the Ideal-vs-Real fidelity work (`docs/sim/ideal-vs-real-parts.md`).

## The idea

Every placeable part can be shown three ways, switchable, all **animating live with the
actual sim state**:

- **Tier 1 — Schematic.** The symbol on a wire — what the board draws today. The clean
  abstraction.
- **Tier 2 — Analogy.** An intuitive physical metaphor that builds a feel for what V / I /
  charge / flux *mean*: water forced through a narrow throat (resistor), a tank or a
  spring-loaded piston (capacitor), a heavy flywheel in a pipe (inductor), belted wheels or a
  shuttling strap (transformer).
- **Tier 3 — Reality.** What is *literally* happening in the device: electrons drifting and
  scattering off the lattice (resistor), etched foil + thin oxide + electrolyte (aluminium
  cap), interleaved electrodes + polarising ceramic (MLCC), a coil building a magnetic field
  (inductor), two windings driving flux around an iron core (transformer).

Two ways to reach them:

1. **Zoom all the way into a placed part on the board** → the glyph "opens up" into the tier
   view, running in real time on its live electrical state.
2. **Double-click → the info panel** shows the same (the existing info drawer).

## The refs (the design source)

The owner's interactive design sheets are in **`docs/ui/parts/`** — standalone HTML demos,
one per part: `resistor-tiers.html`, `capacitor-ceramic-tiers.html`,
`capacitor-electrolytic-tiers.html`, `inductor-tiers.html`, `transformer-tiers.html`. Each has
all three tiers, a tier switcher, live control sliders, a telemetry panel, and a scope. **They
are the authoritative visual + animation spec** — the implementation ports them into the app
faithfully. (More part sheets to come once this first batch is implemented.) Every numeric in
them is a free parameter for the game to drive; the demos hard-code example values, the app
feeds the live ones.

Shared design language across all five (mirror it in the port):
- Tokens are the app's: `--cyan` (voltage/positive), `--bronze` (coil/charge/flow), `--violet`
  (resistance/return), `--accent` (rose), `--warm` current-flow dashes, heat = bronze→red.
- Flow legibility: **density + alpha carry magnitude, never speed** (matches
  `docs/ui/visual-language.md` and the board's flow belts).
- Each sheet states what its ideal model omits (e.g. transformer: "magnetizing current,
  leakage, core loss left out"; electrolytic: "leakage, ESR, finite life left out") — those
  omissions are exactly the **Real-variant** parasitics from the fidelity ladder. The reality
  tier is where a player *sees* why a real cap has ESR or a transformer saturates.

## Data each tier needs

Per-part live state, all **derived from V across + I through** (which `electricalMap` already
gives us) plus the part value — **no new sim state, pure presentation, zero golden impact**:

- Resistor: power `P = V·I` → heat fraction vs. rating; the I–V line.
- Capacitor: `Vc`, charge `Q = C·V`, energy `½CV²`, time-constant `RC`, charge/discharge state.
- Inductor: `I`, coil voltage `V_L`, flux linkage `L·I`, energy `½LI²`, `L/R`.
- Transformer: `Vp/Vs`, `Ip/Is`, turns ratio, core-flux %/saturation (the magnetising flux
  we already integrate — see the energization transient discussion).

## What already exists (~70–80% — confirmed by the codebase map)

The three-tier system is **already built**, not a green field — the refs slot into it:

- **`web/src/lib/infoDiagram.ts`** — `InfoDiagram`, a small PixiJS sub-app.
  `setMode("schematic" | "analogy" | "reality")` + `setState(kind, electrical, value?, wiper?)`,
  driven every frame while the info drawer is open (`App.svelte` ~957).
- **Three drawer maps**, all the same `(g: Graphics, o) => void` shape:
  - `DRAWERS` — schematic symbols (`glyphs.ts`) — every part.
  - `FACTORY_DRAWERS` — the **analogy** ("Factory" machine-metaphor) (`glyphs.ts`) — 20+ parts.
  - `DETAIL_DRAWERS` — the **reality** internals (`detailDrawers.ts`) — **6 parts so far:
    `OA`, `D`, `SD`, `LED`, `ZD`, `R`** (op-amp/diode/resistor are full exemplars, themselves
    ported from this same kind of HTML ref).
- **Tier switcher UI** in the info drawer (`Symbol` / `Factory` / `Real` segmented buttons,
  `App.svelte` ~2216) auto-gates on `hasFactory`/`hasDetail`; `effectiveDiagramMode` clamps
  outward when a tier's art is missing.
- **Live + derived state**: `electricalMap` feeds `ElectricalState` (V, I) per frame;
  `partInfo.ts` computes the derived rows (power, energy, τ, operating region, …).
- **Port target — the detail-drawer pattern**: `drawDetail<Kind>(g, o: DetailOpts)` paints into
  a centred `bounds` (hw/hh), reads `o.electrical` + `o.phase`, uses helpers `belt` / `stud` /
  `housing` / `mix` / `norm`, recolours from `PALETTE` (no hardcoded colours), magnitude on
  alpha/density/thickness — never speed. Register in `DETAIL_DRAWERS` → the info panel
  auto-unlocks "Real". Pure presentation; no sim / netlist / golden touch.

So the five refs reduce to: **reality-tier drawers for `C`, `EC`, `L`, `TR`** (`R` already has
`drawDetailResistor` — diff it against the ref and enrich if the ref is richer), plus their
**Factory/analogy** drawers (verify each — `TR` may be missing), plus the new **board
zoom-to-reveal**.

## Implementation plan (phased)

1. **Port the reality tier** for the missing parts into `detailDrawers.ts`, one
   `drawDetail<Kind>` at a time, faithful to each ref's Tier 3 — order **inductor → ceramic cap
   → electrolytic cap → transformer** (resistor exists; revisit against its ref last). Register
   each in `DETAIL_DRAWERS`; the panel auto-unlocks it. Verify with `pnpm -C web check/lint/build`.
2. **Verify/port the Factory (analogy) tier** for these kinds against each ref's Tier 2 (water
   throat / tank+piston / flywheel / belted wheels). Most exist; fill gaps (esp. `TR`).
3. **Board zoom-to-reveal** (the new mechanic): there's no component LOD swap today. Hook
   `Board.update()` at `world.scale ≥ ~3` with a single selected part → render the detail drawer
   in place of the glyph (LOD swap) so you literally "zoom into the part and watch it work." (The
   simpler fallback is an `onZoomDetail` callback that auto-opens the info drawer.)
4. **Polish**: telemetry + tier switcher on the board at high zoom; smooth glyph→detail fade.
5. **Next batch** of part sheets once these five land.

## Architecture notes

- The refs are intricate **SVG** animations driven by a per-frame update. Port them as an
  SVG-based view driven by `setState` — closest to the spec, easy to mount in the info panel,
  and (for the board zoom-reveal) cheap as an HTML/SVG overlay positioned over the zoomed part.
  A PixiJS re-port can come later only if perf demands it; the glyphs stay Pixi.
- Keep each part's tier drawing in its own module (e.g. `web/src/lib/tiers/<kind>.ts`) behind
  one `TierView` interface, so adding the next batch is "drop in a module."
- **Determinism:** entirely presentation — no sim element, no netlist, no golden touch.

See also: `docs/sim/ideal-vs-real-parts.md` (the fidelity gradient these tiers visualise),
`docs/ui/visual-language.md` (flow/colour rules), and the five refs in `docs/ui/parts/`.

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

## Existing scaffolding (to extend, not duplicate)

`web/src/App.svelte` already has an info-panel diagram: an `infoDiagram` object
(`setMode(...)` / `setState(kind, electrical, value, wiper)`), `hasDetail` / `hasFactory`
kind flags, and a `diagramMode` / `effectiveDiagramMode` (schematic vs. "reality"). The
three-tier system **extends this** — adding the analogy tier and the richer reality tier from
the refs, reusing the per-frame `setState` feed. *(A background agent is mapping the exact API
+ renderer; integration specifics land from that map.)*

## Implementation plan (phased)

1. **Map the existing `infoDiagram` / factory system** (in flight).
2. **One component as the pattern — the resistor**, ported into a reusable, live-wired tier
   view mounted first in the **info panel** (the existing mount point). Establish a `TierView`
   that takes `(kind, tier, live)` and animates the three tiers from the ref. This is the
   template the other four follow.
3. **Tier switcher** (schematic / analogy / reality) + the **live per-frame feed** (from
   `electricalMap` + the derived quantities) wired into the panel.
4. **Board zoom-to-reveal.** When zoomed past a threshold onto a single selected part, render
   its `TierView` in place of the glyph — an LOD swap in `board.ts` keyed off `world.scale`.
   Pure presentation; the glyph and the tier view share the same live state.
5. **Port the remaining four** (ceramic cap, electrolytic cap, inductor, transformer) onto the
   same `TierView` pattern.
6. **Polish:** smooth glyph→tier transition on zoom, the on-board tier switcher, a telemetry
   overlay, and (later) the next batch of part sheets.

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

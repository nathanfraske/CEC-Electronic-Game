# ADR 0005: Sealed sub-circuits and the zoom-to-open ("mini-mode") view

Status: proposed — design pass (no code yet). Phased build path below; phase 1 is renderer-only and
golden-trivially-safe.

## Context

We now have a library of teaching ICs built two ways:

- **Compositions** (`CEC_COMP` in `web/src/lib/netlist.ts`): half-adder, full-adder, mux, demux,
  majority, SR/D latch, JK flip-flop, tri-state — and the R-2R **DAC**. `buildNetlist` **already
  expands** each placed chip into its real discrete elements (powered `ELEM_GATE`s, an `ELEM_DFF`,
  resistors), so the **solver runs the genuine sub-circuit**; the single "chip card" the board draws is
  *only* the rendering. The expander already records the mapping: `elemOfComponent`, `legsOfComponent`,
  `nodesOfComponent`, and the private internal nodes from `cecInternal`.
- **Behavioral blocks** (`ELEM_BEHAVIORAL` programs, ADR 0004): SPI/UART/LUT, flash ADC, SAR ADC,
  sigma-delta, counter. Each is **one element** running integer firmware — there are no discrete
  internals inside to reveal.

Teaching abstraction already exists at two layers: the **five-tier IC glyphs** (standalone HTML
refsheets in `docs/ui/parts/`, symbol -> flow -> valves -> device -> silicon) and the **in-game info
drawer** (`infoDiagram.ts`, the `schematic` / `analogy` / `reality` tiers over `DRAWERS` /
`FACTORY_DRAWERS` / `DETAIL_DRAWERS`). `docs/ic-buildings-ideation.md` §2.3 designs the **seal mechanic**
(Tier C: build from discretes -> verify a spec -> seal into a chip) and parks the keystone question: a
sealed block must replay byte-identically.

Owner's ask (the trigger for this ADR): a **"mini-mode"** — remake some ICs as full discrete circuits and
**seal them into a black box you can zoom into on the board**, where zooming reveals the analogy view and,
deeper, **all the components running live, exactly as if you had built the full circuit**.

## Decision

Adopt **seal-as-the-same-netlist** as the spine, surfaced by a **zoom-to-open** board view.

1. **The seal is a rendering, not a second model.** A sealed composite is ALWAYS simulated as its
   discrete expansion (the `CEC_COMP` path we already trust). "Sealed" = draw the collapsed chip card;
   "opened" = draw that same instance's live internal sub-circuit. Same netlist, same solve, same hash —
   **zero approximation gap, zero determinism risk.** This is the most faithful reading of "works exactly
   as if you built the full circuit," and it is a generalization of the expander we already ship.

2. **Zoom-to-open is (almost) entirely web-side; sim-core is untouched.** The sim already solves the real
   elements, and the web already holds the per-frame snapshot (node voltages via `state()`, element
   currents via `element_currents`). To draw a chip's live internals the renderer needs only its
   **topology + node/element index ranges**, which `buildNetlist` already computes during expansion — it
   just doesn't keep them all. The one addition is recording, per composite component, the full set of
   its sub-element indices, its internal+pin node indices, and the sub-gate descriptors (func +
   terminals), into the built netlist for the renderer to walk. **No sim-core change, no new hashed
   state, golden trivially safe.**

3. **Three IC classes, three behaviours under the zoom:**
   - **Compositions (gate ICs, DAC)** — live-zoomable *today*. Opening shows the real gates/resistors
     animating from the live snapshot. The target of phases 1-3.
   - **Behavioral blocks (ADCs, sigma-delta, counter, serial)** — no discrete internals exist. Two
     honest options per part: (a) keep behavioral and let the zoom show the **five-tier glyph art**
     (conceptual internals, not a live discrete sim); or (b) **remake the part as a composition** where a
     live circuit is worth the determinism cost (e.g. flash ADC -> comparator bank + reference ladder +
     priority encoder). Per-IC owner choice (phase 4).
   - **Analog macro-models (op-amp, Tier B)** — opening shows the transistor-level model with the honest
     **macro-vs-real gap**; re-opening to the full discrete netlist is a separate, heavier sim the player
     chooses (the documented third-decimal difference, `ic-buildings-ideation.md` §2.3).

4. **Build-and-seal authoring (Tier C proper)** — select a sub-circuit you built, name its pins, verify a
   spec at those pins, and collapse it into a reusable sealed part (a player-authored `CEC_COMP`-style
   entry). The *earn-condition* (when a player may seal) is owned by `game-rewards.md` /
   `game-contracts-economy.md`; this ADR owns the *mechanism* and the *determinism rule*. Deferred to the
   last phase — the built-in compositions get the seal/zoom rendering first.

## Determinism guarantees (the contract this preserves)

- **Sealed and opened are the same netlist** -> byte-identical solve and `snapshot_hash`; the golden is
  untouched (no sim-core change in phases 1-3).
- The **internals the renderer reads are read-only** (node voltages + element currents already in the
  snapshot) and are **never folded into the hash**.
- A sealed composite's hash contribution is, as today, exactly its expanded elements' — a pure function
  of inputs, internal state, and the tick (ADR 0004's rule), **never** a recorded approximation.
- **Macro-model seals** (nonlinear analog only, opt-in) are deterministic parameter fits; re-opening to
  the discrete netlist is a distinct sim, so the small divergence is a chosen feature, not a hash break.

## Phased build path (dependency order)

1. **Composite-internals topology in `buildNetlist`** (web): record per component its sub-element index
   range, internal/pin node indices, and sub-gate descriptors. Additive, unhashed, golden-safe.
2. **Zoom-to-open renderer** (web/PixiJS): a composite expands in place to draw its live sub-circuit,
   reusing the board glyph drawers for the sub-elements and the live snapshot for animation. **Prototype
   on the half-adder** (smallest gate net) and the **R-2R DAC** (the analog case).
3. **Generalize** across all `CEC_COMP` parts; wire the zoom levels to the existing abstraction ladder
   (the `schematic`/`analogy`/`reality` info-drawer tiers and, long-term, the five-tier glyph art) so one
   gesture walks black-box -> analogy -> live discrete.
4. **Remake selected behavioral ICs as compositions** for live zoom (owner-chosen; flash ADC the likely
   first — it has a vivid discrete form). Each remake is an ADR-0004-style golden check.
5. **Build-and-seal authoring** (Tier C): the player-built, spec-verified, collapsed sealed part — the
   full **IC maker** (arbitrary sub-circuits, user-defined pinouts, package formats) is specified in
   **ADR 0006**.

## Notes

- The five-tier glyphs are the *authored* abstraction; zoom-to-open is the *live* one. They converge
  long-term (the glyph tiers become the in-board zoom levels), but they ship independently.
- Keep the JS<->wasm boundary coarse (ADR 0001): one batched snapshot read per frame still feeds the
  opened chip; the renderer indexes into it — no per-sub-element crossings.
- This ADR makes `ic-buildings-ideation.md` Tier C concrete in light of what we have actually built; the
  ideation doc's fidelity ladder (A behavioral / B macro-model / C sealed) is unchanged and still owns the
  per-IC tiering rationale.

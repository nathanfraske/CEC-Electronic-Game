# Interaction model — fixing the Select / Place / Wire mode flow

Status: **design / backlog** (from a brainstorm). The current board uses four
explicit modes (Select / Place / Wire / Measure) chosen from a toolbar, which is
clunky — you keep switching modes to do different things. This is the plan to fix
it. Implement in phases; Phase 0 is small and mostly deletes UI.

## Recommendation (the scheme to ship)

**One contextual "Build" mode that absorbs Select + Place + Wire, driven by an
"armed part" state and hover context — plus Measure as the one explicit tool.**

The board's `select` path already does selecting, wiring, moving, and panning;
the mode buttons mostly exist to gate placement. Replace them with an armed-part
state (set by clicking/dragging a bin row), context-driven pointer behaviour, and
a Measure toggle. The core loop becomes Factorio-like: *arm a part → click-click
to place → Esc → drag pin-to-pin to wire → chain a rail* — never touching a mode
button.

## The context table (the whole design in one grid)

| Pointer over… | No part armed — click | No part armed — drag | Part armed |
| --- | --- | --- | --- |
| **Empty cell** | clear selection | **pan** (Shift-drag = box-select) | **place** part, stay armed |
| **Pin** | start a wire (→ click target pin) | start wire, rubber-band | place suppressed → wire-start |
| **Body** | select (Shift/Ctrl add) | **move** (whole selection) | place suppressed → select/move |
| **Wire** | select the wire | — | place suppressed → select |
| anywhere | right-click = delete under cursor | middle-drag = pan | Esc / right-click = disarm |

### The two real ambiguities, resolved
- **Drag-from-empty = pan vs box-select** → plain drag pans (the frequent need);
  **Shift-drag** box-selects; **Space-drag** always pans (escape hatch).
- **Click-empty while armed = place vs deselect** → armed wins (drops the part);
  Esc disarms.

## The "armed part" model (replaces Place mode)
- **Arm** a part by clicking a bin row (or `1`–`9`); a translucent **ghost** of
  the part snaps to the grid cell under the cursor (the biggest discoverability
  win — you *see* you're placing).
- **Place & repeat:** click drops and stays armed (carpet the board).
- **Disarm:** Esc or right-click.
- **Pipette (`Q`):** hover an existing part, press Q → arm that kind.
- Drag-from-bin stays a one-shot place; click-bin-row arms for repeat.

"Place mode" was only ever "a part is selected AND clicks should drop it" =
`armed != null`. With the ghost + place-and-repeat there's no reason for a mode
button, and wiring coexists for free (armed → place; not armed → select/wire by
context).

## Wiring (the fiddliest part) — click→click, chained
Support both drag-to-wire (exists) and **click pin → click pin** (easier on long
runs/trackpads), with the in-progress wire rubber-banding to the cursor. After a
wire completes, **stay hot from that net** so the next click extends the chain
(daisy-chain a ground rail). Esc/right-click ends the chain. Pins **highlight on
hover** with a snap-ring so the target is obvious.

## Measure — keep as a tool
It changes the meaning of the whole canvas (clicks drop/grab probe leads), it's a
real-world metaphor ("pick up the multimeter"), and it's occasional. Present it as
a distinct toggle (`M`), not a peer in a 4-mode control. Entering it disarms any
part; exiting returns to Build.

## Hotkeys
`1`–`9` arm bin slots · `Esc` universal cancel (disarm → cancel wire → clear
selection) · `Q` pipette · `Del` delete · `R` rotate · `Space`-drag pan · `M`
measure · `F`/`0` fit view.

## Discoverability (so modeless stays learnable)
Per-context **cursor**, the armed **ghost preview**, **pin hover-snap**, an
**armed-part chip** (with ×), and a one-line **contextual hint** (e.g. `Placing
RESISTOR · click to drop · Esc to cancel`, `Click a pin to start a wire`).

## Migration — smallest path first

**Phase 0 — collapse to two states (small, high payoff)**
1. Replace the 4-button control with **Build (default) + Measure toggle**; keep
   the `Mode` type internally but only set `select`/`measure`.
2. Add `armedPart: string | null` in `App.svelte` (reuse the active-part state);
   clicking a bin row arms it, Esc/right-click clears it.
3. In `board.ts onPointerDown`, replace the `place` early-return with: *if armed
   and over empty cell → place + stay armed*. Wire/move/select/pan already run in
   the `select` path.
4. Wire Esc: disarm → cancel wiring → clear selection.

*After Phase 0 it already feels modeless.*

**Phase 1 — feedback:** ghost preview, pin hover highlight + per-context cursor,
contextual hint line, armed-part chip.

**Phase 2 — speed:** click→click + chained wiring, `1`–`9` hotbar + `Q` pipette,
Shift-drag box-select, Space-pan. (`R` rotate already shipped.)

**Cleanup:** once nothing sets `place`/`wire`, retire those `Mode` variants (keep
`wire` internally as the transient wiring state if convenient).

<!--
  SPDX-License-Identifier: Apache-2.0
-->

# Inspector popup — design note (draft)

Status: **design / brainstorm** (owner-driven). The value Inspector (see
`value-picker.md`) today lives in the right-hand **Telemetry** panel. The owner
finds it clunky and disconnected from the part. The fix: clicking a component
opens a small **floating popover anchored above that component on the board**,
where you set its value. Same controls, new home.

The whole problem is one sentence: **the part lives in world space; the popover
is a screen-space DOM node.** So the popover must be positioned from a
world→screen projection and must track (or close on) pan / zoom / drag.
Everything below follows from that.

References: `web/src/App.svelte` (current inspector markup + `selPart`, `fmtVal`,
`setVal`, `stepVal`, `setSig`, `setDecade`, the chips / stepper / "more values"
disclosure, `onSelect`); `web/src/lib/board.ts` (`onSelect`/`emitSelect`,
`SelectedPart`, `componentBox`, `screenToWorld`, the per-frame `update()`).

---

## 1. Anchoring & projection

The board renders into a transformable `world` Container. A world point projects
to a screen (canvas-local) point with the same affine the board already uses
everywhere (`onWheel`, `screenToWorld` inverted):

```
screenX = world.position.x + worldX * world.scale.x
screenY = world.position.y + worldY * world.scale.x   // uniform scale; .x === .y
```

`componentBox(c)` already gives the world-space bounds of the selected part.
Project its `(x, y, width, height)` corners through the above to get a
**screen rect** for the part. The popover anchors to the **top-center** of that
rect.

**Recommendation: a per-frame board→HUD callback that emits the selected part's
screen rect** — `onAnchor?: (rect: DOMRect | null) => void` — not a one-shot
position captured at select time.

- **Per-frame rect (recommended).** The board already runs one `update()` per
  frame and already redraws the selection box there. Computing one rect and
  firing one callback when it changes is negligible, and it makes the popover
  *follow* the part through pan, zoom, and drag for free — the popover stays
  glued to the component, which is exactly the "direct, attached to the part"
  feel the owner wants. `null` when there is no single selection (tears the
  popover down).
- **One-shot position (rejected).** Capturing screen XY once on select is less
  code, but the popover then floats away from the part the instant the user pans
  or zooms, and we'd have to *close* it on any view change to avoid lying. That
  is the disconnected feeling we're trying to kill. Only worth it if per-frame
  churn ever shows up in a profile (it won't at this scale).

**Tracking on pan / zoom / drag.** With the per-frame rect, all three "just
work": the rect is recomputed from live `world.position`/`world.scale` and live
`c.cell`, so the popover slides and rescales with the board. The popover itself
does **not** scale (it's a fixed-size HUD chrome element); only its *anchor point*
moves. To avoid layout thrash, only fire `onAnchor` when the rounded rect
actually changes, and write the popover's `left/top` via a `$derived` from the
rect (Svelte 5 runes), letting the browser composite it.

---

## 2. Placement logic (flip / clamp / caret)

Default placement: **above** the component, horizontally centered on the part,
with a small gap (~10px) and a **caret/connector** pointing down at the part so
the link reads unambiguously.

Clamp/flip against the **`.board-frame`** rect (the popover's positioning
context), not the viewport:

- **Top edge:** if the popover's top would cross the frame top (part near the top
  of the board, or zoomed so the part sits high), **flip below** the part; move
  the caret to the top edge pointing up.
- **Left / right edges:** keep the popover centered on the part, then **clamp**
  its `left` into `[pad, frameWidth - popoverWidth - pad]`. The caret stays
  pointing at the part's center even when the body is clamped (caret offset =
  `partCenterX - popoverLeft`, itself clamped to the popover's rounded width so
  the arrow never detaches from the body).
- **Never cover the part.** Above/below flip already guarantees this vertically;
  horizontal clamp keeps the body on-frame. If the part is so large on screen
  that no placement clears it (extreme zoom-in), prefer **above, clamped**, and
  accept slight overlap of the part's outer glow — the value readout still shows
  on the part itself.

**Z-order:** above the canvas, **below modals** (the guided-build overlay, intro
banner, any future dialog). Concretely: a sibling of `.board-canvas` inside
`.board-frame`, with a z-index under `.guided-overlay`/`.intro-banner`. It must
not eat board pointer events outside its own box — the popover is a small island;
clicks elsewhere fall through to the canvas (which is how click-away closes it,
§3).

---

## 3. Open / close model

**Open** when selection becomes exactly **one component and zero wires** — i.e.
`emitSelect` produces a `single`. This is already the precise condition that
gates today's panel inspector; reuse it verbatim. Non-valued kinds (`GND, D, Q,
&, FF, FP, uC`; `unit === ""`) **do not open a value popover** — they have no
value to set (an identity-only popover is noise; show nothing, same as today).

**Close** on any of:

- **Esc** — the global key handler already maps Esc to `board.escape()`, which
  clears the selection → `onSelect` fires with no `single` → popover closes. No
  new wiring needed; it falls out of the selection contract.
- **Click-away / deselect** — clicking empty board clears selection (same path).
- **Selection changes to another part** — the popover **moves** to the new part
  (re-anchors) and **resets** its local `showMore` disclosure. It does not
  close-then-reopen; treat it as a re-target so it feels continuous.
- **Starting a wire or a drag** — dragging a pin (`wiring`), dragging the part
  (`dragging`), or dragging a wire (`wireDrag`) should **close** the popover for
  the duration of the gesture. A popover hovering over a part you're actively
  dragging is visual clutter and an accidental click target.
- **Entering Measure** — `setMode("measure")` is a different task entirely;
  close the popover.

**The drag question (decide explicitly): dragging the part CLOSES the popover,
and it reopens on drop.** Rationale: a popover that *follows* a fast component
drag is jittery and competes with the user's pointer; the cleaner feel is "grab
the part → popover gets out of the way → drop → popover snaps back above the new
position." Because the part is still selected after a move (the board keeps the
selection), reopening on drop is automatic — the per-frame rect resumes, so we
just need a `dragging`/`wiring`/`wireDrag` "interaction in progress" flag that
suppresses the popover while any is non-null. (If a future playtest says
following-on-drag feels better, the per-frame anchor already supports it — flip
the flag off for `dragging` only.)

---

## 4. Contents & sizing

**Reuse the existing inspector body wholesale** — chips + −/+ stepper + "more
values" disclosure (decade × significand for E-series, flat curated list
otherwise). Same `fmtVal` / `setVal` / `stepVal` / `setSig` / `setDecade`, same
`.chip-val` / `.insp-step` / `.insp-more` classes. This is a **relocation**, not
a redesign of the picker — `value-picker.md` still owns the picker's content
decisions.

- **Compact by default.** Header (part name + solved value via `formatValue`),
  one row: `−` · horizontal chip strip · `+`. Target width ~240–280px so it sits
  over a part without dominating the board.
- **"More values" grows downward, bounded.** The disclosure adds the
  decade/significand chip grids (`.insp-chips.wrap`). Cap the expanded popover
  height (e.g. `max-height: min(60%, 360px)` of the frame) and let the chip area
  scroll inside that cap, so opening it near the bottom of the board can't push
  the popover off-frame. Re-run the flip/clamp (§2) when the size changes so the
  grown popover re-seats (a tall expansion near the board bottom should flip to
  open upward).
- **Keyboard access.** The global key handler **early-returns on INPUT /
  TEXTAREA** — keep any text entry inside the popover an `<input>` so board
  shortcuts (Delete, R, arrows, space) don't fire while typing. The chips and
  stepper are real `<button>`s → Tab/Enter/Space work for free; ensure the
  popover is in DOM order right after the canvas so Tab reaches it naturally.
  Esc closing (§3) gives a no-mouse exit.
- **Look.** Match the existing floating chrome: `backdrop-filter: blur(3px)`,
  `oklch(0.165 0.028 285 / ~0.92)` surface, `1px solid var(--accent-line)`
  border, small radius, soft accent glow — i.e. the `.guided-overlay` /
  `.intro-banner` recipe, tinted like the current `.inspector` (`--accent-soft`
  / `--accent-line`). Caret is a small rotated square in the same surface+border.

---

## 5. What stays in Telemetry / migration

**Remove the value inspector block from the Telemetry panel** (the
`{#if selPart && hasValue(...)}` `.inspector` section). It moves wholesale into
the popover; keeping both is redundant and re-introduces the disconnected panel
the owner dislikes.

**Keep in Telemetry:** the determinism/snapshot/tick/sim-time readouts and the
**Nodes** scope-control list (visibility, rename, expand scope) — those are
board-wide telemetry, not per-part editing, and have no natural anchor on a
single component.

**Migration is low-risk** because the data contract is unchanged: `selPart` (the
`SelectedPart` from `onSelect`) still drives the controls; only the markup's
*location* and *positioning* change. The new piece is the **screen-rect anchor
signal** from the board. Build the popover as a sibling component fed by
`selPart` + the anchor rect, delete the panel block, and the picker logic is
untouched.

---

## 6. Recommendation + implementation sketch

**Ship the per-frame anchored popover.** It's the only option that delivers the
"attached to the part" feel through pan/zoom and keeps the picker logic intact.

**Sketch**

1. **`board.ts` emits the anchor.** Add `onAnchor?: (rect: DOMRect | null) =>
   void` to `BoardCallbacks`. In `update()` (after the selection redraw),
   compute it:
   - If exactly one valued component is selected and no in-progress gesture
     (`dragging`/`wiring`/`wireDrag`/`panning` all null) and mode is not
     `measure`: take `componentBox(c)`, project its corners with
     `pos.x + world.position.x ... * world.scale.x` (the same affine `onWheel`
     uses), build a screen-space `DOMRect`, and fire `onAnchor(rect)` **only
     when the rounded rect changed** (cache the last one).
   - Otherwise fire `onAnchor(null)` once (and clear the cache).
   - This rides the existing once-per-frame boundary — no new loop, no per-frame
     allocation beyond one small rect.
2. **`App.svelte` positions the popover.** Add `let anchorRect =
   $state<DOMRect | null>(null)`; set it from `onAnchor`. Render the popover as
   an **absolutely-positioned** element inside `.board-frame` (which is already a
   positioned `role="application"` container), shown when `anchorRect &&
   selPart && hasValue(selPart.kind)`. Compute `left/top` with a `$derived` that
   applies the flip/clamp math against the frame's size (read once via
   `bind:clientWidth/clientHeight` on `frameEl`, or `frameEl.getBoundingClient
   Rect()` cached on resize).
3. **Edge-flip math (in the `$derived`):**
   ```
   const cx = rect.left + rect.width / 2;              // part center, frame-local
   let left = clamp(cx - popW / 2, PAD, frameW - popW - PAD);
   const above = rect.top - GAP - popH;                // try above
   const placeAbove = above >= PAD;
   let top = placeAbove ? above : rect.bottom + GAP;    // else flip below
   const caretX = clamp(cx - left, CARET_R, popW - CARET_R);
   const caretSide = placeAbove ? "bottom" : "top";
   ```
   (`popW`/`popH` from the rendered popover; measure after mount or use fixed
   width + measured height. Re-evaluate when `showMore` toggles.)
4. **Reset `showMore` on `selPart.id` change** so a fresh part opens compact.
5. **Delete** the Telemetry `.inspector` block; move its `<style>` rules into the
   popover's styles (rename to `.insp-popup …` if it helps), add the floating-
   chrome surface + caret.

**Do NOT**

- **Do NOT** render the popover *inside* the PixiJS `world` / canvas. It is DOM,
  HUD-layer chrome; the canvas stays Pixi-only. (Keeps the JS↔wasm and
  Pixi/DOM boundaries clean.)
- **Do NOT** add a second JS↔wasm or per-component boundary crossing. The anchor
  is computed from already-available `world` transform + graph state in the
  existing per-frame `update()`. No new reads.
- **Do NOT** scale the popover with `world.scale` — only its anchor moves;
  chrome stays a constant, readable size.
- **Do NOT** capture a one-shot position and leave it stale on pan/zoom — that
  recreates the disconnected feel.
- **Do NOT** open the popover for multi-select, wire selection, or non-valued
  kinds (`unit === ""`). Reuse the existing `single` gate exactly.
- **Do NOT** let the popover swallow board pointer events outside its own box, or
  block Esc/Delete/arrow shortcuts — keep text entry in `<input>` so the global
  key handler's INPUT early-return protects typing.
- **Do NOT** position against the viewport; clamp against `.board-frame` so the
  popover can't escape the canvas or collide with the side panels.
- **Do NOT** duplicate the picker — keep one source of the chips/stepper/"more
  values" logic; this note only changes *where* it renders.

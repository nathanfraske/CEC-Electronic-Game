# All-ages device-editing design brief — "The Chip Bench"

> Output of a six-seat game-design panel (early-childhood 5–8, tween builders 9–13,
> teen power-creators 14–22, adult casual, older-adults/accessibility, learning-science),
> a director synthesis, a per-seat stress-test of that synthesis, and a final director
> revision. Goal: let a player edit a PLACED chip (box borders + pin placement + add/
> remove/rename/role + inner circuit) directly in the board overworld, graspable by a
> 6-year-old AND a 70-year-old AND a teen power-builder. Captured here so the design
> survives the session; reconcile with `docs/ui/accessibility-and-reach.md` on the 44px
> number (see §8.1).

**North star:** *One handle that deepens — the same tap a 6-year-old uses to fatten a
chip's pins is the one a teen uses to rewire its silicon. The box is the package, the
pins are leads, and every edit teaches "pinout is a choice within a real frame," never
configures a falsehood.*

---

## 0. What this is, and what it is NOT (read first)

This brief defines a **single, all-ages affordance for editing a placed chip in the overworld**. It is **additive**. It does **not** replace the existing EDA-lite toolkit on the live board — hotbar slots `1-9`/`Shift`, `Q` pipette, marquee multi-select, arrow-key cell nudge, `R`/`F` rotate/flip, `Ctrl+C/X/V`, KiCad click-to-continue wiring, and the `B/W/J/L/M` tool hotkeys **all stay live** while a chip is bloomed. The bloom adds touch/low-vision-friendly handles and a teaching layer on top of those verbs; it removes none of them.

> **Engineer's one-sentence contract:** the bloom is a selection-scoped overlay of focusable, ≥44px-on-screen handles bound two-way to the chip's geometry and pinout; the keyboard/marquee tool underneath keeps working unchanged.

## 1. The Spine — "You can always do this" (every age, every session)

**Activate edit on a placed chip → its pins bloom into fat, glowing beads on the package rim, the chip lifts on a soft shadow, the board dims/desaturates, a name ribbon appears, and the chip eases-zooms to fit so every bead is finger-big immediately.** Activation is reversible and announced (§3). The first activation already *does something visible* — never a dead "select."

Activation paths (all equal): tap the chip (pointer); focus the chip + `Enter`/Space (keyboard/switch → announces *"Editing chip NAME — 5 pins."*).

From that one state — **no modifier, no double-click, no Esc-to-commit** — anyone can:
- **Grab a wall or corner** → expandable package stretches like jelly (bounces at a floor, can't invert); fixed package resists with a firm "standard body" bounce (§5).
- **Grab a pin-bead** → slide along the rim; cross a corner and it *wraps* onto the next edge. What a bead-drag does is owned by the current MODE (§2), not by aiming at a sub-ring.
- **Drag a bead off the box** → spring-back (never a silent delete).
- **Drag a bead out of a glowing `+` well** → a new pin is born as an unmistakably inert no-connect (hollow/outline, dashed tether) until a wire lands and it "fills in" with a felt click.
- **Drag a bead into the trash-can** (mouth opens as it nears) → pops away; drag back to cancel.
- **Open a bead's role picker** (explicit affordance, not a bare tap — §3) → a radial of big, ≥44px, well-separated role stamps. The bead gets a permanent role BADGE; its live fill still shows voltage (§4).
- **DONE** (big check) to shrink back, or **UNDO** (big curved arrow). Both always-visible, focusable DOM buttons. Click-away = DONE (gentle shrink, never silent commit).

Honest-electronics guardrails are in the spine: pins live only on the perimeter; the box can't orphan a pin (it rides the corner); resize/move route incident wires **live** so cause is fused to effect.

## 2. One mode bit, made loud — WIRE vs SHAPE

A bead-drag has two possible meanings (move pin / start wire). **Decision: a single visible skinned MODE toggle owns it; concentric hit-rings are CUT.**
- **SHAPE** mode → a bead-drag always **moves** the pin (whole bead is the target).
- **WIRE** mode → a bead-drag always **starts a wire**.
- Shown as a skin (tint + faint blueprint grid in SHAPE) with a visible toggle; **auto-set to SHAPE on entry** (geometry-first), so a casual adult never *sets* a mode before their first drag, only *flips* it to wire.

Why the toggle, not rings: concentric targets a few px apart on a 16-pin chip are a trackpad/tremor/fat-finger lottery — every fine-placement seat rejected them. One meaning per mode + whole-bead target is the mode-free-*per-gesture* answer that also **kills the `Alt`-drag pain** the owner flagged. The toggle is one loud bit defaulted to the verb you entered for — not a hidden trap — and `Q`/marquee/hotbar still work across it.

## 3. Probe vs Edit — tap never arms a change

A bare tap on a bead must never open a commit-y menu.
- **Tap a bead** → read-only popover: name, role swatch+icon, one-line legend (*"drag to move · tap the role chip to change its job"*). Poking to learn changes nothing.
- **Change role** → tap the role chip on that popover (or long-press the bead) → the radial. Dismiss by tapping elsewhere — a first-class no-consequence dismiss, visually distinct from DONE.
- **Rename** → opt-in pencil; never required (role-by-icon carries identity).

Entry is as calm/reversible as exit. Under `prefers-reduced-motion` the bloom is an instant static state swap. A stray activation is undone by one `Esc`/DONE with nothing committed.

## 4. ROLE is not VOLTAGE — two honest channels (every seat caught this)

`voltageColor` (`boardRender.ts`) is keyed on **live net voltage** (−48…+230 V interpolated), not role. "Stamp a role → bead recolors to the bench wire code" teaches **role causes color**, which silently inverts the moment the pin is wired (a "ground"-stamped bead on a 5 V net turns red). **Vetoed.** Split the channels permanently:

| Channel | Surface | Meaning | Changes with voltage? |
|---|---|---|---|
| **Role** | a fixed **icon/badge ON the bead** (plug=power+, earth-peg=ground, arrow-IN, arrow-OUT, pulse=clock, hollow=no-connect) | what I MEANT this lead for | **Never** |
| **Live value** | the bead's **fill / wire / standpipe** via `voltageColor` | what voltage is HERE now | Yes |

The child learns the true pair: **the badge says what it's *for*; the glow says what's *happening*.** A just-tapped unpowered chip shows role **badges** (from `pinout.ts` glosses) even though every fill is `0V` grey — identity comes from the badge, not color. Input/output/clock are **directions** (arrow/pulse glyph), they do not fake a voltage; a pin inherits a `voltageColor` fill only once wired to a net that has one.

## 5. Honest packages — the box is not putty

`packages.ts` defines `DiePolicy: "fixed" | "expandable"`. A jelly box that always stretches teaches "a chip is arbitrary putty" — wrong, and must be un-taught later. Make the constraint physical:
- **Expandable** → free jelly-stretch + free along-edge pin placement.
- **Fixed** → box resists resize with a felt "standard body" bounce; pins snap only to the real standardized slots (including a SOT-23-5's genuinely-empty top-middle slot). The **ghost pin-pitch slot scaffold** is promoted to the always-on substrate for fixed packages (that ghost grid *is* the pin-pitch lesson); a toggle on expandable bodies.

**Resize preserves deliberate layout:** dragging a wall keeps each pin's along-edge cell (match `clampPinToBox` — only re-home pins that would fall off a shrunk wall). Auto-even-spacing is never a silent consequence of a drag; it's an explicit, undoable **"Distribute evenly"** command.

## 6. Progressive-disclosure layers (precision layers in, never a separate mode)

- **Layer 0 — Bloom (the spine).** The floor the whole feature clears.
- **Layer 1 — Keyboard / focus parity (ships in Phase 1).** Every draggable gets a real DOM focusable proxy over the canvas (the canvas is `role="application"`; pins are PixiJS primitives with no focus tree — **net-new infra, built first**), each with a visible ≥3px ≥3:1 focus ring (audit the blanket `:focus-visible{outline:none}`). Arrow-key collision resolved: a focused bead/handle captures Arrow = move-this before `board.nudge()`, with the active meaning always shown; `Shift+Arrow` = hop-edge; `Enter`/`F2` rename; `R` cycle role. Edit-ability is decoupled from camera zoom (zoom may grow target *size*, never *gate* grabbability via keyboard/panel).
- **Layer 2 — The precise companion** (chevron slides it out; collapsed by default). Two-way bound. Box **W×H as numeric fields + ± steppers** (the read-only `{w}×{h}` die-bar label becomes editable). Pin list with `name · Where (edge+index) · Job (role icon+word)`. **Multi-select first-class** (marquee the rim → one role-stamp/distribute/mirror/nudge to the set; `D0..D7 → all INPUT` is one action). **Paste-a-pinout** (`VCC,GND,D0..D7,/OE`).
- **Layer 3 — Lean in: edit the inner circuit.** Keep zooming into the chip and its live internals become editable — **via the existing die-editor/Seal flow, not a silent replacement.** "Zoom to LOOK is always free and safe"; crossing into "edit the guts" is a perceivable, announced, reversible CROSSING EVENT (frame "opens" with seam + latch; banner *"INSIDE THE CHIP — editing the blueprint · N copies"*). Edits propagate to every tier + the parts-bin glyph simultaneously.

## 7. Scope safety — the "this touches N copies" stop is IN the spine

The first time in a session a geometry/role edit would ripple to siblings, the spine pauses with a plain big-word stop: **Change all 3 of these chips? [ Change all ] [ Just this one ]**. No silent default for adults; for a child it collapses to "the obvious fully-undoable thing happens" (the stack-of-cards + sibling-glow shown as *information*, not a fork); power path `Ctrl+Shift+I` one-key isolate + "don't ask again."

## 8. Targets, motion, sound — measured floors

- **8.1 Hit targets — 44 *screen* px, zoom-independent.** Today a bead's grab radius is ~11.7px (`PIN_R=4.5 × 2.6`). Bloomed, every bead/handle exposes ≥44 screen-px hit + ≥44px centre spacing (accounting for zoom/DPR); a dense chip that can't fit inflates spacing / eases-zoom-to-fit rather than shrinking targets. **Reconcile `accessibility-and-reach.md §6` (says ≥24px) up to 44px on coarse pointers.** Add an automated guard asserting the bloomed hit-radius in screen px.
- **8.2 Reduced motion — per-gesture, on the canvas** (the signature animations are PixiJS, not CSS): jelly-resize → instant redraw; corner-wrap → bead instantly on new edge; spring-back → instant return; radial/trash/sibling-glow → instant swap; inner-circuit sim → **frozen static snapshot** with explicit Run/Pause.
- **8.3 Earcons — defined in Phase 1, never the sole channel** (each paired with its visual): snap "clunk", reject "bonk", pin-born "pop", trashed (gentler), ghost-wire "careful", frame-open "latch". Respects global mute.

## 9. Geometry undo — the non-negotiable Phase 0 gate

Universal Rule #1 ("undo covers geometry") is **currently false** — a dead Undo after a scary action teaches "this app lies." The `Undo ⌘Z` button binds to `board.canUndo()` → `undoStack.length`; geometry edits never push there because box+pin geometry lives in the global `FREE_FORM_GEOM`/`PART_KINDS` registry, not the `BoardGraph`, so `pushUndo(graph.serialize())` can't see it. **Fix and gate Phase 1 on it:** carry box+pin geometry **in the `BoardGraph`** so `pushUndo` captures it; each resize and each pin-move (rim-slide and edge-hop) pushes one undo entry; verify `canUndo()` flips true. Add **"Revert chip"** (snap to session-open state). UNDO + Revert are real labeled focusable DOM buttons. **No draggable bead ships before this is real.**

## 10. Session safety for the interrupted player

On DONE/click-away show a plain toast (*"Saved — chip updated"*). The bloom state survives a walk-away without committing anything the player didn't see (non-destructive auto-park: stay bloomed, nothing committed, until explicit DONE).

## 11. Which of the four candidate surfaces survive

- **A (Selection Handles) — SURVIVES as the spine.** Kill `Alt`-drag; drop concentric rings (WIRE/SHAPE owns drag-meaning); ≥44px handles; strict hit priority (edge-resize > pin-move > wire-start) with a snap-target ghost; plain-word floating bar.
- **B (Editable Zoom-to-Open) — SURVIVES as Layer 3**, with the announced crossing event, the die-editor/Seal flow honored, reduced-motion sim-freeze, keyboard parity + 44px halos at depth. Never the default entry.
- **C (Inspector Panel) — SURVIVES, MERGED to Layer 2**, two-way bound, collapsed by default, numeric W×H promoted to always-available, multi-select as operand. Never the only path to any lever.
- **D (Flip-the-Chip) — CUT as a surface; soul absorbed.** Its bloom/enlarge becomes Layer 0; its mode theatre (dim/lift/ribbon) becomes the shared edit state. Double-click trigger + Esc-commit trap dropped.

## 12. Universal non-negotiables (preserved from every seat)

1. Undo is visible, labeled, keyboard-reachable, AND covers geometry (§9); "Revert chip" restores session-open state.
2. One loud edit state; one loud WIRE/SHAPE bit — a drag never has two meanings, the bit is defaulted not hidden (§2).
3. Scope is never silent — first ripple stops with a plain choice; isolate is one tap/key (§7).
4. Reading is optional — every lever is icon+color+motion; role is a fixed badge, not text; plain glosses lead (§4).
5. Honest electronics — pins on the perimeter; box can't orphan a pin; **role badge ≠ voltage fill**; fixed packages resist, expandable stretch; a pin moved at one zoom moves at every tier + bin glyph.
6. Big, fixed, separated targets — ≥44px screen-space, zoom-independent, automated guard (§8.1); visible focus rings.
7. Motion sensitivity respected — per-gesture canvas degrade table + frozen-sim Calm mode (§8.2).
8. The bloom is additive — the keyboard/marquee/hotbar EDA tool stays live (§0).

## 13. Phased build plan

- **Phase 0 — Trust gaps (hard gate on Phase 1).** Move box+pin geometry into `BoardGraph`; put box-resize and pin-move on the undo stack (verify `canUndo()` flips); add always-visible labeled UNDO + DONE + Revert chip; replace `Alt`-drag with mode-owned plain drag. *No new bead ships before this.*
- **Phase 1 — The Bloom spine + keyboard parity + 44px (the all-ages floor).** Single-activation bloom (pointer + keyboard, announced); DOM focus tree over the canvas with visible rings; arrow-key collision resolved; ≥44px screen targets with automated guard; `+` well / trash / spring-back / ghost-wire net; two honest channels (role badge vs voltage fill); fixed-vs-expandable physics + ghost slot scaffold; probe-tap vs explicit-role-radial; one loud WIRE/SHAPE bit (default SHAPE); earcon set; reduced-motion degrade table; first-ripple scope stop; save-toast + interrupt-safe park. **Validate with a real 5–7yo, a 70-year-old novice, and a keyboard/switch user before proceeding.**
- **Phase 2 — The precise companion (Layer 2).** Two-way-bound docked panel: numeric W×H (also on the die-bar), pin rows with Where/Job, first-class multi-select, distribute/mirror/paste-a-pinout, one-key isolate.
- **Phase 3 — Lean-in inner-circuit editing (Layer 3).** The zoom continuum into live internals with the announced crossing event, die-editor/Seal honored, edits propagating to every tier + bin glyph, reduced-motion sim-freeze, keyboard parity + 44px at depth. Largest build, funded last.

---

## Appendix — panel digest (each seat's north star + standout ideas)

- **Ages 5–8 (pre/early readers):** *the chip is a physical TOY — grab, stretch, stick pins on like fridge magnets; instant result, nothing behind a word, can't break it.* → stretchy-jelly box w/ live edge LEDs · magnet-bead pins w/ picture role-stamps · drag-to-trash / drag-from-`+`-bin (no counter).
- **Ages 9–13 (UGC builders):** *if it has a grab-handle a kid will drag it and learn by undoing — put levers ON the box as fat handles, instantly reversible, never make them read a menu.* → grab-the-wall stretch + drag-out-a-pin · pin-role paint bucket (color, not acronym) · living-copies flash + "snip this one" tag.
- **Ages 14–22 (power creators):** *the placed chip IS the editor — turn the overworld into a lite EDA package editor with snapping, numeric entry, multi-select, keyboard verbs; no modal/drill-in/round-trip you didn't choose.* → numeric box+pin entry · pinout stamp / paste-a-pinout · continuous zoom-to-edit w/ a hard determinism guarantee.
- **Adult casual / parents:** *editing a chip should feel like resizing a photo — one obvious "I'm editing now," big handles, a giant Undo, a calm promise nothing breaks until you say so, and you're TOLD before a change touches other copies.* → Calm-Edit Mode (lights dim, chip lifts) · the "used in 3 places" safety card · always-there Big Undo + 1-step Revert chip.
- **Older adults / accessibility:** *every edit a mouse-teen does by dragging, my player does by selecting + pressing a labeled button or arrow key — drag is an accelerator, never the only door — and nothing changes shape/scope/commit without saying so in words first.* → Edit-chip mode toggle (replaces the Alt chord) · keyboard pin & box parity (Tab+Arrows mirroring `nudge()`) · scope-first commit gate w/ isolate escape.
- **Learning-science (all ages):** *editing must feel like reshaping a real part — every drag teaches package shape + pinout are deliberate choices; one obvious always-available edit handle, reversible, never a hidden mode.* → one handle, four depths (the universal entry, which became the spine) · blueprint-vs-this-copy shown as a physical stack · role by color/icon first, word second.

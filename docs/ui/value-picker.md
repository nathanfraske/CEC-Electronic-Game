<!--
  SPDX-License-Identifier: Apache-2.0
-->

# Value picker — design note (draft)

How a learner sets a component's value when every value is a **real, standard
part**: resistors snap to **E24**, capacitors and inductors to **E6**,
sources to a **curated rail/current list**. The hazard the owner flagged: a flat
menu of all E24 values across ~7 decades is 168 rows — a wall of numbers. This
note compares five pickers and recommends one.

Shared constraints:

- **Where it lives.** A new **Inspector** that appears in the right rail (above
  or replacing Telemetry) only when **exactly one component is selected**
  (`selCount === 1`). Zero or many selected → no picker. Non-valued kinds (GND,
  D, Q, &, FF, FP, uC; `unit === ""`) show identity only, no value control.
- **Display is solved.** Always render the chosen value through
  `formatValue(value, unit)` (`web/src/lib/graph.ts:231`) → "4.7 kΩ", "47 nF",
  "1 mH". The picker chooses a *number*; `formatValue` owns the *label*. Never
  hand-format.
- **The set is small per part.** E24 = 24 significands {1.0, 1.1, 1.2, 1.3, 1.5,
  1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2,
  6.8, 7.5, 8.2, 9.1}; E6 = 6 {1.0, 1.5, 2.2, 3.3, 4.7, 6.8}. The trick is never
  showing significand × decade flattened together.
- **Look.** Mono numerals (`--font-mono`), uppercase tracked labels
  (`--font-display`), 2–4px radii, accent rose on the active item, soft glow —
  reuse the `.is-active` / `armed-chip` / `tab` patterns already in `App.svelte`.

## The five directions

### 1. Decade + significand split

Two coupled controls: a **decade** rail (1 Ω · 10 · 100 · 1k · 10k · 100k · 1M)
and the **significand** within it (the 24 E24 / 6 E6 steps). Value = significand
× decade.

- **Learner:** very teachable — it *names* the two ideas (order of magnitude vs.
  the standard step) that the E-series encodes. Bounded: ≤7 + ≤24 visible, never
  168.
- **Power user:** two hops to cross a decade boundary (4.7k → 5.6k is one step;
  9.1k → 10k jumps rail then significand). Mild friction once you know exactly
  what you want.
- **Discoverability:** high. The structure is on screen; nothing hidden.
- **Keyboard/trackpad:** Tab between the two groups, arrows within each; clean.
- **Compact panel:** decade as a 7-chip wrap row, significand as a select or a
  short scroll — fits a ~260px rail. 24 chips would overflow, so significand
  wants a dropdown or 2-col grid, not a chip row.

### 2. Stepper / nudge (▲▼ or scroll)

One readout showing `formatValue`, with ▲/▼ (and scroll / ↑↓) that step to the
**next/prev standard value** across the whole series. **Coarse vs. fine:**
Shift+▲ (or the outer chevrons) jumps a decade; plain ▲ moves one E-step.

- **Learner:** lowest concept load — "a bit bigger / smaller" with no menu. But
  it doesn't *teach* the series; values just flick past.
- **Power user:** excellent for relative tweaks ("one more notch"); poor for
  "jump to 47k from 220 Ω" — that's many clicks unless coarse step helps.
- **Discoverability:** the ▲▼ affordance is obvious; the coarse/fine modifier is
  not (needs a tooltip / hint line like the existing `hint`).
- **Keyboard/trackpad:** best of the five. Wheel-snap feels great; ↑↓ map
  directly; PageUp/PageDn = decade.
- **Compact panel:** tiny — one field, two chevrons. Echoes the transport
  `◀ ▶` glyph buttons.

### 3. Type-to-filter combobox

A text field that parses electronics shorthand — `4k7` → 4700, `47n` → 47e-9,
`2.2u`, `100R` — and a live list filtered to standard matches. On commit, snap
to the **nearest** standard value and reformat.

- **Learner:** the shorthand (`4k7`) is itself a lesson, but only once known;
  cold, it's a blank box ("type what?"). Free-form invites invalid input.
- **Power user:** fastest path for someone who knows the number. Keyboard-only,
  no mouse.
- **Discoverability:** low without a placeholder / examples; the parse grammar is
  invisible.
- **Keyboard/trackpad:** keyboard-ideal; trackpad irrelevant (it's typing).
- **Compact panel:** a single input + dropdown; minimal. Needs robust parse +
  "snapped to nearest" feedback so a typo doesn't set a wild value.

### 4. Slider with detents (log scale)

A horizontal log-scale slider whose thumb **clicks into** each standard value;
the track spans the part's full range, the readout shows `formatValue`.

- **Learner:** beautifully shows that values are logarithmic and that decades are
  even steps — great *intuition*. Coarse for precise targets.
- **Power user:** hard to land an exact value by drag on a phone-width track;
  the detents help but fine selection is fiddly.
- **Discoverability:** instantly graspable as a slider.
- **Keyboard/trackpad:** arrows can step detent-to-detent (good); dragging is
  imprecise. Touch targets for 24 detents on ~240px are tiny — accessibility
  risk.
- **Compact panel:** wide but short; one row. Detent density across 7 decades is
  the problem — 168 stops on 240px ≈ 1.4px each, unusable as a continuous drag,
  so it must be arrow-stepped in practice (which is just #2 wearing a track).

### 5. Curated short list + "more…"

~8 hand-picked common values per part up front (e.g. R: 100 · 220 · 330 · 470 ·
1k · 2.2k · 4.7k · 10k · 47k · 100k), each a chip, plus a **"More…"** disclosure
that expands the full series (most naturally as #1's split or a scroll).

- **Learner:** calmest possible first contact — a handful of friendly,
  real-world values, one click, done. Progressive disclosure keeps the full set
  one tap away.
- **Power user:** the 8 cover ~80% of textbook circuits; the rest is one "More…"
  away. Slight extra step for unusual values.
- **Discoverability:** highest — the common answers are *right there*, labelled.
- **Keyboard/trackpad:** arrow through chips; Enter commits; "More…" is focusable.
- **Compact panel:** 8 chips wrap into 2–3 rows nicely at ~260px; the expansion
  is opt-in so the resting state stays small.

## Recommendation — #5 (curated short list) as the front door, #1 (split) as "More…", #2 (▲▼) always on the readout

No single control wins every axis, so **compose the three that complement each
other** and skip the two that don't (the combobox's blank-box cold start and the
slider's unusable detent density make them weak defaults; keep `4k7`-style typing
as a *later* power-user add, not v1).

The Inspector, resting state, one component selected:

```
┌─ INSPECTOR ─────────────────────────────┐
│  R7   Resistor                    [×]    │   ← kind + instance id
│                                          │
│  VALUE            ┌──────────┐           │
│  ▼  4.7 kΩ  ▲     │ formatVal│           │   ← #2: ▲▼ step E24 · Shift=decade
│                   └──────────┘           │
│                                          │
│  COMMON                                  │   ← #5: curated chips, the front door
│  [100Ω] [220] [330] [470] [1k]           │
│  [2.2k] [4.7k]•[10k] [47k] [100k]        │     • = current value, accent rose
│                                          │
│  More values ▸                           │   ← discloses #1 inline
└──────────────────────────────────────────┘
```

Expanded ("More values ▸" open) reveals the **decade + significand split**:

```
│  DECADE   [1Ω][10][100][1k]•[10k][100k][1M] │
│  STEP     [1.0][1.1][1.2] … [4.7]• … [9.1]   │   (E24 grid / E6 row for C,L)
```

Why this composite:

- **Calm by default.** Resting Inspector shows one readout + ~8 chips — never the
  168-value wall. The full series exists but is opt-in.
- **Fast for both users.** Learner clicks a labelled common value; power user
  nudges with ▲▼/scroll or opens the split to land anything exactly. Every path
  ends on a real standard value.
- **Teaches the idea.** The split literally separates magnitude from step, so
  "More values" doubles as the lesson in what E24/E6 *are*.
- **One label source.** All three surfaces read `formatValue`, so "4.7 kΩ" is
  spelled identically in the readout, the chips, and the split's preview.

Behavior details:

- **Snapping.** The model stores the exact standard double (e.g. `4700`). The
  curated chips and split emit exact series values; ▲▼ moves to the adjacent
  series entry. If a value ever arrives off-grid (paste, legacy save, future
  combobox), snap to the nearest E-series neighbor on commit and reformat.
- **Bounds.** Clamp to a sane per-part range (R ~1 Ω–10 MΩ, C ~1 pF–10 mF,
  L ~1 nH–1 H); ▲ at the top / ▼ at the bottom no-ops (disable the chevron, like
  the toolbar's disabled `btn`s).
- **Sources (V/I).** Replace the series with a **curated rail/current list** as
  chips: V → 1.8 · 3.3 · 5 · 9 · 12 · 24 V; I → 1 µA · 10 µA · 100 µA · 1 mA ·
  10 mA · 100 mA. No "More…"; the list is the whole set. Same ▲▼ readout.
- **Commit + undo.** Setting a value is one undoable action (reuse the existing
  graph snapshot / `canUndo` path), so a mis-click is one Ctrl+Z. A value-only
  change must keep the netlist *signature* logic happy — it re-installs values
  without resetting topology (the `rebuildNetlist` path already distinguishes
  value vs. topology changes).

## Accessibility notes

- **Roles.** The ▲▼ readout is a **`spinbutton`** (`aria-valuenow` = the numeric
  value, `aria-valuetext` = the `formatValue` string so screen readers say
  "4.7 kilohms", not "4700"). Chips are a **`radiogroup`** (the current value =
  checked). "More values" is a disclosure (`aria-expanded`).
- **Keyboard.** Arrow keys step the spinbutton; PageUp/PageDn = decade; chips
  arrow-navigate with roving tabindex; Enter/Space commits; Esc blurs without
  changing (consistent with the board's universal-cancel Esc). Note: `App.svelte`'s
  global key handler early-returns for INPUT/TEXTAREA — the spinbutton should be
  an `<input>` or otherwise excluded so R/space/arrows edit the value, not the
  board.
- **Targets & contrast.** Detent-style hit areas ≥24px (this is exactly why the
  raw slider in #4 was rejected). Active-chip state must not rely on color
  alone — pair accent rose with a ring/`•` marker, since rose-on-violet may fail
  contrast for color-blind users (the design system already uses ring + glow on
  `.is-active`, so follow that).
- **Reduced motion.** Any value-change glow honors `prefers-reduced-motion`.

## Out of scope (note for later)

`4k7`-style **type-to-filter** (#3) is the natural power-user upgrade once the
composite ships — add it as an alternate entry mode on the readout, behind the
same snap-to-nearest rule. Tolerance bands (5%/1%) and E12/E96 series are future
tiers; today everything is ideal, so the picker only needs the *nominal* value.

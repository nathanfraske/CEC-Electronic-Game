<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: CEC latches (SR + transparent D), two five-tier IC glyphs

A standalone brief for the design agent. Build **two** five-tier IC glyphs for the CEC Foundations
Series **latches** -- the bistable memory primitives. Read this top to bottom. For the verbatim house
infrastructure follow **`ic-glyph-spec.md`**; for the authoritative part specs and CEC house conventions
follow the **CEC Foundations catalogue** (`cec-teaching-ics.md`, in the kit).

**The two deliverables (each a standalone self-contained HTML file):**

| Output file | Part | Function |
|---|---|---|
| `docs/ui/parts/sr-latch-ic.html` | **CEC3007** SR Latch | cross-coupled NOR; S sets, R resets, hold, 1·1 forbidden |
| `docs/ui/parts/d-latch-ic.html` | **CEC3014** Transparent D-Latch | gated SR; transparent when EN=1 (Q follows D), holds when EN=0 |

These are **CEC house parts** (no real-manufacturer names): `chipType` = the CEC number, the Critical
Error brand mark, the house pin convention. Build the **SR latch first as the worked template**
(section 6), then the D-latch as a delta (section 7) -- the D-latch is the SR latch with a steering front
end.

**You are not starting from scratch:**

- **`jkff-ic.html` is the primary base.** It is a CEC house sequential composite (CEC3076) built around
  the **cross-coupled bistable** -- the exact SR core these parts are -- with a **gate-level tier 4**
  drawn from the `andG`/`orG`/`invTri` helpers, a **sequential scope**, real MOS silicon in tier 5, and
  CEC branding. Copy its shell, helpers, the cross-coupled-latch drawing, and the tier arc.
- **`dff-ic.html` is the timing-scope + gating reference.** It has the **timing-diagram scope** these
  level-sensitive parts need (inputs and Q over time) and the gated/enable behavior pattern for the
  D-latch's EN.

There is **no `norG` helper** in the codebase. The SR core is **cross-coupled NOR**, so add a NOR by
drawing `orG` with a small **output bubble** (a circle on the output lead) -- or write a tiny `norG`
wrapper that calls `orG` and appends the bubble. Use it for both gates of the cross-coupled pair.

- **`<title>`s:** `SR latch, five layers` and `Transparent D-latch, five layers`. Make the
  `<h1 class="lede">`, the header `chipType` (CEC3007 / CEC3014), the device-tier name, and the `names`
  map all match. **Grep each finished file for stale strings from the template** ("JK", "flip-flop",
  "CEC3076", "D flip-flop", "CLK" where the part has no clock, and -- critically -- update the model
  COMMENT block, not just the visible strings (recent composite builds left a stale `// CEC2024 half
  adder` comment above a correct model; do not repeat that).

---

## 0. The shared idea

**Feedback is memory.** Cross-couple two gates so each drives the other and the pair becomes *bistable*:
it has two stable states and stays in whichever one it was pushed to. That is the birth of memory.

- **CEC3007 SR latch:** the raw primitive -- two cross-coupled NOR gates. SET drives Q high and it stays
  after SET releases; RESET drives it low and it stays; hold both low and it remembers. Drive both high
  and the two gates fight -- the **forbidden state**, a deliberate teaching hazard.
- **CEC3014 transparent D-latch:** the SR latch with a clean data door. While EN is high the latch is
  *transparent* (Q follows D); the instant EN goes low it freezes the last D and holds. It is the missing
  middle term between the SR latch and the edge-triggered flip-flop -- the cleanest way to teach
  **level- vs edge-triggered**.

## 1. THE NO-STUBS MANDATE (read this -- it is the point of this build)

**Every pin must be drawn fully connected to the working circuit, and shown doing its job. Draw nothing
as a decorative stub, and do not simplify any pin out -- VCC and GND especially.**

- **VCC and GND are real rails that POWER every internal gate.** Draw the VCC rail and the GND rail and
  **connect every gate to them** (a supply lead from each gate body to the rail, or -- better -- at the
  device/silicon tiers the PMOS tied up to VCC and the NMOS down to GND). These are powered CMOS gates
  sharing the part's supply (in the sim they are powered `ELEM_GATE`s wired to VCC/GND); show that. A
  short "VCC" pin lead that dangles into nothing is exactly what NOT to do.
- **Every signal pin connects to its real terminal:** S/R (or D/EN) into the actual gate inputs, Q and
  Q-bar from the actual latch outputs, with the **cross-coupling feedback wires fully drawn** (Q to one
  gate's input, Q-bar to the other's). The feedback loop is the whole device -- never abbreviate it.
- This applies in **every tier**, not just the schematic: the flow and valve tiers show the supply
  feeding the mechanism and the feedback path closed; the gate-level and silicon tiers show the rails
  powering each gate/device and every pin landed. If a pin appears on the package, it must be traced to
  where it does work inside.

The test for the handback: point at any pin -- VCC, GND, S, R, D, EN, Q, Q-bar -- and you can follow an
unbroken wire from it to the gate(s) it actually drives or powers. No exceptions.

## 2. The real-device split (as for the composites, plus the no-stubs rails)

- **Tiers 2-3 (the analogy view) are rich abstraction -- do not schematize.** Bistability as a flow
  network with a held level fed back on itself (tier 2), and as pressure-pilot valves cross-piloting each
  other (tier 3). Show the supply feeding the mechanism and the feedback closed (no stubs even here).
- **Tier 4 (real device) = the gate-level schematic** drawn with proper gate symbols (`andG`, `invTri`,
  and **NOR = `orG` + output bubble**), the cross-coupling fully wired, **and the VCC/GND rails connected
  to power every gate**. For a gate-composition part the gates ARE the real device; draw them properly,
  powered, with every pin landed -- not vague boxes, not floating logic symbols.
- **Tier 5 (silicon) = real MOS cross-sections** of a representative gate (a NOR cell is ideal here:
  series PMOS pull-up to VCC, parallel NMOS pull-down to GND), with the supply ties shown -- this is
  where "powered by VCC/GND" becomes literal silicon. Real structures, not a block diagram.

## 3. The shared build approach

- Take the **shell** (CSS, fonts, `el`/`drawPkg`/helpers, the CEC brand mark, the frame loop), the
  **gate-symbol helpers** (`andG`, `orG`, `invTri`), the **cross-coupled-latch drawing**, and the
  **sequential scope** from `jkff-ic.html`; add the `norG` (orG + bubble) wrapper.
- Use `dff-ic.html` for the **timing-diagram scope** pattern (inputs + Q over time) -- these latches are
  **level-sensitive**, so the scope is a timing trace, not a combinational truth table.
- Each part maps to a `buildNetlist` gate composition (section 9); tier 4 draws exactly that, powered.
- **Sequential state:** the live model holds Q (and Q-bar) across frames; inputs change it per the
  function. Show HOLD explicitly (inputs return to the rest state, Q stays).

## 4. CEC house identity and pinouts (from the catalogue)

- **CEC3007** SR latch -- 5-pin SC70-5 / SOT-23-5, house order: `1 Q · 2 GND · 3 S · 4 R · 5 VCC`.
  Tagline: *"the first thing a circuit ever remembered."*
- **CEC3014** transparent D-latch -- 6-pin SOT-23-6 / SC70-6, house order:
  `1 Q · 2 GND · 3 D · 4 EN · 5 Q̄ · 6 VCC`. Tagline: *"memory with the door propped open."*

`chipType` = the CEC number; no real-manufacturer name. Adapt `drawPkg` per `ic-glyph-spec.md` §7.3.

## 5. The five-tier arc (shared pattern)

**Tier 1 -- symbol + pinout + excitation table.** The latch symbol on the CEC pinout, the function table
(SR: S R -> Q with the hold and forbidden rows; D-latch: EN D -> Q with the hold row), and a live state
note. (Not a plain combinational truth table -- include the HOLD row and, for SR, the forbidden row.)

**Tier 2 -- flow network (analogy, build rich, no stubs).** Bistability as plumbing: a held level that
feeds back to sustain itself, set/reset (or D through the EN gate) tipping it, the supply feeding the
mechanism. The feedback loop is drawn closed.

**Tier 3 -- pressure-pilot valves (analogy, build rich, no stubs).** Two cross-piloting valves, each
held open/closed by the other's state -- the mechanical bistable. The supply line feeds both; the
cross-pilot lines are fully drawn.

**Tier 4 -- gate-level schematic (real gate symbols, powered, no stubs).** The exact composition
(sections 6/7) with the cross-coupled NORs (and the D-latch's steering NOT + ANDs), every gate connected
to the VCC and GND rails, the feedback fully wired, every pin landed. Light the active gates / the held
state from the live model.

**Tier 5 -- silicon (real cross-sections, supply ties shown).** A representative NOR cell as CMOS (series
PMOS to VCC, parallel NMOS to GND), real cross-section, with the rails tied -- the powered device in
silicon.

## 6. Worked template -- CEC3007 SR Latch (build this first, in full)

- **Pinout:** `1 Q · 2 GND · 3 S · 4 R · 5 VCC` (SOT-23-5).
- **Composition (tier 4):** **two cross-coupled NOR gates**, both powered from VCC/GND. With active-high
  S/R: `Q = NOR(R, Qbar)` and `Qbar = NOR(S, Q)` -- the output of each NOR feeds the other's input (draw
  both feedback wires). (Note Q-bar is internal here -- the CEC3007 brings out only Q on pin 1 -- but
  draw the Q-bar node; it is half the latch.)
- **Function (S R -> Q):** 0 0 -> hold · 1 0 -> 1 · 0 1 -> 0 · 1 1 -> **forbidden** (both NORs driven
  low-out, Q = Q-bar = 0, contention; the sim resolves the released race to X). Make the forbidden state a
  visible teaching beat (both outputs low, then an undefined settle).
- **Scope:** a timing diagram -- toggle S and R over time and watch Q **latch and hold**: a pulse on S
  sets Q high and it stays after S releases; a pulse on R clears it; both-high shows the forbidden
  contention. The "it remembers after the input releases" moment is the payoff.
- **Teaches:** feedback, bistability, the birth of memory, why the forbidden state is forbidden.

## 7. Delta -- CEC3014 Transparent D-Latch

- **Pinout:** `1 Q · 2 GND · 3 D · 4 EN · 5 Q̄ · 6 VCC` (SOT-23-6). Both Q and Q-bar are brought out.
- **Composition (tier 4):** the CEC3007 cross-coupled NOR pair with a **steering front end**: `nD =
  NOT(D)`; `S = AND(D, EN)`; `R = AND(nD, EN)`; into the latch (`Q = NOR(R, Qbar)`, `Qbar = NOR(S, Q)`).
  When EN = 0 both AND outputs are low, the latch holds; when EN = 1, S = D and R = ¬D so Q tracks D.
  Five gates (NOT + 2 AND + 2 NOR), all powered from VCC/GND, every pin landed, feedback fully wired.
- **Function (EN D -> Q):** 1 0 -> 0 · 1 1 -> 1 · 0 X -> **hold**.
- **Scope:** a timing diagram showing **transparent vs hold** -- while EN is high, Q follows a wiggling D
  exactly (transparent); the instant EN drops, Q freezes at the last D and ignores further D changes
  (hold). This is the level- vs edge-triggered lesson; call it out (contrast: a flip-flop would only
  sample D on EN's edge, not track it).
- **Teaches:** the gated latch, transparency, level- vs edge-triggered (the single most confused
  distinction in sequential logic).

## 8. Controls and scope

- **Controls:** input toggles -- **S / R** (SR latch); **D / EN** (D-latch). A VCC control is optional.
  No clock-edge button (these are level-sensitive, not edge-triggered) -- EN is a level, not an edge.
- **Scope -- the sequential timing diagram (the payoff).** Inputs and Q (and Q-bar for the D-latch) on a
  shared time axis. Make HOLD visible (inputs at rest, Q flat at its last value). For the SR latch include
  the forbidden-state contention; for the D-latch the transparent-then-frozen transition as EN drops.

## 9. Sim backend mapping (already wired; tier 4 must agree)

Each is a `buildNetlist` gate composition (`CEC_COMP` in `web/src/lib/netlist.ts`), no new sim element:
SR latch = two cross-coupled NOR gates; D-latch = NOT + two ANDs + the cross-coupled NOR pair. The
sub-gates are **powered `ELEM_GATE`s sharing the part's VCC/GND** -- which is exactly why the no-stubs
rails matter: the schematic should picture the same powered, cross-coupled network the sim builds. The
forbidden / unknown cases resolve through the four-state `combine` to X.

## 10. House style, validation, handback (per part)

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** line 1. **CSS/fonts/tokens** verbatim from `jkff-ic.html`; Saira / Saira Condensed / IBM Plex
  Mono; keep the Critical Error brand mark.
- **Forbidden glyphs** (§10 check must report `none`/`0`): em-dash, en-dash, arrows (U+2192/2190/2194),
  the minus sign (U+2212), smart quotes, `&mdash;`/`&ndash;`. ASCII hyphen-minus and "to"; the middle dot
  `·` and the overbar in `Q̄` are fine. Write logic as "S nor R" / "D and EN" in prose.
- **§10 gates, on EACH file:** (1) `node --check`; (2) forbidden-glyph check; (3) `grep -c "drawPkg(gT"`
  = **5**; (4) per-tier member consistency; (5) a **Playwright render of all five tiers** (mandatory) --
  toggle the inputs through set/reset/hold (and transparent/hold for the D-latch) in every tier;
  screenshot and fix collisions / off-canvas labels. If you cannot run the render, say so per file.
- **Handback checklist (per part):**
  - **No stubs:** every pin -- VCC, GND, S, R, D, EN, Q, Q-bar -- traces by an unbroken wire to the gate(s)
    it drives or powers; the VCC/GND rails power every gate; the cross-coupling feedback is fully drawn.
    Nothing simplified out.
  - **CEC house identity:** chipType/title/lede/device-tier/`names` = the CEC number + function; brand
    mark present; no real-manufacturer name; pin order per the catalogue. Model COMMENT block updated (no
    stale template comment).
  - **Real device:** tier 4 is the powered gate-level schematic (cross-coupled NOR via orG+bubble; D-latch
    steering NOT+ANDs); tier 5 is real MOS silicon of a NOR cell with the supply ties.
  - **Analogy tiers kept;** the sequential lesson lands (SR: latch-and-hold + the forbidden state;
    D-latch: transparent-vs-hold / level-vs-edge), shown on the timing scope.
  - **All §10 gates pass clean** (or the render is flagged for the owner).

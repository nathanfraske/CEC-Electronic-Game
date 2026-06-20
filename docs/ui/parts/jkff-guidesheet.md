<!-- SPDX-License-Identifier: Apache-2.0 -->

# Build guidesheet: CEC3076 JK / T flip-flop, five-tier IC glyph

A standalone brief for the design agent. Build a five-tier IC glyph for the **CEC3076 JK / T
flip-flop**, the house single-part JK (no real single JK exists; the real ones are all duals).
Read this top to bottom; it gives the part, the package frame, the live model, the five-tier arc,
the controls/scope, and the validation gates. For the verbatim house infrastructure (CSS, fonts,
helpers, scope chrome, frame loop) and the exact validation commands, follow **`ic-glyph-spec.md`**;
for the part spec of record, see **CEC3076** in **`cec-teaching-ics.md`**.

- **Output file:** `docs/ui/parts/jkff-ic.html`
- **`<title>`:** `JK / T flip-flop, five layers` — set this correctly. (The last two uploads shipped
  with a copy-pasted leftover title from their template — `dff-ic` said "Schmitt inverter", `buf-ic`
  said "NOT gate". Don't repeat that: the `<title>`, the `<h1 class="lede">`, the part name in the
  device tier, and the `names` map must all say JK / T flip-flop.)

---

## 0. The one idea

**A JK flip-flop is a D flip-flop whose D input is computed from J, K, and the flop's own output.**
That feedback is the whole story: it removes the SR latch's forbidden state and adds the **toggle**.
Tie J and K together and it becomes a **T (toggle) flip-flop** — the divide-by-2 cell every counter
and frequency divider is built from. Every tier should make the feedback loop visible; it is what
separates this part from the plain D flip-flop.

## 1. Start from `dff-ic.html`, NOT `inv-ic.html`

This is the most important instruction. The five-tier patterns in `ic-glyph-spec.md` §8 are written
for a **combinational CMOS gate** (PUN-over-PDN transistor networks, an analog transfer curve). The
JK is **sequential** — it has no transfer curve; it has a clock, internal state, and a timing
diagram. `dff-ic.html` (the 74AUP1G79 D flip-flop, already shipped) has already adapted all five
tiers and the scope for an **edge-triggered master-slave flip-flop**. Copy it as the skeleton and
**reuse its master-slave core verbatim in every tier**; the only thing you add is the **JK steering
front-end** and a second input.

What you inherit unchanged from `dff-ic.html`:
- the whole house infrastructure (CSS, fonts, `el`/`drawPkg`/helpers, the frame loop);
- the master-slave latch mechanism in tiers 2 (two chambers), 3 (master-slave valves), 4 (two
  transmission-gate latches built from inverters + clocked switches), 5 (the cross-coupled-inverter
  storage cell);
- the **timing-diagram scope** (traces over time, edge-triggered) — NOT the analog vin/vout scope.

What you add (the JK delta), in every tier:
- a **steering front-end** computing `D = J·Q̄ + K̄·Q` ahead of the master latch;
- the **Q/Q̄ feedback** from the slave output back into that steering (the toggle path);
- a **second input** (K) and the **T-mode** tie.

## 2. The part — CEC3076 JK / T flip-flop

- **Function (positive-edge-triggered).** On each rising CLK edge, J and K choose the next state:

  | J | K | next Q | mode |
  |---|---|---|---|
  | 0 | 0 | Q (no change) | hold |
  | 1 | 0 | 1 | set |
  | 0 | 1 | 0 | reset |
  | 1 | 1 | Q̄ (flip) | toggle |

- **Characteristic equation:** `Q⁺ = J·Q̄ + K̄·Q`.
- **T-mode:** tie `J = K = T`. Then `Q⁺ = T ⊕ Q` — toggles when T = 1, holds when T = 0. With T held
  high and a running clock, **Q is exactly half the clock frequency** (the divide-by-2 headline).
- **Why a house part:** no single JK is sold (74x76 / 74x112 / CD4027 are all duals); it is the
  edge-triggered companion to the real D flip-flop in `dff-ic.html`.

## 3. Package frame and pinout (shared by all five tiers)

**7-pin, drawn on an 8-lead frame (SC70-8 with one N.C., or MSOP-8).** Pin 1 indicator at the
lower-left; rotate into landscape exactly as `dff-ic.html` does for its package. House pin order
(output on pin 1, GND pin 2, VCC last — the CEC convention):

| Pin | Name | Function | Connection contract (every tier wires to this) |
|---|---|---|---|
| 1 | **Q** | Latched output (changes only on the clock edge) | the right-margin output node + the live Q voltage readout |
| 2 | **GND** | Ground / 0 V | the bottom reservoir / NMOS-source / substrate side |
| 3 | **J** | set-side input | a left-side input pilot into the steering |
| 4 | **K** | reset-side input (tie to J for T-mode) | a left-side input pilot into the steering |
| 5 | **CLK** | clock; samples J/K on the LOW-to-HIGH edge | the clock-phase driver of the master-slave latch |
| 6 | **Q̄** | complementary output | the steering feedback tap (and a secondary right-margin node) |
| 7 | **VCC** | positive supply (1.8 V–15 V) | the top supply rail/tank |
| 8 | **N.C.** | no connect | leave unwired |

Adapt `drawPkg` per `ic-glyph-spec.md` §7.3: set the `pin(...)` calls to these numbers/names/x
positions, keep the top-pin-above-bottom-pin alignment, add a `PIN` lookup, and update `chipType`,
the `names` map, and the part name in the device tier to **CEC3076**.

## 4. The live model (interactive state, per frame)

Edge-triggered and digital — mirror `dff-ic.html`'s model, do **not** use the square-law analog
model. Internal state: the stored bit `q` (with `qbar = !q`) and `clkPrev`.

```js
// inputs this frame: J, K, CLK as booleans (from the controls / clock generator); VDD from slider.
// T-mode binds them: if (tmode) { J = T; K = T; }
if (CLK && !clkPrev) {            // rising edge only
  q = (J && !q) || (!K && q);     // D = J·Q̄ + K̄·Q  -> latch
}
clkPrev = CLK;
// outputs: Q = q ? VDD : 0 ;  Qbar = q ? 0 : VDD ;
// the steered D the front-end is presenting RIGHT NOW (combinational, shown in tiers 2-5):
//   dNow = (J && !q) || (!K && q);
```

Expose, for the tiers to read off the model record `s`: `q`, `qbar`, `dNow` (the steered next-D),
`J`, `K`, `CLK`, the current **mode** string (`hold`/`set`/`reset`/`toggle`), and `VDD`.

## 5. The five-tier arc (D-FF core + JK steering)

Keep `dff-ic.html`'s master-slave core in each tier; add the steering + feedback described here.

**Tier 1 — symbol + pinout + timing diagram.**
- The JK flip-flop **logic symbol**: a rectangle, J and K labelled on the left edge, the **dynamic
  clock triangle** (the `>` notch) at CLK, Q and Q̄ on the right. Wire each to its real pin via the
  package frame.
- The **scope is a timing diagram** (reuse the D-FF's): stacked traces J, K, CLK, Q (and optionally
  Q̄) scrolling in time. This is where the four modes and the toggle are shown live.
- A **4-row function table** (the table in §2) with the row matching the current J/K highlighted.
- State note: "hold" / "set" / "reset" / "toggle".

**Tier 2 — flow network.**
- Keep the master-slave **two-chamber** latch (the D-FF's tier 2: a bit handed from master to slave
  on opposite clock phases).
- Add a small **steering manifold** ahead of the master chamber: sealed pilot valves that pick what
  fills the master from J, K, and the **fed-back Q/Q̄ pipe**. Show `D = J·Q̄ + K̄·Q` as the routing.
- Draw the **Q̄ feedback pipe** from the slave output back to the steering. Make it the visual
  headline: in toggle (J=K=1) the steering routes Q̄ into the master, so the chamber fills to the
  opposite level each clock.

**Tier 3 — pressure-pilot valves.**
- Keep the master-slave valve mechanism (the D-FF's tier 3).
- Render the steering as **pilot valves** gated by J, K, and the fed-back Q/Q̄ (the AND/OR steering
  as a small valve cluster feeding the master's gate line).

**Tier 4 — real device (schematic).**
- Keep the **transmission-gate master-slave** D flip-flop (the D-FF's tier 4: two latches of
  inverters + clocked transmission gates, CLK / CLKn phases).
- Add the **JK steering gates** at the front: an **inverter on K**, two **AND** gates (`J·Q̄`,
  `K̄·Q`), and an **OR** merging them into the master latch's D input. Draw the **Q and Q̄ feedback
  wires** from the slave output back to those AND gates. This is the literal "JK = D-FF + steering"
  build and matches the sim composition (§6) one-to-one.

**Tier 5 — silicon.**
- Keep the **cross-coupled-inverter storage cell** (the D-FF's tier 5) — the regenerative bistable
  at the heart of each latch.
- Annotate that the steering is just a few more gates on the same die, and that the **feedback loop
  is the same regenerative core**: a JK is a D-FF storage cell whose input is steered by its own
  output. The storage primitive is unchanged.

## 6. Sim backend mapping (keep the glyph faithful to it)

The web part will be a `buildNetlist` **composition** (no new sim-core element, golden-safe): an
edge-triggered `ELEM_DFF` (`Q = a`, `D = b`, `CLK = c`, `Q̄ = d`) fed by JK steering gates computing
`D = J·Q̄ + K̄·Q` (an inverter on K + two ANDs + an OR, all powered `ELEM_GATE`), with the DFF's own
`a`/`d` (Q/Q̄) closing the feedback. Because the DFF samples only on the edge, J=K=1 is a clean
toggle — no latch race. Tier 4 should draw exactly this network so the glyph and the sim agree.

## 7. Controls and scope

- **Controls:** a **J** toggle, a **K** toggle, a **T-mode** switch (binds J=K=T), and a **clock**
  (run/pause; a manual single-step is a nice extra). A **VDD** slider for the rail. Drop the analog
  `vin`/`vt` sliders — they are meaningless for an edge-triggered part (same as `dff-ic.html`).
- **Scope:** the **timing diagram** from `dff-ic.html` (J, K, CLK, Q traces over time). The default
  demo should make the toggle obvious: hold T-mode on with the clock running so Q visibly halves the
  clock; then a manual run through set / reset / hold.

## 8. House style and validation (all must pass before handback)

Per `ic-glyph-spec.md` §4 (style) and §10 (gates):

- **SPDX** on line 1: `<!-- SPDX-License-Identifier: Apache-2.0 -->`.
- **Design tokens / fonts / CSS:** copy verbatim from `dff-ic.html` (do not hardcode colors; use the
  `--bg`/`--surface`/`--accent`/signal tokens). Saira / Saira Condensed / IBM Plex Mono.
- **Forbidden glyphs in the HTML** (the §10 python check must report `none` and `0`): em-dash
  (U+2014), en-dash (U+2013), arrows (U+2192 / U+2190), the minus sign (U+2212), smart quotes
  (U+2018/2019/201C/201D), and the entities `&mdash;`/`&ndash;`. Use the ASCII hyphen-minus, write
  ranges as "1.8 V to 15 V", and render any overbar as an SVG `<tspan>` or "NOT". **Allowed** (used
  freely in the existing sheets): middle dot `·`, `⊕`, `¬`, and the overlined `Q̄`.
- **§10 gates:** (1) `node --check` on the extracted script; (2) the forbidden-glyph python check;
  (3) structure counts — `grep -c "drawPkg(gT"` must be **5**; (4) per-tier member consistency
  (every `tN.member` read in `updateTN` is created in `buildTN`); (5) a Playwright render of all five
  tiers with the console/page-error listener (mandatory — `node --check` does not catch
  undefined-at-runtime). Sweep the clock and toggle J/K/T across tiers; screenshot and fix any
  collision or off-canvas label.

## 9. Handback checklist

Flag in the handback: the title/lede/part-name all read JK / T flip-flop (no template leftover); any
compactness tradeoffs; any schematic crossings drawn without a junction dot; the feedback loop is
visible in tiers 2–5; the T-mode divide-by-2 is demonstrable in the tier-1 scope; and all §10 gates
pass clean.

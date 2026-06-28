<!-- SPDX-License-Identifier: Apache-2.0 -->

# Bus scaling: the Cable (collapse-to-cable, fan-out-to-process)

**Status:** Design accepted; unbuilt. Supersedes the ad-hoc 16/32-bit plan. Builds
directly on the just-shipped **Bus wiring Phase 1** (name-indexed pin groups +
"draw one strand → auto-complete the rest"). Render/route-only; **sim-core
untouched, golden cannot move** (see [Golden-safety](#golden-safety)).

**North star.** A wide bus is a *physical ribbon cable*: N real conductors that
travel as **one** clean route for the long haul and **fan out into individual,
inspectable strands exactly where you do logic.** The simulation never learns the
word "cable" — it only ever sees the N independent nets it already understood, so
every per-wire guarantee (current, KCL at taps, IR-drop sag, voltage-color,
signal-tracing) survives at full fidelity.

---

## 1. The problem

Phase 1 makes 4-bit buses pleasant: draw `A0→dst.A0`, the rest auto-complete as N
real wires, `nudgeParallel` fans them into a neat ribbon. At 16/32-bit this breaks
down two ways:

- **Clutter.** 16–32 parallel strands over a long haul is a wall of wire.
- **Routing pain.** This is exactly what **HANDOFFS (212)** reverted: N
  *independently-routed* long wires overlapped, ignored the path the player drew,
  and the owner explicitly refused the "smart-bus-routing rabbit hole."
  `nudgeParallel` only evenly-spaces already-co-linear *mid*-segments and
  deliberately skips end legs — **it does not route around obstacles**, so any
  model that keeps N real wires on the haul re-inherits 212 at the worst scale.

The fix must scale to 32-bit **without** losing per-wire visibility, **without** an
age/width/difficulty picker, and **render-only** (the sim still sees N nets).

---

## 2. Recommended approach — the Cable

A **Cable** is a render+route-only overlay that owns **one player-drawn polyline**
(the long haul) and, electrically, **nothing but auto-managed per-bit net-label
aliases**. There are no N long wires to route — there is **one route the player
controls**, plus invisible connect-by-name links the engine already understands.
This is the owner's seed made literal: **collapse to a cable for the run; fan out
to strands where logic happens.**

It maps cleanly onto the existing wiring model:

| Owner's idea | Existing mechanism it reuses |
| --- | --- |
| "combine as one thing for routing" | one `route: Cell[]` polyline, drawn as a conduit (`drawConduitSkin`) |
| "connect without drawing 16 wires" | the **net-label same-name union** in `buildNetlist` (any labels sharing a name are one net, no wire between them) |
| "physically fans out where you plug it in" | `nudgeParallel` lane spacing on the short end-flares (it already lands strands exactly on pins) |
| "depth by pulling, not picking" | the existing **zoom-to-open LoD** ladder (`TIER_ZOOM` / `INTERNALS_ZOOM`) |
| Phase-1 bus detection | `busOfPin` / `parseBusLabel` group `BASE+index` pins (A0..A15) |

The two-job split is the heart of it: **one cable does the routing job** (carry N
signals along one clean route); **the fan-out does the electronics job** (where you
tap, gate, or probe a bit, you unzip into real strands that go to the logic). The
long haul stays a cable; the strands appear precisely where work happens.

---

## 3. Data model — how the sim still sees N independent nets

### 3.1 The overlay (render/route-only, never crosses wasm, never hashed)

One additive, optional snapshot field, following the **verified** `netLabels` /
`mirror` / `pinNames` pattern (emit only when present; restore with `?? []`;
deep-copy for undo; an absent-tolerant `nextCableId` mirroring `nextNetLabelId`):

```ts
// web-only; never serialized into any sim call; never enters snapshot_hash
export interface Cable {
  id: number;
  base: string;                 // friendly name, e.g. "DATA"  (bits → DATA0..DATA15)
  width: number;                // N, inferred from the grabbed bus pin-group
  route: Cell[];                // the ONE long-haul polyline the player drew
  src: { componentId: number; pinIndices: number[] };  // bus pin-group at one end
  dst: { componentId: number; pinIndices: number[] };  // same-width group at the other
  collapsed: boolean;           // LoD / manual zip state
  color?: number;               // optional pinned sheath tint (reuses NetLabel.color path)
  bitColors?: number[];         // optional per-bit ramp (opt-in, fanned-LoD only)
  hardWiredEnds?: ("src" | "dst")[];  // a face fanned to REAL copper for local logic
}

// GraphSnapshot additions (all optional; older saves round-trip byte-identical):
cables?: Cable[];
nextCableId?: number;
```

The Cable **stores no connectivity of its own.** Net membership lives in exactly
**one** place — the name union — so the overlay and the netlist can never disagree
about which bits are which net.

### 3.2 The electrical realization (the existing, already-golden-tested path)

On every graph mutation, a single pure **`deriveCableLinks(graph)`** step in
`graph.ts` ensures, for each cable and each bit `i`, a **matched pair of
NetLabels** — one on `src.pin(i)`, one on `dst.pin(i)` — sharing a generated,
**owner-namespaced** name. `buildNetlist`'s existing second union pass (any labels
sharing a name = one net) then ties each pair into **one independent node per
bit** — identical to the player having drawn N wires, or hand-placed N same-name
label pairs (a path already covered by `netlist.test.ts`'s seal-equals-inline
test).

Three disciplines, lifted verbatim from the critiques, make this safe:

1. **Owner-namespaced names, not bare names.** Each auto-label carries an
   `ownerId` (the cable id) so it is *prune-distinct* from a player's hand-placed
   `DATA7`. The two ends still **share** a name (so the union fires), but the cable
   remains the **sole author** of its own labels. A bare prefix is insufficient —
   use a real owner field. (A hand-placed `DATA7` legitimately joining the bus is
   acceptable KiCad-style behavior, but the cable must never *prune* or *duplicate*
   a label it doesn't own.)
2. **Idempotent (create-if-missing / prune-orphans).** Re-running
   `deriveCableLinks` twice yields byte-identical labels in identical order, so
   node numbering never drifts. **Do not** route through `addNetLabel` (it has a
   one-label-per-endpoint guard and no name-uniqueness enforcement); the derive
   step writes/prunes directly.
3. **`graph.ts` is the SOLE mutation point**, all ops undo-tracked, so the overlay
   and its owned labels stay coherent across rename / delete / retap / pin-move /
   breakout. Deleting a cable drops only *its* labels.

### 3.3 Whole-bus connect-by-name (the long-distance, no-wire case)

For a bus that connects across the board with **no drawn route at all** (the bus
analogue of a global label), support a **range net-label** `A[15:0]`. Pure helpers
`parseBusRangeLabel("A[15:0]") → {base:"A", hi:15, lo:0}` + inverse; when
`buildNetlist` sees a range label on a bus member it lowers it to per-bit names
(A15..A0) — i.e. it lowers into the **same** per-net union. Two matching
`A[15:0]` labels = N connected nets, zero wires. (Covered by the headless "range
label == N inline per-bit labels" test.)

---

## 4. Golden-safety

Safe **by construction**, on three independent grounds — not "we kept it green,"
but "there is no new path to the hash":

1. **`sim-core` is literally untouched.** No new `ELEM_*`, no param slot, no
   change to `set_netlist_pe`. The wasm core receives the same N-node netlist it
   would from hand-placed labels. `cargo test -p sim-core` (incl.
   `run_is_reproducible` and the FNV-1a golden) cannot be affected.
2. **`buildNetlist` connectivity is unchanged.** The only connectivity path is the
   pre-existing same-name union. `Cable` is not a component, junction, wire, or
   label-*name* — `buildNetlist` never reads it. The connectivity it *implies* is
   carried entirely by per-bit NetLabels created as an **undo-tracked graph edit**
   at derive time, **not** a netlist-time transform, so the compiler stays exactly
   as written.
3. **The overlay never crosses the boundary or enters the hash** — same guarantee
   already documented for `NetLabel.color`, wire `waypoints`, and
   `failed_elements`.

The **golden circuit has zero cables and zero labels**, so `cables: undefined` →
zero delta and `labelSig` stays empty → byte-identical `snapshot_hash`. Old saves
round-trip via `?? []`. A viewer that ignores the `cables` key still sees the
per-bit labels and simulates a correct (un-sheathed) circuit — **graceful
degradation**: the circuit is fully specified by labels + pins + wires alone.

**Verification gates (must be green, no regeneration):**

- `cargo test -p sim-core` — untouched control (no `.rs` change).
- New vitest: `buildNetlist(cable)` === `buildNetlist(N hand-wires)` ===
  `buildNetlist(N hand-labels)`, **node-for-node** (types/values/a/b/c arrays).
- New vitest: `deriveCableLinks` is **idempotent** (run ×N → identical labels +
  order).
- New vitest: range label `A[15:0]` == N inline per-bit labels.
- `renderProbe` geometry: collapsed draws a **multi-conductor sheaf** (visible
  strands/ribs, never one opaque line); fan strands land on the **actual pins**.

---

## 5. Interaction — pull-not-pick throughout

No width field, no age/difficulty control. **Width is inferred** from the grabbed
bus pin-group (`busOfPin`); **depth is revealed by zoom and by how you pull.**

- **CREATE (zip).** Same gesture as Phase 1: draw one strand between two same-width
  buses. For a long haul, instead of laying N routed wires, the system creates
  **one Cable** along the path you drew + derives the 2N aliases, in one undo. The
  drag preview shows a fat conduit that splits into N ghost-strands at each end
  (the promised Phase-2 live fan preview). Bundling is the **default for long
  hauls** (a reversible action, never a modal "[Tab]?" picker); a short hop stays
  plain strands. Creation is **gated** by `planBusAutocomplete`'s proven strictness
  — equal width, aligned offset, siblings free — refusing mismatches with a hint
  rather than silently mis-wiring an invisible alias.
- **COLLAPSE / FAN-OUT (the unzip — the core gesture & the lesson).** A per-end
  chevron handle (shaped like a splayed ribbon end) toggles that end between
  **zipped** (one jacket meeting the part edge) and **unzipped** (the jacket flares
  into N color-coded strands landing on their pins). Unzip one end, leave the other
  zipped — exactly like breaking out a ribbon at the connector but bundling it
  along the chassis. Also automatic by **zoom** (see §6). "Fan out **permanently**
  here" converts that face's alias hop into **real copper** (`hardWiredEnds`) for
  doing logic mid-haul.
- **TAP a few bits (the wide-bus win).** Hover the collapsed cable to raise a
  **bit-window LED-strip scrubber**: a thin strip of N lit cells in bit order, each
  cell colored by its net's voltage color — so a 16-bit cable is a **live 16-bit
  value readout** (bus-as-instrument, strongly on-aesthetic). Drag-select a
  contiguous run (`[4:7]` = the low nibble in one drag) or click cells to
  multi-select; the chosen bits **pop out** as a small sub-ribbon you route to your
  adder, the rest stay trunked. End-labels (A0 / A15) make off-by-one impossible.
  This replaces ever typing a `[start:end]` picker — you point at the bits.
- **SLICE / SPLICE.** Sub-range faces are first-class: `DATA[7:0]→destA`,
  `DATA[15:8]→destB`. Cross-width splices refuse with a hint, never silent.
- **EDIT / PROBE.** Name the cable (DATA→ADDR rewrites all owned label names
  atomically); pin a tint (writes `color`, the existing per-net override). Hover
  any strand (ghosted or fanned) to net-highlight end-to-end and read that bit's
  live V/I (reuses net-highlight #80) — because each bit is a real node. Edit width
  by adding/removing aligned members. **Self-heal:** if a member pin moves off the
  group or a strand is deleted, the cable drops that member and **dissolves below
  2**, so the overlay can never lie about the wires.
- **CONVERT.** A clear ribbon ⇄ cable affordance (so there aren't two confusing
  mental models for one connection), and the machine-owned alias labels are
  **hidden from the rename UI**.

---

## 6. Rendering — a cable that fans to visible strands

The jacket is **one** thick rounded conduit along `route` (reuse the conduit skin +
flow carriers). At each end a **fan-out flare**: over a short ~2-cell transition
the jacket edge splays into N thin strands that bend to their pins, spaced by
`nudgeParallel`'s lane pitch (which already skips end legs, so strands land exactly
on the header). **The long haul is exactly one route; only the end flares are
multi-strand** — that is the structural answer to 212.

**LoD on the existing zoom-to-open ladder** (same law as opening a cell):

1. **Zoomed out / long haul:** one jacket + a `×N` conductor-count badge + the bus
   name. Clutter is O(1) regardless of width — the whole point.
2. **Mid zoom:** the end flares render their N strands explicitly; ghost-strands
   appear under the jacket on hover.
3. **Zoomed in / hover:** **X-ray** — the casing goes semi-transparent and **all N
   real strands draw continuously through it** as a true ribbon, each with its own
   voltage color, flow carriers, KCL dots, IR-drop sag. (Gate behind a strand-count
   **thinning cap** at 32-bit to stay GPU-cheap.)

Crossfade strand/sheath alpha between thresholds so the cable **unzips** rather than
pops (reuse the tier-swap easing). Local **breakouts**: a tap on a collapsed strand
forces a short local fan window so that one strand peels out, gets its junction dot,
and rejoins — exactly how a real ribbon breakout looks.

**Honesty on the collapsed state:** the jacket carries a **multi-conductor texture**
(2–3 ribbon ribs / inner hairlines above a zoom threshold) so it **always reads as
many conductors, never one opaque line.** Flow carriers on the solid jacket are an
explicit **summary**; per-strand flow **always** returns on zoom/hover/tap. A
mixed-voltage bus shows a neutral jacket (never one fake hue); magnitude lives on
the per-strand belts when fanned. **FAIL / over-current strands punch through** the
jacket so a bad conductor is visible even bundled.

**Color law.** Default is **voltage-truthful** (hue = rail identity, the CLAUDE.md
design law). The optional per-bit ramp (`bitColors`) is **opt-in and gated to the
fanned LoD only**; the collapsed jacket and the default stay voltage-truthful.
Tints reuse the `NetLabel.color` render-side override path.

### SHOW THE WIRES — the explicit guarantee

The cable **never** collapses the strands into an opaque abstract line. Every
conductor is, at all times, a **real net** the solver computes independently. The
strands are drawn individually at the fans, on hover (ghost), in the X-ray view,
and in any breakout; the collapsed jacket reads as a visible sheaf with a `×N`
count, and **per-strand current / KCL / voltage-color / IR-drop / signal-tracing
are one zoom or one hover away, always.** This is enforced by `renderProbe` tests,
not left to good intentions.

---

## 7. Hierarchy — buses through sealed ICs (the actual CPU win)

This is **not deferred** — it is the literal `sand→CPU` goal (regfile ↔ ALU ↔ bus
across sealed sub-assemblies). A sealed user-IC whose author named its pins
`DATA0..DATA15` exposes them as a **single bus pin-GROUP port** that renders + accepts
a Cable as one fan-out, the same way it plugs into a discrete part. A 16-bit bus
passing **through** a sealed cell is just a Cable to the cell's bus-pins on each
side — no special nesting logic, because `busOfPin` already groups indexed pin
names and they survive sealing. **Caveat to enforce at seal time:** `busOfPin`
needs indexed pin names, so the bus-order naming convention must be taught/enforced
when an author seals a bus port (otherwise there is no canonical bit order).

---

## 8. Alternatives considered

- **Pure render-overlay over N real wires (Proposal 1 "Trunk-and-Tap"; Proposal 3
  "Sheath LoD").** Keeps N real wires on the *entire* haul and gathers them at draw
  time. Best raw "show-the-wires" story and zero new connectivity — **but it does
  not reduce wire count or routing**, so it re-inherits the **212 revert** at 32-bit
  (verified: `nudgeParallel` skips end legs and never routes around obstacles). It
  silently fails half the brief (the clutter/routing pain). *We keep their best
  ideas* — Proposal 1's **bit-window scrubber**, **striped ribbon-in-sleeve**, and
  **self-heal rule**; Proposal 3's **derived-render-state discipline**
  (`conduitDrawRoutes`-style) and the **range-label lowering** — but not their
  N-real-wires-on-the-haul substrate.
- **Per-frame geometric bundle *detection* as the source of truth (Proposal 3).**
  Rejected as the primary path: a teaching tool can't have buses that **flicker
  un-bundled**, heuristic geometry misses hand-routed buses, and it adds cost to the
  `redrawWires` hot path. A Cable is an **authored** object, not a guess. (Kept only
  as an optional convenience to *offer* converting an existing co-aligned ribbon.)
- **A three-struct Bundle model (Proposal 2:
  `Bundle`/`BundleEndpoint`/`BundleTrunk`).** Correct architecture (same alias
  spine), but **two+ sources of truth** to keep coherent and more persisted state
  than needed. We adopt its **discipline** (single mutation point, graceful
  degradation, sub-range/mid-tap/hardWired-face vocabulary) on top of a **single
  flat `cables` array** that decomposes to labels — the lowest persisted-state
  member of the family.

(The accepted design is the panel consensus: Proposal 5's ribbon-cable **skin** over
Proposal 4's alias **spine**, with Proposal 2's data discipline, Proposal 1's
collapsed-state instruments, and Proposal 3's range-label lowering.)

---

## 9. Teaching note — the ribbon cable, at any age

The UI **is** a ribbon cable, so "a bus is just N wires glued together so they
travel as one" is **shown, not told.** Three real-world things map 1:1 to three
states: loose strands (today's wires) → the bonded jacket (collapsed, for the run)
→ the breakout connector (the fan-out where strands separate to reach pins). The
**unzip gesture is the lesson** — you watch the cable splay into N color-coded
conductors.

- **A 7-year-old:** draw a line, watch it bunch into a cord; tap the chevron to
  bunch/unbunch; pull one string out to wire it somewhere; zoom in and *see* all
  the little wires inside.
- **An EE:** plug `A[15:0]` regfile→ALU as one harness; collapse for the haul;
  scrub the bit-window to read the live value; drag-select `[7:0]` off the bus to a
  bit-slice; name it `DATA`; probe bit 9's current on hover.

Same surface, same gestures — **depth from zoom and from how hard you pull. No age,
width, or difficulty picker anywhere.**

---

## 10. Build order (cheap → big), starting from Bus Phase 1

- **P0 — Data + compile (no pixels; proves golden-safety).** Add the optional flat
  `cables` array + `nextCableId` to `GraphSnapshot` (verified additive pattern,
  `?? []` restore, deep-copy for undo). Implement the pure, **idempotent,
  owner-namespaced** `deriveCableLinks(graph)` in `graph.ts`, run before the
  existing union in `buildNetlist`. Ship the headless gates: cable-netlist ==
  N-hand-wires == N-hand-labels (node-for-node) + idempotency. **`sim-core`
  untouched.** *This alone makes 32-bit long hauls work and removes the N routed
  wires — the actual scale win — at zero renderer risk.*
- **P1 — Create gesture + minimal render.** Extend Phase 1's
  `busOfPin`/`planBusAutocomplete` detection: on a clean same-width connect, create
  ONE Cable (the drawn polyline) instead of N wires, one undo. Render as a thick
  conduit that fans (via `nudgeParallel`) to strands at both ends. Now 16/32-bit is
  one gesture + one managed route, strands visible at the ends.
- **P2 — LoD unzip + conduit skin.** Wire collapsed↔X-ray to the existing
  zoom-to-open thresholds; per-end chevron toggle; ghost-strands on hover; the
  3-rung LoD with crossfade; the multi-conductor sheaf texture + `×N` badge. Add the
  `coreWidth` param to `drawConduitSkin` (it is single-width today — budget this as
  **real** PixiJS work, not a freebie). `renderProbe` geometry tests.
- **P3 — Fan-out-to-process + edit ops.** Mid-span single-strand breakout;
  `hardWiredEnds` (alias → real copper where logic happens); rename / recolor /
  resize / delete-as-unit; ribbon ⇄ cable converter; hide machine labels from the
  rename UI; per-strand hover-probe parity (#80).
- **P4 — The wide-bus instruments.** Bit-window LED-strip scrubber (live N-bit
  readout, contiguous drag-select + multi-select → sub-ribbon); sub-range
  slice/splice (`[7:0]`/`[15:8]` to different dests); end-labels everywhere.
- **P5 — Hierarchy (the CPU bar — schedule, don't defer).** Sealed user-IC bus
  pin-GROUP port: render + accept a Cable as one fan-out; a Cable passing *through*
  a sealed cell; enforce indexed-bus-pin naming at seal time. Range-NetLabel
  `A[15:0]` whole-bus connect-by-name. Worked 16-bit datapath example (regfile ↔ ALU
  ↔ bus) in `examples.ts` to prove the arc. Strand-count thinning cap on the 32-bit
  X-ray path; FAIL punch-through. Run the full web gate; confirm `netlist.test.ts`
  golden unmoved.

---

## 11. Open questions

1. **Sealed-bus naming enforcement.** Should the IC-maker *require* indexed pin
   names (DATA0..DATAn) to expose a bus port, or auto-suggest them? `busOfPin` has
   no canonical order without them (§7).
2. **Aggregated flow on the collapsed jacket.** Is the summary carrier field
   acceptable as a documented LoD trade, or should the collapsed state always show
   thinned per-strand carriers (heavier draw)? Owner is sensitive here.
3. **X-ray strand cap.** At what width do we switch from "all strands through the
   jacket" to "representative subset + count"? 16? 24? Needs a GPU budget pass.
4. **Default-bundle vs offer.** Is silently bundling every long-haul same-width
   connect the right default, or should the first one teach with a one-time
   non-modal hint? (Must never become a picker.)
5. **Range-label vs Cable overlap.** A whole-bus `A[15:0]` connect-by-name and a
   drawn Cable can both express the same connection — do they reconcile to one
   object, or coexist as "wired cable" vs "named bus"?
6. **Hand-placed label joining a cable's net.** KiCad-correct (a stray `DATA7`
   joins), but a footgun for a wide invisible bus — surface it (highlight on
   collapse?) or guard it?
7. **Mixed-width / reordered buses.** Beyond contiguous `[hi:lo]` slices, do we ever
   need arbitrary bit permutations (a crossbar), and if so where does the bit-order
   UI live without becoming a picker?

# Ground returns — making "where the current comes back" a real game

The thesis, in one line: **a ground is not a magic 0 V sink, it is the
return half of every loop — so model the return path as real nodes with R+L,
let the loop's *enclosed area* feed a deterministic noise term, and hand the
player a paintable *ground zone* as the unlocked escape hatch — never a tax.**

Status: **design ideation. No code.** This is the grounding-physics companion to
`docs/ui/visual-language.md` (which already mandates *"one aggregate ground
return"* and *IR-drop sag*), `docs/game-factory-loop.md` (belts, districts,
black-boxing), and `docs/game-contracts-economy.md` (Lux-gated tiers, the spec
grader, anti-cheese). It cashes in the hook the parts work planted but never
specified: the loop-tile's **"ideal ground" vs "real return"** toggle, *"the
seed of inductance, radiation, and shared ground noise once the higher tiers
remove the ideal ground."* This doc is that seed grown into a tiered design-rule
system. Where I push on or extend the existing docs I say so.

Two non-negotiables, inherited and honored throughout: **determinism is sacred**
(FNV-1a snapshot hash + pinned golden; `docs/determinism.md`) — every quantity
that touches the solve is a pure function of grid topology/geometry and the tick
— and the **JS↔wasm boundary stays coarse** (one batched snapshot per frame;
`web/src/sim/loop.ts`). The bet of the whole project — *the belts never lie* —
means a grounding penalty earns its place only if it is honest physics the
solver actually integrates or a geometric measure the solver actually consumes,
never a faked "bad layout" gotcha.

---

## 0. The problem, stated precisely

Today every `GND` part pins its net to **node 0** — a perfect 0 Ω star to an
infinite reservoir (`parts-roadmap.md`: *"GND … only pins a net to node 0"*).
That is correct, deterministic, and *pedagogically inert*. It produces the
owner's failure mode #1: the optimal play is **"shove a GND part next to every
load."** Every ground is the same ground; proximity is free; there is no such
thing as a return path because every node teleports to the reference. A real
board has exactly one thing this model erases — **the return current has to
physically travel back to the source through copper that has resistance and
inductance**, and *how* it travels (how long the path, how much area the loop
encloses, whether two loads share a segment) is most of power integrity and EMC.

The opposite failure (mode #2) is to "fix" this by becoming a PCB editor: copper
pours, layer stackups, via stitching, field solvers. That explodes scope, drags
in 2-D/3-D EM that our lumped MNA core cannot carry deterministically at frame
rate, and buries the lesson under CAD.

**The middle path is a lumped, on-grid model of the return path plus one
geometric abstraction (enclosed loop area), gated by the tech tree so the
complexity only ever appears after the player has a reason and a tool to manage
it.** The rest of this doc builds exactly that.

---

## 1. The spectrum of grounding models — and where to land

Four rungs, from today's model to the one we reject. I recommend climbing to
rung 3 and **stopping hard** before rung 4.

| Rung | Model | What it adds | Cost / honesty |
| --- | --- | --- | --- |
| **0. Ideal star (today)** | every `GND` ⇒ node 0; 0 Ω to ∞ | nothing — the baseline | free, deterministic, teaches nothing about return |
| **1. Lumped return impedance** | the return is a *real net* of segments, each `R + L` on the grid; the reference node is reached *through* them | IR drop on the return, shared-impedance coupling, ground bounce under fast `di/dt` | a few extra linear stamps; already how we model any conductor — **honest** |
| **2. Ground *zone* (the abstraction, not copper)** | a paintable region/district that acts as **one low-impedance shared return node**; buildings "stitch" to it cheaply | star-vs-plane-vs-daisy-chain as a *choice*; the convenient escape hatch | one synthesized low-R/L net per zone — **honest enough**, and the key UX move |
| **3. Loop-area EMI term** | the area a current loop *encloses on the grid* feeds a deterministic induced-noise figure | ground loops, the return "wanting" to hug the signal, radiated/induced noise | a **geometric measure** off the grid → a noise term; presentation + grading, *not* a field solve |
| **4. Full multi-layer PCB** | copper layers, stackup, vias, plane cuts, field solver | "real" EM | **rejected** — see below |

**Why stop at 3.** Rungs 1–3 are all expressible as *(a)* extra linear branch
stamps the MNA core already supports (`R`, and `L` via the existing
backward-Euler companion — `parts-roadmap.md`), plus *(b)* a single scalar
geometric quantity (loop area) computed by walking the same union-find/grid we
already have. None of them needs a new solver class. None of them needs 2-D
fields. They map cleanly onto the existing visual language (height = voltage,
thickness = current, IR-drop sag, the loop-tile shading). And critically, each
rung is a **tech-tier switch** (§4) — so the player meets them one at a time,
each with a tool to handle it.

**Why reject rung 4 outright.** A copper-layer PCB editor (a) requires a 2-D/3-D
field solve for mutual inductance and return-current distribution that our
lumped, deterministic, fixed-step core is the wrong tool for and that would not
reproduce bit-for-bit across machines without enormous care; (b) explodes the UX
into stackup managers, via tools, and plane-cut editors — a different game; and
(c) buries the *lesson* (return paths have impedance; loops radiate; sharing a
return couples loads) under CAD ceremony. Rung 3 teaches every one of those
lessons with a lumped surrogate. **We are a teaching game about why grounding
matters, not a layout tool.** If a player wants Altium, they know where to find
it. The day someone demands real plane analysis, the honest answer is a separate
"export to a real EDA tool" bridge, not bolting a field solver into the sim core.

> **Recommendation:** ship rung 1 as the first non-ideal grounding tier, rung 2
> as the *same-tier escape hatch* (you unlock impedance and the plane together,
> so the lesson and its remedy arrive as a pair), and rung 3 one tier later as
> the EMI/loop-area capstone. Never build rung 4 into the sim.

---

## 2. The lumped return model (rung 1) — the honest core

This is the load-bearing change and it is small. **Stop treating `GND` as a
teleport to node 0. Treat the ground/return as an ordinary conductor net that
happens to terminate at *one* reference tie, and make its segments carry `R+L`
like any other belt.**

Concretely, on the grid:

- **One reference tie per island.** Exactly one `GND` part (the "earth stake" /
  supply return) is the true node-0 anchor. (Today *any* `GND` anchors; the new
  rule is the **first/primary** `GND` anchors and the rest become *return taps*
  that must reach it through copper.) This keeps current-source-only loops
  solvable exactly as `parts-roadmap.md` intends — the anchor still exists — it
  just stops being everywhere at once.
- **Return segments are R+L stamps.** Each grid edge of the ground/return net
  gets a small series resistance `Rseg = ρ·len` and series inductance
  `Lseg = λ·len` (per-unit-length constants, `len` = the edge's grid length).
  These are exactly the stamps the core already has — a resistor conductance and
  an inductor backward-Euler companion branch. **No new solver machinery.**
- **The reference is reached *through* the net.** A load's local "ground" pin now
  sits at `V = I_return · Z_return_to_anchor` above true zero — i.e. it is **not**
  0 V, it is wherever the return IR/`L·di/dt` drop puts it. That number is the
  whole lesson.

Everything the visual language already specifies now becomes *true of the return,
not just the supply*:

- **IR drop on the return rail.** `docs/ui/visual-language.md` already draws
  *"the aggregate return flows back along the ground bus"* and mandates IR-drop
  sag. Today that return is cosmetic (it's all node 0). Under rung 1 the return
  bus **actually sags** — the GND-coloured belt (`#6b6488`) develops height
  *away from zero* as current crowds back through a thin/long return. The player
  sees "my ground isn't at ground."
- **Shared-impedance coupling, for free.** If two loads' return currents flow
  through the **same** return segment before reaching the anchor, that segment's
  `I·R + L·di/dt` is in *both* their ground references — so load A switching
  modulates load B's ground. This falls out of the solve automatically the moment
  the return is a real shared net; we don't add a coupling term, the topology
  *is* the coupling. This is the single most important real lesson grounding
  teaches and rung 1 produces it as a side effect.
- **Ground bounce under fast switching.** The `Lseg` term means a fast `di/dt`
  (a logic gate's edge, a switch in a buck) develops `L·di/dt` volts across the
  return inductance — the local ground *bounces* during the edge. Deterministic
  (it's the existing inductor companion on the existing tick grid), visible (a
  transient spike in the GND belt height at the moment of switching), and exactly
  why real boards stitch grounds and add decoupling.

**What rung 1 kills (the design win):** "shove a GND next to the load" now does
**nothing useful** unless that GND's *return path back to the anchor* is short
and fat. A local GND tap with a long thin return is *worse* than a short fat
shared bus. Proximity to a GND *symbol* stops mattering; proximity (in return
impedance) to the *anchor* starts mattering. The player is now optimizing a real
thing.

> **Where I extend `visual-language.md`:** that doc says *"one aggregate ground
> return (drawn once for readability, not a wire per load)."* That aggregate
> drawing is right for the **ideal** tier and should stay the default look. But
> once rung 1 is on, the return is genuinely a net with structure, and the
> player needs to *see the structure they're being graded on*. Proposal: keep
> the single aggregate return as the calm default, but add a **"return path"
> overlay** (toggle, or auto-on when a return-rule is active) that un-aggregates
> it — drawing the actual return segments, their thickness (return current),
> their sag (return IR drop), and a highlight on the worst (longest·thinnest)
> segment. The aggregate is the postcard; the overlay is the X-ray you flip to
> when a contract grades your return.

### Determinism of rung 1

Every added quantity is a pure function of grid geometry and the tick:

- `Rseg`, `Lseg` are `ρ·len`, `λ·len` with **fixed** per-unit-length constants
  and `len` an **integer** grid length — no floats from geometry, no hashing, no
  wall clock. They stamp into the same fixed element order.
- Choosing the anchor is a deterministic tie-break (e.g. lowest grid-sorted
  `GND` part id), the same kind of stable ordering the determinism contract
  already requires for evaluation order.
- The inductor companion is already in the golden's vocabulary; adding return
  inductors is "more inductors," not a new integration scheme. `run_is_reproducible`
  holds; if behavior of an *existing* golden circuit changes (it will, the moment
  its returns stop being ideal), that is a **deliberate, reviewed golden
  regeneration** per the contract — and the gating in §4 means we can keep the
  ideal-tier golden untouched and add new non-ideal goldens beside it.

---

## 3. The ground *zone* (rung 2) — the escape hatch you unlock, not a tax

Rung 1 introduces the *problem* (returns have impedance). Rung 2 introduces the
*tool* — and the owner's constraint ("not annoying to route") is satisfied
**entirely** by shipping them together. The ground zone is the in-game "pour a
plane and stitch to it" without any copper-layer machinery.

**What it is.** A **paintable region** on the board — a district-scoped overlay,
reusing the districts metaphor (`architecture.md`, `game-factory-loop.md`) — that
the player drags out over an area. Buildings whose ground pin sits *inside* the
zone can **stitch** to it (a near-zero-impedance tap). The zone itself is modeled
as **one synthesized return net with very low aggregate R+L** between any stitch
point and the anchor (because a plane has enormous parallel copper — a low, *area-
and-stitch-dependent* impedance, not literally zero).

**Why it's an abstraction, not a copper layer.** We do *not* simulate the 2-D
current distribution in the plane. We collapse the whole zone to a single
low-impedance node (or a small fixed lumped model) reached from each stitch with
a short return. That is a *lumped* surrogate for a plane — honest enough to teach
"a plane gives every load a short, shared, low-impedance return," which is the
lesson, without a field solver. It is the exact same move the engine already
makes elsewhere: *black-boxing* a sub-assembly to a behavioral block that runs
only at its pins (`game-factory-loop.md` §3). **The ground zone is a black-boxed
return network.**

**The three grounding *styles*, now a real choice the player makes:**

- **Star** — every load runs its own dedicated return to the anchor. No shared
  segments ⇒ no shared-impedance coupling, but lots of copper and long runs for
  far loads. Best for sensitive analog. The player builds this by routing
  individual returns (rung 1 mechanics).
- **Daisy-chain** — loads share one return bus in series. Cheap and tidy, but the
  *downstream* loads sit on top of *everyone's* return drop — the classic
  shared-impedance trap. The player builds this by tapping a common return bus;
  the overlay shows the cumulative sag growing along the chain.
- **Plane** — the ground zone: everyone stitches to one low-impedance region.
  Short returns for all, minimal shared-impedance, at the cost of *area* (a
  Credits/unlock sink — see §5) and the discipline of stitching. The player
  builds this by painting a zone.

This is real grounding pedagogy — *star vs daisy-chain vs plane is a genuine
engineering decision with genuine trade-offs* — and it emerges from giving the
player both the lumped-return mechanics (rung 1) and the zone tool (rung 2) in
the same tier. **Routing returns becomes a satisfying optimization** (shorten the
worst segment, split a shared return, decide what deserves a star vs the plane),
and **the zone is the convenient answer you reach for** when the routing isn't
worth it — exactly the "escape hatch you unlock, not a tax" the owner asked for.

> **Where I push on `game-factory-loop.md`:** it frames districts as electrical
> islands for ΔT/black-boxing. I'm proposing districts (or a sibling overlay)
> *also* carry a grounding role — a district can host a ground zone. That's an
> extension, and it wants an owner ruling: is the ground zone a property of a
> district, or an independent paintable layer that happens to scope like one?
> (Open question, §7.)

### Determinism of rung 2

The zone is a deterministic function of *which grid cells the player painted* and
*which building pins fall inside*: integer cell membership ⇒ a synthesized net
with a lumped `R+L` that is a fixed function of stitch count and zone extent (all
integers/fixed constants). No geometry floats, no hashing. It collapses to the
same kind of stamp set rung 1 already produces; the snapshot hash sees ordinary
nodes and branches.

---

## 4. The design-rule tiering mechanic — how grounding rules switch on

The whole reason this stays *fun* and not *punishing* is that grounding fidelity
rides the **exact same Lux-gated tech-tree ladder** as part fidelity
(`game-contracts-economy.md` §3: *"the player literally buys reality"*). You do
not get hit with return impedance on day one; you *unlock* it when you've earned
the right and been handed the tools to manage it. Grounding becomes one more rung
of *fidelity-as-progression*, the project's core pillar.

**The grounding tiers (mapped onto the existing tech tree):**

| Grounding tier | Rule that switches on | Unlocked alongside | Player's tool |
| --- | --- | --- | --- |
| **G0 — Ideal star (default)** | every `GND` = node 0 (today) | Tier I ideal passives | drop a `GND` anywhere |
| **G1 — Return impedance** | the return is real `R+L`; only the anchor is true zero | with real-passive parasitics (ESR, tolerance) — *"returns are conductors too"* | route short/fat returns; read the return overlay |
| **G2 — Ground plane** | the **ground zone** tool exists; star/daisy/plane become a choice | *same tier as G1* — the escape hatch ships with the problem | paint a zone, stitch loads |
| **G3 — Loop-area / EMI** | enclosed loop area feeds an induced-noise figure; the "real return" loop-tile shading goes live | with fast switching / RF-ish parts (oscillators, fast logic) where `di/dt` makes it bite | minimize enclosed area; hug returns to signals; use the plane to shrink loops |
| **G4 — Shared-ground noise budget** | contracts grade a *noise floor* affected by all the above | digital/mixed-signal tier (ADC near switching) | partition grounds; the analog/digital split lesson |

The pacing principle, stated flatly: **a rule only switches on once the player
owns a tool to handle it.** G1 (problem) ships with G2 (plane). G3 (loop-area
noise) ships only when the player has fast parts whose `di/dt` actually creates
the noise *and* has the plane to shrink the loops. This is how we avoid "overly
penalizing": you are never graded on a constraint you can't yet manage.

### How the loop-tile "real return" shading goes live at G3

This is the concrete payoff of the seed. The loop-tile already distinguishes
*carriers* (charge, slosh) from *energy* (`v·i`) and already has the concept of
an **"ideal ground" vs "real return"** toggle that **shades the loop area the
circuit encloses** (`docs/ui/visual-language.md`, `parts-catalog-ideation.md`).

- At **G0–G2** the toggle defaults to *ideal ground*: the return is drawn (sag
  and all at G1) but the **enclosed area is not shaded** and not graded.
- At **G3** *real return* becomes the default: the renderer **shades the polygon
  enclosed by the supply path out and the return path back** — the literal loop.
  The **shading intensity** encodes the induced-noise contribution (bigger loop,
  more `di/dt` ⇒ darker/hotter shade). The player *sees the antenna they built.*
  Hugging the return tight against the supply (small enclosed area) makes the
  shade collapse — the visceral lesson that **the return wants to hug the
  signal**, and that a plane (which lets the return mirror the signal underneath)
  is the cleanest way to make the loop area ≈ 0.

That shading is **presentation + a grading scalar**, never a field solve (§3,
rung 3). The next subsection makes the scalar deterministic.

### The induced-noise term, deterministically (rung 3 math)

We need a number that *behaves like* "this loop radiates / picks up noise"
without Maxwell. The faithful-enough lumped surrogate:

```
noise_emi  ∝  Σ_loops ( enclosed_area(loop) · peak|di/dt|(loop) )
```

- **`enclosed_area(loop)`** is a **purely geometric, integer** quantity: walk the
  current loop on the grid (out via the supply edges, back via the return edges —
  both already known from the netlist/union-find) and compute the enclosed cell
  count by the shoelace formula on integer grid coordinates. Integer in, integer
  out — **bit-identical across machines**. No floats from geometry.
- **`peak|di/dt|`** is read off the deterministic solve (the existing inductor
  branch currents differenced on the fixed tick grid) — already a committed,
  reproducible quantity.
- The product feeds a **noise figure** that is (a) *displayed* (the loop shading,
  a "noise floor" readout) and (b) *injected as a graded penalty* into the
  affected net for contract scoring (§5) — e.g. an added noise band on the scope
  trace whose amplitude is `noise_emi · k`. Whether it also perturbs the *solve*
  (a small noise voltage on the return) or only the *grading/visual* is an
  **open question** (§7): perturbing the solve is more honest but must be a
  deterministic function of the tick (a fixed pseudo-pattern seeded by topology,
  not an RNG), or it threatens the golden. **My lean: grade-and-display only at
  first** (the noise figure scores the contract and shades the loop, but the node
  voltages stay clean), because that keeps the existing golden math *untouched*
  while still teaching the lesson, and we can promote it into the solve later
  behind its own tier and its own golden.

This is the same philosophy as the *incomplete-circuit* `singular()` flag
(`docs/ui/incomplete-circuits.md`): compute an extra **scalar** off the existing
fixed-order pass, fold it into the **existing** once-per-frame snapshot, keep it
**out of `snapshot_hash`**, and use it for UI + grading — never branch the solve
on it. One more scalar across the coarse boundary, never a per-loop call.

---

## 5. Scoring violations without being annoying — the "Lux, not a wall" rule

The owner's hard constraint: *not overly penalizing or annoying to route.* The
scoring design follows directly from `game-contracts-economy.md` §4 (the sim is
the only judge; reward what grinding/spam can't fake; multipliers, not gates) and
`game-rewards.md` (failure-as-fun, hints cost margin not money).

**Principle 1 — grounding is (almost always) a *bonus axis*, not a pass/fail
gate.** A bad ground does **not** fail a contract whose hard spec is met at the
pins (that would be annoying and would resurrect "one true layout"). Instead it
**caps the bonus tier**: a circuit that meets `V_out = 3.3 V ± 2%` but does it
with a 40 mV ground-bounce noise floor still **Bronzes** — it ships, it pays
Credits. But **Silver/Gold/CEC-Certified require a clean return** (low return
drop, small loop area, an acceptable noise floor). This mirrors the existing
elegance/margin multipliers exactly: grounding becomes a fourth multiplier axis
alongside realism, elegance, and margin. *Good grounding is how you earn the
green band's prettiest version, not a barrier to shipping at all.*

**Principle 2 — the *only* place grounding is a hard gate is a contract that is
explicitly about grounding.** A "low-noise sensor front-end" or "mixed-signal
ADC board" contract *can* put the noise floor in the hard spec — because then the
return path **is** the deliverable, and grading it is honest acceptance-testing,
not a layout tax. These are a deliberate, signposted contract *family* (like the
"survive a load transient" family that teaches decoupling), not a tax on every
build.

**Principle 3 — violations are *located and explained*, never a bare fail.** This
is the `incomplete-circuits.md` doctrine applied to grounding: **mark the suspect
thing, name the cause, keep the sim running.** Concretely:

- A **located hint chip** (amber `--warn`, the existing `scope-tag` vocabulary):
  *"Long return path — load B's ground sits 38 mV above the anchor."* Naming the
  cause is what teaches.
- **Highlight the offending return segment** — the worst (longest·thinnest)
  segment glows; the **return-path overlay** (§2) shows exactly where the current
  crowds back. "Your return is too long *here*."
- At G3, **the loop shading IS the violation display** — the big dark enclosed
  area *is* the feedback; the player shrinks it by routing the return back closer
  or stitching to the plane.
- **A noise-floor readout** on the scope (the green-band metaphor): the spec band
  plus the actual noise band; the bonus tier you're hitting updates live as you
  tighten the ground.

**Principle 4 — the plane is always available as the satisfying answer.** Because
G2 ships with G1, a player who finds return-routing fiddly can *always* paint a
ground zone and stitch — trading board area (a Credits/area sink,
`game-rewards.md`) for a clean return. That's the escape hatch: the optimization
is *opt-in depth* (route a tight star for the elegance bonus and the Lux), and
the plane is the *floor* (pay area, get a clean-enough return, ship). Neither is
a wall.

**Principle 5 — anti-cheese falls out of the existing firewall.** Could a player
spam ground zones / stitch points to brute-force a clean return? Same answer as
`game-contracts-economy.md` §4.5: the **BOM/area/par** score makes spam
economically self-defeating (zones cost area = Credits; over-stitching tanks
elegance), so it can Bronze but never Gold. We **never forbid a topology**; we
let the par make degenerate grounding lose. And because the noise figure is
computed from real geometry+`di/dt`, you can't fake a clean ground floor — you
have to actually build a small loop or a real plane.

---

## 6. The lesson ladder — what each tier teaches, tied to the sim

Every lesson below is something the deterministic core (or a deterministic
geometric measure over it) **actually produces** — no faked mechanics. This is
the audit the owner should hold us to.

| Real lesson | The misconception it kills | How the sim produces it | How the player sees it |
| --- | --- | --- | --- |
| **A return path has impedance** | "ground is 0 V everywhere" | return net = `R+L` stamps (rung 1) | GND belt sags away from zero |
| **Shared-impedance coupling** | "my loads are independent" | two returns share a segment ⇒ its `I·R+L·di/dt` is in both references | switching load A wobbles load B's ground (overlay + scope) |
| **Ground bounce** | "switching is instantaneous and clean" | `Lseg · di/dt` on the return inductor (rung 1) | a transient spike in local GND height at each edge |
| **Star vs daisy vs plane** | "all grounding is the same" | three routing topologies ⇒ three solved return structures (rung 2) | cumulative sag along a daisy-chain vs flat plane vs dedicated star |
| **Ground loops radiate / pick up noise** | "a closed loop is just a wire" | `area · di/dt` noise figure (rung 3) | the **loop-tile shading** — the enclosed area lit by its noise contribution |
| **The return wants to hug the signal** | "route ground wherever" | shrinking enclosed area collapses the noise figure (rung 3) | tightening the return makes the shade vanish; a plane ⇒ area ≈ 0 |
| **Analog/digital ground partitioning** | "one ground node for everything" | a shared return segment carries both quiet-analog and noisy-digital return ⇒ noise floor on the analog net (G4) | the ADC's noise floor drops when you split the returns / single-point-tie them |

Each ties to an existing or planned part/contract: ground bounce pairs with the
buck switch and fast logic; shared-impedance with any two co-routed loads;
loop-area with oscillators/fast edges (high `di/dt`); analog/digital partition
with the ADC tier (`game-factory-loop.md` Tier 3). The grounding curriculum is
*emergent from the parts the player already unlocks*, not a separate syllabus.

---

## 7. Open questions / risks for the owner

These are decisions I deliberately did **not** make because they could contradict
the determinism contract, balloon scope, or are economy-owner calls.

1. **Does the EMI noise figure perturb the *solve*, or only grading+display?**
   (§4.) Grade-and-display only keeps the existing golden math untouched; a real
   noise voltage on the return is more honest but must be a deterministic
   function of the tick (a topology-seeded fixed pattern, never an RNG) and would
   require a new golden. **My lean: display+grade first.** Needs a determinism
   review either way.
2. **One anchor per island, or a small fixed number?** Rung 1 assumes a single
   true node-0 tie per island with everything else reaching it through copper.
   Real boards sometimes have legitimate multiple ties (single-point vs
   multi-point grounding is itself a lesson). Is multi-anchor a later tier, or do
   we keep strictly one and teach single-point-ground as the rule? Affects the
   anchor tie-break determinism.
3. **Is the ground zone a property of a `district`, or an independent paintable
   layer?** (§3.) Districts already mean "electrical island for ΔT/black-boxing"
   (`architecture.md`). Overloading them with grounding is tidy but couples two
   concepts. Owner ruling needed; affects whether the zone scopes like an island.
4. **Per-unit-length `R`/`L` constants and the grid scale.** What is one grid
   cell *worth* in mΩ and nH? This sets how punishing return routing feels and
   must be tuned so a "reasonable" layout is clean and only a careless one sags.
   Pure balance, but it's the dial that decides "satisfying" vs "annoying."
   (`visual-language.md` already cites *"tens of mΩ per segment"* as the IR-drop
   feel — start there.)
5. **Does the ground zone cost Credits (area) and/or Lux to unlock the tier?**
   (§5.) Economy-owner call: the area sink should make the plane a *considered*
   choice, not a free "always paint a plane everywhere" that re-trivializes
   grounding the way G0 did. If the plane is too cheap we recreate failure mode #1
   with extra steps.
6. **Solve-cost of un-aggregating the return.** Today the return is one node;
   rung 1 makes it many nodes+branches (more matrix). Fine for a board; flag it
   for the same black-boxing / per-island treatment as everything else when bases
   get large (`game-factory-loop.md` §6 already flags MNA solve cost vs base
   size). The ground zone's lumped collapse is partly the mitigation.
7. **Backward compatibility of existing goldens.** The moment a golden circuit's
   returns stop being ideal, its `node_v` changes. Plan: keep G0 the default so
   existing goldens are untouched, and add **new** non-ideal goldens for the
   grounding tiers — a deliberate, reviewed addition, not a regeneration of the
   ideal ones.

---

### The bet, in one line

**Make "where the current comes back" a real, visible, routable thing — a return
net with R+L (so grounds stop being free teleports), a loop-area noise term that
lights up the antenna you built, and a paintable ground plane you *unlock* as the
satisfying way out — all gated up the same Lux-fidelity ladder so the player only
ever meets the penalty once they hold the tool to beat it; grounding becomes a
fourth way the belts tell the truth, never a layout tax.**

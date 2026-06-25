<!-- SPDX-License-Identifier: Apache-2.0 -->

# Cell Characterization, Live Inner Telemetry, and the Integration Hierarchy (exploration)

**Status:** exploration (owner-directed synthesis, 2026-06-25). Options + recommendations + open
questions, not a final spec. Read it with `CLAUDE.md` ("Powered logic gates `ELEM_GATE`"; Component
grades/tiers; Device variants; **Ratings → FAIL**), `docs/recursive-ic-lod-plan.md` (the LoD plan this
extends), `docs/phase4-lut-and-inverter-element.md` (the INV element + the 4-LUT teardown it leans on),
and `docs/adr/0005-sealed-subcircuits-and-zoom.md` / `0006-user-defined-ics-packages-pinouts.md` (the
sealed-cell + package contract, two rules of which this doc proposes to retire/annotate). Three lens
analyses — the sim architect (characterization), the telemetry designer (live inner numbers), and the
structure designer (the integration hierarchy) — are woven into one arc. Every mechanism is anchored to
a real `file:symbol`; **NEW vs existing** is marked throughout. The golden contract (§6) is one
statement, re-checked per path.

> **Owner decisions locked (2026-06-25 conversation — fold these in everywhere; they override anything
> in §4 that predates them):**
> 1. **Re-packaging = yes.** A finished die/subassembly can go back through packaging again — you are
>    never stuck with an earlier pinout. Promotion is not a one-way trapdoor. (§4.5)
> 2. **Chiplets = just another scale of subassembly integration.** No special case, no packaged ICs
>    living inside a die. A multi-die part integrates several *subassemblies* one scale up and packages
>    the result; a die only ever contains bare interconnect + bare cells. (§4.5a)
> 3. **Subassembly → IC promotion goes through the FULL packaging process — NOT a one-click role flip.**
>    You go through packaging **because** that is where you choose the pinout (which internal nets become
>    pins, where they sit, the package body); the step cannot be skipped. **This corrects the panel's
>    original §4.5, which wrongly proposed a one-click `role='ic'` flip** — see §4.5 as rewritten. (§4.5)
> 4. **The *packaging* commit is named "Tape out"; the bare commit stays "Seal."** *Tape out* is the
>    packaging step only (bare → board IC, where you choose the pinout). *Seal* finalizes a die into a
>    reusable nested **subassembly**. (Refined 2026-06-25 — the earlier "rename Seal→Tape out everywhere"
>    is superseded; tape-out is truer as the commit-to-package step, not an intermediate block.) (§4.10)
>
> Two more conversational refinements are folded in: the **powered-gate clarification** (§2.0 — the
> "cheap digital solve" is a logic-level eval of a *real powered* gate, **not** an idealized 3-pin
> teaching gate and **not** CMOS) and the **two-library building model** (§4.3 / §4.9 — "My ICs" vs
> "My Subassemblies", with drill-in/out as the scale boundary).
>
> **Later additions (2026-06-25):** §2.9 the **characterization test-bench** (declare pin roles, derive
> the rest from the rails/families, auto-sweep on a scratch `Sim`); §4.10 **subassembly portrayal +
> proportional scale** (free-form box; footprint = content × per-tier process-shrink σ); §4.10a
> **density has a cost** (heat via Real-mode rating-derate, money via the economy); §4.9 **overworld
> authoring** (build on the board → box-select → "Make subassembly", pinout inferred from boundary-crossing
> nets — the recommended easy on-ramp; drill-in becomes re-open/inspect). **All §8 questions are RESOLVED**
> (see the table at §8).

> **Audit corrections (P0, 2026-06-25 — an 8-agent panel re-verified every claim vs live code; determinism
> verdict SOUND, golden `0xeaac…fa24` cannot move under any phase).** Precisions folded in; each is anchored
> and lands in its home section, collected here for review:
> - **Heat is NEW web work, not "half-specced"** (§4.10a corrected): `RATED_CURRENT_SLOT` (lib.rs:2452) is
>   only the slot constant — no derate code exists in sim-core. Density-as-heat = web-side lower the
>   Real-mode slot-2 rating; the existing `flag_and_clamp_fails` (lib.rs:6803-6808) FAIL-flags it
>   (`failed_elements` unhashed). It collides with the sub-tick rate (slot 2, §2.7a), so heat-on-*fabric*
>   waits on moving the sub-tick rate off slot 2.
> - **Digital vs Boundary fold** (§5/§6): a collapsed cell driving an *analog* load is a **Boundary** net
>   (`classify_nets`, lib.rs:2207) that folds the **f64 `node_v`** (lib.rs:7360) — reproducible via the
>   deterministic MNA solve, not the quantized level. Boundary signal nets **stay in the dense MNA** (a real
>   cost). **Params are not hashed** (PARAM_STRIDE=8; only `beh_state`/new hashed fields touch the contract).
> - **Wide-cell route split** (§2.5): **(a1) structural** one-LUT4-per-gate graph→element lowering is the
>   8086 path (a ≤2-in gate *is* a 16-bit word); **(a2) function-level Shannon** only for a single
>   >4-in-but-<16-in swept leaf. No Shannon/BDD/synthesis code exists in the repo today.
> - **Registered-LUT ceiling** (§2.6/§2.9): prog-4 registered computes `Q+ = LUT(external inputs)` — the
>   index does **not** include current Q (`beh_lut_live_index`, lib.rs:1539-1542), so only ≤4-input D-type
>   next-state with **no self-state-dependence** collapses to one registered LUT; toggle/JK do not. The
>   sequential sweep **requires a declared async reset/preset pin** (force a known Q, clock, read Q+).
>   Inter-LUT interconnect must be **pure-Digital** for sub-tick equivalence (`run_digital_subticks`
>   re-solves only `digital_rows`, lib.rs:6744-6747). Two quantizers: input `beh_level` (hard 0.5·rail,
>   lib.rs:1385) vs output `fam.quantize` (family fractions, lib.rs:6177).
> - **prog-4 emission trap** (§2.3/§2.8): emit `value=4` (`BEH_SPEC.LUT`, netlist.ts:513); mode rides
>   `Component.mode → params[4]` (`BEH_LUT_MODE_SLOT`, lib.rs:1513; default 0 = combinational). A wrong/zero
>   value = an inert block.
> - **σ-composition math** (§4.10): **σ IS the fit-scale `s`** ⇒ `cumulativeScale = ∏σ` with **no change**
>   to the scale-application path (userIcInternalsView.ts:288-295); `MAX_SCALE = 1000` bounds the **camera**,
>   not `cumulativeScale` (board.ts), so a looser σ costs drill-depth, not a hard ceiling; σ's data-model
>   home is a new `UserIc.process.sigma` (default 1.0); the content extent is the **internals bbox**, not
>   `dieBounds`.
> - **Tape-out has two prongs** (§4.5/§4.9): a cell **authored in a package die** (the P2 gate templates,
>   any drill-in build) already has a pinout, so **Seal yields `role='ic'` directly — no promotion**; only a
>   **free-form/box-captured** subassembly needs an explicit **Tape-out** (pick package, map nets→pins). Box
>   capture is **unbuilt** today (`captureSeal` is a BFS, userIc.ts:729) — it needs a NEW `captureRegion`,
>   and semantic pin roles IN/OUT/VCC/GND/CLK **do not exist yet** (P3 adds them).
> - **Player gates coexist with built-ins** (§4.3): a player gate doesn't replace the built-in — it
>   coexists, with an optional "set as my NAND" / curriculum-grey. Note `isReservedTag` (userIc.ts:169)
>   currently **refuses** a built-in-name seal — revisit only as the naming case requires.
> - **Tier-2 DC read freezes inner sequential** (§3.6): `commit_sequential_digital_state` runs only in
>   `step()` (lib.rs:6503), so a flop-containing opened cell needs the stepped-sim variant to animate.
> - **Two hardening tests, not assertions** (§6/§7): a cross-instance `snapshot_hash` equality test for a
>   placed prog-4 LUT (D7), and a `ScratchSim` newtype that does **not** expose `snapshot_hash` (D8, P6).

---

## 0. The core realization (read this first)

The owner's three asks read as a contradiction: *build the gates from transistors, keep the cheap
solve at CPU scale, and still see all the currents and voltages inside.* They are not a contradiction.
**The simulation and the renderer are already decoupled, and the missing piece is a level-of-detail
split — not the merging of two solvers.**

Three facts about the live engine make this concrete:

1. **The renderer never reads the solver's matrix; it reads a per-frame snapshot.** Zoom-to-open
   (`userIcInternalsView.ts` `drawUserIcInternals`, `internalsView.ts` `drawCompositeInternals`) draws
   the recorded inner structure animated from `snap.state` (node voltages) and `snap.elementCurrents`
   (per-element currents). It is render-only and already independent of *how* those numbers were
   produced.
2. **The engine already has a cheap digital path that costs nothing in the analog matrix.** `is_digital`
   (`crates/sim-core/src/lib.rs:2073`) returns true for `ELEM_GATE`/`ELEM_BEHAVIORAL` (and friends);
   `classify_nets` (lib.rs:2104) keeps their *signal* nets out of the dense Gaussian-elimination MNA;
   `eval_digital` (lib.rs:5866) is a boolean unit-delay evaluator. A gate-level design "barely touches
   the matrix."
3. **The expensive path is a *choice* the build makes today, not a law.** `flattenUserIcs`
   (`web/src/lib/userIc.ts:539`) recursively inlines a sealed cell's inner transistors into the *one*
   global netlist before `buildNetlist`, so a sealed transistor-NAND becomes real analog FETs in the
   dense matrix. That is the *only* reason a sealed cell is expensive — and the only reason its inner
   FETs have real currents to show.

So the architecture is already a ladder of fidelities; what is missing is the **rung that lets a sealed
cell present a *cheap behavioral face to the global solve* while keeping its *discrete graph for the
eye*.** Today a sealed cell is single-faced (its graph, flattened to FETs, everywhere). The whole of
this document is: give a cell **two faces** — a cheap characterized one for scale, a full-fidelity one
for inspection — and let a per-instance toggle and the zoom frontier decide which one is live where.
`is_digital` excluding NMOS/PMOS (verified, lib.rs:2073) is the hinge the whole design turns on: a cell
*built from transistors* is in the matrix; the *same cell collapsed to one `ELEM_BEHAVIORAL`* is not.

The mesh of these three subsystems is therefore a **LoD split**: full analog where the eye is, cheap
digital/behavioral everywhere else, and a render path that is identical for both because it already
reads a snapshot, not a solver.

**One honesty caveat threaded throughout (and elevated to its own constraint where it bites):** the
behavioral face and the FET face are *not* free-of-charge cycle-equivalent for arbitrary
*combinational depth*. The cheap digital path advances logic through a **global, not per-cell**
sub-tick lever, and through a unit-delay receiver. §2.7 scopes exactly when the two faces match, and
§2.7a names a real shared-param-slot collision the draft missed. Take those two sections as the
load-bearing corrections to the optimistic framing.

---

## 1. The problem and the owner's vision (the verbatim spine)

The owner's words, kept as the spine every section must serve:

> "build all the gates as ICs from transistors, then have the engine **USE** those player-built ICs
> **AS** the gates, so you can zoom in and see the guts — but keep the **CHEAP** (digital) solve, so
> someone can build a full functional CPU (an 8086) at scale."

> "I want to **SEE ALL the currents and voltages and everything in REAL TIME INSIDE of it**."

> distinguish a **SUBASSEMBLY** (an internal building block you create, that goes INTO other things;
> stackable 'perversely'/recursively) from an **IC** (the thing you place on your actual BOARD), with
> **TIERS of integration** tied to the real VLSI scale (SSI → MSI → LSI → VLSI → ULSI) — "make a CPU
> you reuse a lot, and below it everything is just subassemblies."

Four requirements fall out, and each maps to a section:

- **R1 — gates-as-built-ICs.** A player builds a gate from FETs in the IC maker, seals it, and the
  engine treats that sealed die *as* a gate. (§2: the dual-face cell; §4: where it sits in the
  hierarchy.)
- **R2 — the cheap solve at scale.** The sealed gate must not drag its transistors into the dense MNA
  when the player isn't looking at it; an 8086's worth of gates must stay tractable. (§2: characterize
  to a behavioral face; §5: the scaling story.)
- **R3 — see the guts, all currents/voltages, in real time.** When the player *does* look, they see the
  real inner numbers, live. (§3: live inner telemetry.)
- **R4 — the structural re-think.** Subassembly vs board-IC; perverse recursive stacking; the
  SSI→ULSI integration tiers. (§4: the integration hierarchy.)

The tension between R2 and R3 is the heart of the design and is made *precise* by the live code: a cell
run cheaply (R2, `eval_digital`) has **no inner per-FET current** — gates/behaviorals commit a single
output-drive scalar per pin (`gate_gout[i] * (gate_target[i] − V(a))`, lib.rs:5687-5688), and
`eval_digital` only assigns net levels. The inner numbers R3 wants *do not exist in the global
snapshot* once a cell is cheap. §3 resolves this without giving up R2.

---

## 2. The dual-face cell and characterization

### 2.0 The "cheap digital solve," precisely — and the powered gate is KEPT (owner clarification)

Before the dual-face machinery, pin down exactly what the cheap solve *is*, because the owner was
explicit on two points the panel framing glossed:

- **We keep the powered gate, not the idealized teaching gate.** `ELEM_GATE` is a real **5-pin powered
  IC** — `a=OUT, b=IN1, c=IN2, d=VCC, e=GND` (CLAUDE.md, "Powered logic gates"). It is **not** the
  context-free 3-pin "A, B → OUT" symbol from a textbook that has no supply and "doesn't really make
  sense." The rail is a real `V(VCC) − V(GND)` (`gate_rails`), inputs threshold **relative to V(GND)**,
  the output swings the **actual** `V(GND)..V(VCC)` (the `digital_vlow` GND-offset array), the family
  (CMOS/TTL) sets the thresholds, and an **unwired VCC floats → rail `< GATE_MIN_RAIL` → the gate is
  dead / output released.** That whole powered contract stays. Everything below operates on *that* gate.
- **"Cheap digital solve" ≠ CMOS, ≠ full analog.** It is neither a transistor-level CMOS solve nor a
  full-fat MNA matrix solve. It is a **logic-level evaluation of the powered gate**, and here is exactly
  what it does each tick (this is the existing `eval_digital`, lib.rs:5866):
  1. **Read** the gate's input **node voltages** from the live snapshot (`V(IN1)`, `V(IN2)`), plus its
     rail `V(VCC)`/`V(GND)`.
  2. **Quantize** each input to a logic level by comparing against the **gate's own GND-referenced,
     family threshold** (the input half-rail test, `beh_level` at lib.rs:1385 for behaviorals; the gate
     analogue is the same GND-relative compare) — a 0/1 (4-state-capable: 0/1/X/Z) decision, **not** a
     continuous current.
  3. **Evaluate** the boolean function of the gate kind (AND/OR/XOR/NAND/…) on those quantized inputs.
  4. **Drive** the output toward the **real rail** — `V(GND)` for logic-0, `V(VCC)` for logic-1 — through
     the family output conductance, committing one output-drive scalar per pin
     (`gate_gout[i] · (gate_target[i] − V(a))`, lib.rs:5687-5688), with **unit delay** (this tick reads
     last tick's committed input levels).
  This is **O(gates)** and adds **nothing** to the dense O(n³) analog matrix for the gate's signal nets
  (`classify_nets` keeps them digital, lib.rs:2104) — only the supply nets `VCC`/`GND` stay analog
  (lib.rs:2169-2179). That is the "cheap" in "cheap digital solve": a quantize-evaluate-drive over a
  *powered* gate, not a device-physics solve of its transistors.

**Where CMOS actually lives, then.** The transistor-level CMOS behaviour (the FET I–V curves, the
pull-up/pull-down fight, IR-drop, ratioed divider voltages) is **not** in the cheap solve and was never
meant to be. It lives in exactly two places: (1) the **FET face** of a sealed cell — when you build a
gate from NMOS/PMOS and run it flattened, those are real Newton-solved MOSFETs in the matrix
(`is_digital` excludes them, lib.rs:2073); and (2) the **on-zoom local analog solve** (§3 Tier-2) that
lights up the real inner currents/voltages when the eye is on a specific cell. So the owner's three
wishes line up cleanly: **the powered gate runs on the cheap logic-level solve at scale (R2); its CMOS
guts are real on the FET face and visible via the local solve when you look (R1, R3).** The rest of §2
is about giving a *player-built* gate that same cheap face the built-in `ELEM_GATE` already enjoys.

### 2.1 The shape of the idea

A sealed cell today carries **only its graph** — `UserIc` is
`{ tag, name, package, frameId, graph, pinNames }` (verified, `web/src/lib/userIc.ts:32-47`). The
proposal is to give it a **second face**: at seal time, simulate the die offscreen across its input
space, extract a **behavioral characterization** (a truth table for a combinational cell; a small
registered next-state function for a simple sequential one), and at build time emit *that* into the
netlist **instead of** `flattenUserIcs` inlining its FETs — while zoom-to-open keeps drawing the
recorded graph. The cell becomes **dual-representation**: its discrete graph (for inspection + the
analog face) *and* its characterized collapse (for scale).

Crucially, **the engine already ships every load-bearing primitive for the behavioral face of a small
cell:**

- **The behavioral LUT4 already exists, end to end.** `ELEM_BEHAVIORAL` program 4 (`BEH_PROG_LUT`,
  lib.rs:1070) is a real player-addressable 4-input / 16-entry lookup table: the truth table is the
  element's `aux` low-16 bits, the output is `beh_lut_bit(truth, index)` (lib.rs:1528) with
  `index = f | g<<1 | h<<2 | c<<3` via `beh_lut_live_index` (lib.rs:1539). The web side already emits
  it: `BEH_SPEC.LUT = { prog: 4, term: [0,5,4,6,7,1,2,3], defWord: 0x6666 }` (netlist.ts:513), driven
  by `Component.word` (graph.ts:178). **A characterized combinational ≤4-input cell *is* a 16-bit word
  in this exact element** — the only new code is *producing* the word from a sweep instead of taking it
  from `Component.word`.
- **The behavioral face is analog-free *for its signal nets* by construction.** `classify_nets`'
  `ELEM_BEHAVIORAL` branch (lib.rs:2169-2179) marks the block's `a/b/c` (outputs) and `f/g/h` (inputs)
  as digital-signal nets; **only VCC (`d`) / GND (`e`) stay analog supply** (verified, lib.rs:2174-2178
  marks exactly `[e.d, e.e]` analog-touched). A characterized cell therefore adds **nothing to the
  O(n³) dense MNA for its logic** — exactly the property (R2) that lets an 8086-scale fabric stay cheap,
  and exactly what flattening-to-FETs throws away (Newton-solved MOSFETs *are* in the matrix;
  `is_digital` excludes them, lib.rs:2073). **But its supply nets are still analog** — see §5 for why
  this means "almost nothing," not "nothing," at CPU scale.
- **Sequential ≤1-bit cells have a face too.** Program 4's **registered** mode
  (`params[BEH_LUT_MODE_SLOT] >= 1`, lib.rs:1513/1518) latches the LUT lookup into Q on the rising CLK
  edge (`beh_lut_step`, lib.rs:1554-1567) — a LUT+flip-flop, the canonical FPGA logic element. A
  characterized 1-bit sequential cell with ≤4 data inputs maps to a registered LUT (next-state table in
  `aux`, mode = registered, clock = pin `b`; see §2.3 on why the clock pin is *not* free).
- **Extraction is deterministic and bounded.** The core is a fixed-step, fixed-order, pure-`f64`
  solver; the Newton loop adds a data-dependent *count* but every iteration is deterministic and the
  count is bounded by `NEWTON_MAX_ITERS` with a defined last-iterate outcome, so a given netlist
  reproduces bit-for-bit (verified, the module determinism contract, lib.rs:282-290). Sweeping a die
  across its 2ᵏ input combinations offscreen therefore yields a reproducible table, and that table
  persists as a plain integer in the cell JSON (the `Component.word` path, netlist.ts:1331), so
  re-emission is trivially reproducible. There is a working precedent for an offscreen scratch sim: the
  economy doc's contract-satisfiability check "runs on a separate offscreen scratch `Simulation`, not
  the player's history ring."
- **The collapse is golden-safe by construction.** `snapshot_hash` folds `beh_state`
  **append-only after the analog node / DFF / sampler / comparator folds** (lib.rs:7353-7404) — a board
  with no behavioral block folds zero extra bytes, and a *combinational* LUT folds an all-zero state
  block (the prog-4 LUT word lives in `aux`, not state; lib.rs:1502-1503). The LUT mode rides a param
  slot that defaults to 0/off; and `flattenUserIcs` is a strict no-op when no user IC is placed (the
  early `if (!any) return graph`, userIc.ts:553 — and the golden places none, so REGISTRY + FAMILIES
  are empty for it). The collapse therefore changes the golden circuit's bytes by exactly nothing.

### 2.2 The honest split (what is real today vs genuinely new)

This is the load-bearing distinction the whole section turns on; do not blur it.

| Cell class | Collapses to | Status |
| --- | --- | --- |
| Combinational, ≤4 inputs, 1 output | **ONE** `ELEM_BEHAVIORAL` prog-4 LUT | **Real today** end-to-end (web emits, core evals). New: the *sweep* that fills the word. |
| Sequential, ≤4 data inputs, **1** state bit, single edge-clock | ONE registered prog-4 LUT | Primitive real; **new**: recognizing 1-bit-sequential, extracting the next-state table (clock pin is fixed to terminal b — §2.3). |
| >4 inputs, or >1 output, or >1 state bit | **NOT one element** | **New, substantial.** Either (a) a *fabric* of LUT4 elements, or (b) a *new wider* `BEH_PROG_*`. |

The hard ceilings are real: prog 4 is exactly a LUT4 (`index & 0xF`, lib.rs:1528-1529) with a single
registered bit (`BEH_LUT_Q`, lib.rs:1504). A wider cell cannot be one LUT element. **Do not promise
that an arbitrary sealed cell collapses to one element — only ≤4-in / ≤1-bit does today.** The
CPU-scale dream (§5) rides the wide-cell strategy (§2.5), which is the genuinely new work. *(Note the
related ceiling on route 2.5(b): a single behavioral element's state is capped at `BEH_STATE_WORDS = 16`
u32 words, lib.rs:1029 — an 8086 register file as ONE behavioral leaf exceeds that, so even route (b)
forces a fabric or a multi-element decomposition for large state. §5 step 3 is corrected to say so.)*

### 2.3 The dual-face data model (NEW on the web side)

`UserIc` carries no behavior field today (verified, userIc.ts:32-47). The proposal adds an **optional**
field:

```ts
// web/src/lib/userIc.ts — NEW (optional; absent => today's behavior, byte-identical)
interface CellBehavior {
  prog: number;              // behavioral program id (4 = LUT4; a wider prog later)
  word: number;              // the extracted truth / next-state table (aux)
  mode: number;              // 0 = combinational, >=1 = registered
  // I/O-pin -> core terminal map. For the <=4-in prog-4 case this REUSES BEH_SPEC.LUT.term
  // verbatim ([0,5,4,6,7,1,2,3] = OUT a, CLK b, I3 c, VCC d, GND e, I0 f, I1 g, I2 h) — it is
  // NOT a freely-invented per-cell map. A bespoke term[] is only needed for a future wider prog.
  sig: string;               // signature/hash of the inner graph (invalidate on edit)
}
interface UserIc {
  /* …existing: tag, name, package, frameId, graph, pinNames… */
  behavior?: CellBehavior;   // NEW — the characterized face
}
```

**The clock pin is *not* a free per-cell choice (corrected from the draft).** For prog-4 registered
mode the clock is hardwired to **terminal b** (`beh_lut_step` reads `clk` from the committed level of
pin `b`, lib.rs:1552), and the four data inputs are read as `f, g, h, c` in that order
(`beh_lut_live_index`, lib.rs:1539). The `BEH_SPEC.LUT.term` map `[0,5,4,6,7,1,2,3]` *already* encodes
this exact assignment (OUT=a, CLK=b, I3=c, VCC=d, GND=e, I0=f, I1=g, I2=h). So the extractor **must**
map the cell's clock to terminal b and its data inputs to f/g/h/c — it **reuses `BEH_SPEC.LUT.term`
rather than inventing a new map** for the ≤4-in case. (A free `clockPin`/bespoke `term[]` only re-enters
with a future wider program.)

Because `UserIc` is plain JSON and round-trips through saves (`userIcsForGraph` descends transitively,
userIc.ts:309), an optional field is append-and-default-safe (the same pattern as `pinNames` and the
family sidecar). `flattenUserIcs` would, when a cell has a valid `behavior` **AND** the instance's
fidelity is "behavioral," emit **one** `ELEM_BEHAVIORAL` via the `BEH_SPEC.LUT` map **instead of**
inlining the inner components. The existing `flatSink → userIcInternals` render path
(netlist.ts:1614-1726) is **only** populated on the FET-flatten branch, however — see §3.1/§3.4 for the
genuinely-new local builder a *collapsed* cell needs to feed that renderer.

### 2.4 The per-instance fidelity toggle (NEW, small, idiomatic)

The discrete-vs-behavioral choice is naturally a **per-instance** field that selects the flatten
branch — behavioral → emit the characterized element; real → today's recursive FET inlining
(unchanged). It mirrors the existing per-instance integer fields `Component.tier` / `variant` / `mode`
(graph.ts:134-160) and the established Ideal-vs-Real fidelity gate that `buildNetlist(graph, real)`
already threads (netlist.ts:882). A new optional `Component.fidelity?: number` + one branch in
`flattenUserIcs` is small and fits the data model rather than fighting it. Confirmed there is **no**
`fidelity` field today (graph.ts has tier:134, variant:144, mode:160, word:178 only), so it is
genuinely new and append-and-default-safe like `pinNames`.

Per-instance (vs per-definition) is the recommended granularity: the same CPU tag can be opened *live*
in one spot and run *collapsed* everywhere else — exactly what §3's inspection path wants. (Open
question 8.1.)

### 2.5 The wide-cell frontier (the genuinely new work — pick one)

A cell with >4 inputs / multi-output / >1 state bit needs one of two routes. **This is the substantial
new work and the real CPU-scale enabler.**

- **Route (a) — fabric of LUT4 elements.** Shannon-expand the wide function into a network of
  registered/combinational LUT4 elements wired through internal digital nodes (one element per output
  bit; a fabric of them is any sequential machine). **Reuses everything** — all-digital signal nets,
  zero analog cost for logic, and it *is* the owner's "subassembly" framing made literal (an
  FPGA-honest decomposition). The new code is a synthesis pass (a real but well-understood problem).
  **This is the route the §5 CPU endgame actually rides** (not a single black-box leaf — see §5 step 3).
- **Route (b) — a new wider `BEH_PROG_*`.** A multi-output PLA / extracted FSM program using the
  16-word `beh_state` block (`BEH_STATE_WORDS = 16`, lib.rs:1029) for multi-bit state. One element, but
  new sim-core (a new program arm + the bigger characterization) — golden-safe by append-and-default-off
  (the same discipline every existing program 1–8 followed). **Hard ceiling:** 16 u32 words cap a single
  element's state, so route (b) cannot, by itself, be an 8086's register file — a fabric (route a) or a
  multi-element decomposition is unavoidable for large state regardless.

Route (a) is the recommended default (reuse, all-digital, matches the owner's mental model, no state
ceiling); route (b) is a per-block escape hatch for a moderate-state FSM that fits in 16 words.
(Open question 8.4.)

### 2.6 The correctness guard (NEW — has teeth *because* the sim is deterministic)

A cell is safely characterizable only if its outputs are a **pure function** of its digital inputs
(combinational) or of inputs + clock-edges (simple sequential). The guard = the **same offscreen
deterministic sweep that builds the table also checks** that, at every input combo, outputs:

1. **quantize cleanly to two levels** — using **the same family `quantize` the hash actually folds**
   (`commit_net_levels → FAMILIES[..].quantize`, lib.rs:6177-6180), sampling the *output* node against
   its driver rail. (The draft cited `beh_level` at lib.rs:1385, but that is the **input** threshold —
   half-rail relative to the GND pin `e`; to verify an *output* is genuinely two-level the guard must
   use the same `quantize` that `commit_net_levels` applies at commit, so the guard's test matches what
   the snapshot folds.)
2. **are stable** (settle to a fixed value within the step budget), and
3. **for sequential, depend only on the declared clock edge.**

A block that fails (an analog amp, a multi-level node, a ring oscillator) is **refused / flagged →
forced to the real (analog) face**, so it can never be mischaracterized. This is a **correctness gate,
not a determinism gate**: a mischaracterized non-combinational block collapsed to a LUT would still
*hash* deterministically, but would be logically *wrong* versus its FET face — hence the guard must run
on the same offscreen deterministic `Sim`. Re-characterize on edit by storing the inner-graph
**signature** (`CellBehavior.sig`) and invalidating when it changes — the reseal path already
re-derives the part kind and re-reads the registry graph at build (`resealUserIc`, userIc.ts:284). The
determinism that makes the guard *sound* is real (lib.rs:282-290); the guard logic itself is entirely
new.

### 2.7 Cycle-equivalence is scoped, NOT blanket (corrected — this is a major)

The two faces have subtly different timing, and the draft's framing of this as a minor "property to
honor" with a clean per-cell fix was wrong on two counts. The corrected contract:

**What is true.** The FET (analog) face resolves a combinational cone **within** one analog tick
(Newton settles the whole cone). A registered behavioral LUT carries **one tick** of clock-to-output
delay (it drives the *committed* Q, lib.rs:6009). A *combinational* behavioral LUT reads its inputs
**live** within the digital sub-solve (lib.rs:6011 — `beh_lut_live_index(&self.node_v, …)`, no
clock-to-output delay *of its own*), but it reads them through `eval_digital`'s **unit-delay receiver**:
the value it sees is last sub-tick's committed level on its input nets.

**The lever is GLOBAL, not per-cell (the correction).** The digital sub-tick loop re-runs
`eval_digital → sub-solve → commit` only `subtick_rate − 1` *extra* times (verified,
`run_digital_subticks`, lib.rs:6736), and `subtick_rate` is a **single global maximum** `S = max N`
over *all* behavioral blocks (verified, lib.rs:12620: "the global S = max N drives the sub-tick loop";
6514: `if self.subtick_rate > 1`). It is **not** a per-cell knob.

**The consequence.** With the default `subtick_rate = 1`, a chain of N collapsed *combinational* cells
propagates **one cell per analog tick** (an N-tick latency) through the unit-delay receivers — whereas
the flattened-FET face settles the whole chain **within one analog tick**. So the two faces are **NOT
cycle-equivalent for combinational logic depth** unless a **global** sub-tick rate ≥ the deepest
combinational cone is set (which raises cost for *every* behavioral block, and re-collides with the
slot-2 issue in §2.7a).

**The correct equivalence contract** (state this explicitly; do not claim the blanket version):

> The behavioral and FET faces are cycle-equivalent at the player-observed clock **for cells that are
> registered and separated by at most one combinational LUT per clock domain** — OR when a **global**
> sub-tick rate is set to cover the deepest combinational cone. For a **synchronous, fully-clocked**
> 8086 (registers between every combinational block) this holds at `subtick_rate = 1`; for deep
> *unregistered* combinational chains it does **not** without the global lever.

This is exactly why a synchronous CPU is the friendly target (§5): registers between stages bound every
combinational cone to depth ~1, so the faces match without paying for a high global sub-tick rate.
(Open question 8.5.)

### 2.7a The shared param-slot collision: sub-tick rate vs current rating (NEW — major, draft missed it)

**`BEH_SUBTICK_RATE_SLOT = RATED_CURRENT_SLOT = slot 2`** (verified, lib.rs:2484). Slot 2 is the
**general rated-current** read for FAIL-flagging on *every* element (`CLAUDE.md` Ratings → FAIL;
`flag_and_clamp_fails`), and it is *also* where a behavioral block declares its digital sub-tick rate.
A characterized cell collapsed to one `ELEM_BEHAVIORAL` writes **one** slot-2 value — it cannot
simultaneously carry a sub-tick rate `N` *and* a rated current.

This is **golden-safe** (both meanings default to 0/off, and the golden places no behavioral block).
But the doc must state the constraint, because the wide-cell fabric (route 2.5a) is exactly where high
sub-tick rates would matter most:

- The engine's own comment (lib.rs:2480-2482) notes the rating threshold "never trips on a behavioral
  block's tiny output current," and *"Only `ELEM_BEHAVIORAL` declares a rate; every other kind leaves
  slot 2 as its rated current"* — i.e. the engine has already **conceded slot 2 to the sub-tick rate
  for behavioral elements**. So the practical rule is: **a sub-ticked behavioral cell forgoes a
  per-element current rating** (its tiny digital output current would not meaningfully trip a rating
  anyway). A cell that genuinely needs a *current rating* (e.g. a behavioral leaf standing in for
  something that sinks real supply current) must run at `subtick_rate = 1`.
- This couples with §2.7: raising the **global** sub-tick rate to make a deep combinational fabric
  cycle-equivalent means every behavioral block in the design is reading a non-default slot 2 — fine
  for ratings (they were conceded), but it is a *global* cost, not a free per-cell tune.

**Design rule to record:** characterized cells use slot 2 as the sub-tick rate; they do not also carry a
slot-2 current rating. If a future need wants both on one behavioral element, that is a new param-slot
allocation in sim-core (append-and-default-off), not a reuse of slot 2.

### 2.8 Recommendation (staged around the LUT4 ceiling)

- **Phase A (cheap, mostly real today).** Add `UserIc.behavior` + per-instance `Component.fidelity`.
  Implement **only** the combinational ≤4-input case: extract a 16-bit truth table by an offscreen
  deterministic sweep and emit **one** `ELEM_BEHAVIORAL` (prog 4) via the **reused `BEH_SPEC.LUT.term`
  map**, branching in `flattenUserIcs` instead of inlining FETs. Ship the **correctness guard** with it
  (same sweep verifies two-level-via-`quantize`/stable/pure-combinational, refuses otherwise;
  inner-graph signature invalidates on reseal). Reuses the entire behavioral / `eval_digital` /
  `classify_nets` / snapshot-hash stack; golden-safe by construction.
- **Phase B.** Registered ≤4-input 1-bit sequential cells → registered-LUT mode (next-state table;
  clock fixed to terminal b); add edge-dependence to the guard.
- **Phase C (the real frontier).** Pick route (a) fabric-decomposition (default — reuse, all-digital,
  the owner's subassembly framing, no state ceiling) or route (b) a new wider `BEH_PROG_*` for a
  moderate-state FSM that fits 16 words. **The CPU-scale dream lives here.**

Keep zoom-to-open on the existing renderer — but note that a *collapsed* cell does **not** auto-populate
the inner-telemetry struct, so §3 carries genuinely new web work to feed that renderer for the collapsed
case.

### 2.9 The characterization test-bench — declare roles, derive the rest (owner ask)

The owner asked the precise question: *to characterize a subassembly, what does the solver actually need
me to give it — the pins? expected voltage ranges? current ranges? stimulus?* The happy answer is **far
less than it looks**, because (a) a digital cell's levels are already fixed by the rails + gate families
inside it, and (b) **the test-bench already half-exists.**

**What ships today (the reuse target).** Phase-1 pin-stimuli is live: a player attaches **GND / VCC /
Input(volts)** to die pins via a popover (`PinTest` enum + `Component.pinTests`, `graph.ts`), and the die
solves *in isolation* through `dieTestGraph()` (`dieEditor.ts`) — injected **authoring-only**, gated in
`App.svelte`'s `rebuildNetlist` when drilled in, and **never sealed** (the raw die graph stays untouched,
so determinism holds). The Phase-2 plan already names the sweep mechanic in passing: *"clock A@f and
B@f/2 auto-cycles a 2-input truth table."* **Characterization is that, automated** — sweep the inputs
instead of toggling them by hand.

**The reframe on "voltage ranges / current ranges."** Declaring expected V/I ranges is how you'd
characterize an **analog** block (an op-amp: input range, output swing, supply current → a *macromodel*).
For the **digital** cells we start with (gates, LUTs, registers) you need almost none of it, because the
cell is built from **powered gates whose rails and family already define the levels.** Declare-vs-derive:

| What the solver needs | Declare or derive? | Where it comes from |
| --- | --- | --- |
| **Pin roles** (IN / OUT / VCC / GND / CLK) | **Declare** — one tag per edge-pin | extends the pin popover that already labels pins; maps to the behavioral terminals (a=OUT, b=CLK, d=VCC, e=GND, f/g/h/c=IN — `BEH_SPEC.LUT.term`, netlist.ts:510-541) |
| **Supply / rails** | **Declare** — wire the VCC/GND pins (or a nominal rail) | the rails **are** the 0/1 range; `gate_rails` (lib.rs:692) reads `V(GND)`/`V(VCC)` |
| **Logic family** (CMOS/TTL) | **Derive** | inherited from the inner gates (`FAMILIES`, lib.rs:624 — CMOS 0.3/0.7, TTL 0.16/0.4) |
| **Voltage thresholds / "ranges"** | **Derive — not typed** | rail × family fraction (`beh_level` 1385 / `quantize` 585) |
| **Stimulus vectors** | **Derive — auto exhaustive sweep** | k input pins → 2ᵏ combos driven to the rails via the shipped stimulus machinery |
| **Current rating** | **Optional** — declare *or* auto-measure worst-case | slot-2 rating; **FAIL-flag only, never alters the solve** (`flag_and_clamp_fails`, lib.rs:6776); note it shares the sub-tick slot (§2.7a) |

**The mechanism end to end.** At **Seal** (the bare-subassembly commit — see §4.10 for why characterization
runs here, not only at Tape out), spin up an **offscreen scratch `Sim`** — the exact pattern the
contract-check already uses (`createSimulation`, never hashed, golden-safe) — install the die netlist via
the existing `set_netlist_pefgh` (sim-wasm), and **sweep**: for each input combination drive the input
pins to `V(GND)=0` / `V(VCC)=1`, solve, and read the output levels (`commit_net_levels` quantize). The
**correctness guard** (§2.6) checks each output is clean two-level, stable, and a pure function of inputs
(combinational) or inputs+clock-edge (sequential, via `beh_lut_step` on the CLK pin, lib.rs:1554). Pass →
bake the **truth table** into one behavioral LUT (the cheap face). Fail (analog, multi-level, oscillating)
→ refuse the cheap face, keep it analog. You drive inputs to the **rails**, not to ambiguous
mid-voltages, which is exactly *why* you never type a voltage range: the definitive 0 and 1 are the supply
you already wired, and for a cleanly-digital cell the truth table is even rail-invariant.

**The one honest ceiling.** Exhaustive sweep is only tractable for **small** cells (2ᵏ explodes past ~16
inputs). A 20-input ALU slice is **not** swept as one black box — you characterize its **leaf cells**
(gates, ≤4-in LUTs) and compose them as a **fabric** (§2.5a, the owner's chosen wide-cell route). So
characterization is bounded to small leaves; big subassemblies are *structures of characterized leaves*.
That is the whole reason the fabric route is the CPU-scale enabler and not an optional nicety.

**Open sub-questions this surfaces** (for §8): auto-capture the worst-case pin current from the sweep as
the default rating, or leave it manual? For registered cells, auto-exercise only the declared clock, or
let the author name a reset/enable pin so the next-state table is complete?

---

## 3. Live inner currents and voltages, in real time (the owner's R3)

### 3.1 The tension, localized — and the unstated dependency (corrected)

Once a cell is cheap (§2), its inner transistors have **no per-FET current** in the global snapshot.
`eval_digital` assigns net *levels*; gates/behaviorals commit a *single* output-drive scalar per pin
(`gate_gout[i] * (gate_target[i] − V(a))`, verified lib.rs:5687-5688). There is no inner-node voltage,
no per-FET I_D anywhere.

There is a **second, sharper gap the draft under-stated**: the inner-telemetry *struct itself* does not
exist for a collapsed cell. `userIcInternals` (with each inner part's `elemIndex`, netlist.ts:1664) is
built **only** from `flatSink`, which `flattenUserIcs` populates **only on the FET-flatten branch**
(netlist.ts:1615-1736). A cell collapsed to one `ELEM_BEHAVIORAL` produces **no `flatSink` records** for
its inner parts → **no `userIcInternals` entry** → `elemIndex` undefined → `drawUserIcInternals` reads
`partCurrent = 0` (userIcInternalsView.ts:570-571). So:

- Today the inner numbers *do* exist, but only because `flattenUserIcs` takes the **expensive path** and
  inlines the FETs, so each inner part resolves `elemIndex = elemOfComponent.get(comp.id + offset)`
  (netlist.ts:1664) into the global `elementCurrents`, consumed as `partCurrent`. The owner's vision is
  to *stop* doing this — which removes both the inner currents **and** the struct that would display
  them.
- Therefore the §3 resolution must **reconstruct the inner `UserIcInternals` geometry independently of
  `flatSink`** for the collapsed case: a **second, local `UserIcInternals` builder** that re-runs
  `innerGraph.restore` + the pin/node resolution (netlist.ts:1621-1735) **against the local sub-Sim's
  numbering**, not the global netlist's. This is genuinely new web work (it belongs in the Phase-4
  "New" column, §7 — not framed as "just a slice swap"), and it is the load-bearing dependency the
  Tier-2 path below assumes.

### 3.2 The resolution: a two-tier inner-telemetry strategy (mirrors the renderer's existing LoD)

**Tier 1 — forward-eval (default, every open cell, all depths).** From the cell's package-pin *levels*,
compute the inner node levels and each transistor's on/off **analytically** (no solve), and feed those
as the `{nodeV', on/dir}` the existing `drawUserIcInternals` / `drawDetailMOSFET` consume. This
satisfies "see the carriers move / which path is hot" cheaply, at any depth, and is the right thing to
show when a design is large and many cells are open.

- **It is exact for the levels** — a combinational cell's inner nodes are deterministic from its pin
  levels.
- **It is NOT free today.** There is **no JS-side gate/LUT truth evaluator**: `gate_logic_level` and the
  LUT eval live **only** in Rust (`eval_digital`, lib.rs:5866); `buildNetlist` imports glyphs as *types*
  and never evaluates logic. Tier 1 requires **porting** the small combinational truth tables (gate func
  codes + the ≤4-input/16-entry LUT) to TS, or exposing a wasm "eval-only" entry. Low-risk pure boolean,
  but genuinely new. (Open question 8.10: which side owns the canonical table.)

**Tier 2 — on-zoom local analog solve (the eye-focused cell only).** For the single **deepest** cell
under the view-centre (the `viewProbe` the recursion already records, userIcInternalsView.ts:117 +
302-329), reconstruct its inner `BoardGraph` (the same `innerGraph.restore(def.graph)` the live build
already does, netlist.ts:707/1622), `buildNetlist` it (pure/headless — vitest runs it in node,
`netlist.test.ts`), pin each external pin to a boundary model (see §3.3a — *not* a stiff VSOURCE for a
pin the cell drives), **install that sub-netlist on a dedicated scratch `Sim` and let its reset-time
operating-point solve run**, then **build the local `UserIcInternals` (§3.1) keyed off the sub-netlist**
and hand `drawUserIcInternals` the **local** `node_v` / `element_currents`. Every existing animation then
lights up with **real** inner V and per-FET I_D, including IR-drop sag and ratioed pull-up/pull-down
divider voltages the boolean tier cannot express. **You pay O(n³) for only the open cell(s).** This *is*
the LoD principle the renderer already embodies (per-part detail/silicon swaps gated on absolute
on-screen scale).

### 3.3 Why the local solve is hash-safe *by construction*

The FNV-1a `snapshot_hash` folds **only this `Sim` instance's** `node_v` / digital `net_level` /
sequential state (verified, lib.rs:7353+). A second, ephemeral `Sim` built for inspection has its own
`node_v` and never mutates the global instance, so it **cannot** perturb `0xeaac_3764_99e4_fa24`. The
golden places no user IC (flatten a no-op, userIc.ts:553), so it is doubly insulated. `sim-wasm` wraps
exactly **one** `Sim` today (`struct Simulation { inner: Sim }`, verified
`crates/sim-wasm/src/lib.rs:13`), and a second is mechanically trivial. The local solve is a **pure
render-only read.**

### 3.3a Boundary fidelity: a Thévenin driver, not a stiff VSOURCE (elevated from a trailing question)

Pinning every external pin as a stiff `ELEM_VSOURCE` (lib.rs:315 — a hard voltage constraint) is
**wrong for a pin the *opened* cell itself drives**: the local solve would fight the cell's own output
(two ideal sources on one node), and it is also wrong for a tri-state / pass-gate / bus pin that
*floats*. For anything beyond a pure combinational *sink*, the boundary needs a **driver/receiver model**
mirroring how the global solver already stamps a gate output: a Thévenin source through the family's
output conductance — the same `gate_gout · (target − V(a))` form the global gate uses
(lib.rs:5687-5688). So:

- **Input/receiver pins** → drive from the live global level through the family `gout` (Thévenin), so
  the cell's own logic can still move the node.
- **Output/driver pins** → do **not** pin at all (or pin only the *load* the global side presents); let
  the cell drive them, which is the whole point of seeing its real output current.
- **High-Z / bidirectional pins** → modelled by the family's released (Z) drive, not a stiff source.

This is a **§2.5-class design decision**, not a trailing open question: it gates whether Tier-2 is
correct for anything other than a pure combinational sink (real CPUs have tri-state buses and
pass-gates). (Open question 8.9 retained for the *bidirectional-resolution* policy, but the
"don't-use-stiff-VSOURCE" decision is settled here.)

### 3.4 The injection point already exists and is marked

`drawUserIcInternals` already threads `nodeV` + `elemCurrents` and per-part nodes
(userIcInternalsView.ts:58/62/195-196). Its explicit `TODO(phase-0-followup)` at
userIcInternalsView.ts:533 says per-net standpipes + carrier flow-dots are blocked **only** on "a
per-inner-wire current the struct doesn't carry yet." A local solve produces exactly that *current*, and
the **local `UserIcInternals` builder (§3.1)** produces the *struct* to carry it: feed the open cell's
`drawUserIcInternals` a **local** `nodeV'` / `elemCurrents'` **plus a locally-built `UserIcInternals`**,
and every existing animation (`drawDetailMOSFET`'s `drive = norm(o.electrical.current, …)`,
detailDrawers.ts:87; conduit colour = `voltageColor`) lights up with real inner numbers — **no renderer
rewrite** (but, to be precise, the collapsed case **does** need the new local-struct builder, not merely
a slice swap).

### 3.5 Composition with depth + cost/eviction

The zoom-to-open recursion (`drawUserIcInternals`, depth/cumulativeScale; `wantRecurse`
userIcInternalsView.ts:617; teardown at :621+) opens nested cells past `INTERNALS_ZOOM` and tears down
subtrees that scroll away or zoom out (`holderNearViewport` view-cull, :152/595; `RECURSE_MAX_DEPTH = 24`,
:142). **The local-solve set should track that same frontier:** solve the deepest focused cell with its
parent's solved (or digital) levels as boundary; outer levels stay forward-eval/digital. Cost is
comfortable — an SSI/MSI cell's sub-netlist is tiny (a NAND ≈ 4 FETs / <10 nodes; a full-adder ≈ tens),
so one dense solve per open cell per frame is negligible. Bound it to K ≤ ~4 cells under the view-centre,
**evict exactly as the nested render subtree is already freed.** The eviction policy already has a
working precedent (the per-frame nested-subtree create/destroy keyed on on-screen size + view cull); the
solve-set just subscribes to it. (Open question 8.11: a small warm-keep hysteresis so a fast pan doesn't
thrash sub-`Sim` rebuilds, which cost more than a `Graphics` clear.)

### 3.6 The determinism caveat for *animated* inner dynamics

A one-shot DC operating-point solve of the open cell from current pin levels is deterministic and
side-effect-free. But if you want inner *reactive* dynamics (an RC settle, a Miller transient) to
**animate**, the second sim must be **stepped**, and its step count must be a deterministic function of
*frame time*, not wall-clock — otherwise two machines show different inner transients (even though the
global hash is untouched). **Safest framing: treat the local solve as an operating-point read** — which
in practice means **installing the sub-netlist and reading the operating point the reset already
computes**: `set_netlist` runs `solve_operating_point()` on reset (the DC solve at lib.rs:4011/4078),
which itself uses `solve_operating_point_newton`'s memoryless assembly with `inv_dt = 0.0` (the "no
charge term" DC path, lib.rs:4710-4722 + 5363-5367). So `solveCell` is **even simpler than the draft
implied** — *install the sub-netlist + read `state()` / `element_currents()`*; you do **not** call
`newton_iterate` directly. Re-take it each frame from the live pin levels; the global tick supplies the
time evolution of the boundary, so the inner picture tracks without its own free-running clock:
reproducible across machines *and* a pure render-only read. (Open question 8.2 retained for whether
lost inner *transient* animation is worth a stepped local sim.)

### 3.7 Where the second sim lives + keeping the main boundary coarse

A dedicated wasm entry is cleaner than a second long-lived `Simulation`: add a render-only
`solveCell(sub-netlist, boundary) -> (node_v, element_currents)` on a **separate** `Sim` owned by the
wasm layer (or a pooled scratch `Sim` reset per call). **The 8-terminal install plumbing is free** — it
already exists end to end: `loop.ts` routes behavioral blocks through `set_netlist_pefgh` (loop.ts:171),
and `sim-wasm` exposes `set_netlist` / `set_netlist_pe` / `set_netlist_pefgh` (sim-wasm:58/99/116). So
`solveCell` reuses the install boundary **verbatim**; the **only** genuinely new wasm surface is
**owning/pooling the scratch `Sim` and resetting it per call** (plus reading back `state()` /
`element_currents()`). This keeps the once-per-frame **main** boundary coarse (CLAUDE.md golden rule #2):
the local solve is an explicit, on-demand, inspection-only crossing, fired **only while a cell is open**,
never on the per-component hot path.

### 3.8 Recommendation + sequencing

1. **Tier-1 forward-eval first** (immediate visible win, no wasm change): port the small combinational
   truth evaluator to TS and wire the per-inner-wire level/current the userIcInternalsView TODO needs.
2. **Add `solveCell` wasm entry + scratch Sim + the local `UserIcInternals` builder** and upgrade the
   focused cell to Tier-2 (DC operating-point read via install+reset; Thévenin boundary per §3.3a).
3. **Only then** revisit making the **global** build keep cheap cells digital (the true 8086-scale
   unlock, §2/§5) — that is the `buildNetlist`/`flattenUserIcs` change and should land *after* the
   inspection path proves out, since it is the step that actually removes today's always-on inner
   currents.

---

## 4. The integration hierarchy: subassembly vs board-IC, perverse stacking, VLSI tiers

### 4.1 The realization: ~80% relabel, one genuinely new structural piece

The owner's structural re-think is *mostly* a **role/UX relabel of mechanism that already ships**, plus
the one new piece §2 already named (characterize/collapse). Be explicit with the owner about which is
which — it changes the cost and risk dramatically.

### 4.2 Perverse recursive stacking is **live today** (existing)

A sealed cell is *already* a recursively-stackable building block. `flattenUserIcs` inlines placed
sealed ICs in waves to a fixed point, depth-guarded (`MAX_DEPTH = 24`) and instance-budgeted
(`MAX_INSTANCES = 4096`) (verified, userIc.ts:582-583); a nested inner IC's frame pins fuse onto its
already-inlined hub; `userIcsForGraph` descends transitively so nested defs round-trip in saves
(userIc.ts:309). **"Stackable perversely" needs no engine change — it is already the behavior** (Phase 1
shipped it; the 4-LUT teardown in `docs/phase4-lut-and-inverter-element.md` §6 counts 21 nested user-IC
instances against the 4096 budget). The only bound is the perf budget, not a model rule.

> **Doc reconciliation (NEW, doc-only).** Two ADRs need touching:
> - **ADR 0006's "exactly one layer of user nesting … No recursion"** rule is **stale** — superseded by
>   the live recursive `flattenUserIcs` (verified, userIc.ts:539, MAX_DEPTH=24 / MAX_INSTANCES=4096 at
>   582-583). Update it to say depth is bounded by `MAX_DEPTH`/`MAX_INSTANCES` (a perf budget), not by a
>   one-layer model rule.
> - **ADR 0005's "seal-as-same-netlist / the netlist is the genuine circuit"** framing needs a
>   **companion note**: the characterize/collapse path **deliberately breaks** that invariant — a
>   collapsed cell is **not** its discrete netlist in the global solve (it is one `ELEM_BEHAVIORAL`
>   standing in for the FETs). The render path still shows the genuine circuit (§3), but the *solve* no
>   longer does. Record this as an intentional, fidelity-gated exception, not a regression.
>
> No code risk in either.

### 4.3 Subassembly vs IC = a **role flag**, not a new type (NEW, small)

Every sealed cell *already* has a package/pinout/footprint (the IC trait) via `captureSeal` reading
`framePackage` (userIc.ts:729/737) and `userIcPartKind` deriving the `PartKind` (userIc.ts:197). The
*only* real difference the owner names is "goes on the board" vs "only goes into other things." Model it
as **one optional field** on `UserIc` / `LibraryEntry` (confirmed neither has a `role` field today —
userIc.ts:32-47, userLibrary.ts:35-46 — so it is genuinely new and append-and-default-safe):

```ts
role?: 'ic' | 'subassembly'   // NEW — default 'ic' = today's behavior, byte-identical
```

- `'ic'` → placeable on the board (shown in **My ICs**, has its package).
- `'subassembly'` → nested-only (hidden from the board parts bin, offered **only** inside the die
  editor's place flow).

`flattenUserIcs` / `resolveUserIc` / the `REGISTRY` stay **role-agnostic** — the bit is purely a bin
filter. `LibraryEntry` (verified, `web/src/lib/userLibrary.ts:35`) is a single store; one new filter +
one die-editor "place subassembly" source is ~90% relabel of shipped mechanism, golden-irrelevant
(web/UI/persistence only). Defaulting `role='ic'` keeps every existing sealed cell board-placeable and
every existing save byte-identical (the `pinNames`/family-sidecar append pattern). (Open question 8.7.)

### 4.4 The integration tier (SSI→ULSI) = a **derived label** (NEW, small, web-only)

The SSI/MSI/LSI/VLSI/ULSI band is a **pure derived label + sort key**, zero sim cost, never hashed,
never crosses the wasm boundary. The engine can count a cell's gate/transistor population after flatten:
`graphShape` already builds the netlist and returns a type histogram (netlist.ts:1840); a sibling helper
tallies `ELEM_NMOS`/`ELEM_PMOS`/`ELEM_GATE` recursively through `def.graph` + nested defs. Map the count
to a band (the owner tunes the thresholds — textbook SSI ≈ <12 gates … ULSI > 1M transistors span six
orders of magnitude; a game-scaled curve may fit the parts a player actually builds better), and show it
as a **badge** in My ICs + group/sort by it. (Open question 8.3.)

### 4.5 Promotion / packaging — "Tape out" (CORRECTED per owner decision)

> **Correction.** The panel's first draft said *promote subassembly → board IC = flip `role='ic'`*. The
> owner rejected the one-click flip: **promotion goes through the full packaging process, because that is
> where you choose the pinout.** This section is rewritten to that decision. The `role` field still
> exists (§4.3), but the **transition** subassembly → IC is *produced by* the packaging flow, not a free
> toggle of the bit.

**Why it cannot be a one-click flip.** A subassembly is **bare** — it has internal nets and a die layout
but **no chosen board pinout** (which nets are pins, where they sit, what package body). A board IC
**has** a pinout. So you literally cannot toggle `role='ic'`, because an IC needs pinout data the bare
subassembly does not carry. The **packaging process is what produces that data**, which is exactly why
the owner insists it can't be skipped: *"you need to be able to choose the pin out … you have to go
through the packaging process."*

**Two commits, two names (owner-refined 2026-06-25).** The bare commit keeps **Seal**; the packaging commit
is **Tape out** — truer to the real term (tape-out *is* the commit-to-package/fab step, not an intermediate
block). Concretely:

- **Seal → subassembly (bare).** The lighter, more common commit while you compose upward: finalize the die
  as a reusable **nested-only** block (`role='subassembly'`, §4.3) with no board pinout chosen. (This is
  also where **characterization** runs — §2.9 — since a subassembly's behavioral face is fixed at Seal.)
- **Tape out → board IC.** The packaging commit: choose the **pinout** (which internal nets surface as
  pins, their placement) and the **package body** (DIP/SOT/etc.), producing a board-placeable part with
  `role='ic'`. Reuses the **existing** capture machinery — `captureSeal` already reads the frame package
  (`framePackage`, userIc.ts:729/737) and `userIcPartKind` derives the `PartKind` (userIc.ts:197); the
  seal panel already chooses the pinout. The work is **naming + making the pinout choice the explicit gate
  of promotion**, not new packaging mechanism. You only pay the pinout choice when you actually want the
  thing on a board.
- **Re-packaging = yes (owner decision 1).** An already-packaged IC can go back through Tape out to
  **choose a different pinout / package** — you are never stuck with an earlier pinout. This reuses the
  **existing** reseal path (`resealUserIc` keeps tag/name, swaps graph/package, userIc.ts:284). **No
  instance churn:** placed instances reference the *tag*, which is unchanged; the library row is upserted
  by tag (`addToLibrary`, userLibrary.ts:119/129). Re-packaging is a re-run of the packaging step, not a
  structural change to placed copies.

So `role` is still the bin-filter field, but it is **set by Tape out**, and the subassembly→IC direction
is gated behind the pinout choice. Promotion is "run Tape out and pick a pinout," not "flip a bit."

### 4.5a Chiplets = just another scale of subassembly integration (owner decision 2)

The owner settled chiplets explicitly: **a chiplet is not a special type — it is just another scale of
subassembly integration.** A multi-die ("chiplet") part is built the same way as everything else: drill
into a new die one tier up, **place several subassemblies** as the cells, interconnect them, and **Tape
out** the result as a board IC. The "chiplet" framing is the *player's narrative* for "I integrated a
few of my big subassemblies into one package"; **mechanically it is the same recursive subassembly
stacking** (`flattenUserIcs` waves, §4.2) one integration tier higher. No new model, no new element.

**The invariant this preserves (and why it matters).** *"You do not put a packaged IC inside a die."* A
die only ever contains **bare interconnect + bare cells/subassemblies** — never a packaged part with
leads. This keeps the geometry honest (leads belong to a *package*, on a *board*; inside a die you have
die-level interconnect, not leaded packages) and sidesteps the whole #20-class "leads overhanging the
die wall" failure mode by construction. If a player wants what industry calls a chiplet module, they
integrate the **subassembly** forms of those dies — not their packaged IC forms — exactly as decision 2
says. Re-packaging (4.5) then lets them choose the multi-die part's external pinout independently.

### 4.6 Mapping onto the live user-IC / library / family system

| Owner concept | Live mechanism | Relabel or NEW |
| --- | --- | --- |
| Subassembly (nested-only block) | `UserIc` + `role='subassembly'` | **Relabel** + one bin filter |
| IC (board-placeable) | `UserIc` + `role='ic'` (default) — today's behavior | Existing |
| Perverse recursive stacking | `flattenUserIcs` waves (`MAX_DEPTH`/`MAX_INSTANCES`) | **Existing** |
| Variant families (a CPU you reuse, variants of a cell) | `UserIcFamily` / `FAMILIES` / `resolveUserIc` (userIc.ts:61/74/119) | Existing |
| "My ICs" bin / persistence | `LibraryEntry` / `libraryEntries` / `addToLibrary` / `renameLibraryIc` / `removeFromLibrary` | Existing |
| Integration tier badge (SSI→ULSI) | derived count over flattened graph + `graphShape` histogram | **NEW** (web-only, derived) |
| **Seal** (bare commit) / **Tape out** (package + choose pinout) / re-package | `captureSeal` (userIc.ts:729) + the seal panel's pinout choice + `resealUserIc` (:284) | **Relabel**: bare commit stays *Seal*, packaging commit is *Tape out*; promotion gated on the pinout choice (§4.5/§4.10) |
| Chiplet / multi-die part | recursive subassembly stacking (`flattenUserIcs` waves) one tier up | **Existing** — just another integration scale (§4.5a) |
| **Characterize / collapse (gates-as-cheap)** | `UserIc.behavior` + `ELEM_BEHAVIORAL` prog 4 + flatten branch | **NEW** (the flagship; §2) |

The minimal vocabulary: two **roles** (Subassembly / IC) + one **derived** axis (the integration tier
badge). "My ICs" stays the board-placeable bin; add a sibling **"My Subassemblies"** source surfaced
*only* inside the die editor's place flow. Both are the same store with a filter; sort/group each by
tier; a subassembly "graduates" by being run through **Tape out** with a chosen pinout (§4.5 — *not* a
one-click flip). This makes "build subassemblies → stack into bigger subassemblies → **Tape out** as a
board IC → reuse" a literal pipeline over one store.

### 4.7 Zoom-to-open on a *collapsed* cell

When a cell runs as its collapsed `ELEM_BEHAVIORAL` form, zoom-to-open has no live *discrete* internals
in the global solve to animate. Three options, escalating: **(a)** fall back to the static/authored
geometry view (the unpowered path already does this); **(b)** draw a behavioral block diagram;
**(c)** transparently **local-solve** just that one opened cell's discrete form (§3 Tier-2) for the
animation — which requires the new **local `UserIcInternals` builder** (§3.1) **and** the Thévenin
boundary (§3.3a), since a collapsed cell auto-populates neither the struct nor real inner currents.
(a)/(b) are cheap and shipped; **(c) is the richest and is exactly the §3 inspection path** — the whole
point of decoupling render from solve. (Open question 8.6.)

> **Scale note (corrected from the draft):** "place the whole CPU as ONE behavioral leaf" is the
> *ambition*, but route 2.5(b)'s 16-word state ceiling (lib.rs:1029) means a real 8086 is **not**
> literally one behavioral element — it is a **fabric** of behavioral elements (route 2.5a). §5 step 3
> states this explicitly.

### 4.8 Recommendation (sequencing)

Ship the **role flag + tier badge + ADR reconciliation first** (low risk, immediately makes the
vocabulary real, all web/UI/doc), then the **characterize/collapse** (§2) as the flagship follow-up that
actually unlocks scale. This directly serves "make a CPU you reuse a lot, and below it everything is just
subassemblies": subassemblies are the nested-only role, the CPU is a VLSI-tier IC, and collapse is what
lets it run.

### 4.9 The building flow across integration scales (owner brainstorm — the UX answer)

The owner's brainstorm: *"you can't place a non-IC onto your board and have it just work — in the real
world — so how do you handle the different scales of integration in the building flow? A separate sub-panel
per scale?"* The answer that falls out of §4.3–§4.5 is **not** a separate panel per scale (SSI panel, MSI
panel, …) — that would multiply UI for what is one recursive mechanic. It is **two libraries + one
recursive editor + the drill-in/out boundary**, with the integration scale as a *derived label*, not a
mode:

- **Two library sources, one store (§4.3).** **"My ICs"** = `role='ic'`, board-placeable, has a pinout
  and a package. **"My Subassemblies"** = `role='subassembly'`, bare, **nested-only**. Same `LibraryEntry`
  store, two filters. The board parts bin shows **only** My ICs; the die editor's place flow shows **both**
  (you can drop a bare subassembly *or* an already-packaged IC's die form as a cell). This is the literal
  enforcement of "you can't place a bare subassembly on a board": the board bin never lists one.
- **Drill-in / drill-out IS the scale boundary.** There is no per-scale panel; there is **one** die editor
  you recursively drill into. Each drill-in is one integration tier down; each commit (**Seal** or **Tape
  out**) finalizes one tier as a reusable cell. SSI→VLSI is just **how many times you have drilled** / how
  many cells the flatten count finds (§4.4) — a **badge**, not a mode the player switches. The same editor
  builds a NAND from FETs and a CPU from ALU-slice subassemblies; only the cell population differs.
- **The pipeline, end to end.** Drill into a die → place bare cells/subassemblies → wire the die-level
  interconnect → **commit**: **Seal** it as a subassembly (bare, cheap, keep composing upward) or **Tape
  out** as a board IC (choose the pinout + package, §4.5). Promote a subassembly later by running Tape out
  with a pinout. Re-package any IC by running Tape out again (decision 1). A "chiplet" is just this pipeline
  one tier up over subassemblies (decision 2, §4.5a).
- **Authoring on the overworld — the easy on-ramp (owner ask 2026-06-25; RECOMMENDED).** You don't have to
  start in a blank die. Build a circuit **right on the board (the overworld)** like any other, then
  **box-select a region and "Make subassembly"**: the harness infers the pinout from the nets that **cross
  the selection boundary** (a net wired both inside and outside the box = a pin), you label + role-tag those
  pins (§2.9), and it **Seals** into a cell — optionally replacing the selection in place with an instance.
  This is *modeless* and kills the **blind empty-frame** problem: you build with real signals and context,
  watch it work, *then* box it up — the build-then-extract pedagogy a teaching tool wants. The **drill-in
  die editor stays**, but as the way you **re-open** an existing cell to edit and as the recursive
  **zoom-to-open** inspection view — not the only way to *create*. **Two front-ends, one back-end:**
  extraction and drill-in both produce the same `(cell graph + inferred pinout)` the
  characterize/flatten/library stack already consumes; the scale boundary (§4.10) is set by the selection
  bounds instead of a placed frame. **One wrinkle:** a selection containing a **packaged board IC** uses
  that IC's *subassembly* form inside the new cell (the §4.5a "no packaged IC inside a die" invariant), or
  extraction declines it.
- **Leads-vs-interconnect visual fidelity (the honesty cue).** A **package** has **leads** and sits on a
  **board**; a **die** has **interconnect** and sits inside a package. The renderer should carry that
  distinction so the boundary reads at a glance — a placed IC shows leads/pins; drilled-in, you see
  die-level interconnect, **never** leaded packages nested inside a die (the §4.5a invariant, which also
  keeps the #20 "leads overhanging the wall" class of bug impossible by construction).

So the scales are unified, not paneled: **one recursive editor, two libraries (board vs nested), Seal/Tape
out as the commit at each tier, and a derived SSI→ULSI badge** to name where you are. The only thing that
makes a part board-legal is having been **taped out with a pinout** — which is exactly the real-world rule
the owner wanted to honor.

> **Naming, settled (owner, 2026-06-25).** **Tape out** is the *packaging* commit only (bare → board IC,
> where you choose the pinout). The **bare subassembly commit keeps "Seal."** So: *Seal* a die into a
> reusable nested block (→ "My Subassemblies"); *Tape out* a block into a packaged board part (→ "My
> ICs"). This is truer to the real term — tape-out *is* the commit-to-fab/package step, not an
> intermediate block.

### 4.10 Subassembly portrayal + proportional scale (owner asks: the box, the pinout, and "how big?")

Two owner questions land here: *(1) are subassemblies free-form boxes where I place + label + role-tag
pins on the edges and resize as needed? (2) when I drop one into the next layer up, how is its size chosen
so it's proportional?*

**Portrayal — today vs the box model.** What ships is a **templated package**: `UserIc.package =
{ archetype, pinCount }` (userIc.ts:32-47); you pick an archetype (SOT-23-3/5/6, VSSOP-8, DIP-8/14/16 —
`packages.ts:47-168`) and pins land on the edges by **JEDEC-standard numbering** (`dualLayout`/`sipLayout`).
You drill in as a **die** whose walls auto-derive from that package body (`dieBounds`, dieEditor.ts:129;
`IC_BODY_PAD`/`IC_LEAD_LEN`/`userIcBodyBox`, glyphs.ts). You **can** freely label pins (`pinNames`, the
die-editor popover); you **cannot** place pins at custom positions or resize the box. The right way to add
the owner's free-form box is to **split it by role** (the §4.3 two libraries):

- **Board IC** (taped out, sits on the real board) → stays a **real package**: standard archetype, pins on
  edges per spec, body sized to the footprint. Free-form "draw a box, stick pins anywhere" would *break*
  the teaching authenticity — a DIP-8 is a DIP-8. (Pick package + label pins ships today.)
- **Subassembly** (bare, nested-only, "My Subassemblies") → **NEW**: the free-form box the owner wants — a
  resizable rectangle, pins you drop on the edges and **label + role-tag** (the §2.9 roles), *because it is
  an internal hierarchical block, not a physical part.* It never sits on a board directly, so it needs no
  JEDEC footprint.

**Tape out is the bridge.** Promoting a subassembly to a board IC **maps its free-form edge-pins onto a
real package's pins** (pick DIP-8, assign box-pin → physical pin). *That mapping is "choosing the pinout."*
Re-packaging redoes it onto a different package (§4.5).

**Proportional scale — today it's "fit-to-box," the opposite of proportional.** Internals are drawn at
full board scale (`PITCH`) then the whole container is **uniformly scaled by a fit-scale `s` onto the chip
footprint**, with `cumulativeScale = ∏ of the parents' s` (what the zoom meter reads,
userIcInternalsView.ts). So today `s = footprint ÷ content-extent`, and the footprint is a **fixed
archetype size** — a 4-gate cell and a 400-gate cell in the same package get wildly different internal
scales (the dense one crushed 100× smaller). That is the non-proportionality.

**The fix — size the box *from* the contents, on one shared length scale.** Anchor every layer to the zoom
meter's `MM_PER_TOP_CELL = 2.5mm` (zoomMeter.ts). Then a placed cell's footprint **is** its real internal
extent at that scale, so "proportional" becomes literally "to-scale": area tracks content, so the box's
**side tracks √(cell-count)** (4 gates → side `L`; 16 → `2L`; 400 → `10L`). The content extent is just
`dieBounds` of the contents (already computed) instead of the archetype size.

**The integration tier becomes the *process shrink* (σ).** Raw to-scale explodes — a gate and a CPU at one
cell-size means a building-sized CPU or sub-pixel gates. Real silicon's only fix is **denser process per
tier**, so introduce a **per-tier shrink σ** (the "process node"):

> **placed footprint = (content extent) × σ(tier)**, floored by **`max(content×σ, perimeter-to-fit-the
> pins)`** so a 40-pin cell always has edge enough for 40 pins.

This makes the **SSI→ULSI badge (§4.4) do double duty — label *and* spatial scale.** Within a tier
(σ fixed): footprint ∝ √(content) — proportional. Across tiers: σ compresses, so a VLSI block of a million
gates fits a fingernail *because its σ is tiny* — which is physically *why* real VLSI is dense. And the
zoom meter stays honest because it is all one length scale: each drill-in multiplies `cumulativeScale` by
that child's `(extent×σ)/parent-cell` ratio, and the meter reads a real shrinking dimension (2.5mm → µm →
nm). You never need one impossible 10,000× plunge because **drilling resets the local budget per level**
(each tier ≈ σ⁻¹, a tidy 5–20×, well inside the `MAX_SCALE = 1000` we set — that headroom is *for* this).

**Recommended dial (owner-confirmed):** **√(content) within a tier + a fixed σ per tier, tuned looser for
legibility** — proportional where it matters, bounded zoom per drill-in, tier badge earns its keep. (The
alternative, σ continuous from gate-count, is smoother but bands less cleanly.)

### 4.10a Density has a cost — heat and money (owner ask; designed-around, not built now)

σ is not a free visual knob — **it is a real engineering tradeoff, and that is the point.** Packing more
into less footprint = a tighter σ = denser integration, and the price is exactly the owner's intuition:

- **Heat ↑.** More dissipation per unit area. The mechanism would be **NEW web-side work, but it rides an
  existing golden-safe hook** — do **not** read this as already-built. `RATED_CURRENT_SLOT` (lib.rs:2452) is
  only the slot *constant*; **no density/derate code exists in sim-core today** (repo-searched). What ships
  is the *rating → FAIL* contract: in **Real mode** the web layer installs a slot-2 rating and
  `flag_and_clamp_fails` (lib.rs:6803-6808) sets the FAIL mask when `|I| > rated` — **never altering the
  solve** (`failed_elements` is not in `snapshot_hash`). So density-as-heat = *web-side* lower the Real-mode
  slot-2 rating a too-dense part installs, and the existing FAIL mask boxes it. **Golden-safe by the
  existing contract; the derate factor itself is NEW, not half-present.** ⚠️ It also collides with the
  sub-tick rate (§2.7a: `BEH_SUBTICK_RATE_SLOT == RATED_CURRENT_SLOT == 2`) — a sub-ticked behavioral leaf
  cannot *also* carry a slot-2 density rating, so heat-on-dense-*fabric* is gated behind moving the sub-tick
  rate off slot 2 (`TODOS.md` density brainstorm), or deriving heat only on analog leaves / supply nets.
- **Cost ↑.** Finer process / bigger die both cost more — the economy hooks (Credits) price the σ choice.

So the dial reads: **tight σ = small board footprint but hotter + pricier; loose σ = bigger but cooler +
cheaper.** That is what makes the proportional-scale model *matter* rather than merely look right — you are
trading **board area vs heat vs cost**, the actual VLSI tradeoff. This folds in the existing `TODOS.md`
density brainstorm (density scalar on `UserIc.package`; a `dieScale` on `dieLayout`; a capacity budget at
the commit; heat-as-derating; economy hooks; SOIC→TSSOP→QFN body archetypes with density-biased
parasitics) — *one source of truth*, so the two don't drift. **Not built now** (owner: "doesn't quite
matter right now, but should be noted and designed around"); recorded here so the σ model and the
density-cost model are one design from the start.

---

## 5. How it composes to a hand-built, zoomable, real-time, deterministic 8086

The pieces stack into the owner's endgame. Walk it bottom-up:

1. **A player builds a gate from FETs in the die editor and seals it.** Today that sealed die flattens
   to real FETs everywhere it is placed (the expensive path) — fine for one gate, fatal for a CPU
   (`is_digital` excludes NMOS/PMOS, lib.rs:2073, so every FET is a Newton unknown in the dense
   O(n³)/frame MNA).
2. **Characterization gives the gate a behavioral face** (§2). A NAND/INV/flip-flop collapses to one
   `ELEM_BEHAVIORAL` (or a small registered-LUT fabric); `classify_nets` keeps its **signal** nets out
   of the matrix (lib.rs:2169-2179); `eval_digital` runs it for **zero analog cost on its logic**
   (lib.rs:5866). The gate now costs what a built-in gate costs.
3. **Subassemblies stack the cheap faces recursively** (§4). A registered ALU slice is a subassembly of
   characterized gates; a register file is a subassembly of those; the 8086 datapath + control is a
   subassembly of *those*. `flattenUserIcs` already inlines this hierarchy to a fixed point
   (userIc.ts:539); the wide-cell fabric route (§2.5a) keeps each level all-digital. **The placed 8086
   is a *fabric* of behavioral elements, NOT one black-box leaf** — route 2.5(b)'s single-element state
   ceiling is 16 u32 words (`BEH_STATE_WORDS`, lib.rs:1029), far short of a register file, so the
   realistic CPU is many behavioral elements (route 2.5a) with registers between stages. (Where the
   engine stops carrying per-inner structure at all — a true behavioral leaf — is open question 8.8.)
4. **The eye gets full fidelity on demand** (§3). When the lunatic zooms into a specific gate inside a
   specific slice inside the CPU, the `viewProbe` frontier (userIcInternalsView.ts:117) identifies the
   deepest focused cell; `solveCell` (NEW wasm entry, §3.7 — install the sub-netlist on a scratch `Sim`
   and read its reset operating point, no direct `newton_iterate`) reconstructs *just that* sub-netlist
   with its pins on a **Thévenin** boundary (§3.3a, *not* stiff VSOURCEs); a **local `UserIcInternals`
   builder** (§3.1) feeds `drawUserIcInternals` the local `node_v` / `element_currents`, animating
   **real** inner V and per-FET I_D (§3.4). Everything else stays cheap. This is "SEE ALL the currents
   and voltages … in REAL TIME INSIDE of it" — paid for only at the eye.
5. **Determinism never breaks** (§6). The global hash folds only the global sim's state
   (lib.rs:7353+); the characterized faces are append-and-default-off in `beh_state` (lib.rs:7353-7404);
   the inspection solve runs on a *separate* hash-isolated `Sim`. Two machines reproduce the CPU
   bit-for-bit (given a deterministically-extracted word, §2.1).

**The scaling story, stated precisely (corrected from "almost nothing"):**

> Collapsing every gate to a behavioral cell removes all its **logic** nets from the dense MNA, so the
> analog matrix no longer carries "every transistor in the CPU." But two costs remain, and the doc must
> not gloss them:
> 1. **Supply nets stay analog.** `classify_nets` keeps a behavioral cell's VCC/GND nets Analog
>    (lib.rs:2169-2179). A CPU's power distribution is therefore still in the dense O(n³) MNA, and
>    thousands of cells sharing rails add analog nodes/coupling. (A real win is to keep the supply
>    network coarse — few rails, not per-cell — but it is *not* zero.)
> 2. **The digital evaluator is linear, not free.** `eval_digital` + the sub-tick loop are
>    O(elements × `subtick_rate`) **per tick** on the **single** global `Sim` (lib.rs:6736). At 8086
>    gate counts (tens of thousands of LUT-equivalents) with a non-trivial **global** sub-tick rate
>    (which §2.7 may force for deep combinational cones, and which §2.7a couples to the slot-2 rating),
>    this is a real per-frame cost.
>
> So: **the analog matrix carries only the cells' supply nets + any genuinely-analog leaf, while the
> digital evaluator cost scales linearly with cell-count × sub-tick rate** — still a *massive* win over
> flattening every FET into Newton (which is O(n³) in the transistor count), but **bounded**, not
> "almost nothing." The renderer's reach, by contrast, is unbounded because it reads a snapshot, not a
> solver. A hand-built, zoomable, real-time, deterministic 8086 is reachable for the lunatic who tries —
> with the cost honestly a linear digital evaluator plus a supply-net matrix, not zero.

The gating new work is §2's characterization (especially the Phase-C wide-cell *fabric* route), not a
new solver.

---

## 6. Determinism and the golden contract (one statement)

> **The golden snapshot hash `0xeaac_3764_99e4_fa24` does not move.**

Why each path is safe (every claim verified against the live code):

1. **Characterization reuses an existing element.** A combinational ≤4-input cell collapses to one
   `ELEM_BEHAVIORAL` prog-4 LUT (lib.rs:1070), which already exists and is already hashed; no new
   `ELEM_*`, no new param slot. `snapshot_hash` folds `beh_state` **append-only after the analog node /
   DFF / sampler / comparator folds** (lib.rs:7353-7404), so a board with no behavioral block folds
   **zero** extra bytes, and a combinational LUT folds an **all-zero** state block (the word is in `aux`,
   lib.rs:1502-1503).
2. **The golden circuit places none of the new parts.** The golden run is a fixed circuit with no user
   IC, no characterized cell. `flattenUserIcs` is a strict no-op when no user IC is placed (the early
   return, userIc.ts:553), and REGISTRY + FAMILIES are empty for it (userIc.ts:546-548), so neither the
   new flatten branch nor the recursion can perturb it.
3. **The fidelity toggle and the role flag are web-only.** `Component.fidelity` and
   `UserIc.role` / `LibraryEntry.role` live entirely in `buildNetlist` / the library / the bin —
   default-off / default-`'ic'`, append-and-default-safe (the `pinNames`/family-sidecar pattern), and
   confirmed absent today (graph.ts, userIc.ts:32-47, userLibrary.ts:35-46). The integration-tier badge
   is a derived web label, never hashed, never crossing the wasm boundary.
4. **The local solve is a separate, hash-isolated `Sim`.** `snapshot_hash` folds only *that* instance's
   `node_v`/`net_level`/sequential state (lib.rs:7353+); a second ephemeral/pooled `Sim` cannot touch the
   global instance's bytes. The DC operating-point read is memoryless (the reset's
   `solve_operating_point` → `inv_dt = 0.0`, lib.rs:4710-4722 + 5363-5367) and side-effect-free.
5. **A new wider `BEH_PROG_*` (route 2.5b), *if* built, is append-and-default-off** — a new program arm
   appended after the existing ones, emitted only for cells that opt in, golden-absent. (Route 2.5a needs
   no sim-core change at all.)
6. **The slot-2 reuse is golden-safe both ways** (§2.7a). `BEH_SUBTICK_RATE_SLOT = RATED_CURRENT_SLOT`
   (lib.rs:2484), but both meanings default to 0/off and the golden places no behavioral block, so the
   shared slot folds nothing. (It is a *feature* constraint — a sub-ticked cell forgoes a current rating
   — not a golden risk.)

**The one hash-stability requirement on the feature itself (not a golden risk):** once a behavioral cell
*is* placed, the hash folds its resolved digital `net_level` (lib.rs:7358, via
`commit_net_levels → fam.quantize`, 6170-6182). That level is a deterministic function of (word, inputs),
so reproducibility holds **provided** (a) the extracted word is itself deterministic — it is, by the
module determinism contract (lib.rs:282-290) and the offscreen fixed-order sweep — and (b) the cell
genuinely passed the pure-combinational/stable guard (§2.6). A *mis*characterized non-combinational block
collapsed to a LUT would still hash deterministically but would be **logically wrong** versus its FET
face — so the guard is a **correctness** gate, not a determinism gate, and must run on the same offscreen
deterministic `Sim`.

The decisive consequence: **adding the behavioral face, the fidelity toggle, the role flag, the tier
badge, and the inspection solve changes the golden circuit's bytes by exactly nothing** — the contract
holds *by construction*, not merely by test, as long as the new element is only emitted for cells that
opt in.

---

## 7. A phased build path (smallest real builds first)

| Phase | Build | Reuses (existing) | New | Risk |
| --- | --- | --- | --- | --- |
| **0** | ADR reconciliation: retire 0006's "one layer" rule; add the 0005 "collapse breaks seal-as-netlist" companion note | the live recursive `flattenUserIcs` | doc edit only | none |
| **1** | Role flag (`role`) + "My Subassemblies" bin filter + die-editor place source | `LibraryEntry`, `addToLibrary`, `userIcPartKind`, the My ICs bin | one field + one filter + one place source | low (web/UI) |
| **2** | Integration-tier badge (SSI→ULSI) | `graphShape` histogram, `flattenUserIcs` count | a recursive count helper + band map + bin sort | low (web, derived) |
| **3** | Tier-1 forward-eval inner telemetry (port truth eval to TS; wire the per-inner-wire current the `userIcInternalsView.ts:533` TODO needs) | `drawUserIcInternals`, `drawDetailMOSFET` | a TS combinational truth evaluator (gate codes + LUT4) | low (pure boolean) |
| **4** | `solveCell` wasm entry + scratch `Sim`; Tier-2 on-zoom local DC solve for the focused cell | `Sim::new`/`set_netlist*` (incl. `set_netlist_pefgh`, sim-wasm:116 — install plumbing is **free**), `buildNetlist` (headless), `viewProbe`, the reset DC `solve_operating_point` (`inv_dt=0`) | **(a)** owning/pooling+resetting the scratch `Sim`; **(b)** a **local `UserIcInternals` builder** keyed off the sub-netlist (NOT a mere slice swap — the collapsed case has no `flatSink` struct); **(c)** the Thévenin boundary-pin model (§3.3a) | medium (new crossing + new local struct builder, but isolated) |
| **5** | `UserIc.behavior` + per-instance `Component.fidelity`; combinational ≤4-in characterization sweep + guard; flatten emits the LUT (reusing `BEH_SPEC.LUT.term`) instead of FETs | `ELEM_BEHAVIORAL` prog 4, `BEH_SPEC.LUT`, `eval_digital`, `classify_nets`, snapshot fold | the offscreen sweep harness, the guard (output `quantize`, not `beh_level`), the flatten branch | medium (the flagship; golden-safe by construction) |
| **6** | Registered ≤4-in 1-bit sequential characterization (registered-LUT mode; clock fixed to terminal b; edge-dependence guard) | `beh_lut_step` (lib.rs:1554), registered-LUT drive (lib.rs:6005-6021) | next-state extraction + edge-dependence check | medium |
| **7** | Wide-cell strategy — route (a) fabric-of-LUT4 synthesis (default, no state ceiling) **or** route (b) a new wider `BEH_PROG_*` for a ≤16-word-state FSM | (a) reuses everything; (b) the behavioral framework + `beh_state` (16-word cap, lib.rs:1029) | (a) a Shannon-expansion synthesis pass; (b) a new program arm + bigger characterization | **high — the CPU-scale enabler** |
| **8** | Global build keeps characterized cells digital (the true 8086-scale unlock) | the §5 stack | the `buildNetlist`/flatten policy that picks behavioral over FET-inline at scale; the global sub-tick-rate policy (§2.7) and its slot-2 rating trade (§2.7a) | medium-high (lands *after* 4–7 prove out) |

**Reuse-vs-new tables (consolidated):**

| Subsystem | Existing (reuse verbatim) | NEW |
| --- | --- | --- |
| Characterization | `ELEM_BEHAVIORAL` prog 4 (lib.rs:1070), `beh_lut_bit`/`_step` (1528/1554), `BEH_SPEC.LUT` + its `term` map (netlist.ts:513), `Sim` determinism (lib.rs:282-290) | the sweep harness; `UserIc.behavior`; the flatten branch; the guard (output-`quantize`); wide-cell **fabric** route |
| Live telemetry | `drawUserIcInternals` (userIcInternalsView.ts:192), `drawDetailMOSFET` (detailDrawers.ts), `viewProbe` (:117), `innerGraph.restore` (netlist.ts:707), `Sim`+`set_netlist*`/`_pefgh` (sim-wasm:116), reset DC `solve_operating_point` (`inv_dt=0`, lib.rs:4710) | TS forward-eval truth port; `solveCell` scratch-`Sim` owner; **local `UserIcInternals` builder**; Thévenin boundary model |
| Integration hierarchy | `flattenUserIcs` recursion (userIc.ts:539), `FAMILIES`/`resolveUserIc` (userIc.ts:61/119), `LibraryEntry`/`addToLibrary` (userLibrary.ts:35/119), `resealUserIc` (:284), `graphShape` (netlist.ts:1840) | `role` flag + bin filter; the tier-badge count; ADR 0005+0006 reconciliation (doc) |

---

## 8. Open questions for the owner

> **RESOLVED (owner, 2026-06-25).** The numbered questions below are answered; kept verbatim for the
> reasoning. Decisions, by this section's numbering:
> | Q | Decision |
> | --- | --- |
> | 8.1 Fidelity granularity | **Per-instance** |
> | 8.2 Inner telemetry | **DC operating-point read** |
> | 8.3 Tier bands | **Game-scaled curve, textbook names** |
> | 8.4 Wide-cell strategy | **Fabric of LUT4s** |
> | 8.5 Cycle-equivalence | **Accepted** (re-explore flagged later) |
> | 8.6 Collapsed-cell zoom | **(c) transparent local-solve** — the build-toward goal |
> | 8.7 Role default | **Default subassembly**; promote via packaging |
> | 8.8 Leaf boundary | **Zoom depth + budget decides** — no forced floor |
> | 8.9 Bidirectional buses | **Deferred, kept open** |
> | 8.10 Truth-eval ownership | **Option A (TS port) + a CI cross-check test** vs Rust through wasm |
> | 8.11 Eviction hysteresis | **Yes — warm-keep** N frames |
> | 8.12 Double-solve gating | **Yes — gate Tier-2 to digital-run cells** |
> | 8.13 "Tape out" wording | **Tape out = packaging only; bare commit stays "Seal"** (§4.10) |
> | 8.14 Pinout prompt | **Only when promoting to a board IC** |
>
> **Scale dial (from §4.10):** **√(content) within a tier + fixed σ per tier, tuned looser for
> legibility.** **Density-cost (§4.10a):** noted + designed-around (heat = Real-mode rating-derate; cost =
> economy), **not built now.**
>
> **Newly open (raised by §2.9 / §4.10, for a later pass):** (i) characterization auto-captures the
> worst-case pin current as the default rating, or leave it manual? (ii) sequential sweep — auto-exercise
> only the declared clock, or let the author name a reset/enable pin for a complete next-state table?
> (iii) free-form subassembly box — truly drag-anywhere edge-pins + drag-resize, or gridded (snap pins to
> edge cells)? (Gridded is far easier to render/route and still feels free.)

1. **Fidelity granularity.** Per-**instance** (`Component.fidelity`, like tier/variant — same CPU cell
   opened live in one spot, collapsed everywhere else) or per-**definition** ("always collapse above
   tier X")? Per-instance is more flexible and reuses the variant/tier axis, but a board then mixes
   representations of one tag.
2. **Inner telemetry: DC read or stepped sim?** Tier-2 as a pure **DC operating-point** read
   (deterministic, no inner transient animation) or a **tick-locked stepped** inner sim (shows RC/Miller
   settle but needs a reproducible per-frame step budget)? The DC read is simpler and safe; is the lost
   inner dynamics worth the determinism cost for a teaching tool — and if stepped, what step-count
   function of frame time stays machine-independent?
3. **Integration-tier bands.** Textbook thresholds verbatim (SSI ≈ <12 gates … ULSI > 1M transistors — a
   teaching anchor spanning six orders of magnitude) or a **game-scaled curve** fit to the parts a player
   actually builds?
4. **Wide-cell strategy.** For >4-input / multi-output / multi-bit cells (which dominate an 8086):
   **fabric-of-LUT4 decomposition** (reuse, all-digital, no state ceiling, a real synthesis problem) or
   a **new wider `BEH_PROG_*`** (one element, new sim-core, capped at 16 state words)? The fabric is the
   only route without a hard state ceiling; is route (b) worth it for moderate-state FSMs?
5. **Mixed-fidelity equivalence (scoped, §2.7).** The two faces are cycle-equivalent **only** for
   registered cells with ≤1 combinational LUT between registers per clock domain, **or** under a
   **global** sub-tick rate covering the deepest combinational cone — *not* blanket "cycle-equivalent at
   clock granularity." For a fully synchronous 8086 this holds at the default rate; do you accept that
   deep *unregistered* combinational chains either need a (costly, global) sub-tick rate or will differ
   cycle-by-cycle from the FET face? And do you accept the §2.7a trade — a sub-ticked cell forgoes a
   slot-2 current rating?
6. **Zoom-to-open on a collapsed cell.** (a) static authored geometry, (b) a behavioral block diagram,
   or (c) transparently local-solve the one opened cell's discrete form (§3 Tier-2, which needs the new
   local-struct builder + Thévenin boundary)? (a)/(b) ship cheap; (c) is the richest and reuses the
   inspection path.
7. **Role default + migration.** Default `role='ic'` (safe — every existing cell stays board-placeable),
   or default a cell **obviously** a building block (authored in a bare frame / below an SSI threshold)
   to `'subassembly'` to nudge the pipeline?
8. **The behavioral leaf boundary.** At which integration tier does the engine **stop carrying per-inner
   structure at all** (a true behavioral leaf with no openable internals)? A placed 8086 is realistically
   a *fabric* of behavioral elements (not one leaf — the 16-word state cap, §5 step 3); where is the
   floor on openability — and does the inspection path compose with multi-level black-boxing (solve a
   gate inside a cell inside a CPU)?
9. **Bidirectional/high-Z resolution policy.** §3.3a settles that external pins use a **Thévenin**
   boundary (not stiff VSOURCEs) and that driver pins aren't pinned. The remaining question is the
   *resolution* policy for genuinely **bidirectional** bus pins (a pin both the cell and the global side
   may drive): which side wins per frame, and is a bus-keeper/contention model needed for a faithful
   tri-state bus?
10. **Canonical truth ownership.** Port gate/LUT truth to TS (Tier-1) **and** keep it in Rust
    (`eval_digital`) — two copies risk drift (a new gate family added in Rust but not TS) — or expose a
    single wasm "eval-only" entry the TS forward-eval calls (one crossing per open cell)? Which side owns
    the canonical table?
11. **Eviction hysteresis.** The render subtree teardown is keyed on on-screen size + view cull, which
    can thrash on a fast pan. Should the live-solve LRU keep a recently-focused cell's solve warm for N
    frames so a small camera jitter doesn't repeatedly tear down and rebuild a sub-`Sim` (which has more
    fixed cost than a `Graphics` clear)?
12. **Double-solve during migration.** While the global build still flattens cheap cells to FETs, the
    inner currents already exist globally. Should Tier-2 be **gated** to fire only for cells that are
    NOT flattened (i.e. only once the global build runs them digital), to avoid redundant work and two
    slightly different inner pictures?
13. **"Tape out" scope (owner decision 4).** Settled: the commit action is renamed **Tape out**. Open
    nuance: does *every* commit say "Tape out" (both the bare-subassembly commit and the board-IC
    packaging), or is the bare commit a lighter-named "Tape out → subassembly" vs the full "Tape out →
    package"? §4.5 assumes one action with two targets; confirm the wording you want on each button.
14. **Subassembly default + the pinout prompt.** When a player Tapes out for the first time, do we
    default to **subassembly** (cheap, bare — nudges the compose-upward pipeline) and only prompt for a
    pinout when they explicitly choose "→ board IC"? Or always offer both at the commit? (Couples with
    OQ 7's role default.)

---

**Summary.** Sim and render are already decoupled; the three asks mesh as a level-of-detail split, not a
solver merge. Give a sealed cell **two faces** — a cheap characterized one (one `ELEM_BEHAVIORAL` LUT
reusing `BEH_SPEC.LUT.term` for the ≤4-in/≤1-bit case today; a LUT-**fabric** for wider cells, since a
single behavioral element caps at 16 state words) for scale, and a full-fidelity discrete one for the
eye — selected by a per-instance fidelity toggle and the zoom frontier. The two faces are cycle-equivalent
**for registered, shallow-combinational cells (the synchronous-CPU case)**, not for deep unregistered
chains without a costly *global* sub-tick rate — and that rate aliases the current-rating slot, so a
sub-ticked cell forgoes a rating. Recover live inner V/I where the eye is via an on-zoom local DC solve
(install the sub-netlist on a separate, hash-isolated scratch `Sim` and read its reset operating point),
with a **Thévenin** pin boundary (not stiff VSOURCEs) and a **new local `UserIcInternals` builder** to
feed the renderer for the collapsed case; forward-eval is the cheap default everywhere else. Relabel the
existing recursive sealed-cell system into a **subassembly (nested-only) vs IC (board-placeable)** role
flag with a derived SSI→ULSI integration-tier badge, and reconcile ADR 0005 (collapse breaks
seal-as-netlist) and 0006 (recursion is live). The only genuinely new structural work is the
characterize/collapse step (and its wide-cell *fabric* frontier), which — bounded by a linear digital
evaluator plus an analog **supply-net** matrix, *not* "almost nothing" — is what makes a hand-built,
zoomable, real-time, deterministic 8086 reachable. The golden `0xeaac_3764_99e4_fa24` holds by
construction throughout — every new path is append-and-default-off, web-only, or render-only on a
separate sim.

**Owner-decision deltas folded into this revision (2026-06-25).** The "cheap digital solve" is pinned as
a logic-level eval of a **real powered gate** (VCC/GND kept; not a 3-pin teaching gate, not CMOS — §2.0).
The building flow is **two libraries** ("My ICs" board-placeable vs "My Subassemblies" nested-only) over
**one recursive die editor**, with drill-in/out as the scale boundary and a derived SSI→ULSI badge — not
a panel per scale (§4.9). The **bare commit is "Seal," the packaging commit is "Tape out"** (§4.10).
**Promotion goes through the full packaging process to choose the pinout — not a one-click `role` flip**
(the panel's original §4.5 was corrected). **Re-packaging is allowed** (re-run Tape out; no instance
churn). **Chiplets are just another scale of subassembly integration** — a die never contains a packaged
IC, only bare cells/interconnect (§4.5a). Later sections add the **characterization test-bench** (§2.9 —
declare roles, derive the rest, auto-sweep on a scratch `Sim`), **subassembly portrayal + proportional
scale** (§4.10 — free-form box; footprint = content × per-tier shrink σ), and **density-as-cost** (§4.10a
— heat + money). None of these touch the solver; all are web/UI/persistence/render, so the golden is
untouched.
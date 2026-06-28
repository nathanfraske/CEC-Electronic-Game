<!-- SPDX-License-Identifier: Apache-2.0 -->

# The reference library curriculum — earn-it-by-hand → unlock → sneaky behavioral swap-in

**Status:** design (2026-06-28). Captures the owner's vision for how the game's IC primitives become a
**player-earned** library, and how a hand-built part is transparently swapped for its cheap deterministic
behavioral twin once proven. This is the "sand → CPU" progression spine (backlog #41). Read alongside
`docs/ic-reference-library.md` (the parts checklist), `docs/sim/transistor-scale-convergence.md` (why the
swap is necessary), and `docs/memory-characterization-design.md` (the characterization machinery).

## 1. The vision (owner, verbatim intent)

> "Replace all of the IC primitives we have with **worked-example** ones in a prefab library. People unlock
> the prefabs only after they prove they can make it **by hand**, and then they can just use theirs. The
> prefabs are just for reference, and as a potential **sneaky behavioral swap-in**: if the player makes an
> identical part, we use the **deterministic behavioral version** to do cheap simulations with it."

Three moves, one loop:

1. **Earn it.** Every IC primitive (gate, latch, adder, SRAM cell, …) is a **transistor-level worked
   example**. It is **locked** until the player builds an equivalent **by hand from real transistors**.
2. **Unlock it.** When the player's hand-built cell is **functionally identical** to a reference, that
   reference unlocks — the player can now drop the polished prefab instead of re-wiring transistors.
3. **Swap it (sneakily).** Because the player has *proven* the part, the engine may transparently simulate
   their instances with the **characterized behavioral model** (a LUT / `ELEM_BEHAVIORAL`, or `ELEM_MEMORY`
   for storage) — cheap, deterministic, and **scalable** — while still **showing the transistors** on
   zoom-to-open. This is the only way a CPU-sized design ever runs (see §6).

This resolves the central tension surfaced in `transistor-scale-convergence.md`: raw transistors are the
**pedagogy** (show the silicon, prove understanding); the behavioral twin is the **scale** (a 548-FET ALU,
let alone a CPU, cannot be solved as one Newton system). Earn-it-by-hand is the bridge that makes the cheap
swap *honest* — you only get the shortcut for a part you demonstrably understand.

## 2. What already exists (this is mostly wiring, not new invention)

| Piece | Where | Role in the loop |
| --- | --- | --- |
| Transistor reference cells | `web/src/lib/circuits/prefabs.ts` (16 cells: Inverter, NAND, NOR, AND, OR, XOR, MUX, D-latch, D-FF, 1-bit reg, **6T SRAM**) | The worked examples themselves; `flattenUserIcs` inlines them to real FETs. |
| Characterization sweep | `web/src/lib/characterize.ts` `characterizeCell()` → `{prog, word, mode, sig}` | Turns a hand-built cell into its **truth table** (`word`) + a deterministic graph **signature** (`sig = cellBehaviorSig`). The "did they build a working X?" oracle. |
| Storage characterization | `characterizeMemoryCell` / `MemBehavior` (`docs/memory-characterization-design.md`) | Same, for a 6T SRAM / 1T1C DRAM bit → an `ELEM_MEMORY` face. |
| Behavioral collapse (the swap) | `flattenUserIcs` + `preferBehavioral` + per-instance `fidelity:'behavioral'` (`web/src/lib/userIc.ts:1205,1280`) | Already substitutes the cheap LUT/`ELEM_MEMORY` for the real FETs **when a cell carries a `behavior` and the instance opts in**. The "sneaky swap-in" is *auto-applying* this on a proven part. |
| Signature equality | `setUserIcBehavior` already does `prev.behavior.sig === cellBehaviorSig(graph)` (`userIc.ts:728`) | Precedent for identity by signature. |
| Reference checklist | `docs/ic-reference-library.md` | The master list of every primitive to cover. |
| Verified: the 6T SRAM works | `web/src/lib/sramTransistor.test.ts` | The transistor SRAM converges + holds a written bit — a proven-by-hand part is *simulable*. |

**New pieces this curriculum needs:** (a) a **functional-identity** check (§3), (b) an **unlock/lock state**
per reference part (§4), (c) **auto-application** of the behavioral swap on a proven match (§5), and (d) the
**bin UX** for locked/earned parts (§7). Everything else is reuse.

## 3. The identity check — "is the player's part the reference?" (the keystone)

The proof oracle. Two candidate notions of "identical"; we want **functional**, not structural:

- **Structural (`sig = cellBehaviorSig(graph)`):** exact inner-graph hash. **Too strict** — two correct but
  differently-wired NANDs hash differently. Keep `sig` for "has this exact cell changed?" (re-characterize
  trigger), **not** for "did the player build a NAND?".
- **Functional (recommended): the characterized `word` (truth table) + pin signature.** Characterize the
  player's cell; compare its `(class, input-count, output truth table)` to each reference's. A NAND is a NAND
  regardless of transistor topology. This is the honest "you built a working X" test.

**Definition (combinational):** player cell P matches reference R iff
`characterize(P).word === R.word` **and** P's input/output **arity + roles** match R's (same number of
inputs, one output, VCC/GND present). `prog`/`mode` must agree (both LUT-class). Pin *names/order* need not
match — function is function.

**Sequential cells** (latch / flop / register): `characterizeSequential` already classifies these; match on
the **next-state table** + the detected class (latch vs flop), not a raw LUT. Self-dependent cells (counters)
that `characterize` fails-safe on are **not auto-matchable** — they unlock only by an explicit owner-tagged
reference equivalence (out of scope for P1).

**Storage cells** (6T SRAM, DRAM bit): match on the `MemBehavior` class (mode + addr/word width) from
`characterizeMemoryCell`. A cross-coupled-pair-with-2-access-FETs that reads/writes one bit **is** a 6T SRAM
cell.

**Determinism:** `word`/`sig` come from `cellBehaviorSig` (FNV-1a, golden-rule compliant). The match is a
pure function of the characterization — reproducible, headless-testable (characterize a hand-built NAND,
assert it matches the NAND reference; characterize a hand-built XOR, assert it does **not** match NAND).

## 4. Unlock model

- **Granularity:** per **reference part** (one lock per row of `ic-reference-library.md`). Unlocking "NAND"
  unlocks the NAND reference cell for placement.
- **Lock state:** a persisted set of unlocked tags (player profile / save). Default: **all reference parts
  locked** except a small **seed set** the player needs to bootstrap (the raw transistors `NM`/`PM`, `R`,
  `V`, `GND`, wires — the literal sand). You cannot prove a NAND without transistors to build it from.
- **Earned how:** whenever the player **characterizes** a cell they built (existing Tape-out / characterize
  flow), run the §3 match against still-locked references; any match flips that reference to **unlocked** and
  fires the "you built it!" moment (§7). A player may also unlock by placing/So importing a known-good cell —
  but the *intended* path is build-it-yourself.
- **"Use theirs":** once unlocked, the player chooses per placement: **their** hand-built cell (full fidelity,
  their layout) **or** the polished reference prefab. Both are transistor-level; both can take the swap (§5).
- **Tech-tree shape (optional, later):** references can declare prerequisites (XOR ref suggests NAND/INV
  first) so the bin reads as a progression. Pure UX sugar over the per-part locks.

## 5. The sneaky behavioral swap-in

Once a part is **proven** (its def carries a `behavior`/`memBehavior` from characterization AND it has matched
a reference), its placed instances may simulate as the **cheap deterministic face**:

- **Mechanism:** exactly the existing `fidelity:'behavioral'` collapse in `flattenUserIcs` — a proven cell's
  instance emits **one** `ELEM_BEHAVIORAL` (LUT) / `ELEM_MEMORY` instead of inlining FETs. No new engine code.
- **Auto-apply policy (the "sneaky" part):** when a design exceeds a transistor-count / convergence budget
  (the `transistor-scale-convergence.md` cliff), **auto-collapse proven instances** to behavioral, deepest
  first, until the netlist is solvable — silently, because the player has earned the right to trust the model.
  Surface it (a small "running N cells as characterized models" readout) so it is honest, not hidden.
- **Still shows the silicon:** behavioral fidelity changes the **solve**, not the **render** — zoom-to-open
  still draws the authored transistors. "Show the transistors" is preserved at every scale.
- **Determinism / golden:** web-only; the behavioral face is already deterministic (LUT/`ELEM_MEMORY`,
  golden-safe). The golden places no user IC, so untouched.

## 6. Why this is the only path to a CPU / DOOM

`transistor-scale-convergence.md` proves it with numbers: ~548 raw FETs (one ALU) already fails Newton →
garbage. Newton #88 (gmin globalization, now landed golden-safe) **raises** that ceiling for modest cells but
cannot remove it — a CPU is tens of thousands of FETs. The reference-library curriculum **is** the scaling
plan: build each cell from sand → prove it → from then on it costs **one LUT** to simulate. Compose proven
cells into the CPU; the CPU runs as a few hundred LUTs (linear, no Newton), not a million transistors — while
every cell still *opens* to its real silicon. Earn-it-by-hand is what makes the cheap CPU pedagogically honest.

## 7. UX sketch (later phases)

- **Bin:** locked references render dimmed with a small lock + "build it to unlock" tooltip; the raw
  transistors and earned cells are bright. A "Reference Library" section (already exists) hosts them.
- **Unlock moment:** on a match during characterize/tape-out, a toast — "You built a NAND. Reference unlocked."
  — and the bin entry lights up.
- **Per-placement choice:** an inspector toggle "use reference / use mine"; a global "simulate proven cells as
  models (fast)" switch (the auto-swap from §5, default on above the budget).

## 8. Phased build (each phase headless-testable, golden-safe, gated)

- **P1 — identity match (keystone).** `matchesReference(playerCell, referenceCell)` on characterized
  `word`+arity (combinational first). Pure function; vitest: hand-built NAND matches NAND ref, XOR does not.
  No UX, no persistence — just the oracle. *This is the first implementable slice.*
- **P2 — unlock state.** Persisted unlocked-tag set + seed set; characterize/tape-out hook runs P1 against
  locked refs and flips matches. Vitest on the state transitions.
- **P3 — auto behavioral swap.** Budget-driven auto-collapse of proven instances in `flattenUserIcs` (reuse
  the fidelity path); the "running N as models" readout. Headless: a big design of proven cells solves as LUTs.
- **P4 — bin UX.** Locked/dimmed entries, unlock toast, per-placement reference/mine toggle.
- **P5 — coverage.** Author/confirm a transistor reference for **every** row of `ic-reference-library.md`
  (gates done; op-amp/comparator/composites/storage to go), each with a characterized `behavior` so it can
  swap. Flip rows to `refined` as they land.

## 9. Open decisions (recommended defaults in **bold**)

- Identity = **functional (truth-table + arity)**, not structural sig. *(A differently-wired correct NAND
  should count.)*
- Auto-swap default = **on above the convergence budget, off below** *(small designs stay full-transistor for
  the lesson; only collapse when the solver would otherwise choke)*.
- Seed set (always unlocked) = **raw FETs + R + sources + GND + wire** *(the literal sand)*.
- Locked parts = **placeable-as-reference blocked until earned**, but always **viewable** (datasheet/glyph) so
  the player knows the goal.
- Sequential / self-dependent cells = **owner-tagged equivalence only** for now; auto-match is combinational +
  simple-sequential + storage in P1–P3.

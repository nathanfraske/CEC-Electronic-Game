<!-- SPDX-License-Identifier: Apache-2.0 -->

# Memory characterization: collapsing SRAM / DRAM bit cells into a behavioral array

**Thesis.** You do not simulate the array. You characterize **one** bit cell plus its
sense path **once** (an analog transient sweep, exactly like the existing gate-to-LUT
collapse), then bake the result into a deterministic behavioral element — working name
**`ELEM_MEMORY`** — whose **depth is just a parameter**. A 4 MB array stamps into the MNA
matrix identically to 16 bytes; per-tick cost is **O(accesses), not O(bits)**. The player
still hand-builds the address decoder, word-line drivers, precharge, sense amp, column mux
and (for DRAM) refresh controller out of real, full-fidelity logic — that is where the
learning lives — and zoom-to-open still reopens one genuine 6T / 1T1C cell. This document
is the build-against spec; it folds in the adversarial critique and **deliberately splits
the scope**: the cell-level teaching core (≤ 8 terminals, buildable today) ships first; the
word-level parallel bus-port and DRAM ship behind named, de-risked follow-up phases.

---

## 1. The core reframe

The simulator is a deterministic, fixed-step Newton solver over a netlist
(`crates/sim-core/src/lib.rs`). Every storage cell you place is a handful of MNA rows the
solver must converge **every tick**. Millions of cross-coupled cells is therefore doubly
impossible: you cannot hand-place them, and even if you could the per-tick solve would die.

The reframe — the same move the game already makes for combinational and sequential cells
in `web/src/lib/characterize.ts` — is to stop treating the array as a circuit:

- **Characterize one cell, plus the developed-bitline margin its sense amp must resolve.**
  Run a write / read / hold access protocol on a throwaway `Simulation` (the golden-untouched
  pattern at `characterize.ts:169` — `new Simulation(0)`, `sim.free()`), extract a small
  **quantized** access-parameter block, and bake it into the element.
- **Array size is a parameter.** `ELEM_MEMORY` carries `addrWidth` / `wordWidth`; the storage
  bytes live in the wasm heap (a ragged `Vec`), not in the MNA matrix. Depth changes the heap
  allocation at install time and **nothing** about the per-tick solve.
- **Cost is O(accesses), not O(bits).** A read is a constant Thévenin stamp (no Newton — the
  element is **not** added to `is_nonlinear`). A write is a one-tick-delayed commit-phase latch
  (the `commit_sequential_digital_state` discipline, `lib.rs:6553`). The contents must still
  **hash** (they are program state), but via an **incremental dirty digest** maintained O(1)
  per write — so `snapshot_hash()` stays cheap no matter how big the array is (§5).
- **The access path stays real.** Decoder, word-line drivers, precharge, sense amp
  (`ELEM_COMPARATOR`), column mux, write drivers / tri-state bus discipline, and the DRAM
  refresh controller are all hand-built from existing parts that already collapse cheaply
  through the shipped pipeline. **Only the physically-impossible storage grid collapses.**

The headline cost claim — *"a 4 MB and a 16-byte array stamp identically"* — is true **for the
storage core**. It is **not** a claim about the surrounding hand-built access logic, which is a
real O(gates) circuit (§7 bounds it). That asymmetry is the whole design: the irreducible-but-
impossible part collapses; the part worth learning stays.

---

## 2. What gets characterized

### 2.1 The honest framing of "the analog write trip point" (critique item — read first)

The pitch is *"faithful to how RAM actually works: write trip points, sense margins, DRAM
destructive read + leakage."* There is a real tension the critique surfaces, and this spec
resolves it explicitly rather than papering over it:

**`HANDOFFS.md` #215 records that the owner's 6T cell reads/writes correctly _only_ with its
inner inverters in fast-model (behavioral) mode; at raw-transistor level the engine returns an
inverted/wrong Q** (a known Newton-convergence limitation on the cross-coupled pair). So a
characterization sweep that runs the cell at raw-FET level produces garbage. But if the inner
inverters are **behavioral** during the sweep, then the "write trip point" is no longer the
real silicon contest between access-NMOS strength and keeper strength — it is the behavioral
inverter's **fixed digital threshold**, a constant. A behavioral inverter has no real
drive-fight and no real read-disturb mechanism, so a swept "write_trip" and "non-destructive
read confirmation" off a behavioral-inner cell are **partly artifacts of the abstraction
layer, not silicon.**

We do not get to claim both *"behavioral-inner is correct-by-necessity for v1"* **and** *"we
characterized the true analog write margin."* The committed position for **v1**:

> **v1 frames `write_trip` / `sense_margin` / `latency` as a _designer-chosen access-margin
> datasheet_, seeded from the (behavioral-inner) sweep as a sane default and then tunable by
> the player — not as a silicon-exact extraction.** The pedagogy that survives is real and
> valuable: a write only commits when the driven bitline differential clears `write_trip`
> (undersized write driver → deterministic write **FAIL**), and a read presents only the
> cell's small `sense_margin` so the player's **real** sense amp has something to resolve
> (under-designed sense amp → garbage reads). The _numbers_ are honest defaults, not a
> fabricated silicon spec.

The path to a genuinely silicon-derived `write_trip` is gated on fixing raw-FET cross-coupled
Newton convergence (backlog #88 Newton globalization is the lever). That is **out of scope for
v1** and called out in §10 and §11. When it lands, the same `characterizeMemoryCell` sweep can
run the cell at raw-FET level and the datasheet becomes silicon-true with **no data-model
change** — the params and their quantization grid are identical.

### 2.2 SRAM (RAM-mode, mode 1) — static retention

The 6T cell is two cross-coupled inverters plus two NMOS access transistors gated by the
word line (WL), with complementary bitlines BL / BLB. The owner's prefab is **5-pin**
`[WL, VCC, GND, BLB, BL]`, `pinRoles [in, vcc, gnd, inout, inout]`, and — critically —
**has no Q pin** (`HANDOFFS.md` #215: *"owner chose drop Q — force the lesson … the stored
bit is observed with MEASURE / symbol-state"*). The characterized block:

- **Write trip point** — the minimum `|V(BL) − V(BLB)|` differential that flips the pair.
  Observed **through the bitlines** (see §2.4): write a differential, release, read it back.
- **Read margin (`sense_margin`)** — the developed `|BL − BLB|` differential a read produces
  that the player's sense amp must resolve. Recorded so v1 can **present** it on read.
- **Non-destructive read** — confirmation that a read does not flip the stored state
  (bitline read-back after a read matches the read-back before it).
- **Access latency** — integer `DT`-step ticks from WL-high to a resolvable differential.
- **`retention_ticks = 0`** — the SRAM signature: never decays. (This is also the Ideal /
  default / golden value, §5.)

### 2.3 DRAM (mode 3) — the contrast knob where analog access genuinely matters

Author a **1T1C reference cell** prefab `__DIE_FF_DRAM` (one NMOS access FET gated by WL
between BL and a storage node SN, plus one cap `Cs` from SN to the plate/GND; **BL-only, no
BLB**), logged `needs-chip` in `docs/ic-reference-library.md` per the convention. Its
characterization **adds the two behaviors that make it DRAM**:

- **Destructive read + writeback.** A read drains the storage cap onto BL; the sense amp then
  restores it. Modeled as a deterministic, pure-integer **read → drive data-out → writeback
  the bit → restamp the row's refresh tick**, all in the commit phase, in a fixed order
  relative to the read drive (§5). A read **is** a write.
- **Charge leakage → retention.** `retention_ticks` is fit from a no-refresh decay run of the
  isolated cell's storage cap, game-scaled to `DT` (the diode-`TT` precedent in `CLAUDE.md`).
  Ordering teaches, not absolute nanoseconds: refresh interval ≪ retention.

DRAM rot is **O(rows), not O(bits)** — real DRAM refreshes a whole row at once, so we track
**one refresh epoch per row** (a 4 MB × 8 part is ~2048 rows). The determinism-correct
mechanics of that per-row state — eager, hashed, integer-pure — are in §5.4, which **commits to
a single scheme** (the critique correctly flagged the draft's two-escape-hatches hand-wave).

### 2.4 The Q-pin gap (critique item) — the sweep is bitline-observable

The draft's sweep repeatedly said *"read the internal node to confirm the latch."* **The owner
dropped Q.** There is no exposed storage node. The sweep is therefore re-specified as **fully
bitline-observable**:

- **Write confirm:** drive WL high, force a BL/BLB differential, settle, release; then
  **precharge + float the bitlines, raise WL, and read which way the differential develops** —
  that read-back is the flip check. Sweep the written differential to find the smallest one
  that survives the read-back round-trip = `write_trip`.
- **Non-destructive read (SRAM):** read-back, perform a read, read-back again; equality
  confirms non-destructiveness. No internal probe needed.
- **DRAM destruction / decay:** the 1T1C cell **has** a directly observable storage node SN
  (the cap node is not buried inside a cross-coupled FET pair the way a 6T's internal nodes
  are), so the decay fit reads SN voltage over a WL-low hold via `nodesOfComponent`. This is
  legitimate because SN is a single passive node, not a Newton-fragile cross-coupled node.

The sweep **builds its own netlist**, so it knows every inner node index and could in principle
reach into `node_v` for a 6T internal node — but it **must not** for the 6T, because those are
exactly the raw cross-coupled FET nodes the engine gets wrong (§2.1). Bitline-only observation
for SRAM is correct by necessity.

### 2.5 Classifying SRAM vs DRAM (structural, wasm-free)

`cellAnalysis.ts detectFeedbackLoop` (the gain-edge-on-a-cycle test) recognizes the **SRAM**
bistable loop. A **1T1C DRAM cell has no feedback loop** (a passive cap), so it needs a
**separate structural recognizer**: exactly one access FET gated by a WL-role/named pin between
a bitline-`inout` pin and a single high-impedance storage node carrying one cap to GND/plate,
**BL-only** (no second bitline). Classify conservatively; on ambiguity fall back to discrete
(the `characterizeCell` fail-safe ethos). A registered latch and an SRAM bit both have a
bistable loop — the discriminator that keeps a latch from being mis-read as memory is the
**inout bitline access with no clean OUT** vs a driven Q.

---

## 3. `ELEM_MEMORY` data model

`ELEM_MEMORY` is **id 26**, appended after `ELEM_BEHAVIORAL = 25` (`lib.rs:1016`) — append-only,
no existing id moves. It is a fourth `ELEM_BEHAVIORAL`-class device: wired into `is_digital`,
into `classify_nets` (mirror the behavioral signal-vs-supply arm), and into the
`set_netlist_pefgh` kind whitelist; **deliberately NOT added to `is_nonlinear`** so
memory-only circuits stay on the linear fast path.

### 3.1 Terminals (≤ 8 — the cell-level core fits today)

`Element` has exactly 8 terminals `a..h`. The behavioral arm already uses all 8
(a/b/c out, f/g/h in, d/e supply). The **two interfaces the design wants have different
widths**, and only one fits the 8-terminal model — this is a hard split, not a preference:

| Interface | Pins | Fits 8 terminals? | Phase |
| --- | --- | --- | --- |
| **Cell-level (teaching)** | WL, BL, BLB, VCC, GND (+ optional sense-out) | **Yes** | **P1 (ships first)** |
| **Word-level (system/CPU)** | e.g. 10-bit addr + 8-bit data + WE/OE/CLK = 20+ | **No** | **P3 (gated, §4)** |

The cell-level core is the near-term, buildable win and the pedagogy headline. The word-level
bus-port is **blocked on a sound contiguous-node design** (§4) — it is **not** merely
greenlight-gated. The roadmap (§8) is re-tiered accordingly; the draft's *"M0 is next, zero new
dynamics"* was false and is corrected.

### 3.2 Contents — `mem_data: Vec<Vec<u32>>`

A ragged store on `Sim`, beside `beh_state`, **sized at `install()` in lockstep with
`beh_state`** (the `vec![[0u32; BEH_STATE_WORDS]; elements.len()]` pattern). Discipline:
**every** element gets a slot; non-memory elements push an **empty** `Vec`; an `ELEM_MEMORY`
allocates `depth` words from its params (pack `ceil(wordWidth / 32)` u32s per word — one u32 per
word for `wordWidth ≤ 22`, which fits the 512×22 control store). `beh_state` (`[u32; 16]` =
512 bits) cannot hold even a 128-bit program — that is exactly why a new ragged store is
required, not a fixed array.

> **Desync hazard (critique).** A ragged `Vec<Vec<u32>>` whose length drifts from
> `elements.len()` breaks the hash fold's fixed element order (the historical `e`-array /
> `pushFGH` desync in `netlist.ts` is the cautionary precedent). Mitigation: size `mem_data`
> in the **same loop** as `beh_state` so they cannot disagree, and add a debug assertion
> `mem_data.len() == elements.len()` after install.

### 3.3 Incremental hash digest — `mem_digest: Vec<u64>`

One `u64` per element (0 for non-memory). This is the load-bearing performance idea. It is a
**pure function of current contents**, order-independent and self-inverting, maintained O(1)
per mutation:

```
cell_hash(k, w) = fnv1a( k.to_le_bytes() ++ w.to_le_bytes() )   // key by word index k
write_cell(i, k, v_new):                                         // THE single mutation site
    let v_old = mem_data[i][k];
    if v_old == v_new { return; }
    mem_data[i][k]   = v_new;
    mem_digest[i]   ^= cell_hash(k, v_old) ^ cell_hash(k, v_new);
```

`load_memory` recomputes the full digest once (O(bits), one-time, acceptable). The XOR-vs-Zobrist
question is **demoted**: XOR-keyed-by-index is fine for a non-security replay/grading digest
(swap is defeated by the index key; accidental whole-array cancellation is ~2⁻⁶⁴ per state-pair).
The **real** exposure the critique names is **mutation-site coverage** (§3.4), not hash strength.

### 3.4 The single mutation primitive (critique item — mandatory)

There are **four** sites that mutate `mem_data`: player write, DRAM refresh, DRAM
destructive-read writeback, and eager decay-induced bit flips (§5.4). If any one bypasses the
digest update, the digest silently drifts from contents and the hash is wrong **forever** with
no golden tripwire. **Rule: all four funnel through `write_cell(i, k, v)` above.** Nothing else
is permitted to assign into `mem_data`. Enforce with a CI guard:

```rust
#[cfg(test)]
fn assert_digest_consistent(&self) {
    for (i, e) in self.elements.iter().enumerate() {
        if e.kind == ELEM_MEMORY {
            let mut d = 0u64;
            for (k, w) in self.mem_data[i].iter().enumerate() { d ^= cell_hash(k, *w); }
            assert_eq!(d, self.mem_digest[i], "mem_digest drifted at element {i}");
        }
    }
}
```

Call it after a step in the memory tests so any future bypass is caught immediately.

### 3.5 Params — split block (critique item — `params[8]` was oversubscribed)

`PARAM_STRIDE = 8` and **slot 2 is `RATED_CURRENT_SLOT`** (`lib.rs:2452`, read for *every*
element in `flag_and_clamp_fails`). The draft listed **nine** fields into eight slots **and**
collided with slot 2 — arithmetically impossible. The fix splits the model:

**(a) Structural params (`params[8]`, NOT hashed, installed in BOTH fidelity modes — the
`diodeVariant` identity pattern):** only the few cheap fields that must always be present:

| Slot | Field | Notes |
| --- | --- | --- |
| 0 | `mode` | 0 ROM / 1 RAM (SRAM) / 2 EEPROM / 3 DRAM — **identity**, both modes |
| 1 | `addrWidth` | depth = `2^addrWidth` |
| 3 | `wordWidth` | skips slot 2 deliberately |

**Reclaim slot 2 by skipping `ELEM_MEMORY` in `flag_and_clamp_fails`** — a one-line kind guard.
Golden-safe because `failed_elements` is **not** in `snapshot_hash` (confirmed: the fold at
`lib.rs:7391-7430` never reads it). A memory element's output is a clean Thévenin and would not
trip the rated-current check anyway; skipping it makes slot 2 free **and** removes the need to
reason about its rating. (Endurance/wear still uses the FAIL mask via a separate hashed counter,
§3.7.)

**(b) The characterized analog block (separate side-channel, NOT hashed, Real-mode-only):** a
new `load_memory_params(elem_index, block)` side-call carrying `write_trip`, `sense_threshold`,
`sense_offset`, `access_latency_ticks`, `retention_ticks`, `destructive_read`. Issued
**alongside** `load_memory`, **only in Real mode** (in Ideal mode the call is simply skipped, so
every part is its nominal self and `retention_ticks = 0` → no decay). This is consistent with
the determinism contract: **analog params do not hash**, so tuning fidelity never perturbs
replay; it cleanly makes the whole block Real-mode-gated by construction; and it dodges the
8-slot ceiling entirely. The `param_or` default (`lib.rs`) makes any unset structural slot fall
back to the kind default → an Ideal install is golden-clean.

### 3.6 Modes & the contents image (web side)

- `Component.memImage?: number[]` on the placed part (`board.ts`, beside `Component.word`) —
  the saved contents. **For EEPROM/ROM this _is_ non-volatility**; RAM/DRAM omit it.
  `Component.word` (16-bit) is retired for memory.
- The image (and `mode` / `addrWidth` / `wordWidth`) must fold into `buildNetlist`'s `sig`
  (`netlist.ts:1786`, mirroring `auxSig` / `paramsSig`) so editing the program rebuilds and
  re-seeds. It contributes **nothing** to the sig when no memory part is placed.
- **Identity vs quality.** ROM/RAM/EEPROM/DRAM is **identity** (`mode` in structural params,
  both fidelity modes). **Quality** (EEPROM retention years / endurance cycles, SRAM/DRAM
  read/write margin) is a **tier** → add to `web/src/lib/tiers.ts` with mid-range == kind
  default, and add the kind to `TRANSIENT_TIER_KINDS` (`netlist.ts:562`) so non-idealities bite
  only in Real mode. Since the analog block already rides the Real-mode-only side-channel, the
  tier simply parameterizes that block.

### 3.7 Endurance/wear (critique item — the counter must be deterministic)

The FAIL **flag** is golden-safe (`failed_elements` unhashed). But the **counter** that drives
an EEPROM wear-out flag is mutated by program activity and decides a program-visible FAIL
transition — if it is not hashed, a replay wears out at a different point (non-reproducible
failure). **Decision: the wear counter is a hashed per-element `u32`** (`mem_wear: Vec<u32>`),
folded into the digest the same way contents are (or as one extra `u32` in the fold loop). It
increments through the same commit-phase discipline as writes. `retention_ticks`-style
game-scaling applies: the wear-out threshold is Real-mode-only; in Ideal it is unlimited and the
counter contributes a constant, golden-clean.

---

## 4. The bus-port contradiction (critique — gates the entire CPU/Doom path)

The draft repeatedly leaned on a compact `base + width` bus-port: *"buildNetlist numbers a
bus's bit-nets consecutively."* **This is false against the actual code and is a hard
contradiction, not an open question:**

- `netlist.ts` numbers nodes by walking **sorted components pin-by-pin**, assigning the next
  index to each new union-find root (`find` / `union`, the passes around `netlist.ts:948-1046`).
  A bus's bits live on **different pins of different components/junctions**, so their roots are
  visited **interleaved** with every other net on those components — **not** consecutive.
- A `Cable` stores **no connectivity of its own**; `BoardGraph.deriveCableLinks` lowers it to
  matched per-bit `NetLabel` pairs sharing an owner-namespaced name, which `buildNetlist`'s
  same-name union ties into **`width` INDEPENDENT nets** with **no index-adjacency guarantee**
  (`graph.ts:381-383`, verified). Identical to the player drawing `width` separate wires.

A `base + width` param is therefore **unsound** on today's numbering. Two clean fixes; **one
must land before any word-level memory ships**:

- **(A) Explicit per-bit node channel.** `ELEM_MEMORY` takes an explicit per-bit node list for
  addr and data via a **new install channel** (since 8 terminals cannot hold 20+ pins). Most
  honest; decouples from numbering entirely; but is real new JS↔wasm boundary plumbing that
  must stay coarse (one batched side-call, not per-bit).
- **(B) Deterministic contiguous re-pack pass.** After normal numbering, a `buildNetlist`
  post-pass re-packs each declared bus's bit-nets into a contiguous block and rewrites all
  references. High blast radius on the most determinism-sensitive web code. Requires: a
  read-back equivalence vitest (bus-port === N hand-wired bits, mirroring `cable.test.ts`)
  **and** a golden assertion that a **memory-free** circuit's numbering is **byte-identical**
  after the pass exists (ranges/params are unhashed, so a numbering bug would read garbage with
  **no golden tripwire** — this is the silent-failure trap).

**Until one of these lands and is proven, only the cell-level teaching core (≤ 8 pins) is
shippable.** The word-level parallel ROM/RAM that the CPU needs (program ROM, 512×22 control
store) is gated on this engine+netlist work, **not** on greenlight. Recommendation: prefer **(A)**
for the storage element (cleanest determinism story), and treat **(B)** as general bus infra that
the arriving cable/range-label work (#94) may justify independently.

> **UPDATE 2026-06-28 (221) — option (A) engine + boundary landed (P3a).** The explicit per-bit node
> channel is implemented in `sim-core` + the wasm boundary, golden-safe and proven:
> - **Fields** `mem_addr_nodes` / `mem_din_nodes` / `mem_dout_nodes: Vec<Vec<usize>>` (per element, empty for
>   cell-level / non-memory — can't ride the Copy `Element` struct, so they live beside `mem_data`).
> - **Coarse boundary side-call** `Simulation.set_memory_ports(elem, addr[], din[], dout[])` — called once
>   per wide memory AFTER `set_netlist*` (the indices reference the installed node space); it stores the
>   buses then re-runs net classification (`classify_nets` now digital-touches the bus nodes) + re-primes the
>   `t=0` operating point. One batched call carries the whole bus — never per-bit per-frame.
> - **Wide READ/WRITE** in `eval_digital` / the commit pass: gated on a non-empty data-out list. A wide read
>   decodes the address bus (`mem_wide_addr`, LSB-first) and digital-drives every data-out bit; a wide write,
>   while WE is high, assembles the word from the data-in bus and funnels through `write_cell` (digest stays
>   O(1)). Empty lists ⇒ the cell-level a/b/c/f/g/h path, **byte-identical** (golden-safe by construction —
>   the linear-RC golden never enters this code; `golden_snapshot_hash_is_stable` green).
> - **Tests** (`sim-core` 197): `wide_memory_writes_and_reads_through_bus_port` (4-word × 4-bit RAM round-trip
>   — write the assembled word at the bus address, read the same bits back on the data-out bus),
>   `wide_memory_reads_seeded_word_at_addressed_row` (multi-row address decode of a seeded ROM image),
>   `wide_memory_run_is_reproducible`.
>
> **Remaining = P3b (web emission only):** a placeable word-level ROM/RAM part whose `buildNetlist` emits one
> `ELEM_MEMORY` + issues `set_memory_ports` with the bus nodes, plus the §4(B) **read-back equivalence**
> vitest (bus-port === N hand-wired bits) as the no-golden-tripwire guard. The engine no longer blocks it.

---

## 5. Determinism & hashing — the sacred contract

Golden rule #1: any `sim-core` change keeps `cargo test -p sim-core` green, including
`run_is_reproducible`; reproducible values use **FNV-1a** (`fnv1a`), never the std hasher.

### 5.1 Golden-safety (proven 5× — DFF / sampler / comparator / behavioral)

`ELEM_MEMORY` id 26 appends with no existing id moving. The memory fold appends after the
`ELEM_BEHAVIORAL` `beh_state` loop (`lib.rs:7424-7430`) as the next fixed-order slot, folding
each element's **8-byte `mem_digest`** (plus the wear `u32`, §3.7) **only on a
`if e.kind == ELEM_MEMORY` arm**. A circuit with no memory element matches nothing on that arm
and folds **zero bytes** → `GOLDEN_HASH = 0xeaac_3764_99e4_fa24` (seed 42, 1000 steps,
`lib.rs:7594`) is byte-identical. `set_netlist*` is unchanged (the image rides the separate
`load_memory` side-call).

> **Precision (critique).** *"Folds zero bytes when no `ELEM_MEMORY` is present"* is **not** the
> same as *"folds zero when contents are zero."* An all-zeros RAM has a **nonzero** digest
> (`⊕ₖ cell_hash(k, 0) ≠ 0` in general) — that is fine, it is still deterministic. The golden
> test places no memory element, so it is genuinely untouched. The mandatory new test
> (§5.6) asserts `snapshot_hash() == GOLDEN_HASH` after the change — it is the **only** thing
> standing between this feature and a silent golden break.

### 5.2 What hashes, what does not

- **Hashes (program state):** `mem_data` contents (via `mem_digest`), the wear counter, the
  per-row DRAM refresh epoch (§5.4) — all as integer `u32`/`u64` through `fnv1a`, **only at
  mutation time**, never the std hasher. RAM/DRAM contents **are** program state and **must**
  reproduce.
- **Does not hash:** the characterized analog params (`write_trip` / `sense_*` / `latency` /
  `retention` / `mode` / `destructive_read`). Only `mem_data` + the hashed integer state above +
  `node_v` feed the hash, so tuning fidelity never perturbs replay. Immutable ROM/control-store
  contents are fixed like params and need not fold (but folding them is harmless and simpler;
  fold uniformly).

### 5.3 The fatal naive-fold correction (critique — confirmed against source)

`snapshot_hash()` rebuilds the **entire** byte stream **every call** (`lib.rs:7381`), and
`loop.ts` calls it **every step**, up to `MAX_STEPS_PER_FRAME = 10000`. Folding a 4 MB array
byte-by-byte is O(bits) × 10000/frame = a complete stall. **The incremental `mem_digest` is not
optional — it is the feature's viability.** We fold 8 bytes/element/frame (capacity-independent),
maintained O(1)/write. This is the difference between a real-computer-sized array and an
unusable one.

### 5.4 DRAM rot/refresh — eager, hashed, integer-pure (critique — two holes closed)

The draft left two determinism holes in DRAM and offered escape hatches without committing.
Both are now closed with a **single committed scheme**:

**Hole 1 — per-row refresh state was program-visible but unhashed.** `last_refreshed` feeds the
read result, so it **must** be in the hash. **Decision: store the per-row refresh epoch _inside
`mem_data`_** as reserved words at the top of each element's store (one `u32` per row), so it
**rides the existing digest fold automatically** through `write_cell` — no new unhashed array,
no separate fold, no way to forget it. (Equivalently a dedicated XOR-keyed per-row `u64` array
folded beside `mem_digest`; storing-in-`mem_data` is preferred because it reuses the single
mutation primitive and the single fold.)

**Hole 2 — lazy rot-on-read makes identical logical state hash differently by access history.**
If a row rots but is only mutated when next read, then `snapshot_hash()` at a tick *before* that
read sees stale (un-rotted) contents and *after* sees rotted contents — same logical state, two
hashes, replay broken. **Decision: decay is applied EAGERLY in the commit phase.** Each tick, in
fixed element order, any row whose `tick − last_refreshed[row] > retention_ticks` has its
stored-1 bits leaked toward 0 **immediately** (a deterministic per-bit rule), via `write_cell`.
This is O(rows)/tick **only when a row is actually stale** (rows ≪ bits — cheap), and guarantees
the hash always reflects decayed contents regardless of whether a read happened. `retention_ticks
= 0` (Ideal / default / golden) zeroes the whole decay path → bit-identical to a non-leaky store.

**Decay arithmetic is tick-pure:** integer `current_tick − last_refreshed[row]` vs
`retention_ticks`, using the **absolute `u64` tick** so it rewinds with the tick — never
wall-clock, never float-accumulated, never a float compare crossing the boundary. `retention_ticks`
is game-scaled to `DT` (the diode-`TT` precedent): ordering (refresh interval ≪ retention)
teaches, not absolute ns.

**Destructive-read writeback ordering.** A DRAM read does read → drive data-out → `write_cell`
the bit back → restamp `last_refreshed[row]`, **all in the commit phase, in a fixed order
relative to the read drive** (the single-mutation-site discipline at `lib.rs:6553`). One advance
per tick in fixed element order, so a read-modify-write in the same access window cannot
double-count, and a scrub onto a read edge replays bit-for-bit.

### 5.5 Characterization quantization grid (critique — was hand-waved)

The LUT collapse is robust because it quantizes to a **single bit** (`v >= SWEEP_VCC / 2`,
`characterize.ts:190`) — a wide margin immune to last-ULP float settling. The memory sweep
extracts **continuous** values (a `write_trip` voltage, a `sense_offset`, a `retention_ticks`
fit from a decay curve) on a float-iterative throwaway sim. Two toolchains differing in the last
ULP could bake `write_trip = 0.4999` vs `0.5001`; since these params are **baked into the saved
board** (`Component`) and **drive the gating compare** (a write commits iff differential >
`write_trip`), a saved board could write on one machine and fail-to-write on another — a desync
with **no golden tripwire** (params unhashed, golden has no memory). *"Deterministic the same way
as the LUT"* is unjustified without a grid, because the LUT's robustness comes from its 1-bit
margin, which continuous extraction lacks by construction.

**Decision — explicit quantization grid, snap before bake:**

| Param | Grid | Rationale |
| --- | --- | --- |
| `write_trip`, `sense_threshold`, `sense_offset` | snap to **10 mV** steps | well inside the float noise floor; coarse enough to be ULP-immune |
| `access_latency_ticks` | integer ticks | already discrete |
| `retention_ticks` | integer ticks | already discrete |
| `destructive_read` | bool | discrete |

The baked `MemBehavior` carries the **quantized** values. **Mandatory test:** characterize the
same prefab cell **twice** (fresh scratch sims) and assert the resulting `MemBehavior` params are
**byte-identical**. Without this, the bake is not reproducible.

### 5.6 Reset, solve, rewind

- **`reset()` is NOT mode-aware (critique — corrected).** `reset()` (`lib.rs:4026`)
  unconditionally zeros every state vector and **has no access to any saved image** (the image
  lives web-side in `Component.memImage`, re-applied only via `load_memory` on rebuild). A
  mode-conditional reset is therefore **impossible** as the draft wrote it, and would fork the
  zero-state golden path. **Decision:** `reset()` zeros **all** `mem_data` + `mem_digest` +
  `mem_wear` uniformly (one more loop beside the `beh_state` zero at `lib.rs:4053`) — golden-safe,
  the golden has no memory. **Volatility moves web-side:** after a reset *or* a rebuild, the web
  layer re-issues `load_memory` **only** for ROM/EEPROM (`Component.memImage` present) and
  **skips** it for RAM/DRAM (image omitted). The RAM-vs-EEPROM power-cycle lesson lives exactly
  where `memImage` already lives — web-side — and the engine reset stays trivial and golden-clean.
- **Solve untouched.** Reads are constant Thévenin stamps (no Newton; not in `is_nonlinear`).
  Writes/refresh/writeback/decay latch in `commit_sequential_digital_state` (`lib.rs:6553`) with
  one-tick delay — no new MNA rows, float-op order unchanged for every existing circuit.
- **Rewind caveat (document, not a regression).** The snapshot ring (`loop.ts`, up to ~100,000
  entries) retains hash + node_v + currents only — it does **not** copy `mem_data` (nor
  `beh_state` today), and **must not** (100k × 4 MB explodes). Scrub-back shows historical
  voltages but the live `Sim`'s RAM is **present** contents; resume-after-scrub uses present
  memory. True rewind-restore needs the keyframe + re-simulate model in `docs/determinism.md`
  (fully compatible with the incremental digest). **Flag this clearly in the UI for memory** —
  players will expect rewind to restore RAM, and v1 does not.

### 5.7 New tests required (gate the greenlight)

1. **No-memory golden unchanged** — assert `snapshot_hash() == GOLDEN_HASH` after the change
   (mandatory; the only guard against a silent golden break).
2. **Memory read-back determinism** — write a pattern, read it back, assert exact values and a
   stable `snapshot_hash` across two runs.
3. **Small-ROM-driving-a-fetch reproducibility** — a ROM feeding a tiny fetch loop hashes
   identically run-to-run.
4. **Digest-consistency** — call `assert_digest_consistent()` after a step in (2)/(3) to catch any
   mutation-site bypass.
5. **DRAM eager-rot rewind-replay** — write a row, run **past** retention **without** a read,
   `snapshot_hash`; rewind and replay; assert identical (catches the lazy-vs-eager and
   unhashed-tick bugs the draft would have shipped).
6. **Characterization determinism** — characterize the same prefab twice; assert byte-identical
   `MemBehavior` params (catches a missing quantization grid).

### 5.8 Greenlight gate

This **is** a `sim-core` change (id 26 + `mem_data` + `mem_digest` + `mem_wear` + hash fold +
`load_memory` + `load_memory_params` + the `flag_and_clamp_fails` skip). It is contract-zero-delta,
but per golden rule #1 / `TODOS.md` #47 it needs the owner's **explicit go** before touching
`crates/sim-core`. **Recommended scope to greenlight:** the cell-level teaching core + the data
layer + tests 1, 2, 3, 4, 6. **Defer behind named phases:** the word-level bus-port (§4) and DRAM
mode (§5.4) with test 5.

---

## 6. Array architecture — hand-built vs behavioral split

The collapse boundary sits at the physically-honest seam: the player hand-builds the entire
**access path** as real logic; only the **storage grid** collapses.

**Hand-built (real elements, full fidelity — where the learning lives):**

- Row/column **address decoder** (a wider `CEC_COMP.DMUX` of powered gates → collapses to
  combinational LUTs through the **shipped** `characterizeCell` path).
- **Word-line drivers**, **precharge** control.
- The **sense amplifier** — a real `ELEM_COMPARATOR` resolving the cell's small developed
  differential. The player must build a sense amp that beats the cell's actual `sense_margin`
  (which the element **presents** on read, §7), or reads return garbage. This is the lesson; do
  not hand back a clean full-swing level.
- **Column mux** (`CEC_COMP.MUX2` scaled), **write drivers / tri-state bus discipline** (`TRI`
  parts, the shared-bus rule: one net, many drivers, exactly one OE).
- For DRAM, the **refresh controller** — the existing prog-7 counter **is** a refresh-row counter
  (`lib.rs:1667`): a real built circuit walking rows.

None of this needs new engine code; it already collapses cheaply through the existing pipeline.

**Collapsed (the one irreducible piece):** the N × W grid of identical storage cells. The array
macro is a sealed subassembly wrapping **one** `ELEM_MEMORY` core + the player's access logic;
**size is a param on the core, not replicated geometry**.

**Interface fidelity (v1 decision).** v1 stores the bit **ideally** (a clean `u32` in
`mem_data`) and uses `write_trip` / `sense_threshold` / `latency` as **gating**: a write mutates
`mem_data[idx]` (via `write_cell`) only when the driven bitline differential clears `write_trip`;
a read drives the data pin from the stored bit against `sense_offset` **and presents the
characterized `sense_margin`** so the player's real sense amp has something to resolve; latency is
honest tick-delay. This is a deterministic integer/float-compare (the sampler-latch discipline,
`lib.rs:6586`), never a re-solve. **The fully-faithful developed-differential model** — where the
element emits a raw analog event the player's comparator resolves end-to-end — is **MORE faithful
but more MNA nodes and more cost; DEFERRED.** The sense-amp lesson stays alive in v1 because the
gating model still presents the small read margin (it is **not** decorative).

**Interface level is a per-mode choice:** expose at the **WL/BL cell-access level** for the
teaching SRAM/DRAM case (forces the player to build decode **and** sense — the pedagogy); expose
at a clean **addr/data bus** for the **system/CPU** case (parallel ROM/RAM/control-store) —
gated on §4.

**How tiling works.** A words × bits picker (one bit cell tiled in 2D — how real RAM is laid
out) writes `Component.memShape`. Size is **decoupled from footprint** (`userIcPartKind` packs the
pin ring from pin **count**), so 16 bytes and 4 MB are the **same chip art** — *"size is just a
parameter"* falls out of the existing model. A validation (like `floatingPowerPins`) warns if the
wired address-bus width ≠ `log2(words)`.

**Address setup vs write-enable (critique — fidelity + debuggability gap).** With a parallel
address bus the player hand-builds, address lines settle over several ticks (gate delays through
the decoder), so on the WE edge some address bits may be mid-transition. The behavioral latch
samples `node_v` at one instant; a half-settled address quantizes to the **wrong** `mem_data[idx]`
deterministically-but-wrongly, and the array is collapsed so the player has no scope into why.
`access_latency_ticks` models **read** latency but says nothing about **address setup relative to
WE**. **Decision:** the element FAIL-flags (the unhashed mask, golden-safe) if a quantized address
bit changed within a small `t_setup` window of a write edge — an explicit *address-stable-before-WE*
assertion that keeps the *"learning is in the access path"* claim honest by surfacing a mis-timed
decode instead of silently corrupting a cell.

**Zoom-to-open keeps it honest.** The running array is collapsed, but opening any addressed cell
reopens the genuine 6T cross-coupled pair / 1T1C transistor+cap, live from the snapshot (the
`userIcInternals` render path, `netlist.ts:1661+`, unaffected). DRAM zoom additionally shows the
storage cap's charge bleeding away between refreshes (magnitude on alpha/height per
`docs/ui/visual-language.md`), making leakage **visible**. The behavioral core **is** the
characterized cell, instantiated N times for free — a fidelity-preserving collapse, not a lie.

---

## 7. Cost bound for the hand-built access path (critique — the "free" claim is incomplete)

*"A 4 MB and a 16-byte array stamp identically"* is true **for the storage core**. But the
mandatory hand-built access path is a real circuit that scales with address width, and the draft
never bounded it. Concretely, a decoder for an `A`-bit address is O(2^A) gate outputs (word-line
selects); even collapsed to LUTs that is O(2^A) nodes in **both** the solve and the per-Snapshot
node array. For a teaching array (a few rows/columns, `A ≤ ~6`) this is trivial. For a
**word-level system array** the player builds a **flat** decoder (e.g. tree/hierarchical decode),
which is O(A·…) gates — manageable — but a naive full 1-of-2^A decoder at `A = 16` is **not**.
And the snapshot ring multiplies the per-tick node count by up to ~100,000 entries: a large
access-path circuit can OOM the **ring** regardless of `mem_data`.

**Decisions / guidance:**

- **The storage win is genuine and unconditional** — `mem_data` is heap, not MNA; the digest is
  8 bytes/element/frame.
- **Bound the access path in the curriculum:** teach hierarchical/tree decoders so gate count is
  O(A·width-ish), not O(2^A). The system/CPU array should target a **word-level bus-port** (§4)
  so the player is **not** forced to hand-wire a million word lines.
- **Quantify before M2:** for a realistic stored-program demo, count the access-path node total
  and confirm the snapshot ring survives (the ring is the binding constraint, not the solve).
  This is an explicit milestone gate in §8, not an assumption.

---

## 8. Build order (phased, data-layer-first, de-risked)

Each phase is independently shippable and golden-safe. Sequence strictly by **what the code
actually supports today**, per the Cable precedent (data layer + headless determinism tests
before any UI).

**P0 — Greenlight + the no-memory golden assertion.** Get explicit owner go for the `sim-core`
change. Land test 5.1 (`snapshot_hash() == GOLDEN_HASH`) as the tripwire **before** any other
engine change.

**P1 — Data layer (cell-level core, ≤ 8 pins) — the foundation, fits today.**
- `ELEM_MEMORY = 26`; wire into `is_digital` / `classify_nets` / `set_netlist_pefgh`; **not**
  `is_nonlinear`.
- `mem_data: Vec<Vec<u32>>`, `mem_digest: Vec<u64>`, `mem_wear: Vec<u32>`, sized in the
  `beh_state` loop at install.
- The single `write_cell` mutation primitive + `assert_digest_consistent`.
- Structural params (slots 0/1/3) + the `flag_and_clamp_fails` skip to reclaim slot 2.
- `load_memory` + `load_memory_params` side-calls; `reset()` uniform zero.
- Hash fold arm (digest + wear) appended after `beh_state`.
- Read = constant Thévenin; write = commit-phase latch through `write_cell`.
- Tests 1–4. **No UI yet.** This is the Cable-style headless determinism proof.

**P2 — Cell-level collapse + characterization (teaching SRAM, the pedagogy headline).**
- `classifyStorageCell` (wasm-free, `cellAnalysis.ts`) running **before** the `characterizeCell`
  inout refusal (which **stays** — it is the correct signal of a storage cell).
- `characterizeMemoryCell()` — a **sibling** of `characterizeCell`, genuinely new code: the
  precharge/WL-pulse/**bitline-observable** differential-sense protocol on a held-state scratch
  sim (not freed between phases), with the inner cell in **fast-model** (§2.1), the quantization
  grid (§5.5), and a `classifySramAccess` fail-safe that refuses (stays discrete) if the cell
  won't flip or the read is wrongly destructive.
- `MemBehavior` + `setUserIcMemBehavior` (sibling of `setUserIcBehavior`), `sig = cellBehaviorSig`
  so `resealUserIc` drops a stale characterization on a topology edit.
- `flattenUserIcs` branch: emit **one** `ELEM_MEMORY` sized by `memShape` instead of inlining
  FETs.
- The Behavior-panel **memory verdict card** ("Detected 6T SRAM bit cell … write trip ~Vdd/2,
  non-destructive read") with the characterized numbers as a tunable "memory datasheet" (framed
  per §2.1), action "Use as memory array"; the words × bits size picker.
- Test 6. **Ship: the cell-level teaching SRAM array.** This is the near-term win.

**P3 — Word-level bus-port (gated on §4 — real engine+netlist work, NOT just greenlight).**
- Land the sound contiguous-node design (prefer the explicit per-bit node channel, §4(A)).
- Read-back equivalence vitest (bus-port === N hand-wired bits) + the memory-free
  byte-identical-numbering golden assertion.
- The clean addr/data bus interface for ROM/RAM/control-store. **Unblocks M0/M1 (§9).**

**P4 — DRAM mode (gated on the eager-hashed-rot pattern, §5.4).**
- The `__DIE_FF_DRAM` 1T1C prefab (owner-authored per the convention, or a default agent prefab
  re-authored later) + its structural recognizer (§2.5).
- Per-row refresh epoch **inside `mem_data`**; eager commit-phase decay through `write_cell`;
  destructive-read writeback ordering.
- Test 5. DRAM zoom leakage visualization.

**P5 — Tiers, ratings, polish.** `tiers.ts` entries (read/write margin, EEPROM
retention/endurance) → `TRANSIENT_TIER_KINDS`; wear-out via the hashed counter + FAIL flag; the
address-stable-before-WE assertion; `ic-reference-library.md` rows flipped to `needs-chip`.

Strict rule: **ship P1→P2 (cell-level teaching SRAM on the deterministic store) before P3/P4.**
Do **not** bolt the emulated-MCU capstone (§9, M3) onto the memory work.

---

## 9. CPU & Doom — feasibility and roadmap

There are **TWO walls**, not one. State this bluntly so *"massive RAM for Doom"* is not misread
as *"Doom runs on the hand-built CPU."*

**W1 — the array-size wall: demolished by `ELEM_MEMORY`.** Storage cost is O(accesses), not
O(bits): a 4 MB array sims as cheap as 16 bytes (+8 bytes/element/frame, one XOR per write). This
unblocks the already-built-but-disconnected CPU stack (`web/src/lib/cpu/`: `isa.ts` `assemble()`
→ 16-word image, `microcode.ts` `buildControlStore()` → 512×22 control store, `cpu.test.ts`
green) by supplying program RAM, the microcode control store, and EEPROM in one part. **Caveat
(§4):** the CPU needs the **word-level** bus-port, which is P3 work, not available at P2.

**W2 — the instruction-throughput wall: untouched by faster memory.** A hand-built CPU advances
**one** micro-step per fixed `DT = 2 µs` tick; at `DT_SECONDS = 2e-6` and ~60 fps ⇒ ~8333 ticks/s,
~5 micro-steps/instruction ⇒ ~1.6k instructions/**second**. Doom needs ~10⁷ instructions/**frame**
— a **~10⁹** gap to real-time Doom on a wired core. Memory was never the throughput limiter. The
line where *building* becomes *emulating* is exactly W2: below it you wire registers and watch
micro-steps; above it (to run real software) you instantiate the cycle-accurate emulated core the
owner already greenlit (`ic-buildings-ideation.md` §3.11: a fast deterministic digital island,
~32 cycles of a 16 MHz core per 2 µs tick), stepped via `run_digital_subticks` (`lib.rs:6750`,
analog Δt frozen, sub-tick index never enters the hash → golden-safe by construction). Behavioral
memory is the RAM that emulated core maps as its address space — **the two features compose.**

**Milestone ladder — re-tiered by what is _actually_ unblocked (critique).** The draft's *"M0–M2
need zero new dynamics — only the memory element + web glue"* is **false**: M0 needs the P3
bus-port (new, currently-unsound numbering work) **and** a working hand-built datapath whose node
count the ring must survive (§7).

- **Mnear (genuinely near-term, P1+P2): cell-level teaching SRAM/DRAM array.** ≤ 8 pins, fits
  today, the real near-term win and the pedagogy headline. **This is what "next" actually means.**
- **M0 (gated on P3): first runnable program.** Word-level program-ROM part, load LDA/ADD/STA/HLT,
  single-step, watch A = 8 land in RAM. The "sand to CPU" payoff shot. Needs the bus-port + a
  Program panel — **not** zero new dynamics.
- **M1 (gated on P3 + datapath): SAP executing continuously.** Control-store ROM
  (`buildControlStore()`) + hand-built datapath (registers from FF+TRI, ALU as characterized
  LUTs) running a loop at watchable speed. **Gate:** quantify the access-path node count and
  confirm the snapshot ring survives (§7).
- **M2: a "4-bit real computer."** OUT register/MMIO + a JCC loop driving a 7-seg or framebuffer
  tile — a stored-program computer the player built.
- **M3 (stretch, NOT the hand-built core): Doom-class software via the emulated-MCU island**
  reading a multi-MB `ELEM_MEMORY`, sub-tick-budgeted. Realistic target: a tiny program /
  fixed-point demo / maybe a software-rendered frame at sub-real-time. **Doom is the north-star
  fantasy that justifies the architecture, not a literal deliverable on the wired core.**

The emulated-MCU capstone (M3) is a large separate subsystem; memory ships and unblocks
Mnear→M2 first. Keep Doom strictly as framing — do not mis-sell M0 as imminent.

---

## 10. Open questions

1. **Greenlight scope.** Confirm the recommended split: greenlight P1+P2 (cell-level core + data
   layer + the analog datasheet as a tunable-default), defer P3 (bus-port) and P4 (DRAM). Per
   golden rule #1 / #47 this needs explicit owner go before touching `crates/sim-core`.
2. **Silicon-true write_trip.** Is the v1 *"designer-chosen margin, seeded from a behavioral-inner
   sweep"* framing (§2.1) acceptable, or is fixing raw-FET cross-coupled Newton convergence
   (backlog #88) a prerequisite for shipping the analog datasheet at all? (Recommendation: ship
   the tunable-default framing; upgrade to silicon-true when #88 lands — no data-model change.)
3. **Bus-port mechanism (§4).** Explicit per-bit node channel **(A)** vs deterministic
   contiguous re-pack pass **(B)**? (Recommendation: **(A)** for the storage element; treat (B) as
   general bus infra justified by #94.) Either way, the read-back equivalence test + the
   memory-free byte-identical-numbering golden assertion are mandatory before any word-level
   memory ships.
4. **DRAM in v1 or as a follow-up?** Ship SRAM-faithful RAM/ROM/EEPROM first and add 1T1C DRAM
   (eager-hashed rot + writeback) once test 5 is proven, or include DRAM in the first cut? DRAM is
   the richer fidelity but the larger determinism surface. (Recommendation: follow-up phase P4.)
5. **Sense-path fidelity.** Confirm the developed-differential model (element emits a raw analog
   event the comparator resolves) is genuinely **deferred**, with v1's gating model presenting the
   small `sense_margin` so the sense-amp lesson is not decorative (§6).
6. **Rewind semantics.** Accept index-only scrub-back of voltages for v1 (live RAM = present
   contents, matching `beh_state` today), or implement the keyframe + re-simulate model so rewind
   **restores** RAM? Players will expect restore; this is a product decision. (Recommendation: v1
   index-only + a clear UI note; keyframe model later, fully compatible with the digest.)
7. **Width / depth ceilings.** Confirm max `addrWidth` (the Doom fantasy implies MB-scale;
   `mem_data` is O(bits) in heap at install even though O(accesses)/tick), whether `wordWidth ≤ 8`
   packs to `Vec<u8>` to quarter the heap, and whether very large arrays **lazily zero-fill**
   rather than allocate eagerly. The control store needs 512×22 (22 fits one `u32`).
8. **Digest scheme.** XOR-keyed-by-index only (recommended; documented as a replay/grading digest,
   not a MAC), or add a parallel additive Zobrist checksum for margin (O(1)/write, 16
   bytes/element/frame)? (Recommendation: XOR-only; the real exposure is mutation-site coverage,
   §3.4, not hash strength.)
9. **1T1C reference cell authorship.** Owner-authored per the convention (like the 6T, #97) or a
   default agent prefab re-authored later? Symmetry argues owner-authored; a default lands the
   curriculum sooner.
10. **Access-fidelity sequencing.** Is the trip/sense/retention layer wanted in P2, or is a clean
    deterministic digital read/write enough to ship the teaching array first? The CPU only needs a
    deterministic store; the SRAM/DRAM teaching value is the analog layer. (Recommendation: P2
    ships the analog datasheet for the teaching array; P3 word-level may start digital-only.)

---

## 11. Risks

- **`characterizeMemoryCell` is genuinely new code, not a `characterizeCell` extension.**
  `characterizeCell` explicitly refuses inout pins (`characterize.ts:93-97`) and the 6T cell is
  inout BL/BLB **by design** — that refusal is the **correct** signal of a storage cell and
  **must stay** (it legitimately refuses real latches/buses). Mis-scoping this as "reuse" blows
  the estimate; it is a separate entry point with a new sweep + fail-safe classifier.
- **The raw-FET dependency makes the "real analog write trip" claim partly theater for v1**
  (`HANDOFFS.md` #215). With behavioral-inner inverters the swept `write_trip` is the inverter's
  fixed threshold, not a silicon drive-fight. **Mitigated** by framing v1's datasheet as a
  tunable designer margin (§2.1), **not** by pretending the number is silicon-exact. The honest
  upgrade is gated on backlog #88.
- **The 6T prefab has no Q pin** — the sweep must be **bitline-observable** (write differential →
  release → read-back), not internal-node-probing (§2.4). Probing the raw cross-coupled nodes
  would read exactly the values the engine gets wrong.
- **The bus-port "contiguous node ranges" is unsound on today's numbering** (`netlist.ts`
  pin-walk; `graph.ts:381-383` independent same-name-union nets). This **gates the entire
  CPU/Doom path** — a base+width param reads garbage with **no golden tripwire** (ranges/params
  unhashed). Confine to P3; require the read-back equivalence test + the memory-free
  byte-identical-numbering assertion; the explicit per-bit channel **(A)** de-risks it most.
- **`params[8]` was oversubscribed and collided with slot 2** — resolved by the structural/analog
  split + the `flag_and_clamp_fails` skip (§3.5). Get this wrong and either the rating mis-fires
  or the analog block overruns the stride.
- **Naive full-array hashing is fatal** (O(bits) × 10000 steps/frame). The incremental digest is
  **not optional** (§5.3).
- **Mutation-site coverage is the real digest exposure** (§3.4): four sites mutate `mem_data`; any
  bypass of `write_cell` drifts the digest invisibly forever. The `assert_digest_consistent` CI
  guard is mandatory.
- **DRAM rot/refresh breaks replay two ways if naive** (unhashed per-row tick; lazy rot-on-read).
  Closed by storing the refresh epoch **inside `mem_data`** and applying decay **eagerly** in the
  commit phase (§5.4) — plus the dedicated rewind-replay test.
- **Characterization quantization** must snap to a coarse grid (§5.5) or a saved board writes on
  one machine and fails on another, with no golden tripwire. The twice-characterize-identical
  test is mandatory.
- **The bitline read sweep needs precharge-then-release Thévenin modeling**, not stiff DC
  `pinTests` (a stiff source fights the cell and masks the sense behavior). `sweepNetlist` has no
  precedent for this (only DC `pinTests` + a PULSE clock) — the subtle place silent-wrong results
  creep in. The `classifySramAccess` fail-safe refuses rather than baking a wrong model.
- **The hand-built access path is not free** (§7): O(gates) in both the solve and the ×100,000
  snapshot ring, scaling with address width. Teach hierarchical decoders; target the word-level
  bus-port for system arrays; quantify the node count before M1.
- **`reset()` cannot be mode-aware** — corrected to uniform zero + web-side `load_memory`
  re-issue for ROM/EEPROM (§5.6). A mode-conditional reset is impossible (no image) and would
  fork the zero-state golden.
- **EEPROM wear counter must be deterministic** — hashed per-element `u32` (§3.7), not just a
  FAIL flag; otherwise replays wear out at different points.
- **`mem_data` ragged-Vec length must equal `elements.len()`** (size it in the `beh_state` loop;
  push empty Vecs for non-memory) or the fixed-order fold breaks (the `pushFGH`/`e`-array desync
  precedent).
- **Classifier false-positives** — a registered latch and an SRAM bit both have a bistable loop;
  the discriminator is the **inout bitline access (no clean OUT)**. A 1T1C DRAM has **no** loop, so
  it needs a separate recognizer. Classify conservatively; fall back to discrete on ambiguity.
- **Expectation risk** — *"massive RAM for Doom"* reads as *"Doom runs on the hand-built CPU."* It
  cannot (W2 is ~10⁹ from real-time). Frame as two distinct wins; keep Doom as north-star (§9).
- **Scope/over-richness** — two reference cells + new sweep + new element + new drawer + curriculum
  + bus-port + assembly pipeline is large. Sequence strictly (data layer + headless determinism
  tests first, the Cable precedent); ship the cell-level teaching SRAM on the digital+gated store
  first; gate DRAM, the bus-port, and the emulated-MCU capstone behind later phases.
- **Convenience-primitive convention** — whatever ships as a default `ELEM_MEMORY` representation
  must add ROM/RAM/EEPROM/DRAM/control-store rows to `docs/ic-reference-library.md` marked
  `needs-chip` (flip to `refined` when the owner re-authors the chip art); never delete entries.

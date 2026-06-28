<!-- SPDX-License-Identifier: Apache-2.0 -->

# Flash / NAND mass storage: a persistent SSD that survives power-off without breaking deterministic replay

**Thesis.** Flash is the **mass-storage rung** of the "sand to CPU" ladder — the
non-volatile tier above volatile RAM. We add it as **`ELEM_MEMORY` mode 4 (NAND)**,
additive on the just-landed P1 data layer (`crates/sim-core/src/lib.rs`: `mem_data`
line 3541, `mem_digest` 3548, `mem_wear` 3553, the single `write_cell` mutation site
7524, the read drive 6038, the commit-phase write pass 6849-6870, `load_memory`/`mem_read`
7538/7552, the uniform-zero `reset()` 4140-4150, and the digest+wear fold arm 7630-7635).
No new element id, no new `Sim` field, no second mutation primitive, and **no new
hash-fold arm**. Flash differs from RAM in exactly two integer rules, both routed through
`write_cell` so the incremental FNV-1a digest and golden-safety stay automatic: **program
can only clear bits (monotone 1→0)**, and **erase resets a whole block to all-1s**.

The hard problem this doc exists to solve — **how a non-volatile SSD that keeps its data
across runs coexists with deterministic replay-from-t=0** — is solved, not dodged, by one
principle: **persisted flash is a CAPTURED INPUT pinned into the run, never a live mutable
global.** The reproducibility claim `snapshot_hash(T) = f(engineSeed, netlist sig, t=0
captured inputs, ticks 0..T)` gains a **third captured input**: the t=0 flash image. A
replay re-seeds the *same* captured t=0 image before its first step, so it reproduces the
same hash stream bit-for-bit; a *new* run starts from the *previous* run's committed image
as a *new* captured input. The two coexist because the persisted state is never read live
inside the solve — only through the frozen seed.

This doc folds in the full adversarial critique. **Five corrections from the critique are
load-bearing and are committed below, not hand-waved:**

1. **Reserved bookkeeping words do NOT go inside `mem_data`** — that would break the
   power-of-two `addr & (depth - 1)` mask at the read site (`lib.rs:6037`) and write site
   (`lib.rs:6867`). Per-block P-E counts, the bad-block bitmap, and read-disturb counters
   live in a **second ragged `Vec<Vec<u32>>` `mem_meta` with its own fold arm** (§5.2). The
   draft's "no new array, no new fold arm, reserved words inside `mem_data`, untouched mask"
   is four claims that cannot all hold; we drop two (new array + new fold arm) to keep the
   hot-path address decode bit-identical.
2. **The replay seed hooks the `loop.ts` `reset()` closure BEFORE its frame-0 push**
   (`loop.ts:358`), which covers *all three* t=0-defining paths — initial, **`resync()`**
   (the actual seam after a netlist change, `loop.ts:478`; the draft misread this as
   `restart`), and `restart()` (`loop.ts:481`) — plus a re-seed after the wasm install in
   `App.svelte`'s `rebuildNetlist` (line 2396). Seeding from `App.svelte` *after*
   `controls?.resync()` lands one call too late (§4).
3. **Factory bad blocks are seeded WEB-SIDE off the stable `flashVolId`, written into the
   captured image** — not "an engine `load_memory` function of a device id." `load_memory`
   (`lib.rs:7538`) takes only `(elem_index, words)`; it has no device id, and `elem_index`
   is netlist-position (it moves when an unrelated part is added), so seeding any *hashed*
   state off it is non-deterministic across edits (§7).
4. **The O(bits)-at-install heap is a P-flash-1 BLOCKING item, not an open question.** The
   install loop allocates `vec![0u32; 1usize << aw]` eagerly (`lib.rs:4066-4071`) with
   `addrWidth` clamped to 24 (`lib.rs:4070`) → up to 64 MB per device the instant it is
   placed. v1 ships an **honest capacity ceiling** and gates large SSDs behind lazy/chunked
   allocation (§3, §6).
5. **The v1 cell-level cut is scoped honestly: program / erase / wear on a TOY** (depth ≤ 8,
   1-bit words, 3 address bits — the shipped P1 interface). A buildable Flash Translation
   Layer / wear-leveler / bad-block table needs the **word-level bus-port** (the
   `memory-characterization-design.md` §4 contiguous-node work) and **multi-bit words**, both
   deferred behind named gates (§9). The rich controller lesson is a post-bus-port deliverable.

This is a `sim-core` change (the mode-4 arm + program rule + erase op + `mem_meta` + its
fold), so per golden rule #1 / `TODOS.md` #47 it needs **explicit owner greenlight** before
touching `crates/sim-core`. The deliverable of this panel is this doc (`HANDOFFS.md` #218
item 5); no engine code is written until greenlit.

---

## 1. Where flash sits, and why mode 4

The memory ladder, each rung a deterministic teachable failure:

| Rung | Cell | Volatile? | Signature failure | Phase |
| --- | --- | --- | --- | --- |
| **SRAM** | 6T | yes | undersized sense amp → garbage read | `memory-characterization-design.md` P2 |
| **DRAM** | 1T1C | yes | no refresh → bits rot | `memory-characterization-design.md` P4 |
| **NAND flash** | floating gate | **no** | can't overwrite (erase-before-write); **wears out** | **this doc** |

Mode lives in **param slot 0** (the documented `0 ROM / 1 RAM / 2 EEPROM / 3 DRAM` enum at
`lib.rs:1031-1037`); flash extends it to **`4 NAND`**. The read and write paths already
branch on `e.kind == ELEM_MEMORY` (not on mode — `lib.rs:6038`, `6851`), so they keep
working; flash adds a mode branch *inside* the existing commit-phase write pass.

**NAND-only for v1.** NOR is **not** a separate mode 5. The only engine-visible difference
between NOR and NAND is random-byte read — which the existing read path (`lib.rs:6038`)
already does — so a NOR "mode 5" would be a near-duplicate arm with zero new physics. NOR's
real distinctions (execute-in-place, byte-addressable program, slow whole-chip erase vs
NAND's fast block erase) are a **web-side access-protocol / datasheet** matter, not engine
math. The owner's ask is explicitly *fast arrays of NAND / flash storage* and *an SSD*,
which is NAND. NOR can land later as a trivial mode-5 alias or — better — a web-side
access-protocol skin over the same write rule, if a curriculum need appears (tracked, not
built).

---

## 2. Flash device model

The device model is the smallest set of deterministic integer rules that produce authentic
NAND behavior, all funnelled through `write_cell` (`lib.rs:7524`) so the incremental digest
and golden-safety are automatic.

### 2.1 Storage & addressing

Flash is word-addressable underneath — `mem_data[i]` is the existing flat `Vec<u32>` of
length `2^addrWidth` (sized at `lib.rs:4066-4071`) — but **accessed in pages** and **erased
in blocks**. Page/block geometry is pure integer-shift arithmetic over the flat depth:

```
page_base(p)     = p   << words_per_page_log2
block_first(blk) = blk << (pages_per_block_log2 + words_per_page_log2)
block_span(blk)  = [block_first(blk), block_first(blk) + (1 << (pages_per_block_log2 + words_per_page_log2)))
```

`words_per_page_log2` and `pages_per_block_log2` are **datasheet facts, not program state**:
they ride the **Real-mode-only, UNHASHED `load_memory_params` side-channel** (the
`memory-characterization-design.md` §3.5(b) analog-block pattern), so tuning geometry never
perturbs replay. Determinism story is identical to today's `addr & (depth - 1)` mask at
`lib.rs:6037`/`6867`. A 16-word toy flash and a 64 MB SSD are the **same element and same
chip-art** — size is a parameter.

### 2.2 Program (the entire device-physics core: a one-line change)

At the commit-phase write site (`lib.rs:6869`, currently `self.write_cell(i, addr, din)`),
branch on mode:

```rust
match mode {
    // RAM/SRAM/EEPROM-as-RAM (modes 1/2): direct latch, unchanged.
    _ if mode != NAND => self.write_cell(i, addr, din),
    // NAND (mode 4): program can only CLEAR bits (monotone 1→0). A 0→1 attempt is a
    // deterministic no-op (= real NAND erase-before-write). `write_cell`'s old==v early-out
    // (lib.rs:7526) makes an all-1s program a free no-op.
    NAND => self.write_cell(i, addr, old & program_word),
}
```

`old` is `self.mem_data[i][addr]`; `program_word` is the quantized `D_in` (today a single
bit, §8). Already-0 bits cannot be re-set; programming all-1s is a no-op.

**Program-fail FAIL is detected at the write site, NOT inside `write_cell`** (critique
correction). After `old & program_word` the masked value loses the information that a 0→1 was
attempted, and `write_cell`'s `old == v` early-out (`lib.rs:7526`) returns before any flag
logic. So the FAIL is computed at `lib.rs:6869` **before** the AND:

```rust
if real_mode && (program_word & !old) != 0 {
    self.failed_elements[i] = true;   // "you must erase first" — set OUTSIDE write_cell
}
```

`failed_elements` (`lib.rs:3495`, set in `flag_and_clamp_fails` at `6975`) is **not** read by
`snapshot_hash` (the fold at `lib.rs:7575-7637` never touches it — verified), so flagging is
golden-safe; it surfaces the lesson without altering the solve. `write_cell` remains purely
the digest-correct mutation.

### 2.3 Block erase (the only genuinely new op)

A bounded `write_cell` loop setting one block's words to **`wordWidth`-masked all-1s**, run
**eagerly in the commit phase in fixed element + word order** (the DRAM eager-decay discipline
from `memory-characterization-design.md` §5.4):

```rust
let all_ones = (1u32 << word_width) - 1;          // MASKED — see §5.5
for k in block_span(blk) {                          // O(block_words), not O(bits)
    self.write_cell(i, k, all_ones);
}
```

Erase is the mirror of program: program AND-clears chosen bits; erase sets a whole block to
1s. NAND's erased state is all-1s (a nonzero digest — fine and deterministic). `reset()`
leaves a flash element all-0 until the web layer re-seeds (§4), which is correct: a powered-off
SSD must be re-seeded from its persisted image anyway.

`ALL_ONES MUST be masked to wordWidth` — an unmasked `0xFFFF_FFFF` on a narrow word sets
phantom high bits, diverging the digest from a re-seeded image and from any board built with
the masked value (§5.5). For the v1 1-bit-word cut (§8) `word_width = 1` ⇒ `all_ones = 1`,
trivially correct.

The erase loop is compatible with the existing structure: the commit-phase write pass at
`lib.rs:6849` is *already* a separate index-loop precisely because `write_cell` needs
`&mut self` while the eval match loop holds an immutable borrow of `self.elements` (comment at
`lib.rs:6843-6848`). The erase loop lives in that same `&mut self` window.

### 2.4 Program-vs-erase precedence on one tick (critique determinism hole)

NAND hardware forbids a simultaneous program and erase. The sim must define a **deterministic
precedence** within one commit tick, or two boards that drive both `WE` and `ERASE` high on
the same tick would hash differently depending on loop order. **Committed rule: erase wins;
program is ignored on any tick an erase is requested for the same element.** The write pass
checks the erase command edge first; if erasing, it skips the program branch entirely for that
element this tick. This is fixed precedence *within* an element, on top of the fixed element +
word ordering *across* elements.

### 2.5 Read

Unchanged from P1 (`lib.rs:6038`): a read is a constant Thévenin stamp driving `D_out` from
the stored bit — **`is_nonlinear` is untouched**, so memory-only circuits stay on the linear
fast path. NAND adds nothing to the read math; its "random read is slow / page-register" flavor
is a web-side access-protocol matter (§9). Reads to a known-bad block are **refused** (driven Z
or a deterministic 0, web-controller's choice via the status region).

### 2.6 Erase command surface for v1

A **dedicated `ERASE` pin + block address** (the cell-level teaching cut, buildable on the ≤8-pin
interface today). The authentic muxed command/status-register protocol (CLE/ALE/RE#/WE# over a
shared 8-bit I/O bus, real ONFI-style NAND) is richer teaching but needs a command-latch FSM and
the **word-level bus-port** (`memory-characterization-design.md` §4, gated on the unsound
contiguous-node numbering at `graph.ts:381-383`) — **deferred to the same phase as the bus-port**
(§9).

### 2.7 What is hand-built vs modeled (the collapse boundary)

The engine stores raw bits and exposes **only** the physics — program (1→0), block erase (to
1s), readable per-block P-E / bad-block status, and the FAILs. **Wear leveling, the Flash
Translation Layer (LBA→PBA map), the bad-block table, ECC, and erase-before-write sequencing are
a CONTROLLER the player hand-builds** from existing parts (the prog-7 counter for block walks,
comparators, decoders). That is where the learning lives (`memory-characterization-design.md`
§6). The teachable failure is direct: a naive controller hammering one block wears it out and
that block FAILs, while a wear-leveling controller survives far longer on the same endurance
limit. **(Scope honesty, §9: this rich controller is only buildable once the word-level bus-port
and multi-bit words land; the cell-level v1 cut can demonstrate program/erase/wear on a toy
depth, not a real FTL.)**

---

## 3. Persistence across runs

Three layers, with a **hard wall between t=0 seeding and durable commit**.

**LAYER 1 — IN-RUN (engine).** Contents live only in the wasm-heap `mem_data` store
(`lib.rs:3541`), mutated solely through `write_cell`, **never persisted mid-run**. `reset()`
zeros uniformly (`lib.rs:4140-4150`); volatility is web-side.

**LAYER 2 — PER-CIRCUIT CAPTURED INPUT (the seed).** Each placed flash `Component` carries its
t=0 contents, split into two tiers by capacity (localStorage — the existing `cec.board.v1`
blob, `storage.ts:20`, quota-swallowed at `storage.ts:105`, ~10× JSON bloat — cannot hold a
multi-MB SSD):

- **Tier A (small non-volatile: program ROM, the 512×22 control store ≈ 1.4 KB, EEPROM, small
  flash; threshold e.g. `wordWidth * depth * 4 ≤ 16 KB`):** inline as
  `Component.memImage?: number[]` (the field `memory-characterization-design.md` §3.6 already
  reserves) in the board `GraphSnapshot` — it round-trips for **free** through `graph.ts`
  serialize/restore (the `...c` spread that already carries `word?` / `pinNames?` as optional
  fields) into `storage.ts`'s `BoardBlob` and the downloaded `SavedCircuit` envelope, with no
  schema bump for memory-free boards.
- **Tier B (MB-scale built SSD):** bytes go to **IndexedDB** (the only browser store sized for
  tens of MB; async; native `ArrayBuffer`/`Uint32Array` — no base64). A new
  `web/src/lib/flashStore.ts` (sibling to `userLibrary.ts`) with the same guarded-read /
  degrade-to-blank ethos but async + blob-capable, a total-bytes cap, a visible "flash full"
  warning, and LRU eviction of orphaned volumes.

**LAYER 3 — DURABLE CROSS-SESSION (the SSD survives power-off).** A versioned, keyed record.

- **Keying:** a **stable device id** minted onto the `Component` when the SSD is
  formatted/placed — a new `Component.flashVolId?: string` (uuid-like, modeled on
  `graph.ts`'s `NetLabel.ownerId` namespacing), **NOT** the volatile `Component.id` (which can
  collide across boards). The board save carries only `flashVolId` + a content digest + a schema
  version (~40 bytes), **never** the megabytes — so the localStorage board blob stays small and
  the SSD is a sibling store independent of `cec.board.v1` (the exact rationale `userLibrary.ts`
  gives for `cec.library.v1`).
- **Content addressing:** within IndexedDB the bytes are stored **content-addressed** by
  `imageId = fnv1a(mode, wordWidth, depth, contents, meta)` reusing the engine's own
  `fnv1a` so the id is deterministic and machine-stable. Images are **write-once/immutable**,
  which gives natural dedup (an unchanged SSD re-commits to the same id — a no-op) and natural
  versioning (the chain of ids *is* the history). `flashVolId` is the device pointer; `imageId`
  is what it currently points at.
- **The wear-survives coupling:** the per-block P-E counts + bad-block bitmap + read-disturb
  counters live in the element's `mem_meta` (§5.2) and are serialized **alongside** the data into
  the image (Tier A: a `Component.memMeta?: number[]` companion to `memImage`; Tier B: a second
  region of the IndexedDB blob). So persisting the image **automatically persists how worn it
  is** — a returning SSD remembers BOTH its data AND its remaining life. This is the
  lens-specific payoff: **endurance is only teachable if wear survives power-off.**

**Capacity (BLOCKING, not an open question — critique correction).** `addrWidth` clamps to 24
(`lib.rs:4070`) and the install loop allocates `vec![0u32; 1usize << aw]` **eagerly**
(`lib.rs:4066-4071`): up to `16M words × 4 bytes = 64 MB` in the wasm linear heap the instant the
part is placed, **before any data is written**, per device. This is the real ceiling — not
IndexedDB. A "multi-GB SSD" is **impossible** at the 24-bit clamp regardless of persistence
backend, and even a few 64 MB devices on one board will OOM a 32-bit wasm heap. **v1 commitment:**

- State an **honest v1 capacity ceiling**: a "teaching SSD" of `2^16–2^18` words (a few hundred
  KB to ~1 MB), bounded so the eager heap is safe with several devices on a board.
- **Lazy/chunked zero-fill of `mem_data`** (allocate pages on first touch, keeping the heap
  O(accesses) to match the O(accesses) compute claim) **and** `Vec<u8>` packing for
  `wordWidth ≤ 8` are **prerequisites** for advertising any large SSD — landed in a P-flash-1
  sub-task **before** the pedagogy promises a 64 MB array (§6). Until then the doc does not
  promise capacities the heap cannot hold.

**Volatility is web-side and per-mode:** re-seed via `load_memory` (and the meta companion) **only**
for non-volatile modes (NAND / EEPROM / ROM with a `memImage`/volume); RAM/DRAM omit the image and
come up zeroed via the engine's existing `reset()` (`lib.rs:4140`). The RAM-loses-data vs
flash-keeps-data lesson lives exactly where `memImage` lives.

**Wiring gap (must build — confirmed absent today).** `loadMemory` and a coarse
`dumpMemory`/`memImage` are **not** on the `SimHandle` in `loop.ts` (grep confirms: the only web
reference is a `// later phase` comment at `netlist.ts:1411`). sim-wasm exposes `load_memory`
(`crates/sim-wasm/src/lib.rs:192`) and per-word `mem_read` (`sim-wasm:199`) but **no bulk read-back**.
Add, mirroring `set_netlist`'s coarse-boundary discipline (one call, not per-word):

- `SimHandle.loadMemory(elem, words)` → `sim.load_memory` (exists in wasm).
- A new bulk `mem_image(elem) -> Uint32Array` in sim-wasm (sibling of per-word `mem_read`) +
  `SimHandle.dumpMemory(elem)`, required for power-down write-back. It **never mutates state**, so
  it cannot affect the hash.

---

## 4. Replay reconciliation (the core section)

**THE HARD PROBLEM, SOLVED NOT DODGED: persisted flash is a CAPTURED INPUT pinned into the run,
never a live mutable global.**

### 4.1 The invariant and the contract evolution

`snapshot_hash(T)` is a pure function of `(engineSeed, netlist sig, t=0 captured inputs
INCLUDING the flash image, ticks 0..T)`. The reproducibility claim — formerly `(seed, netlist)` —
**gains a third captured input**: the t=0 flash image (its data **and** its hashed wear/bad-block
state). This is a deliberate, reviewed evolution of the determinism contract and **must be
recorded in `docs/determinism.md`** as such (the same "regenerate the golden as a deliberate,
reviewed act" discipline at `docs/determinism.md:42`).

### 4.2 The naive trap, explicitly rejected

"Load last session's live SSD at t=0" makes the t=0 input depend on out-of-band session history,
so two replays of one action stream from t=0 see different initial contents and **diverge** — and
because the golden places no memory and params/images are unhashed, there is **NO golden
tripwire**; it breaks silently. The fix never lets the durable store be read live inside the
solve.

### 4.3 The committed scheme (four steps)

**(1) AT RUN START — freeze the t=0 image into the run's replay record.** Resolve the device's
t=0 image **once** and freeze it alongside the seed — the **flash seed**
`{ flashVolId, imageId, image-or-content-addressed-reference, digest }`.
- **Tier A:** the seed simply *is* `Component.memImage` (+ `memMeta`), already in the board save =
  already in the replay record.
- **Tier B:** the seed is the content-addressed `imageId` into the **immutable** IndexedDB blob
  table, so the exact t=0 bytes survive even after the live SSD is later overwritten.

The image+meta hash **also folds into `buildNetlist`'s sig** (`netlist.ts`, mirroring
`auxSig`/`paramsSig`), so editing flash contents OR pointing the part at a different volume
rebuilds + re-seeds, making two runs over different t=0 images correctly **distinct identities**.
It contributes **nothing** to the sig when no flash part is placed (golden untouched).

**(2) RE-SEED ON EVERY t=0 ENTRY — at the right site (critique correction).** The engine starts
from `reset()`'s zeroed store (`lib.rs:4140`); the web layer then calls `load_memory` (+ the meta
companion) with the captured t=0 image **before the first step**. There are **three** paths that
produce a t=0 ring frame, and **all three must re-seed first** (traced and confirmed against
source):

| Path | Source | What it does | Zeroes `mem_data`? |
| --- | --- | --- | --- |
| **`set_netlist`** | `App.svelte:2445`/`2464`, via `rebuildNetlist` 2396 | wasm install (`lib.rs:4066`) **freshly zeroes** the store | yes (install) |
| **`resync()`** | called after every `set_netlist` (`App.svelte:2460`/`2473`) → `loop.ts:478` | **ring-only rebuild**; does NOT call `sim.reset()`; pushes the **live** store as frame 0 | no (relies on install having zeroed) |
| **`restart()`** | `App.svelte:2530`/`3009` → `loop.ts:481` | `sim.reset()` (`lib.rs` reset, zeroes) **then** ring rebuild | yes (`sim.reset`) |

The dangerous one is **`resync()`** (the draft misread the netlist-change seam as `restart`). It
captures *whatever the store holds* as the new t=0 frame; today it is safe only because the wasm
install zeroes the store on every `set_netlist`. If seeding were wired only into `restart`, a
netlist rebuild (the common case — `rebuildNetlist` fires on value/topology change) would land a
**zeroed-memory t=0 frame** for a non-volatile part and diverge replay from the durable image
**with no golden tripwire**.

**The seed hook site is the `loop.ts` `reset()` closure (`loop.ts:354`), BEFORE its frame-0 push
at `loop.ts:358`** — one site covers `resync`, `restart`, **and** the initial `reset()` at
`loop.ts:360`:

```ts
const reset = (): void => {
  head = 0; count = 0; cursor = 0;
  seedMemory(sim, netlist, graph);   // <-- re-seed non-volatile flash/EEPROM/ROM HERE,
  push(sim.snapshot());              //     so frame 0 carries the seeded hash
};
```

Plus an explicit re-seed **after the wasm install** in `App.svelte`'s `rebuildNetlist`
(`App.svelte:2396`), because the install path zeroes the store and the subsequent `resync()` must
see it already seeded. **Seeding from `App.svelte` *after* `controls?.resync()` is too late** —
`resync` already pushed the (zeroed) frame 0 at `loop.ts:358`; that is the concrete
off-by-one-call replay bug the round-trip test (§5.7) must catch by exercising the **resync
(netlist-change) path specifically**, not only `restart`.

`seedMemory(sim, netlist, graph)` re-issues `load_memory` (+ the meta companion) for non-volatile
modes only and **skips RAM/DRAM** (image omitted). For Tier B it loads from the **pre-warmed
in-memory buffer** (§3, §Risks) — never an `await` inside the frame loop.

**(3) LIVE WRITES mutate ONLY the engine store** (hashing via `mem_digest`/`mem_meta`); they do
**not** touch the captured `imageId`.

**(4) WRITE-BACK is a STRICTLY SEPARATE end-of-run step.** On a deliberate **power-down / commit**
event it reads the live contents back via the new coarse `dumpMemory`/`mem_image` boundary call,
computes a **new** `imageId`, and stores it immutably — repointing `flashVolId`. It changes only
what the **next** run captures as its t=0 image; it **never edits any prior run's captured
`imageId`**, so a later session that programs different flash **cannot** retroactively alter an old
recording or the golden.

### 4.4 Commit-during-replay is forbidden — with a named enforcement mechanism (critique hole)

"Replay runs in a sandbox with write-back disabled" is a property of a sandbox that **does not
exist yet** (the ring rewind is index-only; there is no separate replay executor). So we name the
mechanism rather than promise a property:

> A `runMode: 'live' | 'replay' | 'grade'` flag is threaded to **the single write-back call site**
> (the power-down/commit verb). Write-back fires **only** when `runMode === 'live'`. The gate
> **defaults to write-back OFF** so the dangerous direction fails safe — a grading/replay harness
> built later **without reading this doc** still cannot clobber the player's live durable SSD.

A test (§5.7) asserts that a run in the default mode does **not** write back.

### 4.5 What the replay seed MUST carry (or replay diverges)

`engineSeed`; the netlist sig; and, for **each** non-volatile `ELEM_MEMORY`, its t=0 `imageId`
**including the HASHED state** — contents **and** per-block P-E counts **and** the bad-block map
**and** any read-disturb counters. Restoring contents but not wear would diverge a reloaded volume
from a continuous run (the `mem_meta` words fold into the hash, §5.2). Tier A carries data
(`memImage`) + meta (`memMeta`); Tier B's content-addressed image embeds both regions.

### 4.6 FAIL-freeze does not auto-commit (critique replay hole)

The loop **freezes the run** when the cursor frame is `failed` (`loop.ts` stops at the failed
frame). If a worn-out SSD FAILs mid-run, the **partially-written image is NOT auto-committed**.
Commit is **only** the explicit power-down verb. A half-written state *is* a legitimate captured
input and would replay fine if committed — but auto-committing on a freeze would silently advance
durable state and violate the "commit only on explicit power-down" invariant. So: a FAIL-freeze
leaves the durable SSD at its **last clean commit**; the player must explicitly power-down to
persist a post-FAIL state.

### 4.7 Rewind within a run

The snapshot ring (`loop.ts:342`, cap ~100,000) deliberately stores **hash + node_v + currents
only** and does **not** copy `mem_data`/`mem_meta` (100k × multi-MB explodes — the same reason it
omits `beh_state` today). So scrub-back shows **historical voltages** while live flash is
**present** contents — and flash mutations are **durable across scrub** (you cannot un-erase by
rewinding, which is **real hardware behavior**, and more pointed for flash than RAM because players
expect an SSD to "remember"). **v1 ships index-only scrub + a clear UI note on memory parts**
("rewind shows past voltages, not past stored bits").

**True rewind-restore** is the keyframe + re-simulate-forward model (`docs/determinism.md:33-35`),
fully compatible and **deferred**: a keyframe is a content-addressed image snapshot + tick, and
re-sim from it reconstructs the digest exactly — because a keyframe restore *is* a `load_memory`
call, which funnels through `write_cell` (`lib.rs:7545`) and rebuilds `mem_digest` correctly on
reseed. **Honest cost note (critique):** that restore is an **O(bits) one-time digest recompute**
(per the `load_memory` note at `memory-characterization-design.md:218`), so a keyframe restore of a
multi-MB SSD is not free; the "fully compatible" claim is about correctness, not cost.

### 4.8 Result

Replay-from-t=0 restores the identical t=0 image (data + wear + bad-block state) → identical
`mem_digest`/`mem_meta` fold → identical `snapshot_hash`, bit-for-bit, on any machine (WASM pins
floats, `docs/determinism.md:36-37`). Cross-run non-volatility (run A ends at image B; on
power-down B is committed; run B starts from B as a **new** captured t=0 input) coexists with
replay determinism **because persisted state is never a live global inside the solve.**

---

## 5. Determinism & hashing

Golden rule #1 holds **by construction**; the same five proofs that landed P1 carry over.

### 5.1 Single mutation site

Program (`old & program_word`), block erase (the `write_cell` loop to `wordWidth`-masked all-1s),
factory-bad seeding, the bad-block mark, and (later) read-disturb scrub **all funnel through
`write_cell`** (`lib.rs:7524`), so the incremental XOR digest (`lib.rs:7530` via `mem_cell_hash`,
`lib.rs:2749`) stays exact with **zero new hash code** for contents, and `assert_digest_consistent`
(`memory-characterization-design.md` §3.4) keeps holding. **Any assignment into `mem_data` outside
`write_cell` drifts the digest invisibly forever with no golden tripwire** (the golden has no
memory). **Erase is the highest-risk site** (it touches many words in a loop); the CI guard must
run after a flash erase in tests, and code review must forbid direct `mem_data[..]` assignment.

### 5.2 Bookkeeping state: a SECOND array with its OWN fold (critique-forced layout)

Per-block P-E counts, the bad-block bitmap, and read-disturb counters are **program-visible hashed
state** (they decide a reproducible FAIL transition and are read by the player's controller). They
**cannot** live as reserved words inside `mem_data` — that would make `depth = 2^aw + header_words`,
which is **not** a power of two, so the live `addr & (depth - 1)` mask at `lib.rs:6037`/`6867` would
become a garbage non-contiguous bitmask aliasing user addresses into bookkeeping words and vice
versa, **silently, with no golden tripwire**. (The `memory-characterization-design.md` §5.4 DRAM
precedent does **not** validate this: its epoch words are one-per-row of an already-shaped store and
say nothing about surviving the pow2 mask. A debug-assert `total == data + header` is necessary but
insufficient — an assert does not fix a wrong mask, and debug-asserts are off in release wasm.)

**Committed layout:** keep `mem_data` purely user data (pow2, the hot-path mask **bit-identical**),
and add a **second ragged `mem_meta: Vec<Vec<u32>>`** on `Sim` (sized in the same install loop as
`mem_data`/`mem_digest`/`mem_wear` at `lib.rs:4066-4078`; empty Vec for non-memory; debug-assert
`mem_meta.len() == elements.len()`), with:

- a **second mutation primitive `write_meta(i, k, v)`** maintaining a parallel incremental digest
  `mem_meta_digest: Vec<u64>` exactly like `write_cell`/`mem_digest`;
- **one new fold arm** appended after the existing `mem_digest`/`mem_wear` arm (`lib.rs:7630-7635`),
  folding 8 bytes of `mem_meta_digest[i]` per flash element.

This **knowingly breaks** the draft's flagship "no new array / no new fold arm" purity — that purity
is **not worth corrupting the address decode of every flash access.** It costs one ragged Vec, one
mutation primitive, and 8 more bytes/element/frame; it keeps the read/write hot path untouched and
the golden byte-identical (a memory-free circuit folds zero bytes on the new arm too). `mem_meta`
layout is **mode-branched** in the install loop (DRAM would size one `u32`/row; NAND sizes
bad-block-bitmap + per-block-P-E + per-block-disturb); `reset()`/`load_memory`/`load_meta` must
agree on the per-mode layout or a reseed writes into the wrong offsets (a risk, §Risks).

`mem_wear: Vec<u32>` (the existing per-element scalar, already folded at `lib.rs:7633`) stays as a
**coarse element-level rollup** (max or sum of per-block P-E) driving the single element-level FAIL
flag; fine-grained per-block state lives in `mem_meta`.

### 5.3 No std hasher; all-integer, tick-pure

Program is bitwise AND of `u32`; erase is a fill; wear is a `u32` compare vs a Real-mode threshold;
read-disturb is a `u32` increment — **no float compare crosses the boundary into the hash, no std
hasher (only `fnv1a`)**. The only time reference is the absolute `u64` `tick` (folded at
`lib.rs:7577`), so wear/erase/disturb **rewind with the tick**, never wall-clock, never
float-accumulated.

### 5.4 Eager, not lazy (the §5.4 lesson applied verbatim)

Block erase clears every block word **immediately** when the erase commits (not lazily on next
program); wear-out marks a block bad **eagerly** at the erase that crosses the threshold; read-disturb
perturbs **eagerly** at the disturbing read — all in the commit phase in fixed element order — or
identical logical state would hash differently by access history (a snapshot between an erase command
and the next program seeing un-erased vs erased contents = two hashes = broken replay). Erase is
O(block_words) **only on the tick it fires** (rare, like DRAM per-row decay being O(rows) only when
stale), so it is cheap.

**Read-disturb's phase reality (critique correction).** Reads happen in the **eval phase**
(`lib.rs:6038`), which holds the immutable `elements` borrow and **cannot** call `write_cell`/`write_meta`.
So a read-disturb counter increment cannot ride "the read." It must be a **separate commit-phase pass**
that re-derives which address was read this tick (re-quantizing the same committed voltages the eval read
used) and then `write_meta`s the increment — the identical eval-vs-commit split that forced the existing
write pass to be a second loop (`lib.rs:6843-6848`). Read-disturb is **deferred** (§9), so this is low
urgency, but the "increments on read" framing is structurally wrong and is corrected here.

### 5.5 All-ones masked to wordWidth

Erase fills with `(1u32 << word_width) - 1`. An unmasked `0xFFFF_FFFF` on a narrow word sets phantom
high bits, diverging the digest from a re-seeded image and from any board built with the masked value.
(`mem_cell_hash` zero-skips, `lib.rs:2750`, so unused high bits **must** stay 0 for the digest to be
well-defined.) For the v1 1-bit cut, `all_ones = 1`.

### 5.6 Real-mode gate

Endurance threshold, read-disturb threshold, page/block geometry, and program/erase latency ride the
**UNHASHED `load_memory_params` side-channel** (`memory-characterization-design.md` §3.5(b)), installed
only in Real mode. In **Ideal** mode flash is infinite-life, zero disturb, and the wear counter
contributes a constant → **bit-identical, golden-clean**. Wear **thresholds** are unhashed (tuning never
perturbs replay); wear **counts** and the retire/bad **decisions** are hashed (they are
`mem_data`/`mem_meta`/`mem_wear` writes). The FAIL itself uses the `failed_elements` mask
(`lib.rs:6975`), which is **not** in `snapshot_hash` (the fold at `lib.rs:7575-7637` never reads it —
verified) — it flags but never alters the solve.

### 5.7 Golden-safe by structure, and the mandatory tests

A circuit with no `ELEM_MEMORY` matches nothing on the `if e.kind == ELEM_MEMORY` arms (`lib.rs:7631`
and the new `mem_meta` arm) and folds **zero bytes** → `GOLDEN_HASH` (`lib.rs`, seed 42, 1000 steps)
and `run_is_reproducible` stay **byte-identical**; both existing fixtures place no memory.

> **Correction to the draft (verified against source):** `mem_cell_hash` returns **0 for a zero word**
> (`lib.rs:2749-2757`), so an **all-zeros store has digest 0**, not a nonzero digest. The test
> `assert_eq!(zero.mem_digest[2], 0, ...)` already encodes this (`lib.rs:12509`). The draft's repeated
> "an all-zeros RAM has a nonzero digest" is wrong; the correct statement is "zero contents → digest 0,
> which keeps `reset()` digest-consistent for free." This does not change any conclusion (the golden is
> still untouched because it places no memory element), but the doc must state the true behavior.

Mandatory new tests (mirroring `memory-characterization-design.md` §5.7; gate the greenlight):

- **(a) program-can-only-clear** — program `0xF0F0` then `0x0F0F` into an erased word yields `0x0000`
  not `0xFFFF`, with a consistent digest. *(For the 1-bit v1 cut, degenerates to: program 1→0 sticks,
  0→1 is a no-op.)*
- **(b) erase-resets-block** — fill a block, erase it, every word reads `wordWidth`-all-1s and
  `snapshot_hash` is stable across two runs.
- **(c) persistence-replay** — capture t=0 image+meta, run a program/erase/wear sequence N steps, reset
  + re-seed the **same** t=0 image+meta, replay, assert identical hash stream (proves captured-input
  soundness; the analog of the DRAM eager-rot rewind-replay test).
- **(d) wear-determinism** — erase a block N times across two runs, assert identical `mem_wear` and
  identical per-block counts in the hash.
- **(e) erase-before-write rewind-replay** — program-then-erase past a wear edge, rewind, replay, assert
  identical (catches any non-tick-pure wear/bad-block bug).
- **(f) digest-consistency** — `assert_digest_consistent` (extended to `mem_meta`) after a flash erase
  step (catches any `write_cell`/`write_meta` bypass).
- **(g) no-memory golden unchanged** — the only guard against a silent golden break.
- **(h) twice-load same image → identical digest** (capture reproducibility).
- **(i) save→reload→replay round-trip** through the **`resync` (netlist-change) path specifically**
  (not only `restart`), asserting identical `snapshot_hash` at matched ticks (catches a seed applied at
  only one t=0 entry, or after the frame-0 push).
- **(j) commit-during-replay guard** — a run in the **default** `runMode` does **not** write back to
  durable storage (proves the fail-safe default of §4.4).

---

## 6. Wear / endurance / bad blocks

- **P-E cycles.** Increment a block's P-E count on each **block erase** (the real wear event), via
  `write_meta`, Real-mode-gated. `mem_wear` is the coarse element rollup driving the element-level FAIL.
- **Bad blocks.** A block whose P-E count crosses the **Real-mode, game-scaled** endurance threshold
  (like diode `TT` / DRAM `retention_ticks`) is marked bad via `write_meta` into the reserved bitmap
  (deterministic, hashed) **and** raises the unhashed FAIL flag (renderer boxes it). Reads/programs/erases
  to a bad block are refused.
- **Factory bad blocks (critique correction — web-side, off `flashVolId`).** Real NAND ships with some
  bad blocks. They are **NOT engine-seeded** (`load_memory` has no device id, and `elem_index` is
  netlist-position — seeding hashed state off it would move the bad-block map when an unrelated part is
  added, a determinism + UX hole). Instead they are computed **web-side** as
  `fnv1a(flashVolId, capacity, schemaVersion)` at format/placement time, written into the reserved
  bad-block words of the `memMeta`, and thus become part of the **captured t=0 image** that `load_meta`
  installs — identical determinism story to the data, the engine stays oblivious, and factory bad blocks
  **survive persistence for free** (they are in the image) keyed off the **stable** `flashVolId`.
- **Game-scaled endurance.** A literal NAND P-E spec (10³–10⁵) is unreachable in a session; scale the
  threshold (e.g. ~100 erases) so wear-out is **reachable but not instant**, framed as a scaled teaching
  value (like diode `TT`), not a datasheet number.
- **Read disturb (deferred, §9).** A hashed per-block read-disturb counter (in `mem_meta`) increments on
  read **in a commit-phase pass** (§5.4) and, crossing a threshold, eagerly perturbs that block's data via
  `write_cell` (so it hashes), resetting on the next erase — the same eager-not-lazy discipline as decay.
  Same pattern as DRAM rot; **not the first cut.**
- **Status visibility.** The per-block P-E count + bad-block status is a **player-readable status region**
  (so a real bad-block-table / FTL is genuine work) — **but only once the word-level bus-port and
  multi-bit words land** (§9). On the cell-level v1 cut, the player sees the FAIL box and a toy depth, not
  a readable per-block table.

---

## 7. Build order (phased, data-first)

Each phase is golden-safe; sequence strictly by **what the code supports today**, per the Cable
precedent (data layer + headless determinism tests before any UI). This is a **P4-class phase on the
landed store, sequenced AFTER `memory-characterization-design.md` P2 cell-level SRAM lands.**

**P-flash 0 — Greenlight + tripwire.** Get explicit owner go for the `sim-core` change (golden rule #1
/ `TODOS.md` #47). Write this doc (`HANDOFFS.md` #218 item 5); commit no engine code until greenlit.
Confirm the no-memory `GOLDEN_HASH` assertion is the standing tripwire before any further engine change.
Add **NAND-flash + SSD** rows to `docs/ic-reference-library.md` §5 marked `needs-chip` (convenience-primitive
convention; the owner re-authors the default auto-package/glyph — a floating-gate reference chip — later).
Recommended scope to greenlight: **NAND mode 4** (program-AND-clear + bounded eager erase loop +
`mem_meta` per-block P-E/bad-block map + web-side factory bad blocks), the **cell-level ≤8-pin
interface**, the **captured-input persistence model**, **lazy/chunked + `Vec<u8>` allocation as a P1
sub-task**, and tests a/b/c/d/f/g/h/i/j. **Defer behind named gates:** the muxed/word-level command
interface (on the §4 bus-port), multi-bit words, read-disturb, the readable per-block status region, and
keyframe rewind-restore.

**P-flash 1 — Engine data layer (headless, determinism-first).**
- Append mode 4 to the slot-0 enum doc (`lib.rs:1037`).
- At the commit-phase write site (`lib.rs:6869`) branch on mode: RAM-direct (`din`) vs NAND AND-clear
  (`old & program_word`); detect the 0→1 program-fail FAIL at the write site (§2.2).
- Add the **erase-wins** precedence (§2.4) and the bounded block-erase loop (eager, fixed order,
  `wordWidth`-masked all-1s, through `write_cell`) gated on an erase command edge.
- Add `mem_meta: Vec<Vec<u32>>` + `mem_meta_digest: Vec<u64>` + `write_meta` + the new fold arm (§5.2);
  size `mem_meta` in the **same install loop** as `mem_data` (`lib.rs:4066-4078`), **mode-branched**;
  debug-assert `mem_meta.len() == elements.len()`.
- Activate `mem_wear` as the coarse element rollup (§5.2, §6).
- Add the Real-mode-only `load_memory_params` side-channel fields (endurance/disturb thresholds,
  page/block geometry, latency) — **unhashed**.
- **Land lazy/chunked zero-fill of `mem_data` + `Vec<u8>` packing for `wordWidth ≤ 8`** (the heap
  prerequisite, §3) — this is **part of P1**, not deferred, because the capacity story depends on it.
- Extend the `mem_rig`/`mem_rw_rig` test harnesses (`lib.rs:12463`/`12539`) for tests a/b/c/d/f/g/h.
- **No UI.** Gate: `cargo test -p sim-core` green incl. golden + `run_is_reproducible` + new flash tests.

**P-flash 2 — Web glue: captured-input seeding + the t=0 entry points.**
- Add `SimHandle.loadMemory` + a coarse `dumpMemory`/`mem_image` (the confirmed gap), and the bulk
  `mem_image(elem) -> Uint32Array` read-back in sim-wasm (sibling of `mem_read` at `sim-wasm:199`).
- Add `Component.memImage?: number[]`, `Component.memMeta?: number[]`, `Component.flashVolId?: string` as
  optional fields in `graph.ts`/`board.ts` (round-trip free via the `...c` spread).
- Fold the t=0 image+meta hash + `flashVolId` into `buildNetlist`'s sig (`netlist.ts`, mirror
  `auxSig`/`paramsSig`).
- Add `seedMemory(sim, netlist, graph)` re-issuing `load_memory` (+ meta) for non-volatile modes; invoke
  it **inside the `loop.ts` `reset()` closure before line 358** (covers `resync`+`restart`+initial) **and**
  after the wasm install in `App.svelte`'s `rebuildNetlist` (`App.svelte:2396`); **skip** RAM/DRAM (§4.3).
- Tier-A small images inline in the board save (`storage.ts` `BoardBlob`).
- Gate: `pnpm -C web test` incl. the **save→reload→replay round-trip through the `resync` path** (test i)
  and the **commit-during-replay guard** (test j); web check/lint/build green.
- Ship: Tier-A non-volatile flash/EEPROM/ROM that survives a refresh via the board save and replays
  deterministically.

**P-flash 3 — Durable cross-session SSD (IndexedDB) + commit-back.**
- Add `web/src/lib/flashStore.ts` (IndexedDB, async, blob-capable, sibling to `userLibrary.ts`) for
  Tier-B images, content-addressed by `imageId = fnv1a(mode, wordWidth, depth, contents, meta)`,
  immutable/write-once, with a total-bytes cap, "flash full" warning, and orphan LRU eviction.
- The board save carries only `flashVolId` + content digest + schema version.
- **Pre-warm** the volume blob into an in-memory buffer at board-load/format time so the t=0
  `load_memory` re-seed is **synchronous** against the buffer (never `await` inside the frame loop).
- Implement **write-back on an explicit power-down/eject/commit action only** (NOT on the
  `controls.restart()` that fires on every edit — that would thrash + explode `imageId`s), gated by
  `runMode === 'live'` (§4.4): read live contents via `mem_image`, compute a new `imageId`, store
  immutably, repoint `flashVolId`. Replay/grade default to write-back OFF.
- Degrade to **blank SSD** on missing/blocked/stale-schema IndexedDB (the `storage.ts` guarded-read
  ethos; a schema bump degrades to blank, never mis-parses).
- Gate: a programmed SSD survives a refresh; an old recording replays bit-for-bit after a later session
  writes different flash.

**P-flash 4 — Wear/endurance/bad-block teaching + UI verbs + FAIL surface.**
- Wire the wear-out / bad-block / program-fail FAIL flags to the renderer box (unhashed mask).
- Add the three player-facing verbs that keep persistence-vs-replay legible:
  **RESET** (zero engine + re-seed t=0 image = reformat-to-last-saved), **POWER-CYCLE** (RAM lost,
  flash/EEPROM survive via `memImage`), **COMMIT/POWER-DOWN** (write live contents to durable store = the
  only thing that changes what next session starts from).
- Add the index-only-rewind UI note on memory parts ("rewind shows past voltages, not past stored bits").
- Game-scale the endurance threshold (§6).
- Gate: tests d/e green; a naive single-block controller wears out and FAILs while a wear-leveling
  controller survives — **note (§9): the buildable wear-leveling controller is gated on P-flash 5's
  bus-port + multi-bit words; on the cell-level cut this is demonstrated on a toy.**

**P-flash 5 (gated, follow-up) — Authentic NAND interface + multi-bit words + read-disturb + keyframe
rewind.** Behind the `memory-characterization-design.md` §4 word-level bus-port (the explicit per-bit
node channel §4(A) preferred — the contiguous-node numbering is unsound today, `graph.ts:381-383`):
- **Multi-bit words** (the read at `lib.rs:6038` drives bit 0 only; the write at `lib.rs:6868` latches one
  bit — flash's `old & program_word` and erase-to-`wordWidth`-all-1s are inherently multi-bit, §8).
- The muxed command/status-register protocol (CLE/ALE/RE#/WE#) with a behavioral command-latch FSM — the
  authentic ONFI-style NAND lesson and the realistic SSD interface a CPU addresses.
- The **player-readable per-block P-E / bad-block status region** (needs the address width to reach it).
- Read-disturb (eager hashed `mem_meta` counter + scrub, via the separate commit-phase pass of §5.4).
- Keyframe + re-simulate rewind-restore for flash (content-addressed image keyframe + tick; digest-compatible,
  O(bits) one-time recompute, §4.7).
- This is where **"boot/load a program (or a DOOM WAD region) from the flash SSD into RAM"** composes —
  framed honestly (storage win, not throughput; §8). Tiers/ratings polish (SLC/MLC endurance via
  `tiers.ts` + `TRANSIENT_TIER_KINDS`); flip `ic-reference-library` rows toward `refined` as the owner
  hand-authors the chip art.

---

## 8. Pedagogy & the CPU / DOOM arc

Flash is the **mass-storage rung** of "sand to CPU": SRAM (fast, volatile, the 6T cell) → DRAM (denser,
rots without refresh, the 1T1C cell) → **NAND flash** (non-volatile, erase-before-write, wears out — the
SSD). The uniquely-flash lessons, each a deterministic teachable failure:

1. **"You can't just overwrite — program only clears bits (1→0), so you must ERASE THE WHOLE BLOCK
   first"** (the erase-before-write rule, surfaced as a FAIL when a 0→1 program is attempted, §2.2).
2. **"Erase is coarse and slow — block-granular, not byte-granular."**
3. **"Flash WEARS OUT — P-E cycles accumulate and blocks go bad"** (a naive controller that hammers one
   block kills it; a wear-leveling controller survives the same endurance limit, §6).

The zoom-to-open leaf is a **floating-gate cell** — charge trapped on an isolated gate is a bit that
survives power-off, the physical "why" of non-volatility — the natural sibling to the 6T / 1T1C leaves the
`userIcInternals` render path already supports.

**The collapse boundary** is the physically-honest seam (`memory-characterization-design.md` §6): only the
impossible N×W storage grid collapses to the behavioral `ELEM_MEMORY` (O(accesses), now **16
bytes/element/frame** in the hash — 8 for `mem_digest` + 8 for `mem_meta_digest`); the player **hand-builds
the access path AND the flash controller** (FTL/LBA→PBA map, wear leveling, bad-block table, ECC,
erase-before-write sequencing) from real logic — that is where the learning lives.

**Persistence teaches three distinct verbs** players will conflate, and making them distinct is itself
pedagogy: **RESET** (reformat to last-saved t=0 image), **POWER-CYCLE** (RAM lost, flash/EEPROM remember —
the volatility lesson, living exactly where `memImage` lives), and **COMMIT/POWER-DOWN** (the "flush before
you unplug" lesson — the only act that changes what next session starts from).

**Honest scope of the v1 cut (critique correction).** The cell-level v1 interface is the shipped P1 map:
**depth ≤ 8, 1-bit words, 3 address bits** (`lib.rs:6037`/`6867` use exactly `a0|a1<<1|a2<<2`). On that toy
you can demonstrate **program (1→0), block erase (to 1s), and wear-out on a small block** — the three
flash *physics* lessons. You **cannot** build a meaningful FTL/wear-leveler/bad-block-table over an 8-word
device, nor read a per-block status region through a 3-bit bus. **The rich controller lesson is a
post-bus-port deliverable** (P-flash 5): it needs the word-level bus-port (`memory-characterization-design.md`
§4) and multi-bit words. The doc says this plainly rather than implying the full lesson lands in v1.

**Frame DOOM honestly (two walls, `memory-characterization-design.md` §9).** Flash demolishes the
**storage wall** (a teaching SSD sims as cheap as a few bytes) but **not** the **throughput wall** (the
hand-built core advances one micro-step per `DT = 2 µs` tick, ~10⁹ short of real-time DOOM). The SSD is a
distinct, real win; **boot-DOOM stays the north-star fantasy on the emulated-MCU island, not a literal
deliverable on the wired core** — and the two features compose (behavioral flash is the storage the
emulated core maps).

---

## 9. Open questions

1. **Greenlight (gating).** Confirm flash ships as `ELEM_MEMORY` mode 4 (NAND) extending the slot-0 enum,
   with program-AND-clear + bounded eager erase loop + **`mem_meta` second array** for per-block P-E /
   bad-block map + **web-side** factory bad blocks — all golden-safe through `write_cell`/`write_meta` —
   needing explicit owner go before touching `crates/sim-core` (golden rule #1 / #47). Sequence as a
   P4-class phase **after** `memory-characterization-design.md` P2 cell-level SRAM lands. The contract
   evolution (`snapshot_hash` reproducibility now includes the captured t=0 flash image+meta) must be
   reviewed and recorded in `docs/determinism.md`.
2. **Reserved-state layout.** Confirm the committed choice: **second `mem_meta` array + its own fold arm**
   (keeps the pow2 `& (depth-1)` mask bit-identical), accepting the loss of the "no new array / no new fold
   arm" purity. (The alternative — carving the header out of the addressable `2^aw` space and rewriting the
   two decode sites to `header + (raw & (usable_pow2 - 1))` — shrinks user capacity and touches the hottest
   path; not recommended.)
3. **NAND-only vs NAND+NOR for v1.** Resolved to **NAND-only** (NOR's only engine difference is random read,
   already done; its real distinction is a web-side access-protocol matter). Confirm NOR is deferred (a
   trivial mode-5 alias or a web-side skin over the same write rule) rather than shipped as a duplicate
   mode-5 arm now.
4. **Capture granularity for the replay seed.** Resolved to **content-addressed `imageId` in the run record
   for Tier B** (bytes in the immutable IndexedDB blob) + **bytes-inline (`memImage`/`memMeta`) for Tier A**
   (already in the board save). Confirm — vs embedding the full multi-MB image in every run/board snapshot
   (self-contained but heavy) or a baseImage+delta scheme (scales better, more complex). Also: does a
   **downloaded/shared `.json` EMBED** a large flash image (portable but huge) or **REFERENCE** an absent
   volume (small but lossy — zeroed + warning on import)?
5. **Durable backend + keying.** Confirm IndexedDB for Tier-B, content-addressed by `imageId`, board save
   carrying only stable `Component.flashVolId` (minted at format/placement, **NOT** `Component.id`) +
   content digest + schema version. Lifecycle: copy/paste/duplicate of an SSD must mint a **new**
   `flashVolId` (else two parts alias one blob); deleting a part should not eagerly delete the volume (undo)
   → orphan GC / LRU + "flash full" surface.
6. **Capacity ceiling (now a P1 blocker, §3).** Confirm the **honest v1 ceiling** (a teaching SSD of
   `2^16–2^18` words) and that **lazy/chunked zero-fill + `Vec<u8>` packing** land in P-flash-1 **before**
   any larger capacity is advertised. What max flash `addrWidth` is the "realistic SSD" target once lazy
   alloc lands (still ≤24 by the `lib.rs:4070` clamp)?
7. **Commit-back trigger (replay-critical).** Confirm write-back fires **only** on an explicit
   power-down/eject/commit action, gated by `runMode === 'live'` (default OFF), **not** on the
   `controls.restart()` that fires on every edit. Confirm a **FAIL-freeze does NOT auto-commit** (§4.6) —
   a worn-out SSD that FAILs mid-run leaves the durable store at its last clean commit unless the player
   explicitly powers down.
8. **Erase command surface for v1.** Confirm the **dedicated `ERASE` pin + block-address** cell-level cut
   (≤8 pins today) vs the muxed command/status-register protocol (behind the §4 bus-port).
9. **Wear scale + bad-block depth.** Confirm P-E count **per block on erase**, per-block counts + bad-block
   bitmap in `mem_meta` (hashed), unhashed FAIL flag, Real-mode-gated. What game-scaled endurance (~100
   erases?) makes wear-out reachable but not instant? Ship factory bad blocks (web-side off `flashVolId`)
   in the cut, or defer bad blocks and ship erase-before-write + wear counter first? The **player-readable
   per-block status region** is gated on the bus-port (§9 P-flash 5) — confirm.
10. **Read-disturb in v1 or follow-up.** Resolved to **defer** (same eager-hashed pattern as decay; needs a
    separate commit-phase pass because reads are eval-phase, §5.4). Confirm.
11. **Multi-bit words.** The v1 cell-level path is **1-bit-per-word** (read drives `mem_data[i][addr] & 1`,
    `lib.rs:6038`; write latches one bit, `lib.rs:6868`). Confirm v1 NAND ships on the **1-bit-tiled cell
    interface** (program/erase demonstrable per-bit, `all_ones = 1`), with **multi-bit words** (where the
    `wordWidth`-masking argument bites) deferred to the bus-port phase.
12. **Rewind semantics.** Confirm v1 **index-only scrub** (present contents + clear UI note) with keyframe +
    re-simulate restore (digest-compatible, O(bits) recompute) deferred.
13. **SLC vs MLC as `Component.variant`** (identity axis like diode family, lower endurance / more disturb):
    in scope for the cut or a follow-up tier? (Recommend follow-up.)
14. **Convenience-primitive convention.** Confirm **NAND-flash + SSD** rows added to
    `docs/ic-reference-library.md` §5 marked `needs-chip` with a default auto-package/glyph (floating-gate
    reference chip), owner re-authors later.

---

## 10. Risks

- **PERSISTENCE-AS-LIVE-GLOBAL** is the load-bearing trap: any path that live-loads the durable store at
  t=0 (instead of through the captured `memImage`/`imageId` seed) **silently diverges replay** with no
  tripwire (params/images unhashed; the golden has no memory). The single writer to durable storage must be
  the explicit commit action; the load path must always be `durable → imageId/memImage → load_memory`;
  replay reads **only** its captured seed (§4).
- **RESERVED-WORDS-IN-`mem_data` would corrupt the address decode** — the single most dangerous engine bug
  in the draft. `depth = 2^aw + header` is not a power of two, so `addr & (depth-1)` (`lib.rs:6037`/`6867`)
  becomes garbage, aliasing user ↔ bookkeeping words silently. **Closed** by the second `mem_meta` array
  (§5.2). A debug-assert does not fix a wrong mask and is off in release wasm.
- **`write_cell`/`write_meta` BYPASS** is the cardinal sin; **erase is the highest-risk site** (a loop over
  many words). All mutations must route through the primitives or the digest drifts forever with no tripwire.
  `assert_digest_consistent` (extended to `mem_meta`) must run after a flash erase in tests; review must
  forbid direct `mem_data[..]`/`mem_meta[..]` assignment.
- **COMMIT-BACK-DURING-REPLAY**: enforced by the `runMode` flag threaded to the single write-back call site,
  **defaulting to OFF** (§4.4) — not an optional property. A grading harness built later without reading
  this doc still cannot clobber the live SSD. Test j proves the default.
- **SEED HOOK SITE + RING-FRAME ORDERING**: the seed must run **inside the `loop.ts` `reset()` closure
  before the frame-0 push at `loop.ts:358`** (covers `resync`/`restart`/initial) **and** after the wasm
  install in `rebuildNetlist`. **`resync()` is the real seam after a netlist change** (`loop.ts:478`, called
  from `App.svelte:2460`/`2473`), and it does **not** call `sim.reset()` — seeding from `App.svelte` after
  `resync()` lands one call too late. No golden tripwire; test i (the **resync path specifically**) catches it.
- **FACTORY-BAD off `elem_index`** would change `snapshot_hash` for an untouched flash device when an
  unrelated part is added (`elem_index` is netlist-position, not identity). **Closed** by computing factory
  bad blocks **web-side off the stable `flashVolId`** into the captured image (§6).
- **RESTORING CONTENTS BUT NOT HASHED WEAR**: `mem_wear` + the `mem_meta` words fold into `snapshot_hash`,
  so a reloaded volume that restores only data diverges from a continuous run. The image+seed must carry
  data + wear + bad-block map + disturb counters together (§4.5).
- **ALL_ONES-MASKED-TO-wordWidth** on erase (§5.5): an unmasked `0xFFFF_FFFF` on a narrow word sets phantom
  high bits, diverging the digest. (`mem_cell_hash` zero-skips, `lib.rs:2750`.)
- **LAZY ERASE/WEAR/DISTURB** would break replay exactly as lazy DRAM rot did
  (`memory-characterization-design.md` §5.4): a snapshot between an erase command and the next program would
  see un-erased vs erased contents for identical logical state → two hashes. Every flash mutation must be
  **eager** through `write_cell`/`write_meta` in the commit phase.
- **READ-DISTURB IS EVAL-PHASE-vs-COMMIT-PHASE**: the read drive is in eval (`lib.rs:6038`, immutable
  borrow — no `write_meta`), so a disturb increment needs a **separate commit-phase pass** re-deriving the
  read address (§5.4). "Increments on read" is structurally wrong; corrected. (Deferred, low urgency.)
- **HEAP O(bits)-AT-INSTALL** (`lib.rs:4066-4071`, clamp 24 at `lib.rs:4070`): up to 64 MB per device on
  placement; a few devices OOM the wasm heap; multi-GB is impossible at the clamp. **A P1 blocker**, not an
  open question: honest ceiling + lazy/chunked alloc + `Vec<u8>` packing as P1 sub-tasks (§3, §6).
- **`mem_meta` LENGTH + MODE-BRANCHED LAYOUT**: `mem_meta.len()` must equal `elements.len()` (size it in the
  install loop, push empty Vecs) or the fold breaks (the `pushFGH`/`e`-array desync precedent); the per-mode
  header layout must agree between install, `load_meta`, and `reset()` or a reseed writes the wrong offsets.
- **localStorage CANNOT hold a multi-MB SSD** (`storage.ts:105` swallows the quota error → the SSD silently
  vanishes on refresh; JSON-of-`number[]` is ~10× bloat). **Tier B MUST use IndexedDB** (packed
  `ArrayBuffer`, only a reference in the board blob); the size-threshold split is mandatory.
- **INDEXEDDB IS ASYNC** and absent from the codebase: the t=0 re-seed feels synchronous in the frame loop,
  so the volume blob MUST be **pre-warmed** into an in-memory buffer at board-load/format time (never
  `await` inside the loop). Installing with an empty store while the image arrives a tick later looks exactly
  like nondeterminism.
- **`flashVolId` COLLISION / STALE SCHEMA**: keying on the volatile `Component.id`, or reusing a `flashVolId`
  across incompatible image schema versions, cross-contaminates or mis-reads. Mint a stable `flashVolId` at
  placement; store content digest + schema version; a schema bump degrades to **blank** flash (the
  `storage.ts` fail-safe ethos), never mis-parses.
- **WORD-LEVEL/AUTHENTIC NAND BUS + MULTI-BIT WORDS are BLOCKED** on the `memory-characterization-design.md`
  §4 contiguous-node bus-port (`graph.ts:381-383` has no index-adjacency guarantee). Shipping a "real SSD
  bus" before §4(A) lands reads garbage addresses with no tripwire. Keep the v1 cut on the ≤8-pin, 1-bit-word
  cell interface; defer the bus, multi-bit words, the readable status region, and the rich FTL/wear-leveling
  controller lesson behind that named gate.
- **REWIND EXPECTATION GAP**: the ring excludes `mem_data`/`mem_meta`, so scrub-back shows past voltages with
  **present** flash contents (durable mutation is actually realistic). More visible for flash than RAM —
  players expect a rewound SSD to remember; v1 cannot restore it. Must be flagged clearly in UI (§4.7) or it
  reads as a determinism bug.
- **SCOPE/SEQUENCING**: a faithful NAND controller (page register, status polling, bad-block table, wear
  leveling, ECC) is large hand-built logic; the authentic muxed interface + multi-bit words + read-disturb +
  keyframe rewind are each follow-ups. Ship the engine mode + captured-input persistence + cell-level
  toy-interface first (data-layer-first, the Cable precedent); gate the rest. **Frame the DOOM/SSD fantasy
  honestly** (storage win, not throughput; ~10⁹ from real-time on the wired core) or it reads as "DOOM runs
  on the hand-built core" — it does not (§8).

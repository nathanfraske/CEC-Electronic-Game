<!-- SPDX-License-Identifier: Apache-2.0 -->

# IC Library & User-Selected Variants

> Design doc consolidating two proposals — **parts-bin-library** (persist sealed ICs
> across sessions, place them from the bin) and **ic-variants** (group several sealed
> dies under one placeable family, pick among them in the inspector) — into ONE feature
> set. They are one feature because they share the same registry (`userIc.ts`), the same
> save path (board-embedded `userIcs`), and the same golden-safety argument: both are
> render / UI / persistence only and never touch the deterministic core.

## 1. Purpose

Today, sealing a die calls `captureSeal` (`userIc.ts:415`) → `registerUserIc`
(`userIc.ts:147`), which writes the in-memory `REGISTRY` map and `PART_KINDS[tag]`.
That registration is **process-only**: it survives until refresh, and `PART_KINDS[tag]`
is never surfaced in the parts bin (`PARTS` is a static array, `App.svelte:173`). A
sealed IC is only placeable as the re-kinded frame that produced it (`dieSeal`,
`App.svelte:2478`). Cross-session it persists ONLY embedded in a board's `userIcs`
(`storage.ts:83` / `App.svelte:3000`) — there is no personal library, and there is no way
to keep several inner-circuit options under one part.

This design adds two layers, both web-side, both orthogonal to per-board embedding:

1. **A persistent library** — sealed ICs survive across sessions and across boards in a
   personal `localStorage` library, surfaced as a **"My ICs"** category in the parts bin,
   placeable exactly like any built-in kind.
2. **Variant families** — several sealed dies grouped under ONE placeable family tag,
   selected per-instance via the EXISTING `Component.variant` axis (`graph.ts:144`), the
   same field the inspector already uses for diode families and LED colours.

Neither touches `sim-core`, `sim-protocol`, the wasm boundary, or the golden. Both merely
make the SAME `PART_KINDS` / `REGISTRY` registration a loaded board already performs happen
at startup, on seal, and per inspector pick.

## 2. Data model

### 2.1 The library — `web/src/lib/userLibrary.ts` (new, ~150 lines)

A `UserIc` (`userIc.ts:32`) is already plain JSON (it round-trips through saves), so the
library is a persisted, ordered list of them plus a little metadata:

```ts
interface LibraryEntry {
  ic: UserIc;                      // the full sealed def (graph + frameId + package + pinNames)
  addedAt: string;                 // ISO; for sort + "new" affordance
  source: "sealed" | "imported";   // sealed locally vs pulled from a loaded board
}
interface UserLibrary { v: 1; entries: LibraryEntry[]; }
```

The dedupe unit is **`ic.tag`** — the same identity key the registry uses and what placed
instances reference. The module owns:

- `loadLibrary()` / `saveLibrary(lib)` — guarded `localStorage` I/O mirroring `storage.ts`'s
  `loadSettings` / `saveSettings` pattern (try/catch + `available()`); `saveLibrary` swallows
  quota errors like `saveBoard` (`storage.ts:88`).
- `libraryEntries()` — sorted (addedAt desc).
- `addToLibrary(ic, source)` — **upsert by tag**: if the tag exists, REPLACE the def (the
  re-seal/update path) but keep the earlier `addedAt`.
- `removeFromLibrary(tag)`.
- `renameLibraryIc(tag, name)` — sets `entry.ic.name` (display only; `userIcPartKind`
  re-derives the card label from `ic.name`, `userIc.ts:135`). Does NOT change `tag`.
- `registerLibrary()` — calls `registerUserIcs(entries.map(e => e.ic))` (`userIc.ts:221`) at
  startup, so every library IC becomes a live `PART_KINDS` kind.

### 2.2 The variant / family model — `userIc.ts`

The two proposals disagreed on shape. **Recommendation: a separate `UserIc` def per
variant, grouped under a family tag** (the ic-variants proposal's choice), NOT a `variant`
field on a single def. Rationale: a user IC has no sim param block of its own — it flattens
to discrete parts — so there is nothing to parameterise centrally. *The variation IS the
inner graph.* Each variant therefore carries its own `graph`, `frameId`, `package`, and
`pinNames`.

Add a family registry alongside the existing flat `REGISTRY` (`userIc.ts:50`):

```ts
export interface UserIcFamily {
  family: string;       // the placeable kind tag, e.g. "INV"
  name: string;         // display name, e.g. "Inverter"
  variants: UserIc[];   // ordered; variant index = position; variants[0] is the default
}
const FAMILIES = new Map<string, UserIcFamily>();   // family tag -> family
```

**Registry invariant (keeps single-variant ICs byte-identical):**

- `REGISTRY` stays the source of truth for `getUserIc` / `flattenUserIcs`, mapping a
  *resolved* tag → `UserIc`. A single-variant IC (today's universal case) keeps
  `tag === family` with one entry and **no `FAMILIES` row** → identical to current behaviour.
- A multi-variant family registers each variant under a derived child tag `"INV#0"`,
  `"INV#1"`, … in `REGISTRY`; `FAMILIES` maps `"INV"` → the family. The family tag `"INV"`
  itself is registered in `PART_KINDS` (one bin tile, placeable) and in `REGISTRY` pointing
  at `variants[0]`, so any code path unaware of variants still resolves a valid inner circuit.

New resolvers (mirroring `diodeVariant`, `diodes.ts:87`, including the clamp):

```ts
export function userIcVariants(family: string): UserIc[] | null {
  return FAMILIES.get(family)?.variants ?? null;        // null => not a multi-variant family
}
export function hasUserIcVariants(tag: string): boolean {
  return (FAMILIES.get(tag)?.variants.length ?? 0) > 1;  // inspector picker gate
}
/** Resolve a placed (familyTag, variant) to the concrete sealed def. */
export function resolveUserIc(tag: string, variant = 0): UserIc | undefined {
  const fam = FAMILIES.get(tag);
  if (fam) {
    const i = Math.max(0, Math.min(fam.variants.length - 1, Math.round(variant)));
    return fam.variants[i];                              // clamp like diodeVariant()
  }
  return REGISTRY.get(tag);                              // plain single-variant IC
}
```

**v1 same-package constraint (resolves the main risk).** `userIcPartKind` (`userIc.ts:91`)
derives ONE `PartKind` (footprint + pinout) per tag. Per-variant footprints would force the
placed instance to re-derive its footprint and hit-test on switch — that touches the renderer
and hit-test, not just the netlist. **v1 requires all variants in a family to share
`package.archetype` + `package.pinCount`** (validated at seal time), so variant switching is
footprint-stable and golden-trivial. Variants may still differ in inner circuit, inner part
values/tiers, and pin labels. Cross-package variants are deferred (see §7).

### 2.3 Persistence format

Two separate concerns, two stores.

**Library store** — a NEW `localStorage` key `cec.library.v1`, separate from
`cec.board.v1` (`storage.ts:13`) so a board reset never wipes the library:

```json
{ "v": 1, "entries": [
  { "ic": { "tag": "CEC9001", "name": "My Latch", "package": { "archetype": "...", "pinCount": 8 },
            "frameId": 7, "graph": { }, "pinNames": [] },
    "addedAt": "2026-06-24T...", "source": "sealed" }
] }
```

**Explicit export/import envelope** — an "Export library" button downloads
`{ format: "cec-iclib", version: 1, entries }`, a sibling of the `cec-circuit` envelope.
Load detects `format === "cec-iclib"` in `onLoadFile` (`App.svelte:3037`, branching BEFORE
the graph check) and merges into the library instead of replacing the board.

**Board save sidecar (for families only).** The board envelope (`App.svelte:3000`,
`storage.ts:64`) already embeds `userIcs: UserIc[]`. For families it must additionally carry
an OPTIONAL `userIcFamilies` sidecar mapping family tag → `{ name, variantTags: ["INV#0",
"INV#1"] }`, so `registerUserIcs` can regroup the embedded defs into `FAMILIES` on load.
Single-variant boards omit it → existing saves and the golden stay byte-identical.

## 3. Integration points

| File:symbol | Change |
| --- | --- |
| `web/src/lib/userLibrary.ts` (NEW) | Whole module: `loadLibrary` / `saveLibrary` / `libraryEntries` / `addToLibrary` / `removeFromLibrary` / `renameLibraryIc` / `registerLibrary`; `localStorage` key `cec.library.v1`; `cec-iclib` export/import envelope. |
| `userIc.ts:32` `UserIc` | Unchanged shape (already a complete variant def). |
| `userIc.ts:50` `REGISTRY` | Unchanged role; gains child tags `"INV#i"` for family variants. |
| `userIc.ts` (new) `UserIcFamily` / `FAMILIES` | New family registry + `userIcVariants` / `hasUserIcVariants` / `resolveUserIc` / `appendUserIcVariant` / `nextVariantTag` / `registerUserIcFamilies`. |
| `userIc.ts:80` `userIcTags` | Return FAMILY tags for multi-variant families plus plain single tags; HIDE the internal `"INV#i"` child tags from the bin. |
| `userIc.ts:147` `registerUserIc` / `:153` `unregisterUserIc` | `unregisterUserIc` must cascade: dropping a family tag also drops its child tags + the `FAMILIES` row. |
| `userIc.ts:194` `userIcsForGraph` | When `c.kind` is a family, emit ALL its variants (not just the selected one) — the player may switch variants offline after reload; descend into each variant's die. |
| `userIc.ts:221` `registerUserIcs` | Companion `registerUserIcFamilies(defs, families?)` regroups embedded defs into `FAMILIES` from the sidecar and re-registers the family tag in `PART_KINDS`. |
| `userIc.ts:259/297/303` `flattenUserIcs` | **Determinism-critical.** Membership test becomes `REGISTRY.has(c.kind) || FAMILIES.has(c.kind)`; inner def resolved via `resolveUserIc(inst.kind, inst.variant ?? 0)` instead of `REGISTRY.get(inst.kind)!`. |
| `userIc.ts:415` `captureSeal` | New optional `intoFamily?: string` param; when set, append the captured def as a new variant via `appendUserIcVariant` instead of `registerUserIc`. |
| `graph.ts:144` `Component.variant` | Reused unchanged as the family-variant index (already persisted + round-tripped). |
| `graph.ts:1603` `PLACEMENT_OVERRIDE_KEYS` | Already includes `"variant"` — armed variant flows into `place()` untouched; no change. |
| `storage.ts:13` `BOARD_KEY` | Sibling library key `cec.library.v1` lives in `userLibrary.ts`. |
| `storage.ts:64` `BoardBlob` | Add optional `userIcFamilies` sidecar field. |
| `storage.ts:116` `loadBoard` | After re-registering `userIcs`, call `registerUserIcFamilies` with the sidecar so families resolve on cold-start restore. |
| `board.ts:2750` `setComponentVariant` | Reused unchanged (pushes undo, rebuilds netlist). |
| `board.ts:2841` `sealFrame` | Thread `intoFamily` through to `captureSeal`. |
| `netlist.ts:859` flatten call site | Unchanged — flatten still runs pre-build, before union-find. |
| `App.svelte:173` `PARTS` | Stays static built-in-only; "My ICs" + family tiles render separately from `savedIcParts` / `userIcTags`. |
| `App.svelte:2467/2478` reseal / `dieSeal` | After seal (`captureSeal`) and after reseal (`resealUserIc`), `addToLibrary(getUserIc(tag)!, "sealed")` to keep the library in sync. |
| `App.svelte:2612` `selVariant` / `setVariant` | Reused unchanged for the user-IC variant picker. |
| `App.svelte:2741` config-card visibility gate | Add `|| hasUserIcVariants(kind)`. |
| `App.svelte:3385` `partRow` snippet | Reused verbatim for "My ICs" rows; add an optional `glyphKind` for the package-glyph thumbnail. |
| `App.svelte:3469` search filter | Fold `savedIcParts` into the `hits` filter (searchable by name/tag). |
| `App.svelte:3487` category loop | Render a new "My ICs" collapsible category at the TOP, before `{#each PART_CATEGORIES}`. |
| `App.svelte:3051` `onLoadFile` | Branch on `format === "cec-iclib"` (library import); after a board load, diff `parsed.userIcs` vs the library and offer to add. |
| `App.svelte:3637` inspector `partConfig` | New `hasUserIcVariants` picker block (after `hasLedColors`). |
| `App.svelte:4540` seal panel | "Variant of …" dropdown (default "New IC") routing through `intoFamily`. |
| `App.svelte` `onMount` init | Call `registerLibrary()` BEFORE `loadBoard` / example restore. |
| `docs/ui/ic-maker-guide.md` | Document the library, dedupe rules, and variant authoring. |

## 4. UX flows

### 4.1 Save-to-library (auto on seal)

In `dieSeal` (`App.svelte:2478`), after `captureSeal` returns `cap`:

```ts
const def = getUserIc(cap.tag);
if (def) addToLibrary(def, "sealed");
```

For the EDIT/re-seal branch (`App.svelte:2467`, `resealUserIc`), after reseal also
`addToLibrary(getUserIc(ctx.editingTag)!, "sealed")` so an in-place edit updates the library
copy (upsert by tag keeps it in sync). Bump `libRev` (see §4.2). Both are persistence only.

### 4.2 Place-from-bin

`REGISTRY` / `PART_KINDS` are plain (non-`$state`) module globals, so the bin won't react to
registry mutation on its own. Add a Svelte `$state` counter `libRev`, bumped on every library
mutation (seal, delete, rename, import, board-merge). The bin derives its rows from it:

```ts
const savedIcParts = $derived.by(() => {
  void libRev; // dependency
  return libraryEntries().map(e => ({
    tag: e.ic.tag, name: e.ic.name,
    desc: `${e.ic.package.archetype} · ${e.ic.package.pinCount}-pin`,
    tier: "★", color: "var(--accent)",   // accent = player-made (matches userIcPartKind colorKey, userIc.ts:136)
  }));
});
```

Render a new collapsible **"My ICs"** category at the TOP of the bin (before
`{#each PART_CATEGORIES}`, `App.svelte:3487`), reusing `partRow` (`App.svelte:3385`) verbatim
so glyph/drag/click/arm work identically to a built-in. Hidden when empty. Each row shows a
small **package glyph** (render the `packageLayout` footprint, `userIc.ts:92`, as a tiny pin-ring
thumbnail via the optional `glyphKind`) instead of the tag text.

**Place itself is free.** Because `registerLibrary()` populated `PART_KINDS[tag]`, a row arms
exactly like a built-in: `toggleArm(tag)` (`App.svelte:3393` → `arm`, `App.svelte:2829` →
`board.setArmed`) and `onPartDragStart` (`App.svelte:3392`). The drop path places any
`PART_KINDS[tag]`, and `flattenUserIcs` (`userIc.ts:253`) inlines it at build time. The placed
instance is the same no-element hub a board-embedded IC produces.

### 4.3 Create-variant (seal-as-variant-of)

`captureSeal` (`userIc.ts:415`) currently always registers a fresh top-level tag. Add an
optional `intoFamily?: string`. When set, append the captured def as a new variant:

```ts
appendUserIcVariant(intoFamily, {
  tag: nextVariantTag(intoFamily), name, package: pkg, frameId, graph: snapshot, pinNames,
});
```

The seal panel (`App.svelte:4540`) gains a "Variant of …" dropdown (default "New IC") listing
existing families. The first seal of a name creates a single-variant family implicitly; the
second seal "into" it promotes it to multi-variant (registers the family tag in `PART_KINDS`,
child tags in `REGISTRY`). At seal-into time, **validate same package + pinCount as variant 0**
(v1 constraint); surface a warning chip and refuse/queue the cross-package case for now.

### 4.4 Select-variant

In the inspector `partConfig` (`App.svelte:3637`, after the `hasLedColors` block), reuse
`selVariant()` / `setVariant()` (`App.svelte:2612`) unchanged — they read/write
`Component.variant` via `board.setComponentVariant` (`board.ts:2750`), which pushes undo and
rebuilds the netlist:

```svelte
{#if hasUserIcVariants(kind)}
  {@const variants = userIcVariants(kind) ?? []}
  <div class="insp-sub">variant</div>
  <div class="insp-chips wrap">
    {#each variants as v, i (v.tag)}
      <button class="chip-val {selVariant() === i ? 'is-active' : ''}"
        onclick={() => setVariant(i)}>{v.name}</button>
    {/each}
  </div>
{/if}
```

Gate the config card at `App.svelte:2741` with `|| hasUserIcVariants(kind)`. The same
`setVariant` → `setArmedAxis({ variant })` path (`App.svelte:2619`) works in the arm-time bin
configurator, so a player arms "Inverter, variant: strong" and places it pre-configured;
`PLACEMENT_OVERRIDE_KEYS` already carries `"variant"` (`graph.ts:1603`).

### 4.5 Management UX

Per-row controls in "My ICs" (kebab/hover cluster, saved-IC rows only):

- **Rename** → inline input → `renameLibraryIc(tag, name)` + `libRev++`. Re-derives the
  `PART_KINDS[tag]` label via `registerUserIc` of the updated def.
- **Delete** → `removeFromLibrary(tag)` + `unregisterUserIc(tag)` (`userIc.ts:153`) + `libRev++`.
  **Delete-while-placed rule:** delete only removes from the library + bin; the board embedding
  (`userIcsForGraph`) keeps the def alive in saves and re-registers it on next load, so placed
  copies keep working. Confirm with a clear message ("N placed — removed from the bin; placed
  copies still work and re-appear if you reload"). This avoids orphaning placed instances.

## 5. Determinism / golden contract

Everything here is `PART_KINDS` / `REGISTRY` / `FAMILIES` population + `localStorage` + Svelte UI.
Nothing crosses the wasm boundary differently; no `sim-core`, `sim-protocol`, or `sim-wasm` change.

- **The golden places no user IC** (`userIc.ts:12` contract) → `REGISTRY` and `FAMILIES` are
  empty, so `flattenUserIcs`'s membership test (`REGISTRY.has(c.kind) || FAMILIES.has(c.kind)`,
  `userIc.ts:259`) is false for every component, the early no-op return fires (`userIc.ts:264`),
  and the input graph is returned byte-identical. **Golden `0xeaac_3764_99e4_fa24` is untouched.**
- **Flatten stays a strict no-op when nothing is placed** — the added `|| FAMILIES.has(...)`
  clause only widens the membership test; with both maps empty it changes nothing.
- **Single-variant ICs stay byte-identical:** `tag === family`, no `FAMILIES` row, so
  `resolveUserIc(tag, variant ?? 0)` returns `REGISTRY.get(tag)` — the same def the old
  `REGISTRY.get(inst.kind)!` returned. The inlined element arrays are identical.
- **Variant selection is a pure graph→graph choice BEFORE `buildNetlist`** (flatten runs at
  `netlist.ts:859`, before union-find). The chosen variant's inner graph is inlined with the same
  deterministic sorted-id remap (`userIc.ts:296` sorts pending by id; offsets are deterministic
  multiples of `STRIDE`). No variant data is hashed; the FNV-1a snapshot hash sees only the
  resulting discrete elements. Switching variants yields a DIFFERENT but equally-deterministic
  netlist — like editing any value.
- **Clamping** (`resolveUserIc`, like `diodeVariant`) makes an out-of-range/legacy index resolve
  to a valid variant deterministically, so a save referencing a variant a since-shrunk family no
  longer has still flattens (clamp to last) rather than crashing.
- **Library is purely additive at startup** — `registerLibrary()` performs the same registration
  a loaded board already performs (`loadBoard` → `registerUserIcs`, `storage.ts:117`), just earlier
  and from a different store.

## 6. Save round-trip (library ↔ board `userIcs` embedding)

Two directions, both additive; the embedding stays the minimal, correct one it is today.

**Library → save (embed).** `userIcsForGraph(graph)` (`userIc.ts:194`) embeds exactly the IC
defs PLACED on the board (transitively, including nested — `scan` descends `def.graph.components`,
`userIc.ts:211`). A library IC you never placed is NOT embedded (saves stay minimal). Because
library ICs are registered into `PART_KINDS` at startup, placing one makes the save embed it — no
change to `saveCircuit` (`App.svelte:3000`) or `saveBoard` (`storage.ts:83`). **For families,**
`userIcsForGraph` emits ALL variants of every placed family (so the player can switch variants
offline after reload), plus the `userIcFamilies` sidecar to round-trip the grouping; both omitted
for single-variant boards.

**Board → library (offer to add).** In `onLoadFile` (`App.svelte:3051`) and `loadBoard`
(`storage.ts:116`), `parsed.userIcs` are already re-registered before the graph loads (required
so placed instances resolve — unchanged). AFTER load, diff each embedded def's tag against
`libraryEntries()`; if any are missing, surface a NON-blocking banner ("This board includes N
custom ICs — Add to your library?") driven by a `pendingLibraryAdds` `$state`, accepting →
`addToLibrary(def, "imported")`. The autosave-restore path (`loadBoard`) may silently skip the
offer (a cold restore is your own prior session).

**Init ordering.** Call `registerLibrary()` once at app startup BEFORE `loadBoard` / example
restore, so a restored board's placed library-ICs resolve even if its embedded `userIcs` were
trimmed; `loadBoard`'s own `registerUserIcs` then harmlessly upserts the board's embedded copies
on top.

## 7. First cut vs defer

**First cut (v1):**

- `userLibrary.ts` with `localStorage` CRUD + `cec.library.v1`.
- "My ICs" bin category (reusing `partRow` + package-glyph thumbnail), `libRev` reactivity,
  search fold-in, place via existing arm/drag.
- Auto-add on seal + reseal; rename + delete (delete keeps placed copies alive via board embedding).
- `cec-iclib` export/import envelope; board-load "add to library" banner.
- Variant families with the **same-package + same-pinCount constraint** (validated at seal time):
  `FAMILIES` registry, `resolveUserIc` in flatten, inspector picker (reusing `selVariant`/`setVariant`),
  seal-as-variant-of dropdown, `userIcFamilies` save sidecar.

**Defer:**

- **Cross-package variants** (per-variant footprint/pinout). Needs the placed instance to re-derive
  its `PartKind` from the selected variant at render + hit-test time — touches the renderer and
  hit-test, not just the netlist. Push to a follow-up.
- **"Open library IC to edit" without a placed instance** (synthesize a scratch board with one
  instance and drill in via `openDieGraphInBuilder`, `App.svelte:2358`). Optional polish.
- **Library folders / tags / search-by-category** beyond flat name/tag search.
- **Self-hosted cloud sync** of the library (today it is per-browser `localStorage`).

## 8. Open questions for the owner

1. **Re-tag on import collision.** Two boards may reuse `CEC9001` for DIFFERENT dies. On import,
   prompt keep-mine / replace / keep-both-under-a-fresh-tag? Re-tagging a JUST-LOADED board's IC
   must also rewrite that graph's matching `kind`s (placed instances reference the old tag) — so
   re-tag is safe only for library-only adds, OR we rewrite the loaded graph too. Which behaviour
   do you want as default?
2. **Family promotion identity.** When the second seal promotes a single IC into a family, the
   single IC's original tag becomes `family` and its variant becomes `"<family>#0"`. Do already-saved
   boards that reference the old single tag still resolve? (They should: the family tag stays
   registered in `REGISTRY` → `variants[0]`.) Confirm this is the desired migration.
3. **`localStorage` quota.** Many large dies could blow the cap; `saveLibrary` swallows quota
   errors silently — do you want a visible "library full" warning, or a soft cap / LRU eviction?
4. **Variant ordering / default.** Is `variants[0]` always the default a fresh placement gets, and
   should the seal-into UI let the author reorder or set the default?
5. **Same-package constraint UX.** When a new variant's package differs from variant 0, do we refuse
   the seal, or seal it as a NEW family? (v1 leans refuse-with-warning.)
6. **Cross-board "imported" provenance.** Should an imported IC's `source: "imported"` be visually
   distinguished in the bin (e.g. a badge), and should deleting it behave differently from a locally
   sealed one?

---

## Cross-check findings — resolve during implementation

An adversarial reviewer confirmed the design is **GOLDEN-SAFE** (`flattenUserIcs`'s no-op gate holds when `REGISTRY` + `FAMILIES` are empty — the golden places no user IC; the `variant` axis only selects which inner `GraphSnapshot` is inlined, never a hashed value) and the architecture is sound (reuse `Component.variant`; a `FAMILIES` registry; a localStorage library + a "My ICs" bin section). Verdict **REVISE** — for save-round-trip precision + these concrete gaps (address in the build):

1. **Verify the golden literal** `0xeaac_3764_99e4_fa24` against the current sim-core golden before treating §5 as authoritative.
2. **Feasibility precision:** the "My ICs" bin category is *entirely new* — the palette today renders only from the static `PARTS` array via `familyGroups()`/`PART_CATEGORIES`; `userIcTags`/`savedIcParts` feed nothing yet. `partRow` (App.svelte) renders `part.tag` as glyph text and is typed `(typeof PARTS)[number]` — reusing it for library rows needs real type + glyph changes, not "verbatim". The config-card gate is `hasConfig()` (not a fixed line).
3. **GAP — nested-variant `userIcsForGraph`:** the transitive scan dedups by `seen.has(c.kind)` on the family tag and resolves via `variants[0]` only. For a family it must (a) push **every** variant def, (b) recurse into **each** variant's `graph.components`, (c) change the `seen` dedup key so descending into variants 1..n isn't skipped after variant 0 — else nested multi-variant families drop inner defs from saves (the exact failure the transitive scan exists to prevent).
4. **GAP — variant-order determinism contract:** the placed instance persists `variant` as an **integer index**, not a child tag. Make explicit: the save sidecar's `variantTags` array is the **ordered source of truth**, variant index = position in it, and `saveCircuit` writes it in stable order; `registerUserIcFamilies` rebuilds `variants[]` in exactly that order. Otherwise `variant: 2` can resolve to a different die after reload.
5. **GAP — append-only variant ordering (v1):** new variants always get the highest index, default stays index 0. Reordering/changing the default would silently re-point every already-saved board's integer `variant` — so forbid it in v1 to keep the index a durable reference.
6. **GAP — tag-collision is a data-loss path, not just UX:** `registerUserIcs(parsed.userIcs)` upserts by tag *before* the board loads, so loading board B silently overwrites the live `REGISTRY`/`PART_KINDS` entry that an already-open board A's placed instances point at. Handle "a load clobbers a live registry entry" (e.g. version/namespace imported tags, or refuse to overwrite a referenced tag), beyond the library-scoped re-tag prompt.
7. **GAP — delete-while-placed (live):** between `unregisterUserIc(tag)` and the next save, a netlist rebuild makes the placed instance an unknown kind (`REGISTRY.has` false → its inner parts vanish from the live sim until reload). Keep the registry entry alive while any board component references the tag, or re-register from `userIcsForGraph` immediately after delete.
8. **GAP — reserved-tag guard:** `captureSeal` allows an arbitrary free-form `name` as the tag; `registerLibrary()` at startup could clobber a built-in `PART_KINDS` kind (e.g. `R`). Refuse seal/import tags that collide with built-in `PART_KINDS` / die-frame tags.

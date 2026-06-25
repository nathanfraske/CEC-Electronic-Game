// SPDX-License-Identifier: Apache-2.0
// The PERSONAL IC LIBRARY (docs/ic-library-and-variants.md §2.1). Sealing a die registers a placeable
// kind in-memory (userIc.ts `REGISTRY` / `PART_KINDS`), but that registration is PROCESS-ONLY — it
// survives until refresh, and cross-session a sealed IC persists ONLY embedded in a board's `userIcs`.
// This module adds a persistent, per-browser library (a `localStorage` list of sealed defs) surfaced
// as a "My ICs" bin category, so a sealed IC — e.g. an inverter you'll nest to build a 4-LUT — is
// placeable from any board, forever. It is a SIBLING store to `cec.board.v1`, so a board reset never
// wipes the library.
//
// Determinism: this is PURE PART_KINDS / REGISTRY / FAMILIES population + localStorage. `registerLibrary()`
// at startup performs exactly the registration a loaded board already performs (loadBoard ->
// registerUserIcs), just earlier and from a different store. The golden places no user IC, so an empty
// library registers nothing and the golden is untouched. Every read is guarded so a corrupt/stale blob
// degrades to an empty library rather than throwing (mirroring storage.ts).
import {
  registerUserIcs,
  registerUserIcFamily,
  registerUserIc,
  userIcVariants,
  getUserIc,
  isReservedTag,
  type UserIc,
} from "./userIc";

/** localStorage key for the personal library. Sibling of `cec.board.v1` (storage.ts) so a board reset
 * leaves the library intact. */
const LIBRARY_KEY = "cec.library.v1";

/**
 * One library row, keyed by its PLACEABLE tag. A plain single-variant IC carries just `ic`; a
 * multi-variant FAMILY additionally carries `variants` (the ordered variant defs — the durable source
 * of truth for variant order, gap #4) and `family`/`name`. `ic` for a family is its variant-0 def, so
 * the bin tile / package glyph derive from it exactly like a single IC.
 */
export interface LibraryEntry {
  /** the placeable def: a single IC's def, or a family's variant-0 def (for the tile/glyph). */
  ic: UserIc;
  /** when present, this row is a multi-variant family: the ordered variant defs (>= 2). */
  variants?: UserIc[];
  /** the family display name (present iff `variants`). */
  name?: string;
  /** ISO timestamp the row was first added — for sort ("recent first") + a future "new" affordance. */
  addedAt: string;
  /** sealed locally vs pulled from a loaded board. */
  source: "sealed" | "imported";
}

/** The persisted library: a versioned, ordered list of {@link LibraryEntry}. */
export interface UserLibrary {
  v: 1;
  entries: LibraryEntry[];
}

function available(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

/** The placeable tag a library row is keyed by: a family's family tag (the child defs carry
 * `"<family>#i"` tags, so strip the suffix), else a single IC's plain tag. */
function rowTag(e: LibraryEntry): string {
  if (!e.variants) return e.ic.tag;
  const child = e.variants[0]?.tag ?? e.ic.tag;
  const hash = child.indexOf("#");
  return hash >= 0 ? child.slice(0, hash) : child;
}

/** Load the library, falling back to an empty one on absence / corruption / version mismatch. */
export function loadLibrary(): UserLibrary {
  if (!available()) return { v: 1, entries: [] };
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return { v: 1, entries: [] };
    const obj = JSON.parse(raw) as UserLibrary;
    if (!obj || obj.v !== 1 || !Array.isArray(obj.entries))
      return { v: 1, entries: [] };
    // Keep only well-formed rows (a row must at least carry an `ic` with a tag).
    const entries = obj.entries.filter(
      (e) => e && e.ic && typeof e.ic.tag === "string",
    );
    return { v: 1, entries };
  } catch {
    return { v: 1, entries: [] };
  }
}

/** Persist the library, swallowing quota / private-mode write errors (a failed save must never
 * interrupt editing — exactly like saveBoard). */
export function saveLibrary(lib: UserLibrary): void {
  if (!available()) return;
  try {
    localStorage.setItem(
      LIBRARY_KEY,
      JSON.stringify({ v: 1, entries: lib.entries }),
    );
  } catch {
    // Quota exceeded or private-mode block — fine, just don't persist.
  }
}

/** The library entries, sorted most-recently-added first (the bin's row order). */
export function libraryEntries(): LibraryEntry[] {
  return [...loadLibrary().entries].sort((a, b) =>
    a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0,
  );
}

/**
 * Add (or update) the library row for a PLACEABLE tag — the post-seal / board-import sync point. Reads
 * the LIVE registry (userIc.ts) for the tag: a multi-variant family snapshots all its ordered variant
 * defs; a single IC snapshots its one def. UPSERT BY TAG: if a row for the tag exists, its def(s) are
 * REPLACED (the re-seal / update path) but the original `addedAt` is kept (stable sort across edits).
 * A no-op for a reserved or unregistered tag. Returns the updated library (the caller persists +
 * bumps its reactivity counter).
 */
export function addToLibrary(
  tag: string,
  source: "sealed" | "imported",
): UserLibrary {
  if (isReservedTag(tag)) return loadLibrary();
  const variants = userIcVariants(tag); // non-null iff a multi-variant family
  const base = getUserIc(tag); // variants[0] for a family, the def for a single IC
  if (!base) return loadLibrary();

  const lib = loadLibrary();
  const idx = lib.entries.findIndex((e) => rowTag(e) === tag);
  const prior = idx >= 0 ? lib.entries[idx] : undefined;
  const row: LibraryEntry = {
    ic: clone(base),
    ...(variants && variants.length > 1
      ? { variants: variants.map(clone), name: getUserIc(tag)?.name ?? tag }
      : {}),
    addedAt: prior?.addedAt ?? new Date().toISOString(),
    source: prior?.source ?? source,
  };
  const entries = [...lib.entries];
  if (idx >= 0) entries[idx] = row;
  else entries.push(row);
  const next: UserLibrary = { v: 1, entries };
  saveLibrary(next);
  return next;
}

/** Remove a library row by its placeable tag. Does NOT unregister the kind (the caller decides whether
 * to keep it alive while placed — see App.svelte's delete flow / gap #7). Returns the updated library. */
export function removeFromLibrary(tag: string): UserLibrary {
  const lib = loadLibrary();
  const entries = lib.entries.filter((e) => rowTag(e) !== tag);
  const next: UserLibrary = { v: 1, entries };
  saveLibrary(next);
  return next;
}

/** Rename a library row's DISPLAY name (the bin card label) — display only; the `tag` is unchanged
 * (placed instances reference the tag, so it must stay stable). Re-derives `PART_KINDS[tag]`'s label
 * via re-registration of the updated def. Returns the updated library. */
export function renameLibraryIc(tag: string, name: string): UserLibrary {
  const lib = loadLibrary();
  const trimmed = name.trim();
  const entries = lib.entries.map((e) => {
    if (rowTag(e) !== tag || !trimmed) return e;
    const ic = { ...e.ic, name: trimmed };
    const updated: LibraryEntry = {
      ...e,
      ic,
      name: e.variants ? trimmed : e.name,
    };
    return updated;
  });
  const next: UserLibrary = { v: 1, entries };
  saveLibrary(next);
  // Refresh the live registration so the bin tile / placed-instance label re-derive from the new name.
  const row = entries.find((e) => rowTag(e) === tag);
  if (row) registerEntry(row);
  return next;
}

/**
 * Register every library IC into the live `PART_KINDS` / `REGISTRY` / `FAMILIES` at startup, so each
 * becomes a placeable kind BEFORE `loadBoard` / example restore (a restored board's placed library ICs
 * then resolve even if its embedded `userIcs` were trimmed). A reserved-tag row is skipped by the
 * underlying guards. A no-op (registers nothing) when the library is empty — so the golden is untouched.
 */
export function registerLibrary(): void {
  for (const e of libraryEntries()) registerEntry(e);
}

/** Register one library row: a family via {@link registerUserIcFamily} (its ordered variants), else a
 * single IC via {@link registerUserIc}. Reserved/empty guarded inside those. */
function registerEntry(e: LibraryEntry): void {
  if (e.variants && e.variants.length > 1) {
    registerUserIcFamily(rowTag(e), e.name ?? e.ic.name, e.variants);
  } else if (!isReservedTag(e.ic.tag)) {
    registerUserIc(e.ic);
  }
}

/** Whether a placeable tag currently has a library row (so the bin doesn't offer to re-add it, and a
 * board-load "add to library" diff can find the missing ones). */
export function inLibrary(tag: string): boolean {
  return loadLibrary().entries.some((e) => rowTag(e) === tag);
}

/** Register a batch of single-IC defs into the library store (the deferred import path's building
 * block). Kept callable for the export/import envelope work; unused by v1's auto-add flow. */
export function importToLibrary(defs: UserIc[]): UserLibrary {
  registerUserIcs(defs);
  let lib = loadLibrary();
  for (const d of defs) lib = addToLibrary(d.tag, "imported");
  return lib;
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

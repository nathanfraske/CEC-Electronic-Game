// SPDX-License-Identifier: Apache-2.0
// User-authored ICs (the IC maker, ADR 0006 / docs/ui/ic-maker-guide.md). A sealed IC is a circuit
// the player built inside a frame: the frame's pins are the package leads, and the components wired
// to them are the IC's internals. Sealing stores that inner circuit as a `UserIc` and registers a
// placeable kind (package footprint + pins). When a sealed IC is placed, `flattenUserIcs` inlines its
// inner circuit into the board BEFORE `buildNetlist` runs, fusing each frame pin to the placed
// instance's matching pin. So the sim sees the real discrete parts, wired exactly as authored — this
// is ADR 0005's "seal-as-same-netlist": the seal is bookkeeping, the netlist is the genuine circuit.
//
// Determinism: flattening is a pure graph->graph transform (deterministic id remap in sorted order);
// it is a strict no-op when no sealed IC is placed, so every existing circuit (and the golden) is
// byte-identical. Nesting is RECURSIVE: an inner circuit may itself place sealed ICs, inlined in waves
// to a fixed point (depth-guarded against reseal cycles). A board with no nesting settles in one wave,
// byte-identical to the old single pass — so existing circuits and the golden are unaffected.
import {
  BoardGraph,
  PART_KINDS,
  isJunctionRef,
  isPinRef,
  framePackage,
  type GraphSnapshot,
  type Endpoint,
  type PartKind,
  type Pin,
  type Wire,
  type Junction,
  type NetLabel,
} from "./graph";
import { packageLayout } from "./packages";

/** A sealed, user-authored IC. */
export interface UserIc {
  /** the placeable kind tag (e.g. an auto "CEC9001" or a free-form name). */
  tag: string;
  name: string;
  package: { archetype: string; pinCount: number };
  /** the frame component's id WITHIN `graph` — its pins are the package leads. */
  frameId: number;
  /** the inner circuit, INCLUDING the frame (the authored sub-graph). */
  graph: GraphSnapshot;
  /**
   * Optional per-pin user names by pin index (the die editor's named port pads): pin i's name
   * becomes the LABEL on the sealed chip's pin i. Sparse — an empty/absent slot falls back to the
   * package pin number in {@link userIcPartKind}. Pure presentation; never affects the netlist.
   */
  pinNames?: string[];
  /**
   * Bin role: `'ic'` (board-placeable, has a package + chosen pinout — the default and today's
   * behavior) vs `'subassembly'` (a bare, nested-only building block, hidden from the board parts bin
   * and offered only inside the die-editor place flow). Absent ⇒ `'ic'`. A subassembly reaches the
   * board only via **Tape out** (`tapeOut`), which chooses a package + pinout and flips it to `'ic'`.
   * Purely a bin filter — `flattenUserIcs`/`resolveUserIc`/the REGISTRY stay role-agnostic, so every
   * existing save is byte-identical and the netlist is never affected.
   */
  role?: "ic" | "subassembly";
}

/** tag -> sealed IC definition. Populated by `registerUserIc` (sealing / loading a saved library).
 * For a multi-variant family this holds the FAMILY tag (pointing at variant 0, so any variant-unaware
 * path still resolves a valid inner circuit) AND each derived child tag `"<family>#i"`. */
const REGISTRY = new Map<string, UserIc>();

/**
 * A VARIANT FAMILY: several sealed dies grouped under ONE placeable tag, picked per-instance via the
 * existing {@link Component.variant} axis (the same field diode families / LED colours use). A user IC
 * has no sim param block of its own — it flattens to discrete parts — so the variation IS the inner
 * graph: each variant carries its own `graph`, `frameId`, `package`, `pinNames`. v1 constrains every
 * variant in a family to share `package.archetype` + `package.pinCount` (footprint-stable switching).
 */
export interface UserIcFamily {
  /** the placeable kind tag (e.g. "INV") — registered in `PART_KINDS` + `REGISTRY` (-> variants[0]). */
  family: string;
  /** display name (the bin tile / inspector header). */
  name: string;
  /** ordered variant defs; variant INDEX = position; `variants[0]` is the default a fresh place gets.
   * Append-only in v1 (a new variant gets the highest index) so a saved board's integer `variant`
   * stays a durable reference — reordering would silently re-point every placed instance. */
  variants: UserIc[];
}

/** family tag -> family. A single-variant IC has NO row here (tag === family, resolves via REGISTRY),
 * keeping today's universal case byte-identical. */
const FAMILIES = new Map<string, UserIcFamily>();

/** Separator between a family tag and a variant index in the derived child tag (`"INV#0"`). Reserved:
 * a free-form seal name carrying it is rejected at capture time so it can't forge a child tag. */
const VARIANT_SEP = "#";

/** The derived child tag for variant `i` of `family` (e.g. ("INV", 1) -> "INV#1"). */
function variantChildTag(family: string, i: number): string {
  return family + VARIANT_SEP + i;
}

/** The next free variant child tag for a family: index = current variant count (append-only). */
export function nextVariantTag(family: string): string {
  const fam = FAMILIES.get(family);
  return variantChildTag(family, fam ? fam.variants.length : 1);
}

/** The variants of a multi-variant family, in order, or `null` for a plain (single) IC / unknown tag. */
export function userIcVariants(family: string): UserIc[] | null {
  return FAMILIES.get(family)?.variants ?? null;
}

/** Whether a tag is a multi-variant family (the inspector / arm-time variant picker gate). A
 * single-variant IC has just one entry and reports false, so it shows no picker. */
export function hasUserIcVariants(tag: string): boolean {
  return (FAMILIES.get(tag)?.variants.length ?? 0) > 1;
}

/** Every placeable user-IC tag that a NEW seal could become a variant of: the existing multi-variant
 * families AND every single IC (which a second "seal into" promotes to a family). For the seal panel's
 * "Variant of …" dropdown — `{ tag, name }` pairs, child tags excluded. */
export function userIcFamilyTargets(): { tag: string; name: string }[] {
  return userIcTags().map((tag) => ({
    tag,
    name: FAMILIES.get(tag)?.name ?? REGISTRY.get(tag)?.name ?? tag,
  }));
}

/**
 * Resolve a placed `(tag, variant)` to the concrete sealed def. For a family the index is CLAMPED to
 * the variant range (like {@link diodeVariant}) so a save referencing a variant a since-shrunk family
 * no longer has still resolves deterministically (to the last) rather than crashing. For a plain IC
 * the variant is ignored and the flat REGISTRY entry is returned — identical to the old
 * `REGISTRY.get(tag)`, so single-variant ICs stay byte-identical.
 */
export function resolveUserIc(tag: string, variant = 0): UserIc | undefined {
  const fam = FAMILIES.get(tag);
  if (fam) {
    const i = Math.max(
      0,
      Math.min(fam.variants.length - 1, Math.round(variant)),
    );
    return fam.variants[i];
  }
  return REGISTRY.get(tag);
}

/** The house auto-id counter for unnamed seals: the next number in the `CEC9xxx` series
 * (ADR 0006 / docs/ui/ic-maker-guide.md §6). Starts at 9001 and increments per auto-named
 * seal; bumped past any collision so an auto id never lands on a tag already in use. */
let autoSeq = 9001;

/** The next free `CEC9xxx` auto tag, skipping any already taken (manual reuse, a reload).
 * Advances {@link autoSeq} so successive unnamed seals get CEC9001, CEC9002, ... */
function nextAutoTag(): string {
  let tag = "CEC" + autoSeq;
  while (REGISTRY.has(tag) || PART_KINDS[tag]) {
    autoSeq++;
    tag = "CEC" + autoSeq;
  }
  autoSeq++;
  return tag;
}

/** The built-in part-kind tags, snapshotted at module load BEFORE any user IC registers — so the
 * reserved-tag guard can tell a real device kind (`R`, `V`, a frame like `SOT23_6`) from a player
 * seal name. `userIc.ts` imports `PART_KINDS` from `graph.ts`, which is fully populated at its own
 * module init (frames included), and no user IC is registered until a seal/load runs — so this set is
 * exactly the built-ins. */
const BUILTIN_TAGS: ReadonlySet<string> = new Set(Object.keys(PART_KINDS));

/** Whether `tag` would CLOBBER a built-in kind if registered: a built-in part kind (e.g. `R`) or an
 * internal die-frame tag. Used to guard {@link registerUserIcs} (loading embedded defs) — which MUST
 * still accept a legitimate `"<family>#i"` CHILD def, so it does NOT reject the `#` separator. */
function collidesWithBuiltin(tag: string): boolean {
  return BUILTIN_TAGS.has(tag) || tag.startsWith("__DIE_");
}

/**
 * Whether `tag` is RESERVED as a free-form seal / family NAME: it would clobber a built-in (see
 * {@link collidesWithBuiltin}) OR it carries the variant separator `#` (which would forge a family
 * child tag). The seal UI and import-name path refuse these (gap #8) so a player name can never
 * overwrite a built-in at startup or impersonate a variant child tag. (Distinct from the registration
 * guard, which DOES accept a real `#` child def.)
 */
export function isReservedTag(tag: string): boolean {
  return collidesWithBuiltin(tag) || tag.includes(VARIANT_SEP);
}

/** Whether a kind tag is a sealed user IC (a flatten-on-build composite, no sim element of its own). */
export function isUserIc(tag: string): boolean {
  return REGISTRY.has(tag);
}

/** The sealed IC for a tag, or undefined. */
export function getUserIc(tag: string): UserIc | undefined {
  return REGISTRY.get(tag);
}

/** All PLACEABLE sealed-IC tags (for the part bin / persistence): every plain single-variant tag plus
 * each multi-variant FAMILY tag, but NOT the internal `"<family>#i"` child tags (those are an
 * implementation detail of the family — the player places the family tile and picks a variant). */
export function userIcTags(): string[] {
  return [...REGISTRY.keys()].filter((t) => !t.includes(VARIANT_SEP));
}

/** Cells each lead tip is pushed OUT past the body, so the package body sits INSIDE the ring of leads
 * and the leads are the connection points (board wires land on the tips), freeing the whole interior. */
const LEAD_GAP = 1;

/** Build the placeable `PartKind` for a sealed IC from its package (footprint + numbered pins).
 * Each pin's LABEL is the player's name for that lead ({@link UserIc.pinNames} by index) when set,
 * else the package pin number — so a sealed chip shows the names the author gave its pads. */
function userIcPartKind(ic: UserIc): PartKind {
  const lay = packageLayout(ic.package.archetype, ic.package.pinCount);
  // Push each pad OUT past the package's array (long) edge by LEAD_GAP, so the pad becomes the outer LEAD
  // TIP and the body card sits inside the ring (render-only — the seal maps pins by INDEX, not position).
  let minDx = Infinity;
  let maxDx = -Infinity;
  let minDy = Infinity;
  let maxDy = -Infinity;
  for (const p of lay.pins) {
    minDx = Math.min(minDx, p.dx);
    maxDx = Math.max(maxDx, p.dx);
    minDy = Math.min(minDy, p.dy);
    maxDy = Math.max(maxDy, p.dy);
  }
  const alongX = maxDx - minDx >= maxDy - minDy;
  const pushed = lay.pins.map((p) => {
    let dx = p.dx;
    let dy = p.dy;
    if (alongX) {
      if (p.dy === minDy) dy -= LEAD_GAP;
      else if (p.dy === maxDy) dy += LEAD_GAP;
    } else {
      if (p.dx === minDx) dx -= LEAD_GAP;
      else if (p.dx === maxDx) dx += LEAD_GAP;
    }
    return { dx, dy, number: p.number };
  });
  const shiftX = Math.min(...pushed.map((p) => p.dx));
  const shiftY = Math.min(...pushed.map((p) => p.dy));
  const pins: Pin[] = pushed.map((p, i) => {
    const named = ic.pinNames?.[i]?.trim();
    return {
      index: i,
      label: named ? named : String(p.number),
      dx: p.dx - shiftX,
      dy: p.dy - shiftY,
    };
  });
  const w = pins.reduce((m, p) => Math.max(m, p.dx), 0) + 1;
  const h = pins.reduce((m, p) => Math.max(m, p.dy), 0) + 1;
  // accent-tinted so a sealed user IC reads as a distinct (player-made) part; no value/unit, and
  // deliberately absent from TYPE_OF so buildNetlist treats the placed instance as a no-element hub.
  return {
    tag: ic.tag,
    name: ic.name,
    colorKey: "accent",
    pins,
    w,
    h,
    defaultValue: 0,
    unit: "",
    ideal: true,
  };
}

/** Register a sealed IC: store its definition and make it a placeable kind. Idempotent per tag. */
export function registerUserIc(ic: UserIc): void {
  REGISTRY.set(ic.tag, ic);
  PART_KINDS[ic.tag] = userIcPartKind(ic);
}

/** Forget a sealed IC (and unregister its kind). When `tag` is a multi-variant FAMILY, this cascades:
 * the family tag's own REGISTRY/PART_KINDS entry, every child `"<family>#i"` REGISTRY entry, and the
 * FAMILIES row are all dropped (else the child defs would linger as orphans). A plain IC just drops
 * its single entry. */
export function unregisterUserIc(tag: string): void {
  const fam = FAMILIES.get(tag);
  if (fam) {
    for (let i = 0; i < fam.variants.length; i++)
      REGISTRY.delete(variantChildTag(tag, i));
    FAMILIES.delete(tag);
  }
  REGISTRY.delete(tag);
  delete PART_KINDS[tag];
}

/**
 * Re-seal an EXISTING sealed IC in place: swap its authored inner circuit (and the pin names derived
 * from the new die frame) while keeping its `tag`, display `name`, and `package`. Used by the die
 * editor's "Reseal" path (re-opening a placed sealed chip, editing its die, sealing again): every
 * placed instance of `tag` updates because {@link registerUserIc} re-derives `PART_KINDS[tag]` and
 * `flattenUserIcs` reads the registry's `graph` at build time. A no-op if `tag` is unknown (nothing
 * to re-seal). `pinNames` may be passed (the new frame's per-pin names) or omitted to clear them.
 *
 * Distinct from re-running {@link captureSeal} with the tag as the NAME: that would also overwrite
 * the entry, but it forces `name === tag`, losing a free-form display name. This preserves it.
 */
export function resealUserIc(
  tag: string,
  graph: GraphSnapshot,
  frameId: number,
  pinNames?: string[],
): void {
  const prev = REGISTRY.get(tag);
  if (!prev) return;
  const keep = pinNames && pinNames.some((n) => n && n.trim());
  registerUserIc({
    tag: prev.tag,
    name: prev.name,
    package: prev.package,
    frameId,
    graph,
    ...(keep ? { pinNames: [...pinNames] } : {}),
  });
}

/**
 * The sealed-IC definitions for every DISTINCT user-IC kind actually PLACED in `graph`, so a saved
 * board can embed exactly the ICs it uses (and round-trip them — a {@link UserIc} is plain JSON).
 * Reads each placed instance's `kind` and, when it's a registered user IC, returns its definition
 * once. Returns `[]` when the board places no sealed IC (so a normal save carries no `userIcs`).
 */
export function userIcsForGraph(graph: GraphSnapshot): UserIc[] {
  const out: UserIc[] = [];
  const seen = new Set<string>();
  // Collect the placed ICs AND, transitively, every IC NESTED inside a collected IC's die — because a
  // board places only its top-level ICs (a nested INNER lives solely inside OUTER's graph, never as a
  // board component). Without the descent, a save embedding OUTER but not INNER couldn't be flattened
  // after a fresh-session reload (INNER unregistered -> its hub never expands -> the inner parts vanish).
  //
  // For a FAMILY, emit ALL its variants (the player may switch variants offline after reload, so every
  // variant's discrete parts must travel) and recurse into EACH variant's die. Dedup is keyed on the
  // RESOLVED child tag of every variant we push (gap #3) — NOT the family tag — so descending into
  // variant 1..n isn't skipped after variant 0. The flat single-IC case dedups by the plain tag.
  // `seen` also bounds a reseal cycle (A in B in A: the second A's tag is already seen). A board with
  // no IC returns []; one with only single-level single-variant ICs returns exactly the placed defs,
  // so existing saves are byte-identical.
  const pushDef = (key: string, def: UserIc): void => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(def);
    scan(def.graph.components); // descend into this def's die for deeper nested ICs
  };
  const scan = (comps: { kind: string }[]): void => {
    for (const c of comps) {
      const fam = FAMILIES.get(c.kind);
      if (fam) {
        fam.variants.forEach((v, i) => pushDef(variantChildTag(c.kind, i), v));
        continue;
      }
      const def = REGISTRY.get(c.kind);
      if (def) pushDef(c.kind, def);
    }
  };
  scan(graph.components);
  return out;
}

/**
 * The OPTIONAL family sidecar for a saved board: for every PLACED multi-variant family, its display
 * `name` and the ORDERED `variantTags` array — the durable source of truth for variant order. A
 * placed instance persists `variant` as an INTEGER INDEX, so `variantTags[index]` is the def it
 * resolves to; {@link registerUserIcFamilies} rebuilds `variants[]` in exactly this order on load
 * (gap #4). Single-variant boards get `[]` (the caller omits the sidecar), keeping existing saves and
 * the golden byte-identical. Scans transitively (a nested family inside a placed die also rounds-trips).
 */
export interface UserIcFamilySidecar {
  family: string;
  name: string;
  /** the child tags `"<family>#0"`, `"<family>#1"`, … IN ORDER (index = variant index). */
  variantTags: string[];
}

export function userIcFamiliesForGraph(
  graph: GraphSnapshot,
): UserIcFamilySidecar[] {
  const out: UserIcFamilySidecar[] = [];
  const seen = new Set<string>();
  const scan = (comps: { kind: string }[]): void => {
    for (const c of comps) {
      const fam = FAMILIES.get(c.kind);
      if (!fam || seen.has(c.kind)) continue;
      seen.add(c.kind);
      out.push({
        family: fam.family,
        name: fam.name,
        variantTags: fam.variants.map((_, i) => variantChildTag(c.kind, i)),
      });
      // Recurse into each variant's die so a nested family inside this family also round-trips.
      for (const v of fam.variants) scan(v.graph.components);
    }
  };
  scan(graph.components);
  return out;
}

/** Register a batch of sealed-IC definitions (from a save's embedded library). Idempotent — each
 * just calls {@link registerUserIc}, so re-loading a board re-installs its ICs (overwriting any
 * same-tag user-IC entry with the saved one — the intended reseal-on-reload path). A def whose tag is
 * RESERVED (a built-in kind, a die-frame, a `#` child tag) is SKIPPED rather than allowed to clobber a
 * built-in `PART_KINDS` entry (gap #6/#8 clobber-safety); the full import re-tag prompt is deferred.
 * A no-op on an empty/absent list. */
export function registerUserIcs(defs: UserIc[]): void {
  for (const ic of defs) {
    // A `"<family>#i"` child def IS legitimate here (it's a family variant being restored from the
    // embed) — only refuse a def that would clobber a BUILT-IN kind (gap #6/#8 clobber-safety). The
    // full import re-tag prompt is deferred.
    if (collidesWithBuiltin(ic.tag)) {
      console.warn(
        `registerUserIcs: skipped IC with reserved tag "${ic.tag}" (collides with a built-in kind); placed instances of it won't expand. Re-tag the IC before saving.`,
      );
      continue;
    }
    registerUserIc(ic);
  }
}

/**
 * Append a new variant to a family, PROMOTING a single IC into a multi-variant family on the first
 * append (gap #5 — append-only: the new variant always gets the HIGHEST index; `variants[0]` stays the
 * default). On the FIRST append, the existing single IC registered under `family` becomes `variants[0]`
 * (its def re-registered under the child tag `"<family>#0"`), the new def becomes `"<family>#1"`, the
 * family tag is registered in `PART_KINDS` (one bin tile) and in `REGISTRY` -> `variants[0]` (so any
 * variant-unaware path still resolves a valid inner circuit), and a `FAMILIES` row is created. On a
 * later append the new def just gets the next child index.
 *
 * v1 constraint (footprint-stable switching): the new variant MUST share the family's
 * `package.archetype` + `package.pinCount`; a mismatch is REFUSED (returns `false`, registers nothing)
 * so the placed instance's footprint never has to re-derive on a variant switch. Returns `true` on a
 * successful append. Returns `false` (no-op) if `family` is unknown.
 */
export function appendUserIcVariant(family: string, variant: UserIc): boolean {
  let fam = FAMILIES.get(family);
  // First append: bootstrap the family from the existing single IC under `family`. The base def's own
  // tag is the FAMILY tag; re-home it as variant 0 under the child tag "<family>#0" (tag rewritten),
  // so EVERY variant def carries its child tag — `userIcsForGraph` then embeds child-tagged defs and
  // the family round-trips (registerUserIcFamilies finds "<family>#0" in REGISTRY on reload).
  if (!fam) {
    const base = REGISTRY.get(family);
    if (!base) return false;
    if (
      variant.package.archetype !== base.package.archetype ||
      variant.package.pinCount !== base.package.pinCount
    )
      return false;
    const child0: UserIc = { ...base, tag: variantChildTag(family, 0) };
    fam = { family, name: base.name, variants: [child0] };
    FAMILIES.set(family, fam);
    REGISTRY.set(child0.tag, child0);
  } else {
    const ref = fam.variants[0];
    if (
      variant.package.archetype !== ref.package.archetype ||
      variant.package.pinCount !== ref.package.pinCount
    )
      return false;
  }
  const childTag = variantChildTag(family, fam.variants.length);
  const child: UserIc = { ...variant, tag: childTag };
  fam.variants.push(child);
  REGISTRY.set(childTag, child);
  // Register the family tag's tile + variants[0] resolution (so a variant-unaware path resolves a valid
  // inner circuit). variants[0] now carries its child tag, so re-tag it back to the family tag for the
  // family-tag REGISTRY entry's display/footprint derivation.
  PART_KINDS[family] = userIcPartKind({ ...fam.variants[0], tag: family });
  REGISTRY.set(family, fam.variants[0]);
  return true;
}

/**
 * Regroup a board's embedded variant defs into `FAMILIES` from the save sidecar (companion to
 * {@link registerUserIcs}, which already registered the flat defs incl. the child tags). For each
 * sidecar entry it rebuilds `variants[]` in EXACTLY the sidecar's `variantTags` ORDER (the durable
 * source of truth — index = variant index, gap #4), registers the family tag's `PART_KINDS` tile +
 * `REGISTRY` -> `variants[0]`, and creates the `FAMILIES` row. A sidecar entry whose family tag is
 * reserved, or any of whose variant child defs are missing from `REGISTRY`, is skipped (it can't be
 * grouped). A no-op on an empty/absent sidecar — so single-variant boards and the golden are
 * unaffected.
 */
export function registerUserIcFamilies(sidecar?: UserIcFamilySidecar[]): void {
  if (!sidecar) return;
  for (const s of sidecar) {
    if (isReservedTag(s.family)) continue;
    const variants: UserIc[] = [];
    let ok = true;
    for (const childTag of s.variantTags) {
      const def = REGISTRY.get(childTag);
      if (!def) {
        ok = false;
        break;
      }
      variants.push(def);
    }
    if (!ok || variants.length === 0) continue;
    FAMILIES.set(s.family, { family: s.family, name: s.name, variants });
    PART_KINDS[s.family] = userIcPartKind({ ...variants[0], tag: s.family });
    REGISTRY.set(s.family, variants[0]);
  }
}

/**
 * Register a multi-variant family ATOMICALLY from its ordered variant defs — for the persistent
 * library, which carries a family's variant defs together (rather than as a sidecar over a flat embed).
 * Re-tags each variant under its child tag `"<family>#i"` (so the ORDER is the durable source of truth,
 * gap #4), installs each child in `REGISTRY`, registers the family `PART_KINDS` tile + `REGISTRY` ->
 * variants[0], and creates the `FAMILIES` row. Refuses a reserved family tag or an empty variant list
 * (no-op). The variant defs' own `tag` fields are ignored (overwritten with the child tags).
 */
export function registerUserIcFamily(
  family: string,
  name: string,
  variants: UserIc[],
): void {
  if (isReservedTag(family) || variants.length === 0) return;
  const children = variants.map((v, i) => ({
    ...v,
    tag: variantChildTag(family, i),
  }));
  for (const child of children) REGISTRY.set(child.tag, child);
  FAMILIES.set(family, { family, name, variants: children });
  PART_KINDS[family] = userIcPartKind({ ...children[0], tag: family });
  REGISTRY.set(family, children[0]);
}

/** One flatten record: the placed instance id, the id offset its inner parts were inlined at, and
 * its kind tag. Collected via the optional `sink` of {@link flattenUserIcs} so a render-only caller
 * (the zoom-to-open mini-board) can map an inner component's authored id (`innerId`) to its
 * flattened netlist id (`innerId + offset`) and read its live state — WITHOUT changing the flatten's
 * element output. */
export interface FlattenRecord {
  /** the placed sealed-IC component id (the instance on the outer board). */
  instanceId: number;
  /** the id offset its inner components/wires/junctions were inlined at (a multiple of STRIDE). */
  offset: number;
  /** the instance's kind tag (keys {@link getUserIc}). */
  tag: string;
}

/**
 * Inline every placed sealed-IC instance's inner circuit into a copy of `graph`, ready for
 * `buildNetlist`. For each instance: its inner components/wires are added with offset ids, and each
 * inner wire that touched the frame is re-pointed at the placed instance's matching pin — so the
 * external board net and the inner net become one (the pad-to-lead fusion). The instance itself stays
 * as a no-element hub (its kind has no `TYPE_OF`). A strict no-op (returns the input) when no sealed
 * IC is placed, so normal circuits are unaffected.
 *
 * The optional `sink` is filled with one {@link FlattenRecord} per processed instance (in id order),
 * exposing each instance's id offset to a render-only caller without altering the returned graph or
 * the element arrays it compiles to. When there are no sealed ICs the early no-op return leaves
 * `sink` untouched (empty) and returns the input unchanged — so the element output stays
 * byte-identical to today in every case.
 */
export function flattenUserIcs(
  graph: BoardGraph,
  sink?: FlattenRecord[],
): BoardGraph {
  let any = false;
  for (const c of graph.components.values()) {
    // Membership widened to families (gap): a placed FAMILY tag is also a flattenable user IC. Both
    // REGISTRY and FAMILIES are EMPTY for the golden (it places no user IC), so the early no-op return
    // below still fires and the input graph is returned byte-identical.
    if (REGISTRY.has(c.kind) || FAMILIES.has(c.kind)) {
      any = true;
      break;
    }
  }
  if (!any) return graph;

  const snap = graph.serialize();
  const comps = [...snap.components];
  const wires = [...snap.wires];
  const junctions = [...(snap.junctions ?? [])];

  // Deterministic per-instance id offset. The base sits well above any realistic hand/saved id; each
  // PROCESSED instance gets its own STRIDE-sized private range so inlined ids never collide — and since
  // `off` only ever increases, that holds ACROSS recursion levels too.
  const STRIDE = 1_000_000;
  let off = STRIDE;

  // Recursive nesting: an inner circuit may itself place sealed ICs, so we inline in WAVES to a fixed
  // point. Each wave inlines the user-IC instances NOT yet flattened (in id order) — which may surface
  // deeper nested instances (their kind is still a user-IC tag) for the next wave. `flattened` stops an
  // already-inlined hub from being re-processed.
  //
  // Two bounds keep this safe. `MAX_DEPTH` caps the wave count (one nesting level per wave) — generous
  // for any real hierarchy (a LUT->SRAM->inverter is ~4-6 deep) while bounding a RESEAL cycle's descent.
  // `MAX_INSTANCES` is the HARD budget on total inlined instances: flatten runs on EVERY netlist rebuild,
  // so a pathological geometric fan-out (k nested ICs per level -> ~k^depth) or a cycle must not freeze
  // the per-edit build. On hitting either bound the deepest instances are left as no-element hubs and we
  // warn once — a silently truncated netlist would read as "your inner parts vanished" with no clue.
  //
  // A board with NO nesting settles in ONE wave: wave 1's `pending` equals the old single-pass instance
  // list (same id order, same offsets), neither bound bites, and the `maxId` guard below is inert for the
  // small authored ids real circuits use — so the element output (and the golden) is byte-identical.
  const flattened = new Set<number>();
  const MAX_DEPTH = 24;
  const MAX_INSTANCES = 4096;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const pending = comps
      .filter(
        (c) =>
          (REGISTRY.has(c.kind) || FAMILIES.has(c.kind)) &&
          !flattened.has(c.id),
      )
      .sort((a, b) => a.id - b.id);
    if (pending.length === 0) break;
    for (const inst of pending) {
      if (flattened.size >= MAX_INSTANCES) break;
      flattened.add(inst.id);
      // Resolve the placed (familyTag, variant) to the concrete sealed def — a pure graph->graph choice
      // BEFORE buildNetlist. For a plain single-variant IC `resolveUserIc` returns the same def the old
      // `REGISTRY.get(inst.kind)` did (so byte-identical); for a family it picks (and clamps) the
      // variant. The instance carries `variant` as a persisted integer index (default 0).
      const inst2 = inst as { variant?: number };
      const def = resolveUserIc(inst.kind, inst2.variant ?? 0);
      if (!def) continue;
      const inner = def.graph;
      const o = off;
      off += STRIDE;
      // Expose this instance's id offset to a render-only caller (the zoom-to-open mini-board); for a
      // nested instance `inst.id` is its already-inlined (offset) id. Pushing here does NOT touch the
      // element arrays the flatten compiles to — only the render-side mapping — so the netlist crossing
      // the wasm boundary (and the golden) is unchanged. The tag is the RESOLVED tag (a family's child
      // tag `"INV#i"`, else the plain tag) so the render-side `getUserIc(rec.tag)` resolves THIS
      // variant's authored sub-graph, not variant 0's.
      sink?.push({ instanceId: inst.id, offset: o, tag: def.tag });
      // An inner endpoint -> outer: the frame's pins become the (already-placed) instance's pins (same
      // index); every other inner component/junction is offset into this instance's private id range.
      // For a NESTED instance, `inst.id` is its inlined hub id, so the child's frame pins fuse onto that
      // hub — which the parent's inner wiring already connected to — tying the two levels on one net.
      const remap = (e: Endpoint): Endpoint =>
        isJunctionRef(e)
          ? { junctionId: e.junctionId + o }
          : {
              componentId:
                e.componentId === def.frameId ? inst.id : e.componentId + o,
              pinIndex: e.pinIndex,
            };
      let maxId = 0;
      for (const ic of inner.components) {
        if (ic.id === def.frameId) continue; // the frame is replaced by the placed instance
        const id = ic.id + o;
        comps.push({ ...ic, id, cell: { ...ic.cell } });
        if (id > maxId) maxId = id;
      }
      for (const j of inner.junctions ?? []) {
        const id = j.id + o;
        junctions.push({ ...j, id, cell: { ...j.cell } });
        if (id > maxId) maxId = id;
      }
      for (const w of inner.wires) {
        const id = w.id + o;
        wires.push({
          id,
          from: remap(w.from),
          to: remap(w.to),
          ...(w.waypoints && w.waypoints.length > 0
            ? { waypoints: w.waypoints.map((c) => ({ ...c })) }
            : {}),
        });
        if (id > maxId) maxId = id;
      }
      // Keep every instance's id range disjoint even if an authored inner id was >= STRIDE (only
      // reachable via a crafted snapshot — authored ids are small + never compacted): bump `off` past
      // everything just inlined so the next instance can't reuse one of these ids. Inert (maxId < off)
      // for normal ids, so the no-nesting / single-level output stays byte-identical.
      if (maxId >= off) off = maxId + 1;
    }
    if (flattened.size >= MAX_INSTANCES) break;
  }
  // If user-IC instances remain unflattened, a bound was hit (an over-deep / over-wide hierarchy or a
  // reseal cycle): the deepest cells are no-element hubs, so their inner parts are absent from this
  // netlist. Surface it rather than emit a silently-wrong circuit.
  if (
    comps.some(
      (c) =>
        (REGISTRY.has(c.kind) || FAMILIES.has(c.kind)) && !flattened.has(c.id),
    )
  ) {
    console.warn(
      `flattenUserIcs: IC nesting exceeded the flatten budget (MAX_DEPTH=${MAX_DEPTH}, MAX_INSTANCES=${MAX_INSTANCES}); deepest cells were left unexpanded (their inner parts are absent from this netlist). Check for a reseal cycle or an excessively deep/wide nesting.`,
    );
  }

  const out = new BoardGraph();
  out.restore({
    ...snap,
    components: comps,
    wires,
    junctions,
    nextComponentId: off,
    nextWireId: off,
    nextJunctionId: off,
  });
  return out;
}

/** What {@link captureSeal} sealed: the new IC's `tag` plus the LIVE-graph ids it consumed,
 * so the caller (board.ts) can collapse the frame + its circuit — delete those, drop a placed
 * instance of `tag` where the frame sat, and re-point any external wires onto the instance. */
export interface SealCapture {
  /** the placeable kind tag the seal registered (the auto `CEC9xxx`, or the chosen name). */
  tag: string;
  /** ids of the live components folded INTO the IC (the frame + all its wired internals). */
  capturedComponentIds: number[];
  /** ids of the live wires folded into the IC (a wire with BOTH ends inside the capture). */
  capturedWireIds: number[];
  /** ids of the live junctions folded into the IC (every junction reached by the BFS). */
  capturedJunctionIds: number[];
  /** the cell the frame occupied — where the collapsed instance should land. */
  frameCell: { col: number; row: number };
}

/**
 * Capture the circuit a player built inside a frame as a sealed {@link UserIc}, ready to place.
 *
 * Starting at the frame, a breadth-first search walks the board's WIRES (through junctions) to
 * gather the connected sub-graph — the frame plus every component, wire, and junction reachable
 * from its pins. That set IS the IC's internals; its frame pins are the package leads. The
 * sub-graph is snapshotted verbatim (ids preserved, so `frameId` still addresses the frame), the
 * package is read back from the frame's kind via {@link framePackage}, and the seal is registered
 * (which makes `tag` a placeable kind). Returns the {@link SealCapture} the board uses to collapse
 * the live graph (it does NOT mutate `graph` — capture is read-only; the board does the removal +
 * instance placement so the whole thing is one undo step).
 *
 * `name` is the free-form part name; omitted, it auto-assigns the next house `CEC9xxx` id (and the
 * tag matches). A free-form `name` that collides with a RESERVED tag (a built-in kind like `R`, a
 * die-frame, or one carrying `#`) is REFUSED (returns undefined) so a seal can never clobber a
 * built-in at startup (gap #8). Returns undefined if `frameId` isn't a live frame component.
 *
 * `intoFamily` (optional): append the captured def as a NEW VARIANT of an existing family instead of
 * registering a fresh top-level tag (the seal-as-variant-of flow, §4.3). The captured package must
 * match the family's (v1 same-package constraint) or the append is REFUSED (returns undefined); on
 * success the {@link SealCapture} carries the FAMILY tag (the placeable kind), so the board collapses
 * the frame to the family tile (variant 0 default; the author can switch in the inspector).
 *
 * NB: connectivity here is the physical wire graph (the v1 authoring model — ICs are built
 * standalone). A net-label GLOBAL alias (two same-named labels with no wire between them) is not a
 * traversal edge, so a sub-circuit joined only by such an alias would not be pulled in; that is an
 * out-of-scope authoring style for now. Labels sitting ON captured endpoints are carried along so
 * their net names survive the round-trip.
 */
export function captureSeal(
  graph: BoardGraph,
  frameId: number,
  name?: string,
  intoFamily?: string,
  role?: "ic" | "subassembly",
): SealCapture | undefined {
  const frame = graph.components.get(frameId);
  if (!frame) return undefined;
  const pkg = framePackage(frame.kind);
  if (!pkg) return undefined; // not a frame kind -> nothing to seal

  // BFS over the physical graph: components and junctions are the nodes; a wire is an edge
  // between its two endpoints. Seed with the frame; pull in whatever each frontier node's wires
  // reach. Junctions are nodes too (a wire-to-wire tie), so a circuit joined through a junction
  // dot is captured whole.
  const comps = new Set<number>([frameId]);
  const juncs = new Set<number>();
  const wireIds = new Set<number>();
  const wires = [...graph.wires.values()];

  // The component / junction an endpoint belongs to (a pin -> its component; a junction -> itself),
  // so a wire can be followed from either side.
  const endComp = (e: Endpoint): number | undefined =>
    isPinRef(e) ? e.componentId : undefined;
  const endJunc = (e: Endpoint): number | undefined =>
    isJunctionRef(e) ? e.junctionId : undefined;

  // Repeat the relaxation until no new node is reached. Each pass scans every wire and, if one of
  // its ends is already inside the set, adds the other end's node (and marks the wire captured).
  let grew = true;
  while (grew) {
    grew = false;
    for (const w of wires) {
      const fc = endComp(w.from);
      const fj = endJunc(w.from);
      const tc = endComp(w.to);
      const tj = endJunc(w.to);
      const fromIn =
        (fc !== undefined && comps.has(fc)) ||
        (fj !== undefined && juncs.has(fj));
      const toIn =
        (tc !== undefined && comps.has(tc)) ||
        (tj !== undefined && juncs.has(tj));
      if (!fromIn && !toIn) continue;
      if (!wireIds.has(w.id)) {
        wireIds.add(w.id);
        grew = true;
      }
      // Pull the not-yet-seen node on each end into the set.
      for (const [c, j] of [
        [fc, fj],
        [tc, tj],
      ] as const) {
        if (c !== undefined && !comps.has(c)) {
          comps.add(c);
          grew = true;
        }
        if (j !== undefined && !juncs.has(j)) {
          juncs.add(j);
          grew = true;
        }
      }
    }
  }

  // Snapshot just the captured nodes/edges, preserving ids (so `frameId` still points at the frame
  // and the inner ids match the wires' endpoint refs). Build it off a full serialize, then filter.
  const full = graph.serialize();
  const capComps = full.components
    .filter((c) => comps.has(c.id))
    .map((c) => ({
      ...c,
      cell: { ...c.cell },
      ...(c.pinNames ? { pinNames: [...c.pinNames] } : {}),
    }));
  const capJuncs: Junction[] = (full.junctions ?? [])
    .filter((j) => juncs.has(j.id))
    .map((j) => ({
      id: j.id,
      cell: { ...j.cell },
      ...(j.free ? { free: true } : {}),
    }));
  const capWires: Wire[] = full.wires
    .filter((w) => wireIds.has(w.id))
    .map((w) => ({
      id: w.id,
      from: { ...w.from },
      to: { ...w.to },
      ...(w.waypoints && w.waypoints.length > 0
        ? { waypoints: w.waypoints.map((c) => ({ ...c })) }
        : {}),
    }));
  // Carry along any net labels anchored ON a captured endpoint (so the inner nets keep their
  // names); a label whose anchor is outside the capture is left on the board.
  const capLabels: NetLabel[] = (full.netLabels ?? [])
    .filter((l) => {
      const c = endComp(l.at);
      const j = endJunc(l.at);
      return (
        (c !== undefined && comps.has(c)) || (j !== undefined && juncs.has(j))
      );
    })
    .map((l) => ({
      id: l.id,
      name: l.name,
      at: { ...l.at },
      ...(l.pos ? { pos: { ...l.pos } } : {}),
      ...(l.tagOff ? { tagOff: { ...l.tagOff } } : {}),
      ...(l.color !== undefined ? { color: l.color } : {}),
    }));

  // Id counters that clear every captured id, so the snapshot is a self-consistent graph.
  const maxId = (ids: number[]): number =>
    ids.reduce((m, id) => Math.max(m, id), 0);
  const snapshot: GraphSnapshot = {
    components: capComps,
    wires: capWires,
    junctions: capJuncs,
    netLabels: capLabels,
    nextComponentId: maxId(capComps.map((c) => c.id)) + 1,
    nextWireId: maxId(capWires.map((w) => w.id)) + 1,
    nextJunctionId: maxId(capJuncs.map((j) => j.id)) + 1,
    nextNetLabelId: maxId(capLabels.map((l) => l.id)) + 1,
  };

  // The player's per-pin names live on the frame component (the die editor's named port pads);
  // carry them onto the sealed IC so its placed instance shows them as pin labels.
  const framePinNames = frame.pinNames;
  const trimmed = name && name.trim() ? name.trim() : "";
  // Reserved-tag guard (gap #8): a free-form name colliding with a built-in / die-frame / `#` tag is
  // refused so registerLibrary() can never clobber a built-in kind at startup.
  if (trimmed && isReservedTag(trimmed)) return undefined;
  const pinNamesField =
    framePinNames && framePinNames.some((n) => n && n.trim())
      ? { pinNames: [...framePinNames] }
      : {};

  // Seal-as-variant-of: append to an existing family (same-package-constrained) instead of a fresh
  // top-level tag. On success the placed instance is the FAMILY tag (variant 0 default).
  if (intoFamily) {
    const ok = appendUserIcVariant(intoFamily, {
      tag: trimmed || intoFamily, // overwritten with the child tag inside appendUserIcVariant
      name: trimmed || intoFamily,
      package: pkg,
      frameId,
      graph: snapshot,
      ...pinNamesField,
    });
    if (!ok) return undefined; // unknown family or a package mismatch (v1 same-package constraint)
    return {
      tag: intoFamily,
      capturedComponentIds: [...comps],
      capturedWireIds: [...wireIds],
      capturedJunctionIds: [...juncs],
      frameCell: { col: frame.cell.col, row: frame.cell.row },
    };
  }

  const tag = trimmed || nextAutoTag();
  registerUserIc({
    tag,
    name: trimmed || tag,
    package: pkg,
    frameId,
    graph: snapshot,
    ...pinNamesField,
    // role defaults to 'ic' (absent) so every existing seal/save is byte-identical; only a free-form
    // box-capture (P4) passes 'subassembly'. A package-authored seal stays board-placeable directly.
    ...(role && role !== "ic" ? { role } : {}),
  });

  return {
    tag,
    capturedComponentIds: [...comps],
    capturedWireIds: [...wireIds],
    capturedJunctionIds: [...juncs],
    frameCell: { col: frame.cell.col, row: frame.cell.row },
  };
}

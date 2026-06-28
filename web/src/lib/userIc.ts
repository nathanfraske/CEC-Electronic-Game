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
  endpointKey,
  framePackage,
  frameTag,
  dieFrameTag,
  registerFreeFormFrame,
  unregisterFreeFormFrame,
  freeFormGeom,
  isFreeFormFrame,
  isFrame,
  FREE_FORM_DIE_PREFIX,
  type GraphSnapshot,
  type Endpoint,
  type PartKind,
  type Pin,
  type PinRole,
  type PinTest,
  type Wire,
  type Junction,
  type NetLabel,
  type FreeFormGeom,
  type Cell,
} from "./graph";
import { packageLayout, BLOCK_ARCHETYPE, BLOCK_MAX_PINS } from "./packages";
import { analyzeCell } from "./cellAnalysis";

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
  /**
   * Optional SEMANTIC pin roles by pin index ({@link PinRole}: in / out / vcc / gnd / clk) — what each
   * pin *is*, read by Tape-out (net→pad mapping) and the characterization sweep (drive vs observe).
   * Sparse/absent ⇒ unknown (callers fall back to name/stimulus heuristics). Derived at capture from the
   * frame's authoring stimuli + pin names ({@link derivePinRoles}); pure metadata, never affects the
   * netlist (the `pinNames` pattern).
   */
  pinRoles?: PinRole[];
  /**
   * Optional FREE-FORM box geometry (§4.10) for a box-captured subassembly: the box `w×h` (cells) and
   * each pin's box-relative cell, so the cell is a faithful 1:1 copy of the selection with pins where
   * wires crossed the boundary — NOT a stock package layout. When present, {@link userIcPartKind} builds
   * the placeable footprint from this (not `package`), and a free-form die-frame is registered for it
   * ({@link registerFreeFormFrame}) so the die editor + walls match the box. Persistent so the kind can
   * be re-registered on load; `package` is kept too (archetype BLOCK) for the bin label + the tint.
   */
  freeForm?: FreeFormGeom;
  /**
   * Optional CHARACTERIZED BEHAVIOR (§2.3, the characterization engine): once a small combinational/
   * registered cell has been SWEPT into a truth-table word, this stores the cheap face it can collapse to
   * — a prog-4 LUT. Absent ⇒ the cell always flattens to its real discrete parts (today's behavior). When
   * present AND a placed instance opts into the behavioral fidelity, `flattenUserIcs` emits ONE
   * `ELEM_BEHAVIORAL` LUT (the word in `aux`) instead of inlining the FETs. `sig` content-addresses the
   * inner graph the word was extracted from, so a reseal that changes the logic drops the stale word.
   * Golden-safe: the golden places no user IC, and a combinational LUT folds an all-zero state block.
   */
  behavior?: CellBehavior;
  /**
   * Optional EXPLICIT schematic-symbol id chosen by the player (a `drawCellSymbol` id — a gate name or a
   * `CellSymbolId`: DFF/DLATCH/REG/HADD/FADD/MUX/TRI/ARRAY/AND/…). Absent ⇒ Auto (the recognized face from
   * {@link cellSymbol}). Pure presentation — never affects the netlist, never hashed, never crosses the
   * wasm boundary (the `pinNames` pattern); it WINS over auto-detection in `cellSymbol`.
   */
  symbol?: string;
}

/**
 * The characterized cheap face of a cell (§2.3) — what a swept gate collapses to. `prog` is the behavioral
 * program id (4 = LUT today, the only one the sweep emits); `word` is the ≤4-input truth table (16 bits,
 * `out = (word >> (i0 | i1<<1 | i2<<2 | i3<<3)) & 1`); `mode` is 0 = combinational, ≥1 = registered (latches
 * on CLK). `sig` is a deterministic FNV-1a over the inner graph the word was extracted from — see
 * {@link cellBehaviorSig} — so the behavior can be invalidated when the logic changes. Pure data; never
 * hashed by sim-core (params/aux aren't folded), so storing it is golden-safe.
 */
export interface CellBehavior {
  prog: number;
  word: number;
  mode: number;
  sig: number;
}

/**
 * A deterministic content hash of a cell's inner LOGIC (§2.3) — FNV-1a over a CANONICAL-ORDERED
 * serialization (sorted by id, fixed field order — NOT JS object-key order; CLAUDE.md golden rule #1
 * forbids the std default hasher for a reproducible value). Used as {@link CellBehavior.sig}: a swept word
 * is bound to the graph it came from, so on reseal a changed inner graph yields a new sig and the stale
 * behavior is dropped (re-sweep). The die FRAME is excluded (its box geometry is not logic), so a pure
 * box-resize does not invalidate the sweep — but wires TO the frame pins are kept (they define the
 * pinout). Render/registry only; never crosses the wasm boundary, never hashed by sim-core.
 */
export function cellBehaviorSig(graph: GraphSnapshot): number {
  const parts: string[] = [];
  for (const c of graph.components
    .filter((c) => !isFrame(c.kind))
    .slice()
    .sort((a, b) => a.id - b.id)) {
    parts.push(
      `C${c.id}|${c.kind}|${c.cell.col},${c.cell.row}|${c.value ?? 0}|${c.rot ?? 0}|${c.mirror ? 1 : 0}|${c.variant ?? 0}`,
    );
  }
  for (const w of graph.wires.slice().sort((a, b) => a.id - b.id)) {
    parts.push(`W${w.id}|${endpointKey(w.from)}>${endpointKey(w.to)}`);
  }
  for (const j of (graph.junctions ?? []).slice().sort((a, b) => a.id - b.id)) {
    parts.push(`J${j.id}|${j.cell.col},${j.cell.row}`);
  }
  let h = 0x811c9dc5; // FNV-1a 32-bit
  const s = parts.join("\n");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Name the common Boolean function a swept {@link CellBehavior.word} implements — a verification hint for
 * the characterization truth-table panel ("recognized as NAND"). `word` is the prog-4 LUT word
 * (`out = (word >> combo) & 1`, `combo = i0 | i1<<1 | …`), `inputs` the swept input count. Recognizes the
 * 1- and 2-input primitives + constant outputs; returns `null` for anything else (≥3-input, or an unnamed
 * function) — the truth table still stands on its own. Pure: no sim, headless-testable.
 */
export function recognizeGate(word: number, inputs: number): string | null {
  if (inputs === 1) {
    switch (word & 0b11) {
      case 0b00:
        return "LOW";
      case 0b01:
        return "NOT";
      case 0b10:
        return "BUFFER";
      case 0b11:
        return "HIGH";
    }
  }
  if (inputs === 2) {
    switch (word & 0xf) {
      case 0x0:
        return "LOW";
      case 0x8:
        return "AND";
      case 0xe:
        return "OR";
      case 0x7:
        return "NAND";
      case 0x1:
        return "NOR";
      case 0x6:
        return "XOR";
      case 0x9:
        return "XNOR";
      case 0xf:
        return "HIGH";
    }
  }
  return null;
}

/** Gate names {@link drawGateBodySymbol} can actually draw (LOW/HIGH are constants with no shape). */
const DRAWABLE_GATES = new Set([
  "AND",
  "NAND",
  "OR",
  "NOR",
  "XOR",
  "XNOR",
  "NOT",
  "BUFFER",
]);
/** 2:1 MUX LUT word for `out = sel ? b : a` (inputs i0=a, i1=b, i2=sel). The N:1 generalization needs the
 * explicit override; only the 2:1 case is auto-named here. */
const MUX_WORD_2TO1 = 0xca;

/** The higher-level (non-gate) {@link CellSymbolId} faces `drawCellSymbol` can draw. */
const CELL_SYMBOL_IDS = [
  "DFF",
  "DLATCH",
  "REG",
  "HADD",
  "FADD",
  "MUX",
  "TRI",
  "ARRAY",
];
/** EVERY id `drawCellSymbol` can actually render (gate faces + cell faces). The explicit override is
 * validated against this so a typo / unknown / external `def.symbol` falls back to auto-detect instead of
 * blanking the chip (drawCellSymbol's switch has no default + board.ts hides the name when a face draws). */
const DRAWABLE_SYMBOLS = new Set([...DRAWABLE_GATES, ...CELL_SYMBOL_IDS]);

/** Match the player's CELL NAME to a symbol id — the declared-intent shortcut for the types structure /
 * truth-table can't infer (adder / array / tri-state) and a fast path for the rest. Most specific first. */
function symbolFromName(name: string): string | null {
  const n = name.toUpperCase();
  if (/FULL[\s_-]*ADD|\bFADD\b/.test(n)) return "FADD";
  if (/HALF[\s_-]*ADD|\bHADD\b/.test(n)) return "HADD";
  if (/\bADDER\b/.test(n)) return "FADD";
  if (/\bREGISTER\b|\bREG\b/.test(n)) return "REG";
  if (/\bMUX\b|MULTIPLEX/.test(n)) return "MUX";
  if (/\bARRAY\b|\bPLA\b|\bROM\b|\bRAM\b/.test(n)) return "ARRAY";
  if (/TRI[\s_-]*STATE|3[\s_-]*STATE|\bTRI\b|\bOE\b/.test(n)) return "TRI";
  if (/FLIP[\s_-]*FLOP|\bDFF\b|\bFF\b/.test(n)) return "DFF";
  if (/\bLATCH\b/.test(n)) return "DLATCH";
  return null;
}

const cellSymbolMemo = new WeakMap<UserIc, string | null>();
/**
 * The schematic SYMBOL id a sealed cell should wear (a {@link drawCellSymbol} id), or `null` ⇒ fall back to
 * the name label. Decision order: explicit owner override (`def.symbol`) → the player's NAME keyword
 * (declared intent — the only signal for adder/array/tri-state) → a combinational GATE or 2:1 MUX from the
 * characterized truth-table → the SEQUENTIAL class (latch vs flop vs register) from {@link analyzeCell}'s
 * structure. Pure render/registry — never crosses the wasm boundary, never affects the netlist or golden.
 * Memoized on the `def` object identity: a reseal mints a fresh def ⇒ the cache invalidates naturally
 * (`analyzeCell` does a union-find + DFS, too heavy to run per-frame uncached).
 */
export function cellSymbol(def: UserIc): string | null {
  const cached = cellSymbolMemo.get(def);
  if (cached !== undefined) return cached;
  const sym = computeCellSymbol(def);
  cellSymbolMemo.set(def, sym);
  return sym;
}
function computeCellSymbol(def: UserIc): string | null {
  if (def.symbol && def.symbol.trim()) {
    const ov = def.symbol.trim().toUpperCase();
    if (DRAWABLE_SYMBOLS.has(ov)) return ov; // a known face; an unknown id falls through to auto-detect
  }
  const named = symbolFromName(def.name ?? "");
  if (named) return named;
  const inN = def.pinRoles?.filter((r) => r === "in").length ?? 0;
  if (def.behavior && def.behavior.mode === 0) {
    if (inN === 3 && (def.behavior.word & 0xff) === MUX_WORD_2TO1) return "MUX";
    const g = recognizeGate(def.behavior.word, inN);
    if (g && DRAWABLE_GATES.has(g)) return g;
  }
  const a = analyzeCell({
    graph: def.graph,
    frameId: def.frameId,
    pinRoles: def.pinRoles ?? [],
    pinNames: def.pinNames,
    resolveCell: getUserIc,
  });
  if (a.sequential) {
    // A direct feedback loop with no registered sub-cell ⇒ the primitive level-sensitive LATCH; built FROM
    // registered stages ⇒ a flop (one data bit) or a register word (several), keyed by data WIDTH (a
    // master/slave DFF is 2 latches but still ONE data bit, so don't count sub-cells for DFF-vs-REG).
    const hasRegSub = def.graph.components.some(
      (c) =>
        c.id !== def.frameId && (getUserIc(c.kind)?.behavior?.mode ?? 0) >= 1,
    );
    if (!hasRegSub) return "DLATCH";
    return a.dataInputs.length >= 2 ? "REG" : "DFF";
  }
  return null;
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
  // Free-form (box-captured) subassembly: the PLACED footprint is a COMPACT CHIP PACKAGE — a pin RING
  // packed tight (`packFreeFormFootprint`), DECOUPLED from the (large) build canvas. A sealed cell is a
  // chip, so its placed size tracks its PINS, not the sprawling canvas it was drawn on (a 5-pin DFF
  // authored on a 51×45 canvas is a 5-pin chip, not a 60-cell slab). This is exactly how a PACKAGED IC
  // already works here (`packageLayout` lays leads out from the pin COUNT; `tapeOut` drops `freeForm`);
  // the uniform-scaled replica was the outlier. Each pin keeps the EDGE and along-edge ORDER it was
  // authored on, so the pinout reads as drawn (D left, Q right, power top/bottom); only the empty interior
  // is squeezed out. The internal geometry (`ic.freeForm`, used by the die editor / walls / zoom-to-open
  // replica) is UNCHANGED, so you still dive into the WHOLE canvas — just smaller (more camera zoom).
  // Connectivity is by pin INDEX, so the netlist/flatten are untouched (render/registry only). The
  // integration TIER is now a density BADGE only (owner decision 2026-06-26), not a footprint scaler; the
  // σ ladder (`compactFreeFormGeom × TIER_FOOTPRINT_SCALE`) is retained for the badge/tests but superseded
  // here for sizing — see docs/ui/integration-tier-scaling.md §5 (2026-06-26 "decoupled pin-ring" revision).
  if (ic.freeForm) {
    const compact = packFreeFormFootprint(ic.freeForm);
    const pins: Pin[] = compact.pins.map((p, i) => ({
      index: i,
      label: ic.pinNames?.[i]?.trim()
        ? ic.pinNames[i]!.trim()
        : p.name?.trim()
          ? p.name.trim()
          : String(i + 1),
      dx: p.dx,
      dy: p.dy,
    }));
    return {
      tag: ic.tag,
      name: ic.name,
      colorKey: "accent",
      pins,
      w: compact.w,
      h: compact.h,
      defaultValue: 0,
      unit: "",
      ideal: true,
    };
  }
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
  // A free-form (box-captured) subassembly carries its own die-frame geometry; re-register that frame
  // kind so re-opening it for editing (and the walls) match the captured box on a fresh load.
  if (ic.freeForm) registerFreeFormFrame(ic.tag, ic.freeForm);
}

/** A brand-new BLANK free-form subassembly's default geometry: a roomy box with four edge-centred,
 * unnamed pins (one per side — a friendly starting pinout the player renames / moves / adds to / removes).
 * The box and pins are reshaped entirely by hand in the die editor (resize handles + Alt-drag + the
 * pin-count stepper). Presentation only. */
const BLANK_SUBASSEMBLY_GEOM: FreeFormGeom = {
  w: 9,
  h: 7,
  pins: [
    { dx: 0, dy: 3 }, // left
    { dx: 8, dy: 3 }, // right
    { dx: 4, dy: 0 }, // top
    { dx: 4, dy: 6 }, // bottom
  ],
};

/** Provisional die-frame subtag for an unsealed BLANK subassembly. Fixed (only one die is open at a time)
 * so a New ▸ Subassembly never burns a real CEC auto-tag — the FINAL tag is minted at Seal ({@link
 * captureSeal} reads this frame's free-form geom onto the new def). Re-registered (overwritten) on each New;
 * a never-sealed one is an inert orphan frame kind (no def, not in the bin, gone on reload). */
const BLANK_SUB_DIE_TAG = "__BLANK_SUB";

/**
 * Set up a BLANK FREE-FORM subassembly die for the "New ▸ Subassembly" builder (§4.10): register a
 * provisional free-form die frame ({@link BLANK_SUBASSEMBLY_GEOM}) and build a die graph holding just that
 * frame (empty interior). Returns the die graph + frame id + die-frame kind to drill into. NO def is
 * registered yet — the box, pins, and circuit are shaped by hand, then `Seal` ({@link captureSeal}, free-
 * form-aware) mints the real tag and banks the fragment with its geometry. A power-less fragment (e.g. a
 * transmission gate — no VCC/GND) seals because a subassembly need not solve standalone. Registry only —
 * never the netlist or the golden.
 */
export function createBlankFreeFormSubassembly(): {
  dieGraph: GraphSnapshot;
  frameId: number;
  dieKind: string;
} {
  const geom: FreeFormGeom = {
    w: BLANK_SUBASSEMBLY_GEOM.w,
    h: BLANK_SUBASSEMBLY_GEOM.h,
    pins: BLANK_SUBASSEMBLY_GEOM.pins.map((p) => ({ ...p })),
  };
  const dieKind = registerFreeFormFrame(BLANK_SUB_DIE_TAG, geom);
  const g = new BoardGraph();
  // Anchor the die frame where the die editor frames it (mirrors the region capture's origin).
  const frame = g.place(dieKind, { col: 8, row: 8 });
  if (!frame) throw new Error("createBlankFreeFormSubassembly: place failed");
  return { dieGraph: g.serialize(), frameId: frame.id, dieKind };
}

/** Forget a sealed IC (and unregister its kind). When `tag` is a multi-variant FAMILY, this cascades:
 * the family tag's own REGISTRY/PART_KINDS entry, every child `"<family>#i"` REGISTRY entry, and the
 * FAMILIES row are all dropped (else the child defs would linger as orphans). A plain IC just drops
 * its single entry. */
export function unregisterUserIc(tag: string): void {
  const fam = FAMILIES.get(tag);
  if (fam) {
    for (let i = 0; i < fam.variants.length; i++) {
      const childTag = variantChildTag(tag, i);
      // Clean the paired free-form die-frame kind too, else it orphans in the global registry (audit #12).
      if (REGISTRY.get(childTag)?.freeForm) unregisterFreeFormFrame(childTag);
      REGISTRY.delete(childTag);
    }
    FAMILIES.delete(tag);
  }
  if (REGISTRY.get(tag)?.freeForm) unregisterFreeFormFrame(tag);
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
/**
 * TAPE OUT — promote a bare `role='subassembly'` cell into a board-placeable `role='ic'` (§4.5). This
 * is the ONLY path from a subassembly to the board: the player chooses the package (the "pinout") and
 * the cell flips to an IC. A no-op (returns undefined) for an unknown tag or a cell that is already an
 * `'ic'` (it doesn't need promoting). `target` re-packages to a chosen archetype/pinCount — its pin
 * count must be ≥ the cell's current pins (you can grow the package / add NC pads, never lose pins);
 * omitted, the cell keeps its existing package (the common "confirm the pinout" case for a cell already
 * authored in a die). The placeable kind reads {@link UserIc.package} ({@link userIcPartKind}), and the
 * inner wires reference frame pins by INDEX, so an identity re-package preserves connectivity exactly —
 * a taped-out cell flattens/solves identically to its pre-tape-out die. Web-only graph/role mutation:
 * nothing runs in sim-core or crosses the hashed boundary, and the golden places no user IC.
 */
export function tapeOut(
  tag: string,
  target?: { archetype: string; pinCount: number },
): UserIc | undefined {
  const def = REGISTRY.get(tag);
  if (!def || def.role !== "subassembly") return undefined;
  const pkg = target ?? def.package;
  if (pkg.pinCount < def.package.pinCount) return undefined; // never lose pins
  let graph = def.graph;
  const repackaged =
    pkg.archetype !== def.package.archetype ||
    pkg.pinCount !== def.package.pinCount;
  if (repackaged) {
    // Swap the frame's die-frame kind so re-opening the die shows the chosen body. The placeable kind
    // already derives its pins from `package` (userIcPartKind), so this is for editing consistency; the
    // inner wires' frame pin INDICES (0..oldN-1 < new pinCount) stay valid — extra pads are NC.
    if (!framePackage(frameTag(pkg.archetype, pkg.pinCount))) return undefined;
    graph = structuredClone(def.graph);
    const frame = graph.components.find((c) => c.id === def.frameId);
    const newDieKind = dieFrameTag(frameTag(pkg.archetype, pkg.pinCount));
    if (frame && PART_KINDS[newDieKind]) frame.kind = newDieKind;
  }
  const promoted: UserIc = {
    ...def,
    package: { ...pkg },
    graph,
    role: "ic",
  };
  // Repackaging a FREE-FORM subassembly onto a real package: drop the free-form geometry so
  // userIcPartKind (which prefers `freeForm`) lays the footprint out from the CHOSEN package — otherwise
  // the placeable footprint silently keeps the old box and ignores the pinout the player picked (audit).
  if (repackaged && promoted.freeForm) delete promoted.freeForm;
  registerUserIc(promoted);
  return promoted;
}

export function resealUserIc(
  tag: string,
  graph: GraphSnapshot,
  frameId: number,
  pinNames?: string[],
): void {
  const prev = REGISTRY.get(tag);
  if (!prev) return;
  const keep = pinNames && pinNames.some((n) => n && n.trim());
  // A FREE-FORM subassembly's die frame carries its live box+pins geometry in its KIND (re-registered by
  // pin/box editing). Read it back so a resize / pin-move PERSISTS through the reseal — otherwise the
  // spread below keeps `prev.freeForm`, silently reverting the player's edits to the captured geometry.
  // (The pinCount can't change here — pin/box editing never adds/removes a pin — so the package stays.)
  let freeForm = prev.freeForm;
  const frame = graph.components.find((c) => c.id === frameId);
  if (frame && isFreeFormFrame(frame.kind)) {
    const geom = freeFormGeom(frame.kind);
    if (geom)
      freeForm = {
        w: geom.w,
        h: geom.h,
        pins: geom.pins.map((p) => ({ ...p })),
      };
  }
  // Drop a STALE characterization (audit): if the cell was swept to a LUT and then its inner logic was
  // edited, the stored truth-table no longer matches — keep `behavior` only while its `sig` still equals
  // the resealed graph's signature, else clear it so a behavioral-fidelity instance can't collapse to a
  // wrong LUT (it falls back to the genuine flattened circuit until re-characterized).
  const behavior =
    prev.behavior && prev.behavior.sig === cellBehaviorSig(graph)
      ? prev.behavior
      : undefined;
  // Re-derive semantic pin ROLES from the resealed frame's stimuli + names (audit): editing a sub's pins /
  // stimuli must update its roles, not keep the stale capture-time ones (Tape-out + the characterize sweep
  // read them). Fall back to prev.pinRoles when nothing resolves, so a reseal that sets no stimuli doesn't
  // wipe good roles.
  const effectiveNames = keep ? pinNames : prev.pinNames;
  const rederived = derivePinRoles(
    effectiveNames,
    frame?.pinTests,
    prev.package.pinCount,
  );
  const pinRoles = rederived.some((r) => r) ? rederived : prev.pinRoles;
  // Spread the prior def so EVERY field rides through — notably `role` (audit blocker: re-editing +
  // resealing a captured subassembly otherwise flipped it back to a board IC). The edited inner graph /
  // frame id / pin names / free-form geometry / stale behavior / re-derived roles are overridden.
  registerUserIc({
    ...prev,
    frameId,
    graph,
    freeForm,
    pinNames: keep ? [...pinNames] : prev.pinNames,
    behavior,
    pinRoles,
  });
}

/**
 * Store (or clear) a swept {@link CellBehavior} on a registered cell def, so a placed instance set to
 * `fidelity:'behavioral'` collapses to one LUT in {@link flattenUserIcs}. Pass `undefined` to drop a stale
 * characterization (e.g. when the inner logic changed and the {@link CellBehavior.sig} no longer matches).
 * No-op when `tag` isn't registered. Spreads the prior def so every other field rides through unchanged.
 */
export function setUserIcBehavior(
  tag: string,
  behavior: CellBehavior | undefined,
): void {
  const prev = REGISTRY.get(tag);
  if (!prev) return;
  registerUserIc({ ...prev, behavior });
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
 * Union {@link userIcsForGraph} over SEVERAL graphs — the outer board PLUS every in-progress (unsealed)
 * die graph — deduped by tag. A user IC placed ONLY inside a half-built die lives solely in that die's
 * graph (never as a board component), so the outer-only scan misses it and the save can't embed its def;
 * on reload its placed instance is an unknown kind. Scanning the inner dies too fixes that (audit).
 */
export function userIcsForGraphs(graphs: GraphSnapshot[]): UserIc[] {
  const byTag = new Map<string, UserIc>();
  for (const g of graphs)
    for (const def of userIcsForGraph(g))
      if (!byTag.has(def.tag)) byTag.set(def.tag, def);
  return [...byTag.values()];
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

/** Union {@link userIcFamiliesForGraph} over several graphs (the outer board + every in-progress unsealed
 * die), deduped by family tag — the family-sidecar counterpart of {@link userIcsForGraphs}. */
export function userIcFamiliesForGraphs(
  graphs: GraphSnapshot[],
): UserIcFamilySidecar[] {
  const byFamily = new Map<string, UserIcFamilySidecar>();
  for (const g of graphs)
    for (const fam of userIcFamiliesForGraph(g))
      if (!byFamily.has(fam.family)) byFamily.set(fam.family, fam);
  return [...byFamily.values()];
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

/** Canonical (sorted-key, undefined-skipping) JSON — a STABLE structural string for a value regardless of
 * object key ORDER or absent-vs-undefined keys, so a `JSON.parse`d save def and an in-code REGISTRY def
 * compare equal when they're structurally the same. Used to content-address a def for import dedup. */
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") +
    "}"
  );
}

/** A content key for an IC def that IGNORES its tag — so "the same cell under a different tag" is
 * recognised as identical (dedup), while a genuinely different cell sharing a tag is a conflict. */
function defContentKey(def: UserIc): string {
  const rest: Partial<UserIc> = { ...def };
  delete rest.tag;
  return canonicalJson(rest);
}

/** Rewrite every component `kind` that the remap touches (placed sub-cells AND a free-form die-frame kind),
 * returning a NEW snapshot (never mutates the input). Wires/junctions/net-labels address pins by id, never
 * by tag, so they're untouched. A no-op (returns the same object) when the remap is empty. */
export function applyTagRemap(
  graph: GraphSnapshot,
  remap: Map<string, string>,
): GraphSnapshot {
  if (remap.size === 0) return graph;
  let changed = false;
  const components = graph.components.map((c) => {
    const to = remap.get(c.kind);
    if (to === undefined) return c;
    changed = true;
    return { ...c, kind: to };
  });
  return changed ? { ...graph, components } : graph;
}

/** Order defs LEAF-FIRST (a nested sub-cell before the cell that places it), so an import can resolve a
 * child's remap before rewriting its parent. DFS post-order over the `kind`-references that point at other
 * defs IN THIS BATCH; a `visiting` guard makes a (defensive) cycle terminate instead of recursing forever. */
function topoOrderDefs(defs: UserIc[]): UserIc[] {
  const byTag = new Map(defs.map((d) => [d.tag, d]));
  const order: UserIc[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (d: UserIc): void => {
    if (done.has(d.tag) || visiting.has(d.tag)) return;
    visiting.add(d.tag);
    for (const c of d.graph.components) {
      const child = c.kind !== d.tag ? byTag.get(c.kind) : undefined;
      if (child) visit(child);
    }
    visiting.delete(d.tag);
    done.add(d.tag);
    order.push(d);
  };
  for (const d of defs) visit(d);
  return order;
}

/** A unique tag not already taken (REGISTRY or PART_KINDS), keeping the readable base name + a numeric
 * suffix — so an imported conflicting cell lands as e.g. "D LATCH (2)" rather than clobbering or burning a
 * CEC auto-id. */
function freshImportTag(base: string): string {
  for (let i = 2; ; i++) {
    const t = `${base} (${i})`;
    if (!REGISTRY.has(t) && !PART_KINDS[t]) return t;
  }
}

/**
 * MERGE a save's embedded sealed-IC library into the REGISTRY **without ever clobbering** an existing
 * library entry — the load-time replacement for {@link registerUserIcs}. For each embedded def, leaf-first:
 *
 * - the tag is FREE ⇒ install it as-is;
 * - the tag is taken by a STRUCTURALLY-IDENTICAL def ⇒ dedup (re-opening your own circuit, or a shared
 *   upstream cell you both have) — keep what's there, no copy;
 * - the tag is taken by a DIFFERENT def ⇒ CONFLICT: install the incoming one under a FRESH tag and record
 *   `oldTag → newTag` so the caller can {@link applyTagRemap} the loaded BOARD graph (+ inner dies) onto
 *   the imported copies. The existing library version is left untouched.
 *
 * So loading an OLD save can no longer downgrade a sub-assembly you've since improved, and — when circuits
 * start being SHARED — a tag collision between two authors' `CEC9001`s imports both faithfully instead of
 * one silently overwriting the other (owner: "doesn't break anything but keeps their intended design").
 * Returns the remap (empty when nothing conflicted). A builtin-colliding tag is skipped (clobber-safety),
 * exactly as {@link registerUserIcs} did. Family sidecars are regrouped with the remap applied.
 */
export function importUserIcs(
  defs: UserIc[] | undefined,
  families?: UserIcFamilySidecar[],
): { remap: Map<string, string> } {
  const remap = new Map<string, string>();
  for (const def of topoOrderDefs(defs ?? [])) {
    if (collidesWithBuiltin(def.tag)) {
      console.warn(
        `importUserIcs: skipped IC with reserved tag "${def.tag}" (collides with a built-in kind).`,
      );
      continue;
    }
    // Resolve any child sub-cell whose tag was remapped earlier in the leaf-first pass.
    const resolved =
      remap.size > 0 ? { ...def, graph: applyTagRemap(def.graph, remap) } : def;
    const existing = REGISTRY.get(def.tag);
    if (!existing) {
      registerUserIc(resolved); // free tag — install as authored
    } else if (defContentKey(resolved) === defContentKey(existing)) {
      // identical to the library entry — dedup (the loaded board's tag still resolves to it)
    } else {
      const newTag = freshImportTag(def.tag);
      // The imported COPY: its own free-form die-frame kind (`__DIE_FF_<tag>`) is remapped to the new tag
      // too, so registerUserIc's frame re-registration and the graph agree.
      const frameMap = new Map<string, string>();
      if (resolved.freeForm)
        frameMap.set(
          FREE_FORM_DIE_PREFIX + def.tag,
          FREE_FORM_DIE_PREFIX + newTag,
        );
      registerUserIc({
        ...resolved,
        tag: newTag,
        graph: applyTagRemap(resolved.graph, frameMap),
      });
      remap.set(def.tag, newTag);
      if (resolved.freeForm)
        remap.set(
          FREE_FORM_DIE_PREFIX + def.tag,
          FREE_FORM_DIE_PREFIX + newTag,
        );
    }
  }
  // Regroup variant families AFTER the flat child defs are registered, with the remap applied to the family
  // tag + its ordered child tags (so a remapped variant still regroups under the right family).
  if (families && families.length > 0) {
    registerUserIcFamilies(
      families.map((s) => ({
        family: remap.get(s.family) ?? s.family,
        name: s.name,
        variantTags: s.variantTags.map((t) => remap.get(t) ?? t),
      })),
    );
  }
  return { remap };
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
    // Deep-clone the re-homed base (audit): a shallow `{...base}` shares its `graph`/`freeForm` object refs
    // with the original def, so a later edit to either would alias the other — the clone discipline
    // flattenUserIcs relies on. structuredClone is safe (a UserIc is plain JSON).
    const child0: UserIc = structuredClone({
      ...base,
      tag: variantChildTag(family, 0),
    });
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
  // Deep-clone too (audit): don't share `graph`/`freeForm` refs with the caller's `variant` object.
  const child: UserIc = structuredClone({ ...variant, tag: childTag });
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
 *
 * `preferBehavioral` is the GLOBAL "use the characterized fast models" switch (the Behavioral/Discrete
 * fidelity toggle, sibling to Real/Ideal). When true, every instance whose def carries a swept
 * `behavior` collapses to its prog-4 LUT — at EVERY depth, since the wave-based inliner re-evaluates
 * each surfaced nested instance — exactly as if each had `fidelity:'behavioral'` set. This is the unlock
 * for hierarchical designs: a deep transistor-level build (e.g. a 4-bit ALU = 548 FETs) collapses to a
 * handful of linear LUTs, sidestepping the transistor-scale Newton non-convergence documented in
 * `docs/sim/transistor-scale-convergence.md`. Golden-safe: the golden places no user IC, so the flag is
 * inert there; default false keeps every per-instance circuit byte-identical to today.
 */
export function flattenUserIcs(
  graph: BoardGraph,
  sink?: FlattenRecord[],
  preferBehavioral = false,
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

      // COLLAPSE to the characterized LUT face (§2.3): when the cell carries a swept `behavior` AND this
      // placed instance opted in (`fidelity === 'behavioral'`), emit ONE prog-4 LUT element instead of
      // inlining the FETs. The cell's pins map BY ROLE onto the LUT's fixed visual pins
      // [0 OUT, 1 I0, 2 I1, 3 I2, 4 I3, 5 CLK, 6 VCC, 7 GND] (BEH_SPEC.LUT, netlist.ts); unwired LUT inputs
      // default to ground (node 0) in buildNetlist, so a ≤4-input gate needs no extra ties. Golden-safe:
      // the golden places no user IC, and a combinational LUT folds an all-zero state block.
      // (Render-side inner currents need the P6 local solve; until then a collapsed cell's zoom-to-open
      // FETs are static — the documented trade-off for the cheap face.)
      const instX = inst as {
        fidelity?: string;
        word?: number;
        mode?: number;
      };
      if (
        def.behavior &&
        def.pinRoles &&
        (instX.fidelity === "behavioral" || preferBehavioral)
      ) {
        const roles = def.pinRoles;
        let inK = 0;
        const lutPin: number[] = roles.map((r) =>
          r === "out"
            ? 0
            : r === "vcc"
              ? 6
              : r === "gnd"
                ? 7
                : r === "clk"
                  ? 5
                  : r === "in"
                    ? 1 + Math.min(inK++, 3)
                    : -1,
        );
        // Replace the placed instance with the LUT carrier (a NEW object — never mutate the shared snap).
        const ci = comps.findIndex((c) => c.id === inst.id);
        if (ci >= 0)
          comps[ci] = {
            ...comps[ci],
            kind: "LUT",
            word: def.behavior.word,
            mode: def.behavior.mode,
          };
        // Retarget the instance's external wire endpoints from cell-pin index to LUT pin (by role).
        for (let wi = 0; wi < wires.length; wi++) {
          const w = wires[wi]!;
          let nf = w.from;
          let nt = w.to;
          if (isPinRef(w.from) && w.from.componentId === inst.id) {
            const lp = lutPin[w.from.pinIndex];
            if (lp !== undefined && lp >= 0)
              nf = { componentId: inst.id, pinIndex: lp };
          }
          if (isPinRef(w.to) && w.to.componentId === inst.id) {
            const lp = lutPin[w.to.pinIndex];
            if (lp !== undefined && lp >= 0)
              nt = { componentId: inst.id, pinIndex: lp };
          }
          if (nf !== w.from || nt !== w.to)
            wires[wi] = { ...w, from: nf, to: nt };
        }
        continue; // collapsed — skip FET inlining
      }

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
/** Best-effort {@link PinRole} for a pin from its authoring stimulus + name (§2.9). The stimulus
 * (`pinTests`) authoritatively tags the rails/inputs the player wired; the name fills in the rest
 * (notably the OUTPUT, which carries no stimulus). Returns a sparse array (unknown pins left unset). */
export function derivePinRoles(
  pinNames: (string | undefined)[] | undefined,
  pinTests: (PinTest | null)[] | undefined,
  pinCount: number,
): PinRole[] {
  const roles: PinRole[] = [];
  for (let i = 0; i < pinCount; i++) {
    const t = pinTests?.[i];
    // An explicit stimulus role wins over the name heuristic. Every PinTestRole (gnd/vcc/in/out) is also a
    // semantic PinRole, so an authored `out` marker (a result pin whose name isn't a known output word)
    // seals as `out` — what the characterizer / test bench reads.
    if (t?.role) {
      roles[i] = t.role;
      continue;
    }
    const byName = roleFromName((pinNames?.[i] ?? "").trim().toUpperCase());
    if (byName) roles[i] = byName;
  }
  return roles;
}

/** Map a pin NAME (upper-cased) to the SEMANTIC role it implies, or undefined. Common synonyms:
 * VCC/VDD/VS → vcc; GND/VSS/GROUND → gnd; CLK/CLOCK/CK → clk; OUTPUTS Y/Q/OUT/O/F plus QB/QN/NQ (Q-bar)
 * and SUM/COUT (adder); INPUTS A/B/C/D/IN/I plus the control family CLR/CLEAR/RST/RESET/MR (clear),
 * PRE/PRESET/SET (preset), EN/ENABLE/OE (enable), SEL/SELECT/LD/LOAD (select/load), CE/CS/WE/RE (memory)
 * and J/K/T/CIN (flip-flop & adder data); IO/INOUT/BIDIR/BUS → inout. A trailing COMPLEMENT marker
 * (`_BAR` / `-BAR` / `BAR` / `_B` / `_N`) or a BUS INDEX (`Q0`, `D3`, `A1`) resolves to the BASE name's role
 * — an active-low EN_BAR is still an input, a Q_BAR / Q2 still an output. Used by {@link derivePinRoles}
 * and the builder's auto-role-from-name. */
export function roleFromName(n: string): PinRole | undefined {
  switch (n) {
    case "VCC":
    case "VDD":
    case "VS":
      return "vcc";
    case "GND":
    case "VSS":
    case "GROUND":
      return "gnd";
    case "CLK":
    case "CLOCK":
    case "CK":
      return "clk";
    // OUTPUTS: data outputs, complemented (Q-bar) outputs, and adder sum / carry-out.
    case "Y":
    case "Q":
    case "OUT":
    case "O":
    case "F":
    case "QB":
    case "QN":
    case "NQ":
    case "SUM":
    case "COUT":
      return "out";
    // INPUTS: data, clear/reset/preset/set, enable/output-enable, select/load, memory control, and
    // flip-flop / adder data. (Complemented forms like ENB/SEL_BAR fall through to the bar-strip below.)
    case "A":
    case "B":
    case "C":
    case "D":
    case "IN":
    case "I":
    case "CLR":
    case "CLEAR":
    case "RST":
    case "RESET":
    case "MR":
    case "PRE":
    case "PRESET":
    case "SET":
    case "EN":
    case "ENABLE":
    case "ENB":
    case "OE":
    case "OEB":
    case "SEL":
    case "SELECT":
    case "LD":
    case "LOAD":
    case "CE":
    case "CS":
    case "WE":
    case "RE":
    case "J":
    case "K":
    case "T":
    case "CIN":
      return "in";
    case "IO":
    case "INOUT":
    case "BIDIR":
    case "BUS":
      return "inout";
  }
  // A COMPLEMENTED (active-low / "bar") pin keeps its base name's role (an enable's inverse is still an
  // input, an output's inverse still an output), and a BUS-INDEXED pin keeps its base letter's role
  // (Q0/Q1/Q2/Q3 → out, D0..D3 / A1 → in). Strip a trailing bar marker OR a numeric index and resolve the
  // base — guarded so a bare/empty result (the literal "BAR", or "0") can't recurse.
  const base = n.replace(/(?:[_-]?BAR|[_-][BN]|[_-]?\d+)$/, "");
  if (base && base !== n) return roleFromName(base);
  return undefined;
}

/** The integration-scale bands (real VLSI ladder), a derived display/sort label. */
export type IntegrationTier = "SSI" | "MSI" | "LSI" | "VLSI" | "ULSI";

/** Count the active devices in a cell's FULL expansion — every placed non-frame component is one device;
 * a placed user-IC instance recurses into its def. `path` guards self-reference (sealed defs are acyclic —
 * a def references only previously-sealed cells — so this is defensive); `memo` caches each def's resolved
 * count so a cell referenced on many paths (a diamond/doubling hierarchy — e.g. an ALU reusing one adder
 * cell, or nibble→byte→word) is counted ONCE per top-level call. Keeps this O(distinct defs), not
 * exponential — the registration hot path (userIcPartKind → integrationTier) can't freeze on a deep reuse. */
function countDevices(
  def: UserIc,
  path: Set<string>,
  memo: Map<string, number>,
): number {
  if (path.has(def.tag)) return 0; // cycle guard (defensive — sealed defs can't actually cycle)
  const cached = memo.get(def.tag);
  if (cached !== undefined) return cached;
  path.add(def.tag);
  let n = 0;
  for (const c of def.graph.components) {
    if (isFrame(c.kind)) continue; // the die frame is structure, not a device
    const nested = getUserIc(c.kind);
    n += nested ? countDevices(nested, path, memo) : 1;
  }
  path.delete(def.tag);
  memo.set(def.tag, n);
  return n;
}

/** Device count → integration-tier band (the thresholds, in ONE place). */
export function tierForDeviceCount(n: number): IntegrationTier {
  if (n < 12) return "SSI";
  if (n < 100) return "MSI";
  if (n < 1000) return "LSI";
  if (n < 100000) return "VLSI";
  return "ULSI";
}

/** The device count at which each tier ABOVE SSI begins — so the die editor can show "shrinks at MSI (12)"
 * and the player grasps that scaling is tier-GATED (a small cell stays full size until it crosses a band). */
export const INTEGRATION_TIER_MIN: Record<
  Exclude<IntegrationTier, "SSI">,
  number
> = { MSI: 12, LSI: 100, VLSI: 1000, ULSI: 100000 };

/** The integration-tier band (SSI → ULSI) of a sealed cell, from its game-scaled device count over the full
 * recursive expansion. A pure DERIVED label — never hashed, never crosses the wasm boundary; it drives the
 * bin badge AND the placed footprint scale, so the two always agree. */
export function integrationTier(def: UserIc): IntegrationTier {
  return tierForDeviceCount(countDevices(def, new Set(), new Map()));
}

/** The active-device count of a LIVE die/board graph (the in-progress cell being built): every non-frame
 * component is one device; a placed user-IC recurses into its def. Lets the die editor surface the live
 * tier + count so the tier-gated footprint scaling is legible WHILE building (not a surprise at seal). */
export function countGraphDevices(graph: GraphSnapshot): number {
  const memo = new Map<string, number>(); // one shared cache so a reused cell is counted once
  let n = 0;
  for (const c of graph.components) {
    if (isFrame(c.kind)) continue;
    const nested = getUserIc(c.kind);
    n += nested ? countDevices(nested, new Set(), memo) : 1;
  }
  return n;
}

/**
 * Resting FOOTPRINT scale per integration tier (docs/ui/integration-tier-scaling.md §2): the more devices
 * folded into a cell, the smaller its placed package — Moore's Law in the hand. A perceptual/log curve
 * (~×0.6 per rung), NOT the literal ~10⁶:1 device ratio, so a CPU stays a manageable size and ULSI is
 * compact-but-pokeable. SSI = 1.0 (a lone gate is full size, the ladder's anchor). The honesty lives in the
 * tier BADGE/label, never the pixel ratio. Tunable.
 */
export const TIER_FOOTPRINT_SCALE: Record<IntegrationTier, number> = {
  SSI: 1.0,
  MSI: 0.6,
  LSI: 0.4,
  VLSI: 0.25,
  ULSI: 0.15,
};

/**
 * Compact a free-form subassembly's box+pins into its placed footprint: ONE uniform scale (a true smaller
 * replica — every relative position, side, and index preserved; never a re-layout), FLOORED so the rounded
 * pins stay on DISTINCT integer grid cells (so wiring stays grid-clean and no de-collide ever moves a pin
 * relative to its neighbours — the §5 rule). Walks the scale UP from the tier target until the rounded pins
 * are all distinct (at worst σ=1 → the original, always distinct), so a sparse pinout compacts to the tier
 * scale while a pad-dense one bottoms out where its pins need the room. Pure geometry — never the netlist.
 */
export function compactFreeFormGeom(
  ff: FreeFormGeom,
  scale: number,
): FreeFormGeom {
  // Search on a 1/20 grid from the (clamped) target up to 1.0, returning the smallest distinct scale.
  const start = Math.max(1, Math.min(20, Math.round(scale * 20)));
  for (let i = start; i <= 20; i++) {
    const s = i / 20;
    const w = Math.max(2, Math.round((ff.w - 1) * s) + 1);
    const h = Math.max(2, Math.round((ff.h - 1) * s) + 1);
    // Preserve which EDGE each pin sits on — a true replica must never flip a right-wall pin to the left
    // (which the bare round+clamp does on a narrow box at a small scale). A pin on an original edge maps to
    // the SAME edge of the scaled box; an along-edge coordinate scales proportionally.
    const pins = ff.pins.map((p) => ({
      ...p,
      dx:
        p.dx === 0
          ? 0
          : p.dx === ff.w - 1
            ? w - 1
            : Math.min(w - 1, Math.max(0, Math.round(p.dx * s))),
      dy:
        p.dy === 0
          ? 0
          : p.dy === ff.h - 1
            ? h - 1
            : Math.min(h - 1, Math.max(0, Math.round(p.dy * s))),
    }));
    const distinct = new Set(pins.map((p) => `${p.dx},${p.dy}`)).size;
    if (distinct === pins.length) return { w, h, pins };
  }
  // Fallback (σ=1): the original geometry verbatim (already distinct, unless it shipped with stacked pins).
  return { w: ff.w, h: ff.h, pins: ff.pins.map((p) => ({ ...p })) };
}

/**
 * Pack a free-form subassembly's pins into a COMPACT chip-package footprint — the placed package, DECOUPLED
 * from the (large) build canvas. A sealed cell is a chip: its placed size tracks its PIN RING (like a real
 * package — exactly how `packageLayout` lays a DIP/SOT out from the pin COUNT), not the sprawling editing
 * canvas it was drawn on (a 5-pin DFF authored on a 51×45 canvas is a 5-pin chip ≈ 4×3, not a 60-cell slab).
 * Each pin keeps the WALL it was authored nearest (left/right/top/bottom) and the along-edge ORDER, so the
 * pinout still reads as drawn (D left, Q right, power top/bottom) — only the empty interior is squeezed out.
 * Pins land on DISTINCT integer cells BY CONSTRUCTION: opposite walls on opposite sides (x=0 vs x=w-1, y=0
 * vs y=h-1), each wall's pins on consecutive INTERIOR cells (corners reserved), so wiring stays grid-clean
 * and connectivity (by pin INDEX) is untouched — the netlist/flatten never change (render/registry only).
 * Returns pins in the SAME index order as the input (so `pinNames[i]` still names pin i). The placed
 * footprint is now DECOUPLED from the build canvas + the integration tier (tier is a density BADGE only,
 * owner decision 2026-06-26); `ic.freeForm` still drives the die editor / walls / zoom-to-open. Pure
 * geometry, never the netlist.
 */
export function packFreeFormFootprint(ff: FreeFormGeom): FreeFormGeom {
  const MIN = 3; // a chip body is ≥3×3 so the name/symbol stays legible and pins aren't corner-jammed
  const w = Math.max(1, ff.w);
  const h = Math.max(1, ff.h);
  // Classify each pin by its NEAREST wall (an edge pin's distance to its wall is 0). Ties resolve
  // left→right→top→bottom, so a corner pin lands on a vertical wall — deterministic, no Math.random.
  type Wall = "L" | "R" | "T" | "B";
  const wallOf = (dx: number, dy: number): Wall => {
    const dl = dx;
    const dr = w - 1 - dx;
    const dt = dy;
    const db = h - 1 - dy;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) return "L";
    if (m === dr) return "R";
    if (m === dt) return "T";
    return "B";
  };
  const tagged = ff.pins.map((p, i) => ({ i, p, wall: wallOf(p.dx, p.dy) }));
  // Each wall's pins, kept in their authored along-edge order (L/R by dy, T/B by dx).
  const L = tagged
    .filter((t) => t.wall === "L")
    .sort((a, b) => a.p.dy - b.p.dy);
  const R = tagged
    .filter((t) => t.wall === "R")
    .sort((a, b) => a.p.dy - b.p.dy);
  const T = tagged
    .filter((t) => t.wall === "T")
    .sort((a, b) => a.p.dx - b.p.dx);
  const B = tagged
    .filter((t) => t.wall === "B")
    .sort((a, b) => a.p.dx - b.p.dx);
  // Body: wide enough for the busier of top/bottom (+2 reserved corners), tall enough for the busier of
  // left/right (+2), floored at MIN so the smallest chip still has a readable body.
  const bw = Math.max(MIN, Math.max(T.length, B.length) + 2);
  const bh = Math.max(MIN, Math.max(L.length, R.length) + 2);
  // Centre a wall's run of `count` pins within the interior span [1, dim-2] (corners reserved), so a sparse
  // wall sits middled (and a lone pin aligns with a lone pin opposite), not corner-jammed.
  const along = (count: number, dim: number): number[] => {
    const slots = dim - 2; // interior cells
    const start = 1 + Math.max(0, Math.floor((slots - count) / 2));
    return Array.from({ length: count }, (_, k) => start + k);
  };
  const pos = new Array<{ dx: number; dy: number }>(ff.pins.length);
  along(L.length, bh).forEach((y, k) => (pos[L[k]!.i] = { dx: 0, dy: y }));
  along(R.length, bh).forEach((y, k) => (pos[R[k]!.i] = { dx: bw - 1, dy: y }));
  along(T.length, bw).forEach((x, k) => (pos[T[k]!.i] = { dx: x, dy: 0 }));
  along(B.length, bw).forEach((x, k) => (pos[B[k]!.i] = { dx: x, dy: bh - 1 }));
  const pins = ff.pins.map((p, i) => ({
    ...p,
    dx: pos[i]!.dx,
    dy: pos[i]!.dy,
  }));
  // Distinct by construction; guard defensively (a pathological input) by falling back to the uniform-scale
  // replica, which is itself floored to distinct cells.
  const distinct = new Set(pins.map((p) => `${p.dx},${p.dy}`)).size;
  if (distinct !== pins.length) return compactFreeFormGeom(ff, 1);
  return { w: bw, h: bh, pins };
}

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
  // Duplicate-name guard (audit): a FRESH seal whose chosen name already names a user IC / family would
  // silently OVERWRITE that def (and, for free-form, its global geometry) under every already-placed
  // instance — silent data loss. Refuse. Exempt: an explicit append to that family (`intoFamily`); an
  // in-place reseal never reaches here (it goes through `resealUserIc` via `editingTag`).
  if (
    trimmed &&
    !intoFamily &&
    (REGISTRY.has(trimmed) || FAMILIES.has(trimmed))
  )
    return undefined;
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

  // Derive the semantic pin roles (§2.9) from the player's authoring stimuli + pin names, so Tape-out
  // and the characterization sweep know which pins drive / observe / power. Sparse — absent if nothing
  // resolved (then callers fall back to heuristics). Pure metadata; never affects the netlist.
  const derivedRoles = derivePinRoles(
    framePinNames,
    frame.pinTests,
    pkg.pinCount,
  );
  const pinRolesField = derivedRoles.some((r) => r)
    ? { pinRoles: derivedRoles }
    : {};

  // A FREE-FORM die frame (a hand-built "New ▸ Subassembly" block) carries its own box + pin geometry in
  // the registry — attach it so the sealed def keeps that exact layout (else `userIcPartKind` would lay the
  // footprint out from the BLOCK package and lose the hand-placed pins). Mirrors `resealUserIc`. Absent for
  // a normal package-authored seal, so every existing seal/save stays byte-identical.
  const ffGeom = isFreeFormFrame(frame.kind)
    ? freeFormGeom(frame.kind)
    : undefined;
  const freeFormField = ffGeom
    ? {
        freeForm: {
          w: ffGeom.w,
          h: ffGeom.h,
          pins: ffGeom.pins.map((p) => ({ ...p })),
        },
      }
    : {};

  const tag = trimmed || nextAutoTag();
  // RE-TAG the captured FREE-FORM frame to THIS seal's own die kind. The "New ▸ Subassembly" builder reuses
  // one PROVISIONAL die-frame tag for every blank, so without this two sibling subassemblies' captured
  // graphs would both reference that shared tag and resolve to whichever geometry the LATEST blank left in
  // the global registry — a sub-assembly placed inside another would "adopt" the other's box + pins. Giving
  // each sealed graph its OWN `__DIE_FF_<tag>` frame (registered with this capture's geometry) makes it
  // self-contained. Wires reference the frame by id, and the new kind has the SAME pins, so this is purely a
  // rename — connectivity and the netlist are untouched. (Region captures already mint a unique tag.)
  if (freeFormField.freeForm) {
    const ffDieKind = registerFreeFormFrame(tag, freeFormField.freeForm);
    const capFrame = snapshot.components.find((c) => c.id === frameId);
    if (capFrame) capFrame.kind = ffDieKind;
  }
  registerUserIc({
    tag,
    name: trimmed || tag,
    package: pkg,
    frameId,
    graph: snapshot,
    ...pinNamesField,
    ...pinRolesField,
    ...freeFormField,
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

/** Where the synthesized frame is anchored inside a captured region's graph (mirrors the die editor's
 * origin; the exact cell is presentation-only — connectivity is what the netlist reads). */
const REGION_FRAME_ORIGIN = { col: 8, row: 8 };

/** The result of a region capture: the registered subassembly tag + its inferred pin count. */
export interface RegionCapture {
  tag: string;
  pinCount: number;
}

/** An EXPLICIT capture box in board cells (inclusive corners) — the rectangle the player DREW with the
 * live region tool, used verbatim as the subassembly's free-form box (§4.10: "copy over the exact size
 * of the selection box"). Omitted ⇒ the box is the captured parts' bounding box (the marquee-select
 * flow). When given it SEEDS the box, then captured part/pin cells are unioned in so a part can never
 * hang outside its own box (a snug rect still grows by ~1 to swallow leads); no extra pad (the drawn
 * rect already carries the margin the player wants). */
export interface RegionBox {
  minCol: number;
  minRow: number;
  maxCol: number;
  maxRow: number;
}

/** The shared analysis of a region capture: the box geometry + the pins-at-crossings, computed ONCE so
 * the live overlay preview ({@link previewRegion}) and the actual seal ({@link captureRegion}) agree pin
 * for pin. `ok:false` carries the refusal reason (so the overlay can explain it). Everything else is the
 * raw material the seal's build step consumes (the net roots, the captured-endpoint test, the box). */
type RegionAnalysis =
  | { ok: false; reason: "no-boundary" | "too-many" }
  | {
      ok: true;
      full: GraphSnapshot;
      find: (k: string) => string;
      capturedEndpoint: (e: Endpoint) => boolean;
      inBox: (c: Cell) => boolean;
      pinIndexOf: Map<string, number>;
      boundaryRoots: string[];
      capCompsRaw: GraphSnapshot["components"];
      minCol: number;
      minRow: number;
      boxW: number;
      boxH: number;
      shiftCell: (c: Cell) => Cell;
      pinGeom: { dx: number; dy: number; name?: string }[];
      pinNames: string[];
      pinRoles: PinRole[];
    };

/** Analyse a region (the union-find net model + the box + the pins-at-crossings) WITHOUT mutating
 * anything — the pure core both {@link captureRegion} and {@link previewRegion} run. See those for the
 * boundary rule and the `box` semantics. `region` is the pre-filtered set of in-region component ids. */
function analyzeRegion(
  graph: BoardGraph,
  region: Set<number>,
  box?: RegionBox,
): RegionAnalysis {
  const full = graph.serialize();

  // Union-find over wire endpoints (pins + junctions), keyed by endpointKey — the same net model
  // buildNetlist uses. (Net-label global aliases are out of scope here, as in captureSeal.)
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    for (;;) {
      const p = parent.get(root);
      if (p === undefined) {
        parent.set(root, root);
        break;
      }
      if (p === root) break;
      root = p;
    }
    // Path-compress every node on the way to the root.
    let cur = k;
    while (cur !== root) {
      const next = parent.get(cur) as string;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const w of full.wires) union(endpointKey(w.from), endpointKey(w.to));

  // Classify each net by walking every wire endpoint: collect the inside pins (deduped) on region
  // parts, whether it touches an outside part, and the kinds of those outside parts (for power-pin
  // naming).
  const insidePins = new Map<string, Map<string, Endpoint>>(); // root -> (pinKey -> PinRef)
  const hasOutside = new Set<string>();
  const outsideKinds = new Map<string, Set<string>>();
  const noteEndpoint = (e: Endpoint): void => {
    if (!isPinRef(e)) return;
    const root = find(endpointKey(e));
    if (region.has(e.componentId)) {
      let m = insidePins.get(root);
      if (!m) insidePins.set(root, (m = new Map()));
      m.set(endpointKey(e), e);
    } else {
      hasOutside.add(root);
      const kind = full.components.find((c) => c.id === e.componentId)?.kind;
      if (kind) {
        let s = outsideKinds.get(root);
        if (!s) outsideKinds.set(root, (s = new Set()));
        s.add(kind);
      }
    }
  };
  for (const w of full.wires) {
    noteEndpoint(w.from);
    noteEndpoint(w.to);
  }

  // Boundary roots become pins (one per net that crosses the box edge), ordered by the net's smallest
  // inside-pin key for determinism.
  const boundaryRoots = [...insidePins.keys()]
    .filter((r) => hasOutside.has(r))
    .sort((a, b) => {
      const ka = [...insidePins.get(a)!.keys()].sort()[0];
      const kb = [...insidePins.get(b)!.keys()].sort()[0];
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  if (boundaryRoots.length === 0) return { ok: false, reason: "no-boundary" }; // nothing leaves the selection
  if (boundaryRoots.length > BLOCK_MAX_PINS)
    return { ok: false, reason: "too-many" }; // too many pins for a free-form block
  const pinIndexOf = new Map<string, number>();
  boundaryRoots.forEach((r, i) => pinIndexOf.set(r, i));

  // The captured box = the bounding box of the captured parts' footprints, padded by one cell so pins sit
  // on a clear edge ring. The cell is a 1:1 copy: parts keep their RELATIVE positions, shifted so the
  // box's top-left maps to the frame origin (§4.10 — copy it over exactly, box = the selection).
  const capCompsRaw = full.components.filter((c) => region.has(c.id));
  // Seed the bbox from the player's drawn rect when given (so the box IS that rect), else from nothing
  // (the parts' own extent). Either way the loop below unions every captured part + pin cell in, so no
  // part can fall outside the box; an explicit rect that already wraps the parts stays exactly itself.
  let minCol = box ? box.minCol : Infinity;
  let minRow = box ? box.minRow : Infinity;
  let maxCol = box ? box.maxCol : -Infinity;
  let maxRow = box ? box.maxRow : -Infinity;
  for (const c of capCompsRaw) {
    const k = PART_KINDS[c.kind];
    const fw = k?.w ?? 1;
    const fh = k?.h ?? 1;
    minCol = Math.min(minCol, c.cell.col);
    minRow = Math.min(minRow, c.cell.row);
    maxCol = Math.max(maxCol, c.cell.col + fw - 1);
    maxRow = Math.max(maxRow, c.cell.row + fh - 1);
    // Rotation/mirror-aware: union each pin's ACTUAL cell (the crossing geometry uses the same
    // rotation-aware cell), so a rotated multi-cell part can never fall outside its own box (audit).
    const np = k?.pins.length ?? 0;
    for (let pi = 0; pi < np; pi++) {
      const pc = graph.endpointCell({ componentId: c.id, pinIndex: pi });
      if (pc) {
        minCol = Math.min(minCol, pc.col);
        minRow = Math.min(minRow, pc.row);
        maxCol = Math.max(maxCol, pc.col);
        maxRow = Math.max(maxRow, pc.row);
      }
    }
  }
  // Pad a parts-bbox capture by one cell so pins sit on a clear edge ring; an explicit drawn rect is
  // used as-is (the player already sized the margin they want).
  const PAD = box ? 0 : 1;
  minCol -= PAD;
  minRow -= PAD;
  maxCol += PAD;
  maxRow += PAD;
  const boxW = maxCol - minCol + 1;
  const boxH = maxRow - minRow + 1;
  const shiftCol = REGION_FRAME_ORIGIN.col - minCol;
  const shiftRow = REGION_FRAME_ORIGIN.row - minRow;
  const shiftCell = (c: Cell): Cell => ({
    col: c.col + shiftCol,
    row: c.row + shiftRow,
  });

  // Whether a board cell sits inside the captured box (the drawn rect / parts bbox).
  const inBox = (c: Cell): boolean =>
    c.col >= minCol && c.col <= maxCol && c.row >= minRow && c.row <= maxRow;
  // A JUNCTION whose cell is inside the box belongs to the subassembly — captured 1:1 with its branch
  // wiring, so a net that fans out through a junction KEEPS that junction instead of splitting into a
  // separate lead-to-each-pin. (The old `internalRoots` test wrongly excluded a junction on a BOUNDARY
  // net: it dropped the source→junction wire and re-pinned every junction→pin branch on its own — the
  // fan-out the owner saw. A junction OUTSIDE the box stays outside, and the net crosses there.)
  const capturedJ = new Set<number>();
  for (const j of full.junctions ?? []) if (inBox(j.cell)) capturedJ.add(j.id);

  // An endpoint is "captured" (inside the subassembly) when it's a pin on a region part, or a junction
  // whose cell is inside the box.
  const capturedEndpoint = (e: Endpoint): boolean =>
    isPinRef(e) ? region.has(e.componentId) : capturedJ.has(e.junctionId);

  // Place each boundary net's pin WHERE ITS TRACE ACTUALLY CROSSES the box edge (so the lead lands ON the
  // wire, not merely "near the inside pin"). Walk each wire's ROUTED path (endpoints + waypoints) and find
  // the segment that steps from inside the box to outside; the pin sits on the box edge along that
  // segment's row (a horizontal exit → a left/right edge) or column (a vertical exit → a top/bottom edge).
  // Scans wires in order, first crossing per net wins (deterministic), and works even when a net leaves
  // THROUGH a junction (the test is geometric, not "must be a pin-to-pin wire"). `clamp` keeps the
  // along-edge coordinate inside the box.
  const clamp = (v: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(hi, v));
  const crossDx = new Map<string, { dx: number; dy: number }>();
  for (const w of full.wires) {
    const root = find(endpointKey(w.from));
    if (!pinIndexOf.has(root) || crossDx.has(root)) continue;
    const a = graph.endpointCell(w.from);
    const b = graph.endpointCell(w.to);
    if (!a || !b) continue;
    const path: Cell[] = [a, ...(w.waypoints ?? []), b];
    for (let s = 0; s + 1 < path.length; s++) {
      const p = path[s];
      const q = path[s + 1];
      if (inBox(p) === inBox(q)) continue; // this segment doesn't straddle the boundary
      const insidePt = inBox(p) ? p : q;
      const outsidePt = inBox(p) ? q : p;
      let dx: number;
      let dy: number;
      if (insidePt.row === outsidePt.row) {
        // horizontal exit → a vertical (left/right) edge, at the trace's row
        dx = outsidePt.col < minCol ? 0 : boxW - 1;
        dy = clamp(insidePt.row - minRow, 0, boxH - 1);
      } else if (insidePt.col === outsidePt.col) {
        // vertical exit → a horizontal (top/bottom) edge, at the trace's column
        dy = outsidePt.row < minRow ? 0 : boxH - 1;
        dx = clamp(insidePt.col - minCol, 0, boxW - 1);
      } else {
        // diagonal (a non-orthogonal waypoint, rare) — clamp the outside point onto the nearest edge
        dx = clamp(outsidePt.col - minCol, 0, boxW - 1);
        dy = clamp(outsidePt.row - minRow, 0, boxH - 1);
      }
      crossDx.set(root, { dx, dy });
      break;
    }
  }
  const pinGeom: { dx: number; dy: number; name?: string }[] = new Array(
    boundaryRoots.length,
  );
  const pinNames: string[] = [];
  const pinRoles: PinRole[] = [];
  // Box-edge cells, clockwise from the top-left, so a colliding pin can walk to the next FREE edge cell
  // — two leads must never share a cell (the outer board's pin-at-cell resolves only one, audit).
  const perimeter: { dx: number; dy: number }[] = [];
  for (let x = 0; x < boxW; x++) perimeter.push({ dx: x, dy: 0 });
  for (let y = 1; y < boxH; y++) perimeter.push({ dx: boxW - 1, dy: y });
  for (let x = boxW - 2; x >= 0; x--) perimeter.push({ dx: x, dy: boxH - 1 });
  for (let y = boxH - 2; y >= 1; y--) perimeter.push({ dx: 0, dy: y });
  const claimed = new Set<string>();
  const claimCell = (dx: number, dy: number): { dx: number; dy: number } => {
    if (!claimed.has(dx + "," + dy)) {
      claimed.add(dx + "," + dy);
      return { dx, dy };
    }
    let start = perimeter.findIndex((p) => p.dx === dx && p.dy === dy);
    if (start < 0) start = 0;
    for (let k = 1; k <= perimeter.length; k++) {
      const c = perimeter[(start + k) % perimeter.length];
      const key = c.dx + "," + c.dy;
      if (!claimed.has(key)) {
        claimed.add(key);
        return c;
      }
    }
    return { dx, dy }; // every edge cell taken (a tiny box, very rare) — keep it
  };
  // Characterize each boundary net from what it touches OUTSIDE the box (§2.9). Reliable: GND (touches a
  // ground) and OUTPUTS (nothing outside drives the net → the subassembly itself does). Best-effort: the
  // first DC-supply net is VCC; any further source-driven net (a second DC supply, or an AC/PULSE signal)
  // is an INPUT. VCC-vs-input among DC sources is genuinely ambiguous from the static graph, so the player
  // can swap a pin's role in the die editor (the stimulus follows the role). Distinct names so two supplies
  // never both read "VCC".
  let vccTaken = false;
  let inN = 0;
  let outN = 0;
  boundaryRoots.forEach((root, i) => {
    const cross = crossDx.get(root);
    let dx: number;
    let dy: number;
    if (cross) {
      dx = cross.dx;
      dy = cross.dy;
    } else {
      // No wire path crossed the edge for this net (e.g. it's joined only by a same-name alias, no wire) —
      // park it on the left edge so it still gets a distinct lead.
      dx = 0;
      dy = clamp(i, 0, boxH - 1);
    }
    ({ dx, dy } = claimCell(dx, dy)); // ensure a distinct edge cell
    const kinds = outsideKinds.get(root) ?? new Set<string>();
    let name: string;
    if (kinds.has("GND")) {
      name = "GND";
      pinRoles[i] = "gnd";
    } else if (kinds.has("V") && !vccTaken) {
      name = "VCC"; // first DC supply rail
      pinRoles[i] = "vcc";
      vccTaken = true;
    } else if (kinds.has("V") || kinds.has("AC") || kinds.has("PULSE")) {
      inN += 1; // driven from outside by a (further) source → an input
      name = inN === 1 ? "IN" : "IN" + inN;
      pinRoles[i] = "in";
    } else {
      outN += 1; // nothing outside drives it → the subassembly drives it → an output (observed)
      name = outN === 1 ? "Y" : "Y" + outN;
      pinRoles[i] = "out";
    }
    pinNames[i] = name;
    pinGeom[i] = { dx, dy, name };
  });

  return {
    ok: true,
    full,
    find,
    capturedEndpoint,
    inBox,
    pinIndexOf,
    boundaryRoots,
    capCompsRaw,
    minCol,
    minRow,
    boxW,
    boxH,
    shiftCell,
    pinGeom,
    pinNames,
    pinRoles,
  };
}

/** A live region-capture PREVIEW (the overlay the live rectangle tool draws as you size the box): the box
 * in ABSOLUTE board cells + each inferred pin's absolute cell and auto-label, so the HUD can render a dot
 * + tag exactly where {@link captureRegion} would seal one. `ok:false` carries the refusal reason. Pure
 * read — registers nothing, mutates nothing. */
export type RegionPreview =
  | { ok: false; reason: "empty" | "no-boundary" | "too-many" }
  | {
      ok: true;
      minCol: number;
      minRow: number;
      w: number;
      h: number;
      pins: { col: number; row: number; name: string }[];
    };

export function previewRegion(
  graph: BoardGraph,
  regionIds: number[],
  box?: RegionBox,
): RegionPreview {
  const region = new Set(regionIds.filter((id) => graph.components.has(id)));
  if (region.size === 0) return { ok: false, reason: "empty" };
  const a = analyzeRegion(graph, region, box);
  if (!a.ok) return a;
  return {
    ok: true,
    minCol: a.minCol,
    minRow: a.minRow,
    w: a.boxW,
    h: a.boxH,
    // Pin dx/dy are box-relative; the box top-left sits at (minCol,minRow) in board cells.
    pins: a.pinGeom.map((p) => ({
      col: a.minCol + p.dx,
      row: a.minRow + p.dy,
      name: p.name ?? "",
    })),
  };
}

/**
 * OVERWORLD CAPTURE (§4.9) — turn a box-selected region of the board into a bare `role='subassembly'`
 * cell, inferring the pinout from the nets that cross the selection boundary. NON-DESTRUCTIVE: it reads
 * the board and registers a new subassembly (which appears in "My Subassemblies"); it does NOT modify
 * the player's board.
 *
 * FAITHFUL 1:1 COPY (§4.10): the captured cell is the selection copied EXACTLY — parts keep their
 * relative positions, internal wires are verbatim, and the box is a FREE-FORM frame the size of the
 * selection's bounding box (not a stock package). The boundary rule: union-find the wire graph into nets;
 * a net with at least one endpoint INSIDE (a pin on a selected part) AND one OUTSIDE (a pin on a
 * non-selected part — including a board VCC/GND/source) becomes a **pin**, placed ON the box edge in the
 * outside endpoint's direction, aligned with the inside pin — i.e. where the wire actually crossed. Each
 * crossing wire keeps its inside routing and retargets its OUTSIDE end to that pin (flatten fuses by
 * INDEX, so connectivity is one-node-per-net regardless of pin placement). Pin cells are de-duplicated
 * onto distinct edge cells; the box bbox is rotation-aware. A region with no boundary net (nothing leaves
 * the selection) or more than {@link BLOCK_MAX_PINS} crossings is refused. Rails auto-named GND / VCC.
 *
 * Web-only graph→graph: nothing runs in sim-core or crosses the hashed boundary, and the golden places
 * no user IC. A captured subassembly reaches the board via Tape out ({@link tapeOut}).
 */
export function captureRegion(
  graph: BoardGraph,
  regionIds: number[],
  name?: string,
  box?: RegionBox,
): RegionCapture | undefined {
  const region = new Set(regionIds.filter((id) => graph.components.has(id)));
  if (region.size === 0) return undefined;
  const trimmed = name && name.trim() ? name.trim() : "";
  if (trimmed && isReservedTag(trimmed)) return undefined;
  // Duplicate-name guard (audit): refuse a region capture whose name already names a user IC / family —
  // else it silently overwrites that def + its global geometry under every placed instance.
  if (trimmed && (REGISTRY.has(trimmed) || FAMILIES.has(trimmed)))
    return undefined;

  // The pins-at-crossings + box geometry (the pure analysis shared with the live overlay preview).
  const a = analyzeRegion(graph, region, box);
  if (!a.ok) return undefined; // no boundary net, or too many pins for a free-form block
  const {
    full,
    find,
    capturedEndpoint,
    inBox,
    pinIndexOf,
    boundaryRoots,
    capCompsRaw,
    boxW,
    boxH,
    shiftCell,
    pinGeom,
    pinNames,
    pinRoles,
  } = a;

  // Register the free-form die frame (its kind carries the box + pins-at-crossings), then build the
  // captured graph as a 1:1 copy: parts at their shifted positions, internal wires verbatim, each
  // crossing wire retargeted to its net's frame pin (keeping the inside routing).
  const tag = trimmed || nextAutoTag();
  const frameKind = registerFreeFormFrame(tag, {
    w: boxW,
    h: boxH,
    pins: pinGeom,
  });

  const capComps = capCompsRaw.map((c) => ({
    ...c,
    cell: shiftCell(c.cell),
    ...(c.pinNames ? { pinNames: [...c.pinNames] } : {}),
    ...(c.pinTests
      ? { pinTests: c.pinTests.map((t) => (t ? { ...t } : null)) }
      : {}),
  }));
  const maxId = (ids: number[]): number =>
    ids.reduce((m, i) => Math.max(m, i), 0);
  const frameId =
    maxId([
      ...capCompsRaw.map((c) => c.id),
      ...full.wires.map((w) => w.id),
      ...(full.junctions ?? []).map((j) => j.id),
      ...(full.netLabels ?? []).map((l) => l.id),
    ]) + 1;

  const capWires: Wire[] = [];
  for (const w of full.wires) {
    const fromIn = capturedEndpoint(w.from);
    const toIn = capturedEndpoint(w.to);
    const wp =
      w.waypoints && w.waypoints.length > 0
        ? { waypoints: w.waypoints.map(shiftCell) }
        : {};
    if (fromIn && toIn) {
      // Internal wire — verbatim (shifted).
      capWires.push({ id: w.id, from: { ...w.from }, to: { ...w.to }, ...wp });
    } else if (fromIn !== toIn) {
      // Crossing wire — retarget the OUTSIDE end to the net's frame pin, keep the inside end + routing.
      // The inside end is whichever endpoint is captured: a region PIN *or* a captured JUNCTION. Accepting
      // a junction here is what keeps a net that exits THROUGH a junction 1:1 — the source→junction wire
      // becomes frame_pin→junction, and the junction's internal branches stay (no fan-out to each pin).
      const insideE = fromIn ? w.from : w.to;
      const pi = pinIndexOf.get(find(endpointKey(insideE)));
      if (pi === undefined) continue; // inside end isn't on a boundary net (no frame pin) — skip
      const frameEnd = { componentId: frameId, pinIndex: pi };
      // Keep only the INSIDE part of the routing. A crossing wire's OUTSIDE waypoints (between the box
      // edge and the original outside endpoint) would make the retargeted lead OVERSHOOT past the frame
      // pin — the stray stub the owner saw. The frame pin sits at the crossing cell, so the inside
      // waypoints continue cleanly from it; if none survive, the lead routes straight to the inside end.
      const insideWaypts = (w.waypoints ?? []).filter(inBox);
      const cwp =
        insideWaypts.length > 0
          ? { waypoints: insideWaypts.map(shiftCell) }
          : {};
      capWires.push({
        id: w.id,
        from: fromIn ? { ...w.from } : frameEnd,
        to: fromIn ? frameEnd : { ...w.to },
        ...cwp,
      });
    }
  }
  // Junctions referenced by a copied wire.
  const usedJ = new Set<number>();
  for (const w of capWires) {
    if (isJunctionRef(w.from)) usedJ.add(w.from.junctionId);
    if (isJunctionRef(w.to)) usedJ.add(w.to.junctionId);
  }
  const capJuncs: Junction[] = (full.junctions ?? [])
    .filter((j) => usedJ.has(j.id))
    .map((j) => ({
      id: j.id,
      cell: shiftCell(j.cell),
      ...(j.free ? { free: true } : {}),
    }));

  // Auto-set the frame's per-pin TEST STIMULI from the derived roles, so a captured subassembly opened in
  // the die editor arrives already powered (VCC/GND/inputs driven) and reads "● solvable" — the player no
  // longer dials in each stimulus by hand (§2.9). An OUTPUT is observed, so it gets no stimulus (null).
  const framePinTests: (PinTest | null)[] = pinRoles.map((r) =>
    r === "gnd"
      ? { role: "gnd", value: 0 }
      : r === "vcc"
        ? { role: "vcc", value: 5 }
        : r === "in" || r === "clk"
          ? { role: "in", value: 0 }
          : null,
  );

  // The free-form die frame component (kind = the registered free-form geometry).
  capComps.push({
    id: frameId,
    kind: frameKind,
    cell: { ...REGION_FRAME_ORIGIN },
    value: 0,
    rot: 0,
    pinNames: pinGeom.map((p) => p.name ?? ""),
    ...(framePinTests.some((t) => t) ? { pinTests: framePinTests } : {}),
  } as (typeof capComps)[number]);

  // Carry net labels anchored on a captured endpoint (keep the inner net names).
  const capLabels: NetLabel[] = (full.netLabels ?? [])
    .filter((l) => {
      if (isJunctionRef(l.at)) return usedJ.has(l.at.junctionId);
      return isPinRef(l.at) && region.has(l.at.componentId);
    })
    .map((l) => ({
      id: l.id,
      name: l.name,
      at: { ...l.at },
      ...(l.pos ? { pos: shiftCell(l.pos) } : {}),
      ...(l.tagOff ? { tagOff: { ...l.tagOff } } : {}),
      ...(l.color !== undefined ? { color: l.color } : {}),
    }));

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

  registerUserIc({
    tag,
    name: trimmed || tag,
    package: { archetype: BLOCK_ARCHETYPE, pinCount: boundaryRoots.length },
    freeForm: { w: boxW, h: boxH, pins: pinGeom },
    frameId,
    graph: snapshot,
    pinNames: [...pinNames],
    ...(pinRoles.some((r) => r) ? { pinRoles: [...pinRoles] } : {}),
    role: "subassembly",
  });
  return { tag, pinCount: boundaryRoots.length };
}

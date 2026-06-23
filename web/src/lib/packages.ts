// SPDX-License-Identifier: Apache-2.0
// Package-format library for the IC maker (ADR 0006). A user-authored (or built-in) IC's footprint
// comes from a PACKAGE ARCHETYPE rather than hand-placed pin offsets: each archetype turns a pin
// count into a deterministic lead layout (positions, numbering, pin-1) plus a die-area policy —
// "fixed" (the rigid standardised small-outline parts: SOT-23 / SC70 / MSOP — the author must fit
// the circuit inside the standard body) or "expandable" (the looser families: VSSOP / DIP / SOIC /
// SSOP / TSSOP — the body grows to fit). Positions are in board GRID CELLS (dx, dy), matching the
// `pin(label, dx, dy)` convention in graph.ts, so a package layout drops straight into a kind/footprint.
//
// This is presentation + geometry only: it never enters the solve or the hash (the simulation sees
// the expanded sub-netlist; the package just says where the pins sit and how they're numbered).

/** Whether a package locks its die to the standard body or lets it grow to fit the circuit. */
export type DiePolicy = "fixed" | "expandable";

/** How the leads are arranged on the body. */
type PackageFamily = "dual" | "sot23" | "sip";

/** One numbered lead, positioned in board grid cells (matching graph.ts pin offsets). */
export interface PackagePin {
  number: number; // 1-based package pin number
  dx: number;
  dy: number;
}

/** The footprint a package archetype produces for a given pin count. */
export interface PackageLayout {
  archetype: string;
  pinCount: number;
  policy: DiePolicy;
  /** footprint extent in grid cells (the bounding box the build must stay inside — the "barrier"). */
  w: number;
  h: number;
  pins: PackagePin[]; // numbered leads, by ascending pin number
  pin1: { dx: number; dy: number }; // the pin-1 marker corner
}

interface Archetype {
  family: PackageFamily;
  policy: DiePolicy;
  /** allowed pin counts (the starter set; the library is open-ended — add more as needed). */
  counts: number[];
}

// The starter set (ADR 0006): SOT-23-3/5/6 fixed; VSSOP-8 + DIP-8/14/16 expandable. 3..16 pins.
// More archetypes (SOIC/TSSOP/SC70/MSOP, the quad QFP/QFN, through-hole TO-92/TO-220) drop in here.
export const PACKAGE_ARCHETYPES: Record<string, Archetype> = {
  "SOT-23": { family: "sot23", policy: "fixed", counts: [3, 5, 6] },
  VSSOP: { family: "dual", policy: "expandable", counts: [8] },
  DIP: { family: "dual", policy: "expandable", counts: [8, 14, 16] },
};

/** Every (archetype, pinCount) the starter library offers, e.g. for a package picker. */
export function packageOptions(): { archetype: string; pinCount: number }[] {
  const out: { archetype: string; pinCount: number }[] = [];
  for (const [archetype, a] of Object.entries(PACKAGE_ARCHETYPES)) {
    for (const pinCount of a.counts) out.push({ archetype, pinCount });
  }
  return out;
}

/** Dual-in-line layout (DIP/SOIC/TSSOP/VSSOP): two rows, pin 1 top-left, numbering down the left
 * side then up the right (the standard CCW order). */
function dualLayout(pinCount: number): {
  w: number;
  h: number;
  pins: PackagePin[];
} {
  const half = Math.max(1, Math.ceil(pinCount / 2));
  const pins: PackagePin[] = [];
  for (let i = 0; i < pinCount; i++) {
    const n = i + 1;
    if (n <= half) {
      pins.push({ number: n, dx: 0, dy: n - 1 }); // left column, top -> bottom
    } else {
      const k = n - half; // 1..(pinCount-half) up the right column
      pins.push({ number: n, dx: 2, dy: half - k }); // right column, bottom -> top
    }
  }
  return { w: 3, h: half, pins };
}

/**
 * The real SOT-23 family lead slots as `(col, row)` on the 3-wide body (`row 1` = bottom edge,
 * `row 0` = top edge; `col 0` = left … `col 2` = right), by ascending pin number — matching the
 * JEDEC pinouts the owner called out:
 *   - **-3**: pin 1 bottom-left, pin 2 bottom-right, pin 3 **centered on top** (bottom-middle empty).
 *   - **-5**: pins 1-3 along the bottom, then pin 4 **top-right** and pin 5 **top-left**
 *     (the **top-middle slot is empty** — the gap a real SOT-23-5 has).
 *   - **-6**: all six slots filled (bottom 1-3 left→right, top 4-6 right→left).
 * Pin index `i` is pin number `i + 1`, so the seal's index→number order is unchanged (positions
 * only). Presentation/geometry — never enters the solve or hash.
 */
function sot23Slots(pinCount: number): { col: number; row: number }[] {
  if (pinCount === 3) {
    return [
      { col: 0, row: 1 }, // pin 1 — bottom-left
      { col: 2, row: 1 }, // pin 2 — bottom-right
      { col: 1, row: 0 }, // pin 3 — top-centre
    ];
  }
  // The family's expansions: the bottom row fills left→right, then the rest fill the top row
  // right→left. A 5-lead part omits the TOP-MIDDLE slot (col 1).
  const bottom = Math.min(3, pinCount);
  const slots: { col: number; row: number }[] = [];
  for (let c = 0; c < bottom; c++) slots.push({ col: c, row: 1 });
  const topCols = pinCount === 5 ? [2, 0] : [2, 1, 0];
  for (let i = 0; i < pinCount - bottom; i++) {
    slots.push({ col: topCols[i] ?? 0, row: 0 });
  }
  return slots;
}

/** SOT-23 family production footprint: the real {@link sot23Slots} positions on the tight 3-wide,
 * 2-tall body (`dx = col`, `dy = row`). */
function sot23Layout(pinCount: number): {
  w: number;
  h: number;
  pins: PackagePin[];
} {
  const pins: PackagePin[] = sot23Slots(pinCount).map((s, i) => ({
    number: i + 1,
    dx: s.col,
    dy: s.row,
  }));
  const w = pins.reduce((m, p) => Math.max(m, p.dx), 0) + 1;
  return { w, h: 2, pins };
}

/** Single-in-line layout (SIP): one row, pin 1 at the left. */
function sipLayout(pinCount: number): {
  w: number;
  h: number;
  pins: PackagePin[];
} {
  const pins: PackagePin[] = [];
  for (let i = 0; i < pinCount; i++) pins.push({ number: i + 1, dx: i, dy: 0 });
  return { w: Math.max(1, pinCount), h: 1, pins };
}

/**
 * Resolve a package archetype + pin count to a concrete footprint layout. Unknown archetypes fall
 * back to a dual-in-line body so the maker never has nothing to draw.
 */
export function packageLayout(
  archetype: string,
  pinCount: number,
): PackageLayout {
  const a = PACKAGE_ARCHETYPES[archetype];
  const family: PackageFamily = a?.family ?? "dual";
  const policy: DiePolicy = a?.policy ?? "expandable";
  const geo =
    family === "sot23"
      ? sot23Layout(pinCount)
      : family === "sip"
        ? sipLayout(pinCount)
        : dualLayout(pinCount);
  const pin1 = geo.pins.find((p) => p.number === 1) ?? { dx: 0, dy: 0 };
  return {
    archetype,
    pinCount,
    policy,
    w: geo.w,
    h: geo.h,
    pins: geo.pins,
    pin1: { dx: pin1.dx, dy: pin1.dy },
  };
}

/**
 * Cells between adjacent perimeter pins on a {@link dieLayout}, and the inset from each corner.
 * A roomy spread (pins {@link DIE_PIN_PITCH} cells apart, {@link DIE_CORNER_INSET} in from the
 * ends) so the die's walls read as a real package edge with the interior left empty for building —
 * the inverse of {@link packageLayout}'s tight body. Presentation/geometry only.
 */
export const DIE_PIN_PITCH = 4;
export const DIE_CORNER_INSET = 3;

/**
 * The die's CROSS-AXIS interior span (in cells): the build depth between the two pinned edges of a
 * dual/SOT die (the width of a dual body, the height of a SOT/SIP body). Big on purpose — the die
 * editor is a full authoring canvas, so it must hold the "tons of components" an IC's circuit needs,
 * not just a token gap between the leads. The long axis grows separately with the pin count
 * ({@link edgeSpan}). Presentation/geometry only — never enters the solve or hash.
 */
export const DIE_INTERIOR_SPAN = 28;

/** Span (in cells) an edge needs to seat `n` pins at {@link DIE_PIN_PITCH} with a corner inset on
 * each end: `2*inset + (n-1)*pitch`. At least one pitch wide so a single-pin edge still has a body. */
function edgeSpan(n: number): number {
  return 2 * DIE_CORNER_INSET + Math.max(1, n - 1) * DIE_PIN_PITCH;
}

/** Dual die: pins down the LEFT edge (1..half, top->bottom) and up the RIGHT edge (half+1..N,
 * bottom->top) — the classic DIP arrangement, spanning a roomy die. SAME pin numbering/order as
 * {@link dualLayout}, so pin INDEX i is the same lead in both (the seal maps straight through). */
function dualDie(pinCount: number): {
  w: number;
  h: number;
  pins: PackagePin[];
} {
  const half = Math.max(1, Math.ceil(pinCount / 2));
  const h = edgeSpan(half); // long axis: pins down each column, spread by pitch
  const w = DIE_INTERIOR_SPAN; // cross axis: the roomy build width between the two columns
  const pins: PackagePin[] = [];
  for (let i = 0; i < pinCount; i++) {
    const n = i + 1;
    if (n <= half) {
      // left column, top -> bottom
      pins.push({
        number: n,
        dx: 0,
        dy: DIE_CORNER_INSET + (n - 1) * DIE_PIN_PITCH,
      });
    } else {
      const k = n - half; // 1..(pinCount-half) up the right column
      pins.push({
        number: n,
        dx: w,
        dy: DIE_CORNER_INSET + (half - k) * DIE_PIN_PITCH,
      });
    }
  }
  return { w, h, pins };
}

/** SOT-23 die: the real {@link sot23Slots} positions spread onto the roomy die — each slot column
 * mapped to a pitch-spaced `dx`, and its row to the bottom (`dy = h`) or top (`dy = 0`) edge. SAME
 * pin numbering/index order as {@link sot23Layout}, so the seal maps each lead straight through. */
function sot23Die(pinCount: number): {
  w: number;
  h: number;
  pins: PackagePin[];
} {
  const slots = sot23Slots(pinCount);
  const maxCol = slots.reduce((m, s) => Math.max(m, s.col), 0);
  const w = edgeSpan(maxCol + 1); // long axis: the slot columns spread by pitch
  const h = DIE_INTERIOR_SPAN; // cross axis: the roomy build height between the two rows
  const pins: PackagePin[] = slots.map((s, i) => ({
    number: i + 1,
    dx: DIE_CORNER_INSET + s.col * DIE_PIN_PITCH,
    dy: s.row === 1 ? h : 0,
  }));
  return { w, h, pins };
}

/** SIP die: all pins along the bottom edge, left->right. SAME order as {@link sipLayout}. */
function sipDie(pinCount: number): {
  w: number;
  h: number;
  pins: PackagePin[];
} {
  const w = edgeSpan(pinCount); // long axis: all pins along the bottom row, spread by pitch
  const h = DIE_INTERIOR_SPAN; // cross axis: the roomy build height above the row
  const pins: PackagePin[] = [];
  for (let i = 0; i < pinCount; i++) {
    pins.push({
      number: i + 1,
      dx: DIE_CORNER_INSET + i * DIE_PIN_PITCH,
      dy: h,
    });
  }
  return { w, h, pins };
}

/**
 * The DIE-EDITOR footprint for a package: a LARGE body whose pins sit on the PERIMETER edges,
 * spaced {@link DIE_PIN_PITCH} cells apart, with the interior left empty for authoring the IC's
 * circuit (the inverse of {@link packageLayout}'s tight production body). It is a VISUAL relayout
 * ONLY: the pins carry the SAME `number`s in the SAME index order as {@link packageLayout}, so a
 * die frame's pin index i is the same lead as the sealed chip's pin index i — the seal-as-same-
 * netlist contract and the (small) sealed footprint are unchanged. Never enters the solve or hash.
 *
 * Unknown archetypes fall back to a dual perimeter so the editor always has a die to draw.
 */
export function dieLayout(archetype: string, pinCount: number): PackageLayout {
  const a = PACKAGE_ARCHETYPES[archetype];
  const family: PackageFamily = a?.family ?? "dual";
  const policy: DiePolicy = a?.policy ?? "expandable";
  const geo =
    family === "sot23"
      ? sot23Die(pinCount)
      : family === "sip"
        ? sipDie(pinCount)
        : dualDie(pinCount);
  const pin1 = geo.pins.find((p) => p.number === 1) ?? { dx: 0, dy: 0 };
  return {
    archetype,
    pinCount,
    policy,
    w: geo.w,
    h: geo.h,
    pins: geo.pins,
    pin1: { dx: pin1.dx, dy: pin1.dy },
  };
}

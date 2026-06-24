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
 * How many cells the build-area die is enlarged from the production footprint. The die editor IS the
 * footprint scaled up EXACTLY PROPORTIONALLY by this factor — same pin layout + aspect ratio, just
 * roomy enough to author the circuit inside. Because it's a pure proportional enlargement, the sealed
 * chip's zoom-to-open view scales the authored circuit straight back down ONTO the package pins, so it
 * lines up with no re-routing. (Was a custom per-family perimeter layout at a DIFFERENT aspect — the
 * reason the zoomed-in internals didn't line up with the leads.) Presentation/geometry only.
 */
export const DIE_SCALE = 8;

/**
 * The DIE-EDITOR footprint for a package: the production {@link packageLayout} scaled up
 * PROPORTIONALLY by {@link DIE_SCALE}. SAME pin layout, SAME aspect ratio, SAME numbering + index
 * order — just larger so there's room to author the circuit inside (the pins ride the same relative
 * positions as the tight production body). Because it's an exact proportional enlargement, the seal
 * stays a 1:1 of the pins (index i ↔ the same lead) AND the zoom-to-open replica lines up by pure
 * scaling. Never enters the solve or hash.
 */
export function dieLayout(archetype: string, pinCount: number): PackageLayout {
  const pkg = packageLayout(archetype, pinCount);
  const s = DIE_SCALE;
  // A pure proportional enlargement about cell 0: an n-cell span → n*s cells (so the +1 keeps the
  // inclusive cell DIMENSION). Same pins, same aspect — just roomy to build in, and it scales straight
  // back onto the package pins when the sealed chip is zoomed open.
  return {
    ...pkg,
    w: (pkg.w - 1) * s + 1,
    h: (pkg.h - 1) * s + 1,
    pins: pkg.pins.map((p) => ({
      number: p.number,
      dx: p.dx * s,
      dy: p.dy * s,
    })),
    pin1: { dx: pkg.pin1.dx * s, dy: pkg.pin1.dy * s },
  };
}

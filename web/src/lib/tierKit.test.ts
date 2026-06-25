// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { SILICON_ZOOM, SILICON_ZOOM_FULL, siliconBlend } from "./tierKit";

// The recursive-LoD silicon leaf (Phase 3) hands off from a device-detail drawer to its
// metal-oxide cross-section purely by on-screen magnification. `siliconBlend` is that
// gate: a render-only, deterministic cross-fade weight. The device tier MUST be preserved
// where no camera scale is threaded (the info panel / codex pass `absScale: undefined`),
// so the most load-bearing case is `undefined → 0`.
describe("siliconBlend", () => {
  it("undefined absScale ⇒ 0 (info panel / codex stay on the device tier)", () => {
    expect(siliconBlend(undefined)).toBe(0);
  });

  it("is 0 at/below SILICON_ZOOM (pure device tier) and 1 at/above SILICON_ZOOM_FULL", () => {
    expect(siliconBlend(0)).toBe(0);
    expect(siliconBlend(SILICON_ZOOM - 1)).toBe(0);
    expect(siliconBlend(SILICON_ZOOM)).toBe(0); // smoothstep starts flat at the low edge
    expect(siliconBlend(SILICON_ZOOM_FULL)).toBe(1);
    expect(siliconBlend(SILICON_ZOOM_FULL + 100)).toBe(1);
  });

  it("ramps strictly monotonically across the cross-fade band, hitting ½ at the midpoint", () => {
    const mid = (SILICON_ZOOM + SILICON_ZOOM_FULL) / 2;
    expect(siliconBlend(mid)).toBeCloseTo(0.5, 12);
    let prev = -1;
    for (let s = SILICON_ZOOM; s <= SILICON_ZOOM_FULL; s += 0.25) {
      const v = siliconBlend(s);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  it("hands off DEEPER than the device-tier entry bar (board TIER_ZOOM = 2.2)", () => {
    // The silicon must not start before the device illustration reads clearly.
    expect(SILICON_ZOOM).toBeGreaterThan(2.2);
    expect(siliconBlend(2.2)).toBe(0);
  });
});

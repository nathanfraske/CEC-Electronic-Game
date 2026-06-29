# CLAUDE.md

Guidance for AI agents working in this repository. Read **HANDOFFS.md** first for
current state and **TODOS.md** for the backlog; this file is the durable
"how we work here."

## What this project is

A browser-based electronics teaching game. A deterministic, fixed-step Rust
simulation core compiles to WebAssembly and is rendered by a Vite / Svelte /
PixiJS front end. See `README.md` and `docs/architecture.md`.

## Golden rules

1. **Determinism is sacred.** Any change to `sim-core` must keep
   `cargo test -p sim-core` green, including `run_is_reproducible`. Never use the
   standard-library default hasher for a value that must reproduce across
   machines or toolchains — use the FNV-1a snapshot hash. If you deliberately
   change behavior, regenerate the golden and explain why in the PR. See
   `docs/determinism.md`.
2. **Keep the JS↔wasm boundary coarse:** one batched snapshot read per frame in
   `web/src/sim/loop.ts`. Never call across the boundary per component or message.
3. **SPDX header on every source file:** `SPDX-License-Identifier: Apache-2.0`
   (in `.rs .ts .js .svelte .css .sh .yml` and HTML comments). JSON config files
   are exempt — they have no safe comment syntax.
4. **Apache-2.0.** `LICENSE` is the canonical text — never reword it. New files
   get the SPDX header; see `CONTRIBUTING.md`.

## Verification gates (run before every push; CI runs the same set)

```
cargo fmt --all -- --check
cargo clippy -p sim-core -p sim-protocol --all-targets -- -D warnings
cargo test -p sim-core -p sim-protocol
pnpm run build:wasm
pnpm -C web check
pnpm -C web lint
pnpm -C web build
pnpm -C web test
```

`pnpm -C web format` rewrites files with Prettier (use before `lint`). `pnpm -C web test` runs the
headless **vitest** suite (e.g. `web/src/lib/netlist.test.ts`) — `buildNetlist` imports glyphs as types
only, so it compiles in node, letting us verify determinism-critical compilation (the IC-maker seal
expanding to the same netlist as the inline circuit) without a browser.

**SEE + DRIVE the live app — don't guess.** Chromium + Playwright are pre-installed (never run
`playwright install`), so any visual change (`board.ts`, the drawers, glyphs, `App.svelte`) can be
exercised and Read back. **Never claim a render can't be verified.** Three ways in:
- **SEE** — `pnpm -C web shoot --out /tmp/x.png [--fixture <ceccircuit.json>]
  [--lens reality|analogy|schematic] [--zoom <pxPerWorldPx>] [--center <componentId>]`, then Read the PNG
  (`web/scripts/shoot.mjs`).
- **DRIVE** — `pnpm -C web replay --bundle <cec-feedback.json> --drive [--filmstrip]` re-walks a recorded
  action journal from a clean boot (`web/scripts/replay.mjs`).
- **LIVE** — the **`cec-app` MCP server** (`.mcp.json`, `web/scripts/mcp-app.mjs`) keeps ONE app session
  alive across calls: `cec_open` / `cec_screenshot` / `cec_eval` (run JS in the page — place parts, call
  `window.__cecView`, read sim state) / `cec_close`. No per-shot reboot, no throwaway fixtures.

The wasm core also runs headless in node (`initSync`) for deterministic drive→step→read tests.

## Design system (the look)

Mirrors **criticalerrorcomputing.com** — a dark bench-instrument / HUD aesthetic.
Tokens live in `web/src/app.css`; the same palette is mirrored as hex in
`web/src/lib/board.ts` for the GPU.

- **Surfaces:** dark blue-violet OKLCH (hue ~285), layered `--bg`→`--surface-2`.
- **Accent:** vivid rose `oklch(.64 .255 350)`. **Signals:** violet, cyan,
  green (`--ok`), amber (`--warn`), bronze, red (`--bad`).
- **Type:** `Saira` (body), `Saira Condensed` (display — uppercase, wide
  tracking), `IBM Plex Mono` (telemetry/data).
- **Motifs:** faint grids, neon glows, small radii (2–4px), uppercase tracked
  labels. Use the CSS custom properties — do not hardcode colors.
- **Power-bus visual language** (how voltage vs current are shown): spec in
  `docs/ui/visual-language.md`, interactive reference `docs/ui/dc-bus-reference.html`.
  Voltage = **identity colour + a pre-attentive magnitude channel** (a segmented LED
  bar in Reality, a water standpipe/height in Analogy); current = flow + thickness +
  number; KCL at taps; IR-drop sag. **Rail identity colour** (`voltageColor` in
  `board.ts`) uses the **conventional PC/bench wire code** so a rail reads at a glance:
  +3.3V orange, +5V red, +12V yellow, +1.8V violet, GND dark, −12V blue, −5V cyan, and
  higher rails (24/48V→mains) ramp hotter/whiter. Signed + unclamped (a −5V rail is no
  longer ground-grey). Magnitude lives on the bar/standpipe, NOT the hue. (The op-amp
  detail drawers' `--pos/--neg/--out` tokens are input-polarity colours, a separate use.)

## Where things live

| Path | Role |
| --- | --- |
| `crates/sim-core` | deterministic engine; host-tested, no browser deps |
| `crates/sim-protocol` | wire types only, no logic |
| `crates/sim-wasm` | thin wasm-bindgen layer |
| `web/src/sim/loop.ts` | the once-per-frame wasm boundary |
| `web/src/lib/board.ts` | PixiJS renderer (grid + signal traces) |
| `web/src/lib/thermal.ts` | lumped self-heating model (`P=V·I`→`Tj`); web-only, golden-safe, tick-driven (`docs/heat-on-the-board-ideation.md`) |
| `web/src/App.svelte` | HUD shell |
| `web/src/app.css` | design tokens + component styles |
| `web/src/lib/examples.ts` | worked examples; `savedExample()` turns a board **Save** JSON into one |
| `web/src/lib/circuits/` | saved-circuit modules (paste a downloaded `.json` into a tiny `.ts` wrapper) |
| `web/src/wasm/` | **generated** by `build:wasm`; gitignored; never edit |
| `docs/` | architecture, determinism contract, ADRs |
| `docs/ui/ic-glyph-spec.md` | **authoring spec for the five-tier IC glyphs** (interactive teaching refsheets) — read it before building any IC glyph; refsheets live in `docs/ui/parts/` |

## IC glyphs (teaching refsheets)

Integrated circuits are taught with **five-tier IC glyphs**: self-contained interactive HTML
files showing one chip at five zoom levels (symbol → flow → valves → device → silicon) over its
real package/pinout. The complete build spec is **`docs/ui/ic-glyph-spec.md`** (house style,
helpers, the device model, the shared package frame, per-tier patterns, validation gates, and a
worked NAND example). The canonical template is the 74LVC1G04 inverter `inv-ic.html`; reference
implementations are provided by the owner over time and live in **`docs/ui/parts/`** beside the
existing per-part tier studies. When asked to build/extend an IC glyph, start from the spec and
the nearest existing refsheet — do not recall pinouts from memory (the spec requires datasheet
verification), and run the spec's validation gates (§10) before handing back.

## Convenience primitives → track for owner chip-art refinement

A **convenience primitive** is an engine/web shortcut — a behavioral element (`ELEM_BEHAVIORAL` programs:
LUT/SPI/UART/SAR/CTR/SDM; the planned `ELEM_MEMORY` ROM/RAM/EEPROM) or a pseudo-part (`PULSE`, `SHUNT`) —
that does the work of a whole circuit and ships with a **default auto-generated package + glyph** so it's
usable immediately. The **owner re-authors each as a proper reference-design chip** (real package, datasheet
pinout, clean glyph) in the IC editor; the re-skin is a visual/package wrapper that maps the owner's pin
layout to the element's terminal order (`BEH_SPEC.term`) and **does not change the `ELEM_*`**.

**Rule:** whenever you add a convenience primitive, ship a working default representation AND add an entry
to **`docs/ic-reference-library.md`** marked `needs-chip`. That file is the owner's master checklist for the
whole **IC reference library** (every IC-class part rebuilt by hand as a reference-design chip) — don't
delete entries, flip them to `refined` when the hand-built chip lands.

## Component grades (tiers)

Components with real quality grades carry a `tier` (budget / mid-range / high-end /
lab-grade — `Component.tier`, default mid-range). The inspector shows a tier picker for any
kind where `hasTiers` is true. Each tier is a **preset bundle of the device's model
parameters**, defined in **`web/src/lib/tiers.ts`**:

- **Param-block kinds** (op-amp GBW; cap ESR/ESL; inductor DCR/Cw; source output impedance;
  MOSFET Kp; BJT β): `tierParams(kind, tier)` → the per-element `Element::params` block,
  **wired in `crates/sim-core`** via `param_or(&e.params, slot, default)`. The slot map is
  mirrored in `tiers.ts`; a `0` slot means the kind default, so mid-range ≈ the sim-core
  default and the golden is untouched.
- **Web-expansion kinds** (electrolytic ESR via `ecEsr`; resistor tolerance via
  `resistorTolerance`): the tier sets a value used directly in `buildNetlist`'s element
  emission/expansion — no sim-core param.

**Realistic-mode gate.** A tier's non-idealities bite **only in Real (realistic) mode** — in
Ideal mode every part is its nominal self regardless of tier. Where the gate lives depends on
what the param affects:
- **AC-only params** (op-amp GBW, cap ESR/ESL, inductor DCR/Cw) gate **inside sim-core**'s
  `ac_solve_models(omega, real)`; their param block is installed in both modes (harmless to
  the transient solve, which never reads those slots).
- **Transient params** (source output impedance, MOSFET Kp, BJT β, resistor tolerance) gate
  **web-side in `buildNetlist`** — skipped when `!real` (see `TRANSIENT_TIER_KINDS`). Resistor
  tolerance also deviates the value deterministically per component id (`jitter`).
- **Capacitor leakage** (`CAP_LEAK_SLOT` = 5, a transient param in the reserved slot range): a cap's
  self-discharge time constant `tau`, emitted **web-side Real-mode-only** per quality tier via a
  dedicated `capLeakTau`/`ecLeakTau` (NOT the `tierParams` ESR/ESL block — that's AC-only). sim-core
  stamps a parallel leak conductance `G = C/tau` in **both transient solves** (`cap_leak_g`), so a
  charged cap self-discharges (a held cap — DRAM 1T1C cell, sample-and-hold — loses its value;
  electrolytics leak ~5× a film cap; filter caps with `tau ≫` their signal period are untouched).
  `tau = 0` (Ideal / every existing netlist / the **RC golden's cap**) → no leak → byte-identical.
  Game-scaled (seconds), realistic ordering — like diode `TT`.

**Convention — every new component with real grades ships with its tier presets from the
start:** add it to `tiers.ts` (wire its params in sim-core, or expand it web-side), make
mid-range match the existing default, decide AC-only vs transient (and add transient kinds to
`TRANSIENT_TIER_KINDS`), and keep the slot map in sync with `Element::params` in
`crates/sim-core/src/lib.rs`. (Some kinds resist a clean tier: e.g. the transformer's ideal-T
model hard-couples its secondary for rectifier stability, so its safe knobs — `rp`/`Lmag` —
don't droop the loaded output, and the knob that would — secondary leakage — is the
inrush-stability control; it is deliberately left un-tiered.)

## Device variants & ratings (distinct from quality tiers)

Some kinds vary by **type/identity**, not quality — a diode's family (switching / rectifier /
fast-recovery / power), an LED's colour. That axis is **`Component.variant`** (a separate field
from `tier`), mapped by `web/src/lib/diodes.ts` (`diodeVariant`, `hasDiodeTypes`) into the same
`Element::params` block. Unlike a tier non-ideality, a variant's **forward** params (diode
`Is`/`n` → forward drop) are the part's identity, so `buildNetlist` installs them in **both**
fidelity modes; only the **rating** is Real-mode-gated.

**Ratings → FAIL.** Param slot `RATED_CURRENT_SLOT` (= 2) is a **general** rated-current (A)
read for *every* element in `Sim::flag_and_clamp_fails`: `|I| > rated` flags the element in the
existing FAIL mask (the renderer boxes it). `0` = unrated (the default, and every Ideal-mode
part — the web layer installs the rating only in Real mode). Golden-safe: `failed_elements` is
**not** in `snapshot_hash`, and the rating only *flags* — it never alters the solve. To rate a
new kind, just emit slot 2 from `buildNetlist` (Real mode); no sim-core change needed.

**Reverse recovery.** A diode's transit time `TT` (`DIODE_TT_SLOT` = 3, Real mode only) gives it
a **diffusion-charge backward-Euler companion** — a forward diode stores `q = TT·I` in
`reactive_state[ei]`, and on switch-off sweeps it out as a reverse-current spike. `newton_iterate`
takes an `inv_dt` (0 at the operating point so DC is unchanged, `1/DT` transiently); `TT = 0`
(default / Ideal / Schottky) zeroes the charge term → bit-identical, golden-safe. `TT` is
game-scaled to the fixed `DT` so the spike is legible (ordering, not absolute ns).

## Gotchas

- **Latch metastability / transistor SRAM power-up.** A cross-coupled transistor latch (6T SRAM,
  flip-flop) has three DC roots — two rails + an **unstable midpoint** — and the damped Newton OP solve,
  seeded from all-zeros `node_v` (the cell's symmetry axis), lands on the midpoint, so an *unwritten*
  cell powered up to `Q ≈ Q̄ ≈ VCC/2` mush. Fixed by **`Sim::break_metastable_latches()`** (runs once
  after the install/reset OP solve): gated on a **MOSFET slot-1 Vth mismatch** (emitted by `buildNetlist`
  **only in Real mode** — `MOSFET_VTH_MISMATCH * jitter(id)`, ±30 mV, the resistor-tolerance pattern; read
  raw/signed via `e.params[1]`, **not** `param_or`, which clamps negatives). It detects cross-coupled
  pairs as **gate→drain 2-cycles**, seeds the storage nodes to opposite rails + re-linearises every MOSFET
  + re-solves (retrying the **flipped** direction — the near-singular latch matrix is node-order sensitive,
  so one direction holds and its mirror drifts back). Mismatch **sign** picks the bit. **Golden-safe:** the
  linear golden has no MOSFET → gate never fires → byte-identical; Ideal mode emits no mismatch → an ideal
  symmetric cell stays *honestly* metastable. The *write* path was always fine (bit-line drive forces a
  rail that holds); only the unwritten power-up was stuck. (Distinct from #88's convergence fix — see
  `docs/sim/transistor-scale-convergence.md`.)
- **Powered logic gates** (`ELEM_GATE`) are real **5-pin ICs** using the **5th `Element` terminal**:
  a=OUT, b=IN1, c=IN2, **d=VCC, e=GND**. The rail is `V(VCC) − V(GND)` (`gate_rails`), inputs
  threshold relative to `V(GND)`, and the output swings `V(GND)..V(VCC)` (the `digital_vlow`
  GND-offset array). A gate with **no** power pins (`d==0 && e==0`) falls back to the legacy `value`
  rail referenced to ground, so old netlists/the golden are **bit-identical**. An unwired VCC floats
  to ~0 → rail `< GATE_MIN_RAIL` → the gate is **dead** (output released). The 5th terminal crosses
  the boundary via `set_netlist_pe(... e ...)`; the old `set_netlist`/`_p` delegate with `e=&[]`
  (all ground). Web: gates are 5-pin `[Y, A, B, VCC, GND]` (NOT/BUF's pin 2 is the package **NC**,
  ignored); `buildNetlist` emits the `e` array and `loop.ts` calls `set_netlist_pe`. The gate
  `value` (logic rail) is now vestigial once powered — the family (CMOS/TTL) still sets thresholds.
- The web **`PULSE`** (pulse/clock generator) part has **no sim element of its own** — it maps to
  `ELEM_ACSOURCE` (type 7) with a **waveform param** (slot 1: 1 = square, 2 = triangle; slot 3 =
  duty), and `ac_source_emf` branches on it. Slot 1 = 0 is sine, so a plain AC source is
  unchanged. This keeps the deterministic core from special-casing a new time-varying-source type
  in its ~15 source sites. (Same trick for **`SHUNT`** — a current-sense shunt is just `ELEM_RESISTOR`
  with milliohm values, no sim element of its own.)
- **Resistor lead inductance** (`R_ESL = 10 nH`, beside `CAP_ESL`): in **Real** mode the AC paths
  (`ac_solve_models` / `ac_element_measurements`) stamp a resistor as `Y = 1/(R + jωL)`, not `1/R`.
  The same geometric parasitic on *every* resistor, but the `ωL` term only swings the phase when R
  is tiny — invisible on a 10 kΩ, ~+32° on a 10 mΩ **SHUNT** at 100 kHz (hence the shunt part).
  AC-only + unhashed → the transient golden is untouched (resistors stay pure R in the time domain).
- **Thermal (Johnson) noise** (`NOISE_SLOT` = 6, beside `CAP_LEAK_SLOT`): in **Real** mode `buildNetlist`
  emits a per-resistor noise-current amplitude (`resistorNoiseAmp(R, tier)` in `tiers.ts`, `∝ 1/√R`,
  tier-coupled so a budget part hisses more); sim-core injects it as a **deterministic, zero-mean,
  per-`(element, tick)` current** into the **transient** RHS only (`add_noise_currents`, gated on a
  `has_noise` install flag — the OP stays clean, like a diode's `TT` at `inv_dt = 0`). The sample is an
  Irwin–Hall over `splitmix64` (no transcendentals → machine-independent, replay-exact). It **enters the
  solve** (node `V` fuzzes — visible on the scope) but `0` (default / Ideal / the golden) skips it
  entirely → byte-identical. **Game-scaled** (the lesson is the ordering — bigger R, cheaper grade ⇒
  noisier — not the literal √(4kTRΔf) µV). **Gotcha:** the node-voltage noise grows as `√R`, which would
  swing **volts** at the picker's multi-MΩ ceiling (a 9.1 MΩ budget pulldown). `resistorNoiseAmp` **soft-
  saturates** above a `NOISE_R_KNEE` (= 1 MΩ — the amp goes `∝ 1/R`, not `1/√R`) so a lone resistor's
  node-voltage noise caps at `NOISE_V_MAX·tier` (≤ 1 MΩ is unchanged, so the 6T-SRAM 1 MΩ bit-line and the
  golden are byte-identical); even a 9.1 MΩ budget node's 3.46σ peak stays clear of the logic mid-rail.
  Still: firm up weakly-tied test nodes (the SRAM bit-line is tied through a resistor for this reason). See
  `docs/sim/noise-ideation.md`.
- **Two frequency regimes.** The transient solve has a fixed `DT = 2µs` → time-domain signals
  alias above ~62.5 kHz (board + time-scope are for ≤ that). The **frequency domain** (`ac_solve`
  / `ac_sweep` → the **Bode** and the **phase scope** `lib/phaseScope.ts`) is analytic with **no
  Nyquist limit**, so it displays MHz–GHz. Source frequency pickers (`values.ts` AC/PULSE) run to
  10 MHz: above the time ceiling the value just sets where the frequency-domain tools analyse.
- `web/src/wasm` is gitignored and excluded from `tsconfig.app.json`. Always run
  `pnpm run build:wasm` before `pnpm -C web check` (CI uses that order).
- `wasm-opt` is disabled in `crates/sim-wasm/Cargo.toml` so `build:wasm` works
  without fetching binaryen. Re-enable when binaryen is provisioned.
- Rust `u64` returns (`tick`, `snapshot_hash`) cross into JS as **BigInt**;
  `state()` crosses as **Float64Array**.
- Fonts load from the Google Fonts CDN at runtime (display only; not needed for
  gates). Self-hosting is on the backlog.

## Toolchain self-heal

`.claude/hooks/install-toolchain.sh` (async SessionStart hook) ensures the
`wasm32-unknown-unknown` target and `wasm-pack` exist on ephemeral web
containers. `.claude/hooks/session-start.sh` (sync) surfaces HANDOFFS.md and
these reminders. Configured in `.claude/settings.json`.

## Agent logs — keep current

- **TODOS.md** — dated, append-only; tombstone done items (`~~strike~~`), never
  delete.
- **HANDOFFS.md** — prepend a new dated section whenever you stop.
- **This file** — update when conventions change.

## Git

- Develop on the assigned feature branch (currently `claude/kind-turing-hdelb3`).
  Never push to `main` without explicit permission. Do not open a PR unless asked.
- Commit messages: clear, descriptive, imperative mood.

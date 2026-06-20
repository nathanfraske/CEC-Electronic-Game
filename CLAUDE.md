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
```

`pnpm -C web format` rewrites files with Prettier (use before `lint`).

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
  Voltage = net level (height + rail color + number); current = flow + thickness
  + number; KCL at taps; IR-drop sag. Rail identity: +12V `#d8a24a`, +5V
  `#46d2e6`, +3.3V `#9a78ff`, GND `#6b6488`. Draft, not final.

## Where things live

| Path | Role |
| --- | --- |
| `crates/sim-core` | deterministic engine; host-tested, no browser deps |
| `crates/sim-protocol` | wire types only, no logic |
| `crates/sim-wasm` | thin wasm-bindgen layer |
| `web/src/sim/loop.ts` | the once-per-frame wasm boundary |
| `web/src/lib/board.ts` | PixiJS renderer (grid + signal traces) |
| `web/src/App.svelte` | HUD shell |
| `web/src/app.css` | design tokens + component styles |
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

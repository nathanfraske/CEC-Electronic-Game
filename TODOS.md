# TODOS

Append-only work log. Newest day at the top. Completed items are **tombstoned**
(struck through with `~~...~~`) and kept for history — never deleted. Open items
use `[ ]`. This file is maintained by agents; see CLAUDE.md for the rule.

---

## 2026-06-14

### Done
- ~~Bootstrap the repository per AGENTRUNBOOK.md: Cargo workspace + three crates (sim-core, sim-protocol, sim-wasm).~~
- ~~sim-core: deterministic fixed-step placeholder, FNV-1a snapshot hash, reproducibility test (passing).~~
- ~~sim-wasm: wasm-bindgen bindings (step/tick/state/protocol_version/snapshot_hash).~~
- ~~WebAssembly build wiring (scripts/build-wasm.sh → web/src/wasm); disabled wasm-opt so build works offline.~~
- ~~Web app: Vite 8 + Svelte 5 + TypeScript + PixiJS 8, workspace wired with pnpm.~~
- ~~Apply the Critical Error Computing design system (OKLCH palette, Saira / Saira Condensed / IBM Plex Mono, HUD shell, grid + neon glows) to the web UI.~~
- ~~First design pass: component bin, live oscilloscope board (auto-ranged traces of the deterministic snapshot), telemetry panel, transport controls (run/pause/step/speed).~~
- ~~ESLint flat config (typescript-eslint + eslint-plugin-svelte) + Prettier; lint gate green.~~
- ~~CI workflow (.github/workflows/ci.yml): rust-core + web-build jobs.~~
- ~~Seed docs: architecture, determinism, ADR-0001. README/NOTICE/CONTRIBUTING with placeholders filled.~~
- ~~SessionStart hook: self-heal the wasm toolchain on ephemeral containers + surface the agent handoff docs.~~
- ~~All verification gates green from a clean checkout (fmt, clippy, test, build:wasm, check, lint, build).~~
- ~~Write the game design document (docs/game-design.md): pillars, fidelity-as-progression loop, tech tree, challenge/grading model, milestones M0–M5.~~

### Done — parallel agent panel (M1 + M2 + polish), integrated
- ~~M2 (Lane A): replace placeholder dynamics with a real deterministic analog engine — backward-Euler companion models via Modified Nodal Analysis, bounded dense solve. Circuit: RC charge (V → R → C → gnd). `state()` = [v(n1), v(cap), i(src), v(rail)].~~
- ~~M2: committed determinism golden `golden_snapshot_hash_is_stable` (seed 42, 1000 steps → 0x92349dbbbf5a8293); kept `run_is_reproducible`; added monotonic-charge, closed-form, and seed→rail tests.~~
- ~~M1 (Lane B): interactive board — TS board model (`web/src/lib/graph.ts`), drag-from-bin placement, click-drag wiring, move/delete, Select/Place/Wire mode toggle, and a renderer + telemetry generalized to a variable-length state vector.~~
- ~~Polish (Lane C): self-host the fonts (dropped the Google CDN), CRT/scanline scope frame, full button/chip/telemetry state matrices, neon glows, prefers-reduced-motion.~~
- ~~Integrate the three worktree branches into the feature branch (disjoint files → clean cherry-pick); rebuild wasm; full gate suite green; align telemetry labels to the core's state layout.~~

### Open / Next
- [ ] **Wire the board graph into the solver.** Today the interactive board (`graph.ts`) and the analog core are independent — the sim runs a fixed RC circuit regardless of what you place. Compile the placed components + wires into a netlist the core actually solves.
- [ ] Generalize the analog engine beyond the fixed RC: stamp arbitrary R/C/L/sources from the netlist; add nonlinear devices (diode) with a capped Newton solve.
- [ ] **Implement the power-bus visual language** (`docs/ui/visual-language.md`, ref `docs/ui/dc-bus-reference.html`): net voltage as belt height + rail color + number; branch current as flow (chevrons) + thickness + number; KCL at taps; real IR-drop sag. Add rail tokens (`--r12/--r5/--r33/--gnd`) to `app.css`; port the SVG encoding to the PixiJS renderer.
- [ ] Add the event-driven digital engine and the behavioral MCU emulator; meet the analog domain at the pins (docs/architecture.md).
- [ ] First graded challenge: "V(cap) reaches 90% of V(rail) within N ticks", verified by measurement + deterministic replay.
- [ ] sim-protocol: design the real snapshot/command wire schema; choose a serialization deliberately and record an ADR.
- [ ] Web: implement rewind via sparse keyframes wired to the transport controls.
- [ ] Re-enable `wasm-opt` once binaryen is provisioned in the build image.
- [ ] Open the bootstrap pull request against `main`; recommend branch protection requiring the `rust-core` and `web-build` checks.

Superseded earlier items (tombstoned):
- ~~Replace the placeholder dynamics with the real analog solver~~ → analog RC done (Lane A); digital + MCU still open above.
- ~~Promote `print_golden` into a committed golden~~ → done (Lane A).
- ~~Web: drag-from-bin placement + real board graph~~ → done (Lane B).
- ~~Self-host the fonts~~ → done (Lane C).

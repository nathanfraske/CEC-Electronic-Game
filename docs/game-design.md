# Game design

This is the *game* design counterpart to `architecture.md` (which is the
technical design). It describes what the player does, why it teaches, and how it
grows. It is a living document; revise it deliberately.

## Vision

Learn real electronics by building it. The player starts with a single idealized
part and ends up wiring an FPGA fabric and a microcontroller running real
firmware — and at every step the simulation underneath is physically faithful,
so the intuition transfers to a real bench.

## Pillars

1. **Physical truth, made visible.** Voltages rise on RC curves, rails sag under
   load, edges have slope. The game's job is to make the invisible visible:
   scopes, meters, and glowing nets that show what is actually happening.
2. **Fidelity is the progression.** You do not unlock bigger numbers; you unlock
   *more reality*. Idealized parts simply work. Real parts cost something, carry
   real behavior, and pay back a reward scaled to how real they are.
3. **Time is a toy.** Pause, single-step, rewind, and fast-forward. Watching a
   capacitor charge tick by tick is a core teaching moment, not a debug feature.
4. **One honest model.** Everything is the same deterministic core. A challenge,
   a sandbox, and a graded solution are all the same simulation stepped under
   stated conditions — no separate "puzzle logic."

## The core loop

```
Place parts  ->  Wire nets  ->  Run / step / rewind time  ->  Observe (scope,
meters, glow)  ->  Meet the challenge's measured goal  ->  Earn reward scaled to
realism  ->  Spend it on more real (and more capable) parts.
```

The reward-for-realism economy is the spine: choosing a real resistor with
tolerance over an ideal one is riskier and harder, and that is exactly why it
pays more and teaches more.

## The board and its domains

The board is a grid of nets and pins. Three engines cooperate on one tick grid
and **meet only at the pins**, which is where the best lessons live:

- **Analog** — continuous-time solver for nets and power rails (the truth layer).
- **Digital** — event-driven gates, flip-flops, and fabric on the tick grid.
- **Emulator** — behavioral microcontrollers running firmware.

The pin boundary is where a weak pull-up or a slow edge turns an intended `1`
into an unknown — and the player can *see* why.

## Tech tree (parts ladder)

Tiers gate both capability and required understanding. The component bin in the
UI already previews this ladder.

- **Tier I — Idealized passives:** resistor, capacitor, inductor, diode. They
  just work; teach RC/RL behavior, charge, and one-way conduction.
- **Tier II — Active + digital primitives:** transistor (gain/switching), logic
  gate (thresholds at the pin), D flip-flop (one bit of memory). Introduce drive
  strength, levels, and timing.
- **Tier III — Spatial vs. sequential:** FPGA fabric (parallel, you wire or
  describe it) and microcontroller (sequential, you program it). Teach the
  engineering judgment of when to reach for which.

Real variants of earlier tiers (tolerance, ESR, saturation, leakage) unlock
alongside, as the "trade ideal for real" upgrade path.

## Programmability tiers

A behavioral block runs at the pins regardless of how its behavior was authored.
The same axis as the tech tree:

1. **Parametric black box** — set parameters, no code.
2. **Visual logic** — wire a small behavior graph.
3. **Real firmware / HDL** — write code and feel the gap between what you
   intended and what the silicon did.

## Challenges and grading

Because the core is deterministic, a challenge is fully defined by stated
conditions, and a solution is a reproducible stream of player actions + ticks.

- **Verification:** step the simulation under the stated stimulus and sample
  measurements (e.g. "node X reaches 90% of Vcc within N ticks", "no glitch on
  CLK over this window").
- **Grading:** deterministic replay makes scoring exact and reproducible across
  machines (WebAssembly pins IEEE float semantics). The determinism contract in
  `docs/determinism.md` is what makes grading trustworthy.
- **Reward:** scaled by realism of the parts used and efficiency of the design,
  feeding the economy above.

## UI / UX language

The look mirrors **criticalerrorcomputing.com**: a dark blue-violet bench-
instrument HUD with a vivid rose accent, monospace telemetry, condensed
uppercase headers, faint grids, and neon glows. The current shell establishes
the frame — component bin (left), board/scope (center), telemetry (right),
transport (bottom). See `CLAUDE.md` for the tokens.

## Milestones

- **M0 — Foundation (done).** Deterministic placeholder core to wasm, CEC-styled
  HUD, the once-per-frame snapshot boundary, an oscilloscope view of the live
  core, and all gates green.
- **M1 — Real board model.** Net/pin graph in `sim-protocol`; place a part from
  the bin and wire two nets; render real components on the board.
- **M2 — Analog truth.** Implicit companion models for R/C/L with a capped solve;
  a working RC-charge challenge graded by measurement.
- **M3 — Digital + pins.** Gates and a flip-flop; driver/receiver models at the
  pin boundary; a level/threshold lesson.
- **M4 — Time travel.** Sparse keyframes + rewind wired to the transport.
- **M5 — Programmable blocks.** Parametric black box first, then visual logic.

Keep `TODOS.md` aligned with the active milestone.

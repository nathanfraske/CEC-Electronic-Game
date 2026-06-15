# Architecture

Web first. A deterministic, fixed-step simulation core written in Rust is
compiled to WebAssembly and runs in the browser. A TypeScript front end built
on Vite, Svelte, and PixiJS renders the board and owns the user interface,
crossing into the core once per frame with a batched snapshot.

The simulation is several cooperating engines on one tick grid. A continuous
time analog solver owns the real nets and power rails and integrates every
fixed step with implicit companion models. Linear netlists are a single dense
Modified Nodal Analysis solve; netlists with a nonlinear device (the diode is
the first) wrap that same assembly in a bounded, deterministic Newton–Raphson
outer loop, linearizing each device about the previous iterate and capping the
iteration count, so per tick cost stays bounded. Time-varying linear elements —
a clock-driven (PWM) switch (a conductance toggled by a fixed-period function of
the tick) and a sinusoidal AC voltage source (a voltage constraint whose EMF is
`amplitude * sin(2*pi*f*t)`, a pure function of the tick) — are recomputed from
the tick once per step and stamped into that same fixed linear base, so a buck
converter (switch into an inductor, freewheel diode, and output cap) or an AC
source feeding a diode rectifier is just another netlist. An event driven
digital engine owns gates, flip flops,
and fabric, with events landing on the tick grid. A behavioral emulator owns
each microcontroller and runs its firmware, temporally decoupled and
resynchronized at pin interactions. The domains meet only at the pins through
driver and receiver models, which is also the most useful teaching surface.

Programmability is tiered along the same axis as the tech tree: a parametric
black box, then visual logic, then real firmware and HDL. The simulation runs
a behavioral block at the pins regardless of how the behavior was authored.

A native desktop build can wrap the same web app later and reuse the identical
Rust core.

## Sandbox simulation model: electrical islands + adaptive ΔT

*Direction, not yet built — today the core runs a single global ΔT of 2 µs. This
is the agreed target once the game becomes an open sandbox.* It also resolves the
core tension of one sandbox holding wildly different timescales (a millisecond
power rail beside a kilohertz oscillator beside fast logic): a single global ΔT
can't serve all of them, because the step must be small enough for the fastest
signal while the slow parts then need impractically many steps.

The resolution is to **shard the simulation by electrical island.** Components are
in the same island only if a wire path connects them — exactly the connected
components the netlist union-find already computes. Two machines that aren't wired
together are **independent simulations with independent clocks**, which is also
the Factorio "districts" metaphor made literal (see `docs/game-factory-loop.md`).

- **Per-island adaptive ΔT.** Each island chooses ΔT from *its own* fastest
  dynamics — `min(R·C, L/R, 1/f_source, switch_period) / oversample` with a floor
  — so it shrinks when you drop in something fast and grows when it's all slow.
  ΔT is a deterministic function of the island's topology, so reproducibility
  holds; the golden test pins its circuit's ΔT explicitly.
- **A shared physical-time clock.** The board advances by **sim-seconds**, and
  each island integrates however many of its own ΔT-steps it needs to reach the
  shared target time. Everything stays temporally consistent, and you only pay the
  fine-ΔT compute on the island that actually has fast dynamics. (This is why the
  front end already separates fidelity (ΔT) from playback rate (ticks/second) and
  shows wall-clock sim-time.)
- **Wiring merges islands.** Connecting two districts unions them into one island
  that adopts the finer ΔT — a legible consequence: a fast district wired into a
  slow one makes the whole thing tick finely, which is physically true.
- **Black-boxing is a scale *and* ΔT lever.** A validated sub-circuit collapses to
  a pin-level behavioral block (the same "domains meet at the pins" mechanism used
  for the digital/MCU engines); a black-boxed oscillator becomes "a 1 kHz clock
  source" and no longer needs fine ΔT inside it.

The one case this does not make cheap is a **single connected net that genuinely
spans ms → GHz**. That is inherently expensive; the real answer is multi-rate /
envelope integration within one net (fast subnet fine, slow subnet coarse,
coupled), which is the deferred frontier — rare in practice, since you seldom wire
a power supply straight into an RF oscillator and watch both evolve.

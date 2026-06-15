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
the first is a clock-driven (PWM) switch, a conductance toggled by a fixed-period
function of the tick — are recomputed from the tick once per step and stamped
into that same fixed linear base, so a buck converter (switch into an inductor,
freewheel diode, and output cap) is just another netlist. An event driven
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

# Architecture

Web first. A deterministic, fixed-step simulation core written in Rust is
compiled to WebAssembly and runs in the browser. A TypeScript front end built
on Vite, Svelte, and PixiJS renders the board and owns the user interface,
crossing into the core once per frame with a batched snapshot.

The simulation is several cooperating engines on one tick grid. A continuous
time analog solver owns the real nets and power rails and integrates every
fixed step with implicit companion models and a capped nonlinear solve, so per
tick cost is bounded. An event driven digital engine owns gates, flip flops,
and fabric, with events landing on the tick grid. A behavioral emulator owns
each microcontroller and runs its firmware, temporally decoupled and
resynchronized at pin interactions. The domains meet only at the pins through
driver and receiver models, which is also the most useful teaching surface.

Programmability is tiered along the same axis as the tech tree: a parametric
black box, then visual logic, then real firmware and HDL. The simulation runs
a behavioral block at the pins regardless of how the behavior was authored.

A native desktop build can wrap the same web app later and reuse the identical
Rust core.

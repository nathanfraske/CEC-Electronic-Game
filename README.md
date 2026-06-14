<!--
  SPDX-License-Identifier: Apache-2.0
-->

# CEC Electronic Game

**Learn real electronics by building it.** An open, browser based teaching game where you wire up circuits, watch the physics happen, and grow from a single gate to a working FPGA fabric and a microcontroller running real firmware. The simulation underneath is physically faithful, so what you learn here is what holds on a bench.

This project is free to use, fork, and teach with. The mission is education first, and the license is deliberately permissive to keep it that way.

> Status: early and under active construction. Interfaces and structure will move. Issues and pull requests are welcome.

---

## What this is

Most circuit games stop at digital logic, where a wire is either on or off. This one keeps going down to the analog truth: voltages that rise on an RC curve, inductors that saturate, rails that sag under load, and the thresholds and drive strengths that decide whether a logic level is actually read the way you intended. You start with idealized parts that simply work, and as you progress you trade those idealizations for real parts that cost something, carry real behavior, and pay back a reward scaled to how real they are.

The deep end includes the parts that matter on an actual board. A parallel FPGA fabric you wire or describe, and a microcontroller you can drive with parameters, with a visual program, or with real firmware. The point is to build the engineering judgment of when to reach for a spatial fabric against a sequential processor, and to feel the gap between what your code intended and what the silicon did.

## How it works

The architecture splits the part that needs raw speed from the part that needs reach, so both goals are met at once.

**A Rust simulation core compiled to WebAssembly** carries the physics. It is deterministic and fixed step, which is what makes pausing, single stepping, rewinding, and reproducible grading all possible from one design. The core is plain Rust with no browser or JavaScript dependencies, so it is tested natively and shipped to the web through the same code.

**A TypeScript front end** built on Vite, Svelte, and PixiJS renders the board and owns the user interface. It crosses into the WebAssembly core coarsely, once per frame with a batched snapshot, which is the pattern that keeps frame time predictable.

**The simulation runs as cooperating engines on one tick grid.** A continuous time analog solver owns the real nets and the power rails. An event driven digital engine owns gates, flip flops, and fabric, with its events landing on the tick grid. A behavioral emulator owns each microcontroller and runs its firmware. The three meet only at the pins, through driver and receiver models, which is exactly where the most useful lessons live. The boundary is where a weak pull up or a slow edge turns an intended one into an unknown, and now you can see why.

**Time is yours to control.** Pause and advance one tick at a time, rewind to an earlier state, or run continuously at a speed measured in simulated seconds per real second, which lets you watch a capacitor charge or a carry ripple stage by stage. Physical fidelity is set by the integration step and stays fixed for correctness, while the speed control only changes how fast you watch.

A native desktop build can come later by wrapping the same web app, reusing the identical Rust core without a rewrite.

## Quickstart

Prerequisites: a recent stable Rust toolchain with the `wasm32-unknown-unknown` target, the current Node LTS, `pnpm`, and `wasm-pack`.

```bash
# 1. clone
git clone https://github.com/nathanfraske/cec-electronic-game.git
cd cec-electronic-game

# 2. add the wasm target and the build tool (one time)
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

# 3. build the simulation core to WebAssembly
pnpm run build:wasm

# 4. install web dependencies and start the dev server
pnpm install
pnpm run dev
```

Run the native test suite for the core, including the determinism golden, with `cargo test`.

## Repository layout

```
cec-electronic-game/
  crates/
    sim-core/        Deterministic fixed step mixed signal engine. Pure Rust, the heart of the project.
    sim-protocol/    Shared wire types: snapshot format, commands, net and pin schema. Permissive seam.
    sim-wasm/        wasm-bindgen bindings that expose sim-core to the browser.
  web/               Vite, Svelte, TypeScript front end. PixiJS board and UI.
  docs/              Architecture notes, the determinism contract, and decision records.
  scripts/           Build and dev helpers.
  .github/workflows/ Continuous integration.
  LICENSE  NOTICE  README.md  CONTRIBUTING.md
```

The `sim-protocol` crate is the clean seam between the engine and the front end, holding only the wire schema so the boundary stays explicit.

## The simulation model in brief

A fixed integration step sets physical fidelity and is bounded from below by the fastest dynamics in the circuit. The analog domain integrates every step using implicit companion models for capacitors and inductors, with a capped nonlinear solve so the per tick cost stays bounded and the frame loop stays smooth. Reverse is implemented as rewind to a stored keyframe, never as backward integration, because a dissipative circuit run backward is unstable. Determinism plus sparse keyframes make rewind exact and cheap. Because the whole thing is deterministic, a solution becomes a reproducible stream of player actions and ticks, which is what lets a challenge be verified by stepping the simulation and sampling measurements under stated conditions.

## Using this in your classroom

You are explicitly welcome to use this in teaching. Run it with students, fork it for a course, build derivative lessons and exercises on top of it, and adapt it to your curriculum. The permissive license already grants all of that, and this section is here to say plainly that it is encouraged. If you build something for a class, sharing it back is appreciated and never required.

## Contributing

Contributions are welcome. See `CONTRIBUTING.md` for the development workflow, the formatting and lint gates, and the determinism expectations that every change to the core must preserve. By submitting a contribution you agree it is provided under the project license.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Apache 2.0 was chosen because it is broadly permissive, grants patent rights explicitly alongside copyright, and keeps the project usable anywhere, including in schools and in other open and commercial work. The educational focus lives in this mission and in how the project is run, rather than in any restriction on use, since restricting use to education would make the project less free and less reachable, which is the opposite of the goal.

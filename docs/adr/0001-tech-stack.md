# ADR 0001: Technology stack

Status: accepted

## Decision

Rust simulation core compiled to WebAssembly. TypeScript front end on Vite,
Svelte, and PixiJS. pnpm for JavaScript packages. wasm-pack for the Rust to
WebAssembly build. Apache 2.0 license.

## Rationale

Accessibility is won at the distribution layer, and the browser gives the
widest reach for a teaching tool, including low cost classroom hardware.
Performance is won in the core, and Rust to WebAssembly runs compute bound work
near native with SIMD available. The stack matches the team's existing Rust and
Svelte experience, and the same Rust core can later back a native build.

## Notes

Keep the JavaScript to WebAssembly boundary coarse, once per frame. Pin the
wasm-bindgen crate and CLI versions together; wasm-pack handles the pairing.

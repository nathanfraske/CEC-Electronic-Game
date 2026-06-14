# Contributing

Thanks for helping. This project teaches real electronics, so correctness
and clarity matter more than speed.

## Development setup

See the Quickstart in the README. In short: install the Rust toolchain with
the wasm32 target, wasm-pack, the current Node LTS, and pnpm, then run the
gates below.

## Gates that must pass before review

Run these locally. Continuous integration runs the same set.

    cargo fmt --all -- --check
    cargo clippy --all-targets -- -D warnings
    cargo test -p sim-core -p sim-protocol
    pnpm run build:wasm
    pnpm -C web check
    pnpm -C web lint
    pnpm -C web build

## The determinism rule

The simulation core is deterministic and fixed step. Any change to it must
keep `cargo test -p sim-core` green, including the reproducibility test. If a
change legitimately alters simulation behavior, that is allowed only as a
deliberate act: regenerate the golden value, and explain in the pull request
what changed and why. A silent change to a golden is never acceptable.

Do not use the standard library default hasher for any value that has to
reproduce across machines or compiler versions. Its output is not guaranteed
stable. Use the stable hash provided in the core.

## License of contributions

By submitting a contribution you agree it is provided under the Apache 2.0
license that covers this project. Add the SPDX header to every new source
file:

    SPDX-License-Identifier: Apache-2.0

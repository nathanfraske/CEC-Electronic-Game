#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
# Build the core to WebAssembly for the browser. The --out-dir is relative to
# the crate, so this lands in web/src/wasm. wasm-pack fetches the matching
# wasm-bindgen CLI, so the crate and CLI versions stay paired.
wasm-pack build crates/sim-wasm --target web --out-dir ../../web/src/wasm

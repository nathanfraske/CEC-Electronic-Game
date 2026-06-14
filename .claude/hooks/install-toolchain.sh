#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SessionStart (async): self-heal the Rust -> WebAssembly toolchain on ephemeral
# Claude Code on the web containers so `pnpm run build:wasm` works. Async mode
# keeps session start fast; the finished state is cached into the container, so
# warm sessions are instant.
set -uo pipefail

# Announce async mode FIRST so the session is not blocked on the slow install.
echo '{"async": true, "asyncTimeout": 600000}'

# Only manage the toolchain in the remote web environment; never touch a
# developer's local machine setup.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Ensure cargo/rustup binaries are on PATH (default rustup location).
export PATH="${HOME}/.cargo/bin:${PATH}"

# 1. wasm32 target — fast and idempotent.
if command -v rustup >/dev/null 2>&1; then
  rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
fi

# 2. wasm-pack — slow on a cold container, cached afterwards. Try a prebuilt
#    binary first (fast); fall back to building from crates.io.
if ! command -v wasm-pack >/dev/null 2>&1; then
  installed=""
  ver="$(curl -fsSL https://api.github.com/repos/rustwasm/wasm-pack/releases/latest 2>/dev/null \
    | grep -m1 '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/')" || true
  if [ -n "${ver}" ]; then
    url="https://github.com/rustwasm/wasm-pack/releases/download/v${ver}/wasm-pack-v${ver}-x86_64-unknown-linux-musl.tar.gz"
    tmp="$(mktemp -d)"
    if curl -fsSL "${url}" -o "${tmp}/wp.tgz" 2>/dev/null; then
      tar xzf "${tmp}/wp.tgz" -C "${tmp}" 2>/dev/null || true
      bin="$(find "${tmp}" -name wasm-pack -type f | head -1)"
      if [ -n "${bin}" ]; then
        mkdir -p "${HOME}/.cargo/bin"
        cp "${bin}" "${HOME}/.cargo/bin/wasm-pack"
        chmod +x "${HOME}/.cargo/bin/wasm-pack"
        installed="prebuilt"
      fi
    fi
    rm -rf "${tmp}"
  fi
  if [ -z "${installed}" ]; then
    cargo install wasm-pack --locked
  fi
fi

echo "[install-toolchain] toolchain ready: wasm-pack $(wasm-pack --version 2>/dev/null || echo 'unavailable')"

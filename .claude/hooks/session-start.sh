#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SessionStart (synchronous): surface the agent handoff docs into context and
# remind the agent to keep them current. Fast — adds no meaningful latency.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" || exit 0

wasm_pack_ver="installing…"
if command -v wasm-pack >/dev/null 2>&1; then
  wasm_pack_ver="$(wasm-pack --version 2>/dev/null | awk '{print $2}')"
fi

echo "=================================================================="
echo " CEC Electronic Game — session bootstrap"
echo "=================================================================="
echo "Toolchain: rustc $(rustc --version 2>/dev/null | awk '{print $2}' || echo '?')" \
     "| node $(node --version 2>/dev/null || echo '?')" \
     "| pnpm $(pnpm --version 2>/dev/null || echo '?')" \
     "| wasm-pack ${wasm_pack_ver}"
echo
echo "Keep these agent logs CURRENT as you work (rule in CLAUDE.md):"
echo "  - HANDOFFS.md : where the last agent left off — READ THIS FIRST."
echo "  - TODOS.md    : dated, append-only; tombstone done items, never delete."
echo "  - CLAUDE.md   : repo conventions, gotchas, and the verification gates."
echo
echo "Verify before pushing:"
echo "  cargo fmt --all -- --check && \\"
echo "  cargo clippy -p sim-core -p sim-protocol --all-targets -- -D warnings && \\"
echo "  cargo test -p sim-core -p sim-protocol && \\"
echo "  pnpm run build:wasm && pnpm -C web check && pnpm -C web lint && pnpm -C web build"
echo
if [ -f HANDOFFS.md ]; then
  echo "----- HANDOFFS.md (most recent entry at top) -----"
  sed -n '1,45p' HANDOFFS.md
  echo "----- (truncated; open HANDOFFS.md for full history) -----"
fi

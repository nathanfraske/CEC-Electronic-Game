// SPDX-License-Identifier: Apache-2.0
//! Deterministic, fixed-step simulation core.
//!
//! Scaffold: the placeholder `Sim` evolves a tiny deterministic state so the
//! determinism harness, the snapshot hash, and the WebAssembly wiring are real
//! and testable now. Replace the placeholder dynamics with the actual analog,
//! digital, and emulator engines. Keep the determinism invariants documented
//! in docs/determinism.md.

use sim_protocol::PROTOCOL_VERSION;

/// FNV-1a over bytes. Used instead of the standard default hasher because the
/// standard hasher's output is not guaranteed stable across toolchains or
/// platforms, and golden hashes must reproduce everywhere.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Minimal deterministic simulation state (placeholder).
#[derive(Clone, Debug)]
pub struct Sim {
    tick: u64,
    state: [f64; 4],
}

impl Sim {
    /// Create a fresh simulation from a seed. The same seed yields the same run.
    pub fn new(seed: u64) -> Self {
        let s = (seed as f64) * 1e-6;
        Sim {
            tick: 0,
            state: [s, -s, 0.5 * s, 1.0 - s],
        }
    }

    /// Advance exactly one fixed-size tick. Pure f64 arithmetic, fixed order.
    pub fn step(&mut self) {
        let [a, b, c, d] = self.state;
        self.state = [
            a + 0.25 * (b - a),
            b + 0.25 * (c - b),
            c + 0.25 * (d - c),
            d + 0.25 * (a - d),
        ];
        self.tick += 1;
    }

    /// Current tick count since creation.
    pub fn tick(&self) -> u64 {
        self.tick
    }

    /// Read-only snapshot of the state vector, for rendering. Returning a copy
    /// never mutates the core, so the determinism contract is unaffected.
    pub fn state(&self) -> [f64; 4] {
        self.state
    }

    /// Protocol version this core speaks.
    pub fn protocol_version(&self) -> u32 {
        PROTOCOL_VERSION
    }

    /// Stable hash of the full snapshot. Part of the replay contract.
    pub fn snapshot_hash(&self) -> u64 {
        let mut bytes = Vec::with_capacity(8 + 4 * 8);
        bytes.extend_from_slice(&self.tick.to_le_bytes());
        for v in &self.state {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        fnv1a(&bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The core invariant: a fixed seed advanced a fixed number of ticks must
    /// produce an identical state trajectory on every run and every machine.
    #[test]
    fn run_is_reproducible() {
        let run = || {
            let mut sim = Sim::new(42);
            let mut acc = sim.snapshot_hash();
            for _ in 0..1000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(
            run(),
            run(),
            "same seed and step count must reproduce exactly"
        );
    }

    /// Promote this to a committed golden once the real engine lands. Run
    /// `cargo test -p sim-core -- --ignored print_golden`, then add a test that
    /// asserts `snapshot_hash` equals the printed constant after a fixed run.
    #[test]
    #[ignore]
    fn print_golden() {
        let mut sim = Sim::new(42);
        for _ in 0..1000 {
            sim.step();
        }
        println!("golden = 0x{:016x}", sim.snapshot_hash());
    }
}

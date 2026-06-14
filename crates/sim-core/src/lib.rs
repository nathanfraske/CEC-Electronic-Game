// SPDX-License-Identifier: Apache-2.0
//! Deterministic, fixed-step analog simulation core.
//!
//! A small but real continuous-time analog solver. It integrates a fixed
//! example circuit every fixed step using **implicit (backward-Euler) companion
//! models** assembled by **Modified Nodal Analysis (MNA)** and solved with a
//! tiny dense Gaussian elimination. Per-tick cost is fixed and bounded: the
//! system size is a compile-time constant and the solve is a single
//! non-iterative pass, so there is no data-dependent work.
//!
//! ## The circuit (classic RC charge)
//!
//! An ideal DC voltage source `V` drives a series resistor `R` that charges a
//! capacitor `C` to ground — the textbook first-order RC step response.
//!
//! ```text
//!        (n1)        R         (n2)
//!     +---o----[  R  ]----o----+
//!     |                        |
//!   ( V )                    = C
//!     |                        |
//!     +---------o--------------+
//!              GND (node 0, reference)
//! ```
//!
//! Node 0 is ground and is eliminated from the system. The unknowns are the two
//! node voltages plus the source branch current (the MNA augmentation for an
//! ideal voltage source), solved together each step:
//!
//! ```text
//!   x = [ v(n1), v(n2), i(Vsrc) ]
//! ```
//!
//! The capacitor voltage `v(n2)` rises along `V * (1 - exp(-t / RC))`; the
//! analytic curve is what the determinism golden pins down.
//!
//! ## Determinism
//!
//! Fixed step, fixed assembly and solve order, pure `f64` arithmetic, no hashed
//! collection iteration, and no nondeterministic float reductions. The snapshot
//! hash is FNV-1a over the tick and node voltages, never the std default hasher.
//! See `docs/determinism.md`.

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

// --- Fixed circuit parameters -------------------------------------------------
//
// Chosen so the dynamics are clear and the fixed step comfortably resolves them.
// Time constant tau = R * C = 1 kohm * 1 uF = 1 ms. With DT = 10 us there are
// 100 steps per tau, so a fixed run sweeps several time constants.

/// Fixed integration step, in seconds (10 microseconds).
const DT: f64 = 10.0e-6;
/// Series resistance, in ohms (1 kilohm).
const R_OHMS: f64 = 1_000.0;
/// Capacitance, in farads (1 microfarad).
const C_FARADS: f64 = 1.0e-6;

/// Number of unknowns in the MNA system: `v(n1)`, `v(n2)`, `i(Vsrc)`.
const N_UNKNOWNS: usize = 3;
/// Length of the exposed state vector. See [`Sim::state`] for the layout.
pub const STATE_LEN: usize = 4;

/// Solve `A x = b` for a fixed-size dense system by Gaussian elimination with
/// partial pivoting. `A` is row-major `N x N`. Deterministic: a fixed number of
/// passes in a fixed order, with a fixed pivot tie-break (strictly greater
/// magnitude wins, so equal magnitudes keep the earlier row). Returns the
/// solution `x`. The matrices here are well-conditioned by construction, so the
/// pivot is always usable; a degenerate pivot falls back to `0.0` rather than
/// producing a NaN, keeping the run finite and reproducible.
fn solve<const N: usize>(mut a: [[f64; N]; N], mut b: [f64; N]) -> [f64; N] {
    // Forward elimination.
    for col in 0..N {
        // Partial pivot: find the row at or below `col` with the largest |a|.
        let mut pivot = col;
        let mut best = a[col][col].abs();
        for (row, a_row) in a.iter().enumerate().skip(col + 1) {
            let mag = a_row[col].abs();
            if mag > best {
                best = mag;
                pivot = row;
            }
        }
        if pivot != col {
            a.swap(col, pivot);
            b.swap(col, pivot);
        }

        let diag = a[col][col];
        if diag == 0.0 {
            continue;
        }
        for row in (col + 1)..N {
            let factor = a[row][col] / diag;
            if factor == 0.0 {
                continue;
            }
            // Disjoint borrows of the pivot row (`col`) and the target row
            // (`row > col`): the split puts `pivot_row` on the left and
            // `target_row` first on the right. Eliminate left-to-right over
            // columns `col..N` to keep the float order fixed.
            let (left, right) = a.split_at_mut(row);
            let pivot_row = &left[col];
            let target_row = &mut right[0];
            for k in col..N {
                target_row[k] -= factor * pivot_row[k];
            }
            b[row] -= factor * b[col];
        }
    }

    // Back substitution.
    let mut x = [0.0f64; N];
    for col in (0..N).rev() {
        let mut sum = b[col];
        for k in (col + 1)..N {
            sum -= a[col][k] * x[k];
        }
        let diag = a[col][col];
        x[col] = if diag == 0.0 { 0.0 } else { sum / diag };
    }
    x
}

/// Deterministic fixed-step analog simulation of the RC charge circuit.
#[derive(Clone, Debug)]
pub struct Sim {
    /// Tick count since creation; one tick is one [`DT`] step.
    tick: u64,
    /// Source EMF in volts. Held constant across the run (a DC source).
    v_source: f64,
    /// Capacitor voltage `v(n2)` carried between steps. This is the single piece
    /// of dynamic state the backward-Euler companion model integrates.
    v_cap: f64,
    /// Source node voltage `v(n1)` from the latest solve (for readout).
    v_n1: f64,
    /// Source branch current `i(Vsrc)` from the latest solve, in amperes.
    i_source: f64,
}

impl Sim {
    /// Create a fresh simulation from a seed. The same seed yields the same run.
    ///
    /// The seed parameterizes the **source voltage** deterministically: it maps
    /// to a rail in `[1.0, 12.0]` volts, so different seeds charge the capacitor
    /// toward different targets while the dynamics stay identical. The capacitor
    /// always starts discharged (`v_cap = 0`), the classic step-response initial
    /// condition.
    pub fn new(seed: u64) -> Self {
        // Map the seed into a tidy supply rail without any platform-dependent
        // float hashing: a plain integer fold, then a fixed affine map.
        let folded = (seed ^ (seed >> 32)) & 0xffff;
        let v_source = 1.0 + (folded as f64 / 65_535.0) * 11.0; // 1.0 .. 12.0 V

        let mut sim = Sim {
            tick: 0,
            v_source,
            v_cap: 0.0,
            v_n1: 0.0,
            i_source: 0.0,
        };
        // Solve once at t = 0 so the readout rails are consistent before the
        // first step (does not advance the tick or the dynamic state).
        sim.solve_into_readout();
        sim
    }

    /// Assemble and solve the MNA system for the current `v_cap`, writing the
    /// resulting node voltages and source current into the readout fields.
    /// Does not advance `v_cap` or the tick. Returns the solved `v(n2)`.
    fn solve_into_readout(&mut self) -> f64 {
        // Unknown order: [ v(n1), v(n2), i(Vsrc) ].
        const N1: usize = 0;
        const N2: usize = 1;
        const ISRC: usize = 2;

        let mut a = [[0.0f64; N_UNKNOWNS]; N_UNKNOWNS];
        let mut b = [0.0f64; N_UNKNOWNS];

        // Resistor R between n1 and n2: stamp conductance g into the G block.
        let g = 1.0 / R_OHMS;
        a[N1][N1] += g;
        a[N1][N2] -= g;
        a[N2][N1] -= g;
        a[N2][N2] += g;

        // Capacitor C from n2 to ground, backward-Euler companion model:
        //   equivalent conductance g_c = C / dt in parallel with an
        //   equivalent current source I_eq = g_c * v_cap(prev) into n2.
        let g_c = C_FARADS / DT;
        a[N2][N2] += g_c;
        b[N2] += g_c * self.v_cap;

        // Ideal voltage source V between n1 and ground (MNA augmentation):
        //   the branch current couples into the n1 KCL row, and the branch
        //   row enforces v(n1) = V.
        a[N1][ISRC] += 1.0;
        a[ISRC][N1] += 1.0;
        b[ISRC] += self.v_source;

        let x = solve(a, b);
        self.v_n1 = x[N1];
        self.i_source = x[ISRC];
        x[N2]
    }

    /// Advance exactly one fixed-size tick. Solves the implicit system for the
    /// new capacitor voltage, commits it as the next state, and increments the
    /// tick. Pure `f64`, fixed order.
    pub fn step(&mut self) {
        let v_n2 = self.solve_into_readout();
        self.v_cap = v_n2;
        self.tick += 1;
    }

    /// Current tick count since creation.
    pub fn tick(&self) -> u64 {
        self.tick
    }

    /// Read-only snapshot of the exposed state vector, for rendering and the
    /// wasm boundary. Returning a copy never mutates the core, so the
    /// determinism contract is unaffected.
    ///
    /// Layout (`[f64; STATE_LEN]`):
    ///
    /// | index | meaning                          | units   |
    /// |-------|----------------------------------|---------|
    /// | 0     | `v(n1)` — source node voltage    | volts   |
    /// | 1     | `v(n2)` — capacitor node voltage | volts   |
    /// | 2     | `i(Vsrc)` — source branch current| amperes |
    /// | 3     | `v_source` — supply rail (target)| volts   |
    ///
    /// Index 1 is the pedagogical signal: it rises along the RC charge curve
    /// toward index 3. Index 2 is the charging current, which decays toward 0.
    pub fn state(&self) -> [f64; STATE_LEN] {
        [self.v_n1, self.v_cap, self.i_source, self.v_source]
    }

    /// Capacitor node voltage `v(n2)` in volts — the primary measurement. Added
    /// as a convenience getter for the wasm/front-end measurement readout.
    pub fn cap_voltage(&self) -> f64 {
        self.v_cap
    }

    /// Protocol version this core speaks.
    pub fn protocol_version(&self) -> u32 {
        PROTOCOL_VERSION
    }

    /// Stable hash of the full snapshot. Part of the replay contract. FNV-1a
    /// over the tick (little-endian) followed by each exposed node voltage
    /// (little-endian `f64` bits), in fixed order.
    pub fn snapshot_hash(&self) -> u64 {
        let mut bytes = Vec::with_capacity(8 + STATE_LEN * 8);
        bytes.extend_from_slice(&self.tick.to_le_bytes());
        for v in &self.state() {
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

    /// Committed determinism contract: 1000 steps of the RC circuit from seed 42
    /// must hash to exactly this constant. Regenerate with `print_golden` and
    /// explain in the PR if you deliberately change the dynamics.
    const GOLDEN_HASH: u64 = 0x9234_9dbb_bf5a_8293;
    const GOLDEN_STEPS: usize = 1000;
    const GOLDEN_SEED: u64 = 42;

    #[test]
    fn golden_snapshot_hash_is_stable() {
        let mut sim = Sim::new(GOLDEN_SEED);
        for _ in 0..GOLDEN_STEPS {
            sim.step();
        }
        assert_eq!(
            sim.snapshot_hash(),
            GOLDEN_HASH,
            "RC golden changed: regenerate with `print_golden` and justify in the PR"
        );
    }

    /// Run `cargo test -p sim-core -- --ignored print_golden` to (re)compute the
    /// committed `GOLDEN_HASH` above after a deliberate dynamics change.
    #[test]
    #[ignore]
    fn print_golden() {
        let mut sim = Sim::new(GOLDEN_SEED);
        for _ in 0..GOLDEN_STEPS {
            sim.step();
        }
        println!("golden = 0x{:016x}", sim.snapshot_hash());
    }

    /// The capacitor must charge monotonically toward the supply rail and never
    /// overshoot it — a basic correctness check on the implicit RC integration.
    #[test]
    fn capacitor_charges_monotonically_toward_rail() {
        let mut sim = Sim::new(7);
        let rail = sim.state()[3];
        let mut prev = sim.cap_voltage();
        assert_eq!(prev, 0.0, "capacitor starts discharged");
        for _ in 0..2000 {
            sim.step();
            let v = sim.cap_voltage();
            assert!(v >= prev - 1e-12, "monotonic non-decreasing charge");
            assert!(v <= rail + 1e-9, "never overshoots the rail");
            prev = v;
        }
        // After ~20 time constants it is essentially fully charged.
        assert!(
            (rail - prev) < 1e-3 * rail,
            "settles to the supply rail after many time constants"
        );
    }

    /// Backward-Euler RC has a known closed form per step:
    ///   v_{k+1} = v_k + (V - v_k) * dt / (R*C + dt).
    /// The solver output must match it to tight tolerance, confirming the MNA
    /// assembly and the dense solve agree with the analytic companion model.
    #[test]
    fn matches_backward_euler_closed_form() {
        let mut sim = Sim::new(123);
        let rail = sim.state()[3];
        let alpha = DT / (R_OHMS * C_FARADS + DT);
        let mut expected = 0.0f64;
        for _ in 0..500 {
            sim.step();
            expected += (rail - expected) * alpha;
            assert!(
                (sim.cap_voltage() - expected).abs() < 1e-9,
                "solver must track the backward-Euler closed form"
            );
        }
    }

    /// Different seeds select different supply rails, so their runs diverge.
    #[test]
    fn seed_changes_the_supply_rail() {
        let a = Sim::new(1).state()[3];
        let b = Sim::new(9_999).state()[3];
        assert!((a - b).abs() > 1e-6, "distinct seeds pick distinct rails");
        assert!((1.0..=12.0).contains(&a) && (1.0..=12.0).contains(&b));
    }
}

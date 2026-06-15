// SPDX-License-Identifier: Apache-2.0
//! Deterministic, fixed-step analog simulation core.
//!
//! A small but real continuous-time analog solver. It integrates an **arbitrary
//! netlist of elements** every fixed step using **implicit (backward-Euler)
//! companion models** assembled by **Modified Nodal Analysis (MNA)** and solved
//! with a dense Gaussian elimination with partial pivoting.
//!
//! Two solve regimes share that assembly:
//!
//! - **Linear fast path.** A netlist with no nonlinear element is a single
//!   non-iterative pass. The system size is fixed once the netlist is installed,
//!   so per-tick cost is fixed and the result is bit-for-bit reproducible.
//! - **Nonlinear Newton path.** A netlist with at least one nonlinear element
//!   (today: the diode) wraps that same assembly in a bounded, deterministic
//!   **Newton–Raphson outer loop** (see below). The linear path is left
//!   *untouched* so linear circuits remain identical to before.
//!
//! ## Element set
//!
//! Every element has exactly two terminals, nodes `a` and `b`. Node `0` is
//! ground (the reference, fixed at 0 V) and is eliminated from the system.
//!
//! | type | element            | `value` units | model                              |
//! |------|--------------------|---------------|------------------------------------|
//! | 0    | DC voltage source  | volts         | MNA augmentation: `V(a)-V(b)=value`|
//! | 1    | resistor           | ohms          | conductance `1/value`              |
//! | 2    | capacitor          | farads        | backward-Euler companion           |
//! | 3    | inductor           | henries       | backward-Euler companion (branch)  |
//! | 4    | DC current source  | amps          | KCL injection: `value` from a -> b |
//! | 5    | diode (nonlinear)  | (unused)      | Shockley, Newton companion a -> b  |
//! | 6    | switch (clocked)   | duty `[0,1]`  | time-varying conductance a <-> b   |
//! | 7    | AC voltage source  | frequency Hz  | MNA augmentation, EMF = sine(tick) |
//!
//! ## Sinusoidal AC voltage source
//!
//! The **AC source** ([`ELEM_ACSOURCE`]) is a voltage constraint identical to the
//! DC source ([`ELEM_VSOURCE`]) — same branch-current unknown, same stamp — except
//! its right-hand-side EMF is a sine that is a pure deterministic function of the
//! current [`Sim::tick`]:
//! `V(a) - V(b) = AC_AMPLITUDE * sin(2*pi * f * tick * dt)`, where `f` is its
//! `value` (frequency in Hz, clamped to `>= 0`) and the peak amplitude is the
//! fixed [`AC_AMPLITUDE`]. Being linear and time-varying it carries no Newton
//! machinery: like the switch, it is part of the fixed linear base and its EMF is
//! recomputed once per solve from the tick (the sine is exactly `0` at `t = 0`),
//! so it composes with a diode rectifier on the Newton path. Amplitude is fixed
//! for now; a two-parameter (amplitude + frequency) netlist is future work.
//!
//! ## Clock-driven switch
//!
//! The **switch** (`ELEM_SWITCH`) is a deterministic PWM element: a
//! time-varying *linear* conductance between `a` and `b` whose state is a pure
//! function of the current [`Sim::tick`]. It chops with a fixed period of
//! [`SWITCH_PERIOD_TICKS`] ticks; its `value` is the duty cycle in `[0, 1]`
//! (clamped). It is closed for the first `round(duty * SWITCH_PERIOD_TICKS)`
//! ticks of each period and open otherwise, i.e.
//! `closed = (tick % SWITCH_PERIOD_TICKS) < on_ticks`. Closed it stamps the
//! on-conductance `1/`[`SWITCH_RON`]; open it stamps [`SWITCH_GOFF`]. The stamp
//! is exactly a resistor's symmetric KCL stamp (no branch unknown, no reactive
//! state), so the switch needs **no Newton machinery** — it is part of the fixed
//! linear base even when a diode forces the Newton path, with its conductance
//! computed once per solve from the tick before any iterating. This makes a buck
//! converter (switch into an inductor + freewheel diode + output cap) expressible
//! as an ordinary netlist.
//!
//! ## MNA layout
//!
//! The unknown vector is, in this fixed order:
//!
//! ```text
//!   x = [ v(node 1), v(node 2), ..., v(node n-1),   // node voltages (ground excluded)
//!         i(Vsrc 0), i(Vsrc 1), ...,                // one branch current per voltage source
//!         i(L 0),    i(L 1),    ... ]                // one branch current per inductor
//! ```
//!
//! Node `k` (for `k >= 1`) maps to matrix index `k - 1`; node `0` (ground) has
//! no row or column. Voltage-source and inductor branch currents are appended in
//! ascending element index, so assembly and solve order are fully fixed. The
//! diode adds **no** branch unknown — it stamps a conductance and an equivalent
//! current into the KCL rows like a resistor in parallel with a current source —
//! so it never changes the system dimension.
//!
//! ## Companion models (backward-Euler, step `dt`)
//!
//! - **Capacitor** `C` between `a,b`: equivalent conductance `g = C/dt` in
//!   parallel with a history current source `ieq = g * (V(a)-V(b))_prev`. The
//!   element current (`a -> b`) is `g*(V(a)-V(b)) - ieq`.
//! - **Inductor** `L` between `a,b`: a branch-current unknown `i` (oriented
//!   `a -> b`) with branch equation `V(a)-V(b) - (L/dt)*i = -(L/dt)*i_prev`.
//!
//! ## Nonlinear devices and the Newton outer loop
//!
//! A nonlinear element contributes a current `i(v)` that is not affine in the
//! node voltages, so a single solve cannot find the operating point. Instead the
//! solver linearizes each nonlinear element about the **previous iterate** `v*`
//! into a companion (a conductance `g = di/dv|_{v*}` in parallel with an
//! equivalent current source `Ieq = i(v*) - g*v*`), solves the resulting linear
//! MNA system, updates the node voltages, and repeats until convergence. This is
//! Newton–Raphson on the nodal equations and is engaged **only** when at least
//! one nonlinear element is present.
//!
//! The loop is built to be deterministic and bounded:
//!
//! - Fixed iteration order, fixed assembly/solve order, pure `f64`, no
//!   hashed-collection iteration, no nondeterministic reductions.
//! - Capped at [`NEWTON_MAX_ITERS`] iterations; if it has not converged it
//!   settles to the last iterate (a defined outcome, never an infinite loop).
//! - Convergence requires **both** a small node-voltage update and a small
//!   residual, each with a fixed absolute + relative tolerance
//!   ([`NEWTON_V_ABSTOL`]/[`NEWTON_RELTOL`], [`NEWTON_I_ABSTOL`]).
//! - Robustness aids with fixed constants: pn-junction voltage limiting
//!   (`pnjlim`-style) damps the per-iteration step across a junction to keep the
//!   exponential from exploding, and a small conductance [`GMIN`] is stamped
//!   across every junction so a reverse-biased or floating junction never yields
//!   a singular row.
//!
//! In transient, the Newton loop runs **inside** each fixed [`DT`] step:
//! reactive companions use the previous *step's* state (as in the linear path),
//! while the Newton iterate converges the nonlinear devices within the step.
//!
//! ## Determinism
//!
//! Dynamically-sized but fixed-per-netlist dense MNA (Vec-backed), fixed
//! assembly and solve order, pure `f64` arithmetic, no hashed-collection
//! iteration, and no nondeterministic float reductions. The Newton loop adds a
//! data-dependent iteration *count* but every iteration is itself deterministic
//! and the count is bounded, so a given netlist still reproduces bit-for-bit.
//! The snapshot hash is FNV-1a over the tick and node voltages (little-endian,
//! fixed order), never the std default hasher. See `docs/determinism.md`.

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

/// Fixed integration step, in seconds (2 microseconds). The step sets fidelity
/// and is independent of the presentation speed; finer = smoother dynamics at a
/// proportionally higher tick rate. See `docs/determinism.md`.
const DT: f64 = 2.0e-6;

// --- Element-type encoding ----------------------------------------------------

/// Ideal DC voltage source; `value` is volts. Enforces `V(a) - V(b) = value`
/// through an MNA branch-current augmentation.
pub const ELEM_VSOURCE: u8 = 0;
/// Resistor; `value` is ohms.
pub const ELEM_RESISTOR: u8 = 1;
/// Capacitor; `value` is farads (backward-Euler companion).
pub const ELEM_CAPACITOR: u8 = 2;
/// Inductor; `value` is henries (backward-Euler companion, branch-current
/// unknown).
pub const ELEM_INDUCTOR: u8 = 3;
/// Ideal DC current source; `value` is amps (the dual of the voltage source).
/// The arrow points `a -> b`: a positive `value` *draws* current out of node
/// `a` and *delivers* it into node `b` (KCL stamp `rhs[a] -= value;
/// rhs[b] += value`). It is a pure right-hand-side stamp — no branch-current
/// unknown and no reactive state.
pub const ELEM_ISOURCE: u8 = 4;
/// Junction **diode** (the first nonlinear element). Oriented anode `a` ->
/// cathode `b`, it obeys the Shockley law `i = Is*(exp(v/(n*Vt)) - 1)` with
/// `v = V(a) - V(b)`. Its presence engages the deterministic Newton outer loop;
/// each iteration it contributes the companion conductance `g = di/dv` and the
/// equivalent current `Ieq = i(v*) - g*v*` evaluated at the previous iterate
/// `v*`. The `value` field is **unused** for now (the model uses the fixed
/// defaults [`DIODE_IS`], [`DIODE_N`], [`DIODE_VT`]); it is reserved for a
/// future per-device saturation current / emission coefficient.
pub const ELEM_DIODE: u8 = 5;
/// Clock-driven **switch** (PWM). Oriented `a <-> b` (symmetric, like a
/// resistor). Its `value` is the **duty cycle** in `[0, 1]` (clamped). The
/// switch is a *time-varying linear conductance*: a pure deterministic function
/// of the current tick with period [`SWITCH_PERIOD_TICKS`], closed (conductance
/// `1/`[`SWITCH_RON`]) for the first `round(duty * SWITCH_PERIOD_TICKS)` ticks of
/// each period and open ([`SWITCH_GOFF`]) otherwise. It stamps like a resistor
/// of that conductance and carries **no** branch unknown and no reactive state,
/// so it needs no Newton machinery even when a diode is present.
pub const ELEM_SWITCH: u8 = 6;
/// Sinusoidal **AC voltage source**. Oriented `a -> b`, it enforces the
/// time-varying constraint `V(a) - V(b) = `[`AC_AMPLITUDE`]` * sin(2*pi * f *
/// tick * dt)` through the same MNA branch-current augmentation as
/// [`ELEM_VSOURCE`]; the *only* difference is the right-hand-side EMF is this
/// sine rather than a constant. Its `value` is the frequency `f` in hertz
/// (clamped to `>= 0`); the peak amplitude is the fixed [`AC_AMPLITUDE`]. The EMF
/// is a pure deterministic function of the tick (so it reproduces and rewinds
/// with the tick and is exactly `0` at `t = 0`), and the element is linear, so it
/// lives in the fixed linear base and needs no Newton machinery.
pub const ELEM_ACSOURCE: u8 = 7;

// --- AC voltage source model constants ----------------------------------------

/// Peak amplitude of an [`ELEM_ACSOURCE`], in volts. Fixed for now (the source's
/// `value` carries only the frequency); a two-parameter netlist that also sets
/// amplitude per device is future work. Held constant so the EMF stays a pure
/// function of the tick and the value field.
const AC_AMPLITUDE: f64 = 5.0;

// --- Clock-driven switch model constants --------------------------------------

/// Switching period of [`ELEM_SWITCH`], in ticks. With [`DT`] = 2 us this is
/// 100 us, i.e. a 10 kHz switching frequency. Fixed for determinism; the switch
/// state is `(tick % SWITCH_PERIOD_TICKS) < round(duty * SWITCH_PERIOD_TICKS)`.
const SWITCH_PERIOD_TICKS: u64 = 50;
/// On-state resistance of a closed [`ELEM_SWITCH`], in ohms. Small but finite so
/// the closed switch behaves like a near-ideal conductance `1/SWITCH_RON`
/// without making the MNA system singular.
const SWITCH_RON: f64 = 0.01;
/// Off-state conductance of an open [`ELEM_SWITCH`], in siemens. Tiny but
/// nonzero so an open switch leaves a finite (non-singular) stamp, mirroring the
/// `gmin` floor used across diode junctions.
const SWITCH_GOFF: f64 = 1.0e-9;

// --- Diode (Shockley) model constants -----------------------------------------

/// Diode saturation current `Is`, in amperes. Fixed default (a typical
/// small-signal silicon junction). Held constant for determinism; the diode's
/// `value` field is unused for now.
const DIODE_IS: f64 = 1.0e-12;
/// Diode emission (ideality) coefficient `n`, dimensionless. Fixed default.
const DIODE_N: f64 = 1.0;
/// Thermal voltage `Vt = kT/q`, in volts, at ~300 K. Fixed default.
const DIODE_VT: f64 = 0.025_852;

// --- Newton outer-loop constants ----------------------------------------------

/// Hard cap on Newton iterations per solve. If the loop has not converged by
/// here it settles to the last iterate — a defined, finite outcome rather than
/// an unbounded loop. Generous enough that the well-posed circuits we target
/// converge well within it.
const NEWTON_MAX_ITERS: usize = 100;
/// Absolute tolerance on the per-iteration node-voltage update, in volts.
const NEWTON_V_ABSTOL: f64 = 1.0e-9;
/// Relative tolerance applied to the larger of the new and old node voltage when
/// testing the update (so large rails converge on a relative basis).
const NEWTON_RELTOL: f64 = 1.0e-6;
/// Absolute tolerance on the nonlinear-current residual, in amperes. Around the
/// diode saturation current so a converged reverse bias still passes.
const NEWTON_I_ABSTOL: f64 = 1.0e-12;
/// Minimum conductance stamped across every nonlinear junction, in siemens.
/// Keeps a reverse-biased or floating junction from producing a singular row and
/// gives Newton a finite slope everywhere. Tiny enough not to disturb the
/// forward operating point at our tolerances.
const GMIN: f64 = 1.0e-12;

/// One two-terminal ideal element in the netlist.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Element {
    /// Element type. See the `ELEM_*` constants.
    pub kind: u8,
    /// First terminal node index. Node `0` is ground.
    pub a: usize,
    /// Second terminal node index. Node `0` is ground.
    pub b: usize,
    /// Element value in the units implied by `kind` (V / ohm / F / H / A).
    pub value: f64,
}

/// Solve `A x = b` for a dense, row-major `n x n` system by Gaussian elimination
/// with partial pivoting. Vec-backed so the dimension can vary per netlist, but
/// the dimension and the assembly/solve order are fixed once a netlist is
/// installed, which preserves determinism (no data-dependent control flow, no
/// hashed iteration, fixed float-operation order).
///
/// Deterministic pivot tie-break: a row wins only on strictly greater magnitude,
/// so equal magnitudes keep the earlier row. A degenerate (zero) pivot falls
/// back to `0.0` rather than producing a NaN, keeping the run finite and
/// reproducible even for an ill-posed netlist.
fn solve_dense(mut a: Vec<f64>, mut b: Vec<f64>, n: usize) -> Vec<f64> {
    debug_assert_eq!(a.len(), n * n);
    debug_assert_eq!(b.len(), n);

    // Forward elimination.
    for col in 0..n {
        // Partial pivot: row at or below `col` with the largest |a[row][col]|.
        let mut pivot = col;
        let mut best = a[col * n + col].abs();
        for row in (col + 1)..n {
            let mag = a[row * n + col].abs();
            if mag > best {
                best = mag;
                pivot = row;
            }
        }
        if pivot != col {
            for k in 0..n {
                a.swap(col * n + k, pivot * n + k);
            }
            b.swap(col, pivot);
        }

        let diag = a[col * n + col];
        if diag == 0.0 {
            continue;
        }
        for row in (col + 1)..n {
            let factor = a[row * n + col] / diag;
            if factor == 0.0 {
                continue;
            }
            // Eliminate left-to-right over columns `col..n` to keep the float
            // operation order fixed.
            for k in col..n {
                let v = a[col * n + k];
                a[row * n + k] -= factor * v;
            }
            b[row] -= factor * b[col];
        }
    }

    // Back substitution.
    let mut x = vec![0.0f64; n];
    for col in (0..n).rev() {
        let mut sum = b[col];
        for k in (col + 1)..n {
            sum -= a[col * n + k] * x[k];
        }
        let diag = a[col * n + col];
        x[col] = if diag == 0.0 { 0.0 } else { sum / diag };
    }
    x
}

// --- Diode (Shockley) device ---------------------------------------------------

/// Evaluate the Shockley diode current and small-signal conductance at junction
/// voltage `vd` (oriented anode -> cathode), returning `(i, g)` with
/// `i = Is*(exp(vd/(n*Vt)) - 1)` and `g = di/dvd = (Is/(n*Vt))*exp(vd/(n*Vt))`.
///
/// `vd` is expected to already be clamped by [`pnjlim`], so the exponential
/// argument is bounded and never overflows; the evaluation is a pure, branch-free
/// `f64` function for determinism.
#[inline]
fn diode_eval(vd: f64) -> (f64, f64) {
    let vth = DIODE_N * DIODE_VT;
    let e = (vd / vth).exp();
    let i = DIODE_IS * (e - 1.0);
    let g = (DIODE_IS / vth) * e;
    (i, g)
}

/// The critical junction voltage used by [`pnjlim`], `vcrit = n*Vt *
/// ln(n*Vt / (sqrt(2)*Is))`. This is the inflection of the exponential where
/// damping the Newton step keeps the iteration well conditioned. Computed once
/// per call from the fixed model constants (a few `f64` ops; `ln` is not `const`,
/// so this is a tiny pure function rather than a constant).
#[inline]
fn diode_vcrit() -> f64 {
    let vth = DIODE_N * DIODE_VT;
    vth * (vth / (core::f64::consts::SQRT_2 * DIODE_IS)).ln()
}

/// pn-junction voltage limiting (the classic SPICE `pnjlim`). Given the proposed
/// new junction voltage `vnew` and the previous-iterate voltage `vold` (both
/// anode -> cathode), return a damped voltage that limits how fast the junction
/// can swing forward, so the diode exponential cannot explode and Newton stays
/// well behaved. Reverse and small-forward steps pass through unchanged; only
/// large forward excursions past `vcrit` are compressed logarithmically. This is
/// a deterministic, pure `f64` function — the heart of the nonlinear robustness.
#[inline]
fn pnjlim(vnew: f64, vold: f64) -> f64 {
    let vcrit = diode_vcrit();
    let vth = DIODE_N * DIODE_VT;
    if vnew > vcrit && (vnew - vold).abs() > 2.0 * vth {
        if vold > 0.0 {
            let arg = 1.0 + (vnew - vold) / vth;
            if arg > 0.0 {
                vold + vth * arg.ln()
            } else {
                // Would step the argument non-positive; fall back to vcrit, the
                // standard SPICE guard, keeping the step finite.
                vcrit
            }
        } else {
            // Coming from a non-positive bias, clamp to the safe knee region.
            vth * (vnew / vth).ln()
        }
    } else {
        vnew
    }
}

/// Deterministic fixed-step analog simulation of an arbitrary netlist.
#[derive(Clone, Debug)]
pub struct Sim {
    /// Tick count since the netlist was installed or reset; one tick is one
    /// [`DT`] step.
    tick: u64,

    /// Number of circuit nodes including ground (node `0`). At least `1`.
    node_count: usize,
    /// The installed elements, in their submission order.
    elements: Vec<Element>,

    /// MNA system dimension: `(node_count - 1)` node voltages plus one branch
    /// current per voltage source plus one per inductor. Diodes add no unknown.
    dim: usize,
    /// For each element index, the column/row of its branch-current unknown in
    /// the MNA system, or `usize::MAX` if the element has no branch unknown
    /// (resistors, capacitors, and diodes).
    branch_index: Vec<usize>,
    /// `true` iff the installed netlist contains at least one nonlinear element
    /// (today: a diode). Selects the Newton outer loop over the linear fast path;
    /// when `false`, the solve is byte-for-byte the original single-pass solve.
    has_nonlinear: bool,

    /// Latest solved node voltages, length `node_count`, index `0` always `0.0`.
    node_v: Vec<f64>,
    /// Dynamic state carried between steps: for a capacitor (`ELEM_CAPACITOR`),
    /// the previous `V(a) - V(b)`; for an inductor (`ELEM_INDUCTOR`), the
    /// previous branch current `i` (oriented `a -> b`). Unused for other kinds.
    /// One entry per element, indexed in lockstep with `elements`.
    reactive_state: Vec<f64>,
    /// Per-element junction voltage `V(a) - V(b)` carried for nonlinear devices
    /// (today: diodes). Seeds the Newton iterate and gives [`pnjlim`] its
    /// previous-iterate reference, so each step starts from the converged
    /// junction of the last step. Only the diode entries are meaningful; others
    /// stay `0.0`. Indexed in lockstep with `elements`.
    diode_vd: Vec<f64>,
    /// Latest current through each element (oriented `a -> b`), one entry per
    /// element in submission order. Committed by every solve while the
    /// pre-step reactive state is still in scope, so `element_currents` is a
    /// pure function of the committed readout and consistent with `node_v` at
    /// the same tick. See [`Sim::element_currents`] for the per-kind formulas.
    currents: Vec<f64>,
}

impl Sim {
    /// Create a fresh simulation from a seed, pre-loaded with a small demo
    /// netlist so the front end shows life before the user builds anything.
    ///
    /// The demo is the classic RC charge: an ideal DC source drives a 1 kohm
    /// series resistor charging a 1 uF capacitor to ground. The seed
    /// parameterizes the **source voltage** deterministically (a rail in
    /// `[1.0, 12.0]` V) without any platform-dependent float hashing, so
    /// different seeds charge toward different targets while the topology is
    /// identical. The capacitor starts discharged.
    ///
    /// ```text
    ///        (1)         R          (2)
    ///     +---o----[ 1k ohm ]----o----+
    ///     |                           |
    ///   ( V )                       = 1uF
    ///     |                           |
    ///     +-----------o---------------+
    ///                GND (node 0)
    /// ```
    pub fn new(seed: u64) -> Self {
        // Map the seed into a tidy supply rail without any platform-dependent
        // float hashing: a plain integer fold, then a fixed affine map.
        let folded = (seed ^ (seed >> 32)) & 0xffff;
        let v_source = 1.0 + (folded as f64 / 65_535.0) * 11.0; // 1.0 .. 12.0 V

        let mut sim = Sim {
            tick: 0,
            node_count: 1,
            elements: Vec::new(),
            dim: 0,
            branch_index: Vec::new(),
            has_nonlinear: false,
            node_v: vec![0.0],
            reactive_state: Vec::new(),
            diode_vd: Vec::new(),
            currents: Vec::new(),
        };
        // Demo RC netlist: V(1->ground) -> R -> C -> ground. Nodes: 0 = gnd,
        // 1 = source/R junction, 2 = R/C junction.
        let demo = vec![
            Element {
                kind: ELEM_VSOURCE,
                a: 1,
                b: 0,
                value: v_source,
            },
            Element {
                kind: ELEM_RESISTOR,
                a: 1,
                b: 2,
                value: 1_000.0,
            },
            Element {
                kind: ELEM_CAPACITOR,
                a: 2,
                b: 0,
                value: 1.0e-6,
            },
        ];
        sim.install(3, demo);
        sim
    }

    /// Replace the circuit with the given netlist and reset to `t = 0`.
    ///
    /// `types`, `a`, `b`, and `values` are parallel arrays (one entry per
    /// element). On any length mismatch, a node index outside `0..node_count`,
    /// a zero `node_count`, or an unknown element type, the call **fails safe
    /// deterministically**: the simulation is replaced with an empty
    /// single-node (ground-only) circuit and `false` is returned. On success the
    /// netlist is installed, reactive elements start discharged, and `true` is
    /// returned. Never panics.
    pub fn set_netlist(
        &mut self,
        node_count: usize,
        types: &[u8],
        a: &[u32],
        b: &[u32],
        values: &[f64],
    ) -> bool {
        let n = types.len();
        if a.len() != n || b.len() != n || values.len() != n || node_count == 0 {
            self.install_empty();
            return false;
        }

        let mut elements = Vec::with_capacity(n);
        for i in 0..n {
            let kind = types[i];
            if !matches!(
                kind,
                ELEM_VSOURCE
                    | ELEM_RESISTOR
                    | ELEM_CAPACITOR
                    | ELEM_INDUCTOR
                    | ELEM_ISOURCE
                    | ELEM_DIODE
                    | ELEM_SWITCH
                    | ELEM_ACSOURCE
            ) {
                self.install_empty();
                return false;
            }
            let na = a[i] as usize;
            let nb = b[i] as usize;
            if na >= node_count || nb >= node_count {
                self.install_empty();
                return false;
            }
            elements.push(Element {
                kind,
                a: na,
                b: nb,
                value: values[i],
            });
        }

        self.install(node_count, elements);
        true
    }

    /// Install the empty ground-only circuit. Used as the deterministic
    /// fail-safe state for an invalid netlist.
    fn install_empty(&mut self) {
        self.install(1, Vec::new());
    }

    /// Install a validated netlist: build the MNA index map, size the buffers,
    /// reset reactive state and the tick, then solve once at `t = 0` so the
    /// readout rails are consistent before the first step.
    fn install(&mut self, node_count: usize, elements: Vec<Element>) {
        // Branch-current unknowns are appended after the node voltages, in
        // ascending element index, for voltage sources and inductors.
        let node_unknowns = node_count - 1;
        let mut branch_index = vec![usize::MAX; elements.len()];
        let mut next = node_unknowns;
        for (i, e) in elements.iter().enumerate() {
            if e.kind == ELEM_VSOURCE || e.kind == ELEM_ACSOURCE || e.kind == ELEM_INDUCTOR {
                branch_index[i] = next;
                next += 1;
            }
        }

        let has_nonlinear = elements.iter().any(|e| e.kind == ELEM_DIODE);

        self.node_count = node_count;
        self.dim = next;
        self.branch_index = branch_index;
        self.has_nonlinear = has_nonlinear;
        self.reactive_state = vec![0.0; elements.len()];
        self.diode_vd = vec![0.0; elements.len()];
        self.currents = vec![0.0; elements.len()];
        self.node_v = vec![0.0; node_count];
        self.elements = elements;
        self.tick = 0;
        // Prime the readout at the initial operating point (t = 0). Does not
        // advance the tick or the per-tick reactive state.
        self.solve_operating_point();
    }

    /// Reset to `t = 0` with reactive elements discharged, keeping the same
    /// netlist.
    pub fn reset(&mut self) {
        self.tick = 0;
        for s in &mut self.reactive_state {
            *s = 0.0;
        }
        for vd in &mut self.diode_vd {
            *vd = 0.0;
        }
        for v in &mut self.node_v {
            *v = 0.0;
        }
        self.solve_operating_point();
    }

    /// Map a node index to its MNA row/column, or `None` for ground (node `0`).
    #[inline]
    fn node_idx(node: usize) -> Option<usize> {
        if node == 0 {
            None
        } else {
            Some(node - 1)
        }
    }

    /// Solve the **initial operating point** at `t = 0` and write the resulting
    /// node voltages into `self.node_v`. Reactive elements are pinned to their
    /// stored initial conditions rather than stepped: a capacitor is a voltage
    /// source holding its stored `V(a)-V(b)` (a short when discharged) and an
    /// inductor is a current source holding its stored branch current (an open
    /// when de-energized). This makes the pre-step snapshot reflect the genuine
    /// initial state — a discharged capacitor node reads its initial voltage,
    /// not the result of one implicit step.
    ///
    /// Used only at install/reset, so its (differently sized) system never
    /// affects the fixed per-tick cost of [`Sim::step`].
    fn solve_operating_point(&mut self) {
        // Nonlinear netlists take the Newton operating-point path; the linear
        // single-pass assembly below is left byte-for-byte unchanged.
        if self.has_nonlinear {
            self.solve_operating_point_newton();
            return;
        }
        let node_unknowns = self.node_count - 1;

        // Capacitors and voltage sources each need a branch-current unknown in
        // the operating-point system; inductors become current sources (no
        // unknown). Index them in ascending element order for a fixed layout.
        let mut op_branch = vec![usize::MAX; self.elements.len()];
        let mut next = node_unknowns;
        for (i, e) in self.elements.iter().enumerate() {
            if e.kind == ELEM_VSOURCE || e.kind == ELEM_ACSOURCE || e.kind == ELEM_CAPACITOR {
                op_branch[i] = next;
                next += 1;
            }
        }
        let n = next;

        if n == 0 {
            for v in &mut self.node_v {
                *v = 0.0;
            }
            return;
        }

        let mut mat = vec![0.0f64; n * n];
        let mut rhs = vec![0.0f64; n];

        for (i, e) in self.elements.iter().enumerate() {
            let ia = Self::node_idx(e.a);
            let ib = Self::node_idx(e.b);
            match e.kind {
                ELEM_RESISTOR => {
                    if e.value <= 0.0 {
                        continue;
                    }
                    let g = 1.0 / e.value;
                    if let Some(r) = ia {
                        mat[r * n + r] += g;
                    }
                    if let Some(r) = ib {
                        mat[r * n + r] += g;
                    }
                    if let (Some(r), Some(c)) = (ia, ib) {
                        mat[r * n + c] -= g;
                        mat[c * n + r] -= g;
                    }
                }
                ELEM_SWITCH => {
                    // Clock-driven switch: a time-varying conductance computed
                    // from the tick (tick 0 at the operating point). Stamped
                    // exactly like a resistor of that conductance.
                    let g = self.switch_conductance(e);
                    if let Some(r) = ia {
                        mat[r * n + r] += g;
                    }
                    if let Some(r) = ib {
                        mat[r * n + r] += g;
                    }
                    if let (Some(r), Some(c)) = (ia, ib) {
                        mat[r * n + c] -= g;
                        mat[c * n + r] -= g;
                    }
                }
                ELEM_VSOURCE | ELEM_ACSOURCE | ELEM_CAPACITOR => {
                    // Voltage constraint V(a) - V(b) = value, where `value` is
                    // the DC source EMF, the AC source's tick-determined sine EMF
                    // (exactly 0 here at tick 0), or the capacitor's stored
                    // voltage.
                    let bi = op_branch[i];
                    let v = match e.kind {
                        ELEM_VSOURCE => e.value,
                        ELEM_ACSOURCE => self.ac_source_emf(e),
                        _ => self.reactive_state[i],
                    };
                    if let Some(r) = ia {
                        mat[r * n + bi] += 1.0;
                        mat[bi * n + r] += 1.0;
                    }
                    if let Some(r) = ib {
                        mat[r * n + bi] -= 1.0;
                        mat[bi * n + r] -= 1.0;
                    }
                    rhs[bi] += v;
                }
                ELEM_INDUCTOR => {
                    // Current source injecting the stored branch current a -> b:
                    // current leaves a (rhs[a] -= il) and enters b (rhs[b] += il).
                    let il = self.reactive_state[i];
                    if let Some(r) = ia {
                        rhs[r] -= il;
                    }
                    if let Some(r) = ib {
                        rhs[r] += il;
                    }
                }
                ELEM_ISOURCE => {
                    // Ideal current source injecting `value` a -> b: current
                    // leaves a (rhs[a] -= value) and enters b (rhs[b] += value).
                    if let Some(r) = ia {
                        rhs[r] -= e.value;
                    }
                    if let Some(r) = ib {
                        rhs[r] += e.value;
                    }
                }
                _ => {}
            }
        }

        let x = solve_dense(mat, rhs, n);
        // Node voltages occupy the first `node_count - 1` unknowns; ground (0)
        // stays pinned. The branch unknowns follow and are read separately.
        self.node_v[0] = 0.0;
        self.node_v[1..self.node_count].copy_from_slice(&x[..self.node_count - 1]);
        // Commit per-element currents (oriented a -> b) from the operating
        // point. Voltage sources and capacitors carry their branch unknown;
        // inductors carry their stored initial current; resistors and the
        // switch derive from the node voltages.
        for (i, e) in self.elements.iter().enumerate() {
            self.currents[i] = match e.kind {
                ELEM_RESISTOR => {
                    if e.value <= 0.0 {
                        0.0
                    } else {
                        self.element_voltage(e) / e.value
                    }
                }
                ELEM_SWITCH => self.switch_conductance(e) * self.element_voltage(e),
                ELEM_VSOURCE | ELEM_ACSOURCE | ELEM_CAPACITOR => x[op_branch[i]],
                ELEM_INDUCTOR => self.reactive_state[i],
                ELEM_ISOURCE => e.value,
                _ => 0.0,
            };
        }
    }

    /// Assemble the MNA system for the current reactive state, solve it, and
    /// write the resulting node voltages into `self.node_v`. Returns the solved
    /// unknown vector `x` (node voltages followed by branch currents) so the
    /// caller can both commit dynamic state and read branch currents. Does not
    /// advance the tick or the reactive state.
    fn solve_into_readout(&mut self) -> Vec<f64> {
        // Nonlinear netlists take the Newton transient path; the linear
        // single-pass assembly below is left byte-for-byte unchanged.
        if self.has_nonlinear {
            return self.solve_into_readout_newton();
        }
        let n = self.dim;
        if n == 0 {
            // Ground-only (or empty) circuit: nothing to solve.
            for v in &mut self.node_v {
                *v = 0.0;
            }
            return Vec::new();
        }

        let mut mat = vec![0.0f64; n * n];
        let mut rhs = vec![0.0f64; n];

        for (i, e) in self.elements.iter().enumerate() {
            let ia = Self::node_idx(e.a);
            let ib = Self::node_idx(e.b);
            match e.kind {
                ELEM_RESISTOR => {
                    // Guard a zero/negative resistance deterministically: skip
                    // the stamp (treat as open) rather than dividing by zero.
                    if e.value <= 0.0 {
                        continue;
                    }
                    let g = 1.0 / e.value;
                    if let Some(r) = ia {
                        mat[r * n + r] += g;
                    }
                    if let Some(r) = ib {
                        mat[r * n + r] += g;
                    }
                    if let (Some(r), Some(c)) = (ia, ib) {
                        mat[r * n + c] -= g;
                        mat[c * n + r] -= g;
                    }
                }
                ELEM_SWITCH => {
                    // Clock-driven switch: a time-varying conductance that is a
                    // pure function of the current tick. Stamped exactly like a
                    // resistor of that conductance (symmetric, no branch unknown,
                    // no reactive state).
                    let g = self.switch_conductance(e);
                    if let Some(r) = ia {
                        mat[r * n + r] += g;
                    }
                    if let Some(r) = ib {
                        mat[r * n + r] += g;
                    }
                    if let (Some(r), Some(c)) = (ia, ib) {
                        mat[r * n + c] -= g;
                        mat[c * n + r] -= g;
                    }
                }
                ELEM_CAPACITOR => {
                    // Backward-Euler companion: conductance g = C/dt with a
                    // history current source ieq = g * (V(a)-V(b))_prev.
                    let g = e.value / DT;
                    let ieq = g * self.reactive_state[i];
                    if let Some(r) = ia {
                        mat[r * n + r] += g;
                        rhs[r] += ieq;
                    }
                    if let Some(r) = ib {
                        mat[r * n + r] += g;
                        rhs[r] -= ieq;
                    }
                    if let (Some(r), Some(c)) = (ia, ib) {
                        mat[r * n + c] -= g;
                        mat[c * n + r] -= g;
                    }
                }
                ELEM_VSOURCE => {
                    // MNA augmentation: branch current i (oriented a -> b)
                    // couples into the KCL rows; the branch row enforces
                    // V(a) - V(b) = value.
                    let bi = self.branch_index[i];
                    if let Some(r) = ia {
                        mat[r * n + bi] += 1.0;
                        mat[bi * n + r] += 1.0;
                    }
                    if let Some(r) = ib {
                        mat[r * n + bi] -= 1.0;
                        mat[bi * n + r] -= 1.0;
                    }
                    rhs[bi] += e.value;
                }
                ELEM_ACSOURCE => {
                    // Identical MNA augmentation to a DC source; the only
                    // difference is the EMF is the tick-determined sine, computed
                    // once here from the current tick (linear and time-varying).
                    let bi = self.branch_index[i];
                    if let Some(r) = ia {
                        mat[r * n + bi] += 1.0;
                        mat[bi * n + r] += 1.0;
                    }
                    if let Some(r) = ib {
                        mat[r * n + bi] -= 1.0;
                        mat[bi * n + r] -= 1.0;
                    }
                    rhs[bi] += self.ac_source_emf(e);
                }
                ELEM_INDUCTOR => {
                    // Backward-Euler companion with a branch current i
                    // (oriented a -> b): V(a) - V(b) - (L/dt)*i = -(L/dt)*i_prev.
                    let bi = self.branch_index[i];
                    let r_l = e.value / DT;
                    if let Some(r) = ia {
                        mat[r * n + bi] += 1.0;
                        mat[bi * n + r] += 1.0;
                    }
                    if let Some(r) = ib {
                        mat[r * n + bi] -= 1.0;
                        mat[bi * n + r] -= 1.0;
                    }
                    mat[bi * n + bi] -= r_l;
                    rhs[bi] -= r_l * self.reactive_state[i];
                }
                ELEM_ISOURCE => {
                    // Ideal current source injecting `value` a -> b: current
                    // leaves a (rhs[a] -= value) and enters b (rhs[b] += value).
                    // No branch unknown and no history term — a pure KCL stamp.
                    if let Some(r) = ia {
                        rhs[r] -= e.value;
                    }
                    if let Some(r) = ib {
                        rhs[r] += e.value;
                    }
                }
                _ => {}
            }
        }

        let x = solve_dense(mat, rhs, n);

        // Scatter node voltages back; ground stays 0. They occupy the first
        // `node_count - 1` unknowns; branch currents follow.
        self.node_v[0] = 0.0;
        self.node_v[1..self.node_count].copy_from_slice(&x[..self.node_count - 1]);
        // Commit per-element currents (oriented a -> b) while `reactive_state`
        // still holds the previous-step values, so the capacitor companion uses
        // the correct history term. Sources and inductors carry branch unknowns.
        for (i, e) in self.elements.iter().enumerate() {
            self.currents[i] = match e.kind {
                ELEM_RESISTOR => {
                    if e.value <= 0.0 {
                        0.0
                    } else {
                        self.element_voltage(e) / e.value
                    }
                }
                ELEM_SWITCH => self.switch_conductance(e) * self.element_voltage(e),
                ELEM_CAPACITOR => {
                    let g = e.value / DT;
                    let ieq = g * self.reactive_state[i];
                    g * self.element_voltage(e) - ieq
                }
                ELEM_VSOURCE | ELEM_ACSOURCE | ELEM_INDUCTOR => x[self.branch_index[i]],
                ELEM_ISOURCE => e.value,
                _ => 0.0,
            };
        }
        x
    }

    // --- Nonlinear (Newton) solve paths --------------------------------------
    //
    // These mirror the linear paths above but wrap the assembly in the bounded,
    // deterministic Newton outer loop. They run only when `has_nonlinear` is
    // true, so the linear fast paths stay byte-for-byte identical. The linear
    // part of the system does not change between iterations, so it is stamped
    // once into `base_mat`/`base_rhs`; each iteration copies that base and adds
    // only the diode companion stamps evaluated at the current iterate.

    /// Run the Newton outer loop on a system whose **linear** part is already
    /// stamped into `base_mat` (`n x n`, row-major) and `base_rhs` (`n`). The
    /// `diodes` slice lists, in ascending element order, each diode as
    /// `(element_index, anode_mna_idx, cathode_mna_idx)` where the MNA index is
    /// `None` for ground. The node-voltage iterate is seeded from `self.node_v`
    /// and the junction iterate from `self.diode_vd`; both are updated in place,
    /// and the solved unknown vector `x` of the final iterate is returned.
    ///
    /// Determinism: fixed element/diode order, fixed assembly and solve order,
    /// pure `f64`, no hashed iteration. The iteration count is data-dependent but
    /// bounded by [`NEWTON_MAX_ITERS`]; on non-convergence the last iterate is
    /// kept (a defined, finite outcome).
    fn newton_iterate(
        &mut self,
        n: usize,
        base_mat: &[f64],
        base_rhs: &[f64],
        diodes: &[(usize, Option<usize>, Option<usize>)],
    ) -> Vec<f64> {
        // Working unknown vector; node-voltage entries seed from the last solve
        // so a transient step starts near its answer (few iterations).
        let mut x = vec![0.0f64; n];
        x[..(self.node_count - 1)].copy_from_slice(&self.node_v[1..self.node_count]);

        let mut last = x.clone();
        for _iter in 0..NEWTON_MAX_ITERS {
            let mut mat = base_mat.to_vec();
            let mut rhs = base_rhs.to_vec();

            // Stamp each diode's companion at its current junction voltage.
            // g = di/dv and Ieq = i(v*) - g*v* (plus GMIN for a finite slope).
            for &(ei, ia, ib) in diodes {
                let vd = self.diode_vd[ei];
                let (id, gd) = diode_eval(vd);
                let g = gd + GMIN;
                let ieq = id - g * vd;
                if let Some(r) = ia {
                    mat[r * n + r] += g;
                    rhs[r] -= ieq;
                }
                if let Some(r) = ib {
                    mat[r * n + r] += g;
                    rhs[r] += ieq;
                }
                if let (Some(r), Some(c)) = (ia, ib) {
                    mat[r * n + c] -= g;
                    mat[c * n + r] -= g;
                }
            }

            x = solve_dense(mat, rhs, n);

            // Update junction voltages with pn-junction limiting, and measure the
            // largest limited junction swing for the residual-style current test.
            let mut max_i_change = 0.0f64;
            for &(ei, ia, ib) in diodes {
                let va = ia.map(|r| x[r]).unwrap_or(0.0);
                let vb = ib.map(|r| x[r]).unwrap_or(0.0);
                let vd_raw = va - vb;
                let vd_old = self.diode_vd[ei];
                let vd_new = pnjlim(vd_raw, vd_old);
                // Compare the device current at the old vs the limited-new bias;
                // a converged junction barely moves, so this drives the I-test.
                let (i_old, _) = diode_eval(vd_old);
                let (i_new, _) = diode_eval(vd_new);
                let di = (i_new - i_old).abs();
                if di > max_i_change {
                    max_i_change = di;
                }
                self.diode_vd[ei] = vd_new;
            }

            // Node-voltage update test (absolute + relative), over node rows only.
            let mut converged_v = true;
            for r in 0..(self.node_count - 1) {
                let dv = (x[r] - last[r]).abs();
                let tol = NEWTON_V_ABSTOL + NEWTON_RELTOL * x[r].abs().max(last[r].abs());
                if dv > tol {
                    converged_v = false;
                }
            }
            let converged_i = max_i_change <= NEWTON_I_ABSTOL;

            // Require both tests, and at least one full iteration, so a stale seed
            // cannot report convergence before a fresh solve.
            if converged_v && converged_i {
                // Recompute node voltages from the limited junctions on the next
                // pass would be a no-op (already converged); commit and stop.
                self.node_v[0] = 0.0;
                self.node_v[1..self.node_count].copy_from_slice(&x[..self.node_count - 1]);
                return x;
            }
            last.copy_from_slice(&x);
        }

        // Iteration cap reached: settle deterministically to the last iterate.
        self.node_v[0] = 0.0;
        self.node_v[1..self.node_count].copy_from_slice(&x[..self.node_count - 1]);
        x
    }

    /// Newton operating-point solve (install/reset, `t = 0`) for nonlinear
    /// netlists. The linear part matches [`Sim::solve_operating_point`]
    /// (capacitors and voltage sources carry branch unknowns; inductors are
    /// current sources), with the diodes added as Newton companions. Writes
    /// `self.node_v` and commits `self.currents`.
    fn solve_operating_point_newton(&mut self) {
        let node_unknowns = self.node_count - 1;

        // Capacitors and voltage sources take branch unknowns, as in the linear
        // OP path. Diodes take none. Index in ascending element order.
        let mut op_branch = vec![usize::MAX; self.elements.len()];
        let mut next = node_unknowns;
        for (i, e) in self.elements.iter().enumerate() {
            if e.kind == ELEM_VSOURCE || e.kind == ELEM_ACSOURCE || e.kind == ELEM_CAPACITOR {
                op_branch[i] = next;
                next += 1;
            }
        }
        let n = next;

        if n == 0 {
            for v in &mut self.node_v {
                *v = 0.0;
            }
            return;
        }

        // Stamp the fixed linear part once and collect the diode terminal map.
        let mut base_mat = vec![0.0f64; n * n];
        let mut base_rhs = vec![0.0f64; n];
        let mut diodes: Vec<(usize, Option<usize>, Option<usize>)> = Vec::new();
        for (i, e) in self.elements.iter().enumerate() {
            let ia = Self::node_idx(e.a);
            let ib = Self::node_idx(e.b);
            match e.kind {
                ELEM_RESISTOR => {
                    if e.value <= 0.0 {
                        continue;
                    }
                    let g = 1.0 / e.value;
                    if let Some(r) = ia {
                        base_mat[r * n + r] += g;
                    }
                    if let Some(r) = ib {
                        base_mat[r * n + r] += g;
                    }
                    if let (Some(r), Some(c)) = (ia, ib) {
                        base_mat[r * n + c] -= g;
                        base_mat[c * n + r] -= g;
                    }
                }
                ELEM_VSOURCE | ELEM_ACSOURCE | ELEM_CAPACITOR => {
                    // A voltage constraint stamped into the fixed linear base: the
                    // DC EMF, the AC source's tick-determined sine (0 here at tick
                    // 0), or the capacitor's stored voltage. The AC source is
                    // linear, so it belongs in the base, not the Newton companion.
                    let bi = op_branch[i];
                    let v = match e.kind {
                        ELEM_VSOURCE => e.value,
                        ELEM_ACSOURCE => self.ac_source_emf(e),
                        _ => self.reactive_state[i],
                    };
                    if let Some(r) = ia {
                        base_mat[r * n + bi] += 1.0;
                        base_mat[bi * n + r] += 1.0;
                    }
                    if let Some(r) = ib {
                        base_mat[r * n + bi] -= 1.0;
                        base_mat[bi * n + r] -= 1.0;
                    }
                    base_rhs[bi] += v;
                }
                ELEM_INDUCTOR => {
                    let il = self.reactive_state[i];
                    if let Some(r) = ia {
                        base_rhs[r] -= il;
                    }
                    if let Some(r) = ib {
                        base_rhs[r] += il;
                    }
                }
                ELEM_ISOURCE => {
                    if let Some(r) = ia {
                        base_rhs[r] -= e.value;
                    }
                    if let Some(r) = ib {
                        base_rhs[r] += e.value;
                    }
                }
                ELEM_SWITCH => {
                    // Clock-driven switch: a tick-determined conductance stamped
                    // into the fixed linear base (computed once from tick 0 here),
                    // exactly like a resistor. Carries no branch unknown, so the
                    // Newton loop sees it as part of the constant base.
                    let g = self.switch_conductance(e);
                    if let Some(r) = ia {
                        base_mat[r * n + r] += g;
                    }
                    if let Some(r) = ib {
                        base_mat[r * n + r] += g;
                    }
                    if let (Some(r), Some(c)) = (ia, ib) {
                        base_mat[r * n + c] -= g;
                        base_mat[c * n + r] -= g;
                    }
                }
                ELEM_DIODE => diodes.push((i, ia, ib)),
                _ => {}
            }
        }

        let x = self.newton_iterate(n, &base_mat, &base_rhs, &diodes);

        // Commit per-element currents (oriented a -> b) at the operating point.
        for (i, e) in self.elements.iter().enumerate() {
            self.currents[i] = match e.kind {
                ELEM_RESISTOR => {
                    if e.value <= 0.0 {
                        0.0
                    } else {
                        self.element_voltage(e) / e.value
                    }
                }
                ELEM_SWITCH => self.switch_conductance(e) * self.element_voltage(e),
                ELEM_VSOURCE | ELEM_ACSOURCE | ELEM_CAPACITOR => x[op_branch[i]],
                ELEM_INDUCTOR => self.reactive_state[i],
                ELEM_ISOURCE => e.value,
                ELEM_DIODE => diode_eval(self.diode_vd[i]).0,
                _ => 0.0,
            };
        }
    }

    /// Newton transient solve (one step, current reactive state) for nonlinear
    /// netlists. The linear part matches [`Sim::solve_into_readout`] (capacitor
    /// and inductor backward-Euler companions, voltage-source and inductor branch
    /// unknowns), with the diodes added as Newton companions. Writes
    /// `self.node_v`, commits `self.currents`, and returns the solved unknown
    /// vector so [`Sim::step`] can read inductor branch currents.
    fn solve_into_readout_newton(&mut self) -> Vec<f64> {
        let n = self.dim;
        if n == 0 {
            for v in &mut self.node_v {
                *v = 0.0;
            }
            return Vec::new();
        }

        // Stamp the fixed linear part once and collect the diode terminal map.
        let mut base_mat = vec![0.0f64; n * n];
        let mut base_rhs = vec![0.0f64; n];
        let mut diodes: Vec<(usize, Option<usize>, Option<usize>)> = Vec::new();
        for (i, e) in self.elements.iter().enumerate() {
            let ia = Self::node_idx(e.a);
            let ib = Self::node_idx(e.b);
            match e.kind {
                ELEM_RESISTOR => {
                    if e.value <= 0.0 {
                        continue;
                    }
                    let g = 1.0 / e.value;
                    if let Some(r) = ia {
                        base_mat[r * n + r] += g;
                    }
                    if let Some(r) = ib {
                        base_mat[r * n + r] += g;
                    }
                    if let (Some(r), Some(c)) = (ia, ib) {
                        base_mat[r * n + c] -= g;
                        base_mat[c * n + r] -= g;
                    }
                }
                ELEM_CAPACITOR => {
                    let g = e.value / DT;
                    let ieq = g * self.reactive_state[i];
                    if let Some(r) = ia {
                        base_mat[r * n + r] += g;
                        base_rhs[r] += ieq;
                    }
                    if let Some(r) = ib {
                        base_mat[r * n + r] += g;
                        base_rhs[r] -= ieq;
                    }
                    if let (Some(r), Some(c)) = (ia, ib) {
                        base_mat[r * n + c] -= g;
                        base_mat[c * n + r] -= g;
                    }
                }
                ELEM_VSOURCE => {
                    let bi = self.branch_index[i];
                    if let Some(r) = ia {
                        base_mat[r * n + bi] += 1.0;
                        base_mat[bi * n + r] += 1.0;
                    }
                    if let Some(r) = ib {
                        base_mat[r * n + bi] -= 1.0;
                        base_mat[bi * n + r] -= 1.0;
                    }
                    base_rhs[bi] += e.value;
                }
                ELEM_ACSOURCE => {
                    // Same branch augmentation as a DC source, stamped into the
                    // fixed linear base; only the EMF differs (the tick-determined
                    // sine, computed once per step before any Newton iterating).
                    // Being linear, it is part of the constant base, so an AC
                    // source feeding a diode rectifier converges normally.
                    let bi = self.branch_index[i];
                    if let Some(r) = ia {
                        base_mat[r * n + bi] += 1.0;
                        base_mat[bi * n + r] += 1.0;
                    }
                    if let Some(r) = ib {
                        base_mat[r * n + bi] -= 1.0;
                        base_mat[bi * n + r] -= 1.0;
                    }
                    base_rhs[bi] += self.ac_source_emf(e);
                }
                ELEM_INDUCTOR => {
                    let bi = self.branch_index[i];
                    let r_l = e.value / DT;
                    if let Some(r) = ia {
                        base_mat[r * n + bi] += 1.0;
                        base_mat[bi * n + r] += 1.0;
                    }
                    if let Some(r) = ib {
                        base_mat[r * n + bi] -= 1.0;
                        base_mat[bi * n + r] -= 1.0;
                    }
                    base_mat[bi * n + bi] -= r_l;
                    base_rhs[bi] -= r_l * self.reactive_state[i];
                }
                ELEM_ISOURCE => {
                    if let Some(r) = ia {
                        base_rhs[r] -= e.value;
                    }
                    if let Some(r) = ib {
                        base_rhs[r] += e.value;
                    }
                }
                ELEM_SWITCH => {
                    // Clock-driven switch: a tick-determined conductance stamped
                    // into the fixed linear base (computed once per step from the
                    // current tick before any Newton iterating), exactly like a
                    // resistor. No branch unknown and no reactive state, so the
                    // Newton loop treats it as part of the constant base.
                    let g = self.switch_conductance(e);
                    if let Some(r) = ia {
                        base_mat[r * n + r] += g;
                    }
                    if let Some(r) = ib {
                        base_mat[r * n + r] += g;
                    }
                    if let (Some(r), Some(c)) = (ia, ib) {
                        base_mat[r * n + c] -= g;
                        base_mat[c * n + r] -= g;
                    }
                }
                ELEM_DIODE => diodes.push((i, ia, ib)),
                _ => {}
            }
        }

        let x = self.newton_iterate(n, &base_mat, &base_rhs, &diodes);

        // Commit per-element currents (oriented a -> b) while `reactive_state`
        // still holds the previous-step values (capacitor history term).
        for (i, e) in self.elements.iter().enumerate() {
            self.currents[i] = match e.kind {
                ELEM_RESISTOR => {
                    if e.value <= 0.0 {
                        0.0
                    } else {
                        self.element_voltage(e) / e.value
                    }
                }
                ELEM_SWITCH => self.switch_conductance(e) * self.element_voltage(e),
                ELEM_CAPACITOR => {
                    let g = e.value / DT;
                    let ieq = g * self.reactive_state[i];
                    g * self.element_voltage(e) - ieq
                }
                ELEM_VSOURCE | ELEM_ACSOURCE | ELEM_INDUCTOR => x[self.branch_index[i]],
                ELEM_ISOURCE => e.value,
                ELEM_DIODE => diode_eval(self.diode_vd[i]).0,
                _ => 0.0,
            };
        }
        x
    }

    /// The voltage across an element, `V(a) - V(b)`, from the latest solve.
    #[inline]
    fn element_voltage(&self, e: &Element) -> f64 {
        self.node_v[e.a] - self.node_v[e.b]
    }

    /// The instantaneous EMF of a sinusoidal AC source ([`ELEM_ACSOURCE`]) at the
    /// current tick: `AC_AMPLITUDE * sin(2*pi * f * tick * dt)`, where `e.value`
    /// is the frequency `f` in hertz (clamped to `>= 0`). This is the right-hand
    /// side of the source's voltage constraint `V(a) - V(b) = emf`, the only
    /// difference from a DC source. Pure `f64` and a deterministic function of the
    /// tick (so it reproduces and rewinds with the tick; at `tick = 0` it is
    /// exactly `0`). Recomputed once per solve and stamped into the fixed linear
    /// base, exactly like a DC source's constant `value`.
    #[inline]
    fn ac_source_emf(&self, e: &Element) -> f64 {
        let f = e.value.max(0.0);
        let phase = core::f64::consts::TAU * f * (self.tick as f64) * DT;
        AC_AMPLITUDE * phase.sin()
    }

    /// The conductance of a clock-driven switch ([`ELEM_SWITCH`]) at the current
    /// tick. `e.value` is the duty cycle, clamped into `[0, 1]`; the closed
    /// window is `round(duty * SWITCH_PERIOD_TICKS)` ticks per period and the
    /// switch is closed when `(tick % SWITCH_PERIOD_TICKS) < on_ticks`. Closed
    /// returns `1/`[`SWITCH_RON`]; open returns [`SWITCH_GOFF`]. Pure `f64` and a
    /// deterministic function of the tick, so every run reproduces. Computed once
    /// per solve (the Newton path stamps it into the fixed linear base before
    /// iterating), exactly like a resistor of that conductance.
    #[inline]
    fn switch_conductance(&self, e: &Element) -> f64 {
        let duty = e.value.clamp(0.0, 1.0);
        // round() ties away from zero; multiplying a duty in [0,1] by the period
        // is exact for these small magnitudes, so the boundary is well defined.
        let on_ticks = (duty * SWITCH_PERIOD_TICKS as f64).round() as u64;
        let closed = (self.tick % SWITCH_PERIOD_TICKS) < on_ticks;
        if closed {
            1.0 / SWITCH_RON
        } else {
            SWITCH_GOFF
        }
    }

    /// Advance exactly one fixed-size tick. Solves the implicit system, commits
    /// the new reactive state from the solution, and increments the tick. Pure
    /// `f64`, fixed order.
    pub fn step(&mut self) {
        let x = self.solve_into_readout();
        // Commit reactive state for the next step.
        for (i, e) in self.elements.iter().enumerate() {
            match e.kind {
                ELEM_CAPACITOR => {
                    // Store the new capacitor voltage V(a) - V(b).
                    self.reactive_state[i] = self.node_v[e.a] - self.node_v[e.b];
                }
                ELEM_INDUCTOR => {
                    // Store the new inductor branch current (a -> b).
                    let bi = self.branch_index[i];
                    self.reactive_state[i] = if bi < x.len() { x[bi] } else { 0.0 };
                }
                _ => {}
            }
        }
        self.tick += 1;
    }

    /// Current tick count since the netlist was installed or reset.
    pub fn tick(&self) -> u64 {
        self.tick
    }

    /// Number of circuit nodes including ground.
    pub fn node_count(&self) -> usize {
        self.node_count
    }

    /// Number of installed elements.
    pub fn element_count(&self) -> usize {
        self.elements.len()
    }

    /// The element at `index` in submission order. Panics if out of range; the
    /// front end indexes by the order it supplied to `set_netlist`.
    pub fn element_at(&self, index: usize) -> Element {
        self.elements[index]
    }

    /// Node voltages from the latest solve, length `node_count`. Index `0` is
    /// ground and is always exactly `0.0`.
    pub fn node_voltages(&self) -> Vec<f64> {
        self.node_v.clone()
    }

    /// Current through each element, in the **same order** as the installed
    /// netlist, with the sign defined `a -> b` (positive current flows from
    /// terminal `a` to terminal `b` inside the element). One entry per element.
    ///
    /// The committed currents are populated by every solve, so this is a pure,
    /// side-effect free function of the current snapshot and is consistent with
    /// [`Sim::node_voltages`] at the same tick (including `t = 0`). Per kind:
    ///
    /// - Resistor: `(V(a) - V(b)) / R`.
    /// - Capacitor: companion current `g*(V(a)-V(b)) - ieq` with `g = C/dt` and
    ///   `ieq = g * (V(a)-V(b))_prev` — i.e. `C * dV/dt` by backward-Euler. At
    ///   `t = 0` (discharged) this is `0`.
    /// - Inductor: its branch current; `0` at `t = 0` (de-energized).
    /// - Voltage source (DC or AC): its branch current.
    /// - Current source: its set `value` (forced, oriented `a -> b`).
    /// - Switch: `G(tick) * (V(a) - V(b))`, the tick-determined conductance times
    ///   the terminal voltage (large while closed, ~0 while open).
    pub fn element_currents(&self) -> Vec<f64> {
        self.currents.clone()
    }

    /// Read-only snapshot of the exposed state vector, for rendering and the
    /// wasm boundary. Returns the node voltages (length `node_count`, index `0`
    /// is ground at `0.0`). Variable length is expected by the front end's
    /// scope. Returning a copy never mutates the core.
    pub fn state(&self) -> Vec<f64> {
        self.node_v.clone()
    }

    /// Protocol version this core speaks.
    pub fn protocol_version(&self) -> u32 {
        PROTOCOL_VERSION
    }

    /// Stable hash of the full snapshot. Part of the replay contract. FNV-1a
    /// over the tick (little-endian) followed by each node voltage
    /// (little-endian `f64` bits), in fixed node order.
    pub fn snapshot_hash(&self) -> u64 {
        let mut bytes = Vec::with_capacity(8 + self.node_v.len() * 8);
        bytes.extend_from_slice(&self.tick.to_le_bytes());
        for v in &self.node_v {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        fnv1a(&bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a fresh `Sim`, install a netlist, and assert the install succeeded.
    fn build(node_count: usize, types: &[u8], a: &[u32], b: &[u32], values: &[f64]) -> Sim {
        let mut sim = Sim::new(1);
        assert!(
            sim.set_netlist(node_count, types, a, b, values),
            "valid netlist must install"
        );
        sim
    }

    /// The standard RC charge netlist used across several tests: node 0 = gnd,
    /// node 1 = source/R junction, node 2 = R/C junction. The capacitor is
    /// element index 2.
    fn rc_netlist(v: f64, r: f64, c: f64) -> Sim {
        build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_CAPACITOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[v, r, c],
        )
    }

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

    // --- Golden contract ------------------------------------------------------
    //
    // The committed golden pins a FIXED representative netlist so a deliberate
    // change to the dynamics is caught. The netlist is the demo RC charge built
    // by `Sim::new(GOLDEN_SEED)`:
    //
    //   node 0 = ground
    //   node 1 = source / resistor junction
    //   node 2 = resistor / capacitor junction
    //   E0: DC voltage source, a=1 b=0, value = seed-derived rail in [1,12] V
    //   E1: resistor,          a=1 b=2, value = 1 kohm
    //   E2: capacitor,         a=2 b=0, value = 1 uF
    //
    // Run GOLDEN_STEPS fixed steps (dt = 2 us) from GOLDEN_SEED and hash. The
    // capacitor node (node 2) charges along V * (1 - exp(-t/RC)).
    const GOLDEN_HASH: u64 = 0xeaac_3764_99e4_fa24;
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

    /// A resistive voltage divider's node voltage is exact (no dynamics): a 12 V
    /// source across two series resistors puts the midpoint at
    /// `Vmid = V * R2 / (R1 + R2)`.
    #[test]
    fn resistive_divider_is_exact() {
        // node 0 = gnd, node 1 = top (source +), node 2 = midpoint.
        // E0: Vsrc 1->0 = 12 V; E1: R1 1->2 = 1k; E2: R2 2->0 = 3k.
        let sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_RESISTOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[12.0, 1_000.0, 3_000.0],
        );
        let v = sim.node_voltages();
        assert!((v[0] - 0.0).abs() < 1e-12, "ground is 0");
        assert!((v[1] - 12.0).abs() < 1e-9, "top node equals the source");
        let expected = 12.0 * 3_000.0 / (1_000.0 + 3_000.0); // 9 V
        assert!(
            (v[2] - expected).abs() < 1e-9,
            "divider midpoint exact: got {}, want {}",
            v[2],
            expected
        );
    }

    /// Equal-resistor divider lands exactly on half the rail.
    #[test]
    fn equal_divider_is_half_rail() {
        let sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_RESISTOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[10.0, 2_200.0, 2_200.0],
        );
        let v = sim.node_voltages();
        assert!((v[2] - 5.0).abs() < 1e-9, "equal divider is half-rail");
    }

    /// Backward-Euler RC has a known closed form per step:
    ///   v_{k+1} = v_k + (V - v_k) * dt / (R*C + dt).
    /// The capacitor node must match it to tight tolerance, confirming the MNA
    /// assembly and the dense solve agree with the analytic companion model.
    #[test]
    fn rc_charge_matches_backward_euler_closed_form() {
        let r = 1_000.0;
        let c = 1.0e-6;
        let v = 5.0;
        let mut sim = rc_netlist(v, r, c);
        let alpha = DT / (r * c + DT);
        let mut expected = 0.0f64;
        for _ in 0..500 {
            sim.step();
            expected += (v - expected) * alpha;
            let cap = sim.node_voltages()[2];
            assert!(
                (cap - expected).abs() < 1e-9,
                "solver must track the backward-Euler RC closed form: got {}, want {}",
                cap,
                expected
            );
        }
    }

    /// The capacitor charges monotonically toward the rail and never overshoots.
    #[test]
    fn rc_charge_is_monotonic_and_bounded() {
        let v = 9.0;
        let mut sim = rc_netlist(v, 1_000.0, 1.0e-6);
        let mut prev = sim.node_voltages()[2];
        assert_eq!(prev, 0.0, "capacitor starts discharged");
        // ~30 ms = 30 RC of physical time, independent of DT (15000 * 2 us).
        for _ in 0..15000 {
            sim.step();
            let cur = sim.node_voltages()[2];
            assert!(cur >= prev - 1e-12, "monotonic non-decreasing charge");
            assert!(cur <= v + 1e-9, "never overshoots the rail");
            prev = cur;
        }
        assert!((v - prev) < 1e-3 * v, "settles to the rail after many tau");
    }

    /// Kirchhoff's current law: the signed `a -> b` currents incident on any
    /// non-ground node must sum to ~0. Uses a three-resistor chain off a source
    /// so internal nodes have multiple incident elements.
    #[test]
    fn kcl_holds_at_every_node() {
        let sim = build(
            4,
            // 0=gnd, 1=top, 2=mid, 3=lower-mid.
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_RESISTOR, ELEM_RESISTOR],
            &[1, 1, 2, 3],
            &[0, 2, 3, 0],
            &[12.0, 1_000.0, 2_000.0, 3_000.0],
        );
        let currents = sim.element_currents();
        // For each non-ground node, sum currents leaving via `a` (+) and
        // entering via `b` (-). Net must be ~0 (KCL).
        for node in 1..sim.node_count() {
            let mut net = 0.0;
            for (i, &current) in currents.iter().enumerate() {
                let e = sim.element_at(i);
                if e.a == node {
                    net += current; // current a->b leaves this node
                }
                if e.b == node {
                    net -= current; // current a->b enters this node
                }
            }
            assert!(net.abs() < 1e-9, "KCL at node {}: net {} != 0", node, net);
        }
    }

    /// An RL step is stable and the inductor current rises monotonically toward
    /// its DC limit `V/R`, never overshooting (first-order, backward-Euler).
    #[test]
    fn rl_step_is_stable_and_monotonic() {
        let v = 6.0;
        let r = 100.0;
        let l = 1.0e-3;
        // node 0 = gnd, 1 = source/R, 2 = R/L. Source -> R -> L -> gnd. The
        // inductor is element index 2; its current is a->b (into ground).
        let mut sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_INDUCTOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[v, r, l],
        );
        let i_limit = v / r;
        let mut prev = sim.element_currents()[2];
        assert!(prev.abs() < 1e-9, "inductor current starts at 0");
        for _ in 0..4000 {
            sim.step();
            let cur = sim.element_currents()[2];
            assert!(cur >= prev - 1e-12, "inductor current monotonic up");
            assert!(cur <= i_limit + 1e-9, "never overshoots the DC limit");
            assert!(cur.is_finite(), "stays finite (stable)");
            prev = cur;
        }
        assert!(
            (i_limit - prev) < 1e-3 * i_limit,
            "settles to V/R after many L/R"
        );
    }

    /// The element-current sign convention is `a -> b`: in a single-loop
    /// source/resistor circuit, flipping a resistor's terminals flips the sign
    /// of its reported current but not its magnitude.
    #[test]
    fn element_current_sign_is_a_to_b() {
        // Source 1->0 = 10 V, resistor 1->0 = 1k. Loop current is 10 mA.
        let forward = build(
            2,
            &[ELEM_VSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[10.0, 1_000.0],
        );
        // Same circuit but the resistor's terminals swapped (b->a).
        let reversed = build(
            2,
            &[ELEM_VSOURCE, ELEM_RESISTOR],
            &[1, 0],
            &[0, 1],
            &[10.0, 1_000.0],
        );
        let fwd = forward.element_currents()[1];
        let rev = reversed.element_currents()[1];
        assert!((fwd.abs() - 0.01).abs() < 1e-9, "10V/1k = 10mA magnitude");
        assert!((fwd + rev).abs() < 1e-12, "flipping a,b flips the sign");
    }

    /// `node_voltages` always reports ground (index 0) as exactly 0.0 and has
    /// length `node_count`; `element_currents` has one entry per element.
    #[test]
    fn ground_is_pinned_and_lengths_match() {
        let sim = rc_netlist(5.0, 1_000.0, 1.0e-6);
        let v = sim.node_voltages();
        assert_eq!(v.len(), 3, "length equals node_count");
        assert_eq!(v[0], 0.0, "ground is pinned to 0");
        assert_eq!(sim.element_currents().len(), 3, "one current per element");
    }

    /// `reset` returns to t = 0 with reactive elements discharged but keeps the
    /// netlist: re-running reproduces the same trajectory.
    #[test]
    fn reset_rewinds_to_t0_same_netlist() {
        let mut sim = rc_netlist(5.0, 1_000.0, 1.0e-6);
        let mut hashes_a = Vec::new();
        for _ in 0..200 {
            sim.step();
            hashes_a.push(sim.snapshot_hash());
        }
        assert_eq!(sim.tick(), 200);
        sim.reset();
        assert_eq!(sim.tick(), 0, "reset rewinds the tick");
        assert_eq!(sim.node_voltages()[2], 0.0, "capacitor discharged on reset");
        let mut hashes_b = Vec::new();
        for _ in 0..200 {
            sim.step();
            hashes_b.push(sim.snapshot_hash());
        }
        assert_eq!(hashes_a, hashes_b, "same netlist replays identically");
    }

    /// An invalid netlist fails safe: returns false and leaves a deterministic
    /// empty ground-only circuit, never panics. A later valid netlist installs.
    #[test]
    fn invalid_netlist_fails_safe() {
        let mut sim = Sim::new(3);
        // Mismatched array lengths.
        let ok = sim.set_netlist(2, &[ELEM_RESISTOR], &[1, 0], &[0], &[1_000.0]);
        assert!(!ok, "length mismatch must be rejected");
        assert_eq!(sim.node_voltages().len(), 1, "fell back to ground-only");
        assert_eq!(sim.element_currents().len(), 0, "no elements remain");
        // Out-of-range node.
        let ok2 = sim.set_netlist(2, &[ELEM_RESISTOR], &[5], &[0], &[1_000.0]);
        assert!(!ok2, "out-of-range node must be rejected");
        // Unknown element type.
        let ok3 = sim.set_netlist(2, &[99], &[1], &[0], &[1_000.0]);
        assert!(!ok3, "unknown element type must be rejected");
        // Zero node_count.
        let ok4 = sim.set_netlist(0, &[], &[], &[], &[]);
        assert!(!ok4, "zero node_count must be rejected");
        // A subsequent valid netlist still installs fine.
        let ok5 = sim.set_netlist(
            2,
            &[ELEM_VSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[5.0, 1_000.0],
        );
        assert!(ok5, "valid netlist installs after failures");
    }

    /// Two parallel resistors from a source split the current; the source must
    /// supply the sum (KCL at the driven node). Sanity-checks multi-element
    /// stamping and the source-current sign.
    #[test]
    fn parallel_resistors_split_current() {
        // node 0 = gnd, 1 = driven. Source 1->0 = 10V, two resistors 1->0.
        let sim = build(
            2,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_RESISTOR],
            &[1, 1, 1],
            &[0, 0, 0],
            &[10.0, 1_000.0, 1_000.0],
        );
        let c = sim.element_currents();
        // Each resistor carries 10 mA (a->b into ground).
        assert!((c[1] - 0.01).abs() < 1e-9);
        assert!((c[2] - 0.01).abs() < 1e-9);
        // The source current is a->b (node1->gnd). It sources 20 mA into node 1,
        // so -20 mA flows node1->gnd through the source branch.
        assert!((c[0] + 0.02).abs() < 1e-9, "source supplies 20 mA total");
    }

    /// An ideal current source forced through a single resistor to ground
    /// develops `I * R` across the resistor, with an exact sign set by the
    /// `a -> b` convention.
    ///
    /// **Sign convention (a -> b):** the source's KCL stamp is
    /// `rhs[a] -= value; rhs[b] += value`, so a positive `value` *pushes*
    /// conventional current **into node `b`** and *draws* it **out of node `a`**.
    /// The arrow points `a -> b`: current is delivered at the `b` terminal. To
    /// raise a node above ground, that node is the `b` terminal. Here the source
    /// is oriented `0 -> 1` (b = node 1), so it sources `value` into node 1; the
    /// resistor `1 -> 0` carries it to ground and node 1 settles at `+I*R`.
    #[test]
    fn current_source_drives_resistor_to_i_r() {
        let i = 2.0e-3; // 2 mA
        let r = 3_300.0; // 3.3 kohm
                         // node 0 = gnd, node 1 = driven. I src 0->1 (sources into node 1),
                         // R 1->0 (carries the current to ground).
        let sim = build(2, &[ELEM_ISOURCE, ELEM_RESISTOR], &[0, 1], &[1, 0], &[i, r]);
        let v = sim.node_voltages();
        let expected = i * r; // 6.6 V
        assert!(
            (v[1] - expected).abs() < 1e-9,
            "I*R across the resistor: got {}, want {}",
            v[1],
            expected
        );
        // The source reports its forced value (a -> b), and the resistor (1->0)
        // carries the same current a -> b, so both read +I.
        let c = sim.element_currents();
        assert!((c[0] - i).abs() < 1e-12, "source reports its set current");
        assert!((c[1] - i).abs() < 1e-9, "resistor carries the loop current");
    }

    /// KCL holds at every node for a current-source-driven circuit: the signed
    /// `a -> b` currents incident on any non-ground node sum to ~0. Uses a
    /// current source splitting between two parallel resistors so an internal
    /// node has several incident elements.
    #[test]
    fn current_source_kcl_holds_at_every_node() {
        // node 0 = gnd, 1 = driven. I src 0->1 = 5 mA into node 1, two
        // resistors 1->0 carry it to ground.
        let sim = build(
            2,
            &[ELEM_ISOURCE, ELEM_RESISTOR, ELEM_RESISTOR],
            &[0, 1, 1],
            &[1, 0, 0],
            &[5.0e-3, 1_000.0, 1_000.0],
        );
        let currents = sim.element_currents();
        for node in 1..sim.node_count() {
            let mut net = 0.0;
            for (idx, &current) in currents.iter().enumerate() {
                let e = sim.element_at(idx);
                if e.a == node {
                    net += current; // current a->b leaves this node
                }
                if e.b == node {
                    net -= current; // current a->b enters this node
                }
            }
            assert!(net.abs() < 1e-12, "KCL at node {}: net {} != 0", node, net);
        }
        // The 5 mA splits evenly across the equal resistors (each 1->0).
        assert!(
            (currents[1] - 2.5e-3).abs() < 1e-9,
            "first resistor takes half"
        );
        assert!(
            (currents[2] - 2.5e-3).abs() < 1e-9,
            "second resistor takes half"
        );
    }

    /// Flipping the current source's `a,b` terminals flips the sign of the node
    /// voltage it develops (the dual of the voltage-source sign test). Its own
    /// reported current is the forced `value` (a -> b) either way; flipping the
    /// terminals reverses which node the current is delivered to, and thus the
    /// developed voltage. Needs an explicit ground reference, which the current
    /// source itself does not provide — node 0 is ground here.
    #[test]
    fn current_source_flip_flips_sign() {
        let i = 1.5e-3;
        let r = 2_000.0;
        // Forward: I src 0->1 sources into node 1; R 1->0. Node 1 -> +I*R.
        // Arrays are [isrc, R]: a = [0, 1], b = [1, 0].
        let forward = build(2, &[ELEM_ISOURCE, ELEM_RESISTOR], &[0, 1], &[1, 0], &[i, r]);
        // Reversed source: I src 1->0 (terminals swapped) draws from node 1;
        // the resistor stays 1->0. a = [1, 1], b = [0, 0]. Node 1 -> -I*R.
        let reversed = build(2, &[ELEM_ISOURCE, ELEM_RESISTOR], &[1, 1], &[0, 0], &[i, r]);
        let vf = forward.node_voltages()[1];
        let vr = reversed.node_voltages()[1];
        assert!((vf - i * r).abs() < 1e-9, "forward develops +I*R");
        assert!(
            (vf + vr).abs() < 1e-12,
            "flipping the source a,b flips the developed node voltage"
        );
        // The source's reported current is the forced `value` a -> b in both
        // cases, so flipping its terminals flips the *reported* sign.
        let cf = forward.element_currents();
        let cr = reversed.element_currents();
        assert!(
            (cf[0] - i).abs() < 1e-12,
            "forward source current is +i (a->b)"
        );
        assert!(
            (cr[0] - i).abs() < 1e-12,
            "reversed source current is still +i (a->b)"
        );
        // The resistor it drives flips with the source.
        assert!(
            (cf[1] + cr[1]).abs() < 1e-9,
            "the driven resistor current flips with the source"
        );
    }

    /// A current source feeding a capacitor is the textbook constant-current
    /// ramp: `V(t) = (I/C) * t`. With backward-Euler and a forced current, each
    /// step adds exactly `I * dt / C`, so the capacitor node rises linearly.
    #[test]
    fn current_source_ramps_capacitor_linearly() {
        let i = 1.0e-3; // 1 mA
        let c = 1.0e-6; // 1 uF -> dV/step = I*dt/C = 1e-3 * 1e-5 / 1e-6 = 1e-2 V
                        // node 0 = gnd, 1 = driven. I src 0->1 sources into node 1, charging
                        // C 1->0 at constant current.
        let mut sim = build(
            2,
            &[ELEM_ISOURCE, ELEM_CAPACITOR],
            &[0, 1],
            &[1, 0],
            &[i, c],
        );
        assert_eq!(sim.node_voltages()[1], 0.0, "capacitor starts discharged");
        let step_dv = i * DT / c;
        for k in 1..=200 {
            sim.step();
            let expected = step_dv * (k as f64);
            let got = sim.node_voltages()[1];
            assert!(
                (got - expected).abs() < 1e-9,
                "constant-current ramp at step {}: got {}, want {}",
                k,
                got,
                expected
            );
        }
    }

    // --- Nonlinear: diode + Newton --------------------------------------------
    //
    // The Shockley diode (type 5) engages the deterministic Newton outer loop.
    // These tests assert the physical operating point (which only holds if the
    // loop actually converged within the cap) and the replay invariant.

    /// The implicit-function solution of a forward-biased diode in series with a
    /// resistor from a source: the loop current `i` satisfies
    /// `Vsrc = i*R + n*Vt*ln(i/Is + 1)`. Newton-solve it on the scalar equation
    /// to get an independent reference for the diode drop, so the core's result
    /// is checked against physics rather than a hand-tuned constant.
    fn series_diode_reference(vsrc: f64, r: f64) -> (f64, f64) {
        // Solve f(i) = i*R + n*Vt*ln(i/Is + 1) - Vsrc = 0 for i > 0.
        let vth = DIODE_N * DIODE_VT;
        let mut i = (vsrc / r).max(1e-9); // start from the ohmic guess
        for _ in 0..200 {
            let vd = vth * (i / DIODE_IS + 1.0).ln();
            let f = i * r + vd - vsrc;
            let dvd_di = vth / (i + DIODE_IS); // d/di of n*Vt*ln(i/Is+1)
            let df = r + dvd_di;
            i -= f / df;
            if i <= 0.0 {
                i = 1e-15;
            }
        }
        let vd = vth * (i / DIODE_IS + 1.0).ln();
        (i, vd)
    }

    /// A forward-biased diode in series with a resistor conducts and drops a
    /// junction voltage in the silicon "knee" band (~0.6–0.75 V at this drive
    /// level), matching the independent scalar reference. The drop is set by the
    /// current through the fixed `Is`; a few-tens-of-mA loop lands in the band.
    /// Layout: source 1->0, R 1->2, diode 2->0 (anode 2 -> cathode ground). The
    /// diode is element index 2.
    #[test]
    fn forward_diode_conducts_and_drops_knee_voltage() {
        let vsrc = 5.0;
        let r = 47.0; // ~90 mA loop -> ~0.65 V junction with Is = 1e-12
        let sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_DIODE],
            &[1, 1, 2],
            &[0, 2, 0],
            &[vsrc, r, 0.0], // diode value is unused
        );
        let (i_ref, vd_ref) = series_diode_reference(vsrc, r);
        let v = sim.node_voltages();
        // Junction voltage is V(node 2) (cathode is ground).
        assert!(
            (0.6..=0.75).contains(&v[2]),
            "forward diode sits in the knee band: got {}",
            v[2]
        );
        assert!(
            (v[2] - vd_ref).abs() < 1e-6,
            "diode drop matches the scalar reference: got {}, want {}",
            v[2],
            vd_ref
        );
        // The diode (element 2) carries the loop current a -> b (into ground).
        let c = sim.element_currents();
        assert!(c[2] > 0.0, "forward diode conducts (positive a->b current)");
        assert!(
            (c[2] - i_ref).abs() < 1e-9,
            "diode current matches the reference: got {}, want {}",
            c[2],
            i_ref
        );
        // KCL: the resistor and diode currents agree in the series loop.
        assert!(
            (c[1] - c[2]).abs() < 1e-9,
            "series loop: resistor and diode carry the same current"
        );
        // Everything stayed finite (Newton did not diverge).
        assert!(v.iter().all(|x| x.is_finite()), "node voltages finite");
    }

    /// A reverse-biased diode blocks: it carries only the tiny saturation
    /// leakage (about -Is), so essentially no current, and the series node sits
    /// near the source (almost no drop across the resistor). Layout: source
    /// 1->0, R 1->2, diode 0->2 (anode ground -> cathode node 2), so a positive
    /// rail reverse-biases it.
    #[test]
    fn reverse_diode_blocks() {
        let vsrc = 5.0;
        let r = 1_000.0;
        let sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_DIODE],
            &[1, 1, 0],
            &[0, 2, 2],
            &[vsrc, r, 0.0],
        );
        let c = sim.element_currents();
        // The diode current (a -> b) is about -Is in reverse: negligible.
        assert!(
            c[2].abs() < 1e-9,
            "reverse diode blocks (~ -Is, near zero): got {}",
            c[2]
        );
        // With almost no current, the resistor drop is tiny and node 2 ~ Vsrc.
        let v = sim.node_voltages();
        assert!(
            (v[2] - vsrc).abs() < 1e-3,
            "reverse-blocked node sits near the rail: got {}",
            v[2]
        );
    }

    /// A diode from a node to ground clamps that node near its forward voltage
    /// even when a strong current source tries to push it far higher: the diode
    /// shunts the excess. Layout: I src 0->1 forces current into node 1, diode
    /// 1->0 clamps it. Without the diode the node would run away; with it the
    /// node settles in the knee band.
    #[test]
    fn diode_clamps_node_near_forward_voltage() {
        let i = 100.0e-3; // 100 mA forced in -> ~0.66 V clamp with Is = 1e-12
        let sim = build(2, &[ELEM_ISOURCE, ELEM_DIODE], &[0, 1], &[1, 0], &[i, 0.0]);
        let v = sim.node_voltages();
        assert!(
            (0.6..=0.85).contains(&v[1]),
            "diode clamps the node into the forward band: got {}",
            v[1]
        );
        // The diode must sink essentially all of the forced current (KCL).
        let c = sim.element_currents();
        assert!(
            (c[1] - i).abs() < 1e-9,
            "diode sinks the forced current: got {}, want {}",
            c[1],
            i
        );
        // The clamp voltage matches Shockley inverted at this current:
        // vd = n*Vt*ln(i/Is + 1).
        let vd_expected = DIODE_N * DIODE_VT * (i / DIODE_IS + 1.0).ln();
        assert!(
            (v[1] - vd_expected).abs() < 1e-6,
            "clamp matches Shockley: got {}, want {}",
            v[1],
            vd_expected
        );
    }

    /// The Newton loop converges for a forward diode *within the iteration cap*:
    /// after one operating-point solve the residual of the nodal equation at the
    /// reported voltages is below tolerance. (If the loop had merely hit the cap
    /// and bailed, the residual would be large.) This checks convergence
    /// directly rather than via a downstream value.
    #[test]
    fn newton_converges_within_cap_for_diode() {
        let vsrc = 3.3;
        let r = 470.0;
        // source 1->0, R 1->2, diode 2->0.
        let sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_DIODE],
            &[1, 1, 2],
            &[0, 2, 0],
            &[vsrc, r, 0.0],
        );
        let v = sim.node_voltages();
        // KCL residual at node 2 (the diode/resistor junction): current in from
        // the resistor must equal the diode current out, to tight tolerance.
        let vth = DIODE_N * DIODE_VT;
        let i_diode = DIODE_IS * ((v[2] / vth).exp() - 1.0);
        let i_res = (v[1] - v[2]) / r;
        assert!(
            (i_res - i_diode).abs() < 1e-9,
            "converged: KCL residual at the junction is ~0 (i_res {} vs i_diode {})",
            i_res,
            i_diode
        );
    }

    /// Replay invariant for a nonlinear (diode) circuit: the Newton loop is
    /// deterministic, so a fixed netlist stepped a fixed number of times
    /// reproduces its snapshot-hash stream exactly. This is the diode analogue of
    /// `run_is_reproducible` and guards the nonlinear path against any
    /// nondeterminism (hashed iteration, unstable reductions, iteration-count
    /// drift).
    #[test]
    fn diode_run_is_reproducible() {
        let run = || {
            // A rectifier-ish RC load: source 1->0, R 1->2, diode 2->3,
            // C 3->0. The diode steers charge onto the capacitor; the Newton
            // loop runs inside every step.
            let mut sim = build(
                4,
                &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_DIODE, ELEM_CAPACITOR],
                &[1, 1, 2, 3],
                &[0, 2, 3, 0],
                &[5.0, 1_000.0, 0.0, 1.0e-6],
            );
            let mut acc = sim.snapshot_hash();
            for _ in 0..1000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "diode circuit must reproduce exactly");
    }

    /// `set_netlist` accepts the diode element type (type 5) and marks the
    /// netlist nonlinear; a malformed netlist that happens to contain a diode
    /// still fails safe through the same validation as any other element.
    #[test]
    fn diode_netlist_validates() {
        let mut sim = Sim::new(1);
        // A bare diode across a source installs fine.
        let ok = sim.set_netlist(
            2,
            &[ELEM_VSOURCE, ELEM_DIODE],
            &[1, 1],
            &[0, 0],
            &[5.0, 0.0],
        );
        assert!(ok, "valid diode netlist installs");
        assert_eq!(sim.element_count(), 2);
        assert_eq!(sim.element_at(1).kind, ELEM_DIODE, "diode stored as type 5");
        // Out-of-range node on a diode is still rejected (fail-safe).
        let bad = sim.set_netlist(2, &[ELEM_DIODE], &[9], &[0], &[0.0]);
        assert!(!bad, "out-of-range diode node rejected");
        assert_eq!(sim.node_voltages().len(), 1, "fell back to ground-only");
    }

    /// A back-to-back source steps across a diode: forward then a forward diode
    /// in a divider still settles to a finite, monotone-consistent operating
    /// point and never produces NaN/Inf, exercising the gmin floor and limiting
    /// on a node that is only weakly driven.
    #[test]
    fn diode_in_divider_is_finite_and_clamped() {
        // source 1->0 = 5V, R1 1->2 = 1k, R2 2->0 = 1k (divider midpoint 2.5V),
        // diode 2->0 in parallel with R2 clamps the midpoint to the knee.
        let sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_RESISTOR, ELEM_DIODE],
            &[1, 1, 2, 2],
            &[0, 2, 0, 0],
            &[5.0, 1_000.0, 1_000.0, 0.0],
        );
        let v = sim.node_voltages();
        assert!(v.iter().all(|x| x.is_finite()), "finite operating point");
        // The diode pulls the otherwise-2.5V midpoint down into the knee band.
        assert!(
            v[2] < 0.8 && v[2] > 0.5,
            "diode clamps the divider midpoint into the knee: got {}",
            v[2]
        );
    }

    // --- Clock-driven switch (PWM) --------------------------------------------
    //
    // The switch (type 6) is a time-varying linear conductance: a pure
    // deterministic function of the tick with period `SWITCH_PERIOD_TICKS`,
    // closed for `round(duty * period)` ticks per period and open otherwise. It
    // stamps like a resistor, needs no Newton machinery, and underpins the buck
    // converter demo.

    /// A switch in series with a pull-down resistor from a DC source produces a
    /// clean PWM node: while the switch is closed (Ron tiny) the mid node sits at
    /// ~Vin, and while it is open (Goff tiny) the pull-down holds it at ~0. Over a
    /// full period the high/low counts and levels must match the duty exactly.
    /// Layout: source 1->0 = Vin, switch 1->2 (a=1,b=2), R 2->0 pulls node 2 down.
    /// The circuit is purely resistive, so each step's node 2 is a pure function
    /// of that tick's switch state (no settling).
    #[test]
    fn switch_chops_rail_with_period_and_duty() {
        let vin = 10.0;
        let duty = 0.5; // on_ticks = round(0.5 * 50) = 25
        let sim_period = SWITCH_PERIOD_TICKS as usize;
        let mut sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_SWITCH, ELEM_RESISTOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[vin, duty, 1_000.0],
        );
        let mut high = 0usize;
        let mut low = 0usize;
        // Step across exactly one period; reading node 2 after step k reflects the
        // solve at tick k-1, so the 50 reads cover ticks 0..49 of the period.
        for _ in 0..sim_period {
            sim.step();
            let v2 = sim.node_voltages()[2];
            if (v2 - vin).abs() < 1e-2 {
                high += 1;
            } else if v2.abs() < 1e-3 {
                low += 1;
            } else {
                panic!("switch node neither high nor low: {}", v2);
            }
        }
        let on_ticks = (duty * SWITCH_PERIOD_TICKS as f64).round() as usize;
        assert_eq!(high, on_ticks, "closed ticks per period match the duty");
        assert_eq!(
            low,
            sim_period - on_ticks,
            "open ticks per period match the duty"
        );
        // A second period reproduces the same pattern (the state is periodic in
        // the tick), confirming the period really is SWITCH_PERIOD_TICKS.
        let mut high2 = 0usize;
        for _ in 0..sim_period {
            sim.step();
            if (sim.node_voltages()[2] - vin).abs() < 1e-2 {
                high2 += 1;
            }
        }
        assert_eq!(high2, on_ticks, "the switch pattern repeats every period");
    }

    /// Duty 0 holds the switch open for the whole period (node never goes high)
    /// and duty 1 holds it closed (node never goes low) — the clamped extremes.
    #[test]
    fn switch_duty_extremes_are_fully_open_or_closed() {
        let vin = 8.0;
        let period = SWITCH_PERIOD_TICKS as usize;
        // Duty 0: always open -> node 2 pinned near 0 by the pull-down.
        let mut off = build(
            3,
            &[ELEM_VSOURCE, ELEM_SWITCH, ELEM_RESISTOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[vin, 0.0, 1_000.0],
        );
        for _ in 0..period {
            off.step();
            assert!(
                off.node_voltages()[2].abs() < 1e-3,
                "duty 0 switch stays open"
            );
        }
        // Duty 1: always closed -> node 2 pinned near Vin.
        let mut on = build(
            3,
            &[ELEM_VSOURCE, ELEM_SWITCH, ELEM_RESISTOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[vin, 1.0, 1_000.0],
        );
        for _ in 0..period {
            on.step();
            assert!(
                (on.node_voltages()[2] - vin).abs() < 1e-2,
                "duty 1 switch stays closed"
            );
        }
    }

    /// Through an RC low-pass, a PWM switch output averages to ~duty * Vin after
    /// settling. Layout: source 1->0 = Vin, switch 1->2, R_load 2->0 (makes node 2
    /// a clean rail-to-rail square wave), then a high-impedance R 2->3 + C 3->0
    /// filter whose corner is far below the 10 kHz switching rate. The filtered
    /// node 3, averaged over a full period to cancel residual ripple, lands on
    /// duty * Vin.
    #[test]
    fn switch_through_rc_averages_to_duty_times_vin() {
        let vin = 10.0;
        let duty = 0.4; // target node 3 ~ 4.0 V
        let mut sim = build(
            4,
            &[
                ELEM_VSOURCE,
                ELEM_SWITCH,
                ELEM_RESISTOR,  // R_load 2->0 (pull-down for a clean square wave)
                ELEM_RESISTOR,  // R_filter 2->3
                ELEM_CAPACITOR, // C 3->0
            ],
            &[1, 1, 2, 2, 3],
            &[0, 2, 0, 3, 0],
            // R_filter (100k) >> R_load (1k) so the filter does not load node 2;
            // R_filter*C = 2.2 ms >> period (100 us) so ripple is small.
            &[vin, duty, 1_000.0, 100_000.0, 22.0e-9],
        );
        // Settle for many filter time constants (2.2 ms each; 20000 * 2 us = 40 ms
        // ~ 18 tau).
        for _ in 0..20_000 {
            sim.step();
        }
        // Average node 3 over one full period to cancel switching ripple.
        let period = SWITCH_PERIOD_TICKS as usize;
        let mut acc = 0.0f64;
        for _ in 0..period {
            sim.step();
            acc += sim.node_voltages()[3];
        }
        let mean = acc / period as f64;
        let expected = duty * vin; // 4.0 V
        assert!(
            (mean - expected).abs() < 0.1,
            "RC-filtered switch output averages to duty*Vin: got {}, want {}",
            mean,
            expected
        );
    }

    /// Replay invariant for a switched circuit: the switch state is a pure
    /// deterministic function of the tick, so a fixed netlist stepped a fixed
    /// number of times reproduces its snapshot-hash stream exactly. This is the
    /// switch analogue of `run_is_reproducible`.
    #[test]
    fn switch_run_is_reproducible() {
        let run = || {
            // source 1->0, switch 1->2, R_load 2->0, R 2->3, C 3->0 (the RC
            // low-pass exercised above).
            let mut sim = build(
                4,
                &[
                    ELEM_VSOURCE,
                    ELEM_SWITCH,
                    ELEM_RESISTOR,
                    ELEM_RESISTOR,
                    ELEM_CAPACITOR,
                ],
                &[1, 1, 2, 2, 3],
                &[0, 2, 0, 3, 0],
                &[10.0, 0.4, 1_000.0, 100_000.0, 22.0e-9],
            );
            let mut acc = sim.snapshot_hash();
            for _ in 0..2000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "switched circuit must reproduce exactly");
    }

    /// The switch composes with the diode + inductor + capacitor of a buck
    /// converter without diverging: a switch chopping a rail into an L, a
    /// freewheel diode, and an output cap settles to a finite output below the
    /// input (a step-down). This exercises the switch sitting in the fixed linear
    /// base while the diode drives the Newton loop, in one netlist.
    #[test]
    fn switch_buck_converter_steps_down_and_is_finite() {
        let vin = 12.0;
        let duty = 0.5;
        // Nodes: 0=gnd, 1=Vin, 2=switch node (L input / diode cathode), 3=output.
        // source 1->0; switch 1->2; freewheel diode 0->2 (anode gnd -> cathode
        // node 2, conducts when node 2 swings below ground as L freewheels);
        // L 2->3; C 3->0; R_load 3->0.
        let mut sim = build(
            4,
            &[
                ELEM_VSOURCE,
                ELEM_SWITCH,
                ELEM_DIODE,
                ELEM_INDUCTOR,
                ELEM_CAPACITOR,
                ELEM_RESISTOR,
            ],
            &[1, 1, 0, 2, 3, 3],
            &[0, 2, 2, 3, 0, 0],
            &[vin, duty, 0.0, 100.0e-6, 47.0e-6, 50.0],
        );
        // Run well past the LC settling time.
        for _ in 0..40_000 {
            sim.step();
        }
        let v = sim.node_voltages();
        assert!(v.iter().all(|x| x.is_finite()), "buck stays finite");
        let vout = v[3];
        // A real (lossy, diode-drop) buck steps the rail down: 0 < Vout < Vin.
        assert!(
            vout > 0.5 && vout < vin,
            "buck output is a stepped-down rail: got {} (Vin {})",
            vout,
            vin
        );
    }

    /// `set_netlist` accepts the switch element type (type 6); a malformed netlist
    /// containing a switch still fails safe through the same validation.
    #[test]
    fn switch_netlist_validates() {
        let mut sim = Sim::new(1);
        let ok = sim.set_netlist(
            3,
            &[ELEM_VSOURCE, ELEM_SWITCH, ELEM_RESISTOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[5.0, 0.5, 1_000.0],
        );
        assert!(ok, "valid switch netlist installs");
        assert_eq!(sim.element_count(), 3);
        assert_eq!(
            sim.element_at(1).kind,
            ELEM_SWITCH,
            "switch stored as type 6"
        );
        // Out-of-range node on a switch is still rejected (fail-safe).
        let bad = sim.set_netlist(2, &[ELEM_SWITCH], &[9], &[0], &[0.5]);
        assert!(!bad, "out-of-range switch node rejected");
        assert_eq!(sim.node_voltages().len(), 1, "fell back to ground-only");
    }

    // --- Sinusoidal AC voltage source -----------------------------------------
    //
    // The AC source (type 7) is a voltage constraint exactly like the DC source
    // (type 0); its only difference is a tick-determined sine EMF,
    // `AC_AMPLITUDE * sin(2*pi*f*tick*dt)`. Being linear and time-varying it is
    // part of the fixed linear base (no Newton). These tests assert the node
    // tracks the independent scalar sine, the peaks and RMS over a full period,
    // composition with a diode rectifier, and the replay invariant.

    /// The expected AC source EMF at a given tick, computed independently of the
    /// solver from the same closed form, so the core is checked against physics
    /// rather than a fitted constant.
    fn ac_emf_at_tick(f: f64, tick: u64) -> f64 {
        AC_AMPLITUDE * (core::f64::consts::TAU * f * (tick as f64) * DT).sin()
    }

    /// An AC source straight across a resistor puts the full source EMF on the
    /// driven node (no divider), so the node voltage must track
    /// `AC_AMPLITUDE * sin(2*pi*f*t)` tick by tick. Sample several ticks across one
    /// period and compare against the independent scalar sine. Layout: AC source
    /// 1->0 (value = f), resistor 1->0. Node 1 carries the source EMF directly.
    #[test]
    fn ac_source_node_tracks_sine_across_resistor() {
        let f = 1_000.0; // 1 kHz -> period = 1/f = 1 ms = 500 ticks at dt = 2 us.
        let mut sim = build(
            2,
            &[ELEM_ACSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[f, 1_000.0],
        );
        // At t = 0 the sine is exactly 0.
        assert!(
            sim.node_voltages()[1].abs() < 1e-12,
            "AC source is 0 V at tick 0: got {}",
            sim.node_voltages()[1]
        );
        // `step` solves at the pre-increment tick and then advances, so after the
        // k-th step `node_v` reflects the solve at tick k-1 (i.e. `sim.tick()-1`).
        // Step across one full period of distinct phases and compare each reading
        // against the scalar sine at the tick that produced it.
        let period_ticks = (1.0 / (f * DT)).round() as u64; // 500
        for _ in 0..period_ticks {
            sim.step();
            let solved_tick = sim.tick() - 1;
            let got = sim.node_voltages()[1];
            let want = ac_emf_at_tick(f, solved_tick);
            assert!(
                (got - want).abs() < 1e-9,
                "node tracks the scalar sine at tick {}: got {}, want {}",
                solved_tick,
                got,
                want
            );
        }
    }

    /// Across one period the AC node reaches both peaks near +/- AC_AMPLITUDE and
    /// its RMS over a whole period is AC_AMPLITUDE / sqrt(2) (the textbook sine
    /// RMS). Computed numerically over every tick of one period.
    #[test]
    fn ac_source_peaks_and_rms_over_a_period() {
        let f = 500.0; // period = 1/f = 2 ms = 1000 ticks at dt = 2 us.
        let mut sim = build(
            2,
            &[ELEM_ACSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[f, 1_000.0],
        );
        let period_ticks = (1.0 / (f * DT)).round() as u64; // 1000
        let mut vmax = f64::NEG_INFINITY;
        let mut vmin = f64::INFINITY;
        let mut sumsq = 0.0f64;
        for _ in 0..period_ticks {
            sim.step();
            let v = sim.node_voltages()[1];
            vmax = vmax.max(v);
            vmin = vmin.min(v);
            sumsq += v * v;
        }
        // Peaks: the sample grid does not land exactly on the crest, but with 1000
        // ticks per period it gets very close to +/- AC_AMPLITUDE.
        assert!(
            (vmax - AC_AMPLITUDE).abs() < 1e-2,
            "positive peak near +AC_AMPLITUDE: got {}",
            vmax
        );
        assert!(
            (vmin + AC_AMPLITUDE).abs() < 1e-2,
            "negative peak near -AC_AMPLITUDE: got {}",
            vmin
        );
        // RMS over a whole period is AC_AMPLITUDE / sqrt(2).
        let rms = (sumsq / period_ticks as f64).sqrt();
        let expected = AC_AMPLITUDE / core::f64::consts::SQRT_2;
        assert!(
            (rms - expected).abs() < 1e-3,
            "RMS over a full period is amplitude/sqrt(2): got {}, want {}",
            rms,
            expected
        );
    }

    /// The AC source frequency clamps to >= 0: a negative `value` is treated as
    /// 0 Hz, i.e. a flat 0 V source (sin(0) = 0), so the driven node stays at 0.
    #[test]
    fn ac_source_clamps_negative_frequency_to_dc_zero() {
        let mut sim = build(
            2,
            &[ELEM_ACSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[-1_000.0, 1_000.0],
        );
        for _ in 0..200 {
            sim.step();
            assert!(
                sim.node_voltages()[1].abs() < 1e-12,
                "negative frequency clamps to a flat 0 V source: got {}",
                sim.node_voltages()[1]
            );
        }
    }

    /// The AC source reports its branch current like a DC source, and KCL holds:
    /// across a single resistor the source current equals the resistor current
    /// (oriented a -> b) every tick.
    #[test]
    fn ac_source_branch_current_satisfies_kcl() {
        let f = 1_000.0;
        let r = 470.0;
        let mut sim = build(
            2,
            &[ELEM_ACSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[f, r],
        );
        for _ in 0..600 {
            sim.step();
            let c = sim.element_currents();
            let v1 = sim.node_voltages()[1];
            // Resistor (1->0) carries v1 / r; node 1 KCL: source a->b leaves node 1
            // and resistor a->b leaves node 1, so they must be equal and opposite.
            assert!(
                (c[1] - v1 / r).abs() < 1e-9,
                "resistor current is V/R: got {}, want {}",
                c[1],
                v1 / r
            );
            assert!(
                (c[0] + c[1]).abs() < 1e-9,
                "KCL at node 1: source and resistor branch currents balance"
            );
        }
    }

    /// An AC source through a series resistor into a diode + capacitor is a
    /// half-wave rectifier: the diode forces the Newton path while the AC source
    /// sits in the fixed linear base. It must converge (stay finite) and the
    /// output capacitor must charge to a positive DC level (rectification), well
    /// below the peak. Layout: AC 1->0, R 1->2, diode 2->3, C 3->0, R_load 3->0.
    #[test]
    fn ac_source_with_diode_rectifies_and_converges() {
        let f = 1_000.0;
        let mut sim = build(
            4,
            &[
                ELEM_ACSOURCE,
                ELEM_RESISTOR,
                ELEM_DIODE,
                ELEM_CAPACITOR,
                ELEM_RESISTOR,
            ],
            &[1, 1, 2, 3, 3],
            &[0, 2, 3, 0, 0],
            &[f, 100.0, 0.0, 10.0e-6, 10_000.0],
        );
        // Run many periods so the output settles.
        for _ in 0..10_000 {
            sim.step();
            assert!(
                sim.node_voltages().iter().all(|x| x.is_finite()),
                "rectifier stays finite (Newton converges with an AC source)"
            );
        }
        let vout = sim.node_voltages()[3];
        // Half-wave rectified output is a positive DC level, below the peak and
        // above ground (the diode drop and load bleed keep it well under +5 V).
        assert!(
            vout > 0.1 && vout < AC_AMPLITUDE,
            "rectified output is a positive DC level below the peak: got {}",
            vout
        );
    }

    /// Replay invariant for an AC circuit: the EMF is a pure deterministic
    /// function of the tick, so a fixed netlist stepped a fixed number of times
    /// reproduces its snapshot-hash stream exactly. The AC analogue of
    /// `run_is_reproducible`; covers both the linear fast path and (with the
    /// diode) the Newton path.
    #[test]
    fn ac_run_is_reproducible() {
        let run = || {
            // AC 1->0 -> R 1->2 -> diode 2->3 -> C 3->0 + R_load 3->0: the AC
            // source on the linear base, the diode on the Newton loop.
            let mut sim = build(
                4,
                &[
                    ELEM_ACSOURCE,
                    ELEM_RESISTOR,
                    ELEM_DIODE,
                    ELEM_CAPACITOR,
                    ELEM_RESISTOR,
                ],
                &[1, 1, 2, 3, 3],
                &[0, 2, 3, 0, 0],
                &[1_000.0, 100.0, 0.0, 10.0e-6, 10_000.0],
            );
            let mut acc = sim.snapshot_hash();
            for _ in 0..2000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "AC circuit must reproduce exactly");
    }

    /// `set_netlist` accepts the AC source element type (type 7); a malformed
    /// netlist containing an AC source still fails safe through the same
    /// validation, and a valid AC source is stored as type 7.
    #[test]
    fn ac_source_netlist_validates() {
        let mut sim = Sim::new(1);
        let ok = sim.set_netlist(
            2,
            &[ELEM_ACSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[1_000.0, 1_000.0],
        );
        assert!(ok, "valid AC source netlist installs");
        assert_eq!(sim.element_count(), 2);
        assert_eq!(
            sim.element_at(0).kind,
            ELEM_ACSOURCE,
            "AC source stored as type 7"
        );
        // Out-of-range node on an AC source is still rejected (fail-safe).
        let bad = sim.set_netlist(2, &[ELEM_ACSOURCE], &[9], &[0], &[1_000.0]);
        assert!(!bad, "out-of-range AC source node rejected");
        assert_eq!(sim.node_voltages().len(), 1, "fell back to ground-only");
    }

    /// `new` installs a working demo so the app shows life before user input:
    /// the demo capacitor (node 2) charges away from 0 over a few ticks.
    #[test]
    fn new_installs_living_demo() {
        let mut sim = Sim::new(7);
        assert_eq!(sim.node_voltages().len(), 3, "demo RC has 3 nodes");
        assert_eq!(sim.element_count(), 3, "demo RC has 3 elements");
        let before = sim.node_voltages()[2];
        for _ in 0..50 {
            sim.step();
        }
        assert!(
            sim.node_voltages()[2] > before,
            "demo capacitor charges, so the app shows life"
        );
    }
}

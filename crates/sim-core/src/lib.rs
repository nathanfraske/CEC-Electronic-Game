// SPDX-License-Identifier: Apache-2.0
//! Deterministic, fixed-step analog simulation core.
//!
//! A small but real continuous-time analog solver. It integrates an **arbitrary
//! netlist of ideal elements** every fixed step using **implicit
//! (backward-Euler) companion models** assembled by **Modified Nodal Analysis
//! (MNA)** and solved with a dense Gaussian elimination with partial pivoting.
//! Per-tick cost is fixed for a given netlist: the system size is fixed once the
//! netlist is installed and the solve is a single non-iterative pass, so there
//! is no data-dependent work.
//!
//! ## Element set (ideal only)
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
//! ascending element index, so assembly and solve order are fully fixed.
//!
//! ## Companion models (backward-Euler, step `dt`)
//!
//! - **Capacitor** `C` between `a,b`: equivalent conductance `g = C/dt` in
//!   parallel with a history current source `ieq = g * (V(a)-V(b))_prev`. The
//!   element current (`a -> b`) is `g*(V(a)-V(b)) - ieq`.
//! - **Inductor** `L` between `a,b`: a branch-current unknown `i` (oriented
//!   `a -> b`) with branch equation `V(a)-V(b) - (L/dt)*i = -(L/dt)*i_prev`.
//!
//! ## Determinism
//!
//! Dynamically-sized but fixed-per-netlist dense MNA (Vec-backed), fixed
//! assembly and solve order, pure `f64` arithmetic, no hashed-collection
//! iteration, and no nondeterministic float reductions. The snapshot hash is
//! FNV-1a over the tick and node voltages (little-endian, fixed order), never
//! the std default hasher. See `docs/determinism.md`.

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

/// Deterministic fixed-step analog simulation of an arbitrary ideal netlist.
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
    /// current per voltage source plus one per inductor.
    dim: usize,
    /// For each element index, the column/row of its branch-current unknown in
    /// the MNA system, or `usize::MAX` if the element has no branch unknown
    /// (resistors and capacitors).
    branch_index: Vec<usize>,

    /// Latest solved node voltages, length `node_count`, index `0` always `0.0`.
    node_v: Vec<f64>,
    /// Dynamic state carried between steps: for a capacitor (`ELEM_CAPACITOR`),
    /// the previous `V(a) - V(b)`; for an inductor (`ELEM_INDUCTOR`), the
    /// previous branch current `i` (oriented `a -> b`). Unused for other kinds.
    /// One entry per element, indexed in lockstep with `elements`.
    reactive_state: Vec<f64>,
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
            node_v: vec![0.0],
            reactive_state: Vec::new(),
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
                ELEM_VSOURCE | ELEM_RESISTOR | ELEM_CAPACITOR | ELEM_INDUCTOR | ELEM_ISOURCE
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
            if e.kind == ELEM_VSOURCE || e.kind == ELEM_INDUCTOR {
                branch_index[i] = next;
                next += 1;
            }
        }

        self.node_count = node_count;
        self.dim = next;
        self.branch_index = branch_index;
        self.reactive_state = vec![0.0; elements.len()];
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
        let node_unknowns = self.node_count - 1;

        // Capacitors and voltage sources each need a branch-current unknown in
        // the operating-point system; inductors become current sources (no
        // unknown). Index them in ascending element order for a fixed layout.
        let mut op_branch = vec![usize::MAX; self.elements.len()];
        let mut next = node_unknowns;
        for (i, e) in self.elements.iter().enumerate() {
            if e.kind == ELEM_VSOURCE || e.kind == ELEM_CAPACITOR {
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
                ELEM_VSOURCE | ELEM_CAPACITOR => {
                    // Voltage constraint V(a) - V(b) = value, where `value` is
                    // the source EMF or the capacitor's stored voltage.
                    let bi = op_branch[i];
                    let v = if e.kind == ELEM_VSOURCE {
                        e.value
                    } else {
                        self.reactive_state[i]
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
        // inductors carry their stored initial current; resistors derive from
        // the node voltages.
        for (i, e) in self.elements.iter().enumerate() {
            self.currents[i] = match e.kind {
                ELEM_RESISTOR => {
                    if e.value <= 0.0 {
                        0.0
                    } else {
                        self.element_voltage(e) / e.value
                    }
                }
                ELEM_VSOURCE | ELEM_CAPACITOR => x[op_branch[i]],
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
                ELEM_CAPACITOR => {
                    let g = e.value / DT;
                    let ieq = g * self.reactive_state[i];
                    g * self.element_voltage(e) - ieq
                }
                ELEM_VSOURCE | ELEM_INDUCTOR => x[self.branch_index[i]],
                ELEM_ISOURCE => e.value,
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
    /// - Voltage source: its branch current.
    /// - Current source: its set `value` (forced, oriented `a -> b`).
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

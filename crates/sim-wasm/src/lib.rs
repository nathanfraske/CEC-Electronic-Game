// SPDX-License-Identifier: Apache-2.0
//! WebAssembly bindings. Keep this layer thin: it wraps sim-core and moves
//! values across the boundary. The front end calls `step` once per frame and
//! reads a snapshot, never per component.

use sim_core::Sim;
use wasm_bindgen::prelude::*;

/// A deterministic analog simulation of an arbitrary ideal netlist, exposed to
/// JavaScript. Construct it once, install a netlist with [`Simulation::set_netlist`],
/// then `step` it once per frame and read a batched snapshot.
#[wasm_bindgen]
pub struct Simulation {
    inner: Sim,
}

#[wasm_bindgen]
impl Simulation {
    /// Create a simulation pre-loaded with a small demo netlist (the classic RC
    /// charge) so the app shows life before the user builds anything.
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> Simulation {
        Simulation {
            inner: Sim::new(seed as u64),
        }
    }

    /// Replace the circuit with a netlist of ideal elements and reset to `t = 0`.
    ///
    /// The six arrays are parallel — one entry per element, in the order the
    /// front end will index currents back from [`Simulation::element_currents`]:
    ///
    /// - `types[i]` — element type: `0` = DC voltage source (value = volts),
    ///   `1` = resistor (ohms), `2` = capacitor (farads), `3` = inductor
    ///   (henries), … `7` = AC source (value = frequency Hz), … `11` = NMOS,
    ///   `12` = PMOS.
    /// - `a[i]`, `b[i]` — the two main terminal node indices (drain/source for a
    ///   MOSFET). Node `0` is ground (the reference, fixed at 0 V).
    /// - `c[i]` — the **control** terminal node index (the gate of a MOSFET, the
    ///   second input of a logic gate). Ignored for elements that don't use it; pass
    ///   `0` there.
    /// - `d[i]` — the **fourth** terminal node index (a transformer's second
    ///   secondary node; terminals are a/b = primary +/− and c/d = secondary +/−).
    ///   Ignored for elements with three or fewer terminals; pass `0` there.
    /// - `values[i]` — the element value in the units implied by `types[i]`.
    /// - `aux[i]` — the **second per-element scalar**: an AC source's peak
    ///   amplitude in volts (`0.0` selects the default 5 V) or a logic gate's
    ///   function code, and ignored — pass `0.0` — by every other element.
    ///
    /// `node_count` is the total number of nodes including ground. Returns
    /// `true` on success. On any length mismatch, an out-of-range node (`a`, `b`,
    /// `c`, or `d`), a zero `node_count`, or an unknown element type it fails safe
    /// (installs an empty ground-only circuit) and returns `false` — it never
    /// throws.
    // Arity mirrors the core: one parallel array per per-element field plus the
    // node count — the boundary's wire format, so the lint is allowed here too.
    #[allow(clippy::too_many_arguments)]
    pub fn set_netlist(
        &mut self,
        node_count: usize,
        types: &[u8],
        a: &[u32],
        b: &[u32],
        c: &[u32],
        d: &[u32],
        values: &[f64],
        aux: &[f64],
    ) -> bool {
        self.inner
            .set_netlist(node_count, types, a, b, c, d, values, aux)
    }

    /// Reset to `t = 0` with reactive elements discharged, keeping the same
    /// netlist.
    pub fn reset(&mut self) {
        self.inner.reset();
    }

    /// Advance one fixed tick.
    pub fn step(&mut self) {
        self.inner.step();
    }

    /// Current tick count.
    pub fn tick(&self) -> u64 {
        self.inner.tick()
    }

    /// Batched state snapshot for the renderer, as a `Float64Array`. Read once
    /// per frame and handed to PixiJS, never queried per component.
    ///
    /// The vector is the node voltages in volts (length `node_count`); index `0`
    /// is ground and is always `0.0`. Variable length is expected by the scope.
    pub fn state(&self) -> Vec<f64> {
        self.inner.state()
    }

    /// Node voltages in volts, length `node_count`; index `0` (ground) is `0.0`.
    /// Same data as [`Simulation::state`], named for measurement readouts.
    pub fn node_voltages(&self) -> Vec<f64> {
        self.inner.node_voltages()
    }

    /// Current through each element in amperes, in the **same order** as
    /// [`Simulation::set_netlist`], signed `a -> b` (positive flows from terminal
    /// `a` to terminal `b`). One entry per element; the front end maps these back
    /// to components by index.
    pub fn element_currents(&self) -> Vec<f64> {
        self.inner.element_currents()
    }

    /// Protocol version, checked by the front end on load.
    pub fn protocol_version(&self) -> u32 {
        self.inner.protocol_version()
    }

    /// Stable snapshot hash, useful for replay checks from the front end.
    pub fn snapshot_hash(&self) -> u64 {
        self.inner.snapshot_hash()
    }

    /// Whether the most recent step produced a non-physical **FAIL** — an ideal part
    /// driven past what physics allows (no series impedance: an ideal source into a
    /// short, an ideal diode charging a cap with nothing to limit it). The renderer
    /// surfaces this as the whole-sim FAIL state and freezes the run.
    pub fn failed(&self) -> bool {
        self.inner.failed()
    }

    /// Per-element FAIL mask, in the **same order** as [`Simulation::element_currents`]:
    /// `1` for each element whose reading hit the FAIL bound this step, `0` otherwise.
    /// The front end maps these back to components by index to box the offending parts.
    pub fn failed_element_mask(&self) -> Vec<u8> {
        self.inner.failed_element_mask()
    }
}

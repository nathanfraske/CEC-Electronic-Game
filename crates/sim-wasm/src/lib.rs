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

    /// Replace the circuit with a netlist of ideal two-terminal elements and
    /// reset to `t = 0`.
    ///
    /// The four arrays are parallel — one entry per element, in the order the
    /// front end will index currents back from [`Simulation::element_currents`]:
    ///
    /// - `types[i]` — element type: `0` = DC voltage source (value = volts),
    ///   `1` = resistor (ohms), `2` = capacitor (farads), `3` = inductor
    ///   (henries).
    /// - `a[i]`, `b[i]` — the two terminal node indices. Node `0` is ground
    ///   (the reference, fixed at 0 V).
    /// - `values[i]` — the element value in the units implied by `types[i]`.
    ///
    /// `node_count` is the total number of nodes including ground. Returns
    /// `true` on success. On any length mismatch, an out-of-range node, a zero
    /// `node_count`, or an unknown element type it fails safe (installs an empty
    /// ground-only circuit) and returns `false` — it never throws.
    pub fn set_netlist(
        &mut self,
        node_count: usize,
        types: &[u8],
        a: &[u32],
        b: &[u32],
        values: &[f64],
    ) -> bool {
        self.inner.set_netlist(node_count, types, a, b, values)
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
}

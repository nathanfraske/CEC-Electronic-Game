// SPDX-License-Identifier: Apache-2.0
//! WebAssembly bindings. Keep this layer thin: it wraps sim-core and moves
//! values across the boundary. The front end calls `step` once per frame and
//! reads a snapshot, never per component.

use sim_core::Sim;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Simulation {
    inner: Sim,
}

#[wasm_bindgen]
impl Simulation {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> Simulation {
        Simulation {
            inner: Sim::new(seed as u64),
        }
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
    pub fn state(&self) -> Vec<f64> {
        self.inner.state().to_vec()
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

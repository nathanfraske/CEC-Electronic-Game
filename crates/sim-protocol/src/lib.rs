// SPDX-License-Identifier: Apache-2.0
//! Shared wire types between the simulation core and the front end.
//!
//! Keep this crate free of logic and free of platform dependencies. When you
//! add serialization, choose one format deliberately and record it in an ADR.

/// Bump on any breaking change to the wire schema. The front end checks this
/// against the value baked into the WebAssembly module on load.
pub const PROTOCOL_VERSION: u32 = 1;

/// Identifier for a circuit node, a continuous net in the analog domain.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct NodeId(pub u32);

/// Identifier for a component pin.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct PinId(pub u32);

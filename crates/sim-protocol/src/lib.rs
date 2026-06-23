// SPDX-License-Identifier: Apache-2.0
//! Shared wire types between the simulation core and the front end.
//!
//! Keep this crate free of logic and free of platform dependencies. When you
//! add serialization, choose one format deliberately and record it in an ADR.

/// Bump on any breaking change to the wire schema. The front end checks this
/// against the value baked into the WebAssembly module on load.
///
/// - **v1** — the original 5-terminal (`a`–`e`) / 4-param (`PARAM_STRIDE = 4`) format.
/// - **v2** — wire-format provisioning (ADR 0002): widened to **8 terminals** (`a`–`h`)
///   and **8 param slots** (`PARAM_STRIDE = 8`) so future parts are purely additive. The
///   extra terminals default to ground and the extra param slots to `0.0`, so the widened
///   format reproduces the v1 solve bit-for-bit — but the boundary arity changed, so the
///   version bumps.
pub const PROTOCOL_VERSION: u32 = 2;

/// Identifier for a circuit node, a continuous net in the analog domain.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct NodeId(pub u32);

/// Identifier for a component pin.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct PinId(pub u32);

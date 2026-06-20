# ADR 0002: Element wire-format provisioning for the "more reality" build-out

Status: accepted (implementation staged — see Notes)

## Decision

Provision the deterministic core's per-element wire format **once, now**, ahead of
the breadth/depth build-out scoped in `docs/reality-roadmap.md`, so the format is
final and future parts are purely additive:

- **`MAX_TERMINALS`: 5 → 8** (terminals `a`–`h`). Unused terminals default to node 0
  (ground) and are ignored, exactly as `c`/`d`/`e` are today.
- **`PARAM_STRIDE`: 4 → 8.** `param_or(params, i, default)` keeps a slot of `0.0`
  meaning "kind default", so a widened, zero-padded block reproduces today's solve
  bit-for-bit.
- **`PROTOCOL_VERSION` (`crates/sim-protocol`): 1 → 2** — a single, deliberate bump.

**Multi-bit data buses are NOT solved with terminals.** Wide parallel ports use a
hybrid keyed to what the bus *is*:

1. **Visible parallel data → one digital net per bit.** Reuses the existing per-net
   four-state `Level` hash; per-line probing, contention, skew, and tri-state are free
   and physically honest (an R-2R DAC's inputs, a flash ADC's outputs, a logic-analyzer
   capture). With `MAX_TERMINALS = 8` a converter can expose a modest port directly.
2. **Wide internal words → a composite device + one shared multi-bit hashed register.**
   The device expands web-side (the established `EC`/`POT`/electronic-load pattern) into
   primitives plus a "core" element owning a private register in one new hashed vector,
   keyed by element index; visible bits are driven onto ordinary digital nets. For SAR /
   sigma-delta internal state and ports wider than the terminal budget.
3. **MCU↔memory address/data/control → a packed `NetClass::Bus` net (an integer code).**
   Only inside the behavioral-MCU domain, where the bus is genuinely a word and never
   needs per-line physicality. The only place the packed representation earns its new
   hashed machinery.

## Rationale

The exhaustive additions catalog (the full component/phenomenon universe, grounded
against `crates/sim-core/src/lib.rs`) shows the architecture is overwhelmingly
*additive-friendly* — most new parts compose from the existing 22 elements, and new
element types with new hashed state are golden-safe by construction (the RC golden
contains none of them). The **one** thing that is painful to retrofit is the per-element
**wire format**: widening terminals or `PARAM_STRIDE` later is a second `PROTOCOL_VERSION`
bump that re-touches every netlist emitter and the boundary.

- **8 terminals** is the smallest count that covers the entire discrete + small-IC
  universe without a second bump: full flip-flops with async **set + reset + enable**
  (Q, Q̄, D, CLK, PRE, CLR = 6), dual-supply op-amps with offset-null pins, the **555**
  (8-pin), center-tapped / 3-winding transformers, gate drivers, tri-state buffers with
  OE, small analog muxes. It deliberately stops short of "enough for a parallel bus" —
  buses are the hybrid's job, not the terminal array's.
- **8 param slots** matches the richest models the catalog implies (a BJT with
  β + Is + Vaf + Rb + thermal coefficient; a real op-amp with GBW + slew + Vos + Ibias +
  Rout; a thermal device with Rθ + Cθ + T-coeff; a noise device with density + corner).
  Today's 4 is already tight (reverse-recovery `TT` took slot 3). `param_or` 0-defaults
  make the widening golden-safe.
- **Footprint cost is negligible:** +3 `usize` terminals and +4 `f64` params per element,
  trivial against the solver matrices, in exchange for never re-touching the format.

This is the action the owner's directive ("anything that needs to touch the engine or the
hash should be implemented now so we don't have to rebuild later") targets most directly.

## Notes

- **Golden-safe by construction:** unused terminals stay at ground and zero-padded param
  blocks reproduce via `param_or`, so `golden_snapshot_hash_is_stable`
  (`0xeaac_3764_99e4_fa24`) and `run_is_reproducible` must remain green. If any of them
  moves, the change is wrong — revert, do not regenerate.
- **Cross-layer + no JS runtime test → implement as ONE careful change with a
  runtime-exercising test.** The layers that must move in lockstep: the `Element` struct
  + `MAX_TERMINALS`/`PARAM_STRIDE` (`sim-core`), `PROTOCOL_VERSION` (`sim-protocol`), the
  `set_netlist*` boundary + `sim-wasm`, and `buildNetlist`'s terminal/param array emission
  (`web/src/lib/netlist.ts`) + the once-per-frame call in `web/src/sim/loop.ts`. A
  terminal/param **array-length desync** passes every gate but kills the sim at runtime
  (the POT regression earlier this session was exactly this class of bug, and there is no
  JS sim test to catch it). Add a Rust test installing an 8-terminal / 8-param element and
  reading slot 7 + terminal `h`, and hand-trace the array lengths at each layer.
- **Additive-later is possible but deliberately not chosen:** the 5th terminal `e` was
  added additively this session (new `set_netlist_pe`, old methods delegate with `e`
  grounded), proving terminals *can* grow incrementally. We provision to 8 now anyway to
  pay the boundary/emitter churn once rather than per part.
- **Keep the JS↔wasm boundary coarse** (ADR 0001): the wider arrays still cross once per
  frame in one batched netlist install.
- **Sequencing:** the clocked-sampler keystone (`ELEM_SAMPLER`, the ADC/S&H foundation)
  fits the *current* 5-terminal / 4-param format and ships first, sim-core-only and
  Rust-tested. This wire-format change lands as its own focused, fully-verified PR, after
  which the depth mechanisms (thermal `Tj`, the seeded per-element PRNG) and the wide
  converters use the final 8/8 format.

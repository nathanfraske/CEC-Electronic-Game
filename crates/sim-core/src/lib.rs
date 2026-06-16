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
//! Most elements have two terminals, nodes `a` and `b`; the transistors add a
//! third **control** terminal `c` (the gate). Node `0` is ground (the reference,
//! fixed at 0 V) and is eliminated from the system. A two-terminal element sets
//! `c = 0`, where it is ignored, so adding the field changes nothing on the
//! existing path.
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
//! | 8    | Schottky diode     | (unused)      | Shockley (low Vf), Newton companion|
//! | 9    | LED                | (unused)      | Shockley (high Vf), Newton companion|
//! | 10   | Zener diode        | breakdown Vz  | Shockley + reverse-breakdown junction|
//! | 11   | NMOS (nonlinear)   | (unused)      | level-1 square-law VCCS, Newton (D=a S=b G=c)|
//! | 12   | PMOS (nonlinear)   | (unused)      | level-1 square-law VCCS, Newton (D=a S=b G=c)|
//! | 13   | NPN BJT (nonlinear)| (unused)      | Ebers-Moll, Newton (C=a E=b B=c)   |
//! | 14   | PNP BJT (nonlinear)| (unused)      | Ebers-Moll, Newton (C=a E=b B=c)   |
//! | 15   | op-amp (nonlinear) | rail Vsat     | clamped transconductance, Newton (OUT=a IN-=b IN+=c)|
//! | 16   | varistor (MOV)     | clamp Vc      | symmetric dual-junction clamp, Newton a -> b|
//! | 17   | logic gate         | high rail V   | tick-pure boolean driver, linear (OUT=a IN1=b IN2=c)|
//! | 18   | transformer        | turns ratio n | ideal-T: magnetiser + hard secondary (pri=a/b sec=c/d)|
//! | 19   | D flip-flop        | logic rail V  | edge-triggered 1-bit memory, linear (Q=a D=b CLK=c Q̄=d)|
//!
//! Type 19 is the **D flip-flop**: the first *sequential* element — a one-bit memory
//! that samples its `D` input (`b`) on each rising edge of `CLK` (`c`) and presents it
//! on `Q` (`a`), with `Q̄` (`d`) the complement. Like the gate it drives its outputs
//! through [`GATE_GOUT`] from a value taken last tick (here the stored bit), so the
//! per-tick stamp is constant (no Newton); the bit is latched in the commit phase, a
//! clean one-tick clock-to-Q delay. It keeps two persistent scalars — the stored bit
//! and the previous clock level — that are deterministic but unhashed (the `Q`/`Q̄`
//! node voltages carry the observable state into the hash).
//!
//! Type 18 is the **transformer**: an **ideal-T model** — the first four-terminal
//! element (primary `a`/`b`, secondary `c`/`d`). Its `value` is the turns ratio
//! `n = Ns/Np`. A magnetising inductance [`TRANSFORMER_L1`] (with primary winding
//! resistance) sits across the primary; the secondary EMF is *forced* to `n · V_Lm`
//! (n times the magnetiser voltage — a HARD differential, no series term), and the
//! secondary current reflects `n·Is` back into the primary. It carries **two**
//! branch-current unknowns (magnetiser `Im` a->b, secondary `Is` c->d), only `Im`
//! reactive. So it blocks DC (as `Im` saturates `V_Lm -> 0`), shows magnetizing
//! current, and scales AC by `n` — and its hard ratio lets a diode bridge rectify
//! full-wave (a raw coupled-inductor pair, or any softer secondary, sags to
//! half-wave; see `docs/sim/transformer-bridge-convergence.md`). Like
//! the inductor it is linear (no Newton) and keeps two reactive states (the two
//! branch currents). See [`Sim::install`] and the coupled-inductor stamps.
//!
//! Type 17 is the **logic gate**: a Tier-A *behavioral* digital primitive (output
//! `a`, inputs `b` and `c`). Each tick it thresholds its inputs against half the
//! logic-high rail (its `value`) read from the **committed previous-tick** node
//! voltages, evaluates the boolean selected by its function code (`aux`: 0 AND,
//! 1 OR, 2 NAND, 3 NOR, 4 XOR, 5 XNOR, 6 NOT, 7 BUF — NOT/BUF ignore `c`), and
//! drives the output toward `0` or the rail through a finite output conductance
//! [`GATE_GOUT`]. Because the decision is taken from the previous tick's voltages,
//! the stamp is a **constant** for the solve (a conductance to ground plus a current
//! injection — exactly the form of the clocked switch), so it adds no Newton work
//! and no branch unknown, and it gives every gate one tick of propagation delay.
//! It holds **no** persistent state of its own (the output level is recomputed from
//! `node_v` each tick), so it is reproducible and never enters the snapshot hash.
//!
//! Type 15 is the **operational amplifier**: an ideal-ish op-amp (output `a`,
//! inverting input `b`, non-inverting input `c`) that drives its **output** toward
//! a smooth-clamped function of its **input difference** `Vd = V(c) - V(b)`. With a
//! huge fixed open-loop gain [`OPAMP_GAIN`] and a `tanh` saturation to its rail
//! `Vsat` (its `value`, clamped to [`OPAMP_VSAT_MIN`]), the target output is
//! `Vtarget = Vsat * tanh(GAIN * Vd / Vsat)`; the device sources
//! `Iout = GOUT * (Vtarget - V(a))` into the output through a finite output
//! conductance [`OPAMP_GOUT`] (a near-ideal but non-zero ~1 ohm output impedance for
//! stability). The inputs draw no current (ideal). Each Newton iteration it
//! linearises `Iout` in the three node voltages into the output row only (the inputs
//! merely sense), reusing the diode `gmin` floor at each input so a floating input
//! is non-singular. Like the MOSFET/BJT it adds **no** branch unknown and reads the
//! third terminal `c`; a per-iteration step limiter on `Vd` ([`opamp_limit`]) keeps
//! the stiff 1e5-gain linear region Newton-robust in feedback. See [`opamp_target`].
//!
//! Type 16 is the **varistor** (metal-oxide varistor, MOV): a two-terminal
//! *symmetric* voltage clamp — very high resistance (tiny leakage) while `|V| < Vc`,
//! then it conducts hard above `+/-Vc`, pinning the node near the clamp voltage (a
//! surge clamp). It is the symmetric cousin of the Zener: where the Zener has one
//! forward junction plus one reverse-breakdown junction, the varistor is **two**
//! oppositely-facing breakdown junctions about `0`, so it clamps both polarities.
//! It reuses the diode exponential and the [`pnjlim`] limiter (one limited
//! breakdown voltage each for the positive and negative junction) and adds no
//! branch unknown (see [`varistor_eval`]).
//!
//! Types 5, 8, 9, and 10 are the **diode family**: one set of Newton-companion
//! routines parameterised by a [`DiodeModel`] (saturation current + thermal
//! voltage), differing only in the model constants. The standard silicon diode is
//! unchanged, so existing nonlinear circuits reproduce bit-for-bit.
//!
//! Types 11 and 12 are the **MOSFET family**: a level-1 square-law
//! voltage-controlled current source (drain `a`, source `b`, gate `c`) linearised
//! into a transconductance + output-conductance companion each Newton iteration
//! (see [`mosfet_eval`]). Like a diode they add no branch unknown; unlike a diode
//! they read the third terminal `c`, which is the only reason `c` exists.
//!
//! Types 13 and 14 are the **BJT family**: an Ebers-Moll bipolar transistor
//! (collector `a`, emitter `b`, base `c`). Unlike the MOSFET's single square law it
//! has **two** exponential junctions, so it reuses the diode exponential and the
//! [`pnjlim`] limiter (one limited junction voltage each for base-emitter and
//! base-collector) rather than a new device-specific limiter; each Newton iteration
//! it linearises into the junction conductances + transconductances of the standard
//! 3-terminal companion (see [`bjt_eval`]). Like the MOSFET it adds no branch
//! unknown and reads the third terminal `c`.
//!
//! ## Sinusoidal AC voltage source
//!
//! The **AC source** ([`ELEM_ACSOURCE`]) is a voltage constraint identical to the
//! DC source ([`ELEM_VSOURCE`]) — same branch-current unknown, same stamp — except
//! its right-hand-side EMF is a sine that is a pure deterministic function of the
//! current [`Sim::tick`]:
//! `V(a) - V(b) = amplitude * sin(2*pi * f * tick * dt)`, where `f` is its
//! `value` (frequency in Hz, clamped to `>= 0`) and the peak `amplitude` is its
//! own second scalar `aux` when set (`> 0.0`), else the [`AC_AMPLITUDE`] default.
//! Being linear and time-varying it carries no Newton machinery: like the switch,
//! it is part of the fixed linear base and its EMF is recomputed once per solve
//! from the tick (the sine is exactly `0` at `t = 0`), so it composes with a
//! diode rectifier on the Newton path. The amplitude is the source's second
//! per-element scalar (`aux`), beside the `value` frequency.
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
/// time-varying constraint `V(a) - V(b) = amplitude * sin(2*pi * f * tick * dt)`
/// through the same MNA branch-current augmentation as [`ELEM_VSOURCE`]; the
/// *only* difference is the right-hand-side EMF is this sine rather than a
/// constant. Its `value` is the frequency `f` in hertz (clamped to `>= 0`); the
/// peak `amplitude` is its own `aux` scalar when set (`> 0.0`), else the
/// [`AC_AMPLITUDE`] default — so a source that supplies no amplitude swings
/// +/- 5 V as before. The EMF is a pure deterministic function of the tick (so it
/// reproduces and rewinds with the tick and is exactly `0` at `t = 0`), and the
/// element is linear, so it lives in the fixed linear base and needs no Newton
/// machinery.
pub const ELEM_ACSOURCE: u8 = 7;

/// **Schottky diode**. Same Newton-companion junction as [`ELEM_DIODE`], but a
/// metal-semiconductor model: a much larger saturation current gives a low
/// forward drop (~0.3 V vs ~0.7 V silicon). Oriented anode `a` -> cathode `b`;
/// `value` is unused (the model is fixed). See [`diode_model`].
pub const ELEM_SCHOTTKY: u8 = 8;

/// **LED** (light-emitting diode). Same junction machinery as [`ELEM_DIODE`] with
/// a high forward drop (~1.8–2 V, a larger ideality factor and tiny saturation
/// current). The emitted brightness is a presentation-only function of the
/// forward current, computed in the view — the core just solves the junction.
/// Oriented anode `a` -> cathode `b`; `value` is unused. See [`diode_model`].
pub const ELEM_LED: u8 = 9;

/// **Zener diode**. A silicon junction that also conducts *backwards* once the
/// reverse bias exceeds its breakdown voltage — the basis of a shunt voltage
/// reference/clamp. Oriented anode `a` -> cathode `b`; its `value` is the
/// **breakdown voltage `Vz`** in volts (clamped to a sane minimum). Modelled as
/// the silicon forward junction plus a second, oppositely-facing exponential that
/// turns on near `-Vz` (see [`diode_eval`]), solved on the same Newton path with
/// limiting applied to whichever junction is active. See [`diode_model`].
pub const ELEM_ZENER: u8 = 10;

/// **N-channel MOSFET** (the first three-terminal device). Drain `a`, source `b`,
/// gate `c`; the channel current flows `a -> b` (drain to source) and is
/// controlled by `c`. A level-1 square-law voltage-controlled current source: at
/// the current Newton iterate it linearises into a transconductance `gm` (from the
/// gate) and an output conductance `gds` (drain-source) plus an equivalent current
/// (see [`mosfet_eval`]). Like a diode it adds **no** branch unknown — it stamps
/// conductances and a current into the KCL rows — but unlike a diode it reads the
/// third terminal, which is why [`Element`] carries `c`. The gate draws no DC
/// current (a [`GMIN`] is stamped to keep its node non-singular). `value` is
/// **unused** for now; the model uses the fixed [`NMOS_VTO`], [`MOS_KP`],
/// [`MOS_LAMBDA`].
pub const ELEM_NMOS: u8 = 11;

/// **P-channel MOSFET**. Drain `a`, source `b`, gate `c`; the conventions are the
/// symmetric mirror of [`ELEM_NMOS`]. It conducts when the gate is *below* the
/// source by more than `|VTO|` (its threshold [`PMOS_VTO`] is negative), and the
/// drain current flows source -> drain (negative in `a -> b` terms). Internally it
/// reuses the same square-law evaluation as the NMOS on sign-flipped terminal
/// voltages (see [`mosfet_eval`]), so it rides the identical companion-stamp and
/// commit machinery. `value` is **unused** for now.
pub const ELEM_PMOS: u8 = 12;

/// **NPN bipolar junction transistor** (the first two-junction nonlinear device).
/// Collector `a`, emitter `b`, base `c`; the main current flows `a -> b`
/// (collector to emitter) and is controlled by the base `c`, mirroring the
/// MOSFET's drain/source/gate. An Ebers-Moll model: **two** coupled exponential
/// junctions (base-emitter and base-collector) that reuse the diode exponential
/// and the [`pnjlim`] limiter rather than the MOSFET square law. At the current
/// Newton iterate it linearises into the small-signal junction conductances
/// `gpi`/`gmu` and the forward/reverse transconductances, plus equivalent currents
/// on the collector and base (see [`bjt_eval`]). Like a MOSFET it adds **no**
/// branch unknown and reads the third terminal `c`. `value` is **unused**; the
/// model uses the fixed [`BJT_IS`], [`DIODE_VT`], [`BJT_BF`], [`BJT_BR`].
pub const ELEM_NPN: u8 = 13;

/// **PNP bipolar junction transistor**. Collector `a`, emitter `b`, base `c`; the
/// conventions are the symmetric mirror of [`ELEM_NPN`]. It conducts when the base
/// is pulled *below* the emitter (the junction voltages and currents are the
/// sign-flipped image of the NPN's). Internally it reuses the same Ebers-Moll
/// evaluation as the NPN on negated junction voltages (see [`bjt_op`]), so it
/// rides the identical companion-stamp and commit machinery. `value` is
/// **unused** for now.
pub const ELEM_PNP: u8 = 14;

/// **Operational amplifier** (ideal-ish, the first controlled-source primitive).
/// Output `a`, inverting input `b` (IN-), non-inverting input `c` (IN+). Unlike the
/// transistors (which control a current *between* two of their own terminals), the
/// op-amp drives its **output** node toward a function of its **input difference**
/// `Vd = V(c) - V(b)`. Its `value` is the **saturation rail magnitude `Vsat`** in
/// volts (clamped to [`OPAMP_VSAT_MIN`]); the output swings within `+/-Vsat`.
///
/// The behavioural model is a smooth-clamped transconductance into a finite output
/// conductance — a voltage source built from a stiff pull, with no branch unknown.
/// With the fixed open-loop gain [`OPAMP_GAIN`] and output conductance
/// [`OPAMP_GOUT`], the target output is `Vtarget = Vsat * tanh(GAIN*Vd/Vsat)` and the
/// device injects `Iout = GOUT * (Vtarget - V(a))` at the output, so `V(a) -> Vtarget`
/// with output impedance `1/GOUT`. The `tanh` is bounded, so `Vtarget` (and the
/// stamp) can never explode; in saturation its slope `dT -> 0`, which correctly stops
/// the linearisation responding once the output is clamped. The inputs draw **no**
/// current (ideal); a [`GMIN`] is stamped at each so a floating input is non-singular.
/// Like the MOSFET/BJT it adds **no** branch unknown and reads the third terminal `c`;
/// each Newton iteration it linearises `Iout` into the output row only (see
/// [`opamp_target`]), with a per-iteration step limiter on `Vd` ([`opamp_limit`])
/// keeping the stiff high-gain linear region robust in feedback.
pub const ELEM_OPAMP: u8 = 15;

/// **Varistor** (metal-oxide varistor, MOV). A two-terminal *symmetric* voltage
/// clamp, oriented `a -> b`: with `V = V(a) - V(b)`, it draws only a tiny leakage
/// while `|V| < Vc`, then conducts hard once `|V|` exceeds the clamp voltage,
/// pinning the node near `+/-Vc` — a surge clamp. Its `value` is the **clamp
/// voltage `Vc`** in volts (clamped to [`MOV_VC_MIN`]). The symmetric cousin of the
/// [`ELEM_ZENER`]: it is **two** oppositely-facing breakdown junctions about `0`
/// (positive breakdown variable `up = V - Vc`, negative `un = -V - Vc`), reusing the
/// diode exponential and the [`pnjlim`] limiter on each, solved on the same Newton
/// path. Like a diode it adds **no** branch unknown — it stamps a conductance and an
/// equivalent current into the KCL rows. The model constants are the fixed
/// [`MOV_IK`] (knee current at exactly `|V| = Vc`) and [`MOV_VTH`] (clamp sharpness).
/// See [`varistor_eval`].
pub const ELEM_VARISTOR: u8 = 16;

/// **Logic gate** (Tier-A behavioral digital primitive). Three terminals: output
/// `a`, input 1 `b`, input 2 `c`. Its `value` is the **logic-high rail** in volts
/// and its `aux` is the **function code** ([`gate_logic`]: 0 AND, 1 OR, 2 NAND,
/// 3 NOR, 4 XOR, 5 XNOR, 6 NOT, 7 BUF — the single-input NOT/BUF ignore `c`). Each
/// tick it thresholds the two inputs against half the rail using the **committed
/// previous-tick** node voltages, evaluates the boolean, and drives the output
/// toward `0` (logic low) or the rail (logic high) through the fixed output
/// conductance [`GATE_GOUT`]. Because the decision comes from the *previous* tick,
/// the per-tick stamp is a **constant** — a conductance [`GATE_GOUT`] from `a` to
/// ground plus a current injection `GATE_GOUT * Vtarget` into `a`, exactly the form
/// of a Thevenin source and the same "linear, tick-determined" shape as the clocked
/// [`ELEM_SWITCH`]. So it adds **no** Newton work, **no** branch unknown, and one
/// tick of propagation delay; a feedback loop of gates oscillates rather than
/// deadlocking (a ring oscillator), which is physically honest. It holds no
/// persistent state — the output level is recomputed from `node_v` every tick — so
/// it stays reproducible and never enters the snapshot hash. See [`gate_logic`] and
/// [`gate_target_level`].
pub const ELEM_GATE: u8 = 17;

/// Logic-gate output conductance (siemens): the gate drives its output toward the
/// rail or ground through this finite conductance, a stiff but non-ideal ~1 ohm
/// driver (`1/GATE_GOUT`) so logic levels read crisply while a real, finite drive
/// strength still limits the current into a load. The digital analogue of
/// [`OPAMP_GOUT`].
const GATE_GOUT: f64 = 1.0;

/// Logic-gate input threshold as a fraction of the logic-high rail: an input reads
/// as logic `1` when its node voltage exceeds `GATE_VTH_FRAC * value`. A clean
/// half-rail switching point (the CMOS-like idealisation); the invalid/indeterminate
/// band of a real family is deliberately collapsed to this single threshold for the
/// first-cut behavioral model.
const GATE_VTH_FRAC: f64 = 0.5;

/// A logic family: the DC levels and output drive that define how a gate reads its
/// inputs and presents its output, replacing the single `value`-is-everything model
/// (`value` was simultaneously V_IL, V_IH, V_OL and V_OH). Levels are fractions of
/// the gate's rail (`value`) so one table serves any rail; the conductances are the
/// output drive strength. All fields are fixed constants → golden-reproducible.
///
/// This is the substrate for the separated analog/digital domain (see
/// `docs/ui/logic-analog-digital-nets.md` §6): a **receiver** reads an input with
/// [`LogicFamily::reads_high`] (V_IH), a **driver** presents the output with
/// [`LogicFamily::drive`] (V_OL/V_OH through R_ol/R_oh). The default
/// [`LogicFamily::LEGACY`] reproduces the original idealised gate exactly, so wiring
/// the gate through this abstraction changes no number and no golden.
#[derive(Clone, Copy)]
struct LogicFamily {
    /// Input read high above this fraction of the rail. (A real family's lower
    /// `V_IL` threshold — the indeterminate band below this — arrives with the
    /// receiver's `X` verdict in the scheduler phase; LEGACY has no such band.)
    v_ih_frac: f64,
    /// Output-low / output-high voltage as a fraction of the rail.
    v_ol_frac: f64,
    v_oh_frac: f64,
    /// Output drive conductance (siemens) for the low / high pull.
    g_ol: f64,
    g_oh: f64,
}

impl LogicFamily {
    /// The idealised family that reproduces the original gate behaviour bit-for-bit:
    /// a single half-rail input threshold ([`GATE_VTH_FRAC`]) and a rail-to-ground
    /// output through [`GATE_GOUT`]. The default for every gate until a real family
    /// (TTL/CMOS/LVCMOS) is selected, which keeps every existing golden unchanged.
    const LEGACY: LogicFamily = LogicFamily {
        v_ih_frac: GATE_VTH_FRAC,
        v_ol_frac: 0.0,
        v_oh_frac: 1.0,
        g_ol: GATE_GOUT,
        g_oh: GATE_GOUT,
    };

    /// Receiver: does input voltage `v` read as logic high at rail `vhigh`? An input
    /// must exceed `v_ih_frac * vhigh` to be high; below reads low. (For LEGACY this
    /// is the exact `v > GATE_VTH_FRAC * value` compare the gate used.)
    #[inline]
    fn reads_high(&self, v: f64, vhigh: f64) -> bool {
        v > self.v_ih_frac * vhigh.max(0.0)
    }

    /// Driver: the (target voltage, output conductance) this family presents for a
    /// logic level at rail `vhigh`. High → `(v_oh_frac*vhigh, g_oh)`; low →
    /// `(v_ol_frac*vhigh, g_ol)`. (For LEGACY: `(vhigh, GATE_GOUT)` / `(0, GATE_GOUT)`.)
    #[inline]
    fn drive(&self, level_high: bool, vhigh: f64) -> (f64, f64) {
        let vh = vhigh.max(0.0);
        if level_high {
            (self.v_oh_frac * vh, self.g_oh)
        } else {
            (self.v_ol_frac * vh, self.g_ol)
        }
    }
}

/// **Transformer** (ideal-T model). The first four-terminal element: primary
/// `a`/`b`, secondary `c`/`d`. Its `value` is the turns ratio `n = Ns/Np`. A
/// magnetising inductance [`TRANSFORMER_L1`] in series with the primary winding
/// resistance [`TRANSFORMER_RWIND`] sits across the primary; the ideal coupling
/// *forces* the secondary EMF to `n · V_Lm` — n times the voltage across the
/// magnetiser — a HARD differential with no series term, while the secondary current
/// reflects `n·Is` back into the primary KCL. It carries **two** branch unknowns —
/// the magnetising current `Im` (a->b) and the secondary current `Is` (c->d) — but
/// only `Im` is reactive (a backward-Euler companion); `Is` is algebraic. So it
/// blocks DC (as the magnetiser saturates, `V_Lm -> 0` and the secondary collapses),
/// draws a real magnetizing current, and scales AC by the turns ratio. Crucially the
/// forced secondary EMF is a HARD voltage differential (like a real source), so a
/// diode bridge across it rectifies full-wave — a softer secondary (a raw coupled-
/// inductor pair, or an EMF with series winding resistance) sags under the bridge's
/// asymmetric load and degenerates to half-wave or latches a runaway
/// (`docs/sim/transformer-bridge-convergence.md`). Linear (no Newton); keeps one
/// reactive state (the magnetiser). The branch pair is allocated consecutively in
/// [`Sim::install`]: `branch_index[i]` is the magnetiser, `branch_index[i] + 1` the
/// secondary.
pub const ELEM_TRANSFORMER: u8 = 18;

/// Transformer **magnetising** inductance, in henries (fixed) — the shunt branch of
/// the ideal-T model. High enough that the magnetizing current is modest at audio
/// frequencies (so the secondary EMF `n · V_Lm` tracks `n · Vp` cleanly) while
/// staying within the inductor range the dense solve already conditions for. The
/// secondary is coupled ideally (turns ratio `n`) as a hard differential, so there is
/// no separate secondary inductance or winding resistance — only the primary-side
/// [`TRANSFORMER_RWIND`] gives the device loss.
const TRANSFORMER_L1: f64 = 0.5;

/// Transformer **primary** winding resistance, in ohms (fixed); it sits in series
/// with the magnetiser on the primary side. The secondary is an ideal hard
/// differential and carries no winding resistance of its own (any series term there
/// would soften the differential and break bridge rectification — see
/// [`ELEM_TRANSFORMER`]). Small enough to be negligible against the winding reactance
/// at audio frequencies (so AC turns-ratio scaling stays clean), but non-zero so a DC
/// drive's magnetising current **saturates** at `V/R` instead of ramping forever —
/// which is exactly what lets the transformer **block DC** (once `dI/dt -> 0` the
/// induced secondary voltage decays to zero). Without it an ideal magnetising
/// inductor would integrate a DC step without bound.
const TRANSFORMER_RWIND: f64 = 5.0;

/// **D flip-flop** (edge-triggered one-bit memory — the first *sequential* element).
/// Four terminals: output `a` = `Q`, input `b` = `D` (data), input `c` = `CLK`
/// (clock), output `d` = `Q̄` (the complement). Its `value` is the logic-high rail,
/// shared with the gate family (inputs thresholded at [`GATE_VTH_FRAC`] of it, the
/// outputs driven through [`GATE_GOUT`]). On each **rising edge** of `CLK` it samples
/// `D` into a stored bit; otherwise it holds. The outputs are driven from the
/// **committed** bit (a constant Thévenin stamp, exactly the gate's shape, so it adds
/// no Newton work), and the bit is updated once per step in the commit phase from the
/// solved `CLK`/`D` — giving a clean one-tick clock-to-output delay. The stored bit
/// and the previous clock level are persistent per-element state (like the reactive
/// companions: deterministic, not hashed — the observable `Q`/`Q̄` voltages carry into
/// the snapshot). Wire `Q̄ → D` for a toggle (÷2), the seed of every counter. See
/// [`Sim::stamp_dff`].
pub const ELEM_DFF: u8 = 19;

// --- AC voltage source model constants ----------------------------------------

/// Default peak amplitude of an [`ELEM_ACSOURCE`], in volts. Used when the
/// source's `aux` scalar is `0.0` (the unset default), so a source that supplies
/// no amplitude — every existing AC example — still swings +/- 5 V exactly as
/// before. A source that sets `aux > 0.0` overrides it with that peak per device
/// (the amplitude is the source's second scalar, beside its `value` frequency).
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

/// **Schottky** saturation current — far larger than silicon, which is what pulls
/// the forward knee down to ~0.3 V at a ~100 mA drive. Ideality 1.
const SCHOTTKY_IS: f64 = 1.0e-6;
/// **LED** saturation current — tiny, and paired with a larger ideality factor to
/// push the forward knee up to ~1.8–2 V.
const LED_IS: f64 = 1.0e-18;
/// LED emission (ideality) coefficient — wider junction than a signal diode.
const LED_N: f64 = 2.0;

/// **Zener** breakdown knee current, in amperes — the reverse current at exactly
/// `vd = -Vz`. Calibrates where the breakdown "turns on".
const ZENER_ISZ: f64 = 5.0e-4;
/// **Zener** breakdown sharpness (the breakdown junction's effective thermal
/// voltage), in volts. Smaller = a harder clamp; large enough to keep Newton well
/// conditioned. The reverse current is `ISZ * exp((-vd - Vz) / ZENER_VTH_BR)`.
const ZENER_VTH_BR: f64 = 0.02;
/// Floor on a Zener's breakdown voltage, in volts, so `value <= 0` can't produce a
/// degenerate or back-to-front device.
const ZENER_VZ_MIN: f64 = 0.5;

// --- Varistor (MOV) model constants -------------------------------------------

/// **Varistor** knee current, in amperes — the current at exactly `|V| = Vc`,
/// where one of the two breakdown junctions reaches `exp(0) = 1`. Calibrates where
/// the symmetric clamp "turns on". Fixed for determinism.
const MOV_IK: f64 = 1.0e-3;
/// **Varistor** clamp sharpness (each breakdown junction's effective thermal
/// voltage), in volts. Smaller = a harder clamp; large enough to keep Newton well
/// conditioned. The positive-side current is `MOV_IK * exp((V - Vc) / MOV_VTH)` and
/// the negative side its mirror, so a smaller `MOV_VTH` pins `|V|` closer to `Vc`.
const MOV_VTH: f64 = 0.05;
/// Floor on a varistor's clamp voltage, in volts, so `value <= 0` can't produce a
/// degenerate device that conducts at every bias.
const MOV_VC_MIN: f64 = 1.0;

// --- MOSFET (level-1 square-law) model constants ------------------------------

/// **NMOS** gate-source threshold voltage `VTO`, in volts. The channel turns on
/// once `Vgs` exceeds this. Fixed default (an enhancement-mode logic-level part);
/// the device's `value` field is unused for now.
const NMOS_VTO: f64 = 2.0;
/// **PMOS** gate-source threshold voltage `VTO`, in volts — negative, since a PMOS
/// conducts when the gate is pulled *below* the source by more than `|VTO|`.
const PMOS_VTO: f64 = -2.0;
/// MOSFET transconductance parameter `KP = mu*Cox*(W/L)`, in A/V^2. Sets the drain
/// current scale of the square law. Shared by both polarities.
const MOS_KP: f64 = 0.02;
/// MOSFET channel-length-modulation parameter `LAMBDA`, in 1/V. Gives the
/// saturation region a finite (Early-like) output conductance, so a saturated
/// stage has a real, non-zero `gds`. Shared by both polarities.
const MOS_LAMBDA: f64 = 0.02;
/// Maximum per-iteration change, in volts, allowed for a MOSFET's `Vgs`/`Vds`
/// control voltages — the FET analogue of [`pnjlim`]'s junction limiting. The
/// square law is polynomial (far less stiff than a diode exponential), so this
/// mild clamp is all Newton needs to stay well behaved through the
/// cutoff/triode/saturation corners; it only acts on large excursions, so a
/// settled device passes through unchanged. See [`mosfet_limit`].
const MOS_VLIM_DELTA: f64 = 2.0;

// --- BJT (Ebers-Moll) model constants -----------------------------------------

/// BJT transport saturation current `Is`, in amperes. Sets the scale of both
/// exponential junctions in the Ebers-Moll model. A typical small-signal value;
/// fixed for determinism (the device's `value` field is unused for now). The
/// thermal voltage is shared with the diode family ([`DIODE_VT`]).
const BJT_IS: f64 = 1.0e-15;
/// BJT forward current gain `BF` (beta) — the active-region ratio `Ic / Ib` when
/// the base-emitter junction is forward biased and the base-collector junction is
/// reverse biased. Fixed default. Shared by both polarities.
const BJT_BF: f64 = 100.0;
/// BJT reverse current gain `BR` — the (much smaller) gain when the device is run
/// inverted (collector and emitter swapped). Keeps the reverse junction's
/// contribution physical. Fixed default. Shared by both polarities.
const BJT_BR: f64 = 2.0;

// --- Op-amp (clamped transconductance) model constants ------------------------

/// Op-amp open-loop voltage gain `A`, dimensionless. Huge (1e5) so that in feedback
/// the differential input `Vd` is driven to ~0 (the "virtual short"), giving the
/// near-ideal closed-loop gains the textbook formulas predict. It is the slope of
/// the `tanh` at the origin, `dVtarget/dVd|_0 = OPAMP_GAIN`; the `tanh` bounds the
/// target at `+/-Vsat`, so even this stiff gain can never make the stamp explode.
const OPAMP_GAIN: f64 = 1.0e5;
/// Op-amp output conductance `Gout`, in siemens — a finite ~1 ohm output impedance
/// (`1/OPAMP_GOUT`). Near-ideal but non-zero on purpose: a finite output conductance
/// gives the output row a real diagonal entry (well conditioned) and keeps the stiff
/// pull `Iout = Gout*(Vtarget - V(a))` from being a singular ideal voltage source.
const OPAMP_GOUT: f64 = 1.0;
/// Floor on an op-amp's saturation rail `Vsat`, in volts, so `value <= 0` can't
/// produce a degenerate device with a zero (or back-to-front) output swing. A
/// supplied `value` below this is clamped up to it; the default 12 V passes through.
const OPAMP_VSAT_MIN: f64 = 1.0;
/// Maximum per-iteration change, in volts, allowed for an op-amp's differential
/// input `Vd` — the analogue of [`pnjlim`]/[`mosfet_limit`] for the stiff high-gain
/// transconductance. In the linear region a single Newton step on a 1e5-gain device
/// can overshoot the rail wildly; clamping `|dVd|` keeps the iterate inside the
/// well-behaved part of the `tanh`. The bound is a few times the linear-region width
/// `Vsat/OPAMP_GAIN` (so the output can still traverse its full `+/-Vsat` swing in a
/// handful of iterations) plus an absolute floor so a cold start from `Vd = 0` is not
/// frozen. Small steps pass through unchanged, so a settled device is unaffected and
/// this never over-iterates. See [`opamp_limit`].
const OPAMP_VD_LIM_DELTA: f64 = 1.0e-3;

/// The handful of model parameters a junction needs, so one set of Newton-companion
/// routines ([`diode_eval`], [`diode_vcrit`], [`pnjlim`]) serves the whole diode
/// family. `vth = n * Vt`. `vz` is the reverse **breakdown** voltage; it is
/// `f64::INFINITY` for every non-Zener device, which switches the breakdown term
/// off entirely — so those devices stay byte-for-byte identical.
#[derive(Clone, Copy)]
struct DiodeModel {
    is: f64,
    vth: f64,
    vz: f64,
}

/// The junction model for a diode-family element kind. Pure function of `kind` and
/// the element `value` (only the Zener reads `value`, as its breakdown voltage),
/// so it never costs determinism.
#[inline]
fn diode_model(kind: u8, value: f64) -> DiodeModel {
    match kind {
        ELEM_SCHOTTKY => DiodeModel {
            is: SCHOTTKY_IS,
            vth: DIODE_N * DIODE_VT,
            vz: f64::INFINITY,
        },
        ELEM_LED => DiodeModel {
            is: LED_IS,
            vth: LED_N * DIODE_VT,
            vz: f64::INFINITY,
        },
        ELEM_ZENER => DiodeModel {
            is: DIODE_IS,
            vth: DIODE_N * DIODE_VT,
            vz: value.max(ZENER_VZ_MIN),
        },
        // ELEM_DIODE and anything else: the silicon default, no breakdown.
        _ => DiodeModel {
            is: DIODE_IS,
            vth: DIODE_N * DIODE_VT,
            vz: f64::INFINITY,
        },
    }
}

/// The breakdown junction of a Zener, expressed as an ordinary forward junction in
/// the variable `vbr = -vd - Vz` so the standard [`diode_eval`]/[`pnjlim`] routines
/// can limit it. No breakdown of its own (`vz = INFINITY`).
#[inline]
fn zener_breakdown_model() -> DiodeModel {
    DiodeModel {
        is: ZENER_ISZ,
        vth: ZENER_VTH_BR,
        vz: f64::INFINITY,
    }
}

/// True for every element on the Newton (diode-family) path. Centralises the
/// membership test so the linear/nonlinear split, the companion-collection loops,
/// and the current commit all agree on exactly one definition.
#[inline]
fn is_diode(kind: u8) -> bool {
    matches!(kind, ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER)
}

/// True for every MOSFET-family element. Like [`is_diode`], it centralises the
/// membership test so the nonlinear split, the companion collection, and the
/// current commit share one definition.
#[inline]
fn is_mosfet(kind: u8) -> bool {
    matches!(kind, ELEM_NMOS | ELEM_PMOS)
}

/// True for every BJT-family element (NPN or PNP). Like [`is_diode`] and
/// [`is_mosfet`], it centralises the membership test so the nonlinear split, the
/// companion collection, and the current commit share one definition.
#[inline]
fn is_bjt(kind: u8) -> bool {
    matches!(kind, ELEM_NPN | ELEM_PNP)
}

/// True for the varistor (MOV). Like [`is_diode`], it centralises the membership
/// test so the nonlinear split, the companion collection, and the current commit
/// share one definition. A single-kind family today, but the helper keeps the
/// guarded paths reading uniformly with the other device families.
#[inline]
fn is_varistor(kind: u8) -> bool {
    kind == ELEM_VARISTOR
}

/// True for the operational amplifier. Like [`is_varistor`], it centralises the
/// membership test so the nonlinear split, the companion collection, and the current
/// commit share one definition. A single-kind family today, but the helper keeps the
/// guarded paths reading uniformly with the other device families.
#[inline]
fn is_opamp(kind: u8) -> bool {
    kind == ELEM_OPAMP
}

/// Evaluate a logic gate's boolean output from its two thresholded inputs and its
/// function code (`code` = the element's `aux`, rounded to the nearest non-negative
/// integer): 0 AND, 1 OR, 2 NAND, 3 NOR, 4 XOR, 5 XNOR, 6 NOT (ignores `in2`),
/// 7 BUF (ignores `in2`). Any other code falls back to AND. Pure boolean — fully
/// deterministic and platform-independent.
#[inline]
fn gate_logic(code: f64, in1: bool, in2: bool) -> bool {
    match code.round() as u32 {
        1 => in1 || in2,
        2 => !(in1 && in2),
        3 => !(in1 || in2),
        4 => in1 ^ in2,
        5 => !(in1 ^ in2),
        6 => !in1,
        7 => in1,
        // 0 and any unrecognised code: AND.
        _ => in1 && in2,
    }
}

/// The voltage a logic gate drives its output toward this tick. The two input node
/// voltages `v1`, `v2` (the **committed previous-tick** values) are thresholded at
/// `GATE_VTH_FRAC * vhigh`, the boolean is evaluated by [`gate_logic`], and the
/// result maps to `vhigh` (logic 1) or `0.0` (logic 0). `vhigh` is the gate's
/// `value`, floored at `0`. Pure `f64` + boolean, so it reproduces exactly.
#[inline]
fn gate_target_level(code: f64, vhigh: f64, v1: f64, v2: f64) -> f64 {
    // Route through the (default) LEGACY family: a receiver reads each input, the
    // boolean is evaluated, and the driver presents the output voltage. LEGACY's
    // numbers are the original idealisation (half-rail threshold, rail/ground out
    // through GATE_GOUT), so this is byte-identical — the substrate for real
    // families + the digital-domain boundary (docs/ui/logic-analog-digital-nets.md).
    let fam = LogicFamily::LEGACY;
    let in1 = fam.reads_high(v1, vhigh);
    let in2 = fam.reads_high(v2, vhigh);
    fam.drive(gate_logic(code, in1, in2), vhigh).0
}

/// True for every nonlinear element (any device that drives the Newton outer
/// loop): the diode family, the MOSFET family, the BJT family, the varistor, or the
/// op-amp. The single switch that selects the Newton path over the linear fast path.
/// (The logic gate is deliberately **not** here: its output decision is taken from
/// the previous tick, so within a solve its stamp is constant and a gate-only circuit
/// stays on the linear fast path.)
#[inline]
fn is_nonlinear(kind: u8) -> bool {
    is_diode(kind) || is_mosfet(kind) || is_bjt(kind) || is_varistor(kind) || is_opamp(kind)
}

/// True for the **digital** element kinds — a logic gate or a flip-flop. Their
/// terminals are logic pins (driven/sensed levels) rather than continuous-voltage
/// analog terminals. The net-classification pass ([`classify_nets`]) uses this to
/// separate the analog and digital domains; the boundary between them is any node
/// where a digital pin and an analog element meet. See
/// `docs/ui/logic-analog-digital-nets.md` §7.
#[inline]
fn is_digital(kind: u8) -> bool {
    kind == ELEM_GATE || kind == ELEM_DFF
}

/// How a circuit node relates to the analog/digital split — the substrate for the
/// separated digital domain (`docs/ui/logic-analog-digital-nets.md` §7). Ground and
/// any node touched by an analog element are [`NetClass::Analog`]; a node touched
/// **only** by digital pins is a pure-[`NetClass::Digital`] net (which will leave the
/// MNA matrix once the event scheduler lands); a node touched by **both** is a
/// [`NetClass::Boundary`] net (a receiver reads it, a driver writes it). Computed
/// deterministically in fixed element order so the result can feed the snapshot hash.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum NetClass {
    Analog = 0,
    Digital = 1,
    Boundary = 2,
}

/// Classify every node as analog / pure-digital / boundary from the element list —
/// the in-core analogue of a Verilog-AMS discipline-resolution pass (LRM Annex F),
/// done in fixed element order so it is deterministic. A node is *analog-touched* if
/// any analog element has a terminal on it and *digital-touched* if any digital pin
/// does; ground (node `0`) is always analog (the shared reference). Unused element
/// terminals sit at ground, so iterating all four terminals is safe — an unused
/// terminal can only ever re-mark ground, which is forced analog regardless.
fn classify_nets(node_count: usize, elements: &[Element]) -> Vec<NetClass> {
    let mut analog_touched = vec![false; node_count];
    let mut digital_touched = vec![false; node_count];
    for e in elements {
        let digital = is_digital(e.kind);
        for t in [e.a, e.b, e.c, e.d] {
            if t >= node_count {
                continue;
            }
            if digital {
                digital_touched[t] = true;
            } else {
                analog_touched[t] = true;
            }
        }
    }
    (0..node_count)
        .map(|n| {
            if n == 0 {
                NetClass::Analog // ground: the shared reference for both domains
            } else if analog_touched[n] && digital_touched[n] {
                NetClass::Boundary
            } else if digital_touched[n] {
                NetClass::Digital
            } else {
                NetClass::Analog
            }
        })
        .collect()
}

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

/// One ideal element in the netlist. Two-terminal elements use `a` and `b` (and
/// set `c = 0`, where it is ignored); three-terminal devices (the MOSFETs) also
/// use the control terminal `c`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Element {
    /// Element type. See the `ELEM_*` constants.
    pub kind: u8,
    /// First terminal node index (drain for a MOSFET). Node `0` is ground.
    pub a: usize,
    /// Second terminal node index (source for a MOSFET). Node `0` is ground.
    pub b: usize,
    /// Control terminal node index — the gate for a MOSFET. Unused for every
    /// two-terminal element, where it is `0` (ground) and never read. Node `0`
    /// is ground.
    pub c: usize,
    /// Fourth terminal node index — the **second secondary** node of a four-terminal
    /// element. Today only the [`ELEM_TRANSFORMER`] reads it: its terminals are
    /// `a`/`b` = primary +/− and `c`/`d` = secondary +/−. Unused (`0` = ground, never
    /// read) for every element with three or fewer terminals — the terminal analogue
    /// of how `c` is ignored by two-terminal elements, so adding it changes nothing
    /// on the existing paths. Node `0` is ground.
    pub d: usize,
    /// Element value in the units implied by `kind` (V / ohm / F / H / A).
    pub value: f64,
    /// Second per-element scalar, parallel to `value`. Unused by every element
    /// except the [`ELEM_ACSOURCE`], where it is the **peak amplitude** in volts
    /// (`0.0` there selects the [`AC_AMPLITUDE`] default). Every other element
    /// leaves it `0.0`, where it is never read — so adding the field changes
    /// nothing on the existing paths, the scalar analogue of how the third
    /// terminal `c` is ignored by two-terminal elements.
    pub aux: f64,
}

/// A diode's terminal map for the Newton companion: `(element_index, anode_mna,
/// cathode_mna)`, each MNA index `None` for ground. Collected once per solve in
/// ascending element order and stamped each iteration.
type DiodeMap = (usize, Option<usize>, Option<usize>);

/// A MOSFET's terminal map for the Newton companion: `(element_index, drain_mna,
/// source_mna, gate_mna)`, each MNA index `None` for ground. The four-terminal
/// analogue of [`DiodeMap`] (drain/source/gate); aliased so the collection and the
/// `newton_iterate` signature stay readable.
type MosfetMap = (usize, Option<usize>, Option<usize>, Option<usize>);

/// A BJT's terminal map for the Newton companion: `(element_index, collector_mna,
/// emitter_mna, base_mna)`, each MNA index `None` for ground. The same shape as
/// [`MosfetMap`] (the three terminals a/b/c = collector/emitter/base); aliased so
/// the collection and the `newton_iterate` signature stay readable.
type BjtMap = (usize, Option<usize>, Option<usize>, Option<usize>);

/// A varistor's terminal map for the Newton companion: `(element_index, a_mna,
/// b_mna)`, each MNA index `None` for ground. The same two-terminal shape as
/// [`DiodeMap`] (oriented `a -> b`); aliased so the collection and the
/// `newton_iterate` signature stay readable.
type VaristorMap = (usize, Option<usize>, Option<usize>);

/// An op-amp's terminal map for the Newton companion: `(element_index, out_mna,
/// inv_mna, noninv_mna)`, each MNA index `None` for ground (the three terminals
/// a/b/c = OUT/IN-/IN+). The same shape as [`MosfetMap`]; aliased so the collection
/// and the `newton_iterate` signature stay readable.
type OpampMap = (usize, Option<usize>, Option<usize>, Option<usize>);

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
fn diode_eval(vd: f64, m: DiodeModel) -> (f64, f64) {
    let e = (vd / m.vth).exp();
    let i = m.is * (e - 1.0);
    let g = (m.is / m.vth) * e;
    if m.vz.is_finite() {
        // Zener: add a second junction facing the other way that turns on near the
        // reverse breakdown voltage. In the variable `vbr = -vd - Vz` it is an
        // ordinary forward exponential (with knee current `ISZ` at `vbr = 0`, i.e.
        // exactly `vd = -Vz`). Its current flows cathode -> anode, so it subtracts
        // from the device current; d(vbr)/d(vd) = -1 makes its conductance add.
        let vbr = -vd - m.vz;
        let ebr = (vbr / ZENER_VTH_BR).exp();
        let i_br = ZENER_ISZ * ebr;
        let g_br = (ZENER_ISZ / ZENER_VTH_BR) * ebr;
        (i - i_br, g + g_br)
    } else {
        (i, g)
    }
}

/// The critical junction voltage used by [`pnjlim`], `vcrit = n*Vt *
/// ln(n*Vt / (sqrt(2)*Is))`. This is the inflection of the exponential where
/// damping the Newton step keeps the iteration well conditioned. Computed once
/// per call from the fixed model constants (a few `f64` ops; `ln` is not `const`,
/// so this is a tiny pure function rather than a constant).
#[inline]
fn diode_vcrit(m: DiodeModel) -> f64 {
    m.vth * (m.vth / (core::f64::consts::SQRT_2 * m.is)).ln()
}

/// pn-junction voltage limiting (the classic SPICE `pnjlim`). Given the proposed
/// new junction voltage `vnew` and the previous-iterate voltage `vold` (both
/// anode -> cathode), return a damped voltage that limits how fast the junction
/// can swing forward, so the diode exponential cannot explode and Newton stays
/// well behaved. Reverse and small-forward steps pass through unchanged; only
/// large forward excursions past `vcrit` are compressed logarithmically. This is
/// a deterministic, pure `f64` function — the heart of the nonlinear robustness.
#[inline]
fn pnjlim(vnew: f64, vold: f64, m: DiodeModel) -> f64 {
    let vcrit = diode_vcrit(m);
    let vth = m.vth;
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

// --- MOSFET (level-1 square-law) device ----------------------------------------

/// The small-signal companion of a level-1 square-law MOSFET, linearised about a
/// control point. `gm = dId/dVgs` (the gate transconductance), `gds = dId/dVds`
/// (the drain-source output conductance), and `id` is the drain current at the
/// point.
#[derive(Clone, Copy)]
struct MosfetOp {
    id: f64,
    gm: f64,
    gds: f64,
}

/// Evaluate the level-1 square-law MOSFET at control voltages `vgs`/`vds`,
/// returning the drain current `Id` and its partials `gm = dId/dVgs`,
/// `gds = dId/dVds`. The current is oriented **drain -> source** (the `a -> b`
/// orientation of an [`ELEM_NMOS`]).
///
/// This is written for the NMOS sign convention (`vov = vgs - VTO`, conduction for
/// `vov > 0`); the PMOS reuses it by negating its terminal voltages on the way in
/// and the resulting current/partials on the way out (see [`Sim::mosfet_control`]
/// and the commit), which keeps a single, well-tested square law for both
/// polarities. Three regions, matched in value and slope at the boundaries:
///
/// - **Cutoff** (`vov <= 0`): the channel is off — `Id = gm = gds = 0`.
/// - **Triode** (`0 < vds < vov`): `Id = KP*(vov*vds - 0.5*vds^2)`, so
///   `gm = KP*vds` and `gds = KP*(vov - vds)`.
/// - **Saturation** (`vds >= vov > 0`): `Id = 0.5*KP*vov^2*(1 + LAMBDA*vds)`, so
///   `gm = KP*vov*(1 + LAMBDA*vds)` and `gds = 0.5*KP*vov^2*LAMBDA`.
///
/// Pure, branch-clean `f64` (the region split is on the control values, which are
/// limited deterministically before the call), so it never costs determinism.
#[inline]
fn mosfet_eval(vgs: f64, vds: f64, kp: f64, vto: f64, lambda: f64) -> MosfetOp {
    let vov = vgs - vto;
    if vov <= 0.0 {
        // Cutoff: no channel.
        MosfetOp {
            id: 0.0,
            gm: 0.0,
            gds: 0.0,
        }
    } else if vds < vov {
        // Triode (linear/ohmic) region.
        let id = kp * (vov * vds - 0.5 * vds * vds);
        let gm = kp * vds;
        let gds = kp * (vov - vds);
        MosfetOp { id, gm, gds }
    } else {
        // Saturation region, with channel-length modulation.
        let id = 0.5 * kp * vov * vov * (1.0 + lambda * vds);
        let gm = kp * vov * (1.0 + lambda * vds);
        let gds = 0.5 * kp * vov * vov * lambda;
        MosfetOp { id, gm, gds }
    }
}

/// MOSFET control-voltage limiting — the square-law analogue of [`pnjlim`]. Clamp
/// the proposed new control voltage `vnew` so it cannot move more than
/// [`MOS_VLIM_DELTA`] from the previous iterate `vold`, keeping Newton from
/// overshooting across the cutoff/triode/saturation corners. Small steps pass
/// through unchanged, so a settled device is unaffected and this never
/// over-iterates. Deterministic, pure `f64`.
#[inline]
fn mosfet_limit(vnew: f64, vold: f64) -> f64 {
    let delta = vnew - vold;
    if delta > MOS_VLIM_DELTA {
        vold + MOS_VLIM_DELTA
    } else if delta < -MOS_VLIM_DELTA {
        vold - MOS_VLIM_DELTA
    } else {
        vnew
    }
}

// --- BJT (Ebers-Moll) device ---------------------------------------------------

/// The small-signal companion of an Ebers-Moll BJT, linearised about its two
/// junction voltages. `ic`/`ib`/`ie` are the terminal currents (into the
/// collector / base / emitter, summing to zero) at the iterate; the four partials
/// are the Jacobian of `(Ic, Ib)` with respect to `(Vbe, Vbc)`:
/// `gpi = dIb/dVbe`, `gmu = dIb/dVbc`, `gif = dIc/dVbe`, and `gic_bc = dIc/dVbc`.
/// They are all expressed in the **NPN** sign convention (the PNP negates the
/// junction voltages and the currents on the way through [`Sim::bjt_op`], which
/// leaves the conductances unchanged by the chain rule, exactly like the MOSFET).
#[derive(Clone, Copy)]
struct BjtOp {
    ic: f64,
    ib: f64,
    ie: f64,
    gpi: f64,
    gmu: f64,
    gif: f64,
    gic_bc: f64,
}

/// The base junctions of a BJT expressed as an ordinary diode junction so the
/// shared [`pnjlim`]/[`diode_vcrit`] limiter can damp each one. The model uses the
/// BJT saturation current and the shared thermal voltage, with no reverse
/// breakdown (`vz = INFINITY`). Pure constant fold.
#[inline]
fn bjt_junction_model() -> DiodeModel {
    DiodeModel {
        is: BJT_IS,
        vth: DIODE_VT,
        vz: f64::INFINITY,
    }
}

/// Evaluate the Ebers-Moll NPN at base-emitter / base-collector junction voltages
/// `vbe`/`vbc` (each expected already limited by [`pnjlim`], so the exponentials
/// are bounded), returning the terminal currents and the small-signal partials in
/// a [`BjtOp`]. With `evbe = exp(vbe/Vt)`, `evbc = exp(vbc/Vt)`:
///
/// - `Ic = Is*[(evbe - evbc) - (evbc - 1)/BR]` (into the collector)
/// - `Ib = Is*[(evbe - 1)/BF + (evbc - 1)/BR]` (into the base)
/// - `Ie = -(Ic + Ib)` (into the emitter)
///
/// and the Jacobian of `(Ic, Ib)` w.r.t. `(Vbe, Vbc)`:
///
/// - `gpi = dIb/dVbe = Is*evbe/(BF*Vt)`
/// - `gmu = dIb/dVbc = Is*evbc/(BR*Vt)`
/// - `gif = dIc/dVbe = Is*evbe/Vt`
/// - `gic_bc = dIc/dVbc = -Is*evbc/Vt*(1 + 1/BR)`
///
/// Pure, branch-free `f64` (the limiting happens before the call), so it never
/// costs determinism.
#[inline]
fn bjt_eval(vbe: f64, vbc: f64, is: f64, vt: f64, bf: f64, br: f64) -> BjtOp {
    let evbe = (vbe / vt).exp();
    let evbc = (vbc / vt).exp();
    let ic = is * ((evbe - evbc) - (evbc - 1.0) / br);
    let ib = is * ((evbe - 1.0) / bf + (evbc - 1.0) / br);
    let ie = -(ic + ib);
    let gpi = is * evbe / (bf * vt);
    let gmu = is * evbc / (br * vt);
    let gif = is * evbe / vt;
    let gic_bc = -is * evbc / vt * (1.0 + 1.0 / br);
    BjtOp {
        ic,
        ib,
        ie,
        gpi,
        gmu,
        gif,
        gic_bc,
    }
}

// --- Varistor (MOV, symmetric clamp) device -----------------------------------

/// One of a varistor's two oppositely-facing breakdown junctions, expressed as an
/// ordinary forward junction (knee current [`MOV_IK`] at its breakdown variable
/// `= 0`, sharpness [`MOV_VTH`]) so the shared [`pnjlim`]/[`diode_vcrit`] limiter can
/// damp it — the symmetric analogue of [`zener_breakdown_model`]. No breakdown of
/// its own (`vz = INFINITY`). Pure constant fold.
#[inline]
fn varistor_breakdown_model() -> DiodeModel {
    DiodeModel {
        is: MOV_IK,
        vth: MOV_VTH,
        vz: f64::INFINITY,
    }
}

/// Evaluate the symmetric varistor (MOV) at terminal voltage `v = V(a) - V(b)` and
/// clamp voltage `vc`, returning `(i, g)` with the device current `i` (oriented
/// `a -> b`) and its small-signal conductance `g = di/dv`.
///
/// The model is two oppositely-facing breakdown exponentials about `0` — the
/// symmetric cousin of the Zener's forward + reverse pair. With the positive
/// breakdown variable `up = v - Vc` and the negative `un = -v - Vc`:
///
/// - `i = MOV_IK * (exp(up/MOV_VTH) - exp(un/MOV_VTH))`
/// - `g = (MOV_IK/MOV_VTH) * (exp(up/MOV_VTH) + exp(un/MOV_VTH))`
///
/// At `v = 0` both terms are `exp(-Vc/MOV_VTH) ≈ 0`, so the leakage is negligible;
/// at `v = +Vc` the first term is exactly `MOV_IK` and the device starts conducting
/// hard, pinning the node near `+Vc`; for `v < -Vc` the second term dominates and it
/// clamps near `-Vc`. The two breakdown variables are expected to already be clamped
/// by [`pnjlim`] (via [`varistor_breakdown_model`]), so the exponentials are bounded
/// and never overflow. Pure, branch-free `f64` for determinism.
#[inline]
fn varistor_eval(v: f64, vc: f64) -> (f64, f64) {
    let up = v - vc;
    let un = -v - vc;
    let ep = (up / MOV_VTH).exp();
    let en = (un / MOV_VTH).exp();
    let i = MOV_IK * (ep - en);
    let g = (MOV_IK / MOV_VTH) * (ep + en);
    (i, g)
}

// --- Op-amp (clamped transconductance) device ---------------------------------

/// Evaluate the op-amp's smooth-clamped target output and its slope at the
/// differential input `vd = V(c) - V(b)` and rail `vsat`, returning
/// `(vtarget, dt)` with the target output voltage
/// `Vtarget = vsat * tanh(OPAMP_GAIN * vd / vsat)` and its derivative
/// `dT = dVtarget/dVd = OPAMP_GAIN * sech^2(OPAMP_GAIN*vd/vsat)`.
///
/// `sech^2 = 1 - tanh^2`, so `dT` is computed from the same `tanh` (`dT =
/// OPAMP_GAIN*(1 - t*t)` with `t = tanh(...)`) — no second transcendental call. For a
/// small `vd` the target is `~OPAMP_GAIN*vd` (the huge open-loop gain) and for a large
/// `|vd|` it saturates at `+/-vsat` with `dT -> 0` (so the companion correctly stops
/// responding once the output is clamped). The `tanh` is bounded in `[-1, 1]`, so both
/// outputs are finite for any input and the stamp can never explode — the heart of the
/// op-amp's Newton robustness. Pure, branch-free `f64` for determinism.
#[inline]
fn opamp_target(vd: f64, vsat: f64) -> (f64, f64) {
    let t = (OPAMP_GAIN * vd / vsat).tanh();
    let vtarget = vsat * t;
    let dt = OPAMP_GAIN * (1.0 - t * t);
    (vtarget, dt)
}

/// Op-amp differential-input limiting — the high-gain analogue of [`pnjlim`] /
/// [`mosfet_limit`]. Clamp the proposed new differential input `vnew = Vd` so it
/// cannot move more than [`OPAMP_VD_LIM_DELTA`] from the previous iterate `vold`,
/// keeping a single Newton step on the stiff 1e5-gain transconductance from
/// overshooting the rail in the linear region (the classic feedback Newton stress
/// case). Small steps pass through unchanged, so a settled device is unaffected and
/// this never over-iterates. Deterministic, pure `f64`.
#[inline]
fn opamp_limit(vnew: f64, vold: f64) -> f64 {
    let delta = vnew - vold;
    if delta > OPAMP_VD_LIM_DELTA {
        vold + OPAMP_VD_LIM_DELTA
    } else if delta < -OPAMP_VD_LIM_DELTA {
        vold - OPAMP_VD_LIM_DELTA
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
    /// (a diode or a MOSFET). Selects the Newton outer loop over the linear fast
    /// path; when `false`, the solve is byte-for-byte the original single-pass
    /// solve.
    has_nonlinear: bool,
    /// Per-node analog/digital classification (length `node_count`), computed at
    /// install from the element list ([`classify_nets`]). Topology metadata for the
    /// separated digital domain (`docs/ui/logic-analog-digital-nets.md` §7); does not
    /// yet affect the solve — pure-digital nets still stamp into the MNA matrix until
    /// the event scheduler lands. Exposed via [`Sim::net_class`].
    net_classes: Vec<NetClass>,

    /// Latest solved node voltages, length `node_count`, index `0` always `0.0`.
    node_v: Vec<f64>,
    /// Dynamic state carried between steps: for a capacitor (`ELEM_CAPACITOR`),
    /// the previous `V(a) - V(b)`; for an inductor (`ELEM_INDUCTOR`), the
    /// previous branch current `i` (oriented `a -> b`); for a transformer
    /// (`ELEM_TRANSFORMER`), the previous **magnetising** current `Im` (a -> b) — the
    /// only winding current that carries reactive memory in the ideal-T model. Unused
    /// for other kinds. One entry per element, indexed in lockstep with `elements`.
    reactive_state: Vec<f64>,
    /// The D flip-flop's stored bit (`0.0` or `1.0`): the value latched at the last
    /// rising clock edge, which drives `Q`/`Q̄` every tick until the next edge. Used
    /// only by [`ELEM_DFF`]; `0.0` for every other element. Persistent sequential
    /// state — deterministic but unhashed (the observable `Q`/`Q̄` voltages carry it
    /// into the snapshot). Indexed in lockstep with `elements`.
    ff_bit: Vec<f64>,
    /// The D flip-flop's previous clock level as a boolean (`0.0` low / `1.0` high),
    /// kept so the commit phase can detect a rising edge (`low -> high`). Used only by
    /// [`ELEM_DFF`]; `0.0` elsewhere. Indexed in lockstep with `elements`.
    ff_clk_high: Vec<f64>,
    /// Per-element junction voltage `V(a) - V(b)` carried for nonlinear devices
    /// (today: diodes). Seeds the Newton iterate and gives [`pnjlim`] its
    /// previous-iterate reference, so each step starts from the converged
    /// junction of the last step. Only the diode entries are meaningful; others
    /// stay `0.0`. Indexed in lockstep with `elements`.
    diode_vd: Vec<f64>,
    /// Per-element MOSFET gate-source control voltage `Vgs` carried as the
    /// previous Newton iterate. Seeds the iterate and gives [`mosfet_limit`] its
    /// reference (the FET analogue of `diode_vd`). Only MOSFET entries are
    /// meaningful; others stay `0.0`. Indexed in lockstep with `elements`.
    mosfet_vgs: Vec<f64>,
    /// Per-element MOSFET drain-source control voltage `Vds`, the companion of
    /// [`Sim::mosfet_vgs`]; same role and indexing.
    mosfet_vds: Vec<f64>,
    /// Per-element BJT base-emitter junction voltage `Vbe = V(c) - V(b)` carried
    /// as the previous Newton iterate. Seeds the iterate and gives [`pnjlim`] its
    /// previous-iterate reference for the base-emitter junction — the two-junction
    /// analogue of [`Sim::diode_vd`]. Only BJT entries are meaningful; others stay
    /// `0.0`. Indexed in lockstep with `elements`.
    bjt_vbe: Vec<f64>,
    /// Per-element BJT base-collector junction voltage `Vbc = V(c) - V(a)`, the
    /// companion of [`Sim::bjt_vbe`] for the second (base-collector) junction; same
    /// role and indexing.
    bjt_vbc: Vec<f64>,
    /// Per-element varistor terminal voltage `V = V(a) - V(b)` carried as the
    /// previous Newton iterate. Seeds the iterate and gives [`pnjlim`] its
    /// previous-iterate reference for **both** symmetric breakdown junctions (the
    /// positive `up = V - Vc` and the negative `un = -V - Vc` are derived from this
    /// single `V`) — the symmetric analogue of [`Sim::diode_vd`]. Only varistor
    /// entries are meaningful; others stay `0.0`. Indexed in lockstep with
    /// `elements`.
    varistor_v: Vec<f64>,
    /// Per-element op-amp differential input `Vd = V(c) - V(b)` carried as the
    /// previous Newton iterate. Seeds the iterate and gives [`opamp_limit`] its
    /// previous-iterate reference (the high-gain analogue of [`Sim::diode_vd`]). Only
    /// op-amp entries are meaningful; others stay `0.0`. Indexed in lockstep with
    /// `elements`.
    opamp_vd: Vec<f64>,
    /// Per-element logic-gate driven output level (volts) for the current tick:
    /// recomputed before each solve from the committed previous-tick input voltages
    /// (see [`gate_target_level`]), then read back when committing the gate's output
    /// current. Pure within-tick scratch — *not* persistent state and never hashed,
    /// so it cannot affect the snapshot. Only gate entries are meaningful; others
    /// stay `0.0`. Indexed in lockstep with `elements`.
    gate_target: Vec<f64>,
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
            net_classes: vec![NetClass::Analog],
            node_v: vec![0.0],
            reactive_state: Vec::new(),
            ff_bit: Vec::new(),
            ff_clk_high: Vec::new(),
            diode_vd: Vec::new(),
            mosfet_vgs: Vec::new(),
            mosfet_vds: Vec::new(),
            bjt_vbe: Vec::new(),
            bjt_vbc: Vec::new(),
            varistor_v: Vec::new(),
            opamp_vd: Vec::new(),
            gate_target: Vec::new(),
            currents: Vec::new(),
        };
        // Demo RC netlist: V(1->ground) -> R -> C -> ground. Nodes: 0 = gnd,
        // 1 = source/R junction, 2 = R/C junction. Two-terminal elements set the
        // unused control terminal c = 0 (ground), where it is ignored.
        let demo = vec![
            Element {
                kind: ELEM_VSOURCE,
                a: 1,
                b: 0,
                c: 0,
                d: 0,
                value: v_source,
                aux: 0.0,
            },
            Element {
                kind: ELEM_RESISTOR,
                a: 1,
                b: 2,
                c: 0,
                d: 0,
                value: 1_000.0,
                aux: 0.0,
            },
            Element {
                kind: ELEM_CAPACITOR,
                a: 2,
                b: 0,
                c: 0,
                d: 0,
                value: 1.0e-6,
                aux: 0.0,
            },
        ];
        sim.install(3, demo);
        sim
    }

    /// Replace the circuit with the given netlist and reset to `t = 0`.
    ///
    /// `types`, `a`, `b`, `c`, `d`, `values`, and `aux` are parallel arrays (one
    /// entry per element). `c` is the **control terminal** (the gate of a MOSFET);
    /// `d` is the **fourth terminal** (the transformer's second secondary node).
    /// For an element that doesn't use them they are ignored, so callers pass `0`
    /// (or any in-range node) there. `aux` is the **second per-element scalar**: the
    /// peak amplitude of an [`ELEM_ACSOURCE`] (`0.0` selects the [`AC_AMPLITUDE`]
    /// default), and ignored — passed `0.0` — by every other element. On any
    /// length mismatch, a node index (`a`, `b`, `c`, or `d`) outside `0..node_count`,
    /// a zero `node_count`, or an unknown element type, the call **fails safe
    /// deterministically**: the simulation is replaced with an empty single-node
    /// (ground-only) circuit and `false` is returned. On success the netlist is
    /// installed, reactive elements start discharged, and `true` is returned.
    /// Never panics.
    // The arity is the wire format: one parallel array per per-element field
    // (types/a/b/c/d/values/aux) plus the node count. Bundling them into a struct
    // would only move the same fields behind a name and obscure the boundary, so
    // the lint is intentionally allowed here.
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
        let n = types.len();
        if a.len() != n
            || b.len() != n
            || c.len() != n
            || d.len() != n
            || values.len() != n
            || aux.len() != n
            || node_count == 0
        {
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
                    | ELEM_SCHOTTKY
                    | ELEM_LED
                    | ELEM_ZENER
                    | ELEM_NMOS
                    | ELEM_PMOS
                    | ELEM_NPN
                    | ELEM_PNP
                    | ELEM_OPAMP
                    | ELEM_VARISTOR
                    | ELEM_GATE
                    | ELEM_TRANSFORMER
                    | ELEM_DFF
            ) {
                self.install_empty();
                return false;
            }
            let na = a[i] as usize;
            let nb = b[i] as usize;
            let nc = c[i] as usize;
            let nd = d[i] as usize;
            // Validate all four terminals. `c`/`d` are ignored at solve time for an
            // element that doesn't use them, but they are still range-checked so a
            // malformed index is rejected fail-safe rather than stored.
            if na >= node_count || nb >= node_count || nc >= node_count || nd >= node_count {
                self.install_empty();
                return false;
            }
            elements.push(Element {
                kind,
                a: na,
                b: nb,
                c: nc,
                d: nd,
                value: values[i],
                aux: aux[i],
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
        // ascending element index, for voltage sources and inductors (one each) and
        // the transformer (TWO consecutive: `branch_index[i]` is the magnetising
        // current `Im` and `branch_index[i] + 1` the secondary current `Is`).
        let node_unknowns = node_count - 1;
        let mut branch_index = vec![usize::MAX; elements.len()];
        let mut next = node_unknowns;
        for (i, e) in elements.iter().enumerate() {
            if e.kind == ELEM_VSOURCE || e.kind == ELEM_ACSOURCE || e.kind == ELEM_INDUCTOR {
                branch_index[i] = next;
                next += 1;
            } else if e.kind == ELEM_TRANSFORMER {
                branch_index[i] = next; // primary branch; secondary is next + 1
                next += 2;
            }
        }

        let has_nonlinear = elements.iter().any(|e| is_nonlinear(e.kind));
        let net_classes = classify_nets(node_count, &elements);

        self.node_count = node_count;
        self.dim = next;
        self.branch_index = branch_index;
        self.has_nonlinear = has_nonlinear;
        self.net_classes = net_classes;
        self.reactive_state = vec![0.0; elements.len()];
        self.ff_bit = vec![0.0; elements.len()];
        self.ff_clk_high = vec![0.0; elements.len()];
        self.diode_vd = vec![0.0; elements.len()];
        self.mosfet_vgs = vec![0.0; elements.len()];
        self.mosfet_vds = vec![0.0; elements.len()];
        self.bjt_vbe = vec![0.0; elements.len()];
        self.bjt_vbc = vec![0.0; elements.len()];
        self.varistor_v = vec![0.0; elements.len()];
        self.opamp_vd = vec![0.0; elements.len()];
        self.gate_target = vec![0.0; elements.len()];
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
        for s in &mut self.ff_bit {
            *s = 0.0;
        }
        for s in &mut self.ff_clk_high {
            *s = 0.0;
        }
        for vd in &mut self.diode_vd {
            *vd = 0.0;
        }
        for v in &mut self.mosfet_vgs {
            *v = 0.0;
        }
        for v in &mut self.mosfet_vds {
            *v = 0.0;
        }
        for v in &mut self.bjt_vbe {
            *v = 0.0;
        }
        for v in &mut self.bjt_vbc {
            *v = 0.0;
        }
        for v in &mut self.varistor_v {
            *v = 0.0;
        }
        for v in &mut self.opamp_vd {
            *v = 0.0;
        }
        for v in &mut self.node_v {
            *v = 0.0;
        }
        self.solve_operating_point();
    }

    /// Stamp a small symmetric [`GMIN`] conductance between two MNA nodes (each
    /// `None` for ground), exactly like a resistor of conductance `GMIN`. Used
    /// across each BJT junction so a reverse-biased or floating junction keeps a
    /// finite, non-singular slope — the multi-terminal analogue of the diode's
    /// `g = gd + GMIN`.
    #[inline]
    fn stamp_gmin(mat: &mut [f64], n: usize, p: Option<usize>, q: Option<usize>) {
        if let Some(r) = p {
            mat[r * n + r] += GMIN;
        }
        if let Some(r) = q {
            mat[r * n + r] += GMIN;
        }
        if let (Some(r), Some(c)) = (p, q) {
            mat[r * n + c] -= GMIN;
            mat[c * n + r] -= GMIN;
        }
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

    /// Linearise a MOSFET (`ELEM_NMOS`/`ELEM_PMOS`) about the **actual** terminal
    /// voltages `vgs = V(c) - V(b)` and `vds = V(a) - V(b)`, returning the drain
    /// current `Id` (oriented `a -> b`) and the partials `gm = dId/dVgs`,
    /// `gds = dId/dVds` in those same actual variables — exactly what the companion
    /// stamp needs, independent of polarity.
    ///
    /// The PMOS reuses the NMOS square law on sign-flipped internal variables
    /// (`vgs_n = -vgs`, `vds_n = -vds`, threshold `-PMOS_VTO`). Because the map is a
    /// pure negation, the chain rule sends the conductances straight back
    /// (`gm = gm_n`, `gds = gds_n`) and only the current flips (`Id = -id_n`), so a
    /// single [`mosfet_eval`] serves both. Pure `f64`, deterministic.
    #[inline]
    fn mosfet_op(kind: u8, vgs: f64, vds: f64) -> MosfetOp {
        if kind == ELEM_PMOS {
            // Evaluate the NMOS square law on the mirrored internal variables.
            let op = mosfet_eval(-vgs, -vds, MOS_KP, -PMOS_VTO, MOS_LAMBDA);
            MosfetOp {
                id: -op.id,
                gm: op.gm,
                gds: op.gds,
            }
        } else {
            mosfet_eval(vgs, vds, MOS_KP, NMOS_VTO, MOS_LAMBDA)
        }
    }

    /// Linearise a BJT (`ELEM_NPN`/`ELEM_PNP`) about the **actual** junction
    /// voltages `vbe = V(c) - V(b)` and `vbc = V(c) - V(a)`, returning the terminal
    /// currents and the small-signal partials in a [`BjtOp`], in those same actual
    /// variables — exactly what the companion stamp needs, independent of polarity.
    ///
    /// The PNP reuses the NPN Ebers-Moll evaluation on sign-flipped junction
    /// voltages (`vbe_n = -vbe`, `vbc_n = -vbc`). Because the map is a pure
    /// negation, the chain rule sends every conductance straight back (each partial
    /// `d(current)/d(voltage)` is invariant under negating both) and only the
    /// currents flip, so a single [`bjt_eval`] serves both polarities — the BJT
    /// analogue of [`Sim::mosfet_op`]. Pure `f64`, deterministic.
    #[inline]
    fn bjt_op(kind: u8, vbe: f64, vbc: f64) -> BjtOp {
        if kind == ELEM_PNP {
            // Evaluate the NPN model on the mirrored internal junction voltages.
            let op = bjt_eval(-vbe, -vbc, BJT_IS, DIODE_VT, BJT_BF, BJT_BR);
            BjtOp {
                ic: -op.ic,
                ib: -op.ib,
                ie: -op.ie,
                gpi: op.gpi,
                gmu: op.gmu,
                gif: op.gif,
                gic_bc: op.gic_bc,
            }
        } else {
            bjt_eval(vbe, vbc, BJT_IS, DIODE_VT, BJT_BF, BJT_BR)
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
                ELEM_GATE => {
                    // Logic gate: a tick-pure boolean driver. Threshold its inputs
                    // from the committed (here, just-initialised) node voltages,
                    // evaluate the boolean, and drive the output toward 0/rail through
                    // GATE_GOUT — a constant conductance to ground plus a current
                    // injection (a Thevenin source). Stored for the current readout.
                    let vt = gate_target_level(e.aux, e.value, self.node_v[e.b], self.node_v[e.c]);
                    self.gate_target[i] = vt;
                    if let Some(r) = ia {
                        mat[r * n + r] += GATE_GOUT;
                        rhs[r] += GATE_GOUT * vt;
                    }
                    // Floor each sensed input to ground with GMIN so a floating gate
                    // input is non-singular (and reads logic low) — the gate stamps
                    // nothing else into its input rows. Negligible beside any driver.
                    if let Some(r) = ib {
                        mat[r * n + r] += GMIN;
                    }
                    if let Some(r) = Self::node_idx(e.c) {
                        mat[r * n + r] += GMIN;
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
                ELEM_TRANSFORMER => {
                    // Both windings prime as current sources carrying their stored
                    // currents (0 at t = 0, so the device starts open).
                    self.stamp_transformer_op(&mut mat, &mut rhs, n, e, i);
                }
                ELEM_DFF => {
                    // Drive Q/Q̄ from the stored bit (constant Thevenin); the bit is
                    // latched in the commit phase, so the stamp is fixed for the solve.
                    self.stamp_dff(&mut mat, &mut rhs, n, e, i);
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
                ELEM_INDUCTOR | ELEM_TRANSFORMER => self.reactive_state[i],
                ELEM_ISOURCE => e.value,
                // Logic-gate output drive current: GATE_GOUT*(Vtarget − V(out)), the
                // current the gate sources out of its output `a` (same output-current
                // convention as the op-amp). Vtarget was committed during assembly.
                ELEM_GATE => GATE_GOUT * (self.gate_target[i] - self.node_v[e.a]),
                // The flip-flop's Q output drive current, from the committed bit.
                ELEM_DFF => {
                    let vq = if self.ff_bit[i] >= 0.5 {
                        e.value.max(0.0)
                    } else {
                        0.0
                    };
                    GATE_GOUT * (vq - self.node_v[e.a])
                }
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
                ELEM_GATE => {
                    // Logic gate: thresholded boolean of the committed previous-tick
                    // inputs drives the output toward 0/rail through GATE_GOUT (a
                    // constant conductance to ground + a current injection). Reading
                    // last tick's inputs makes the stamp constant for this solve and
                    // gives the gate one tick of propagation delay. Stored for readout.
                    let vt = gate_target_level(e.aux, e.value, self.node_v[e.b], self.node_v[e.c]);
                    self.gate_target[i] = vt;
                    if let Some(r) = ia {
                        mat[r * n + r] += GATE_GOUT;
                        rhs[r] += GATE_GOUT * vt;
                    }
                    // Floor each sensed input to ground with GMIN so a floating gate
                    // input is non-singular (and reads logic low) — the gate stamps
                    // nothing else into its input rows. Negligible beside any driver.
                    if let Some(r) = ib {
                        mat[r * n + r] += GMIN;
                    }
                    if let Some(r) = Self::node_idx(e.c) {
                        mat[r * n + r] += GMIN;
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
                ELEM_TRANSFORMER => {
                    // Ideal-T model: magnetising-inductor companion (Im) + a hard
                    // forced secondary differential (Is), n·Is reflected to the primary.
                    self.stamp_transformer(&mut mat, &mut rhs, n, e, i);
                }
                ELEM_DFF => {
                    // Drive Q/Q̄ from the stored bit (constant Thevenin pull).
                    self.stamp_dff(&mut mat, &mut rhs, n, e, i);
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
                ELEM_TRANSFORMER => {
                    // Primary current drawn a -> b is the magnetising current plus the
                    // reflected secondary load: Im + n·Is (branch_index[i] = Im, +1 = Is).
                    let bi = self.branch_index[i];
                    x[bi] + e.value * x[bi + 1]
                }
                ELEM_ISOURCE => e.value,
                // Logic-gate output drive current: GATE_GOUT*(Vtarget − V(out)), the
                // current the gate sources out of its output `a` (same output-current
                // convention as the op-amp). Vtarget was committed during assembly.
                ELEM_GATE => GATE_GOUT * (self.gate_target[i] - self.node_v[e.a]),
                // The flip-flop's Q output drive current, from the committed bit.
                ELEM_DFF => {
                    let vq = if self.ff_bit[i] >= 0.5 {
                        e.value.max(0.0)
                    } else {
                        0.0
                    };
                    GATE_GOUT * (vq - self.node_v[e.a])
                }
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
    /// MOSFETs ride the same loop: the `mosfets` slice lists, in ascending element
    /// order, each device as `(element_index, drain_mna, source_mna, gate_mna)`
    /// with `None` for a grounded terminal. Their control iterate is carried in
    /// `self.mosfet_vgs`/`self.mosfet_vds` and limited by [`mosfet_limit`], the
    /// FET analogue of the junction limiting, so they fold into the same
    /// convergence gates as the diodes.
    ///
    /// BJTs ride it too: the `bjts` slice lists, in ascending element order, each
    /// device as `(element_index, collector_mna, emitter_mna, base_mna)` with
    /// `None` for a grounded terminal. Each carries **two** junction iterates in
    /// `self.bjt_vbe`/`self.bjt_vbc`, both limited by the shared [`pnjlim`] (the
    /// device reuses the diode exponential and limiter), and folds into the same
    /// node-voltage / limiter-inactive convergence gates as the diodes with its own
    /// mA-scale current-residual test alongside the MOSFET's.
    ///
    /// Varistors ride it as well: the `varistors` slice lists, in ascending element
    /// order, each device as `(element_index, a_mna, b_mna)` with `None` for a
    /// grounded terminal — the same two-terminal stamp as a diode. Each carries a
    /// single terminal-voltage iterate in `self.varistor_v` from which **both**
    /// symmetric breakdown junctions are derived (`up = V - Vc`, `un = -V - Vc`),
    /// each limited by the shared [`pnjlim`] and composed back into one consistent
    /// `V` (mirroring the Zener's forward/breakdown composition). It folds into the
    /// same node-voltage / limiter-inactive gates with its own mA-scale
    /// current-residual test alongside the MOSFET's and BJT's.
    ///
    /// Op-amps ride it too: the `opamps` slice lists, in ascending element order, each
    /// device as `(element_index, out_mna, inv_mna, noninv_mna)` with `None` for a
    /// grounded terminal. Each carries a single differential-input iterate in
    /// `self.opamp_vd` (`Vd = V(c) - V(b)`), limited by [`opamp_limit`] (the high-gain
    /// analogue of the junction/FET limiting) so the stiff 1e5-gain device stays
    /// robust in feedback. The companion stamps `Iout = GOUT*(Vtarget - V(a))` into the
    /// output row only (the inputs merely sense), and it folds into the same
    /// node-voltage / limiter-inactive gates with its own mA-scale output-current
    /// residual test alongside the MOSFET's, BJT's, and varistor's.
    ///
    /// Determinism: fixed element/diode/mosfet/bjt/varistor/opamp order, fixed assembly
    /// and solve order, pure `f64`, no hashed iteration. The iteration count is
    /// data-dependent but bounded by [`NEWTON_MAX_ITERS`]; on non-convergence the
    /// last iterate is kept (a defined, finite outcome).
    // One companion-map slice per nonlinear device family (diode/MOSFET/BJT/varistor/
    // opamp) plus the shared linear base; grouping them into a struct would only
    // move the same fields around without clarifying this single private call site.
    #[allow(clippy::too_many_arguments)]
    fn newton_iterate(
        &mut self,
        n: usize,
        base_mat: &[f64],
        base_rhs: &[f64],
        diodes: &[DiodeMap],
        mosfets: &[MosfetMap],
        bjts: &[BjtMap],
        varistors: &[VaristorMap],
        opamps: &[OpampMap],
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
                let el = self.elements[ei];
                let (id, gd) = diode_eval(vd, diode_model(el.kind, el.value));
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

            // Stamp each varistor's companion at its current terminal voltage —
            // the same two-terminal pattern as a diode, since the symmetric clamp
            // also adds no branch unknown. g = di/dv and Ieq = i(v*) - g*v* (plus
            // GMIN for a finite slope below the clamp).
            for &(ei, ia, ib) in varistors {
                let v = self.varistor_v[ei];
                let el = self.elements[ei];
                let vc = el.value.max(MOV_VC_MIN);
                let (iv, gv) = varistor_eval(v, vc);
                let g = gv + GMIN;
                let ieq = iv - g * v;
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

            // Stamp each MOSFET's companion at its current control point. The
            // device is a transconductance `gm` (gate -> channel) and an output
            // conductance `gds` (drain-source) in parallel with an equivalent
            // current `Ieq = Id - gm*Vgs - gds*Vds`. With drain `a`, source `b`,
            // gate `c`, the exact KCL stamps (skipping any grounded terminal) are:
            //   row a(D): +gds at (a,a), +gm at (a,c), -(gm+gds) at (a,b), rhs[a]-=Ieq
            //   row b(S): -gds at (b,a), -gm at (b,c), +(gm+gds) at (b,b), rhs[b]+=Ieq
            //   row c(G): +GMIN at (c,c)  (ideal gate draws no current; keeps it
            //             non-singular, reusing the diode `gmin` floor).
            for &(ei, ia, ib, ic) in mosfets {
                let el = self.elements[ei];
                let vgs = self.mosfet_vgs[ei];
                let vds = self.mosfet_vds[ei];
                let op = Self::mosfet_op(el.kind, vgs, vds);
                let gm = op.gm;
                let gds = op.gds;
                let ieq = op.id - gm * vgs - gds * vds;
                if let Some(r) = ia {
                    mat[r * n + r] += gds;
                    rhs[r] -= ieq;
                    if let Some(cc) = ic {
                        mat[r * n + cc] += gm;
                    }
                    if let Some(bb) = ib {
                        mat[r * n + bb] -= gm + gds;
                    }
                }
                if let Some(r) = ib {
                    mat[r * n + r] += gm + gds;
                    rhs[r] += ieq;
                    if let Some(aa) = ia {
                        mat[r * n + aa] -= gds;
                    }
                    if let Some(cc) = ic {
                        mat[r * n + cc] -= gm;
                    }
                }
                if let Some(r) = ic {
                    mat[r * n + r] += GMIN;
                }
            }

            // Stamp each BJT's Ebers-Moll companion at its two junction voltages.
            // Collector `a`, emitter `b`, base `c`. The control variables are the
            // junction voltages Vbe = V(c) - V(b) and Vbc = V(c) - V(a); the four
            // partials are the Jacobian of (Ic, Ib) w.r.t. (Vbe, Vbc). Writing each
            // terminal current as its linear companion in the node voltages (via the
            // chain rule dVbe = dVc - dVb, dVbc = dVc - dVa) gives this exact 3x3
            // conductance block (rows = terminal KCL, columns = node voltage), with
            // each row summing to zero (a floating BJT injects no net current):
            //   row a(C): (a,a) += -gic_bc, (a,b) += -gif,      (a,c) += gif+gic_bc
            //   row c(B): (c,a) += -gmu,    (c,b) += -gpi,      (c,c) += gpi+gmu
            //   row b(E): (b,a) += gic_bc+gmu, (b,b) += gif+gpi,
            //             (b,c) += -(gif+gic_bc+gpi+gmu)
            // The equivalent currents (the diode/MOSFET pattern Ieq = I(v*) - J*v*)
            // are Ieq_c = Ic - gif*Vbe - gic_bc*Vbc and Ieq_b = Ib - gpi*Vbe -
            // gmu*Vbc, with Ieq_e = -(Ieq_c + Ieq_b); they enter the collector/base/
            // emitter rows so the linearised device reproduces (Ic, Ib, Ie) at the
            // iterate. A GMIN is stamped across the base-emitter and base-collector
            // junctions (the diode `gmin` floor) so an off/floating junction never
            // makes a row singular.
            for &(ei, ia, ib, ic) in bjts {
                let el = self.elements[ei];
                let vbe = self.bjt_vbe[ei];
                let vbc = self.bjt_vbc[ei];
                let op = Self::bjt_op(el.kind, vbe, vbc);
                let (gpi, gmu, gif, gic_bc) = (op.gpi, op.gmu, op.gif, op.gic_bc);
                let ieq_c = op.ic - gif * vbe - gic_bc * vbc;
                let ieq_b = op.ib - gpi * vbe - gmu * vbc;
                let ieq_e = -(ieq_c + ieq_b);
                // Collector row (terminal a): current Ic into the collector.
                if let Some(r) = ia {
                    mat[r * n + r] += -gic_bc;
                    rhs[r] -= ieq_c;
                    if let Some(bb) = ib {
                        mat[r * n + bb] += -gif;
                    }
                    if let Some(cc) = ic {
                        mat[r * n + cc] += gif + gic_bc;
                    }
                }
                // Base row (terminal c): current Ib into the base.
                if let Some(r) = ic {
                    mat[r * n + r] += gpi + gmu;
                    rhs[r] -= ieq_b;
                    if let Some(aa) = ia {
                        mat[r * n + aa] += -gmu;
                    }
                    if let Some(bb) = ib {
                        mat[r * n + bb] += -gpi;
                    }
                }
                // Emitter row (terminal b): current Ie = -(Ic + Ib) into the emitter.
                if let Some(r) = ib {
                    mat[r * n + r] += gif + gpi;
                    rhs[r] -= ieq_e;
                    if let Some(aa) = ia {
                        mat[r * n + aa] += gic_bc + gmu;
                    }
                    if let Some(cc) = ic {
                        mat[r * n + cc] += -(gif + gic_bc + gpi + gmu);
                    }
                }
                // GMIN across each junction (base-emitter, base-collector): a tiny
                // symmetric conductance so a reverse-biased or floating junction
                // keeps a finite, non-singular slope. Reuses the diode `gmin` floor.
                Self::stamp_gmin(&mut mat, n, ic, ib);
                Self::stamp_gmin(&mut mat, n, ic, ia);
            }

            // Stamp each op-amp's companion at its current differential input. With
            // output `a`, inverting input `b`, non-inverting input `c`, the device
            // drives `Iout = GOUT*(Vtarget - V(a))` into the output node, where
            // `Vtarget = Vsat*tanh(GAIN*Vd/Vsat)` and `Vd = V(c) - V(b)`. Linearising
            // `Iout` in the node voltages (with `dT = dVtarget/dVd` from
            // `opamp_target`) gives the partials `dIout/dV(a) = -GOUT`,
            // `dIout/dV(c) = GOUT*dT`, `dIout/dV(b) = -GOUT*dT`, stamped into the
            // **output row only** (the inputs merely sense, drawing no current):
            //   row a(OUT): +GOUT at (a,a), +GOUT*dT at (a,c), -GOUT*dT at (a,b),
            //               rhs[a] -= Ieq
            // with the equivalent injection `Ieq = Iout - (-GOUT)*V(a)
            // - (GOUT*dT)*V(c) - (-GOUT*dT)*V(b) = Iout + GOUT*V(a) - GOUT*dT*Vd`
            // (the c/b terms enter only through `Vd = V(c) - V(b)`). The limited `Vd`
            // iterate (`self.opamp_vd`) and the output node voltage from the previous
            // iterate (`x[a]`) are the linearisation point, exactly as the diode uses
            // its limited junction voltage. A GMIN is stamped at each input so a
            // floating input keeps a finite, non-singular slope (the diode `gmin`
            // floor), and `dT -> 0` in saturation makes the linearisation correctly
            // stop responding once the output is clamped at the rail.
            for &(ei, ia, ib, ic) in opamps {
                let el = self.elements[ei];
                let vsat = el.value.max(OPAMP_VSAT_MIN);
                let vd = self.opamp_vd[ei];
                let va = ia.map(|r| x[r]).unwrap_or(0.0);
                let (vtarget, dt) = opamp_target(vd, vsat);
                let iout = OPAMP_GOUT * (vtarget - va);
                let gdt = OPAMP_GOUT * dt;
                let ieq = iout + OPAMP_GOUT * va - gdt * vd;
                if let Some(r) = ia {
                    // The output current `Iout = GOUT*(Vtarget - Va)` is injected
                    // INTO node a, so its equivalent current adds to `rhs[a]` and its
                    // transconductance terms (∂Iout/∂Vc = +gdt, ∂Iout/∂Vb = -gdt)
                    // stamp with the current-source sign — node a converges to
                    // +Vtarget (not -Vtarget). `mat[a][a] += GOUT` is the output
                    // conductance.
                    mat[r * n + r] += OPAMP_GOUT;
                    rhs[r] += ieq;
                    if let Some(cc) = ic {
                        mat[r * n + cc] -= gdt;
                    }
                    if let Some(bb) = ib {
                        mat[r * n + bb] += gdt;
                    }
                }
                // Ideal inputs draw no current; a GMIN floor keeps each input node
                // non-singular (reuses the diode `gmin`).
                if let Some(r) = ib {
                    mat[r * n + r] += GMIN;
                }
                if let Some(r) = ic {
                    mat[r * n + r] += GMIN;
                }
            }

            x = solve_dense(mat, rhs, n);

            // Update junction voltages with pn-junction limiting, and measure the
            // largest limited junction swing for the residual-style current test.
            let mut max_i_change = 0.0f64;
            // Largest gap between the raw solved junction voltage and the limited
            // one. While `pnjlim` is actively compressing a big forward swing this
            // is large, which means the junction has NOT settled — a high-Vf, tiny
            // Is device (an LED) cold-starts with its node pinned at the rail, so
            // both the node-voltage and the sub-pA current tests can read
            // "converged" while pnjlim is still dragging the junction up. Gating on
            // an inactive limiter closes that false-convergence hole. Reverse and
            // small-forward steps pass through pnjlim unchanged, so the gap is
            // exactly zero at a true operating point and this never over-iterates.
            // The MOSFET limiter feeds the same gap so a still-limiting FET also
            // blocks a premature "converged".
            let mut max_vd_gap = 0.0f64;
            for &(ei, ia, ib) in diodes {
                let va = ia.map(|r| x[r]).unwrap_or(0.0);
                let vb = ib.map(|r| x[r]).unwrap_or(0.0);
                let vd_raw = va - vb;
                let vd_old = self.diode_vd[ei];
                let el = self.elements[ei];
                let m = diode_model(el.kind, el.value);
                let vd_new = if m.vz.is_finite() {
                    // Zener: limit whichever junction is swinging. First the forward
                    // junction (caps large positive vd), then the breakdown junction
                    // — a forward junction in `vbr = -vd - Vz` (caps the deep reverse
                    // swing). When neither limits, both pass through and `vd_new ==
                    // vd_raw`, so non-breakdown operation is unaffected.
                    let vd_f = pnjlim(vd_raw, vd_old, m);
                    let bm = zener_breakdown_model();
                    let vbr_new = pnjlim(-vd_f - m.vz, -vd_old - m.vz, bm);
                    -vbr_new - m.vz
                } else {
                    pnjlim(vd_raw, vd_old, m)
                };
                let gap = (vd_raw - vd_new).abs();
                if gap > max_vd_gap {
                    max_vd_gap = gap;
                }
                // Compare the device current at the old vs the limited-new bias;
                // a converged junction barely moves, so this drives the I-test.
                let (i_old, _) = diode_eval(vd_old, m);
                let (i_new, _) = diode_eval(vd_new, m);
                let di = (i_new - i_old).abs();
                if di > max_i_change {
                    max_i_change = di;
                }
                self.diode_vd[ei] = vd_new;
            }

            // Update each MOSFET's control voltages with the FET step limiter, and
            // fold its limiter gap into the same "limiter inactive" gate as the
            // diodes. The drain-current residual is tracked separately (the diode's
            // sub-pA absolute tolerance does not fit a mA-scale FET current), with
            // its own absolute + relative test below. Vgs = V(c) - V(b),
            // Vds = V(a) - V(b) at the fresh solve.
            let mut converged_mos_i = true;
            for &(ei, ia, ib, ic) in mosfets {
                let va = ia.map(|r| x[r]).unwrap_or(0.0);
                let vb = ib.map(|r| x[r]).unwrap_or(0.0);
                let vc = ic.map(|r| x[r]).unwrap_or(0.0);
                let vgs_raw = vc - vb;
                let vds_raw = va - vb;
                let vgs_old = self.mosfet_vgs[ei];
                let vds_old = self.mosfet_vds[ei];
                let vgs_new = mosfet_limit(vgs_raw, vgs_old);
                let vds_new = mosfet_limit(vds_raw, vds_old);
                let gap = (vgs_raw - vgs_new).abs().max((vds_raw - vds_new).abs());
                if gap > max_vd_gap {
                    max_vd_gap = gap;
                }
                let el = self.elements[ei];
                let i_old = Self::mosfet_op(el.kind, vgs_old, vds_old).id;
                let i_new = Self::mosfet_op(el.kind, vgs_new, vds_new).id;
                let di = (i_new - i_old).abs();
                let tol = NEWTON_I_ABSTOL + NEWTON_RELTOL * i_new.abs().max(i_old.abs());
                if di > tol {
                    converged_mos_i = false;
                }
                self.mosfet_vgs[ei] = vgs_new;
                self.mosfet_vds[ei] = vds_new;
            }

            // Update each BJT's two junction voltages with the shared pn-junction
            // limiter (the device reuses the diode exponential, so it reuses
            // `pnjlim` on each junction), and fold both limiter gaps into the same
            // "limiter inactive" gate as the diodes/FETs. The terminal-current
            // residual is tracked here with the same mA-scale absolute + relative
            // test as the MOSFET (the diode's sub-pA absolute tolerance does not fit
            // a BJT collector current), over both Ic and Ib. Vbe = V(c) - V(b),
            // Vbc = V(c) - V(a) at the fresh solve.
            let mut converged_bjt_i = true;
            for &(ei, ia, ib, ic) in bjts {
                let va = ia.map(|r| x[r]).unwrap_or(0.0);
                let vb = ib.map(|r| x[r]).unwrap_or(0.0);
                let vc = ic.map(|r| x[r]).unwrap_or(0.0);
                let el = self.elements[ei];
                let vbe_old = self.bjt_vbe[ei];
                let vbc_old = self.bjt_vbc[ei];
                // The PNP's junctions are the negated image of the NPN's, so limit on
                // the internal (NPN-convention) variables and map back, exactly as
                // `bjt_op` does for evaluation. This keeps a single proven limiter
                // serving both polarities.
                let sign = if el.kind == ELEM_PNP { -1.0 } else { 1.0 };
                let vbe_raw = sign * (vc - vb);
                let vbc_raw = sign * (vc - va);
                let m = bjt_junction_model();
                let vbe_lim = pnjlim(vbe_raw, sign * vbe_old, m);
                let vbc_lim = pnjlim(vbc_raw, sign * vbc_old, m);
                let vbe_new = sign * vbe_lim;
                let vbc_new = sign * vbc_lim;
                // Limiter-inactive gap, measured on the internal junction variables.
                let gap = (vbe_raw - vbe_lim).abs().max((vbc_raw - vbc_lim).abs());
                if gap > max_vd_gap {
                    max_vd_gap = gap;
                }
                // Terminal-current residual across the limited step (Ic and Ib).
                let op_old = Self::bjt_op(el.kind, vbe_old, vbc_old);
                let op_new = Self::bjt_op(el.kind, vbe_new, vbc_new);
                let dic = (op_new.ic - op_old.ic).abs();
                let dib = (op_new.ib - op_old.ib).abs();
                let tol_c = NEWTON_I_ABSTOL + NEWTON_RELTOL * op_new.ic.abs().max(op_old.ic.abs());
                let tol_b = NEWTON_I_ABSTOL + NEWTON_RELTOL * op_new.ib.abs().max(op_old.ib.abs());
                if dic > tol_c || dib > tol_b {
                    converged_bjt_i = false;
                }
                self.bjt_vbe[ei] = vbe_new;
                self.bjt_vbc[ei] = vbc_new;
            }

            // Update each varistor's terminal voltage by limiting **both** symmetric
            // breakdown junctions with the shared pn-junction limiter, then composing
            // the two limited values into one consistent `V` — the symmetric mirror
            // of the Zener's forward-then-breakdown composition. The positive junction
            // lives in `up = V - Vc` and the negative in `un = -V - Vc`; both are
            // ordinary forward exponentials (knee current MOV_IK), so each rides the
            // proven `pnjlim`. First limit the positive junction (caps a big positive
            // swing) to get `V_p`, then limit the negative junction in `un` from that
            // `V_p` (caps a big negative swing); when neither limiter acts both pass
            // through and `v_new == v_raw`, so sub-clamp operation is unaffected. The
            // limiter-inactive gaps fold into the same `max_vd_gap` gate as the
            // diodes/FETs/BJTs, and the device current is tracked with the same
            // mA-scale absolute + relative residual as the MOSFET (the diode's sub-pA
            // tolerance does not fit a mA-scale clamp current). V = V(a) - V(b) at the
            // fresh solve.
            let mut converged_mov_i = true;
            for &(ei, ia, ib) in varistors {
                let va = ia.map(|r| x[r]).unwrap_or(0.0);
                let vb = ib.map(|r| x[r]).unwrap_or(0.0);
                let v_raw = va - vb;
                let v_old = self.varistor_v[ei];
                let el = self.elements[ei];
                let vc = el.value.max(MOV_VC_MIN);
                let bm = varistor_breakdown_model();
                // Positive breakdown junction: limit up = V - Vc, recover V_p.
                let up_new = pnjlim(v_raw - vc, v_old - vc, bm);
                let v_p = up_new + vc;
                // Negative breakdown junction: limit un = -V - Vc from V_p, recover V.
                let un_new = pnjlim(-v_p - vc, -v_old - vc, bm);
                let v_new = -un_new - vc;
                let gap = (v_raw - v_new).abs();
                if gap > max_vd_gap {
                    max_vd_gap = gap;
                }
                // Device-current residual across the limited step.
                let (i_old, _) = varistor_eval(v_old, vc);
                let (i_new, _) = varistor_eval(v_new, vc);
                let di = (i_new - i_old).abs();
                let tol = NEWTON_I_ABSTOL + NEWTON_RELTOL * i_new.abs().max(i_old.abs());
                if di > tol {
                    converged_mov_i = false;
                }
                self.varistor_v[ei] = v_new;
            }

            // Update each op-amp's differential input `Vd = V(c) - V(b)` with the
            // op-amp step limiter, and fold its limiter gap into the same "limiter
            // inactive" gate as the diodes/FETs/BJTs/varistors. The output-current
            // residual is tracked with the same mA-scale absolute + relative test as
            // the MOSFET (the diode's sub-pA tolerance does not fit a near-1-ohm
            // output drive): the change in the target-driven output current
            // `GOUT*Vtarget(Vd)` across the limited step measures whether the device
            // has settled. The step limiter is what keeps the stiff 1e5-gain linear
            // region from overshooting the rail in a single Newton step (the classic
            // feedback Newton stress case). Vd = V(c) - V(b) at the fresh solve.
            let mut converged_opamp_i = true;
            for &(ei, _ia, ib, ic) in opamps {
                let vb = ib.map(|r| x[r]).unwrap_or(0.0);
                let vc = ic.map(|r| x[r]).unwrap_or(0.0);
                let vd_raw = vc - vb;
                let vd_old = self.opamp_vd[ei];
                let vd_new = opamp_limit(vd_raw, vd_old);
                let gap = (vd_raw - vd_new).abs();
                if gap > max_vd_gap {
                    max_vd_gap = gap;
                }
                let el = self.elements[ei];
                let vsat = el.value.max(OPAMP_VSAT_MIN);
                // The target-driven output current at the old vs the limited-new
                // differential input; a settled op-amp barely moves it.
                let i_old = OPAMP_GOUT * opamp_target(vd_old, vsat).0;
                let i_new = OPAMP_GOUT * opamp_target(vd_new, vsat).0;
                let di = (i_new - i_old).abs();
                let tol = NEWTON_I_ABSTOL + NEWTON_RELTOL * i_new.abs().max(i_old.abs());
                if di > tol {
                    converged_opamp_i = false;
                }
                self.opamp_vd[ei] = vd_new;
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
            // The limiter must be inactive (junctions and FET control voltages
            // settled), not still hauling a cold-started high-Vf device up toward
            // its knee or clamping a big FET swing.
            let converged_limit = max_vd_gap <= NEWTON_V_ABSTOL;

            // Require all the tests, and at least one full iteration, so a stale
            // seed cannot report convergence before a fresh solve. `converged_mov_i`
            // and `converged_opamp_i` are vacuously true with no varistor / no op-amp
            // present, so this gate is unchanged for every diode/MOSFET/BJT netlist
            // (golden untouched).
            if converged_v
                && converged_i
                && converged_mos_i
                && converged_bjt_i
                && converged_mov_i
                && converged_opamp_i
                && converged_limit
            {
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

        // Stamp the fixed linear part once and collect the diode, MOSFET, BJT,
        // varistor, and op-amp maps.
        let mut base_mat = vec![0.0f64; n * n];
        let mut base_rhs = vec![0.0f64; n];
        let mut diodes: Vec<DiodeMap> = Vec::new();
        let mut mosfets: Vec<MosfetMap> = Vec::new();
        let mut bjts: Vec<BjtMap> = Vec::new();
        let mut varistors: Vec<VaristorMap> = Vec::new();
        let mut opamps: Vec<OpampMap> = Vec::new();
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
                ELEM_TRANSFORMER => {
                    // Both windings prime as current sources (0 at t = 0).
                    self.stamp_transformer_op(&mut base_mat, &mut base_rhs, n, e, i);
                }
                ELEM_DFF => {
                    // Drive Q/Q̄ from the stored bit into the fixed Newton base.
                    self.stamp_dff(&mut base_mat, &mut base_rhs, n, e, i);
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
                ELEM_GATE => {
                    // Logic gate: the thresholded boolean of the committed
                    // (here just-initialised) inputs drives the output toward 0/rail
                    // through GATE_GOUT, stamped into the fixed linear base as a
                    // constant conductance to ground + a current injection. Constant
                    // for the whole Newton solve. Stored for the current readout.
                    let vt = gate_target_level(e.aux, e.value, self.node_v[e.b], self.node_v[e.c]);
                    self.gate_target[i] = vt;
                    if let Some(r) = ia {
                        base_mat[r * n + r] += GATE_GOUT;
                        base_rhs[r] += GATE_GOUT * vt;
                    }
                    // Floor each sensed input to ground with GMIN so a floating gate
                    // input is non-singular (and reads logic low) — the gate stamps
                    // nothing else into its input rows. Negligible beside any driver.
                    if let Some(r) = ib {
                        base_mat[r * n + r] += GMIN;
                    }
                    if let Some(r) = Self::node_idx(e.c) {
                        base_mat[r * n + r] += GMIN;
                    }
                }
                ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER => diodes.push((i, ia, ib)),
                ELEM_NMOS | ELEM_PMOS => mosfets.push((i, ia, ib, Self::node_idx(e.c))),
                ELEM_NPN | ELEM_PNP => bjts.push((i, ia, ib, Self::node_idx(e.c))),
                ELEM_VARISTOR => varistors.push((i, ia, ib)),
                ELEM_OPAMP => opamps.push((i, ia, ib, Self::node_idx(e.c))),
                _ => {}
            }
        }

        let x = self.newton_iterate(
            n, &base_mat, &base_rhs, &diodes, &mosfets, &bjts, &varistors, &opamps,
        );

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
                ELEM_INDUCTOR | ELEM_TRANSFORMER => self.reactive_state[i],
                ELEM_ISOURCE => e.value,
                ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER => {
                    diode_eval(self.diode_vd[i], diode_model(e.kind, e.value)).0
                }
                ELEM_NMOS | ELEM_PMOS => {
                    Self::mosfet_op(e.kind, self.mosfet_vgs[i], self.mosfet_vds[i]).id
                }
                // The BJT main current is the collector current Ic, oriented a -> b
                // (collector -> emitter), consistent with the MOSFET's drain current.
                ELEM_NPN | ELEM_PNP => Self::bjt_op(e.kind, self.bjt_vbe[i], self.bjt_vbc[i]).ic,
                // The varistor current is the symmetric clamp current at its committed
                // terminal voltage iterate, oriented a -> b.
                ELEM_VARISTOR => varistor_eval(self.varistor_v[i], e.value.max(MOV_VC_MIN)).0,
                // The op-amp main current is the output drive `Iout = GOUT*(Vtarget -
                // V(a))` sourced into the output node `a`, evaluated at the committed
                // differential-input iterate and the solved output voltage. With the
                // a -> b sign convention this is the current the device pushes out of
                // its `a` terminal toward the rest of the circuit.
                ELEM_OPAMP => {
                    let vsat = e.value.max(OPAMP_VSAT_MIN);
                    let (vtarget, _) = opamp_target(self.opamp_vd[i], vsat);
                    OPAMP_GOUT * (vtarget - self.node_v[e.a])
                }
                // Logic-gate output drive current: GATE_GOUT*(Vtarget − V(out)), the
                // current the gate sources out of its output `a`. Vtarget was
                // committed from the previous-tick inputs during base assembly.
                ELEM_GATE => GATE_GOUT * (self.gate_target[i] - self.node_v[e.a]),
                // The flip-flop's Q output drive current, from the committed bit.
                ELEM_DFF => {
                    let vq = if self.ff_bit[i] >= 0.5 {
                        e.value.max(0.0)
                    } else {
                        0.0
                    };
                    GATE_GOUT * (vq - self.node_v[e.a])
                }
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

        // Stamp the fixed linear part once and collect the diode, MOSFET, BJT,
        // varistor, and op-amp maps.
        let mut base_mat = vec![0.0f64; n * n];
        let mut base_rhs = vec![0.0f64; n];
        let mut diodes: Vec<DiodeMap> = Vec::new();
        let mut mosfets: Vec<MosfetMap> = Vec::new();
        let mut bjts: Vec<BjtMap> = Vec::new();
        let mut varistors: Vec<VaristorMap> = Vec::new();
        let mut opamps: Vec<OpampMap> = Vec::new();
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
                ELEM_TRANSFORMER => {
                    // Ideal-T companion into the fixed linear base (constant across the
                    // Newton loop, like any inductor).
                    self.stamp_transformer(&mut base_mat, &mut base_rhs, n, e, i);
                }
                ELEM_DFF => {
                    // Drive Q/Q̄ from the stored bit into the fixed Newton base.
                    self.stamp_dff(&mut base_mat, &mut base_rhs, n, e, i);
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
                ELEM_GATE => {
                    // Logic gate: the thresholded boolean of the committed
                    // previous-tick inputs drives the output toward 0/rail through
                    // GATE_GOUT, stamped into the fixed linear base as a constant
                    // conductance to ground + a current injection. Reading last
                    // tick's inputs keeps it constant for the Newton solve and gives
                    // one tick of propagation delay. Stored for the current readout.
                    let vt = gate_target_level(e.aux, e.value, self.node_v[e.b], self.node_v[e.c]);
                    self.gate_target[i] = vt;
                    if let Some(r) = ia {
                        base_mat[r * n + r] += GATE_GOUT;
                        base_rhs[r] += GATE_GOUT * vt;
                    }
                    // Floor each sensed input to ground with GMIN so a floating gate
                    // input is non-singular (and reads logic low) — the gate stamps
                    // nothing else into its input rows. Negligible beside any driver.
                    if let Some(r) = ib {
                        base_mat[r * n + r] += GMIN;
                    }
                    if let Some(r) = Self::node_idx(e.c) {
                        base_mat[r * n + r] += GMIN;
                    }
                }
                ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER => diodes.push((i, ia, ib)),
                ELEM_NMOS | ELEM_PMOS => mosfets.push((i, ia, ib, Self::node_idx(e.c))),
                ELEM_NPN | ELEM_PNP => bjts.push((i, ia, ib, Self::node_idx(e.c))),
                ELEM_VARISTOR => varistors.push((i, ia, ib)),
                ELEM_OPAMP => opamps.push((i, ia, ib, Self::node_idx(e.c))),
                _ => {}
            }
        }

        let x = self.newton_iterate(
            n, &base_mat, &base_rhs, &diodes, &mosfets, &bjts, &varistors, &opamps,
        );

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
                ELEM_TRANSFORMER => {
                    // Primary current drawn a -> b is the magnetising current plus the
                    // reflected secondary load: Im + n·Is (branch_index[i] = Im, +1 = Is).
                    let bi = self.branch_index[i];
                    x[bi] + e.value * x[bi + 1]
                }
                ELEM_ISOURCE => e.value,
                ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER => {
                    diode_eval(self.diode_vd[i], diode_model(e.kind, e.value)).0
                }
                ELEM_NMOS | ELEM_PMOS => {
                    Self::mosfet_op(e.kind, self.mosfet_vgs[i], self.mosfet_vds[i]).id
                }
                // The BJT main current is the collector current Ic, oriented a -> b
                // (collector -> emitter), consistent with the MOSFET's drain current.
                ELEM_NPN | ELEM_PNP => Self::bjt_op(e.kind, self.bjt_vbe[i], self.bjt_vbc[i]).ic,
                // The varistor current is the symmetric clamp current at its committed
                // terminal voltage iterate, oriented a -> b.
                ELEM_VARISTOR => varistor_eval(self.varistor_v[i], e.value.max(MOV_VC_MIN)).0,
                // The op-amp output drive Iout = GOUT*(Vtarget − V(a)), at the
                // committed differential iterate and the solved output voltage — the
                // same readout the operating-point path commits. (Without this arm
                // the per-tick op-amp current would fall through to 0 after tick 0.)
                ELEM_OPAMP => {
                    let vsat = e.value.max(OPAMP_VSAT_MIN);
                    let (vtarget, _) = opamp_target(self.opamp_vd[i], vsat);
                    OPAMP_GOUT * (vtarget - self.node_v[e.a])
                }
                // Logic-gate output drive current: GATE_GOUT*(Vtarget − V(out)), the
                // current the gate sources out of its output `a`. Vtarget was
                // committed from the previous-tick inputs during base assembly.
                ELEM_GATE => GATE_GOUT * (self.gate_target[i] - self.node_v[e.a]),
                // The flip-flop's Q output drive current, from the committed bit.
                ELEM_DFF => {
                    let vq = if self.ff_bit[i] >= 0.5 {
                        e.value.max(0.0)
                    } else {
                        0.0
                    };
                    GATE_GOUT * (vq - self.node_v[e.a])
                }
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

    /// Stamp the transformer's ideal-T backward-Euler companion into a **transient**
    /// MNA system (`mat`/`rhs`, dimension `dim`). The element has two branch unknowns —
    /// the magnetising current `Im` (a->b) at `branch_index[i]` and the secondary
    /// current `Is` (c->d) at `branch_index[i] + 1`. The magnetising row is an inductor
    /// companion `V(a)-V(b) = (g_mag+rp)·Im - g_mag·Im_prev`; the secondary row forces
    /// the hard differential `V(c)-V(d) = n·g_mag·(Im - Im_prev) = n·V_Lm`. Only `Im`
    /// carries reactive memory (from `reactive_state`); `Is` is algebraic. A `GMIN`
    /// floor on every terminal keeps a winding that lacks its own ground reference (an
    /// isolated secondary) non-singular without materially loading a referenced one.
    fn stamp_transformer(
        &self,
        mat: &mut [f64],
        rhs: &mut [f64],
        dim: usize,
        e: &Element,
        i: usize,
    ) {
        // Ideal-transformer "T" model (docs/sim/transformer-bridge-convergence.md §6):
        // a magnetising inductance L1 (with primary winding resistance Rp) across the
        // primary, an IDEAL turns-ratio coupling that *forces* the secondary EMF to
        // n·V_Lm — n times the voltage across the magnetiser, a HARD differential
        // exactly like a real voltage source — the secondary winding resistance Rs in
        // series, and the secondary current reflected n·Is back into the primary. The
        // hard ratio is what lets a diode bridge rectify full-wave: a raw coupled-
        // inductor pair is only a SOFT differential (its winding voltage sags under the
        // bridge's asymmetric load) and degenerates to half-wave. Coupling to V_Lm (not
        // the terminal voltage V(a)-V(b)) is what keeps DC blocked — V_Lm -> 0 as the
        // magnetiser saturates. It also drops the near-singular 1/(1-k²) coupled matrix
        // entirely. Two branch unknowns: Im (magnetiser, a→b) and Is (secondary, c→d);
        // only Im carries reactive memory.
        let n = e.value;
        let bi_m = self.branch_index[i]; // magnetising current Im (a -> b)
        let bi_s = bi_m + 1; // secondary current Is (c -> d)
        let g_mag = TRANSFORMER_L1 / DT; // backward-Euler companion of the magnetiser
        let rp = TRANSFORMER_RWIND;
        let im_prev = self.reactive_state[i];
        let ia = Self::node_idx(e.a);
        let ib = Self::node_idx(e.b);
        let ic = Self::node_idx(e.c);
        let id = Self::node_idx(e.d);
        // KCL: the primary draws Im + n·Is (a -> b); the secondary carries Is (c -> d).
        if let Some(r) = ia {
            mat[r * dim + bi_m] += 1.0;
            mat[r * dim + bi_s] += n;
        }
        if let Some(r) = ib {
            mat[r * dim + bi_m] -= 1.0;
            mat[r * dim + bi_s] -= n;
        }
        if let Some(r) = ic {
            mat[r * dim + bi_s] += 1.0;
        }
        if let Some(r) = id {
            mat[r * dim + bi_s] -= 1.0;
        }
        // Magnetising branch row: V(a)-V(b) - (g_mag + rp)·Im = -g_mag·Im_prev.
        if let Some(r) = ia {
            mat[bi_m * dim + r] += 1.0;
        }
        if let Some(r) = ib {
            mat[bi_m * dim + r] -= 1.0;
        }
        mat[bi_m * dim + bi_m] -= g_mag + rp;
        rhs[bi_m] -= g_mag * im_prev;
        // Ideal-transformer secondary row. The secondary EMF tracks the voltage
        // across the MAGNETISING inductance (n·V_Lm), NOT the full primary terminal
        // voltage: that is what lets the device still block DC (as Im saturates,
        // V_Lm -> 0 and the secondary collapses) while passing AC. The differential is
        // forced HARD (no series Is term, exactly like an ideal voltage source) so a
        // diode bridge rectifies full-wave: any series winding resistance here would
        // make V(c)-V(d) sag with Is, and a bridge charging a cap would then latch the
        // wrong diode pair and run away (the cap voltage feeds positive into Is). The
        // primary-side rp still gives the device loss and DC-blocking. Backward-Euler
        // gives the inductor voltage V_Lm = g_mag·(Im - Im_prev), so
        //   V(c) - V(d) = n·g_mag·(Im - Im_prev)
        //   <=>  V(c) - V(d) - n·g_mag·Im = -n·g_mag·Im_prev.
        if let Some(r) = ic {
            mat[bi_s * dim + r] += 1.0;
        }
        if let Some(r) = id {
            mat[bi_s * dim + r] -= 1.0;
        }
        mat[bi_s * dim + bi_m] -= n * g_mag;
        rhs[bi_s] -= n * g_mag * im_prev;
        // Anti-singularity floor on every winding terminal (isolation safety net). The
        // hard forced differential keeps even a floating bridge load stable, so the
        // secondary needs no stronger common-mode reference than the primary — the
        // device stays galvanically isolated.
        for t in [ia, ib, ic, id].into_iter().flatten() {
            mat[t * dim + t] += GMIN;
        }
    }

    /// Stamp the transformer at the **operating point** (`t = 0` / DC priming),
    /// where — exactly like an inductor — the magnetising winding is a current source
    /// carrying its stored current `Im` (`0` at `t = 0`, so the device primes open).
    /// The secondary is algebraic (no reactive memory), so it primes open with just the
    /// `GMIN` floor. `dim` is the operating-point system size; the floor keeps a
    /// floating winding non-singular.
    fn stamp_transformer_op(
        &self,
        mat: &mut [f64],
        rhs: &mut [f64],
        dim: usize,
        e: &Element,
        i: usize,
    ) {
        let im_prev = self.reactive_state[i];
        let ia = Self::node_idx(e.a);
        let ib = Self::node_idx(e.b);
        let ic = Self::node_idx(e.c);
        let id = Self::node_idx(e.d);
        if let Some(r) = ia {
            rhs[r] -= im_prev;
        }
        if let Some(r) = ib {
            rhs[r] += im_prev;
        }
        for t in [ia, ib, ic, id].into_iter().flatten() {
            mat[t * dim + t] += GMIN;
        }
    }

    /// Stamp the D flip-flop into an MNA system (`mat`/`rhs`, dimension `dim`): drive
    /// `Q` (`a`) and `Q̄` (`d`) from the **committed** stored bit through [`GATE_GOUT`]
    /// (the same constant Thevenin pull a logic gate uses), and floor the two
    /// high-impedance inputs `D` (`b`) and `CLK` (`c`) to ground with [`GMIN`] so an
    /// undriven input is non-singular. The bit itself is latched separately in the
    /// commit phase (see [`Sim::step`]), so this stamp is constant for the whole solve
    /// — no Newton work, no branch unknown. `value` is the logic-high rail.
    fn stamp_dff(&self, mat: &mut [f64], rhs: &mut [f64], dim: usize, e: &Element, i: usize) {
        let vhigh = e.value.max(0.0);
        let bit_high = self.ff_bit[i] >= 0.5;
        let vq = if bit_high { vhigh } else { 0.0 };
        let vqb = if bit_high { 0.0 } else { vhigh };
        if let Some(r) = Self::node_idx(e.a) {
            mat[r * dim + r] += GATE_GOUT;
            rhs[r] += GATE_GOUT * vq;
        }
        if let Some(r) = Self::node_idx(e.d) {
            mat[r * dim + r] += GATE_GOUT;
            rhs[r] += GATE_GOUT * vqb;
        }
        if let Some(r) = Self::node_idx(e.b) {
            mat[r * dim + r] += GMIN;
        }
        if let Some(r) = Self::node_idx(e.c) {
            mat[r * dim + r] += GMIN;
        }
    }

    /// The instantaneous EMF of a sinusoidal AC source ([`ELEM_ACSOURCE`]) at the
    /// current tick: `amplitude * sin(2*pi * f * tick * dt)`, where `e.value` is
    /// the frequency `f` in hertz (clamped to `>= 0`) and the peak `amplitude` is
    /// the source's own `e.aux` when it is set (`> 0.0`), else the [`AC_AMPLITUDE`]
    /// default — so a source that supplies no amplitude swings +/- 5 V exactly as
    /// before. This is the right-hand side of the source's voltage constraint
    /// `V(a) - V(b) = emf`, the only difference from a DC source. Pure `f64` and a
    /// deterministic function of the tick (so it reproduces and rewinds with the
    /// tick; at `tick = 0` it is exactly `0`). Recomputed once per solve and
    /// stamped into the fixed linear base, exactly like a DC source's constant
    /// `value`.
    #[inline]
    fn ac_source_emf(&self, e: &Element) -> f64 {
        let amplitude = if e.aux > 0.0 { e.aux } else { AC_AMPLITUDE };
        let f = e.value.max(0.0);
        let phase = core::f64::consts::TAU * f * (self.tick as f64) * DT;
        amplitude * phase.sin()
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
                ELEM_TRANSFORMER => {
                    // Store the new magnetising current Im at branch bi — the only
                    // winding current that carries reactive memory (the companion's
                    // history term). The secondary Is (bi + 1) is algebraic: it is
                    // re-derived each step from the solve, so nothing to store.
                    let bi = self.branch_index[i];
                    self.reactive_state[i] = if bi < x.len() { x[bi] } else { 0.0 };
                }
                ELEM_DFF => {
                    // Edge-triggered latch: on a rising CLK edge (low -> high) sample
                    // D into the stored bit, using the just-solved node voltages
                    // thresholded at half the rail. Otherwise the bit holds.
                    let vth = GATE_VTH_FRAC * e.value.max(0.0);
                    let clk_high = self.node_v[e.c] > vth;
                    let was_high = self.ff_clk_high[i] >= 0.5;
                    if clk_high && !was_high {
                        self.ff_bit[i] = if self.node_v[e.b] > vth { 1.0 } else { 0.0 };
                    }
                    self.ff_clk_high[i] = if clk_high { 1.0 } else { 0.0 };
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
    /// - Varistor (MOV): the symmetric clamp current at its terminal voltage —
    ///   tiny while `|V| < Vc`, large and signed once `|V|` exceeds the clamp.
    /// - Op-amp: the output drive `GOUT * (Vtarget - V(a))` sourced at the output
    ///   `a` (the current the device pushes out toward the rest of the circuit;
    ///   the inputs draw ~0).
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
    /// The analog/digital classification of node `n` as a small code: `0` = analog,
    /// `1` = pure-digital, `2` = boundary (an out-of-range node reads `0` = analog).
    /// Topology metadata for the separated digital domain — exposed for the renderer
    /// to draw digital nets and boundary buffers distinctly. Deterministic, fixed at
    /// install. See `docs/ui/logic-analog-digital-nets.md` §7.
    pub fn net_class(&self, n: usize) -> u8 {
        self.net_classes.get(n).copied().unwrap_or(NetClass::Analog) as u8
    }

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

    /// Build a fresh `Sim`, install a two-terminal netlist, and assert the install
    /// succeeded. The control terminal `c` is all-ground (zeros), since every
    /// element here is two-terminal and ignores it. See [`build3`] for MOSFETs.
    fn build(node_count: usize, types: &[u8], a: &[u32], b: &[u32], values: &[f64]) -> Sim {
        let c = vec![0u32; types.len()];
        let d = vec![0u32; types.len()];
        let aux = vec![0.0f64; types.len()];
        let mut sim = Sim::new(1);
        assert!(
            sim.set_netlist(node_count, types, a, b, &c, &d, values, &aux),
            "valid netlist must install"
        );
        sim
    }

    /// Build a fresh `Sim` from a netlist that includes the third (control)
    /// terminal `c`, for the MOSFET tests. Two-terminal elements in the same
    /// netlist set their `c` entry to `0` (ground), where it is ignored. The fourth
    /// terminal `d` is all-ground here (no transformers); see [`build4`].
    fn build3(
        node_count: usize,
        types: &[u8],
        a: &[u32],
        b: &[u32],
        c: &[u32],
        values: &[f64],
    ) -> Sim {
        let d = vec![0u32; types.len()];
        let aux = vec![0.0f64; types.len()];
        let mut sim = Sim::new(1);
        assert!(
            sim.set_netlist(node_count, types, a, b, c, &d, values, &aux),
            "valid netlist must install"
        );
        sim
    }

    /// Build a fresh `Sim` from a netlist that includes the fourth terminal `d`,
    /// for the transformer tests (primary `a`/`b`, secondary `c`/`d`). Elements that
    /// don't use the extra terminals set their `c`/`d` entries to `0` (ground).
    fn build4(
        node_count: usize,
        types: &[u8],
        a: &[u32],
        b: &[u32],
        c: &[u32],
        d: &[u32],
        values: &[f64],
    ) -> Sim {
        let aux = vec![0.0f64; types.len()];
        let mut sim = Sim::new(1);
        assert!(
            sim.set_netlist(node_count, types, a, b, c, d, values, &aux),
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

    /// Net classification separates the analog and digital domains deterministically
    /// (`docs/ui/logic-analog-digital-nets.md` §7.7): ground and analog-only nodes
    /// read `0`, nodes touched only by digital pins read `1` (pure-digital), and a
    /// node touched by both reads `2` (boundary). It is pure topology metadata and
    /// does not perturb the solve (the goldens above stay bit-identical).
    #[test]
    fn net_classification_separates_domains() {
        // Analog-only RC: every node analog.
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_CAPACITOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[0, 0, 0],
            &[0, 0, 0],
            &[5.0, 1000.0, 1.0e-6],
            &[0.0, 0.0, 0.0],
        ));
        assert_eq!(
            [sim.net_class(0), sim.net_class(1), sim.net_class(2)],
            [0, 0, 0]
        );

        // Gate-only inverter ring (G1: out=1 in=2, G2: out=2 in=1): both internal
        // nodes are pure-digital; ground stays analog.
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            3,
            &[ELEM_GATE, ELEM_GATE],
            &[1, 2],
            &[2, 1],
            &[0, 0],
            &[0, 0],
            &[5.0, 5.0],
            &[6.0, 6.0], // NOT, NOT
        ));
        assert_eq!(
            [sim.net_class(0), sim.net_class(1), sim.net_class(2)],
            [0, 1, 1]
        );

        // Boundary: a buffer's output node is also loaded by a resistor to ground, so
        // it is touched by a digital pin (gate out) and an analog element (resistor).
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            2,
            &[ELEM_GATE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[0, 0],
            &[0, 0],
            &[5.0, 1000.0],
            &[7.0, 0.0], // BUF, (resistor aux unused)
        ));
        assert_eq!([sim.net_class(0), sim.net_class(1)], [0, 2]);
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
        // Mismatched array lengths (`a` has two entries, the rest one).
        let ok = sim.set_netlist(
            2,
            &[ELEM_RESISTOR],
            &[1, 0],
            &[0],
            &[0],
            &[0],
            &[1_000.0],
            &[0.0],
        );
        assert!(!ok, "length mismatch must be rejected");
        assert_eq!(sim.node_voltages().len(), 1, "fell back to ground-only");
        assert_eq!(sim.element_currents().len(), 0, "no elements remain");
        // Mismatched control-array length (`c` too long) is rejected too.
        let ok_c = sim.set_netlist(
            2,
            &[ELEM_RESISTOR],
            &[1],
            &[0],
            &[0, 0],
            &[0],
            &[1_000.0],
            &[0.0],
        );
        assert!(!ok_c, "mismatched c length must be rejected");
        // Mismatched fourth-terminal length (`d` too long) is rejected too.
        let ok_d = sim.set_netlist(
            2,
            &[ELEM_RESISTOR],
            &[1],
            &[0],
            &[0],
            &[0, 0],
            &[1_000.0],
            &[0.0],
        );
        assert!(!ok_d, "mismatched d length must be rejected");
        // Mismatched aux-array length (`aux` too long) is rejected too.
        let ok_aux = sim.set_netlist(
            2,
            &[ELEM_RESISTOR],
            &[1],
            &[0],
            &[0],
            &[0],
            &[1_000.0],
            &[0.0, 0.0],
        );
        assert!(!ok_aux, "mismatched aux length must be rejected");
        // Out-of-range node.
        let ok2 = sim.set_netlist(
            2,
            &[ELEM_RESISTOR],
            &[5],
            &[0],
            &[0],
            &[0],
            &[1_000.0],
            &[0.0],
        );
        assert!(!ok2, "out-of-range node must be rejected");
        // Out-of-range control node (even though a resistor ignores it).
        let ok2c = sim.set_netlist(
            2,
            &[ELEM_RESISTOR],
            &[1],
            &[0],
            &[7],
            &[0],
            &[1_000.0],
            &[0.0],
        );
        assert!(!ok2c, "out-of-range control node must be rejected");
        // Out-of-range fourth terminal (even though a resistor ignores it).
        let ok2d = sim.set_netlist(
            2,
            &[ELEM_RESISTOR],
            &[1],
            &[0],
            &[0],
            &[7],
            &[1_000.0],
            &[0.0],
        );
        assert!(!ok2d, "out-of-range d node must be rejected");
        // Unknown element type.
        let ok3 = sim.set_netlist(2, &[99], &[1], &[0], &[0], &[0], &[1_000.0], &[0.0]);
        assert!(!ok3, "unknown element type must be rejected");
        // Zero node_count.
        let ok4 = sim.set_netlist(0, &[], &[], &[], &[], &[], &[], &[]);
        assert!(!ok4, "zero node_count must be rejected");
        // A subsequent valid netlist still installs fine.
        let ok5 = sim.set_netlist(
            2,
            &[ELEM_VSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[0, 0],
            &[0, 0],
            &[5.0, 1_000.0],
            &[0.0, 0.0],
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

    /// The Schottky model (type 8) conducts the same loop but at a markedly lower
    /// forward drop than the silicon diode — the defining property of the part.
    /// Same layout as the silicon knee test (source 1->0, R 1->2, diode 2->0).
    #[test]
    fn schottky_drops_less_than_silicon() {
        let build_one = |kind: u8| {
            build(
                3,
                &[ELEM_VSOURCE, ELEM_RESISTOR, kind],
                &[1, 1, 2],
                &[0, 2, 0],
                &[5.0, 47.0, 0.0],
            )
            .node_voltages()[2]
        };
        let vd_schottky = build_one(ELEM_SCHOTTKY);
        let vd_silicon = build_one(ELEM_DIODE);
        assert!(
            (0.25..=0.45).contains(&vd_schottky),
            "Schottky sits in its low-knee band: got {vd_schottky}"
        );
        assert!(
            vd_schottky < vd_silicon - 0.2,
            "Schottky drops well below silicon: {vd_schottky} vs {vd_silicon}"
        );
    }

    /// The LED model (type 9) conducts at a high forward drop (~1.8–2 V), well
    /// above silicon. A 150 ohm series resistor lands it near a ~20 mA operating
    /// point. Layout: source 1->0, R 1->2, LED 2->0.
    #[test]
    fn led_drops_more_than_silicon() {
        let build_one = |kind: u8| {
            build(
                3,
                &[ELEM_VSOURCE, ELEM_RESISTOR, kind],
                &[1, 1, 2],
                &[0, 2, 0],
                &[5.0, 150.0, 0.0],
            )
            .node_voltages()[2]
        };
        let vd_led = build_one(ELEM_LED);
        let vd_silicon = build_one(ELEM_DIODE);
        assert!(
            (1.6..=2.1).contains(&vd_led),
            "LED sits in its high-knee band: got {vd_led}"
        );
        assert!(vd_led > vd_silicon + 0.8, "LED drops well above silicon");
        // Forward current is positive (the view turns it into brightness).
        let sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_LED],
            &[1, 1, 2],
            &[0, 2, 0],
            &[5.0, 150.0, 0.0],
        );
        assert!(sim.element_currents()[2] > 0.0, "LED conducts forward");
    }

    /// The whole diode family on the Newton path reproduces bit-for-bit over a
    /// long run — the type-8/9 analogue of `diode_run_is_reproducible`. A source
    /// feeds a Schottky and an LED on parallel branches sharing the rail.
    #[test]
    fn diode_family_run_is_reproducible() {
        let run = || {
            // source 1->0; R 1->2; Schottky 2->0; R 1->3; LED 3->0.
            let mut sim = build(
                4,
                &[
                    ELEM_VSOURCE,
                    ELEM_RESISTOR,
                    ELEM_SCHOTTKY,
                    ELEM_RESISTOR,
                    ELEM_LED,
                ],
                &[1, 1, 2, 1, 3],
                &[0, 2, 0, 3, 0],
                &[5.0, 47.0, 0.0, 150.0, 0.0],
            );
            let mut acc = sim.snapshot_hash();
            for _ in 0..1000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "diode family must reproduce exactly");
    }

    /// A Zener (type 10) in the classic shunt-regulator layout clamps the reverse
    /// node near its breakdown voltage `Vz`, well below the supply. Layout: source
    /// 1->0 (12 V), R 1->2, Zener anode=ground -> cathode=node 2, so node 2 reverse-
    /// biases it; once node 2 reaches ~Vz the breakdown junction conducts the
    /// excess. Vz = 5.1 V.
    #[test]
    fn zener_clamps_reverse_voltage() {
        let vz = 5.1;
        let sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_ZENER],
            &[1, 1, 0], // Zener anode at ground...
            &[0, 2, 2], // ...cathode at node 2
            &[12.0, 1_000.0, vz],
        );
        let v = sim.node_voltages();
        assert!(
            (5.0..=5.35).contains(&v[2]),
            "Zener clamps node near Vz (≈5.1 V): got {}",
            v[2]
        );
        // It actually clamped — node 2 sits far below the 12 V supply.
        assert!(v[2] < 6.0, "clamped well below the rail");
        // The shunt current (R current) flows into the Zener: |I_zener| ≈ I_R, and
        // the Zener current is negative in a->b terms (it conducts cathode->anode).
        let c = sim.element_currents();
        let i_r = (v[1] - v[2]) / 1_000.0;
        assert!(c[2] < 0.0, "Zener sinks the shunt current (reverse)");
        assert!(
            (c[2].abs() - i_r).abs() < 1e-6,
            "KCL: Zener carries the resistor's current ({} vs {})",
            c[2].abs(),
            i_r
        );
        assert!(v.iter().all(|x| x.is_finite()), "finite (Newton converged)");
    }

    /// Forward-biased, a Zener is just a silicon diode — it drops the usual ~0.7 V
    /// knee, *not* its breakdown voltage. Layout: source 1->0, R 1->2, Zener
    /// anode=node 2 -> cathode=ground.
    #[test]
    fn zener_forward_is_an_ordinary_diode() {
        let sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_ZENER],
            &[1, 1, 2],
            &[0, 2, 0],
            &[5.0, 47.0, 5.1], // Vz is irrelevant in forward conduction
        );
        let v = sim.node_voltages();
        assert!(
            (0.6..=0.75).contains(&v[2]),
            "forward Zener drops the silicon knee, not Vz: got {}",
            v[2]
        );
    }

    /// A Zener shunt regulator with a load cap reproduces bit-for-bit over a long
    /// run — guards the breakdown branch + its dual limiting against nondeterminism.
    #[test]
    fn zener_run_is_reproducible() {
        let run = || {
            // source 1->0; R 1->2; Zener anode=gnd->cathode=2; cap 2->0.
            let mut sim = build(
                3,
                &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_ZENER, ELEM_CAPACITOR],
                &[1, 1, 0, 2],
                &[0, 2, 2, 0],
                &[12.0, 1_000.0, 5.1, 1.0e-6],
            );
            let mut acc = sim.snapshot_hash();
            for _ in 0..1000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "Zener regulator must reproduce exactly");
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
            &[0, 0],
            &[0, 0],
            &[5.0, 0.0],
            &[0.0, 0.0],
        );
        assert!(ok, "valid diode netlist installs");
        assert_eq!(sim.element_count(), 2);
        assert_eq!(sim.element_at(1).kind, ELEM_DIODE, "diode stored as type 5");
        // Out-of-range node on a diode is still rejected (fail-safe).
        let bad = sim.set_netlist(2, &[ELEM_DIODE], &[9], &[0], &[0], &[0], &[0.0], &[0.0]);
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

    // --- Nonlinear: varistor (MOV, symmetric clamp) ---------------------------
    //
    // The varistor (type 16) is the symmetric cousin of the Zener: it clamps both
    // polarities, conducting hard once |V| exceeds the clamp voltage Vc. It rides
    // the same deterministic Newton loop (with dual-junction `pnjlim` limiting), so
    // these tests assert the clamped operating point against an independent scalar
    // reference and guard the replay invariant.

    /// The symmetric varistor current at terminal voltage `v` and clamp `vc`,
    /// evaluated independently of the solver from the same closed form
    /// (`MOV_IK*(exp((v-vc)/MOV_VTH) - exp((-v-vc)/MOV_VTH))`), so the core is
    /// checked against the model rather than a fitted constant.
    fn varistor_current_ref(v: f64, vc: f64) -> f64 {
        MOV_IK * (((v - vc) / MOV_VTH).exp() - ((-v - vc) / MOV_VTH).exp())
    }

    /// The implicit-function solution of a varistor in series with a resistor from
    /// a source: the clamp node voltage `V` (across the varistor, cathode at ground)
    /// satisfies `(Vsrc - V)/R = I_mov(V)`. Newton-solve it on the scalar equation to
    /// get an independent reference for the clamped node, so the core's result is
    /// checked against physics. Returns the node voltage `V`.
    fn series_varistor_reference(vsrc: f64, r: f64, vc: f64) -> f64 {
        // f(V) = (Vsrc - V)/R - I_mov(V) = 0. The conductance of I_mov is
        // (MOV_IK/MOV_VTH)*(exp((V-vc)/MOV_VTH) + exp((-V-vc)/MOV_VTH)), so
        // f'(V) = -1/R - g_mov(V). Start from the supply scaled toward the clamp.
        let mut v = vc.copysign(vsrc); // seed near the expected clamp polarity
        for _ in 0..200 {
            let ep = ((v - vc) / MOV_VTH).exp();
            let en = ((-v - vc) / MOV_VTH).exp();
            let i_mov = MOV_IK * (ep - en);
            let g_mov = (MOV_IK / MOV_VTH) * (ep + en);
            let f = (vsrc - v) / r - i_mov;
            let df = -1.0 / r - g_mov;
            v -= f / df;
        }
        v
    }

    /// A varistor clamps a positive surge: a supply well above Vc through a series
    /// resistor pins the varistor node near +Vc (far below the supply), the varistor
    /// sinking the excess. Layout: source 1->0 (12 V), R 1->2, varistor anode=node 2
    /// -> cathode=ground. Vc = 5 V. Hand-checked against the independent scalar
    /// reference to ~1e-6.
    #[test]
    fn varistor_clamps_positive_surge() {
        let vc = 5.0;
        let vsrc = 12.0;
        let r = 100.0;
        let sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_VARISTOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[vsrc, r, vc],
        );
        let v = sim.node_voltages();
        // The node pins near +Vc, well below the 12 V supply.
        assert!(
            (vc..=vc + 0.4).contains(&v[2]),
            "varistor clamps the node near +Vc (≈5 V): got {}",
            v[2]
        );
        assert!(v[2] < vsrc - 5.0, "clamped far below the supply");
        // Hand-check the clamped operating point against the scalar reference.
        let v_ref = series_varistor_reference(vsrc, r, vc);
        assert!(
            (v[2] - v_ref).abs() < 1e-6,
            "clamp node matches the scalar reference: got {}, want {}",
            v[2],
            v_ref
        );
        // The varistor sinks the excess current (positive a -> b, into ground), and
        // KCL holds in the series loop with the resistor.
        let c = sim.element_currents();
        let i_r = (v[1] - v[2]) / r;
        assert!(c[2] > 0.0, "varistor conducts on the positive surge (a->b)");
        assert!(
            (c[2] - i_r).abs() < 1e-6,
            "KCL: varistor carries the resistor's current ({} vs {})",
            c[2],
            i_r
        );
        // The committed current also matches the independent model evaluation.
        assert!(
            (c[2] - varistor_current_ref(v[2], vc)).abs() < 1e-6,
            "committed varistor current matches the scalar model"
        );
        assert!(v.iter().all(|x| x.is_finite()), "finite (Newton converged)");
    }

    /// A varistor clamps a negative surge symmetrically: a supply well below -Vc
    /// through a series resistor pins the varistor node near -Vc. Same layout as the
    /// positive case but a negative supply, exercising the negative breakdown
    /// junction. Hand-checked against the scalar reference.
    #[test]
    fn varistor_clamps_negative_surge() {
        let vc = 5.0;
        let vsrc = -12.0;
        let r = 100.0;
        let sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_VARISTOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[vsrc, r, vc],
        );
        let v = sim.node_voltages();
        // The node pins near -Vc, well above (less negative than) the -12 V supply.
        assert!(
            (-vc - 0.4..=-vc).contains(&v[2]),
            "varistor clamps the node near -Vc (≈-5 V): got {}",
            v[2]
        );
        assert!(v[2] > vsrc + 5.0, "clamped far above the negative supply");
        let v_ref = series_varistor_reference(vsrc, r, vc);
        assert!(
            (v[2] - v_ref).abs() < 1e-6,
            "negative clamp matches the scalar reference: got {}, want {}",
            v[2],
            v_ref
        );
        // The varistor now conducts the other way (negative a -> b current).
        let c = sim.element_currents();
        let i_r = (v[1] - v[2]) / r;
        assert!(c[2] < 0.0, "varistor conducts on the negative surge (b->a)");
        assert!(
            (c[2] - i_r).abs() < 1e-6,
            "KCL: varistor carries the resistor's current ({} vs {})",
            c[2],
            i_r
        );
        assert!(v.iter().all(|x| x.is_finite()), "finite (Newton converged)");
    }

    /// Below the clamp the varistor passes only a tiny leakage and does not pull the
    /// node down: a divider whose midpoint sits well under Vc is essentially
    /// undisturbed (unlike a diode, which would clamp at its knee). Layout: source
    /// 1->0 = 6 V, R1 1->2 = 1k, R2 2->0 = 1k (midpoint 3 V), varistor 2->0 in
    /// parallel with R2. Vc = 18 V (the default), far above 3 V.
    #[test]
    fn varistor_passes_little_below_clamp() {
        let vc = 18.0;
        let sim = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_RESISTOR, ELEM_VARISTOR],
            &[1, 1, 2, 2],
            &[0, 2, 0, 0],
            &[6.0, 1_000.0, 1_000.0, vc],
        );
        let v = sim.node_voltages();
        // The midpoint stays at the undisturbed 3 V divider value: the varistor is
        // effectively open this far below its clamp.
        assert!(
            (v[2] - 3.0).abs() < 1e-3,
            "below Vc the varistor leaves the divider near 3 V: got {}",
            v[2]
        );
        // Its leakage current is negligible (sub-microamp), confirming no clamping.
        let c = sim.element_currents();
        assert!(
            c[3].abs() < 1e-6,
            "varistor leakage below Vc is negligible: got {}",
            c[3]
        );
        // And it matches the independent model evaluation at this bias.
        assert!(
            (c[3] - varistor_current_ref(v[2], vc)).abs() < 1e-9,
            "tiny leakage matches the scalar model"
        );
    }

    /// `set_netlist` accepts the varistor element type (type 16) and marks the
    /// netlist nonlinear (it drives the Newton path — checked indirectly by the
    /// clamp working); a malformed netlist containing a varistor still fails safe
    /// through the same validation as any other element.
    #[test]
    fn varistor_netlist_validates() {
        let mut sim = Sim::new(1);
        // A bare varistor across a source installs fine.
        let ok = sim.set_netlist(
            2,
            &[ELEM_VSOURCE, ELEM_VARISTOR],
            &[1, 1],
            &[0, 0],
            &[0, 0],
            &[0, 0],
            &[5.0, 18.0],
            &[0.0, 0.0],
        );
        assert!(ok, "valid varistor netlist installs");
        assert_eq!(sim.element_count(), 2);
        assert_eq!(
            sim.element_at(1).kind,
            ELEM_VARISTOR,
            "varistor stored as type 16"
        );
        // It engages the nonlinear Newton path: a supply above Vc is clamped (a
        // linear single-pass solve could not produce this), so the device really is
        // marked nonlinear and solved on the Newton loop.
        let clamped = build(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_VARISTOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[12.0, 100.0, 5.0],
        );
        assert!(
            clamped.node_voltages()[2] < 6.0,
            "a varistor netlist is solved nonlinearly (clamps below the rail)"
        );
        // Out-of-range node on a varistor is still rejected (fail-safe).
        let bad = sim.set_netlist(2, &[ELEM_VARISTOR], &[9], &[0], &[0], &[0], &[18.0], &[0.0]);
        assert!(!bad, "out-of-range varistor node rejected");
        assert_eq!(sim.node_voltages().len(), 1, "fell back to ground-only");
    }

    /// Replay invariant for a varistor circuit: the Newton loop (with its symmetric
    /// dual-junction limiting) is deterministic, so a fixed netlist stepped a fixed
    /// number of times reproduces its snapshot-hash stream exactly. This is the
    /// varistor analogue of `zener_run_is_reproducible` and guards the new breakdown
    /// branch + iterate state against nondeterminism.
    #[test]
    fn varistor_run_is_reproducible() {
        let run = || {
            // source 1->0; R 1->2; varistor 2->0; cap 2->0 (a clamped load node).
            let mut sim = build(
                3,
                &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_VARISTOR, ELEM_CAPACITOR],
                &[1, 1, 2, 2],
                &[0, 2, 0, 0],
                &[24.0, 100.0, 12.0, 1.0e-6],
            );
            let mut acc = sim.snapshot_hash();
            for _ in 0..1000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "varistor circuit must reproduce exactly");
    }

    // --- Op-amp (ideal-ish controlled source) ---------------------------------

    /// Unity-gain follower: OUT tied back to IN−, source on IN+. The output
    /// tracks the input to within the finite open-loop gain — and it must
    /// *converge* in this closed loop. Nodes: 0=gnd, 1=Vin, 2=Vout(=IN−);
    /// op-amp a=OUT, b=IN−, c=IN+.
    #[test]
    fn opamp_voltage_follower() {
        for vin in [3.0_f64, -2.5, 7.0] {
            let v = build3(
                3,
                &[ELEM_VSOURCE, ELEM_OPAMP],
                &[1, 2],
                &[0, 2],
                &[0, 1],
                &[vin, 12.0],
            )
            .node_voltages();
            assert!(
                (v[2] - vin).abs() < 1e-3,
                "follower: Vout {} tracks Vin {}",
                v[2],
                vin
            );
        }
    }

    /// Non-inverting amp: gain = 1 + R1/R2 (R1 OUT→IN−, R2 IN−→gnd); R1=R2 → ×2,
    /// the inverting input sits at the virtual Vin, and the output clamps at the
    /// rail when the ideal gain would exceed it. Nodes: 0=gnd,1=Vin,2=Vout,3=IN−.
    #[test]
    fn opamp_noninverting_amp() {
        let make = |vin: f64| {
            build3(
                4,
                &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_RESISTOR, ELEM_OPAMP],
                &[1, 2, 3, 2],
                &[0, 3, 0, 3],
                &[0, 0, 0, 1],
                &[vin, 10_000.0, 10_000.0, 12.0],
            )
        };
        let v = make(2.0).node_voltages();
        assert!((v[2] - 4.0).abs() < 1e-2, "gain 2: Vout {}", v[2]);
        assert!((v[3] - 2.0).abs() < 1e-2, "virtual: IN- {} ~ Vin", v[3]);
        let vs = make(8.0).node_voltages();
        assert!((vs[2] - 12.0).abs() < 0.2, "clamps at +Vsat: {}", vs[2]);
    }

    /// Inverting amp: gain = −Rf/Rin (IN+→gnd, Rin source→IN−, Rf OUT→IN−). With
    /// Rf=Rin the gain is −1. Nodes: 0=gnd,1=Vin,2=Vout,3=IN−.
    #[test]
    fn opamp_inverting_amp() {
        let v = build3(
            4,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_RESISTOR, ELEM_OPAMP],
            &[1, 1, 2, 2],
            &[0, 3, 3, 3],
            &[0, 0, 0, 0],
            &[3.0, 10_000.0, 10_000.0, 12.0],
        )
        .node_voltages();
        assert!((v[2] + 3.0).abs() < 1e-2, "gain -1: Vout {}", v[2]);
    }

    /// Open-loop comparator: the output saturates to ±Vsat following
    /// sign(V+ − V−). Nodes: 0=gnd, 1=V+, 2=Vout; IN− tied to gnd.
    #[test]
    fn opamp_comparator() {
        let out = |vplus: f64| {
            build3(
                3,
                &[ELEM_VSOURCE, ELEM_OPAMP],
                &[1, 2],
                &[0, 0],
                &[0, 1],
                &[vplus, 12.0],
            )
            .node_voltages()[2]
        };
        let (hi, lo) = (out(0.5), out(-0.5));
        assert!((hi - 12.0).abs() < 0.2, "V+>V- saturates high: got {hi}");
        assert!((lo + 12.0).abs() < 0.2, "V+<V- saturates low: got {lo}");
    }

    /// `set_netlist` accepts the op-amp (type 15) and marks the netlist nonlinear;
    /// an out-of-range terminal is rejected fail-safe.
    #[test]
    fn opamp_netlist_validates() {
        let mut sim = Sim::new(1);
        assert!(
            sim.set_netlist(
                3,
                &[ELEM_VSOURCE, ELEM_OPAMP],
                &[1, 2],
                &[0, 2],
                &[0, 1],
                &[0, 0],
                &[3.0, 12.0],
                &[0.0, 0.0],
            ),
            "valid op-amp netlist installs"
        );
        assert!(
            !sim.set_netlist(3, &[ELEM_OPAMP], &[9], &[0], &[1], &[0], &[12.0], &[0.0]),
            "out-of-range op-amp terminal rejected"
        );
    }

    /// A follower reproduces bit-for-bit over a long run.
    #[test]
    fn opamp_run_is_reproducible() {
        let run = || {
            let mut sim = build3(
                3,
                &[ELEM_VSOURCE, ELEM_OPAMP],
                &[1, 2],
                &[0, 2],
                &[0, 1],
                &[3.0, 12.0],
            );
            let mut acc = sim.snapshot_hash();
            for _ in 0..1000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "op-amp circuit must reproduce exactly");
    }

    // --- Logic gate (Tier-A behavioral digital primitive) ---------------------
    //
    // The gate (type 17) is a tick-pure boolean driver: it thresholds its two
    // inputs against half its logic-high rail (`value`) read from the *committed
    // previous-tick* node voltages, evaluates the boolean selected by `aux`
    // (0 AND .. 7 BUF), and drives its output toward 0/rail through GATE_GOUT. It
    // is linear within a solve (one tick of propagation delay), adds no branch
    // unknown, and holds no persistent state of its own — so it never enters the
    // snapshot hash and a gate-only circuit stays on the linear fast path.

    /// Build a single-gate test circuit and run it to steady state, returning the
    /// output node voltage. Layout (nodes 0 = gnd, 1 = inA, 2 = inB, 3 = out):
    /// `V_A(1->0)` and `V_B(2->0)` pin the inputs to 0/5 V; `GATE(out=3, in1=1,
    /// in2=2)` carries the given function `code` (its `aux`) and a 5 V rail; a 1 k
    /// load runs from the output to ground.
    fn gate_out(code: f64, a_hi: bool, b_hi: bool) -> f64 {
        let va = if a_hi { 5.0 } else { 0.0 };
        let vb = if b_hi { 5.0 } else { 0.0 };
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            4,
            &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_GATE, ELEM_RESISTOR],
            &[1, 2, 3, 3],
            &[0, 0, 1, 0],
            &[0, 0, 2, 0],
            &[0, 0, 0, 0],
            &[va, vb, 5.0, 1000.0],
            &[0.0, 0.0, code, 0.0],
        ));
        // The inputs are pinned by ideal sources, so the gate sees them on the very
        // next tick; a few steps let the one-tick-delayed output settle.
        for _ in 0..5 {
            sim.step();
        }
        sim.state()[3]
    }

    /// The LEGACY logic family must reproduce the original idealised gate exactly —
    /// a half-rail input threshold and a rail/ground output through GATE_GOUT. This
    /// guards the family substrate so building real families on top can't silently
    /// move the default the existing goldens depend on.
    #[test]
    fn legacy_family_matches_original_gate() {
        let fam = LogicFamily::LEGACY;
        // Receiver: the half-rail threshold, at any rail.
        assert!(fam.reads_high(3.0, 5.0)); // 3 V > 2.5 V
        assert!(!fam.reads_high(2.0, 5.0)); // 2 V < 2.5 V
        assert!(!fam.reads_high(2.5, 5.0)); // exactly half-rail is not "above"
                                            // Driver: rail high, ground low, both through GATE_GOUT.
        assert_eq!(fam.drive(true, 5.0), (5.0, GATE_GOUT));
        assert_eq!(fam.drive(false, 5.0), (0.0, GATE_GOUT));
        // End to end: gate_target_level still maps to exactly {rail, 0}.
        assert_eq!(gate_target_level(0.0, 5.0, 5.0, 5.0), 5.0); // AND(1,1) = 1
        assert_eq!(gate_target_level(0.0, 5.0, 5.0, 0.0), 0.0); // AND(1,0) = 0
        assert_eq!(gate_target_level(1.0, 5.0, 0.0, 5.0), 5.0); // OR(0,1)  = 1
    }

    #[test]
    fn gate_and_or_truth_tables() {
        // code 0 = AND: high only when both inputs are high.
        assert!(gate_out(0.0, false, false) < 1.0);
        assert!(gate_out(0.0, true, false) < 1.0);
        assert!(gate_out(0.0, false, true) < 1.0);
        assert!(gate_out(0.0, true, true) > 4.0);
        // code 1 = OR: high when either input is high.
        assert!(gate_out(1.0, false, false) < 1.0);
        assert!(gate_out(1.0, true, false) > 4.0);
        assert!(gate_out(1.0, false, true) > 4.0);
        assert!(gate_out(1.0, true, true) > 4.0);
    }

    #[test]
    fn gate_nand_nor_xor_truth_tables() {
        // code 2 = NAND: the inverse of AND.
        assert!(gate_out(2.0, false, false) > 4.0);
        assert!(gate_out(2.0, true, false) > 4.0);
        assert!(gate_out(2.0, true, true) < 1.0);
        // code 3 = NOR: the inverse of OR.
        assert!(gate_out(3.0, false, false) > 4.0);
        assert!(gate_out(3.0, true, false) < 1.0);
        assert!(gate_out(3.0, true, true) < 1.0);
        // code 4 = XOR: high iff the inputs differ.
        assert!(gate_out(4.0, false, false) < 1.0);
        assert!(gate_out(4.0, true, false) > 4.0);
        assert!(gate_out(4.0, false, true) > 4.0);
        assert!(gate_out(4.0, true, true) < 1.0);
    }

    #[test]
    fn gate_not_ignores_second_input() {
        // code 6 = NOT: Y = !inA, inB ignored — so inB must not change the result.
        assert!(gate_out(6.0, false, false) > 4.0);
        assert!(gate_out(6.0, false, true) > 4.0);
        assert!(gate_out(6.0, true, false) < 1.0);
        assert!(gate_out(6.0, true, true) < 1.0);
        // code 7 = BUF: Y = inA, inB ignored.
        assert!(gate_out(7.0, false, true) < 1.0);
        assert!(gate_out(7.0, true, false) > 4.0);
    }

    /// The gate is purely combinational with exactly one tick of propagation delay
    /// (it reads the previous tick's inputs). An AND of two highs reads low at the
    /// t = 0 operating point (the gate saw the initial zeros) and high after one step.
    #[test]
    fn gate_one_tick_propagation_delay() {
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            4,
            &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_GATE, ELEM_RESISTOR],
            &[1, 2, 3, 3],
            &[0, 0, 1, 0],
            &[0, 0, 2, 0],
            &[0, 0, 0, 0],
            &[5.0, 5.0, 5.0, 1000.0],
            &[0.0, 0.0, 0.0, 0.0], // aux = 0 → AND
        ));
        assert!(
            sim.state()[3] < 1.0,
            "output low before the inputs propagate"
        );
        sim.step();
        assert!(sim.state()[3] > 4.0, "output high exactly one tick later");
    }

    /// A gate-only circuit stays on the linear fast path yet reproduces bit-for-bit.
    #[test]
    fn gate_run_is_reproducible() {
        let run = || {
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist(
                4,
                &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_GATE, ELEM_RESISTOR],
                &[1, 2, 3, 3],
                &[0, 0, 1, 0],
                &[0, 0, 2, 0],
                &[0, 0, 0, 0],
                &[5.0, 0.0, 5.0, 1000.0],
                &[0.0, 0.0, 4.0, 0.0], // XOR
            ));
            let mut acc = sim.snapshot_hash();
            for _ in 0..1000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "gate circuit must reproduce exactly");
    }

    /// A gate driving an LED through a series resistor exercises the *Newton*-path
    /// gate stamp (the LED makes the circuit nonlinear). Buffered high the LED
    /// lights; buffered low it is dark.
    #[test]
    fn gate_drives_led_on_newton_path() {
        // nodes: 0 = gnd, 1 = in, 2 = out, 3 = LED anode.
        // V_A(1->0) sets the input; GATE(out=2, in1=1) BUF; R(2->3); LED(3->0).
        let led_current = |a_hi: bool| {
            let va = if a_hi { 5.0 } else { 0.0 };
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist(
                4,
                &[ELEM_VSOURCE, ELEM_GATE, ELEM_RESISTOR, ELEM_LED],
                &[1, 2, 2, 3],
                &[0, 1, 3, 0],
                &[0, 0, 0, 0], // gate in2 unused (BUF)
                &[0, 0, 0, 0],
                &[va, 5.0, 220.0, 0.0],
                &[0.0, 7.0, 0.0, 0.0], // gate aux = 7 = BUF
            ));
            for _ in 0..50 {
                sim.step();
            }
            sim.element_currents()[3].abs()
        };
        assert!(led_current(true) > 1.0e-3, "LED lit when buffered high");
        assert!(led_current(false) < 1.0e-6, "LED dark when buffered low");
    }

    /// A floating gate input is non-singular (GMIN-floored to ground) and reads as
    /// logic low: an OR with its other input high still goes high, an AND goes low,
    /// and every node voltage stays finite (no singular row → no NaN).
    #[test]
    fn gate_floating_input_reads_low() {
        // nodes: 0 = gnd, 1 = inA (driven), 2 = inB (FLOATING), 3 = out.
        // V_A(1->0) = 5 ; GATE(out=3, in1=1, in2=2) ; R(3->0) = 1 k. Node 2 connects
        // to nothing but the gate's sensing input terminal.
        let build = |code: f64| {
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist(
                4,
                &[ELEM_VSOURCE, ELEM_GATE, ELEM_RESISTOR],
                &[1, 3, 3],
                &[0, 1, 0],
                &[0, 2, 0],
                &[0, 0, 0],
                &[5.0, 5.0, 1000.0],
                &[0.0, code, 0.0],
            ));
            for _ in 0..5 {
                sim.step();
            }
            sim.state()
        };
        let or = build(1.0);
        assert!(
            or.iter().all(|v| v.is_finite()),
            "no NaN with a floating input"
        );
        assert!(or[3] > 4.0, "OR(high, floating) reads high");
        let and = build(0.0);
        assert!(
            and[3] < 1.0,
            "AND(high, floating) reads low (a floating input is low)"
        );
    }

    // --- Transformer (ideal-T model, four-terminal) ---------------------------
    //
    // The transformer (type 18) is an ideal-T model: a magnetising inductance
    // across the primary a/b and a secondary c/d whose EMF is forced to n·V_Lm,
    // `value` = turns ratio n. It carries a magnetising branch current and an
    // algebraic secondary current, blocks DC (winding resistance lets the
    // magnetising current saturate, collapsing V_Lm), and scales AC by n. Linear
    // (no Newton), one reactive state (the magnetiser).

    /// Drive the transformer primary with a 1 kHz, 5 V AC source and a near-open
    /// (10 k) secondary referenced to ground, run past the start-up transient, and
    /// return the steady **AC amplitudes** (half the peak-to-peak, which cancels any
    /// magnetizing DC offset) of the primary and secondary node voltages.
    fn transformer_ac_amps(n: f64) -> (f64, f64) {
        let mut sim = Sim::new(1);
        // nodes: 0 = gnd, 1 = primary+ / AC+, 2 = secondary+.
        assert!(sim.set_netlist(
            3,
            &[ELEM_ACSOURCE, ELEM_TRANSFORMER, ELEM_RESISTOR],
            &[1, 1, 2],
            &[0, 0, 0],
            &[0, 2, 0], // transformer c = secondary+
            &[0, 0, 0], // transformer d = secondary- (ground)
            &[1000.0, n, 10_000.0],
            &[5.0, 0.0, 0.0], // AC amplitude 5 V (aux)
        ));
        let (mut p_hi, mut p_lo, mut s_hi, mut s_lo) = (f64::MIN, f64::MAX, f64::MIN, f64::MAX);
        for tk in 0..4000 {
            sim.step();
            if tk >= 1500 {
                let v = sim.state();
                p_hi = p_hi.max(v[1]);
                p_lo = p_lo.min(v[1]);
                s_hi = s_hi.max(v[2]);
                s_lo = s_lo.min(v[2]);
            }
        }
        ((p_hi - p_lo) / 2.0, (s_hi - s_lo) / 2.0)
    }

    /// The secondary AC voltage is the primary's, scaled by the turns ratio n: a
    /// step-up (n = 2) roughly doubles it and a step-down (n = 0.5) roughly halves it.
    #[test]
    fn transformer_scales_ac_by_turns_ratio() {
        let (vp, vs) = transformer_ac_amps(2.0);
        let ratio = vs / vp;
        assert!(
            (ratio - 2.0).abs() < 0.25,
            "step-up x2: secondary/primary = {ratio} (expected ~2)"
        );
        let (vp2, vs2) = transformer_ac_amps(0.5);
        let ratio2 = vs2 / vp2;
        assert!(
            (ratio2 - 0.5).abs() < 0.15,
            "step-down x0.5: secondary/primary = {ratio2} (expected ~0.5)"
        );
    }

    /// A transformer blocks DC: a DC drive on the primary kicks the secondary at the
    /// instant of the step (the inductive transient), but as the primary current
    /// saturates against the winding resistance the secondary voltage decays toward
    /// zero — unlike AC, a steady level does not pass through.
    #[test]
    fn transformer_blocks_dc() {
        // DC 5 V on the primary; n = 2; 10 k on the secondary. (aux all zero → build4.)
        let mut sim = build4(
            3,
            &[ELEM_VSOURCE, ELEM_TRANSFORMER, ELEM_RESISTOR],
            &[1, 1, 2],
            &[0, 0, 0],
            &[0, 2, 0],
            &[0, 0, 0],
            &[5.0, 2.0, 10_000.0],
        );
        let mut vsec_early = 0.0;
        // L/R ~ 0.1 s ~ 50k ticks; run a few time constants so the kick decays.
        for tk in 0..200_000 {
            sim.step();
            if tk == 5_000 {
                vsec_early = sim.state()[2].abs();
            }
        }
        let vsec_late = sim.state()[2].abs();
        assert!(
            vsec_early > 2.0,
            "the secondary is kicked by the DC step transient: {vsec_early}"
        );
        assert!(
            vsec_late < 0.5,
            "the secondary decays toward zero under sustained DC: {vsec_late}"
        );
    }

    /// A four-terminal transformer netlist installs; an out-of-range secondary
    /// terminal `d` is rejected fail-safe.
    #[test]
    fn transformer_netlist_validates() {
        let mut sim = Sim::new(1);
        assert!(
            sim.set_netlist(
                3,
                &[ELEM_TRANSFORMER],
                &[1],
                &[0],
                &[2],
                &[0],
                &[2.0],
                &[0.0]
            ),
            "valid four-terminal transformer installs"
        );
        assert!(
            !sim.set_netlist(
                3,
                &[ELEM_TRANSFORMER],
                &[1],
                &[0],
                &[2],
                &[9],
                &[2.0],
                &[0.0]
            ),
            "out-of-range secondary terminal d is rejected"
        );
    }

    /// A transformer circuit reproduces bit-for-bit over a long run (two coupled
    /// branches and two reactive states stay deterministic).
    #[test]
    fn transformer_run_is_reproducible() {
        let run = || {
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist(
                3,
                &[ELEM_ACSOURCE, ELEM_TRANSFORMER, ELEM_RESISTOR],
                &[1, 1, 2],
                &[0, 0, 0],
                &[0, 2, 0],
                &[0, 0, 0],
                &[1000.0, 2.0, 1000.0],
                &[5.0, 0.0, 0.0],
            ));
            let mut acc = sim.snapshot_hash();
            for _ in 0..2000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "transformer circuit must reproduce exactly");
    }

    /// Build a transformer (turns ratio `n`) feeding a 4-diode full bridge into a
    /// 100 uF / 1 k smoothed load from a 60 Hz AC source of peak `amp`, run ~9 line
    /// cycles (60 Hz -> 8333 ticks/cycle at dt = 2 us) so the output settles, and
    /// return the steady measurements over the last ~1.5 cycles:
    /// `(out_lo, out_hi, sp_span, sn_span, d_peak[4], i_primary_peak)`. Nodes:
    /// 0 = gnd = OUT-, 1 = AC+/primary+, 2 = secondary P, 3 = secondary N, 4 = OUT+.
    /// Bridge: D1 sp->out+, D2 sn->out+, D3 gnd->sp, D4 gnd->sn (elements 2..=5).
    fn bridge_rectifier_run(n: f64, amp: f64) -> (f64, f64, f64, f64, [f64; 4], f64) {
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            5,
            &[
                ELEM_ACSOURCE,
                ELEM_TRANSFORMER,
                ELEM_DIODE,
                ELEM_DIODE,
                ELEM_DIODE,
                ELEM_DIODE,
                ELEM_CAPACITOR,
                ELEM_RESISTOR,
            ],
            &[1, 1, 2, 3, 0, 0, 4, 4], // a
            &[0, 0, 4, 4, 2, 3, 0, 0], // b
            &[0, 2, 0, 0, 0, 0, 0, 0], // c (transformer secondary +)
            &[0, 3, 0, 0, 0, 0, 0, 0], // d (transformer secondary -)
            &[60.0, n, 0.0, 0.0, 0.0, 0.0, 1.0e-4, 1000.0],
            &[amp, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        ));
        let (mut out_hi, mut out_lo) = (f64::MIN, f64::MAX);
        let (mut sp_hi, mut sp_lo) = (f64::MIN, f64::MAX);
        let (mut sn_hi, mut sn_lo) = (f64::MIN, f64::MAX);
        let mut d_peak = [0.0f64; 4]; // peak forward current per diode (elems 2..=5)
        let mut i_primary_peak = 0.0f64;
        for tk in 0..75_000 {
            sim.step();
            if tk >= 62_000 {
                let v = sim.state();
                out_hi = out_hi.max(v[4]);
                out_lo = out_lo.min(v[4]);
                sp_hi = sp_hi.max(v[2]);
                sp_lo = sp_lo.min(v[2]);
                sn_hi = sn_hi.max(v[3]);
                sn_lo = sn_lo.min(v[3]);
                let ic = sim.element_currents();
                for k in 0..4 {
                    d_peak[k] = d_peak[k].max(ic[2 + k]);
                }
                i_primary_peak = i_primary_peak.max(ic[1].abs());
            }
        }
        (
            out_lo,
            out_hi,
            sp_hi - sp_lo,
            sn_hi - sn_lo,
            d_peak,
            i_primary_peak,
        )
    }

    /// A transformer feeding a diode **full bridge** must rectify **full-wave**: all
    /// four diodes conduct (each half-cycle uses a diagonal pair), both secondary
    /// terminals swing symmetrically about the output common-mode, and the smoothed
    /// output settles near `Vsec_peak - 2*Vf` with low ripple. This is the regression
    /// that drove the move from a coupled-inductor model (a soft differential that
    /// sagged to half-wave under the bridge's asymmetric load) to the ideal-T model
    /// (a hard forced ratio). See `docs/sim/transformer-bridge-convergence.md`.
    #[test]
    fn transformer_bridge_rectifies_full_wave() {
        let (out_lo, out_hi, sp_span, sn_span, d_peak, i_primary_peak) =
            bridge_rectifier_run(1.0, 12.0);
        let ripple = out_hi - out_lo;
        // 1) Every diode conducts a real forward current (full bridge, not half-wave).
        for (k, &p) in d_peak.iter().enumerate() {
            assert!(
                p > 1.0e-3,
                "diode D{} barely conducts ({p} A): not full-wave",
                k + 1
            );
        }
        // 2) Both secondary terminals swing through a comparable span (neither is
        //    pinned near a constant level the way the broken soft-differential did).
        assert!(
            sp_span > 5.0 && sn_span > 5.0,
            "a secondary terminal is pinned (sp span {sp_span}, sn span {sn_span})"
        );
        assert!(
            (sp_span - sn_span).abs() < 0.25 * sp_span.max(sn_span),
            "secondary terminals swing asymmetrically (sp {sp_span}, sn {sn_span})"
        );
        // 3) Output is a sensible smoothed DC near Vsec_peak - 2*Vf with low ripple,
        //    and the primary current stays bounded (no DC runaway / inrush blow-up).
        assert!(
            out_lo > 6.0 && out_hi < 12.0,
            "output not a sane rectified DC level (lo {out_lo}, hi {out_hi})"
        );
        assert!(
            ripple < 2.0,
            "output ripple too large for full-wave smoothing: {ripple} V"
        );
        assert!(
            i_primary_peak < 20.0,
            "primary current ran away (peak {i_primary_peak} A)"
        );
    }

    /// Full-wave rectification holds across the **turns ratio**: a step-up (n = 2) and
    /// a step-down (n = 0.5) bridge each still conduct all four diodes, scale the DC
    /// output by `n` (`Vout ~ n*Vsec_pk - 2*Vf`), and stay bounded. These exercise the
    /// `n*g_mag` secondary coupling and the `n*Is` primary reflection — the exact terms
    /// the ideal-T rewrite changed — at ratios away from unity.
    #[test]
    fn transformer_bridge_full_wave_scales_with_ratio() {
        let amp = 12.0;
        for &n in &[2.0_f64, 0.5_f64] {
            let (out_lo, out_hi, sp_span, sn_span, d_peak, i_primary_peak) =
                bridge_rectifier_run(n, amp);
            // All four diodes conduct (full-wave at any ratio).
            for (k, &p) in d_peak.iter().enumerate() {
                assert!(
                    p > 1.0e-4,
                    "n={n}: diode D{} barely conducts ({p} A)",
                    k + 1
                );
            }
            // Neither secondary terminal is pinned; the two swing comparably.
            assert!(
                sp_span > 1.0
                    && sn_span > 1.0
                    && (sp_span - sn_span).abs() < 0.25 * sp_span.max(sn_span),
                "n={n}: secondary terminals pinned/asymmetric (sp {sp_span}, sn {sn_span})"
            );
            // DC output tracks the turns ratio: just under the n-scaled secondary peak,
            // and within ~2*Vf of it (two diode drops).
            let ideal_pk = n * amp;
            assert!(
                out_hi < ideal_pk && out_hi > ideal_pk - 2.0,
                "n={n}: peak DC {out_hi} not near n*Vsec_pk - 2*Vf (~{:.1})",
                ideal_pk - 1.3
            );
            // Ripple stays a small fraction of the output; primary current bounded.
            assert!(
                (out_hi - out_lo) < 0.2 * out_hi,
                "n={n}: ripple too large ({} V)",
                out_hi - out_lo
            );
            assert!(
                i_primary_peak < 20.0,
                "n={n}: primary current ran away (peak {i_primary_peak} A)"
            );
        }
    }

    // --- D flip-flop (edge-triggered one-bit memory) --------------------------
    //
    // The flip-flop (type 19) samples D (b) on each rising edge of CLK (c) into a
    // stored bit that drives Q (a) and Q̄ (d). The tests clock it with a PWM switch
    // (a 0/5 V square wave on a pulled-down node) and read the outputs.

    /// Build a flip-flop clocked by a PWM switch, holding D at the given level, and
    /// run several clock periods; return `[Q, Q̄]`. Nodes: 0 = gnd, 1 = D, 2 = CLK,
    /// 3 = Q, 4 = Q̄, 5 = clock rail. The switch chops the 5 V rail onto the
    /// pulled-down CLK node, so CLK is a clean 0/5 V square wave (rising edges every
    /// SWITCH_PERIOD_TICKS); D is held, so after a few edges Q settles to D.
    fn dff_clocked(d_high: bool) -> [f64; 2] {
        let vd = if d_high { 5.0 } else { 0.0 };
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            6,
            &[
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_SWITCH,
                ELEM_RESISTOR,
                ELEM_DFF
            ],
            &[1, 5, 5, 2, 3],
            &[0, 0, 2, 0, 1],
            &[0, 0, 0, 0, 2], // DFF c = CLK = node 2
            &[0, 0, 0, 0, 4], // DFF d = Q̄ = node 4
            &[vd, 5.0, 0.5, 1000.0, 5.0],
            &[0.0; 5],
        ));
        for _ in 0..500 {
            sim.step();
        }
        let v = sim.state();
        [v[3], v[4]]
    }

    /// With D held, the flip-flop latches it on the clock edges and presents it on Q,
    /// with Q̄ the complement.
    #[test]
    fn dff_latches_d_and_holds() {
        let [q1, qb1] = dff_clocked(true);
        assert!(q1 > 4.0, "Q high when D held high: {q1}");
        assert!(qb1 < 1.0, "Q̄ low when Q is high: {qb1}");
        let [q0, qb0] = dff_clocked(false);
        assert!(q0 < 1.0, "Q low when D held low: {q0}");
        assert!(qb0 > 4.0, "Q̄ high when Q is low: {qb0}");
    }

    /// Wiring Q̄ back to D makes a toggle (T) flip-flop: Q flips on every clock edge,
    /// dividing the clock by two. Over a run Q must take BOTH levels (it isn't stuck).
    #[test]
    fn dff_toggle_divides_the_clock() {
        // nodes: 0 = gnd, 2 = CLK, 3 = Q, 4 = Q̄, 5 = clock rail. D (b) = Q̄ = node 4.
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            6,
            &[ELEM_VSOURCE, ELEM_SWITCH, ELEM_RESISTOR, ELEM_DFF],
            &[5, 5, 2, 3],
            &[0, 2, 0, 4], // DFF b = D = Q̄ (node 4)
            &[0, 0, 0, 2], // DFF c = CLK = node 2
            &[0, 0, 0, 4], // DFF d = Q̄ = node 4
            &[5.0, 0.5, 1000.0, 5.0],
            &[0.0; 4],
        ));
        let mut saw_high = false;
        let mut saw_low = false;
        for _ in 0..1000 {
            sim.step();
            let q = sim.state()[3];
            if q > 4.0 {
                saw_high = true;
            }
            if q < 1.0 {
                saw_low = true;
            }
        }
        assert!(
            saw_high && saw_low,
            "a toggle flip-flop's Q must oscillate (÷2): high={saw_high} low={saw_low}"
        );
    }

    /// A four-terminal flip-flop netlist installs; an out-of-range terminal is
    /// rejected fail-safe.
    #[test]
    fn dff_netlist_validates() {
        let mut sim = Sim::new(1);
        assert!(
            sim.set_netlist(5, &[ELEM_DFF], &[1], &[2], &[3], &[4], &[5.0], &[0.0]),
            "valid four-terminal flip-flop installs"
        );
        assert!(
            !sim.set_netlist(5, &[ELEM_DFF], &[1], &[2], &[3], &[9], &[5.0], &[0.0]),
            "out-of-range Q̄ terminal d is rejected"
        );
    }

    /// A clocked flip-flop circuit (sequential state) reproduces bit-for-bit.
    #[test]
    fn dff_run_is_reproducible() {
        let run = || {
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist(
                6,
                &[ELEM_VSOURCE, ELEM_SWITCH, ELEM_RESISTOR, ELEM_DFF],
                &[5, 5, 2, 3],
                &[0, 2, 0, 4],
                &[0, 0, 0, 2],
                &[0, 0, 0, 4],
                &[5.0, 0.5, 1000.0, 5.0],
                &[0.0; 4],
            ));
            let mut acc = sim.snapshot_hash();
            for _ in 0..1000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "flip-flop circuit must reproduce exactly");
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
            &[0, 0, 0],
            &[0, 0, 0],
            &[5.0, 0.5, 1_000.0],
            &[0.0, 0.0, 0.0],
        );
        assert!(ok, "valid switch netlist installs");
        assert_eq!(sim.element_count(), 3);
        assert_eq!(
            sim.element_at(1).kind,
            ELEM_SWITCH,
            "switch stored as type 6"
        );
        // Out-of-range node on a switch is still rejected (fail-safe).
        let bad = sim.set_netlist(2, &[ELEM_SWITCH], &[9], &[0], &[0], &[0], &[0.5], &[0.0]);
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

    /// The AC source's peak amplitude is tunable per source via the `aux` scalar:
    /// a source with `aux = 12.0` swings the driven node to +/- 12 V, while a
    /// source left at `aux = 0.0` keeps the +/- 5 V [`AC_AMPLITUDE`] default. The
    /// node sits straight across a resistor so it carries the source EMF directly,
    /// so its peak is exactly the source amplitude. This is the only behavioural
    /// difference the second scalar introduces.
    #[test]
    fn ac_source_amplitude_is_tunable_per_source() {
        let f = 500.0; // 1000 ticks per period at dt = 2 us.
        let period_ticks = (1.0 / (f * DT)).round() as u64;
        // Sample the extreme node voltage over one period of an AC source across a
        // resistor, with the given peak `amp` (passed as the source's `aux`).
        let peak_of = |amp: f64| -> (f64, f64) {
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist(
                2,
                &[ELEM_ACSOURCE, ELEM_RESISTOR],
                &[1, 1],
                &[0, 0],
                &[0, 0],
                &[0, 0],
                &[f, 1_000.0],
                &[amp, 0.0],
            ));
            let mut vmax = f64::NEG_INFINITY;
            let mut vmin = f64::INFINITY;
            for _ in 0..period_ticks {
                sim.step();
                let v = sim.node_voltages()[1];
                vmax = vmax.max(v);
                vmin = vmin.min(v);
            }
            (vmax, vmin)
        };
        // aux = 12 -> swings +/- 12 V.
        let (vmax12, vmin12) = peak_of(12.0);
        assert!(
            (vmax12 - 12.0).abs() < 1e-2 && (vmin12 + 12.0).abs() < 1e-2,
            "amplitude 12 swings +/- 12 V: got +{}, {}",
            vmax12,
            vmin12
        );
        // aux = 0 -> the AC_AMPLITUDE default (+/- 5 V), byte-for-byte the old path.
        let (vmax0, vmin0) = peak_of(0.0);
        assert!(
            (vmax0 - AC_AMPLITUDE).abs() < 1e-2 && (vmin0 + AC_AMPLITUDE).abs() < 1e-2,
            "amplitude 0 keeps the +/- 5 V default: got +{}, {}",
            vmax0,
            vmin0
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
            &[0, 0],
            &[0, 0],
            &[1_000.0, 1_000.0],
            &[0.0, 0.0],
        );
        assert!(ok, "valid AC source netlist installs");
        assert_eq!(sim.element_count(), 2);
        assert_eq!(
            sim.element_at(0).kind,
            ELEM_ACSOURCE,
            "AC source stored as type 7"
        );
        // Out-of-range node on an AC source is still rejected (fail-safe).
        let bad = sim.set_netlist(
            2,
            &[ELEM_ACSOURCE],
            &[9],
            &[0],
            &[0],
            &[0],
            &[1_000.0],
            &[0.0],
        );
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

    // --- Three-terminal: NMOS / PMOS + Newton ---------------------------------
    //
    // The level-1 square-law MOSFET (types 11/12) is the first device to use the
    // control terminal `c` (the gate). It drives the same deterministic Newton
    // outer loop as the diode. These tests check the operating point against the
    // square law it implements (so the result is verified against the model, not a
    // fitted constant), the common-source switch/amplifier behavior, the PMOS
    // mirror, validation, and the replay invariant.

    /// Independent reference for an NMOS common-source stage: a drain resistor `rd`
    /// from `vdd` to the drain, source grounded, gate held at `vgs` (so `Vgs` is
    /// fixed). Solve `Vds = vdd - Id(vgs, Vds)*rd` for the drain voltage `Vds` by a
    /// scalar fixed-point/Newton iteration on the *same* square law the core uses
    /// ([`mosfet_eval`]), returning `(Id, Vds)`. This checks the solver against the
    /// model directly.
    fn nmos_cs_reference(vdd: f64, rd: f64, vgs: f64) -> (f64, f64) {
        // f(vds) = vds - vdd + Id(vds)*rd = 0. Id and dId/dVds from mosfet_eval.
        let mut vds = vdd; // start with the no-current drop (cutoff guess)
        for _ in 0..200 {
            let op = mosfet_eval(vgs, vds, MOS_KP, NMOS_VTO, MOS_LAMBDA);
            let f = vds - vdd + op.id * rd;
            let df = 1.0 + op.gds * rd; // d/dVds
            vds -= f / df;
        }
        let op = mosfet_eval(vgs, vds, MOS_KP, NMOS_VTO, MOS_LAMBDA);
        (op.id, vds)
    }

    /// An NMOS common-source stage with the gate held **below** threshold is in
    /// cutoff: it carries no drain current, so the drain resistor drops nothing and
    /// the drain sits at the rail (the "off" state of an NMOS switch / a logic
    /// HIGH). Layout: VDD source 1->0; RD 1->2; NMOS drain=2, source=0, gate=3;
    /// gate source 3->0 = Vgg (< VTO = 2 V).
    #[test]
    fn nmos_cutoff_pulls_drain_to_rail() {
        let vdd = 5.0;
        let rd = 1_000.0;
        let vgg = 1.0; // below VTO -> cutoff
        let sim = build3(
            4,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_NMOS, ELEM_VSOURCE],
            &[1, 1, 2, 3],
            &[0, 2, 0, 0],
            &[0, 0, 3, 0], // only the NMOS reads c (its gate = node 3)
            &[vdd, rd, 0.0, vgg],
        );
        let v = sim.node_voltages();
        // Drain (node 2) sits at the rail: no current, no IR drop.
        assert!(
            (v[2] - vdd).abs() < 1e-6,
            "cutoff NMOS leaves the drain at the rail: got {}",
            v[2]
        );
        // The NMOS (element 2) carries essentially no drain current.
        let c = sim.element_currents();
        assert!(
            c[2].abs() < 1e-9,
            "cutoff NMOS carries no drain current: got {}",
            c[2]
        );
    }

    /// With the gate held **well above** threshold, the NMOS turns hard on and
    /// pulls the drain far below the rail — the "on" state of the switch / a logic
    /// LOW. The drain current is positive (drain -> source) and the resistor and
    /// device currents match (series KCL). Same layout as the cutoff test with a
    /// high gate drive.
    #[test]
    fn nmos_conducts_and_pulls_drain_low() {
        let vdd = 5.0;
        let rd = 1_000.0;
        let vgg = 5.0; // well above VTO -> strong conduction
        let sim = build3(
            4,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_NMOS, ELEM_VSOURCE],
            &[1, 1, 2, 3],
            &[0, 2, 0, 0],
            &[0, 0, 3, 0],
            &[vdd, rd, 0.0, vgg],
        );
        let v = sim.node_voltages();
        assert!(v.iter().all(|x| x.is_finite()), "finite (Newton converged)");
        // The drain is pulled well below the rail (switch closed / logic LOW).
        assert!(
            v[2] < 0.5,
            "conducting NMOS pulls the drain low: got {}",
            v[2]
        );
        let c = sim.element_currents();
        // Drain current is positive (a -> b is drain -> source) and ~ rail/RD.
        assert!(c[2] > 0.0, "conducting NMOS draws drain current");
        // Series loop: the drain resistor (1->2) and the NMOS (2->0) carry the
        // same current (KCL at node 2).
        assert!(
            (c[1] - c[2]).abs() < 1e-9,
            "RD and NMOS carry the same series current: {} vs {}",
            c[1],
            c[2]
        );
    }

    /// The defining quantitative check: a saturated NMOS common-source stage lands
    /// exactly on the square-law operating point, to ~1e-6. The chosen drive keeps
    /// `Vds >= Vov`, so the device is in saturation; the drain voltage and current
    /// both match the independent scalar reference, and the series-loop KCL holds.
    #[test]
    fn nmos_saturation_operating_point_matches_square_law() {
        let vdd = 5.0;
        let rd = 100.0;
        let vgg = 3.0; // Vov = Vgg - VTO = 1.0 V
        let sim = build3(
            4,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_NMOS, ELEM_VSOURCE],
            &[1, 1, 2, 3],
            &[0, 2, 0, 0],
            &[0, 0, 3, 0],
            &[vdd, rd, 0.0, vgg],
        );
        let (id_ref, vds_ref) = nmos_cs_reference(vdd, rd, vgg);
        // Sanity on the reference itself: this operating point is in saturation
        // (Vds >= Vov = 1.0), where the square law and its gds are well defined.
        assert!(
            vds_ref >= (vgg - NMOS_VTO),
            "reference point is in saturation: Vds {} >= Vov {}",
            vds_ref,
            vgg - NMOS_VTO
        );
        let v = sim.node_voltages();
        assert!(
            (v[2] - vds_ref).abs() < 1e-6,
            "drain voltage matches the square law: got {}, want {}",
            v[2],
            vds_ref
        );
        let c = sim.element_currents();
        assert!(
            (c[2] - id_ref).abs() < 1e-6,
            "drain current matches the square law: got {}, want {}",
            c[2],
            id_ref
        );
        // Series-loop KCL: RD current equals the drain current.
        assert!(
            (c[1] - c[2]).abs() < 1e-9,
            "series loop carries one current: {} vs {}",
            c[1],
            c[2]
        );
    }

    /// A saturated common-source stage shows **transconductance**: raising the gate
    /// a little raises the drain current and so lowers the drain voltage (inverting
    /// gain). The measured small-signal gain `dVds/dVgg` has the right sign and is
    /// the textbook `-gm*RD` to good tolerance, confirming the companion's `gm`.
    #[test]
    fn nmos_common_source_amplifies_with_transconductance() {
        let vdd = 5.0;
        let rd = 100.0;
        let vgg0 = 3.0;
        let dv = 1.0e-3; // small gate perturbation
        let drain = |vgg: f64| {
            build3(
                4,
                &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_NMOS, ELEM_VSOURCE],
                &[1, 1, 2, 3],
                &[0, 2, 0, 0],
                &[0, 0, 3, 0],
                &[vdd, rd, 0.0, vgg],
            )
            .node_voltages()[2]
        };
        let vds_lo = drain(vgg0 - dv);
        let vds_hi = drain(vgg0 + dv);
        // Inverting: more gate -> more Id -> lower drain.
        assert!(
            vds_hi < vds_lo,
            "common-source inverts: higher gate -> lower drain ({} !< {})",
            vds_hi,
            vds_lo
        );
        let gain = (vds_hi - vds_lo) / (2.0 * dv);
        // Square-law gm at the bias: in saturation gm = KP*Vov*(1+LAMBDA*Vds).
        let (_, vds0) = nmos_cs_reference(vdd, rd, vgg0);
        let vov = vgg0 - NMOS_VTO;
        let gm = MOS_KP * vov * (1.0 + MOS_LAMBDA * vds0);
        // Small-signal gain of a common-source stage with finite ro = 1/gds:
        // Av = -gm * (RD || ro). Compare to the measured slope.
        let gds = 0.5 * MOS_KP * vov * vov * MOS_LAMBDA;
        let ro = 1.0 / gds;
        let r_eff = rd * ro / (rd + ro);
        let gain_expected = -gm * r_eff;
        assert!(
            (gain - gain_expected).abs() < 1e-3 * gain_expected.abs().max(1.0),
            "small-signal gain ~ -gm*(RD||ro): got {}, want {}",
            gain,
            gain_expected
        );
    }

    /// The PMOS is the high-side mirror of the NMOS. Wired drain `a` = node 2
    /// (output), source `b` = node 1 (rail), gate `c` = node 3. With the gate at
    /// the rail (`Vgs = V(3) - V(1) = 0`, above the negative threshold) it is
    /// **off** — the pull-down resistor holds the drain near ground. Pulling the
    /// gate to ground (`Vgs = -VDD`, below `PMOS_VTO`) turns it **on**, sourcing
    /// current from the rail and pulling the drain high. Layout: VDD source 1->0;
    /// PMOS drain=2 source=1 gate=3; RD (pull-down) 2->0; gate source 3->0 = Vgg.
    #[test]
    fn pmos_high_side_switch_off_and_on() {
        let vdd = 5.0;
        let rd = 1_000.0;
        let build_pmos = |vgg: f64| {
            build3(
                4,
                &[ELEM_VSOURCE, ELEM_PMOS, ELEM_RESISTOR, ELEM_VSOURCE],
                &[1, 2, 2, 3], // PMOS a = drain = node 2
                &[0, 1, 0, 0], // PMOS b = source = node 1 (rail)
                &[0, 3, 0, 0], // PMOS c = gate = node 3
                &[vdd, 0.0, rd, vgg],
            )
        };
        // Gate at the rail: Vgs = V(gate) - V(source) = 5 - 5 = 0 > VTO(-2) -> off.
        let off = build_pmos(vdd);
        let voff = off.node_voltages();
        assert!(voff.iter().all(|x| x.is_finite()), "off state finite");
        assert!(
            voff[2].abs() < 0.5,
            "PMOS off: pull-down holds the drain near ground, got {}",
            voff[2]
        );
        assert!(
            off.element_currents()[1].abs() < 1e-6,
            "PMOS off carries ~no current: got {}",
            off.element_currents()[1]
        );
        // Gate at ground: Vgs = 0 - 5 = -5 < VTO(-2) -> on, drain pulled up.
        let on = build_pmos(0.0);
        let von = on.node_voltages();
        assert!(von.iter().all(|x| x.is_finite()), "on state finite");
        assert!(
            von[2] > 2.0,
            "PMOS on: sources from the rail and pulls the drain high, got {}",
            von[2]
        );
        // The PMOS drain current flows source -> drain, i.e. *into* the drain (`a`)
        // from outside, which is negative in the a -> b convention.
        let c = on.element_currents();
        assert!(
            c[1] < 0.0,
            "PMOS sources current into the drain (negative a->b)"
        );
        // KCL at the drain (node 2): the PMOS delivers current there and the
        // pull-down (2->0) carries it to ground, so their magnitudes match. The
        // PMOS current a->b leaves node 2 (its `a`) as a negative number, the
        // resistor a->b leaves node 2 as a positive number; they sum to ~0.
        assert!(
            (c[1] + c[2]).abs() < 1e-9,
            "drain KCL: PMOS and pull-down balance: {} vs {}",
            c[1],
            c[2]
        );
    }

    /// `set_netlist` accepts the MOSFET element types (11 and 12), stores the
    /// control node, and marks the netlist nonlinear (so the Newton path runs). A
    /// malformed netlist that contains a MOSFET — including an out-of-range control
    /// node — still fails safe through the same validation.
    #[test]
    fn mosfet_netlist_validates() {
        let mut sim = Sim::new(1);
        // A valid NMOS common-source stage installs and stores the gate node.
        let ok = sim.set_netlist(
            4,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_NMOS, ELEM_VSOURCE],
            &[1, 1, 2, 3],
            &[0, 2, 0, 0],
            &[0, 0, 3, 0],
            &[0, 0, 0, 0],
            &[5.0, 1_000.0, 0.0, 3.0],
            &[0.0, 0.0, 0.0, 0.0],
        );
        assert!(ok, "valid NMOS netlist installs");
        assert_eq!(sim.element_count(), 4);
        let nmos = sim.element_at(2);
        assert_eq!(nmos.kind, ELEM_NMOS, "NMOS stored as type 11");
        assert_eq!(nmos.c, 3, "the NMOS gate node (c) is stored");
        // A PMOS installs too, as type 12 (drain=2, source=1, gate=3).
        let okp = sim.set_netlist(
            4,
            &[ELEM_VSOURCE, ELEM_PMOS, ELEM_RESISTOR, ELEM_VSOURCE],
            &[1, 2, 2, 3],
            &[0, 1, 0, 0],
            &[0, 3, 0, 0],
            &[0, 0, 0, 0],
            &[5.0, 0.0, 1_000.0, 0.0],
            &[0.0, 0.0, 0.0, 0.0],
        );
        assert!(okp, "valid PMOS netlist installs");
        assert_eq!(sim.element_at(1).kind, ELEM_PMOS, "PMOS stored as type 12");
        assert_eq!(sim.element_at(1).c, 3, "the PMOS gate node (c) is stored");
        // Out-of-range control (gate) node is rejected fail-safe.
        let bad = sim.set_netlist(
            3,
            &[ELEM_NMOS],
            &[2],
            &[0],
            &[9],
            &[0], // gate node 9 out of range for node_count 3
            &[0.0],
            &[0.0],
        );
        assert!(!bad, "out-of-range MOSFET gate node rejected");
        assert_eq!(sim.node_voltages().len(), 1, "fell back to ground-only");
        // Out-of-range drain node is rejected too.
        let bad2 = sim.set_netlist(3, &[ELEM_NMOS], &[9], &[0], &[1], &[0], &[0.0], &[0.0]);
        assert!(!bad2, "out-of-range MOSFET drain node rejected");
    }

    /// Replay invariant for an NMOS circuit: the Newton loop (with the FET
    /// companion and step limiter) is deterministic, so a fixed netlist stepped a
    /// fixed number of times reproduces its snapshot-hash stream exactly. The
    /// NMOS analogue of `diode_run_is_reproducible`.
    #[test]
    fn nmos_run_is_reproducible() {
        let run = || {
            // A common-source NMOS switching a drain-resistor + load-cap node: VDD
            // source 1->0; RD 1->2; NMOS drain=2 source=0 gate=3; gate source
            // 3->0; load cap 2->0. The Newton loop runs inside every step.
            let mut sim = build3(
                4,
                &[
                    ELEM_VSOURCE,
                    ELEM_RESISTOR,
                    ELEM_NMOS,
                    ELEM_VSOURCE,
                    ELEM_CAPACITOR,
                ],
                &[1, 1, 2, 3, 2],
                &[0, 2, 0, 0, 0],
                &[0, 0, 3, 0, 0],
                &[5.0, 1_000.0, 0.0, 3.0, 1.0e-9],
            );
            let mut acc = sim.snapshot_hash();
            for _ in 0..1000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "NMOS circuit must reproduce exactly");
    }

    /// Both MOSFET polarities on the Newton path reproduce bit-for-bit over a long
    /// run — the NMOS + PMOS analogue of `diode_family_run_is_reproducible`. A CMOS
    /// inverter-style pair (PMOS high-side + NMOS low-side sharing a drain node and
    /// a common gate) exercises both companions in one netlist.
    #[test]
    fn mosfet_family_run_is_reproducible() {
        let run = || {
            // VDD source 1->0; PMOS drain=2 source=1 gate=3; NMOS drain=2 source=0
            // gate=3; input gate source 3->0; load cap 2->0. Output node 2 swings
            // as the shared gate (node 3) is held; both devices iterate every step.
            // a = drain, b = source, c = gate for both: PMOS (2,1,3), NMOS (2,0,3).
            let mut sim = build3(
                4,
                &[
                    ELEM_VSOURCE,
                    ELEM_PMOS,
                    ELEM_NMOS,
                    ELEM_VSOURCE,
                    ELEM_CAPACITOR,
                ],
                &[1, 2, 2, 3, 2],
                &[0, 1, 0, 0, 0],
                &[0, 3, 3, 0, 0],
                &[5.0, 0.0, 0.0, 2.5, 1.0e-9],
            );
            let mut acc = sim.snapshot_hash();
            for _ in 0..1000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "NMOS+PMOS pair must reproduce exactly");
    }

    // --- Three-terminal: NPN / PNP BJT + Newton -------------------------------
    //
    // The Ebers-Moll BJT (types 13/14) is the first device with two coupled
    // exponential junctions; it reuses the diode exponential and the `pnjlim`
    // limiter (one limited junction voltage each for base-emitter and
    // base-collector) on the same deterministic Newton loop. Terminal convention:
    // collector = a, emitter = b, base = c (the main current flows a -> b, base
    // controls), mirroring the MOSFET's drain/source/gate. These tests check the
    // operating point against an independent scalar Ebers-Moll evaluation (so the
    // result is verified against the model, not a fitted constant), the
    // off/saturation/active behaviors, current gain, the common-emitter amplifier,
    // the PNP mirror, validation, and the replay invariant.

    /// Independent scalar Ebers-Moll evaluation (NPN convention) at junction
    /// voltages `vbe`/`vbc`, returning `(Ic, Ib)` — a reference that does not touch
    /// the solver, so the core's operating point is checked against the model
    /// directly.
    fn bjt_terminal_currents(vbe: f64, vbc: f64) -> (f64, f64) {
        let evbe = (vbe / DIODE_VT).exp();
        let evbc = (vbc / DIODE_VT).exp();
        let ic = BJT_IS * ((evbe - evbc) - (evbc - 1.0) / BJT_BR);
        let ib = BJT_IS * ((evbe - 1.0) / BJT_BF + (evbc - 1.0) / BJT_BR);
        (ic, ib)
    }

    /// Independent reference for an NPN common-emitter / common-source-style stage
    /// with the **base driven by a fixed `vbe` source** (so `Vbe` is held), a
    /// collector resistor `rc` from `vcc` to the collector, and the emitter
    /// grounded. Solve the scalar collector-node KCL `(Vc - vcc)/rc + Ic = 0` for
    /// the collector voltage `Vc` with Newton on the same Ebers-Moll currents the
    /// core uses, returning `(Ic, Ib, Vc)`.
    fn npn_fixed_vbe_reference(vcc: f64, rc: f64, vbe: f64) -> (f64, f64, f64) {
        let mut vc = vcc; // no-current guess (cutoff)
        for _ in 0..400 {
            let (ic, _) = bjt_terminal_currents(vbe, vbe - vc);
            let f = (vc - vcc) / rc + ic;
            let h = 1.0e-9;
            let (ic2, _) = bjt_terminal_currents(vbe, vbe - (vc + h));
            let df = (((vc + h) - vcc) / rc + ic2 - f) / h;
            vc -= f / df;
        }
        let (ic, ib) = bjt_terminal_currents(vbe, vbe - vc);
        (ic, ib, vc)
    }

    /// With the base held **below** the turn-on knee, an NPN common-emitter stage
    /// is in cutoff: it carries essentially no collector current, so the collector
    /// resistor drops nothing and the collector sits parked at the rail (the "off"
    /// state / a logic HIGH). Layout: VCC source 1->0; RC 1->2; NPN collector=2,
    /// emitter=0, base=3; base source 3->0 = Vbb (< ~0.6 V).
    #[test]
    fn npn_off_when_base_low() {
        let vcc = 5.0;
        let rc = 1_000.0;
        let vbb = 0.2; // below the ~0.6 V base-emitter knee -> cutoff
        let sim = build3(
            4,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_NPN, ELEM_VSOURCE],
            &[1, 1, 2, 3],
            &[0, 2, 0, 0],
            &[0, 0, 3, 0], // only the NPN reads c (its base = node 3)
            &[vcc, rc, 0.0, vbb],
        );
        let v = sim.node_voltages();
        // Collector (node 2) parked at the rail: no current, no IR drop.
        assert!(
            (v[2] - vcc).abs() < 1e-3,
            "cutoff NPN leaves the collector near the rail: got {}",
            v[2]
        );
        // The NPN (element 2) carries essentially no collector current.
        let c = sim.element_currents();
        assert!(
            c[2].abs() < 1e-6,
            "cutoff NPN carries no collector current: got {}",
            c[2]
        );
        assert!(v.iter().all(|x| x.is_finite()), "finite (Newton converged)");
    }

    /// With a strong base drive the NPN saturates: both junctions conduct, the
    /// collector is pulled far below the rail, and the collector-emitter voltage
    /// `Vce` is small (the "on" state / a logic LOW). Layout: VCC source 1->0; RC
    /// 1->2; NPN collector=2 emitter=0 base=3; base resistor RB 3->4; base source
    /// 4->0 driving hard through RB. The forced base current would demand far more
    /// than `Vcc/RC` of collector current, so the device bottoms out.
    #[test]
    fn npn_saturates_with_base_drive() {
        let vcc = 5.0;
        let rc = 1_000.0;
        let rb = 10_000.0;
        let vbb = 5.0; // Ib ~ (5 - 0.7)/10k ~ 0.43 mA; BF*Ib >> Vcc/RC -> saturation
        let sim = build3(
            5,
            &[
                ELEM_VSOURCE,
                ELEM_RESISTOR, // RC 1->2
                ELEM_NPN,      // C=2 E=0 B=3
                ELEM_RESISTOR, // RB 3->4
                ELEM_VSOURCE,  // base drive 4->0
            ],
            &[1, 1, 2, 3, 4],
            &[0, 2, 0, 4, 0],
            &[0, 0, 3, 0, 0],
            &[vcc, rc, 0.0, rb, vbb],
        );
        let v = sim.node_voltages();
        assert!(v.iter().all(|x| x.is_finite()), "finite (Newton converged)");
        // Collector pulled well below the rail; Vce_sat is small (emitter is gnd).
        let vce = v[2]; // emitter at ground
        assert!(
            vce < 0.4,
            "saturated NPN pulls the collector low (small Vce_sat): got {}",
            vce
        );
        assert!(
            vce > 0.0,
            "Vce_sat stays positive (forward active->sat corner)"
        );
        // Collector current is positive (a -> b is collector -> emitter) and near
        // the resistor-limited ceiling (Vcc - Vce)/RC.
        let c = sim.element_currents();
        assert!(c[2] > 0.0, "saturated NPN draws collector current");
        let i_rc = (vcc - vce) / rc;
        assert!(
            (c[2] - i_rc).abs() < 1e-6,
            "series loop: RC and collector carry the same current ({} vs {})",
            c[2],
            i_rc
        );
    }

    /// The defining quantitative check: biased in the forward-active region (base
    /// driven by a fixed `Vbe`, base-collector reverse biased), the NPN lands on
    /// the Ebers-Moll operating point with current gain `Ic ~ BF*Ib`. The collector
    /// voltage and current match the independent scalar reference to ~1e-6
    /// (relative), and `Ie ~ -(Ic + Ib)` holds. Layout: VCC source 1->0; RC 1->2;
    /// NPN collector=2 emitter=0 base=3; base source 3->0 = Vbe directly.
    #[test]
    fn npn_current_gain_in_active_region() {
        let vcc = 12.0;
        let rc = 4_700.0;
        let vbe_drive = 0.6; // moderate forward bias, firmly active (Vc stays high)
        let sim = build3(
            4,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_NPN, ELEM_VSOURCE],
            &[1, 1, 2, 3],
            &[0, 2, 0, 0],
            &[0, 0, 3, 0],
            &[vcc, rc, 0.0, vbe_drive],
        );
        let (ic_ref, ib_ref, vc_ref) = npn_fixed_vbe_reference(vcc, rc, vbe_drive);
        // The reference point is in forward-active: base-collector reverse biased
        // (Vbc = Vbe - Vc < 0), so the square-law-free Ebers-Moll gain applies.
        assert!(
            vbe_drive - vc_ref < 0.0,
            "reference is forward-active: Vbc {} < 0",
            vbe_drive - vc_ref
        );
        let v = sim.node_voltages();
        assert!(
            (v[2] - vc_ref).abs() < 1e-6,
            "collector voltage matches Ebers-Moll: got {}, want {}",
            v[2],
            vc_ref
        );
        let c = sim.element_currents();
        // Collector current (a -> b) matches the scalar reference to ~1e-6 relative.
        assert!(
            (c[2] - ic_ref).abs() <= 1e-6 * ic_ref.abs().max(1.0) + 1e-12,
            "collector current matches Ebers-Moll: got {}, want {}",
            c[2],
            ic_ref
        );
        // Current gain: Ic ~ BF * Ib (the hallmark of the active region). Compare
        // the reference currents (the core matches them above), tolerant of the
        // small Early/transport corrections in the exact model.
        assert!(
            (ic_ref / ib_ref - BJT_BF).abs() < 1e-3,
            "Ic/Ib equals BF in the active region: got {}, want {}",
            ic_ref / ib_ref,
            BJT_BF
        );
        // Ie = -(Ic + Ib). Reconstruct Ie from the device op at the converged
        // junctions and check the sum rule on the reference currents.
        let ie_ref = -(ic_ref + ib_ref);
        assert!(
            (ie_ref + (ic_ref + ib_ref)).abs() < 1e-15,
            "Ie = -(Ic + Ib) holds exactly in the model"
        );
        // KCL: the collector resistor (1->2) and the collector terminal (2->...)
        // carry the same current in this series leg.
        assert!(
            (c[1] - c[2]).abs() < 1e-9,
            "series loop: RC and collector carry one current ({} vs {})",
            c[1],
            c[2]
        );
        assert!(v.iter().all(|x| x.is_finite()), "finite (Newton converged)");
    }

    /// A common-emitter stage shows **voltage gain**: a small change on the base
    /// side moves the collector much harder, and inverting (more base drive -> more
    /// collector current -> lower collector voltage). Biased in the forward-active
    /// region with a fixed base-emitter drive that sets a ~0.1 mA collector current,
    /// so the small-signal gain `-gm*RC` is well above unity. This is the BJT
    /// analogue of `nmos_common_source_amplifies_with_transconductance`. Layout:
    /// VCC source 1->0; RC 1->2; NPN collector=2 emitter=0 base=3; base source
    /// 3->0 = Vbe directly.
    #[test]
    fn npn_common_emitter_amplifies() {
        let vcc = 12.0;
        let rc = 4_700.0;
        let vbe0 = 0.66; // forward-active bias, ~0.12 mA collector current
        let dv = 1.0e-4; // small base-emitter perturbation (stays linear)
        let collector = |vbe: f64| {
            build3(
                4,
                &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_NPN, ELEM_VSOURCE],
                &[1, 1, 2, 3],
                &[0, 2, 0, 0],
                &[0, 0, 3, 0],
                &[vcc, rc, 0.0, vbe],
            )
            .node_voltages()[2]
        };
        let vc_lo = collector(vbe0 - dv);
        let vc_hi = collector(vbe0 + dv);
        // Inverting: more base drive -> more collector current -> lower collector.
        assert!(
            vc_hi < vc_lo,
            "common-emitter inverts: higher base -> lower collector ({} !< {})",
            vc_hi,
            vc_lo
        );
        // The collector swing is many times the base-side change (voltage gain
        // magnitude well above unity), confirming the companion's transconductance.
        let gain = (vc_hi - vc_lo) / (2.0 * dv);
        assert!(
            gain.abs() > 5.0,
            "common-emitter has substantial inverting gain: got {}",
            gain
        );
        // Quantitatively the magnitude is the textbook -gm*RC at this bias
        // (gm = Ic/Vt), to good tolerance — a real amplifier, not just a sign.
        let (ic_ref, _, _) = npn_fixed_vbe_reference(vcc, rc, vbe0);
        let gm = ic_ref / DIODE_VT;
        let gain_expected = -gm * rc;
        assert!(
            (gain - gain_expected).abs() < 0.1 * gain_expected.abs(),
            "common-emitter gain ~ -gm*RC: got {}, want {}",
            gain,
            gain_expected
        );
    }

    /// The PNP is the high-side mirror of the NPN. Wired collector `a` = node 2
    /// (output, pulled down by RC), emitter `b` = node 1 (rail), base `c` = node 3.
    /// With the base at the rail (`Vbe = V(3) - V(1) = 0`) it is **off** — the
    /// pull-down holds the collector near ground. Pulling the base well below the
    /// emitter turns it **on**, sourcing collector current from the rail and pulling
    /// the collector up. Layout: VCC source 1->0; PNP collector=2 emitter=1 base=3;
    /// RC (pull-down) 2->0; base resistor RB 3->4; base drive 4->0.
    #[test]
    fn pnp_high_side_active() {
        let vcc = 5.0;
        let rc = 1_000.0;
        let rb = 10_000.0;
        let build_pnp = |vbb: f64| {
            build3(
                5,
                &[
                    ELEM_VSOURCE,
                    ELEM_PNP,      // a=collector=2, b=emitter=1, c=base=3
                    ELEM_RESISTOR, // RC pull-down 2->0
                    ELEM_RESISTOR, // RB 3->4
                    ELEM_VSOURCE,  // base drive 4->0
                ],
                &[1, 2, 2, 3, 4],
                &[0, 1, 0, 4, 0],
                &[0, 3, 0, 0, 0],
                &[vcc, 0.0, rc, rb, vbb],
            )
        };
        // Base at the rail: Vbe = V(base) - V(emitter) = 5 - 5 = 0 -> off.
        let off = build_pnp(vcc);
        let voff = off.node_voltages();
        assert!(voff.iter().all(|x| x.is_finite()), "off state finite");
        assert!(
            voff[2].abs() < 0.5,
            "PNP off: pull-down holds the collector near ground, got {}",
            voff[2]
        );
        assert!(
            off.element_currents()[1].abs() < 1e-6,
            "PNP off carries ~no collector current: got {}",
            off.element_currents()[1]
        );
        // Base pulled to ground through RB: emitter-base forward biased -> on, the
        // collector is sourced from the rail and pulled high.
        let on = build_pnp(0.0);
        let von = on.node_voltages();
        assert!(von.iter().all(|x| x.is_finite()), "on state finite");
        assert!(
            von[2] > 1.0,
            "PNP on: sources from the rail and pulls the collector up, got {}",
            von[2]
        );
        // The PNP collector current flows out of the collector terminal into the
        // node, which is negative in the a -> b (collector -> emitter) convention.
        let c = on.element_currents();
        assert!(
            c[1] < 0.0,
            "PNP sources current into the collector node (negative a->b): got {}",
            c[1]
        );
        // KCL at the collector (node 2): the PNP delivers current there and the
        // pull-down (2->0) carries it to ground, so the two balance.
        assert!(
            (c[1] + c[2]).abs() < 1e-9,
            "collector KCL: PNP and pull-down balance: {} vs {}",
            c[1],
            c[2]
        );
    }

    /// `set_netlist` accepts the BJT element types (13 and 14), stores the control
    /// (base) node, and marks the netlist nonlinear (so the Newton path runs). A
    /// malformed netlist that contains a BJT — including an out-of-range base or
    /// collector node — still fails safe through the same validation.
    #[test]
    fn bjt_netlist_validates() {
        let mut sim = Sim::new(1);
        // A valid NPN common-emitter stage installs and stores the base node.
        let ok = sim.set_netlist(
            4,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_NPN, ELEM_VSOURCE],
            &[1, 1, 2, 3],
            &[0, 2, 0, 0],
            &[0, 0, 3, 0],
            &[0, 0, 0, 0],
            &[5.0, 1_000.0, 0.0, 2.0],
            &[0.0, 0.0, 0.0, 0.0],
        );
        assert!(ok, "valid NPN netlist installs");
        assert_eq!(sim.element_count(), 4);
        let npn = sim.element_at(2);
        assert_eq!(npn.kind, ELEM_NPN, "NPN stored as type 13");
        assert_eq!(npn.c, 3, "the NPN base node (c) is stored");
        // A PNP installs too, as type 14 (collector=2, emitter=1, base=3).
        let okp = sim.set_netlist(
            4,
            &[ELEM_VSOURCE, ELEM_PNP, ELEM_RESISTOR, ELEM_VSOURCE],
            &[1, 2, 2, 3],
            &[0, 1, 0, 0],
            &[0, 3, 0, 0],
            &[0, 0, 0, 0],
            &[5.0, 0.0, 1_000.0, 0.0],
            &[0.0, 0.0, 0.0, 0.0],
        );
        assert!(okp, "valid PNP netlist installs");
        assert_eq!(sim.element_at(1).kind, ELEM_PNP, "PNP stored as type 14");
        assert_eq!(sim.element_at(1).c, 3, "the PNP base node (c) is stored");
        // Out-of-range control (base) node is rejected fail-safe.
        let bad = sim.set_netlist(
            3,
            &[ELEM_NPN],
            &[2],
            &[0],
            &[9],
            &[0], // base node 9 out of range for node_count 3
            &[0.0],
            &[0.0],
        );
        assert!(!bad, "out-of-range BJT base node rejected");
        assert_eq!(sim.node_voltages().len(), 1, "fell back to ground-only");
        // Out-of-range collector node is rejected too.
        let bad2 = sim.set_netlist(3, &[ELEM_NPN], &[9], &[0], &[1], &[0], &[0.0], &[0.0]);
        assert!(!bad2, "out-of-range BJT collector node rejected");
        assert_eq!(sim.node_voltages().len(), 1, "fell back to ground-only");
    }

    /// Replay invariant for an NPN circuit: the Newton loop (with the two-junction
    /// Ebers-Moll companion and the dual `pnjlim` limiting) is deterministic, so a
    /// fixed netlist stepped a fixed number of times reproduces its snapshot-hash
    /// stream exactly. The NPN analogue of `nmos_run_is_reproducible`.
    #[test]
    fn npn_run_is_reproducible() {
        let run = || {
            // A common-emitter NPN switching a collector-resistor + load-cap node:
            // VCC source 1->0; RC 1->2; NPN collector=2 emitter=0 base=3; RB 3->4;
            // base source 4->0; load cap 2->0. The Newton loop runs every step.
            let mut sim = build3(
                5,
                &[
                    ELEM_VSOURCE,
                    ELEM_RESISTOR,
                    ELEM_NPN,
                    ELEM_RESISTOR,
                    ELEM_VSOURCE,
                ],
                &[1, 1, 2, 3, 4],
                &[0, 2, 0, 4, 0],
                &[0, 0, 3, 0, 0],
                &[5.0, 1_000.0, 0.0, 10_000.0, 3.0],
            );
            let mut acc = sim.snapshot_hash();
            for _ in 0..1000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "NPN circuit must reproduce exactly");
    }

    /// Both BJT polarities on the Newton path reproduce bit-for-bit over a long run
    /// — the NPN + PNP analogue of `mosfet_family_run_is_reproducible`. A
    /// complementary pair (PNP high-side sourcing into a shared collector node, NPN
    /// low-side sinking from it) driven from common base resistors exercises both
    /// two-junction companions in one netlist, with a load cap on the transient
    /// path.
    #[test]
    fn bjt_family_run_is_reproducible() {
        let run = || {
            // VCC source 1->0;
            // PNP collector=2 emitter=1 base=3; NPN collector=2 emitter=0 base=4;
            // RB_p 3->5; RB_n 4->5; base drive 5->0; load cap 2->0.
            let mut sim = build3(
                6,
                &[
                    ELEM_VSOURCE,
                    ELEM_PNP,       // C=2 E=1 B=3
                    ELEM_NPN,       // C=2 E=0 B=4
                    ELEM_RESISTOR,  // RB_p 3->5
                    ELEM_RESISTOR,  // RB_n 4->5
                    ELEM_VSOURCE,   // base drive 5->0
                    ELEM_CAPACITOR, // load cap 2->0
                ],
                &[1, 2, 2, 3, 4, 5, 2],
                &[0, 1, 0, 5, 5, 0, 0],
                &[0, 3, 4, 0, 0, 0, 0],
                &[5.0, 0.0, 0.0, 47_000.0, 47_000.0, 2.5, 1.0e-9],
            );
            let mut acc = sim.snapshot_hash();
            for _ in 0..1000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "NPN+PNP pair must reproduce exactly");
    }
}

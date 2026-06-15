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

/// True for every nonlinear element (any device that drives the Newton outer
/// loop): the diode family, the MOSFET family, or the BJT family. The single
/// switch that selects the Newton path over the linear fast path.
#[inline]
fn is_nonlinear(kind: u8) -> bool {
    is_diode(kind) || is_mosfet(kind) || is_bjt(kind)
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
    /// Element value in the units implied by `kind` (V / ohm / F / H / A).
    pub value: f64,
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
            mosfet_vgs: Vec::new(),
            mosfet_vds: Vec::new(),
            bjt_vbe: Vec::new(),
            bjt_vbc: Vec::new(),
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
                value: v_source,
            },
            Element {
                kind: ELEM_RESISTOR,
                a: 1,
                b: 2,
                c: 0,
                value: 1_000.0,
            },
            Element {
                kind: ELEM_CAPACITOR,
                a: 2,
                b: 0,
                c: 0,
                value: 1.0e-6,
            },
        ];
        sim.install(3, demo);
        sim
    }

    /// Replace the circuit with the given netlist and reset to `t = 0`.
    ///
    /// `types`, `a`, `b`, `c`, and `values` are parallel arrays (one entry per
    /// element). `c` is the **control terminal** (the gate of a MOSFET); for every
    /// two-terminal element it is ignored, so callers pass `0` (or any in-range
    /// node) there. On any length mismatch, a node index (`a`, `b`, or `c`)
    /// outside `0..node_count`, a zero `node_count`, or an unknown element type,
    /// the call **fails safe deterministically**: the simulation is replaced with
    /// an empty single-node (ground-only) circuit and `false` is returned. On
    /// success the netlist is installed, reactive elements start discharged, and
    /// `true` is returned. Never panics.
    pub fn set_netlist(
        &mut self,
        node_count: usize,
        types: &[u8],
        a: &[u32],
        b: &[u32],
        c: &[u32],
        values: &[f64],
    ) -> bool {
        let n = types.len();
        if a.len() != n || b.len() != n || c.len() != n || values.len() != n || node_count == 0 {
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
            ) {
                self.install_empty();
                return false;
            }
            let na = a[i] as usize;
            let nb = b[i] as usize;
            let nc = c[i] as usize;
            // Validate all three terminals. `c` is ignored at solve time for a
            // two-terminal element, but it is still range-checked so a malformed
            // index is rejected fail-safe rather than stored.
            if na >= node_count || nb >= node_count || nc >= node_count {
                self.install_empty();
                return false;
            }
            elements.push(Element {
                kind,
                a: na,
                b: nb,
                c: nc,
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

        let has_nonlinear = elements.iter().any(|e| is_nonlinear(e.kind));

        self.node_count = node_count;
        self.dim = next;
        self.branch_index = branch_index;
        self.has_nonlinear = has_nonlinear;
        self.reactive_state = vec![0.0; elements.len()];
        self.diode_vd = vec![0.0; elements.len()];
        self.mosfet_vgs = vec![0.0; elements.len()];
        self.mosfet_vds = vec![0.0; elements.len()];
        self.bjt_vbe = vec![0.0; elements.len()];
        self.bjt_vbc = vec![0.0; elements.len()];
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
    /// Determinism: fixed element/diode/mosfet/bjt order, fixed assembly and solve
    /// order, pure `f64`, no hashed iteration. The iteration count is
    /// data-dependent but bounded by [`NEWTON_MAX_ITERS`]; on non-convergence the
    /// last iterate is kept (a defined, finite outcome).
    fn newton_iterate(
        &mut self,
        n: usize,
        base_mat: &[f64],
        base_rhs: &[f64],
        diodes: &[DiodeMap],
        mosfets: &[MosfetMap],
        bjts: &[BjtMap],
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
            // seed cannot report convergence before a fresh solve.
            if converged_v && converged_i && converged_mos_i && converged_bjt_i && converged_limit {
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

        // Stamp the fixed linear part once and collect the diode, MOSFET, and BJT
        // maps.
        let mut base_mat = vec![0.0f64; n * n];
        let mut base_rhs = vec![0.0f64; n];
        let mut diodes: Vec<DiodeMap> = Vec::new();
        let mut mosfets: Vec<MosfetMap> = Vec::new();
        let mut bjts: Vec<BjtMap> = Vec::new();
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
                ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER => diodes.push((i, ia, ib)),
                ELEM_NMOS | ELEM_PMOS => mosfets.push((i, ia, ib, Self::node_idx(e.c))),
                ELEM_NPN | ELEM_PNP => bjts.push((i, ia, ib, Self::node_idx(e.c))),
                _ => {}
            }
        }

        let x = self.newton_iterate(n, &base_mat, &base_rhs, &diodes, &mosfets, &bjts);

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
                ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER => {
                    diode_eval(self.diode_vd[i], diode_model(e.kind, e.value)).0
                }
                ELEM_NMOS | ELEM_PMOS => {
                    Self::mosfet_op(e.kind, self.mosfet_vgs[i], self.mosfet_vds[i]).id
                }
                // The BJT main current is the collector current Ic, oriented a -> b
                // (collector -> emitter), consistent with the MOSFET's drain current.
                ELEM_NPN | ELEM_PNP => Self::bjt_op(e.kind, self.bjt_vbe[i], self.bjt_vbc[i]).ic,
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

        // Stamp the fixed linear part once and collect the diode and MOSFET maps.
        let mut base_mat = vec![0.0f64; n * n];
        let mut base_rhs = vec![0.0f64; n];
        let mut diodes: Vec<DiodeMap> = Vec::new();
        let mut mosfets: Vec<MosfetMap> = Vec::new();
        let mut bjts: Vec<BjtMap> = Vec::new();
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
                ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER => diodes.push((i, ia, ib)),
                ELEM_NMOS | ELEM_PMOS => mosfets.push((i, ia, ib, Self::node_idx(e.c))),
                ELEM_NPN | ELEM_PNP => bjts.push((i, ia, ib, Self::node_idx(e.c))),
                _ => {}
            }
        }

        let x = self.newton_iterate(n, &base_mat, &base_rhs, &diodes, &mosfets, &bjts);

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
                ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER => {
                    diode_eval(self.diode_vd[i], diode_model(e.kind, e.value)).0
                }
                ELEM_NMOS | ELEM_PMOS => {
                    Self::mosfet_op(e.kind, self.mosfet_vgs[i], self.mosfet_vds[i]).id
                }
                // The BJT main current is the collector current Ic, oriented a -> b
                // (collector -> emitter), consistent with the MOSFET's drain current.
                ELEM_NPN | ELEM_PNP => Self::bjt_op(e.kind, self.bjt_vbe[i], self.bjt_vbc[i]).ic,
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

    /// Build a fresh `Sim`, install a two-terminal netlist, and assert the install
    /// succeeded. The control terminal `c` is all-ground (zeros), since every
    /// element here is two-terminal and ignores it. See [`build3`] for MOSFETs.
    fn build(node_count: usize, types: &[u8], a: &[u32], b: &[u32], values: &[f64]) -> Sim {
        let c = vec![0u32; types.len()];
        let mut sim = Sim::new(1);
        assert!(
            sim.set_netlist(node_count, types, a, b, &c, values),
            "valid netlist must install"
        );
        sim
    }

    /// Build a fresh `Sim` from a netlist that includes the third (control)
    /// terminal `c`, for the MOSFET tests. Two-terminal elements in the same
    /// netlist set their `c` entry to `0` (ground), where it is ignored.
    fn build3(
        node_count: usize,
        types: &[u8],
        a: &[u32],
        b: &[u32],
        c: &[u32],
        values: &[f64],
    ) -> Sim {
        let mut sim = Sim::new(1);
        assert!(
            sim.set_netlist(node_count, types, a, b, c, values),
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
        // Mismatched array lengths (`a` has two entries, the rest one).
        let ok = sim.set_netlist(2, &[ELEM_RESISTOR], &[1, 0], &[0], &[0], &[1_000.0]);
        assert!(!ok, "length mismatch must be rejected");
        assert_eq!(sim.node_voltages().len(), 1, "fell back to ground-only");
        assert_eq!(sim.element_currents().len(), 0, "no elements remain");
        // Mismatched control-array length (`c` too long) is rejected too.
        let ok_c = sim.set_netlist(2, &[ELEM_RESISTOR], &[1], &[0], &[0, 0], &[1_000.0]);
        assert!(!ok_c, "mismatched c length must be rejected");
        // Out-of-range node.
        let ok2 = sim.set_netlist(2, &[ELEM_RESISTOR], &[5], &[0], &[0], &[1_000.0]);
        assert!(!ok2, "out-of-range node must be rejected");
        // Out-of-range control node (even though a resistor ignores it).
        let ok2c = sim.set_netlist(2, &[ELEM_RESISTOR], &[1], &[0], &[7], &[1_000.0]);
        assert!(!ok2c, "out-of-range control node must be rejected");
        // Unknown element type.
        let ok3 = sim.set_netlist(2, &[99], &[1], &[0], &[0], &[1_000.0]);
        assert!(!ok3, "unknown element type must be rejected");
        // Zero node_count.
        let ok4 = sim.set_netlist(0, &[], &[], &[], &[], &[]);
        assert!(!ok4, "zero node_count must be rejected");
        // A subsequent valid netlist still installs fine.
        let ok5 = sim.set_netlist(
            2,
            &[ELEM_VSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
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
            &[5.0, 0.0],
        );
        assert!(ok, "valid diode netlist installs");
        assert_eq!(sim.element_count(), 2);
        assert_eq!(sim.element_at(1).kind, ELEM_DIODE, "diode stored as type 5");
        // Out-of-range node on a diode is still rejected (fail-safe).
        let bad = sim.set_netlist(2, &[ELEM_DIODE], &[9], &[0], &[0], &[0.0]);
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
            &[0, 0, 0],
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
        let bad = sim.set_netlist(2, &[ELEM_SWITCH], &[9], &[0], &[0], &[0.5]);
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
        let bad = sim.set_netlist(2, &[ELEM_ACSOURCE], &[9], &[0], &[0], &[1_000.0]);
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
            &[5.0, 1_000.0, 0.0, 3.0],
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
            &[5.0, 0.0, 1_000.0, 0.0],
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
            &[9], // gate node 9 out of range for node_count 3
            &[0.0],
        );
        assert!(!bad, "out-of-range MOSFET gate node rejected");
        assert_eq!(sim.node_voltages().len(), 1, "fell back to ground-only");
        // Out-of-range drain node is rejected too.
        let bad2 = sim.set_netlist(3, &[ELEM_NMOS], &[9], &[0], &[1], &[0.0]);
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
            &[5.0, 1_000.0, 0.0, 2.0],
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
            &[5.0, 0.0, 1_000.0, 0.0],
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
            &[9], // base node 9 out of range for node_count 3
            &[0.0],
        );
        assert!(!bad, "out-of-range BJT base node rejected");
        assert_eq!(sim.node_voltages().len(), 1, "fell back to ground-only");
        // Out-of-range collector node is rejected too.
        let bad2 = sim.set_netlist(3, &[ELEM_NPN], &[9], &[0], &[1], &[0.0]);
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

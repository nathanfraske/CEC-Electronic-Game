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
//! | 22   | clocked sampler    | threshold V   | edge-triggered 1-bit comparator, linear (OUT=a IN=b CLK=c)|
//! | 23   | latched comparator | hysteresis V_H| level-latched analog comparator, powered rail-to-rail (OUT=a IN+=b IN-=c VCC=d GND=e LE=f)|
//! | 24   | analog switch (TG) | R_on ohms     | node-gated transmission gate, time-varying conductance a<->b (CTRL=c VCC=d GND=e)|
//! | 25   | behavioral block   | program id    | integer state machine, program-id dispatch, powered digital I/O (SPI master: SCLK=a MOSI=b CS=c VCC=d GND=e MISO=f START=g)|
//!
//! Type 25 is the **behavioral block** — the protocol / behavioral engine's element (ADR 0004,
//! `docs/sim/multi-rate-domains.md`): a clocked, **integer-state** machine that runs beside the
//! analog MNA solve and talks to it only at its boundary pins. Each tick it reads its input pins
//! as logic levels, advances a fixed `[u32; 8]` block of internal state, and drives its powered
//! digital outputs from that committed state — the digital twin of the gate/sampler/DFF, made
//! programmable. Its `value` is a **program id** dispatching which firmware it runs (`1` = SPI
//! master, `2` = SPI slave, `3` = UART, `4` = FPGA logic element; the dispatch stays open for I2C
//! and a tiny MCU later), `aux` is the data word / truth table, and its timing is **structural**
//! (`params[0]` = SCLK half-period in ticks, `params[1]` = bit count) — never a function of a
//! solved voltage. Sub-ticking (phase 3) lets a block run many digital sub-ticks per analog tick at
//! a declared rate, so protocols clock at MHz against the µs analog tick. The **SPI master** (program 1)
//! is Mode 0 (CPOL = 0, CPHA = 0): a rising `START` (`g`) asserts `CS` (`c`) low and shifts the
//! word out on `MOSI` (`b`) MSB-first, clocked by `SCLK` (`a`) at the structural divider, sampling
//! `MISO` (`f`) on each rising edge; the three outputs are powered (swing the `GND` (`e`) .. `VCC`
//! (`d`) rail, dead below [`GATE_MIN_RAIL`]) exactly like a gate. Its eight `u32` state words enter
//! the snapshot hash (LE bytes, fixed element + word order, appended after the comparator fold), so
//! a behavioral netlist replays bit-for-bit and a circuit with no behavioral block folds zero extra
//! bytes (the golden is untouched). See [`ELEM_BEHAVIORAL`] and [`beh_spi_step`].
//!
//! Type 22 is the **clocked sampler** (a 1-bit clocked comparator — the keystone of the
//! ADC / sample-and-hold / SAR cluster): a near-twin of the D flip-flop whose data input
//! is a continuous **analog** sense node (`IN` = `b`) instead of a logic pin. On each rising
//! edge of `CLK` (`c`) it latches `OUT` (`a`) = `High` if `V(IN) > value` (its threshold)
//! else `Low`, driving `OUT` from the committed bit through the same constant digital stamp
//! as the flip-flop (no Newton, no branch unknown, one tick of clock-to-output delay). `IN`
//! is a high-Z analog pin (not driven, not iterated). Like the flip-flop it keeps two
//! persistent four-state scalars (the stored bit and the previous clock level) that enter
//! the snapshot hash. See [`ELEM_SAMPLER`].
//!
//! Type 23 is the **latched comparator** (modelled on the Analog Devices **ADCMP601**): a
//! crossbreed of the clocked sampler and the powered logic gate. Its **front end** is an
//! analog comparator — it senses two continuous inputs `IN+` (`b`) and `IN-` (`c`) and tracks
//! whether `V(IN+) > V(IN-)` — while its **output stage** is a powered, rail-to-rail digital
//! driver like a gate: `OUT` (`a`) swings between the GND pin (`e`, low) and the VCC pin (`d`,
//! high), and an unpowered rail (`V(d) − V(e) < `[`GATE_MIN_RAIL`]) leaves it dead/released
//! exactly as for a gate. A **level-sensitive, active-low latch enable** `LE` (`f`) gates the
//! front end: while LE is transparent (unwired, or driven at/above half-rail it is *not* —
//! below half-rail latches) the held bit (`cmp_q`) tracks the comparison; while LE is asserted
//! low the bit holds. Its `value` is the **hysteresis band** `V_H` (volts, default `0` = a
//! clean compare with no dead-band): the bit flips Low→High only once `diff > V_H/2` and
//! High→Low only once `diff < −V_H/2`, a symmetric Schmitt window about zero. Like the sampler
//! the held bit drives `OUT` through the constant powered-gate stamp (no Newton, no branch
//! unknown; the bit is committed once per step from the just-solved inputs, a one-tick delay),
//! `IN+`/`IN-` are high-Z analog sense pins (Boundary), and the single persistent four-state
//! scalar `cmp_q` enters the snapshot hash. See [`ELEM_COMPARATOR`].
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
//! ## Gated analog switch (transmission gate)
//!
//! The **analog switch** ([`ELEM_ASWITCH`]) is the *node-controlled* cousin of the clock-driven
//! switch — a CD4066-style transmission gate. It is the same time-varying *linear* conductance
//! between `a` and `b` (so it shares the switch's fixed-linear-base, no-Newton machinery), but
//! its open/closed state comes from a **control node** `c` rather than the tick: the control is
//! read from the **committed previous-tick** node voltages (a one-tick delay, exactly like a
//! logic gate's input), so the conductance is still a constant within the solve. Powered from
//! `d` (VCC) / `e` (GND) it thresholds at half-rail and goes dead on an unpowered rail (the
//! powered-gate rule); with no power pins it falls back to a fixed control threshold. Its
//! `value` is the on-resistance `R_on`. Because its state is *derived* from the already-hashed
//! `node_v` it adds no hashed state, so the snapshot hash and golden are unchanged. This is the
//! switch the sample-and-hold / switched-capacitor / analog-mux clusters are built from.
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
/// and its `aux` is the **function code** ([`gate_logic_level`]: 0 AND, 1 OR, 2 NAND,
/// 3 NOR, 4 XOR, 5 XNOR, 6 NOT, 7 BUF — the single-input NOT/BUF ignore `c`). The
/// digital engine ([`Sim::eval_digital`]) reads the two inputs as logic [`Level`]s
/// from the **committed previous-tick** node voltages (the receiver, one tick of
/// delay), evaluates the four-state boolean, and resolves the output level onto its
/// net; the driver then presents it as a constant Thevenin (conductance [`GATE_GOUT`]
/// to ground + a current injection) via [`Sim::stamp_digital`]. So it adds **no**
/// Newton work, **no** branch unknown, and one tick of propagation delay; a feedback
/// loop of gates oscillates rather than deadlocking (a ring oscillator), which is
/// physically honest. Its only state is the net's discrete level (folded into the
/// snapshot hash as a `u8`).
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

/// A digital logic level — the value a pure-digital net or a logic pin carries in the
/// separated digital domain (`docs/ui/logic-analog-digital-nets.md` §7). Four-state so
/// the engine can represent an undriven/high-impedance net (`Z`, e.g. an open-drain
/// output that released) and an indeterminate one (`X`, from a receiver's forbidden
/// band or a multi-driver conflict). `#[repr(u8)]` and folded directly into the
/// snapshot hash; the digital domain does **no float compares internally**, so a level
/// reproduces bit-for-bit. Quantisation of an analog voltage to a level happens only at
/// the receiver ([`LogicFamily::quantize`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum Level {
    Low = 0,
    High = 1,
    Z = 2,
    X = 3,
}

impl Level {
    /// Four-state logical inversion: `Low <-> High`; both `Z` and `X` invert to `X`
    /// (an undriven or indeterminate value stays indeterminate).
    #[inline]
    fn invert(self) -> Level {
        match self {
            Level::Low => Level::High,
            Level::High => Level::Low,
            _ => Level::X,
        }
    }
}

/// Resolve two driver levels onto one net (the IEEE-1164 / Logisim `combine()` rule,
/// `docs/ui/logic-analog-digital-nets.md` §7.6): `Z` yields to any real driver; `X`
/// dominates; equal real levels agree; two **disagreeing** strong levels conflict to
/// `X`. Associative and commutative, so folding a net's drivers in element-index order
/// is deterministic and order-independent.
#[inline]
fn combine(a: Level, b: Level) -> Level {
    match (a, b) {
        (Level::Z, x) | (x, Level::Z) => x,
        (Level::X, _) | (_, Level::X) => Level::X,
        (Level::Low, Level::Low) => Level::Low,
        (Level::High, Level::High) => Level::High,
        _ => Level::X,
    }
}

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
    /// Input reads **low** at/below this fraction of the rail (`V_IL`). Between `V_IL`
    /// and `V_IH` is the forbidden band the receiver quantises to `X`. LEGACY sets
    /// `v_il_frac == v_ih_frac`, so the band is empty and the receiver is two-state.
    v_il_frac: f64,
    /// Input reads **high** above this fraction of the rail (`V_IH`).
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
        v_il_frac: GATE_VTH_FRAC,
        v_ih_frac: GATE_VTH_FRAC,
        v_ol_frac: 0.0,
        v_oh_frac: 1.0,
        g_ol: GATE_GOUT,
        g_oh: GATE_GOUT,
    };

    /// Receiver: quantise an analog input voltage `v` (at rail `vhigh`) to a logic
    /// [`Level`] — `High` above `V_IH`, `Low` at/below `V_IL`, `X` in the forbidden
    /// band between. The one place a float becomes a level. For LEGACY `v_il == v_ih`,
    /// so the band is empty and this is the exact `v > value/2` two-state decision the
    /// gate used (`> V_IH` high, else low; the `X` arm is unreachable).
    #[inline]
    fn quantize(&self, v: f64, vhigh: f64) -> Level {
        let vh = vhigh.max(0.0);
        if v > self.v_ih_frac * vh {
            Level::High
        } else if v <= self.v_il_frac * vh {
            Level::Low
        } else {
            Level::X
        }
    }

    /// Driver: the analog Thévenin `(target voltage, conductance)` to stamp for a
    /// digital output [`Level`] at rail `vhigh`, or `None` to **release** (high-Z — a
    /// `Z` output, e.g. an open-drain pull that let go). `High → (V_OH, g_oh)`,
    /// `Low → (V_OL, g_ol)`, `X → mid-rail` (so an unknown is visible on the analog
    /// node), `Z → None`. For LEGACY this is `(vhigh, GATE_GOUT)` / `(0, GATE_GOUT)`.
    #[inline]
    fn drive_level(&self, level: Level, vhigh: f64) -> Option<(f64, f64)> {
        let vh = vhigh.max(0.0);
        match level {
            Level::High => Some((self.v_oh_frac * vh, self.g_oh)),
            Level::Low => Some((self.v_ol_frac * vh, self.g_ol)),
            Level::X => Some((
                0.5 * (self.v_ol_frac + self.v_oh_frac) * vh,
                self.g_oh.max(self.g_ol),
            )),
            Level::Z => None,
        }
    }
}

/// The selectable logic families, indexed by a small per-element code carried in the
/// upper bits of a gate/flip-flop's `aux` (see [`gate_family_index`]). Index `0` is
/// always [`LogicFamily::LEGACY`] (the idealised default every existing circuit uses,
/// so the goldens are unchanged); the rest are real families with honest thresholds
/// and noise margins. All are fixed `const` data → golden-reproducible. Levels are
/// rail fractions so one entry serves any rail (`value`); the rail + family together
/// give the absolute `V_IL`/`V_IH`/`V_OL`/`V_OH`. See
/// `docs/ui/logic-analog-digital-nets.md` §7.
const FAMILIES: [LogicFamily; 3] = [
    // 0: LEGACY / ideal — half-rail threshold, rail-to-ground output, no forbidden band.
    LogicFamily::LEGACY,
    // 1: CMOS — ~30%/70% input thresholds, near rail-to-rail output. Rail-independent,
    //    so it serves 5 V CMOS, 3.3 V LVCMOS, 1.8 V, … by choosing the rail. Symmetric
    //    ~0.25·rail noise margins.
    LogicFamily {
        v_il_frac: 0.3,
        v_ih_frac: 0.7,
        v_ol_frac: 0.05,
        v_oh_frac: 0.95,
        g_ol: GATE_GOUT,
        g_oh: GATE_GOUT,
    },
    // 2: TTL — 0.8 V / 2.0 V inputs and 0.4 V / 3.4 V outputs at a 5 V rail (the classic
    //    asymmetric thresholds with a notoriously thin low-side margin). Tuned for 5 V.
    LogicFamily {
        v_il_frac: 0.16,
        v_ih_frac: 0.4,
        v_ol_frac: 0.08,
        v_oh_frac: 0.68,
        g_ol: GATE_GOUT,
        g_oh: GATE_GOUT,
    },
];

/// A digital element packs three independent fields into its `aux` scalar (all small
/// non-negative integers, exact in `f64`): the gate **function code** in bits 0–3
/// ([`gate_func_code`]), the **logic-family index** in bits 4–7 ([`gate_family_index`]),
/// and an **open-drain** output flag in bit 8 ([`gate_open_drain`]). Decoded with bit
/// masks so each field is independent. A legacy element (`aux` in `0..8`) decodes to
/// function only, family `0` ([`LogicFamily::LEGACY`]), push-pull — behaviour unchanged.
#[inline]
fn aux_bits(aux: f64) -> u32 {
    aux.round().max(0.0) as u32
}

/// Decode a digital element's logic-family index (bits 4–7 of `aux`), clamped to the
/// last family if out of range.
#[inline]
fn gate_family_index(aux: f64) -> usize {
    (((aux_bits(aux) >> 4) & 0x0F) as usize).min(FAMILIES.len() - 1)
}

/// Decode a gate's function code (bits 0–3 of `aux`).
#[inline]
fn gate_func_code(aux: f64) -> f64 {
    (aux_bits(aux) & 0x0F) as f64
}

/// Decode the **open-drain** output flag (bit 8 of `aux`): when set, the driver pulls
/// its output **low** but **releases** (high-impedance `Z`) instead of driving it high
/// — the high then comes from an external pull-up resistor. Open-drain outputs sharing
/// a net form a **wired-AND** bus (any driver low → net low; all release → pull-up
/// high), the I²C / open-collector / interrupt-line idiom. See
/// `docs/ui/logic-analog-digital-nets.md` §7.6.
#[inline]
fn gate_open_drain(aux: f64) -> bool {
    (aux_bits(aux) >> 8) & 0x01 != 0
}

/// A logic gate's supply rails as `(v_low, v_high)` absolute node voltages. A **powered**
/// IC reads GND from terminal `e` and VCC from terminal `d`, so it swings and thresholds
/// between the pins you wire (`V(GND) .. V(VCC)`). A gate with **no power pins**
/// (`d == 0 && e == 0`) falls back to the **legacy** `value` rail referenced to ground —
/// bit-identical to the pre-power model, which is what keeps the golden and the existing
/// gate tests unchanged.
#[inline]
fn gate_rails(el: &Element, node_v: &[f64]) -> (f64, f64) {
    if el.d == 0 && el.e == 0 {
        (0.0, el.value)
    } else {
        (node_v[el.e], node_v[el.d])
    }
}

/// Minimum rail (`v_high − v_low`, volts) for a powered gate to operate. Below it the IC
/// is treated as **unpowered** and releases its output (high-impedance `Z`) rather than
/// driving — so a gate whose VCC pin is left unwired (its node floats to ~0 V) sits dead,
/// the "you must power the chip" lesson. Legacy `value`-rail gates sit far above this.
const GATE_MIN_RAIL: f64 = 0.3;

/// **Transformer** (ideal-T model). The first four-terminal element: primary
/// `a`/`b`, secondary `c`/`d`. Its `value` is the turns ratio `n = Ns/Np`. A
/// magnetising inductance [`TRANSFORMER_L1`] in series with the primary winding
/// resistance [`TRANSFORMER_RWIND`] sits across the primary; the ideal coupling
/// *forces* the secondary EMF to `n · V_Lm` — n times the voltage across the
/// magnetiser — a HARD differential (no series *resistance*) with only a small series
/// [`TRANSFORMER_LLEAK`] leakage inductance, while the secondary current reflects
/// `n·Is` back into the primary KCL. It carries **two** branch unknowns — the
/// magnetising current `Im` (a->b) and the secondary current `Is` (c->d) — and **both**
/// are reactive backward-Euler companions (`Im` the magnetiser, `Is` the leakage). So
/// it blocks DC (as the magnetiser saturates, `V_Lm -> 0` and the secondary collapses),
/// draws a real magnetizing current, and scales AC by the turns ratio. Crucially the
/// forced secondary EMF is a HARD voltage differential (like a real source), so a
/// diode bridge across it rectifies full-wave — a softer secondary (a raw coupled-
/// inductor pair, or an EMF with series winding *resistance*) sags under the bridge's
/// asymmetric load and degenerates to half-wave or latches a runaway
/// (`docs/sim/transformer-bridge-convergence.md`). The leakage *inductance* is the
/// exception that is safe: zero drop at DC (so it never sags the differential), it only
/// limits the secondary's di/dt — which tames the rectifier inrush into an empty
/// reservoir cap and conditions the otherwise-bare secondary row. Linear (no Newton);
/// keeps **two** reactive states (magnetiser + secondary leakage). The branch pair is
/// allocated consecutively in [`Sim::install`]: `branch_index[i]` is the magnetiser,
/// `branch_index[i] + 1` the secondary.
pub const ELEM_TRANSFORMER: u8 = 18;

/// Transformer **magnetising** inductance, in henries (fixed) — the shunt branch of
/// the ideal-T model. High enough that the magnetizing current is modest at audio
/// frequencies (so the secondary EMF `n · V_Lm` tracks `n · Vp` cleanly) while
/// staying within the inductor range the dense solve already conditions for. The
/// secondary is coupled ideally (turns ratio `n`) as a hard differential with no
/// winding *resistance*; its only series term is the small [`TRANSFORMER_LLEAK`]
/// leakage inductance (which limits inrush with zero DC drop). The primary-side
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

/// Transformer **secondary** leakage inductance, in henries (fixed) — a small series
/// inductance on the secondary branch. Unlike a series *resistance* (which sags the
/// EMF under load and degenerates the bridge to half-wave — see [`TRANSFORMER_RWIND`]),
/// a leakage inductance has **zero voltage drop at DC/steady state**, so it leaves the
/// hard turns-ratio differential — and full-wave rectification — intact. What it does
/// do is limit the secondary current's `di/dt`, which **tames the rectifier inrush**
/// when a diode bridge charges an empty reservoir capacitor: without it the hard,
/// zero-impedance secondary drives a near-impulse into the cap (a stiff, ill-
/// conditioned solve that stays bounded on one platform but can diverge on another).
/// It is the textbook source impedance that sets a real rectifier's conduction angle.
/// Small (a fraction of [`TRANSFORMER_L1`], i.e. a tight coupling k≈1) so AC turns-
/// ratio scaling stays clean. Makes the secondary current `Is` a second reactive state.
const TRANSFORMER_LLEAK: f64 = 5.0e-3;

/// **D flip-flop** (edge-triggered one-bit memory — the first *sequential* element).
/// Four terminals: output `a` = `Q`, input `b` = `D` (data), input `c` = `CLK`
/// (clock), output `d` = `Q̄` (the complement). Its `value` is the logic-high rail,
/// shared with the gate family (inputs thresholded at [`GATE_VTH_FRAC`] of it, the
/// outputs driven through [`GATE_GOUT`]). On each **rising edge** of `CLK` it samples
/// `D` into a stored bit; otherwise it holds. The outputs are driven from the
/// **committed** bit (a constant Thévenin stamp, exactly the gate's shape, so it adds
/// no Newton work), and the bit is updated once per step in the commit phase from the
/// solved `CLK`/`D` — giving a clean one-tick clock-to-output delay. The stored output
/// level (`ff_q`) and the previous clock level (`ff_clk_prev`) are persistent four-state
/// [`Level`] state that **enters the snapshot hash**, so a rewind landing on a clock
/// edge replays identically. Wire `Q̄ → D` for a toggle (÷2), the seed of every counter.
/// Driven through the resolved digital domain (see [`Sim::eval_digital`]).
pub const ELEM_DFF: u8 = 19;

/// **Level shifter** (a digital interface part). Two terminals: output `a`, input `b`.
/// It reads the input net's logic level at the **input rail** `value` (rail A) and
/// re-drives the output at the **output rail** `aux` (rail B) — translating a low-rail
/// signal to a clean high-rail one and vice versa (the part that lets a 1.8 V sensor
/// talk to a 5 V MCU). Handled by the digital engine as a buffer with two rails: an
/// Ideal-family receiver at rail A, an Ideal-family driver at rail B. The analog↔digital
/// conversion lives in its pins (receiver in, driver out) like every digital part. Adds
/// no Newton work and no branch unknown.
pub const ELEM_LEVELSHIFT: u8 = 20;

/// **Pull-up** (a one-terminal analog convenience — *not* a domain boundary; the
/// boundary is the gate/shifter pins). Its single terminal `a` is pulled toward an
/// internal supply at `value` volts through a fixed resistance [`PULLUP_R`] — exactly a
/// resistor from the net to `Vcc`. The companion to an open-drain ([`gate_open_drain`])
/// bus: when every open-drain driver releases, the pull-up sets the net's voltage to the
/// rail (which the readers then quantise High); when any pulls low, its stiff ~1 Ω wins.
/// A constant linear Thévenin stamp (`g` to ground + `g·value` injection), no branch
/// unknown.
pub const ELEM_PULLUP: u8 = 21;

/// Fixed pull-up resistance in ohms (the I²C / interrupt-line norm). Weak enough that an
/// open-drain low pull (~1 Ω) dominates it, stiff enough to take a released net to the
/// rail well within a tick.
const PULLUP_R: f64 = 4_700.0;

/// **Clocked sampler / 1-bit comparator** — the keystone atom of the ADC / sample-and-hold
/// / SAR cluster. A near-twin of the [`ELEM_DFF`] (model it on the same machinery), but its
/// data input is a continuous **analog** sense node rather than a logic pin. Three terminals:
/// output `a` = `OUT` (a digital output), input `b` = `IN` (the analog signal sensed), input
/// `c` = `CLK` (the clock); `d` and `e` are unused (ground). Its `value` is the **threshold
/// voltage** (V) and its `aux` is the **output logic-high rail** (V) — when `aux <= 0` it
/// defaults to [`SAMPLER_VHIGH_DEFAULT`] so a sampler with no rail set still drives a clean
/// logic level. On each **rising edge** of `CLK` (`Low -> High`, detected exactly like the
/// flip-flop via a persistent previous-clock level) it latches a one-bit comparison of the
/// analog input against the threshold: `OUT = High` if `V(IN) > value`, else `Low`. Otherwise
/// it holds. The output is driven from the **committed** bit through the same digital-drive
/// path the flip-flop uses (`FAMILIES[0].drive_level(samp_q, rail)`), a constant Thévenin
/// stamp within the solve — so it adds **no** Newton work and **no** branch unknown, and gives
/// a clean one-tick clock-to-output delay (the bit is updated once per step in the commit
/// phase from the solved `CLK`/`IN`). It keeps two persistent four-state [`Level`] scalars —
/// the stored output bit (`samp_q`) and the previous clock level (`samp_clk_prev`) — that
/// **enter the snapshot hash**, so a rewind landing on a clock edge replays identically.
///
/// The **boundary** nature: `OUT` (a) and `CLK` (c) are digital signal pins, but `IN` (b) is a
/// high-Z analog **sense** node — it is *not* driven and does *not* engage Newton (the sampler
/// is a constant stamp within a tick, exactly like the flip-flop). In [`classify_nets`] `IN` is
/// therefore marked **analog-touching** (so a net touching only `IN` is `Analog`, and a node
/// shared with an analog element and a digital pin is `Boundary` — the comparator pattern),
/// mirroring how a powered gate's VCC/GND pins are kept analog. A flash ADC is N samplers at
/// different `value` taps; a sample-and-hold and a SAR build on this same latch-on-clock atom.
/// Driven through the resolved digital domain (see [`Sim::eval_digital`]).
pub const ELEM_SAMPLER: u8 = 22;

/// Default output logic-high rail (volts) for an [`ELEM_SAMPLER`] whose `aux` is unset
/// (`<= 0`). A sane logic level (the common bench 5 V rail) so a sampler still drives a clean
/// `OUT` without an explicit rail. A sampler that sets `aux > 0` overrides it per device.
const SAMPLER_VHIGH_DEFAULT: f64 = 5.0;

/// The output logic-high rail (volts) a clocked sampler ([`ELEM_SAMPLER`]) drives `OUT` to:
/// its `aux` when set (`> 0`), else [`SAMPLER_VHIGH_DEFAULT`]. Used by both the digital drive
/// ([`Sim::eval_digital`]) and the OUT current readout so they agree on the rail.
#[inline]
fn sampler_rail(el: &Element) -> f64 {
    if el.aux > 0.0 {
        el.aux
    } else {
        SAMPLER_VHIGH_DEFAULT
    }
}

/// **Latched comparator** — an analog comparator with a powered rail-to-rail output and a
/// level-sensitive latch, modelled on the Analog Devices **ADCMP601**. It is the *analog* twin
/// of the clocked sampler ([`ELEM_SAMPLER`]): both latch a one-bit decision and drive it through
/// a constant digital stamp, but where the sampler compares one analog input against a fixed
/// threshold on a clock **edge**, the comparator compares **two** analog inputs against each
/// other under a **level**-sensitive enable, and its output stage is **powered** like a logic
/// gate ([`ELEM_GATE`]) rather than ground-referenced.
///
/// **Six terminals** (uses the wider 8-terminal format): output `a` = `OUT` (`Q`, a digital
/// output), input `b` = `IN+` (`VP`), input `c` = `IN-` (`VN`), `d` = `VCC` (the positive
/// supply), `e` = `GND` (`VEE`, the output's low reference), `f` = `LE` (the latch enable);
/// `g`/`h` are unused (ground). Its `value` is the **hysteresis band** `V_H` in volts (default
/// `0` ⇒ a clean compare with no dead-band — the golden-safe simple case); `aux` is unused.
///
/// **Front end** (evaluated in the commit phase from the just-solved committed node voltages,
/// exactly where the sampler latches):
/// 1. `rail = V(d) − V(e)`. If `rail < `[`GATE_MIN_RAIL`] the chip is **unpowered** — the held
///    bit is left as-is and the output reads dead/released (a powered gate's dead-rail rule).
/// 2. **Latch (level-sensitive, ACTIVE-LOW):** the front end is *transparent* when `LE` is
///    unwired (`f == 0`, the ADCMP601 floating default) or driven at/above half-rail
///    (`V(f) − V(e) >= 0.5·rail`); driven **below** half-rail it is *latched* and the bit holds.
/// 3. While transparent, apply **symmetric hysteresis** about zero to `diff = V(IN+) − V(IN-)`,
///    using the current held bit (`cmp_q`) as the Schmitt state: flip to `High` when
///    `diff > V_H/2`, to `Low` when `diff < −V_H/2`, else hold. With `value` = `0` this is a
///    plain comparator (`diff > 0` → High, `diff < 0` → Low).
///
/// **Output stage:** `OUT` (`a`) is driven from the committed bit through the **same powered
/// gate output path** the gate uses — it swings between `V(e)` (low) and `V(d)` (high) via the
/// [`digital_vlow`](Sim::digital_vlow) GND-offset mechanism and the family driver, and releases
/// (high-Z `Z`) when the rail collapses, just like a dead-rail gate. A constant Thévenin stamp
/// within the solve (no Newton, no branch unknown; one tick of input-to-output delay).
///
/// **Boundary nature** (mirrors the sampler / a powered gate): `OUT` (`a`) and `LE` (`f`) are
/// digital signal pins; `IN+` (`b`) and `IN-` (`c`) are high-Z analog **sense** nodes (marked
/// analog-touching in [`classify_nets`], so a comparator input net is Analog and a node it
/// shares with a digital pin is Boundary); `VCC` (`d`) / `GND` (`e`) are analog supply pins
/// (handled exactly like a powered gate's power pins). The single persistent four-state
/// [`Level`] scalar `cmp_q` (the held output bit) **enters the snapshot hash**, so a rewind
/// replays identically.
pub const ELEM_COMPARATOR: u8 = 23;

/// **Gated analog switch / transmission gate** (a CD4066-style bilateral switch) — the
/// signal-gated pass element the sample-and-hold, switched-capacitor, analog-mux, and VCO
/// clusters need. It is the **node-controlled** cousin of the clock-driven [`ELEM_SWITCH`]:
/// where that switch's conductance is a pure function of [`Sim::tick`] (a fixed-period PWM),
/// this one's open/closed state is driven by a **control node** carrying a logic signal — so
/// it can be steered by a clock generator, a flip-flop, a comparator, or any digital pin.
///
/// **Five terminals:** the **switched analog path** is `a` ↔ `b` (a resistor between them when
/// the switch is ON, symmetric like [`ELEM_RESISTOR`]/[`ELEM_SWITCH`]); `c` = `CTRL` (the
/// digital control input that opens/closes the path); `d` = `VCC`; `e` = `GND` (the supply
/// pins, read exactly like a powered gate's). `f`/`g`/`h` are unused (ground). Its `value` is
/// the **on-resistance `R_on`** in ohms; `value <= 0` defaults to [`ASWITCH_RON`].
///
/// **A LINEAR, time-varying conductance — not Newton.** Exactly like [`ELEM_SWITCH`], it stamps
/// a symmetric conductance between `a` and `b` (no branch unknown, no reactive state), so it
/// stays on the linear fast path and composes with nonlinear devices by sitting in the fixed
/// Newton base. The only difference from the clock switch is **where the on/off comes from**:
/// the control is read from the **committed previous-tick** node voltages ([`Sim::node_v`], the
/// same one-tick delay the digital engine uses for a gate input), so the conductance is a
/// *constant within the solve* (it never makes the system non-linear or iterate). Determinism:
/// the state is a deterministic function of the committed `node_v` — itself already hashed — so
/// the switch introduces **no new hashed state** and the snapshot hash is unchanged.
///
/// **The on/off rule** (see [`Sim::aswitch_closed`]), mirroring [`gate_rails`] /
/// [`GATE_MIN_RAIL`]:
/// - **Powered, active-high** (the normal case): `rail = V(d) − V(e)`; when
///   `rail >= `[`GATE_MIN_RAIL`] the switch is **ON** iff `V(c) − V(e) > 0.5·rail` (control
///   above half-rail, referenced to the chip's GND), exactly like a powered gate's input
///   threshold. An unwired VCC floats to ~0 V → `rail < GATE_MIN_RAIL` → the switch is **dead**
///   (forced open), the "you must power the chip" lesson the powered gate teaches.
/// - **Unpowered fallback** (`d == 0 && e == 0`, no power pins wired): the switch is **ON** iff
///   `V(c) > `[`ASWITCH_FIXED_THRESH`] — a bare control level against a fixed threshold, so an
///   unwired-rail analog switch still works off a plain logic signal (mirrors how a powerless
///   gate falls back to its legacy `value` rail).
///
/// **ON** stamps `g = 1/R_on` between `a` and `b` (the standard symmetric resistor stamp);
/// **OFF** stamps the tiny [`SWITCH_GOFF`] leak (matching [`ELEM_SWITCH`]'s open behaviour) so
/// the node stays non-singular. Wire a source → ASWITCH → a capacitor and pulse `CTRL` to build
/// a sample-and-hold: the cap charges toward the source while the switch is ON and **holds** its
/// voltage (its backward-Euler companion keeps the charge) once the switch opens and isolates it.
pub const ELEM_ASWITCH: u8 = 24;

/// Default on-resistance of a closed [`ELEM_ASWITCH`], in ohms, used when its `value <= 0`.
/// Larger than the clock switch's near-ideal [`SWITCH_RON`] because a real transmission gate
/// (CD4066 ~ 80–125 Ω, 74HC4066 similar) has a non-trivial channel resistance — small enough to
/// pass a signal cleanly into a high-impedance load, large enough to be a teachable non-ideality.
const ASWITCH_RON: f64 = 100.0;

/// Fixed control threshold (volts) for an **unpowered** [`ELEM_ASWITCH`] (no VCC/GND pins wired,
/// `d == 0 && e == 0`): the switch closes when its control `V(c)` exceeds this. A sane logic
/// mid-level so a bare control swing (0 V / 3.3–5 V) drives it cleanly. A powered analog switch
/// instead thresholds at half its actual rail (see [`ELEM_ASWITCH`] / [`GATE_MIN_RAIL`]); this is
/// only the fallback, the analogue of a powerless gate's legacy `value`-rail threshold.
const ASWITCH_FIXED_THRESH: f64 = 1.5;

/// **Behavioral block** — the protocol / behavioral engine's element (ADR 0004,
/// `docs/sim/multi-rate-domains.md`). A clocked, integer-state machine that runs **beside**
/// the analog MNA solve and talks to it only at its boundary pins: each tick it reads its
/// input pins as logic levels, advances a fixed block of **integer** internal state, and
/// drives its powered digital outputs from that committed state — the digital twin of the
/// gate/sampler/DFF mechanism, generalised to a small programmable state machine. This is
/// **phase 1**: it runs at the **base tick rate** (one step per analog tick — multi-rate
/// sub-ticking is phase 2 and deliberately not here), so it is slow but functional, proving
/// the engine end to end.
///
/// **Program-id dispatch.** Its `value` is a **program id** selecting which firmware the block
/// runs (`1` = SPI master, `2` = SPI slave, `3` = UART, `4` = FPGA logic element; the dispatch
/// stays open for I2C and a tiny MCU — one engine, many behaviors, the way `PULSE`/`SHUNT`/`LOAD`
/// overload an existing element). Its `aux` is the **data word to transmit** (treated as an
/// integer, `aux as u64`) for the serial programs, or the **16-entry truth table** for the LUT
/// (program 4). Timing is structural: `params[0]` is the SCLK **half-period in analog ticks**
/// (the clock divider; `<= 0` defaults to [`BEH_SPI_HALF_DEFAULT`]) and `params[1]` is the
/// **bit count** (`<= 0` defaults to [`BEH_SPI_NBITS_DEFAULT`]). Timing comes **only** from
/// these declared params — never from a solved voltage (the determinism contract:
/// structure, not values).
///
/// **Internal state** is a fixed `[u32; `[`BEH_STATE_WORDS`]`]` block per element (`beh_state`,
/// beside `samp_q`), **integer only** (no floats, no PRNG, no std hasher), zero-initialised and
/// **folded into the snapshot hash** in fixed element + word order, appended after the existing
/// folds — so a circuit with no behavioral block (the RC golden, every existing test) folds
/// **zero** extra bytes and the golden is byte-identical by construction. The SPI **master**
/// program (1) uses the first eight words as `[0]=fsm`, `[1]=bit_index`, `[2]=shift_out`,
/// `[3]=shift_in`, `[4]=clk_counter`, `[5]=sclk_level`, `[6]=cs_level`, `[7]=start_prev` (see
/// [`beh_spi_step`]); the SPI **slave** (2, [`beh_spi_slave_step`]), the **UART** (3,
/// [`beh_uart_step`]) and the **FPGA logic element** (4, [`beh_lut_step`] — words `[0]=Q`,
/// `[1]=clk_prev`, or none at all in combinational mode) each lay the same
/// `[u32; `[`BEH_STATE_WORDS`]`]` block out their own way — every program runs alone in its
/// element, so the word maps need not agree.
///
/// **SPI master pinout (program 1)** — uses the wider 8-terminal format: `a` = `SCLK` (out),
/// `b` = `MOSI` (out), `c` = `CS` (out, active-low), `d` = `VCC`, `e` = `GND`, `f` = `MISO`
/// (in), `g` = `START` (in); `h` is unused (ground). The three outputs `a`/`b`/`c` are
/// **powered digital** — they swing `V(e) .. V(d)` through the **same powered-gate output path**
/// the gate/comparator use (rail from [`gate_rails`]; an unpowered rail below [`GATE_MIN_RAIL`]
/// releases them, the "you must power the chip" rule). The two inputs `f`/`g` are read as digital
/// levels (quantised against half-rail relative to GND on `e`, see [`beh_level`]). Like every
/// digital element the analog↔digital crossing lives in its pins; the within-tick stamp is a
/// constant (no Newton, no branch unknown, one tick of state-to-output delay).
///
/// **SPI master state machine (Mode 0: CPOL=0, CPHA=0)** — advanced once per step in the commit
/// phase from the just-solved committed `node_v` (mirroring where `samp_q`/`cmp_q` update):
/// idle holds SCLK low and CS high; a **rising START edge** loads `shift_out = aux & mask`,
/// asserts CS low, and enters the active state; the active state presents the current MOSI bit
/// **MSB-first**, generates SCLK by counting `clk_counter` to the half-period and toggling,
/// **samples MISO on each rising SCLK edge** (shift-left + OR) and **advances the bit on each
/// falling edge**, and after the configured bit count deasserts CS and returns to idle with the
/// received word in `shift_in`. See [`beh_spi_step`] for the exact Mode-0 edge bookkeeping.
///
/// **FPGA logic element (program 4)** — the universal digital primitive (ADR 0004 phase 4, the
/// `FP` part): a **4-input lookup table** whose 16-entry **truth table** is `aux`'s low 16 bits.
/// The output `a` is `bit[index]` of the table, `index = IN0 | IN1<<1 | IN2<<2 | IN3<<3` from the
/// inputs `IN0` = `f`, `IN1` = `g`, `IN2` = `h`, `IN3` = `c` (each a digital level at half-rail
/// relative to `GND`). Every ≤4-input gate is one particular truth table, so a single element
/// teaches *all* of them (AND = `0x8888`, XOR = `0x6666`, the 3-input majority = `0xE8E8`, …).
/// `params[`[`BEH_LUT_MODE_SLOT`]`]` selects the **output mode**: combinational (the default — the
/// output follows the live inputs through the **same digital sub-solve** a gate settles in, no
/// clock-to-output delay) or **registered** (`>= 1` — the lookup is latched into `Q` on each rising
/// `CLK` = `b` edge and the output drives that held bit, a LUT followed by a flip-flop). A LUT+FF
/// "logic element" is the fundamental FPGA building block; a fabric of them is **any** sequential
/// machine — the honest realization of phase 4's "cycle-stepped state machine / soft core" (an FPGA
/// has no ISA; it has LUTs). The output is powered exactly like the serial programs (swings
/// `V(e) .. V(d)`, released below [`GATE_MIN_RAIL`]); a combinational LUT folds a zero state block
/// (golden-safe by construction), a registered one folds `Q`/`clk_prev`. See [`beh_lut_step`].
pub const ELEM_BEHAVIORAL: u8 = 25;

/// Width of an [`ELEM_BEHAVIORAL`] block's integer internal-state array — the number of `u32`
/// words each behavioral block carries (and folds into the snapshot hash in word order). Fixed
/// so every program shares one state shape; **each program lays the words out independently**
/// (only one program ever runs per element): the SPI master (program 1) uses words 0..8 (see
/// [`beh_spi_step`]), the SPI slave (program 2) words 0..6 (see [`beh_spi_slave_step`]), and the
/// **UART** (program 3) words 0..12 — TX *and* RX run concurrently in one block, so it needs both
/// engines' counters/shift-registers side by side (see [`beh_uart_step`]). Sixteen is comfortably
/// enough for that widest program (a full-duplex shift-register protocol) without bloating the
/// per-tick hash fold. Widening from the original eight is **golden-safe**: no golden circuit
/// carries a behavioral block, so the RC golden folds zero extra bytes and
/// `0xeaac_3764_99e4_fa24` is byte-identical; program 1's word map (0..8) is unchanged.
pub const BEH_STATE_WORDS: usize = 16;

/// **Behavioral MEMORY array** (`docs/memory-characterization-design.md`). A word-addressable
/// ROM / RAM / EEPROM / DRAM whose contents live in a ragged heap store (`mem_data`), NOT the MNA
/// matrix — so a multi-MB array stamps identically to a few bytes and per-tick cost is
/// O(accesses), not O(bits). Id **26**, appended after [`ELEM_BEHAVIORAL`] = 25 (append-only: no
/// existing id moves, so a circuit with no memory element folds zero extra bytes and the golden is
/// byte-identical). Structural params: slot 0 = `mode` (0 ROM / 1 RAM / 2 EEPROM / 3 DRAM), slot 1 =
/// `addrWidth` (depth = `2^addrWidth`), slot 3 = `wordWidth` (slot 2 is left at 0 = unrated, the
/// general [`RATED_CURRENT_SLOT`]). Deliberately **not** in [`is_nonlinear`] — reads are a constant
/// Thévenin stamp, so memory-only circuits stay on the linear fast path. P1 lays the storage + the
/// incremental hash digest + `load_memory`; the terminal-driven read/write step and the
/// characterization collapse land in later phases.
pub const ELEM_MEMORY: u8 = 26;

/// Behavioral SPI master — default SCLK **half-period in analog ticks** when `params[0] <= 0`.
/// A full SCLK period is `2 ·` this; with [`DT`] = 2 µs the default 4 → an 8 µs period
/// (125 kHz). Purely structural (a clock divider), so the bus timing is deterministic and never
/// depends on a solved voltage.
const BEH_SPI_HALF_DEFAULT: u32 = 4;

/// Behavioral SPI master — default **bit count** per transaction when `params[1] <= 0` (a byte).
const BEH_SPI_NBITS_DEFAULT: u32 = 8;

/// Behavioral SPI master — maximum bit count, clamping `params[1]` so a `shift_out`/`shift_in`
/// word stays within the 32-bit state slots and the MSB-first index arithmetic can never
/// underflow. Deterministic structural bound (32 bits).
const BEH_SPI_NBITS_MAX: u32 = 32;

/// SPI-master internal-state word indices into an [`ELEM_BEHAVIORAL`]'s `[u32; BEH_STATE_WORDS]`
/// block (program 1). `FSM`: 0 = idle, 1 = active. The rest are the shift-register engine's
/// counters/registers and the edge-detection companion (`START_PREV`).
const BEH_SPI_FSM: usize = 0;
const BEH_SPI_BIT_INDEX: usize = 1;
const BEH_SPI_SHIFT_OUT: usize = 2;
const BEH_SPI_SHIFT_IN: usize = 3;
const BEH_SPI_CLK_COUNTER: usize = 4;
const BEH_SPI_SCLK_LEVEL: usize = 5;
const BEH_SPI_CS_LEVEL: usize = 6;
const BEH_SPI_START_PREV: usize = 7;

/// Program id selecting the **SPI master** firmware for an [`ELEM_BEHAVIORAL`] (its `value`).
/// `0` (or any unrecognised id) is an **inert** behavioral block — it advances no state and
/// drives nothing, so it folds a zero state block and is golden-safe. Further programs take
/// the next ids.
const BEH_PROG_SPI_MASTER: u32 = 1;
/// Program id selecting the **SPI slave** firmware (program 2) — the receiving end of the
/// phase-1 SPI master, Mode 0. See [`beh_spi_slave_step`].
const BEH_PROG_SPI_SLAVE: u32 = 2;
/// Program id selecting the **UART** firmware (program 3) — async TX+RX in one block. See
/// [`beh_uart_step`].
const BEH_PROG_UART: u32 = 3;
/// Program id selecting the **FPGA logic element** firmware (program 4) — a 4-input lookup table
/// with an optional registered output (ADR 0004 phase 4, the `FP` part). See [`beh_lut_step`].
const BEH_PROG_LUT: u32 = 4;
/// Program id selecting the **3-bit flash ADC** firmware (program 5) — a parallel quantizer: the
/// analog input on `f` measured against the reference span (the VREF pin `g` above GND, or the VCC
/// rail if VREF is unwired) and encoded to a 3-bit code driving D0/D1/D2 on `a`/`b`/`c`. Purely
/// combinational (no state block), so it runs in `eval_digital` only and folds a zero state block —
/// golden-safe additive. See [`beh_flash_adc_code`]. (The teaching flash ADC, pairing with the DAC.)
const BEH_PROG_FLASH_ADC: u32 = 5;
/// Program id selecting the **3-bit SAR ADC** firmware (program 6) — a clocked successive-
/// approximation converter (the CEC1108). On each rising `CLK` (`h`) it decides one result bit
/// most-significant first by comparing the analog input `VIN` (`f`) against an internal trial R-2R
/// DAC level (`trial / 8` of the `VCC` rail, the single-supply reference) — keeping the bit when
/// `VIN` is at or above it, dropping it otherwise. After 3 clocks the register holds
/// `floor(8 * VIN / VCC)` clamped `0..=7` (the SAME code the flash ADC finds in parallel) and `DONE`
/// (`g`) goes high until the next conversion starts. Unlike the combinational flash ADC it carries
/// integer state (the result register, the step counter, the done flag, the CLK edge companion),
/// advanced in the commit phase. See [`beh_sar_adc_step`]. (The teaching SAR ADC, the speed-vs-parts
/// opposite of the flash CEC1080: one comparator + one DAC, but N clocks per conversion.)
const BEH_PROG_SAR_ADC: u32 = 6;
/// Program id selecting the **3-bit binary counter** firmware (program 7) — a clocked up-counter, the
/// fundamental sequential building block (a free-running register that increments). On each rising
/// `CLK` (`f`) it advances `count = (count + 1) mod 8`, driving the three bits on `Q0`/`Q1`/`Q2`
/// (`a`/`b`/`c`) — so it uses the GENERIC a/b/c output path (no special drive branch, unlike the SAR's
/// fourth output). `RESET` (`g`, active-high) asynchronously clears the count to 0; unwired (`g` =
/// ground) it reads low, so a counter with no reset wired simply free-runs. State is the count register
/// and the CLK edge companion, advanced in the commit phase. Drive a DAC from `Q0..Q2` for a
/// ramp/sawtooth generator; it also underlies timers, frequency dividers, sequencers, memory addressing
/// and the sigma-delta decimator. See [`beh_counter_step`].
const BEH_PROG_COUNTER: u32 = 7;
/// Program id selecting the **1st-order sigma-delta ADC** firmware (program 8) — the oversampling
/// converter, completing the trilogy beside flash (parallel) and SAR (binary search). A 1-bit
/// **modulator** runs fast: an integrator accumulates `VIN - feedback`, a 1-bit comparator slices its
/// sign, and that bit feeds back (subtracting full-scale when high), so the loop forces the **density
/// of 1s** in the bit stream to equal `VIN/VCC` (noise-shaped — the quantisation error is pushed to
/// high frequency). A **decimator** then just counts the 1s over `SD_DECIM` modulator clocks to get a
/// multi-bit code. So: oversample to a 1-bit stream, then count — high resolution from a 1-bit slicer.
/// The 1-bit stream is exposed on `BS` (`g`, a fourth output) so its density is visible; the decimated
/// code drives D0/D1/D2 (`a`/`b`/`c`). VCC is the full-scale reference. The integrator is fixed-point
/// integer state (so it is deterministic and hashable). See [`beh_sigma_delta_step`].
const BEH_PROG_SIGMA_DELTA: u32 = 8;

// --- Behavioral program 2: SPI slave (Mode 0) ---------------------------------

/// SPI-**slave** internal-state word indices (program 2) into an [`ELEM_BEHAVIORAL`]'s
/// `[u32; `[`BEH_STATE_WORDS`]`]` block — a fresh layout (every program runs alone in its
/// element). The slave is the receiving end of the phase-1 master (Mode 0): it watches the
/// driven `SCLK`/`MOSI`/`CS` pins and shifts MOSI in MSB-first on each SCLK **rising** edge while
/// `CS` is asserted (low), presenting its reply word (`aux`) on `MISO` MSB-first so a master can
/// read it back. `BIT_INDEX` counts the rising edges already taken in the current frame (the next
/// reply/receive bit position); `RX_WORD` latches the completed receive word; `RXVALID` holds
/// high from a completed word until `CS` deasserts (the receiver's data-ready pulse for one
/// transaction); `SCLK_PREV`/`CS_PREV` are the edge-detection companions.
const BEH_SLV_SCLK_PREV: usize = 0;
const BEH_SLV_BIT_INDEX: usize = 1;
const BEH_SLV_SHIFT_IN: usize = 2;
const BEH_SLV_RX_WORD: usize = 3;
const BEH_SLV_RXVALID: usize = 4;
const BEH_SLV_CS_PREV: usize = 5;

/// The SPI slave's bit count (`params[1]`, defaulting to [`BEH_SPI_NBITS_DEFAULT`] and clamped to
/// [`BEH_SPI_NBITS_MAX`]) — the **structural** frame width, read once so the receive and the
/// `MISO` reply agree. The slave is clocked entirely by the incoming `SCLK`, so it has no
/// half-period of its own (`params[0]` is unused). Never a function of a solved voltage.
#[inline]
fn beh_spi_slave_nbits(el: &Element) -> u32 {
    if el.params[1] >= 1.0 {
        (el.params[1] as u32).min(BEH_SPI_NBITS_MAX)
    } else {
        BEH_SPI_NBITS_DEFAULT
    }
}

/// The `MISO` bit the SPI slave currently presents (MSB-first) from its **committed** state: the
/// reply word `aux`'s bit at position `nbits-1-bit_index`, where `bit_index` is the count of
/// SCLK rising edges already taken this frame. Driven only while `CS` is asserted (`cs_prev == 0`,
/// i.e. CS was low at the last commit); idle/deasserted presents `0`. Pure integer arithmetic on
/// the hashed state — the same `bit_index` the commit step advances, so the reply a master samples
/// on the rising edge is exactly the slave's next reply bit (the link is full-duplex).
#[inline]
fn beh_spi_slave_miso_bit(state: &[u32; BEH_STATE_WORDS], reply: u64, nbits: u32) -> bool {
    if state[BEH_SLV_CS_PREV] != 0 {
        return false; // CS deasserted → MISO idle low.
    }
    let bit_index = state[BEH_SLV_BIT_INDEX].min(nbits.saturating_sub(1));
    let shift = nbits - 1 - bit_index;
    (reply >> shift) & 1 != 0
}

/// Advance a behavioral **SPI slave**'s integer state machine by one analog tick (Mode 0:
/// CPOL = 0, CPHA = 0), reading the just-solved committed input levels (`sclk`, `mosi`, `cs`).
/// Mirrors the master's edge bookkeeping from the other side of the bus (all integer, fully
/// deterministic):
/// - **Deasserted** (`cs == true`, CS high): the receiver is reset — `bit_index`/`shift_in`
///   cleared and `SCLK_PREV` tracked — and on the **rising CS edge** (the frame ending) `RXVALID`
///   is cleared, so the data-ready pulse lasts exactly from a completed word until CS releases.
/// - **Asserted** (`cs == false`, CS low): on a **rising SCLK edge** (`sclk && !sclk_prev`) shift
///   `MOSI` into `shift_in` (MSB-first, shift-left + OR), then advance `bit_index`; once `nbits`
///   bits have been clocked latch `shift_in` into `RX_WORD`, raise `RXVALID`, and reset
///   `bit_index`/`shift_in` for a back-to-back next frame. `MISO` is presented combinationally
///   from `bit_index` by [`beh_spi_slave_miso_bit`] (the reply word's bits MSB-first), so a
///   Mode-0 master sampling on the same rising edge reads reply bit `bit_index`.
///
/// `SCLK_PREV`/`CS_PREV` are always updated last so the next tick can detect the next edges.
/// Mutates `state` in place (the only mutation site, run in the commit phase).
fn beh_spi_slave_step(
    state: &mut [u32; BEH_STATE_WORDS],
    nbits: u32,
    sclk: bool,
    mosi: bool,
    cs: bool,
) {
    if cs {
        // Deasserted: receiver reset; clear RXVALID on the CS rising edge (frame end).
        if state[BEH_SLV_CS_PREV] == 0 {
            state[BEH_SLV_RXVALID] = 0;
        }
        state[BEH_SLV_BIT_INDEX] = 0;
        state[BEH_SLV_SHIFT_IN] = 0;
    } else {
        // Asserted: sample MOSI on each rising SCLK edge, MSB-first.
        if sclk && state[BEH_SLV_SCLK_PREV] == 0 {
            state[BEH_SLV_SHIFT_IN] = (state[BEH_SLV_SHIFT_IN] << 1) | (mosi as u32);
            state[BEH_SLV_BIT_INDEX] += 1;
            if state[BEH_SLV_BIT_INDEX] >= nbits {
                state[BEH_SLV_RX_WORD] = state[BEH_SLV_SHIFT_IN];
                state[BEH_SLV_RXVALID] = 1; // data-ready: held until CS deasserts
                state[BEH_SLV_BIT_INDEX] = 0; // ready for a back-to-back next frame
                state[BEH_SLV_SHIFT_IN] = 0;
            }
        }
    }
    state[BEH_SLV_SCLK_PREV] = sclk as u32;
    state[BEH_SLV_CS_PREV] = cs as u32;
}

// --- Behavioral program 3: UART (async, TX + RX in one block) -----------------

/// UART internal-state word indices (program 3) into an [`ELEM_BEHAVIORAL`]'s
/// `[u32; `[`BEH_STATE_WORDS`]`]` block — TX and RX run **concurrently** in one block, so each
/// engine gets its own counters/shift-register side by side (a fresh layout; every program runs
/// alone in its element). `TX_*` drive the `TX` pin; `RX_*` sample the `RX` pin. All structural
/// timing (the baud-tick counters) is integer and derived from `params`, never from a voltage.
const BEH_UART_TX_STATE: usize = 0; // 0 = idle (line mark/high), 1 = transmitting a frame
const BEH_UART_TX_BITPOS: usize = 1; // 0 = start bit, 1..=nbits = data bits, nbits+1 = stop bit
const BEH_UART_TX_BAUD: usize = 2; // ticks elapsed in the current bit
const BEH_UART_TX_SHIFT: usize = 3; // remaining data bits, LSB-first (shifted right as sent)
const BEH_UART_SEND_PREV: usize = 4; // previous SEND level (rising-edge trigger companion)
const BEH_UART_RX_STATE: usize = 5; // 0 = idle (awaiting start), 1 = sampling a frame
const BEH_UART_RX_BITPOS: usize = 6; // data bits sampled so far (0..nbits)
const BEH_UART_RX_BAUD: usize = 7; // ticks elapsed toward the next sample instant
const BEH_UART_RX_SHIFT: usize = 8; // data bits received so far, assembled LSB-first
const BEH_UART_RX_PREV: usize = 9; // previous RX level (falling-edge/start-bit companion)
const BEH_UART_RX_WORD: usize = 10; // latched received byte
const BEH_UART_RXVALID: usize = 11; // pulse: high for one tick when a byte latches

/// Default UART **baud divider** — analog ticks per bit when `params[0] <= 0`. The structural bit
/// period (a clock divider), so framing is deterministic and never a function of a solved voltage.
/// Sixteen ticks/bit is the classic 16× oversampling figure and keeps mid-bit RX sampling
/// (`baud/2`) well clear of the bit edges; with [`DT`] = 2 µs it is a 32 µs bit (~31.25 kbaud).
const BEH_UART_BAUD_DEFAULT: u32 = 16;
/// UART default **data bits** per frame when `params[1] <= 0` (a byte).
const BEH_UART_NBITS_DEFAULT: u32 = 8;
/// UART maximum data bits, clamping `params[1]` so a shift word stays within the 32-bit slot and
/// the LSB-first index arithmetic can never overflow. Deterministic structural bound (32 bits).
const BEH_UART_NBITS_MAX: u32 = 32;

/// The UART's baud divider (`params[0]`, defaulting, floored at 1 so a bit always spans ≥ 1 tick)
/// and data-bit count (`params[1]`, defaulting and clamped) as integers — the **structural**
/// framing, read once so the TX/RX engines and the line drive agree. Never a function of a solved
/// voltage.
#[inline]
fn beh_uart_config(el: &Element) -> (u32, u32) {
    let baud = if el.params[0] >= 1.0 {
        el.params[0] as u32
    } else {
        BEH_UART_BAUD_DEFAULT
    }
    .max(1);
    let nbits = if el.params[1] >= 1.0 {
        (el.params[1] as u32).min(BEH_UART_NBITS_MAX)
    } else {
        BEH_UART_NBITS_DEFAULT
    };
    (baud, nbits)
}

/// The level the UART currently drives on `TX` (its **committed** state): idle/mark is **high**;
/// while transmitting, the start bit (bitpos 0) is low, each data bit (bitpos `1..=nbits`) is its
/// LSB-first value from the shift register, and the stop bit (bitpos `nbits+1`) is high. Pure
/// integer arithmetic on the hashed state — the same bits the commit step shifts out, so the
/// drive and the bookkeeping stay in lockstep. Returns `true` for a high (mark) line.
#[inline]
fn beh_uart_tx_high(state: &[u32; BEH_STATE_WORDS], nbits: u32) -> bool {
    if state[BEH_UART_TX_STATE] != 1 {
        return true; // idle line = mark (high)
    }
    let bitpos = state[BEH_UART_TX_BITPOS];
    if bitpos == 0 {
        false // start bit (space/low)
    } else if bitpos <= nbits {
        // Data bit (LSB-first): the low bit of the remaining shift register.
        state[BEH_UART_TX_SHIFT] & 1 != 0
    } else {
        true // stop bit (mark/high)
    }
}

/// Advance a behavioral **UART**'s integer state machine by one analog tick — TX and RX both, from
/// the just-solved committed inputs (`send`, `rx`). All timing is integer (the baud-tick counters),
/// fully deterministic:
/// - **TX:** idle holds the line high (mark). On a **rising SEND edge** load `aux & mask` into the
///   shift register and begin a frame at the start bit. Each bit is held for `baud` ticks (counting
///   `TX_BAUD` up); when a bit completes, advance `TX_BITPOS` (shifting the data register right as
///   each data bit finishes) through start → `nbits` data bits (LSB-first) → stop, then return to
///   idle. The level for the current bit is presented by [`beh_uart_tx_high`].
/// - **RX:** idle watches `RX`; on its **falling edge** (a start bit) begin sampling and wait
///   **1.5 bit periods** (`baud + baud/2`) so the first sample lands in the middle of the first
///   data bit (half a bit to the start-bit midpoint, then a full bit to step over it). Then sample
///   each of `nbits` data bits at one-bit (`baud`) intervals, assembling LSB-first; after the last
///   data bit latch the byte into `RX_WORD` and pulse `RXVALID` high for one tick, then return to
///   idle (the stop bit is the idle/mark the next start-edge search runs against — standard mid-bit
///   sampling).
///
/// `SEND_PREV`/`RX_PREV` are updated last for the next tick's edge detection. `RXVALID` is cleared
/// at the top each tick so it is a one-tick pulse. Mutates `state` in place (the commit phase).
fn beh_uart_step(
    state: &mut [u32; BEH_STATE_WORDS],
    data: u64,
    baud: u32,
    nbits: u32,
    send: bool,
    rx: bool,
) {
    let mask: u64 = if nbits >= 32 {
        u64::MAX
    } else {
        (1u64 << nbits) - 1
    };
    let half = (baud / 2).max(1); // first-sample delay; ≥ 1 so RX always advances

    // RXVALID is a one-tick pulse: clear it, then any latch this tick re-raises it.
    state[BEH_UART_RXVALID] = 0;

    // --- TX engine ---
    if state[BEH_UART_TX_STATE] == 1 {
        state[BEH_UART_TX_BAUD] += 1;
        if state[BEH_UART_TX_BAUD] >= baud {
            state[BEH_UART_TX_BAUD] = 0;
            let bitpos = state[BEH_UART_TX_BITPOS];
            // The bit that just finished its `baud` ticks: if it was a data bit, drop it so the
            // next data bit's value sits in bit 0 of the shift register.
            if (1..=nbits).contains(&bitpos) {
                state[BEH_UART_TX_SHIFT] >>= 1;
            }
            // Advance to the next bit; after the stop bit (bitpos == nbits+1) return to idle.
            if bitpos > nbits {
                state[BEH_UART_TX_STATE] = 0;
                state[BEH_UART_TX_BITPOS] = 0;
            } else {
                state[BEH_UART_TX_BITPOS] = bitpos + 1;
            }
        }
    } else if send && state[BEH_UART_SEND_PREV] == 0 {
        // Rising SEND edge: load the byte (LSB-first) and start the frame at the start bit.
        state[BEH_UART_TX_SHIFT] = (data & mask) as u32;
        state[BEH_UART_TX_BITPOS] = 0; // start bit first
        state[BEH_UART_TX_BAUD] = 0;
        state[BEH_UART_TX_STATE] = 1;
    }
    state[BEH_UART_SEND_PREV] = send as u32;

    // --- RX engine ---
    if state[BEH_UART_RX_STATE] == 1 {
        state[BEH_UART_RX_BAUD] += 1;
        // The first data-bit sample lands in the MIDDLE OF BIT 0 — 1.5 bit periods after the start
        // edge (`baud + half`): half a bit to reach the middle of the start bit, then one full bit
        // to step over the start bit to the middle of the first data bit. Each subsequent sample is
        // one full bit later (mid-bit). Skipping the start bit this way is what keeps the LSB-first
        // assembly aligned (sampling only `half` would land on the start bit and shift every bit).
        let target = if state[BEH_UART_RX_BITPOS] == 0 {
            baud + half
        } else {
            baud
        };
        if state[BEH_UART_RX_BAUD] >= target {
            state[BEH_UART_RX_BAUD] = 0;
            // Sample this data bit (LSB-first: bit k lands in position k).
            let k = state[BEH_UART_RX_BITPOS];
            if rx {
                state[BEH_UART_RX_SHIFT] |= 1u32 << k;
            }
            state[BEH_UART_RX_BITPOS] = k + 1;
            if state[BEH_UART_RX_BITPOS] >= nbits {
                // All data bits in: latch the byte and pulse RXVALID (one tick). The stop bit is
                // the idle mark the next start-edge search runs against, so return straight to idle.
                state[BEH_UART_RX_WORD] = state[BEH_UART_RX_SHIFT] & (mask as u32);
                state[BEH_UART_RXVALID] = 1;
                state[BEH_UART_RX_STATE] = 0;
            }
        }
    } else if !rx && state[BEH_UART_RX_PREV] != 0 {
        // Falling RX edge (start bit): begin sampling — clear the assembler, await the mid-bit.
        state[BEH_UART_RX_STATE] = 1;
        state[BEH_UART_RX_BITPOS] = 0;
        state[BEH_UART_RX_BAUD] = 0;
        state[BEH_UART_RX_SHIFT] = 0;
    }
    state[BEH_UART_RX_PREV] = rx as u32;
}

/// Read one of a behavioral block's digital **input** pins as a two-state level: `true`
/// (logic high) iff the pin sits above half the chip's rail **relative to its GND pin** `e`,
/// `false` otherwise — the powered-gate / comparator-LE threshold (a clean half-rail decision,
/// no forbidden band, so the SPI bookkeeping is a deterministic boolean). `rail` is the chip's
/// supply span `V(d) − V(e)`; with `rail <= 0` (unpowered) every input reads `false`.
#[inline]
fn beh_level(node_v: &[f64], pin: usize, vlow: f64, rail: f64) -> bool {
    rail > 0.0 && (node_v[pin] - vlow) > 0.5 * rail
}

/// The behavioral SPI master's bit count (`params[1]`, defaulting and clamped) and SCLK
/// half-period (`params[0]`, defaulting) as integers — the **structural** timing, read once so
/// the commit step and the output drive agree. Never a function of a solved voltage.
#[inline]
fn beh_spi_config(el: &Element) -> (u32, u32) {
    let nbits = if el.params[1] >= 1.0 {
        (el.params[1] as u32).min(BEH_SPI_NBITS_MAX)
    } else {
        BEH_SPI_NBITS_DEFAULT
    };
    let half = if el.params[0] >= 1.0 {
        el.params[0] as u32
    } else {
        BEH_SPI_HALF_DEFAULT
    };
    (nbits, half)
}

/// The MOSI bit the SPI master currently presents (MSB-first), from the **committed** state:
/// while active (`fsm == 1`) it is `(shift_out >> (nbits-1-bit_index)) & 1`, else `0` (idle
/// drives MOSI low). Pure integer arithmetic on the hashed state — the same value the commit
/// step shifts out, so the drive and the bookkeeping stay in lockstep.
#[inline]
fn beh_spi_mosi_bit(state: &[u32; BEH_STATE_WORDS], nbits: u32) -> bool {
    if state[BEH_SPI_FSM] != 1 {
        return false;
    }
    let bit_index = state[BEH_SPI_BIT_INDEX];
    if bit_index >= nbits {
        return false;
    }
    let shift = nbits - 1 - bit_index;
    (state[BEH_SPI_SHIFT_OUT] >> shift) & 1 != 0
}

/// Advance a behavioral SPI master's integer state machine by one analog tick (Mode 0:
/// CPOL = 0, CPHA = 0), reading the just-solved committed input levels (`start`, `miso`).
/// Mirrors where the sampler/comparator latch their bit. **Mode-0 edge bookkeeping** (all
/// integer, fully deterministic):
/// - **Idle** (`fsm == 0`): SCLK = 0, CS = 1 (deasserted). On a **rising START edge**
///   (`start && !start_prev`) load `shift_out = data & mask`, zero `bit_index`/`clk_counter`/
///   `sclk_level`, assert CS = 0, and enter the active state. The first MOSI bit (the MSB) is
///   thereby presented while CS is low and **before** the first SCLK rising edge — CPHA = 0.
/// - **Active** (`fsm == 1`): count `clk_counter` up each tick; when it reaches `half_period`
///   reset it and **toggle** SCLK. On the resulting **rising** SCLK edge sample MISO into
///   `shift_in` (shift left, OR the received bit). On the **falling** SCLK edge advance
///   `bit_index`; once `nbits` bits have been clocked (i.e. after the nth falling edge) deassert
///   (CS = 1, SCLK = 0) and return to idle — the transaction is done and `shift_in` holds the
///   received word.
///
/// `start_prev` is always updated last so the next tick can detect the next rising START edge.
/// Returns nothing; it mutates `state` in place (the only mutation site, run in the commit phase).
fn beh_spi_step(
    state: &mut [u32; BEH_STATE_WORDS],
    data: u64,
    nbits: u32,
    half: u32,
    start: bool,
    miso: bool,
) {
    let mask: u64 = if nbits >= 32 {
        u64::MAX
    } else {
        (1u64 << nbits) - 1
    };
    match state[BEH_SPI_FSM] {
        1 => {
            // Active: generate SCLK by counting to the half-period, then act on its edge.
            state[BEH_SPI_CLK_COUNTER] += 1;
            if state[BEH_SPI_CLK_COUNTER] >= half {
                state[BEH_SPI_CLK_COUNTER] = 0;
                let old = state[BEH_SPI_SCLK_LEVEL];
                let new = 1 - old; // toggle 0<->1
                state[BEH_SPI_SCLK_LEVEL] = new;
                if old == 0 && new == 1 {
                    // Rising edge: sample MISO into the receive shift register (MSB-first in).
                    state[BEH_SPI_SHIFT_IN] = (state[BEH_SPI_SHIFT_IN] << 1) | (miso as u32);
                } else {
                    // Falling edge: this bit is finished — advance, and finish after nbits bits.
                    state[BEH_SPI_BIT_INDEX] += 1;
                    if state[BEH_SPI_BIT_INDEX] >= nbits {
                        state[BEH_SPI_CS_LEVEL] = 1; // deassert CS
                        state[BEH_SPI_SCLK_LEVEL] = 0; // park SCLK low
                        state[BEH_SPI_FSM] = 0; // back to idle; shift_in holds the received word
                    }
                }
            }
        }
        _ => {
            // Idle (or an unrecognised fsm value, which resets cleanly to idle behaviour).
            state[BEH_SPI_FSM] = 0;
            state[BEH_SPI_SCLK_LEVEL] = 0;
            state[BEH_SPI_CS_LEVEL] = 1; // CS deasserted (active-low)
            if start && state[BEH_SPI_START_PREV] == 0 {
                // Rising START edge: load the word and assert CS, present the MSB (CPHA = 0).
                state[BEH_SPI_SHIFT_OUT] = (data & mask) as u32;
                state[BEH_SPI_SHIFT_IN] = 0;
                state[BEH_SPI_BIT_INDEX] = 0;
                state[BEH_SPI_CLK_COUNTER] = 0;
                state[BEH_SPI_SCLK_LEVEL] = 0;
                state[BEH_SPI_CS_LEVEL] = 0; // assert CS (active-low)
                state[BEH_SPI_FSM] = 1;
            }
        }
    }
    state[BEH_SPI_START_PREV] = start as u32;
}

// --- Behavioral program 4: FPGA logic element (4-input LUT + optional register) ----

/// FPGA-logic-element internal-state word indices (program 4) into an [`ELEM_BEHAVIORAL`]'s
/// `[u32; `[`BEH_STATE_WORDS`]`]` block. Only the **registered** mode carries state — the
/// registered output bit `Q` and its clock-edge companion `CLK_PREV`; a purely **combinational**
/// LUT advances no state (all words stay zero, folding exactly like an inert block, so it is
/// golden-safe by construction). A fresh layout (every program runs alone in its element).
const BEH_LUT_Q: usize = 0;
const BEH_LUT_CLK_PREV: usize = 1;

/// `params` slot selecting an [`ELEM_BEHAVIORAL`] LUT's **output mode** (program 4): `>= 1` ⇒
/// **registered** (the LUT result is latched into `Q` on each rising `CLK` edge and the output
/// drives that held bit, a LUT+flip-flop "logic element"); otherwise **combinational** (the output
/// follows the live inputs with no clock, a plain gate). Slot 4 is otherwise unused by a behavioral
/// block (slots 0/1 are the SPI/UART config, slot 2 the sub-tick rate). Structural, never a solved
/// value.
const BEH_LUT_MODE_SLOT: usize = 4;

/// Whether an [`ELEM_BEHAVIORAL`] LUT (program 4) is in **registered** mode (`params[`
/// [`BEH_LUT_MODE_SLOT`]`] >= 1`) versus combinational. Structural config.
#[inline]
fn beh_lut_registered(e: &Element) -> bool {
    e.params[BEH_LUT_MODE_SLOT] >= 1.0
}

/// The output bit of a 4-input LUT given its 16-entry **truth table** (`truth`, low 16 bits) and a
/// 4-bit input `index` (`IN0` = bit 0 … `IN3` = bit 3): bit `index` of the table. The index is
/// masked to `0..16` so the shift can never exceed the table width (a LUT4 is exactly 16 entries).
/// Pure integer arithmetic — the universal combinational primitive (every ≤4-input gate is one
/// particular truth table).
#[inline]
fn beh_lut_bit(truth: u32, index: u32) -> bool {
    (truth >> (index & 0xF)) & 1 != 0
}

/// The 4-bit LUT input index assembled from a behavioral block's **live** input pins — `IN0` = `f`
/// (bit 0, the LSB), `IN1` = `g`, `IN2` = `h`, `IN3` = `c` (bit 3, the MSB) — each read as a digital
/// level at half the chip's rail relative to its `GND` pin (`vlow`/`rail`, via [`beh_level`]). Used
/// by the **combinational** LUT in [`Sim::eval_digital`], exactly the gate receiver path (the output
/// then settles within the digital sub-solve with no clock-to-output delay). The clock pin `b` is
/// not an input here — it matters only to the registered latch.
#[inline]
fn beh_lut_live_index(node_v: &[f64], e: &Element, vlow: f64, rail: f64) -> u32 {
    let q = |pin: usize| beh_level(node_v, pin, vlow, rail) as u32;
    q(e.f) | (q(e.g) << 1) | (q(e.h) << 2) | (q(e.c) << 3)
}

/// Advance a behavioral **FPGA logic element**'s integer state by one tick (program 4). A
/// **combinational** LUT (`registered == false`) holds no state — its output follows the live
/// inputs in [`Sim::eval_digital`], so there is nothing to commit and this returns immediately
/// (every state word stays zero). A **registered** LUT latches the truth-table lookup of its
/// committed input levels into `Q` on each **rising `CLK` edge** (`clk && !clk_prev`) — a LUT
/// followed by a D flip-flop, the fundamental FPGA building block (a network of these is any
/// sequential machine / soft core). `index` is the committed-input LUT index (the SAME
/// [`beh_lut_live_index`] the combinational output uses, so the two paths can't drift), `clk` the
/// committed clock level (`b`). `CLK_PREV` is updated last for the next tick's edge detection.
/// Mutates `state` in place (the only mutation site, run in the commit phase).
fn beh_lut_step(
    state: &mut [u32; BEH_STATE_WORDS],
    truth: u32,
    registered: bool,
    index: u32,
    clk: bool,
) {
    if !registered {
        return; // combinational LUT carries no state (output is live in eval_digital)
    }
    if clk && state[BEH_LUT_CLK_PREV] == 0 {
        state[BEH_LUT_Q] = beh_lut_bit(truth, index) as u32; // latch on the rising clock edge
    }
    state[BEH_LUT_CLK_PREV] = clk as u32;
}

/// The 3-bit flash-ADC code for a behavioral block (program 5): the analog input `V(f)` measured
/// against the reference span, quantized to `0..=7` by the floor rule `floor(8 * (Vin - Vgnd) /
/// span)`. The span is the **VREF pin `g`** above the `GND` pin (`vlow`) when it is driven above the
/// gate minimum, else the **VCC rail** (so an ADC wired with only VCC/GND still converts full-scale
/// against its supply). The seven implied thresholds sit at `k/8` of full scale (`k = 1..7`) -- the
/// comparator bank of a flash converter, read live in [`Sim::eval_digital`] (combinational, no state
/// block, so program 5 commits nothing and folds a zero state -- golden-safe additive). Under-range
/// and over-range saturate to 0 and 7.
#[inline]
fn beh_flash_adc_code(node_v: &[f64], e: &Element, vlow: f64, rail: f64) -> u32 {
    let span = {
        let vref = node_v[e.g] - vlow; // the VREF pin above GND
        if vref > GATE_MIN_RAIL {
            vref
        } else {
            rail // VREF unwired: fall back to the VCC supply as full scale
        }
    };
    if span <= GATE_MIN_RAIL {
        return 0; // unpowered / no reference: nothing to convert
    }
    let frac = ((node_v[e.f] - vlow) / span).clamp(0.0, 1.0);
    ((frac * 8.0).floor() as u32).min(7)
}

// --- Behavioral program 6: 3-bit SAR ADC --------------------------------------

/// SAR-ADC internal-state word indices (program 6) into an [`ELEM_BEHAVIORAL`]'s `[u32;
/// `[`BEH_STATE_WORDS`]`]` block — a fresh layout (every program runs alone in its element).
/// `CODE`: the running successive-approximation result register (`0..=7`), driving `D0`/`D1`/`D2`.
/// `STEP`: which bit is decided on the next clock, `0..SAR_BITS` (the bit under test is the MSB
/// minus `STEP`), wrapping after the LSB. `DONE`: `1` once a full conversion has completed (the
/// result is valid), cleared when the next conversion begins. `CLK_PREV`: the rising-edge companion.
const BEH_SAR_CODE: usize = 0;
const BEH_SAR_STEP: usize = 1;
const BEH_SAR_DONE: usize = 2;
const BEH_SAR_CLK_PREV: usize = 3;

/// Bits the SAR resolves — and the number of clocks per conversion. A 3-bit converter.
const SAR_BITS: u32 = 3;
/// Full-scale code count, `2^`[`SAR_BITS`]: the trial DAC level for code `c` is `c / SAR_LEVELS` of
/// the reference, so one LSB = reference / `SAR_LEVELS`.
const SAR_LEVELS: u32 = 1 << SAR_BITS;

/// Advance a behavioral **3-bit SAR ADC**'s integer state by one tick (program 6). On each **rising
/// `CLK` edge** (`clk && !clk_prev`) it performs one step of the binary search, most-significant bit
/// first: at the start of a conversion (`STEP == 0`) it clears the register, then sets the bit under
/// test and compares the input `vin` (volts above the chip's `GND`) against that trial's internal
/// R-2R DAC output (`trial / `[`SAR_LEVELS`]` * span`, where `span` is the `VCC` reference) — keeping
/// the bit when `vin` is at or above the trial level, dropping it otherwise. After the LSB step the
/// register holds `floor(`[`SAR_LEVELS`]` * vin / span)` clamped to `0..SAR_LEVELS` (the same code the
/// parallel flash ADC produces — the speed-vs-parts duality) and `DONE` is raised until the next
/// conversion begins. `CLK_PREV` is updated last for the next tick's edge detection. Pure integer /
/// `f64` compares (no transcendentals), so it is fully deterministic; mutates `state` in place (the
/// only mutation site, run in the commit phase). The input should be stable across the conversion's
/// clocks (a real SAR samples and holds `VIN` at conversion start); a slowly varying or DC input
/// converts exactly.
fn beh_sar_adc_step(state: &mut [u32; BEH_STATE_WORDS], clk: bool, vin: f64, span: f64) {
    if clk && state[BEH_SAR_CLK_PREV] == 0 {
        if state[BEH_SAR_STEP] == 0 {
            state[BEH_SAR_CODE] = 0; // start of conversion: clear the register
            state[BEH_SAR_DONE] = 0; // result not yet valid
        }
        let bit = (SAR_BITS - 1) - state[BEH_SAR_STEP]; // MSB first
        let trial = state[BEH_SAR_CODE] | (1u32 << bit);
        let dac = (trial as f64) / (SAR_LEVELS as f64) * span; // internal R-2R DAC trial level
        if vin >= dac {
            state[BEH_SAR_CODE] = trial; // comparator: VIN at/above the trial DAC => keep the bit
        }
        state[BEH_SAR_STEP] = (state[BEH_SAR_STEP] + 1) % SAR_BITS;
        if state[BEH_SAR_STEP] == 0 {
            state[BEH_SAR_DONE] = 1; // finished the LSB: the 3-bit result is valid
        }
    }
    state[BEH_SAR_CLK_PREV] = clk as u32;
}

// --- Behavioral program 7: 3-bit binary counter -------------------------------

/// Counter internal-state word indices (program 7) into an [`ELEM_BEHAVIORAL`]'s `[u32;
/// `[`BEH_STATE_WORDS`]`]` block. `COUNT`: the running count (`0..`[`COUNTER_LEVELS`]`)`, driving
/// `Q0`/`Q1`/`Q2`. `CLK_PREV`: the rising-edge companion.
const BEH_CNT_COUNT: usize = 0;
const BEH_CNT_CLK_PREV: usize = 1;

/// Width of the binary counter — a 3-bit counter, to match the 3-bit DAC it most often drives.
const COUNTER_BITS: u32 = 3;
/// Counter modulus, `2^`[`COUNTER_BITS`]: the count wraps `COUNTER_LEVELS - 1 -> 0`.
const COUNTER_LEVELS: u32 = 1 << COUNTER_BITS;

/// Advance a behavioral **3-bit binary counter**'s integer state by one tick (program 7). `RESET`
/// (active high) asynchronously clears the count to 0 and dominates the clock. Otherwise, on each
/// **rising `CLK` edge** (`clk && !clk_prev`) it increments `count = (count + 1) mod `[`COUNTER_LEVELS`]
/// (wrapping `7 -> 0`). `CLK_PREV` is updated last for the next tick's edge detection. Pure integer
/// arithmetic — fully deterministic; mutates `state` in place (the only mutation site, run in the
/// commit phase). The committed count drives `Q0`/`Q1`/`Q2` in [`Sim::eval_digital`] (one tick of
/// state-to-output delay, like the other clocked programs).
fn beh_counter_step(state: &mut [u32; BEH_STATE_WORDS], clk: bool, reset: bool) {
    if reset {
        state[BEH_CNT_COUNT] = 0; // asynchronous active-high clear
    } else if clk && state[BEH_CNT_CLK_PREV] == 0 {
        state[BEH_CNT_COUNT] = (state[BEH_CNT_COUNT] + 1) % COUNTER_LEVELS;
    }
    state[BEH_CNT_CLK_PREV] = clk as u32;
}

// --- Behavioral program 8: 1st-order sigma-delta ADC --------------------------

/// Sigma-delta internal-state word indices (program 8) into an [`ELEM_BEHAVIORAL`]'s `[u32;
/// `[`BEH_STATE_WORDS`]`]` block. `INTEG`: the modulator's integrator, fixed-point (an `i32` stored
/// bit-for-bit in the `u32` slot — bounded, so deterministic and hashable). `BIT`: the current 1-bit
/// modulator output (drives the `BS` bit-stream pin). `BITCOUNT`/`BLOCKPOS`: the decimator's running
/// count of 1s and its position in the current block. `CODE`: the latched decimated 3-bit code (drives
/// D0/D1/D2). `CLK_PREV`: the rising-edge companion.
const SD_INTEG: usize = 0;
const SD_BIT: usize = 1;
const SD_BITCOUNT: usize = 2;
const SD_BLOCKPOS: usize = 3;
const SD_CODE: usize = 4;
const SD_CLK_PREV: usize = 5;

/// Sigma-delta fixed-point full scale: `VIN/VCC` is quantised to `0..=SD_FULL` and the 1-bit feedback
/// subtracts `SD_FULL`. A power of two so the arithmetic is exact.
const SD_FULL: i32 = 256;
/// Sigma-delta decimation ratio: modulator clocks per output sample (the oversampling ratio). Eight
/// 1-bit samples are counted into one 3-bit code, so the count of 1s lands in `0..=8` (clamped to 7).
const SD_DECIM: u32 = 8;

/// Advance a behavioral **1st-order sigma-delta ADC**'s integer state by one tick (program 8). On each
/// **rising `CLK` edge** it runs one modulator step and one decimator step:
/// 1. **Modulator:** quantise the input to fixed point `vin_q = round(SD_FULL * clamp(vin/span, 0, 1))`;
///    slice the integrator's sign for the output bit (`integ > 0`); then integrate the error with 1-bit
///    feedback `integ += vin_q - bit * SD_FULL` (so the loop drives the average bit density to
///    `vin/span`). The integrator is clamped to a safe bounded range (it never legitimately leaves
///    `+/- SD_FULL`) so the `i32` math cannot overflow.
/// 2. **Decimator:** add the bit to the block count; every [`SD_DECIM`] clocks latch
///    `CODE = min(count, 7)` and restart the block (the integrator carries over — only the counter
///    resets). The latched code drives D0/D1/D2; the live bit drives `BS`.
///
/// `CLK_PREV` is updated last. The only float step is the input quantisation (`round`, deterministic);
/// everything else is integer, so the run is bit-reproducible. Mutates `state` in place (commit phase).
fn beh_sigma_delta_step(state: &mut [u32; BEH_STATE_WORDS], clk: bool, vin: f64, span: f64) {
    if clk && state[SD_CLK_PREV] == 0 {
        // Modulator: integrate the error, slice, feed back 1 bit.
        let x = (vin / span).clamp(0.0, 1.0);
        let vin_q = (x * SD_FULL as f64).round() as i32;
        let mut integ = state[SD_INTEG] as i32;
        let bit: i32 = if integ > 0 { 1 } else { 0 };
        integ += vin_q - bit * SD_FULL;
        integ = integ.clamp(-2 * SD_FULL, 2 * SD_FULL); // bounded in practice; guard i32 overflow
        state[SD_INTEG] = integ as u32;
        state[SD_BIT] = bit as u32;
        // Decimator: count the 1s over SD_DECIM clocks, then latch the 3-bit code.
        state[SD_BITCOUNT] += bit as u32;
        state[SD_BLOCKPOS] += 1;
        if state[SD_BLOCKPOS] >= SD_DECIM {
            state[SD_CODE] = state[SD_BITCOUNT].min(7);
            state[SD_BITCOUNT] = 0;
            state[SD_BLOCKPOS] = 0;
        }
    }
    state[SD_CLK_PREV] = clk as u32;
}

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
/// Op-amp gain-bandwidth product, in hertz — the unity-gain frequency of the open-loop
/// gain. Real op-amps are not infinitely fast: the open-loop gain has a dominant pole at
/// `OPAMP_GBW / OPAMP_GAIN` (~10 Hz here for the 1e5 gain), rolling off at −20 dB/decade
/// so it crosses unity near `OPAMP_GBW` (~1 MHz, a 741-class part). This is **read only in
/// the frequency-domain analysis** ([`Sim::ac_solve`]) so a closed-loop stage's Bode shows
/// its true bandwidth (`GBW / closed-loop gain`) and the loop's phase margin; the transient
/// op-amp stays algebraic (infinite-bandwidth), so the determinism golden is untouched.
const OPAMP_GBW: f64 = 1.0e6;
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

/// The junction model for a diode-family element kind. The forward junction's saturation
/// current `Is` (param slot 0) and emission coefficient `n` (slot 1) can be tuned per device
/// — that is the "one diode kind → the whole diode family" lever (a switching part vs a power
/// rectifier; an LED's colour sets its forward drop). A `0` slot uses the kind's built-in
/// constant, so an all-zero param block reproduces the old fixed model bit for bit. Only the
/// Zener additionally reads `value` (its breakdown voltage). Pure function → no determinism cost.
#[inline]
fn diode_model(e: &Element) -> DiodeModel {
    match e.kind {
        ELEM_SCHOTTKY => DiodeModel {
            is: param_or(&e.params, 0, SCHOTTKY_IS),
            vth: param_or(&e.params, 1, DIODE_N) * DIODE_VT,
            vz: f64::INFINITY,
        },
        ELEM_LED => DiodeModel {
            is: param_or(&e.params, 0, LED_IS),
            vth: param_or(&e.params, 1, LED_N) * DIODE_VT,
            vz: f64::INFINITY,
        },
        ELEM_ZENER => DiodeModel {
            is: param_or(&e.params, 0, DIODE_IS),
            vth: param_or(&e.params, 1, DIODE_N) * DIODE_VT,
            vz: e.value.max(ZENER_VZ_MIN),
        },
        // ELEM_DIODE and anything else: the silicon default, no breakdown.
        _ => DiodeModel {
            is: param_or(&e.params, 0, DIODE_IS),
            vth: param_or(&e.params, 1, DIODE_N) * DIODE_VT,
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

/// Evaluate a logic gate's four-state output [`Level`] from its two input levels and
/// its function code (`code` = the element's `aux`, rounded to the nearest non-negative
/// integer): 0 AND, 1 OR, 2 NAND, 3 NOR, 4 XOR, 5 XNOR, 6 NOT (ignores `in2`), 7 BUF
/// (ignores `in2`). Any other code falls back to AND. A `Z` (undriven) input reads as
/// unknown (`X`); the standard IEEE-1364 four-state tables propagate `X` (e.g.
/// `AND(0, X) = 0` but `AND(1, X) = X`). Pure enum logic — deterministic and
/// platform-independent; on `Low`/`High` inputs it is exactly the original boolean
/// truth table.
#[inline]
fn gate_logic_level(code: f64, in1: Level, in2: Level) -> Level {
    // Tri-state code: 0 = low, 1 = high, 2 = unknown (Z reads as unknown on an input).
    let tri = |l: Level| -> u8 {
        match l {
            Level::Low => 0,
            Level::High => 1,
            _ => 2,
        }
    };
    let a = tri(in1);
    let b = tri(in2);
    let and = |p: u8, q: u8| -> u8 {
        if p == 0 || q == 0 {
            0
        } else if p == 2 || q == 2 {
            2
        } else {
            1
        }
    };
    let or = |p: u8, q: u8| -> u8 {
        if p == 1 || q == 1 {
            1
        } else if p == 2 || q == 2 {
            2
        } else {
            0
        }
    };
    let xor = |p: u8, q: u8| -> u8 {
        if p == 2 || q == 2 {
            2
        } else {
            p ^ q
        }
    };
    let not = |p: u8| -> u8 {
        match p {
            0 => 1,
            1 => 0,
            _ => 2,
        }
    };
    let r = match code.round() as u32 {
        1 => or(a, b),
        2 => not(and(a, b)),
        3 => not(or(a, b)),
        4 => xor(a, b),
        5 => not(xor(a, b)),
        6 => not(a),
        7 => a,
        // IMPLY (A → B = ¬A ∨ B): an OR with input A inverted. High except when A=1, B=0.
        8 => or(not(a), b),
        // NIMPLY (A ↛ B = A ∧ ¬B): an AND with input B inverted. High only when A=1, B=0.
        9 => and(a, not(b)),
        // 0 and any unrecognised code: AND.
        _ => and(a, b),
    };
    match r {
        0 => Level::Low,
        1 => Level::High,
        _ => Level::X,
    }
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

/// True for the **digital** element kinds — a logic gate, a flip-flop, a level shifter,
/// a clocked sampler, a latched comparator, or a behavioral block. Their terminals are logic
/// pins (driven/sensed levels) rather than continuous-voltage analog terminals — except a few
/// high-Z analog **sense**/supply pins (the sampler's `IN`, the comparator's `IN±`, the powered
/// chips' `VCC`/`GND`), which are handled specially in [`classify_nets`]. The net-classification
/// pass uses this to separate the analog and digital domains; the boundary between them is
/// any node where a digital pin and an analog element meet. See
/// `docs/ui/logic-analog-digital-nets.md` §7.
#[inline]
fn is_digital(kind: u8) -> bool {
    kind == ELEM_GATE
        || kind == ELEM_DFF
        || kind == ELEM_LEVELSHIFT
        || kind == ELEM_SAMPLER
        || kind == ELEM_COMPARATOR
        || kind == ELEM_BEHAVIORAL
        || kind == ELEM_MEMORY
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
fn classify_nets(
    node_count: usize,
    elements: &[Element],
    // Word-level bus-port node lists (#100), indexed by element. Empty slices ⇒ no wide memory (the
    // cell-level / non-memory path, byte-identical to before). For an `ELEM_MEMORY` with wide ports the
    // address / data-in / data-out bus nodes are digital signal nets and must be touched here so they
    // classify Digital/Boundary exactly like the cell-level a/c/f/g/h pins.
    mem_addr_nodes: &[Vec<usize>],
    mem_din_nodes: &[Vec<usize>],
    mem_dout_nodes: &[Vec<usize>],
) -> Vec<NetClass> {
    let mut analog_touched = vec![false; node_count];
    let mut digital_touched = vec![false; node_count];
    for (ei, e) in elements.iter().enumerate() {
        if e.kind == ELEM_MEMORY {
            // Wide bus-port nodes (if any) are digital signal nets — touch every addr/din/dout bit.
            for list in [mem_addr_nodes, mem_din_nodes, mem_dout_nodes] {
                if let Some(nodes) = list.get(ei) {
                    for &t in nodes {
                        if t < node_count {
                            digital_touched[t] = true;
                        }
                    }
                }
            }
        }
        if is_digital(e.kind) {
            // Digital SIGNAL pins (driven / read as logic levels). A powered gate's
            // POWER pins (VCC = d, GND = e) are NOT signal nets — they are ordinary
            // analog supply nodes the gate only reads as voltages, so they are marked
            // analog below (a gate on a 5 V rail must leave that rail Analog, not pull
            // it into the digital domain). The clocked sampler's IN pin (b) is likewise an
            // analog SENSE node (a high-Z comparator input) — only its OUT (a) and CLK (c)
            // are signal pins, so IN is marked analog below (the comparator/boundary
            // pattern: a net touching only IN is Analog; shared with a digital pin →
            // Boundary). A DFF's four pins (Q, D, CLK, Q̄) and a level shifter's are all
            // signal pins.
            let signal: &[usize] = if e.kind == ELEM_GATE {
                &[e.a, e.b, e.c]
            } else if e.kind == ELEM_SAMPLER {
                &[e.a, e.c]
            } else if e.kind == ELEM_COMPARATOR {
                // OUT (a) and LE (f) are the comparator's digital signal pins; IN+ (b),
                // IN- (c), VCC (d), GND (e) are analog (marked below).
                &[e.a, e.f]
            } else if e.kind == ELEM_BEHAVIORAL {
                // The behavioral block's signal pins are GENERAL across its programs: a/b/c are
                // digital OUTPUT pins and f/g/h are digital INPUT pins; VCC (d), GND (e) are analog
                // supply pins (marked below, exactly like a powered gate's power pins). Per program:
                //   1 SPI master: a=SCLK,b=MOSI,c=CS (out); f=MISO,g=START (in)
                //   2 SPI slave:  a=MISO,b=RXVALID (out); f=SCLK,g=MOSI,h=CS (in)
                //   3 UART:       a=TX,b=RXVALID (out); f=RX,g=SEND (in)
                // Unused pins default to ground (node 0, forced analog), so listing all of a/b/c and
                // f/g/h is safe for every program — an unused one only ever re-marks ground.
                &[e.a, e.b, e.c, e.f, e.g, e.h]
            } else if e.kind == ELEM_MEMORY {
                // Cell-level memory: D_out (a) is a digital OUTPUT; WE (b), D_in (c) and the
                // address A0..A2 (f, g, h) are digital INPUTS. VCC (d), GND (e) are analog supply
                // pins (marked below, exactly like a powered gate's power pins).
                &[e.a, e.b, e.c, e.f, e.g, e.h]
            } else {
                &[e.a, e.b, e.c, e.d]
            };
            for &t in signal {
                if t < node_count {
                    digital_touched[t] = true;
                }
            }
            if e.kind == ELEM_GATE {
                for t in [e.d, e.e] {
                    if t < node_count {
                        analog_touched[t] = true;
                    }
                }
            }
            if e.kind == ELEM_SAMPLER && e.b < node_count {
                // IN (b) is a high-Z analog sense pin — mark it analog (mirrors a
                // powered gate's VCC/GND), so a comparator's input net is Analog and a
                // node it shares with a digital pin is Boundary.
                analog_touched[e.b] = true;
            }
            if e.kind == ELEM_COMPARATOR {
                // IN+ (b) / IN- (c) are high-Z analog SENSE pins, and VCC (d) / GND (e) are
                // analog SUPPLY pins (treated exactly like a powered gate's power pins) — all
                // analog, so a comparator's input/supply nets stay Analog and a node shared
                // with a digital pin is Boundary.
                for t in [e.b, e.c, e.d, e.e] {
                    if t < node_count {
                        analog_touched[t] = true;
                    }
                }
            }
            if e.kind == ELEM_BEHAVIORAL || e.kind == ELEM_MEMORY {
                // VCC (d) / GND (e) are analog SUPPLY pins (treated exactly like a powered
                // gate's power pins), so the behavioral block's (and memory array's) supply nets
                // stay Analog and a node shared with a digital pin is Boundary. Their signal pins
                // (SCLK/MOSI/CS/MISO/START; the memory's D_out/WE/D_in/addr) are digital-touched
                // above.
                for t in [e.d, e.e] {
                    if t < node_count {
                        analog_touched[t] = true;
                    }
                }
            }
        } else if e.kind == ELEM_ASWITCH {
            // Gated analog switch: the switched path (a, b) and the supply pins (VCC = d,
            // GND = e) are analog (a, b carry the passed signal; d/e are an ordinary
            // supply, handled exactly like a powered gate's power pins). CTRL (c) is the
            // digital control input — a logic signal the switch reads, so it is
            // digital-touching (the sampler-CLK / comparator pattern: a net touching only
            // CTRL is Digital, and a CTRL net shared with an analog driver is Boundary).
            for t in [e.a, e.b, e.d, e.e] {
                if t < node_count {
                    analog_touched[t] = true;
                }
            }
            if e.c < node_count {
                digital_touched[e.c] = true;
            }
        } else {
            for t in [e.a, e.b, e.c, e.d] {
                if t < node_count {
                    analog_touched[t] = true;
                }
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

/// Union-find `find` with path halving over the `parent` table. The table is kept
/// **union-by-min** by [`floating_refs`], so the returned root is always the
/// lowest node index in `x`'s connected component — a deterministic, stable choice.
fn uf_find(parent: &mut [usize], mut x: usize) -> usize {
    while parent[x] != x {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    x
}

/// Union the components of `a` and `b`, attaching the larger root under the smaller
/// so every component's root stays its **minimum** node index (the deterministic
/// reference [`floating_refs`] reports).
fn uf_union(parent: &mut [usize], a: usize, b: usize) {
    let ra = uf_find(parent, a);
    let rb = uf_find(parent, b);
    if ra != rb {
        let (lo, hi) = if ra < rb { (ra, rb) } else { (rb, ra) };
        parent[hi] = lo;
    }
}

/// Compute the **floating-component reference nodes**: one circuit node for each
/// connected component that has no galvanic path to ground (node `0`) and no terminal
/// a device already pins to ground on its own. Each returned node is weakly tied to
/// ground with a single [`GMIN`] during assembly ([`Sim::stamp_floating_refs`]),
/// removing the singular common-mode degree of freedom an isolated subnet would
/// otherwise carry under the single-global-ground model — the generalisation of the
/// per-node gate/op-amp `GMIN` from *nodes* to *components* (see
/// `docs/sim/floating-networks.md`).
///
/// Union-find runs over the **potential-defining** ties only: every element that
/// conducts or constrains a voltage between two of its terminals unions those nodes
/// (resistor, capacitor, inductor, voltage/AC source, switch, every diode-family
/// junction and the varistor; the MOSFET/BJT channel `a`–`b`; both transformer
/// windings `a`–`b` and `c`–`d` **separately**, preserving galvanic isolation). The
/// ideal current source is skipped — it injects current without defining a potential
/// (the dual case the netlist's incomplete-circuit check already handles). Terminals a
/// device pins to ground on its own are marked **referenced** directly (the MOSFET/BJT
/// gate/base, both op-amp inputs and its driven output, every logic-gate / level-shifter
/// / flip-flop terminal, and the pull-up's node), so the component holding one is never
/// double-tied.
///
/// A component is *referenced* iff it contains ground or any such terminal; every other
/// component contributes its **lowest-index node** (the union-by-min root). Determinism:
/// fixed element order, union-by-min, no hashing — the list reproduces bit-for-bit, and
/// a fully grounded circuit yields an **empty** list (one component, the grounded one),
/// leaving its solve and the analog golden untouched.
fn floating_refs(node_count: usize, elements: &[Element]) -> Vec<usize> {
    if node_count <= 1 {
        return Vec::new();
    }
    let mut parent: Vec<usize> = (0..node_count).collect();
    let mut referenced = vec![false; node_count];
    referenced[0] = true; // ground is the global reference
    let mark = |referenced: &mut [bool], t: usize| {
        if t < node_count {
            referenced[t] = true;
        }
    };
    for e in elements {
        match e.kind {
            ELEM_RESISTOR | ELEM_CAPACITOR | ELEM_INDUCTOR | ELEM_VSOURCE | ELEM_ACSOURCE
            | ELEM_SWITCH | ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER | ELEM_VARISTOR => {
                if e.a < node_count && e.b < node_count {
                    uf_union(&mut parent, e.a, e.b);
                }
            }
            ELEM_ASWITCH => {
                // The switched analog path (a, b) is a conductance between them (a finite
                // path even when open, like the clock switch's SWITCH_GOFF) — union it. The
                // control CTRL (c) and the supply pins VCC (d) / GND (e) are read-only: the
                // switch reads them as voltages but pins none of them, so (mirroring a
                // powered gate's VCC/GND and the sampler's IN) they are left to be referenced
                // by their own source/driver — an unwired one gets a proper floating-ref tie,
                // and an unwired VCC floats to ~0 V → the switch reads dead.
                if e.a < node_count && e.b < node_count {
                    uf_union(&mut parent, e.a, e.b);
                }
            }
            ELEM_NMOS | ELEM_PMOS | ELEM_NPN | ELEM_PNP => {
                // The channel / main current ties drain–source (collector–emitter);
                // the gate/base draws no DC current and is GMIN-pinned by the device,
                // so mark it referenced rather than union it.
                if e.a < node_count && e.b < node_count {
                    uf_union(&mut parent, e.a, e.b);
                }
                mark(&mut referenced, e.c);
            }
            ELEM_OPAMP => {
                // Output is GOUT-referenced to ground, both inputs GMIN-referenced —
                // all three terminals are pinned by the device itself.
                mark(&mut referenced, e.a);
                mark(&mut referenced, e.b);
                mark(&mut referenced, e.c);
            }
            ELEM_GATE => {
                // OUT (a) is referenced by the driver (GATE_GOUT to ground) and the
                // inputs (b, c) by their nets. The POWER pins (VCC = d, GND = e) are
                // ordinary analog nodes: left to be referenced by their own supply /
                // ground connections, NOT pinned here — so a gate with an unwired VCC
                // floats that node to ~0 V (a proper floating-ref tie) and reads as
                // unpowered, instead of being falsely held up.
                mark(&mut referenced, e.a);
                mark(&mut referenced, e.b);
                mark(&mut referenced, e.c);
            }
            ELEM_DFF | ELEM_LEVELSHIFT => {
                // Digital drivers reference their nets to ground via GATE_GOUT; treat
                // every pin as pinned (receivers included — a driven net is referenced).
                mark(&mut referenced, e.a);
                mark(&mut referenced, e.b);
                mark(&mut referenced, e.c);
                mark(&mut referenced, e.d);
            }
            ELEM_SAMPLER => {
                // OUT (a) is referenced by the driver (GATE_GOUT to ground) and CLK (c)
                // by its net. IN (b) is a high-Z analog SENSE pin the sampler does NOT
                // pin — it is an ordinary analog node, left to be referenced by its own
                // source/divider, so a floating IN gets a proper floating-ref tie (not
                // falsely held by the sampler). d, e are unused (ground).
                mark(&mut referenced, e.a);
                mark(&mut referenced, e.c);
            }
            ELEM_COMPARATOR => {
                // OUT (a) is referenced by the powered output driver and LE (f) by its
                // net. IN+ (b), IN- (c), VCC (d), GND (e) are analog SENSE/SUPPLY pins the
                // comparator does NOT pin (mirrors a powered gate's VCC/GND and the
                // sampler's IN) — each is an ordinary analog node left to be referenced by
                // its own source, so an unwired one gets a proper floating-ref tie and an
                // unwired VCC floats to ~0 V → the chip reads unpowered.
                mark(&mut referenced, e.a);
                mark(&mut referenced, e.f);
            }
            ELEM_BEHAVIORAL => {
                // The powered OUTPUT pins a/b/c are referenced by their drivers (GATE_GOUT to
                // ground via the powered output stage) — general across programs (prog 1 drives all
                // three: SCLK/MOSI/CS; progs 2/3 drive a/b and release c, but marking an unused c
                // only ever re-marks ground). The input pins f/g/h and the supply pins VCC (d) /
                // GND (e) are NOT pinned here (mirrors a powered gate's VCC/GND and the sampler's
                // IN) — each is an ordinary node left to be referenced by its own source, so an
                // unwired VCC floats to ~0 V → the chip reads unpowered.
                mark(&mut referenced, e.a);
                mark(&mut referenced, e.b);
                mark(&mut referenced, e.c);
                // The SAR ADC (program 6, DONE) and the sigma-delta ADC (program 8, BS bit-stream)
                // each drive a FOURTH output on `g` — reference it like the other outputs (the other
                // programs leave `g` an input, referenced by its own source; an unused `g` is ground,
                // already referenced, so this is a no-op there).
                if matches!(e.value as u32, BEH_PROG_SAR_ADC | BEH_PROG_SIGMA_DELTA) {
                    mark(&mut referenced, e.g);
                }
            }
            ELEM_PULLUP => {
                // Pulled to an internal rail through PULLUP_R — a real conductance to
                // ground, so the node is referenced.
                mark(&mut referenced, e.a);
            }
            ELEM_TRANSFORMER => {
                // Two galvanically isolated windings: union within each, never across,
                // so a floating secondary stays its own component.
                if e.a < node_count && e.b < node_count {
                    uf_union(&mut parent, e.a, e.b);
                }
                if e.c < node_count && e.d < node_count {
                    uf_union(&mut parent, e.c, e.d);
                }
            }
            // ELEM_ISOURCE and anything else define no potential between terminals.
            _ => {}
        }
    }
    // Propagate each referenced node to its component root (the min node).
    let mut root_ref = vec![false; node_count];
    for (n, &is_ref) in referenced.iter().enumerate() {
        if is_ref {
            let r = uf_find(&mut parent, n);
            root_ref[r] = true;
        }
    }
    // Each unreferenced component contributes its root = lowest-index node. Iterating
    // ascending and taking roots yields a sorted, deduplicated list.
    let mut refs = Vec::new();
    for (n, &reffed) in root_ref.iter().enumerate().skip(1) {
        if !reffed && uf_find(&mut parent, n) == n {
            refs.push(n);
        }
    }
    refs
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

/// A solved magnitude at or beyond this (or non-finite) is a **FAIL**: a non-physical
/// result, the signature of an *ideal* part with no series impedance pushed past what
/// physics allows — an ideal diode charging a cap, an ideal source into a short. The
/// engine clamps any such value to this finite bound so it can never propagate as a
/// `NaN` (the wasm-only blow-up that deleted traces), flags the whole-sim FAIL state,
/// and marks the offending elements so the renderer can box them. `1e9` (1 GV / 1 GA)
/// sits far above any real bench reading yet well inside the range where an `f64`
/// clamp is exact, so the FAIL is bit-identical on every platform — turning the
/// native-vs-wasm divergence that caused every "live-only" crash into a deterministic,
/// legible failure. A well-behaved circuit never reaches it, so the snapshot hash and
/// the golden are untouched. (The honest fix in-circuit is real series impedance — a
/// "real" part, or a literal resistor — which is the Ideal-vs-Real lesson.)
const FAIL_LIMIT: f64 = 1.0e9;

/// Param slot carrying a device's **rated current** (amps): the most current the part can
/// pass before it FAILs (the renderer boxes it). It is a **general** slot — read for every
/// element in [`Sim::flag_and_clamp_fails`], not kind-specific — so any future part can carry
/// a rating in the same place. `0.0` (the default, and every part in Ideal mode, where the web
/// layer omits the rating) means **unrated**: no check, so the snapshot hash and golden are
/// untouched. A rating bites only when the web layer installs it (Real mode), and it only sets
/// the FAIL flag — it never alters the solve — so it is purely additive and deterministic.
const RATED_CURRENT_SLOT: usize = 2;

/// Param slot carrying a **diode's transit time `TT`** (seconds): the diffusion-charge time
/// constant that gives a junction diode its **reverse recovery**. A forward-conducting diode
/// stores charge `q = TT·I`; when it is suddenly reverse-biased that charge must sweep out, so
/// the diode briefly conducts in reverse (the recovery current spike) before it blocks. Modelled
/// as a backward-Euler charge companion on the diode (the same machinery as a capacitor), so it
/// stays deterministic. `0.0` (the default, every Ideal-mode diode, and a Schottky — a
/// majority-carrier part with no stored charge) means **no recovery**: the charge term vanishes
/// and the diode is bit-identical to before, so the golden is untouched. Like the rating, the
/// web layer installs `TT` only in Real mode (reverse recovery is a non-ideality). It shares the
/// diode's slot 3 with nothing else (Is = 0, n = 1, rating = 2). NOTE: the values are **scaled
/// up** to the engine's fixed `DT` so the spike spans several ticks and is legible — the
/// realistic ordering (Schottky < fast-recovery < rectifier) is what matters, not the absolute ns.
const DIODE_TT_SLOT: usize = 3;

/// Param slot carrying an [`ELEM_BEHAVIORAL`] block's **declared digital sub-tick rate `N`** — how
/// many digital sub-ticks the block runs per analog tick (ADR 0004 phase-3, step 3b). It is a
/// **structural** divider read from the netlist, never from a solved value (multi-rate ≠ adaptive —
/// `docs/sim/multi-rate-domains.md`), so the schedule is fixed at install and reproducible. `<= 1`
/// (the default, and what a caller that omits params installs) means the block runs once per analog
/// tick exactly as today — so a circuit with no declared fast rate has a global rate `S = 1`, the
/// sub-tick loop is skipped entirely, and the result is **byte-identical** to before the loop
/// existed.
///
/// It reuses [`RATED_CURRENT_SLOT`] (slot 2) — harmless because a behavioral block's outputs are a
/// clean rail-to-rail Thévenin through [`GATE_GOUT`] (≤ a few amps into a dead short), far below any
/// realistic `N` (8, 16, …), so the general rated-current check in [`Sim::flag_and_clamp_fails`]
/// never trips on a behavioral block's tiny output current. The two readings never collide on a real
/// circuit, and the rating only *flags* (`failed_elements` is not hashed), so neither the solve nor
/// the snapshot hash is affected. Only [`ELEM_BEHAVIORAL`] declares a rate; every other kind leaves
/// slot 2 as its rated current.
const BEH_SUBTICK_RATE_SLOT: usize = RATED_CURRENT_SLOT;

/// The declared digital sub-tick rate `N ≥ 1` of one [`ELEM_BEHAVIORAL`] block — slot
/// [`BEH_SUBTICK_RATE_SLOT`], floored to `1` (a `0`/unset/`< 1` slot ⇒ one sub-tick per analog tick,
/// the existing behaviour). Non-behavioral elements have no rate (always `1`). Pure read of a
/// declared structural param; never a function of a voltage.
#[inline]
fn beh_subtick_rate(e: &Element) -> usize {
    if e.kind != ELEM_BEHAVIORAL {
        return 1;
    }
    let n = e.params[BEH_SUBTICK_RATE_SLOT];
    if n >= 2.0 {
        // Round to the nearest integer (the param is a declared integer divider; `f64` rounding
        // keeps a value like 16.0 exact and clamps anything pathological to a finite integer).
        n.round() as usize
    } else {
        1
    }
}

/// One ideal element in the netlist. Two-terminal elements use `a` and `b` (and
/// set `c = 0`, where it is ignored); three-terminal devices (the MOSFETs) also
/// use the control terminal `c`. The struct carries up to **eight** terminals
/// (`a`–`h`); any terminal an element does not read is `0` (ground) and inert, so
/// widening the count (ADR 0002 provisioned `f`/`g`/`h`) changes nothing on the
/// existing paths.
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
    /// element, or a powered logic gate's **VCC** pin. The [`ELEM_TRANSFORMER`] reads it
    /// as secondary− (its terminals are `a`/`b` = primary +/− and `c`/`d` = secondary
    /// +/−); a powered [`ELEM_GATE`] reads it as the positive supply (see `e`). Unused
    /// (`0` = ground, never read) for every element with three or fewer terminals — the
    /// terminal analogue of how `c` is ignored by two-terminal elements, so adding it
    /// changes nothing on the existing paths. Node `0` is ground.
    pub d: usize,
    /// Fifth terminal node index — a powered logic gate's **GND** pin. Only a powered
    /// [`ELEM_GATE`] reads it (with `d` = VCC): the gate's rail is `V(d) − V(e)` and its
    /// levels are referenced to `V(e)`, so an IC swings between the supply pins you wire
    /// rather than a fixed `value`. A gate with `d == 0 && e == 0` (no power pins) falls
    /// back to the legacy `value` rail referenced to ground — so existing gates, and
    /// every non-gate element (which leaves `e = 0`, never read), are bit-identical. The
    /// fifth-terminal analogue of how `d` is ignored by elements with fewer terminals.
    /// Node `0` is ground.
    pub e: usize,
    /// Sixth terminal node index — a latched comparator's **LE** (latch-enable) pin; see
    /// [`ELEM_COMPARATOR`]. Provisioned by ADR 0002's wire-format widening and first read by
    /// the comparator (`f == 0` means LE unwired ⇒ the front end is transparent, the ADCMP601
    /// floating default). For every other element it defaults to `0` (ground) and is inert,
    /// exactly as `c`, `d`, and `e` were inert before an element used them — so future parts
    /// (full flip-flops with set+reset+enable, dual-supply op-amps with offset-null pins, the
    /// 555, center-tapped transformers, gate drivers, tri-state buffers with OE) remain purely
    /// additive: they read `f`/`g`/`h` without another boundary change. Node `0` is ground.
    pub f: usize,
    /// Seventh terminal node index — **reserved** by ADR 0002 (see [`Element::f`]). Inert
    /// and ground-defaulted until a part uses it. Node `0` is ground.
    pub g: usize,
    /// Eighth terminal node index — **reserved** by ADR 0002 (see [`Element::f`]). Inert
    /// and ground-defaulted until a part uses it. Node `0` is ground.
    pub h: usize,
    /// Element value in the units implied by `kind` (V / ohm / F / H / A).
    pub value: f64,
    /// Second per-element scalar, parallel to `value`. Unused by every element
    /// except the [`ELEM_ACSOURCE`], where it is the **peak amplitude** in volts
    /// (`0.0` there selects the [`AC_AMPLITUDE`] default). Every other element
    /// leaves it `0.0`, where it is never read — so adding the field changes
    /// nothing on the existing paths, the scalar analogue of how the third
    /// terminal `c` is ignored by two-terminal elements.
    pub aux: f64,
    /// Per-device **parameter block** — a fixed-width array of model parameters whose
    /// meaning is `kind`-specific, so a device is no longer pinned to one set of fixed
    /// constants (the "turn one diode into the diode family" lever). A slot of `0.0` means
    /// "use the kind's built-in default", so an all-zero block (the default, and what a
    /// caller that omits params installs) reproduces today's behaviour **bit for bit** —
    /// the additive, golden-safe property. Current slot map (slot 0 is the kind's primary
    /// knob, slot 1 its secondary; slot 2 is a **general** rating read for every kind):
    /// - [`ELEM_OPAMP`]: `[0]` = gain-bandwidth product (Hz; `0` → [`OPAMP_GBW`]).
    /// - [`ELEM_CAPACITOR`]: `[0]` = ESR (Ω), `[1]` = ESL (H) — AC parasitics.
    /// - [`ELEM_INDUCTOR`]: `[0]` = DCR (Ω), `[1]` = winding capacitance (F) — AC parasitics.
    /// - [`ELEM_VSOURCE`]/[`ELEM_ACSOURCE`]: `[0]` = output impedance (Ω).
    /// - [`ELEM_NMOS`]/[`ELEM_PMOS`]: `[0]` = transconductance `Kp` (A/V²; `0` → [`MOS_KP`]).
    /// - [`ELEM_NPN`]/[`ELEM_PNP`]: `[0]` = forward gain `β` (`0` → [`BJT_BF`]).
    /// - diode family ([`ELEM_DIODE`]/[`ELEM_SCHOTTKY`]/[`ELEM_LED`]/[`ELEM_ZENER`]):
    ///   `[0]` = saturation current `Is` (A), `[1]` = emission coefficient `n` — the
    ///   forward drop, so a diode type / an LED colour is just a param preset.
    /// - **all kinds**: `[`[`RATED_CURRENT_SLOT`]`]` = rated current (A; `0` = unrated).
    pub params: [f64; PARAM_STRIDE],
}

/// Width of an [`Element::params`] block — the number of `f64` model parameters carried
/// per device across the netlist boundary. Fixed so the wire/save format is predictable.
/// Provisioned to **8** by ADR 0002 (was 4) so the richest future models (a BJT with
/// β + Is + Vaf + Rb + thermal coefficient; a real op-amp with GBW + slew + Vos + Ibias +
/// Rout; a thermal/noise device) all fit without a second wire-format bump. The widening is
/// golden-safe: [`param_or`]'s "`0.0` slot means the kind default" rule makes a zero-padded
/// 8-wide block reproduce the old 4-wide solve bit-for-bit, and no current slot meaning moved
/// (slots 4–7 are reserved/unused for now). Mirror this in `web/src/lib/tiers.ts`.
pub const PARAM_STRIDE: usize = 8;

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

// --- Small-signal AC analysis (frequency domain) -------------------------------

// Real-model AC parasitics (analysis only — the transient solve is unchanged, so the
// golden is too). Representative lumped values that put each part's self-resonant frequency
// in a sensible range: a ceramic cap's lead inductance + ESR, an inductor's winding
// resistance + inter-turn capacitance. Mirrored web-side for the analogy "parasitic sleeve".
const CAP_ESL: f64 = 1.0e-9; // 1 nH series lead inductance → SRF ≈ 5 MHz for a 1 µF cap
const CAP_ESR: f64 = 0.05; // 50 mΩ series resistance (sets how sharp the resonance is)
const IND_CW: f64 = 1.0e-12; // 1 pF parallel winding capacitance → the inductor's own SRF

// 10 nH resistor lead/body inductance — the same geometric parasitic on every resistor; only a
// *low-value* part (a current-sense shunt) has a small enough R for the ωL term to swing the phase
// (~32° on a 10 mΩ shunt at 100 kHz, but ~0° on a 10 kΩ).
const R_ESL: f64 = 1.0e-8;

/// Inductor winding resistance (DCR), in ohms — grows with inductance (more turns of wire),
/// floored so even a tiny inductor reads a hair of series resistance.
fn ind_dcr(henries: f64) -> f64 {
    (henries * 1000.0).max(0.1)
}

/// A device's [`Element::params`] slot `i`, or `default` when the slot is unset (`0.0`) —
/// the "0 means the kind default" rule, so an all-zero block reproduces the built-in
/// constants and a quality "tier" can override any subset by filling just those slots.
fn param_or(params: &[f64; PARAM_STRIDE], i: usize, default: f64) -> f64 {
    let v = params[i];
    if v > 0.0 {
        v
    } else {
        default
    }
}

/// One word's contribution to an [`ELEM_MEMORY`]'s incremental content digest, **keyed by word
/// index** so the digest is an order-independent XOR fold over the whole store
/// (`⊕ₖ mem_cell_hash(k, mem_data[k])`) yet stays O(1) per write (XOR out the old term, XOR in the
/// new — see [`Sim::write_cell`]). A **zero word contributes nothing**, so an all-zero store has
/// digest 0 — which makes `reset()`'s zeroed contents digest-consistent for free and keeps the
/// golden (no memory element) untouched. The index key defeats a swap of two equal-valued cells; a
/// replay/grading digest, not a MAC.
#[inline]
fn mem_cell_hash(k: usize, w: u32) -> u64 {
    if w == 0 {
        0
    } else {
        let mut b = [0u8; 12];
        b[..8].copy_from_slice(&(k as u64).to_le_bytes());
        b[8..].copy_from_slice(&w.to_le_bytes());
        fnv1a(&b)
    }
}

/// Minimal complex number for the frequency-domain AC analysis ([`Sim::ac_solve`]).
/// Dependency-free `f64`, so the AC solve is as deterministic as the transient one.
#[derive(Clone, Copy)]
struct Cplx {
    re: f64,
    im: f64,
}

impl Cplx {
    const ZERO: Cplx = Cplx { re: 0.0, im: 0.0 };
    const ONE: Cplx = Cplx { re: 1.0, im: 0.0 };
    fn new(re: f64, im: f64) -> Cplx {
        Cplx { re, im }
    }
    fn add(self, o: Cplx) -> Cplx {
        Cplx::new(self.re + o.re, self.im + o.im)
    }
    fn sub(self, o: Cplx) -> Cplx {
        Cplx::new(self.re - o.re, self.im - o.im)
    }
    fn mul(self, o: Cplx) -> Cplx {
        Cplx::new(
            self.re * o.re - self.im * o.im,
            self.re * o.im + self.im * o.re,
        )
    }
    fn div(self, o: Cplx) -> Cplx {
        let d = o.re * o.re + o.im * o.im;
        Cplx::new(
            (self.re * o.re + self.im * o.im) / d,
            (self.im * o.re - self.re * o.im) / d,
        )
    }
    fn abs(self) -> f64 {
        self.re.hypot(self.im)
    }
}

/// Dense complex Gaussian elimination with partial pivoting — the [`Cplx`] twin of
/// [`solve_dense`], for the small-signal AC solve. Same deterministic pivot rule
/// (strictly-greater magnitude wins; a degenerate pivot falls back to `0`).
fn solve_dense_complex(mut a: Vec<Cplx>, mut b: Vec<Cplx>, n: usize) -> Vec<Cplx> {
    debug_assert_eq!(a.len(), n * n);
    debug_assert_eq!(b.len(), n);
    for col in 0..n {
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
        if diag.abs() == 0.0 {
            continue;
        }
        for row in (col + 1)..n {
            let factor = a[row * n + col].div(diag);
            if factor.abs() == 0.0 {
                continue;
            }
            for k in col..n {
                let v = a[col * n + k];
                a[row * n + k] = a[row * n + k].sub(factor.mul(v));
            }
            b[row] = b[row].sub(factor.mul(b[col]));
        }
    }
    let mut x = vec![Cplx::ZERO; n];
    for col in (0..n).rev() {
        let mut sum = b[col];
        for k in (col + 1)..n {
            sum = sum.sub(a[col * n + k].mul(x[k]));
        }
        let diag = a[col * n + col];
        x[col] = if diag.abs() == 0.0 {
            Cplx::ZERO
        } else {
            sum.div(diag)
        };
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

// --- AC analysis (Layer 2 measurement) ----------------------------------------

/// Number of `f64` fields [`Sim::ac_measurements`] reports per element, in this
/// fixed order:
///
/// `0` Vrms, `1` Irms (true RMS incl. DC) · `2` Vmean, `3` Imean (DC component) ·
/// `4` Vamp, `5` Iamp (AC peak amplitude, `(max−min)/2`) · `6` Preal (mean `V·I`, W) ·
/// `7` PF (power factor / V–I correlation, `−1..1`) · `8` |Z| (AC, `Vac/Iac`, Ω) ·
/// `9` phase (V−I lag, signed radians: `>0` inductive lag, `<0` capacitive lead) ·
/// `10` freq (fundamental, Hz) · `11` valid (`1.0` once a full AC cycle has been
/// measured, else `0.0`).
///
/// Derived from the live V/I waveforms (snapshot-only, deterministic), **not** part
/// of the snapshot hash — like [`Sim::element_currents`]. The render reads these for
/// the shimmer/phasor handoff. See `docs/ui/high-frequency-render.md`.
pub const AC_FIELDS: usize = 12;

/// Debounce floor on samples per detected cycle: a rising zero-cross is only accepted
/// as a cycle boundary after this many samples, which also caps the detectable
/// fundamental at `1 / (AC_MIN_CYCLE_SAMPLES · DT)` (~62.5 kHz at the 2 µs step — far
/// above the teaching range).
const AC_MIN_CYCLE_SAMPLES: u32 = 8;

/// Hard cap on a window with no accepted `V` zero-cross: a slow/DC signal finalizes as
/// a DC reading (freq 0) every this-many samples instead of accumulating unbounded.
/// 250_000 samples ≈ 0.5 s at `DT`, an ~2 Hz floor on AC detection.
const AC_MAX_CYCLE_SAMPLES: u32 = 250_000;

/// Variance (V² or A²) at or below which a window's signal is treated as flat/DC: no
/// meaningful AC phase or power factor (phase 0, PF 1), and |Z| left 0 if the current
/// is flat. A small fixed floor that also guards the correlation's divide.
const AC_VAR_FLOOR: f64 = 1.0e-18;

/// Per-element running AC measurement: accumulates the terminal voltage `V(a)−V(b)`
/// and the through-current over each detected cycle of `V`, then finalizes a held set
/// of measurements ([`AC_FIELDS`]) at every cycle boundary — a deterministic,
/// O(1)-per-tick synchronous RMS / power / phase detector reading the solver's
/// waveforms. Cycles are delimited by rising zero-crossings of `V` about the previous
/// window's mean; phase is the signed sub-sample offset of the current's rising
/// crossing. All `f64`, fixed order — it reproduces bit-for-bit and rewinds with the
/// run, and being unhashed it never moves the analog golden.
#[derive(Clone, Debug)]
struct AcMeas {
    /// Whether at least one sample has been seen (seeds the crossing detector).
    primed: bool,
    /// Zero-reference for `V`'s crossing detection: the last completed window's mean
    /// (`0` until the first completes).
    ref_v: f64,
    /// Zero-reference for `I`'s crossing detection: the last completed window's mean.
    ref_i: f64,
    /// Previous sample's `V − ref_v`, for rising-edge detection of the cycle boundary.
    prev_vac: f64,
    /// Previous sample's `I − ref_i`, for the current's rising-crossing detection.
    prev_iac: f64,
    /// Samples accumulated in the in-progress window.
    n: u32,
    sum_v: f64,
    sum_i: f64,
    sum_vv: f64,
    sum_ii: f64,
    sum_vi: f64,
    vmin: f64,
    vmax: f64,
    imin: f64,
    imax: f64,
    /// Fractional sample index of `I`'s first rising crossing in the window (`−1` =
    /// none yet), the phase reference relative to the window start (`V`'s crossing).
    i_cross: f64,
    /// Finalized, held measurements in [`AC_FIELDS`] order.
    out: [f64; AC_FIELDS],
}

impl Default for AcMeas {
    fn default() -> Self {
        AcMeas {
            primed: false,
            ref_v: 0.0,
            ref_i: 0.0,
            prev_vac: 0.0,
            prev_iac: 0.0,
            n: 0,
            sum_v: 0.0,
            sum_i: 0.0,
            sum_vv: 0.0,
            sum_ii: 0.0,
            sum_vi: 0.0,
            vmin: f64::INFINITY,
            vmax: f64::NEG_INFINITY,
            imin: f64::INFINITY,
            imax: f64::NEG_INFINITY,
            i_cross: -1.0,
            out: [0.0; AC_FIELDS],
        }
    }
}

impl AcMeas {
    /// Fold one solved sample (`v = V(a)−V(b)`, `i` = through-current) into the
    /// in-progress window, detecting cycle boundaries and finalizing held results.
    fn update(&mut self, v: f64, i: f64) {
        let vac = v - self.ref_v;
        let iac = i - self.ref_i;
        if !self.primed {
            // First ever sample: seed the previous-iterate references, start window.
            self.primed = true;
            self.prev_vac = vac;
            self.prev_iac = iac;
            self.accumulate(v, i);
            return;
        }
        // Record `I`'s first rising zero-crossing within the window. It sits between
        // accumulated sample `n-1` (prev_iac) and the sample about to be added (`n`);
        // linear interpolation gives the sub-sample fractional index.
        if self.i_cross < 0.0 && self.prev_iac < 0.0 && iac >= 0.0 && self.n > 0 {
            let frac = -self.prev_iac / (iac - self.prev_iac);
            self.i_cross = (self.n - 1) as f64 + frac;
        }
        // A rising zero-crossing of `V` (about the window mean) closes the cycle.
        if self.prev_vac < 0.0 && vac >= 0.0 && self.n >= AC_MIN_CYCLE_SAMPLES {
            self.finalize(self.n);
            self.reset_window();
        } else if self.n >= AC_MAX_CYCLE_SAMPLES {
            // Slow/DC signal: finalize a DC reading (period 0 → freq 0) and start fresh.
            self.finalize(0);
            self.reset_window();
        }
        self.prev_vac = vac;
        self.prev_iac = iac;
        self.accumulate(v, i);
    }

    /// Add a sample to the running window sums and peak trackers.
    fn accumulate(&mut self, v: f64, i: f64) {
        self.n += 1;
        self.sum_v += v;
        self.sum_i += i;
        self.sum_vv += v * v;
        self.sum_ii += i * i;
        self.sum_vi += v * i;
        if v < self.vmin {
            self.vmin = v;
        }
        if v > self.vmax {
            self.vmax = v;
        }
        if i < self.imin {
            self.imin = i;
        }
        if i > self.imax {
            self.imax = i;
        }
    }

    /// Compute and store the held measurements for the just-completed window.
    /// `period` is the cycle length in samples; `period == 0` marks a DC/slow
    /// finalize (freq 0, phase 0).
    fn finalize(&mut self, period: u32) {
        let n = self.n.max(1) as f64;
        let mean_v = self.sum_v / n;
        let mean_i = self.sum_i / n;
        let ms_v = self.sum_vv / n;
        let ms_i = self.sum_ii / n;
        let vrms = ms_v.max(0.0).sqrt();
        let irms = ms_i.max(0.0).sqrt();
        let var_v = (ms_v - mean_v * mean_v).max(0.0);
        let var_i = (ms_i - mean_i * mean_i).max(0.0);
        let cov = self.sum_vi / n - mean_v * mean_i;
        let preal = self.sum_vi / n;
        let vamp = if self.vmax >= self.vmin {
            (self.vmax - self.vmin) * 0.5
        } else {
            0.0
        };
        let iamp = if self.imax >= self.imin {
            (self.imax - self.imin) * 0.5
        } else {
            0.0
        };
        // Power factor = the V–I correlation coefficient (= cos φ for a single-frequency
        // pair), guarded against the flat-signal divide.
        let pf = if var_v > AC_VAR_FLOOR && var_i > AC_VAR_FLOOR {
            (cov / (var_v * var_i).sqrt()).clamp(-1.0, 1.0)
        } else {
            1.0
        };
        // AC impedance magnitude (Vac_rms / Iac_rms); 0 when the current is flat.
        let zmag = if var_i > AC_VAR_FLOOR {
            (var_v / var_i).sqrt()
        } else {
            0.0
        };
        // Phase: signed V−I lag. The MAGNITUDE is the V–I correlation angle `acos(pf)`, which is
        // EXACT for proportional signals — a resistor reads `pf = 1 → 0` with no sampling artifact.
        // (Taking the angle straight from the current's crossing offset instead reads a spurious
        // `~2π/period` lead for an in-phase current, because its crossing lands on the cycle
        // boundary — e.g. −14° at 25 samples/cycle.) The SIGN (lead vs lag) comes from where the
        // current's rising crossing sits in the cycle: early ⇒ lag (inductive, +), late ⇒ lead
        // (capacitive, −). Both agree with the raw-crossing angle for a genuine reactive phase.
        let phase =
            if period > 0 && var_v > AC_VAR_FLOOR && var_i > AC_VAR_FLOOR && self.i_cross >= 0.0 {
                let mag = pf.clamp(-1.0, 1.0).acos();
                let lead = (self.i_cross / period as f64) > 0.5;
                if lead {
                    -mag
                } else {
                    mag
                }
            } else {
                0.0
            };
        let freq = if period > 0 {
            1.0 / (period as f64 * DT)
        } else {
            0.0
        };
        let valid = if period > 0 && var_v > AC_VAR_FLOOR {
            1.0
        } else {
            0.0
        };
        self.out = [
            vrms, irms, mean_v, mean_i, vamp, iamp, preal, pf, zmag, phase, freq, valid,
        ];
    }

    /// Carry the just-finalized window's means as the next window's zero references
    /// and clear the accumulators for the new cycle.
    fn reset_window(&mut self) {
        let n = self.n.max(1) as f64;
        self.ref_v = self.sum_v / n;
        self.ref_i = self.sum_i / n;
        self.n = 0;
        self.sum_v = 0.0;
        self.sum_i = 0.0;
        self.sum_vv = 0.0;
        self.sum_ii = 0.0;
        self.sum_vi = 0.0;
        self.vmin = f64::INFINITY;
        self.vmax = f64::NEG_INFINITY;
        self.imin = f64::INFINITY;
        self.imax = f64::NEG_INFINITY;
        self.i_cross = -1.0;
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
    /// MNA **row index** (`node − 1`) of every node whose [`NetClass`] is pure
    /// [`NetClass::Digital`] (NOT `Boundary`, NOT `Analog`), in **ascending node index** —
    /// a deterministic partition fixed at install from [`classify_nets`], with no hashed
    /// order. This is the row set of the analog-decoupled pure-digital block that ADR 0004's
    /// phase-3 sub-tick loop (step 3b) will re-solve N−1 extra times per analog tick; it is
    /// the metadata that step staging needs. **Pure scaffolding today:** nothing in the solve
    /// reads it — it is consumed ONLY by the debug-only structural invariant check
    /// ([`Sim::debug_assert_digital_block_diagonal`]), which proves each of these rows is
    /// strictly diagonal (no off-diagonal coupling to any other row) right before every
    /// `solve_dense`. A pure-`Digital` net's row is stamped ONLY by [`Sim::stamp_digital`] (a
    /// lone `GMIN` + one resolved Thévenin on its diagonal; a gate's inputs are GMIN-only and
    /// its output is one combined drive), so the block is diagonal by construction — the
    /// invariant step 3b's frozen-boundary sub-solve relies on. The solve, the partial-pivot
    /// order, and the snapshot hash are untouched, so the analog golden is byte-identical.
    /// See `docs/adr/0004-protocol-engine.md` (phase-3 amendment).
    pub(crate) digital_rows: Vec<usize>,
    /// The **global digital sub-tick rate** `S = max over elements of their declared rate`
    /// ([`beh_subtick_rate`]), computed once at install (ADR 0004 phase-3, step 3b). `S = 1` for
    /// every circuit with no declared fast rate (i.e. every circuit that existed before sub-ticking
    /// — only an [`ELEM_BEHAVIORAL`] block can declare a rate, via [`BEH_SUBTICK_RATE_SLOT`]), and
    /// then the `S > 1` sub-tick branch in [`Sim::step`] is skipped entirely, so the result is
    /// **byte-identical** to before the loop existed. For `S > 1` the analog solve still runs once
    /// per analog tick (the analog Δt never changes — the golden's Δt is fixed); only the
    /// analog-decoupled pure-digital block (`digital_rows`) is re-evaluated `S − 1` extra times,
    /// advancing the fast digital domain. The count is structural (declared, not value-derived) and
    /// the loop is a fixed `S`, so it is reproducible by construction. The transient sub-tick index
    /// is wrapped to `0` at the analog-tick boundary and **never** enters [`Sim::snapshot_hash`].
    subtick_rate: usize,
    /// Circuit nodes (1-based; ground is never listed) that each anchor a **floating
    /// connected component** — a subnet with no galvanic path to ground and no
    /// device-pinned terminal. Computed once at install by [`floating_refs`]; each is
    /// weakly tied to ground with one [`GMIN`] in every assembly path
    /// ([`Sim::stamp_floating_refs`]) so an isolated subnet (a floating transformer
    /// secondary, an isolated sensor) has a defined common-mode instead of a singular
    /// row. Empty for any fully grounded circuit, so the analog golden is unchanged.
    /// See `docs/sim/floating-networks.md`.
    floating_refs: Vec<usize>,

    /// Latest solved node voltages, length `node_count`, index `0` always `0.0`.
    node_v: Vec<f64>,
    /// Dynamic state carried between steps: for a capacitor (`ELEM_CAPACITOR`),
    /// the previous `V(a) - V(b)`; for an inductor (`ELEM_INDUCTOR`), the
    /// previous branch current `i` (oriented `a -> b`); for a transformer
    /// (`ELEM_TRANSFORMER`), the previous **magnetising** current `Im` (a -> b) — the
    /// only winding current that carries reactive memory in the ideal-T model. Unused
    /// for other kinds. One entry per element, indexed in lockstep with `elements`.
    reactive_state: Vec<f64>,
    /// Second reactive store, paralleling `reactive_state`: for a transformer
    /// (`ELEM_TRANSFORMER`), the previous **secondary** current `Is` (c -> d), the
    /// history term of its [`TRANSFORMER_LLEAK`] leakage-inductance companion (which
    /// limits rectifier inrush without softening the hard turns-ratio differential).
    /// `0.0` for every other element. One entry per element, in lockstep with
    /// `elements`. Like `reactive_state` it is reflected in `node_v` (not hashed
    /// directly), so it never perturbs the snapshot hash format.
    secondary_state: Vec<f64>,
    /// Whole-sim **FAIL** flag: set when the most recent solve produced a non-physical
    /// result (non-finite or beyond [`FAIL_LIMIT`]) that was clamped. The renderer
    /// surfaces this as the global FAIL state. Derived from the (clamped) solved state,
    /// so it is not itself hashed — a well-behaved circuit leaves it `false`.
    failed: bool,
    /// Per-element FAIL mask (length = `elements.len()`): `true` for each element whose
    /// own reading hit the FAIL bound this step, so the renderer can box exactly the
    /// offending parts. Recomputed every step.
    failed_elements: Vec<bool>,
    /// The D flip-flop's stored output [`Level`]: the bit latched at the last rising
    /// clock edge, which drives `Q` (and inverted, `Q̄`) every tick until the next edge.
    /// Used only by [`ELEM_DFF`]; `Level::Low` for every other element. Persistent
    /// sequential state that **enters the snapshot hash** (so a rewind landing on a
    /// clock edge replays identically). Indexed in lockstep with `elements`.
    ff_q: Vec<Level>,
    /// The D flip-flop's previous clock [`Level`], kept so the commit phase can detect a
    /// rising edge (`Low -> High`). Used only by [`ELEM_DFF`]; `Level::Low` elsewhere.
    /// Also hashed (it is part of the sequential state). Indexed with `elements`.
    ff_clk_prev: Vec<Level>,
    /// The clocked sampler's stored output [`Level`]: the one-bit comparison latched at the
    /// last rising clock edge (`High` iff `V(IN) > value`), which drives `OUT` every tick
    /// until the next edge. Used only by [`ELEM_SAMPLER`]; `Level::Low` for every other
    /// element. Persistent sequential state that **enters the snapshot hash** (so a rewind
    /// landing on a clock edge replays identically). Indexed in lockstep with `elements`.
    samp_q: Vec<Level>,
    /// The clocked sampler's previous clock [`Level`], kept so the commit phase can detect a
    /// rising edge (`Low -> High`). Used only by [`ELEM_SAMPLER`]; `Level::Low` elsewhere.
    /// Also hashed (it is part of the sequential state). Indexed with `elements`.
    samp_clk_prev: Vec<Level>,
    /// The latched comparator's held output [`Level`]: the current/held comparison bit (`High`
    /// iff the front end has resolved `IN+ > IN-` within its hysteresis window), which drives
    /// `OUT` every tick. While the comparator is *transparent* (LE not asserted) it tracks the
    /// live comparison; while *latched* (LE low) it holds; an unpowered rail freezes it. Used
    /// only by [`ELEM_COMPARATOR`]; `Level::Low` for every other element. Persistent sequential
    /// state that **enters the snapshot hash** (so a rewind replays identically). Indexed in
    /// lockstep with `elements`. Unlike the sampler the comparator is level-sensitive, so it
    /// needs no previous-clock companion — `cmp_q` is its only persistent scalar.
    cmp_q: Vec<Level>,
    /// Per-element **behavioral-block integer state** — a fixed `[u32; `[`BEH_STATE_WORDS`]`]`
    /// block carrying an [`ELEM_BEHAVIORAL`]'s state machine (fsm + shift registers + counters +
    /// edge flags; the word map is program-specific — see [`beh_spi_step`] for the SPI master).
    /// Used only by [`ELEM_BEHAVIORAL`]; an all-zero block for every other element. **Integer
    /// only** (no floats, no PRNG) and advanced once per step in the commit phase from the
    /// just-solved committed `node_v`. Persistent sequential state that **enters the snapshot
    /// hash** in fixed element + word order (appended after the existing folds, so a circuit
    /// with no behavioral block folds zero extra bytes and the golden is byte-identical).
    /// Indexed in lockstep with `elements`.
    beh_state: Vec<[u32; BEH_STATE_WORDS]>,
    /// **Behavioral memory contents** ([`ELEM_MEMORY`]) — a ragged per-element store: an
    /// [`ELEM_MEMORY`] element gets `depth = 2^addrWidth` words (one `u32` per word for
    /// `wordWidth ≤ 32`); EVERY other element gets an **empty** `Vec` so the outer length stays in
    /// lockstep with `elements` (the fixed element order the hash fold relies on). The bytes live
    /// in the heap, never the MNA matrix. Mutated ONLY through [`Sim::write_cell`] so `mem_digest`
    /// can never drift. Sized at install beside `beh_state`.
    mem_data: Vec<Vec<u32>>,
    /// **Incremental content digest** for each [`ELEM_MEMORY`] (0 for every other element). A pure,
    /// order-independent function of the current contents, maintained O(1) per write
    /// ([`Sim::write_cell`]) — the perf keystone, since [`Sim::snapshot_hash`] rebuilds its whole
    /// byte stream every step and folding a multi-MB array byte-by-byte would stall. Only the
    /// 8-byte digest folds. All-zero contents → digest 0 (a zero word contributes nothing), so
    /// `reset()`'s zeroed store is digest-consistent and the golden is untouched.
    mem_digest: Vec<u64>,
    /// **Hashed EEPROM wear counter** per element (0 for non-memory). Program activity increments
    /// it and it decides a program-visible wear-out FAIL, so it MUST hash (else a replay wears out
    /// at a different point). Folds beside `mem_digest`. Real-mode-gated wear-out; in Ideal it is a
    /// constant, golden-clean.
    mem_wear: Vec<u32>,
    /// **DRAM per-word refresh epoch** — the absolute tick each word was last refreshed (accessed or
    /// written), one `u64` per word, mirroring `mem_data`'s shape; all-zero for non-DRAM. A DRAM word not
    /// refreshed within its `retention_ticks` leaks its stored 1 → 0 (eager decay in the commit phase), so
    /// "refresh or your data rots" is real + deterministic. Hashed (folded) ONLY for DRAM (mode 3)
    /// elements — program-visible state that must reproduce on rewind; RAM/ROM/EEPROM (and the golden)
    /// fold nothing here, so they are byte-identical.
    mem_refresh: Vec<Vec<u64>>,
    /// **Word-level bus-port node lists** (#100, ELEM_MEMORY P3 / option A) — the explicit per-bit node
    /// channel that lets a single `ELEM_MEMORY` span a wide address + data bus the 8 fixed terminals cannot
    /// hold. `mem_addr_nodes[i]` is element `i`'s address bus (LSB-first node indices), `mem_din_nodes[i]`
    /// the data-IN bus, `mem_dout_nodes[i]` the data-OUT bus; every non-wide element (cell-level memory, and
    /// every other kind) holds an **empty** `Vec`, so the outer length stays `== elements.len()`. Populated
    /// out-of-band by [`Sim::set_memory_ports`] AFTER install (the indices reference the just-installed node
    /// space), which then re-classifies + re-primes. **Topology, not state:** set at install, untouched by
    /// `reset`, and never hashed (the *contents* hash via `mem_digest`, identical regardless of port width).
    /// An element with a NON-empty `mem_dout_nodes` takes the wide READ/WRITE path; empty ⇒ the cell-level
    /// a/b/c/f/g/h path, byte-identical to before (golden-safe by construction).
    mem_addr_nodes: Vec<Vec<usize>>,
    mem_din_nodes: Vec<Vec<usize>>,
    mem_dout_nodes: Vec<Vec<usize>>,
    /// Committed digital [`Level`] of every node, from the quantisation of last tick's
    /// solved voltage ([`LogicFamily::quantize`]). The digital engine reads these as its
    /// inputs (one tick of delay). Meaningful for `Digital`/`Boundary` nets; `Low` for
    /// analog nets. Length `node_count`. The pure-`Digital` nets' levels feed the hash.
    net_level: Vec<Level>,
    /// Scratch: each node's resolved driven [`Level`] this tick (the digital engine
    /// folds all of a net's drivers via [`combine`] in element order), with its driver
    /// rail in `digital_vhigh`. Recomputed every solve by [`Sim::eval_digital`]; not
    /// committed state and not hashed. Length `node_count`.
    digital_drive: Vec<Level>,
    /// Scratch: the rail SPAN (`vhigh − vlow`) of each node's digital driver, paired with
    /// `digital_drive` so the stamp can turn a [`Level`] into a Thévenin voltage. For a
    /// legacy gate this is `value`; for a powered gate it is `V(VCC) − V(GND)`.
    digital_vhigh: Vec<f64>,
    /// Scratch: the GND reference (`vlow`) each node's digital levels are measured from,
    /// paired with `digital_vhigh`. `0` for a legacy/ground-referenced driver; `V(GND)`
    /// for a powered gate whose GND pin sits above ground, so its output swings
    /// `vlow + frac·(vhigh − vlow)` and its inputs threshold relative to `vlow`.
    digital_vlow: Vec<f64>,
    /// Scratch: the [`FAMILIES`] index of each node's digital driver, so the driver
    /// stamp ([`Sim::stamp_digital`]) and the canonical-level commit
    /// ([`Sim::commit_net_levels`]) use that driver's family levels. Paired with
    /// `digital_drive`/`digital_vhigh`; recomputed every solve. `0` (LEGACY) if undriven.
    digital_family: Vec<u8>,
    /// Diagnostic ONLY (telemetry/render — NEVER folded into `snapshot_hash`, never read by the solve):
    /// the Newton iteration count of the most recent nonlinear solve, and whether it converged. A solve
    /// that reaches [`NEWTON_MAX_ITERS`] without converging (`last_newton_converged == false`) settled to
    /// its last iterate — the sign of a network too large/stiff for the bare seeded Newton (e.g. a big
    /// transistor-level cell). Pure read-out; adding/reading these cannot move the golden.
    last_newton_iters: usize,
    last_newton_converged: bool,
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
    /// Per-element logic-gate driven output voltage for the current tick: recomputed
    /// before each solve by [`Sim::eval_digital`] from the committed previous-tick
    /// input levels, then read back when committing the gate's output current. Pure
    /// within-tick scratch — *not* persistent state and never hashed. Only gate entries
    /// are meaningful; others stay `0.0`. Indexed in lockstep with `elements`.
    gate_target: Vec<f64>,
    /// Per-element logic-gate output **conductance** for the current tick, paired with
    /// `gate_target` so the displayed current is `gate_gout·(gate_target − V(a))` — the
    /// family's drive strength, and `0` when an open-drain output has **released** (so a
    /// released output reads ~0 A, not a spurious pull current). Scratch; never hashed.
    gate_gout: Vec<f64>,
    /// Latest current through each element (oriented `a -> b`), one entry per
    /// element in submission order. Committed by every solve while the
    /// pre-step reactive state is still in scope, so `element_currents` is a
    /// pure function of the committed readout and consistent with `node_v` at
    /// the same tick. See [`Sim::element_currents`] for the per-kind formulas.
    currents: Vec<f64>,
    /// Per-element running **AC analyzer** (one [`AcMeas`] per element, in submission
    /// order), updated each committed step from that element's terminal voltage and
    /// current. Holds the last full cycle's RMS / power / phase measurements
    /// ([`AC_FIELDS`]), read out by [`Sim::ac_measurements`]. Derived, snapshot-only,
    /// and **not hashed** (like `currents`), so it never moves the analog golden; it
    /// reproduces because it is a pure function of the V/I trajectory.
    ac: Vec<AcMeas>,
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
            digital_rows: Vec::new(),
            subtick_rate: 1,
            floating_refs: Vec::new(),
            node_v: vec![0.0],
            reactive_state: Vec::new(),
            secondary_state: Vec::new(),
            failed: false,
            failed_elements: Vec::new(),
            ff_q: Vec::new(),
            ff_clk_prev: Vec::new(),
            samp_q: Vec::new(),
            samp_clk_prev: Vec::new(),
            cmp_q: Vec::new(),
            beh_state: Vec::new(),
            mem_data: Vec::new(),
            mem_digest: Vec::new(),
            mem_wear: Vec::new(),
            mem_refresh: Vec::new(),
            mem_addr_nodes: Vec::new(),
            mem_din_nodes: Vec::new(),
            mem_dout_nodes: Vec::new(),
            net_level: vec![Level::Low],
            digital_drive: vec![Level::Z],
            digital_vhigh: vec![0.0],
            digital_vlow: vec![0.0],
            digital_family: vec![0],
            last_newton_iters: 0,
            last_newton_converged: true,
            diode_vd: Vec::new(),
            mosfet_vgs: Vec::new(),
            mosfet_vds: Vec::new(),
            bjt_vbe: Vec::new(),
            bjt_vbc: Vec::new(),
            varistor_v: Vec::new(),
            opamp_vd: Vec::new(),
            gate_target: Vec::new(),
            gate_gout: Vec::new(),
            currents: Vec::new(),
            ac: Vec::new(),
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
                e: 0,
                f: 0,
                g: 0,
                h: 0,
                value: v_source,
                aux: 0.0,
                params: [0.0; PARAM_STRIDE],
            },
            Element {
                kind: ELEM_RESISTOR,
                a: 1,
                b: 2,
                c: 0,
                d: 0,
                e: 0,
                f: 0,
                g: 0,
                h: 0,
                value: 1_000.0,
                aux: 0.0,
                params: [0.0; PARAM_STRIDE],
            },
            Element {
                kind: ELEM_CAPACITOR,
                a: 2,
                b: 0,
                c: 0,
                d: 0,
                e: 0,
                f: 0,
                g: 0,
                h: 0,
                value: 1.0e-6,
                aux: 0.0,
                params: [0.0; PARAM_STRIDE],
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
        self.set_netlist_pe(node_count, types, a, b, c, d, &[], values, aux, &[])
    }

    /// Install a netlist with an explicit per-device [`Element::params`] block (see
    /// [`Element::params`]). `params` is either empty (all kind defaults — identical to
    /// [`Sim::set_netlist`]) or exactly `PARAM_STRIDE` `f64`s per element. Additive and
    /// golden-safe: an all-zero block reproduces the default behaviour bit for bit.
    #[allow(clippy::too_many_arguments)]
    pub fn set_netlist_p(
        &mut self,
        node_count: usize,
        types: &[u8],
        a: &[u32],
        b: &[u32],
        c: &[u32],
        d: &[u32],
        values: &[f64],
        aux: &[f64],
        params: &[f64],
    ) -> bool {
        self.set_netlist_pe(node_count, types, a, b, c, d, &[], values, aux, params)
    }

    /// Install a netlist with the optional **fifth terminal** `e` (a powered logic gate's
    /// GND pin; see [`Element::e`]). `e` is either empty — every element's fifth terminal
    /// is ground (`0`), the legacy 4-terminal shape, identical to [`Sim::set_netlist_p`] —
    /// or exactly one node index per element. Thin wrapper over [`Sim::set_netlist_pefgh`]
    /// with the sixth/seventh/eighth terminals grounded (`f`/`g`/`h` empty).
    #[allow(clippy::too_many_arguments)]
    pub fn set_netlist_pe(
        &mut self,
        node_count: usize,
        types: &[u8],
        a: &[u32],
        b: &[u32],
        c: &[u32],
        d: &[u32],
        e: &[u32],
        values: &[f64],
        aux: &[f64],
        params: &[f64],
    ) -> bool {
        self.set_netlist_pefgh(
            node_count,
            types,
            a,
            b,
            c,
            d,
            e,
            &[],
            &[],
            &[],
            values,
            aux,
            params,
        )
    }

    /// The full netlist install, carrying all **eight** terminals (`a`–`h`). Terminals
    /// `f`/`g`/`h` were provisioned by ADR 0002 (the wire-format widening): each is either
    /// empty — every element's sixth/seventh/eighth terminal is ground (`0`), inert and
    /// bit-identical to the legacy 5-terminal shape — or exactly one node index per element.
    /// No element reads `f`/`g`/`h` yet, so passing them is purely forward-compatible
    /// provisioning; like `c`/`d`/`e`, an element that doesn't read a terminal leaves it `0`
    /// and is unaffected, so this is an additive, golden-safe widening. `e` follows the same
    /// empty-or-full rule (see [`Sim::set_netlist_pe`]) and `params` the same empty-or-`n *
    /// PARAM_STRIDE` rule as [`Sim::set_netlist_p`].
    #[allow(clippy::too_many_arguments)]
    pub fn set_netlist_pefgh(
        &mut self,
        node_count: usize,
        types: &[u8],
        a: &[u32],
        b: &[u32],
        c: &[u32],
        d: &[u32],
        e: &[u32],
        f: &[u32],
        g: &[u32],
        h: &[u32],
        values: &[f64],
        aux: &[f64],
        params: &[f64],
    ) -> bool {
        let n = types.len();
        if a.len() != n
            || b.len() != n
            || c.len() != n
            || d.len() != n
            // `e`/`f`/`g`/`h` are optional: empty means "every such terminal is ground";
            // otherwise each is exactly one node index per element.
            || (!e.is_empty() && e.len() != n)
            || (!f.is_empty() && f.len() != n)
            || (!g.is_empty() && g.len() != n)
            || (!h.is_empty() && h.len() != n)
            || values.len() != n
            || aux.len() != n
            // Params are optional: an empty block means "all defaults"; otherwise it is
            // exactly PARAM_STRIDE per element.
            || (!params.is_empty() && params.len() != n * PARAM_STRIDE)
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
                    | ELEM_LEVELSHIFT
                    | ELEM_PULLUP
                    | ELEM_SAMPLER
                    | ELEM_COMPARATOR
                    | ELEM_ASWITCH
                    | ELEM_BEHAVIORAL
                    | ELEM_MEMORY
            ) {
                self.install_empty();
                return false;
            }
            let na = a[i] as usize;
            let nb = b[i] as usize;
            let nc = c[i] as usize;
            let nd = d[i] as usize;
            // The fifth..eighth terminals; ground when their array is omitted.
            let ne = if e.is_empty() { 0 } else { e[i] as usize };
            let nf = if f.is_empty() { 0 } else { f[i] as usize };
            let ng = if g.is_empty() { 0 } else { g[i] as usize };
            let nh = if h.is_empty() { 0 } else { h[i] as usize };
            // Validate all eight terminals. `c`–`h` are ignored at solve time for an
            // element that doesn't use them, but they are still range-checked so a
            // malformed index is rejected fail-safe rather than stored.
            if na >= node_count
                || nb >= node_count
                || nc >= node_count
                || nd >= node_count
                || ne >= node_count
                || nf >= node_count
                || ng >= node_count
                || nh >= node_count
            {
                self.install_empty();
                return false;
            }
            let mut p = [0.0; PARAM_STRIDE];
            if !params.is_empty() {
                p.copy_from_slice(&params[i * PARAM_STRIDE..(i + 1) * PARAM_STRIDE]);
            }
            elements.push(Element {
                kind,
                a: na,
                b: nb,
                c: nc,
                d: nd,
                e: ne,
                f: nf,
                g: ng,
                h: nh,
                value: values[i],
                aux: aux[i],
                params: p,
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
        // Install classifies with NO wide ports (the cell-level / non-memory path). A wide memory's bus
        // nodes are added later by `set_memory_ports`, which re-runs classification with the filled lists.
        let net_classes = classify_nets(node_count, &elements, &[], &[], &[]);
        // Deterministic pure-digital row partition (ADR 0004 phase-3, step 3a): the MNA row
        // index (`node − 1`) of every node classified pure-`Digital` (NOT `Boundary`, NOT
        // `Analog`), in ascending node index — fixed at install, no hashed order. Ground
        // (node 0) is always `Analog`, so a `Digital` node is always `>= 1` and `node − 1` is
        // a valid node-voltage row. Metadata only: nothing in the solve reads it (the matrix
        // is assembled and solved exactly as before); it is consumed only by the debug-only
        // diagonal-block invariant check, so the analog golden is byte-identical.
        let digital_rows: Vec<usize> = (1..node_count)
            .filter(|&n| net_classes[n] == NetClass::Digital)
            .map(|n| n - 1)
            .collect();
        let floating = floating_refs(node_count, &elements);

        self.node_count = node_count;
        self.dim = next;
        self.branch_index = branch_index;
        self.has_nonlinear = has_nonlinear;
        self.net_classes = net_classes;
        self.digital_rows = digital_rows;
        // Global digital sub-tick rate S = max declared rate over all elements (ADR 0004 step 3b).
        // Structural — read once here from the declared params, never from a solved value. `S = 1`
        // (no element declares a fast rate) ⇒ the `S > 1` branch in `step()` is skipped, so the run
        // is byte-identical to before sub-ticking existed.
        self.subtick_rate = elements
            .iter()
            .map(beh_subtick_rate)
            .max()
            .unwrap_or(1)
            .max(1);
        self.floating_refs = floating;
        self.reactive_state = vec![0.0; elements.len()];
        self.secondary_state = vec![0.0; elements.len()];
        self.failed = false;
        self.failed_elements = vec![false; elements.len()];
        self.ff_q = vec![Level::Low; elements.len()];
        self.ff_clk_prev = vec![Level::Low; elements.len()];
        self.samp_q = vec![Level::Low; elements.len()];
        self.samp_clk_prev = vec![Level::Low; elements.len()];
        self.cmp_q = vec![Level::Low; elements.len()];
        self.beh_state = vec![[0u32; BEH_STATE_WORDS]; elements.len()];
        // Behavioral memory: size each ELEM_MEMORY's store to its depth (2^addrWidth, capped so a
        // malformed param can't request an absurd allocation); every other element gets an empty
        // Vec so the outer length stays == elements.len() (the fixed-order fold depends on it).
        // All-zero contents → digest 0 (a zero word contributes nothing), so the parallel zeroed
        // digest/wear are already consistent. Sized in lockstep with `beh_state`.
        self.mem_data = elements
            .iter()
            .map(|e| {
                if e.kind == ELEM_MEMORY {
                    let aw = param_or(&e.params, 1, 0.0).clamp(0.0, 24.0) as u32;
                    vec![0u32; 1usize << aw]
                } else {
                    Vec::new()
                }
            })
            .collect();
        self.mem_digest = vec![0u64; elements.len()];
        self.mem_wear = vec![0u32; elements.len()];
        // DRAM refresh epochs mirror `mem_data`'s shape (one u64 per word; empty for non-memory), all 0.
        self.mem_refresh = self
            .mem_data
            .iter()
            .map(|store| vec![0u64; store.len()])
            .collect();
        // Word-level bus-port lists start empty (cell-level path); `set_memory_ports` fills them after
        // install for wide memories. Sized to elements.len() so the wide READ/WRITE arms can index by `i`.
        self.mem_addr_nodes = vec![Vec::new(); self.mem_data.len()];
        self.mem_din_nodes = vec![Vec::new(); self.mem_data.len()];
        self.mem_dout_nodes = vec![Vec::new(); self.mem_data.len()];
        self.net_level = vec![Level::Low; node_count];
        self.digital_drive = vec![Level::Z; node_count];
        self.digital_vhigh = vec![0.0; node_count];
        self.digital_vlow = vec![0.0; node_count];
        self.digital_family = vec![0; node_count];
        self.diode_vd = vec![0.0; elements.len()];
        self.mosfet_vgs = vec![0.0; elements.len()];
        self.mosfet_vds = vec![0.0; elements.len()];
        self.bjt_vbe = vec![0.0; elements.len()];
        self.bjt_vbc = vec![0.0; elements.len()];
        self.varistor_v = vec![0.0; elements.len()];
        self.opamp_vd = vec![0.0; elements.len()];
        self.gate_target = vec![0.0; elements.len()];
        self.gate_gout = vec![0.0; elements.len()];
        self.currents = vec![0.0; elements.len()];
        self.ac = vec![AcMeas::default(); elements.len()];
        self.node_v = vec![0.0; node_count];
        self.elements = elements;
        self.tick = 0;
        // Prime the readout at the initial operating point (t = 0). Does not
        // advance the tick or the per-tick reactive state.
        self.solve_operating_point();
        self.commit_net_levels();
    }

    /// Reset to `t = 0` with reactive elements discharged, keeping the same
    /// netlist.
    pub fn reset(&mut self) {
        self.tick = 0;
        for s in &mut self.reactive_state {
            *s = 0.0;
        }
        for s in &mut self.secondary_state {
            *s = 0.0;
        }
        self.failed = false;
        for s in &mut self.failed_elements {
            *s = false;
        }
        for s in &mut self.ff_q {
            *s = Level::Low;
        }
        for s in &mut self.ff_clk_prev {
            *s = Level::Low;
        }
        for s in &mut self.samp_q {
            *s = Level::Low;
        }
        for s in &mut self.samp_clk_prev {
            *s = Level::Low;
        }
        for s in &mut self.cmp_q {
            *s = Level::Low;
        }
        for s in &mut self.beh_state {
            *s = [0u32; BEH_STATE_WORDS];
        }
        // Behavioral memory: zero contents + digest + wear uniformly (the golden has no memory, so
        // this is golden-clean; volatility — re-seeding ROM/EEPROM from its saved image — lives
        // web-side, re-issued via `load_memory` only for non-volatile modes). All-zero contents are
        // digest-consistent with digest 0 (a zero word contributes nothing).
        for v in &mut self.mem_data {
            for w in v.iter_mut() {
                *w = 0;
            }
        }
        for d in &mut self.mem_digest {
            *d = 0;
        }
        for w in &mut self.mem_wear {
            *w = 0;
        }
        for v in &mut self.mem_refresh {
            for r in v.iter_mut() {
                *r = 0;
            }
        }
        for s in &mut self.net_level {
            *s = Level::Low;
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
        // Clear the per-element AC analyzers so a rewind re-accumulates from t = 0.
        for a in &mut self.ac {
            *a = AcMeas::default();
        }
        self.solve_operating_point();
        self.commit_net_levels();
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

    /// Stamp the weak [`GMIN`] common-mode tie for each floating-component reference
    /// node (`self.floating_refs`, computed at install by [`floating_refs`]) into an
    /// assembled MNA matrix of dimension `n`. Each reference is a circuit node whose
    /// component has no galvanic path to ground; a single `GMIN` on its diagonal
    /// removes that component's singular common-mode row without disturbing the physics
    /// (1 pS is twelve orders below any real conductance) — the component-level analogue
    /// of the per-gate/op-amp `GMIN`. A grounded circuit has no floating component, so
    /// the list is empty and this is a no-op (the analog golden is unchanged). Each
    /// node is `>= 1` (ground is never floating), so its MNA row `node - 1` is always a
    /// valid node-voltage index `< n`. See `docs/sim/floating-networks.md`.
    #[inline]
    fn stamp_floating_refs(&self, mat: &mut [f64], n: usize) {
        for &node in &self.floating_refs {
            let r = node - 1;
            mat[r * n + r] += GMIN;
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
    fn mosfet_op(e: &Element, vgs: f64, vds: f64) -> MosfetOp {
        // Transconductance parameter Kp from param slot 0 (a quality tier — a stronger part
        // drives more current per volt), else the default.
        let kp = param_or(&e.params, 0, MOS_KP);
        if e.kind == ELEM_PMOS {
            // Evaluate the NMOS square law on the mirrored internal variables.
            let op = mosfet_eval(-vgs, -vds, kp, -PMOS_VTO, MOS_LAMBDA);
            MosfetOp {
                id: -op.id,
                gm: op.gm,
                gds: op.gds,
            }
        } else {
            mosfet_eval(vgs, vds, kp, NMOS_VTO, MOS_LAMBDA)
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
    fn bjt_op(e: &Element, vbe: f64, vbc: f64) -> BjtOp {
        // Forward current gain β from param slot 0 (a quality tier — a higher-gain part),
        // else the default.
        let bf = param_or(&e.params, 0, BJT_BF);
        if e.kind == ELEM_PNP {
            // Evaluate the NPN model on the mirrored internal junction voltages.
            let op = bjt_eval(-vbe, -vbc, BJT_IS, DIODE_VT, bf, BJT_BR);
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
            bjt_eval(vbe, vbc, BJT_IS, DIODE_VT, bf, BJT_BR)
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
        // Resolve the digital domain first (from the committed input levels) so the
        // boundary/digital drives are ready for whichever assembly path runs.
        self.eval_digital();
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
                ELEM_SWITCH | ELEM_ASWITCH => {
                    // Clock-driven switch (a time-varying conductance computed from the
                    // tick, tick 0 at the operating point) or node-gated analog switch
                    // (its conductance derived from the control node's committed voltage).
                    // Either way a symmetric conductance stamped exactly like a resistor.
                    let g = if e.kind == ELEM_ASWITCH {
                        self.aswitch_conductance(e)
                    } else {
                        self.switch_conductance(e)
                    };
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
                    // Source output impedance (Real-mode tier): V(a)-V(b) = EMF - Rout·i, so
                    // the supply sags under load. Rout is param slot 0 — 0 (the default, and
                    // every ideal-mode source) is a perfect zero-impedance source. The
                    // capacitor shares this branch arm but has no output resistance, so skip it.
                    // (The branch current is signed so a sourcing source has `i < 0`, hence
                    // `−Rout·i` is the positive sag term: V(a)−V(b) = EMF − Rout·i_load.)
                    if e.kind != ELEM_CAPACITOR {
                        mat[bi * n + bi] -= e.params[0];
                    }
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
                ELEM_ISOURCE => {
                    // Ideal current source injecting `i` a -> b: current leaves a
                    // (rhs[a] -= i) and enters b (rhs[b] += i). `i` is the programmable
                    // load current (constant `value` by default; a stepped excursion when
                    // the dynamic params are set).
                    let i = self.i_source_current(e);
                    if let Some(r) = ia {
                        rhs[r] -= i;
                    }
                    if let Some(r) = ib {
                        rhs[r] += i;
                    }
                }
                ELEM_PULLUP => {
                    // Pull node a toward Vcc (value) through PULLUP_R: a constant
                    // Thevenin (g to ground + g·Vcc injection), the open-drain companion.
                    if let Some(r) = ia {
                        mat[r * n + r] += 1.0 / PULLUP_R;
                        rhs[r] += e.value / PULLUP_R;
                    }
                }
                _ => {}
            }
        }
        // Digital gates and flip-flops drive their nets through the resolved digital
        // domain (one stamp per net), not per element.
        self.stamp_digital(&mut mat, &mut rhs, n);
        // Weakly tie each floating subnet's common-mode to ground (no-op when grounded).
        self.stamp_floating_refs(&mut mat, n);
        // Debug-only: the pure-digital block must be diagonal (the sub-tick partition
        // invariant, ADR 0004 step 3a). Matrix is fully assembled here; nothing is moved.
        Self::debug_assert_digital_block_diagonal(&mat, n, &self.digital_rows);

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
                // Gated analog switch: same conductance·voltage current as the clock
                // switch, but the conductance comes from the control node (aswitch_closed).
                ELEM_ASWITCH => self.aswitch_conductance(e) * self.element_voltage(e),
                ELEM_VSOURCE | ELEM_ACSOURCE | ELEM_CAPACITOR => x[op_branch[i]],
                ELEM_INDUCTOR | ELEM_TRANSFORMER => self.reactive_state[i],
                ELEM_ISOURCE => self.i_source_current(e),
                // Logic-gate output drive current: GATE_GOUT*(Vtarget − V(out)), the
                // current the gate sources out of its output `a` (same output-current
                // convention as the op-amp). Vtarget was committed during assembly.
                ELEM_GATE | ELEM_LEVELSHIFT | ELEM_COMPARATOR | ELEM_BEHAVIORAL => {
                    self.gate_gout[i] * (self.gate_target[i] - self.node_v[e.a])
                }
                // Pull-up: the current it sources from Vcc (value) into its net.
                ELEM_PULLUP => (e.value - self.node_v[e.a]) / PULLUP_R,
                // The flip-flop's Q output drive current, from the committed bit.
                ELEM_DFF => {
                    // Q output drive current via the flip-flop's family (matches the
                    // stamp), so the displayed current is consistent with CMOS/TTL
                    // output levels and an X-driven Q — not a 2-state rail/0.
                    let (vq, g) = FAMILIES[gate_family_index(e.aux)]
                        .drive_level(self.ff_q[i], e.value)
                        .unwrap_or((self.node_v[e.a], 0.0));
                    g * (vq - self.node_v[e.a])
                }
                // The sampler's OUT drive current, from the committed comparison bit (the
                // rail is `aux`, defaulting when unset; same shape as the flip-flop's Q).
                ELEM_SAMPLER => {
                    let (vq, g) = FAMILIES[0]
                        .drive_level(self.samp_q[i], sampler_rail(e))
                        .unwrap_or((self.node_v[e.a], 0.0));
                    g * (vq - self.node_v[e.a])
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
        // Resolve the digital domain first (from the committed input levels) so the
        // boundary/digital drives are ready for whichever assembly path runs.
        self.eval_digital();
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
                ELEM_SWITCH | ELEM_ASWITCH => {
                    // Clock-driven switch (a time-varying conductance, a pure function of
                    // the current tick) or node-gated analog switch (its conductance from
                    // the control node's committed previous-tick voltage). Either way a
                    // symmetric conductance stamped exactly like a resistor — no branch
                    // unknown, no reactive state.
                    let g = if e.kind == ELEM_ASWITCH {
                        self.aswitch_conductance(e)
                    } else {
                        self.switch_conductance(e)
                    };
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
                ELEM_TRANSFORMER => {
                    // Ideal-T model: magnetising-inductor companion (Im) + a hard
                    // forced secondary differential (Is), n·Is reflected to the primary.
                    self.stamp_transformer(&mut mat, &mut rhs, n, e, i);
                }
                ELEM_ISOURCE => {
                    // Ideal current source injecting `i` a -> b: current leaves a
                    // (rhs[a] -= i) and enters b (rhs[b] += i). No branch unknown and no
                    // history term — a pure KCL stamp. `i` is the programmable load
                    // current (constant `value`, or a stepped excursion when dynamic).
                    let i = self.i_source_current(e);
                    if let Some(r) = ia {
                        rhs[r] -= i;
                    }
                    if let Some(r) = ib {
                        rhs[r] += i;
                    }
                }
                ELEM_PULLUP => {
                    // Pull node a toward Vcc (value) through PULLUP_R (constant Thevenin).
                    if let Some(r) = ia {
                        mat[r * n + r] += 1.0 / PULLUP_R;
                        rhs[r] += e.value / PULLUP_R;
                    }
                }
                _ => {}
            }
        }
        // Digital gates/flip-flops drive their nets through the resolved digital domain.
        self.stamp_digital(&mut mat, &mut rhs, n);
        // Weakly tie each floating subnet's common-mode to ground (no-op when grounded).
        self.stamp_floating_refs(&mut mat, n);
        // Debug-only: the pure-digital block must be diagonal (the sub-tick partition
        // invariant, ADR 0004 step 3a). Matrix is fully assembled here; nothing is moved.
        Self::debug_assert_digital_block_diagonal(&mat, n, &self.digital_rows);

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
                // Gated analog switch: same conductance·voltage current as the clock
                // switch, but the conductance comes from the control node (aswitch_closed).
                ELEM_ASWITCH => self.aswitch_conductance(e) * self.element_voltage(e),
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
                ELEM_ISOURCE => self.i_source_current(e),
                // Logic-gate output drive current: GATE_GOUT*(Vtarget − V(out)), the
                // current the gate sources out of its output `a` (same output-current
                // convention as the op-amp). Vtarget was committed during assembly.
                ELEM_GATE | ELEM_LEVELSHIFT | ELEM_COMPARATOR | ELEM_BEHAVIORAL => {
                    self.gate_gout[i] * (self.gate_target[i] - self.node_v[e.a])
                }
                // Pull-up: the current it sources from Vcc (value) into its net.
                ELEM_PULLUP => (e.value - self.node_v[e.a]) / PULLUP_R,
                // The flip-flop's Q output drive current, from the committed bit.
                ELEM_DFF => {
                    // Q output drive current via the flip-flop's family (matches the
                    // stamp), so the displayed current is consistent with CMOS/TTL
                    // output levels and an X-driven Q — not a 2-state rail/0.
                    let (vq, g) = FAMILIES[gate_family_index(e.aux)]
                        .drive_level(self.ff_q[i], e.value)
                        .unwrap_or((self.node_v[e.a], 0.0));
                    g * (vq - self.node_v[e.a])
                }
                // The sampler's OUT drive current, from the committed comparison bit (the
                // rail is `aux`, defaulting when unset; same shape as the flip-flop's Q).
                ELEM_SAMPLER => {
                    let (vq, g) = FAMILIES[0]
                        .drive_level(self.samp_q[i], sampler_rail(e))
                        .unwrap_or((self.node_v[e.a], 0.0));
                    g * (vq - self.node_v[e.a])
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
        // Reciprocal of the timestep for the diode reverse-recovery charge companion: `1/DT` in
        // a transient step, `0.0` at the operating point (so the DC solve has no charge term).
        inv_dt: f64,
        // GMIN-STEPPING homotopy shunt (S) added to EVERY node's diagonal this solve — `0.0` for the plain
        // solve (the default, byte-identical to before), a positive ramp during the convergence-fallback in
        // [`Sim::solve_nonlinear`]. A large extra shunt to ground well-conditions a stiff/feedback network
        // (e.g. cross-coupled inverters), giving a unique near-ground operating point the homotopy then
        // walks back to `gmin_extra = 0`. Linear, so the inner solve handles it exactly; it never changes
        // the converged answer at `gmin_extra = 0`.
        gmin_extra: f64,
    ) -> Vec<f64> {
        // Working unknown vector; node-voltage entries seed from the last solve
        // so a transient step starts near its answer (few iterations).
        let mut x = vec![0.0f64; n];
        x[..(self.node_count - 1)].copy_from_slice(&self.node_v[1..self.node_count]);

        let mut last = x.clone();
        for _iter in 0..NEWTON_MAX_ITERS {
            let mut mat = base_mat.to_vec();
            let mut rhs = base_rhs.to_vec();
            // GMIN-stepping shunt to ground on every node (no-op at 0 → the plain solve is unchanged).
            if gmin_extra > 0.0 {
                for r in 0..(self.node_count - 1) {
                    mat[r * n + r] += gmin_extra;
                }
            }

            // Stamp each diode's companion at its current junction voltage.
            // g = di/dv and Ieq = i(v*) - g*v* (plus GMIN for a finite slope).
            for &(ei, ia, ib) in diodes {
                let vd = self.diode_vd[ei];
                let el = self.elements[ei];
                let (id, gd) = diode_eval(vd, diode_model(&el));
                // Reverse-recovery charge companion: a forward diode stores `q = TT·id`, so its
                // terminal current carries an extra `dq/dt`. Backward-Euler turns that into a
                // scaled conductance and a history current (`q_prev` = the stored charge in
                // `reactive_state[ei]`). `inv_dt` is 0 at the operating point (DC solve
                // unchanged) and `1/DT` in the transient; `TT = 0` (Ideal / Schottky / default)
                // makes `kq = 0`, falling back to the exact memoryless stamp — golden-safe.
                let kq = el.params[DIODE_TT_SLOT] * inv_dt;
                let (g, ieq) = if kq > 0.0 {
                    let q_prev = self.reactive_state[ei];
                    let g = gd * (1.0 + kq) + GMIN;
                    (g, id * (1.0 + kq) - q_prev * inv_dt - g * vd)
                } else {
                    let g = gd + GMIN;
                    (g, id - g * vd)
                };
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
                let op = Self::mosfet_op(&el, vgs, vds);
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
                let op = Self::bjt_op(&el, vbe, vbc);
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

            // Debug-only: the pure-digital block must be diagonal (the sub-tick partition
            // invariant, ADR 0004 step 3a). The iterate matrix is fully assembled here — the
            // Newton companions (diode / MOSFET / BJT / varistor / op-amp) touch only analog
            // terminals, so they cannot couple a pure-digital row; nothing is moved.
            Self::debug_assert_digital_block_diagonal(&mat, n, &self.digital_rows);

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
                let m = diode_model(&el);
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
                let i_old = Self::mosfet_op(&el, vgs_old, vds_old).id;
                let i_new = Self::mosfet_op(&el, vgs_new, vds_new).id;
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
                let op_old = Self::bjt_op(&el, vbe_old, vbc_old);
                let op_new = Self::bjt_op(&el, vbe_new, vbc_new);
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
                // Diagnostic only (not hashed, not read by the solve).
                self.last_newton_iters = _iter + 1;
                self.last_newton_converged = true;
                self.node_v[0] = 0.0;
                self.node_v[1..self.node_count].copy_from_slice(&x[..self.node_count - 1]);
                return x;
            }
            last.copy_from_slice(&x);
        }

        // Iteration cap reached: settle deterministically to the last iterate.
        // Diagnostic only (not hashed, not read by the solve).
        self.last_newton_iters = NEWTON_MAX_ITERS;
        self.last_newton_converged = false;
        self.node_v[0] = 0.0;
        self.node_v[1..self.node_count].copy_from_slice(&x[..self.node_count - 1]);
        x
    }

    /// Solve the nonlinear network with a GMIN-stepping **convergence fallback** (#88). First runs the plain
    /// seeded Newton ([`Sim::newton_iterate`] with `gmin_extra = 0`) — for any circuit that converges (the
    /// golden, every existing test, every transient step that settles) this returns immediately and is
    /// **byte-identical** to before. Only when the plain solve hits the iteration cap does it fall back to
    /// **gmin stepping**: shunt every node to ground with a large conductance (a unique, well-conditioned
    /// near-ground operating point that bare Newton + `pnjlim` can't reach for a stiff/positive-feedback
    /// network like cross-coupled inverters), then ramp the shunt down by decades — re-seeding each solve
    /// from the last via `node_v` — until `gmin_extra = 0` recovers the true answer. Deterministic (a fixed
    /// schedule, integer-free control flow) and golden-safe by construction (the fallback is unreachable for
    /// a converging circuit). Both the operating-point and transient solves route through here.
    #[allow(clippy::too_many_arguments)]
    fn solve_nonlinear(
        &mut self,
        n: usize,
        base_mat: &[f64],
        base_rhs: &[f64],
        diodes: &[DiodeMap],
        mosfets: &[MosfetMap],
        bjts: &[BjtMap],
        varistors: &[VaristorMap],
        opamps: &[OpampMap],
        inv_dt: f64,
    ) -> Vec<f64> {
        let result = self.newton_iterate(
            n, base_mat, base_rhs, diodes, mosfets, bjts, varistors, opamps, inv_dt, 0.0,
        );
        if self.last_newton_converged {
            return result;
        }
        // Fallback: walk a large shunt-to-ground conductance down to zero, each step seeded from the last
        // (newton_iterate writes the iterate into node_v, which the next solve reads as its seed).
        const GMIN_STEPS: [f64; 12] = [
            1.0, 1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9, 1e-10, 0.0,
        ];
        let mut result = result;
        for &g in &GMIN_STEPS {
            result = self.newton_iterate(
                n, base_mat, base_rhs, diodes, mosfets, bjts, varistors, opamps, inv_dt, g,
            );
        }
        result
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
                ELEM_ISOURCE => {
                    let i = self.i_source_current(e);
                    if let Some(r) = ia {
                        base_rhs[r] -= i;
                    }
                    if let Some(r) = ib {
                        base_rhs[r] += i;
                    }
                }
                ELEM_PULLUP => {
                    // Pull node a toward Vcc (value) through PULLUP_R (constant Thevenin,
                    // part of the fixed Newton base).
                    if let Some(r) = ia {
                        base_mat[r * n + r] += 1.0 / PULLUP_R;
                        base_rhs[r] += e.value / PULLUP_R;
                    }
                }
                ELEM_SWITCH | ELEM_ASWITCH => {
                    // Clock-driven switch (a tick-determined conductance) or node-gated
                    // analog switch (its conductance from the control node's committed
                    // voltage) stamped into the fixed linear base — exactly like a
                    // resistor. Carries no branch unknown, so the Newton loop sees it as
                    // part of the constant base (it works in circuits that also contain
                    // nonlinear devices).
                    let g = if e.kind == ELEM_ASWITCH {
                        self.aswitch_conductance(e)
                    } else {
                        self.switch_conductance(e)
                    };
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
                ELEM_VARISTOR => varistors.push((i, ia, ib)),
                ELEM_OPAMP => opamps.push((i, ia, ib, Self::node_idx(e.c))),
                _ => {}
            }
        }
        // Digital gates/flip-flops drive their nets through the resolved digital domain.
        self.stamp_digital(&mut base_mat, &mut base_rhs, n);
        // Weakly tie each floating subnet's common-mode to ground in the fixed Newton
        // base (copied into every iteration's matrix); a no-op when fully grounded.
        self.stamp_floating_refs(&mut base_mat, n);

        // Operating point is a DC steady state: pass inv_dt = 0 so the diode reverse-recovery
        // charge companion contributes nothing (dq/dt = 0), leaving the DC solve unchanged.
        // solve_nonlinear is the plain seeded Newton unless it stalls, then a gmin-stepping fallback.
        let x = self.solve_nonlinear(
            n, &base_mat, &base_rhs, &diodes, &mosfets, &bjts, &varistors, &opamps, 0.0,
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
                // Gated analog switch: same conductance·voltage current as the clock
                // switch, but the conductance comes from the control node (aswitch_closed).
                ELEM_ASWITCH => self.aswitch_conductance(e) * self.element_voltage(e),
                ELEM_VSOURCE | ELEM_ACSOURCE | ELEM_CAPACITOR => x[op_branch[i]],
                ELEM_INDUCTOR | ELEM_TRANSFORMER => self.reactive_state[i],
                ELEM_ISOURCE => self.i_source_current(e),
                ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER => {
                    diode_eval(self.diode_vd[i], diode_model(e)).0
                }
                ELEM_NMOS | ELEM_PMOS => {
                    Self::mosfet_op(e, self.mosfet_vgs[i], self.mosfet_vds[i]).id
                }
                // The BJT main current is the collector current Ic, oriented a -> b
                // (collector -> emitter), consistent with the MOSFET's drain current.
                ELEM_NPN | ELEM_PNP => Self::bjt_op(e, self.bjt_vbe[i], self.bjt_vbc[i]).ic,
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
                ELEM_GATE | ELEM_LEVELSHIFT | ELEM_COMPARATOR | ELEM_BEHAVIORAL => {
                    self.gate_gout[i] * (self.gate_target[i] - self.node_v[e.a])
                }
                // Pull-up: the current it sources from Vcc (value) into its net.
                ELEM_PULLUP => (e.value - self.node_v[e.a]) / PULLUP_R,
                // The flip-flop's Q output drive current, from the committed bit.
                ELEM_DFF => {
                    // Q output drive current via the flip-flop's family (matches the
                    // stamp), so the displayed current is consistent with CMOS/TTL
                    // output levels and an X-driven Q — not a 2-state rail/0.
                    let (vq, g) = FAMILIES[gate_family_index(e.aux)]
                        .drive_level(self.ff_q[i], e.value)
                        .unwrap_or((self.node_v[e.a], 0.0));
                    g * (vq - self.node_v[e.a])
                }
                // The sampler's OUT drive current, from the committed comparison bit (the
                // rail is `aux`, defaulting when unset; same shape as the flip-flop's Q).
                ELEM_SAMPLER => {
                    let (vq, g) = FAMILIES[0]
                        .drive_level(self.samp_q[i], sampler_rail(e))
                        .unwrap_or((self.node_v[e.a], 0.0));
                    g * (vq - self.node_v[e.a])
                }
                _ => 0.0,
            };
        }
        // Seed each reverse-recovery diode's stored charge q = TT·I at the operating point, so
        // the first transient step starts from the steady-state charge (no spurious t = 0 spike).
        // TT = 0 (default / Ideal / Schottky) leaves it at 0, so the golden is untouched.
        for (i, e) in self.elements.iter().enumerate() {
            if matches!(e.kind, ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER) {
                let tt = e.params[DIODE_TT_SLOT];
                if tt > 0.0 {
                    let id = diode_eval(self.diode_vd[i], diode_model(e)).0;
                    self.reactive_state[i] = tt * id;
                }
            }
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
                ELEM_ISOURCE => {
                    let i = self.i_source_current(e);
                    if let Some(r) = ia {
                        base_rhs[r] -= i;
                    }
                    if let Some(r) = ib {
                        base_rhs[r] += i;
                    }
                }
                ELEM_PULLUP => {
                    // Pull node a toward Vcc (value) through PULLUP_R (constant Thevenin,
                    // part of the fixed Newton base).
                    if let Some(r) = ia {
                        base_mat[r * n + r] += 1.0 / PULLUP_R;
                        base_rhs[r] += e.value / PULLUP_R;
                    }
                }
                ELEM_SWITCH | ELEM_ASWITCH => {
                    // Clock-driven switch (a tick-determined conductance) or node-gated
                    // analog switch (its conductance from the control node's committed
                    // previous-tick voltage) stamped into the fixed linear base, computed
                    // once per step before any Newton iterating — exactly like a resistor.
                    // No branch unknown and no reactive state, so the Newton loop treats it
                    // as part of the constant base (it works alongside nonlinear devices).
                    let g = if e.kind == ELEM_ASWITCH {
                        self.aswitch_conductance(e)
                    } else {
                        self.switch_conductance(e)
                    };
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
                ELEM_VARISTOR => varistors.push((i, ia, ib)),
                ELEM_OPAMP => opamps.push((i, ia, ib, Self::node_idx(e.c))),
                _ => {}
            }
        }
        // Digital gates/flip-flops drive their nets through the resolved digital domain.
        self.stamp_digital(&mut base_mat, &mut base_rhs, n);
        // Weakly tie each floating subnet's common-mode to ground in the fixed Newton
        // base (copied into every iteration's matrix); a no-op when fully grounded.
        self.stamp_floating_refs(&mut base_mat, n);

        // Transient step: inv_dt = 1/DT engages the diode reverse-recovery charge companion.
        // solve_nonlinear is the plain seeded Newton unless it stalls, then a gmin-stepping fallback.
        let x = self.solve_nonlinear(
            n,
            &base_mat,
            &base_rhs,
            &diodes,
            &mosfets,
            &bjts,
            &varistors,
            &opamps,
            1.0 / DT,
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
                // Gated analog switch: same conductance·voltage current as the clock
                // switch, but the conductance comes from the control node (aswitch_closed).
                ELEM_ASWITCH => self.aswitch_conductance(e) * self.element_voltage(e),
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
                ELEM_ISOURCE => self.i_source_current(e),
                ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER => {
                    let id = diode_eval(self.diode_vd[i], diode_model(e)).0;
                    // Add the reverse-recovery charge current dq/dt (like the capacitor above)
                    // so the *terminal* current shows the recovery spike. TT = 0 → kq = 0 →
                    // plain id, unchanged. `reactive_state[i]` still holds q from the last step.
                    let kq = e.params[DIODE_TT_SLOT] / DT;
                    if kq > 0.0 {
                        id * (1.0 + kq) - self.reactive_state[i] / DT
                    } else {
                        id
                    }
                }
                ELEM_NMOS | ELEM_PMOS => {
                    Self::mosfet_op(e, self.mosfet_vgs[i], self.mosfet_vds[i]).id
                }
                // The BJT main current is the collector current Ic, oriented a -> b
                // (collector -> emitter), consistent with the MOSFET's drain current.
                ELEM_NPN | ELEM_PNP => Self::bjt_op(e, self.bjt_vbe[i], self.bjt_vbc[i]).ic,
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
                ELEM_GATE | ELEM_LEVELSHIFT | ELEM_COMPARATOR | ELEM_BEHAVIORAL => {
                    self.gate_gout[i] * (self.gate_target[i] - self.node_v[e.a])
                }
                // Pull-up: the current it sources from Vcc (value) into its net.
                ELEM_PULLUP => (e.value - self.node_v[e.a]) / PULLUP_R,
                // The flip-flop's Q output drive current, from the committed bit.
                ELEM_DFF => {
                    // Q output drive current via the flip-flop's family (matches the
                    // stamp), so the displayed current is consistent with CMOS/TTL
                    // output levels and an X-driven Q — not a 2-state rail/0.
                    let (vq, g) = FAMILIES[gate_family_index(e.aux)]
                        .drive_level(self.ff_q[i], e.value)
                        .unwrap_or((self.node_v[e.a], 0.0));
                    g * (vq - self.node_v[e.a])
                }
                // The sampler's OUT drive current, from the committed comparison bit (the
                // rail is `aux`, defaulting when unset; same shape as the flip-flop's Q).
                ELEM_SAMPLER => {
                    let (vq, g) = FAMILIES[0]
                        .drive_level(self.samp_q[i], sampler_rail(e))
                        .unwrap_or((self.node_v[e.a], 0.0));
                    g * (vq - self.node_v[e.a])
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
        let g_leak = TRANSFORMER_LLEAK / DT; // backward-Euler companion of the secondary leakage
        let rp = TRANSFORMER_RWIND;
        let im_prev = self.reactive_state[i];
        let is_prev = self.secondary_state[i];
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
        // Secondary leakage-inductance companion, in series in the secondary branch
        // exactly as `rp` sits in series in the magnetiser branch — same sign
        // convention (a series element subtracts on the branch diagonal):
        //   V(c)-V(d) = n·V_Lm + L_leak·dIs/dt,  L_leak·dIs/dt = g_leak·(Is - Is_prev).
        // The diagonal `-g_leak` both conditions the secondary row (which was a bare
        // hard constraint with no diagonal) and limits the secondary current's di/dt,
        // taming the bridge inrush into an empty reservoir cap (a zero-impedance hard
        // source drives that as a near-impulse — bounded on one platform, divergent on
        // another). At DC/steady state dIs/dt → 0, so it has ZERO drop: the hard
        // turns-ratio differential, and full-wave rectification, are untouched.
        mat[bi_s * dim + bi_s] -= g_leak;
        rhs[bi_s] -= n * g_mag * im_prev + g_leak * is_prev;
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

    /// Evaluate the digital domain for this tick — the unit-delay event engine
    /// (`docs/ui/logic-analog-digital-nets.md` §7.4). From the **committed** input
    /// levels (`net_level`, one tick of delay) compute each gate's and flip-flop's
    /// output [`Level`] and resolve every net's driven level into `digital_drive` by
    /// folding its drivers via [`combine`] in element-index order (so the result is
    /// order-independent and deterministic). Pure enum logic; runs once per solve,
    /// before MNA assembly. Also records each gate's own driven voltage in `gate_target`
    /// for the current readout, and the driver rail in `digital_vhigh`.
    fn eval_digital(&mut self) {
        for d in self.digital_drive.iter_mut() {
            *d = Level::Z;
        }
        for i in 0..self.elements.len() {
            let e = self.elements[i];
            match e.kind {
                ELEM_GATE => {
                    // This gate's selected logic family (packed in aux's upper bits).
                    let fi = gate_family_index(e.aux);
                    let fam = &FAMILIES[fi];
                    // Supply rails: a powered IC reads GND (e) and VCC (d) and works in
                    // that window; a legacy gate (no power pins) uses the `value` rail
                    // referenced to ground. `rail` is the span, `vlow` the GND offset.
                    let (vlow, vhigh) = gate_rails(&e, &self.node_v);
                    let rail = (vhigh - vlow).max(0.0);
                    // Receiver: quantise each input's committed (last-tick) voltage
                    // RELATIVE to this gate's GND, over its rail (per-reader threshold,
                    // one tick of delay).
                    let in1 = fam.quantize(self.node_v[e.b] - vlow, rail);
                    let in2 = fam.quantize(self.node_v[e.c] - vlow, rail);
                    let out = gate_logic_level(gate_func_code(e.aux), in1, in2);
                    // The output releases (high-impedance Z) in two cases: an UNPOWERED
                    // chip (rail below the operating minimum, e.g. its VCC pin unwired)
                    // sits dead; and an open-drain output pulls low but RELEASES the high
                    // side (the high comes from an external pull-up — open-drain outputs on
                    // one net form a wired-AND bus: any low wins, all release -> pull-up
                    // high). Otherwise it drives the computed level.
                    let driven =
                        if rail < GATE_MIN_RAIL || (gate_open_drain(e.aux) && out == Level::High) {
                            Level::Z
                        } else {
                            out
                        };
                    // The family's Thévenin target is a rail fraction; offset it by the
                    // gate's GND so the output swings `vlow .. vlow+rail`.
                    let (tvf, g) = fam.drive_level(driven, rail).unwrap_or((0.0, 0.0));
                    self.gate_target[i] = vlow + tvf;
                    self.gate_gout[i] = g;
                    self.digital_drive[e.a] = combine(self.digital_drive[e.a], driven);
                    self.digital_vhigh[e.a] = rail;
                    self.digital_vlow[e.a] = vlow;
                    self.digital_family[e.a] = fi as u8;
                }
                ELEM_MEMORY => {
                    // READ: drive the data-out bus with the addressed word's bits. Powered like a gate —
                    // VCC (d) / GND (e) set the rail; the address is quantised from the committed
                    // (last-tick) voltages relative to GND and masked to the store's depth. The word is
                    // stable within the solve (writes commit in `commit_sequential_digital_state`), so this
                    // is a CONSTANT drive — no Newton.
                    let (vlow, vhigh) = gate_rails(&e, &self.node_v);
                    let rail = (vhigh - vlow).max(0.0);
                    let depth = self.mem_data[i].len();
                    if rail >= GATE_MIN_RAIL && depth > 0 {
                        let fam = &FAMILIES[0];
                        if !self.mem_dout_nodes[i].is_empty() {
                            // WIDE READ (P3, option A): the explicit address bus selects the word; each
                            // data-out bit node is driven with the corresponding bit (LSB = bit 0). The 8
                            // fixed terminals carry only the supply rail; the buses live in the side lists.
                            let addr = self.mem_wide_addr(i, fam, vlow, rail, depth);
                            let word = self.mem_data[i][addr];
                            for b in 0..self.mem_dout_nodes[i].len() {
                                let node = self.mem_dout_nodes[i][b];
                                let dout = if (word >> b) & 1 != 0 {
                                    Level::High
                                } else {
                                    Level::Low
                                };
                                self.digital_drive[node] = combine(self.digital_drive[node], dout);
                                self.digital_vhigh[node] = rail;
                                self.digital_vlow[node] = vlow;
                                self.digital_family[node] = 0;
                            }
                        } else {
                            // CELL-LEVEL READ (P1): address A0..A2 = f, g, h; D_out = a (one bit).
                            let a0 = (fam.quantize(self.node_v[e.f] - vlow, rail) == Level::High)
                                as usize;
                            let a1 = (fam.quantize(self.node_v[e.g] - vlow, rail) == Level::High)
                                as usize;
                            let a2 = (fam.quantize(self.node_v[e.h] - vlow, rail) == Level::High)
                                as usize;
                            let addr = (a0 | (a1 << 1) | (a2 << 2)) & (depth - 1);
                            let dout = if self.mem_data[i][addr] & 1 != 0 {
                                Level::High
                            } else {
                                Level::Low
                            };
                            self.digital_drive[e.a] = combine(self.digital_drive[e.a], dout);
                            self.digital_vhigh[e.a] = rail;
                            self.digital_vlow[e.a] = vlow;
                            self.digital_family[e.a] = 0;
                        }
                    }
                    // unpowered → outputs released (Z, the default), like a dead gate.
                }
                ELEM_DFF => {
                    // Q (a) drives the stored bit; Q̄ (d) its inverse. The bit is latched
                    // in the commit phase, so the output is constant within the solve.
                    let fi = gate_family_index(e.aux);
                    let q = self.ff_q[i];
                    self.digital_drive[e.a] = combine(self.digital_drive[e.a], q);
                    self.digital_vhigh[e.a] = e.value;
                    self.digital_vlow[e.a] = 0.0;
                    self.digital_family[e.a] = fi as u8;
                    self.digital_drive[e.d] = combine(self.digital_drive[e.d], q.invert());
                    self.digital_vhigh[e.d] = e.value;
                    self.digital_vlow[e.d] = 0.0;
                    self.digital_family[e.d] = fi as u8;
                }
                ELEM_SAMPLER => {
                    // OUT (a) drives the stored comparison bit at the output rail (`aux`,
                    // defaulted). The bit is latched in the commit phase, so the output is
                    // constant within the solve (one tick of clock-to-output delay). IN (b)
                    // is a high-Z analog sense pin — read, not driven. Ideal driver family.
                    let rail = sampler_rail(&e);
                    self.digital_drive[e.a] = combine(self.digital_drive[e.a], self.samp_q[i]);
                    self.digital_vhigh[e.a] = rail;
                    self.digital_vlow[e.a] = 0.0;
                    self.digital_family[e.a] = 0;
                }
                ELEM_COMPARATOR => {
                    // POWERED output stage, identical machinery to a powered gate: OUT (a)
                    // swings between the GND pin (e, vlow) and the VCC pin (d, vhigh) and
                    // releases (Z) when the rail collapses below the operating minimum (an
                    // unpowered chip sits dead). The held comparison bit (`cmp_q`, latched in
                    // the commit phase) is constant within the solve, so this is a constant
                    // Thévenin stamp — no Newton. IN+ (b)/IN- (c) are analog sense pins (read
                    // in the commit phase, not driven here); LE (f) is read there too. Ideal
                    // driver family (a clean rail-to-rail output), GND-offset by `vlow`.
                    let fam = &FAMILIES[0];
                    let (vlow, vhigh) = gate_rails(&e, &self.node_v);
                    let rail = (vhigh - vlow).max(0.0);
                    let driven = if rail < GATE_MIN_RAIL {
                        Level::Z
                    } else {
                        self.cmp_q[i]
                    };
                    let (tvf, g) = fam.drive_level(driven, rail).unwrap_or((0.0, 0.0));
                    self.gate_target[i] = vlow + tvf;
                    self.gate_gout[i] = g;
                    self.digital_drive[e.a] = combine(self.digital_drive[e.a], driven);
                    self.digital_vhigh[e.a] = rail;
                    self.digital_vlow[e.a] = vlow;
                    self.digital_family[e.a] = 0;
                }
                ELEM_LEVELSHIFT => {
                    // Read the input (b) at the INPUT rail A (value), re-drive the output
                    // (a) at the OUTPUT rail B (aux) — the part that translates levels
                    // across rails. Ideal receiver/driver (a translator, not a family).
                    let fam = &FAMILIES[0];
                    let lvl = fam.quantize(self.node_v[e.b], e.value);
                    let (tv, g) = fam.drive_level(lvl, e.aux).unwrap_or((0.0, 0.0));
                    self.gate_target[i] = tv;
                    self.gate_gout[i] = g;
                    self.digital_drive[e.a] = combine(self.digital_drive[e.a], lvl);
                    self.digital_vhigh[e.a] = e.aux; // output net carries rail B
                    self.digital_vlow[e.a] = 0.0;
                    self.digital_family[e.a] = 0;
                }
                ELEM_BEHAVIORAL => {
                    // Behavioral block: up to three POWERED digital outputs on a/b/c, driven from
                    // the COMMITTED integer state through the SAME powered-gate output path the
                    // gate/comparator use. They swing between the GND pin (e, vlow) and the VCC pin
                    // (d, vhigh) and release (Z) when the rail collapses below the operating minimum
                    // (an unpowered chip sits dead). The state is advanced in the commit phase, so
                    // the levels are constant within the solve — a constant Thévenin stamp, no
                    // Newton, one tick of state-to-output delay. The input pins f/g/h are read in
                    // the commit phase (not driven here). Ideal driver family (a clean rail-to-rail
                    // output), GND-offset by `vlow`. The per-program output map (which pin carries
                    // what, and whether c is used) is the only thing that differs between programs:
                    //   prog 1 SPI master: a=SCLK, b=MOSI, c=CS
                    //   prog 2 SPI slave:  a=MISO, b=RXVALID, c unused (Z)
                    //   prog 3 UART:       a=TX,   b=RXVALID, c unused (Z)
                    let prog = if e.value >= 1.0 { e.value as u32 } else { 0 };
                    let fam = &FAMILIES[0];
                    // The behavioral block is ALWAYS powered through its VCC (d) / GND (e) pins —
                    // `value` is the program id, NOT a logic rail, so it has no legacy `value`-rail
                    // fallback (that would misread the program id as a 1 V rail). An unwired VCC
                    // floats to ~0 V → rail below the minimum → the chip reads dead/released.
                    let vlow = self.node_v[e.e];
                    let rail = (self.node_v[e.d] - vlow).max(0.0);
                    let bit = |hi: bool| if hi { Level::High } else { Level::Low };
                    // Program 4 (the FPGA logic element) drives a SINGLE powered output on `a` and
                    // reads its inputs on b/c/f/g/h — so it must NOT touch b/c (the generic a/b/c
                    // drive loop below unconditionally overwrites each pin's quantisation rail, which
                    // would clobber an input net driven by an external clock/gate). Handle it here
                    // and skip the generic output path. Combinational mode looks the truth table up
                    // from the LIVE inputs (gate-like, settling within the digital sub-solve, no
                    // clock-to-output delay); registered mode drives the committed `Q` (a LUT+FF,
                    // one tick of clock-to-output delay like the DFF). Unpowered ⇒ released (Z).
                    if prog == BEH_PROG_LUT {
                        let la = if rail < GATE_MIN_RAIL {
                            Level::Z
                        } else if beh_lut_registered(&e) {
                            bit(self.beh_state[i][BEH_LUT_Q] != 0)
                        } else {
                            let idx = beh_lut_live_index(&self.node_v, &e, vlow, rail);
                            bit(beh_lut_bit(e.aux as u32, idx))
                        };
                        let (tvf, g) = fam.drive_level(la, rail).unwrap_or((0.0, 0.0));
                        self.gate_target[i] = vlow + tvf;
                        self.gate_gout[i] = g;
                        self.digital_drive[e.a] = combine(self.digital_drive[e.a], la);
                        self.digital_vhigh[e.a] = rail;
                        self.digital_vlow[e.a] = vlow;
                        self.digital_family[e.a] = 0;
                        continue;
                    }
                    // Program 6 (the 3-bit SAR ADC) drives FOUR powered outputs from committed state
                    // — D0/D1/D2 (a/b/c) = the successive-approximation result register, DONE (g) =
                    // high once a full conversion has completed — and reads VIN (f) / CLK (h) in the
                    // commit phase. The fourth output (g) is why it can't use the generic a/b/c loop
                    // below; handle it here and skip (like the LUT). Reference is the VCC rail
                    // (single supply). Unpowered ⇒ everything released (Z). One tick of
                    // state-to-output delay, like the other clocked programs.
                    if prog == BEH_PROG_SAR_ADC {
                        let powered = rail >= GATE_MIN_RAIL;
                        let code = self.beh_state[i][BEH_SAR_CODE];
                        let done_hi = self.beh_state[i][BEH_SAR_DONE] != 0;
                        // (output node, high?) for D0, D1, D2, DONE.
                        let outs = [
                            (e.a, code & 1 != 0),
                            (e.b, code & 2 != 0),
                            (e.c, code & 4 != 0),
                            (e.g, done_hi),
                        ];
                        for (k, &(node, hi)) in outs.iter().enumerate() {
                            let lvl = if powered { bit(hi) } else { Level::Z };
                            let (tvf, g) = fam.drive_level(lvl, rail).unwrap_or((0.0, 0.0));
                            if k == 0 {
                                // OUT (a = D0): record the element-indexed Thévenin so the OUT current
                                // readout (oriented out of `a`) matches the stamp, like the gate.
                                self.gate_target[i] = vlow + tvf;
                                self.gate_gout[i] = g;
                            }
                            self.digital_drive[node] = combine(self.digital_drive[node], lvl);
                            self.digital_vhigh[node] = rail;
                            self.digital_vlow[node] = vlow;
                            self.digital_family[node] = 0;
                        }
                        continue;
                    }
                    // Program 8 (the sigma-delta ADC) also drives FOUR outputs from committed state —
                    // D0/D1/D2 (a/b/c) = the decimated code, and BS (g) = the live 1-bit modulator
                    // stream (so its density ∝ VIN is visible). Same shape as the SAR; handle it here
                    // and skip the generic a/b/c path.
                    if prog == BEH_PROG_SIGMA_DELTA {
                        let powered = rail >= GATE_MIN_RAIL;
                        let code = self.beh_state[i][SD_CODE];
                        let bs_hi = self.beh_state[i][SD_BIT] != 0;
                        // (output node, high?) for D0, D1, D2, BS (the bit stream).
                        let outs = [
                            (e.a, code & 1 != 0),
                            (e.b, code & 2 != 0),
                            (e.c, code & 4 != 0),
                            (e.g, bs_hi),
                        ];
                        for (k, &(node, hi)) in outs.iter().enumerate() {
                            let lvl = if powered { bit(hi) } else { Level::Z };
                            let (tvf, g) = fam.drive_level(lvl, rail).unwrap_or((0.0, 0.0));
                            if k == 0 {
                                self.gate_target[i] = vlow + tvf;
                                self.gate_gout[i] = g;
                            }
                            self.digital_drive[node] = combine(self.digital_drive[node], lvl);
                            self.digital_vhigh[node] = rail;
                            self.digital_vlow[node] = vlow;
                            self.digital_family[node] = 0;
                        }
                        continue;
                    }
                    // (a, b, c) output levels for this program (Z = released). Unpowered or an
                    // inert/unknown program releases everything.
                    let (la, lb, lc) = if rail < GATE_MIN_RAIL {
                        (Level::Z, Level::Z, Level::Z)
                    } else {
                        let st = &self.beh_state[i];
                        match prog {
                            BEH_PROG_SPI_MASTER => {
                                let (nbits, _half) = beh_spi_config(&e);
                                let sclk = bit(st[BEH_SPI_SCLK_LEVEL] != 0);
                                let mosi = bit(beh_spi_mosi_bit(st, nbits));
                                // CS is active-low: the stored cs_level (1 = deasserted/high) IS the
                                // output level, so it idles High and asserts Low during a
                                // transaction. Guard the all-zero RESET state (cs_level = 0 before
                                // the first commit runs the idle branch that raises it): CS is
                                // asserted Low ONLY while a transaction is active (fsm = 1), else
                                // deasserted High — so a freshly installed/idle master reads CS High
                                // from the very first tick (spec: "Idle (fsm = 0): CS = 1").
                                let cs = if st[BEH_SPI_FSM] == 1 && st[BEH_SPI_CS_LEVEL] == 0 {
                                    Level::Low
                                } else {
                                    Level::High
                                };
                                (sclk, mosi, cs)
                            }
                            BEH_PROG_SPI_SLAVE => {
                                // MISO (a): the reply word `aux` MSB-first while CS is asserted,
                                // else idle low. RXVALID (b): high while a received word is latched
                                // (until CS deasserts). c unused.
                                let nbits = beh_spi_slave_nbits(&e);
                                let miso = bit(beh_spi_slave_miso_bit(st, e.aux as u64, nbits));
                                let rxvalid = bit(st[BEH_SLV_RXVALID] != 0);
                                (miso, rxvalid, Level::Z)
                            }
                            BEH_PROG_UART => {
                                // TX (a): the framed line (idle/mark high). RXVALID (b): the one-tick
                                // received-byte pulse. c unused.
                                let (_baud, nbits) = beh_uart_config(&e);
                                let tx = bit(beh_uart_tx_high(st, nbits));
                                let rxvalid = bit(st[BEH_UART_RXVALID] != 0);
                                (tx, rxvalid, Level::Z)
                            }
                            BEH_PROG_FLASH_ADC => {
                                // 3-bit flash ADC: quantize the live analog input (f) against the
                                // reference span to a code 0..7, driving D0/D1/D2 on a/b/c. Purely
                                // combinational (reads node_v, carries no state -> no commit arm).
                                let code = beh_flash_adc_code(&self.node_v, &e, vlow, rail);
                                (bit(code & 1 != 0), bit(code & 2 != 0), bit(code & 4 != 0))
                            }
                            BEH_PROG_COUNTER => {
                                // 3-bit binary counter: drive Q0/Q1/Q2 (a/b/c) from the committed
                                // count (advanced on each rising CLK in the commit phase).
                                let n = st[BEH_CNT_COUNT];
                                (bit(n & 1 != 0), bit(n & 2 != 0), bit(n & 4 != 0))
                            }
                            // Inert / unknown program: release all outputs.
                            _ => (Level::Z, Level::Z, Level::Z),
                        }
                    };
                    // OUT pin a: also record the element-indexed Thévenin so the OUT current readout
                    // (oriented out of `a`) matches the stamp, exactly like the gate.
                    let (tvf, g) = fam.drive_level(la, rail).unwrap_or((0.0, 0.0));
                    self.gate_target[i] = vlow + tvf;
                    self.gate_gout[i] = g;
                    // Drive all three output pins a/b/c uniformly (an unused pin carries Z, which
                    // combine() yields on, so it neither pulls its net nor is double-counted).
                    for (node, lvl) in [(e.a, la), (e.b, lb), (e.c, lc)] {
                        self.digital_drive[node] = combine(self.digital_drive[node], lvl);
                        self.digital_vhigh[node] = rail;
                        self.digital_vlow[node] = vlow;
                        self.digital_family[node] = 0;
                    }
                }
                _ => {}
            }
        }
    }

    /// Commit each `Digital`/`Boundary` net's canonical [`Level`] — the receiver
    /// quantising the net's just-solved voltage at its driver rail (`digital_vhigh`).
    /// Run after every solve. Pure-digital nets fold this level (a `u8`) into the
    /// snapshot hash instead of their `f64` voltage, which is cleaner and stays stable
    /// when those nets later leave the MNA matrix. Undriven nets quantise at rail `0`,
    /// so a floored (≈0 V) net reads `Low` — preserving floating-input-reads-low.
    fn commit_net_levels(&mut self) {
        for node in 0..self.node_count {
            if matches!(
                self.net_classes[node],
                NetClass::Digital | NetClass::Boundary
            ) {
                let fam = &FAMILIES[self.digital_family[node] as usize];
                self.net_level[node] = fam.quantize(
                    self.node_v[node] - self.digital_vlow[node],
                    self.digital_vhigh[node],
                );
            }
        }
    }

    /// **Debug-only structural invariant** (ADR 0004 phase-3, step 3a): assert that the
    /// pure-digital block of a fully assembled MNA matrix is strictly **diagonal** — for every
    /// row `r` in `digital_rows`, every off-diagonal entry in that row *and* that column is
    /// exactly `0.0` (`mat[r*dim + c] == 0.0` and `mat[c*dim + r] == 0.0` for all `c != r`).
    ///
    /// This is the assumption step 3b's frozen-boundary sub-solve relies on: a pure-`Digital`
    /// net is touched ONLY by digital pins, so it carries no cross-net conductance and is
    /// stamped ONLY by [`Sim::stamp_digital`] (a lone `GMIN` + one combined Thévenin drive on
    /// its own diagonal). No analog stamp — resistor, source, reactive companion, floating-ref
    /// tie, or nonlinear Newton companion (diode / MOSFET / BJT / varistor / op-amp) — can reach
    /// it, because those touch only analog terminals. So the block must be diagonal; if this
    /// ever fires, some pure-digital net has unexpected coupling and the sub-tick partition is
    /// invalid — we want it to fire loudly in tests (it is critical design feedback, not a bug
    /// to paper over).
    ///
    /// Compiled only in debug/test builds (it is a `debug_assert!`-style check with the loop body
    /// gated on `debug_assertions`), so release and the analog hot path are untouched. Cost is
    /// `O(digital_rows · dim)`. Called right after each assembly path finishes stamping and BEFORE
    /// `solve_dense`, so it sees the exact matrix that is about to be factored — nothing is moved.
    #[inline]
    fn debug_assert_digital_block_diagonal(mat: &[f64], dim: usize, digital_rows: &[usize]) {
        #[cfg(debug_assertions)]
        for &r in digital_rows {
            debug_assert!(r < dim, "digital row {r} out of range for dim {dim}");
            for c in 0..dim {
                if c == r {
                    continue;
                }
                debug_assert_eq!(
                    mat[r * dim + c],
                    0.0,
                    "pure-digital row {r} has off-diagonal coupling at column {c} \
                     (ADR 0004 sub-tick partition assumption broken)"
                );
                debug_assert_eq!(
                    mat[c * dim + r],
                    0.0,
                    "pure-digital row {r} has off-diagonal coupling at row {c} \
                     (ADR 0004 sub-tick partition assumption broken)"
                );
            }
        }
        // Silence unused-parameter warnings in release builds, where the loop is compiled out.
        #[cfg(not(debug_assertions))]
        {
            let _ = (mat, dim, digital_rows);
        }
    }

    /// Stamp the resolved digital drives ([`Sim::eval_digital`]) into an MNA system
    /// (`mat`/`rhs`, dimension `dim`): for every `Digital`/`Boundary` net a `GMIN`
    /// anti-singularity floor, plus — unless the net is released (`Z`) — the driver's
    /// Thévenin (a conductance to ground and a current injection) for its resolved
    /// [`Level`]. **One stamp per net**: the multi-driver resolution already happened in
    /// `eval_digital`, so two outputs on a net resolve (wired-AND/conflict→X) instead of
    /// fighting in the matrix. The stamp is constant within the solve, so a gate/FF-only
    /// circuit stays on the linear fast path — no Newton, no branch unknown.
    fn stamp_digital(&self, mat: &mut [f64], rhs: &mut [f64], dim: usize) {
        for node in 1..self.node_count {
            if !matches!(
                self.net_classes[node],
                NetClass::Digital | NetClass::Boundary
            ) {
                continue;
            }
            let r = node - 1; // node n -> MNA row n-1 (ground excluded)
            mat[r * dim + r] += GMIN;
            if let Some((vt, g)) = self.digital_net_thevenin(node) {
                // `vt` is the absolute Thévenin target (the family rail fraction already offset
                // by the driver's GND — see `digital_net_thevenin`); `g` its conductance.
                mat[r * dim + r] += g;
                rhs[r] += g * vt;
            }
        }
    }

    /// The resolved digital driver's **absolute Thévenin** `(target_voltage, conductance)` for a
    /// `Digital`/`Boundary` net, or `None` when the net is released (`Z`). This is the single source
    /// of truth for how a resolved [`Level`] becomes an analog stamp: the family target is a rail
    /// fraction, offset here by the driver's GND (`digital_vlow`) so a powered gate yields an
    /// absolute `vlow + frac·rail` (legacy `vlow = 0`). Used by [`Sim::stamp_digital`] (which adds
    /// `g` to the diagonal and `g·vt` to the RHS) **and** by [`Sim::digital_net_solved_voltage`]
    /// (the closed-form diagonal sub-solve), so the two can never drift apart.
    #[inline]
    fn digital_net_thevenin(&self, node: usize) -> Option<(f64, f64)> {
        let fam = &FAMILIES[self.digital_family[node] as usize];
        fam.drive_level(self.digital_drive[node], self.digital_vhigh[node])
            .map(|(tvf, g)| (self.digital_vlow[node] + tvf, g))
    }

    /// The solved node voltage of a **pure-digital** net's diagonal MNA row, computed in closed form
    /// instead of via a matrix factorisation — the value [`Sim::stamp_digital`] + [`solve_dense`]
    /// would produce for a row that is provably **diagonal** (ADR 0004 step 3a proved each
    /// `digital_rows` net is stamped ONLY here: a lone [`GMIN`] floor + at most one resolved
    /// Thévenin on its own diagonal, no off-diagonal coupling). The diagonal equation
    /// `(GMIN + g)·v = g·vt` gives:
    /// - **driven** (`Some((vt, g))` from [`Sim::digital_net_thevenin`]) ⇒ `v = g·vt / (GMIN + g)`;
    /// - **undriven / released** (`Z` ⇒ `None` ⇒ only the `GMIN` floor) ⇒ `v = 0 / GMIN = 0.0`,
    ///   so a floating digital net reads ≈0 V (→ `Low`), preserving floating-input-reads-low.
    ///
    /// This is the per-net body of step 3b's frozen-boundary sub-solve: it re-derives a pure-digital
    /// net's voltage from the latest committed drives without touching the (frozen) analog/boundary
    /// rows. Because it shares [`Sim::digital_net_thevenin`] with the full-assembly stamp, the value
    /// is bit-identical to what a fresh `solve_dense` of the same matrix produces for that row.
    #[inline]
    fn digital_net_solved_voltage(&self, node: usize) -> f64 {
        match self.digital_net_thevenin(node) {
            Some((vt, g)) => g * vt / (GMIN + g),
            None => 0.0,
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
        let cycles = f * (self.tick as f64) * DT; // cycles elapsed since t = 0
                                                  // Waveform select (param slot 1): 0 = sine (the default, so a plain AC source — and the
                                                  // golden — is unchanged), 1 = square/pulse, 2 = triangle. The web "pulse/clock
                                                  // generator" part is just this element with the waveform param set. Square and triangle
                                                  // are deterministic functions of the cycle phase (mul/div/floor/compare only — no
                                                  // transcendental), so they reproduce bit-for-bit on every platform.
        let waveform = e.params[1];
        if waveform <= 0.0 {
            return amplitude * (core::f64::consts::TAU * cycles).sin();
        }
        let phase = cycles - cycles.floor(); // periodic phase in [0, 1)
        let duty = {
            let d = e.params[3]; // slot 3 = duty cycle / triangle symmetry
            if d > 0.0 && d < 1.0 {
                d
            } else {
                0.5
            }
        };
        if waveform < 1.5 {
            // Square / pulse: a unipolar clock — high (`amplitude`) for the first `duty` of each
            // period, else 0. (Unipolar 0→V is the clock/logic idiom; the sine AC source covers
            // the bipolar ±V case.)
            if phase < duty {
                amplitude
            } else {
                0.0
            }
        } else {
            // Triangle: ramp up to the peak at `duty`, back down after — so `duty` doubles as the
            // symmetry knob (0.5 = symmetric, →1 = ramp/sawtooth). Unipolar 0→amplitude.
            if phase < duty {
                amplitude * (phase / duty)
            } else {
                amplitude * (1.0 - phase) / (1.0 - duty)
            }
        }
    }

    /// The instantaneous current of an ideal current source ([`ELEM_ISOURCE`]) — the engine of a
    /// programmable **electronic load** in constant-current mode. **Static by default:** a step
    /// frequency (param slot 0) of `0` returns the plain DC `value`, so a plain current source — and
    /// the golden, which has none — is bit-for-bit unchanged. A **positive** step frequency turns it
    /// into a *dynamic* load: a square step between the **base** level (`value`) and the **peak**
    /// level (`aux`) at that frequency, sitting at the peak for `params[3]` (duty) of each period and
    /// at the base the rest — the load-step / power-excursion pattern used to test a supply's
    /// transient response. The period **starts at the base** level (so the operating point primes the
    /// rail at its steady state, then the excursion makes it sag). Deterministic (mul/floor/compare
    /// only, no transcendental), so it reproduces bit-for-bit on every platform.
    ///
    /// Slot map for the source (no collisions): `value` = base/DC current, `aux` = peak current,
    /// `params[0]` = step frequency (Hz; `0` = static), `params[2]` = [`RATED_CURRENT_SLOT`],
    /// `params[3]` = duty (peak fraction). The orientation is the source's own (`a → b`): a positive
    /// current drains terminal `a`, so a load wires `a` to the rail and `b` to ground.
    #[inline]
    fn i_source_current(&self, e: &Element) -> f64 {
        let freq = e.params[0];
        if freq <= 0.0 {
            return e.value; // static DC — identical to the pre-programmable current source
        }
        let cycles = freq * (self.tick as f64) * DT;
        let phase = cycles - cycles.floor(); // periodic phase in [0, 1)
        let duty = {
            let d = e.params[3]; // peak (excursion) fraction of each period
            if d > 0.0 && d < 1.0 {
                d
            } else {
                0.5
            }
        };
        // Sit at the base for `1 - duty`, excurse to the peak for the final `duty` — so phase 0
        // (and the operating point) is the base level.
        if phase >= 1.0 - duty {
            e.aux
        } else {
            e.value
        }
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

    /// Whether a gated analog switch ([`ELEM_ASWITCH`]) is **closed** (conducting), derived
    /// from its control node read off the **committed previous-tick** [`Sim::node_v`] — the
    /// one-tick control delay that keeps the conductance constant within the solve (the same
    /// receiver delay the digital engine uses). Mirrors the powered-gate rail/threshold logic
    /// ([`gate_rails`] / [`GATE_MIN_RAIL`]):
    /// - Powered (`d` or `e` wired): `rail = V(d) − V(e)`; closed iff `rail >= `[`GATE_MIN_RAIL`]
    ///   **and** the control is above half-rail relative to GND (`V(c) − V(e) > 0.5·rail`). An
    ///   unwired VCC floats the rail below the minimum → forced open (dead chip).
    /// - Unpowered fallback (`d == 0 && e == 0`): closed iff `V(c) > `[`ASWITCH_FIXED_THRESH`].
    ///
    /// Pure `f64`, no PRNG, no hashing — a deterministic function of the committed node voltages.
    #[inline]
    fn aswitch_closed(&self, e: &Element) -> bool {
        if e.d == 0 && e.e == 0 {
            // No power pins: a bare control level against a fixed threshold (the powerless-gate
            // fallback), so an unwired-rail switch still follows a plain logic signal.
            self.node_v[e.c] > ASWITCH_FIXED_THRESH
        } else {
            let rail = self.node_v[e.d] - self.node_v[e.e];
            // An unpowered/under-powered rail forces the switch open (dead), matching a powered
            // gate whose VCC floats below GATE_MIN_RAIL.
            rail >= GATE_MIN_RAIL && (self.node_v[e.c] - self.node_v[e.e]) > 0.5 * rail
        }
    }

    /// The conductance of a gated analog switch ([`ELEM_ASWITCH`]) at the current tick: closed
    /// (control asserted, [`Sim::aswitch_closed`]) returns `1/R_on` (its `value`, or
    /// [`ASWITCH_RON`] when `value <= 0`); open returns the tiny [`SWITCH_GOFF`] leak (matching
    /// the clock switch's open behaviour so the node stays non-singular). A time-varying *linear*
    /// conductance read from the committed `node_v`, stamped exactly like a resistor — no Newton,
    /// no branch unknown, no reactive state.
    #[inline]
    fn aswitch_conductance(&self, e: &Element) -> f64 {
        if self.aswitch_closed(e) {
            let ron = if e.value > 0.0 { e.value } else { ASWITCH_RON };
            1.0 / ron
        } else {
            SWITCH_GOFF
        }
    }

    /// Advance exactly one fixed-size tick. Solves the implicit system, commits
    /// the new reactive state from the solution, and increments the tick. Pure
    /// `f64`, fixed order.
    pub fn step(&mut self) {
        let x = self.solve_into_readout();
        // Commit each digital/boundary net's level (the receiver, one tick of delay
        // before the digital engine reads it next tick) for the hash and the renderer.
        self.commit_net_levels();
        // Commit ANALOG reactive state for the next step (needs `x`'s branch unknowns).
        // The sequential DIGITAL state (DFF / SAMPLER / COMPARATOR / BEHAVIORAL) is advanced
        // separately by `commit_sequential_digital_state` so the sub-tick loop can re-run the
        // identical logic without re-committing reactive companions or re-solving the analog rows.
        for (i, e) in self.elements.iter().enumerate() {
            match e.kind {
                ELEM_CAPACITOR => {
                    // Store the new capacitor voltage V(a) - V(b).
                    self.reactive_state[i] = self.node_v[e.a] - self.node_v[e.b];
                }
                ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER => {
                    // Reverse-recovery diffusion charge q = TT·I, stored so the next step's
                    // backward-Euler companion can source the recovery current as it discharges.
                    // TT = 0 (default / Ideal / Schottky) leaves the charge at 0 — the diode is
                    // memoryless and bit-identical to before (golden-safe).
                    let tt = e.params[DIODE_TT_SLOT];
                    if tt > 0.0 {
                        let id = diode_eval(self.diode_vd[i], diode_model(e)).0;
                        self.reactive_state[i] = tt * id;
                    }
                }
                ELEM_INDUCTOR => {
                    // Store the new inductor branch current (a -> b).
                    let bi = self.branch_index[i];
                    self.reactive_state[i] = if bi < x.len() { x[bi] } else { 0.0 };
                }
                ELEM_TRANSFORMER => {
                    // Store the new magnetising current Im (branch bi) and the new
                    // secondary current Is (branch bi + 1). Both now carry reactive
                    // memory: Im is the magnetiser companion's history term, Is the
                    // secondary leakage-inductance companion's (TRANSFORMER_LLEAK).
                    let bi = self.branch_index[i];
                    self.reactive_state[i] = if bi < x.len() { x[bi] } else { 0.0 };
                    self.secondary_state[i] = if bi + 1 < x.len() { x[bi + 1] } else { 0.0 };
                }
                _ => {}
            }
        }
        // Sub-tick 0 of this analog tick: advance the sequential digital state once from the
        // just-solved committed voltages (the unit-delay edge-detect / FF / sampler / comparator /
        // behavioral commits) — UNCHANGED from the single-rate engine.
        self.commit_sequential_digital_state();

        // ADR 0004 step 3b — the integer multi-rate sub-tick loop. For every existing circuit
        // `S = 1` and this is skipped entirely, so the run is BYTE-IDENTICAL to before sub-ticking
        // existed (no hash change: the sub-tick index is transient, wrapped to 0 at this boundary,
        // and never folded). When some block declares a fast rate (`S > 1`) the analog solve and the
        // analog/boundary `node_v` are FROZEN (the analog Δt never moves — the golden's Δt is fixed);
        // we re-run only the analog-decoupled pure-digital block `S − 1` more times so a fast domain
        // clocks at its declared sub-tick rate against the µs analog tick. Each sub-tick follows the
        // fixed `logic-analog-digital-nets.md §7.6.1` phase order:
        //   receivers (eval_digital) → diagonal sub-solve → commit_net_levels → sequential commit.
        if self.subtick_rate > 1 {
            self.run_digital_subticks();
        }
        // Screen the committed state for a non-physical (FAIL) result and clamp it so
        // it can never propagate as a NaN, before the tick advances.
        self.flag_and_clamp_fails();
        // Fold this tick's per-element V/I sample into the running AC analyzers, after
        // the clamp so every sample is finite. Derived, snapshot-only, never hashed.
        self.update_ac_analysis();
        self.tick += 1;
    }

    /// Advance the **sequential digital** state of every clocked element by one digital
    /// (sub-)tick from the current committed `node_v`: the edge-triggered D flip-flop
    /// ([`ELEM_DFF`]), the clocked 1-bit sampler ([`ELEM_SAMPLER`]), the latched analog
    /// comparator ([`ELEM_COMPARATOR`]), and the behavioral state machine ([`ELEM_BEHAVIORAL`]).
    /// This is the unit-delay edge-detect/FF/comb/driver commit, factored out of [`Sim::step`]
    /// **verbatim** so the analog-tick path (sub-tick 0) and the multi-rate sub-tick loop
    /// ([`Sim::run_digital_subticks`]) run the **same** code — at the analog tick it reads the
    /// just-solved analog voltages; in a sub-tick it reads the sub-step-updated pure-digital
    /// `node_v` (the frozen boundary/analog `node_v` unchanged). All mutated state is integer/
    /// [`Level`] and enters the snapshot hash (so a rewind onto an edge replays identically). It
    /// iterates in fixed element-index order; its arms are disjoint from the reactive-companion
    /// commits, so splitting it off does not change the single-rate result.
    fn commit_sequential_digital_state(&mut self) {
        for (i, e) in self.elements.iter().enumerate() {
            match e.kind {
                ELEM_DFF => {
                    // Edge-triggered latch: on a rising CLK edge (Low -> High) sample
                    // D into the stored level (the receiver quantises the just-solved
                    // CLK/D voltages at the FF's rail). Otherwise the bit holds. Both
                    // `ff_q` and `ff_clk_prev` are 4-state and enter the snapshot hash.
                    let fam = &FAMILIES[gate_family_index(e.aux)];
                    let clk = fam.quantize(self.node_v[e.c], e.value);
                    if clk == Level::High && self.ff_clk_prev[i] != Level::High {
                        self.ff_q[i] = fam.quantize(self.node_v[e.b], e.value);
                    }
                    self.ff_clk_prev[i] = clk;
                }
                ELEM_SAMPLER => {
                    // Clocked 1-bit comparator: on a rising CLK edge (Low -> High) latch the
                    // analog input against the threshold — OUT = High iff V(IN) > value, else
                    // Low. Otherwise the bit holds. CLK (c) is quantised at the output rail
                    // (the LEGACY family, half-rail threshold); IN (b) is compared directly to
                    // `value` (the latch is a pure deterministic float compare — no float-order
                    // reduction). Both `samp_q` and `samp_clk_prev` are 4-state and enter the
                    // snapshot hash, so a rewind onto a clock edge replays identically.
                    let clk = FAMILIES[0].quantize(self.node_v[e.c], sampler_rail(e));
                    if clk == Level::High && self.samp_clk_prev[i] != Level::High {
                        self.samp_q[i] = if self.node_v[e.b] > e.value {
                            Level::High
                        } else {
                            Level::Low
                        };
                    }
                    self.samp_clk_prev[i] = clk;
                }
                ELEM_COMPARATOR => {
                    // Latched analog comparator (ADCMP601). Evaluate the front end from the
                    // just-solved committed voltages — the powered output stage then drives
                    // `cmp_q` next tick (a one-tick input-to-output delay, like the sampler).
                    // 1) Rail across the supply pins; below the operating minimum the chip is
                    //    UNPOWERED → hold the bit (the output reads dead/released, the powered
                    //    gate's dead-rail rule).
                    let rail = self.node_v[e.d] - self.node_v[e.e];
                    if rail >= GATE_MIN_RAIL {
                        // 2) Level-sensitive, ACTIVE-LOW latch enable: transparent when LE is
                        //    unwired (f == 0, the floating default) or driven at/above half-rail
                        //    relative to GND; driven below half-rail latches (hold). Pure
                        //    deterministic float compares — no float-order reduction.
                        let transparent =
                            e.f == 0 || (self.node_v[e.f] - self.node_v[e.e]) >= 0.5 * rail;
                        if transparent {
                            // 3) Symmetric hysteresis about 0 using the current held bit as the
                            //    Schmitt state: flip to High once diff > V_H/2, to Low once
                            //    diff < −V_H/2, else hold. value (= V_H) 0 ⇒ a plain comparator
                            //    (diff > 0 → High, diff < 0 → Low).
                            let diff = self.node_v[e.b] - self.node_v[e.c];
                            let half_vh = 0.5 * e.value;
                            if self.cmp_q[i] != Level::High && diff > half_vh {
                                self.cmp_q[i] = Level::High;
                            } else if self.cmp_q[i] != Level::Low && diff < -half_vh {
                                self.cmp_q[i] = Level::Low;
                            }
                        }
                        // else latched: cmp_q unchanged (hold).
                    }
                    // else unpowered: cmp_q unchanged (hold).
                }
                ELEM_BEHAVIORAL => {
                    // Advance the behavioral block's integer state machine by one tick from the
                    // just-solved committed inputs (the only state-mutation site — eval_digital
                    // merely DRIVES from this committed state). Programs: 1 = SPI master, 2 = SPI
                    // slave, 3 = UART. An unpowered chip (rail below the operating minimum) holds
                    // its state, and a 0/unknown program id is inert — both fold a zero/frozen state
                    // block, so the golden is untouched. Inputs are read as two-state digital levels
                    // (half-rail relative to GND on `e`, via beh_level — no float-order reduction; a
                    // deterministic boolean), each program reading its own input pins:
                    //   prog 1 SPI master: f=MISO, g=START
                    //   prog 2 SPI slave:  f=SCLK, g=MOSI, h=CS
                    //   prog 3 UART:       f=RX,   g=SEND
                    let prog = if e.value >= 1.0 { e.value as u32 } else { 0 };
                    let rail = self.node_v[e.d] - self.node_v[e.e];
                    if rail >= GATE_MIN_RAIL {
                        let vlow = self.node_v[e.e];
                        let lvl = |pin: usize| beh_level(&self.node_v, pin, vlow, rail);
                        match prog {
                            BEH_PROG_SPI_MASTER => {
                                let (nbits, half) = beh_spi_config(e);
                                beh_spi_step(
                                    &mut self.beh_state[i],
                                    e.aux as u64,
                                    nbits,
                                    half,
                                    lvl(e.g), // START
                                    lvl(e.f), // MISO
                                );
                            }
                            BEH_PROG_SPI_SLAVE => {
                                let nbits = beh_spi_slave_nbits(e);
                                beh_spi_slave_step(
                                    &mut self.beh_state[i],
                                    nbits,
                                    lvl(e.f), // SCLK
                                    lvl(e.g), // MOSI
                                    lvl(e.h), // CS (active-low)
                                );
                            }
                            BEH_PROG_UART => {
                                let (baud, nbits) = beh_uart_config(e);
                                beh_uart_step(
                                    &mut self.beh_state[i],
                                    e.aux as u64,
                                    baud,
                                    nbits,
                                    lvl(e.g), // SEND (trigger)
                                    lvl(e.f), // RX
                                );
                            }
                            BEH_PROG_LUT => {
                                // FPGA logic element: a combinational LUT advances no state (its
                                // output is live in eval_digital); a registered LUT latches the
                                // truth-table lookup of its committed inputs into Q on the rising
                                // CLK (b) edge. The index (IN0..IN3 = f/g/h/c, LSB..MSB) is the SAME
                                // helper the combinational output uses, so the two paths agree.
                                let index = beh_lut_live_index(&self.node_v, e, vlow, rail);
                                let registered = beh_lut_registered(e);
                                let clk = lvl(e.b);
                                beh_lut_step(
                                    &mut self.beh_state[i],
                                    e.aux as u32,
                                    registered,
                                    index,
                                    clk,
                                );
                            }
                            BEH_PROG_SAR_ADC => {
                                // 3-bit SAR ADC: on each rising CLK (h) decide one bit MSB-first,
                                // comparing VIN (f) against the trial DAC level (trial/8 of the VCC
                                // reference rail). The committed code drives D0/D1/D2 and the DONE
                                // strobe in eval_digital (one tick of state-to-output delay).
                                let clk = lvl(e.h);
                                let vin = self.node_v[e.f] - vlow;
                                beh_sar_adc_step(&mut self.beh_state[i], clk, vin, rail);
                            }
                            BEH_PROG_COUNTER => {
                                // 3-bit counter: increment on each rising CLK (f); RESET (g, active
                                // high) asynchronously clears. Drives Q0/Q1/Q2 in eval_digital.
                                let clk = lvl(e.f);
                                let reset = lvl(e.g);
                                beh_counter_step(&mut self.beh_state[i], clk, reset);
                            }
                            BEH_PROG_SIGMA_DELTA => {
                                // Sigma-delta ADC: on each rising CLK (h) run one modulator + decimator
                                // step, comparing VIN (f) against the VCC reference rail. Drives the
                                // decimated code on D0/D1/D2 and the 1-bit stream on BS in eval_digital.
                                let clk = lvl(e.h);
                                let vin = self.node_v[e.f] - vlow;
                                beh_sigma_delta_step(&mut self.beh_state[i], clk, vin, rail);
                            }
                            // Inert / unknown program: no state advance.
                            _ => {}
                        }
                    }
                    // else unpowered: state held (the dead-rail rule).
                }
                _ => {}
            }
        }
        // WRITE (cell-level memory, P1): a separate index pass — the match loop above holds an
        // immutable borrow of `self.elements`, so `write_cell` (which needs `&mut self`) cannot run
        // inside it. Level-sensitive async write: while WE (b) is high, latch D_in (c) into the
        // addressed word. Powered like a gate (VCC d / GND e set the rail); address + WE + D_in are
        // quantised from the just-solved committed voltages relative to GND. Funnels through
        // `write_cell` so `mem_digest` stays consistent.
        for i in 0..self.elements.len() {
            let e = self.elements[i];
            if e.kind != ELEM_MEMORY {
                continue;
            }
            let (vlow, vhigh) = gate_rails(&e, &self.node_v);
            let rail = (vhigh - vlow).max(0.0);
            let depth = self.mem_data[i].len();
            if rail < GATE_MIN_RAIL || depth == 0 {
                continue; // unpowered → hold (no write, no refresh, no decay)
            }
            let fam = &FAMILIES[0];
            // A wide memory (P3, option A) carries its address + data on the explicit bus lists; a
            // cell-level one uses the fixed terminals (addr = f/g/h, D_in = c). WE (b) / VCC (d) / GND (e)
            // are scalar in both. The addressed word is needed for the write AND the DRAM refresh below.
            let wide = !self.mem_dout_nodes[i].is_empty();
            let addr = if wide {
                self.mem_wide_addr(i, fam, vlow, rail, depth)
            } else {
                let a0 = (fam.quantize(self.node_v[e.f] - vlow, rail) == Level::High) as usize;
                let a1 = (fam.quantize(self.node_v[e.g] - vlow, rail) == Level::High) as usize;
                let a2 = (fam.quantize(self.node_v[e.h] - vlow, rail) == Level::High) as usize;
                (a0 | (a1 << 1) | (a2 << 2)) & (depth - 1)
            };
            // WRITE: while WE (b) is high, latch the data-in bus into the addressed word (digest-consistent).
            if fam.quantize(self.node_v[e.b] - vlow, rail) == Level::High {
                if wide {
                    // Assemble the word from the data-in bus (LSB = bit 0). A wide memory with no data-in
                    // bus is a ROM — WE is ignored, nothing is written.
                    if !self.mem_din_nodes[i].is_empty() {
                        let mut word = 0u32;
                        for b in 0..self.mem_din_nodes[i].len() {
                            let node = self.mem_din_nodes[i][b];
                            if fam.quantize(self.node_v[node] - vlow, rail) == Level::High {
                                word |= 1 << b;
                            }
                        }
                        self.write_cell(i, addr, word);
                    }
                } else {
                    let din = (fam.quantize(self.node_v[e.c] - vlow, rail) == Level::High) as u32;
                    self.write_cell(i, addr, din);
                }
            }
            // DRAM (mode 3): per-word refresh + EAGER decay. An ACCESS (the addressed word, read out on
            // D_out and/or written this tick) refreshes that row's epoch; any word not refreshed within
            // `retention_ticks` (param slot 4, Real-mode) leaks its stored 1 → 0 — the "refresh or your
            // data rots" lesson. Applied EAGERLY here (not lazily on read) so snapshot_hash always reflects
            // decayed contents and a rewind onto a decay tick replays bit-for-bit. retention 0 (default /
            // Ideal / RAM/ROM/EEPROM) → no decay → bit-identical to a non-leaky store (golden-safe).
            if e.params[0] == 3.0 {
                let tick = self.tick;
                self.mem_refresh[i][addr] = tick; // an access refreshes the addressed row
                let retention = e.params[4] as u64;
                if retention > 0 {
                    for w in 0..depth {
                        if tick.saturating_sub(self.mem_refresh[i][w]) > retention
                            && self.mem_data[i][w] != 0
                        {
                            self.write_cell(i, w, 0);
                        }
                    }
                }
            }
        }
    }

    /// ADR 0004 phase-3, step 3b — the integer **multi-rate sub-tick loop**. Called from
    /// [`Sim::step`] only when the global rate `S = self.subtick_rate > 1`, AFTER the full analog
    /// solve + `commit_net_levels` + the sub-tick-0 [`Sim::commit_sequential_digital_state`]. It runs
    /// `S − 1` additional digital sub-ticks, advancing the fast digital domain at its declared rate
    /// while the **analog Δt never changes** (the golden's Δt is fixed). The analog/boundary `node_v`
    /// stay FROZEN throughout — only the analog-decoupled pure-digital nets (`digital_rows`, proven
    /// strictly diagonal in step 3a) are re-derived — so no analog re-solve happens and the analog
    /// golden is untouched.
    ///
    /// Each sub-tick follows the fixed `logic-analog-digital-nets.md §7.6.1` phase order (getting it
    /// wrong creates a gated-clock ambiguity):
    /// 1. **receivers** — [`Sim::eval_digital`] recomputes every net's resolved drive from the
    ///    current committed levels (receivers read the latest pure-digital `node_v` + the frozen
    ///    boundary `node_v`);
    /// 2. **diagonal sub-solve** — for each pure-digital row, recompute its `node_v` in closed form
    ///    from its resolved drive ([`Sim::digital_net_solved_voltage`], the same value
    ///    [`Sim::stamp_digital`] + a matrix solve would give for that diagonal row); the
    ///    boundary/analog `node_v` are left frozen;
    /// 3. **commit_net_levels** — re-quantise the new pure-digital `node_v` into `net_level`;
    /// 4. **sequential commit** — [`Sim::commit_sequential_digital_state`] re-runs the edge-detect /
    ///    FF / sampler / comparator / behavioral logic on the sub-step-updated levels, so a fast
    ///    block clocks at the sub-tick rate (over-clocking the whole digital kernel is safe — a comb
    ///    gate just propagates faster; an FF clocked by a slow clock still latches only on that
    ///    clock's natural edges, which don't move within an analog tick because the boundary is
    ///    frozen).
    ///
    /// The sub-tick index `sub` is transient and wrapped to `0` at the analog-tick boundary (it is a
    /// loop-local counter), so it **never** enters [`Sim::snapshot_hash`]; the count is structural
    /// (`S`, derived from declared params) and the loop is fixed, so the result is reproducible by
    /// construction.
    fn run_digital_subticks(&mut self) {
        for _sub in 1..self.subtick_rate {
            // (1) Receivers: recompute the digital drives from the latest committed levels.
            self.eval_digital();
            // (2) Diagonal sub-solve of the pure-digital block ONLY — frozen boundary/analog rows.
            //     A pure-digital net's row is diagonal (`GMIN` + at most one Thévenin), so its
            //     voltage is the closed form `digital_net_solved_voltage`, bit-identical to a
            //     `solve_dense` of that single diagonal row. `digital_rows` holds MNA row indices
            //     (`node − 1`); map back to the node to write `node_v[node]`.
            for &row in &self.digital_rows {
                let node = row + 1;
                self.node_v[node] = self.digital_net_solved_voltage(node);
            }
            // (3) Re-quantise the updated pure-digital nets into their canonical levels.
            self.commit_net_levels();
            // (4) Advance the sequential digital state from the sub-step-updated levels.
            self.commit_sequential_digital_state();
        }
    }

    /// Fold this tick's solved per-element waveform sample — terminal voltage
    /// `V(a)−V(b)` and through-current — into each element's running AC analyzer
    /// ([`AcMeas`]). Called once per committed [`Sim::step`] (never at the install/reset
    /// operating point, so the analyzers start from the first real step). Pure function
    /// of the committed readout; the held results are exposed by [`Sim::ac_measurements`]
    /// and are **not** part of the snapshot hash, so they never move the golden.
    fn update_ac_analysis(&mut self) {
        for (i, e) in self.elements.iter().enumerate() {
            let v = self.node_v[e.a] - self.node_v[e.b];
            self.ac[i].update(v, self.currents[i]);
        }
    }

    /// After a solve, screen every quantity that displays or propagates — node
    /// voltages, per-element currents, and the reactive history (`reactive_state`,
    /// `secondary_state`) — for a non-physical value: non-finite, or beyond
    /// [`FAIL_LIMIT`]. Clamp any such value to `±FAIL_LIMIT` (so a NaN can never carry
    /// into the next step and delete traces — and so native and wasm agree exactly),
    /// raise the whole-sim [`Sim::failed`] flag, and mark each offending element in
    /// `failed_elements` for the renderer's FAIL box. A circuit that stays within
    /// physical bounds is untouched, so the snapshot hash and the golden don't move.
    fn flag_and_clamp_fails(&mut self) {
        // Clamp one value in place; return whether it was out of bounds.
        fn clamp(v: &mut f64) -> bool {
            if v.is_finite() && v.abs() <= FAIL_LIMIT {
                false
            } else {
                *v = if *v < 0.0 { -FAIL_LIMIT } else { FAIL_LIMIT };
                true
            }
        }
        let mut failed = false;
        for v in self.node_v.iter_mut() {
            failed |= clamp(v);
        }
        for s in self.reactive_state.iter_mut() {
            failed |= clamp(s);
        }
        for s in self.secondary_state.iter_mut() {
            failed |= clamp(s);
        }
        for i in 0..self.currents.len() {
            let mut bad = clamp(&mut self.currents[i]);
            // Component current rating: a part driven past its rated current FAILs (it would
            // burn out). The rating lives in a general param slot; `0` = unrated (the default
            // and every Ideal-mode part, since the web layer only installs the rating in Real
            // mode), so this is a no-op for an untouched circuit — golden-safe. It only raises
            // the FAIL flag; the solve itself is unchanged, so the snapshot hash never moves.
            let rated = self.elements[i].params[RATED_CURRENT_SLOT];
            if rated > 0.0 && self.currents[i].abs() > rated {
                bad = true;
            }
            self.failed_elements[i] = bad;
            failed |= bad;
        }
        self.failed = failed;
    }

    /// Whether the most recent step produced a non-physical **FAIL** — a non-finite or
    /// beyond-[`FAIL_LIMIT`] reading, the signature of an ideal part driven past what
    /// physics allows (no series impedance). The renderer shows the whole-sim FAIL
    /// state; the cure in-circuit is real series impedance.
    pub fn failed(&self) -> bool {
        self.failed
    }

    /// Per-element FAIL mask, parallel to [`Sim::element_currents`]: `1` for each
    /// element whose reading hit the FAIL bound this step, so the renderer can box the
    /// offending parts. Empty until the first step after a netlist is installed.
    pub fn failed_element_mask(&self) -> Vec<u8> {
        self.failed_elements.iter().map(|&b| b as u8).collect()
    }

    /// Current tick count since the netlist was installed or reset.
    pub fn tick(&self) -> u64 {
        self.tick
    }

    /// Diagnostic: Newton iterations taken by the most recent nonlinear solve (telemetry only — never
    /// hashed, never affects the solve). [`NEWTON_MAX_ITERS`] with [`Sim::last_newton_converged`] false
    /// means the solve hit the cap without converging (settled to its last iterate).
    pub fn last_newton_iters(&self) -> usize {
        self.last_newton_iters
    }

    /// Diagnostic: whether the most recent nonlinear solve converged (telemetry only). A linear netlist
    /// never runs Newton, so this stays at its install default (true).
    pub fn last_newton_converged(&self) -> bool {
        self.last_newton_converged
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

    /// Small-signal **AC analysis** at angular frequency `omega` (rad/s) with **ideal**
    /// components — see [`Sim::ac_solve_models`] for the full model and the `real` flag.
    pub fn ac_solve(&self, omega: f64) -> Vec<(f64, f64)> {
        self.ac_solve_models(omega, false)
    }

    /// Small-signal **AC analysis** at angular frequency `omega` (rad/s). Assembles the
    /// linear complex MNA — resistor → `G`, capacitor → `jωC`, inductor → a branch with
    /// `jωL`, DC voltage source → a short (`0 V` constraint), AC source → the stimulus at
    /// its peak amplitude, DC current source → an open, nonlinear devices → their
    /// operating-point small-signal companion — and solves it. Returns the complex node
    /// voltages as `(re, im)` pairs, ground excluded (node `k ≥ 1` at index `k − 1`), so a
    /// Bode / |Z| reader can take magnitudes and phases at **any** frequency — it never
    /// time-steps, so the transient step's Nyquist ceiling does not apply.
    ///
    /// `real` selects the component fidelity: `false` = ideal (a capacitor is pure `jωC`,
    /// an inductor pure `jωL`); `true` = **Real parasitics** — a capacitor carries series
    /// ESL + ESR (so it self-resonates and goes inductive above its SRF), an inductor
    /// carries series DCR and a parallel winding capacitance (so it self-resonates and goes
    /// capacitive). This is an **analysis-only** distinction: the transient solve is
    /// untouched either way, so the determinism golden is unaffected. Pure read of the
    /// netlist — never mutates sim state.
    fn ac_solve_models(&self, omega: f64, real: bool) -> Vec<(f64, f64)> {
        let node_unknowns = self.node_count.saturating_sub(1);
        // Branch-current unknowns (appended after the node voltages), as in the transient
        // MNA: one per voltage source and per inductor.
        let mut branch = vec![usize::MAX; self.elements.len()];
        let mut n = node_unknowns;
        for (i, e) in self.elements.iter().enumerate() {
            if e.kind == ELEM_VSOURCE || e.kind == ELEM_ACSOURCE || e.kind == ELEM_INDUCTOR {
                branch[i] = n;
                n += 1;
            }
        }
        if n == 0 {
            return Vec::new();
        }
        let mut a = vec![Cplx::ZERO; n * n];
        let mut b = vec![Cplx::ZERO; n];
        // Symmetric admittance (resistor-shaped KCL): +Y on the diagonals, −Y off, skip ground.
        let stamp_y = |a: &mut [Cplx], ia: Option<usize>, ib: Option<usize>, y: Cplx| {
            if let Some(r) = ia {
                a[r * n + r] = a[r * n + r].add(y);
            }
            if let Some(r) = ib {
                a[r * n + r] = a[r * n + r].add(y);
            }
            if let (Some(r), Some(c)) = (ia, ib) {
                a[r * n + c] = a[r * n + c].sub(y);
                a[c * n + r] = a[c * n + r].sub(y);
            }
        };
        // Branch-current incidence for a `V(a)−V(b)` constraint on row `k` (the complex twin
        // of the transient voltage-source augmentation).
        let stamp_branch = |a: &mut [Cplx], ia: Option<usize>, ib: Option<usize>, k: usize| {
            if let Some(r) = ia {
                a[r * n + k] = a[r * n + k].add(Cplx::ONE);
                a[k * n + r] = a[k * n + r].add(Cplx::ONE);
            }
            if let Some(r) = ib {
                a[r * n + k] = a[r * n + k].sub(Cplx::ONE);
                a[k * n + r] = a[k * n + r].sub(Cplx::ONE);
            }
        };
        // Real conductance stamp at (row, col), skipping any grounded terminal — for the
        // small-signal companions of nonlinear devices (their partials are frequency
        // independent, so they stamp as real entries into the complex matrix).
        let stamp_g = |a: &mut [Cplx], r: Option<usize>, c: Option<usize>, g: f64| {
            if let (Some(r), Some(c)) = (r, c) {
                a[r * n + c] = a[r * n + c].add(Cplx::new(g, 0.0));
            }
        };
        for (i, e) in self.elements.iter().enumerate() {
            let ia = Self::node_idx(e.a);
            let ib = Self::node_idx(e.b);
            match e.kind {
                ELEM_RESISTOR => {
                    if e.value > 0.0 {
                        // Ideal: Y = 1/R. Real: a series lead inductance, Z = R + jωL, so the
                        // current lags (a positive/inductive phase). Negligible on a normal R but
                        // visible on a low-value current-sense shunt at high frequency.
                        let y = if real {
                            let x = omega * R_ESL; // lead reactance
                            let z2 = e.value * e.value + x * x;
                            Cplx::new(e.value / z2, -x / z2) // 1 / (R + jX)
                        } else {
                            Cplx::new(1.0 / e.value, 0.0)
                        };
                        stamp_y(&mut a, ia, ib, y);
                    }
                }
                ELEM_SWITCH => {
                    stamp_y(&mut a, ia, ib, Cplx::new(self.switch_conductance(e), 0.0));
                }
                ELEM_ASWITCH => {
                    // Node-gated analog switch: a real conductance (its R_on or the open
                    // leak), the small-signal twin of the clock switch's stamp. Its state
                    // comes from the control node's committed voltage (aswitch_conductance).
                    stamp_y(&mut a, ia, ib, Cplx::new(self.aswitch_conductance(e), 0.0));
                }
                ELEM_CAPACITOR => {
                    if e.value > 0.0 {
                        // Ideal: Y = jωC. Real: the series ESL+ESR+C string, so the part
                        // self-resonates at 1/(2π√(ESL·C)) and goes inductive above it.
                        let y = if real {
                            // ESR (slot 0) + ESL (slot 1), kind defaults when unset.
                            let esr = param_or(&e.params, 0, CAP_ESR);
                            let esl = param_or(&e.params, 1, CAP_ESL);
                            let x = omega * esl - 1.0 / (omega * e.value); // net reactance
                            let z2 = esr * esr + x * x;
                            Cplx::new(esr / z2, -x / z2) // 1 / (ESR + jX)
                        } else {
                            Cplx::new(0.0, omega * e.value)
                        };
                        stamp_y(&mut a, ia, ib, y);
                    }
                }
                ELEM_INDUCTOR => {
                    let k = branch[i];
                    stamp_branch(&mut a, ia, ib, k);
                    // Branch equation: V(a) − V(b) − Z·i = 0. Ideal Z = jωL; Real adds the
                    // series winding resistance (DCR) and a parallel winding capacitance,
                    // so the part self-resonates and goes capacitive above its SRF.
                    let zl = if real {
                        // DCR (slot 0) + winding C (slot 1), kind defaults when unset.
                        Cplx::new(param_or(&e.params, 0, ind_dcr(e.value)), omega * e.value)
                    } else {
                        Cplx::new(0.0, omega * e.value)
                    };
                    a[k * n + k] = a[k * n + k].sub(zl);
                    if real {
                        let cw = param_or(&e.params, 1, IND_CW);
                        stamp_y(&mut a, ia, ib, Cplx::new(0.0, omega * cw));
                    }
                }
                ELEM_VSOURCE => {
                    let k = branch[i];
                    stamp_branch(&mut a, ia, ib, k);
                    // Independent DC source: a short in the small-signal model (rhs stays 0).
                }
                ELEM_ACSOURCE => {
                    let k = branch[i];
                    stamp_branch(&mut a, ia, ib, k);
                    b[k] = Cplx::new(if e.aux > 0.0 { e.aux } else { AC_AMPLITUDE }, 0.0);
                }
                // Nonlinear devices: stamp the small-signal companion at the operating
                // point the transient solver already holds (its limited junction/control
                // iterates — the DC bias once settled). These device models carry no
                // internal capacitance, so the partials are real; the jω content is
                // entirely the external L/C above. The conductance stamps mirror the
                // transient companions in `newton_iterate`, minus the DC equivalent-current
                // RHS (that is the bias point, not the small-signal AC response).
                _ => {
                    let ic = Self::node_idx(e.c);
                    if is_diode(e.kind) {
                        let g = diode_eval(self.diode_vd[i], diode_model(e)).1 + GMIN;
                        stamp_g(&mut a, ia, ia, g);
                        stamp_g(&mut a, ib, ib, g);
                        stamp_g(&mut a, ia, ib, -g);
                        stamp_g(&mut a, ib, ia, -g);
                    } else if is_varistor(e.kind) {
                        let g = varistor_eval(self.varistor_v[i], e.value.max(MOV_VC_MIN)).1 + GMIN;
                        stamp_g(&mut a, ia, ia, g);
                        stamp_g(&mut a, ib, ib, g);
                        stamp_g(&mut a, ia, ib, -g);
                        stamp_g(&mut a, ib, ia, -g);
                    } else if is_mosfet(e.kind) {
                        // Drain a, source b, gate c: i_ds = gm·v_gs + gds·v_ds.
                        let op = Self::mosfet_op(e, self.mosfet_vgs[i], self.mosfet_vds[i]);
                        let (gm, gds) = (op.gm, op.gds);
                        stamp_g(&mut a, ia, ia, gds);
                        stamp_g(&mut a, ia, ic, gm);
                        stamp_g(&mut a, ia, ib, -(gm + gds));
                        stamp_g(&mut a, ib, ib, gm + gds);
                        stamp_g(&mut a, ib, ia, -gds);
                        stamp_g(&mut a, ib, ic, -gm);
                        stamp_g(&mut a, ic, ic, GMIN);
                    } else if is_bjt(e.kind) {
                        // Collector a, emitter b, base c; Jacobian of (Ic, Ib) w.r.t.
                        // (Vbe, Vbc), mapped onto the node voltages (see newton_iterate).
                        let op = Self::bjt_op(e, self.bjt_vbe[i], self.bjt_vbc[i]);
                        let (gpi, gmu, gif, gbc) = (op.gpi, op.gmu, op.gif, op.gic_bc);
                        stamp_g(&mut a, ia, ia, -gbc);
                        stamp_g(&mut a, ia, ib, -gif);
                        stamp_g(&mut a, ia, ic, gif + gbc);
                        stamp_g(&mut a, ic, ic, gpi + gmu);
                        stamp_g(&mut a, ic, ia, -gmu);
                        stamp_g(&mut a, ic, ib, -gpi);
                        stamp_g(&mut a, ib, ib, gif + gpi);
                        stamp_g(&mut a, ib, ia, gbc + gmu);
                        stamp_g(&mut a, ib, ic, -(gif + gbc + gpi + gmu));
                        // GMIN across each junction (base-emitter, base-collector).
                        for (p, q) in [(ic, ib), (ic, ia)] {
                            stamp_g(&mut a, p, p, GMIN);
                            stamp_g(&mut a, q, q, GMIN);
                            stamp_g(&mut a, p, q, -GMIN);
                            stamp_g(&mut a, q, p, -GMIN);
                        }
                    } else if is_opamp(e.kind) {
                        // Output a, inverting input b, non-inverting input c. The output is
                        // a transconductance `Iout = Gout·(A·Vd − Vout)` with `Vd = V(c) −
                        // V(b)`; small-signal that is a `Gout` output conductance plus a
                        // controlled source `Gout·dT·Vd`. UNLIKE the transient (algebraic,
                        // infinite bandwidth), the AC gain rolls off at the op-amp's GBW: the
                        // open-loop gain has a dominant pole, so the controlled term gets a
                        // `1/(1 + jω/ω_p)` factor (`ω_p = 2π·GBW/A₀`). That gives a closed-loop
                        // stage its true −3 dB bandwidth (GBW / closed-loop gain) and the
                        // loop's phase shift on the Bode. dT is the slope at the bias point, so
                        // a saturated (clamped) op-amp correctly stops responding (dT → 0).
                        let vsat = e.value.max(OPAMP_VSAT_MIN);
                        let dt = opamp_target(self.opamp_vd[i], vsat).1;
                        // The finite gain-bandwidth is a Real-mode non-ideality (like the cap
                        // ESR / inductor DCR): in `real` mode the open-loop gain rolls off at
                        // the GBW (param slot 0, Hz, else the default — a "slow" vs "fast" part);
                        // in ideal mode the op-amp is infinite-bandwidth (flat).
                        let gmc = if real {
                            let gbw = if e.params[0] > 0.0 {
                                e.params[0]
                            } else {
                                OPAMP_GBW
                            };
                            let wp = core::f64::consts::TAU * gbw / OPAMP_GAIN;
                            Cplx::new(OPAMP_GOUT * dt, 0.0).div(Cplx::new(1.0, omega / wp))
                        } else {
                            Cplx::new(OPAMP_GOUT * dt, 0.0)
                        };
                        stamp_g(&mut a, ia, ia, OPAMP_GOUT);
                        if let (Some(r), Some(col)) = (ia, ic) {
                            a[r * n + col] = a[r * n + col].add(gmc);
                        }
                        if let (Some(r), Some(col)) = (ia, ib) {
                            a[r * n + col] = a[r * n + col].sub(gmc);
                        }
                        // Ideal inputs draw no current; a GMIN floor keeps a floating input
                        // non-singular (matches the transient op-amp's input handling).
                        stamp_g(&mut a, ib, ib, GMIN);
                        stamp_g(&mut a, ic, ic, GMIN);
                    }
                    // Logic gates / transformer: still open in this pass (follow-up).
                }
            }
        }
        let x = solve_dense_complex(a, b, n);
        x[..node_unknowns].iter().map(|c| (c.re, c.im)).collect()
    }

    /// Run the AC analysis across a list of frequencies (Hz), flattened for the JS↔wasm
    /// boundary: per frequency, the `[re, im]` of each non-ground node (node `k ≥ 1` at
    /// slot `k − 1`) — a block of `2·(node_count − 1)` `f64`s, in input frequency order.
    /// One batched call keeps the boundary coarse (a whole Bode sweep in a single crossing).
    /// `real` selects ideal vs Real-parasitic component models (see [`Sim::ac_solve_models`]).
    pub fn ac_sweep(&self, freqs_hz: &[f64], real: bool) -> Vec<f64> {
        let nu = self.node_count.saturating_sub(1);
        let mut out = Vec::with_capacity(freqs_hz.len() * nu * 2);
        for &f in freqs_hz {
            for (re, im) in self.ac_solve_models(core::f64::consts::TAU * f, real) {
                out.push(re);
                out.push(im);
            }
        }
        out
    }

    /// **Frequency-domain** per-element AC measurements at a single frequency — the analytic twin
    /// of the running [`Sim::ac_measurements`], in the same flat `[nElem × AC_FIELDS]` layout, so
    /// the web render can swap it in **above the ~62.5 kHz time-domain measurement ceiling** and
    /// the board still shows current/phase (shimmer + phasor) at 100 kHz–MHz, where the 2 µs step
    /// can't measure a cycle. Pure analysis (no solver change, no hash) → golden-safe.
    ///
    /// It reuses [`Sim::ac_solve_models`] for the complex node voltages, then for each element
    /// computes the small-signal AC current `I = Y·ΔV` (closed-form admittance per 2-terminal
    /// kind, evaluated at the settled operating point for the nonlinear devices); a voltage
    /// source's current comes from KCL at its hot node. Three-terminal devices (MOSFET/BJT/op-amp)
    /// and the transformer are left `valid = 0` for now (they carry no shimmer at HF yet). Reports
    /// the steady **sinusoidal** response (amplitude/phase at this one frequency), like the phasor.
    pub fn ac_element_measurements(&self, omega: f64, real: bool) -> Vec<f64> {
        let nv = self.ac_solve_models(omega, real); // complex node voltages, node k≥1 at slot k−1
        let node_v = |node: usize| -> Cplx {
            if node == 0 {
                return Cplx::ZERO;
            }
            let idx = node - 1;
            if idx < nv.len() {
                Cplx::new(nv[idx].0, nv[idx].1)
            } else {
                Cplx::ZERO
            }
        };
        let n_el = self.elements.len();
        let mut curr = vec![Cplx::ZERO; n_el];
        let mut has_ac = vec![false; n_el];
        // Per-element admittance Y(ω) for the 2-terminal kinds; I = Y·ΔV.
        for (i, e) in self.elements.iter().enumerate() {
            let vd = node_v(e.a).sub(node_v(e.b));
            let y = match e.kind {
                ELEM_RESISTOR if e.value > 0.0 => Some(if real {
                    // Series lead inductance Z = R + jωL (matches `ac_solve_models`).
                    let x = omega * R_ESL;
                    let z2 = e.value * e.value + x * x;
                    Cplx::new(e.value / z2, -x / z2)
                } else {
                    Cplx::new(1.0 / e.value, 0.0)
                }),
                ELEM_SWITCH => Some(Cplx::new(self.switch_conductance(e), 0.0)),
                ELEM_ASWITCH => Some(Cplx::new(self.aswitch_conductance(e), 0.0)),
                ELEM_CAPACITOR if e.value > 0.0 => Some(if real {
                    let esr = param_or(&e.params, 0, CAP_ESR);
                    let esl = param_or(&e.params, 1, CAP_ESL);
                    let x = omega * esl - 1.0 / (omega * e.value);
                    let z2 = esr * esr + x * x;
                    Cplx::new(esr / z2, -x / z2)
                } else {
                    Cplx::new(0.0, omega * e.value)
                }),
                ELEM_INDUCTOR if e.value > 0.0 => {
                    let zl = if real {
                        Cplx::new(param_or(&e.params, 0, ind_dcr(e.value)), omega * e.value)
                    } else {
                        Cplx::new(0.0, omega * e.value)
                    };
                    let mut y = Cplx::ONE.div(zl);
                    if real {
                        y = y.add(Cplx::new(0.0, omega * param_or(&e.params, 1, IND_CW)));
                    }
                    Some(y)
                }
                ELEM_DIODE | ELEM_SCHOTTKY | ELEM_LED | ELEM_ZENER => {
                    let g = diode_eval(self.diode_vd[i], diode_model(e)).1;
                    Some(Cplx::new(g + GMIN, 0.0))
                }
                ELEM_VARISTOR => {
                    let g = varistor_eval(self.varistor_v[i], e.value.max(MOV_VC_MIN)).1;
                    Some(Cplx::new(g + GMIN, 0.0))
                }
                _ => None,
            };
            if let Some(y) = y {
                curr[i] = y.mul(vd);
                has_ac[i] = true;
            }
        }
        // Voltage / AC sources: current = KCL at the hot node `a` — the net current the other
        // elements draw out of it (oriented to match `a -> b`).
        for i in 0..n_el {
            let e = &self.elements[i];
            if e.kind != ELEM_VSOURCE && e.kind != ELEM_ACSOURCE {
                continue;
            }
            let mut isum = Cplx::ZERO;
            for (j, ej) in self.elements.iter().enumerate() {
                if j == i || !has_ac[j] {
                    continue;
                }
                if ej.a == e.a {
                    isum = isum.add(curr[j]);
                } else if ej.b == e.a {
                    isum = isum.sub(curr[j]);
                }
            }
            curr[i] = isum;
            has_ac[i] = true;
        }
        // Derive the AcReadout fields (steady sinusoid) per element. Pure AC → no DC mean.
        let root2 = core::f64::consts::SQRT_2;
        let freq = omega / core::f64::consts::TAU;
        let mut out = vec![0.0f64; n_el * AC_FIELDS];
        for (i, e) in self.elements.iter().enumerate() {
            if !has_ac[i] {
                continue; // valid stays 0 → the web keeps the time-domain reading
            }
            let vd = node_v(e.a).sub(node_v(e.b));
            let ci = curr[i];
            let vamp = vd.abs();
            let iamp = ci.abs();
            // V−I phase (>0 lags / inductive), real power 0.5·Re(V·conj(I)).
            let phase = vd.im.atan2(vd.re) - ci.im.atan2(ci.re);
            let preal = 0.5 * (vd.re * ci.re + vd.im * ci.im);
            let vrms = vamp / root2;
            let irms = iamp / root2;
            let o = i * AC_FIELDS;
            out[o] = vrms;
            out[o + 1] = irms;
            // [2] vmean, [3] imean stay 0 (pure AC).
            out[o + 4] = vamp;
            out[o + 5] = iamp;
            out[o + 6] = preal;
            out[o + 7] = if vrms * irms > 1e-18 {
                preal / (vrms * irms)
            } else {
                1.0
            };
            out[o + 8] = if iamp > 1e-18 { vamp / iamp } else { 0.0 };
            out[o + 9] = phase;
            out[o + 10] = freq;
            out[o + 11] = 1.0; // valid
        }
        out
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

    /// Per-element **reactive branch current**, in installed-netlist order: a
    /// transformer's **magnetising current `Im`** (a→b) — its core-flux proxy
    /// (`Φ = L1·Im`), the state that carries the transformer's memory and DC flux
    /// bias — and an inductor's branch current; `0.0` for non-reactive elements.
    /// Read-only and **not part of the snapshot hash** (it is already reflected in
    /// `node_v`), so exposing it is replay-safe. Lets the renderer show a
    /// transformer's real flux level + bias rather than a free-running animation.
    pub fn reactive_currents(&self) -> Vec<f64> {
        self.reactive_state.clone()
    }

    /// Per-element **AC measurements**, flattened in installed-netlist order: element
    /// `i` occupies `[i*AC_FIELDS .. (i+1)*AC_FIELDS]`, with the field layout documented
    /// on [`AC_FIELDS`] (Vrms, Irms, Vmean, Imean, Vamp, Iamp, Preal, PF, |Z|, phase,
    /// freq, valid). Each element's analyzer holds the **last full AC cycle** measured
    /// from its terminal voltage and through-current; `valid` is `0.0` until the first
    /// cycle completes (the render then falls back to the instantaneous DC cues).
    ///
    /// A pure, side-effect-free read of the running analyzers, consistent with
    /// [`Sim::element_currents`] at the same tick and **not** part of the snapshot hash
    /// (like the currents) — so exposing it is replay-safe and golden-neutral. The
    /// length is `element_count * AC_FIELDS`. See `docs/ui/high-frequency-render.md`.
    pub fn ac_measurements(&self) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.ac.len() * AC_FIELDS);
        for a in &self.ac {
            out.extend_from_slice(&a.out);
        }
        out
    }

    /// The number of `f64` fields [`Sim::ac_measurements`] reports per element
    /// ([`AC_FIELDS`]), so the front end can stride the flat array without hardcoding.
    pub fn ac_fields(&self) -> usize {
        AC_FIELDS
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

    /// The analog/digital classification of node `n` as a small code: `0` = analog,
    /// `1` = pure-digital, `2` = boundary (an out-of-range node reads `0` = analog).
    /// Topology metadata for the separated digital domain — exposed for the renderer
    /// to draw digital nets and boundary buffers distinctly. Deterministic, fixed at
    /// install. See `docs/ui/logic-analog-digital-nets.md` §7.
    pub fn net_class(&self, n: usize) -> u8 {
        self.net_classes.get(n).copied().unwrap_or(NetClass::Analog) as u8
    }

    /// Decode a wide memory element's address bus ([`Sim::mem_addr_nodes`]`[i]`, LSB-first) into a word
    /// index — each bit quantised from the committed node voltage relative to `vlow`, masked to `depth`
    /// (a power of two). Shared by the wide READ and WRITE paths so they always agree on the addressed
    /// word. An empty address list ⇒ word 0 (a depth-1 single-word store), the natural degenerate case.
    fn mem_wide_addr(
        &self,
        i: usize,
        fam: &LogicFamily,
        vlow: f64,
        rail: f64,
        depth: usize,
    ) -> usize {
        let mut addr = 0usize;
        for (b, &node) in self.mem_addr_nodes[i].iter().enumerate() {
            if fam.quantize(self.node_v[node] - vlow, rail) == Level::High {
                addr |= 1 << b;
            }
        }
        addr & (depth - 1)
    }

    /// THE single mutation site for [`ELEM_MEMORY`] contents (`mem_data[i][k] = v`), maintaining the
    /// incremental [`Sim::mem_digest`] in O(1) — XOR the old word's keyed term out, the new word's
    /// term in. EVERY memory mutation (player write, ROM/EEPROM seed, and later DRAM refresh /
    /// destructive-read writeback / decay) MUST funnel through here, or the digest silently drifts
    /// from contents and the snapshot hash is wrong forever with no golden tripwire.
    fn write_cell(&mut self, i: usize, k: usize, v: u32) {
        let old = self.mem_data[i][k];
        if old == v {
            return;
        }
        self.mem_data[i][k] = v;
        self.mem_digest[i] ^= mem_cell_hash(k, old) ^ mem_cell_hash(k, v);
    }

    /// Seed an [`ELEM_MEMORY`] element's contents (a ROM/EEPROM image, or an initial RAM pattern):
    /// word `k` ← `words[k]` across the store's depth (missing words ⇒ 0, extra words ignored).
    /// Writes through [`Sim::write_cell`] so the digest stays consistent. A no-op for an out-of-range
    /// index or a non-memory element (its store is empty). Issued web-side after install/reset for
    /// non-volatile modes — the volatility policy lives there, not in the engine.
    pub fn load_memory(&mut self, elem_index: usize, words: &[u32]) {
        if elem_index >= self.mem_data.len() {
            return;
        }
        let depth = self.mem_data[elem_index].len();
        for k in 0..depth {
            let v = words.get(k).copied().unwrap_or(0);
            self.write_cell(elem_index, k, v);
        }
    }

    /// Install the **word-level bus-port** node lists for a wide [`ELEM_MEMORY`] (#100, P3 option A): the
    /// explicit address / data-in / data-out bus nodes the 8 fixed terminals cannot hold. Called AFTER
    /// `set_netlist*` (the indices reference the just-installed node space), at most once per wide memory —
    /// the coarse, batched side-channel (one call carries the whole bus, never per-bit per-frame). Address
    /// is LSB-first; data-in / data-out are bit-`k`-first. Out-of-range node indices are dropped; an
    /// out-of-range element index is a no-op. A **non-empty data-out list** switches the element onto the
    /// wide READ/WRITE path; leaving it empty keeps the cell-level a/b/c/f/g/h path (byte-identical,
    /// golden-safe). Storing ports re-runs net classification (so the bus nodes classify Digital/Boundary
    /// exactly like the cell-level signal pins) and re-primes the `t = 0` operating point, so the wide
    /// element is solvable before the first [`Sim::step`]. Must precede stepping (mirrors install).
    pub fn set_memory_ports(
        &mut self,
        elem_index: usize,
        addr_nodes: &[u32],
        din_nodes: &[u32],
        dout_nodes: &[u32],
    ) {
        if elem_index >= self.mem_data.len() {
            return;
        }
        let node_count = self.node_count;
        let keep = |nodes: &[u32]| -> Vec<usize> {
            nodes
                .iter()
                .map(|&n| n as usize)
                .filter(|&n| n < node_count)
                .collect()
        };
        self.mem_addr_nodes[elem_index] = keep(addr_nodes);
        self.mem_din_nodes[elem_index] = keep(din_nodes);
        self.mem_dout_nodes[elem_index] = keep(dout_nodes);
        self.reclassify_and_reprime();
    }

    /// Recompute the net classification (now aware of any wide memory bus-port nodes) and the pure-digital
    /// row partition, then re-prime the `t = 0` operating point. Used by [`Sim::set_memory_ports`] to fold
    /// the bus nodes into the digital domain after install. A circuit with no wide ports reduces to exactly
    /// the install-time classification (the lists are empty), so this is golden-safe.
    fn reclassify_and_reprime(&mut self) {
        let net_classes = classify_nets(
            self.node_count,
            &self.elements,
            &self.mem_addr_nodes,
            &self.mem_din_nodes,
            &self.mem_dout_nodes,
        );
        let digital_rows: Vec<usize> = (1..self.node_count)
            .filter(|&n| net_classes[n] == NetClass::Digital)
            .map(|n| n - 1)
            .collect();
        self.net_classes = net_classes;
        self.digital_rows = digital_rows;
        self.solve_operating_point();
        self.commit_net_levels();
    }

    /// Read word `addr` of an [`ELEM_MEMORY`] element's contents (`0` for an out-of-range
    /// index/addr or a non-memory element). Read-only — never touches the digest. The stored bit is
    /// observed here (and via the renderer/MEASURE readout), not through a Q pin.
    pub fn mem_read(&self, elem_index: usize, addr: usize) -> u32 {
        self.mem_data
            .get(elem_index)
            .and_then(|v| v.get(addr))
            .copied()
            .unwrap_or(0)
    }

    /// Stable hash of the full snapshot. Part of the replay contract. FNV-1a over, in
    /// fixed order: the tick (little-endian); then each node — a pure-`Digital` net
    /// folds its discrete [`Level`] (one `u8`, no float compares cross the boundary),
    /// every other node (analog/boundary) folds its `node_v` (`f64` bits) as before;
    /// then each flip-flop's `ff_q` and `ff_clk_prev` (one `u8` each), so sequential
    /// state replays across a clock edge; then — appended after the flip-flops — each
    /// clocked sampler's `samp_q` and `samp_clk_prev` (one `u8` each), the same sequential
    /// replay guarantee for the sampler; then — appended after the samplers — each latched
    /// comparator's `cmp_q` (one `u8`), the same guarantee for the level-latched comparator;
    /// then — appended after the comparators — each behavioral block's full integer state
    /// (`beh_state`: [`BEH_STATE_WORDS`] `u32` words as little-endian bytes, in fixed element +
    /// word order), the protocol/behavioral engine's reproducibility guarantee (ADR 0004).
    /// Forward-stable and append-only: a circuit with no flip-flop, sampler, comparator, or
    /// behavioral block (the RC golden, every existing test) folds ZERO extra bytes and hashes
    /// exactly as it always did. See `docs/ui/logic-analog-digital-nets.md` §7.8.
    pub fn snapshot_hash(&self) -> u64 {
        let mut bytes = Vec::with_capacity(8 + self.node_v.len() * 8 + self.elements.len() * 2);
        bytes.extend_from_slice(&self.tick.to_le_bytes());
        for (n, v) in self.node_v.iter().enumerate() {
            if matches!(self.net_classes.get(n), Some(NetClass::Digital)) {
                bytes.push(self.net_level[n] as u8);
            } else {
                bytes.extend_from_slice(&v.to_le_bytes());
            }
        }
        for (i, e) in self.elements.iter().enumerate() {
            if e.kind == ELEM_DFF {
                bytes.push(self.ff_q[i] as u8);
                bytes.push(self.ff_clk_prev[i] as u8);
            }
        }
        // Then each clocked sampler's stored bit and previous clock level (one `u8` each),
        // in fixed element order — APPENDED after the flip-flop fold, so a circuit with no
        // sampler (the RC golden, every existing test) folds ZERO extra bytes and hashes
        // byte-identically to before. Sequential state, so a rewind onto a sample edge
        // replays exactly.
        for (i, e) in self.elements.iter().enumerate() {
            if e.kind == ELEM_SAMPLER {
                bytes.push(self.samp_q[i] as u8);
                bytes.push(self.samp_clk_prev[i] as u8);
            }
        }
        // Then each latched comparator's held bit (one `u8`), in fixed element order —
        // APPENDED after the sampler fold, so a circuit with no comparator (the RC golden,
        // every existing test) folds ZERO extra bytes and hashes byte-identically to before.
        // The comparator is level-sensitive, so unlike the sampler it has no previous-clock
        // companion — `cmp_q` is its only sequential scalar. Sequential state, so a rewind
        // replays exactly.
        for (i, e) in self.elements.iter().enumerate() {
            if e.kind == ELEM_COMPARATOR {
                bytes.push(self.cmp_q[i] as u8);
            }
        }
        // Then each behavioral block's full integer state (BEH_STATE_WORDS u32 words as LE
        // bytes), in fixed element + word order — APPENDED after the comparator fold, so a
        // circuit with no behavioral block (the RC golden, every existing test) folds ZERO
        // extra bytes and hashes byte-identically to before. Integer state only (no floats,
        // no std hasher), the protocol/behavioral engine's reproducibility guarantee (ADR 0004).
        for (i, e) in self.elements.iter().enumerate() {
            if e.kind == ELEM_BEHAVIORAL {
                for w in &self.beh_state[i] {
                    bytes.extend_from_slice(&w.to_le_bytes());
                }
            }
        }
        // Then each behavioral MEMORY's incremental content digest (8 bytes) + its wear counter
        // (4 bytes), in fixed element order — APPENDED after the behavioral fold, so a circuit with
        // no memory element (the RC golden, every existing test) folds ZERO extra bytes and hashes
        // byte-identically to before. Folding the O(1)-maintained DIGEST (not the contents) is what
        // makes a multi-MB array hashable every step. Integer state only (no floats, no std hasher).
        for (i, e) in self.elements.iter().enumerate() {
            if e.kind == ELEM_MEMORY {
                bytes.extend_from_slice(&self.mem_digest[i].to_le_bytes());
                bytes.extend_from_slice(&self.mem_wear[i].to_le_bytes());
            }
        }
        // Then each DRAM (mode 3) element's per-word refresh epochs — APPENDED after the digest/wear fold,
        // gated on mode so RAM/ROM/EEPROM (and the golden, and the P1 RAM tests) fold ZERO extra bytes and
        // hash byte-identically. The epochs are program-visible (they drive eager decay), so they must
        // reproduce on rewind. Integer state only.
        for (i, e) in self.elements.iter().enumerate() {
            if e.kind == ELEM_MEMORY && e.params[0] == 3.0 {
                for r in &self.mem_refresh[i] {
                    bytes.extend_from_slice(&r.to_le_bytes());
                }
            }
        }
        fnv1a(&bytes)
    }
}

/// Test-only accessors into a behavioral block's integer state — so the SPI tests can read the
/// received word and the state-machine phase directly (the receive path and idle/done state are
/// internal to `beh_state`; the OUTPUT pins only expose SCLK/MOSI/CS). Not part of the public
/// API and compiled only under test.
#[cfg(test)]
impl Sim {
    /// The deterministic pure-digital row partition built at install (ADR 0004 phase-3, step
    /// 3a): the MNA row index (`node − 1`) of every pure-`Digital` node, ascending. Test-only
    /// read of the metadata the sub-tick loop will consume.
    fn digital_rows(&self) -> &[usize] {
        &self.digital_rows
    }

    /// The behavioral SPI master's received word (`shift_in`, state word 3) for the element at
    /// index `i`.
    fn beh_spi_shift_in(&self, i: usize) -> u32 {
        self.beh_state[i][BEH_SPI_SHIFT_IN]
    }
    /// The behavioral SPI master's FSM phase (state word 0: 0 = idle, 1 = active) for element `i`.
    fn beh_spi_fsm(&self, i: usize) -> u32 {
        self.beh_state[i][BEH_SPI_FSM]
    }
    /// The behavioral **SPI slave**'s latched received word (`RX_WORD`) for element `i` — the last
    /// completed transaction's byte. Mirrors `beh_spi_shift_in` from the slave side.
    fn beh_spi_slave_rx_word(&self, i: usize) -> u32 {
        self.beh_state[i][BEH_SLV_RX_WORD]
    }
    /// The behavioral **SPI slave**'s `RXVALID` flag (1 = a word is latched, held until CS
    /// deasserts) for element `i`.
    fn beh_spi_slave_rxvalid(&self, i: usize) -> u32 {
        self.beh_state[i][BEH_SLV_RXVALID]
    }
    /// The behavioral **UART**'s latched received byte (`RX_WORD`) for element `i`.
    fn beh_uart_rx_word(&self, i: usize) -> u32 {
        self.beh_state[i][BEH_UART_RX_WORD]
    }
    /// The behavioral **UART**'s `RXVALID` pulse flag (1 for the one tick a byte latches) for
    /// element `i`. (A test typically OR-accumulates this across the run since it is a one-tick
    /// pulse.)
    fn beh_uart_rxvalid(&self, i: usize) -> u32 {
        self.beh_state[i][BEH_UART_RXVALID]
    }
    /// The behavioral **FPGA logic element**'s registered output bit (`Q`, state word 0) for
    /// element `i` — the value a registered LUT latched on its last rising clock edge.
    fn beh_lut_q(&self, i: usize) -> u32 {
        self.beh_state[i][BEH_LUT_Q]
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

    /// ADR 0002 wire-format provisioning: the full **8-terminal / 8-param** plumbing,
    /// exercised end to end through the public install path. Installs a netlist whose
    /// resistor is wired through the **eighth** terminal `h` (index 7) and carries a value
    /// in **param slot 7** (the last of the widened block), then reads both back off the
    /// stored [`Element`]. `h` and slot 7 are reserved/inert today, so the resistor still
    /// solves as a plain 5 V across 1 kΩ — proving the widened arrays cross the boundary,
    /// pass length validation, and land in the struct without perturbing the solve. This is
    /// the sim-core half of the array-sync de-risk (the JS half has no runtime test).
    #[test]
    fn wire_format_eighth_terminal_and_param_slot_plumb_through() {
        let mut sim = Sim::new(1);

        // node 0 = ground, node 1 = the hot node. E0 = 5 V source (1→0); E1 = 1 kΩ (1→0).
        // E1 also wires its eighth terminal `h` to node 1 and stows a sentinel in slot 7.
        let types = [ELEM_VSOURCE, ELEM_RESISTOR];
        let a = [1u32, 1];
        let b = [0u32, 0];
        let c = [0u32, 0];
        let d = [0u32, 0];
        let e = [0u32, 0];
        let f = [0u32, 0];
        let g = [0u32, 0];
        // The eighth terminal: ground on the source, node 1 on the resistor.
        let h = [0u32, 1];
        let values = [5.0, 1_000.0];
        let aux = [0.0, 0.0];
        // One PARAM_STRIDE-wide block per element; the resistor's slot 7 carries the sentinel.
        const SENTINEL: f64 = 42.5;
        let mut params = vec![0.0; types.len() * PARAM_STRIDE];
        params[PARAM_STRIDE + 7] = SENTINEL; // element 1 (resistor), slot 7

        // Every parallel array is exactly one entry per element; params is n * PARAM_STRIDE.
        assert_eq!(h.len(), types.len());
        assert_eq!(params.len(), types.len() * PARAM_STRIDE);

        assert!(
            sim.set_netlist_pefgh(
                2, &types, &a, &b, &c, &d, &e, &f, &g, &h, &values, &aux, &params,
            ),
            "an 8-terminal / 8-param netlist must install (not fail safe to empty)"
        );

        // The eighth terminal landed on the stored element (the array plumbed through).
        let resistor = sim.element_at(1);
        assert_eq!(
            resistor.h, 1,
            "terminal `h` (index 7) must reach the Element"
        );
        assert_eq!(resistor.f, 0, "unused terminal `f` defaults to ground");
        assert_eq!(resistor.g, 0, "unused terminal `g` defaults to ground");

        // Param slot 7 reads back through the same `param_or` rule the solver uses.
        assert_eq!(
            param_or(&resistor.params, 7, -1.0),
            SENTINEL,
            "param slot 7 (the last of the widened 8-wide block) must read back"
        );
        // A zero slot still falls through to the caller's default (the golden-safe rule).
        assert_eq!(
            param_or(&resistor.params, 6, -1.0),
            -1.0,
            "an unset slot still means `use the default`"
        );

        // And the circuit actually solved (proving this was a real install): 5 V on node 1.
        sim.step();
        let volts = sim.node_voltages();
        assert!(
            (volts[1] - 5.0).abs() < 1e-9,
            "the resistor still sees a plain 5 V across it — `h`/slot 7 are inert"
        );
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

    /// The expected pure-digital row partition derived independently from `net_class`: the MNA
    /// row (`node − 1`) of every node the public classifier reports as pure-`Digital` (code `1`),
    /// ascending. The internal `digital_rows` must equal this for every circuit.
    fn expected_digital_rows(sim: &Sim) -> Vec<usize> {
        (1..sim.node_count)
            .filter(|&n| sim.net_class(n) == 1)
            .map(|n| n - 1)
            .collect()
    }

    /// ADR 0004 phase-3, step 3a — the pure-digital row partition is exactly the set of
    /// `NetClass::Digital` node rows (ascending), and the pure-digital matrix block is strictly
    /// diagonal. The diagonal property is enforced automatically by the debug assertion baked
    /// into EVERY assembly path (it runs during `install` and every `step()` below; were any
    /// pure-digital row to couple to another row, `debug_assert_digital_block_diagonal` would
    /// panic). Here we additionally pin the partition contents against the independent
    /// `net_class` classification and verify a couple of rows by hand. Several MIXED
    /// analog+digital circuits exercise all four solve paths (linear / Newton × op / transient).
    #[test]
    fn digital_partition_is_diagonal() {
        // Verify `digital_rows` equals the Digital-net rows, then step so the in-solve diagonal
        // assertion runs against the real assembled matrix.
        let check = |sim: &mut Sim, label: &str| {
            assert_eq!(
                sim.digital_rows(),
                expected_digital_rows(sim).as_slice(),
                "{label}: digital_rows must be exactly the Digital-net rows, ascending"
            );
            // Several steps drive the in-solve `debug_assert_digital_block_diagonal` on the
            // genuinely assembled matrix each tick (a panic there fails this test).
            for _ in 0..8 {
                sim.step();
            }
            // Partition is fixed at install — unchanged after stepping.
            assert_eq!(
                sim.digital_rows(),
                expected_digital_rows(sim).as_slice(),
                "{label}: digital_rows is fixed at install"
            );
        };

        // (1) Two-gate inverter chain: a powered-supply rail (node 1, analog), a source-driven
        //     input (node 2), G1 IN=2 OUT=3, G2 IN=3 OUT=4. The gate-to-gate net (node 3) is
        //     touched only by gate signal pins → the canonical **pure-Digital** net (row 2). The
        //     input net (node 2) is shared by the analog source AND a gate input pin → Boundary
        //     (NOT pure-digital), and the final gate output (node 4) is pure-Digital (row 3). The
        //     gate VCC pin sits on node 1 (analog supply), keeping the rail analog.
        let mut chain = Sim::new(1);
        assert!(chain.set_netlist_pe(
            5,
            &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_GATE, ELEM_GATE],
            &[1, 2, 3, 4], // a: VCC src, IN src, G1 OUT=3, G2 OUT=4
            &[0, 0, 2, 3], // b: src grounds, G1 IN1=2, G2 IN1=3
            &[0, 0, 0, 0], // c: G IN2 unused
            &[0, 0, 1, 1], // d: gate VCC = node 1
            &[0, 0, 0, 0], // e: gate GND = node 0
            &[5.0, 5.0, 0.0, 0.0],
            &[0.0, 0.0, 6.0, 6.0], // NOT, NOT
            &[],
        ));
        // By hand: ground (0) analog, VCC rail (1) analog; the source-driven gate INPUT (2) is
        // Boundary (analog source + digital pin); the gate-to-gate net (3) and final output (4)
        // are pure-Digital → rows {2, 3}.
        assert_eq!(chain.net_class(1), 0, "VCC rail is analog");
        assert_eq!(
            chain.net_class(2),
            2,
            "source-driven gate input is Boundary"
        );
        assert_eq!([chain.net_class(3), chain.net_class(4)], [1, 1]);
        assert_eq!(chain.digital_rows(), &[2, 3]);
        check(&mut chain, "two-gate chain");

        // (2) DFF clocked by a gate: a SWITCH chops the rail (node 1) onto node 2, a powered
        //     inverter (G) drives node 3 (the gate→DFF CLK net) from node 2, and the DFF (Q=4,
        //     D=5, CLK=3, Q̄=6) latches on the resulting clock. The gate-OUT↔DFF-CLK net (3) and
        //     the DFF signal nets Q/D/Q̄ (4/5/6) are pure-digital (only digital pins touch them);
        //     node 2 is Boundary (the analog SWITCH conductance shares it with the gate input).
        let mut dff = Sim::new(1);
        assert!(dff.set_netlist_pe(
            7,
            &[ELEM_VSOURCE, ELEM_SWITCH, ELEM_GATE, ELEM_DFF],
            &[1, 1, 3, 4],         // a: VCC src, SWITCH hi=node1, G OUT=3, DFF Q=4
            &[0, 2, 2, 5],         // b: src gnd, SWITCH to node2, G IN1=2, DFF D=5
            &[0, 0, 0, 3],         // c: …, …, G IN2 unused, DFF CLK=3
            &[0, 0, 1, 6],         // d: …, …, G VCC=node1, DFF Q̄=6
            &[0, 0, 0, 0],         // e: G GND=node0
            &[5.0, 0.5, 0.0, 5.0], // SWITCH duty 0.5, DFF rail 5 V
            &[0.0, 0.0, 6.0, 0.0], // G NOT; DFF aux default
            &[],
        ));
        // Node 2 (SWITCH↔gate input) is Boundary (an analog conductance shares it with a digital
        // pin); the gate output 3 and the DFF signal nets 4/5/6 are pure-digital → rows {2,3,4,5}.
        assert_eq!(dff.net_class(2), 2, "SWITCH-driven gate input is Boundary");
        assert_eq!(
            [
                dff.net_class(3),
                dff.net_class(4),
                dff.net_class(5),
                dff.net_class(6)
            ],
            [1, 1, 1, 1]
        );
        assert_eq!(dff.digital_rows(), &[2, 3, 4, 5]);
        check(&mut dff, "DFF clocked by a gate");

        // (3) Powered gate driving an RC load THROUGH the boundary: a powered inverter OUT (node
        //     3) feeds a series R into an analog RC (node 4 → C → gnd). OUT (node 3) is shared by
        //     a digital pin (gate OUT) AND an analog element (the resistor) → Boundary, so it is
        //     NOT in digital_rows; the RC interior (node 4) is analog. The chain has no pure-
        //     digital net at all → digital_rows empty.
        let mut rcload = Sim::new(1);
        assert!(rcload.set_netlist_pe(
            5,
            &[
                ELEM_VSOURCE,   // VCC rail -> node 1
                ELEM_VSOURCE,   // input    -> node 2
                ELEM_GATE,      // inverter: OUT=3, IN=2, VCC=1, GND=0
                ELEM_RESISTOR,  // node 3 -> node 4
                ELEM_CAPACITOR  // node 4 -> gnd
            ],
            &[1, 2, 3, 3, 4],
            &[0, 0, 2, 4, 0],
            &[0, 0, 0, 0, 0],
            &[0, 0, 1, 0, 0],
            &[0, 0, 0, 0, 0],
            &[5.0, 5.0, 0.0, 1000.0, 1.0e-6],
            &[0.0, 0.0, 6.0, 0.0, 0.0], // NOT
            &[],
        ));
        assert_eq!(rcload.net_class(3), 2, "gate-OUT loaded by R is Boundary");
        assert_eq!(rcload.net_class(4), 0, "RC interior is analog");
        assert!(
            rcload.digital_rows().is_empty(),
            "no pure-digital net in the powered-gate→RC chain"
        );
        check(&mut rcload, "powered gate -> RC load (boundary OUT)");

        // (4) Powered gate driving an RC load THROUGH NOTHING (the pure-digital case for
        //     contrast): the inverter OUT (node 3) is pure-digital (no analog load on it), and a
        //     SECOND gate buffers it onto node 4 (also pure-digital) which then drives the RC —
        //     so node 4 is the boundary and node 3 stays pure-digital. Mixes a pure-digital row
        //     (3 → row 2) with a boundary that is excluded.
        let mut buf_rc = Sim::new(1);
        assert!(buf_rc.set_netlist_pe(
            6,
            &[
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_GATE,      // inverter OUT=3
                ELEM_GATE,      // buffer   OUT=4 from IN=3
                ELEM_RESISTOR,  // node 4 -> 5
                ELEM_CAPACITOR  // node 5 -> gnd
            ],
            &[1, 2, 3, 4, 4, 5],
            &[0, 0, 2, 3, 5, 0],
            &[0, 0, 0, 0, 0, 0],
            &[0, 0, 1, 1, 0, 0],
            &[0, 0, 0, 0, 0, 0],
            &[5.0, 5.0, 0.0, 0.0, 1000.0, 1.0e-6],
            &[0.0, 0.0, 6.0, 7.0, 0.0, 0.0], // NOT, BUF
            &[],
        ));
        assert_eq!(
            buf_rc.net_class(3),
            1,
            "inverter OUT (unloaded) is pure-digital"
        );
        assert_eq!(buf_rc.net_class(4), 2, "buffer OUT loaded by R is Boundary");
        assert_eq!(
            buf_rc.digital_rows(),
            &[2],
            "only node 3 (row 2) is pure-digital"
        );
        check(
            &mut buf_rc,
            "gate -> gate -> RC (one pure-digital, one boundary)",
        );

        // (5) ADCMP601 comparator (Newton path is not needed, but a powered comparator with a
        //     chopped input exercises the boundary/digital classifier): a PWM-chopped IN- (node
        //     3) crosses a fixed IN+ (node 2) under a powered, transparent comparator whose OUT
        //     (node 4) is pure-digital (nothing analog loads it). Mirrors
        //     `comparator_run_is_reproducible`. OUT (4) is the only digital net → row 3.
        let mut cmp = Sim::new(1);
        assert!(cmp.set_netlist_pefgh(
            6,
            &[
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_SWITCH,
                ELEM_RESISTOR,
                ELEM_COMPARATOR,
            ],
            &[1, 2, 5, 5, 3, 4], // a: VCC, IN+ src, IN- rail, SWITCH, R, CMP OUT=4
            &[0, 0, 0, 3, 0, 2], // b: …, SWITCH→IN-(3), R→gnd, CMP IN+=2
            &[0, 0, 0, 0, 0, 3], // c: CMP IN-=3
            &[0, 0, 0, 0, 0, 1], // d: CMP VCC=node1
            &[0, 0, 0, 0, 0, 0], // e: CMP GND=node0
            &[0, 0, 0, 0, 0, 0], // f: CMP LE=node0 (transparent)
            &[],
            &[],
            &[5.0, 2.5, 4.0, 0.5, 1000.0, 1.0],
            &[0.0; 6],
            &[],
        ));
        assert_eq!(
            cmp.net_class(3),
            0,
            "comparator IN- (analog sense + SWITCH) is analog"
        );
        assert_eq!(
            cmp.net_class(4),
            1,
            "comparator OUT (unloaded) is pure-digital"
        );
        assert_eq!(cmp.digital_rows(), &[3]);
        check(&mut cmp, "ADCMP601 comparator (pure-digital OUT)");

        // (6) Behavioral SPI master: SCLK(3)/MOSI(4)/CS(5) are pure-digital OUTPUT pins → the
        //     partition. The VCC rail (1) is analog (source + the block's analog VCC pin); the
        //     START net (2) is Boundary (an analog source drives the block's digital START input);
        //     MISO is grounded here (miso_node = 0), so node 6 is untouched → analog. Pure-digital
        //     rows {2, 3, 4}. This exercises the behavioral block end to end across a transaction.
        let mut spi = spi_master(0xA5 as f64, 2.0, 8.0, 0);
        assert_eq!(
            [spi.net_class(3), spi.net_class(4), spi.net_class(5)],
            [1, 1, 1],
            "SPI SCLK/MOSI/CS are pure-digital"
        );
        assert_eq!(spi.net_class(1), 0, "SPI VCC rail is analog");
        assert_eq!(
            spi.net_class(2),
            2,
            "SPI START is Boundary (analog source drives a digital input pin)"
        );
        assert_eq!(spi.digital_rows(), &[2, 3, 4]);
        for _ in 0..40 {
            spi.step();
        }
        assert_eq!(
            spi.digital_rows(),
            &[2, 3, 4],
            "partition fixed across the transaction"
        );

        // (7) Open-drain + pull-up wired-AND bus (the I²C half-bus): two open-drain buffers and a
        //     1 kΩ pull-up all share node 2 (the bus). The pull-up is an analog element, so the
        //     bus is a Boundary net — NOT pure-digital. The open-drain INPUT nets (3, 4) are
        //     Boundary too (an analog source drives each gate's digital input). So there is NO
        //     pure-digital net at all → digital_rows is empty.
        const OD_BUF: f64 = 7.0 + 256.0; // BUF (7) + open-drain bit (256)
        let mut bus = Sim::new(1);
        assert!(bus.set_netlist(
            5,
            &[
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_RESISTOR, // 1 kΩ pull-up: node 2 (bus) -> node 1 (Vcc)
                ELEM_GATE,     // open-drain buffer 1: OUT=2 IN=3
                ELEM_GATE,     // open-drain buffer 2: OUT=2 IN=4
            ],
            &[1, 3, 4, 2, 2, 2],
            &[0, 0, 0, 1, 3, 4],
            &[0, 0, 0, 0, 0, 0],
            &[0, 0, 0, 0, 0, 0],
            &[5.0, 5.0, 0.0, 1000.0, 5.0, 5.0],
            &[0.0, 0.0, 0.0, 0.0, OD_BUF, OD_BUF],
        ));
        assert_eq!(bus.net_class(2), 2, "open-drain + pull-up bus is Boundary");
        assert!(
            bus.digital_rows().is_empty(),
            "the wired-AND bus is Boundary (analog pull-up), so no pure-digital row"
        );
        check(&mut bus, "open-drain + pull-up wired-AND bus");
    }

    /// ADR 0004 phase-3, step 3a — boundary nets (analog ∪ digital) are deliberately EXCLUDED
    /// from `digital_rows`: they stay in the MNA and carry real off-diagonal coupling (that is
    /// where the analog and digital kernels meet), so the frozen-boundary sub-solve must NOT
    /// treat them as part of the decoupled pure-digital block. We assert the two canonical
    /// boundary cases — a comparator OUT loaded by an analog element, and the open-drain +
    /// pull-up bus — are Boundary and absent from `digital_rows`.
    #[test]
    fn digital_partition_excludes_boundary() {
        // (a) Comparator OUT loaded by an analog resistor to ground → OUT is Boundary, excluded.
        //     A powered, transparent comparator: IN+ = node 2 (fixed), IN- = node 3 (fixed), OUT
        //     = node 4 with a 1 kΩ load to ground, so node 4 is touched by a digital pin (OUT)
        //     AND an analog element (the load resistor).
        let mut cmp = Sim::new(1);
        assert!(cmp.set_netlist_pefgh(
            5,
            &[
                ELEM_VSOURCE,  // VCC -> node 1
                ELEM_VSOURCE,  // IN+ -> node 2
                ELEM_VSOURCE,  // IN- -> node 3
                ELEM_RESISTOR, // OUT load: node 4 -> gnd
                ELEM_COMPARATOR,
            ],
            &[1, 2, 3, 4, 4], // a: VCC, IN+ src, IN- src, R, CMP OUT=4
            &[0, 0, 0, 0, 2], // b: …, …, …, R→gnd, CMP IN+=2
            &[0, 0, 0, 0, 3], // c: CMP IN-=3
            &[0, 0, 0, 0, 1], // d: CMP VCC=node1
            &[0, 0, 0, 0, 0], // e: CMP GND=node0
            &[0, 0, 0, 0, 0], // f: CMP LE=node0 (transparent)
            &[],
            &[],
            &[5.0, 3.0, 2.0, 1000.0, 1.0], // IN+ > IN- so OUT drives high into the load
            &[0.0; 5],
            &[],
        ));
        assert_eq!(
            cmp.net_class(4),
            2,
            "comparator OUT shared with an analog resistor is Boundary"
        );
        assert!(
            !cmp.digital_rows().contains(&3),
            "boundary comparator-OUT row (node 4 -> row 3) must be EXCLUDED from digital_rows"
        );
        assert!(
            cmp.digital_rows().is_empty(),
            "this circuit's only digital-touched net (OUT) is Boundary, so digital_rows is empty"
        );
        for _ in 0..8 {
            cmp.step(); // the in-solve diagonal assertion runs against the assembled matrix
        }

        // (b) Open-drain + pull-up wired-AND bus → the bus net is Boundary, excluded. The bus
        //     (node 1) carries two open-drain gate outputs AND a 1 kΩ pull-up resistor (analog).
        const OD_BUF: f64 = 7.0 + 256.0;
        let mut bus = Sim::new(1);
        assert!(bus.set_netlist(
            4,
            &[
                ELEM_VSOURCE,  // Vcc -> node 3 (pull-up rail)
                ELEM_VSOURCE,  // input A -> node 2
                ELEM_RESISTOR, // pull-up: bus(1) -> Vcc(3)
                ELEM_GATE,     // open-drain buffer: OUT=1 (bus), IN=2
            ],
            &[3, 2, 1, 1],
            &[0, 0, 3, 2],
            &[0, 0, 0, 0],
            &[0, 0, 0, 0],
            &[5.0, 5.0, 1000.0, 5.0],
            &[0.0, 0.0, 0.0, OD_BUF],
        ));
        assert_eq!(
            bus.net_class(1),
            2,
            "the open-drain + pull-up I²C-style bus is Boundary (analog pull-up shares it)"
        );
        assert!(
            !bus.digital_rows().contains(&0),
            "boundary bus row (node 1 -> row 0) must be EXCLUDED from digital_rows"
        );
        assert!(
            bus.digital_rows().is_empty(),
            "the bus is Boundary and the input net is analog, so digital_rows is empty"
        );
        for _ in 0..8 {
            bus.step();
        }
    }

    /// [`floating_refs`] identifies exactly the connected components with no galvanic
    /// path to ground and no device-pinned terminal — the topology behind the
    /// per-component `GMIN` (`docs/sim/floating-networks.md`). A grounded circuit yields
    /// an empty list (so the golden is untouched); an isolated transformer secondary
    /// yields its lowest node; a *grounded* secondary yields nothing.
    #[test]
    fn floating_refs_identifies_isolated_subnets() {
        let el = |kind, a, b, c, d, value| Element {
            kind,
            a,
            b,
            c,
            d,
            e: 0,
            f: 0,
            g: 0,
            h: 0,
            value,
            aux: 0.0,
            params: [0.0; PARAM_STRIDE],
        };

        // Fully grounded RC → one (grounded) component → no floating ref.
        let rc = [
            el(ELEM_VSOURCE, 1, 0, 0, 0, 5.0),
            el(ELEM_RESISTOR, 1, 2, 0, 0, 1.0e3),
            el(ELEM_CAPACITOR, 2, 0, 0, 0, 1.0e-6),
        ];
        assert!(
            floating_refs(3, &rc).is_empty(),
            "grounded circuit has no floating reference"
        );

        // Isolated transformer secondary: primary 1-0 grounded, secondary 2-3 floats
        // with a 1k load. The {2,3} component refs its lowest node, node 2.
        let xfmr = [
            el(ELEM_ACSOURCE, 1, 0, 0, 0, 1.0e3),
            el(ELEM_TRANSFORMER, 1, 0, 2, 3, 2.0),
            el(ELEM_RESISTOR, 2, 3, 0, 0, 1.0e3),
        ];
        assert_eq!(
            floating_refs(4, &xfmr),
            vec![2],
            "floating secondary references its lowest node"
        );

        // Same transformer with the secondary tied to ground (d = 0) is NOT floating.
        let grounded_sec = [
            el(ELEM_ACSOURCE, 1, 0, 0, 0, 1.0e3),
            el(ELEM_TRANSFORMER, 1, 0, 2, 0, 2.0),
            el(ELEM_RESISTOR, 2, 0, 0, 0, 1.0e3),
        ];
        assert!(
            floating_refs(3, &grounded_sec).is_empty(),
            "grounded secondary has no floating reference"
        );

        // A MOSFET whose channel floats but whose gate is the device's own pinned
        // terminal: the channel pair {1,2} floats (refs node 1); the gate (node 3) is
        // device-referenced, never floated.
        let fet = [el(ELEM_NMOS, 1, 2, 3, 0, 0.0)];
        assert_eq!(
            floating_refs(4, &fet),
            vec![1],
            "FET channel floats; the GMIN-pinned gate does not"
        );
    }

    /// A **floating** resistive divider — no node touches ground — still solves with a
    /// defined common mode. The single-global-ground model leaves such a subnet's
    /// absolute potential singular; the per-component `GMIN` ([`floating_refs`]) ties it
    /// weakly to ground so the *differential* divider answer is exact and the common
    /// mode is finite (pinned near 0 at the lowest-index node). Part 1 of
    /// `docs/sim/floating-networks.md`.
    #[test]
    fn floating_divider_solves_with_defined_common_mode() {
        // Ground (node 0) is unused: a 10 V source across two equal series resistors,
        // entirely isolated. E0: Vsrc 1->3 = 10 V; E1: R 1->2 = 1k; E2: R 2->3 = 1k.
        let sim = build(
            4,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_RESISTOR],
            &[1, 1, 2],
            &[3, 2, 3],
            &[10.0, 1_000.0, 1_000.0],
        );
        let v = sim.node_voltages();
        assert!(
            v.iter().all(|x| x.is_finite()),
            "floating solve must be finite: {v:?}"
        );
        // The differential divider is exact: each equal resistor drops half the 10 V.
        assert!(
            ((v[1] - v[2]) - 5.0).abs() < 1e-6,
            "top half not 5 V: {v:?}"
        );
        assert!(
            ((v[2] - v[3]) - 5.0).abs() < 1e-6,
            "bottom half not 5 V: {v:?}"
        );
        // Common mode is pinned near 0 at the lowest-index floating node (node 1).
        assert!(v[1].abs() < 1e-3, "common mode not pinned near 0: {v:?}");
    }

    /// A transformer secondary left **floating** — galvanically isolated, no ground tie
    /// — energizes its isolated load and the run reproduces bit-for-bit. The isolated
    /// secondary subnet ({sec+, sec-} = nodes 2, 3) gets a defined common mode from the
    /// per-component `GMIN`; the headline Part-1 win (`docs/sim/floating-networks.md`).
    #[test]
    fn floating_transformer_secondary_is_reproducible() {
        // node 0 = gnd, 1 = AC+/primary+, 2 = secondary+, 3 = secondary-. Primary a=1,
        // b=0; secondary c=2, d=3 with a 1k load 2->3 — neither secondary node touches
        // ground, so {2,3} floats.
        let run = || {
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist(
                4,
                &[ELEM_ACSOURCE, ELEM_TRANSFORMER, ELEM_RESISTOR],
                &[1, 1, 2],
                &[0, 0, 3],
                &[0, 2, 0],
                &[0, 3, 0],
                &[1000.0, 2.0, 1000.0],
                &[5.0, 0.0, 0.0],
            ));
            let (mut lo, mut hi) = (f64::MAX, f64::MIN);
            let mut acc = sim.snapshot_hash();
            for _ in 0..3000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
                let v = sim.node_voltages();
                let load = v[2] - v[3];
                assert!(load.is_finite(), "floating secondary must stay finite");
                lo = lo.min(load);
                hi = hi.max(load);
            }
            (acc, hi - lo)
        };
        let (acc1, swing) = run();
        let (acc2, _) = run();
        assert_eq!(
            acc1, acc2,
            "floating transformer secondary must reproduce exactly"
        );
        // The isolated secondary actually delivers AC to its load (turns ratio 2 on a
        // 5 V peak primary → a multi-volt swing across the 1k load).
        assert!(
            swing > 1.0,
            "isolated secondary should energize its load: {swing}"
        );
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

    /// A **programmable electronic load** in dynamic (load-step) mode: a current sink that
    /// steps between a base and a peak level at a set frequency + duty — the supply
    /// transient/excursion test. A 12 V rail through a 1 Ω source resistance feeds the load;
    /// the load drains node 2 (`ELEM_ISOURCE` a=2, b=0), base 1 A / peak 3 A, 1 kHz, 50 %
    /// duty. The rail must sag further (12 − I·1) when the load steps to its peak.
    #[test]
    fn dynamic_current_load_steps_between_base_and_peak() {
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 3 * PARAM_STRIDE];
        params[2 * PARAM_STRIDE] = 1000.0; // load (elem 2) slot 0 = step frequency (Hz)
        params[2 * PARAM_STRIDE + 3] = 0.5; // slot 3 = duty (peak/excursion fraction)
        assert!(sim.set_netlist_p(
            3,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_ISOURCE],
            &[1, 1, 2], // a: V+, R, load drains node 2
            &[0, 2, 0], // b: V−=gnd, R→node 2, load return=gnd
            &[0, 0, 0],
            &[0, 0, 0],
            &[12.0, 1.0, 1.0], // V = 12, R = 1 Ω, load base = 1 A
            &[0.0, 0.0, 3.0],  // load peak (aux) = 3 A
            &params,
        ));
        // Period = 1/(1000·2µs) = 500 ticks; base for the first half (phase < 0.5), peak
        // after. Sample in the base window (~tick 100) and the peak window (~tick 400).
        for _ in 0..100 {
            sim.step();
        }
        let load_base = sim.element_currents()[2];
        let rail_base = sim.node_voltages()[2];
        for _ in 0..300 {
            sim.step();
        }
        let load_peak = sim.element_currents()[2];
        let rail_peak = sim.node_voltages()[2];
        assert!(
            (load_base - 1.0).abs() < 1e-6,
            "base draw is 1 A: {load_base}"
        );
        assert!(
            (load_peak - 3.0).abs() < 1e-6,
            "peak draw is 3 A: {load_peak}"
        );
        assert!(
            (rail_base - 11.0).abs() < 1e-3,
            "rail sits at 11 V under the 1 A base load: {rail_base}"
        );
        assert!(
            (rail_peak - 9.0).abs() < 1e-3,
            "rail sags to 9 V under the 3 A peak excursion: {rail_peak}"
        );
    }

    /// The dynamic load's tick-driven current is a pure function of the tick, so a run with
    /// a stepping load reproduces bit-for-bit (the new programmable-current path must not
    /// break determinism).
    #[test]
    fn dynamic_current_load_run_is_reproducible() {
        let run = || {
            let mut sim = Sim::new(1);
            let mut params = vec![0.0; 3 * PARAM_STRIDE];
            params[2 * PARAM_STRIDE] = 2500.0; // step frequency
            params[2 * PARAM_STRIDE + 3] = 0.3; // duty
            assert!(sim.set_netlist_p(
                3,
                &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_ISOURCE],
                &[1, 1, 2],
                &[0, 2, 0],
                &[0, 0, 0],
                &[0, 0, 0],
                &[12.0, 2.0, 0.5],
                &[0.0, 0.0, 2.5],
                &params,
            ));
            let mut acc = sim.snapshot_hash();
            for _ in 0..1500 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "a stepping load reproduces exactly");
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

    /// Per-device diode params: the forward saturation current `Is` (param slot 0) sets the
    /// forward drop — a leakier junction (higher `Is`) conducts the same current at a lower
    /// voltage. This is the lever that turns one diode kind into a family (a switching part vs
    /// a power rectifier) and an LED's colour into its forward drop. Slot 0 = the silicon
    /// default, so an untouched diode is unchanged. Layout: source 1->0, R 1->2, diode 2->0.
    #[test]
    fn diode_is_param_sets_forward_drop() {
        let vf = |is: f64| {
            let mut sim = Sim::new(1);
            let mut params = vec![0.0; 3 * PARAM_STRIDE];
            params[2 * PARAM_STRIDE] = is; // element 2 = the diode, slot 0 = Is
            assert!(sim.set_netlist_p(
                3,
                &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_DIODE],
                &[1, 1, 2],
                &[0, 2, 0],
                &[0, 0, 0],
                &[0, 0, 0],
                &[5.0, 47.0, 0.0],
                &[0.0, 0.0, 0.0],
                &params,
            ));
            sim.node_voltages()[2]
        };
        let vf_default = vf(DIODE_IS); // the silicon default Is
        let vf_leaky = vf(1.0e-7); // a much leakier junction → lower drop
        assert!(
            vf_leaky < vf_default - 0.1,
            "a higher Is lowers the forward drop: default → {vf_default}, leaky → {vf_leaky}"
        );
    }

    /// A part driven past its **rated current** FAILs (the renderer boxes it). The rating
    /// lives in the general [`RATED_CURRENT_SLOT`]; `0` (the default, and every Ideal-mode
    /// part) is unrated, so an untouched circuit never trips and the golden is untouched. A
    /// ~0.44 A forward diode: a 1 A part is fine, a 0.1 A part is over-rated. Layout: source
    /// 1->0 (5 V), R 1->2 (10 Ω), diode 2->0.
    #[test]
    fn diode_over_rated_current_flags_fail() {
        let run_with_rating = |rated: f64| {
            let mut sim = Sim::new(1);
            let mut params = vec![0.0; 3 * PARAM_STRIDE];
            params[2 * PARAM_STRIDE + RATED_CURRENT_SLOT] = rated; // diode (elem 2) rated current
            assert!(sim.set_netlist_p(
                3,
                &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_DIODE],
                &[1, 1, 2],
                &[0, 2, 0],
                &[0, 0, 0],
                &[0, 0, 0],
                &[5.0, 10.0, 0.0],
                &[0.0, 0.0, 0.0],
                &params,
            ));
            sim.step();
            (sim.failed(), sim.failed_element_mask())
        };
        let (within, _) = run_with_rating(1.0);
        assert!(!within, "a diode within its current rating does not FAIL");
        let (over, mask) = run_with_rating(0.1);
        assert!(over, "a diode driven past its current rating FAILs");
        assert_eq!(mask[2], 1, "the offending diode (element 2) is boxed");
        // An UNrated diode (slot 0) carries the same current without FAILing — the rating is
        // opt-in, so Ideal mode (no rating installed) never trips.
        let (unrated, _) = run_with_rating(0.0);
        assert!(!unrated, "an unrated diode never trips the rating FAIL");
    }

    /// An LED's COLOUR rides on its forward saturation current `Is` (param slot 0): a
    /// wider-bandgap colour (blue/white) has a far smaller `Is`, so it drops more. Even the
    /// extreme small-`Is` blue value converges to a finite operating point and conducts — the
    /// pn-junction limiting keeps Newton well behaved at any colour. Layout: source 1->0 (5 V),
    /// R 1->2 (150 Ω), LED 2->0.
    #[test]
    fn led_colour_is_sets_higher_forward_drop() {
        let op = |is: f64| {
            let mut sim = Sim::new(1);
            let mut params = vec![0.0; 3 * PARAM_STRIDE];
            params[2 * PARAM_STRIDE] = is; // LED (element 2) slot 0 = Is; slot 1 (n) → LED default
            assert!(sim.set_netlist_p(
                3,
                &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_LED],
                &[1, 1, 2],
                &[0, 2, 0],
                &[0, 0, 0],
                &[0, 0, 0],
                &[5.0, 150.0, 0.0],
                &[0.0, 0.0, 0.0],
                &params,
            ));
            (sim.node_voltages()[2], sim.element_currents()[2])
        };
        let (vf_red, i_red) = op(1.0e-18); // the LED default — red (~1.9 V)
        let (vf_blue, i_blue) = op(8.7e-27); // blue (~2.9 V)
        assert!(
            vf_red.is_finite() && vf_blue.is_finite(),
            "both colours converge to a finite operating point"
        );
        assert!(i_red > 0.0 && i_blue > 0.0, "both LEDs conduct forward");
        assert!(
            vf_blue > vf_red + 0.6,
            "a blue LED drops well above red: red={vf_red}, blue={vf_blue}"
        );
    }

    /// Reverse recovery (transit-time param, slot 3): a bipolar sine drives a diode through a
    /// series inductor (the freewheel / bridge-rectifier case — the inductor keeps current
    /// flowing into the diode as the source reverses, so the diode is switched off under load).
    /// A diode with `TT > 0` stores diffusion charge `q = TT·I` while forward, and when forced
    /// off it sweeps that charge out as a pronounced **reverse** current — so it conducts in
    /// reverse far harder than an ideal (`TT = 0`) diode, which blocks at the current zero.
    /// Layout: AC source 1->0, L 1->2, diode 2->0.
    #[test]
    fn diode_reverse_recovery_sources_reverse_current() {
        let reverse_dip = |tt: f64| {
            let mut sim = Sim::new(1);
            let mut params = vec![0.0; 3 * PARAM_STRIDE];
            params[2 * PARAM_STRIDE + DIODE_TT_SLOT] = tt; // diode (element 2): transit time
            assert!(sim.set_netlist_p(
                3,
                &[ELEM_ACSOURCE, ELEM_INDUCTOR, ELEM_DIODE],
                &[1, 1, 2],
                &[0, 2, 0],
                &[0, 0, 0],
                &[0, 0, 0],
                &[2000.0, 1.0e-3, 0.0], // 2 kHz sine; 1 mH series inductor
                &[10.0, 0.0, 0.0],      // source amplitude 10 V
                &params,
            ));
            let mut rev_dip = f64::INFINITY;
            for _ in 0..600 {
                sim.step();
                rev_dip = rev_dip.min(sim.element_currents()[2]);
            }
            rev_dip
        };
        let rr_dip = reverse_dip(6.0e-6); // a slow rectifier — stores charge
        let ideal_dip = reverse_dip(0.0); // ideal diode — no stored charge
                                          // The ideal diode blocks at the current zero (only the ~pA saturation leakage flows
                                          // backward); the recovery diode is driven tens of mA into reverse as its charge sweeps
                                          // out — orders of magnitude deeper, the hallmark of reverse recovery.
        assert!(
            ideal_dip > -1.0e-6,
            "an ideal diode barely conducts in reverse: {ideal_dip}"
        );
        assert!(
            rr_dip < ideal_dip - 0.02,
            "reverse recovery drives a real reverse current: recovery={rr_dip}, ideal={ideal_dip}"
        );
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
        // Receiver (quantise): the half-rail threshold, at any rail, with NO forbidden
        // band (v_il == v_ih) so it is exactly the old two-state decision.
        assert_eq!(fam.quantize(3.0, 5.0), Level::High); // 3 V > 2.5 V
        assert_eq!(fam.quantize(2.0, 5.0), Level::Low); // 2 V < 2.5 V
        assert_eq!(fam.quantize(2.5, 5.0), Level::Low); // exactly half-rail is not "above"
                                                        // Driver: rail high, ground low, both through GATE_GOUT; Z releases.
        assert_eq!(fam.drive_level(Level::High, 5.0), Some((5.0, GATE_GOUT)));
        assert_eq!(fam.drive_level(Level::Low, 5.0), Some((0.0, GATE_GOUT)));
        assert_eq!(fam.drive_level(Level::Z, 5.0), None);
        // End to end: the four-state gate logic maps {Low, High} inputs to {Low, High}
        // exactly like the original boolean truth table.
        assert_eq!(gate_logic_level(0.0, Level::High, Level::High), Level::High); // AND(1,1)
        assert_eq!(gate_logic_level(0.0, Level::High, Level::Low), Level::Low); // AND(1,0)
        assert_eq!(gate_logic_level(1.0, Level::Low, Level::High), Level::High); // OR(0,1)
                                                                                 // X propagates per the IEEE four-state tables.
        assert_eq!(gate_logic_level(0.0, Level::Low, Level::X), Level::Low); // AND(0,X)=0
        assert_eq!(gate_logic_level(0.0, Level::High, Level::X), Level::X); // AND(1,X)=X
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
    fn gate_imply_nimply_truth_tables() {
        // code 8 = IMPLY (A → B = ¬A ∨ B): high everywhere EXCEPT A=1, B=0.
        assert!(gate_out(8.0, false, false) > 4.0); // ¬0 ∨ 0 = 1
        assert!(gate_out(8.0, false, true) > 4.0); // ¬0 ∨ 1 = 1
        assert!(gate_out(8.0, true, false) < 1.0); // ¬1 ∨ 0 = 0  (the only low)
        assert!(gate_out(8.0, true, true) > 4.0); // ¬1 ∨ 1 = 1
                                                  // code 9 = NIMPLY (A ↛ B = A ∧ ¬B): high ONLY at A=1, B=0.
        assert!(gate_out(9.0, false, false) < 1.0); // 0 ∧ ¬0 = 0
        assert!(gate_out(9.0, false, true) < 1.0); // 0 ∧ ¬1 = 0
        assert!(gate_out(9.0, true, false) > 4.0); // 1 ∧ ¬0 = 1  (the only high)
        assert!(gate_out(9.0, true, true) < 1.0); // 1 ∧ ¬1 = 0
                                                  // X propagates per the four-state tables: B=1 forces IMPLY high whatever A is; an
                                                  // X on the deciding input leaves the output X.
        assert_eq!(gate_logic_level(8.0, Level::X, Level::High), Level::High); // ¬X ∨ 1 = 1
        assert_eq!(gate_logic_level(8.0, Level::High, Level::X), Level::X); // ¬1 ∨ X = X
        assert_eq!(gate_logic_level(9.0, Level::Low, Level::X), Level::Low); // 0 ∧ ¬X = 0
        assert_eq!(gate_logic_level(9.0, Level::High, Level::X), Level::X); // 1 ∧ ¬X = X
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

    /// A ring of inverters (a feedback loop of gates) **oscillates** rather than
    /// deadlocking — the whole point of the one-tick-delay model (no fixpoint, no
    /// hang). A 3-inverter ring (G1 out=1 in=3, G2 out=2 in=1, G3 out=3 in=2) is a
    /// purely digital circuit; its nodes must swing between logic high and low over
    /// the run, and stay finite.
    #[test]
    fn gate_ring_oscillator_oscillates() {
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            4,
            &[ELEM_GATE, ELEM_GATE, ELEM_GATE],
            &[1, 2, 3],
            &[3, 1, 2],
            &[0, 0, 0],
            &[0, 0, 0],
            &[5.0, 5.0, 5.0],
            &[6.0, 6.0, 6.0], // NOT, NOT, NOT
        ));
        let (mut lo, mut hi) = (f64::MAX, f64::MIN);
        for _ in 0..40 {
            sim.step();
            let v = sim.state()[1];
            assert!(v.is_finite(), "ring oscillator stays finite");
            lo = lo.min(v);
            hi = hi.max(v);
        }
        assert!(
            hi > 4.0 && lo < 1.0,
            "the ring oscillates between logic levels (lo {lo}, hi {hi}), not stuck"
        );
    }

    /// Two gate outputs on one net **resolve** instead of fighting in the matrix
    /// (`docs/ui/logic-analog-digital-nets.md` §7.6): agreeing drivers give that level,
    /// disagreeing strong drivers conflict to `X`, which the driver presents as a
    /// mid-rail voltage. Both inputs (nodes 2, 3) float low.
    #[test]
    fn gate_multi_driver_resolves() {
        // Agreement: two NOT gates both drive node 1 from a low (floating) input -> both
        // High -> net resolves High (~5 V).
        let mut agree = Sim::new(1);
        assert!(agree.set_netlist(
            4,
            &[ELEM_GATE, ELEM_GATE],
            &[1, 1],
            &[2, 3],
            &[0, 0],
            &[0, 0],
            &[5.0, 5.0],
            &[6.0, 6.0], // NOT, NOT
        ));
        for _ in 0..5 {
            agree.step();
        }
        assert!(
            agree.state()[1] > 4.0,
            "two agreeing High drivers resolve High: {}",
            agree.state()[1]
        );

        // Conflict: a NOT (-> High) and a BUF (-> Low) both drive node 1 -> X -> mid-rail.
        let mut conflict = Sim::new(1);
        assert!(conflict.set_netlist(
            4,
            &[ELEM_GATE, ELEM_GATE],
            &[1, 1],
            &[2, 3],
            &[0, 0],
            &[0, 0],
            &[5.0, 5.0],
            &[6.0, 7.0], // NOT (-> High), BUF (-> Low)
        ));
        for _ in 0..5 {
            conflict.step();
        }
        let v = conflict.state()[1];
        assert!(
            (1.5..=3.5).contains(&v),
            "two disagreeing drivers conflict to X -> mid-rail (~2.5 V): {v}"
        );
    }

    /// Real logic families (selected via the upper bits of `aux`, `func + 16*family`)
    /// give honest levels and the mixed-rail "your high is too low" lesson
    /// (`docs/ui/logic-analog-digital-nets.md` §7.5). Family 1 = CMOS (V_OH = 0.95*rail,
    /// V_IL = 0.3*rail). Family 0 = LEGACY drives to the full rail, so a non-rail output
    /// proves the family is active.
    #[test]
    fn gate_family_levels_and_mixed_rail() {
        // CMOS NOT at a 5 V rail: input floats low -> output High at V_OH = 0.95*5 =
        // 4.75 V (NOT the full 5 V a LEGACY gate would drive — proof the family is live).
        let mut cmos = Sim::new(1);
        assert!(cmos.set_netlist(
            3,
            &[ELEM_GATE],
            &[1],
            &[2],
            &[0],
            &[0],
            &[5.0],
            &[6.0 + 16.0], // NOT (func 6) + family 1 (CMOS)
        ));
        for _ in 0..5 {
            cmos.step();
        }
        let voh = cmos.state()[1];
        assert!(
            (4.5..4.95).contains(&voh),
            "CMOS drives V_OH ~ 0.95*rail (4.75 V), not the full rail: {voh}"
        );

        // Mixed-rail: a CMOS NOT on a 1.8 V rail (output High = 0.95*1.8 = 1.71 V) feeds
        // a CMOS BUF on a 12 V rail (V_IL = 0.3*12 = 3.6 V). 1.71 V < 3.6 V, so the high
        // is *lost* — the 12 V gate reads it LOW and drives its output low. The classic
        // "you need a level shifter" failure.
        let mut mixed = Sim::new(1);
        assert!(mixed.set_netlist(
            4,
            &[ELEM_GATE, ELEM_GATE],
            &[1, 3],
            &[2, 1],
            &[0, 0],
            &[0, 0],
            &[1.8, 12.0],
            &[6.0 + 16.0, 7.0 + 16.0], // NOT@1.8V CMOS, BUF@12V CMOS
        ));
        for _ in 0..6 {
            mixed.step();
        }
        let lo_high = mixed.state()[1];
        let lost = mixed.state()[3];
        assert!(
            (1.5..1.9).contains(&lo_high),
            "the 1.8 V CMOS high is ~1.71 V: {lo_high}"
        );
        assert!(
            lost < 2.0,
            "the 1.8 V high is below the 12 V part's V_IL, so it reads LOW (high lost): {lost}"
        );
    }

    /// Open-drain outputs (aux bit 8) sharing a net with a pull-up resistor form a
    /// **wired-AND bus** (`docs/ui/logic-analog-digital-nets.md` §7.6): each open-drain
    /// buffer pulls the bus low when its input is low but RELEASES (high-Z) when high,
    /// so the bus is low if any driver pulls and is pulled high by the resistor only
    /// when all release. Result: bus = A AND B. This is the I²C / open-collector idiom,
    /// resolved by the analog solve (no fight).
    #[test]
    fn gate_open_drain_wired_and_bus() {
        const OD_BUF: f64 = 7.0 + 256.0; // BUF function (7), open-drain bit (256)
                                         // nodes: 0 gnd, 1 Vcc, 2 bus, 3 inA, 4 inB. Two open-drain buffers drive the bus
                                         // from their inputs; a 1 k pull-up ties the bus to the 5 V rail.
        let bus = |a_high: bool, b_high: bool| -> Vec<f64> {
            let va = if a_high { 5.0 } else { 0.0 };
            let vb = if b_high { 5.0 } else { 0.0 };
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist(
                5,
                &[
                    ELEM_VSOURCE,
                    ELEM_VSOURCE,
                    ELEM_VSOURCE,
                    ELEM_RESISTOR,
                    ELEM_GATE,
                    ELEM_GATE,
                ],
                &[1, 3, 4, 2, 2, 2], // a
                &[0, 0, 0, 1, 3, 4], // b
                &[0, 0, 0, 0, 0, 0], // c
                &[0, 0, 0, 0, 0, 0], // d
                &[5.0, va, vb, 1000.0, 5.0, 5.0],
                &[0.0, 0.0, 0.0, 0.0, OD_BUF, OD_BUF],
            ));
            for _ in 0..10 {
                sim.step();
            }
            sim.state()
        };
        // All release only when both inputs are high -> the pull-up takes the bus high.
        assert!(
            bus(true, true)[2] > 4.0,
            "both high: both release, pull-up takes the bus high"
        );
        // Any low driver pulls the bus low (wired-AND) -- the 1 ohm pull dominates the 1 k pull-up.
        assert!(bus(true, false)[2] < 1.0, "one low: bus pulled low");
        assert!(bus(false, true)[2] < 1.0, "one low: bus pulled low");
        assert!(bus(false, false)[2] < 1.0, "both low: bus low");
    }

    /// A **powered** logic gate (VCC on terminal `d`, GND on terminal `e`) takes its rail
    /// from the supply pins, not `value`: a NOT IC on a 5 V supply inverts its input and
    /// swings its output between the pins. nodes: 0 gnd, 1 VCC (5 V), 2 IN, 3 OUT.
    #[test]
    fn powered_gate_inverter_swings_between_supply_pins() {
        let invert = |vin: f64| -> f64 {
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist_pe(
                4,
                &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_GATE],
                &[1, 2, 3], // a: VCC source, input source, gate OUT
                &[0, 0, 2], // b: …, …, gate IN1
                &[0, 0, 0], // c: gate IN2 unused
                &[0, 0, 1], // d: gate VCC pin -> node 1
                &[0, 0, 0], // e: gate GND pin -> node 0 (ground)
                &[5.0, vin, 0.0],
                &[0.0, 0.0, 6.0], // gate func 6 = NOT
                &[],
            ));
            for _ in 0..8 {
                sim.step();
            }
            sim.state()[3]
        };
        assert!(
            invert(0.0) > 4.5,
            "input low -> output high near VCC: {}",
            invert(0.0)
        );
        assert!(
            invert(5.0) < 0.5,
            "input high -> output low near GND: {}",
            invert(5.0)
        );
    }

    /// An **unpowered** gate sits dead. Same inverter, but the VCC pin (node 1) is wired
    /// to nothing, so its node floats to ~0 V: the rail is below the operating minimum and
    /// the IC releases its output. A low input would normally drive the output HIGH; here
    /// it stays low (never driven), the "you forgot to power the chip" case.
    #[test]
    fn powered_gate_with_unwired_vcc_is_dead() {
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist_pe(
            4,
            &[ELEM_VSOURCE, ELEM_GATE],
            &[2, 3],     // a: input source on node 2; gate OUT on node 3
            &[0, 2],     // b
            &[0, 0],     // c
            &[0, 1],     // d: VCC -> node 1 (floating, no source)
            &[0, 0],     // e: GND -> node 0
            &[0.0, 0.0], // input = 0 (low)
            &[0.0, 6.0], // NOT
            &[],
        ));
        for _ in 0..8 {
            sim.step();
        }
        let out = sim.state()[3];
        assert!(
            out < 0.5,
            "unpowered gate releases its output (stays dead), not driven high: {out}"
        );
    }

    /// A powered **two-input** gate exercises all five terminals (a=OUT, b=A, c=B, d=VCC,
    /// e=GND). A NAND IC on a 5 V supply: out = NOT(A AND B). nodes: 0 gnd, 1 VCC, 2 A,
    /// 3 B, 4 OUT.
    #[test]
    fn powered_gate_two_input_nand_uses_fifth_terminal() {
        let nand = |a_hi: bool, b_hi: bool| -> f64 {
            let va = if a_hi { 5.0 } else { 0.0 };
            let vb = if b_hi { 5.0 } else { 0.0 };
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist_pe(
                5,
                &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_VSOURCE, ELEM_GATE],
                &[1, 2, 3, 4], // a
                &[0, 0, 0, 2], // b: gate IN1 = A
                &[0, 0, 0, 3], // c: gate IN2 = B
                &[0, 0, 0, 1], // d: VCC
                &[0, 0, 0, 0], // e: GND (ground)
                &[5.0, va, vb, 0.0],
                &[0.0, 0.0, 0.0, 2.0], // func 2 = NAND
                &[],
            ));
            for _ in 0..8 {
                sim.step();
            }
            sim.state()[4]
        };
        assert!(
            nand(true, true) < 0.5,
            "A&B high -> NAND low: {}",
            nand(true, true)
        );
        assert!(
            nand(true, false) > 4.5,
            "one low -> NAND high: {}",
            nand(true, false)
        );
        assert!(
            nand(false, false) > 4.5,
            "both low -> NAND high: {}",
            nand(false, false)
        );
    }

    /// The gate's GND pin need not be circuit ground. Here it sits at 2 V and VCC at 7 V,
    /// so the 5 V rail floats on a 2 V pedestal: a powered NOT swings its output between
    /// 2 V (its GND) and 7 V (its VCC) and thresholds inputs relative to 2 V — the GND
    /// offset (`digital_vlow`) at work. nodes: 0 gnd, 1 VCC=7, 2 GNDref=2, 3 IN, 4 OUT.
    #[test]
    fn powered_gate_offset_ground_shifts_output_window() {
        let invert = |vin: f64| -> f64 {
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist_pe(
                5,
                &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_VSOURCE, ELEM_GATE],
                &[1, 2, 3, 4], // a
                &[0, 0, 0, 3], // b: gate IN
                &[0, 0, 0, 0], // c
                &[0, 0, 0, 1], // d: VCC -> node 1 (7 V)
                &[0, 0, 0, 2], // e: GND -> node 2 (2 V pedestal)
                &[7.0, 2.0, vin, 0.0],
                &[0.0, 0.0, 0.0, 6.0], // NOT
                &[],
            ));
            for _ in 0..8 {
                sim.step();
            }
            sim.state()[4]
        };
        // Input at the gate's own GND (2 V = a logic low) -> output HIGH = VCC (7 V).
        let out_lo = invert(2.0);
        assert!(
            (6.5..7.2).contains(&out_lo),
            "low input -> output rises to VCC (7 V): {out_lo}"
        );
        // Input at VCC (7 V = a logic high) -> output LOW = the gate's GND (2 V).
        let out_hi = invert(7.0);
        assert!(
            (1.8..2.5).contains(&out_hi),
            "high input -> output falls to the gate's GND (2 V): {out_hi}"
        );
    }

    /// A **level shifter** (type 20) reads its input at the input rail (`value`) and
    /// re-drives the output at the output rail (`aux`): it translates a logic high
    /// across rails — the part that lets a 1.8 V signal drive a 5 V part cleanly, and a
    /// 5 V signal drive a 1.8 V part.
    #[test]
    fn level_shifter_translates_rails() {
        // nodes: 0 gnd, 1 = input (driven), 2 = shifted output.
        let shift = |rail_a: f64, rail_b: f64, in_high: bool| -> f64 {
            let vin = if in_high { rail_a } else { 0.0 };
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist(
                3,
                &[ELEM_VSOURCE, ELEM_LEVELSHIFT],
                &[1, 2], // a: Vsrc node 1, shifter OUT node 2
                &[0, 1], // b: Vsrc gnd, shifter IN node 1
                &[0, 0],
                &[0, 0],
                &[vin, rail_a], // values: Vsrc EMF, shifter input rail A
                &[0.0, rail_b], // aux: -, shifter output rail B
            ));
            for _ in 0..6 {
                sim.step();
            }
            sim.state()[2]
        };
        // Up-shift 1.8 V -> 5 V: a 1.8 V high becomes a clean 5 V high; low stays low.
        assert!(
            shift(1.8, 5.0, true) > 4.5,
            "up-shift: 1.8 V high -> ~5 V: {}",
            shift(1.8, 5.0, true)
        );
        assert!(
            shift(1.8, 5.0, false) < 0.5,
            "low stays low across the shift"
        );
        // Down-shift 5 V -> 1.8 V: a 5 V high becomes a 1.8 V high.
        let down = shift(5.0, 1.8, true);
        assert!(
            (1.5..1.9).contains(&down),
            "down-shift: 5 V high -> ~1.8 V: {down}"
        );
    }

    /// A **pull-up** (type 21) takes its net to Vcc (`value`) through a fixed resistance
    /// when nothing else drives it, but a stiff open-drain low wins — the pull-up half of
    /// the wired-AND bus, using the dedicated part.
    #[test]
    fn pullup_takes_net_to_vcc_unless_pulled() {
        const OD_BUF: f64 = 7.0 + 256.0; // open-drain buffer
                                         // nodes: 0 gnd, 1 = bus (pull-up + open-drain buffer), 2 = buffer input.
        let run = |in_high: bool| -> f64 {
            let vin = if in_high { 5.0 } else { 0.0 };
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist(
                3,
                &[ELEM_PULLUP, ELEM_VSOURCE, ELEM_GATE],
                &[1, 2, 1], // a: pull-up bus, Vsrc node 2, OD-buf OUT bus
                &[0, 0, 2], // b: -, Vsrc gnd, OD-buf IN node 2
                &[0, 0, 0],
                &[0, 0, 0],
                &[5.0, vin, 5.0],
                &[0.0, 0.0, OD_BUF],
            ));
            for _ in 0..10 {
                sim.step();
            }
            sim.state()[1]
        };
        // High input -> open-drain releases -> the pull-up takes the bus to ~5 V.
        assert!(run(true) > 4.0, "released: pull-up takes the bus to Vcc");
        // Low input -> open-drain pulls low -> the stiff low beats the 4.7 k pull-up.
        assert!(run(false) < 1.0, "open-drain low wins over the pull-up");
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

    /// Galvanic isolation: the ONLY ground is on the rectified output, so the AC
    /// source + transformer primary form a FLOATING loop with no DC path to gnd.
    /// The shipping `bridge_rectifier_run` shares gnd between primary and secondary,
    /// so it never exercises a floating primary common-mode — held only by the
    /// per-winding `GMIN` floor. This guards that case: the bridge must still
    /// rectify to a sane DC and the current must stay bounded. (The retired
    /// coupled-inductor model's near-singular `1/(1-k²)` matrix blew this exact
    /// topology up to ~1e118 A — the tell-tale of a stale, pre-ideal-T build.)
    #[test]
    fn transformer_bridge_isolated_primary_stays_bounded() {
        let amp = 12.0;
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            6, // 0=gnd(out-), 1=pri+, 5=pri-(floating), 2=sec+, 3=sec-, 4=out+
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
            &[5, 5, 4, 4, 2, 3, 0, 0], // b  (AC- and primary- on floating node 5)
            &[0, 2, 0, 0, 0, 0, 0, 0], // c
            &[0, 3, 0, 0, 0, 0, 0, 0], // d
            &[60.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0e-4, 1000.0],
            &[amp, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        ));
        let mut out_hi = f64::MIN;
        let mut i_peak = 0.0f64;
        for tk in 0..75_000 {
            sim.step();
            if tk >= 62_000 {
                let v = sim.state();
                out_hi = out_hi.max(v[4]);
                let ic = sim.element_currents();
                for k in 0..4 {
                    i_peak = i_peak.max(ic[2 + k].abs());
                }
            }
        }
        assert!(
            i_peak.is_finite() && i_peak < 20.0,
            "isolated-primary bridge current ran away (peak {i_peak} A)"
        );
        assert!(
            out_hi > 6.0 && out_hi < 12.0,
            "isolated-primary bridge output not a sane rectified DC (hi {out_hi} V)"
        );
    }

    /// The shipped `tr-bridge-supply` example EXACTLY (AC 1 kHz / 5 V peak, 100 µF
    /// reservoir, 1 kΩ load), swept across the UI's turns-ratio chips — including the
    /// step-ups (1:2, 1:4). At high step-up the secondary EMF charges an *empty* cap
    /// through the bridge, and a zero-impedance hard secondary drives that as a near-
    /// impulse: a stiff, ill-conditioned solve that stayed bounded in native but blew
    /// up to ~61 kA on wasm (a real user report). The [`TRANSFORMER_LLEAK`] leakage
    /// companion conditions the secondary row and limits its di/dt, so the inrush is a
    /// sane few amps and bounded on every platform. (The earlier 60 Hz / n≤2 bridge
    /// tests never exercised this corner — the regression hid above them.)
    #[test]
    fn transformer_bridge_high_stepup_inrush_bounded() {
        for &n in &[0.25_f64, 0.5, 1.0, 2.0, 4.0] {
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
                &[1, 1, 2, 3, 0, 0, 4, 4],
                &[0, 0, 4, 4, 2, 3, 0, 0],
                &[0, 2, 0, 0, 0, 0, 0, 0],
                &[0, 3, 0, 0, 0, 0, 0, 0],
                &[1000.0, n, 0.0, 0.0, 0.0, 0.0, 100.0e-6, 1000.0],
                &[5.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            ));
            let mut ipri = 0.0f64;
            let mut out_hi = f64::MIN;
            for tk in 0..40_000 {
                sim.step();
                ipri = ipri.max(sim.element_currents()[1].abs());
                if tk >= 30_000 {
                    out_hi = out_hi.max(sim.state()[4]);
                }
            }
            // No inrush runaway on any platform (the bug peaked at tens of A in native,
            // ~61 kA on wasm; the leakage companion holds it to a sane few amps).
            assert!(
                ipri.is_finite() && ipri < 20.0,
                "n={n}: primary inrush ran away (peak {ipri} A)"
            );
            // Still rectifies to a sane positive DC that scales up with the turns ratio.
            assert!(
                out_hi > 0.0 && out_hi < 5.0 * n + 1.0,
                "n={n}: bridge output not a sane rectified DC (hi {out_hi} V)"
            );
        }
    }

    /// An ideal voltage source forcing forward bias across a diode with NO series
    /// resistance drives an unbounded current — the "ideal, zero-impedance" condition
    /// the owner wants to read as a failure rather than a crash. The engine must raise
    /// the FAIL flag, mark the diode, and clamp every reading finite (never a NaN).
    #[test]
    fn ideal_source_into_bare_diode_fails_bounded() {
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            2,
            &[ELEM_VSOURCE, ELEM_DIODE],
            &[1, 1], // a: source+, diode anode
            &[0, 0], // b: gnd, diode cathode
            &[0, 0],
            &[0, 0],
            &[10.0, 0.0], // 10 V hard across the junction -> unbounded current
            &[0.0, 0.0],
        ));
        for _ in 0..16 {
            sim.step();
        }
        assert!(sim.failed(), "ideal source across a bare diode should FAIL");
        for &v in sim.state().iter() {
            assert!(v.is_finite(), "node voltage went non-finite: {v}");
        }
        for &i in sim.element_currents().iter() {
            assert!(
                i.is_finite() && i.abs() <= FAIL_LIMIT,
                "current not clamped: {i}"
            );
        }
        // The diode (element 1) is flagged as an offending part.
        assert_eq!(sim.failed_element_mask().get(1).copied(), Some(1u8));
    }

    /// A well-behaved resistive loop never trips FAIL — so the flag stays off for every
    /// normal circuit and the golden / snapshot hash are untouched.
    #[test]
    fn well_behaved_circuit_does_not_fail() {
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            2,
            &[ELEM_VSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[0, 0],
            &[0, 0],
            &[5.0, 1000.0],
            &[0.0, 0.0],
        ));
        for _ in 0..16 {
            sim.step();
        }
        assert!(!sim.failed(), "a 5 V / 1 kΩ loop must not FAIL");
        assert!(sim.failed_element_mask().iter().all(|&b| b == 0));
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

    /// The flip-flop's sequential state (`ff_q` + `ff_clk_prev`) now enters the snapshot
    /// hash, so two fresh runs of a clocked flip-flop must agree on the hash at **every**
    /// tick — including the exact ticks where a clock edge latches. This is the
    /// per-tick lockstep replay guarantee (the keyframe/rewind contract): a divergence
    /// at any single edge tick would show here even though the XOR-fold above might mask
    /// it. The switch clocks the flip-flop across many edges over the run.
    #[test]
    fn dff_clocked_replay_is_lockstep() {
        let build = || {
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
            sim
        };
        let (mut a, mut b) = (build(), build());
        for tk in 0..600 {
            a.step();
            b.step();
            assert_eq!(
                a.snapshot_hash(),
                b.snapshot_hash(),
                "clocked flip-flop diverged at tick {tk} (sequential state must be hashed)"
            );
        }
    }

    // --- Clocked sampler (1-bit comparator, ELEM_SAMPLER = 22) -----------------
    //
    // A near-twin of the D flip-flop whose data input is a continuous analog node:
    // on each rising clock edge it latches OUT = High iff V(IN) > threshold (`value`),
    // else Low, and holds between edges (a one-tick-delayed digital output). It is the
    // keystone atom of the ADC / sample-and-hold / SAR cluster. Like the flip-flop it
    // is a constant within-tick stamp (no Newton) and keeps hashed sequential state.

    /// Build a sampler with a DC source holding IN at `in_v`, a PWM-switch clock on CLK,
    /// and the given `threshold` (its `value`), then run several clock periods and return
    /// the settled OUT voltage. Nodes: 0 = gnd, 1 = IN, 2 = CLK, 3 = OUT, 4 = clock rail.
    /// The switch chops the 5 V rail onto the pulled-down CLK node, so CLK is a clean
    /// 0/5 V square wave (rising edges every SWITCH_PERIOD_TICKS); IN is held, so after a
    /// few edges OUT settles to the comparison of IN against the threshold.
    fn sampler_clocked(in_v: f64, threshold: f64) -> f64 {
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            5,
            &[
                ELEM_VSOURCE,  // IN held at in_v (node 1)
                ELEM_VSOURCE,  // clock rail at 5 V (node 4)
                ELEM_SWITCH,   // chops node 4 onto CLK (node 2), 50% duty
                ELEM_RESISTOR, // pull-down on CLK so it falls between switch-on windows
                ELEM_SAMPLER   // OUT=3, IN=1, CLK=2
            ],
            &[1, 4, 4, 2, 3],
            &[0, 0, 2, 0, 1],
            &[0, 0, 0, 0, 2], // sampler c = CLK = node 2
            &[0, 0, 0, 0, 0], // sampler d unused (ground)
            &[in_v, 5.0, 0.5, 1000.0, threshold],
            &[0.0; 5], // sampler aux = 0 -> default 5 V output rail
        ));
        for _ in 0..500 {
            sim.step();
        }
        sim.state()[3]
    }

    /// On the clock edge the sampler latches its analog input against the threshold and
    /// presents the result on OUT, holding it until the next edge. With IN above the
    /// threshold OUT drives high; below, it drives low.
    #[test]
    fn sampler_latches_comparison_and_holds() {
        // IN = 3 V, threshold = 2 V -> above -> OUT high.
        let out_hi = sampler_clocked(3.0, 2.0);
        assert!(
            out_hi > 4.0,
            "OUT high when IN ({}) > threshold: {out_hi}",
            3.0
        );
        // IN = 1 V, threshold = 2 V -> below -> OUT low.
        let out_lo = sampler_clocked(1.0, 2.0);
        assert!(
            out_lo < 1.0,
            "OUT low when IN ({}) < threshold: {out_lo}",
            1.0
        );
        // Same input, threshold moved across it flips the decision (the comparator axis).
        let flipped = sampler_clocked(3.0, 4.0);
        assert!(
            flipped < 1.0,
            "OUT low when threshold (4) rises above the same IN (3): {flipped}"
        );
    }

    /// The sampler output is a one-tick-delayed, hold-until-next-edge latch — it changes
    /// ONLY on a rising clock edge. With the clock held LOW (no edge ever fires) the output
    /// stays at its reset Low even though IN sits well above the threshold: proof the output
    /// follows the latched bit, not the live comparison.
    #[test]
    fn sampler_holds_low_without_a_clock_edge() {
        // Nodes: 0 = gnd, 1 = IN (held at 4 V), 2 = CLK (held LOW at 0 V), 3 = OUT.
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist(
            4,
            &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_SAMPLER],
            &[1, 2, 3],
            &[0, 0, 1],
            &[0, 0, 2], // sampler c = CLK = node 2
            &[0, 0, 0],
            &[4.0, 0.0, 2.5], // IN = 4 V (> threshold), CLK = 0 V, threshold = 2.5 V
            &[0.0; 3],
        ));
        for tk in 0..100 {
            sim.step();
            assert!(
                sim.state()[3] < 1.0,
                "with CLK never rising, OUT must hold its reset Low despite IN>threshold \
                 (tick {tk}, got {})",
                sim.state()[3]
            );
        }
    }

    /// A one-tick-delayed, hold-until-next-edge latch under a real clock: once an edge
    /// latches OUT High (IN above threshold), OUT must stay High across the following ticks
    /// — including the next edge, since IN is unchanged — never glitching low mid-period.
    #[test]
    fn sampler_holds_between_edges() {
        // Nodes: 0 = gnd, 1 = IN (4 V), 2 = CLK, 3 = OUT, 4 = clock rail. PWM switch clocks.
        let mut s = Sim::new(1);
        assert!(s.set_netlist(
            5,
            &[
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_SWITCH,
                ELEM_RESISTOR,
                ELEM_SAMPLER
            ],
            &[1, 4, 4, 2, 3],
            &[0, 0, 2, 0, 1],
            &[0, 0, 0, 0, 2],
            &[0, 0, 0, 0, 0],
            &[4.0, 5.0, 0.5, 1000.0, 2.5], // IN = 4 V > 2.5 V threshold
            &[0.0; 5],
        ));
        // Run until OUT has latched high on an edge.
        for _ in 0..200 {
            s.step();
        }
        assert!(
            s.state()[3] > 4.0,
            "sampler should have latched OUT high (IN 4 V > 2.5 V): {}",
            s.state()[3]
        );
        // Across a full clock period (spanning a rising edge) OUT must hold High — IN stays
        // above threshold, so even the reload keeps it high; the point is no mid-period glitch.
        for _ in 0..SWITCH_PERIOD_TICKS {
            s.step();
            assert!(
                s.state()[3] > 4.0,
                "OUT must hold High through an edge while IN stays above threshold: {}",
                s.state()[3]
            );
        }
    }

    /// A three-terminal sampler netlist installs; an out-of-range terminal is rejected
    /// fail-safe (mirrors the flip-flop's arity validation).
    #[test]
    fn sampler_netlist_validates() {
        let mut sim = Sim::new(1);
        assert!(
            sim.set_netlist(4, &[ELEM_SAMPLER], &[1], &[2], &[3], &[0], &[2.0], &[0.0]),
            "valid three-terminal sampler installs"
        );
        assert!(
            !sim.set_netlist(4, &[ELEM_SAMPLER], &[1], &[2], &[9], &[0], &[2.0], &[0.0]),
            "out-of-range CLK terminal c is rejected"
        );
    }

    /// A clocked sampler circuit (active sequential state) reproduces bit-for-bit: two
    /// fresh `Sim`s run the same sampler netlist for N steps and agree on the snapshot-hash
    /// sequence at EVERY tick — including the exact ticks where a clock edge latches. This
    /// is the determinism guarantee with the sampler mechanism ACTIVE (not merely inert).
    #[test]
    fn sampler_run_is_reproducible() {
        let build = || {
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist(
                5,
                &[
                    ELEM_VSOURCE,
                    ELEM_VSOURCE,
                    ELEM_SWITCH,
                    ELEM_RESISTOR,
                    ELEM_SAMPLER
                ],
                &[1, 4, 4, 2, 3],
                &[0, 0, 2, 0, 1],
                &[0, 0, 0, 0, 2],
                &[0, 0, 0, 0, 0],
                &[3.0, 5.0, 0.5, 1000.0, 2.0], // IN 3 V, threshold 2 V
                &[0.0; 5],
            ));
            sim
        };
        let (mut a, mut b) = (build(), build());
        for tk in 0..600 {
            a.step();
            b.step();
            assert_eq!(
                a.snapshot_hash(),
                b.snapshot_hash(),
                "clocked sampler diverged at tick {tk} (sequential state must be hashed)"
            );
        }
    }

    // --- Latched comparator (ADCMP601, ELEM_COMPARATOR = 23) -------------------
    //
    // An analog comparator (senses IN+ vs IN-) with a powered rail-to-rail output
    // (swings the GND..VCC pins like a gate) and a level-sensitive ACTIVE-LOW latch
    // enable LE. Its `value` is the hysteresis band V_H (0 = a clean compare). The
    // crossbreed of the sampler (latched 1-bit decision, hashed state, constant stamp)
    // and the powered gate (rail-to-rail output, dead-rail release). 6 terminals:
    // a=OUT, b=IN+, c=IN-, d=VCC, e=GND, f=LE.

    /// Build a powered comparator with IN+/IN- and the supply held by DC sources, LE left
    /// unwired (f = 0 → the transparent floating default), hysteresis `vh`, then run a few
    /// ticks (the output has a one-tick input-to-output delay) and return the settled OUT
    /// voltage. Nodes: 0 = gnd (= GND/VEE pin), 1 = VCC (5 V), 2 = IN+, 3 = IN-, 4 = OUT.
    fn comparator_dc(vp: f64, vn: f64, vh: f64) -> f64 {
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist_pefgh(
            5,
            &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_VSOURCE, ELEM_COMPARATOR],
            &[1, 2, 3, 4], // a: VCC src, IN+ src, IN- src, comparator OUT = node 4
            &[0, 0, 0, 2], // b: src grounds; comparator IN+ = node 2
            &[0, 0, 0, 3], // c: comparator IN- = node 3
            &[0, 0, 0, 1], // d: comparator VCC = node 1 (5 V)
            &[0, 0, 0, 0], // e: comparator GND = node 0 (circuit ground)
            &[0, 0, 0, 0], // f: comparator LE = 0 (unwired → transparent)
            &[],
            &[],
            &[5.0, vp, vn, vh], // values: VCC 5 V, IN+ , IN- , hysteresis V_H
            &[0.0; 4],          // aux (unused)
            &[],                // params (defaults)
        ));
        for _ in 0..20 {
            sim.step();
        }
        sim.state()[4]
    }

    /// The comparator's front end resolves `V(IN+) > V(IN-)` and its POWERED output stage
    /// drives OUT to the supply rails: above → OUT ≈ VCC, below → OUT ≈ GND. With LE
    /// transparent (unwired) the bit tracks the live comparison; the output is a clean
    /// rail-to-rail swing (the powered-gate output path).
    #[test]
    fn comparator_compares_and_swings_rails() {
        // IN+ (3 V) > IN- (1 V) → OUT drives HIGH to VCC (5 V).
        let out_hi = comparator_dc(3.0, 1.0, 0.0);
        assert!(
            out_hi > 4.5,
            "IN+ > IN- → OUT swings to VCC (~5 V): {out_hi}"
        );
        // IN+ (1 V) < IN- (3 V) → OUT drives LOW to GND (~0 V).
        let out_lo = comparator_dc(1.0, 3.0, 0.0);
        assert!(
            out_lo < 0.5,
            "IN+ < IN- → OUT swings to GND (~0 V): {out_lo}"
        );
    }

    /// An unpowered comparator (VCC pin unwired, so its rail floats below GATE_MIN_RAIL) sits
    /// DEAD: it releases its output (high-Z) just like a dead-rail gate, so the floored OUT
    /// node reads ~0 V rather than a driven level — the "you must power the chip" lesson.
    #[test]
    fn comparator_unpowered_output_is_dead() {
        let mut sim = Sim::new(1);
        // Nodes: 0 gnd, 1 IN+ (3 V), 2 IN- (1 V), 3 OUT. VCC pin (d) left at ground → unpowered.
        assert!(sim.set_netlist_pefgh(
            4,
            &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_COMPARATOR],
            &[1, 2, 3], // a
            &[0, 0, 1], // b: comparator IN+ = node 1
            &[0, 0, 2], // c: comparator IN- = node 2
            &[0, 0, 0], // d: comparator VCC = ground → rail ≈ 0 → dead
            &[0, 0, 0], // e: comparator GND = ground
            &[0, 0, 0], // f: LE unwired
            &[],
            &[],
            &[3.0, 1.0, 0.0],
            &[0.0; 3],
            &[],
        ));
        for _ in 0..20 {
            sim.step();
        }
        assert!(
            sim.state()[3].abs() < 0.5,
            "unpowered comparator releases OUT (dead rail) → ~0 V, not a driven level: {}",
            sim.state()[3]
        );
    }

    /// The level-sensitive ACTIVE-LOW latch, on ONE continuous `Sim`. IN- is chopped by a PWM
    /// switch so the LIVE comparison alternates each clock period (IN+ above IN- for part of the
    /// period, below for the rest); LE is held LOW the whole run, so the front end is opaque.
    /// The held bit must therefore IGNORE the chopped inputs and hold its reset Low — even
    /// during the windows the live compare says HIGH. (The complementary `tracks` test below,
    /// same circuit with LE HIGH, shows it DOES follow the same chopped compare, so this is a
    /// latch and not a dead output.) This is the analog of `sampler_holds_low_without_a_clock`.
    fn comparator_chopped_input(le_high: bool) -> Sim {
        // Nodes: 0 gnd (=GND pin), 1 VCC (5 V), 2 IN+ (2.5 V fixed), 3 IN-, 4 OUT, 5 IN- rail,
        //        6 LE rail. A switch chops the IN- rail (4 V) onto IN- through a pull-down, so
        //        IN- swings 0 V (→ diff +2.5, live HIGH) ↔ ~4 V (→ diff −1.5, live LOW).
        let mut sim = Sim::new(1);
        let le_v = if le_high { 5.0 } else { 0.0 };
        assert!(sim.set_netlist_pefgh(
            7,
            &[
                ELEM_VSOURCE,  // VCC 5 V        (node 1)
                ELEM_VSOURCE,  // IN+ 2.5 V      (node 2)
                ELEM_VSOURCE,  // IN- rail 4 V   (node 5)
                ELEM_VSOURCE,  // LE rail        (node 6)
                ELEM_SWITCH,   // chop node 5 onto IN- (node 3), 50% duty
                ELEM_RESISTOR, // pull-down on IN-
                ELEM_COMPARATOR,
            ],
            &[1, 2, 5, 6, 5, 3, 4], // a
            &[0, 0, 0, 0, 3, 0, 2], // b: switch b = IN- (node 3); comparator IN+ = node 2
            &[0, 0, 0, 0, 0, 0, 3], // c: comparator IN- = node 3
            &[0, 0, 0, 0, 0, 0, 1], // d: comparator VCC = node 1
            &[0, 0, 0, 0, 0, 0, 0], // e: comparator GND = node 0
            &[0, 0, 0, 0, 0, 0, 6], // f: comparator LE = node 6
            &[],
            &[],
            &[5.0, 2.5, 4.0, le_v, 0.5, 1000.0, 0.0], // V_H = 0 (clean compare)
            &[0.0; 7],
            &[],
        ));
        sim
    }

    /// With LE held LOW the comparator is latched: the chopped inputs (which swing the live
    /// compare HIGH for half of every period) never reach the front end, so OUT holds its reset
    /// Low for the whole run.
    #[test]
    fn comparator_latched_low_holds_against_chopped_inputs() {
        let mut sim = comparator_chopped_input(false); // LE low → latched
        for tk in 0..400 {
            sim.step();
            assert!(
                sim.state()[4].abs() < 0.5,
                "LE low (latched): OUT holds reset Low despite the live compare going HIGH \
                 (tick {tk}, got {})",
                sim.state()[4]
            );
        }
    }

    /// The complement: the SAME chopped-input circuit with LE held HIGH is transparent, so OUT
    /// DOES track the live compare — it must reach HIGH at some point (proving the hold above is
    /// the latch gating the front end, not a stuck/dead output).
    #[test]
    fn comparator_transparent_tracks_chopped_inputs() {
        let mut sim = comparator_chopped_input(true); // LE high → transparent
        let mut saw_high = false;
        for _ in 0..400 {
            sim.step();
            if sim.state()[4] > 4.5 {
                saw_high = true;
            }
        }
        assert!(
            saw_high,
            "LE high (transparent): OUT tracks the chopped compare and reaches HIGH"
        );
    }

    /// Symmetric hysteresis (V_H > 0): the output is a Schmitt window about 0 — from a reset-Low
    /// state it flips Low→High only once `diff = V(IN+) − V(IN-)` exceeds +V_H/2, and a diff that
    /// stays inside the dead-band (`|diff| < V_H/2`) leaves the Low output unchanged.
    #[test]
    fn comparator_hysteresis_band() {
        let vh = 2.0; // band is ±V_H/2 = ±1.0 V about 0
                      // diff = +0.5 V is inside the +V_H/2 (1.0 V) band → a reset-Low output stays LOW.
        let inside_pos = comparator_dc(2.5, 2.0, vh); // diff = +0.5
        assert!(
            inside_pos < 0.5,
            "diff +0.5 V inside the +V_H/2 band → OUT stays LOW: {inside_pos}"
        );
        // diff = −0.5 V is inside the −V_H/2 band → a reset-Low output also stays LOW.
        let inside_neg = comparator_dc(2.0, 2.5, vh); // diff = −0.5
        assert!(
            inside_neg < 0.5,
            "diff −0.5 V inside the −V_H/2 band → OUT stays LOW: {inside_neg}"
        );
        // diff = +1.5 V is past the upper trip +V_H/2 → flips HIGH.
        let trip_hi = comparator_dc(3.5, 2.0, vh); // diff = +1.5
        assert!(
            trip_hi > 4.5,
            "diff +1.5 V past the +V_H/2 trip → OUT flips HIGH: {trip_hi}"
        );
    }

    /// The H→L edge of the hysteresis window on ONE persistent comparator. IN- is chopped by a
    /// PWM switch around the fixed IN+: for part of each period diff = +2.5 V (well past the
    /// upper trip +V_H/2 = +1.0) which latches OUT HIGH, then diff = −1.5 V (past the LOWER trip
    /// −V_H/2 = −1.0) which trips it LOW. Seeing HIGH then a later LOW proves the held HIGH state
    /// only drops once diff crosses −V_H/2, the lower Schmitt edge (not a bare sign flip).
    #[test]
    fn comparator_hysteresis_upper_state_trips_at_lower_edge() {
        // Nodes: 0 gnd (=GND), 1 VCC 5 V, 2 IN+ (2.5 V fixed), 3 IN-, 4 OUT, 5 IN- rail (4 V).
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist_pefgh(
            6,
            &[
                ELEM_VSOURCE,  // VCC 5 V (node 1)
                ELEM_VSOURCE,  // IN+ 2.5 V (node 2)
                ELEM_VSOURCE,  // IN- rail 4 V (node 5)
                ELEM_SWITCH,   // chop node 5 onto IN- (node 3), 50% duty
                ELEM_RESISTOR, // pull-down on IN-
                ELEM_COMPARATOR,
            ],
            &[1, 2, 5, 5, 3, 4], // a
            &[0, 0, 0, 3, 0, 2], // b: switch b = IN- (node 3); comparator IN+ = node 2
            &[0, 0, 0, 0, 0, 3], // c: comparator IN- = node 3
            &[0, 0, 0, 0, 0, 1], // d: comparator VCC = node 1
            &[0, 0, 0, 0, 0, 0], // e: comparator GND = node 0
            &[0, 0, 0, 0, 0, 0], // f: LE unwired → transparent
            &[],
            &[],
            &[5.0, 2.5, 4.0, 0.5, 1000.0, 2.0], // V_H = 2.0
            &[0.0; 6],
            &[],
        ));
        let mut saw_high = false;
        let mut saw_low_after_high = false;
        for _ in 0..400 {
            sim.step();
            let out = sim.state()[4];
            if out > 4.5 {
                saw_high = true;
            }
            if saw_high && out < 0.5 {
                saw_low_after_high = true;
            }
        }
        assert!(
            saw_high,
            "transparent comparator should latch HIGH while IN- is pulled low (diff +2.5 V)"
        );
        assert!(
            saw_low_after_high,
            "once IN- rises so diff < −V_H/2 the HIGH state must trip LOW (the lower Schmitt edge)"
        );
    }

    /// A comparator circuit (active sequential `cmp_q`) reproduces bit-for-bit: two fresh
    /// `Sim`s run the same comparator netlist for N steps and agree on the snapshot-hash at
    /// EVERY tick — the determinism guarantee with the comparator mechanism ACTIVE.
    #[test]
    fn comparator_run_is_reproducible() {
        let build = || {
            let mut sim = Sim::new(1);
            // A PWM-chopped IN- crossing a fixed IN+ under a powered, transparent comparator —
            // so the held bit flips back and forth (exercising the latch path), with hysteresis.
            assert!(sim.set_netlist_pefgh(
                6,
                &[
                    ELEM_VSOURCE,
                    ELEM_VSOURCE,
                    ELEM_VSOURCE,
                    ELEM_SWITCH,
                    ELEM_RESISTOR,
                    ELEM_COMPARATOR,
                ],
                &[1, 2, 5, 5, 3, 4],
                &[0, 0, 0, 3, 0, 2],
                &[0, 0, 0, 0, 0, 3],
                &[0, 0, 0, 0, 0, 1],
                &[0, 0, 0, 0, 0, 0],
                &[0, 0, 0, 0, 0, 0],
                &[],
                &[],
                &[5.0, 2.5, 4.0, 0.5, 1000.0, 1.0], // V_H = 1.0
                &[0.0; 6],
                &[],
            ));
            sim
        };
        let (mut a, mut b) = (build(), build());
        for tk in 0..600 {
            a.step();
            b.step();
            assert_eq!(
                a.snapshot_hash(),
                b.snapshot_hash(),
                "latched comparator diverged at tick {tk} (cmp_q must be hashed)"
            );
        }
    }

    /// A six-terminal comparator netlist installs; an out-of-range terminal is rejected
    /// fail-safe (mirrors the sampler's / flip-flop's arity validation).
    #[test]
    fn comparator_netlist_validates() {
        let mut sim = Sim::new(1);
        assert!(
            sim.set_netlist_pefgh(
                6,
                &[ELEM_COMPARATOR],
                &[1],
                &[2],
                &[3],
                &[4],
                &[0],
                &[5],
                &[],
                &[],
                &[0.0],
                &[0.0],
                &[],
            ),
            "valid six-terminal comparator installs"
        );
        assert!(
            !sim.set_netlist_pefgh(
                6,
                &[ELEM_COMPARATOR],
                &[1],
                &[2],
                &[3],
                &[4],
                &[0],
                &[9], // LE out of range
                &[],
                &[],
                &[0.0],
                &[0.0],
                &[],
            ),
            "out-of-range LE terminal f is rejected"
        );
    }

    // --- Behavioral block / SPI master (ELEM_BEHAVIORAL = 25) ------------------
    //
    // The protocol / behavioral engine's element (ADR 0004): a clocked INTEGER state
    // machine that runs beside the analog solve and talks to it only at its boundary
    // pins. Program 1 is an SPI master (Mode 0): a rising START asserts CS low, shifts
    // the configured word out on MOSI (MSB-first) clocked by SCLK at the structural
    // divider (params[0] = half-period ticks, params[1] = bit count), sampling MISO on
    // each rising edge. Its three outputs are powered (swing the GND..VCC rail, dead
    // below GATE_MIN_RAIL) exactly like a gate; its eight u32 state words enter the
    // snapshot hash so a behavioral netlist replays bit-for-bit.
    //
    // SPI master test pinout: a=SCLK, b=MOSI, c=CS, d=VCC, e=GND, f=MISO, g=START.

    /// True iff a (pure-digital) output node reads logic-high: above half a 5 V rail. The
    /// behavioral SPI outputs swing 0..VCC (= 5 V here), so a clean `> 2.5 V` decision turns
    /// the observed node voltage back into the bit the master is driving.
    fn spi_pin_high(v: f64) -> bool {
        v > 2.5
    }

    /// Build a powered SPI-master netlist transmitting `data` with the given half-period and
    /// bit count, START tied to a constant-high source (the block's `start_prev` resets Low, so
    /// the first step sees exactly one rising START edge → one transaction), and MISO sourced
    /// from `miso_node` (node `0` = grounded → MISO reads Low). Nodes: 0 = gnd (= GND pin),
    /// 1 = VCC (5 V), 2 = START rail (5 V), 3 = SCLK, 4 = MOSI, 5 = CS, 6 = MISO rail.
    /// Returns the installed `Sim` (already at t = 0, state zeroed).
    fn spi_master(data: f64, half: f64, nbits: f64, miso_node: u32) -> Sim {
        let mut sim = Sim::new(1);
        // params: SPI block gets [half-period, bit-count] in slots 0/1; sources get defaults.
        let mut params = vec![0.0; 3 * PARAM_STRIDE];
        params[2 * PARAM_STRIDE] = half; // params[0] = SCLK half-period (ticks)
        params[2 * PARAM_STRIDE + 1] = nbits; // params[1] = bit count
        assert!(sim.set_netlist_pefgh(
            7,
            &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_BEHAVIORAL],
            &[1, 2, 3],         // a: VCC src, START src, SPI SCLK = node 3
            &[0, 0, 4],         // b: src grounds; SPI MOSI = node 4
            &[0, 0, 5],         // c: SPI CS = node 5
            &[0, 0, 1],         // d: SPI VCC = node 1 (5 V)
            &[0, 0, 0],         // e: SPI GND = node 0
            &[0, 0, miso_node], // f: SPI MISO = miso_node
            &[0, 0, 2],         // g: SPI START = node 2 (held high)
            &[],                // h unused
            &[5.0, 5.0, 1.0],   // values: VCC 5 V, START 5 V, program id 1 (SPI master)
            &[0.0, 0.0, data],  // aux: SPI data word to transmit
            &params,
        ));
        sim
    }

    /// Run one SPI-master transaction of `data` (half-period `half`, `nbits` bits, MISO grounded)
    /// and observe the powered output nodes tick by tick, returning the bits sampled on MOSI at
    /// each SCLK **rising** edge, the SCLK rising-edge count, whether CS asserted (went Low) at
    /// the start, and whether CS deasserted (went High) after the last bit. The observed pins are
    /// one tick delayed from the internal state (the gate/sampler convention) but internally
    /// consistent — exactly what a scope on the bus would see.
    fn spi_observe(data: u32, half: f64, nbits: usize) -> (Vec<bool>, usize, bool, bool) {
        let mut sim = spi_master(data as f64, half, nbits as f64, 0);
        let mut prev_sclk = false;
        let mut prev_cs = true; // CS idles HIGH (deasserted)
        let mut rising_edges = 0usize;
        let mut mosi_at_edge: Vec<bool> = Vec::new();
        let mut cs_asserted = false;
        let mut cs_deasserted_after_bits = false;
        // A full transaction is nbits * 2 (rise+fall) * half ticks plus the load tick; run well
        // past it so we also see CS deassert and the machine return to idle.
        let total = nbits * 2 * (half as usize) + 16;
        for _ in 0..total {
            sim.step();
            let sclk = spi_pin_high(sim.state()[3]);
            let mosi = spi_pin_high(sim.state()[4]);
            let cs = spi_pin_high(sim.state()[5]);
            if prev_cs && !cs {
                cs_asserted = true; // CS went Low (asserted) at the transaction start
            }
            if !prev_sclk && sclk {
                rising_edges += 1;
                mosi_at_edge.push(mosi); // sample the MOSI bit presented across this rising edge
            }
            if rising_edges >= nbits && cs {
                cs_deasserted_after_bits = true; // CS back High after the last bit
            }
            prev_sclk = sclk;
            prev_cs = cs;
        }
        (
            mosi_at_edge,
            rising_edges,
            cs_asserted,
            cs_deasserted_after_bits,
        )
    }

    /// The SPI master shifts a byte: on a rising START it asserts CS low, then drives exactly
    /// `nbits` SCLK pulses while presenting the data word MSB-first on MOSI (each bit stable
    /// across the SCLK rising edge that samples it, Mode 0 / CPHA = 0), and deasserts CS high
    /// after the last bit. Checked for the spec byte 0xA5 AND a non-palindromic byte (0xB3,
    /// whose bit-reversal 0xCD differs) so the MSB-first ordering is genuinely under test —
    /// 0xA5 alone is bit-symmetric and would pass either order.
    #[test]
    fn behavioral_spi_master_shifts_a_byte() {
        let nbits = 8usize;
        let half = 2.0;
        for &data in &[0xA5u32, 0xB3u32] {
            let (mosi_at_edge, rising_edges, cs_asserted, cs_deasserted) =
                spi_observe(data, half, nbits);
            // Expected MOSI bits, MSB-first (bit nbits-1 first).
            let expected: Vec<bool> = (0..nbits)
                .map(|k| (data >> (nbits - 1 - k)) & 1 != 0)
                .collect();
            assert!(
                cs_asserted,
                "CS must assert (go Low) when START rises (0x{data:02X})"
            );
            assert_eq!(
                rising_edges, nbits,
                "SPI master must produce exactly {nbits} SCLK pulses (0x{data:02X}), saw {rising_edges}"
            );
            assert_eq!(
                mosi_at_edge, expected,
                "MOSI must present 0x{data:02X} MSB-first at each SCLK rising edge"
            );
            assert!(
                cs_deasserted,
                "CS must deassert (go High) after the last bit (0x{data:02X}, transaction complete)"
            );
        }
    }

    /// With MOSI tied to MISO (an external wire), the master clocks its own transmitted bits
    /// back in on MISO — so after the transaction the received word `shift_in` equals the
    /// transmitted byte. Proves the receive path (rising-edge MISO sampling, MSB-first in).
    #[test]
    fn behavioral_spi_miso_loopback() {
        // A NON-palindromic byte (0xB3 → bit-reversal 0xCD) so a transmit/receive ordering
        // mismatch would corrupt the round-trip — the receive path is MSB-first, genuinely tested.
        let data: u32 = 0xB3;
        let nbits = 8usize;
        let half = 2.0;
        // MISO sourced from node 4 (= MOSI): a wire from MOSI back to MISO. The MOSI net is the
        // SPI block's own powered output, so MISO reads exactly what the master drives.
        let mut sim = spi_master(data as f64, half, nbits as f64, 4);

        let total = nbits * 2 * (half as usize) + 16;
        for _ in 0..total {
            sim.step();
        }
        // The transaction has completed (back to idle); shift_in holds the received word.
        let received = sim.beh_spi_shift_in(2);
        assert_eq!(
            received, data,
            "MOSI→MISO loopback: received word 0x{received:02X} must equal transmitted 0x{data:02X}"
        );
        // And the state machine is back in idle with CS deasserted.
        assert_eq!(
            sim.beh_spi_fsm(2),
            0,
            "SPI master must return to idle after the transaction"
        );
    }

    /// Idle is well-defined: with START held LOW (never a rising edge) the master never starts —
    /// SCLK stays Low and CS stays High (deasserted) for the whole run, and MOSI stays Low.
    #[test]
    fn behavioral_idle_drives_clean_levels() {
        let mut sim = Sim::new(1);
        // Nodes: 0 = gnd, 1 = VCC (5 V), 2 = SCLK, 3 = MOSI, 4 = CS. START (g) = 0 (grounded →
        // held Low, no edge ever fires); MISO (f) = 0 (grounded).
        assert!(sim.set_netlist_pefgh(
            5,
            &[ELEM_VSOURCE, ELEM_BEHAVIORAL],
            &[1, 2], // a: VCC src, SPI SCLK = node 2
            &[0, 3], // b: MOSI = node 3
            &[0, 4], // c: CS = node 4
            &[0, 1], // d: VCC = node 1
            &[0, 0], // e: GND = node 0
            &[0, 0], // f: MISO = 0 (grounded)
            &[0, 0], // g: START = 0 (grounded → held Low)
            &[],
            &[5.0, 1.0], // VCC 5 V, program id 1 (SPI master)
            &[0.0, 0xA5 as f64],
            &[], // params default (half = 4, nbits = 8) — irrelevant, never starts
        ));
        for tk in 0..120 {
            sim.step();
            assert!(
                !spi_pin_high(sim.state()[2]),
                "idle SCLK must stay Low (tick {tk}, got {})",
                sim.state()[2]
            );
            assert!(
                spi_pin_high(sim.state()[4]),
                "idle CS must stay High/deasserted (tick {tk}, got {})",
                sim.state()[4]
            );
            assert!(
                !spi_pin_high(sim.state()[3]),
                "idle MOSI must stay Low (tick {tk}, got {})",
                sim.state()[3]
            );
        }
    }

    /// An unpowered SPI master (VCC pin left at ground → rail below GATE_MIN_RAIL) is DEAD: it
    /// releases all three outputs (high-Z) and never advances its state, even with START high —
    /// the powered-chip "you must power it" rule, and proof the timing comes from the declared
    /// params under power, not from a floating rail.
    #[test]
    fn behavioral_unpowered_is_dead() {
        let mut sim = Sim::new(1);
        // Nodes: 0 = gnd, 1 = START rail (5 V), 2 = SCLK, 3 = MOSI, 4 = CS. VCC pin (d) = 0 → dead.
        assert!(sim.set_netlist_pefgh(
            5,
            &[ELEM_VSOURCE, ELEM_BEHAVIORAL],
            &[1, 2],
            &[0, 3],
            &[0, 4],
            &[0, 0], // d: VCC = node 0 → unpowered
            &[0, 0], // e: GND = node 0
            &[0, 0], // f: MISO = 0
            &[0, 1], // g: START = node 1 (high), but the chip is unpowered
            &[],
            &[5.0, 1.0],
            &[0.0, 0xA5 as f64],
            &[],
        ));
        for _ in 0..60 {
            sim.step();
        }
        // No clock was ever generated; the state machine stayed idle (all-zero state).
        assert_eq!(
            sim.beh_spi_fsm(1),
            0,
            "an unpowered SPI master must not advance its state machine"
        );
        // The released outputs sit near 0 V (the GMIN-floored Z), not a driven rail.
        assert!(
            sim.state()[2].abs() < 0.5 && sim.state()[4].abs() < 0.5,
            "unpowered outputs release (high-Z, ~0 V): SCLK {}, CS {}",
            sim.state()[2],
            sim.state()[4]
        );
    }

    /// Build a powered **combinational** LUT (program 4) with truth table `truth`, its four inputs
    /// IN0..IN3 = f/g/h/c driven to the given volts (5 = high, 0 = low) and CLK grounded, then run
    /// to settle and return the OUT voltage. Nodes: 0 = gnd (= GND pin), 1 = VCC (5 V), 2..5 =
    /// IN0..IN3, 6 = OUT (= LUT element index 5).
    fn lut_comb(truth: u32, in0: f64, in1: f64, in2: f64, in3: f64) -> f64 {
        let mut sim = Sim::new(1);
        let params = vec![0.0; 6 * PARAM_STRIDE]; // mode slot left 0 ⇒ combinational
        assert!(sim.set_netlist_pefgh(
            7,
            &[
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_BEHAVIORAL
            ],
            &[1, 2, 3, 4, 5, 6], // a: rails + IN sources; LUT OUT = node 6
            &[0, 0, 0, 0, 0, 0], // b: src grounds; LUT CLK = gnd (unused)
            &[0, 0, 0, 0, 0, 5], // c: LUT IN3 = node 5
            &[0, 0, 0, 0, 0, 1], // d: LUT VCC = node 1 (5 V)
            &[0, 0, 0, 0, 0, 0], // e: LUT GND = node 0
            &[0, 0, 0, 0, 0, 2], // f: LUT IN0 = node 2
            &[0, 0, 0, 0, 0, 3], // g: LUT IN1 = node 3
            &[0, 0, 0, 0, 0, 4], // h: LUT IN2 = node 4
            &[5.0, in0, in1, in2, in3, BEH_PROG_LUT as f64], // values: rails + program id 4
            &[0.0, 0.0, 0.0, 0.0, 0.0, truth as f64], // aux: LUT truth table (low 16 bits)
            &params,
        ));
        for _ in 0..50 {
            sim.step();
        }
        sim.state()[6]
    }

    /// A combinational LUT IS a programmable gate: every ≤4-input boolean is one truth table. With
    /// the inputs grounded except IN0/IN1, the XOR table `0x6666`, AND `0x8888` and OR `0xEEEE`
    /// each compute their function on (IN0, IN1) — proof the output is `bit[index]` of the table.
    #[test]
    fn behavioral_lut_combinational_is_a_programmable_gate() {
        let hi = |v: f64| v > 2.5;
        // XOR(IN0, IN1): 0,1,1,0 per nibble ⇒ 0x6666.
        assert!(!hi(lut_comb(0x6666, 0.0, 0.0, 0.0, 0.0)), "0 XOR 0 = 0");
        assert!(hi(lut_comb(0x6666, 5.0, 0.0, 0.0, 0.0)), "1 XOR 0 = 1");
        assert!(hi(lut_comb(0x6666, 0.0, 5.0, 0.0, 0.0)), "0 XOR 1 = 1");
        assert!(!hi(lut_comb(0x6666, 5.0, 5.0, 0.0, 0.0)), "1 XOR 1 = 0");
        // AND(IN0, IN1): 0,0,0,1 ⇒ 0x8888.
        assert!(!hi(lut_comb(0x8888, 5.0, 0.0, 0.0, 0.0)), "1 AND 0 = 0");
        assert!(hi(lut_comb(0x8888, 5.0, 5.0, 0.0, 0.0)), "1 AND 1 = 1");
        // OR(IN0, IN1): 0,1,1,1 ⇒ 0xEEEE.
        assert!(!hi(lut_comb(0xEEEE, 0.0, 0.0, 0.0, 0.0)), "0 OR 0 = 0");
        assert!(hi(lut_comb(0xEEEE, 5.0, 0.0, 0.0, 0.0)), "1 OR 0 = 1");
    }

    /// Drive a 3-bit flash ADC (program 5): VIN on `f`, VREF on `g`, reading the 3-bit code back off
    /// D0/D1/D2 (`a`/`b`/`c`) as a 0..7 integer. Nodes: 1 = VCC (5 V), 2 = VIN, 3 = VREF, 4/5/6 = D0/D1/D2.
    fn adc_code(vin: f64, vref: f64) -> u32 {
        let mut sim = Sim::new(1);
        let params = vec![0.0; 4 * PARAM_STRIDE];
        assert!(sim.set_netlist_pefgh(
            7,
            &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_VSOURCE, ELEM_BEHAVIORAL],
            &[1, 2, 3, 4], // a: VCC + VIN + VREF sources; ADC D0 = node 4
            &[0, 0, 0, 5], // b: src grounds; ADC D1 = node 5
            &[0, 0, 0, 6], // c: ADC D2 = node 6
            &[0, 0, 0, 1], // d: ADC VCC = node 1 (5 V)
            &[0, 0, 0, 0], // e: ADC GND = node 0
            &[0, 0, 0, 2], // f: ADC VIN = node 2
            &[0, 0, 0, 3], // g: ADC VREF = node 3
            &[0, 0, 0, 0], // h: unused
            &[5.0, vin, vref, BEH_PROG_FLASH_ADC as f64], // values: rails + program id 5
            &[0.0, 0.0, 0.0, 0.0], // aux unused
            &params,
        ));
        for _ in 0..50 {
            sim.step();
        }
        let s = sim.state();
        let hi = |v: f64| (v > 2.5) as u32;
        hi(s[4]) | (hi(s[5]) << 1) | (hi(s[6]) << 2)
    }

    /// The 3-bit flash ADC quantizes its input by the floor rule `code = floor(8 * Vin / Vref)`
    /// against the 5 V reference (LSB = 0.625 V): each band maps to its code, full scale saturates to
    /// 7, and over-range clamps rather than wrapping. (The comparator-bank thresholds at k/8 of FS.)
    #[test]
    fn behavioral_flash_adc_3bit_quantizes() {
        assert_eq!(adc_code(0.0, 5.0), 0, "0 V -> 0");
        assert_eq!(adc_code(0.4, 5.0), 0, "0.4 V (< 1 LSB) -> 0");
        assert_eq!(adc_code(0.7, 5.0), 1, "0.7 V (in [0.625, 1.25)) -> 1");
        assert_eq!(adc_code(2.6, 5.0), 4, "2.6 V (just over half scale) -> 4");
        assert_eq!(adc_code(4.4, 5.0), 7, "4.4 V (in [4.375, 5)) -> 7");
        assert_eq!(adc_code(5.0, 5.0), 7, "full scale saturates to 7");
        assert_eq!(adc_code(6.0, 5.0), 7, "over-range clamps to 7 (no wrap)");
    }

    /// Drive a 3-bit SAR ADC (program 6) at a fixed VIN against the 5 V VCC reference, clocked by a
    /// 50 %-duty switch (a clean 0/5 V square wave, rising edges every SWITCH_PERIOD_TICKS), reading
    /// the 3-bit code off D0/D1/D2 (a/b/c) whenever DONE (g) is asserted — i.e. on a completed
    /// conversion, so the sample is never mid-search. Nodes: 0 = gnd, 1 = VCC (5 V), 2 = VIN,
    /// 3 = CLK, 4 = clock source rail, 5/6/7 = D0/D1/D2, 8 = DONE.
    fn sar_code(vin: f64) -> u32 {
        let mut sim = Sim::new(1);
        let params = vec![0.0; 6 * PARAM_STRIDE];
        assert!(sim.set_netlist_pefgh(
            9,
            &[
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_SWITCH,
                ELEM_RESISTOR,
                ELEM_BEHAVIORAL
            ],
            &[1, 2, 4, 4, 3, 5], // a: VCC, VIN, clk-rail srcs; SWITCH a=4; R a=3; SAR D0 = node 5
            &[0, 0, 0, 3, 0, 6], // b: src grounds; SWITCH b=3 (CLK); R b=0; SAR D1 = node 6
            &[0, 0, 0, 0, 0, 7], // c: SAR D2 = node 7
            &[0, 0, 0, 0, 0, 1], // d: SAR VCC = node 1 (5 V reference)
            &[0, 0, 0, 0, 0, 0], // e: SAR GND = node 0
            &[0, 0, 0, 0, 0, 2], // f: SAR VIN = node 2
            &[0, 0, 0, 0, 0, 8], // g: SAR DONE = node 8
            &[0, 0, 0, 0, 0, 3], // h: SAR CLK = node 3
            &[5.0, vin, 5.0, 0.5, 1000.0, BEH_PROG_SAR_ADC as f64], // SWITCH 0.5 duty, R 1 kΩ pull-down
            &[0.0, 0.0, 0.0, 0.0, 0.0, 0.0],                        // aux unused
            &params,
        ));
        let hi = |v: f64| (v > 2.5) as u32;
        let mut done_code = None;
        for _ in 0..400 {
            sim.step();
            let s = sim.state();
            if s[8] > 2.5 {
                done_code = Some(hi(s[5]) | (hi(s[6]) << 1) | (hi(s[7]) << 2));
            }
        }
        done_code.expect("SAR completes at least one conversion (DONE asserted) within 400 ticks")
    }

    /// The 3-bit SAR ADC converges by binary search to the SAME code the flash ADC finds —
    /// `floor(8 * VIN / VCC)` against the 5 V reference (LSB = 0.625 V) — taking 3 clocks instead of
    /// one (the speed-vs-parts trade). Checked across the range, with full scale saturating to 7 and
    /// over-range clamping (no wrap). The reads are gated on DONE, so a partial mid-search register
    /// is never observed.
    #[test]
    fn behavioral_sar_adc_3bit_successive_approximation() {
        assert_eq!(sar_code(0.0), 0, "0 V -> 0");
        assert_eq!(sar_code(0.7), 1, "0.7 V (in [0.625, 1.25)) -> 1");
        assert_eq!(sar_code(1.4), 2, "1.4 V (in [1.25, 1.875)) -> 2");
        assert_eq!(sar_code(2.6), 4, "2.6 V (just over half scale) -> 4");
        assert_eq!(sar_code(3.2), 5, "3.2 V (in [3.125, 3.75)) -> 5");
        assert_eq!(sar_code(4.4), 7, "4.4 V (in [4.375, 5)) -> 7");
        assert_eq!(sar_code(5.0), 7, "full scale saturates to 7");
        assert_eq!(sar_code(6.0), 7, "over-range clamps to 7 (no wrap)");
    }

    /// End-to-end mixed-signal chain: a flash ADC (program 5) digitises VIN, and an R-2R DAC — the
    /// CEC1083 resistor network exactly as `buildNetlist` composes it (two R spine, four 2R legs,
    /// MSB at the output node) — reconstructs it. The convert/reconstruct worked example. Returns
    /// AOUT (the ladder's node A). Proves the ADC's digital outputs drive the 20 k ladder legs
    /// cleanly (the 1 Ohm logic driver is stiff vs the legs) so the two parts compose. Nodes:
    /// 0 = GND, 1 = VCC (5 V, also VREF), 2 = VIN, 3 = AOUT (ladder A), 4/5 = ladder B/C,
    /// 6/7/8 = D0/D1/D2 (the shared ADC-output / DAC-input nets).
    fn adc_dac_aout(vin: f64) -> f64 {
        let mut sim = Sim::new(1);
        let params = vec![0.0; 9 * PARAM_STRIDE];
        assert!(sim.set_netlist_pefgh(
            9,
            &[
                ELEM_VSOURCE,    // VCC (5 V)
                ELEM_VSOURCE,    // VIN
                ELEM_BEHAVIORAL, // flash ADC (program 5)
                ELEM_RESISTOR,   // R  spine A-B
                ELEM_RESISTOR,   // R  spine B-C
                ELEM_RESISTOR,   // 2R leg A-D2 (MSB at the output node)
                ELEM_RESISTOR,   // 2R leg B-D1
                ELEM_RESISTOR,   // 2R leg C-D0
                ELEM_RESISTOR,   // 2R termination C-GND
            ],
            &[1, 2, 6, 3, 4, 3, 4, 5, 5], // a: VCC, VIN; ADC D0=6; R A=3,B=4; 2R A=3,B=4,C=5,C=5
            &[0, 0, 7, 4, 5, 8, 7, 6, 0], // b: src gnds; ADC D1=7; R B=4,C=5; 2R D2=8,D1=7,D0=6,GND=0
            &[0, 0, 8, 0, 0, 0, 0, 0, 0], // c: ADC D2 = node 8
            &[0, 0, 1, 0, 0, 0, 0, 0, 0], // d: ADC VCC = node 1
            &[0, 0, 0, 0, 0, 0, 0, 0, 0], // e: ADC GND = node 0
            &[0, 0, 2, 0, 0, 0, 0, 0, 0], // f: ADC VIN = node 2
            &[0, 0, 1, 0, 0, 0, 0, 0, 0], // g: ADC VREF = node 1 (= VCC)
            &[0, 0, 0, 0, 0, 0, 0, 0, 0], // h: unused
            &[
                5.0,
                vin,
                BEH_PROG_FLASH_ADC as f64,
                10000.0,
                10000.0,
                20000.0,
                20000.0,
                20000.0,
                20000.0,
            ],
            &[0.0; 9], // aux unused
            &params,
        ));
        for _ in 0..50 {
            sim.step();
        }
        sim.state()[3] // AOUT = ladder node A
    }

    /// The ADC->DAC chain reconstructs the quantised staircase: AOUT = code/8 * 5 V, with
    /// code = floor(8 * VIN / 5). Each input band maps to its step (one LSB = 0.625 V), and the top
    /// step reaches only 7/8 of full scale (4.375 V) — the 3-bit reconstruction ceiling, the lesson
    /// of the convert/reconstruct demo. (Tolerance covers the ~mV IR drop of the stiff logic driver
    /// into the ladder legs.)
    #[test]
    fn adc_dac_reconstructs_quantised_staircase() {
        let approx = |got: f64, want: f64| {
            assert!((got - want).abs() < 0.02, "AOUT {got} should be ~{want}");
        };
        approx(adc_dac_aout(0.0), 0.0); // code 0
        approx(adc_dac_aout(0.7), 0.625); // code 1 (1 LSB)
        approx(adc_dac_aout(2.6), 2.5); // code 4 (half scale)
        approx(adc_dac_aout(3.2), 3.125); // code 5
        approx(adc_dac_aout(5.0), 4.375); // code 7 (full scale -> 7/8 ceiling)
    }

    /// Run a 3-bit counter (program 7) clocked by a 50 %-duty switch (rising edges every
    /// SWITCH_PERIOD_TICKS) with RESET wired to `reset_node`, and return the de-duplicated sequence of
    /// count values seen on Q0/Q1/Q2. Nodes: 0 = gnd, 1 = VCC (5 V), 2 = CLK, 3 = clock source rail,
    /// 4/5/6 = Q0/Q1/Q2.
    fn counter_sequence(reset_node: u32) -> Vec<u32> {
        let mut sim = Sim::new(1);
        let params = vec![0.0; 5 * PARAM_STRIDE];
        assert!(sim.set_netlist_pefgh(
            7,
            &[
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_SWITCH,
                ELEM_RESISTOR,
                ELEM_BEHAVIORAL
            ],
            &[1, 3, 3, 2, 4], // a: VCC, clk-rail srcs; SWITCH a=3; R a=2; CTR Q0 = node 4
            &[0, 0, 2, 0, 5], // b: src gnds; SWITCH b=2 (CLK); R b=0; CTR Q1 = node 5
            &[0, 0, 0, 0, 6], // c: CTR Q2 = node 6
            &[0, 0, 0, 0, 1], // d: CTR VCC = node 1
            &[0, 0, 0, 0, 0], // e: CTR GND = node 0
            &[0, 0, 0, 0, 2], // f: CTR CLK = node 2
            &[0, 0, 0, 0, reset_node], // g: CTR RESET (0 = gnd = run; 1 = VCC = hold cleared)
            &[0, 0, 0, 0, 0], // h: unused
            &[5.0, 5.0, 0.5, 1000.0, BEH_PROG_COUNTER as f64], // SWITCH 0.5 duty, R 1 kΩ pull-down
            &[0.0; 5],
            &params,
        ));
        let hi = |v: f64| (v > 2.5) as u32;
        let mut seq = Vec::new();
        let mut last: Option<u32> = None;
        for _ in 0..900 {
            sim.step();
            let s = sim.state();
            let n = hi(s[4]) | (hi(s[5]) << 1) | (hi(s[6]) << 2);
            if last != Some(n) {
                seq.push(n);
                last = Some(n);
            }
        }
        seq
    }

    /// The 3-bit binary counter advances one step per rising clock edge and wraps 7 -> 0: the
    /// de-duplicated Q0/Q1/Q2 sequence increments by +1 mod 8 throughout, reaching 7 and rolling over.
    /// 900 ticks at ~50 ticks/edge gives two full wraps. (Drive a DAC from Q0..Q2 for a ramp.)
    #[test]
    fn behavioral_counter_counts_and_wraps() {
        let seq = counter_sequence(0); // RESET = gnd: free-run
        assert!(seq.len() >= 9, "counter should advance many steps: {seq:?}");
        for w in seq.windows(2) {
            assert_eq!(w[1], (w[0] + 1) % 8, "counter steps by +1 mod 8: {seq:?}");
        }
        assert!(seq.contains(&7), "counter reaches 7: {seq:?}");
        assert!(
            seq.windows(2).any(|w| w[0] == 7 && w[1] == 0),
            "counter wraps 7 -> 0: {seq:?}"
        );
    }

    /// RESET (active high) asynchronously clears the counter and dominates the clock: with RESET tied
    /// to VCC the count never leaves 0 no matter how many clock edges arrive.
    #[test]
    fn behavioral_counter_reset_holds_zero() {
        let seq = counter_sequence(1); // RESET = VCC (node 1): held cleared
        assert_eq!(seq, vec![0], "RESET held high pins the count at 0: {seq:?}");
    }

    /// Run a sigma-delta ADC (program 8) at a fixed VIN against the 5 V VCC reference, clocked by a
    /// 50 %-duty switch, and return (the settled D0/D1/D2 codes, the time-fraction the BS bit-stream is
    /// high). Nodes: 0 = gnd, 1 = VCC (5 V), 2 = VIN, 3 = CLK, 4 = clock source rail, 5/6/7 = D0/D1/D2,
    /// 8 = BS (1-bit modulator stream).
    fn sigma_delta_run(vin: f64) -> (Vec<u32>, f64) {
        let mut sim = Sim::new(1);
        let params = vec![0.0; 6 * PARAM_STRIDE];
        assert!(sim.set_netlist_pefgh(
            9,
            &[
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_SWITCH,
                ELEM_RESISTOR,
                ELEM_BEHAVIORAL
            ],
            &[1, 2, 4, 4, 3, 5], // a: VCC, VIN, clk-rail srcs; SWITCH a=4; R a=3; SDM D0 = node 5
            &[0, 0, 0, 3, 0, 6], // b: src gnds; SWITCH b=3 (CLK); R b=0; SDM D1 = node 6
            &[0, 0, 0, 0, 0, 7], // c: SDM D2 = node 7
            &[0, 0, 0, 0, 0, 1], // d: SDM VCC = node 1 (5 V reference)
            &[0, 0, 0, 0, 0, 0], // e: SDM GND = node 0
            &[0, 0, 0, 0, 0, 2], // f: SDM VIN = node 2
            &[0, 0, 0, 0, 0, 8], // g: SDM BS (bit stream) = node 8
            &[0, 0, 0, 0, 0, 3], // h: SDM CLK = node 3
            &[5.0, vin, 5.0, 0.5, 1000.0, BEH_PROG_SIGMA_DELTA as f64], // SWITCH 0.5 duty, R 1 kΩ pull-down
            &[0.0; 6],
            &params,
        ));
        let hi = |v: f64| (v > 2.5) as u32;
        let mut codes = Vec::new();
        let mut bs_high = 0usize;
        let mut samples = 0usize;
        for t in 0..4000 {
            sim.step();
            if t >= 2000 {
                // settle past the modulator startup
                let s = sim.state();
                codes.push(hi(s[5]) | (hi(s[6]) << 1) | (hi(s[7]) << 2));
                bs_high += hi(s[8]) as usize;
                samples += 1;
            }
        }
        (codes, bs_high as f64 / samples as f64)
    }

    /// The 1st-order sigma-delta ADC oversamples a 1-bit modulator and decimates by counting 1s. At DC
    /// inputs whose modulator limit-cycle period divides the decimation block (8) the code is steady:
    /// x = VIN/5 in {0, 1/4, 1/2, 3/4, 1} -> dominant code {0, 2, 4, 6, 7}. And the 1-bit stream's
    /// density tracks the input fraction (the defining sigma-delta property: density of 1s = VIN/VCC).
    #[test]
    fn behavioral_sigma_delta_oversamples() {
        for (vin, want) in [(0.0, 0u32), (1.25, 2), (2.5, 4), (3.75, 6), (5.0, 7)] {
            let (codes, density) = sigma_delta_run(vin);
            // dominant settled code = the expected stable value
            let mode = (0..=7u32)
                .max_by_key(|&c| codes.iter().filter(|&&x| x == c).count())
                .unwrap();
            assert_eq!(
                mode, want,
                "vin {vin}: dominant code {mode} != {want} ({codes:?})"
            );
            // bit-stream density ≈ x = VIN/VCC (the noise-shaped average)
            let x = vin / 5.0;
            assert!(
                (density - x).abs() < 0.12,
                "vin {vin}: bit-stream density {density} not ~{x}"
            );
        }
    }

    /// The 4-bit LUT index is assembled IN0 = `f` (LSB) … IN3 = `c` (MSB). A single-entry truth
    /// table `1 << k` drives OUT high for EXACTLY the input combination whose index is `k` and low
    /// for any other — checked at index 13 (`1101`: IN0,IN2,IN3 high, IN1 low) and index 1 (only
    /// IN0 high), so both the LSB (`f`) and the MSB (`c`) genuinely move the index.
    #[test]
    fn behavioral_lut_four_input_index_ordering() {
        let hi = |v: f64| v > 2.5;
        // truth = 1<<13: high only at index 13 = IN0|IN2|IN3 (f,h,c high; g low).
        assert!(
            hi(lut_comb(1 << 13, 5.0, 0.0, 5.0, 5.0)),
            "index 13 (1101) selects the only set entry ⇒ OUT high"
        );
        // Drop IN3 (c, the MSB) ⇒ index 5, a different entry ⇒ OUT low (proves c is bit 3).
        assert!(
            !hi(lut_comb(1 << 13, 5.0, 0.0, 5.0, 0.0)),
            "clearing the MSB c moves the index off the set entry ⇒ OUT low"
        );
        // truth = 1<<1: high only at index 1 = IN0 alone (proves f is bit 0).
        assert!(
            hi(lut_comb(1 << 1, 5.0, 0.0, 0.0, 0.0)),
            "index 1 ⇒ OUT high"
        );
        assert!(
            !hi(lut_comb(1 << 1, 0.0, 0.0, 0.0, 0.0)),
            "index 0 with the 1<<1 table ⇒ OUT low"
        );
    }

    /// Build a powered **registered** LUT (program 4, mode slot set) whose truth table passes IN0
    /// (`0xAAAA` ⇒ OUT = IN0), with IN0 (`f`) held at `in0_v` and CLK (`b`) chopped from a 5 V rail
    /// by a 50 %-duty switch (pulled down between windows) so it sees rising edges. Nodes: 0 = gnd,
    /// 1 = VCC (5 V), 2 = IN0, 3 = CLK, 4 = clock rail, 5 = OUT (LUT element index 5).
    fn lut_registered_clocked(in0_v: f64) -> Sim {
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 6 * PARAM_STRIDE];
        params[5 * PARAM_STRIDE + BEH_LUT_MODE_SLOT] = 1.0; // LUT (elem 5) registered
        assert!(sim.set_netlist_pefgh(
            6,
            &[
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_SWITCH,
                ELEM_RESISTOR,
                ELEM_BEHAVIORAL
            ],
            &[1, 2, 4, 4, 3, 5], // a: VCC, IN0, clk-rail srcs; SWITCH a=4; R a=3; LUT OUT=5
            &[0, 0, 0, 3, 0, 3], // b: src grounds; SWITCH b=3 (CLK); R b=0; LUT CLK=3
            &[0, 0, 0, 0, 0, 0], // c: LUT IN3 = gnd
            &[0, 0, 0, 0, 0, 1], // d: LUT VCC = node 1
            &[0, 0, 0, 0, 0, 0], // e: LUT GND = node 0
            &[0, 0, 0, 0, 0, 2], // f: LUT IN0 = node 2
            &[0, 0, 0, 0, 0, 0], // g: LUT IN1 = gnd
            &[0, 0, 0, 0, 0, 0], // h: LUT IN2 = gnd
            &[5.0, in0_v, 5.0, 0.5, 1000.0, BEH_PROG_LUT as f64], // SWITCH 0.5 duty, R 1 kΩ pull-down
            &[0.0, 0.0, 0.0, 0.0, 0.0, 0xAAAA as f64],            // aux: pass-IN0 truth table
            &params,
        ));
        sim
    }

    /// ELEM_MEMORY P1 rig (`docs/memory-characterization-design.md`): a well-posed VSOURCE+R solve
    /// plus one inert MEMORY element (addrWidth = 2 ⇒ depth 4) seeded with `seed`. Nodes: 0 = gnd,
    /// 1 = src/R junction. The memory sits on ground (P1 has no terminal-driven read/write yet); it
    /// exists to prove the storage + incremental digest + golden-safe fold.
    fn mem_rig(seed: &[u32]) -> Sim {
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 3 * PARAM_STRIDE];
        params[2 * PARAM_STRIDE + 1] = 2.0; // MEMORY (elem 2): addrWidth = 2 -> depth 4
        assert!(sim.set_netlist_pefgh(
            2,
            &[ELEM_VSOURCE, ELEM_RESISTOR, ELEM_MEMORY],
            &[1, 1, 0],
            &[0, 0, 0],
            &[0, 0, 0],
            &[0, 0, 0],
            &[],
            &[],
            &[],
            &[],
            &[5.0, 1000.0, 0.0],
            &[0.0, 0.0, 0.0],
            &params,
        ));
        sim.load_memory(2, seed);
        sim
    }

    /// A behavioral memory array stores + recalls words, and its incrementally-maintained digest
    /// matches a from-scratch recompute (no drift past `write_cell`). An all-zero store hashes to a
    /// zero digest (so `reset`'s zeroed contents are consistent and the golden is untouched).
    #[test]
    fn memory_stores_and_recalls_words_with_consistent_digest() {
        let seed = [0xDEAD_BEEFu32, 0, 0x1234_5678, 0xFFFF_FFFF];
        let sim = mem_rig(&seed);
        for (k, &w) in seed.iter().enumerate() {
            assert_eq!(sim.mem_read(2, k), w, "word {k}");
        }
        let mut d = 0u64;
        for (k, w) in sim.mem_data[2].iter().enumerate() {
            d ^= mem_cell_hash(k, *w);
        }
        assert_eq!(
            d, sim.mem_digest[2],
            "incremental digest must match recompute"
        );
        let zero = mem_rig(&[0, 0, 0, 0]);
        assert_eq!(zero.mem_digest[2], 0, "all-zero store ⇒ zero digest");
    }

    /// A circuit carrying a memory element hashes deterministically across runs, and distinct
    /// contents produce distinct hashes (the digest genuinely feeds the snapshot fold).
    #[test]
    fn memory_circuit_hashes_deterministically() {
        let seed = [9u32, 0, 7, 3];
        let mut a = mem_rig(&seed);
        let mut b = mem_rig(&seed);
        for _ in 0..50 {
            a.step();
            b.step();
        }
        assert_eq!(
            a.snapshot_hash(),
            b.snapshot_hash(),
            "same contents ⇒ same hash"
        );
        let other = mem_rig(&[1, 0, 0, 0]);
        assert_ne!(
            a.snapshot_hash(),
            other.snapshot_hash(),
            "different contents ⇒ different hash"
        );
    }

    /// Powered cell-level memory (P1): a write through the terminals (WE high latches D_in into the
    /// addressed word) is read back both via `mem_read` and as the driven D_out node voltage.
    /// Nodes: 0 = gnd, 1 = VCC (5 V), 2 = D_out, 3 = WE, 4 = D_in, 5 = A0. addrWidth = 1 (depth 2).
    fn mem_rw_rig(din_v: f64) -> Sim {
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 6 * PARAM_STRIDE];
        params[5 * PARAM_STRIDE + 1] = 1.0; // MEMORY (elem 5): addrWidth = 1 -> depth 2
        assert!(sim.set_netlist_pefgh(
            6,
            &[
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_RESISTOR,
                ELEM_MEMORY,
            ],
            &[1, 3, 4, 5, 2, 2], // a: VCC/WE/Din/A0 src nodes; R→Dout; MEM D_out = 2
            &[0, 0, 0, 0, 0, 3], // b: src grounds; R→gnd; MEM WE = 3
            &[0, 0, 0, 0, 0, 4], // c: MEM D_in = 4
            &[0, 0, 0, 0, 0, 1], // d: MEM VCC = node 1
            &[0, 0, 0, 0, 0, 0], // e: MEM GND = node 0
            &[0, 0, 0, 0, 0, 5], // f: MEM A0 = node 5
            &[0, 0, 0, 0, 0, 0], // g: MEM A1 = gnd
            &[0, 0, 0, 0, 0, 0], // h: MEM A2 = gnd
            &[5.0, 5.0, din_v, 0.0, 1.0e6, 0.0], // VCC 5, WE 5, Din din_v, A0 0, R 1 MΩ load
            &[0.0; 6],
            &params,
        ));
        for _ in 0..20 {
            sim.step();
        }
        sim
    }

    #[test]
    fn memory_writes_and_reads_through_terminals() {
        let hi = mem_rw_rig(5.0);
        assert_eq!(
            hi.mem_read(5, 0),
            1,
            "WE high + D_in high ⇒ word 0 stores 1"
        );
        assert!(
            hi.node_v[2] > 2.5,
            "D_out drives high when the stored bit is 1 (got {})",
            hi.node_v[2]
        );
        let lo = mem_rw_rig(0.0);
        assert_eq!(lo.mem_read(5, 0), 0, "WE high + D_in low ⇒ word 0 stores 0");
        assert!(
            lo.node_v[2] < 2.5,
            "D_out drives low when the stored bit is 0 (got {})",
            lo.node_v[2]
        );
        // the incremental digest stayed consistent through the terminal writes
        let mut d = 0u64;
        for (k, w) in hi.mem_data[5].iter().enumerate() {
            d ^= mem_cell_hash(k, *w);
        }
        assert_eq!(
            d, hi.mem_digest[5],
            "digest consistent after terminal writes"
        );
    }

    /// DRAM (mode 3): a word never re-accessed leaks its stored 1 → 0 once `retention_ticks` elapse
    /// ("refresh or your data rots"), eagerly + deterministically; the continuously-addressed word stays
    /// refreshed. Nodes: 0=gnd, 1=VCC(5), 2=D_out, 3=WE(5), 4=D_in(0), 5=A0(5 ⇒ address 1).
    fn dram_rig() -> Sim {
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 6 * PARAM_STRIDE];
        params[5 * PARAM_STRIDE] = 3.0; // MEMORY (elem 5): mode 3 = DRAM
        params[5 * PARAM_STRIDE + 1] = 1.0; // addrWidth 1 → depth 2
        params[5 * PARAM_STRIDE + 4] = 5.0; // retention_ticks = 5
        assert!(sim.set_netlist_pefgh(
            6,
            &[
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_RESISTOR,
                ELEM_MEMORY,
            ],
            &[1, 3, 4, 5, 2, 2],
            &[0, 0, 0, 0, 0, 3],
            &[0, 0, 0, 0, 0, 4],
            &[0, 0, 0, 0, 0, 1],
            &[0, 0, 0, 0, 0, 0],
            &[0, 0, 0, 0, 0, 5], // A0 = node 5 (high ⇒ address 1; word 0 never accessed)
            &[0, 0, 0, 0, 0, 0],
            &[0, 0, 0, 0, 0, 0],
            &[5.0, 5.0, 0.0, 5.0, 1.0e6, 0.0],
            &[0.0; 6],
            &params,
        ));
        sim.load_memory(5, &[1, 0]); // word 0 = 1 (never addressed → must rot)
        sim
    }

    #[test]
    fn dram_word_rots_without_refresh() {
        let mut sim = dram_rig();
        for _ in 0..4 {
            sim.step();
        }
        assert_eq!(
            sim.mem_read(5, 0),
            1,
            "word 0 holds before retention elapses"
        );
        for _ in 0..10 {
            sim.step();
        }
        assert_eq!(
            sim.mem_read(5, 0),
            0,
            "word 0 rots once unrefreshed past retention"
        );
        // Deterministic: a second identical run rots at the same tick + hashes identically (the per-word
        // refresh epoch is in the snapshot, so a rewind onto a decay tick replays bit-for-bit).
        let mut b = dram_rig();
        for _ in 0..14 {
            b.step();
        }
        assert_eq!(b.mem_read(5, 0), 0);
        assert_eq!(
            sim.snapshot_hash(),
            b.snapshot_hash(),
            "DRAM rot is deterministic"
        );
    }

    /// Word-level wide memory (P3, option A): a **4-word × 4-bit RAM** driven through the explicit
    /// address / data-in / data-out bus lists ([`Sim::set_memory_ports`]), NOT the 8 fixed terminals
    /// (which carry only WE / VCC / GND). Nodes: 0 = gnd, 1 = VCC(5), 2 = WE, 3 = A0, 4 = A1, 5..8 =
    /// DI0..3, 9..12 = DO0..3 (each pulled to gnd through 1 MΩ so the driven data-out level reads back as
    /// `node_v`). The memory's `a`/`c`/`f`/`g`/`h` terminals are unused (grounded). `seed` (if non-empty)
    /// pre-loads the store before stepping. This is the CPU/Doom-grade wide port: one element spans a bus
    /// the 8 terminals could never hold.
    fn wide_mem_rig(we: f64, a0: f64, a1: f64, di: [f64; 4], seed: &[u32]) -> Sim {
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 13 * PARAM_STRIDE];
        params[12 * PARAM_STRIDE] = 1.0; // MEMORY (elem 12): mode 1 = RAM
        params[12 * PARAM_STRIDE + 1] = 2.0; // addrWidth 2 → depth 4
        params[12 * PARAM_STRIDE + 3] = 4.0; // wordWidth 4 (engine reads bus-list lengths; documents intent)
        assert!(sim.set_netlist_pefgh(
            13,
            &[
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_VSOURCE,
                ELEM_RESISTOR,
                ELEM_RESISTOR,
                ELEM_RESISTOR,
                ELEM_RESISTOR,
                ELEM_MEMORY,
            ],
            &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0], // a: src +nodes; DO pulldowns; MEM a unused
            &[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],    // b: src/R grounds; MEM WE = node 2
            &[0; 13],                                    // c: MEM D_in (cell) unused
            &[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],    // d: MEM VCC = node 1
            &[0; 13],                                    // e: MEM GND = node 0
            &[0; 13],                                    // f
            &[0; 13],                                    // g
            &[0; 13],                                    // h
            &[5.0, we, a0, a1, di[0], di[1], di[2], di[3], 1e6, 1e6, 1e6, 1e6, 0.0],
            &[0.0; 13],
            &params,
        ));
        // Wide bus-port: address = [A0, A1], data-in = [DI0..3], data-out = [DO0..3] (LSB first).
        sim.set_memory_ports(12, &[3, 4], &[5, 6, 7, 8], &[9, 10, 11, 12]);
        if !seed.is_empty() {
            sim.load_memory(12, seed);
        }
        for _ in 0..20 {
            sim.step();
        }
        sim
    }

    /// A write through the wide bus-port latches the **whole assembled word** at the **bus address**, and
    /// the data-out bus reads the same word back — the round-trip proof that the explicit per-bit channel
    /// (option A) carries a wide address + data correctly. Write `0b1010` to address 1.
    #[test]
    fn wide_memory_writes_and_reads_through_bus_port() {
        // WE high; A0=5 / A1=0 ⇒ address 1; DI = bits {1, 3} high ⇒ word 0b1010 (= 10).
        let s = wide_mem_rig(5.0, 5.0, 0.0, [0.0, 5.0, 0.0, 5.0], &[]);
        assert_eq!(
            s.mem_read(12, 1),
            0b1010,
            "wide write latches the assembled word at the bus address"
        );
        assert_eq!(
            s.mem_read(12, 0),
            0,
            "other rows untouched by the addressed write"
        );
        // Data-out bus reads the same word back: DO1, DO3 high; DO0, DO2 low.
        assert!(
            s.node_v[10] > 2.5 && s.node_v[12] > 2.5,
            "DO1 / DO3 driven high (got {} / {})",
            s.node_v[10],
            s.node_v[12]
        );
        assert!(
            s.node_v[9] < 2.5 && s.node_v[11] < 2.5,
            "DO0 / DO2 driven low (got {} / {})",
            s.node_v[9],
            s.node_v[11]
        );
    }

    /// With WE low (read-only, ROM-style), the wide port **decodes the address** and reads the seeded
    /// word at that row onto the data-out bus — proving multi-row address decode, not just a single word.
    #[test]
    fn wide_memory_reads_seeded_word_at_addressed_row() {
        // No writes (WE low). Seed rows 0..3; address row 2 (A0=0, A1=5) ⇒ word 0b1100.
        let s = wide_mem_rig(0.0, 0.0, 5.0, [0.0; 4], &[0b0001, 0b0010, 0b1100, 0b1111]);
        assert_eq!(
            s.mem_read(12, 2),
            0b1100,
            "seed intact (no writes with WE low)"
        );
        // word 0b1100 → DO2 / DO3 high, DO0 / DO1 low.
        assert!(
            s.node_v[11] > 2.5 && s.node_v[12] > 2.5,
            "DO2 / DO3 high for the addressed word (got {} / {})",
            s.node_v[11],
            s.node_v[12]
        );
        assert!(
            s.node_v[9] < 2.5 && s.node_v[10] < 2.5,
            "DO0 / DO1 low for the addressed word (got {} / {})",
            s.node_v[9],
            s.node_v[10]
        );
    }

    /// The wide bus-port path is on the determinism contract: a long run of a wide RAM hashes identically
    /// every time (the address decode, the per-bit drive, and the digest fold are all integer-pure).
    #[test]
    fn wide_memory_run_is_reproducible() {
        let run = || {
            let mut s = wide_mem_rig(5.0, 5.0, 0.0, [0.0, 5.0, 0.0, 5.0], &[]);
            let mut acc = s.snapshot_hash();
            for _ in 0..200 {
                s.step();
                acc ^= s.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "wide memory must reproduce exactly");
    }

    /// A registered LUT is a LUT followed by a flip-flop: with CLK held low it never latches (Q
    /// holds its reset 0 even though IN0 is high), and under a real clock it latches IN0 onto Q and
    /// drives OUT high — the building block of all sequential FPGA logic.
    #[test]
    fn behavioral_lut_registered_latches_on_clock() {
        // No clock edge ever (CLK grounded via the switched node never rising)? Use a dedicated
        // held-low clock: reuse the combinational rig but in registered mode with CLK at gnd.
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 3 * PARAM_STRIDE];
        params[2 * PARAM_STRIDE + BEH_LUT_MODE_SLOT] = 1.0; // registered
                                                            // Nodes: 0 = gnd, 1 = VCC, 2 = IN0 (5 V), 3 = OUT. CLK (b) = gnd ⇒ no edge.
        assert!(sim.set_netlist_pefgh(
            4,
            &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_BEHAVIORAL],
            &[1, 2, 3],
            &[0, 0, 0], // LUT CLK (b) = gnd ⇒ never rises
            &[0, 0, 0], // IN3 = gnd
            &[0, 0, 1], // VCC = node 1
            &[0, 0, 0], // GND = node 0
            &[0, 0, 2], // IN0 = node 2 (held high)
            &[0, 0, 0], // IN1 = gnd
            &[0, 0, 0], // IN2 = gnd
            &[5.0, 5.0, BEH_PROG_LUT as f64],
            &[0.0, 0.0, 0xAAAA as f64], // out = IN0
            &params,
        ));
        for _ in 0..80 {
            sim.step();
        }
        assert_eq!(
            sim.beh_lut_q(2),
            0,
            "a registered LUT with no clock edge must hold its reset Q=0 despite IN0 high"
        );
        assert!(
            sim.state()[3].abs() < 0.5,
            "OUT follows the held Q=0 (driven low, not the live IN0): {}",
            sim.state()[3]
        );

        // Under a real clock the registered LUT latches IN0 (high) onto Q and drives OUT high.
        let mut clocked = lut_registered_clocked(5.0);
        for _ in 0..300 {
            clocked.step();
        }
        assert_eq!(
            clocked.beh_lut_q(5),
            1,
            "a clocked registered LUT latches IN0=1 onto Q"
        );
        assert!(
            clocked.state()[5] > 4.0,
            "registered OUT drives high once Q latches: {}",
            clocked.state()[5]
        );
    }

    /// An unpowered LUT releases its output (high-Z, ~0 V) regardless of its truth table — even the
    /// all-ones table `0xFFFF` (which would drive high if powered) reads released when VCC is unwired.
    #[test]
    fn behavioral_lut_unpowered_is_released() {
        // VCC pin (d) = node 0 ⇒ rail collapses ⇒ output released even though the table is all-ones.
        let out = {
            let mut sim = Sim::new(1);
            let params = vec![0.0; 2 * PARAM_STRIDE];
            assert!(sim.set_netlist_pefgh(
                3,
                &[ELEM_VSOURCE, ELEM_BEHAVIORAL],
                &[1, 2], // a: a 5 V source on node 1; LUT OUT = node 2
                &[0, 0], // b: LUT CLK = gnd
                &[0, 0], // c: IN3 = gnd
                &[0, 0], // d: LUT VCC = node 0 ⇒ unpowered
                &[0, 0], // e: LUT GND = node 0
                &[0, 1], // f: IN0 = node 1 (high) — but the chip is dead
                &[0, 0], // g
                &[0, 0], // h
                &[5.0, BEH_PROG_LUT as f64],
                &[0.0, 0xFFFF as f64], // all-ones table
                &params,
            ));
            for _ in 0..40 {
                sim.step();
            }
            sim.state()[2]
        };
        assert!(
            out.abs() < 0.5,
            "an unpowered LUT releases its output (~0 V), not a driven rail: {out}"
        );
    }

    /// A registered LUT under an active clock (live sequential state) reproduces bit-for-bit: two
    /// fresh `Sim`s run the same netlist and agree on the snapshot-hash sequence at EVERY tick,
    /// including the exact ticks a clock edge latches Q. The determinism guarantee with the FPGA
    /// logic element ACTIVE.
    #[test]
    fn behavioral_lut_run_is_reproducible() {
        let mut a = lut_registered_clocked(5.0);
        let mut b = lut_registered_clocked(5.0);
        for tk in 0..400 {
            a.step();
            b.step();
            assert_eq!(
                a.snapshot_hash(),
                b.snapshot_hash(),
                "a registered-LUT circuit must replay bit-for-bit (diverged at tick {tk})"
            );
        }
    }

    /// A six-/seven-terminal behavioral netlist installs; an out-of-range terminal is rejected
    /// fail-safe (mirrors the comparator's / sampler's arity validation).
    #[test]
    fn behavioral_netlist_validates() {
        let mut sim = Sim::new(1);
        assert!(
            sim.set_netlist_pefgh(
                8,
                &[ELEM_BEHAVIORAL],
                &[1],
                &[2],
                &[3],
                &[4],
                &[5],
                &[6],
                &[7],
                &[],
                &[1.0],
                &[0.0],
                &[],
            ),
            "valid seven-terminal behavioral block installs"
        );
        assert!(
            !sim.set_netlist_pefgh(
                8,
                &[ELEM_BEHAVIORAL],
                &[1],
                &[2],
                &[3],
                &[4],
                &[5],
                &[6],
                &[9], // START out of range
                &[],
                &[1.0],
                &[0.0],
                &[],
            ),
            "out-of-range START terminal g is rejected"
        );
    }

    /// A behavioral-block netlist (active integer state) reproduces bit-for-bit: two fresh `Sim`s
    /// run the same SPI-master netlist for N steps and agree on the snapshot hash at EVERY tick —
    /// the determinism guarantee with the protocol engine ACTIVE (its state words are hashed).
    #[test]
    fn behavioral_run_is_reproducible() {
        let build = || spi_master(0xA5 as f64, 2.0, 8.0, 4); // MOSI→MISO loopback, active transaction
        let (mut a, mut b) = (build(), build());
        for tk in 0..600 {
            a.step();
            b.step();
            assert_eq!(
                a.snapshot_hash(),
                b.snapshot_hash(),
                "behavioral block diverged at tick {tk} (its integer state must be hashed)"
            );
        }
    }

    // --- Behavioral programs 2 & 3: SPI slave + UART --------------------------
    //
    // Program 2 is the receiving end of the phase-1 SPI master (Mode 0). Pins:
    // f=SCLK (in), g=MOSI (in), h=CS (in); a=MISO (out), b=RXVALID (out); d=VCC, e=GND.
    // Program 3 is an async UART (TX+RX in one block). Pins: a=TX (out), b=RXVALID (out);
    // f=RX (in), g=SEND (in); d=VCC, e=GND. aux = the byte to send; params[0] = baud
    // divider (ticks/bit), params[1] = data bits. Both run at the base tick rate (no
    // sub-ticking) and lay their integer state out their own way in `beh_state`.

    /// Wire a phase-1 SPI **master** (program 1) to an SPI **slave** (program 2) on a shared
    /// 4-wire bus: master SCLK(a)→slave SCLK(f), master MOSI(b)→slave MOSI(g), master CS(c)→slave
    /// CS(h), slave MISO(a)→master MISO(f). The master is triggered once (START tied high), sending
    /// `tx`; the slave replies `reply`. Nodes: 0=gnd, 1=VCC(5V), 2=START(5V), 3=SCLK, 4=MOSI,
    /// 5=CS, 6=MISO, 7=RXVALID. Elements: [VCC src, START src, master, slave]; master is index 2,
    /// slave index 3. Returns the installed `Sim` at t=0.
    fn spi_master_slave(tx: f64, reply: f64, half: f64, nbits: f64) -> Sim {
        let mut sim = Sim::new(1);
        // params: master gets [half, nbits] in slots 0/1; slave gets [_, nbits] in slot 1.
        let mut params = vec![0.0; 4 * PARAM_STRIDE];
        params[2 * PARAM_STRIDE] = half; // master params[0] = SCLK half-period
        params[2 * PARAM_STRIDE + 1] = nbits; // master params[1] = bit count
        params[3 * PARAM_STRIDE + 1] = nbits; // slave  params[1] = bit count
        assert!(sim.set_netlist_pefgh(
            8,
            &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_BEHAVIORAL, ELEM_BEHAVIORAL],
            &[1, 2, 3, 6],         // a: VCC src, START src, master SCLK=3, slave MISO=6
            &[0, 0, 4, 7],         // b: src grounds; master MOSI=4, slave RXVALID=7
            &[0, 0, 5, 0],         // c: master CS=5; slave c unused
            &[0, 0, 1, 1],         // d: VCC = node 1 (both chips)
            &[0, 0, 0, 0],         // e: GND = node 0
            &[0, 0, 6, 3],         // f: master MISO=6, slave SCLK=3
            &[0, 0, 2, 4],         // g: master START=2, slave MOSI=4
            &[0, 0, 0, 5],         // h: slave CS=5 (master h unused)
            &[5.0, 5.0, 1.0, 2.0], // values: VCC, START, master prog 1, slave prog 2
            &[0.0, 0.0, tx, reply], // aux: master TX word, slave reply word
            &params,
        ));
        sim
    }

    /// Full-duplex byte exchange over the 4-wire bus: a phase-1 SPI **master** (program 1) clocks a
    /// byte to an SPI **slave** (program 2) while the slave clocks its reply back on MISO. After the
    /// transaction the slave's received word equals the master's transmitted byte (and RXVALID
    /// pulsed), and the master's `shift_in` equals the slave's reply word — a true full-duplex link.
    /// Non-palindromic bytes (0x39 ↔ bit-reverse 0x9C; 0xC6 ↔ 0x63) so MSB-first ordering is genuinely
    /// under test on BOTH directions.
    #[test]
    fn behavioral_spi_master_to_slave_link() {
        let tx = 0x39u32; // master → slave
        let reply = 0xC6u32; // slave → master
        let nbits = 8usize;
        let half = 2.0;
        let mut sim = spi_master_slave(tx as f64, reply as f64, half, nbits as f64);
        // Run well past one transaction (nbits*2*half SCLK ticks + cross-element pipeline delay).
        let mut slave_rxvalid_pulsed = false;
        for _ in 0..200 {
            sim.step();
            if sim.beh_spi_slave_rxvalid(3) != 0 {
                slave_rxvalid_pulsed = true;
            }
        }
        // Slave received the master's transmitted byte, MSB-first.
        let rx = sim.beh_spi_slave_rx_word(3);
        assert_eq!(
            rx, tx,
            "SPI slave must receive the master's byte 0x{tx:02X} (got 0x{rx:02X})"
        );
        assert!(
            slave_rxvalid_pulsed,
            "SPI slave RXVALID must pulse when a word is received"
        );
        // Master read back the slave's reply on MISO, MSB-first (full duplex).
        let got = sim.beh_spi_shift_in(2);
        assert_eq!(
            got, reply,
            "SPI master must read the slave's reply 0x{reply:02X} on MISO (got 0x{got:02X})"
        );
    }

    /// UART loopback: with TX wired to RX, a byte sent on a rising SEND edge is framed out on TX,
    /// sampled back in on RX, and latched — the received byte equals the transmitted one and
    /// RXVALID pulsed. Checked for 0x5A AND a genuinely **non-palindromic** byte (0x53 = 0101_0011,
    /// bit-reverse 0xCA differs) so the LSB-first framing/assembly ordering is actually under test —
    /// 0x5A alone is bit-symmetric and would pass either order. Exercises start/data(LSB-first)/stop
    /// framing end-to-end through the mid-bit RX sampler.
    #[test]
    fn behavioral_uart_loopback() {
        let baud = 16usize;
        let nbits = 8usize;
        for &byte in &[0x5Au32, 0x53u32] {
            let mut sim = uart_setup_loopback(byte as f64, baud as f64, nbits as f64);
            // A full frame is (1 start + nbits data + 1 stop) * baud ticks, plus the 1.5-bit RX
            // first-sample delay and a tick of output pipeline. Run generously past it.
            let frame_ticks = (nbits + 2) * baud + 2 * baud; // + margin
            let mut rxvalid_pulsed = false;
            // UART is element index 2 in `uart_setup_loopback` (after VCC + SEND sources).
            for _ in 0..(frame_ticks + 32) {
                sim.step();
                if sim.beh_uart_rxvalid(2) != 0 {
                    rxvalid_pulsed = true;
                }
            }
            let rx = sim.beh_uart_rx_word(2);
            assert_eq!(
                rx, byte,
                "UART loopback must receive the transmitted byte 0x{byte:02X} (got 0x{rx:02X})"
            );
            assert!(
                rxvalid_pulsed,
                "UART RXVALID must pulse when a byte 0x{byte:02X} is received"
            );
        }
    }

    /// Build a UART loopback netlist with an explicit SEND source: TX(a) tied to RX(f) on node 3,
    /// SEND(g) driven high by a source on node 2, VCC on node 1. Nodes: 0=gnd, 1=VCC(5V),
    /// 2=SEND(5V), 3=TX/RX wire, 4=RXVALID. UART is element index 2 (after the two sources).
    fn uart_setup_loopback(byte: f64, baud: f64, nbits: f64) -> Sim {
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 3 * PARAM_STRIDE];
        params[2 * PARAM_STRIDE] = baud; // UART (elem 2) params[0] = baud divider
        params[2 * PARAM_STRIDE + 1] = nbits; // UART params[1] = data bits
        assert!(sim.set_netlist_pefgh(
            5,
            &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_BEHAVIORAL],
            &[1, 2, 3],        // a: VCC src=1, SEND src=2, UART TX=3
            &[0, 0, 4],        // b: src grounds; UART RXVALID=4
            &[0, 0, 0],        // c: unused
            &[0, 0, 1],        // d: UART VCC = node 1
            &[0, 0, 0],        // e: UART GND = node 0
            &[0, 0, 3],        // f: UART RX = node 3 (== TX: loopback)
            &[0, 0, 2],        // g: UART SEND = node 2 (held high)
            &[0, 0, 0],        // h: unused
            &[5.0, 5.0, 3.0],  // values: VCC, SEND rail, UART program id 3
            &[0.0, 0.0, byte], // aux: UART byte to transmit
            &params,
        ));
        sim
    }

    /// With **no SEND pulse** the UART line idles HIGH (mark) for the whole run and never raises a
    /// spurious RXVALID — the quiescent contract (an idle async line sits at mark, the receiver
    /// waits for a real start bit). SEND (g) is grounded so no edge ever fires; TX is observed on
    /// the bus node, RX is tied to TX so it sees the same idle-high line.
    #[test]
    fn behavioral_uart_idle_line_high() {
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 2 * PARAM_STRIDE];
        params[PARAM_STRIDE] = 16.0; // baud divider
        params[PARAM_STRIDE + 1] = 8.0; // data bits
                                        // Nodes: 0=gnd, 1=VCC(5V), 2=TX/RX wire, 3=RXVALID. SEND (g)=0 (grounded → never fires).
        assert!(sim.set_netlist_pefgh(
            4,
            &[ELEM_VSOURCE, ELEM_BEHAVIORAL],
            &[1, 2],             // a: VCC src=1, UART TX=2
            &[0, 3],             // b: src ground; UART RXVALID=3
            &[0, 0],             // c: unused
            &[0, 1],             // d: UART VCC = node 1
            &[0, 0],             // e: UART GND = node 0
            &[0, 2],             // f: UART RX = node 2 (== TX: loopback)
            &[0, 0],             // g: UART SEND = 0 (grounded → no edge)
            &[0, 0],             // h: unused
            &[5.0, 3.0],         // values: VCC, UART program id 3
            &[0.0, 0x5A as f64], // aux: a byte (never sent — SEND never rises)
            &params,
        ));
        for tk in 0..200 {
            sim.step();
            assert!(
                spi_pin_high(sim.state()[2]),
                "idle UART TX must stay HIGH/mark (tick {tk}, got {})",
                sim.state()[2]
            );
            assert_eq!(
                sim.beh_uart_rxvalid(1),
                0,
                "idle UART must never raise RXVALID (tick {tk})"
            );
        }
        // And nothing was ever received.
        assert_eq!(
            sim.beh_uart_rx_word(1),
            0,
            "idle UART must not latch any received byte"
        );
    }

    /// A slave/UART netlist reproduces bit-for-bit: two fresh `Sim`s run the same master↔slave SPI
    /// link AND a UART loopback for N steps and agree on the snapshot hash at EVERY tick — the
    /// determinism guarantee with programs 2 & 3 ACTIVE (their integer state words are hashed).
    #[test]
    fn behavioral_slave_uart_run_is_reproducible() {
        let build_spi = || spi_master_slave(0x39 as f64, 0xC6 as f64, 2.0, 8.0);
        let (mut a, mut b) = (build_spi(), build_spi());
        for tk in 0..400 {
            a.step();
            b.step();
            assert_eq!(
                a.snapshot_hash(),
                b.snapshot_hash(),
                "SPI master↔slave link diverged at tick {tk} (slave state must be hashed)"
            );
        }
        let build_uart = || uart_setup_loopback(0x5A as f64, 16.0, 8.0);
        let (mut c, mut d) = (build_uart(), build_uart());
        for tk in 0..400 {
            c.step();
            d.step();
            assert_eq!(
                c.snapshot_hash(),
                d.snapshot_hash(),
                "UART loopback diverged at tick {tk} (UART state must be hashed)"
            );
        }
    }

    // --- Multi-rate sub-ticking (ADR 0004 step 3b) ----------------------------
    //
    // A behavioral block declares a structural sub-tick rate N in params[2]
    // (BEH_SUBTICK_RATE_SLOT); the global S = max N drives the sub-tick loop in step().
    // N unset/1 (every existing circuit) ⇒ S = 1 ⇒ the loop is skipped ⇒ byte-identical.

    /// UART loopback with a declared sub-tick rate in `params[2]` — same wiring as
    /// `uart_setup_loopback`, plus the rate. `rate <= 1` is the existing single-rate path.
    fn uart_setup_loopback_rate(byte: f64, baud: f64, nbits: f64, rate: f64) -> Sim {
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 3 * PARAM_STRIDE];
        params[2 * PARAM_STRIDE] = baud; // UART (elem 2) params[0] = baud divider
        params[2 * PARAM_STRIDE + 1] = nbits; // params[1] = data bits
        params[2 * PARAM_STRIDE + BEH_SUBTICK_RATE_SLOT] = rate; // params[2] = sub-tick rate N
        assert!(sim.set_netlist_pefgh(
            5,
            &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_BEHAVIORAL],
            &[1, 2, 3],        // a: VCC src=1, SEND src=2, UART TX=3
            &[0, 0, 4],        // b: src grounds; UART RXVALID=4
            &[0, 0, 0],        // c: unused
            &[0, 0, 1],        // d: UART VCC = node 1
            &[0, 0, 0],        // e: UART GND = node 0
            &[0, 0, 3],        // f: UART RX = node 3 (== TX: loopback)
            &[0, 0, 2],        // g: UART SEND = node 2 (held high)
            &[0, 0, 0],        // h: unused
            &[5.0, 5.0, 3.0],  // values: VCC, SEND rail, UART program id 3
            &[0.0, 0.0, byte], // aux: UART byte to transmit
            &params,
        ));
        sim
    }

    /// The first **analog** tick at which the UART loopback's latched received word equals `byte`,
    /// at the given sub-tick rate — and whether RXVALID was observed pulsing at any analog-tick
    /// boundary. The latched `rx_word` PERSISTS (it holds the last completed byte), so it is the
    /// observable analog-boundary signal at ANY rate; RXVALID is a one-DIGITAL-tick pulse, so at a
    /// high sub-tick rate it can fire and clear entirely within one analog tick's sub-ticks and so
    /// is invisible at the boundary — the persistent `rx_word` is what we time the frame by. Returns
    /// `(analog_tick, rxvalid_seen_at_boundary)` or `None` if the byte never arrives in `max_ticks`.
    /// The UART is element index 2.
    fn uart_rx_complete_tick(
        byte: u32,
        baud: f64,
        nbits: f64,
        rate: f64,
        max_ticks: usize,
    ) -> Option<(usize, bool)> {
        let mut sim = uart_setup_loopback_rate(byte as f64, baud, nbits, rate);
        let mut rxvalid_seen = false;
        for tk in 0..max_ticks {
            sim.step();
            if sim.beh_uart_rxvalid(2) != 0 {
                rxvalid_seen = true;
            }
            if sim.beh_uart_rx_word(2) == byte {
                return Some((tk, rxvalid_seen));
            }
        }
        None
    }

    /// **`subtick_n1_is_byte_identical`** — a behavioral circuit built with `params[2]` set to 1
    /// (an explicitly declared rate of one sub-tick per analog tick) produces the **exact same
    /// `snapshot_hash` stream** as the same circuit built with no rate param at all. This is the
    /// hard requirement: declaring `N = 1` must take the `S = 1` path (the sub-tick branch is
    /// skipped), so it is bit-for-bit the legacy engine. Covered for a UART loopback AND a
    /// master↔slave SPI link (programs 2 & 3, with hashed integer state).
    #[test]
    fn subtick_n1_is_byte_identical() {
        // UART: rate-1 vs no-rate.
        let mut with_n1 = uart_setup_loopback_rate(0x5A as f64, 16.0, 8.0, 1.0);
        let mut without = uart_setup_loopback(0x5A as f64, 16.0, 8.0);
        assert_eq!(with_n1.subtick_rate, 1, "declared N=1 must give global S=1");
        assert_eq!(
            without.subtick_rate, 1,
            "no rate param must give global S=1"
        );
        for tk in 0..400 {
            with_n1.step();
            without.step();
            assert_eq!(
                with_n1.snapshot_hash(),
                without.snapshot_hash(),
                "UART: declared N=1 must be byte-identical to no rate param (tick {tk})"
            );
        }
        // SPI master↔slave: rate-1 vs no-rate (both blocks at N=1).
        let mut spi_n1 = spi_master_slave_rate(0x39 as f64, 0xC6 as f64, 2.0, 8.0, 1.0);
        let mut spi_plain = spi_master_slave(0x39 as f64, 0xC6 as f64, 2.0, 8.0);
        assert_eq!(spi_n1.subtick_rate, 1);
        assert_eq!(spi_plain.subtick_rate, 1);
        for tk in 0..400 {
            spi_n1.step();
            spi_plain.step();
            assert_eq!(
                spi_n1.snapshot_hash(),
                spi_plain.snapshot_hash(),
                "SPI: declared N=1 must be byte-identical to no rate param (tick {tk})"
            );
        }
    }

    /// **`subtick_speeds_up_uart`** (the payoff) — a UART loopback at `params[2] = 16` completes a
    /// full frame in ~16× fewer **analog** ticks than the same UART at rate 1, because 16 digital
    /// sub-ticks run per analog tick (megabaud against the 2 µs analog tick). We compare the analog
    /// tick at which RXVALID first pulses in the loopback, and assert the byte still round-trips
    /// (0x5A) in BOTH cases — the speedup must not corrupt the data.
    #[test]
    fn subtick_speeds_up_uart() {
        let byte = 0x5Au32;
        let (baud, nbits) = (16.0, 8.0);
        // Rate 1: a full frame is (1 start + 8 data + 1 stop) * 16 baud ticks + RX sampling delay,
        // and the byte arrives only because the loopback round-trips it (the helper returns `Some`
        // ONLY when rx_word == byte, so reaching here proves the round-trip at rate 1). RXVALID is
        // a single analog tick at rate 1, so it IS observed at a boundary there.
        let (slow_tick, slow_rxvalid) =
            uart_rx_complete_tick(byte, baud, nbits, 1.0, 4000).expect("rate-1 UART must receive");
        assert!(
            slow_rxvalid,
            "rate-1 UART RXVALID must pulse at an analog-tick boundary"
        );
        // Rate 16: 16 digital sub-ticks per analog tick ⇒ the same frame completes in ~16× fewer
        // ANALOG ticks (megabaud against the 2 µs analog tick). The byte still round-trips (again,
        // the helper only returns `Some` when rx_word == 0x5A — the speedup did not corrupt it).
        let (fast_tick, _fast_rxvalid) = uart_rx_complete_tick(byte, baud, nbits, 16.0, 4000)
            .expect("rate-16 UART must receive");
        // The speedup is real and close to the declared rate (16). The frame is the same number of
        // DIGITAL ticks in both runs; at rate R it lands at ≈ that / R analog ticks, so the ratio is
        // ≈ 16. Require ≥ 8× (comfortably proving the multi-rate kernel over-clocks the digital
        // domain against the fixed analog Δt).
        let speedup = (slow_tick + 1) as f64 / (fast_tick + 1) as f64;
        assert!(
            speedup >= 8.0,
            "rate-16 UART must complete a frame ≥8× faster (slow tick {slow_tick}, fast tick \
             {fast_tick}, speedup {speedup:.1}×)"
        );
    }

    /// Wire an SPI **master**↔**slave** link (as `spi_master_slave`) with a declared sub-tick rate
    /// in BOTH blocks' `params[2]`. `rate <= 1` is the existing single-rate path.
    fn spi_master_slave_rate(tx: f64, reply: f64, half: f64, nbits: f64, rate: f64) -> Sim {
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 4 * PARAM_STRIDE];
        params[2 * PARAM_STRIDE] = half; // master params[0] = SCLK half-period
        params[2 * PARAM_STRIDE + 1] = nbits; // master params[1] = bit count
        params[2 * PARAM_STRIDE + BEH_SUBTICK_RATE_SLOT] = rate; // master sub-tick rate
        params[3 * PARAM_STRIDE + 1] = nbits; // slave  params[1] = bit count
        params[3 * PARAM_STRIDE + BEH_SUBTICK_RATE_SLOT] = rate; // slave sub-tick rate
        assert!(sim.set_netlist_pefgh(
            8,
            &[ELEM_VSOURCE, ELEM_VSOURCE, ELEM_BEHAVIORAL, ELEM_BEHAVIORAL],
            &[1, 2, 3, 6],         // a: VCC src, START src, master SCLK=3, slave MISO=6
            &[0, 0, 4, 7],         // b: src grounds; master MOSI=4, slave RXVALID=7
            &[0, 0, 5, 0],         // c: master CS=5; slave c unused
            &[0, 0, 1, 1],         // d: VCC = node 1 (both chips)
            &[0, 0, 0, 0],         // e: GND = node 0
            &[0, 0, 6, 3],         // f: master MISO=6, slave SCLK=3
            &[0, 0, 2, 4],         // g: master START=2, slave MOSI=4
            &[0, 0, 0, 5],         // h: slave CS=5 (master h unused)
            &[5.0, 5.0, 1.0, 2.0], // values: VCC, START, master prog 1, slave prog 2
            &[0.0, 0.0, tx, reply], // aux: master TX word, slave reply word
            &params,
        ));
        sim
    }

    /// **`subtick_spi_link_fast`** — the master↔slave SPI link from phase 2, with both blocks at
    /// `params[2] = 8`: the full-duplex byte exchange completes in fewer analog ticks (each block
    /// runs 8 sub-ticks per analog tick) and the received bytes still match in BOTH directions
    /// (slave RX == master TX, master shift_in == slave reply).
    #[test]
    fn subtick_spi_link_fast() {
        let tx = 0x39u32; // master → slave
        let reply = 0xC6u32; // slave → master
        let (half, nbits) = (2.0, 8.0);

        // Find the analog tick at which the slave's RXVALID first pulses, at a given rate.
        let rxvalid_tick = |rate: f64| -> Option<usize> {
            let mut sim = spi_master_slave_rate(tx as f64, reply as f64, half, nbits, rate);
            for tk in 0..4000 {
                sim.step();
                if sim.beh_spi_slave_rxvalid(3) != 0 {
                    return Some(tk);
                }
            }
            None
        };
        let slow = rxvalid_tick(1.0).expect("rate-1 SPI link must complete");
        let fast = rxvalid_tick(8.0).expect("rate-8 SPI link must complete");
        assert!(
            (fast + 1) * 4 < (slow + 1),
            "rate-8 SPI link must finish in far fewer analog ticks (slow {slow}, fast {fast})"
        );

        // The fast link still exchanges both bytes correctly.
        let mut sim = spi_master_slave_rate(tx as f64, reply as f64, half, nbits, 8.0);
        let mut slave_rxvalid_pulsed = false;
        for _ in 0..400 {
            sim.step();
            if sim.beh_spi_slave_rxvalid(3) != 0 {
                slave_rxvalid_pulsed = true;
            }
        }
        assert!(slave_rxvalid_pulsed, "rate-8 SPI slave RXVALID must pulse");
        assert_eq!(
            sim.beh_spi_slave_rx_word(3),
            tx,
            "rate-8 SPI slave must receive the master's byte"
        );
        assert_eq!(
            sim.beh_spi_shift_in(2),
            reply,
            "rate-8 SPI master must read the slave's reply (full duplex)"
        );
    }

    /// **`subtick_run_is_reproducible`** — a fast-rate circuit run on two fresh `Sim`s produces the
    /// identical `snapshot_hash` at EVERY analog tick. The sub-tick loop is deterministic float
    /// arithmetic over structural counts, so the multi-rate path reproduces by construction.
    #[test]
    fn subtick_run_is_reproducible() {
        let build = || uart_setup_loopback_rate(0x5A as f64, 16.0, 8.0, 16.0);
        let (mut a, mut b) = (build(), build());
        assert_eq!(a.subtick_rate, 16, "the fast UART must run at S=16");
        for tk in 0..400 {
            a.step();
            b.step();
            assert_eq!(
                a.snapshot_hash(),
                b.snapshot_hash(),
                "fast-rate UART diverged at analog tick {tk}"
            );
        }
        // Also a fast SPI link (both programs active, both fast).
        let build_spi = || spi_master_slave_rate(0x39 as f64, 0xC6 as f64, 2.0, 8.0, 8.0);
        let (mut c, mut d) = (build_spi(), build_spi());
        for tk in 0..400 {
            c.step();
            d.step();
            assert_eq!(
                c.snapshot_hash(),
                d.snapshot_hash(),
                "fast-rate SPI link diverged at analog tick {tk}"
            );
        }
    }

    /// **`subtick_rewind_replays`** — run a fast circuit M analog ticks recording the per-tick hash
    /// sequence; reset to t=0 and re-run; assert the hash is identical at every analog tick. The
    /// keyframe/rewind contract holds across sub-tick edges because the sub-tick index is transient
    /// (never hashed) and all fast-domain sequential state (folded each analog-tick boundary) is the
    /// quantised level / integer state, so a replay lands bit-for-bit even mid-frame.
    #[test]
    fn subtick_rewind_replays() {
        const M: usize = 300;
        let mut sim = uart_setup_loopback_rate(0x5A as f64, 16.0, 8.0, 16.0);
        let mut hashes = Vec::with_capacity(M);
        for _ in 0..M {
            sim.step();
            hashes.push(sim.snapshot_hash());
        }
        // Rewind to t=0 (reset) and re-simulate forward; every analog-tick hash must match.
        sim.reset();
        for (tk, &h) in hashes.iter().enumerate() {
            sim.step();
            assert_eq!(
                sim.snapshot_hash(),
                h,
                "fast-rate UART rewind-replay diverged at analog tick {tk}"
            );
        }
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

    // --- Gated analog switch / transmission gate (ELEM_ASWITCH = 24) -----------
    //
    // The node-controlled cousin of the clock switch: a time-varying LINEAR conductance
    // between a and b whose on/off comes from a control NODE (read off the committed
    // previous-tick node_v, a one-tick delay), powered from VCC=d / GND=e (half-rail
    // threshold, dead below GATE_MIN_RAIL) or — with no power pins — off a fixed control
    // threshold. R_on = `value` (default ASWITCH_RON). It stays on the linear fast path
    // (no Newton, no branch unknown, no new hashed state) so the golden is untouched. It is
    // the switch the sample-and-hold / switched-capacitor / mux / VCO clusters need.

    /// `set_netlist` accepts the analog-switch element type (type 24); a malformed netlist
    /// containing one still fails safe through the same validation.
    #[test]
    fn aswitch_netlist_validates() {
        let mut sim = Sim::new(1);
        // a=1, b=2, CTRL=3, VCC=4, GND=0 (a powered five-terminal install).
        let ok = sim.set_netlist_pe(
            5,
            &[ELEM_ASWITCH],
            &[1],
            &[2],
            &[3],
            &[4],
            &[0],
            &[100.0],
            &[0.0],
            &[],
        );
        assert!(ok, "valid analog-switch netlist installs");
        assert_eq!(sim.element_count(), 1);
        assert_eq!(
            sim.element_at(0).kind,
            ELEM_ASWITCH,
            "analog switch stored as type 24"
        );
        // Out-of-range control node is still rejected (fail-safe).
        let bad = sim.set_netlist_pe(
            5,
            &[ELEM_ASWITCH],
            &[1],
            &[2],
            &[9],
            &[4],
            &[0],
            &[100.0],
            &[0.0],
            &[],
        );
        assert!(!bad, "out-of-range CTRL node rejected");
        assert_eq!(sim.node_voltages().len(), 1, "fell back to ground-only");
    }

    /// Build a powered analog switch passing a source into a resistive divider, with CTRL held
    /// at `ctrl_v` and VCC at `rail`. Nodes: 0 = gnd, 1 = source (Vsrc), 2 = switch output / load
    /// top, 3 = CTRL, 4 = VCC. The switch is a=1↔b=2 (R_on `ron`); a load resistor 2->0 pulls the
    /// output down when the switch opens. After settling, returns the load-node (2) voltage.
    fn aswitch_divider(vsrc: f64, ctrl_v: f64, rail: f64, ron: f64, rload: f64) -> f64 {
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist_pe(
            5,
            &[
                ELEM_VSOURCE,  // source at node 1
                ELEM_VSOURCE,  // CTRL level at node 3
                ELEM_VSOURCE,  // VCC rail at node 4
                ELEM_ASWITCH,  // a=1, b=2, CTRL=3, VCC=4, GND=0
                ELEM_RESISTOR, // load 2->0
            ],
            &[1, 3, 4, 1, 2],
            &[0, 0, 0, 2, 0],
            &[0, 0, 0, 3, 0], // ASWITCH c = CTRL = node 3
            &[0, 0, 0, 4, 0], // ASWITCH d = VCC = node 4
            &[0, 0, 0, 0, 0], // ASWITCH e = GND = node 0
            &[vsrc, ctrl_v, rail, ron, rload],
            &[0.0; 5],
            &[],
        ));
        // Purely resistive: the node settles within a couple of ticks (CTRL has a one-tick
        // delay, so step a handful of times to clear it).
        for _ in 0..10 {
            sim.step();
        }
        sim.node_voltages()[2]
    }

    /// Driving CTRL above half-rail closes the switch (the load node rises toward the source,
    /// a low end-to-end resistance ~R_on); driving CTRL low opens it (the load node decouples
    /// to ~0 through the pull-down, the source isolated).
    #[test]
    fn aswitch_control_opens_and_closes_path() {
        let vsrc = 5.0;
        let rail = 5.0;
        let ron = 100.0;
        let rload = 100_000.0; // >> R_on, so a closed switch barely drops the signal
                               // CTRL high (5 V > half of the 5 V rail) → closed → node 2 ≈ source.
        let closed = aswitch_divider(vsrc, 5.0, rail, ron, rload);
        // Divider: V2 = vsrc * Rload/(Ron+Rload) ≈ 4.995 V.
        let expected_closed = vsrc * rload / (ron + rload);
        assert!(
            (closed - expected_closed).abs() < 0.05 && closed > 4.9,
            "CTRL high closes the switch: node rises to ~source ({closed}, want ~{expected_closed})"
        );
        // CTRL low (0 V < half-rail) → open → node 2 decoupled to ~0 by the pull-down.
        let open = aswitch_divider(vsrc, 0.0, rail, ron, rload);
        assert!(
            open.abs() < 1e-3,
            "CTRL low opens the switch: load node decouples to ~0 ({open})"
        );
        // The closed-path through-current is the divider current (a real conducting path);
        // sanity that closing actually conducts and opening does not.
        assert!(
            closed > 1000.0 * open + 1.0,
            "closed conducts far more than open ({closed} vs {open})"
        );
    }

    /// The half-rail threshold tracks the actual VCC, not a fixed level: the SAME control
    /// voltage that closes the switch on a low rail leaves it open on a high rail (control
    /// below half of the higher rail). This is the powered-gate threshold rule.
    #[test]
    fn aswitch_threshold_is_half_the_actual_rail() {
        let vsrc = 5.0;
        let ctrl = 3.0;
        let ron = 100.0;
        let rload = 100_000.0;
        // Rail 5 V: half-rail = 2.5 V; CTRL 3 V > 2.5 → closed.
        let on = aswitch_divider(vsrc, ctrl, 5.0, ron, rload);
        assert!(on > 4.9, "CTRL 3 V > half of a 5 V rail closes it: {on}");
        // Rail 8 V: half-rail = 4.0 V; CTRL 3 V < 4.0 → open.
        let off = aswitch_divider(vsrc, ctrl, 8.0, ron, rload);
        assert!(
            off.abs() < 1e-3,
            "the same CTRL 3 V is below half of an 8 V rail → open: {off}"
        );
    }

    /// An unwired VCC (no power pins, but here the rail node floats to ~0) leaves the switch
    /// DEAD: rail < GATE_MIN_RAIL forces it open regardless of the control level. Proven by
    /// driving CTRL high while VCC sits at ~0 — the path must stay open.
    #[test]
    fn aswitch_unpowered_rail_is_dead() {
        let vsrc = 5.0;
        let ctrl = 5.0; // control fully high…
        let rail = 0.0; // …but VCC at 0 V → rail below GATE_MIN_RAIL → dead.
        let dead = aswitch_divider(vsrc, ctrl, rail, 100.0, 100_000.0);
        assert!(
            dead.abs() < 1e-3,
            "an unpowered (rail≈0) analog switch is dead even with CTRL high: {dead}"
        );
    }

    /// The unpowered FALLBACK (no power pins wired, d == 0 && e == 0): the switch follows a bare
    /// control level against the fixed ASWITCH_FIXED_THRESH (1.5 V). CTRL above it closes; below
    /// it opens. Nodes: 0 = gnd, 1 = source, 2 = load top, 3 = CTRL.
    #[test]
    fn aswitch_unpowered_fallback_uses_fixed_threshold() {
        let pass = |ctrl_v: f64| -> f64 {
            let mut sim = Sim::new(1);
            assert!(sim.set_netlist(
                4,
                &[
                    ELEM_VSOURCE,  // source node 1
                    ELEM_VSOURCE,  // CTRL node 3
                    ELEM_ASWITCH,  // a=1, b=2, CTRL=3, no power pins (d=e=0)
                    ELEM_RESISTOR, // load 2->0
                ],
                &[1, 3, 1, 2],
                &[0, 0, 2, 0],
                &[0, 0, 3, 0], // c = CTRL
                &[0, 0, 0, 0], // d = 0 (no VCC)  -> unpowered fallback
                &[5.0, ctrl_v, 100.0, 100_000.0],
                &[0.0; 4],
            ));
            for _ in 0..10 {
                sim.step();
            }
            sim.node_voltages()[2]
        };
        // CTRL 3 V > 1.5 V threshold → closed.
        assert!(
            pass(3.0) > 4.9,
            "bare control above 1.5 V closes the switch"
        );
        // CTRL 1 V < 1.5 V threshold → open.
        assert!(
            pass(1.0).abs() < 1e-3,
            "bare control below 1.5 V leaves the switch open"
        );
    }

    /// The switch follows a CTRL transition with the one-tick control delay (the control is read
    /// from the COMMITTED previous-tick node_v). A PWM-switch chops the control line: the analog
    /// path conducts while CTRL is high and opens while it is low, so the output node tracks the
    /// control square wave (one tick behind), proving the node actually steers the conductance.
    #[test]
    fn aswitch_follows_a_control_transition() {
        // Nodes: 0 gnd, 1 source 5 V, 2 load top, 3 CTRL, 4 VCC 5 V, 5 CTRL rail 5 V.
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist_pe(
            6,
            &[
                ELEM_VSOURCE,  // source 5 V (node 1)
                ELEM_VSOURCE,  // VCC 5 V (node 4)
                ELEM_VSOURCE,  // CTRL rail 5 V (node 5)
                ELEM_SWITCH,   // chop node 5 onto CTRL (node 3), 50% duty
                ELEM_RESISTOR, // pull-down on CTRL so it falls between switch windows
                ELEM_ASWITCH,  // a=1, b=2, CTRL=3, VCC=4, GND=0
                ELEM_RESISTOR, // load 2->0
            ],
            &[1, 4, 5, 5, 3, 1, 2],
            &[0, 0, 0, 3, 0, 2, 0],
            &[0, 0, 0, 0, 0, 3, 0], // ASWITCH c = CTRL = node 3
            &[0, 0, 0, 0, 0, 4, 0], // ASWITCH d = VCC = node 4
            &[0, 0, 0, 0, 0, 0, 0], // ASWITCH e = GND = node 0
            &[5.0, 5.0, 5.0, 0.5, 1000.0, 100.0, 100_000.0],
            &[0.0; 7],
            &[],
        ));
        // Over a full PWM period the output must reach both a high (switch closed, CTRL high)
        // and a low (switch open, CTRL low) extreme — i.e. it tracks the control.
        let mut saw_high = false;
        let mut saw_low = false;
        for _ in 0..(2 * SWITCH_PERIOD_TICKS) {
            sim.step();
            let v2 = sim.node_voltages()[2];
            if v2 > 4.5 {
                saw_high = true;
            }
            if v2.abs() < 0.5 {
                saw_low = true;
            }
        }
        assert!(
            saw_high && saw_low,
            "the analog switch output follows the chopped CTRL (saw_high={saw_high}, saw_low={saw_low})"
        );
    }

    /// **Sample-and-hold smoke test (the payoff).** A source → ASWITCH → a capacitor to GND, with
    /// CTRL chopped by a PWM switch (sample while CTRL high, hold while CTRL low). The cap's R_on·C
    /// (fast) lets it charge toward the source during each ON window; once CTRL drops, the OPEN
    /// switch isolates the cap and its backward-Euler companion holds the captured charge — the
    /// only remaining path is the tiny SWITCH_GOFF leak (τ = C/G_off ≈ 1000 s), negligible over a
    /// ~50 µs hold window. Proven in one fixed netlist: after the cap has captured ~source, it
    /// must barely droop across a full OFF window (it holds), the mechanism that unlocks S&H.
    #[test]
    fn aswitch_sample_and_hold_captures_and_holds() {
        // Nodes: 0 gnd, 1 source 4 V, 2 cap top (held node), 3 CTRL, 4 VCC 5 V, 5 CTRL rail 5 V.
        // R_on 1 kΩ into C 0.1 µF → τ = 100 µs; the PWM ON window is 25 ticks = 50 µs, so the cap
        // tops up toward the source each sample, then holds through the OFF window.
        let vsrc = 4.0;
        let mut sim = Sim::new(1);
        assert!(sim.set_netlist_pe(
            6,
            &[
                ELEM_VSOURCE,   // source 4 V (node 1)
                ELEM_VSOURCE,   // VCC 5 V (node 4)
                ELEM_VSOURCE,   // CTRL rail 5 V (node 5)
                ELEM_SWITCH,    // chop node 5 onto CTRL (node 3), 50% duty
                ELEM_RESISTOR,  // CTRL pull-down
                ELEM_ASWITCH,   // a=1, b=2, CTRL=3, VCC=4, GND=0
                ELEM_CAPACITOR, // hold cap 2->0
            ],
            &[1, 4, 5, 5, 3, 1, 2],
            &[0, 0, 0, 3, 0, 2, 0],
            &[0, 0, 0, 0, 0, 3, 0], // ASWITCH c = CTRL = node 3
            &[0, 0, 0, 0, 0, 4, 0], // ASWITCH d = VCC = node 4
            &[0, 0, 0, 0, 0, 0, 0], // ASWITCH e = GND = node 0
            &[vsrc, 5.0, 5.0, 0.5, 1000.0, 1_000.0, 0.1e-6],
            &[0.0; 7],
            &[],
        ));
        // Settle several PWM periods so the cap has captured the source on the ON windows.
        for _ in 0..20 * SWITCH_PERIOD_TICKS {
            sim.step();
        }
        // The captured value must be near the source (the sample worked).
        let captured = sim.node_voltages()[2];
        assert!(
            captured > 0.9 * vsrc,
            "S&H captures ~the source on the sample window: {captured} (want > {})",
            0.9 * vsrc
        );
        // Find an OFF window (switch open: CTRL low) and confirm the held node barely droops
        // across it — the isolation/hold. Walk one full period sampling the cap, and over the
        // stretch where CTRL is low the cap must stay essentially flat.
        // CTRL (node 3) is the PWM output; when it is low (< 0.5 V) the ASWITCH is open.
        let mut hold_start: Option<f64> = None;
        let mut max_droop = 0.0f64;
        for _ in 0..SWITCH_PERIOD_TICKS {
            sim.step();
            let ctrl = sim.node_voltages()[3];
            let vcap = sim.node_voltages()[2];
            if ctrl < 0.5 {
                // switch open → holding
                match hold_start {
                    None => hold_start = Some(vcap),
                    Some(v0) => max_droop = max_droop.max((v0 - vcap).abs()),
                }
            }
        }
        assert!(
            hold_start.is_some(),
            "expected an OFF (hold) window within one PWM period"
        );
        assert!(
            max_droop < 0.02,
            "the open switch holds the cap (max droop across the hold window {max_droop} V)"
        );
    }

    /// Replay invariant for an analog-switch circuit: the switch state is a deterministic
    /// function of the committed node voltages (no new hashed state), so a fixed netlist stepped
    /// a fixed number of times reproduces its snapshot-hash stream exactly. The ASWITCH analogue
    /// of `switch_run_is_reproducible`, with the mechanism ACTIVE (a chopped control + an S&H cap).
    #[test]
    fn aswitch_run_is_reproducible() {
        let run = || {
            // source → ASWITCH (gated by a PWM-chopped control) → hold cap; the control is
            // exercised so the switch genuinely toggles across the run.
            let mut sim = Sim::new(7);
            assert!(sim.set_netlist_pe(
                6,
                &[
                    ELEM_VSOURCE,   // source (node 1)
                    ELEM_VSOURCE,   // VCC (node 4)
                    ELEM_VSOURCE,   // CTRL rail (node 5)
                    ELEM_SWITCH,    // chop node 5 onto CTRL (node 3)
                    ELEM_RESISTOR,  // CTRL pull-down
                    ELEM_ASWITCH,   // a=1, b=2, CTRL=3, VCC=4, GND=0
                    ELEM_CAPACITOR, // hold cap 2->0
                ],
                &[1, 4, 5, 5, 3, 1, 2],
                &[0, 0, 0, 3, 0, 2, 0],
                &[0, 0, 0, 0, 0, 3, 0],
                &[0, 0, 0, 0, 0, 4, 0],
                &[0, 0, 0, 0, 0, 0, 0],
                &[4.0, 5.0, 5.0, 0.5, 1000.0, 1_000.0, 1.0e-6],
                &[0.0; 7],
                &[],
            ));
            let mut acc = sim.snapshot_hash();
            for _ in 0..2000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
            }
            acc
        };
        assert_eq!(run(), run(), "analog-switch circuit must reproduce exactly");
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

    /// Frequency-domain AC analysis: a first-order RC low-pass (AC source 1->0, R 1->2,
    /// C 2->0) must hit its textbook corner — at omega = 1/(RC), |H| = 1/sqrt(2) (-3 dB)
    /// and the phase is exactly -45 deg — then roll off at -20 dB/decade above it. This is
    /// the "proper corner" the 2 us transient step can't reach for small parts; `ac_solve`
    /// gets it exactly because it never time-steps.
    #[test]
    fn ac_rc_lowpass_corner() {
        let r = 1_000.0;
        let c = 1.0e-6; // RC = 1 ms -> corner omega = 1000 rad/s (f ~ 159 Hz).
        let sim = build(
            3,
            &[ELEM_ACSOURCE, ELEM_RESISTOR, ELEM_CAPACITOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[100.0, r, c],
        );
        // H = V2 / V1 from the complex node voltages -> (magnitude, phase).
        let gain = |w: f64| -> (f64, f64) {
            let v = sim.ac_solve(w);
            let (r1, i1) = v[0];
            let (r2, i2) = v[1];
            let d = r1 * r1 + i1 * i1;
            let hr = (r2 * r1 + i2 * i1) / d;
            let hi = (i2 * r1 - r2 * i1) / d;
            (hr.hypot(hi), hi.atan2(hr))
        };
        let wc = 1.0 / (r * c);
        let (mag, phase) = gain(wc);
        assert!(
            (mag - 1.0 / 2.0_f64.sqrt()).abs() < 1e-9,
            "|H| at the corner is 1/sqrt(2): got {mag}"
        );
        assert!(
            (phase + std::f64::consts::FRAC_PI_4).abs() < 1e-9,
            "phase at the corner is -45 deg: got {phase} rad"
        );
        assert!(
            gain(wc / 1000.0).0 > 0.999,
            "passband |H| ~ 1 far below the corner"
        );
        // One decade up vs two decades up: a single pole drops ~10x per decade.
        let ratio = gain(wc * 10.0).0 / gain(wc * 100.0).0;
        assert!(
            (ratio - 10.0).abs() < 0.2,
            "-20 dB/decade rolloff: got ratio {ratio}"
        );
    }

    /// AC analysis of a lossless L-C divider (AC source 1->0, L 1->2, C 2->0):
    /// H = 1/(1 - omega^2 LC), a known finite multiple of the input off resonance that
    /// blows up as omega -> 1/sqrt(LC). Verifies the inductor (jwL branch) and capacitor
    /// (jwC) stamps interact correctly — a resonance a time-stepped solve at this
    /// kHz/MHz-scale omega could never resolve.
    #[test]
    fn ac_lc_divider_resonance() {
        let l = 1.0e-3;
        let c = 1.0e-6; // LC = 1e-9 -> omega0 ~ 31623 rad/s.
        let sim = build(
            3,
            &[ELEM_ACSOURCE, ELEM_INDUCTOR, ELEM_CAPACITOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[100.0, l, c],
        );
        let gain = |w: f64| -> f64 {
            let v = sim.ac_solve(w);
            let (r1, i1) = v[0];
            let (r2, i2) = v[1];
            let d = r1 * r1 + i1 * i1;
            let hr = (r2 * r1 + i2 * i1) / d;
            let hi = (i2 * r1 - r2 * i1) / d;
            hr.hypot(hi)
        };
        // At omega^2 LC = 0.1, |H| = 1/|1 - 0.1| = 1.1111...
        let w = (0.1_f64 / (l * c)).sqrt();
        assert!(
            (gain(w) - 1.0 / 0.9).abs() < 1e-6,
            "L-C divider |H| off resonance: got {}",
            gain(w)
        );
        // Just below omega0 the output is many times the input (near-singular divider).
        let w0 = 1.0 / (l * c).sqrt();
        assert!(
            gain(w0 * 0.999) > 100.0,
            "|H| explodes near LC resonance: got {}",
            gain(w0 * 0.999)
        );
    }

    /// `ac_sweep` is `ac_solve` across a frequency list, flattened [re, im] per non-ground
    /// node per frequency — verify the layout and that it agrees point by point.
    #[test]
    fn ac_sweep_matches_pointwise_solve() {
        let sim = build(
            3,
            &[ELEM_ACSOURCE, ELEM_RESISTOR, ELEM_CAPACITOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[100.0, 1_000.0, 1.0e-6],
        );
        let freqs = [100.0, 1_000.0, 10_000.0];
        let flat = sim.ac_sweep(&freqs, false);
        let nu = 2; // node_count - 1
        assert_eq!(flat.len(), freqs.len() * nu * 2);
        for (k, &f) in freqs.iter().enumerate() {
            let v = sim.ac_solve(std::f64::consts::TAU * f);
            for (j, (re, im)) in v.iter().enumerate() {
                let base = (k * nu + j) * 2;
                assert_eq!(flat[base], *re);
                assert_eq!(flat[base + 1], *im);
            }
        }
    }

    /// Frequency-domain per-element AC measurements on a series RC (source → R → C → gnd). The
    /// series current is identical through the source, R, and C (KCL); the resistor's V and I are
    /// in phase; the cap's current leads its voltage by 90°. Because it's analytic, it is valid at
    /// ANY frequency — the whole point (the time-domain `AcMeas` quits above ~62.5 kHz).
    #[test]
    fn ac_element_measurements_series_rc() {
        let r = 1_000.0;
        let c = 159.0e-9; // corner ≈ 1 kHz
        let f = 1_000.0;
        let sim = build(
            3,
            &[ELEM_ACSOURCE, ELEM_RESISTOR, ELEM_CAPACITOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[f, r, c],
        );
        let m = sim.ac_element_measurements(std::f64::consts::TAU * f, false);
        assert_eq!(m.len(), 3 * AC_FIELDS);
        let iamp = |i: usize| m[i * AC_FIELDS + 5];
        let phase = |i: usize| m[i * AC_FIELDS + 9];
        let valid = |i: usize| m[i * AC_FIELDS + 11];
        assert!(
            valid(0) == 1.0 && valid(1) == 1.0 && valid(2) == 1.0,
            "source, R and C are all measured"
        );
        let tol = 1e-6 * iamp(1).max(1e-9);
        assert!(
            (iamp(1) - iamp(2)).abs() < tol,
            "R and C carry the one series current: {} vs {}",
            iamp(1),
            iamp(2)
        );
        assert!(
            (iamp(0) - iamp(1)).abs() < tol,
            "the source carries the same series current (KCL): {} vs {}",
            iamp(0),
            iamp(1)
        );
        assert!(
            iamp(1) > 1e-4,
            "a real current flows at the corner: {}",
            iamp(1)
        );
        assert!(
            phase(1).abs() < 0.05,
            "resistor V and I are in phase: {}",
            phase(1)
        );
        assert!(
            (phase(2) + std::f64::consts::FRAC_PI_2).abs() < 0.1,
            "cap current leads its voltage by 90°: {}",
            phase(2)
        );
    }

    /// Resistor lead inductance (Real mode AC): every resistor carries the same ~10 nH lead/body
    /// inductance, but only a *low-value* part — a current-sense shunt — has a small enough R for
    /// `ωL` to swing the phase. A 10 mΩ shunt at 100 kHz reads ~+32° (inductive lag), while a 10 kΩ
    /// in the same series string stays ~0°. In Ideal mode both are purely resistive (phase 0).
    #[test]
    fn resistor_lead_inductance_shows_only_on_a_shunt() {
        let f = 100_000.0;
        let omega = std::f64::consts::TAU * f;
        // AC 1->0; shunt (10 mΩ) 1->2; load (10 kΩ) 2->0. The two resistors carry one series current.
        let sim = build(
            3,
            &[ELEM_ACSOURCE, ELEM_RESISTOR, ELEM_RESISTOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[f, 0.01, 10_000.0],
        );
        let phase = |m: &[f64], i: usize| m[i * AC_FIELDS + 9];
        // Real mode: shunt lags by atan(ωL/R) = atan(2π·1e5·1e-8 / 0.01) ≈ 0.561 rad (32°).
        let real = sim.ac_element_measurements(omega, true);
        let expect = (omega * 1.0e-8 / 0.01).atan();
        assert!(
            (expect - 0.561).abs() < 0.01,
            "sanity: expected ~32°: {expect}"
        );
        assert!(
            (phase(&real, 1) - expect).abs() < 0.02,
            "10 mΩ shunt lags ~32° in Real mode: {} vs {}",
            phase(&real, 1),
            expect
        );
        assert!(
            phase(&real, 2).abs() < 0.01,
            "the 10 kΩ stays ~0° — the same parasitic is invisible at high R: {}",
            phase(&real, 2)
        );
        // Ideal mode: the lead inductance is gated off, so the shunt is purely resistive.
        let ideal = sim.ac_element_measurements(omega, false);
        assert!(
            phase(&ideal, 1).abs() < 1e-6,
            "Ideal mode: the shunt is a pure resistor (phase 0): {}",
            phase(&ideal, 1)
        );
    }

    /// Nonlinear small-signal AC: a diode DC-biased through R2 and perturbed by an AC
    /// source through R1. The AC at the diode node is the conductance divider
    /// `G1 / (G1 + G2 + g_d)`, where `g_d = dI/dV` is the diode's dynamic conductance at
    /// the DC operating point the transient solve already settled (read back here). A
    /// forward diode is a near-short in AC; this confirms the small-signal stamp uses the
    /// live bias, not a fixed model.
    #[test]
    fn ac_diode_small_signal_divider() {
        let r1 = 10_000.0;
        let r2 = 1_000.0;
        let sim = build(
            4,
            &[
                ELEM_VSOURCE,
                ELEM_ACSOURCE,
                ELEM_RESISTOR,
                ELEM_RESISTOR,
                ELEM_DIODE,
            ],
            &[3, 1, 1, 3, 2],
            &[0, 0, 2, 2, 0],
            &[5.0, 100.0, r1, r2, 0.0],
        );
        // Operating point from build()'s t=0 solve — the diode is forward-biased.
        let vd = sim.diode_vd[4];
        assert!(
            vd > 0.4,
            "diode forward-biased at the bias point: vd = {vd}"
        );
        let (_, gd) = diode_eval(vd, diode_model(&sim.elements[4]));
        let g_d = gd + GMIN;
        let expected = (1.0 / r1) / (1.0 / r1 + 1.0 / r2 + g_d);
        let v = sim.ac_solve(std::f64::consts::TAU * 1_000.0);
        let mag = |re: f64, im: f64| re.hypot(im);
        let ratio = mag(v[1].0, v[1].1) / mag(v[0].0, v[0].1); // |V(node2)| / |V(node1)|
        assert!(
            (ratio - expected).abs() < 1e-9,
            "diode small-signal divider: got {ratio}, want {expected}"
        );
    }

    /// Nonlinear small-signal AC: an NMOS common-source amplifier. A gate divider (Rg1 =
    /// Rg2, so ½) sets the AC at the gate; the stage gain is `−gm / (1/Rd + gds)` with `gm`,
    /// `gds` read back from the device's settled operating point. Validates the 3-terminal
    /// transconductance (VCCS) stamp — gate controls drain current with no gate current.
    #[test]
    fn ac_mosfet_common_source_gain() {
        let rd = 10_000.0;
        let rg = 100_000.0;
        // n1 Vdd, n2 drain, n3 gate-bias, n4 gate, n5 ac.
        let sim = build3(
            6,
            &[
                ELEM_VSOURCE,
                ELEM_RESISTOR,
                ELEM_NMOS,
                ELEM_VSOURCE,
                ELEM_RESISTOR,
                ELEM_ACSOURCE,
                ELEM_RESISTOR,
            ],
            &[1, 1, 2, 3, 3, 5, 5],
            &[0, 2, 0, 0, 4, 0, 4],
            &[0, 0, 4, 0, 0, 0, 0],
            &[5.0, rd, 0.0, 4.2, rg, 100.0, rg],
        );
        let m = sim.element_at(2);
        let op = Sim::mosfet_op(&m, sim.mosfet_vgs[2], sim.mosfet_vds[2]);
        assert!(
            op.gm > 0.0,
            "MOSFET on (saturation) at the bias: gm = {}",
            op.gm
        );
        let expected = 0.5 * op.gm / (1.0 / rd + op.gds); // ½ gate divider × CS stage
        let v = sim.ac_solve(std::f64::consts::TAU * 1_000.0);
        let mag = |re: f64, im: f64| re.hypot(im);
        let gain = mag(v[1].0, v[1].1) / mag(v[4].0, v[4].1); // |V(drain)| / |V(ac)|
        assert!(
            (gain - expected).abs() / expected < 1e-5,
            "common-source gain: got {gain}, want {expected}"
        );
        assert!(v[1].0 < 0.0, "CS stage inverts (drain AC opposes the gate)");
    }

    /// Nonlinear small-signal AC: an NPN common-emitter amplifier. Cross-checks `ac_solve`
    /// against the exact two-node small-signal system (collector + base KCL) built from the
    /// read-back Ebers-Moll Jacobian (`gpi, gmu, gif, gic_bc`) — validating the full
    /// 9-entry BJT conductance block, the hardest stamp.
    #[test]
    fn ac_bjt_common_emitter_gain() {
        let rc = 200.0;
        let rb = 10_000.0;
        // n1 Vcc, n2 collector, n3 base-bias, n4 base, n5 ac.
        let sim = build3(
            6,
            &[
                ELEM_VSOURCE,
                ELEM_RESISTOR,
                ELEM_NPN,
                ELEM_VSOURCE,
                ELEM_RESISTOR,
                ELEM_ACSOURCE,
                ELEM_RESISTOR,
            ],
            &[1, 1, 2, 3, 3, 5, 5],
            &[0, 2, 0, 0, 4, 0, 4],
            &[0, 0, 4, 0, 0, 0, 0],
            &[5.0, rc, 0.0, 2.0, rb, 100.0, rb],
        );
        let q = sim.element_at(2);
        let op = Sim::bjt_op(&q, sim.bjt_vbe[2], sim.bjt_vbc[2]);
        assert!(
            sim.bjt_vbe[2] > 0.4 && sim.node_v[2] > sim.node_v[4],
            "BJT in forward-active: vbe = {}, Vc = {}, Vb = {}",
            sim.bjt_vbe[2],
            sim.node_v[2],
            sim.node_v[4]
        );
        // Solve the small-signal 2-node system by hand from the read-back partials:
        //   collector: V2·(1/Rc − gic_bc) + V4·(gif + gic_bc) = 0
        //   base:      V4·(2/Rb + gpi + gmu) − gmu·V2 = A/Rb   (Rb1 = Rb2 = Rb)
        let a_amp = AC_AMPLITUDE;
        let k = (op.gif + op.gic_bc) / (1.0 / rc - op.gic_bc); // V2 = −k·V4
        let d = 2.0 / rb + op.gpi + op.gmu;
        let v4 = (a_amp / rb) / (k * op.gmu + d);
        let v2 = -k * v4;
        let v = sim.ac_solve(std::f64::consts::TAU * 1_000.0);
        assert!(
            (v[1].0 - v2).abs() / v2.abs() < 1e-5 && v[1].1.abs() < 1e-9,
            "collector AC: got {:?}, want {v2}",
            v[1]
        );
        assert!(
            (v[3].0 - v4).abs() / v4.abs() < 1e-5,
            "base AC: got {:?}, want {v4}",
            v[3]
        );
        assert!(
            v2 < 0.0 && v4 > 0.0,
            "CE stage inverts (collector opposes base)"
        );
    }

    /// Op-amp small-signal AC with the GBW pole: an inverting amplifier (gain −Rf/Rin).
    /// Its low-frequency closed-loop gain is `Rf/Rin` and inverting, and — because the
    /// open-loop gain rolls off at the gain-bandwidth product — its −3 dB bandwidth is
    /// `GBW / noise-gain = GBW / (1 + Rf/Rin)`, the textbook result. Confirms the op-amp is
    /// stamped in `ac_solve` AND that the frequency-dependent (pole) term is correct.
    #[test]
    fn ac_opamp_inverting_gbw_bandwidth() {
        let rin = 1_000.0;
        let rf = 10_000.0;
        // n1 Vin(ac), n2 inverting input, n3 output; non-inverting = ground.
        let sim = build3(
            4,
            &[ELEM_ACSOURCE, ELEM_RESISTOR, ELEM_OPAMP, ELEM_RESISTOR],
            &[1, 1, 3, 3],
            &[0, 2, 2, 2],
            &[0, 0, 0, 0],
            &[100.0, rin, 12.0, rf],
        );
        let gain_at = |f: f64| {
            // The GBW pole is a Real-mode non-ideality, so test on the real path.
            let v = sim.ac_solve_models(std::f64::consts::TAU * f, true);
            (v[2].0.hypot(v[2].1)) / (v[0].0.hypot(v[0].1)) // |V(out)| / |V(in)|
        };
        let g_lo = gain_at(1_000.0); // well below the corner
        assert!(
            (g_lo - rf / rin).abs() / (rf / rin) < 1e-3,
            "low-frequency gain ~ Rf/Rin: got {g_lo}"
        );
        let v = sim.ac_solve(std::f64::consts::TAU * 1_000.0);
        assert!(v[2].0 < 0.0, "inverting amp: output opposes input");
        // The single-pole closed-loop −3 dB frequency is GBW / (1 + Rf/Rin).
        let f3db = OPAMP_GBW / (1.0 + rf / rin);
        let g3 = gain_at(f3db);
        assert!(
            (g3 - (rf / rin) / 2.0_f64.sqrt()).abs() / (rf / rin) < 0.01,
            "−3 dB gain at GBW/noise-gain: got {g3}, want {}",
            (rf / rin) / 2.0_f64.sqrt()
        );
    }

    /// Real-model parasitics: a capacitor carries series ESL, so above its self-resonant
    /// frequency `SRF = 1/(2π√(ESL·C))` it goes **inductive** — in an R-C divider the output
    /// (its impedance) bottoms out at the SRF and climbs again, where an ideal cap's keeps
    /// falling. This is the cap-becomes-an-inductor lesson the Bode now shows in Real mode.
    #[test]
    fn ac_real_capacitor_self_resonates() {
        let r = 10.0;
        let c = 1.0e-6;
        let sim = build(
            3,
            &[ELEM_ACSOURCE, ELEM_RESISTOR, ELEM_CAPACITOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[100.0, r, c],
        );
        let srf = 1.0 / (2.0 * std::f64::consts::PI * (CAP_ESL * c).sqrt());
        let ratio = |f: f64, real: bool| {
            let v = sim.ac_solve_models(std::f64::consts::TAU * f, real);
            v[1].0.hypot(v[1].1) / v[0].0.hypot(v[0].1)
        };
        assert!(
            ratio(srf * 10.0, false) < ratio(srf, false),
            "ideal cap keeps shorting at higher frequency"
        );
        assert!(
            ratio(srf, true) < ratio(srf * 0.1, true),
            "real cap impedance dips toward the SRF"
        );
        assert!(
            ratio(srf * 10.0, true) > ratio(srf, true) * 3.0,
            "real cap rises above the SRF (gone inductive)"
        );
    }

    /// Real-model parasitics: an inductor carries a parallel winding capacitance, so it has
    /// a parallel-resonance impedance **peak** at `SRF = 1/(2π√(L·Cw))` and goes
    /// **capacitive** above it — in an R-L divider the output peaks at the SRF then falls,
    /// where an ideal inductor's keeps rising.
    #[test]
    fn ac_real_inductor_self_resonates() {
        let r = 10_000.0;
        let l = 1.0e-3;
        let sim = build(
            3,
            &[ELEM_ACSOURCE, ELEM_RESISTOR, ELEM_INDUCTOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[100.0, r, l],
        );
        let srf = 1.0 / (2.0 * std::f64::consts::PI * (l * IND_CW).sqrt());
        let ratio = |f: f64, real: bool| {
            let v = sim.ac_solve_models(std::f64::consts::TAU * f, real);
            v[1].0.hypot(v[1].1) / v[0].0.hypot(v[0].1)
        };
        assert!(
            ratio(srf * 10.0, false) > ratio(srf, false),
            "ideal inductor keeps blocking at higher frequency"
        );
        assert!(
            ratio(srf, true) > ratio(srf * 0.1, true),
            "real inductor peaks toward the SRF"
        );
        assert!(
            ratio(srf, true) > ratio(srf * 10.0, true) * 2.0,
            "real inductor falls above the SRF (gone capacitive)"
        );
    }

    /// Per-device parameter block: an op-amp's gain-bandwidth product comes from its param
    /// slot 0 (not the fixed default), so a 10× faster part gives 10× the closed-loop
    /// bandwidth. Proves the `set_netlist_p` param plumbing reaches the device model; an
    /// all-zero block (every other test) reproduces the default, so the golden is untouched.
    #[test]
    fn ac_opamp_gbw_param_sets_bandwidth() {
        let rin = 1_000.0;
        let rf = 10_000.0;
        let gbw = 1.0e7; // 10 MHz — 10× the OPAMP_GBW default
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 4 * PARAM_STRIDE];
        params[2 * PARAM_STRIDE] = gbw; // element 2 = the op-amp, slot 0 = GBW
        assert!(
            sim.set_netlist_p(
                4,
                &[ELEM_ACSOURCE, ELEM_RESISTOR, ELEM_OPAMP, ELEM_RESISTOR],
                &[1, 1, 3, 3],
                &[0, 2, 2, 2],
                &[0, 0, 0, 0],
                &[0, 0, 0, 0],
                &[100.0, rin, 12.0, rf],
                &[0.0, 0.0, 0.0, 0.0],
                &params,
            ),
            "netlist with a param block installs"
        );
        let gain_at = |f: f64| {
            let v = sim.ac_solve_models(std::f64::consts::TAU * f, true);
            v[2].0.hypot(v[2].1) / v[0].0.hypot(v[0].1)
        };
        // −3 dB at the CUSTOM GBW / noise-gain (10× higher than the default part).
        let g3 = gain_at(gbw / (1.0 + rf / rin));
        assert!(
            (g3 - (rf / rin) / 2.0_f64.sqrt()).abs() / (rf / rin) < 0.01,
            "−3 dB at custom-GBW/noise-gain: got {g3}"
        );
        // At the DEFAULT part's corner the faster part is still in its flat passband.
        let g_lo = gain_at(OPAMP_GBW / (1.0 + rf / rin));
        assert!(
            g_lo > 0.99 * rf / rin,
            "faster op-amp still flat at the default corner: got {g_lo}"
        );
    }

    /// Per-device parameter block on a passive: a capacitor's ESR comes from param slot 0,
    /// so at its self-resonance — where |Z| bottoms out at exactly the ESR — a budget
    /// (high-ESR) cap has a much shallower notch than a lab-grade (low-ESR) one. Proves the
    /// param plumbing reaches the Real-model AC stamp, the basis of the quality "tiers".
    #[test]
    fn ac_cap_esr_param_sets_resonance_depth() {
        let c = 1.0e-6;
        let with_esr = |esr: f64| {
            let mut sim = Sim::new(1);
            let mut params = vec![0.0; 3 * PARAM_STRIDE];
            params[2 * PARAM_STRIDE] = esr; // element 2 = cap, slot 0 = ESR
            assert!(sim.set_netlist_p(
                3,
                &[ELEM_ACSOURCE, ELEM_RESISTOR, ELEM_CAPACITOR],
                &[1, 1, 2],
                &[0, 2, 0],
                &[0, 0, 0],
                &[0, 0, 0],
                &[100.0, 10.0, c],
                &[0.0, 0.0, 0.0],
                &params,
            ));
            sim
        };
        let srf = 1.0 / (2.0 * std::f64::consts::PI * (CAP_ESL * c).sqrt());
        let notch = |sim: &Sim| {
            let v = sim.ac_solve_models(std::f64::consts::TAU * srf, true);
            v[1].0.hypot(v[1].1) / v[0].0.hypot(v[0].1) // |V_cap|/|V_src| at SRF ∝ ESR
        };
        assert!(
            notch(&with_esr(0.5)) > notch(&with_esr(0.005)) * 5.0,
            "a higher-ESR (budget) cap bottoms out at a much shallower SRF notch"
        );
    }

    /// Per-device parameter block on a source: a voltage source's output impedance is param
    /// slot 0, so under load the node sags to `Vsrc·R/(R+Rout)` (a budget supply regulates
    /// poorly). Param 0 — the default and every ideal-mode source — is a perfect zero-Ω source.
    #[test]
    fn vsource_output_impedance_sags_under_load() {
        let vsrc = 5.0;
        let rload = 100.0;
        let rout = 10.0;
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 2 * PARAM_STRIDE];
        params[0] = rout; // element 0 = the V source, slot 0 = Rout
        assert!(sim.set_netlist_p(
            2,
            &[ELEM_VSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[0, 0],
            &[0, 0],
            &[vsrc, rload],
            &[0.0, 0.0],
            &params,
        ));
        let v1 = sim.node_voltages()[1];
        let expected = vsrc * rload / (rload + rout);
        assert!(
            (v1 - expected).abs() < 1e-9,
            "loaded source sags: got {v1}, want {expected}"
        );
        // A perfect (param-0) source holds the full EMF.
        let mut ideal = Sim::new(1);
        assert!(ideal.set_netlist(
            2,
            &[ELEM_VSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[0, 0],
            &[0, 0],
            &[vsrc, rload],
            &[0.0, 0.0],
        ));
        assert!((ideal.node_voltages()[1] - vsrc).abs() < 1e-9);
    }

    /// Per-device parameter block on a transistor: an NPN's forward current gain β is
    /// param slot 0 (a quality tier — a better part has more gain). Driving the base
    /// through a base resistor fixes the base current `Ib ≈ (Vbb − Vbe)/RB`, so the
    /// collector current `Ic = β·Ib` scales with β and a higher-β part pulls the
    /// collector node lower. (Driving the base with a fixed Vbe instead would set Ic by
    /// the exponential and hide β, so the resistor is the point.) Param 0 — the default
    /// and every ideal-mode transistor — uses the `BJT_BF` constant. Layout: VCC 1->0;
    /// RC 1->2; Vbb 3->0; RB 3->4; NPN collector=2 emitter=0 base=4.
    #[test]
    fn bjt_beta_param_pulls_collector_lower() {
        let collector_at = |beta: f64| {
            let mut sim = Sim::new(1);
            let mut params = vec![0.0; 5 * PARAM_STRIDE];
            params[4 * PARAM_STRIDE] = beta; // element 4 = the NPN, slot 0 = β
            assert!(sim.set_netlist_p(
                5,
                &[
                    ELEM_VSOURCE,
                    ELEM_RESISTOR,
                    ELEM_VSOURCE,
                    ELEM_RESISTOR,
                    ELEM_NPN,
                ],
                &[1, 1, 3, 3, 2],
                &[0, 2, 0, 4, 0],
                &[0, 0, 0, 0, 4],
                &[0, 0, 0, 0, 0],
                &[10.0, 1_000.0, 1.0, 100_000.0, 0.0],
                &[0.0, 0.0, 0.0, 0.0, 0.0],
                &params,
            ));
            sim.node_voltages()[2] // collector voltage
        };
        let vc_lo_gain = collector_at(100.0);
        let vc_hi_gain = collector_at(300.0);
        // Both stay in the forward-active region (collector well above the base ~0.65 V),
        // i.e. the part didn't saturate to the rail or the ground.
        assert!(
            vc_hi_gain > 1.0 && vc_lo_gain < 10.0,
            "active region: Vc(β100)={vc_lo_gain}, Vc(β300)={vc_hi_gain}"
        );
        // Tripling β triples the collector current, so the collector node drops markedly.
        assert!(
            vc_hi_gain < vc_lo_gain - 0.2,
            "higher β pulls the collector lower: Vc(β100)={vc_lo_gain}, Vc(β300)={vc_hi_gain}"
        );
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

    /// The pulse / clock generator is this same AC-source element with the **square** waveform
    /// param set (slot 1 = 1): a unipolar clock that is `amplitude` for the first `duty` of each
    /// period and `0` after. Across one full period the driven node must track that independent
    /// scalar square tick for tick (the same `f*tick*DT` phase, so they agree even at the duty
    /// edge). Layout: source 1->0 (value = f, aux = amplitude, params = square + duty), R 1->0.
    #[test]
    fn pulse_source_emits_square_wave() {
        let f = 1_000.0; // period = 1 ms = 500 ticks at dt = 2 us
        let amp = 5.0;
        let duty = 0.5;
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 2 * PARAM_STRIDE];
        params[1] = 1.0; // source (element 0): waveform slot = 1 (square)
        params[3] = duty; // duty cycle
        assert!(sim.set_netlist_p(
            2,
            &[ELEM_ACSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[0, 0],
            &[0, 0],
            &[f, 1_000.0],
            &[amp, 0.0], // aux: source amplitude
            &params,
        ));
        let want_at = |tick: u64| {
            let c = f * tick as f64 * DT;
            if c - c.floor() < duty {
                amp
            } else {
                0.0
            }
        };
        // Tick 0 (phase 0) is HIGH.
        assert!(
            (sim.node_voltages()[1] - amp).abs() < 1e-9,
            "square is HIGH at tick 0: {}",
            sim.node_voltages()[1]
        );
        let period_ticks = (1.0 / (f * DT)).round() as u64; // 500
        for _ in 0..period_ticks {
            sim.step();
            let solved_tick = sim.tick() - 1;
            let got = sim.node_voltages()[1];
            let want = want_at(solved_tick);
            assert!(
                (got - want).abs() < 1e-9,
                "square tracks at tick {solved_tick}: got {got}, want {want}"
            );
        }
    }

    /// The triangle waveform param (slot 1 = 2) ramps the node up to the peak at `duty` and back
    /// down after, so `duty` is the symmetry knob. At the peak phase the node is ~`amplitude`,
    /// near phase 0 it is ~0, and the rising leg is monotonic. Layout as the square test.
    #[test]
    fn pulse_source_emits_triangle_wave() {
        let f = 1_000.0; // 500 ticks/period
        let amp = 4.0;
        let mut sim = Sim::new(1);
        let mut params = vec![0.0; 2 * PARAM_STRIDE];
        params[1] = 2.0; // waveform = triangle
        params[3] = 0.5; // symmetric
        assert!(sim.set_netlist_p(
            2,
            &[ELEM_ACSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[0, 0],
            &[0, 0],
            &[f, 1_000.0],
            &[amp, 0.0],
            &params,
        ));
        // Sample the rising leg (ticks 0..250 → phase 0..0.5): strictly increasing toward amp.
        let mut prev = sim.node_voltages()[1]; // tick 0 ≈ 0
        assert!(prev.abs() < 1e-9, "triangle starts at 0: {prev}");
        for _ in 0..240 {
            sim.step();
            let got = sim.node_voltages()[1];
            assert!(
                got > prev - 1e-12,
                "triangle rising leg is monotonic: {got} !>= {prev}"
            );
            prev = got;
        }
        // Near the peak (phase ~0.48) the node has climbed close to the amplitude.
        assert!(prev > 0.9 * amp, "triangle peaks near amplitude: {prev}");
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

    // --- AC analysis (Layer 2 measurement) ------------------------------------
    //
    // The per-element AC analyzer accumulates each element's terminal voltage and
    // through-current over a detected cycle and finalizes RMS / power / phase
    // measurements (`AC_FIELDS`), read out by `ac_measurements`. These tests drive
    // known R / C / L loads at a fixed frequency and check the measured phase, power
    // factor, impedance, and frequency against physics — plus the replay invariant.
    // Field indices match `AC_FIELDS`: 0 Vrms, 1 Irms, 6 Preal, 7 PF, 8 |Z|, 9 phase,
    // 10 freq, 11 valid.

    /// A resistor reads as purely resistive: power factor ≈ 1, V–I phase ≈ 0, the
    /// measured |Z| ≈ R, the detected frequency ≈ the source, and Vrms ≈ amp/√2.
    #[test]
    fn ac_analysis_resistor_is_resistive() {
        // 5 V-peak (default), 1 kHz AC source straight across a 1 k resistor.
        let mut sim = build(
            2,
            &[ELEM_ACSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[1000.0, 1000.0],
        );
        for _ in 0..6000 {
            sim.step();
        }
        let m = sim.ac_measurements();
        let r = &m[AC_FIELDS..2 * AC_FIELDS]; // the resistor (element 1)
        assert!(
            r.iter().all(|x| x.is_finite()),
            "finite measurements: {r:?}"
        );
        assert_eq!(r[11], 1.0, "a full AC cycle has been measured");
        assert!(r[7] > 0.98, "power factor near unity: {}", r[7]);
        assert!(r[9].abs() < 0.05, "phase near zero: {}", r[9]);
        assert!((r[8] - 1000.0).abs() < 30.0, "|Z| ~ 1 k: {}", r[8]);
        assert!((r[10] - 1000.0).abs() < 5.0, "freq ~ 1 kHz: {}", r[10]);
        assert!(
            (r[0] - 5.0 / 2f64.sqrt()).abs() < 0.1,
            "Vrms ~ amp/sqrt(2): {}",
            r[0]
        );
    }

    /// A resistor stays resistive at **high** frequency, where a cycle spans only a
    /// handful of samples. This guards the phase against the zero-crossing artifact:
    /// an in-phase current's rising crossing lands one sample shy of the cycle end, so
    /// a crossing-derived angle would read a spurious `~ -2π/period` lead (−14° at
    /// 20 kHz = 25 samples/cycle). Taking the magnitude from `acos(pf)` reads ~0.
    #[test]
    fn ac_analysis_resistor_phase_zero_at_high_frequency() {
        // 5 V-peak, 20 kHz AC source across a 1 k resistor: 25 samples per cycle.
        let mut sim = build(
            2,
            &[ELEM_ACSOURCE, ELEM_RESISTOR],
            &[1, 1],
            &[0, 0],
            &[20_000.0, 1000.0],
        );
        for _ in 0..6000 {
            sim.step();
        }
        let m = sim.ac_measurements();
        let r = &m[AC_FIELDS..2 * AC_FIELDS]; // the resistor (element 1)
        assert_eq!(r[11], 1.0, "a full AC cycle has been measured");
        assert!(r[7] > 0.98, "power factor near unity: {}", r[7]);
        // The old crossing-based phase read ~ -0.25 rad (-14.4°) here; assert it is ~0.
        assert!(r[9].abs() < 0.05, "phase near zero at 20 kHz: {}", r[9]);
        assert!((r[10] - 20_000.0).abs() < 200.0, "freq ~ 20 kHz: {}", r[10]);
    }

    /// A capacitor's current **leads** its voltage by ~90°: the measured phase is
    /// near −π/2 and the power factor near 0 (the reactive corner).
    #[test]
    fn ac_analysis_capacitor_current_leads() {
        // AC 1->0, R 1->2 (1 k), C 2->0 (0.1 uF) at 1 kHz; measure the capacitor.
        let mut sim = build(
            3,
            &[ELEM_ACSOURCE, ELEM_RESISTOR, ELEM_CAPACITOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[1000.0, 1000.0, 0.1e-6],
        );
        for _ in 0..6000 {
            sim.step();
        }
        let m = sim.ac_measurements();
        let c = &m[2 * AC_FIELDS..3 * AC_FIELDS]; // the capacitor (element 2)
        assert_eq!(c[11], 1.0, "a full AC cycle has been measured");
        assert!(
            c[9] > -1.7 && c[9] < -1.4,
            "capacitor current leads (~ -pi/2): {}",
            c[9]
        );
        assert!(c[7].abs() < 0.1, "power factor near zero: {}", c[7]);
    }

    /// An inductor's current **lags** its voltage by ~90°: the measured phase is near
    /// +π/2 and the power factor near 0.
    #[test]
    fn ac_analysis_inductor_current_lags() {
        // AC 1->0, R 1->2 (1 k), L 2->0 (0.1 H) at 1 kHz; measure the inductor.
        let mut sim = build(
            3,
            &[ELEM_ACSOURCE, ELEM_RESISTOR, ELEM_INDUCTOR],
            &[1, 1, 2],
            &[0, 2, 0],
            &[1000.0, 1000.0, 0.1],
        );
        for _ in 0..6000 {
            sim.step();
        }
        let m = sim.ac_measurements();
        let l = &m[2 * AC_FIELDS..3 * AC_FIELDS]; // the inductor (element 2)
        assert_eq!(l[11], 1.0, "a full AC cycle has been measured");
        assert!(
            l[9] > 1.4 && l[9] < 1.7,
            "inductor current lags (~ +pi/2): {}",
            l[9]
        );
        assert!(l[7].abs() < 0.1, "power factor near zero: {}", l[7]);
    }

    /// The AC analysis reproduces bit-for-bit across runs (the measurements are a pure
    /// function of the V/I trajectory) and stays finite. A series R–L–C from a 500 Hz
    /// source exercises every analyzer at once; the measurement bits are folded into
    /// the replay accumulator so a divergence would be caught.
    #[test]
    fn ac_analysis_run_is_reproducible() {
        let run = || {
            // Series R–L–C: AC 1->0, R 1->2, L 2->3, C 3->0.
            let mut sim = build(
                4,
                &[ELEM_ACSOURCE, ELEM_RESISTOR, ELEM_INDUCTOR, ELEM_CAPACITOR],
                &[1, 1, 2, 3],
                &[0, 2, 3, 0],
                &[500.0, 470.0, 0.05, 0.22e-6],
            );
            let mut acc = sim.snapshot_hash();
            for _ in 0..4000 {
                sim.step();
                acc ^= sim.snapshot_hash().rotate_left(1);
                for &x in &sim.ac_measurements() {
                    assert!(x.is_finite(), "AC measurement stays finite");
                    acc ^= x.to_bits().rotate_left(13);
                }
            }
            acc
        };
        assert_eq!(run(), run(), "AC analysis must reproduce exactly");
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

    /// Three identical diodes in series driven **hard** (30 V across the string, no
    /// ballast) is a textbook Newton-killer: from a cold start the exponential I-V
    /// overflows and bare seeded Newton + `pnjlim` never settles (it hits
    /// [`NEWTON_MAX_ITERS`] un-converged → a NaN / garbage operating point). The
    /// gmin-stepping fallback in [`Sim::solve_nonlinear`] (#88) shunts every node to
    /// ground with a large conductance — a unique, well-conditioned near-ground
    /// point — then walks the shunt down by decades back to zero, recovering the
    /// true answer. By series symmetry the only physical DC root is an **even split**
    /// (identical diodes carry one series current ⇒ equal forward drops), so each
    /// node sits at `drive * (3 - k) / 3`. This is the circuit that exercises the
    /// new convergence path; the gentler ≤10 V version converges on the plain solve
    /// alone (and the fallback then returns immediately, byte-identical).
    #[test]
    fn hard_driven_diode_string_recovers_via_gmin_stepping() {
        // node 0 = GND, 1 = drive rail, 2/3 = inter-diode taps. D: 1->2, 2->3, 3->0.
        let drive = 30.0;
        let sim = build3(
            4,
            &[ELEM_VSOURCE, ELEM_DIODE, ELEM_DIODE, ELEM_DIODE],
            &[1, 1, 2, 3],
            &[0, 2, 3, 0],
            &[0, 0, 0, 0],
            &[drive, 0.0, 0.0, 0.0],
        );
        let v = sim.node_voltages();
        assert!(
            v.iter().all(|x| x.is_finite()),
            "the operating point is finite (gmin stepping converged): {v:?}"
        );
        assert!(
            sim.last_newton_converged(),
            "the gmin-stepping fallback drove the hard diode string to convergence"
        );
        // Even split across three identical series diodes: node 2 = 2/3 of the
        // drive, node 3 = 1/3. (The bare solve would leave these NaN.)
        assert!(
            (v[2] - drive * 2.0 / 3.0).abs() < 1e-6,
            "node 2 sits at two-thirds of the drive (two diode drops): got {}",
            v[2]
        );
        assert!(
            (v[3] - drive / 3.0).abs() < 1e-6,
            "node 3 sits at one-third of the drive (one diode drop): got {}",
            v[3]
        );
    }

    /// The gmin-stepping fallback is a **fixed, integer-free** schedule, so a circuit
    /// that routes through it still reproduces bit-for-bit under the determinism
    /// contract — the same hard diode string hashes identically across two runs.
    /// (Golden-safety of the *engine* golden is separate and stronger: the golden RC
    /// is linear and never enters the Newton path at all, so `GOLDEN_HASH` is
    /// untouched by construction.)
    #[test]
    fn gmin_stepping_fallback_run_is_reproducible() {
        let run = || {
            let mut sim = build3(
                4,
                &[ELEM_VSOURCE, ELEM_DIODE, ELEM_DIODE, ELEM_DIODE],
                &[1, 1, 2, 3],
                &[0, 2, 3, 0],
                &[0, 0, 0, 0],
                &[30.0, 0.0, 0.0, 0.0],
            );
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
            "the gmin-rescued circuit must reproduce exactly"
        );
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

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roadmap: how much more reality

A scoping of the "more reality" question (ADCs and everything after), grounded
against the **actual** deterministic engine in `crates/sim-core/src/lib.rs` — not
generic SPICE theory. Companion to `docs/architecture.md`, `docs/determinism.md`,
and `docs/sim/multi-rate-domains.md`.

## The engine we build on (today)

- **22 element types** (`ELEM_VSOURCE`=0 … `ELEM_PULLUP`=21): sources (V/AC/PULSE/I,
  programmable ISOURCE), passives (R/C/L/transformer), the diode family
  (diode/Schottky/LED/Zener/varistor, Newton-companion Shockley), three-terminal
  actives (NMOS/PMOS/NPN/PNP/op-amp, Newton-linearized), and the **digital engine**
  (powered 5-pin gates, the **DFF**, level-shifter, pull-up).
- **One sequential element already exists** — `ELEM_DFF`: edge-detect on CLK, latch a
  bit, drive a one-tick-delayed output, **hashed** state. It is the prototype every
  clocked converter needs (see "keystone" below).
- **A four-state digital scheduler** ({Low,High,Z,X}, IEEE-1164 `combine`, CMOS/TTL
  families, 1-tick delay) layered on the MNA solve, so gate-only circuits stay on the
  linear fast path.
- **Two golden-safe levers** make additive parts free:
  1. `param_or(params, i, default)` — a param slot of `0.0` means "kind default", so an
     all-zero block reproduces today's solve **bit-for-bit**.
  2. **Ratings only *flag*** (`RATED_CURRENT_SLOT`): the FAIL mask is **never hashed**
     and never alters the solve.
- **The determinism contract**: the sim is a pure function of `(seed, tick, netlist)`;
  the only hash is FNV-1a (`GOLDEN_HASH = 0xeaac_3764_99e4_fa24`, RC demo, 1000 steps).
  Time-varying sources are pure functions of `tick`. The `inv_dt` hook (0 at the DC
  operating point, `1/DT` transiently) is the generic seam for any new charge/reactive
  term — reverse-recovery `TT` is the worked example.
- **Headroom**: 5 terminals (a–e; a 6th is additive but crosses the wire format),
  `PARAM_STRIDE = 4` (a soft ceiling — a few richer models want 5–6 and would bump
  `PROTOCOL_VERSION`). Transient DT = 2 µs → ~62.5 kHz time-domain Nyquist; the
  **frequency domain is analytic and unhashed** (MHz–GHz).

## The three axes

1. **Breadth — new parts.** Mostly *composition* of the 22 existing elements, or thin
   packaging. Low determinism risk, high curriculum coverage.
2. **Depth — richer non-idealities.** Need new **state axes** (temperature, noise) and
   therefore move the golden deliberately. This is where the risk concentrates.
3. **Systems — protocols & instrumentation.** Need whole new engines (behavioral MCU,
   multi-rate sub-ticking). Highest value, deepest dependency chain.

## The realization

**Most of the classic curriculum is already buildable from the 22 elements** — because
the DFF (sequential, hashed) + the four-state gate engine + the Newton analog models
(BJT/MOSFET/op-amp/diode-family) already span it. So a large slice of "more reality"
ships as **worked examples + glyphs with zero new core code**, and the real investments
are a small number of *mechanisms* that each unlock a whole cluster.

## Prioritized additions (first slices)

Fit: ✅ composes from existing elements · 🟡 new element, existing mechanism · 🔴 needs a
new core mechanism. Risk: 🟢 golden-safe additive · 🟡 moves golden (deliberate regen) ·
🔴 needs new hashed-state machinery / seeded PRNG.

| Addition | Axis | Fit | Risk | Effort | Why |
| --- | --- | --- | --- | --- | --- |
| Counters / shift registers / mux / decoders | Breadth | ✅ (DFF + gates) | 🟢 | S–M | Best ratio on the list; unlocks all sequential logic |
| R-2R **DAC**, current mirror, instrumentation amp, comparator/Schmitt | Breadth | ✅ build-from-parts | 🟢 | S | Zero core code; immediate breadth (R-2R is a gem) |
| More FF types (JK / T / SR / D-latch) | Breadth | 🟡 (DFF variant) | 🟢 | S | Trivial extension of the existing hashed DFF |
| Generic **clocked sample-and-hold** | Depth (mech) | 🔴→🟡 | 🟢* | M | **Keystone** — the DFF is already ~90% of it |
| **ADC** (flash / SAR) + packaged **DAC** | Mixed-signal | 🟡 on the sampler | 🟢* | M→S | The headline pair; sampling / quantization / Nyquist |
| Open-loop **buck/boost** + **LDO** (then packaged) | Power | ✅ (switch+L+D+C) | 🟢 | S→M | The ATX/SMPS thread; primitives already exist |
| **555 timer** | IC | 🟡 (or build-from-parts) | 🟡/🟢 | M/S | The canonical analog↔digital teaching IC |
| Photodiode / phototransistor (**light input**) | Sensors | 🔴 input channel | 🟢* | M | First non-electrical input; opens the sensor family |

\* golden-safe once the enabling mechanism defaults to a fixed/zero state.

## Infrastructure unlocks (build the mechanism once, get a cluster)

1. **A generic clocked sampler / sample-and-hold.** Generalize the DFF from "latch 1
   bit" to "latch an N-bit code or an analog level on a clock edge." Unlocks **ADC
   (flash & SAR), DAC, sample-and-hold, switched-capacitor, synchronous counters, and
   the sigma-delta input stage**. Golden-safe-additive (new hashed state defaults
   fixed). **Highest leverage, and the cheapest — the DFF is already most of it.**
2. **A per-device thermal state `Tj`** with a backward-Euler thermal companion (the
   *same* pattern as the capacitor companion, in the temperature domain). Device params
   (Vbe, Is, β, Kp, Rds-on) become `Tj`-dependent → **self-heating, thermal runaway,
   derating/SOA, and a real bandgap reference** fall out. Pairs with the rating→FAIL
   system. Moves the golden (gate to Real mode + default-ambient).
3. **A deterministic per-element PRNG** keyed on `(seed, tick, element_index)` (a
   counter-based integer fold — rewinds with the tick, reproduces cross-machine by
   construction). Unlocks **all noise (Johnson / shot / flicker)** as per-element
   stamps. The one item that *must* touch the hash → Real-mode-gated + opt-in density
   param so the default stays bit-identical, then regenerate the golden as a documented
   act. (Consider hosting noise first in the **unhashed frequency domain** — cheaper and
   more legible than time-domain injection at DT = 2 µs.)
4. **An external-input channel** (a UI-driven scalar per element, default 0, plumbed
   through `aux`/`params`). Unlocks **light sensors, transducers, and "knob" inputs** —
   the first non-netlist inputs. Golden-safe when default.
5. **The behavioral-MCU / multi-rate engine** (already designed in
   `docs/sim/multi-rate-domains.md`; `uC`/`FP` are rendered-only placeholders today).
   Unlocks **protocol buses (I²C / SPI / UART), firmware, the FPGA tier, sigma-delta,
   and closed-loop SMPS controllers**. I²C is *partway* enabled now via the existing
   open-drain + pull-up wired-AND bus. The long-horizon systems unlock.

## Recommended first arc

1. **Now, zero core code:** ship the composition wins as worked examples + glyphs —
   counters/shift registers, R-2R DAC, current mirror, instrumentation amp,
   op-amp-Schmitt, an SRAM cell from cross-coupled inverters, an open-loop buck. These
   are pure breadth at no determinism risk and exercise parts we already have.
2. **Then the keystone:** build the **generic clocked sampler**, and ship **ADC + DAC**
   on it as the proof. This is the mixed-signal headline the owner called out.
3. **Then it cascades:** **comparator/Schmitt** (packaged), the **555**, more **FF
   types**, and **switched-cap** nearly fall out of (1)+(2).
4. **Depth, deliberately:** the **thermal `Tj`** axis (twin of rating→FAIL) and the
   **seeded PRNG** for noise — each gated to Real mode, each a documented golden regen.
5. **Long horizon:** the behavioral-MCU/multi-rate engine for buses + firmware.

## Determinism guardrails for everything above

- Additive parts using `param_or` 0-defaults and the rating→FAIL path are golden-safe by
  construction — prefer that shape.
- Any new **hashed state** (sampled codes, `Tj`, latch bits) must fold into
  `snapshot_hash` in fixed order, default to a fixed value, and (if it changes the solve)
  be Real-mode-gated with the golden regenerated as an explicit, explained PR.
- Never introduce a non-deterministic source (`getrandom`, float-state RNG, std default
  hasher). Noise uses the integer-fold PRNG only. (Golden rule #1.)

# ADR 0003: High-pin-count devices (advanced ADCs, MCUs, FPGAs)

Status: accepted (design; implementation lands with the first wide device)

## Context

ADR 0002 provisions the per-element wire format to **8 terminals**. That covers the
discrete + small-IC universe (555, full flip-flops with set/reset/enable, dual-supply
op-amps, center-tapped transformers). It does **not** cover devices with tens to
hundreds of *independent* pins:

- a parallel ADC/DAC data port (8-24 bits),
- a microcontroller (8-100+ GPIO, each wired to a different net),
- an FPGA (hundreds of independent I/O).

A fixed terminal cap, at any value, just moves the wall — an MCU's pins are not a bus
and not a fixed count, they are an arbitrary set of independent net connections. So the
answer is **not** "raise `MAX_TERMINALS` higher."

## Decision

**Represent high-pin-count devices as a COMPOSITE: one behavioral "core" element plus
N single-terminal "pin" elements, expanded web-side** — the established
`buildNetlist` pattern that already turns one electrolytic-cap / potentiometer /
electronic-load Component into several Elements.

- **The core** (`ELEM_MCU` / `ELEM_FPGA` / a wide-`ELEM_ADC` core, etc.) carries the
  device's behavioral state (registers, program counter, configuration, conversion
  result) in one new **hashed** state vector keyed by the core's element index. It has
  only a few real terminals (supply, maybe a master clock), so it never pressures the
  terminal cap.
- **Each pin** is a tiny `ELEM_IO` element with **one** terminal to its net, tagged with
  its `(core element index, pin index, direction)` — carried in existing scalar/param
  slots, so **no new `Element` struct field and no terminal-count change**. A pin element
  drives or senses its net through the existing four-state digital machinery, so every
  GPIO is a first-class, probeable net (contention, tri-state, and wired-AND come free).
- **Evaluation order:** the core evaluates first (reads its input pins' committed net
  levels, runs its behavioral step, writes per-pin drive into shared scratch keyed by
  core index); each pin element then applies its slice. Order is element order
  (deterministic). This reuses the existing eval-digital → stamp-digital → commit phases;
  a faster-than-2µs core uses the multi-rate sub-ticking from `docs/sim/multi-rate-domains.md`.

**Wide DATA buses** (an ADC's parallel output, a memory data bus) use the ADR 0002 hybrid:
per-bit digital nets when the bits are visible/probeable (each via a pin element), and a
packed `NetClass::Bus` net carrying an integer code only inside the behavioral domain
(MCU↔memory), where per-line physicality is not the lesson.

The new core mechanism is therefore **inter-element state sharing** (a pin references its
core's index) plus the **behavioral-block engine** (M8) — not a wider element.

## Rationale

- **Scales without a cap.** Pin count is "more pin elements"; nothing in the format limits
  it. An 8-pin part, a 40-pin MCU, and a 256-ball FPGA all use the same representation.
- **No solver refactor.** The fixed-terminal `Element` and every existing stamp stay as
  they are; the change is additive (new element kinds + one shared-scratch vector). This
  is far less risky to the golden than making terminals variable-length (which would touch
  every element's stamping).
- **Reuses the per-net machinery.** Each visible pin is an ordinary digital net, so
  probing, contention (`combine` -> `X`), open-drain/pull-up buses, and tri-state already
  work — the exact teaching properties we want for an MCU GPIO or a bus.
- **Matches a shipped pattern.** `EC`/`POT`/electronic-load already expand one Component
  into several Elements in `buildNetlist`; this is the same pattern with a back-reference.
- **Golden-safe by construction.** New element kinds + a new hashed core-state vector that
  is empty for any circuit without these devices (the RC golden has none) -> the hash is
  byte-identical. The core-state vector folds into `snapshot_hash` in fixed element order,
  appended after the existing folds, defaulting to a fixed reset state.

## Alternatives considered

- **Raise `MAX_TERMINALS` to 16/32/...:** rejected — moves the wall, never reaches FPGA
  scale, and bloats every element's footprint for capacity almost nothing uses.
- **Variable-length terminal list (a `Vec` of terminals per element):** the cleanest
  *model*, but a solver-wide refactor (every `e.a`/`e.b`/... access and the whole boundary)
  with real golden risk, for a uniformity payoff the composite already delivers. Reserve as
  a future cleanup only if the composite bookkeeping ever bites.
- **Packed bus net for everything:** rejected for GPIO (an MCU's pins are independent nets,
  not one word); kept only for genuine internal word-buses.

## Notes

- This is **feasibility + design**; it implements when the first wide device (a multi-bit
  ADC/DAC or the behavioral MCU) is built. It depends on ADR 0002 (the 8-terminal core
  elements) and on the behavioral-block + multi-rate mechanisms (M7/M8 in the exhaustive
  catalog). The clocked sampler (`ELEM_SAMPLER`) is the analog-side keystone that the wide
  ADC's per-bit comparators reuse.
- Determinism guardrails (CLAUDE.md golden rule #1) apply to the core's behavioral state:
  FNV-1a fold in fixed order, deterministic state machine (no PRNG unless via the seeded
  per-element generator), default reset state -> golden-safe. The pin elements add no
  hashed state of their own.
- Keep the JS<->wasm boundary coarse (ADR 0001): the composite expands into the one
  batched netlist install; the back-references ride in existing scalar/param slots.

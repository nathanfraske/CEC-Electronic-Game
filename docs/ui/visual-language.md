# Visual language — voltage and current on a bus

Status: **draft** (owner-provided "outline styles, not final"). The interactive
reference is [`dc-bus-reference.html`](./dc-bus-reference.html) — open it in a
browser and drag the loads, flow speed, and IR-drop toggle.

Voltage and current are different kinds of thing, so they must read differently.
This is the canonical encoding the board renderer should follow.

## Voltage — a property of the net (a shared *level*)

- Encoded as: **vertical level** (belt height on the potential axis) + **rail
  identity color** + an **exact number**.
- Uniform along a net; **sags only under load** (real IR drop, `V -= I·Rseg`).
- **Ground is the 0 V reference**; voltage is always a difference against it.

## Current — flow along the conductor

- Encoded as: **direction + speed + density** of chevrons, **belt thickness**
  (stroke width, normalized to `Imax`), and an **exact number** (amps).
- At a **tap/load the flow divides** — Kirchhoff's current law made visible: the
  branch takes its share, the belt continues thinner, *in = out*.
- The aggregate **return flows back along the ground bus**.

## Carriers and energy — two layers on the belt

A belt carries two things at once, and they are **not the same thing** — this is
the loop-tile idea, and it is how the board shows AC honestly.

Both layers travel at a **constant, readable rate** — magnitude is carried by
density + thickness + the number, never by speed (see *Decoupling flow rate from
magnitude* below). What each layer integrates is a **direction**, not a
magnitude.

- **Carriers (charge)** — the voltage-coloured chevrons. Their position
  integrates the **sign of the current**, so on DC they stream steadily and on AC
  they **slosh in place** (the current reverses every half-cycle; the chevron
  flips and walks back). Net charge transport over an AC cycle is ~zero, and you
  can see it.
- **Energy (power)** — warm-orange dots (`#ff8a3d`). Their travel integrates the
  **sign of the power `v·i`**. On a resistor `v` and `i` reverse *together*, so
  the product stays positive and the energy **streams steadily to the load even
  while the carriers slosh** — the heart of why AC delivers power without net
  charge flow. On a reactive part `v` and `i` are a quarter-cycle apart, so `v·i`
  alternates sign and the energy **sloshes in and back out** with no net delivery
  (reactive power, made visible).

Energy rides the **high-potential** wire: a return near 0 V carries the same
carriers but `v≈0`, so almost no energy density — which is exactly where the
power does and does not flow.

Both layers are presentation-only phase accumulators (`carrierOffset` /
`energyOffset` in `board.ts`); stepping or scrubbing the timeline backward runs
them backward too. They never feed the simulation.

## Decoupling flow rate from magnitude

Speed must **not** encode magnitude. If chevrons sped up with current or voltage
they became an unreadable blur on high-power circuits — and because the on-screen
rate also scaled with playback ticks-per-second, slowing the sim didn't help.
Both couplings are removed:

- One **bounded visual flow clock** drives every animated thing (glyph flow dots,
  belt chevrons, energy dots, breathing pulses). It advances at a fixed
  wall-clock rate (`FLOW_HZ` in `board.ts`, ~0.6 cycles/s), **independent of V, I,
  and tps**, so the flow always reads at the same calm pace.
- The timeline contributes **direction only**: forward while running, and the
  sign of the tick change while paused (so stepping/scrubbing back reverses the
  flow, an idle pause freezes it).
- **Magnitude** is then carried entirely by **density** (dot/chevron count),
  **belt thickness**, and the **exact number** — the encodings this document
  already mandates — plus the carrier/energy *sign* that gives AC its slosh.

Target band: ~0.3–1.5 visual Hz across every current and every playback rate.

## Color is identity, not magnitude

You cannot read 12.0 V against 11.7 V from a hue, so color only *names* the rail;
height + number carry the value.

| Rail | Token | Hex |
| --- | --- | --- |
| +12 V | `--r12` | `#d8a24a` (amber) |
| +5 V | `--r5` | `#46d2e6` (cyan) |
| +3.3 V | `--r33` | `#9a78ff` (violet) |
| GND | `--gnd` | `#6b6488` |
| caliper / annotation | `--rose` | `#f5247a` |

## Invariants

- Height = voltage; thickness + flow rate + chevron density = current.
- KCL holds at every tap; one aggregate ground return (drawn once for
  readability, not a wire per load).
- IR drop is real (tens of mΩ per segment); a droop past ~4% reads as `--warn`.
- Bus power = Σ (V_end · I) per rail.

## Mapping to the engine

The analog core already produces both quantities: MNA gives node voltages and
branch/source currents (see `crates/sim-core`). When the board graph is compiled
into a netlist (see `TODOS.md`), render each **net** with the voltage encoding
and each **conductor/edge** with the current encoding.

## Implementation notes (for the next agent)

- The reference is SVG; the game board is **PixiJS**. Port the *encoding*, not
  the SVG markup, into `web/src/lib/board.ts`: thickness via line width,
  chevrons via repeated graphics animated by a phase accumulator, color per
  rail, numbers via Pixi `Text` or a DOM overlay.
- Add the rail identity tokens (`--r12/--r5/--r33/--gnd`) to `web/src/app.css`
  and hex mirrors in `board.ts` when implementing.
- Keep it deterministic-friendly: the animation phase is presentation-only and
  must never feed back into the simulation.

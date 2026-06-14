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

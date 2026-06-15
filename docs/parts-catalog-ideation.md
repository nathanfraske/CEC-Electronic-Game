# Parts catalog — ideation for the discrete/analog menagerie

Status: **design ideation. No code.** This is the long-form companion to
`parts-roadmap.md` (the short audit of ideal elements) and `game-factory-loop.md`
(the builder feel). Its job: take the full wish-list of real discrete/analog
parts — relays, LEDs, the diode family, real capacitors, the whole transistor
zoo, transformers, fuses, MOVs, thermistors, op-amps, manual switches, LDRs,
seven-segment displays — and give each a **concrete starting spec**: what it
teaches, how it lives in the deterministic MNA core, its schematic glyph, its
Factorio building, how it reads in the power-bus visual language, and what sim
capability it depends on.

Where I push on or extend the existing docs I say so. Everything here honors the
two non-negotiables: **determinism is sacred** (FNV-1a snapshot hash + pinned
golden; `docs/determinism.md`) and the **JS↔wasm boundary stays coarse**
(one batched snapshot per frame; `web/src/sim/loop.ts`). The bet of the whole
project — *the belts never lie* — means a part earns its place only if its model
is honest physics the solver actually integrates, not a faked mechanic.

---

## 0. How to read an entry

Each part gets the same six fields the brief asks for:

1. **Teaches** — the one electronics idea a learner walks away with.
2. **Sim model** — terminals; which existing `ELEM_*` it reuses or what new
   primitive it needs; linear vs Newton; key parameters; carried state; and an
   explicit **determinism note** when it touches the hash, the iteration count,
   hysteresis state, or a topology change.
3. **Schematic** — the purist glyph (a new `DRAWERS` entry).
4. **Factory** — the building, in the spirit of the existing set (cap = buffer
   chest, source = generator, resistor = throat, inductor = flywheel, diode =
   check-valve, switch = door, ground = drain), with how it animates against the
   flow/charge/energy clock.
5. **Reads as** — how voltage / current / energy show on or through it in the
   bus language (`docs/ui/visual-language.md`).
6. **Tier + deps** — the difficulty tier and the sim primitive that must exist
   first.

A recurring vocabulary for the **new primitives** (the capability roadmap, §9,
is organized around exactly these):

- **P1 — piecewise/lookup nonlinearity.** A two-terminal `i(v)` that is not the
  silicon Shockley curve but still a static function the Newton loop can
  linearize (Zener reverse breakdown, LED with a series-`Rs` + higher `Vf`,
  varistor, ideal-ish rectifier knees). Reuses the *entire* existing Newton
  machinery; only `diode_eval`/`pnjlim` get a parameterized sibling.
- **P2 — per-device parameters.** Today `value` is one `f64` and the diode
  ignores it. Several parts need 2–4 params (Is, n, Vf, Vz, Rs, …). This is a
  protocol/UX change (a small fixed-width param block per element), not a solver
  change. Flagged because half the family is blocked on it.
- **P3 — multi-terminal devices (>2 nodes).** BJT, MOSFET, op-amp,
  transformer, relay-with-coil all break the "every element has exactly two
  terminals, nodes a and b" assumption baked into `Element`. This is the single
  biggest engine lift and it gates the entire active-device tier.
- **P4 — controlled sources (VCCS/VCVS/CCCS/CCVS).** Linear two-ports that sense
  one pair and drive another. `parts-roadmap.md` already notes these are clean
  math, deferred only on the two-port placement UX. They are the substrate for
  transistors-as-small-signal, the ideal op-amp, and the ideal transformer.
- **P5 — coupled inductors (mutual M).** Two (or more) inductor branches sharing
  a mutual-inductance term. Pure linear extra branch constraints; gates the
  transformer.
- **P6 — stateful / hysteretic elements.** A latch bit that the *solution*
  flips, not the tick: relay armature, fuse blown/intact, PTC tripped, comparator
  output, manual-switch position. Needs an interaction + netlist-invalidation
  path **and** — the determinism-critical part — the state transition must be a
  pure function of committed solver readout on the tick grid, hashed into the
  snapshot.
- **P7 — thermal / light state.** A scalar per element (junction temperature,
  incident lux) that evolves on the tick grid and modulates the device. Gates
  thermistors, the *real* fuse/MOV (energy-to-blow), the LDR, and photodiodes.
  Like the reactive companion, it is per-element state that must hash.
- **P8 — light/display I/O channel.** A presentation-and-grading channel: a part
  *emits* a scalar (LED brightness, 7-seg segment states) or *receives* one
  (LDR, photodiode). Emission is pure presentation; reception needs P7. The
  contract system can read/grade the emitted channel.

Two standing determinism rules that every stateful part below obeys:

- **State changes land on the tick grid and hash.** Any latch/temperature/lux
  that affects the solution is committed in `step()` from the just-solved
  readout (exactly how `reactive_state` and `diode_vd` are committed today) and
  is folded into `snapshot_hash`. A presentation-only quantity (LED glow, energy
  dots) never feeds back and never hashes — same discipline as `carrierOffset`.
- **Hysteresis is integer/threshold, never float-equality.** A relay or
  comparator switches on `v > v_on` / `v < v_off` with a **dead band**, and the
  resulting boolean is the state. Never branch on `v == threshold`; the dead band
  plus committed-readout ordering keeps the transition reproducible across
  toolchains the way the switch's `(tick % period) < on_ticks` does.

---

## 1. The diode family — pure wins on the Newton path we already have

The diode (`ELEM_DIODE = 5`) already drags in the whole deterministic
Newton–Raphson loop: companion `g = di/dv`, `pnjlim` damping, `GMIN` floor,
bounded iteration. **Every member of the diode family is a re-parameterization
of that exact machinery** — which makes this family the cheapest high-teaching
batch in the catalog. The only true prerequisite is **P2 (per-device params)** so
each device can carry its own `Is`/`n`/`Vf`/`Vz`/`Rs` instead of the hard-coded
constants; the solver is otherwise untouched.

### 1.1 LED (light-emitting diode)

1. **Teaches** — a diode with a *real* forward drop (1.8–3.4 V by color) and the
   canonical first design judgment: **size a series resistor to set current**
   (`R = (Vsupply − Vf) / I`). The "drive this LED at 20 mA" lesson.
2. **Sim model** — 2-terminal, Newton, reuses the diode path. Diverges from the
   signal diode by a **higher `Vf` and a small series `Rs`** so the I–V knee sits
   at the color's drop and current is well-behaved past it: model as the Shockley
   junction with an explicit series resistance (either a baked `Rs` inside the
   companion, or — cheaper to ship first — the junction in series with a hidden
   internal resistor element). Params (P2): `Vf` (via `Is`,`n` chosen to hit the
   knee) and `Rs`. **Emits** a brightness scalar ≈ `f(max(0, i))` on the P8
   channel — pure presentation, does **not** hash. *Determinism note:* identical
   to the diode; the brightness channel is presentation-only.
3. **Schematic** — the diode triangle + bar with **two small arrows** radiating
   off the body (the "emitting" mark). Reuse `drawD`; add the arrows and tint the
   forward-glow by the LED color.
4. **Factory** — a **beacon / floodlight tower**. The one-way conveyor gate from
   `drawFD`, but the building casts a cone of light whose brightness rides the
   forward current. Under-driven: a dim ember. At rated current: a clean steady
   beam. Over-driven (past a soft limit): the beam flares white and the body
   starts to glow `--bad` — the visual setup for the LED-burnout test-bench beat.
5. **Reads as** — forward conduction lights the body and streams energy dots into
   it (the LED *is* the load — energy terminates here, like a resistor); reverse
   bias goes dark with no flow. The series resistor beside it shows the dropped
   voltage as belt-height loss; the LED node sits one `Vf` above its cathode.
6. **Tier + deps** — **Tier 1.5.** Needs **P2** (per-color `Vf`) and the **P8**
   emit channel. Outstanding first contract part (see §11).

### 1.2 Zener diode

1. **Teaches** — **controlled reverse breakdown** as a feature, not a failure: a
   Zener clamps its cathode at `Vz` and is the simplest **shunt voltage
   regulator/reference**. The "regulate this rail to 5.1 V with a Zener" lesson.
2. **Sim model** — 2-terminal, Newton. **P1 piecewise nonlinearity:** forward it
   is an ordinary junction; reverse it conducts hard once `|v| > Vz`. Concretely
   a second exponential (or a soft-knee `i = Iz0 * (exp((−v−Vz)/(nz·Vt)) − 1)` in
   the reverse region) added to `diode_eval`. The breakdown branch reuses the
   *same* companion/`pnjlim` discipline — the knee is just at `−Vz` instead of
   `0`, so it needs its own limiting reference around `Vz`. Param (P2): `Vz`.
   *Determinism note:* the reverse exponential must be voltage-limited around the
   breakdown knee exactly as `pnjlim` limits the forward knee, or a deep reverse
   step explodes the iteration; a `vzlim` sibling keeps the count bounded.
3. **Schematic** — the diode triangle with the **bent "Z" cathode bar** (the
   classic Zener flag). Reuse `drawD`, swap the straight cathode line for the
   stepped one.
4. **Factory** — a **pressure-relief / overflow weir** on the high-potential
   rail. The check-valve gate, plus a side spillway that **only opens when the
   rail rises above the `Vz` mark** — then it visibly dumps the excess to the
   ground drain, pinning the rail height. You watch the rail try to climb and the
   weir hold it flat. This is the cap-as-buffer-chest move's regulating cousin.
5. **Reads as** — the regulated node's **belt height stops climbing at `Vz`**
   even as upstream voltage rises; the excess current diverts down the Zener to
   ground (a new branch the belt splits into at the tap, KCL visible). The series
   resistor's belt eats the difference.
6. **Tier + deps** — **Tier 2.** Needs **P1** + **P2**. Strong contract part
   ("hold this node at 5.1 V across a load swing").

### 1.3 Schottky diode

1. **Teaches** — a **lower forward drop (~0.3 V) and fast recovery**; why you pick
   it for the freewheel/rectifier in a switcher to cut losses. Connects directly
   to the buck converter the core already simulates.
2. **Sim model** — 2-terminal, Newton, *trivial* given P2: the diode with a
   **larger `Is`** (which lowers `Vf`) and lower `n`. No new math at all. (Fast
   reverse recovery is a charge-storage effect we can omit at v1 and add later as
   a junction capacitance.) *Determinism note:* none beyond the diode's.
3. **Schematic** — the diode with the **"S"-flared cathode bar** (Schottky
   hooks). Reuse `drawD`, restyle the cathode.
4. **Factory** — a **low-friction check-valve**: same gate as the diode, but
   slimmer throat and a near-frictionless sheen — it passes flow with almost no
   height loss, which is exactly the teaching contrast against the silicon diode.
5. **Reads as** — like the diode but the **forward belt-height drop across it is
   visibly smaller** (~0.3 V vs ~0.7 V). Side-by-side with a normal diode this is
   a clean "see the difference" demo.
6. **Tier + deps** — **Tier 1.5.** Needs only **P2**. Cheapest member after the
   plain diode.

### 1.4 Photodiode

1. **Teaches** — **light → current**: a reverse-biased junction whose leakage is
   proportional to incident light; the front end of every light sensor and the
   conceptual bridge to solar cells.
2. **Sim model** — 2-terminal, Newton. The diode equation with an added
   **light-current source term** `I_ph(lux)` in parallel: `i = I_shockley(v) −
   I_ph`. **Needs P7** (an incident-lux scalar per device, set by the
   environment/contract or by a paired LED's emission) and **P8 receive**.
   *Determinism note:* `I_ph` is a function of the lux scalar, which lives on the
   tick grid and **hashes**; if lux is constant for a scene it is just a
   parameter and the determinism story is the diode's.
3. **Schematic** — the diode triangle with **two arrows pointing in** (absorbing
   light — the inverse of the LED's outgoing arrows).
4. **Factory** — a **solar collector / intake vent**: a check-valve whose flow is
   *driven by* a light cone falling on it (e.g. from a nearby LED beacon building
   or the scene's ambient light), rather than by the rail. More light → fatter
   reverse current belt.
5. **Reads as** — reverse current that **scales with the incident-light channel**,
   not with applied voltage; the belt thickens as the light rises. Pairs visually
   with the LED (one emits the cone, the other drinks it) — an opto-isolator demo.
6. **Tier + deps** — **Tier 3.** Needs **P7** + **P8**. Lands naturally *after*
   the LED and LDR establish the light channel.

> **Family verdict.** Schottky and LED are near-free once **P2** lands; the Zener
> needs the small **P1** reverse-knee + its `vzlim`; the photodiode waits for the
> **light channel (P7/P8)**. This is the highest teaching-value-per-engine-effort
> cluster in the whole catalog and should go first (see §10).

---

## 2. Real capacitors — fidelity on a part we already integrate

The ideal capacitor (`ELEM_CAPACITOR = 2`) is the buffer chest. "Real" caps are
the **fidelity-is-progression** pillar (`game-design.md`) applied to a part the
player already loves: same backward-Euler companion, plus **parasitics** that
turn an idealization into an engineering choice.

### 2.1 Electrolytic capacitor (with ESR + polarity)

1. **Teaches** — **bulk energy storage with a cost**: high capacitance but real
   **ESR** (equivalent series resistance) that limits ripple current and dissipates
   heat, plus **polarity** (reverse it and it fails). The "bulk decoupling that
   survives a load step" part — literally the buffer-chest gameplay of
   `game-factory-loop.md` §1.
2. **Sim model** — 2-terminal, linear. The existing C companion **in series with
   a small resistor** (model ESR either as the cap's companion conductance
   feeding through an internal `Rs`, or — ship-first — an ideal C plus an
   auto-paired hidden R). Params (P2): `C`, `ESR`. **Polarity** is a flag: if the
   committed steady voltage goes negative past a margin, raise a *fault* (ties to
   the test-bench vent, P6/P7 for the energy-to-fail version). *Determinism note:*
   the ESR resistor is just another linear stamp — zero risk. The polarity-fault
   latch, if added, is a P6 boolean that hashes.
3. **Schematic** — the cap with **one curved plate** (the polarized symbol) and a
   `+` by the straight plate.
4. **Factory** — a **big ribbed pressure tank** (vs the ceramic's small chest):
   visibly large, fills slower per unit charge, and the **ESR shows as a short
   throat on its inlet** — you can see ripple current "rubbing" through it (a faint
   heat shimmer on the inlet under AC ripple). Reverse-polarize it and a red
   `--bad` warning bulges the tank (setup for the vent).
5. **Reads as** — fills like the ceramic chest (height = its voltage) but the
   **inlet belt shows an IR-drop notch** across the ESR — energy dissipates there
   under ripple, visible as a small steady energy sink even while the cap itself
   stores reactively. This makes ESR *legible*, which is the whole point.
6. **Tier + deps** — **Tier 1.5.** Needs **P2** for ESR; the polarity vent is a
   **P6/P7** upgrade. The plain ESR version ships almost immediately.

### 2.2 Ceramic capacitor (low-ESR, non-polarized, with voltage derating)

1. **Teaches** — the **decoupling workhorse**: tiny, fast, non-polarized; and the
   real gotcha that **class-2 ceramics lose capacitance under DC bias** (voltage
   derating) — the first "the datasheet number isn't the operating number" lesson.
2. **Sim model** — 2-terminal, linear. The ideal C companion with **near-zero
   ESR**; the optional fidelity twist is a **bias-dependent `C(V)`** — a mild P1
   nonlinearity on a *reactive* element (the companion `g = C(V)/dt` recomputed
   from the committed voltage). Param (P2): `C0`, derating curve. *Determinism
   note:* a voltage-dependent companion is still a per-step deterministic stamp
   **if** `C(V)` uses the previous committed voltage (no new iteration); if it
   must be solved self-consistently it joins the Newton loop — ship the
   previous-voltage version first to keep it linear.
3. **Schematic** — the **two straight parallel plates** (the existing `drawC` is
   already exactly this — ceramic is the "default" cap).
4. **Factory** — the **existing small buffer chest** (`drawFC`), placed as the
   *fast decoupling* unit right next to consumers. Where the electrolytic is the
   district's big tank, the ceramic is the per-machine snack chest.
5. **Reads as** — exactly today's cap chest: fills with voltage, slosh on AC, no
   ESR notch. The derating version subtly **shrinks its effective fill capacity as
   its DC level rises** — a neat, honest visual for a famously counterintuitive
   effect.
6. **Tier + deps** — **Tier 1** (it *is* today's cap). Derating is a **Tier 2**
   fidelity upgrade needing **P1/P2**.

> **Pairing teaching.** The killer lesson is **both together**: a bulk
> electrolytic for the district + a ceramic at each consumer is real power-integrity
> practice, and `game-factory-loop.md` already frames decoupling as the
> buffer-chest mechanic. A contract: "decouple this load so its rail stays within
> 4% during the switch transient."

---

## 3. The transistor zoo — the active-device tier (gated on multi-terminal + Newton)

This is the **Tier-2 wall** from `game-design.md` and the big engine lift. Every
member here is **3-terminal (P3)** and **nonlinear (Newton)**. The honest
sequencing: you cannot ship *any* of these until `Element` grows past two
terminals and the Newton loop accepts >2-node devices. But once that lands, the
zoo is a family of `i(v)` curves stamped into the loop you already have. I list
them in the order I'd actually implement them.

A note on **two models per device** (matches the programmability tiers): each
transistor can be offered as a **large-signal nonlinear model** (the truthful
default — Newton) *or*, for black-boxed/validated districts, a cheaper
**small-signal controlled-source model** (P4) when the player only needs gain.
Ship the large-signal model first; it is the honest one.

### 3.1 NPN BJT (and PNP)

1. **Teaches** — **current-controlled current gain**: a small base current
   controls a large collector current (`Ic = β·Ib`); the first amplifier, the
   first "1 in → many out" assembler of `game-factory-loop.md` §2; and saturation
   vs active region.
2. **Sim model** — **3 terminals** (C, B, E). The **Ebers–Moll / Gummel-Poon-lite**
   model: two coupled junctions (B-E and B-C) plus the forward/reverse current
   transfer. This is *exactly* the existing diode companion logic applied to two
   junctions with a transfer term — the Newton loop, `pnjlim`, and `GMIN` all
   carry over; the only new thing is the 3×3 device stamp coupling C/B/E rows.
   Params (P2): `Is`, `βF`, `βR`, `VA` (Early, optional). State: the two junction
   voltages (like `diode_vd`, now a pair). *Determinism note:* same as the diode —
   bounded iteration, per-junction limiting; the device just contributes more
   companion entries. PNP is the same model with reversed polarities.
3. **Schematic** — the **circle with base bar + emitter arrow** (arrow out = NPN,
   in = PNP). New `drawBJT`; the third pin breaks the two-pin glyph assumption, so
   this is also where the renderer learns 3-pin parts.
4. **Factory** — a **valve / gain-assembler**: a small **control belt (base)**
   meters a trickle into the side of the building, and the building opens a
   **wide main belt (collector→emitter)** in proportion — a little lever opening a
   big sluice. Saturation = the main sluice hits full-open and stops responding to
   more base trickle (visually it "bottoms out"). This is the literal Factorio
   "small input gates large throughput" fantasy, and it's true physics.
5. **Reads as** — three belts meet at the building: a **thin base belt**, a **fat
   collector belt**, and the emitter belt carrying their **sum (KCL: Ie = Ic +
   Ib)** — which is a beautiful, exact Kirchhoff demonstration at a node the
   player built. Voltage-wise, `Vbe ≈ 0.7 V` shows as a fixed small height step
   into the base; `Vce` is the collector's height above the emitter.
6. **Tier + deps** — **Tier 2 (gating).** Needs **P3** + Newton (have it).
   Optional small-signal mode needs **P4**. *This is the keystone — once the BJT
   works, MOSFET/JFET/Darlington/op-amp are incremental.*

### 3.2 N-channel MOSFET (and P-channel)

1. **Teaches** — **voltage-controlled** conduction (gate voltage, ~no gate
   current); the modern switch and the heart of every logic gate and power
   switcher; threshold `Vth`, triode vs saturation regions.
2. **Sim model** — **3 terminals** (D, G, S) (body tied to source at v1). A
   **square-law model**: `Id = 0` for `Vgs < Vth`; `Id = k·((Vgs−Vth)·Vds −
   Vds²/2)` in triode; `Id = (k/2)(Vgs−Vth)²·(1+λVds)` in saturation. A smooth,
   differentiable `i(v)` → drops straight into Newton with a 3×3 stamp; the gate
   draws ~no DC current (a tiny `GMIN` keeps the gate row non-singular). Params
   (P2): `Vth`, `k` (≈ µCox·W/L), `λ`. *Determinism note:* the square law has no
   exponential, so it is *gentler* than the diode for Newton; still apply a step
   limiter on `Vgs` near `Vth` for robustness. The region boundary must use a
   consistent tie-break (e.g. `Vds < Vgs−Vth` chooses triode) — a fixed inequality,
   never a float-equality branch.
3. **Schematic** — the **MOSFET symbol**: gate bar (isolated), the channel with
   the body arrow (in = N, out = P), source/drain. New `drawMOSFET`.
4. **Factory** — an **electric flood-gate / sluice**: the **gate is a control
   *voltage* paddle** (no belt feeds it — emphasizing zero gate current, the
   contrast with the BJT's base trickle), and raising the paddle above `Vth`
   opens the main drain→source channel. Below threshold: sealed shut. Fully on:
   a wide-open low-resistance channel (Rds(on) — a slight throat). The "no input
   belt to the gate" is the readable difference from the BJT building.
5. **Reads as** — the **gate node's belt height** (voltage) is the control; the
   **drain→source belt** opens once that height crosses the `Vth` mark. With the
   gate drawing no current, there's *no belt into the gate* — a deliberately
   striking visual that teaches the BJT-vs-FET distinction at a glance.
6. **Tier + deps** — **Tier 2.** Needs **P3** + Newton. Slightly *easier* to
   converge than the BJT (no exponential), so a fine second device. Unlocks
   building logic gates from discretes.

### 3.3 JFET

1. **Teaches** — a **depletion-mode** voltage-controlled device: conducts at
   `Vgs = 0` and pinches *off* as the gate reverse-biases; the bridge between
   "always-on resistor-ish channel" and the enhancement MOSFET; classic for
   high-impedance analog front ends.
2. **Sim model** — **3 terminals**, Newton. Square-law like the MOSFET but
   **normally-on** with pinch-off at `Vp` (negative for N-JFET): `Id = Idss·(1 −
   Vgs/Vp)²` in saturation. Same stamp shape as the MOSFET; only the control
   convention flips. Params (P2): `Idss`, `Vp`. *Determinism note:* identical to
   the MOSFET's; reuse its limiter.
3. **Schematic** — the JFET symbol (channel line with a gate arrow in/out, no
   isolation bar). Restyle `drawMOSFET`.
4. **Factory** — a **spring-loaded sluice that defaults OPEN** and the gate paddle
   *pushes it closed* — the inverse motion of the MOSFET flood-gate, which makes
   depletion-vs-enhancement legible as a mechanism contrast.
5. **Reads as** — full drain→source belt at zero gate; the belt **thins as the
   gate node goes negative**, pinching to nothing at `Vp`.
6. **Tier + deps** — **Tier 2.5.** Needs **P3** + Newton; trivially after the
   MOSFET. Lower priority (less common in beginner curricula).

### 3.4 Darlington pair

1. **Teaches** — **cascaded gain** (`β ≈ β1·β2`): two BJTs stacked for huge
   current gain; and that you can *build a more capable building out of buildings*
   — the blueprint/black-box thesis of `game-factory-loop.md` §3 made physical.
2. **Sim model** — **not a new primitive at all**: it is two NPN models wired
   (E1→B2, collectors common). Ship it as either (a) a **blueprint/sub-assembly**
   of two BJT parts (preferred — it *demonstrates* the black-box mechanic), or
   (b) a convenience composite part that internally instantiates two junctions.
   *Determinism note:* none new; it's two BJTs, which already reproduce.
3. **Schematic** — two BJT symbols in the Darlington configuration inside a
   dashed boundary (the "this is a sub-assembly" convention from the blueprint
   system).
4. **Factory** — a **two-stage gain assembler**: the first valve's output belt is
   the second valve's control belt; a whisper of base current opens a flood. The
   dashed building outline signals "this is a packaged blueprint."
5. **Reads as** — an extremely **thin base belt** producing a very **fat collector
   belt** — the visual punchline of compounded gain.
6. **Tier + deps** — **Tier 2.5.** Needs the BJT (**P3**) + the **blueprint
   system** (from `game-factory-loop.md`). Great showcase of composition.

> **Zoo verdict.** The whole tier stands or falls on **P3 (multi-terminal) + the
> Newton loop we already have**. Implement **NPN BJT** first (keystone), then the
> **N-MOSFET** (gentler convergence, unlocks logic), then fill in PNP/P-MOSFET by
> symmetry, then JFET and the Darlington blueprint. The small-signal
> controlled-source variants (P4) are an optimization for black-boxed amplifiers,
> not the first cut.

---

## 4. Op-amp — the analog brain (controlled source or multi-terminal)

1. **Teaches** — the **ideal building block of analog design**: enormous gain,
   high input impedance, and the *virtual short* under feedback. Buffers,
   summers, comparators, active filters, the `V = A(V+ − V−)` mental model and
   the magic of negative feedback. This is the "analog combinator" — the assembler
   that *decides and amplifies*.
2. **Sim model** — **3 terminals exposed** (V+, V−, Vout; supply rails idealized
   at v1), nominally **linear** via a **VCVS (P4)**: `Vout = A·(V+ − V−)`, a
   controlled voltage source sensing the input node pair and driving the output
   node — clean extra branch constraints (`parts-roadmap.md` already calls this
   out). The **useful** version needs **output saturation** to the rails, which
   makes it mildly nonlinear (a clamp) — either a soft-clip handled in Newton, or
   a linear VCVS plus a rail-clamp pass. Params (P2): `A` (open-loop gain),
   `Vsat±`, optionally slew/GBW later. State: none for the ideal; a single-pole
   rolloff (one internal cap) is the natural fidelity upgrade. *Determinism note:*
   the linear VCVS is a fixed stamp (safe). The saturation clamp must be a smooth
   or fixed-threshold nonlinearity in Newton (no float-equality at the rail), or
   a deterministic post-clamp that re-solves — pick the in-loop soft-clip to keep
   it honest and bounded.
3. **Schematic** — the **triangle with + and − inputs** and the output at the
   apex. New `drawOPAMP` (a 3-pin glyph; reuses the 3-pin machinery from the BJT).
4. **Factory** — a **control-room / comparator tower**: two sensor lines come in
   (+ and −), a big needle-gauge on the building swings to the *difference*, and a
   powerful output belt is driven hard one way or the other (rail-to-rail) until
   feedback balances the needle at center (the virtual short — the needle resting
   at zero difference is the readable "it found equilibrium" moment).
5. **Reads as** — the **output belt height** is a huge multiple of the tiny
   input-node height *difference*; under feedback the two input nodes' heights
   **converge to equal** (virtual short) — a gorgeous, true visual of how feedback
   works, watchable with single-step time.
6. **Tier + deps** — **Tier 2.5.** Needs **P4 (controlled source)** + the
   **two-port placement UX** *or* the **P3 multi-terminal** path; plus the
   saturation nonlinearity. Pairs with the BJT tier. Excellent contract substrate
   ("build a unity buffer," "build a x10 non-inverting amp," "build a comparator
   with this threshold").

---

## 5. Relays & switches — stateful conduction (the latch/hysteresis tier)

`parts-roadmap.md` flags switches/relays as trivial *stamps* (closed = ~0 V
source / on-conductance; open = skip) but gated on **interactive, stateful UI +
topology invalidation (P6)**. The PWM switch (`ELEM_SWITCH = 6`) already proves
the *conductance-toggle* half; what's new is **who flips the toggle and when**,
and doing it deterministically.

### 5.1 Manual / toggle / push-button switch (vs the automatic PWM switch)

1. **Teaches** — **human-in-the-loop control** and the difference between a
   *clocked* switch (the existing PWM `SW`, an automaton) and a *commanded* one
   (you decide). The on/off primitive behind every UI, the SPST/SPDT idea, and
   debounce as a later wrinkle.
2. **Sim model** — 2-terminal, **linear**, reuses the switch conductance stamp
   (`SWITCH_RON` closed, `SWITCH_GOFF` open) — but the state is a **player-set
   boolean (P6)**, not `(tick % period)`. Closing/opening **rebuilds the netlist's
   active stamps** (a topology event). *Determinism note:* the boolean is part of
   the input stream, so a *recorded* session (player actions + ticks, per
   `game-design.md` grading) replays exactly; the state must be sampled on a
   defined tick and hashed (or treated as an input event at a tick). No float
   anywhere. This is the cleanest P6 part and the right one to pioneer the
   interaction+invalidation path with.
3. **Schematic** — the **open-lever SPST** (the existing `drawSW` lever, but
   *no clock* annotation; for SPDT, a lever choosing between two throws). Push-
   button = a momentary variant (a dome over two contacts).
4. **Factory** — the **existing door** (`drawFSW`), but with a **hand-crank /
   big red button** the player physically throws — vs the PWM switch's
   **auto-cycling turnstile**. The visual contrast (you turn this one; that one
   ticks itself) teaches the manual/automatic distinction.
5. **Reads as** — closed: full belt through, ~0 V across; open: dead (no chevrons)
   and the full node-difference stands across the gap (an "open belt goes
   nowhere," tying to `docs/ui/incomplete-circuits.md`).
6. **Tier + deps** — **Tier 1.5 (capability-gating for P6).** Needs the
   **interaction + netlist-invalidation** path. Highest-value P6 starter.

### 5.2 Relay (electromechanical)

1. **Teaches** — **a small signal switching a big, isolated circuit**: a coil's
   current pulls an armature that closes high-power contacts; galvanic
   **isolation** between control and load; the flyback-diode lesson (the coil is
   an inductor — opening it kicks). The electromechanical ancestor of the
   transistor switch.
2. **Sim model** — **4 terminals** (2 coil + 2 contact), and it is the archetypal
   **P6 hysteretic** part: the **coil is an `ELEM_INDUCTOR` (+ series R)**;
   the **contact is a switch stamp** whose boolean is driven by the **coil
   current** with a **pull-in / drop-out dead band** (`I_coil > I_pull` closes;
   `< I_drop` opens — hysteresis, never equality). The contact closing is a
   **topology event** committed on the tick grid from the solved coil current.
   State: armature boolean. *Determinism note:* the dead band + committing the
   boolean from the *committed* coil current in `step()` (exactly like reactive
   state) keeps it reproducible; the boolean **hashes**. The coil inductor also
   sets up the freewheel-diode teaching (open the coil without one and the kick
   is real and visible).
3. **Schematic** — a **coil rectangle** with a **dashed mechanical link** to a
   switch contact (the standard relay symbol). Composite glyph reusing `drawL` +
   `drawSW` with the dashed armature line.
4. **Factory** — an **electromagnet crane**: current through the coil energizes a
   magnet that **physically slams a heavy gate shut** on a *separate, isolated*
   belt line. You see the control district and the load district are **not
   wired together** — the crane bridges them mechanically. The armature **snaps**
   between positions at the pull-in/drop-out thresholds (a satisfying, discrete
   clunk — the hysteresis made tactile).
5. **Reads as** — two **electrically separate** belt systems (the isolation is
   visible: no shared net), linked only by the crane's motion; the coil belt's
   current crossing the pull-in mark is what triggers the load belt to come alive.
6. **Tier + deps** — **Tier 2.5.** Needs **P6** (hysteresis + topology event) and
   **P3-style 4-terminal** placement. The "drive a load through a relay and tame
   the coil kick with a flyback diode" contract is excellent.

---

## 6. Protection parts — fuses, varistors, thermistors (energy & thermal state)

These teach **failure and protection**, the test-bench's natural home
(`game-rewards.md` §6). They split by how much physics you want: a **threshold**
version (cheap, P6) or an honest **energy/thermal** version (P7).

### 6.1 Fuse

1. **Teaches** — **overcurrent protection**: a wire that conducts perfectly until
   too much current for too long flows through it, then **blows open
   permanently**; the I²t (energy-to-blow) concept; why protection is sized, not
   absolute.
2. **Sim model** — 2-terminal. **v1 (P6 threshold):** an `ELEM_RESISTOR` of tiny
   resistance whose state is intact/blown; blows when `|I| > I_rated` (optionally
   for N consecutive ticks to avoid transient nuisance trips); blown → open
   (topology event), **latched** until replaced. **v2 (P7 energy):** accumulate
   `∫I²·R·dt` and blow when it exceeds the I²t rating — a per-element energy scalar
   on the tick grid. State: intact/blown boolean (+ accumulated energy in v2).
   *Determinism note:* the boolean and the accumulator both **hash**; use a
   strict `>` with an integer dwell counter, never equality; the accumulator is a
   plain `f64` sum committed in `step()` (same discipline as `reactive_state`).
3. **Schematic** — the **rectangle with a line through it** (fuse), or the blown
   variant with a broken line once tripped.
4. **Factory** — a **breakable choke / sacrificial coupling**: a thin segment of
   belt-bridge that **glows hotter as current climbs** and, past its rating,
   **snaps with a spark** and stops the belt cold — a one-shot consequence the
   player must go replace. Pure test-bench drama, and true.
5. **Reads as** — a near-zero-drop conductor (full belt through) that **runs hot
   (energy shimmer) under high current** and, on blow, becomes a **dead open**
   (no chevrons, `--bad` break marker) — the "saturating → vents" belt state from
   `game-factory-loop.md` §1 made literal.
6. **Tier + deps** — **Tier 1.5** (threshold, **P6**) → **Tier 2** (I²t, **P7**).
   Pairs with every "protect this load" contract.

### 6.2 Varistor (MOV — metal-oxide varistor)

1. **Teaches** — **transient/surge clamping**: a bidirectional voltage-dependent
   resistor that's near-open at normal voltage and conducts hard above its clamp
   voltage; surge protection (the thing in every power strip). A *symmetric* Zener,
   essentially.
2. **Sim model** — 2-terminal, **Newton (P1)**: a **bidirectional power-law `i(v)
   = k·(v/Vc)^α·sign(v)`** with large α (a soft, symmetric knee at ±`Vc`). Pure
   static nonlinearity → the existing Newton loop with a custom `eval` + a
   knee-limiter. Params (P2): `Vc` (clamp), `α`. The *real* MOV degrades with
   absorbed joules (a P7 fidelity upgrade — it wears out). *Determinism note:*
   the power-law needs voltage limiting around ±`Vc` just like the Zener; same
   `vzlim`-style guard, bounded iteration.
3. **Schematic** — the **varistor symbol** (a resistor with a diagonal "U/Vc"
   arrow, or back-to-back-Zener depiction).
4. **Factory** — a **dual overflow weir** straddling the rail and ground: stays
   shut at normal level, but a surge that drives the rail **above OR below** the
   clamp marks opens spillways **both ways**, dumping the transient. The symmetric
   (both-directions) action is the readable difference from the Zener's one-way
   weir.
5. **Reads as** — invisible (open) at normal rail height; a **voltage spike gets
   clipped flat at ±`Vc`** as a big transient current belt briefly dumps through
   it — watchable by scrubbing the transient with time controls.
6. **Tier + deps** — **Tier 2.** Needs **P1 + P2** (same as Zener). The wear-out
   model is a **P7** upgrade. Good surge-protection contract.

### 6.3 Thermistor — NTC and PTC

1. **Teaches** — **temperature-dependent resistance** and self-heating:
   **NTC** (resistance falls as it warms — inrush limiting, temperature sensing)
   and **PTC** (resistance rises sharply past a trip temp — a *resettable* fuse /
   self-regulating heater). The first part whose behavior depends on its own
   *thermal* state, and the gateway between electrical power and a second physical
   domain.
2. **Sim model** — 2-terminal, **linear stamp but P7-stateful**: a resistor whose
   conductance is `1/R(T)` with `R(T)` an NTC (`R = R0·exp(B·(1/T − 1/T0))`) or PTC
   (steep rise past `Ttrip`) curve. **Temperature `T` is per-element P7 state**,
   evolving on the tick grid from self-heating (`P = I²R`) and a fixed thermal
   mass/ambient leak: `T += (I²R − k(T − Tamb))·dt/Cth`. Each step uses the
   **previous** committed `T` to set `R` (no inner iteration → stays linear).
   Params (P2): `R0`, `B`/`Ttrip`, thermal `Cth`, `k`. State: `T`.
   *Determinism note:* `T` is committed in `step()` from the solved current
   (exactly like a reactive companion) and **hashes**; using previous-tick `T`
   avoids a new Newton coupling. The thermal ODE is plain backward-Euler-able
   `f64`.
3. **Schematic** — the **resistor with a diagonal arrow + "T°"** (or the standard
   thermistor symbol; "−t°" for NTC, "+t°" for PTC).
4. **Factory** — a **throat whose width breathes with its own heat**: NTC = a
   choke that **widens as it warms** (inrush limiter: starts narrow/hot, opens up
   as current settles); PTC = a choke that **slams nearly shut when it overheats**
   (resettable fuse: trips, then *re-opens* as it cools — the difference from the
   one-shot fuse is that the building recovers). A heat gauge on the side shows `T`.
5. **Reads as** — its **belt-throat thickness drifts over time** as `T` changes —
   a slow, legible transient you can watch: the NTC's belt fattening after inrush,
   the PTC's belt choking off at trip and slowly reopening on cooldown.
6. **Tier + deps** — **Tier 2.5.** Needs **P7 (thermal state)**. The NTC
   inrush-limiter and PTC resettable-fuse are both clean contracts. *This is the
   keystone for the thermal domain* — once temperature is a hashed per-element
   scalar, diode/LED thermal derating and the I²t fuse all become reachable.

---

## 7. Light & display I/O — LED already covered; LDR and seven-segment

The **light channel (P8)** + the LED (§1.1) and photodiode (§1.4) establish
emit/receive. Two more parts complete the opto/display story.

### 7.1 LDR / photoresistor (photoconductive cell)

1. **Teaches** — **light → resistance**: a resistor whose value drops with
   incident light; the simplest light sensor, the classic "night-light"
   voltage-divider, and a gentle intro to sensors before the photodiode's
   junction physics.
2. **Sim model** — 2-terminal, **linear stamp, P7/P8-stateful**: a resistor with
   `R(lux)` (high in dark ~MΩ, low in light ~kΩ, a log-ish curve). The **lux is a
   P8 receive channel** (from a paired LED beacon, a scene light, or a contract
   stimulus); `R` uses the current lux to set conductance — a plain linear stamp,
   no Newton. Params (P2): `R_dark`, `R_light`, response curve. *Determinism
   note:* if lux is a scripted/contract input on the tick grid it **hashes** as
   input; the resistance is a pure function of it. No new solver machinery —
   it is the *easiest* light part and the right one to introduce P8 with.
3. **Schematic** — the **resistor inside a circle with two inward arrows** (the
   standard LDR symbol — light falling on a resistor).
4. **Factory** — a **light-metered throat**: a choke whose width is set by **how
   much light falls on its sensor window** — shine the scene/LED light on it and
   the belt **opens up**; shade it and it **chokes**. Pair it with an LED beacon
   for a visible opto-link (LED brightness → LDR opening → downstream belt).
5. **Reads as** — a resistor whose **throat thickness tracks the light channel**
   rather than being fixed; in a divider, the tapped node's **belt height swings
   with illumination** — a vivid, causal sensor demo.
6. **Tier + deps** — **Tier 2.** Needs **P8 (light channel)** + optionally **P7**
   if it self-references scene light. Lowest-effort entry point to the light tier;
   do it *before* the photodiode.

### 7.2 Seven-segment display

1. **Teaches** — **electrical → human-readable output**: seven (eight with the
   dot) independently-driven LEDs arranged as a numeral; current-limiting *per
   segment*; common-anode vs common-cathode wiring; and the bridge from analog
   drive to *displayed information* — the closest the analog world gets to
   "outputting a counted item" (`game-factory-loop.md` Tier 3).
2. **Sim model** — a **bundle of 7–8 LEDs** (§1.1) sharing a common pin; not a new
   primitive — it is the LED model ×8 with a shared anode/cathode node and a
   per-segment **emit channel (P8)** that the renderer reads to light segments.
   Each segment is the Newton LED. Params (P2): the LED params ×8 + wiring flag.
   State: none beyond the LEDs'. *Determinism note:* none new; it's 8 diodes,
   which reproduce. The **decoded digit is pure presentation** (read the 8 emit
   booleans → draw the glyph) and does not hash.
3. **Schematic** — the **8-segment numeral outline** with the common pin marked;
   each segment a tiny LED. New `draw7SEG` (a multi-pin display glyph — the first
   "output device" symbol).
4. **Factory** — a **signboard / marquee panel**: a building whose face is the
   numeral; each segment **lights when its drive belt flows**, so the player
   literally **wires up a number** and watches it form. Drive it from a counter/
   logic district and it becomes the factory's readout — the satisfying "my
   machine shows me a number" payoff.
5. **Reads as** — eight little LED loads, each lit by its segment current; the
   **assembled glyph is the high-level readout** sitting above the per-segment
   belts — a clean two-level read (belts below, meaning above), echoing the
   abstraction ladder of `game-factory-loop.md` §3.
6. **Tier + deps** — **Tier 2.** Needs the **LED (P2/P8)** and **multi-pin
   display glyphs**. Naturally a *driven* deliverable: "decode this nibble onto
   the display" (with a decoder) or "drive segment X at 10 mA."

---

## 8. Transformer — coupled inductors (its own small primitive)

1. **Teaches** — **magnetic coupling**: AC voltage/current transformation by turns
   ratio (`Vs/Vp = Ns/Np`), galvanic **isolation**, and impedance matching; the
   front end of every linear power supply and the partner to the AC source + diode
   rectifier the core already runs. (DC does not pass — a teaching feature.)
2. **Sim model** — **4 terminals** (primary pair + secondary pair). Two
   `ELEM_INDUCTOR` branches (`Lp`, `Ls`) **plus a mutual-inductance term `M = k·√(Lp·Ls)`**
   coupling their branch equations — **P5 (coupled inductors)**: extend the
   inductor's backward-Euler branch stamp with off-diagonal `M/dt` entries linking
   the two branch rows. Purely **linear** extra branch constraints — *no Newton*.
   Params (P2): `Lp`, `Ls` (or turns ratio `n` + magnetizing `Lm`), coupling `k`.
   State: the two branch currents (already how inductors carry state).
   *Determinism note:* it is linear backward-Euler like the inductor — the only
   new thing is symmetric off-diagonal stamps; fully reproducible, no iteration.
   Start with tightly-coupled (`k≈1`) ideal-ish; leakage inductance is the natural
   fidelity upgrade.
3. **Schematic** — **two coils with the core bars between them** (and dots for
   polarity). Composite of two `drawL`s with the core lines + polarity dots.
4. **Factory** — a **paired flywheel gearbox** (extends the inductor-as-flywheel
   metaphor): two flywheels on a common shaft with **different gear sizes** — the
   primary flywheel spins the secondary through the coupling, and the **size ratio
   sets the voltage/current trade** (small gear → big gear = step-up voltage,
   step-down current). The two sides are **mechanically linked but electrically
   isolated** (no shared belt) — isolation made visible, like the relay's crane.
5. **Reads as** — two **electrically separate** belt systems coupled only through
   the spinning core; on the secondary the **belt height scales by the turns
   ratio** and the **thickness scales inversely** (volts up ⇒ amps down — power
   conserved, visible as `Vp·Ip ≈ Vs·Is`). On DC: the core stops transferring (no
   change → no coupling) — the belt on the secondary goes dead, teaching "no DC
   through a transformer."
6. **Tier + deps** — **Tier 2.5.** Needs **P5 (mutual M)**. Independent of the
   transistor/Newton work — it can proceed in parallel on the *linear* track, which
   makes it a good parallel workstream. Contract: "step 12 VAC down to 5 VAC and
   rectify it."

---

## 9. Capability roadmap — parts grouped by the primitive they unlock

The catalog is really **eight new sim primitives**; each one, once built, unlocks
a *cluster* of parts at near-zero marginal cost. Build the primitives, harvest
the clusters.

| Primitive | What it adds to the core | Parts it unlocks | Engine cost |
| --- | --- | --- | --- |
| **P1 — piecewise/lookup nonlinearity** | a parameterized `i(v)` sibling to `diode_eval` + its `vzlim` limiter, inside the *existing* Newton loop | Zener, varistor (MOV), ideal-rectifier knees | **Low** — reuses all Newton machinery |
| **P2 — per-device params** | a small fixed-width param block per element across the protocol/UX (today `value` is one `f64`) | Schottky, LED, every real-cap/diode variant — *unblocks half the catalog* | **Low–med** — protocol + bin UX, no solver change |
| **P3 — multi-terminal (>2 nodes)** | `Element` and the stamp loop accept 3–4 node devices | **BJT, MOSFET, JFET, Darlington, op-amp, relay** — the entire active tier | **High** — the keystone engine lift |
| **P4 — controlled sources (VC/CC × VS/CS)** | linear two-port sense→drive stamps + two-port placement UX | ideal op-amp, small-signal transistor models | **Med** — math is clean; UX is the work (`parts-roadmap.md`) |
| **P5 — coupled inductors (mutual M)** | off-diagonal `M/dt` linking two inductor branches (linear) | **transformer** (and multi-winding) | **Med** — linear, parallelizable with P3 |
| **P6 — stateful/hysteretic latch** | a boolean the *solution* flips on a dead band, on the tick grid, hashed; + interaction/netlist-invalidation | **manual switch, relay armature, threshold fuse, comparator** | **Med** — needs the interaction path + determinism care |
| **P7 — thermal/light scalar state** | a per-element scalar (T or lux) evolving on the tick grid, hashed, modulating the device via previous-tick value | **thermistor (NTC/PTC), I²t fuse, MOV wear, photodiode, thermal derating** | **Med** — like a reactive companion, second domain |
| **P8 — light/display I/O channel** | an emit/receive scalar channel for presentation + contract grading | **LED brightness, LDR, photodiode, 7-segment** | **Low–med** — presentation + a receive hook |

Reading the table as dependency edges:

- **P2 is the unlock multiplier.** It's cheap and it turns the diode into the
  whole diode family and the cap into the cap family. Do it first.
- **P3 is the gate to the active tier** and the most expensive single item; once
  paid, the entire transistor zoo + op-amp + relay open up. **P1, P5, P6, P7, P8
  are all independent of P3** and can ship around it.
- **P4 vs P3 for the op-amp/transistors:** large-signal devices (P3+Newton) are
  the *honest* default; controlled sources (P4) are the *small-signal/black-box*
  optimization. P3 first.
- **P7 is the second physical domain** (heat/light) and the prerequisite for the
  *truthful* protection parts (energy-to-blow) and sensor parts.

---

## 10. Implementation sequence — cheap high-teaching wins first

An order that maximizes teaching-value-per-engine-effort and keeps each step
shippable behind the gates (`cargo test -p sim-core` green incl.
`run_is_reproducible`; coarse wasm boundary unchanged). Each phase is a coherent
release.

**Phase A — Harvest the Newton loop we already paid for (P2, then P1).**
1. **P2 per-device params** (the unlock multiplier).
2. **Schottky** + **LED** (P2 only — near-free; LED needs the P8 emit stub).
3. **Zener** + **MOV** (P1 reverse/symmetric knee + `vzlim`).
4. **Electrolytic (ESR)** + **ceramic-as-default** (P2 parasitics, linear).
   → *Ships:* the full diode family, real caps, the first emit channel — a large
   teaching jump with the **lowest** engine risk.

**Phase B — The light & manual-control layer (P8, P6, P7-lite).**
5. **Manual/toggle/push-button switch** (P6 — pioneer the interaction +
   netlist-invalidation path with the *simplest* hysteresis-free latch).
6. **LDR** (P8 receive — easiest light part) + wire the **LED→LDR opto-link**.
7. **Threshold fuse** (P6 latch) → then **I²t fuse** + **thermistor NTC/PTC**
   (introduce **P7** thermal scalar).
   → *Ships:* human control, sensors, protection, the thermal domain — all
   independent of the big multi-terminal lift.

**Phase C — The active tier (P3, the keystone).**
8. **NPN BJT** (the keystone — teaches multi-terminal + reuses Newton), then
   **PNP** by symmetry.
9. **N-MOSFET** (gentler convergence; unlocks discrete logic gates), then
   **P-MOSFET**, **JFET**.
10. **Op-amp** (P4 controlled source / saturation) + **Darlington** (BJT
    blueprint) + **relay** (P6 hysteresis on a coil current + 4-terminal).
    → *Ships:* amplifiers, switches, comparators, isolation — Tier-2 of the tech
    tree, the "real assemblers" of `game-factory-loop.md` §2.

**Phase D — Coupling & displays (parallelizable).**
11. **Transformer** (P5 — can run *in parallel* with Phase C on the linear track).
12. **Seven-segment** (LED ×8 + display glyphs) + **photodiode** (P7+P8) —
    completing the opto/display story.
    → *Ships:* power-supply front ends, readouts, full opto-isolation.

> The spine: **Phase A is almost pure reward for engine work already done.** Phase
> B opens two new domains (control, thermal/light) cheaply. Phase C is the one
> heavy lift, and it's the centerpiece of the game's tech tree. Phase D rides on
> A–C and can overlap.

---

## 11. Contract deliverables — the judgement parts

`game-factory-loop.md` §4 is emphatic that **contracts are a pull, not a gate**,
and `game-design.md` grades by *measured* outcomes on the deterministic replay.
The parts that make the best **Shapez-style deliverables** are the ones with a
crisp, gradable target the player must *judge* a value to hit. Ranked by how good
a contract they make:

- **LED at a current** — *"drive this LED at 20 mA ± 2 mA from a 5 V rail."*
  The canonical first design judgment (pick `Rs`); grade the committed LED
  current. **Best onboarding contract** (pairs with §5 of `game-factory-loop.md`).
- **Zener regulation** — *"hold this node at 5.1 V while the load swings 1–10 mA."*
  Grade node voltage across a stepped load; teaches shunt regulation and sizing
  the series resistor.
- **Decoupling spec** — *"keep this load's rail within 4% during the switch
  transient"* (electrolytic + ceramic). Grade the transient droop — *literally*
  the buffer-chest mechanic, scored.
- **Relay drive + flyback** — *"switch this load with the relay and keep the coil
  kick under X volts."* Grade the coil-node overshoot on turn-off; teaches the
  flyback diode. Judgement: include the diode and size it.
- **Transformer + rectify** — *"deliver 5 VDC from 12 VAC."* Grade output DC level
  and ripple; turns-ratio + rectifier + cap judgment.
- **Op-amp gain/buffer/comparator** — *"build a ×10 non-inverting amp"* / *"a unity
  buffer driving this load"* / *"a comparator tripping at 2.5 V."* Grade the
  output transfer; the analog-design judgment showcase.
- **Inrush limiting** — *"limit turn-on current into this big cap below X A"*
  (NTC). Grade the peak inrush current; teaches the thermistor's purpose.
- **Protection** — *"this load must survive a surge / not exceed its fuse rating."*
  Grade survival across a stress stimulus (MOV/fuse) — the test-bench framing
  (`game-rewards.md` §6) turned into a paid contract.
- **Seven-segment readout** — *"display this nibble"* (decoder + display). Grade
  the lit segments against the target glyph — the "make my machine show a number"
  deliverable.

Common thread: each hands the player a **judgement** (size this resistor, pick
this clamp voltage, choose this turns ratio, include this protection) and grades
a **measured** result on the honest replay — exactly the loop the design docs ask
for, with no special-case puzzle logic.

---

## 12. Open questions (hand-offs, not mine to settle)

- **Param block shape (P2).** How many `f64`s per element, fixed or tagged? This
  touches `sim-protocol` (wire types) and the value-picker UX
  (`docs/ui/value-picker.md`). A fixed small array keeps the wasm boundary coarse.
- **Multi-terminal placement UX (P3/P4).** The board model is two-pin today; 3–4
  pin parts and two-port sense/drive need a placement story
  (`parts-roadmap.md` already flags this for controlled sources). Pure UX, but
  it gates the whole active tier.
- **Where the light/thermal scalars come from (P7/P8).** Contract stimulus? A
  scene ambient? A paired emitter's output? Determinism is fine either way *if*
  the scalar is on the tick grid and hashed; the **source** is a design choice
  (and an economy question for graded contracts).
- **Golden regeneration policy.** Any new device that a representative golden
  netlist exercises will change the pinned hash — each phase that touches the
  golden must regenerate it with `print_golden` and justify it in the PR, per
  `docs/determinism.md` and golden rule #1.

---

### The bet, in one line

**Pay for the eight primitives in cheap-first order — harvest the diode and cap
families off the Newton loop you already built, open the control/thermal/light
domains for almost nothing, then make the one big multi-terminal investment that
unlocks the entire transistor zoo — and every part stays honest physics the
solver actually integrates, so the belts keep not lying and every deliverable is
a real engineering judgement the replay can grade.**

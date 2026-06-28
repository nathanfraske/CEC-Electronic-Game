<!-- SPDX-License-Identifier: Apache-2.0 -->

# The DOOM circuit: run DOOM on a machine built from sand

**Status:** Vision / north-star. Captures the owner's "run DOOM in the sim" goal and
everything discussed about it so far. Not a build plan — it sits *above* the concrete
subsystem designs (memory, I/O, CPU) and says what they're all aiming at. The first
buildable rung (cheap behavioral memory) is being designed in
[`memory-characterization-design.md`](./memory-characterization-design.md); the CPU
side leans on [`cpu-build-kit.md`](./cpu-build-kit.md) and
[`memory-and-assembly-plan.md`](./memory-and-assembly-plan.md).

---

## 1. The vision — and why it's the sell

Let a player **run DOOM inside the sim, on a computer they assembled from sand.**

The hook is **not** "DOOM runs" — emulators do that. The hook is the **unbroken zoom
ladder**:

> DOOM playing on screen → zoom out: it's a framebuffer living in a **RAM array you
> built** → zoom into the RAM: it's your **6T SRAM cells** → zoom into one cell: it's
> **transistors actually switching** → zoom into one: **doped silicon**.

"This sandbox is so real you can run DOOM on a computer you built from sand — and
inspect every electron of it." Nobody else can show that ladder unbroken. That single
continuous zoom — from a triple-A game frame down to one switching transistor — is the
marketing shot, the teaching payoff, and the reason the whole project exists, in one
gesture.

## 2. The honest architecture

You **cannot** simulate DOOM electron-by-electron — that's ~hundreds of millions of
devices switching at GHz, against a fixed ~2 µs sim step. Nobody does this, not even
SPICE. The honest, achievable version uses the game's existing move —
**characterize-to-collapse + zoom-to-truth** — at every tier:

- The **CPU** is characterized to a **behavioral instruction-executor** (a whole-CPU
  fast model, the same idea as gate → LUT, just at the top tier) that runs **real
  compiled DOOM machine code**.
- That code reads/writes a **behavioral RAM array** (the memory-characterization work).
- **Memory-mapped I/O** is the unifying bridge: every peripheral — keyboard, mouse,
  the display — is just a **memory address**.

It is not electrons-per-pixel. It **is** "a real binary, on a machine of your
construction, where every layer is real and one zoom away from the truth." That's not
cheating (see §8) — it's the only honest way, and it's the more impressive claim.

## 3. The full inspectable loop (input → compute → photons)

The complete demo is the **whole machine**, every rung openable:

```
  keyswitch / mouse                 CPU (behavioral)            display
  ─────────────────                 ────────────────            ───────
  key press → matrix scan ┐                                  ┌→ framebuffer (RAM region)
  → decode + debounce     ├→ MMIO input register → CPU ⇄ RAM ┤   → color map (palette/direct)
  mouse → quadrature dec. ┘        (runs DOOM code)          └→ RGB-LED array → light
```

Zoom in **anywhere** along that chain and you hit real circuit. That's the difference
between "DOOM in an emulator" and "you built the entire machine, input to photons."

## 4. Memory — the foundational rung

The core reframe (full detail in
[`memory-characterization-design.md`](./memory-characterization-design.md)):
**you don't simulate the array — you characterize one bit cell + the sense path once,
then bake it into a behavioral memory element whose size is just a parameter** →
cost is **O(accesses), not O(bits)**. A 4 MB array sims as fast as 16 bytes.

The player still **hand-builds the address decoder, control, and sense path as real
logic** (that's the lesson); only the physically-impossible part — millions of storage
cells — collapses to the behavioral core. The owner's **6T SRAM cell is the SRAM
reference cell**; a **1T1C cell** is the DRAM one (with its destructive-read +
leakage/refresh behavior — "refresh or your data rots" is a real, teachable failure).

**Memory is also the I/O bus.** The framebuffer and the palette are memory regions; the
keyboard/mouse registers are memory addresses. So the same primitive powers compute
*and* I/O — it's the keystone of the whole demo.

## 5. Input subsystem (real, and great teaching circuits)

Memory-mapped, so each decoder just writes a register the CPU polls:

- **Keyboard** = a switch **matrix** → scan/decode (drive a row, read columns,
  **debounce**, **encode** to a key code) → write the code to an **MMIO input
  register**. The matrix scan is a self-contained, satisfying lesson.
- **Mouse** = a **quadrature decoder** (two phase-shifted pulse trains → count up/down
  → X/Y deltas) → MMIO delta registers. Also real and hand-buildable.
- Zoom ladder extends *down* past the register: register → decoder logic → the matrix →
  an actual keyswitch closing. A keypress traceable to the electron.

## 6. Display subsystem (and a real purpose for LEDs)

The display is a **memory-mapped framebuffer** read out to an **RGB-LED array**. This
gives LEDs a scalable job: today they're single indicators; here you *build a screen*,
and "an LED is a diode with current through it" is verifiable at **any pixel**.

There are two distinct things people call a "shader" — keep them separate:

**(a) Color mapping as *circuit* (part of the machine, zoomable).** Two authentic
choices:
- **Direct RGB** (simplest; the RGB-LED idea): each pixel's memory holds the channel
  values (RGB565 / RGB888); the RGB LED reads R/G/B straight from the framebuffer. No
  lookup.
- **Palette / indexed** (the *authentic DOOM* path — DOOM is 8-bit palettized): the
  framebuffer stores **1 byte = a palette index**; a 256-entry **palette (CLUT)** maps
  index → RGB; the display does `rgb = palette[ framebuffer[px] ]` → drive the RGB LED.
  That lookup *is* "the shader," but it's **real hardware** (a tiny color-lookup memory
  + a DAC per channel — the old **RAMDAC**), not a GPU program. The palette is **just
  another small memory block** (256×3 B), so it reuses the memory primitive. Bonus
  lesson: **palette animation** (DOOM's red "ouch" flash is literally swapping the
  palette).

→ No GPU shader is required for the circuit. The "value → color" step is a passthrough
(direct RGB) or a memory lookup (palette) — both buildable, both zoomable.

**(b) Color mapping as *rendering* (how the sim draws the panel on your screen).** This
is the **only** place a literal shader appears, and it's pure perf, invisible to the
simulated machine: a 320×200 display is **64,000 pixels**, so the LED-array widget
**uploads the framebuffer (run through the palette) as a texture** and lets the GPU blit
it — no 64k draw calls. Then **zoom-to-open** applies: far = the "screen" (texture);
**zoom in** and the handful of on-screen pixels become **real RGB LEDs** (three diodes,
three drive currents, real photons). Far = texture, near = real LEDs — same LoD trick as
everything else.

**The RGB LED** is honest: it *is* three diodes (R/G/B) in one package, each with its own
channel/current. One pixel = one RGB LED. Brightness = channel value → render intensity
(skip per-pixel PWM for the display — clean value→brightness; PWM is its own lesson).

## 7. The CPU — the real wall

Memory is the *easy* part once behavioral; any size is cheap. The wall is the **CPU
executing tens of millions of instructions per fixed-DT frame**. The fixed ~2 µs step
can't be clocked at GHz, so a transistor- or even gate-level CPU can't run DOOM in real
time. To actually run it you **behavioralize the whole machine** — a whole-CPU fast
model — at which point you've built an **emulator** of a machine you assembled.

That's the honest boundary, and it's fine: the value is that you **built it up the
ladder and can open any layer to real circuit**, not that electrons are moving at the
top tier. This is the same trade the game already makes for a characterized gate.

## 8. Why this isn't cheating

It's the exact philosophy the game already runs on: **the running model is collapsed and
affordable; the truth is always one zoom away.** A characterized NAND runs as a LUT but
opens to transistors; a RAM array runs as a state vector but opens to 6T cells; the CPU
runs as an executor but opens to its datapath, ALU, registers — down to silicon. DOOM is
just the **capstone that exercises the entire ladder at once**, end to end, input to
photons. Every rung is real; you simply don't pay for all of them simultaneously.

## 9. Roadmap (subsystems & milestones)

Ordered by dependency; each is its own design pass.

1. **Memory characterization → `ELEM_MEMORY`** *(in design now — the running panel →
   `memory-characterization-design.md`; backlog #47).* Cheap, deterministic, faithful
   behavioral memory. Unblocks everything else. **Build data-layer-first, like the
   Cable.**
2. **I/O & display subsystem** *(next design pass).* Memory-mapped I/O bridge; keyboard
   matrix + mouse quadrature decoders; framebuffer; palette/CLUT; the **RGB-LED array
   display** (texture-far / real-LED-near). Decisions banked: palette vs direct-RGB;
   the far/near LoD; resolution.
3. **CPU behavioral collapse** *(the big one; builds on `cpu-build-kit.md`,
   `memory-and-assembly-plan.md`, the assembler/ISA #44).* Whole-CPU fast model running
   real machine code against `ELEM_MEMORY`.
4. **DOOM integration** *(capstone).* Real DOOM binary on the built machine;
   memory-mapped framebuffer + input; the zoom-ladder demo / trailer shot.

Intermediate, shippable wins along the way (each a "sell" in miniature): a memory-mapped
LED display showing a hand-written pattern → a tiny CPU running a hand-assembled program
that animates the LEDs → keyboard input echoed to the display → a simple game (Pong,
Snake) → DOOM.

## 10. Open questions & banked decisions

- **Color:** palette/indexed (authentic DOOM, reuses memory) vs direct-RGB (simplest).
  Likely **support both**; default direct-RGB, palette as the "authentic" upgrade.
- **Display render:** texture-blit far, real RGB-LEDs near (agreed direction).
- **Resolution:** DOOM is 320×200; a smaller "console" (e.g. 64×64 or 128×128) is the
  natural first milestone before full DOOM res.
- **CPU/ISA:** which architecture the behavioral CPU targets, and how the collapse is
  authored/validated (the hardest open question).
- **PWM vs direct brightness** for the display (direct for now).

## 11. Related docs & backlog

- [`memory-characterization-design.md`](./memory-characterization-design.md) — the
  memory rung (in design).
- [`cpu-build-kit.md`](./cpu-build-kit.md),
  [`memory-and-assembly-plan.md`](./memory-and-assembly-plan.md) — CPU + assembly.
- `CLAUDE.md` — convenience-primitive → reference-design-chip pattern; the planned
  `ELEM_MEMORY`; determinism rules.
- Backlog: #47 (RAM/ROM behavioral primitive), #43 (CPU build-kit), #44 (assembler/ISA),
  #41 (sand-to-CPU curriculum).

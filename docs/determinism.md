# Determinism and replay contract

The core must be deterministic so that pausing, single stepping, rewinding, and
grading all work from one design.

Rules:

- Fixed integration step. The step size sets fidelity and is bounded below by
  the fastest dynamics in the circuit. The presentation speed is a separate
  knob and never changes the step.
- Fixed evaluation and solve order. No reliance on iteration order of hashed
  collections, and no nondeterministic floating point reductions.
- Bounded, deterministic nonlinear solve. Netlists with a nonlinear element
  (e.g. a diode) are resolved by a Newton–Raphson outer loop inside each fixed
  step: every iteration linearizes each device about the previous iterate, stamps
  the companion in the fixed element order, and solves the same dense MNA system.
  The iteration *count* is data-dependent, but each iteration is itself
  deterministic and the count is hard-capped (settling to the last iterate on
  non-convergence), so a given netlist still reproduces bit-for-bit. Convergence
  is tested against fixed absolute and relative tolerances on both the
  node-voltage update and the device-current residual. Robustness aids
  (pn-junction voltage limiting, a small `gmin`) use fixed constants. A netlist
  with no nonlinear element keeps the original single-pass linear solve unchanged.
- Stable hashing only. Never use the standard library default hasher for a
  value that must reproduce across machines or compiler versions. The core
  uses FNV-1a over the snapshot bytes.
- Reverse is rewind, never backward integration. A dissipative circuit run
  backward is unstable. Store sparse keyframes and re-simulate forward to land
  on an earlier tick.
- WebAssembly pins IEEE float semantics across machines, which is what lets a
  golden recorded on one machine reproduce on another.

A challenge is verified by stepping the simulation and sampling measurements
under stated conditions. A graded solution is a reproducible stream of player
actions and ticks. If a change alters behavior, regenerate the golden as a
deliberate, reviewed act.

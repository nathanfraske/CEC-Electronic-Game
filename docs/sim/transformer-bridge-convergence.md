<!-- SPDX-License-Identifier: Apache-2.0 -->

# Transformer-into-diode-bridge: the floating-secondary operating-point failure

Research note for the deterministic MNA / backward-Euler / Newton-Raphson core
(`crates/sim-core/src/lib.rs`). It explains **why a coupled-inductor transformer
secondary feeding a full-bridge rectifier degenerates to half-wave with an
impossible current spike**, surveys the established cures with their math and
determinism trade-offs, and ends with a single concrete, sized, bit-reproducible
fix recommendation. **No code is changed by this note.**

> **⚠ Status (2026-06-16): §0–§5 are the original research note; its lead
> recommendation (§4, a secondary→ground reference resistor) was empirically
> falsified — see §6 — and the implemented fix is in §7.** Read §6 and §7 first;
> §0–§5 are kept verbatim as the investigation record. The shipped fix is the
> ideal-T model with a *hard* secondary differential (no series resistance, no
> common-mode reference resistor).

> TL;DR (original) — The bridge and the floating-node handling are not the bug. The bug is
> that the transformer's **secondary common-mode voltage is unconstrained**:
> its only DC tie to ground is `GMIN = 1e-12` S per node (`lib.rs:856`,
> `lib.rs:3240`), which is *symmetric* and therefore lets the off-diodes'
> equally-symmetric reverse leakage pin the secondary midpoint at ≈V(out)/2.
> The canonical SPICE fix is to **give the floating secondary a real DC path to
> ground** — a single resistor from one secondary node (or a synthetic
> center-tap) to ground, sized between the diode on-resistance and the load.
> This is a fixed conductance stamp: fully deterministic, bounded-iteration,
> bit-reproducible.

---

## 0. What the code does today (the facts the fix must respect)

Relevant constants and stamps (file `crates/sim-core/src/lib.rs`):

| Symbol | Value | Line | Meaning |
| --- | --- | --- | --- |
| `DT` | `2.0e-6` s | 242 | fixed step (500 kHz); backward-Euler `g = L/DT` |
| `GMIN` | `1.0e-12` S | 856 | node/junction floor conductance |
| `DIODE_IS` | `1.0e-12` A | 570 | diode saturation current |
| `DIODE_VT` | `0.025852` V | 574 | thermal voltage `Vt` |
| `NEWTON_MAX_ITERS` | `100` | 843 | hard iteration cap |
| `NEWTON_V_ABSTOL` | `1.0e-9` V | 845 | node-voltage abs tol |
| `NEWTON_RELTOL` | `1.0e-6` | 848 | relative tol |
| `NEWTON_I_ABSTOL` | `1.0e-12` A | 851 | current-residual abs tol |
| `TRANSFORMER_L1` | `0.5` H | 508 | primary self-inductance |
| `TRANSFORMER_K` | `0.999` | 514 | coupling `k` |
| `TRANSFORMER_RWIND` | `5.0` Ω | 524 | primary winding R (secondary `= n²·5`) |

- The transformer (`ELEM_TRANSFORMER`, type 18) is stamped as **two coupled
  inductors with backward-Euler companions** and two branch-current unknowns
  `Ip`, `Is`, coupled by `M = k·n·L1` (`stamp_transformer`, `lib.rs:3183`). The
  branch rows are the discretized `Vp = L1·dIp/dt + M·dIs/dt`,
  `Vs = M·dIp/dt + L2·dIs/dt`.
- **The only DC reference placed on each winding terminal is a single
  `GMIN`-to-ground on the diagonal** (`lib.rs:3240-3242`):
  `for t in [ia,ib,ic,id] { mat[t*dim+t] += GMIN; }`. There is **no** node→ground
  conductance large enough to define the secondary common-mode.
- Diodes are Newton companions `g = di/dv + GMIN`, `Ieq = i(v*) − g·v*`
  (`lib.rs:2258-2276`), with the textbook `pnjlim` limiter (`lib.rs:1033`) and
  `vcrit = Vt·ln(Vt/(√2·Is))` (`lib.rs:1021`). These are correct (see §3).
- The Newton loop (`newton_iterate`, `lib.rs:2235`) is capped at 100 iterations
  and, on non-convergence, **commits the last iterate** (`lib.rs:2716-2719`).
  Crucially `NEWTON_I_ABSTOL == GMIN == 1e-12`, so a current of order
  `GMIN·V` sits right at the convergence floor — a fact that matters in §1.4.

The whole pipeline is deterministic by construction (fixed element order, dense
solve, pure `f64`, FNV-1a snapshot hash). Any fix below is evaluated against
that contract.

---

## 1. Why this is a known-hard case, and the precise mechanism

### 1.1 An ideal source grounds the bridge's common-mode for free; a transformer does not

This is the whole story, and it is exactly consistent with the reported
observation that **swapping in an ideal floating AC source fixes it**.

A full bridge has two AC input nodes, call them `P` and `Q`. Decompose them into
a **differential** mode `vd = V(P) − V(Q)` (the useful signal the bridge
rectifies) and a **common** mode `vcm = ½(V(P)+V(Q))` (the average potential of
the secondary relative to ground). The bridge's diodes only ever respond to
*differences* of node voltages; the four diode equations and the load are
**invariant under a uniform shift of both `P` and `Q`**. So `vcm` is a genuine
**floating degree of freedom** that the bridge itself cannot pin — it must be set
by whatever DC ties `P`/`Q` to the ground reference.

- With an **ideal AC voltage source** that has one terminal grounded (or a
  source plus its `Rser`), the source's voltage constraint and that ground tie
  **fix `vcm` directly** (one node is literally held at a defined potential).
  The MNA system is non-singular in the common mode, Newton sees a well-defined
  operating point, all four diodes conduct symmetrically. This is why the
  "ideal floating source into the same bridge" works.
- With the **coupled-inductor transformer**, the secondary winding is a pure
  *differential* element: its two branch equations constrain only
  `V(c) − V(d)` (the winding voltage), never `vcm`. The primary's ground
  reference does **not** propagate to the secondary common mode, because a
  transformer transfers only the *differential* (winding) voltage — magnetic
  coupling carries `vd`, not `vcm`. So after the primary is grounded, **`vcm` on
  the secondary is still completely undetermined by every "real" element in the
  circuit.** The only thing left holding it is the `1e-12 S` GMIN floor plus the
  diodes' reverse leakage.

This is precisely the situation SPICE practitioners describe as *"SPICE does not
know how to deal with a voltage that is not referenced to ground"* and the
standard remedy — **"The secondary circuit needs a DC connection to ground. This
can be accomplished by adding a large resistor to ground or giving the primary
and secondary circuits a common node."** (Penn Engineering SPICE transformer
notes; the identical advice appears in LTspice user threads and the ngspice
documentation). It is also why the textbook coupled-inductor transformer is
known to be a *differential-only* model: Meares & Hymowitz (Intusoft, *SPICE
Models for Power Electronics*) and the Analog Devices / LTspice transformer
notes both stress that mutually-coupled inductors give no independent
common-mode / DC reference on an isolated winding.

### 1.2 The symmetric-leakage pinning: why it lands at exactly V(out)/2

Once `vcm` is (numerically) floating, what *does* set it? The reverse-biased
diodes and the GMIN floor — and they do so **symmetrically**, which is why the
midpoint sits at half the output.

Model each off-diode near its operating point as its companion conductance
`g_off = di/dv + GMIN`. For a reverse-biased junction `di/dv = (Is/Vt)·exp(vd/Vt)`
is vanishingly small, so `g_off ≈ GMIN = 1e-12 S`. In a bridge feeding a
capacitor charged to `Vout`, the two "upper" off-diodes connect each AC node to
the `+Vout` rail and the two "lower" off-diodes connect each AC node to ground
(0 V) — through four nearly **equal** leakage conductances `≈ GMIN`. Each AC
node therefore sees a balanced resistive divider from `+Vout` and from `0`:

```
            +Vout
              |
            g_up ≈ GMIN
              |
   node  ----●----  (its own GMIN-to-ground floor also pulls toward 0)
              |
            g_dn ≈ GMIN
              |
             GND (0V)
```

With `g_up ≈ g_dn`, the divider holds each floating AC node at
`vcm ≈ Vout · g_up/(g_up+g_dn) ≈ Vout/2`. **That is exactly the reported
symptom**: one terminal pinned at ≈V(out)/2, held there by symmetric
reverse-diode leakage. The differential winding voltage `vd` then rides on top of
this stuck common mode, so as the winding swings, **only the swing that crosses a
diode threshold on one side ever turns a diode on** — the other side stays clamped
near `Vout/2` and never reaches the opposite pair's turn-on. Result:
**two of four diodes conduct → half-wave / degenerate.**

The `GMIN`-to-ground on the secondary terminals (`lib.rs:3240`) does **not** save
this: it is itself symmetric (equal on `c` and `d`) and equal in magnitude to the
leakage, so it cannot break the tie — it only makes the matrix formally
non-singular (rank-complete) without making the common mode *physically
determinate*. A non-singular matrix with a near-null common-mode direction is
exactly the regime where the solution is dominated by round-off and by whichever
leakage term is infinitesimally larger.

### 1.3 Why lowering k and a damping resistor *across* the secondary both fail (as observed)

Both reported non-fixes are predicted by §1.1–1.2:

- **Lowering `k` (0.999 → 0.9)** changes the *differential* coupling/leakage of
  the transformer. It does nothing to `vcm`, because the coupled-inductor model
  has **no common-mode path at any `k`** — the secondary branch equations remain
  purely differential. So the pinning persists. (Lowering `k` is the cure for a
  *different* problem — a near-singular **inductance matrix**, §1.5 — not for the
  floating common mode.)
- **A damping resistor *across* the secondary** (`c`–`d`) is again a purely
  **differential** element: it loads `vd` but adds **zero** conductance from
  `vcm` to ground (a resistor between `c` and `d` contributes nothing to the
  common-mode row sum). It can damp *physical* ringing (the role snubbers
  actually play, §2.5) but cannot define the common-mode operating point — which
  is exactly why "a damping resistor across the secondary did NOT fix the
  spurious current." The fix must be a resistor **from a secondary node to
  ground**, not across the winding.

### 1.4 The "≈8 A KCL-inconsistent spike": a Newton/round-off artifact of the near-null common mode

The huge, KCL-violating current on the "active" diode is the signature of an
**ill-posed common-mode row solved by a direct factorization** plus the
limiter/iteration-cap interaction:

1. In the common-mode direction the Jacobian is `O(GMIN) = O(1e-12)`. The
   right-hand side in that direction (leakage mismatch, `Ieq` round-off from the
   companion `Ieq = i(v*) − g·v*`) is tiny but **nonzero and not commensurately
   small**. Solving `J·Δ = r` with `J ~ 1e-12` and `r` not `~1e-12` yields a
   **huge `Δ`** in node voltage / branch current — Gaussian elimination divides a
   finite residual by a `~1e-12` pivot. That is the 8 A: an
   `r/GMIN`-magnitude artifact, not a physical current.
2. `pnjlim` (`lib.rs:1033`) limits the *junction voltage step*, so it keeps the
   exponential from overflowing, but it does **not** bound the *current the
   companion injects* once a diode does cross threshold on the stuck-common-mode
   geometry; the device can be driven to an enormous bias on one edge.
3. The convergence test cannot reject it: `NEWTON_I_ABSTOL == GMIN == 1e-12`
   (`lib.rs:851,856`), so the current-residual gate is at the same scale as the
   leakage currents themselves; and the node-voltage gate `1e-9 + 1e-6·|V|`
   (`lib.rs:2683`) is *relative* at large `|V|`, so a wrong-but-stable large
   voltage can pass. With nothing forcing the common mode, Newton can "converge"
   (or hit the 100-iteration cap and commit the last iterate, `lib.rs:2716`)
   onto the degenerate operating point. KCL at the tap is then only satisfied to
   round-off, which is why the printed diode current is KCL-inconsistent with the
   ~mA load current.

In short: **the spike is what a direct solver does to a null/near-null direction**
(`Δ ≈ residual / 1e-12`), and the cure is to make that direction *not* near-null
— i.e. put a real conductance on the common mode (§4).

### 1.5 A *separate* hazard to keep distinct: the near-singular inductance matrix

There is a second, independent reason coupled-inductor transformers are called
hard, and it is worth naming so the fix is not aimed at the wrong target. The
2×2 inductance matrix

```
L = [ L1   M  ]      M = k·√(L1·L2),   det(L) = L1·L2·(1 − k²)
    [ M    L2 ]
```

becomes **singular as k → 1** (`det → 0`). At `k = 0.999`,
`1 − k² ≈ 2.0e-3`, so the matrix is well-conditioned-ish but the **mutual term
dominates**: `gm = M/DT` is almost as large as `g1, g2`. ngspice/LTspice warn
that `k = 1` *"must be avoided or instability will occur"* and that the
inductance matrix *"should be positive definite … even very small errors lead to
non-convergence"*; `k = 0.999` is explicitly called acceptable. **This is a real
issue but it is *not* the present bug** — it would manifest as differential
ill-conditioning / timestep problems, not as a stuck common mode, and the user
already found that `k = 0.9` does not help. Fixing the common mode (§4) is
orthogonal to and does not worsen the inductance-matrix conditioning. (If a
future symptom *is* matrix conditioning, the cure is the ideal-transformer +
magnetizing/leakage decomposition of §2.6, which removes the `1/(1−k²)` term
entirely.)

---

## 2. The established cures (math, sizing, determinism)

### 2.1 GMIN stepping (a homotopy on a node→ground conductance)

**What it is.** Add an artificial conductance `g_step` from **every node to
ground**, making the system diagonally dominant and the t=0 solution trivial
(all nodes shorted softly to 0). Then **relax `g_step` toward 0** in steps,
seeding each solve from the previous solution. Formally a homotopy
`H(x, λ) = F(x) + λ·G·x`, `G = I` (node-to-ground), swept `λ: λ_max → 0`. ngspice
exposes it as `.option gminsteps=N` (decade-spaced; `=0` disables it and falls
back to source stepping). SimetriX distinguishes **diagonal GMIN stepping**
("a large conductance … added to every diagonal entry … gradually reduced …
until it is zero") from **junction GMIN stepping** ("incrementally steps the
conductance across semiconductor junctions"). Default *floor* `GMIN = 1e-12 S` in
ngspice/SPICE3.

**Why it helps here.** During the high-`g_step` phases the secondary common mode
is *strongly* tied to ground, so the degenerate divider of §1.2 cannot form; the
solution is driven to the symmetric all-diodes state, and as `g_step` relaxes the
operating point tracks continuously to the true answer instead of falling into
the half-wave basin.

**Determinism.** Fully compatible: the schedule (start value, decade ratio, step
count) is **fixed data**, each sub-solve is the existing deterministic Newton
solve, and total iterations are bounded by `steps × NEWTON_MAX_ITERS`. Use a
fixed `gminsteps` (e.g. 10) and a fixed start (e.g. `1e-3 S`) → `λ` sequence
`1e-3, 1e-4, …, 1e-12`. No wall-clock, no hashing. **This is the determinism-safe
general robustness aid.** Its only cost is that it runs at install/`t=0` (the OP
solve), where the larger one-off system is already allowed (see
`solve_operating_point`'s comment, `lib.rs:1766`).

### 2.2 Source (supply) stepping / ramping

**What it is.** Multiply every independent source by a continuation parameter
`α` and sweep `α: 0 → 1`, seeding each solve from the last. At `α = 0` every
source is off and the solution is trivial; raising `α` walks the OP up to full
excitation. SPICE applies it automatically after GMIN stepping fails
(ngspice/PSpice). SimetriX: *"at the first step, the supplies might be ramped up
to 10 % of their maximum."*

**Relevance / limit here.** Source stepping helps *junction* turn-on basins, but
it does **not** by itself fix a floating common mode: at any `α`, the secondary
`vcm` is still unconstrained (scaling the primary source does not create a
common-mode path). So for *this* bug source stepping is a weaker tool than GMIN
stepping. Determinism: identical story to §2.1 — fixed `srcsteps`, bounded
iterations, reproducible.

### 2.3 The right magnitude/placement of GMIN on the floating nodes

This is the crux of the quantitative question. **`GMIN = 1e-12 S` is the correct
*floor for matrix non-singularity* but it is far too small to *define a floating
common mode against equal diode leakage*.** Two distinct jobs are being conflated:

- **Anti-singularity floor** (what 1e-12 is for): make every row have a nonzero
  diagonal so the factorization never divides by 0. 1e-12 is the SPICE3/ngspice
  default and is fine for *this* purpose.
- **Common-mode reference** (what is missing): a conductance from the floating
  secondary to ground that is **large compared with the off-diode leakage** so
  the divider of §1.2 is broken, yet **small compared with the load and the
  diode on-conductance** so it does not perturb the rectified output.

Because the competing leakage is itself `≈ GMIN`, any reference conductance must
beat it by a wide margin. The standard SPICE practice is *not* to raise the
global `GMIN` (which would falsify every reverse junction and leak the smoothing
cap), but to **place one explicit resistor from a secondary node to ground** of
size between the two bounds above. See §4 for the exact sizing.

### 2.4 pn-junction limiting (pnjlim) and step limiters — necessary but not sufficient

The code's `pnjlim` (`lib.rs:1033`) and `vcrit` (`lib.rs:1021`) are the
**canonical SPICE3/QUCS formulation**, verbatim:

- `V_CRIT = n·Vt·ln(n·Vt/(Is·√2))` (QUCS eq. 3.55; minimizes the curve radius of
  the exponential — the inflection past which Newton overshoots).
- When `vnew > vcrit` and `|vnew − vold| > 2·Vt`, switch from voltage-iteration
  to **current-iteration** via logarithmic damping
  `V^{m+1} = V^m + n·Vt·ln(1 + (V̂^{m+1} − V^m)/(n·Vt))` (QUCS eq. 3.47).

This is exactly what prevents `exp()` overflow and is essential. **But it limits
the junction *voltage step*, not the floating *common mode***, and it does not
bound the companion *current* injected once the geometry is degenerate (§1.4). So
pnjlim is necessary (keep it) and **not sufficient** for this bug. No stronger
limiter fixes a missing reference; it only changes how Newton wanders within the
degenerate manifold.

### 2.5 Snubbers (R–C across diodes / secondary): a physical/ringing role, not a DC-reference role

Snubber practice (Nexperia AN11160; diyAudio rectifier-snubber threads): an R–C
across a diode or the secondary damps the **parasitic LC ringing** at diode
reverse-recovery, with `R ≈ Z0 = √(L_leak/C_par)` (1–2× the characteristic
impedance) and `RC ≪ T_switch` (≈ 1/10 of the switching period). Its job is
**transient damping of real oscillation**, and in EMT/SPICE it also suppresses
numerical *chatter* after switch discontinuities. **It does not establish the DC
common-mode reference** (a series-R+C across `c`–`d` is differential and
DC-blocked by the cap), which is again why "a damping resistor across the
secondary did not fix the spurious current." Snubbers are complementary polish,
not the fix here.

### 2.6 Transformer model that *also* removes the near-singular matrix: ideal-T + magnetizing/leakage

The model-level alternative (Meares & Hymowitz / Intusoft; Analog Devices LTspice
notes) replaces the raw coupled pair with an **ideal transformer (turns ratio n)
+ explicit magnetizing inductance `Lm` across the primary + series leakage
inductances `Lk1, Lk2`** (the "T" / cantilever model). Benefits: (a) it exposes
`Lm`/`Lk` as real elements, (b) the ideal-transformer block can be implemented so
the secondary shares a node with (or is referenceable to) the primary, and
(c) it **eliminates the `1/(1−k²)` ill-conditioning** of §1.5 because there is no
near-singular 2×2 matrix to invert. Trade-off: it needs an ideal-transformer
primitive (a constrained 2-port: `Vs = n·Vp`, `Is = −Ip/n`) added to the element
set and OP/transient stamps — more work, and **by itself it still leaves the
secondary common-mode floating** unless the ideal block ties the windings to a
common reference. So §2.6 is the right *long-term* model but must be combined
with the common-mode reference of §4 to fix *this* symptom.

---

## 3. Determinism scorecard

| Cure | Determinism-safe? | Why / how to keep it bit-reproducible |
| --- | --- | --- |
| **Resistor secondary→ground (§4)** | **Yes (best)** | A fixed conductance stamp. No iteration, no schedule, no new failure mode. Identical to the existing resistor stamp. |
| GMIN stepping (§2.1) | Yes | Fixed start value + fixed decade ratio + fixed step count; each sub-solve is the existing deterministic Newton; total iters bounded. OP-time only. |
| Source stepping (§2.2) | Yes | Fixed `srcsteps`, bounded iters. (But weak against *this* bug.) |
| pnjlim / limiters (§2.4) | Already in, keep | Pure `f64`, fixed constants (`lib.rs:1033`). Necessary, not sufficient. |
| Snubber R–C (§2.5) | Yes | Just R and C elements (deterministic companions). Wrong target for the DC reference. |
| Raising global `GMIN` | **Discouraged** | Deterministic but *physically* wrong: leaks the smoothing cap and floors every reverse junction; changes all existing goldens. Don't. |
| Ideal-T model (§2.6) | Yes, but large | New constrained-2-port primitive + stamps; deterministic if stamped in fixed order. Long-term, not minimal. |

Everything that helps is compatible with the fixed-step / fixed-iteration-cap /
FNV-1a contract. The ranking by *minimality* puts the secondary→ground resistor
first.

---

## 4. Concrete recommendation (root cause + minimal sized fix)

### Root cause (single most likely)

**The transformer's secondary common-mode voltage has no DC reference to ground.**
The coupled-inductor model constrains only the *differential* winding voltage; the
primary ground does not propagate to the secondary common mode; and the only
secondary-to-ground tie in the code is the `1e-12 S` GMIN floor
(`lib.rs:3240`), which is symmetric and equal to the off-diode leakage, so the
bridge's reverse-leakage divider pins the secondary midpoint at ≈V(out)/2 (§1.2)
and the direct solver turns the resulting near-null common-mode direction into the
spurious ≈8 A spike (§1.4). An ideal floating source works because *it* supplies
the missing common-mode reference (§1.1).

### Cleanest minimal fix

**Add one explicit "common-mode reference" conductance from the secondary to
ground** — the textbook SPICE remedy *"add a large resistor to ground … on the
secondary"* (Penn Engineering; LTspice; ngspice). Two equally valid placements:

- **(A) Single-node tie:** a resistor `R_ref` from **one** secondary node
  (say `d`) to ground. Simplest; makes `vcm` determinate. Mild asymmetry
  (negligible if `R_ref` ≫ source impedance, which it is).
- **(B) Balanced center-tap tie (preferred for symmetry):** two equal resistors
  `2·R_ref` from `c`→ground and `d`→ground (a synthetic mid-point reference of
  effective `R_ref` to the common mode, zero differential loading at balance).
  This keeps the bridge perfectly symmetric and is the cleanest match to the
  physics of a center-tapped/earthed secondary.

In the existing architecture this is **one extra stamp inside
`stamp_transformer` / `stamp_transformer_op`** (where the `GMIN` floor already
lives, `lib.rs:3239-3242, 3276-3278`): replace/augment the secondary-terminal
floor with a *much larger, deliberately common-mode* conductance `G_ref = 1/R_ref`
to ground (option B: add `G_ref` to each of `c`,`d` diagonal; or as two
resistors). No new element type, no new unknowns, no solver change.

### How to size `R_ref` (the math)

`R_ref` must satisfy two inequalities:

1. **Beat the leakage** so it dominates the §1.2 divider and forces a single
   well-defined `vcm`:
   ```
   G_ref = 1/R_ref  ≫  g_leak ≈ GMIN = 1e-12 S
   ⇒ R_ref ≪ 1/GMIN = 1e12 Ω.
   ```
2. **Stay invisible to the rectifier** so it neither discharges the smoothing
   cap nor drops appreciable rectified output. Its leakage at full output must be
   « the load current:
   ```
   Vout / R_ref  ≪  Iload = Vout / R_load   ⇒   R_ref ≫ R_load.
   ```
   Equivalently, the conduction-path series impedance — winding `Rs = n²·5 Ω`
   (`lib.rs:3199`) plus diode on-resistance `r_d = Vt/Id` (e.g. ≈ 26 Ω at 1 mA,
   ≈ 2.6 Ω at 10 mA) — should be « `R_ref` so almost none of the rectified
   current detours through the reference.

A robust geometric-mean choice that satisfies both by a wide margin for typical
loads (`R_load` from ~10 Ω to ~100 kΩ):

```
R_ref ≈ 1e6 Ω  (G_ref = 1e-6 S)     [recommended default]
```

Check against the bounds: `1e-6 S` is **10^6× the 1e-12 leakage** (kills the
degenerate divider — bound 1 satisfied with 6 decades of margin) yet for, say,
`Vout = 7 V` it bleeds only `7 µA`, which is « a milliamp-to-amp load (bound 2
satisfied) and « the diode on-current. It is also 10^6× smaller than `1/GMIN`,
so it dominates GMIN while remaining an utterly negligible physical load. If the
intended loads are very light (`R_load` up to MΩ), raise `R_ref` to ~10–100 MΩ
(still ≫ leakage); if always heavy (`R_load` ≤ 100 Ω), `R_ref` = 100 kΩ is even
safer on bound 1. **The fix is insensitive across this whole range** — anything
in roughly `[1e4, 1e9] Ω` works, which is why a single fixed default is fine.

> Sanity identity: `R_ref` only needs to live in the window
> `R_load ≪ R_ref ≪ 1/GMIN`. With `GMIN = 1e-12`, the upper bound is `1e12 Ω`;
> with any sane load the lower bound is ≤ `1e5 Ω`. `1e6 Ω` sits comfortably in
> the middle for almost every game circuit.

### Belt-and-suspenders (optional, also deterministic)

Add **GMIN stepping at the OP solve** (§2.1) with a fixed schedule
(`start = 1e-3 S`, decade steps to `1e-12`, `steps = 10`). It costs only
install-time iterations, is bit-reproducible, and gives a globally robust basin
so that *any* future floating/stiff netlist (not just this transformer) finds the
symmetric operating point. The secondary→ground resistor remains the primary fix;
GMIN stepping is the general safety net. Keep `pnjlim` exactly as is.

### Expected correct output after the fix

With the common mode pinned, the bridge rectifies full-wave. Ignoring the small
winding `IR` drops (`Rp = 5 Ω`, `Rs = n²·5 Ω`) and the reference bleed (µA), the
smoothing cap charges toward the **secondary peak minus two diode drops** (two
diodes conduct in series each half-cycle):

```
Vout(peak)  ≈  V_secondary_peak − 2·V_diode_drop.
```

For the model's silicon diode (`Is = 1e-12 A`, `Vt = 0.025852 V`) at a forward
current `Id`, `V_diode_drop = Vt·ln(Id/Is + 1)` ≈ 0.6–0.75 V over the mA–A range,
so `2·V_diode_drop ≈ 1.2–1.5 V`. Example: a 12 V-peak secondary →
`Vout ≈ 12 − 1.4 ≈ 10.6 V`, with **all four diodes conducting in alternating
pairs** and each diode current equal to the actual load/charging current
(mA–A) — no 8 A artifact, KCL satisfied at every tap. The output ripple is then
the usual `ΔV ≈ Iload/(f·C)` of a capacitor-input filter.

---

## 5. One-paragraph "why the ideal source worked but the transformer didn't"

An ideal floating AC source with a grounded terminal **supplies the secondary's
common-mode reference itself** (one node is held at a defined potential), so the
bridge sees a non-singular, fully-determined operating point and rectifies
symmetrically. The coupled-inductor transformer is a **purely differential**
element: it transfers only the winding (differential) voltage and provides **no
common-mode path to ground at any `k`**, so after the primary is grounded the
secondary midpoint is left floating on nothing but `1e-12 S` of symmetric GMIN +
symmetric diode leakage — which pins it at V(out)/2 and collapses the bridge to
half-wave, with the direct solver manufacturing an `≈ residual/1e-12 ≈ 8 A` spike
in the unconstrained common-mode direction. Restoring what the ideal source gave
for free — **a real DC conductance from the secondary to ground, `R_ref ≈ 1 MΩ`,
sized `R_load ≪ R_ref ≪ 1/GMIN`** — fixes it deterministically with a single
extra stamp.

---

## Sources

- Penn Engineering, *Ideal Transformer SPICE Simulation* (coupled inductors;
  `K ≈ 0.99999`; **"The secondary circuit needs a DC connection to ground … add a
  large resistor to ground or give the primary and secondary a common node"**):
  <https://www.seas.upenn.edu/~jan/spice/spice.transformer.html>
- LTspice user threads on bridge-rectifier-shows-DC-at-secondary and floating
  transformers (floating secondary needs a ground reference; `Rser`):
  <https://groups.io/g/LTspice/topic/bridge_rectifier_simulation/105487350>,
  <https://www.electro-tech-online.com/threads/lt-spice-floating-transformer.153457/>,
  <https://forum.allaboutcircuits.com/threads/bridge-rectifier-ltspice.172888/>
- ngspice manual, DC solution options (GMIN default `1e-12`; `gminsteps`;
  source stepping; ITL1=100; RELTOL=1e-3; ABSTOL=1 pA; VNTOL=1 µV):
  <https://nmg.gitlab.io/ngspice-manual/analysesandoutputcontrol_batchmode/simulatorvariables__options/dcsolutionoptions.html>
- ngspice bug #335, mutual-inductance sanity check (inductance matrix must be
  positive-definite; tiny coefficient errors → non-convergence):
  <https://sourceforge.net/p/ngspice/bugs/335/>
- SimetriX, *DC Operating Point Algorithms* (diagonal GMIN stepping vs **junction
  GMIN stepping**; source stepping ramps supplies to ~10 %; pseudo-transient):
  <https://help.simetrix.co.uk/8.0/simetrix/mergedProjects/simulator_reference/topics/simref_convergence_accuracyandperformance_dcoperatingpointalgorithms.htm>
- QUCS technical notes, *Non-linear DC Analysis* (Vcrit eq. 3.55
  `n·Vt·ln(n·Vt/(Is·√2))`; pnjlim eq. 3.47 logarithmic damping; convergence
  eq. 3.30 `|ΔV| < ε_abs + ε_rel·|V|`; per-junction `gmin`):
  <https://qucs.sourceforge.net/tech/node16.html>
- arXiv 1904.04932, *Robust and Efficient Power Flow Convergence with G-min
  Stepping Homotopy* (G-min homotopy: large node→ground conductance shorts every
  node, then relaxed; trivial initial solution; continuation to the true OP):
  <https://arxiv.org/abs/1904.04932>
- Roychowdhury & Melville, *Delivering Global DC Convergence … via Homotopy*
  (GMIN stepping and source stepping as continuation/homotopy methods):
  <https://jaijeet.github.io/research/PDFs/2006-01-TCAD-Roychowdhury-Melville-MOS-homotopy.pdf>
- Meares & Hymowitz (Intusoft), *SPICE Models for Power Electronics* /
  *Solving SPICE Convergence Problems* (coupled-inductor vs ideal-T +
  magnetizing/leakage; GMIN/source stepping; floating-node references):
  <http://www.intusoft.com/articles/satcore.pdf>, <http://www.intusoft.com/articles/converg.pdf>
- Analog Devices, *Using Transformers in LTspice/SwitcherCAD III* (coupled
  inductors `L2 = n²·L1`; avoid `k = 1`; magnetizing/leakage modeling):
  <https://www.analog.com/en/technical-articles/using-transformers-in-ltspice-switcher-cadiii.html>
- Nexperia AN11160, *Designing RC snubbers* (`R ≈ Z0 = √(L/C)`, `RC ≪ T_switch`;
  damping parasitic ringing — the physical, not DC-reference, role):
  <https://assets.nexperia.com/documents/application-note/AN11160.pdf>
- IPST 2015/2003, numerical oscillations & backward-Euler vs trapezoidal at
  switching discontinuities (BE damps numerical oscillation; TRAP rings after a
  discontinuity): <https://www.ipstconf.org/papers/Proc_IPST2015/15IPST147.pdf>
- Background texts: Vlach & Singhal, *Computer Methods for Circuit Analysis and
  Design*; Pillage, Rohrer & Visweswariah, *Electronic Circuit and System
  Simulation Methods*; Najm, *Circuit Simulation* (MNA, companion models,
  Newton-Raphson, homotopy/continuation for the DC operating point).

---

## 6. VERIFICATION & CORRECTION (lead, 2026-06-15) — the §4 fix does NOT work

I empirically tested §4's recommendation against the live solver. **It does not fix
the bug, and the underlying diagnosis in §1.2/§4 is incorrect.** Recorded here so the
real fix isn't aimed at the wrong target.

### What the tests show (all via the wasm harness)
- **A resistor from a secondary node to ground does NOT help** — tested single-node
  ties at 1 kΩ / 100 kΩ / 1 MΩ **and** the balanced two-resistor center-tap at 1 MΩ.
  Every case stays half-wave (D_a = D_c = 0, the active diode still spikes ~8.6 A).
  A 1 kΩ tie is 1e9× the GMIN leakage — if §1.2's "balanced-leakage divider / near-null
  pivot" were the cause, 1 kΩ would have fixed it. It didn't.
- **The common-mode at V(out)/2 is CORRECT, not the bug.** Instrumenting the *working*
  case (ideal floating AC source + 20 Ω series) vs the *broken* transformer case:

  | case | V(out) | (in1+in2)/2 | in1 | in2 |
  | --- | --- | --- | --- | --- |
  | working (src) | 2.89 | **steady ≈ 1.44 = out/2** | swings [−0.63, 3.45] | swings [−0.64, 3.52] |
  | broken (transf.) | 5.03 | **swings [0.87, 4.12]** | **pinned 2.51 = out/2** | swings [−0.77, 5.70] |

  In the working bridge the common-mode self-stabilises at exactly V(out)/2 and **both**
  terminals swing symmetrically about it — so out/2 is the *right* operating point.
  Forcing the common-mode to ground (§4) would drive it to the **wrong** value and is
  why §4 fails. The bug is the inverse of §4's claim: **one terminal pins at out/2 while
  the common-mode swings**, instead of the common-mode sitting steady while both swing.

### The real root cause (verified)
The discriminator is **hard vs soft differential**, not the common-mode reference:
- A **voltage source** stamps `V(in1) − V(in2) = E` as a hard constraint row, independent
  of current. When the bridge clamps one terminal, the other is *forced* to `clamped ± E`,
  so both terminals always swing and all four diodes conduct. **Works at any series
  impedance** (verified full-wave from 0.001 Ω to 50 Ω series).
- The **coupled-inductor secondary** makes `V(in1) − V(in2)` depend on the free branch
  current `Is` (a *soft* Thévenin). Under the bridge's asymmetric load the winding voltage
  sags, the other terminal is never driven to its diodes' turn-on, and the system locks
  into the half-wave state with a runaway DC magnetising current (grows 8.5 A → 9.9 A over
  400 ms — a linear, non-saturating core has nothing to restrain it).

Also ruled out by test: lowering `k` (0.9), clamping the committed branch currents to ±1 A
(a crude core-saturation proxy), and a damping resistor across the secondary — **none** fix
the asymmetry.

### The correct fix
Make the secondary a **hard differential source** — i.e. the **ideal-transformer +
magnetising/leakage ("T") model of §2.6**, which §2.6 wrongly under-weighted as merely
"long-term." Stamp the secondary as a forced ratio `V_s = n·V_p` (a VCVS-style hard
constraint) in series with leakage inductance + winding R, with a CCCS reflecting the
secondary current to the primary (`Ip += n·Is`) and the magnetising inductance across the
primary. This reproduces the *working* voltage-source behaviour (hard differential) and, as
a bonus, removes the `1/(1−k²)` ill-conditioning of §1.5. It is a real model rewrite of
`stamp_transformer`/`stamp_transformer_op` (golden-regenerating), and must be verified to
the acceptance bar: all four diodes conduct in alternating pairs, `Vout ≈ Vsec_pk − 2·Vf`,
no spurious current spikes, no DC-current runaway. The single-resistor and GMIN-stepping
remedies of §2–§4 are **not** sufficient for this symptom.

---

## 7. IMPLEMENTED FIX (lead, 2026-06-16) — ideal-T with a *purely* hard secondary

The §6 fix is implemented and shipped. The model is now the ideal-T of §2.6, with two
refinements that the implementation forced and that are worth recording because they
contradict the earlier sizing advice.

### What was built (`stamp_transformer`, `stamp_transformer_op`)
Two branch unknowns per device: the magnetising current `Im` (a→b, the only reactive
state) and the secondary current `Is` (c→d, algebraic). With `g_mag = L1/DT`,
`rp = TRANSFORMER_RWIND`:
- **KCL** — primary draws `Im + n·Is` (a→b); secondary carries `Is` (c→d). The `n·Is`
  is the CCCS reflecting the secondary load back to the primary.
- **Magnetising row** — `V(a) − V(b) − (g_mag + rp)·Im = −g_mag·Im_prev` (a backward-
  Euler inductor companion with series primary winding resistance).
- **Secondary row (HARD differential)** — `V(c) − V(d) − n·g_mag·Im = −n·g_mag·Im_prev`,
  i.e. `V(c) − V(d) = n·V_Lm` where `V_Lm = g_mag·(Im − Im_prev)` is the backward-Euler
  voltage across the **magnetiser**.

The crucial subtlety is that the secondary EMF is forced to `n·V_Lm` (the magnetiser
voltage), **not** `n·(V(a) − V(b))` (the primary terminal voltage). That is what keeps
DC blocked: as a DC drive saturates `Im` against `rp`, `dIm/dt → 0`, `V_Lm → 0`, and the
secondary collapses — verified by `transformer_blocks_dc`. The primary current readout is
`Im + n·Is`.

### Refinement 1 — the secondary must carry **no** series resistance
The first cut put the reflected winding resistance `rs = n²·rp` in series on the secondary
row (`V(c) − V(d) = n·V_Lm − rs·Is`). It **ran away**: feeding the bridge, one terminal
pinned at −Vf (a clamp diode) while the other ramped to +100 V and `Is` climbed past 25 A,
monotonically. Mechanism — with a series `rs`, `V(c) − V(d)` *sags* with `Is` (a soft
Thévenin again), which lets the bridge latch the **wrong** diagonal (the pair opposing the
EMF polarity); in that state `Is = [n·V_Lm + Vcap + 2·Vf]/rs` **grows with the cap
voltage**, so charging the cap pumps more current, which charges the cap — positive
feedback. Setting `rs = 0` makes `V(c) − V(d)` a *hard* differential: the wrong-diagonal
state becomes algebraically impossible (forcing `V(c) − V(d) = +n·V_Lm` makes node c > node
d, which cannot coexist with the opposing pair conducting), exactly like the ideal voltage
source of §6. So the secondary winding resistance is dropped; `rp` on the primary side
still supplies the device's loss and the DC-blocking saturation. (A future "full" T-model
could restore secondary copper loss as a *series resistor on an internal node outside* the
ideal coupling, which does not soften the forced differential — deferred, not needed.)

### Refinement 2 — **no common-mode reference resistor is needed** (§4 was a red herring)
A floating differential source feeding the bridge does **not** need the §4 secondary→ground
resistor. The baseline test (a floating AC source — *zero* common-mode tie beyond the
`1e-12` GMIN floor — into the identical bridge + 100 µF + 1 kΩ) rectifies full-wave
perfectly: clean 10.4 V DC, all four diodes at 0.138 A, never exceeding 10.8 V. An interim
`1 MΩ` secondary→ground reference was tried and then **removed** after confirming the
hard-differential transformer is just as stable with the GMIN-only floor (diode currents
become *exactly* symmetric, D1 = D4, D2 = D3). Removing it preserves the transformer's
galvanic isolation. So §1.2's "balanced-leakage divider pins the common mode" was never the
operative failure for a hard source — it only bit the soft coupled-inductor model.

### Acceptance (regression `transformer_bridge_rectifies_full_wave`)
A 12 V-peak (n = 1) secondary into a 4-diode bridge + 100 µF + 1 kΩ now gives **Vout ≈
9.96–10.85 V** (`≈ Vsec_pk − 2·Vf`), ripple ≈ 0.9 V, **all four diodes conducting** in
alternating pairs (0.12 / 0.155 A), primary current bounded ≈ 0.19 A — **no spike, no DC
runaway**. The test asserts each diode conducts, both secondary terminals swing a
comparable span (neither pinned), the output is a sane smoothed DC, and the primary current
stays bounded. `transformer_scales_ac_by_turns_ratio` now expects the ratio = `n` exactly
(the ideal coupling has no `k` factor; `TRANSFORMER_K` was removed). The analog-RC main
golden (`run_is_reproducible`) is untouched — it has no transformer.

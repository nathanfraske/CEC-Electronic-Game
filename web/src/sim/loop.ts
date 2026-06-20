// SPDX-License-Identifier: Apache-2.0
// Loads the WebAssembly core and runs the presentation loop. The boundary is
// crossed once per frame: step the simulation, then read one batched snapshot to
// render. A bounded history of snapshots backs the timeline scrubber, so the
// player can pause and step backward/forward one tick at a time. Do not call
// across the boundary per component or per message.

import init, { Simulation } from "../wasm/sim_wasm.js";

/**
 * Seconds of physical time per simulated tick — must match `DT` in
 * `crates/sim-core/src/lib.rs` (2 µs). Used to turn ticks into a wall-clock
 * reading and to drive playback at a chosen ticks-per-(real-)second.
 */
export const DT_SECONDS = 2e-6;

/** One batched read of the core, taken once per frame and handed to the view. */
export interface Snapshot {
  tick: bigint;
  snapshotHash: bigint;
  /** Node voltages (also the scope channels). */
  state: Float64Array;
  /** Per-element current, in set_netlist order. Present once the netlist is wired. */
  elementCurrents?: Float64Array;
  /** Per-element reactive branch current (a transformer's magnetising current / flux
   * proxy; an inductor's branch current; else 0), in set_netlist order. */
  reactiveCurrents?: Float64Array;
  /** Whole-sim FAIL state: an ideal part was driven past physical bounds this tick. */
  failed: boolean;
  /** Per-element FAIL mask, in set_netlist order (1 = that element hit the bound). */
  failedMask?: Uint8Array;
  /** Per-element AC measurements, flattened in set_netlist order: element `i` occupies
   * `[i*acFields .. (i+1)*acFields]` — Vrms, Irms, Vmean, Imean, Vamp, Iamp, Preal, PF,
   * |Z|, phase (V−I lag, rad), freq (Hz), valid. Measured over the last cycle from the
   * live waveforms; drives the shimmer/phasor high-frequency render. */
  acMeasurements?: Float64Array;
  /** Stride of `acMeasurements` (fields per element); pairs with it to slice per part. */
  acFields?: number;
}

export interface SimHandle {
  step(): void;
  snapshot(): Snapshot;
  protocolVersion(): number;
  /**
   * Install a netlist of ideal elements and reset to t=0.
   *
   * `a`/`b` are the two main terminals (drain/source for a MOSFET). `c` is the
   * optional **control** terminal — the gate of a three-terminal device (NMOS
   * type 11, PMOS type 12); it is ignored by every two-terminal element. `aux`
   * is the optional **second per-element scalar** — an AC source's peak amplitude
   * in volts (0 selects the default 5 V), ignored by every other element. Both
   * `c` and `aux` default to all-zero when omitted, so existing callers need not
   * pass them; they trail the wasm `a,b,c,values,aux` order precisely so those
   * callers stay source-compatible.
   */
  setNetlist(
    nodeCount: number,
    types: Uint8Array,
    a: Uint32Array,
    b: Uint32Array,
    values: Float64Array,
    c?: Uint32Array,
    aux?: Float64Array,
    d?: Uint32Array,
    /**
     * Optional per-device parameter block — `PARAM_STRIDE` (4) `f64`s per element, or
     * omitted/empty for all model defaults (identical behaviour to today). Lets the save
     * format carry per-device parameters (op-amp GBW now; MOSFET/BJT/diode params as wired).
     */
    params?: Float64Array,
    /**
     * Optional **fifth terminal** per element — a powered logic gate's GND pin (its VCC
     * rides on `d`). Omitted/empty means every fifth terminal is ground (the legacy
     * 4-terminal shape). Trails `params` so existing callers stay source-compatible.
     */
    e?: Uint32Array,
  ): boolean;
  /** Reset to t=0 keeping the installed netlist. */
  reset(): void;
  /**
   * Small-signal AC sweep (Bode data): for each frequency in `freqs` (Hz), the complex
   * node voltages from a frequency-domain solve, flattened `[re, im]` per non-ground node
   * — a block of `2·(nodeCount − 1)` per frequency, in input order. Frequency-domain, so
   * it reaches reactance/corner/resonance behaviour above the transient step's Nyquist
   * limit. On-demand (not per-frame); read-only, never mutates sim state.
   */
  acSweep(freqs: Float64Array, real: boolean): Float64Array;
  /**
   * Frequency-domain per-element AC measurements at one angular frequency — the analytic twin of
   * the per-frame `acMeasurements`, same stride. Used above the ~62.5 kHz time-domain measurement
   * ceiling so the board still shows current/phase at MHz. On-demand; read-only.
   */
  acElementMeasurements(omega: number, real: boolean): Float64Array;
}

export async function createSimulation(seed: number): Promise<SimHandle> {
  // init() loads and instantiates the .wasm module. Must be awaited once.
  await init();
  const sim = new Simulation(seed);
  return {
    step: () => sim.step(),
    snapshot: () => ({
      tick: sim.tick(),
      snapshotHash: sim.snapshot_hash(),
      state: sim.state(),
      elementCurrents: sim.element_currents(),
      reactiveCurrents: sim.reactive_currents(),
      failed: sim.failed(),
      failedMask: sim.failed_element_mask(),
      acMeasurements: sim.ac_measurements(),
      acFields: sim.ac_fields(),
    }),
    protocolVersion: () => sim.protocol_version(),
    setNetlist: (nodeCount, types, a, b, values, c, aux, d, params, e) => {
      // Default the control array `c` and the fourth terminal `d` to all-ground and
      // the aux scalars to all-zero when a caller omits them, then hand the wasm
      // boundary its native a,b,c,d,values,aux order. The core ignores c/d for
      // elements that don't use them and reads aux only for the AC source's
      // amplitude / a logic gate's function code (0 there = the default).
      const cc = c ?? new Uint32Array(types.length);
      const dd = d ?? new Uint32Array(types.length);
      const ax = aux ?? new Float64Array(types.length);
      // Route to the full boundary (`set_netlist_pe`) when either a param block or a
      // genuine fifth terminal is supplied; pass the missing one as empty (= all defaults
      // / all ground). `e` is only "genuine" when it is well-formed (one entry per
      // element) AND carries a non-ground GND pin: a gate whose GND is the common ground
      // (the usual case) leaves `e` all-zero and rides its VCC on `d`, so the ordinary
      // boundary already handles it. Requiring the exact length also fails safe — a
      // malformed `e` can never make the whole install reject (the circuit still runs).
      const hasParams = params != null && params.length > 0;
      const hasE =
        e != null && e.length === types.length && e.some((x) => x !== 0);
      if (hasParams || hasE) {
        const ee = hasE && e != null ? e : new Uint32Array(0);
        const pp = params ?? new Float64Array(0);
        return sim.set_netlist_pe(
          nodeCount,
          types,
          a,
          b,
          cc,
          dd,
          ee,
          values,
          ax,
          pp,
        );
      }
      return sim.set_netlist(nodeCount, types, a, b, cc, dd, values, ax);
    },
    reset: () => sim.reset(),
    acSweep: (freqs, real) => sim.ac_sweep(freqs, real),
    acElementMeasurements: (omega, real) =>
      sim.ac_element_measurements(omega, real),
  };
}

export interface PlaybackStatus {
  /** Index of the displayed frame within the retained history. */
  cursor: number;
  /** Index of the latest (live) frame. */
  live: number;
  /** Tick of the displayed frame. */
  tick: bigint;
  /** Tick of the latest (live) frame. */
  liveTick: bigint;
}

export interface PlaybackControls {
  /** Tear down the animation frame loop. */
  stop(): void;
  pause(): void;
  resume(): void;
  /** Flip running state; returns the new value. */
  toggle(): boolean;
  /** Advance one tick: replay forward through history, or simulate a new tick. */
  stepForward(): void;
  /** Move the cursor back one recorded tick (does not un-simulate). */
  stepBack(): void;
  /** Jump the cursor to a fraction [0,1] of the recorded history. */
  seekFraction(f: number): void;
  /** Set how many fixed ticks of sim time to advance per real second while running. */
  setTicksPerSecond(n: number): void;
  isRunning(): boolean;
  status(): PlaybackStatus;
  /** Rebuild the history from the sim's current state (after a netlist change). */
  resync(): void;
  /** Reset the simulation to t=0 and clear the timeline. */
  restart(): void;
}

export interface LoopOptions {
  running?: boolean;
  ticksPerSecond?: number;
  historyCap?: number;
}

/**
 * One stepped tick within a single render frame: its tick index and the node
 * voltages at that tick. The frame loop steps and rings every tick already; this
 * is the (downsampled) batch of those intermediate states, handed to the view so
 * the scope can chart at sub-frame resolution instead of aliasing at high tps.
 * No new wasm crossing — it carries snapshot data already read this frame.
 */
export interface SubFrameSample {
  tick: number;
  state: Float64Array;
}

/** Most ticks to simulate in one animation frame, so a long frame never stalls. */
const MAX_STEPS_PER_FRAME = 10000;

/**
 * A display-only snapshot blended `f`∈[0,1) of the way from `a` to `b` (node voltages
 * AND per-element currents). Lets playback GLIDE between the fixed sim steps instead
 * of snapping to each one — the difference between a smooth slow-mo and a once-a-step
 * jump at low rates. Tick / hash / FAIL carry from `b` (the later, real tick); the
 * blended electrical values are presentation only and never re-enter the sim. Cheap:
 * the node + element arrays are a few tens of floats.
 */
function lerpSnapshot(a: Snapshot, b: Snapshot, f: number): Snapshot {
  const n = b.state.length;
  const state = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const av = a.state[i] ?? 0;
    state[i] = av + ((b.state[i] ?? av) - av) * f;
  }
  // Blend a per-element array (element currents / reactive currents) when both
  // sides line up; otherwise pass `b` through unchanged.
  const blend = (
    av0: Float64Array | undefined,
    bv0: Float64Array | undefined,
  ): Float64Array | undefined => {
    if (!av0 || !bv0 || av0.length !== bv0.length) return bv0;
    const out = new Float64Array(bv0.length);
    for (let i = 0; i < bv0.length; i++) {
      const av = av0[i] ?? 0;
      out[i] = av + ((bv0[i] ?? av) - av) * f;
    }
    return out;
  };
  return {
    tick: b.tick,
    snapshotHash: b.snapshotHash,
    state,
    elementCurrents: blend(a.elementCurrents, b.elementCurrents),
    reactiveCurrents: blend(a.reactiveCurrents, b.reactiveCurrents),
    // Carry the AC measurements through interpolation too — without this every
    // interpolated (running) frame dropped them, so the shimmer / RMS-colour
    // deactivated whenever the sim was running and only returned when paused or
    // reset. Blended like the currents; the field stride passes through.
    acMeasurements: blend(a.acMeasurements, b.acMeasurements),
    acFields: b.acFields,
    failed: b.failed,
    failedMask: b.failedMask,
  };
}

/**
 * Cap on samples reported per frame in the sub-frame batch. The frame may step
 * thousands of ticks (e.g. tps=500000 at 60fps ≈ 8333/frame); the batch is
 * deterministically downsampled to this many evenly-spaced ticks (always including
 * the latest) so the scope sees the AC waveform without aliasing while memory and
 * work stay bounded regardless of tps. Matches the scope's retained window so one
 * frame refreshes at most a full screen of samples — no more, no wasted copies.
 */
const SCOPE_BATCH_CAP = 240;

// Presentation speed is "how fast you watch": how many fixed ticks of sim time to
// advance per real second, driven by the real elapsed time between frames (so the
// rate is honest regardless of frame rate), separate from the fixed physical step.
export function runLoop(
  sim: SimHandle,
  onFrame: (snap: Snapshot, scopeBatch?: SubFrameSample[]) => void,
  opts: LoopOptions = {},
): PlaybackControls {
  let running = opts.running ?? false;
  let tps = Math.max(1, opts.ticksPerSecond ?? 500);
  let acc = 0; // fractional ticks carried between frames
  let lastTime = 0;
  let raf = 0;

  // History as a fixed-size circular buffer: O(1) push + evict, so the cap can be
  // large enough for the timeline to scrub all the way back to t=0 in a normal
  // session without the O(n) cost of shifting an array every tick.
  const cap = Math.max(2, opts.historyCap ?? 100000);
  const ring: Snapshot[] = new Array<Snapshot>(cap);
  let head = 0; // index of the oldest retained snapshot
  let count = 0; // number retained
  let cursor = 0; // displayed index within [0, count)

  const push = (s: Snapshot): void => {
    ring[(head + count) % cap] = s;
    if (count === cap) head = (head + 1) % cap;
    else count++;
  };
  const at = (i: number): Snapshot | undefined => ring[(head + i) % cap];
  const live = (): number => count - 1;
  const reset = (): void => {
    head = 0;
    count = 0;
    cursor = 0;
    push(sim.snapshot());
  };
  reset();

  const show = (): void => {
    const snap = at(cursor);
    if (snap) onFrame(snap);
  };

  // Evenly-spaced, in-order sub-frame samples over retained indices [lo, hi], at
  // most SCOPE_BATCH_CAP of them and always including hi (the latest). Deterministic
  // in the count of stepped ticks, so the batch stays bounded even at huge tps.
  const sampleSubFrame = (lo: number, hi: number): SubFrameSample[] => {
    const span = hi - lo; // number of intervals
    const total = span + 1; // ticks available in [lo, hi]
    const n = Math.min(SCOPE_BATCH_CAP, total);
    const out: SubFrameSample[] = [];
    let prev = -1;
    for (let k = 0; k < n; k++) {
      // Map k∈[0,n-1] across [lo,hi] so k=n-1 lands exactly on hi; round to a tick.
      const idx = n === 1 ? hi : lo + Math.round((k * span) / (n - 1));
      if (idx === prev) continue; // guard against a repeat from rounding
      prev = idx;
      const s = at(idx);
      if (s) out.push({ tick: Number(s.tick), state: s.state });
    }
    return out;
  };

  const frame = (): void => {
    const now = performance.now();
    const dt = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 0;
    lastTime = now;
    let scopeBatch: SubFrameSample[] | undefined;
    if (running) {
      acc += tps * dt;
      let steps = Math.floor(acc);
      acc -= steps;
      if (steps > MAX_STEPS_PER_FRAME) steps = MAX_STEPS_PER_FRAME;
      for (let i = 0; i < steps; i++) {
        sim.step();
        push(sim.snapshot());
      }
      cursor = live();
      // A FAIL — an ideal part driven past physical bounds — freezes the run so the
      // failure holds for inspection (the whole-sim FAIL state). Fix the circuit (add
      // impedance / a real part) and press Run again.
      if (at(cursor)?.failed) running = false;
      // Hand the scope every tick stepped this frame (downsampled to a bounded,
      // evenly-spaced set that always includes the latest) so AC charts cleanly at
      // any tps. Pure JS routing of snapshots already read — no extra wasm crossing.
      // The last `steps` retained items are exactly those ticks (eviction only ever
      // drops from the head, so the newest stay), giving the index range below.
      if (steps > 0) {
        scopeBatch = sampleSubFrame(Math.max(0, live() - steps + 1), live());
      }
    }
    // Display: while running, GLIDE between the two latest computed ticks by the
    // fractional accumulator `acc` so slow playback moves smoothly (≤1-tick lag)
    // instead of snapping once per discrete step. Pure presentation — the sim still
    // advances at the fixed step; this only interpolates what's drawn between steps.
    // At high tps the two ticks are ~one step apart so it's imperceptible; at 1 tps
    // it turns the once-a-second jump into a continuous slide. Paused/scrubbing shows
    // the exact snapshot (no blend).
    let disp = at(cursor);
    if (running && cursor >= 1 && acc > 1e-4) {
      const prev = at(cursor - 1);
      if (prev && disp) disp = lerpSnapshot(prev, disp, acc);
    }
    if (disp) onFrame(disp, scopeBatch);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    stop: () => cancelAnimationFrame(raf),
    pause: () => {
      running = false;
    },
    resume: () => {
      running = true;
      cursor = live();
    },
    toggle: () => {
      running = !running;
      if (running) cursor = live();
      return running;
    },
    stepForward: () => {
      running = false;
      if (cursor < live()) {
        cursor++;
      } else {
        sim.step();
        push(sim.snapshot());
        cursor = live();
      }
      show();
    },
    stepBack: () => {
      running = false;
      if (cursor > 0) cursor--;
      show();
    },
    seekFraction: (f: number) => {
      running = false;
      const clamped = Math.max(0, Math.min(1, f));
      cursor = Math.round(clamped * live());
      show();
    },
    setTicksPerSecond: (n: number) => {
      tps = Math.max(1, n);
    },
    isRunning: () => running,
    status: () => ({
      cursor,
      live: live(),
      tick: at(cursor)?.tick ?? 0n,
      liveTick: at(live())?.tick ?? 0n,
    }),
    resync: () => {
      reset();
    },
    restart: () => {
      sim.reset();
      acc = 0;
      lastTime = 0;
      reset();
    },
  };
}

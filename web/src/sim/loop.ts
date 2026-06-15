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
}

export interface SimHandle {
  step(): void;
  snapshot(): Snapshot;
  protocolVersion(): number;
  /** Install a netlist of ideal elements and reset to t=0. */
  setNetlist(
    nodeCount: number,
    types: Uint8Array,
    a: Uint32Array,
    b: Uint32Array,
    values: Float64Array,
  ): boolean;
  /** Reset to t=0 keeping the installed netlist. */
  reset(): void;
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
    }),
    protocolVersion: () => sim.protocol_version(),
    setNetlist: (nodeCount, types, a, b, values) =>
      sim.set_netlist(nodeCount, types, a, b, values),
    reset: () => sim.reset(),
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

/** Most ticks to simulate in one animation frame, so a long frame never stalls. */
const MAX_STEPS_PER_FRAME = 10000;

// Presentation speed is "how fast you watch": how many fixed ticks of sim time to
// advance per real second, driven by the real elapsed time between frames (so the
// rate is honest regardless of frame rate), separate from the fixed physical step.
export function runLoop(
  sim: SimHandle,
  onFrame: (snap: Snapshot) => void,
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

  const frame = (): void => {
    const now = performance.now();
    const dt = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 0;
    lastTime = now;
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
    }
    show();
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

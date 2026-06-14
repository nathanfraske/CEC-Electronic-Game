// SPDX-License-Identifier: Apache-2.0
// Loads the WebAssembly core and runs the presentation loop. The boundary is
// crossed once per frame: step the simulation, then read one batched snapshot to
// render. A bounded history of snapshots backs the timeline scrubber, so the
// player can pause and step backward/forward one tick at a time. Do not call
// across the boundary per component or per message.

import init, { Simulation } from "../wasm/sim_wasm.js";

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
  /** Set how many fixed ticks to advance per animation frame while running. */
  setTicksPerFrame(n: number): void;
  isRunning(): boolean;
  status(): PlaybackStatus;
  /** Rebuild the history from the sim's current state (after a netlist change). */
  resync(): void;
  /** Reset the simulation to t=0 and clear the timeline. */
  restart(): void;
}

export interface LoopOptions {
  running?: boolean;
  ticksPerFrame?: number;
  historyCap?: number;
}

// Presentation speed is "how fast you watch": how many fixed ticks of sim time
// to advance per animation frame, separate from the fixed physical step.
export function runLoop(
  sim: SimHandle,
  onFrame: (snap: Snapshot) => void,
  opts: LoopOptions = {},
): PlaybackControls {
  let running = opts.running ?? false;
  // Fractional ticks-per-frame: a value < 1 advances slowly (one tick every few
  // frames) via an accumulator, so "watch speed" can go well below 1.
  let tpf = Math.max(0.01, opts.ticksPerFrame ?? 0.25);
  let acc = 0;
  const cap = Math.max(2, opts.historyCap ?? 1200);
  let raf = 0;

  // History ring: index 0 is the oldest retained tick, last is the live tick.
  const history: Snapshot[] = [sim.snapshot()];
  let cursor = 0;

  const live = (): number => history.length - 1;

  const record = (): void => {
    history.push(sim.snapshot());
    if (history.length > cap) {
      history.shift();
      if (cursor > 0) cursor--;
    }
  };

  const show = (): void => {
    const snap = history[cursor];
    if (snap) onFrame(snap);
  };

  const frame = (): void => {
    if (running) {
      acc += tpf;
      let steps = Math.floor(acc);
      acc -= steps;
      if (steps > 256) steps = 256; // never freeze on a long frame
      for (let i = 0; i < steps; i++) {
        sim.step();
        record();
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
        record();
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
    setTicksPerFrame: (n: number) => {
      tpf = Math.max(0.01, n);
    },
    isRunning: () => running,
    status: () => ({
      cursor,
      live: live(),
      tick: history[cursor]?.tick ?? 0n,
      liveTick: history[live()]?.tick ?? 0n,
    }),
    resync: () => {
      history.length = 0;
      history.push(sim.snapshot());
      cursor = 0;
    },
    restart: () => {
      sim.reset();
      history.length = 0;
      history.push(sim.snapshot());
      cursor = 0;
      acc = 0;
    },
  };
}

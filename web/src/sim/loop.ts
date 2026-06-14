// SPDX-License-Identifier: Apache-2.0
// Loads the WebAssembly core and runs the presentation loop. The boundary is
// crossed once per frame: step the simulation, then read one batched snapshot
// to render. Do not call across the boundary per component or per message.

import init, { Simulation } from "../wasm/sim_wasm.js";

/** One batched read of the core, taken once per frame and handed to the view. */
export interface Snapshot {
  tick: bigint;
  snapshotHash: bigint;
  state: Float64Array;
}

export interface SimHandle {
  step(): void;
  snapshot(): Snapshot;
  protocolVersion(): number;
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
    }),
    protocolVersion: () => sim.protocol_version(),
  };
}

export interface LoopControls {
  /** Tear down the animation frame loop. */
  stop(): void;
  /** Freeze simulation time; the view keeps rendering the held snapshot. */
  pause(): void;
  /** Resume advancing simulation time. */
  resume(): void;
  /** Advance exactly one fixed tick while paused. */
  stepOnce(): void;
  /** Set how many fixed ticks to advance per animation frame. */
  setTicksPerFrame(n: number): void;
  isRunning(): boolean;
}

// Presentation speed: how many fixed ticks of simulation time to advance per
// animation frame. This is the "how fast you watch" knob, separate from the
// fixed physical step that sets fidelity inside the core.
export function runLoop(
  sim: SimHandle,
  onFrame: (snap: Snapshot) => void,
  ticksPerFrame = 1,
): LoopControls {
  let running = true;
  let tpf = Math.max(0, Math.floor(ticksPerFrame));
  let raf = 0;

  const frame = () => {
    if (running) {
      for (let i = 0; i < tpf; i++) sim.step();
    }
    // One batched snapshot read per frame, handed to the PixiJS renderer.
    onFrame(sim.snapshot());
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
    },
    stepOnce: () => {
      sim.step();
      onFrame(sim.snapshot());
    },
    setTicksPerFrame: (n: number) => {
      tpf = Math.max(0, Math.floor(n));
    },
    isRunning: () => running,
  };
}

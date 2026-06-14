<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { onMount } from "svelte";
  import { Application } from "pixi.js";
  import {
    createSimulation,
    runLoop,
    type Snapshot,
    type LoopControls,
  } from "./sim/loop";
  import { Board } from "./lib/board";

  const SEED = 1337;
  const SPEEDS = [1, 4, 16, 64];

  // The component bin previews the tech-tree progression described in the
  // README: idealized Tier I parts give way to real parts that cost something.
  const PARTS = [
    {
      tag: "R",
      name: "Resistor",
      desc: "Ideal ohms, no tolerance",
      tier: "I",
      color: "var(--bronze)",
    },
    {
      tag: "C",
      name: "Capacitor",
      desc: "RC charge curves",
      tier: "I",
      color: "var(--cyan)",
    },
    {
      tag: "L",
      name: "Inductor",
      desc: "Stored current, saturation",
      tier: "I",
      color: "var(--violet)",
    },
    {
      tag: "D",
      name: "Diode",
      desc: "One-way conduction",
      tier: "I",
      color: "var(--warn)",
    },
    {
      tag: "Q",
      name: "NPN Transistor",
      desc: "Gain, switching",
      tier: "II",
      color: "var(--accent)",
    },
    {
      tag: "&",
      name: "Logic Gate",
      desc: "Thresholds at the pin",
      tier: "II",
      color: "var(--ok)",
    },
    {
      tag: "FF",
      name: "D Flip-Flop",
      desc: "One bit of memory",
      tier: "II",
      color: "var(--cyan)",
    },
    {
      tag: "FP",
      name: "FPGA Fabric",
      desc: "Spatial, parallel logic",
      tier: "III",
      color: "var(--violet)",
    },
    {
      tag: "uC",
      name: "Microcontroller",
      desc: "Runs real firmware",
      tier: "III",
      color: "var(--accent)",
    },
  ];

  const CHANNELS = [
    { label: "RAIL A", color: "var(--accent)" },
    { label: "RAIL B", color: "var(--cyan)" },
    { label: "NODE C", color: "var(--violet)" },
    { label: "NODE D", color: "var(--ok)" },
  ];

  let frameEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;

  let tick = $state(0n);
  let hash = $state(0n);
  let proto = $state(0);
  let channels = $state<number[]>([0, 0, 0, 0]);
  let running = $state(true);
  let tpf = $state(1);
  let ready = $state(false);

  let controls: LoopControls | undefined;

  onMount(() => {
    let app: Application | undefined;
    let board: Board | undefined;
    let disposed = false;

    void (async () => {
      const a = new Application();
      // Render into the canvas Svelte owns, rather than appending a node, so
      // the Svelte runtime stays the single source of truth for the DOM.
      await a.init({
        canvas: canvasEl,
        resizeTo: frameEl,
        background: "#0d0b16",
        antialias: true,
      });
      if (disposed) {
        a.destroy({ removeView: false });
        return;
      }
      app = a;
      board = new Board(a);

      const sim = await createSimulation(SEED);
      proto = sim.protocolVersion();
      ready = true;

      controls = runLoop(
        sim,
        (snap: Snapshot) => {
          board?.update(snap);
          tick = snap.tick;
          hash = snap.snapshotHash;
          channels = Array.from(snap.state);
        },
        tpf,
      );
    })();

    return () => {
      disposed = true;
      controls?.stop();
      controls = undefined;
      app?.destroy({ removeView: false });
    };
  });

  function toggleRun(): void {
    if (!controls) return;
    if (running) controls.pause();
    else controls.resume();
    running = controls.isRunning();
  }

  function stepOnce(): void {
    if (!controls) return;
    controls.pause();
    running = false;
    controls.stepOnce();
  }

  function setSpeed(n: number): void {
    tpf = n;
    controls?.setTicksPerFrame(n);
  }

  const hex = (b: bigint): string => "0x" + b.toString(16).padStart(16, "0");
  const fmt = (v: number): string => (v >= 0 ? "+" : "") + v.toFixed(4);
  const barWidth = (v: number): number =>
    Math.max(2, Math.min(100, ((v + 1) / 2) * 100));
</script>

<div class="hud-header">
  <div class="brand">
    <span class="brand-mark">&#9670;</span>
    <span class="brand-text">
      Critical Error<span class="brand-sub">// Electronics</span>
    </span>
  </div>
  <div class="header-meta">
    <span class="chip">Protocol v{proto}</span>
    <span class="chip {ready ? 'chip-ok' : 'chip-warn'}">
      {ready ? "Core Online" : "Booting…"}
    </span>
    <span class="chip mono">Tick {tick}</span>
  </div>
</div>

<div class="workspace">
  <aside class="panel bin">
    <h2 class="panel-title">Component Bin</h2>
    <p class="panel-note">
      Tier I parts are idealized and simply work. Progress trades them for real
      parts that cost something and behave like the bench.
    </p>
    <ul class="part-list scroll">
      {#each PARTS as part (part.name)}
        <li class="part" style="--c: {part.color}">
          <span class="part-glyph">{part.tag}</span>
          <span class="part-body">
            <span class="part-name">{part.name}</span>
            <span class="part-desc">{part.desc}</span>
          </span>
          <span class="part-tier">{part.tier}</span>
        </li>
      {/each}
    </ul>
  </aside>

  <main class="panel board">
    <div class="board-frame" bind:this={frameEl}>
      <canvas class="board-canvas" bind:this={canvasEl}></canvas>
      <div class="board-overlay">
        <span class="scope-tag">Signal Trace · {SPEEDS.length}-Bus</span>
        <span class="scope-tag">Fixed-Step · Auto-Range</span>
      </div>
    </div>
  </main>

  <aside class="panel telemetry">
    <h2 class="panel-title">Telemetry</h2>
    <div class="readout">
      <span class="readout-k">Snapshot</span>
      <span class="readout-v mono">{hex(hash)}</span>
    </div>
    <div class="readout">
      <span class="readout-k">Determinism</span>
      <span class="readout-v ok">&#9679; Locked</span>
    </div>
    <div class="readout">
      <span class="readout-k">Tick</span>
      <span class="readout-v mono">{tick}</span>
    </div>

    <h3 class="sub-title">Channels</h3>
    <ul class="chan-list scroll">
      {#each CHANNELS as ch, i (ch.label)}
        <li class="chan" style="--c: {ch.color}">
          <span class="chan-dot"></span>
          <span class="chan-name">{ch.label}</span>
          <span class="chan-val mono">{fmt(channels[i] ?? 0)}</span>
          <span class="chan-bar">
            <span class="chan-fill" style="width: {barWidth(channels[i] ?? 0)}%"
            ></span>
          </span>
        </li>
      {/each}
    </ul>
  </aside>
</div>

<div class="hud-footer">
  <div class="transport">
    <button class="btn btn-accent" onclick={toggleRun} disabled={!ready}>
      {running ? "❚❚ Pause" : "▶ Run"}
    </button>
    <button class="btn" onclick={stepOnce} disabled={!ready}>▷ Step</button>
  </div>
  <div class="speed">
    <span class="speed-label">Speed</span>
    {#each SPEEDS as s (s)}
      <button
        class="btn btn-ghost {tpf === s ? 'is-active' : ''}"
        onclick={() => setSpeed(s)}
      >
        {s}×
      </button>
    {/each}
  </div>
  <div class="footer-meta">
    <span class="chip mono">Seed {SEED}</span>
    <span class="chip mono">{tpf} tick/frame</span>
  </div>
</div>

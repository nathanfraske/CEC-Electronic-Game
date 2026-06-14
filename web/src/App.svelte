<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { onMount } from "svelte";
  import { Application } from "pixi.js";
  import {
    createSimulation,
    runLoop,
    type Snapshot,
    type PlaybackControls,
  } from "./sim/loop";
  import { Board, type Mode } from "./lib/board";
  import type { BoardGraph } from "./lib/graph";

  const SEED = 1337;
  const SPEEDS = [1, 4, 16, 64];

  // The component bin. The four ideal primitives (V/R/C/L) come first and are the
  // parts the solver simulates today; the rest preview later tech-tree tiers.
  const PARTS = [
    {
      tag: "V",
      name: "Voltage Source",
      desc: "Ideal fixed DC rail",
      tier: "I",
      color: "var(--warn)",
    },
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
      tier: "II",
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

  // Telemetry channel labels match the analog core's default state layout; the
  // vector is variable length, so we iterate the live snapshot and fall back to
  // a generic node label for any extra channels the core exposes.
  const CHANNEL_LABELS = ["V(n1)", "V(cap)", "I(src)", "V(rail)"];
  const CHANNEL_COLORS = [
    "var(--accent)",
    "var(--cyan)",
    "var(--violet)",
    "var(--ok)",
    "var(--warn)",
    "var(--bronze)",
  ];
  const MODES: { id: Mode; label: string }[] = [
    { id: "select", label: "Select" },
    { id: "place", label: "Place" },
    { id: "wire", label: "Wire" },
  ];

  let frameEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;

  let tick = $state(0n);
  let liveTick = $state(0n);
  let hash = $state(0n);
  let proto = $state(0);
  let channels = $state<number[]>([]);
  let running = $state(false);
  let tpf = $state(1);
  let ready = $state(false);
  let mode = $state<Mode>("select");
  let placeKind = $state(PARTS[0]?.tag ?? "V");
  let partCount = $state(0);
  let wireCount = $state(0);
  let selCount = $state(0);
  let canUndo = $state(false);
  let scrubFrac = $state(0);

  let board: Board | undefined;
  let controls: PlaybackControls | undefined;

  const channelLabel = (i: number): string =>
    CHANNEL_LABELS[i] ?? `NODE ${i + 1}`;
  const channelColor = (i: number): string =>
    CHANNEL_COLORS[i % CHANNEL_COLORS.length] ?? "var(--accent)";

  onMount(() => {
    let app: Application | undefined;
    let disposed = false;

    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        board?.deleteSelection();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        board?.undo();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);

    void (async () => {
      const a = new Application();
      // Render into the canvas Svelte owns, rather than appending a node, so the
      // Svelte runtime stays the single source of truth for the DOM.
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
      const b = new Board(a, {
        onChange: (graph: BoardGraph) => {
          partCount = graph.components.size;
          wireCount = graph.wires.size;
          canUndo = b.canUndo();
        },
        onSelect: (sel) => {
          selCount = sel.components + sel.wires;
        },
      });
      board = b;
      b.setMode(mode);

      const sim = await createSimulation(SEED);
      proto = sim.protocolVersion();
      ready = true;

      // Paused by default: the player presses Run, or steps tick by tick.
      controls = runLoop(
        sim,
        (snap: Snapshot) => {
          b.update(snap);
          hash = snap.snapshotHash;
          channels = Array.from(snap.state);
          const st = controls?.status();
          if (st) {
            tick = st.tick;
            liveTick = st.liveTick;
            scrubFrac = st.live > 0 ? st.cursor / st.live : 0;
          }
        },
        { running: false, ticksPerFrame: tpf },
      );
    })();

    return () => {
      disposed = true;
      window.removeEventListener("keydown", onKey);
      controls?.stop();
      controls = undefined;
      board?.destroy();
      board = undefined;
      app?.destroy({ removeView: false });
    };
  });

  function syncRunning(): void {
    running = controls?.isRunning() ?? false;
  }
  function togglePlay(): void {
    controls?.toggle();
    syncRunning();
  }
  function stepFwd(): void {
    controls?.stepForward();
    syncRunning();
  }
  function stepBack(): void {
    controls?.stepBack();
    syncRunning();
  }
  function onScrub(e: Event): void {
    const el = e.currentTarget as HTMLInputElement;
    controls?.seekFraction(Number(el.value) / 1000);
    syncRunning();
  }
  function setSpeed(n: number): void {
    tpf = n;
    controls?.setTicksPerFrame(n);
  }
  function setMode(m: Mode): void {
    mode = m;
    board?.setMode(m);
  }
  function clearBoard(): void {
    board?.clear();
  }
  function undoAction(): void {
    board?.undo();
  }
  function deleteSelection(): void {
    board?.deleteSelection();
  }
  function resetView(): void {
    board?.resetView();
  }

  // --- placement via drag-and-drop from the bin ---------------------------

  function onPartDragStart(e: DragEvent, tag: string): void {
    e.dataTransfer?.setData("text/plain", tag);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
    placeKind = tag;
  }
  function onBoardDragOver(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }
  function onBoardDrop(e: DragEvent): void {
    e.preventDefault();
    const tag = e.dataTransfer?.getData("text/plain") || placeKind;
    dropAt(tag, e.clientX, e.clientY);
  }
  // In Place mode a plain click drops the selected part, so the board is usable
  // without a pointer that supports drag.
  function onBoardClick(e: MouseEvent): void {
    if (mode !== "place" || !board) return;
    dropAt(placeKind, e.clientX, e.clientY);
  }
  function dropAt(tag: string, clientX: number, clientY: number): void {
    if (!board) return;
    const rect = canvasEl.getBoundingClientRect();
    board.placeAt(tag, clientX - rect.left, clientY - rect.top);
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
      Drag a part onto the board, or pick Place mode and click. Scroll to zoom,
      drag empty space to pan. V / R / C / L are ideal and simulate today.
    </p>
    <ul class="part-list scroll">
      {#each PARTS as part (part.name)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="part {placeKind === part.tag ? 'is-selected' : ''}"
          style="--c: {part.color}"
          draggable="true"
          ondragstart={(e) => onPartDragStart(e, part.tag)}
          onclick={() => (placeKind = part.tag)}
          title="Drag onto the board, or select then click in Place mode"
        >
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
    <div class="board-tools">
      <span class="tool-label">Mode</span>
      {#each MODES as m (m.id)}
        <button
          class="btn btn-ghost {mode === m.id ? 'is-active' : ''}"
          onclick={() => setMode(m.id)}
          disabled={!ready}
        >
          {m.label}
        </button>
      {/each}
      <span class="tool-spacer"></span>
      <button
        class="btn btn-ghost"
        onclick={undoAction}
        disabled={!ready || !canUndo}
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        class="btn btn-ghost"
        onclick={deleteSelection}
        disabled={!ready || selCount === 0}
        title="Delete selected (Del)"
      >
        Delete
      </button>
      <button class="btn btn-ghost" onclick={resetView} disabled={!ready}>
        Reset View
      </button>
      <button class="btn btn-ghost" onclick={clearBoard} disabled={!ready}>
        Clear
      </button>
    </div>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="board-frame"
      bind:this={frameEl}
      role="application"
      aria-label="Circuit board"
      ondragover={onBoardDragOver}
      ondrop={onBoardDrop}
      onclick={onBoardClick}
      oncontextmenu={(e) => e.preventDefault()}
    >
      <canvas class="board-canvas" bind:this={canvasEl}></canvas>
      <div class="board-overlay">
        <span class="scope-tag">Board · {mode.toUpperCase()}</span>
        <span class="scope-tag">
          {partCount} parts · {wireCount} wires · {selCount} sel
        </span>
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
      <span class="readout-v mono">{tick} / {liveTick}</span>
    </div>

    <h3 class="sub-title">Channels · {channels.length}</h3>
    <ul class="chan-list scroll">
      {#each channels as v, i (i)}
        <li class="chan" style="--c: {channelColor(i)}">
          <span class="chan-dot"></span>
          <span class="chan-name">{channelLabel(i)}</span>
          <span class="chan-val mono">{fmt(v)}</span>
          <span class="chan-bar">
            <span class="chan-fill" style="width: {barWidth(v)}%"></span>
          </span>
        </li>
      {/each}
    </ul>
  </aside>
</div>

<div class="hud-footer">
  <div class="transport">
    <button class="btn btn-accent" onclick={togglePlay} disabled={!ready}>
      {running ? "❚❚ Pause" : "▶ Run"}
    </button>
    <button
      class="btn step"
      onclick={stepBack}
      disabled={!ready}
      title="Step back one tick">◀</button
    >
    <button
      class="btn step"
      onclick={stepFwd}
      disabled={!ready}
      title="Step forward one tick">▶</button
    >
  </div>

  <div class="scrubber">
    <input
      class="scrub"
      type="range"
      min="0"
      max="1000"
      value={Math.round(scrubFrac * 1000)}
      oninput={onScrub}
      disabled={!ready}
      aria-label="Timeline position"
    />
    <span class="scrub-read mono">t {tick} / {liveTick}</span>
  </div>

  <div class="speed">
    <span class="speed-label">Speed</span>
    {#each SPEEDS as s (s)}
      <button
        class="btn btn-ghost {tpf === s ? 'is-active' : ''}"
        onclick={() => setSpeed(s)}
        disabled={!ready}
      >
        {s}×
      </button>
    {/each}
  </div>
</div>

<style>
  /* Board interaction toolbar — sits above the canvas frame. */
  .board-tools {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 0 10px;
    flex-wrap: wrap;
  }
  .tool-label {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--faint);
    margin-right: 2px;
  }
  .tool-spacer {
    flex: 1;
  }

  .part {
    user-select: none;
  }
  .part.is-selected {
    border-color: var(--c);
    box-shadow: 0 0 0 1px color-mix(in oklch, var(--c) 40%, transparent);
  }

  .board {
    display: flex;
    flex-direction: column;
  }

  /* Transport: step buttons + the timeline scrubber. */
  .step {
    font-family: var(--font-mono);
    padding: 8px 11px;
    min-width: 38px;
  }
  .scrubber {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 180px;
  }
  .scrub-read {
    font-size: 11px;
    color: var(--dim);
    white-space: nowrap;
  }
  .scrub {
    flex: 1;
    height: 22px;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    cursor: pointer;
    min-width: 120px;
  }
  .scrub:focus {
    outline: none;
  }
  .scrub::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-2);
  }
  .scrub::-moz-range-track {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-2);
  }
  .scrub::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    margin-top: -5px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--bg);
    box-shadow: 0 0 10px -2px var(--accent);
  }
  .scrub::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--bg);
    box-shadow: 0 0 10px -2px var(--accent);
  }
  .scrub:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>

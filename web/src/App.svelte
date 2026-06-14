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
  import { BoardGraph } from "./lib/graph";
  import { EXAMPLES, type ExampleSpec } from "./lib/examples";
  import {
    buildNetlist,
    electricalMap,
    graphShape,
    type BuiltNetlist,
  } from "./lib/netlist";
  import type { ElectricalState } from "./lib/glyphs";

  const SEED = 1337;
  const SPEEDS = [0.25, 1, 4, 16, 64];

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

  // The state vector is node voltages (index 0 is ground); channels are labelled
  // by node index and iterate the live snapshot length.
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
    { id: "measure", label: "Measure" },
  ];

  let frameEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;

  let tick = $state(0n);
  let liveTick = $state(0n);
  let hash = $state(0n);
  let proto = $state(0);
  let channels = $state<number[]>([]);
  let running = $state(false);
  let tpf = $state(0.25);
  let ready = $state(false);
  let mode = $state<Mode>("select");
  let placeKind = $state(PARTS[0]?.tag ?? "V");
  let leftTab = $state<"parts" | "examples">("parts");
  let buildEx = $state<ExampleSpec | null>(null);
  let buildStep = $state(0);
  let buildDone = $state(false);
  let buildTarget = "";
  let demo = $state<{ label: string; on: string; off: string } | null>(null);
  let demoOn = $state(true);
  let demoExRef: ExampleSpec | null = null;
  let showIntro = $state(true);
  let partCount = $state(0);
  let wireCount = $state(0);
  let selCount = $state(0);
  let canUndo = $state(false);
  let scrubFrac = $state(0);

  let board: Board | undefined;
  let controls: PlaybackControls | undefined;

  const channelLabel = (i: number): string => (i === 0 ? "GND" : `Node ${i}`);
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
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "r" || e.key === "R")) {
        board?.rotateSelection();
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
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });
      if (disposed) {
        a.destroy({ removeView: false });
        return;
      }
      app = a;

      const sim = await createSimulation(SEED);
      proto = sim.protocolVersion();

      // Compile the board into a netlist and install it whenever the topology or
      // a value changes. Pure moves leave the signature unchanged, so dragging a
      // part around never resets the running simulation.
      let netlist: BuiltNetlist | null = null;
      let netlistSig = "";
      const rebuildNetlist = (graph: BoardGraph): void => {
        const nl = buildNetlist(graph);
        const sig = nl ? nl.sig : graph.components.size > 0 ? "empty" : "demo";
        if (sig === netlistSig) return;
        netlistSig = sig;
        netlist = nl;
        board?.setProbeNodes(nl ? nl.nodesOfComponent : null);
        if (nl) {
          sim.setNetlist(nl.nodeCount, nl.types, nl.a, nl.b, nl.values);
          controls?.resync();
        } else if (graph.components.size > 0) {
          // Parts placed but no voltage source to reference: install a quiet
          // ground-only circuit so the readouts go flat rather than stale.
          sim.setNetlist(
            1,
            new Uint8Array(),
            new Uint32Array(),
            new Uint32Array(),
            new Float64Array(),
          );
          controls?.resync();
        }
        // else: empty board — keep the built-in demo circuit running.
      };

      const b = new Board(a, {
        onChange: (graph: BoardGraph) => {
          partCount = graph.components.size;
          wireCount = graph.wires.size;
          canUndo = b.canUndo();
          rebuildNetlist(graph);
          advanceBuild(graph);
        },
        onSelect: (sel) => {
          selCount = sel.components + sel.wires;
        },
      });
      board = b;
      b.setMode(mode);
      ready = true;

      // Paused by default: the player presses Run, or steps tick by tick.
      controls = runLoop(
        sim,
        (snap: Snapshot) => {
          // Attribute per-element current and per-net voltage to each component
          // so the glyphs animate with what is actually happening to them.
          const electrical: Map<number, ElectricalState> | undefined =
            netlist && snap.elementCurrents
              ? electricalMap(netlist, snap.state, snap.elementCurrents)
              : undefined;
          b.update(snap, electrical);
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

      // Open with the primer so the very first thing you see is current flowing
      // through a voltage-coloured wire — a demonstration of the two primitives.
      const primer = EXAMPLES.find((e) => e.id === "primer");
      if (primer) loadExample(primer);
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
  function restartRun(): void {
    controls?.restart();
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
    demo = null;
    showIntro = false;
  }
  function undoAction(): void {
    board?.undo();
  }
  function deleteSelection(): void {
    board?.deleteSelection();
  }
  function rotateSel(): void {
    board?.rotateSelection();
  }
  function resetView(): void {
    board?.resetView();
  }
  function loadExample(ex: ExampleSpec): void {
    board?.loadGraph(ex.build());
    // Start paused so you can take in the circuit before it runs (the intro
    // banner / transport invites you to press Run).
    controls?.pause();
    syncRunning();
    setMode("select");
    demoExRef = ex.demo ? ex : null;
    demo = ex.demo
      ? { label: ex.demo.label, on: ex.demo.on, off: ex.demo.off }
      : null;
    demoOn = true;
  }
  function toggleDemo(): void {
    const ex = demoExRef;
    if (!ex?.demo) return;
    demoOn = !demoOn;
    board?.loadGraph(demoOn ? ex.build() : ex.demo.alt());
    controls?.resume();
    syncRunning();
  }
  function startBuild(ex: ExampleSpec): void {
    board?.clear();
    demo = null;
    buildEx = ex;
    buildStep = 0;
    buildDone = false;
    const g = new BoardGraph();
    g.restore(ex.build());
    buildTarget = graphShape(g);
    placeKind = "V";
    setMode("place");
    leftTab = "parts";
    showIntro = false;
  }
  function exitBuild(): void {
    buildEx = null;
  }
  function showSolution(): void {
    const ex = buildEx;
    if (!ex) return;
    board?.loadGraph(ex.build());
    controls?.resume();
    syncRunning();
    buildEx = null;
  }
  // Advance the guided build as the player places parts and draws wires.
  function advanceBuild(graph: BoardGraph): void {
    const ex = buildEx;
    if (!ex) return;
    const count: Record<string, number> = {};
    for (const c of graph.components.values()) {
      count[c.kind] = (count[c.kind] ?? 0) + 1;
    }
    const progress = {
      count,
      wires: graph.wires.size,
      complete: graphShape(graph) === buildTarget,
    };
    while (buildStep < ex.steps.length && ex.steps[buildStep]?.done(progress)) {
      buildStep++;
    }
    if (progress.complete || buildStep >= ex.steps.length) {
      buildDone = true;
      controls?.resume();
      syncRunning();
    }
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
    <div class="bin-tabs">
      <button
        class="tab {leftTab === 'parts' ? 'is-active' : ''}"
        onclick={() => (leftTab = "parts")}>Parts</button
      >
      <button
        class="tab {leftTab === 'examples' ? 'is-active' : ''}"
        onclick={() => (leftTab = "examples")}>Examples</button
      >
    </div>
    {#if leftTab === "parts"}
      <p class="panel-note">
        Drag a part onto the board, or pick Place mode and click. Scroll to
        zoom, drag empty space to pan. V / R / C / L are ideal and simulate
        today.
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
    {:else}
      <p class="panel-note">
        Watch a worked circuit run, or build it yourself step by step.
      </p>
      <ul class="example-list scroll">
        {#each EXAMPLES as ex (ex.id)}
          <li class="example">
            <div class="example-head">
              <span class="example-name">{ex.name}</span>
              <span class="example-actions">
                <button class="btn btn-ghost" onclick={() => loadExample(ex)}>
                  Watch
                </button>
                <button class="btn btn-ghost" onclick={() => startBuild(ex)}>
                  Build
                </button>
              </span>
            </div>
            <p class="example-blurb">{ex.blurb}</p>
            <p class="example-watch">Watch · {ex.watch}</p>
          </li>
        {/each}
      </ul>
    {/if}
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
      {#if demo}
        <button
          class="btn btn-ghost demo-btn {demoOn ? 'is-active' : ''}"
          onclick={toggleDemo}
          title={demoOn ? demo.on : demo.off}
        >
          {demo.label}: {demoOn ? "ON" : "OFF"}
        </button>
      {/if}
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
      <button
        class="btn btn-ghost"
        onclick={rotateSel}
        disabled={!ready || selCount === 0}
        title="Rotate selected (R)"
      >
        Rotate
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

      {#if buildEx}
        {@const ex = buildEx}
        <div class="guided-overlay">
          <div class="guided-head">
            <span class="guided-title">Build · {ex.name}</span>
            <button class="btn btn-ghost" onclick={exitBuild}>Exit</button>
          </div>
          <ol class="guided-steps">
            {#each ex.steps as step, i (i)}
              <li
                class="gstep {i < buildStep
                  ? 'is-done'
                  : i === buildStep
                    ? 'is-current'
                    : ''}"
              >
                <span class="gstep-do">{step.do}</span>
                {#if i === buildStep && !buildDone}
                  <span class="gstep-why">{step.why}</span>
                {/if}
              </li>
            {/each}
          </ol>
          {#if buildDone}
            <p class="guided-done">
              ✓ Loop closed — current flows. Probe it in Measure, or select a
              part.
            </p>
          {:else}
            <p class="guided-open">
              Open loop — no current flows until you close it to ground.
            </p>
          {/if}
          <button class="btn btn-ghost guided-solution" onclick={showSolution}>
            Show solution
          </button>
        </div>
      {/if}

      {#if showIntro}
        <div class="intro-banner">
          <p>
            <strong>This is electricity.</strong> The arrows flowing along the
            wire are <span class="hl hl-cur">current</span> — charge in motion.
            The wire's colour is its <span class="hl hl-volt">voltage</span>,
            the pressure that drives them (amber = high, grey = ground). Press
            <strong>▶ Run</strong>, switch to <strong>Measure</strong> to probe,
            or <strong>Clear</strong> to build your own.
          </p>
          <button
            class="intro-x"
            onclick={() => (showIntro = false)}
            aria-label="Dismiss intro">×</button
          >
        </div>
      {/if}
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
    <button
      class="btn step"
      onclick={restartRun}
      disabled={!ready}
      title="Reset run to t=0">↺</button
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

  /* Left-panel tabs (Parts / Examples) and the example cards. */
  .bin-tabs {
    display: flex;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }
  .tab {
    flex: 1;
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--dim);
    padding: 7px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--surface);
    cursor: pointer;
    transition:
      color 0.15s,
      border-color 0.15s,
      background 0.15s;
  }
  .tab.is-active {
    color: var(--accent);
    border-color: var(--accent-line);
    background: var(--accent-soft);
  }
  .example-list {
    list-style: none;
    margin: 0;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .example {
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    padding: 10px 11px;
  }
  .example-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .example-name {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 14px;
    letter-spacing: 0.04em;
    color: var(--text);
  }
  .example-blurb {
    margin: 7px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--faint);
  }
  .example-watch {
    margin: 6px 0 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ok);
  }
  .example-actions {
    display: flex;
    gap: 6px;
  }

  /* Guided build: an ordered, auto-advancing checklist. */
  .guided-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .guided-title {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 14px;
    letter-spacing: 0.06em;
    color: var(--text);
  }
  .guided-steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    counter-reset: step;
  }
  .gstep {
    position: relative;
    padding: 8px 10px 8px 34px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    color: var(--faint);
    counter-increment: step;
  }
  .gstep::before {
    content: counter(step);
    position: absolute;
    left: 9px;
    top: 8px;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: 10px;
    border-radius: 50%;
    border: 1px solid var(--border);
    color: var(--dim);
  }
  .gstep-do {
    display: block;
    font-size: 12.5px;
  }
  .gstep.is-current {
    border-color: var(--accent-line);
    background: var(--accent-soft);
    color: var(--text);
  }
  .gstep.is-current::before {
    border-color: var(--accent);
    color: var(--accent);
  }
  .gstep.is-done::before {
    content: "✓";
    border-color: color-mix(in oklch, var(--ok) 50%, transparent);
    color: var(--ok);
  }
  .gstep-why {
    display: block;
    margin-top: 4px;
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--dim);
  }
  .guided-done {
    margin: 10px 0;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--ok);
  }
  .guided-open {
    margin: 10px 0;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--warn);
  }
  .guided-solution {
    margin-top: 6px;
  }

  /* Board overlays: the guide floats over the canvas (so Parts stays visible in
     the left panel), and the primer intro banner explains V and I up front. */
  .guided-overlay {
    position: absolute;
    top: 12px;
    left: 12px;
    width: 258px;
    max-height: calc(100% - 24px);
    overflow-y: auto;
    padding: 12px;
    background: oklch(0.165 0.028 285 / 0.92);
    border: 1px solid var(--border-bright);
    border-radius: 4px;
    box-shadow: 0 10px 30px -12px #000;
    backdrop-filter: blur(3px);
  }
  .intro-banner {
    position: absolute;
    left: 12px;
    bottom: 12px;
    max-width: 56%;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    background: oklch(0.165 0.028 285 / 0.94);
    border: 1px solid var(--accent-line);
    border-radius: 4px;
    box-shadow: 0 0 24px -8px var(--accent);
    backdrop-filter: blur(3px);
  }
  .intro-banner p {
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
    color: var(--dim);
  }
  .intro-banner strong {
    color: var(--text);
    font-weight: 600;
  }
  .hl {
    font-weight: 600;
  }
  .hl-cur {
    color: var(--cyan);
  }
  .hl-volt {
    color: var(--warn);
  }
  .intro-x {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--surface);
    color: var(--dim);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .intro-x:hover {
    color: var(--text);
    border-color: var(--dim);
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

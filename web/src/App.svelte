<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { onMount } from "svelte";
  import { Application } from "pixi.js";
  import {
    createSimulation,
    runLoop,
    DT_SECONDS,
    type Snapshot,
    type PlaybackControls,
  } from "./sim/loop";
  import {
    Board,
    type Mode,
    type SelectedPart,
    type AnchorRect,
  } from "./lib/board";
  import { BoardGraph, formatValue, PART_KINDS } from "./lib/graph";
  import {
    hasValue,
    isESeries,
    chipsOf,
    decadesOf,
    significandsOf,
    standardValues,
    stepValue,
    nearestStandard,
  } from "./lib/values";
  import {
    EXAMPLES,
    EXAMPLE_CATEGORIES,
    categoryOf,
    type ExampleSpec,
  } from "./lib/examples";
  import {
    buildNetlist,
    electricalMap,
    graphShape,
    type BuiltNetlist,
  } from "./lib/netlist";
  import { ZERO_ELECTRICAL, type ElectricalState } from "./lib/glyphs";
  import { partInfo } from "./lib/partInfo";
  import { CALCS } from "./lib/calc";
  import { InfoDiagram } from "./lib/infoDiagram";

  const SEED = 1337;
  // Playback rate options, in **ticks of sim time per real second**. DT is 2 µs,
  // so 500_000 ticks/s = real time (one sim-second per second); the rest run
  // proportionally slower so fast dynamics are watchable.
  const RATES = [50, 500, 5000, 50000, 500000];
  const fmtRate = (n: number): string =>
    n >= 1000 ? n / 1000 + "k/s" : n + "/s";
  // Sim-seconds advanced per real second, as a friendly "× real time" label.
  const fmtRealtime = (rate: number): string => {
    const f = rate * DT_SECONDS;
    return f >= 1 ? f + "× real time" : "1/" + Math.round(1 / f) + " real time";
  };
  // A tick count as a wall-clock duration (tick × DT).
  const fmtTime = (s: number): string => {
    if (s < 1e-3) return (s * 1e6).toFixed(1) + " µs";
    if (s < 1) return (s * 1e3).toFixed(2) + " ms";
    return s.toFixed(3) + " s";
  };

  // The component bin. The ideal primitives (V/R/C/L/I) plus an explicit ground
  // come first and are the parts the solver simulates today; the rest preview
  // later tech-tree tiers.
  const PARTS = [
    {
      tag: "V",
      name: "Voltage Source",
      desc: "Ideal fixed DC rail",
      tier: "I",
      color: "var(--warn)",
    },
    {
      tag: "AC",
      name: "AC Source",
      desc: "Sine source · set Hz",
      tier: "I",
      color: "var(--accent)",
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
      tag: "I",
      name: "Current Source",
      desc: "Ideal fixed DC current",
      tier: "I",
      color: "var(--warn)",
    },
    {
      tag: "GND",
      name: "Ground",
      desc: "0 V reference (node 0)",
      tier: "I",
      color: "var(--dim)",
    },
    {
      tag: "D",
      name: "Diode",
      desc: "One-way conduction",
      tier: "II",
      color: "var(--warn)",
    },
    {
      tag: "SW",
      name: "Switch",
      desc: "Clock-driven (PWM)",
      tier: "II",
      color: "var(--ok)",
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
  let frameEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;

  let tick = $state(0n);
  let liveTick = $state(0n);
  let hash = $state(0n);
  let proto = $state(0);
  let channels = $state<number[]>([]);
  let running = $state(false);
  let tps = $state(500);
  let ready = $state(false);
  let mode = $state<Mode>("select");
  // The "armed" part: clicking the board drops it (place-and-repeat). Null = none.
  let armedPart = $state<string | null>(null);
  // The multimeter function in Measure mode: voltmeter or ammeter.
  let probeMode = $state<"V" | "A">("V");
  // Component art style: real schematic symbols, or the Factorio machine lens.
  let boardStyle = $state<"schematic" | "factory">("schematic");
  // Fallback kind for native drag-and-drop from the bin (set on dragstart).
  let dragKind = "V";
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
  // The lone selected part (for the value inspector) + its "more values" toggle,
  // and its on-screen anchor rect for the floating popover.
  let selPart = $state<SelectedPart | null>(null);
  let showMore = $state(false);
  let anchor = $state<AnchorRect | null>(null);
  // Set when the circuit can't actually solve (e.g. a current source with no
  // return path) so the HUD can warn instead of showing a meaningless reading.
  let circuitWarning = $state<string | null>(null);
  // Info drawer: the deep explanatory view of the selected part + calculators.
  let infoOpen = $state(false);
  let infoTab = $state<"info" | "calc">("info");
  let selElectrical = $state<ElectricalState | null>(null);
  let infoDiagram: InfoDiagram | undefined;
  // Calculator inputs, seeded from each calc's presets.
  const initialCalc: Record<string, Record<string, number>> = {};
  for (const c of CALCS) {
    const row: Record<string, number> = {};
    for (const fld of c.fields) row[fld.key] = fld.preset;
    initialCalc[c.id] = row;
  }
  let calcVals = $state(initialCalc);
  function fillCalc(id: string): void {
    if (!selPart) return;
    const u = PART_KINDS[selPart.kind]?.unit;
    const c = CALCS.find((x) => x.id === id);
    if (!c) return;
    for (const fld of c.fields) {
      if (fld.unit === u) calcVals[id]![fld.key] = selPart.value;
    }
  }
  // A Svelte action that owns the diagram's Pixi sub-app for the drawer's lifetime.
  function infoDiagramAction(node: HTMLCanvasElement) {
    const d = new InfoDiagram();
    infoDiagram = d;
    void d.init(node);
    return {
      destroy() {
        d.destroy();
        if (infoDiagram === d) infoDiagram = undefined;
      },
    };
  }
  let canUndo = $state(false);
  let scrubFrac = $state(0);
  // Scope/telemetry controls: an enlarged scope, plus per-node visibility + names.
  let scopeBig = $state(false);
  let nodeVisible = $state<Record<number, boolean>>({});
  let nodeNames = $state<Record<number, string>>({});

  let board: Board | undefined;
  let controls: PlaybackControls | undefined;

  const channelLabel = (i: number): string => (i === 0 ? "GND" : `Node ${i}`);
  const channelColor = (i: number): string =>
    CHANNEL_COLORS[i % CHANNEL_COLORS.length] ?? "var(--accent)";
  const partName = (tag: string): string =>
    PARTS.find((p) => p.tag === tag)?.name ?? tag;

  // One-line contextual hint that replaces the old mode buttons: it tells you
  // what a click will do right now, so the modeless board stays learnable.
  const hint = $derived(
    mode === "measure"
      ? probeMode === "A"
        ? "PROBE · click a part/wire for its current AND voltage at once (a real meter needs separate ports for each)"
        : "VOLTMETER · click two points to read ΔV (one point = vs GND)"
      : armedPart
        ? `PLACING ${partName(armedPart)} · click to drop · Esc to cancel`
        : "BUILD · arm a part & click to place · drag a pin to wire · drag a wire to bend",
  );

  // The displayed tick as a wall-clock duration of simulated time (tick × DT).
  const simSeconds = $derived(Number(tick) * DT_SECONDS);

  // Position the value popover above the selected part, flipping below near the
  // top edge and clamping left into the board frame; the caret tracks the part.
  const POP_W = 320;
  const popPos = $derived.by(() => {
    if (!anchor || !frameEl) return null;
    const m = 8;
    const fw = frameEl.clientWidth;
    const fh = frameEl.clientHeight;
    let left = anchor.x + anchor.width / 2 - POP_W / 2;
    left = Math.max(m, Math.min(fw - POP_W - m, left));
    const below = anchor.y < 150; // too little room above → drop below the part
    const caretLeft = anchor.x + anchor.width / 2 - left;
    return {
      left,
      top: below ? anchor.y + anchor.height + 10 : null,
      bottom: below ? null : fh - anchor.y + 10,
      below,
      caretLeft: Math.max(14, Math.min(POP_W - 14, caretLeft)),
    };
  });

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
      } else if (e.key === "Escape") {
        // Universal cancel: disarm first, otherwise cancel a wire / clear selection.
        if (armedPart) arm(null);
        else board?.escape();
        e.preventDefault();
      } else if (e.key === " ") {
        togglePlay(); // spacebar = play / pause
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        board?.nudge(-1, 0); // arrows nudge the selection (or pan)
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        board?.nudge(1, 0);
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        board?.nudge(0, -1);
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        board?.nudge(0, 1);
        e.preventDefault();
      } else if (e.key === "," || e.key === "<") {
        stepBack(); // , / < = step one tick back
        e.preventDefault();
      } else if (e.key === "." || e.key === ">") {
        stepFwd(); // . / > = step one tick forward
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
        circuitWarning =
          nl && nl.floatingSources.length > 0
            ? "A current source has no return path — its current can't flow, so this reading isn't meaningful. Complete the loop back to the source."
            : null;
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
          // Any edit — place, move, rotate, rewire, or a value change — rewinds
          // the scope and the clock to t=0 so you always watch the new circuit
          // from the start rather than mid-flight in the old one.
          controls?.restart();
          syncRunning();
        },
        onSelect: (sel) => {
          selCount = sel.components + sel.wires;
          selPart = sel.single ?? null;
        },
        onArm: (kind) => {
          // The board disarmed itself (right-click) — mirror it into the HUD.
          armedPart = kind;
        },
        onAnchor: (rect) => {
          anchor = rect;
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
          b.update(snap, electrical, controls?.isRunning() ?? false);
          if (selPart) {
            const e = electrical?.get(selPart.id) ?? ZERO_ELECTRICAL;
            selElectrical = e;
            if (infoOpen) infoDiagram?.setState(selPart.kind, e);
          } else {
            selElectrical = null;
          }
          hash = snap.snapshotHash;
          channels = Array.from(snap.state);
          const st = controls?.status();
          if (st) {
            tick = st.tick;
            liveTick = st.liveTick;
            scrubFrac = st.live > 0 ? st.cursor / st.live : 0;
          }
        },
        { running: false, ticksPerSecond: tps },
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
  function setRate(n: number): void {
    tps = n;
    controls?.setTicksPerSecond(n);
  }

  // --- value inspector (shown when exactly one part is selected) ---
  function fmtVal(kind: string, value: number): string {
    if (kind === "SW") return Math.round(value * 100) + "% duty";
    const u = PART_KINDS[kind]?.unit ?? "";
    return u ? formatValue(value, u) : String(value);
  }
  function setVal(v: number): void {
    if (selPart) board?.setComponentValue(selPart.id, v);
  }
  function stepVal(dir: number): void {
    if (selPart) setVal(stepValue(selPart.kind, selPart.value, dir));
  }
  // The decade the current value sits in (for the decade × significand picker).
  function valueDecade(kind: string, value: number): number {
    const decs = decadesOf(kind);
    if (decs.length === 0 || value <= 0) return 1;
    const ideal = Math.pow(10, Math.floor(Math.log10(value)));
    let best = decs[0]!;
    let bestD = Infinity;
    for (const d of decs) {
      const dd = Math.abs(Math.log10(d) - Math.log10(ideal));
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }
  function setSig(s: number): void {
    if (!selPart) return;
    setVal(
      nearestStandard(
        selPart.kind,
        s * valueDecade(selPart.kind, selPart.value),
      ),
    );
  }
  function setDecade(d: number): void {
    if (!selPart) return;
    const sig = selPart.value / valueDecade(selPart.kind, selPart.value);
    setVal(nearestStandard(selPart.kind, sig * d));
  }
  function setMode(m: Mode): void {
    mode = m;
    board?.setMode(m);
  }
  // Arm / disarm a part for placement. Arming while measuring drops you back into
  // Build so the click actually places.
  function arm(tag: string | null): void {
    armedPart = tag;
    if (tag && mode === "measure") setMode("select");
    board?.setArmed(tag);
  }
  function toggleArm(tag: string): void {
    arm(armedPart === tag ? null : tag);
  }
  function enterBuild(): void {
    setMode("select");
  }
  function enterMeasure(): void {
    arm(null);
    setMode("measure");
  }
  function setProbeMode(m: "V" | "A"): void {
    probeMode = m;
    board?.setProbeMode(m);
  }
  function toggleStyle(): void {
    boardStyle = boardStyle === "schematic" ? "factory" : "schematic";
    board?.setStyle(boardStyle);
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
  function toggleScope(): void {
    scopeBig = board?.toggleScopeExpanded() ?? false;
  }
  function toggleNode(i: number, visible: boolean): void {
    nodeVisible[i] = visible;
    board?.setNodeHidden(i, !visible);
  }
  function renameNode(i: number, name: string): void {
    nodeNames[i] = name;
    board?.setNodeLabel(i, name);
  }
  function loadExample(ex: ExampleSpec): void {
    board?.loadGraph(ex.build());
    // Start paused so you can take in the circuit before it runs (the intro
    // banner / transport invites you to press Run).
    controls?.pause();
    syncRunning();
    arm(null);
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
    setMode("select");
    arm("V");
    leftTab = "parts";
    showIntro = false;
    // Run the sim throughout the build so each part you add comes alive as soon
    // as it's in a working sub-circuit (the netlist rebuilds on every change).
    controls?.resume();
    syncRunning();
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
    dragKind = tag;
  }
  function onBoardDragOver(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }
  function onBoardDrop(e: DragEvent): void {
    e.preventDefault();
    const tag = e.dataTransfer?.getData("text/plain") || dragKind;
    dropAt(tag, e.clientX, e.clientY);
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
        Click a part to arm it, then click the board to drop (click again or Esc
        to disarm) — or drag it on. Scroll to zoom, drag empty space to pan. V /
        R / C / L / I / D / SW and GND all simulate today.
      </p>
      <ul class="part-list scroll">
        {#each PARTS as part (part.name)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <li
            class="part {armedPart === part.tag ? 'is-selected' : ''}"
            style="--c: {part.color}"
            draggable="true"
            ondragstart={(e) => onPartDragStart(e, part.tag)}
            onclick={() => toggleArm(part.tag)}
            title="Click to arm for placement, or drag onto the board"
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
        Pick a category and work through it — Watch a circuit run, or Build it
        yourself step by step.
      </p>
      <div class="example-cats scroll">
        {#each EXAMPLE_CATEGORIES as cat (cat)}
          {@const items = EXAMPLES.filter((e) => categoryOf(e.id) === cat)}
          {#if items.length > 0}
            <details class="example-cat" open>
              <summary class="example-cat-head">
                <span class="example-cat-name">{cat}</span>
                <span class="example-cat-count">{items.length}</span>
              </summary>
              <ul class="example-list">
                {#each items as ex (ex.id)}
                  <li class="example">
                    <div class="example-head">
                      <span class="example-name">{ex.name}</span>
                      <span class="example-actions">
                        <button
                          class="btn btn-ghost"
                          onclick={() => loadExample(ex)}
                        >
                          Watch
                        </button>
                        <button
                          class="btn btn-ghost"
                          onclick={() => startBuild(ex)}
                        >
                          Build
                        </button>
                      </span>
                    </div>
                    <p class="example-blurb">{ex.blurb}</p>
                    <p class="example-watch">Watch · {ex.watch}</p>
                  </li>
                {/each}
              </ul>
            </details>
          {/if}
        {/each}
      </div>
    {/if}
  </aside>

  <main class="panel board">
    <div class="board-tools">
      <span class="tool-label">Tool</span>
      <button
        class="btn btn-ghost {mode === 'select' ? 'is-active' : ''}"
        onclick={enterBuild}
        disabled={!ready}
        title="Build: place parts and wire pins"
      >
        Build
      </button>
      <button
        class="btn btn-ghost {mode === 'measure' ? 'is-active' : ''}"
        onclick={enterMeasure}
        disabled={!ready}
        title="Measure: probe voltage between two points, or current through a part"
      >
        Measure
      </button>
      {#if mode === "measure"}
        <span class="meter-toggle">
          <button
            class="btn btn-ghost {probeMode === 'V' ? 'is-active' : ''}"
            onclick={() => setProbeMode("V")}
            title="Voltmeter — ΔV between two points">V</button
          >
          <button
            class="btn btn-ghost {probeMode === 'A' ? 'is-active' : ''}"
            onclick={() => setProbeMode("A")}
            title="Probe — a part/wire's current + voltage together">A</button
          >
        </span>
      {/if}
      <button
        class="btn btn-ghost {infoOpen ? 'is-active' : ''}"
        onclick={() => (infoOpen = !infoOpen)}
        disabled={!ready}
        title="Info: deep explanatory view of the selected part + calculators"
      >
        ⓘ Info
      </button>
      <button
        class="btn btn-ghost {boardStyle === 'factory' ? 'is-active' : ''}"
        onclick={toggleStyle}
        disabled={!ready}
        title="Toggle component art: schematic symbols ↔ factory machines"
      >
        {boardStyle === "factory" ? "⚙ Factory" : "⎍ Schematic"}
      </button>
      {#if armedPart}
        <span class="armed-chip" title="Armed for placement">
          {partName(armedPart)}
          <button class="armed-x" onclick={() => arm(null)} aria-label="Disarm"
            >×</button
          >
        </span>
      {/if}
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
    <div
      class="board-frame"
      bind:this={frameEl}
      role="application"
      aria-label="Circuit board"
      ondragover={onBoardDragOver}
      ondrop={onBoardDrop}
      oncontextmenu={(e) => e.preventDefault()}
    >
      <canvas class="board-canvas" bind:this={canvasEl}></canvas>
      <div class="board-overlay">
        <span class="scope-tag">{hint}</span>
        <span class="scope-tag">
          {partCount} parts · {wireCount} wires · {selCount} sel
        </span>
      </div>

      {#if circuitWarning}
        <div class="circuit-warn">⚠ {circuitWarning}</div>
      {/if}

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

      {#if popPos && selPart && hasValue(selPart.kind)}
        {@const kind = selPart.kind}
        {@const cd = valueDecade(kind, selPart.value)}
        <div
          class="value-pop {popPos.below ? 'below' : 'above'}"
          style="left: {popPos.left}px; {popPos.top !== null
            ? `top: ${popPos.top}px;`
            : `bottom: ${popPos.bottom}px;`}"
        >
          <div class="insp-head">
            <span class="insp-kind">{partName(kind)}</span>
            <span class="insp-val mono">{fmtVal(kind, selPart.value)}</span>
          </div>
          {#if selElectrical}
            <div class="insp-meter mono">
              {formatValue(selElectrical.vAcross, "V")} across · {formatValue(
                selElectrical.current,
                "A",
              )} through
            </div>
          {/if}
          <div class="insp-row">
            <button
              class="btn btn-ghost insp-step"
              onclick={() => stepVal(-1)}
              title="Next smaller standard value">−</button
            >
            <div class="insp-chips">
              {#each chipsOf(kind) as v (v)}
                <button
                  class="chip-val {selPart.value === v ? 'is-active' : ''}"
                  onclick={() => setVal(v)}>{fmtVal(kind, v)}</button
                >
              {/each}
            </div>
            <button
              class="btn btn-ghost insp-step"
              onclick={() => stepVal(1)}
              title="Next larger standard value">+</button
            >
          </div>
          <button class="insp-more" onclick={() => (showMore = !showMore)}>
            {showMore ? "▾ fewer" : "▸ more values"}
          </button>
          {#if showMore && isESeries(kind)}
            <div class="insp-sub">decade</div>
            <div class="insp-chips wrap">
              {#each decadesOf(kind) as d (d)}
                <button
                  class="chip-val sm {cd === d ? 'is-active' : ''}"
                  onclick={() => setDecade(d)}>{fmtVal(kind, d)}</button
                >
              {/each}
            </div>
            <div class="insp-sub">significand (E-series)</div>
            <div class="insp-chips wrap">
              {#each significandsOf(kind) as s (s)}
                <button
                  class="chip-val sm {Math.abs(selPart.value / cd - s) < 0.05
                    ? 'is-active'
                    : ''}"
                  onclick={() => setSig(s)}>{s.toFixed(1)}</button
                >
              {/each}
            </div>
          {:else if showMore}
            <div class="insp-chips wrap">
              {#each standardValues(kind) as v (v)}
                <button
                  class="chip-val sm {selPart.value === v ? 'is-active' : ''}"
                  onclick={() => setVal(v)}>{fmtVal(kind, v)}</button
                >
              {/each}
            </div>
          {/if}
          <span class="value-pop-caret" style="left: {popPos.caretLeft}px"
          ></span>
        </div>
      {/if}

      {#if infoOpen}
        <aside class="info-drawer">
          <div class="info-head">
            <span class="info-title">
              {selPart ? partName(selPart.kind) : "Component Info"}
            </span>
            <button
              class="intro-x"
              onclick={() => (infoOpen = false)}
              aria-label="Close info">×</button
            >
          </div>
          <div class="info-tabs">
            <button
              class="tab {infoTab === 'info' ? 'is-active' : ''}"
              onclick={() => (infoTab = "info")}>Info</button
            >
            <button
              class="tab {infoTab === 'calc' ? 'is-active' : ''}"
              onclick={() => (infoTab = "calc")}>Calculators</button
            >
          </div>
          <div class="info-body scroll">
            {#if infoTab === "info"}
              {#if selPart}
                {@const info = partInfo(selPart.kind)}
                {#if info}
                  {@const e = selElectrical ?? ZERO_ELECTRICAL}
                  <div class="info-diagram">
                    <canvas use:infoDiagramAction></canvas>
                  </div>
                  <div class="info-eq mono">{info.equation}</div>
                  <p class="info-plain">{info.plain()}</p>
                  <div class="info-live">
                    <div class="info-live-head">Right now</div>
                    <div class="info-sub mono">
                      {info.headline(e, selPart.value)}
                    </div>
                    {#each info.derived(e, selPart.value) as row (row.label)}
                      <div class="info-row">
                        <span>{row.label}</span>
                        <span class="mono">{row.value}</span>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="info-empty">
                    {partName(selPart.kind)} isn't simulated yet — no live math to
                    show.
                  </p>
                {/if}
              {:else}
                <p class="info-empty">
                  Select a component on the board to see what it's doing — its
                  governing equation, a plain explanation of how it works, and a
                  live "right now" readout of its numbers.
                </p>
              {/if}

              <section class="belt-note">
                <h3 class="belt-title">The belt — carriers &amp; energy</h3>
                <div class="belt-legend">
                  <span class="belt-key"
                    ><b class="belt-carrier">›</b> carriers · charge</span
                  >
                  <span class="belt-key"
                    ><b class="belt-energy">●</b> energy · power</span
                  >
                </div>
                <p class="info-plain">
                  Two things ride every wire. The <b>carriers</b> are the arrow
                  chevrons, coloured by the net's voltage — they move the way
                  the current flows. On <b>DC</b> they stream one way; on
                  <b>AC</b> they slosh back and forth in place, because the current
                  reverses every half-cycle. Net charge barely travels.
                </p>
                <p class="info-plain">
                  The orange dots are <b>energy</b> — power,
                  <span class="mono">P = V·I</span>, carried to the load. Here's
                  the surprise: on AC's negative half-cycle <b>both</b> the
                  voltage and the current go negative, yet the energy still
                  flows
                  <b>forward</b>. Power is their <i>product</i>, and negative ×
                  negative is <b>positive</b> — so
                  <span class="mono">P = V·I ≥ 0</span> the whole cycle through a
                  resistor. The carriers slosh, but the energy is never not being
                  delivered.
                </p>
                <p class="info-plain">
                  In a capacitor or inductor the voltage and current sit a
                  quarter-cycle apart, so <span class="mono">V·I</span> swings both
                  ways — the energy sloshes in and back out, delivering nothing on
                  average. That's reactive power.
                </p>
              </section>
            {:else}
              {#each CALCS as c (c.id)}
                {@const r = c.compute(calcVals[c.id] ?? {})}
                <div class="calc-card">
                  <div class="calc-head">
                    <span class="calc-name">{c.name}</span>
                    {#if selPart}
                      <button
                        class="calc-fill"
                        onclick={() => fillCalc(c.id)}
                        title="Fill matching fields from the selected part"
                        >↤ sel</button
                      >
                    {/if}
                  </div>
                  <div class="calc-fields">
                    {#each c.fields as fld (fld.key)}
                      <label class="calc-field">
                        <span class="calc-flabel">{fld.label} ({fld.unit})</span
                        >
                        <input
                          class="calc-input mono"
                          type="number"
                          value={calcVals[c.id]?.[fld.key] ?? fld.preset}
                          oninput={(ev) => {
                            const o = calcVals[c.id];
                            if (o) o[fld.key] = Number(ev.currentTarget.value);
                          }}
                        />
                      </label>
                    {/each}
                  </div>
                  <div class="calc-worked mono">{r.worked}</div>
                </div>
              {/each}
            {/if}
          </div>
        </aside>
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
    <div class="readout">
      <span class="readout-k">Sim time</span>
      <span class="readout-v mono">{fmtTime(simSeconds)}</span>
    </div>

    <h3 class="sub-title nodes-head">
      <span>Nodes · {channels.length}</span>
      <button
        class="btn btn-ghost scope-expand"
        onclick={toggleScope}
        disabled={!ready}
        title="Resize the scope on the board"
      >
        {scopeBig ? "Shrink scope" : "Expand scope"}
      </button>
    </h3>
    <ul class="chan-list scroll">
      {#each channels as v, i (i)}
        <li class="chan" style="--c: {channelColor(i)}">
          {#if i === 0}
            <span class="chan-dot"></span>
            <span class="chan-name">GND</span>
          {:else}
            <input
              type="checkbox"
              class="chan-vis"
              style="accent-color: {channelColor(i)}"
              checked={nodeVisible[i] ?? true}
              onchange={(e) => toggleNode(i, e.currentTarget.checked)}
              title="Show this node on the scope"
            />
            <input
              class="chan-rename mono"
              value={nodeNames[i] ?? ""}
              placeholder={channelLabel(i)}
              oninput={(e) => renameNode(i, e.currentTarget.value)}
              aria-label="Rename {channelLabel(i)}"
            />
          {/if}
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
    <span class="scrub-read mono">
      t {tick} / {liveTick} · {fmtTime(simSeconds)}
    </span>
  </div>

  <div class="speed">
    <span class="speed-label">Rate</span>
    {#each RATES as s (s)}
      <button
        class="btn btn-ghost {tps === s ? 'is-active' : ''}"
        onclick={() => setRate(s)}
        disabled={!ready}
        title={fmtRate(s) + " — " + fmtRealtime(s)}
      >
        {fmtRate(s)}
      </button>
    {/each}
    <input
      class="rate-custom mono"
      type="number"
      min="1"
      max="2000000"
      step="1"
      value={tps}
      onchange={(e) =>
        setRate(Math.max(1, Math.round(Number(e.currentTarget.value)) || 1))}
      disabled={!ready}
      title="Custom ticks per second"
      aria-label="Custom ticks per second"
    />
    <span class="speed-unit">t/s</span>
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
  /* Voltmeter / ammeter function toggle, shown while measuring. */
  .meter-toggle {
    display: inline-flex;
    gap: 4px;
  }
  .meter-toggle .btn {
    min-width: 30px;
    padding: 6px 9px;
  }
  /* Custom ticks-per-second entry next to the rate presets. */
  .rate-custom {
    width: 76px;
    font-size: 11px;
    padding: 5px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--surface);
    color: var(--text);
  }
  .rate-custom:focus {
    outline: none;
    border-color: var(--accent-line);
  }
  .speed-unit {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--faint);
  }
  /* The armed-part chip: shows what a board click will drop, with an × to disarm. */
  .armed-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 4px 3px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--accent);
    border: 1px solid var(--accent-line);
    border-radius: 3px;
    background: var(--accent-soft);
  }
  .armed-x {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--surface);
    color: var(--dim);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }
  .armed-x:hover {
    color: var(--text);
    border-color: var(--accent);
  }

  /* Telemetry node controls: per-node scope visibility + rename, scope sizer. */
  .nodes-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .scope-expand {
    font-size: 10px;
    padding: 3px 8px;
  }
  .chan-vis {
    grid-row: 1 / 3;
    width: 13px;
    height: 13px;
    margin: 0;
    cursor: pointer;
  }
  .chan-rename {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--text);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 2px 5px;
    min-width: 0;
    width: 100%;
  }
  .chan-rename::placeholder {
    color: var(--dim);
    letter-spacing: 0.12em;
  }
  .chan-rename:hover {
    border-color: var(--border);
  }
  .chan-rename:focus {
    outline: none;
    border-color: var(--accent-line);
    background: var(--surface);
  }

  /* Value picker: a floating popover anchored above the selected part. */
  .value-pop {
    position: absolute;
    z-index: 5;
    width: 320px;
    padding: 12px 13px;
    border: 1px solid var(--border-bright);
    border-radius: 5px;
    background: oklch(0.165 0.028 285 / 0.96);
    box-shadow: 0 12px 34px -12px #000;
    backdrop-filter: blur(4px);
  }
  /* Live "V across · I through" readout, restored at the top of the picker. */
  .insp-meter {
    font-size: 12.5px;
    color: var(--ok);
    margin-bottom: 8px;
  }
  .value-pop-caret {
    position: absolute;
    width: 10px;
    height: 10px;
    transform: translateX(-50%) rotate(45deg);
    background: oklch(0.165 0.028 285 / 0.96);
    border: 1px solid var(--border-bright);
  }
  .value-pop.above .value-pop-caret {
    bottom: -6px;
    border-top: none;
    border-left: none;
  }
  .value-pop.below .value-pop-caret {
    top: -6px;
    border-bottom: none;
    border-right: none;
  }
  .insp-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .insp-kind {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.04em;
    color: var(--text);
  }
  .insp-val {
    font-size: 14px;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .insp-row {
    display: flex;
    align-items: stretch;
    gap: 6px;
  }
  .insp-step {
    padding: 2px 9px;
    font-size: 15px;
    line-height: 1;
  }
  .insp-chips {
    display: flex;
    gap: 5px;
    flex: 1;
    flex-wrap: wrap;
  }
  .insp-chips.wrap {
    flex-wrap: wrap;
    overflow-y: auto;
    max-height: 168px;
    margin-bottom: 4px;
  }
  .chip-val {
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: nowrap;
    padding: 5px 9px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--surface);
    color: var(--dim);
    cursor: pointer;
  }
  .chip-val.sm {
    font-size: 11px;
    padding: 4px 7px;
  }
  .chip-val:hover {
    color: var(--text);
    border-color: var(--dim);
  }
  .chip-val.is-active {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .insp-more {
    margin-top: 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--dim);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 0;
  }
  .insp-more:hover {
    color: var(--text);
  }
  .insp-sub {
    margin-top: 8px;
    margin-bottom: 4px;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--faint);
  }

  /* Component info drawer: the deep explanatory view, right side over the board. */
  .info-drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 340px;
    max-width: 72%;
    display: flex;
    flex-direction: column;
    background: oklch(0.155 0.026 285 / 0.97);
    border-left: 1px solid var(--border-bright);
    box-shadow: -14px 0 40px -18px #000;
    backdrop-filter: blur(5px);
    z-index: 6;
  }
  .info-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  .info-title {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 16px;
    letter-spacing: 0.04em;
    color: var(--text);
  }
  .info-tabs {
    display: flex;
    gap: 6px;
    padding: 10px 14px 0;
  }
  .info-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
  }
  .info-diagram {
    height: 170px;
    border: 1px solid var(--border);
    border-radius: 5px;
    overflow: hidden;
    margin-bottom: 12px;
    background: #120f1c;
  }
  .info-diagram canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .info-eq {
    font-size: 15px;
    color: var(--accent);
    margin-bottom: 4px;
  }
  .info-sub {
    font-size: 13px;
    color: var(--text);
    margin-bottom: 10px;
  }
  /* "Right now" section: all the live numbers grouped together so the static
     explanation above never reflows as the readings change. */
  .info-live {
    margin-bottom: 12px;
    padding: 8px 11px 5px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
  }
  .info-live-head {
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 10.5px;
    color: var(--faint);
    margin-bottom: 7px;
  }
  .info-live .info-sub {
    margin-bottom: 8px;
  }
  .info-plain {
    margin: 0 0 12px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--dim);
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 0;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--faint);
  }
  .info-row .mono {
    color: var(--text);
  }
  .info-empty {
    font-size: 13px;
    line-height: 1.55;
    color: var(--dim);
  }
  /* Always-on explainer for the two belt layers (carriers vs energy). */
  .belt-note {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .belt-title {
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 12px;
    color: var(--text);
    margin: 0 0 8px;
  }
  .belt-legend {
    display: flex;
    gap: 16px;
    margin-bottom: 10px;
  }
  .belt-key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--faint);
  }
  .belt-carrier {
    color: var(--cyan);
    font-size: 16px;
    line-height: 1;
  }
  .belt-energy {
    color: var(--energy);
    font-size: 12px;
    line-height: 1;
  }
  .belt-note .info-plain:last-child {
    margin-bottom: 0;
  }
  .calc-card {
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    padding: 10px 11px;
    margin-bottom: 10px;
  }
  .calc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .calc-name {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
  }
  .calc-fill {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--accent);
    background: none;
    border: 1px solid var(--accent-line);
    border-radius: 3px;
    padding: 2px 6px;
    cursor: pointer;
  }
  .calc-fields {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
  }
  .calc-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .calc-flabel {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--faint);
  }
  .calc-input {
    width: 84px;
    font-size: 12px;
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text);
  }
  .calc-worked {
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--ok);
    word-break: break-word;
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
  /* Collapsible example categories. */
  .example-cat {
    border-bottom: 1px solid var(--border);
  }
  .example-cat-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    cursor: pointer;
    list-style: none;
    user-select: none;
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--dim);
  }
  .example-cat-head::-webkit-details-marker {
    display: none;
  }
  .example-cat-head::before {
    content: "▸";
    font-size: 10px;
    color: var(--faint);
    transition: transform 0.15s var(--ease);
  }
  .example-cat[open] > .example-cat-head {
    color: var(--accent);
  }
  .example-cat[open] > .example-cat-head::before {
    transform: rotate(90deg);
  }
  .example-cat-name {
    flex: 1;
  }
  .example-cat-count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--faint);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 1px 7px;
  }
  .example-list {
    list-style: none;
    margin: 0;
    padding: 0 10px 12px;
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
  /* Incomplete-circuit warning: an amber bar, top-centre over the board. */
  .circuit-warn {
    position: absolute;
    top: 44px;
    left: 50%;
    transform: translateX(-50%);
    max-width: 70%;
    padding: 7px 13px;
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--warn);
    background: oklch(0.165 0.028 285 / 0.94);
    border: 1px solid var(--warn);
    border-radius: 4px;
    box-shadow: 0 0 18px -8px var(--warn);
    backdrop-filter: blur(3px);
    z-index: 4;
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

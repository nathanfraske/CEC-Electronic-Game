<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { Application } from "pixi.js";
  import {
    createSimulation,
    runLoop,
    DT_SECONDS,
    type Snapshot,
    type SubFrameSample,
    type PlaybackControls,
  } from "./sim/loop";
  import {
    Board,
    type Mode,
    type SelectedPart,
    type AnchorRect,
  } from "./lib/board";
  import {
    BoardGraph,
    formatValue,
    PART_KINDS,
    AC_DEFAULT_AMP,
    type GraphSnapshot,
  } from "./lib/graph";
  import {
    hasValue,
    isESeries,
    chipsOf,
    decadesOf,
    significandsOf,
    standardValues,
    stepValue,
    nearestStandard,
    acAmpChips,
    stepAmp,
    AC_MAINS_PRESETS,
  } from "./lib/values";
  import { LOGIC_FAMILIES, familyLevels } from "./lib/families";
  import {
    EXAMPLES,
    EXAMPLE_CATEGORIES,
    categoryOf,
    type ExampleSpec,
  } from "./lib/examples";
  import {
    loadBoard,
    makeDebouncedBoardSaver,
    resetAll,
    loadSettings,
    saveSettings,
  } from "./lib/storage";
  import { CONCEPTS, type ConceptCard } from "./lib/concepts";
  import { SvelteSet } from "svelte/reactivity";
  import {
    buildNetlist,
    electricalMap,
    graphShape,
    type BuiltNetlist,
  } from "./lib/netlist";
  import {
    ZERO_ELECTRICAL,
    hasFactory,
    type ElectricalState,
  } from "./lib/glyphs";
  import { pinoutOf } from "./lib/pinout";
  import { hasDetail } from "./lib/detailDrawers";
  import { hasAnalogy } from "./lib/analogyDrawers";
  import { partInfo } from "./lib/partInfo";
  import { CALCS } from "./lib/calc";
  import { InfoDiagram, type DiagramMode } from "./lib/infoDiagram";

  const SEED = 1337;
  // Playback rate options, in **ticks of sim time per real second**. DT is 2 µs,
  // so 500_000 ticks/s = real time (one sim-second per second); the rest run
  // proportionally slower so fast dynamics are watchable.
  // Playback rate in sim-ticks per real second (NOT the fixed physics step DT, which
  // is the determinism contract). The slow end goes to 1 tick/s — one 2 µs step per
  // second, i.e. 500,000× slow motion — so you can watch every detail; the fast end
  // is near/above real time. Slowing down never changes the physics, only the pace.
  const RATES = [1, 5, 50, 500, 5000, 50000, 500000];
  const fmtRate = (n: number): string =>
    n >= 1000 ? n / 1000 + "k/s" : n + "/s";
  // Friendly "how fast you're watching" label: slow-mo factor when below real time,
  // a "× real time" multiple at/above it.
  const fmtRealtime = (rate: number): string => {
    const f = rate * DT_SECONDS; // sim-seconds advanced per real second
    if (f >= 1) return `${f % 1 === 0 ? f : f.toFixed(1)}× real time`;
    return `${Math.round(1 / f).toLocaleString()}× slow-mo`;
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
      tag: "EC",
      name: "Electrolytic Cap",
      desc: "Bulk storage + ESR",
      tier: "II",
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
      tag: "TR",
      name: "Transformer",
      desc: "Couples AC · set turns ratio",
      tier: "II",
      color: "var(--violet)",
    },
    {
      tag: "POT",
      name: "Potentiometer",
      desc: "Variable divider · slide the wiper",
      tier: "II",
      color: "var(--bronze)",
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
      tag: "SD",
      name: "Schottky Diode",
      desc: "Low ~0.3 V drop",
      tier: "II",
      color: "var(--cyan)",
    },
    {
      tag: "LED",
      name: "LED",
      desc: "Lights with current",
      tier: "II",
      color: "var(--accent)",
    },
    {
      tag: "ZD",
      name: "Zener Diode",
      desc: "Clamps at Vz (reverse)",
      tier: "II",
      color: "var(--bronze)",
    },
    {
      tag: "MOV",
      name: "Varistor",
      desc: "Clamps spikes at ±Vc",
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
      tag: "MSW",
      name: "Manual Switch",
      desc: "Click to open / close",
      tier: "II",
      color: "var(--violet)",
    },
    {
      tag: "NM",
      name: "N-MOSFET",
      desc: "Gate controls Id",
      tier: "II",
      color: "var(--ok)",
    },
    {
      tag: "PM",
      name: "P-MOSFET",
      desc: "High-side switch",
      tier: "II",
      color: "var(--ok)",
    },
    {
      tag: "Q",
      name: "NPN Transistor",
      desc: "Ib controls Ic (β≈100)",
      tier: "II",
      color: "var(--accent)",
    },
    {
      tag: "QP",
      name: "PNP Transistor",
      desc: "High-side current gain",
      tier: "II",
      color: "var(--accent)",
    },
    {
      tag: "OA",
      name: "Op-Amp",
      desc: "Huge gain · feedback or compare",
      tier: "II",
      color: "var(--cyan)",
    },
    {
      tag: "AND",
      name: "AND Gate",
      desc: "High iff both inputs high",
      tier: "II",
      color: "var(--ok)",
    },
    {
      tag: "OR",
      name: "OR Gate",
      desc: "High iff either input high",
      tier: "II",
      color: "var(--ok)",
    },
    {
      tag: "NAND",
      name: "NAND Gate",
      desc: "AND inverted · universal",
      tier: "II",
      color: "var(--ok)",
    },
    {
      tag: "NOR",
      name: "NOR Gate",
      desc: "OR inverted · universal",
      tier: "II",
      color: "var(--ok)",
    },
    {
      tag: "XOR",
      name: "XOR Gate",
      desc: "High iff inputs differ",
      tier: "II",
      color: "var(--ok)",
    },
    {
      tag: "XNOR",
      name: "XNOR Gate",
      desc: "High iff inputs match",
      tier: "II",
      color: "var(--ok)",
    },
    {
      tag: "NOT",
      name: "NOT Gate",
      desc: "Inverter · flips the input",
      tier: "II",
      color: "var(--ok)",
    },
    {
      tag: "BUF",
      name: "Buffer",
      desc: "Non-inverting line driver",
      tier: "II",
      color: "var(--ok)",
    },
    {
      tag: "FF",
      name: "D Flip-Flop",
      desc: "Latches D on the clock edge",
      tier: "II",
      color: "var(--cyan)",
    },
    {
      tag: "LS",
      name: "Level Shifter",
      desc: "Translates rail A → rail B",
      tier: "II",
      color: "var(--ok)",
    },
    {
      tag: "PU",
      name: "Pull-up",
      desc: "Resistor to Vcc · open-drain bus",
      tier: "II",
      color: "var(--bronze)",
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

  // Parts bin folders. The order here is the display order; every part maps to
  // exactly one category via its tag, so the bin stays organised (and searchable)
  // as the catalogue grows.
  const PART_CATEGORIES = [
    "Sources",
    "Passives",
    "Diodes",
    "Protection",
    "Active & Switching",
    "Logic & ICs",
  ];
  const PART_CAT_OF: Record<string, string> = {
    V: "Sources",
    AC: "Sources",
    I: "Sources",
    GND: "Sources",
    R: "Passives",
    C: "Passives",
    EC: "Passives",
    L: "Passives",
    TR: "Passives",
    POT: "Passives",
    D: "Diodes",
    SD: "Diodes",
    LED: "Diodes",
    ZD: "Diodes",
    MOV: "Protection",
    SW: "Active & Switching",
    MSW: "Active & Switching",
    NM: "Active & Switching",
    PM: "Active & Switching",
    Q: "Active & Switching",
    QP: "Active & Switching",
    OA: "Active & Switching",
    AND: "Logic & ICs",
    OR: "Logic & ICs",
    NAND: "Logic & ICs",
    NOR: "Logic & ICs",
    XOR: "Logic & ICs",
    XNOR: "Logic & ICs",
    NOT: "Logic & ICs",
    BUF: "Logic & ICs",
    FF: "Logic & ICs",
    LS: "Logic & ICs",
    PU: "Logic & ICs",
    FP: "Logic & ICs",
    uC: "Logic & ICs",
  };

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
  // The board's detail lens (the owner's three tiers): schematic symbols always; in
  // analogy/reality a part morphs into its full-panel illustration once zoomed in.
  let boardLens = $state<DiagramMode>("schematic");
  // Fallback kind for native drag-and-drop from the bin (set on dragstart).
  let dragKind = "V";
  let leftTab = $state<"parts" | "examples">("parts");
  let partSearch = $state("");
  // Save / load: a transient status line + the hidden file picker for Load.
  let ioMsg = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement>();
  let buildEx = $state<ExampleSpec | null>(null);
  let buildStep = $state(0);
  let buildDone = $state(false);
  let buildTarget = "";
  let demo = $state<{ label: string; on: string; off: string } | null>(null);
  let demoOn = $state(true);
  let demoExRef: ExampleSpec | null = null;
  let showIntro = $state(true);
  // --- Onboarding: pull-based, no levels (docs/ui/onboarding-first-run.md §10). The
  // single preference is `explainAsYouGo` (a mute, not a level); `seenConcepts` records
  // which first-encounter cards have fired so each shows once. Loaded from settings on
  // mount; the help handle can replay them. `concept` is the card on screen now.
  let explainAsYouGo = $state(true);
  const seenConcepts = new SvelteSet<string>();
  let concept = $state<ConceptCard | null>(null);
  let conceptQueue = $state<string[]>([]);
  let helpOpen = $state(false);
  // Derived board facts the concept triggers watch (set in onChange / rebuildNetlist).
  let hasSource = $state(false);
  let hasGround = $state(false);
  let solvable = $state(false);
  let partCount = $state(0);
  let wireCount = $state(0);
  let selCount = $state(0);
  // The lone selected part (for the value inspector) + its "more values" toggle,
  // and its on-screen anchor rect for the floating popover.
  let selPart = $state<SelectedPart | null>(null);
  let showMore = $state(false);
  let anchor = $state<AnchorRect | null>(null);
  // The open net-label name editor: the request from the board (existing label id
  // or null for a new one, the endpoint, the seed text, and the on-canvas rect to
  // anchor the inline input over). Null when no editor is open.
  let labelEdit = $state<{
    id: number | null;
    initial: string;
    rect: AnchorRect;
  } | null>(null);
  let labelEditValue = $state("");
  let labelInput = $state<HTMLInputElement>();
  // Set when the circuit can't actually solve (e.g. a current source with no
  // return path) so the HUD can warn instead of showing a meaningless reading.
  let circuitWarning = $state<string | null>(null);
  // Info drawer: the deep explanatory view of the selected part + calculators.
  let infoOpen = $state(false);
  let infoTab = $state<"info" | "calc">("info");
  let selElectrical = $state<ElectricalState | null>(null);
  let infoDiagram: InfoDiagram | undefined;
  // The diagram picture: the schematic symbol, or the construction-internals
  // ("what's happening inside") view. Defaults to the detail view; the toggle
  // below flips it, and it snaps back to detail when a fresh detail-capable part
  // is selected (see the $effect). Falls back to schematic for kinds with no
  // detail drawer — `diagramHasDetail` gates the toggle's visibility.
  let diagramMode = $state<DiagramMode>("reality");
  // Which tiers the current selection actually has distinct art for (a pure read of
  // the kind). The schematic tier always exists; the others gate their toggle button.
  const diagramHasDetail = $derived(selPart ? hasDetail(selPart.kind) : false);
  // The analogy tier renders the full-panel illustration when one exists, else the
  // board's Factory glyph — so it's available when EITHER is present.
  const diagramHasFactory = $derived(
    selPart ? hasFactory(selPart.kind) || hasAnalogy(selPart.kind) : false,
  );
  // The tier the diagram should actually render in: the user's choice when that
  // tier's art exists, else clamped outward to schematic so nothing is ever blank.
  const effectiveDiagramMode = $derived<DiagramMode>(
    diagramMode === "reality" && !diagramHasDetail
      ? "schematic"
      : diagramMode === "analogy" && !diagramHasFactory
        ? "schematic"
        : diagramMode,
  );
  // Selecting a different part defaults the view to its reality internals when it has
  // them — so double-clicking an op-amp opens straight to "what's happening inside."
  $effect(() => {
    const kind = selPart?.kind;
    // Default the info diagram to the board's active lens on each new selection
    // (still freely toggleable after). The lens is read untracked so changing the
    // board lens alone doesn't yank a manually-chosen info tab; effectiveDiagramMode
    // clamps outward to schematic when that tier's art doesn't exist for the kind.
    if (kind) diagramMode = untrack(() => boardLens);
  });

  /** Persist just the onboarding slice of settings (mute + which cards have fired). */
  function persistSettings(): void {
    saveSettings({
      v: 1,
      seenIntro: !showIntro,
      explainAsYouGo,
      seenConcepts: [...seenConcepts],
    });
  }
  /** Offer a first-encounter concept card (deduped): ignored when muted or already
   * seen/queued; otherwise it joins the queue and is shown one at a time. */
  function offerConcept(id: string): void {
    if (!explainAsYouGo) return;
    // Don't compete with the cold-open intro; the as-you-go cards begin once it's
    // dismissed (i.e. the player has engaged), then follow what they do.
    if (showIntro) return;
    if (
      seenConcepts.has(id) ||
      conceptQueue.includes(id) ||
      concept?.id === id
    ) {
      return;
    }
    if (!CONCEPTS[id]) return;
    conceptQueue = [...conceptQueue, id];
    pumpConcepts();
  }
  /** Show the next queued card if none is up; marks it seen (so it fires once). */
  function pumpConcepts(): void {
    if (concept || conceptQueue.length === 0) return;
    const [next, ...rest] = conceptQueue;
    conceptQueue = rest;
    concept = CONCEPTS[next!] ?? null;
    if (concept) {
      seenConcepts.add(concept.id);
      persistSettings();
    }
  }
  function dismissConcept(): void {
    concept = null;
    pumpConcepts();
  }
  /** The mute. Off silences the as-you-go cards (and clears the queue); on re-enables. */
  function setExplain(on: boolean): void {
    explainAsYouGo = on;
    if (!on) {
      conceptQueue = [];
      concept = null;
    }
    persistSettings();
  }
  /** Replay: forget which cards have fired so they offer again as you explore. */
  function replayConcepts(): void {
    seenConcepts.clear();
    conceptQueue = [];
    concept = null;
    helpOpen = false;
    persistSettings();
  }

  // First-encounter triggers — each fires its card the first moment the board can
  // show it true: a source placed, a ground placed, a live complete loop, a part read.
  $effect(() => {
    if (hasSource) offerConcept("source");
  });
  $effect(() => {
    if (hasGround) offerConcept("ground");
  });
  $effect(() => {
    if (running && solvable && hasSource) offerConcept("loop");
  });
  $effect(() => {
    if (selPart && solvable) offerConcept("reading");
  });
  // Persist "intro seen" the first time the cold-open banner is dismissed (by any
  // path), so it doesn't reappear every refresh.
  let introPersisted = false;
  $effect(() => {
    if (!showIntro && !introPersisted) {
      introPersisted = true;
      persistSettings();
    }
  });

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
  // Net-label names per node (node index → name, e.g. 3 → "VCC") from the netlist,
  // shown as the node's name in the telemetry list when it has no manual rename.
  let netNames = $state<Record<number, string>>({});

  let board: Board | undefined;
  let controls: PlaybackControls | undefined;
  // Persist the board to localStorage a beat after edits settle, so a refresh keeps
  // your circuit (see lib/storage.ts). Debounced so a drag doesn't thrash storage.
  const saveBoardDebounced = makeDebouncedBoardSaver();

  // A node's default display name: its net-label name (e.g. "VCC") when it has
  // one, else GND for node 0 / "Node i". A manual rename in the telemetry list
  // still overrides this (it's the input's value; this is only the placeholder).
  const channelLabel = (i: number): string =>
    netNames[i] ?? (i === 0 ? "GND" : `Node ${i}`);
  // Node colours must match the scope, which colours node c by index (c−1) and
  // leaves ground (node 0) out. So ground gets a muted reference colour and the
  // cycling palette starts at node 1 — node N is then the same colour in both.
  const channelColor = (i: number): string =>
    i === 0
      ? "var(--dim)"
      : (CHANNEL_COLORS[(i - 1) % CHANNEL_COLORS.length] ?? "var(--accent)");
  const partName = (tag: string): string =>
    PARTS.find((p) => p.tag === tag)?.name ?? tag;

  // One-line contextual hint that replaces the old mode buttons: it tells you
  // what a click will do right now, so the modeless board stays learnable.
  const hint = $derived(
    mode === "pan"
      ? "PAN · drag anywhere to move around the board · pick a tool (B/W/M/J/L) to build · Esc returns here"
      : mode === "measure"
        ? probeMode === "A"
          ? "AMMETER · click a part/wire to clamp it and read the current through it (the voltmeter stays put — both can be live)"
          : "VOLTMETER · click two points to read ΔV (one point = vs GND) · the ammeter stays put alongside it"
        : mode === "junction"
          ? "JUNCTION · click a wire to drop a junction · double-click a junction to drag it"
          : mode === "label"
            ? "LABEL · click a pin, junction, or trace to name its net · same name elsewhere = same net (no wire) · right-click a tag to delete"
            : armedPart
              ? `PLACING ${partName(armedPart)} · click to drop · R to rotate · Esc to cancel`
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
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
        board?.copySelection(); // copy the selected fragment to the clipboard
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "x" || e.key === "X")) {
        board?.cutSelection(); // cut = copy + delete
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
        board?.paste(); // paste with fresh ids, offset, and re-selected
        e.preventDefault();
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "r" || e.key === "R")) {
        // R rotates, in priority: a floating paste group, then the armed-part ghost,
        // else the current selection — so it never rotates a leftover selection out
        // from under you while you're placing a paste or lining up a new part.
        if (board?.rotatePaste()) {
          // handled the floating paste
        } else if (armedPart) board?.rotateArmed();
        else board?.rotateSelection();
        e.preventDefault();
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "b" || e.key === "B")) {
        enterBuild(); // b = Build (place + select)
        e.preventDefault();
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "w" || e.key === "W")) {
        enterWire(); // w = Wire
        e.preventDefault();
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "j" || e.key === "J")) {
        enterJunction(); // j = Junction (tap a wire to drop a junction)
        e.preventDefault();
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "l" || e.key === "L")) {
        enterLabel(); // l = Label (name a net / alias by name)
        e.preventDefault();
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "m" || e.key === "M")) {
        enterMeasure(); // m = Measure
        e.preventDefault();
      } else if (e.key === "Escape") {
        // Universal cancel, in order of least-destructive first: a first Esc just
        // closes the open info drawer (without dropping your armed part or
        // selection). Otherwise it disarms a part, cancels any in-progress wire /
        // open label editor / selection, then switches to the neutral Pan tool so
        // Escape always leaves you in a safe "just navigate" state.
        if (infoOpen) {
          infoOpen = false;
        } else {
          if (armedPart) arm(null);
          board?.escape();
          setMode("pan");
        }
        e.preventDefault();
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "h" || e.key === "H")) {
        setMode("pan"); // H = the hand / pan tool
        e.preventDefault();
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "i" || e.key === "I")) {
        infoOpen = !infoOpen; // I = toggle the deep info panel for the selection
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
        // Onboarding: a non-null netlist means the circuit forms a solvable loop —
        // the trigger for the "a circuit is a loop" / "reading a part" concept cards.
        solvable = nl !== null;
        circuitWarning =
          nl && nl.floatingSources.length > 0
            ? "A current source has no return path — its current can't flow, so this reading isn't meaningful. Complete the loop back to the source."
            : null;
        const sig = nl ? nl.sig : graph.components.size > 0 ? "empty" : "demo";
        if (sig === netlistSig) return;
        netlistSig = sig;
        netlist = nl;
        // The circuit actually changed (an example loaded, the board cleared, or a
        // value/topology edit — never a pure move, which leaves the sig unchanged).
        // Drop the scope's old samples so the trace resets immediately instead of
        // showing stale data from the previous circuit until the run catches up.
        board?.clearScope();
        board?.setProbeNodes(nl ? nl.nodesOfComponent : null);
        // Surface the net-label names (node index → name) so the scope legend and
        // the telemetry "Nodes" list can show `VCC` instead of `Node 3`.
        board?.setNetNames(nl ? nl.nodeNames : null);
        netNames = nl ? Object.fromEntries(nl.nodeNames) : {};
        if (nl) {
          // Pass the control-terminal array `c` (MOSFET gate / gate IN2; 0 for 2-pin
          // parts), the second scalar `aux` (AC amplitude / gate function code), and
          // the fourth terminal `d` (a transformer's secondary− node; 0 elsewhere).
          // setNetlist takes c, aux, and d as trailing optionals.
          sim.setNetlist(
            nl.nodeCount,
            nl.types,
            nl.a,
            nl.b,
            nl.values,
            nl.c,
            nl.aux,
            nl.d,
          );
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
          // Onboarding facts: has the player placed a source / a ground yet? (Drives
          // the first-encounter concept cards via their $effect triggers.)
          let src = false;
          let gnd = false;
          for (const c of graph.components.values()) {
            if (c.kind === "V" || c.kind === "AC" || c.kind === "I") src = true;
            else if (c.kind === "GND") gnd = true;
          }
          hasSource = src;
          hasGround = gnd;
          rebuildNetlist(graph);
          advanceBuild(graph);
          // Persist the current board so a refresh restores it (debounced).
          saveBoardDebounced(graph.serialize());
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
        onMode: (m) => {
          // The board switched its own tool (Pan yields to Build when you grab a
          // part/wire) — mirror it so the toolbar selector follows.
          mode = m;
        },
        onPersist: (graph) => {
          // A cosmetic change (e.g. a net label dragged): save it + refresh undo,
          // but don't rebuild the netlist or rewind the running sim.
          canUndo = b.canUndo();
          saveBoardDebounced(graph.serialize());
        },
        onAnchor: (rect) => {
          anchor = rect;
        },
        onInspect: () => {
          // Double-click on a part: the board already made it the lone selection
          // (onSelect fired first). Open the deep info drawer on the board's active
          // lens (effectiveDiagramMode clamps to schematic if that tier is absent).
          infoOpen = true;
          if (selPart) diagramMode = boardLens;
        },
        onLabelEdit: (req) => {
          if (req) {
            labelEdit = { id: req.id, initial: req.initial, rect: req.rect };
            labelEditValue = req.initial;
            // Focus + select the input next tick, once it has rendered.
            setTimeout(() => labelInput?.focus(), 0);
          } else {
            labelEdit = null;
          }
        },
      });
      board = b;
      b.setMode(mode);
      ready = true;

      // Paused by default: the player presses Run, or steps tick by tick.
      controls = runLoop(
        sim,
        (snap: Snapshot, scopeBatch?: SubFrameSample[]) => {
          // Attribute per-element current and per-net voltage to each component
          // so the glyphs animate with what is actually happening to them.
          const electrical: Map<number, ElectricalState> | undefined =
            netlist && snap.elementCurrents
              ? electricalMap(
                  netlist,
                  snap.state,
                  snap.elementCurrents,
                  snap.failedMask,
                )
              : undefined;
          b.update(
            snap,
            electrical,
            controls?.isRunning() ?? false,
            scopeBatch,
          );
          if (selPart) {
            const e = electrical?.get(selPart.id) ?? ZERO_ELECTRICAL;
            selElectrical = e;
            if (infoOpen) {
              // Keep the picture (symbol vs internals) and the live state current
              // every frame, so a mode flip or a re-mounted canvas is always right.
              // Share the board's flow clock so the internals pause/flow with time.
              infoDiagram?.setMode(effectiveDiagramMode);
              infoDiagram?.setPhase(b.flowPhase());
              infoDiagram?.setState(
                selPart.kind,
                e,
                selPart.value,
                selPart.wiper,
              );
            }
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

      // Restore the last saved board across refreshes; only fall back to the primer
      // for a genuine first visit (no saved board). A saved-but-empty board still
      // counts as the player's (they cleared it on purpose).
      // Restore onboarding preferences: the explain-as-you-go mute and which concept
      // cards have already fired (so each shows once across refreshes), plus whether
      // the cold-open intro has been seen.
      const settings = loadSettings();
      explainAsYouGo = settings.explainAsYouGo ?? true;
      seenConcepts.clear();
      for (const id of settings.seenConcepts ?? []) seenConcepts.add(id);
      showIntro = !settings.seenIntro;

      const saved = loadBoard();
      if (saved) {
        board.loadGraph(saved);
        controls?.pause();
        syncRunning();
      } else {
        // Open with the primer so the very first thing you see is current flowing
        // through a voltage-coloured wire — a demonstration of the two primitives.
        const primer = EXAMPLES.find((e) => e.id === "primer");
        if (primer) loadExample(primer);
      }
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
    // Manual switch: its value is a state, not a quantity — show it as a word.
    if (kind === "MSW") return value >= 0.5 ? "Closed" : "Open";
    // Transformer: its value is the turns ratio n = Ns/Np; show it as Np:Ns (so a
    // step-up n = 2 reads "1:2" and a step-down n = 0.5 reads "2:1").
    if (kind === "TR") {
      const trim = (x: number): string =>
        (Number.isInteger(x) ? x.toString() : x.toFixed(2)).replace(
          /\.?0+$/,
          "",
        );
      return value >= 1 ? "1:" + trim(value) : trim(1 / value) + ":1";
    }
    const u = PART_KINDS[kind]?.unit ?? "";
    return u ? formatValue(value, u) : String(value);
  }
  function setVal(v: number): void {
    if (selPart) board?.setComponentValue(selPart.id, v);
  }
  function setLabelText(t: string): void {
    if (selPart) board?.setComponentLabel(selPart.id, t);
  }
  function stepVal(dir: number): void {
    if (selPart) setVal(stepValue(selPart.kind, selPart.value, dir));
  }
  // The AC source's amplitude (its second scalar): the displayed value defaults
  // to 5 V when a source carries none, mirroring the frequency chips above.
  function selAmp(): number {
    return selPart?.amp ?? AC_DEFAULT_AMP;
  }
  function setAmp(v: number): void {
    if (selPart) board?.setComponentAmp(selPart.id, v);
  }
  function stepAmpVal(dir: number): void {
    if (selPart) setAmp(stepAmp(selAmp(), dir));
  }
  // Logic family of a digital part (gate or flip-flop): a third descriptor beside
  // `value` (the rail). Indexes LOGIC_FAMILIES; 0 = Ideal (the default).
  const DIGITAL_KINDS = new Set([
    "AND",
    "OR",
    "NAND",
    "NOR",
    "XOR",
    "XNOR",
    "NOT",
    "BUF",
    "FF",
  ]);
  function isDigitalPart(kind: string): boolean {
    return DIGITAL_KINDS.has(kind);
  }
  function selFamily(): number {
    return selPart?.family ?? 0;
  }
  function setFamily(idx: number): void {
    if (selPart) board?.setComponentFamily(selPart.id, idx);
  }
  // A logic gate's output mode: push-pull (drives both rails) vs open-drain (pulls low,
  // releases high — needs an external pull-up). The D flip-flop is always push-pull.
  function isGatePart(kind: string): boolean {
    return isDigitalPart(kind) && kind !== "FF";
  }
  function selOpenDrain(): boolean {
    return selPart?.openDrain ?? false;
  }
  function setOpenDrain(v: boolean): void {
    if (selPart) board?.setComponentOpenDrain(selPart.id, v);
  }
  // The potentiometer's wiper position (its second scalar): 0..1, centred by
  // default. Presented as a continuous slider that sets the exact position.
  function selWiper(): number {
    return selPart?.wiper ?? 0.5;
  }
  // A slider drag is a single undo step: record undo on the first move of a drag,
  // then update live (no undo) for the rest; `endWiperDrag` re-arms it on release.
  let wiperDragging = false;
  function setWiper(v: number): void {
    if (!selPart) return;
    board?.setComponentWiper(selPart.id, v, !wiperDragging);
    wiperDragging = true;
  }
  function endWiperDrag(): void {
    wiperDragging = false;
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
  // Arm / disarm a part for placement. Arming while in a non-placing tool
  // (Measure / Junction) drops you back into Build so the click actually places.
  function arm(tag: string | null): void {
    armedPart = tag;
    // Arming a part is an intent to build, so leave any non-building tool —
    // including the neutral pan (Esc) default — and drop into select so the very
    // next click drops the part.
    if (
      tag &&
      (mode === "measure" ||
        mode === "junction" ||
        mode === "label" ||
        mode === "pan")
    )
      setMode("select");
    board?.setArmed(tag);
  }
  function toggleArm(tag: string): void {
    arm(armedPart === tag ? null : tag);
  }
  function enterBuild(): void {
    setMode("select");
  }
  function enterWire(): void {
    arm(null);
    setMode("wire");
  }
  function enterJunction(): void {
    arm(null);
    setMode("junction");
  }
  function enterLabel(): void {
    arm(null);
    setMode("label");
  }
  function enterMeasure(): void {
    arm(null);
    setMode("measure");
  }
  function enterPan(): void {
    arm(null);
    setMode("pan");
  }
  function setProbeMode(m: "V" | "A"): void {
    probeMode = m;
    board?.setProbeMode(m);
  }
  // Cycle the board lens schematic → analogy → reality → schematic. Analogy/reality
  // reveal their full-panel illustration once a part is zoomed in (see Board.setLens).
  function cycleLens(): void {
    boardLens =
      boardLens === "schematic"
        ? "analogy"
        : boardLens === "analogy"
          ? "reality"
          : "schematic";
    board?.setLens(boardLens);
  }
  function clearBoard(): void {
    board?.clear();
    demo = null;
    showIntro = false;
  }
  function flashIo(msg: string): void {
    ioMsg = msg;
    setTimeout(() => {
      if (ioMsg === msg) ioMsg = null;
    }, 3500);
  }
  // Save the board to a downloaded JSON file. Wrapped in a small versioned
  // envelope so a future format change can migrate old saves (the graph snapshot
  // itself already tolerates legacy shapes on restore). Nothing is sent anywhere.
  function saveCircuit(): void {
    const graph = board?.serialize();
    if (!graph) return;
    const payload = {
      format: "cec-circuit",
      version: 1,
      savedAt: new Date().toISOString(),
      graph,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      "cec-circuit-" +
      new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") +
      ".json";
    a.click();
    URL.revokeObjectURL(url);
    flashIo("Circuit downloaded.");
  }
  function triggerLoad(): void {
    fileInput?.click();
  }
  // Load a circuit from a user-chosen file. Accepts our envelope or a bare
  // snapshot, validates the shape, and fails safe with a message on bad input.
  function onLoadFile(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // allow re-picking the same file later
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as {
          format?: string;
          graph?: unknown;
        };
        const graph =
          parsed && parsed.format === "cec-circuit" ? parsed.graph : parsed;
        if (!graph || typeof graph !== "object" || !("components" in graph)) {
          throw new Error("not a circuit");
        }
        board?.loadGraph(graph as GraphSnapshot);
        demo = null;
        showIntro = false;
        flashIo("Circuit loaded.");
      } catch {
        flashIo("Couldn't load that file — it isn't a valid circuit save.");
      }
    };
    reader.readAsText(file);
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
  let scopeSpan = $state("480 µs");
  function cycleSpan(): void {
    scopeSpan = board?.cycleScopeSpan() ?? scopeSpan;
  }
  function toggleNode(i: number, visible: boolean): void {
    nodeVisible[i] = visible;
    board?.setNodeHidden(i, !visible);
  }
  function renameNode(i: number, name: string): void {
    nodeNames[i] = name;
    board?.setNodeLabel(i, name);
  }
  // --- net-label inline editor (Label tool) ---
  function commitLabelEdit(): void {
    if (!labelEdit) return;
    board?.commitLabel(labelEditValue);
    labelEdit = null;
  }
  function cancelLabelEdit(): void {
    if (!labelEdit) return;
    board?.cancelLabelEdit();
    labelEdit = null;
  }
  function onLabelKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      commitLabelEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelLabelEdit();
    }
    // Swallow other keys so the board hotkeys (b/w/j/l/m, Delete, …) don't fire
    // while typing a name. The global onKey already ignores INPUT targets, but
    // stopping propagation here keeps it robust.
    e.stopPropagation();
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
  // Wipe the saved board + all progress and reload to a clean first-run (for testing,
  // and for anyone who wants a fresh start). Confirmed so it can't nuke a built board
  // by accident.
  function resetProgress(): void {
    if (
      !confirm(
        "Reset the board and all saved progress? This clears your circuit and starts fresh.",
      )
    ) {
      return;
    }
    resetAll();
    location.reload();
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
    <button
      class="chip chip-reset"
      onclick={resetProgress}
      title="Reset the saved board and all progress (starts fresh)"
    >
      ↺ Reset
    </button>
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
      {#snippet partRow(part: (typeof PARTS)[number])}
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
      {/snippet}
      <p class="panel-note">
        Click a part to arm it, then click the board to drop (Esc to disarm) —
        or drag it on. Scroll to zoom, drag empty space to pan.
      </p>
      <input
        class="part-search"
        type="search"
        placeholder="Search parts…"
        bind:value={partSearch}
        aria-label="Search parts"
      />
      {#if partSearch.trim()}
        {@const q = partSearch.trim().toLowerCase()}
        {@const hits = PARTS.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.tag.toLowerCase().includes(q) ||
            p.desc.toLowerCase().includes(q),
        )}
        {#if hits.length > 0}
          <ul class="part-list scroll">
            {#each hits as part (part.name)}
              {@render partRow(part)}
            {/each}
          </ul>
        {:else}
          <p class="part-empty">No parts match “{partSearch}”.</p>
        {/if}
      {:else}
        <div class="part-cats scroll">
          {#each PART_CATEGORIES as cat (cat)}
            {@const items = PARTS.filter((p) => PART_CAT_OF[p.tag] === cat)}
            {#if items.length > 0}
              <details class="part-cat" open>
                <summary class="part-cat-head">
                  <span class="part-cat-name">{cat}</span>
                  <span class="part-cat-count">{items.length}</span>
                </summary>
                <ul class="part-list">
                  {#each items as part (part.name)}
                    {@render partRow(part)}
                  {/each}
                </ul>
              </details>
            {/if}
          {/each}
        </div>
      {/if}
    {:else}
      <p class="panel-note">
        Pick a category and work through it — Watch a circuit run, or Build it
        yourself step by step.
      </p>
      <div class="example-cats scroll">
        {#each EXAMPLE_CATEGORIES as cat (cat)}
          {@const items = EXAMPLES.filter((e) => categoryOf(e.id) === cat)}
          {#if items.length > 0}
            <details class="example-cat">
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
        title="Build: place and arrange parts (B)"
      >
        Build <kbd class="hk">B</kbd>
      </button>
      <button
        class="btn btn-ghost {mode === 'wire' ? 'is-active' : ''}"
        onclick={enterWire}
        disabled={!ready}
        title="Wire: drag pin to pin; end on a trace to drop a junction (W)"
      >
        Wire <kbd class="hk">W</kbd>
      </button>
      <button
        class="btn btn-ghost {mode === 'junction' ? 'is-active' : ''}"
        onclick={enterJunction}
        disabled={!ready}
        title="Junction: click a wire to drop a junction at that point (J)"
      >
        Junction <kbd class="hk">J</kbd>
      </button>
      <button
        class="btn btn-ghost {mode === 'label' ? 'is-active' : ''}"
        onclick={enterLabel}
        disabled={!ready}
        title="Label: click a pin, junction, or trace to name its net — same name elsewhere = same net, no wire (L)"
      >
        Label <kbd class="hk">L</kbd>
      </button>
      <button
        class="btn btn-ghost {mode === 'measure' ? 'is-active' : ''}"
        onclick={enterMeasure}
        disabled={!ready}
        title="Measure: probe voltage between two points, or current through a part (M)"
      >
        Measure <kbd class="hk">M</kbd>
      </button>
      <button
        class="btn btn-ghost {mode === 'pan' ? 'is-active' : ''}"
        onclick={enterPan}
        disabled={!ready}
        title="Pan: drag to move around the board — the neutral tool Esc returns to (H)"
      >
        Pan <kbd class="hk">H</kbd>
      </button>
      {#if mode === "measure"}
        <span class="meter-toggle">
          <button
            class="btn btn-ghost {probeMode === 'V' ? 'is-active' : ''}"
            onclick={() => setProbeMode("V")}
            title="Voltmeter — click two points for ΔV (coexists with the ammeter)"
            >V</button
          >
          <button
            class="btn btn-ghost {probeMode === 'A' ? 'is-active' : ''}"
            onclick={() => setProbeMode("A")}
            title="Ammeter — click a part/wire for the current through it (coexists with the voltmeter)"
            >A</button
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
        class="btn btn-ghost {boardLens !== 'schematic' ? 'is-active' : ''}"
        onclick={cycleLens}
        disabled={!ready}
        title="Board lens: schematic → analogy → reality. Zoom in on a part to see its analogy/reality detail."
      >
        {boardLens === "reality"
          ? "⬡ Reality"
          : boardLens === "analogy"
            ? "◆ Analogy"
            : "⎍ Schematic"}
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
        title="Undo (Ctrl/Cmd+Z)"
      >
        Undo <kbd class="hk">⌘Z</kbd>
      </button>
      <button
        class="btn btn-ghost"
        onclick={deleteSelection}
        disabled={!ready || selCount === 0}
        title="Delete selected (Del)"
      >
        Delete <kbd class="hk">Del</kbd>
      </button>
      <button
        class="btn btn-ghost"
        onclick={rotateSel}
        disabled={!ready || selCount === 0}
        title="Rotate selected (R)"
      >
        Rotate <kbd class="hk">R</kbd>
      </button>
      <button class="btn btn-ghost" onclick={resetView} disabled={!ready}>
        Reset View
      </button>
      <button class="btn btn-ghost" onclick={clearBoard} disabled={!ready}>
        Clear
      </button>
      <button
        class="btn btn-ghost"
        onclick={saveCircuit}
        disabled={!ready}
        title="Download this circuit as a .json file (kept on your device)"
      >
        Save
      </button>
      <button
        class="btn btn-ghost"
        onclick={triggerLoad}
        disabled={!ready}
        title="Load a circuit from a .json file"
      >
        Load
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept="application/json,.json"
        onchange={onLoadFile}
        class="file-hidden"
        aria-hidden="true"
        tabindex="-1"
      />
      {#if ioMsg}<span class="io-msg">{ioMsg}</span>{/if}
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

      {#if labelEdit}
        <input
          bind:this={labelInput}
          class="net-label-input mono"
          style="left: {labelEdit.rect.x}px; top: {labelEdit.rect.y}px;"
          bind:value={labelEditValue}
          placeholder="net name"
          maxlength="24"
          spellcheck="false"
          autocomplete="off"
          onkeydown={onLabelKey}
          onblur={commitLabelEdit}
          aria-label="Net label name"
        />
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

      <!-- First-encounter concept card (pull-based onboarding): a one-clause "what
           you just caused," dismissible, never blocking, muted by Explain-as-I-go. -->
      {#if concept}
        <div class="concept-card" role="status">
          <div class="concept-head">
            <span class="concept-tag">Tip</span>
            <span class="concept-title">{concept.title}</span>
            <button
              class="intro-x"
              onclick={dismissConcept}
              aria-label="Dismiss tip">×</button
            >
          </div>
          <p class="concept-body">{concept.body}</p>
          <div class="concept-foot">
            <button class="btn btn-accent concept-got" onclick={dismissConcept}>
              Got it
            </button>
            <button
              class="concept-mute"
              onclick={() => setExplain(false)}
              title="Stop offering these as-you-go tips (re-enable from ? Help)"
            >
              Don't explain as I go
            </button>
          </div>
        </div>
      {/if}

      <!-- Always-available Help handle: the single mute, replay, and re-show-intro,
           so a novice can pull more help and an expert can silence it. -->
      <div class="help-handle">
        <button
          class="help-btn"
          onclick={() => (helpOpen = !helpOpen)}
          aria-label="Help and tips"
          title="Help &amp; tips">?</button
        >
        {#if helpOpen}
          <div class="help-menu">
            <label class="help-row">
              <input
                type="checkbox"
                checked={explainAsYouGo}
                onchange={(e) => setExplain(e.currentTarget.checked)}
              />
              Explain things as I go
            </label>
            <button
              class="help-row-btn"
              onclick={() => {
                replayConcepts();
              }}>↺ Replay the tips</button
            >
            <button
              class="help-row-btn"
              onclick={() => {
                showIntro = true;
                helpOpen = false;
              }}>Show the intro again</button
            >
          </div>
        {/if}
      </div>

      {#if popPos && selPart}
        {@const kind = selPart.kind}
        <div
          class="value-pop {popPos.below ? 'below' : 'above'}"
          style="left: {popPos.left}px; {popPos.top !== null
            ? `top: ${popPos.top}px;`
            : `bottom: ${popPos.bottom}px;`}"
        >
          <div class="insp-head">
            <span class="insp-kind">{partName(kind)}</span>
            <span class="insp-val mono">{fmtVal(kind, selPart.value)}</span>
            <button
              class="insp-info"
              title="More about this part — pinout & details (I)"
              aria-label="Open the info panel for this part"
              onclick={() => (infoOpen = true)}>ⓘ</button
            >
          </div>
          {#if selElectrical}
            <div class="insp-meter mono">
              {formatValue(selElectrical.vAcross, "V")} across · {formatValue(
                selElectrical.current,
                "A",
              )} through
            </div>
          {/if}
          <!-- Custom label: name this part (shown on the board in place of the kind
               tag). Pure presentation; persists in the save. Commits on blur/enter. -->
          <div class="insp-row">
            <input
              class="insp-name mono"
              type="text"
              placeholder="label (e.g. R1, Vin)"
              value={selPart.label ?? ""}
              maxlength="20"
              aria-label="Name this component"
              onchange={(e) => setLabelText(e.currentTarget.value)}
            />
          </div>
          {#if hasValue(kind)}
            {@const cd = valueDecade(kind, selPart.value)}
            {#if kind === "MSW"}
              <!-- Manual switch: a bespoke two-state toggle, not a numeric sweep.
                 Open (value 0) / Closed (value 1) chips, mirroring how the other
                 parts' value chips read — and matching the click-to-flip on the
                 board. Both go through setComponentValue, so they're undoable and
                 rebuild the netlist immediately. -->
              <div class="insp-chips">
                <button
                  class="chip-val {selPart.value < 0.5 ? 'is-active' : ''}"
                  onclick={() => setVal(0)}>Open</button
                >
                <button
                  class="chip-val {selPart.value >= 0.5 ? 'is-active' : ''}"
                  onclick={() => setVal(1)}>Closed</button
                >
              </div>
            {:else}
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
              {#if isDigitalPart(kind)}
                {@const lv = familyLevels(selFamily(), selPart.value)}
                <!-- The logic family sets the input thresholds and output levels:
                   Ideal = half-rail (no forbidden band); CMOS/TTL give honest noise
                   margins. Packed into `aux` for the solver (func + 16*family). -->
                <div class="insp-sub">logic family</div>
                <div class="insp-chips wrap">
                  {#each LOGIC_FAMILIES as fam, i (fam.name)}
                    <button
                      class="chip-val {selFamily() === i ? 'is-active' : ''}"
                      onclick={() => setFamily(i)}>{fam.name}</button
                    >
                  {/each}
                </div>
                <div class="insp-sub">
                  thresholds · <span class="mono"
                    >low ≤ {formatValue(lv.vIl, "V")} · high &gt; {formatValue(
                      lv.vIh,
                      "V",
                    )}</span
                  >
                </div>
                <div class="insp-sub">
                  output · <span class="mono"
                    >{formatValue(lv.vOl, "V")} / {formatValue(
                      lv.vOh,
                      "V",
                    )}</span
                  >
                  · noise margin
                  <span class="mono"
                    >{formatValue(lv.nmHigh, "V")} hi · {formatValue(
                      lv.nmLow,
                      "V",
                    )} lo</span
                  >
                </div>
              {/if}
              {#if isGatePart(kind)}
                <!-- Output stage: push-pull drives both rails; open-drain pulls low and
                   releases high (needs an external pull-up) — open-drain outputs on one
                   net make a wired-AND bus (I²C / interrupt-line idiom). -->
                <div class="insp-sub">output</div>
                <div class="insp-chips">
                  <button
                    class="chip-val {selOpenDrain() ? '' : 'is-active'}"
                    onclick={() => setOpenDrain(false)}>Push-pull</button
                  >
                  <button
                    class="chip-val {selOpenDrain() ? 'is-active' : ''}"
                    onclick={() => setOpenDrain(true)}>Open-drain</button
                  >
                </div>
                {#if selOpenDrain()}
                  <div class="insp-sub">
                    releases high · <span class="mono"
                      >add a pull-up to Vcc</span
                    >
                  </div>
                {/if}
              {/if}
              {#if kind === "LS"}
                <!-- The level shifter's OUTPUT rail (rail B); the value chips above set
                   the INPUT rail (rail A). Pick both to shift up (A < B) or down. -->
                <div class="insp-sub">output rail (B)</div>
                <div class="insp-chips wrap">
                  {#each [1.8, 2.5, 3.3, 5, 12] as v (v)}
                    <button
                      class="chip-val {selAmp() === v ? 'is-active' : ''}"
                      onclick={() => setAmp(v)}>{formatValue(v, "V")}</button
                    >
                  {/each}
                </div>
              {/if}
              {#if kind === "AC"}
                <!-- The AC source's second scalar: its peak amplitude (volts),
                 presented exactly like the frequency chips above. The row above
                 sets the frequency (Hz); this one the peak voltage. -->
                <!-- Amplitude is the PEAK; show the RMS beside it since mains and most
                   real specs are RMS (Vpk = Vrms·√2). -->
                <div class="insp-sub">
                  amplitude · <span class="mono"
                    >≈ {formatValue(selAmp() / Math.SQRT2, "V")} rms</span
                  >
                </div>
                <div class="insp-row">
                  <button
                    class="btn btn-ghost insp-step"
                    onclick={() => stepAmpVal(-1)}
                    title="Next smaller amplitude">−</button
                  >
                  <div class="insp-chips wrap">
                    {#each acAmpChips() as v (v)}
                      <button
                        class="chip-val {selAmp() === v ? 'is-active' : ''}"
                        onclick={() => setAmp(v)}>{formatValue(v, "V")}</button
                      >
                    {/each}
                  </div>
                  <button
                    class="btn btn-ghost insp-step"
                    onclick={() => stepAmpVal(1)}
                    title="Next larger amplitude">+</button
                  >
                </div>
                <!-- One-click mains presets: set the peak amplitude AND line frequency
                   together to emulate real US / EU line voltage. -->
                <div class="insp-sub">mains presets</div>
                <div class="insp-chips wrap">
                  {#each AC_MAINS_PRESETS as p (p.label)}
                    <button
                      class="chip-val {selAmp() === p.amp &&
                      selPart.value === p.freq
                        ? 'is-active'
                        : ''}"
                      onclick={() => {
                        setAmp(p.amp);
                        setVal(p.freq);
                      }}
                      title="Set {p.label} (peak {p.amp} V)">{p.label}</button
                    >
                  {/each}
                </div>
              {/if}
              {#if kind === "POT"}
                <!-- The potentiometer's wiper position (0 = A end, 1 = B end) as a
                 continuous slider; drag it to set the exact split of the track. -->
                <div class="insp-sub">
                  wiper · {Math.round(selWiper() * 100)}%
                </div>
                <div class="insp-row">
                  <span class="wiper-end">A</span>
                  <input
                    class="wiper-slider"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selWiper()}
                    aria-label="Potentiometer wiper position"
                    oninput={(e) => setWiper(Number(e.currentTarget.value))}
                    onchange={endWiperDrag}
                    onpointerup={endWiperDrag}
                  />
                  <span class="wiper-end">B</span>
                </div>
              {/if}
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
                      class="chip-val sm {Math.abs(selPart.value / cd - s) <
                      0.05
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
                      class="chip-val sm {selPart.value === v
                        ? 'is-active'
                        : ''}"
                      onclick={() => setVal(v)}>{fmtVal(kind, v)}</button
                    >
                  {/each}
                </div>
              {/if}
            {/if}
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
                  {#if diagramHasDetail || diagramHasFactory}
                    <!-- The 3-tier view selector: Schematic (the datasheet symbol) →
                         Analogy (the machine-metaphor view) → Reality (the live
                         construction-internals, "as close to reality as possible").
                         A tier's button only appears when that kind has its own art;
                         the diagram clamps outward to the schematic otherwise. -->
                    <div
                      class="diagram-toggle"
                      role="group"
                      aria-label="Component view tier"
                    >
                      <button
                        class="seg {effectiveDiagramMode === 'schematic'
                          ? 'is-active'
                          : ''}"
                        onclick={() => (diagramMode = "schematic")}
                        title="Schematic — the symbol you'll meet on a datasheet"
                      >
                        Schematic
                      </button>
                      {#if diagramHasFactory}
                        <button
                          class="seg {effectiveDiagramMode === 'analogy'
                            ? 'is-active'
                            : ''}"
                          onclick={() => (diagramMode = "analogy")}
                          title="Analogy — the machine-metaphor view"
                        >
                          Analogy
                        </button>
                      {/if}
                      {#if diagramHasDetail}
                        <button
                          class="seg {effectiveDiagramMode === 'reality'
                            ? 'is-active'
                            : ''}"
                          onclick={() => (diagramMode = "reality")}
                          title="Reality — what's literally happening inside, live"
                        >
                          Reality
                        </button>
                      {/if}
                    </div>
                  {/if}
                  <div
                    class="info-diagram {effectiveDiagramMode === 'reality'
                      ? 'is-detail'
                      : ''}"
                  >
                    <canvas use:infoDiagramAction></canvas>
                  </div>
                  {@const po = pinoutOf(selPart.kind, selPart.rot)}
                  {#if po}
                    <div class="pinout-wrap">
                      <div class="pinout-cap">Pinout</div>
                      <div
                        class="pinout"
                        style="width: {po.width}px; height: {po.height}px;"
                      >
                        <svg
                          width={po.width}
                          height={po.height}
                          viewBox="0 0 {po.width} {po.height}"
                          aria-hidden="true"
                        >
                          <rect
                            class="pinout-body"
                            x={po.body.x}
                            y={po.body.y}
                            width={po.body.w}
                            height={po.body.h}
                            rx="4"
                          />
                          {#each po.pins as p (p.label)}
                            <line
                              class="pinout-leg"
                              x1={po.body.x + po.body.w / 2}
                              y1={po.body.y + po.body.h / 2}
                              x2={p.x}
                              y2={p.y}
                            />
                          {/each}
                          {#each po.pins as p (p.label)}
                            <circle
                              class="pinout-dot"
                              cx={p.x}
                              cy={p.y}
                              r="4.5"
                              style="fill: {po.color}"
                            />
                          {/each}
                        </svg>
                        {#each po.pins as p (p.label)}
                          <div
                            class="pinout-label"
                            style="left: {p.lx}px; top: {p.ly}px; transform: translate({p.tx}, {p.ty});"
                          >
                            <span class="pinout-name" style="color: {po.color}"
                              >{p.label}</span
                            >
                            {#if p.gloss}<span class="pinout-gloss"
                                >{p.gloss}</span
                              >{/if}
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                  <div class="info-eq mono">{info.equation}</div>
                  <p class="info-plain">{info.plain()}</p>
                  <div class="info-live">
                    <div class="info-live-head">Right now</div>
                    <div class="info-sub mono">
                      {info.headline(e, selPart.value, selPart.amp)}
                    </div>
                    {#each info.derived(e, selPart.value, selPart.amp) as row (row.label)}
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
      <span class="scope-ctl">
        <button
          class="btn btn-ghost scope-expand"
          onclick={cycleSpan}
          disabled={!ready}
          title="Scope time window — click to cycle (decimated, so a full AC cycle fits)"
        >
          ⏱ {scopeSpan}
        </button>
        <button
          class="btn btn-ghost scope-expand"
          onclick={toggleScope}
          disabled={!ready}
          title="Resize the scope on the board"
        >
          {scopeBig ? "Shrink scope" : "Expand scope"}
        </button>
      </span>
    </h3>
    <ul class="chan-list scroll">
      {#each channels as v, i (i)}
        <li class="chan" style="--c: {channelColor(i)}">
          {#if i === 0}
            <span class="chan-dot"></span>
            <span class="chan-name">{channelLabel(0)}</span>
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
    <!-- The carriers-vs-energy primer lives here now (general "how to read the
         board animation"), not in the per-component info panel. Collapsed by
         default so it's available without crowding the readings. -->
    <details class="board-legend">
      <summary>Reading the board — carriers &amp; energy</summary>
      <div class="belt-legend">
        <span class="belt-key"
          ><b class="belt-carrier">›</b> carriers · charge</span
        >
        <span class="belt-key"><b class="belt-energy">●</b> energy · power</span
        >
      </div>
      <p class="info-plain">
        Two things ride every wire. The <b>carriers</b> are the arrow chevrons,
        coloured by the net's voltage — they move the way the current flows. On
        <b>DC</b> they stream one way; on <b>AC</b> they slosh back and forth in place,
        because the current reverses every half-cycle. Net charge barely travels.
      </p>
      <p class="info-plain">
        The orange dots are <b>energy</b> — power,
        <span class="mono">P = V·I</span>, carried to the load. Here's the
        surprise: on AC's negative half-cycle
        <b>both</b> the voltage and the current go negative, yet the energy
        still flows <b>forward</b>. Power is their <i>product</i>, and negative
        × negative is <b>positive</b> — so <span class="mono">P = V·I ≥ 0</span> the
        whole cycle through a resistor. The carriers slosh, but the energy is never
        not being delivered.
      </p>
      <p class="info-plain">
        In a capacitor or inductor the voltage and current sit a quarter-cycle
        apart, so <span class="mono">V·I</span> swings both ways — the energy sloshes
        in and back out, delivering nothing on average. That's reactive power.
      </p>
    </details>
  </aside>
</div>

<div class="hud-footer">
  <div class="transport">
    <button class="btn btn-accent" onclick={togglePlay} disabled={!ready}>
      {running ? "❚❚ Pause" : "▶ Run"} <kbd class="hk">Space</kbd>
    </button>
    <button
      class="btn step"
      onclick={stepBack}
      disabled={!ready}
      title="Step back one tick (,)">◀ <kbd class="hk">,</kbd></button
    >
    <button
      class="btn step"
      onclick={stepFwd}
      disabled={!ready}
      title="Step forward one tick (.)">▶ <kbd class="hk">.</kbd></button
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
  /* Hotkey badge shown on every button that has a keyboard shortcut. */
  .hk {
    display: inline-block;
    margin-left: 4px;
    padding: 0 4px;
    font-family: var(--font-mono);
    font-size: 9px;
    line-height: 14px;
    letter-spacing: 0.04em;
    color: var(--faint);
    border: 1px solid var(--border);
    border-radius: 3px;
    vertical-align: middle;
    opacity: 0.85;
  }
  .file-hidden {
    display: none;
  }
  .io-msg {
    align-self: center;
    margin-left: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--dim);
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

  /* Inline net-label name editor: a small input floated over the board at the
     labelled endpoint (Label tool). On-brand mono, accent focus ring. */
  .net-label-input {
    position: absolute;
    z-index: 6;
    width: 116px;
    padding: 3px 7px;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.06em;
    color: var(--text);
    background: oklch(0.165 0.028 285 / 0.97);
    border: 1px solid var(--accent-line);
    border-radius: 3px;
    box-shadow: 0 8px 22px -10px #000;
  }
  .net-label-input::placeholder {
    color: var(--dim);
    letter-spacing: 0.1em;
  }
  .net-label-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  /* Telemetry node controls: per-node scope visibility + rename, scope sizer. */
  .nodes-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .scope-ctl {
    display: flex;
    gap: 6px;
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
  /* The custom-label text field at the top of the value popover (name this part). */
  .insp-name {
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 8px;
    padding: 3px 7px;
    font-size: 12px;
    color: var(--text);
    background: oklch(0.16 0.028 285 / 0.7);
    border: 1px solid var(--border);
    border-radius: 3px;
    outline: none;
  }
  .insp-name::placeholder {
    color: var(--dim);
  }
  .insp-name:focus {
    border-color: var(--accent);
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
    gap: 8px;
    margin-bottom: 8px;
  }
  /* The "tell me more" door on the value popover → opens the deep info drawer. */
  .insp-info {
    margin-left: auto;
    align-self: center;
    background: none;
    border: none;
    padding: 0 2px;
    font-size: 13px;
    line-height: 1;
    color: var(--dim);
    cursor: pointer;
  }
  .insp-info:hover {
    color: var(--cyan);
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

  /* Potentiometer wiper: a continuous slider across the track (A … B). */
  .wiper-slider {
    flex: 1;
    min-width: 0;
    height: 4px;
    appearance: none;
    -webkit-appearance: none;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
    accent-color: var(--accent);
  }
  .wiper-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--accent);
    border: 1px solid var(--bg);
    box-shadow: 0 0 6px var(--accent);
    cursor: pointer;
  }
  .wiper-slider::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--accent);
    border: 1px solid var(--bg);
    cursor: pointer;
  }
  .wiper-end {
    font-family: var(--font-mono);
    font-size: 10px;
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
  /* Symbol ⇄ Inside segmented control above the hero diagram. */
  .diagram-toggle {
    display: flex;
    gap: 0;
    margin-bottom: 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    width: fit-content;
  }
  .diagram-toggle .seg {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--dim);
    padding: 5px 12px;
    background: var(--surface);
    border: none;
    border-right: 1px solid var(--border);
    cursor: pointer;
    transition:
      color 0.12s,
      background 0.12s;
  }
  .diagram-toggle .seg:last-child {
    border-right: none;
  }
  .diagram-toggle .seg:hover {
    color: var(--text);
  }
  .diagram-toggle .seg.is-active {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .info-diagram {
    height: 170px;
    border: 1px solid var(--border);
    border-radius: 5px;
    overflow: hidden;
    margin-bottom: 12px;
    background: #120f1c;
  }
  /* The construction-internals view is the headline visual — give it more room. */
  .info-diagram.is-detail {
    height: 230px;
  }
  .info-diagram canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  /* Pinout: an oriented terminal map. The SVG draws the package body, legs and
     dots; the labels are DOM text positioned over it (so they stay selectable and
     screen-reader legible). Centred, with the diagram sized to its content. */
  .pinout-wrap {
    margin-bottom: 12px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: #120f1c;
    padding: 6px 8px 10px;
  }
  .pinout-cap {
    font-family: var(--font-display);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--dim);
    margin-bottom: 2px;
  }
  .pinout {
    position: relative;
    margin: 0 auto;
  }
  .pinout svg {
    position: absolute;
    inset: 0;
  }
  .pinout-body {
    fill: var(--surface-2);
    stroke: var(--border-bright);
    stroke-width: 1.5;
  }
  .pinout-leg {
    stroke: var(--border-bright);
    stroke-width: 2;
  }
  .pinout-dot {
    stroke: #120f1c;
    stroke-width: 1.5;
  }
  .pinout-label {
    position: absolute;
    display: flex;
    flex-direction: column;
    line-height: 1.1;
    white-space: nowrap;
    pointer-events: none;
  }
  .pinout-name {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
  }
  .pinout-gloss {
    font-size: 9.5px;
    color: var(--dim);
    letter-spacing: 0.01em;
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
  /* The carriers-vs-energy primer, now a collapsible legend at the foot of the
     telemetry panel (moved out of the per-component info panel). */
  .board-legend {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .board-legend > summary {
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 11px;
    color: var(--dim);
    cursor: pointer;
    margin-bottom: 8px;
    list-style: revert;
  }
  .board-legend > summary:hover {
    color: var(--text);
  }
  .board-legend .info-plain:last-child {
    margin-bottom: 0;
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
  /* Parts bin: search box + collapsible category folders. */
  .part-search {
    width: 100%;
    margin: 0 0 8px;
    padding: 6px 9px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .part-search::placeholder {
    color: var(--faint);
  }
  .part-cats {
    overflow-y: auto;
  }
  .part-cat {
    border-bottom: 1px solid var(--border);
  }
  .part-cat-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 4px;
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
  .part-cat-head::-webkit-details-marker {
    display: none;
  }
  .part-cat-head::before {
    content: "▸";
    font-size: 10px;
    color: var(--faint);
    transition: transform 0.15s var(--ease);
  }
  .part-cat[open] > .part-cat-head {
    color: var(--accent);
  }
  .part-cat[open] > .part-cat-head::before {
    transform: rotate(90deg);
  }
  .part-cat-name {
    flex: 1;
  }
  .part-cat-count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--faint);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 1px 7px;
  }
  .part-cat .part-list {
    margin-bottom: 8px;
  }
  .part-empty {
    font-size: 12px;
    color: var(--dim);
    padding: 8px 2px;
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
  /* First-encounter concept card: a small "what you just caused" toast, top-centre. */
  .concept-card {
    position: absolute;
    top: 52px;
    left: 50%;
    transform: translateX(-50%);
    width: min(380px, 70%);
    padding: 12px 14px;
    background: oklch(0.165 0.028 285 / 0.96);
    border: 1px solid var(--accent-line);
    border-radius: 5px;
    box-shadow: 0 8px 28px -10px var(--accent);
    backdrop-filter: blur(3px);
    z-index: 6;
  }
  .concept-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .concept-tag {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    border: 1px solid var(--accent-line);
    border-radius: 2px;
    padding: 1px 5px;
  }
  .concept-title {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.03em;
    color: var(--text);
    flex: 1;
  }
  .concept-body {
    margin: 0 0 10px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--dim);
  }
  .concept-foot {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .concept-got {
    padding: 4px 14px;
    font-size: 12px;
  }
  .concept-mute {
    background: none;
    border: none;
    color: var(--faint);
    font-size: 11px;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }
  .concept-mute:hover {
    color: var(--dim);
  }
  /* Always-available Help handle (the single mute + replay), board top-left. */
  .help-handle {
    position: absolute;
    left: 10px;
    top: 10px;
    z-index: 6;
  }
  .help-btn {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid var(--border-bright);
    background: oklch(0.165 0.028 285 / 0.9);
    color: var(--dim);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
    display: grid;
    place-items: center;
    line-height: 1;
  }
  .help-btn:hover {
    color: var(--accent);
    border-color: var(--accent-line);
  }
  .help-menu {
    position: absolute;
    top: 32px;
    left: 0;
    width: 200px;
    background: oklch(0.165 0.028 285 / 0.97);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: 0 8px 24px -10px #000;
  }
  .help-row {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--dim);
    cursor: pointer;
  }
  .help-row-btn {
    text-align: left;
    background: none;
    border: none;
    color: var(--dim);
    font-size: 12px;
    cursor: pointer;
    padding: 3px 2px;
    border-radius: 3px;
  }
  .help-row-btn:hover {
    color: var(--text);
    background: var(--surface-2);
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

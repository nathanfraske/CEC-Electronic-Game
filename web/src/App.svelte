<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts" module>
  import type { Component } from "./lib/graph";

  // Per-kind LAST-USED arm-time configuration (the configurator axes only). Module-level
  // and non-reactive on purpose: it's a plain memory that outlives any single arm, so
  // re-arming a kind — or editing a placed one — re-offers what you last chose. Keyed by
  // kind tag; the value is the same `Partial<Component>` shape the ghost/placement spread.
  // A plain (NOT Svelte-reactive) Map is deliberate: it's only ever read in event handlers
  // (arm / the dual-target setters), never in a template or `$derived`, so reactivity would
  // be pure overhead — the reactive copy that the UI tracks is `armedConfig` ($state).
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- intentional non-reactive memory; see above
  const lastConfig = new Map<string, Partial<Component>>();
</script>

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
    type SimHandle,
  } from "./sim/loop";
  import { drawBode, logFreqs } from "./lib/bode";
  import { drawPhaseScope } from "./lib/phaseScope";
  import {
    Board,
    type Mode,
    type SelectedPart,
    type AnchorRect,
  } from "./lib/board";
  import {
    BoardGraph,
    formatValue,
    PALETTE,
    PART_KINDS,
    AC_DEFAULT_AMP,
    loadUnit,
    PLACEMENT_OVERRIDE_KEYS,
    isFrame,
    isFreeFormFrame,
    framePackage,
    ensureFrameKind,
    type GraphSnapshot,
    type HotSlot,
    type PinTest,
    type PinTestRole,
  } from "./lib/graph";
  import {
    freshDieGraph,
    findDieFrameId,
    dieIsSealable,
    unusedDiePins,
    dieTestGraph,
    innerDiesForSave,
    restoreInnerDies,
    isStandaloneDieGraph,
    placeableFrameTag,
    type InnerDie,
  } from "./lib/dieEditor";
  import {
    captureSeal,
    getUserIc,
    isUserIc,
    resealUserIc,
    setUserIcBehavior,
    recognizeGate,
    registerUserIc,
    registerUserIcs,
    registerUserIcFamilies,
    userIcsForGraph,
    userIcFamiliesForGraph,
    userIcVariants,
    hasUserIcVariants,
    userIcFamilyTargets,
    integrationTier,
    tapeOut,
    type UserIc,
    type UserIcFamilySidecar,
  } from "./lib/userIc";
  import { characterizeCell, type SweepVector } from "./lib/characterize";
  import {
    registerLibrary,
    addToLibrary,
    libraryEntries,
    renameLibraryIc,
    removeFromLibrary,
    entryRole,
    type LibraryEntry,
  } from "./lib/userLibrary";
  import {
    gateTemplate,
    gateTemplateName,
    GATE_TEMPLATE_KINDS,
    type GateTemplateKind,
  } from "./lib/gateTemplates";
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
    loadValues,
    loadChips,
  } from "./lib/values";
  import { LOGIC_FAMILIES, familyLevels } from "./lib/families";
  import { TIER_LABELS, DEFAULT_TIER, hasTiers } from "./lib/tiers";
  import {
    hasDiodeTypes,
    hasLedColors,
    DIODE_TYPES,
    diodeVariant,
    variantList,
  } from "./lib/diodes";
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
    rmsStabilized,
    type ElectricalState,
  } from "./lib/glyphs";
  import { pinoutOf } from "./lib/pinout";
  import { hasDetail } from "./lib/detailDrawers";
  import { hasAnalogy } from "./lib/analogyDrawers";
  import { apparentFreq, setApparentRateScale } from "./lib/tierKit";
  import { drawPhasor2D } from "./lib/hudPhasor";
  import { formatMag, magnification, scaleBar } from "./lib/zoomMeter";
  import { partInfo } from "./lib/partInfo";
  import { THERMISTOR_TEMP } from "./lib/thermistor";
  import { CALCS } from "./lib/calc";
  import { InfoDiagram, type DiagramMode } from "./lib/infoDiagram";
  import {
    codexCategories,
    REFSHEET_OF,
    PART_SYNONYMS as CODEX_SYNONYMS,
    PART_META as CODEX_META,
    PART_CAT_OF as CODEX_CAT_OF,
    isDigital,
    tierRows,
    variantRows,
    familyRows,
    valueSummary,
  } from "./lib/codex";

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
      tag: "PULSE",
      name: "Pulse / Clock Gen",
      desc: "Square/triangle · Hz + duty",
      tier: "I",
      color: "var(--violet)",
    },
    {
      tag: "R",
      name: "Resistor",
      desc: "Ideal ohms, no tolerance",
      tier: "I",
      color: "var(--bronze)",
    },
    {
      tag: "SHUNT",
      name: "Current Shunt",
      desc: "Milliohm sense · reads I from V",
      tier: "II",
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
      tag: "NTC",
      name: "NTC Thermistor",
      desc: "R falls as it heats",
      tier: "II",
      color: "var(--warn)",
    },
    {
      tag: "PTC",
      name: "PTC Thermistor",
      desc: "Snaps high past its Curie point",
      tier: "II",
      color: "var(--warn)",
    },
    {
      tag: "I",
      name: "Current Source",
      desc: "Ideal fixed DC current",
      tier: "I",
      color: "var(--warn)",
    },
    {
      tag: "LOAD",
      name: "Electronic Load",
      desc: "CC / CR sink + load-step",
      tier: "II",
      color: "var(--bad)",
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
      tag: "ASW",
      name: "Analog Switch",
      desc: "Node-gated · passes analog A↔B",
      tier: "II",
      color: "var(--violet)",
    },
    {
      tag: "CMP",
      name: "Comparator",
      desc: "Open-loop · IN+ vs IN− → rail",
      tier: "II",
      color: "var(--accent)",
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
      tag: "IMPLY",
      name: "IMPLY Gate",
      desc: "A → B (¬A ∨ B)",
      tier: "II",
      color: "var(--ok)",
    },
    {
      tag: "NIMPLY",
      name: "NIMPLY Gate",
      desc: "A ↛ B (A ∧ ¬B)",
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
      tag: "INV",
      name: "Inverter (CMOS)",
      desc: "Real PMOS+NMOS push-pull · the CEC9002",
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
      tag: "HADD",
      name: "Half Adder",
      desc: "Adds two bits → sum + carry",
      tier: "III",
      color: "var(--ok)",
    },
    {
      tag: "FADD",
      name: "Full Adder",
      desc: "Adds A+B+carry-in → the ALU cell",
      tier: "III",
      color: "var(--ok)",
    },
    {
      tag: "MUX2",
      name: "2:1 Mux",
      desc: "Picks A or B by select",
      tier: "III",
      color: "var(--ok)",
    },
    {
      tag: "DMUX",
      name: "1:2 Demux",
      desc: "Routes D to Y0/Y1 · 1-of-2 decode",
      tier: "III",
      color: "var(--ok)",
    },
    {
      tag: "MAJ3",
      name: "Majority Gate",
      desc: "High when ≥2 of 3 inputs high",
      tier: "III",
      color: "var(--ok)",
    },
    {
      tag: "SRL",
      name: "SR Latch",
      desc: "Set/reset memory · cross-coupled",
      tier: "III",
      color: "var(--cyan)",
    },
    {
      tag: "DLATCH",
      name: "D-Latch",
      desc: "Transparent while EN high · holds",
      tier: "III",
      color: "var(--cyan)",
    },
    {
      tag: "JKFF",
      name: "JK Flip-Flop",
      desc: "Universal flip-flop · tie J=K for T",
      tier: "III",
      color: "var(--cyan)",
    },
    {
      tag: "TRI",
      name: "Tri-State Buffer",
      desc: "Drives A, or Hi-Z when OE low",
      tier: "III",
      color: "var(--ok)",
    },
    {
      tag: "SAMP",
      name: "Clocked Sampler",
      desc: "Quantizes 1 bit on the clock edge",
      tier: "II",
      color: "var(--cyan)",
    },
    {
      tag: "LUT",
      name: "FPGA Logic Cell",
      desc: "4-input look-up table · any function",
      tier: "III",
      color: "var(--violet)",
    },
    {
      tag: "SPIM",
      name: "SPI Master",
      desc: "Clocks a word out on START",
      tier: "III",
      color: "var(--violet)",
    },
    {
      tag: "SPIS",
      name: "SPI Slave",
      desc: "Clocked by the master · replies on MISO",
      tier: "III",
      color: "var(--violet)",
    },
    {
      tag: "UART",
      name: "UART",
      desc: "Async serial · frames a byte on SEND",
      tier: "III",
      color: "var(--violet)",
    },
    {
      tag: "ADC",
      name: "Flash ADC",
      desc: "VIN -> 3-bit code, all at once",
      tier: "III",
      color: "var(--cyan)",
    },
    {
      tag: "DAC",
      name: "R-2R DAC",
      desc: "3-bit code -> voltage (ladder)",
      tier: "III",
      color: "var(--cyan)",
    },
    {
      tag: "SAR",
      name: "SAR ADC",
      desc: "VIN -> 3-bit code by binary search",
      tier: "III",
      color: "var(--cyan)",
    },
    {
      tag: "SDM",
      name: "Sigma-Delta ADC",
      desc: "Oversampling: 1-bit stream -> code",
      tier: "III",
      color: "var(--cyan)",
    },
    {
      tag: "CTR",
      name: "Counter",
      desc: "3-bit up-counter (counts clock edges)",
      tier: "III",
      color: "var(--violet)",
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
    // IC-maker FRAMES (ADR 0006): placeable package outlines with numbered pins and NO sim
    // element of their own - you wire your circuit to the frame's pins to define a future IC's
    // pinout. Generated kinds in graph.ts (from packageOptions); the tags/names here MUST match
    // those (frameTag/frameName). Neutral border tint; the "IC" badge marks them as IC-maker
    // primitives rather than a I/II/III learning step. They render via the generic IC-card drawer.
    {
      tag: "DIP8",
      name: "DIP-8",
      desc: "8-pin DIP package frame",
      tier: "IC",
      color: "var(--border)",
    },
    {
      tag: "DIP14",
      name: "DIP-14",
      desc: "14-pin DIP package frame",
      tier: "IC",
      color: "var(--border)",
    },
    {
      tag: "DIP16",
      name: "DIP-16",
      desc: "16-pin DIP package frame",
      tier: "IC",
      color: "var(--border)",
    },
    {
      tag: "SOT23_3",
      name: "SOT-23-3",
      desc: "3-pin SOT-23 package frame",
      tier: "IC",
      color: "var(--border)",
    },
    {
      tag: "SOT23_5",
      name: "SOT-23-5",
      desc: "5-pin SOT-23 package frame",
      tier: "IC",
      color: "var(--border)",
    },
    {
      tag: "SOT23_6",
      name: "SOT-23-6",
      desc: "6-pin SOT-23 package frame",
      tier: "IC",
      color: "var(--border)",
    },
    {
      tag: "VSSOP8",
      name: "VSSOP-8",
      desc: "8-pin VSSOP package frame",
      tier: "IC",
      color: "var(--border)",
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
    "IC Frames",
  ];
  const PART_CAT_OF: Record<string, string> = {
    V: "Sources",
    AC: "Sources",
    PULSE: "Sources",
    I: "Sources",
    GND: "Sources",
    R: "Passives",
    SHUNT: "Passives",
    C: "Passives",
    EC: "Passives",
    L: "Passives",
    TR: "Passives",
    POT: "Passives",
    NTC: "Passives",
    PTC: "Passives",
    D: "Diodes",
    SD: "Diodes",
    LED: "Diodes",
    ZD: "Diodes",
    MOV: "Protection",
    SW: "Active & Switching",
    MSW: "Active & Switching",
    LOAD: "Active & Switching",
    NM: "Active & Switching",
    PM: "Active & Switching",
    Q: "Active & Switching",
    QP: "Active & Switching",
    OA: "Active & Switching",
    ASW: "Active & Switching",
    CMP: "Active & Switching",
    AND: "Logic & ICs",
    OR: "Logic & ICs",
    NAND: "Logic & ICs",
    NOR: "Logic & ICs",
    XOR: "Logic & ICs",
    XNOR: "Logic & ICs",
    IMPLY: "Logic & ICs",
    NIMPLY: "Logic & ICs",
    NOT: "Logic & ICs",
    INV: "Logic & ICs",
    BUF: "Logic & ICs",
    FF: "Logic & ICs",
    HADD: "Logic & ICs",
    FADD: "Logic & ICs",
    MUX2: "Logic & ICs",
    DMUX: "Logic & ICs",
    MAJ3: "Logic & ICs",
    SRL: "Logic & ICs",
    DLATCH: "Logic & ICs",
    JKFF: "Logic & ICs",
    TRI: "Logic & ICs",
    SAMP: "Logic & ICs",
    LUT: "Logic & ICs",
    SPIM: "Logic & ICs",
    SPIS: "Logic & ICs",
    UART: "Logic & ICs",
    ADC: "Logic & ICs",
    DAC: "Logic & ICs",
    SAR: "Logic & ICs",
    SDM: "Logic & ICs",
    CTR: "Logic & ICs",
    LS: "Logic & ICs",
    PU: "Logic & ICs",
    FP: "Logic & ICs",
    uC: "Logic & ICs",
    // IC-maker frames (no sim element; you wire your own circuit to their numbered pins).
    DIP8: "IC Frames",
    DIP14: "IC Frames",
    DIP16: "IC Frames",
    SOT23_3: "IC Frames",
    SOT23_5: "IC Frames",
    SOT23_6: "IC Frames",
    VSSOP8: "IC Frames",
  };

  // Parts FAMILIES collapse the big multi-member sets into ONE expandable bin row each,
  // so the catalogue scales without the bin becoming a wall of always-visible rows. A
  // family lists its member tags in display order; every kind NOT named in a family is its
  // own singleton (it renders as a plain row, unchanged). Order is the display order within
  // a category — a multi-member family appears where its first member would, and absorbs the
  // rest. Keep `familyOf` (tag → family name) in sync, mirroring `PART_CAT_OF`.
  const PART_FAMILIES: { name: string; members: string[] }[] = [
    {
      name: "Logic gates",
      members: [
        "AND",
        "OR",
        "NAND",
        "NOR",
        "XOR",
        "XNOR",
        "IMPLY",
        "NIMPLY",
        "NOT",
        "BUF",
      ],
    },
    { name: "Diodes", members: ["D", "SD", "LED", "ZD"] },
    { name: "Transistors", members: ["NM", "PM", "Q", "QP"] },
    { name: "Thermistors", members: ["NTC", "PTC"] },
  ];
  // tag → owning family name. A tag absent from any multi-member family is its OWN family
  // (the row renders plain), so the lookup falls back to the tag itself.
  const PART_FAMILY_OF: Record<string, string> = (() => {
    const m: Record<string, string> = {};
    for (const fam of PART_FAMILIES)
      for (const tag of fam.members) m[tag] = fam.name;
    return m;
  })();
  const familyOf = (tag: string): string => PART_FAMILY_OF[tag] ?? tag;
  // Multi-member families looked up by name (singletons are never stored here).
  const PART_FAMILY_BY_NAME: Record<
    string,
    { name: string; members: string[] }
  > = Object.fromEntries(PART_FAMILIES.map((f) => [f.name, f]));

  // A bin "group" is one rendered row: either a SINGLE part (plain row) or a multi-member
  // FAMILY (one expandable row whose nested rows are its `parts`). `familyGroups(cat)` walks
  // `PARTS` in display order and folds each category's members into groups — a family lands
  // where its FIRST member would, absorbing the rest; every other kind stays a singleton. A
  // category with no multi-member families just yields all singletons (no empty headers).
  type PartT = (typeof PARTS)[number];
  type PartGroup =
    | { kind: "single"; part: PartT }
    | { kind: "family"; name: string; color: string; parts: PartT[] };
  const familyGroups = (cat: string): PartGroup[] => {
    const groups: PartGroup[] = [];
    const famAt: Record<string, number> = {}; // family name → index in `groups`
    for (const part of PARTS) {
      if (PART_CAT_OF[part.tag] !== cat) continue;
      const fam = PART_FAMILY_BY_NAME[familyOf(part.tag)];
      if (!fam) {
        groups.push({ kind: "single", part });
        continue;
      }
      const at = famAt[fam.name];
      if (at === undefined) {
        famAt[fam.name] = groups.length;
        groups.push({
          kind: "family",
          name: fam.name,
          color: part.color, // first member's colour tints the family header
          parts: [part],
        });
      } else {
        (groups[at] as { parts: PartT[] }).parts.push(part);
      }
    }
    return groups;
  };

  // FUNCTION synonyms for search: a search term matches a part if it's a substring of the
  // part's name/tag/desc OR of any of these function words. Curated (~1–4 words per kind),
  // covering the common "what is this FOR" questions a learner types instead of a part name.
  const PART_SYNONYMS: Record<string, string[]> = {
    V: ["supply", "rail", "battery", "power"],
    AC: ["sine", "oscillator", "mains", "wave"],
    PULSE: ["clock", "oscillator", "square", "timer", "pwm"],
    R: ["resistor", "pull-up", "pull-down", "divider"],
    SHUNT: ["current sense", "ammeter", "measure current"],
    C: ["decoupling", "bypass", "filter", "smoothing"],
    EC: ["decoupling", "bypass", "bulk", "smoothing", "reservoir"],
    L: ["choke", "coil", "filter", "energy storage"],
    TR: ["isolation", "step-up", "step-down", "couple"],
    POT: ["volume", "trimmer", "divider", "variable resistor"],
    NTC: ["temperature", "sensor", "inrush"],
    PTC: ["resettable fuse", "temperature", "overcurrent"],
    I: ["bias", "constant current", "source"],
    LOAD: ["sink", "dummy load", "tester", "burn-in"],
    GND: ["reference", "common", "earth", "0 v"],
    D: ["rectifier", "clamp", "one-way", "check valve", "protection"],
    SD: ["rectifier", "low drop", "fast", "freewheel"],
    LED: ["indicator", "light", "lamp", "status"],
    ZD: ["regulator", "reference", "clamp", "overvoltage"],
    MOV: ["surge", "spike", "transient", "protection", "clamp"],
    SW: ["chopper", "switch", "pwm"],
    MSW: ["toggle", "button", "switch"],
    NM: ["switch", "amplifier", "low-side"],
    PM: ["switch", "high-side", "load switch"],
    Q: ["switch", "amplifier", "current gain"],
    QP: ["switch", "high-side", "current gain"],
    OA: ["amplifier", "comparator", "buffer", "gain"],
    ASW: ["analog switch", "transmission gate", "mux", "sample and hold"],
    CMP: ["comparator", "schmitt", "threshold", "zero crossing", "adc"],
    AND: ["gate", "all"],
    OR: ["gate", "any"],
    NAND: ["universal", "gate"],
    NOR: ["universal", "gate"],
    XOR: ["gate", "difference", "parity"],
    XNOR: ["gate", "equality", "parity"],
    IMPLY: ["gate", "implication"],
    NIMPLY: ["gate", "inhibit"],
    NOT: ["inverter", "gate"],
    BUF: ["buffer", "line driver", "gate"],
    FF: ["latch", "register", "memory", "flip-flop"],
    HADD: ["adder", "half adder", "sum", "carry", "arithmetic"],
    FADD: ["adder", "full adder", "sum", "carry", "alu", "arithmetic"],
    MUX2: ["mux", "multiplexer", "select", "data selector"],
    DMUX: ["demux", "demultiplexer", "decoder", "one-hot", "address"],
    MAJ3: ["majority", "voter", "tmr", "redundancy", "carry"],
    SRL: ["sr latch", "set reset", "latch", "memory", "bistable"],
    DLATCH: ["d latch", "transparent latch", "gated latch", "level sensitive"],
    JKFF: ["jk flip-flop", "t flip-flop", "toggle", "divide by two", "counter"],
    TRI: ["tri-state", "buffer", "bus driver", "output enable", "hi-z"],
    SAMP: ["sampler", "adc", "sample and hold", "quantizer"],
    LUT: [
      "fpga",
      "lut",
      "look-up table",
      "logic cell",
      "programmable",
      "gate array",
    ],
    SPIM: ["spi", "spi master", "serial", "bus", "mosi", "sclk"],
    SPIS: ["spi", "spi slave", "serial", "peripheral", "miso"],
    UART: ["uart", "serial", "rs232", "tx", "rx", "async"],
    ADC: [
      "adc",
      "flash adc",
      "analog to digital",
      "converter",
      "quantizer",
      "a/d",
    ],
    DAC: ["dac", "r-2r", "ladder dac", "digital to analog", "converter", "d/a"],
    SAR: ["sar", "successive approximation", "binary search adc", "adc", "a/d"],
    SDM: ["sigma-delta", "delta-sigma", "oversampling adc", "modulator", "adc"],
    CTR: [
      "counter",
      "binary counter",
      "ripple",
      "divider",
      "sequencer",
      "ramp",
    ],
    LS: ["translator", "level", "interface"],
    PU: ["regulator", "reference", "pull-up", "open-drain"],
    FP: ["fpga", "fabric", "parallel logic"],
    uC: ["mcu", "processor", "firmware", "computer"],
    // IC-maker frames: searchable by "package"/"footprint"/"ic"/"pinout" and the package family.
    DIP8: ["package", "footprint", "ic", "pinout", "dip", "frame", "ic maker"],
    DIP14: ["package", "footprint", "ic", "pinout", "dip", "frame", "ic maker"],
    DIP16: ["package", "footprint", "ic", "pinout", "dip", "frame", "ic maker"],
    SOT23_3: [
      "package",
      "footprint",
      "ic",
      "pinout",
      "sot-23",
      "frame",
      "ic maker",
    ],
    SOT23_5: [
      "package",
      "footprint",
      "ic",
      "pinout",
      "sot-23",
      "frame",
      "ic maker",
    ],
    SOT23_6: [
      "package",
      "footprint",
      "ic",
      "pinout",
      "sot-23",
      "frame",
      "ic maker",
    ],
    VSSOP8: [
      "package",
      "footprint",
      "ic",
      "pinout",
      "vssop",
      "frame",
      "ic maker",
    ],
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
  // Live region tool (free-form subassembly): the board reports the pending rectangle's inferred pin
  // count + any refusal reason via onRegion; null when no rectangle is drawn. `regionName` seeds the
  // sealed subassembly's name.
  let regionInfo = $state<{ pinCount: number; reason?: string } | null>(null);
  let regionName = $state("");
  // Zoom-meter readouts (Phase 5), refreshed each frame from board.getViewMetrics(): camera zoom +
  // the cumulative fit-scale of the opened-IC level under the view centre (1 ⇒ open board). The
  // magnification ×M and the snapped scale bar derive from them via lib/zoomMeter.
  let viewZoom = $state(1);
  let viewScale = $state(1);
  let magLabel = $derived(formatMag(magnification(viewZoom, viewScale)));
  let scaleRule = $derived(scaleBar(viewZoom, viewScale));
  // The "armed" part: clicking the board drops it (place-and-repeat). Null = none.
  let armedPart = $state<string | null>(null);
  // The armed part's pre-placement configurator choices (variant / tier / family /
  // open-drain / load mode / load step / amp) — the SAME `Partial<Component>` the ghost
  // and every drop spread. Reassigned (never mutated) so `$state` notifies and the ghost
  // re-tints. Empty = the part's per-kind defaults (zero clicks to place a default part).
  let armedConfig = $state<Partial<Component>>({});
  // Quick-recall hotbar: nine configured-part slots (index 0..8 ↔ keys 1..9), plus the
  // Q pipette. A filled slot remembers a part's kind + its tuned config (the
  // PLACEMENT_OVERRIDE_KEYS subset — value/wiper/temp and the identity-quality axes), so
  // pressing its digit re-arms that exact part for place-and-repeat. Reassigned (never
  // mutated in place) so `$state` notifies. Persisted in settings (see persistSettings).
  let hotbar = $state<HotSlot[]>(Array(9).fill(null));
  // The multimeter function in Measure mode: voltmeter or ammeter.
  let probeMode = $state<"V" | "A">("V");
  // The board's detail lens (the owner's three tiers): schematic symbols always; in
  // analogy/reality a part morphs into its full-panel illustration once zoomed in.
  let boardLens = $state<DiagramMode>("schematic");
  // Fallback kind for native drag-and-drop from the bin (set on dragstart).
  let dragKind = "V";
  let leftTab = $state<"parts" | "examples">("parts");
  let partSearch = $state("");
  // Resizable parts-bin column: width in px, drag the handle on its right edge. Persisted so the player's
  // choice sticks (the default 264px clips a subassembly row's full control set — Edit/Characterize/Tape
  // out/rename/remove — so widening reveals rename + remove). Clamped to a sane range.
  const BIN_W_MIN = 220;
  const BIN_W_MAX = 560;
  let workspaceEl = $state<HTMLDivElement | null>(null);
  let binW = $state(
    (() => {
      try {
        const v = Number(localStorage.getItem("cec-bin-w"));
        return v >= BIN_W_MIN && v <= BIN_W_MAX ? v : 264;
      } catch {
        return 264;
      }
    })(),
  );
  let binResizing = $state(false);
  function startBinResize(e: PointerEvent): void {
    binResizing = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onBinResize(e: PointerEvent): void {
    if (!binResizing || !workspaceEl) return;
    const left = workspaceEl.getBoundingClientRect().left;
    binW = Math.max(BIN_W_MIN, Math.min(BIN_W_MAX, e.clientX - left));
  }
  function endBinResize(e: PointerEvent): void {
    if (!binResizing) return;
    binResizing = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    try {
      localStorage.setItem("cec-bin-w", String(Math.round(binW)));
    } catch {
      /* ignore quota / disabled storage */
    }
  }
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
  // Selected COMPONENT count (vs selCount which adds wires) — gates the overworld "Make subassembly".
  let selComponentCount = $state(0);
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
  // The colour the open editor's net is pinned to (PIXI hex int), or null for
  // "Auto" (the default voltage colour). Seeded from the existing label when the
  // editor opens; threaded back through commitLabel on commit.
  let labelEditColor = $state<number | null>(null);
  let labelInput = $state<HTMLInputElement>();
  // IC-maker die editor: the open port-pad name editor (a small input over a die frame's perimeter
  // pin), or null when closed. `number` is the package pin number, shown as the placeholder/fallback.
  let pinNameEdit = $state<{
    componentId: number;
    pinIndex: number;
    number: number;
    rect: AnchorRect;
  } | null>(null);
  let pinNameValue = $state("");
  let pinNameInput = $state<HTMLInputElement>();
  // The die port-pad popover also sets the pad's TEST STIMULUS (authoring-only). These mirror the
  // current role (`"none"` = no stimulus) + value (volts, for VCC/IN) into the controls; the
  // container ref backs the guarded blur (clicking a role button must NOT blur-close the name input).
  let pinTestRole = $state<PinTestRole | "none">("none");
  let pinTestValue = $state(5);
  let pinNamePopover = $state<HTMLDivElement>();
  // Set when the circuit can't actually solve (e.g. a current source with no
  // return path) so the HUD can warn instead of showing a meaningless reading.
  let circuitWarning = $state<string | null>(null);
  // Info drawer: the deep explanatory view of the selected part + calculators.
  let infoOpen = $state(false);
  let infoTab = $state<"info" | "calc">("info");
  // The numbers shown in the inspector/HUD: the selected part's live state, but swapped
  // for its measured RMS values once the part's AC reverses faster than the eye can read
  // (`selRmsMode`), so a clean number stays legible at speed — like a DMM (which can't
  // track it either). Null when no part is selected.
  let selDisplay = $state<ElectricalState | null>(null);
  let selRmsMode = $state(false);
  // Apparent rate (Hz, scaled by playback speed) above which the live numbers flail
  // unreadably and the inspector switches to the RMS read.
  const READOUT_RMS_HZ = 4;
  let infoDiagram: InfoDiagram | undefined;
  // The diagram picture: the schematic symbol, or the construction-internals
  // ("what's happening inside") view. Defaults to the detail view; the toggle
  // below flips it, and it snaps back to detail when a fresh detail-capable part
  // is selected (see the $effect). Falls back to schematic for kinds with no
  // detail drawer — `diagramHasDetail` gates the toggle's visibility.
  let diagramMode = $state<DiagramMode>("reality");
  // The kind the info drawer describes: the SELECTED placed part, or — when nothing is
  // selected but a part is ARMED — the armed part, so you can preview its symbol / internals
  // / pinout / equation BEFORE dropping it (arm-and-preview; press I or the bin ⓘ while armed).
  const infoKind = $derived<string | null>(
    selPart ? selPart.kind : (armedPart ?? null),
  );
  // True while the drawer is previewing an armed-but-unplaced part (no live electrical state).
  const infoPreview = $derived(!selPart && armedPart != null);
  // Which tiers the current info kind actually has distinct art for (a pure read of the
  // kind). The schematic tier always exists; the others gate their toggle button.
  const diagramHasDetail = $derived(infoKind ? hasDetail(infoKind) : false);
  // The analogy tier renders the full-panel illustration when one exists, else the
  // board's Factory glyph — so it's available when EITHER is present.
  const diagramHasFactory = $derived(
    infoKind ? hasFactory(infoKind) || hasAnalogy(infoKind) : false,
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
    const kind = infoKind;
    // Default the info diagram to the board's active lens on each new selection (or armed
    // (still freely toggleable after). The lens is read untracked so changing the
    // board lens alone doesn't yank a manually-chosen info tab; effectiveDiagramMode
    // clamps outward to schematic when that tier's art doesn't exist for the kind.
    if (kind) diagramMode = untrack(() => boardLens);
  });

  // ── Component Codex ─────────────────────────────────────────────────────────
  // The full-screen "discovery museum": a browsable, exhaustive per-component
  // reference (master list + a detail pane that renders EVERY datum the model
  // carries for the selected kind). Web/render-only — it reads the same modules the
  // inspector does (via lib/codex.ts) and never touches the sim, netlist, or wasm.
  let codexOpen = $state(false);
  // The kind the detail pane describes; defaults to the first catalog kind when opened.
  let codexKind = $state<string | null>(null);
  // Master-list filter (name / tag / desc / synonym), mirroring the bin's `partSearch`.
  let codexSearch = $state("");
  // The codex's own diagram tier toggle, independent of the info drawer's.
  let codexDiagramMode = $state<DiagramMode>("schematic");
  // The grouped master list (every kind placed in its category, in display order).
  const codexGroups = codexCategories();
  // Which tiers the selected codex kind has distinct art for (gates the toggle, exactly
  // like the info drawer) and the clamped tier the diagram actually renders.
  const codexHasDetail = $derived(codexKind ? hasDetail(codexKind) : false);
  const codexHasFactory = $derived(
    codexKind ? hasFactory(codexKind) || hasAnalogy(codexKind) : false,
  );
  const effectiveCodexMode = $derived<DiagramMode>(
    codexDiagramMode === "reality" && !codexHasDetail
      ? "schematic"
      : codexDiagramMode === "analogy" && !codexHasFactory
        ? "schematic"
        : codexDiagramMode,
  );
  // Open the Codex (defaulting the selection to the first catalog kind), or close it.
  function openCodex(): void {
    if (!codexKind) codexKind = codexGroups[0]?.kinds[0] ?? null;
    codexOpen = true;
  }
  // Pick a kind in the master list; reset its diagram to the schematic symbol.
  function selectCodexKind(kind: string): void {
    codexKind = kind;
    codexDiagramMode = "schematic";
  }
  // The Codex's own InfoDiagram (one Pixi sub-app per mounted canvas, destroyed on
  // close to avoid leaks). The frame loop drives it when the overlay is open.
  let codexDiagram: InfoDiagram | undefined;
  function codexDiagramAction(node: HTMLCanvasElement) {
    const d = new InfoDiagram();
    codexDiagram = d;
    void d.init(node);
    return {
      destroy() {
        d.destroy();
        if (codexDiagram === d) codexDiagram = undefined;
      },
    };
  }
  // The filtered master groups when a search is active (name/tag/desc/synonym), else null.
  const codexFiltered = $derived.by(() => {
    const q = codexSearch.trim().toLowerCase();
    if (!q) return null;
    const match = (kind: string): boolean => {
      const name = (PART_KINDS[kind]?.name ?? "").toLowerCase();
      const desc = (CODEX_META[kind]?.desc ?? "").toLowerCase();
      return (
        name.includes(q) ||
        kind.toLowerCase().includes(q) ||
        desc.includes(q) ||
        (CODEX_SYNONYMS[kind] ?? []).some((s) => s.includes(q))
      );
    };
    const out: { category: string; kinds: string[] }[] = [];
    for (const g of codexGroups) {
      const kinds = g.kinds.filter(match);
      if (kinds.length > 0) out.push({ category: g.category, kinds });
    }
    return out;
  });

  /** Persist settings: the onboarding slice (mute + which cards have fired) plus the
   * board lens (tier toggle), the LOD toggle, and the camera (pan + zoom) — so the
   * view and the toggles survive a refresh. */
  function persistSettings(): void {
    saveSettings({
      v: 1,
      seenIntro: !showIntro,
      explainAsYouGo,
      seenConcepts: [...seenConcepts],
      boardLens,
      lodOn,
      camera: board?.getCamera(),
      hotbar,
    });
  }
  // Debounced settings save for the camera (pan/zoom fire many events per second);
  // a trailing timer collapses a whole gesture into one write.
  let settingsSaveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSettingsSave(): void {
    if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(persistSettings, 600);
  }
  // Last camera signature seen, so a moved view triggers exactly one debounced save.
  let lastCamKey = "";
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
    const u =
      selPart.kind === "LOAD"
        ? loadUnit(selLoadMode())
        : PART_KINDS[selPart.kind]?.unit;
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
  // The floating-inspector phasor (Canvas2D): the action just captures the canvas; the
  // frame loop redraws it from the selected part's AC reading + the board's flow clock.
  let hudPhasorCanvas: HTMLCanvasElement | undefined;
  let hudPhasorCtx: CanvasRenderingContext2D | undefined;
  function hudPhasorAction(node: HTMLCanvasElement) {
    hudPhasorCanvas = node;
    hudPhasorCtx = node.getContext("2d") ?? undefined;
    return {
      destroy() {
        if (hudPhasorCanvas === node) {
          hudPhasorCanvas = undefined;
          hudPhasorCtx = undefined;
        }
      },
    };
  }
  function drawHudPhasor(phase: number): void {
    const c = hudPhasorCanvas;
    const ctx = hudPhasorCtx;
    const ac = selDisplay?.ac;
    if (!c || !ctx || !ac?.valid) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = c.clientWidth || 64;
    const cssH = c.clientHeight || 64;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPhasor2D(ctx, cssW, cssH, ac, phase);
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
  // The wasm handle, hoisted so the Bode panel can run an on-demand AC sweep.
  let simHandle: SimHandle | undefined;
  // Bode (frequency-domain) panel state, recomputed on each real circuit change.
  let bodeSweep = $state<Float64Array | undefined>(undefined);
  let bodeNodeCount = $state(0);
  let bodeHasAc = $state(false);
  // Phase-domain scope state: the complex node voltages at the dominant source frequency (one
  // `acSweep` point), the analysis frequency itself, and the sweeping play-head phase. Lets the
  // scope draw V(θ) over one cycle at ANY frequency — including the MHz the transient can't step.
  let phaseSweep = $state<Float64Array | undefined>(undefined);
  let phaseScopeFreq = $state(0);
  let phaseHead = 0; // play-head phase, advanced each frame (plain — not reactive)
  // Frequency-domain per-element AC measurements (same layout as the time-domain `acMeasurements`)
  // at the source frequency, cached when the source is above the time-domain measurement ceiling.
  // `onFrame` substitutes it so the board's shimmer/phasor render works at MHz. Plain (not $state):
  // read each frame, written on edit/fidelity-toggle. The 2 µs step resolves AC to ~62.5 kHz
  // (≥8 samples/cycle); above that the running `AcMeas` can't lock a cycle and reads invalid.
  let fdAc: Float64Array | undefined;
  const TIME_DOMAIN_AC_CEILING_HZ = 62_500;
  // Component fidelity for the AC analysis: false = ideal parts, true = Real parasitics
  // (cap ESL/ESR + inductor DCR/winding-C self-resonance). Analysis-only — never touches
  // the transient sim or the snapshot hash.
  let realModels = $state(false);
  // 1 Hz … 1 GHz log sweep — wide enough for both the low-frequency filter corners and the
  // MHz-scale self-resonant frequencies the Real models expose. The frequency-domain solve
  // has no Nyquist limit, so a "1 GHz" reading is honest here. Fixed list, reused each sweep.
  const BODE_FREQS = logFreqs(1, 1e9, 240);
  // Recompute the Bode sweep off the netlist the sim holds (component scope so the
  // Ideal/Real toggle can re-run it too). A no-op without an AC source.
  const recomputeBode = (nodeCount: number): void => {
    if (!simHandle || !bodeHasAc || nodeCount < 2) {
      bodeSweep = undefined;
      return;
    }
    bodeNodeCount = nodeCount;
    bodeSweep = simHandle.acSweep(Float64Array.from(BODE_FREQS), realModels);
  };
  // Phase scope: one AC-solve point at the dominant source frequency → the complex node
  // voltages the scope unrolls into V(θ). A no-op without an AC/pulse source or a frequency.
  const recomputePhaseScope = (nodeCount: number): void => {
    if (!simHandle || !bodeHasAc || phaseScopeFreq <= 0 || nodeCount < 2) {
      phaseSweep = undefined;
      fdAc = undefined;
      return;
    }
    bodeNodeCount = nodeCount;
    phaseSweep = simHandle.acSweep(
      Float64Array.from([phaseScopeFreq]),
      realModels,
    );
    // Above the time-domain measurement ceiling (~62.5 kHz, where the 2 µs step can't resolve a
    // cycle so the per-frame `acMeasurements` go invalid), precompute the FREQUENCY-domain
    // per-element AC measurements at the source frequency. `onFrame` swaps these into the render
    // so the board still shows current/phase (shimmer + phasor) at 100 kHz–MHz instead of dying.
    // Recomputed only on edit / fidelity toggle (static between them), like the Bode/phase scope.
    fdAc =
      phaseScopeFreq > TIME_DOMAIN_AC_CEILING_HZ
        ? simHandle.acElementMeasurements(
            2 * Math.PI * phaseScopeFreq,
            realModels,
          )
        : undefined;
  };
  // The Bode canvas: the action captures it; a redraw runs whenever the sweep or the
  // per-node visibility changes (not per-frame — the response is static between edits).
  let bodeCanvas: HTMLCanvasElement | undefined;
  let bodeCtx: CanvasRenderingContext2D | undefined;
  function bodeAction(node: HTMLCanvasElement) {
    bodeCanvas = node;
    bodeCtx = node.getContext("2d") ?? undefined;
    drawBodeCanvas();
    return {
      destroy() {
        if (bodeCanvas === node) {
          bodeCanvas = undefined;
          bodeCtx = undefined;
        }
      },
    };
  }
  function drawBodeCanvas(): void {
    const c = bodeCanvas;
    const ctx = bodeCtx;
    const sweep = bodeSweep;
    if (!c || !ctx || !sweep) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = c.clientWidth || 240;
    const cssH = c.clientHeight || 130;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBode(ctx, cssW, cssH, sweep, {
      freqs: BODE_FREQS,
      nodeCount: bodeNodeCount,
      color: (node) => channelColor(node),
      visible: (node) => nodeVisible[node] ?? true,
    });
  }
  $effect(() => {
    // Track the inputs so an edit (new sweep) or a node toggle repaints the plot.
    void bodeSweep;
    void nodeVisible;
    drawBodeCanvas();
  });
  // The phase scope canvas: same action/redraw shape as the Bode, but it also repaints every
  // frame so the play-head sweeps (the traces are static between edits; the cursor moves).
  let phaseCanvas: HTMLCanvasElement | undefined;
  let phaseCtx: CanvasRenderingContext2D | undefined;
  function phaseScopeAction(node: HTMLCanvasElement) {
    phaseCanvas = node;
    phaseCtx = node.getContext("2d") ?? undefined;
    drawPhaseScopeCanvas();
    return {
      destroy() {
        if (phaseCanvas === node) {
          phaseCanvas = undefined;
          phaseCtx = undefined;
        }
      },
    };
  }
  function drawPhaseScopeCanvas(): void {
    const c = phaseCanvas;
    const ctx = phaseCtx;
    const data = phaseSweep;
    if (!c || !ctx || !data) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = c.clientWidth || 240;
    const cssH = c.clientHeight || 110;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPhaseScope(ctx, cssW, cssH, data, {
      nodeCount: bodeNodeCount,
      color: (node) => channelColor(node),
      visible: (node) => nodeVisible[node] ?? true,
      freq: phaseScopeFreq,
      playhead: phaseHead,
    });
  }
  $effect(() => {
    void phaseSweep;
    void nodeVisible;
    drawPhaseScopeCanvas();
  });
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
    PARTS.find((p) => p.tag === tag)?.name ?? PART_KINDS[tag]?.name ?? tag;

  // --- Personal IC library ("My ICs" bin category) ------------------------------------------------
  // REGISTRY / PART_KINDS / FAMILIES (userIc.ts) are plain module globals, so the bin won't react to a
  // registry mutation on its own. `libRev` is a $state counter bumped on every library mutation (seal,
  // reseal, delete, rename); the "My ICs" rows derive from it. The library itself is persisted in
  // localStorage (userLibrary.ts) — this is a per-board-reset-proof personal store.
  let libRev = $state(0);
  /** Sync a placeable tag into the library and re-derive the bin rows (post-seal / reseal). */
  function syncLibrary(tag: string, source: "sealed" | "imported"): void {
    addToLibrary(tag, source);
    libRev++;
  }
  /** Shape one library row as a PARTS row (so `partRow` renders it) + a `glyphKind` (package tag) for
   * the pin-ring thumbnail. Shared by the "My ICs" and "My Subassemblies" bins. */
  function libRow(e: LibraryEntry) {
    const tag = e.variants ? familyTagOf(e) : e.ic.tag;
    const n = e.variants ? e.variants.length : 0;
    return {
      tag,
      name: e.name ?? e.ic.name,
      desc:
        `${e.ic.package.archetype} · ${e.ic.package.pinCount}-pin` +
        (n > 1 ? ` · ${n} variants` : ""),
      // The derived SSI→ULSI integration-tier badge (device count over the cell's full expansion),
      // shown in the row's tier slot so the bin reads at a glance how big a part is.
      tier: integrationTier(e.ic),
      color: "var(--accent)",
      glyphKind: tag,
      // Subassembly rows get a "Tape out" control (promote → board IC); IC rows don't.
      isSubassembly: entryRole(e) === "subassembly",
    };
  }
  /** The "My ICs" rows: board-placeable library entries (role !== 'subassembly'), most-recent first. */
  const savedIcParts = $derived.by(() => {
    void libRev; // reactivity dependency: re-run when the library mutates
    return libraryEntries()
      .filter((e: LibraryEntry) => entryRole(e) !== "subassembly")
      .map(libRow);
  });
  /** The "My Subassemblies" rows: bare, nested-only entries (role === 'subassembly'). Hidden from the
   * board parts bin; offered only inside the die-editor place flow (§4.3 / §4.9). Promoted to a board
   * IC via Tape out (P3b). */
  const savedSubassemblyParts = $derived.by(() => {
    void libRev;
    return libraryEntries()
      .filter((e: LibraryEntry) => entryRole(e) === "subassembly")
      .map(libRow);
  });
  /** A family library row's family tag (strip the `#i` suffix off its variant-0 child tag). */
  function familyTagOf(e: LibraryEntry): string {
    const child = e.variants?.[0]?.tag ?? e.ic.tag;
    const h = child.indexOf("#");
    return h >= 0 ? child.slice(0, h) : child;
  }
  /** A tiny pin-ring thumbnail (inline SVG) of a kind's footprint, for a "My ICs" row glyph: the
   * package body as a rounded rect with a dot per lead, normalised into a 30×30 box. Render-only. */
  const GLYPH_BOX = 30; // the .part-glyph is 30px tall (app.css)
  function packageGlyphPins(tag: string): { cx: number; cy: number }[] | null {
    const k = PART_KINDS[tag];
    if (!k || k.pins.length === 0) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of k.pins) {
      minX = Math.min(minX, p.dx);
      maxX = Math.max(maxX, p.dx);
      minY = Math.min(minY, p.dy);
      maxY = Math.max(maxY, p.dy);
    }
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const inner = GLYPH_BOX - 8; // 4px margin each side
    const s = inner / Math.max(w, h);
    // Centre the scaled footprint in the box.
    const ox = (GLYPH_BOX - w * s) / 2;
    const oy = (GLYPH_BOX - h * s) / 2;
    return k.pins.map((p) => ({
      cx: ox + (p.dx - minX) * s,
      cy: oy + (p.dy - minY) * s,
    }));
  }
  // --- "My ICs" per-row management: rename + remove. `renamingTag` is the row being inline-renamed
  // (null = none); committing writes `renameLibraryIc` (display name only — the tag, and so every placed
  // instance, is stable) and bumps `libRev` to re-derive the bin. Remove drops the library row but
  // NEVER unregisters the kind (gap #7), so placed copies keep working + re-appear if you reload a board
  // that embeds the def. ---
  let renamingTag = $state<string | null>(null);
  let renameValue = $state("");
  function startRenameIc(tag: string, name: string): void {
    renamingTag = tag;
    renameValue = name;
  }
  function commitRenameIc(): void {
    const tag = renamingTag;
    renamingTag = null;
    if (!tag) return;
    const nm = renameValue.trim();
    if (nm) {
      renameLibraryIc(tag, nm);
      libRev++;
    }
  }
  function removeIc(tag: string, name: string): void {
    if (
      !confirm(
        `Remove “${name}” from My ICs?\n\nAny copies already placed keep working and re-appear if you reload a board that uses it.`,
      )
    )
      return;
    if (renamingTag === tag) renamingTag = null;
    removeFromLibrary(tag);
    libRev++;
  }
  /** Tape out a subassembly → board-placeable IC (§4.5). Promotes the def (role → 'ic'; keeps its
   * package — the cell was authored in one), re-clones it into the library row so it moves from My
   * Subassemblies to My ICs, and refreshes the bin. (Choosing a different package at tape-out is a
   * follow-up once box-capture (P4) ships subassemblies without a chosen body.) */
  function tapeOutIc(tag: string): void {
    const promoted = tapeOut(tag);
    if (!promoted) return;
    addToLibrary(tag, "sealed"); // re-clone the now-'ic' def → the row re-files under My ICs
    libRev++;
  }

  /** The truth-table panel for a freshly characterized cell (the sweep result, kept open so the player can
   * read the table + the recognized gate). Null when no characterization is on screen. */
  interface CharPanel {
    tag: string;
    name: string;
    /** input-column indices `[0, 1, …, k-1]` (precomputed so the header iterates a dense array). */
    cols: number[];
    /** every input combination + its settled output, in index order. */
    vectors: SweepVector[];
    /** the assembled prog-4 LUT word (shown in hex). */
    word: number;
    /** the recognized Boolean function ("NAND") or null for an unnamed/≥3-input table. */
    gate: string | null;
  }
  let charResult = $state<CharPanel | null>(null);

  /**
   * Characterize a player-built COMBINATIONAL subassembly (§2.9, the engine's "1"): sweep every input
   * combination through a SCRATCH Simulation ({@link characterizeCell}), assemble the prog-4 LUT
   * truth-table word, store it on the def via {@link setUserIcBehavior} (so a behavioral-fidelity instance
   * collapses to one cheap LUT in `flattenUserIcs`), and surface the truth table so the player can verify
   * what the gate computes. App-only — it spins up a second, throwaway wasm Simulation, so the running
   * (hashed) sim and the golden are untouched. Refuses (via `circuitWarning`) a cell that isn't a
   * tag-able ≤4-input gate or won't solve.
   */
  function characterizeIc(tag: string): void {
    const ic = getUserIc(tag);
    if (!ic) return;
    let res: ReturnType<typeof characterizeCell>;
    try {
      res = characterizeCell(ic.graph, ic.frameId, ic.pinRoles ?? []);
    } catch (err) {
      circuitWarning = `Couldn't characterize “${ic.name || partName(tag)}”: ${
        err instanceof Error ? err.message : String(err)
      }`;
      charResult = null;
      return;
    }
    if (!res.ok) {
      circuitWarning = `Can't characterize “${ic.name || partName(tag)}”: ${res.reason}.`;
      charResult = null;
      return;
    }
    circuitWarning = null;
    setUserIcBehavior(tag, res.behavior); // bind the swept word to the def (collapse can now fire)
    libRev++;
    charResult = {
      tag,
      name: ic.name || partName(tag),
      cols: [...Array(res.inputs).keys()],
      vectors: res.vectors,
      word: res.behavior.word,
      gate: recognizeGate(res.behavior.word, res.inputs),
    };
  }
  // A kind's identity colour as a CSS custom-property reference (from PART_KINDS'
  // palette key), the same idiom the codex rows use — for the hotbar glyph tint.
  const partColor = (tag: string): string =>
    `var(--${PART_KINDS[tag]?.colorKey ?? "bronze"})`;
  // True when a hotbar slot mirrors the currently armed part + its captured config,
  // so the strip highlights the live slot. Compares the kind and the
  // PLACEMENT_OVERRIDE_KEYS-projected config (order-independent, value-equal).
  const slotIsArmed = (slot: HotSlot): boolean => {
    if (!slot || armedPart !== slot.kind) return false;
    const live = partConfigOf({ kind: armedPart, ...armedConfig });
    const keys = new Set([...Object.keys(live), ...Object.keys(slot.config)]);
    for (const k of keys) {
      if (
        (live as Record<string, unknown>)[k] !==
        (slot.config as Record<string, unknown>)[k]
      )
        return false;
    }
    return true;
  };

  // One-line contextual hint that replaces the old mode buttons: it tells you
  // what a click will do right now, so the modeless board stays learnable.
  const hint = $derived(
    mode === "pan"
      ? "PAN · drag anywhere to move the view — it won't select or grab anything · pick a tool (B/W/J/L/M) to build · Esc → Build"
      : mode === "measure"
        ? probeMode === "A"
          ? "AMMETER · click a part/wire to clamp it and read the current through it (the voltmeter stays put — both can be live)"
          : "VOLTMETER · click two points to read ΔV (one point = vs GND) · the ammeter stays put alongside it"
        : mode === "junction"
          ? "JUNCTION · click a wire to drop a junction · move or remove junctions in the Build tool"
          : mode === "label"
            ? "LABEL · click a pin, junction, or trace to name its net · same name elsewhere = same net (no wire) · right-click a tag to delete"
            : armedPart
              ? hasConfig(armedPart)
                ? `PLACING ${partName(armedPart)} · set its type below, then click to drop · R rotate · F flip · Esc cancel`
                : `PLACING ${partName(armedPart)} · click to drop · R rotate · F flip · Esc cancel`
              : "BUILD · arm & click to place · drag a pin to wire · drag a wire to bend · drag a junction to move it (Del/right-click removes it, keeping the wire) · Alt-click reaches a wire behind a part",
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
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "f" || e.key === "F")) {
        // F mirrors (horizontal flip): the armed-part ghost if a part is armed, else the
        // current selection. (Paste has no per-group flip — its parts carry their own.)
        if (armedPart) board?.flipArmed();
        else board?.flipSelection();
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
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "g" || e.key === "G")) {
        if (!drill) enterRegion(); // g = Region (draw a box → free-form subassembly); outer board only
        e.preventDefault();
      } else if (e.key === "Escape") {
        // Universal cancel, in order of least-destructive first: a first Esc just
        // closes the open info drawer (without dropping your armed part or
        // selection). Otherwise it disarms a part, cancels any in-progress wire /
        // open label editor / selection, then returns to Build (the default editing
        // tool) so Escape leaves you ready to build — never in the inert Pan tool
        // (Pan is opt-in: the only way in is to pick it with H or the toolbar).
        if (codexOpen) {
          // The Codex is a full-screen modal — Escape closes it first, before any
          // board action (it sits in front of everything else).
          codexOpen = false;
        } else if (infoOpen) {
          infoOpen = false;
        } else {
          if (armedPart) arm(null);
          board?.escape();
          setMode("select");
        }
        e.preventDefault();
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "h" || e.key === "H")) {
        setMode("pan"); // H = the hand / pan tool
        e.preventDefault();
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "i" || e.key === "I")) {
        infoOpen = !infoOpen; // I = toggle the deep info panel (selection, or an armed preview)
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
      } else if (!e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)) {
        // Hotbar 1–9: Shift+N stores the armed part into slot N, plain N recalls it.
        // Keyed off e.code so Shift+digit (which produces "!"/"@"/… in e.key on many
        // layouts) still maps to the right slot. (0 is reserved for fit-view.)
        const slot = Number(e.code.slice(5)) - 1;
        if (e.shiftKey) assignSlot(slot);
        else armFromSlot(slot);
        e.preventDefault();
      } else if (!e.ctrlKey && !e.metaKey && (e.key === "q" || e.key === "Q")) {
        pipette(); // Q = pipette: eyedrop the selected part's kind + config and arm it
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
      simHandle = sim;
      proto = sim.protocolVersion();

      // Compile the board into a netlist and install it whenever the topology or
      // a value changes. Pure moves leave the signature unchanged, so dragging a
      // part around never resets the running simulation.
      let netlist: BuiltNetlist | null = null;
      let netlistSig = "";
      const rebuildNetlist = (graph: BoardGraph): void => {
        // While drilled into a die, solve the graph with the frame's TEST STIMULI injected (so a
        // power-fed IC powers up + animates in isolation); on the outer board, solve as-is. The
        // injection is a strict no-op when no stimuli are set. Authoring-only — never sealed.
        const nl = buildNetlist(
          drill ? dieSolveGraph(graph, drill.innerFrameId) : graph,
          realModels,
        );
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
        // Per-net circuit grouping so each voltage gauge scales to its OWN circuit's max rail
        // (two separate boards don't share a "highest voltage" reference).
        board?.setCircuitOfNode(nl ? nl.circuitOfNode : null);
        // Composite-IC internals (component id → sub-circuit topology) so a sealed chip can open
        // to its live internals when zoomed in under the reality lens (ADR 0005, zoom-to-open).
        board?.setCompositeInternals(nl ? nl.compositeInternals : null);
        // Sealed USER-IC inner circuits (component id → authored parts/wires) so a placed sealed
        // chip opens to a scaled miniature of the exact circuit the player drew, when zoomed in.
        board?.setUserIcInternals(nl ? nl.userIcInternals : null);
        // Surface the net-label names (node index → name) so the scope legend and
        // the telemetry "Nodes" list can show `VCC` instead of `Node 3`.
        board?.setNetNames(nl ? nl.nodeNames : null);
        // Surface the per-net colour overrides (node index → PIXI hex int) so a
        // labelled net paints its pinned colour instead of its voltage colour.
        board?.setNodeColors(nl ? nl.nodeColors : null);
        netNames = nl ? Object.fromEntries(nl.nodeNames) : {};
        if (nl) {
          // Pass the control-terminal array `c` (MOSFET gate / gate IN2; 0 for 2-pin
          // parts), the second scalar `aux` (AC amplitude / gate function code), the
          // fourth terminal `d` (a transformer's secondary− node; 0 elsewhere), the fifth
          // `e` (a powered gate's GND), and the provisioned sixth/seventh/eighth terminals
          // `f`/`g`/`h` (ADR 0002 — all-ground today, no part uses them yet). setNetlist
          // takes c, aux, d, params, e, f, g, h as trailing optionals.
          sim.setNetlist(
            nl.nodeCount,
            nl.types,
            nl.a,
            nl.b,
            nl.values,
            nl.c,
            nl.aux,
            nl.d,
            nl.params,
            nl.e,
            nl.f,
            nl.g,
            nl.h,
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
        // Refresh the Bode sweep + phase scope off the netlist the sim now holds (no-op without
        // an AC/pulse source).
        recomputeBode(nl ? nl.nodeCount : 0);
        recomputePhaseScope(nl ? nl.nodeCount : 0);
      };

      const b = new Board(a, {
        onChange: (graph: BoardGraph) => {
          partCount = graph.components.size;
          wireCount = graph.wires.size;
          canUndo = b.canUndo();
          // A persisted region rectangle follows the circuit live — refresh its boundary pins whenever
          // the board changes (a no-op unless a region is pending). Lets you draw a box, wire/edit with
          // the pins updating, then come back and seal.
          b.refreshRegionOverlay();
          // Onboarding facts: has the player placed a source / a ground yet? (Drives
          // the first-encounter concept cards via their $effect triggers.)
          let src = false;
          let gnd = false;
          let acSrc = false;
          let maxAcFreq = 0;
          for (const c of graph.components.values()) {
            if (c.kind === "V" || c.kind === "AC" || c.kind === "I") src = true;
            // Both the AC source and the pulse/clock generator are AC stimuli (PULSE maps to
            // the AC-source element), so either drives the frequency-domain tools.
            if (c.kind === "AC" || c.kind === "PULSE") {
              acSrc = true;
              maxAcFreq = Math.max(maxAcFreq, c.value);
            }
            if (c.kind === "GND") gnd = true;
          }
          hasSource = src;
          // The Bode sweep and the phase scope need an AC stimulus (set before rebuildNetlist
          // below, which recomputes them once the new netlist is installed). The phase scope
          // analyses at the dominant source frequency (the highest AC/PULSE source).
          bodeHasAc = acSrc;
          phaseScopeFreq = maxAcFreq;
          hasGround = gnd;
          // Bump the board revision so the die seal advisory (`dieStatus`) re-derives even on an
          // edit that doesn't change the part/wire counts — e.g. setting a pad's TEST STIMULUS.
          boardRev++;
          rebuildNetlist(graph);
          advanceBuild(graph);
          // Persist the current board so a refresh restores it (debounced) — but NOT while drilled
          // into a die: that graph is the inner IC circuit, and saving it would overwrite the outer
          // board in localStorage. The outer board is re-persisted on exit. The in-progress dies of
          // any placed frame ride along (so re-drilling a frame after a refresh resumes its WIP).
          if (!drill) {
            const snap = graph.serialize();
            saveBoardDebounced(snap, innerDiesForSaveOf(snap));
          }
          // Any edit — place, move, rotate, rewire, or a value change — rewinds
          // the scope and the clock to t=0 so you always watch the new circuit
          // from the start rather than mid-flight in the old one.
          controls?.restart();
          syncRunning();
        },
        onSelect: (sel) => {
          selCount = sel.components + sel.wires;
          selComponentCount = sel.components;
          selPart = sel.single ?? null;
          // Reset the IC-maker Seal name field when the selection changes, so a name typed for one
          // frame doesn't bleed onto the next.
          sealName = "";
        },
        onArm: (kind) => {
          // The board disarmed itself (right-click) — mirror it into the HUD, and drop
          // the configurator choices so the panel closes with it.
          armedPart = kind;
          if (kind === null) armedConfig = {};
        },
        onRegion: (info) => {
          // The live region tool's pending rectangle changed (drawn / resized / cleared) — mirror its
          // pin count + refusal into the HUD so the "Seal region" panel can show/explain.
          regionInfo = info;
        },
        onPersist: (graph) => {
          // A cosmetic change (e.g. a net label dragged): save it + refresh undo,
          // but don't rebuild the netlist or rewind the running sim. Suppressed while drilled into a
          // die (the inner graph must not overwrite the outer board's localStorage entry).
          canUndo = b.canUndo();
          if (!drill) {
            const snap = graph.serialize();
            saveBoardDebounced(snap, innerDiesForSaveOf(snap));
          }
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
            // Seed the swatch from the label's pinned colour (null ⇒ Auto).
            labelEditColor = req.initialColor;
            // Focus + select the input next tick, once it has rendered.
            setTimeout(() => labelInput?.focus(), 0);
          } else {
            labelEdit = null;
          }
        },
        onPinNameEdit: (req) => {
          if (req) {
            pinNameEdit = {
              componentId: req.componentId,
              pinIndex: req.pinIndex,
              number: req.number,
              rect: req.rect,
            };
            pinNameValue = req.initial;
            // Seed the TEST STIMULUS controls from the pad's current stimulus (none → the defaults).
            pinTestRole = req.test ? req.test.role : "none";
            pinTestValue = req.test ? req.test.value : 5;
            setTimeout(() => pinNameInput?.focus(), 0);
          } else {
            pinNameEdit = null;
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
          // Tell the render the on-screen apparent-rate scale (sim-seconds advanced per
          // real second = tps · DT), so the shimmer↔carrier handoff tracks the playback
          // speed: slow the tickrate and a fast AC slips back to visible sloshing; speed
          // it up and it returns to a shimmer. Module flag read by the tier drawers.
          setApparentRateScale(tps * DT_SECONDS);
          // Persist the camera (pan + zoom) when it moves — debounced so a pan/zoom
          // gesture collapses into one write, and the view is restored on refresh. Suppressed while
          // drilled into a die: that camera is the die's view, and persisting it would restore the
          // outer board at the die's pan/zoom on refresh (the outer camera is restored on exit).
          const cam = b.getCamera();
          const camKey = `${Math.round(cam.x)},${Math.round(cam.y)},${cam.scale.toFixed(3)}`;
          if (camKey !== lastCamKey && !drill) {
            lastCamKey = camKey;
            scheduleSettingsSave();
          }
          // Attribute per-element current and per-net voltage to each component
          // so the glyphs animate with what is actually happening to them.
          // Above the time-domain measurement ceiling, the per-frame `acMeasurements` read invalid
          // (the 2 µs step can't resolve a >62.5 kHz cycle), so substitute the cached
          // frequency-domain per-element measurements (`fdAc`) — same layout — so the shimmer /
          // phasor render has a valid amplitude/phase to draw at MHz. Below the ceiling the live
          // time-domain reading (which carries the real waveform shape) is kept.
          const acMeas = fdAc ?? snap.acMeasurements;
          const electrical: Map<number, ElectricalState> | undefined =
            netlist && snap.elementCurrents
              ? electricalMap(
                  netlist,
                  snap.state,
                  snap.elementCurrents,
                  snap.failedMask,
                  snap.reactiveCurrents,
                  acMeas,
                  snap.acFields,
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
            // Once the part's AC reverses faster than the eye/meter can track, swap the
            // inspector to its RMS read so the number is legible (self-adapts to both the
            // signal frequency and the playback speed via the apparent rate).
            selRmsMode =
              !!e.ac?.valid && apparentFreq(e.ac.freq) > READOUT_RMS_HZ;
            selDisplay = selRmsMode ? rmsStabilized(e) : e;
            // Redraw the inspector phasor (no-op unless its canvas is mounted + AC valid).
            drawHudPhasor(b.flowPhase());
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
                selPart.temp,
              );
            }
          } else {
            selDisplay = null;
            selRmsMode = false;
            // Arm-and-preview: nothing selected but a part armed + the drawer open → drive
            // the info diagram from the ARMED (unplaced) kind and a neutral electrical state,
            // so its symbol / internals render before you drop it.
            if (infoOpen && armedPart) {
              infoDiagram?.setMode(effectiveDiagramMode);
              infoDiagram?.setPhase(b.flowPhase());
              infoDiagram?.setState(
                armedPart,
                ZERO_ELECTRICAL,
                partValue(armedPart),
              );
            }
          }
          // The Codex overlay's own diagram: a neutral, reference preview of the
          // selected catalog kind (no live electrical state — the museum is static),
          // driven on the same flow clock so its internals animate the same calm way.
          if (codexOpen && codexKind) {
            codexDiagram?.setMode(effectiveCodexMode);
            codexDiagram?.setPhase(b.flowPhase());
            codexDiagram?.setState(
              codexKind,
              ZERO_ELECTRICAL,
              PART_KINDS[codexKind]?.defaultValue ?? 0,
            );
          }
          hash = snap.snapshotHash;
          channels = Array.from(snap.state);
          // Zoom meter: read the metrics b.update() just latched (camera zoom + the nesting-level
          // fit-scale under the view centre). Primitive assigns — Svelte only repaints on a change.
          const vm = b.getViewMetrics();
          viewZoom = vm.zoom;
          viewScale = vm.viewScale;
          // Sweep the phase-scope play-head on the frame clock (cosmetic, fixed rate — the
          // traces are static between edits) and repaint just that small canvas.
          if (phaseSweep) {
            phaseHead = (phaseHead + 0.05) % (2 * Math.PI);
            drawPhaseScopeCanvas();
          }
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
      // Restore the tier lens, the LOD toggle, and the camera (pan + zoom) so the
      // view and the toggles survive a refresh.
      boardLens = settings.boardLens ?? "schematic";
      lodOn = settings.lodOn ?? true;
      board?.setLens(boardLens);
      board?.setLod(lodOn);
      board?.setCamera(settings.camera);
      // Restore the quick-recall hotbar (defensively: only a genuine 9-slot array, else
      // an empty bar — a stale/short blob never leaves the strip mis-sized).
      hotbar =
        Array.isArray(settings.hotbar) && settings.hotbar.length === 9
          ? settings.hotbar
          : Array(9).fill(null);

      // Register the personal IC library into PART_KINDS / REGISTRY / FAMILIES BEFORE loadBoard /
      // example restore, so a restored board's placed library ICs resolve even if its embedded
      // `userIcs` were trimmed (loadBoard's own registerUserIcs then harmlessly upserts the board's
      // embedded copies on top). Purely additive; an empty library registers nothing (golden-safe).
      registerLibrary();
      libRev++; // surface any library ICs in the "My ICs" bin on first paint

      // Pass the live `innerGraphs` so any persisted in-progress (unsealed) dies are restored into it
      // (cleared first) before the outer board loads — re-drilling a frame then resumes its WIP.
      const saved = loadBoard(innerGraphs);
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
    // Electronic load: its value's unit follows the mode (A in CC, Ω in CR), so read
    // it from `loadUnit(selMode())` rather than the static PART_KINDS unit.
    const u =
      kind === "LOAD"
        ? loadUnit(selLoadMode())
        : (PART_KINDS[kind]?.unit ?? "");
    return u ? formatValue(value, u) : String(value);
  }
  function setVal(v: number): void {
    if (selPart) board?.setComponentValue(selPart.id, v);
  }
  function setLabelText(t: string): void {
    if (selPart) board?.setComponentLabel(selPart.id, t);
  }
  // IC maker (ADR 0006): the optional name typed into the inspector's Seal field. Cleared after a
  // seal (and whenever the selection changes, below) so the next frame starts blank and falls back
  // to the auto CEC9xxx id.
  let sealName = $state("");
  // IC-maker variant families: the family tag the next seal becomes a VARIANT of (the seal panel's
  // "Variant of …" dropdown; "" = a fresh "New IC"). Reset after each seal + when leaving the die.
  let sealVariantOf = $state("");
  // Seal this die as a bare, nested-only SUBASSEMBLY (role='subassembly', §4.3) instead of a
  // board-placeable IC — it lands in "My Subassemblies" and reaches the board only via Tape out.
  let sealAsSubassembly = $state(false);
  /** Whether `tag` is currently a placeable user-IC seal-into target (a family or a single IC that a
   * second seal would promote). Guards the dropdown value against a since-removed target. */
  function hasFamilyTarget(tag: string): boolean {
    return userIcFamilyTargets().some((t) => t.tag === tag);
  }
  // Seal the selected frame + its wired circuit into a placeable sealed IC. The board does the
  // capture + collapse (drops the frame and internals, places the new chip where the frame sat);
  // an empty name lets userIc auto-assign the next CEC9xxx. The board reselects the new instance.
  function sealSelected(): void {
    if (!selPart || !board || !isFrame(selPart.kind)) return;
    const tag = board.sealFrame(selPart.id, sealName.trim() || undefined);
    sealName = "";
    if (tag) syncLibrary(tag, "sealed"); // mirror the sealed kind into the personal library
  }

  // ---------------------------------------------------------------------------
  // IC-maker DIE EDITOR (ADR 0006 / docs/ui/ic-maker-guide.md, lib/dieEditor.ts)
  //
  // "Drill INTO the package to build the IC inside it." Clicking Build on a placed empty FRAME
  // saves the outer board + camera, then swaps the editor to that frame's own inner canvas — a DIE
  // (a frame of the same package, positioned roomily) the player wires their sub-circuit into. The
  // back bar's Seal / Save / Back exit and restore the outer board.
  //
  // The inner graph for each placed frame lives in this in-memory map, keyed by the OUTER frame
  // component id. It IS now persisted with the board: on save, {@link innerDiesForSave} marshals the
  // entries whose frame is still placed into the save's `innerDies` (localStorage + the downloaded
  // JSON); on load, every site rebuilds this map from that field (via {@link restoreInnerDies}) BEFORE
  // restoring the outer board, so re-drilling a frame resumes its half-built circuit. Frame ids are
  // preserved by serialize/restore, so the keys line up again. (The seal itself rides in the save's
  // `userIcs` — the userIc REGISTRY def — from PR #174.)
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive store, only touched in handlers; see above
  const innerGraphs = new Map<number, GraphSnapshot>();

  /** The in-progress (unsealed) dies to embed in a save: the {@link innerGraphs} entries whose frame
   * is still placed in `graph` (so a deleted frame's stale die is dropped). A thin wrapper over the
   * pure {@link innerDiesForSave} so the call sites read cleanly. */
  function innerDiesForSaveOf(graph: GraphSnapshot): InnerDie[] {
    return innerDiesForSave(innerGraphs, graph);
  }

  // A BoardGraph for the live die SOLVE: the inner graph with its frame's TEST STIMULI injected
  // (GND/VCC/Input drive as virtual sources) so a die normally powered from outside its package
  // powers up + passes the Seal gate while authored in isolation. AUTHORING-ONLY — built from a
  // throwaway snapshot, never fed to the seal capture (which reads the RAW live die), so the sealed
  // netlist + the sim-core golden are untouched. A strict no-op when the frame has no stimuli.
  function dieSolveGraph(graph: BoardGraph, frameId: number): BoardGraph {
    const solve = new BoardGraph();
    solve.restore(dieTestGraph(graph.serialize(), frameId));
    return solve;
  }

  // Bumped on every onChange so the die seal advisory ($derived `dieStatus`) refreshes even when an
  // edit doesn't change the component/wire counts it otherwise keys on — notably setting a pin's
  // TEST STIMULUS, which changes the solve (the injected graph) but not the authored part count.
  let boardRev = $state(0);

  // The active drill context: null on the outer board, set while editing a die. Holds what the
  // exits need to restore the outer board + identify the die. One level only (the guide's one-layer
  // nesting — no user IC inside a user IC), so a single context, not a stack.
  let drill = $state<{
    /** the OUTER frame component id this die belongs to (key into {@link innerGraphs}). For an EDIT
     * drill (`editingTag` set) the outer part is a placed sealed IC, not a frame, so this is just the
     * id we drilled FROM — the inner graph isn't stashed in `innerGraphs` (the registry owns it). */
    frameId: number;
    /** the die frame's id WITHIN the inner graph (its pins are the package leads). */
    innerFrameId: number;
    /** the frame's package kind tag (for the breadcrumb + a fresh re-entry). When editing a sealed
     * IC this is the die-frame kind read off the IC's authored graph (so `framePackage` resolves). */
    frameTag: string;
    /** display name shown in the breadcrumb (the part's label or the package name). */
    name: string;
    /** the outer board snapshot, restored on every exit so the outer board can't be corrupted. */
    outerSnapshot: GraphSnapshot;
    /** the outer camera (pan + zoom), restored on exit. */
    outerCamera: { x: number; y: number; scale: number };
    /**
     * Set when EDITING an already-sealed IC (re-drilled from a placed instance): the IC's kind tag.
     * Seal then RE-SEALS into this same tag (updating its registry def, so every placed instance
     * follows) instead of minting a new CEC9xxx. Undefined for a fresh-frame Build (mint a new tag).
     */
    editingTag?: string;
  } | null>(null);

  // Live seal advisory while inside a die: whether it currently compiles (the hard gate) and how
  // many package leads are still unwired (a soft warning). Recomputed from the board's live inner
  // graph on each edit (partCount/wireCount tick on onChange, so this re-derives in step).
  const dieStatus = $derived.by(() => {
    if (!drill || !board) return null;
    // Touch the edit counters so this recomputes when the inner circuit changes. boardRev also bumps
    // on a stimulus edit (which leaves the part/wire counts unchanged) so the gate refreshes then too.
    void partCount;
    void wireCount;
    void boardRev;
    const snap = board.serialize();
    // The Seal gate runs on the die with its TEST STIMULI injected, so a power-fed IC (no on-die
    // reference) reads "solvable" once the player marks a GND/VCC pad. The unused-pins advisory stays
    // on the RAW snapshot (a stimulus is not a wire — those leads still count as unconnected here).
    const unused = unusedDiePins(snap, drill.innerFrameId);
    const total = framePackage(drill.frameTag)?.pinCount ?? 0;
    // A subassembly is a FRAGMENT (powered by its parent), so it seals without solving standalone — keep
    // the pill in lock-step with the Seal gate (dieSeal applies the SAME bypass), or they'd disagree.
    const editingSub =
      !!drill.editingTag && getUserIc(drill.editingTag)?.role === "subassembly";
    return {
      sealable:
        editingSub || dieIsSealable(dieTestGraph(snap, drill.innerFrameId)),
      used: total - unused.length,
      total,
    };
  });

  /**
   * Drill INTO a frame to build its die. Stashes the outer board + camera, loads (or creates) the
   * frame's inner graph, marks the die frame, and shows the back bar. The outer board is hidden but
   * fully preserved in `drill.outerSnapshot` for the exits. No-op if already drilled in, the part
   * isn't a frame, or the package is unknown.
   */
  /**
   * "New gate ▸ INV / NAND2 / NOR2": drop a SOT-23-5 package frame on the current board, seed its inner
   * die with a pre-wired CMOS template ({@link gateTemplate}) that already solves + switches, then drill
   * straight in — the smallest "build a gate as a part" on-ramp (no blank-frame, no manual wiring). The
   * player edits/observes the real transistors, then Seals as today (authored-in-a-package ⇒ role='ic',
   * board-placeable directly). Mirrors {@link buildSelectedFrame}'s stash + swap + setDieFrame, but
   * places the frame for you and seeds the template instead of a blank die. Non-destructive: the frame
   * lands on the existing board (its placement is one undo step on drill-out).
   */
  function newGateFromTemplate(kind: GateTemplateKind): void {
    if (!board || drill) return;
    const die = gateTemplate(kind);
    if (!die) return;
    const frameTag = "SOT23_5";
    if (!PART_KINDS[frameTag]) return;
    // Drop the package frame at the view centre on the CURRENT board (placeAt → undefined if the cell
    // is occupied; the player can clear space and retry).
    const placed = board.placeAt(
      frameTag,
      canvasEl.clientWidth / 2,
      canvasEl.clientHeight / 2,
    );
    if (!placed) return;
    innerGraphs.set(placed.id, die.snapshot);
    drill = {
      frameId: placed.id,
      innerFrameId: die.frameId,
      frameTag,
      name: gateTemplateName(kind),
      outerSnapshot: board.serialize(),
      outerCamera: board.getCamera(),
    };
    board.swapGraph(die.snapshot);
    board.setDieFrame(die.frameId);
    arm(null);
    setMode("select");
  }

  /** "New ▸ IC / Subassembly": drop a roomy default package (DIP-8) on the board, seed a BLANK die, and
   * drill in to build an IC or subassembly from scratch (vs the pre-wired gate templates). For a
   * subassembly we pre-check the seal-panel's nested-only toggle so Seal files it under My
   * Subassemblies; the player can re-package at Tape out. Mirrors {@link newGateFromTemplate}. */
  function newBlankDie(role: "ic" | "subassembly"): void {
    if (!board || drill) return;
    // An IC gets a real package (DIP-8); a subassembly gets a FREE-FORM block (§4.10) — an 8-pin BLOCK
    // frame (arbitrary pinout, re-packaged at Tape out), registered on-demand.
    const frameTag =
      role === "subassembly" ? ensureFrameKind("BLOCK", 8) : "DIP8";
    if (!PART_KINDS[frameTag]) return;
    const fresh = freshDieGraph(frameTag);
    if (!fresh) return;
    const placed = board.placeAt(
      frameTag,
      canvasEl.clientWidth / 2,
      canvasEl.clientHeight / 2,
    );
    if (!placed) return;
    innerGraphs.set(placed.id, fresh.snapshot);
    drill = {
      frameId: placed.id,
      innerFrameId: fresh.frameId,
      frameTag,
      name: partName(frameTag),
      outerSnapshot: board.serialize(),
      outerCamera: board.getCamera(),
    };
    board.swapGraph(fresh.snapshot);
    board.setDieFrame(fresh.frameId);
    sealAsSubassembly = role === "subassembly"; // pre-set the seal-panel toggle
    arm(null);
    setMode("select");
  }

  /** Grow/shrink a FREE-FORM (BLOCK) subassembly die's pin count while building it (§4.10 expandable
   * boundaries). Re-kinds the die frame via the board, then syncs the breadcrumb's `drill.frameTag`. */
  function changeDiePins(delta: number): void {
    if (!board || !drill) return;
    const cur = framePackage(drill.frameTag)?.pinCount;
    if (cur === undefined) return;
    const newTag = board.setDieFramePins(cur + delta);
    if (newTag) drill = { ...drill, frameTag: newTag };
  }

  /** The free-form die's live box size, refreshed whenever the board changes (boardRev), so the editor's
   * "Box W×H" readout tracks resizes. Null unless we're editing a free-form (box-captured) subassembly. */
  let freeFormBox = $derived.by(() => {
    // Read boardRev (bumped by every edit incl. resizeFreeFormBox's onChange) and drill (set on die
    // entry/exit) so the readout re-derives on both; `rev >= 0` is always true — it's just the dep touch.
    const rev = boardRev;
    return drill && rev >= 0 ? (board?.freeFormBoxSize() ?? null) : null;
  });

  /** Resize the free-form die's box (pin/box editing, §4.10) by (dw, dh) cells. The kind tag is unchanged
   * (the pin count doesn't move), so `drill.frameTag` stays valid; the readout follows via freeFormBox. */
  function changeBox(dw: number, dh: number): void {
    if (!board || !drill) return;
    board.resizeFreeFormBox(dw, dh);
  }

  /** Chip Bench Phase 1: the box size of the SELECTED placed FREE-FORM subassembly chip, so the inspector
   * can resize its borders right in the overworld (no drill-in). Null unless a single free-form subassembly
   * is selected on the board. `boardRev` is touched so the readout follows a resize's onChange. */
  let placedDeviceBox = $derived.by(() => {
    const rev = boardRev;
    if (!selPart || drill || rev < 0 || !isUserIc(selPart.kind)) return null;
    const ff = getUserIc(selPart.kind)?.freeForm;
    return ff ? { w: ff.w, h: ff.h } : null;
  });

  /** Resize the SELECTED placed device's box by (dw, dh) — edits the device definition, so every placed
   * copy + the parts-bin glyph follow (undoable). The bin glyph is refreshed via libRev. */
  function changeDeviceBox(dw: number, dh: number): void {
    if (!selPart || !board || drill) return;
    if (board.resizeUserIcBox(selPart.id, dw, dh)) libRev++;
  }

  /** Overworld "Make subassembly" (§4.9): box-select a region of the board, infer the pinout from the
   * nets that cross the selection boundary, and register it as a bare subassembly (→ "My
   * Subassemblies"; reach the board via Tape out). Non-destructive — the board is untouched. */
  function makeSubassembly(): void {
    if (!board || drill || selComponentCount < 1) return;
    const cap = board.makeSubassemblyFromSelection();
    if (!cap) {
      circuitWarning =
        "Couldn't make a subassembly: nothing in the selection wires out to the rest of the board, so there are no pins. Select parts that connect outward.";
      return;
    }
    circuitWarning = null;
    syncLibrary(cap.tag, "sealed"); // surface it in "My Subassemblies"
    libRev++;
  }

  /** Seal the live region tool's pending rectangle into a free-form subassembly (the rect IS the box,
   * pins where wires cross it — §4.10). The board does the capture; here we name it, surface it in "My
   * Subassemblies", and drop back to Select. Non-destructive — the player's board is untouched. */
  function sealRegion(): void {
    if (!board || drill) return;
    const cap = board.sealPendingRegion(regionName.trim() || undefined);
    if (!cap) {
      circuitWarning =
        "Couldn't seal the region: make sure the box contains parts that wire out to the rest of the board (those crossings become the pins).";
      return;
    }
    circuitWarning = null;
    regionName = "";
    regionInfo = null;
    syncLibrary(cap.tag, "sealed"); // surface it in "My Subassemblies"
    libRev++;
    setMode("select"); // the rectangle is consumed; hand back the normal tools
  }

  /** Discard the pending region rectangle without sealing (the panel's × Cancel, mirrors Esc). */
  function cancelRegion(): void {
    board?.clearPendingRegion();
    regionInfo = null;
    regionName = "";
  }

  function buildSelectedFrame(): void {
    if (!selPart || !board || drill || !isFrame(selPart.kind)) return;
    const frameId = selPart.id;
    const frameTag = selPart.kind;
    const name = selPart.label?.trim() || partName(frameTag);

    // Reuse a saved in-progress die for this frame, else start a fresh one (just the die).
    let inner = innerGraphs.get(frameId);
    let innerFrameId: number;
    if (inner) {
      const fid = findDieFrameId(inner);
      if (fid === undefined) return; // corrupt stored die — refuse rather than break
      innerFrameId = fid;
    } else {
      const fresh = freshDieGraph(frameTag);
      if (!fresh) return;
      inner = fresh.snapshot;
      innerFrameId = fresh.frameId;
      innerGraphs.set(frameId, inner);
    }

    // Stash the outer board, then swap to the die (swapGraph clears cross-boundary undo + frames
    // the view on the die since no camera is passed).
    drill = {
      frameId,
      innerFrameId,
      frameTag,
      name,
      outerSnapshot: board.serialize(),
      outerCamera: board.getCamera(),
    };
    board.swapGraph(inner);
    board.setDieFrame(innerFrameId);
    // Editing tools, not a leftover armed part, on entry.
    arm(null);
    setMode("select");
  }

  /**
   * RE-OPEN a placed sealed user IC to edit its die. Mirrors {@link buildSelectedFrame} but the
   * source is the registered {@link UserIc}'s authored circuit (not a fresh/stashed frame): stash the
   * outer board + camera, swap to a COPY of the IC's inner graph (structuredClone so edits don't
   * mutate the registry until Reseal), mark the die frame, and record `editingTag` so Seal RE-SEALS
   * into the same tag. No-op unless the selection is a registered user IC and we're not already
   * drilled in. A stale tag (no def) is a silent no-op (the guard the spec calls for).
   */
  function editUserIcSelected(): void {
    if (!selPart || !board || drill || !isUserIc(selPart.kind)) return;
    const tag = selPart.kind;
    const ic = getUserIc(tag);
    if (!ic) return; // stale/unknown tag — refuse rather than break
    // The IC's authored graph holds its die frame at ic.frameId; its kind is the die-frame variant
    // (so framePackage resolves for the breadcrumb + the pin-count advisory). Copy the graph so the
    // editor mutates a throwaway, leaving the registry def untouched until Reseal overwrites it.
    const inner = structuredClone(ic.graph);
    const frameComp = inner.components.find((c) => c.id === ic.frameId);
    if (!frameComp || !isFrame(frameComp.kind)) return; // corrupt def — refuse
    const name = selPart.label?.trim() || ic.name || partName(tag);

    drill = {
      frameId: selPart.id,
      innerFrameId: ic.frameId,
      frameTag: frameComp.kind,
      name,
      outerSnapshot: board.serialize(),
      outerCamera: board.getCamera(),
      editingTag: tag,
    };
    board.swapGraph(inner);
    board.setDieFrame(ic.frameId);
    arm(null);
    setMode("select");
  }

  /**
   * Open a user IC / subassembly straight from the LIBRARY BIN for die editing — no placed instance
   * needed. A captured subassembly is nested-only (never on the board), so {@link editUserIcSelected}'s
   * place-then-reopen path can't reach it; this is how you edit its circuit, box, and pins. Mirrors
   * {@link editUserIcSelected} but synthesizes the outer context from the CURRENT board (stash it, swap
   * the canvas to a COPY of the def's die, mark `editingTag`); `frameId` is unused on an `editingTag`
   * exit (see {@link exitDie}), so a sentinel `-1` is fine. Reseal updates the def (and every placed
   * instance, of which a subassembly has none). No-op if already drilled or the tag isn't a user IC. */
  function editLibraryDie(tag: string): void {
    if (!board || drill) return;
    const ic = getUserIc(tag);
    if (!ic) return; // stale/unknown tag — refuse rather than break
    const inner = structuredClone(ic.graph);
    const frameComp = inner.components.find((c) => c.id === ic.frameId);
    if (!frameComp || !isFrame(frameComp.kind)) return; // corrupt def — refuse
    drill = {
      frameId: -1, // no placed instance; unused on an editingTag exit (exitDie skips it)
      innerFrameId: ic.frameId,
      frameTag: frameComp.kind,
      name: ic.name || partName(tag),
      outerSnapshot: board.serialize(),
      outerCamera: board.getCamera(),
      editingTag: tag,
    };
    board.swapGraph(inner);
    board.setDieFrame(ic.frameId);
    arm(null);
    setMode("select");
  }

  /**
   * Open a RAW saved DIE graph (a `__DIE_*` snapshot saved in isolation — the owner's existing die
   * files) straight into the die BUILDER, instead of dropping the die-frame onto a flat board as a
   * placed part. Synthesizes a fresh OUTER board with the matching PLACEABLE frame, stashes the loaded
   * die under that frame's id, then drills in (exactly as {@link buildSelectedFrame} does for a freshly
   * built frame) — so you land in the editor with your circuit, ready to seal. No-op (returns false,
   * so the caller can fall back to a flat load) if the package can't be resolved. Returns true when it
   * opened the builder.
   */
  function openDieGraphInBuilder(dieSnap: GraphSnapshot): boolean {
    if (!board) return false;
    const innerFrameId = findDieFrameId(dieSnap);
    if (innerFrameId === undefined) return false;
    const dieFrame = dieSnap.components.find((c) => c.id === innerFrameId);
    if (!dieFrame) return false;
    // The placeable frame this die pairs with (the die tag minus the "__DIE_" prefix), placed on a
    // fresh outer board so there is an outer context to drill out to.
    const placeTag = placeableFrameTag(dieFrame.kind);
    if (!placeTag || !PART_KINDS[placeTag]) return false;
    const frameTag = framePackage(placeTag) ? placeTag : undefined;
    if (!frameTag) return false;

    const outer = new BoardGraph();
    const placed = outer.place(frameTag, { col: 6, row: 4 });
    if (!placed) return false;
    const outerSnap = outer.serialize();

    // Stash the loaded die under the synthesized outer frame's id, then load the empty outer board and
    // drill straight in (mirrors buildSelectedFrame's stash + swap + setDieFrame). The map is keyed by
    // the OUTER frame id, so re-entry after a Back resolves the same WIP.
    innerGraphs.clear();
    innerGraphs.set(placed.id, dieSnap);
    board.loadGraph(outerSnap);
    const name = partName(frameTag);
    drill = {
      frameId: placed.id,
      innerFrameId,
      frameTag,
      name,
      outerSnapshot: outerSnap,
      outerCamera: board.getCamera(),
    };
    board.swapGraph(dieSnap);
    board.setDieFrame(innerFrameId);
    arm(null);
    setMode("select");
    return true;
  }

  /** Restore the outer board + camera and leave die mode. The optional `mutate` runs on a fresh
   * BoardGraph of the stashed outer snapshot BEFORE it is loaded — used by Seal to re-kind the
   * placeholder frame into the sealed chip as part of the same restore (so it lands sealed). */
  function exitDie(mutate?: (outer: GraphSnapshot) => GraphSnapshot): void {
    if (!drill || !board) return;
    const ctx = drill;
    const outer = mutate ? mutate(ctx.outerSnapshot) : ctx.outerSnapshot;
    sealVariantOf = ""; // reset the "Variant of …" choice when leaving the die editor
    sealAsSubassembly = false; // and the subassembly toggle
    // Close any open port-pad name editor so it doesn't linger over the outer board.
    if (pinNameEdit) cancelPinNameEdit();
    // Leave die mode BEFORE the swap, so swapGraph's onChange sees the outer board with `drill`
    // cleared and persists it normally (the per-edit saves were suppressed while inside the die, so
    // the outer board needs to be re-persisted now; the inner graph never reached localStorage).
    board.setDieFrame(null);
    drill = null;
    board.swapGraph(outer, ctx.outerCamera);
  }

  /** Back/Cancel: store the in-progress die (so re-entering resumes it) and return to the outer
   * board unchanged — the placeholder stays a buildable frame. When EDITING a sealed IC, there is no
   * placeholder frame and the registry def must stay untouched until Reseal, so we DON'T stash the
   * edited copy (it's discarded); the IC keeps its previously-sealed circuit. */
  function dieBack(): void {
    if (!drill || !board) return;
    if (!drill.editingTag) {
      innerGraphs.set(drill.frameId, board.serialize());
    } else {
      // Editing an existing def — the edit is DISCARDED. A box-resize during the edit re-registered the
      // free-form frame kind IN PLACE (global FREE_FORM_GEOM / PART_KINDS), which Back can't undo via the
      // graph; re-register the unchanged def so that registry edit reverts too (else re-opening would
      // show the discarded box). A no-op for a non-free-form def (re-derives the same PART_KINDS entry).
      const def = getUserIc(drill.editingTag);
      if (def) registerUserIc(def);
    }
    exitDie();
  }

  /** Save: identical to Back for v1 — stash the in-progress die and return; the placeholder stays a
   * frame you can re-enter to finish. (Kept distinct so the bar reads with the owner's three exits,
   * and so a future "save also persists" can diverge here.) */
  function dieSave(): void {
    dieBack();
  }

  /**
   * Seal: validate the die is a real IC (it must compile — {@link dieIsSealable}), capture it with
   * the existing seal engine ({@link captureSeal} on the live inner graph + {@link findDieFrameId}),
   * then return to the outer board with the placeholder frame RE-KINDED to the sealed chip. Unwired
   * leads are allowed (a soft warning only), so this never blocks on pin usage — only on solvability.
   */
  function dieSeal(): void {
    if (!drill || !board) return;
    const ctx = drill;
    const live = board.liveGraph();
    // Hard gate: the authored circuit must be simulatable, or it isn't an IC. Gate on the SAME
    // stimuli-injected graph as the `dieStatus` "● solvable" pill (`dieTestGraph` wires the frame's
    // GND/VCC/input test pads as virtual sources) — a logic die is powered from OUTSIDE its package,
    // so it only solves with those stimuli, and the pill and the Seal button must agree. The SEAL
    // CAPTURE below still reads the RAW live graph (never the injected copy), so the sealed IC stays
    // the player's real discrete parts and the golden is untouched (ADR 0005).
    // A SUBASSEMBLY is a FRAGMENT powered by its PARENT (like a logic IC drawing VCC/GND from the board),
    // so it need not solve STANDALONE — a captured R-divider (no internal source) never will, and the
    // capture frame carries no test stimuli for dieTestGraph to power it with. Only gate a real IC (fresh
    // seal, or an 'ic' reseal) on solvability; a subassembly reseal banks the fragment as-is. Without this,
    // box-resizing a captured subassembly couldn't be saved (reseal blocked on the solvability gate).
    const isSubassemblyReseal =
      !!ctx.editingTag && getUserIc(ctx.editingTag)?.role === "subassembly";
    if (
      !isSubassemblyReseal &&
      !dieIsSealable(dieTestGraph(live.serialize(), ctx.innerFrameId))
    ) {
      circuitWarning =
        "This die can't be sealed yet: the circuit doesn't solve (needs a reference/ground and a complete path). Wire it up, then Seal.";
      return;
    }

    // EDIT path: re-seal into the EXISTING tag (update its registry def, keeping its name + package),
    // so every placed instance follows the new circuit. We do NOT re-kind anything (the instances are
    // already kind=tag) — just snapshot the edited die + its frame's pin names into the same UserIc.
    if (ctx.editingTag) {
      const snap = live.serialize();
      const frame = snap.components.find((c) => c.id === ctx.innerFrameId);
      resealUserIc(ctx.editingTag, snap, ctx.innerFrameId, frame?.pinNames);
      sealName = "";
      // Keep the personal library in sync with the re-sealed circuit (upsert by tag).
      syncLibrary(ctx.editingTag, "sealed");
      // Just leave the die — the outer board is restored verbatim (instances already carry the tag,
      // and re-deriving PART_KINDS[tag] in resealUserIc refreshed their footprint/pin labels).
      exitDie();
      return;
    }

    // "Variant of …": when a family is chosen, append this die as a new variant of it (cap.tag is the
    // FAMILY tag); else a fresh top-level seal. A package mismatch makes captureSeal refuse (null).
    const intoFamily =
      sealVariantOf && hasFamilyTarget(sealVariantOf)
        ? sealVariantOf
        : undefined;
    const cap = captureSeal(
      live,
      ctx.innerFrameId,
      sealName.trim() || undefined,
      intoFamily,
      // A subassembly is a fresh top-level seal only — a "Variant of …" inherits its family's role.
      intoFamily ? undefined : sealAsSubassembly ? "subassembly" : undefined,
    );
    if (!cap) {
      circuitWarning = intoFamily
        ? "Couldn't add as a variant: a variant must use the SAME package (archetype + pin count) as the family. Seal it as a new IC, or match the package."
        : "Couldn't seal this die. Pick a different name (it may collide with a built-in part).";
      return;
    }
    sealName = "";
    sealVariantOf = "";
    sealAsSubassembly = false;
    // Mirror the just-sealed kind into the personal library so it's placeable from any board, forever.
    syncLibrary(cap.tag, "sealed");
    // The die is now a sealed IC: drop its in-progress inner graph (the registered UserIc carries
    // the authored circuit from here on) and restore the outer board with the placeholder re-kinded
    // to the sealed chip where it sat.
    innerGraphs.delete(ctx.frameId);
    exitDie((outer) => {
      const comps = outer.components.map((c) =>
        c.id === ctx.frameId
          ? {
              ...c,
              kind: cap.tag,
              value: PART_KINDS[cap.tag]?.defaultValue ?? 0,
            }
          : c,
      );
      return { ...outer, components: comps };
    });
  }

  /**
   * Abandon any active die and forget all in-progress inner graphs. Called before the OUTER board
   * is wholesale REPLACED (load a save, a worked example, or reset) — the inner graphs are keyed by
   * outer frame ids that won't survive a new board, so they're dropped rather than left stale. Just
   * clears die state; it does NOT restore the old outer board (the caller is loading a new one). A
   * no-op when not drilled in / with no stored dies.
   */
  function resetDieState(): void {
    board?.setDieFrame(null);
    drill = null;
    innerGraphs.clear();
  }

  function stepVal(dir: number): void {
    if (!selPart) return;
    // Electronic load: step through the mode's own value list (CC amps / CR ohms),
    // since the static CURATED_FULL.LOAD is only the CC list.
    if (selPart.kind === "LOAD") {
      setVal(stepLoad(selPart.value, dir));
      return;
    }
    setVal(stepValue(selPart.kind, selPart.value, dir));
  }
  // The second scalar (`amp`): an AC/PULSE source's peak (V), an LS output rail (V), or a
  // LOAD's step PEAK (A). Dual-target like the other axes — reads the selected part else
  // the armed config. The kind-specific default mirrors graph.ts's placement defaults so
  // an unset value highlights the right chip (LOAD peak 2 A; everything else 5).
  function ampDefaultFor(kind: string | null | undefined): number {
    return kind === "LOAD" ? 2 : AC_DEFAULT_AMP;
  }
  function selAmp(): number {
    return selPart
      ? (selPart.amp ?? ampDefaultFor(selPart.kind))
      : (armedConfig.amp ?? ampDefaultFor(armedPart));
  }
  function setAmp(v: number): void {
    if (selPart) {
      board?.setComponentAmp(selPart.id, v);
      rememberConfig(selPart.kind, { amp: v });
    } else setArmedAxis({ amp: v });
  }
  function stepAmpVal(dir: number): void {
    // Dual-target: steps the selected part's amp, or — when only armed — the configurator's
    // (setAmp routes to whichever is active). Guarded so it's a no-op with neither.
    if (selPart || armedPart) setAmp(stepAmp(selAmp(), dir));
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
    "IMPLY",
    "NIMPLY",
    "NOT",
    "BUF",
    "FF",
  ]);
  function isDigitalPart(kind: string): boolean {
    return DIGITAL_KINDS.has(kind);
  }
  // --- Dual-target configurator axes (variant / tier / family / openDrain / mode /
  // loadHz / duty / amp). Each `selX()` reads the SELECTED part when one is selected,
  // else the ARMED part's pending config (so the same chips drive both the inspector and
  // the arm-time configurator). Each `setX()` either edits the selected part (and teaches
  // the per-kind last-used memory) or, when only armed, reassigns `armedConfig` (for
  // reactivity), stores it as the kind's last-used config, and re-tints the ghost.

  /** Record an edit to a placed part into its kind's last-used memory, so the NEXT time
   * that kind is armed the configurator pre-selects what you last set on a real one. */
  function rememberConfig(kind: string, patch: Partial<Component>): void {
    lastConfig.set(kind, { ...(lastConfig.get(kind) ?? {}), ...patch });
  }
  /** Apply a configurator-axis change to the armed (not-yet-placed) part: reassign
   * `armedConfig` (so `$state` notifies), persist it as the kind's last-used, and push it
   * to the board so the ghost re-tints and the next drop carpets the new config. */
  function setArmedAxis(patch: Partial<Component>): void {
    if (!armedPart) return;
    armedConfig = { ...armedConfig, ...patch };
    lastConfig.set(armedPart, armedConfig);
    board?.setArmedConfig(armedConfig);
  }
  /** The `value` (rail / nominal) the config rows reason about: the selected part's when
   * one is selected, else the kind's per-kind default (the armed part has no instance
   * value yet). Used by the logic-family threshold/output preview. */
  function partValue(kind: string): number {
    return selPart ? selPart.value : (PART_KINDS[kind]?.defaultValue ?? 0);
  }
  function selFamily(): number {
    return (selPart ? selPart.family : armedConfig.family) ?? 0;
  }
  function setFamily(idx: number): void {
    if (selPart) {
      board?.setComponentFamily(selPart.id, idx);
      rememberConfig(selPart.kind, { family: idx });
    } else setArmedAxis({ family: idx });
  }
  function selTier(): number {
    return (selPart ? selPart.tier : armedConfig.tier) ?? DEFAULT_TIER;
  }
  function setTier(idx: number): void {
    if (selPart) {
      board?.setComponentTier(selPart.id, idx);
      rememberConfig(selPart.kind, { tier: idx });
    } else setArmedAxis({ tier: idx });
  }
  function selVariant(): number {
    return (selPart ? selPart.variant : armedConfig.variant) ?? 0;
  }
  function setVariant(idx: number): void {
    if (selPart) {
      board?.setComponentVariant(selPart.id, idx);
      rememberConfig(selPart.kind, { variant: idx });
    } else setArmedAxis({ variant: idx });
  }
  function selDuty(): number {
    return (selPart ? selPart.duty : armedConfig.duty) ?? 0.5;
  }
  function setDuty(v: number): void {
    if (selPart) {
      board?.setComponentDuty(selPart.id, v);
      rememberConfig(selPart.kind, { duty: v });
    } else setArmedAxis({ duty: v });
  }
  // The electronic load's mode (0 = constant-current CC, 1 = constant-resistance CR):
  // a third descriptor beside `value`. It decides the value's unit (loadUnit) and the
  // chip/full lists (loadChips/loadValues). 0 = CC (the default).
  function selLoadMode(): number {
    return (selPart ? selPart.mode : armedConfig.mode) ?? 0;
  }
  function setLoadMode(m: number): void {
    if (selPart) {
      board?.setComponentMode(selPart.id, m);
      rememberConfig(selPart.kind, { mode: m });
    } else setArmedAxis({ mode: m });
  }
  // The load's value chips/full-list, picked by its mode (CC amps / CR ohms).
  function loadChipsForMode(): number[] {
    return loadChips(selLoadMode());
  }
  // Step the load's value through its mode's full list (ascending), nearest-detent —
  // the same idea as `stepValue` but against the per-mode loadValues list.
  function stepLoad(value: number, dir: number): number {
    const list = loadValues(selLoadMode());
    if (list.length === 0) return value;
    let idx = 0;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = Math.abs(Math.log(list[i]!) - Math.log(value));
      if (d < bestD) {
        bestD = d;
        idx = i;
      }
    }
    const next = Math.max(0, Math.min(list.length - 1, idx + Math.sign(dir)));
    return list[next]!;
  }
  // The load's dynamic step frequency (Hz): 0 = static, > 0 steps base→peak current.
  // A small set of preset step rates, plus the static "Off" (0).
  const LOAD_STEP_HZ = [0, 100, 1000, 10000, 50000];
  function selLoadHz(): number {
    return (selPart ? selPart.loadHz : armedConfig.loadHz) ?? 0;
  }
  function setLoadHz(hz: number): void {
    if (selPart) {
      board?.setComponentLoadHz(selPart.id, hz);
      rememberConfig(selPart.kind, { loadHz: hz });
    } else setArmedAxis({ loadHz: hz });
  }
  // Behavioral blocks (LUT / SPI / UART): the editable datum is `word` — the LUT's 16-bit truth
  // table or a serial data word (→ the behavioral element's aux) — plus the LUT's output-register
  // mode (→ Component.mode → params[4]). BEH_DEFWORD mirrors the per-kind default in netlist.ts
  // (BEH_SPEC.defWord), so the inspector shows the same table the sim uses when `word` is unset.
  const BEH_DEFWORD: Record<string, number> = {
    LUT: 0x6666, // 2-input XOR
    SPIM: 0xa5,
    SPIS: 0x3c,
    UART: 0x55,
  };
  function isBehavioralPart(kind: string): boolean {
    return kind in BEH_DEFWORD;
  }
  // The LUT preset functions: name → 16-bit truth table (OUT = bit[IN0 | IN1<<1 | IN2<<2 | IN3<<3]).
  const LUT_PRESETS: { name: string; table: number; hint: string }[] = [
    { name: "XOR", table: 0x6666, hint: "IN0 ⊕ IN1" },
    { name: "XNOR", table: 0x9999, hint: "IN0 ⊙ IN1" },
    { name: "AND", table: 0x8888, hint: "IN0 · IN1" },
    { name: "OR", table: 0xeeee, hint: "IN0 + IN1" },
    { name: "NAND", table: 0x7777, hint: "¬(IN0 · IN1)" },
    { name: "NOR", table: 0x1111, hint: "¬(IN0 + IN1)" },
    { name: "BUF", table: 0xaaaa, hint: "OUT = IN0" },
    { name: "NOT", table: 0x5555, hint: "OUT = ¬IN0" },
    { name: "MAJ", table: 0xe8e8, hint: "majority(IN0, IN1, IN2)" },
    { name: "PAR", table: 0x6996, hint: "parity — XOR of all 4 inputs" },
    { name: "0", table: 0x0000, hint: "constant low" },
    { name: "1", table: 0xffff, hint: "constant high" },
  ];
  function selWord(): number {
    const w = selPart ? selPart.word : armedConfig.word;
    return w ?? BEH_DEFWORD[infoKind ?? ""] ?? 0;
  }
  function setWord(w: number): void {
    if (selPart) {
      board?.setComponentWord(selPart.id, w);
      rememberConfig(selPart.kind, { word: w });
    } else setArmedAxis({ word: w });
  }
  // Parse a hex string from the truth-table / data-word field and set it, capped to the field's
  // width (LUT 16-bit, serial 32-bit). Ignores non-hex input. Uses Math.min (not a 32-bit `&`,
  // which would go negative on bit 31) — the maxlength already bounds the digits.
  function setWordHex(s: string, mask: number): void {
    const v = parseInt(s.replace(/[^0-9a-fA-F]/g, ""), 16);
    if (!Number.isNaN(v)) setWord(Math.min(Math.max(0, v), mask));
  }
  // The LUT's output register, reusing Component.mode (0 = combinational, 1 = registered).
  function selLutReg(): number {
    return (selPart ? selPart.mode : armedConfig.mode) ?? 0;
  }
  function setLutReg(m: number): void {
    if (selPart) {
      board?.setComponentMode(selPart.id, m);
      rememberConfig(selPart.kind, { mode: m });
    } else setArmedAxis({ mode: m });
  }
  // A logic gate's output mode: push-pull (drives both rails) vs open-drain (pulls low,
  // releases high — needs an external pull-up). The D flip-flop is always push-pull.
  function isGatePart(kind: string): boolean {
    return isDigitalPart(kind) && kind !== "FF";
  }
  // Whether a kind exposes ANY arm-time configurator row (the `partConfig` snippet would
  // render something): a quality tier, a device variant (diode type / LED colour), a logic
  // family / gate output stage, or the PULSE / LOAD specifics. Gates the arm-time panel and
  // the "set its type below" hint so a plain part (V, R, GND, …) shows neither.
  function hasConfig(kind: string): boolean {
    return (
      hasTiers(kind) ||
      hasDiodeTypes(kind) ||
      hasLedColors(kind) ||
      hasUserIcVariants(kind) ||
      isDigitalPart(kind) ||
      isBehavioralPart(kind) ||
      kind === "PULSE" ||
      kind === "LOAD"
    );
  }
  function selOpenDrain(): boolean {
    return (selPart ? selPart.openDrain : armedConfig.openDrain) ?? false;
  }
  function setOpenDrain(v: boolean): void {
    if (selPart) {
      board?.setComponentOpenDrain(selPart.id, v);
      rememberConfig(selPart.kind, { openDrain: v });
    } else setArmedAxis({ openDrain: v });
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
  // The thermistor's body temperature (°C): its second scalar, set directly by a
  // slider (the "knob for now" — a future self-heating model would drive it instead).
  // Same single-undo-per-drag pattern as the wiper.
  function selTemp(): number {
    return selPart?.temp ?? 25;
  }
  function tempRange(kind: string): { min: number; max: number } {
    return kind === "PTC" ? THERMISTOR_TEMP.PTC : THERMISTOR_TEMP.NTC;
  }
  let tempDragging = false;
  function setTemp(v: number): void {
    if (!selPart) return;
    board?.setComponentTemp(selPart.id, v, !tempDragging);
    tempDragging = true;
  }
  function endTempDrag(): void {
    tempDragging = false;
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
    // Seed the configurator from this kind's last-used choices (empty for a kind never
    // configured → its per-kind defaults). Copied so editing the armed config doesn't
    // alias the stored memory. Disarming clears it. A fresh object reference each time
    // so `$state` notifies and the configurator panel/ghost re-render.
    armedConfig = tag ? { ...(lastConfig.get(tag) ?? {}) } : {};
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
    board?.setArmed(tag, armedConfig);
  }
  function toggleArm(tag: string): void {
    arm(armedPart === tag ? null : tag);
  }

  // --- Quick-recall hotbar (1–9) + the Q pipette ---------------------------------
  // These arm a part with an EXPLICIT config (a saved slot or the eyedropped selection),
  // so unlike `arm()` they must NOT re-seed `armedConfig` from the per-kind last-used
  // memory — that would clobber the slot's tuned value/wiper/temp. `armWith` is the
  // dedicated path: it arms `kind` with exactly `config` (a fresh copy for reactivity),
  // does the same tool-switch `arm()` does, and pushes the config to the ghost.

  /** Build a `Partial<Component>` from a captured part: the defined
   * {@link PLACEMENT_OVERRIDE_KEYS} fields (now incl. value/wiper/temp) of a selected
   * board part or of `{ kind, ...armedConfig }`. The single source for what a slot /
   * the pipette stores, so a recalled part carpets place-and-repeat exactly as captured. */
  function partConfigOf(src: Partial<Component>): Partial<Component> {
    const out: Partial<Component> = {};
    for (const key of PLACEMENT_OVERRIDE_KEYS) {
      const v = src[key];
      if (v !== undefined) (out as Record<string, unknown>)[key] = v;
    }
    return out;
  }

  /** Arm `kind` with an explicit `config` (slot recall / pipette), bypassing the
   * per-kind last-used re-seed so the captured config survives. */
  function armWith(kind: string, config: Partial<Component>): void {
    armedPart = kind;
    armedConfig = { ...config };
    // Same intent-to-build tool switch as arm(): leave any non-building tool so the
    // next click drops the part.
    if (
      mode === "measure" ||
      mode === "junction" ||
      mode === "label" ||
      mode === "pan"
    )
      setMode("select");
    board?.setArmed(kind, armedConfig);
  }

  /** Recall slot `i` (key i+1, or a click on a filled cell): arm its captured part. */
  function armFromSlot(i: number): void {
    const slot = hotbar[i];
    if (!slot) return;
    armWith(slot.kind, slot.config);
  }

  /** Assign the currently armed part into slot `i` (Shift+digit, or a click on an empty
   * cell while armed). No-op when nothing is armed. Reassigns the array for `$state`. */
  function assignSlot(i: number): void {
    if (!armedPart) return;
    const slot: HotSlot = {
      kind: armedPart,
      config: partConfigOf({ kind: armedPart, ...armedConfig }),
    };
    hotbar = hotbar.with(i, slot);
    persistSettings();
  }

  /** Clear slot `i` (right-click a cell, or its × button). Reassigns for reactivity. */
  function clearSlot(i: number): void {
    if (!hotbar[i]) return;
    hotbar = hotbar.with(i, null);
    persistSettings();
  }

  /** Click handler for a hotbar cell: recall a filled slot, else (when armed) fill it. */
  function clickSlot(i: number): void {
    if (hotbar[i]) armFromSlot(i);
    else assignSlot(i);
  }

  /** The Q pipette (eyedropper): copy the SELECTED board part — its kind + exact config
   * (value/wiper/temp + identity-quality axes) — and arm it, so place-and-repeat carpets
   * that configured part. A no-op when nothing is selected (Q only samples a live part). */
  function pipette(): void {
    if (!selPart) return;
    armWith(selPart.kind, partConfigOf(selPart as Partial<Component>));
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
  function enterRegion(): void {
    arm(null);
    regionName = "";
    setMode("region");
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
    persistSettings();
  }
  // Master on/off for the zoom level-of-detail (the tier reveal). Off ⇒ plain
  // schematic symbols at any zoom, whatever the lens.
  let lodOn = $state(true);
  function toggleLod(): void {
    lodOn = !lodOn;
    board?.setLod(lodOn);
    persistSettings();
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
    // Embed the sealed-IC definitions this board places (via userIcsForGraph), so a downloaded save
    // is self-contained — a placed CEC9xxx resolves on Load even in a fresh session — plus the
    // in-progress (unsealed) dies of any placed frame, so saving mid-build and reloading lets you
    // re-drill a frame and resume. Each field is omitted when empty, so a plain circuit's save is
    // byte-for-byte as before (and the fields are additive — older builds ignore them). version 2
    // marked the userIcs-aware shape; version 3 adds innerDies.
    const userIcs = userIcsForGraph(graph);
    const userIcFamilies = userIcFamiliesForGraph(graph);
    const innerDies = innerDiesForSaveOf(graph);
    const payload = {
      format: "cec-circuit",
      version: 3,
      savedAt: new Date().toISOString(),
      graph,
      ...(userIcs.length > 0 ? { userIcs } : {}),
      ...(userIcFamilies.length > 0 ? { userIcFamilies } : {}),
      ...(innerDies.length > 0 ? { innerDies } : {}),
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
          userIcs?: UserIc[];
          userIcFamilies?: UserIcFamilySidecar[];
          innerDies?: InnerDie[];
        };
        const graph =
          parsed && parsed.format === "cec-circuit" ? parsed.graph : parsed;
        if (!graph || typeof graph !== "object" || !("components" in graph)) {
          throw new Error("not a circuit");
        }
        resetDieState(); // abandon any open die — the outer board is being replaced
        // Re-register any embedded sealed-IC defs BEFORE loading, so the placed CEC9xxx kinds resolve
        // (an older save with no userIcs registers nothing — it loads exactly as before). Then regroup
        // any variant families from the sidecar (after the flat defs, which include the child tags) so a
        // placed family tag resolves + shows its variant picker. Bump libRev so any newly-registered
        // single ICs surface in "My ICs" (families show after a placement embeds + the user saves).
        if (parsed && parsed.format === "cec-circuit") {
          registerUserIcs(parsed.userIcs ?? []);
          registerUserIcFamilies(parsed.userIcFamilies);
          libRev++;
        }
        const snap = graph as GraphSnapshot;
        // A RAW die snapshot saved in isolation (a `__DIE_*` graph — the owner's existing die files):
        // open it straight into the die BUILDER instead of dropping the die-frame as a flat part.
        // resetDieState() already cleared innerGraphs; openDieGraphInBuilder rebuilds it + drills in.
        if (isStandaloneDieGraph(snap) && openDieGraphInBuilder(snap)) {
          demo = null;
          showIntro = false;
          flashIo("Die loaded — opened in the IC builder. Seal when ready.");
          return;
        }
        // A normal board: restore any embedded in-progress (unsealed) dies into innerGraphs BEFORE the
        // outer board loads, so re-drilling a placed frame resumes its WIP (an older save with no
        // innerDies clears the map to empty — exactly as before).
        restoreInnerDies(parsed?.innerDies, innerGraphs);
        board?.loadGraph(snap);
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
  function flipSel(): void {
    board?.flipSelection();
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
  // Swatch presets for pinning a net's colour: sourced from the renderer's own
  // PALETTE (the design-system signal set, the same hexes the wires use) so a
  // chosen swatch matches the net it paints. No raw hex invented here.
  const NET_LABEL_SWATCHES: { name: string; hex: number }[] = [
    { name: "Rose", hex: PALETTE.accent },
    { name: "Violet", hex: PALETTE.violet },
    { name: "Cyan", hex: PALETTE.cyan },
    { name: "Green", hex: PALETTE.ok },
    { name: "Amber", hex: PALETTE.warn },
    { name: "Bronze", hex: PALETTE.bronze },
    { name: "Red", hex: PALETTE.bad },
  ];
  // A PIXI hex int → a CSS `#rrggbb` string, for the swatch background.
  function cssHex(n: number): string {
    return "#" + (n & 0xffffff).toString(16).padStart(6, "0");
  }
  function commitLabelEdit(): void {
    if (!labelEdit) return;
    // null ⇒ "Auto": pass undefined so the net reverts to its voltage colour.
    board?.commitLabel(labelEditValue, labelEditColor ?? undefined);
    labelEdit = null;
  }
  function cancelLabelEdit(): void {
    if (!labelEdit) return;
    board?.cancelLabelEdit();
    labelEdit = null;
  }
  // IC-maker die editor: commit / cancel / key handling for the port-pad name editor (mirrors the
  // net-label editor). Commit routes through board.commitPinName (undoable, re-labels the pad on the
  // die + carries into the sealed chip); a blank name clears the pad back to its package number.
  function commitPinNameEdit(): void {
    if (!pinNameEdit) return;
    board?.commitPinName(
      pinNameEdit.componentId,
      pinNameEdit.pinIndex,
      pinNameValue,
    );
    pinNameEdit = null;
  }
  function cancelPinNameEdit(): void {
    if (!pinNameEdit) return;
    board?.cancelPinNameEdit();
    pinNameEdit = null;
  }
  // IC-maker die editor: the port-pad TEST STIMULUS controls (in the same popover as the name).
  // A stimulus (GND / VCC / Input drive) is injected as a virtual source ONLY for the live die solve
  // + the Seal gate (dieTestGraph) — authoring-only, never sealed. Applying LIVE goes through
  // board.setComponentPinTest, which rebuilds the netlist so the readout updates immediately.
  // Push the current role+value to the pad (null clears it when role is "none").
  function applyPinTest(): void {
    if (!pinNameEdit) return;
    const test: PinTest | null =
      pinTestRole === "none"
        ? null
        : { role: pinTestRole, value: pinTestValue };
    board?.setComponentPinTest(
      pinNameEdit.componentId,
      pinNameEdit.pinIndex,
      test,
    );
  }
  // Pick a role from the button row. Switching INTO vcc/in seeds a sensible default voltage (5 V for
  // a supply, 0 V for an input drive) — but only when the role actually changes, so re-clicking the
  // active role never clobbers a value the player typed. Then apply live.
  function setPinTestRole(role: PinTestRole | "none"): void {
    if (role !== pinTestRole) {
      if (role === "vcc") pinTestValue = 5;
      else if (role === "in") pinTestValue = 0;
    }
    pinTestRole = role;
    applyPinTest();
  }
  // A value-input change (VCC/IN volts): clamp to a finite number, then apply live.
  function onPinTestValueInput(): void {
    if (!Number.isFinite(pinTestValue)) pinTestValue = 0;
    applyPinTest();
  }
  // Guarded blur on the NAME input: the popover also holds the stimulus controls, so a blur whose
  // focus is moving to another control INSIDE the popover must NOT close it — only commit the name
  // (re-label the pad) and stay open. A blur to anywhere else commits + closes as before. (The role
  // buttons additionally preventDefault their mousedown so clicking them doesn't blur the input at
  // all; this guard covers the value input + any tab-through.)
  function onPinNameBlur(e: FocusEvent): void {
    if (!pinNameEdit) return;
    const next = e.relatedTarget as Node | null;
    if (next && pinNamePopover?.contains(next)) {
      // Focus stayed inside the popover: commit the name only (via the underlying setter, which does
      // NOT close the editor — board.commitPinName would fire the close callback), and keep the panel
      // open so the player can finish setting the role/value.
      board?.setComponentPinName(
        pinNameEdit.componentId,
        pinNameEdit.pinIndex,
        pinNameValue,
      );
      return;
    }
    commitPinNameEdit();
  }
  function onPinNameKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      commitPinNameEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelPinNameEdit();
    }
    e.stopPropagation();
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
    resetDieState(); // abandon any open die — the outer board is being replaced
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
    resetDieState();
    demoOn = !demoOn;
    board?.loadGraph(demoOn ? ex.build() : ex.demo.alt());
    controls?.resume();
    syncRunning();
  }
  function startBuild(ex: ExampleSpec): void {
    resetDieState();
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

<div
  class="workspace"
  bind:this={workspaceEl}
  style="--bin-w: {binW}px"
  class:bin-resizing={binResizing}
>
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
      {#snippet partRow(part: {
        tag: string;
        name: string;
        desc: string;
        tier: string;
        color: string;
        // When set (a "My ICs" row), draw a package pin-ring thumbnail of this kind instead of the tag
        // text — a built-in PARTS row leaves it undefined and keeps its terse tag glyph.
        glyphKind?: string;
        // True for a "My Subassemblies" row — adds the Tape-out control (promote → board IC).
        isSubassembly?: boolean;
      })}
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
          {#if part.glyphKind}
            {@const pins = packageGlyphPins(part.glyphKind)}
            <span class="part-glyph part-glyph-ic">
              {#if pins}
                <svg
                  viewBox="0 0 {GLYPH_BOX} {GLYPH_BOX}"
                  width="30"
                  height="30"
                  aria-hidden="true"
                >
                  <rect
                    x="7"
                    y="7"
                    width={GLYPH_BOX - 14}
                    height={GLYPH_BOX - 14}
                    rx="2"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1"
                    opacity="0.55"
                  />
                  {#each pins as p (p.cx + "," + p.cy)}
                    <circle cx={p.cx} cy={p.cy} r="1.6" fill="currentColor" />
                  {/each}
                </svg>
              {:else}
                IC
              {/if}
            </span>
          {:else}
            <span class="part-glyph">{part.tag}</span>
          {/if}
          <span class="part-body">
            {#if part.glyphKind && renamingTag === part.tag}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="ic-rename mono"
                bind:value={renameValue}
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => {
                  if (e.key === "Enter") commitRenameIc();
                  else if (e.key === "Escape") renamingTag = null;
                }}
                onblur={commitRenameIc}
                autofocus
              />
            {:else}
              <span class="part-name">{part.name}</span>
              <span class="part-desc">{part.desc}</span>
            {/if}
          </span>
          {#if part.glyphKind}
            <!-- "My ICs" row controls: a variant badge (family) + rename + remove. stopPropagation so a
                 control click never arms/places the part. -->
            <span class="ic-row-ctl">
              {#if part.isSubassembly}
                <button
                  class="ic-row-btn ic-row-edit"
                  title="Open this subassembly's die — edit its circuit, resize the box, rename pins"
                  aria-label="Edit {part.name}"
                  onclick={(e) => {
                    e.stopPropagation();
                    editLibraryDie(part.tag);
                  }}>⊡ Edit</button
                >
                <button
                  class="ic-row-btn ic-row-char"
                  title="Characterize — sweep every input and read out the truth table this gate computes"
                  aria-label="Characterize {part.name}"
                  onclick={(e) => {
                    e.stopPropagation();
                    characterizeIc(part.tag);
                  }}>⊨ Characterize</button
                >
                <button
                  class="ic-row-btn ic-row-tapeout"
                  title="Tape out → board IC (choose a package, make it placeable)"
                  aria-label="Tape out {part.name}"
                  onclick={(e) => {
                    e.stopPropagation();
                    tapeOutIc(part.tag);
                  }}>⬡ Tape out</button
                >
              {/if}
              {#if hasUserIcVariants(part.tag)}
                <span
                  class="ic-variant-badge"
                  title="{userIcVariants(part.tag)?.length ??
                    0} variants — pick one in the inspector when placed"
                  >⎇{userIcVariants(part.tag)?.length ?? 0}</span
                >
              {/if}
              <button
                class="ic-row-btn"
                title="Rename"
                aria-label="Rename {part.name}"
                onclick={(e) => {
                  e.stopPropagation();
                  startRenameIc(part.tag, part.name);
                }}>✎</button
              >
              <button
                class="ic-row-btn ic-row-del"
                title="Remove from My ICs"
                aria-label="Remove {part.name}"
                onclick={(e) => {
                  e.stopPropagation();
                  removeIc(part.tag, part.name);
                }}>×</button
              >
            </span>
          {:else}
            <span class="part-tier">{part.tier}</span>
          {/if}
        </li>
      {/snippet}
      {#snippet familyRow(group: {
        name: string;
        color: string;
        parts: (typeof PARTS)[number][];
      })}
        <!-- A multi-member family: ONE collapsed row that expands inline to its members.
             The header only expands/collapses (it never arms); members arm as usual. -->
        <details class="part-family" style="--c: {group.color}">
          <summary class="part-family-head">
            <span class="part-family-glyph">{group.parts.length}</span>
            <span class="part-family-name">{group.name}</span>
            <span class="part-family-count">×{group.parts.length}</span>
          </summary>
          <ul class="part-list part-family-list">
            {#each group.parts as part (part.name)}
              {@render partRow(part)}
            {/each}
          </ul>
        </details>
      {/snippet}
      {#if armedPart && !selPart}
        <!-- Arm-time card, docked in the bin right where you picked the part (not in the top
             toolbar). The head names the armed part with a ⓘ PREVIEW button (open the info
             drawer on the armed-but-unplaced part — symbol/internals, pinout, equation — before
             you drop it; same as the I key) and a disarm ×. Below, for kinds with identity/
             quality axes, the CONFIGURATOR chips the inspector shows, but BEFORE placing — so
             the ghost is the configured part and place-and-repeat carpets it. The default
             (variant 0 / mid tier / push-pull / CC) needs zero clicks; this only lets you
             change it. Driven by the dual-target setters, which (with nothing selected) write
             `armedConfig` and re-tint the ghost. -->
        <div class="bin-config" role="group" aria-label="Armed part">
          <div class="bin-config-head">
            <span class="bin-config-name">{partName(armedPart)}</span>
            <span class="bin-config-actions">
              <button
                class="bin-config-info {infoOpen ? 'is-active' : ''}"
                onclick={() => (infoOpen = !infoOpen)}
                title="Preview this part's info & pinout before placing (I)"
                aria-label="Preview armed part info">ⓘ</button
              >
              <button
                class="armed-x"
                onclick={() => arm(null)}
                aria-label="Disarm">×</button
              >
            </span>
          </div>
          {#if hasConfig(armedPart)}
            {@render partConfig(armedPart)}
          {/if}
        </div>
      {/if}
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
        {@const icHits = savedIcParts.filter(
          (p) =>
            p.name.toLowerCase().includes(q) || p.tag.toLowerCase().includes(q),
        )}
        {@const hits = PARTS.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.tag.toLowerCase().includes(q) ||
            p.desc.toLowerCase().includes(q) ||
            (PART_SYNONYMS[p.tag] ?? []).some((s) => s.includes(q)),
        )}
        {#if hits.length > 0 || icHits.length > 0}
          <ul class="part-list scroll">
            {#each icHits as part (part.tag)}
              {@render partRow(part)}
            {/each}
            {#each hits as part (part.name)}
              {@render partRow(part)}
            {/each}
          </ul>
        {:else}
          <p class="part-empty">No parts match “{partSearch}”.</p>
        {/if}
      {:else}
        <div class="part-cats scroll">
          <!-- "+ New" — the create affordances: pre-wired gate templates, or a blank IC / subassembly
               die to build from scratch (§4.9/§4.10). Drilling into the die editor either way; the
               result lands in My ICs or My Subassemblies on Seal. -->
          <details class="part-cat new-create" open>
            <summary class="part-cat-head">
              <span class="part-cat-name">+ New</span>
            </summary>
            <div class="new-create-body">
              <div class="new-create-row">
                <span class="new-create-label">Gate</span>
                <div class="new-create-btns">
                  {#each GATE_TEMPLATE_KINDS as gk (gk)}
                    <button
                      class="btn new-create-btn"
                      onclick={() => newGateFromTemplate(gk)}
                      disabled={!!drill}
                      title={`Build a ${gateTemplateName(gk)} from CMOS transistors (SOT-23-5)`}
                    >
                      {gk}
                    </button>
                  {/each}
                </div>
              </div>
              <div class="new-create-row">
                <span class="new-create-label">Blank</span>
                <div class="new-create-btns">
                  <button
                    class="btn new-create-btn"
                    onclick={() => newBlankDie("ic")}
                    disabled={!!drill}
                    title="Start a blank IC — drill into an empty DIP-8 package and build it"
                  >
                    IC
                  </button>
                  <button
                    class="btn new-create-btn"
                    onclick={() => newBlankDie("subassembly")}
                    disabled={!!drill}
                    title="Start a blank subassembly (nested-only; Tape out to the board later)"
                  >
                    Subassembly
                  </button>
                </div>
              </div>
            </div>
          </details>
          <!-- "My ICs" — the personal IC library. Always shown (even empty) so the two-library structure
               is clear; each row places via the SAME arm/drag path as a built-in. -->
          <details class="part-cat" open>
            <summary class="part-cat-head">
              <span class="part-cat-name">My ICs</span>
              {#if savedIcParts.length > 0}
                <span class="part-cat-count">{savedIcParts.length}</span>
              {/if}
            </summary>
            {#if savedIcParts.length > 0}
              <ul class="part-list">
                {#each savedIcParts as part (part.tag)}
                  {@render partRow(part)}
                {/each}
              </ul>
            {:else}
              <p class="part-empty-hint">
                Build one with <strong>+ New ▸ Gate</strong> or
                <strong>IC</strong>, then Seal it.
              </p>
            {/if}
          </details>
          <!-- "My Subassemblies" — bare, nested-only building blocks (role='subassembly', §4.3/§4.9).
               Always shown so the subassembly-vs-IC vocabulary is visible; a subassembly reaches the
               board only via Tape out (P3b). -->
          <details class="part-cat" open>
            <summary class="part-cat-head">
              <span class="part-cat-name">My Subassemblies</span>
              {#if savedSubassemblyParts.length > 0}
                <span class="part-cat-count"
                  >{savedSubassemblyParts.length}</span
                >
              {/if}
            </summary>
            {#if savedSubassemblyParts.length > 0}
              <ul class="part-list">
                {#each savedSubassemblyParts as part (part.tag)}
                  {@render partRow(part)}
                {/each}
              </ul>
            {:else}
              <p class="part-empty-hint">
                Box-select parts → <strong>⬡ Make subassembly</strong>, or
                <strong>+ New ▸ Subassembly</strong>.
              </p>
            {/if}
          </details>
          {#each PART_CATEGORIES as cat (cat)}
            {@const groups = familyGroups(cat)}
            {#if groups.length > 0}
              <details class="part-cat" open>
                <summary class="part-cat-head">
                  <span class="part-cat-name">{cat}</span>
                  <span class="part-cat-count"
                    >{groups.reduce(
                      (n, g) => n + (g.kind === "family" ? g.parts.length : 1),
                      0,
                    )}</span
                  >
                </summary>
                <ul class="part-list">
                  {#each groups as group (group.kind === "family" ? group.name : group.part.name)}
                    {#if group.kind === "family"}
                      <li class="part-family-li">{@render familyRow(group)}</li>
                    {:else}
                      {@render partRow(group.part)}
                    {/if}
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

  <!-- Drag handle on the parts-bin's right edge: widen the bin (e.g. to reveal a subassembly row's
       rename/remove controls past Edit/Characterize/Tape out). Sits on the column seam; pointer-captured
       so the drag tracks even over the canvas. Double-click resets to the default width. -->
  <div
    class="bin-resizer"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize parts panel"
    title="Drag to resize the parts panel (double-click to reset)"
    onpointerdown={startBinResize}
    onpointermove={onBinResize}
    onpointerup={endBinResize}
    ondblclick={() => {
      binW = 264;
      try {
        localStorage.setItem("cec-bin-w", "264");
      } catch {
        /* ignore */
      }
    }}
  ></div>

  <!-- The shared part-CONFIGURATOR rows: the device's identity/quality axes (variant /
       tier / family / open-drain / load mode + step / PULSE waveform) that today only
       showed once a part was placed. Factored into a snippet — declared here at the
       WORKSPACE root so it's in scope for all three render sites: the arm-time
       configurator card docked in the parts bin, and the selected-part inspector in the
       board frame. Both are driven by the dual-target sel*/set* helpers, so a click edits
       the selected part or the pending (armed) config interchangeably. Value-SEMANTICS rows
       (the value picker, AC amplitude/mains, LS rail, POT/thermistor) stay in the inspector
       only — they're per-instance knobs, not arm-time axes. -->
  {#snippet partConfig(kind: string)}
    {#if hasTiers(kind)}
      <!-- Quality tier (main gameplay): each grade is a preset bundle of the
             device's model parameters (a cap's ESR/ESL, an op-amp's GBW, an
             inductor's DCR/winding-C, a source's output impedance, a resistor's
             tolerance, a MOSFET's Kp, a BJT's β), so a better tier self-resonates
             higher / is faster / regulates stiffer / has more gain (and, later, costs
             more). The non-ideal grades bite only in Real mode; the sandbox keeps raw
             param editing. -->
      <div class="insp-sub">quality tier</div>
      <div class="insp-chips wrap">
        {#each TIER_LABELS as label, i (label)}
          <button
            class="chip-val {selTier() === i ? 'is-active' : ''}"
            onclick={() => setTier(i)}>{label}</button
          >
        {/each}
      </div>
    {/if}
    {#if hasDiodeTypes(kind)}
      {@const dv = diodeVariant(kind, selVariant())}
      <!-- Diode TYPE (main gameplay): switching / rectifier / fast-recovery / power.
             Each preset sets the forward junction (Is/n → forward drop) and a current
             rating; the rating bites in Real mode (an over-rated diode FAILs). -->
      <div class="insp-sub">diode type</div>
      <div class="insp-chips wrap">
        {#each DIODE_TYPES as dt, i (dt.label)}
          <button
            class="chip-val {selVariant() === i ? 'is-active' : ''}"
            onclick={() => setVariant(i)}>{dt.label}</button
          >
        {/each}
      </div>
      {#if dv}
        <div class="insp-sub">
          rated · <span class="mono">{formatValue(dv.ratedA, "A")}</span>
          {#if realModels}<span class="mono">(FAIL above)</span>{/if}
        </div>
        {#if realModels}
          <!-- Reverse recovery (Real mode): a slower part (bigger transit time) sweeps
                 out more charge on switch-off — the reverse-current spike a switcher hates. -->
          <div class="insp-sub">
            reverse recovery · <span class="mono"
              >{dv.tt === 0
                ? "none"
                : dv.tt <= 1e-6
                  ? "fast"
                  : dv.tt <= 4e-6
                    ? "medium"
                    : "slow"}</span
            >
          </div>
        {/if}
      {/if}
    {/if}
    {#if hasLedColors(kind)}
      {@const colors = variantList(kind) ?? []}
      <!-- LED COLOUR (main gameplay): the emitted colour sets the forward voltage
             (red ~1.9 V … blue/white ~3 V) and tints the glyph. -->
      <div class="insp-sub">colour</div>
      <div class="insp-chips wrap">
        {#each colors as col, i (col.label)}
          <button
            class="chip-val {selVariant() === i ? 'is-active' : ''}"
            onclick={() => setVariant(i)}>{col.label}</button
          >
        {/each}
      </div>
    {/if}
    {#if hasUserIcVariants(kind)}
      {@const variants = userIcVariants(kind) ?? []}
      <!-- USER-IC VARIANT (a player-made family): pick which sealed inner circuit this placed instance
           is. Reuses the same selVariant/setVariant dual-target path as diode/LED variants — it
           read/writes Component.variant (an integer index), and flatten resolves it to that variant's
           authored die BEFORE buildNetlist (a pure graph→graph choice; golden-safe). -->
      <div class="insp-sub">variant</div>
      <div class="insp-chips wrap">
        {#each variants as v, i (v.tag)}
          <button
            class="chip-val {selVariant() === i ? 'is-active' : ''}"
            onclick={() => setVariant(i)}>{v.name}</button
          >
        {/each}
      </div>
    {/if}
    {#if isDigitalPart(kind)}
      {@const lv = familyLevels(selFamily(), partValue(kind))}
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
          >{formatValue(lv.vOl, "V")} / {formatValue(lv.vOh, "V")}</span
        >
        · noise margin
        <span class="mono"
          >{formatValue(lv.nmHigh, "V")} hi · {formatValue(lv.nmLow, "V")} lo</span
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
          releases high · <span class="mono">add a pull-up to Vcc</span>
        </div>
      {/if}
    {/if}
    {#if kind === "PULSE"}
      <!-- The pulse / clock generator: high level (amplitude), waveform (square or
             triangle), and duty cycle. `value` (the frequency, Hz) uses the row above. -->
      <div class="insp-sub">high level</div>
      <div class="insp-row">
        <button
          class="btn btn-ghost insp-step"
          onclick={() => stepAmpVal(-1)}
          title="Next smaller level">−</button
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
          title="Next larger level">+</button
        >
      </div>
      <div class="insp-sub">waveform</div>
      <div class="insp-chips wrap">
        {#each ["Square", "Triangle"] as wf, i (wf)}
          <button
            class="chip-val {selVariant() === i ? 'is-active' : ''}"
            onclick={() => setVariant(i)}>{wf}</button
          >
        {/each}
      </div>
      <div class="insp-sub">
        duty · {Math.round(selDuty() * 100)}%
      </div>
      <div class="insp-row">
        <span class="wiper-end">0</span>
        <input
          class="wiper-slider"
          type="range"
          min="0.05"
          max="0.95"
          step="0.01"
          value={selDuty()}
          aria-label="Pulse duty cycle"
          oninput={(e) => setDuty(Number(e.currentTarget.value))}
        />
        <span class="wiper-end">1</span>
      </div>
    {/if}
    {#if kind === "LOAD"}
      <!-- The electronic load's MODE: constant-current (CC) draws a set current
             regardless of voltage; constant-resistance (CR) draws V/R. The mode sets
             the value chips' unit (A vs Ω) — handled in the inspector via loadChipsForMode
             + fmtVal — and which element buildNetlist emits. -->
      <div class="insp-sub">mode</div>
      <div class="insp-chips">
        <button
          class="chip-val {selLoadMode() === 0 ? 'is-active' : ''}"
          onclick={() => setLoadMode(0)}
          title="Constant current — draw a set current regardless of voltage"
          >CC</button
        >
        <button
          class="chip-val {selLoadMode() === 1 ? 'is-active' : ''}"
          onclick={() => setLoadMode(1)}
          title="Constant resistance — draw V/R like a fixed resistor"
          >CR</button
        >
      </div>
      {#if selLoadMode() === 0}
        <!-- Dynamic load step (CC only): step the draw between the base level (the
               value chips in the inspector) and a PEAK at a chosen rate/duty — the load-step
               that probes a supply's transient response. Off (0 Hz) = a static DC load. -->
        <div class="insp-sub">dynamic load step</div>
        <div class="insp-chips wrap">
          {#each LOAD_STEP_HZ as hz (hz)}
            <button
              class="chip-val {selLoadHz() === hz ? 'is-active' : ''}"
              onclick={() => setLoadHz(hz)}
              >{hz === 0 ? "Off" : formatValue(hz, "Hz")}</button
            >
          {/each}
        </div>
        {#if selLoadHz() > 0}
          <!-- The peak current (the load's `amp` second scalar): the value chips set
                 the BASE, this sets the PEAK it steps up to. Reuses the amp chips/stepper. -->
          <div class="insp-sub">peak</div>
          <div class="insp-row">
            <button
              class="btn btn-ghost insp-step"
              onclick={() => stepAmpVal(-1)}
              title="Next smaller peak">−</button
            >
            <div class="insp-chips wrap">
              {#each acAmpChips() as v (v)}
                <button
                  class="chip-val {selAmp() === v ? 'is-active' : ''}"
                  onclick={() => setAmp(v)}>{formatValue(v, "A")}</button
                >
              {/each}
            </div>
            <button
              class="btn btn-ghost insp-step"
              onclick={() => stepAmpVal(1)}
              title="Next larger peak">+</button
            >
          </div>
          <div class="insp-sub">
            duty · {Math.round(selDuty() * 100)}%
          </div>
          <div class="insp-row">
            <span class="wiper-end">0</span>
            <input
              class="wiper-slider"
              type="range"
              min="0.05"
              max="0.95"
              step="0.01"
              value={selDuty()}
              aria-label="Load step duty cycle"
              oninput={(e) => setDuty(Number(e.currentTarget.value))}
            />
            <span class="wiper-end">1</span>
          </div>
        {/if}
      {/if}
    {/if}
    {#if kind === "LUT"}
      <!-- FPGA logic cell: the 16-bit truth table is the program. Presets set the common
             functions; the hex field reaches any of the 65 536 tables (OUT = bit
             [IN0 | IN1<<1 | IN2<<2 | IN3<<3]). The output register makes it a clocked cell. -->
      <div class="insp-sub">function · preset</div>
      <div class="insp-chips wrap">
        {#each LUT_PRESETS as p (p.name)}
          <button
            class="chip-val {selWord() === p.table ? 'is-active' : ''}"
            onclick={() => setWord(p.table)}
            title={p.hint}>{p.name}</button
          >
        {/each}
      </div>
      <div class="insp-sub">truth table · hex</div>
      <div class="insp-row">
        <span class="mono">0x</span>
        <input
          class="insp-hex mono"
          type="text"
          spellcheck="false"
          maxlength="4"
          value={selWord().toString(16).toUpperCase().padStart(4, "0")}
          aria-label="LUT truth table (hex)"
          onchange={(e) => setWordHex(e.currentTarget.value, 0xffff)}
        />
      </div>
      <div class="insp-sub">output register</div>
      <div class="insp-chips">
        <button
          class="chip-val {selLutReg() === 0 ? 'is-active' : ''}"
          onclick={() => setLutReg(0)}
          title="Output follows the table live (no clock)">Combinational</button
        >
        <button
          class="chip-val {selLutReg() === 1 ? 'is-active' : ''}"
          onclick={() => setLutReg(1)}
          title="Output latched into a register on the rising CLK edge"
          >Registered</button
        >
      </div>
    {/if}
    {#if kind === "SPIM" || kind === "SPIS" || kind === "UART"}
      <!-- The data word the block sends: the SPI master's TX word / the slave's reply on
             MISO / the UART's transmitted byte, set in hex. -->
      <div class="insp-sub">
        {kind === "SPIS" ? "reply word · hex" : "data word · hex"}
      </div>
      <div class="insp-row">
        <span class="mono">0x</span>
        <input
          class="insp-hex mono"
          type="text"
          spellcheck="false"
          maxlength="8"
          value={selWord().toString(16).toUpperCase()}
          aria-label="Serial data word (hex)"
          onchange={(e) => setWordHex(e.currentTarget.value, 0xffffffff)}
        />
      </div>
    {/if}
  {/snippet}

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
      {#if !drill}
        <button
          class="btn btn-ghost {mode === 'region' ? 'is-active' : ''}"
          onclick={enterRegion}
          disabled={!ready}
          title="Region: drag a box around part of the circuit to bottle it up as a free-form subassembly — pins appear where wires cross the box; seal when ready (G)"
        >
          ⬓ Region <kbd class="hk">G</kbd>
        </button>
      {/if}
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
        class="btn btn-ghost {codexOpen ? 'is-active' : ''}"
        onclick={openCodex}
        title="Codex: the full browsable reference — every component, exhaustively"
      >
        ⊞ Codex
      </button>
      <button
        class="btn btn-ghost {boardLens !== 'schematic' ? 'is-active' : ''}"
        onclick={cycleLens}
        disabled={!ready || !lodOn}
        title="Board lens: schematic → analogy → reality. Zoom in on a part to see its analogy/reality detail."
      >
        {boardLens === "reality"
          ? "⬡ Reality"
          : boardLens === "analogy"
            ? "◆ Analogy"
            : "⎍ Schematic"}
      </button>
      <button
        class="btn btn-ghost {lodOn ? 'is-active' : ''}"
        onclick={toggleLod}
        disabled={!ready}
        title="Zoom level-of-detail: on reveals analogy/reality detail as you zoom into a part; off keeps plain schematic symbols at any zoom."
      >
        {lodOn ? "⊕ LOD" : "⊘ LOD"}
      </button>
      {#if armedPart}
        <span class="armed-wrap">
          <span class="armed-chip" title="Armed for placement">
            {partName(armedPart)}
            <button
              class="armed-x"
              onclick={() => arm(null)}
              aria-label="Disarm">×</button
            >
          </span>
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
      <button
        class="btn btn-ghost"
        onclick={flipSel}
        disabled={!ready || selCount === 0}
        title="Flip (mirror) selected (F)"
      >
        Flip <kbd class="hk">F</kbd>
      </button>
      {#if !drill && selComponentCount >= 2}
        <!-- Overworld "Make subassembly" (§4.9): box-select parts, infer the pinout from the nets that
             leave the selection, and bank it as a nested-only subassembly (Tape out → board IC). -->
        <button
          class="btn btn-accent"
          onclick={makeSubassembly}
          disabled={!ready}
          title="Bundle the selected parts into a subassembly — pins are inferred from the wires leaving the selection"
        >
          ⬡ Make subassembly
        </button>
      {/if}
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

      <!-- Region tool's floating action bar — kept OUT of the top toolbar so it never crowds / overlaps
           the tool buttons (owner). A top-centre overlay (mirrors the die-bar), shown whenever a region
           rectangle is pending or the Region tool is active: name it, seal it, cancel it. Region mode is
           outer-board-only and the die-bar only shows while drilled in, so the two never collide. -->
      {#if regionInfo || mode === "region"}
        <div class="region-bar" role="region" aria-label="Region tool">
          <span class="region-bar-title mono">REGION</span>
          <input
            class="insp-name mono region-name"
            type="text"
            placeholder="subassembly name (optional)"
            bind:value={regionName}
            maxlength="24"
            aria-label="Name the sealed subassembly"
            onkeydown={(e) => {
              if (e.key === "Enter") sealRegion();
            }}
          />
          <button
            class="btn btn-accent"
            onclick={sealRegion}
            disabled={!ready || !regionInfo || regionInfo.pinCount < 1}
            title="Seal the boxed region into a free-form subassembly — its pins are where wires cross the box"
          >
            ⬡ Seal{regionInfo && regionInfo.pinCount > 0
              ? ` (${regionInfo.pinCount} ${regionInfo.pinCount === 1 ? "pin" : "pins"})`
              : ""}
          </button>
          {#if regionInfo}
            <button
              class="btn btn-ghost region-bar-x"
              onclick={cancelRegion}
              title="Discard the region rectangle (Esc)">×</button
            >
          {/if}
          <span class="region-hint">
            {#if regionInfo && regionInfo.pinCount > 0}
              {mode === "region" ? "drag to resize" : "press G to resize"}
            {:else if regionInfo && regionInfo.reason}
              {regionInfo.reason}
            {:else}
              drag a box around the parts
            {/if}
          </span>
        </div>
      {/if}

      <!-- IC-maker DIE EDITOR back bar (ADR 0006). Shown only while drilled INTO a frame: a
           breadcrumb naming the IC + its package, a live seal advisory (does it compile / how many
           leads are wired), and the three exits — Seal (validate + collapse to chip), Save (stash
           the in-progress die + return), Back (return unchanged). Every exit restores the outer
           board + camera. -->
      {#if drill}
        {@const pkg = framePackage(drill.frameTag)}
        <div class="die-bar" role="region" aria-label="IC die editor">
          <div class="die-crumb">
            <span class="die-crumb-board">Board</span>
            <span class="die-crumb-sep">▸</span>
            <span class="die-crumb-here">
              {#if drill.editingTag}
                Editing {drill.editingTag}
              {:else}
                Die · {drill.name}
              {/if}
              {#if pkg}
                <span class="die-crumb-pkg">{pkg.archetype}-{pkg.pinCount}</span
                >
              {/if}
            </span>
          </div>
          {#if isFreeFormFrame(drill.frameTag) && freeFormBox}
            <!-- Free-form (box-captured) subassembly (§4.10): resize the BOX — "expand and contract the
                 size of the block". The pin COUNT is fixed by the capture (each lead is a real crossing);
                 a pin that sat on a shrunk wall re-pins onto the new edge. To MOVE a pin along the edge,
                 Alt-drag it (a plain drag starts a wire from the pad). -->
            <div
              class="die-pins"
              title="Resize this subassembly's box (Alt-drag a wall pin to move it along the edge)"
            >
              <span class="die-pins-label">Box</span>
              <button
                class="die-pins-btn"
                onclick={() => changeBox(-1, 0)}
                disabled={freeFormBox.w <= 2}
                aria-label="Narrower">W−</button
              >
              <button
                class="die-pins-btn"
                onclick={() => changeBox(1, 0)}
                aria-label="Wider">W+</button
              >
              <span class="die-pins-n mono"
                >{freeFormBox.w}×{freeFormBox.h}</span
              >
              <button
                class="die-pins-btn"
                onclick={() => changeBox(0, -1)}
                disabled={freeFormBox.h <= 2}
                aria-label="Shorter">H−</button
              >
              <button
                class="die-pins-btn"
                onclick={() => changeBox(0, 1)}
                aria-label="Taller">H+</button
              >
            </div>
          {:else if pkg && pkg.archetype === "BLOCK"}
            <!-- Generic blank subassembly: expandable pin count (§4.10) — grow/shrink the BLOCK's pins
                 while building. The new pin is unconnected until you wire it. -->
            <div
              class="die-pins"
              title="Add or remove pins on this free-form subassembly"
            >
              <span class="die-pins-label">Pins</span>
              <button
                class="die-pins-btn"
                onclick={() => changeDiePins(-1)}
                disabled={pkg.pinCount <= 1}
                aria-label="Remove a pin">−</button
              >
              <span class="die-pins-n mono">{pkg.pinCount}</span>
              <button
                class="die-pins-btn"
                onclick={() => changeDiePins(1)}
                aria-label="Add a pin">+</button
              >
            </div>
          {/if}
          {#if dieStatus}
            <div
              class="die-status mono {dieStatus.sealable ? 'is-ok' : 'is-bad'}"
              title={dieStatus.sealable
                ? "This die compiles — ready to seal"
                : "Wire a complete, reference-anchored circuit before sealing"}
            >
              {dieStatus.sealable ? "● solvable" : "○ not solvable"} ·
              {dieStatus.used}/{dieStatus.total} pins
            </div>
          {/if}
          <span
            class="die-hint mono"
            title="Double-click a wall pin to name it"
          >
            dbl-click a pin to name it
          </span>
          {#if !drill.editingTag}
            <!-- The seal NAME only applies to a fresh seal (a mint). When editing, the tag is fixed
                 (Reseal updates the existing def), so the name field is omitted. -->
            <input
              class="insp-name mono die-seal-name"
              type="text"
              placeholder="name (auto: CEC9xxx)"
              bind:value={sealName}
              maxlength="24"
              aria-label="Name the sealed IC"
              onkeydown={(e) => {
                if (e.key === "Enter") dieSeal();
              }}
            />
            <!-- "Variant of …": seal this die as a new VARIANT of an existing IC (grouping several
                 sealed inner circuits under one placeable family, picked per-instance in the inspector).
                 Default "New IC" = a fresh top-level seal. A variant must share the family's package. -->
            {#if userIcFamilyTargets().length > 0}
              <select
                class="insp-name mono die-seal-variant"
                bind:value={sealVariantOf}
                aria-label="Seal as a variant of an existing IC"
                title="Seal as a new variant of an existing IC (same package), or as a new IC"
              >
                <option value="">New IC</option>
                {#each userIcFamilyTargets() as t (t.tag)}
                  <option value={t.tag}>Variant of {t.name}</option>
                {/each}
              </select>
            {/if}
            <!-- Seal as a bare, nested-only SUBASSEMBLY (§4.3): it lands in "My Subassemblies" and is
                 placed only inside other dies; Tape out promotes it to a board IC. Disabled while
                 sealing as a variant (a variant inherits its family's role). -->
            <label
              class="die-seal-sub"
              title="Seal as a nested-only building block (reach the board later via Tape out)"
            >
              <input
                type="checkbox"
                bind:checked={sealAsSubassembly}
                disabled={!!sealVariantOf}
              />
              <span>Subassembly (nested-only)</span>
            </label>
          {/if}
          <div class="die-actions">
            <button
              class="btn btn-ghost"
              onclick={dieBack}
              title={drill.editingTag
                ? "Discard these edits — return to the board; the IC keeps its sealed circuit"
                : "Discard nothing — return to the board; the frame stays buildable"}
            >
              Back
            </button>
            {#if !drill.editingTag}
              <button
                class="btn btn-ghost"
                onclick={dieSave}
                title="Keep this in-progress die and return to the board"
              >
                Save
              </button>
            {/if}
            <button
              class="btn btn-accent"
              onclick={dieSeal}
              disabled={!dieStatus?.sealable}
              title={dieStatus?.sealable
                ? drill.editingTag
                  ? "Reseal: update this IC's circuit on every placed instance"
                  : "Seal this die into a placeable IC where the frame sits"
                : "The circuit must solve before it can be sealed"}
            >
              {drill.editingTag ? "Reseal ✓" : "Seal ✓"}
            </button>
          </div>
        </div>
      {/if}

      <div class="board-overlay">
        <span class="scope-tag">{hint}</span>
        <span class="scope-tag">
          {partCount} parts · {wireCount} wires · {selCount} sel
        </span>
      </div>

      <!-- Zoom meter (Phase 5): magnification ×M + a snapped METRIC scale rule (mm → µm → nm, anchored
           on one board cell = MM_PER_TOP_CELL) that shrinks as you dive through the recursive IC zoom. A
           non-interactive bench-instrument readout pinned bottom-left; the rule is a ⊔ bracket whose
           width is the snapped physical length. -->
      <div
        class="zoom-meter"
        aria-hidden="true"
        title="Magnification & scale reference"
      >
        <span class="zoom-mag mono">{magLabel}</span>
        <div class="zoom-scale">
          <div
            class="zoom-rule"
            style="width: {scaleRule.px.toFixed(1)}px"
          ></div>
          <span class="zoom-rule-label mono">{scaleRule.label}</span>
        </div>
      </div>

      <!-- Quick-recall hotbar: nine configured-part slots along the board's bottom edge.
           Press a digit to arm that slot's part (place-and-repeat), Shift+digit to store
           the armed part there, right-click (or the ×) to clear; Q pipettes the selected
           part into your hand. A filled cell shows the part glyph tinted by its kind
           colour + a compact name; the live (currently-armed) slot lights accent. -->
      <div class="hotbar" role="toolbar" aria-label="Quick-recall hotbar">
        {#each hotbar as slot, i (i)}
          <!-- Operable from the keyboard via the global 1–9 / Shift+1–9 handlers (which do
               exactly what a click here does), so the per-cell click is a pointer convenience;
               the strip itself isn't a tab stop (tabindex −1). -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="hotcell {slot ? 'is-filled' : 'is-empty'} {slotIsArmed(slot)
              ? 'is-armed'
              : ''}"
            style={slot ? `--c: ${partColor(slot.kind)}` : ""}
            role="button"
            tabindex="-1"
            title={slot
              ? `${partName(slot.kind)} — press ${i + 1} to arm · Shift+${i + 1} to reassign · right-click to clear`
              : armedPart
                ? `Empty — press Shift+${i + 1} (or click) to store ${partName(armedPart)} here`
                : `Empty slot ${i + 1} — arm a part, then Shift+${i + 1} to store it here`}
            onclick={() => clickSlot(i)}
            oncontextmenu={(e) => {
              e.preventDefault();
              clearSlot(i);
            }}
          >
            <kbd class="hotkey">{i + 1}</kbd>
            {#if slot}
              <span class="hotglyph">{slot.kind}</span>
              <span class="hotname">{partName(slot.kind)}</span>
              <button
                class="hotclear"
                onclick={(e) => {
                  e.stopPropagation();
                  clearSlot(i);
                }}
                title="Clear this slot"
                aria-label="Clear slot {i + 1}">×</button
              >
            {:else}
              <span class="hotempty" aria-hidden="true"></span>
            {/if}
          </div>
        {/each}
      </div>

      {#if circuitWarning}
        <div class="circuit-warn">⚠ {circuitWarning}</div>
      {/if}

      {#if charResult}
        <!-- Characterization result (the engine's "1"): the truth table the swept cell computes, plus the
             recognized gate + the prog-4 LUT word it collapsed to. Stays up until the player closes it. -->
        <div
          class="char-panel"
          role="dialog"
          aria-label="Truth table for {charResult.name}"
        >
          <div class="char-head">
            <span class="char-title">{charResult.name}</span>
            {#if charResult.gate}
              <span class="char-gate" title="Recognized Boolean function"
                >{charResult.gate}</span
              >
            {/if}
            <span class="char-word mono" title="Collapsed prog-4 LUT word"
              >LUT 0x{charResult.word.toString(16).toUpperCase()}</span
            >
            <button
              class="char-close"
              title="Close"
              aria-label="Close truth table"
              onclick={() => (charResult = null)}>×</button
            >
          </div>
          <table class="char-tt mono">
            <thead>
              <tr>
                {#each charResult.cols as i (i)}
                  <th>I{i}</th>
                {/each}
                <th class="char-out">Y</th>
              </tr>
            </thead>
            <tbody>
              {#each charResult.vectors as v, vi (vi)}
                <tr>
                  {#each v.in as bit, bi (bi)}
                    <td class:hi={bit === 1}>{bit}</td>
                  {/each}
                  <td class="char-out" class:hi={v.out === 1}>{v.out}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <div class="char-foot">
            Swept into a LUT — a behavioral copy simulates as one cheap cell.
          </div>
        </div>
      {/if}

      {#if labelEdit}
        <div
          class="net-label-editor"
          style="left: {labelEdit.rect.x}px; top: {labelEdit.rect.y}px;"
        >
          <input
            bind:this={labelInput}
            class="net-label-input mono"
            bind:value={labelEditValue}
            placeholder="net name"
            maxlength="24"
            spellcheck="false"
            autocomplete="off"
            onkeydown={onLabelKey}
            onblur={commitLabelEdit}
            aria-label="Net label name"
          />
          <!-- Pin a colour to this net (overrides the voltage colour). The swatches
               are the renderer PALETTE so the chip matches the wire it paints; "Auto"
               clears the override. onpointerdown + preventDefault keeps the input
               focused so its blur-commit doesn't fire mid-click. -->
          <div class="net-label-swatches">
            <button
              type="button"
              class="net-swatch net-swatch-auto {labelEditColor === null
                ? 'is-active'
                : ''}"
              title="Auto (voltage colour)"
              aria-label="Auto net colour (voltage)"
              aria-pressed={labelEditColor === null}
              onpointerdown={(e) => {
                e.preventDefault();
                labelEditColor = null;
              }}>A</button
            >
            {#each NET_LABEL_SWATCHES as sw (sw.hex)}
              <button
                type="button"
                class="net-swatch {labelEditColor === sw.hex
                  ? 'is-active'
                  : ''}"
                style="--sw: {cssHex(sw.hex)};"
                title={sw.name}
                aria-label="{sw.name} net colour"
                aria-pressed={labelEditColor === sw.hex}
                onpointerdown={(e) => {
                  e.preventDefault();
                  labelEditColor = sw.hex;
                }}
              ></button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- IC-maker die editor: the port-pad editor — a small panel over a die frame's perimeter pin
           (opened by double-clicking the pin). It NAMES the pad AND sets its TEST STIMULUS (None /
           GND / VCC / Input drive) so a power-fed IC solves + seals in the editor. The stimulus is
           authoring-only and is never part of the sealed chip. Enter / blur (outside the panel)
           commits the name + closes; Escape cancels. A blank name reverts the pad to its package pin
           number. Role + value apply LIVE. -->
      {#if pinNameEdit}
        <div
          class="net-label-editor pin-pad-editor"
          bind:this={pinNamePopover}
          style="left: {pinNameEdit.rect.x}px; top: {pinNameEdit.rect.y}px;"
        >
          <input
            bind:this={pinNameInput}
            class="net-label-input mono"
            bind:value={pinNameValue}
            placeholder={"pin " + pinNameEdit.number}
            maxlength="12"
            spellcheck="false"
            autocomplete="off"
            onkeydown={onPinNameKey}
            onblur={onPinNameBlur}
            aria-label="Pin name"
          />
          <!-- TEST STIMULUS role row. mousedown.preventDefault keeps the name input from blur-closing
               the panel when a role button is clicked. -->
          <div
            class="pin-test-roles"
            role="group"
            aria-label="Pin test stimulus"
          >
            {#each [{ r: "none", l: "None" }, { r: "gnd", l: "GND" }, { r: "vcc", l: "VCC" }, { r: "in", l: "IN" }] as opt (opt.r)}
              <button
                type="button"
                class="pin-test-role mono {pinTestRole === opt.r
                  ? 'is-active'
                  : ''}"
                onmousedown={(e) => {
                  e.preventDefault();
                  setPinTestRole(opt.r as PinTestRole | "none");
                }}
                title={opt.r === "none"
                  ? "No test stimulus"
                  : opt.r === "gnd"
                    ? "0 V reference (the die's ground)"
                    : opt.r === "vcc"
                      ? "Supply voltage (powers the die)"
                      : "Input drive voltage"}
              >
                {opt.l}
              </button>
            {/each}
          </div>
          {#if pinTestRole === "vcc" || pinTestRole === "in"}
            <div class="pin-test-value">
              <input
                class="net-label-input pin-test-volts mono"
                type="number"
                step="0.1"
                bind:value={pinTestValue}
                oninput={onPinTestValueInput}
                onkeydown={(e) => e.stopPropagation()}
                aria-label="Stimulus voltage"
              />
              <span class="pin-test-unit mono">V</span>
            </div>
          {/if}
        </div>
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
          {#if selDisplay}
            <div class="insp-meter mono">
              {#if selRmsMode}<span class="rms-tag">rms</span>{/if}
              {formatValue(selDisplay.vAcross, "V")} across · {formatValue(
                selDisplay.current,
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
          {#if isFrame(kind) && !drill}
            <!-- IC maker (ADR 0006 / docs/ui/ic-maker-guide.md): a frame is an empty package. The
                 primary flow is BUILD — drill INTO the frame to construct its die (the inner
                 circuit) on its own canvas, then Seal from inside. The secondary "seal as IC" here
                 collapses the frame + whatever is wired to it ON THE OUTER BOARD in place (the older
                 inline-author path). Hidden while already inside a die (the back bar seals there).
                 The name is optional — blank auto-assigns the next CEC9xxx. -->
            <div class="insp-sub">build the IC inside</div>
            <div class="insp-row">
              <button
                class="btn btn-accent insp-seal"
                onclick={buildSelectedFrame}
                title="Drill into this package and build its circuit on the die"
              >
                Build ▸
              </button>
            </div>
            <div class="insp-sub">or seal in place</div>
            <div class="insp-row">
              <input
                class="insp-name mono"
                type="text"
                placeholder="name (auto: CEC9xxx)"
                bind:value={sealName}
                maxlength="24"
                aria-label="Name the sealed IC"
                onkeydown={(e) => {
                  if (e.key === "Enter") sealSelected();
                }}
              />
            </div>
            <div class="insp-row">
              <button class="btn btn-ghost insp-seal" onclick={sealSelected}>
                Seal as IC
              </button>
            </div>
          {/if}
          {#if isUserIc(kind) && !drill}
            <!-- IC maker (ADR 0006): a PLACED sealed user IC. EDIT re-opens its authored die (a copy)
                 to tweak the inner circuit, then Reseal updates the def — every placed instance of
                 this kind follows. Mirrors the frame's Build; hidden while already inside a die. -->
            <div class="insp-sub">edit this IC</div>
            <div class="insp-row">
              <button
                class="btn btn-accent insp-seal"
                onclick={editUserIcSelected}
                title="Re-open this sealed IC's circuit to edit, then reseal to update every instance"
              >
                Edit ▸
              </button>
            </div>
            {#if placedDeviceBox}
              <!-- Chip Bench Phase 1: resize a free-form subassembly's box right here in the overworld —
                   no drill-in. Every placed copy + the bin glyph follow (the device's shape is its
                   identity); undoable. Spatial drag-handles land in a later slice; these steppers are the
                   always-available accessible path the design panel requires. -->
              <div
                class="die-pins"
                title="Resize this device's box — every placed copy follows (undoable)"
              >
                <span class="die-pins-label">Box</span>
                <button
                  class="die-pins-btn"
                  onclick={() => changeDeviceBox(-1, 0)}
                  disabled={placedDeviceBox.w <= 2}
                  aria-label="Narrower">W−</button
                >
                <button
                  class="die-pins-btn"
                  onclick={() => changeDeviceBox(1, 0)}
                  aria-label="Wider">W+</button
                >
                <span class="die-pins-n mono"
                  >{placedDeviceBox.w}×{placedDeviceBox.h}</span
                >
                <button
                  class="die-pins-btn"
                  onclick={() => changeDeviceBox(0, -1)}
                  disabled={placedDeviceBox.h <= 2}
                  aria-label="Shorter">H−</button
                >
                <button
                  class="die-pins-btn"
                  onclick={() => changeDeviceBox(0, 1)}
                  aria-label="Taller">H+</button
                >
              </div>
            {/if}
          {/if}
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
                  <!-- Electronic load: the value chips follow the mode (CC amps / CR ohms)
                       via loadChipsForMode, not the static CURATED_CHIPS.LOAD. -->
                  {#each kind === "LOAD" ? loadChipsForMode() : chipsOf(kind) as v (v)}
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
              <!-- The device identity/quality axes (tier / diode-type / LED-colour /
                   logic-family / gate output / PULSE waveform / LOAD mode+step). Shared with
                   the arm-time configurator panel via this snippet; the dual-target sel*/set*
                   helpers route each click to the selected part here. -->
              {@render partConfig(kind)}
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
              {#if kind === "NTC" || kind === "PTC"}
                <!-- The thermistor's body temperature (its second scalar) as a slider;
                 the netlist turns it into R(T). Set directly for now (a future model
                 could self-heat it from dissipated power). -->
                <div class="insp-sub">
                  temperature · {Math.round(selTemp())} °C
                </div>
                <div class="insp-row">
                  <span class="wiper-end">{tempRange(kind).min}°</span>
                  <input
                    class="wiper-slider"
                    type="range"
                    min={tempRange(kind).min}
                    max={tempRange(kind).max}
                    step="1"
                    value={selTemp()}
                    aria-label="Thermistor body temperature"
                    oninput={(e) => setTemp(Number(e.currentTarget.value))}
                    onchange={endTempDrag}
                    onpointerup={endTempDrag}
                  />
                  <span class="wiper-end">{tempRange(kind).max}°</span>
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
              {infoKind
                ? partName(infoKind)
                : "Component Info"}{#if infoPreview}<span
                  class="info-preview-tag">preview</span
                >{/if}
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
              {#if infoKind}
                {@const info = partInfo(infoKind)}
                {#if info}
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
                  {@const po = pinoutOf(
                    infoKind,
                    selPart?.rot ?? 0,
                    selPart?.mirror,
                  )}
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
                  {#if selPart}
                    {@const e = selDisplay ?? ZERO_ELECTRICAL}
                    <div class="info-live">
                      <div class="info-live-head">
                        Right now{#if selRmsMode}<span class="rms-tag">rms</span
                          >{/if}
                      </div>
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
                    <!-- Arm-and-preview: an armed-but-unplaced part has no live electrical
                         state, so show the static teaching content (symbol/internals, pinout,
                         equation, plain) and a nudge to drop it for the live readout. -->
                    <p class="info-preview-note">
                      Previewing the armed part — drop it on the board to see
                      its live “right now” numbers.
                    </p>
                  {/if}
                {:else}
                  <p class="info-empty">
                    {partName(infoKind)} isn't simulated yet — no live math to show.
                  </p>
                {/if}
              {:else}
                <p class="info-empty">
                  Select a component on the board — or arm a part from the bin —
                  to see what it's doing: its governing equation, a plain
                  explanation of how it works, and (when placed) a live "right
                  now" readout.
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
    <!-- Fidelity mode: Ideal = perfect parts; Real = every part's tier non-idealities bite
         (resistor tolerance in the sim, cap/inductor/op-amp parasitics in the Bode). Flipping
         it recompiles the netlist (board.emitChange) and re-runs the sweep. -->
    <div class="readout">
      <span class="readout-k">Fidelity</span>
      <button
        class="btn btn-ghost fidelity-toggle {realModels ? 'is-real' : ''}"
        onclick={() => {
          realModels = !realModels;
          board?.emitChange();
          recomputeBode(bodeNodeCount);
          recomputePhaseScope(bodeNodeCount);
        }}
        title="Ideal = perfect components. Real = each part's quality tier bites: resistor tolerance, capacitor/inductor ESR/ESL/DCR + self-resonance, op-amp finite gain-bandwidth."
      >
        {realModels ? "● Real" : "○ Ideal"}
      </button>
    </div>

    {#if selPart && selDisplay?.ac?.valid}
      {@const ph = selDisplay.ac.phase}
      {@const deg = (ph * 180) / Math.PI}
      <!-- Phasor: the V (warm) / I (cyan) clock with phosphor afterglow for the selected
           AC part — the angle between the arrows is the measured V–I phase. Its own panel
           (bigger than a popover inset) beside the scope; the wedge tints amber = current
           lags (inductive), violet = leads (capacitive), grey = in-phase (resistive). -->
      <h3 class="sub-title">Phasor · {partName(selPart.kind)}</h3>
      <div class="phasor-panel">
        <canvas use:hudPhasorAction aria-hidden="true"></canvas>
        <div class="phasor-legend mono">
          <span><i style="background: #d8a24a"></i>V</span>
          <span><i style="background: #46d2e6"></i>I</span>
          <span class="phasor-phi">
            ϕ {deg >= 0 ? "+" : "−"}{Math.abs(deg).toFixed(0)}°
            {Math.abs(deg) < 4 ? "resistive" : ph > 0 ? "lag" : "lead"}
          </span>
        </div>
      </div>
    {/if}

    {#if bodeHasAc}
      <!-- Bode: the frequency-domain AC sweep (Sim::ac_sweep) — each node's response
           magnitude vs log frequency, so reactance corners / filter knees / LC resonance
           show at frequencies the 2 µs transient step can't reach. Node colours match the
           scope; toggling a node in the list below hides its trace. -->
      <h3 class="sub-title">Frequency response</h3>
      <div class="bode-panel">
        <canvas use:bodeAction aria-hidden="true"></canvas>
        <span class="bode-cap mono">
          dBV vs f · 1 Hz – 1 GHz (log){realModels ? " · Real parts" : ""}
        </span>
      </div>
      <!-- Phase scope: each node's steady-state waveform over one cycle vs PHASE (ac_solve at
           the source frequency), stable at any frequency — the way to see MHz signals the 2 µs
           transient step can't draw. Relative phase between nodes (a filter's input vs output
           lag) reads directly; the play-head sweeps the cycle. -->
      <div class="bode-panel">
        <canvas use:phaseScopeAction aria-hidden="true"></canvas>
        <span class="bode-cap mono">
          V vs phase @ {formatValue(phaseScopeFreq, "Hz")} (no Nyquist limit)
        </span>
      </div>
    {/if}

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

<!-- ── Component Codex ────────────────────────────────────────────────────────
     The full-screen "discovery museum": a master list of every component (grouped,
     searchable) and a detail pane that renders the exhaustive reference for the
     selected kind. A high-z dimmed-backdrop modal; Esc or the × closes it. All the
     per-component data comes from lib/codex.ts (a pure read of the existing model). -->
{#if codexOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="codex-backdrop"
    onclick={() => (codexOpen = false)}
    role="presentation"
  >
    <div
      class="codex-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Component Codex"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <header class="codex-head">
        <div class="codex-head-title">
          <span class="codex-mark">⊞</span>
          <span class="codex-h1">Component Codex</span>
          <span class="codex-h-sub mono"
            >{Object.keys(CODEX_META).length} components · the full reference</span
          >
        </div>
        <button
          class="intro-x"
          onclick={() => (codexOpen = false)}
          aria-label="Close the Codex">×</button
        >
      </header>

      <div class="codex-split">
        <!-- ── Master list: every component, grouped by category, searchable ── -->
        <nav class="codex-list" aria-label="Components">
          <input
            class="part-search codex-search"
            type="search"
            placeholder="Search components…"
            bind:value={codexSearch}
            aria-label="Search components"
          />
          <div class="codex-list-scroll scroll">
            {#each codexFiltered ?? codexGroups as group (group.category)}
              <details class="part-cat codex-cat" open>
                <summary class="part-cat-head">
                  <span class="part-cat-name">{group.category}</span>
                  <span class="part-cat-count">{group.kinds.length}</span>
                </summary>
                <ul class="part-list codex-cat-list">
                  {#each group.kinds as kind (kind)}
                    {@const pk = PART_KINDS[kind]}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <li
                      class="part codex-row {codexKind === kind
                        ? 'is-selected'
                        : ''}"
                      style="--c: var(--{pk?.colorKey ?? 'bronze'})"
                      onclick={() => selectCodexKind(kind)}
                      title={CODEX_META[kind]?.desc ?? pk?.name}
                    >
                      <span class="part-glyph">{kind}</span>
                      <span class="part-body">
                        <span class="part-name">{pk?.name ?? kind}</span>
                        <span class="part-desc"
                          >{CODEX_META[kind]?.desc ?? ""}</span
                        >
                      </span>
                      <span class="part-tier"
                        >{CODEX_META[kind]?.learnTier ?? ""}</span
                      >
                    </li>
                  {/each}
                </ul>
              </details>
            {/each}
            {#if codexFiltered && codexFiltered.length === 0}
              <p class="part-empty">No components match “{codexSearch}”.</p>
            {/if}
          </div>
        </nav>

        <!-- ── Detail pane: the exhaustive reference for the selected kind ── -->
        <section class="codex-detail scroll" aria-label="Component detail">
          {#if codexKind}
            {@const pk = PART_KINDS[codexKind]}
            {@const info = partInfo(codexKind)}
            {@const po = pinoutOf(codexKind, 0)}
            {@const meta = CODEX_META[codexKind]}
            {@const tiers = tierRows(codexKind)}
            {@const variants = variantRows(codexKind)}
            {@const families = familyRows(codexKind, pk?.defaultValue ?? 5)}
            {@const valSum = valueSummary(codexKind)}
            {@const syns = CODEX_SYNONYMS[codexKind] ?? []}
            {@const sheet = REFSHEET_OF[codexKind]}

            <!-- 1 · Header -->
            <div class="codex-d-head">
              <span
                class="codex-d-glyph"
                style="--c: var(--{pk?.colorKey ?? 'bronze'})">{codexKind}</span
              >
              <div class="codex-d-titles">
                <h2 class="codex-d-name">{pk?.name ?? codexKind}</h2>
                <div class="codex-badges">
                  <span class="codex-badge"
                    >{CODEX_CAT_OF[codexKind] ?? "—"}</span
                  >
                  {#if meta}<span class="codex-badge codex-badge-tier"
                      >Tier {meta.learnTier}</span
                    >{/if}
                  {#if pk?.ideal}<span class="codex-badge codex-badge-sim"
                      >solver primitive</span
                    >{/if}
                </div>
              </div>
            </div>
            {#if syns.length > 0}
              <p class="codex-aka">
                <span class="codex-aka-lbl">Also known as / used for</span>
                {syns.join(" · ")}
              </p>
            {/if}

            <!-- 2 · Diagram (Schematic / Analogy / Reality), like the info drawer -->
            {#if codexHasFactory || codexHasDetail}
              <div
                class="diagram-toggle"
                role="group"
                aria-label="Component view tier"
              >
                <button
                  class="seg {effectiveCodexMode === 'schematic'
                    ? 'is-active'
                    : ''}"
                  onclick={() => (codexDiagramMode = "schematic")}
                  title="Schematic — the symbol you'll meet on a datasheet"
                  >Schematic</button
                >
                {#if codexHasFactory}
                  <button
                    class="seg {effectiveCodexMode === 'analogy'
                      ? 'is-active'
                      : ''}"
                    onclick={() => (codexDiagramMode = "analogy")}
                    title="Analogy — the machine-metaphor view">Analogy</button
                  >
                {/if}
                {#if codexHasDetail}
                  <button
                    class="seg {effectiveCodexMode === 'reality'
                      ? 'is-active'
                      : ''}"
                    onclick={() => (codexDiagramMode = "reality")}
                    title="Reality — what's literally happening inside"
                    >Reality</button
                  >
                {/if}
              </div>
            {/if}
            <div
              class="info-diagram codex-diagram {effectiveCodexMode ===
              'reality'
                ? 'is-detail'
                : ''}"
            >
              <canvas use:codexDiagramAction></canvas>
            </div>

            <!-- 3 · Pinout -->
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
                      {#if p.gloss}<span class="pinout-gloss">{p.gloss}</span
                        >{/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- 4 · Governing law -->
            {#if info}
              <div class="codex-section">
                <h3 class="codex-cap">Governing law</h3>
                <div class="info-eq mono">{info.equation}</div>
                <p class="info-plain">{info.plain()}</p>
              </div>
            {:else}
              <div class="codex-section">
                <h3 class="codex-cap">Governing law</h3>
                <p class="info-plain codex-nomodel">
                  No simulation model yet — {pk?.name ?? codexKind} is a preview of
                  a later tech-tree tier, so it has no governing equation or live
                  telemetry to show.
                </p>
              </div>
            {/if}

            <!-- 5 · Identity facts -->
            <div class="codex-section">
              <h3 class="codex-cap">Identity</h3>
              <div class="codex-facts">
                {#if pk?.unit}
                  <div class="info-row">
                    <span>Default value</span>
                    <span class="mono"
                      >{formatValue(pk.defaultValue, pk.unit)}</span
                    >
                  </div>
                {/if}
                <div class="info-row">
                  <span>Category</span>
                  <span class="mono">{CODEX_CAT_OF[codexKind] ?? "—"}</span>
                </div>
                <div class="info-row">
                  <span>Terminals</span>
                  <span class="mono">{pk?.pins.length ?? 0}-pin</span>
                </div>
                <div class="info-row">
                  <span>Solver primitive</span>
                  <span class="mono">{pk?.ideal ? "yes" : "no (preview)"}</span>
                </div>
                {#if po}
                  {#each po.pins.filter((p) => p.gloss) as p (p.label)}
                    <div class="info-row">
                      <span>Pin {p.label}</span>
                      <span class="mono">{p.gloss}</span>
                    </div>
                  {/each}
                {/if}
                {#if pk?.pins.length === 5 && isDigital(codexKind) && codexKind !== "FF"}
                  <div class="info-row">
                    <span>Package</span>
                    <span class="mono">5-pin powered IC (VCC + GND)</span>
                  </div>
                {/if}
              </div>
            </div>

            <!-- 6 · Quality tiers -->
            {#if tiers.length > 0}
              <div class="codex-section">
                <h3 class="codex-cap">Quality tiers</h3>
                <p class="codex-note">
                  Each grade is a preset bundle of model parameters; the
                  non-idealities bite only in Real (realistic) mode.
                </p>
                <div class="codex-table">
                  {#each tiers as row (row.tier)}
                    <div class="info-row">
                      <span>{row.tier}</span>
                      <span class="mono">{row.change}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- 7 · Variants / ratings -->
            {#if variants.length > 0}
              <div class="codex-section">
                <h3 class="codex-cap">
                  {codexKind === "LED" ? "Colours" : "Variants & ratings"}
                </h3>
                <div class="codex-table">
                  {#each variants as row (row.label)}
                    <div class="info-row codex-row-wide">
                      <span class="codex-vlabel">{row.label}</span>
                      <span class="mono">{row.detail}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- 8 · Logic levels (digital parts) -->
            {#if families.length > 0}
              <div class="codex-section">
                <h3 class="codex-cap">
                  Logic levels @ {formatValue(pk?.defaultValue ?? 5, "V")} rail
                </h3>
                <div class="codex-table">
                  {#each families as row (row.family)}
                    <div class="info-row codex-row-wide">
                      <span class="codex-vlabel">{row.family}</span>
                      <span class="mono">{row.detail}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- 9 · Value range -->
            {#if valSum}
              <div class="codex-section">
                <h3 class="codex-cap">Standard values</h3>
                <div class="info-row codex-row-wide">
                  <span class="codex-vlabel">Range</span>
                  <span class="mono">{valSum}</span>
                </div>
              </div>
            {/if}

            <!-- 10 · Refsheet link -->
            {#if sheet}
              <a
                class="codex-refsheet"
                href={import.meta.env.BASE_URL + "parts/" + sheet}
                target="_blank"
                rel="noopener"
              >
                <span class="codex-refsheet-mark mono">[ ]</span>
                <span class="codex-refsheet-txt">
                  <span class="codex-refsheet-h">Open the full teardown</span>
                  <span class="codex-refsheet-sub"
                    >the five-tier interactive refsheet · opens in a new tab</span
                  >
                </span>
                <span class="codex-refsheet-go mono">&gt;&gt;</span>
              </a>
            {/if}
          {:else}
            <p class="info-empty">Select a component from the list to begin.</p>
          {/if}
        </section>
      </div>
    </div>
  </div>
{/if}

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
  /* Live region tool — a floating action bar OVER the board (mirrors .die-bar), kept out of the top
     toolbar so it never crowds / overlaps the tool buttons (owner). Name + seal + cancel the region. */
  .region-bar {
    position: absolute;
    z-index: 4;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 24px);
    padding: 6px 10px;
    background: oklch(0.135 0.022 285 / 0.84);
    backdrop-filter: blur(4px);
    border: 1px solid var(--accent-line);
    border-radius: var(--radius);
    box-shadow:
      0 0 0 1px oklch(0 0 0 / 0.3),
      0 8px 22px -14px oklch(0 0 0 / 0.9),
      inset 0 0 18px -10px var(--accent);
  }
  .region-bar-title {
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
    opacity: 0.9;
  }
  .region-name {
    width: 170px;
    flex: 0 0 auto;
  }
  .region-bar-x {
    min-width: 30px;
    padding: 6px 9px;
  }
  .region-hint {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.02em;
    color: var(--dim);
    opacity: 0.8;
    white-space: nowrap;
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
  /* The armed-part chip: a compact toolbar status of what a board click will drop, with an
     × to disarm. The configurator itself lives in the parts bin (.bin-config), not here. */
  .armed-wrap {
    position: relative;
    display: inline-flex;
  }
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
  /* Arm-time configurator, docked at the top of the parts bin (right where you picked the
     part): the same identity/quality chips (the partConfig snippet) so the part is configured
     BEFORE it's dropped. Accent-framed so it reads as the live selection; scrolls if a kind
     has many rows. */
  .bin-config {
    margin-bottom: 10px;
    max-height: 42vh;
    overflow-y: auto;
    padding: 8px 10px 10px;
    border: 1px solid var(--accent-line);
    border-radius: 5px;
    background: var(--accent-soft);
  }
  .bin-config-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 2px;
  }
  .bin-config-name {
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 12px;
    color: var(--accent);
  }
  .bin-config-actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  /* The ⓘ preview toggle: opens the info drawer on the armed-but-unplaced part. */
  .bin-config-info {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--surface);
    color: var(--dim);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }
  .bin-config-info:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .bin-config-info.is-active {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  /* The first sub-label sits right under the head, so it needs no extra top gap. */
  .bin-config > :global(.insp-sub:first-of-type) {
    margin-top: 4px;
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

  /* Inline net-label editor: a small name input + a colour-pin swatch row, floated
     over the board at the labelled endpoint (Label tool). On-brand mono. */
  .net-label-editor {
    position: absolute;
    z-index: 6;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .net-label-input {
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
  /* Swatch row: preset colours to pin to the net, plus an "Auto" (clear) chip.
     The active swatch is ringed; colours come from the PALETTE (the wire hues). */
  .net-label-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    padding: 4px 5px;
    background: oklch(0.165 0.028 285 / 0.97);
    border: 1px solid var(--accent-line);
    border-radius: 3px;
    box-shadow: 0 8px 22px -10px #000;
  }
  .net-swatch {
    width: 15px;
    height: 15px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--sw, transparent);
    cursor: pointer;
    line-height: 1;
  }
  .net-swatch:hover {
    border-color: var(--text);
  }
  .net-swatch.is-active {
    border-color: var(--text);
    box-shadow: 0 0 0 1px var(--text);
  }
  /* The "Auto" chip carries a glyph, not a colour fill. */
  .net-swatch-auto {
    display: grid;
    place-items: center;
    color: var(--dim);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .net-swatch-auto.is-active {
    color: var(--text);
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
  /* "rms" badge shown when the inspector switches to the averaged (RMS) read because
     the live value is reversing too fast to read — the DMM-mode tell. */
  .rms-tag {
    display: inline-block;
    margin-right: 6px;
    padding: 0 5px;
    border: 1px solid color-mix(in oklch, var(--accent) 60%, transparent);
    border-radius: 3px;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
    vertical-align: 1px;
  }
  /* The V–I phasor panel in Telemetry (its own section, for the selected AC part). */
  .phasor-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    margin: 2px 0 12px;
  }
  .phasor-panel canvas {
    width: 100%;
    max-width: 180px;
    aspect-ratio: 1;
  }
  .phasor-legend {
    display: flex;
    gap: 13px;
    align-items: center;
    font-size: 10px;
    letter-spacing: 0.04em;
    color: var(--dim);
  }
  .phasor-legend i {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 4px;
    border-radius: 2px;
    vertical-align: 0;
  }
  .phasor-phi {
    color: var(--text);
    text-transform: uppercase;
  }
  /* The frequency-response (Bode) plot in Telemetry. */
  .bode-panel {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 5px;
    margin: 2px 0 12px;
  }
  .bode-panel canvas {
    width: 100%;
    height: 132px;
    border: 1px solid var(--border);
    border-radius: 3px;
  }
  .bode-cap {
    font-size: 9px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--dim);
    text-align: center;
  }
  /* The global Ideal/Real fidelity toggle in Telemetry. */
  .fidelity-toggle {
    padding: 0 7px;
    font-size: 11px;
    letter-spacing: 0.04em;
  }
  .fidelity-toggle.is-real {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 55%, transparent);
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
  /* Hex entry for a behavioral block's truth table / data word. */
  .insp-hex {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.08em;
    padding: 5px 9px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--surface);
    color: var(--text);
    text-transform: uppercase;
  }
  .insp-hex:focus {
    outline: none;
    border-color: var(--accent);
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
  /* IC-maker "Seal as IC" action button: full-width within the inspector popover. */
  .insp-seal {
    flex: 1;
    width: 100%;
  }

  /* IC-maker DIE EDITOR back bar: a glass strip across the top of the board canvas while drilled
     into a frame, holding the breadcrumb, the live seal advisory, the name field, and the three
     exits. Positioned like the hotbar/overlay (over the canvas, below the value popover). */
  .die-bar {
    position: absolute;
    z-index: 4;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: calc(100% - 24px);
    padding: 6px 8px 6px 14px;
    background: oklch(0.135 0.022 285 / 0.84);
    backdrop-filter: blur(4px);
    border: 1px solid var(--accent-line);
    border-radius: var(--radius);
    box-shadow:
      0 0 0 1px oklch(0 0 0 / 0.3),
      0 8px 22px -14px oklch(0 0 0 / 0.9),
      inset 0 0 18px -10px var(--accent);
  }
  .die-crumb {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--font-display);
    font-size: 13px;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .die-crumb-board {
    color: var(--dim);
  }
  .die-crumb-sep {
    color: var(--faint);
    font-size: 11px;
  }
  .die-crumb-here {
    color: var(--text);
    font-weight: 600;
  }
  .die-crumb-pkg {
    margin-left: 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--accent);
    text-transform: none;
  }
  .die-pins {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 10px;
  }
  .die-pins-label {
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--dim);
  }
  .die-pins-btn {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1;
    color: var(--accent);
    background: transparent;
    border: 1px solid color-mix(in oklch, var(--accent) 45%, transparent);
    border-radius: 2px;
    cursor: pointer;
  }
  .die-pins-btn:hover:not(:disabled) {
    background: color-mix(in oklch, var(--accent) 16%, transparent);
  }
  .die-pins-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .die-pins-n {
    min-width: 14px;
    text-align: center;
    font-size: 11px;
    color: var(--text);
  }
  .die-status {
    font-size: 10px;
    letter-spacing: 0.06em;
    white-space: nowrap;
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .die-status.is-ok {
    color: var(--ok);
    border-color: color-mix(in oklch, var(--ok) 42%, transparent);
  }
  .die-status.is-bad {
    color: var(--warn);
    border-color: color-mix(in oklch, var(--warn) 42%, transparent);
  }
  .die-seal-name {
    width: 150px;
    flex: 0 0 auto;
  }
  .die-seal-sub {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--dim);
    cursor: pointer;
    white-space: nowrap;
  }
  .die-seal-sub input:disabled + span {
    opacity: 0.45;
  }
  /* Quiet how-to for the port-pad naming affordance (double-click a wall pin). */
  .die-hint {
    font-size: 10px;
    letter-spacing: 0.04em;
    color: var(--dim);
    white-space: nowrap;
  }
  .die-actions {
    display: flex;
    gap: 6px;
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
  /* "preview" badge beside the title when the drawer is showing an armed (unplaced) part. */
  .info-preview-tag {
    margin-left: 7px;
    padding: 1px 6px;
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    border: 1px solid var(--accent-line);
    border-radius: 2px;
    background: var(--accent-soft);
    vertical-align: middle;
  }
  /* The "drop it to see live numbers" nudge that stands in for the live block in a preview. */
  .info-preview-note {
    margin: 12px 0 0;
    padding: 9px 11px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--dim);
    border: 1px dashed var(--border);
    border-radius: 4px;
    background: var(--surface);
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
  .new-create-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 10px 9px;
  }
  .new-create-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .new-create-label {
    font-family: "Saira Condensed", sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.72rem;
    color: var(--text-dim);
    width: 52px;
    flex: 0 0 auto;
  }
  .new-create-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .new-create-btn {
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.72rem;
    padding: 2px 8px;
    border: 1px solid var(--accent);
    color: var(--accent);
    background: transparent;
  }
  .new-create-btn:hover:not(:disabled) {
    background: color-mix(in oklch, var(--accent) 18%, transparent);
  }
  .new-create-btn:disabled {
    opacity: 0.4;
    border-color: var(--border);
    color: var(--text-dim);
  }
  .part-empty-hint {
    padding: 6px 12px 9px;
    margin: 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--dim);
  }
  .part-empty-hint strong {
    color: var(--text-dim);
    font-weight: 600;
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
  /* Family row: a part-row-shaped, collapsed-by-default <details> that expands inline to
     reveal its member rows. Mirrors the .part-cat/.example-cat folder pattern, tinted by the
     family's --c so it reads like (and lines up with) the plain rows beside it. */
  .part-family-li {
    list-style: none;
  }
  .part-family {
    --c: var(--bronze);
    border: 1px solid var(--border);
    border-left: 2px solid color-mix(in oklch, var(--c) 70%, var(--border));
    border-radius: var(--radius);
    background: linear-gradient(180deg, var(--surface-2), var(--surface));
    transition:
      border-color 0.16s var(--ease),
      box-shadow 0.16s var(--ease);
  }
  .part-family[open] {
    border-color: var(--border-bright);
  }
  .part-family-head {
    display: grid;
    grid-template-columns: 38px 1fr auto;
    align-items: center;
    gap: 11px;
    padding: 9px 10px;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }
  .part-family-head::-webkit-details-marker {
    display: none;
  }
  .part-family:hover > .part-family-head {
    border-left-color: var(--c);
  }
  .part-family-glyph {
    position: relative;
    display: grid;
    place-items: center;
    height: 30px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    color: var(--c);
    border: 1px solid color-mix(in oklch, var(--c) 40%, var(--border));
    border-radius: var(--radius-sm);
    background: color-mix(in oklch, var(--c) 9%, transparent);
    text-shadow: 0 0 10px color-mix(in oklch, var(--c) 50%, transparent);
  }
  /* Disclosure caret sits to the left of the count inside the glyph cell. */
  .part-family-head::before {
    content: "▸";
    grid-column: 1;
    grid-row: 1;
    justify-self: start;
    margin-left: 2px;
    font-size: 10px;
    color: var(--faint);
    transition: transform 0.15s var(--ease);
    z-index: 1;
  }
  .part-family[open] > .part-family-head::before {
    transform: rotate(90deg);
  }
  .part-family-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
  }
  .part-family[open] > .part-family-head .part-family-name {
    color: var(--accent);
  }
  .part-family-count {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--dim);
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 2px;
  }
  .part-family-list {
    padding: 0 8px 9px 14px;
    gap: 7px;
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
  /* Characterization truth-table panel — a floating telemetry card (the engine's "1"): the swept gate's
     truth table, the recognized function, and the prog-4 LUT word it collapsed to. */
  .char-panel {
    position: absolute;
    top: 44px;
    left: 50%;
    transform: translateX(-50%);
    min-width: 200px;
    padding: 10px 12px 11px;
    background: oklch(0.165 0.028 285 / 0.96);
    border: 1px solid var(--cyan);
    border-radius: 4px;
    box-shadow: 0 0 22px -9px var(--cyan);
    backdrop-filter: blur(3px);
    z-index: 5;
  }
  .char-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .char-title {
    font-family: var(--font-display, "Saira Condensed", sans-serif);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 13px;
    color: var(--text);
  }
  .char-gate {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--cyan);
    padding: 1px 6px;
    border: 1px solid color-mix(in oklch, var(--cyan) 45%, transparent);
    border-radius: 2px;
    background: color-mix(in oklch, var(--cyan) 12%, transparent);
  }
  .char-word {
    font-size: 11px;
    color: var(--dim);
  }
  .char-close {
    margin-left: auto;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 1;
    color: var(--dim);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 2px;
    cursor: pointer;
  }
  .char-close:hover {
    color: var(--text);
    border-color: var(--border-bright);
    background: var(--surface-2);
  }
  .char-tt {
    border-collapse: collapse;
    font-size: 12.5px;
    margin: 0 auto;
  }
  .char-tt th,
  .char-tt td {
    padding: 2px 9px;
    text-align: center;
    color: var(--dim);
    border: 1px solid var(--border);
  }
  .char-tt th {
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-2, var(--dim));
  }
  .char-tt td.hi {
    color: var(--cyan);
    font-weight: 600;
  }
  .char-tt .char-out {
    border-left: 2px solid var(--cyan);
  }
  .char-tt td.char-out {
    color: var(--dim);
  }
  .char-tt td.char-out.hi {
    color: var(--accent);
  }
  .char-foot {
    margin-top: 8px;
    font-size: 11px;
    line-height: 1.35;
    color: var(--dim);
    text-align: center;
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

  /* ── Component Codex ─────────────────────────────────────────────────────────
     The full-screen "discovery museum": a dimmed-backdrop modal floating a
     master-detail reference above everything. Reuses the info-drawer atoms
     (.pinout-*, .info-eq, .info-plain, .info-row, .diagram-toggle/.seg,
     .info-diagram) and the bin atoms (.part, .part-cat) so it reads as one
     bench-instrument surface; the codex-* classes add the museum shell. */
  .codex-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: clamp(12px, 3vh, 40px);
    background: oklch(0.08 0.02 285 / 0.72);
    backdrop-filter: blur(3px);
  }
  .codex-modal {
    display: flex;
    flex-direction: column;
    width: min(1180px, 96vw);
    height: min(880px, 92vh);
    background: var(--bg);
    border: 1px solid var(--border-bright);
    border-radius: 6px;
    box-shadow:
      0 0 0 1px oklch(0 0 0 / 0.4),
      0 30px 80px -24px #000;
    overflow: hidden;
  }
  .codex-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 13px 16px;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(180deg, var(--bg-2), var(--bg));
  }
  .codex-head-title {
    display: flex;
    align-items: baseline;
    gap: 11px;
  }
  .codex-mark {
    color: var(--accent);
    font-size: 17px;
    text-shadow: 0 0 12px var(--accent-soft);
  }
  .codex-h1 {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 19px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text);
  }
  .codex-h-sub {
    font-size: 10.5px;
    letter-spacing: 0.06em;
    color: var(--faint);
  }
  .codex-split {
    flex: 1;
    display: grid;
    grid-template-columns: 290px 1fr;
    min-height: 0;
  }
  /* Master list ------------------------------------------------------------- */
  .codex-list {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--border);
    background: var(--bg-2);
  }
  .codex-search {
    margin: 12px 12px 8px;
  }
  .codex-list-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .codex-cat-list {
    padding: 8px 0 2px;
  }
  /* The active row in the master list — an accent rail + glow, like a focused part. */
  .codex-row.is-selected {
    border-color: var(--accent);
    border-left-color: var(--accent);
    box-shadow:
      0 0 0 1px var(--accent-soft),
      -7px 0 16px -12px var(--accent);
  }
  .codex-row.is-selected .part-glyph {
    border-color: var(--c);
    box-shadow: 0 0 12px -4px var(--c);
  }
  /* Detail pane ------------------------------------------------------------- */
  .codex-detail {
    overflow-y: auto;
    padding: 18px 22px 28px;
    min-height: 0;
  }
  .codex-d-head {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 6px;
  }
  .codex-d-glyph {
    --c: var(--bronze);
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    flex: none;
    font-family: var(--font-mono);
    font-size: 17px;
    font-weight: 600;
    color: var(--c);
    border: 1px solid color-mix(in oklch, var(--c) 45%, var(--border));
    border-radius: var(--radius);
    background: color-mix(in oklch, var(--c) 10%, transparent);
    text-shadow: 0 0 12px color-mix(in oklch, var(--c) 55%, transparent);
  }
  .codex-d-titles {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .codex-d-name {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 24px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--text);
    line-height: 1;
  }
  .codex-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .codex-badge {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--dim);
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--surface);
  }
  .codex-badge-tier {
    color: var(--cyan);
    border-color: color-mix(in oklch, var(--cyan) 40%, var(--border));
  }
  .codex-badge-sim {
    color: var(--ok);
    border-color: color-mix(in oklch, var(--ok) 40%, var(--border));
  }
  .codex-aka {
    margin: 0 0 16px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--dim);
  }
  .codex-aka-lbl {
    display: block;
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--faint);
    margin-bottom: 2px;
  }
  /* The codex hero diagram is the centrepiece — a touch taller than the drawer's. */
  .codex-diagram {
    height: 220px;
  }
  .codex-diagram.is-detail {
    height: 280px;
  }
  /* A titled section block in the detail pane. */
  .codex-section {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .codex-cap {
    margin: 0 0 9px;
    font-family: var(--font-display);
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .codex-note {
    margin: -3px 0 9px;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--faint);
  }
  .codex-nomodel {
    padding: 9px 11px;
    border: 1px dashed var(--border);
    border-radius: 4px;
    background: var(--surface);
  }
  /* The fact / tier / variant tables share the .info-row atom; the first row needs
     no top divider since the section header already rules off above it. */
  .codex-facts .info-row:first-child,
  .codex-table .info-row:first-child {
    border-top: none;
  }
  /* A wide data row whose value wraps to its own line below the label (the long
     variant / logic-level / value-range strings don't squeeze onto one line). */
  .codex-row-wide {
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
  }
  .codex-vlabel {
    color: var(--dim);
    font-weight: 500;
  }
  .codex-row-wide .mono {
    color: var(--text);
    font-size: 11.5px;
    line-height: 1.5;
  }
  /* The prominent "open the full teardown" link → the five-tier refsheet, new tab. */
  .codex-refsheet {
    display: flex;
    align-items: center;
    gap: 13px;
    margin-top: 20px;
    padding: 13px 15px;
    text-decoration: none;
    border: 1px solid var(--accent-line);
    border-radius: 5px;
    background: linear-gradient(
      135deg,
      var(--accent-soft),
      color-mix(in oklch, var(--accent) 4%, transparent)
    );
    transition:
      border-color 0.14s var(--ease),
      box-shadow 0.14s var(--ease),
      transform 0.06s var(--ease);
  }
  .codex-refsheet:hover {
    border-color: var(--accent);
    box-shadow:
      0 0 0 1px var(--accent-soft),
      0 8px 24px -16px var(--accent);
  }
  .codex-refsheet:active {
    transform: translateY(1px);
  }
  .codex-refsheet-mark {
    color: var(--accent);
    font-size: 15px;
    text-shadow: 0 0 10px var(--accent-soft);
  }
  .codex-refsheet-txt {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }
  .codex-refsheet-h {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text);
  }
  .codex-refsheet-sub {
    font-size: 11px;
    color: var(--dim);
  }
  .codex-refsheet-go {
    color: var(--accent);
    font-size: 15px;
    letter-spacing: 0.05em;
  }
  @media (max-width: 720px) {
    .codex-split {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(120px, 38%) 1fr;
    }
    .codex-list {
      border-right: none;
      border-bottom: 1px solid var(--border);
    }
  }
</style>

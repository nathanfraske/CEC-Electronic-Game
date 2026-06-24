<!-- SPDX-License-Identifier: Apache-2.0 -->

# Divergence Idea Bank — the unfiltered well (ideation)

Status: ideation (no code, no judgement). This is the collated output of **seven divergence panels** —
sim/physics, gameplay modes, teaching/tools, content/worlds/narrative, social/UGC/economy,
platform/tech/AI, and wildcards — each told to generate as many ideas as possible with **no filter for
feasibility, scope, or fit**. A separate grounding panel comes next; this document's only job is to be a
broad, well-organized, deduped *menu* of possibility.

**What was done here:** the seven lists were merged into one taxonomy, obvious cross-list duplicates were
collapsed (with the surviving entry noting both homes), and contradictions were *kept* on purpose. Nothing
was cut for being weird, expensive, or off-brand. Roughly 250 distinct ideas survive.

**How to read it.** Each idea is **name** — one or two lines — *[system tag]*. The tag names the existing
corpus system the idea extends (shorthand below), or **NEW** when there's no clear precedent. The three
engine peculiarities every panel kept exploiting: **determinism** (a circuit is a seed — reproducible,
shareable, fingerprintable, time-travelable), **the lens family** (the board already has alternate sensory
skins, so a new sense is "just another lens"), and **the seal-as-netlist** (any circuit can become a
reusable noun the importer re-verifies — so the game can recurse into anything).

*Tag shorthand:* **[lenses]** schematic/reality/analogy/factory · **[scope/Bode/phasor]** instruments ·
**[heat]** thermal ideation · **[EMI]** invisible-electronics · **[reality-dial]** Ideal→Real fidelity ramp ·
**[tiers/variants]** quality grades + device families · **[contracts]** parametric purchase-orders ·
**[IC-maker]** seal-as-reusable-chip · **[Exchange]** Bench Exchange / dependency economy / fork-lineage ·
**[product-run]** reliability / FIT / recall / Clock 3 · **[determinism/replay]** the replay artifact ·
**[lab-notebook]** notebook / eureka / codex · **[FAIL/autopsy]** fail mask + autopsy culture ·
**[mechanical-node]** the proposed new physical state domain · **[Lux]** the mastery-currency firewall.

---

## I. New physics & simulation domains

### A. The mechanical node — motors, motion, sound (the board that moves)

- **Torque Bench** — A DC/BLDC motor modelled as `back-EMF = Kv·ω` + winding R/L + a mechanical state `ω` integrated from `torque = Kt·I − load`. A spinning-rotor lens whose RPM is the mechanical "voltage." Teaches stall current, inrush, PWM speed control. *[mechanical-node / heat lumped-node pattern]*
- **Stepper Phase-Dance** — N coils the player energizes in sequence; the rotor snaps to detents. Microstepping, missed steps under load, holding torque — a discrete cousin of metastability. *[mechanical-node + DFF/sequential]*
- **Speaker / Voice Coil** — The canonical electromechanical 2-port: electrical RLC ↔ mass-spring-damper ↔ acoustic load. Drive it, see the cone move, hear it. Impedance reflection, resonance (Fs), Thiele-Small. *[mechanical-node + audio sink]*
- **Solenoid Pull / Plunger Travel** — Plunger position is a mechanical state; `L(x)` changes with travel so the current waveform shows the plunger seating. Latching, pull-in vs hold current. *[mechanical-node + nonlinear companion]*
- **Relay With Real Coil Dynamics** — Not a click-toggle: an RL energize curve, an armature with mass+spring that throws after a delay, contact bounce on close, flyback on release (the diode you forgot kills the transistor). One part teaches kickback, debounce, and arcing. *[mechanical-node + flyback magnetics]*
- **Piezo Two-Way** — A piezo converts force↔voltage bidirectionally: tap it for a voltage spike, drive it and it deflects. Bridges sensors and actuators in one coupling. *[external-input channel + microphonics]*
- **IMU / Accelerometer as MEMS Spring-Mass** — A tiny spring-mass whose displacement modulates a differential capacitance → readout; a "tilt the board" world input. Capacitive sensing, sense/drive, the whole MEMS idea. *[mechanical-node + sensor bench]*

### B. Magnetics — the rotating/moving-iron domain

- **Saturating-Core Inductor** — Above a knee current `L` collapses and current spikes (nonlinear Newton companion, like the diode). The core glyph clips as flux saturates; the reason flyback converters explode. *[inductor → Newton companion + SMPS]*
- **Hysteresis & Core Loss (the B-H loop)** — Magnetic parts get a real B-H loop whose area = energy lost per cycle → feeds the thermal model. A dedicated **B-H loop scope** is a gorgeous new instrument. Why transformers hum and warm; ferrite vs iron-powder. *[heat + scope family]*
- **The Reluctance Lens** — Render the magnetic circuit *as a circuit*: MMF as "voltage," flux as "current," reluctance as "resistance" — a magnetic-domain twin of the analogy lens. *[lenses + transformer]*
- **Eddy-Current Heatmap** — A conductive slab near AC flux develops eddy currents → localized I²R heat. Laminations, induction cooktops, why solid cores are bad. *[heat + magnetics]*

### C. Sensors & transducers (the world talks to the circuit)

- **Sensor Bench — the universal transducer slot** — Generalize "external-input scalar per element" into a *family*: light (LDR/photodiode), temperature, force (strain-gauge), Hall (field), mic (sound), gas/humidity. A "world panel" of live sliders (ambient light, temp, field, sound) drives them. One mechanism, a whole sensor catalog. *[external-input channel + thermistor precedent]*
- **Wheatstone Bridge & the Strain Story** — A force input deviates one leg by a few µΩ; the player amplifies a *tiny differential* against common-mode — the classic "why you need an instro amp." *[differential/CMRR + sensor bench]*
- **Hall-Effect & Current-Sense-by-Field** — A Hall sensor reads the field around a conductor — non-contact, isolated current measurement; the clamp meter. *[magnetics + EMI geometry layer]*
- **The Sensor Garden** — A whole biome of transducers: strain gauge, thermocouple, photomultiplier, microphone, accelerometer, magnetometer — the bridge from "circuits" to "the physical world talks to circuits." *[external-input channel + content]*

### D. Optoelectronics & photonics

- **The Photon Budget (optocoupler & isolation)** — An LED→photodiode pair with a *light path* you can't probe electrically — the isolation barrier rendered as photons crossing a gap. Galvanic isolation, CTR, why your scope ground floats. *[EMI gap-filament cue + LED/photodiode]*
- **Solar Cell / PV Curve & MPPT** — A photodiode in photovoltaic mode gives an I-V curve with a max-power knee; build an MPPT tracker that hunts it under changing illumination (the "ambient light" slider). Partial shading. *[sensor bench + SMPS]*
- **Laser/LED Optical Link & Bandwidth** — Drive an LED with data, receive on a photodiode; model finite rise time and transimpedance bandwidth — the eye diagram closes as you push data rate. *[eye-diagram + optocoupler]*
- **Display Domain — the persistence-of-vision lens** — Multiplexed LED-matrix/7-seg displays; a **retina lens** integrates the flicker into a perceived image, showing why multiplexing works and what too-slow refresh does (flicker, ghosting). *[PWM/duty + new perceptual lens]*

### E. Power electronics, deeper

- **Closed-Loop SMPS Controller** — Add the compensator + comparator the open-loop buck lacks, plus a **loop-stability instrument** (mark phase/gain margin on the existing Bode). Why supplies oscillate; type-II/III compensation. *[SMPS + Bode + control-systems]*
- **Inrush & Soft-Start** — The cold-start surge into bulk caps (and the saturating inductor). A "survive the inrush" contract; the NTC inrush limiter finally has a job. *[heat self-heating + saturating core]*
- **Battery Electrochemistry (a real cell, not a tier)** — A state-of-charge integrator with an OCV-vs-SOC curve, rising internal R as it drains, sag under load, recovery at rest. A charge gauge; the rail visibly sags. Runtime, cold batteries, C-rate. *[heat (temp-coupled) + tier internal-R promoted to a real state]*
- **Charging Chemistry & Profiles** — CC/CV charging, the taper, the Li-ion CV phase and thermal cutoff; an overcharge → thermal-vent contract. *[battery state + heat/runaway]*
- **Energy-Harvesting Trickle** — Tiny intermittent sources (solar, piezo, RF rectenna) into a supercap → "sip and burst." Duty-cycled low-power design, cold-start from microwatts. *[battery/supercap + piezo/PV]*

### F. Vacuum, plasma & exotic devices

- **The Tube Lens (thermionic valve)** — A triode/pentode with Child-Langmuir plate curves, a heater that must warm up first (a thermal pre-roll), soft clipping, a glowing-filament reality lens. Why audiophiles love tubes; biasing. *[Newton companion + heat warm-up + audio harmonics]*
- **Cat's-Whisker Dawn** — A galena crystal + a wire you nudge to find the rectifying spot; a 1920s crystal radio with no power source. "Find the sweet spot" is a diode-curve minigame. *[diode family + content origin-story]*
- **Gas-Discharge / Neon / Nixie** — A device that doesn't conduct until it *strikes* at breakdown, then drops to a sustaining voltage — a negative-resistance region powering a relaxation oscillator (the original blinky). *[varistor/zener family + negative-resistance modeling]*
- **Spark / Arc & Breakdown** — Air/dielectric breaks down above a kV/mm field → a sudden conductive arc (reuse the ESD cue). Creepage/clearance, why HV PCBs have slots, ignition. *[ESD + geometry layer]*
- **Superconductor Lens** — Exactly-zero resistance below a critical temp/current; drive past Ic and it *quenches* — snaps to normal and dumps heat. Persistent currents, quench, MRI magnets. *[heat node + binary R]*
- **Memristor / Phase-Change (the 4th element)** — A resistance that remembers total charge (`R(q)`) — a pinched-hysteresis I-V loop, its own scope signature. The missing fundamental element, ReRAM/neuromorphic. *[nonlinear companion with hashed state]*
- **The Exotica Shelf** — A bin of strange-but-real parts: tunnel diode, unijunction transistor, neon lamp, memristor, Gunn diode, the thyristor/SCR/triac/diac family, Hall sensor, piezo. Each a "huh, neat" lesson. *[parts-catalog + content]*

### G. Control systems & feedback (the meta-domain)

- **The Control Loop Lens** — Any feedback circuit (op-amp, PLL, SMPS, thermostat) gets a block-diagram overlay — plant, sensor, controller, summing junction — with loop gain animated; a step-response + root-locus instrument. A lens that sits *above* the netlist. *[op-amp + Bode → new abstraction lens]*
- **PLL & Clock Recovery** — Phase detector + loop filter + VCO locking onto a reference; visualize phase error converging, lock/unlock, jitter transfer. The heart of every radio and CPU clock. *[control-loop lens + jitter/eye instruments]*
- **Thermostat / Bang-Bang & Hysteresis Control** — The simplest closed loop: heater + thermistor + comparator-with-hysteresis. Temperature oscillates around setpoint; tighten the hysteresis and it chatters. *[heat + Schmitt/comparator]*

### H. Audio, DSP & human-perception lenses

- **The Ear Lens (audible output)** — Route any node's waveform (≤20 kHz, inside the time domain) to actual audio. A 555 *clicks*, an oscillator *tones*, a filter sweep is *heard*. The most visceral "make the invisible sensible" beat, and nearly free. *[scope → audio sink + speaker]* *(merged across lists: "The Board Is A Synth," "Sonification of Signals," "Accessibility Sonification.")*
- **Distortion & Harmonics Scope (FFT teaching)** — Repurpose the spectrum instrument for *audio*: watch a clipped sine sprout odd harmonics, hear THD, watch a filter carve them. Fourier intuition; why clipping sounds harsh. *[spectrum analyzer + audio sink]*
- **Switched-Capacitor & the Sampled-Domain Lens** — Switched-cap filters and the z-domain: charge buckets ferrying packets (the analogy pipe is *perfect* — literal buckets). Discrete-time DSP, the bilinear transform, anti-aliasing. *[clocked-sampler + analogy lens]*
- **Sigma-Delta Visualizer** — The 1-bit modulator as a pulse density whose *average* is the analog value, rendered as a dot-density bar the eye integrates. Oversampling, noise-shaping, how a $1 chip gets 24 bits. *[clocked-sampler + ADC + duty/density visual]*
- **Frequency-Domain Ear Training** — Play a complex waveform and have the player guess/build its spectrum (which harmonics), verified by the analytic FFT. Teaches "any wave is a sum of sines" through hearing. *[Bode + sonification]*

### I. Digital protocols & systems (deeper than buses)

- **Protocol Decoder Lens / Logic-Analyzer Bus View** — Overlay decoded frames on a digital bus: SPI/I²C/UART/CAN/USB as parsed packets above the wiggling lines, with ACK/NAK, framing errors, contention highlighted. "Did the bus actually work." *[mixed-signal buses + decoder overlay]*
- **Transmission-Line Digital (reflections on the bus itself)** — Apply the T-line element to a digital edge: ringing, overshoot, the unterminated-trace staircase, why series/parallel termination exists. *[ELEM_TLINE + digital edges + eye diagram]*
- **FPGA Fabric Timing & Setup/Hold** — Make routing delay physical: a path too long fails setup; the player sees timing slack as a margin bar and a metastable flicker on violation. Static timing analysis, the real reason FPGAs are hard. *[multi-rate/FPGA tier + metastability]*

### J. Cross-domain & accounting lenses

- **Charge-Carrier Microscope** — A 4th lens *below* the electron view: zoom past the wire into doped silicon — carrier drift, depletion regions widening/narrowing with bias, recombination flashes at a junction. Answers "why 0.6 V" physically. *[lenses]* *(merged with "Quantum/Semiconductor-Level Zoom — the band-diagram tier" and "Inside the Wire" first-person below.)*
- **Field Lens (E and B fields)** — Overlay the electric field between cap plates (denser as it charges) and the magnetic field looping an inductor (breathing with current); magnitude is `½CV²`/`½LI²`-derivable. Makes "energy stored in a field" literal. *[lenses]*
- **Heat-Flow Lens** — A FLIR-style false-color overlay where every part glows by I²R and heat visibly *conducts* into the board and neighbours. "Why did this resistor cook?" becomes spatial. *[heat]*
- **Electron-Pressure Heatmap** — In the analogy lens, render the whole board as a continuous pressure *field* (color gradient), so voltage reads as a smooth landscape and current as water rolling downhill. Kills the "voltage moves" misconception. *[lenses (analogy)]*
- **Impedance Terrain (frequency as a landscape)** — A 3D-ish surface: x = frequency, height = |Z| of the selected node, a ball at the source frequency that rolls into the resonance notch. *[Bode/phasor]*
- **The Whole-System Energy-Flow Lens (Sankey)** — Across the whole board, render energy as a Sankey: source in → useful work vs heat vs EMI vs switching loss. The ultimate "where did my watts go." *[heat + power + EMI → one accounting lens]*
- **The Reluctance / Weather / City re-skins** — Three thematic re-skins of the existing physics overlays (see Wildcards §VII for Weather and City). *[lenses]*

---

## II. New gameplay modes & loops

### A. Roguelike / run-based

- **Drafted Bench (deckbuilder roguelike)** — Each run deals a random *hand* of parts + a random contract chain; build only from what you drafted, picking one of three upgrades between contracts. A seed is a shareable run. *[contracts + bin]* *(merged with "Speedseal," the sealed-pool tournament variant.)*
- **Component Famine** — Every contract consumes the part types you used (cooldown for N contracts), forcing a different topology each time — divider, then Zener, then series-pass, then buck, all for "make 3.3 V." *[contract templates / no-one-true-answer]*
- **One-Board Permadeath** — One board for the whole run; heat, wear, electromigration accumulate tick-over-tick across every contract; a vented part is gone forever and *scars the layout*. The board is your HP bar. *[board roguelike, harder + wear-out]*
- **The Junk Drawer (run)** — Start with a pile of mismatched salvage (wrong tolerances, a leaky cap, low-β transistor); hit specs *with the garbage you have*. The tier system is the whole difficulty knob. *[tiers/variants]*
- **Ascension Rails** — Stacked New-Game+ modifiers (`+1 reality rung baked in`, `all rails sag 10% harder`, `no electrolytics`, `FCC tightened 6 dB`) — each one `buildNetlist` gate flip. *[reality-dial]*

### B. Tower-defense / survival / wave

- **Brown-Out Defense** — Waves of loads switch onto your bus on a schedule; pre-place decoupling/bulk caps and size the bus so no district browns out. The cap-as-buffer-chest made into "hold the line." *[factory-loop buffer chest]*
- **Surge Siege** — Timed transient attacks (ESD zaps, inductive kickback, lightning on the mains); build the TVS/MOV/snubber layer in advance and watch each strike get clamped — or not. Determinism = fair replayable waves. *[surge/clamp examples]*
- **Thermal Survival** — Ambient ramps over the run; keep every junction under Tj as the room cooks, adding heatsinks/vents/derating just in time. The survival meter is the hottest die. *[heat]*
- **EMI Quarantine** — Aggressor signals "spread" coupling to neighbour traces like an infection; contain the outbreak with guard traces, ground stitching, routing distance before the contaminated net trips the FCC sensor. *[EMI]*
- **Keep It Lit** — Endless: an LED array must stay above a brightness floor while the supply random-walks toward dropout; bolt on regulation/reservoir to ride each dip. Score = ticks survived. *[sources/regulators]*
- **Brown-Out Battle Royale** — N designs share one sagging bus whose current limit ratchets down each round; first to brown out of spec is eliminated. *[factory-loop belt states + PvP]*

### C. Puzzle / constraint / blind

- **One Rail** — A whole campaign solvable with exactly one voltage rail + ground. Forces level-shifting, charge pumps, bias tricks. *[constraint framing]*
- **Five Parts** — Every contract solved in ≤5 elements — the par system as a hard wall. Elegance as survival. *[par/golf]*
- **No-ICs Monastery** — Build everything from discretes only — a NAND from 4 MOSFETs, an FF from 2 NANDs — forbidding the sealed-IC shortcut. The "build it from discretes, then earn the abstraction" keystone made a vow. *[Era-5 logic-from-transistors]*
- **Blind Build** — Scope and meters hidden until you ship; reason the circuit cold and predict the outcome, then watch the reveal. Predict-then-reveal as the whole stance. *[predict-then-reveal]*
- **Schematic-Only / Lens-Locked** — Solve seeing only *one* lens — only the water-pipe, or only electron-flow, never the schematic. Teaches what each abstraction hides. *[3-lens system, new use]*
- **Reverse Spec** — Given a finished mystery circuit, *write the contract it passes* — author the spec/tolerances/conditions that fence this design and nothing simpler. Inverts the grader. *[contract grader]*
- **The Fixed Point** — A circuit with one wire missing; place a single component so the board reaches a *stated equilibrium* you must reason backward to. Pure analog-solver puzzle. **NEW**
- **Topology Sudoku** — A grid of empty footprints with line-constraints ("this row sums to 5 V," "this column carries ≤20 mA," "no two adjacent caps") you fill so every constraint holds at once. The MNA solve adjudicates. **NEW**
- **Time-Reversed Circuit (solve backwards)** — Show the *output* waveform + topology, hide one value, and ask the player to set it so the sim *produces* that output. Inverse design as a puzzle. *[calc solve-for, generalized]*

### D. Time / rhythm / speed

- **Speedrun the Solve** — A timer, a route through a fixed contract ladder, glitchless vs any%, a wall-clock leaderboard with replay proof. *[replay artifact, concretized]*
- **The Metronome (rhythm mode)** — A clock/PWM source sets a beat; add/toggle parts *on* the beat to land edges in a target timing window — setup/hold made musical. The fixed-step sim is already a metronome. *[PULSE/clock + audio]* **NEW genre**
- **Single-Step Marathon** — Never press Run — only single-step — and reach a target state in the fewest ticks, reading the solver tick by tick. *[transport/single-step]*
- **Time-Attack Bring-Up** — A cold board; the clock starts when you energize; race to get the rail stable, the oscillator running, and the output in-band. The energize sweep becomes the win condition. *[ship-it juice]*

### E. Detective / mystery / escape-room

- **The Intermittent (mystery campaign)** — Each case is a near-working board with one *hidden* fault (cold-solder-as-high-R, a swapped variant, an under-rated cap that fails only hot); diagnose by probing, propose the fix, the sim confirms. Debugging-as-verb as a whodunit season. *[repair contracts + debugging reframe]*
- **Glitch Hunt (rewind detective)** — A board fails once every few thousand ticks; rewind to the exact failing tick, freeze, and probe the race that caused it. Frame-perfect forensics — determinism + scrubber. *[time-as-toy + debugging verb]*
- **Datasheet Forensics** — Handed measured waveforms (a scope trace, a Bode plot) + a parts catalog, deduce *which exact part with which tier/variant* produced them, like a fingerprint. *[Bode/phasor + tiers/variants]*
- **Escape the Dead Bench** — A timed escape-room: the board is locked (output must hit a code-sequence of voltages); each "lock" is a sub-circuit puzzle that arms the next. **NEW**
- **Cold Case Recall** — Given a fielded product that's RMA-ing + the full BOM, reproduce the failure on the bench (find the seeded weak margin), then ship the fixed revision. The product-run report card played *backwards*. *[product-run]*
- **Differential Teardown (spot the bug)** — Two near-identical published chips, one with an injected flaw; race to find which and where, by probing alone. A viral daily. *[teardown + glitch bounty]*

### F. Management / tycoon / city-builder

- **Fab Tycoon** — Run a foundry: set process params, fund quality; your *yield* is a deterministic function of the designs you accept; balance throughput vs FIT vs reputation. Players are your customers. *[Clock 3 / Silicon Factory]*
- **Power District (grid city-builder)** — Zone a board into districts (logic city, analog suburb, RF industrial), lay shared buses as roads, manage current "traffic" and EMI/heat "pollution" between zones. SimCity where the externalities are real physics. *[factory districts + EMI + heat]*
- **Consultancy** — Juggle several standing contracts with deadlines on a fixed bench; choose which customers to fire, which to over-deliver for. The standing-contract drip as a plate-spinner. *[standing contracts]*
- **The Component Market / Futures** — Part prices fluctuate with aggregate demand (a "shortage" makes 1% resistors expensive this week); re-spin designs to a cheaper BOM under live market pressure. *[BOM economy]* *(merged with "Component Futures Market" and "Silicon Stock Market.")*

### G. Idle / incremental

- **The Slow Cap** — An idle game whose whole screen is one giant capacitor charging on a multi-hour RC curve; spend the charge to buy faster resistors, bigger caps, parallel banks. The RC transient as number-go-up, physically honest. **NEW**
- **Standing-Contract Empire** — Pure idle: commit dozens of robust designs, each dripping Credits/interval *as long as they hold spec* under a tick-seeded walking load; prestige by retiring a design line. *[standing contracts]*
- **Electromigration Clicker** — Click to push current; current slowly wears a trace toward failure (~J²t); the meta-game is widening traces and adding redundancy to push the wear-out horizon out. *[wear-out/reliability]*

### H. Sandbox-physics toys / creative

- **The Marble Run (signal playground)** — No spec: drop sources, gates, delays, and watch a pulse *travel* the board like a marble through a Rube-Goldberg machine; share the prettiest propagation. *[sandbox]* **NEW framing**
- **Synthesizer Bench** — Wire oscillators, filters, mixers and *play the board as an instrument* — audio is the output you optimize. A 555 + RC ladder is a real synth voice. *[audio + AC tools]* *(see Synthwave Foundry world.)*
- **Lissajous Studio** — Drive X and Y of the phase scope with two oscillators and *draw* with the figure; challenges ask for shapes, scored on fidelity. The phase scope as an Etch-A-Sketch. *[phaseScope.ts]*
- **Cymatics / Waveform Painting** — Author a target waveform; build the analog circuit (harmonics, filters, clipping) whose output matches it — additive/subtractive synthesis as a build puzzle, graded by spectral distance. *[AC sweep/Bode]*
- **The Demoscene Board** — Build oscillators/dividers whose combined audio/visual output is a piece of music or animation (chiptune from square waves, Lissajous figures); scored on aesthetic merit by community vote. *[synth lens + scope X-Y]*

### I. Boss fights / brutal specs

- **The Spec From Hell** — One contract with a dozen simultaneously-AND-ed lines that fight each other (rail-to-rail AND low power AND low EMI AND −40 °C to 125 °C AND under par BOM) — each "phase" a constraint you satisfy without breaking the last. *[CEC-Certified sweep]*
- **The Moving Target** — A boss whose spec *changes mid-run*: the customer "revises requirements" on a schedule and your shipped design must still pass after each revision without a full rebuild. *[contracts]* **NEW**
- **Worst-Case Gauntlet / Tolerance Roulette** — The boss is the Monte-Carlo sweep dialled brutal: survive 10,000 seeded tolerance+temperature draws with zero failures; the boss "attacks" by showing you the worst draw it found, live. A "death feed" shows designs dropping out. *[Monte-Carlo / CEC-Certified]*
- **The Datasheet Liar** — A boss part whose published specs are subtly wrong (the real silicon under-performs its sheet); characterize it, catch the lie, design around the *true* behavior. "Trust but verify." *[teardown/characterization]*

### J. Meta-mechanics spanning many modes

- **The Difficulty Dial Is The Reality Level** — Any mode re-skinned at a higher reality rung for more reward/prestige — one orthogonal knob gives every mode a hard-mode for free. *[reality-dial]*
- **Seeded Everything** — Every mode ships a "daily seed" variant: same board/contract/fault for the whole world that day, leaderboard-comparable. The daily generalized. *[daily contract]*
- **Mode Mutators** — Stackable mutators any mode can opt into ("fog of war on the schematic," "your meter lies ±5 %," "parts cost double but pay triple") — each a tiny gate flip. **NEW**
- **The Anti-Bench (build the WORST circuit)** — Inverted contracts: maximize ripple, waste the most power as heat, build the loudest EMI transmitter, the most spectacular smoke. You can't sabotage what you don't understand. *[contract grader, inverted objectives]*
- **Whisper Mode / The Whisper Network (no numbers)** — Hide every readout, scope, and meter; reason purely from belt/glow/heat/sound, then reveal. Forces qualitative intuition before quantitative crutches. *[visual-language, subtracted]*

---

## III. Teaching, pedagogy & tools

### A. New visualization lenses for teaching

- **The Slow-Mo Knob (time dilation)** — A continuous dilation slider independent of pause/step: drag a single edge across the whole screen and watch a transition propagate node by node. Determinism makes any dilation exact. *[determinism/replay]*
- **Time-Axis Ghosting** — Fading "ghost" traces of where every node was N ticks ago, *on the board* — a charging cap leaves a comet-tail of its rising level. Welds the board and the scope. *[scope]*
- **KCL/KVL X-Ray** — Tap a node and it inflates into a balance-beam: currents in vs out as arrows that sum to zero (KCL); tap a loop and the drops tile around it summing to zero (KVL). Surface the books the solver already balances. **NEW** *(panels flagged this the single highest-leverage teaching lens.)*
- **Dueling Lenses Split-Screen** — The same running circuit in two lenses side-by-side (reality vs analogy) with a synced cursor, so the electron picture and the water picture animate in lockstep. The analogy only teaches if you watch it map. *[lenses]*

### B. Predict-then-reveal, everywhere

- **The Wager Strip** — Before every Run, a one-tap prediction ("Will OUT be higher / same / lower?") or a draggable guess; reveal overlays your guess on the truth. Prediction made one tap removes the friction that kills it. *[calc predict-then-reveal, generalized]*
- **Draw-the-Scope-Trace** — Sketch what you think the output looks like on a blank scope grid; on Run, score the overlap and highlight where intuition diverged. *[scope + Wager Strip]*
- **Hide-a-Value Drills** — Any worked example blanks one value or meter reading and asks you to derive it first. Turns passive examples into active recall, zero new authoring. *[Build-steps]*
- **Knob-Forecast** — Grab a value slider and a faint "predicted" ghost appears you must drag to match *before* the real output updates. Builds the "which way does it move?" derivative intuition. *[calc + value-picker]*
- **Estimate-First Challenges** — A mode that disables the calculator and meter and asks for an order-of-magnitude answer first, grading within a factor. Fermi sanity-checking that catches the 1000× error. *[calc, inverted]*

### C. Spaced repetition & retention

- **The Bench Streak / Daily Circuit** — A daily seeded micro-challenge that resurfaces concepts you've touched, spaced by a forgetting curve; identical for everyone, shareable. *[contracts + codex]*
- **Concept Flashcards from Autopsies** — Every FAIL autopsy seeds a spaced-repetition card ("a resistor failed because ___") resurfacing as a 30-second bench warm-up. Failures are the stickiest memories. *[FAIL/autopsy]*
- **Leitner Parts Bin** — Mastered parts sink to a "known" shelf; recently-flubbed parts float back up with a glow. The bin *is* the SR scheduler — no separate study mode. *[tiers/variants + bin UI]*

### D. The wiki / codex / glossary that fills as you discover

- **The Codex Wiki (auto-filling)** — Promote eureka/codex pages to a hyperlinked in-game wiki: each term links to the example that taught it, the equation, and a live embedded mini-sandbox. *[lab-notebook]*
- **Etymology / First-Encounter Stamps** — Each codex entry records the exact circuit and tick where you *first* caused the phenomenon, as a replayable thumbnail. Episodic anchoring. *[lab-notebook + replay]*
- **Term-on-Hover Everywhere** — Any technical word in any tooltip/step/contract is a dotted-underline link to its codex page (greyed until discovered, glowing when fresh). *[onboarding + codex]*
- **The Etymology Mode / Why It's Called That** — On first use, a short interactive on the part's history and naming (a capacitor "capacitates"; Zener named for Clarence Zener). A humanities track over the same triggers. *[lab-notebook / codex]*

### E. Guided derivations (Ohm → KVL → Thevenin → Bode)

- **The Derivation Ladder** — A scripted interactive proof-walk: Ohm on one resistor → the game adds a second → the divider formula → KVL → Thevenin → (with C) Bode roll-off, each step a live circuit you manipulate. The *derivation* made playable. *[Build-steps → multi-circuit arcs]*
- **Thevenin Collapse Animation** — Select a two-terminal sub-network and watch it physically collapse into a single source + series R (parts slide together and merge). The seal mechanic repurposed as a teaching transform. *[IC-maker seal-as-collapse]*
- **Superposition Solo Mode** — For a multi-source circuit, a toggle that zeroes all-but-one source and shows that source's solo contribution as a colored layer; stack the layers to rebuild the full answer. **NEW** (per-source re-solve, golden-safe)
- **Units-Cancel Animation** — When an equation is shown with values, the *units* visibly cancel (V/Ω → A) like a physics worked problem. Dimensional reasoning as choreography. *[info-drawer equations]*

### F. Failure autopsies & debugging pedagogy

- **Time-to-Failure Replay Scrubber** — On any FAIL, auto-rewind to last-good and scrub forward to *watch the failure form* (current ramps, heat builds, box trips). Teaches the precursor signs. *[FAIL/autopsy + replay]*
- **The Symptom→Cause Decision Tree** — A guided diagnostic that asks "is the rail sagging? is it hot? is the output stuck?" and routes you to the confirming probe — teaching a debugging *method*, not just the fix. *[FAIL/autopsy + debugging verb]*
- **Sabotage Mode (find-the-bug)** — Generated near-working boards with one deterministic flaw and a visible symptom; probe and fix. Reading a circuit you didn't build is the authentic skill. *[repair contracts]*
- **Magic-Smoke Museum** — A trophy wall of every way you've blown something up, each a replayable clip with the post-mortem. Gamifies failure into collection. *[FAIL/autopsy + codex]* *(merged with "The Confessional / Magic-Smoke Memorial" and "Failure Trophy Shelf.")*

### G. "Explain this circuit" / comprehension tools

- **Circuit Narrator** — Press a key and the game traces the signal path in plain language, lighting each block in sequence: "5 V enters here → the divider halves it → the cap smooths the ripple → the load sees 2.4 V." Built from netlist + the per-part `plain()` strings. Gives the novice a *reading order*. *[info-drawer plain() + netlist]*
- **Block-Boundary Auto-Annotate** — The game recognizes idioms (divider, RC filter, half-bridge, current mirror) by topology and labels them with a dotted box + name. Teaches the *vocabulary of sub-circuits*. **NEW** (topological idiom matcher)
- **"What changes if…" Sensitivity Halos** — Hover a component and every other node lights up by *how much* it would move if you nudged this part (∂Vnode/∂value). Teaches which parts are load-bearing. **NEW** (perturbation re-solve, golden-safe)

### H. Datasheet-reading & part-selection minigames

- **Datasheet Detective** — A contract states a condition ("80 mA at 85 °C, < 0.3 V drop") and you pick the right part from a wall of parametric tables — the table is the puzzle. *[exams / datasheet literacy]*
- **Derating Dial** — A part's datasheet curve (current vs temperature) shown live with the operating point riding it; keep the dot inside the safe area as the contract heats. *[reality ratings + heat]*
- **Spec-Sheet Bingo** — Each placed part reveals one datasheet parameter; "complete the row" of its key specs (Vf, If, Pd, Tj…) to earn a mastery badge. Drives *thorough* understanding. *[tiers/variants + exams]*

### I. Unit / dimension / numeracy drills

- **SI-Prefix Gym** — Rapid-fire µ↔n↔p, 1 kΩ vs 1k vs 1000 Ω, framed as "stock the bin fast." Prefix fluency is a silent prerequisite. **NEW** (uses `fmtSI`)
- **The Tolerance Stack-Up Sandbox** — Combine ±5 % parts and predict the worst-case output range; the Monte-Carlo service shows the actual spread. Tolerance arithmetic + statistical thinking made concrete. *[reality tolerance + MC bench]*

### J. Assessment / certification

- **The CEC Practical (proctored exam)** — A timed, calculator-limited, single-attempt exam contract that issues a verifiable, shareable **certificate** signed by the replay hash — tamper-proof. *[exams + replay anti-cheat]*
- **Adaptive Difficulty Ramp / AI Director** — Contracts read your pass/fail history and tune the next problem's hardness (more reality, tighter tolerance, novel topology) to keep you in the zone of proximal development. *[contract seeding]*
- **Misconception Probes** — Deliberately seed problems that expose classic EE misconceptions (current "used up," voltage "flowing," a cap "blocking" at the wrong frequency) and reveal the truth on Run. **NEW** (curated misconception library)
- **The Misconception Boss Fight** — Personify a misconception ("Current Gets Used Up") as a recurring antagonist whose "attacks" are circuits that *seem* to support the wrong idea; defeat it by building the disproof. *[Misconception Probes + narrative]*

### K. Accessibility

- **Colorblind-Safe Rail Encoding** — Pair every rail-identity color with a pattern/texture (dashes, dot density, glyph) so the wire-code reads without hue. Finishes what the visual-language doc warns about. *[lenses/visual-language]*
- **Screen-Reader Telemetry Track** — A throttled `aria-live` "what just happened" narration ("OUT settled to 3.3 V; R2 at 41 °C, nominal") mirroring the visible state board-wide. *[info-drawer a11y]*
- **Dyslexia/ELL Plain-Mode Copy** — A toggle swapping every teaching string for shorter, higher-frequency-vocabulary copy, plus OpenDyslexic. A copy-only swap that widens the door. *[onboarding/copy]*

### L. Classroom / teacher tools

- **Teacher Dashboard** — Aggregates a class's deterministic replays: who passed which spec, *where* each circuit diverged from working, common failure clusters. Shows *the actual mistake*, not just a score. *[replay]*
- **Cohort Histograms (anti-cheat that teaches)** — The teacher sees the *distribution* of solutions — par scatter, common failure mode, the one elegant topology. Copied work is *visibly identical* because replays cluster. *[classroom + determinism]*
- **Assign-a-Contract (custom problem authoring)** — Teachers compose a contract from spec-line primitives (no code, the sim judges) and push it to a roster. *[contracts]*
- **Replay Critique / Annotated Solutions** — A teacher or peer scrubs a student's replay and drops pinned comments at specific ticks ("here's where the rail browned out"). Feedback located *in time on the actual run*. *[replay]*
- **Curriculum Mapping Overlay** — Tag examples/contracts to standards (intro circuits, AP-Physics-E&M, IEEE topics) and filter the content tree by standard. Lowers adoption friction. *[Build-steps/contracts metadata]*

### M. The lab notebook, deepened

- **Structured Lab Notebook (hypothesis → method → result)** — A real engineering logbook: each entry auto-captures the circuit, your stated hypothesis (from the Wager Strip), the measured result, a reflection prompt. The self-explanation effect, invited by structure. *[lab-notebook + Wager Strip]*
- **Auto-Generated Design Report** — One click turns a finished contract into a formatted report — schematic, BOM, measured-vs-spec table, scope captures, notes — exportable as PDF. Technical *communication*, scaffolded from existing data. *[lab-notebook + contracts]*
- **The "Show Your Work" Trace** — The notebook records the *sequence of value choices* converging on a solution, replayable as a design-history slider. Metacognition — you critique your own process. *[replay + lab-notebook]*

### N. Real-world bridges

- **Photo Overlay / "This is the real part"** — The schematic glyph cross-fades to a *photograph* of the actual part next to its body, leads aligned. Closes the symbol→object gap. *[info-drawer / component-info-panel]*
- **Breadboard Translation View** — A lens re-rendering your schematic as it'd look *on a breadboard* (parts in holes, jumpers across the gap) — the single hardest beginner translation. *[lenses]*
- **Oscilloscope-Mastery Course** — A track teaching the *instrument*: triggering, time/div, V/div, AC vs DC coupling, probe loading, aliasing (the DT=2µs ceiling becomes a *taught* Nyquist lesson). *[scope]*

### O. Socratic AI tutor

- **The Bench Buddy / Bench Tutor (Socratic, grounded)** — An LLM tutor that never sees the answer — only the deterministic replay's measurements — and asks the next leading question true to your live circuit ("Your Vout is 3.21 V, spec wants 3.30 — which part has tolerance?"). It can't hallucinate physics because the sim is ground truth and the one-cause-at-a-time reality dial scopes every hint. *[grading + reality-dial diagnosability]* *(merged across lists.)*
- **Rubber-Duck Probe** — Point the AI at a node and it narrates *what the sim says* in plain language ("this net is floating to ~0 V, so your gate's VCC is dead"). Explanation, not solution. *[measurement layer]*
- **Hint Ladder (graduated, Lux-priced)** — A tiered hint system (nudge → concept → near-answer) where deeper hints cost Lux, so asking has a real mastery cost that discourages answer-mining. *[Lux + Bench Buddy]*
- **"Explain it back" Gate** — To claim a top bonus tier, the tutor asks you to explain *why* your circuit works in one sentence and checks it semantically. The teaching-effect enforced where motivation is highest. *[contract bonus tiers + Bench Buddy]*

### P. Pedagogy wildcards

- **Concept Dependency Map (the skill constellation)** — A visible star-map of every EE concept where unlocking one lights its prerequisites/consequents; you see the *structure* of the field and your own frontier. *[codex + tech tree, visualized]*
- **Reverse Datasheet (you write the spec)** — Hand the player a sealed IC-maker chip and make them *characterize* it — run sweeps, measure, fill in its datasheet from observation. The deepest possible understanding of a black box. *[IC-maker + scope/Bode]*
- **Two-Player Probe Duel** — Two learners, one circuit: one introduces a hidden fault, the other finds it with the fewest probes; deterministic replay scores both. *[Sabotage + multiplayer]*

---

## IV. Content, worlds & narrative

### A. Historical eras as traversable places

- **The Timeline Bench** — A horizontal scrollable "century rail" where each station is a working bench from a real era (1906 tube → 1947 transistor → 1958 first IC → 1971 4004 → today's SoC); you *time-travel* to the bench a breakthrough was invented on and rebuild it under period-correct constraints. Turns the abstract era tree into geography. *[era tech-tree]* *(merged with "Circuit Civilization / tech-tree-of-history.")*
- **The Vacuum-Tube Wing** — A pre-transistor world where the only active device is the triode; you *suffer* tubes first (huge, hot, microphonic, warm-up) so you feel why the transistor mattered. *[parts-catalog + heat]*
- **The Relay Computer Vault** — Build logic ONLY from relays (a Zuse Z3 fantasy): clacking armatures, audible clatter, glacial clocks you watch tick. A "build a relay adder" arc. *[relay + IC-buildings logic]*
- **Moore's Law Treadmill** — As sim-"years" pass, the available process node shrinks, parts get cheaper/smaller/hotter, old designs become legacy. A living timeline that ages your catalogue. *[product-run + package-density]*

### B. Themed worlds / biomes

- **Synthwave Foundry** — Everything is audio: VCOs, VCFs, ADSR, ring modulator, Moog-ladder filter; contracts are "make this sound" graded against a target spectrum; the reward is *hearing* your patch. *[audio reward + op-amp/filter]*
- **Rover World (the space-probe world)** — A Mars-rover power/telemetry biome: solar + battery + buck + radio under a brutal day/night thermal swing and a hard mass/power budget; the antagonist is the environment (dust, cold, radiation bit-flips). *[product-run + heat + photodiode]*
- **The Pacemaker Lab (medical-device world)** — Ultra-low-power, ultra-reliability: every microamp matters, every part must survive a "10-year implant" run, a single FAIL is catastrophic. Leakage, derating, redundancy. *[product-run + FAIL mask]*
- **Robotics Yard** — Motors, H-bridges, encoders, PWM, a back-EMF lens; contracts are "drive this arm to position" with a real inductive-load model; the factory belts drive spinning load glyphs. *[H-bridge IC + inductor + mechanical-node]*
- **The Arcade Cabinet (retro-gaming world)** — Rebuild a Pong/Breakout TTL board, a CRT deflection circuit, a coin-acceptor comparator — Era-1975 7400-series only; the "win" is your circuit playing a tiny game on a simulated raster. *[logic ICs + 555]*
- **The Power Plant (high-voltage world)** — Mains rectification, isolation transformers, SCRs/triacs, snubbers, arc-flash danger; the voltage-color ramp goes hotter/whiter into mains. Respect or vent spectacularly. *[rail-color ramp + transformer]*
- **The Quiet Room (RF/wireless world)** — An anechoic-chamber biome where the EMI/RF systems are the *whole* game: a matched antenna, a Smith chart, the FCC chamber. Coupling is the protagonist. *[EMI + reality rungs 6/7]*
- **The Sub-Zero Cryo Lab** — Superconductors, near-zero resistance, Josephson junctions; the thermal lens runs *cold* and parts behave bizarrely. Exotic-physics sandbox. *[heat, inverted + exotic devices]*

### C. Named characters, clients & factions

- **Critical Error Computing, Inc. (the player's employer)** — The framing fiction: you're a bench engineer at CEC; the HUD is your workstation, contracts arrive over an internal ticketing system, promotions are the tech tree. A diegetic wrapper for the economy. *[contract/Reputation standing]*
- **Mx. Ferrite, the Grizzled Bench Lead** — A mentor NPC who narrates your first eurekas, leaves margin notes in the lab notebook, and hands you cursed legacy boards to debug. The voice of the tutorial without a tutorial. *[onboarding + lab notebook]*
- **The Clients Roster** — Recurring contract-givers, each a teaching archetype: "Doc Sallen" (filters), "Captain Buck" (SMPS), "Penny Wise" (cost-down golf), "The Auditor" (Monte-Carlo sweeps), "Old Man Tube" (restorations). Personality skins over the generator. *[contract templates]*
- **ENTROPY (the antagonist)** — Not a rival firm — *entropy itself*, personified: heat that always climbs, tolerances that always drift, electrolytics that always dry out, fields that always fail. The product-run is a battle against the second law; the notebook's failure pages are dispatches from the enemy. *[product-run + failure codex]*
- **FlyByNight Components (the counterfeit menace)** — A shady supplier offering parts at half BOM that *sometimes* are counterfeit (relabeled, under-spec) and blow up in the run. A risk/reward sourcing minigame with a storefront. *[product-run counterfeit input]*
- **The Standards Body (faction)** — A bureaucratic faction issuing certifications (FCC, UL, CEC-Certified) that periodically *changes the rules* — a new emissions limit drops, retroactively threatening your shipped fleet. Seasonal regulatory pressure. *[certification gates]*
- **The Open Source Collective (faction)** — The benevolent counter-faction: the Bench Exchange community as a guild whose shared standard-cell library you join, contribute to, earn standing in. *[Exchange]*

### D. Story / campaign / lore

- **"The Bench That Wouldn't Die" (the campaign spine)** — You inherit a derelict lab, restore its power, and each era you unlock is a *room you bring back online* — the lab itself is the progress bar, lights flickering on. *[era progression]*
- **The Legacy Board Mysteries** — Dusty old boards left by previous engineers, each a debug-detective episode with a backstory note; fix it and a page of the lab's history unlocks. *[debugging verb + Dead Bench]*
- **The Datasheet Codex as Lore** — Every codex/datasheet page is written in-world by a fictional manufacturer with a personality and an era; reading the catalogue is reading a history of electronics through its marketing copy. *[lab-notebook / codex]*
- **The Recall Crisis (a story beat)** — A scripted-feeling but sim-honest event: a widely-shipped chip is found to fail under a condition you didn't test; diagnose the systemic flaw, issue a fix, rebuild trust. *[product-run recall]*
- **The Blackout (a world event)** — A grid-failure scenario where your bench runs on stored energy; budget every joule from a charged supercap to keep a critical load alive longest. *[supercap/energy budget + tower defense]*

### E. Collectibles & the museum

- **The Chip Museum** — A persistent gallery of every IC you've sealed, displayed as five-tier glyph cards on plinths, walk-through, sortable by era/function/phenomenon. A trophy room for UGC. *[IC-maker + five-tier glyph spec]*
- **The Silicon Hall of Fame** — A curated set of *real* famous chips (4004, 555, 741, 6502, 7400, SID) as collectible "legendary" cards you earn by rebuilding them to spec, each with real history and a die shot. A Pokédex of historic silicon. *[IC libraries + famous-circuit rebuilds]*
- **Vintage Part Crates** — Cosmetic-but-flavorful collectible part skins (a carbon-comp resistor with color bands, a paper-in-oil cap, a gold-leaded mil-spec op-amp) pulled from "estate sale" crates as rare drops. *[tiers/variants]*
- **Blueprint Trading Cards** — Sealed circuits packaged as shareable, foil-rarity "cards" (rarity = dependency count); a collect-and-trade meta over UGC. *[Exchange dependency count]*

### F. Procedural mystery devices

- **The Junk Drawer (procedural)** — An infinite procedurally-generated supply of sealed mystery devices (random valid sub-circuits) to reverse-engineer; characterize the black box, name it, and it's yours. A roguelike loot stream of puzzles — the seal mechanic run *backward*. *[teardown / Dead Bench + generative]* *(merged with "Generative Mystery-Device.")*
- **The Cursed Component** — Procedural mystery parts with *one* hidden non-ideality seeded into an otherwise-working board; find the saboteur. Electronics Cluedo. *[reality toggle + debugging verb]*
- **Signal Wordle (Chip Archaeology)** — A daily procedurally-seeded black box; everyone gets the same one; deduce its transfer function in the fewest probes; share your "probe trace" like a Wordle grid. *[Chip Archaeology]*
- **The Alien Artifact** — A late-game mystery on *deliberately weird* topology (a chaotic oscillator, a Chua circuit, a tunnel-diode latch) that defies first-principles guessing and rewards real exploration. *[exotic components + reverse-engineering]*

### G. Real famous circuits to rebuild

- **The 555 Cathedral** — A guided arc culminating in building the 555 from its actual internal schematic (two comparators, an SR latch, a divider, a discharge transistor) — then sealing *your own* 555 and watching it blink. *[IC-buildings 555 + seal]*
- **The 741 Teardown** — Rebuild the legendary op-amp from its transistor-level schematic (the current mirror, the diff pair, the class-AB output). The discrete-before-abstraction ladder applied to history's most-used op-amp. *[op-amp + discrete pedagogy]*
- **The 6502 Datapath (the long game)** — A multi-hour epic: build a working 8-bit CPU datapath (registers, ALU, bus) from sealed chips you authored, and watch an instruction execute tick-by-tick. The capstone of capstones. *[IC-maker + memory/ALU chips]*
- **The Bench Classics Pack** — A curated campaign of canonical circuits: the Wien-bridge oscillator, the Howland current pump, the bootstrap follower, the Baxandall tone control, the long-tailed pair, the Pierce crystal oscillator. *[worked-examples campaign]*
- **The Blinkenlights Build** — Rebuild iconic blinking circuits: the Larson scanner (Knight Rider), a VU meter, a Nixie clock, a charlieplexed matrix. Eye-candy driven by real timing/logic. *[7-seg/LED parts]*

### H. Seasonal / event content

- **The Solstice Light Show** — A winter event: the most elaborate LED/Nixie display under a power budget; a community gallery of "circuit Christmas trees." *[seasonal layer + LED parts]*
- **The County Fair (a build-off season)** — A rotating exhibition of themed competitions (smallest oscillator, coolest-running amp, weirdest valid circuit) with ribbons and a public gallery judged by the sim. *[three-board daily + leaderboards]*
- **Hacktoberfest for Silicon** — A community event whose prompt is to *fork and improve* a published chip; contributions earn standing; the most-forked chip wins. *[Exchange remix/fork]*
- **The Estate Sale (limited-time drops)** — A periodic window where rare vintage part crates and one-of-a-kind legacy mystery boards appear. FOMO done honestly (cosmetic + puzzle, never power). *[vintage collectibles + mystery devices]*

### I. Display & output families

- **The Display Wall** — Beyond 7-segment: VFD, dot-matrix, the Nixie tube (its own warm-orange glow lens), an LED bar-graph, a charlieplex matrix, an e-ink panel. A gallery of ways to show a number. *[display I/O]*

---

## V. Social, UGC, competition & economy

### A. Marketplace beyond "publish & rate"

- **Datasheet Reputation (the lying-spec game)** — Authors write the *marketing datasheet* (typ/max claims); the importer's sim re-derives the truth and stamps the listing **VERIFIED / OPTIMISTIC / FRAUDULENT** by drift. Honesty becomes an asset; over-claiming earns a scarlet letter. *[Exchange manifest]*
- **The Pin-Compatible Standard (jellybean wars)** — Publish an *interface spec* (pinout + behavioral contract), not a chip; anyone can ship a part claiming the footprint and the grader certifies drop-in compatibility. Competing implementations of the same socket; second-sourcing. *[seal/interface-compliance]*
- **Bill-of-Materials Royalties (the npm-funding loop)** — When a standing contract pays out and your published chip is inside the winner, you skim a tiny royalty per interval — passive income scaling with how load-bearing your chip is. *[dependency economy + standing contracts]*
- **Obsolescence & End-of-Life** — An author marks a chip EOL; dependents get a deprecation warning + migration nudge; a "last-time-buy" panic ripples through the catalogue. Lifecycle/sourcing risk. *[Exchange + dependency graph]*
- **The Errata Page** — When a teardown or failed run proves a latent flaw, an **erratum** auto-appends to the listing, citing the replay that found it; authors can ship a silent revision. *[teardown + product-run]*
- **Counterfeit Marketplace (deliberately)** — A shadow tier of cheaper "compatible" chips whose hidden manifest under-performs; you find out via teardown or field failure. Genuine costs Credits; the clone is a gamble. *[counterfeit-parts reliability input]*

### B. Competition formats

- **The Spec Auction (reverse-bid contracts)** — A high-value contract opens for *bids*: players submit sealed designs and the cheapest-BOM passing entry wins the whole job; everyone else built for nothing. The sealed-bid reveal is perfectly fair. *[contract spine + golf]* *(merged with the bluffing-market "Spec Auction.")*
- **King of the Footprint** — A persistent throne per package/function: hold the par for "best DIP-8 timer" and your chip is the *default* the bin suggests to every new player until dethroned. *[leaderboards]*
- **The Relay Race (collaborative-adversarial chain)** — A ships a 3.3 V rail; B builds a load that brings it to its knees within spec; C hardens A's rail against B's load; etc. A baton of replays flipping attack/defend. *[duels + standing-contract stress]* *(merged with the pass-the-board co-op "Relay Race.")*
- **The Glitch Bounty Board** — Players post a *failing* board with a symptom as a public co-op bounty; the first to submit the root-cause + fix earns the poster's staked Credits + Lux. *[debugging verb + repair contract]*

### C. Spectator, streaming & async-social

- **The Replay Theater (Twitch-for-circuits)** — A published replay is the deterministic action+tick stream, so a viewer can **pause, rewind, fork off mid-build, and probe the streamer's live board with their own meters.** Watch a master, then *seize the board at frame 4000* and try it yourself. No other game can hand you the live world state mid-stream. *[ghost replays / replay export]* *(merged with "Twitch-Plays-the-Bench" crowd-voting.)*
- **The Co-Watch Scope** — Two players watching a replay drop synchronized annotation pins on the scope ("watch this node here") — async commentary baked onto the timeline, Soundcloud-comments for a waveform. *[ghost replays]*
- **Build-Along Streams (the teaching channel)** — A creator publishes a guided build using the existing `BuildStep`/`why` schema; followers run it locally in lockstep, diverging to experiment then re-syncing. A tutorial where the viewer *holds the soldering iron.* *[worked examples / classroom]*
- **Picture-in-Picture Ghost Race** — Overlay your live build against the par-holder's ghost *in real time* — their hands move beside yours; you see where they branched, idled, backtracked. *[ghost replays]*
- **The Oscilloscope GIF** — One-tap export of a scope/Bode trace as a looping clip with the netlist embedded in metadata — anyone who drops it back into the game reconstitutes the *whole board*. The waveform is the link. *[replay-as-share]* *(merged with "Replay-to-Video.")*

### D. Economy structure & meta-currencies

- **Patent Pool / Prior Art (publish-or-lose)** — First to publish a novel topology (graph-canonicalized + hashed) gets a permanent **inventor credit** riding every fork forever; latecomers see "prior art exists — credited to X." The netlist hash makes "who was first" objective. *[fork lineage / reputation standing]*
- **The Foundry Tax & Process Nodes** — Sealing "fabs" a chip on a chosen process node (through-hole → SMD → fine-pitch) that sets per-unit Credit cost + a density/heat budget. A Credit sink that teaches process economics. *[ic-package-density + product-run economy]*
- **Insurance & Warranties (bet on your own design)** — Before a run, *underwrite* it: stake Credits against a field-failure threshold; hit your margin and the warranty pays, eat a recall and you lose the stake. Players can *sell* warranties on each other's designs. A derivatives market on the deterministic FIT model. *[product-run]*
- **Bench Real Estate** — A shared persistent world-grid where a published board occupies physical space; premium "districts" near the daily contract are auctioned. Your sprawl is *visited*. *[shared world grid + factory sprawl]*
- **Lux is Non-Transferable, but Mentorship Mints It** — A senior player whose published build trips a junior's first-concept eureka earns a sliver of un-grindable **Mentor Lux** — the one sanctioned way others' learning touches your mastery axis. *[Lux firewall + eureka]*

### E. Reverse-engineering as sport

- **Blind Pinout (the harder teardown)** — The chip arrives with pins *unlabeled*; deduce which is VCC/IN/OUT/GND from probing before you can start replicating. The actual first 10 minutes of real reverse-engineering. *[teardown]*
- **The Decapsulation Lens** — Spend Lux/Credits to "acid-etch" a *competitor's* published chip and reveal its die under the reality lens — but only after a correct behavioral teardown. The X-ray is a *prize* for demonstrated mastery. *[teardown + zoom-to-open]*
- **Honeypot Chips (creator counter-play)** — A builder ships a deliberately baroque/obfuscated chip to *stump* teardown-sport players, earning a "resisted N teardowns" prestige. A creator niche of puzzle-makers. *[teardown "stump the world"]*

### F. Classroom / education / licensing

- **The Worksheet that Grades Itself in the Margins** — A teacher authors a contract; the *student's* predict-then-reveal guesses and autopsies log into a portfolio the teacher reads — assessment of *reasoning*, not just final pins. *[predict-then-reveal + classroom]*
- **Institutional Standard-Cell Library Licensing** — A school/company publishes a private, versioned cell library as a curriculum dependency tree; students inherit it; the org controls the primitives. A real EDU SKU. *[classroom course-library]*
- **Substitute-Teacher Mode (the AI-free hint economy)** — When a student is stuck, surface an *anonymized peer ghost* from a classmate who solved it — learning from a peer's hands, not a walkthrough. *[ghost replays + classroom]*
- **Educator API / LMS bridge** — LTI/Canvas/Google-Classroom integration where an assignment is a contract and the auto-graded byte-exact replay posts a score to the gradebook. Zero-trust grading. *[classroom-as-contract]*

### G. Real-world bridge (KiCad / PCB / hardware)

- **Export-to-KiCad (graduation moment)** — A validated board exports a real netlist/schematic you open in KiCad; seal a chip, get back a KiCad symbol + footprint. The game becomes the *front porch* to actual EDA. *[netlist export]*
- **Order-the-PCB (the ultimate ship)** — One button sends your design to a fab (JLCPCB/OSHPark Gerber + BOM); weeks later a real board arrives. In-game "SHIP IT" becomes a literal shipment. *[SHIP IT + IC-maker]*
- **Bring-Your-Own-Datasheet (BOM realism import)** — Select a real manufacturer part number; the game pulls its parametric table, lets you build with a faithful model of *that exact part*, and warns when you exceed *its* real ratings. *[tiers/variants param blocks]*
- **The Bounty Bridge (real money meets the grader)** — A real company posts a real engineering micro-challenge with a cash bounty; the sim grades entries; the winner's verified replay is the proof of work. Determinism is the trust layer. *[contract spine]*

### H. Cosmetics & identity (honest monetization)

- **Solder Style & Trace Couture** — Purely cosmetic board skins: routing styles, retro-PCB green vs CEC-rose, hand-soldered-blob vs precision-SMD, animated rail glows. No stats, ever. *[design system]*
- **The Signature Stamp** — A cosmetic maker's-mark silkscreened on every chip you publish (like a foundry logo on the die) — unlockable, collectible, a brand visible on every dependent's board. *[seal / publish]*
- **Trophy Benches & Hall of Fame** — Season winners get a permanent, visitable diorama of their winning board under glass in a "museum" district. *[shared world + seasons]*

### I. Social / governance wildcards

- **The Living Standard (governance game)** — The community *votes* (weighted by verified dependency-rep, not money) on what becomes a "CEC Standard" part — a canonized jellybean every board can assume. A slow-moving constitution of the catalogue. *[Pin-Compatible Standard + reputation]*
- **Generational Foundry (chips that breed)** — Fork two published chips and the system proposes a "merge" child seal that composes both, inheriting lineage from both parents. Family trees of silicon evolve over a season. *[fork-with-lineage]* *(merged with "Circuit Genetics / Breeding.")*
- **The Archaeology Server (a derelict shared world)** — A persistent grid seeded with mysterious, partly-broken legacy boards (some authored, some abandoned by departed players); guilds excavate, repair, and re-certify them for rewards. Recycles dead UGC into content. **NEW**
- **Firms & the Org Chart** — Guilds become *firms* with internal roles (a Sourcing lead, a Reliability lead, a Design lead) and ship *one* big contract no solo player could. Division of labor maps onto real engineering roles. *[guilds/firms + co-op]*
- **The Recall Ticker (a shared world event)** — When any firm trips a fleet recall, it's a public news event — schadenfreude, post-mortems, a temporary contract spike for whoever can supply the replacement. One player's failure becomes the economy's content. *[product-run + shared world]*
- **Time-Capsule Contracts (the determinism flex)** — Submit a design to a contract whose stress profile won't *fully* reveal for a real-world week of sim-time-scaled escalation; the seed means the future is fixed but unknown — a sealed prediction the community waits on. *[standing contracts]*
- **Sabotage (social deduction)** — One player on a shared board secretly introduces a fault; the others diagnose and call it out before ship. Among-Us for circuits, refereed by the sim. *[Coop Debug + deduction]*

---

## VI. Platform, tech & AI

### A. Hardware bridge (game ↔ real bench)

- **Twin Bench (Arduino-in-the-loop)** — WebSerial/WebUSB drives a real Arduino's pins from the game's emulator domain and reads the real ADC back into a sim net. "Domains meet only at the pins" means a real MCU is just another behavioral block whose pins are physical. *[behavioral-MCU / multi-rate]*
- **Ghost Multimeter** — Read a real USB/Bluetooth DMM and overlay its live reading on the same net in the sim — split-screen "what the model says vs what the bench says." Model-vs-reality calibration. *[AC analysis / measurement]*
- **Breadboard Mirror** — A phone/webcam computer-visions a real breadboard's layout into a netlist you can simulate — "photograph your homework, watch it run." *[netlist import]* **NEW ingest path**
- **Logic-Analyzer Replay** — Import a real `.sr` (sigrok/PulseView) capture as a stimulus track; the sim replays your firmware against *real captured bus traffic*. *[grading/stimulus + multi-rate]*
- **Bench-to-Contract** — A hardware teacher records a real scope trace as the *target waveform* of a contract; students must match real silicon, not an idealization. *[contracts/grading]*
- **Pi Pico Co-Processor** — Cross-compile the deterministic Rust core to a $4 RP2040 as a physical save-game cartridge / standalone bench instrument — same core, no browser. *[native build / core portability]*

### B. Interchange (SPICE / KiCad / Gerber / netlists)

- **SPICE Bridge (both ways)** — Export any board as a `.cir` netlist; import a SPICE deck and run it (within the element set). "Here's the same circuit in the language every real engineer uses." *[netlist import/export]* **NEW**
- **Diff-a-Datasheet** — Import a real part's SPICE model; the game auto-fits it to the nearest tier/variant preset and *shows the residual* ("this op-amp's GBW sits between mid-range and high-end"). Turns tiers into a real-parts lookup. *[tiers/variants]*
- **Touchstone In** — Import an `.s2p` S-parameter file and drive the Bode/phasor tools with measured data — the analytic AC domain has no Nyquist limit, so it can host real RF data. *[AC/frequency domain]*
- **The Replay Codec** — Define `.cecr` (replay) and `.cecn` (netlist) as first-class, documented, versioned public formats so *anything* can read/write them — the lingua franca that makes every other interchange idea cheap. *[sim-protocol]* **NEW format spec**

### C. AI roles

- **AI Contract Author** — An LLM generates contract *specs* (spec-line predicates over measurements) from a natural-language brief ("a 5 V→3.3 V supply that survives a 2 A transient"); the deterministic grader enforces them, so a bad spec is caught the moment no/every solution passes. *[contracts/economy]*
- **The Adversary (failure-injection opponent)** — An AI that, given your passing board, searches for the worst-case corner (tolerance, temperature, transient) that breaks it — gamifying the Monte-Carlo sweep as a duel against a saboteur. *[product-run / Monte-Carlo]*
- **Co-Designer (autocomplete for circuits)** — Type "I need to debounce this button" and the AI stamps a candidate sub-circuit *as an editable suggestion*; every suggestion is sim-validated before it's offered. Copilot for circuits. *[IC-maker / parts]*
- **Natural-Language HDL** — "Make a 4-bit counter that resets on overflow" → the AI emits visual-logic or HDL into the programmable-block tier, then the *sim* proves it meets the stated behavior. *[programmability tiers]*
- **Explain-My-Failure (post-mortem narrator)** — After a field failure, the AI writes the "8D root-cause report" *from the deterministic teardown fingerprint* — teaching the genre of real failure analysis. *[product-run]*
- **The Datasheet Oracle** — An AI you ask "what's a real part like this?" that maps your tier/variant choice to actual purchasable parts (Mouser/Digikey-style), closing the loop to the supply chain. *[tiers/variants + interchange]*

### D. Platform & shell

- **Installable Bench (PWA)** — Offline-first installable app — the whole thing is static wasm + web. The bench in your pocket, no account. *[platform]* **NEW**
- **Touch-First Lens** — A radial wiring gesture for touch (drag-to-wire, pinch-to-zoom between schematic/reality/analogy) so the three-lens system works thumb-first on a phone. *[lens system / UI]*
- **Gamepad Bench / Handheld/Deck Mode** — Controller support where the right stick is a *probe* and the triggers single-step/rewind time; a couch/handheld layout targeting Steam Deck. Electronics teaching as a console game is unclaimed. *[time transport / platform]*
- **Steam/Itch Native (Tauri)** — Wrap the same web app for a store presence; achievements map to Lab Notebook pages. *[native build / rewards]*
- **Watch/Widget Telemetry** — A glanceable widget showing your running *product fleet's* field-reliability (FIT/RMA ticking) — the idle/ambient layer of the factory loop. *[factory loop / product-run]*

### E. Out-of-band, social plumbing & business

- **Embeddable Bench `<iframe>`** — A one-line embed that drops a live, playable circuit into any blog/textbook page — the circuit *is* the figure, and it runs. The static-wasm bundle makes it trivial. *[CEC as a teaching platform]*
- **The Part-SDK (community parts)** — A typed manifest + drawer + optional sim-param mapping so the community authors *new tiers/variants/parts as config* ("a part is a stamp + a drawer + a row"); publish to the Exchange; the importer re-verifies. *[parts framework / Exchange]*
- **Mod/Plugin API (custom lenses & instruments)** — A sandboxed JS plugin surface that reads the once-per-frame snapshot and draws a *new instrument* (a custom scope, a thermal cam, an EMI heatmap) without touching the core. The coarse snapshot boundary is the natural seam. *[render frameworks / measurement]*
- **Behavioral-Block Marketplace** — Sell/share authored programmable blocks (firmware, visual logic, HDL) as parts — "npm for circuits" extended from passive chips to *behavior*. *[programmability tiers / Exchange]*
- **Determinism Bug Bounty** — A public "find a non-reproducible replay" channel — if two machines ever disagree, that's a determinism bug *and* a community sport. Crowd-sourced QA over the golden-hash discipline. *[determinism contract]*
- **CEC-Certified-as-a-Service** — A hosted endpoint that takes a published chip's manifest, re-runs the Monte-Carlo sweep server-side (same Rust core), and issues a signed certification badge — a real credential a portfolio could cite. *[product-run / certification]*
- **Localization Pipeline** — The HUD labels + Lab-Notebook prose are the only translatable surface (physics is language-free); a string-table + RTL layout makes this a genuinely global teaching tool. *[UI / teaching platform]*
- **Headless Grader Container** — A Docker/CLI image of the Rust core that CI / an autograder calls to grade thousands of replays in parallel, no browser — the browser-free, host-tested core *is already this*. *[grading / portability]*
- **Physical Spinoff: "Netlist" the Card Game** — A tabletop deck where cards are parts and the win is matching a spec card; a QR on each play *imports the dealt hand into the digital bench* to watch it run. Phygital bridge for computer-less classrooms. *[out-of-band]* **NEW**
- **Curriculum-as-Code Registry** — Teachers publish whole courses as dependency trees of contracts + standard-cell libraries (versioned, forkable, like a package); a "textbook" becomes an installable, runnable, gradeable artifact. *[classroom / Exchange / curricula]*

---

## VII. Wildcards — out of left field

### A. Embodied / inside-the-circuit framings

- **Inside the Wire (electron-scale walking sim)** — First-person: you ARE an electron (or a water droplet) drifting down the conductor, shoved by the field, queuing at a resistor's bottleneck, falling through a diode's one-way gate, recombining at an LED junction (and emitting the photon you see from outside). A ride-along through the circuit you built. The literal payoff of "make the invisible visible." *[reality/analogy carrier animation]*
- **Circuit Parkour / The Signal's-Eye Race** — A timed runner where you *are* the signal edge; gate delays are gaps to leap, a slow RC edge is mud, a race condition is a fork where the wrong path arrives late and you lose. Timing analysis as a platformer. *[digital timing / setup-hold]*
- **Body Electronics / You Are The Load (biofeedback)** — Players are nodes/loads driven by their own real signals — heart rate sets a current source, a phone mic modulates a rail — and a group collaboratively stabilizes a circuit whose sources are their living bodies. *[programmable-source parts + co-op]*
- **Two-Player Body Circuit / The Human Wire** — A party mode where two players each hold a probe and *are* the resistor between them (skin resistance), closing a loop; cooperate to hit a target by how you touch. The "sweaty palms" galvanic demo. *[body electronics, 2-player]*

### B. Living / growing / organic framings

- **Grow-a-Circuit (electronics-as-gardening)** — Plant a "seed" topology and tend it: it grows traces toward power/signal, you prune shorts and graft branches; a healthy circuit *blooms* (an LED flowers) while a starved one wilts. Pruning = removing a floating net. Topology edits as cultivation. *[place/wire loop + analogy lens]*
- **The Living Board (your design is an organism)** — Your circuit is a creature with metabolism (power = food), a heartbeat (clock), a nervous system (nets), an immune response (clamp parts that fire under stress); it must survive a "day" of temperature swings, brown-outs, ESD strikes. Death = magic smoke. Product-run reliability as a Tamagotchi. *[product-run + heat/ESD]*
- **The Circuit Aquarium / Ecosystem** — A shared tank where players' sealed circuits live as "fish" competing for a finite power budget on common rails; efficient designs thrive and reproduce (get used as dependencies), power-hogs starve. Watch the population evolve. *[dependency economy + shared-rail KCL]*
- **Circuit Genetics / Breeding** — Two parent circuits breed; the child inherits sub-blocks (sealed ICs as genes) with mutation jittering values; select offspring that best hit a spec, evolving toward a solution you didn't design. Deterministic grading is the fitness function. *[IC-seal-as-block + grader-as-fitness]*

### C. Time, dream & horror framings

- **Time-Travel Debugging / The Glitch Detective** — Rewind isn't just scrubbing — place "temporal probes" in the past, branch the timeline at a suspected glitch, and run two histories side by side to find the exact tick a metastable state diverged. A noir where the crime is a 4 ns glitch and the alibi is a deterministic replay. *[time-travel transport + debugging verb]*
- **The PSU's Nightmare (dreams/horror inside a failing supply)** — A surreal mode set *inside* a power supply as it fails: the rails are corridors that dim as the cap dries out, ripple becomes an arrhythmic heartbeat, the magic-smoke moment is the death/wake; you "repair the dream" by fixing the real circuit underneath. *[Ghost-in-the-Rails + PSU examples]*
- **Hauntology / The Board Remembers** — A roguelike where a board carries *scar-state* across runs: a once-overheated part is permanently weakened, an arced net is "cursed" with extra parasitic C; you inherit the ghosts of past failures, reproducible because determinism. *[board roguelike + wear-out, with memory]*
- **ASMR Bench / Slow-Sim Mode** — A zero-stakes ambient mode: ultra-slow tick, the camera drifting over glowing pipes, water trickling, the soft tick of a relay, no contracts, no timer — "lo-fi beats to solder to." A cap charging over a real-feeling 30 seconds is hypnotic. *[time transport + analogy lens]*

### D. Language, ritual & abstraction framings

- **Circuit-as-Spellcasting (electronics-as-magic)** — Parts as a magic system: a capacitor is a "mana battery," a diode a "one-way ward," an oscillator a "chant," a sealed IC a "bound spell"; contracts are quests phrased as enchantments. The physics stays rigorous; the *naming* lowers jargon intimidation for a fantasy audience. **NEW** (a thematic skin over the whole game)
- **The Circuit Language / Compose by Sentence** — *Describe* a circuit in a constrained grammar ("a 5 V rail feeds a divider into an op-amp follower") and the game compiles it into a netlist you watch run — teaching vocabulary by making words build hardware. *[programmability tiers, a natural-language rung above HDL]*
- **Electronics-as-Cooking / The Circuit Kitchen** — Parts are ingredients, a contract is a recipe with a target dish (spec), tiers are ingredient quality, and *heat is literal* — over/under-doing the thermal budget burns or undercooks the board. Makes the realism systems intuitive to a casual audience. *[BOM economy + heat]*

### E. Civilization, economy & scale framings

- **The Circuit MMO / A Shared Power Grid Nation** — Thousands of players' circuits hang off one persistent, continent-scale distribution network with real IR-drop and brown-out propagation; a factory in one region browns out a town in another, and players form "utilities" that sell stable power as a service. *[God-of-the-Grid + dependency economy, at MMO scale]*
- **The Standard-Cell Guild / Open-Source Drama** — A social mode gamifying the *governance* of a shared parts library: propose a canonical "standard cell," others review/fork/deprecate, the community votes a blessed library. The drama of maintainership, in silicon. *[Exchange remix/fork]*

### F. Pure-weird / contradictory

- **Schrödinger's Rail (the quantum-superposition lens)** — A node's value shown as a *probability cloud across the Monte-Carlo sweep* — the rail isn't 3.30 V, it's a smeared distribution that "collapses" to one value when you "ship" (pick a seed). Tolerance stack-up as superposition. *[Monte-Carlo / tolerance, as a probabilistic lens]*
- **The Circuit as a City (SimCity lens)** — The board as a city: rails are highways, ICs are districts, heat is pollution, EMI is noise pollution, signal congestion is traffic; zoning well = a livable city. *[IC-buildings / districts, scaled to urban planning]*
- **Reverse the Arrow of Time (run the sim backwards)** — Given the *final* state, reconstruct the input that produced it, scrubbing a deterministic replay backward — teaching that some circuits are reversible (lossless LC) and some aren't (the diode "forgets"). *[time transport + a real entropy lesson]*
- **Dream Logic / The Impossible-Component Sandbox** — A "what if" mode with physically-impossible idealized parts taken to absurdity — a negative resistor, a time-delay capacitor, a room-temp superconductor wire, a perfect diode — to build intuition by removing a constraint and seeing what breaks. The reality dial extrapolated *below rung 0* into fantasy physics. *[reality dial, extended into fiction]*
- **Tarot of Parts / The Daily Draw** — A daily creative prompt that deals 3–5 random parts + a one-line constraint ("make these light an LED, use no resistor") — a mystery-basket improv challenge. *[daily contract, constrained-improv variant]*
- **The Circuit You Fold (electronics-as-origami)** — The board is a flat sheet; folding it brings distant nets into contact (a connection where pads touch through the fold); route a 3D circuit by folding a 2D one — multilayer PCBs and via stitching as paper-folding. *[board graph + future board-layers surface]*

### G. Perception-as-debugging

- **Perfect-Pitch Debugging (the bench you diagnose by ear)** — A blind/eyes-closed mode where a fault announces itself *sonically* before visually — thermal runaway as a rising whine, coupling as a beating buzz, a brown-out as a sag in pitch. Learn to name the fault from its sound, the way real techs smell a burning resistor. *[Ghost-in-the-Rails, through the ear]*
- **Synesthesia Lens / Electronics-as-Weather** — Render the board as a landscape with weather: high current = wind, heat = sun/drought, EMI = static/lightning, a clean rail = clear sky, ripple = rain, a ground loop = a recurring storm front. You "read the forecast" of your circuit. *[heat + EMI lenses, fused]*

---

## VIII. Constellations — ideas that want to combine

Affinity clusters, still unfiltered. Each names a bigger direction several ideas snap into.

1. **The Moving Bench (a whole physical-state expansion).** *The mechanical node* + Torque Bench + Speaker/Voice Coil + Relay-with-real-dynamics + Solenoid + MEMS accel + the Robotics Yard world + Circuit Parkour. One new state-integrator (rotational/linear velocity, the thermal companion pattern) makes the board *move, spin, and seat* — and the most-requested missing sensation in the genre.

2. **The Bench You Hear.** *The Ear Lens* + Distortion/FFT Scope + Synthwave Foundry + Synthesizer Bench + Demoscene Board + Frequency-Domain Ear Training + Perfect-Pitch Debugging + Sonification accessibility + the Speaker part. Audio is nearly free (the waveform exists), it's the most visceral "make the invisible sensible" channel, and it doubles as both an instrument-to-play and a diagnostic-to-listen-to.

3. **Determinism-as-Genre.** *Glitch Hunt / Time-Travel Debugging* + the Slow-Mo Knob + Time-to-Failure Scrubber + Replay Theater (seizable state) + Hash Hunt + Determinism Dares + Seeded Everything + the Replay Codec + Reverse-the-Arrow. Everything that turns "a circuit is a reproducible seed" into a game mechanic, a spectator format, a teaching tool, and a forensic verb.

4. **The Black-Box Detective.** *The Junk Drawer (procedural)* + Signal Wordle + Blind Pinout + The Decapsulation Lens + Honeypot Chips + Differential Teardown + Reverse Datasheet + Datasheet Forensics + The Alien Artifact + the Chip Museum to display the catch. The seal mechanic run backward as an infinite, fair, self-generating content engine.

5. **The Living Reliability World.** *ENTROPY-as-antagonist* + The Living Board (Tamagotchi) + Hauntology (scarred boards) + One-Board Permadeath + Electromigration Clicker + Thermal Survival + the Recall Crisis/Ticker + Insurance & Warranties + the Pacemaker/Rover worlds. The product-run reliability backlog given a villain, a pet, a wound, and a derivatives market.

6. **The Honest Marketplace.** *Datasheet Reputation (VERIFIED/FRAUDULENT)* + Pin-Compatible Standard + BOM Royalties + Obsolescence/EOL + The Errata Page + Counterfeit Marketplace + Patent/Prior-Art + The Living Standard + Generational Foundry + Component Futures. The Bench Exchange grown into a full economy with honesty stakes, lifecycle risk, standards politics, and speculation.

7. **The Graduation Bridge (game → real bench).** *Export-to-KiCad* + Order-the-PCB + Twin Bench (Arduino-in-the-loop) + Ghost Multimeter + Breadboard Mirror + Bring-Your-Own-Datasheet + SPICE Bridge + the Bounty Bridge + "Netlist" the card game. The entire thesis ("this teaches *real* electronics") made literally true — your in-game design becomes a netlist, a board on your desk, or a real MCU blinking a real LED.

8. **The 2-Sigma Tutor.** *The Bench Buddy (grounded Socratic AI)* + Rubber-Duck Probe + Hint Ladder + "Explain it back" Gate + AI Contract Author + AI Director + the Wager Strip + Misconception Probes + KCL/KVL X-Ray + the Derivation Ladder. An AI that is constitutionally unable to hallucinate physics (the sim is ground truth) plus the predict/derive/refute lenses that make every run a learning act.

9. **The Time Machine of Electronics.** *The Timeline Bench* + the Vacuum-Tube Wing + The Relay Computer Vault + Moore's Law Treadmill + Cat's-Whisker Dawn + the Tube Lens + the 555 Cathedral / 741 Teardown / 6502 Datapath rebuilds + the Datasheet-Codex-as-Lore + Etymology Mode + the Silicon Hall of Fame. The era tree turned into a traversable history of how humanity figured it out, with every breakthrough a rebuildable bench.

10. **The Constraint Dojo.** *No-ICs Monastery* + One Rail + Five Parts + Component Famine + The Junk Drawer (run) + Blind Build + Whisper Mode + Estimate-First + Lens-Locked + Ascension Rails + Mode Mutators. The cheapest, highest-teaching cluster — each a gate flip on `buildNetlist` or the bin, each turning one spec into bottomless puzzle replay under a vow.

11. **The Board Becomes a World.** *Power District (city-builder)* + The Circuit as a City + the Circuit MMO grid nation + Bench Real Estate + The Circuit Aquarium + the Archaeology Server + Firms & the Org Chart + Trophy Benches. Layout quality (signal/power/thermal/EMI integrity) re-skinned as a livable, social, shared *place*.

12. **The Sense Stack (new perceptual lenses).** *KCL/KVL X-Ray* + Field Lens + Heat-Flow Lens + Electron-Pressure Heatmap + Charge-Carrier Microscope + Impedance Terrain + the Sankey energy-flow lens + Schrödinger's Rail + the Weather re-skin + Dueling-Lenses split-screen + Inside the Wire. Every new way to *see* the same honest solve — the project's pillar, pushed to its limit.

---

## IX. The wildest 25 (for the grounding panel to react to)

A flat cross-domain pull — the boldest, weirdest, most contradictory, hand-picked to provoke. No ranking.

1. **Romancing the Components (dating sim)** — Component families are characters with personalities drawn from real physics (the Electrolytic ages badly, the Schottky is fast-but-leaky, the Op-Amp is needy about feedback); the affection meter *is* the safe operating area, the portraits *are* the five-tier glyphs. Absurd, and the teaching payload is honest. **NEW (deliberately weird)**
2. **Inside the Wire** — A first-person walking sim where you *are* an electron, driven by the local field through bottlenecks and one-way gates. *[carrier animation]*
3. **The Board Is A Synth / The Ear Lens** — Sonify the live solve; hear the rail sag, the ground-loop hum, the metastable flip-flop scream. *[scope → audio]*
4. **ENTROPY as the antagonist** — The second law of thermodynamics personified as the villain of every reliability system. *[product-run + failure codex]*
5. **Insurance & Warranties** — A derivatives market where you underwrite (and trade) field-failure risk on your own and others' designs, priced off the deterministic FIT model. *[product-run]*
6. **The Replay Theater (seizable world state)** — Watch a master stream, then grab their live board at frame 4000 and probe/fork it yourself. *[replay]*
7. **Order-the-PCB** — One button turns your in-game design into a physical board that arrives in the mail. *[SHIP IT]*
8. **The PSU's Nightmare** — A surreal horror mode set *inside* a failing power supply you repair by fixing the real circuit underneath. *[Ghost-in-the-Rails]*
9. **Circuit-as-Spellcasting** — Re-skin the whole game as a magic system (mana batteries, one-way wards, bound spells) to disarm jargon for a fantasy audience. **NEW**
10. **The Circuit Aquarium** — A shared tank where players' sealed chips live as fish competing for a finite power budget; the efficient breed, the hungry starve. *[dependency economy + shared-rail KCL]*
11. **Schrödinger's Rail** — Show a node as a probability cloud across the tolerance sweep that "collapses" to one value when you ship. *[Monte-Carlo lens]*
12. **The Circuit You Fold** — Route a 3D multilayer circuit by *folding a 2D sheet* so distant pads touch. *[board graph]*
13. **Twin Bench (Arduino-in-the-loop)** — A real MCU's physical pins drive sim nets; the game-vs-bench gap collapses because "domains meet only at the pins." *[multi-rate]*
14. **Time-Travel Debugging (branching timelines)** — Place temporal probes in the past, fork the timeline at a glitch, diff two histories to pin the exact tick it was born. *[time transport + debugging]*
15. **Circuit Genetics / Breeding** — Breed two parent circuits (sealed ICs as genes, value jitter as mutation); evolve toward a spec by selecting offspring. *[seal-as-block + grader-as-fitness]*
16. **The Slow Cap (idle)** — An entire incremental game that is one giant capacitor charging on a multi-hour RC curve; spend the charge to buy bigger caps. **NEW**
17. **Body Electronics** — Players are loads driven by their own heart rate / mic level; a group stabilizes a circuit whose sources are their living bodies. *[programmable sources + co-op]*
18. **The Anti-Bench (build the WORST circuit)** — Inverted contracts: maximize ripple, waste the most heat, build the loudest EMI transmitter — you can't sabotage what you don't understand. *[contract grader, inverted]*
19. **Electronics-as-Cooking** — Parts are ingredients, the contract is a recipe, the thermal budget is a literal oven that burns or undercooks the board. *[BOM + heat]*
20. **The Circuit MMO / Shared Power Grid Nation** — A continent-scale persistent grid with real IR-drop where one region's factory browns out another's town. *[God-of-the-Grid, MMO scale]*
21. **The Memristor / 4th-element sandbox** — A resistance that remembers total charge (`R(q)`), with a pinched-hysteresis I-V loop as its own scope signature. *[nonlinear companion with hashed state]*
22. **Reverse the Arrow of Time** — Run the sim backward from a final state to reconstruct the input — teaching reversibility (LC) vs irreversibility (the diode forgets). *[time transport]*
23. **The Decapsulation Lens** — Acid-etch a *competitor's* published chip to reveal its die — but only after you've proven you understood it by behavioral teardown. *[teardown + zoom-to-open]*
24. **The Tube Lens** — A glowing-filament thermionic-valve world with a heater warm-up pre-roll, Child-Langmuir plate curves, and soft-clipping harmonics you can hear. *[Newton companion + heat + audio]*
25. **Hash Hunt** — A daily target to build *any* circuit whose deterministic snapshot-hash satisfies a property (lands in a band, or "spells" something) — pure determinism play, wildly shareable. **NEW (consumes the FNV-1a hash)**

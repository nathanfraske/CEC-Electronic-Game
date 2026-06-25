<!-- SPDX-License-Identifier: Apache-2.0 -->

# Product-run reliability & certification — ideation

> **STATUS — discussed + agreed with the owner (2026-06-24).** This is the canonical home for a large
> slice of the "realism" backlog. **Pointer for future agents:** the owner and I decided that the
> *statistical / funded / time×scale* non-idealities (solder-joint quality, ESD survival, electrolytic
> wear-out, tolerance stack-up, derating margin, counterfeit parts, …) are a **better fit as
> production-run / field-reliability outcomes** than as per-instance bench glitches. The *instant,
> visible* effects (heat, EMI, parasitics, over-current FAIL, slew, saturation) stay at the **bench**.
> Certification (FCC EMI, UL/safety) is a **gate**. When you pick up a realism item, decide which of the
> three rails it belongs to (see §3) before implementing. Companions:
> `docs/invisible-electronics-ideation.md`, `docs/heat-on-the-board-ideation.md`,
> `docs/ic-package-density-ideation.md`, `docs/game-rewards.md`, `docs/game-contracts-economy.md`,
> `docs/game-progression.md` (Era 6).

## 1. The framing — realism is two different games + a gate

The ideal sim answers "does my prototype *work*." Real engineering also asks "will N units *survive*
manufacturing and the field for years," and "can I even legally *ship* it." Split realism accordingly:

- **Bench realism** (instant, visible, on the one prototype): heat glow + thermal smoke, the EMI lens,
  over-current FAIL, slew-rate limiting, saturation, parasitics, the two frequency regimes. *You see and
  fix these at the desk.* (Owned by the heat / invisible-electronics / parasitics systems.)
- **Production-run realism** (statistical, over time × scale, on the fielded fleet): solder-joint quality,
  ESD survival, electrolytic wear-out, tolerance stack-up, thermal/voltage **derating margin**, counterfeit
  parts. *These are un-fun as per-bench glitches but perfect as fleet outcomes.* **This doc owns these.**
- **Certification gates** (pass to ship): FCC/CISPR EMI, UL/CE safety. *Fail and you can't ship — respin
  or redesign.* The labs are where the invisible-electronics map cashes out.

The key insight (the owner's): you don't simulate a cold solder joint on the bench — you **ship a product
run** and it reports how many units failed, got RMA-ed, or triggered a recall, as a function of how you
designed and how much quality you funded.

## 2. The mechanic — submit a contract → labs → production run → outcome

On **contract submission** (the existing deterministic graded replay is the judge):

1. **Certification gates (pass/fail to ship).**
   - **FCC/CISPR EMI chamber:** the emissions estimate (from the invisible-electronics EMI estimator) vs a
     limit line. Fail → you can't ship until you fix grounding / shielding / slew / spread-spectrum, or
     pay for a **respin**.
   - **UL / safety:** over-temperature, fusing/protection present, isolation/creepage. Fail → blocked.
   - Gates are **explicit lab fees + time** (a real cost) and produce a **report** (which limit you bust,
     by how much) so the player knows what to fix.

2. **The production run (yield + field life).** A reliability model reads the design's **actual measured
   margins from the graded replay** + the **funded quality level** + the **contract's stress profile**
   (ambient, duty, life-years, unit volume) and produces:
   - **Yield %** — units that pass end-of-line test (tolerance stack-up, funded test coverage, solder QA).
   - **Field-failure rate (FIT / MTBF)** over the contract's life — driven by derating headroom, thermal
     stress, wear-out (electrolytics), ESD exposure, protection present.
   - **RMAs** — failures that come back (Credits + reputation hit).
   - **Recall** — a *systemic* flaw (a part run past safe derating fleet-wide, a missing protection diode, a
     failed-but-shipped margin) trips a mass recall: big Credit hit + reputation crater. The company-scale
     "magic smoke" moment.

3. **Outcome → economy.** Units shipped × margin − scrap − RMAs − recalls = **profit/loss**; clean designs
   earn **reputation** (better contracts, higher multipliers, **Lux**). Reputation is the long-game stake.

## 3. Reorganizing the realism backlog onto the three rails

| Realism item | Rail | How it manifests |
| --- | --- | --- |
| Heat / thermal smoke, EMI/crosstalk, parasitics, slew, saturation, over-current FAIL | **Bench** | live on the prototype (existing/ideation systems) |
| **Solder-joint quality** | Production input | fund reflow/AOI QA ↓ → infant-mortality / cold-joint field failures |
| **ESD survival** | Production input | placed ESD protection? → field-zap failure rate |
| **Electrolytic wear-out / aging** | Production input | hot, under-derated caps → year-2+ field failures |
| **Tolerance stack-up / matching** | Production input | drives **yield** + spec-margin field failures |
| **Thermal / voltage DERATING MARGIN** | Production input | the master knob — measured headroom sets FIT directly |
| **Counterfeit parts** | Production input | cheap supplier → batch underperformance / early failure |
| **FCC/CISPR EMI** | **Gate** | the emissions test you must pass to ship |
| **UL / safety (overtemp, fusing, isolation)** | **Gate** | safety cert to ship |
| Fuses, latch-up | Bench *and* production | a bench failure mode AND a fielded protection input |

This is cleaner and more *fun* than scattering each as a bench glitch: most become a **design-for-reliability
budget decision** (derate, protect, certify, fund quality) with a legible economic payoff.

## 4. Determinism & golden-safety (the load-bearing constraint)

The field-reliability outcome MUST be a **pure deterministic function** of the design + contract:
`outcome = f(measured margins, protection parts present, certification results, funded-quality level,
contract stress profile)`, **seeded off the design hash** — never `Math.random()` / wall-clock. So:

- A given design always yields the same yield / RMA / recall numbers → **fair, replayable, no save-scumming**
  (matches `game-rewards.md`'s "deterministic graded replay is the only judge").
- The model reads **already-deterministic, unhashed outputs** — the measured `Tj` headroom, the measured
  emissions estimate, the measured spec margins from the graded replay (the same `element_currents` /
  `node_v` the renderer already reads). **Zero sim-core change; the golden cannot move.** It's a web-side
  economy/game-state layer on top of the existing replay, exactly like the contract grader.
- The "roll" is a deterministic hash-seeded distribution sample (e.g. a Poisson field-failure count from a
  FIT derived from margins), not RNG — reproducible across machines.

## 5. The reliability model (first cut)

A transparent, teachable first-order model (datasheet-grade, like the heat model):
- **Per-part stress ratio** `s = applied / rated` for each stressor (current, voltage, power/temp), measured
  off the replay. Derating curve: FIT rises steeply as `s → 1` (the Arrhenius/derating intuition).
- **Wear-out** for electrolytics: a life consumed ∝ time × Arrhenius(temp) — under-derated + hot = short life.
- **Funded-quality multiplier** on infant-mortality (solder/test/screening budget you allocate).
- **Protection gates**: ESD/over-V/reverse — present? → that failure mode's rate collapses.
- **Aggregate** to a fleet FIT → expected field failures over the contract life × volume → RMA count →
  recall trigger if a single systemic stressor exceeds a threshold fleet-wide.

Keep it **legible** (the player can see "this cap at 95% rating @ 70 °C → 3-year life → 8% field failures"),
so it *teaches derating* rather than being an opaque dice roll.

## 6. Phased build path

1. **The outcome report (no new physics).** Submit → read the existing measured margins → a simple FIT model
   → a **production-run report card** (yield, field-failure %, RMAs, profit/loss). Ships on the contract
   spine; zero sim-core change. Proves the loop.
2. **Funded quality + protection inputs.** A pre-ship budget allocation (solder/test/screening) + recognizing
   placed protection parts (ESD/fuse/reverse) → they move the report numbers. The design-for-reliability game.
3. **Certification gates.** The FCC EMI lab (needs the invisible-electronics EMI estimator) + UL/safety;
   pass-to-ship + a fix-it report. Ties the EMC map to a concrete consequence.
4. **Reputation + recalls.** The systemic-flaw recall, reputation track, and its feedback into contract
   access / multipliers / Lux. The long-game stakes.
5. **Richer reliability.** Wear-out curves, counterfeit-supplier risk, tolerance-driven yield (Monte-Carlo
   over the deterministic seed), MTBF contracts ("ship 10k units, < 1% return at 5 years").

## 7. Recommendation

Build **Phase 1 — the production-run report card** first: it's pure web-side economy reading the margins the
graded replay already produces, so it's golden-safe and small, and it *immediately* reframes every "realism"
choice (derate, protect, certify, fund quality) as a legible profit/reliability tradeoff. Then layer funded
quality + protection (Phase 2) and the FCC/UL gates (Phase 3) — at which point the heat, density, and
invisible-electronics systems all pay off through *one* consequence surface (the fleet's fate) instead of a
dozen disconnected bench glitches.

One-liner for the owner: **"You don't simulate a bad solder joint — you ship a product run, and it tells you
how many came back. Derate, protect, certify, and fund quality, or eat the RMAs and the recall."**

---

## 8. Buildable expansion (2026-06-25)

This ideation is operationalized into a buildable design in **`docs/game-product-simulation.md`** — concrete
formulas (the stress-ratio → derating → Arrhenius → fleet-FIT → RMA → recall chain), the two cert labs (FCC/CISPR
EMI + UL safety as a `margin = limit − measured` service with a ranked fix-it report), the RMA/recall/reputation
economy (reputation is a *stake*, not a third currency), the **all-ages teaching bridge** (the fidelity ladder
"bench works → ship a run → 8 of 100 came back / failed EMI", the Probe narrating a recall, an all-ages by-feel
**fleet-grid**), a determinism/golden-safety proof (a hash-seeded distribution sample over the existing unhashed
margins, canonical draw order, zero sim-core change), and a phased build path (**Phase-1 report card ships on
heat + ratings alone**, no EMI kernel). Read this doc for the *why*/framing; that one for the *how*.

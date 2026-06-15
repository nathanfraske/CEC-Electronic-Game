// SPDX-License-Identifier: Apache-2.0
// First-encounter concept cards — the pull-based onboarding's "learn as you explore"
// layer (docs/ui/onboarding-first-run.md §10). Each card fires ONCE, the first time
// the board can demonstrate the concept true (you place a source, you close a loop,
// you read a part), gated behind the single `explainAsYouGo` mute. It is not a rail:
// the order is emergent from what the player does, the sandbox is never gated, and an
// expert simply mutes it. Content only — the trigger logic + dedupe live in App.svelte
// (they read app state) and the `seenConcepts` set persists which have fired.

export interface ConceptCard {
  /** Stable id, persisted in `seenConcepts` so each fires exactly once. */
  id: string;
  /** One short clause — what it is. */
  title: string;
  /** One or two sentences — named on the live picture, never a wall of text. */
  body: string;
}

/** The core just-in-time concepts, keyed by id. Triggers (App.svelte) decide *when*
 * each is offered; this is only *what* they say. Kept number-free and brief. */
export const CONCEPTS: Record<string, ConceptCard> = {
  source: {
    id: "source",
    title: "Voltage — the push",
    body: "A source is a pump: it makes a voltage, an electrical pressure. Nothing flows yet — current needs a complete loop to go around.",
  },
  ground: {
    id: "ground",
    title: "Ground — the zero",
    body: "Ground is the reference everything is measured against: 0 V. Every other voltage is really a difference from here.",
  },
  loop: {
    id: "loop",
    title: "A circuit is a loop",
    body: "Current only flows around a complete loop. The moving arrows are the current; the wire's colour is its voltage — high to ground.",
  },
  reading: {
    id: "reading",
    title: "Reading a part",
    body: "The live numbers are what's happening to this part right now — the volts across it and the amps through it. The picture and the numbers are one fact.",
  },
};

/** Stable display order, so a replay walks them in a sensible sequence. */
export const CONCEPT_ORDER = ["source", "ground", "loop", "reading"];

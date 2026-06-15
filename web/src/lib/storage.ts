// SPDX-License-Identifier: Apache-2.0
// Client-side persistence. The board state (so a refresh keeps your circuit) and a
// small progress/settings blob (onboarding flags, completed examples, …) live in
// localStorage — NOT cookies: this is purely client state, it never needs to reach a
// server, and localStorage isn't capped at a few KB or sent on every request. Every
// read is guarded so a corrupt or stale blob (e.g. a schema change) degrades to "no
// saved state" rather than throwing.

import type { GraphSnapshot } from "./graph";

const BOARD_KEY = "cec.board.v1";
const SETTINGS_KEY = "cec.settings.v1";

/**
 * Persisted progress / preferences. Versioned so a future shape change can be
 * detected and reset rather than mis-parsed. Onboarding and the progression will add
 * fields here (seen concepts, completed contracts, the "explain as I go" mute, …);
 * for now it carries the version and a free-form bag those features can write into.
 */
export interface Settings {
  /** Schema version; bump when the shape changes incompatibly. */
  v: number;
  /** First-run cold open has been shown. */
  seenIntro?: boolean;
  /** Whether the as-you-go explanation cards are enabled (the only onboarding mute). */
  explainAsYouGo?: boolean;
  /** Ids of one-time concept cards already shown, so each fires once. */
  seenConcepts?: string[];
}

const SETTINGS_VERSION = 1;
const DEFAULT_SETTINGS: Settings = { v: SETTINGS_VERSION };

function available(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

/** Persist the board, swallowing quota/serialization errors (a failed save must
 * never interrupt editing). */
export function saveBoard(snapshot: GraphSnapshot): void {
  if (!available()) return;
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota exceeded or private-mode write block — fine, just don't persist.
  }
}

/** The last saved board, or `null` if there is none / it's unreadable. Validated
 * lightly (it must look like a snapshot with a components array). */
export function loadBoard(): GraphSnapshot | null {
  if (!available()) return null;
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as GraphSnapshot;
    if (!obj || !Array.isArray(obj.components) || !Array.isArray(obj.wires)) {
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}

/** Load the settings blob, falling back to defaults on absence/corruption or a
 * version mismatch (a changed schema resets rather than mis-reads). */
export function loadSettings(): Settings {
  if (!available()) return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const obj = JSON.parse(raw) as Settings;
    if (!obj || obj.v !== SETTINGS_VERSION) return { ...DEFAULT_SETTINGS };
    return obj;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  if (!available()) return;
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...s, v: SETTINGS_VERSION }),
    );
  } catch {
    // ignore
  }
}

/** Wipe the saved board AND all progress/settings — the "reset progress" action (for
 * testing, and for a player who wants a clean slate). */
export function resetAll(): void {
  if (!available()) return;
  try {
    localStorage.removeItem(BOARD_KEY);
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // ignore
  }
}

/**
 * A trailing-edge debounced wrapper around {@link saveBoard}: rapid edits (dragging a
 * value, nudging a part) collapse into one write a short time after they stop, so we
 * don't thrash localStorage on every frame of an interaction.
 */
export function makeDebouncedBoardSaver(
  delayMs = 400,
): (snap: GraphSnapshot) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: GraphSnapshot | null = null;
  return (snap: GraphSnapshot) => {
    pending = snap;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (pending) saveBoard(pending);
      pending = null;
      timer = undefined;
    }, delayMs);
  };
}

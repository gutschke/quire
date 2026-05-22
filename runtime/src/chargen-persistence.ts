/**
 * CC-11 (M4 char-creation): persistence layer for in-progress
 * chargen state on the player's device.
 *
 * Today's implementation uses localStorage; the F3 critique
 * disposition recommended IndexedDB for the chargen state because
 * it's more capacious and structured, but localStorage is enough
 * for v1 — the chargen answers + path are < 8 KB even with
 * verbose short-answer responses.  TODO: migrate to IndexedDB
 * when a future feature (per-PC pre-gen library, multi-PC
 * persistence) needs the room.
 *
 * **Keying strategy** (F3 critique disposition):
 * `quire.chargen.<campaignSlug-sanitized>:slot<N>` — slug-and-slot,
 * NOT token-based.  When the DM regenerates a player's invite token
 * (CC-12 follow-on), the player's in-progress data isn't orphaned
 * because the key doesn't depend on the token UUID.  Slot
 * reassignment (CC-32 in the rebinding bucket) is the explicit
 * clear path.
 *
 * **What's persisted:**
 *   - chosenPath (qa / free-write / pre-gen / empty)
 *   - answers (the player's Q&A responses)
 *
 * **What's NOT persisted:**
 *   - currentStep (the player can advance steps on resume; the
 *     content carries them forward).
 *   - packFeedback (transient UI state).
 *
 * Pure data layer — no DOM, no UI dependency.  Caller (QuireApp)
 * wraps with debouncing + lifecycle hooks.
 */

export const CHARGEN_STORAGE_PREFIX = 'quire.chargen.';

export interface ChargenPersistedState {
  chosenPath: 'qa' | 'free-write' | 'pre-gen' | '';
  answers: Record<string, string>;
  /**
   * Epoch ms of last write — useful for "resumed N minutes ago"
   * UX and for stale-data detection (e.g., the campaign changed
   * its question schema after the player started).
   */
  updatedAt: number;
}

/**
 * Compute the storage key for a given campaign + slot.  Slug is
 * sanitized for filesystem-safe characters; slot must be in [1, 9].
 */
export function chargenStorageKey(
  campaignSlug: string,
  slot: number
): string {
  if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
    throw new Error(`Chargen slot must be in [1, 9]; got ${slot}`);
  }
  const safe = campaignSlug.replace(/[^A-Za-z0-9_-]/g, '-');
  return `${CHARGEN_STORAGE_PREFIX}${safe}:slot${slot}`;
}

/**
 * Save the chargen state.  Silent on localStorage failure
 * (quota exceeded, sandboxed context, etc.) — the player should
 * still be able to use the "Pack my character" download as a
 * backup; we don't want a quota error to block the chargen flow.
 */
export function saveChargenState(
  campaignSlug: string,
  slot: number,
  state: Omit<ChargenPersistedState, 'updatedAt'>,
  nowMs?: number
): void {
  let key: string;
  try {
    key = chargenStorageKey(campaignSlug, slot);
  } catch {
    return;
  }
  const doc: ChargenPersistedState = {
    chosenPath: state.chosenPath,
    answers: { ...state.answers },
    updatedAt: nowMs ?? Date.now()
  };
  try {
    const json = JSON.stringify(doc);
    window.localStorage?.setItem(key, json);
  } catch {
    /* quota / sandbox / SSR — silent no-op */
  }
}

/**
 * Load the chargen state for this campaign + slot.  Returns null
 * when:
 *   - localStorage is unavailable (SSR / sandbox).
 *   - No entry exists for this key (first visit).
 *   - The stored value is corrupt (JSON parse failure or wrong
 *     shape) — corruption is treated as "no entry" so a broken
 *     entry doesn't permanently block the player.
 */
export function loadChargenState(
  campaignSlug: string,
  slot: number
): ChargenPersistedState | null {
  let key: string;
  try {
    key = chargenStorageKey(campaignSlug, slot);
  } catch {
    return null;
  }
  let raw: string | null;
  try {
    raw = window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const p = parsed as Record<string, unknown>;
  // Shape validation: tolerate missing fields with sensible defaults
  // so older / partial entries from a future-V1 schema migration
  // don't throw out the user's data.
  const chosenPath =
    p.chosenPath === 'qa' ||
    p.chosenPath === 'free-write' ||
    p.chosenPath === 'pre-gen' ||
    p.chosenPath === ''
      ? p.chosenPath
      : '';
  const answersIn =
    p.answers && typeof p.answers === 'object' && !Array.isArray(p.answers)
      ? (p.answers as Record<string, unknown>)
      : {};
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(answersIn)) {
    if (typeof v === 'string') answers[k] = v;
  }
  const updatedAt =
    typeof p.updatedAt === 'number' && Number.isFinite(p.updatedAt)
      ? p.updatedAt
      : 0;
  return { chosenPath, answers, updatedAt };
}

/**
 * Clear the chargen state for this campaign + slot.  Used by the
 * DM-side slot reassignment flow (CC-32 — future) when a player's
 * seat gets transferred / retired.  Silent on failure.
 */
export function clearChargenState(
  campaignSlug: string,
  slot: number
): void {
  let key: string;
  try {
    key = chargenStorageKey(campaignSlug, slot);
  } catch {
    return;
  }
  try {
    window.localStorage?.removeItem(key);
  } catch {
    /* silent */
  }
}

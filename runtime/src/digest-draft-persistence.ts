/**
 * Run #15 (UX-5 per ttrpg-ux-expert v2 Q8 P1): persistence layer
 * for the in-progress DM session-digest draft.
 *
 * Mirrors the chargen-persistence pattern (see `chargen-persistence.ts`)
 * because the failure mode is identical: a multi-hour session ends,
 * the DM opens the wrap surface, types the recap, switches tabs to
 * grab a name — tab dies — draft lost.  Both surfaces have the same
 * shape (textarea bound to `@state`); both want a localStorage
 * autosave that survives tab close + reopen.
 *
 * **Keying strategy:** `quire.digest-draft.<campaignSlug-sanitized>`.
 * Per-campaign, since the DM may be in mid-wrap on multiple
 * campaigns in different tabs.  Slug, not sessionStartTs, so a
 * reload during wrap resumes the same draft.
 *
 * **What's persisted:** the draft markdown + the `generatedByResponseId`
 * (so a saved AI provenance tracer survives reload too).
 *
 * **What clears the draft:**
 *   - Save (host clears via clearDigestDraft after the event lands).
 *   - Discard (component clears local state + this).
 *
 * Pure data layer — no DOM, no UI dependency.  The host wires the
 * slug + the component owns load/save via lifecycle hooks.
 */

export const DIGEST_DRAFT_STORAGE_PREFIX = 'quire.digest-draft.';

export interface DigestDraftPersistedState {
  markdown: string;
  /** AI responseId that drafted the markdown.  Optional. */
  generatedByResponseId?: string;
  /** Epoch ms of last write. */
  updatedAt: number;
}

export function digestDraftStorageKey(campaignSlug: string): string {
  const safe = campaignSlug.replace(/[^A-Za-z0-9_-]/g, '-');
  return `${DIGEST_DRAFT_STORAGE_PREFIX}${safe}`;
}

/**
 * Save the digest draft.  Does NOT throw on localStorage failure
 * (quota / sandbox / SSR).  Returns true when the write reached
 * localStorage, false otherwise.  Same contract as chargen-
 * persistence.saveChargenState.
 */
export function saveDigestDraft(
  campaignSlug: string,
  state: Omit<DigestDraftPersistedState, 'updatedAt'>,
  nowMs?: number
): boolean {
  let key: string;
  try {
    key = digestDraftStorageKey(campaignSlug);
  } catch {
    return false;
  }
  const doc: DigestDraftPersistedState = {
    markdown: state.markdown,
    generatedByResponseId: state.generatedByResponseId,
    updatedAt: nowMs ?? Date.now()
  };
  try {
    const json = JSON.stringify(doc);
    const ls = window.localStorage;
    if (!ls) return false;
    ls.setItem(key, json);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the digest draft for this campaign.  Returns null when:
 *   - localStorage unavailable.
 *   - No entry exists.
 *   - Stored value is corrupt (JSON parse failure / wrong shape).
 */
export function loadDigestDraft(
  campaignSlug: string
): DigestDraftPersistedState | null {
  let key: string;
  try {
    key = digestDraftStorageKey(campaignSlug);
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
  const markdown = typeof p.markdown === 'string' ? p.markdown : '';
  // Tolerate missing entry shape; drop drafts whose markdown didn't
  // survive serialization rather than throw out the whole record.
  if (markdown.length === 0) return null;
  const generatedByResponseId =
    typeof p.generatedByResponseId === 'string'
      ? p.generatedByResponseId
      : undefined;
  const updatedAt =
    typeof p.updatedAt === 'number' && Number.isFinite(p.updatedAt)
      ? p.updatedAt
      : 0;
  return { markdown, generatedByResponseId, updatedAt };
}

/**
 * Clear the digest draft for this campaign.  Used by the host's
 * Save handler after the `session-digest` event lands AND by the
 * Discard button.  Silent on failure.
 */
export function clearDigestDraft(campaignSlug: string): void {
  let key: string;
  try {
    key = digestDraftStorageKey(campaignSlug);
  } catch {
    return;
  }
  try {
    window.localStorage?.removeItem(key);
  } catch {
    /* silent */
  }
}

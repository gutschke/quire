/**
 * M5 (2026-05-29 save-restore program) — Recently-played campaign
 * discovery for the no-campaign landing.
 *
 * Scans `localStorage` for keys with the `quire.save.` prefix used by
 * `AutosaveController`, parses each entry as a `SaveDocument`, and
 * returns a sorted-most-recent-first list with:
 *
 *   - The campaign ref (owner/repo) extracted from the save doc.
 *   - The save's `savedAt` ISO timestamp (used for sort + display).
 *   - The event count (rough "how much campaign is in here?" hint).
 *
 * The TTRPG-UX-strategy resume-prompt design (per `ux-strategy.md`)
 * wants:
 *   - Last-revealed scene title.
 *   - PC names.
 *   - Session-digest headline.
 *
 * Cheap-and-cheerful subset shipped here: campaign owner/repo + last-
 * played-ago. The scene/PC/digest enrichment requires materializing
 * the events, which is more expensive than scanning localStorage —
 * defer to the resume-prompt path (the landing list shows lighter-
 * weight metadata).
 *
 * Silent-player firewall preservation: a player's stripped autosave
 * is a valid SaveDocument with `campaign` field intact, so the
 * landing surfaces "Underleaf — played 3 weeks ago" identically for
 * DM and player. No DM-only data leaks through this path because
 * `serializeSessionForViewer` ran at SAVE time.
 *
 * Storage shape (per `AutosaveController.storageKey`):
 *   `quire.save.<owner>-<repo>`
 *
 * NOTE the dash separator collapses `owner-repo` into one token; we
 * read the canonical owner/repo from the parsed `SaveDocument.campaign`
 * field rather than re-parsing the key. The key just tells us
 * something is there.
 */

import {
  parseSaveDocument,
  type CampaignRef,
  type SaveDocument
} from '../persistence';
import { SAVE_STORAGE_PREFIX } from './autosave-controller';

export interface RecentCampaign {
  campaign: CampaignRef;
  savedAt: string;
  eventCount: number;
  /**
   * The raw localStorage key (used by the UI's "remove from list"
   * action if we ever build one).
   */
  storageKey: string;
}

/**
 * Read all `quire.save.*` entries out of localStorage and return them
 * sorted most-recent-first. Bad parses are silently skipped (the
 * landing should never crash because one stale entry is malformed).
 *
 * Returns an empty array when:
 *   - localStorage is unavailable (sandboxed iframe / SSR).
 *   - No `quire.save.*` keys exist.
 *
 * Bounded by `limit` (default 5 per ux-strategy.md).
 */
export function listRecentCampaigns(
  storage: Storage | undefined = typeof window === 'undefined'
    ? undefined
    : window.localStorage,
  limit: number = 5
): RecentCampaign[] {
  if (!storage) return [];
  const found: RecentCampaign[] = [];
  let i = 0;
  // Iterate by index; Storage doesn't have an entries() iterator.
  try {
    for (i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(SAVE_STORAGE_PREFIX)) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed = parseSaveDocument(raw);
      if (!parsed.ok) continue;
      const doc: SaveDocument = parsed.doc;
      // Defensive: a valid SaveDocument always has `campaign` and
      // `savedAt`, but parseSaveDocument doesn't guarantee strict
      // type-shape of nested fields against malice. Validate the
      // bits we'll display.
      if (
        !doc.campaign ||
        typeof doc.campaign.owner !== 'string' ||
        typeof doc.campaign.repo !== 'string' ||
        typeof doc.savedAt !== 'string'
      ) {
        continue;
      }
      found.push({
        campaign: { ...doc.campaign },
        savedAt: doc.savedAt,
        eventCount: Array.isArray(doc.events) ? doc.events.length : 0,
        storageKey: key
      });
    }
  } catch {
    // localStorage threw mid-iteration (rare; partial-eviction race).
    // Return what we have so far rather than failing the landing.
  }
  // Sort most-recent-first by savedAt (ISO 8601 sorts lexically).
  found.sort((a, b) => (b.savedAt < a.savedAt ? -1 : b.savedAt > a.savedAt ? 1 : 0));
  return found.slice(0, limit);
}

/**
 * Format a `savedAt` ISO timestamp as a human-readable "N days/weeks/
 * months ago" string. Stays in the TTRPG prime directive lane —
 * "12 weeks ago" reads as a duration, not a filesystem timestamp.
 *
 * Spans up to years, unlike `formatTimeAgo` in `quire-app.ts` (which
 * only goes to days and is used by the resume-prompt / save-status
 * lines where granularity past "days" looks fishy). Resume prompt
 * could swap to this version in a later UX pass.
 *
 * `now` is parameterized for deterministic testing.
 */
export function formatCampaignAge(savedAt: string, now: Date = new Date()): string {
  const then = Date.parse(savedAt);
  if (Number.isNaN(then)) return 'a while ago';
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return 'moments ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 18) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * Format a campaign ref as a slug like "gutschke/underleaf" or
 * "gutschke/underleaf@feature-branch" when a non-default ref is set.
 */
export function formatCampaignSlug(campaign: CampaignRef): string {
  const base = `${campaign.owner}/${campaign.repo}`;
  return campaign.ref && campaign.ref !== 'main'
    ? `${base}@${campaign.ref}`
    : base;
}

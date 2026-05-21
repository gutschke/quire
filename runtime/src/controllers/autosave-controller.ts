/**
 * AutosaveController — Lit ReactiveController encapsulating the
 * debounced autosave path: schedule a save N ms after the last
 * session event, write to localStorage keyed by campaign, and warn
 * (then refuse) once the JSON gets large.
 *
 * Extracted from `src/quire-app.ts` during M1 (P0-9).  The host
 * (QuireApp) supplies a `buildDoc()` callback that constructs the
 * save document from the current session + campaign.  The controller
 * owns the timer, quota-warned flag, and the localStorage key
 * convention.
 *
 * The matching resume-prompt flow is in `checkResume()` — it looks
 * for a prior autosave for a given campaign and returns the parsed
 * SaveDocument (or null).  The host displays / dismisses the resume
 * UI by mutating its own @state — that's a render concern.
 *
 * Caps:
 *   SAVE_AUTOSAVE_DEBOUNCE_MS = 1500   (debounce window per change)
 *   SAVE_QUOTA_WARN_BYTES     = 1_000_000  (warn once at 1 MB)
 *   SAVE_QUOTA_REFUSE_BYTES   = 4_000_000  (refuse autosave > 4 MB)
 *
 * Refuse is silent for autosave; the user can still trigger a manual
 * "Save to file" via the existing UI.
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import {
  stringifySave,
  parseSaveDocument,
  type SaveDocument
} from '../persistence';

export const SAVE_STORAGE_PREFIX = 'quire.save.';
export const SAVE_AUTOSAVE_DEBOUNCE_MS = 1500;
export const SAVE_QUOTA_WARN_BYTES = 1_000_000;
export const SAVE_QUOTA_REFUSE_BYTES = 4_000_000;

export interface CampaignRefLike {
  owner: string;
  repo: string;
}

function storageKey(campaign: CampaignRefLike): string {
  return `${SAVE_STORAGE_PREFIX}${campaign.owner}-${campaign.repo}`;
}

export class AutosaveController implements ReactiveController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private quotaWarned: boolean = false;

  constructor(
    host: ReactiveControllerHost,
    private readonly buildDoc: () => SaveDocument | null
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    /* nothing to load — autosave is a one-way write path; resume
     * uses checkResume() explicitly */
  }

  hostDisconnected(): void {
    this.cancelPending();
  }

  /**
   * Debounced schedule.  Subsequent calls within the debounce window
   * reset the timer.  Safe to call from a session-state subscribe
   * callback on every event.
   */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.performNow();
    }, SAVE_AUTOSAVE_DEBOUNCE_MS);
  }

  /**
   * Cancel any pending debounced save.  Useful when leaving a
   * session or unmounting — we don't want the timer firing after.
   */
  cancelPending(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run the autosave immediately.  No-op when buildDoc returns null
   * (no active session / no campaign).  Refuses silently above the
   * REFUSE cap; warns once above the WARN cap.
   */
  performNow(): void {
    const doc = this.buildDoc();
    if (!doc) return;
    const json = stringifySave(doc);
    if (json.length > SAVE_QUOTA_REFUSE_BYTES) {
      // Refuse — user can still download via Save button.
      this.quotaWarned = true;
      return;
    }
    if (json.length > SAVE_QUOTA_WARN_BYTES && !this.quotaWarned) {
      console.warn(
        `[quire] autosave is large (${(json.length / 1000).toFixed(0)}KB); consider downloading a manual save.`
      );
      this.quotaWarned = true;
    }
    try {
      window.localStorage?.setItem(storageKey(doc.campaign), json);
    } catch {
      // QuotaExceededError, sandboxed contexts, etc.  Non-fatal.
    }
  }

  /**
   * Look up a prior autosave for the given campaign.  Returns the
   * parsed SaveDocument or null (no save / parse failure /
   * localStorage unavailable).
   */
  checkResume(campaign: CampaignRefLike): SaveDocument | null {
    try {
      const json = window.localStorage?.getItem(storageKey(campaign));
      if (!json) return null;
      const parsed = parseSaveDocument(json);
      return parsed.ok ? parsed.doc : null;
    } catch {
      return null;
    }
  }

  /**
   * Reset the "warned about size" sticky flag.  Useful after the
   * user manually trims their session via Reclaim/truncate, where
   * the next autosave may be small again.
   */
  resetQuotaWarning(): void {
    this.quotaWarned = false;
  }
}

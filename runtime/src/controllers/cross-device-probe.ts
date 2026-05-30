/**
 * M6a-FS-3 (2026-05-30 save-restore program, run #10) — Cross-device
 * handoff probe.
 *
 * # What this module does
 *
 * Implements `auth-strategy.md §FS.11` + `ux-strategy.md §A11`.  When
 * a DM lands on a campaign URL on a fresh device (or a wiped browser
 * profile) and there is NO local autosave for the campaign, but a
 * folder IS already connected for this campaign on this device, the
 * probe asks the connected folder whether a matching
 * `<slug>.quire-save.json` file is present.  If so, the host surfaces
 * a `[Load it] [Start fresh]` prompt per `DEC-015`.  If not, the host
 * stays silent (no "we maybe have a backup" non-prompt — that copy is
 * the anti-pattern §A11 explicitly calls out).
 *
 * # Why this is a controller, not inline
 *
 * The probe needs:
 *
 * 1. A "once per landing" guard so a re-render doesn't re-probe.
 * 2. Gating on three independent facts (feature available + folder
 *    connected + no local autosave).
 * 3. Async I/O on top of `FsApiCloudPush.listSavesInFolder`.
 *
 * Keeping the lifecycle in a controller keeps `quire-app.ts` free of
 * yet another half-page of state branches; the host only has to call
 * `controller.maybeProbe(...)` from the campaign-landing render path
 * and read `controller.found` for the surface decision.
 *
 * # What this module DOESN'T do
 *
 * - Rendering.  The host owns the `[Load it] [Start fresh]` template
 *   so the buttons compose with the existing resume-prompt area.
 * - The actual `pullCampaignFromFolder` call on Load click — that
 *   stays in the host so the existing `loadFromString` projection
 *   path runs and so the chip surface gets the right hand-off.
 *   This controller's job ends at "yes, a file is here; here's its
 *   name + mtime + size — go ask for it."
 * - Networked / cross-device discovery WITHOUT a connected folder.
 *   Per §FS.11 the FS-API can't see across devices; the DM must
 *   re-connect the folder before this probe has anything to look
 *   at.  When no folder is connected, the controller reports
 *   `kind: 'no-folder'` and the host can render the existing "no
 *   local state" UI plus the optional "[Connect a folder to look
 *   for backups]" affordance (separate UX track; not handled here).
 *
 * # Silent-player firewall
 *
 * The controller is DM-centric by construction — it consults the
 * connected folder, which is the DM's per-origin handle.  Player
 * surfaces never call into the probe.  The host's gate on the
 * surface render uses `isCoordinator()` + the existing campaign
 * loading state per `ux-strategy.md §A11` "the prompt is DM-only."
 */

import type {
  FsApiCloudPush,
  ListResult
} from '../auth/fs-api-cloud-push';
import { saveFileNameFor } from '../auth/fs-api-cloud-push';

export interface CrossDeviceProbeMatch {
  readonly kind: 'match';
  readonly campaignId: string;
  readonly fileName: string;
  readonly lastModifiedMs: number;
  readonly sizeBytes: number;
  /** Folder display name — surfaces in the prompt copy. */
  readonly folderName: string;
}

export type CrossDeviceProbeOutcome =
  | CrossDeviceProbeMatch
  | { readonly kind: 'no-match'; readonly campaignId: string }
  | { readonly kind: 'no-folder'; readonly campaignId: string }
  | { readonly kind: 'feature-unavailable' }
  | { readonly kind: 'error'; readonly reason: ListResult extends { ok: false; reason: infer R } ? R : string };

export interface CrossDeviceProbeDeps {
  readonly cloudPush: FsApiCloudPush;
  /**
   * Read whether a local autosave exists for this campaign in the
   * caller's localStorage.  The probe ONLY runs when this returns
   * false — a present local autosave means the resume prompt is the
   * right surface, not the cross-device one.
   */
  readonly hasLocalAutosave: (campaignId: string) => boolean;
}

/**
 * Owns the once-per-landing guard for the cross-device probe.
 *
 * Lifecycle:
 *
 *   - `reset()` — call on campaign URL navigation.  Drops the guard
 *     so a SECOND landing on the same campaign URL probes again.
 *   - `maybeProbe({campaignId})` — runs the probe IF the guard is
 *     still up and all gating conditions hold.  Idempotent on
 *     repeat calls — the guard short-circuits subsequent invocations
 *     until `reset()` fires.  Returns the resolved outcome.
 *   - `outcome` — the most recent result, or `null` if the probe
 *     hasn't yet completed (or was skipped due to gates).
 *
 * Why a guard rather than the caller tracking state: the host's
 * render loop can fire many times during a single landing.  Without
 * the guard the probe would run on every paint, generating spurious
 * I/O AND racing with itself (the second probe could resolve before
 * the first, overwriting the surface).  Hoisting the guard into the
 * controller keeps the host call site a single line.
 */
export class CrossDeviceProbeController {
  private guard: 'open' | 'in-flight' | 'closed' = 'open';
  private lastCampaignId: string | null = null;
  private _outcome: CrossDeviceProbeOutcome | null = null;

  constructor(private readonly deps: CrossDeviceProbeDeps) {}

  /**
   * Reset on new campaign URL.  Drops the guard so the next call to
   * `maybeProbe` actually runs.  Also clears the cached outcome so a
   * stale `match` doesn't surface against the wrong campaign.
   */
  reset(): void {
    this.guard = 'open';
    this.lastCampaignId = null;
    this._outcome = null;
  }

  get outcome(): CrossDeviceProbeOutcome | null {
    return this._outcome;
  }

  /**
   * Explicitly clear the resolved outcome (e.g. after the DM clicks
   * "Start fresh" — the prompt dismisses; the guard stays CLOSED so
   * we don't re-prompt until the next landing).
   */
  dismiss(): void {
    this._outcome = null;
  }

  /**
   * Probe the connected folder for a save file matching this
   * campaign.  Idempotent: a second call without a `reset()` short-
   * circuits.
   */
  async maybeProbe({
    campaignId
  }: {
    campaignId: string;
  }): Promise<CrossDeviceProbeOutcome | null> {
    // Guard: ONE probe per landing.  Multiple Lit re-renders during a
    // single landing land here; the guard makes the second call a
    // no-op without spurious I/O.
    if (this.guard !== 'open') return this._outcome;
    if (this.lastCampaignId === campaignId && this._outcome !== null) {
      return this._outcome;
    }

    // Feature gate — Safari / Firefox / mobile / SSR all short-
    // circuit here.
    if (!this.deps.cloudPush.isAvailable()) {
      this.guard = 'closed';
      this._outcome = { kind: 'feature-unavailable' };
      this.lastCampaignId = campaignId;
      return this._outcome;
    }

    // Local-autosave gate — if there's a local save we surface the
    // resume prompt instead.  Cross-device probe is reserved for the
    // empty-local-state case per `ux-strategy.md §A11`.
    if (this.deps.hasLocalAutosave(campaignId)) {
      this.guard = 'closed';
      this._outcome = null;
      this.lastCampaignId = campaignId;
      return null;
    }

    // Folder-connected gate — see the controller doc-comment for
    // why this is the §FS.11 boundary and what the host should
    // render when this returns no-folder.
    const folderState = await this.deps.cloudPush.getConnectedFolderState({
      campaignId
    });
    if (!folderState.connected) {
      this.guard = 'closed';
      this._outcome = { kind: 'no-folder', campaignId };
      this.lastCampaignId = campaignId;
      return this._outcome;
    }

    // Mark in-flight so a second async caller short-circuits while
    // we await the list call.
    this.guard = 'in-flight';

    const listResult = await this.deps.cloudPush.listSavesInFolder({
      campaignId
    });

    this.guard = 'closed';
    this.lastCampaignId = campaignId;

    if (!listResult.ok) {
      // The reason vocabulary (`not-connected`, `permission-revoked`,
      // `list-failure`, `feature-unavailable`) is opaque here; the
      // host can decide how to surface (typically silent — §A11 says
      // ambiguous "we may have a backup" copy is worse than nothing).
      this._outcome = { kind: 'error', reason: listResult.reason } as
        CrossDeviceProbeOutcome;
      return this._outcome;
    }

    const expectedFileName = saveFileNameFor(campaignId);
    const match = listResult.files.find((f) => f.name === expectedFileName);
    if (!match) {
      this._outcome = { kind: 'no-match', campaignId };
      return this._outcome;
    }

    this._outcome = {
      kind: 'match',
      campaignId,
      fileName: match.name,
      lastModifiedMs: match.lastModifiedMs,
      sizeBytes: match.size,
      folderName: folderState.folderName
    };
    return this._outcome;
  }
}

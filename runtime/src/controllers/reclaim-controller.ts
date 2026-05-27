/**
 * E-LARGE-1 step 2 (2026-05-27): coordinator-yield + reclaim
 * cluster extracted from QuireApp.  Owns:
 *
 *   - `reclaimConfirmShown` — 2-step confirm flag for the
 *     "Reclaim DM" button (Reclaim verb is hard to undo; the
 *     extra click protects against accidental coord-grabs).
 *   - `yieldPcFatePrompt` — modal state for the outgoing DM's
 *     PC-fate decision (Keep / Sideline / Retire) when they
 *     yield while a PC is bound to their peer.  Per the TTRPG-R8
 *     verdict (#302), this prompt fires in two scenarios:
 *
 *       1. Voluntary: DM clicks "Yield DM role"; modal opens
 *          before the yield event fires.  PC-fate event +
 *          coordinator-yield are emitted together (in that
 *          order — pc-retire requires sticky-coord authority
 *          AT the time it's appended).
 *       2. Reactive: another peer reclaims while the DM had a
 *          PC.  Local coord status flips before the modal can
 *          gate the yield; the controller's `hostUpdated` hook
 *          opens the prompt so the DM still picks a fate.
 *
 *   - `prevCoordStatus` + `_skipNextReactiveYield` — the
 *     reactive-detection bookkeeping (was-coord → now-not-coord
 *     edge detection; voluntary path suppresses the next
 *     reactive auto-open to avoid double-firing).
 *
 * The controller is a Lit `ReactiveController`: `hostUpdated`
 * runs after the host's `updated()`, observes `sessionView`
 * via the env getter, and opens the reactive prompt on the
 * coord-loss edge.  QuireApp's `updated()` is no longer
 * involved.
 *
 * INVARIANT (load-bearing): `submitYieldPcFatePrompt` emits
 * pc-retire BEFORE coordinator-yield on the voluntary path.
 * Per the comment in the inline code: coordHolders is sticky,
 * so a peer who WAS coord can still author pc-retire after
 * yielding — but emitting in the documented order keeps the
 * audit clean + survives any future coord-validator tightening.
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { SessionView } from '../session-controller';

/**
 * Snapshot of the yield-PC-fate modal.  Null when no prompt is
 * open.  `voluntary` distinguishes the two firing paths (see
 * file doc) — the modal copy varies, and the voluntary path
 * appends coordinator-yield on submit.
 */
export interface YieldPcFatePrompt {
  readonly pcId: string;
  readonly pcName: string;
  readonly voluntary: boolean;
  fate: 'keep' | 'sideline' | 'retire';
  retireReason: string;
}

/**
 * Host-environment slice the controller needs.  Each capability
 * is a getter callback so the controller observes the latest
 * value at decision time (avoids stale-snapshot bugs from
 * QuireApp re-renders).
 *
 * Action methods own the side-effect boundary — the controller
 * never calls `this.session.append` or `this.session.rename`
 * directly.  `sidelinePc` hides the engine's "empty-string pcId
 * = unbind" encoding behind a named verb.
 */
export interface ReclaimEnv {
  getSessionView(): SessionView | null;
  /** Resolved display name for a synthesizedPc; falls back to pcId. */
  getPcName(pcId: string): string;
  /**
   * Emit a `pc-retire` event for the bound PC.  Returns true
   * when the engine accepted it (the seat is now bound-retired);
   * false when the validator silently rejected.  The controller
   * uses the boolean to bail before yielding (SHOULD-FIX-3
   * sanity check).
   */
  retirePc(payload: {
    pcId: string;
    inFictionReason: string;
  }): boolean;
  /** Clear the local peer's PC binding (sideline verb). */
  sidelinePc(): void;
  /** Append a `coordinator-yield` event. */
  yieldCoordinator(): void;
  /**
   * Set a user-visible error string for the failed-retire bail
   * path.  Reuses QuireApp's `aiError` slot for now — see
   * TODO(engineError) in the failing-retire branch below; the
   * misnaming is documented + tracked.
   */
  setBailError(message: string): void;
}

type CoordStatus = 'coord' | 'non-coord' | 'no-session';

export class ReclaimController implements ReactiveController {
  /** 2-step confirm flag for the "Reclaim DM" button. */
  reclaimConfirmShown = false;

  /** Yield + PC-fate modal state; null when no prompt is open. */
  yieldPcFatePrompt: YieldPcFatePrompt | null = null;

  private prevCoordStatus: CoordStatus = 'no-session';
  /**
   * Voluntary `submitYieldPcFatePrompt` sets this so the
   * subsequent coord→non-coord transition (triggered by the
   * coordinator-yield event we just emitted) does NOT re-open
   * the prompt as a reactive auto-open.
   */
  private skipNextReactiveYield = false;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly env: ReclaimEnv
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    /* no-op — prompt opens lazily via openYield / hostUpdated. */
  }

  hostDisconnected(): void {
    // Drop modal state on unmount so re-mounts don't surface a
    // stale prompt.  Same posture as ChatSpoilerLintController.
    this.reclaimConfirmShown = false;
    this.yieldPcFatePrompt = null;
    this.prevCoordStatus = 'no-session';
    this.skipNextReactiveYield = false;
  }

  /**
   * Reactive hook for the coord→non-coord edge.  Fires after
   * every host `updated()` returns (Lit's `hostUpdated()` takes
   * no args; we detect transitions ourselves by tracking
   * `prevCoordStatus` against the latest sessionView).  Opens
   * the yield-PC-fate prompt when:
   *   - the local peer just lost coord (`prev === 'coord' &&
   *     newStatus === 'non-coord'`),
   *   - the local peer still has a bound PC,
   *   - the voluntary path hasn't already handled it
   *     (`skipNextReactiveYield`),
   *   - no prompt is already open.
   */
  hostUpdated(): void {
    const v = this.env.getSessionView();
    const newStatus: CoordStatus =
      !v || v.status !== 'active'
        ? 'no-session'
        : v.peerId && v.filteredShared.coordinator === v.peerId
          ? 'coord'
          : 'non-coord';
    const prev = this.prevCoordStatus;
    this.prevCoordStatus = newStatus;
    if (prev !== 'coord' || newStatus !== 'non-coord') return;
    if (!v || !v.peerId) return;
    if (this.skipNextReactiveYield) {
      this.skipNextReactiveYield = false;
      return;
    }
    const me = v.filteredShared.peers[v.peerId];
    const pcId = me?.pcId;
    if (!pcId || this.yieldPcFatePrompt) return;
    const pcName = this.env.getPcName(pcId);
    this.yieldPcFatePrompt = {
      pcId,
      pcName,
      voluntary: false,
      fate: 'keep',
      retireReason: ''
    };
    this.host.requestUpdate();
  }

  // ============ Reclaim affordance ============

  /** Show the 2-step confirm modal for the "Reclaim DM" button. */
  showReclaimConfirm(): void {
    this.reclaimConfirmShown = true;
    this.host.requestUpdate();
  }
  /** Close the 2-step confirm modal (Cancel or after Reclaim fires). */
  hideReclaimConfirm(): void {
    this.reclaimConfirmShown = false;
    this.host.requestUpdate();
  }

  // ============ Yield prompt — voluntary path ============

  /**
   * Coord-only: opens the yield prompt as a voluntary action.
   * Pre-checks pcId so the prompt's render layer can decide
   * whether to show the 3-radio picker (only relevant when the
   * DM has a bound PC).  No-ops if the local peer is not coord.
   */
  openYieldPrompt(): void {
    const v = this.env.getSessionView();
    if (!v || v.status !== 'active' || !v.peerId) return;
    if (v.filteredShared.coordinator !== v.peerId) return;
    const me = v.filteredShared.peers[v.peerId];
    const pcId = me?.pcId ?? '';
    if (!pcId) {
      // No bound PC → bypass the picker.  Yield immediately
      // after a one-line confirm (same shape as the reclaim
      // confirmation for UX symmetry).
      this.yieldPcFatePrompt = {
        pcId: '',
        pcName: '',
        voluntary: true,
        fate: 'keep',
        retireReason: ''
      };
      this.host.requestUpdate();
      return;
    }
    const pcName = this.env.getPcName(pcId);
    this.yieldPcFatePrompt = {
      pcId,
      pcName,
      voluntary: true,
      fate: 'keep',
      retireReason: ''
    };
    this.host.requestUpdate();
  }

  /**
   * Submit the yield prompt.  On the voluntary path: emits the
   * chosen PC-fate event FIRST (while still coord), then
   * coordinator-yield.  On the reactive path (voluntary=false):
   * skips the yield event — the peer already lost coord — and
   * just applies the PC action.
   *
   * Returns false when:
   *   - no prompt is open,
   *   - the retire path's reason is empty / too long,
   *   - the retire was silently rejected by the engine validator
   *     (SHOULD-FIX-3 sanity check; the prompt stays open + a
   *     bail-error is surfaced so the DM can retry).
   *
   * INVARIANT: pc-retire MUST emit before coordinator-yield on
   * the voluntary path.  coordHolders is sticky so a yielded
   * coord CAN still author pc-retire, but the documented
   * ordering keeps the audit clean + survives future validator
   * tightening.
   */
  submitYieldPcFatePrompt(): boolean {
    const p = this.yieldPcFatePrompt;
    if (!p) return false;
    const v = this.env.getSessionView();
    if (!v || v.status !== 'active' || !v.peerId) return false;
    if (p.pcId) {
      if (p.fate === 'sideline') {
        this.env.sidelinePc();
      } else if (p.fate === 'retire') {
        const reason = p.retireReason.trim();
        if (reason.length === 0 || reason.length > 200) return false;
        const accepted = this.env.retirePc({
          pcId: p.pcId,
          inFictionReason: reason
        });
        if (!accepted) {
          // TODO(engineError): `aiError` is the current bail
          // channel but the name lies — this isn't an AI error.
          // Rename to engineError or transientError when the
          // E-LARGE-1 sweep wraps + we know all the call sites.
          this.env.setBailError(
            `Retire of ${p.pcName} was not accepted by the engine — yield aborted.  ` +
              `Try again or pick a different PC fate.`
          );
          // Keep the prompt open so the DM can investigate / retry.
          return false;
        }
      }
      // fate === 'keep' → no PC event.
    }
    // Voluntary yield: append coord-yield AFTER any PC event +
    // suppress the reactive auto-open from the resulting
    // coord→non-coord transition.
    if (p.voluntary && v.filteredShared.coordinator === v.peerId) {
      this.skipNextReactiveYield = true;
      this.env.yieldCoordinator();
    }
    this.yieldPcFatePrompt = null;
    this.host.requestUpdate();
    return true;
  }

  /**
   * Cancel the prompt without emitting anything.  Reactive-path
   * cancel = "Keep" semantics: the DM lost coord but didn't
   * decide their PC's fate; binding stays as-is.
   */
  dismissYieldPcFatePrompt(): void {
    this.yieldPcFatePrompt = null;
    this.host.requestUpdate();
  }

  // ============ Yield prompt — radio + reason setters ============

  setYieldPcFate(fate: 'keep' | 'sideline' | 'retire'): void {
    if (!this.yieldPcFatePrompt) return;
    this.yieldPcFatePrompt = { ...this.yieldPcFatePrompt, fate };
    this.host.requestUpdate();
  }

  setYieldRetireReason(reason: string): void {
    if (!this.yieldPcFatePrompt) return;
    this.yieldPcFatePrompt = {
      ...this.yieldPcFatePrompt,
      retireReason: reason
    };
    this.host.requestUpdate();
  }
}

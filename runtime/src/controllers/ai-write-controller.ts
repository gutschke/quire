/**
 * AiWriteController — Lit ReactiveController owning the AI write
 * batch state (M3c.3 per design/m3c-ai-write-api.md §Phase 2).
 *
 * Lifecycle:
 *  1. Broker returns an `AiResponse` whose `stateUpdates` may be
 *     non-empty.  QuireApp hands the array to `proposeBatch()`.
 *  2. The controller stamps each update with an id + the current
 *     `causedByResponseId` and flags hard-gated entries.
 *  3. The DM accept-gate UI in `<ai-panel>` reads `currentBatch`
 *     and renders the strip.
 *  4. DM hits Apply-All → `applyAll()` dispatches the non-gated
 *     entries via the session controller; hard-gated entries stay
 *     pending and each have their own "Accept this change" button
 *     that calls `applyOne(id)`.
 *  5. After Apply-All, a 60-second undo timer starts.  During the
 *     window the DM can `revertOne(id)` to undo any individual
 *     applied entry.  Per the M3c plan's note: revert during the
 *     window emits a compensating event rather than mutating
 *     history.  After 60s the timer clears the batch.
 *  6. A new AI response clears the prior batch automatically.
 *
 * Hard-gate detection (the plan's load-bearing safety property):
 *  - pc-edit transitioning harm to box 3 or 4 (current → new)
 *  - pc-edit transitioning stress to box 4
 *  - cross-PC pc-edit (coord proposing edit on a peer's bound PC)
 *  - caster-state-set with ladderState='hunted'
 *  - caster-state-set with taxActive transitioning true OR false
 *  - dice-roll resulting in double-1 (the broker SHOULDN'T emit
 *    this; defensive)
 *
 * The controller READS hard-gate state from the current SessionView
 * (current values of harm/stress, current casterState, current peer
 * bindings) so transitions can be detected without re-fetching.
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { SessionController, SessionView } from '../session-controller';
import type { StateUpdate } from '../ai/schema';

export type PendingUpdateStatus =
  | 'pending'
  | 'applied'
  | 'reverted'
  | 'hard-gate-pending';

export interface PendingUpdate {
  /** Stable id within this batch (for revert / per-update accept). */
  id: string;
  update: StateUpdate;
  /** The ai-response id this update is attributed to. */
  causedByResponseId: string;
  /** Set by the controller; consumed by the UI to decide rendering. */
  status: PendingUpdateStatus;
  /**
   * Why this update is hard-gated (human-readable, surfaced in the
   * "Accept this change" button tooltip).  Empty when not gated.
   */
  hardGateReason: string;
}

/** Default undo window (ms).  Public so tests can override. */
export const UNDO_WINDOW_MS = 60_000;

/**
 * Read-only view of the session pieces the controller needs.  Hosts
 * pass a getter rather than the value so the controller always reads
 * the latest state at decision time.
 */
export interface AiWriteHost {
  getSessionView(): SessionView | undefined;
  getSession(): SessionController | null;
  /** Returns the PC id the local peer has bound (their own), or undefined. */
  getBoundPcId(): string | undefined;
}

export class AiWriteController implements ReactiveController {
  private batch: PendingUpdate[] = [];
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private undoStartedAt: number = 0;
  private nextId = 1;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly env: AiWriteHost
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    /* nothing to do on connect */
  }

  hostDisconnected(): void {
    this.clearUndoTimer();
  }

  // -----------------------------------------------------------------
  // Reactive state — UI reads these getters.
  // -----------------------------------------------------------------

  get currentBatch(): readonly PendingUpdate[] {
    return this.batch;
  }

  /** Seconds remaining in the undo window (0 when no undo active). */
  get undoSecondsRemaining(): number {
    if (this.undoStartedAt === 0) return 0;
    const elapsed = Date.now() - this.undoStartedAt;
    const remaining = Math.max(0, UNDO_WINDOW_MS - elapsed);
    return Math.ceil(remaining / 1000);
  }

  /**
   * True when at least one pending entry needs explicit DM accept.
   * UI uses this to suppress Apply-All shortcut hints.
   */
  get hasHardGatedPending(): boolean {
    return this.batch.some((u) => u.status === 'hard-gate-pending');
  }

  /**
   * True when the batch has at least one entry the DM hasn't acted
   * on (status 'pending' OR 'hard-gate-pending').
   */
  get hasUnappliedPending(): boolean {
    return this.batch.some(
      (u) => u.status === 'pending' || u.status === 'hard-gate-pending'
    );
  }

  // -----------------------------------------------------------------
  // Batch management.
  // -----------------------------------------------------------------

  /**
   * Stage a new batch from the AI's response.  Replaces any prior
   * batch (a new AI response invalidates the old one — the DM moved on).
   */
  proposeBatch(updates: StateUpdate[], responseId: string): void {
    this.clearUndoTimer();
    const view = this.env.getSessionView();
    this.batch = updates.map((u) => {
      const reason = this.hardGateReason(u, view);
      const status: PendingUpdateStatus = reason
        ? 'hard-gate-pending'
        : 'pending';
      return {
        id: `u${this.nextId++}`,
        update: u,
        causedByResponseId: responseId,
        status,
        hardGateReason: reason
      };
    });
    this.host.requestUpdate();
  }

  /** Clear the batch (typically after a new prompt is fired). */
  clear(): void {
    this.clearUndoTimer();
    this.batch = [];
    this.host.requestUpdate();
  }

  /**
   * Apply every non-hard-gated entry in the current batch.  Starts
   * the 60-second undo timer.  Hard-gated entries stay pending for
   * individual `applyOne` clicks.  No-op when nothing pending.
   */
  applyAll(): void {
    const toApply = this.batch.filter((u) => u.status === 'pending');
    if (toApply.length === 0) return;
    for (const u of toApply) {
      this.dispatch(u);
      u.status = 'applied';
    }
    this.startUndoTimer();
    this.host.requestUpdate();
  }

  /** Apply a single update (used for hard-gated entries the DM clicks). */
  applyOne(id: string): void {
    const u = this.batch.find((x) => x.id === id);
    if (!u) return;
    if (u.status !== 'pending' && u.status !== 'hard-gate-pending') return;
    this.dispatch(u);
    u.status = 'applied';
    this.startUndoTimer();
    this.host.requestUpdate();
  }

  /**
   * Revert an applied update during the undo window.  Emits a
   * compensating event (per-kind) rather than mutating the log.
   * Outside the window, no-op.
   */
  revertOne(id: string): void {
    if (this.undoSecondsRemaining === 0) return;
    const u = this.batch.find((x) => x.id === id);
    if (!u) return;
    if (u.status !== 'applied') return;
    this.dispatchCompensating(u);
    u.status = 'reverted';
    this.host.requestUpdate();
  }

  // -----------------------------------------------------------------
  // Hard-gate detection.
  // -----------------------------------------------------------------

  /**
   * Return a non-empty human-readable reason when the update is
   * hard-gated; empty string when it can ride apply-all.  Public so
   * tests can verify the policy without round-tripping the broker.
   */
  hardGateReason(update: StateUpdate, view: SessionView | undefined): string {
    switch (update.kind) {
      case 'pc-edit': {
        if (update.field === 'harm') {
          const current = this.currentHarm(view, update.pcId);
          const next = current + update.delta;
          if (next >= 3) {
            return `Yui's harm reaching box ${Math.min(4, next)} is out-of-action territory — confirm to apply.`;
          }
        }
        if (update.field === 'stress') {
          const current = this.currentStress(view, update.pcId);
          const next = current + update.delta;
          if (next >= 4) {
            return `Stress box 4 (Broken) means the PC cannot cast — confirm to apply.`;
          }
        }
        // Cross-PC: the coord is proposing an edit to a PC that
        // someone else has bound.  The bound peer has no consent
        // path; require explicit DM click.
        if (this.isCrossPc(view, update.pcId)) {
          return `Cross-PC edit on ${update.pcId} (another player's bound PC) — confirm to apply.`;
        }
        return '';
      }
      case 'caster-state-set': {
        if (update.ladderState === 'hunted') {
          return `Caster ladder advancing to Hunted is a story beat — confirm to apply.`;
        }
        const priorTax = this.currentTaxActive(view, update.pcId);
        if (update.taxActive !== undefined && update.taxActive !== priorTax) {
          return update.taxActive
            ? `Trying-too-hard activating on ${update.pcId} — the realization scene is the DM's — confirm to apply.`
            : `Trying-too-hard releasing for ${update.pcId} — confirm to apply.`;
        }
        return '';
      }
      case 'dice-roll': {
        // The broker SHOULDN'T propose double-1 outcomes (those are
        // DM-narrated wild outcomes per rules-reference.md L47), but
        // a hostile / malformed expression could.  Defensive only.
        if (/(?:^|[^d])2d6/.test(update.expression) && /double-?1/i.test(
          update.modifierBreakdown ?? ''
        )) {
          return `Double-1 wild outcome — the DM owns the twist — confirm to apply.`;
        }
        return '';
      }
    }
  }

  // -----------------------------------------------------------------
  // Internal helpers.
  // -----------------------------------------------------------------

  private currentHarm(
    view: SessionView | undefined,
    pcId: string
  ): number {
    if (!view || view.status !== 'active') return 0;
    const edits = view.shared.pcEdits[pcId];
    const v = edits?.harm;
    return typeof v === 'number' ? v : 0;
  }

  private currentStress(
    view: SessionView | undefined,
    pcId: string
  ): number {
    if (!view || view.status !== 'active') return 0;
    const edits = view.shared.pcEdits[pcId];
    const v = edits?.stress;
    return typeof v === 'number' ? v : 0;
  }

  private currentTaxActive(
    view: SessionView | undefined,
    pcId: string
  ): boolean {
    if (!view || view.status !== 'active') return false;
    return view.shared.casterState[pcId]?.taxActive ?? false;
  }

  private isCrossPc(
    view: SessionView | undefined,
    pcId: string
  ): boolean {
    const myPcId = this.env.getBoundPcId();
    if (!myPcId) return false; // no bound PC → can't reason about cross-PC
    if (pcId === myPcId) return false;
    // The target is bound by some other peer.  Check the peers map.
    if (!view || view.status !== 'active') return false;
    for (const p of Object.values(view.shared.peers)) {
      if (p.leftAt === undefined && p.pcId === pcId) {
        // Some active peer owns this PC and it's not us.
        return true;
      }
    }
    // No one currently owns the target PC → not cross-PC.
    return false;
  }

  /**
   * Translate a StateUpdate into an event append on the session
   * controller.  The session-side append carries the
   * causedByResponseId so the materializer's M3c.5 hard-gate
   * enforcement can verify.
   */
  private dispatch(u: PendingUpdate): void {
    const s = this.env.getSession();
    if (!s) return;
    const view = this.env.getSessionView();
    if (!view || view.status !== 'active') return;
    switch (u.update.kind) {
      case 'pc-edit': {
        const current = u.update.field === 'harm'
          ? this.currentHarm(view, u.update.pcId)
          : this.currentStress(view, u.update.pcId);
        const value = current + u.update.delta;
        s.append('pc-edit', {
          pcId: u.update.pcId,
          field: u.update.field,
          value,
          causedByResponseId: u.causedByResponseId
        });
        break;
      }
      case 'dice-roll': {
        // The dice-roll proposal hands the expression + purpose to
        // the existing roll dispatcher.  For v1 the broker submits a
        // dice-roll event with the expression captured as text + a
        // single-result placeholder; the DM can re-roll if they want
        // physical dice.  AiWriteController doesn't compute the roll
        // itself; that's the session-controller's job.
        s.append('dice-roll', {
          expression: u.update.expression,
          result: 0, // placeholder — broker may extend later to compute
          dice: [],
          purpose: u.update.purpose,
          modifierBreakdown: u.update.modifierBreakdown,
          causedByResponseId: u.causedByResponseId
        });
        break;
      }
      case 'caster-state-set': {
        s.append('caster-state-set', {
          v: 1,
          pcId: u.update.pcId,
          ladderState: u.update.ladderState,
          reason: u.update.reason,
          taxActive: u.update.taxActive,
          spamCount: u.update.spamCount,
          causedByResponseId: u.causedByResponseId
        });
        break;
      }
    }
  }

  /**
   * Emit a compensating event that undoes the effect of `u`.  Used
   * during the undo window.  Per-kind:
   *  - pc-edit: emit a pc-edit with the inverse delta.
   *  - dice-roll: we cannot un-roll; the revert is informational
   *    (the DM should re-narrate; the rolled value stays in history).
   *    Mark the audit chain via a scratch-note for transparency.
   *  - caster-state-set: revert to the prior CasterState snapshot we
   *    captured at apply-time.  For v1 we don't snapshot; revert
   *    re-emits the prior values via a fresh caster-state-set.
   *
   * Returns silently when the session isn't usable.
   */
  private dispatchCompensating(u: PendingUpdate): void {
    const s = this.env.getSession();
    if (!s) return;
    switch (u.update.kind) {
      case 'pc-edit': {
        // Snapshot-free: emit an opposite-delta pc-edit.  Note this
        // uses the CURRENT value (post-apply) minus the delta — not
        // an absolute "set to pre-edit value".  Concurrent edits in
        // the interim are preserved.
        const view = this.env.getSessionView();
        if (!view || view.status !== 'active') return;
        const current = u.update.field === 'harm'
          ? this.currentHarm(view, u.update.pcId)
          : this.currentStress(view, u.update.pcId);
        const value = current - u.update.delta;
        s.append('pc-edit', {
          pcId: u.update.pcId,
          field: u.update.field,
          value,
          causedByResponseId: '' // explicit DM revert, not AI-caused
        });
        break;
      }
      case 'dice-roll': {
        s.append('scratch-note', {
          v: 1,
          text: `(AI-proposed roll "${u.update.purpose}" was reverted within the undo window — re-narrate as needed.)`
        });
        break;
      }
      case 'caster-state-set': {
        // For now: re-emit clear() with the same pcId.  A v2 with
        // snapshots would restore the prior state precisely; M3c
        // minimum is "stop applying the proposed change."
        s.append('caster-state-set', {
          v: 1,
          pcId: u.update.pcId,
          ladderState: 'clear',
          causedByResponseId: ''
        });
        break;
      }
    }
  }

  private startUndoTimer(): void {
    this.clearUndoTimer();
    this.undoStartedAt = Date.now();
    this.undoTimer = setTimeout(() => {
      this.undoTimer = null;
      this.undoStartedAt = 0;
      this.host.requestUpdate();
    }, UNDO_WINDOW_MS);
  }

  private clearUndoTimer(): void {
    if (this.undoTimer !== null) {
      clearTimeout(this.undoTimer);
      this.undoTimer = null;
    }
    this.undoStartedAt = 0;
  }
}

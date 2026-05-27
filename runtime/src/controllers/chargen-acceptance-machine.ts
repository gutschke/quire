/**
 * D5.5-A step 2 (2026-05-27 E-LARGE-2): state cluster for the
 * accept / pre-accept / re-sync slot lifecycle.  Extracted from
 * `ChargenController` (1939 LOC god-object) to give the 8 per-slot
 * Maps/Sets a single owner + a single source of truth for the
 * reset-slot aggregates.
 *
 * Pre-extraction the controller carried these as separate private
 * fields scattered across ~70 lines + 3 nearly-identical inline
 * reset blocks (revise / synthesizeForSlot-success / deleteSlotData).
 * The reset blocks were drifting; this class makes the differences
 * load-bearing semantics with named methods (`resetForRevise`,
 * `resetAfterFreshSynth`, `resetForDelete`) instead of opt-flags
 * on a single aggregate.
 *
 * No behavior change vs. the inline implementation.  The machine
 * owns no Lit host — callers thread `host.requestUpdate()` at the
 * existing call sites.
 *
 * Synth-result state (`_synthResults` + `_synthInFlight`) is
 * intentionally NOT bundled here.  "Has the DM accepted this?"
 * (acceptance) and "is a synth in flight / what did it return?"
 * (synthesis) are different lifecycles — synth state outlives
 * acceptance + gets cleared on different events.
 */

import type { PcBackstorySynthesisResponse } from '../ai/schema';

export type PreAcceptDrift = Partial<PcBackstorySynthesisResponse>;

export interface ResyncFailure {
  readonly code: string;
  readonly message: string;
}

export class ChargenAcceptanceMachine {
  /**
   * Slots the DM has clicked Accept on.  Set membership is the
   * source of truth for "has pc-create been emitted?" — once a
   * slot is here, repeat acceptSlot calls are no-ops (idempotent).
   */
  private readonly accepted = new Set<number>();

  /**
   * Phase B P2 verification fix (S2): race-mismatch flag.  Set
   * when acceptSlot was called with an expectedResponseId that
   * doesn't match the current synth result (a re-sync landed
   * between modal-open and click).  The UI consults
   * `hasRaceMismatch` to surface a "synth landed mid-review —
   * please re-review" banner.
   */
  private readonly raceMismatch = new Set<number>();

  /**
   * Wave 2 (2026-05-25): pre-accept drift map.  When the DM edits
   * a synth result before clicking Accept, the original AI value
   * is snapshotted here so the drift banner can render before/after.
   */
  private readonly preAcceptOriginals = new Map<number, PreAcceptDrift>();

  /**
   * Wave 3 polish: which slots had their backstory mutated by a
   * deterministic pronoun substitution (patchInPlace).  The UI uses
   * this to render a "Re-sync to clean up verb agreement" hint.
   */
  private readonly pronounPatched = new Set<number>();

  /**
   * Post-R5 fix (QA-BUG-3): re-sync is async (10-30s).  While
   * it's in flight, accept / revise / edit calls must be gated so
   * a stale-pre-resync commit doesn't race the new AI output.
   */
  private readonly resyncInFlight = new Set<number>();

  /**
   * Post-R5 fix (QA-BUG-4): last resync failure for the slot.
   * The UI surfaces this as a banner so the DM doesn't think
   * nothing happened.  Cleared on any subsequent edit / re-sync
   * success / clear / revise.
   */
  private readonly resyncFailures = new Map<number, ResyncFailure>();

  /**
   * Post-R5 fix (QA-BUG-5): when patchInPlace runs and mutates
   * the cached backstory, stash the AI's ORIGINAL prose so a
   * later re-sync uses it as the voice-anchor (instead of the
   * deterministically-substituted version that may carry verb-
   * agreement glitches the AI would faithfully preserve).
   */
  private readonly originalBackstoryForResync = new Map<number, string>();

  /**
   * P-R12 (2026-05-25): "joining at session N" picker per-slot.
   * Default 1 (no catch-up).  When N > 1, acceptSlot seeds the
   * pc-create payload's startingMarks so the late-joining PC
   * isn't mechanically behind the party.
   */
  private readonly joiningSession = new Map<number, number>();

  // ============ accepted ============

  isAccepted(slot: number): boolean {
    return this.accepted.has(slot);
  }
  markAccepted(slot: number): void {
    this.accepted.add(slot);
  }
  unmarkAccepted(slot: number): boolean {
    return this.accepted.delete(slot);
  }
  /** Iterator over accepted slots (for `slotsWithSynthState`-style union). */
  acceptedIterator(): IterableIterator<number> {
    return this.accepted.values();
  }

  // ============ raceMismatch ============

  hasRaceMismatch(slot: number): boolean {
    return this.raceMismatch.has(slot);
  }
  markRaceMismatch(slot: number): void {
    this.raceMismatch.add(slot);
  }
  /** Returns true when the flag was set (and is now cleared). */
  clearRaceMismatch(slot: number): boolean {
    return this.raceMismatch.delete(slot);
  }
  raceMismatchSnapshot(): Set<number> {
    return new Set(this.raceMismatch);
  }

  // ============ preAcceptOriginals ============

  getPreAcceptOriginal(slot: number): PreAcceptDrift | undefined {
    return this.preAcceptOriginals.get(slot);
  }
  setPreAcceptOriginal(slot: number, drift: PreAcceptDrift): void {
    this.preAcceptOriginals.set(slot, drift);
  }
  deletePreAcceptOriginal(slot: number): boolean {
    return this.preAcceptOriginals.delete(slot);
  }
  preAcceptOriginalEntries(): IterableIterator<[number, PreAcceptDrift]> {
    return this.preAcceptOriginals.entries();
  }

  // ============ pronounPatched ============

  hasPronounPatch(slot: number): boolean {
    return this.pronounPatched.has(slot);
  }
  markPronounPatched(slot: number): void {
    this.pronounPatched.add(slot);
  }
  clearPronounPatched(slot: number): boolean {
    return this.pronounPatched.delete(slot);
  }
  pronounPatchedSnapshot(): Set<number> {
    return new Set(this.pronounPatched);
  }

  // ============ resyncInFlight ============

  isResyncInFlight(slot: number): boolean {
    return this.resyncInFlight.has(slot);
  }
  markResyncInFlight(slot: number): void {
    this.resyncInFlight.add(slot);
  }
  clearResyncInFlight(slot: number): boolean {
    return this.resyncInFlight.delete(slot);
  }
  resyncInFlightSnapshot(): Set<number> {
    return new Set(this.resyncInFlight);
  }

  // ============ resyncFailures ============

  getResyncFailure(slot: number): ResyncFailure | undefined {
    return this.resyncFailures.get(slot);
  }
  hasResyncFailure(slot: number): boolean {
    return this.resyncFailures.has(slot);
  }
  setResyncFailure(slot: number, failure: ResyncFailure): void {
    this.resyncFailures.set(slot, failure);
  }
  clearResyncFailure(slot: number): boolean {
    return this.resyncFailures.delete(slot);
  }
  resyncFailuresSnapshot(): Map<number, ResyncFailure> {
    return new Map(this.resyncFailures);
  }

  // ============ originalBackstoryForResync ============

  getOriginalBackstoryForResync(slot: number): string | undefined {
    return this.originalBackstoryForResync.get(slot);
  }
  hasOriginalBackstoryForResync(slot: number): boolean {
    return this.originalBackstoryForResync.has(slot);
  }
  setOriginalBackstoryForResync(slot: number, text: string): void {
    this.originalBackstoryForResync.set(slot, text);
  }
  deleteOriginalBackstoryForResync(slot: number): boolean {
    return this.originalBackstoryForResync.delete(slot);
  }

  // ============ joiningSession ============

  /** Returns 1 (no catch-up) when no value has been set. */
  getJoiningSession(slot: number): number {
    return this.joiningSession.get(slot) ?? 1;
  }
  setJoiningSession(slot: number, n: number): void {
    this.joiningSession.set(slot, n);
  }
  clearJoiningSession(slot: number): boolean {
    return this.joiningSession.delete(slot);
  }
  joiningSessionSnapshot(): Map<number, number> {
    return new Map(this.joiningSession);
  }

  // ============ named reset aggregates ============

  /**
   * Reset when the DM asks the player to revise.  Clears
   * acceptance + drift + pronoun-patch + original-backstory +
   * resync-failure + joining-session.  Does NOT clear
   * `raceMismatch` (revise can land alongside a queued race-
   * mismatch banner — the banner is for re-review, not for
   * the new revise flow).  Mirrors the pre-extraction inline
   * block in revise().
   */
  resetForRevise(slot: number): void {
    this.accepted.delete(slot);
    this.preAcceptOriginals.delete(slot);
    this.pronounPatched.delete(slot);
    this.originalBackstoryForResync.delete(slot);
    this.resyncFailures.delete(slot);
    this.joiningSession.delete(slot);
  }

  /**
   * Reset when a new synth result has just landed (fresh synth or
   * successful re-sync).  Always clears acceptance (the prior
   * accept is now stale against the new prose) + raceMismatch
   * (fresh synth supersedes the race banner).  Conditionally
   * clears the drift Maps when `resyncSucceeded` — the AI just
   * folded the drift back into the new prose.  Mirrors the inline
   * block in synthesizeForSlot().
   */
  resetAfterFreshSynth(
    slot: number,
    opts: { resyncSucceeded: boolean }
  ): void {
    this.accepted.delete(slot);
    this.raceMismatch.delete(slot);
    if (opts.resyncSucceeded) {
      this.preAcceptOriginals.delete(slot);
      this.originalBackstoryForResync.delete(slot);
    }
  }

  /**
   * Reset when the slot's data is wiped wholesale (clearSynth /
   * slot removal).  Clears every lifecycle slot EXCEPT
   * `resyncInFlight` — that in-flight async resolves + cleans
   * itself up via its own finally block.  Mirrors the inline
   * block in deleteSlotData().
   */
  resetForDelete(slot: number): void {
    this.accepted.delete(slot);
    this.preAcceptOriginals.delete(slot);
    this.pronounPatched.delete(slot);
    this.originalBackstoryForResync.delete(slot);
    this.resyncFailures.delete(slot);
    this.raceMismatch.delete(slot);
    this.joiningSession.delete(slot);
  }
}

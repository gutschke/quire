/**
 * D5.5-A step 3 (2026-05-27 E-LARGE-2): async + result lifecycle
 * for chargen slot synthesis.  Bundles the 4 state slots that
 * jointly govern "what's the AI doing for this slot right now":
 *
 *   - `synthResults`   — cached synth output per slot (success or
 *                        failure object)
 *   - `synthInFlight`  — slots whose synthesis is currently
 *                        awaiting an AI call
 *   - `resyncInFlight` — slots whose re-sync is awaiting an AI
 *                        call (moved from ChargenAcceptanceMachine
 *                        in this step — engineering's post-D5.5-A
 *                        review flagged the placement smell)
 *   - `slotGeneration` — per-slot generation counter bumped by
 *                        `bumpGeneration` (called by clearSynth)
 *                        so an in-flight synth resolving on a
 *                        cleared slot can detect the invalidation
 *                        + suppress its own state-write
 *                        (Scenario-4 fix from the playthrough)
 *
 * The class is host-agnostic — owns no Lit host; callers thread
 * `host.requestUpdate()` at the existing call sites.  Each method
 * is a thin wrapper EXCEPT `clearSlot`, which aggregates the
 * "wipe synthResults + bump generation" pair that clearSynth was
 * doing inline.
 *
 * What's NOT in this class:
 *   - Per-slot user-facing state (drift, race-banner, joining-
 *     session) lives in `ChargenAcceptanceMachine` — that's about
 *     DM intent + UI banners, not async lifecycle.
 *   - The async operations themselves (`synthesizeForSlot`,
 *     `resyncBackstoryForSlot`) stay on `ChargenController` —
 *     they call this.env.* APIs heavily; moving them out would
 *     drag the host dependency along.
 */

import type { SynthesizeBackstoryResult } from '../ai/backstory-synthesizer';

export class ChargenSynthLifecycle {
  private readonly synthResults = new Map<number, SynthesizeBackstoryResult>();
  private readonly synthInFlight = new Set<number>();
  private readonly resyncInFlight = new Set<number>();
  private readonly slotGeneration = new Map<number, number>();

  // ============ synthResults ============

  getResult(slot: number): SynthesizeBackstoryResult | undefined {
    return this.synthResults.get(slot);
  }
  hasResult(slot: number): boolean {
    return this.synthResults.has(slot);
  }
  setResult(slot: number, result: SynthesizeBackstoryResult): void {
    this.synthResults.set(slot, result);
  }
  deleteResult(slot: number): boolean {
    return this.synthResults.delete(slot);
  }
  /** Iterator over slot keys with a cached result. */
  resultKeys(): IterableIterator<number> {
    return this.synthResults.keys();
  }

  // ============ synthInFlight ============

  isSynthInFlight(slot: number): boolean {
    return this.synthInFlight.has(slot);
  }
  markSynthInFlight(slot: number): void {
    this.synthInFlight.add(slot);
  }
  clearSynthInFlight(slot: number): boolean {
    return this.synthInFlight.delete(slot);
  }
  /** Total count — used by `hasPendingSynth` gate. */
  synthInFlightSize(): number {
    return this.synthInFlight.size;
  }
  /** Used by `hostDisconnected` to drop a wedged spinner on HMR. */
  clearAllSynthInFlight(): void {
    this.synthInFlight.clear();
  }

  // ============ resyncInFlight ============
  // (moved from ChargenAcceptanceMachine in step 3 — see file
  //  doc for rationale.)

  isResyncInFlight(slot: number): boolean {
    return this.resyncInFlight.has(slot);
  }
  markResyncInFlight(slot: number): void {
    this.resyncInFlight.add(slot);
  }
  clearResyncInFlight(slot: number): boolean {
    return this.resyncInFlight.delete(slot);
  }
  resyncInFlightSnapshot(): ReadonlySet<number> {
    return new Set(this.resyncInFlight);
  }

  // ============ slotGeneration ============

  /**
   * Capture the current generation for `slot` — call this BEFORE
   * any await in an async synthesis operation.  Compare against
   * `currentGeneration(slot)` after the await; if they differ,
   * `bumpGeneration` ran (= clearSynth invalidated the slot mid-
   * flight) and the caller should suppress its state-write.
   */
  captureGeneration(slot: number): number {
    return this.slotGeneration.get(slot) ?? 0;
  }
  /** Same value `captureGeneration` reads — semantic alias for the post-await check. */
  currentGeneration(slot: number): number {
    return this.slotGeneration.get(slot) ?? 0;
  }
  /** Increment the slot's generation.  Called by `clearSlot`. */
  bumpGeneration(slot: number): void {
    this.slotGeneration.set(slot, (this.slotGeneration.get(slot) ?? 0) + 1);
  }

  // ============ aggregate ============

  /**
   * Wipe the slot's cached synth result + bump the generation
   * counter so any in-flight synth/resync resolving after this
   * call suppresses its state-write.  PRESERVES
   * `synthInFlight` + `resyncInFlight` — those finally-blocks
   * own their own teardown.  Returns true when a result was
   * actually deleted (caller uses this to gate
   * `host.requestUpdate`).
   */
  clearSlot(slot: number): boolean {
    const hadResult = this.synthResults.delete(slot);
    this.bumpGeneration(slot);
    return hadResult;
  }
}

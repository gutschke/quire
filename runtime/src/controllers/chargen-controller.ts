/**
 * ChargenController — Lit ReactiveController owning the chargen
 * (character-creation) lifecycle: the player's in-progress answers,
 * the chosen creation path, transient pack-download feedback, the
 * dynamic-import handles for the chargen + DM-review regions, and
 * the end-to-end AI synthesis pipeline.
 *
 * Extracted from `src/quire-app.ts` in Phase 3a Cluster E step 1
 * per the convergent finding from the four-reviewer Phase 2 gate:
 * the chargen flow's host-side surface had grown 4-6 @state fields,
 * 4+ methods, and 2 dynamic-import caches all woven into QuireApp,
 * and the unified DM review surface (P3T-17 ≡ CC-24 ≡ P3U-12 ≡
 * P3E-1) wanted a single seam to consume.  The host contract is
 * deliberately small: anything that's "AI keys", "session", or
 * "campaign loader" stays on QuireApp and is read through the
 * host's getter callbacks.
 *
 * The controller does NOT call out to provider HTTP itself; that
 * still lives in `src/ai/backstory-synthesizer.ts` (the frozen-
 * contract module).  The controller orchestrates: read persisted
 * answers, build player-facing context, dispatch to the synthesizer,
 * cache the result, expose it to the DM-review region.
 *
 * Storage layout: same `quire.chargen.<slug>:slot<N>` localStorage
 * keys used pre-extraction — see `src/chargen-persistence.ts`.
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { LoadedCampaign as LoadedCampaignBase } from '../campaign-loader';
import type { LoadedCharacter } from '../character-loader';

/**
 * The host wraps the loader's `LoadedCampaign` to attach a few
 * extra resolved fields (e.g. `worldOverview`).  The controller
 * only reaches into `.base` so we declare a minimal shape here
 * rather than create a circular import on the wrapper type.
 */
export interface ChargenCampaign {
  base: LoadedCampaignBase;
}
import {
  campaignFingerprint,
  encodeInviteToken
} from '../invite-token';
import { routeToSearch } from '../routing';
import { loadChargenState, saveChargenState } from '../chargen-persistence';
import {
  packChargen,
  parseChargenPack,
  stringifyChargenPack,
  suggestedPackFilename,
  ChargenPackError,
  type ChargenPackDocument
} from '../chargen-pack';
import {
  buildPlayerFacingContext,
  type ContextFile
} from '../ai/campaign-context';
import type { AiProvider as AiProviderImpl } from '../ai/broker';
import type {
  AnsweredQuestion
} from '../ai/backstory-synthesis-prompt';
import type {
  CreationPath,
  CharCreationAnswers
} from '../ui/regions/character-creation';
import type {
  SynthesizeBackstoryResult,
  ResyncContext
} from '../ai/backstory-synthesizer';
import type { PcBackstorySynthesisResponse } from '../ai/schema';

// Provider id matches the AiKeyStore vocabulary.
type AiProvider = 'claude' | 'gemini';

/**
 * Host contract — the slice of QuireApp the controller needs
 * read-only access to.  Each capability is a getter callback so the
 * controller always observes the latest state at decision time
 * (avoids stale-snapshot bugs when the host re-renders mid-flight).
 */
export interface ChargenHost {
  /** Resolved campaign, or undefined when nothing is loaded. */
  getCurrentCampaign(): ChargenCampaign | undefined;
  /** Stable campaign slug used as the chargen-persistence key prefix. */
  getCampaignSlug(campaign: ChargenCampaign): string;
  /** Currently-selected AI provider id. */
  getAiProvider(): AiProvider;
  /** API key for the active provider; empty string if unset. */
  getAiApiKey(): string;
  /** Provider model id (e.g., 'claude-sonnet-4-6'). */
  getAiModel(): string;
  /**
   * Map of provider id → provider impl for the synthesizer call.
   * Returning the whole record (rather than pre-resolving) lets the
   * controller keep its dependency surface narrow.
   */
  getAiProviders(): Record<AiProvider, AiProviderImpl>;
  /**
   * Display name of the inviting peer (the DM).  Forwarded to the
   * synthesizer so the AI knows not to reuse it as the PC's name.
   */
  getDmDisplayName(): string;
  /** Coord-gate: synthesize-and-accept paths require coordinator. */
  isCoordinator(): boolean;
  /**
   * Bound-character cache resolver for the P3U-12 display-name
   * lookup.  Returns the loaded character record (with manifest.name)
   * or null when not yet resolved; the controller treats null as
   * "fall back to pcId text".
   */
  getBoundCharacter(pcId: string): LoadedCharacter | null;
  /**
   * Trigger an async fetch of the named character file so a
   * subsequent `getBoundCharacter` resolves.  Idempotent at the
   * host (the host caches in-flight imports).
   */
  loadCharacterByPcId(pcId: string): void;
  /**
   * Append a `scratch-note` event to the audit log.  CC-24 + P3T-19:
   * accept and revise emit scratch-notes for v1 (per Cluster E
   * planning Q2 — defer a dedicated `chargen-accept` event kind to
   * Phase 3b when CC-4 per-PC SaveDocument is in scope).
   * Returns true when the append succeeded; the controller uses
   * this only for the local-flag update, not for control flow.
   */
  appendScratchNote(text: string): boolean;
  /**
   * Phase 3b-1: append a `pc-create` event that materializes a
   * synthesized PC into shared session state.  Called by
   * `acceptSlot` together with `bindPcSlot` (atomic from the
   * DM's POV) so the loop "DM clicks Accept → player has a sheet"
   * closes in one click.
   */
  appendPcCreate(payload: {
    pcId: string;
    name: string;
    pronouns: string;
    tags: string[];
    stats: {
      str: number;
      dex: number;
      con: number;
      int: number;
      wis: number;
      cha: number;
    };
    skills: string[];
    backstory: string;
    causedByResponseId?: string;
  }): boolean;
  /**
   * Phase 3b-1: bind a slot to a pcId via the existing
   * `pc-slot-bind` event.  Atomically paired with appendPcCreate
   * on accept so the player sees their PC immediately.
   */
  bindPcSlot(slot: number, pcId: string): boolean;
  /**
   * Phase B-prime (2026-05-25): emit a `seat-add` event allocating
   * a new unbound seat at `slot`.  Returns true on success (and
   * the event lands in shared state), false when the seat is
   * already taken or the session isn't active.
   */
  appendSeatAdd(slot: number): boolean;
  /**
   * Wave 1 (2026-05-25): emit a `seat-remove` event for an unbound,
   * empty seat that was added accidentally.  Engine refuses to
   * touch bound seats.  Returns true on append.
   */
  appendSeatRemove(slot: number): boolean;
  /**
   * Phase B-prime (2026-05-25): read the current slot map (post
   * filter-for-viewer) so the controller can compute lowest-unused.
   * Returns an empty map when no session is active.
   */
  getPcSlots(): Record<number, { state: string; pcId?: string }>;
  /**
   * P-R2 (2026-05-25): effective seat cap from the loaded campaign
   * manifest (or DEFAULT_SEAT_CAP fallback).  The controller uses
   * it as the upper bound on addSeat's lowest-unused search.
   */
  getSeatCap(): number;
}

/**
 * Debounce window for the chargen autosave.  Shorter than the
 * play-time autosave (300 ms vs 1500 ms) because the chargen flow
 * has fewer state changes per unit time and the player may close
 * the tab without realizing the autosave is debounced; saving
 * aggressively gives a stronger "your work is safe" guarantee.
 */
const CHARGEN_PERSIST_DEBOUNCE_MS = 300;
const PACK_FEEDBACK_CLEAR_MS = 3000;

export class ChargenController implements ReactiveController {
  /** Player's path selection from chargen step 3.  '' means "not chosen yet". */
  chosenPath: CreationPath | '' = '';

  /** Player's answers keyed by question id. */
  answers: CharCreationAnswers = {};

  /** Transient feedback on the "Pack my character" download. */
  packFeedback: '' | 'packed' | 'pack-failed' = '';

  /**
   * Per-slot AI synthesis result map.  Populated by
   * `synthesizeForSlot`; consumed by the `<chargen-dm-review>`
   * region via the public accessor methods.  The result shape is
   * the load-bearing frozen contract `SynthesizeBackstoryResult`.
   *
   * Private + accessor-gated (Engine M1, c91ac1f post-review): a
   * consumer mutating the Map directly would silently skip the
   * `host.requestUpdate()` call.  Read via `getSynthResult(slot)`;
   * write via the controller's own paths (`synthesizeForSlot`,
   * `clearSynth`).
   */
  private readonly _synthResults = new Map<number, SynthesizeBackstoryResult>();

  /** Slots whose synthesis is currently in-flight (for UI dim/spinner). */
  private readonly _synthInFlight = new Set<number>();

  /** Slots the DM has accepted (CC-24).  Used by the region for the accept-gate dim. */
  private readonly _acceptedSlots = new Set<number>();

  /**
   * Wave 2 (2026-05-25): per-slot snapshot of the original AI-
   * synthesized values for any field the DM has edited before
   * accept.  Each entry records the field's value at the moment of
   * the first edit, so the drift banner can render a "before → now"
   * comparison.  Cleared on dismissPreAcceptDrift / clearSynth /
   * revise.  Pre-acceptance edits are DM-local (the synth result
   * has not been broadcast yet); post-acceptance edits will go
   * through pc-edit in Wave 3 with a separate visibility model.
   */
  private readonly _preAcceptOriginals = new Map<
    number,
    Partial<PcBackstorySynthesisResponse>
  >();

  /**
   * Wave 3 polish (2026-05-25, TTRPG-R4 fix #5): track slots where
   * the last patchInPlace touched pronouns.  The deterministic
   * substitution leaves verb agreement intact ("she was" stays
   * "they was") — surface a non-blocking hint so the DM knows to
   * Re-sync if they care about clean prose.  Cleared on the next
   * edit/dismiss/accept for the slot.
   */
  private readonly _pronounPatchedSlots = new Set<number>();

  /**
   * Post-R5 fix (QA-BUG-5): when Patch-in-place runs and mutates
   * the cached backstory, stash the AI's ORIGINAL prose so a
   * later Re-sync uses it as the voice-anchor (instead of the
   * deterministically-substituted version that may carry verb-
   * agreement glitches the AI would faithfully preserve).
   * Cleared on revise/clearSynth/resync-success (the resync
   * itself produces a fresh original).
   */
  private readonly _originalBackstoryForResync = new Map<number, string>();

  /**
   * Post-R5 fix (QA-BUG-3): re-sync is async (10-30s).  While it's
   * in flight, accept / revise / edit calls must be gated so a
   * stale-pre-resync commit doesn't race the new AI output.
   * Previously this lived ONLY on the UI element (lost across
   * re-creation, bypassable by non-UI callers).  Lifted to the
   * controller as the single source of truth.
   */
  private readonly _resyncInFlight = new Set<number>();

  /**
   * Code-split: cached dynamic-imports for the chargen surfaces.
   * Same lazy posture as pre-extraction — a regular play session
   * never imports these.
   */
  private chargenRegionLoaded: Promise<void> | null = null;
  private synthesizerLoaded: Promise<
    typeof import('../ai/backstory-synthesizer')
  > | null = null;

  /** Per-slot debounced persist timers; one per (slug, slot) pair. */
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private packFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly env: ChargenHost
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    /* no-op — state seeds on the chargen-route navigation. */
  }

  hostDisconnected(): void {
    // Flush any pending persist timers so a tab close mid-typing
    // doesn't lose the last <300 ms of edits.  Same discipline as
    // AiKeyStore.hostDisconnected.
    this.flushPending();
    if (this.packFeedbackTimer) {
      clearTimeout(this.packFeedbackTimer);
      this.packFeedbackTimer = null;
    }
    // Engine M3 (defer-followup): in-flight synthesis aborts when
    // a real AbortSignal is plumbed through; until then, just clear
    // the inflight flag so an HMR reconnect doesn't see a wedged
    // spinner.
    this._synthInFlight.clear();
  }

  // ---- setters that re-render the host ----

  setChosenPath(path: CreationPath | ''): void {
    if (this.chosenPath === path) return;
    this.chosenPath = path;
    this.host.requestUpdate();
  }

  setAnswer(id: string, value: string): void {
    if (this.answers[id] === value) return;
    this.answers = { ...this.answers, [id]: value };
    this.host.requestUpdate();
  }

  /**
   * Replace the entire answers map (used by `seedFromStorage`).
   * Use sparingly; prefer `setAnswer` for per-keystroke writes.
   */
  setAnswers(answers: CharCreationAnswers): void {
    this.answers = answers;
    this.host.requestUpdate();
  }

  // ---- read accessors for the DM-review region (Engine M1) ----

  /** Latest synthesis result for the slot, or undefined. */
  getSynthResult(slot: number): SynthesizeBackstoryResult | undefined {
    return this._synthResults.get(slot);
  }

  /** True when synthesis is in-flight for the slot. */
  isSynthInFlight(slot: number): boolean {
    return this._synthInFlight.has(slot);
  }

  /** True when the DM has accepted the slot's current synth result. */
  isAccepted(slot: number): boolean {
    return this._acceptedSlots.has(slot);
  }

  /**
   * Iterate over slots that have a synth result OR an accept flag.
   * Used by the DM-review region to render per-seat cards.
   */
  slotsWithSynthState(): number[] {
    const slots = new Set<number>();
    for (const s of this._synthResults.keys()) slots.add(s);
    for (const s of this._acceptedSlots) slots.add(s);
    return [...slots].sort((a, b) => a - b);
  }

  /**
   * P3T-16: return the saved short-answer-key answers for a slot,
   * read from localStorage on demand.  Returns null when no
   * chargen state exists yet (player hasn't reached the chargen
   * flow or the data lives on a different device).  Used by the
   * DM-review SA-vs-backstory diff to render the player's answers
   * alongside the synthesized backstory.
   *
   * Reads localStorage on every call — cheap (small JSON parse) and
   * keeps the call site simple.  Future caching can land if the
   * cost ever shows up.
   */
  loadPersistedAnswers(slot: number): CharCreationAnswers | null {
    const campaign = this.env.getCurrentCampaign();
    if (!campaign) return null;
    if (!Number.isInteger(slot) || slot < 1 || slot > 9) return null;
    const slug = this.env.getCampaignSlug(campaign);
    const persisted = loadChargenState(slug, slot);
    return persisted?.answers ?? null;
  }

  // ---- write accessors (step 4 wires accept/revise; step 1 stubs them out) ----

  /**
   * CC-24 accept.  Phase 3b-1 closes the loop: emits a `pc-create`
   * event (materializes the synthesized PC into shared state) +
   * `pc-slot-bind` (binds the slot to the new pcId) atomically, then
   * appends the audit scratch-note that was the v1 acceptance
   * receipt.  At session 1, one DM click takes the seat from "synth
   * result ready" to "playable PC bound" — `boundCharacter` resolves
   * via the loader-overlay (step 2), the player sees the sheet, the
   * dice-Dock gets stats, Cast macros render.
   *
   * No-ops when there's no synth result yet OR the slot was already
   * accepted OR the result is a failure.
   *
   * pcId derivation: `slot-${slot}-${first 8 chars of responseId}`.
   * Stable per synth, unique per re-synth (different responseId →
   * different hash), human-debuggable, fits `PC_ID_RE`.  Orphan
   * records from prior re-syntheses accumulate harmlessly in
   * `state.synthesizedPcs` — cleanup is a deferred-followup, not a
   * blocker for civilized players.
   */
  /**
   * Phase B-prime (2026-05-25): allocate a new unbound seat for
   * chargen.  Returns the slot allocated (lowest unused 1..9) or
   * null when the soft cap (9) is reached / not coord / no
   * campaign / session isn't active.
   */
  addSeat(): number | null {
    if (!this.env.isCoordinator()) return null;
    if (!this.env.getCurrentCampaign()) return null;
    const taken = new Set<number>();
    for (const slotStr of Object.keys(this.env.getPcSlots())) {
      taken.add(Number(slotStr));
    }
    const cap = this.env.getSeatCap();
    for (let slot = 1; slot <= cap; slot++) {
      if (taken.has(slot)) continue;
      if (this.env.appendSeatAdd(slot)) return slot;
      break; // fall through; appendSeatAdd failure means no session
    }
    return null;
  }

  /**
   * Wave 1 (2026-05-25): drop an accidentally-added seat.  Returns
   * true on append.  Refuses when seat is bound (engine also
   * refuses, but failing fast here avoids the round-trip) or when
   * the controller side has any in-flight work for that slot
   * (pending synth, displayed result, accepted) — those imply
   * "the DM is using this seat," even if the engine state says
   * unbound.  Also clears local controller-side caches.
   */
  removeSeat(slot: number): boolean {
    if (!this.env.isCoordinator()) return false;
    const slots = this.env.getPcSlots();
    const seat = slots[slot];
    if (!seat || seat.state !== 'unbound') return false;
    if (this._synthResults.has(slot)) return false;
    if (this._synthInFlight.has(slot)) return false;
    if (this._acceptedSlots.has(slot)) return false;
    if (!this.env.appendSeatRemove(slot)) return false;
    return true;
  }

  /**
   * Wave 1 (2026-05-25): undo a `removeSeat` within its UI window
   * by re-allocating the exact slot integer.  Skips the lowest-
   * unused search that `addSeat` performs.  The engine's seat-add
   * is idempotent on bound slots so a race (someone bound the
   * slot in the 4s window) is a safe no-op.
   */
  readdSeat(slot: number): boolean {
    if (!this.env.isCoordinator()) return false;
    if (!Number.isInteger(slot) || slot < 1) return false;
    return this.env.appendSeatAdd(slot);
  }

  /**
   * Wave 2 (2026-05-25): patch one or more fields on the in-memory
   * synth result before the DM accepts.  Mutates the cached result
   * in place and, on first touch of any field, snapshots the
   * original AI value so the drift banner can render before/after.
   *
   * Pre-acceptance edits are DM-local — the synth result is only
   * in this controller's cache; no event broadcast.  The eventual
   * `acceptSlot` will read the (now-edited) result and emit a
   * pc-create with the final values.  Per the chargen-authorship
   * memory, pre-launch silent edits are appropriate; post-launch
   * (post-accept) edits route through pc-edit with a different
   * visibility model in Wave 3.
   *
   * Returns false when the slot has no ok-synth-result or the slot
   * is already accepted (post-accept edits use pc-edit).
   */
  editSynthFieldPreAccept(
    slot: number,
    patch: Partial<PcBackstorySynthesisResponse>
  ): boolean {
    if (this._acceptedSlots.has(slot)) return false;
    // Post-R5 fix (QA-BUG-3): no edits during re-sync — the AI is
    // about to overwrite the response anyway.
    if (this._resyncInFlight.has(slot)) return false;
    const result = this._synthResults.get(slot);
    if (!result || !result.ok) return false;
    let original = this._preAcceptOriginals.get(slot);
    if (!original) {
      original = {};
      this._preAcceptOriginals.set(slot, original);
    }
    const origAny = original as Record<string, unknown>;
    // Post-R5 fix (QA-BUG-2): clone the synth-result before
    // mutating it.  Previously we mutated `result.response` in
    // place, which meant any external reference (test snapshots,
    // future debug tools, replay harnesses) saw the post-edit
    // value as if it were the original AI output.  Cloning makes
    // the synth-result snapshot immutable to outside readers; the
    // controller's own cache replaces the entry atomically.
    const respClone: Record<string, unknown> = {
      ...(result.response as unknown as Record<string, unknown>)
    };
    const patchAny = patch as Record<string, unknown>;
    for (const key of Object.keys(patch)) {
      if (!(key in origAny)) origAny[key] = respClone[key];
      respClone[key] = patchAny[key];
    }
    this._synthResults.set(slot, {
      ...result,
      response: respClone as unknown as PcBackstorySynthesisResponse
    });
    // Any further edit invalidates the prior pronoun-patch hint —
    // the DM has moved on or the prose changed again.
    this._pronounPatchedSlots.delete(slot);
    // Post-R5 (QA-BUG-4): edit means the DM noticed the failure
    // banner and chose a different path — clear it.
    this._resyncFailures.delete(slot);
    this.host.requestUpdate();
    return true;
  }

  /**
   * Wave 2 (2026-05-25): read the drift map for a slot — the fields
   * the DM has edited pre-accept, mapped to their original AI
   * values.  Returns undefined when the slot has no recorded
   * drift.  The UI uses this to render the "Name: Mei → Mai"
   * before/after on the drift banner.
   */
  getPreAcceptDrift(
    slot: number
  ): Partial<PcBackstorySynthesisResponse> | undefined {
    return this._preAcceptOriginals.get(slot);
  }

  /**
   * Wave 2 (2026-05-25): "Leave drift" — the DM has decided to
   * accept the field divergence between their edit and the AI's
   * original output.  Clears the drift entry so the banner stops
   * surfacing.  Pass `field` to dismiss one entry; omit to dismiss
   * all drift for the slot.  The synth result itself is not
   * touched — the edit stays.
   */
  dismissPreAcceptDrift(
    slot: number,
    field?: keyof PcBackstorySynthesisResponse
  ): void {
    const original = this._preAcceptOriginals.get(slot);
    if (!original) return;
    if (field !== undefined) {
      delete (original as Record<string, unknown>)[field];
      if (Object.keys(original).length === 0) {
        this._preAcceptOriginals.delete(slot);
      }
    } else {
      this._preAcceptOriginals.delete(slot);
    }
    this.host.requestUpdate();
  }

  /**
   * Wave 2 (2026-05-25): full snapshot of all slots' drift state,
   * suitable for passing into the UI as a property.  The UI uses
   * the keys to know which slots have a banner to show.
   *
   * Post-R5 fix (QA-BUG-1): returns a shallow clone (Map + per-slot
   * Partial copies) so the host's property-pass-through doesn't
   * share identity with the internal cache.  Without this, a Lit
   * keyed-render that compares Map identity would never see drift
   * updates; today renders survive only because `requestUpdate()`
   * fires unconditionally.  Defense-in-depth + makes the API
   * harder to misuse.
   */
  preAcceptDriftMap(): Map<number, Partial<PcBackstorySynthesisResponse>> {
    const out = new Map<number, Partial<PcBackstorySynthesisResponse>>();
    for (const [slot, drift] of this._preAcceptOriginals) {
      out.set(slot, { ...drift });
    }
    return out;
  }

  /**
   * Wave 3a (2026-05-25): apply a deterministic find-replace to the
   * cached backstory based on the patchable subset of drift entries
   * (name + pronouns).  No AI call required; appropriate for
   * "Mei → Mai" and "she/her → they/them" identifier swaps.
   *
   * Tag/skill/stat edits and substantial pronoun rewrites need
   * AI re-sync (Wave 3b).  This method silently skips those fields;
   * caller checks `patchableDriftFields(slot)` to know which were
   * deterministically applied.
   *
   * Returns true when at least one field was patched; false when
   * the slot has no patchable drift.  Dismisses the drift entries
   * that were applied so the banner reflects the new state.
   */
  patchInPlace(slot: number): boolean {
    if (this._acceptedSlots.has(slot)) return false;
    // Post-R5 fix (QA-BUG-3): no Patch during re-sync.
    if (this._resyncInFlight.has(slot)) return false;
    const result = this._synthResults.get(slot);
    if (!result || !result.ok) return false;
    const drift = this._preAcceptOriginals.get(slot);
    if (!drift) return false;
    const patchable = this.patchableDriftFields(slot);
    if (patchable.length === 0) return false;
    let text = result.response.backstory;
    for (const field of patchable) {
      if (field === 'name') {
        const old = drift.name;
        const next = result.response.name;
        if (typeof old === 'string' && typeof next === 'string' && old !== next) {
          text = replaceAll(text, old, next);
        }
      } else if (field === 'pronouns') {
        const old = drift.pronouns;
        const next = result.response.pronouns;
        if (typeof old === 'string' && typeof next === 'string' && old !== next) {
          text = applyPronounSubstitutions(text, old, next);
        }
      }
    }
    // Apply the patched backstory + dismiss the drift entries that
    // were honored.  The backstory edit itself does NOT add a new
    // drift entry — it's a direct application of existing drift.
    //
    // Post-R5 fix (QA-BUG-2): clone before mutation (same reasoning
    // as editSynthFieldPreAccept).
    // Post-R5 fix (QA-BUG-5): stash the original (pre-patch)
    // backstory so a later Re-sync uses the AI's draft as the
    // voice anchor, not the deterministically-substituted prose
    // that may carry "they was" verb-agreement glitches.
    if (!this._originalBackstoryForResync.has(slot)) {
      this._originalBackstoryForResync.set(slot, result.response.backstory);
    }
    const respClone: PcBackstorySynthesisResponse = {
      ...result.response,
      backstory: text
    };
    this._synthResults.set(slot, { ...result, response: respClone });
    const pronounWasPatched = patchable.includes('pronouns');
    for (const field of patchable) {
      delete (drift as Record<string, unknown>)[field];
    }
    if (Object.keys(drift).length === 0) {
      this._preAcceptOriginals.delete(slot);
    }
    // Wave 3 polish: mark the slot so the UI can hint about
    // potential verb-agreement glitches the substitution doesn't
    // catch.  Cleared on next edit/dismiss/accept/clear.
    if (pronounWasPatched) {
      this._pronounPatchedSlots.add(slot);
    }
    this.host.requestUpdate();
    return true;
  }

  /**
   * Wave 3 polish: read whether the slot's last patchInPlace touched
   * pronouns.  UI uses this to render a "Re-sync to clean up verb
   * agreement" hint.
   */
  wasPronounRecentlyPatched(slot: number): boolean {
    return this._pronounPatchedSlots.has(slot);
  }

  /**
   * Wave 3 polish: dismiss the pronoun-patch hint (e.g., DM saw it
   * and moved on).  Also called automatically on next edit/dismiss/
   * accept/clear for the slot.
   */
  dismissPronounPatchHint(slot: number): void {
    if (this._pronounPatchedSlots.has(slot)) {
      this._pronounPatchedSlots.delete(slot);
      this.host.requestUpdate();
    }
  }

  /**
   * Wave 3 polish: full snapshot of slots with a pending pronoun-
   * patch hint, for the UI property pass.  Post-R5 fix (QA-BUG-1):
   * returns a fresh Set so the host's @property identity check
   * sees a new value on every accessor call.
   */
  pronounPatchedSlotsSet(): ReadonlySet<number> {
    return new Set(this._pronounPatchedSlots);
  }

  /**
   * Wave 3a: which drift fields can be patched deterministically
   * (find-replace, no AI).  Currently: `name` and `pronouns`.
   * Other fields (tags / skillMastery / stats) require AI re-sync
   * (Wave 3b).
   */
  patchableDriftFields(
    slot: number
  ): Array<'name' | 'pronouns'> {
    const drift = this._preAcceptOriginals.get(slot);
    if (!drift) return [];
    const out: Array<'name' | 'pronouns'> = [];
    if ('name' in drift) out.push('name');
    if ('pronouns' in drift) out.push('pronouns');
    return out;
  }

  acceptSlot(slot: number): void {
    if (this._acceptedSlots.has(slot)) return;
    // Post-R5 fix (QA-BUG-3): refuse to commit while a re-sync is
    // in flight — the result is about to be replaced.  Belt-and-
    // suspenders alongside the UI-level gate so non-UI callers
    // (tests, hotkeys) can't sneak past.
    if (this._resyncInFlight.has(slot)) return;
    const result = this._synthResults.get(slot);
    if (!result || !result.ok) return; // can't accept failures
    const r = result.response;

    // Derive the pcId from slot + a short hash of responseId.
    const pcId = derivePcId(slot, r.responseId);
    if (!pcId) return; // defensive: bail if responseId was unusable

    // Translate the synthesizer's uppercase PcStats → lowercase
    // CharacterRecord stats.  The materializer validates lowercase
    // only; this is the single translation point.
    const statsLower = {
      str: r.stats.STR,
      dex: r.stats.DEX,
      con: r.stats.CON,
      int: r.stats.INT,
      wis: r.stats.WIS,
      cha: r.stats.CHA
    };

    // Emit the materialization event FIRST so that when the
    // pc-slot-bind lands, the synthesizedPcs map already has the
    // record — the loader-overlay resolves in one pass.  Both
    // events come from the same peer in the same materialize call,
    // so the per-peer monotonic seq guarantees ordering on replay.
    const appended = this.env.appendPcCreate({
      pcId,
      name: r.name,
      pronouns: r.pronouns,
      tags: r.tags,
      stats: statsLower,
      skills: r.skillMastery,
      backstory: r.backstory,
      causedByResponseId: r.responseId
    });
    if (!appended) return; // host gated (non-coord, no session) — preserve invariant

    // Bind the slot now that the PC exists.
    this.env.bindPcSlot(slot, pcId);

    // Audit-trail scratch-note retains the existing v1 shape — a
    // future audit tool can parse "DM accepted synthesized PC for
    // slot N: name=X, responseId=Y" without needing to know about
    // the pc-create event kind.
    this._acceptedSlots.add(slot);
    this.env.appendScratchNote(
      `DM accepted synthesized PC for slot ${slot}: name="${r.name}", responseId=${r.responseId}.`
    );
    this.host.requestUpdate();
  }

  /**
   * Phase 3b polish (2026-05-23): DM hand-edits a spoiler-leak-
   * rejected synth result and accepts it.  Used when the spoiler
   * firewall caught the AI but most of the backstory is salvageable
   * — the DM rewrites the offending sentence(s) and commits.
   *
   * Replaces the slot's failed result with a synthesized ok result
   * whose backstory + name are the DM-edited values; other fields
   * (pronouns, tags, stats, skillMastery) come from the
   * rejectedResponse.  Then runs the normal acceptSlot flow.
   *
   * Returns false when the slot has no rejected response to edit
   * (the UI should hide the affordance in that case).
   */
  acceptWithEdits(
    slot: number,
    edits: { name: string; backstory: string }
  ): boolean {
    const failed = this._synthResults.get(slot);
    if (
      !failed ||
      failed.ok ||
      !failed.rejectedResponse
    ) {
      return false;
    }
    const cleaned: SynthesizeBackstoryResult = {
      ok: true,
      response: {
        ...failed.rejectedResponse,
        name: edits.name,
        backstory: edits.backstory
      },
      warnings: [
        {
          severity: 'warning',
          code: 'dm-hand-edited',
          message:
            'DM hand-edited the backstory after a spoiler-leak rejection.'
        }
      ],
      retried: true
    };
    this._synthResults.set(slot, cleaned);
    this.host.requestUpdate();
    // Now commit via the normal accept path.
    this.acceptSlot(slot);
    return true;
  }

  /**
   * P3T-19 revise.  Drops the cached synth result + accept flag so
   * the region's seat shows the bare "ready to synthesize" state;
   * appends an audit scratch-note carrying the optional reason the
   * DM provides (the region's prompt asks for one).  Used when the
   * DM wants the player to revise an answer before re-synthesizing.
   */
  requestReviseSlot(
    slot: number,
    reason?: string,
    pinnedQuestionIds?: readonly string[]
  ): void {
    if (!this._synthResults.has(slot) && !this._acceptedSlots.has(slot)) return;
    // Post-R5 fix (QA-BUG-3): the re-sync about to land will
    // produce a new synth-result.  Revise would clear it anyway,
    // but firing both creates a race — refuse during the window.
    if (this._resyncInFlight.has(slot)) return;
    this._synthResults.delete(slot);
    this._acceptedSlots.delete(slot);
    this._preAcceptOriginals.delete(slot);
    this._pronounPatchedSlots.delete(slot);
    this._originalBackstoryForResync.delete(slot);
    this._resyncFailures.delete(slot);
    const trimmedReason = reason?.trim() ?? '';
    const parts: string[] = [
      trimmedReason
        ? `DM asked player at slot ${slot} to revise.  Reason: ${trimmedReason}`
        : `DM asked player at slot ${slot} to revise.`
    ];
    // Wave 3c: when the DM pinned some questions, record the list
    // in the scratch note so the audit trail (and eventually the
    // player-side chargen pre-fill) can reference it.
    if (pinnedQuestionIds && pinnedQuestionIds.length > 0) {
      parts.push(
        `Kept answers for: ${pinnedQuestionIds.join(', ')}.`
      );
    }
    this.env.appendScratchNote(parts.join('  '));
    this.host.requestUpdate();
  }

  // ---- chargen-route seeding ----

  /**
   * Seed the in-memory chargen state from localStorage for the
   * given campaign+slot.  Called by the chargen-route loader in
   * QuireApp when the player visits an `?invite=` URL.  When no
   * persisted state exists (first visit, or different device),
   * resets to empty.
   */
  seedFromStorage(slug: string, slot: number): void {
    const resumed = loadChargenState(slug, slot);
    if (resumed) {
      this.chosenPath = resumed.chosenPath;
      this.answers = resumed.answers;
    } else {
      this.chosenPath = '';
      this.answers = {};
    }
    this.host.requestUpdate();
  }

  /**
   * Per-slot pending values awaiting their debounce flush.  Kept
   * separately from the timer map so `flushPending` can write them
   * synchronously without re-reading mutable `this.chosenPath` /
   * `this.answers` (avoids a race when multiple slots are in
   * flight).
   */
  private persistPendingValues = new Map<
    string,
    {
      slug: string;
      slot: number;
      chosenPath: CreationPath | '';
      answers: CharCreationAnswers;
    }
  >();

  /**
   * Debounced persist of the current chargen state.  Per-slot
   * (slug+slot) timer so concurrent edits to different slots don't
   * stomp each other.
   */
  persistDebounced(campaign: ChargenCampaign, slot: number): void {
    const slug = this.env.getCampaignSlug(campaign);
    const key = `${slug}:${slot}`;
    const existing = this.persistTimers.get(key);
    if (existing) clearTimeout(existing);
    // Snapshot the current state into pending; flush will write it.
    this.persistPendingValues.set(key, {
      slug,
      slot,
      chosenPath: this.chosenPath,
      answers: { ...this.answers }
    });
    this.persistTimers.set(
      key,
      setTimeout(() => {
        this.flushPendingPersistForKey(key);
      }, CHARGEN_PERSIST_DEBOUNCE_MS)
    );
  }

  private flushPendingPersistForKey(key: string): void {
    const pending = this.persistPendingValues.get(key);
    const timer = this.persistTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.persistTimers.delete(key);
    }
    if (!pending) return;
    this.persistPendingValues.delete(key);
    saveChargenState(pending.slug, pending.slot, {
      chosenPath: pending.chosenPath,
      answers: pending.answers
    });
  }

  /**
   * Force any pending debounced persists to flush immediately.
   * Mirrors AiKeyStore.flushPending — used at known checkpoints
   * (chargen-route exit) and by tests so they don't need fake
   * timers.
   */
  flushPending(): void {
    for (const key of [...this.persistPendingValues.keys()]) {
      this.flushPendingPersistForKey(key);
    }
  }

  // ---- pack + download (CC-10) ----

  packAndDownload(campaign: ChargenCampaign, slot: number): void {
    try {
      const fingerprint = campaignFingerprint(campaign.base.source);
      const doc = packChargen({
        campaignFingerprint: fingerprint,
        slot,
        chosenPath: this.chosenPath,
        answers: this.answers
      });
      const json = stringifyChargenPack(doc);
      const filename = suggestedPackFilename(
        doc,
        this.env.getCampaignSlug(campaign)
      );
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      this.packFeedback = 'packed';
    } catch (e) {
      if (
        e instanceof ChargenPackError ||
        e instanceof Error // includes URL.createObjectURL failures in sandboxed envs
      ) {
        this.packFeedback = 'pack-failed';
      } else {
        throw e;
      }
    }
    this.host.requestUpdate();
    // Auto-clear feedback after 3 seconds so the next interaction
    // doesn't see stale text.
    if (this.packFeedbackTimer) clearTimeout(this.packFeedbackTimer);
    this.packFeedbackTimer = setTimeout(() => {
      this.packFeedbackTimer = null;
      if (
        this.packFeedback === 'packed' ||
        this.packFeedback === 'pack-failed'
      ) {
        this.packFeedback = '';
        this.host.requestUpdate();
      }
    }, PACK_FEEDBACK_CLEAR_MS);
  }

  // ---- DM-side pack import (Phase 3b polish 2026-05-22) ----

  /**
   * Accept a packed character JSON the DM received from a player
   * (file picker / drag-drop / future WebRTC delivery) and write
   * the answers into the slot's local persistence so the existing
   * Synthesize flow can consume them.  Returns a discriminated
   * result; the UI surfaces a precise message.
   *
   * Cross-campaign safety: the pack's campaignFingerprint must
   * match the currently-loaded campaign.  Slot mismatch is
   * surfaced as a typed error (the DM may have dropped the file
   * onto the wrong seat) so the UI can offer "Apply to slot N
   * instead?" or similar.
   */
  importPack(
    pack: ChargenPackDocument,
    targetSlot: number
  ):
    | { ok: true; appliedSlot: number }
    | {
        ok: false;
        code: 'no-campaign' | 'campaign-mismatch' | 'slot-mismatch';
        message: string;
      } {
    const campaign = this.env.getCurrentCampaign();
    if (!campaign) {
      return {
        ok: false,
        code: 'no-campaign',
        message: 'No campaign loaded; cannot apply pack.'
      };
    }
    const fingerprint = campaignFingerprint(campaign.base.source);
    if (pack.campaignFingerprint !== fingerprint) {
      return {
        ok: false,
        code: 'campaign-mismatch',
        message:
          `This pack is for a different campaign (fingerprint mismatch).  ` +
          `Load the right campaign first, then re-import.`
      };
    }
    if (pack.slot !== targetSlot) {
      return {
        ok: false,
        code: 'slot-mismatch',
        message:
          `Pack was created for slot ${pack.slot}, but you dropped it on ` +
          `slot ${targetSlot}.  Apply to slot ${pack.slot}, or ask the ` +
          `player to re-pack with the correct invite link.`
      };
    }
    const slug = this.env.getCampaignSlug(campaign);
    saveChargenState(slug, pack.slot, {
      chosenPath: pack.chosenPath,
      answers: pack.answers
    });
    // Wipe any cached synth result for this slot — the DM will
    // re-synth from the freshly-loaded answers.
    this.clearSynth(pack.slot);
    this.host.requestUpdate();
    return { ok: true, appliedSlot: pack.slot };
  }

  /**
   * Convenience helper: parse a raw JSON string and import it.
   * Lets the UI hand over the file contents directly without
   * needing to import the pack-parser separately.
   */
  importPackFromText(
    raw: string,
    targetSlot: number
  ):
    | { ok: true; appliedSlot: number }
    | {
        ok: false;
        code:
          | 'malformed'
          | 'no-campaign'
          | 'campaign-mismatch'
          | 'slot-mismatch';
        message: string;
      } {
    let parsed: ChargenPackDocument;
    try {
      parsed = parseChargenPack(raw);
    } catch (e) {
      if (e instanceof ChargenPackError) {
        return { ok: false, code: 'malformed', message: e.message };
      }
      return {
        ok: false,
        code: 'malformed',
        message: `Couldn't read pack file: ${(e as Error).message}`
      };
    }
    return this.importPack(parsed, targetSlot);
  }

  // ---- invite URL (CC-12) ----

  generateInviteUrl(slot: number): Promise<string | null> {
    if (!this.env.isCoordinator()) return Promise.resolve(null);
    const campaign = this.env.getCurrentCampaign();
    if (!campaign) return Promise.resolve(null);
    if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
      return Promise.resolve(null);
    }
    try {
      const fingerprint = campaignFingerprint(campaign.base.source);
      const token = encodeInviteToken({
        slot,
        issuedAt: Date.now(),
        campaignFingerprint: fingerprint
      });
      const search = routeToSearch({
        kind: 'character-creation',
        slug: this.env.getCampaignSlug(campaign),
        inviteToken: token
      });
      return Promise.resolve(
        `${window.location.origin}${window.location.pathname}${search}`
      );
    } catch {
      return Promise.resolve(null);
    }
  }

  // ---- code-split helpers ----

  loadChargenRegion(): Promise<void> {
    if (this.chargenRegionLoaded) return this.chargenRegionLoaded;
    this.chargenRegionLoaded = import(
      '../ui/regions/character-creation'
    ).then(() => undefined);
    return this.chargenRegionLoaded;
  }

  /**
   * Step 2: lazy-load the `<chargen-dm-review>` region.  Idempotent
   * — returns the in-flight promise so concurrent callers share one
   * fetch.  Subsequent re-mounts hit the cache.
   */
  loadDmReviewRegion(): Promise<void> {
    if (this.dmReviewRegionLoaded) return this.dmReviewRegionLoaded;
    this.dmReviewRegionLoaded = import(
      '../ui/regions/chargen-dm-review'
    ).then(() => {
      this.dmReviewRegionDefined = true;
      this.host.requestUpdate();
    });
    return this.dmReviewRegionLoaded;
  }

  /** Set to true once `loadDmReviewRegion()` resolves. */
  dmReviewRegionDefined: boolean = false;
  private dmReviewRegionLoaded: Promise<void> | null = null;

  private loadSynthesizerModule(): Promise<
    typeof import('../ai/backstory-synthesizer')
  > {
    if (!this.synthesizerLoaded) {
      this.synthesizerLoaded = import('../ai/backstory-synthesizer');
    }
    return this.synthesizerLoaded;
  }

  // ---- end-to-end AI synthesis (CC-17 + CC-19 + CC-20 + CC-21 + CC-23) ----

  /**
   * End-to-end backstory synthesis for one slot.  Mirrors the
   * pre-extraction `quire-app.synthesizeBackstoryForSlot` verbatim,
   * but reads its dependencies via the host getters.  Returns the
   * frozen-contract `SynthesizeBackstoryResult` so the DM-review
   * region can consume the typed shape directly (no lossy adapter).
   */
  async synthesizeForSlot(
    slot: number,
    options: {
      playerDisplayName?: string;
      dmConstraints?: string;
      /**
       * DM-supplied answers used INSTEAD of the device-persisted
       * answers.  Set this to drive synthesis from the DM's quick-
       * generate form when no player answers exist on this device
       * — pass `{}` to synthesize purely from campaign context +
       * dmConstraints.  When omitted, the controller reads
       * persisted answers as before.
       */
      inlineAnswers?: CharCreationAnswers;
      /**
       * Wave 3b (2026-05-25): re-sync mode.  When set, the
       * synthesizer is told to honor the previous backstory's
       * voice + the locked-in DM-edited field values; output is
       * a new backstory that uses the edited values verbatim.
       */
      resync?: ResyncContext;
    } = {}
  ): Promise<SynthesizeBackstoryResult> {
    const campaign = this.env.getCurrentCampaign();
    if (!campaign) {
      return {
        ok: false,
        code: 'provider-error',
        message: 'No campaign loaded; cannot synthesize.'
      };
    }
    if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
      return {
        ok: false,
        code: 'provider-error',
        message: `Slot ${slot} is out of range [1, 9].`
      };
    }
    const slug = this.env.getCampaignSlug(campaign);
    // inlineAnswers wins when the DM is driving quick-generate.
    // Otherwise fall back to per-device persistence.
    let answersMap: CharCreationAnswers;
    if (options.inlineAnswers !== undefined) {
      answersMap = options.inlineAnswers;
    } else {
      const persisted = loadChargenState(slug, slot);
      if (!persisted) {
        return {
          ok: false,
          code: 'provider-error',
          message:
            `No chargen answers for slot ${slot} on this device.  ` +
            `Either load the player's packed character (the "Load packed character" button) ` +
            `or use Quick-generate to drive synthesis from a DM-supplied prompt.`
        };
      }
      answersMap = persisted.answers;
    }
    const provider = this.env.getAiProvider();
    const apiKey = this.env.getAiApiKey();
    if (!apiKey) {
      return {
        ok: false,
        code: 'provider-error',
        message: `No API key configured for provider "${provider}".`
      };
    }
    const declared =
      campaign.base.manifest.characterCreation?.questions ?? [];
    const answers: AnsweredQuestion[] = [];
    for (const q of declared) {
      const a = answersMap[q.id];
      if (a !== undefined && a !== '') {
        answers.push({ question: q, answer: a });
      }
    }
    let context: ContextFile[];
    try {
      context = await buildPlayerFacingContext({
        source: campaign.base.source,
        episodes: (campaign.base.manifest.episodes ?? []).map((slug) => ({
          slug
        })),
        characters: campaign.base.manifest.characters
      });
    } catch (e) {
      return {
        ok: false,
        code: 'provider-error',
        message: `Failed to build campaign context: ${(e as Error).message}`
      };
    }
    // P3D-1 hybrid seam: campaign-declared spoiler tokens + place
    // allowlist flow from `aiBackstory` in the manifest through to
    // the synthesizer.
    const aiBackstory = campaign.base.manifest.aiBackstory;
    const spoilerTokens = aiBackstory?.spoilerTokens;
    const placeAllowlist = aiBackstory?.placeAllowlist;
    this._synthInFlight.add(slot);
    this.host.requestUpdate();
    try {
      const mod = await this.loadSynthesizerModule();
      const result = await mod.synthesizeBackstory(
        this.env.getAiProviders()[provider],
        {
          campaignContext: context,
          dmConstraints: options.dmConstraints ?? '',
          playerDisplayName: options.playerDisplayName ?? '',
          answers,
          apiKey,
          model: this.env.getAiModel(),
          spoilerTokens,
          validatorOptions: {
            playerDisplayName: options.playerDisplayName,
            placeAllowlist
          },
          ...(options.resync ? { resync: options.resync } : {})
        }
      );
      this._synthResults.set(slot, result);
      // Re-synthesizing clears any prior accept for the same slot —
      // accepting the OLD result and then re-synthesizing would
      // otherwise leave the accept stale.
      this._acceptedSlots.delete(slot);
      // Wave 3b: when this was a successful re-sync, clear ALL
      // drift entries for the slot — the AI has folded them into
      // the new backstory, so the drift banner should disappear.
      if (options.resync && result.ok) {
        this._preAcceptOriginals.delete(slot);
        // Post-R5 (QA-BUG-5): re-sync produced fresh prose; any
        // stashed pre-Patch original is now stale.
        this._originalBackstoryForResync.delete(slot);
      }
      return result;
    } finally {
      this._synthInFlight.delete(slot);
      this.host.requestUpdate();
    }
  }

  /**
   * Wave 3b (2026-05-25): re-sync the backstory for a slot after
   * the DM has edited one or more synth-result fields.  Builds the
   * ResyncContext from the current synth result + drift snapshot
   * and delegates to synthesizeForSlot in resync mode.
   *
   * Returns null when the slot has no synth result OR no drift
   * to re-sync against — the UI should hide the verb in that case.
   */
  async resyncBackstoryForSlot(
    slot: number,
    options: { playerDisplayName?: string; dmConstraints?: string } = {}
  ): Promise<SynthesizeBackstoryResult | null> {
    if (this._resyncInFlight.has(slot)) return null;
    const synth = this._synthResults.get(slot);
    if (!synth || !synth.ok) return null;
    const drift = this._preAcceptOriginals.get(slot);
    if (!drift || Object.keys(drift).length === 0) return null;
    const editedFields = Object.keys(drift) as Array<
      'name' | 'pronouns' | 'tags' | 'skillMastery' | 'stats'
    >;
    // Post-R5 fix (QA-BUG-5): voice-anchor uses the AI's ORIGINAL
    // backstory (pre-Patch) when one was stashed.  If the DM ran
    // Patch-in-place first (mutating the cached prose with
    // deterministic substitutions that may carry "they was"-style
    // verb-agreement glitches), the AI would otherwise faithfully
    // preserve those glitches as voice.  Falls back to the current
    // cached prose when no Patch has run.
    const previousBackstory =
      this._originalBackstoryForResync.get(slot) ??
      synth.response.backstory;
    const resync: ResyncContext = {
      lockedFields: {
        name: synth.response.name,
        pronouns: synth.response.pronouns,
        tags: synth.response.tags,
        skillMastery: synth.response.skillMastery,
        stats: synth.response.stats
      },
      previousBackstory,
      editedFields
    };
    this._resyncInFlight.add(slot);
    // Clear any prior failure banner — we're trying again.
    this._resyncFailures.delete(slot);
    this.host.requestUpdate();
    try {
      const result = await this.synthesizeForSlot(slot, {
        ...options,
        resync
      });
      // Post-R5 fix (QA-BUG-4): on failure, stash the code/message
      // so the UI surfaces a banner.  Drift remains intact (the
      // success path in synthesizeForSlot is the only one that
      // clears _preAcceptOriginals when resync was set).
      if (result && !result.ok) {
        this._resyncFailures.set(slot, {
          code: result.code,
          message: result.message
        });
      }
      return result;
    } finally {
      this._resyncInFlight.delete(slot);
      this.host.requestUpdate();
    }
  }

  /**
   * Post-R5 fix (QA-BUG-4): which slots had their most recent
   * re-sync attempt fail (and how).  The UI surfaces this as a
   * banner so the DM doesn't think nothing happened.  Cleared on
   * any subsequent edit / re-sync / clear / revise.
   */
  private readonly _resyncFailures = new Map<
    number,
    { code: string; message: string }
  >();

  resyncFailuresMap(): ReadonlyMap<number, { code: string; message: string }> {
    return new Map(this._resyncFailures);
  }

  dismissResyncFailure(slot: number): void {
    if (this._resyncFailures.has(slot)) {
      this._resyncFailures.delete(slot);
      this.host.requestUpdate();
    }
  }

  /**
   * Post-R5 fix (QA-BUG-3): the canonical "is re-sync in flight"
   * accessor.  UI + acceptSlot + requestReviseSlot + editSynth*
   * all gate on this.  Returns a Set snapshot so the UI's
   * @property comparison sees a fresh value (mirrors BUG-1 fix).
   */
  resyncInFlightSet(): ReadonlySet<number> {
    return new Set(this._resyncInFlight);
  }

  isResyncInFlight(slot: number): boolean {
    return this._resyncInFlight.has(slot);
  }

  /** Forget a slot's synthesis state (DM rejected or wants to start over). */
  clearSynth(slot: number): void {
    const had = this._synthResults.has(slot) || this._acceptedSlots.has(slot);
    this._synthResults.delete(slot);
    this._acceptedSlots.delete(slot);
    this._preAcceptOriginals.delete(slot);
    this._pronounPatchedSlots.delete(slot);
    this._originalBackstoryForResync.delete(slot);
    this._resyncFailures.delete(slot);
    if (had) this.host.requestUpdate();
  }

  // ---- display-name resolution (P3U-12) ----

  /**
   * Return the display name for the PC bound to a slot, or null if
   * the character file hasn't loaded yet.  The DM-review region
   * shows this in place of the raw pcId (UX P3U-12).  Triggers a
   * lazy load when the cache is cold so a subsequent re-render
   * shows the resolved name.
   */
  displayNameForBound(pcId: string): string | null {
    const loaded = this.env.getBoundCharacter(pcId);
    if (loaded) {
      // LoadedCharacter.record is the raw character JSON; `name` is
      // the canonical display field (every PC json has it).
      const name = loaded.record?.name;
      return typeof name === 'string' && name.length > 0 ? name : pcId;
    }
    this.env.loadCharacterByPcId(pcId);
    return null;
  }
}

/**
 * Phase 3b-1: derive a stable, unique pcId for a synthesized PC.
 * Shape: `slot-${N}-${first 8 chars of responseId-stripped-of-non-safe-chars}`.
 *
 * Properties:
 *   - Stable: same slot + same responseId → same pcId.  A retry of
 *     the same logical synthesis reproduces the id (rare, but the
 *     materializer's first-write-wins handles the duplicate.)
 *   - Unique-per-resynth: re-synthesis produces a new responseId
 *     (broker-side), so re-accept lands a new pcId.
 *   - Human-debuggable: the slot number is visible in the id, and
 *     the hash suffix is short enough to copy-paste.
 *   - PC_ID_RE-safe: stripped to `[A-Za-z0-9._-]` before composition.
 *
 * Returns null when the responseId is empty or sanitizes to empty
 * (defensive guard against future provider weirdness).
 */
function derivePcId(slot: number, responseId: string): string | null {
  if (!Number.isInteger(slot) || slot < 1 || slot > 9) return null;
  const safe = responseId.replace(/[^A-Za-z0-9_-]/g, '');
  if (safe.length === 0) return null;
  const short = safe.slice(0, 8);
  return `slot-${slot}-${short}`;
}

/**
 * Wave 3a (2026-05-25): plain find-replace that escapes regex
 * metachars in the needle.  Used for name patching — the haystack
 * (backstory) may contain regex-special chars but the needle
 * (PC name) is treated literally.
 */
function replaceAll(haystack: string, needle: string, replacement: string): string {
  if (needle.length === 0) return haystack;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return haystack.replace(new RegExp(escaped, 'g'), replacement);
}

/**
 * Wave 3a: deterministic pronoun substitution.  Handles the SAFE
 * subset: subject (she/he/they/ze), reflexive (herself/himself/
 * themselves/zirself), and possessive-determiner-when-followed-by-
 * a-noun-stem (hers/his/theirs/zirs).
 *
 * Deliberately DOES NOT touch the ambiguous "her"/"him" forms —
 * "her" can be object ("saw her") or possessive ("her keys"); the
 * correct substitute differs ("them" vs "their").  Same for "his"
 * vs "him".  Wave 3b adds an AI verb-fixup pass that disambiguates.
 *
 * Limitations (documented for Wave 3b followup):
 *   - Doesn't fix verb agreement ("she was" → "they were").
 *   - Doesn't handle capitalized sentence-start variants robustly
 *     (matches case-sensitively only).
 *   - Does NOT touch unknown pronoun sets (custom pronouns); falls
 *     through to a single safe rewrite of subject only.
 */
function applyPronounSubstitutions(
  text: string,
  fromPronouns: string,
  toPronouns: string
): string {
  const from = parsePronounSet(fromPronouns);
  const to = parsePronounSet(toPronouns);
  if (!from || !to) {
    // Unknown set — punt; user can revise manually.
    return text;
  }
  let out = text;
  // Order matters: longer substitutions first so we don't partially
  // match a shorter form embedded in a longer one.
  const subs: Array<[string, string]> = [
    [from.reflexive, to.reflexive],
    [from.possessive, to.possessive],
    [from.subject, to.subject]
  ];
  // Word-boundary regex to avoid matching inside other words
  // ("she" → "they" should not touch "shed" or "sherbet").
  for (const [a, b] of subs) {
    if (a === b) continue;
    const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'g'), b);
  }
  return out;
}

/**
 * Wave 3a: lookup table for the SAFE pronoun substitution subset.
 * Subject + reflexive + possessive-determiner.  Skips object form
 * ("her"/"him") and possessive-pronoun ("hers" vs "his") because
 * they disambiguate context-dependently.
 *
 * Returns null for unknown pronoun strings; caller falls back to
 * a no-op (AI re-sync in Wave 3b will handle custom sets).
 */
function parsePronounSet(
  raw: string
): { subject: string; reflexive: string; possessive: string } | null {
  const t = raw.trim().toLowerCase();
  if (t === 'she/her' || t === 'she') {
    return { subject: 'she', reflexive: 'herself', possessive: 'hers' };
  }
  if (t === 'he/him' || t === 'he') {
    return { subject: 'he', reflexive: 'himself', possessive: 'his' };
  }
  if (t === 'they/them' || t === 'they') {
    return { subject: 'they', reflexive: 'themselves', possessive: 'theirs' };
  }
  if (t === 'ze/zir' || t === 'ze') {
    return { subject: 'ze', reflexive: 'zirself', possessive: 'zirs' };
  }
  return null;
}

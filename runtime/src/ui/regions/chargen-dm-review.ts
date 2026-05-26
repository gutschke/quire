/**
 * <chargen-dm-review> — unified DM-review surface for chargen
 * (Phase 3a Cluster E step 2).
 *
 * Convergent finding from all four Phase 2 gate reviewers
 * (TTRPG-craft / UX / Engine / Adversarial): today's DM-side chargen
 * surface is three independent cards (`<dm-aside>` thread-debt
 * section, `<seat-strip>`, `<invite-manager>`) with no per-seat
 * semantic grouping, raw `pcId` strings instead of names, no review
 * of the synthesized PC's name/tags/stats/backstory before commit,
 * no SA-vs-backstory diff, and no "ask the player to revise"
 * affordance.  Result: rubber-stamping.
 *
 * This region subsumes the per-seat invite + synthesis + (later
 * step) review/accept flow.  Step 2 (this commit) scaffolds the
 * structure + per-seat Generate-link + Synthesize controls + the
 * raw synth-result rendering of `name` + validator warnings.
 * Subsequent steps fold in:
 *   - Step 3: P3U-12 display-name resolution.
 *   - Step 4: CC-24 accept gate + P3T-19 revise affordance.
 *   - Step 5: P3T-16 SA-vs-backstory diff view.
 *   - Step 6: delete `<seat-strip>` and `<invite-manager>` mounts;
 *     lift their Mode-B warning + last bits here.
 *
 * Light-DOM rendering: createRenderRoot returns `this` so the
 * region inherits the parent's CSS cascade.
 *
 * DM-only: parents only mount this when the local peer is
 * coordinator.  The region itself doesn't enforce coord — the
 * `<dm-aside>` mount-site gate does.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { SynthesizeBackstoryResult } from '../../ai/backstory-synthesizer';
import type { PcBackstorySynthesisResponse } from '../../ai/schema';
import { QUIRE_SKILL_CATEGORIES } from '../../ai/schema';
import type { CampaignCharCreationQuestion } from '../../campaign-loader';
import type { Seat } from '../../core/state';
import '../components/quire-modal';
import '../components/chip-editor';

/**
 * Phase B-prime (2026-05-25): the 9-slot grid that pre-dated this
 * commit is gone.  The component now renders only seats that are
 * currently in `pcSlots` (any state: bound-active, bound-retired,
 * bound-archived, or unbound-but-pre-allocated) + the slot the DM
 * is currently working chargen for.  "+ add player" allocates the
 * next unused integer via `onAddSeat`.
 *
 * UI soft cap (not enforced by the engine): the "+ add player"
 * button stops appearing past 9 unless a campaign-config raises it.
 * Engine accepts arbitrary integer slot indices.
 */
const SOFT_SEAT_CAP = 9;

export type GenerateInviteCallback = (slot: number) => Promise<string | null>;
export type SynthesizeCallback = (
  slot: number
) => Promise<SynthesizeBackstoryResult>;
/**
 * Phase 3b polish (2026-05-22): DM imports a packed character JSON
 * for a slot.  The host parses the file contents and calls back with
 * the typed result so the region can surface a precise message
 * (campaign mismatch / slot mismatch / malformed).
 */
export type ImportPackCallback = (
  slot: number,
  rawJson: string
) =>
  | { ok: true; appliedSlot: number }
  | {
      ok: false;
      code: 'malformed' | 'no-campaign' | 'campaign-mismatch' | 'slot-mismatch';
      message: string;
    };
/**
 * Phase 3b polish (2026-05-22): DM quick-generate.  No saved
 * answers needed — just a PC name + a one-line concept the AI uses
 * as a dmConstraints anchor.
 */
export type QuickGenerateCallback = (
  slot: number,
  options: { name: string; hook: string }
) => Promise<SynthesizeBackstoryResult>;
/**
 * Phase 3b polish (2026-05-23): DM hand-edits a spoiler-leak-
 * rejected synth result and commits.  Returns false when the slot
 * has no rejected response to edit (UI hides the affordance then).
 */
export type AcceptWithEditsCallback = (
  slot: number,
  edits: { name: string; backstory: string }
) => boolean;
/**
 * P3U-12: resolve a bound pcId to its display name.  Host wires to
 * `ChargenController.displayNameForBound`.  Returns null while the
 * character file is still loading; the region falls back to raw
 * pcId in that case.  A subsequent render after the lazy load
 * resolves will see the name.
 */
export type DisplayNameLookup = (pcId: string) => string | null;
/** CC-24: DM accepts the synthesized PC. */
export type AcceptCallback = (slot: number) => void;
/**
 * P3T-19 / Wave 3c (2026-05-25): DM asks the player to revise.
 * Optional `pinnedQuestionIds` list (Wave 3c) names answers the
 * DM wants kept verbatim — the player only needs to re-answer
 * the unpinned questions.
 */
export type ReviseCallback = (
  slot: number,
  reason: string,
  pinnedQuestionIds?: readonly string[]
) => void;
/**
 * Phase B-prime (2026-05-25): DM allocates a new seat at the lowest
 * unused integer.  Host wires to the seat-add event emitter.
 * Returns the slot number allocated.
 */
export type AddSeatCallback = () => number | null;
/**
 * Wave 1 (2026-05-25): DM drops an unbound, empty seat that was
 * added accidentally.  Host wires to ChargenController.removeSeat.
 * Returns true if the engine accepted the removal.  The UI only
 * surfaces the X-glyph affordance on truly removable seats — this
 * is a defense-in-depth gate.
 */
export type RemoveSeatCallback = (slot: number) => boolean;
/**
 * Wave 2 (2026-05-25): DM patches one or more fields on a
 * synthesized PC before accepting.  Host wires to
 * ChargenController.editSynthFieldPreAccept.  Returns true on
 * success; false when the slot has no ok-result or is already
 * accepted.
 */
export type EditPreAcceptCallback = (
  slot: number,
  patch: Partial<PcBackstorySynthesisResponse>
) => boolean;
/**
 * Wave 2 (2026-05-25): DM dismisses the drift-banner entry for a
 * specific field on a slot ("Leave drift" — keep the edit, hide
 * the banner).  Host wires to ChargenController.dismissPreAcceptDrift.
 */
export type DismissDriftCallback = (
  slot: number,
  field: keyof PcBackstorySynthesisResponse
) => void;
/**
 * Wave 3a (2026-05-25): DM applies deterministic find-replace
 * patches to the backstory for the patchable subset of drift
 * fields (name + pronouns).  Returns true on success.  Host
 * wires to ChargenController.patchInPlace.
 */
export type PatchInPlaceCallback = (slot: number) => boolean;
/**
 * Wave 3b (2026-05-25): DM asks the AI to re-synthesize the
 * backstory honoring all drift edits.  Async — caller awaits.
 * Resolves to undefined when no work could be done (e.g., no
 * drift or no synth result).
 */
export type ResyncBackstoryCallback = (slot: number) => Promise<void>;
/**
 * P-R6 (2026-05-25): DM retires a bound PC.  Host wires to
 * quire-app.appendPcRetire.  Returns true on append.
 */
export type RetirePcCallback = (payload: {
  pcId: string;
  inFictionReason: string;
  reason: 'died' | 'departed' | 'converted-to-npc' | 'other';
  scene?: string;
}) => boolean;
/**
 * P3T-16: load the player's saved chargen answers for a slot.
 * Used by the SA-vs-backstory diff view.  Returns null when no
 * answers are saved on this device.
 */
export type AnswersLookup = (slot: number) => Record<string, string> | null;

@customElement('chargen-dm-review')
export class ChargenDmReview extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /**
   * Bound-slot map (slot → pcId).  Same shape as the legacy
   * `<seat-strip>` consumed; the region renders bound/open status
   * per seat row.
   */
  /**
   * Phase B' (2026-05-25): slot map now carries Seat metadata
   * (state + pcId + retire info) rather than just pcId strings.
   * Component reads `seat?.pcId` to detect binding and
   * `seat?.state` to choose tile shape (active vs retired vs
   * archived vs unbound).
   */
  @property({ attribute: false }) pcSlots: Record<number, Seat> = {};

  /**
   * Per-slot cached synthesis result.  Read from
   * `ChargenController.getSynthResult(slot)` via the host adapter.
   * Region renders the result card under each seat that has a
   * value.
   */
  @property({ attribute: false }) synthResults: Map<
    number,
    SynthesizeBackstoryResult
  > = new Map();

  /**
   * Slots whose synth is in-flight (dim spinner state).
   */
  @property({ attribute: false }) synthInFlight: Set<number> = new Set();

  /**
   * Slots the DM has accepted (CC-24 — wired in step 4; step 2
   * only renders the dim state when present).
   */
  @property({ attribute: false }) acceptedSlots: Set<number> = new Set();

  /**
   * P3U-12: resolve a bound pcId to its character display name.
   * When null, the region renders the raw pcId.  The host's
   * `ChargenController.displayNameForBound` triggers a lazy load
   * on first call; a subsequent re-render shows the resolved name.
   */
  @property({ attribute: false })
  displayNameLookup: DisplayNameLookup | null = null;

  /** CC-24 accept gate.  Host wires to controller.acceptSlot. */
  @property({ attribute: false }) onAccept: AcceptCallback | null = null;

  /** P3T-19 revise.  Host wires to controller.requestReviseSlot. */
  @property({ attribute: false }) onRevise: ReviseCallback | null = null;

  /**
   * P3T-16: lookup for the player's saved short-answer answers.
   * Host wires to ChargenController.loadPersistedAnswers.  Used by
   * the SA-vs-backstory diff view inside each ok result card.
   */
  @property({ attribute: false })
  answersLookup: AnswersLookup | null = null;

  /**
   * Phase 3b polish (2026-05-23): the campaign's declared chargen
   * questions.  Used to (a) iterate the diff view in the
   * campaign's authored order rather than a hardcoded Underleaf-
   * specific anchor list, and (b) expand MC option VALUES (e.g.
   * "last-72h") to their human-readable LABELS.  When empty, the
   * diff view falls back to alphabetical id order with raw values.
   */
  @property({ attribute: false })
  questions: CampaignCharCreationQuestion[] = [];

  /**
   * Which seat's review dialog is currently open (single modal at
   * a time).  Lives on the region (not the controller) — opening
   * the dialog doesn't propagate to other peers.  Phase 3b polish
   * (2026-05-22) replaced the per-seat inline-expand behavior
   * because in the DM aside (narrow column) the inline expand
   * produced a "skinny but very tall" diff that was hard to read.
   * The dialog uses the full window width/height (capped) instead.
   */
  @state() private reviewModalSlot: number | null = null;

  /**
   * Generate an invite URL for a slot.  Host wires to
   * `ChargenController.generateInviteUrl(slot)`.  Returns null on
   * failure (slot out of range, no campaign, encode failed).
   */
  @property({ attribute: false })
  onGenerate: GenerateInviteCallback | null = null;

  /**
   * Trigger synthesis for a slot.  Host wires to
   * `ChargenController.synthesizeForSlot(slot, …)`.  The region
   * shows the in-flight spinner via `synthInFlight`; the result
   * lands in `synthResults`.
   */
  @property({ attribute: false }) onSynthesize: SynthesizeCallback | null =
    null;

  /**
   * Phase 3b polish (2026-05-22): DM imports a packed character.
   * Host wires to `ChargenController.importPackFromText(raw, slot)`.
   */
  @property({ attribute: false }) onImportPack: ImportPackCallback | null =
    null;

  /**
   * Phase 3b polish (2026-05-22): DM quick-generate without player
   * answers.  Host wires to `ChargenController.synthesizeForSlot`
   * with `inlineAnswers: {}` + a synthetic dmConstraints built
   * from the DM-supplied name + hook.
   */
  @property({ attribute: false })
  onQuickGenerate: QuickGenerateCallback | null = null;

  /**
   * Phase 3b polish (2026-05-23): DM hand-edits a spoiler-leak-
   * rejected backstory and commits.  Host wires to
   * `ChargenController.acceptWithEdits`.
   */
  @property({ attribute: false })
  onAcceptWithEdits: AcceptWithEditsCallback | null = null;

  /**
   * Phase B-prime (2026-05-25): DM allocates a new seat at the
   * lowest unused integer.  Host wires to the seat-add event
   * emitter.  Returns the slot allocated (or null on failure).
   */
  @property({ attribute: false })
  onAddSeat: AddSeatCallback | null = null;

  /**
   * Wave 1 (2026-05-25): drop an empty unbound seat.  When null,
   * the X-glyph is not rendered (defense-in-depth — even if a stale
   * seat ends up unbound after a host upgrade, we won't expose a
   * remove verb without a wired callback).
   */
  @property({ attribute: false })
  onRemoveSeat: RemoveSeatCallback | null = null;

  /**
   * Wave 1 (2026-05-25): undo a remove during the 4s window by
   * re-allocating the exact slot integer.  Distinct from onAddSeat
   * (which picks lowest-unused) — undo needs the specific slot.
   */
  @property({ attribute: false })
  onReaddSeat: ((slot: number) => boolean) | null = null;

  /**
   * Wave 2 (2026-05-25): patch a synthesized PC's fields before
   * acceptance.  Hidden when null (defense-in-depth — same posture
   * as the seat-remove X-glyph).
   */
  @property({ attribute: false })
  onEditPreAccept: EditPreAcceptCallback | null = null;

  /**
   * Wave 2 (2026-05-25): "Leave drift" — clears the drift-banner
   * entry for a field; the edit value stays.
   */
  @property({ attribute: false })
  onDismissDrift: DismissDriftCallback | null = null;

  /**
   * Wave 3a (2026-05-25): "Patch in place" — applies deterministic
   * find-replace to the backstory for the patchable subset (name +
   * safe-subset pronouns).  Hidden when no callback wired.
   */
  @property({ attribute: false })
  onPatchInPlace: PatchInPlaceCallback | null = null;

  /**
   * Wave 3b (2026-05-25): "Re-sync backstory" — calls the AI to
   * regenerate the backstory honoring all drift edits.  Hidden
   * when no callback wired.
   */
  @property({ attribute: false })
  onResyncBackstory: ResyncBackstoryCallback | null = null;

  /**
   * Wave 3 polish (2026-05-25, TTRPG-R4 fix #5): slots whose last
   * Patch-in-place touched pronouns.  Used to render a hint about
   * potential verb-agreement glitches the deterministic
   * substitution doesn't fix.
   */
  @property({ attribute: false })
  pronounPatchedSlots: ReadonlySet<number> = new Set();

  /** Dismiss-callback for the pronoun-patch hint. */
  @property({ attribute: false })
  onDismissPronounPatchHint: ((slot: number) => void) | null = null;

  /**
   * P-R6 (2026-05-25): retire a bound-active PC.  Hidden when no
   * callback wired.
   */
  @property({ attribute: false })
  onRetirePc: RetirePcCallback | null = null;

  /**
   * Wave 2 (2026-05-25): per-slot map of original AI values for
   * any field the DM has edited pre-accept.  The drift banner uses
   * this for "Name: Mei → Mai" before/after rendering.  Empty map
   * = no banners shown.
   */
  @property({ attribute: false })
  preAcceptDrift: Map<number, Partial<PcBackstorySynthesisResponse>> =
    new Map();

  /**
   * P-R2 (2026-05-25): effective seat cap from the loaded campaign
   * (or DEFAULT_SEAT_CAP fallback).  Used to gate the "+ add player"
   * verb visibility — when all 1..cap slots are taken, "+ add player"
   * hides and shows the cap-reached note instead.  Property (not
   * constant) so a campaign manifest with a larger seatCap can
   * raise the UI cap without recompiling.
   */
  @property({ type: Number }) seatCap = SOFT_SEAT_CAP;

  /**
   * Per-seat last-generated link (transient — cleared when the DM
   * picks a different slot to generate for OR the page reloads).
   * Local to the region because re-generating after the DM has
   * already copied is the common case.
   */
  @state() private lastGeneratedUrl: Map<number, string> = new Map();
  @state() private generatingFor: Set<number> = new Set();
  @state() private copiedFor: number | null = null;

  /**
   * Phase B-prime (2026-05-25): the slot the DM is currently
   * working chargen for, even though it's not yet bound to a PC.
   * Set by clicking "+ add player" — the new slot renders as a
   * full chargen tile alongside the bound seats.  Cleared once
   * the PC is created + bound (the seat then appears as a normal
   * bound-active tile, no longer "working").
   */
  @state() private workingSlot: number | null = null;

  /**
   * Phase B-prime (2026-05-25): when true, the DM has clicked
   * "Start playing →" and the chargen panel collapses to a single
   * "Resume chargen" link.  Bound seats still render (read-only
   * roster glance); chargen affordances + "+ add player" hide.
   * Local @state — no event broadcast.  Cross-cockpit effects
   * (auto-collapse on first dice-roll, ⊕ glyph in in-session) land
   * in P-R4.
   */
  @state() private startedPlaying: boolean = false;

  /**
   * Wave 1 (2026-05-25): 4-second undo window after a seat-remove.
   * `pendingRemoveSlot` is the integer the DM just removed;
   * `pendingRemoveSecondsLeft` counts down once per second.  When
   * the timer expires (or the DM clicks Undo / triggers a new
   * remove), the state clears and the banner disappears.
   */
  @state() private pendingRemoveSlot: number | null = null;
  @state() private pendingRemoveSecondsLeft = 0;
  private pendingRemoveTimerId: ReturnType<typeof setInterval> | null = null;

  /**
   * Wave 2 (2026-05-25): which header field on which slot is in
   * inline-edit mode.  Single-edit at a time — opening one closes
   * any other.  Cleared on commit / Esc / blur to a non-input.
   */
  @state() private editingHeader: {
    slot: number;
    field: 'name' | 'pronouns';
  } | null = null;

  /**
   * Wave 2 (2026-05-25): the cell selected to be the first half of
   * a stat swap.  `null` when no swap is in flight.  Clicking a
   * second cell completes the swap (after confirm if the player's
   * chosen +2 stat is involved).  Per-slot to avoid cross-seat
   * confusion when multiple synth-result cards are visible.
   */
  @state() private selectedStatCell: {
    slot: number;
    key: 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';
  } | null = null;

  /**
   * Wave 2 (2026-05-25): a stat swap awaiting DM confirmation
   * because one of the cells is the player's chosen +2 stat (per
   * stat-emphasis question — soft-lock per TTRPG-expert advice).
   * Cleared by Confirm (commits the swap) or Cancel (drops state).
   */
  @state() private pendingStatSwap: {
    slot: number;
    from: 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';
    to: 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';
  } | null = null;

  /*
   * Phase 3b (2026-05-25): per-slot chip-add open/close state
   * moved into the <chip-editor> primitive (see ../components/
   * chip-editor.ts).  Each chip-editor manages its own open
   * state — UX-R4 #4 fix: opening tag-add on PC1 no longer
   * silently closes it on PC2.
   */

  /**
   * P-R6 (2026-05-25): which bound seat is the DM retiring (modal
   * open).  null = no dialog open.
   */
  @state() private retireDialogSlot: number | null = null;
  @state() private retireInFictionReason: string = '';
  @state() private retireReason:
    | 'died'
    | 'departed'
    | 'converted-to-npc'
    | 'other' = 'departed';

  /**
   * Wave 3b (2026-05-25): which slots have a re-sync AI call in
   * flight.  Used to disable buttons + show a spinner during the
   * call so the DM doesn't double-fire.
   *
   * Post-R5 fix (QA-BUG-3): lifted from @state to @property — the
   * controller now owns the authoritative set, and the UI just
   * reads.  Defense against (a) the UI element being re-created
   * across renders and losing the in-flight slot, and (b) non-UI
   * callers (tests, future hotkeys) bypassing the gate.
   */
  @property({ attribute: false })
  resyncInFlight: ReadonlySet<number> = new Set();

  /**
   * Post-R5 fix (QA-BUG-4): per-slot re-sync failure info, surfaced
   * as a banner so the DM doesn't think nothing happened when the
   * AI call errors.  Drift remains intact on failure (success
   * path is the only one that clears drift in resync mode), so
   * the DM can retry or fall back to Patch / Leave drift.
   */
  @property({ attribute: false })
  resyncFailures: ReadonlyMap<number, { code: string; message: string }> =
    new Map();

  @property({ attribute: false })
  onDismissResyncFailure: ((slot: number) => void) | null = null;

  /**
   * P-R12 (2026-05-25): per-slot "joining at session N" map.
   * Default 1 (no catch-up).  When > 1, the controller seeds the
   * pc-create payload's startingMarks + startingAdvancements.
   */
  @property({ attribute: false })
  joiningSession: ReadonlyMap<number, number> = new Map();

  @property({ attribute: false })
  onSetJoiningSession: ((slot: number, n: number) => void) | null = null;

  /**
   * Wave 3c (2026-05-25): revise-dialog state.  Replaces the legacy
   * window.prompt with an inline modal that accepts an optional
   * reason + lets the DM pin specific chargen questions so the
   * player only re-answers the unpinned ones.
   */
  @state() private reviseDialogSlot: number | null = null;
  @state() private reviseReason: string = '';
  @state() private pinnedQuestionIds = new Set<string>();

  /**
   * Phase 3b polish: per-seat transient UI state for the pack-
   * import + quick-generate affordances.  Lives on the region (not
   * the controller) because it's purely UI — toggling the form
   * open or showing a transient "Loaded!" pip shouldn't propagate
   * to other peers or persist across reloads.
   */
  @state() private importStatus: Map<
    number,
    { kind: 'ok'; message: string } | { kind: 'err'; message: string }
  > = new Map();
  @state() private dragOverSeat: number | null = null;
  @state() private quickGenOpen: Set<number> = new Set();
  @state() private quickGenName: Map<number, string> = new Map();
  @state() private quickGenHook: Map<number, string> = new Map();
  @state() private quickGenInFlight: Set<number> = new Set();

  /**
   * Phase 3b polish (2026-05-23): which seat's "Edit + accept"
   * dialog is open (single at a time).  Initial values seed from
   * the rejected response; subsequent edits live in
   * `editDraft` until commit.
   */
  @state() private editModalSlot: number | null = null;
  @state() private editDraftName: string = '';
  @state() private editDraftBackstory: string = '';

  /*
   * Phase 3a (2026-05-25): the drag-select tracking + showModal()
   * lifecycle was moved into the <quire-modal> primitive (see
   * `../components/quire-modal.ts`).  Backdrop-click safety, Esc
   * via @cancel, and the showModal sync now belong to the
   * primitive; this region just renders the per-modal content.
   */

  override render(): TemplateResult {
    return html`
      <section class="card chargen-dm-review">
        <h2>Players & characters</h2>
        <p class="muted chargen-dm-review-intro">
          One card per seat.  Generate an invite link for the player,
          then synthesize their backstory once they've packed and
          sent their answers.
        </p>
        ${this.renderModeBNote()}
        ${this.renderSeatList()}
      </section>
      ${this.renderReviewDialog()}
      ${this.renderEditDialog()}
      ${this.renderRetireDialog()}
      ${this.renderReviseDialog()}
    `;
  }

  /**
   * Wave 3c (2026-05-25): replaces the legacy window.prompt with
   * an inline revise dialog.  DM provides an optional reason +
   * pins specific chargen questions whose answers should be kept;
   * the player is asked to re-answer only the unpinned ones.
   *
   * Per the TTRPG-expert review: "revise-with-pinned-fields" was
   * the top missing affordance — the all-or-nothing revise loop
   * cost the player 15 minutes when only 2 of 13 questions needed
   * rewriting.  This dialog respects the player's time.
   */
  private renderReviseDialog(): TemplateResult | typeof nothing {
    const slot = this.reviseDialogSlot;
    if (slot === null) return nothing;
    const answers = this.answersLookup?.(slot) ?? {};
    const questions = this.questions ?? [];
    // Show only questions that actually have an answer — pinning a
    // never-answered question would tell the player nothing useful.
    const answeredQs = questions.filter(
      (q) =>
        typeof answers[q.id] === 'string' && answers[q.id].trim().length > 0
    );
    const seat = this.pcSlots?.[slot];
    const displayName =
      (seat?.pcId && this.displayNameLookup?.(seat.pcId)) ?? `PC${slot}`;
    return html`
      <quire-modal
        class="chargen-dm-review-revise-modal"
        ?open=${this.reviseDialogSlot !== null}
        .onClose=${() => this.closeReviseDialog()}
      >
        <div class="chargen-dm-review-revise-body">
          <h3>Ask ${displayName} to revise</h3>
          <p class="muted">
            The player is sent back to chargen.  Pin specific
            questions to keep their existing answers; only the
            unpinned questions will be asked again.
          </p>
          <label class="chargen-dm-review-revise-label">
            Reason (sent to player + audit log)
            <textarea
              class="chargen-dm-review-revise-reason"
              rows="2"
              placeholder="e.g., your tag doesn't fit the rebel-cell hook — please redo that one"
              aria-label="Revise reason"
              .value=${this.reviseReason}
              @input=${(e: Event) => {
                this.reviseReason = (
                  e.target as HTMLTextAreaElement
                ).value;
              }}
            ></textarea>
          </label>
          ${answeredQs.length > 0
            ? html`<fieldset class="chargen-dm-review-revise-pinset">
                <legend>Keep these answers as-is</legend>
                ${answeredQs.map(
                  (q) => html`<label
                    class="chargen-dm-review-revise-pin-row"
                  >
                    <input
                      type="checkbox"
                      ?checked=${this.pinnedQuestionIds.has(q.id)}
                      @change=${() => this.toggleReviseQuestionPin(q.id)}
                    />
                    <span class="chargen-dm-review-revise-pin-prompt"
                      >${q.prompt}</span
                    >
                    <span
                      class="chargen-dm-review-revise-pin-answer muted"
                      title=${answers[q.id]}
                      >${(answers[q.id] ?? '').slice(0, 80)}${(
                      answers[q.id] ?? ''
                    ).length > 80
                      ? '…'
                      : ''}</span
                    >
                  </label>`
                )}
              </fieldset>`
            : html`<p class="muted">
                (No saved answers on this device — full re-answer.)
              </p>`}
          <div class="chargen-dm-review-revise-actions">
            <button
              type="button"
              class="chargen-dm-review-revise-cancel"
              @click=${() => this.closeReviseDialog()}
            >
              Cancel
            </button>
            <button
              type="button"
              class="chargen-dm-review-revise-commit"
              @click=${() => this.commitRevise()}
            >
              ${this.pinnedQuestionIds.size === 0
                ? 'Send full revise'
                : `Send revise (kept ${this.pinnedQuestionIds.size})`}
            </button>
          </div>
        </div>
      </quire-modal>
    `;
  }

  /**
   * P-R6 (2026-05-25): retire-PC dialog.  Mandatory in-fiction
   * reason (player-safe label that lands on the player's roster
   * tile) + reason enum (DM-private metadata).  Scene-id field
   * deferred to follow-up — the materializer accepts it but the
   * lobby surface doesn't track current-scene context yet.
   */
  private renderRetireDialog(): TemplateResult | typeof nothing {
    const slot = this.retireDialogSlot;
    if (slot === null) return nothing;
    const seat = this.pcSlots?.[slot];
    if (!seat?.pcId) return nothing;
    const displayName =
      this.displayNameLookup?.(seat.pcId) ?? seat.pcId;
    const canCommit = this.retireInFictionReason.trim().length > 0;
    return html`
      <quire-modal
        class="chargen-dm-review-retire-modal"
        ?open=${this.retireDialogSlot !== null}
        .onClose=${() => this.closeRetireDialog()}
      >
        <div class="chargen-dm-review-retire-body">
          <h3>Retire ${displayName}?</h3>
          <p class="muted">
            The PC leaves the active roster.  Their slot stays
            reserved (sticky-N), so future <code>{{pc:${slot}}}</code>
            references still resolve to ${displayName}.
          </p>
          <label class="chargen-dm-review-retire-label">
            How does this read in fiction? <span aria-hidden="true">*</span>
            <textarea
              class="chargen-dm-review-retire-reason-text"
              rows="3"
              placeholder="e.g., left the city after a hard betrayal"
              aria-label="In-fiction retirement reason"
              autofocus
              .value=${this.retireInFictionReason}
              @input=${(e: Event) => {
                this.retireInFictionReason = (
                  e.target as HTMLTextAreaElement
                ).value;
              }}
            ></textarea>
          </label>
          <fieldset class="chargen-dm-review-retire-fieldset">
            <legend>Reason (DM-only)</legend>
            ${(
              [
                ['died', 'Died'],
                ['departed', 'Departed'],
                ['converted-to-npc', 'Converted to NPC'],
                ['other', 'Other']
              ] as const
            ).map(
              ([val, label]) => html`<label>
                <input
                  type="radio"
                  name="retire-reason"
                  value=${val}
                  ?checked=${this.retireReason === val}
                  @change=${() => {
                    this.retireReason = val;
                  }}
                />
                ${label}
              </label>`
            )}
          </fieldset>
          <div class="chargen-dm-review-retire-actions">
            <button
              type="button"
              class="chargen-dm-review-retire-cancel"
              @click=${() => this.closeRetireDialog()}
            >
              Cancel
            </button>
            <button
              type="button"
              class="chargen-dm-review-retire-commit"
              ?disabled=${!canCommit}
              @click=${() => this.commitRetire()}
            >
              Retire ${displayName}
            </button>
          </div>
        </div>
      </quire-modal>
    `;
  }

  /**
   * Phase B-prime (2026-05-25): replaces the 9-slot grid.  Renders
   * only currently-relevant seats:
   *   - every seat in `pcSlots` (any state) in ascending slot order
   *   - the `workingSlot` if the DM is mid-chargen for a new seat
   *     and it's not yet in pcSlots
   * Below the list:
   *   - "+ add player" verb (allocates lowest unused integer up to
   *     the SOFT_SEAT_CAP) — hidden when startedPlaying
   *   - "Start playing →" CTA (toggles startedPlaying) — only
   *     shown when at least one seat is bound-active
   *   - "Resume chargen" link (when startedPlaying) — re-opens the
   *     full panel for adding more players later
   */
  private renderSeatList(): TemplateResult {
    const slotNumbers = new Set<number>();
    for (const slotStr of Object.keys(this.pcSlots ?? {})) {
      slotNumbers.add(Number(slotStr));
    }
    if (this.workingSlot !== null) slotNumbers.add(this.workingSlot);
    const sorted = [...slotNumbers].sort((a, b) => a - b);

    if (this.startedPlaying) {
      // Collapsed posture per UX C2: bound seats glance + resume verb.
      return html`
        ${this.renderRemoveUndoBanner()}
        ${this.renderPartyStatsNudge()}
        <ol class="chargen-dm-review-seats chargen-dm-review-seats-collapsed">
          ${sorted.map((slot) => this.renderSeat(slot))}
        </ol>
        <div class="chargen-dm-review-collapse-controls">
          <button
            type="button"
            class="chargen-dm-review-resume"
            title="Re-open the chargen panel to add or edit a player"
            @click=${() => {
              this.startedPlaying = false;
            }}
          >
            ⊕ Resume chargen
          </button>
        </div>
      `;
    }

    const canAdd = this.computeNextAvailableSlot() !== null;
    const canStartPlaying = this.canShowStartPlaying();
    return html`
      ${this.renderRemoveUndoBanner()}
      ${this.renderPartyStatsNudge()}
      <ol class="chargen-dm-review-seats">
        ${sorted.length === 0
          ? html`<li class="chargen-dm-review-seats-empty muted">
              No players yet.  Click <strong>+ add player</strong> to
              create the first seat.
            </li>`
          : sorted.map((slot) => this.renderSeat(slot))}
      </ol>
      <div class="chargen-dm-review-roster-controls">
        ${canAdd
          ? html`<button
              type="button"
              class="chargen-dm-review-add-seat"
              ?disabled=${!this.onAddSeat}
              title="Allocate the next seat for a new player"
              @click=${() => this.handleAddSeat()}
            >
              + add player
            </button>`
          : html`<span class="muted chargen-dm-review-cap-note">
              Seat cap reached (${this.seatCap}).  Retire a PC to
              free continuity, or raise the campaign's seat cap.
            </span>`}
        ${canStartPlaying
          ? html`<button
              type="button"
              class="chargen-dm-review-start-playing"
              title="Hide the chargen panel; bound seats stay visible.  You can re-open later."
              @click=${() => {
                this.startedPlaying = true;
              }}
            >
              Start playing →
            </button>`
          : nothing}
      </div>
    `;
  }

  /**
   * Phase B-prime: find the lowest unused positive integer (≤ soft
   * cap) that isn't already in pcSlots OR the working slot.  Null
   * when the soft cap is reached.
   */
  private computeNextAvailableSlot(): number | null {
    const taken = new Set<number>();
    for (const slotStr of Object.keys(this.pcSlots ?? {})) {
      taken.add(Number(slotStr));
    }
    if (this.workingSlot !== null) taken.add(this.workingSlot);
    for (let i = 1; i <= this.seatCap; i++) {
      if (!taken.has(i)) return i;
    }
    return null;
  }

  /** Whether any seat in pcSlots is currently bound-active. */
  private hasBoundActiveSeat(): boolean {
    for (const seat of Object.values(this.pcSlots ?? {})) {
      if (seat.state === 'bound-active') return true;
    }
    return false;
  }

  /**
   * Wave 3 polish (2026-05-25, TTRPG-R4 fix #4): "Start playing →"
   * shouldn't tempt the DM mid-review.  Hide the CTA when any
   * seat has an in-flight synth OR a synth result waiting to be
   * accepted/revised.  Surfaces only when nothing else is asking
   * for attention.
   */
  private canShowStartPlaying(): boolean {
    if (!this.hasBoundActiveSeat()) return false;
    if (this.synthInFlight.size > 0) return false;
    if (this.resyncInFlight.size > 0) return false;
    // Any synth result that hasn't been accepted yet means the DM
    // still has work pending.  Failure results (parse/spoiler/etc)
    // also count — they need explicit DM action.
    for (const slot of this.synthResults.keys()) {
      if (!this.acceptedSlots.has(slot)) return false;
    }
    return true;
  }

  /**
   * Wave 2 (2026-05-25): conditional party-stats nudge.  Surfaces a
   * one-line verbal cue when the party's distribution is lopsided
   * (one stat sums ≥ +4 or ≤ -2 across all synth-result PCs in the
   * roster).  Per the TTRPG-expert review: a data-only glance row
   * would push DMs toward min-max rebalancing, which is antithetical
   * to Quire's story-first design.  The nudge frames it as "consider
   * letting it be" — visible enough to surface the imbalance, soft
   * enough not to encourage paternalistic editing.
   */
  private renderPartyStatsNudge(): TemplateResult | typeof nothing {
    const sums: Record<'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA', number> = {
      STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0
    };
    let counted = 0;
    for (const synth of this.synthResults.values()) {
      if (!synth.ok) continue;
      for (const k of [
        'STR',
        'DEX',
        'CON',
        'INT',
        'WIS',
        'CHA'
      ] as Array<keyof typeof sums>) {
        sums[k] += synth.response.stats[k];
      }
      counted += 1;
    }
    // Skip parties of fewer than 3 — the lopsidedness signal is too
    // noisy.  Post-Wave-2 review (both experts): party of 2 hits +4
    // any time both players pick the same +2 emphasis, which is
    // a legitimate party-design choice, not a problem.
    if (counted < 3) return nothing;
    // Threshold scales linearly with party size: a fixed +4 was
    // too eager for small parties (true any time two PCs share a
    // +2 emphasis) and too quiet for large parties.  Formula
    // `counted + 2` produces: 3 PCs → 5, 4 PCs → 6, 5 PCs → 7.
    // Reasoning: 3 PCs sharing a +2 (= sum 6) is a real lean;
    // 2 PCs sharing a +2 (= sum 4) is a legitimate design choice.
    const posThreshold = counted + 2;
    // Light-on threshold (negative): can't be triggered from valid
    // chargen synth data (stat values are non-negative), but
    // preserved for in-session scenarios where harm pushes a stat
    // negative.  Scaled symmetrically.
    const negThreshold = -Math.max(2, Math.ceil(counted / 2));
    let extreme:
      | { key: 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA'; sum: number }
      | null = null;
    for (const k of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const) {
      const s = sums[k];
      const triggers = s >= posThreshold || s <= negThreshold;
      if (!triggers) continue;
      if (!extreme || Math.abs(s) > Math.abs(extreme.sum)) {
        extreme = { key: k, sum: s };
      }
    }
    if (!extreme) return nothing;
    const direction = extreme.sum > 0 ? 'leans' : 'is light on';
    const sumFmt = extreme.sum > 0 ? `+${extreme.sum}` : `${extreme.sum}`;
    return html`
      <div class="chargen-dm-review-party-nudge" role="status">
        <span class="chargen-dm-review-party-nudge-glyph" aria-hidden="true">⚠</span>
        <span
          >Party ${direction} <strong>${extreme.key}</strong> (${sumFmt}
          across ${counted} PCs).  Consider letting
          it be — Quire's harm/stress consequences shape the
          fiction more than stat distribution.</span
        >
      </div>
    `;
  }

  /**
   * Wave 1 (2026-05-25): the 4s "PC5 removed — Undo (3s)" banner
   * that follows a seat-remove.  Nothing rendered when no remove
   * is pending.  Banner anchors above the seat list so it's visible
   * in both the empty and populated states.
   */
  private renderRemoveUndoBanner(): TemplateResult | typeof nothing {
    if (this.pendingRemoveSlot === null) return nothing;
    return html`
      <div class="chargen-dm-review-remove-undo" role="status">
        <span>PC${this.pendingRemoveSlot} removed.</span>
        <button
          type="button"
          class="chargen-dm-review-remove-undo-btn"
          @click=${() => this.handleUndoRemoveSeat()}
        >
          Undo (${this.pendingRemoveSecondsLeft}s)
        </button>
      </div>
    `;
  }

  private handleAddSeat(): void {
    if (!this.onAddSeat) return;
    const slot = this.onAddSeat();
    if (slot === null) return;
    this.workingSlot = slot;
  }

  /**
   * Wave 1 (2026-05-25): the seat is "removable" when nothing the
   * DM has invested in it would be lost.  The engine layer also
   * gates this (and the controller checks _synthInFlight /
   * _synthResults / _acceptedSlots), so this is defense-in-depth
   * for the affordance visibility.
   *
   * Conditions for visibility:
   *   - the seat exists in pcSlots and is `unbound`
   *   - no synthesis result is cached
   *   - synthesis isn't currently in-flight
   *   - the seat hasn't been accepted
   *   - no quick-gen panel is in-flight
   *
   * A generated invite URL alone does NOT disqualify removal:
   * the player hasn't redeemed yet, so the seat is recoverable
   * even if the link was sent.
   *
   * Post-Wave-2 polish (2026-05-25, TTRPG review fix): we previously
   * excluded the workingSlot, but that ironically hid the X on the
   * exact seat the DM most often wants to undo — the just-added one
   * from a misclick on "+ add player".  Now: workingSlot is fine to
   * remove as long as no work has landed (no synth in flight, no
   * synth result, no quick-gen).  If the DM is mid-chargen (synth
   * is running or finished), the other conditions hide the X anyway.
   */
  private isSeatRemovable(slot: number): boolean {
    if (!this.onRemoveSeat) return false;
    const seat = this.pcSlots?.[slot];
    if (!seat || seat.state !== 'unbound') return false;
    if (this.synthResults.has(slot)) return false;
    if (this.synthInFlight.has(slot)) return false;
    if (this.acceptedSlots.has(slot)) return false;
    if (this.quickGenInFlight.has(slot)) return false;
    return true;
  }

  /**
   * P-R6 (2026-05-25): the seat is "retirable" when it's bound-
   * active and the host has wired the retire callback.  Already-
   * retired/archived seats hide the verb (they can be archived
   * separately — Wave 3 polish).
   */
  private isSeatRetirable(slot: number): boolean {
    if (!this.onRetirePc) return false;
    const seat = this.pcSlots?.[slot];
    if (!seat || seat.state !== 'bound-active') return false;
    if (!seat.pcId) return false;
    return true;
  }

  private openRetireDialog(slot: number): void {
    this.retireDialogSlot = slot;
    this.retireInFictionReason = '';
    this.retireReason = 'departed';
  }

  private closeRetireDialog(): void {
    this.retireDialogSlot = null;
    this.retireInFictionReason = '';
  }

  private commitRetire(): void {
    const slot = this.retireDialogSlot;
    if (slot === null || !this.onRetirePc) return;
    const seat = this.pcSlots?.[slot];
    if (!seat?.pcId) return;
    if (this.retireInFictionReason.trim().length === 0) return;
    const ok = this.onRetirePc({
      pcId: seat.pcId,
      inFictionReason: this.retireInFictionReason,
      reason: this.retireReason
    });
    if (ok) this.closeRetireDialog();
  }

  private handleRemoveSeat(slot: number): void {
    if (!this.isSeatRemovable(slot)) return;
    const ok = this.onRemoveSeat!(slot);
    if (!ok) return;
    // Clear workingSlot if it was this seat — otherwise the UI
    // keeps rendering a chargen card for a removed slot.
    if (this.workingSlot === slot) this.workingSlot = null;
    // Stash the slot for the 4s undo window; cancel any prior
    // pending remove (clicking remove on a second seat collapses
    // the older banner immediately — last-write-wins).
    this.clearPendingRemoveTimer();
    this.pendingRemoveSlot = slot;
    this.pendingRemoveSecondsLeft = 4;
    this.pendingRemoveTimerId = setInterval(() => {
      this.pendingRemoveSecondsLeft -= 1;
      if (this.pendingRemoveSecondsLeft <= 0) {
        this.clearPendingRemoveTimer();
        this.pendingRemoveSlot = null;
      }
    }, 1000);
    // Post-Wave-2 polish: move focus to Undo so keyboard users have
    // an immediate path to recover.  The undo banner renders above
    // the seat list; we updateComplete-await before grabbing it.
    void this.focusUndoButton();
  }

  private async focusUndoButton(): Promise<void> {
    await this.updateComplete;
    this.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-remove-undo-btn'
    )?.focus();
  }

  private handleUndoRemoveSeat(): void {
    const slot = this.pendingRemoveSlot;
    this.clearPendingRemoveTimer();
    this.pendingRemoveSlot = null;
    this.pendingRemoveSecondsLeft = 0;
    if (slot === null) return;
    this.onReaddSeat?.(slot);
  }

  private clearPendingRemoveTimer(): void {
    if (this.pendingRemoveTimerId !== null) {
      clearInterval(this.pendingRemoveTimerId);
      this.pendingRemoveTimerId = null;
    }
  }

  disconnectedCallback(): void {
    this.clearPendingRemoveTimer();
    super.disconnectedCallback();
  }

  /**
   * Wave 2 (2026-05-25): open inline edit on a synth-result header
   * field.  Accepted slots can't edit pre-accept (post-accept edits
   * are Wave 3).  Click outside / Esc / Enter close the editor.
   */
  private openHeaderEdit(slot: number, field: 'name' | 'pronouns'): void {
    if (this.acceptedSlots.has(slot)) return;
    if (!this.onEditPreAccept) return;
    // Wave 3 polish (UX-R4 fix #2): don't let edits race a re-sync.
    if (this.resyncInFlight.has(slot)) return;
    this.editingHeader = { slot, field };
  }

  private commitHeaderEdit(value: string): void {
    const editing = this.editingHeader;
    if (!editing || !this.onEditPreAccept) {
      this.editingHeader = null;
      return;
    }
    const trimmed = value.trim();
    const synth = this.synthResults.get(editing.slot);
    if (synth?.ok) {
      const current = synth.response[editing.field];
      if (trimmed.length > 0 && trimmed !== current) {
        const patch: Partial<PcBackstorySynthesisResponse> = {};
        patch[editing.field] = trimmed;
        this.onEditPreAccept(editing.slot, patch);
      }
    }
    const restoreSlot = editing.slot;
    const restoreField = editing.field;
    this.editingHeader = null;
    void this.refocusHeaderEdit(restoreSlot, restoreField);
  }

  private cancelHeaderEdit(): void {
    const editing = this.editingHeader;
    this.editingHeader = null;
    if (editing) {
      void this.refocusHeaderEdit(editing.slot, editing.field);
    }
  }

  /**
   * Post-Wave-2 polish: after commit/cancel of a header inline-edit,
   * focus drops to body.  Restore focus to the now-rendered edit
   * button so keyboard users keep their place.
   */
  private async refocusHeaderEdit(
    slot: number,
    field: 'name' | 'pronouns'
  ): Promise<void> {
    await this.updateComplete;
    const seat = this.querySelector(`[data-slot="${slot}"]`);
    seat
      ?.querySelector<HTMLButtonElement>(
        `.chargen-dm-review-header-edit-${field}`
      )
      ?.focus();
  }

  private handleHeaderInputKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.commitHeaderEdit((e.target as HTMLInputElement).value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.cancelHeaderEdit();
    }
  }

  /**
   * Wave 2 (2026-05-25): "Leave drift" — DM accepts that the
   * synth-result diverges from the AI's original output for a
   * given field; banner stops showing for that field.
   */
  private handleLeaveDrift(
    slot: number,
    field: keyof PcBackstorySynthesisResponse
  ): void {
    this.onDismissDrift?.(slot, field);
  }

  /**
   * Phase 3b polish (2026-05-23): editable dialog seeded from a
   * spoiler-leak-rejected synthesis.  The DM removes the leaked
   * tokens (highlighted as forbidden chips in the seat card) +
   * commits via "Save + accept".  Same dialog pattern as the
   * review modal — backdrop click + Esc + close button all close.
   */
  private renderEditDialog(): TemplateResult | typeof nothing {
    const slot = this.editModalSlot;
    if (slot === null) return nothing;
    const synth = this.synthResults.get(slot);
    if (!synth || synth.ok || !synth.rejectedResponse) return nothing;
    const tokens = synth.persistentTokens ?? [];
    const canSubmit =
      this.editDraftName.trim().length > 0 &&
      this.editDraftBackstory.trim().length > 0;
    return html`
      <quire-modal
        class="chargen-dm-review-edit-modal"
        ?open=${this.editModalSlot !== null}
        .onClose=${() => this.closeEditModal()}
      >
        <header class="chargen-dm-review-modal-head">
          <h3 class="chargen-dm-review-modal-title">
            Edit PC${slot} backstory + accept
          </h3>
          <button
            type="button"
            class="chargen-dm-review-modal-close"
            aria-label="Close edit"
            @click=${() => this.closeEditModal()}
          >
            ×
          </button>
        </header>
        <div class="chargen-dm-review-modal-body">
          ${tokens.length > 0
            ? html`<p class="chargen-dm-review-edit-hint">
                Remove these AI-leaked words before saving:
                ${tokens.map(
                  (t, i) =>
                    html`${i > 0 ? ', ' : ''}<strong
                        class="chargen-dm-review-spoiler-token-inline"
                        >${t}</strong
                      >`
                )}.
              </p>`
            : nothing}
          <label class="chargen-dm-review-edit-field">
            <span>PC name</span>
            <input
              type="text"
              .value=${this.editDraftName}
              maxlength="80"
              @input=${(e: Event) => {
                this.editDraftName = (e.currentTarget as HTMLInputElement).value;
              }}
            />
          </label>
          <label class="chargen-dm-review-edit-field">
            <span>Backstory</span>
            <textarea
              rows="14"
              .value=${this.editDraftBackstory}
              @input=${(e: Event) => {
                this.editDraftBackstory = (
                  e.currentTarget as HTMLTextAreaElement
                ).value;
              }}
            ></textarea>
          </label>
        </div>
        <footer class="chargen-dm-review-modal-foot">
          <button type="button" @click=${() => this.closeEditModal()}>
            Cancel
          </button>
          <button
            type="button"
            class="chargen-dm-review-edit-save"
            ?disabled=${!canSubmit || !this.onAcceptWithEdits}
            @click=${() => this.commitEditAndAccept()}
          >
            Save + accept
          </button>
        </footer>
      </quire-modal>
    `;
  }

  /**
   * Phase 3b polish (2026-05-22): per-seat "Review backstory +
   * answers" now opens a centered <dialog> overlay instead of
   * expanding inline.  Rendered once at the bottom of the
   * component; `reviewModalSlot` drives content + open/close.
   *
   * Uses the native <dialog> element so the browser handles:
   *   - focus trap inside the dialog
   *   - Esc-to-close (we listen for `cancel` to keep state in sync)
   *   - top-layer rendering (above other stacking contexts)
   *
   * Scrolling: outer dialog clips at 85vh / 92vw; the body has its
   * own overflow-y: auto, so long backstories scroll independently
   * of the sticky header.  Reactive layout (mobile + reduced-motion)
   * inherits from the CSS rules in `quire-app.css.ts`.
   */
  private renderReviewDialog(): TemplateResult | typeof nothing {
    const slot = this.reviewModalSlot;
    if (slot === null) return nothing;
    const synth = this.synthResults.get(slot);
    if (!synth || !synth.ok) return nothing;
    const r = synth.response;
    return html`
      <quire-modal
        class="chargen-dm-review-modal"
        ?open=${this.reviewModalSlot !== null}
        .onClose=${() => this.closeReviewModal()}
      >
        <header class="chargen-dm-review-modal-head">
          <h3 class="chargen-dm-review-modal-title">
            Review <strong>${r.name}</strong>
            <span class="muted">${r.pronouns}</span>
            <span class="chargen-dm-review-modal-slot">(PC${slot})</span>
          </h3>
          <button
            type="button"
            class="chargen-dm-review-modal-close"
            aria-label="Close review"
            @click=${() => this.closeReviewModal()}
          >
            ×
          </button>
        </header>
        <div class="chargen-dm-review-modal-body">
          ${this.renderExpandedDiff(slot, r.backstory)}
        </div>
        <footer class="chargen-dm-review-modal-foot">
          <button
            type="button"
            @click=${() => this.closeReviewModal()}
          >
            Close
          </button>
        </footer>
      </quire-modal>
    `;
  }

  /**
   * Open the dialog AFTER Lit has rendered the <dialog> element
   * for the active slot.  `showModal()` MUST be called on a real
   * DOM node, which means we wait for updateComplete then locate
   * the element.  Closing follows the same pattern in reverse.
   */
  /*
   * Phase 3a (2026-05-25): the bespoke updated()-sync,
   * handleDialogBackdropClick, and recordBackdropMouseDown methods
   * were extracted into the `<quire-modal>` primitive (see
   * `../components/quire-modal.ts`).  All four modals now use the
   * shared element; this region keeps only its modal-specific
   * close handlers + content render methods.
   */

  private closeReviewModal(): void {
    this.reviewModalSlot = null;
  }

  /**
   * Step 6 lifts this banner from `<invite-manager>`.  Step 2
   * already includes it because the rendered surface IS the new
   * DM-review area; the legacy mount becomes redundant in step 6.
   *
   * Phase 3b polish (2026-05-22): reworded to point at the new
   * per-seat import + quick-gen affordances now that the gap is
   * closed.  Live WebRTC pull is still future work.
   */
  private renderModeBNote(): TemplateResult {
    return html`
      <div class="chargen-dm-review-mode-b" role="note">
        <strong>Heads up:</strong> the player's chargen answers stay
        on <em>their</em> device.  To synthesize at session 1 you'll
        need either (a) the player sitting next to you with their
        browser open, (b) their packed character file (drop it on
        the seat below, or use the <em>Load packed character</em>
        button), or (c) <em>Quick-generate</em> from a one-line
        prompt when a player skipped chargen.  Live pull-from-player
        is the next step.
      </div>
    `;
  }

  private renderSeat(slot: number): TemplateResult {
    const seat = this.pcSlots?.[slot];
    const boundPcId = seat?.pcId;
    const bound = typeof boundPcId === 'string' && boundPcId.length > 0;
    const synth = this.synthResults.get(slot);
    const inFlight = this.synthInFlight.has(slot);
    const accepted = this.acceptedSlots.has(slot);
    const url = this.lastGeneratedUrl.get(slot);
    const generating = this.generatingFor.has(slot);
    const importStatus = this.importStatus.get(slot);
    const quickOpen = this.quickGenOpen.has(slot);
    const quickInFlight = this.quickGenInFlight.has(slot);
    const dragOver = this.dragOverSeat === slot;
    return html`
      <li
        class="chargen-dm-review-seat ${accepted
          ? 'chargen-dm-review-seat-accepted'
          : ''} ${dragOver ? 'chargen-dm-review-seat-dragover' : ''}"
        data-slot=${slot}
        @dragover=${(e: DragEvent) => this.handleDragOver(slot, e)}
        @dragenter=${(e: DragEvent) => this.handleDragEnter(slot, e)}
        @dragleave=${(e: DragEvent) => this.handleDragLeave(slot, e)}
        @drop=${(e: DragEvent) => void this.handleDrop(slot, e)}
      >
        <header class="chargen-dm-review-seat-head">
          <span class="chargen-dm-review-seat-pill">PC${slot}</span>
          <span class="chargen-dm-review-seat-name">
            ${bound
              ? this.renderBoundName(boundPcId)
              : html`<span class="muted">open</span>`}
          </span>
          ${seat?.state === 'bound-retired'
            ? html`<span
                class="chargen-dm-review-seat-tag chargen-dm-review-seat-tag-retired"
                title="${seat.inFictionRetireReason ?? 'Retired from the story'}"
                >retired</span
              >`
            : nothing}
          ${seat?.state === 'bound-archived'
            ? html`<span
                class="chargen-dm-review-seat-tag chargen-dm-review-seat-tag-archived"
                title="${seat.inFictionRetireReason ?? 'Archived from the roster'}"
                >archived</span
              >`
            : nothing}
          ${this.isSeatRemovable(slot)
            ? html`<button
                type="button"
                class="chargen-dm-review-seat-remove"
                title="Remove this empty seat (undoable for 4 seconds)"
                aria-label="Remove PC${slot}"
                @click=${() => this.handleRemoveSeat(slot)}
              >
                ×
              </button>`
            : nothing}
          ${this.isSeatRetirable(slot)
            ? html`<button
                type="button"
                class="chargen-dm-review-seat-retire"
                title="Retire this PC from the story (with an in-fiction reason)"
                aria-label="Retire PC${slot}"
                @click=${() => this.openRetireDialog(slot)}
              >
                Retire…
              </button>`
            : nothing}
        </header>
        <div class="chargen-dm-review-seat-actions">
          <button
            type="button"
            class="chargen-dm-review-generate"
            ?disabled=${generating || !this.onGenerate}
            @click=${() => void this.handleGenerate(slot)}
          >
            ${generating ? 'Generating…' : 'Generate invite link'}
          </button>
          <label
            class="chargen-dm-review-import-label"
            ?disabled=${!this.onImportPack}
            title="Load the player's packed character JSON for PC${slot} (or drag-drop onto the seat)"
          >
            Load packed character
            <input
              type="file"
              accept="application/json,.json"
              class="chargen-dm-review-import-input"
              ?disabled=${!this.onImportPack}
              @change=${(e: Event) => void this.handleFilePick(slot, e)}
            />
          </label>
          <button
            type="button"
            class="chargen-dm-review-quickgen-toggle"
            ?disabled=${!this.onQuickGenerate}
            aria-expanded=${quickOpen ? 'true' : 'false'}
            title="Quick-generate from a name + one-line concept when the player skipped chargen"
            @click=${() => this.toggleQuickGen(slot)}
          >
            ${quickOpen ? 'Cancel quick-gen' : 'Quick-generate…'}
          </button>
          <button
            type="button"
            class="chargen-dm-review-synthesize"
            ?disabled=${inFlight || !this.onSynthesize}
            title="Synthesize backstory for PC${slot} from saved answers (uses API key)"
            @click=${() => void this.handleSynthesize(slot)}
          >
            ${inFlight ? 'Synthesizing…' : 'Synthesize backstory'}
          </button>
        </div>
        ${importStatus
          ? html`<div
              class="chargen-dm-review-import-status chargen-dm-review-import-status-${importStatus.kind}"
              role="status"
              aria-live="polite"
            >
              ${importStatus.message}
            </div>`
          : nothing}
        ${quickOpen ? this.renderQuickGenForm(slot, quickInFlight) : nothing}
        ${url ? this.renderInviteResult(slot, url) : nothing}
        ${synth ? this.renderSynthResult(slot, synth) : nothing}
      </li>
    `;
  }

  private renderQuickGenForm(
    slot: number,
    inFlight: boolean
  ): TemplateResult {
    const name = this.quickGenName.get(slot) ?? '';
    const hook = this.quickGenHook.get(slot) ?? '';
    const canSubmit = name.trim().length > 0 && hook.trim().length > 0;
    return html`
      <form
        class="chargen-dm-review-quickgen-form"
        @submit=${(e: Event) => {
          e.preventDefault();
          if (canSubmit && !inFlight) void this.handleQuickGenSubmit(slot);
        }}
      >
        <label class="chargen-dm-review-quickgen-field">
          <span>PC name</span>
          <input
            type="text"
            .value=${name}
            placeholder="e.g. Anya"
            maxlength="80"
            @input=${(e: Event) =>
              this.setQuickGenField(
                slot,
                'name',
                (e.currentTarget as HTMLInputElement).value
              )}
          />
        </label>
        <label class="chargen-dm-review-quickgen-field">
          <span>One-line concept</span>
          <textarea
            rows="2"
            maxlength="400"
            placeholder="e.g. jaded EMT who fled Chicago to look for her sister"
            .value=${hook}
            @input=${(e: Event) =>
              this.setQuickGenField(
                slot,
                'hook',
                (e.currentTarget as HTMLTextAreaElement).value
              )}
          ></textarea>
        </label>
        <button
          type="submit"
          class="chargen-dm-review-quickgen-submit"
          ?disabled=${!canSubmit || inFlight}
        >
          ${inFlight ? 'Generating…' : 'Generate'}
        </button>
      </form>
    `;
  }

  /**
   * P3U-12: render the bound seat's display name.  Lit auto-escapes
   * interpolated content, so a hostile `name` field in the
   * character JSON cannot inject HTML.  Falls back to the raw pcId
   * (in a code-tag) while the lookup resolves OR if the character
   * file has no name field.
   */
  private renderBoundName(pcId: string): TemplateResult {
    const name = this.displayNameLookup?.(pcId) ?? null;
    if (name && name !== pcId) {
      return html`<span class="chargen-dm-review-seat-display-name"
        >${name}</span
      ><code
        class="chargen-dm-review-seat-id"
        title="Character id"
        >(${pcId})</code
      >`;
    }
    return html`<code title="Character id">${pcId}</code>`;
  }

  private renderInviteResult(slot: number, url: string): TemplateResult {
    return html`
      <div
        class="chargen-dm-review-invite-result"
        role="status"
        aria-live="polite"
      >
        <input
          type="text"
          class="chargen-dm-review-invite-url"
          readonly
          .value=${url}
          @focus=${(e: Event) => (e.target as HTMLInputElement).select()}
        />
        <button
          type="button"
          class="chargen-dm-review-invite-copy"
          @click=${() => void this.handleCopy(slot, url)}
        >
          Copy
        </button>
        ${this.copiedFor === slot
          ? html`<span class="chargen-dm-review-invite-copied">Copied!</span>`
          : nothing}
        <p class="muted chargen-dm-review-invite-note">
          Heads up: generating a new invite for this seat invalidates
          any prior link.  If you remove and re-add the seat, the
          previous URL still routes to slot ${slot} — best to copy
          a fresh one.
        </p>
      </div>
    `;
  }

  private renderSynthResult(
    slot: number,
    synth: SynthesizeBackstoryResult
  ): TemplateResult {
    if (synth.ok) {
      const r = synth.response;
      const warningCount = synth.warnings.length;
      const accepted = this.acceptedSlots.has(slot);
      return html`
        <div class="chargen-dm-review-synth chargen-dm-review-synth-ok">
          <div class="chargen-dm-review-synth-name">
            ✓ ${this.renderHeaderField(slot, 'name', r.name, accepted)}
            <span class="muted">— ${this.renderHeaderField(
              slot,
              'pronouns',
              r.pronouns,
              accepted
            )}</span>
          </div>
          ${this.renderTagChips(r.tags, slot)}
          ${this.renderStatGrid(r.stats, slot)}
          ${this.renderSkillChips(r.skillMastery, slot)}
          ${this.renderPronounPatchHint(slot)}
          ${this.renderDriftBanner(slot)}
          ${warningCount > 0
            ? html`<div class="chargen-dm-review-synth-warnings">
                ${warningCount} validator warning${warningCount === 1
                  ? ''
                  : 's'} — review carefully.
                <ul class="chargen-dm-review-warning-list">
                  ${synth.warnings.map(
                    (w) => html`<li><code>${w.code}</code>: ${w.message}</li>`
                  )}
                </ul>
              </div>`
            : nothing}
          ${accepted
            ? html`<div class="chargen-dm-review-synth-accepted">
                Accepted by DM.
              </div>`
            : nothing}
          <button
            type="button"
            class="chargen-dm-review-expand"
            title="Open the full backstory + player-answers review in a modal"
            @click=${() => this.openReviewModal(slot)}
          >
            Review backstory + answers
          </button>
          ${this.renderJoiningSessionPicker(slot, accepted)}
          ${this.renderAcceptReviseActions(slot, accepted)}
        </div>
      `;
    }
    const isSpoiler = synth.code === 'spoiler-leak-persistent';
    // Phase 3b polish (2026-05-23): when we have the parsed-but-
    // rejected response (currently only on spoiler-leak), surface
    // the synthesized fields + persistent tokens + an "Edit +
    // accept" affordance so the DM doesn't lose the salvageable
    // backstory on a recoverable failure.
    const canHandEdit =
      isSpoiler &&
      synth.code === 'spoiler-leak-persistent' &&
      !!synth.rejectedResponse;
    return html`
      <div
        class="chargen-dm-review-synth ${isSpoiler
          ? 'chargen-dm-review-synth-spoiler'
          : 'chargen-dm-review-synth-err'}"
      >
        <div class="chargen-dm-review-synth-label">
          ${isSpoiler ? '⚠ Spoiler leak' : '✗ Synthesis failed'}
        </div>
        <div class="chargen-dm-review-synth-message">${synth.message}</div>
        ${isSpoiler && synth.persistentTokens && synth.persistentTokens.length > 0
          ? html`<ul class="chargen-dm-review-spoiler-tokens" aria-label="Forbidden words detected">
              ${synth.persistentTokens.map(
                (t) =>
                  html`<li
                    class="chargen-dm-review-spoiler-token"
                    title="Campaign-forbidden term"
                  >
                    ${t}
                  </li>`
              )}
            </ul>`
          : nothing}
        ${canHandEdit && synth.rejectedResponse
          ? html`<div class="chargen-dm-review-rejected-preview">
              <div class="chargen-dm-review-synth-name">
                Generated as
                <strong>${synth.rejectedResponse.name}</strong>
                <span class="muted">
                  — ${synth.rejectedResponse.pronouns}
                </span>
              </div>
              ${this.renderTagChips(synth.rejectedResponse.tags)}
              ${this.renderStatGrid(synth.rejectedResponse.stats)}
              ${this.renderSkillChips(synth.rejectedResponse.skillMastery)}
            </div>`
          : nothing}
        ${this.renderFailureActions(slot, canHandEdit)}
      </div>
    `;
  }

  /**
   * Phase 3b polish (2026-05-23): action row for a failed synth.
   * Replaces the prior "Ask player to revise" lone button (which
   * made no sense for DM-driven quick-gen).  Now:
   *   - "Edit + accept" (shown only when we have rejectedResponse)
   *     opens a textarea modal so the DM can clean up the leak +
   *     commit.
   *   - "Discard + try again" always shown — clears the failed
   *     result, returning the seat to the pre-synth state.
   *   - "Ask player to revise" stays as a tertiary option for the
   *     player-driven case (the audit-note framing makes sense
   *     when answers came from the player).
   */
  private renderFailureActions(
    slot: number,
    canHandEdit: boolean
  ): TemplateResult {
    return html`
      <div class="chargen-dm-review-synth-actions">
        ${canHandEdit
          ? html`<button
              type="button"
              class="chargen-dm-review-edit-accept"
              ?disabled=${!this.onAcceptWithEdits}
              title="Open the generated backstory in an editor; remove the leaked words; accept"
              @click=${() => this.openEditModal(slot)}
            >
              Edit + accept
            </button>`
          : nothing}
        <button
          type="button"
          class="chargen-dm-review-discard"
          ?disabled=${!this.onRevise}
          title="Discard this result; the seat returns to its pre-synth state"
          @click=${() => this.onRevise?.(slot, 'discarded by DM')}
        >
          Discard + try again
        </button>
      </div>
    `;
  }

  /**
   * CC-24 + P3T-19: DM-side accept / revise actions on the result
   * card.  Accept is only enabled on `ok` results (the host's
   * controller filters this too).  Revise is always available so
   * the DM can clear a bad result and re-synthesize.
   */
  /**
   * P-R12 (2026-05-25): mid-campaign join picker.  When the DM is
   * adding a PC after session 1, this lets them say "this PC is
   * joining at session N" so the engine seeds catch-up marks +
   * advancements (N - 1 of each).  Hidden after accept (the
   * value is locked into the pc-create event) + when no
   * onSetJoiningSession callback is wired.
   *
   * Defaults to 1.  Picker is intentionally minimal — a `<input
   * type=number>` with a tiny aria-labelled hint.  TTRPG-R4's
   * "ONE thing missing for first-table" wanted at minimum a way
   * to seed marks; this is that minimum.
   */
  private renderJoiningSessionPicker(
    slot: number,
    accepted: boolean
  ): TemplateResult | typeof nothing {
    if (accepted) return nothing;
    if (!this.onSetJoiningSession) return nothing;
    const current = this.joiningSession.get(slot) ?? 1;
    return html`
      <div class="chargen-dm-review-joining-session">
        <label>
          <span class="muted">Joining mid-campaign?  Session #</span>
          <input
            type="number"
            class="chargen-dm-review-joining-input"
            min="1"
            max="20"
            step="1"
            .value=${String(current)}
            aria-label="Session number this PC joins at (for catch-up marks)"
            @change=${(e: Event) => {
              const n = Number((e.target as HTMLInputElement).value);
              if (Number.isFinite(n) && n >= 1 && n <= 20) {
                this.onSetJoiningSession?.(slot, Math.floor(n));
              }
            }}
          />
          ${current > 1
            ? html`<span class="muted chargen-dm-review-joining-hint">
                starts with ${current - 1} session-mark${current - 1 === 1
                  ? ''
                  : 's'} (advancements earned at end-of-session like
                everyone else)
              </span>`
            : html`<span class="muted chargen-dm-review-joining-hint">
                no catch-up (default)
              </span>`}
        </label>
      </div>
    `;
  }

  private renderAcceptReviseActions(
    slot: number,
    accepted: boolean
  ): TemplateResult {
    const synth = this.synthResults.get(slot);
    const okResult = synth?.ok === true;
    // Wave 3 polish (2026-05-25, UX-R4 fix #2): re-sync is async +
    // takes 10-30s.  While it's in flight for this slot, gate
    // anything that would mutate the in-progress result so the DM
    // doesn't accidentally commit a stale-pre-resync value.
    const resyncing = this.resyncInFlight.has(slot);
    return html`
      <div class="chargen-dm-review-synth-actions">
        ${okResult
          ? html`<button
              type="button"
              class="chargen-dm-review-accept"
              ?disabled=${accepted || !this.onAccept || resyncing}
              title="${resyncing
                ? 'Re-sync in flight — wait for the new backstory'
                : 'Accept this synthesized PC; appends an audit note'}"
              @click=${() => this.onAccept?.(slot)}
            >
              ${accepted ? 'Accepted' : 'Accept this PC'}
            </button>`
          : nothing}
        ${synth
          ? html`<button
              type="button"
              class="chargen-dm-review-revise"
              ?disabled=${!this.onRevise || resyncing}
              title="${resyncing
                ? 'Re-sync in flight — wait for the new backstory'
                : 'Ask the player to revise an answer + clear this result'}"
              @click=${() => this.handleRevise(slot)}
            >
              Ask player to revise
            </button>`
          : nothing}
      </div>
    `;
  }

  private openReviewModal(slot: number): void {
    this.reviewModalSlot = slot;
  }

  /**
   * Phase 3b polish (2026-05-23): seed the edit dialog from the
   * spoiler-leak-rejected response and open it.  Quietly no-ops if
   * the slot has no rejected response.
   */
  private openEditModal(slot: number): void {
    const synth = this.synthResults.get(slot);
    if (!synth || synth.ok || !synth.rejectedResponse) return;
    this.editDraftName = synth.rejectedResponse.name;
    this.editDraftBackstory = synth.rejectedResponse.backstory;
    this.editModalSlot = slot;
  }

  private closeEditModal(): void {
    this.editModalSlot = null;
  }

  private commitEditAndAccept(): void {
    const slot = this.editModalSlot;
    if (slot === null || !this.onAcceptWithEdits) return;
    const name = this.editDraftName.trim();
    const backstory = this.editDraftBackstory.trim();
    if (!name || !backstory) return;
    const ok = this.onAcceptWithEdits(slot, { name, backstory });
    if (ok) this.editModalSlot = null;
  }

  // ---- Step 5: full review card pieces ----

  /**
   * Wave 2 (2026-05-25): render a synth-result header field
   * (`name` or `pronouns`) as either a display span or an inline
   * text input depending on `editingHeader`.  Click → switches to
   * input.  Enter or blur commits via `onEditPreAccept`.  Esc
   * cancels.  Accepted slots are display-only (post-accept edits
   * live in Wave 3 with a different visibility model).
   */
  private renderHeaderField(
    slot: number,
    field: 'name' | 'pronouns',
    value: string,
    accepted: boolean
  ): TemplateResult {
    const editing =
      this.editingHeader?.slot === slot && this.editingHeader.field === field;
    if (editing) {
      return html`
        <input
          type="text"
          class="chargen-dm-review-header-input chargen-dm-review-header-input-${field}"
          .value=${value}
          aria-label="Edit ${field}"
          autofocus
          @keydown=${(e: KeyboardEvent) => this.handleHeaderInputKey(e)}
          @blur=${(e: FocusEvent) =>
            this.commitHeaderEdit((e.target as HTMLInputElement).value)}
        />
      `;
    }
    if (accepted || !this.onEditPreAccept) {
      // Post-accept (or no callback): render as a static span — no
      // pencil affordance.  Wave 3 will offer the post-accept
      // edit path with a different visual treatment.
      return field === 'name'
        ? html`<strong>${value}</strong>`
        : html`${value}`;
    }
    // Post-R5 UX fix: render a faint pencil glyph so the click-to-edit
    // affordance is discoverable without hover.  UX-R5 ranked this
    // as a first-table blocker.
    return html`<button
      type="button"
      class="chargen-dm-review-header-edit chargen-dm-review-header-edit-${field}"
      title="Click to edit ${field}"
      aria-label="Edit ${field} (currently ${value})"
      @click=${() => this.openHeaderEdit(slot, field)}
    >
      ${field === 'name' ? html`<strong>${value}</strong>` : html`${value}`}<span
        class="chargen-dm-review-header-edit-pencil"
        aria-hidden="true"
        >✎</span
      >
    </button>`;
  }

  /**
   * Wave 2 (2026-05-25): drift banner — surfaces fields where the
   * DM has edited the synth result away from the AI's original
   * output.  Three actions:
   *   - [Patch in place]   — Wave 3 (disabled stub)
   *   - [Re-sync backstory]— Wave 3 (disabled stub)
   *   - [Leave drift]      — Wave 2 active.  Dismisses the banner;
   *                          edit value stays.
   * Per the chargen-authorship memory: drift is INFORMATIONAL, not
   * blocking.  The DM remains the authority.
   */
  /**
   * Wave 3 polish (2026-05-25, TTRPG-R4 fix #5): non-blocking hint
   * surfaced when the DM has just Patch-in-placed a pronoun delta.
   * The deterministic substitution leaves verb agreement intact
   * ("she was" stays "they was") — point this out so the DM can
   * choose to Re-sync the prose if they care.  Dismisses on next
   * edit OR an explicit dismiss click.
   */
  private renderPronounPatchHint(
    slot: number
  ): TemplateResult | typeof nothing {
    if (!this.pronounPatchedSlots.has(slot)) return nothing;
    return html`
      <div class="chargen-dm-review-pronoun-hint" role="status">
        <span>
          ✎ Patched pronouns deterministically.  Verb agreement
          (e.g., "she was" → "they was") may still need cleanup —
          ${this.onResyncBackstory
            ? 'click "Re-sync backstory" to let the AI tidy.'
            : 'edit the backstory directly to fix.'}
        </span>
        <button
          type="button"
          class="chargen-dm-review-pronoun-hint-dismiss"
          title="Dismiss this hint"
          aria-label="Dismiss pronoun-patch hint"
          @click=${() => this.onDismissPronounPatchHint?.(slot)}
        >
          ×
        </button>
      </div>
    `;
  }

  private renderDriftBanner(slot: number): TemplateResult | typeof nothing {
    const drift = this.preAcceptDrift.get(slot);
    if (!drift) return nothing;
    const fields = Object.keys(drift) as Array<
      keyof PcBackstorySynthesisResponse
    >;
    if (fields.length === 0) return nothing;
    const synth = this.synthResults.get(slot);
    if (!synth?.ok) return nothing;
    // Wave 3a: which fields are deterministically patchable.
    const patchable = fields.filter((f) => f === 'name' || f === 'pronouns');
    const hasUnpatchable = fields.length > patchable.length;
    const resyncing = this.resyncInFlight.has(slot);
    const failure = this.resyncFailures.get(slot);
    return html`
      <div class="chargen-dm-review-drift">
        ${this.renderDriftPip(fields.length, patchable.length, hasUnpatchable)}
        <ul class="chargen-dm-review-drift-list" aria-live="off">
          ${fields.map((field) => this.renderDriftRow(slot, field, drift, synth.response))}
        </ul>
        ${this.renderDriftActions(slot, patchable, hasUnpatchable)}
        ${resyncing
          ? html`<div
              class="chargen-dm-review-drift-resync-status"
              role="status"
              aria-live="polite"
            >
              Re-syncing backstory… typically 10-20 seconds.  The new
              backstory will replace the current one; other edits on
              this seat are paused.
            </div>`
          : nothing}
        ${failure
          ? html`<div
              class="chargen-dm-review-drift-resync-failure"
              role="alert"
            >
              <span>
                ⚠ Re-sync failed (<code>${failure.code}</code>):
                ${failure.message}  Drift edits preserved — you can
                retry, Patch, or Leave drift.
              </span>
              <button
                type="button"
                class="chargen-dm-review-drift-resync-failure-dismiss"
                title="Dismiss this banner"
                aria-label="Dismiss re-sync failure"
                @click=${() => this.onDismissResyncFailure?.(slot)}
              >
                ×
              </button>
            </div>`
          : nothing}
      </div>
    `;
  }

  private summarizePatchable(
    patchable: Array<keyof PcBackstorySynthesisResponse>
  ): string {
    if (patchable.length === 1) return String(patchable[0]);
    return patchable.map((p) => String(p)).join(' + ');
  }

  private renderDriftPip(
    total: number,
    patchableCount: number,
    hasUnpatchable: boolean
  ): TemplateResult {
    if (hasUnpatchable && patchableCount > 0) {
      return html`<div
        class="chargen-dm-review-drift-pip"
        role="status"
        aria-live="polite"
      >
        ✎ <strong>${total} edit${total === 1 ? '' : 's'}</strong> since
        synth.  Patch covers name + pronoun substitutions; the AI
        re-sync tool (for tag / stat / skill rewrites) arrives next.
      </div>`;
    }
    if (hasUnpatchable) {
      return html`<div
        class="chargen-dm-review-drift-pip"
        role="status"
        aria-live="polite"
      >
        ✎ <strong>${total} edit${total === 1 ? '' : 's'}</strong> since
        synth.  Prose may now mismatch — the AI re-sync tool arrives
        next.
      </div>`;
    }
    return html`<div
      class="chargen-dm-review-drift-pip"
      role="status"
      aria-live="polite"
    >
      ✎ <strong>${total} edit${total === 1 ? '' : 's'}</strong> since
      synth.  Patch applies the substitution to the backstory text.
    </div>`;
  }

  private handlePatchInPlace(slot: number): void {
    this.onPatchInPlace?.(slot);
  }

  /**
   * Wave 3b: render the drift action row.  Combinations:
   *   - patchable only        → [Patch]
   *   - patchable + unpatchable → [Patch] + [Re-sync]
   *   - unpatchable only      → [Re-sync]
   *   - no callbacks wired    → nothing
   */
  private renderDriftActions(
    slot: number,
    patchable: Array<keyof PcBackstorySynthesisResponse>,
    hasUnpatchable: boolean
  ): TemplateResult | typeof nothing {
    const patchAvail = patchable.length > 0 && this.onPatchInPlace;
    const resyncAvail = hasUnpatchable && this.onResyncBackstory;
    if (!patchAvail && !resyncAvail) return nothing;
    const inFlight = this.resyncInFlight.has(slot);
    return html`<div class="chargen-dm-review-drift-actions">
      ${patchAvail
        ? html`<button
            type="button"
            class="chargen-dm-review-drift-patch"
            title="Apply name/pronoun substitutions to the backstory text deterministically (no AI call)"
            ?disabled=${inFlight}
            @click=${() => this.handlePatchInPlace(slot)}
          >
            Patch ${this.summarizePatchable(patchable)} in backstory
          </button>`
        : nothing}
      ${resyncAvail
        ? html`<button
            type="button"
            class="chargen-dm-review-drift-resync"
            title="Ask the AI to regenerate the backstory honoring the field edits (one AI call)"
            ?disabled=${inFlight}
            @click=${() => void this.handleResyncBackstory(slot)}
          >
            ${inFlight ? 'Re-syncing…' : 'Re-sync backstory'}
          </button>`
        : nothing}
    </div>`;
  }

  private async handleResyncBackstory(slot: number): Promise<void> {
    if (!this.onResyncBackstory) return;
    if (this.resyncInFlight.has(slot)) return;
    // Controller manages in-flight set + requestUpdate now (post-R5
    // QA-BUG-3 fix).  This handler is just plumbing.
    await this.onResyncBackstory(slot);
  }

  /**
   * Post-Wave-2 polish: render a single drift row.  Stats get a
   * compact delta-only display ("CHA +2 → +1, STR 0 → +2") instead
   * of the full distribution; everything else uses the standard
   * before/after.  Patch + Re-sync buttons removed entirely until
   * Wave 3 lights them — disabled stubs read as broken UI per the
   * UX review.
   */
  private renderDriftRow(
    slot: number,
    field: keyof PcBackstorySynthesisResponse,
    drift: Partial<PcBackstorySynthesisResponse>,
    current: PcBackstorySynthesisResponse
  ): TemplateResult {
    const before = drift[field];
    const after = current[field];
    if (field === 'stats' && this.isStatsLike(before) && this.isStatsLike(after)) {
      const changes: string[] = [];
      const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
      for (const k of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const) {
        if (before[k] !== after[k]) {
          changes.push(`${k} ${fmt(before[k])} → ${fmt(after[k])}`);
        }
      }
      return html`<li class="chargen-dm-review-drift-row">
        <span class="chargen-dm-review-drift-field">stats:</span>
        <span class="chargen-dm-review-drift-stats">${changes.join(', ')}</span>
        <button
          type="button"
          class="chargen-dm-review-drift-leave"
          title="Keep the edit; hide this banner row"
          @click=${() => this.handleLeaveDrift(slot, field)}
        >
          Leave drift
        </button>
      </li>`;
    }
    return html`<li class="chargen-dm-review-drift-row">
      <span class="chargen-dm-review-drift-field">${String(field)}:</span>
      <span class="chargen-dm-review-drift-before">${this.formatDriftValue(
        before
      )}</span>
      <span class="chargen-dm-review-drift-arrow">→</span>
      <span class="chargen-dm-review-drift-after">${this.formatDriftValue(
        after
      )}</span>
      <button
        type="button"
        class="chargen-dm-review-drift-leave"
        title="Keep the edit; hide this banner row"
        @click=${() => this.handleLeaveDrift(slot, field)}
      >
        Leave drift
      </button>
    </li>`;
  }

  private formatDriftValue(v: unknown): string {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.join(', ');
    if (this.isStatsLike(v)) return this.formatStatsDelta(v);
    if (v && typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  /**
   * Post-Wave-2 polish (2026-05-25, TTRPG review fix): stats-drift
   * row previously dumped JSON.  The actual question the DM cares
   * about is "what swapped?" — so render the per-key delta instead.
   */
  private isStatsLike(
    v: unknown
  ): v is { STR: number; DEX: number; CON: number; INT: number; WIS: number; CHA: number } {
    if (!v || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    return ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].every(
      (k) => typeof o[k] === 'number'
    );
  }

  /**
   * Render the drift row's `before` cell for stats as a compact
   * label list (just the stats that changed will be visible — the
   * "after" cell will mirror it via the diffing in
   * renderStatsDriftRow).  Caller uses this for both before/after.
   */
  private formatStatsDelta(stats: {
    STR: number; DEX: number; CON: number; INT: number; WIS: number; CHA: number;
  }): string {
    const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    return (['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const)
      .map((k) => `${k} ${fmt(stats[k])}`)
      .join(', ');
  }

  /**
   * Tags chips — 3-5 free-text expertise items.  Wave 2 (2026-05-25):
   * editable when the slot has an ok-result + onEditPreAccept is
   * wired + not accepted.  Each chip gets a × delete affordance;
   * a trailing "+" chip opens an inline input for add.  Edits fire
   * onEditPreAccept({ tags: [...] }).
   */
  private renderTagChips(
    tags: readonly string[],
    slot?: number
  ): TemplateResult {
    const editable =
      typeof slot === 'number' &&
      !!this.onEditPreAccept &&
      !this.acceptedSlots.has(slot) &&
      this.synthResults.get(slot)?.ok === true;
    return html`<chip-editor
      class="chargen-dm-review-chips chargen-dm-review-tags"
      aria-label="Tags"
      kind="text"
      labelAdd="+ tag"
      labelAriaAdd="Add a new tag"
      labelAriaRemoveTemplate="Remove tag {0}"
      placeholder="new tag"
      ?editable=${editable}
      ?dedupe=${true}
      .items=${tags}
      .onAdd=${editable && slot !== undefined
        ? (v: string) => this.handleTagAdd(slot, tags, v)
        : null}
      .onRemove=${editable && slot !== undefined
        ? (i: number) => this.handleTagRemove(slot, i)
        : null}
    ></chip-editor>`;
  }

  private handleTagAdd(
    slot: number,
    tags: readonly string[],
    value: string
  ): void {
    if (!this.onEditPreAccept) return;
    this.onEditPreAccept(slot, { tags: [...tags, value] });
  }

  private handleTagRemove(slot: number, idx: number): void {
    const synth = this.synthResults.get(slot);
    if (!synth?.ok || !this.onEditPreAccept) return;
    const tags = synth.response.tags;
    const next = [...tags.slice(0, idx), ...tags.slice(idx + 1)];
    this.onEditPreAccept(slot, { tags: next });
  }

  /**
   * Stats grid — 6 quire-v0.1 stats laid out as label + signed
   * modifier.  Wave 2 (2026-05-25): when `onEditPreAccept` is
   * wired AND the slot isn't accepted, cells become clickable
   * for the swap-pair UX.  Soft-lock on the player's chosen +2
   * (per stat-emphasis question; sourced from drift snapshot if
   * present, else from current stats).
   *
   * Swap interaction (click-pair, not drag — keyboard-friendlier
   * and trivially testable in happy-dom):
   *   - First click: cell becomes "selected" (visual border).
   *   - Second click on same cell: cancels selection.
   *   - Second click on a different cell: if either cell is the
   *     player's +2 anchor, surfaces a confirm strip ("override?").
   *     Otherwise the swap commits immediately.
   *
   * Array invariant (one +2, three +1s, two 0s) is preserved by
   * construction — we're only permuting the existing values.
   */
  private renderStatGrid(
    stats: {
      STR: number;
      DEX: number;
      CON: number;
      INT: number;
      WIS: number;
      CHA: number;
    },
    slot?: number
  ): TemplateResult {
    const fmt = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
    const editable =
      typeof slot === 'number' &&
      !!this.onEditPreAccept &&
      !this.acceptedSlots.has(slot);
    // Determine the player-pick stat (originally received the +2 from
    // the AI).  When drift snapshot has stats, use it as the source
    // of truth; otherwise the current +2 holder IS the original.
    const driftStats = slot !== undefined
      ? (this.preAcceptDrift.get(slot)?.stats as typeof stats | undefined)
      : undefined;
    const refStats = driftStats ?? stats;
    let playerPickKey: keyof typeof stats | null = null;
    for (const k of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as Array<
      keyof typeof stats
    >) {
      if (refStats[k] === 2) {
        playerPickKey = k;
        break;
      }
    }
    const cell = (
      label: string,
      key: keyof typeof stats
    ): TemplateResult => {
      const selected =
        editable &&
        this.selectedStatCell?.slot === slot &&
        this.selectedStatCell.key === key;
      const isPick = playerPickKey === key;
      const classes = [
        'chargen-dm-review-stat-cell',
        editable ? 'chargen-dm-review-stat-cell-editable' : '',
        selected ? 'chargen-dm-review-stat-cell-selected' : '',
        isPick ? 'chargen-dm-review-stat-cell-pick' : ''
      ]
        .filter(Boolean)
        .join(' ');
      const lockGlyph = isPick
        ? html`<span
            class="chargen-dm-review-stat-lock"
            title="Player chose this stat for their +2 (stat-emphasis question).  Swapping is allowed but asks for confirm."
            aria-hidden="true"
            >🔒</span
          >`
        : nothing;
      const body = html`
        <span class="chargen-dm-review-stat-label">${label}</span>
        <span class="chargen-dm-review-stat-mod">${fmt(stats[key])}</span>
        ${lockGlyph}
      `;
      if (!editable || slot === undefined) {
        return html`<div class=${classes}>${body}</div>`;
      }
      const lockNote = isPick ? ' (player-picked +2)' : '';
      return html`<button
        type="button"
        class=${classes}
        title="Click to ${selected ? 'cancel' : 'select'} for swap"
        aria-pressed=${selected ? 'true' : 'false'}
        aria-label="Stat ${label} ${fmt(stats[key])}${lockNote}, click to ${selected ? 'cancel selection' : 'select for swap'}"
        @click=${() => this.handleStatCellClick(slot, key)}
      >
        ${body}
      </button>`;
    };
    return html`
      <div class="chargen-dm-review-stat-grid" aria-label="Starting stats">
        ${cell('STR', 'STR')}${cell('DEX', 'DEX')}${cell('CON', 'CON')}
        ${cell('INT', 'INT')}${cell('WIS', 'WIS')}${cell('CHA', 'CHA')}
      </div>
      ${editable
        ? html`<div class="chargen-dm-review-stat-hint muted">
            Click two cells to swap their values${playerPickKey
              ? html` (player's ${playerPickKey} 🔒 confirms first)`
              : nothing}.
          </div>`
        : nothing}
      ${this.renderPendingStatSwap(slot)}
    `;
  }

  /**
   * Wave 2 (2026-05-25): inline confirm strip for a swap that
   * touches the player's-+2 anchor.  Rendered when pendingStatSwap
   * matches the slot.
   */
  private renderPendingStatSwap(
    slot: number | undefined
  ): TemplateResult | typeof nothing {
    if (slot === undefined) return nothing;
    const pending = this.pendingStatSwap;
    if (!pending || pending.slot !== slot) return nothing;
    return html`
      <div class="chargen-dm-review-stat-confirm" role="alert">
        <span
          >Swap involves the player's chosen +2 stat
          (<code>${pending.from === this.findPlayerPickKey(slot) ? pending.from : pending.to}</code>).  Confirm
          override?</span
        >
        <button
          type="button"
          class="chargen-dm-review-stat-confirm-yes"
          @click=${() => this.commitPendingStatSwap()}
        >
          Override
        </button>
        <button
          type="button"
          class="chargen-dm-review-stat-confirm-no"
          @click=${() => {
            this.pendingStatSwap = null;
          }}
        >
          Cancel
        </button>
      </div>
    `;
  }

  private findPlayerPickKey(
    slot: number
  ): 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA' | null {
    const drift = this.preAcceptDrift.get(slot);
    const synth = this.synthResults.get(slot);
    if (!synth?.ok) return null;
    const driftStats = drift?.stats as typeof synth.response.stats | undefined;
    const ref = driftStats ?? synth.response.stats;
    for (const k of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const) {
      if (ref[k] === 2) return k;
    }
    return null;
  }

  private handleStatCellClick(
    slot: number,
    key: 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA'
  ): void {
    const selected = this.selectedStatCell;
    if (!selected || selected.slot !== slot) {
      this.selectedStatCell = { slot, key };
      return;
    }
    if (selected.key === key) {
      this.selectedStatCell = null;
      return;
    }
    const pick = this.findPlayerPickKey(slot);
    if (pick === selected.key || pick === key) {
      // Soft-lock: require explicit confirm before mutating.
      this.pendingStatSwap = { slot, from: selected.key, to: key };
      this.selectedStatCell = null;
      return;
    }
    this.applyStatSwap(slot, selected.key, key);
    this.selectedStatCell = null;
  }

  private commitPendingStatSwap(): void {
    const pending = this.pendingStatSwap;
    if (!pending) return;
    this.applyStatSwap(pending.slot, pending.from, pending.to);
    this.pendingStatSwap = null;
  }

  private applyStatSwap(
    slot: number,
    a: 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA',
    b: 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA'
  ): void {
    if (!this.onEditPreAccept) return;
    const synth = this.synthResults.get(slot);
    if (!synth?.ok) return;
    const next = { ...synth.response.stats };
    const tmp = next[a];
    next[a] = next[b];
    next[b] = tmp;
    this.onEditPreAccept(slot, { stats: next });
  }

  /** Skill mastery chips — 2-3 quire-v0.1 categories. */
  private renderSkillChips(
    skills: readonly string[],
    slot?: number
  ): TemplateResult {
    const editable =
      typeof slot === 'number' &&
      !!this.onEditPreAccept &&
      !this.acceptedSlots.has(slot) &&
      this.synthResults.get(slot)?.ok === true;
    return html`<chip-editor
      class="chargen-dm-review-chips chargen-dm-review-skills"
      aria-label="Skill mastery"
      kind="select"
      chipClass="chargen-dm-review-chip-skill"
      labelAdd="+ skill"
      labelAriaAdd="Add a skill category"
      labelAriaRemoveTemplate="Remove skill {0}"
      ?editable=${editable}
      ?dedupe=${true}
      .items=${skills}
      .options=${[...QUIRE_SKILL_CATEGORIES]}
      .onAdd=${editable && slot !== undefined
        ? (v: string) => this.handleSkillAdd(slot, skills, v)
        : null}
      .onRemove=${editable && slot !== undefined
        ? (i: number) => this.handleSkillRemove(slot, i)
        : null}
    ></chip-editor>`;
  }

  private handleSkillAdd(
    slot: number,
    skills: readonly string[],
    value: string
  ): void {
    if (!this.onEditPreAccept) return;
    this.onEditPreAccept(slot, { skillMastery: [...skills, value] });
  }

  private handleSkillRemove(slot: number, idx: number): void {
    const synth = this.synthResults.get(slot);
    if (!synth?.ok || !this.onEditPreAccept) return;
    const skills = synth.response.skillMastery;
    const next = [...skills.slice(0, idx), ...skills.slice(idx + 1)];
    this.onEditPreAccept(slot, { skillMastery: next });
  }

  /**
   * P3T-16: SA-vs-backstory diff.  Renders the four load-bearing
   * short-answer-key questions on the left + the full backstory on
   * the right with substring-highlighting of key noun phrases from
   * the answers.  v1 highlighting is simple substring match (no
   * stemming, no semantic similarity); the F-V1/F-V2 semantic
   * validator (P3T-12 backlog) is the proper layer for that.
   *
   * The DM scans both halves to verify the AI honored the player's
   * answers.  When the diff shows no anchor highlights at all, the
   * AI probably reinterpreted — the Revise button is the escape
   * hatch.
   */
  private renderExpandedDiff(
    slot: number,
    backstory: string
  ): TemplateResult {
    const answers = this.answersLookup?.(slot) ?? null;
    // Phase 3b polish (2026-05-23): iterate the CAMPAIGN's declared
    // questions (in their authored order) rather than a hardcoded
    // Underleaf anchor list.  When the campaign doesn't declare any,
    // fall back to iterating whatever keys are present in `answers`.
    const qs = this.questions ?? [];
    const items: Array<{
      id: string;
      label: string;
      display: string | null;
    }> = qs.length > 0
      ? qs.map((q) => ({
          id: q.id,
          label: q.prompt,
          display: this.formatAnswerForDisplay(q, answers?.[q.id] ?? '')
        }))
      : answers
        ? Object.entries(answers).map(([id, v]) => ({
            id,
            label: id,
            display: v === '' ? null : v
          }))
        : [];
    const paragraphs = backstory
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    return html`
      <div class="chargen-dm-review-diff" role="group" aria-label="Backstory review">
        <div class="chargen-dm-review-diff-answers">
          <h4>Player's answers</h4>
          ${answers === null
            ? html`<p class="muted">
                No saved answers on this device.  (Player on another
                device, or pre-pack-intake.)
              </p>`
            : items.length === 0
              ? html`<p class="muted">
                  No questions declared in the campaign and no saved
                  answers to display.
                </p>`
              : html`<dl>
                  ${items.map(
                    (item) => html`<dt>${item.label}</dt>
                      <dd class=${item.display === null ? 'muted' : ''}>
                        ${item.display ?? '(not answered)'}
                      </dd>`
                  )}
                </dl>`}
        </div>
        <div class="chargen-dm-review-diff-backstory">
          <h4>AI backstory</h4>
          <div class="chargen-dm-review-backstory-body">
            ${paragraphs.length === 0
              ? html`<p>${backstory}</p>`
              : paragraphs.map((p) => html`<p>${p}</p>`)}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Phase 3b polish (2026-05-23): turn a stored answer value into
   * something a DM (or player at review time) can actually read.
   * MC values are internal tokens — "last-72h" / "none" — so look
   * up the option's `label`.  Short-answers display verbatim.
   * Returns null when the answer is unset (caller renders "(not
   * answered)" in muted style).
   */
  private formatAnswerForDisplay(
    q: CampaignCharCreationQuestion,
    raw: string
  ): string | null {
    if (raw === '') return null;
    if (q.kind === 'mc') {
      const opt = (q.options ?? []).find((o) => o.value === raw);
      // Fall back to the raw value if the option isn't declared
      // anymore (e.g. campaign-side delete after the answer was
      // stored).  Better to show the truth than mask it.
      return opt?.label ?? raw;
    }
    return raw;
  }

  private handleRevise(slot: number): void {
    if (!this.onRevise) return;
    this.reviseDialogSlot = slot;
    this.reviseReason = '';
    this.pinnedQuestionIds = new Set<string>();
  }

  private closeReviseDialog(): void {
    this.reviseDialogSlot = null;
    this.reviseReason = '';
    this.pinnedQuestionIds = new Set<string>();
  }

  private commitRevise(): void {
    const slot = this.reviseDialogSlot;
    if (slot === null || !this.onRevise) return;
    const pinned = [...this.pinnedQuestionIds];
    this.onRevise(slot, this.reviseReason, pinned);
    this.closeReviseDialog();
  }

  private toggleReviseQuestionPin(qid: string): void {
    const next = new Set(this.pinnedQuestionIds);
    if (next.has(qid)) {
      next.delete(qid);
    } else {
      next.add(qid);
    }
    this.pinnedQuestionIds = next;
  }

  private async handleGenerate(slot: number): Promise<void> {
    if (!this.onGenerate) return;
    this.generatingFor.add(slot);
    this.requestUpdate();
    try {
      const url = await this.onGenerate(slot);
      if (url !== null) {
        this.lastGeneratedUrl.set(slot, url);
      }
    } finally {
      this.generatingFor.delete(slot);
      this.requestUpdate();
    }
  }

  private async handleSynthesize(slot: number): Promise<void> {
    if (!this.onSynthesize) return;
    // The controller manages synthInFlight + synthResults; we just
    // kick off the call and let the host's @property push the result
    // back through.  No local state to track.
    await this.onSynthesize(slot);
  }

  // ---- Phase 3b polish (2026-05-22): pack import + quick-gen ----

  private async handleFilePick(slot: number, e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Clear the input value so re-picking the same file fires
    // another change event.
    input.value = '';
    if (!file) return;
    await this.readAndImportFile(slot, file);
  }

  private handleDragOver(slot: number, e: DragEvent): void {
    // preventDefault on dragover is required to allow a drop.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    if (this.dragOverSeat !== slot) this.dragOverSeat = slot;
  }

  private handleDragEnter(slot: number, e: DragEvent): void {
    e.preventDefault();
    this.dragOverSeat = slot;
  }

  private handleDragLeave(slot: number, _e: DragEvent): void {
    // dragleave fires when crossing child boundaries inside the
    // drop zone — only clear if we're actually leaving the seat.
    // The simplest heuristic: clear unconditionally; a subsequent
    // dragover on the seat sets it back.  The visible flicker is
    // a few ms and negligible.
    if (this.dragOverSeat === slot) this.dragOverSeat = null;
  }

  private async handleDrop(slot: number, e: DragEvent): Promise<void> {
    e.preventDefault();
    this.dragOverSeat = null;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    await this.readAndImportFile(slot, file);
  }

  private async readAndImportFile(slot: number, file: File): Promise<void> {
    if (!this.onImportPack) return;
    let raw: string;
    try {
      raw = await file.text();
    } catch (err) {
      this.setImportStatus(slot, {
        kind: 'err',
        message: `Couldn't read file: ${(err as Error).message}`
      });
      return;
    }
    const result = this.onImportPack(slot, raw);
    if (result.ok) {
      this.setImportStatus(slot, {
        kind: 'ok',
        message: `Loaded pack — saved answers for PC${slot}.  Click "Synthesize backstory" to continue.`
      });
    } else {
      this.setImportStatus(slot, {
        kind: 'err',
        message: result.message
      });
    }
  }

  private setImportStatus(
    slot: number,
    status:
      | { kind: 'ok'; message: string }
      | { kind: 'err'; message: string }
  ): void {
    const next = new Map(this.importStatus);
    next.set(slot, status);
    this.importStatus = next;
    // Auto-clear ok pips after a few seconds so the seat doesn't
    // stay decorated forever.  Errors stay until the next attempt
    // (the DM needs them visible while deciding what to do).
    if (status.kind === 'ok') {
      setTimeout(() => {
        if (this.importStatus.get(slot) === status) {
          const after = new Map(this.importStatus);
          after.delete(slot);
          this.importStatus = after;
        }
      }, 4000);
    }
  }

  private toggleQuickGen(slot: number): void {
    const next = new Set(this.quickGenOpen);
    if (next.has(slot)) next.delete(slot);
    else next.add(slot);
    this.quickGenOpen = next;
  }

  private setQuickGenField(
    slot: number,
    field: 'name' | 'hook',
    value: string
  ): void {
    const map = field === 'name' ? this.quickGenName : this.quickGenHook;
    const next = new Map(map);
    next.set(slot, value);
    if (field === 'name') this.quickGenName = next;
    else this.quickGenHook = next;
  }

  private async handleQuickGenSubmit(slot: number): Promise<void> {
    if (!this.onQuickGenerate) return;
    const name = (this.quickGenName.get(slot) ?? '').trim();
    const hook = (this.quickGenHook.get(slot) ?? '').trim();
    if (!name || !hook) return;
    this.quickGenInFlight.add(slot);
    this.requestUpdate();
    try {
      await this.onQuickGenerate(slot, { name, hook });
      // On success, close the form — the synth result card
      // surfaces in its place.  On failure, leave the form open so
      // the DM can adjust and retry.
      const synth = this.synthResults.get(slot);
      if (synth?.ok) {
        const next = new Set(this.quickGenOpen);
        next.delete(slot);
        this.quickGenOpen = next;
      }
    } finally {
      this.quickGenInFlight.delete(slot);
      this.requestUpdate();
    }
  }

  private async handleCopy(slot: number, url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copiedFor = slot;
      setTimeout(() => {
        if (this.copiedFor === slot) this.copiedFor = null;
      }, 1500);
    } catch {
      // Clipboard refusal (perms, insecure context).  The input is
      // already select-on-focus + visible — the DM can Ctrl-C.
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chargen-dm-review': ChargenDmReview;
  }
}

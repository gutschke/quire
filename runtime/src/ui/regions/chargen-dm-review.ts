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
import type { CampaignCharCreationQuestion } from '../../campaign-loader';
import type { Seat } from '../../core/state';

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
/** P3T-19: DM asks the player to revise. */
export type ReviseCallback = (slot: number, reason: string) => void;
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

  /**
   * Phase 3b polish (2026-05-23): track whether the click that
   * started a drag-select originated on the dialog backdrop or
   * on inner content.  Without this, a user who drags to select
   * text that extends past the dialog frame fires a click on
   * the DIALOG element (mouseup target = dialog), which triggers
   * the backdrop-close handler — the modal auto-closes mid-select.
   * Now: only close when BOTH mousedown AND click happened on
   * the dialog backdrop.
   */
  private backdropMouseDownOnDialog = false;

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
    const hasActive = this.hasBoundActiveSeat();
    return html`
      ${this.renderRemoveUndoBanner()}
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
              Seat cap reached (${SOFT_SEAT_CAP}).  Retire a PC to
              free continuity, or raise the campaign's seat cap.
            </span>`}
        ${hasActive
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
    for (let i = 1; i <= SOFT_SEAT_CAP; i++) {
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
   *   - the seat isn't the in-progress workingSlot (DM is mid-
   *     chargen for it — clicking + would be unexpected)
   *
   * A generated invite URL alone does NOT disqualify removal:
   * the player hasn't redeemed yet, so the seat is recoverable
   * even if the link was sent.
   */
  private isSeatRemovable(slot: number): boolean {
    if (!this.onRemoveSeat) return false;
    const seat = this.pcSlots?.[slot];
    if (!seat || seat.state !== 'unbound') return false;
    if (this.synthResults.has(slot)) return false;
    if (this.synthInFlight.has(slot)) return false;
    if (this.acceptedSlots.has(slot)) return false;
    if (this.quickGenInFlight.has(slot)) return false;
    if (this.workingSlot === slot) return false;
    return true;
  }

  private handleRemoveSeat(slot: number): void {
    if (!this.isSeatRemovable(slot)) return;
    const ok = this.onRemoveSeat!(slot);
    if (!ok) return;
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
      <dialog
        class="chargen-dm-review-edit-modal"
        @cancel=${() => this.closeEditModal()}
        @mousedown=${(e: MouseEvent) => this.recordBackdropMouseDown(e)}
        @click=${(e: MouseEvent) =>
          this.handleDialogBackdropClick(e, () => this.closeEditModal())}
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
      </dialog>
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
      <dialog
        class="chargen-dm-review-modal"
        @cancel=${() => this.closeReviewModal()}
        @mousedown=${(e: MouseEvent) => this.recordBackdropMouseDown(e)}
        @click=${(e: MouseEvent) =>
          this.handleDialogBackdropClick(e, () => this.closeReviewModal())}
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
      </dialog>
    `;
  }

  /**
   * Open the dialog AFTER Lit has rendered the <dialog> element
   * for the active slot.  `showModal()` MUST be called on a real
   * DOM node, which means we wait for updateComplete then locate
   * the element.  Closing follows the same pattern in reverse.
   */
  override updated(changed: Map<string, unknown>): void {
    // Defensive showModal/close — happy-dom doesn't implement
    // either, so wrap so a missing API doesn't fail re-renders.
    // In a real browser these calls are essential (top-layer
    // overlay + focus trap).
    const sync = (
      open: boolean,
      selector: string
    ): void => {
      const dialog = this.querySelector<HTMLDialogElement>(selector);
      if (!dialog) return;
      try {
        if (open && !dialog.open) dialog.showModal?.();
        if (!open && dialog.open) dialog.close?.();
      } catch {
        /* test env without dialog support — DOM stays inspectable */
      }
    };
    if (changed.has('reviewModalSlot')) {
      sync(this.reviewModalSlot !== null, 'dialog.chargen-dm-review-modal');
    }
    if (changed.has('editModalSlot')) {
      sync(
        this.editModalSlot !== null,
        'dialog.chargen-dm-review-edit-modal'
      );
    }
  }

  private closeReviewModal(): void {
    this.reviewModalSlot = null;
  }

  /**
   * Backdrop-click-to-close: native <dialog> doesn't do this for
   * you.  When the user clicks OUTSIDE the dialog's content but
   * still inside its rectangle (the backdrop / overlay area), the
   * click target is the dialog element itself; clicks on inner
   * elements bubble with `e.target` pointing at the child.
   *
   * Drag-select fix (2026-05-23): when a user drags to select text
   * that extends past the dialog frame, mousedown happens on the
   * inner content but mouseup ends on the backdrop — the click
   * event's target is the dialog, so naive close-on-DIALOG-click
   * fires mid-select.  Only close when BOTH mousedown AND click
   * happened on the dialog element.  Reset the flag after every
   * click regardless so the next interaction starts clean.
   */
  private handleDialogBackdropClick(
    e: MouseEvent,
    close: () => void
  ): void {
    const onBackdrop =
      (e.target as HTMLElement).tagName === 'DIALOG' &&
      this.backdropMouseDownOnDialog;
    this.backdropMouseDownOnDialog = false;
    if (onBackdrop) close();
  }

  private recordBackdropMouseDown(e: MouseEvent): void {
    this.backdropMouseDownOnDialog =
      (e.target as HTMLElement).tagName === 'DIALOG';
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
            ✓ <strong>${r.name}</strong>
            <span class="muted">— ${r.pronouns}</span>
          </div>
          ${this.renderTagChips(r.tags)}
          ${this.renderStatGrid(r.stats)}
          ${this.renderSkillChips(r.skillMastery)}
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
  private renderAcceptReviseActions(
    slot: number,
    accepted: boolean
  ): TemplateResult {
    const synth = this.synthResults.get(slot);
    const okResult = synth?.ok === true;
    return html`
      <div class="chargen-dm-review-synth-actions">
        ${okResult
          ? html`<button
              type="button"
              class="chargen-dm-review-accept"
              ?disabled=${accepted || !this.onAccept}
              title="Accept this synthesized PC; appends an audit note"
              @click=${() => this.onAccept?.(slot)}
            >
              ${accepted ? 'Accepted' : 'Accept this PC'}
            </button>`
          : nothing}
        ${synth
          ? html`<button
              type="button"
              class="chargen-dm-review-revise"
              ?disabled=${!this.onRevise}
              title="Ask the player to revise an answer + clear this result"
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

  /** Tags chips — 3-5 free-text expertise items from the response. */
  private renderTagChips(tags: readonly string[]): TemplateResult {
    return html`
      <div
        class="chargen-dm-review-chips chargen-dm-review-tags"
        aria-label="Tags"
      >
        ${tags.map(
          (t) => html`<span class="chargen-dm-review-chip">${t}</span>`
        )}
      </div>
    `;
  }

  /** Stats grid — 6 quire-v0.1 stats laid out as label + signed modifier. */
  private renderStatGrid(stats: {
    STR: number;
    DEX: number;
    CON: number;
    INT: number;
    WIS: number;
    CHA: number;
  }): TemplateResult {
    const fmt = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
    const cell = (
      label: string,
      key: keyof typeof stats
    ): TemplateResult => html`
      <div class="chargen-dm-review-stat-cell">
        <span class="chargen-dm-review-stat-label">${label}</span>
        <span class="chargen-dm-review-stat-mod">${fmt(stats[key])}</span>
      </div>
    `;
    return html`
      <div class="chargen-dm-review-stat-grid" aria-label="Starting stats">
        ${cell('STR', 'STR')}${cell('DEX', 'DEX')}${cell('CON', 'CON')}
        ${cell('INT', 'INT')}${cell('WIS', 'WIS')}${cell('CHA', 'CHA')}
      </div>
    `;
  }

  /** Skill mastery chips — 2-3 quire-v0.1 categories. */
  private renderSkillChips(skills: readonly string[]): TemplateResult {
    return html`
      <div
        class="chargen-dm-review-chips chargen-dm-review-skills"
        aria-label="Skill mastery"
      >
        ${skills.map(
          (s) =>
            html`<span class="chargen-dm-review-chip chargen-dm-review-chip-skill"
              >${s}</span
            >`
        )}
      </div>
    `;
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
    const reason =
      window.prompt(
        `Ask player at PC${slot} to revise — note for the audit log (optional):`
      ) ?? '';
    this.onRevise(slot, reason);
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

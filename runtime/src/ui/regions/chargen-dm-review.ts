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

/** All possible seat slots (matches invite-token range). */
const ALL_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

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
  @property({ attribute: false }) pcSlots: Record<number, string> = {};

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
   * Per-seat last-generated link (transient — cleared when the DM
   * picks a different slot to generate for OR the page reloads).
   * Local to the region because re-generating after the DM has
   * already copied is the common case.
   */
  @state() private lastGeneratedUrl: Map<number, string> = new Map();
  @state() private generatingFor: Set<number> = new Set();
  @state() private copiedFor: number | null = null;

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
        <ol class="chargen-dm-review-seats">
          ${ALL_SLOTS.map((slot) => this.renderSeat(slot))}
        </ol>
      </section>
      ${this.renderReviewDialog()}
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
        @click=${(e: MouseEvent) => this.handleDialogBackdropClick(e)}
      >
        <header class="chargen-dm-review-modal-head">
          <h3 class="chargen-dm-review-modal-title">
            Review PC${slot}
            ${' '}— <strong>${r.name}</strong>
            <span class="muted">(${r.pronouns})</span>
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
    if (changed.has('reviewModalSlot')) {
      const dialog = this.querySelector<HTMLDialogElement>(
        'dialog.chargen-dm-review-modal'
      );
      // Defensive: happy-dom (test env) may not implement
      // showModal/close.  Wrap so a missing API doesn't fail
      // re-renders.  In a real browser these calls are essential
      // — they invoke the top-layer overlay + focus trap.
      try {
        if (this.reviewModalSlot !== null && dialog && !dialog.open) {
          dialog.showModal?.();
        }
        if (this.reviewModalSlot === null && dialog && dialog.open) {
          dialog.close?.();
        }
      } catch {
        /* test env without dialog support — DOM is still
           inspectable for assertions */
      }
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
   */
  private handleDialogBackdropClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).tagName === 'DIALOG') {
      this.closeReviewModal();
    }
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
    const boundPcId = this.pcSlots?.[slot];
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
    return html`
      <div
        class="chargen-dm-review-synth ${isSpoiler
          ? 'chargen-dm-review-synth-spoiler'
          : 'chargen-dm-review-synth-err'}"
      >
        <div class="chargen-dm-review-synth-label">
          ${isSpoiler ? '⚠ Spoiler leak persisted' : '✗ Synthesis failed'}
        </div>
        <div class="chargen-dm-review-synth-message">${synth.message}</div>
        ${this.renderAcceptReviseActions(slot, false)}
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
    // Four anchor questions worth diffing.  Order matches the
    // campaign questionnaire flow for DM scanning ergonomics.
    const anchors: Array<{ id: string; label: string }> = [
      { id: 'flight-reason', label: 'Why on Flight 887?' },
      { id: 'prior-connection', label: 'Prior connection' },
      { id: 'meaningful-item', label: 'Meaningful item' },
      { id: 'intent-moment', label: 'Intent-moment' }
    ];
    const phrases = this.extractAnchorPhrases(answers, anchors);
    return html`
      <div class="chargen-dm-review-diff" role="group" aria-label="Backstory review">
        <div class="chargen-dm-review-diff-answers">
          <h4>Player's answers</h4>
          ${answers === null
            ? html`<p class="muted">
                No saved answers on this device.  (Player on another
                device, or pre-pack-intake.)
              </p>`
            : html`<dl>
                ${anchors.map((a) => {
                  const v = answers[a.id];
                  if (v === undefined || v === '') {
                    return html`<dt>${a.label}</dt>
                      <dd class="muted">(not answered)</dd>`;
                  }
                  return html`<dt>${a.label}</dt>
                    <dd>${v}</dd>`;
                })}
              </dl>`}
        </div>
        <div class="chargen-dm-review-diff-backstory">
          <h4>AI backstory</h4>
          <div class="chargen-dm-review-backstory-body">
            ${this.renderBackstoryWithHighlights(backstory, phrases)}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Pull a small set of distinguishing noun phrases out of each
   * anchor answer.  v1: take the words longer than 4 characters,
   * lowercased, deduped, capped per-answer.  This is the
   * "highlight the words from the player's answers that appear in
   * the AI's backstory" heuristic.  Doesn't catch paraphrase; the
   * goal is "show the DM the anchors that DID land," not "prove
   * semantic correctness."
   */
  private extractAnchorPhrases(
    answers: Record<string, string> | null,
    anchors: Array<{ id: string; label: string }>
  ): string[] {
    if (!answers) return [];
    const out = new Set<string>();
    for (const a of anchors) {
      const text = answers[a.id];
      if (!text) continue;
      // Take long-enough word tokens; lower-case.
      const tokens = text
        .toLowerCase()
        .split(/[\s.,;:!?()"'—–\-]+/u)
        .filter((w) => w.length >= 5);
      // Cap at the most-distinguishing few per anchor.
      for (const t of tokens.slice(0, 8)) out.add(t);
    }
    return [...out];
  }

  /**
   * Render the backstory body with each occurrence of a highlight
   * phrase wrapped in a `<mark>` tag.  Lit's html interpolation
   * auto-escapes the text content; the marks are static markup
   * inserted around safely-interpolated child nodes.
   */
  private renderBackstoryWithHighlights(
    backstory: string,
    phrases: string[]
  ): TemplateResult {
    if (phrases.length === 0) {
      return html`<p>${backstory}</p>`;
    }
    // Split the backstory into paragraphs (double newline OR single
    // newline run); render each as a separate `<p>` with the
    // highlight pass over its content.
    const paragraphs = backstory.split(/\n\s*\n/).filter((p) => p.trim());
    return html`
      ${paragraphs.map(
        (para) => html`<p>${this.highlightFragments(para, phrases)}</p>`
      )}
    `;
  }

  /**
   * Break a paragraph into alternating plain-text / highlighted
   * fragments based on case-insensitive substring matches.  Returns
   * a TemplateResult array Lit renders as a single text node
   * sequence with `<mark>` for hits.  Auto-escaping is preserved
   * because each fragment goes through interpolation.
   */
  private highlightFragments(
    text: string,
    phrases: readonly string[]
  ): TemplateResult[] {
    if (phrases.length === 0) return [html`${text}`];
    // Lowercase the text for searching; track the original casing.
    const lower = text.toLowerCase();
    // Collect all match ranges, then merge overlapping.
    const ranges: Array<[number, number]> = [];
    for (const p of phrases) {
      let from = 0;
      while (from < lower.length) {
        const idx = lower.indexOf(p, from);
        if (idx === -1) break;
        ranges.push([idx, idx + p.length]);
        from = idx + p.length;
      }
    }
    if (ranges.length === 0) return [html`${text}`];
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const [s, e] of ranges) {
      const last = merged[merged.length - 1];
      if (last && s <= last[1]) {
        last[1] = Math.max(last[1], e);
      } else {
        merged.push([s, e]);
      }
    }
    const fragments: TemplateResult[] = [];
    let pos = 0;
    for (const [s, e] of merged) {
      if (s > pos) fragments.push(html`${text.slice(pos, s)}`);
      fragments.push(html`<mark class="chargen-dm-review-mark">${text.slice(s, e)}</mark>`);
      pos = e;
    }
    if (pos < text.length) fragments.push(html`${text.slice(pos)}`);
    return fragments;
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

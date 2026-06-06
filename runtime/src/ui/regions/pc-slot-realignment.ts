// @vitest-environment happy-dom

/**
 * <pc-slot-realignment> — DM-only between-sessions surface for
 * **slot renumbering**.  The campaign script addresses each PC by
 * slot label (`{{pc:1}}`, `{{pc:3}}`, …).  After session 1 the DM
 * can renumber so the right (player + PC) pair carries each script
 * label.
 *
 * **Pairs are atomic.**  Markus keeps playing Marcus Vance.  What
 * moves is the slot LABEL that addresses them — never the
 * character a player owns.  The UI renders each pair as a single
 * indivisible chip; the user only ever sees the slot index change.
 *
 * Apply is ATOMIC: a partial accept of a permutation breaks the
 * bijection, so this surface offers exactly one "Apply this
 * renumbering" button per proposal.  The DM either accepts the
 * whole permutation or rejects it.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export interface RealignmentRow {
  slot: number;
  /** Display name of the human player (always shown). */
  playerName?: string;
  /** PC character name (always shown when the seat is bound). */
  pcName?: string;
  pcId?: string;
  peerId?: string;
}

export interface RealignmentProposalEntry {
  newSlot: number;
  currentSlot: number;
  pairKey: { pcId: string; peerId: string };
  /** PC name resolved by the host. */
  pcName: string;
  /** Player display name resolved by the host. */
  playerName: string;
  slotFingerprintMatched: string;
  rationale: string;
}

export type AskAiCallback = (
  dmGuidance: string
) => Promise<{ ok: true; reasoning: string } | { ok: false; message: string }>;

export type ApplyPermutationCallback = (
  entries: ReadonlyArray<RealignmentProposalEntry>
) => void;

@customElement('pc-slot-realignment')
export class PcSlotRealignment extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) bindings: RealignmentRow[] = [];
  @property({ attribute: false }) permutation: RealignmentProposalEntry[] = [];
  @property() reasoning: string = '';
  @property({ type: Boolean }) busy: boolean = false;
  @property() error: string = '';
  @property({ type: Boolean }) noChangeNeeded: boolean = false;

  @property({ attribute: false }) onAskAi: AskAiCallback | null = null;
  @property({ attribute: false }) onApplyPermutation:
    | ApplyPermutationCallback
    | null = null;

  @state() private dmGuidanceDraft: string = '';
  @state() private confirmOpen: boolean = false;

  override render(): TemplateResult {
    return html`
      <section class="card pc-slot-realignment">
        <header class="pc-slot-realignment-head">
          <h2>Renumber slots so the script points at the right pair</h2>
          <p class="muted">
            Your players keep the characters they wrote.  This only changes
            which slot number (<code>{{pc:1}}</code>, <code>{{pc:2}}</code>,
            …) the script uses to address each player ↔ character pair.
            Nothing on a character sheet moves.
          </p>
        </header>
        ${this.renderCurrent()}
        ${this.renderAskAi()}
        ${this.renderProposal()}
        ${this.confirmOpen ? this.renderConfirm() : nothing}
      </section>
    `;
  }

  private renderCurrent(): TemplateResult {
    if (this.bindings.length === 0) {
      return html`<p class="muted">
        No bound pairs yet — start a session and bind players to slots first.
      </p>`;
    }
    return html`
      <section class="pc-slot-realignment-current">
        <h3>Current bindings</h3>
        <ul class="pc-slot-realignment-rows">
          ${this.bindings.map(
            (r) => html`
              <li class="pc-slot-realignment-row">
                <span class="pc-slot-realignment-slot">slot ${r.slot}</span>
                <span class="muted"> · </span>
                <span class="pc-slot-realignment-pair-chip"
                  >${r.playerName ?? html`<em>unbound</em>`}
                  ${r.playerName && r.pcName
                    ? html`<span class="muted"> + </span>`
                    : nothing}
                  ${r.pcName
                    ? html`<strong>${r.pcName}</strong>`
                    : nothing}</span
                >
              </li>
            `
          )}
        </ul>
      </section>
    `;
  }

  private renderAskAi(): TemplateResult {
    return html`
      <section class="pc-slot-realignment-ai">
        <label class="pc-slot-realignment-guidance-label">
          Optional nudge for the AI:
          <input
            type="text"
            class="pc-slot-realignment-guidance"
            placeholder="e.g. the hacker scene 1.3 felt off for Markus"
            .value=${this.dmGuidanceDraft}
            @input=${(e: Event) =>
              (this.dmGuidanceDraft = (e.target as HTMLInputElement).value)}
            ?disabled=${this.busy}
          />
        </label>
        <button
          type="button"
          class="pc-slot-realignment-ask"
          ?disabled=${this.busy || !this.onAskAi}
          @click=${() => this.onAskAi?.(this.dmGuidanceDraft)}
        >
          ${this.busy ? 'Asking AI…' : 'Ask AI to suggest a slot renumbering'}
        </button>
        ${this.error
          ? html`<p class="pc-slot-realignment-error" role="alert">
              ${this.error}
            </p>`
          : nothing}
      </section>
    `;
  }

  private renderProposal(): TemplateResult {
    if (this.noChangeNeeded) {
      return html`
        <section class="pc-slot-realignment-no-change">
          <h3>AI: no change recommended</h3>
          ${this.reasoning
            ? html`<p class="muted">${this.reasoning}</p>`
            : nothing}
        </section>
      `;
    }
    if (this.permutation.length === 0) return html``;
    return html`
      <section class="pc-slot-realignment-proposal">
        <h3>Proposed renumbering</h3>
        ${this.reasoning
          ? html`<p class="pc-slot-realignment-reasoning muted">
              ${this.reasoning}
            </p>`
          : nothing}
        <ul class="pc-slot-realignment-proposal-list">
          ${this.permutation.map(
            (p) => html`
              <li class="pc-slot-realignment-proposal-row">
                <div class="pc-slot-realignment-pair-move">
                  <span class="pc-slot-realignment-slot"
                    >slot ${p.currentSlot}</span
                  >
                  <span class="muted"> → </span>
                  <span class="pc-slot-realignment-slot pc-slot-realignment-slot-new"
                    >slot ${p.newSlot}</span
                  >
                  <span class="muted"> · </span>
                  <span class="pc-slot-realignment-pair-chip"
                    >${p.playerName}
                    <span class="muted"> + </span>
                    <strong>${p.pcName}</strong></span
                  >
                </div>
                ${p.slotFingerprintMatched
                  ? html`<p class="pc-slot-realignment-fingerprint muted">
                      matched: ${p.slotFingerprintMatched}
                    </p>`
                  : nothing}
                <p class="pc-slot-realignment-rationale">${p.rationale}</p>
              </li>
            `
          )}
        </ul>
        <button
          type="button"
          class="pc-slot-realignment-apply"
          ?disabled=${!this.onApplyPermutation || this.busy}
          @click=${() => (this.confirmOpen = true)}
        >
          Apply this renumbering
        </button>
      </section>
    `;
  }

  private renderConfirm(): TemplateResult {
    const n = this.permutation.length;
    return html`
      <div class="pc-slot-realignment-confirm" role="dialog">
        <p>
          Renumber <strong>${n}</strong> slot label${n === 1 ? '' : 's'}.
          Every player keeps the character they're playing.  No character
          sheets, harm/stress, foci, or bonds are touched.  The change is
          logged.
        </p>
        <div class="pc-slot-realignment-confirm-actions">
          <button
            type="button"
            class="pc-slot-realignment-confirm-cancel"
            @click=${() => (this.confirmOpen = false)}
          >
            Cancel
          </button>
          <button
            type="button"
            class="pc-slot-realignment-confirm-apply"
            @click=${() => {
              this.onApplyPermutation?.(this.permutation);
              this.confirmOpen = false;
            }}
          >
            Yes, renumber ${n} slot${n === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pc-slot-realignment': PcSlotRealignment;
  }
}

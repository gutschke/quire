// @vitest-environment happy-dom

/**
 * <backstory-refresh-inbox> — player-side inbox card for the UX-MH-3
 * DM-initiated backstory-refresh-proposal.
 *
 * Per R-F (run #19 synthesis): a DM-initiated refresh routes to the
 * player as an INBOX CARD on their chargen surface (NOT a modal —
 * modal violates player-owns-voice).  The card shows the unified
 * diff + Accept / Reject / Try again actions.  Per silent-player-
 * firewall, NO indication is shown if the AI's refresh refused
 * (the DM sees that warning; the player sees only successful
 * proposals).
 *
 * Copy strings per TTRPG/UX expert memo §3 (verbatim where they
 * apply).  The card is hidden when no proposal is pending.
 *
 * Baseline-hash staleness guard: when the proposal's `baselineHash`
 * differs from sha256(current backstory), surface a "made against
 * an older version" warning with [View anyway] / [Discard] before
 * the Accept gate.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './inline-diff';

/** A pending backstory-refresh proposal (player-projection shape). */
export interface PendingBackstoryRefreshProposal {
  pcId: string;
  proposedBackstory: string;
  baselineHash: string;
  initiator: 'player' | 'dm';
  ts: number;
}

@customElement('backstory-refresh-inbox')
export class BackstoryRefreshInbox extends LitElement {
  createRenderRoot(): this {
    return this;
  }

  /** The pending proposal, or null when none. */
  @property({ attribute: false })
  proposal: PendingBackstoryRefreshProposal | null = null;

  /** The PC's CURRENT backstory (for diff + staleness check). */
  @property({ attribute: false }) currentBackstory = '';
  /** Hash of the CURRENT backstory.  If !== proposal.baselineHash, stale. */
  @property({ attribute: false }) currentBackstoryHash = '';
  /** PC's display name for the card header. */
  @property({ attribute: false }) pcDisplayName = '';
  /**
   * Optional short description of what the DM changed (e.g.
   * "pronouns updated").  THE HOST SYNTHESIZES THIS FROM
   * PLAYER-VISIBLE FIELDS ONLY.  The proposal's DM-only
   * `triggerSummary` field is stripped at the persistence boundary
   * + filterForViewer; this prop is the player-safe synthesis.
   */
  @property({ attribute: false }) playerSafeChangeSummary = '';

  /** Called when the player accepts (commits pc-edit with proposedBackstory). */
  @property({ attribute: false }) onAccept?: () => void;
  /** Called when the player rejects (clears the local proposal slot). */
  @property({ attribute: false }) onReject?: () => void;
  /** Called when the player clicks "Try again" with an optional hint. */
  @property({ attribute: false }) onTryAgain?: (hint?: string) => void;

  render(): TemplateResult | typeof nothing {
    if (!this.proposal) return nothing;
    const stale =
      this.currentBackstoryHash.length > 0 &&
      this.proposal.baselineHash !== this.currentBackstoryHash;
    return html`
      <section
        class="backstory-refresh-inbox-card"
        role="region"
        aria-label="Backstory suggestion"
      >
        <header class="backstory-refresh-inbox-header">
          <h3>${this.headerCopy()}</h3>
          ${this.playerSafeChangeSummary
            ? html`<p class="backstory-refresh-inbox-body">
                ${this.bodyCopy()}
              </p>`
            : nothing}
        </header>
        ${stale ? this.renderStalenessWarning() : nothing}
        <inline-diff
          .baseline=${this.currentBackstory}
          .proposed=${this.proposal.proposedBackstory}
        ></inline-diff>
        <div class="backstory-refresh-inbox-actions">
          <button
            type="button"
            class="backstory-refresh-inbox-accept"
            @click=${() => this.onAccept?.()}
          >
            Accept changes
          </button>
          <button
            type="button"
            class="backstory-refresh-inbox-reject"
            @click=${() => this.onReject?.()}
          >
            Reject
          </button>
          <button
            type="button"
            class="backstory-refresh-inbox-try-again"
            @click=${this.handleTryAgain}
          >
            Try again…
          </button>
        </div>
      </section>
    `;
  }

  private headerCopy(): string {
    if (!this.proposal) return '';
    if (this.proposal.initiator === 'dm') {
      return 'Your DM has a backstory suggestion';
    }
    return 'Backstory refresh ready';
  }

  private bodyCopy(): string {
    if (!this.proposal) return '';
    if (this.proposal.initiator === 'dm') {
      // R-F copy string #6 (TTRPG/UX expert memo §3, item 6).
      return `Your DM updated ${this.playerSafeChangeSummary} for ${this.pcDisplayName} and asks if you'd like the backstory threaded through to match.`;
    }
    return `${this.playerSafeChangeSummary} for ${this.pcDisplayName}.`;
  }

  private renderStalenessWarning(): TemplateResult {
    return html`<p
      class="backstory-refresh-inbox-stale"
      role="alert"
    >
      This suggestion was made against an older version of your backstory.
    </p>`;
  }

  private handleTryAgain = (): void => {
    // The TTRPG/UX expert memo proposed a small inline prompt input.
    // For MVP we use a window.prompt — easy + accessible.  A richer
    // input is a future polish.
    const hint = window.prompt(
      'Anything to add? e.g. keep the bookstore reference'
    );
    if (hint === null) return; // cancelled
    this.onTryAgain?.(hint.trim() === '' ? undefined : hint.trim());
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'backstory-refresh-inbox': BackstoryRefreshInbox;
  }
}

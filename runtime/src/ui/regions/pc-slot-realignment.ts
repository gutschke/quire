// @vitest-environment happy-dom

/**
 * <pc-slot-realignment> — DM-only between-sessions surface for
 * shuffling which player plays which PC after chargen misalignment
 * becomes visible in play.
 *
 * Flow (playable v1):
 *   1. The DM lands here and sees the current bindings as a table:
 *      "Slot N · player Markus · PC Marcus Vance".
 *   2. Optionally types a one-line nudge ("Markus seems frustrated
 *      with the medic build") in the DM-guidance box.
 *   3. Clicks "Ask AI to propose alignment" → host calls the AI.
 *   4. The AI returns either "noChangeNeeded" or a list of per-slot
 *      proposed swaps with rationale.
 *   5. The DM reviews each proposal and clicks "Apply this swap" to
 *      emit a single pc-slot-bind event; or "Apply all" to apply
 *      every proposal.  Manual rejects = just don't click apply.
 *
 * Per `feedback_show_both_names`: every row shows BOTH the PC name
 * and the human player name.
 *
 * This is intentionally a thin region — the AI call lives on the
 * host, and the engine glue is the existing `bindPcSlot(slot, pcId)`
 * method.  The materializer preserves controllerPeerId, so a swap
 * only moves the PC; the human stays in their slot.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { SlotRealignmentProposal } from '../../ai/slot-realignment-prompt';

export interface SlotRealignmentRow {
  slot: number;
  /** Human display name of the bound peer (or undefined when unbound). */
  playerName?: string;
  /** PC character name in this slot (or undefined when empty). */
  pcName?: string;
  pcId?: string;
}

export interface SlotRealignmentProposalDisplay extends SlotRealignmentProposal {
  /** Resolved PC name for `currentPcId`. */
  currentPcName: string;
  /** Resolved PC name for `proposedPcId`. */
  proposedPcName: string;
  /** Resolved player display name on the current slot. */
  playerName?: string;
}

export type AskAiCallback = (
  dmGuidance: string
) => Promise<{ ok: true; reasoning: string } | { ok: false; message: string }>;

export type ApplySwapCallback = (proposal: SlotRealignmentProposal) => void;

@customElement('pc-slot-realignment')
export class PcSlotRealignment extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) bindings: SlotRealignmentRow[] = [];

  /**
   * Proposals delivered by the host after a successful AI call.
   * Empty array = no AI call has happened yet (or the AI said
   * "noChangeNeeded").  The host owns the call lifecycle.
   */
  @property({ attribute: false })
  proposals: SlotRealignmentProposalDisplay[] = [];

  /** AI reasoning text (one line + few sentences). */
  @property() reasoning: string = '';

  /** True while an AI call is in flight. */
  @property({ type: Boolean }) busy: boolean = false;

  /** Set by host to a friendly error after a failed AI call. */
  @property() error: string = '';

  /** Set by host when AI explicitly returned `noChangeNeeded`. */
  @property({ type: Boolean }) noChangeNeeded: boolean = false;

  /**
   * Host callback: receives the DM guidance string and runs the
   * AI call.  Resolves with {ok, reasoning} or {ok:false, message}.
   * Region just calls this; host owns the broker dispatch + sets
   * the `proposals` property when the call completes.
   */
  @property({ attribute: false }) onAskAi: AskAiCallback | null = null;

  /** Host callback: apply a single proposal (emits one event). */
  @property({ attribute: false }) onApplySwap: ApplySwapCallback | null = null;

  /** Host callback: apply every proposal (emits N events). */
  @property({ attribute: false }) onApplyAll:
    | ((proposals: SlotRealignmentProposal[]) => void)
    | null = null;

  @state() private dmGuidanceDraft: string = '';

  override render(): TemplateResult {
    return html`
      <section class="card pc-slot-realignment">
        <header class="pc-slot-realignment-head">
          <h2>Realign player ↔ character slots</h2>
          <p class="muted">
            After session 1 it sometimes turns out a player would fit a
            different PC better.  Ask the AI for a read on the table; review
            and accept each proposed swap (or none).  The peer bound to each
            slot stays — only the character moves.
          </p>
        </header>
        ${this.renderCurrentBindings()}
        ${this.renderAskAi()}
        ${this.renderProposals()}
      </section>
    `;
  }

  private renderCurrentBindings(): TemplateResult {
    if (this.bindings.length === 0) {
      return html`<p class="muted">
        No bindings yet — start a session and bind players to slots first.
      </p>`;
    }
    return html`
      <section class="pc-slot-realignment-current">
        <h3>Current bindings</h3>
        <ul class="pc-slot-realignment-rows">
          ${this.bindings.map(
            (r) => html`
              <li class="pc-slot-realignment-row">
                <span class="pc-slot-realignment-slot">Slot ${r.slot}</span>
                <span class="pc-slot-realignment-player"
                  >${r.playerName ?? html`<em>unbound</em>`}</span
                >
                <span class="muted"> · plays </span>
                <strong>${r.pcName ?? html`<em>(empty)</em>`}</strong>
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
            placeholder="e.g. Markus seems frustrated with the medic build"
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
          ${this.busy ? 'Asking AI…' : 'Ask AI to propose alignment'}
        </button>
        ${this.error
          ? html`<p class="pc-slot-realignment-error" role="alert">
              ${this.error}
            </p>`
          : nothing}
      </section>
    `;
  }

  private renderProposals(): TemplateResult {
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
    if (this.proposals.length === 0) return html``;
    return html`
      <section class="pc-slot-realignment-proposals">
        <h3>Proposed swaps</h3>
        ${this.reasoning
          ? html`<p class="pc-slot-realignment-reasoning muted">
              ${this.reasoning}
            </p>`
          : nothing}
        <ul class="pc-slot-realignment-proposal-list">
          ${this.proposals.map(
            (p) => html`
              <li class="pc-slot-realignment-proposal">
                <div class="pc-slot-realignment-proposal-head">
                  <span class="pc-slot-realignment-slot">Slot ${p.slot}</span>
                  ${p.playerName
                    ? html`<span class="pc-slot-realignment-player"
                        >· ${p.playerName}</span
                      >`
                    : nothing}
                  <span class="muted"> ·</span>
                  <s class="pc-slot-realignment-current-pc"
                    >${p.currentPcName}</s
                  >
                  <span class="muted"> → </span>
                  <strong class="pc-slot-realignment-proposed-pc"
                    >${p.proposedPcName}</strong
                  >
                </div>
                <p class="pc-slot-realignment-rationale">${p.rationale}</p>
                <button
                  type="button"
                  class="pc-slot-realignment-apply"
                  ?disabled=${!this.onApplySwap || this.busy}
                  @click=${() => this.onApplySwap?.(p)}
                >
                  Apply this swap
                </button>
              </li>
            `
          )}
        </ul>
        ${this.proposals.length > 1
          ? html`<button
              type="button"
              class="pc-slot-realignment-apply-all"
              ?disabled=${!this.onApplyAll || this.busy}
              @click=${() => this.onApplyAll?.(this.proposals)}
            >
              Apply all ${this.proposals.length} swaps
            </button>`
          : nothing}
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pc-slot-realignment': PcSlotRealignment;
  }
}

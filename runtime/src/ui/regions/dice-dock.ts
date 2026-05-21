/**
 * <dice-dock> — dice roller region (M2.6 — P1-4).
 *
 * Extracted from `QuireApp.renderRollPanel` during M2.6.  Renders
 * the roll input form + recent-roll history + error display.
 *
 * Per the design spec (ui.md), the Dock will eventually hold:
 *   - 6 stat chips (one-click pre-fill)
 *   - modifier stepper
 *   - last-3 pills
 *   - DM-only verbs (Reveal, Broadcast, scratch column)
 *
 * M2.6 keeps the existing single-input form unchanged so the visual
 * is identical to pre-extraction.  Future polish passes will add
 * stat chips + chip-driven pre-fill (M3a / M3b cockpit work).
 *
 * Light-DOM rendering: createRenderRoot returns this.  Legacy
 * .roll-form / .roll-history / .roll-error / .muted CSS continues
 * to apply via the QuireApp shadow cascade.
 *
 * Handlers stay on root: the component receives pre-computed
 * history entries (so it doesn't need access to displayNameFor or
 * the sessionView), rollDraft + rollError @state values, and
 * callback props for input changes + submit.  QuireApp's submitRoll
 * method stays on the root per the facade pattern.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export interface DiceHistoryEntry {
  key: string;
  label: string;
  /** CSS class like "roll-tier-hit" / "roll-tier-miss" for local rolls. */
  tierClass: string;
}

@customElement('dice-dock')
export class DiceDock extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property() rollDraft: string = '';
  @property() rollError: string | null = null;
  @property({ attribute: false }) entries: DiceHistoryEntry[] = [];
  @property({ attribute: false }) onRollDraftChange:
    | ((value: string) => void)
    | null = null;
  @property({ attribute: false }) onSubmitRoll:
    | ((value: string) => void)
    | null = null;
  /**
   * M2.8 (P1-7): raise-hand affordance for the local player.  When
   * `handAvailable` is true (active session, local peer is a player
   * — not the DM), the dock renders a "Raise hand" / "Lower hand"
   * toggle.  `handRaised` reflects the local peer's current state.
   * `onToggleHand` invokes SessionController.toggleHand via the
   * QuireApp wrapper.
   */
  @property({ type: Boolean }) handAvailable: boolean = false;
  @property({ type: Boolean }) handRaised: boolean = false;
  @property({ attribute: false }) onToggleHand:
    | (() => void)
    | null = null;

  override render(): TemplateResult {
    return html`
      <section class="card">
        <h2>Dice</h2>
        <form
          class="roll-form"
          @submit=${(e: Event) => {
            e.preventDefault();
            this.onSubmitRoll?.(this.rollDraft);
          }}
        >
          <label>
            <span class="roll-label">/roll</span>
            <input
              type="text"
              .value=${this.rollDraft}
              placeholder="2d6+1"
              aria-label="Dice expression"
              @input=${(e: Event) =>
                this.onRollDraftChange?.(
                  (e.target as HTMLInputElement).value
                )}
            />
          </label>
          <button type="submit">Roll</button>
          ${this.handAvailable
            ? html`<button
                type="button"
                class="raise-hand ${this.handRaised
                  ? 'raise-hand-active'
                  : ''}"
                aria-label=${this.handRaised
                  ? 'Lower hand'
                  : 'Raise hand'}
                title=${this.handRaised
                  ? 'Lower hand'
                  : 'Raise hand'}
                @click=${() => this.onToggleHand?.()}
              >
                ✋ ${this.handRaised ? 'Lower' : 'Raise'}
              </button>`
            : nothing}
        </form>
        ${this.rollError
          ? html`<p class="roll-error">${this.rollError}</p>`
          : nothing}
        ${this.entries.length
          ? html`
              <ul class="roll-history">
                ${this.entries.map(
                  (e) =>
                    html`<li>
                      <code class="${e.tierClass}">${e.label}</code>
                    </li>`
                )}
              </ul>
            `
          : html`<p class="muted">No rolls yet.</p>`}
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dice-dock': DiceDock;
  }
}

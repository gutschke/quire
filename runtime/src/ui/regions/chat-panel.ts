/**
 * <chat-panel> — session chat region (M2.7 — P1-6).
 *
 * Extracted from `QuireApp.renderChatPanel` during M2.7.  Renders
 * the message list + send form + error display.
 *
 * Per the design spec, chat lives inside the Aside region and is
 * collapsible (default collapsed in-person, expanded for hybrid /
 * remote play).  M2.7 ships the panel itself; the collapse toggle
 * lands in a polish pass alongside the AI-console + pinned-NPCs
 * stacking in the DM Aside (M3a/M3b).
 *
 * Light-DOM rendering: createRenderRoot returns this.  Legacy CSS
 * (.chat-panel, .chat-list, .chat-author, .chat-text, .chat-form,
 * .chat-error, .muted) continues to apply via the QuireApp shadow
 * cascade.
 *
 * Pre-formatted entries: the component receives ChatEntry items
 * (author name + text) so it doesn't need access to displayNameFor
 * or the sessionView.peers map.  This is the same shape as
 * dice-dock — region components stay data-only, callers do the
 * peerId → display-name resolution.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export interface ChatEntry {
  key: string;
  author: string;
  text: string;
}

@customElement('chat-panel')
export class ChatPanel extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /**
   * When false (no active session), the panel renders nothing —
   * matches pre-extraction behavior.
   */
  @property({ type: Boolean }) active: boolean = false;
  @property() chatDraft: string = '';
  @property() chatError: string | null = null;
  @property({ attribute: false }) entries: ChatEntry[] = [];
  @property({ attribute: false }) onDraftChange:
    | ((value: string) => void)
    | null = null;
  @property({ attribute: false }) onSubmit:
    | ((value: string) => void)
    | null = null;

  override render(): TemplateResult {
    if (!this.active) return html``;
    return html`
      <section class="card chat-panel">
        <h2>Chat</h2>
        ${this.entries.length === 0
          ? html`<p class="muted">No messages yet. Say hello.</p>`
          : html`
              <ul class="chat-list">
                ${this.entries.map(
                  (m) => html`
                    <li>
                      <span class="chat-author">${m.author}</span>
                      <span class="chat-text">${m.text}</span>
                    </li>
                  `
                )}
              </ul>
            `}
        <form
          class="chat-form"
          @submit=${(e: Event) => {
            e.preventDefault();
            this.onSubmit?.(this.chatDraft);
          }}
        >
          <input
            type="text"
            .value=${this.chatDraft}
            placeholder="Say something…"
            aria-label="Chat message"
            maxlength="500"
            @input=${(e: Event) =>
              this.onDraftChange?.((e.target as HTMLInputElement).value)}
          />
          <button type="submit">Send</button>
        </form>
        ${this.chatError
          ? html`<p class="chat-error">${this.chatError}</p>`
          : nothing}
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chat-panel': ChatPanel;
  }
}

/**
 * <invite-manager> — DM-side invite-link generator (CC-12).
 *
 * Per the critique pass (B1), this region lives inside the DM
 * cockpit as a sibling of `<seat-strip>` in the DM aside, surfaced
 * only when the local peer is coordinator.
 *
 * Today's scope is the MINIMUM VIABLE generator:
 *   - Slot picker (1-9).
 *   - "Generate invite link" button.
 *   - Copies the resulting URL to clipboard, shows transient
 *     "Copied!" feedback.
 *
 * Deferred (each its own backlog item, all in Phase 2 / M3e):
 *   - Slot ledger (which slots have outstanding invites; CC-12
 *     extension once async-mode play-tests reveal what's useful).
 *   - Paste-incoming-token area for session-1 intake (CC-13).
 *   - "Add slot" affordance (F4 critique disposition — when the
 *     DM wants seat 10+; today bounded to [1, 9] by the token
 *     range).
 *   - Display-name resolution for already-bound slots in the
 *     selector ("Slot 2 — Mei Tanaka (bound)" vs "Slot 2 — open").
 *
 * Light-DOM rendering: `createRenderRoot()` returns `this`.
 * Coord-only enforcement lives at the mount site.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export type GenerateInviteCallback = (slot: number) => Promise<string | null>;

const ALL_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

@customElement('invite-manager')
export class InviteManager extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /**
   * Mapping of slot number to bound character id (matches the
   * shape rendered by `<seat-strip>`).  Slots already bound are
   * still pickable — the DM might want to regenerate a link for
   * a player who lost theirs — but the picker labels show the
   * binding for clarity.
   */
  @property({ attribute: false }) pcSlots: Record<number, string> = {};

  /**
   * Async callback that returns the FULL invite URL (already
   * including the base href + query params).  Caller (QuireApp)
   * constructs the URL using `encodeInviteToken` + `routeToSearch`.
   * Returning `null` indicates a failure the DM should retry; the
   * manager surfaces a "Couldn't generate link — try again?" hint.
   */
  @property({ attribute: false }) onGenerate: GenerateInviteCallback | null =
    null;

  @state() private selectedSlot: number = 1;
  @state() private lastGeneratedSlot: number | null = null;
  @state() private lastGeneratedUrl: string | null = null;
  @state() private feedback: 'idle' | 'copied' | 'copy-failed' | 'gen-failed' =
    'idle';
  @state() private generating: boolean = false;

  override render(): TemplateResult {
    return html`
      <section class="card invite-manager">
        <h2>Invite players</h2>
        <p class="muted invite-manager-explainer">
          Generate a link for each player who'll fill in their PC
          before session 1.  Communicate the archetype hint in the
          email body — it's deliberately NOT in the URL so a
          forwarded link doesn't leak design intent.
        </p>
        <div class="invite-manager-controls">
          <label class="invite-manager-slot-label">
            Slot
            <select
              class="invite-manager-slot-select"
              .value=${String(this.selectedSlot)}
              @change=${(e: Event) => {
                // Read via currentTarget so synthetic events in
                // tests work even when `target` isn't fully wired.
                const sel = e.currentTarget as HTMLSelectElement;
                const next = Number(sel.value);
                if (Number.isInteger(next) && next >= 1 && next <= 9) {
                  this.selectedSlot = next;
                }
                this.feedback = 'idle';
              }}
            >
              ${ALL_SLOTS.map((slot) => {
                const boundId = this.pcSlots?.[slot];
                const label = boundId
                  ? `${slot} — ${boundId} (bound)`
                  : `${slot} — open`;
                return html`<option value=${String(slot)}>${label}</option>`;
              })}
            </select>
          </label>
          <button
            type="button"
            class="invite-manager-generate"
            ?disabled=${this.generating || !this.onGenerate}
            @click=${() => void this.handleGenerate()}
          >
            ${this.generating ? 'Generating…' : 'Generate invite link'}
          </button>
        </div>
        ${this.renderResult()}
      </section>
    `;
  }

  private renderResult(): TemplateResult | typeof nothing {
    if (this.lastGeneratedUrl === null) return nothing;
    const slot = this.lastGeneratedSlot;
    const url = this.lastGeneratedUrl;
    return html`
      <div class="invite-manager-result" role="status" aria-live="polite">
        <div class="invite-manager-result-label">
          Link for slot ${slot}:
        </div>
        <input
          type="text"
          class="invite-manager-result-url"
          readonly
          .value=${url}
          @focus=${(e: Event) =>
            (e.target as HTMLInputElement).select()}
        />
        <div class="invite-manager-result-actions">
          <button
            type="button"
            class="invite-manager-copy"
            @click=${() => void this.handleCopy(url)}
          >
            Copy
          </button>
          <span class="invite-manager-feedback">${this.feedbackText()}</span>
        </div>
      </div>
    `;
  }

  private feedbackText(): string {
    switch (this.feedback) {
      case 'copied':
        return '✓ Copied to clipboard';
      case 'copy-failed':
        return 'Clipboard unavailable — select the URL and copy manually.';
      case 'gen-failed':
        return 'Could not generate link — try again?';
      default:
        return '';
    }
  }

  private async handleGenerate(): Promise<void> {
    if (!this.onGenerate) return;
    this.generating = true;
    this.feedback = 'idle';
    try {
      const url = await this.onGenerate(this.selectedSlot);
      if (url === null) {
        this.feedback = 'gen-failed';
        this.lastGeneratedUrl = null;
        this.lastGeneratedSlot = null;
      } else {
        this.lastGeneratedUrl = url;
        this.lastGeneratedSlot = this.selectedSlot;
      }
    } finally {
      this.generating = false;
    }
  }

  private async handleCopy(url: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        this.feedback = 'copied';
        return;
      }
    } catch {
      /* fall through to copy-failed */
    }
    this.feedback = 'copy-failed';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'invite-manager': InviteManager;
  }
}

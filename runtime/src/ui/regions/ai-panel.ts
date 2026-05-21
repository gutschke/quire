/**
 * <ai-panel> — DM aide region (M3a.5 — P-M3a-ai-panel-region).
 *
 * Extracted from QuireApp.renderAiPanel + renderAiSettings +
 * renderAiPromptForm (174 LOC together).  Renders the DM-aide
 * card: provider/key/model/system-prompt settings (when no key
 * stored OR when settings expanded), the prompt textarea, the
 * loading/error/response display, and the "Share to chat" affordance.
 *
 * Same light-DOM pattern as the M2.3-M2.7 + M3a.3 extractions.
 * Legacy CSS in src/ui/styles/quire-app.css.ts (.ai-panel,
 * .ai-panel-head, .ai-provider-tag, .ai-settings, .ai-form,
 * .ai-response, .ai-error, etc.) continues to cascade.
 *
 * Per the design spec (ui.md § AI assistance), the M3b structured-
 * tool returns + dual-card rendering land in a future iteration.
 * M3a.5 keeps the current text-in/text-out flow.
 *
 * Notable design choices:
 * - The component renders pre-sanitized HTML (renderMarkdown of the
 *   AI response).  QuireApp invokes renderMarkdown before passing
 *   so the region stays sanitize-pipeline-agnostic.
 * - The Claude / Gemini provider catalog (AI_DEFAULTS) is imported
 *   directly from ai-key-store — same module the controller uses.
 * - "Share to chat" is shown only when in active session; the
 *   inSession boolean is passed in by the host.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { AI_DEFAULTS, type AiProvider } from '../../controllers/ai-key-store';
import type { SanitizedHtml } from '../../markdown';

@customElement('ai-panel')
export class AiPanel extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ type: Boolean }) visible: boolean = false;
  @property() provider: AiProvider = 'claude';
  @property() apiKey: string = '';
  @property({ attribute: false }) apiKeys: Record<AiProvider, string> = {
    claude: '',
    gemini: ''
  };
  @property({ attribute: false }) models: Record<AiProvider, string> = {
    claude: '',
    gemini: ''
  };
  @property() systemPrompt: string = '';
  @property({ type: Boolean }) showSettings: boolean = false;
  @property() promptDraft: string = '';
  @property({ type: Boolean }) loading: boolean = false;
  @property() error: string | null = null;
  /** Pre-sanitized HTML from the most recent AI response. */
  @property({ attribute: false }) responseHtml: SanitizedHtml | null = null;
  @property({ type: Boolean }) inSession: boolean = false;

  @property({ attribute: false }) onSetProvider:
    | ((p: AiProvider) => void)
    | null = null;
  @property({ attribute: false }) onSetApiKey:
    | ((key: string) => void)
    | null = null;
  @property({ attribute: false }) onSetModel:
    | ((model: string) => void)
    | null = null;
  @property({ attribute: false }) onSetSystemPrompt:
    | ((text: string) => void)
    | null = null;
  @property({ attribute: false }) onToggleSettings:
    | (() => void)
    | null = null;
  @property({ attribute: false }) onPromptDraftChange:
    | ((text: string) => void)
    | null = null;
  @property({ attribute: false }) onSubmit:
    | ((prompt: string) => void)
    | null = null;
  @property({ attribute: false }) onCancel: (() => void) | null = null;
  @property({ attribute: false }) onShareToChat: (() => void) | null = null;

  override render(): TemplateResult {
    if (!this.visible) return html``;
    const hasKey = this.apiKey.length > 0;
    return html`
      <section class="card ai-panel">
        <div class="ai-panel-head">
          <h2>
            DM aide
            <span class="ai-provider-tag">
              ${AI_DEFAULTS[this.provider].label}
            </span>
          </h2>
          ${hasKey
            ? html`<button
                type="button"
                class="ai-settings-toggle"
                @click=${() => this.onToggleSettings?.()}
              >
                ${this.showSettings ? 'Hide settings' : 'Settings'}
              </button>`
            : nothing}
        </div>
        ${this.showSettings || !hasKey ? this.renderSettings() : nothing}
        ${hasKey ? this.renderPromptForm() : nothing}
        ${this.error
          ? html`<p class="ai-error">${this.error}</p>`
          : nothing}
        ${this.responseHtml
          ? html`
              <div class="ai-response">
                <div class="markdown">
                  ${unsafeHTML(this.responseHtml)}
                </div>
                ${this.inSession
                  ? html`
                      <button
                        type="button"
                        @click=${() => this.onShareToChat?.()}
                      >
                        Share to chat
                      </button>
                    `
                  : nothing}
              </div>
            `
          : nothing}
      </section>
    `;
  }

  private renderSettings(): TemplateResult {
    const provider = this.provider;
    const defs = AI_DEFAULTS[provider];
    const keyPlaceholder = provider === 'claude' ? 'sk-ant-…' : 'AIza…';
    const endpointLabel =
      provider === 'claude'
        ? 'api.anthropic.com'
        : 'generativelanguage.googleapis.com';
    const keyHint =
      provider === 'claude'
        ? html`Get an API key at
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              >console.anthropic.com</a
            >
            (paid; usage-based).  Free tier requires a credit card on
            file.`
        : html`Get an API key at
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              >aistudio.google.com</a
            >
            (generous free tier; no credit card needed).  This is the
            AI Studio key, NOT a Google One AI Premium subscription.`;
    return html`
      <div class="ai-settings">
        <fieldset class="ai-provider-choice">
          <legend>Provider</legend>
          ${(['claude', 'gemini'] as AiProvider[]).map(
            (p) => html`
              <label class="ai-provider-radio">
                <input
                  type="radio"
                  name="ai-provider"
                  .checked=${this.provider === p}
                  @change=${() => this.onSetProvider?.(p)}
                />
                ${AI_DEFAULTS[p].label}
              </label>
            `
          )}
        </fieldset>
        <label>
          <span>${defs.label} API key</span>
          <input
            type="password"
            .value=${this.apiKeys[provider]}
            placeholder=${keyPlaceholder}
            autocomplete="off"
            @input=${(e: Event) =>
              this.onSetApiKey?.((e.target as HTMLInputElement).value)}
          />
          <p class="ai-key-hint muted">${keyHint}</p>
        </label>
        <label>
          <span>Model</span>
          <select
            .value=${this.models[provider]}
            @change=${(e: Event) =>
              this.onSetModel?.((e.target as HTMLSelectElement).value)}
          >
            ${defs.models.map(
              (m) => html`
                <option .value=${m} ?selected=${m === this.models[provider]}>
                  ${m}
                </option>
              `
            )}
          </select>
        </label>
        <label>
          <span>System prompt</span>
          <textarea
            rows="4"
            .value=${this.systemPrompt}
            @input=${(e: Event) =>
              this.onSetSystemPrompt?.((e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </label>
        <p class="muted">
          Stored only in this browser's localStorage. Sent directly to
          ${endpointLabel} using your key.
        </p>
      </div>
    `;
  }

  private renderPromptForm(): TemplateResult {
    return html`
      <form
        class="ai-form"
        @submit=${(e: Event) => {
          e.preventDefault();
          this.onSubmit?.(this.promptDraft);
        }}
      >
        <textarea
          rows="3"
          .value=${this.promptDraft}
          placeholder="Describe Yui's reaction. Or: NPC voice for the gate agent. Or: three sensory beats from the cabin."
          aria-label="AI prompt"
          ?disabled=${this.loading}
          @input=${(e: Event) =>
            this.onPromptDraftChange?.((e.target as HTMLTextAreaElement).value)}
        ></textarea>
        <div class="ai-form-actions">
          ${this.loading
            ? html`<button type="button" @click=${() => this.onCancel?.()}>
                Cancel
              </button>`
            : html`<button type="submit">Ask</button>`}
        </div>
      </form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ai-panel': AiPanel;
  }
}

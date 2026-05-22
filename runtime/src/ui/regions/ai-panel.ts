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
import type { ContextScope } from '../../ai/context';
import type { SourceRef, StateUpdate } from '../../ai/schema';

/**
 * M3c.4: AI-write batch view passed from QuireApp.  Mirrors the
 * AiWriteController's reactive state.  Plain data so the panel
 * stays controller-agnostic (testable without instantiating the
 * controller).
 */
export interface AiWriteBatchView {
  /** Entries the DM has not yet acted on or has applied. */
  batch: ReadonlyArray<{
    id: string;
    update: StateUpdate;
    status: 'pending' | 'applied' | 'reverted' | 'hard-gate-pending';
    hardGateReason: string;
  }>;
  /** Seconds remaining in the undo window (0 when no undo active). */
  undoSecondsRemaining: number;
  /** True when at least one entry is still 'pending' OR 'hard-gate-pending'. */
  hasUnapplied: boolean;
}

/**
 * Pre-rendered dual-card payload — QuireApp runs the provider's
 * AiResponse through the markdown sanitizer (renderMarkdown) and
 * hands the safe-HTML pair plus source chips down here.  The
 * region itself does not see the raw model text.
 */
export interface DualCardResponse {
  safeHtml: SanitizedHtml;
  dmOnlyHtml: SanitizedHtml;
  sources: SourceRef[];
  responseId: string;
}

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
  /**
   * M3b.5 (P2-12): pre-rendered dual-card response.  When set, the
   * panel replaces the legacy single .ai-response block with two
   * cards (safe + DM-only).  null while no response is in flight.
   */
  @property({ attribute: false }) response: DualCardResponse | null = null;
  /**
   * M3b gate fix: id of the most recent responseId the DM has
   * accepted or rejected, so we can surface visible feedback on
   * the verdict buttons rather than silently emitting events.
   * Set by QuireApp via the on*Response callbacks.
   */
  @property() verdictResponseId: string = '';
  @property() verdictKind: '' | 'accept' | 'reject' = '';
  /**
   * M3b gate fix: token-budget meter inline in the panel header.
   * Replaces the missing topbar widget for v1.  Shows the running
   * total over the configured ceiling + a warning state at 80%
   * and exceeded state at 100%.  Hidden when no exchanges have
   * happened yet (total === 0).
   */
  @property({ attribute: false }) budget: {
    total: number;
    ceiling: number;
    warning: boolean;
    exceeded: boolean;
  } | null = null;
  /**
   * M3b.5: scope toggle for the next prompt.  Resets to 'public'
   * after submit per the design (redesign-plan.md L147).
   */
  @property() scope: ContextScope = 'public';
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
  @property({ attribute: false }) onSetScope:
    | ((s: ContextScope) => void)
    | null = null;
  @property({ attribute: false }) onAcceptResponse:
    | ((responseId: string) => void)
    | null = null;
  @property({ attribute: false }) onRejectResponse:
    | ((responseId: string) => void)
    | null = null;
  /**
   * M3c.4: AI-write batch view.  Null when no pending batch.  The
   * panel renders the accept-gate strip below the dual-card.
   */
  @property({ attribute: false }) writeBatch: AiWriteBatchView | null = null;
  @property({ attribute: false }) onApplyAllWrites: (() => void) | null = null;
  @property({ attribute: false }) onApplyWrite:
    | ((id: string) => void)
    | null = null;
  @property({ attribute: false }) onRevertWrite:
    | ((id: string) => void)
    | null = null;

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
          ${this.renderBudgetMeter()}
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
        ${this.response ? this.renderDualCard(this.response) : nothing}
        ${this.writeBatch ? this.renderWriteBatch(this.writeBatch) : nothing}
      </section>
    `;
  }

  /**
   * M3c.4 (P2-12 extension): render the AI-write accept-gate strip.
   * One-line summary per pending entry; apply-all-on-Enter for the
   * safe entries; per-entry explicit-accept buttons for the hard-
   * gated ones; per-entry revert glyph during the 60s undo window.
   */
  private renderWriteBatch(b: AiWriteBatchView): TemplateResult | typeof nothing {
    if (b.batch.length === 0) return nothing;
    const undoActive = b.undoSecondsRemaining > 0;
    return html`
      <div class="ai-write-strip">
        <header class="ai-write-strip-head">
          <span class="ai-write-strip-label"
            >AI proposed ${b.batch.length} update${b.batch.length === 1 ? '' : 's'}</span
          >
          ${b.hasUnapplied
            ? html`<button
                type="button"
                class="ai-write-apply-all"
                @click=${() => this.onApplyAllWrites?.()}
              >
                Apply all
              </button>`
            : nothing}
          ${undoActive
            ? html`<span class="ai-write-undo-banner"
                >Undo available (${b.undoSecondsRemaining}s)</span
              >`
            : nothing}
        </header>
        <ul class="ai-write-list">
          ${b.batch.map((entry) => this.renderWriteEntry(entry, undoActive))}
        </ul>
      </div>
    `;
  }

  private renderWriteEntry(
    entry: AiWriteBatchView['batch'][number],
    undoActive: boolean
  ): TemplateResult {
    const summary = formatStateUpdate(entry.update);
    const detail = formatStateUpdateDetail(entry.update);
    return html`
      <li class="ai-write-entry ai-write-entry-${entry.status}">
        <span class="ai-write-entry-text">${summary}</span>
        ${detail
          ? html`<span class="ai-write-entry-detail muted">${detail}</span>`
          : nothing}
        ${entry.status === 'pending'
          ? nothing
          : entry.status === 'hard-gate-pending'
            ? html`<button
                type="button"
                class="ai-write-accept-one"
                title=${entry.hardGateReason}
                @click=${() => this.onApplyWrite?.(entry.id)}
              >
                Accept this change
              </button>`
            : entry.status === 'applied'
              ? html`<span class="ai-write-status-tag">✓ applied</span>
                ${undoActive
                  ? html`<button
                      type="button"
                      class="ai-write-revert-one"
                      title="Revert this change"
                      @click=${() => this.onRevertWrite?.(entry.id)}
                    >
                      ↶ revert
                    </button>`
                  : nothing}`
              : html`<span class="ai-write-status-tag muted"
                  >✗ reverted</span
                >`}
      </li>
    `;
  }

  /**
   * M3b.5 (P2-12): render the dual-card response — safe (read aloud
   * OK) above, DM-only (do not read aloud) below with an amber rail.
   * Both cards always render even when one half is empty; an empty
   * card shows a muted "(none)" placeholder so the DM sees the
   * structure regardless of which side carried content.
   */
  private renderDualCard(r: DualCardResponse): TemplateResult {
    return html`
      <div class="ai-dual-card">
        <section class="ai-card ai-card-safe" aria-label="Safe to read aloud">
          <header class="ai-card-head">
            <span class="ai-card-badge ai-card-badge-safe">read aloud</span>
          </header>
          <div class="ai-card-body markdown">
            ${r.safeHtml
              ? unsafeHTML(r.safeHtml)
              : html`<p class="muted">(none)</p>`}
          </div>
          ${this.inSession && r.safeHtml
            ? html`<button
                type="button"
                class="ai-card-action"
                @click=${() => this.onShareToChat?.()}
              >
                Share to chat
              </button>`
            : nothing}
        </section>
        <section class="ai-card ai-card-dm" aria-label="DM only — do not read aloud">
          <header class="ai-card-head">
            <span class="ai-card-badge ai-card-badge-dm"
              >🔒 DM only — do not read aloud</span
            >
          </header>
          <div class="ai-card-body markdown">
            ${r.dmOnlyHtml
              ? unsafeHTML(r.dmOnlyHtml)
              : html`<p class="muted">(none)</p>`}
          </div>
          ${r.dmOnlyHtml
            ? html`<button
                type="button"
                class="ai-card-action ai-card-action-copy"
                title="Copy DM-only text (do not read aloud)"
                @click=${(e: Event) => copyDmOnly(e, r.dmOnlyHtml)}
              >
                Copy (do not read aloud)
              </button>`
            : nothing}
        </section>
        ${r.sources.length > 0 ? this.renderSourceChips(r.sources) : nothing}
        ${r.responseId
          ? this.renderVerdict(r.responseId)
          : nothing}
      </div>
    `;
  }

  /**
   * M3b gate fix: when the DM has clicked Accept/Reject on this
   * response, the buttons are replaced with a muted confirmation
   * footer.  Silent button-click feels broken at the table; visible
   * feedback closes the loop.
   */
  private renderVerdict(responseId: string): TemplateResult {
    const verdicted =
      this.verdictResponseId === responseId && this.verdictKind !== '';
    if (verdicted) {
      return html`<div class="ai-card-verdict ai-card-verdict-done">
        <span class="muted"
          >${this.verdictKind === 'accept' ? '✓ Accepted' : '✗ Rejected'}</span
        >
      </div>`;
    }
    return html`<div class="ai-card-verdict">
      <button
        type="button"
        class="ai-card-accept"
        @click=${() => this.onAcceptResponse?.(responseId)}
      >
        Accept
      </button>
      <button
        type="button"
        class="ai-card-reject"
        @click=${() => this.onRejectResponse?.(responseId)}
      >
        Reject
      </button>
    </div>`;
  }

  private renderSourceChips(sources: SourceRef[]): TemplateResult {
    return html`
      <ul class="ai-card-sources">
        ${sources.map(
          (s) => html`
            <li class="ai-card-source">
              <code>${s.label}</code>${s.path
                ? html`<span class="muted"> · ${s.path}</span>`
                : nothing}
            </li>
          `
        )}
      </ul>
    `;
  }

  private renderBudgetMeter(): TemplateResult | typeof nothing {
    const b = this.budget;
    if (!b || b.total === 0) return nothing;
    const stateClass = b.exceeded
      ? 'ai-budget-exceeded'
      : b.warning
        ? 'ai-budget-warning'
        : 'ai-budget-ok';
    const pct = Math.round((b.total / b.ceiling) * 100);
    return html`<span
      class="ai-budget ${stateClass}"
      title=${b.exceeded
        ? `Token budget reached for this session (${b.total} / ${b.ceiling}).  The Ask button is disabled.`
        : `${b.total} / ${b.ceiling} tokens used (${pct}%)`}
    >
      ${b.total.toLocaleString()} / ${b.ceiling.toLocaleString()} (${pct}%)
    </span>`;
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
    const budgetExceeded = !!this.budget?.exceeded;
    return html`
      ${budgetExceeded
        ? html`<p class="ai-budget-banner" role="status">
            Token budget reached for this session.  Increase the
            ceiling in settings to keep prompting.
          </p>`
        : nothing}
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
        <label class="ai-scope-toggle" title=${
          this.scope === 'dm'
            ? 'Including DM-only files in the prompt (resets after submit)'
            : 'Public scope — DM-only files excluded from the prompt'
        }>
          <input
            type="checkbox"
            ?checked=${this.scope === 'dm'}
            ?disabled=${this.loading}
            @change=${(e: Event) =>
              this.onSetScope?.(
                (e.target as HTMLInputElement).checked ? 'dm' : 'public'
              )}
          />
          <span>Include DM notes (resets after submit)</span>
        </label>
        <div class="ai-form-actions">
          ${this.loading
            ? html`<button type="button" @click=${() => this.onCancel?.()}>
                Cancel
              </button>`
            : html`<button type="submit" ?disabled=${budgetExceeded}>
                Ask
              </button>`}
        </div>
      </form>
    `;
  }
}

/**
 * M3c.4: one-line summary of a StateUpdate, formatted for the
 * DM's at-a-glance scan.  Honors rules-reference.md L135 for the
 * caster-state-set case — `reason` (the narration prompt) is the
 * primary text; the bare ladder state is metadata in the muted
 * detail line.  Plain Lit text interpolation (no markdown
 * rendering, no unsafeHTML) per Security S-2.
 */
export function formatStateUpdate(u: StateUpdate): string {
  switch (u.kind) {
    case 'pc-edit': {
      const sign = u.delta >= 0 ? '+' : '';
      const reason = u.reason ? ` (${u.reason})` : '';
      return `${u.pcId}: ${u.field} ${sign}${u.delta}${reason}`;
    }
    case 'dice-roll': {
      return `${u.purpose}: roll ${u.expression}`;
    }
    case 'caster-state-set': {
      // reason is primary; state label is secondary (in detail line).
      const reason = u.reason ?? u.pcId;
      return `${u.pcId}: ${reason}`;
    }
  }
}

/**
 * The metadata line for a StateUpdate — shown smaller / muted
 * beneath the primary summary.  For caster-state-set this is
 * where the bare ladder label lives.
 */
export function formatStateUpdateDetail(u: StateUpdate): string {
  switch (u.kind) {
    case 'pc-edit':
      return '';
    case 'dice-roll':
      return u.modifierBreakdown ?? '';
    case 'caster-state-set': {
      const parts: string[] = [];
      parts.push(`ladder → ${u.ladderState}`);
      if (u.taxActive !== undefined)
        parts.push(`tax ${u.taxActive ? 'on' : 'off'}`);
      if (u.spamCount !== undefined) parts.push(`spam ${u.spamCount}`);
      return parts.join(' · ');
    }
  }
}

/**
 * Plain-text copy helper for the "do not read aloud" action.  The
 * dmOnlyHtml prop is pre-sanitized; strip tags for the clipboard
 * so the DM gets plain prose (the visible card already shows the
 * rich version).  Fallback: select+copy via the DOM if the
 * Clipboard API isn't available.
 */
function copyDmOnly(e: Event, html: string): void {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const text = tmp.textContent ?? '';
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
    return;
  }
  // Fallback: range-select + execCommand('copy').
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    // ignore — user can manually copy from the visible card
  } finally {
    ta.remove();
  }
  // Acknowledge the event so click handlers don't double-fire.
  e.preventDefault();
}

declare global {
  interface HTMLElementTagNameMap {
    'ai-panel': AiPanel;
  }
}

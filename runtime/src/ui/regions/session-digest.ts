// @vitest-environment happy-dom

/**
 * <session-digest> — D4 (2026-05-26) end-of-session recap.
 *
 * Mounts inside `<session-wrap-marks>` (as the panel BELOW the
 * advancement-marks list).  Per UX-expert + TTRPG-expert
 * convergence: the digest is the "campfire recap" — the artifact
 * the table will re-read at session-open next time.
 *
 * Flow:
 *   1. DM clicks "Generate digest" → host calls AI broker with the
 *      pre-filtered event bundle (player-visible kinds only —
 *      see SESSION_DIGEST_INPUT_KINDS in session-digest-prompt.ts)
 *   2. AI returns markdown → renders in an editable textarea
 *   3. DM edits if needed → clicks "Save digest"
 *   4. Host emits `session-digest` event → recap lands in shared
 *      state for everyone to read at session-open next time
 *
 * **Spoiler-firewall layer (practice memo):** the AI input is
 * pre-filtered (host responsibility); the DRAFT lives in local
 * `@state` until save, so no peer sees the AI output before the
 * DM has reviewed it.  Save emits a player-visible event whose
 * markdown the DM has read first — same model as backstory
 * synthesis.
 *
 * **Why this is NOT the silent-grant anti-pattern** (recorded in
 * the holistic-review plan doc): silent-grant text + release-
 * moment text + seat-memory text are intimate DM-typed beats
 * with one-shot stakes.  The session-digest is a long-form recap
 * the DM edits anyway — AI scaffolding accelerates without
 * substituting.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/**
 * Host callback: ask for an AI-drafted digest.  Resolves to a
 * narrow result shape that mirrors `QuireApp.generateSessionDigest`.
 * The host owns the AI call; the component owns the local draft +
 * commit UX.
 */
export type GenerateDigestCallback = () => Promise<
  | { ok: true; markdown: string; responseId: string }
  | { ok: false; code: string; message: string }
>;

/**
 * Host callback: commit the (possibly DM-edited) draft.  Returns
 * true on append (event landed).  The host wires this to
 * `QuireApp.appendSessionDigest`.
 */
export type SaveDigestCallback = (
  markdown: string,
  generatedByResponseId?: string
) => boolean;

/** Read-side: prior saved digests (newest last).  Used to render
 *  "previous digests" list. */
export interface DigestEntry {
  ts: number;
  markdown: string;
  savedByPeerId: string;
}

@customElement('session-digest')
export class SessionDigest extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Prior digests in chronological order (newest LAST per the
   *  state.sessionDigests append-only contract). */
  @property({ attribute: false })
  priorDigests: DigestEntry[] = [];

  /** Wired only for the coord viewer; null for players. */
  @property({ attribute: false })
  onGenerate: GenerateDigestCallback | null = null;
  @property({ attribute: false })
  onSave: SaveDigestCallback | null = null;

  /** Inline draft state — drafts live local until Save. */
  @state() private draft: string = '';
  @state() private generating: boolean = false;
  @state() private errorMessage: string | null = null;
  @state() private generatedByResponseId: string | undefined = undefined;

  override render(): TemplateResult {
    const canCoord = this.onGenerate !== null && this.onSave !== null;
    const hasDraft = this.draft.trim().length > 0;
    return html`<section class="session-digest">
      <header class="session-digest-head">
        <h3>Session digest</h3>
        ${canCoord
          ? html`<span class="muted session-digest-hint"
              >Drafts the campfire recap players read at next session-open.</span
            >`
          : nothing}
      </header>
      ${this.renderPriorDigests()}
      ${canCoord ? this.renderEditor(hasDraft) : nothing}
    </section>`;
  }

  private renderPriorDigests(): TemplateResult | typeof nothing {
    if (this.priorDigests.length === 0) return nothing;
    // Show only the LATEST prior digest collapsed; older entries
    // hide behind a disclosure to avoid cockpit overload.
    const latest = this.priorDigests[this.priorDigests.length - 1];
    const older = this.priorDigests.slice(0, -1);
    return html`<div class="session-digest-prior">
      <h4>Previous recap</h4>
      <article class="session-digest-prior-body">
        <p class="muted session-digest-prior-ts">
          saved ${new Date(latest.ts).toLocaleDateString()}
        </p>
        <pre class="session-digest-prior-md">${latest.markdown}</pre>
      </article>
      ${older.length > 0
        ? html`<details class="session-digest-prior-older">
            <summary>${older.length} earlier recap${older.length === 1 ? '' : 's'}</summary>
            <ul>
              ${older
                .slice()
                .reverse()
                .map(
                  (d) => html`<li>
                    <p class="muted">
                      ${new Date(d.ts).toLocaleDateString()}
                    </p>
                    <pre class="session-digest-prior-md">${d.markdown}</pre>
                  </li>`
                )}
            </ul>
          </details>`
        : nothing}
    </div>`;
  }

  private renderEditor(hasDraft: boolean): TemplateResult {
    return html`<div class="session-digest-editor">
      ${this.errorMessage
        ? html`<p class="session-digest-error" role="alert">
            ${this.errorMessage}
          </p>`
        : nothing}
      ${hasDraft
        ? html`<label class="session-digest-label">
            Draft (edit freely; players will read what you save)
            <textarea
              class="session-digest-draft"
              rows="14"
              maxlength="20000"
              aria-label="Session digest draft"
              .value=${this.draft}
              @input=${(e: Event) => {
                this.draft = (e.target as HTMLTextAreaElement).value;
              }}
            ></textarea>
          </label>`
        : nothing}
      <div class="session-digest-actions">
        <button
          type="button"
          class="session-digest-generate"
          ?disabled=${this.generating || this.onGenerate === null}
          @click=${() => void this.handleGenerate()}
        >
          ${this.generating
            ? 'Generating…'
            : hasDraft
              ? 'Regenerate'
              : 'Generate digest'}
        </button>
        ${hasDraft
          ? html`<button
              type="button"
              class="session-digest-save"
              ?disabled=${this.generating}
              @click=${() => this.handleSave()}
            >
              Save digest
            </button>`
          : nothing}
        ${hasDraft
          ? html`<button
              type="button"
              class="session-digest-discard"
              ?disabled=${this.generating}
              @click=${() => this.handleDiscard()}
            >
              Discard draft
            </button>`
          : nothing}
      </div>
    </div>`;
  }

  private async handleGenerate(): Promise<void> {
    if (!this.onGenerate) return;
    this.generating = true;
    this.errorMessage = null;
    try {
      const result = await this.onGenerate();
      if (result.ok) {
        this.draft = result.markdown;
        this.generatedByResponseId = result.responseId;
      } else {
        this.errorMessage = result.message;
      }
    } finally {
      this.generating = false;
    }
  }

  private handleSave(): void {
    if (!this.onSave) return;
    const text = this.draft.trim();
    if (text.length === 0) return;
    const ok = this.onSave(text, this.generatedByResponseId);
    if (ok) {
      // Clear local state — the saved digest will appear in
      // priorDigests on next render via the state subscription.
      this.draft = '';
      this.errorMessage = null;
      this.generatedByResponseId = undefined;
    }
  }

  private handleDiscard(): void {
    this.draft = '';
    this.errorMessage = null;
    this.generatedByResponseId = undefined;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'session-digest': SessionDigest;
  }
}

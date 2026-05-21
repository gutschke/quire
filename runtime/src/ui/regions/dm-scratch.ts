/**
 * <dm-scratch> — DM scratch column (M3a.8 P2-3).
 *
 * A quick-jot affordance for the DM to capture in-session notes
 * without leaving the table.  Notes are append-only chronological
 * and feed the post-session living-document AI.  Render-gated
 * DM-only; the `scratchNotes` field is wiped from non-coord views
 * by filterForViewer.
 *
 * Light-DOM rendering: createRenderRoot returns this.  Styles
 * live in `src/ui/styles/quire-app.css.ts` under .dm-scratch.
 *
 * Handlers stay on root: the component receives the recent-notes
 * list + an onSubmit callback.  Draft text is internal @state on
 * this component (the parent doesn't need it for any other
 * decision) — a deliberate divergence from the root-as-source-of-
 * truth pattern used by chat / rename, justified because the
 * scratch input has no cross-region coupling.
 */

import {
  LitElement,
  html,
  nothing,
  type TemplateResult
} from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';

export interface ScratchEntry {
  ts: number;
  text: string;
  scenePath?: string;
}

@customElement('dm-scratch')
export class DmScratch extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) entries: ScratchEntry[] = [];
  @property({ attribute: false }) onSubmit:
    | ((text: string) => void)
    | null = null;

  @state() private draft: string = '';
  @query('textarea.dm-scratch-input') private input?: HTMLTextAreaElement;

  /** Public method so QuireApp can focus this via the `'` hotkey. */
  focusInput(): void {
    this.input?.focus();
  }

  override render(): TemplateResult {
    const recent = this.entries.slice(-5).reverse();
    return html`
      <section class="card dm-scratch">
        <h2>DM scratch <span class="muted">(' to focus)</span></h2>
        <form
          @submit=${(e: Event) => {
            e.preventDefault();
            this.submit();
          }}
        >
          <textarea
            class="dm-scratch-input"
            placeholder="Jot a note for the post-session writeup…"
            rows="2"
            .value=${this.draft}
            @input=${(e: Event) => {
              this.draft = (e.target as HTMLTextAreaElement).value;
            }}
            @keydown=${(e: KeyboardEvent) => {
              // Cmd/Ctrl+Enter submits without forcing the DM to
              // grab the mouse.  Plain Enter inserts a newline as
              // expected in a multi-line textarea.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                this.submit();
              }
            }}
          ></textarea>
          <button type="submit" ?disabled=${this.draft.trim().length === 0}>
            Add note
          </button>
        </form>
        ${recent.length === 0
          ? html`<p class="muted">No notes yet.</p>`
          : html`
              <ul class="dm-scratch-list">
                ${recent.map(
                  (n) => html`
                    <li class="dm-scratch-entry">
                      <code class="dm-scratch-ts"
                        >${formatTs(n.ts)}</code
                      >
                      <span class="dm-scratch-text">${n.text}</span>
                      ${n.scenePath
                        ? html`<small class="dm-scratch-scene"
                            >· ${n.scenePath}</small
                          >`
                        : nothing}
                    </li>
                  `
                )}
              </ul>
            `}
      </section>
    `;
  }

  private submit(): void {
    const text = this.draft.trim();
    if (text.length === 0) return;
    this.onSubmit?.(text);
    this.draft = '';
  }
}

function formatTs(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

declare global {
  interface HTMLElementTagNameMap {
    'dm-scratch': DmScratch;
  }
}

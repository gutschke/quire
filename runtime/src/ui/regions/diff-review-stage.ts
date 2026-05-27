// @vitest-environment happy-dom

/**
 * <diff-review-stage> — D1-D (2026-05-26).
 *
 * The third pane of the wrap-stepper.  Renders pending
 * `DiffProposal`s in a 3-column layout per ui.md L298-363:
 *
 *   ┌─────────────┬────────────────────────────┬───────────────┐
 *   │ Proposal    │ Diff card (current)        │ Context       │
 *   │ queue       │  - NPC + jsonPointer       │  - source     │
 *   │  ▸ Yui (3)  │  - before / after diff     │    events     │
 *   │    Sato (2) │  - edit textarea           │  - rationale  │
 *   │    Mei (1)  │  - accept / reject / skip  │                │
 *   └─────────────┴────────────────────────────┴───────────────┘
 *
 * Hotkeys (UX-expert): `j`/`k` next/prev, `a` accept, `r` reject,
 * `e` focus the edit textarea.  No Cmd-Enter "commit all" in MVP
 * (each accept is its own action; the wrap stepper's "Finish wrap"
 * is the terminal exit).
 *
 * Authorship per chargen-authorship-division (TTRPG-expert): AI
 * proposes what the NPC NOW KNOWS (memory + disposition + facts);
 * DM owns what the NPC SAYS.  The MVP scope (NPC memory of player
 * choices ONLY) keeps the AI on the "knows" side; if the AI
 * proposes a voice/dialogue change anyway, the DM rejects.
 *
 * **Why per-pointer cards** (Adversarial B-1): each proposal targets
 * one dotted-field path so the broadcast firewall classifies
 * visibility per proposal (player-eligible vs DM-only).  Combined
 * "all changes for Yui in one card" would lose the per-pointer
 * structural classification.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { isDmOnlyNpcFieldPath } from '../../character-loader';

/**
 * Read-side shape — the host adapts `state.diffProposals` (which is
 * `PendingDiffProposal`) into this for the component.  Keeps the
 * component agnostic of engine internals.
 */
export interface DiffProposalView {
  id: string;
  npcId: string;
  path: string;
  field: string;
  before: unknown;
  after: unknown;
  rationale: string;
  sourceEventIds?: string[];
}

export type AcceptCallback = (
  id: string,
  editedAfter?: unknown
) => Promise<
  | { ok: true }
  | { ok: false; code: string; message: string }
>;

export type RejectCallback = (id: string, opts?: { reason?: string }) => boolean;

export type GenerateCallback = () => Promise<
  | { ok: true; created: number; responseId: string }
  | { ok: false; code: string; message: string }
>;

@customElement('diff-review-stage')
export class DiffReviewStage extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Currently pending proposals (DM-side). */
  @property({ attribute: false }) proposals: DiffProposalView[] = [];

  /** Wired only on the coord viewer. */
  @property({ attribute: false }) onGenerate: GenerateCallback | null = null;
  @property({ attribute: false }) onAccept: AcceptCallback | null = null;
  @property({ attribute: false }) onReject: RejectCallback | null = null;

  /** Index of the currently-selected proposal in `proposals`. */
  @state() private selectedIdx: number = 0;

  /** Per-proposal edit drafts, keyed by proposal id.  Cleared on
   *  accept / reject / proposal disappearance. */
  @state() private edits: Record<string, string> = {};

  /** Generate-call state. */
  @state() private generating: boolean = false;
  @state() private statusMessage: string | null = null;
  @state() private errorMessage: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKey);
  }

  override disconnectedCallback(): void {
    document.removeEventListener('keydown', this.handleKey);
    super.disconnectedCallback();
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('proposals')) {
      // Clamp selectedIdx into bounds when proposals shrink.
      if (this.selectedIdx >= this.proposals.length) {
        this.selectedIdx = Math.max(0, this.proposals.length - 1);
      }
      // Prune edits for proposals that no longer exist (after
      // accept / reject + materializer purge).
      const liveIds = new Set(this.proposals.map((p) => p.id));
      let needsPrune = false;
      for (const k of Object.keys(this.edits)) {
        if (!liveIds.has(k)) {
          needsPrune = true;
          break;
        }
      }
      if (needsPrune) {
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(this.edits)) {
          if (liveIds.has(k)) next[k] = v;
        }
        this.edits = next;
      }
    }
  }

  private handleKey = (e: KeyboardEvent): void => {
    // Don't hijack keys while the DM is editing the textarea.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
      return;
    }
    if (this.proposals.length === 0) return;
    if (this.onAccept === null && this.onReject === null) return;
    switch (e.key) {
      case 'j':
        this.selectedIdx = Math.min(
          this.selectedIdx + 1,
          this.proposals.length - 1
        );
        e.preventDefault();
        break;
      case 'k':
        this.selectedIdx = Math.max(this.selectedIdx - 1, 0);
        e.preventDefault();
        break;
      case 'a':
        void this.handleAcceptCurrent();
        e.preventDefault();
        break;
      case 'r':
        this.handleRejectCurrent();
        e.preventDefault();
        break;
      case 'e': {
        const ta = this.querySelector(
          '.diff-review-edit-textarea'
        ) as HTMLTextAreaElement | null;
        ta?.focus();
        e.preventDefault();
        break;
      }
    }
  };

  override render(): TemplateResult {
    const canCoord = this.onAccept !== null && this.onReject !== null;
    return html`<section class="diff-review-stage">
      ${this.renderHeader(canCoord)}
      ${this.proposals.length === 0
        ? this.renderEmpty(canCoord)
        : this.renderPanes(canCoord)}
    </section>`;
  }

  private renderHeader(canCoord: boolean): TemplateResult {
    return html`<header class="diff-review-header">
      <h3>NPC living-doc — diff review</h3>
      ${canCoord
        ? html`<div class="diff-review-actions">
            <button
              type="button"
              class="diff-review-generate"
              ?disabled=${this.generating || this.onGenerate === null}
              @click=${() => void this.handleGenerate()}
            >
              ${this.generating
                ? 'Generating…'
                : this.proposals.length === 0
                  ? 'Generate proposals'
                  : 'Regenerate (replaces queue)'}
            </button>
          </div>`
        : nothing}
      ${this.statusMessage
        ? html`<p class="diff-review-status">${this.statusMessage}</p>`
        : nothing}
      ${this.errorMessage
        ? html`<p class="diff-review-error" role="alert">
            ${this.errorMessage}
          </p>`
        : nothing}
    </header>`;
  }

  private renderEmpty(canCoord: boolean): TemplateResult {
    return html`<div class="diff-review-empty">
      <p class="muted">
        ${canCoord
          ? 'No proposals yet.  Click Generate to ask the AI for NPC-memory updates based on this session.'
          : 'No diff proposals pending.'}
      </p>
    </div>`;
  }

  private renderPanes(canCoord: boolean): TemplateResult {
    const selected =
      this.proposals[this.selectedIdx] ?? this.proposals[0]!;
    return html`<div class="diff-review-panes">
      ${this.renderQueuePane()} ${this.renderCardPane(selected, canCoord)}
      ${this.renderContextPane(selected)}
    </div>`;
  }

  private renderQueuePane(): TemplateResult {
    // Group proposals by NPC for the queue display; render flat
    // list inside each group.
    const byNpc = new Map<string, DiffProposalView[]>();
    for (const p of this.proposals) {
      const arr = byNpc.get(p.npcId);
      if (arr) arr.push(p);
      else byNpc.set(p.npcId, [p]);
    }
    return html`<nav class="diff-review-queue" aria-label="Proposal queue">
      <h4>Queue (${this.proposals.length})</h4>
      <ul>
        ${Array.from(byNpc.entries()).map(
          ([npcId, props]) => html`<li class="diff-review-queue-group">
            <p class="diff-review-queue-npc">${npcId} (${props.length})</p>
            <ul>
              ${props.map((p) => {
                const idx = this.proposals.indexOf(p);
                const isSelected = idx === this.selectedIdx;
                const dmOnly = isDmOnlyNpcFieldPath(p.field);
                const cls = [
                  'diff-review-queue-item',
                  isSelected ? 'diff-review-queue-item-selected' : '',
                  dmOnly ? 'diff-review-queue-item-dm-only' : ''
                ]
                  .filter(Boolean)
                  .join(' ');
                return html`<li class=${cls}>
                  <button
                    type="button"
                    class="diff-review-queue-button"
                    @click=${() => {
                      this.selectedIdx = idx;
                    }}
                  >
                    <span class="diff-review-queue-field">${p.field}</span>
                  </button>
                </li>`;
              })}
            </ul>
          </li>`
        )}
      </ul>
    </nav>`;
  }

  private renderCardPane(
    selected: DiffProposalView,
    canCoord: boolean
  ): TemplateResult {
    const dmOnly = isDmOnlyNpcFieldPath(selected.field);
    const draft = this.edits[selected.id] ?? this.stringifyAfter(selected.after);
    return html`<article
      class=${`diff-review-card ${dmOnly ? 'diff-review-card-dm-only' : ''}`}
    >
      <header class="diff-review-card-head">
        <h4>${selected.npcId} · ${selected.field}</h4>
        ${dmOnly
          ? html`<span class="diff-review-card-rail">DM-only field</span>`
          : nothing}
      </header>
      <div class="diff-review-diff">
        <div class="diff-review-before">
          <p class="muted">before</p>
          <pre>${this.stringifyValue(selected.before)}</pre>
        </div>
        <div class="diff-review-after">
          <p class="muted">after</p>
          ${canCoord
            ? html`<textarea
                class="diff-review-edit-textarea"
                rows="8"
                .value=${draft}
                @input=${(e: Event) => {
                  this.edits = {
                    ...this.edits,
                    [selected.id]: (e.target as HTMLTextAreaElement).value
                  };
                }}
              ></textarea>`
            : html`<pre>${this.stringifyValue(selected.after)}</pre>`}
        </div>
      </div>
      ${canCoord
        ? html`<div class="diff-review-card-actions">
            <button
              type="button"
              class="diff-review-accept"
              @click=${() => void this.handleAcceptCurrent()}
            >
              Accept (a)
            </button>
            <button
              type="button"
              class="diff-review-reject"
              @click=${() => this.handleRejectCurrent()}
            >
              Reject (r)
            </button>
          </div>`
        : nothing}
    </article>`;
  }

  private renderContextPane(selected: DiffProposalView): TemplateResult {
    return html`<aside class="diff-review-context" aria-label="Proposal context">
      <h4>Why?</h4>
      <p class="diff-review-rationale">${selected.rationale}</p>
      ${selected.sourceEventIds && selected.sourceEventIds.length > 0
        ? html`<div class="diff-review-sources">
            <h5>Source events</h5>
            <ul>
              ${selected.sourceEventIds.map(
                (id) => html`<li><code>${id}</code></li>`
              )}
            </ul>
          </div>`
        : nothing}
    </aside>`;
  }

  // -----------------------------------------------------------------
  // Action handlers
  // -----------------------------------------------------------------

  private async handleGenerate(): Promise<void> {
    if (!this.onGenerate) return;
    this.generating = true;
    this.errorMessage = null;
    this.statusMessage = null;
    try {
      const result = await this.onGenerate();
      if (result.ok) {
        this.statusMessage = `Generated ${result.created} proposal${result.created === 1 ? '' : 's'}.`;
      } else {
        this.errorMessage = result.message;
      }
    } finally {
      this.generating = false;
    }
  }

  private async handleAcceptCurrent(): Promise<void> {
    const selected = this.proposals[this.selectedIdx];
    if (!selected || !this.onAccept) return;
    const draftRaw = this.edits[selected.id];
    let editedAfter: unknown | undefined;
    if (draftRaw !== undefined) {
      editedAfter = this.parseAfterDraft(draftRaw, selected.after);
    }
    const result = await this.onAccept(selected.id, editedAfter);
    if (!result.ok) {
      this.errorMessage = result.message;
    } else {
      this.statusMessage = `Accepted ${selected.npcId} · ${selected.field}.`;
      this.errorMessage = null;
    }
  }

  private handleRejectCurrent(): void {
    const selected = this.proposals[this.selectedIdx];
    if (!selected || !this.onReject) return;
    const ok = this.onReject(selected.id);
    if (ok) {
      this.statusMessage = `Rejected ${selected.npcId} · ${selected.field}.`;
      this.errorMessage = null;
    }
  }

  // -----------------------------------------------------------------
  // Format helpers
  // -----------------------------------------------------------------

  /**
   * Stringify a value for display in the before/after pre blocks.
   * Strings render unquoted; other primitives stringify; objects
   * pretty-print as JSON.
   */
  private stringifyValue(v: unknown): string {
    if (typeof v === 'string') return v;
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v, null, 2);
      } catch {
        return String(v);
      }
    }
    return String(v);
  }

  /** Same as `stringifyValue` but used to seed the edit textarea —
   *  separate hook so a future "render as form per type" can branch. */
  private stringifyAfter(v: unknown): string {
    return this.stringifyValue(v);
  }

  /**
   * Parse the DM's textarea draft back into a typed value.  The
   * heuristic mirrors the original `after` shape: if the AI
   * proposed a string, keep as string; if it proposed an object,
   * try to parse the draft as JSON (fall back to the original on
   * parse failure).  This avoids the DM accidentally turning a
   * string field into an object by including JSON-looking text.
   */
  private parseAfterDraft(draft: string, original: unknown): unknown {
    if (typeof original === 'string') return draft;
    if (typeof original === 'object' && original !== null) {
      try {
        return JSON.parse(draft);
      } catch {
        return original;
      }
    }
    // Number / boolean / null original — try JSON.parse; fall back.
    try {
      return JSON.parse(draft);
    } catch {
      return draft;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'diff-review-stage': DiffReviewStage;
  }
}

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
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { renderMarkdown } from '../../markdown';
import {
  loadDigestDraft,
  saveDigestDraft,
  clearDigestDraft
} from '../../digest-draft-persistence';

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

  /**
   * OP-037 (run #9, M6a-FS-2): session-digest backup chip surface
   * per `ux-strategy.md §A10-A`.  When the digest renders for the
   * DM (canCoord === true), append a single chip
   * "Back up tonight's session?" that opens the DM operational
   * view.  Set this prop to `true` on the host side to enable;
   * the host gates feature availability + DM-role and the digest
   * only displays if both conditions hold.  Defaults to false so
   * existing component tests don't see the chip.
   *
   * Wiring: the chip dispatches `session-digest-open-operational-
   * view` (bubbles + composed) which the host handles by setting
   * `appMode = 'dm-operational'`.  The chip is rendered both BEFORE
   * the editor (high-affordance, end-of-session moment) and is
   * suppressed if the DM is currently editing a draft (avoid
   * pulling them out of mid-edit).
   */
  @property({ attribute: false })
  showBackupChip: boolean = false;

  /**
   * Run #15 (UX-5 per ttrpg-ux-expert v2 Q8): campaign slug for the
   * digest-draft localStorage persistence layer.  Set by the host
   * (quire-app) at render time.  When non-empty, the component
   * loads any saved draft on connect + autosaves on input + clears
   * on Save/Discard.  When empty/null, the persistence layer is a
   * no-op (the component still works in-memory).
   */
  @property({ attribute: false })
  campaignSlug: string = '';

  /** Inline draft state — drafts live local until Save. */
  @state() private draft: string = '';
  @state() private generating: boolean = false;
  @state() private errorMessage: string | null = null;
  @state() private generatedByResponseId: string | undefined = undefined;

  /**
   * Run #15 (UX-5): debounced autosave timer for the draft
   * persistence layer.  Mirrors the chargen-persistence-queue
   * debounce shape; lighter — no queue, just a single trailing
   * write because the draft is one large blob.
   */
  private digestDraftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DIGEST_DRAFT_DEBOUNCE_MS = 750;

  /**
   * Run #15 (UX-5): on first mount, load any persisted digest
   * draft.  Cheap — one localStorage read.  No-op when slug is
   * empty (host hasn't wired it yet) or storage has no entry.
   */
  override connectedCallback(): void {
    super.connectedCallback();
    this.loadPersistedDraft();
  }

  override disconnectedCallback(): void {
    // Flush a pending debounced save before tear-down so a fast
    // tab-close after the last keystroke doesn't drop the trailing
    // edits.  beforeunload is best-effort; this is the synchronous
    // path that fires on host re-render too.
    if (this.digestDraftSaveTimer !== null) {
      clearTimeout(this.digestDraftSaveTimer);
      this.digestDraftSaveTimer = null;
      this.persistDraftNow();
    }
    super.disconnectedCallback();
  }

  /**
   * Run #15 (UX-5): re-load the persisted draft when the slug
   * prop changes (host swaps between campaigns) so the right
   * draft surfaces.  Triggered via updated() — the framework
   * calls it after a property update has been applied.
   *
   * Run #16 (H-2, adversarial v3): on a campaign-slug CHANGE
   * (not the initial mount), the in-memory draft belongs to the
   * PRIOR campaign and must not bleed into the new one.  Discard
   * the in-memory draft + cancel any pending debounced save (which
   * would otherwise write campaign A's text under campaign B's
   * storage key on next tick), THEN load campaign B's persisted
   * draft.
   *
   * Design call (DEC-034): discard-and-load is canonical for the
   * wrap-digest surface.  The DM's intent when changing campaigns
   * is "I'm now authoring campaign B's recap" — campaign A's draft
   * (if any) is preserved in localStorage under A's key and will
   * surface when the DM returns to A.  No prompt; matches the
   * silent-persistence model used elsewhere (chargen-persistence).
   */
  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has('campaignSlug')) {
      const prev = changed.get('campaignSlug') as string | undefined;
      const isInitialMount = prev === undefined;
      if (!isInitialMount) {
        // Cross-campaign switch.  Cancel pending save (would write
        // OLD text under NEW key) and clear in-memory draft so the
        // load can populate cleanly.
        if (this.digestDraftSaveTimer !== null) {
          clearTimeout(this.digestDraftSaveTimer);
          this.digestDraftSaveTimer = null;
        }
        this.draft = '';
        this.errorMessage = null;
        this.generatedByResponseId = undefined;
      }
      this.loadPersistedDraft();
    }
  }

  private loadPersistedDraft(): void {
    if (!this.campaignSlug) return;
    // Don't overwrite an in-progress draft already in @state (e.g.
    // a regeneration just landed).  Only load when the local draft
    // is empty — the persistence path is for "tab closed without
    // saving."
    //
    // Run #16 (H-2): updated() clears the in-memory draft on a
    // campaign-slug CHANGE before calling us, so this early-return
    // only fires on the initial-mount case where connectedCallback
    // raced ahead of the lifecycle.  Either way the invariant
    // ("don't drop an unsaved draft on the floor") holds.
    if (this.draft.length > 0) return;
    const persisted = loadDigestDraft(this.campaignSlug);
    if (!persisted) return;
    this.draft = persisted.markdown;
    this.generatedByResponseId = persisted.generatedByResponseId;
  }

  private schedulePersistDraft(): void {
    if (!this.campaignSlug) return;
    if (this.digestDraftSaveTimer !== null) {
      clearTimeout(this.digestDraftSaveTimer);
    }
    this.digestDraftSaveTimer = setTimeout(() => {
      this.digestDraftSaveTimer = null;
      this.persistDraftNow();
    }, SessionDigest.DIGEST_DRAFT_DEBOUNCE_MS);
  }

  private persistDraftNow(): void {
    if (!this.campaignSlug) return;
    if (this.draft.trim().length === 0) {
      // Empty/whitespace-only drafts mean "cleared" — wipe the
      // persisted entry rather than write an empty blob.
      clearDigestDraft(this.campaignSlug);
      return;
    }
    saveDigestDraft(this.campaignSlug, {
      markdown: this.draft,
      generatedByResponseId: this.generatedByResponseId
    });
  }

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
      ${canCoord && this.showBackupChip && !hasDraft && !this.generating
        ? this.renderBackupChip()
        : nothing}
    </section>`;
  }

  /**
   * OP-037 (run #9, M6a-FS-2): the backup-chip surface.
   *
   * Renders ONLY when:
   * - The viewer is the DM (canCoord).
   * - showBackupChip is true (host has decided feature is
   *   available — DM role + browser supports FS API or other
   *   future backup destination).
   * - The DM is NOT currently editing a draft (don't yank them
   *   out of mid-edit).
   * - No generation in progress.
   *
   * Dispatches `session-digest-open-operational-view` (bubbles +
   * composed) when clicked.  Host listens, sets appMode.
   */
  private renderBackupChip(): TemplateResult {
    return html`<div
      class="session-digest-backup-chip"
      data-testid="session-digest-backup-chip"
    >
      <p class="muted session-digest-backup-blurb">
        Back up tonight's session?
      </p>
      <button
        type="button"
        class="session-digest-backup-action"
        @click=${() => this.dispatchOpenOperationalView()}
      >
        Open backups…
      </button>
    </div>`;
  }

  private dispatchOpenOperationalView(): void {
    this.dispatchEvent(
      new CustomEvent('session-digest-open-operational-view', {
        bubbles: true,
        composed: true
      })
    );
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
        <div class="session-digest-prior-md">
          ${unsafeHTML(renderMarkdown(latest.markdown))}
        </div>
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
                    <div class="session-digest-prior-md">
                      ${unsafeHTML(renderMarkdown(d.markdown))}
                    </div>
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
                // Run #15 (UX-5): autosave the draft so a tab close
                // mid-edit doesn't lose the DM's recap.
                this.schedulePersistDraft();
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
        // Run #15 (UX-5): a fresh AI generation IS a draft — persist
        // immediately so a reload right after generation surfaces
        // the same body.
        this.schedulePersistDraft();
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
      // Run #15 (UX-5): also clear the persisted draft so a future
      // reload doesn't surface the now-saved recap as a "fresh"
      // draft (which would lure the DM into saving it twice).
      if (this.campaignSlug) clearDigestDraft(this.campaignSlug);
      if (this.digestDraftSaveTimer !== null) {
        clearTimeout(this.digestDraftSaveTimer);
        this.digestDraftSaveTimer = null;
      }
    }
  }

  private handleDiscard(): void {
    this.draft = '';
    this.errorMessage = null;
    this.generatedByResponseId = undefined;
    // Run #15 (UX-5): Discard is an explicit "throw away the
    // draft" — wipe the persisted entry too.
    if (this.campaignSlug) clearDigestDraft(this.campaignSlug);
    if (this.digestDraftSaveTimer !== null) {
      clearTimeout(this.digestDraftSaveTimer);
      this.digestDraftSaveTimer = null;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'session-digest': SessionDigest;
  }
}

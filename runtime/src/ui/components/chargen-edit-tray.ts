// @vitest-environment happy-dom

/**
 * <chargen-edit-tray> — per-row Edit/Review tray for UX-MH-2.
 *
 * Per Run #19 R-D: NOT a modal.  Modal would steal focus from the
 * cross-row comparison the DM is actually doing.  This component
 * renders inline below a chargen-dm-review row (or inline on the
 * player-side chargen surface) and exposes name / pronouns /
 * tag-chip strip / backstory textarea editors.
 *
 * Autosave throughout (400 ms debounce per R-D); NO save buttons.
 * The host wires the four `onXxxChange` callbacks to emit the
 * appropriate event (`pc-edit field:name`, `pc-edit field:pronouns`,
 * `pc-tag-add`/`-remove`/`-rename`, `pc-edit field:backstory`).
 *
 * Reused on BOTH chargen-dm-review (DM edits any PC) AND the
 * player's own chargen surface (player edits own PC).  The host
 * determines authorization gating; the component is presentational.
 *
 * Copy strings per TTRPG/UX expert memo §3.  10 strings used
 * verbatim where applicable.
 *
 * Tray opens collapsed; the "Edit" disclosure button at the top
 * controls the open state via the `open` property.  The component
 * itself is stateless on open/close — the parent owns that state
 * so it can persist across re-renders.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export interface ChargenEditTrayChange {
  /** Field that changed — 'name', 'pronouns', 'backstory'.  Not used for tag ops. */
  field?: 'name' | 'pronouns' | 'backstory';
  /** New value for name/pronouns/backstory edits. */
  value?: string;
}

export interface ChargenEditTrayTagOp {
  op: 'add' | 'remove' | 'rename';
  tagText?: string; // for add/remove
  oldTagText?: string; // for rename
  newTagText?: string; // for rename
}

@customElement('chargen-edit-tray')
export class ChargenEditTray extends LitElement {
  createRenderRoot(): this {
    return this;
  }

  /** Is the tray expanded? Host owns this state. */
  @property({ type: Boolean, reflect: true }) open = false;

  /** Current PC name. */
  @property({ attribute: false }) pcName = '';
  /** Current PC pronouns. */
  @property({ attribute: false }) pcPronouns = '';
  /** Current PC tags. */
  @property({ attribute: false }) pcTags: readonly string[] = [];
  /** Current PC backstory. */
  @property({ attribute: false }) pcBackstory = '';
  /** Maximum tags allowed (default 5 per chargen contract). */
  @property({ attribute: false }) maxTags = 5;

  /** Called when name field commits (debounced 400 ms). */
  @property({ attribute: false }) onNameChange?: (value: string) => void;
  /** Called when pronouns field commits. */
  @property({ attribute: false }) onPronounsChange?: (value: string) => void;
  /** Called when backstory textarea commits. */
  @property({ attribute: false }) onBackstoryChange?: (value: string) => void;
  /** Called on tag add/remove/rename. */
  @property({ attribute: false }) onTagOp?: (op: ChargenEditTrayTagOp) => void;
  /** Called when the player clicks "↻ Refresh backstory". */
  @property({ attribute: false }) onRefreshBackstory?: () => void;

  /**
   * Whether to show the "↻ Refresh backstory" button.  Disabled when
   * there's no current AI provider configured OR when the host wants
   * to suppress the affordance for a specific seat (e.g. a guest
   * peer w/o API key).
   */
  @property({ type: Boolean }) showRefreshButton = false;
  /** Tooltip / disabled state for the refresh button. */
  @property({ attribute: false }) refreshButtonDisabledReason?: string;

  // Inline state for the per-field debounced commit + visual ✓ pip.
  @state() private savedField: 'name' | 'pronouns' | 'backstory' | null = null;
  private debounceTimers: Map<string, number> = new Map();
  private static DEBOUNCE_MS = 400;
  /** Visible only for chip-rename in-place. */
  @state() private renamingIdx: number | null = null;
  @state() private addingTag = false;

  disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const t of this.debounceTimers.values()) {
      clearTimeout(t);
    }
    this.debounceTimers.clear();
  }

  render(): TemplateResult {
    if (!this.open) {
      return html`<button
        type="button"
        class="chargen-edit-tray-toggle"
        aria-expanded="false"
        @click=${() => this.dispatchEvent(new CustomEvent('tray-toggle'))}
      >
        Edit
      </button>`;
    }
    return html`
      <div class="chargen-edit-tray" role="region" aria-label="Edit character">
        <div class="chargen-edit-tray-disclosure-row">
          <button
            type="button"
            class="chargen-edit-tray-toggle chargen-edit-tray-toggle-open"
            aria-expanded="true"
            @click=${() => this.dispatchEvent(new CustomEvent('tray-toggle'))}
          >
            Close edit tray
          </button>
        </div>
        <p class="chargen-edit-tray-notice">
          Editing this row will be visible to the player on next render.
        </p>
        ${this.renderNameField()} ${this.renderPronounsField()}
        ${this.renderTagsField()} ${this.renderBackstoryField()}
      </div>
    `;
  }

  private renderNameField(): TemplateResult {
    return html`<label class="chargen-edit-tray-field">
      <span class="chargen-edit-tray-label">Name</span>
      <input
        type="text"
        maxlength="80"
        .value=${this.pcName}
        @input=${(e: Event) =>
          this.debounceCommit('name', (e.target as HTMLInputElement).value)}
      />
      ${this.savedPip('name')}
    </label>`;
  }

  private renderPronounsField(): TemplateResult {
    const picks = ['she/her', 'he/him', 'they/them'];
    return html`<label class="chargen-edit-tray-field">
      <span class="chargen-edit-tray-label">Pronouns</span>
      <input
        type="text"
        maxlength="40"
        .value=${this.pcPronouns}
        @input=${(e: Event) =>
          this.debounceCommit(
            'pronouns',
            (e.target as HTMLInputElement).value
          )}
      />
      <div class="chargen-edit-tray-quickpicks">
        ${picks.map(
          (p) => html`<button
            type="button"
            class="chargen-edit-tray-quickpick"
            @click=${() => this.commit('pronouns', p)}
          >
            ${p}
          </button>`
        )}
      </div>
      ${this.savedPip('pronouns')}
    </label>`;
  }

  private renderTagsField(): TemplateResult {
    const canAddMore = this.pcTags.length < this.maxTags;
    return html`<div class="chargen-edit-tray-field">
      <span class="chargen-edit-tray-label">Tags</span>
      <div class="chargen-edit-tray-tags">
        ${this.pcTags.map((t, idx) => this.renderTagChip(t, idx))}
        ${this.addingTag
          ? html`<input
              type="text"
              class="chargen-edit-tray-tag-input"
              placeholder="e.g. ICU nurse"
              maxlength="80"
              autofocus
              @keydown=${this.onAddTagKeydown}
              @blur=${this.onAddTagBlur}
            />`
          : canAddMore
            ? html`<button
                type="button"
                class="chargen-edit-tray-add-tag"
                title="Add a tag — short specifics (occupation, training, a defining experience)."
                @click=${() => {
                  this.addingTag = true;
                }}
              >
                + Add tag
              </button>`
            : nothing}
      </div>
    </div>`;
  }

  private renderTagChip(text: string, idx: number): TemplateResult {
    if (this.renamingIdx === idx) {
      return html`<input
        type="text"
        class="chargen-edit-tray-tag-rename"
        maxlength="80"
        .value=${text}
        autofocus
        @keydown=${(e: KeyboardEvent) => this.onRenameKeydown(e, idx, text)}
        @blur=${(e: FocusEvent) => this.onRenameBlur(e, idx, text)}
      />`;
    }
    return html`<span class="chargen-edit-tray-tag">
      <button
        type="button"
        class="chargen-edit-tray-tag-text"
        title="Click to rename"
        @click=${() => {
          this.renamingIdx = idx;
        }}
      >
        ${text}
      </button>
      <button
        type="button"
        class="chargen-edit-tray-tag-remove"
        aria-label="Remove this tag"
        title="Remove this tag"
        @click=${() => this.removeTag(text)}
      >
        ×
      </button>
    </span>`;
  }

  private renderBackstoryField(): TemplateResult {
    return html`<div class="chargen-edit-tray-field">
      <span class="chargen-edit-tray-label">Backstory</span>
      <textarea
        class="chargen-edit-tray-backstory"
        rows="14"
        maxlength="8000"
        @input=${(e: Event) =>
          this.debounceCommit(
            'backstory',
            (e.target as HTMLTextAreaElement).value
          )}
      >${this.pcBackstory}</textarea>
      <p class="chargen-edit-tray-backstory-hint">
        Voice belongs to the player. Fix names, pronouns, and fit — pass
        anything bigger through Refresh below.
      </p>
      ${this.savedPip('backstory')}
      ${this.showRefreshButton
        ? html`<button
            type="button"
            class="chargen-edit-tray-refresh"
            title=${this.refreshButtonDisabledReason ??
            'Threads recent edits (name, pronouns, tags) through the prose. Does not regenerate from scratch.'}
            ?disabled=${!!this.refreshButtonDisabledReason}
            @click=${() => this.onRefreshBackstory?.()}
          >
            ↻ Refresh backstory
          </button>`
        : nothing}
    </div>`;
  }

  private savedPip(field: 'name' | 'pronouns' | 'backstory'): TemplateResult | typeof nothing {
    if (this.savedField !== field) return nothing;
    return html`<span class="chargen-edit-tray-saved" aria-live="polite">
      ✓ saved
    </span>`;
  }

  private debounceCommit(
    field: 'name' | 'pronouns' | 'backstory',
    value: string
  ): void {
    const prior = this.debounceTimers.get(field);
    if (prior !== undefined) clearTimeout(prior);
    const t = window.setTimeout(() => {
      this.commit(field, value);
    }, ChargenEditTray.DEBOUNCE_MS) as unknown as number;
    this.debounceTimers.set(field, t);
  }

  private commit(
    field: 'name' | 'pronouns' | 'backstory',
    value: string
  ): void {
    if (field === 'name') this.onNameChange?.(value);
    if (field === 'pronouns') this.onPronounsChange?.(value);
    if (field === 'backstory') this.onBackstoryChange?.(value);
    this.savedField = field;
    // Fade the pip after a moment.
    window.setTimeout(() => {
      if (this.savedField === field) this.savedField = null;
    }, 1200);
  }

  private removeTag(tagText: string): void {
    // Per R-D: ZERO confirmation throughout.  Reversible by re-adding.
    this.onTagOp?.({ op: 'remove', tagText });
  }

  private onAddTagKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      const v = input.value.trim();
      if (v.length > 0) {
        this.onTagOp?.({ op: 'add', tagText: v });
      }
      this.addingTag = false;
    } else if (e.key === 'Escape') {
      this.addingTag = false;
    }
  };

  private onAddTagBlur = (e: FocusEvent): void => {
    const input = e.target as HTMLInputElement;
    const v = input.value.trim();
    if (v.length > 0) {
      this.onTagOp?.({ op: 'add', tagText: v });
    }
    this.addingTag = false;
  };

  private onRenameKeydown = (
    e: KeyboardEvent,
    idx: number,
    oldText: string
  ): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      const v = input.value.trim();
      if (v.length > 0 && v !== oldText) {
        this.onTagOp?.({ op: 'rename', oldTagText: oldText, newTagText: v });
      }
      this.renamingIdx = null;
    } else if (e.key === 'Escape') {
      this.renamingIdx = null;
    }
    void idx;
  };

  private onRenameBlur = (
    e: FocusEvent,
    idx: number,
    oldText: string
  ): void => {
    const input = e.target as HTMLInputElement;
    const v = input.value.trim();
    if (v.length > 0 && v !== oldText) {
      this.onTagOp?.({ op: 'rename', oldTagText: oldText, newTagText: v });
    }
    this.renamingIdx = null;
    void idx;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'chargen-edit-tray': ChargenEditTray;
  }
}

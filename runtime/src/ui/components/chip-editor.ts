// @vitest-environment happy-dom

/**
 * <chip-editor> — reusable list-of-chips with add/remove affordances.
 *
 * Phase 3b extraction (2026-05-25) per Engineering-R5.  The chargen
 * surface renders two near-identical chip lists (tags + skill
 * categories); P-R5 Stage roster will want filter chips.  Pulling
 * the shape into a primitive avoids the third copy and replaces a
 * UX-R4-flagged singleton-state bug (the previous `addingChip`
 * @state was per-component, so opening tag-add on PC1 silently
 * closed tag-add on PC2).
 *
 * Contract:
 *
 *   <chip-editor
 *     class="chargen-dm-review-chips chargen-dm-review-tags"
 *     aria-label="Tags"
 *     kind="text"
 *     labelAdd="+ tag"
 *     ?editable=${true}
 *     ?dedupe=${true}
 *     .items=${tags}
 *     .onAdd=${(v) => host.commitTagAdd(v)}
 *     .onRemove=${(i) => host.handleTagRemove(i)}
 *   ></chip-editor>
 *
 *   <chip-editor
 *     class="chargen-dm-review-chips chargen-dm-review-skills"
 *     kind="select"
 *     labelAdd="+ skill"
 *     ?editable=${true}
 *     .items=${skills}
 *     .options=${QUIRE_SKILL_CATEGORIES}
 *     .onAdd=${(v) => host.commitSkillAdd(v)}
 *     .onRemove=${(i) => host.handleSkillRemove(i)}
 *   ></chip-editor>
 *
 * Behavior:
 *   - When `editable` is false (default), chips render as plain
 *     spans; no × button, no add affordance.
 *   - When editable + onAdd is wired: trailing "+ tag" / "+ skill"
 *     button opens an inline input (text kind) or <select> dropdown
 *     (select kind).  Enter commits; Esc cancels; blur commits.
 *   - When editable + onRemove is wired: each chip gets a × button
 *     that fires onRemove(idx).
 *   - When `dedupe` is true, committing an existing item is a no-op
 *     (caller doesn't need to filter).
 *   - When kind='select' and all `options` are already in `items`,
 *     the add affordance hides (no point opening a dropdown with
 *     nothing to pick).
 *   - Add state is per-instance — opening tag-add on one chip-editor
 *     does NOT close it on another (UX-R4 #4 fix).
 *
 * Styling:
 *   - The host element's own `class` attribute passes through, so
 *     existing per-region CSS (chargen-dm-review-tags etc.) keeps
 *     working unchanged.
 *   - Internal markup uses the same classes the chargen-dm-review
 *     CSS already targets (chargen-dm-review-chip,
 *     chargen-dm-review-chip-editable, chargen-dm-review-chip-text,
 *     chargen-dm-review-chip-remove, chargen-dm-review-chip-add,
 *     chargen-dm-review-chip-input).  Phase 3b polish (M2 region
 *     theme migration) will eventually rename to a primitive
 *     namespace.
 *   - Pass `chipClass` to add a class to every chip (e.g.
 *     "chargen-dm-review-chip-skill" for the skill row).
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('chip-editor')
export class ChipEditor extends LitElement {
  /** Light-DOM render so callers' CSS reaches without ::slotted. */
  createRenderRoot(): this {
    return this;
  }

  @property({ attribute: false }) items: readonly string[] = [];

  /**
   * Free-text input (`'text'`) or constrained dropdown (`'select'`).
   * Select mode requires `options` to be set.
   */
  @property() kind: 'text' | 'select' = 'text';

  /** Choices for select mode; ignored in text mode. */
  @property({ attribute: false }) options: readonly string[] = [];

  /** Add-button label, e.g. "+ tag" or "+ skill". */
  @property() labelAdd: string = '+ add';

  /** Aria-label for the add button (and dropdown when select). */
  @property() labelAriaAdd: string = 'Add an item';

  /**
   * Aria-label template for the per-chip × button.  The chip text
   * is interpolated as the second token: e.g. "Remove tag X".
   */
  @property() labelAriaRemoveTemplate: string = 'Remove item {0}';

  /**
   * Optional class added to each chip — used by callers that need a
   * specific selector (e.g. `chargen-dm-review-chip-skill`).
   */
  @property() chipClass: string = '';

  /** When false (default), display-only: no × buttons, no add. */
  @property({ type: Boolean }) editable = false;

  /** When true, committing an existing value is a no-op. */
  @property({ type: Boolean }) dedupe = false;

  /** Placeholder for the text input (kind=text). */
  @property() placeholder: string = '';

  @property({ attribute: false })
  onAdd: ((value: string) => void) | null = null;

  @property({ attribute: false })
  onRemove: ((idx: number) => void) | null = null;

  /**
   * Per-instance add-affordance open state.  Fixes the UX-R4 #4
   * singleton bug: opening add on one chip-editor no longer closes
   * add on another.
   */
  @state() private isAddingOpen = false;

  override render(): TemplateResult {
    const editable = this.editable && !!this.onAdd && !!this.onRemove;
    const chipBase = this.chipClass
      ? `chargen-dm-review-chip ${this.chipClass}`
      : 'chargen-dm-review-chip';
    const editableChipBase = `${chipBase} chargen-dm-review-chip-editable`;
    const unused =
      this.kind === 'select'
        ? this.options.filter((o) => !this.items.includes(o))
        : [];
    return html`
      ${this.items.map((text, idx) =>
        editable
          ? html`<span class=${editableChipBase}>
              <span class="chargen-dm-review-chip-text">${text}</span>
              <button
                type="button"
                class="chargen-dm-review-chip-remove"
                title="Remove ${text}"
                aria-label=${this.labelAriaRemoveTemplate.replace('{0}', text)}
                @click=${() => this.handleRemove(idx)}
              >
                ×
              </button>
            </span>`
          : html`<span class=${chipBase}>${text}</span>`
      )}
      ${editable
        ? this.renderAddAffordance(unused)
        : nothing}
    `;
  }

  private renderAddAffordance(
    unused: readonly string[]
  ): TemplateResult | typeof nothing {
    if (this.kind === 'select' && unused.length === 0) {
      // Nothing left to pick; hide the affordance.
      return nothing;
    }
    if (this.isAddingOpen) {
      if (this.kind === 'select') {
        return html`<select
          class="chargen-dm-review-chip-input chargen-dm-review-chip-input-skill"
          aria-label=${this.labelAriaAdd}
          autofocus
          @change=${(e: Event) =>
            this.commitAdd((e.target as HTMLSelectElement).value)}
          @blur=${() => {
            this.isAddingOpen = false;
          }}
        >
          <option value="">— pick one —</option>
          ${unused.map((c) => html`<option value=${c}>${c}</option>`)}
        </select>`;
      }
      return html`<input
        type="text"
        class="chargen-dm-review-chip-input chargen-dm-review-chip-input-tag"
        placeholder=${this.placeholder}
        autofocus
        aria-label=${this.labelAriaAdd}
        @keydown=${(e: KeyboardEvent) => this.handleInputKey(e)}
        @blur=${(e: FocusEvent) =>
          this.commitAdd((e.target as HTMLInputElement).value)}
      />`;
    }
    return html`<button
      type="button"
      class="chargen-dm-review-chip chargen-dm-review-chip-add"
      title=${this.labelAriaAdd}
      aria-label=${this.labelAriaAdd}
      @click=${() => {
        this.isAddingOpen = true;
      }}
    >
      ${this.labelAdd}
    </button>`;
  }

  private handleInputKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.commitAdd((e.target as HTMLInputElement).value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.isAddingOpen = false;
    }
  }

  private commitAdd(raw: string): void {
    const value = raw.trim();
    if (value.length === 0) {
      this.isAddingOpen = false;
      return;
    }
    if (this.dedupe && this.items.includes(value)) {
      this.isAddingOpen = false;
      return;
    }
    this.onAdd?.(value);
    this.isAddingOpen = false;
  }

  private handleRemove(idx: number): void {
    this.onRemove?.(idx);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chip-editor': ChipEditor;
  }
}

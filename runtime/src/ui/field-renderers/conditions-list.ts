// @vitest-environment happy-dom

/**
 * <conditions-list> — Phase B P1d (2026-05-26) renderer for the
 * PC's active conditions array (rules.md:121-123 fictional
 * modifiers from the DM / cast costs / tag effects).
 *
 * Each Condition has: name + effect + source enum
 * (fiction/cast/tag/item) + scope enum
 * (scene/persistent/until-rest/until-released) + appliedTs.  This
 * surface shows them as a chip list grouped by scope so the DM
 * can quickly scan "what's affecting this PC right now."
 *
 * Read-only by default.  Add/remove is deferred (same array-write
 * issue as foci); the host emits a release callback that a future
 * pc-edit slice can handle when array ops land.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Condition } from '../../character-loader';

/**
 * Release-a-condition callback.  Host translates into a pc-edit
 * (when array writes land) or NO-OPs for now.  Identifies the
 * target condition by index.
 */
export type ReleaseConditionCallback = (
  pcId: string,
  conditionIndex: number
) => void;

const SCOPE_LABEL: Record<NonNullable<Condition['scope']>, string> = {
  scene: 'this scene',
  persistent: 'persistent',
  'until-rest': 'until rest',
  'until-released': 'until released'
};

@customElement('conditions-list')
export class ConditionsList extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) conditions: Condition[] = [];

  /** Non-null → release button renders per condition. */
  @property() editablePcId: string | null = null;

  @property({ attribute: false }) onRelease:
    | ReleaseConditionCallback
    | null = null;

  override render(): TemplateResult {
    if (this.conditions.length === 0) return html``;
    return html`
      <section class="conditions-list">
        <h3>Conditions</h3>
        <ul class="conditions-list-items">
          ${this.conditions.map((c, i) => this.renderItem(c, i))}
        </ul>
      </section>
    `;
  }

  private renderItem(condition: Condition, index: number): TemplateResult {
    const source = condition.source ?? 'fiction';
    const scope = condition.scope ?? 'persistent';
    const editable = this.editablePcId !== null && this.onRelease !== null;
    return html`<li
      class="conditions-list-item conditions-list-source-${source}"
    >
      <header class="conditions-list-head">
        <strong class="conditions-list-name">${condition.name}</strong>
        <span class="conditions-list-source-tag muted">${source}</span>
        <span class="conditions-list-scope-tag muted"
          >${SCOPE_LABEL[scope]}</span
        >
        ${editable
          ? html`<button
              type="button"
              class="conditions-list-release"
              title="Release this condition"
              @click=${() =>
                this.onRelease?.(this.editablePcId!, index)}
            >
              ✕
            </button>`
          : nothing}
      </header>
      <p class="conditions-list-effect">${condition.effect}</p>
    </li>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'conditions-list': ConditionsList;
  }
}

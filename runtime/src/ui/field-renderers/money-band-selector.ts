// @vitest-environment happy-dom

/**
 * <money-band-selector> — Phase B P1d (2026-05-26) renderer for
 * the `moneyBand` field.  Quire treats wealth as a 5-tier
 * fictional band, not a numeric currency (rules.md "no farming" +
 * theater-of-the-mind).  This component renders the 5 bands as a
 * radio strip so the DM (or player at chargen) picks the right
 * tier for tier-adjudication ("can you afford this?").
 *
 * Bands: broke / tight / comfortable / well-off / wealthy.
 *
 * Read-only mode renders only the selected band as a chip.
 * Editable mode renders the full radio strip + an aria-labeled
 * legend.  Fires `onSetBand` with the new value on click.
 */

import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { MoneyBand } from '../../character-loader';

const BAND_ORDER: readonly MoneyBand[] = [
  'broke',
  'tight',
  'comfortable',
  'well-off',
  'wealthy'
] as const;

const BAND_TOOLTIPS: Readonly<Record<MoneyBand, string>> = {
  broke: 'broke — barely scraping by; bus fare is a decision',
  tight: 'tight — daily groceries OK; a new coat is a stretch',
  comfortable: 'comfortable — rent + food + small luxuries',
  'well-off': 'well-off — discretionary travel; furnished apt',
  wealthy: 'wealthy — second home; staff; can hide assets'
} as const;

export type SetMoneyBandCallback = (
  pcId: string,
  band: MoneyBand
) => void;

@customElement('money-band-selector')
export class MoneyBandSelector extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Current band; undefined → no chip in read-only, no preselect in editable. */
  @property() value: MoneyBand | '' = '';

  /** Non-null → radio strip; null → read-only chip. */
  @property() editablePcId: string | null = null;

  @property({ attribute: false }) onSetBand: SetMoneyBandCallback | null =
    null;

  override render(): TemplateResult {
    if (this.editablePcId === null || !this.onSetBand) {
      return this.renderReadOnly();
    }
    return this.renderEditable();
  }

  private renderReadOnly(): TemplateResult {
    if (!this.value) {
      return html``;
    }
    return html`<p class="money-band-selector money-band-selector-readonly">
      <span class="money-band-selector-label">Money:</span>
      <span
        class="money-band-selector-chip money-band-selector-chip-${this.value}"
        title=${BAND_TOOLTIPS[this.value]}
        >${this.value}</span
      >
    </p>`;
  }

  private renderEditable(): TemplateResult {
    return html`<fieldset class="money-band-selector money-band-selector-editable">
      <legend>Money</legend>
      ${BAND_ORDER.map((band) => this.renderOption(band))}
    </fieldset>`;
  }

  private renderOption(band: MoneyBand): TemplateResult {
    const checked = this.value === band;
    return html`<label
      class="money-band-selector-option money-band-selector-chip-${band} ${checked
        ? 'money-band-selector-option-checked'
        : ''}"
      title=${BAND_TOOLTIPS[band]}
    >
      <input
        type="radio"
        name=${`money-band-${this.editablePcId ?? 'pc'}`}
        ?checked=${checked}
        @change=${() => this.onSetBand?.(this.editablePcId!, band)}
      />
      <span>${band}</span>
    </label>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'money-band-selector': MoneyBandSelector;
  }
}

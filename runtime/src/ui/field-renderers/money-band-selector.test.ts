// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './money-band-selector';
import type { MoneyBandSelector } from './money-band-selector';
import type { MoneyBand } from '../../character-loader';

function mount(props: Partial<MoneyBandSelector> = {}): MoneyBandSelector {
  const el = document.createElement(
    'money-band-selector'
  ) as MoneyBandSelector;
  if (props.value !== undefined) el.value = props.value;
  if (props.editablePcId !== undefined) el.editablePcId = props.editablePcId;
  if (props.onSetBand !== undefined) el.onSetBand = props.onSetBand;
  document.body.appendChild(el);
  return el;
}

describe('<money-band-selector>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders nothing when value is empty + read-only', async () => {
    const el = mount({ value: '', editablePcId: null });
    await el.updateComplete;
    expect(el.textContent?.trim()).toBe('');
  });

  it('read-only: renders a chip with current band', async () => {
    const el = mount({ value: 'tight', editablePcId: null });
    await el.updateComplete;
    expect(el.querySelector('.money-band-selector-readonly')).not.toBeNull();
    expect(el.querySelector('.money-band-selector-chip-tight')).not.toBeNull();
    expect(el.textContent).toMatch(/tight/);
  });

  it('editable: renders 5 radio options', async () => {
    const el = mount({
      value: 'comfortable',
      editablePcId: 'mei',
      onSetBand: () => {}
    });
    await el.updateComplete;
    const radios = el.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]'
    );
    expect(radios.length).toBe(5);
  });

  it('editable: pre-selects the current band', async () => {
    const el = mount({
      value: 'well-off',
      editablePcId: 'mei',
      onSetBand: () => {}
    });
    await el.updateComplete;
    const radios = el.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]'
    );
    // BAND_ORDER: broke, tight, comfortable, well-off, wealthy
    expect(radios[0].checked).toBe(false);
    expect(radios[3].checked).toBe(true);
    expect(radios[4].checked).toBe(false);
  });

  it('editable: clicking a radio fires onSetBand with the new band', async () => {
    const calls: Array<[string, MoneyBand]> = [];
    const el = mount({
      value: 'tight',
      editablePcId: 'mei',
      onSetBand: (pcId, band) => {
        calls.push([pcId, band]);
      }
    });
    await el.updateComplete;
    const radios = el.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]'
    );
    // Click "wealthy" (last).
    radios[4].click();
    expect(calls).toEqual([['mei', 'wealthy']]);
  });

  it('editable: no onSetBand → falls back to read-only render', async () => {
    const el = mount({
      value: 'broke',
      editablePcId: 'mei',
      onSetBand: null
    });
    await el.updateComplete;
    expect(el.querySelector('input[type="radio"]')).toBeNull();
    expect(el.querySelector('.money-band-selector-readonly')).not.toBeNull();
  });

  it('every band carries a distinct CSS class for theming', async () => {
    const bands: MoneyBand[] = [
      'broke',
      'tight',
      'comfortable',
      'well-off',
      'wealthy'
    ];
    for (const band of bands) {
      const el = mount({ value: band, editablePcId: null });
      await el.updateComplete;
      expect(
        el.querySelector(`.money-band-selector-chip-${band}`)
      ).not.toBeNull();
      el.remove();
    }
  });
});

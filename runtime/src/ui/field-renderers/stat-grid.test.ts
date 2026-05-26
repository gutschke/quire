// @vitest-environment happy-dom

/**
 * <stat-grid> tests — Phase B P1d (2026-05-26).
 *
 * Mirrors track-bar.test.ts template per the planning-expert
 * recommendation.  Covers: read-only render, editable bumpers,
 * STAT_MIN/MAX disabled gates, default + custom rule-hover text,
 * bumper click dispatch.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import './stat-grid';
import type { StatGrid, StatKey } from './stat-grid';
import { DEFAULT_STAT_RULES } from './stat-grid';

function mount(props: Partial<StatGrid> = {}): StatGrid {
  const el = document.createElement('stat-grid') as StatGrid;
  if (props.stats !== undefined) el.stats = props.stats;
  if (props.editablePcId !== undefined) el.editablePcId = props.editablePcId;
  if (props.onBumpStat !== undefined) el.onBumpStat = props.onBumpStat;
  if (props.ruleText !== undefined) el.ruleText = props.ruleText;
  document.body.appendChild(el);
  return el;
}

describe('<stat-grid>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders six stat rows in canonical order', async () => {
    const el = mount({
      stats: { str: 1, dex: 0, con: -1, int: 2, wis: 0, cha: -2 }
    });
    await el.updateComplete;
    const dts = el.querySelectorAll('dt');
    expect(dts.length).toBe(6);
    expect(dts[0].textContent?.trim()).toMatch(/STR/);
    expect(dts[1].textContent?.trim()).toMatch(/DEX/);
    expect(dts[2].textContent?.trim()).toMatch(/CON/);
    expect(dts[3].textContent?.trim()).toMatch(/INT/);
    expect(dts[4].textContent?.trim()).toMatch(/WIS/);
    expect(dts[5].textContent?.trim()).toMatch(/CHA/);
  });

  it('formats positive modifiers with leading "+" and negative with "-"', async () => {
    const el = mount({
      stats: { str: 2, dex: 0, con: -1, int: 3, wis: -3 }
    });
    await el.updateComplete;
    const dds = el.querySelectorAll('dd');
    expect(dds[0].textContent?.trim()).toMatch(/\+2/);
    expect(dds[1].textContent?.trim()).toMatch(/\+0/);
    expect(dds[2].textContent?.trim()).toMatch(/-1/);
    expect(dds[3].textContent?.trim()).toMatch(/\+3/);
    expect(dds[4].textContent?.trim()).toMatch(/-3/);
  });

  it('renders missing stats as em-dash placeholder', async () => {
    const el = mount({ stats: { str: 1 } }); // others missing
    await el.updateComplete;
    const dds = el.querySelectorAll('dd');
    expect(dds[0].textContent?.trim()).toMatch(/\+1/);
    expect(dds[1].textContent?.trim()).toMatch(/—/);
    expect(dds[5].textContent?.trim()).toMatch(/—/);
  });

  it('hides bumpers when editablePcId is null (read-only)', async () => {
    const el = mount({
      stats: { str: 1 },
      editablePcId: null,
      onBumpStat: () => {}
    });
    await el.updateComplete;
    expect(el.querySelector('.stat-bumpers')).toBeNull();
  });

  it('hides bumpers when onBumpStat is null', async () => {
    const el = mount({
      stats: { str: 1 },
      editablePcId: 'mei',
      onBumpStat: null
    });
    await el.updateComplete;
    expect(el.querySelector('.stat-bumpers')).toBeNull();
  });

  it('shows bumpers and fires onBumpStat on +/- click', async () => {
    const calls: Array<[string, StatKey, number, number]> = [];
    const el = mount({
      stats: { str: 1 },
      editablePcId: 'mei',
      onBumpStat: (pcId, key, current, delta) => {
        calls.push([pcId, key, current, delta]);
      }
    });
    await el.updateComplete;
    const buttons = el.querySelectorAll<HTMLButtonElement>(
      '.stat-bumpers button'
    );
    expect(buttons.length).toBe(12); // 6 stats × 2 buttons
    // First row's "−" (decrement)
    buttons[0].click();
    // First row's "+" (increment)
    buttons[1].click();
    expect(calls).toEqual([
      ['mei', 'str', 1, -1],
      ['mei', 'str', 1, +1]
    ]);
  });

  it('disables decrement at STAT_MIN', async () => {
    const el = mount({
      stats: { str: -3 },
      editablePcId: 'mei',
      onBumpStat: () => {}
    });
    await el.updateComplete;
    const buttons = el.querySelectorAll<HTMLButtonElement>(
      '.stat-bumpers button'
    );
    expect(buttons[0].disabled).toBe(true); // first row "−"
    expect(buttons[1].disabled).toBe(false); // first row "+"
  });

  it('disables increment at STAT_MAX', async () => {
    const el = mount({
      stats: { str: 3 },
      editablePcId: 'mei',
      onBumpStat: () => {}
    });
    await el.updateComplete;
    const buttons = el.querySelectorAll<HTMLButtonElement>(
      '.stat-bumpers button'
    );
    expect(buttons[0].disabled).toBe(false); // first row "−"
    expect(buttons[1].disabled).toBe(true); // first row "+"
  });

  it('wraps each label in <rule-hover> with the default rule text', async () => {
    const el = mount({ stats: { str: 1 } });
    await el.updateComplete;
    const ruleHovers = el.querySelectorAll('rule-hover');
    expect(ruleHovers.length).toBe(6);
    expect(
      (ruleHovers[0] as unknown as { text: string }).text
    ).toBe(DEFAULT_STAT_RULES.str);
    expect(
      (ruleHovers[3] as unknown as { text: string }).text
    ).toBe(DEFAULT_STAT_RULES.int);
  });

  it('honors a custom ruleText prop (engine-vs-campaign override)', async () => {
    const custom = {
      str: 'STR — body mass',
      dex: 'DEX — quickness',
      con: 'CON — endurance',
      int: 'INT — brain',
      wis: 'WIS — intuition',
      cha: 'CHA — charm'
    };
    const el = mount({ stats: { str: 1 }, ruleText: custom });
    await el.updateComplete;
    const ruleHovers = el.querySelectorAll('rule-hover');
    expect(
      (ruleHovers[0] as unknown as { text: string }).text
    ).toBe('STR — body mass');
    expect(
      (ruleHovers[4] as unknown as { text: string }).text
    ).toBe('WIS — intuition');
  });

  it('passes pcId through to onBumpStat for the editable case', async () => {
    let receivedPcId = '';
    const el = mount({
      stats: { dex: 0 },
      editablePcId: 'reggie',
      onBumpStat: (pcId) => {
        receivedPcId = pcId;
      }
    });
    await el.updateComplete;
    const buttons = el.querySelectorAll<HTMLButtonElement>(
      '.stat-bumpers button'
    );
    // Row 2 (DEX) increment is index 3.
    buttons[3].click();
    expect(receivedPcId).toBe('reggie');
  });
});

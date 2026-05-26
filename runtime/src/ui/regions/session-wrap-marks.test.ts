// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './session-wrap-marks';
import {
  buildWrapMarksEntries,
  type SessionWrapMarks
} from './session-wrap-marks';
import type { AdvancementMarkBullets } from '../../character-loader';

function mount(props: Partial<SessionWrapMarks> = {}): SessionWrapMarks {
  const el = document.createElement(
    'session-wrap-marks'
  ) as SessionWrapMarks;
  if (props.pcs !== undefined) el.pcs = props.pcs;
  if (props.onSetMarkBullet !== undefined)
    el.onSetMarkBullet = props.onSetMarkBullet;
  if (props.onExit !== undefined) el.onExit = props.onExit;
  document.body.appendChild(el);
  return el;
}

describe('<session-wrap-marks>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders empty state when no PCs', async () => {
    const el = mount({ pcs: [] });
    await el.updateComplete;
    expect(el.textContent).toMatch(/No active PCs/);
  });

  it('renders one card per PC with 5 bullet checkboxes', async () => {
    const el = mount({
      pcs: [
        { pcId: 'mei', name: 'Mei', bullets: {} },
        { pcId: 'reggie', name: 'Reggie', bullets: {} }
      ]
    });
    await el.updateComplete;
    const cards = el.querySelectorAll('.session-wrap-marks-pc');
    expect(cards.length).toBe(2);
    const checkboxes = el.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]'
    );
    expect(checkboxes.length).toBe(10); // 2 PCs × 5 bullets
  });

  it('renders counter showing X/5 and "Y more" copy', async () => {
    const el = mount({
      pcs: [
        {
          pcId: 'mei',
          name: 'Mei',
          bullets: { hardMoment: true, learned: true, risk: false }
        }
      ]
    });
    await el.updateComplete;
    const counter = el.querySelector('.session-wrap-marks-counter');
    expect(counter?.textContent).toMatch(/2\/5/);
    expect(counter?.textContent).toMatch(/3 more/);
  });

  it('shows "advancement ready" when 5 bullets are ticked', async () => {
    const el = mount({
      pcs: [
        {
          pcId: 'mei',
          name: 'Mei',
          bullets: {
            hardMoment: true,
            learned: true,
            risk: true,
            against: true,
            complication: true
          }
        }
      ]
    });
    await el.updateComplete;
    const counter = el.querySelector('.session-wrap-marks-counter');
    expect(counter?.textContent).toMatch(/advancement ready/);
    expect(
      counter?.classList.contains('session-wrap-marks-counter-ready')
    ).toBe(true);
  });

  it('pre-checks the boxes for bullets already ticked', async () => {
    const el = mount({
      pcs: [
        {
          pcId: 'mei',
          name: 'Mei',
          bullets: { hardMoment: true, risk: true }
        }
      ]
    });
    await el.updateComplete;
    const cbs = el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    // BULLET_KEYS: hardMoment, learned, risk, against, complication
    expect(cbs[0].checked).toBe(true);
    expect(cbs[1].checked).toBe(false);
    expect(cbs[2].checked).toBe(true);
    expect(cbs[3].checked).toBe(false);
  });

  it('clicking a checkbox fires onSetMarkBullet with the new value', async () => {
    const calls: Array<[string, keyof AdvancementMarkBullets, boolean]> = [];
    const el = mount({
      pcs: [{ pcId: 'mei', name: 'Mei', bullets: {} }],
      onSetMarkBullet: (pcId, bullet, value) => {
        calls.push([pcId, bullet, value]);
      }
    });
    await el.updateComplete;
    const cbs = el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    cbs[0].click();
    cbs[2].click();
    expect(calls).toEqual([
      ['mei', 'hardMoment', true],
      ['mei', 'risk', true]
    ]);
  });

  it('checkboxes disabled when no onSetMarkBullet callback', async () => {
    const el = mount({
      pcs: [{ pcId: 'mei', name: 'Mei', bullets: {} }],
      onSetMarkBullet: null
    });
    await el.updateComplete;
    const cbs = el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(cbs[0].disabled).toBe(true);
  });

  it('exit button only renders when onExit is provided', async () => {
    let exited = false;
    const el = mount({
      pcs: [{ pcId: 'mei', name: 'Mei', bullets: {} }],
      onExit: () => {
        exited = true;
      }
    });
    await el.updateComplete;
    const btn = el.querySelector<HTMLButtonElement>(
      '.session-wrap-marks-exit'
    );
    expect(btn).not.toBeNull();
    btn!.click();
    expect(exited).toBe(true);
    // Now without onExit.
    el.remove();
    const el2 = mount({ pcs: [], onExit: null });
    await el2.updateComplete;
    expect(el2.querySelector('.session-wrap-marks-exit')).toBeNull();
  });
});

describe('buildWrapMarksEntries', () => {
  it('builds entries in pcIds order, skipping missing records', () => {
    const records = {
      mei: {
        $schemaVersion: '0.1.0',
        name: 'Mei Tanaka'
      },
      reggie: {
        $schemaVersion: '0.1.0',
        name: 'Reggie Okeke'
      }
    };
    const bullets = { mei: { hardMoment: true }, missing: { learned: true } };
    const entries = buildWrapMarksEntries(
      records,
      bullets,
      ['mei', 'missing', 'reggie']
    );
    expect(entries.length).toBe(2);
    expect(entries[0].pcId).toBe('mei');
    expect(entries[0].name).toBe('Mei Tanaka');
    expect(entries[0].bullets.hardMoment).toBe(true);
    expect(entries[1].pcId).toBe('reggie');
    expect(entries[1].bullets).toEqual({});
  });

  it('falls back to pcId for name when record.name is missing', () => {
    const records = {
      mei: { $schemaVersion: '0.1.0' } as unknown as Parameters<
        typeof buildWrapMarksEntries
      >[0][string]
    };
    const entries = buildWrapMarksEntries(records, {}, ['mei']);
    expect(entries[0].name).toBe('mei');
  });
});

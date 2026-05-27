// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './magic-arc-controls';
import type {
  MagicArcControls,
  MagicArcControlsView
} from './magic-arc-controls';

function mount(view: MagicArcControlsView | null): MagicArcControls {
  const el = document.createElement('magic-arc-controls') as MagicArcControls;
  el.view = view;
  document.body.appendChild(el);
  return el;
}

describe('<magic-arc-controls> (Wave C5 extraction)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders nothing when view is null', async () => {
    const el = mount(null);
    await el.updateComplete;
    expect(el.querySelector('.dm-pc-detail-arc-controls')).toBeNull();
  });

  it('renders nothing when no callback is wired (non-coord viewer)', async () => {
    const el = mount({ pcId: 'mei', pcName: 'Mei', magicPhase: 'accidental' });
    await el.updateComplete;
    expect(el.querySelector('.dm-pc-detail-arc-controls')).toBeNull();
  });

  it('renders arc-controls section when at least one callback is wired', async () => {
    const el = mount({ pcId: 'mei', pcName: 'Mei', magicPhase: 'accidental' });
    el.onLogAccidentalGrant = () => true;
    await el.updateComplete;
    expect(el.querySelector('.dm-pc-detail-arc-controls')).not.toBeNull();
  });

  it('log-grant commit fires onLogAccidentalGrant with pcId + trimmed note', async () => {
    const calls: Array<[string, string]> = [];
    const el = mount({ pcId: 'mei', pcName: 'Mei', magicPhase: 'accidental' });
    el.onLogAccidentalGrant = (pcId, note) => {
      calls.push([pcId, note]);
      return true;
    };
    await el.updateComplete;
    const textarea = el.querySelector(
      '.dm-pc-detail-arc-text'
    ) as HTMLTextAreaElement;
    textarea.value = '   keys came to her hand a moment too easily   ';
    textarea.dispatchEvent(new Event('input'));
    await el.updateComplete;
    const commitBtn = el.querySelector(
      '.dm-pc-detail-arc-commit'
    ) as HTMLButtonElement;
    commitBtn.click();
    expect(calls).toEqual([
      ['mei', 'keys came to her hand a moment too easily']
    ]);
    // Successful commit clears the draft.
    await el.updateComplete;
    expect(textarea.value).toBe('');
  });

  it('grant-focus only renders when magicPhase >= realization (TTRPG firewall)', async () => {
    const el = mount({
      pcId: 'mei',
      pcName: 'Mei',
      magicPhase: 'accidental'
    });
    el.onGrantFocus = () => true;
    await el.updateComplete;
    expect(
      el.querySelector('input[placeholder^="Focus name"]')
    ).toBeNull();
    // Flip to realization → form appears.
    el.view = {
      pcId: 'mei',
      pcName: 'Mei',
      magicPhase: 'realization',
      knowsTheyCanCast: true
    };
    await el.updateComplete;
    expect(
      el.querySelector('input[placeholder^="Focus name"]')
    ).not.toBeNull();
  });

  it('mark-realization renders only when knowsTheyCanCast is not true', async () => {
    const el = mount({
      pcId: 'mei',
      pcName: 'Mei',
      magicPhase: 'accidental',
      knowsTheyCanCast: false
    });
    el.onMarkRealization = () => true;
    await el.updateComplete;
    expect(el.querySelector('.dm-pc-detail-arc-realize')).not.toBeNull();
    // After realization: button hidden.
    el.view = {
      pcId: 'mei',
      pcName: 'Mei',
      magicPhase: 'realization',
      knowsTheyCanCast: true
    };
    await el.updateComplete;
    expect(el.querySelector('.dm-pc-detail-arc-realize')).toBeNull();
  });

  it('release-tax renders only when tax.active is true', async () => {
    const el = mount({
      pcId: 'mei',
      pcName: 'Mei',
      magicPhase: 'tax',
      knowsTheyCanCast: true,
      tax: { active: true, sessionsRemaining: 2 }
    });
    el.onReleaseTax = () => true;
    await el.updateComplete;
    expect(el.textContent).toMatch(/Release the tax/);
    // Tax dropped: form gone.
    el.view = {
      pcId: 'mei',
      pcName: 'Mei',
      magicPhase: 'tax',
      knowsTheyCanCast: true,
      tax: { active: false }
    };
    await el.updateComplete;
    expect(el.textContent).not.toMatch(/Release the tax/);
  });

  it('Wave B verifier-S1 (preserved in extraction): drafts wipe on view.pcId change', async () => {
    // CRITICAL regression — the willUpdate guard must move WITH
    // the drafts (per practice memo).  Without this, typing Mei's
    // silent grant then navigating to Iris would commit Mei's
    // text against Iris's pcId.
    const calls: Array<[string, string]> = [];
    const el = mount({ pcId: 'mei', pcName: 'Mei', magicPhase: 'accidental' });
    el.onLogAccidentalGrant = (pcId, note) => {
      calls.push([pcId, note]);
      return true;
    };
    await el.updateComplete;
    const meiTextarea = el.querySelector(
      '.dm-pc-detail-arc-text'
    ) as HTMLTextAreaElement;
    meiTextarea.value = 'Mei found her keys';
    meiTextarea.dispatchEvent(new Event('input'));
    await el.updateComplete;
    // Navigate to Iris.
    el.view = { pcId: 'iris', pcName: 'Iris', magicPhase: 'accidental' };
    await el.updateComplete;
    const irisTextarea = el.querySelector(
      '.dm-pc-detail-arc-text'
    ) as HTMLTextAreaElement;
    expect(irisTextarea.value).toBe('');
    const commitBtn = el.querySelector(
      '.dm-pc-detail-arc-commit'
    ) as HTMLButtonElement;
    expect(commitBtn.disabled).toBe(true);
    expect(calls).toEqual([]);
  });

  it('Wave B verifier-S2 (preserved): Realization confirm flag resets across pcId change', async () => {
    const el = mount({ pcId: 'mei', pcName: 'Mei', magicPhase: 'accidental' });
    el.onMarkRealization = () => true;
    await el.updateComplete;
    const realizeBtn = el.querySelector(
      '.dm-pc-detail-arc-realize'
    ) as HTMLButtonElement;
    realizeBtn.click();
    await el.updateComplete;
    expect(el.querySelector('.dm-pc-detail-arc-confirm')).not.toBeNull();
    el.view = { pcId: 'iris', pcName: 'Iris', magicPhase: 'accidental' };
    await el.updateComplete;
    expect(el.querySelector('.dm-pc-detail-arc-confirm')).toBeNull();
  });
});

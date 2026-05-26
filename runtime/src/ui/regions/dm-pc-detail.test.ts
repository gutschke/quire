// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './dm-pc-detail';
import type { DmPcDetail, DmDetailView } from './dm-pc-detail';

function mount(view: DmDetailView | null): DmPcDetail {
  const el = document.createElement('dm-pc-detail') as DmPcDetail;
  el.view = view;
  document.body.appendChild(el);
  return el;
}

describe('<dm-pc-detail>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders nothing when view is null', async () => {
    const el = mount(null);
    await el.updateComplete;
    expect(el.querySelector('.dm-pc-detail')).toBeNull();
  });

  it('renders empty-state card when view has only pcName', async () => {
    const el = mount({ pcName: 'Mei' });
    await el.updateComplete;
    expect(el.querySelector('.dm-pc-detail')).not.toBeNull();
    expect(el.textContent).toMatch(/No DM-only state/);
  });

  it('renders magic-arc section when magicPhase + knowsTheyCanCast set', async () => {
    const el = mount({
      pcName: 'Mei',
      magicPhase: 'realization',
      knowsTheyCanCast: true
    });
    await el.updateComplete;
    expect(el.textContent).toMatch(/Magic arc/);
    expect(el.textContent).toMatch(/Realization/);
    expect(el.textContent).toMatch(/post-Realization/);
  });

  it('renders tax section when tax is set', async () => {
    const el = mount({
      pcName: 'Mei',
      tax: { active: true, sessionsRemaining: 2, releaseMoment: 'face Yui' }
    });
    await el.updateComplete;
    expect(el.textContent).toMatch(/Trying-too-hard tax/);
    expect(el.textContent).toMatch(/active/);
    expect(el.textContent).toMatch(/face Yui/);
  });

  it('renders thread-debt section', async () => {
    const el = mount({
      pcName: 'Mei',
      threadDebt: { rung: 'watched', spamCount: 2 }
    });
    await el.updateComplete;
    expect(el.textContent).toMatch(/Antagonist attention/);
    expect(el.textContent).toMatch(/Watched/);
    expect(el.textContent).toMatch(/Spam count/);
  });

  it('renders alignment-drift section with 5 pips', async () => {
    const el = mount({
      pcName: 'Mei',
      alignmentDrift: { marks: 3 }
    });
    await el.updateComplete;
    expect(el.textContent).toMatch(/Alignment drift/);
    const filled = el.querySelectorAll('.dm-pc-detail-drift-pip-filled');
    expect(filled.length).toBe(3);
    const total = el.querySelectorAll('.dm-pc-detail-drift-pip');
    expect(total.length).toBe(5);
  });

  it('renders accidental-grants when array non-empty', async () => {
    const el = mount({
      pcName: 'Mei',
      accidentalGrants: [
        { ts: 1700000000000, note: 'silent nudge at the cafe' }
      ]
    });
    await el.updateComplete;
    expect(el.textContent).toMatch(/Silent grants/);
    expect(el.textContent).toMatch(/silent nudge at the cafe/);
  });

  it('omits accidental-grants section when array empty', async () => {
    const el = mount({
      pcName: 'Mei',
      accidentalGrants: []
    });
    await el.updateComplete;
    expect(el.textContent).not.toMatch(/Silent grants/);
  });

  it('renders dmNotes section when present', async () => {
    const el = mount({
      pcName: 'Mei',
      dmNotes: 'remember the cabinet code is 5519'
    });
    await el.updateComplete;
    expect(el.textContent).toMatch(/DM notes/);
    expect(el.textContent).toMatch(/cabinet code/);
  });

  it('omits dmNotes section when empty string', async () => {
    const el = mount({ pcName: 'Mei', dmNotes: '' });
    await el.updateComplete;
    expect(el.textContent).not.toMatch(/DM notes/);
  });

  it('full kitchen-sink view renders every section', async () => {
    const el = mount({
      pcName: 'Mei',
      magicPhase: 'tax',
      knowsTheyCanCast: true,
      tax: { active: true, sessionsRemaining: 1 },
      threadDebt: { rung: 'hunted' },
      alignmentDrift: { marks: 4 },
      accidentalGrants: [{ ts: 0, note: 'cafe' }],
      dmNotes: 'note'
    });
    await el.updateComplete;
    const sections = el.querySelectorAll('.dm-pc-detail-section');
    // magic-arc, tax, thread-debt, alignment-drift, accidental-grants, dm-notes
    expect(sections.length).toBe(6);
  });
});

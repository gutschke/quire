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
    const el = mount({ pcId: 'mei', pcName: 'Mei' });
    await el.updateComplete;
    expect(el.querySelector('.dm-pc-detail')).not.toBeNull();
    expect(el.textContent).toMatch(/No DM-only state/);
  });

  it('renders magic-arc section when magicPhase + knowsTheyCanCast set', async () => {
    const el = mount({
      pcId: 'mei', pcName: 'Mei',
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
      pcId: 'mei', pcName: 'Mei',
      tax: { active: true, sessionsRemaining: 2, releaseMoment: 'face Yui' }
    });
    await el.updateComplete;
    expect(el.textContent).toMatch(/Trying-too-hard tax/);
    expect(el.textContent).toMatch(/active/);
    expect(el.textContent).toMatch(/face Yui/);
  });

  it('renders thread-debt section (read-only, Wave C4 split persistent vs live spam)', async () => {
    const el = mount({
      pcId: 'mei',
      pcName: 'Mei',
      threadDebt: { rung: 'watched', spamCount: 2 }
    });
    await el.updateComplete;
    expect(el.textContent).toMatch(/Antagonist attention/);
    expect(el.textContent).toMatch(/Watched/);
    // Wave C4: label is now "Persistent spam count" — the
    // character-record field is the cross-scene counter, distinct
    // from the live shared-state caster-state spam chip that the
    // DM resets at scene boundaries.
    expect(el.textContent).toMatch(/Persistent spam count/);
  });

  it('renders alignment-drift section with 5 pips', async () => {
    const el = mount({
      pcId: 'mei', pcName: 'Mei',
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
      pcId: 'mei', pcName: 'Mei',
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
      pcId: 'mei', pcName: 'Mei',
      accidentalGrants: []
    });
    await el.updateComplete;
    expect(el.textContent).not.toMatch(/Silent grants/);
  });

  it('renders dmNotes section when present', async () => {
    const el = mount({
      pcId: 'mei', pcName: 'Mei',
      dmNotes: 'remember the cabinet code is 5519'
    });
    await el.updateComplete;
    expect(el.textContent).toMatch(/DM notes/);
    expect(el.textContent).toMatch(/cabinet code/);
  });

  it('omits dmNotes section when empty string', async () => {
    const el = mount({ pcId: 'mei', pcName: 'Mei', dmNotes: '' });
    await el.updateComplete;
    expect(el.textContent).not.toMatch(/DM notes/);
  });

  it('full kitchen-sink view renders every section', async () => {
    const el = mount({
      pcId: 'mei', pcName: 'Mei',
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

  // ---- Wave C4 (2026-05-26) thread-debt + reset-spam (consolidated from dm-aside) ----

  it('Wave C4: thread-debt section gains an inline selector when onSetThreadDebt is wired', async () => {
    const el = mount({
      pcId: 'mei',
      pcName: 'Mei',
      threadDebt: { rung: 'watched' }
    });
    el.onSetThreadDebt = () => {};
    await el.updateComplete;
    const sel = el.querySelector(
      '.dm-pc-detail-thread-debt-select'
    ) as HTMLSelectElement;
    expect(sel).not.toBeNull();
    // Current rung 'watched' is selected.
    const watched = sel.querySelector<HTMLOptionElement>(
      'option[value="watched"]'
    );
    expect(watched?.hasAttribute('selected')).toBe(true);
  });

  it('Wave C4: selector change invokes onSetThreadDebt with pcId + level', async () => {
    let received: { pcId: string; level: string } | null = null;
    const el = mount({
      pcId: 'mei',
      pcName: 'Mei',
      threadDebt: { rung: 'quiet' }
    });
    el.onSetThreadDebt = (pcId, level) => {
      received = { pcId, level };
    };
    await el.updateComplete;
    const sel = el.querySelector(
      '.dm-pc-detail-thread-debt-select'
    ) as HTMLSelectElement;
    sel.value = 'hunted';
    sel.dispatchEvent(new Event('change'));
    expect(received).toEqual({ pcId: 'mei', level: 'hunted' });
  });

  it('Wave C4: selector empty-string clears the rung', async () => {
    let received: { pcId: string; level: string } | null = null;
    const el = mount({
      pcId: 'mei',
      pcName: 'Mei',
      threadDebt: { rung: 'noticed' }
    });
    el.onSetThreadDebt = (pcId, level) => {
      received = { pcId, level };
    };
    await el.updateComplete;
    const sel = el.querySelector(
      '.dm-pc-detail-thread-debt-select'
    ) as HTMLSelectElement;
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
    expect(received).toEqual({ pcId: 'mei', level: '' });
  });

  it('Wave C4: reset-spam chip renders when casterState.spamCount > 0 + callback wired', async () => {
    const el = mount({
      pcId: 'mei',
      pcName: 'Mei',
      threadDebt: { rung: 'noticed' }
    });
    el.casterState = {
      ladder: 'noticed',
      spamCount: 3
    } as unknown as import('../../core/state').CasterState;
    el.onResetSpamCounter = () => {};
    await el.updateComplete;
    const btn = el.querySelector('.dm-pc-detail-spam-reset') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toMatch(/3 casts this scene/);
  });

  it('Wave C4: reset-spam chip click invokes onResetSpamCounter with pcId', async () => {
    let received: string | null = null;
    const el = mount({ pcId: 'mei', pcName: 'Mei' });
    el.casterState = {
      ladder: 'quiet',
      spamCount: 1
    } as unknown as import('../../core/state').CasterState;
    el.onResetSpamCounter = (pcId) => {
      received = pcId;
    };
    await el.updateComplete;
    const btn = el.querySelector('.dm-pc-detail-spam-reset') as HTMLButtonElement;
    btn.click();
    expect(received).toBe('mei');
  });

  it('Wave C4: thread-debt section renders even on a PC with no prior debt — DM can set initial rung', async () => {
    // The consolidation: the only place the DM sets thread-debt is
    // now dm-pc-detail.  If the section only rendered when
    // threadDebt was already set, the DM could never bootstrap a
    // PC into a non-quiet state from this surface.  Guard ensures
    // the section appears for any coord viewer.
    const el = mount({ pcId: 'mei', pcName: 'Mei' });
    el.onSetThreadDebt = () => {};
    await el.updateComplete;
    expect(el.textContent).toMatch(/Antagonist attention/);
    const sel = el.querySelector(
      '.dm-pc-detail-thread-debt-select'
    ) as HTMLSelectElement;
    expect(sel).not.toBeNull();
    // Default 'none' option is selected.
    const none = sel.querySelector<HTMLOptionElement>('option[value=""]');
    expect(none?.hasAttribute('selected')).toBe(true);
  });

  // ---- Wave B (2026-05-26) magic-arc DM runtime controls ----

  it('Wave B: no arc-controls section when host wires no callbacks (non-coord viewer)', async () => {
    const el = mount({ pcId: 'mei', pcName: 'Mei', magicPhase: 'accidental' });
    await el.updateComplete;
    expect(el.querySelector('.dm-pc-detail-arc-controls')).toBeNull();
  });

  it('Wave B: log-silent-grant + commit fires onLogAccidentalGrant with pcId + trimmed note', async () => {
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
    expect(textarea).not.toBeNull();
    textarea.value = '   found her keys exactly when she needed them  ';
    textarea.dispatchEvent(new Event('input'));
    await el.updateComplete;
    const commitBtn = el.querySelector(
      '.dm-pc-detail-arc-commit'
    ) as HTMLButtonElement;
    commitBtn.click();
    expect(calls).toEqual([
      ['mei', 'found her keys exactly when she needed them']
    ]);
  });

  it('Wave B: grant-focus only renders when phase >= realization', async () => {
    const el = mount({
      pcId: 'mei',
      pcName: 'Mei',
      magicPhase: 'accidental'
    });
    el.onGrantFocus = () => true;
    await el.updateComplete;
    // Phase=accidental: grant-focus form NOT in DOM (placeholder is
    // unique to that form).
    expect(
      el.querySelector(
        'input[placeholder^="Focus name"]'
      )
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

  it('Wave B verifier-S1: drafts are wiped when view.pcId changes (no cross-PC leak)', async () => {
    const calls: Array<[string, string]> = [];
    const el = mount({ pcId: 'mei', pcName: 'Mei', magicPhase: 'accidental' });
    el.onLogAccidentalGrant = (pcId, note) => {
      calls.push([pcId, note]);
      return true;
    };
    await el.updateComplete;
    // Type into Mei's silent-grant textarea but don't commit.
    const meiTextarea = el.querySelector(
      '.dm-pc-detail-arc-text'
    ) as HTMLTextAreaElement;
    meiTextarea.value = 'Mei found her keys';
    meiTextarea.dispatchEvent(new Event('input'));
    await el.updateComplete;
    // Navigate to Iris.
    el.view = { pcId: 'iris', pcName: 'Iris', magicPhase: 'accidental' };
    await el.updateComplete;
    // Iris's textarea must be empty — NOT carry Mei's draft.
    const irisTextarea = el.querySelector(
      '.dm-pc-detail-arc-text'
    ) as HTMLTextAreaElement;
    expect(irisTextarea.value).toBe('');
    // Commit on Iris's empty form is a no-op (button disabled).
    const commitBtn = el.querySelector(
      '.dm-pc-detail-arc-commit'
    ) as HTMLButtonElement;
    expect(commitBtn.disabled).toBe(true);
    expect(calls).toEqual([]);
  });

  it('Wave B verifier-S1: Realization confirm dialog state resets across pcId change', async () => {
    const el = mount({ pcId: 'mei', pcName: 'Mei', magicPhase: 'accidental' });
    el.onMarkRealization = () => true;
    await el.updateComplete;
    const realizeBtn = el.querySelector(
      '.dm-pc-detail-arc-realize'
    ) as HTMLButtonElement;
    realizeBtn.click();
    await el.updateComplete;
    expect(el.querySelector('.dm-pc-detail-arc-confirm')).not.toBeNull();
    // Navigate away.
    el.view = { pcId: 'iris', pcName: 'Iris', magicPhase: 'accidental' };
    await el.updateComplete;
    // Iris's view does NOT carry Mei's confirm-Realization panel.
    expect(el.querySelector('.dm-pc-detail-arc-confirm')).toBeNull();
  });
});

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './diff-review-stage';
import type { DiffReviewStage, DiffProposalView } from './diff-review-stage';

function mount(): DiffReviewStage {
  const el = document.createElement('diff-review-stage') as DiffReviewStage;
  document.body.appendChild(el);
  return el;
}

function makeProposal(over: Partial<DiffProposalView> = {}): DiffProposalView {
  return {
    id: 'prop-001',
    npcId: 'yui-tanaka',
    path: 'characters/npcs/yui-tanaka.json',
    field: 'disposition',
    before: 'friendly-distant',
    after: 'friendly-warm; recognized PC1',
    rationale: 'PC1 was kind to Yui at the SFO gate',
    sourceEventIds: ['e-101', 'e-102'],
    ...over
  };
}

describe('<diff-review-stage>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders empty state for player viewer (no callbacks) with no proposals', async () => {
    const el = mount();
    await el.updateComplete;
    expect(el.querySelector('.diff-review-empty')).not.toBeNull();
    expect(el.querySelector('.diff-review-generate')).toBeNull();
  });

  it('renders Generate button for coord viewer', async () => {
    const el = mount();
    el.onGenerate = async () => ({ ok: true, created: 0, responseId: 'r' });
    el.onAccept = async () => ({ ok: true });
    el.onReject = () => true;
    await el.updateComplete;
    expect(el.querySelector('.diff-review-generate')).not.toBeNull();
  });

  it('renders queue + card + context panes when proposals are present', async () => {
    const el = mount();
    el.proposals = [makeProposal()];
    el.onAccept = async () => ({ ok: true });
    el.onReject = () => true;
    await el.updateComplete;
    expect(el.querySelector('.diff-review-queue')).not.toBeNull();
    expect(el.querySelector('.diff-review-card')).not.toBeNull();
    expect(el.querySelector('.diff-review-context')).not.toBeNull();
    expect(el.querySelector('.diff-review-card-head h4')?.textContent).toMatch(
      /yui-tanaka.*disposition/
    );
  });

  it('marks DM-only fields with the warm rail class', async () => {
    const el = mount();
    el.proposals = [makeProposal({ id: 'p-dm', field: 'dmNotes', after: 'private' })];
    el.onAccept = async () => ({ ok: true });
    el.onReject = () => true;
    await el.updateComplete;
    expect(el.querySelector('.diff-review-card-dm-only')).not.toBeNull();
    expect(el.querySelector('.diff-review-queue-item-dm-only')).not.toBeNull();
    expect(el.querySelector('.diff-review-card-rail')?.textContent).toMatch(
      /DM-only/
    );
  });

  it('accept button invokes onAccept with the proposal id', async () => {
    const el = mount();
    el.proposals = [makeProposal()];
    let acceptedId: string | undefined;
    el.onAccept = async (id) => {
      acceptedId = id;
      return { ok: true };
    };
    el.onReject = () => true;
    await el.updateComplete;
    (el.querySelector('.diff-review-accept') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(acceptedId).toBe('prop-001');
  });

  it('reject button invokes onReject', async () => {
    const el = mount();
    el.proposals = [makeProposal()];
    let rejectedId: string | undefined;
    el.onAccept = async () => ({ ok: true });
    el.onReject = (id) => {
      rejectedId = id;
      return true;
    };
    await el.updateComplete;
    (el.querySelector('.diff-review-reject') as HTMLButtonElement).click();
    expect(rejectedId).toBe('prop-001');
  });

  it('editing the after-textarea + accept passes the edited value', async () => {
    const el = mount();
    el.proposals = [makeProposal()];
    let captured: { id: string; edited: unknown } | null = null;
    el.onAccept = async (id, edited) => {
      captured = { id, edited };
      return { ok: true };
    };
    el.onReject = () => true;
    await el.updateComplete;
    const ta = el.querySelector(
      '.diff-review-edit-textarea'
    ) as HTMLTextAreaElement;
    ta.value = 'DM-edited final value';
    ta.dispatchEvent(new Event('input'));
    await el.updateComplete;
    (el.querySelector('.diff-review-accept') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(captured).toEqual({
      id: 'prop-001',
      edited: 'DM-edited final value'
    });
  });

  it('j / k hotkeys advance and retreat the selectedIdx', async () => {
    const el = mount();
    el.proposals = [
      makeProposal({ id: 'p1' }),
      makeProposal({ id: 'p2', field: 'description' }),
      makeProposal({ id: 'p3', field: 'voice' })
    ];
    el.onAccept = async () => ({ ok: true });
    el.onReject = () => true;
    await el.updateComplete;
    // Initial: p1 selected.
    expect(el.querySelector('.diff-review-card-head h4')?.textContent).toMatch(
      /disposition/
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    await el.updateComplete;
    expect(el.querySelector('.diff-review-card-head h4')?.textContent).toMatch(
      /description/
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    await el.updateComplete;
    expect(el.querySelector('.diff-review-card-head h4')?.textContent).toMatch(
      /voice/
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    await el.updateComplete;
    expect(el.querySelector('.diff-review-card-head h4')?.textContent).toMatch(
      /description/
    );
  });

  it('"a" hotkey accepts the selected proposal', async () => {
    const el = mount();
    el.proposals = [makeProposal()];
    let acceptCount = 0;
    el.onAccept = async () => {
      acceptCount++;
      return { ok: true };
    };
    el.onReject = () => true;
    await el.updateComplete;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    await el.updateComplete;
    expect(acceptCount).toBe(1);
  });

  it('"r" hotkey rejects the selected proposal', async () => {
    const el = mount();
    el.proposals = [makeProposal()];
    let rejectCount = 0;
    el.onAccept = async () => ({ ok: true });
    el.onReject = () => {
      rejectCount++;
      return true;
    };
    await el.updateComplete;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    await el.updateComplete;
    expect(rejectCount).toBe(1);
  });

  it('does not hijack j/k/a/r when typing in the textarea', async () => {
    const el = mount();
    el.proposals = [
      makeProposal({ id: 'p1' }),
      makeProposal({ id: 'p2', field: 'description' })
    ];
    let acceptCount = 0;
    el.onAccept = async () => {
      acceptCount++;
      return { ok: true };
    };
    el.onReject = () => true;
    await el.updateComplete;
    const ta = el.querySelector(
      '.diff-review-edit-textarea'
    ) as HTMLTextAreaElement;
    ta.focus();
    // Simulate keydown FROM the textarea — the listener should
    // bail out without advancing.
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    );
    await el.updateComplete;
    expect(acceptCount).toBe(0);
    expect(el.querySelector('.diff-review-card-head h4')?.textContent).toMatch(
      /disposition/
    );
  });

  it('selectedIdx clamps when proposals shrink', async () => {
    const el = mount();
    el.proposals = [
      makeProposal({ id: 'p1' }),
      makeProposal({ id: 'p2', field: 'description' }),
      makeProposal({ id: 'p3', field: 'voice' })
    ];
    el.onAccept = async () => ({ ok: true });
    el.onReject = () => true;
    await el.updateComplete;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    await el.updateComplete;
    // Now on p3.  Shrink proposals to just p1.
    el.proposals = [makeProposal({ id: 'p1' })];
    await el.updateComplete;
    expect(el.querySelector('.diff-review-card-head h4')?.textContent).toMatch(
      /disposition/
    );
  });

  it('renders source-event ids in the context pane', async () => {
    const el = mount();
    el.proposals = [makeProposal({ sourceEventIds: ['e-101', 'e-102'] })];
    el.onAccept = async () => ({ ok: true });
    el.onReject = () => true;
    await el.updateComplete;
    const sources = el.querySelector('.diff-review-sources');
    expect(sources).not.toBeNull();
    expect(sources?.textContent).toMatch(/e-101/);
    expect(sources?.textContent).toMatch(/e-102/);
  });

  it('surfaces apply-failed error from acceptDiffProposal', async () => {
    const el = mount();
    el.proposals = [makeProposal()];
    el.onAccept = async () => ({
      ok: false,
      code: 'apply-failed',
      message: 'stale-base-sha: regenerate the proposal'
    });
    el.onReject = () => true;
    await el.updateComplete;
    (el.querySelector('.diff-review-accept') as HTMLButtonElement).click();
    for (let i = 0; i < 5; i++) {
      await el.updateComplete;
      if (el.querySelector('.diff-review-error')) break;
      await Promise.resolve();
    }
    expect(el.querySelector('.diff-review-error')?.textContent).toMatch(
      /stale-base-sha/
    );
  });
});

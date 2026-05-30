// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import './backstory-refresh-inbox';
import type {
  BackstoryRefreshInbox,
  PendingBackstoryRefreshProposal
} from './backstory-refresh-inbox';

function makeInbox(
  props: Partial<BackstoryRefreshInbox> = {}
): BackstoryRefreshInbox {
  const el = document.createElement(
    'backstory-refresh-inbox'
  ) as BackstoryRefreshInbox;
  el.currentBackstory = 'Mei grew up by the Underleaf.';
  el.currentBackstoryHash = 'CURRENT';
  el.pcDisplayName = 'Mei';
  el.playerSafeChangeSummary = 'pronouns';
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
}

const baseProposal: PendingBackstoryRefreshProposal = {
  pcId: 'mei',
  proposedBackstory: 'Mei grew up by the Underleaf. They climb.',
  baselineHash: 'CURRENT',
  initiator: 'dm',
  ts: 0
};

describe('<backstory-refresh-inbox>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders nothing when no proposal is pending', async () => {
    const el = makeInbox({ proposal: null });
    await el.updateComplete;
    expect(el.querySelector('.backstory-refresh-inbox-card')).toBeNull();
  });

  it('renders the DM-initiated header copy verbatim', async () => {
    const el = makeInbox({ proposal: baseProposal });
    await el.updateComplete;
    expect(el.textContent).toContain('Your DM has a backstory suggestion');
    expect(el.textContent).toContain(
      "Your DM updated pronouns for Mei and asks if you'd like the backstory threaded through to match."
    );
  });

  it('renders the inline-diff component for the proposal', async () => {
    const el = makeInbox({ proposal: baseProposal });
    await el.updateComplete;
    expect(el.querySelector('inline-diff')).not.toBeNull();
  });

  it('Accept button fires onAccept', async () => {
    const onAccept = vi.fn();
    const el = makeInbox({ proposal: baseProposal, onAccept });
    await el.updateComplete;
    (
      el.querySelector('.backstory-refresh-inbox-accept') as HTMLButtonElement
    ).click();
    expect(onAccept).toHaveBeenCalled();
  });

  it('Reject button fires onReject', async () => {
    const onReject = vi.fn();
    const el = makeInbox({ proposal: baseProposal, onReject });
    await el.updateComplete;
    (
      el.querySelector('.backstory-refresh-inbox-reject') as HTMLButtonElement
    ).click();
    expect(onReject).toHaveBeenCalled();
  });

  it('staleness warning shows when proposal.baselineHash !== currentBackstoryHash', async () => {
    const el = makeInbox({
      proposal: { ...baseProposal, baselineHash: 'OLD' },
      currentBackstoryHash: 'CURRENT'
    });
    await el.updateComplete;
    expect(el.querySelector('.backstory-refresh-inbox-stale')).not.toBeNull();
    expect(el.textContent).toContain('older version');
  });

  it('no staleness warning when hashes match', async () => {
    const el = makeInbox({ proposal: baseProposal });
    await el.updateComplete;
    expect(el.querySelector('.backstory-refresh-inbox-stale')).toBeNull();
  });

  it('silent-firewall: no banner mentioning the DM, AI, spoilers, or hidden content', async () => {
    const el = makeInbox({ proposal: baseProposal });
    await el.updateComplete;
    // Per silent-player-firewall: NEVER tell the player a refresh
    // attempt was suppressed.  The card only renders SUCCESSFUL
    // proposals; refused ones are the DM's problem.
    const text = el.textContent ?? '';
    expect(text.toLowerCase()).not.toContain('spoiler');
    expect(text.toLowerCase()).not.toContain('refused');
    expect(text.toLowerCase()).not.toContain('hidden');
    expect(text.toLowerCase()).not.toContain('dm notes');
  });
});

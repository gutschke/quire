/**
 * <dm-aside> tests — pinned NPC list (post-C4 surface).
 *
 * **Wave C4 (2026-05-26):** thread-debt + bound-PC + reset-spam
 * tests removed from this file.  Those affordances moved to
 * `<dm-pc-detail>` and live in `dm-pc-detail.test.ts` now.  See
 * `design/holistic-review-2026-05-26.md` Wave C4 entry.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import './dm-aside';
import type { DmAside } from './dm-aside';

function mount(): DmAside {
  const el = document.createElement('dm-aside') as DmAside;
  document.body.appendChild(el);
  return el;
}

describe('<dm-aside>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an empty-state hint when no pins', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    await el.updateComplete;
    expect(el.innerHTML).toContain('Pin NPCs');
  });

  it('renders the pinned NPC list with names + unpin buttons', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.pinnedNpcs = ['alice', 'bob'];
    await el.updateComplete;
    expect(el.innerHTML).toContain('alice');
    expect(el.innerHTML).toContain('bob');
    expect(el.innerHTML).toMatch(/Pinned NPCs[\s\S]*2/);
    expect(el.querySelectorAll('.dm-aside-unpin').length).toBe(2);
  });

  it('unpin button invokes onUnpin with the npcId', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.pinnedNpcs = ['alice'];
    let received: string | null = null;
    el.onUnpin = (id) => {
      received = id;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.dm-aside-unpin')!.click();
    expect(received).toBe('alice');
  });

  it('D5-cleanup: renders pending bond queue when proposals present', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.pendingBondProposals = [
      {
        id: 'b1',
        pcId: 'mei',
        pcLabel: 'Mei',
        targetLabel: 'Iris',
        text: 'classmates at Berkeley',
        proposedByPeerId: 'bob',
        ts: 1700000000000
      },
      {
        id: 'b2',
        pcId: 'hadrian',
        pcLabel: 'Hadrian',
        targetLabel: 'Reggie',
        text: 'co-workers at the gate',
        proposedByPeerId: 'dave',
        ts: 1700000010000
      }
    ];
    await el.updateComplete;
    expect(el.querySelector('.dm-aside-bond-queue')).not.toBeNull();
    expect(el.innerHTML).toMatch(/Pending bond proposals/);
    expect(el.innerHTML).toMatch(/2/); // count
    expect(el.querySelectorAll('.dm-aside-bond-queue-row').length).toBe(2);
    expect(el.innerHTML).toContain('Mei');
    expect(el.innerHTML).toContain('Iris');
    expect(el.innerHTML).toContain('classmates at Berkeley');
    expect(el.innerHTML).toContain('Hadrian');
    expect(el.innerHTML).toContain('Reggie');
  });

  it('D5.5-B: renders the free-text placeholder + unresolved flag for a chargen bond', async () => {
    // A chargen placeholder bond has no real target pcId; the host
    // passes the player's typed placeholder as targetLabel +
    // unresolved:true.  The DM must SEE the placeholder text (it
    // was previously invisible) + the unresolved marker.
    const el = mount();
    el.campaignSlug = 'x/y';
    el.pendingBondProposals = [
      {
        id: 'b1',
        pcId: 'mei',
        pcLabel: 'Mei',
        targetLabel: 'the medic on our team',
        unresolved: true,
        text: 'I trust her with my life.',
        proposedByPeerId: 'bob',
        ts: 1700000000000
      }
    ];
    await el.updateComplete;
    expect(el.innerHTML).toContain('the medic on our team');
    expect(el.innerHTML).toMatch(/unresolved target/i);
    expect(
      el.querySelector('.dm-aside-bond-queue-unresolved')
    ).not.toBeNull();
  });

  it('D5.5-B: resolved bonds do NOT show the unresolved marker', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.pendingBondProposals = [
      {
        id: 'b1',
        pcId: 'mei',
        pcLabel: 'Mei',
        targetLabel: 'Iris',
        text: 'classmates',
        proposedByPeerId: 'bob',
        ts: 1700000000000
      }
    ];
    await el.updateComplete;
    expect(el.querySelector('.dm-aside-bond-queue-unresolved')).toBeNull();
  });

  it('D5.5-B: renders an amber spoiler chip when the bond text trips a token', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.pendingBondProposals = [
      {
        id: 'b1',
        pcId: 'mei',
        pcLabel: 'Mei',
        targetLabel: 'Iris',
        text: 'She knew about the Quiet before I did.',
        proposedByPeerId: 'bob',
        ts: 1700000000000,
        spoilerHits: ['quiet']
      }
    ];
    await el.updateComplete;
    expect(
      el.querySelector('.dm-aside-bond-queue-spoiler')
    ).not.toBeNull();
    expect(el.innerHTML).toMatch(/possible spoiler/i);
    expect(el.innerHTML).toContain('quiet');
  });

  it('D5.5-B: no spoiler chip when spoilerHits is absent/empty', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.pendingBondProposals = [
      {
        id: 'b1',
        pcId: 'mei',
        pcLabel: 'Mei',
        targetLabel: 'Iris',
        text: 'classmates at Berkeley',
        proposedByPeerId: 'bob',
        ts: 1700000000000
      }
    ];
    await el.updateComplete;
    expect(el.querySelector('.dm-aside-bond-queue-spoiler')).toBeNull();
  });

  it('D5-cleanup: hides bond queue section when proposals empty', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.pinnedNpcs = ['alice'];
    el.pendingBondProposals = [];
    await el.updateComplete;
    expect(el.querySelector('.dm-aside-bond-queue')).toBeNull();
  });

  it('D5-cleanup: bond queue + no pins still renders the queue card (empty-state guard)', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.pinnedNpcs = [];
    el.pendingBondProposals = [
      {
        id: 'b1',
        pcId: 'mei',
        pcLabel: 'Mei',
        targetLabel: 'Iris',
        text: 't',
        proposedByPeerId: 'bob',
        ts: 1700000000000
      }
    ];
    await el.updateComplete;
    expect(el.querySelector('.dm-aside-empty')).toBeNull();
    expect(el.querySelector('.dm-aside-bond-queue')).not.toBeNull();
  });

  it('D5-cleanup: bond queue row navigation link fires onNavigate', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.pendingBondProposals = [
      {
        id: 'b1',
        pcId: 'mei',
        pcLabel: 'Mei',
        targetLabel: 'Iris',
        text: 't',
        proposedByPeerId: 'bob',
        ts: 1700000000000
      }
    ];
    let routed: unknown = null;
    el.onNavigate = (_e, route) => {
      routed = route;
    };
    await el.updateComplete;
    const link = el.querySelector<HTMLAnchorElement>(
      '.dm-aside-bond-queue-link'
    );
    link!.click();
    expect(routed).toMatchObject({
      kind: 'character',
      characterKind: 'pc',
      characterId: 'mei'
    });
  });
});

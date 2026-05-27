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
});

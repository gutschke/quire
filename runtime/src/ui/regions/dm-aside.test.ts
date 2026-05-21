/**
 * <dm-aside> tests — pinned NPC list + thread-debt summary.
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

  it('renders an empty-state hint when no pins and no debts', async () => {
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

  it('renders orphan thread-debt rows (no peer bound) as a static badge', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.threadDebt = { yui: 'noticed', kai: 'hunted' };
    el.boundPcs = [];
    await el.updateComplete;
    expect(el.innerHTML).toContain('yui');
    expect(el.innerHTML).toContain('kai');
    expect(el.querySelector('.dm-aside-debt-hunted')).not.toBeNull();
    // Orphan rows have the orphan class.
    expect(el.querySelectorAll('.dm-aside-debt-orphan').length).toBe(2);
  });

  it('renders bound-PC rows with inline thread-debt selectors (FU-3)', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.boundPcs = [
      { pcId: 'yui', name: 'Yui', peerId: 'p1' },
      { pcId: 'kai', name: 'Kai', peerId: 'p2' }
    ];
    el.threadDebt = { yui: 'noticed' };
    el.onSetThreadDebt = () => {};
    await el.updateComplete;
    const selects = el.querySelectorAll<HTMLSelectElement>(
      '.dm-aside-debt-select'
    );
    expect(selects.length).toBe(2);
    // Yui's selector — "noticed" option has the selected attribute.
    const yuiNoticed = selects[0].querySelector<HTMLOptionElement>(
      'option[value="noticed"]'
    );
    expect(yuiNoticed?.hasAttribute('selected')).toBe(true);
    // Kai's selector — empty-string option has the selected attribute
    // (defaults to '— none —').
    const kaiNone = selects[1].querySelector<HTMLOptionElement>(
      'option[value=""]'
    );
    expect(kaiNone?.hasAttribute('selected')).toBe(true);
  });

  it('selector change invokes onSetThreadDebt with pcId + level', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.boundPcs = [{ pcId: 'yui', name: 'Yui' }];
    el.threadDebt = {};
    let received: { pcId: string; level: string } | null = null;
    el.onSetThreadDebt = (pcId, level) => {
      received = { pcId, level };
    };
    await el.updateComplete;
    const sel = el.querySelector<HTMLSelectElement>('.dm-aside-debt-select')!;
    sel.value = 'hunted';
    sel.dispatchEvent(new Event('change'));
    expect(received).toEqual({ pcId: 'yui', level: 'hunted' });
  });

  it('omits the selector when onSetThreadDebt is unset (read-only)', async () => {
    const el = mount();
    el.campaignSlug = 'x/y';
    el.boundPcs = [{ pcId: 'yui', name: 'Yui' }];
    el.threadDebt = { yui: 'watched' };
    // onSetThreadDebt left null
    await el.updateComplete;
    expect(el.querySelector('.dm-aside-debt-select')).toBeNull();
    expect(el.innerHTML).toContain('watched');
  });
});

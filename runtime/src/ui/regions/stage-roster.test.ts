// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './stage-roster';
import type { StageRoster } from './stage-roster';
import type { SeatCardSeat } from '../components/seat-card';
import type { CharacterRecord } from '../../character-loader';

function mount(): StageRoster {
  const el = document.createElement('stage-roster') as StageRoster;
  document.body.appendChild(el);
  return el;
}

function record(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    $schemaVersion: '0.1.0',
    name: 'Mei Tanaka',
    pronouns: 'she/her',
    stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
    skills: ['Tech', 'Knowledge'],
    tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
    backstory: 'X',
    harm: 0,
    stress: 0,
    foci: [],
    advancements: 0,
    marks: 0,
    ...overrides
  };
}

describe('<stage-roster>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('defaults to the Active sub-tab', async () => {
    const el = mount();
    await el.updateComplete;
    const activeTab = el.querySelector('.stage-roster-tab-active');
    expect(activeTab?.textContent).toMatch(/Active/);
  });

  it('shows tab counts derived from pcSlots state', async () => {
    const el = mount();
    el.pcSlots = {
      1: { state: 'bound-active', pcId: 'mei' },
      2: { state: 'bound-active', pcId: 'reggie' },
      3: { state: 'bound-retired', pcId: 'old-pc' },
      4: { state: 'bound-archived', pcId: 'archived-pc' }
    };
    await el.updateComplete;
    const tabs = Array.from(el.querySelectorAll('.stage-roster-tab'));
    expect(tabs[0].textContent).toMatch(/Active.*2/s);
    expect(tabs[1].textContent).toMatch(/Retired.*1/s);
    expect(tabs[2].textContent).toMatch(/Archived.*1/s);
  });

  it('Active tab renders a seat-card per bound-active seat', async () => {
    const el = mount();
    el.pcSlots = {
      1: { state: 'bound-active', pcId: 'mei' },
      2: { state: 'bound-active', pcId: 'reggie' },
      3: { state: 'bound-retired', pcId: 'old-pc' }
    };
    el.synthesizedPcs = {
      mei: record({ name: 'Mei Tanaka' }),
      reggie: record({ name: 'Reggie Okeke' })
    };
    el.displayNameLookup = (pcId) =>
      pcId === 'mei' ? 'Mei Tanaka' : pcId === 'reggie' ? 'Reggie Okeke' : null;
    await el.updateComplete;
    const cards = el.querySelectorAll('seat-card');
    expect(cards.length).toBe(2);
  });

  it('Active tile shows tags + harm/stress glance', async () => {
    const el = mount();
    el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } as SeatCardSeat };
    el.synthesizedPcs = {
      mei: record({
        name: 'Mei',
        tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
        harm: 2,
        stress: 1
      })
    };
    el.displayNameLookup = () => 'Mei';
    await el.updateComplete;
    const tile = el.querySelector('.stage-roster-item');
    expect(tile?.textContent).toMatch(/junior engineer/);
    const harm = tile?.querySelector('.stage-roster-stat-harm');
    expect(harm?.textContent).toMatch(/2/);
    const stress = tile?.querySelector('.stage-roster-stat-stress');
    expect(stress?.textContent).toMatch(/1/);
  });

  it('shows empty-state copy when Active tab has no PCs', async () => {
    const el = mount();
    el.pcSlots = {
      1: { state: 'bound-retired', pcId: 'old-pc' }
    };
    await el.updateComplete;
    expect(el.querySelector('.stage-roster-empty')?.textContent).toMatch(
      /No active PCs/
    );
  });

  it('switches to Retired tab on click', async () => {
    const el = mount();
    el.pcSlots = {
      1: { state: 'bound-active', pcId: 'mei' },
      2: {
        state: 'bound-retired',
        pcId: 'old-pc',
        inFictionRetireReason: 'left after a hard betrayal'
      } as SeatCardSeat
    };
    el.displayNameLookup = () => null;
    await el.updateComplete;
    const tabs = el.querySelectorAll<HTMLButtonElement>(
      '.stage-roster-tab'
    );
    tabs[1].click(); // Retired
    await el.updateComplete;
    const reason = el.querySelector('.stage-roster-retire-reason');
    expect(reason?.textContent).toMatch(/left after a hard betrayal/);
  });

  it('Retire callback fires from the seat-card', async () => {
    const el = mount();
    el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } as SeatCardSeat };
    el.synthesizedPcs = { mei: record() };
    el.displayNameLookup = () => 'Mei';
    const retires: number[] = [];
    el.onRetirePc = (slot) => retires.push(slot);
    await el.updateComplete;
    // The Retire button is in the seat-card; reach into the seat-card
    // child component's button.
    const retireBtn = el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-seat-retire'
    );
    expect(retireBtn).not.toBeNull();
    retireBtn!.click();
    expect(retires).toEqual([1]);
  });

  it('archived tab is empty by default', async () => {
    const el = mount();
    el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
    await el.updateComplete;
    const tabs = el.querySelectorAll<HTMLButtonElement>(
      '.stage-roster-tab'
    );
    tabs[2].click(); // Archived
    await el.updateComplete;
    expect(el.querySelector('.stage-roster-empty')?.textContent).toMatch(
      /No archived PCs/
    );
  });

  it('handles missing character data gracefully (loading state)', async () => {
    const el = mount();
    el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
    // synthesizedPcs intentionally empty
    el.displayNameLookup = () => null;
    await el.updateComplete;
    const tile = el.querySelector('.stage-roster-item');
    expect(tile?.textContent).toMatch(/Character data loading/);
  });

  // ---- Task #295: DM-private soft-notes editor ----
  describe('Task #295 — dmNotes editor', () => {
    it('hides the notes block when onSetDmNotes is null (player view)', async () => {
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      // onSetDmNotes intentionally null
      await el.updateComplete;
      expect(el.querySelector('.stage-roster-dmnotes')).toBeNull();
    });

    it('shows "Add notes" CTA when DM has no notes yet', async () => {
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      el.onSetDmNotes = () => true;
      await el.updateComplete;
      const toggle = el.querySelector('.stage-roster-dmnotes-toggle');
      expect(toggle).not.toBeNull();
      expect(toggle?.textContent).toMatch(/Add notes/);
      // Filled marker absent until notes exist.
      expect(
        el.querySelector('.stage-roster-dmnotes-toggle-filled')
      ).toBeNull();
    });

    it('shows filled indicator when dmNotes is non-empty', async () => {
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      el.dmNotesByPcId = { mei: 'remember the cabinet' };
      el.onSetDmNotes = () => true;
      await el.updateComplete;
      const toggle = el.querySelector('.stage-roster-dmnotes-toggle');
      expect(toggle?.textContent).toMatch(/Notes/);
      expect(toggle?.classList.contains('stage-roster-dmnotes-toggle-filled'))
        .toBe(true);
    });

    it('clicking the toggle opens the textarea pre-filled', async () => {
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      el.dmNotesByPcId = { mei: 'cabinet code' };
      el.onSetDmNotes = () => true;
      await el.updateComplete;
      const toggle = el.querySelector<HTMLButtonElement>(
        '.stage-roster-dmnotes-toggle'
      );
      toggle!.click();
      await el.updateComplete;
      const ta = el.querySelector<HTMLTextAreaElement>(
        '.stage-roster-dmnotes-text'
      );
      expect(ta).not.toBeNull();
      expect(ta!.value).toBe('cabinet code');
    });

    it('blurring the textarea fires onSetDmNotes with the new value', async () => {
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      el.dmNotesByPcId = { mei: 'old' };
      const calls: Array<[string, string]> = [];
      el.onSetDmNotes = (pcId, value) => {
        calls.push([pcId, value]);
        return true;
      };
      await el.updateComplete;
      el
        .querySelector<HTMLButtonElement>('.stage-roster-dmnotes-toggle')!
        .click();
      await el.updateComplete;
      const ta = el.querySelector<HTMLTextAreaElement>(
        '.stage-roster-dmnotes-text'
      )!;
      ta.value = 'new content';
      ta.dispatchEvent(new Event('blur'));
      expect(calls).toEqual([['mei', 'new content']]);
    });

    it('blur with unchanged value does NOT fire onSetDmNotes', async () => {
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      el.dmNotesByPcId = { mei: 'same' };
      const calls: Array<[string, string]> = [];
      el.onSetDmNotes = (pcId, value) => {
        calls.push([pcId, value]);
        return true;
      };
      await el.updateComplete;
      el
        .querySelector<HTMLButtonElement>('.stage-roster-dmnotes-toggle')!
        .click();
      await el.updateComplete;
      const ta = el.querySelector<HTMLTextAreaElement>(
        '.stage-roster-dmnotes-text'
      )!;
      // Value is unchanged from dmNotesByPcId.
      ta.dispatchEvent(new Event('blur'));
      expect(calls).toEqual([]);
    });

    it('per-PC toggles are independent (opening one does not open the other)', async () => {
      const el = mount();
      el.pcSlots = {
        1: { state: 'bound-active', pcId: 'mei' },
        2: { state: 'bound-active', pcId: 'reggie' }
      };
      el.synthesizedPcs = {
        mei: record(),
        reggie: record({ name: 'Reggie' })
      };
      el.displayNameLookup = (pcId) => (pcId === 'mei' ? 'Mei' : 'Reggie');
      el.onSetDmNotes = () => true;
      await el.updateComplete;
      // Click only the first PC's toggle.
      const toggles = el.querySelectorAll<HTMLButtonElement>(
        '.stage-roster-dmnotes-toggle'
      );
      toggles[0].click();
      await el.updateComplete;
      const textareas = el.querySelectorAll('.stage-roster-dmnotes-text');
      expect(textareas.length).toBe(1);
    });
  });

  // ---- P-R11: pending retire-request strip on Active tiles ----
  describe('P-R11 — DM accept/reject for pending retire requests', () => {
    function withRequest(extra?: Partial<StageRoster>): StageRoster {
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      el.pendingRetireRequests = {
        mei: {
          pcId: 'mei',
          requestingPeerName: 'Bob',
          inFictionReason: 'Mei steps away to find her sister',
          reason: 'departed'
        }
      };
      el.onAcceptRetireRequest = () => true;
      el.onRejectRetireRequest = () => true;
      if (extra) Object.assign(el, extra);
      return el;
    }

    it('hides the strip when no callbacks are wired (player view)', async () => {
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      el.pendingRetireRequests = {
        mei: {
          pcId: 'mei',
          requestingPeerName: 'Bob',
          inFictionReason: 'go',
          reason: 'departed'
        }
      };
      // onAcceptRetireRequest + onRejectRetireRequest intentionally null
      await el.updateComplete;
      expect(el.querySelector('.stage-roster-retire-req')).toBeNull();
    });

    it('renders requesting peer name + in-fiction reason', async () => {
      const el = withRequest();
      await el.updateComplete;
      const head = el.querySelector('.stage-roster-retire-req-head');
      expect(head?.textContent).toMatch(/Bob/);
      expect(head?.textContent).toMatch(/departed/);
      const reason = el.querySelector('.stage-roster-retire-req-reason');
      expect(reason?.textContent).toMatch(/sister/);
    });

    it('Accept fires onAcceptRetireRequest with the request fields', async () => {
      const calls: Array<[string, string, string]> = [];
      const el = withRequest({
        onAcceptRetireRequest: (pcId, reason, txt) => {
          calls.push([pcId, reason, txt]);
          return true;
        }
      });
      await el.updateComplete;
      el
        .querySelector<HTMLButtonElement>(
          '.stage-roster-retire-req-accept'
        )!
        .click();
      expect(calls).toEqual([
        ['mei', 'departed', 'Mei steps away to find her sister']
      ]);
    });

    it('Reject opens an inline note input and fires the reject callback', async () => {
      const calls: Array<[string, string]> = [];
      const el = withRequest({
        onRejectRetireRequest: (pcId, note) => {
          calls.push([pcId, note]);
          return true;
        }
      });
      await el.updateComplete;
      el
        .querySelector<HTMLButtonElement>(
          '.stage-roster-retire-req-reject-open'
        )!
        .click();
      await el.updateComplete;
      const input = el.querySelector<HTMLInputElement>(
        '.stage-roster-retire-req-reject-text'
      )!;
      input.value = 'one more session please';
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;
      el
        .querySelector<HTMLButtonElement>(
          '.stage-roster-retire-req-reject-submit'
        )!
        .click();
      expect(calls).toEqual([['mei', 'one more session please']]);
    });

    it('Reject cancel restores the strip without firing the callback', async () => {
      let called = false;
      const el = withRequest({
        onRejectRetireRequest: () => {
          called = true;
          return true;
        }
      });
      await el.updateComplete;
      el
        .querySelector<HTMLButtonElement>(
          '.stage-roster-retire-req-reject-open'
        )!
        .click();
      await el.updateComplete;
      el
        .querySelector<HTMLButtonElement>(
          '.stage-roster-retire-req-reject-cancel'
        )!
        .click();
      expect(called).toBe(false);
      await el.updateComplete;
      expect(
        el.querySelector('.stage-roster-retire-req-reject-text')
      ).toBeNull();
    });
  });

  // ---- P-R10: Browse NPCs sub-tab + promote ----
  describe('P-R10 — Browse NPCs sub-tab', () => {
    it('hides the NPCs tab when no NPCs and no callback', async () => {
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      await el.updateComplete;
      const tabs = el.querySelectorAll('.stage-roster-tab');
      // Active / Retired / Archived only.
      expect(tabs.length).toBe(3);
    });

    it('shows the NPCs tab when onPromoteNpc is wired', async () => {
      const el = mount();
      el.npcsList = [{ id: 'yui', name: 'Yui Tanaka' }];
      el.onPromoteNpc = () => {};
      await el.updateComplete;
      const tabs = el.querySelectorAll('.stage-roster-tab');
      expect(tabs.length).toBe(4);
      expect(tabs[3].textContent).toMatch(/NPCs.*1/s);
    });

    it('Browse NPCs tab lists each NPC with name + description', async () => {
      const el = mount();
      el.npcsList = [
        {
          id: 'yui',
          name: 'Yui Tanaka',
          description: 'A wiry archivist who claims she does not remember.'
        },
        { id: 'reggie', name: 'Reggie' }
      ];
      el.onPromoteNpc = () => {};
      await el.updateComplete;
      el
        .querySelectorAll<HTMLButtonElement>('.stage-roster-tab')[3]
        .click();
      await el.updateComplete;
      const items = el.querySelectorAll('.stage-roster-item');
      expect(items.length).toBe(2);
      expect(items[0].textContent).toMatch(/Yui Tanaka/);
      expect(items[0].textContent).toMatch(/archivist/);
    });

    it('clicking Promote fires onPromoteNpc with the npcId', async () => {
      const calls: string[] = [];
      const el = mount();
      el.npcsList = [{ id: 'yui', name: 'Yui' }];
      el.onPromoteNpc = (id) => calls.push(id);
      await el.updateComplete;
      el
        .querySelectorAll<HTMLButtonElement>('.stage-roster-tab')[3]
        .click();
      await el.updateComplete;
      el
        .querySelector<HTMLButtonElement>('.stage-roster-npc-promote')!
        .click();
      expect(calls).toEqual(['yui']);
    });

    it('shows empty-state when the NPC list is empty', async () => {
      const el = mount();
      el.onPromoteNpc = () => {};
      await el.updateComplete;
      el
        .querySelectorAll<HTMLButtonElement>('.stage-roster-tab')[3]
        .click();
      await el.updateComplete;
      expect(el.querySelector('.stage-roster-empty')?.textContent).toMatch(
        /No NPCs/
      );
    });
  });

  // ---- #301: hidden-seat firewall UI ----
  describe('#301 — hidden seats', () => {
    it('renders 🔒 badge + Reveal button on a hidden Active tile', async () => {
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      el.hiddenSeatPcIds = new Set(['mei']);
      el.onRevealSeat = () => true;
      await el.updateComplete;
      const row = el.querySelector('.stage-roster-hidden-row');
      expect(row).not.toBeNull();
      expect(row?.textContent).toMatch(/Hidden from players/);
      expect(el.querySelector('.stage-roster-hidden-reveal')).not.toBeNull();
    });

    it('clicking Reveal fires onRevealSeat with the slot integer', async () => {
      const calls: number[] = [];
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      el.hiddenSeatPcIds = new Set(['mei']);
      el.onRevealSeat = (slot) => {
        calls.push(slot);
        return true;
      };
      await el.updateComplete;
      el
        .querySelector<HTMLButtonElement>('.stage-roster-hidden-reveal')!
        .click();
      expect(calls).toEqual([1]);
    });

    it('does not render badge for visible seats', async () => {
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      el.hiddenSeatPcIds = new Set(); // empty
      el.onRevealSeat = () => true;
      await el.updateComplete;
      expect(el.querySelector('.stage-roster-hidden-row')).toBeNull();
    });

    it('Add hidden seat button renders when callback is wired', async () => {
      const calls: boolean[] = [];
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      el.onAddHiddenSeat = () => {
        calls.push(true);
        return 9;
      };
      await el.updateComplete;
      const btn = el.querySelector<HTMLButtonElement>(
        '.stage-roster-add-hidden-btn'
      );
      expect(btn).not.toBeNull();
      btn!.click();
      expect(calls).toEqual([true]);
    });

    it('Add hidden seat button hidden when no callback', async () => {
      const el = mount();
      el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } };
      el.synthesizedPcs = { mei: record() };
      el.displayNameLookup = () => 'Mei';
      await el.updateComplete;
      expect(
        el.querySelector('.stage-roster-add-hidden-btn')
      ).toBeNull();
    });
  });

  it('sorts seats by slot integer', async () => {
    const el = mount();
    el.pcSlots = {
      3: { state: 'bound-active', pcId: 'c' },
      1: { state: 'bound-active', pcId: 'a' },
      2: { state: 'bound-active', pcId: 'b' }
    };
    el.synthesizedPcs = {
      a: record({ name: 'A' }),
      b: record({ name: 'B' }),
      c: record({ name: 'C' })
    };
    el.displayNameLookup = (pcId) => pcId.toUpperCase();
    await el.updateComplete;
    const items = el.querySelectorAll('.stage-roster-item');
    expect(items[0].getAttribute('data-slot')).toBe('1');
    expect(items[1].getAttribute('data-slot')).toBe('2');
    expect(items[2].getAttribute('data-slot')).toBe('3');
  });
});

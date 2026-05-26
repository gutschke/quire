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

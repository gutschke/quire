// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './dm-roster-strip';
import type { DmRosterStrip } from './dm-roster-strip';
import type { SeatCardSeat } from '../components/seat-card';
import type { CharacterRecord } from '../../character-loader';

function mount(): DmRosterStrip {
  const el = document.createElement('dm-roster-strip') as DmRosterStrip;
  document.body.appendChild(el);
  return el;
}

function record(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    $schemaVersion: '0.1.0',
    name: 'Mei',
    pronouns: 'she/her',
    stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
    skills: ['Tech'],
    tags: ['junior engineer'],
    backstory: 'X',
    harm: 0,
    stress: 0,
    foci: [],
    advancements: 0,
    marks: 0,
    ...overrides
  };
}

describe('<dm-roster-strip>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an empty-state message when no seats exist', async () => {
    const el = mount();
    el.onAddSeat = () => 1;
    await el.updateComplete;
    expect(el.querySelector('.dm-roster-strip-empty')?.textContent).toMatch(
      /No players yet/
    );
  });

  it('renders one row per bound-active seat', async () => {
    const el = mount();
    el.pcSlots = {
      1: { state: 'bound-active', pcId: 'mei' },
      2: { state: 'bound-active', pcId: 'reggie' }
    };
    el.synthesizedPcs = { mei: record(), reggie: record({ name: 'Reggie' }) };
    el.displayNameLookup = (pcId) =>
      pcId === 'mei' ? 'Mei' : pcId === 'reggie' ? 'Reggie' : null;
    await el.updateComplete;
    const rows = el.querySelectorAll('.dm-roster-strip-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toMatch(/Mei/);
    expect(rows[1].textContent).toMatch(/Reggie/);
  });

  it('shows harm + stress mini-pips for active rows', async () => {
    const el = mount();
    el.pcSlots = { 1: { state: 'bound-active', pcId: 'mei' } as SeatCardSeat };
    el.synthesizedPcs = { mei: record({ harm: 2, stress: 3 }) };
    el.displayNameLookup = () => 'Mei';
    await el.updateComplete;
    const row = el.querySelector('.dm-roster-strip-row');
    expect(row?.textContent).toMatch(/h:2/);
    expect(row?.textContent).toMatch(/s:3/);
  });

  it('renders retired/archived rows below active, dimmed, with state tag', async () => {
    const el = mount();
    el.pcSlots = {
      1: { state: 'bound-active', pcId: 'mei' },
      2: {
        state: 'bound-retired',
        pcId: 'old',
        inFictionRetireReason: 'left'
      } as SeatCardSeat,
      3: { state: 'bound-archived', pcId: 'older' } as SeatCardSeat
    };
    el.synthesizedPcs = {
      mei: record(),
      old: record({ name: 'Old' }),
      older: record({ name: 'Older' })
    };
    el.displayNameLookup = () => null;
    await el.updateComplete;
    const dimmedRows = el.querySelectorAll('.dm-roster-strip-row-dim');
    expect(dimmedRows.length).toBe(2);
    expect(el.querySelector('.dm-roster-strip-state-retired')).not.toBeNull();
    expect(el.querySelector('.dm-roster-strip-state-archived')).not.toBeNull();
  });

  it('hides the ⊕ button when onAddSeat is null (defense-in-depth)', async () => {
    const el = mount();
    // onAddSeat intentionally null
    await el.updateComplete;
    expect(el.querySelector('.dm-roster-strip-add')).toBeNull();
  });

  it('clicking ⊕ fires onAddSeat', async () => {
    const el = mount();
    const calls: unknown[] = [];
    el.onAddSeat = () => {
      calls.push(true);
      return 1;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.dm-roster-strip-add')!.click();
    expect(calls.length).toBe(1);
  });

  it('triggerAddSeat() is callable from outside (for hotkey wiring)', async () => {
    const el = mount();
    let called = false;
    el.onAddSeat = () => {
      called = true;
      return 1;
    };
    await el.updateComplete;
    const result = el.triggerAddSeat();
    expect(called).toBe(true);
    expect(result).toBe(1);
  });

  it('rows sorted by slot integer', async () => {
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
    const rows = el.querySelectorAll('.dm-roster-strip-row');
    expect(rows[0].getAttribute('data-slot')).toBe('1');
    expect(rows[1].getAttribute('data-slot')).toBe('2');
    expect(rows[2].getAttribute('data-slot')).toBe('3');
  });
});

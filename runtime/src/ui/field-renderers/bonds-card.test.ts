// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './bonds-card';
import type { BondsCard, BondsCardEntry } from './bonds-card';

function mount(): BondsCard {
  const el = document.createElement('bonds-card') as BondsCard;
  document.body.appendChild(el);
  return el;
}

function bond(over: Partial<BondsCardEntry> = {}): BondsCardEntry {
  return {
    id: 'b1',
    targetPcId: 'iris',
    targetLabel: 'Iris',
    text: 'classmates at Berkeley',
    ...over
  };
}

describe('<bonds-card>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an empty placeholder when no bonds and read-only', async () => {
    const el = mount();
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-empty')).not.toBeNull();
  });

  it('hides the remove button in read-only mode', async () => {
    const el = mount();
    el.bonds = [bond()];
    el.onRemove = () => {};
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-remove')).toBeNull();
  });

  it('shows the remove button in coord mode (editablePcId set)', async () => {
    const el = mount();
    el.bonds = [bond()];
    el.editablePcId = 'mei';
    el.onRemove = () => {};
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-remove')).not.toBeNull();
  });

  it('renders the target name + bond text', async () => {
    const el = mount();
    el.bonds = [bond({ targetLabel: 'Iris', text: 'lab partner' })];
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-target')?.textContent).toMatch(
      /Iris/
    );
    expect(el.querySelector('.bonds-card-text')?.textContent).toMatch(
      /lab partner/
    );
  });

  it('renders dmNotes only in coord/editable mode', async () => {
    const el = mount();
    el.bonds = [bond({ dmNotes: 'Iris saw Mei cast' })];
    // Read-only — no editablePcId → dmNotes hidden.
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-dm-notes')).toBeNull();
    // Coord mode — dmNotes visible.
    el.editablePcId = 'mei';
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-dm-notes')?.textContent).toMatch(
      /Iris saw Mei cast/
    );
  });

  it('remove button invokes onRemove with the bond id', async () => {
    const el = mount();
    el.bonds = [bond({ id: 'b-removed' })];
    el.editablePcId = 'mei';
    let removed: { pcId: string; bondId: string } | null = null;
    el.onRemove = (pcId, bondId) => {
      removed = { pcId, bondId };
    };
    await el.updateComplete;
    (el.querySelector('.bonds-card-remove') as HTMLButtonElement).click();
    expect(removed).toEqual({ pcId: 'mei', bondId: 'b-removed' });
  });

  it('shows a count in the head when bonds present', async () => {
    const el = mount();
    el.bonds = [bond({ id: 'b1' }), bond({ id: 'b2' }), bond({ id: 'b3' })];
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-head h4')?.textContent).toMatch(
      /Bonds \(3\)/
    );
  });
});

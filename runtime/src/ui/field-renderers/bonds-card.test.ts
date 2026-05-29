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

  it('#387: removing a ratified bond is a TWO-step confirm, not a one-click delete', async () => {
    const el = mount();
    el.bonds = [bond({ id: 'b-removed' })];
    el.editablePcId = 'mei';
    let removed: { pcId: string; bondId: string } | null = null;
    el.onRemove = (pcId, bondId) => {
      removed = { pcId, bondId };
    };
    await el.updateComplete;
    // First click ARMS the confirm — does NOT remove.
    (el.querySelector('.bonds-card-remove') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(removed).toBeNull();
    const confirm = el.querySelector('.bonds-card-remove-confirm');
    expect(confirm).not.toBeNull();
    // Story-signal framing (folds in the "bond-remove story signal" item).
    expect(confirm?.textContent?.toLowerCase()).toContain('sever this tie');
    // Confirming removes with the right id.
    (
      el.querySelector('.bonds-card-remove-confirm-yes') as HTMLButtonElement
    ).click();
    expect(removed).toEqual({ pcId: 'mei', bondId: 'b-removed' });
  });

  it('#387: "Keep" cancels the removal confirm without calling onRemove', async () => {
    const el = mount();
    el.bonds = [bond({ id: 'b1' })];
    el.editablePcId = 'mei';
    let called = false;
    el.onRemove = () => {
      called = true;
    };
    await el.updateComplete;
    (el.querySelector('.bonds-card-remove') as HTMLButtonElement).click();
    await el.updateComplete;
    (
      el.querySelector('.bonds-card-remove-confirm-no') as HTMLButtonElement
    ).click();
    await el.updateComplete;
    expect(called).toBe(false);
    // Back to the armed-able ✕, confirm gone.
    expect(el.querySelector('.bonds-card-remove-confirm')).toBeNull();
    expect(el.querySelector('.bonds-card-remove')).not.toBeNull();
  });

  it('#387: a pending confirm clears if the bond disappears (e.g. removed by another DM)', async () => {
    const el = mount();
    el.bonds = [bond({ id: 'b1' }), bond({ id: 'b2' })];
    el.editablePcId = 'mei';
    el.onRemove = () => {};
    await el.updateComplete;
    // Arm the confirm on b1.
    (el.querySelectorAll('.bonds-card-remove')[0] as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-remove-confirm')).not.toBeNull();
    // b1 vanishes from the synced list → the stale confirm clears.
    el.bonds = [bond({ id: 'b2' })];
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-remove-confirm')).toBeNull();
  });

  it('shows a count in the head when bonds present', async () => {
    const el = mount();
    el.bonds = [bond({ id: 'b1' }), bond({ id: 'b2' }), bond({ id: 'b3' })];
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-head h4')?.textContent).toMatch(
      /Bonds \(3\)/
    );
  });

  it('D5-C-fix #3: renders pending-pip when pendingProposalCount > 0', async () => {
    const el = mount();
    el.pendingProposalCount = 2;
    await el.updateComplete;
    expect(
      el.querySelector('.bonds-card-pending-pip')?.textContent
    ).toMatch(/2 awaiting DM review/);
  });

  it('D5-C-fix #3: no pending-pip when count is zero', async () => {
    const el = mount();
    el.pendingProposalCount = 0;
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-pending-pip')).toBeNull();
  });

  it('D5-cleanup: inbound bonds render with "→ me" + sourceLabel', async () => {
    const el = mount();
    el.bonds = [
      bond({
        id: 'b-in',
        direction: 'in',
        sourceLabel: 'Mei',
        targetLabel: 'Iris',
        text: 'we were classmates'
      })
    ];
    await el.updateComplete;
    const row = el.querySelector('.bonds-card-row');
    expect(row?.classList.contains('bonds-card-row-inbound')).toBe(true);
    const target = row?.querySelector('.bonds-card-target')?.textContent ?? '';
    expect(target).toMatch(/Mei/);
    expect(target).toMatch(/→ me/);
  });

  it('D5.5-B: inbound bond shows the cross-PC consent hint', async () => {
    const el = mount();
    el.bonds = [
      bond({
        id: 'b-in',
        direction: 'in',
        sourceLabel: 'Mei',
        text: 'she owes me'
      })
    ];
    await el.updateComplete;
    const hint = el.querySelector('.bonds-card-inbound-consent');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toMatch(/conversation for the table/i);
  });

  it('D5.5-B: outbound bond does NOT show the consent hint', async () => {
    const el = mount();
    el.bonds = [bond({ id: 'b-out', direction: 'out' })];
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-inbound-consent')).toBeNull();
  });

  it('D5-cleanup: inbound bond hides remove button (owned by source PC)', async () => {
    const el = mount();
    el.bonds = [
      bond({
        id: 'b-in',
        direction: 'in',
        sourceLabel: 'Mei',
        text: 'we were classmates'
      })
    ];
    el.editablePcId = 'iris'; // viewer is iris, bond owned by mei
    el.onRemove = () => {};
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-remove')).toBeNull();
  });

  it('D5-cleanup: outbound bond (direction: out or default) shows remove button when coord', async () => {
    const el = mount();
    el.bonds = [bond({ id: 'b-out', direction: 'out' })];
    el.editablePcId = 'mei';
    el.onRemove = () => {};
    await el.updateComplete;
    expect(el.querySelector('.bonds-card-remove')).not.toBeNull();
  });

  it('D5-C-fix #5: empty-state copy no longer claims chargen-only', async () => {
    const el = mount();
    el.editablePcId = 'mei';
    await el.updateComplete;
    const empty = el.querySelector('.bonds-card-empty')?.textContent ?? '';
    expect(empty).not.toMatch(/chargen/i);
    expect(empty).toMatch(/No bonds yet/);
  });
});

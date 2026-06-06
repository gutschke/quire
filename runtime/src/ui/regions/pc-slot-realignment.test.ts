// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import './pc-slot-realignment';
import type {
  PcSlotRealignment,
  SlotRealignmentProposalDisplay,
  SlotRealignmentRow
} from './pc-slot-realignment';

function makeEl(): PcSlotRealignment {
  const el = document.createElement('pc-slot-realignment') as PcSlotRealignment;
  document.body.appendChild(el);
  return el;
}

const ROWS: SlotRealignmentRow[] = [
  { slot: 1, playerName: 'Markus', pcId: 'pc-marcus', pcName: 'Marcus Vance' },
  { slot: 2, playerName: 'Yui', pcId: 'pc-yui', pcName: 'Yui Tanaka' }
];

describe('<pc-slot-realignment>', () => {
  it('renders current bindings with BOTH player + PC name (memory ttrpg-show-both-names)', async () => {
    const el = makeEl();
    el.bindings = ROWS;
    await el.updateComplete;
    const txt = el.textContent ?? '';
    expect(txt).toContain('Slot 1');
    expect(txt).toContain('Markus');
    expect(txt).toContain('Marcus Vance');
    expect(txt).toContain('Slot 2');
    expect(txt).toContain('Yui');
    expect(txt).toContain('Yui Tanaka');
  });

  it('shows the empty-state hint when no bindings exist', async () => {
    const el = makeEl();
    el.bindings = [];
    await el.updateComplete;
    expect(el.textContent ?? '').toContain('No bindings yet');
  });

  it('disables the Ask-AI button while busy', async () => {
    const el = makeEl();
    el.bindings = ROWS;
    el.busy = true;
    await el.updateComplete;
    const btn = el.querySelector<HTMLButtonElement>(
      '.pc-slot-realignment-ask'
    );
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toContain('Asking AI');
  });

  it('renders no-change message when noChangeNeeded is true', async () => {
    const el = makeEl();
    el.bindings = ROWS;
    el.noChangeNeeded = true;
    el.reasoning = 'Both players sound aligned with their PCs.';
    await el.updateComplete;
    const txt = el.textContent ?? '';
    expect(txt).toContain('no change recommended');
    expect(txt).toContain('Both players sound aligned');
  });

  it('renders proposals with rationale + Apply button', async () => {
    const el = makeEl();
    el.bindings = ROWS;
    const proposals: SlotRealignmentProposalDisplay[] = [
      {
        slot: 1,
        currentPcId: 'pc-marcus',
        proposedPcId: 'pc-yui',
        rationale: 'Markus kept stabilizing patients.',
        currentPcName: 'Marcus Vance',
        proposedPcName: 'Yui Tanaka',
        playerName: 'Markus'
      }
    ];
    el.proposals = proposals;
    el.reasoning = 'Markus played the medic, Yui played the hacker.';
    await el.updateComplete;
    const txt = el.textContent ?? '';
    expect(txt).toContain('Marcus Vance');
    expect(txt).toContain('Yui Tanaka');
    expect(txt).toContain('stabilizing patients');
    expect(txt).toContain('Apply this swap');
    const applyBtn = el.querySelector<HTMLButtonElement>(
      '.pc-slot-realignment-apply'
    );
    expect(applyBtn?.disabled).toBe(true); // no onApplySwap wired in this test
  });

  it('Apply-all button appears only when 2+ proposals exist', async () => {
    const el = makeEl();
    el.bindings = ROWS;
    const one: SlotRealignmentProposalDisplay[] = [
      {
        slot: 1,
        currentPcId: 'pc-marcus',
        proposedPcId: 'pc-yui',
        rationale: 'r',
        currentPcName: 'Marcus Vance',
        proposedPcName: 'Yui Tanaka'
      }
    ];
    el.proposals = one;
    await el.updateComplete;
    expect(
      el.querySelector('.pc-slot-realignment-apply-all')
    ).toBeFalsy();

    el.proposals = [
      ...one,
      {
        slot: 2,
        currentPcId: 'pc-yui',
        proposedPcId: 'pc-marcus',
        rationale: 'r',
        currentPcName: 'Yui Tanaka',
        proposedPcName: 'Marcus Vance'
      }
    ];
    await el.updateComplete;
    expect(
      el.querySelector('.pc-slot-realignment-apply-all')
    ).toBeTruthy();
  });

  it('calls onAskAi with the DM-guidance draft when Ask is clicked', async () => {
    const el = makeEl();
    el.bindings = ROWS;
    let called: string | null = null;
    el.onAskAi = async (guidance) => {
      called = guidance;
      return { ok: true, reasoning: '' };
    };
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.pc-slot-realignment-guidance'
    );
    input!.value = 'Markus seems frustrated';
    input!.dispatchEvent(new Event('input'));
    await el.updateComplete;
    const btn = el.querySelector<HTMLButtonElement>(
      '.pc-slot-realignment-ask'
    );
    btn!.click();
    // Wait a microtask for the async callback.
    await new Promise((r) => setTimeout(r, 0));
    expect(called).toBe('Markus seems frustrated');
  });
});

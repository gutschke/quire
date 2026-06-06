// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import './pc-slot-realignment';
import type {
  PcSlotRealignment,
  RealignmentProposalEntry,
  RealignmentRow
} from './pc-slot-realignment';

function makeEl(): PcSlotRealignment {
  const el = document.createElement('pc-slot-realignment') as PcSlotRealignment;
  document.body.appendChild(el);
  return el;
}

const ROWS: RealignmentRow[] = [
  {
    slot: 1,
    playerName: 'Markus',
    pcId: 'pc-marcus',
    pcName: 'Marcus Vance',
    peerId: 'peer-markus'
  },
  {
    slot: 3,
    playerName: 'Yui',
    pcId: 'pc-yui',
    pcName: 'Yui Tanaka',
    peerId: 'peer-yui'
  }
];

describe('<pc-slot-realignment> (v2 pair-atomic)', () => {
  it('renders current bindings with both player + PC name', async () => {
    const el = makeEl();
    el.bindings = ROWS;
    await el.updateComplete;
    const txt = el.textContent ?? '';
    expect(txt).toContain('slot 1');
    expect(txt).toContain('Markus');
    expect(txt).toContain('Marcus Vance');
    expect(txt).toContain('slot 3');
    expect(txt).toContain('Yui');
    expect(txt).toContain('Yui Tanaka');
  });

  it('renders the proposed renumbering with slot N → slot M arrows', async () => {
    const el = makeEl();
    el.bindings = ROWS;
    const permutation: RealignmentProposalEntry[] = [
      {
        newSlot: 3,
        currentSlot: 1,
        pairKey: { pcId: 'pc-marcus', peerId: 'peer-markus' },
        pcName: 'Marcus Vance',
        playerName: 'Markus',
        slotFingerprintMatched: 'SDR / radio hobbyist',
        rationale:
          'Marcus is the hacker; pc:3 carries the SDR — better match.'
      }
    ];
    el.permutation = permutation;
    el.reasoning = 'The hacker fingerprint sits on slot 3.';
    await el.updateComplete;
    const txt = el.textContent ?? '';
    expect(txt).toContain('slot 1');
    expect(txt).toContain('slot 3');
    expect(txt).toContain('Marcus Vance');
    expect(txt).toContain('Markus');
    expect(txt).toContain('SDR');
    expect(txt).toContain('matched');
  });

  it('hides the proposal section when permutation is empty', async () => {
    const el = makeEl();
    el.bindings = ROWS;
    el.permutation = [];
    await el.updateComplete;
    expect(el.querySelector('.pc-slot-realignment-proposal')).toBeFalsy();
  });

  it('shows no-change-recommended when noChangeNeeded is true', async () => {
    const el = makeEl();
    el.bindings = ROWS;
    el.noChangeNeeded = true;
    el.reasoning = 'Both pairs match their current slots well.';
    await el.updateComplete;
    expect(el.textContent ?? '').toContain('no change recommended');
    expect(el.textContent ?? '').toContain('match their current slots');
  });

  it('opens a confirm dialog before applying — atomic permutation gate', async () => {
    const el = makeEl();
    el.bindings = ROWS;
    const permutation: RealignmentProposalEntry[] = [
      {
        newSlot: 3,
        currentSlot: 1,
        pairKey: { pcId: 'pc-marcus', peerId: 'peer-markus' },
        pcName: 'Marcus Vance',
        playerName: 'Markus',
        slotFingerprintMatched: 'radio',
        rationale: 'r'
      }
    ];
    el.permutation = permutation;
    let applied: ReadonlyArray<RealignmentProposalEntry> | null = null;
    el.onApplyPermutation = (entries) => {
      applied = [...entries];
    };
    await el.updateComplete;
    const apply = el.querySelector<HTMLButtonElement>(
      '.pc-slot-realignment-apply'
    );
    apply!.click();
    await el.updateComplete;
    // Confirm dialog should be visible; nothing applied yet.
    expect(el.querySelector('.pc-slot-realignment-confirm')).toBeTruthy();
    expect(applied).toBeNull();
    // Confirm copy reassures the DM that no sheet data is touched.
    const norm = (el.textContent ?? '').replace(/\s+/g, ' ');
    expect(norm).toContain('No character sheets');
    expect(norm).toContain('bonds are touched');
    const confirmBtn = el.querySelector<HTMLButtonElement>(
      '.pc-slot-realignment-confirm-apply'
    );
    confirmBtn!.click();
    await el.updateComplete;
    expect(applied).not.toBeNull();
    expect((applied as unknown as RealignmentProposalEntry[])[0].newSlot).toBe(
      3
    );
  });

  it('cancels confirm without applying', async () => {
    const el = makeEl();
    el.bindings = ROWS;
    el.permutation = [
      {
        newSlot: 3,
        currentSlot: 1,
        pairKey: { pcId: 'pc-marcus', peerId: 'peer-markus' },
        pcName: 'Marcus Vance',
        playerName: 'Markus',
        slotFingerprintMatched: '',
        rationale: 'r'
      }
    ];
    let applied = false;
    el.onApplyPermutation = () => {
      applied = true;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.pc-slot-realignment-apply'
    )!.click();
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.pc-slot-realignment-confirm-cancel'
    )!.click();
    await el.updateComplete;
    expect(applied).toBe(false);
  });

  it('calls onAskAi with the DM-guidance draft', async () => {
    const el = makeEl();
    el.bindings = ROWS;
    let captured: string | null = null;
    el.onAskAi = async (guidance) => {
      captured = guidance;
      return { ok: true, reasoning: '' };
    };
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>(
      '.pc-slot-realignment-guidance'
    );
    input!.value = 'try a different angle';
    input!.dispatchEvent(new Event('input'));
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.pc-slot-realignment-ask')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(captured).toBe('try a different angle');
  });
});

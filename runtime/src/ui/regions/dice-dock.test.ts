// @vitest-environment happy-dom

/**
 * <dice-dock> tests — modifier stepper + doubles halo (M3D-4).
 *
 * Smaller-scope than the full ui.md L154-160 dice-Dock spec; the
 * stepper and the halo are the two highest-value pieces from the
 * TTRPG-craft expert's prioritization (modifier adjustability +
 * wild-outcome visibility).  Later phases land the big "Roll 2d6"
 * button, last-3 pills, R / 1-6 / +/- / Enter keyboard, and the
 * lingering-result animation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import './dice-dock';
import type { DiceDock, DiceHistoryEntry } from './dice-dock';

function mount(): DiceDock {
  const el = document.createElement('dice-dock') as DiceDock;
  document.body.appendChild(el);
  return el;
}

describe('<dice-dock> modifier stepper (M3D-4)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function withStats(): DiceDock {
    const el = mount();
    el.stats = { str: 1, dex: 0, con: -1, int: 2, wis: 0, cha: 1 };
    return el;
  }

  it('renders the stepper when stats are present', async () => {
    const el = withStats();
    await el.updateComplete;
    expect(el.querySelector('.dice-modifier-stepper')).not.toBeNull();
    expect(el.querySelector('.dice-modifier-step-minus')).not.toBeNull();
    expect(el.querySelector('.dice-modifier-step-plus')).not.toBeNull();
    expect(el.querySelector('.dice-modifier-value')?.textContent?.trim()).toBe(
      '+0'
    );
  });

  it('hides the stepper when no PC is bound (no stats)', async () => {
    const el = mount();
    el.stats = null;
    await el.updateComplete;
    expect(el.querySelector('.dice-modifier-stepper')).toBeNull();
  });

  it('+ button increases the modifier; − decreases', async () => {
    const el = withStats();
    await el.updateComplete;
    const plus = el.querySelector<HTMLButtonElement>('.dice-modifier-step-plus')!;
    const minus = el.querySelector<HTMLButtonElement>(
      '.dice-modifier-step-minus'
    )!;
    plus.click();
    await el.updateComplete;
    expect(el.querySelector('.dice-modifier-value')?.textContent?.trim()).toBe(
      '+1'
    );
    plus.click();
    await el.updateComplete;
    expect(el.querySelector('.dice-modifier-value')?.textContent?.trim()).toBe(
      '+2'
    );
    minus.click();
    await el.updateComplete;
    expect(el.querySelector('.dice-modifier-value')?.textContent?.trim()).toBe(
      '+1'
    );
  });

  it('clamps at +2 and -2 (rules cap)', async () => {
    const el = withStats();
    await el.updateComplete;
    const plus = el.querySelector<HTMLButtonElement>('.dice-modifier-step-plus')!;
    const minus = el.querySelector<HTMLButtonElement>(
      '.dice-modifier-step-minus'
    )!;
    // Push past +2.
    plus.click();
    plus.click();
    plus.click();
    plus.click();
    await el.updateComplete;
    expect(el.querySelector('.dice-modifier-value')?.textContent?.trim()).toBe(
      '+2'
    );
    expect(plus.disabled).toBe(true);
    // Push past -2.
    minus.click();
    minus.click();
    minus.click();
    minus.click();
    minus.click();
    minus.click();
    await el.updateComplete;
    expect(el.querySelector('.dice-modifier-value')?.textContent?.trim()).toBe(
      '-2'
    );
    expect(minus.disabled).toBe(true);
  });

  it('chip click applies stepper offset to the rolled expression', async () => {
    const el = withStats();
    let rolledExpr: string | null = null;
    el.onSubmitRoll = (expr) => {
      rolledExpr = expr;
    };
    await el.updateComplete;
    // Bump stepper to +1.
    el.querySelector<HTMLButtonElement>('.dice-modifier-step-plus')!.click();
    await el.updateComplete;
    // Click STR chip — base STR is +1, plus stepper +1 = +2.
    const strChip = el.querySelector<HTMLButtonElement>('.dice-stat-chip')!;
    strChip.click();
    expect(rolledExpr).toBe('2d6+2');
  });

  it('chip click resets stepper to +0 after rolling', async () => {
    const el = withStats();
    el.onSubmitRoll = () => {};
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.dice-modifier-step-plus')!.click();
    await el.updateComplete;
    expect(el.querySelector('.dice-modifier-value')?.textContent?.trim()).toBe(
      '+1'
    );
    el.querySelector<HTMLButtonElement>('.dice-stat-chip')!.click();
    await el.updateComplete;
    expect(el.querySelector('.dice-modifier-value')?.textContent?.trim()).toBe(
      '+0'
    );
  });

  it('negative offset + zero stat produces "2d6-1"', async () => {
    const el = withStats();
    let rolledExpr: string | null = null;
    el.onSubmitRoll = (expr) => {
      rolledExpr = expr;
    };
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.dice-modifier-step-minus')!.click();
    await el.updateComplete;
    // DEX chip — base DEX is 0, stepper -1 = -1.
    const dex = el.querySelectorAll<HTMLButtonElement>('.dice-stat-chip')[1];
    dex.click();
    expect(rolledExpr).toBe('2d6-1');
  });

  it('offset that cancels stat produces "2d6"', async () => {
    const el = withStats();
    let rolledExpr: string | null = null;
    el.onSubmitRoll = (expr) => {
      rolledExpr = expr;
    };
    await el.updateComplete;
    // STR is +1; bump stepper -1 → total +0 → plain "2d6".
    el.querySelector<HTMLButtonElement>('.dice-modifier-step-minus')!.click();
    await el.updateComplete;
    el.querySelectorAll<HTMLButtonElement>('.dice-stat-chip')[0].click();
    expect(rolledExpr).toBe('2d6');
  });
});

describe('<dice-dock> doubles halo (M3D-4)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function withEntries(entries: DiceHistoryEntry[]): DiceDock {
    const el = mount();
    el.entries = entries;
    return el;
  }

  it('renders the snake-eyes class on a double-1 entry', async () => {
    const el = withEntries([
      {
        key: 'k1',
        label: 'alice: 2d6+1 = 3 [1, 1]',
        tierClass: '',
        doubles: 'snake-eyes'
      }
    ]);
    await el.updateComplete;
    expect(el.querySelector('.roll-doubles-snake-eyes')).not.toBeNull();
    expect(el.querySelector('.roll-doubles-box-cars')).toBeNull();
  });

  it('renders the box-cars class on a double-6 entry', async () => {
    const el = withEntries([
      {
        key: 'k1',
        label: 'alice: 2d6+1 = 13 [6, 6]',
        tierClass: '',
        doubles: 'box-cars'
      }
    ]);
    await el.updateComplete;
    expect(el.querySelector('.roll-doubles-box-cars')).not.toBeNull();
    expect(el.querySelector('.roll-doubles-snake-eyes')).toBeNull();
  });

  it('renders neither class when doubles is null', async () => {
    const el = withEntries([
      {
        key: 'k1',
        label: 'alice: 2d6+1 = 8 [3, 4]',
        tierClass: '',
        doubles: null
      }
    ]);
    await el.updateComplete;
    expect(el.querySelector('.roll-doubles-snake-eyes')).toBeNull();
    expect(el.querySelector('.roll-doubles-box-cars')).toBeNull();
  });

  it('renders neither class when doubles is omitted', async () => {
    const el = withEntries([
      { key: 'k1', label: 'alice: 2d6+1 = 8', tierClass: '' }
    ]);
    await el.updateComplete;
    expect(el.querySelector('.roll-doubles-snake-eyes')).toBeNull();
    expect(el.querySelector('.roll-doubles-box-cars')).toBeNull();
  });

  it('preserves the tierClass alongside the doubles class', async () => {
    const el = withEntries([
      {
        key: 'k1',
        label: 'me: 2d6+1 = 12',
        tierClass: 'roll-tier-hit',
        doubles: 'box-cars'
      }
    ]);
    await el.updateComplete;
    const code = el.querySelector('code');
    expect(code?.classList.contains('roll-tier-hit')).toBe(true);
    expect(code?.classList.contains('roll-doubles-box-cars')).toBe(true);
  });
});

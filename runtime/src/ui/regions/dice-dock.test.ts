// @vitest-environment happy-dom

/**
 * <dice-dock> tests — modifier stepper + doubles halo (M3D-4) +
 * primary actions / last-3 pills / Cast macros (M3D-4b).
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

  it('preserves the tierClass alongside the doubles class on the pill', async () => {
    const el = withEntries([
      {
        key: 'k1',
        label: 'me: 2d6+1 = 12',
        tierClass: 'roll-tier-hit',
        doubles: 'box-cars'
      }
    ]);
    await el.updateComplete;
    // UX M6 (Cluster E step 8b): the duplicate `.roll-history` ul
    // was dropped; the pills are now the canonical recent-roll
    // display.  The pill `<li>` carries the tier + doubles
    // classes (not the inner `<code>`).
    const pill = el.querySelector('.dice-recent-pill');
    expect(pill?.classList.contains('roll-tier-hit')).toBe(true);
    expect(pill?.classList.contains('roll-doubles-box-cars')).toBe(true);
  });
});

describe('<dice-dock> primary actions (M3D-4b)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the Roll 2d6 primary button when no PC is bound', async () => {
    const el = mount();
    el.stats = null;
    await el.updateComplete;
    const btn = el.querySelector<HTMLButtonElement>('.dice-primary-roll');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toMatch(/Roll 2d6/);
  });

  it('Roll 2d6 button submits "2d6" with no modifier when no offset', async () => {
    const el = mount();
    const submitted: string[] = [];
    el.onSubmitRoll = (v) => submitted.push(v);
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.dice-primary-roll')?.click();
    expect(submitted).toEqual(['2d6']);
  });

  it('Roll 2d6 button includes the stepper offset, then resets it', async () => {
    const el = mount();
    el.stats = { str: 1, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
    const submitted: string[] = [];
    el.onSubmitRoll = (v) => submitted.push(v);
    await el.updateComplete;
    // Bump offset to +2.
    el.querySelector<HTMLButtonElement>('.dice-modifier-step-plus')?.click();
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.dice-modifier-step-plus')?.click();
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.dice-primary-roll')?.click();
    expect(submitted).toEqual(['2d6+2']);
    // Offset auto-resets after the roll.
    await el.updateComplete;
    expect(
      el.querySelector('.dice-modifier-value')?.textContent?.trim()
    ).toBe('+0');
  });

  it('hides Cast macros when no PC is bound', async () => {
    const el = mount();
    el.stats = null;
    await el.updateComplete;
    expect(el.querySelector('.dice-primary-cast-costly')).toBeNull();
    expect(el.querySelector('.dice-primary-cast-hard')).toBeNull();
  });

  it('shows Cast (Costly) and Cast (Hard) when stats are bound', async () => {
    const el = mount();
    el.stats = { str: 0, dex: 0, con: 0, int: 0, wis: 2, cha: 0 };
    await el.updateComplete;
    expect(el.querySelector('.dice-primary-cast-costly')).not.toBeNull();
    expect(el.querySelector('.dice-primary-cast-hard')).not.toBeNull();
  });

  it('Cast (Costly) submits 2d6+WIS', async () => {
    const el = mount();
    el.stats = { str: 0, dex: 0, con: 0, int: 0, wis: 2, cha: 0 };
    const submitted: string[] = [];
    el.onSubmitRoll = (v) => submitted.push(v);
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.dice-primary-cast-costly')?.click();
    expect(submitted).toEqual(['2d6+2']);
  });

  it('Cast (Hard) submits 2d6+WIS-2 with the rules-mandated -2 penalty', async () => {
    const el = mount();
    el.stats = { str: 0, dex: 0, con: 0, int: 0, wis: 2, cha: 0 };
    const submitted: string[] = [];
    el.onSubmitRoll = (v) => submitted.push(v);
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.dice-primary-cast-hard')?.click();
    expect(submitted).toEqual(['2d6']); // wis 2 - 2 = 0 → just "2d6"
  });

  it('Cast (Hard) with WIS +1 submits 2d6-1', async () => {
    const el = mount();
    el.stats = { str: 0, dex: 0, con: 0, int: 0, wis: 1, cha: 0 };
    const submitted: string[] = [];
    el.onSubmitRoll = (v) => submitted.push(v);
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.dice-primary-cast-hard')?.click();
    expect(submitted).toEqual(['2d6-1']);
  });
});

describe('<dice-dock> last-3 pills (M3D-4b)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function withEntries(entries: DiceHistoryEntry[]): DiceDock {
    const el = mount();
    el.entries = entries;
    return el;
  }

  it('renders no pills when there are no entries', async () => {
    const el = withEntries([]);
    await el.updateComplete;
    expect(el.querySelector('.dice-recent-pills')).toBeNull();
  });

  it('renders one pill per entry, up to 3', async () => {
    const el = withEntries([
      { key: 'k1', label: 'me: 2d6 = 7', tierClass: 'roll-tier-partial' },
      { key: 'k2', label: 'me: 2d6 = 11', tierClass: 'roll-tier-hit' },
      { key: 'k3', label: 'me: 2d6 = 4', tierClass: 'roll-tier-miss' },
      { key: 'k4', label: 'me: 2d6 = 8', tierClass: 'roll-tier-partial' },
      { key: 'k5', label: 'me: 2d6 = 6', tierClass: 'roll-tier-miss' }
    ]);
    await el.updateComplete;
    const pills = el.querySelectorAll('.dice-recent-pill');
    expect(pills.length).toBe(3);
    // First-three convention (entries come in newest-first order from
    // the host).
    expect(pills[0].textContent).toMatch(/= 7/);
    expect(pills[1].textContent).toMatch(/= 11/);
    expect(pills[2].textContent).toMatch(/= 4/);
  });

  it('applies tier + doubles classes on the pill li', async () => {
    const el = withEntries([
      {
        key: 'k1',
        label: 'me: 2d6 = 12',
        tierClass: 'roll-tier-hit',
        doubles: 'box-cars'
      }
    ]);
    await el.updateComplete;
    const pill = el.querySelector('.dice-recent-pill');
    expect(pill?.classList.contains('roll-tier-hit')).toBe(true);
    expect(pill?.classList.contains('roll-doubles-box-cars')).toBe(true);
  });
});

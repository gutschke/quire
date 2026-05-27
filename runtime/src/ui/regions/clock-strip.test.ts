// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './clock-strip';
import type { ClockStrip, DmClockView } from './clock-strip';

function mount(): ClockStrip {
  const el = document.createElement('clock-strip') as ClockStrip;
  document.body.appendChild(el);
  return el;
}

function clock(over: Partial<DmClockView> = {}): DmClockView {
  return {
    id: 'engineer-ships',
    name: 'Engineer ships the bad thing',
    size: 4,
    filled: 0,
    ...over
  };
}

describe('<clock-strip>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders heading + empty state for coord viewer with no clocks', async () => {
    const el = mount();
    el.onCreate = () => true;
    el.onTick = () => true;
    el.onDelete = () => true;
    await el.updateComplete;
    expect(el.querySelector('.clock-strip-head h3')?.textContent).toMatch(
      /Clocks/
    );
    expect(el.querySelector('.clock-strip-empty')).not.toBeNull();
    expect(el.querySelector('.clock-strip-add')).not.toBeNull();
  });

  it('no ⊕ button for player viewer (no callbacks)', async () => {
    const el = mount();
    await el.updateComplete;
    expect(el.querySelector('.clock-strip-add')).toBeNull();
  });

  it('renders clocks with name + counter', async () => {
    const el = mount();
    el.clocks = [clock({ filled: 2 })];
    el.onCreate = () => true;
    el.onTick = () => true;
    el.onDelete = () => true;
    await el.updateComplete;
    const row = el.querySelector('.clock-strip-row');
    expect(row).not.toBeNull();
    expect(row?.textContent).toMatch(/Engineer ships/);
    expect(el.querySelector('.clock-strip-counter')?.textContent).toMatch(
      /2\/4/
    );
  });

  it('renders an SVG pie with one path per segment', async () => {
    const el = mount();
    el.clocks = [clock({ size: 6, filled: 2 })];
    el.onCreate = () => true;
    el.onTick = () => true;
    el.onDelete = () => true;
    await el.updateComplete;
    const wedges = el.querySelectorAll('.clock-strip-svg path');
    expect(wedges.length).toBe(6);
    const filled = el.querySelectorAll(
      '.clock-strip-svg .clock-strip-wedge-filled'
    );
    expect(filled.length).toBe(2);
  });

  it('left-click pie invokes onTick with +1', async () => {
    const el = mount();
    el.clocks = [clock()];
    let lastBy: number | undefined;
    el.onCreate = () => true;
    el.onTick = (_id, by) => {
      lastBy = by;
      return true;
    };
    el.onDelete = () => true;
    await el.updateComplete;
    (el.querySelector('.clock-strip-pie') as HTMLButtonElement).click();
    expect(lastBy).toBe(1);
  });

  it('shift-click pie invokes onTick with -1', async () => {
    const el = mount();
    el.clocks = [clock({ filled: 2 })];
    let lastBy: number | undefined;
    el.onCreate = () => true;
    el.onTick = (_id, by) => {
      lastBy = by;
      return true;
    };
    el.onDelete = () => true;
    await el.updateComplete;
    const pie = el.querySelector('.clock-strip-pie') as HTMLButtonElement;
    pie.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    expect(lastBy).toBe(-1);
  });

  it('full clock gets the full row class for pulse styling', async () => {
    const el = mount();
    el.clocks = [clock({ filled: 4 })];
    el.onCreate = () => true;
    el.onTick = () => true;
    el.onDelete = () => true;
    await el.updateComplete;
    const row = el.querySelector('.clock-strip-row');
    expect(row?.classList.contains('clock-strip-row-full')).toBe(true);
  });

  it('delete button invokes onDelete', async () => {
    const el = mount();
    el.clocks = [clock()];
    let deletedId: string | undefined;
    el.onCreate = () => true;
    el.onTick = () => true;
    el.onDelete = (id) => {
      deletedId = id;
      return true;
    };
    await el.updateComplete;
    (el.querySelector('.clock-strip-delete') as HTMLButtonElement).click();
    expect(deletedId).toBe('engineer-ships');
  });

  it('⊕ opens inline create row with name input + size buttons', async () => {
    const el = mount();
    el.onCreate = () => true;
    el.onTick = () => true;
    el.onDelete = () => true;
    await el.updateComplete;
    (el.querySelector('.clock-strip-add') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.querySelector('.clock-strip-create')).not.toBeNull();
    expect(el.querySelector('.clock-strip-create-name')).not.toBeNull();
    const sizes = el.querySelectorAll('.clock-strip-create-size');
    expect(sizes.length).toBe(2);
    expect(sizes[0].textContent?.trim()).toBe('4');
    expect(sizes[1].textContent?.trim()).toBe('6');
  });

  it('Add commits the draft name + size via onCreate', async () => {
    const el = mount();
    let saved: { name: string; size: 4 | 6 } | null = null;
    el.onCreate = (name, size) => {
      saved = { name, size };
      return true;
    };
    el.onTick = () => true;
    el.onDelete = () => true;
    await el.updateComplete;
    (el.querySelector('.clock-strip-add') as HTMLButtonElement).click();
    await el.updateComplete;
    const nameInput = el.querySelector(
      '.clock-strip-create-name'
    ) as HTMLInputElement;
    nameInput.value = 'Quiet closes in';
    nameInput.dispatchEvent(new Event('input'));
    await el.updateComplete;
    const sizes = el.querySelectorAll(
      '.clock-strip-create-size'
    ) as NodeListOf<HTMLButtonElement>;
    sizes[1].click(); // select 6
    await el.updateComplete;
    (
      el.querySelector('.clock-strip-create-submit') as HTMLButtonElement
    ).click();
    expect(saved).toEqual({ name: 'Quiet closes in', size: 6 });
  });

  it('Cancel closes the create row without committing', async () => {
    const el = mount();
    let createCount = 0;
    el.onCreate = () => {
      createCount++;
      return true;
    };
    el.onTick = () => true;
    el.onDelete = () => true;
    await el.updateComplete;
    (el.querySelector('.clock-strip-add') as HTMLButtonElement).click();
    await el.updateComplete;
    (
      el.querySelector('.clock-strip-create-cancel') as HTMLButtonElement
    ).click();
    await el.updateComplete;
    expect(el.querySelector('.clock-strip-create')).toBeNull();
    expect(createCount).toBe(0);
  });

  it('Enter in name input submits; Escape cancels', async () => {
    const el = mount();
    let saved: { name: string; size: 4 | 6 } | null = null;
    el.onCreate = (name, size) => {
      saved = { name, size };
      return true;
    };
    el.onTick = () => true;
    el.onDelete = () => true;
    await el.updateComplete;
    (el.querySelector('.clock-strip-add') as HTMLButtonElement).click();
    await el.updateComplete;
    const nameInput = el.querySelector(
      '.clock-strip-create-name'
    ) as HTMLInputElement;
    nameInput.value = 'short';
    nameInput.dispatchEvent(new Event('input'));
    nameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(saved).toEqual({ name: 'short', size: 4 });
  });

  it('empty draft name does NOT commit', async () => {
    const el = mount();
    let createCount = 0;
    el.onCreate = () => {
      createCount++;
      return true;
    };
    el.onTick = () => true;
    el.onDelete = () => true;
    await el.updateComplete;
    (el.querySelector('.clock-strip-add') as HTMLButtonElement).click();
    await el.updateComplete;
    (
      el.querySelector('.clock-strip-create-submit') as HTMLButtonElement
    ).click();
    expect(createCount).toBe(0);
  });

  it('click on full clock toggles ack (no tick event emitted)', async () => {
    const el = mount();
    el.clocks = [clock({ filled: 4 })];
    let tickCount = 0;
    el.onCreate = () => true;
    el.onTick = () => {
      tickCount++;
      return true;
    };
    el.onDelete = () => true;
    await el.updateComplete;
    (el.querySelector('.clock-strip-pie') as HTMLButtonElement).click();
    await el.updateComplete;
    // No tick emitted; ack toggled on.
    expect(tickCount).toBe(0);
    const row = el.querySelector('.clock-strip-row');
    expect(row?.classList.contains('clock-strip-row-acked')).toBe(true);
    expect(row?.classList.contains('clock-strip-row-full')).toBe(false);
    // Second click toggles ack off.
    (el.querySelector('.clock-strip-pie') as HTMLButtonElement).click();
    await el.updateComplete;
    const row2 = el.querySelector('.clock-strip-row');
    expect(row2?.classList.contains('clock-strip-row-acked')).toBe(false);
    expect(row2?.classList.contains('clock-strip-row-full')).toBe(true);
  });

  it('shift-click on full clock un-ticks (not ack toggle)', async () => {
    const el = mount();
    el.clocks = [clock({ filled: 4 })];
    let lastBy: number | undefined;
    el.onCreate = () => true;
    el.onTick = (_id, by) => {
      lastBy = by;
      return true;
    };
    el.onDelete = () => true;
    await el.updateComplete;
    const pie = el.querySelector('.clock-strip-pie') as HTMLButtonElement;
    pie.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    expect(lastBy).toBe(-1);
  });

  it('willUpdate prunes acknowledged entries for deleted clocks', async () => {
    const el = mount();
    el.clocks = [clock({ filled: 4 })];
    el.onCreate = () => true;
    el.onTick = () => true;
    el.onDelete = () => true;
    await el.updateComplete;
    // Ack via the click-to-toggle UX (the documented affordance).
    (el.querySelector('.clock-strip-pie') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(
      el
        .querySelector('.clock-strip-row')
        ?.classList.contains('clock-strip-row-acked')
    ).toBe(true);
    // Remove the clock; the ack should prune (verified by no
    // crash + no stale ack visible).
    el.clocks = [];
    await el.updateComplete;
    expect(el.querySelector('.clock-strip-row')).toBeNull();
    expect(el.querySelector('.clock-strip-empty')).not.toBeNull();
  });
});

// @vitest-environment happy-dom

/**
 * <seat-strip> tests (M3D-6, CC-1 subset).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import './seat-strip';
import type { SeatStrip } from './seat-strip';

function mount(): SeatStrip {
  const el = document.createElement('seat-strip') as SeatStrip;
  document.body.appendChild(el);
  return el;
}

describe('<seat-strip>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the empty card when pcSlots is empty', async () => {
    const el = mount();
    await el.updateComplete;
    expect(el.querySelector('.seat-strip-empty')).not.toBeNull();
    expect(el.querySelector('.seat-strip-list')).toBeNull();
  });

  it('renders one row per bound slot', async () => {
    const el = mount();
    el.pcSlots = { 1: 'mei', 2: 'bob', 4: 'aiyana' };
    await el.updateComplete;
    expect(el.querySelectorAll('.seat-strip-row').length).toBe(3);
  });

  it('shows PC<N> label per row', async () => {
    const el = mount();
    el.pcSlots = { 1: 'mei', 3: 'eve' };
    await el.updateComplete;
    const labels = Array.from(
      el.querySelectorAll('.seat-strip-slot')
    ).map((s) => s.textContent?.trim());
    expect(labels).toContain('PC1');
    expect(labels).toContain('PC3');
  });

  it('renders rows sorted by slot number ascending', async () => {
    const el = mount();
    // Intentionally insert in non-sorted order.
    el.pcSlots = { 5: 'eve', 1: 'mei', 3: 'aiyana' };
    await el.updateComplete;
    const rows = Array.from(el.querySelectorAll('.seat-strip-row'));
    expect(rows.map((r) => r.getAttribute('data-slot'))).toEqual([
      '1',
      '3',
      '5'
    ]);
  });

  it('filters out invalid keys (out-of-range, non-integer)', async () => {
    const el = mount();
    // Use an `unknown` cast so the test can include a non-numeric
    // key without TypeScript prematurely rejecting at the prop
    // assignment.  Runtime guard inside `collectEntries()` is what
    // we're testing.
    el.pcSlots = {
      0: 'should-not-render',
      10: 'should-not-render',
      1: 'mei',
      foo: 'not-numeric'
    } as unknown as Record<number, string>;
    await el.updateComplete;
    const rows = Array.from(el.querySelectorAll('.seat-strip-row'));
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-slot')).toBe('1');
  });

  it('filters out empty-string pcId (defensive)', async () => {
    const el = mount();
    el.pcSlots = { 1: 'mei', 2: '' };
    await el.updateComplete;
    expect(el.querySelectorAll('.seat-strip-row').length).toBe(1);
  });

  it('unbind button invokes onUnbind with the slot number', async () => {
    const el = mount();
    el.pcSlots = { 2: 'mei' };
    let receivedSlot: number | null = null;
    el.onUnbind = (slot) => {
      receivedSlot = slot;
    };
    await el.updateComplete;
    const btn = el.querySelector<HTMLButtonElement>('.seat-strip-unbind')!;
    btn.click();
    expect(receivedSlot).toBe(2);
  });

  it('hides the unbind button when onUnbind callback is null', async () => {
    const el = mount();
    el.pcSlots = { 1: 'mei' };
    el.onUnbind = null;
    await el.updateComplete;
    expect(el.querySelector('.seat-strip-unbind')).toBeNull();
  });

  it('updates rendered rows when pcSlots changes reactively', async () => {
    const el = mount();
    el.pcSlots = { 1: 'mei' };
    await el.updateComplete;
    expect(el.querySelectorAll('.seat-strip-row').length).toBe(1);
    el.pcSlots = { 1: 'mei', 2: 'bob' };
    await el.updateComplete;
    expect(el.querySelectorAll('.seat-strip-row').length).toBe(2);
  });
});

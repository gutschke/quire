// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './seat-card';
import type { SeatCard, SeatCardSeat } from './seat-card';

function mount(): SeatCard {
  const el = document.createElement('seat-card') as SeatCard;
  document.body.appendChild(el);
  return el;
}

describe('<seat-card>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the PC pill with the slot number', async () => {
    const el = mount();
    el.slotNumber = 3;
    await el.updateComplete;
    const pill = el.querySelector('.chargen-dm-review-seat-pill');
    expect(pill?.textContent).toBe('PC3');
  });

  it('renders "open" muted when no bound name is set', async () => {
    const el = mount();
    el.slotNumber = 1;
    el.seat = { state: 'unbound' };
    await el.updateComplete;
    const name = el.querySelector('.chargen-dm-review-seat-name');
    expect(name?.textContent?.trim()).toMatch(/open/);
    expect(name?.querySelector('.muted')).not.toBeNull();
  });

  it('renders boundName + pcId subtitle when they differ', async () => {
    const el = mount();
    el.slotNumber = 1;
    el.seat = { state: 'bound-active', pcId: 'slot-1-abc' };
    el.boundName = 'Mei Tanaka';
    el.boundId = 'slot-1-abc';
    await el.updateComplete;
    const displayName = el.querySelector('.chargen-dm-review-seat-display-name');
    const id = el.querySelector('.chargen-dm-review-seat-id');
    expect(displayName?.textContent).toBe('Mei Tanaka');
    expect(id?.textContent).toMatch(/slot-1-abc/);
  });

  it('renders only the pcId when bound name equals the id (not yet resolved)', async () => {
    const el = mount();
    el.slotNumber = 1;
    el.seat = { state: 'bound-active', pcId: 'slot-1-abc' };
    el.boundName = 'slot-1-abc';
    el.boundId = 'slot-1-abc';
    await el.updateComplete;
    expect(
      el.querySelector('.chargen-dm-review-seat-display-name')
    ).toBeNull();
    expect(el.querySelector('.chargen-dm-review-seat-name code')?.textContent).toBe(
      'slot-1-abc'
    );
  });

  it('renders the retired tag for bound-retired seats', async () => {
    const el = mount();
    el.slotNumber = 1;
    el.seat = {
      state: 'bound-retired',
      pcId: 'slot-1-abc',
      inFictionRetireReason: 'left after a hard betrayal'
    } as SeatCardSeat;
    el.boundName = 'Mei';
    el.boundId = 'slot-1-abc';
    await el.updateComplete;
    const tag = el.querySelector('.chargen-dm-review-seat-tag-retired');
    expect(tag?.textContent?.trim()).toBe('retired');
    expect(tag?.getAttribute('title')).toBe('left after a hard betrayal');
  });

  it('renders the archived tag for bound-archived seats', async () => {
    const el = mount();
    el.slotNumber = 1;
    el.seat = {
      state: 'bound-archived',
      pcId: 'slot-1-abc',
      inFictionRetireReason: 'stepped back from the party'
    };
    await el.updateComplete;
    const tag = el.querySelector('.chargen-dm-review-seat-tag-archived');
    expect(tag?.textContent?.trim()).toBe('archived');
  });

  it('renders the × button when canRemove + onRemove are wired', async () => {
    const el = mount();
    el.slotNumber = 1;
    el.seat = { state: 'unbound' };
    el.canRemove = true;
    el.onRemove = () => {};
    await el.updateComplete;
    expect(
      el.querySelector('.chargen-dm-review-seat-remove')
    ).not.toBeNull();
  });

  it('hides the × button when canRemove is false', async () => {
    const el = mount();
    el.slotNumber = 1;
    el.seat = { state: 'unbound' };
    el.canRemove = false;
    el.onRemove = () => {};
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-seat-remove')).toBeNull();
  });

  it('hides the × button when onRemove is null (defense-in-depth)', async () => {
    const el = mount();
    el.slotNumber = 1;
    el.seat = { state: 'unbound' };
    el.canRemove = true;
    // onRemove intentionally null
    await el.updateComplete;
    expect(el.querySelector('.chargen-dm-review-seat-remove')).toBeNull();
  });

  it('clicking × fires onRemove with the slot', async () => {
    const el = mount();
    el.slotNumber = 3;
    el.seat = { state: 'unbound' };
    el.canRemove = true;
    const calls: number[] = [];
    el.onRemove = (slot) => calls.push(slot);
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-seat-remove'
    )!.click();
    expect(calls).toEqual([3]);
  });

  it('renders the Retire… button when canRetire + onRetire are wired', async () => {
    const el = mount();
    el.slotNumber = 1;
    el.seat = { state: 'bound-active', pcId: 'mei' };
    el.canRetire = true;
    el.onRetire = () => {};
    await el.updateComplete;
    const btn = el.querySelector('.chargen-dm-review-seat-retire');
    expect(btn?.textContent?.trim()).toBe('Retire…');
  });

  it('clicking Retire… fires onRetire with the slot', async () => {
    const el = mount();
    el.slotNumber = 2;
    el.seat = { state: 'bound-active', pcId: 'mei' };
    el.canRetire = true;
    const calls: number[] = [];
    el.onRetire = (slot) => calls.push(slot);
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(
      '.chargen-dm-review-seat-retire'
    )!.click();
    expect(calls).toEqual([2]);
  });

  it('renders slot content (body) below the header', async () => {
    const el = mount();
    el.slotNumber = 1;
    el.seat = { state: 'bound-active', pcId: 'mei' };
    el.boundName = 'Mei';
    el.boundId = 'mei';
    el.innerHTML = '<div class="my-body">payload</div>';
    await el.updateComplete;
    // Slotted content is rendered after the header in light DOM.
    const body = el.querySelector('.my-body');
    expect(body).not.toBeNull();
    expect(body?.textContent).toBe('payload');
  });
});

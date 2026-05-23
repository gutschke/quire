// @vitest-environment happy-dom

/**
 * <rule-hover> tests — Phase B P1d (2026-05-23).
 *
 * The popover is timer-driven (200 ms enter, 100 ms exit in
 * production).  Tests shrink the delays via the
 * `RuleHover.enterDelayMs` / `exitDelayMs` static fields, then use
 * real `setTimeout` waits — happy-dom's AsyncTaskManager hangs
 * under `vi.useFakeTimers`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import './rule-hover';
import { RuleHover } from './rule-hover';

function mount(props: Partial<RuleHover> = {}, slotText = 'child'): RuleHover {
  const el = document.createElement('rule-hover') as RuleHover;
  if (props.text !== undefined) el.text = props.text;
  if (props.placement !== undefined) el.placement = props.placement;
  if (props.ariaLabel !== undefined) el.ariaLabel = props.ariaLabel;
  el.textContent = slotText;
  document.body.appendChild(el);
  return el;
}

/**
 * Wait helper for the test-shortened hover delays.  Real timers
 * because happy-dom + vi.useFakeTimers hangs (the AsyncTaskManager
 * doesn't drain).  We shorten the timers via the static fields so
 * tests stay fast.
 */
const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

describe('<rule-hover>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Shrink the hover delays so tests don't sleep 200/100 ms each.
    RuleHover.enterDelayMs = 5;
    RuleHover.exitDelayMs = 5;
  });

  it('mirrors the text prop to the native title attribute (a11y fallback)', async () => {
    const el = mount({ text: '-1 to WIS rolls' });
    await el.updateComplete;
    expect(el.getAttribute('title')).toBe('-1 to WIS rolls');
  });

  it('updates title when text prop changes', async () => {
    const el = mount({ text: 'first' });
    await el.updateComplete;
    el.text = 'second';
    await el.updateComplete;
    expect(el.getAttribute('title')).toBe('second');
  });

  it('does NOT render a popover initially (only on hover/focus)', async () => {
    const el = mount({ text: 'consequence' });
    await el.updateComplete;
    expect(el.querySelector('.rule-hover-popover')).toBeNull();
  });

  it('opens the popover after the 200ms enter delay on pointerenter', async () => {
    const el = mount({ text: 'consequence' });
    await el.updateComplete;
    const host = el.querySelector('.rule-hover-host')!;
    host.dispatchEvent(new Event('pointerenter'));
    // Before the timer fires:
    expect(el.querySelector('.rule-hover-popover')).toBeNull();
    await wait(15);
    await el.updateComplete;
    expect(el.querySelector('.rule-hover-popover')).not.toBeNull();
  });

  it('closes the popover after the 100ms exit delay on pointerleave', async () => {
    const el = mount({ text: 'consequence' });
    await el.updateComplete;
    const host = el.querySelector('.rule-hover-host')!;
    host.dispatchEvent(new Event('pointerenter'));
    await wait(15);
    await el.updateComplete;
    expect(el.querySelector('.rule-hover-popover')).not.toBeNull();
    host.dispatchEvent(new Event('pointerleave'));
    await wait(15);
    await el.updateComplete;
    expect(el.querySelector('.rule-hover-popover')).toBeNull();
  });

  it('also opens on focusin (keyboard users)', async () => {
    const el = mount({ text: 'consequence' });
    await el.updateComplete;
    const host = el.querySelector('.rule-hover-host')!;
    host.dispatchEvent(new Event('focusin'));
    await wait(15);
    await el.updateComplete;
    expect(el.querySelector('.rule-hover-popover')).not.toBeNull();
  });

  it('does not show popover when text is empty', async () => {
    const el = mount({ text: '' });
    await el.updateComplete;
    const host = el.querySelector('.rule-hover-host')!;
    host.dispatchEvent(new Event('pointerenter'));
    await wait(15);
    await el.updateComplete;
    expect(el.querySelector('.rule-hover-popover')).toBeNull();
  });

  it('cancels enter timer if pointerleave fires before delay elapses', async () => {
    const el = mount({ text: 'consequence' });
    await el.updateComplete;
    const host = el.querySelector('.rule-hover-host')!;
    host.dispatchEvent(new Event('pointerenter'));
    await wait(15); // halfway through the 200ms enter delay
    host.dispatchEvent(new Event('pointerleave'));
    await wait(20); // long past where enter would have fired
    await el.updateComplete;
    expect(el.querySelector('.rule-hover-popover')).toBeNull();
  });

  it('renders the placement class on the popover', async () => {
    const el = mount({ text: 'x', placement: 'below' });
    await el.updateComplete;
    const host = el.querySelector('.rule-hover-host')!;
    host.dispatchEvent(new Event('pointerenter'));
    await wait(15);
    await el.updateComplete;
    const popover = el.querySelector('.rule-hover-popover');
    expect(popover?.classList.contains('rule-hover-popover-below')).toBe(true);
  });

  it('uses ariaLabel override when set, otherwise the text', async () => {
    const elDefault = mount({ text: 'short' });
    await elDefault.updateComplete;
    elDefault.querySelector('.rule-hover-host')!.dispatchEvent(
      new Event('pointerenter')
    );
    await wait(15);
    await elDefault.updateComplete;
    expect(
      elDefault.querySelector('.rule-hover-popover')?.getAttribute('aria-label')
    ).toBe('short');

    document.body.innerHTML = '';
    const elOverride = mount({ text: 'short', ariaLabel: 'a longer description' });
    await elOverride.updateComplete;
    elOverride.querySelector('.rule-hover-host')!.dispatchEvent(
      new Event('pointerenter')
    );
    await wait(15);
    await elOverride.updateComplete;
    expect(
      elOverride
        .querySelector('.rule-hover-popover')
        ?.getAttribute('aria-label')
    ).toBe('a longer description');
  });
});

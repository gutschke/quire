// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './quire-modal';
import type { QuireModal } from './quire-modal';

function mount(): QuireModal {
  const el = document.createElement('quire-modal') as QuireModal;
  document.body.appendChild(el);
  return el;
}

describe('<quire-modal>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a <dialog> wrapping the slotted content', async () => {
    const el = mount();
    el.innerHTML = '<p class="payload">hello</p>';
    await el.updateComplete;
    const dialog = el.querySelector('dialog.quire-modal-dialog');
    expect(dialog).not.toBeNull();
    expect(el.querySelector('.payload')).not.toBeNull();
  });

  it('passes the host element class through (callers keep their per-modal CSS)', async () => {
    const el = mount();
    el.className = 'my-retire-modal';
    await el.updateComplete;
    expect(el.classList.contains('my-retire-modal')).toBe(true);
  });

  it('@cancel event (Esc / native close) invokes onClose', async () => {
    const el = mount();
    let closes = 0;
    el.onClose = () => {
      closes++;
    };
    await el.updateComplete;
    const dialog = el.querySelector('dialog.quire-modal-dialog')!;
    dialog.dispatchEvent(new Event('cancel'));
    expect(closes).toBe(1);
  });

  it('backdrop click invokes onClose when both mousedown + click hit the dialog', async () => {
    const el = mount();
    let closes = 0;
    el.onClose = () => {
      closes++;
    };
    await el.updateComplete;
    const dialog = el.querySelector('dialog.quire-modal-dialog')!;
    // Simulate the drag-from-backdrop sequence.
    const md = new MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(md, 'target', { value: dialog });
    dialog.dispatchEvent(md);
    const clk = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(clk, 'target', { value: dialog });
    dialog.dispatchEvent(clk);
    expect(closes).toBe(1);
  });

  it('drag-select fix: click on dialog but mousedown on inner content does NOT close', async () => {
    const el = mount();
    el.innerHTML = '<p class="inner">text to drag-select</p>';
    let closes = 0;
    el.onClose = () => {
      closes++;
    };
    await el.updateComplete;
    const dialog = el.querySelector('dialog.quire-modal-dialog')!;
    const inner = el.querySelector('.inner')!;
    // mousedown inside the inner content...
    const md = new MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(md, 'target', { value: inner });
    dialog.dispatchEvent(md);
    // ...mouseup ends on the backdrop (dialog).
    const clk = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(clk, 'target', { value: dialog });
    dialog.dispatchEvent(clk);
    // Should NOT close — the user is mid-drag-select.
    expect(closes).toBe(0);
  });

  it('click on inner content does NOT close', async () => {
    const el = mount();
    el.innerHTML = '<button class="inner-btn">x</button>';
    let closes = 0;
    el.onClose = () => {
      closes++;
    };
    await el.updateComplete;
    const dialog = el.querySelector('dialog.quire-modal-dialog')!;
    const inner = el.querySelector('.inner-btn')!;
    const md = new MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(md, 'target', { value: inner });
    dialog.dispatchEvent(md);
    const clk = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(clk, 'target', { value: inner });
    dialog.dispatchEvent(clk);
    expect(closes).toBe(0);
  });

  it('flipping `open` triggers showModal/close (defensively wrapped — happy-dom no-op)', async () => {
    const el = mount();
    await el.updateComplete;
    const dialog = el.querySelector<HTMLDialogElement>(
      'dialog.quire-modal-dialog'
    )!;
    // happy-dom does not implement showModal; this just exercises the
    // sync path without throwing.
    el.open = true;
    await el.updateComplete;
    el.open = false;
    await el.updateComplete;
    expect(dialog).not.toBeNull();
  });
});

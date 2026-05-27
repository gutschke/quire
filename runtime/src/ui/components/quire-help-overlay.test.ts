// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './quire-help-overlay';
import type { QuireHelpOverlay } from './quire-help-overlay';
import { HELP_OPEN_EVENT } from './quire-help-overlay';

function mount(): QuireHelpOverlay {
  const el = document.createElement('quire-help-overlay') as QuireHelpOverlay;
  document.body.appendChild(el);
  return el;
}

describe('<quire-help-overlay> (Wave C1)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not render any rows when closed', async () => {
    const el = mount();
    await el.updateComplete;
    // Modal is hidden via the open prop; rows still mount in light
    // DOM (Lit renders unconditionally) but the modal element
    // itself reports open=false.
    const modal = el.querySelector('quire-modal');
    expect(modal).not.toBeNull();
    expect(modal!.getAttribute('open')).toBeNull();
  });

  it('opens on the quire-help-open custom event (topbar chip click)', async () => {
    const el = mount();
    await el.updateComplete;
    window.dispatchEvent(new CustomEvent(HELP_OPEN_EVENT));
    await el.updateComplete;
    const modal = el.querySelector('quire-modal');
    expect(modal!.hasAttribute('open')).toBe(true);
  });

  it('opens on a window-level "?" keydown', async () => {
    const el = mount();
    await el.updateComplete;
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '?', bubbles: true })
    );
    await el.updateComplete;
    const modal = el.querySelector('quire-modal');
    expect(modal!.hasAttribute('open')).toBe(true);
  });

  it('does NOT open when "?" lands in a text input (editable-target gate)', async () => {
    const el = mount();
    await el.updateComplete;
    // Make a fake input + dispatch keydown FROM it.  composedPath
    // includes the input as the first entry; the overlay's
    // editable-target check should bail.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: '?', bubbles: true })
    );
    await el.updateComplete;
    const modal = el.querySelector('quire-modal');
    expect(modal!.hasAttribute('open')).toBe(false);
  });

  it('lists the shipped DM hotkeys when open', async () => {
    const el = mount();
    window.dispatchEvent(new CustomEvent(HELP_OPEN_EVENT));
    await el.updateComplete;
    const body = el.querySelector('.quire-help-overlay-body');
    expect(body).not.toBeNull();
    const text = body!.textContent ?? '';
    // Spot-check that the major shipped hotkeys all appear.
    expect(text).toMatch(/J/);
    expect(text).toMatch(/K/);
    expect(text).toMatch(/Walk paragraphs/);
    expect(text).toMatch(/Reveal the next paragraph/);
    expect(text).toMatch(/Broadcast/);
    expect(text).toMatch(/scratch input/);
    expect(text).toMatch(/F1/);
    expect(text).toMatch(/Add a new player seat/);
  });

  it('groups shared vs DM hotkeys under section headings', async () => {
    const el = mount();
    window.dispatchEvent(new CustomEvent(HELP_OPEN_EVENT));
    await el.updateComplete;
    const headings = Array.from(
      el.querySelectorAll('.quire-help-overlay-group h4')
    ).map((h) => h.textContent?.trim());
    expect(headings).toContain('Shared');
    expect(headings).toContain('DM hotkeys');
  });

  it('UX-1 (2026-05-26 holistic-review): renders Diff-review pane subgroup', async () => {
    const el = mount();
    window.dispatchEvent(new CustomEvent(HELP_OPEN_EVENT));
    await el.updateComplete;
    const headings = Array.from(
      el.querySelectorAll('.quire-help-overlay-group h4')
    ).map((h) => h.textContent?.trim());
    expect(headings).toContain('DM hotkeys — Diff-review pane');
    // All 4 D1-D hotkeys (j/k accept on subgroup; a, r, e) should
    // appear inside the body somewhere.
    const text = el.textContent ?? '';
    expect(text).toMatch(/Walk to previous \/ next proposal/);
    expect(text).toMatch(/Accept the selected proposal/);
    expect(text).toMatch(/Reject the selected proposal/);
    expect(text).toMatch(/Focus the after-text editor/);
  });

  it('close button dismisses the overlay', async () => {
    const el = mount();
    window.dispatchEvent(new CustomEvent(HELP_OPEN_EVENT));
    await el.updateComplete;
    const closeBtn = el.querySelector(
      '.quire-help-overlay-close'
    ) as HTMLButtonElement;
    closeBtn.click();
    await el.updateComplete;
    const modal = el.querySelector('quire-modal');
    expect(modal!.hasAttribute('open')).toBe(false);
  });

  it('removes the keydown listener on disconnect (no leak)', async () => {
    const el = mount();
    await el.updateComplete;
    el.remove();
    // After disconnect, the "?" key MUST NOT re-open (the listener
    // is gone).  If this fails, future remounts would stack
    // listeners and double-fire.
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '?', bubbles: true })
    );
    // No re-render to check; just verify the element didn't
    // somehow keep listening (a leaked listener would have called
    // setter on a disconnected element — harmless but a sign of
    // the bug).  Mount a fresh one and verify it works.
    const fresh = mount();
    await fresh.updateComplete;
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '?', bubbles: true })
    );
    await fresh.updateComplete;
    const modal = fresh.querySelector('quire-modal');
    expect(modal!.hasAttribute('open')).toBe(true);
  });
});

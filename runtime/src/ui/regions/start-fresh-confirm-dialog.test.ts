// @vitest-environment happy-dom

/**
 * Tests for <start-fresh-confirm-dialog> (run #17 P0 fix).
 *
 * Coverage mirrors <cloud-push-consent-dialog>:
 *   - renders nothing until open() is called
 *   - open(spec) renders title + slug + body + buttons
 *   - destructive variant body lists chargen drafts + peer-disconnect
 *   - safe variant body says cloud copy is untouched
 *   - confirm resolves true
 *   - cancel resolves false
 *   - Escape key resolves false
 *   - backdrop click resolves false
 *   - clicking INSIDE the dialog does NOT resolve
 *   - double-open: prior promise gets resolved false before the
 *     new one opens
 *   - disconnectedCallback resolves pending promise false
 *   - event count surfaces in destructive variant when provided
 */

import { afterEach, describe, expect, it } from 'vitest';
import { html, render } from 'lit';
import './start-fresh-confirm-dialog';
import type {
  StartFreshConfirmDialog,
  StartFreshConfirmSpec
} from './start-fresh-confirm-dialog';

const destructiveSpec: StartFreshConfirmSpec = {
  campaignName: 'Underleaf',
  campaignSlug: 'gutschke/underleaf',
  eventCount: 87,
  variant: 'destructive'
};

const safeSpec: StartFreshConfirmSpec = {
  campaignName: 'Underleaf',
  campaignSlug: 'gutschke/underleaf',
  variant: 'safe'
};

function mountDialog(): StartFreshConfirmDialog {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(
    html`<start-fresh-confirm-dialog></start-fresh-confirm-dialog>`,
    host
  );
  const el = host.querySelector(
    'start-fresh-confirm-dialog'
  ) as StartFreshConfirmDialog;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<start-fresh-confirm-dialog>', () => {
  it('renders nothing until open() is called', async () => {
    const el = mountDialog();
    await el.updateComplete;
    expect(el.querySelector('[data-testid=start-fresh-dialog]')).toBeNull();
  });

  it('open(destructive) renders title, slug, body, buttons', async () => {
    const el = mountDialog();
    void el.open(destructiveSpec);
    await el.updateComplete;
    const dlg = el.querySelector('[data-testid=start-fresh-dialog]');
    expect(dlg).not.toBeNull();
    expect(dlg?.getAttribute('data-variant')).toBe('destructive');
    expect(el.querySelector('#start-fresh-title')?.textContent).toContain(
      'Discard the saved session for Underleaf?'
    );
    expect(
      el.querySelector('[data-testid=start-fresh-slug]')?.textContent?.trim()
    ).toBe('gutschke/underleaf');
    // Event count surfaces.
    const body = el.querySelector('.start-fresh-body')?.textContent ?? '';
    expect(body).toContain('87 events');
    // Cloud-untouched promise surfaces.
    expect(body).toMatch(/Cloud backups.*NOT touched/i);
    // Chargen-drafts call-out surfaces.
    expect(body).toMatch(/character drafts/i);
    // Player-empty-session call-out surfaces.
    expect(body).toMatch(/Players who reconnect/i);
    // Confirm button is labelled "Discard saved session".
    const confirm = el.querySelector('[data-testid=start-fresh-confirm]');
    expect(confirm?.textContent?.trim()).toBe('Discard saved session');
    expect(confirm?.getAttribute('data-destructive')).toBe('true');
  });

  it('open(safe) renders the cross-device variant body', async () => {
    const el = mountDialog();
    void el.open(safeSpec);
    await el.updateComplete;
    const dlg = el.querySelector('[data-testid=start-fresh-dialog]');
    expect(dlg?.getAttribute('data-variant')).toBe('safe');
    expect(el.querySelector('#start-fresh-title')?.textContent).toContain(
      'Dismiss the cross-device backup prompt'
    );
    const body = el.querySelector('.start-fresh-body')?.textContent ?? '';
    expect(body).toMatch(/backup file.*NOT touched/i);
    const confirm = el.querySelector('[data-testid=start-fresh-confirm]');
    expect(confirm?.textContent?.trim()).toBe('Dismiss prompt');
    expect(confirm?.getAttribute('data-destructive')).toBe('false');
  });

  it('confirm button resolves true', async () => {
    const el = mountDialog();
    const p = el.open(destructiveSpec);
    await el.updateComplete;
    const confirm = el.querySelector(
      '[data-testid=start-fresh-confirm]'
    ) as HTMLButtonElement;
    confirm.click();
    await expect(p).resolves.toBe(true);
  });

  it('cancel button resolves false', async () => {
    const el = mountDialog();
    const p = el.open(destructiveSpec);
    await el.updateComplete;
    const cancel = el.querySelector(
      '[data-testid=start-fresh-cancel]'
    ) as HTMLButtonElement;
    cancel.click();
    await expect(p).resolves.toBe(false);
  });

  it('Escape key resolves false', async () => {
    const el = mountDialog();
    const p = el.open(destructiveSpec);
    await el.updateComplete;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(p).resolves.toBe(false);
  });

  it('backdrop click resolves false', async () => {
    const el = mountDialog();
    const p = el.open(destructiveSpec);
    await el.updateComplete;
    const backdrop = el.querySelector(
      '[data-testid=start-fresh-backdrop]'
    ) as HTMLElement;
    backdrop.click();
    await expect(p).resolves.toBe(false);
  });

  it('click inside the dialog does NOT resolve', async () => {
    const el = mountDialog();
    const p = el.open(destructiveSpec);
    await el.updateComplete;
    const dlg = el.querySelector(
      '[data-testid=start-fresh-dialog]'
    ) as HTMLElement;
    dlg.click();
    await el.updateComplete;
    // Promise should still be pending.  Race a sentinel.
    const settled = await Promise.race([
      p.then(() => 'settled' as const),
      Promise.resolve('pending' as const)
    ]);
    expect(settled).toBe('pending');
    // Clean up the pending resolver.
    const cancel = el.querySelector(
      '[data-testid=start-fresh-cancel]'
    ) as HTMLButtonElement;
    cancel.click();
    await p;
  });

  it('double-open resolves the prior promise with false', async () => {
    const el = mountDialog();
    const first = el.open(destructiveSpec);
    await el.updateComplete;
    const second = el.open(safeSpec);
    await el.updateComplete;
    await expect(first).resolves.toBe(false);
    // Second is still pending; cancel it for cleanup.
    const cancel = el.querySelector(
      '[data-testid=start-fresh-cancel]'
    ) as HTMLButtonElement;
    cancel.click();
    await expect(second).resolves.toBe(false);
  });

  it('disconnectedCallback resolves any pending promise with false', async () => {
    const el = mountDialog();
    const p = el.open(destructiveSpec);
    await el.updateComplete;
    // Detach from DOM.
    el.parentElement?.removeChild(el);
    await expect(p).resolves.toBe(false);
  });

  it('destructive variant without eventCount uses a fallback line', async () => {
    const el = mountDialog();
    void el.open({
      campaignName: 'Underleaf',
      campaignSlug: 'gutschke/underleaf',
      variant: 'destructive'
    });
    await el.updateComplete;
    const body = el.querySelector('.start-fresh-body')?.textContent ?? '';
    expect(body).toMatch(/saved session for gutschke\/underleaf will be deleted/i);
    // No bogus "0 events" line.
    expect(body).not.toMatch(/0 events/);
  });

  it('single-event destructive variant pluralizes correctly', async () => {
    const el = mountDialog();
    void el.open({
      campaignName: 'Underleaf',
      campaignSlug: 'gutschke/underleaf',
      eventCount: 1,
      variant: 'destructive'
    });
    await el.updateComplete;
    const body = el.querySelector('.start-fresh-body')?.textContent ?? '';
    expect(body).toContain('1 event ');
    expect(body).not.toContain('1 events');
  });
});

// @vitest-environment happy-dom

/**
 * Tests for <cloud-push-consent-dialog>.
 *
 * Coverage:
 *   - renders nothing until open() is called (defensive default)
 *   - open(spec) renders title + body paragraphs + buttons
 *   - acknowledge resolves true
 *   - cancel resolves false
 *   - Escape key resolves false
 *   - backdrop click resolves false
 *   - clicking INSIDE the dialog does NOT resolve
 *   - double-open: prior promise gets resolved false before the
 *     new one opens
 *   - disconnectedCallback resolves pending promise false (no
 *     hung callers)
 *   - DEFAULT_CONSENT_COPY_FS_API renders as expected
 *
 * Driven via happy-dom + Lit's updateComplete; no Playwright.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { html, render } from 'lit';
import './cloud-push-consent-dialog';
import type { CloudPushConsentDialog } from './cloud-push-consent-dialog';
import {
  DEFAULT_CONSENT_COPY_FS_API,
  type ConsentDialogCopySpec
} from '../../auth/cloud-push-consent';

const sampleSpec: ConsentDialogCopySpec = {
  title: 'Test consent',
  body: ['Paragraph one.', 'Paragraph two.'],
  acknowledgeLabel: 'OK',
  cancelLabel: 'Nope'
};

function mountDialog(): CloudPushConsentDialog {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(
    html`<cloud-push-consent-dialog></cloud-push-consent-dialog>`,
    host
  );
  const el = host.querySelector(
    'cloud-push-consent-dialog'
  ) as CloudPushConsentDialog;
  return el;
}

describe('<cloud-push-consent-dialog>', () => {
  let mounted: CloudPushConsentDialog | null = null;

  beforeEach(() => {
    mounted = null;
  });

  afterEach(() => {
    if (mounted?.parentElement) {
      mounted.parentElement.remove();
    }
    mounted = null;
  });

  it('renders nothing until open() is called', async () => {
    const el = mountDialog();
    mounted = el;
    await el.updateComplete;
    expect(el.querySelector('[data-testid="cloud-consent-dialog"]')).toBe(null);
    expect(el.querySelector('[data-testid="cloud-consent-backdrop"]')).toBe(
      null
    );
  });

  it('open(spec) renders title + body paragraphs + both buttons', async () => {
    const el = mountDialog();
    mounted = el;
    el.open(sampleSpec);
    await el.updateComplete;
    const titleEl = el.querySelector('#cloud-consent-title');
    expect(titleEl?.textContent?.trim()).toBe('Test consent');
    const paras = el.querySelectorAll('.cloud-consent-body p');
    expect(paras.length).toBe(2);
    expect(paras[0]?.textContent?.trim()).toBe('Paragraph one.');
    expect(paras[1]?.textContent?.trim()).toBe('Paragraph two.');
    const ack = el.querySelector('[data-testid="cloud-consent-acknowledge"]');
    const cancel = el.querySelector('[data-testid="cloud-consent-cancel"]');
    expect(ack?.textContent?.trim()).toBe('OK');
    expect(cancel?.textContent?.trim()).toBe('Nope');
  });

  it('clicking acknowledge resolves true', async () => {
    const el = mountDialog();
    mounted = el;
    const pending = el.open(sampleSpec);
    await el.updateComplete;
    const ack = el.querySelector(
      '[data-testid="cloud-consent-acknowledge"]'
    ) as HTMLButtonElement;
    ack.click();
    const result = await pending;
    expect(result).toBe(true);
    await el.updateComplete;
    // Dialog should be closed.
    expect(el.querySelector('[data-testid="cloud-consent-dialog"]')).toBe(null);
  });

  it('clicking cancel resolves false', async () => {
    const el = mountDialog();
    mounted = el;
    const pending = el.open(sampleSpec);
    await el.updateComplete;
    const cancel = el.querySelector(
      '[data-testid="cloud-consent-cancel"]'
    ) as HTMLButtonElement;
    cancel.click();
    const result = await pending;
    expect(result).toBe(false);
  });

  it('Escape key resolves false', async () => {
    const el = mountDialog();
    mounted = el;
    const pending = el.open(sampleSpec);
    await el.updateComplete;
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    document.dispatchEvent(event);
    const result = await pending;
    expect(result).toBe(false);
  });

  it('clicking backdrop (outside dialog) resolves false', async () => {
    const el = mountDialog();
    mounted = el;
    const pending = el.open(sampleSpec);
    await el.updateComplete;
    const backdrop = el.querySelector(
      '[data-testid="cloud-consent-backdrop"]'
    ) as HTMLElement;
    // Simulate a backdrop click with target === currentTarget.
    backdrop.click();
    const result = await pending;
    expect(result).toBe(false);
  });

  it('clicking inside the dialog does NOT resolve', async () => {
    const el = mountDialog();
    mounted = el;
    const pending = el.open(sampleSpec);
    await el.updateComplete;
    const dialog = el.querySelector(
      '[data-testid="cloud-consent-dialog"]'
    ) as HTMLElement;
    dialog.click();
    // Resolve manually after a microtask to confirm pending is
    // still pending.
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    // Cleanup — cancel so the promise resolves.
    const cancel = el.querySelector(
      '[data-testid="cloud-consent-cancel"]'
    ) as HTMLButtonElement;
    cancel.click();
    await pending;
  });

  it('double-open: prior promise resolves false before new opens', async () => {
    const el = mountDialog();
    mounted = el;
    const first = el.open(sampleSpec);
    await el.updateComplete;
    const second = el.open({
      ...sampleSpec,
      title: 'Second prompt'
    });
    const firstResult = await first;
    expect(firstResult).toBe(false);
    await el.updateComplete;
    const titleEl = el.querySelector('#cloud-consent-title');
    expect(titleEl?.textContent?.trim()).toBe('Second prompt');
    // Cleanup.
    const cancel = el.querySelector(
      '[data-testid="cloud-consent-cancel"]'
    ) as HTMLButtonElement;
    cancel.click();
    await second;
  });

  it('disconnectedCallback resolves pending promise false', async () => {
    const el = mountDialog();
    mounted = el;
    const pending = el.open(sampleSpec);
    await el.updateComplete;
    el.parentElement?.remove();
    mounted = null;
    const result = await pending;
    expect(result).toBe(false);
  });

  it('Escape does nothing when dialog is closed', async () => {
    const el = mountDialog();
    mounted = el;
    await el.updateComplete;
    // No promise to await; just confirm no exception + DOM remains
    // empty.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await el.updateComplete;
    expect(el.querySelector('[data-testid="cloud-consent-dialog"]')).toBe(null);
  });

  it('renders DEFAULT_CONSENT_COPY_FS_API with all required body paragraphs', async () => {
    const el = mountDialog();
    mounted = el;
    const pending = el.open(DEFAULT_CONSENT_COPY_FS_API);
    await el.updateComplete;
    const titleEl = el.querySelector('#cloud-consent-title');
    expect(titleEl?.textContent).toContain('Backing up your table');
    const paras = el.querySelectorAll('.cloud-consent-body p');
    expect(paras.length).toBe(DEFAULT_CONSENT_COPY_FS_API.body.length);
    // The locked principles assert: must name the destination
    // (folder) + reassure about player visibility + once-per-
    // campaign framing.
    const all = Array.from(paras)
      .map((p) => p.textContent ?? '')
      .join(' ');
    expect(all).toContain('folder');
    expect(all).toContain('Players can read what they have written');
    expect(all).toContain('once per campaign');
    const cancel = el.querySelector(
      '[data-testid="cloud-consent-cancel"]'
    ) as HTMLButtonElement;
    cancel.click();
    await pending;
  });
});

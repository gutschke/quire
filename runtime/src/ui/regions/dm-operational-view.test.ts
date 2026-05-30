// @vitest-environment happy-dom

/**
 * Tests for <dm-operational-view>.
 *
 * Coverage:
 *   - renderForDm=false → renders the player-side "DM is
 *     checking the table's gear" placeholder (no leakage of
 *     WHAT the DM is doing — silent-player firewall).
 *   - renderForDm=true + campaignId='' → renders the
 *     "no active session" placeholder
 *   - renderForDm=true + campaignId + fsApiCloudPush →
 *     <backups-card> mounts with the right props
 *   - Close button dispatches `dm-operational-close`
 *   - Escape key dispatches `dm-operational-close`
 *   - Escape inside the consent dialog does NOT close the view
 *     (focus inside cloud-push-consent-dialog → no-op)
 */

import { afterEach, describe, expect, it } from 'vitest';
import { html, render } from 'lit';
import './dm-operational-view';
import type { DmOperationalView } from './dm-operational-view';
import { inMemoryFsApiHandleStorage } from '../../auth/fs-api-handle-store';
import { inMemoryConsentStorage } from '../../auth/cloud-push-consent';
import { FsApiCloudPush } from '../../auth/fs-api-cloud-push';

const CHROME_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function makeCloudPush(): FsApiCloudPush {
  return new FsApiCloudPush({
    env: {
      showDirectoryPicker: () => Promise.resolve({}),
      userAgent: CHROME_DESKTOP
    } as unknown as ConstructorParameters<typeof FsApiCloudPush>[0]['env'],
    picker: () => Promise.reject(new Error('picker not stubbed')),
    handleStorage: inMemoryFsApiHandleStorage(),
    consentStorage: inMemoryConsentStorage(),
    now: () => Date.now()
  });
}

function mountView(props: {
  renderForDm: boolean;
  campaignId: string;
  cloudPush?: FsApiCloudPush | null;
}): { view: DmOperationalView; host: HTMLDivElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(
    html`<dm-operational-view
      ?renderForDm=${props.renderForDm}
      .campaignId=${props.campaignId}
      .fsApiCloudPush=${props.cloudPush ?? null}
    ></dm-operational-view>`,
    host
  );
  const view = host.querySelector(
    'dm-operational-view'
  ) as DmOperationalView;
  return { view, host };
}

describe('<dm-operational-view>', () => {
  let active: HTMLDivElement | null = null;

  afterEach(() => {
    if (active) active.remove();
    active = null;
  });

  it('renderForDm=false renders the silent-player fallback', async () => {
    const { view, host } = mountView({
      renderForDm: false,
      campaignId: 'a/b'
    });
    active = host;
    await view.updateComplete;
    expect(
      view.querySelector('[data-testid="dm-operational-view"]')
    ).toBe(null);
    const fallback = view.querySelector('.dm-operational-player-fallback');
    expect(fallback).not.toBe(null);
    expect(fallback?.textContent).toContain("checking the table's gear");
    // Defense-in-depth: no reference to backups or cloud
    // anywhere in the DOM.
    const text = view.textContent ?? '';
    expect(text.toLowerCase()).not.toContain('backup');
    expect(text.toLowerCase()).not.toContain('cloud');
    expect(text.toLowerCase()).not.toContain('drive');
    expect(text.toLowerCase()).not.toContain('folder');
  });

  it('renderForDm=true + empty campaignId renders the "no active session" placeholder', async () => {
    const { view, host } = mountView({
      renderForDm: true,
      campaignId: ''
    });
    active = host;
    await view.updateComplete;
    expect(
      view.querySelector('[data-testid="dm-operational-view"]')
    ).not.toBe(null);
    expect(
      view.querySelector('[data-testid="dm-operational-backups-section"]')
    ).toBe(null);
    expect(view.textContent).toContain('No active session');
  });

  it('renderForDm=true + campaignId + cloudPush mounts <backups-card>', async () => {
    const cloudPush = makeCloudPush();
    const { view, host } = mountView({
      renderForDm: true,
      campaignId: 'underleaf/example@main',
      cloudPush
    });
    active = host;
    await view.updateComplete;
    const section = view.querySelector(
      '[data-testid="dm-operational-backups-section"]'
    );
    expect(section).not.toBe(null);
    const card = section?.querySelector('backups-card');
    expect(card).not.toBe(null);
    // Wait for the card to settle its first refresh.
    await new Promise<void>((r) => setTimeout(r, 0));
    await (card as unknown as { updateComplete: Promise<unknown> })
      .updateComplete;
  });

  it('Close button dispatches dm-operational-close', async () => {
    const { view, host } = mountView({
      renderForDm: true,
      campaignId: 'a/b'
    });
    active = host;
    await view.updateComplete;
    const events: Event[] = [];
    view.addEventListener('dm-operational-close', (e) => events.push(e));
    const close = view.querySelector(
      '[data-testid="dm-operational-close"]'
    ) as HTMLButtonElement;
    close.click();
    expect(events.length).toBe(1);
  });

  it('Escape key dispatches dm-operational-close', async () => {
    const { view, host } = mountView({
      renderForDm: true,
      campaignId: 'a/b'
    });
    active = host;
    await view.updateComplete;
    const events: Event[] = [];
    view.addEventListener('dm-operational-close', (e) => events.push(e));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(events.length).toBe(1);
  });

  it('Escape with focus inside the consent dialog does NOT close the view', async () => {
    const { view, host } = mountView({
      renderForDm: true,
      campaignId: 'a/b'
    });
    active = host;
    await view.updateComplete;

    // Mount a fake consent dialog that focus can sit inside.
    const dlg = document.createElement('cloud-push-consent-dialog');
    const innerButton = document.createElement('button');
    innerButton.textContent = 'in-dialog';
    dlg.appendChild(innerButton);
    document.body.appendChild(dlg);
    innerButton.focus();
    expect(document.activeElement).toBe(innerButton);

    const events: Event[] = [];
    view.addEventListener('dm-operational-close', (e) => events.push(e));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(events.length).toBe(0);
    dlg.remove();
  });

  it('Escape with renderForDm=false is a no-op', async () => {
    const { view, host } = mountView({
      renderForDm: false,
      campaignId: 'a/b'
    });
    active = host;
    await view.updateComplete;
    const events: Event[] = [];
    view.addEventListener('dm-operational-close', (e) => events.push(e));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(events.length).toBe(0);
  });
});

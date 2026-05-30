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
import type {
  DmOperationalView,
  ManageSeatRow,
  PcRevokeRequestDetail
} from './dm-operational-view';
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
  manageSeats?: readonly ManageSeatRow[];
  availableNpcs?: readonly { id: string; name: string }[];
}): { view: DmOperationalView; host: HTMLDivElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(
    html`<dm-operational-view
      ?renderForDm=${props.renderForDm}
      .campaignId=${props.campaignId}
      .fsApiCloudPush=${props.cloudPush ?? null}
      .manageSeats=${props.manageSeats ?? []}
      .availableNpcs=${props.availableNpcs ?? []}
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

// ---------------------------------------------------------------------
// Run #18 (2026-05-30) — Manage seats section (DEC-044 / TTRPG-expert
// player-removal advisory).  Per-seat collapsible disclosure surfaces
// "Reset character (recast)" + "Remove player from this seat" routing
// to the pc-revoke event via the host-bridged pc-revoke-confirm-
// dialog.
// ---------------------------------------------------------------------
describe('<dm-operational-view> — Manage seats (Run #18)', () => {
  let active: HTMLDivElement | null = null;
  afterEach(() => {
    if (active) active.remove();
    active = null;
  });

  it('empty manageSeats renders the no-bound-seats placeholder', async () => {
    const { view, host } = mountView({
      renderForDm: true,
      campaignId: 'a/b',
      manageSeats: []
    });
    active = host;
    await view.updateComplete;
    expect(
      view.querySelector(
        '[data-testid="dm-operational-manage-seats-section"]'
      )
    ).not.toBe(null);
    expect(
      view.querySelector(
        '[data-testid="dm-operational-manage-seats-empty"]'
      )
    ).not.toBe(null);
  });

  it('one bound-active seat: row collapses by default, click expands; expanded body shows both destructive options', async () => {
    const { view, host } = mountView({
      renderForDm: true,
      campaignId: 'a/b',
      manageSeats: [
        {
          slot: 1,
          state: 'bound-active',
          pcId: 'mei',
          pcDisplayName: 'Mei',
          inboundBondSourceDisplayNames: []
        }
      ]
    });
    active = host;
    await view.updateComplete;
    // PLACEMENT: row is present.
    const row = view.querySelector(
      '[data-testid="dm-operational-manage-seat-row"]'
    );
    expect(row).not.toBe(null);
    // STATE: body is collapsed (not present in DOM).
    expect(
      view.querySelector('[data-testid="dm-operational-manage-seat-body-1"]')
    ).toBe(null);
    // STATE: click the toggle.
    const toggle = view.querySelector(
      '[data-testid="dm-operational-manage-seat-toggle-1"]'
    ) as HTMLButtonElement;
    toggle.click();
    await view.updateComplete;
    // STATE: body is now present and shows BOTH destructive buttons.
    expect(
      view.querySelector('[data-testid="dm-operational-manage-seat-body-1"]')
    ).not.toBe(null);
    expect(
      view.querySelector('[data-testid="dm-operational-manage-seat-reset-1"]')
    ).not.toBe(null);
    expect(
      view.querySelector('[data-testid="dm-operational-manage-seat-remove-1"]')
    ).not.toBe(null);
  });

  it('non-active seat (revoked): expanded body shows an explanatory message instead of destructive buttons', async () => {
    const { view, host } = mountView({
      renderForDm: true,
      campaignId: 'a/b',
      manageSeats: [
        {
          slot: 1,
          state: 'revoked',
          pcId: undefined,
          pcDisplayName: 'Open seat',
          inboundBondSourceDisplayNames: []
        }
      ]
    });
    active = host;
    await view.updateComplete;
    (
      view.querySelector(
        '[data-testid="dm-operational-manage-seat-toggle-1"]'
      ) as HTMLButtonElement
    ).click();
    await view.updateComplete;
    // PLACEMENT: no destructive buttons surface.
    expect(
      view.querySelector('[data-testid="dm-operational-manage-seat-reset-1"]')
    ).toBe(null);
    expect(
      view.querySelector('[data-testid="dm-operational-manage-seat-remove-1"]')
    ).toBe(null);
    // PLACEMENT: explanatory text mentions the seat state.
    const body = view.querySelector(
      '[data-testid="dm-operational-manage-seat-body-1"]'
    );
    expect(body?.textContent).toContain('revoked');
  });

  it('Reset character (recast) opens the pc-revoke-confirm-dialog with the right variant; Cancel emits NO event', async () => {
    const { view, host } = mountView({
      renderForDm: true,
      campaignId: 'a/b',
      manageSeats: [
        {
          slot: 1,
          state: 'bound-active',
          pcId: 'mei',
          pcDisplayName: 'Mei',
          inboundBondSourceDisplayNames: []
        }
      ]
    });
    active = host;
    await view.updateComplete;
    (
      view.querySelector(
        '[data-testid="dm-operational-manage-seat-toggle-1"]'
      ) as HTMLButtonElement
    ).click();
    await view.updateComplete;
    const events: Array<CustomEvent<PcRevokeRequestDetail>> = [];
    view.addEventListener('pc-revoke-request', (e) =>
      events.push(e as CustomEvent<PcRevokeRequestDetail>)
    );
    // Click "Reset character (recast)" — dialog opens.
    (
      view.querySelector(
        '[data-testid="dm-operational-manage-seat-reset-1"]'
      ) as HTMLButtonElement
    ).click();
    await view.updateComplete;
    // STATE: dialog is open with the reset-character variant.
    const dialog = view.querySelector('[data-testid="pc-revoke-dialog"]');
    expect(dialog).not.toBe(null);
    expect(dialog?.getAttribute('data-variant')).toBe('reset-character');
    // STATE: cancel the dialog — pc-revoke-request must NOT fire.
    (
      view.querySelector(
        '[data-testid="pc-revoke-cancel"]'
      ) as HTMLButtonElement
    ).click();
    await view.updateComplete;
    expect(events.length).toBe(0);
  });

  it('Remove player → Confirm emits pc-revoke-request with the chosen narrativeShape + bondTombstoneName', async () => {
    const { view, host } = mountView({
      renderForDm: true,
      campaignId: 'a/b',
      manageSeats: [
        {
          slot: 1,
          state: 'bound-active',
          pcId: 'mei',
          pcDisplayName: 'Mei',
          inboundBondSourceDisplayNames: ['Kasumi']
        }
      ]
    });
    active = host;
    await view.updateComplete;
    (
      view.querySelector(
        '[data-testid="dm-operational-manage-seat-toggle-1"]'
      ) as HTMLButtonElement
    ).click();
    await view.updateComplete;
    const events: Array<CustomEvent<PcRevokeRequestDetail>> = [];
    view.addEventListener('pc-revoke-request', (e) =>
      events.push(e as CustomEvent<PcRevokeRequestDetail>)
    );
    (
      view.querySelector(
        '[data-testid="dm-operational-manage-seat-remove-1"]'
      ) as HTMLButtonElement
    ).click();
    await view.updateComplete;
    // STATE: switch the narrative shape to 'never-arrived'.
    const neverArrived = view.querySelector(
      '[data-testid="pc-revoke-shape-never-arrived"]'
    ) as HTMLInputElement;
    neverArrived.checked = true;
    neverArrived.dispatchEvent(new Event('change'));
    // STATE: type a stand-in name.
    const input = view.querySelector(
      '[data-testid="pc-revoke-tombstone-input"]'
    ) as HTMLInputElement;
    input.value = 'an old colleague';
    input.dispatchEvent(new Event('input'));
    await view.updateComplete;
    // Confirm.
    (
      view.querySelector(
        '[data-testid="pc-revoke-confirm"]'
      ) as HTMLButtonElement
    ).click();
    await view.updateComplete;
    // STATE: the host bridge fired a single pc-revoke-request.
    expect(events.length).toBe(1);
    const detail = events[0].detail;
    expect(detail.pcId).toBe('mei');
    expect(detail.slot).toBe(1);
    expect(detail.narrativeShape).toBe('never-arrived');
    expect(detail.bondTombstoneName).toBe('an old colleague');
    expect(detail.bondTombstoneNpcId).toBeUndefined();
  });

  it('Bond NPC reassignment: selecting an NPC in the dialog propagates targetNpcId + name on the event', async () => {
    const { view, host } = mountView({
      renderForDm: true,
      campaignId: 'a/b',
      manageSeats: [
        {
          slot: 1,
          state: 'bound-active',
          pcId: 'mei',
          pcDisplayName: 'Mei',
          inboundBondSourceDisplayNames: ['Kasumi']
        }
      ],
      availableNpcs: [{ id: 'mateo', name: 'Mateo' }]
    });
    active = host;
    await view.updateComplete;
    (
      view.querySelector(
        '[data-testid="dm-operational-manage-seat-toggle-1"]'
      ) as HTMLButtonElement
    ).click();
    await view.updateComplete;
    const events: Array<CustomEvent<PcRevokeRequestDetail>> = [];
    view.addEventListener('pc-revoke-request', (e) =>
      events.push(e as CustomEvent<PcRevokeRequestDetail>)
    );
    (
      view.querySelector(
        '[data-testid="dm-operational-manage-seat-remove-1"]'
      ) as HTMLButtonElement
    ).click();
    await view.updateComplete;
    // PLACEMENT: the NPC selector surfaces with the host-supplied NPC.
    const select = view.querySelector(
      '[data-testid="pc-revoke-npc-select"]'
    ) as HTMLSelectElement;
    expect(select).not.toBe(null);
    // STATE: pick Mateo.
    select.value = 'mateo';
    select.dispatchEvent(new Event('change'));
    await view.updateComplete;
    // Confirm.
    (
      view.querySelector(
        '[data-testid="pc-revoke-confirm"]'
      ) as HTMLButtonElement
    ).click();
    await view.updateComplete;
    expect(events.length).toBe(1);
    expect(events[0].detail.bondTombstoneNpcId).toBe('mateo');
    expect(events[0].detail.bondTombstoneName).toBe('Mateo');
  });

  it('After successful confirmation the seat row collapses (clean state for next action)', async () => {
    const { view, host } = mountView({
      renderForDm: true,
      campaignId: 'a/b',
      manageSeats: [
        {
          slot: 1,
          state: 'bound-active',
          pcId: 'mei',
          pcDisplayName: 'Mei',
          inboundBondSourceDisplayNames: []
        }
      ]
    });
    active = host;
    await view.updateComplete;
    (
      view.querySelector(
        '[data-testid="dm-operational-manage-seat-toggle-1"]'
      ) as HTMLButtonElement
    ).click();
    await view.updateComplete;
    // Confirm shouldn't crash even with no inbound bonds.
    (
      view.querySelector(
        '[data-testid="dm-operational-manage-seat-remove-1"]'
      ) as HTMLButtonElement
    ).click();
    await view.updateComplete;
    // Listen for the request event so the test only proceeds AFTER
    // the async requestRevoke() promise resolves (which also fires
    // the collapse).  Avoids racing the awaited updateComplete chain.
    const eventArrived = new Promise<void>((resolve) => {
      view.addEventListener('pc-revoke-request', () => resolve(), {
        once: true
      });
    });
    (
      view.querySelector(
        '[data-testid="pc-revoke-confirm"]'
      ) as HTMLButtonElement
    ).click();
    await eventArrived;
    await view.updateComplete;
    // STATE: seat body is collapsed after the confirm.
    expect(
      view.querySelector('[data-testid="dm-operational-manage-seat-body-1"]')
    ).toBe(null);
  });

  it('Player-side render (renderForDm=false) does NOT surface the Manage seats section', async () => {
    const { view, host } = mountView({
      renderForDm: false,
      campaignId: 'a/b',
      manageSeats: [
        {
          slot: 1,
          state: 'bound-active',
          pcId: 'mei',
          pcDisplayName: 'Mei',
          inboundBondSourceDisplayNames: []
        }
      ]
    });
    active = host;
    await view.updateComplete;
    // PLACEMENT: the section is absent from the player-side render.
    expect(
      view.querySelector(
        '[data-testid="dm-operational-manage-seats-section"]'
      )
    ).toBe(null);
    // Sanity: the silent-player fallback is still present.
    expect(view.textContent).toContain("checking the table's gear");
  });
});

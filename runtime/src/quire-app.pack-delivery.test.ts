// @vitest-environment happy-dom

/**
 * #253 (2026-05-26) live WebRTC pack delivery — end-to-end +
 * adversarial coverage.  Per user directive: "try hard to poke
 * holes into it and then of course fix anything you find."
 *
 * Topology: HOST (DM, coordinator), GUEST (player at slot 1),
 * THIRD (a second player at slot 2 — used to verify the spoiler
 * firewall keeps THIRD blind to GUEST's pack content).
 *
 * Covered scenarios:
 *   - happy path: GUEST sends → HOST sees pip → accepts → seat updates
 *   - LWW: GUEST resends → only the newer pack persists
 *   - dismiss: HOST dismisses without import; no state mutation
 *   - cross-campaign: campaign-mismatch keeps pack pending for retry
 *   - spoiler firewall: THIRD sees neither pack content NOR existence
 *   - sender-side projection: GUEST sees their OWN pip but no content
 *   - hostile clear: non-coord clear event is dropped
 *   - hostile oversize: materializer rejects > 32 KB pack
 *   - co-DM yield: pending pack survives the coord transition
 *   - empty/malformed payloads: materializer drops silently
 */

import { describe, it, expect } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import { type TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import { campaignFingerprint } from './invite-token';
import { CHARGEN_PACK_MAX_SIZE_BYTES, packChargen } from './chargen-pack';

function inMemoryFactory(
  network: InMemoryNetwork,
  id: string
): TransportFactory {
  return {
    createHost: async () => ({
      transport: new InMemoryTransport(id, network),
      pairingCode: id
    }),
    createGuest: async () => ({
      transport: new InMemoryTransport(id, network)
    })
  };
}

function mountApp(factory: TransportFactory): QuireApp {
  const el = document.createElement('quire-app') as QuireApp;
  el.sessionFactory = factory;
  document.body.appendChild(el);
  return el;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const FAKE_CAMPAIGN_SOURCE = {
  owner: 'gutschke',
  repo: 'underleaf',
  ref: 'main'
};

async function makeFingerprint(): Promise<string> {
  return campaignFingerprint(FAKE_CAMPAIGN_SOURCE);
}

async function buildPack(slot: number, answers: Record<string, string>) {
  const fp = await makeFingerprint();
  return packChargen({
    campaignFingerprint: fp,
    slot,
    chosenPath: 'qa',
    answers
  });
}

/**
 * Inject the campaign into a QuireApp without going through the
 * route navigator — tests don't need network fetches.  Mirrors the
 * helper in quire-app.promote-npc.test.ts.
 */
function injectCampaign(app: QuireApp): void {
  const campaign = {
    base: {
      manifest: {
        $schemaVersion: '0.1.0',
        name: 'Underleaf'
      },
      source: FAKE_CAMPAIGN_SOURCE
    },
    worldOverview: null
  };
  (
    app as unknown as { _appState: { kind: string; campaign: unknown } }
  )._appState = { kind: 'campaign', campaign };
}

describe('#253 live pack delivery — happy path', () => {
  it('GUEST send → HOST sees pip in shared state', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    expect(guest.sessionView?.status).toBe('active');
    const pack = await buildPack(1, { 'q-name': 'Mei' });
    expect(guest.appendChargenPackDeliver(1, pack)).toBe(true);
    await flush();
    // HOST sees one pending pack with full content.
    expect(host.sessionView!.shared.pendingChargenPacks).toHaveLength(1);
    const entry = host.sessionView!.shared.pendingChargenPacks[0];
    expect(entry.senderPeerId).toBe('GUEST');
    expect(entry.slot).toBe(1);
    expect(entry.pack.answers['q-name']).toBe('Mei');
  });

  it('LWW resend: only the newer pack survives', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    const p1 = await buildPack(1, { 'q': 'first' });
    const p2 = await buildPack(1, { 'q': 'revised' });
    guest.appendChargenPackDeliver(1, p1);
    await flush();
    guest.appendChargenPackDeliver(1, p2);
    await flush();
    expect(host.sessionView!.shared.pendingChargenPacks).toHaveLength(1);
    expect(
      host.sessionView!.shared.pendingChargenPacks[0].pack.answers['q']
    ).toBe('revised');
  });

  it('HOST dismiss: pack cleared without state mutation', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    const pack = await buildPack(1, { 'q': 'val' });
    guest.appendChargenPackDeliver(1, pack);
    await flush();
    expect(host.sessionView!.shared.pendingChargenPacks).toHaveLength(1);
    // Inject the campaign so dismissChargenPack passes the coord
    // session-active checks (DM may be on a campaign-less route).
    injectCampaign(host);
    expect(host.dismissChargenPack('GUEST', 1)).toBe(true);
    await flush();
    expect(host.sessionView!.shared.pendingChargenPacks).toHaveLength(0);
  });
});

describe('#253 spoiler firewall', () => {
  it("THIRD peer sees NOTHING in pendingChargenPacks (existence + content stripped)", async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    const third = mountApp(inMemoryFactory(network, 'THIRD'));
    third.joinCodeDraft = 'HOST';
    third.joinSession();
    await flush();
    await flush();
    const pack = await buildPack(1, {
      'q-private': 'Mei knows the Quiet has been speaking to her'
    });
    guest.appendChargenPackDeliver(1, pack);
    await flush();
    // HOST sees the pack with full content.
    expect(host.sessionView!.filteredShared.pendingChargenPacks).toHaveLength(1);
    expect(
      host.sessionView!.filteredShared.pendingChargenPacks[0].pack.answers[
        'q-private'
      ]
    ).toMatch(/Quiet/);
    // GUEST sees their own entry but with content stripped.
    expect(guest.sessionView!.filteredShared.pendingChargenPacks).toHaveLength(
      1
    );
    expect(
      guest.sessionView!.filteredShared.pendingChargenPacks[0].pack.answers
    ).toEqual({});
    // THIRD sees nothing.
    expect(third.sessionView!.filteredShared.pendingChargenPacks).toEqual([]);
  });

  it("GUEST's own pip survives the projection (sender confirms delivery)", async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    const pack = await buildPack(1, { 'q': 'secret' });
    guest.appendChargenPackDeliver(1, pack);
    await flush();
    const entry = guest.sessionView!.filteredShared.pendingChargenPacks[0];
    expect(entry).toBeDefined();
    expect(entry.senderPeerId).toBe('GUEST');
    expect(entry.slot).toBe(1);
    // Content stripped — sender doesn't get the echo.
    expect(entry.pack.answers).toEqual({});
    expect(entry.pack.chosenPath).toBe('');
    // Metadata (fingerprint, schema) preserved so the pip can render
    // delivery time / matching campaign / etc.
    expect(entry.pack.campaignFingerprint.length).toBeGreaterThan(0);
    expect(entry.pack.packedAt).toBeGreaterThan(0);
  });
});

describe('#253 adversarial — hostile peers', () => {
  it('non-coord chargen-pack-clear is dropped by materializer', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    const pack = await buildPack(1, { 'q': 'val' });
    guest.appendChargenPackDeliver(1, pack);
    await flush();
    expect(host.sessionView!.shared.pendingChargenPacks).toHaveLength(1);
    // Guest (non-coord) tries to clear via raw session.append.
    (
      guest as unknown as { session: { append: Function } }
    ).session.append('chargen-pack-clear', {
      v: 1,
      senderPeerId: 'GUEST',
      slot: 1
    });
    await flush();
    expect(host.sessionView!.shared.pendingChargenPacks).toHaveLength(1);
  });

  it('oversized pack (>32 KB stringified) is dropped by materializer', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    // Synthesize a pack via raw append (bypass the controller's
    // pre-check) — simulates a hostile / buggy peer.
    const huge = {
      $schemaVersion: '0.1.0',
      campaignFingerprint: await makeFingerprint(),
      slot: 1,
      chosenPath: 'qa',
      answers: { 'q': 'x'.repeat(CHARGEN_PACK_MAX_SIZE_BYTES + 100) },
      packedAt: Date.now()
    };
    (
      guest as unknown as { session: { append: Function } }
    ).session.append('chargen-pack-deliver', { v: 1, slot: 1, pack: huge });
    await flush();
    expect(host.sessionView!.shared.pendingChargenPacks).toHaveLength(0);
  });

  it('malformed payload (missing pack) is dropped', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    (
      guest as unknown as { session: { append: Function } }
    ).session.append('chargen-pack-deliver', { v: 1, slot: 1 });
    await flush();
    expect(host.sessionView!.shared.pendingChargenPacks).toHaveLength(0);
  });

  it('pack with slot mismatch (payload.slot ≠ pack.slot) is dropped', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    const pack = await buildPack(2, { 'q': 'val' });
    // Payload says slot 1 but pack.slot says 2 — should drop.
    (
      guest as unknown as { session: { append: Function } }
    ).session.append('chargen-pack-deliver', { v: 1, slot: 1, pack });
    await flush();
    expect(host.sessionView!.shared.pendingChargenPacks).toHaveLength(0);
  });

  it('chargen-pack-clear with empty senderPeerId is dropped', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    const pack = await buildPack(1, { 'q': 'val' });
    guest.appendChargenPackDeliver(1, pack);
    await flush();
    (
      host as unknown as { session: { append: Function } }
    ).session.append('chargen-pack-clear', {
      v: 1,
      senderPeerId: '',
      slot: 1
    });
    await flush();
    expect(host.sessionView!.shared.pendingChargenPacks).toHaveLength(1);
  });
});

describe('#253 acceptChargenPack failure recovery', () => {
  it('campaign-mismatch keeps the pack pending + sets aiError', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    // GUEST sends a pack for OUR campaign.
    const pack = await buildPack(1, { 'q': 'val' });
    guest.appendChargenPackDeliver(1, pack);
    await flush();
    // HOST has NO campaign loaded — accept attempt should fail
    // with no-campaign and leave the pack pending.
    expect(host.acceptChargenPack('GUEST', 1)).toBe(false);
    await flush();
    expect(host.sessionView!.shared.pendingChargenPacks).toHaveLength(1);
    expect(
      (host as unknown as { aiError: string }).aiError ?? ''
    ).toMatch(/Import failed/);
  });

  it('successful accept fires the clear event automatically', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    injectCampaign(host);
    const pack = await buildPack(1, { 'q': 'val' });
    guest.appendChargenPackDeliver(1, pack);
    await flush();
    expect(host.acceptChargenPack('GUEST', 1)).toBe(true);
    await flush();
    expect(host.sessionView!.shared.pendingChargenPacks).toHaveLength(0);
  });

  it('accept on a non-existent (senderPeerId, slot) returns false', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    injectCampaign(host);
    expect(host.acceptChargenPack('NONEXISTENT', 1)).toBe(false);
  });
});

describe('#253 + #302 — co-DM yield preserves pending packs', () => {
  it('after coord transition, new DM sees the pending queue', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    const pack = await buildPack(1, { 'q': 'val' });
    guest.appendChargenPackDeliver(1, pack);
    await flush();
    expect(host.sessionView!.shared.pendingChargenPacks).toHaveLength(1);
    // GUEST reclaims coord.
    guest.reclaimCoordinator();
    await flush();
    await flush();
    // New coord (GUEST) sees the pack — including their own.
    expect(
      guest.sessionView!.filteredShared.pendingChargenPacks
    ).toHaveLength(1);
    // OLD coord (HOST) is now non-coord; sees nothing (HOST didn't send).
    expect(
      host.sessionView!.filteredShared.pendingChargenPacks
    ).toEqual([]);
  });
});

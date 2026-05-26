// @vitest-environment happy-dom

/**
 * Hostile end-to-end test bundle (2026-05-26).  Per user directive
 * ("try hard to poke holes into it"), this file mounts realistic
 * multi-peer scenarios and probes the recent batch of features for
 * edge cases the focused unit tests didn't cover:
 *
 *   - #301: retire / pc-edit on a HIDDEN bound seat
 *   - P-R10: promote same NPC twice (pcId collision)
 *   - P-R11: race between player retire-request + DM direct-retire
 *   - P-R11: request on an already-retired seat is rejected
 *   - #302: voluntary yield-retire with 200-char-exact boundary
 */

import { describe, it, expect, vi } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import { type TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import * as charLoader from './character-loader';

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

function injectCampaign(app: QuireApp, npcIds: string[] = []): void {
  const campaign = {
    base: {
      manifest: {
        $schemaVersion: '0.1.0',
        name: 'TestCampaign',
        characters: { npcs: npcIds }
      },
      source: { owner: 'x', repo: 'y', ref: 'main' }
    },
    worldOverview: null
  };
  (
    app as unknown as { _appState: { kind: string; campaign: unknown } }
  )._appState = { kind: 'campaign', campaign };
}

function emitPc(
  app: QuireApp,
  pcId: string,
  name: string,
  slot: number
): void {
  const session = (app as unknown as { session: { append: Function } })
    .session;
  session.append('seat-add', { v: 1, slot });
  session.append('pc-create', {
    v: 1,
    pcId,
    name,
    pronouns: '',
    tags: ['a', 'b', 'c'],
    stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: [],
    backstory: 'X'
  });
  session.append('pc-slot-bind', { v: 1, slot, pcId });
}

describe('hostile bundle — #301 hidden seats interaction', () => {
  it('retiring a hidden bound seat works; retired state stays hidden from players', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    // Bind a PC to a hidden seat.
    (
      host as unknown as { session: { append: Function } }
    ).session.append('seat-add', { v: 1, slot: 9, revealed: false });
    (
      host as unknown as { session: { append: Function } }
    ).session.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      pronouns: '',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      skills: [],
      backstory: 'X'
    });
    (
      host as unknown as { session: { append: Function } }
    ).session.append('pc-slot-bind', { v: 1, slot: 9, pcId: 'mei' });
    await flush();
    expect(host.sessionView!.shared.pcSlots[9]?.revealed).toBe(false);
    expect(host.sessionView!.shared.pcSlots[9]?.state).toBe('bound-active');
    // DM retires the hidden bound PC.
    expect(
      host.appendPcRetire({
        pcId: 'mei',
        inFictionReason: 'left for the south',
        reason: 'departed'
      })
    ).toBe(true);
    await flush();
    expect(host.sessionView!.shared.pcSlots[9]?.state).toBe('bound-retired');
    // BUG: pc-retire materializer overwrites the seat without
    // preserving `revealed: false`.  Player would now see the
    // retired seat appear from nowhere.
    expect(host.sessionView!.shared.pcSlots[9]?.revealed).toBe(false);
    // Multi-peer firewall check.
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    expect(guest.sessionView!.filteredShared.pcSlots[9]).toBeUndefined();
  });
});

describe('hostile bundle — P-R10 NPC promotion edge cases', () => {
  it('promoting the SAME NPC twice succeeds (different pcIds via random suffix)', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    injectCampaign(app, ['yui']);
    const loadSpy = vi.spyOn(charLoader, 'loadCharacter').mockResolvedValue({
      kind: 'npc',
      id: 'yui',
      record: {
        $schemaVersion: '0.1.0',
        name: 'Yui',
        stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
      },
      source: { owner: 'x', repo: 'y', ref: 'main' }
    });
    const slot1 = await app.promoteNpcToPc('yui');
    const slot2 = await app.promoteNpcToPc('yui');
    await flush();
    expect(slot1).toBe(1);
    expect(slot2).toBe(2);
    // Both pcIds exist + are distinct.
    const pcs = Object.keys(app.sessionView!.shared.synthesizedPcs).filter(
      (id) => id.startsWith('pc-from-yui-')
    );
    expect(pcs.length).toBe(2);
    expect(pcs[0]).not.toBe(pcs[1]);
    loadSpy.mockRestore();
  });

  it('NPC with stats outside PC_CREATE_STAT range — pc-create silently rejected', async () => {
    // NPCs have permissive shapes; PCs are stricter (stats ∈ [-3, 3]).
    // The materializer drops a pc-create whose stats are out of
    // range — so the promote ends up with seat-add + pc-slot-bind
    // landing on a slot whose synthesizedPcs entry doesn't exist.
    // (This is a real edge case for NPCs with combat stats like +5.)
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    injectCampaign(app, ['boss']);
    const loadSpy = vi.spyOn(charLoader, 'loadCharacter').mockResolvedValue({
      kind: 'npc',
      id: 'boss',
      record: {
        $schemaVersion: '0.1.0',
        name: 'Big Boss',
        stats: { str: 5, dex: 5, con: 5, int: 0, wis: 0, cha: 0 } // out of range
      },
      source: { owner: 'x', repo: 'y', ref: 'main' }
    });
    const slot = await app.promoteNpcToPc('boss');
    expect(slot).toBe(1);
    await flush();
    // BUG SURFACE: seat got allocated + bound, but synthesizedPcs is
    // empty.  The seat references a pcId that doesn't materialize.
    expect(app.sessionView!.shared.pcSlots[1]?.state).toBe('bound-active');
    const pcsForBoss = Object.keys(
      app.sessionView!.shared.synthesizedPcs
    ).filter((id) => id.startsWith('pc-from-boss-'));
    // If this asserts 0, the bug exists; if 1, the controller is
    // clamping stats.  Test pins the current behavior — and the
    // companion fix below clamps so this becomes 1.
    expect(pcsForBoss.length).toBe(1);
    loadSpy.mockRestore();
  });
});

describe('hostile bundle — P-R11 race conditions', () => {
  it('player retire-request + DM direct-retire: pc-retire wins, request cleared', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    emitPc(host, 'mei', 'Mei', 1);
    await flush();
    (
      guest as unknown as { session: { rename: Function } }
    ).session.rename({ pcId: 'mei' });
    await flush();
    // Player submits a request.
    expect(guest.appendPcRetireRequest('died', 'fell in the cabin')).toBe(true);
    await flush();
    expect(host.sessionView!.shared.pcRetireRequests).toHaveLength(1);
    // DM ignores the request and retires directly via the existing
    // appendPcRetire (different reason).
    host.appendPcRetire({
      pcId: 'mei',
      inFictionReason: 'walked away after a betrayal',
      reason: 'departed'
    });
    await flush();
    // Seat reflects DM's reason; player's pending request is cleared
    // (pc-retire materializer's housekeeping).
    expect(host.sessionView!.shared.pcSlots[1]?.state).toBe('bound-retired');
    expect(host.sessionView!.shared.pcSlots[1]?.inFictionRetireReason).toBe(
      'walked away after a betrayal'
    );
    expect(host.sessionView!.shared.pcRetireRequests).toHaveLength(0);
  });

  it('player can NOT request retire on an already-retired seat', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    emitPc(host, 'mei', 'Mei', 1);
    await flush();
    (
      guest as unknown as { session: { rename: Function } }
    ).session.rename({ pcId: 'mei' });
    await flush();
    // DM retires first.
    host.appendPcRetire({
      pcId: 'mei',
      inFictionReason: 'left',
      reason: 'departed'
    });
    await flush();
    expect(host.sessionView!.shared.pcSlots[1]?.state).toBe('bound-retired');
    // Player submits a request on the (now retired) PC.  Engine
    // refuses — `controllingSlot` requires bound-active.
    expect(guest.appendPcRetireRequest('died', 'reconsidered')).toBe(true);
    await flush();
    // Request did NOT materialize.
    expect(host.sessionView!.shared.pcRetireRequests).toHaveLength(0);
  });
});

describe('hostile bundle — #302 yield-retire boundary', () => {
  it('200-char-exact in-fiction reason is accepted', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    emitPc(app, 'mei', 'Mei', 1);
    (
      app as unknown as { session: { rename: Function } }
    ).session.rename({ pcId: 'mei' });
    await flush();
    (
      app as unknown as { openYieldPrompt: () => void }
    ).openYieldPrompt();
    app.setYieldPcFate('retire');
    const exact200 = 'x'.repeat(200);
    app.setYieldRetireReason(exact200);
    expect(app.submitYieldPcFatePrompt()).toBe(true);
    await flush();
    expect(app.sessionView!.shared.pcSlots[1]?.state).toBe('bound-retired');
    expect(
      app.sessionView!.shared.pcSlots[1]?.inFictionRetireReason?.length
    ).toBe(200);
  });

  it('201-char in-fiction reason is rejected — yield aborted', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    emitPc(app, 'mei', 'Mei', 1);
    (
      app as unknown as { session: { rename: Function } }
    ).session.rename({ pcId: 'mei' });
    await flush();
    (
      app as unknown as { openYieldPrompt: () => void }
    ).openYieldPrompt();
    app.setYieldPcFate('retire');
    app.setYieldRetireReason('y'.repeat(201));
    expect(app.submitYieldPcFatePrompt()).toBe(false);
    // Seat unchanged, prompt still open.
    expect(app.sessionView!.shared.pcSlots[1]?.state).toBe('bound-active');
    expect(app.yieldPcFatePrompt).not.toBeNull();
  });
});

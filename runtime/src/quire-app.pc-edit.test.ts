// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import type { LoadedCharacter } from './character-loader';

function inMemoryFactory(network: InMemoryNetwork, id: string): TransportFactory {
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
  await Promise.resolve();
  await Promise.resolve();
}

function fakePc(id: string): LoadedCharacter {
  return {
    kind: 'pc',
    id,
    record: {
      $schemaVersion: '0.1.0',
      name: `PC ${id}`,
      stats: { str: 0, dex: 1, con: 0, int: 2, wis: 1, cha: -1 },
      harm: 0,
      stress: 0
    },
    source: { owner: 'x', repo: 'y', ref: 'main' }
  };
}

describe('QuireApp pc-edit', () => {
  it('submitPcEdit is a no-op outside an active session', () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    expect(app.submitPcEdit('p1', 'stats.str', 2)).toBe(false);
  });

  it('effectiveCharacter returns the base record when no edits', () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    const pc = fakePc('p1');
    expect(app.effectiveCharacter(pc)).toBe(pc.record);
  });

  it('effectiveCharacter merges session pcEdits over the base record', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    expect(app.submitPcEdit('p1', 'stats.str', 3)).toBe(true);
    const merged = app.effectiveCharacter(fakePc('p1'));
    expect(merged.stats?.str).toBe(3);
    expect(merged.stats?.dex).toBe(1);
  });

  it('LWW: a second edit to the same field replaces the first', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    app.submitPcEdit('p1', 'harm', 1);
    app.submitPcEdit('p1', 'harm', 2);
    expect(app.effectiveCharacter(fakePc('p1')).harm).toBe(2);
  });

  it('NPC edits are not exposed via effectiveCharacter overrides', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    // Even if a pc-edit event is appended with an NPC id, the
    // effectiveCharacter helper only consults overrides for PCs.
    app.submitPcEdit('some-npc', 'harm', 4);
    const npc: LoadedCharacter = {
      kind: 'npc',
      id: 'some-npc',
      record: {
        $schemaVersion: '0.1.0',
        name: 'NPC',
        harm: 0
      },
      source: { owner: 'x', repo: 'y', ref: 'main' }
    };
    expect(app.effectiveCharacter(npc).harm).toBe(0);
  });

  it('edits flow host → guest', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    host.submitPcEdit('p1', 'stats.str', 3);
    await flush();
    expect(guest.effectiveCharacter(fakePc('p1')).stats?.str).toBe(3);
  });

  it('edits flow guest → host', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    guest.submitPcEdit('p1', 'stress', 2);
    await flush();
    expect(host.effectiveCharacter(fakePc('p1')).stress).toBe(2);
  });
});

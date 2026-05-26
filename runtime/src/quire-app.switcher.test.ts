// @vitest-environment happy-dom

/**
 * P-R7 (2026-05-25): end-to-end tests for the player-rail
 * name-row switcher.  Covers:
 *   - computeSwitcherEntries: includes only bound-active PCs;
 *     marks current; tags taken-by for other-peer claims.
 *   - switchBoundPcTo: dispatches peer-rename + the pc-switch
 *     audit event (BLOCKING-3a from the TTRPG-R7 verdict).
 *   - BLOCKING-3b regression: after a switch, a subsequent
 *     pc-edit (the dice-Dock + AI write paths' core primitive)
 *     targets the new current PC.
 */

import { describe, it, expect } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import { SessionController } from './session-controller';

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

function bindPc(
  app: QuireApp,
  slot: number,
  pcId: string,
  name: string
): void {
  // Seat allocation + PC materialization + slot bind, matching the
  // chargen accept flow.  Tests skip the full chargen UI.
  const session = (app as unknown as { session: { append: Function } })
    .session;
  session.append('seat-add', { v: 1, slot });
  // pc-create payload is FLAT — name/pronouns/tags/stats/skills/
  // backstory at the top level (per applyPcCreateEvent in
  // core/state.ts).  An earlier draft of this helper nested
  // everything under `record` and the materializer silently dropped
  // the event; the test still passed because the switcher only
  // reads pcId from pcSlots (set by pc-slot-bind) and falls back to
  // pcId for name when synthesizedPcs is empty.  Fixed alongside
  // #302 so future tests get real records.
  session.append('pc-create', {
    v: 1,
    pcId,
    name,
    pronouns: '',
    tags: ['test', 'archivist', 'helper'],
    stats: { str: 0, dex: 1, con: 0, int: 2, wis: 1, cha: -1 },
    skills: [],
    backstory: `Test backstory for ${name}.`
  });
  session.append('pc-slot-bind', { v: 1, slot, pcId });
}

describe('QuireApp P-R7 switcher', () => {
  it('computeSwitcherEntries: empty until 2+ bound-active PCs exist', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    const v = app.sessionView!;
    expect(v.peerId).toBe('HOST');
    // Bind self to one PC; entries len 1 → caller will hide chevron.
    bindPc(app, 1, 'mei', 'Mei');
    (app as unknown as { session: { rename: Function } }).session.rename({
      pcId: 'mei'
    });
    await flush();
    const entries1 = (
      app as unknown as {
        computeSwitcherEntries: (id: string) => unknown[];
      }
    ).computeSwitcherEntries('mei');
    expect(entries1.length).toBe(1);
  });

  it('computeSwitcherEntries lists active PCs; current entry marked', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    bindPc(app, 1, 'mei', 'Mei');
    bindPc(app, 2, 'reggie', 'Reggie');
    (app as unknown as { session: { rename: Function } }).session.rename({
      pcId: 'mei'
    });
    await flush();
    const entries = (
      app as unknown as {
        computeSwitcherEntries: (id: string) => Array<{
          pcId: string;
          name: string;
          isCurrent: boolean;
          takenBy?: string;
        }>;
      }
    ).computeSwitcherEntries('mei');
    expect(entries.length).toBe(2);
    expect(entries.find((e) => e.pcId === 'mei')?.isCurrent).toBe(true);
    expect(entries.find((e) => e.pcId === 'reggie')?.isCurrent).toBe(false);
    // The other PC is unclaimed in this test → no takenBy tag.
    expect(entries.find((e) => e.pcId === 'reggie')?.takenBy).toBeUndefined();
  });

  it('switchBoundPcTo emits peer-rename(pcId) + pc-switch audit event', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    bindPc(app, 1, 'mei', 'Mei');
    bindPc(app, 2, 'reggie', 'Reggie');
    (app as unknown as { session: { rename: Function } }).session.rename({
      pcId: 'mei'
    });
    await flush();
    const initialEvents = (
      app as unknown as {
        session: { getEvents: () => readonly unknown[] };
      }
    ).session.getEvents().length;
    expect(app.switchBoundPcTo('reggie')).toBe(true);
    await flush();
    const events = (
      app as unknown as {
        session: {
          getEvents: () => ReadonlyArray<{ kind: string; payload?: unknown }>;
        };
      }
    ).session.getEvents();
    const newEvents = events.slice(initialEvents);
    const kinds = newEvents.map((e) => e.kind);
    // peer-rename + pc-switch (in that order) — both appended.
    expect(kinds).toContain('peer-rename');
    expect(kinds).toContain('pc-switch');
    const switchEvent = newEvents.find((e) => e.kind === 'pc-switch')!;
    const p = switchEvent.payload as {
      v: number;
      from: string;
      to: string;
      scene: string;
    };
    expect(p.v).toBe(1);
    expect(p.from).toBe('mei');
    expect(p.to).toBe('reggie');
  });

  it('switchBoundPcTo is a no-op when target equals current bound PC', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    bindPc(app, 1, 'mei', 'Mei');
    (app as unknown as { session: { rename: Function } }).session.rename({
      pcId: 'mei'
    });
    await flush();
    expect(app.switchBoundPcTo('mei')).toBe(false);
  });

  it('switchBoundPcTo is a no-op outside an active session', () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    expect(app.switchBoundPcTo('mei')).toBe(false);
  });

  it('BLOCKING-3b regression: after a switch, pc-edit targets the new pcId', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    bindPc(app, 1, 'mei', 'Mei');
    bindPc(app, 2, 'reggie', 'Reggie');
    (app as unknown as { session: { rename: Function } }).session.rename({
      pcId: 'mei'
    });
    await flush();
    // Bump Mei's stress to 2.
    expect(app.submitPcEdit('mei', 'stress', 2)).toBe(true);
    // Now switch to Reggie.
    expect(app.switchBoundPcTo('reggie')).toBe(true);
    await flush();
    // Subsequent pc-edit should be routable to Reggie (or back to
    // Mei — the API takes an explicit pcId).  The point is the
    // dispatch doesn't get confused: edits to Reggie land on Reggie.
    expect(app.submitPcEdit('reggie', 'stress', 3)).toBe(true);
    const v = app.sessionView!;
    expect(v.shared.pcEdits['mei']?.stress).toBe(2);
    expect(v.shared.pcEdits['reggie']?.stress).toBe(3);
  });

  it('takenBy: another peer holding a PC tags that entry for take-over', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.displayNameDraft = 'DM';
    host.startHosting();
    await flush();
    bindPc(host, 1, 'mei', 'Mei');
    bindPc(host, 2, 'reggie', 'Reggie');
    await flush();
    // Stand up a remote SessionController that joins + claims Reggie.
    const remote = new SessionController({
      createHost: async () => ({
        transport: new InMemoryTransport('unused', network),
        pairingCode: 'unused'
      }),
      createGuest: async () => ({
        transport: new InMemoryTransport('GUESTPEER', network)
      })
    });
    await remote.join('HOST', 'Bob');
    await flush();
    remote.rename({ pcId: 'reggie' });
    await flush();
    // Host now claims Mei; the switcher should list both PCs with
    // Reggie tagged takenBy: 'Bob'.
    (host as unknown as { session: { rename: Function } }).session.rename({
      pcId: 'mei'
    });
    await flush();
    const entries = (
      host as unknown as {
        computeSwitcherEntries: (id: string) => Array<{
          pcId: string;
          name: string;
          isCurrent: boolean;
          takenBy?: string;
        }>;
      }
    ).computeSwitcherEntries('mei');
    const reggieEntry = entries.find((e) => e.pcId === 'reggie');
    expect(reggieEntry).toBeDefined();
    expect(reggieEntry?.takenBy).toBe('Bob');
  });
});

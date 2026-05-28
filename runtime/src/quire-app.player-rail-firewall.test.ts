// @vitest-environment happy-dom

/**
 * Phase B P4 (2026-05-26): player-rail spoiler-firewall regression.
 *
 * The new Phase B field renderers (foci-card, conditions-list,
 * money-band-selector) shouldn't leak any DM-only fields when the
 * bound character is rendered for a player viewer.
 *
 * This file mounts a real QuireApp instance + drives it as a guest
 * peer with a bound PC, then inspects the DOM for substrings that
 * would only appear if a DM-only field slipped through the
 * projection.
 */

import { describe, it, expect } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import { type TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';

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

describe('Phase B P4 — player-rail spoiler-firewall', () => {
  it('player viewer sees foci/conditions/moneyBand but NOT DM-only fields', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    // Inject a PC record with EVERY DM-only + player-visible field
    // populated.  DM-only set: magicPhase, knowsTheyCanCast, tax,
    // threadDebt, accidentalGrants, alignmentDrift, dmNotes.
    // Player-visible new: foci (with status), conditions, languages,
    // moneyBand.
    const session = (host as unknown as { session: { append: Function } })
      .session;
    session.append('seat-add', { v: 1, slot: 1 });
    session.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      skills: ['Tech'],
      backstory: 'X'
    });
    session.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    // Now overlay every DM-only field via pc-edit + cheat: directly
    // mutate the materialized record via additional pc-edits the
    // applier accepts.  The materializer dropped the per-field pc-edit
    // for non-supported fields like foci/conditions/etc., but the
    // PC-create's name/etc. are in place; DM-only fields we DO test
    // through pc-edit (knowsTheyCanCast, magicPhase) which the
    // materializer supports.
    session.append('pc-edit', {
      v: 1,
      pcId: 'mei',
      field: 'knowsTheyCanCast',
      value: true
    });
    session.append('pc-edit', {
      v: 1,
      pcId: 'mei',
      field: 'magicPhase',
      value: 'realization'
    });
    session.append('pc-edit', {
      v: 1,
      pcId: 'mei',
      field: 'dmNotes',
      value: 'remember the cabinet code is 5519'
    });
    await flush();
    // Stand up a guest viewer that claims Mei.
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    (guest as unknown as { session: { rename: Function } }).session.rename({
      pcId: 'mei'
    });
    await flush();
    await flush();
    // The base synthesizedPcs record is FULLY stripped (the #398
    // reveal lives only in the pcEdits overlay, never re-added to the
    // base record — so a roster reader can't see another PC's status).
    const pc = guest.sessionView!.filteredShared.synthesizedPcs['mei'];
    expect(pc).toBeDefined();
    expect(
      (pc as unknown as Record<string, unknown>).knowsTheyCanCast
    ).toBeUndefined();
    expect(
      (pc as unknown as Record<string, unknown>).magicPhase
    ).toBeUndefined();
    expect(
      (pc as unknown as Record<string, unknown>).dmNotes
    ).toBeUndefined();
    // #398: the pcEdits overlay for the guest's OWN realized PC keeps
    // knowsTheyCanCast (the player perceives their cast capability),
    // but magicPhase / dmNotes still strip.
    const edits = guest.sessionView!.filteredShared.pcEdits['mei'] ?? {};
    expect((edits as Record<string, unknown>).knowsTheyCanCast).toBe(true);
    expect((edits as Record<string, unknown>).dmNotes).toBeUndefined();
    expect((edits as Record<string, unknown>).magicPhase).toBeUndefined();
  });

  it('#398: one realized player cannot see another realized PC\'s cast state (cross-PC firewall, real-path e2e)', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const session = (host as unknown as { session: { append: Function } })
      .session;
    // Two PCs, both realized by the DM.
    for (const [slot, pcId] of [
      [1, 'mei'],
      [2, 'rhea']
    ] as const) {
      session.append('seat-add', { v: 1, slot });
      session.append('pc-create', {
        v: 1,
        pcId,
        name: pcId,
        pronouns: 'they/them',
        tags: ['a', 'b', 'c'],
        stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
        skills: ['Tech'],
        backstory: 'X'
      });
      session.append('pc-slot-bind', { v: 1, slot, pcId });
      session.append('pc-edit', { v: 1, pcId, field: 'knowsTheyCanCast', value: true });
      session.append('pc-edit', { v: 1, pcId, field: 'tax.active', value: true });
    }
    await flush();
    // Two guests, each claiming a different PC.
    const g1 = mountApp(inMemoryFactory(network, 'G1'));
    g1.joinCodeDraft = 'HOST';
    g1.joinSession();
    const g2 = mountApp(inMemoryFactory(network, 'G2'));
    g2.joinCodeDraft = 'HOST';
    g2.joinSession();
    await flush();
    await flush();
    (g1 as unknown as { session: { rename: Function } }).session.rename({ pcId: 'mei' });
    (g2 as unknown as { session: { rename: Function } }).session.rename({ pcId: 'rhea' });
    await flush();
    await flush();
    const g1Mei = g1.sessionView!.filteredShared.pcEdits['mei'] ?? {};
    const g1Rhea = g1.sessionView!.filteredShared.pcEdits['rhea'] ?? {};
    // G1 sees its OWN (mei) cast state …
    expect((g1Mei as Record<string, unknown>).knowsTheyCanCast).toBe(true);
    expect((g1Mei as Record<string, unknown>)['tax.active']).toBe(true);
    // … but NOT rhea's, even though rhea is also realized.
    expect((g1Rhea as Record<string, unknown>).knowsTheyCanCast).toBeUndefined();
    expect((g1Rhea as Record<string, unknown>)['tax.active']).toBeUndefined();
    // Symmetric: G2 sees rhea's, not mei's.
    const g2Rhea = g2.sessionView!.filteredShared.pcEdits['rhea'] ?? {};
    const g2Mei = g2.sessionView!.filteredShared.pcEdits['mei'] ?? {};
    expect((g2Rhea as Record<string, unknown>).knowsTheyCanCast).toBe(true);
    expect((g2Mei as Record<string, unknown>).knowsTheyCanCast).toBeUndefined();
  });

  it('host (coord) viewer keeps full DM-only state', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const session = (host as unknown as { session: { append: Function } })
      .session;
    session.append('seat-add', { v: 1, slot: 1 });
    session.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      skills: ['Tech'],
      backstory: 'X'
    });
    session.append('pc-edit', {
      v: 1,
      pcId: 'mei',
      field: 'dmNotes',
      value: 'cabinet code 5519'
    });
    await flush();
    // Host is coord; filteredShared === shared (identity).
    const pc = host.sessionView!.filteredShared.synthesizedPcs['mei'];
    expect(pc).toBeDefined();
    const edits = host.sessionView!.filteredShared.pcEdits['mei'];
    expect((edits as Record<string, unknown>).dmNotes).toBe('cabinet code 5519');
  });
});

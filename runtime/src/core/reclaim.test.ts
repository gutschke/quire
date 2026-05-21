/**
 * coordinator-reclaim — supports the sick-DM-handoff scenario:
 * an explicit, audit-trailed handover of session coordinator from
 * whoever held it to a new peer.  Unlike coordinator-claim
 * ("first claim wins"), reclaim is unconditional.  Authenticity
 * is gated by Peer.handleMessage's transport-sender check (R2.1).
 *
 * Visibility into "who took over from whom" comes from a
 * synthesized system chat entry the materializer pushes alongside
 * the state.coordinator mutation.  This is the audit trail every
 * peer sees in their chat panel.
 */

import { describe, it, expect } from 'vitest';
import { Peer } from './peer';
import { materialize } from './state';
import { InMemoryNetwork, InMemoryTransport } from './transports/in-memory';
import type { QuireEvent } from './event-log';

function makePeer(id: string, net: InMemoryNetwork): Peer {
  return new Peer(id, new InMemoryTransport(id, net));
}

function ev(
  peerId: string,
  seq: number,
  kind: string,
  payload: unknown
): QuireEvent {
  return {
    id: `${peerId}:${seq}`,
    peerId,
    seq,
    clock: { [peerId]: seq },
    kind,
    payload,
    ts: Date.now()
  };
}

describe('materialize — coordinator-reclaim', () => {
  it('unconditionally sets coordinator (unlike coordinator-claim)', () => {
    const events = [
      ev('alice', 1, 'coordinator-claim', {}),
      ev('mallory', 1, 'coordinator-claim', {}), // claim ignored (alice first)
      ev('bob', 1, 'coordinator-reclaim', { fromPeerId: 'alice' })
    ];
    const s = materialize(events);
    expect(s.coordinator).toBe('bob');
  });

  it('synthesizes a system chat entry as audit trail', () => {
    const events = [
      ev('alice', 1, 'coordinator-claim', {}),
      ev('bob', 1, 'chat', { text: 'before' }),
      ev('bob', 2, 'coordinator-reclaim', { fromPeerId: 'alice' })
    ];
    const s = materialize(events);
    const audit = s.chat.find((c) => c.text.startsWith('[system]'));
    expect(audit).toBeDefined();
    expect(audit?.peerId).toBe('bob');
    expect(audit?.text).toContain('bob');
    expect(audit?.text).toContain('alice');
  });

  it('reclaim with no prior coordinator still works + audit names the lack', () => {
    const s = materialize([
      ev('bob', 1, 'coordinator-reclaim', { fromPeerId: null })
    ]);
    expect(s.coordinator).toBe('bob');
    const audit = s.chat.find((c) => c.text.startsWith('[system]'));
    expect(audit).toBeDefined();
    // No specific "from X" — just "took over as coordinator" is fine.
  });

  it('multiple reclaims in sequence: each one transitions coordinator', () => {
    const events = [
      ev('alice', 1, 'coordinator-claim', {}),
      ev('bob', 1, 'coordinator-reclaim', { fromPeerId: 'alice' }),
      ev('charlie', 1, 'coordinator-reclaim', { fromPeerId: 'bob' })
    ];
    const s = materialize(events);
    expect(s.coordinator).toBe('charlie');
    // Two audit entries.
    const audits = s.chat.filter((c) => c.text.startsWith('[system]'));
    expect(audits).toHaveLength(2);
  });

  it('rejects reclaim with non-plain-object payload', () => {
    const events = [
      ev('alice', 1, 'coordinator-claim', {}),
      ev('bob', 1, 'coordinator-reclaim', null)
    ];
    const s = materialize(events);
    // Bad payload → reclaim is dropped, alice remains coordinator.
    expect(s.coordinator).toBe('alice');
  });
});

describe('Peer.reclaimCoordinator', () => {
  it('appends a coordinator-reclaim event with fromPeerId from current state', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    alice.append('coordinator-claim', {});
    expect(alice.state().coordinator).toBe('alice');

    const bob = makePeer('bob', net);
    // bob inherits alice's state through gossip
    expect(bob.state().coordinator).toBe('alice');
    bob.reclaimCoordinator();
    expect(bob.state().coordinator).toBe('bob');

    // Audit chat entry visible to both.
    expect(
      alice.state().chat.find((c) => c.text.startsWith('[system]'))
    ).toBeDefined();
    expect(
      bob.state().chat.find((c) => c.text.startsWith('[system]'))
    ).toBeDefined();

    alice.close();
    bob.close();
  });
});

describe('coordinator-reclaim — impersonation defense (R2.1)', () => {
  it("mallory cannot reclaim as bob via share", () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    alice.append('coordinator-claim', {});
    const mallory = makePeer('mallory', net);
    const charlie = makePeer('charlie', net);

    // Mallory forges a reclaim event claiming bob authored it.
    const forged: QuireEvent = {
      id: 'bob:1',
      peerId: 'bob',
      seq: 1,
      clock: { bob: 1 },
      kind: 'coordinator-reclaim',
      payload: { fromPeerId: 'alice' },
      ts: Date.now()
    };
    net.deliver('mallory', 'charlie', { kind: 'share', event: forged });

    // R2.1 rejects: charlie's state still has alice as coordinator.
    expect(charlie.state().coordinator).toBe('alice');

    alice.close();
    mallory.close();
    charlie.close();
  });
});

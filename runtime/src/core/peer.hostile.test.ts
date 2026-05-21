/**
 * Adversarial tests for Peer's message handling.  The key
 * impersonation defense at this layer: when a `share` message
 * arrives, the event's claimed `peerId` MUST match the transport
 * sender.  Otherwise mallory can broadcast an event claiming
 * peerId='alice' and shadow-author alice's events (especially
 * coordinator-claim and scene-reveal, both of which are
 * peerId-gated).
 *
 * sync-response is intentionally NOT subject to this check — gossip
 * forwarding requires that peers can ship events authored by others.
 * That trust trade-off is documented; cryptographic signatures would
 * be needed to close it.
 */

import { describe, it, expect } from 'vitest';
import { Peer } from './peer';
import { InMemoryNetwork, InMemoryTransport } from './transports/in-memory';
import type { QuireEvent } from './event-log';

function makePeer(id: string, net: InMemoryNetwork): Peer {
  return new Peer(id, new InMemoryTransport(id, net));
}

function legitEvent(
  authorPeerId: string,
  seq: number,
  overrides: Partial<QuireEvent> = {}
): QuireEvent {
  return {
    id: `${authorPeerId}:${seq}`,
    peerId: authorPeerId,
    seq,
    clock: { [authorPeerId]: seq },
    kind: 'chat',
    payload: { text: 'hi' },
    ts: Date.now(),
    ...overrides
  };
}

describe('Peer — impersonation defense (share messages)', () => {
  it("mallory cannot 'share' an event claiming peerId=alice", () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const mallory = makePeer('mallory', net);
    const bob = makePeer('bob', net);

    // Mallory directly sends a share message claiming the event was
    // authored by alice.  Bob's handleMessage should reject it on the
    // transport-sender vs event.peerId cross-check.
    const forged = legitEvent('alice', 99, {
      kind: 'chat',
      payload: { text: 'IMPERSONATED' }
    });
    // Use the transport's network to deliver the forged message
    // straight to bob from mallory.
    net.deliver('mallory', 'bob', { kind: 'share', event: forged });

    // Bob's state should NOT contain the impersonated chat.
    expect(bob.state().chat).toEqual([]);

    // Cleanup
    alice.close();
    bob.close();
    mallory.close();
  });

  it("mallory cannot 'share' a coordinator-claim as alice", () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const mallory = makePeer('mallory', net);
    const bob = makePeer('bob', net);

    const forged = legitEvent('alice', 1, {
      kind: 'coordinator-claim',
      payload: {}
    });
    net.deliver('mallory', 'bob', { kind: 'share', event: forged });

    expect(bob.state().coordinator).toBeUndefined();

    alice.close();
    bob.close();
    mallory.close();
  });

  it("alice's legit 'share' of her own event is accepted", () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const bob = makePeer('bob', net);

    alice.append('chat', { text: 'hello' });
    expect(bob.state().chat.map((c) => c.text)).toEqual(['hello']);

    alice.close();
    bob.close();
  });
});

describe('Peer — share with malformed event payload', () => {
  it("rejects share with event: null", () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const bob = makePeer('bob', net);
    net.deliver('alice', 'bob', { kind: 'share', event: null });
    expect(bob.state().chat).toEqual([]);
    alice.close();
    bob.close();
  });

  it('rejects share with event: array', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const bob = makePeer('bob', net);
    net.deliver('alice', 'bob', { kind: 'share', event: [] });
    expect(bob.state().chat).toEqual([]);
    alice.close();
    bob.close();
  });
});

describe('Peer — sync-response gossip is intentionally NOT origin-checked', () => {
  it('bob can forward alice-authored events to charlie via sync-response', () => {
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const bob = makePeer('bob', net);
    alice.append('chat', { text: 'shared by gossip' });
    // alice and bob converge.  Now charlie joins.  When charlie
    // connects, the constructor sync-request triggers bob to send
    // sync-response carrying alice-authored events.  Charlie must
    // accept these even though the transport sender is bob.
    const charlie = makePeer('charlie', net);
    expect(charlie.state().chat.map((c) => c.text)).toEqual([
      'shared by gossip'
    ]);
    alice.close();
    bob.close();
    charlie.close();
  });
});

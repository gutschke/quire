// @vitest-environment node

/**
 * M3 (2026-05-29 save-restore program, Architect finding #1):
 *
 *   "Peer.applyEvent does NOT broadcast.  Hub-forwarding via
 *    sync-response only fires for events received from another peer,
 *    not from disk.  A player who restores their autosave and joins
 *    a new session has their unique events silently NEVER propagated
 *    to the table.  This BREAKS the user's stated promise."
 *
 * Trust but verify.  This test reproduces the EXACT scenario and
 * pins the actual behavior.  Two possible outcomes:
 *
 *   - FAIL → the architect was right; we patch.
 *   - PASS → the pull-based sync-request from the new peer's side
 *            already covers the case; the architect's claim is
 *            invalidated; we move on.
 *
 * Why we don't just trust the analysis: the protocol is pull-driven
 * from BOTH sides of a new connection.  When A connects to B:
 *   - A's onPeerConnect(B) fires → A asks B for events A is missing.
 *   - B's onPeerConnect(A) fires → B asks A for events B is missing.
 * Both directions of catch-up should happen, so A's restored events
 * should reach B via B's sync-request → A's sync-response.  The
 * architect's claim assumes the forwarding is one-directional, which
 * doesn't match the protocol's intent.
 */

import { describe, it, expect } from 'vitest';
import { Peer } from './peer';
import { InMemoryNetwork, InMemoryTransport } from './transports/in-memory';
import { EventLog } from './event-log';

function makePeer(id: string, net: InMemoryNetwork): Peer {
  return new Peer(id, new InMemoryTransport(id, net));
}

describe('M3 architect-claim — restored events propagate from a joining peer', () => {
  it('two-peer: peer A restores N events, then connects to peer B; B sees them', () => {
    // Build a "saved" event log out-of-band — simulates a player
    // who shut down their laptop with N events in localStorage.
    const savedLog = new EventLog('alice');
    savedLog.append('peer-join', { name: 'Alice' });
    savedLog.append('chat', { text: 'event-from-save-1' });
    savedLog.append('chat', { text: 'event-from-save-2' });
    savedLog.append('chat', { text: 'event-from-save-3' });
    const savedEvents = savedLog.events().slice();

    // Now build a fresh network.  Alice joins first and replays her
    // saved log via applyEvent (the load/restore path).
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    for (const e of savedEvents) {
      alice.applyEvent(e);
    }
    // Sanity: Alice has her own events.
    expect(alice.state().chat).toHaveLength(3);

    // Bob joins LATER.
    const bob = makePeer('bob', net);

    // The protocol should: bob's onPeerConnect(alice) fires → bob
    // sends sync-request to alice → alice responds with her log →
    // bob materializes 3 chat events.
    expect(
      bob.state().chat.map((c) => c.text),
      'bob should see all 3 chat events that alice restored from save'
    ).toEqual([
      'event-from-save-1',
      'event-from-save-2',
      'event-from-save-3'
    ]);
  });

  it('three-peer: A restores N events, joins a network with B + C; both see them', () => {
    // Pre-existing network with B + C connected.
    const net = new InMemoryNetwork();
    const bob = makePeer('bob', net);
    const carol = makePeer('carol', net);
    bob.append('chat', { text: 'bob-pre' });
    carol.append('chat', { text: 'carol-pre' });

    // Alice restores from save out-of-band.
    const savedLog = new EventLog('alice');
    savedLog.append('peer-join', { name: 'Alice' });
    savedLog.append('chat', { text: 'alice-from-save-1' });
    savedLog.append('chat', { text: 'alice-from-save-2' });
    const savedEvents = savedLog.events().slice();

    const alice = makePeer('alice', net);
    for (const e of savedEvents) alice.applyEvent(e);

    // Bob's view: should have alice's restored chats.
    const bobChats = bob.state().chat.map((c) => c.text);
    expect(
      bobChats,
      'bob should see alice-from-save-*'
    ).toContain('alice-from-save-1');
    expect(bobChats).toContain('alice-from-save-2');

    // Carol's view: same.
    const carolChats = carol.state().chat.map((c) => c.text);
    expect(
      carolChats,
      'carol should see alice-from-save-*'
    ).toContain('alice-from-save-1');
    expect(carolChats).toContain('alice-from-save-2');
  });

  it('restored-then-late-join: A restores, joins, B joins later; B still sees A`s events', () => {
    // Edge case the architect alluded to: A is "first" in a fresh
    // session, B joins later.  B's onPeerConnect(A) fires → B
    // requests A's events.  A's sync-response carries the restored
    // events.
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const savedLog = new EventLog('alice');
    savedLog.append('peer-join', { name: 'Alice' });
    savedLog.append('chat', { text: 'restored-1' });
    savedLog.append('chat', { text: 'restored-2' });
    for (const e of savedLog.events()) alice.applyEvent(e);

    // B joins fresh.
    const bob = makePeer('bob', net);
    const bobChats = bob.state().chat.map((c) => c.text);
    expect(bobChats).toEqual(['restored-1', 'restored-2']);
  });

  it('locally-appended-after-restore: A appends new events post-restore, they reach B normally', () => {
    // Positive control: the post-restore append path is the normal
    // gossip path and obviously works; this pins the protocol seam.
    const net = new InMemoryNetwork();
    const alice = makePeer('alice', net);
    const savedLog = new EventLog('alice');
    savedLog.append('peer-join', { name: 'Alice' });
    savedLog.append('chat', { text: 'restored' });
    for (const e of savedLog.events()) alice.applyEvent(e);

    const bob = makePeer('bob', net);
    // Now alice appends fresh — normal share-broadcast.
    alice.append('chat', { text: 'fresh' });
    const bobChats = bob.state().chat.map((c) => c.text);
    expect(bobChats).toContain('restored');
    expect(bobChats).toContain('fresh');
  });
});

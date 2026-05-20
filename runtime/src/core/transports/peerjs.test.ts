/**
 * Unit tests for PeerJSTransport using a mock peerjs Peer.  The mock
 * satisfies the structural interface (PeerJsPeerLike, DataConnectionLike)
 * the transport depends on; it does not import peerjs.  This isolates the
 * transport's protocol-handling logic from peerjs's browser-only runtime.
 *
 * Real-network validation happens separately (Playwright e2e, future).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  PeerJSTransport,
  type PeerJsPeerLike,
  type DataConnectionLike
} from './peerjs';

type EventName = 'open' | 'data' | 'close' | 'error';
type PeerEventName = 'open' | 'error' | 'disconnected' | 'close' | 'connection';

class MockDataConnection implements DataConnectionLike {
  readonly listeners = new Map<EventName, Array<(arg?: unknown) => void>>();
  open = false;
  sent: unknown[] = [];

  constructor(public readonly peer: string) {}

  // Overloaded signatures to satisfy DataConnectionLike's per-event types.
  on(event: 'open', handler: () => void): void;
  on(event: 'data', handler: (data: unknown) => void): void;
  on(event: 'close', handler: () => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: EventName, handler: any): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(handler);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit('close');
  }

  /** Test-only: fire an event manually. */
  emit(event: EventName, payload?: unknown): void {
    if (event === 'open') this.open = true;
    if (event === 'close') this.open = false;
    const list = this.listeners.get(event) ?? [];
    for (const h of list) h(payload);
  }
}

class MockPeer implements PeerJsPeerLike {
  readonly listeners = new Map<PeerEventName, Array<(arg?: unknown) => void>>();
  readonly outgoingConnections: MockDataConnection[] = [];

  constructor(public readonly id: string) {}

  on(event: 'connection', handler: (conn: DataConnectionLike) => void): void;
  on(event: 'open', handler: () => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  on(event: 'disconnected', handler: () => void): void;
  on(event: 'close', handler: () => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: PeerEventName, handler: any): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(handler);
  }

  connect(peerId: string): DataConnectionLike {
    const conn = new MockDataConnection(peerId);
    this.outgoingConnections.push(conn);
    return conn;
  }

  destroy(): void {
    this.emit('close');
  }

  /** Simulate an incoming connection from another peer. */
  emitIncoming(conn: MockDataConnection): void {
    this.emit('connection', conn);
  }

  emit(event: PeerEventName, payload?: unknown): void {
    const list = this.listeners.get(event) ?? [];
    for (const h of list) h(payload);
  }
}

describe('PeerJSTransport — basics', () => {
  it('exposes the peer id', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({ peer });
    expect(transport.peerId).toBe('alice');
  });

  it('starts with no connected peers', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({ peer });
    expect(transport.connectedPeers()).toEqual([]);
  });

  it('connectTo opens a connection but does not mark connected until open fires', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({ peer });
    transport.connectTo('bob');
    expect(peer.outgoingConnections).toHaveLength(1);
    expect(transport.connectedPeers()).toEqual([]);
    peer.outgoingConnections[0].emit('open');
    expect(transport.connectedPeers()).toEqual(['bob']);
  });

  it('initial known-peers are connected immediately', () => {
    const peer = new MockPeer('alice');
    new PeerJSTransport({
      peer,
      knownPeers: ['bob', 'carol']
    });
    expect(peer.outgoingConnections.map((c) => c.peer)).toEqual([
      'bob',
      'carol'
    ]);
  });
});

describe('PeerJSTransport — message round-trip', () => {
  it('outgoing send goes through the data channel after open', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({ peer });
    transport.connectTo('bob');
    const conn = peer.outgoingConnections[0];
    conn.emit('open');
    transport.send('bob', { hello: 'world' });
    expect(conn.sent).toEqual([{ hello: 'world' }]);
  });

  it('send to unknown peer is silently dropped', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({ peer });
    expect(() => transport.send('nobody', { x: 1 })).not.toThrow();
  });

  it('send broadcast reaches every open connection', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({
      peer,
      knownPeers: ['bob', 'carol']
    });
    peer.outgoingConnections[0].emit('open');
    peer.outgoingConnections[1].emit('open');
    transport.send('broadcast', { x: 1 });
    expect(peer.outgoingConnections[0].sent).toEqual([{ x: 1 }]);
    expect(peer.outgoingConnections[1].sent).toEqual([{ x: 1 }]);
  });

  it('incoming data from a connection fires onMessage', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({ peer });
    const handler = vi.fn();
    transport.onMessage(handler);
    const incoming = new MockDataConnection('bob');
    peer.emitIncoming(incoming);
    incoming.emit('open');
    incoming.emit('data', { x: 1 });
    expect(handler).toHaveBeenCalledWith('bob', { x: 1 });
  });
});

describe('PeerJSTransport — events', () => {
  it('open on a connection fires onPeerConnect', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({ peer });
    const handler = vi.fn();
    transport.onPeerConnect(handler);
    transport.connectTo('bob');
    peer.outgoingConnections[0].emit('open');
    expect(handler).toHaveBeenCalledWith('bob');
  });

  it('close on a connection fires onPeerDisconnect', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({ peer });
    const handler = vi.fn();
    transport.onPeerDisconnect(handler);
    transport.connectTo('bob');
    const conn = peer.outgoingConnections[0];
    conn.emit('open');
    conn.emit('close');
    expect(handler).toHaveBeenCalledWith('bob');
    expect(transport.connectedPeers()).toEqual([]);
  });

  it('handler exceptions do not break iteration', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({
      peer,
      log: () => undefined
    });
    const goodHandler = vi.fn();
    transport.onMessage(() => {
      throw new Error('first handler threw');
    });
    transport.onMessage(goodHandler);
    const incoming = new MockDataConnection('bob');
    peer.emitIncoming(incoming);
    incoming.emit('open');
    incoming.emit('data', { x: 1 });
    expect(goodHandler).toHaveBeenCalledWith('bob', { x: 1 });
  });
});

describe('PeerJSTransport — close', () => {
  it('close prevents further sends', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({ peer });
    transport.connectTo('bob');
    peer.outgoingConnections[0].emit('open');
    transport.close();
    transport.send('bob', { x: 1 });
    expect(peer.outgoingConnections[0].sent).toEqual([]);
  });

  it('close destroys the peer', () => {
    const peer = new MockPeer('alice');
    const destroyHandler = vi.fn();
    peer.on('close', destroyHandler);
    const transport = new PeerJSTransport({ peer });
    transport.close();
    expect(destroyHandler).toHaveBeenCalled();
  });

  it('close is idempotent', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({ peer });
    transport.close();
    expect(() => transport.close()).not.toThrow();
  });
});

describe('PeerJSTransport — connectTo edge cases', () => {
  it('repeated connectTo on same peer is a no-op (already connecting)', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({ peer });
    transport.connectTo('bob');
    peer.outgoingConnections[0].emit('open');
    transport.connectTo('bob');
    expect(peer.outgoingConnections).toHaveLength(1);
  });

  it('connectTo after close is a no-op', () => {
    const peer = new MockPeer('alice');
    const transport = new PeerJSTransport({ peer });
    transport.close();
    transport.connectTo('bob');
    expect(peer.outgoingConnections).toHaveLength(0);
  });
});

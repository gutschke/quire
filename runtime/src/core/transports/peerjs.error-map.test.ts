/**
 * Parameterized table for PeerJS error.type → TransportError.code
 * mapping.  Pins the surface so a future "expand the mapping"
 * change doesn't silently regress any existing translation.
 */

import { describe, it, expect } from 'vitest';
import { PeerJSTransport } from './peerjs';
import type {
  PeerJsPeerLike,
  DataConnectionLike
} from './peerjs';
import type { TransportError } from '../transport';

function mockPeer(): {
  peer: PeerJsPeerLike & { open: boolean };
  fireError: (err: { type?: string; message?: string }) => void;
} {
  const handlers: Record<string, Array<(arg: unknown) => void>> = {};
  const peer = {
    id: 'mock-peer',
    open: true,
    on(event: string, h: (arg: unknown) => void): void {
      (handlers[event] ??= []).push(h);
    },
    off(event: string, h: (arg: unknown) => void): void {
      handlers[event] = (handlers[event] ?? []).filter((x) => x !== h);
    },
    connect(): DataConnectionLike {
      return {
        peer: '',
        open: false,
        on: () => undefined,
        send: () => undefined,
        close: () => undefined
      };
    },
    destroy(): void {}
  } as unknown as PeerJsPeerLike & { open: boolean };
  const fireError = (err: { type?: string; message?: string }): void => {
    for (const h of handlers['error'] ?? []) h(err);
  };
  return { peer, fireError };
}

const cases: Array<{
  type: string;
  expectedCode: TransportError['code'];
  description: string;
}> = [
  {
    type: 'peer-unavailable',
    expectedCode: 'peer-unavailable',
    description: 'PeerJS peer-unavailable → peer-unavailable'
  },
  {
    type: 'network',
    expectedCode: 'broker-unreachable',
    description: 'network → broker-unreachable'
  },
  {
    type: 'server-error',
    expectedCode: 'broker-unreachable',
    description: 'server-error → broker-unreachable'
  },
  {
    type: 'socket-error',
    expectedCode: 'broker-unreachable',
    description: 'socket-error → broker-unreachable'
  },
  {
    type: 'socket-closed',
    expectedCode: 'broker-unreachable',
    description: 'socket-closed → broker-unreachable'
  },
  {
    type: 'unavailable-id',
    expectedCode: 'broker-unreachable',
    description: 'unavailable-id → broker-unreachable'
  },
  {
    type: 'invalid-id',
    expectedCode: 'broker-unreachable',
    description: 'invalid-id → broker-unreachable'
  },
  {
    type: 'invalid-key',
    expectedCode: 'broker-unreachable',
    description: 'invalid-key → broker-unreachable'
  },
  {
    type: 'ssl-unavailable',
    expectedCode: 'broker-unreachable',
    description: 'ssl-unavailable → broker-unreachable'
  },
  {
    type: 'completely-unknown-future-type',
    expectedCode: 'unknown',
    description: 'unknown type → unknown'
  }
];

describe('PeerJSTransport error translation', () => {
  for (const { type, expectedCode, description } of cases) {
    it(description, () => {
      const { peer, fireError } = mockPeer();
      const transport = new PeerJSTransport({ peer, log: () => {} });
      const received: TransportError[] = [];
      transport.onError((err) => received.push(err));
      fireError({ type, message: `${type} fired` });
      expect(received).toHaveLength(1);
      expect(received[0].code).toBe(expectedCode);
      expect(received[0].message).toBe(`${type} fired`);
      transport.close();
    });
  }

  it('extracts peerId from a peer-unavailable message when present', () => {
    const { peer, fireError } = mockPeer();
    const transport = new PeerJSTransport({ peer, log: () => {} });
    const received: TransportError[] = [];
    transport.onError((err) => received.push(err));
    fireError({
      type: 'peer-unavailable',
      message: 'Could not connect to peer ABCD-1234'
    });
    expect(received[0].peerId).toBe('ABCD-1234');
    transport.close();
  });

  it('does NOT fire onError after close()', () => {
    const { peer, fireError } = mockPeer();
    const transport = new PeerJSTransport({ peer, log: () => {} });
    const received: TransportError[] = [];
    transport.onError((err) => received.push(err));
    transport.close();
    fireError({ type: 'network', message: 'late' });
    expect(received).toEqual([]);
  });
});

/**
 * Transport interface — the boundary between application logic (Peer) and
 * the network medium (in-memory, PeerJS, future alternatives).
 *
 * All Transport implementations must:
 *   - emit `onPeerConnect` for every peer that becomes reachable, including
 *     peers already present when this transport joined the network;
 *   - emit `onPeerDisconnect` for every peer that becomes unreachable,
 *     including via partition;
 *   - deliver messages exactly once when delivery succeeds;
 *   - silently drop messages to / from a closed peer.
 *
 * Transports are byte-shovels.  They do not know about EventLog, state, or
 * protocol messages.
 */

import type { PeerId } from './event-log';

export type TransportTarget = PeerId | 'broadcast';

export type MessageHandler = (from: PeerId, payload: unknown) => void;
export type PeerEventHandler = (peerId: PeerId) => void;

/**
 * Categorized transport errors.  `peer-unavailable` is the most
 * important: PeerJS emits this when an outbound connect targets an
 * id the broker doesn't know about (mistyped pairing code, expired
 * session).  Before this surface existed the controller would
 * silently stay in "active" with no peers — a worse UX than a
 * thrown error.
 */
export interface TransportError {
  code:
    | 'peer-unavailable'
    | 'broker-unreachable'
    | 'connection-failed'
    | 'unknown';
  /** Target peer id when known (e.g. unavailable peer). */
  peerId?: PeerId;
  message: string;
}

export type ErrorHandler = (err: TransportError) => void;

/** Unsubscribe function returned by on* handlers. */
export type Unsubscribe = () => void;

export interface Transport {
  readonly peerId: PeerId;
  send(to: TransportTarget, payload: unknown): void;
  onMessage(handler: MessageHandler): Unsubscribe;
  onPeerConnect(handler: PeerEventHandler): Unsubscribe;
  onPeerDisconnect(handler: PeerEventHandler): Unsubscribe;
  /** Subscribe to async transport errors (peer-unavailable, etc). */
  onError(handler: ErrorHandler): Unsubscribe;
  connectedPeers(): readonly PeerId[];
  close(): void;
}

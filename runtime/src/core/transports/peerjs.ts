/**
 * PeerJS Transport adapter.  Wraps a peerjs `Peer` instance and implements
 * the framework's Transport interface so the Peer orchestrator can use it
 * unchanged.
 *
 * This file depends only on the minimal interfaces below (PeerJsPeerLike,
 * DataConnectionLike) — not on the peerjs package itself.  Production code
 * passes a real `peerjs.Peer`; tests pass a mock implementation.  The
 * indirection keeps unit tests runnable in Node (peerjs's webrtc-adapter
 * bundling is browser-only).
 *
 * The real-network smoke test that boots a peerjs-server lives in
 * `src/test/integration/peerjs-real.test.ts`.  Validating the full
 * PeerJSTransport + real PeerJS + real WebRTC stack happens in a Playwright
 * end-to-end suite (not in this commit).
 */

import type { PeerId } from '../event-log';
import type {
  Transport,
  TransportTarget,
  MessageHandler,
  PeerEventHandler,
  ErrorHandler,
  TransportError,
  Unsubscribe
} from '../transport';

/**
 * Subset of peerjs's `Peer` interface that this adapter depends on.
 * Compatible with the real peerjs Peer (v1.5+) by structural typing.
 */
export interface PeerJsPeerLike {
  readonly id: string;
  on(event: 'connection', handler: (conn: DataConnectionLike) => void): void;
  on(event: 'open', handler: () => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  on(event: 'disconnected', handler: () => void): void;
  on(event: 'close', handler: () => void): void;
  connect(peerId: string, options?: { reliable?: boolean }): DataConnectionLike;
  destroy(): void;
}

export interface DataConnectionLike {
  readonly peer: string;
  readonly open: boolean;
  on(event: 'open', handler: () => void): void;
  on(event: 'data', handler: (data: unknown) => void): void;
  on(event: 'close', handler: () => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  send(data: unknown): void;
  close(): void;
}

export interface PeerJSTransportOptions {
  /** A peerjs Peer that has already had its `open` event fire. */
  peer: PeerJsPeerLike;
  /** Optional: peer IDs to initiate outbound connections to immediately. */
  knownPeers?: PeerId[];
  /** Logger for errors.  Defaults to console.error. */
  log?: (message: string, err: unknown) => void;
}

export class PeerJSTransport implements Transport {
  readonly peerId: PeerId;
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly connectHandlers = new Set<PeerEventHandler>();
  private readonly disconnectHandlers = new Set<PeerEventHandler>();
  private readonly errorHandlers = new Set<ErrorHandler>();
  private readonly connections = new Map<PeerId, DataConnectionLike>();
  private readonly log: (m: string, err: unknown) => void;
  private closed = false;

  constructor(private readonly opts: PeerJSTransportOptions) {
    this.peerId = opts.peer.id;
    this.log =
      opts.log ?? ((m, err) => console.error(`[PeerJSTransport] ${m}`, err));

    opts.peer.on('connection', (conn) => this.attachConnection(conn, conn.peer));
    opts.peer.on('error', (err) => {
      // Translate PeerJS's error shape into a typed TransportError so
      // SessionController can react.  PeerJS errors carry a `type` field
      // (e.g. 'peer-unavailable', 'network', 'server-error'); we map a
      // small set of high-signal ones and bucket the rest as 'unknown'.
      this.log('peer error', err);
      this.emitError(translatePeerJsError(err));
    });
    opts.peer.on('disconnected', () => {
      // PeerJS lost the broker connection.  It auto-reconnects by default.
      // While disconnected, in-flight data-channel traffic still works.
    });
    opts.peer.on('close', () => {
      this.closed = true;
    });

    for (const peerId of opts.knownPeers ?? []) {
      this.connectTo(peerId);
    }
  }

  private emitError(err: TransportError): void {
    if (this.closed) return;
    for (const h of this.errorHandlers) {
      try {
        h(err);
      } catch (e) {
        this.log('error handler threw', e);
      }
    }
  }

  onError(handler: ErrorHandler): Unsubscribe {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  send(to: TransportTarget, payload: unknown): void {
    if (this.closed) return;
    const recipients =
      to === 'broadcast' ? Array.from(this.connections.keys()) : [to];
    for (const id of recipients) {
      const conn = this.connections.get(id);
      if (conn && conn.open) {
        try {
          conn.send(payload);
        } catch (err) {
          this.log(`send to ${id} failed`, err);
        }
      }
      // No connection yet?  Caller should connectTo(peerId) first.  We
      // deliberately drop rather than buffer to keep send() side-effect-free
      // with respect to connection state.
    }
  }

  onMessage(handler: MessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onPeerConnect(handler: PeerEventHandler): Unsubscribe {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  onPeerDisconnect(handler: PeerEventHandler): Unsubscribe {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  connectedPeers(): readonly PeerId[] {
    return Array.from(this.connections.keys());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const conn of this.connections.values()) {
      try {
        conn.close();
      } catch (err) {
        this.log('connection close failed', err);
      }
    }
    this.connections.clear();
    this.messageHandlers.clear();
    this.connectHandlers.clear();
    this.disconnectHandlers.clear();
    this.errorHandlers.clear();
    try {
      this.opts.peer.destroy();
    } catch (err) {
      this.log('peer destroy failed', err);
    }
  }

  /** Explicitly open a data channel to a peer by ID. */
  connectTo(peerId: PeerId): void {
    if (this.closed) return;
    if (this.connections.has(peerId)) return;
    const conn = this.opts.peer.connect(peerId, { reliable: true });
    this.attachConnection(conn, peerId);
  }

  private attachConnection(
    conn: DataConnectionLike,
    peerId: PeerId
  ): void {
    conn.on('open', () => {
      if (this.closed) return;
      this.connections.set(peerId, conn);
      for (const h of this.connectHandlers) {
        try {
          h(peerId);
        } catch (err) {
          this.log('connect handler threw', err);
        }
      }
    });
    conn.on('data', (data) => {
      if (this.closed) return;
      for (const h of this.messageHandlers) {
        try {
          h(peerId, data);
        } catch (err) {
          this.log('message handler threw', err);
        }
      }
    });
    conn.on('close', () => {
      if (this.closed) return;
      if (!this.connections.delete(peerId)) return;
      for (const h of this.disconnectHandlers) {
        try {
          h(peerId);
        } catch (err) {
          this.log('disconnect handler threw', err);
        }
      }
    });
    conn.on('error', (err) => {
      this.log(`connection ${peerId} error`, err);
      this.emitError({
        code: 'connection-failed',
        peerId,
        message: (err as Error)?.message ?? String(err)
      });
    });
  }
}

/**
 * Map PeerJS's loosely-typed error events into our TransportError
 * shape.  PeerJS errors carry a `type` field with documented values;
 * we surface the ones SessionController needs to react to and bucket
 * the rest as 'unknown'.
 */
function translatePeerJsError(err: unknown): TransportError {
  const e = err as { type?: string; message?: string };
  const message = e?.message ?? String(err);
  switch (e?.type) {
    case 'peer-unavailable': {
      // PeerJS's message is typically "Could not connect to peer <id>".
      const m = /peer\s+([A-Za-z0-9._-]+)/i.exec(message);
      return {
        code: 'peer-unavailable',
        peerId: m?.[1],
        message
      };
    }
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'unavailable-id':
    case 'invalid-id':
    case 'invalid-key':
    case 'ssl-unavailable':
      return { code: 'broker-unreachable', message };
    default:
      return { code: 'unknown', message };
  }
}

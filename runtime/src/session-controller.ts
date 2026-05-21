/**
 * SessionController — wraps the multiplayer core (EventLog + Peer + Transport)
 * in a UI-friendly facade.  Owns three modes:
 *
 *   - solo   : no networking; append() is a no-op; shared state is empty.
 *   - host   : a Peer is created over a host-side transport; the transport's
 *              peer id is the pairing code that guests need to join; the
 *              host claims coordinator on first connect.
 *   - guest  : a Peer is created over a guest-side transport that has
 *              already initiated a connection to the host using the code.
 *
 * Tests inject a TransportFactory that returns InMemoryTransports; the
 * production app uses a PeerJS-backed factory.  Either way, the controller
 * stays transport-agnostic.
 */

import { Peer } from './core/peer';
import type { Transport, Unsubscribe } from './core/transport';
import type { SessionState as SharedState } from './core/state';
import { emptyState } from './core/state';

export type SessionMode = 'solo' | 'host' | 'guest';
export type SessionStatus = 'idle' | 'connecting' | 'active' | 'error';

export interface SessionView {
  mode: SessionMode;
  status: SessionStatus;
  peerId: string | null;
  pairingCode: string | null;
  connectedPeers: string[];
  shared: SharedState;
  error: string | null;
}

export type SessionListener = (view: SessionView) => void;

export interface HostHandle {
  transport: Transport;
  pairingCode: string;
}

export interface GuestHandle {
  transport: Transport;
}

export interface TransportFactory {
  createHost(): Promise<HostHandle>;
  createGuest(code: string): Promise<GuestHandle>;
}

export class SessionController {
  private peer: Peer | null = null;
  private transport: Transport | null = null;
  private mode: SessionMode = 'solo';
  private status: SessionStatus = 'idle';
  private peerId: string | null = null;
  private pairingCode: string | null = null;
  private error: string | null = null;
  private readonly listeners = new Set<SessionListener>();
  private readonly unsubscribes: Unsubscribe[] = [];
  // Bumped on every leave() or new host()/join() to invalidate in-flight ops.
  // If an await crosses a leave(), the post-await code checks `gen !==
  // this.generation` and bails out — closing any orphan transport.
  private generation = 0;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly factory: TransportFactory) {}

  view(): SessionView {
    return {
      mode: this.mode,
      status: this.status,
      peerId: this.peerId,
      pairingCode: this.pairingCode,
      connectedPeers: this.transport
        ? Array.from(this.transport.connectedPeers())
        : [],
      shared: this.peer ? this.peer.state() : emptyState(),
      error: this.error
    };
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.view());
    return () => this.listeners.delete(listener);
  }

  host(displayName?: string): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.status === 'active' && this.mode === 'host') return Promise.resolve();
    this.inFlight = this.runHost(displayName).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  join(code: string, displayName?: string): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.status === 'active' && this.mode === 'guest') return Promise.resolve();
    this.inFlight = this.runJoin(code, displayName).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  leave(): void {
    // Bump generation first so any in-flight host()/join() awaits bail
    // out instead of attaching a doomed transport over the cleared state.
    this.generation++;
    this.cleanup();
    this.notify();
  }

  append(kind: string, payload: unknown): void {
    if (!this.peer) return;
    this.peer.append(kind, payload);
    this.notify();
  }

  private async runHost(displayName?: string): Promise<void> {
    const gen = ++this.generation;
    this.cleanup();
    this.mode = 'host';
    this.status = 'connecting';
    this.error = null;
    this.notify();
    let handle: HostHandle;
    try {
      handle = await this.factory.createHost();
    } catch (e) {
      if (gen !== this.generation) return;
      this.error = e instanceof Error ? e.message : 'host failed';
      this.status = 'error';
      this.mode = 'solo';
      this.notify();
      throw e;
    }
    if (gen !== this.generation) {
      // leave() (or another host/join) raced us; abandon the new transport.
      this.safeCloseTransport(handle.transport);
      return;
    }
    this.attachPeer(handle.transport);
    this.pairingCode = handle.pairingCode;
    this.peerId = handle.transport.peerId;
    this.status = 'active';
    // Host announces itself and claims coordinator.  Guests join later;
    // they catch up via Peer's constructor-time sync-request pull-loop
    // (see core/peer.ts constructor) — there's no need to push events
    // here.
    this.peer!.append('peer-join', { name: displayName });
    this.peer!.append('coordinator-claim', {});
    this.notify();
  }

  private async runJoin(code: string, displayName?: string): Promise<void> {
    const gen = ++this.generation;
    this.cleanup();
    this.mode = 'guest';
    this.status = 'connecting';
    this.error = null;
    this.notify();
    let handle: GuestHandle;
    try {
      handle = await this.factory.createGuest(code);
    } catch (e) {
      if (gen !== this.generation) return;
      this.error = e instanceof Error ? e.message : 'join failed';
      this.status = 'error';
      this.mode = 'solo';
      this.notify();
      throw e;
    }
    if (gen !== this.generation) {
      this.safeCloseTransport(handle.transport);
      return;
    }
    this.attachPeer(handle.transport);
    this.peerId = handle.transport.peerId;
    this.pairingCode = null;
    this.status = 'active';
    this.peer!.append('peer-join', { name: displayName });
    this.notify();
  }

  private cleanup(): void {
    for (const u of this.unsubscribes) {
      try {
        u();
      } catch {
        /* listener teardown shouldn't throw, but guard anyway */
      }
    }
    this.unsubscribes.length = 0;
    if (this.peer) {
      // peer.close() also closes its transport.
      this.peer.close();
      this.peer = null;
    }
    this.transport = null;
    this.mode = 'solo';
    this.status = 'idle';
    this.peerId = null;
    this.pairingCode = null;
    this.error = null;
  }

  private safeCloseTransport(t: Transport): void {
    try {
      t.close();
    } catch {
      /* ignore; we're already abandoning this transport */
    }
  }

  private attachPeer(transport: Transport): void {
    this.transport = transport;
    this.peer = new Peer(transport.peerId, transport);
    this.unsubscribes.push(this.peer.onStateChange(() => this.notify()));
    this.unsubscribes.push(transport.onPeerConnect(() => this.notify()));
    this.unsubscribes.push(transport.onPeerDisconnect(() => this.notify()));
    // Transport errors (peer-unavailable, broker-unreachable, etc.)
    // transition the session into the error state.  Before this hook
    // existed, a guest who joined with a bad code stayed in "active"
    // with 0 peers forever — visually a successful join with nothing
    // happening.
    this.unsubscribes.push(
      transport.onError((err) => {
        // Only surface "join failed" categories; an in-flight
        // connection-failed for one peer of many shouldn't tear the
        // whole session down.
        if (
          err.code === 'peer-unavailable' ||
          err.code === 'broker-unreachable'
        ) {
          this.error = err.message;
          this.status = 'error';
          this.mode = 'solo';
          this.notify();
        }
      })
    );
  }

  private notify(): void {
    const v = this.view();
    for (const listener of this.listeners) listener(v);
  }
}

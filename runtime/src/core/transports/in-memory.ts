/**
 * In-memory Transport for tests.  A shared InMemoryNetwork object routes
 * messages between transports registered with it.  Supports simulated
 * partition (isolating a peer), latency (delayed delivery), and drop rate
 * (probabilistic packet loss) so the test harness can exercise network
 * failure paths without a real network.
 *
 * The Network is process-local; one Network instance per simulated scenario.
 */

import type { PeerId } from '../event-log';
import type {
  Transport,
  TransportTarget,
  MessageHandler,
  PeerEventHandler,
  Unsubscribe
} from '../transport';

interface NetworkConfig {
  latencyMs: number;
  dropRate: number;
}

export class InMemoryNetwork {
  private readonly transports = new Map<PeerId, InMemoryTransport>();
  private readonly partitioned = new Set<PeerId>();
  private readonly config: NetworkConfig = { latencyMs: 0, dropRate: 0 };

  register(transport: InMemoryTransport): void {
    const existing = Array.from(this.transports.keys());
    this.transports.set(transport.peerId, transport);
    for (const otherId of existing) {
      const other = this.transports.get(otherId);
      if (!other) continue;
      if (this.partitioned.has(otherId)) continue;
      if (this.partitioned.has(transport.peerId)) continue;
      other._notifyConnect(transport.peerId);
      transport._notifyConnect(otherId);
    }
  }

  unregister(peerId: PeerId): void {
    if (!this.transports.delete(peerId)) return;
    this.partitioned.delete(peerId);
    for (const other of this.transports.values()) {
      other._notifyDisconnect(peerId);
    }
  }

  deliver(from: PeerId, to: TransportTarget, payload: unknown): void {
    if (this.partitioned.has(from)) return;
    const recipients: InMemoryTransport[] = [];
    if (to === 'broadcast') {
      for (const t of this.transports.values()) {
        if (t.peerId === from) continue;
        if (this.partitioned.has(t.peerId)) continue;
        recipients.push(t);
      }
    } else {
      const t = this.transports.get(to);
      if (t && !this.partitioned.has(to)) recipients.push(t);
    }
    for (const r of recipients) {
      if (this.config.dropRate > 0 && Math.random() < this.config.dropRate) {
        continue;
      }
      const dispatch = (): void => r._notifyMessage(from, payload);
      if (this.config.latencyMs > 0) {
        setTimeout(dispatch, this.config.latencyMs);
      } else {
        dispatch();
      }
    }
  }

  setPartition(peerId: PeerId, isolated: boolean): void {
    const transport = this.transports.get(peerId);
    if (isolated) {
      if (this.partitioned.has(peerId)) return;
      this.partitioned.add(peerId);
      if (!transport) return;
      for (const other of this.transports.values()) {
        if (other.peerId === peerId) continue;
        other._notifyDisconnect(peerId);
        transport._notifyDisconnect(other.peerId);
      }
    } else {
      if (!this.partitioned.delete(peerId)) return;
      if (!transport) return;
      for (const other of this.transports.values()) {
        if (other.peerId === peerId) continue;
        if (this.partitioned.has(other.peerId)) continue;
        other._notifyConnect(peerId);
        transport._notifyConnect(other.peerId);
      }
    }
  }

  setLatency(ms: number): void {
    this.config.latencyMs = Math.max(0, ms);
  }

  setDropRate(rate: number): void {
    this.config.dropRate = Math.max(0, Math.min(1, rate));
  }
}

export class InMemoryTransport implements Transport {
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly connectHandlers = new Set<PeerEventHandler>();
  private readonly disconnectHandlers = new Set<PeerEventHandler>();
  private readonly connectedSet = new Set<PeerId>();
  private closed = false;

  constructor(
    public readonly peerId: PeerId,
    private readonly network: InMemoryNetwork
  ) {
    this.network.register(this);
  }

  send(to: TransportTarget, payload: unknown): void {
    if (this.closed) return;
    this.network.deliver(this.peerId, to, payload);
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
    return Array.from(this.connectedSet);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.network.unregister(this.peerId);
  }

  // Internal — called by InMemoryNetwork.  Underscore prefix flags as not
  // part of the Transport interface.

  /** @internal */
  _notifyMessage(from: PeerId, payload: unknown): void {
    if (this.closed) return;
    for (const h of this.messageHandlers) h(from, payload);
  }

  /** @internal */
  _notifyConnect(peerId: PeerId): void {
    if (this.closed) return;
    if (this.connectedSet.has(peerId)) return;
    this.connectedSet.add(peerId);
    for (const h of this.connectHandlers) h(peerId);
  }

  /** @internal */
  _notifyDisconnect(peerId: PeerId): void {
    if (this.closed) return;
    if (!this.connectedSet.delete(peerId)) return;
    for (const h of this.disconnectHandlers) h(peerId);
  }
}

/**
 * Peer — combines an EventLog with a Transport.  Implements the gossip
 * protocol that replicates events across all connected peers:
 *
 *   - On local `append(kind, payload)`, broadcast a `share` message
 *     containing the new event to all currently-connected peers.
 *
 *   - On receiving a peer-connect event from the transport, send a
 *     `sync-request` to that peer with this peer's current vector clock.
 *     The remote responds with everything we don't yet have.
 *
 *   - On receiving a `sync-request`, respond with `events.since(clock)`.
 *
 *   - On receiving a `share` or `sync-response`, apply the events to the
 *     local log.  EventLog.apply is idempotent so re-delivery is safe.
 *
 * The protocol is flood-replication: simple, correct, not bandwidth-optimal
 * for large sessions.  Optimization (gossip suppression, snapshot transfer)
 * is a follow-up if real sessions get big.
 */

import { EventLog, type QuireEvent, type PeerId, type VectorClock } from './event-log';
import { materialize, type SessionState } from './state';
import type { Transport, Unsubscribe } from './transport';

interface ShareMessage {
  kind: 'share';
  event: QuireEvent;
}

interface SyncRequestMessage {
  kind: 'sync-request';
  clock: VectorClock;
}

interface SyncResponseMessage {
  kind: 'sync-response';
  events: QuireEvent[];
}

type ProtocolMessage = ShareMessage | SyncRequestMessage | SyncResponseMessage;

function isProtocolMessage(value: unknown): value is ProtocolMessage {
  if (!value || typeof value !== 'object') return false;
  const k = (value as { kind?: unknown }).kind;
  return k === 'share' || k === 'sync-request' || k === 'sync-response';
}

export type StateChangeHandler = (state: SessionState) => void;

export class Peer {
  private readonly log: EventLog;
  private readonly stateListeners = new Set<StateChangeHandler>();
  private readonly unsubscribes: Unsubscribe[] = [];

  constructor(
    public readonly peerId: PeerId,
    private readonly transport: Transport
  ) {
    this.log = new EventLog(peerId);

    this.unsubscribes.push(
      transport.onMessage((from, payload) => this.handleMessage(from, payload))
    );
    this.unsubscribes.push(
      transport.onPeerConnect((other) => this.requestSync(other))
    );
    // onPeerDisconnect: nothing to do; events stay in log for next-sync catchup.

    // Catch up on peers that were already connected when our handlers attached.
    // For in-memory tests the transport's register happens during its constructor,
    // before this Peer constructor runs, so those connect notifications fire into
    // a void.  This loop emulates what onPeerConnect would have done for each.
    for (const other of transport.connectedPeers()) {
      this.requestSync(other);
    }
  }

  /** Append a local event and broadcast it. */
  append(kind: string, payload: unknown): QuireEvent {
    const event = this.log.append(kind, payload);
    this.transport.send('broadcast', { kind: 'share', event } satisfies ShareMessage);
    this.notifyStateChange();
    return event;
  }

  /** Current materialized state. */
  state(): SessionState {
    return materialize(this.log.events());
  }

  /** Snapshot of the current vector clock. */
  clock(): VectorClock {
    return this.log.snapshot();
  }

  /** Subscribe to state changes.  Called after every local or remote event applied. */
  onStateChange(handler: StateChangeHandler): Unsubscribe {
    this.stateListeners.add(handler);
    return () => this.stateListeners.delete(handler);
  }

  /** For inspection / testing — direct access to the event list. */
  events(): readonly QuireEvent[] {
    return this.log.events();
  }

  close(): void {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes.length = 0;
    this.stateListeners.clear();
    this.transport.close();
  }

  private requestSync(otherPeer: PeerId): void {
    this.transport.send(otherPeer, {
      kind: 'sync-request',
      clock: this.log.snapshot()
    } satisfies SyncRequestMessage);
  }

  private handleMessage(from: PeerId, payload: unknown): void {
    if (!isProtocolMessage(payload)) return;
    switch (payload.kind) {
      case 'share': {
        if (this.log.apply(payload.event)) {
          this.notifyStateChange();
        }
        break;
      }
      case 'sync-request': {
        const events = this.log.since(payload.clock);
        if (events.length > 0) {
          this.transport.send(from, {
            kind: 'sync-response',
            events
          } satisfies SyncResponseMessage);
        }
        break;
      }
      case 'sync-response': {
        let changed = false;
        for (const event of payload.events) {
          if (this.log.apply(event)) changed = true;
        }
        if (changed) this.notifyStateChange();
        break;
      }
    }
  }

  private notifyStateChange(): void {
    const state = this.state();
    for (const h of this.stateListeners) h(state);
  }
}

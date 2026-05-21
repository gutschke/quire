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
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case 'share':
      return !!v.event && typeof v.event === 'object';
    case 'sync-request':
      return !!v.clock && typeof v.clock === 'object' && !Array.isArray(v.clock);
    case 'sync-response':
      return Array.isArray(v.events);
    default:
      return false;
  }
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

    // Catch up on peers that were already connected when our handlers
    // attached.  The in-memory transport's `register` runs synchronously in
    // its constructor, before this Peer constructor body runs, so:
    //
    //   - Connect notifications from other transports targeting us fire
    //     into a void (our onPeerConnect handler isn't attached yet).
    //   - Sync-requests sent by other peers' onPeerConnect handlers in
    //     response to seeing us join *also* land in a void (our onMessage
    //     handler isn't attached yet).
    //
    // The pull below is what saves convergence: we ask every already-
    // connected peer for their events, they respond with sync-response, we
    // catch up.  If anyone ever adds a "push initial state on connect"
    // optimization to this protocol, that push must NOT assume the new
    // peer's onMessage is wired — it isn't, until after this loop runs.
    // Convergence must stay pull-driven from the new peer's side.
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

  /**
   * Take over as session coordinator.  Unconditional: succeeds even
   * if another peer is currently coordinator (this is the supported
   * sick-DM-handoff workflow).  Synthesizes an audit chat entry
   * visible to all peers; callers are expected to gate this behind
   * a deliberate UI action with a named-coordinator confirmation
   * dialog (see UI in Phase 2b).
   */
  reclaimCoordinator(): QuireEvent {
    const fromPeerId = this.state().coordinator;
    return this.append('coordinator-reclaim', { fromPeerId });
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

  /**
   * Apply an externally-provided event to the local log without
   * broadcasting.  Used by load/restore paths: the events were
   * authored by someone else (the original session's peers), so
   * R2.1's transport-sender vs event.peerId check would reject any
   * re-share we'd attempt.  Future joiners catch up via the normal
   * sync-response pull when they connect.  Returns whether the
   * event was newly applied (false if duplicate or invalid).
   */
  applyEvent(event: QuireEvent): boolean {
    const applied = this.log.apply(event);
    if (applied) this.notifyStateChange();
    return applied;
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
        // Impersonation defense: a `share` is a NEW event from its
        // author, so the transport sender MUST equal the event's
        // claimed peerId.  Without this, mallory could broadcast a
        // 'coordinator-claim' or 'scene-reveal' event with
        // peerId='alice' and shadow-author actions attributed to
        // alice.  This is the cheapest authenticity check we can do
        // without cryptographic signatures.
        //
        // sync-response (below) is intentionally NOT subject to this
        // check — gossip forwarding requires peers to ship events
        // authored by others.  That tradeoff is documented; closing
        // it would require per-event signatures.
        if (payload.event && payload.event.peerId !== from) {
          // Silently drop — no need to alert the attacker by
          // responding.  Future: log this for monitoring.
          break;
        }
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

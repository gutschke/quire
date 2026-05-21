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
import type { QuireEvent } from './core/event-log';
import type { Transport, Unsubscribe } from './core/transport';
import type { SessionState as SharedState } from './core/state';
import { emptyState, filterForViewer, KNOWN_EVENT_KINDS } from './core/state';

export type SessionMode = 'solo' | 'host' | 'guest';
export type SessionStatus = 'idle' | 'connecting' | 'active' | 'error';

export interface SessionView {
  mode: SessionMode;
  status: SessionStatus;
  peerId: string | null;
  pairingCode: string | null;
  connectedPeers: string[];
  /**
   * Full, unfiltered shared state.  Reading this in a renderer is a
   * code smell unless the renderer is a DM-only surface; player-
   * visible renderers should read `filteredShared` instead so they
   * cannot accidentally leak DM-only fields (threadDebt,
   * scratchNotes, aiAudit, etc.) that ship in M3a+.
   *
   * Persistence / save-export / event-replay code paths legitimately
   * need the raw state and should keep using `shared`.
   */
  shared: SharedState;
  /**
   * Same as `shared` but with DM-only fields stripped when the local
   * peer (peerId) is NOT in coordHolders.  When the local peer is a
   * coord-holder (DM or past-coord), this is identical to `shared`.
   *
   * P0-4-followup (M1 gate Engine finding): adding this accessor so
   * M2 region components have a safe default.  Renderers that
   * migrate to use it cannot leak DM-only state.  Migration target:
   * by M3a, all player-visible renderers SHOULD use filteredShared
   * exclusively; `shared` becomes the DM-side read path.
   */
  filteredShared: SharedState;
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
    const shared = this.peer ? this.peer.state() : emptyState();
    // filteredShared applies the M3a+ DM-only render gate.  When the
    // local peer is null (no session) or is a coord-holder, the
    // filter passes the state through unchanged (no allocation in
    // the coord-holder hot path).  See filterForViewer for the
    // visibility rules.
    const filteredShared =
      this.peerId === null
        ? shared
        : filterForViewer(shared, this.peerId);
    return {
      mode: this.mode,
      status: this.status,
      peerId: this.peerId,
      pairingCode: this.pairingCode,
      connectedPeers: this.transport
        ? Array.from(this.transport.connectedPeers())
        : [],
      shared,
      filteredShared,
      error: this.error
    };
  }

  /**
   * Snapshot the current event log for serialization.  Returns an
   * empty array when no session is active (solo mode never builds
   * an event log).
   */
  getEvents(): readonly QuireEvent[] {
    return this.peer ? this.peer.events() : [];
  }

  /**
   * Apply a previously-saved event sequence to the current log.
   * Used by Load to rehydrate a session.  Caller is responsible for
   * ensuring the session is active first.  Returns the number of
   * events that were applied (vs duplicates / rejects, which are
   * counted elsewhere by applySaveToLog).
   */
  applyEvents(events: readonly QuireEvent[]): number {
    if (!this.peer) return 0;
    let applied = 0;
    for (const e of events) {
      if (this.peer.applyEvent(e)) applied++;
    }
    if (applied > 0) this.notify();
    return applied;
  }

  /**
   * Issue a coordinator-reclaim event.  Caller is responsible for
   * gating this behind a deliberate UI confirmation.  No-op when
   * not in an active session.
   */
  reclaimCoordinator(): void {
    if (!this.peer) return;
    this.peer.reclaimCoordinator();
    this.notify();
  }

  /**
   * Coordinator-only: rotate the pairing code.  Defensive measure
   * for the DM after a code leak (e.g. accidental screen-share).
   * Implementation: snapshot the current event log + display name,
   * leave the session, host a new one, replay the prior events
   * onto the new log so all in-flight session state is preserved.
   *
   * Already-connected guests will see a transport disconnect (their
   * data channel to the old host id is gone) and will need to
   * rejoin with the new code.  This is the intended UX — a leaked
   * code means anyone could be listening; the DM trades a moment
   * of friction for a clean break.
   */
  async regenerateCode(
    displayName?: string,
    campaign?: { owner: string; repo: string; ref: string }
  ): Promise<{
    oldCode: string | null;
    newCode: string | null;
  }> {
    if (!this.peer || this.mode !== 'host') {
      return { oldCode: null, newCode: null };
    }
    const oldCode = this.pairingCode;
    const events = this.peer.events().slice();
    this.leave();
    await this.host(displayName, campaign);
    if (this.peer) {
      // Re-apply the prior events into the fresh log so the new
      // session continues from where we were.  Each apply skips if
      // duplicate (the new host's peer-join + coordinator-claim are
      // distinct from the old ones, so no collision).
      for (const e of events) {
        this.peer.applyEvent(e);
      }
      this.notify();
    }
    return { oldCode, newCode: this.pairingCode };
  }

  /**
   * Coordinator-only: mark another peer as departed.  Used by the
   * DM-side roster's "remove" button to clean up stale peers
   * (a player whose browser tab closed without a clean leave, etc).
   * No-op when not coordinator or when targeting self.
   */
  kickPeer(peerId: string): void {
    if (!this.peer) return;
    if (this.peer.state().coordinator !== this.peer.peerId) return;
    if (peerId === this.peer.peerId) return;
    this.peer.append('peer-disconnect', { peerId });
    this.notify();
  }

  /**
   * Update the local peer's display name, character string, and/or
   * PC binding.  All fields optional; pass empty string to clear.
   * Emits a peer-rename event that propagates to all peers.
   *
   * M3a.2 (P-M3a-pc-binding): `pcId` carries the canonical PC
   * character-record id when the local player has claimed one.
   * Renderers prefer this over the free-text `character` field.
   */
  rename(opts: {
    name?: string;
    character?: string;
    pcId?: string;
  }): void {
    if (!this.peer) return;
    const payload: Record<string, string> = {};
    if (typeof opts.name === 'string') payload.name = opts.name.trim();
    if (typeof opts.character === 'string') {
      payload.character = opts.character.trim();
    }
    if (typeof opts.pcId === 'string') {
      payload.pcId = opts.pcId.trim();
    }
    if (Object.keys(payload).length === 0) return;
    this.peer.append('peer-rename', payload);
    this.notify();
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.view());
    return () => this.listeners.delete(listener);
  }

  host(
    displayName?: string,
    campaign?: { owner: string; repo: string; ref: string }
  ): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.status === 'active' && this.mode === 'host') return Promise.resolve();
    this.inFlight = this.runHost(displayName, campaign).finally(() => {
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

  /**
   * Toggle the local peer's raised-hand state (M2.8, P1-7).  Self-
   * authored: the event's peerId IS the author, no DM gate.  No-op
   * when there's no active session.
   *
   * Emits `raise-hand` or `lower-hand` based on the current shared
   * state — calling toggleHand twice should be a round-trip.  The
   * materializer dedups (raise on an already-raised peer is a Set
   * add).
   */
  toggleHand(): void {
    if (!this.peer) return;
    const v = this.view();
    if (!v.peerId) return;
    const raised = v.shared.raisedHands.has(v.peerId);
    this.peer.append(raised ? 'lower-hand' : 'raise-hand', { v: 1 });
    this.notify();
  }

  private async runHost(
    displayName?: string,
    campaign?: { owner: string; repo: string; ref: string }
  ): Promise<void> {
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
    // Host announces itself, embeds the campaign reference so
    // guests can self-discover, and claims coordinator.  Guests join
    // later; they catch up via Peer's constructor-time sync-request
    // pull-loop (see core/peer.ts constructor) — there's no need to
    // push events here.
    //
    // P0-12: embed the local runtime's KNOWN_EVENT_KINDS count so
    // peers can detect mixed-version sessions.  When the materializer
    // sees a peer with `knownKindsCount` < local count, it can
    // surface a banner ("peer X is running an older Quire; some
    // events may not replicate visibly to them").  Forward-compat
    // is preserved either way; the warning is for the user.
    const peerJoinPayload: Record<string, unknown> = {
      knownKindsCount: KNOWN_EVENT_KINDS.size
    };
    if (displayName) peerJoinPayload.name = displayName;
    if (campaign) peerJoinPayload.campaign = campaign;
    this.peer!.append('peer-join', peerJoinPayload);
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
    // Guest peer-join — also embeds knownKindsCount so the host (and
    // other peers) can detect a mixed-version session early.
    this.peer!.append('peer-join', {
      name: displayName,
      knownKindsCount: KNOWN_EVENT_KINDS.size
    });
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
    this.unsubscribes.push(
      transport.onPeerDisconnect((departedPeerId) => {
        this.notify();
        // Coordinator-only: emit a peer-disconnect event so all
        // peers update their roster.  Without this, closing a
        // tab leaves the peer permanently in the roster.  Other
        // peers' materializer drops the event (coord-holders
        // check), so they wait for the coordinator's emission.
        if (
          this.peer &&
          this.peer.state().coordinator === this.peer.peerId &&
          departedPeerId !== this.peer.peerId
        ) {
          this.peer.append('peer-disconnect', { peerId: departedPeerId });
        }
      })
    );
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
          err.code !== 'peer-unavailable' &&
          err.code !== 'broker-unreachable'
        ) {
          return;
        }
        // Fully clean up (drops listeners, closes the dead transport
        // / peer) BEFORE setting the error state — leaving the dying
        // transport attached would let late events from it perturb
        // the view further, and would leak the WebRTC connection.
        const message = err.message;
        this.generation++;
        this.cleanup();
        this.error = message;
        this.status = 'error';
        this.mode = 'solo';
        this.notify();
      })
    );
  }

  private notify(): void {
    const v = this.view();
    for (const listener of this.listeners) listener(v);
  }
}

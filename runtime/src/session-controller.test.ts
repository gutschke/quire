import { describe, it, expect, beforeEach } from 'vitest';
import {
  SessionController,
  type TransportFactory,
  type SessionView
} from './session-controller';
import { InMemoryNetwork, InMemoryTransport } from './core/transports/in-memory';

class TestNetwork {
  readonly network = new InMemoryNetwork();
  private nextId = 1;

  factory(_role: 'host' | 'guest', forcedId?: string): TransportFactory {
    return {
      createHost: async () => {
        const id = forcedId ?? `host-${this.nextId++}`;
        const transport = new InMemoryTransport(id, this.network);
        return { transport, pairingCode: id };
      },
      createGuest: async (code: string) => {
        const id = forcedId ?? `guest-${this.nextId++}`;
        const transport = new InMemoryTransport(id, this.network);
        // Guest knows about host already; transport.connectedPeers()
        // is populated synchronously by the network so Peer's catch-up
        // loop will sync.
        void code;
        return { transport };
      }
    };
  }
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SessionController — solo', () => {
  it('starts in solo/idle with no peer or pairing code', () => {
    const ctl = new SessionController(new TestNetwork().factory('host'));
    const v = ctl.view();
    expect(v.mode).toBe('solo');
    expect(v.status).toBe('idle');
    expect(v.peerId).toBeNull();
    expect(v.pairingCode).toBeNull();
    expect(v.connectedPeers).toEqual([]);
  });

  it('append in solo is a no-op (events go nowhere)', () => {
    const ctl = new SessionController(new TestNetwork().factory('host'));
    expect(() => ctl.append('chat', { text: 'hi' })).not.toThrow();
    expect(ctl.view().shared.chat).toEqual([]);
  });

  it('exposes filteredShared identical to shared in solo (no peer)', () => {
    // No peerId yet, so filterForViewer is bypassed (returns shared
    // unchanged); both fields should reference an empty state.
    const ctl = new SessionController(new TestNetwork().factory('host'));
    const v = ctl.view();
    expect(v.filteredShared).toBe(v.shared);
  });
});

describe('SessionController — filteredShared (P0-4-followup)', () => {
  it('returns identity (same reference) when local peer is a coord-holder', async () => {
    // Host joins; local peer becomes coord-holder; filter returns
    // shared unchanged without allocation.
    const net = new TestNetwork();
    const ctl = new SessionController(net.factory('host'));
    await ctl.host('DM');
    const v = ctl.view();
    expect(v.shared.coordHolders.has(v.peerId!)).toBe(true);
    expect(v.filteredShared).toBe(v.shared);
  });

  it('strips DM-only fields when local peer is not a coord-holder', async () => {
    // Synthesize a guest's view by spinning up two controllers in
    // an in-memory network: host claims coord first; guest joins
    // and sees only the public bits via filteredShared.
    const net = new TestNetwork();
    const host = new SessionController(net.factory('host'));
    await host.host('DM');
    const guest = new SessionController(net.factory('guest'));
    await guest.join('host', 'Player');
    // Wait for sync to propagate.
    await Promise.resolve();
    await Promise.resolve();
    const v = guest.view();
    // Guest is NOT in coordHolders.
    expect(v.shared.coordHolders.has(v.peerId!)).toBe(false);
    // filteredShared should be a different object with DM-only fields wiped.
    expect(v.filteredShared).not.toBe(v.shared);
    expect(v.filteredShared.threadDebt).toEqual({});
    expect(v.filteredShared.pinnedNpcs).toEqual([]);
    expect(v.filteredShared.scratchNotes).toEqual([]);
    expect(v.filteredShared.aiAudit).toEqual([]);
    // Player-visible fields are preserved.
    expect(v.filteredShared.coordinator).toBe(v.shared.coordinator);
    expect(v.filteredShared.chat).toEqual(v.shared.chat);
  });
});

describe('SessionController — host', () => {
  let net: TestNetwork;
  beforeEach(() => {
    net = new TestNetwork();
  });

  it('transitions idle → connecting → active and exposes pairing code', async () => {
    const ctl = new SessionController(net.factory('host', 'ABCD'));
    const views: SessionView[] = [];
    ctl.subscribe((v) => views.push(v));
    await ctl.host('DM');
    const v = ctl.view();
    expect(v.mode).toBe('host');
    expect(v.status).toBe('active');
    expect(v.peerId).toBe('ABCD');
    expect(v.pairingCode).toBe('ABCD');
    expect(views.some((x) => x.status === 'connecting')).toBe(true);
    expect(views[views.length - 1].status).toBe('active');
  });

  it('host appends an event and it shows up in shared state', async () => {
    const ctl = new SessionController(net.factory('host', 'H1'));
    await ctl.host('DM');
    ctl.append('chat', { text: 'session opened' });
    expect(ctl.view().shared.chat).toHaveLength(1);
    expect(ctl.view().shared.chat[0].text).toBe('session opened');
  });

  it('claims the coordinator role on host', async () => {
    const ctl = new SessionController(net.factory('host', 'H1'));
    await ctl.host('DM');
    expect(ctl.view().shared.coordinator).toBe('H1');
  });

  it('leave() restores solo/idle and clears connection state', async () => {
    const ctl = new SessionController(net.factory('host', 'H1'));
    await ctl.host('DM');
    ctl.leave();
    const v = ctl.view();
    expect(v.mode).toBe('solo');
    expect(v.status).toBe('idle');
    expect(v.peerId).toBeNull();
    expect(v.pairingCode).toBeNull();
  });
});

describe('SessionController — guest joining a host', () => {
  it('guest receives host events after joining', async () => {
    const net = new TestNetwork();
    const host = new SessionController(net.factory('host', 'HOST'));
    await host.host('DM');
    host.append('chat', { text: 'pre-join chatter' });

    const guest = new SessionController(net.factory('guest', 'GUEST'));
    await guest.join('HOST', 'Player');
    await settle();

    const gv = guest.view();
    expect(gv.mode).toBe('guest');
    expect(gv.status).toBe('active');
    expect(gv.peerId).toBe('GUEST');
    expect(gv.pairingCode).toBeNull();
    expect(gv.shared.chat).toHaveLength(1);
    expect(gv.shared.chat[0].text).toBe('pre-join chatter');
  });

  it('bidirectional event flow once both sides are connected', async () => {
    const net = new TestNetwork();
    const host = new SessionController(net.factory('host', 'HOST'));
    await host.host('DM');
    const guest = new SessionController(net.factory('guest', 'GUEST'));
    await guest.join('HOST', 'Player');
    await settle();

    guest.append('chat', { text: 'hi from guest' });
    host.append('chat', { text: 'hi from host' });
    await settle();

    const texts = (v: SessionView) => v.shared.chat.map((c) => c.text).sort();
    expect(texts(host.view())).toEqual(['hi from guest', 'hi from host']);
    expect(texts(guest.view())).toEqual(['hi from guest', 'hi from host']);
  });

  it('peer-connect populates connectedPeers on both sides', async () => {
    const net = new TestNetwork();
    const host = new SessionController(net.factory('host', 'HOST'));
    await host.host('DM');
    const guest = new SessionController(net.factory('guest', 'GUEST'));
    await guest.join('HOST', 'Player');
    await settle();

    expect(host.view().connectedPeers).toContain('GUEST');
    expect(guest.view().connectedPeers).toContain('HOST');
  });

  it('notifies subscribers on remote events', async () => {
    const net = new TestNetwork();
    const host = new SessionController(net.factory('host', 'HOST'));
    await host.host('DM');
    const guest = new SessionController(net.factory('guest', 'GUEST'));
    const guestEvents: SessionView[] = [];
    guest.subscribe((v) => guestEvents.push(v));
    await guest.join('HOST', 'Player');
    await settle();
    const beforeCount = guestEvents.length;
    host.append('chat', { text: 'live message' });
    await settle();
    expect(guestEvents.length).toBeGreaterThan(beforeCount);
    expect(
      guestEvents[guestEvents.length - 1].shared.chat.map((c) => c.text)
    ).toContain('live message');
  });
});

describe('SessionController — error paths', () => {
  it('moves to error status when the host factory throws', async () => {
    const failing: TransportFactory = {
      createHost: async () => {
        throw new Error('broker unreachable');
      },
      createGuest: async () => {
        throw new Error('unused');
      }
    };
    const ctl = new SessionController(failing);
    await expect(ctl.host()).rejects.toThrow();
    const v = ctl.view();
    expect(v.status).toBe('error');
    expect(v.error).toMatch(/broker/i);
  });

  it('moves to error status when the guest factory throws', async () => {
    const failing: TransportFactory = {
      createHost: async () => {
        throw new Error('unused');
      },
      createGuest: async () => {
        throw new Error('bad code');
      }
    };
    const ctl = new SessionController(failing);
    await expect(ctl.join('XXXX')).rejects.toThrow();
    const v = ctl.view();
    expect(v.status).toBe('error');
    expect(v.error).toMatch(/bad code/i);
  });

  it('host() while already active is a no-op (idempotent)', async () => {
    const net = new TestNetwork();
    const ctl = new SessionController(net.factory('host', 'H1'));
    await ctl.host('DM');
    await ctl.host('DM');
    expect(ctl.view().status).toBe('active');
  });

  it('host() called twice concurrently returns the same in-flight promise', async () => {
    const net = new TestNetwork();
    const ctl = new SessionController(net.factory('host', 'H1'));
    const p1 = ctl.host('DM');
    const p2 = ctl.host('DM');
    expect(p2).toBe(p1);
    await p1;
    expect(ctl.view().status).toBe('active');
  });
});

describe('SessionController — transport error lifecycle', () => {
  it('transport onError after leave() is dropped (no error-state re-entry)', async () => {
    // Drive the InMemoryTransport's onError hook directly via the
    // test-only _fireError so we can synthesize a late error after
    // the controller has unsubscribed.  Without the unsubscribe
    // call in cleanup(), the controller would transition to 'error'
    // even though the user has already left.
    const network = new InMemoryNetwork();
    const transport = new InMemoryTransport('LATE-HOST', network);
    const factory: TransportFactory = {
      createHost: async () => ({ transport, pairingCode: 'LATE-HOST' }),
      createGuest: async () => {
        throw new Error('unused');
      }
    };
    const ctl = new SessionController(factory);
    await ctl.host('DM');
    expect(ctl.view().status).toBe('active');
    ctl.leave();
    // Fire AFTER leave().  The session-controller's onError handler
    // is gone; the transport's _fireError no-ops because the
    // transport itself was closed by cleanup().
    transport._fireError({ code: 'peer-unavailable', message: 'late' });
    expect(ctl.view().status).toBe('idle');
    expect(ctl.view().error).toBeNull();
  });

  it('transport onError mid-session triggers cleanup + error state', async () => {
    const network = new InMemoryNetwork();
    const transport = new InMemoryTransport('FAIL-HOST', network);
    const factory: TransportFactory = {
      createHost: async () => ({ transport, pairingCode: 'FAIL-HOST' }),
      createGuest: async () => {
        throw new Error('unused');
      }
    };
    const ctl = new SessionController(factory);
    await ctl.host('DM');
    expect(ctl.view().status).toBe('active');
    transport._fireError({
      code: 'peer-unavailable',
      message: 'connection lost'
    });
    expect(ctl.view().status).toBe('error');
    expect(ctl.view().error).toBe('connection lost');
    expect(ctl.view().mode).toBe('solo');
  });

  it('connection-failed (non-fatal) does NOT tear down the session', async () => {
    const network = new InMemoryNetwork();
    const transport = new InMemoryTransport('OK-HOST', network);
    const factory: TransportFactory = {
      createHost: async () => ({ transport, pairingCode: 'OK-HOST' }),
      createGuest: async () => {
        throw new Error('unused');
      }
    };
    const ctl = new SessionController(factory);
    await ctl.host('DM');
    transport._fireError({
      code: 'connection-failed',
      peerId: 'transient',
      message: 'one peer dropped'
    });
    // Session stays active; not every per-connection failure is
    // session-fatal.
    expect(ctl.view().status).toBe('active');
  });
});

describe('SessionController — race cancellation', () => {
  function deferredFactory(): {
    factory: TransportFactory;
    resolveHost: (h: {
      transport: import('./core/transports/in-memory').InMemoryTransport;
      pairingCode: string;
    }) => void;
    rejectHost: (e: Error) => void;
  } {
    let res:
      | ((h: {
          transport: import('./core/transports/in-memory').InMemoryTransport;
          pairingCode: string;
        }) => void)
      | null = null;
    let rej: ((e: Error) => void) | null = null;
    const factory: TransportFactory = {
      createHost: () =>
        new Promise((resolve, reject) => {
          res = resolve;
          rej = reject;
        }),
      createGuest: async () => {
        throw new Error('unused');
      }
    };
    return {
      factory,
      resolveHost: (h) => res!(h),
      rejectHost: (e) => rej!(e)
    };
  }

  it('leave() during in-flight host() abandons the new transport', async () => {
    const { factory, resolveHost } = deferredFactory();
    const network = new InMemoryNetwork();
    const ctl = new SessionController(factory);
    const p = ctl.host('DM');
    // While host() awaits createHost, the user clicks Leave.
    ctl.leave();
    expect(ctl.view().status).toBe('idle');
    expect(ctl.view().mode).toBe('solo');
    // Now the broker resolves with a transport.
    const lateTransport = new InMemoryTransport('LATE', network);
    resolveHost({ transport: lateTransport, pairingCode: 'LATE' });
    await p; // should not throw
    // The orphan transport should have been closed; controller should
    // still be solo/idle.
    expect(ctl.view().status).toBe('idle');
    expect(ctl.view().mode).toBe('solo');
    expect(ctl.view().peerId).toBeNull();
  });

  it('host()-leave()-host() cleanly transitions and resyncs state', async () => {
    const net = new TestNetwork();
    const ctl = new SessionController(net.factory('host', 'H1'));
    await ctl.host('DM');
    ctl.append('chat', { text: 'first session' });
    ctl.leave();
    expect(ctl.view().shared.chat).toEqual([]);
    // Re-host with a fresh id under the same factory closure.
    const net2 = new TestNetwork();
    const ctl2 = new SessionController(net2.factory('host', 'H2'));
    await ctl2.host('DM');
    expect(ctl2.view().status).toBe('active');
    expect(ctl2.view().peerId).toBe('H2');
    expect(ctl2.view().shared.chat).toEqual([]);
  });

  it('append() while connecting is dropped (no peer yet)', async () => {
    const { factory, resolveHost } = deferredFactory();
    const network = new InMemoryNetwork();
    const ctl = new SessionController(factory);
    const p = ctl.host('DM');
    expect(ctl.view().status).toBe('connecting');
    // No peer yet — append should be a no-op, not throw.
    expect(() => ctl.append('chat', { text: 'too early' })).not.toThrow();
    const t = new InMemoryTransport('H', network);
    resolveHost({ transport: t, pairingCode: 'H' });
    await p;
    // The 'too early' append was dropped; only peer-join + coordinator-claim
    // appear in shared state.
    expect(ctl.view().shared.chat).toEqual([]);
  });
});

// @vitest-environment node

/**
 * Unit tests for BroadcastFollowingController.  Pin the cursor
 * monotonicity, the no-self-bounce DM gate, the home-route bail,
 * and the new inFlight guard against concurrent navigations.
 */

import { describe, it, expect } from 'vitest';
import type { ReactiveControllerHost } from 'lit';
import {
  BroadcastFollowingController,
  type BroadcastFollowingEnv
} from './broadcast-following-controller';
import type { SessionView } from '../session-controller';
import type { AppRoute } from '../routing';

function makeHost() {
  let updates = 0;
  const host: ReactiveControllerHost = {
    addController: () => {},
    removeController: () => {},
    requestUpdate: () => {
      updates++;
    },
    updateComplete: Promise.resolve(true)
  };
  return { host, updateCount: () => updates };
}

interface EnvHandle {
  env: BroadcastFollowingEnv;
  navCalls: AppRoute[];
  setView(v: SessionView | null): void;
  setCoord(b: boolean): void;
  /** Manually resolve the most-recent navigateToRoute promise. */
  resolveNav(): void;
  /** Manually reject the most-recent navigateToRoute promise. */
  rejectNav(): void;
}

function makeEnv(opts: {
  view?: SessionView | null;
  isCoord?: boolean;
  /** Override what parseStagePath returns; default returns a `scene` route. */
  parseTo?: AppRoute;
} = {}): EnvHandle {
  let view = opts.view ?? null;
  let isCoord = opts.isCoord ?? false;
  const navCalls: AppRoute[] = [];
  const navResolvers: Array<{
    resolve: () => void;
    reject: () => void;
  }> = [];
  const env: BroadcastFollowingEnv = {
    getSessionView: () => view,
    isCoordinator: () => isCoord,
    parseStagePath: (_path) =>
      opts.parseTo ?? ({ kind: 'scene', slug: 'x/y', episode: 'e', scene: 's' } as AppRoute),
    navigateToRoute: (route) => {
      navCalls.push(route);
      return new Promise<void>((resolve, reject) => {
        navResolvers.push({ resolve, reject });
      });
    }
  };
  return {
    env,
    navCalls,
    setView: (v) => {
      view = v;
    },
    setCoord: (b) => {
      isCoord = b;
    },
    resolveNav: () => {
      navResolvers.shift()?.resolve();
    },
    rejectNav: () => {
      navResolvers.shift()?.reject();
    }
  };
}

function activeView(opts: {
  isCoord?: boolean;
  broadcast?: { ts: number; stagePath: string };
}): SessionView {
  return {
    status: 'active',
    peerId: 'me',
    filteredShared: {
      coordinator: opts.isCoord ? 'me' : 'other',
      broadcastView: opts.broadcast ?? null,
      peers: {},
      synthesizedPcs: {}
    }
  } as unknown as SessionView;
}

describe('BroadcastFollowingController — basic follow', () => {
  it('non-coord viewer with a newer broadcast navigates', async () => {
    const { host } = makeHost();
    const h = makeEnv({ isCoord: false });
    h.setView(
      activeView({
        broadcast: { ts: 100, stagePath: '?campaign=x/y&ep=e&scene=s' }
      })
    );
    const c = new BroadcastFollowingController(host, h.env);
    c.hostUpdated();
    expect(h.navCalls).toHaveLength(1);
    // Cursor only advances after navigation resolves.
    expect(c._cursorForTest()).toBe(0);
    h.resolveNav();
    await Promise.resolve();
    expect(c._cursorForTest()).toBe(100);
  });

  it('DM (coord) does not self-bounce; cursor still advances', () => {
    const { host } = makeHost();
    const h = makeEnv({ isCoord: true });
    h.setView(
      activeView({
        isCoord: true,
        broadcast: { ts: 100, stagePath: '?campaign=x/y' }
      })
    );
    const c = new BroadcastFollowingController(host, h.env);
    c.hostUpdated();
    expect(h.navCalls).toHaveLength(0);
    expect(c._cursorForTest()).toBe(100); // advanced for future dispatch
  });

  it('no-op when no broadcast exists', () => {
    const { host } = makeHost();
    const h = makeEnv();
    h.setView(activeView({}));
    const c = new BroadcastFollowingController(host, h.env);
    c.hostUpdated();
    expect(h.navCalls).toHaveLength(0);
    expect(c._cursorForTest()).toBe(0);
  });

  it('no-op when broadcast ts is not newer than cursor', async () => {
    const { host } = makeHost();
    const h = makeEnv();
    h.setView(
      activeView({ broadcast: { ts: 100, stagePath: '?campaign=x/y' } })
    );
    const c = new BroadcastFollowingController(host, h.env);
    c.hostUpdated();
    h.resolveNav();
    await Promise.resolve();
    expect(c._cursorForTest()).toBe(100);
    h.navCalls.length = 0;
    // Same ts — should not re-navigate.
    c.hostUpdated();
    expect(h.navCalls).toHaveLength(0);
  });

  it('malformed stagePath: advance cursor without navigating', () => {
    const { host } = makeHost();
    const h = makeEnv({ parseTo: { kind: 'home' } });
    h.setView(
      activeView({ broadcast: { ts: 50, stagePath: 'garbage' } })
    );
    const c = new BroadcastFollowingController(host, h.env);
    c.hostUpdated();
    expect(h.navCalls).toHaveLength(0);
    // Cursor advanced so retry isn't wedged on the poisoned event.
    expect(c._cursorForTest()).toBe(50);
  });
});

describe('BroadcastFollowingController — retry on nav rejection', () => {
  it('does NOT advance cursor when navigation rejects (allows DM re-broadcast retry)', async () => {
    const { host } = makeHost();
    const h = makeEnv();
    h.setView(
      activeView({ broadcast: { ts: 100, stagePath: '?campaign=x/y' } })
    );
    const c = new BroadcastFollowingController(host, h.env);
    c.hostUpdated();
    h.rejectNav();
    await Promise.resolve();
    expect(c._cursorForTest()).toBe(0); // still at 0
    expect(c._inFlightForTest()).toBe(false); // gate cleared
    // Re-tick: should re-attempt.
    c.hostUpdated();
    expect(h.navCalls).toHaveLength(2);
  });
});

describe('BroadcastFollowingController — inFlight guard', () => {
  /**
   * New concurrency guard (extraction-time improvement): pre-fix,
   * the inline followBroadcast could fire concurrent navigations
   * if a newer broadcast arrived while the prior was pending.
   * The controller suppresses overlapping nav calls.
   */
  it('suppresses concurrent navigations while one is in flight', () => {
    const { host } = makeHost();
    const h = makeEnv();
    h.setView(
      activeView({ broadcast: { ts: 100, stagePath: '?campaign=x/y' } })
    );
    const c = new BroadcastFollowingController(host, h.env);
    c.hostUpdated();
    expect(h.navCalls).toHaveLength(1);
    expect(c._inFlightForTest()).toBe(true);
    // Newer broadcast arrives mid-flight.
    h.setView(
      activeView({ broadcast: { ts: 200, stagePath: '?campaign=z' } })
    );
    c.hostUpdated();
    // No second navigation — the prior is still in flight.
    expect(h.navCalls).toHaveLength(1);
  });

  it('re-evaluates after the prior navigation settles', async () => {
    const { host } = makeHost();
    const h = makeEnv();
    h.setView(
      activeView({ broadcast: { ts: 100, stagePath: '?campaign=x/y' } })
    );
    const c = new BroadcastFollowingController(host, h.env);
    c.hostUpdated();
    h.setView(
      activeView({ broadcast: { ts: 200, stagePath: '?campaign=z' } })
    );
    c.hostUpdated();
    expect(h.navCalls).toHaveLength(1);
    // First nav resolves.
    h.resolveNav();
    await Promise.resolve();
    expect(c._inFlightForTest()).toBe(false);
    expect(c._cursorForTest()).toBe(100);
    // Re-tick: cursor=100 < new ts=200, so a second nav fires.
    c.hostUpdated();
    expect(h.navCalls).toHaveLength(2);
  });
});

describe('BroadcastFollowingController — co-DM concurrent broadcast (motivating scenario)', () => {
  /**
   * The inFlight guard exists for this case: two co-DMs (Maria
   * + Sam, both in coordHolders) broadcast near-simultaneously.
   * Maria's ts=100 lands first; Sam's ts=101 arrives mid-nav.
   * Without the guard, both navigations would fire concurrently
   * — destination flicker / race condition.  With the guard,
   * the 101 dispatch is deferred until 100 settles.
   */
  it('serializes co-DM broadcasts that arrive interleaved', async () => {
    const { host } = makeHost();
    const h = makeEnv();
    h.setView(
      activeView({ broadcast: { ts: 100, stagePath: '?campaign=x/y' } })
    );
    const c = new BroadcastFollowingController(host, h.env);
    c.hostUpdated();
    expect(h.navCalls).toHaveLength(1);
    // Co-DM Sam broadcasts ts=101 mid-flight.
    h.setView(
      activeView({ broadcast: { ts: 101, stagePath: '?campaign=z/w' } })
    );
    c.hostUpdated();
    // Guard holds — no second nav yet.
    expect(h.navCalls).toHaveLength(1);
    // Maria's nav settles → cursor=100.
    h.resolveNav();
    await Promise.resolve();
    expect(c._cursorForTest()).toBe(100);
    // The controller's own requestUpdate (added in step-3 fix)
    // triggers another hostUpdated; Sam's 101 > 100 dispatches.
    c.hostUpdated();
    expect(h.navCalls).toHaveLength(2);
  });
});

describe('BroadcastFollowingController — no session', () => {
  it('no-op when no active session', () => {
    const { host } = makeHost();
    const h = makeEnv();
    h.setView(null);
    const c = new BroadcastFollowingController(host, h.env);
    c.hostUpdated();
    expect(h.navCalls).toHaveLength(0);
  });
});

describe('BroadcastFollowingController — hostDisconnected', () => {
  it('resets cursor + inFlight on unmount', async () => {
    const { host } = makeHost();
    const h = makeEnv();
    h.setView(
      activeView({ broadcast: { ts: 100, stagePath: '?campaign=x/y' } })
    );
    const c = new BroadcastFollowingController(host, h.env);
    c.hostUpdated();
    h.resolveNav();
    await Promise.resolve();
    expect(c._cursorForTest()).toBe(100);
    c.hostDisconnected();
    expect(c._cursorForTest()).toBe(0);
    expect(c._inFlightForTest()).toBe(false);
  });
});

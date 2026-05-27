// @vitest-environment node

/**
 * E-LARGE-1 step 2 tests for ReclaimController.  Focus areas:
 *   - Voluntary path: pc-retire emits BEFORE coordinator-yield
 *     (load-bearing ordering invariant).
 *   - Reactive path: coord→non-coord edge opens the prompt; the
 *     voluntary path's skip flag suppresses the next reactive
 *     auto-open.
 *   - Bail behavior: rejected pc-retire keeps the prompt open +
 *     surfaces the bail error.
 *   - Sideline + Keep paths.
 *   - Reactive-path cancel == Keep semantics (no events fire).
 */

import { describe, it, expect } from 'vitest';
import { ReclaimController, type ReclaimEnv } from './reclaim-controller';
import type { ReactiveControllerHost } from 'lit';
import type { SessionView } from '../session-controller';

/**
 * Minimal Lit-host stub.  We only need `addController` (the
 * controller registers itself in the constructor) and
 * `requestUpdate` (the controller calls it after every mutation).
 */
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

/**
 * Spy env: records every action call in order so tests can
 * assert the pc-retire-before-yield invariant.  Captures bail
 * errors + the sessionView read so tests can flip it mid-test.
 */
function makeEnv(initial: {
  view: SessionView | null;
  pcName?: (pcId: string) => string;
  retireAccepted?: boolean;
}) {
  let view = initial.view;
  const actions: string[] = [];
  const errors: string[] = [];
  const env: ReclaimEnv = {
    getSessionView: () => view,
    getPcName: initial.pcName ?? ((pcId: string) => `PC-${pcId}`),
    retirePc: (payload) => {
      actions.push(`retire:${payload.pcId}:${payload.inFictionReason}`);
      return initial.retireAccepted ?? true;
    },
    sidelinePc: () => {
      actions.push('sideline');
    },
    yieldCoordinator: () => {
      actions.push('yield');
    },
    setBailError: (msg) => {
      errors.push(msg);
    }
  };
  return {
    env,
    actions,
    errors,
    setView: (v: SessionView | null) => {
      view = v;
    }
  };
}

function activeView(opts: {
  peerId: string;
  coordinator: string;
  pcId?: string;
  pcs?: Record<string, { name: string }>;
}): SessionView {
  return {
    status: 'active',
    peerId: opts.peerId,
    filteredShared: {
      coordinator: opts.coordinator,
      peers: {
        [opts.peerId]: opts.pcId ? { pcId: opts.pcId } : {}
      },
      synthesizedPcs: opts.pcs ?? {}
    }
  } as unknown as SessionView;
}

describe('ReclaimController — reclaim affordance', () => {
  it('showReclaimConfirm + hideReclaimConfirm toggle the flag', () => {
    const { host, updateCount } = makeHost();
    const { env } = makeEnv({ view: null });
    const c = new ReclaimController(host, env);
    expect(c.reclaimConfirmShown).toBe(false);
    c.showReclaimConfirm();
    expect(c.reclaimConfirmShown).toBe(true);
    expect(updateCount()).toBe(1);
    c.hideReclaimConfirm();
    expect(c.reclaimConfirmShown).toBe(false);
    expect(updateCount()).toBe(2);
  });
});

describe('ReclaimController — openYieldPrompt (voluntary)', () => {
  it('no-ops when not coord', () => {
    const { host } = makeHost();
    const { env } = makeEnv({
      view: activeView({ peerId: 'me', coordinator: 'other' })
    });
    const c = new ReclaimController(host, env);
    c.openYieldPrompt();
    expect(c.yieldPcFatePrompt).toBeNull();
  });

  it('opens picker-less prompt when DM has no bound PC', () => {
    const { host } = makeHost();
    const { env } = makeEnv({
      view: activeView({ peerId: 'me', coordinator: 'me' })
    });
    const c = new ReclaimController(host, env);
    c.openYieldPrompt();
    expect(c.yieldPcFatePrompt).toEqual({
      pcId: '',
      pcName: '',
      voluntary: true,
      fate: 'keep',
      retireReason: ''
    });
  });

  it('opens 3-radio prompt when DM has a bound PC', () => {
    const { host } = makeHost();
    const { env } = makeEnv({
      view: activeView({
        peerId: 'me',
        coordinator: 'me',
        pcId: 'pc1',
        pcs: { pc1: { name: 'Mei' } }
      }),
      pcName: (id) => (id === 'pc1' ? 'Mei' : id)
    });
    const c = new ReclaimController(host, env);
    c.openYieldPrompt();
    expect(c.yieldPcFatePrompt).toEqual({
      pcId: 'pc1',
      pcName: 'Mei',
      voluntary: true,
      fate: 'keep',
      retireReason: ''
    });
  });
});

describe('ReclaimController — submitYieldPcFatePrompt', () => {
  it('voluntary + Keep: emits coord-yield only (no PC event)', () => {
    const { host } = makeHost();
    const { env, actions } = makeEnv({
      view: activeView({
        peerId: 'me',
        coordinator: 'me',
        pcId: 'pc1',
        pcs: { pc1: { name: 'Mei' } }
      })
    });
    const c = new ReclaimController(host, env);
    c.openYieldPrompt();
    expect(c.submitYieldPcFatePrompt()).toBe(true);
    expect(actions).toEqual(['yield']);
    expect(c.yieldPcFatePrompt).toBeNull();
  });

  it('voluntary + Sideline: emits sideline then coord-yield', () => {
    const { host } = makeHost();
    const { env, actions } = makeEnv({
      view: activeView({
        peerId: 'me',
        coordinator: 'me',
        pcId: 'pc1',
        pcs: { pc1: { name: 'Mei' } }
      })
    });
    const c = new ReclaimController(host, env);
    c.openYieldPrompt();
    c.setYieldPcFate('sideline');
    expect(c.submitYieldPcFatePrompt()).toBe(true);
    expect(actions).toEqual(['sideline', 'yield']);
  });

  /**
   * Load-bearing ordering invariant: pc-retire MUST emit before
   * coordinator-yield on the voluntary path.  Future validator
   * tightening could reject a post-yield retire; the documented
   * order keeps us forward-compatible.
   */
  it('voluntary + Retire: emits retire BEFORE coord-yield', () => {
    const { host } = makeHost();
    const { env, actions } = makeEnv({
      view: activeView({
        peerId: 'me',
        coordinator: 'me',
        pcId: 'pc1',
        pcs: { pc1: { name: 'Mei' } }
      })
    });
    const c = new ReclaimController(host, env);
    c.openYieldPrompt();
    c.setYieldPcFate('retire');
    c.setYieldRetireReason('She stepped back to care for her sister.');
    expect(c.submitYieldPcFatePrompt()).toBe(true);
    expect(actions).toEqual([
      'retire:pc1:She stepped back to care for her sister.',
      'yield'
    ]);
  });

  it('Retire requires a non-empty reason', () => {
    const { host } = makeHost();
    const { env, actions } = makeEnv({
      view: activeView({
        peerId: 'me',
        coordinator: 'me',
        pcId: 'pc1',
        pcs: { pc1: { name: 'Mei' } }
      })
    });
    const c = new ReclaimController(host, env);
    c.openYieldPrompt();
    c.setYieldPcFate('retire');
    // Empty reason rejected.
    expect(c.submitYieldPcFatePrompt()).toBe(false);
    expect(actions).toEqual([]);
    expect(c.yieldPcFatePrompt).not.toBeNull(); // modal stays open
  });

  /**
   * Pre-extraction behavior preserved: reason.length > 200 returns
   * false without setting a bail error.  The UI input has
   * maxlength=200 so this branch is normally unreachable, but
   * programmatic setters (paste edge cases, future AI write) can
   * still hit it.  Pin the current silent-reject behavior so
   * future intentional change is visible in the diff.
   */
  it('Retire rejects reason > 200 chars (silent, preservation-correct)', () => {
    const { host } = makeHost();
    const { env, actions, errors } = makeEnv({
      view: activeView({
        peerId: 'me',
        coordinator: 'me',
        pcId: 'pc1',
        pcs: { pc1: { name: 'Mei' } }
      })
    });
    const c = new ReclaimController(host, env);
    c.openYieldPrompt();
    c.setYieldPcFate('retire');
    c.setYieldRetireReason('x'.repeat(201));
    expect(c.submitYieldPcFatePrompt()).toBe(false);
    expect(actions).toEqual([]); // no retire, no yield
    expect(errors).toEqual([]); // silent — matches pre-extraction
    expect(c.yieldPcFatePrompt).not.toBeNull(); // modal stays open
  });

  /**
   * Coverage gap pinned: after an engine-rejected retire, the
   * controller MUST leave `skipNextReactiveYield=false` so a
   * later legit reactive auto-open (caused by a real coord-loss
   * to another peer) still fires.  If a future refactor sets the
   * skip flag too eagerly, this test breaks.
   */
  it('Bail path does not consume the reactive skip flag', () => {
    const { host } = makeHost();
    const state = makeEnv({
      view: activeView({
        peerId: 'me',
        coordinator: 'me',
        pcId: 'pc1',
        pcs: { pc1: { name: 'Mei' } }
      }),
      retireAccepted: false
    });
    const c = new ReclaimController(host, state.env);
    // Establish prev=coord.
    c.hostUpdated();
    c.openYieldPrompt();
    c.setYieldPcFate('retire');
    c.setYieldRetireReason('test');
    expect(c.submitYieldPcFatePrompt()).toBe(false);
    // Maria abandons the bail + Lisa reclaims; the reactive
    // auto-open must still fire (no skip flag set).
    c.dismissYieldPcFatePrompt();
    state.setView(
      activeView({ peerId: 'me', coordinator: 'lisa', pcId: 'pc1' })
    );
    c.hostUpdated();
    expect(c.yieldPcFatePrompt).not.toBeNull();
    expect(c.yieldPcFatePrompt?.voluntary).toBe(false);
  });

  it('Retire bails when the engine rejects pc-retire (SHOULD-FIX-3)', () => {
    const { host } = makeHost();
    const { env, actions, errors } = makeEnv({
      view: activeView({
        peerId: 'me',
        coordinator: 'me',
        pcId: 'pc1',
        pcs: { pc1: { name: 'Mei' } }
      }),
      retireAccepted: false
    });
    const c = new ReclaimController(host, env);
    c.openYieldPrompt();
    c.setYieldPcFate('retire');
    c.setYieldRetireReason('test');
    expect(c.submitYieldPcFatePrompt()).toBe(false);
    expect(actions).toEqual(['retire:pc1:test']); // no yield
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/not accepted by the engine/i);
    expect(c.yieldPcFatePrompt).not.toBeNull(); // stays open
  });

  it('reactive path (voluntary=false): no yield event fires', () => {
    const { host } = makeHost();
    const { env, actions } = makeEnv({
      view: activeView({
        peerId: 'me',
        coordinator: 'other', // already lost coord
        pcId: 'pc1',
        pcs: { pc1: { name: 'Mei' } }
      })
    });
    const c = new ReclaimController(host, env);
    // Simulate the reactive open (hostUpdated path would do this).
    c.yieldPcFatePrompt = {
      pcId: 'pc1',
      pcName: 'Mei',
      voluntary: false,
      fate: 'retire',
      retireReason: 'left town'
    };
    expect(c.submitYieldPcFatePrompt()).toBe(true);
    // pc-retire fires (sticky-coord allows it) but NO yield.
    expect(actions).toEqual(['retire:pc1:left town']);
  });
});

describe('ReclaimController — dismissYieldPcFatePrompt', () => {
  it('reactive-cancel == Keep semantics (no events emitted)', () => {
    const { host } = makeHost();
    const { env, actions } = makeEnv({
      view: activeView({
        peerId: 'me',
        coordinator: 'other',
        pcId: 'pc1'
      })
    });
    const c = new ReclaimController(host, env);
    c.yieldPcFatePrompt = {
      pcId: 'pc1',
      pcName: 'Mei',
      voluntary: false,
      fate: 'retire',
      retireReason: 'changed mind'
    };
    c.dismissYieldPcFatePrompt();
    expect(c.yieldPcFatePrompt).toBeNull();
    // No events — Keep is the implicit no-op.
    expect(actions).toEqual([]);
  });
});

describe('ReclaimController — hostUpdated reactive detection', () => {
  it('coord→non-coord with bound PC opens the reactive prompt', () => {
    const { host } = makeHost();
    const state = makeEnv({
      view: activeView({ peerId: 'me', coordinator: 'me', pcId: 'pc1' }),
      pcName: () => 'Mei'
    });
    const c = new ReclaimController(host, state.env);
    // Tick once with view=coord to establish prev=coord.
    c.hostUpdated();
    expect(c.yieldPcFatePrompt).toBeNull();
    // Now flip to non-coord + tick again.
    state.setView(
      activeView({ peerId: 'me', coordinator: 'other', pcId: 'pc1' })
    );
    c.hostUpdated();
    expect(c.yieldPcFatePrompt).not.toBeNull();
    expect(c.yieldPcFatePrompt?.voluntary).toBe(false);
    expect(c.yieldPcFatePrompt?.pcId).toBe('pc1');
    expect(c.yieldPcFatePrompt?.fate).toBe('keep');
  });

  it('voluntary submit suppresses the next reactive auto-open', () => {
    const { host } = makeHost();
    const state = makeEnv({
      view: activeView({ peerId: 'me', coordinator: 'me', pcId: 'pc1' }),
      pcName: () => 'Mei'
    });
    const c = new ReclaimController(host, state.env);
    // Establish prev=coord.
    c.hostUpdated();
    // Voluntary submit.
    c.openYieldPrompt();
    expect(c.submitYieldPcFatePrompt()).toBe(true);
    // Now flip the view to non-coord (the resulting coord-yield
    // event would do this in production) and tick.
    state.setView(
      activeView({ peerId: 'me', coordinator: 'other', pcId: 'pc1' })
    );
    c.hostUpdated();
    // Skip flag swallowed the reactive open.
    expect(c.yieldPcFatePrompt).toBeNull();
  });

  it('does not re-open when a prompt is already open', () => {
    const { host } = makeHost();
    const state = makeEnv({
      view: activeView({ peerId: 'me', coordinator: 'me', pcId: 'pc1' }),
      pcName: () => 'Mei'
    });
    const c = new ReclaimController(host, state.env);
    c.hostUpdated();
    c.openYieldPrompt(); // voluntary modal up
    const before = c.yieldPcFatePrompt;
    // Flip to non-coord.
    state.setView(
      activeView({ peerId: 'me', coordinator: 'other', pcId: 'pc1' })
    );
    c.hostUpdated();
    // Voluntary modal still intact (skipNextReactiveYield is
    // already true from the voluntary path — but even without
    // it, the "already open" gate would protect us).
    expect(c.yieldPcFatePrompt).toBe(before);
  });

  it('non-coord with no bound PC does not open a prompt', () => {
    const { host } = makeHost();
    const state = makeEnv({
      view: activeView({ peerId: 'me', coordinator: 'me' }) // no pcId
    });
    const c = new ReclaimController(host, state.env);
    c.hostUpdated();
    state.setView(activeView({ peerId: 'me', coordinator: 'other' }));
    c.hostUpdated();
    expect(c.yieldPcFatePrompt).toBeNull();
  });

  it('initial coord state does not auto-open (no prev transition)', () => {
    // First tick: prev='no-session', new='coord'.  Even though the
    // peer has a bound PC, the prompt must NOT open — we only open
    // on the coord→non-coord edge.
    const { host } = makeHost();
    const { env } = makeEnv({
      view: activeView({ peerId: 'me', coordinator: 'me', pcId: 'pc1' })
    });
    const c = new ReclaimController(host, env);
    c.hostUpdated();
    expect(c.yieldPcFatePrompt).toBeNull();
  });
});

describe('ReclaimController — hostDisconnected', () => {
  it('drops all state on unmount', () => {
    const { host } = makeHost();
    const { env } = makeEnv({
      view: activeView({ peerId: 'me', coordinator: 'me', pcId: 'pc1' })
    });
    const c = new ReclaimController(host, env);
    c.showReclaimConfirm();
    c.openYieldPrompt();
    c.hostDisconnected();
    expect(c.reclaimConfirmShown).toBe(false);
    expect(c.yieldPcFatePrompt).toBeNull();
  });
});

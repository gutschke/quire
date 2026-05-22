/**
 * AiWriteController tests (M3c.3).
 *
 * Owns: batch staging, hard-gate detection, apply-all + per-update
 * apply, revert during undo window, undo-timer expiry, host
 * requestUpdate plumbing.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi
} from 'vitest';
import {
  AiWriteController,
  UNDO_WINDOW_MS,
  type AiWriteHost
} from './ai-write-controller';
import type { StateUpdate } from '../ai/schema';
import type { SessionView } from '../session-controller';

/** Minimal ReactiveControllerHost — counts requestUpdate calls. */
function makeHost() {
  let updates = 0;
  return {
    host: {
      addController: vi.fn(),
      removeController: vi.fn(),
      requestUpdate: () => {
        updates++;
      },
      updateComplete: Promise.resolve(true)
    } as never,
    updateCount: () => updates
  };
}

/** Minimal SessionController stub — records every append. */
function makeSession() {
  const appended: Array<{ kind: string; payload: unknown }> = [];
  return {
    appended,
    session: {
      append: vi.fn((kind: string, payload: unknown) => {
        appended.push({ kind, payload });
      })
    }
  };
}

/** Build an env with the given session-view + bound PC + session. */
function makeEnv(
  view: SessionView | undefined,
  boundPcId: string | undefined,
  session: ReturnType<typeof makeSession>['session'] | null
): AiWriteHost {
  return {
    getSessionView: () => view,
    getSession: () => session as never,
    getBoundPcId: () => boundPcId
  };
}

/** Fake active SessionView with the given pcEdits + casterState + peers. */
function fakeView(
  opts: {
    pcEdits?: Record<string, { harm?: number; stress?: number }>;
    casterState?: Record<string, { taxActive: boolean }>;
    peers?: Record<
      string,
      { peerId: string; pcId?: string; leftAt?: number; joinedAt?: number }
    >;
  } = {}
): SessionView {
  return {
    status: 'active',
    mode: 'host',
    peerId: 'dm',
    shared: {
      coordinator: 'dm',
      pcEdits: opts.pcEdits ?? {},
      casterState: opts.casterState ?? {},
      peers: opts.peers ?? {
        dm: { peerId: 'dm', joinedAt: 1 }
      }
    } as never,
    filteredShared: {} as never
  } as never;
}

describe('AiWriteController — proposeBatch', () => {
  it('stamps each update with an id, marks safe ones pending', () => {
    const { host } = makeHost();
    const { session } = makeSession();
    const ctrl = new AiWriteController(host, makeEnv(fakeView(), 'yui', session));
    const updates: StateUpdate[] = [
      { kind: 'pc-edit', pcId: 'yui', field: 'harm', delta: 1 },
      { kind: 'dice-roll', purpose: 'climb', expression: '2d6+1' }
    ];
    ctrl.proposeBatch(updates, 'resp-1');
    expect(ctrl.currentBatch.length).toBe(2);
    for (const u of ctrl.currentBatch) {
      expect(u.status).toBe('pending');
      expect(u.causedByResponseId).toBe('resp-1');
      expect(u.id).toMatch(/^u\d+$/);
      expect(u.hardGateReason).toBe('');
    }
  });

  it('marks hard-gated entries as hard-gate-pending', () => {
    const { host } = makeHost();
    const { session } = makeSession();
    const ctrl = new AiWriteController(
      host,
      makeEnv(fakeView({ pcEdits: { yui: { harm: 2 } } }), 'yui', session)
    );
    ctrl.proposeBatch(
      [{ kind: 'pc-edit', pcId: 'yui', field: 'harm', delta: 1 }],
      'r1'
    );
    const [u] = ctrl.currentBatch;
    expect(u.status).toBe('hard-gate-pending');
    expect(u.hardGateReason).toMatch(/box 3/);
  });

  it('replacing the batch clears prior pending entries', () => {
    const { host } = makeHost();
    const { session } = makeSession();
    const ctrl = new AiWriteController(host, makeEnv(fakeView(), 'yui', session));
    ctrl.proposeBatch(
      [{ kind: 'pc-edit', pcId: 'yui', field: 'harm', delta: 1 }],
      'r1'
    );
    ctrl.proposeBatch(
      [{ kind: 'pc-edit', pcId: 'yui', field: 'stress', delta: 1 }],
      'r2'
    );
    expect(ctrl.currentBatch.length).toBe(1);
    expect(ctrl.currentBatch[0].update).toMatchObject({ field: 'stress' });
    expect(ctrl.currentBatch[0].causedByResponseId).toBe('r2');
  });
});

describe('AiWriteController — hardGateReason policy', () => {
  it('harm transitioning to box 3 OR 4 is hard-gated', () => {
    const { host } = makeHost();
    const { session } = makeSession();
    const ctrl = new AiWriteController(
      host,
      makeEnv(fakeView({ pcEdits: { yui: { harm: 2 } } }), 'yui', session)
    );
    expect(
      ctrl.hardGateReason(
        { kind: 'pc-edit', pcId: 'yui', field: 'harm', delta: 1 },
        fakeView({ pcEdits: { yui: { harm: 2 } } })
      )
    ).toMatch(/box 3/);
    expect(
      ctrl.hardGateReason(
        { kind: 'pc-edit', pcId: 'yui', field: 'harm', delta: 2 },
        fakeView({ pcEdits: { yui: { harm: 2 } } })
      )
    ).toMatch(/box 4/);
  });

  it('harm transitioning to box 1 or 2 is NOT gated', () => {
    const { host } = makeHost();
    const { session } = makeSession();
    const ctrl = new AiWriteController(host, makeEnv(fakeView(), 'yui', session));
    expect(
      ctrl.hardGateReason(
        { kind: 'pc-edit', pcId: 'yui', field: 'harm', delta: 1 },
        fakeView()
      )
    ).toBe('');
  });

  it('stress transitioning to box 4 is hard-gated', () => {
    const { host } = makeHost();
    const { session } = makeSession();
    const ctrl = new AiWriteController(
      host,
      makeEnv(fakeView({ pcEdits: { yui: { stress: 3 } } }), 'yui', session)
    );
    expect(
      ctrl.hardGateReason(
        { kind: 'pc-edit', pcId: 'yui', field: 'stress', delta: 1 },
        fakeView({ pcEdits: { yui: { stress: 3 } } })
      )
    ).toMatch(/Broken/);
  });

  it('cross-PC pc-edit is hard-gated (target bound by another peer)', () => {
    const { host } = makeHost();
    const { session } = makeSession();
    const view = fakeView({
      peers: {
        dm: { peerId: 'dm', joinedAt: 1 },
        guest: { peerId: 'guest', pcId: 'bob', joinedAt: 2 }
      }
    });
    const ctrl = new AiWriteController(host, makeEnv(view, 'yui', session));
    expect(
      ctrl.hardGateReason(
        { kind: 'pc-edit', pcId: 'bob', field: 'harm', delta: 1 },
        view
      )
    ).toMatch(/Cross-PC/);
  });

  it('caster-state-set ladderState=hunted is hard-gated', () => {
    const { host } = makeHost();
    const { session } = makeSession();
    const ctrl = new AiWriteController(host, makeEnv(fakeView(), 'yui', session));
    expect(
      ctrl.hardGateReason(
        { kind: 'caster-state-set', pcId: 'yui', ladderState: 'hunted' },
        fakeView()
      )
    ).toMatch(/Hunted/);
  });

  it('caster-state-set tax-activation + tax-release are hard-gated', () => {
    const { host } = makeHost();
    const { session } = makeSession();
    const ctrl = new AiWriteController(host, makeEnv(fakeView(), 'yui', session));
    expect(
      ctrl.hardGateReason(
        {
          kind: 'caster-state-set',
          pcId: 'yui',
          ladderState: 'quiet',
          taxActive: true
        },
        fakeView({ casterState: { yui: { taxActive: false } } })
      )
    ).toMatch(/activating/);
    expect(
      ctrl.hardGateReason(
        {
          kind: 'caster-state-set',
          pcId: 'yui',
          ladderState: 'quiet',
          taxActive: false
        },
        fakeView({ casterState: { yui: { taxActive: true } } })
      )
    ).toMatch(/releasing/);
  });

  it('caster-state-set with unchanged taxActive is NOT gated', () => {
    const { host } = makeHost();
    const { session } = makeSession();
    const ctrl = new AiWriteController(host, makeEnv(fakeView(), 'yui', session));
    expect(
      ctrl.hardGateReason(
        {
          kind: 'caster-state-set',
          pcId: 'yui',
          ladderState: 'quiet',
          taxActive: false
        },
        fakeView()
      )
    ).toBe('');
  });
});

describe('AiWriteController — applyAll', () => {
  it('applies every non-gated entry; gated entries stay pending', () => {
    const { host } = makeHost();
    const { session, appended } = makeSession();
    const ctrl = new AiWriteController(
      host,
      makeEnv(fakeView({ pcEdits: { yui: { harm: 2 } } }), 'yui', session)
    );
    ctrl.proposeBatch(
      [
        // non-gated
        { kind: 'pc-edit', pcId: 'yui', field: 'stress', delta: 1 },
        // hard-gated (harm → 3)
        { kind: 'pc-edit', pcId: 'yui', field: 'harm', delta: 1 }
      ],
      'r1'
    );
    ctrl.applyAll();
    expect(appended.length).toBe(1);
    expect(appended[0].kind).toBe('pc-edit');
    expect((appended[0].payload as { field: string }).field).toBe('stress');
    expect(ctrl.currentBatch[0].status).toBe('applied');
    expect(ctrl.currentBatch[1].status).toBe('hard-gate-pending');
  });

  it('no-op when batch is empty or all already applied', () => {
    const { host } = makeHost();
    const { session, appended } = makeSession();
    const ctrl = new AiWriteController(host, makeEnv(fakeView(), 'yui', session));
    ctrl.applyAll();
    expect(appended.length).toBe(0);
  });

  it('applyOne lands a single hard-gated entry', () => {
    const { host } = makeHost();
    const { session, appended } = makeSession();
    const ctrl = new AiWriteController(
      host,
      makeEnv(fakeView({ pcEdits: { yui: { harm: 2 } } }), 'yui', session)
    );
    ctrl.proposeBatch(
      [{ kind: 'pc-edit', pcId: 'yui', field: 'harm', delta: 1 }],
      'r1'
    );
    const id = ctrl.currentBatch[0].id;
    ctrl.applyOne(id);
    expect(appended.length).toBe(1);
    expect(ctrl.currentBatch[0].status).toBe('applied');
  });

  it('stamps causedByResponseId on every applied event', () => {
    const { host } = makeHost();
    const { session, appended } = makeSession();
    const ctrl = new AiWriteController(host, makeEnv(fakeView(), 'yui', session));
    ctrl.proposeBatch(
      [{ kind: 'pc-edit', pcId: 'yui', field: 'stress', delta: 1 }],
      'resp-xyz'
    );
    ctrl.applyAll();
    expect(
      (appended[0].payload as { causedByResponseId?: string }).causedByResponseId
    ).toBe('resp-xyz');
  });
});

describe('AiWriteController — undo', () => {
  // Use Date.now spying instead of vi.useFakeTimers to avoid
  // happy-dom's internal-timer deadlock that surfaced with the
  // controller's own setTimeout.
  let realNow: () => number;
  let mockedTime = 1_000_000_000_000;
  beforeEach(() => {
    realNow = Date.now;
    mockedTime = 1_000_000_000_000;
    Date.now = () => mockedTime;
  });
  afterEach(() => {
    Date.now = realNow;
  });

  it('starts a 60s undo window after applyAll', () => {
    const { host } = makeHost();
    const { session } = makeSession();
    const ctrl = new AiWriteController(host, makeEnv(fakeView(), 'yui', session));
    ctrl.proposeBatch(
      [{ kind: 'pc-edit', pcId: 'yui', field: 'stress', delta: 1 }],
      'r1'
    );
    ctrl.applyAll();
    expect(ctrl.undoSecondsRemaining).toBe(60);
  });

  it('undoSecondsRemaining decays as time advances and hits 0 past window', () => {
    const { host } = makeHost();
    const { session } = makeSession();
    const ctrl = new AiWriteController(host, makeEnv(fakeView(), 'yui', session));
    ctrl.proposeBatch(
      [{ kind: 'pc-edit', pcId: 'yui', field: 'stress', delta: 1 }],
      'r1'
    );
    ctrl.applyAll();
    mockedTime += 30_000;
    expect(ctrl.undoSecondsRemaining).toBe(30);
    mockedTime += UNDO_WINDOW_MS;
    expect(ctrl.undoSecondsRemaining).toBe(0);
  });

  it('revertOne during the window emits a compensating event', () => {
    const { host } = makeHost();
    const { session, appended } = makeSession();
    const ctrl = new AiWriteController(
      host,
      makeEnv(fakeView({ pcEdits: { yui: { stress: 0 } } }), 'yui', session)
    );
    ctrl.proposeBatch(
      [{ kind: 'pc-edit', pcId: 'yui', field: 'stress', delta: 1 }],
      'r1'
    );
    ctrl.applyAll();
    expect(appended.length).toBe(1);
    ctrl.revertOne(ctrl.currentBatch[0].id);
    expect(appended.length).toBe(2);
    expect(ctrl.currentBatch[0].status).toBe('reverted');
    expect(
      (appended[1].payload as { causedByResponseId?: string })
        .causedByResponseId
    ).toBe('');
  });

  it('revertOne outside the window is a no-op', () => {
    const { host } = makeHost();
    const { session, appended } = makeSession();
    const ctrl = new AiWriteController(host, makeEnv(fakeView(), 'yui', session));
    ctrl.proposeBatch(
      [{ kind: 'pc-edit', pcId: 'yui', field: 'stress', delta: 1 }],
      'r1'
    );
    ctrl.applyAll();
    mockedTime += UNDO_WINDOW_MS + 1000;
    ctrl.revertOne(ctrl.currentBatch[0].id);
    expect(appended.length).toBe(1);
    expect(ctrl.currentBatch[0].status).toBe('applied');
  });

  it('proposeBatch clears the prior undo window', () => {
    const { host } = makeHost();
    const { session } = makeSession();
    const ctrl = new AiWriteController(host, makeEnv(fakeView(), 'yui', session));
    ctrl.proposeBatch(
      [{ kind: 'pc-edit', pcId: 'yui', field: 'stress', delta: 1 }],
      'r1'
    );
    ctrl.applyAll();
    expect(ctrl.undoSecondsRemaining).toBeGreaterThan(0);
    ctrl.proposeBatch(
      [{ kind: 'pc-edit', pcId: 'yui', field: 'harm', delta: 1 }],
      'r2'
    );
    expect(ctrl.undoSecondsRemaining).toBe(0);
  });
});

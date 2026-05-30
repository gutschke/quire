/**
 * fs-api-handle-store — unit tests.
 *
 * The production IndexedDB implementation is exercised in
 * browser-context Playwright tests (Piece 2 UI).  These unit
 * tests use the in-memory store + a mock handle to cover:
 *
 *   - Persistence round-trip via the abstract storage interface.
 *   - Permission lifecycle (granted / prompt / denied / revoked).
 *   - Multi-campaign independence (one handle per campaign).
 *   - Withdraw / disconnect path.
 *   - Defensive paths (handle.queryPermission throws,
 *     handle.requestPermission throws).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  inMemoryFsApiHandleStorage,
  probeWritePermission,
  requestWritePermission,
  type FsApiDirectoryHandleLike,
  type FsApiHandleRecord,
  type PermissionStateLike
} from './fs-api-handle-store';

const CAMPAIGN_A = 'owner/repo@main';
const CAMPAIGN_B = 'other/campaign@main';

function mockHandle(
  init: {
    name?: string;
    queryState?: PermissionStateLike;
    requestState?: PermissionStateLike;
    queryThrows?: boolean;
    requestThrows?: boolean;
  } = {}
): FsApiDirectoryHandleLike {
  const queryState = init.queryState ?? 'granted';
  const requestState = init.requestState ?? queryState;
  return {
    kind: 'directory',
    name: init.name ?? 'Quire',
    queryPermission: vi.fn(async () => {
      if (init.queryThrows) throw new Error('boom');
      return queryState;
    }),
    requestPermission: vi.fn(async () => {
      if (init.requestThrows) throw new Error('boom');
      return requestState;
    })
  };
}

describe('inMemoryFsApiHandleStorage — round trip', () => {
  it('read returns null for a missing record', async () => {
    const store = inMemoryFsApiHandleStorage();
    expect(await store.read(CAMPAIGN_A)).toBeNull();
  });

  it('write then read returns the same record', async () => {
    const store = inMemoryFsApiHandleStorage();
    const record: FsApiHandleRecord = {
      v: 1,
      campaignId: CAMPAIGN_A,
      handle: mockHandle({ name: 'Quire' }),
      displayName: 'Quire',
      connectedAt: 1_700_000_000,
      lastPushedAt: null,
      lastObservedModifiedMs: null
    };
    await store.write(record);
    expect(await store.read(CAMPAIGN_A)).toBe(record);
  });

  it('remove deletes the record', async () => {
    const store = inMemoryFsApiHandleStorage();
    const record: FsApiHandleRecord = {
      v: 1,
      campaignId: CAMPAIGN_A,
      handle: mockHandle(),
      displayName: 'Quire',
      connectedAt: 1_700_000_000,
      lastPushedAt: null,
      lastObservedModifiedMs: null
    };
    await store.write(record);
    await store.remove(CAMPAIGN_A);
    expect(await store.read(CAMPAIGN_A)).toBeNull();
  });

  it('remove on a missing record does not throw', async () => {
    const store = inMemoryFsApiHandleStorage();
    await expect(store.remove(CAMPAIGN_A)).resolves.toBeUndefined();
  });
});

describe('inMemoryFsApiHandleStorage — multi-campaign independence', () => {
  it('records are keyed per campaign', async () => {
    const store = inMemoryFsApiHandleStorage();
    const a: FsApiHandleRecord = {
      v: 1,
      campaignId: CAMPAIGN_A,
      handle: mockHandle({ name: 'A' }),
      displayName: 'A',
      connectedAt: 1,
      lastPushedAt: null,
      lastObservedModifiedMs: null
    };
    const b: FsApiHandleRecord = {
      v: 1,
      campaignId: CAMPAIGN_B,
      handle: mockHandle({ name: 'B' }),
      displayName: 'B',
      connectedAt: 2,
      lastPushedAt: null,
      lastObservedModifiedMs: null
    };
    await store.write(a);
    await store.write(b);
    expect(await store.read(CAMPAIGN_A)).toBe(a);
    expect(await store.read(CAMPAIGN_B)).toBe(b);
    // Multi-campaign layout (mandate): both records co-exist for
    // distinct campaigns even though they may eventually point
    // at the same folder.
    expect((await store.list()).length).toBe(2);
  });

  it('removing one campaign does not affect another', async () => {
    const store = inMemoryFsApiHandleStorage();
    const a: FsApiHandleRecord = {
      v: 1,
      campaignId: CAMPAIGN_A,
      handle: mockHandle(),
      displayName: 'A',
      connectedAt: 1,
      lastPushedAt: null,
      lastObservedModifiedMs: null
    };
    const b: FsApiHandleRecord = {
      v: 1,
      campaignId: CAMPAIGN_B,
      handle: mockHandle(),
      displayName: 'B',
      connectedAt: 2,
      lastPushedAt: null,
      lastObservedModifiedMs: null
    };
    await store.write(a);
    await store.write(b);
    await store.remove(CAMPAIGN_A);
    expect(await store.read(CAMPAIGN_A)).toBeNull();
    expect(await store.read(CAMPAIGN_B)).toBe(b);
  });
});

describe('probeWritePermission', () => {
  it('returns granted when handle reports granted', async () => {
    const handle = mockHandle({ queryState: 'granted' });
    expect(await probeWritePermission(handle)).toEqual({
      ok: true,
      state: 'granted'
    });
  });

  it('returns needs-gesture on prompt state', async () => {
    const handle = mockHandle({ queryState: 'prompt' });
    expect(await probeWritePermission(handle)).toEqual({
      ok: false,
      state: 'prompt',
      reason: 'needs-gesture'
    });
  });

  it('returns revoked on denied state', async () => {
    const handle = mockHandle({ queryState: 'denied' });
    expect(await probeWritePermission(handle)).toEqual({
      ok: false,
      state: 'denied',
      reason: 'revoked'
    });
  });

  it('treats a throwing queryPermission as prompt (defensive)', async () => {
    const handle = mockHandle({ queryThrows: true });
    const result = await probeWritePermission(handle);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe('prompt');
      expect(result.reason).toBe('needs-gesture');
    }
  });

  it('does NOT call requestPermission (no side effects)', async () => {
    const handle = mockHandle({ queryState: 'prompt' });
    await probeWritePermission(handle);
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });

  it('requests permission against the readwrite mode', async () => {
    const handle = mockHandle({ queryState: 'granted' });
    await probeWritePermission(handle);
    expect(handle.queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });
});

describe('requestWritePermission', () => {
  it('returns granted on successful request', async () => {
    const handle = mockHandle({ requestState: 'granted' });
    expect(await requestWritePermission(handle)).toEqual({
      ok: true,
      state: 'granted'
    });
  });

  it('returns needs-gesture on prompt result (user dismissed)', async () => {
    const handle = mockHandle({ requestState: 'prompt' });
    expect(await requestWritePermission(handle)).toEqual({
      ok: false,
      state: 'prompt',
      reason: 'needs-gesture'
    });
  });

  it('returns revoked on denied result', async () => {
    const handle = mockHandle({ requestState: 'denied' });
    expect(await requestWritePermission(handle)).toEqual({
      ok: false,
      state: 'denied',
      reason: 'revoked'
    });
  });

  it('a throwing requestPermission maps to denied (no-gesture context)', async () => {
    const handle = mockHandle({ requestThrows: true });
    const result = await requestWritePermission(handle);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe('denied');
      expect(result.reason).toBe('revoked');
    }
  });

  it('requests against the readwrite mode', async () => {
    const handle = mockHandle({ requestState: 'granted' });
    await requestWritePermission(handle);
    expect(handle.requestPermission).toHaveBeenCalledWith({
      mode: 'readwrite'
    });
  });
});

describe('permission lifecycle — granted → prompt → re-granted', () => {
  it('simulates the typical tab-close-reopen sequence', async () => {
    // 1. Initial pick: queryState = granted, all writes go.
    const handle = mockHandle({ queryState: 'granted' });
    expect((await probeWritePermission(handle)).ok).toBe(true);

    // 2. Tab closes; user reopens.  Permission rolls back to
    //    'prompt' on the next probe (simulated by reseating the
    //    handle's query response).
    (handle.queryPermission as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => 'prompt'
    );
    const second = await probeWritePermission(handle);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('needs-gesture');
    }

    // 3. User clicks "Reconnect folder" → requestPermission in
    //    the gesture handler returns 'granted'.
    (handle.requestPermission as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => 'granted'
    );
    const third = await requestWritePermission(handle);
    expect(third.ok).toBe(true);
  });
});

describe('permission lifecycle — user clicks Block in browser UI', () => {
  it('probe returns revoked; request returns revoked (no recovery from gesture)', async () => {
    const handle = mockHandle({ queryState: 'denied', requestState: 'denied' });
    const probe = await probeWritePermission(handle);
    expect(probe.ok).toBe(false);
    if (!probe.ok) {
      expect(probe.reason).toBe('revoked');
    }
    const req = await requestWritePermission(handle);
    expect(req.ok).toBe(false);
    if (!req.ok) {
      expect(req.reason).toBe('revoked');
    }
  });
});

// @vitest-environment node

/**
 * Cross-device probe controller — unit tests.
 *
 * Covers every branch in `maybeProbe`:
 *
 *   - Feature unavailable (early return).
 *   - Local autosave present (defer to resume prompt).
 *   - Folder not connected (no-folder outcome).
 *   - Folder connected + matching file (match outcome).
 *   - Folder connected + no matching file (no-match outcome).
 *   - List failure (error outcome).
 *   - Once-per-landing guard (second call short-circuits).
 *   - reset() drops the guard.
 *   - dismiss() clears outcome without re-opening the guard.
 *   - File-name match is exact (other .quire-save.json files in
 *     the folder don't trigger a match for a different campaign).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CrossDeviceProbeController,
  type CrossDeviceProbeDeps
} from './cross-device-probe';
import type {
  FsApiCloudPush,
  ListResult
} from '../auth/fs-api-cloud-push';
import { saveFileNameFor } from '../auth/fs-api-cloud-push';

const CAMPAIGN = 'owner/repo@main';
const FILE = saveFileNameFor(CAMPAIGN);

function makeCloudPushStub(
  init: {
    available?: boolean;
    connected?: { folderName: string } | null;
    listResult?: ListResult;
  } = {}
): {
  push: FsApiCloudPush;
  getConnectedSpy: ReturnType<typeof vi.fn>;
  listSpy: ReturnType<typeof vi.fn>;
} {
  const available = init.available ?? true;
  const connected = init.connected ?? null;
  const listResult: ListResult = init.listResult ?? { ok: true, files: [] };

  const getConnectedSpy = vi.fn(async (_args: { campaignId: string }) =>
    connected
      ? {
          connected: true as const,
          folderName: connected.folderName,
          lastPushedAt: null,
          connectedAt: 1
        }
      : { connected: false as const }
  );
  const listSpy = vi.fn(async (_args: { campaignId: string }) => listResult);

  const push = {
    isAvailable: () => available,
    getConnectedFolderState: getConnectedSpy,
    listSavesInFolder: listSpy
  } as unknown as FsApiCloudPush;

  return { push, getConnectedSpy, listSpy };
}

function makeDeps(
  cloudPushStub: { push: FsApiCloudPush },
  opts: { hasAutosave?: boolean } = {}
): CrossDeviceProbeDeps {
  return {
    cloudPush: cloudPushStub.push,
    hasLocalAutosave: () => opts.hasAutosave ?? false
  };
}

describe('CrossDeviceProbeController', () => {
  it('returns feature-unavailable when the FS API is missing', async () => {
    const stub = makeCloudPushStub({ available: false });
    const ctrl = new CrossDeviceProbeController(makeDeps(stub));

    const result = await ctrl.maybeProbe({ campaignId: CAMPAIGN });

    expect(result).toEqual({ kind: 'feature-unavailable' });
    expect(stub.getConnectedSpy).not.toHaveBeenCalled();
    expect(stub.listSpy).not.toHaveBeenCalled();
  });

  it('defers (returns null) when a local autosave already exists', async () => {
    const stub = makeCloudPushStub({
      connected: { folderName: 'Drive/Quire' },
      listResult: {
        ok: true,
        files: [{ name: FILE, lastModifiedMs: 1000, size: 42 }]
      }
    });
    const ctrl = new CrossDeviceProbeController(
      makeDeps(stub, { hasAutosave: true })
    );

    const result = await ctrl.maybeProbe({ campaignId: CAMPAIGN });

    expect(result).toBeNull();
    expect(ctrl.outcome).toBeNull();
    expect(stub.getConnectedSpy).not.toHaveBeenCalled();
    expect(stub.listSpy).not.toHaveBeenCalled();
  });

  it('returns no-folder when no folder handle is connected for this campaign', async () => {
    const stub = makeCloudPushStub({ connected: null });
    const ctrl = new CrossDeviceProbeController(makeDeps(stub));

    const result = await ctrl.maybeProbe({ campaignId: CAMPAIGN });

    expect(result).toEqual({ kind: 'no-folder', campaignId: CAMPAIGN });
    expect(stub.listSpy).not.toHaveBeenCalled();
  });

  it('returns match when a matching .quire-save.json file is present', async () => {
    const stub = makeCloudPushStub({
      connected: { folderName: 'Drive/Quire' },
      listResult: {
        ok: true,
        files: [
          { name: 'unrelated.txt', lastModifiedMs: 999, size: 1 },
          { name: FILE, lastModifiedMs: 1700000000000, size: 12345 }
        ]
      }
    });
    const ctrl = new CrossDeviceProbeController(makeDeps(stub));

    const result = await ctrl.maybeProbe({ campaignId: CAMPAIGN });

    expect(result).toEqual({
      kind: 'match',
      campaignId: CAMPAIGN,
      fileName: FILE,
      lastModifiedMs: 1700000000000,
      sizeBytes: 12345,
      folderName: 'Drive/Quire'
    });
  });

  it('returns no-match when the folder has other quire-save.json files but not THIS campaign', async () => {
    const stub = makeCloudPushStub({
      connected: { folderName: 'Drive/Quire' },
      listResult: {
        ok: true,
        files: [
          {
            name: saveFileNameFor('other/campaign@main'),
            lastModifiedMs: 1000,
            size: 200
          }
        ]
      }
    });
    const ctrl = new CrossDeviceProbeController(makeDeps(stub));

    const result = await ctrl.maybeProbe({ campaignId: CAMPAIGN });

    expect(result).toEqual({ kind: 'no-match', campaignId: CAMPAIGN });
  });

  it('returns an error outcome on listSavesInFolder failure', async () => {
    const stub = makeCloudPushStub({
      connected: { folderName: 'Drive/Quire' },
      listResult: { ok: false, reason: 'permission-revoked' }
    });
    const ctrl = new CrossDeviceProbeController(makeDeps(stub));

    const result = await ctrl.maybeProbe({ campaignId: CAMPAIGN });

    expect(result).toEqual({ kind: 'error', reason: 'permission-revoked' });
  });

  it('runs only once per landing — repeat maybeProbe short-circuits', async () => {
    const stub = makeCloudPushStub({
      connected: { folderName: 'Drive/Quire' },
      listResult: {
        ok: true,
        files: [{ name: FILE, lastModifiedMs: 1000, size: 10 }]
      }
    });
    const ctrl = new CrossDeviceProbeController(makeDeps(stub));

    const r1 = await ctrl.maybeProbe({ campaignId: CAMPAIGN });
    const r2 = await ctrl.maybeProbe({ campaignId: CAMPAIGN });

    expect(r1).toEqual(r2);
    expect(stub.listSpy).toHaveBeenCalledTimes(1);
    expect(stub.getConnectedSpy).toHaveBeenCalledTimes(1);
  });

  it('reset() drops the guard and re-runs the probe', async () => {
    const stub = makeCloudPushStub({
      connected: { folderName: 'Drive/Quire' },
      listResult: {
        ok: true,
        files: [{ name: FILE, lastModifiedMs: 1000, size: 10 }]
      }
    });
    const ctrl = new CrossDeviceProbeController(makeDeps(stub));

    await ctrl.maybeProbe({ campaignId: CAMPAIGN });
    expect(stub.listSpy).toHaveBeenCalledTimes(1);

    ctrl.reset();
    await ctrl.maybeProbe({ campaignId: CAMPAIGN });
    expect(stub.listSpy).toHaveBeenCalledTimes(2);
  });

  it('dismiss() clears the outcome but does NOT re-open the guard', async () => {
    const stub = makeCloudPushStub({
      connected: { folderName: 'Drive/Quire' },
      listResult: {
        ok: true,
        files: [{ name: FILE, lastModifiedMs: 1000, size: 10 }]
      }
    });
    const ctrl = new CrossDeviceProbeController(makeDeps(stub));

    await ctrl.maybeProbe({ campaignId: CAMPAIGN });
    expect(ctrl.outcome?.kind).toBe('match');

    ctrl.dismiss();
    expect(ctrl.outcome).toBeNull();

    // Second probe stays no-op — DM dismissed; we don't re-prompt
    // until the next campaign landing.
    const r = await ctrl.maybeProbe({ campaignId: CAMPAIGN });
    expect(r).toBeNull();
    expect(stub.listSpy).toHaveBeenCalledTimes(1);
  });

  it('NEVER auto-loads — the controller only surfaces an outcome', async () => {
    // DEC-015 invariant: the controller does NOT call pullCampaignFromFolder.
    // Confirm by exposing a spy on it that's never installed.
    const stub = makeCloudPushStub({
      connected: { folderName: 'Drive/Quire' },
      listResult: {
        ok: true,
        files: [{ name: FILE, lastModifiedMs: 1000, size: 10 }]
      }
    });
    // If `pullCampaignFromFolder` were called we'd throw — proves
    // the probe surface doesn't touch the load path.
    Object.defineProperty(stub.push, 'pullCampaignFromFolder', {
      value: () => {
        throw new Error('probe MUST NOT auto-load');
      }
    });

    const ctrl = new CrossDeviceProbeController(makeDeps(stub));
    const result = await ctrl.maybeProbe({ campaignId: CAMPAIGN });

    expect(result?.kind).toBe('match');
  });
});

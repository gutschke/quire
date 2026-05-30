/**
 * fs-api-cloud-push — unit tests.
 *
 * In-memory mocks for the picker, directory handle, file
 * handles, and writable streams cover every documented public
 * contract:
 *
 *   - Feature detection (no API → all surfaces refuse).
 *   - Connect ceremony (consent ledger + picker + permission +
 *     handle storage).
 *   - Push (with + without prior file, conflict on external
 *     modification).
 *   - Pull (happy path + not-found + permission revoked).
 *   - List (filter to `.quire-save.json` suffix; ignore other
 *     files).
 *   - Disconnect (drops handle + withdraws consent).
 *   - Multi-campaign file layout.
 *   - Permission lifecycle (granted → prompt → re-granted).
 *   - File-naming sanitization invariants.
 */

import { describe, expect, it } from 'vitest';
import {
  hasAcknowledged,
  inMemoryConsentStorage,
  recordAcknowledgment,
  type ConsentStorage
} from './cloud-push-consent';
import {
  inMemoryFsApiHandleStorage,
  type FsApiHandleStorage,
  type PermissionStateLike
} from './fs-api-handle-store';
import {
  FsApiCloudPush,
  sanitizeCampaignSlug,
  saveFileNameFor,
  type FsApiCloudPushDeps,
  type FsApiDirectoryHandleIo,
  type FsApiDirectoryPicker,
  type FsApiFileHandleLike,
  type FsApiFileLike,
  type FsApiWritableStreamLike
} from './fs-api-cloud-push';

const CAMPAIGN_A = 'owner/repo@main';
const CAMPAIGN_B = 'other/campaign@main';
const CHROME_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---------------------------------------------------------------
// In-memory FS mock
// ---------------------------------------------------------------

interface MockFile {
  name: string;
  contents: string;
  lastModified: number;
}

interface MockDirState {
  files: Map<string, MockFile>;
  permission: { state: PermissionStateLike };
}

function makeMockDirectory(
  init: { name?: string; permission?: PermissionStateLike } = {}
): {
  handle: FsApiDirectoryHandleIo;
  state: MockDirState;
  setPermission(state: PermissionStateLike): void;
  setFile(name: string, contents: string, lastModified: number): void;
} {
  const state: MockDirState = {
    files: new Map(),
    permission: { state: init.permission ?? 'granted' }
  };

  function makeFile(file: MockFile): FsApiFileLike {
    return {
      lastModified: file.lastModified,
      size: file.contents.length,
      async text() {
        return file.contents;
      }
    };
  }

  function makeFileHandle(file: MockFile): FsApiFileHandleLike {
    return {
      kind: 'file',
      name: file.name,
      async getFile() {
        return makeFile(file);
      },
      async createWritable() {
        let buffer = '';
        const writable: FsApiWritableStreamLike = {
          async write(data: string) {
            buffer += data;
          },
          async close() {
            file.contents = buffer;
            // Bump lastModified so a subsequent push's
            // conflict detection has something to compare to.
            // We use a monotonic +1 rather than a clock so tests
            // are deterministic.
            file.lastModified = file.lastModified + 1;
          }
        };
        return writable;
      }
    };
  }

  const handle: FsApiDirectoryHandleIo = {
    kind: 'directory',
    name: init.name ?? 'Quire',
    async queryPermission({ mode: _mode }) {
      return state.permission.state;
    },
    async requestPermission({ mode: _mode }) {
      // Unless tests override, requesting permission grants it.
      // The mock's permission state is what `query` returns.
      return state.permission.state === 'denied' ? 'denied' : 'granted';
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const existing = state.files.get(name);
      if (existing) return makeFileHandle(existing);
      if (!options?.create) {
        throw new Error('NotFoundError');
      }
      const fresh: MockFile = {
        name,
        contents: '',
        lastModified: 0
      };
      state.files.set(name, fresh);
      return makeFileHandle(fresh);
    },
    async *values() {
      for (const f of state.files.values()) {
        yield makeFileHandle(f);
      }
    }
  };

  return {
    handle,
    state,
    setPermission(s) {
      state.permission.state = s;
    },
    setFile(name, contents, lastModified) {
      state.files.set(name, { name, contents, lastModified });
    }
  };
}

function buildDeps(opts: {
  picker?: FsApiDirectoryPicker;
  handleStorage?: FsApiHandleStorage;
  consentStorage?: ConsentStorage;
  available?: boolean;
  now?: () => number;
} = {}): FsApiCloudPushDeps {
  const t = { value: 1_700_000_000 };
  const env = opts.available === false
    ? { showDirectoryPicker: undefined, userAgent: CHROME_DESKTOP }
    : { showDirectoryPicker: () => Promise.resolve({}), userAgent: CHROME_DESKTOP };
  return {
    env,
    picker: opts.picker ?? (() => Promise.reject(new Error('no picker'))),
    handleStorage: opts.handleStorage ?? inMemoryFsApiHandleStorage(),
    consentStorage: opts.consentStorage ?? inMemoryConsentStorage(),
    now: opts.now ?? (() => {
      const n = t.value;
      t.value += 1;
      return n;
    })
  };
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('sanitizeCampaignSlug', () => {
  it('replaces slashes and @ with dashes', () => {
    expect(sanitizeCampaignSlug('owner/repo@main')).toBe('owner-repo-main');
  });

  it('lowercases', () => {
    expect(sanitizeCampaignSlug('Owner/Repo@Main')).toBe('owner-repo-main');
  });

  it('preserves dots and underscores', () => {
    expect(sanitizeCampaignSlug('owner/repo@v1.0_alpha')).toBe(
      'owner-repo-v1.0_alpha'
    );
  });

  it('collapses dash runs', () => {
    expect(sanitizeCampaignSlug('a///b@@@c')).toBe('a-b-c');
  });

  it('strips leading and trailing dashes', () => {
    expect(sanitizeCampaignSlug('@@owner/repo@@')).toBe('owner-repo');
  });

  it('truncates to 64 chars', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeCampaignSlug(long).length).toBeLessThanOrEqual(64);
  });

  it('falls back to "campaign" on a totally invalid id', () => {
    expect(sanitizeCampaignSlug('@@@')).toBe('campaign');
  });
});

describe('saveFileNameFor', () => {
  it('appends .quire-save.json to the slug', () => {
    expect(saveFileNameFor('owner/repo@main')).toBe(
      'owner-repo-main.quire-save.json'
    );
  });
});

describe('FsApiCloudPush — feature detection', () => {
  it('connectFolder refuses with feature-unavailable when API missing', async () => {
    const cp = new FsApiCloudPush(buildDeps({ available: false }));
    const result = await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    expect(result).toEqual({ ok: false, reason: 'feature-unavailable' });
  });

  it('pushCampaignToFolder refuses with feature-unavailable when API missing', async () => {
    const cp = new FsApiCloudPush(buildDeps({ available: false }));
    const result = await cp.pushCampaignToFolder({
      campaignId: CAMPAIGN_A,
      body: '{}'
    });
    expect(result).toEqual({ ok: false, reason: 'feature-unavailable' });
  });

  it('isAvailable returns false when API missing', () => {
    const cp = new FsApiCloudPush(buildDeps({ available: false }));
    expect(cp.isAvailable()).toBe(false);
  });
});

describe('FsApiCloudPush — connectFolder', () => {
  it('refuses without consent when caller did not pre-acknowledge', async () => {
    const dir = makeMockDirectory();
    const cp = new FsApiCloudPush(
      buildDeps({ picker: async () => dir.handle })
    );
    const result = await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: false
    });
    expect(result).toEqual({ ok: false, reason: 'no-consent' });
  });

  it('proceeds when consent already on record', async () => {
    const dir = makeMockDirectory({ name: 'Quire' });
    const consent = inMemoryConsentStorage();
    recordAcknowledgment(consent, CAMPAIGN_A, 'fs-api', 1_700_000_000);
    const cp = new FsApiCloudPush(
      buildDeps({
        picker: async () => dir.handle,
        consentStorage: consent
      })
    );
    const result = await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: false
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.folderName).toBe('Quire');
      expect(result.consentJustRecorded).toBe(false);
    }
  });

  it('records consent in-method when caller passes acknowledged flag', async () => {
    const dir = makeMockDirectory();
    const consent = inMemoryConsentStorage();
    const cp = new FsApiCloudPush(
      buildDeps({
        picker: async () => dir.handle,
        consentStorage: consent
      })
    );
    const result = await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.consentJustRecorded).toBe(true);
    }
    expect(hasAcknowledged(consent, CAMPAIGN_A, 'fs-api')).toBe(true);
  });

  it('maps picker rejection (user dismiss) to cancelled', async () => {
    const cp = new FsApiCloudPush(
      buildDeps({
        picker: async () => {
          throw new Error('AbortError');
        }
      })
    );
    const result = await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    expect(result).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('persists the handle record after a successful connect', async () => {
    const dir = makeMockDirectory({ name: 'Quire' });
    const store = inMemoryFsApiHandleStorage();
    const cp = new FsApiCloudPush(
      buildDeps({
        picker: async () => dir.handle,
        handleStorage: store
      })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    const record = await store.read(CAMPAIGN_A);
    expect(record).not.toBeNull();
    expect(record?.displayName).toBe('Quire');
  });

  it('returns permission-denied when the picked folder lacks readwrite', async () => {
    const dir = makeMockDirectory({ permission: 'denied' });
    const cp = new FsApiCloudPush(
      buildDeps({ picker: async () => dir.handle })
    );
    const result = await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    expect(result).toEqual({ ok: false, reason: 'permission-denied' });
  });
});

describe('FsApiCloudPush — pushCampaignToFolder', () => {
  it('refuses when no folder connected', async () => {
    const cp = new FsApiCloudPush(buildDeps());
    const result = await cp.pushCampaignToFolder({
      campaignId: CAMPAIGN_A,
      body: '{}'
    });
    expect(result).toEqual({ ok: false, reason: 'not-connected' });
  });

  it('writes a new file on first push', async () => {
    const dir = makeMockDirectory();
    const store = inMemoryFsApiHandleStorage();
    const cp = new FsApiCloudPush(
      buildDeps({
        picker: async () => dir.handle,
        handleStorage: store
      })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    const result = await cp.pushCampaignToFolder({
      campaignId: CAMPAIGN_A,
      body: '{"events":[]}'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fileName).toBe('owner-repo-main.quire-save.json');
      expect(dir.state.files.get(result.fileName)?.contents).toBe(
        '{"events":[]}'
      );
    }
    // Updated lastPushedAt + lastObservedModifiedMs.
    const record = await store.read(CAMPAIGN_A);
    expect(record?.lastPushedAt).not.toBeNull();
    expect(record?.lastObservedModifiedMs).not.toBeNull();
  });

  it('detects external modification (read-before-write conflict)', async () => {
    const dir = makeMockDirectory();
    const cp = new FsApiCloudPush(
      buildDeps({ picker: async () => dir.handle })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    // First push establishes a baseline.
    await cp.pushCampaignToFolder({
      campaignId: CAMPAIGN_A,
      body: '{"v":1}'
    });
    // External edit — bump lastModified far past what we observed.
    dir.setFile(
      'owner-repo-main.quire-save.json',
      '{"externally-edited":true}',
      9_999_999_999
    );
    const result = await cp.pushCampaignToFolder({
      campaignId: CAMPAIGN_A,
      body: '{"v":2}'
    });
    expect(result).toEqual({ ok: false, reason: 'conflict' });
    // Conflict path must NOT have overwritten the externally-
    // edited contents.
    expect(
      dir.state.files.get('owner-repo-main.quire-save.json')?.contents
    ).toBe('{"externally-edited":true}');
  });

  it('returns permission-revoked when the handle has lost write', async () => {
    const dir = makeMockDirectory();
    const cp = new FsApiCloudPush(
      buildDeps({ picker: async () => dir.handle })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    // Simulate the user revoking permission between sessions.
    dir.setPermission('prompt');
    const result = await cp.pushCampaignToFolder({
      campaignId: CAMPAIGN_A,
      body: '{}'
    });
    expect(result).toEqual({ ok: false, reason: 'permission-revoked' });
  });
});

describe('FsApiCloudPush — pullCampaignFromFolder', () => {
  it('returns the file contents when present', async () => {
    const dir = makeMockDirectory();
    const cp = new FsApiCloudPush(
      buildDeps({ picker: async () => dir.handle })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    dir.setFile('owner-repo-main.quire-save.json', '{"hello":"world"}', 42);
    const result = await cp.pullCampaignFromFolder({
      campaignId: CAMPAIGN_A
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe('{"hello":"world"}');
      expect(result.lastModifiedMs).toBe(42);
    }
  });

  it('returns not-found when no save file exists', async () => {
    const dir = makeMockDirectory();
    const cp = new FsApiCloudPush(
      buildDeps({ picker: async () => dir.handle })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    const result = await cp.pullCampaignFromFolder({
      campaignId: CAMPAIGN_A
    });
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  it('returns not-connected when no handle is stored', async () => {
    const cp = new FsApiCloudPush(buildDeps());
    const result = await cp.pullCampaignFromFolder({
      campaignId: CAMPAIGN_A
    });
    expect(result).toEqual({ ok: false, reason: 'not-connected' });
  });

  it('updates lastObservedModifiedMs after a pull (conflict baseline)', async () => {
    const dir = makeMockDirectory();
    const store = inMemoryFsApiHandleStorage();
    const cp = new FsApiCloudPush(
      buildDeps({
        picker: async () => dir.handle,
        handleStorage: store
      })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    dir.setFile('owner-repo-main.quire-save.json', '{}', 12345);
    await cp.pullCampaignFromFolder({ campaignId: CAMPAIGN_A });
    const record = await store.read(CAMPAIGN_A);
    expect(record?.lastObservedModifiedMs).toBe(12345);
  });
});

describe('FsApiCloudPush — listSavesInFolder', () => {
  it('lists only .quire-save.json files', async () => {
    const dir = makeMockDirectory();
    const cp = new FsApiCloudPush(
      buildDeps({ picker: async () => dir.handle })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    dir.setFile('underleaf.quire-save.json', '{"a":1}', 100);
    dir.setFile('other.quire-save.json', '{"b":2}', 200);
    dir.setFile('readme.txt', 'unrelated', 300);
    const result = await cp.listSavesInFolder({ campaignId: CAMPAIGN_A });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const names = result.files.map((f) => f.name).sort();
      expect(names).toEqual([
        'other.quire-save.json',
        'underleaf.quire-save.json'
      ]);
    }
  });

  it('returns empty list when folder is empty', async () => {
    const dir = makeMockDirectory();
    const cp = new FsApiCloudPush(
      buildDeps({ picker: async () => dir.handle })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    const result = await cp.listSavesInFolder({ campaignId: CAMPAIGN_A });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files).toEqual([]);
    }
  });
});

describe('FsApiCloudPush — disconnectFolder', () => {
  it('removes the handle and withdraws consent', async () => {
    const dir = makeMockDirectory();
    const store = inMemoryFsApiHandleStorage();
    const consent = inMemoryConsentStorage();
    const cp = new FsApiCloudPush(
      buildDeps({
        picker: async () => dir.handle,
        handleStorage: store,
        consentStorage: consent
      })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    expect(hasAcknowledged(consent, CAMPAIGN_A, 'fs-api')).toBe(true);
    expect(await store.read(CAMPAIGN_A)).not.toBeNull();
    await cp.disconnectFolder({ campaignId: CAMPAIGN_A });
    expect(await store.read(CAMPAIGN_A)).toBeNull();
    expect(hasAcknowledged(consent, CAMPAIGN_A, 'fs-api')).toBe(false);
  });

  it('does NOT touch the save file on disconnect (DM finds it via file browser)', async () => {
    const dir = makeMockDirectory();
    const cp = new FsApiCloudPush(
      buildDeps({ picker: async () => dir.handle })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    await cp.pushCampaignToFolder({
      campaignId: CAMPAIGN_A,
      body: '{"keepme":true}'
    });
    await cp.disconnectFolder({ campaignId: CAMPAIGN_A });
    // The file still exists in the mock folder — disconnect only
    // drops Quire's reference; the DM can still open the file
    // out-of-band.
    expect(
      dir.state.files.get('owner-repo-main.quire-save.json')?.contents
    ).toBe('{"keepme":true}');
  });

  it('disconnect on an unconnected campaign is a no-op', async () => {
    const cp = new FsApiCloudPush(buildDeps());
    await expect(
      cp.disconnectFolder({ campaignId: CAMPAIGN_A })
    ).resolves.toEqual({ ok: true });
  });
});

describe('FsApiCloudPush — multi-campaign file layout', () => {
  it('ONE folder, file-per-campaign — two campaigns coexist', async () => {
    const dir = makeMockDirectory();
    // Both campaigns connect to the SAME folder (the user picks
    // the same folder twice).
    const cp = new FsApiCloudPush(
      buildDeps({ picker: async () => dir.handle })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    await cp.connectFolder({
      campaignId: CAMPAIGN_B,
      consentAlreadyAcknowledged: true
    });
    await cp.pushCampaignToFolder({
      campaignId: CAMPAIGN_A,
      body: '{"a":1}'
    });
    await cp.pushCampaignToFolder({
      campaignId: CAMPAIGN_B,
      body: '{"b":2}'
    });
    expect(
      dir.state.files.get('owner-repo-main.quire-save.json')?.contents
    ).toBe('{"a":1}');
    expect(
      dir.state.files.get('other-campaign-main.quire-save.json')?.contents
    ).toBe('{"b":2}');
  });

  it('disconnecting one campaign leaves the other intact', async () => {
    const dir = makeMockDirectory();
    const store = inMemoryFsApiHandleStorage();
    const cp = new FsApiCloudPush(
      buildDeps({
        picker: async () => dir.handle,
        handleStorage: store
      })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    await cp.connectFolder({
      campaignId: CAMPAIGN_B,
      consentAlreadyAcknowledged: true
    });
    await cp.disconnectFolder({ campaignId: CAMPAIGN_A });
    expect(await store.read(CAMPAIGN_A)).toBeNull();
    expect(await store.read(CAMPAIGN_B)).not.toBeNull();
  });
});

describe('FsApiCloudPush — permission lifecycle through the orchestrator', () => {
  it('push after permission revoke surfaces revoked + requestPermissionForCampaign re-grants', async () => {
    const dir = makeMockDirectory();
    const cp = new FsApiCloudPush(
      buildDeps({ picker: async () => dir.handle })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    // Permission rolls back (typical tab-close-reopen).
    dir.setPermission('prompt');
    const push = await cp.pushCampaignToFolder({
      campaignId: CAMPAIGN_A,
      body: '{}'
    });
    expect(push).toEqual({ ok: false, reason: 'permission-revoked' });
    // User clicks "Reconnect folder" → gesture handler calls
    // requestPermissionForCampaign.
    const req = await cp.requestPermissionForCampaign({
      campaignId: CAMPAIGN_A
    });
    expect(req).toEqual({ ok: true });
    // Now the next push works.
    dir.setPermission('granted');
    const push2 = await cp.pushCampaignToFolder({
      campaignId: CAMPAIGN_A,
      body: '{}'
    });
    expect(push2.ok).toBe(true);
  });

  it('requestPermissionForCampaign returns not-connected when no handle exists', async () => {
    const cp = new FsApiCloudPush(buildDeps());
    const result = await cp.requestPermissionForCampaign({
      campaignId: CAMPAIGN_A
    });
    expect(result).toEqual({ ok: false, reason: 'not-connected' });
  });
});

describe('FsApiCloudPush — getConnectedFolderState', () => {
  it('returns connected=false when no handle', async () => {
    const cp = new FsApiCloudPush(buildDeps());
    const result = await cp.getConnectedFolderState({
      campaignId: CAMPAIGN_A
    });
    expect(result).toEqual({ connected: false });
  });

  it('returns folder metadata when connected', async () => {
    const dir = makeMockDirectory({ name: 'Quire Backups' });
    const cp = new FsApiCloudPush(
      buildDeps({ picker: async () => dir.handle })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    const result = await cp.getConnectedFolderState({
      campaignId: CAMPAIGN_A
    });
    expect(result.connected).toBe(true);
    if (result.connected) {
      expect(result.folderName).toBe('Quire Backups');
      expect(result.lastPushedAt).toBeNull(); // never pushed yet
    }
  });

  it('reflects lastPushedAt after a successful push', async () => {
    const dir = makeMockDirectory();
    const cp = new FsApiCloudPush(
      buildDeps({ picker: async () => dir.handle })
    );
    await cp.connectFolder({
      campaignId: CAMPAIGN_A,
      consentAlreadyAcknowledged: true
    });
    await cp.pushCampaignToFolder({
      campaignId: CAMPAIGN_A,
      body: '{}'
    });
    const result = await cp.getConnectedFolderState({
      campaignId: CAMPAIGN_A
    });
    expect(result.connected).toBe(true);
    if (result.connected) {
      expect(result.lastPushedAt).not.toBeNull();
    }
  });
});

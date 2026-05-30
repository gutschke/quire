// @vitest-environment happy-dom

/**
 * <backups-card> — Lit-region unit tests.
 *
 * Covers every render path:
 *   - DM gate (renderForDm=false → empty).
 *   - Feature gate (no API → unavailable copy).
 *   - Reason-specific unavailable copy (safari / firefox / mobile / no-api).
 *   - Disconnected → connect happy path (consent + picker + chip).
 *   - Disconnected → consent cancelled → no state change.
 *   - Connected → push action emits the event.
 *   - Connected → push result with conflict → chip surfaces conflict copy.
 *   - Connected → permission revoked on push → chip surfaces reconnect copy.
 *   - Disconnect → handle removed, chip success.
 *
 * The picker call itself is replaced via the FsApiCloudPush
 * dependency tree; we never invoke `window.showDirectoryPicker`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import './backups-card';
import type { BackupsCard, RequestFsApiConsent } from './backups-card';
import {
  FsApiCloudPush,
  type FsApiCloudPushDeps,
  type FsApiDirectoryHandleIo,
  type FsApiDirectoryPicker,
  type FsApiFileHandleLike,
  type FsApiFileLike,
  type FsApiWritableStreamLike,
  type PushResult
} from '../../auth/fs-api-cloud-push';
import {
  inMemoryFsApiHandleStorage,
  type PermissionStateLike
} from '../../auth/fs-api-handle-store';
import {
  inMemoryConsentStorage,
  type ConsentStorage
} from '../../auth/cloud-push-consent';

const CHROME_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SAFARI_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
const FIREFOX_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const CAMPAIGN_A = 'owner/repo@main';

// ---------------------------------------------------------------
// Mock FS + cloud-push wiring
// ---------------------------------------------------------------

interface MockFile {
  name: string;
  contents: string;
  lastModified: number;
}

function makeMockDirectory(opts: { name?: string; permission?: PermissionStateLike } = {}): {
  handle: FsApiDirectoryHandleIo;
  files: Map<string, MockFile>;
} {
  const files = new Map<string, MockFile>();
  const permission = opts.permission ?? 'granted';

  function makeFileLike(f: MockFile): FsApiFileLike {
    return {
      lastModified: f.lastModified,
      size: f.contents.length,
      async text() {
        return f.contents;
      }
    };
  }
  function makeFileHandle(f: MockFile): FsApiFileHandleLike {
    return {
      kind: 'file',
      name: f.name,
      async getFile() {
        return makeFileLike(f);
      },
      async createWritable(): Promise<FsApiWritableStreamLike> {
        let buf = '';
        return {
          async write(data) {
            buf += data;
          },
          async close() {
            f.contents = buf;
            f.lastModified += 1;
          }
        };
      }
    };
  }

  const handle: FsApiDirectoryHandleIo = {
    kind: 'directory',
    name: opts.name ?? 'Quire',
    async queryPermission() {
      return permission;
    },
    async requestPermission() {
      return permission === 'denied' ? 'denied' : 'granted';
    },
    async getFileHandle(name, options) {
      const existing = files.get(name);
      if (existing) return makeFileHandle(existing);
      if (!options?.create) throw new Error('NotFoundError');
      const fresh = { name, contents: '', lastModified: 0 };
      files.set(name, fresh);
      return makeFileHandle(fresh);
    },
    async *values() {
      for (const f of files.values()) {
        yield makeFileHandle(f);
      }
    }
  };
  return { handle, files };
}

function buildCloudPush(opts: {
  picker?: FsApiDirectoryPicker;
  ua?: string;
  apiPresent?: boolean;
  consentStorage?: ConsentStorage;
} = {}): { cp: FsApiCloudPush; deps: FsApiCloudPushDeps } {
  const env = {
    showDirectoryPicker: opts.apiPresent === false
      ? undefined
      : () => Promise.resolve({}),
    userAgent: opts.ua ?? CHROME_DESKTOP
  };
  let counter = 1_700_000_000;
  const deps: FsApiCloudPushDeps = {
    env,
    picker: opts.picker ?? (() => Promise.reject(new Error('no picker'))),
    handleStorage: inMemoryFsApiHandleStorage(),
    consentStorage: opts.consentStorage ?? inMemoryConsentStorage(),
    now: () => counter++
  };
  return { cp: new FsApiCloudPush(deps), deps };
}

function mount(): BackupsCard {
  const el = document.createElement('backups-card') as BackupsCard;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('<backups-card> — render gates', () => {
  it('renders nothing when renderForDm=false', async () => {
    const el = mount();
    const { cp } = buildCloudPush();
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = false;
    await el.updateComplete;
    expect(el.querySelector('[data-testid="backups-card"]')).toBeNull();
  });

  it('renders nothing when cloudPush is null (defense-in-depth)', async () => {
    const el = mount();
    el.cloudPush = null;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    await el.updateComplete;
    expect(el.querySelector('[data-testid="backups-card"]')).toBeNull();
  });

  it('renders nothing when campaignId is empty', async () => {
    const el = mount();
    const { cp } = buildCloudPush();
    el.cloudPush = cp;
    el.campaignId = '';
    el.renderForDm = true;
    await el.updateComplete;
    expect(el.querySelector('[data-testid="backups-card"]')).toBeNull();
  });
});

describe('<backups-card> — feature-unavailable surface', () => {
  it('renders "isn\'t available" copy when API missing on no-api UA', async () => {
    const el = mount();
    const { cp } = buildCloudPush({ apiPresent: false, ua: 'NotABrowser/1.0' });
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    await el.refresh();
    await el.updateComplete;
    const unavail = el.querySelector('[data-testid="backups-unavailable"]');
    expect(unavail).not.toBeNull();
    expect(unavail?.getAttribute('data-reason')).toBe('no-api');
    expect(unavail?.textContent).toMatch(/isn't available/i);
  });

  it('renders Safari-specific copy when on Safari without API', async () => {
    const el = mount();
    const { cp } = buildCloudPush({
      apiPresent: false,
      ua: SAFARI_DESKTOP
    });
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    await el.refresh();
    await el.updateComplete;
    const unavail = el.querySelector('[data-testid="backups-unavailable"]');
    expect(unavail?.getAttribute('data-reason')).toBe('safari');
    expect(unavail?.textContent).toMatch(/Safari/);
    expect(unavail?.textContent).toMatch(/Chrome|Edge/);
  });

  it('renders Firefox-specific copy when on Firefox without API', async () => {
    const el = mount();
    const { cp } = buildCloudPush({
      apiPresent: false,
      ua: FIREFOX_DESKTOP
    });
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    await el.refresh();
    await el.updateComplete;
    const unavail = el.querySelector('[data-testid="backups-unavailable"]');
    expect(unavail?.getAttribute('data-reason')).toBe('firefox');
    expect(unavail?.textContent).toMatch(/Firefox/);
  });

  it('renders mobile-specific copy on Android', async () => {
    const el = mount();
    const { cp } = buildCloudPush({
      apiPresent: false,
      ua: CHROME_ANDROID
    });
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    await el.refresh();
    await el.updateComplete;
    const unavail = el.querySelector('[data-testid="backups-unavailable"]');
    expect(unavail?.getAttribute('data-reason')).toBe('mobile');
    expect(unavail?.textContent).toMatch(/mobile|desktop/i);
  });

  it('mentions OAuth Drive as the coming alternative', async () => {
    const el = mount();
    const { cp } = buildCloudPush({
      apiPresent: false,
      ua: SAFARI_DESKTOP
    });
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    await el.refresh();
    await el.updateComplete;
    const card = el.querySelector('[data-testid="backups-card"]');
    expect(card?.textContent).toMatch(/OAuth Drive|Drive sync/i);
  });

  it('does NOT show the Connect button when API unavailable', async () => {
    const el = mount();
    const { cp } = buildCloudPush({
      apiPresent: false,
      ua: SAFARI_DESKTOP
    });
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    await el.refresh();
    await el.updateComplete;
    expect(el.querySelector('[data-testid="backups-connect"]')).toBeNull();
  });
});

describe('<backups-card> — disconnected state', () => {
  it('shows the Connect button when API available + no folder', async () => {
    const el = mount();
    const { cp } = buildCloudPush();
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    await el.refresh();
    await el.updateComplete;
    expect(
      el.querySelector('[data-testid="backups-disconnected"]')
    ).not.toBeNull();
    expect(el.querySelector('[data-testid="backups-connect"]')).not.toBeNull();
  });

  it('mentions example sync tools so DM maps to their own setup', async () => {
    const el = mount();
    const { cp } = buildCloudPush();
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    await el.refresh();
    await el.updateComplete;
    const text = el.querySelector('[data-testid="backups-disconnected"]')
      ?.textContent ?? '';
    expect(/Drive|Dropbox|OneDrive|iCloud/i.test(text)).toBe(true);
  });
});

describe('<backups-card> — connect happy path', () => {
  it('drives consent → picker → connect → chip success', async () => {
    const dir = makeMockDirectory({ name: 'Quire Backups' });
    const { cp } = buildCloudPush({ picker: async () => dir.handle });
    const el = mount();
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;

    const requestConsent: RequestFsApiConsent = async () => true;
    el.requestConsent = requestConsent;

    await el.refresh();
    await el.updateComplete;

    const connect = el.querySelector(
      '[data-testid="backups-connect"]'
    ) as HTMLButtonElement;
    connect.click();
    // Wait for the async chain.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    const chip = el.querySelector('[data-testid="backups-chip"]');
    expect(chip?.getAttribute('data-state')).toBe('success');
    expect(chip?.textContent).toMatch(/Quire Backups/);
    expect(el.querySelector('[data-testid="backups-connected"]')).not.toBeNull();
  });

  it('consent dialog cancel leaves the card in disconnected state', async () => {
    const dir = makeMockDirectory();
    const { cp } = buildCloudPush({ picker: async () => dir.handle });
    const el = mount();
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    el.requestConsent = async () => false; // DM clicked Cancel
    await el.refresh();
    await el.updateComplete;

    const connect = el.querySelector(
      '[data-testid="backups-connect"]'
    ) as HTMLButtonElement;
    connect.click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    // Still disconnected, no chip surfaced.
    expect(el.querySelector('[data-testid="backups-disconnected"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="backups-chip"]')).toBeNull();
  });
});

describe('<backups-card> — connected actions emit events', () => {
  it('Push button dispatches backups-push-request', async () => {
    const dir = makeMockDirectory();
    const { cp } = buildCloudPush({ picker: async () => dir.handle });
    const el = mount();
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    el.requestConsent = async () => true;
    await el.refresh();
    await el.updateComplete;

    // Connect first.
    (el.querySelector('[data-testid="backups-connect"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    let received: CustomEvent | null = null;
    el.addEventListener('backups-push-request', (e) => {
      received = e as CustomEvent;
    });
    (el.querySelector('[data-testid="backups-push"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(received).not.toBeNull();
    expect((received as unknown as CustomEvent).detail).toEqual({
      campaignId: CAMPAIGN_A
    });
  });

  it('applyPushResult success → chip success copy', async () => {
    const dir = makeMockDirectory();
    const { cp } = buildCloudPush({ picker: async () => dir.handle });
    const el = mount();
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    el.requestConsent = async () => true;
    await el.refresh();
    await el.updateComplete;
    (el.querySelector('[data-testid="backups-connect"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    const result: PushResult = {
      ok: true,
      fileName: 'owner-repo-main.quire-save.json',
      bytesWritten: 42,
      lastModifiedMs: 9_999
    };
    el.applyPushResult(result);
    await el.updateComplete;
    const chip = el.querySelector('[data-testid="backups-chip"]');
    expect(chip?.getAttribute('data-state')).toBe('success');
    expect(chip?.textContent).toMatch(/42 bytes/);
  });

  it('applyPushResult conflict → chip surfaces conflict copy', async () => {
    const dir = makeMockDirectory();
    const { cp } = buildCloudPush({ picker: async () => dir.handle });
    const el = mount();
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    el.requestConsent = async () => true;
    await el.refresh();
    await el.updateComplete;
    (el.querySelector('[data-testid="backups-connect"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    el.applyPushResult({ ok: false, reason: 'conflict' });
    await el.updateComplete;
    const chip = el.querySelector('[data-testid="backups-chip"]');
    expect(chip?.getAttribute('data-state')).toBe('error');
    expect(chip?.textContent).toMatch(/another device/i);
  });

  it('applyPushResult permission-revoked → chip surfaces reconnect copy', async () => {
    const dir = makeMockDirectory();
    const { cp } = buildCloudPush({ picker: async () => dir.handle });
    const el = mount();
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    el.requestConsent = async () => true;
    await el.refresh();
    await el.updateComplete;
    (el.querySelector('[data-testid="backups-connect"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    el.applyPushResult({ ok: false, reason: 'permission-revoked' });
    await el.updateComplete;
    const chip = el.querySelector('[data-testid="backups-chip"]');
    // M6a-FS-2 (run #9): permission-revoked is now its own
    // chip state, distinct from generic error, because it
    // surfaces a [Reconnect] button.
    expect(chip?.getAttribute('data-state')).toBe('permission-revoked');
    expect(chip?.textContent).toMatch(/Reconnect|confirm folder/i);
  });
});

// M6a-FS-2 (run #9): Reconnect-on-permission-revoked surface.
describe('<backups-card> — reconnect-on-permission-revoked (M6a-FS-2)', () => {
  // Helper that puts the card in the permission-revoked state and
  // returns it.  Mirrors the connect-happy-path setup.
  async function withConnectedThenRevoked(): Promise<{
    el: BackupsCard;
    cp: FsApiCloudPush;
    dir: ReturnType<typeof makeMockDirectory>;
  }> {
    const dir = makeMockDirectory();
    const { cp } = buildCloudPush({ picker: async () => dir.handle });
    const el = mount();
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    el.requestConsent = async () => true;
    await el.refresh();
    await el.updateComplete;
    (el.querySelector('[data-testid="backups-connect"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    el.applyPushResult({ ok: false, reason: 'permission-revoked' });
    await el.updateComplete;
    return { el, cp, dir };
  }

  it('renders a [Reconnect] button next to the chip in permission-revoked state', async () => {
    const { el } = await withConnectedThenRevoked();
    const reconnect = el.querySelector('[data-testid="backups-reconnect"]');
    expect(reconnect).not.toBeNull();
    expect(reconnect?.textContent).toMatch(/Reconnect/);
  });

  it('Reconnect click calls requestPermissionForCampaign and surfaces success on grant', async () => {
    const { el, dir } = await withConnectedThenRevoked();
    // The mock-directory's permission state defaults to granted —
    // requestWritePermission(handle) resolves ok.  Click the
    // reconnect button.
    void dir;
    (el.querySelector('[data-testid="backups-reconnect"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    const chip = el.querySelector('[data-testid="backups-chip"]');
    expect(chip?.getAttribute('data-state')).toBe('success');
    expect(chip?.textContent).toMatch(/reconnected|push to back up/i);
    // Reconnect button is gone after success (no longer permission-revoked).
    expect(el.querySelector('[data-testid="backups-reconnect"]')).toBeNull();
  });

  it('Reconnect click surfaces not-connected if handle was disconnected externally', async () => {
    const { el, cp } = await withConnectedThenRevoked();
    // Simulate the handle disappearing — disconnect the folder
    // out-of-band, then click Reconnect.
    await cp.disconnectFolder({ campaignId: CAMPAIGN_A });
    (el.querySelector('[data-testid="backups-reconnect"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    const chip = el.querySelector('[data-testid="backups-chip"]');
    expect(chip?.getAttribute('data-state')).toBe('error');
    expect(chip?.textContent).toMatch(/no folder|pick a folder/i);
  });

  it('Reconnect click on denied permission keeps the chip in permission-revoked state', async () => {
    const { el, dir } = await withConnectedThenRevoked();
    // Connection landed.  Flip the mock to deny — both
    // queryPermission AND requestPermission, since the mock's
    // closure-captured permission isn't reassignable mid-test.
    dir.handle.queryPermission = async () => 'prompt';
    dir.handle.requestPermission = async () => 'denied';
    (el.querySelector('[data-testid="backups-reconnect"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    const chip = el.querySelector('[data-testid="backups-chip"]');
    expect(chip?.getAttribute('data-state')).toBe('permission-revoked');
    // Reconnect button is still there so the DM can retry.
    expect(el.querySelector('[data-testid="backups-reconnect"]')).not.toBeNull();
  });
});

describe('<backups-card> — disconnect path', () => {
  it('Disconnect button drops the handle and shows chip success', async () => {
    const dir = makeMockDirectory();
    const { cp } = buildCloudPush({ picker: async () => dir.handle });
    const el = mount();
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    el.requestConsent = async () => true;
    await el.refresh();
    await el.updateComplete;
    (el.querySelector('[data-testid="backups-connect"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(el.querySelector('[data-testid="backups-connected"]')).not.toBeNull();

    (el.querySelector('[data-testid="backups-disconnect"]') as HTMLButtonElement).click();
    // Wait for the async disconnect + refresh chain.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el.querySelector('[data-testid="backups-disconnected"]')).not.toBeNull();
    const chip = el.querySelector('[data-testid="backups-chip"]');
    expect(chip?.getAttribute('data-state')).toBe('success');
    expect(chip?.textContent).toMatch(/disconnected/i);
  });
});

describe('<backups-card> — chip clearing on refresh', () => {
  it('connect error → chip surfaces, then a fresh action overwrites it', async () => {
    const { cp } = buildCloudPush({
      picker: async () => {
        throw new Error('AbortError');
      }
    });
    const el = mount();
    el.cloudPush = cp;
    el.campaignId = CAMPAIGN_A;
    el.renderForDm = true;
    el.requestConsent = async () => true;
    await el.refresh();
    await el.updateComplete;
    (el.querySelector('[data-testid="backups-connect"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    const chip = el.querySelector('[data-testid="backups-chip"]');
    expect(chip?.getAttribute('data-state')).toBe('error');
    expect(chip?.textContent).toMatch(/no folder picked/i);
  });
});

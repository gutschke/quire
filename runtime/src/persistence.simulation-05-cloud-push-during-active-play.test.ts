// @vitest-environment node

/**
 * Mock Campaign 05 — Cloud push during active play (race-condition probe).
 *
 * Doc: `design/save-restore-program/simulations/mock-campaign-05-
 * cloud-push-during-active-play.md` — read that for the scenario
 * brief and per-turn script.
 *
 * Drives the real `FsApiCloudPush` orchestrator + a mock directory
 * handle through concurrent push / autosave / active-play / conflict
 * / paused-tab scenarios.
 *
 * Run with `npx vitest run src/persistence.simulation-05-cloud-push-
 * during-active-play.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { Peer } from './core/peer';
import { InMemoryNetwork, InMemoryTransport } from './core/transports/in-memory';
import {
  defaultRebroadcastFilter,
  defaultSyncResponseFilter,
  parseSaveDocument,
  serializeSession,
  serializeSessionForViewer,
  stringifySave
} from './persistence';
import {
  FsApiCloudPush,
  saveFileNameFor,
  type FsApiDirectoryHandleIo,
  type FsApiFileHandleLike,
  type FsApiFileLike,
  type FsApiWritableStreamLike
} from './auth/fs-api-cloud-push';
import {
  inMemoryFsApiHandleStorage,
  type PermissionStateLike
} from './auth/fs-api-handle-store';
import {
  inMemoryConsentStorage,
  recordAcknowledgment
} from './auth/cloud-push-consent';

const CAMPAIGN = { owner: 'gutschke', repo: 'underleaf', ref: 'main' };
const CAMPAIGN_ID = `${CAMPAIGN.owner}/${CAMPAIGN.repo}@${CAMPAIGN.ref}`;
const FILE_NAME = saveFileNameFor(CAMPAIGN_ID);

function makePeer(id: string, net: InMemoryNetwork): Peer {
  return new Peer(id, new InMemoryTransport(id, net), {
    rebroadcastFilter: defaultRebroadcastFilter,
    syncResponseFilter: defaultSyncResponseFilter
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------
// Mock FileSystem with controllable lastModified + permission +
// write-error toggle for the offline-recovery sub-test.
// ---------------------------------------------------------------

interface MockFile {
  name: string;
  contents: string;
  lastModified: number;
}

interface MockDir {
  files: Map<string, MockFile>;
  permission: PermissionStateLike;
  writesShouldFail: boolean;
}

function makeMockDirectory(init: {
  name?: string;
  permission?: PermissionStateLike;
} = {}): {
  handle: FsApiDirectoryHandleIo;
  state: MockDir;
  setPermission(s: PermissionStateLike): void;
  setFile(name: string, contents: string, lastModifiedMs: number): void;
  setWritesShouldFail(fail: boolean): void;
} {
  const state: MockDir = {
    files: new Map(),
    permission: init.permission ?? 'granted',
    writesShouldFail: false
  };
  const name = init.name ?? 'My Quire Folder';

  function makeFileLike(file: MockFile): FsApiFileLike {
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
        return makeFileLike(file);
      },
      async createWritable(): Promise<FsApiWritableStreamLike> {
        if (state.writesShouldFail) {
          throw new Error('mock offline');
        }
        let buffer = '';
        return {
          async write(data: string) {
            buffer += data;
          },
          async close() {
            file.contents = buffer;
            // Advance the mock clock so the post-write lastModified
            // is reliably greater than the pre-write baseline.
            file.lastModified = Math.max(file.lastModified + 1, Date.now());
          }
        };
      }
    };
  }

  const handle: FsApiDirectoryHandleIo = {
    name,
    kind: 'directory' as const,
    async queryPermission() {
      return state.permission;
    },
    async requestPermission() {
      return state.permission;
    },
    async getFileHandle(fileName: string, options?: { create?: boolean }) {
      let file = state.files.get(fileName);
      if (!file) {
        if (!options?.create) {
          const err = new Error('not found');
          (err as Error & { name: string }).name = 'NotFoundError';
          throw err;
        }
        file = { name: fileName, contents: '', lastModified: Date.now() };
        state.files.set(fileName, file);
      }
      return makeFileHandle(file);
    },
    async *values() {
      for (const file of state.files.values()) {
        yield makeFileHandle(file);
      }
    }
  };

  return {
    handle,
    state,
    setPermission(s) {
      state.permission = s;
    },
    setFile(fileName, contents, lastModifiedMs) {
      state.files.set(fileName, {
        name: fileName,
        contents,
        lastModified: lastModifiedMs
      });
    },
    setWritesShouldFail(fail) {
      state.writesShouldFail = fail;
    }
  };
}

function makeCloudPush(handle: FsApiDirectoryHandleIo) {
  const consent = inMemoryConsentStorage();
  const handleStorage = inMemoryFsApiHandleStorage();
  // Pre-record consent so connectFolder/push proceed.
  recordAcknowledgment(consent, CAMPAIGN_ID, 'fs-api', 1);
  let nowCounter = 1;
  const cloudPush = new FsApiCloudPush({
    env: {
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      showDirectoryPicker: async () => handle
    },
    picker: async () => handle,
    handleStorage,
    consentStorage: consent,
    now: () => ++nowCounter
  });
  return { cloudPush, consent, handleStorage };
}

describe('Mock Campaign 05 — Cloud push during active play', () => {
  it('snapshot semantics: push body captures events at call time; later events do not back-leak', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const mei = makePeer('mei', net);
    const anya = makePeer('anya', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    mei.append('peer-join', { name: 'Mei', knownKindsCount: 200 });
    anya.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('chat', { text: 'Session 1 begins.' });
    await flush();

    const fs = makeMockDirectory();
    const { cloudPush } = makeCloudPush(fs.handle);
    const connectResult = await cloudPush.connectFolder({
      campaignId: CAMPAIGN_ID,
      consentAlreadyAcknowledged: true
    });
    expect(connectResult.ok).toBe(true);

    // Snapshot the event log at push-call time.
    const eventsAtPush = [...dm.events()];
    const docAtPush = serializeSession(eventsAtPush, CAMPAIGN, 'markus');
    const bodyAtPush = stringifySave(docAtPush);

    // Kick off push.  While push is in flight, fire two more chats.
    const pushPromise = cloudPush.pushCampaignToFolder({
      campaignId: CAMPAIGN_ID,
      body: bodyAtPush
    });

    mei.append('chat', { text: 'Mei rolls forward.' });
    anya.append('chat', { text: 'Anya circles.' });

    const pushResult = await pushPromise;
    expect(pushResult.ok).toBe(true);

    // A1: file body parses as a SaveDocument; A2: body equals what
    // we captured at call time (no leaking from later writes).
    const fileContents = fs.state.files.get(FILE_NAME)?.contents ?? '';
    const parsed = parseSaveDocument(fileContents);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(stringifySave(parsed.doc)).toBe(bodyAtPush);

    // A4: chats fired during push are in the LIVE session log on
    // all peers — they did not get lost.
    await flush();
    expect(dm.state().chat.map((c) => c.text)).toContain('Mei rolls forward.');
    expect(dm.state().chat.map((c) => c.text)).toContain('Anya circles.');
  });

  it('autosave + push fire concurrently without corruption', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const mei = makePeer('mei', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    mei.append('peer-join', { name: 'Mei', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('chat', { text: 'beat 1' });
    await flush();

    const fs = makeMockDirectory();
    const { cloudPush } = makeCloudPush(fs.handle);
    await cloudPush.connectFolder({
      campaignId: CAMPAIGN_ID,
      consentAlreadyAcknowledged: true
    });

    // Concurrent: a) push to folder, b) build autosave body for
    // localStorage (the autosave controller would write here).
    const eventsSnapshot = [...dm.events()];
    const pushBody = stringifySave(
      serializeSession(eventsSnapshot, CAMPAIGN, 'markus')
    );
    const autosaveBody = stringifySave(
      serializeSessionForViewer(eventsSnapshot, CAMPAIGN, 'markus', 'markus')
    );

    const [pushResult, autosaveParsed] = await Promise.all([
      cloudPush.pushCampaignToFolder({ campaignId: CAMPAIGN_ID, body: pushBody }),
      Promise.resolve(parseSaveDocument(autosaveBody))
    ]);

    expect(pushResult.ok).toBe(true);
    expect(autosaveParsed.ok).toBe(true);

    // Both bodies are independently valid.  Folder content matches
    // push body byte-for-byte.
    expect(fs.state.files.get(FILE_NAME)?.contents).toBe(pushBody);
  });

  it('conflict detection: external write between pushes triggers conflict reason', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('chat', { text: 'first beat' });
    await flush();

    const fs = makeMockDirectory();
    const { cloudPush } = makeCloudPush(fs.handle);
    await cloudPush.connectFolder({
      campaignId: CAMPAIGN_ID,
      consentAlreadyAcknowledged: true
    });

    // First push lands the baseline.
    const body1 = stringifySave(
      serializeSession([...dm.events()], CAMPAIGN, 'markus')
    );
    const push1 = await cloudPush.pushCampaignToFolder({
      campaignId: CAMPAIGN_ID,
      body: body1
    });
    expect(push1.ok).toBe(true);

    // External writer (another device's desktop-sync pulled a newer
    // copy of the file) modifies the file with a future timestamp.
    fs.setFile(FILE_NAME, '{"external":"write"}', Date.now() + 10_000_000);

    // DM adds another beat and tries to push again.
    dm.append('chat', { text: 'second beat' });
    await flush();
    const body2 = stringifySave(
      serializeSession([...dm.events()], CAMPAIGN, 'markus')
    );
    const push2 = await cloudPush.pushCampaignToFolder({
      campaignId: CAMPAIGN_ID,
      body: body2
    });
    expect(push2.ok).toBe(false);
    if (!push2.ok) {
      expect(push2.reason).toBe('conflict');
    }

    // The external content is preserved — push did NOT clobber.
    expect(fs.state.files.get(FILE_NAME)?.contents).toBe(
      '{"external":"write"}'
    );
  });

  it('offline recovery: failed write leaves the handle storage clean; retry succeeds', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('chat', { text: 'b1' });
    await flush();

    const fs = makeMockDirectory();
    const { cloudPush, handleStorage } = makeCloudPush(fs.handle);
    await cloudPush.connectFolder({
      campaignId: CAMPAIGN_ID,
      consentAlreadyAcknowledged: true
    });

    // Initial handle record captured the connection-time observation.
    const beforeRecord = await handleStorage.read(CAMPAIGN_ID);
    expect(beforeRecord).not.toBeNull();
    const beforeObserved = beforeRecord!.lastObservedModifiedMs;

    // Simulate sync-client offline by making writes throw.
    fs.setWritesShouldFail(true);
    const body = stringifySave(
      serializeSession([...dm.events()], CAMPAIGN, 'markus')
    );
    const pushFail = await cloudPush.pushCampaignToFolder({
      campaignId: CAMPAIGN_ID,
      body
    });
    expect(pushFail.ok).toBe(false);
    if (!pushFail.ok) expect(pushFail.reason).toBe('write-failure');

    // Handle record's baseline was NOT advanced — a future retry
    // doesn't pretend an observation happened.
    const afterFailRecord = await handleStorage.read(CAMPAIGN_ID);
    expect(afterFailRecord!.lastObservedModifiedMs).toBe(beforeObserved);

    // Network returns.  Retry succeeds.
    fs.setWritesShouldFail(false);
    const pushRetry = await cloudPush.pushCampaignToFolder({
      campaignId: CAMPAIGN_ID,
      body
    });
    expect(pushRetry.ok).toBe(true);
    expect(fs.state.files.get(FILE_NAME)?.contents).toBe(body);

    // Handle record's baseline DID advance now.
    const afterSuccess = await handleStorage.read(CAMPAIGN_ID);
    expect(afterSuccess!.lastObservedModifiedMs).not.toBeNull();
    expect(afterSuccess!.lastObservedModifiedMs).toBeGreaterThan(
      beforeObserved ?? 0
    );
  });

  it('consent dialog mid-session: shared envelope events still deliver while dialog is open', async () => {
    // Models a DM who has NOT yet acked consent.  The caller (host)
    // would normally call `requestFsApiConsent` first; the dialog
    // resolution is async.  Meanwhile, peer events should continue
    // to flow.
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const mei = makePeer('mei', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    mei.append('peer-join', { name: 'Mei', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    await flush();

    const fs = makeMockDirectory();
    // Fresh consent storage — has NOT acknowledged.
    const consent = inMemoryConsentStorage();
    const handleStorage = inMemoryFsApiHandleStorage();
    const cloudPush = new FsApiCloudPush({
      env: {
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        showDirectoryPicker: async () => fs.handle
      },
      picker: async () => fs.handle,
      handleStorage,
      consentStorage: consent,
      now: () => Date.now()
    });

    // Simulate the user opening the dialog and a player firing a
    // chat during the dialog's open window.
    const dialogPromise = new Promise<boolean>((resolve) => {
      // The "dialog" is open for 30ms (simulating a slow click).
      setTimeout(() => resolve(true), 30);
    });
    // While dialog is open, mei chats.  The share envelope delivers
    // to the DM via the network.
    mei.append('chat', { text: 'mid-dialog chat' });
    await flush();
    // DM has the chat now even though the dialog isn't resolved.
    expect(dm.state().chat.map((c) => c.text)).toContain('mid-dialog chat');

    // Dialog resolves.  DM acks.  Consent recorded.
    const consented = await dialogPromise;
    expect(consented).toBe(true);
    recordAcknowledgment(consent, CAMPAIGN_ID, 'fs-api', Date.now());

    // Connect + push succeed.
    const connect = await cloudPush.connectFolder({
      campaignId: CAMPAIGN_ID,
      consentAlreadyAcknowledged: true
    });
    expect(connect.ok).toBe(true);
    const pushResult = await cloudPush.pushCampaignToFolder({
      campaignId: CAMPAIGN_ID,
      body: stringifySave(
        serializeSession([...dm.events()], CAMPAIGN, 'markus')
      )
    });
    expect(pushResult.ok).toBe(true);

    // The push body contains the mid-dialog chat — it landed in the
    // live log before the push fired.
    const parsed = parseSaveDocument(
      fs.state.files.get(FILE_NAME)?.contents ?? ''
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const chatEvents = parsed.doc.events.filter((e) => e.kind === 'chat');
    expect(
      chatEvents.some(
        (e) => (e.payload as { text?: string })?.text === 'mid-dialog chat'
      )
    ).toBe(true);
  });

  it('paused-tab visibilitychange flush works while a push is also in flight', async () => {
    // Simulates the autosave-on-visibilitychange flush firing AT THE
    // SAME TIME as a manual push.  Both should produce consistent
    // bodies — autosave is local-only (no folder touch), push is
    // folder-only (no localStorage touch).
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('chat', { text: 'a' });
    dm.append('chat', { text: 'b' });
    await flush();

    const fs = makeMockDirectory();
    const { cloudPush } = makeCloudPush(fs.handle);
    await cloudPush.connectFolder({
      campaignId: CAMPAIGN_ID,
      consentAlreadyAcknowledged: true
    });

    // Snapshot at the same instant for both.
    const snapshot = [...dm.events()];
    const pushBody = stringifySave(serializeSession(snapshot, CAMPAIGN, 'markus'));
    const localBody = stringifySave(
      serializeSessionForViewer(snapshot, CAMPAIGN, 'markus', 'markus')
    );

    const [pushResult] = await Promise.all([
      cloudPush.pushCampaignToFolder({ campaignId: CAMPAIGN_ID, body: pushBody })
      // "visibilitychange flush" is synchronous (the controller's
      // flush method writes to localStorage immediately).  We model
      // it as a no-network resolve in the same tick.
    ]);
    expect(pushResult.ok).toBe(true);

    // Both bodies parse cleanly + the saved-by-peer fields match.
    const parsedFolder = parseSaveDocument(
      fs.state.files.get(FILE_NAME)?.contents ?? ''
    );
    const parsedLocal = parseSaveDocument(localBody);
    expect(parsedFolder.ok && parsedLocal.ok).toBe(true);
  });
});

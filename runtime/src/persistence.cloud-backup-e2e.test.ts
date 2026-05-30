// @vitest-environment node

/**
 * Cloud backup E2E — substantial-campaign roundtrip.
 *
 * Per the run #13 mandate from the human:
 *
 *   > full backup of the entire game state has to work too.
 *
 * Sibling to the M4 restore-drill: M4 exercises a small log
 * (<10 events) for byte-identical roundtrip + LWW determinism.
 * This file exercises a SUBSTANTIAL campaign (~500 events covering
 * chargen, play, scene reveals, advancement, retire, session
 * digests) through the FULL cloud-folder push/pull pipeline using
 * the real `FsApiCloudPush` orchestrator + a mock directory handle.
 *
 * Covers:
 *   - DM coord projection push.
 *   - DM coord projection pull (round-trip).
 *   - Player projection separately survives the firewall.
 *   - Cross-device probe pull (`listSavesInFolder` + `pullCampaign`).
 *   - Firewall holds across the full pipeline (no DM material in
 *     the player save).
 *   - All event kinds in the substantial log are KNOWN.
 *
 * If this test fails, the playtest cannot ship.
 */

import { describe, it, expect } from 'vitest';
import { Peer } from './core/peer';
import { InMemoryNetwork, InMemoryTransport } from './core/transports/in-memory';
import { EventLog } from './core/event-log';
import { materialize, filterForViewer } from './core/state';
import {
  applySaveToLog,
  defaultRebroadcastFilter,
  defaultSyncResponseFilter,
  parseSaveDocument,
  projectSaveForViewer,
  serializeSession,
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

// Mock directory handle shared with sim-05's helper pattern.
interface MockFile {
  name: string;
  contents: string;
  lastModified: number;
}
interface MockDir {
  files: Map<string, MockFile>;
  permission: PermissionStateLike;
}

function makeMockDirectory(): {
  handle: FsApiDirectoryHandleIo;
  state: MockDir;
} {
  const state: MockDir = { files: new Map(), permission: 'granted' };

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
        let buffer = '';
        return {
          async write(data: string) {
            buffer += data;
          },
          async close() {
            file.contents = buffer;
            file.lastModified = Math.max(file.lastModified + 1, Date.now());
          }
        };
      }
    };
  }

  const handle: FsApiDirectoryHandleIo = {
    name: 'My Quire Folder',
    kind: 'directory' as const,
    async queryPermission() {
      return state.permission;
    },
    async requestPermission() {
      return state.permission;
    },
    async getFileHandle(
      fileName: string,
      options?: { create?: boolean }
    ) {
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

  return { handle, state };
}

function makeCloudPush(handle: FsApiDirectoryHandleIo) {
  const consent = inMemoryConsentStorage();
  recordAcknowledgment(consent, CAMPAIGN_ID, 'fs-api', 1);
  const handleStorage = inMemoryFsApiHandleStorage();
  let nowCounter = 1;
  return new FsApiCloudPush({
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
}

/**
 * Drive a substantial campaign: chargen + play + scene reveals +
 * advancement + a retire + a co-DM transition + 2 session digests.
 * Target: ~500 events.
 */
async function driveSubstantialCampaign(net: InMemoryNetwork): Promise<{
  dm: Peer;
  coDm: Peer;
  players: Peer[];
}> {
  const dm = makePeer('dm-markus', net);
  const coDm = makePeer('dm-chen', net);
  const anya = makePeer('anya', net);
  const mei = makePeer('mei', net);
  dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
  coDm.append('peer-join', { name: 'Chen', knownKindsCount: 200 });
  anya.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
  mei.append('peer-join', { name: 'Mei', knownKindsCount: 200 });
  dm.append('coordinator-claim', {});

  // Chargen for both players.
  for (const [pcId, name, pronouns] of [
    ['pc-anya', 'Anya Saito', 'she/her'],
    ['pc-mei', 'Mei Tanaka', 'they/them']
  ] as const) {
    dm.append('pc-create', {
      v: 1,
      pcId,
      name,
      pronouns,
      tags: ['scholar', 'curious', 'quiet'],
      stats: { str: 0, dex: 0, con: 0, int: 1, wis: 1, cha: 0 },
      skills: ['Lore'],
      backstory: `${name} grew up in the Underleaf bramble.`,
      dmNotes: `DM-only note for ${name}` // firewall test
    });
  }
  await flush();

  // Session 1.
  dm.append('session-open', { v: 1 });
  for (let i = 0; i < 100; i++) {
    dm.append('chat', { text: `S1 DM line ${i}` });
    if (i % 5 === 0) {
      anya.append('chat', { text: `S1 Anya line ${i}` });
    }
    if (i % 7 === 0) {
      mei.append('chat', { text: `S1 Mei line ${i}` });
    }
  }
  await flush();

  // DM scratch notes (DM-only, firewall test).
  for (let i = 0; i < 20; i++) {
    dm.append('scratch-note', { v: 1, text: `DM private note ${i}` });
  }
  await flush();

  // Some scene-reveal-paragraph events (player-visible).
  for (let i = 0; i < 30; i++) {
    dm.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'world/bramble.md',
      paragraphIndex: i,
      text: `Reveal block ${i}`
    });
  }
  await flush();

  // Some pc-edits (numeric).
  for (let i = 0; i < 10; i++) {
    dm.append('pc-edit', {
      pcId: 'pc-anya',
      field: 'harm',
      value: i % 5
    });
    dm.append('pc-edit', {
      pcId: 'pc-mei',
      field: 'stress',
      value: i % 5
    });
  }
  await flush();

  // Realization beat (atomic).
  dm.append('pc-mark-realization', {
    v: 1,
    pcId: 'pc-mei',
    realizationTs: 1_700_000_000_000
  });
  dm.append('focus-grant', {
    v: 1,
    pcId: 'pc-mei',
    focus: {
      id: 'foc-mei-1',
      name: 'Willowlight',
      domain: 'memory',
      boundFor: 'reveal-1' // DM-only sub-field; stripped on player save
    }
  });
  await flush();

  // Session 1 digest.
  dm.append('session-digest', {
    v: 1,
    sessionStartTs: 1_700_000_000_000,
    markdown: '# Session 1 digest — the willowlight'
  });
  await flush();

  // Co-DM transition.
  coDm.reclaimCoordinator();
  await flush();

  // Session 2 (Chen DM).
  coDm.append('session-open', { v: 1 });
  for (let i = 0; i < 80; i++) {
    coDm.append('chat', { text: `S2 Chen line ${i}` });
    if (i % 3 === 0) {
      anya.append('chat', { text: `S2 Anya line ${i}` });
    }
  }
  await flush();

  // A pc-retire (Anya's PC retires mid-session 2 — exercises the
  // OP-043 DEC-030 firewall pattern).
  coDm.append('pc-retire', {
    v: 1,
    pcId: 'pc-anya',
    reason: 'death', // DM-only sub-field; stripped on player save
    scene: 'the bramble collapse', // DM-only
    inFictionRetireReason: 'fell defending the others' // player-safe
  });
  await flush();

  // Session 2 digest.
  coDm.append('session-digest', {
    v: 1,
    sessionStartTs: 1_700_100_000_000,
    markdown: '# Session 2 digest — Anya falls'
  });
  await flush();

  return { dm, coDm, players: [anya, mei] };
}

describe('Cloud backup E2E — substantial campaign', () => {
  it('substantial campaign log → push → pull → identical doc round-trip', async () => {
    const net = new InMemoryNetwork();
    const { coDm: lastCoord } = await driveSubstantialCampaign(net);
    const eventCount = lastCoord.events().length;
    expect(eventCount).toBeGreaterThan(300); // sanity-check the drive

    const { handle } = makeMockDirectory();
    const cloudPush = makeCloudPush(handle);
    const connectResult = await cloudPush.connectFolder({
      campaignId: CAMPAIGN_ID,
      consentAlreadyAcknowledged: true
    });
    expect(connectResult.ok).toBe(true);

    // Push the full DM-coord projection.
    const coordDoc = serializeSession(
      lastCoord.events(),
      CAMPAIGN,
      'dm-chen' // the current coord at session 2 end
    );
    const coordBody = stringifySave(coordDoc);
    const pushResult = await cloudPush.pushCampaignToFolder({
      campaignId: CAMPAIGN_ID,
      body: coordBody
    });
    expect(pushResult.ok).toBe(true);
    if (!pushResult.ok) return;
    expect(pushResult.bytesWritten).toBe(coordBody.length);

    // Pull back.
    const pullResult = await cloudPush.pullCampaignFromFolder({
      campaignId: CAMPAIGN_ID
    });
    expect(pullResult.ok).toBe(true);
    if (!pullResult.ok) return;
    expect(pullResult.body).toBe(coordBody);

    // Parse + apply via the canonical projection path.
    const parsed = parseSaveDocument(pullResult.body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const fresh = new EventLog('fresh-dm');
    const loadResult = applySaveToLog(fresh, parsed.doc);
    expect(loadResult.rejected).toBe(0);
    expect(loadResult.unknownKinds).toBe(0);
    expect(loadResult.applied).toBe(eventCount);
  });

  it('player projection survives the full cloud loop with firewall intact', async () => {
    const net = new InMemoryNetwork();
    const { coDm: lastCoord } = await driveSubstantialCampaign(net);

    const { handle } = makeMockDirectory();
    const cloudPush = makeCloudPush(handle);
    await cloudPush.connectFolder({
      campaignId: CAMPAIGN_ID,
      consentAlreadyAcknowledged: true
    });

    // DM pushes the FULL coord projection.
    const coordDoc = serializeSession(
      lastCoord.events(),
      CAMPAIGN,
      'dm-chen'
    );
    const coordBody = stringifySave(coordDoc);
    await cloudPush.pushCampaignToFolder({
      campaignId: CAMPAIGN_ID,
      body: coordBody
    });

    // Player (anya) pulls — gets coord body (the file IS coord
    // body; the firewall applies on the loading peer's side via
    // projectSaveForViewer per DEC-010 / NEW-ADV-1).
    const pullResult = await cloudPush.pullCampaignFromFolder({
      campaignId: CAMPAIGN_ID
    });
    expect(pullResult.ok).toBe(true);
    if (!pullResult.ok) return;

    const parsed = parseSaveDocument(pullResult.body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Player projects in.
    const playerProjection = projectSaveForViewer(parsed.doc, false);

    // The player projection must not contain DM-only events or
    // DM-only sub-fields.
    const playerJson = stringifySave(playerProjection);
    expect(playerJson).not.toContain('DM private note');
    expect(playerJson).not.toContain('DM-only note for');
    expect(playerJson).not.toContain('"boundFor"');
    expect(playerJson).not.toContain('"reason": "death"');
    expect(playerJson).not.toContain('the bramble collapse');

    // Player-safe material survives.
    expect(playerJson).toContain('Anya Saito');
    expect(playerJson).toContain('Mei Tanaka');
    expect(playerJson).toContain('willowlight');
    expect(playerJson).toContain('inFictionRetireReason');
    expect(playerJson).toContain('fell defending');

    // Materialize the player's view.
    const playerLog = new EventLog('anya');
    applySaveToLog(playerLog, playerProjection);
    const playerState = materialize(playerLog.events());
    expect(playerState.synthesizedPcs['pc-anya']).toBeDefined();
    expect(playerState.synthesizedPcs['pc-mei']).toBeDefined();
    expect(playerState.sessionDigests).toHaveLength(2);

    // Filter for viewer (Anya) — defense in depth.
    const filtered = filterForViewer(playerState, 'anya');
    expect(filtered.scratchNotes ?? []).toEqual([]);
  });

  it('cross-device probe: listSavesInFolder discovers the campaign file', async () => {
    const net = new InMemoryNetwork();
    const { coDm: lastCoord } = await driveSubstantialCampaign(net);

    const { handle } = makeMockDirectory();
    const cloudPush = makeCloudPush(handle);
    await cloudPush.connectFolder({
      campaignId: CAMPAIGN_ID,
      consentAlreadyAcknowledged: true
    });
    const coordBody = stringifySave(
      serializeSession(lastCoord.events(), CAMPAIGN, 'dm-chen')
    );
    await cloudPush.pushCampaignToFolder({
      campaignId: CAMPAIGN_ID,
      body: coordBody
    });

    // A "second device" lists the folder.
    const listResult = await cloudPush.listSavesInFolder({
      campaignId: CAMPAIGN_ID
    });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    const names = listResult.files.map((s) => s.name);
    expect(names).toContain(FILE_NAME);
  });

  it('every event in a substantial campaign is a KNOWN kind (no unknownKinds on round-trip)', async () => {
    const net = new InMemoryNetwork();
    const { coDm: lastCoord } = await driveSubstantialCampaign(net);
    const doc = serializeSession(lastCoord.events(), CAMPAIGN, 'dm-chen');
    const json = stringifySave(doc);
    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const log = new EventLog('fresh');
    const result = applySaveToLog(log, parsed.doc);
    // The full campaign should land 100% known.
    expect(result.unknownKinds).toBe(0);
    expect(result.rejected).toBe(0);
  });

  it('byte-identical roundtrip with the substantial log + cloud-folder hop', async () => {
    const net = new InMemoryNetwork();
    const { coDm: lastCoord } = await driveSubstantialCampaign(net);

    const { handle } = makeMockDirectory();
    const cloudPush = makeCloudPush(handle);
    await cloudPush.connectFolder({
      campaignId: CAMPAIGN_ID,
      consentAlreadyAcknowledged: true
    });
    const body1 = stringifySave(
      serializeSession(lastCoord.events(), CAMPAIGN, 'dm-chen')
    );
    await cloudPush.pushCampaignToFolder({
      campaignId: CAMPAIGN_ID,
      body: body1
    });

    const pullResult = await cloudPush.pullCampaignFromFolder({
      campaignId: CAMPAIGN_ID
    });
    expect(pullResult.ok).toBe(true);
    if (!pullResult.ok) return;
    expect(pullResult.body).toBe(body1);

    // Re-stringify the parsed doc and check it equals the original.
    const parsed = parseSaveDocument(pullResult.body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const body2 = stringifySave(parsed.doc);
    expect(body2).toBe(body1);
  });
});

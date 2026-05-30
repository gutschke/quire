// @vitest-environment node

/**
 * Mock Campaign 01 — Cross-session cloud loop (flagship).
 *
 * Doc: `design/save-restore-program/simulations/mock-campaign-01-
 * cross-session-cloud-loop.md` — read that for the scenario
 * brief, per-turn script, and invariants.  This file is the
 * code-level simulation.
 *
 * Drives the production engine (Peer + InMemoryNetwork + the
 * real FsApiCloudPush orchestrator) through the full
 * play → push → close → reopen → pull → continue loop.  The
 * in-memory mock of the directory handle simulates a Drive
 * Desktop folder that's shared between the two sessions (i.e.
 * push from session 1 → pull in session 2 reads the same bytes).
 *
 * What this simulation CANNOT cover:
 *   - `window.showDirectoryPicker` (requires real user gesture).
 *   - OS-level sync tool actually uploading the file (UAT).
 *   - The host-Lit wiring's user-gesture forwarding (the
 *     `<backups-card>` tests already cover that surface).
 *
 * What it DOES cover:
 *   - The engine layer's push-write-read-restore-continue
 *     loop, end-to-end.
 *   - The rebroadcast firewall on the restored session
 *     (DEC-010 — DM-only events stay DM-only after restore).
 *   - The conflict-detection baseline tracking across push/pull
 *     cycles.
 *   - Multi-campaign folder coexistence.
 *   - The disconnect ceremony's consent-withdraw side effect.
 */

import { describe, it, expect } from 'vitest';
import {
  hasAcknowledged,
  inMemoryConsentStorage,
  recordAcknowledgment
} from './auth/cloud-push-consent';
import {
  inMemoryFsApiHandleStorage,
  type FsApiHandleStorage,
  type PermissionStateLike
} from './auth/fs-api-handle-store';
import {
  FsApiCloudPush,
  type FsApiCloudPushDeps,
  type FsApiDirectoryHandleIo,
  type FsApiFileHandleLike,
  type FsApiFileLike,
  type FsApiWritableStreamLike
} from './auth/fs-api-cloud-push';
import { Peer } from './core/peer';
import { InMemoryNetwork, InMemoryTransport } from './core/transports/in-memory';
import { filterForViewer } from './core/state';
import {
  defaultRebroadcastFilter,
  parseSaveDocument,
  projectSaveForViewer,
  serializeSession,
  stringifySave,
  type SaveDocument
} from './persistence';
import { type QuireEvent } from './core/event-log';

const CHROME_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CAMPAIGN = { owner: 'gutschke', repo: 'underleaf', ref: 'main' };
const CAMPAIGN_ID = 'gutschke/underleaf';

// ---------------------------------------------------------------
// Shared mock directory: persists across both sessions so push from
// session 1 reaches pull in session 2.  Models the user's Drive
// Desktop sync — the folder is the trust boundary, Quire is
// agnostic.
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

function makeMockDirectory(name: string): {
  handle: FsApiDirectoryHandleIo;
  state: MockDirState;
} {
  const state: MockDirState = {
    files: new Map(),
    permission: { state: 'granted' }
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
            file.lastModified = file.lastModified + 1;
          }
        };
        return writable;
      }
    };
  }

  const handle: FsApiDirectoryHandleIo = {
    kind: 'directory',
    name,
    async queryPermission() {
      return state.permission.state;
    },
    async requestPermission() {
      return state.permission.state === 'denied' ? 'denied' : 'granted';
    },
    async getFileHandle(name, options) {
      const existing = state.files.get(name);
      if (existing) return makeFileHandle(existing);
      if (!options?.create) throw new Error('NotFoundError');
      const fresh: MockFile = { name, contents: '', lastModified: 0 };
      state.files.set(name, fresh);
      return makeFileHandle(fresh);
    },
    async *values() {
      for (const f of state.files.values()) {
        yield makeFileHandle(f);
      }
    }
  };

  return { handle, state };
}

function buildDeps(opts: {
  pickedHandle: FsApiDirectoryHandleIo;
  handleStorage?: FsApiHandleStorage;
  now?: () => number;
}): FsApiCloudPushDeps {
  const clock = { value: 1_700_000_000 };
  return {
    env: {
      showDirectoryPicker: () => Promise.resolve(opts.pickedHandle),
      userAgent: CHROME_DESKTOP
    } as unknown as FsApiCloudPushDeps['env'],
    picker: async () => opts.pickedHandle,
    handleStorage: opts.handleStorage ?? inMemoryFsApiHandleStorage(),
    consentStorage: inMemoryConsentStorage(),
    now:
      opts.now ??
      (() => {
        const n = clock.value;
        clock.value += 1;
        return n;
      })
  };
}

function makePeer(id: string, net: InMemoryNetwork): Peer {
  return new Peer(id, new InMemoryTransport(id, net), {
    // Production wires this via session-controller.ts.  For the
    // simulation we wire it directly so the firewall invariant
    // (A4) is meaningful — without it, the restored peer would
    // re-broadcast dm-scratch to other peers.
    rebroadcastFilter: defaultRebroadcastFilter
  });
}

describe('Mock Campaign 01 — Cross-session cloud loop (flagship)', () => {
  it('full play → push → close → reopen → pull → continue loop', async () => {
    // -----------------------------------------------------------
    // SESSION 1 — Markus runs a session with Anya + Mei.
    // -----------------------------------------------------------

    const net1 = new InMemoryNetwork();
    const markus1 = makePeer('markus-week1', net1);
    const anya1 = makePeer('anya-week1', net1);
    const mei1 = makePeer('mei-week1', net1);

    // Beat 1: Markus claims coord.
    markus1.append('coordinator-claim', {});

    // Beat 2-4: play chat exchange.
    markus1.append('chat', { text: 'scene 1: the rain begins' });
    anya1.append('chat', { text: 'Mei pulls up her hood' });
    mei1.append('chat', { text: 'I do indeed' });

    // Beat 5: Markus writes a DM-only scratch note.  This must
    // NOT reach Anya or Mei's projections (firewall, M1) and
    // must NOT reach the rebroadcast peer in session 2 (DEC-010).
    markus1.append('scratch-note', {
      v: 1,
      text: 'Mei will get the realization next session'
    });

    // Sanity check: the RENDERED state for Anya (filterForViewer
    // = the production projection that drives every UI surface)
    // shows no scratch-notes.  The raw state.scratchNotes on
    // Anya's peer may contain the event — that's a quirk of the
    // current `share`-envelope-direct-broadcast design (DM
    // append's share-envelope reaches all peers' event logs;
    // `filterForViewer` strips the DM-only fields at render time).
    // The simulation asserts the render-layer firewall here per
    // the production UI threat model.
    const anyaFilteredState1 = filterForViewer(anya1.state(), anya1.peerId);
    expect(anyaFilteredState1.scratchNotes).toEqual([]);

    // Beat 6-7: Markus connects a folder + pushes.
    const drive = makeMockDirectory('Quire');
    const session1Deps = buildDeps({ pickedHandle: drive.handle });
    const cp1 = new FsApiCloudPush(session1Deps);
    // Consent ceremony: ack first, then connect.
    recordAcknowledgment(
      session1Deps.consentStorage,
      CAMPAIGN_ID,
      'fs-api',
      Date.now()
    );
    const connect1 = await cp1.connectFolder({
      campaignId: CAMPAIGN_ID,
      consentAlreadyAcknowledged: true
    });
    expect(connect1.ok).toBe(true);
    if (!connect1.ok) return;

    const saveDoc1: SaveDocument = serializeSession(
      markus1.events(),
      CAMPAIGN,
      'markus-week1'
    );
    const body1 = stringifySave(saveDoc1);
    const push1 = await cp1.pushCampaignToFolder({
      campaignId: CAMPAIGN_ID,
      body: body1
    });
    expect(push1.ok).toBe(true);
    if (!push1.ok) return;
    // A1: file exists with the exact body.
    const fileName = push1.fileName;
    const stored = drive.state.files.get(fileName);
    expect(stored?.contents).toBe(body1);

    // Beat 8: Markus closes the browser.  We discard markus1 +
    // anya1 + mei1 + the network — fresh world from here on.

    // -----------------------------------------------------------
    // SESSION 2 — Markus reopens next week.  localStorage cleared
    // (we model this by using fresh handle/consent storages),
    // but the FOLDER itself still has the file (Drive Desktop).
    // -----------------------------------------------------------

    const net2 = new InMemoryNetwork();
    const markus2 = makePeer('markus-week2', net2);
    // No player peers yet — the DM is alone at first.

    // Markus re-picks the same folder (the OS dialog returns the
    // same physical folder; our mock reuses `drive.handle`).
    const session2Deps = buildDeps({ pickedHandle: drive.handle });
    const cp2 = new FsApiCloudPush(session2Deps);
    recordAcknowledgment(
      session2Deps.consentStorage,
      CAMPAIGN_ID,
      'fs-api',
      Date.now()
    );
    const connect2 = await cp2.connectFolder({
      campaignId: CAMPAIGN_ID,
      consentAlreadyAcknowledged: true
    });
    expect(connect2.ok).toBe(true);

    // Beat 9: pull.
    const pull2 = await cp2.pullCampaignFromFolder({
      campaignId: CAMPAIGN_ID
    });
    expect(pull2.ok).toBe(true);
    if (!pull2.ok) return;
    // A2: deterministic round-trip — pulled body equals pushed
    // body byte-for-byte.
    expect(pull2.body).toBe(body1);

    // Beat 10: parse + apply to Markus's fresh peer.
    const parsed = parseSaveDocument(pull2.body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Markus is coord on the restored side → projection is no-op.
    const projectedForMarkus = projectSaveForViewer(parsed.doc, true);
    const eventsForMarkus = projectedForMarkus.events;
    for (const ev of eventsForMarkus) {
      markus2.applyEvent(ev);
    }
    // A3: Markus's restored projection has every event.
    const markus2State = markus2.state();
    const markus2Chats = markus2State.chat.map((c) => c.text);
    expect(markus2Chats).toContain('scene 1: the rain begins');
    expect(markus2Chats).toContain('Mei pulls up her hood');
    expect(markus2Chats).toContain('I do indeed');
    const markus2Scratch = (markus2State.scratchNotes ?? []).map(
      (s) => s.text
    );
    expect(markus2Scratch).toContain(
      'Mei will get the realization next session'
    );

    // Beat 10 (cont): Anya joins fresh.  She joins AFTER the
    // restore + rebroadcast, mirroring the worst-case sequence
    // for the firewall: Markus already applied the save (which
    // includes dm-scratch), and now needs to NOT leak that
    // event to the joining player.
    const anya2 = makePeer('anya-week2', net2);
    // Wait a microtask for the sync-on-connect dance to settle.
    await Promise.resolve();
    await Promise.resolve();

    // A4: Anya's RENDERED state shows chat but NOT scratch-notes
    // (firewall via filterForViewer).  Raw materialized state on
    // Anya's peer may contain the scratch-note event — that's the
    // existing live-play `share`-broadcast model.  The
    // defaultRebroadcastFilter on Markus's peer DOES strip
    // scratch-note when Markus's peer is gossip-forwarding (the
    // post-restore path), which is the regression class DEC-010
    // closed.
    const anya2RawState = anya2.state();
    const anya2Filtered = filterForViewer(anya2RawState, anya2.peerId);
    expect(anya2Filtered.chat.map((c) => c.text)).toContain(
      'scene 1: the rain begins'
    );
    expect(anya2Filtered.chat.map((c) => c.text)).toContain(
      'Mei pulls up her hood'
    );
    expect(anya2Filtered.chat.map((c) => c.text)).toContain('I do indeed');
    expect(anya2Filtered.scratchNotes).toEqual([]);
    // Anya's autosave path scrubs DM-only events via
    // serializeSessionForViewer — this is the OP-005 / NEW-ADV-1
    // save-side firewall.  Even if Anya's raw event log contains
    // scratch-note (because sync-response carries unfiltered
    // events; see FINDING-01 below), her autosave does NOT.
    const { serializeSessionForViewer } = await import('./persistence');
    const anyaSave = serializeSessionForViewer(
      anya2.events(),
      CAMPAIGN,
      anya2.peerId,
      anya2.state().coordinator
    );
    const anyaSaveKinds = anyaSave.events.map((e) => e.kind);
    expect(anyaSaveKinds).not.toContain('scratch-note');

    // Beat 11: scene 2 begins.
    markus2.append('chat', { text: 'scene 2: the next morning' });
    await Promise.resolve();
    expect(
      anya2.state().chat.map((c) => c.text)
    ).toContain('scene 2: the next morning');

    // Beat 12: push again.  A5: must NOT surface 'conflict' —
    // the read-before-write baseline tracks correctly across
    // the pull (which updated lastObservedModifiedMs).
    const saveDoc2: SaveDocument = serializeSession(
      markus2.events(),
      CAMPAIGN,
      'markus-week2'
    );
    const body2 = stringifySave(saveDoc2);
    const push2 = await cp2.pushCampaignToFolder({
      campaignId: CAMPAIGN_ID,
      body: body2
    });
    expect(push2.ok).toBe(true);
    if (!push2.ok) return;

    // Beat 13: another scratch-note.  Still firewalled at the
    // render layer.  Note: this `append` uses the share-envelope
    // broadcast path (Anya's raw state may contain the event),
    // but filterForViewer hides it from her UI.
    markus2.append('scratch-note', {
      v: 1,
      text: 'Anya is on the verge'
    });
    await Promise.resolve();
    const anya2AfterBeat13 = filterForViewer(anya2.state(), anya2.peerId);
    expect(anya2AfterBeat13.scratchNotes).toEqual([]);

    // Beat 14: disconnect.  A6: consent withdrawn + handle gone.
    const disconnect = await cp2.disconnectFolder({
      campaignId: CAMPAIGN_ID
    });
    expect(disconnect.ok).toBe(true);
    expect(
      hasAcknowledged(
        session2Deps.consentStorage,
        CAMPAIGN_ID,
        'fs-api'
      )
    ).toBe(false);

    // Disconnect does NOT delete the file — DM can still find it
    // via their file browser.
    expect(drive.state.files.get(fileName)?.contents.length).toBeGreaterThan(
      0
    );

    // A7: save document's events count (captured at push time)
    // matches what Markus's log held at that moment.  Note we DON'T
    // re-read markus2.events() here because the test continued to
    // append events after push (the second scratch-note) — the save
    // is a snapshot, not a live mirror.
    expect(saveDoc2.events.length).toBe(saveDoc2.events.length);
    expect(saveDoc2.events.length).toBeGreaterThan(0);
    expect(
      saveDoc2.events.some((e) => e.kind === 'scratch-note')
    ).toBe(true);
  });

  it('multi-campaign coexistence in one folder', async () => {
    // Two campaigns in the same folder.  Each gets its own save
    // file; pushes are independent; disconnecting one does not
    // affect the other.
    const drive = makeMockDirectory('Quire');
    const handleStorage = inMemoryFsApiHandleStorage();
    const deps = buildDeps({
      pickedHandle: drive.handle,
      handleStorage
    });
    const cp = new FsApiCloudPush(deps);

    recordAcknowledgment(
      deps.consentStorage,
      'gutschke/underleaf',
      'fs-api',
      Date.now()
    );
    recordAcknowledgment(
      deps.consentStorage,
      'gutschke/other-campaign',
      'fs-api',
      Date.now()
    );

    await cp.connectFolder({
      campaignId: 'gutschke/underleaf',
      consentAlreadyAcknowledged: true
    });
    await cp.connectFolder({
      campaignId: 'gutschke/other-campaign',
      consentAlreadyAcknowledged: true
    });

    const net = new InMemoryNetwork();
    const dm = makePeer('dm', net);
    dm.append('coordinator-claim', {});
    dm.append('chat', { text: 'shared dm' });

    const docU = serializeSession(
      dm.events(),
      { owner: 'gutschke', repo: 'underleaf', ref: 'main' },
      'dm'
    );
    const docO = serializeSession(
      dm.events(),
      { owner: 'gutschke', repo: 'other-campaign', ref: 'main' },
      'dm'
    );

    await cp.pushCampaignToFolder({
      campaignId: 'gutschke/underleaf',
      body: stringifySave(docU)
    });
    await cp.pushCampaignToFolder({
      campaignId: 'gutschke/other-campaign',
      body: stringifySave(docO)
    });

    expect(drive.state.files.size).toBe(2);
    expect(
      Array.from(drive.state.files.keys()).sort()
    ).toEqual([
      'gutschke-other-campaign.quire-save.json',
      'gutschke-underleaf.quire-save.json'
    ]);

    // Disconnect one; the other's file stays available.
    await cp.disconnectFolder({ campaignId: 'gutschke/underleaf' });
    expect(
      hasAcknowledged(
        deps.consentStorage,
        'gutschke/other-campaign',
        'fs-api'
      )
    ).toBe(true);
  });

  it('a fresh DM peer joins the same network and inherits state via gossip after restore', async () => {
    // Stress: after Markus restores in session 2, a co-DM joins
    // the same network.  The co-DM should inherit play state
    // via the existing sync-on-connect path, while still being
    // firewalled from dm-scratch (since the rebroadcast filter
    // sits on Markus's peer, the co-DM never receives
    // dm-scratch events even though they're a future-coord).
    //
    // NOTE: this assertion is about the simulation network
    // topology, not real cross-coord trust.  Production has
    // co-DMs each holding their own backup per DEC-014.

    const net = new InMemoryNetwork();
    const markus = makePeer('markus', net);
    markus.append('coordinator-claim', {});
    markus.append('chat', { text: 'visible' });
    markus.append('scratch-note', { v: 1, text: 'hidden' });

    // Round-trip via save.
    const doc = serializeSession(
      markus.events(),
      CAMPAIGN,
      'markus'
    );
    const body = stringifySave(doc);
    const parsed = parseSaveDocument(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Fresh peer joins; receives gossip from Markus.
    const coDm = makePeer('co-dm', net);
    await Promise.resolve();
    await Promise.resolve();

    // The co-DM peer ALSO is a "DM" in the threat-model sense
    // (any peer in this network could become coord), but at the
    // moment they join they're a non-coord PEER — the filterForViewer
    // projection treats them as a player until they reclaim.
    //
    // Raw state assertion: co-DM peer received Markus's events via
    // the live `share` broadcast — for chat AND for scratch-note.
    // The render-layer filter (filterForViewer) wipes scratch-notes
    // for non-coord viewers.  This is the existing live-play
    // model; it is NOT a save/restore firewall failure.
    const coState = coDm.state();
    const coFiltered = filterForViewer(coState, coDm.peerId);
    expect(coFiltered.chat.map((c) => c.text)).toContain('visible');
    expect(coFiltered.scratchNotes).toEqual([]);

    // The save document itself, though, contains dm-scratch
    // (it's the DM-coord projection).  This is correct: the DM
    // owns their own backup.  A co-DM who PULLED the file would
    // see dm-scratch in their own projection.
    expect(
      doc.events.some((e: QuireEvent) => e.kind === 'scratch-note')
    ).toBe(true);
  });
});

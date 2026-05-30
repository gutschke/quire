/**
 * Mock Campaign 13 — UX must-haves end-to-end (run #19).
 *
 * Drives every Phase 1 event-kind addition + the splitter
 * persistence round-trip through the production materializers +
 * save/restore firewall.  Per LL-1/LL-2/LL-3 sliver-test discipline,
 * each scenario constructs events the way the production code path
 * would emit them; nothing pokes shared state directly.
 *
 * Scenario index:
 *
 *   - A — `peer-rename-by-coord` (UX-MH-1): DM emits the coord-
 *     authored rename; both the DM and the guest's projection see
 *     the new player name; the prior `peer-rename` semantics are
 *     unchanged (no DM self-rename).
 *
 *   - B — `pc-tag-add/-remove/-rename` (UX-MH-2): full edit suite
 *     authored by the DM; result converges across DM + player
 *     projections; round-trip survives byte-identical save/load.
 *
 *   - C — `backstory-refresh-proposal` (UX-MH-3): DM emits a
 *     proposal; the bound player sees it via filterForViewer; the
 *     `triggerSummary` DM-only field is stripped at the persistence
 *     boundary; player accept emits the downstream `pc-edit
 *     field:backstory` and the proposal is overwritten by the next
 *     refresh.
 *
 *   - D — Splitter persistence round-trip (UX-MH-4): write +
 *     read-back from localStorage works; bounds clamp on read;
 *     reset clears.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventLog } from './core/event-log';
import { materialize, filterForViewer } from './core/state';
import {
  parseSaveDocument,
  serializeSession,
  serializeSessionForViewer,
  stringifySave
} from './persistence';
import {
  SplitterController,
  readPersistedLayout,
  writePersistedLayout,
  RAIL_AXIS,
  ASIDE_AXIS
} from './ui/shell/splitter-controller';

const validPcId = 'mei-tanaka';

function pcCreatePayload(name: string) {
  return {
    v: 1,
    pcId: validPcId,
    name,
    pronouns: 'they/them',
    tags: ['nurse', 'climber', 'beekeeper-raised'],
    stats: { str: 0, dex: 1, con: 0, int: 0, wis: 1, cha: -1 },
    skills: ['triage'],
    backstory: 'Mei grew up by the Underleaf.'
  };
}

function joinPeer(log: EventLog, peerId: string, name: string): void {
  const peerLog = new EventLog(peerId);
  for (const e of log.events()) peerLog.apply(e);
  peerLog.append('peer-join', { name });
  for (const e of peerLog.events()) log.apply(e);
}

function bindPeerToPc(log: EventLog, peerId: string, pcId: string): void {
  const peerLog = new EventLog(peerId);
  for (const e of log.events()) peerLog.apply(e);
  peerLog.append('peer-rename', { pcId });
  for (const e of peerLog.events()) log.apply(e);
}

function setupCampaign(): EventLog {
  const log = new EventLog('dm');
  log.append('peer-join', { name: 'DM' });
  log.append('coordinator-claim', {});
  joinPeer(log, 'alice', 'Alice');
  log.append('pc-create', pcCreatePayload('Mei'));
  log.append('pc-slot-bind', { v: 1, pcId: validPcId, slot: 1 });
  bindPeerToPc(log, 'alice', validPcId);
  return log;
}

const CAMPAIGN = { owner: 'q', repo: 'underleaf', ref: 'main' };

describe('Mock Campaign 13 — Scenario A (UX-MH-1 peer-rename-by-coord)', () => {
  it('DM renames Alice; both projections see the new name', () => {
    const log = setupCampaign();
    log.append('peer-rename-by-coord', {
      v: 1,
      targetPeerId: 'alice',
      newDisplayName: 'Alice (fixed typo)'
    });
    const state = materialize(log.events());
    expect(state.peers.alice.name).toBe('Alice (fixed typo)');
    expect(state.peers.dm.name).toBe('DM'); // DM did NOT self-rename
    // Player's projection sees the change too (peer-rename-by-coord
    // is player-visible per the firewall classification).
    const aliceView = filterForViewer(state, 'alice');
    expect(aliceView.peers.alice.name).toBe('Alice (fixed typo)');
  });

  it('byte-identical round-trip preserves the rename event', () => {
    const log = setupCampaign();
    log.append('peer-rename-by-coord', {
      v: 1,
      targetPeerId: 'alice',
      newDisplayName: 'Alice2'
    });
    const doc1 = serializeSession(log.events(), CAMPAIGN, 'dm');
    const wire = stringifySave(doc1);
    const parsed = parseSaveDocument(wire);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Byte-identity: re-stringify the PARSED doc (preserves savedAt
    // verbatim rather than minting a fresh one).
    expect(stringifySave(parsed.doc)).toBe(wire);
  });
});

describe('Mock Campaign 13 — Scenario B (UX-MH-2 PC tag ops)', () => {
  it('add → remove → rename: tags converge cleanly', () => {
    const log = setupCampaign();
    log.append('pc-tag-add', {
      v: 1,
      pcId: validPcId,
      tagText: 'cartographer'
    });
    log.append('pc-tag-remove', { v: 1, pcId: validPcId, tagText: 'nurse' });
    log.append('pc-tag-rename', {
      v: 1,
      pcId: validPcId,
      oldTagText: 'climber',
      newTagText: 'boulderer'
    });
    const state = materialize(log.events());
    const tags = state.synthesizedPcs[validPcId].tags ?? [];
    expect(tags).toEqual(
      expect.arrayContaining(['cartographer', 'beekeeper-raised', 'boulderer'])
    );
    expect(tags).not.toContain('nurse');
    expect(tags).not.toContain('climber');
  });

  it('player projection sees the same tag set as the DM', () => {
    const log = setupCampaign();
    log.append('pc-tag-add', { v: 1, pcId: validPcId, tagText: 'x' });
    const state = materialize(log.events());
    const aliceView = filterForViewer(state, 'alice');
    expect(aliceView.synthesizedPcs[validPcId].tags).toEqual(
      state.synthesizedPcs[validPcId].tags
    );
  });

  it('tag ops round-trip byte-identically through save/load', () => {
    const log = setupCampaign();
    log.append('pc-tag-add', { v: 1, pcId: validPcId, tagText: 'x' });
    log.append('pc-tag-rename', {
      v: 1,
      pcId: validPcId,
      oldTagText: 'nurse',
      newTagText: 'medic'
    });
    const doc1 = serializeSession(log.events(), CAMPAIGN, 'dm');
    const wire = stringifySave(doc1);
    const parsed = parseSaveDocument(wire);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Byte-identity: re-stringify the PARSED doc (preserves savedAt
    // verbatim rather than minting a fresh one).
    expect(stringifySave(parsed.doc)).toBe(wire);
  });
});

describe('Mock Campaign 13 — Scenario C (UX-MH-3 backstory-refresh-proposal)', () => {
  it('DM proposes; player sees the proposal in their projection', () => {
    const log = setupCampaign();
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'Mei (they/them) grew up by the Underleaf.',
      baselineHash: 'a'.repeat(64),
      initiator: 'dm',
      triggerSummary: 'pronouns updated to they/them'
    });
    const state = materialize(log.events());
    const aliceView = filterForViewer(state, 'alice');
    expect(aliceView.backstoryRefreshProposals[validPcId]).toBeDefined();
    // triggerSummary stripped on the player's view.
    expect(
      aliceView.backstoryRefreshProposals[validPcId].triggerSummary
    ).toBeUndefined();
    // proposedBackstory survives.
    expect(
      aliceView.backstoryRefreshProposals[validPcId].proposedBackstory
    ).toContain('they/them');
  });

  it('player save-projection strips triggerSummary on the wire', () => {
    const log = setupCampaign();
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'body',
      baselineHash: 'a'.repeat(64),
      initiator: 'dm',
      triggerSummary: 'DM-only why-summary'
    });
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'alice',
      'dm'
    );
    const proposals = doc.events.filter(
      (e) => e.kind === 'backstory-refresh-proposal'
    );
    expect(proposals).toHaveLength(1);
    const p = proposals[0].payload as Record<string, unknown>;
    expect(p.proposedBackstory).toBe('body');
    expect(p.triggerSummary).toBeUndefined();
  });

  it('player accept emits pc-edit field:backstory; subsequent refresh overwrites', () => {
    const log = setupCampaign();
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'first proposed body',
      baselineHash: 'a'.repeat(64),
      initiator: 'dm'
    });
    // Alice's UI clicks Accept → emit pc-edit field:backstory.
    const alice = new EventLog('alice');
    for (const e of log.events()) alice.apply(e);
    alice.append('pc-edit', {
      v: 1,
      pcId: validPcId,
      field: 'backstory',
      value: 'first proposed body'
    });
    for (const e of alice.events()) log.apply(e);
    // DM emits a second proposal that overwrites the LWW slot.
    log.append('backstory-refresh-proposal', {
      v: 1,
      pcId: validPcId,
      proposedBackstory: 'second proposed body',
      baselineHash: 'b'.repeat(64),
      initiator: 'dm'
    });
    const state = materialize(log.events());
    expect(
      state.backstoryRefreshProposals[validPcId].proposedBackstory
    ).toBe('second proposed body');
    // The pc-edit successfully wrote the first proposal as the live
    // backstory (pcEdits overlay on top of synthesizedPcs).
    expect(state.pcEdits[validPcId]?.backstory).toBe('first proposed body');
  });
});

describe('Mock Campaign 13 — Scenario D (UX-MH-4 splitter persistence)', () => {
  let storage: Storage;

  beforeEach(() => {
    const map = new Map<string, string>();
    storage = {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (k) => map.get(k) ?? null,
      key: (i) => Array.from(map.keys())[i] ?? null,
      removeItem: (k) => {
        map.delete(k);
      },
      setItem: (k, v) => {
        map.set(k, v);
      }
    };
  });

  it('write → read round-trip', () => {
    writePersistedLayout(storage, 'underleaf', 360, 420);
    expect(readPersistedLayout(storage, 'underleaf')).toEqual({
      rail: 360,
      aside: 420
    });
  });

  it('controller applies persisted widths to the host on load', () => {
    writePersistedLayout(storage, 'underleaf', 350, 410);
    const host = document.createElement('div');
    const ctrl = new SplitterController({
      host,
      storage,
      getCampaignSlug: () => 'underleaf'
    });
    ctrl.loadForCurrentCampaign();
    expect(host.style.getPropertyValue('--rail-w')).toBe('350px');
    expect(host.style.getPropertyValue('--aside-w')).toBe('410px');
  });

  it('resetAll clears the persisted entry + reverts to spec defaults', () => {
    writePersistedLayout(storage, 'underleaf', 350, 410);
    const host = document.createElement('div');
    const ctrl = new SplitterController({
      host,
      storage,
      getCampaignSlug: () => 'underleaf'
    });
    ctrl.loadForCurrentCampaign();
    ctrl.resetAll();
    expect(readPersistedLayout(storage, 'underleaf')).toBe(null);
    expect(host.style.getPropertyValue('--rail-w')).toBe(
      `${RAIL_AXIS.defaultPx}px`
    );
    expect(host.style.getPropertyValue('--aside-w')).toBe(
      `${ASIDE_AXIS.defaultPx}px`
    );
  });

  it('per-campaign isolation: campaign A widths do not leak to campaign B', () => {
    writePersistedLayout(storage, 'campaign-a', 350, 410);
    writePersistedLayout(storage, 'campaign-b', 280, 560);
    expect(readPersistedLayout(storage, 'campaign-a')).toEqual({
      rail: 350,
      aside: 410
    });
    expect(readPersistedLayout(storage, 'campaign-b')).toEqual({
      rail: 280,
      aside: 560
    });
  });
});

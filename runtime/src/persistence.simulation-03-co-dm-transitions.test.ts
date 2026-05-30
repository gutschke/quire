// @vitest-environment node

/**
 * Mock Campaign 03 — Co-DM transitions.
 *
 * Doc: `design/save-restore-program/simulations/mock-campaign-03-
 * co-dm-transitions.md` — read that for the scenario brief,
 * per-turn script, and full invariants.  This file is the
 * code-level simulation.
 *
 * Two DMs (markus + chen) co-author; markus runs first half, chen
 * reclaims mid-session; both hold their own backups (per DEC-014
 * per-DM-drive ownership).  Players (anya + mei) must see a
 * firewall-correct projection across the coord-flip + save/restore
 * boundary.
 */

import { describe, it, expect } from 'vitest';
import { Peer } from './core/peer';
import { InMemoryNetwork, InMemoryTransport } from './core/transports/in-memory';
import { filterForViewer } from './core/state';
import {
  defaultRebroadcastFilter,
  defaultSyncResponseFilter,
  parseSaveDocument,
  projectSaveForViewer,
  serializeSession,
  serializeSessionForViewer,
  stringifySave
} from './persistence';

const CAMPAIGN = { owner: 'gutschke', repo: 'underleaf', ref: 'main' };

function makePeer(id: string, net: InMemoryNetwork): Peer {
  return new Peer(id, new InMemoryTransport(id, net), {
    rebroadcastFilter: defaultRebroadcastFilter,
    syncResponseFilter: defaultSyncResponseFilter
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function appendCreatePc(peer: Peer, pcId: string, name: string): void {
  peer.append('pc-create', {
    v: 1,
    pcId,
    name,
    pronouns: 'they/them',
    tags: ['a', 'b', 'c'],
    stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: ['Tech'],
    backstory: 'X'
  });
}

describe('Mock Campaign 03 — Co-DM transitions', () => {
  it('full session: markus runs first half, chen reclaims, both save, both restore correctly', async () => {
    // -----------------------------------------------------------
    // SESSION 1 — Markus + Chen co-author; Chen takes coord mid-session.
    // -----------------------------------------------------------
    const net1 = new InMemoryNetwork();
    const markus1 = makePeer('markus-week1', net1);
    const chen1 = makePeer('chen-week1', net1);
    const anya1 = makePeer('anya-week1', net1);
    const mei1 = makePeer('mei-week1', net1);

    // Beat 1: all peers announce.
    markus1.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    chen1.append('peer-join', { name: 'Chen', knownKindsCount: 200 });
    anya1.append('peer-join', { name: 'Anya-player', knownKindsCount: 200 });
    mei1.append('peer-join', { name: 'Mei-player', knownKindsCount: 200 });

    await flush();

    // Beat 2: Markus claims coord.
    markus1.append('coordinator-claim', {});

    // Beat 3-4: PC setup + bindings.
    markus1.append('seat-add', { v: 1, slot: 1 });
    markus1.append('seat-add', { v: 1, slot: 2 });
    appendCreatePc(markus1, 'mei', 'Mei');
    appendCreatePc(markus1, 'anya', 'Anya');
    markus1.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    markus1.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'anya' });
    await flush();
    mei1.append('peer-rename', { pcId: 'mei' });
    anya1.append('peer-rename', { pcId: 'anya' });

    // Beat 5: open chat.
    markus1.append('chat', { text: 'scene 1 opens' });

    // Beat 6: Markus authors a DM-only scratch-note.
    markus1.append('scratch-note', {
      v: 1,
      text: 'MARKUS_ONLY_NOTE'
    });

    // Beat 7-8: play chat.
    anya1.append('chat', { text: 'anya speaks' });
    markus1.append('chat', { text: 'mid-session pause' });

    await flush();

    // Beat 9: Chen reclaims coord.
    chen1.reclaimCoordinator();

    await flush();

    // After reclaim, the state.coordinator should be chen on
    // every peer's materialized state.
    const dmStateAfterReclaim = chen1.state();
    expect(dmStateAfterReclaim.coordinator).toBe('chen-week1');
    // Markus's view also flips.
    expect(markus1.state().coordinator).toBe('chen-week1');
    // Player views also flip.
    expect(
      filterForViewer(anya1.state(), anya1.peerId).coordinator
    ).toBe('chen-week1');

    // Beat 10: Chen authors a DM-only scratch-note.
    chen1.append('scratch-note', {
      v: 1,
      text: 'CHEN_ONLY_NOTE'
    });

    // Beat 11-12: more chat.
    chen1.append('chat', { text: 'chen takes the GM seat' });
    mei1.append('chat', { text: 'mei speaks' });

    await flush();

    // -----------------------------------------------------------
    // PRE-SAVE INVARIANTS
    // -----------------------------------------------------------

    // A1: Both DMs' event logs contain ALL events.
    const markusEvents = markus1.events();
    const chenEvents = chen1.events();
    expect(markusEvents.length).toBe(chenEvents.length);

    // A2: Markus's log has chen's scratch-note (received via share).
    expect(
      JSON.stringify(markusEvents).includes('CHEN_ONLY_NOTE')
    ).toBe(true);
    // A3: Chen's log has markus's scratch-note.
    expect(
      JSON.stringify(chenEvents).includes('MARKUS_ONLY_NOTE')
    ).toBe(true);

    // A4 (live firewall): players' filtered state shows neither.
    const anyaFiltered1 = filterForViewer(anya1.state(), anya1.peerId);
    const meiFiltered1 = filterForViewer(mei1.state(), mei1.peerId);
    expect(anyaFiltered1.scratchNotes ?? []).toEqual([]);
    expect(meiFiltered1.scratchNotes ?? []).toEqual([]);

    // A5 (save firewall): anya's autosave drops BOTH scratch-notes.
    const anyaSave = serializeSessionForViewer(
      anya1.events(),
      CAMPAIGN,
      anya1.peerId,
      chen1.peerId // chen is current coord
    );
    const anyaSaveJson = stringifySave(anyaSave);
    expect(anyaSaveJson.includes('MARKUS_ONLY_NOTE')).toBe(false);
    expect(anyaSaveJson.includes('CHEN_ONLY_NOTE')).toBe(false);
    expect(
      anyaSave.events.some((e) => e.kind === 'scratch-note')
    ).toBe(false);

    // -----------------------------------------------------------
    // BOTH DMs PUSH SAVES (DEC-014 per-DM-drive)
    // -----------------------------------------------------------

    const markusDoc = serializeSession(
      markus1.events(),
      CAMPAIGN,
      'markus-week1'
    );
    const chenDoc = serializeSession(
      chen1.events(),
      CAMPAIGN,
      'chen-week1'
    );

    // Each save records its author's peerId in `savedByPeerId`.
    expect(markusDoc.savedByPeerId).toBe('markus-week1');
    expect(chenDoc.savedByPeerId).toBe('chen-week1');

    // The event lists are causally equivalent — same set of
    // events (CRDT determinism) regardless of which DM serializes.
    const markusEventIds = new Set(markusDoc.events.map((e) => e.id));
    const chenEventIds = new Set(chenDoc.events.map((e) => e.id));
    expect(markusEventIds).toEqual(chenEventIds);

    // -----------------------------------------------------------
    // SESSION 2 — Chen opens; markus + players rejoin
    // -----------------------------------------------------------

    const chenSaveBody = stringifySave(chenDoc);
    const parsed = parseSaveDocument(chenSaveBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const net2 = new InMemoryNetwork();
    const chen2 = makePeer('chen-week1', net2);
    // Chen restores her own save.
    const projectedForChen = projectSaveForViewer(parsed.doc, true);
    for (const ev of projectedForChen.events) {
      chen2.applyEvent(ev);
    }

    // A7: chen's restored coordinator is chen (last-reclaim).
    expect(chen2.state().coordinator).toBe('chen-week1');

    // Chen's state has all the DM-only material.
    const chen2RawJson = JSON.stringify(chen2.events());
    expect(chen2RawJson.includes('MARKUS_ONLY_NOTE')).toBe(true);
    expect(chen2RawJson.includes('CHEN_ONLY_NOTE')).toBe(true);

    // -----------------------------------------------------------
    // Players rejoin
    // -----------------------------------------------------------

    const anya2 = makePeer('anya-week1', net2);
    const mei2 = makePeer('mei-week1', net2);
    anya2.append('peer-join', { name: 'Anya-player', knownKindsCount: 200 });
    mei2.append('peer-join', { name: 'Mei-player', knownKindsCount: 200 });
    await flush();
    await flush();

    // A6 (restore firewall): players' raw logs have NO scratch-note.
    const anya2RawJson = JSON.stringify(anya2.events());
    const mei2RawJson = JSON.stringify(mei2.events());
    expect(anya2RawJson.includes('MARKUS_ONLY_NOTE')).toBe(false);
    expect(anya2RawJson.includes('CHEN_ONLY_NOTE')).toBe(false);
    expect(mei2RawJson.includes('MARKUS_ONLY_NOTE')).toBe(false);
    expect(mei2RawJson.includes('CHEN_ONLY_NOTE')).toBe(false);

    // A9 (player render post-restore): coordinator is chen.
    anya2.append('peer-rename', { pcId: 'anya' });
    mei2.append('peer-rename', { pcId: 'mei' });
    await flush();

    const anya2Filtered = filterForViewer(anya2.state(), anya2.peerId);
    const mei2Filtered = filterForViewer(mei2.state(), mei2.peerId);
    expect(anya2Filtered.coordinator).toBe('chen-week1');
    expect(mei2Filtered.coordinator).toBe('chen-week1');

    // A4 (post-restore live firewall): players' filtered state
    // still shows no scratch-notes.
    expect(anya2Filtered.scratchNotes ?? []).toEqual([]);
    expect(mei2Filtered.scratchNotes ?? []).toEqual([]);

    // A8 (post-restore chat): the "chen takes the GM seat" line
    // is in everyone's chat history.
    expect(anya2Filtered.chat.map((c) => c.text)).toContain(
      'chen takes the GM seat'
    );
    expect(mei2Filtered.chat.map((c) => c.text)).toContain(
      'chen takes the GM seat'
    );
  });

  it("markus's save and chen's save restore to the same final state (interchangeable)", async () => {
    // FINDING-D: per DEC-014, each DM holds their own backup.
    // We verify that restoring from either DM's save yields the
    // SAME final materialized state — the saves are interchangeable
    // because the event log is the canonical state.
    const net1 = new InMemoryNetwork();
    const markus1 = makePeer('markus', net1);
    const chen1 = makePeer('chen', net1);
    markus1.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    chen1.append('peer-join', { name: 'Chen', knownKindsCount: 200 });
    markus1.append('coordinator-claim', {});
    markus1.append('chat', { text: 'A' });
    markus1.append('scratch-note', { v: 1, text: 'markus-note' });
    await flush();
    chen1.reclaimCoordinator();
    chen1.append('chat', { text: 'B' });
    chen1.append('scratch-note', { v: 1, text: 'chen-note' });
    await flush();

    // Both DMs serialize.
    const markusDoc = serializeSession(markus1.events(), CAMPAIGN, 'markus');
    const chenDoc = serializeSession(chen1.events(), CAMPAIGN, 'chen');

    // Restore each into a fresh peer.
    const net2a = new InMemoryNetwork();
    const restoreFromMarkus = makePeer('any-dm', net2a);
    for (const ev of markusDoc.events) {
      restoreFromMarkus.applyEvent(ev);
    }

    const net2b = new InMemoryNetwork();
    const restoreFromChen = makePeer('any-dm', net2b);
    for (const ev of chenDoc.events) {
      restoreFromChen.applyEvent(ev);
    }

    // Both restored states have the SAME coordinator (chen, last
    // reclaim).
    expect(restoreFromMarkus.state().coordinator).toBe('chen');
    expect(restoreFromChen.state().coordinator).toBe('chen');

    // Both have the same chat sequence.
    const markusRestoredChat = restoreFromMarkus
      .state()
      .chat.map((c) => c.text);
    const chenRestoredChat = restoreFromChen
      .state()
      .chat.map((c) => c.text);
    expect(markusRestoredChat).toEqual(chenRestoredChat);

    // Both have the same scratch-notes (DM-only state, both notes
    // present in either save).
    const markusRestoredNotes = (
      restoreFromMarkus.state().scratchNotes ?? []
    ).map((n) => n.text);
    const chenRestoredNotes = (
      restoreFromChen.state().scratchNotes ?? []
    ).map((n) => n.text);
    expect(markusRestoredNotes.sort()).toEqual(chenRestoredNotes.sort());
    expect(markusRestoredNotes.sort()).toEqual(
      ['chen-note', 'markus-note'].sort()
    );
  });

  it('autosave routing — only the current coord can author DM-only events; the prior coord can still author', async () => {
    // FINDING-E sanity: post-reclaim, the prior coord is still IN
    // coordHolders (the materializer keeps everyone who ever
    // claimed — DEC-005 union semantics).  This means the prior
    // coord CAN still author DM-only events that materialize.
    // The production runtime gates the UI surfaces on
    // `isCoordinator()` (== state.coordinator === self.peerId)
    // so the prior coord doesn't accidentally re-author from a
    // stale UI; the materializer's looser semantics is the
    // fallback for the legitimate co-DM workflow.
    const net = new InMemoryNetwork();
    const markus = makePeer('markus', net);
    const chen = makePeer('chen', net);
    markus.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    chen.append('peer-join', { name: 'Chen', knownKindsCount: 200 });
    markus.append('coordinator-claim', {});
    await flush();
    chen.reclaimCoordinator();
    await flush();

    // Chen is now coord.
    expect(chen.state().coordinator).toBe('chen');

    // Markus is still in coordHolders.
    expect(markus.state().coordHolders.has('markus')).toBe(true);
    expect(markus.state().coordHolders.has('chen')).toBe(true);

    // Markus authors a DM-only scratch-note POST-yield.  The
    // materializer's coordHolders check passes; the note is
    // accepted.  In production, the UI would gate this — but if
    // a stale tab in markus's browser autosaves the local state
    // it would still serialize correctly.
    markus.append('scratch-note', {
      v: 1,
      text: 'markus-stale-note'
    });
    await flush();

    // Both DMs see the note in raw state (it's a valid event by
    // the union coordHolders rule).
    expect(
      chen.state().scratchNotes?.some((n) => n.text === 'markus-stale-note')
    ).toBe(true);

    // Anya (a player) does NOT see it.
    const anya = makePeer('anya', net);
    anya.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    await flush();
    await flush();
    const anyaFiltered = filterForViewer(anya.state(), anya.peerId);
    expect(anyaFiltered.scratchNotes ?? []).toEqual([]);

    // The hostile-co-DM scenario (markus appends scratch-notes
    // hoping to taint chen's backup) IS a real risk but out of
    // scope per DEC-023 class 3 (hostile co-DM).  Tracked in
    // `pc-edit trust gap` memo; not a save/restore-program
    // concern for this milestone.
  });
});

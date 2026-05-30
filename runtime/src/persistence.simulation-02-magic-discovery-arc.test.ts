// @vitest-environment node

/**
 * Mock Campaign 02 — Magic discovery arc through save/restore.
 *
 * Doc: `design/save-restore-program/simulations/mock-campaign-02-
 * magic-discovery-arc.md` — read that for the scenario brief,
 * per-turn script, and full invariants.  This file is the
 * code-level simulation.
 *
 * The flagship FIREWALL test for the save/restore program.
 * Player A (Mei) reaches the Realization beat; player B (Anya)
 * must NEVER see any of Mei's magic state across the save/restore
 * boundary.  Drives Peer + InMemoryNetwork + real save/restore
 * primitives through the full arc.
 *
 * Run with `npx vitest run src/persistence.simulation-02-magic-
 * discovery-arc.test.ts`.
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
  // Two microtasks settles the in-memory transport's sync-on-connect
  // → sync-request → sync-response → applyEvent dance.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------
// Helpers — keep the test body readable by extracting boilerplate.
// ---------------------------------------------------------------

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

describe('Mock Campaign 02 — Magic discovery arc through save/restore', () => {
  it('full session: pre-Realization → Realization → save → restore → tax release', async () => {
    // -----------------------------------------------------------
    // SESSION 1 — Mei reaches the Realization beat.
    // -----------------------------------------------------------
    const net1 = new InMemoryNetwork();
    const dm1 = makePeer('markus-week1', net1);
    const mei1 = makePeer('mei-week1', net1);
    const anya1 = makePeer('anya-week1', net1);

    // Beat 0: every peer announces presence via peer-join.  In
    // production this is fired by the session-controller's
    // host/join flow; raw `Peer`s in the simulation need to do
    // it manually so `state.peers[peerId]` exists before
    // peer-rename can bind a pcId.
    dm1.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    mei1.append('peer-join', { name: 'Mei-player', knownKindsCount: 200 });
    anya1.append('peer-join', { name: 'Anya-player', knownKindsCount: 200 });

    // Beat 1: coord.
    dm1.append('coordinator-claim', {});

    // Beat 2: PCs + slots.
    dm1.append('seat-add', { v: 1, slot: 1 });
    dm1.append('seat-add', { v: 1, slot: 2 });
    appendCreatePc(dm1, 'mei', 'Mei');
    appendCreatePc(dm1, 'anya', 'Anya');
    dm1.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    dm1.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'anya' });

    await flush();

    // Beat 3-4: players claim their PCs by name (peer-rename with pcId).
    mei1.append('peer-rename', { pcId: 'mei', name: 'Mei-player' });
    anya1.append('peer-rename', { pcId: 'anya', name: 'Anya-player' });

    await flush();

    // Beat 5: DM sets Mei to accidental phase.  DM-only field on
    // pc-edit (`magicPhase` is in DM_ONLY_CHARACTER_FIELDS).
    dm1.append('pc-edit', {
      v: 1,
      pcId: 'mei',
      field: 'magicPhase',
      value: 'accidental'
    });

    // Beat 6: DM logs an accidental grant.  DM-only kind.
    dm1.append('accidental-grant-log', {
      v: 1,
      pcId: 'mei',
      sceneId: 'scene-1',
      note: 'flickering torches around Mei'
    });

    // Beat 7-9: player-visible chat.
    dm1.append('chat', { text: 'The rain comes down hard.' });
    anya1.append('chat', { text: 'Anya pulls her hood up.' });
    mei1.append('chat', { text: 'Mei reaches for the lantern…' });

    // Beat 10: DM scratch-note.  DM-only.
    dm1.append('scratch-note', {
      v: 1,
      text: 'Mei is about to realize'
    });

    // Beat 11: Realization beat — atomic 4-field write.
    dm1.append('pc-mark-realization', {
      v: 1,
      pcId: 'mei',
      taxSessions: 3
    });

    // Beat 12: ritual chat.
    dm1.append('chat', {
      text: 'Lightning illuminates the alley as Mei realizes…'
    });

    // Beat 13: session-digest.  Player-visible.
    dm1.append('session-digest', {
      v: 1,
      sessionStartTs: 1,
      markdown: 'Session 1: the rain begins.  Mei realizes.'
    });

    await flush();

    // -----------------------------------------------------------
    // PRE-SAVE INVARIANTS — verify the firewall on the live
    // session before we add the save/restore surface.
    // -----------------------------------------------------------

    // A1: chat is visible to all.
    const dm1State = dm1.state();
    const mei1Filtered = filterForViewer(mei1.state(), mei1.peerId);
    const anya1Filtered = filterForViewer(anya1.state(), anya1.peerId);

    for (const text of [
      'The rain comes down hard.',
      'Anya pulls her hood up.',
      'Mei reaches for the lantern…',
      'Lightning illuminates the alley as Mei realizes…'
    ]) {
      expect(dm1State.chat.map((c) => c.text)).toContain(text);
      expect(mei1Filtered.chat.map((c) => c.text)).toContain(text);
      expect(anya1Filtered.chat.map((c) => c.text)).toContain(text);
    }

    // A2: scratch-note never reaches players' filtered state.
    expect(mei1Filtered.scratchNotes).toEqual([]);
    expect(anya1Filtered.scratchNotes).toEqual([]);

    // A3: accidental-grant-log lives in DM state only.
    expect(dm1State.pcAccidentalGrants?.['mei']?.length ?? 0).toBeGreaterThan(
      0
    );
    expect(
      mei1Filtered.pcAccidentalGrants?.['mei'] ?? []
    ).toEqual([]);
    expect(
      anya1Filtered.pcAccidentalGrants?.['mei'] ?? []
    ).toEqual([]);

    // A4: Mei sees her own knowsTheyCanCast + tax.active.
    expect(
      (mei1Filtered.pcEdits['mei'] ?? {})['knowsTheyCanCast']
    ).toBe(true);
    expect(
      (mei1Filtered.pcEdits['mei'] ?? {})['tax.active']
    ).toBe(true);

    // A5: Mei does NOT see tax.sessionsRemaining (DM-only meter).
    expect(
      (mei1Filtered.pcEdits['mei'] ?? {})['tax.sessionsRemaining']
    ).toBeUndefined();

    // A6: Mei does NOT see magicPhase.
    expect(
      (mei1Filtered.pcEdits['mei'] ?? {})['magicPhase']
    ).toBeUndefined();

    // A7 (cross-PC firewall): Anya does NOT see Mei's magic.
    const anyaPcEditsForMei = anya1Filtered.pcEdits['mei'] ?? {};
    expect(anyaPcEditsForMei['knowsTheyCanCast']).toBeUndefined();
    expect(anyaPcEditsForMei['tax.active']).toBeUndefined();
    expect(anyaPcEditsForMei['magicPhase']).toBeUndefined();
    expect(anyaPcEditsForMei['tax.sessionsRemaining']).toBeUndefined();

    // Symmetric: Mei does NOT see anya's pc-edit fields
    // (cross-PC firewall in the other direction; anya has no
    // magic-arc fields, but the same projection rule applies).
    const meiPcEditsForAnya = mei1Filtered.pcEdits['anya'] ?? {};
    expect(meiPcEditsForAnya['knowsTheyCanCast']).toBeUndefined();

    // -----------------------------------------------------------
    // SAVE BOUNDARY — DM serializes the full log + pushes.
    // -----------------------------------------------------------

    const dmSave = serializeSession(
      dm1.events(),
      CAMPAIGN,
      'markus-week1'
    );
    const dmSaveBody = stringifySave(dmSave);

    // Sanity: the DM save MUST contain the DM-only events
    // (Mei's autosave will NOT, but the DM-coord save is the
    // canonical store).
    expect(dmSave.events.some((e) => e.kind === 'scratch-note')).toBe(true);
    expect(
      dmSave.events.some((e) => e.kind === 'accidental-grant-log')
    ).toBe(true);
    expect(
      dmSave.events.some((e) => e.kind === 'pc-mark-realization')
    ).toBe(true);

    // Mei's autosave path — drops every DM-only kind.
    const meiAutosave = serializeSessionForViewer(
      mei1.events(),
      CAMPAIGN,
      mei1.peerId,
      dm1.peerId
    );
    const meiAutosaveKinds = new Set(meiAutosave.events.map((e) => e.kind));
    expect(meiAutosaveKinds.has('scratch-note')).toBe(false);
    expect(meiAutosaveKinds.has('accidental-grant-log')).toBe(false);
    // FINDING (intentional in firewall design): pc-mark-realization
    // is in PLAYER_SCOPE_STRIP_KINDS — it's DM-only-by-kind even
    // though the realization MOMENT reaches the player narratively
    // through the chat ritual + the pcEdits[mei] projection
    // (knowsTheyCanCast / tax.active).  So Mei's autosave does NOT
    // contain the pc-mark-realization event itself.  The
    // implication: if Mei restores her own autosave-only without
    // the DM's save, she would lose knowsTheyCanCast (since the
    // materializer applies pcEdits via the pc-mark-realization
    // event, NOT via a per-field pc-edit).  This is part of the
    // "DM coord save is the canonical store" model — players
    // restore from the DM's full save, NOT their own scrubbed
    // autosave.  See `feedback_silent_player_firewall` +
    // `auth-strategy.md §A6` LOCKED.
    expect(meiAutosaveKinds.has('pc-mark-realization')).toBe(false);
    // Cross-PC firewall on Mei's save: drops `pc-edit` events
    // whose `field` is a DM-only character field.  Mei's
    // magicPhase pc-edit is DM-only — must be dropped.
    const meiSavedPcEdits = meiAutosave.events.filter(
      (e) => e.kind === 'pc-edit'
    );
    // pc-edits with player-visible fields (like 'name') survive;
    // pc-edits with magicPhase do not.
    expect(
      meiSavedPcEdits.some(
        (e) => (e.payload as { field?: string })?.field === 'magicPhase'
      )
    ).toBe(false);

    // Anya's autosave — same firewall.  Critically she has no
    // pc-mark-realization in her render but it IS in her raw log
    // (share-broadcast).  Her autosave keeps it because the event
    // kind itself is player-visible; filterForViewer + the
    // cross-PC projection do the rest at render time.
    const anyaAutosave = serializeSessionForViewer(
      anya1.events(),
      CAMPAIGN,
      anya1.peerId,
      dm1.peerId
    );
    const anyaAutosaveKinds = new Set(
      anyaAutosave.events.map((e) => e.kind)
    );
    expect(anyaAutosaveKinds.has('scratch-note')).toBe(false);
    expect(anyaAutosaveKinds.has('accidental-grant-log')).toBe(false);

    // -----------------------------------------------------------
    // SESSION 2 — DM reopens next week.  Fresh world.
    // -----------------------------------------------------------
    const parsed = parseSaveDocument(dmSaveBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Round-trip determinism: stringified parsed save = original.
    expect(stringifySave(parsed.doc)).toBe(dmSaveBody);

    const net2 = new InMemoryNetwork();
    const dm2 = makePeer('markus-week2', net2);
    // DM is coord on the restored side — projection is no-op.
    const projectedForDm = projectSaveForViewer(parsed.doc, true);
    for (const ev of projectedForDm.events) {
      dm2.applyEvent(ev);
    }

    // DM's restored state has everything.
    const dm2State = dm2.state();
    expect(dm2State.scratchNotes?.[0]?.text).toBe(
      'Mei is about to realize'
    );
    expect(
      dm2State.pcAccidentalGrants?.['mei']?.length ?? 0
    ).toBeGreaterThan(0);
    const dm2MeiEdit = dm2State.pcEdits['mei'] ?? {};
    expect(dm2MeiEdit['magicPhase']).toBe('realization');
    expect(dm2MeiEdit['knowsTheyCanCast']).toBe(true);
    expect(dm2MeiEdit['tax.active']).toBe(true);
    expect(dm2MeiEdit['tax.sessionsRemaining']).toBe(3);

    // -----------------------------------------------------------
    // Players rejoin the new session — sync-on-connect kicks in.
    // -----------------------------------------------------------

    const mei2 = makePeer('mei-week2', net2);
    const anya2 = makePeer('anya-week2', net2);
    mei2.append('peer-join', { name: 'Mei-player', knownKindsCount: 200 });
    anya2.append('peer-join', { name: 'Anya-player', knownKindsCount: 200 });
    await flush();
    await flush();

    // After sync-on-connect, players have caught up via
    // sync-response.  OP-039 fix means the sync-response strips
    // PLAYER_SCOPE_STRIP_KINDS events.

    // A2 (restore): scratch-note must NOT be in mei2's raw log.
    const mei2RawKinds = new Set(mei2.events().map((e) => e.kind));
    expect(mei2RawKinds.has('scratch-note')).toBe(false);
    expect(mei2RawKinds.has('accidental-grant-log')).toBe(false);

    // A3 (restore): same for Anya.
    const anya2RawKinds = new Set(anya2.events().map((e) => e.kind));
    expect(anya2RawKinds.has('scratch-note')).toBe(false);
    expect(anya2RawKinds.has('accidental-grant-log')).toBe(false);

    // Now players claim their PCs.
    mei2.append('peer-rename', { pcId: 'mei', name: 'Mei-player' });
    anya2.append('peer-rename', { pcId: 'anya', name: 'Anya-player' });
    await flush();

    const mei2Filtered = filterForViewer(mei2.state(), mei2.peerId);
    const anya2Filtered = filterForViewer(anya2.state(), anya2.peerId);

    // FINDING-A (OP-040, surfaced by mock campaign 02): the OP-039
    // sync-response firewall strips ALL PLAYER_SCOPE_STRIP_KINDS
    // events (correct for scratch-note etc.).  But
    // `pc-mark-realization` is also in that set — the EXISTENCE of
    // the event is classified DM-only, even though its EFFECT
    // (knowsTheyCanCast=true) is player-visible to the PC owner.
    //
    // In LIVE play, the `share` envelope delivers the raw event to
    // all peers; filterForViewer at render strips per-viewer.
    // Mei's projection keeps her own knowsTheyCanCast.
    //
    // In a CATCH-UP scenario (Mei joins a new session AFTER the
    // realization was authored), her ONLY catch-up channel is
    // sync-response.  Post-OP-039, the sync-response filter drops
    // pc-mark-realization.  Mei's materialized state never gets
    // the realization → her filterForViewer projection is empty.
    //
    // Net effect: a player who joins a session AFTER their own
    // realization beat sees no cast capability on their sheet.
    // The DM's render shows the realization correctly (DM gets the
    // full save on restore).  The player would need the DM to
    // re-author the realization OR the player needs to be present
    // when the realization first fires (the live-share path).
    //
    // Severity: P2 — same class-2 firewall-architecture tension as
    // OP-039.  In the cross-session save/restore scenario, the
    // primary workflow is: DM restores their full save → players
    // who were AT THE TABLE for the realization had it materialize
    // into their session-end autosave too.  The pure "join fresh
    // mid-tax" workflow is rare and recoverable (DM can re-mark
    // realization, which is idempotent on the visible state).
    // Filed as OP-040 for visibility; deferred to the next
    // architectural review of pc-mark-realization classification.
    const mei2MeiEdits = mei2Filtered.pcEdits['mei'] ?? {};
    expect(mei2MeiEdits['knowsTheyCanCast']).toBeUndefined();
    expect(mei2MeiEdits['tax.active']).toBeUndefined();
    expect(mei2MeiEdits['tax.sessionsRemaining']).toBeUndefined();
    expect(mei2MeiEdits['magicPhase']).toBeUndefined();

    // A7 (restore): Anya STILL does not see Mei's magic.  This is
    // the flagship cross-PC firewall test across the save/restore
    // boundary.
    const anya2MeiEdits = anya2Filtered.pcEdits['mei'] ?? {};
    expect(anya2MeiEdits['knowsTheyCanCast']).toBeUndefined();
    expect(anya2MeiEdits['tax.active']).toBeUndefined();
    expect(anya2MeiEdits['magicPhase']).toBeUndefined();
    expect(anya2MeiEdits['tax.sessionsRemaining']).toBeUndefined();

    // Defense in depth: Anya's RAW state (un-filtered) might
    // contain a pc-edit for Mei's magicPhase IF gossip carried
    // it.  Verify that no such raw pc-edit reached Anya's log
    // (the per-field scrubber in defaultRebroadcastFilter +
    // OP-039 kind-based sync filter combine to keep her clean).
    // The pc-edit { field: 'magicPhase' } is scrubbed to null
    // by PER_KIND_SCRUBBERS, so the rebroadcast path drops it.
    // The OP-039 sync-response filter is kind-only, so pc-edit
    // CAN survive there — but the per-field scrubber catches it
    // on the share path (hub-forward).  In our InMemoryNetwork
    // topology every peer sees every share directly, so the
    // hub-forward filter never runs.  This is the residual
    // class-2 hole: Anya's raw state may contain Mei's
    // magicPhase pc-edit.
    //
    // Crucially, filterForViewer hides it AT RENDER, AND
    // serializeSessionForViewer drops it AT SAVE.  Render +
    // save are the firewall surfaces players actually interact
    // with.  The raw-state-in-memory class-2 hole is the
    // existing accepted-risk per DEC-023.
    //
    // What we CAN assert is that, with the OP-039 fix in place,
    // a player who joined AFTER the realization (via
    // sync-response from a peer who already had the events) does
    // NOT receive PLAYER_SCOPE_STRIP_KINDS events in their raw
    // log.  pc-edit isn't in that set; magicPhase is filtered
    // per-field elsewhere.

    // A10 (chats post-restore): every player sees the chats
    // including the realization ritual line.
    expect(mei2Filtered.chat.map((c) => c.text)).toContain(
      'Lightning illuminates the alley as Mei realizes…'
    );
    expect(anya2Filtered.chat.map((c) => c.text)).toContain(
      'Lightning illuminates the alley as Mei realizes…'
    );

    // -----------------------------------------------------------
    // SESSION 2 CONTINUES — tax counter ticks down + releases.
    // -----------------------------------------------------------

    dm2.append('chat', { text: 'Session 2: the next morning.' });
    dm2.append('chat', { text: 'Mei feels the weight of the tax.' });
    dm2.append('pc-edit', {
      v: 1,
      pcId: 'mei',
      field: 'tax.sessionsRemaining',
      value: 2
    });

    await flush();

    // DM tick the tax meter.  Mei's filtered view does NOT see
    // tax.sessionsRemaining.
    const mei2FilteredAfterTick = filterForViewer(
      mei2.state(),
      mei2.peerId
    );
    expect(
      (mei2FilteredAfterTick.pcEdits['mei'] ?? {})['tax.sessionsRemaining']
    ).toBeUndefined();
    // Per FINDING-A: Mei's tax.active is undefined post-restore
    // because the pc-mark-realization event was stripped from her
    // sync-response.  Mei never received the initial
    // tax.active=true write.  The DM's session-2 pc-edit to
    // tax.sessionsRemaining is its own per-field event, which
    // delivers to Mei but doesn't itself flip tax.active.
    expect(
      (mei2FilteredAfterTick.pcEdits['mei'] ?? {})['tax.active']
    ).toBeUndefined();

    // Release the tax (DM workflow continues — DM re-marks the
    // release via a pc-edit).  In a production scenario where the
    // realization was AUTHORED in a prior session and the player
    // joined fresh today, the DM would either re-mark realization
    // (idempotent on the visible state in DM-coord view) OR rely
    // on the chat narrative + the natural drift back to normal
    // play.  Per FINDING-A, the player's automatic firewall-
    // visible state is broken across the rejoin boundary.
    dm2.append('pc-edit', {
      v: 1,
      pcId: 'mei',
      field: 'tax.active',
      value: false
    });
    dm2.append('chat', { text: 'The tax lifts.' });

    await flush();

    const mei2FilteredAfterRelease = filterForViewer(
      mei2.state(),
      mei2.peerId
    );
    // The pc-edit { field: 'tax.active', value: false } event
    // DOES reach Mei's log via live share-broadcast.  The
    // per-field scrubber on pc-edit treats tax.active as a
    // DM-only field path → drops the event from Mei's filtered
    // pcEdits via filterForViewer.  Net: Mei still doesn't see
    // tax.active post-rejoin (FINDING-A propagates).
    expect(
      (mei2FilteredAfterRelease.pcEdits['mei'] ?? {})['tax.active']
    ).toBeUndefined();
    // knowsTheyCanCast remains undefined (FINDING-A).
    expect(
      (mei2FilteredAfterRelease.pcEdits['mei'] ?? {})['knowsTheyCanCast']
    ).toBeUndefined();

    // A7 (post-release): Anya STILL does not see Mei's magic.
    const anya2FilteredAfterRelease = filterForViewer(
      anya2.state(),
      anya2.peerId
    );
    const anya2MeiPostRelease =
      anya2FilteredAfterRelease.pcEdits['mei'] ?? {};
    expect(anya2MeiPostRelease['knowsTheyCanCast']).toBeUndefined();
    expect(anya2MeiPostRelease['tax.active']).toBeUndefined();

    // Final A1: tax lift chat reaches everyone.
    expect(
      mei2FilteredAfterRelease.chat.map((c) => c.text)
    ).toContain('The tax lifts.');
    expect(
      anya2FilteredAfterRelease.chat.map((c) => c.text)
    ).toContain('The tax lifts.');
  });

  it('Anya-joins-after-realization sync-response firewall (OP-039 in flagship context)', async () => {
    // Subtest: at the start of session 2, DM has already restored
    // the full DM-coord save.  Mei joins first, then ANYA joins
    // AFTER realization is already in DM's log.  Anya's only
    // catch-up channel is sync-response.  Verify the OP-039 fix
    // means Anya's raw log has NO PLAYER_SCOPE_STRIP_KINDS events.
    const net1 = new InMemoryNetwork();
    const dm1 = makePeer('markus', net1);
    const mei1 = makePeer('mei', net1);
    dm1.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    mei1.append('peer-join', { name: 'Mei', knownKindsCount: 200 });
    dm1.append('coordinator-claim', {});
    dm1.append('seat-add', { v: 1, slot: 1 });
    dm1.append('seat-add', { v: 1, slot: 2 });
    appendCreatePc(dm1, 'mei', 'Mei');
    appendCreatePc(dm1, 'anya', 'Anya');
    dm1.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    dm1.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'anya' });
    await flush();
    mei1.append('peer-rename', { pcId: 'mei' });
    dm1.append('scratch-note', { v: 1, text: 'OP_039_SCRATCH_SECRET' });
    dm1.append('accidental-grant-log', {
      v: 1,
      pcId: 'mei',
      sceneId: 's1',
      note: 'OP_039_GRANT_SECRET'
    });
    dm1.append('pc-mark-realization', { v: 1, pcId: 'mei', taxSessions: 3 });
    dm1.append('chat', { text: 'realization ritual' });

    await flush();

    // Save + close + reopen.
    const dmSave = serializeSession(dm1.events(), CAMPAIGN, 'markus');
    const dmSaveBody = stringifySave(dmSave);
    const parsed = parseSaveDocument(dmSaveBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const net2 = new InMemoryNetwork();
    const dm2 = makePeer('markus', net2);
    const projected = projectSaveForViewer(parsed.doc, true);
    for (const ev of projected.events) {
      dm2.applyEvent(ev);
    }

    // Anya joins fresh.  Her sync-request → DM's sync-response is
    // her ONLY catch-up channel.
    const anya2 = makePeer('anya', net2);
    anya2.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    await flush();
    await flush();

    // OP-039 invariant: anya2's raw log has no PLAYER_SCOPE_STRIP_KINDS.
    const anyaRawKinds = new Set(anya2.events().map((e) => e.kind));
    expect(anyaRawKinds.has('scratch-note')).toBe(false);
    expect(anyaRawKinds.has('accidental-grant-log')).toBe(false);

    // Devtools-leak sanity: stringify Anya's raw events and look
    // for the planted DM-only sentinels.  Neither must appear.
    const anyaRawJson = JSON.stringify(anya2.events());
    expect(anyaRawJson.includes('OP_039_SCRATCH_SECRET')).toBe(false);
    expect(anyaRawJson.includes('OP_039_GRANT_SECRET')).toBe(false);

    // Sanity: Anya did get the player-visible chat + the
    // realization ritual.
    const anyaFiltered = filterForViewer(anya2.state(), anya2.peerId);
    expect(anyaFiltered.chat.map((c) => c.text)).toContain(
      'realization ritual'
    );

    // Anya does NOT see Mei's magic state.
    const anyaMeiEdits = anyaFiltered.pcEdits['mei'] ?? {};
    expect(anyaMeiEdits['knowsTheyCanCast']).toBeUndefined();
    expect(anyaMeiEdits['tax.active']).toBeUndefined();
    expect(anyaMeiEdits['magicPhase']).toBeUndefined();
  });
});

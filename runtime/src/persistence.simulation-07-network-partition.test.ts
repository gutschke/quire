// @vitest-environment node

/**
 * Mock Campaign 07 — Network partition.
 *
 * Doc: `design/save-restore-program/simulations/mock-campaign-07-
 * network-partition.md` — read that for the scenario brief,
 * per-turn script, and full invariants.  This file is the code-
 * level simulation.
 *
 * Four shapes:
 *   1. Two-peer partition: peer offline N events; comes back;
 *      merge converges + firewall holds.
 *   2. Three-peer partition: one peer alone, two together; both
 *      sides write; merge converges.
 *   3. Coord partition + DM-only events: scratch-notes authored
 *      pre-partition do NOT leak from a player's partial log
 *      when other players reconnect via sync-response.
 *   4. Save during partition: a peer in a minority partition
 *      saves; restores after heal; CRDT merge converges via
 *      normal sync.
 */

import { describe, it, expect } from 'vitest';
import { Peer } from './core/peer';
import { InMemoryNetwork, InMemoryTransport } from './core/transports/in-memory';
import { filterForViewer } from './core/state';
import {
  defaultRebroadcastFilter,
  defaultSyncResponseFilter,
  parseSaveDocument,
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
  // Run several microtask drains to settle async deliveries.
  for (let i = 0; i < 10; i++) await Promise.resolve();
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


describe('Mock Campaign 07 — Network partition', () => {
  // -----------------------------------------------------------
  // 1) Two-peer partition: peer goes offline, DM authors, peer
  //    comes back.  Sync converges; firewall holds.
  // -----------------------------------------------------------
  it('two-peer partition: player offline N events; rejoin → both peers converge byte-identical', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const player = makePeer('anya-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    player.append('peer-join', { name: 'Anya-player', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    appendCreatePc(dm, 'anya', 'Anya');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'anya' });
    player.append('peer-rename', { pcId: 'anya' });
    await flush();

    // Pre-partition baseline: both peers see all events.
    const dmBaselineLen = dm.events().length;
    expect(player.events().length).toBe(dmBaselineLen);

    // Partition the player.
    net.setPartition(player.peerId, true);

    // DM authors 5 more events while player is offline.
    dm.append('chat', { text: 'dm narrates scene 1' });
    dm.append('chat', { text: 'dm narrates scene 2' });
    dm.append('scratch-note', { v: 1, text: 'DM_PRIVATE_NOTE' });
    dm.append('chat', { text: 'dm narrates scene 3' });
    dm.append('chat', { text: 'dm narrates scene 4' });
    await flush();

    // Player's log has NOT advanced (partitioned, no delivery).
    expect(player.events().length).toBe(dmBaselineLen);

    // Heal the partition; sync flows through normal connect path.
    net.setPartition(player.peerId, false);
    await flush();
    // The network re-fires connect handlers, triggering sync-request
    // from the player to the DM.  Drain a few more microtask cycles
    // for the async message dispatch.
    await flush();

    // Convergence: player's event log equals DM's log MINUS the
    // DM-only events filtered out by the sync-response firewall
    // (OP-039 fix: scratch-note is in PLAYER_SCOPE_STRIP_KINDS).
    //
    // DM authored 1 scratch-note while player was offline; player's
    // log is therefore exactly one event shorter.  This asymmetry
    // IS the firewall doing its job across the partition heal.
    expect(player.events().length).toBe(dm.events().length - 1);

    // Firewall holds across partition: scratch-note is dropped from
    // the player's RAW log by defaultSyncResponseFilter.
    expect(
      player.events().some((e) => e.kind === 'scratch-note')
    ).toBe(false);
    // DM keeps its own scratch-note.
    expect(
      dm.events().some((e) => e.kind === 'scratch-note')
    ).toBe(true);
    // All non-DM-only events DO converge: player sees every chat
    // the DM authored during the partition.
    for (const text of [
      'dm narrates scene 1',
      'dm narrates scene 2',
      'dm narrates scene 3',
      'dm narrates scene 4'
    ]) {
      expect(
        player
          .events()
          .some(
            (e) =>
              e.kind === 'chat' &&
              (e.payload as { text?: string }).text === text
          )
      ).toBe(true);
    }

    // Firewall still holds in the player's filtered state.
    const playerFiltered = filterForViewer(player.state(), player.peerId);
    expect(playerFiltered.scratchNotes ?? []).toEqual([]);
  });

  // -----------------------------------------------------------
  // 2) Three-peer partition: peer-C alone, DM + peer-B together.
  //    Both partitions write.  Heal → all three converge.
  // -----------------------------------------------------------
  it('three-peer partition: isolated player + active table both write; merge converges on heal', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const anya = makePeer('anya-player', net);
    const mei = makePeer('mei-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    anya.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    mei.append('peer-join', { name: 'Mei', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    dm.append('seat-add', { v: 1, slot: 2 });
    appendCreatePc(dm, 'anya', 'Anya');
    appendCreatePc(dm, 'mei', 'Mei');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'anya' });
    dm.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'mei' });
    await flush();

    // Partition Mei alone.  DM + Anya stay connected.
    net.setPartition(mei.peerId, true);

    // Active table (DM + Anya) authors.
    dm.append('chat', { text: 'dm: the door opens' });
    anya.append('chat', { text: 'anya: I step through' });
    dm.append('scratch-note', { v: 1, text: 'DM_ONLY_PARTITION_NOTE' });
    dm.append('chat', { text: 'dm: a shape moves' });

    // Mei (alone) authors chat — no coord access, so only player-
    // visible events.
    mei.append('chat', { text: 'mei: am I online?' });
    mei.append('chat', { text: 'mei: hello?' });
    await flush();

    // Pre-heal: the partition boundary holds — DM didn't see
    // Mei's partition-side chats; Mei didn't see DM's partition-
    // side chats.
    expect(
      dm
        .events()
        .some(
          (e) =>
            e.kind === 'chat' &&
            (e.payload as { text?: string }).text === 'mei: am I online?'
        )
    ).toBe(false);
    expect(
      mei
        .events()
        .some(
          (e) =>
            e.kind === 'chat' &&
            (e.payload as { text?: string }).text === 'dm: the door opens'
        )
    ).toBe(false);

    // Heal.
    net.setPartition(mei.peerId, false);
    await flush();
    await flush();

    // FINDING-A (architectural asymmetry, documented invariant):
    // Anya holds the scratch-note in her RAW event log because the
    // `share` envelope from the DM-author was delivered directly to
    // her transport (no rebroadcastFilter on direct author-time
    // broadcast).  Mei does NOT hold it because she was partitioned
    // at author time + her catch-up came via sync-response which
    // applies defaultSyncResponseFilter.  This asymmetry is
    // INVISIBLE at every user-facing surface (filterForViewer +
    // serializeSessionForViewer both strip the scratch-note from
    // any rendered or saved projection) — it lives only in the
    // raw in-memory log and is devtools-visible only.  Document
    // here rather than file as a new OP; consistent with OP-039's
    // accepted-by-design surface area.
    expect(
      anya.events().some((e) => e.kind === 'scratch-note')
    ).toBe(true);
    expect(
      mei.events().some((e) => e.kind === 'scratch-note')
    ).toBe(false);

    // What MUST converge is the user-visible projection.  Both
    // players see the SAME filtered state.
    const anyaFiltered = filterForViewer(anya.state(), anya.peerId);
    const meiFiltered = filterForViewer(mei.state(), mei.peerId);
    // No DM-only data leaks on either filtered view.
    expect(anyaFiltered.scratchNotes ?? []).toEqual([]);
    expect(meiFiltered.scratchNotes ?? []).toEqual([]);
    // Chat (player-visible) is the same on both projections.
    expect(
      anyaFiltered.chat.map((c) => c.text).sort().join('|')
    ).toBe(meiFiltered.chat.map((c) => c.text).sort().join('|'));

    // Confirm every chat from the partition (both sides) is present
    // on both players' projections.
    for (const text of [
      'dm: the door opens',
      'anya: I step through',
      'dm: a shape moves',
      'mei: am I online?',
      'mei: hello?'
    ]) {
      for (const peer of [anya, mei]) {
        expect(
          peer
            .events()
            .some(
              (e) =>
                e.kind === 'chat' &&
                (e.payload as { text?: string }).text === text
            )
        ).toBe(true);
      }
    }

    // Convergence of player-visible save projection: both players
    // produce byte-identical autosaves (the firewall normalizes
    // the asymmetry at the save boundary).
    const anyaSave = stringifySave(
      serializeSessionForViewer(
        anya.events(),
        CAMPAIGN,
        anya.peerId,
        dm.peerId
      )
    );
    const meiSave = stringifySave(
      serializeSessionForViewer(
        mei.events(),
        CAMPAIGN,
        mei.peerId,
        dm.peerId
      )
    );
    // Saves only differ by `savedByPeerId` + `savedAt` (both
    // appear as top-level keys in the multi-line stringified save).
    // Strip those two top-level fields for the byte-equality
    // comparison.
    const normalize = (s: string): string => {
      const parsed = JSON.parse(s) as Record<string, unknown>;
      parsed.savedByPeerId = 'X';
      parsed.savedAt = 'X';
      return JSON.stringify(parsed);
    };
    expect(normalize(anyaSave)).toBe(normalize(meiSave));

  });

  // -----------------------------------------------------------
  // 3) Coordinator partition: DM-only events authored before the
  //    partition do NOT leak from a player's partial log when
  //    other players reconnect via sync-response.
  // -----------------------------------------------------------
  it('coord partition: scratch-note authored pre-partition does NOT propagate to a late-joining player via sync-response', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const anya = makePeer('anya-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    anya.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    appendCreatePc(dm, 'anya', 'Anya');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'anya' });

    // DM authors a scratch-note.  Broadcast via `share` reaches
    // Anya — but the rebroadcastFilter drops DM-only kinds, so
    // Anya's log does NOT have it.  Confirm.
    dm.append('scratch-note', { v: 1, text: 'PRE_PARTITION_NOTE' });
    await flush();

    // OP-039 / NEW-ADV-2: rebroadcastFilter drops DM-only kinds
    // even on the `share` envelope when peer-forwarded.  Direct
    // broadcast from author goes through the transport without
    // a filter.  Anya WILL receive the scratch-note via direct
    // transport.deliver(from, 'broadcast').  Confirm whether it's
    // in her log.
    const anyaHasScratchPreFix = anya
      .events()
      .some((e) => e.kind === 'scratch-note');
    // Document the current behavior (Anya's RAW log MAY have the
    // scratch-note because `share` broadcast goes through the
    // transport directly with no rebroadcast-filter on the
    // sender side).  filterForViewer + serializeSessionForViewer
    // BOTH strip it from any user-visible surface.  Sanity-check
    // that Anya's filtered state is clean.
    const anyaFilteredEarly = filterForViewer(anya.state(), anya.peerId);
    expect(anyaFilteredEarly.scratchNotes ?? []).toEqual([]);

    // Partition the DM.  Anya stays connected (alone).
    net.setPartition(dm.peerId, true);

    // Now a fresh peer joins (a player on a different device, or
    // the same player on a new tab).  They sync-request from
    // Anya — Anya holds the partial log.
    const meiLate = makePeer('mei-late', net);
    meiLate.append('peer-join', { name: 'Mei-late', knownKindsCount: 200 });
    await flush();
    await flush();

    // Mei's RAW log: Anya's sync-response was filtered by
    // defaultSyncResponseFilter; scratch-note (PLAYER_SCOPE_STRIP
    // kind) is DROPPED.
    expect(
      meiLate.events().some((e) => e.kind === 'scratch-note')
    ).toBe(false);

    // Filtered state is clean.
    const meiFilteredFromAnya = filterForViewer(
      meiLate.state(),
      meiLate.peerId
    );
    expect(meiFilteredFromAnya.scratchNotes ?? []).toEqual([]);

    // Reference: Anya's RAW log behavior before the OP-039 fix —
    // we don't depend on this; just record it as part of the
    // simulation invariant set.
    void anyaHasScratchPreFix;
  });

  // -----------------------------------------------------------
  // 4) Save during partition: peer saves while in minority
  //    partition; restore + reconnect; CRDT merge converges.
  // -----------------------------------------------------------
  it('save during partition: minority-partition save reflects local view; restore + re-sync converges', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const anya = makePeer('anya-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    anya.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    appendCreatePc(dm, 'anya', 'Anya');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'anya' });
    await flush();

    // Partition Anya.  DM authors a bunch.
    net.setPartition(anya.peerId, true);
    dm.append('chat', { text: 'dm: scene develops' });
    dm.append('chat', { text: 'dm: the plot thickens' });
    dm.append('scratch-note', { v: 1, text: 'POST_PARTITION_DM_NOTE' });
    await flush();

    // Anya (in minority partition) authors locally — chat only
    // (no coord), but enough to be a partial log.
    anya.append('chat', { text: 'anya: am I still here?' });
    await flush();

    // Anya saves while partitioned.  The save reflects ONLY her
    // local view.
    const anyaSaveDoc = serializeSessionForViewer(
      anya.events(),
      CAMPAIGN,
      anya.peerId,
      dm.peerId
    );
    const anyaSaveJson = stringifySave(anyaSaveDoc);
    // Save does NOT contain the DM's post-partition chat (Anya
    // never received it).
    expect(anyaSaveJson.includes('dm: scene develops')).toBe(false);
    // Save does NOT contain the DM-only scratch-note (firewall).
    expect(anyaSaveJson.includes('POST_PARTITION_DM_NOTE')).toBe(false);
    // Save DOES contain Anya's local chat.
    expect(anyaSaveJson.includes('anya: am I still here?')).toBe(true);

    // Sanity: parsing the save round-trips.
    const parseResult = parseSaveDocument(anyaSaveJson);
    expect(parseResult.ok).toBe(true);

    // Heal the partition.  Sync exchange brings Anya up to date
    // through the standard sync-request flow.
    net.setPartition(anya.peerId, false);
    await flush();
    await flush();

    // After heal: both peers converge on event SET (modulo the
    // firewall — Anya's sync-response was filtered).
    const dmHasDmNote = dm
      .events()
      .some((e) => e.kind === 'scratch-note');
    expect(dmHasDmNote).toBe(true);
    const anyaHasDmNote = anya
      .events()
      .some((e) => e.kind === 'scratch-note');
    expect(anyaHasDmNote).toBe(false);
    // Anya DOES see the DM's chat events that landed pre-heal.
    expect(
      anya.events().some(
        (e) =>
          e.kind === 'chat' &&
          (e.payload as { text?: string }).text === 'dm: scene develops'
      )
    ).toBe(true);
    // Anya's own chat survived the round trip.
    expect(
      anya.events().some(
        (e) =>
          e.kind === 'chat' &&
          (e.payload as { text?: string }).text === 'anya: am I still here?'
      )
    ).toBe(true);
    // DM ALSO received Anya's chat once the partition healed (her
    // log was sync'd to DM via the heal-time sync exchange).
    expect(
      dm.events().some(
        (e) =>
          e.kind === 'chat' &&
          (e.payload as { text?: string }).text === 'anya: am I still here?'
      )
    ).toBe(true);
  });

  // -----------------------------------------------------------
  // 5) Deterministic convergence: same events appended in
  //    different orders on different peers, healed, produce
  //    byte-identical materialized state.
  // -----------------------------------------------------------
  it('deterministic convergence: events appended in different orders converge to byte-identical state', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const player = makePeer('anya-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    player.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    appendCreatePc(dm, 'anya', 'Anya');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'anya' });
    await flush();

    // Partition.  Both peers author concurrently.
    net.setPartition(player.peerId, true);
    dm.append('chat', { text: 'dm-a' });
    player.append('chat', { text: 'player-x' });
    dm.append('chat', { text: 'dm-b' });
    player.append('chat', { text: 'player-y' });
    dm.append('chat', { text: 'dm-c' });
    player.append('chat', { text: 'player-z' });
    await flush();

    // Heal.
    net.setPartition(player.peerId, false);
    await flush();
    await flush();

    // Both peers should converge.  Compare the materialized state
    // (the canonical thing players will see) — the chat log is
    // ordered by the EventLog's causal sort regardless of author.
    const dmChat = dm
      .state()
      .chat.map((c) => c.text)
      .join('|');
    const playerChat = player
      .state()
      .chat.map((c) => c.text)
      .join('|');
    expect(playerChat).toBe(dmChat);
    // Confirm BOTH peers contain ALL 6 chats.
    expect(dmChat.split('|').filter(Boolean).length).toBe(6);
  });

  // -----------------------------------------------------------
  // 6) Save → restore on a fresh peer mid-partition: confirms
  //    the save format carries enough state for the rejoiner to
  //    re-enter the session, and the firewall holds.
  // -----------------------------------------------------------
  it('save-during-partition + restore on fresh peer: rejoin and converge', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const player = makePeer('anya-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    player.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    appendCreatePc(dm, 'anya', 'Anya');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'anya' });
    dm.append('chat', { text: 'baseline-1' });
    dm.append('chat', { text: 'baseline-2' });
    await flush();

    // Player saves while connected.
    const playerSave = serializeSessionForViewer(
      player.events(),
      CAMPAIGN,
      player.peerId,
      dm.peerId
    );
    const playerSaveJson = stringifySave(playerSave);

    // Player drops off (tab closed).  DM continues authoring.
    net.setPartition(player.peerId, true);
    dm.append('chat', { text: 'dm-mid' });
    dm.append('scratch-note', { v: 1, text: 'MID_SESSION_NOTE' });
    dm.append('chat', { text: 'dm-late' });
    await flush();

    // Player rejoins via a NEW peer instance restoring the save.
    const playerRejoin = makePeer('anya-player-rejoin', net);
    const parsed = parseSaveDocument(playerSaveJson);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      for (const event of parsed.doc.events) {
        playerRejoin.applyEvent(event, { propagate: false });
      }
    }
    playerRejoin.append('peer-join', {
      name: 'Anya-rejoin',
      knownKindsCount: 200
    });
    await flush();
    await flush();

    // Re-entered peer sees baseline events from the save.
    expect(
      playerRejoin
        .events()
        .some(
          (e) =>
            e.kind === 'chat' &&
            (e.payload as { text?: string }).text === 'baseline-1'
        )
    ).toBe(true);

    // After flushing, the sync exchange catches the rejoined peer
    // up to DM's current events (post-partition events).
    expect(
      playerRejoin
        .events()
        .some(
          (e) =>
            e.kind === 'chat' &&
            (e.payload as { text?: string }).text === 'dm-mid'
        )
    ).toBe(true);

    // Firewall: scratch-note authored mid-partition is NOT in the
    // rejoined player's RAW log (sync-response filter dropped it).
    expect(
      playerRejoin.events().some((e) => e.kind === 'scratch-note')
    ).toBe(false);
    // And not in the filtered view either.
    const rejoinedFiltered = filterForViewer(
      playerRejoin.state(),
      playerRejoin.peerId
    );
    expect(rejoinedFiltered.scratchNotes ?? []).toEqual([]);
  });
});

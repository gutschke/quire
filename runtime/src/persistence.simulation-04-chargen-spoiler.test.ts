// @vitest-environment node

/**
 * Mock Campaign 04 — Chargen spoiler authorship through save/restore.
 *
 * Doc: `design/save-restore-program/simulations/mock-campaign-04-
 * chargen-spoiler-authorship.md` — read that for the scenario brief,
 * per-turn script, and full invariants.  This file is the code-level
 * simulation.
 *
 * Run with `npx vitest run src/persistence.simulation-04-chargen-
 * spoiler.test.ts`.
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
import { packChargen, type ChargenPackDocument } from './chargen-pack';
import { containsSpoilerTokens } from './ai/spoiler-check';

const CAMPAIGN = { owner: 'gutschke', repo: 'underleaf', ref: 'main' };
const CAMPAIGN_FINGERPRINT = 'fp-deadbeef-12345678';
const SPOILER_TOKENS = ['Quiet'] as const;

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

function makePack(answers: Record<string, string>): ChargenPackDocument {
  return packChargen({
    campaignFingerprint: CAMPAIGN_FINGERPRINT,
    slot: 1,
    chosenPath: 'qa',
    answers,
    bondDrafts: [],
    nowMs: 1_700_000_000_000
  });
}

describe('Mock Campaign 04 — Chargen spoiler authorship through save/restore', () => {
  it('amber spoiler chip survives save → restore + silent-player firewall holds', async () => {
    // ----------------------------------------------------------
    // SESSION 1 — Player delivers a pack with a spoiler-laden answer
    // ----------------------------------------------------------

    const net1 = new InMemoryNetwork();
    const dm1 = makePeer('markus-week1', net1);
    const anya1 = makePeer('anya-player-week1', net1);

    dm1.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    anya1.append('peer-join', { name: 'Anya-player', knownKindsCount: 200 });

    dm1.append('coordinator-claim', {});
    dm1.append('seat-add', { v: 1, slot: 1 });
    dm1.append('seat-add', { v: 1, slot: 2 });

    // DM has a DM-only secret in scratch.
    dm1.append('scratch-note', {
      v: 1,
      text: 'Prophecy: Anya is the chosen one.  Will be Realized in episode 4.'
    });

    await flush();

    // Player delivers her chargen pack.  Intent-moment answer
    // mentions "the Quiet" — that's the locked spoiler token for
    // this campaign per project_quire_world.  The player didn't
    // know it was a spoiler; she absorbed it from genre cues.
    const spoilerPack = makePack({
      'intent-moment':
        'I felt the Quiet stir when my dad lost his job.',
      'meaningful-item': 'a brass key'
    });
    anya1.append('chargen-pack-deliver', {
      v: 1,
      slot: 1,
      pack: spoilerPack
    });

    await flush();

    // ----------------------------------------------------------
    // PRE-SAVE INVARIANTS
    // ----------------------------------------------------------

    // A1: DM's render-time scan flags only the spoiler-laden answer.
    const dm1State = dm1.state();
    expect(dm1State.pendingChargenPacks.length).toBe(1);
    const dmPack = dm1State.pendingChargenPacks[0];
    expect(dmPack.senderPeerId).toBe('anya-player-week1');
    expect(dmPack.slot).toBe(1);
    const intentMomentHits = containsSpoilerTokens(
      dmPack.pack.answers['intent-moment'] ?? '',
      SPOILER_TOKENS
    );
    const itemHits = containsSpoilerTokens(
      dmPack.pack.answers['meaningful-item'] ?? '',
      SPOILER_TOKENS
    );
    expect(intentMomentHits).toEqual(['quiet']);
    expect(itemHits).toEqual([]);

    // A2: Player's filtered state — pendingChargenPacks projection
    // strips the answers for the sender (only metadata stays for the
    // "delivered" pip).  Other peers see nothing.
    const anya1Filtered = filterForViewer(anya1.state(), anya1.peerId);
    expect(anya1Filtered.pendingChargenPacks.length).toBe(1);
    const anyaPackEntry = anya1Filtered.pendingChargenPacks[0];
    expect(anyaPackEntry.senderPeerId).toBe(anya1.peerId);
    // Critical: answers wiped for the sender's projection.
    expect(anyaPackEntry.pack.answers).toEqual({});
    // chosenPath cleared too.
    expect(anyaPackEntry.pack.chosenPath).toBe('');

    // A3: DM scratch-note not in player's filtered state.
    expect(anya1Filtered.scratchNotes).toEqual([]);

    // A6 (pre-save): The spoiler token "Quiet" never appears in the
    // player's filtered state in ANY form.  Defense-in-depth on the
    // silent-player firewall.
    const anya1FilteredJson = JSON.stringify(anya1Filtered);
    expect(anya1FilteredJson.toLowerCase().includes('quiet')).toBe(false);
    expect(anya1FilteredJson.toLowerCase().includes('prophecy')).toBe(false);

    // ----------------------------------------------------------
    // SAVE BOUNDARY
    // ----------------------------------------------------------

    const dmSave = serializeSession(dm1.events(), CAMPAIGN, 'markus-week1');
    const dmSaveBody = stringifySave(dmSave);

    // DM save contains the pack-deliver + scratch-note.
    expect(
      dmSave.events.some((e) => e.kind === 'chargen-pack-deliver')
    ).toBe(true);
    expect(dmSave.events.some((e) => e.kind === 'scratch-note')).toBe(true);

    // Player's autosave — DM-only kinds stripped.
    const anyaAutosave = serializeSessionForViewer(
      anya1.events(),
      CAMPAIGN,
      anya1.peerId,
      dm1.peerId
    );
    const anyaAutosaveKinds = new Set(anyaAutosave.events.map((e) => e.kind));
    expect(anyaAutosaveKinds.has('scratch-note')).toBe(false);
    // Player's OWN chargen-pack-deliver survives — it's her authored
    // event, kept in her own autosave so her chargen state recovers.
    expect(anyaAutosaveKinds.has('chargen-pack-deliver')).toBe(true);

    // A6 (autosave): the spoiler vocabulary doesn't leak into Anya's
    // autosave via DM-only events.
    const anyaAutosaveJson = JSON.stringify(anyaAutosave);
    expect(
      anyaAutosaveJson.toLowerCase().includes('prophecy')
    ).toBe(false);

    // ----------------------------------------------------------
    // SESSION 2 — DM reopens, pulls, restores
    // ----------------------------------------------------------

    const parsed = parseSaveDocument(dmSaveBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // A4: byte-deterministic round-trip.
    expect(stringifySave(parsed.doc)).toBe(dmSaveBody);

    const net2 = new InMemoryNetwork();
    const dm2 = makePeer('markus-week2', net2);
    const projected = projectSaveForViewer(parsed.doc, true);
    for (const ev of projected.events) {
      dm2.applyEvent(ev);
    }

    // A5: pack still present in DM's restored state with spoiler-
    // laden answer intact.
    const dm2State = dm2.state();
    expect(dm2State.pendingChargenPacks.length).toBe(1);
    const restoredPack = dm2State.pendingChargenPacks[0];
    expect(restoredPack.pack.answers['intent-moment']).toBe(
      spoilerPack.answers['intent-moment']
    );
    // A1 (restore): spoiler chip render-time logic still flags it.
    const restoredHits = containsSpoilerTokens(
      restoredPack.pack.answers['intent-moment'] ?? '',
      SPOILER_TOKENS
    );
    expect(restoredHits).toEqual(['quiet']);

    // Scratch-note also restored on DM side.
    expect(dm2State.scratchNotes?.[0]?.text).toMatch(/Prophecy/);

    // ----------------------------------------------------------
    // Player rejoins in session 2 (fresh peer)
    // ----------------------------------------------------------

    const anya2 = makePeer('anya-player-week2', net2);
    anya2.append('peer-join', { name: 'Anya-player', knownKindsCount: 200 });
    await flush();
    await flush();

    // A7: post-restore sync-response firewall (OP-039) — Anya's raw
    // log has neither scratch-note nor the prophecy/spoiler text.
    const anya2RawKinds = new Set(anya2.events().map((e) => e.kind));
    expect(anya2RawKinds.has('scratch-note')).toBe(false);
    const anya2RawJson = JSON.stringify(anya2.events());
    expect(anya2RawJson.toLowerCase().includes('prophecy')).toBe(false);

    // The chargen-pack-deliver event itself IS player-visible-by-kind
    // (chargen flow is collaborative), BUT the projection on render
    // strips the answers for non-sender peers.  Here Anya IS the
    // sender (well, she's a new peerId in session 2 — different from
    // session 1's peerId, since the pack was authored by her
    // previous-week peerId).  Verify what the FRESH peerId sees.
    const anya2Filtered = filterForViewer(anya2.state(), anya2.peerId);
    // Anya2's peerId is DIFFERENT from the original sender — so the
    // projection rule "sender sees only their own placeholder"
    // excludes anya2's view.  She sees NO pending pack at all.
    expect(anya2Filtered.pendingChargenPacks.length).toBe(0);

    // A6 (post-restore filtered state): the spoiler vocabulary
    // doesn't appear ANYWHERE in Anya's filtered state.
    const anya2FilteredJson = JSON.stringify(anya2Filtered);
    expect(
      anya2FilteredJson.toLowerCase().includes('quiet')
    ).toBe(false);
    expect(
      anya2FilteredJson.toLowerCase().includes('prophecy')
    ).toBe(false);
  });

  it('player draft survives the round-trip via their own autosave + free re-delivery', async () => {
    // Sub-scenario: the player's draft is recoverable from her own
    // autosave (DM-coord-save is canonical for DM state, but a
    // player who quits and rejoins should not lose her own draft).
    const net1 = new InMemoryNetwork();
    const dm1 = makePeer('markus', net1);
    const anya1 = makePeer('anya', net1);
    dm1.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    anya1.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    dm1.append('coordinator-claim', {});
    dm1.append('seat-add', { v: 1, slot: 1 });
    await flush();

    const pack = makePack({
      'intent-moment': 'I felt the Quiet stir.',
      'meaningful-item': 'a brass key'
    });
    anya1.append('chargen-pack-deliver', { v: 1, slot: 1, pack });
    await flush();

    const anyaAutosave = serializeSessionForViewer(
      anya1.events(),
      CAMPAIGN,
      anya1.peerId,
      dm1.peerId
    );
    const anyaBody = stringifySave(anyaAutosave);
    const parsedAnya = parseSaveDocument(anyaBody);
    expect(parsedAnya.ok).toBe(true);
    if (!parsedAnya.ok) return;

    // Anya restores to a fresh world (no DM yet — she's first to
    // come back online).  Her own pack should be reconstructible.
    const projectedForPlayer = projectSaveForViewer(parsedAnya.doc, false);
    const net2 = new InMemoryNetwork();
    const anya2 = makePeer('anya', net2);
    for (const ev of projectedForPlayer.events) {
      anya2.applyEvent(ev);
    }

    // The deliver event survived — Anya's own materialized state
    // has her pending pack back.  filterForViewer for her own
    // peerId returns the placeholder shape (per the projection
    // rule).
    const anya2State = anya2.state();
    expect(anya2State.pendingChargenPacks.length).toBe(1);
    const recoveredPack = anya2State.pendingChargenPacks[0];
    expect(recoveredPack.senderPeerId).toBe('anya');
    expect(recoveredPack.pack.answers['intent-moment']).toBe(
      'I felt the Quiet stir.'
    );

    // Cross-check: filterForViewer still wipes for the sender on
    // render — answers are not echoed back through the projection.
    const anya2Filtered = filterForViewer(anya2.state(), 'anya');
    expect(anya2Filtered.pendingChargenPacks[0]?.pack.answers).toEqual({});
  });
});

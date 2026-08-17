// @vitest-environment node

/**
 * Chargen polish — round-trip tests for the playtest.
 *
 * Per the run #13 mandate from the human:
 *
 *   > things like changing names and pronouns and fine-tuning the
 *   > backstory has to work correctly now.
 *
 * This file walks the chargen field-edit lifecycle through the
 * save/restore + firewall + cloud-folder boundaries.  It LOCKS the
 * current behavior (so future regressions surface as failing tests)
 * and DOCUMENTS the gaps (so the TTRPG/UX consultant can pick them
 * up in run #14).
 *
 * Coverage targets (per WS-C in playtest-readiness-plan.md):
 *   1. Mid-chargen free-write rename / pronoun / backstory survive
 *      save/restore + cloud-folder round-trip.
 *   2. Post-acceptance edits survive same boundaries.
 *   3. Firewall holds (DM-only chargen material doesn't leak).
 *
 * GAPS (NOT FIXES — files findings for the consultant brief):
 *   - GAP-A: post-acceptance PC rename has no event surface.
 *     `pc-create` is first-write-wins, and `pc-edit` field=name
 *     silently no-ops at `applyCharacterEdits` (no name handler).
 *     Mid-chargen rename is fine (lives in chargen UI state, not
 *     events).  This is FILED as OP-045.
 */

import { describe, it, expect } from 'vitest';
import { Peer } from './core/peer';
import { InMemoryNetwork, InMemoryTransport } from './core/transports/in-memory';
import { EventLog } from './core/event-log';
import { materialize } from './core/state';
import {
  applySaveToLog,
  defaultRebroadcastFilter,
  defaultSyncResponseFilter,
  parseSaveDocument,
  projectSaveForViewer,
  serializeSession,
  serializeSessionForViewer,
  stringifySave
} from './persistence';
import { applyCharacterEdits } from './character-edits';
import type { CharacterRecord } from './character-loader';

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

function emitPcCreate(
  peer: Peer,
  pcId: string,
  name: string,
  pronouns: string,
  backstory: string
): void {
  peer.append('pc-create', {
    v: 1,
    pcId,
    name,
    pronouns,
    tags: ['scholar', 'curious', 'quiet'],
    stats: { str: 0, dex: 0, con: 0, int: 1, wis: 1, cha: 0 },
    skills: ['Lore'],
    backstory
  });
}

describe('Chargen polish — pc-create round-trip preserves name/pronouns/backstory', () => {
  it('full pc-create payload survives stringify → parse → applyLog → materialize', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('dm-markus', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});

    emitPcCreate(
      dm,
      'pc-mei',
      'Mei Tanaka',
      'she/her',
      'Grew up in the Underleaf bramble; learned to read the old runes by lantern light.'
    );
    await flush();

    const doc = serializeSession(dm.events(), CAMPAIGN, 'dm-markus');
    const json = stringifySave(doc);
    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const fresh = new EventLog('fresh-dm');
    applySaveToLog(fresh, parsed.doc);
    const state = materialize(fresh.events());
    const mei = state.synthesizedPcs['pc-mei'];
    expect(mei).toBeDefined();
    expect(mei.name).toBe('Mei Tanaka');
    expect(mei.pronouns).toBe('she/her');
    expect(mei.backstory).toContain('Underleaf bramble');
  });

  it('intentionUnderPressure survives the full save/restore cycle AND player-scope projection', async () => {
    // Two invariants at once:
    //   (a) Field round-trips through serialize → stringify → parse →
    //       applySaveToLog → materialize.  Regression guard against
    //       a future save-format change that silently drops it.
    //   (b) Player projection (projectSaveForViewer + subsequent
    //       materialize) keeps the field.  If someone accidentally
    //       adds `intentionUnderPressure` to DM_ONLY_CHARACTER_FIELDS
    //       or to a persistence scrubber allowlist, this fails.
    const net = new InMemoryNetwork();
    const dm = makePeer('dm-markus', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    const intention =
      'When my manager told me to bury the safety issue I signed my name to the memo instead and mailed it to legal on my way out.';
    dm.append('pc-create', {
      v: 1,
      pcId: 'pc-mia',
      name: 'Mia',
      pronouns: 'she/her',
      tags: ['scholar', 'curious', 'quiet'],
      stats: { str: 0, dex: 0, con: 0, int: 1, wis: 1, cha: 0 },
      skills: ['Lore'],
      backstory: 'Mia carries the memo folded in her wallet.',
      intentionUnderPressure: intention
    });
    await flush();

    // (a) DM-scope full round-trip.
    const dmDoc = serializeSession(dm.events(), CAMPAIGN, 'dm-markus');
    const dmParsed = parseSaveDocument(stringifySave(dmDoc));
    expect(dmParsed.ok).toBe(true);
    if (!dmParsed.ok) return;
    const dmFresh = new EventLog('fresh-dm');
    applySaveToLog(dmFresh, dmParsed.doc);
    const dmState = materialize(dmFresh.events());
    expect(dmState.synthesizedPcs['pc-mia']?.intentionUnderPressure).toBe(
      intention
    );

    // (b) Player-scope projection preserves the field.  This is the
    // load-bearing invariant for the whole feature: the player sees
    // their own intention answer on their own sheet.
    // 3rd arg is the viewer's peerId; 4th arg is the current coord's
    // peerId.  A viewer that differs from the coord gets the
    // player-scope firewall projection — exactly what we want to
    // verify preserves intentionUnderPressure.
    const playerDoc = serializeSessionForViewer(
      dm.events(),
      CAMPAIGN,
      'player-atticus',
      'dm-markus'
    );
    const playerJson = stringifySave(playerDoc);
    const playerParsed = parseSaveDocument(playerJson);
    expect(playerParsed.ok).toBe(true);
    if (!playerParsed.ok) return;
    const playerFresh = new EventLog('fresh-player');
    applySaveToLog(playerFresh, playerParsed.doc);
    const playerState = materialize(playerFresh.events());
    expect(playerState.synthesizedPcs['pc-mia']?.intentionUnderPressure).toBe(
      intention
    );
  });

  it('non-ASCII name and pronouns survive cleanly', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('dm-markus', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    emitPcCreate(
      dm,
      'pc-yuki',
      'Yúki "Snowdrop" Ø',
      'they/them (新)',
      'Backstory with em-dash — and curly "quotes" and a heart ❤.'
    );
    await flush();

    const json = stringifySave(
      serializeSession(dm.events(), CAMPAIGN, 'dm-markus')
    );
    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const fresh = new EventLog('fresh-dm');
    applySaveToLog(fresh, parsed.doc);
    const state = materialize(fresh.events());
    const pc = state.synthesizedPcs['pc-yuki'];
    expect(pc.name).toBe('Yúki "Snowdrop" Ø');
    expect(pc.pronouns).toBe('they/them (新)');
    expect(pc.backstory).toContain('❤');
  });
});

describe('Chargen polish — pc-create is first-write-wins (locked)', () => {
  it('re-emitting pc-create with the same pcId does NOT change the name', async () => {
    // This LOCKS the current behavior: pc-create is first-write-
    // wins (state.ts:2531).  A future redesign that wants to allow
    // post-acceptance name changes will have to either:
    //   (a) add a `pc-rename` event kind, or
    //   (b) drop the first-write-wins guard and allow pc-create
    //       overwrite (and re-classify the firewall implications).
    // Until that happens, an attempted "rename via re-emit" silently
    // no-ops.  This is GAP-A, filed as OP-045.
    const net = new InMemoryNetwork();
    const dm = makePeer('dm-markus', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});

    emitPcCreate(dm, 'pc-mei', 'Mei Tanaka', 'she/her', 'first backstory');
    await flush();

    // DM tries to "rename" by re-emitting pc-create with same pcId.
    emitPcCreate(
      dm,
      'pc-mei',
      'Mei Tanaka-Tan', // attempted rename
      'they/them', // attempted pronoun change
      'updated backstory'
    );
    await flush();

    const state = dm.state();
    const pc = state.synthesizedPcs['pc-mei'];
    // Locked: first-write-wins.  The rename silently failed.
    expect(pc.name).toBe('Mei Tanaka');
    expect(pc.pronouns).toBe('she/her');
    expect(pc.backstory).toBe('first backstory');
  });
});

describe('Chargen polish — applyCharacterEdits supports name/pronouns/backstory (OP-045 FIXED, run #14)', () => {
  // applyCharacterEdits handles harm, stress, marks, advancements,
  // magicPhase, tax.*, dmNotes, etc.  Run #14 closes OP-045 by
  // adding name/pronouns/backstory branches with caps matching the
  // pc-create materializer.  A pc-edit with field='name' lands in
  // pcEdits[pcId]; effectiveCharacter() merges via
  // applyCharacterEdits, which now applies the rename.
  //
  // These tests pin the FIXED behavior.  The locked-broken versions
  // were flipped in run #14 alongside the engine change.

  const baseRecord = {
    pcId: 'pc-mei',
    name: 'Mei Tanaka',
    pronouns: 'she/her',
    tags: ['scholar', 'curious', 'quiet'],
    stats: { str: 0, dex: 0, con: 0, int: 1, wis: 1, cha: 0 },
    skills: ['Lore'],
    backstory: 'original backstory'
  } as unknown as CharacterRecord;

  it('applyCharacterEdits applies a name edit (OP-045 fixed)', () => {
    const after = applyCharacterEdits(baseRecord, { name: 'Mei Tanaka-Tan' });
    expect(after.name).toBe('Mei Tanaka-Tan');
  });

  it('applyCharacterEdits applies a pronouns edit', () => {
    const after = applyCharacterEdits(baseRecord, { pronouns: 'they/them' });
    expect(after.pronouns).toBe('they/them');
  });

  it('applyCharacterEdits applies a backstory edit', () => {
    const after = applyCharacterEdits(baseRecord, {
      backstory: 'revised backstory after first session'
    });
    expect(after.backstory).toBe('revised backstory after first session');
  });

  it('applyCharacterEdits rejects an empty-string name (matches pc-create rule)', () => {
    const after = applyCharacterEdits(baseRecord, { name: '' });
    expect(after.name).toBe('Mei Tanaka');
  });

  it('applyCharacterEdits accepts an empty-string pronouns (clears the field)', () => {
    // pronouns is optional in pc-create; empty string clears it.
    const after = applyCharacterEdits(baseRecord, { pronouns: '' });
    expect(after.pronouns).toBe('');
  });

  it('applyCharacterEdits rejects a name longer than 80 chars (matches pc-create cap)', () => {
    const tooLong = 'a'.repeat(81);
    const after = applyCharacterEdits(baseRecord, { name: tooLong });
    expect(after.name).toBe('Mei Tanaka');
  });

  it('applyCharacterEdits rejects a backstory longer than 8000 chars', () => {
    const tooLong = 'a'.repeat(8001);
    const after = applyCharacterEdits(baseRecord, { backstory: tooLong });
    expect(after.backstory).toBe('original backstory');
  });

  it('applyCharacterEdits ignores a non-string name (defense)', () => {
    const after = applyCharacterEdits(baseRecord, {
      name: 42 as unknown as string
    });
    expect(after.name).toBe('Mei Tanaka');
  });

  it('round-trip: pc-edit field=name survives save → restore (OP-045 closes the loop)', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('dm-markus', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    emitPcCreate(dm, 'pc-mei', 'Mei', 'she/her', 'original backstory');
    await flush();
    dm.append('pc-edit', {
      pcId: 'pc-mei',
      field: 'name',
      value: 'Mei Tanaka-Tan'
    });
    await flush();

    const doc = serializeSession(dm.events(), CAMPAIGN, 'dm-markus');
    const json = stringifySave(doc);
    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const fresh = new EventLog('fresh-dm');
    applySaveToLog(fresh, parsed.doc);
    const state = materialize(fresh.events());
    // The pc-edit lands in pcEdits[pcId][name].
    expect(state.pcEdits['pc-mei']).toMatchObject({ name: 'Mei Tanaka-Tan' });
    // The effectiveCharacter merge picks it up.
    const merged = applyCharacterEdits(
      state.synthesizedPcs['pc-mei'] as CharacterRecord,
      state.pcEdits['pc-mei']
    );
    expect(merged.name).toBe('Mei Tanaka-Tan');
  });
});

describe('Chargen polish — numeric pc-edits round-trip + firewall holds', () => {
  it('harm + stress edits survive save → restore', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('dm-markus', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    emitPcCreate(dm, 'pc-mei', 'Mei', 'she/her', 'backstory');
    await flush();
    dm.append('pc-edit', {
      pcId: 'pc-mei',
      field: 'harm',
      value: 2
    });
    dm.append('pc-edit', {
      pcId: 'pc-mei',
      field: 'stress',
      value: 3
    });
    await flush();

    const doc = serializeSession(dm.events(), CAMPAIGN, 'dm-markus');
    const json = stringifySave(doc);
    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const fresh = new EventLog('fresh-dm');
    applySaveToLog(fresh, parsed.doc);
    const state = materialize(fresh.events());
    expect(state.pcEdits['pc-mei']).toEqual({ harm: 2, stress: 3 });
  });

  it('player-side save excludes DM-only chargen fields (firewall holds)', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('dm-markus', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    // pc-create with a DM-only sub-field (dmNotes).  These are
    // stripped from non-coord projections per the firewall.
    dm.append('pc-create', {
      v: 1,
      pcId: 'pc-mei',
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 0, con: 0, int: 1, wis: 0, cha: 0 },
      skills: ['Lore'],
      backstory: 'safe backstory',
      // DM-only — must not appear in a player save.
      dmNotes: 'this is a DM-only spoiler about Mei'
    });
    await flush();

    // Player serializes (firewall-filtered) save.
    const playerDoc = serializeSessionForViewer(
      dm.events(),
      CAMPAIGN,
      'anya', // not coord
      dm.state().coordinator
    );
    const playerJson = stringifySave(playerDoc);
    // DM-only material must not appear in the player save.
    expect(playerJson).not.toContain('dmNotes');
    expect(playerJson).not.toContain('DM-only spoiler');
    // Player-safe material must remain.
    expect(playerJson).toContain('Mei');
    expect(playerJson).toContain('safe backstory');
  });

  it('coord-projection save preserves DM-only chargen fields', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('dm-markus', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('pc-create', {
      v: 1,
      pcId: 'pc-mei',
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 0, con: 0, int: 1, wis: 0, cha: 0 },
      skills: ['Lore'],
      backstory: 'safe backstory',
      dmNotes: 'this is a DM-only spoiler about Mei'
    });
    await flush();

    const dmDoc = serializeSessionForViewer(
      dm.events(),
      CAMPAIGN,
      'dm-markus', // coord
      dm.state().coordinator
    );
    const dmJson = stringifySave(dmDoc);
    expect(dmJson).toContain('DM-only spoiler');
  });
});

describe('Chargen polish — restore-side projection preserves firewall on cross-device load', () => {
  it('projectSaveForViewer with viewerIsCoord=false strips DM-only chargen sub-fields', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('dm-markus', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('pc-create', {
      v: 1,
      pcId: 'pc-mei',
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 0, con: 0, int: 1, wis: 0, cha: 0 },
      skills: ['Lore'],
      backstory: 'safe',
      dmNotes: 'leak-target'
    });
    await flush();

    // DM saves the full coord projection.
    const dmDoc = serializeSession(dm.events(), CAMPAIGN, 'dm-markus');
    const json = stringifySave(dmDoc);
    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Player loads via projectSaveForViewer (the restore-side
    // firewall NEW-ADV-1).
    const playerProjection = projectSaveForViewer(parsed.doc, false);
    const playerJson = stringifySave(playerProjection);
    expect(playerJson).not.toContain('dmNotes');
    expect(playerJson).not.toContain('leak-target');
  });
});

describe('Chargen polish — mid-chargen draft preservation (lives outside event log)', () => {
  // Mid-chargen drafts (the player's in-progress chargen UI state)
  // live in localStorage + chargen-pack-deliver event, NOT in
  // synthesizedPcs (the DM only ratifies via pc-create).  This
  // test pins the current behavior: chargen-pack-deliver survives
  // save/restore round-trip with the answers + slot intact.

  it('chargen-pack-deliver event survives save/restore round-trip', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('dm-markus', net);
    const player = makePeer('anya', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    player.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});

    // Player submits a chargen pack mid-chargen.
    player.append('chargen-pack-deliver', {
      v: 1,
      slot: 2,
      pack: {
        $schemaVersion: '0.1.0',
        campaignFingerprint: 'fp-abc',
        slot: 2,
        chosenPath: 'qa+ai',
        answers: { name: 'Anya', pronouns: 'they/them', backstory: 'tbd' },
        packedAt: 1_700_000_000_000
      }
    });
    await flush();

    // DM saves.
    const doc = serializeSession(dm.events(), CAMPAIGN, 'dm-markus');
    const json = stringifySave(doc);
    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Restore.
    const fresh = new EventLog('fresh-dm');
    applySaveToLog(fresh, parsed.doc);
    const state = materialize(fresh.events());
    expect(state.pendingChargenPacks).toHaveLength(1);
    expect(state.pendingChargenPacks[0].slot).toBe(2);
    expect(
      (state.pendingChargenPacks[0].pack.answers as { name?: string }).name
    ).toBe('Anya');
  });
});

describe('Chargen polish — byte-identical roundtrip on full chargen flow', () => {
  it('chargen-pack-deliver → pc-create → pc-edit chain round-trips byte-identically', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('dm-markus', net);
    const player = makePeer('anya', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    player.append('peer-join', { name: 'Anya', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});

    player.append('chargen-pack-deliver', {
      v: 1,
      slot: 2,
      pack: {
        $schemaVersion: '0.1.0',
        campaignFingerprint: 'fp-abc',
        slot: 2,
        chosenPath: 'qa+ai',
        answers: { name: 'Anya' },
        packedAt: 1_700_000_000_000
      }
    });
    await flush();
    emitPcCreate(dm, 'pc-anya', 'Anya', 'they/them', 'backstory');
    dm.append('chargen-pack-clear', { v: 1, senderPeerId: 'anya', slot: 2 });
    dm.append('pc-edit', {
      pcId: 'pc-anya',
      field: 'harm',
      value: 1
    });
    await flush();

    const doc = serializeSession(dm.events(), CAMPAIGN, 'dm-markus');
    const json1 = stringifySave(doc);
    const parsed = parseSaveDocument(json1);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const json2 = stringifySave(parsed.doc);
    expect(json2).toBe(json1);
  });
});

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

describe('Chargen polish — applyCharacterEdits gap for name/pronouns/backstory (GAP-A / OP-045)', () => {
  // applyCharacterEdits handles harm, stress, marks, advancements,
  // magicPhase, tax.*, etc. — but NOT name, pronouns, or backstory.
  // A pc-edit with field='name' lands in pcEdits[pcId] but
  // effectiveCharacter() merges it via applyCharacterEdits, which
  // has no name-branch and silently drops it.
  //
  // This is the locked rename-via-pc-edit gap.  These tests pin the
  // BROKEN behavior so a future fix surfaces as a test update, not
  // a silent flip.

  const baseRecord = {
    pcId: 'pc-mei',
    name: 'Mei Tanaka',
    pronouns: 'she/her',
    tags: ['scholar', 'curious', 'quiet'],
    stats: { str: 0, dex: 0, con: 0, int: 1, wis: 1, cha: 0 },
    skills: ['Lore'],
    backstory: 'original backstory'
  } as unknown as CharacterRecord;

  it('LOCKED-BROKEN: applyCharacterEdits ignores a name edit (GAP-A)', () => {
    const after = applyCharacterEdits(baseRecord, { name: 'Mei Tanaka-Tan' });
    // GAP-A: applyCharacterEdits has no handler for 'name'.
    // The edit lands in pcEdits but is silently dropped on merge.
    expect(after.name).toBe('Mei Tanaka');
  });

  it('LOCKED-BROKEN: applyCharacterEdits ignores a pronouns edit (GAP-A)', () => {
    const after = applyCharacterEdits(baseRecord, { pronouns: 'they/them' });
    expect(after.pronouns).toBe('she/her');
  });

  it('LOCKED-BROKEN: applyCharacterEdits ignores a backstory edit (GAP-A)', () => {
    const after = applyCharacterEdits(baseRecord, {
      backstory: 'revised backstory'
    });
    expect(after.backstory).toBe('original backstory');
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

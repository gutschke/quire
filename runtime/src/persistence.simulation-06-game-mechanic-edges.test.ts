// @vitest-environment node

/**
 * Mock Campaign 06 — Game-mechanic edges through save/restore.
 *
 * Doc: `design/save-restore-program/simulations/mock-campaign-06-
 * game-mechanic-edges.md` — read that for the scenario brief,
 * per-turn script, and full invariants.  This file is the code-
 * level simulation.
 *
 * Drives the system to its mechanical limits (harm to max, stress
 * to max, advancement cap, bond limit, focus-grant "many",
 * pc-retire, co-DM yield with partial scene reveal) and verifies
 * save/restore + render correctness at each edge.
 *
 * Run with `npx vitest run src/persistence.simulation-06-game-
 * mechanic-edges.test.ts`.
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
  stringifySave,
  applySaveToLog
} from './persistence';
import { EventLog } from './core/event-log';
import { materialize } from './core/state';
import { applyCharacterEdits, HARM_MAX, STRESS_MAX } from './character-edits';
import {
  packChargen,
  MAX_BOND_DRAFTS,
  ChargenPackError
} from './chargen-pack';
import { ADVANCEMENT_CAP } from './character-loader';
import type { CharacterRecord } from './character-loader';

const CAMPAIGN = { owner: 'gutschke', repo: 'underleaf', ref: 'main' };

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

/**
 * Apply a save body to a fresh peer's log, materialize, and return
 * the resulting state.  Asserts the save parses cleanly.  Useful
 * for "restore + render" steps where we don't need to spin up a
 * real Peer.
 */
function restoreToState(saveBody: string, loaderPeerId: string = 'loader') {
  const parsed = parseSaveDocument(saveBody);
  if (!parsed.ok) {
    throw new Error(`parse failed: ${JSON.stringify(parsed)}`);
  }
  const log = new EventLog(loaderPeerId);
  const apply = applySaveToLog(log, parsed.doc);
  if (apply.rejected > 0 || apply.errors.length > 0) {
    throw new Error(`apply had rejects: ${JSON.stringify(apply)}`);
  }
  return {
    log,
    state: materialize(log.events())
  };
}

describe('Mock Campaign 06 — Game-mechanic edges through save/restore', () => {
  // -----------------------------------------------------------
  // 1) Harm to max + save/restore + firewall.
  // -----------------------------------------------------------
  it('harm pushed to max (4) survives save/restore + render shows out-of-action', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const mei = makePeer('mei-player', net);
    const anya = makePeer('anya-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    mei.append('peer-join', { name: 'Mei-player', knownKindsCount: 200 });
    anya.append('peer-join', { name: 'Anya-player', knownKindsCount: 200 });

    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    dm.append('seat-add', { v: 1, slot: 2 });
    appendCreatePc(dm, 'mei', 'Mei');
    appendCreatePc(dm, 'anya', 'Anya');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    dm.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'anya' });

    mei.append('peer-rename', { pcId: 'mei', name: 'Mei-player' });
    anya.append('peer-rename', { pcId: 'anya', name: 'Anya-player' });

    await flush();

    // Mei takes the killing-blow hit.  Direct DM edit on the harm
    // field — applyCharacterEdits clamps to HARM_MAX.
    dm.append('pc-edit', { v: 1, pcId: 'mei', field: 'harm', value: 4 });

    await flush();

    const dmState = dm.state();
    const meiEditsHarm = dmState.pcEdits['mei']?.['harm'];
    expect(meiEditsHarm).toBe(4);

    // Effective character on the DM side: harm clamps to HARM_MAX=4.
    const meiBase = dmState.synthesizedPcs['mei'] as CharacterRecord;
    const meiEffective = applyCharacterEdits(meiBase, dmState.pcEdits['mei']);
    expect(meiEffective.harm).toBe(HARM_MAX);
    expect(HARM_MAX).toBe(4);

    // Even if a hostile peer wrote harm: 99 directly into pcEdits
    // (DEC-023 class 3 = out of scope), the render-time clamp still
    // protects.  Spot-check:
    const overcap = applyCharacterEdits(meiBase, { harm: 99 });
    expect(overcap.harm).toBe(4);

    // Save the DM-coord projection.
    const dmSave = serializeSession(dm.events(), CAMPAIGN, dm.peerId);
    const body = stringifySave(dmSave);

    // Round-trip the save through parse + applySaveToLog.
    const restored = restoreToState(body);
    const meiRestoredBase = restored.state.synthesizedPcs[
      'mei'
    ] as CharacterRecord;
    const meiRestoredEffective = applyCharacterEdits(
      meiRestoredBase,
      restored.state.pcEdits['mei']
    );
    expect(meiRestoredEffective.harm).toBe(4);

    // Player-side autosave: harm is player-visible (pc-edit harm
    // stays).  Anya's autosave does NOT contain Mei's pcEdits as
    // a render thing (cross-PC firewall is in filterForViewer at
    // render); the EVENT itself ships because `harm` is not a
    // DM-only field.  That's fine — render-layer filterForViewer
    // gates cross-PC visibility.
    const meiAutosave = serializeSessionForViewer(
      mei.events(),
      CAMPAIGN,
      mei.peerId,
      dm.peerId
    );
    const meiAutosaveBody = stringifySave(meiAutosave);
    const meiRestoredFromAutosave = restoreToState(meiAutosaveBody);
    const meiAuto = meiRestoredFromAutosave.state.pcEdits['mei']?.['harm'];
    expect(meiAuto).toBe(4); // harm is player-visible on the bound PC

    // Non-coord viewer render (Mei's own perspective): she sees
    // her own harm.
    const meiViewerFiltered = filterForViewer(
      restored.state,
      mei.peerId
    );
    expect(meiViewerFiltered.pcEdits['mei']?.['harm']).toBe(4);

    // Cross-PC visibility of harm IS player-visible by design.
    // Harm is a table-talk public stat (rules.md:131 — the harm
    // track is a public clock at the table; other players need
    // to see it to roleplay reaction).  The firewall protects
    // DM-only fields (dmNotes, magicPhase, tax.*), NOT physical
    // stats like harm/stress.  Anya CAN see Mei's harm.  This is
    // intentional — see the per-field strip in
    // `core/state.ts:filteredPcEdits` (DM_ONLY_CHARACTER_FIELDS).
    const anyaViewerFiltered = filterForViewer(
      restored.state,
      anya.peerId
    );
    expect(anyaViewerFiltered.pcEdits['mei']?.['harm']).toBe(4);
  });

  // -----------------------------------------------------------
  // 2) Stress to max.
  // -----------------------------------------------------------
  it('stress pushed to max (4) survives save/restore + clamps render', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const mei = makePeer('mei-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    mei.append('peer-join', { name: 'Mei-player', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    appendCreatePc(dm, 'mei', 'Mei');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    mei.append('peer-rename', { pcId: 'mei', name: 'Mei-player' });
    await flush();

    dm.append('pc-edit', { v: 1, pcId: 'mei', field: 'stress', value: 4 });
    await flush();

    const dmState = dm.state();
    const meiBase = dmState.synthesizedPcs['mei'] as CharacterRecord;
    const meiEffective = applyCharacterEdits(meiBase, dmState.pcEdits['mei']);
    expect(meiEffective.stress).toBe(STRESS_MAX);
    expect(STRESS_MAX).toBe(4);

    // Over-cap clamp regression.
    const over = applyCharacterEdits(meiBase, { stress: 100 });
    expect(over.stress).toBe(4);

    // Round-trip.
    const body = stringifySave(
      serializeSession(dm.events(), CAMPAIGN, dm.peerId)
    );
    const restored = restoreToState(body);
    const restoredEffective = applyCharacterEdits(
      restored.state.synthesizedPcs['mei'] as CharacterRecord,
      restored.state.pcEdits['mei']
    );
    expect(restoredEffective.stress).toBe(4);
  });

  // -----------------------------------------------------------
  // 3) Advancement cap UX + save/restore.
  // -----------------------------------------------------------
  it('advancement cap (8) survives save/restore + render gates chip', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    appendCreatePc(dm, 'anya', 'Anya');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'anya' });
    await flush();

    // Push to cap.
    dm.append('pc-edit', {
      v: 1,
      pcId: 'anya',
      field: 'advancements',
      value: 8
    });
    await flush();

    const dmState = dm.state();
    const anyaBase = dmState.synthesizedPcs['anya'] as CharacterRecord;
    const anyaEffective = applyCharacterEdits(
      anyaBase,
      dmState.pcEdits['anya']
    );
    expect(anyaEffective.advancements).toBe(8);
    expect(ADVANCEMENT_CAP).toBe(8);

    // The session-open-stage carryover card flips to a "cap
    // reached" chip at advancements >= 8 (see
    // session-open-stage.ts:266-269 + .test.ts:129).  That's a
    // UI-render concern; here we assert the underlying data the
    // carryover card consumes is preserved on save/restore.
    const body = stringifySave(
      serializeSession(dm.events(), CAMPAIGN, dm.peerId)
    );
    const restored = restoreToState(body);
    const anyaRestoredEffective = applyCharacterEdits(
      restored.state.synthesizedPcs['anya'] as CharacterRecord,
      restored.state.pcEdits['anya']
    );
    expect(anyaRestoredEffective.advancements).toBe(8);

    // -----------------------------------------------------------
    // OP-044 FIX (run #12): pc-edit now clamps `advancements` at
    // ADVANCEMENT_CAP (8).  A pc-edit writing value=9 is clamped
    // to 8 on the way in; the engine no longer accepts over-cap
    // values.  Defense-in-depth alongside the UI render gate.
    // -----------------------------------------------------------
    dm.append('pc-edit', {
      v: 1,
      pcId: 'anya',
      field: 'advancements',
      value: 9
    });
    await flush();
    const anyaOver = applyCharacterEdits(
      dm.state().synthesizedPcs['anya'] as CharacterRecord,
      dm.state().pcEdits['anya']
    );
    expect(anyaOver.advancements).toBe(8);
  });

  // -----------------------------------------------------------
  // 4) Bond drafts at cap — packChargen validator rejects > 3.
  // -----------------------------------------------------------
  it('chargen-pack rejects 4+ bond drafts (cap=3)', () => {
    const goodPack = packChargen({
      campaignFingerprint: 'fp-deadbeef',
      slot: 1,
      chosenPath: 'qa',
      answers: { name: 'Mei' },
      bondDrafts: [
        { targetPlaceholder: 'Ana', text: 'sister' },
        { targetPlaceholder: 'Mira', text: 'mentor' },
        { targetPlaceholder: 'The Quiet', text: 'rival' }
      ],
      nowMs: 1
    });
    expect(goodPack.bondDrafts?.length ?? 0).toBe(MAX_BOND_DRAFTS);

    // 4 drafts → throws ChargenPackError.
    expect(() =>
      packChargen({
        campaignFingerprint: 'fp-deadbeef',
        slot: 1,
        chosenPath: 'qa',
        answers: { name: 'Mei' },
        bondDrafts: [
          { targetPlaceholder: 'Ana', text: 'sister' },
          { targetPlaceholder: 'Mira', text: 'mentor' },
          { targetPlaceholder: 'The Quiet', text: 'rival' },
          { targetPlaceholder: 'Anya', text: 'partner' }
        ],
        nowMs: 1
      })
    ).toThrow(ChargenPackError);
  });

  // -----------------------------------------------------------
  // 5) Many foci — survive save/restore + firewall.
  // -----------------------------------------------------------
  it('10 focus-grants survive save/restore + DM-only sub-fields strip on player save', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const anya = makePeer('anya-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    anya.append('peer-join', { name: 'Anya-player', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    appendCreatePc(dm, 'anya', 'Anya');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'anya' });
    anya.append('peer-rename', { pcId: 'anya', name: 'Anya-player' });
    await flush();

    // Grant 10 foci with DM-only sub-fields populated.
    for (let i = 0; i < 10; i++) {
      dm.append('focus-grant', {
        v: 1,
        pcId: 'anya',
        focus: {
          id: `focus-${i}`,
          name: `Focus ${i}`,
          domain: 'craft',
          boundFor: `DM-PRIVATE-boundFor-${i}`,
          notes: `DM-PRIVATE-notes-${i}`
        }
      });
    }
    await flush();

    const dmState = dm.state();
    expect(dmState.pcFoci['anya']?.length ?? 0).toBe(10);

    // DM coord save → contains the boundFor + notes.
    const dmSaveBody = stringifySave(
      serializeSession(dm.events(), CAMPAIGN, dm.peerId)
    );
    expect(dmSaveBody).toContain('DM-PRIVATE-boundFor-0');
    expect(dmSaveBody).toContain('DM-PRIVATE-notes-9');

    // Anya's player autosave → boundFor + notes STRIPPED.
    const anyaAutosave = serializeSessionForViewer(
      anya.events(),
      CAMPAIGN,
      anya.peerId,
      dm.peerId
    );
    const anyaAutosaveBody = stringifySave(anyaAutosave);
    // Player save must not contain DM-private values.
    expect(anyaAutosaveBody).not.toContain('DM-PRIVATE-boundFor-0');
    expect(anyaAutosaveBody).not.toContain('DM-PRIVATE-notes-9');
    // But it MUST contain the player-safe name + domain + id.
    expect(anyaAutosaveBody).toContain('Focus 0');
    expect(anyaAutosaveBody).toContain('Focus 9');
    expect(anyaAutosaveBody).toContain('focus-0');

    // Project the DM save for a non-coord viewer (the projection
    // helper used by, e.g., the cross-device probe) — same
    // strip behavior.
    const dmSaveParsed = parseSaveDocument(dmSaveBody);
    if (!dmSaveParsed.ok) throw new Error('parse failed');
    const projected = projectSaveForViewer(
      dmSaveParsed.doc,
      /* viewerIsCoord */ false
    );
    const projectedBody = stringifySave(projected);
    expect(projectedBody).not.toContain('DM-PRIVATE-boundFor');
    expect(projectedBody).not.toContain('DM-PRIVATE-notes');
    expect(projectedBody).toContain('Focus 5');

    // Restore Anya's player save on a fresh log + materialize.
    const restored = restoreToState(anyaAutosaveBody);
    // All 10 foci survived as player-visible entries.
    expect(restored.state.pcFoci['anya']?.length ?? 0).toBe(10);
    // None of the foci carry boundFor or notes after round-trip.
    for (const f of restored.state.pcFoci['anya'] ?? []) {
      expect((f as unknown as Record<string, unknown>)['boundFor']).toBeUndefined();
      expect((f as unknown as Record<string, unknown>)['notes']).toBeUndefined();
    }
  });

  // -----------------------------------------------------------
  // 6) PC retire mid-session + firewall on retire metadata.
  // -----------------------------------------------------------
  it('pc-retire: DM-only reason + scene stripped from player save; player-safe fields survive', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const mei = makePeer('mei-player', net);
    const anya = makePeer('anya-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    mei.append('peer-join', { name: 'Mei-player', knownKindsCount: 200 });
    anya.append('peer-join', { name: 'Anya-player', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    dm.append('seat-add', { v: 1, slot: 2 });
    appendCreatePc(dm, 'mei', 'Mei');
    appendCreatePc(dm, 'anya', 'Anya');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    dm.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'anya' });
    mei.append('peer-rename', { pcId: 'mei', name: 'Mei-player' });
    anya.append('peer-rename', { pcId: 'anya', name: 'Anya-player' });
    await flush();

    // Mei retires mid-session.
    dm.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      reason: 'died',
      scene: 'ep04/scene-07-the-quiet-took-her', // DM-private spoiler path
      inFictionReason: 'Mei walked into the silence.',
      seatMemory: 'She heard them and answered.'
    });
    await flush();

    // DM-side state: seat is bound-retired, has DM-private retire
    // metadata.
    const dmState = dm.state();
    const meiSeat = dmState.pcSlots[1];
    expect(meiSeat?.state).toBe('bound-retired');
    expect(meiSeat?.retireReason).toBe('died');
    expect(meiSeat?.retiredScene).toBe('ep04/scene-07-the-quiet-took-her');
    expect(meiSeat?.inFictionRetireReason).toBe('Mei walked into the silence.');
    expect(meiSeat?.seatMemory).toBe('She heard them and answered.');

    // Anya-viewer filtered render: sees state + inFictionReason +
    // seatMemory; does NOT see retireReason / retiredScene.
    const anyaFiltered = filterForViewer(dmState, anya.peerId);
    const meiSeatFiltered = anyaFiltered.pcSlots[1];
    expect(meiSeatFiltered?.state).toBe('bound-retired');
    expect(meiSeatFiltered?.inFictionRetireReason).toBe(
      'Mei walked into the silence.'
    );
    expect(meiSeatFiltered?.seatMemory).toBe('She heard them and answered.');
    // Filtered seats DROP the DM-only retire metadata.
    expect(meiSeatFiltered?.retireReason).toBeUndefined();
    expect(meiSeatFiltered?.retiredScene).toBeUndefined();
    expect(meiSeatFiltered?.retiredAt).toBeUndefined();

    // Anya's player autosave: persist the events.  The pc-retire
    // event itself MUST have `reason` and `scene` stripped
    // (B-1 BLOCKER per persistence.ts:99).
    const anyaAutosave = serializeSessionForViewer(
      anya.events(),
      CAMPAIGN,
      anya.peerId,
      dm.peerId
    );
    const anyaAutosaveBody = stringifySave(anyaAutosave);
    expect(anyaAutosaveBody).toContain('Mei walked into the silence.');
    expect(anyaAutosaveBody).toContain('She heard them and answered.');
    expect(anyaAutosaveBody).not.toContain(
      'ep04/scene-07-the-quiet-took-her'
    );
    // The `reason` ('died') is so common it might appear in benign
    // contexts; check the actual pc-retire event payload.
    const pcRetireEvents = anyaAutosave.events.filter(
      (e) => e.kind === 'pc-retire'
    );
    expect(pcRetireEvents.length).toBe(1);
    const payload = pcRetireEvents[0].payload as Record<string, unknown>;
    expect(payload['reason']).toBeUndefined();
    expect(payload['scene']).toBeUndefined();
    // But player-safe fields are preserved.
    expect(payload['state']).toBe('bound-retired');
    expect(payload['inFictionReason']).toBe('Mei walked into the silence.');
    expect(payload['seatMemory']).toBe('She heard them and answered.');

    // -----------------------------------------------------------
    // OP-043 FIX (run #12): pc-retire materializer now tolerates
    // `p.reason === undefined` (firewall-stripped).  A player who
    // restores their own autosave (or loads a save via §FS.11
    // cross-device probe as non-coord) sees the retired seat
    // materialize as `bound-retired` — the player-safe fields
    // (`inFictionRetireReason`, `seatMemory`) survive, the DM-only
    // fields (`retireReason`, `retiredScene`) remain unset.
    //
    // Same SSOT-correct shape as `scrubMapBlobIfUnrevealed`:
    // keep the event, drop the sub-field, materializer tolerates.
    // -----------------------------------------------------------
    const restored = restoreToState(anyaAutosaveBody);
    const meiSeatRestored = restored.state.pcSlots[1];
    expect(meiSeatRestored?.state).toBe('bound-retired');
    expect(meiSeatRestored?.inFictionRetireReason).toBe(
      'Mei walked into the silence.'
    );
    expect(meiSeatRestored?.seatMemory).toBe('She heard them and answered.');
    // DM-only metadata is absent on player restore (firewall stripped).
    expect(meiSeatRestored?.retireReason).toBeUndefined();
    expect(meiSeatRestored?.retiredScene).toBeUndefined();
  });

  // FINDING-B regression: verify a DM-coord restore DOES preserve
  // retire metadata correctly.  This nails down the asymmetry the
  // bug creates — DM path works, player path doesn't.
  it('pc-retire DM-coord save round-trip preserves retired-tile state', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    appendCreatePc(dm, 'mei', 'Mei');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    dm.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      reason: 'died',
      scene: 'ep04/scene-07',
      inFictionReason: 'Mei walked into the silence.',
      seatMemory: 'She heard them and answered.'
    });
    await flush();

    const body = stringifySave(
      serializeSession(dm.events(), CAMPAIGN, dm.peerId)
    );
    const restored = restoreToState(body);
    const meiSeat = restored.state.pcSlots[1];
    expect(meiSeat?.state).toBe('bound-retired');
    expect(meiSeat?.retireReason).toBe('died');
    expect(meiSeat?.retiredScene).toBe('ep04/scene-07');
    expect(meiSeat?.inFictionRetireReason).toBe(
      'Mei walked into the silence.'
    );
    expect(meiSeat?.seatMemory).toBe('She heard them and answered.');
  });

  // -----------------------------------------------------------
  // 7) Co-DM yield with half-completed scene reveal.
  // -----------------------------------------------------------
  it('co-DM yield preserves the half-completed scene-reveal mask through save/restore', async () => {
    const net = new InMemoryNetwork();
    const dm1 = makePeer('markus', net);
    const dm2 = makePeer('alex-co-dm', net);
    const anya = makePeer('anya-player', net);

    dm1.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm2.append('peer-join', { name: 'Alex', knownKindsCount: 200 });
    anya.append('peer-join', { name: 'Anya-player', knownKindsCount: 200 });
    dm1.append('coordinator-claim', {});
    dm1.append('seat-add', { v: 1, slot: 1 });
    appendCreatePc(dm1, 'anya', 'Anya');
    dm1.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'anya' });
    anya.append('peer-rename', { pcId: 'anya', name: 'Anya-player' });

    await flush();

    // Reveal scene + 2 of 4 paragraph blocks.
    dm1.append('scene-reveal', { scenePath: 'ep04/scene-07' });
    dm1.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'ep04/scene-07',
      blockHash: '0123456789abcdef'
    });
    dm1.append('scene-reveal-paragraph', {
      v: 1,
      scenePath: 'ep04/scene-07',
      blockHash: 'fedcba9876543210'
    });

    await flush();

    // Co-DM takes over.
    dm1.append('coordinator-yield', {});
    dm2.append('coordinator-claim', {});

    await flush();

    const dm2State = dm2.state();
    // Scene is revealed.
    expect(dm2State.revealedScenes).toContain('ep04/scene-07');
    // 2 of 4 paragraph blocks marked.
    const blocks = dm2State.revealedParagraphs['ep04/scene-07'];
    expect(blocks?.size ?? 0).toBe(2);
    expect(blocks?.has('0123456789abcdef')).toBe(true);
    expect(blocks?.has('fedcba9876543210')).toBe(true);

    // Co-DM saves the DM-coord projection.
    const dm2SaveBody = stringifySave(
      serializeSession(dm2.events(), CAMPAIGN, dm2.peerId)
    );
    const restored = restoreToState(dm2SaveBody);
    expect(restored.state.revealedScenes).toContain('ep04/scene-07');
    const restoredBlocks =
      restored.state.revealedParagraphs['ep04/scene-07'];
    expect(restoredBlocks?.size ?? 0).toBe(2);
    expect(restoredBlocks?.has('0123456789abcdef')).toBe(true);
    expect(restoredBlocks?.has('fedcba9876543210')).toBe(true);

    // Anya-viewer filtered: sees the partial reveal mask too.
    // scene-reveal + scene-reveal-paragraph are player-visible
    // kinds — Anya's filtered state should contain them.
    const anyaFiltered = filterForViewer(restored.state, anya.peerId);
    expect(anyaFiltered.revealedScenes).toContain('ep04/scene-07');
    const anyaBlocks = anyaFiltered.revealedParagraphs['ep04/scene-07'];
    expect(anyaBlocks?.size ?? 0).toBe(2);

    // Anya's player-side autosave (the scrubbed projection) also
    // preserves the partial reveal — these events are player-
    // visible by design (rendered prose IS the player's view).
    const anyaSaveBody = stringifySave(
      serializeSessionForViewer(
        anya.events(),
        CAMPAIGN,
        anya.peerId,
        dm1.peerId
      )
    );
    const anyaRestored = restoreToState(anyaSaveBody);
    expect(anyaRestored.state.revealedScenes).toContain('ep04/scene-07');
    expect(
      anyaRestored.state.revealedParagraphs['ep04/scene-07']?.size ?? 0
    ).toBe(2);
  });
});

// @vitest-environment node

/**
 * Save format stability — forward-compat contract tests.
 *
 * Pins the invariants in
 * `design/playtest-readiness/format-stability.md`.  These tests
 * are load-bearing: a future change that BREAKS one of these
 * invariants is a forward-compat regression and the team has
 * decided NO conversion tools are required.  See INV-1 through
 * INV-7 in the doc for the contract narrative.
 *
 * Each test names the INV it locks.  When a test fails: read the
 * INV, decide whether it's the test or the contract that needs to
 * change, and write a code-review-shape PR.  Never silently relax
 * a test here — the next playtest will pay the cost.
 */

import { describe, it, expect } from 'vitest';
import { EventLog, type QuireEvent } from './core/event-log';
import { materialize } from './core/state';
import {
  serializeSession,
  serializeSessionForViewer,
  stringifySave,
  parseSaveDocument,
  applySaveToLog,
  projectSaveForViewer,
  SAVE_SCHEMA_VERSION,
  type SaveDocument
} from './persistence';

const CAMPAIGN = { owner: 'gutschke', repo: 'underleaf', ref: 'main' };

function buildEvent(
  peerId: string,
  seq: number,
  kind: string,
  payload: unknown,
  ts: number
): QuireEvent {
  return {
    id: `${peerId}:${seq}`,
    peerId,
    seq,
    kind,
    payload,
    ts,
    clock: { [peerId]: seq }
  };
}

function baseSave(events: QuireEvent[] = []): string {
  const doc = serializeSession(events, CAMPAIGN, 'lead-peer');
  return stringifySave(doc);
}

describe('INV-1: unknown top-level fields round-trip', () => {
  it('parse preserves an unknown top-level field', () => {
    // Simulate a save written by a future runtime that added a
    // top-level `dmAnnotations` field.
    const future = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      campaign: CAMPAIGN,
      savedByPeerId: 'future-dm',
      events: [],
      dmAnnotations: { lastReadDigest: 'digest-1' },
      cloudSyncMetadata: 42
    };
    const futureJson = JSON.stringify(future);

    const parsed = parseSaveDocument(futureJson);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.doc.extraFields).toBeDefined();
    expect(parsed.doc.extraFields!.dmAnnotations).toEqual({
      lastReadDigest: 'digest-1'
    });
    expect(parsed.doc.extraFields!.cloudSyncMetadata).toBe(42);
  });

  it('stringify emits the preserved unknown fields back at top level', () => {
    const future = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'future-dm',
      events: [],
      dmAnnotations: { lastReadDigest: 'digest-1' },
      cloudSyncMetadata: 42
    };
    const futureJson = JSON.stringify(future);

    const parsed = parseSaveDocument(futureJson);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const rebuiltJson = stringifySave(parsed.doc);
    const reparsed = JSON.parse(rebuiltJson);
    expect(reparsed.dmAnnotations).toEqual({ lastReadDigest: 'digest-1' });
    expect(reparsed.cloudSyncMetadata).toBe(42);
    // And the known fields are still correct:
    expect(reparsed.$schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(reparsed.savedByPeerId).toBe('future-dm');
  });

  it('the rebuilt JSON does not leak our internal `extraFields` key', () => {
    const future = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'future-dm',
      events: [],
      dmAnnotations: { lastReadDigest: 'digest-1' }
    };
    const parsed = parseSaveDocument(JSON.stringify(future));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const rebuiltJson = stringifySave(parsed.doc);
    // `extraFields` is an internal runtime convenience; it must NOT
    // appear in the serialized output.  If it did, a future runtime
    // would see TWO competing top-level fields.
    expect(rebuiltJson).not.toContain('"extraFields"');
  });

  it('a save WITHOUT extra fields round-trips byte-identically', () => {
    const base = baseSave([]);
    const parsed = parseSaveDocument(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.extraFields).toBeUndefined();
    const rebuilt = stringifySave(parsed.doc);
    expect(rebuilt).toBe(base);
  });
});

describe('INV-2: unknown event-payload sub-fields round-trip', () => {
  it('a future-added sub-field on an event payload survives JSON serialize', () => {
    // Build an event with a hypothetical FUTURE sub-field.
    const futureEvent = buildEvent(
      'future-dm',
      1,
      'caster-state-set',
      {
        v: 1,
        pcId: 'pc-1',
        nextState: 'inFiction',
        // FUTURE sub-field a v2 runtime might add.  Today's
        // materializer ignores it; the on-disk JSON must preserve it.
        triggeredByNpcId: 'npc-mei'
      },
      1700000000000
    );

    const log = new EventLog('lead-peer');
    log.apply(futureEvent);

    const doc = serializeSession(log.events(), CAMPAIGN, 'lead-peer');
    const json = stringifySave(doc);
    expect(json).toContain('triggeredByNpcId');

    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // The event in the parsed doc retains the unknown sub-field
    // because EventLog stores events as opaque objects and
    // stableStringify recurses through them.
    const parsedEvent = parsed.doc.events[0] as QuireEvent & {
      payload: { triggeredByNpcId?: string };
    };
    expect(parsedEvent.payload.triggeredByNpcId).toBe('npc-mei');
  });

  it('byte-identical roundtrip with future sub-field present', () => {
    const futureEvent = buildEvent(
      'future-dm',
      1,
      'caster-state-set',
      {
        v: 1,
        pcId: 'pc-1',
        nextState: 'inFiction',
        triggeredByNpcId: 'npc-mei'
      },
      1700000000000
    );
    const log = new EventLog('lead-peer');
    log.apply(futureEvent);

    const json1 = stringifySave(
      serializeSession(log.events(), CAMPAIGN, 'lead-peer')
    );
    const parsed = parseSaveDocument(json1);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const json2 = stringifySave({
      ...parsed.doc,
      savedAt: parsed.doc.savedAt
    });
    expect(json2).toBe(json1);
  });
});

describe('INV-3: unknown event kinds round-trip + replicate', () => {
  it('a save containing a future-only event KIND parses without rejection', () => {
    // Build an event with a kind today's runtime doesn't know.
    const futureKindEvent = buildEvent(
      'future-dm',
      1,
      'session-mood-mark',
      { v: 1, mood: 'tense' },
      1700000000000
    );

    const log = new EventLog('lead-peer');
    log.apply(futureKindEvent);
    const doc = serializeSession(log.events(), CAMPAIGN, 'lead-peer');
    const json = stringifySave(doc);
    expect(json).toContain('session-mood-mark');

    // Today's parser accepts the save.  applySaveToLog counts the
    // event in unknownKinds but DOES apply it to the log.
    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const target = new EventLog('target-peer');
    const result = applySaveToLog(target, parsed.doc);
    expect(result.applied).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.unknownKinds).toBe(1);
    expect(target.events()).toHaveLength(1);
  });

  it('the unknown-kind event survives save → restore → save', () => {
    const futureKindEvent = buildEvent(
      'future-dm',
      1,
      'session-mood-mark',
      { v: 1, mood: 'tense' },
      1700000000000
    );

    const log1 = new EventLog('lead-peer');
    log1.apply(futureKindEvent);
    const json1 = stringifySave(
      serializeSession(log1.events(), CAMPAIGN, 'lead-peer')
    );

    const parsed1 = parseSaveDocument(json1);
    expect(parsed1.ok).toBe(true);
    if (!parsed1.ok) return;

    const log2 = new EventLog('target-peer');
    applySaveToLog(log2, parsed1.doc);

    const json2 = stringifySave(
      serializeSession(log2.events(), CAMPAIGN, 'target-peer')
    );
    // The event survives the round trip; both JSONs contain the
    // future-only kind.
    expect(json2).toContain('session-mood-mark');
  });

  it('materializer silently no-ops the unknown kind (forward-compat)', () => {
    const futureKindEvent = buildEvent(
      'future-dm',
      1,
      'session-mood-mark',
      { v: 1, mood: 'tense' },
      1700000000000
    );
    const log = new EventLog('lead-peer');
    log.apply(futureKindEvent);

    // materialize() over the log MUST NOT throw, even though
    // 'session-mood-mark' has no entry in MATERIALIZERS.
    expect(() => materialize(log.events())).not.toThrow();
  });
});

describe('INV-4: major version is the BREAK gate', () => {
  it('refuses to load a different MAJOR version', () => {
    const future = {
      $schemaVersion: '1.0.0', // major bump
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'future-dm',
      events: []
    };
    const parsed = parseSaveDocument(JSON.stringify(future));
    expect(parsed.ok).toBe(false);
  });

  it('accepts a MINOR version bump', () => {
    // Compute our minor + 1 to construct a future-but-same-major
    // version.
    const [major, minor, patch] = SAVE_SCHEMA_VERSION.split('.').map(Number);
    const futureMinor = `${major}.${minor + 1}.${patch}`;
    const future = {
      $schemaVersion: futureMinor,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'future-dm',
      events: []
    };
    const parsed = parseSaveDocument(JSON.stringify(future));
    expect(parsed.ok).toBe(true);
  });

  it('accepts a PATCH version bump', () => {
    const [major, minor, patch] = SAVE_SCHEMA_VERSION.split('.').map(Number);
    const futurePatch = `${major}.${minor}.${patch + 1}`;
    const future = {
      $schemaVersion: futurePatch,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'future-dm',
      events: []
    };
    const parsed = parseSaveDocument(JSON.stringify(future));
    expect(parsed.ok).toBe(true);
  });
});

describe('INV-5: stable stringify is canonical (key order)', () => {
  it('keys are sorted alphabetically regardless of insertion order', () => {
    // The interface defines field order one way; the SaveDocument
    // object literal puts them another; the output must always be
    // alphabetical.
    const doc: SaveDocument = {
      events: [],
      savedByPeerId: 'a',
      campaign: CAMPAIGN,
      savedAt: '2026-05-30T13:00:00.000Z',
      $schemaVersion: SAVE_SCHEMA_VERSION
    };
    const json = stringifySave(doc);

    // Top-level keys in the serialized JSON are alphabetically
    // sorted ($schemaVersion < campaign < events < savedAt <
    // savedByPeerId).
    const ix = (key: string) => json.indexOf(`"${key}"`);
    expect(ix('$schemaVersion')).toBeLessThan(ix('campaign'));
    expect(ix('campaign')).toBeLessThan(ix('events'));
    expect(ix('events')).toBeLessThan(ix('savedAt'));
    expect(ix('savedAt')).toBeLessThan(ix('savedByPeerId'));
  });

  it('extraFields keys sort alphabetically alongside known ones', () => {
    const future = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'future-dm',
      events: [],
      // Two future-only keys whose alphabetical position straddles
      // the known set:
      aFutureField: 'A',
      zFutureField: 'Z'
    };
    const parsed = parseSaveDocument(JSON.stringify(future));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const json = stringifySave(parsed.doc);

    // After flattening, the keys must still be alphabetically
    // sorted at top level.
    const ix = (key: string) => json.indexOf(`"${key}"`);
    expect(ix('$schemaVersion')).toBeLessThan(ix('aFutureField'));
    expect(ix('aFutureField')).toBeLessThan(ix('campaign'));
    expect(ix('savedByPeerId')).toBeLessThan(ix('zFutureField'));
  });
});

describe('INV-7: future v:2 payload silently no-ops', () => {
  it('materializer for a v:1 kind ignores a v:2 payload (does not throw)', () => {
    const v2Event = buildEvent(
      'future-dm',
      1,
      'caster-state-set',
      { v: 2, pcId: 'pc-1', somethingRenamed: 'value' },
      1700000000000
    );
    const log = new EventLog('lead-peer');
    log.apply(v2Event);

    // materialize must NOT throw — isPayloadV1 fails, materializer
    // returns.
    expect(() => materialize(log.events())).not.toThrow();
  });

  it('v:2 event still round-trips through save/restore', () => {
    const v2Event = buildEvent(
      'future-dm',
      1,
      'caster-state-set',
      { v: 2, pcId: 'pc-1', somethingRenamed: 'value' },
      1700000000000
    );
    const log = new EventLog('lead-peer');
    log.apply(v2Event);
    const json = stringifySave(
      serializeSession(log.events(), CAMPAIGN, 'lead-peer')
    );

    expect(json).toContain('"v": 2');
    expect(json).toContain('somethingRenamed');

    const parsed = parseSaveDocument(json);
    expect(parsed.ok).toBe(true);
  });
});

describe('INV-6 cross-check: materializer registry parity (sanity)', () => {
  // The real parity test lives in state.test.ts.  Here we
  // sanity-check from the persistence side: the save-format
  // contract presumes KNOWN_EVENT_KINDS and MATERIALIZER_KINDS
  // stay in sync, and applySaveToLog's unknownKinds counter
  // documents the consequence when they don't.
  it('exists and is exported (link to state.test.ts: "no orphaned ...")', async () => {
    const { KNOWN_EVENT_KINDS, MATERIALIZER_KINDS } = await import('./core/state');
    // If a future change drops MATERIALIZER_KINDS or KNOWN_EVENT_KINDS,
    // this import will break and the contract is broken.
    expect(KNOWN_EVENT_KINDS.size).toBeGreaterThan(0);
    expect(MATERIALIZER_KINDS.size).toBeGreaterThan(0);
  });
});

describe('INV-EXTRA-LOOP: extraFields survive the AUTOSAVE LOOP', () => {
  /**
   * Run-#14 forward-compat architect finding (P0 #1): the lead's
   * run-#13 INV-1 fix covered `parseSaveDocument → stringifySave`
   * round-trip, but NOT the realistic autosave loop:
   *
   *     parse → applySaveToLog → continue play → serializeSession →
   *     stringifySave
   *
   * Pre-fix `serializeSession` ignored the parsed-doc's extraFields,
   * so the future-runtime's top-level keys were silently dropped on
   * the FIRST autosave following load.  This test pins the full loop.
   */
  it('extraFields survive parse → applySaveToLog → serialize → stringify', () => {
    // Simulate a future runtime's save with a known top-level extra.
    const futureSave = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'future-dm',
      events: [],
      dmAnnotations: { lastReadDigest: 'digest-1', mood: 'tense' },
      cloudSyncMetadata: { hash: 'abc123' }
    };
    const futureJson = JSON.stringify(futureSave);

    // Step 1: parse the save (today's runtime).
    const parsed = parseSaveDocument(futureJson);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Step 2: apply to a fresh log (this is the autosave loop's
    // entry: the events go to disk via the EventLog, but the
    // top-level extras are NOT in the event log — they only live
    // on the SaveDocument).
    const log = new EventLog('today-peer');
    const loadResult = applySaveToLog(log, parsed.doc);
    expect(loadResult.applied).toBe(0); // no events in this save
    // P0 #1: applySaveToLog surfaces extraFields on LoadResult so
    // the caller can thread them back into serializeSession.
    expect(loadResult.extraFields).toBeDefined();
    expect(loadResult.extraFields).toEqual({
      dmAnnotations: { lastReadDigest: 'digest-1', mood: 'tense' },
      cloudSyncMetadata: { hash: 'abc123' }
    });

    // Step 3: continue play — append a local event.
    log.append('peer-join', { v: 1, name: 'today-dm' });

    // Step 4: autosave — serializeSession MUST be threaded the
    // loaded extraFields, or it sheds them silently.
    const doc = serializeSession(
      log.events(),
      CAMPAIGN,
      'today-peer',
      loadResult.extraFields
    );

    // Step 5: stringify + re-parse.  The future extras MUST survive.
    const json = stringifySave(doc);
    const reparsed = JSON.parse(json);
    expect(reparsed.dmAnnotations).toEqual({
      lastReadDigest: 'digest-1',
      mood: 'tense'
    });
    expect(reparsed.cloudSyncMetadata).toEqual({ hash: 'abc123' });
    // And the autosave loop's own event is present.
    expect(reparsed.events).toHaveLength(1);
    expect(reparsed.events[0].kind).toBe('peer-join');
  });

  it('extraFields survive parse → applySaveToLog → serializeSessionForViewer (PLAYER) → stringify', () => {
    // Same loop but through the player-projection serializer.
    const futureSave = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'future-dm',
      events: [],
      dmAnnotations: { lastReadDigest: 'digest-1' }
    };
    const parsed = parseSaveDocument(JSON.stringify(futureSave));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const log = new EventLog('today-peer');
    const loadResult = applySaveToLog(log, parsed.doc);
    log.append('peer-join', { v: 1, name: 'today-player' });

    // viewer projection — non-coord (player) save.
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'today-peer',
      'some-other-coord-peer', // viewer != coord = player projection
      loadResult.extraFields
    );
    const json = stringifySave(doc);
    const reparsed = JSON.parse(json);
    expect(reparsed.dmAnnotations).toEqual({
      lastReadDigest: 'digest-1'
    });
  });

  it('extraFields survive parse → applySaveToLog → serializeSessionForViewer (DM) → stringify', () => {
    const futureSave = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'today-peer',
      events: [],
      dmAnnotations: { lastReadDigest: 'digest-1' }
    };
    const parsed = parseSaveDocument(JSON.stringify(futureSave));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const log = new EventLog('today-peer');
    const loadResult = applySaveToLog(log, parsed.doc);
    log.append('peer-join', { v: 1, name: 'today-dm' });

    // viewer projection — coord (DM) save.
    const doc = serializeSessionForViewer(
      log.events(),
      CAMPAIGN,
      'today-peer',
      'today-peer', // viewer == coord = full save
      loadResult.extraFields
    );
    const json = stringifySave(doc);
    const reparsed = JSON.parse(json);
    expect(reparsed.dmAnnotations).toEqual({
      lastReadDigest: 'digest-1'
    });
  });

  it('a fresh session (no loaded save) does not include extraFields', () => {
    // Greenfield path: no prior save loaded.  serializeSession called
    // with extraFields=undefined must NOT include any extraFields key
    // in the output (the doc.extraFields property is omitted).
    const log = new EventLog('today-peer');
    log.append('peer-join', { v: 1, name: 'fresh' });
    const doc = serializeSession(log.events(), CAMPAIGN, 'today-peer');
    expect(doc.extraFields).toBeUndefined();
    const json = stringifySave(doc);
    const reparsed = JSON.parse(json);
    // Known fields only.
    const keys = new Set(Object.keys(reparsed));
    expect(keys.has('dmAnnotations')).toBe(false);
  });

  it('passing extraFields={} (empty object) is treated as undefined', () => {
    // Defensive: an empty extraFields map shouldn't add an empty
    // section to the serialized output.
    const log = new EventLog('today-peer');
    log.append('peer-join', { v: 1, name: 'fresh' });
    const doc = serializeSession(log.events(), CAMPAIGN, 'today-peer', {});
    expect(doc.extraFields).toBeUndefined();
  });
});

describe('INV-RENAME-FIREWALL: scrubbers strip DM-only field NAMES regardless of sub-field key', () => {
  /**
   * Run-#14 forward-compat architect finding (P0 #2): the
   * `pc-edit` scrubber reads `payload.field` by name and drops the
   * event when the value is a known DM-only character field path
   * (`dmNotes`, `name` etc).  A future runtime that renames the sub-
   * field key from `field` to `path` (a v:2 evolution) would bypass
   * the scrubber: `payload.field` is undefined → scrubber thinks the
   * event is safe → the event is kept on the player projection
   * carrying `path: 'dmNotes'` → DM-private text leaks.
   *
   * The defense: the scrubber pattern must be DOC'd to forbid
   * renaming the field-name key on existing kinds.  The contract is
   * recorded in `format-stability.md` §INV-RENAME-FIREWALL and
   * DEC-031 (decisions.md).  This test pins the present-day
   * behavior of `projectSaveForViewer` to a v:1 pc-edit so a future
   * regression that allowed v:2 renames (without bumping the kind
   * name) lands a failing test loudly.
   *
   * The companion defense for the v:2 case the architect described
   * (scrubber-by-name-NOT-key) is: today's runtime's `isPayloadV1`
   * check rejects v:2 payloads at materialize time (INV-7).  So
   * even if the v:2 event survives the player projection through
   * a future bug, the materializer no-ops it.  But that's a
   * defense-in-depth question; the FIRST line of defense is the
   * contract pinned here.
   */
  it('v:1 pc-edit with field:dmNotes is dropped from player projection (today)', () => {
    const dmEditEvent = buildEvent(
      'dm-peer',
      1,
      'pc-edit',
      { v: 1, pcId: 'pc-1', field: 'dmNotes', value: 'secret antagonist clue' },
      1700000000000
    );
    const doc = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'dm-peer',
      events: [dmEditEvent]
    };
    const projected = projectSaveForViewer(doc, false);
    expect(projected.events).toHaveLength(0); // dropped by scrubber
  });

  it('v:1 pc-create with dmNotes is stripped from player projection (today)', () => {
    const createEvent = buildEvent(
      'dm-peer',
      1,
      'pc-create',
      {
        v: 1,
        pcId: 'pc-1',
        name: 'Yui',
        pronouns: 'she/her',
        backstory: 'A short backstory.',
        dmNotes: 'antagonist arc plant'
      },
      1700000000000
    );
    const doc = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'dm-peer',
      events: [createEvent]
    };
    const projected = projectSaveForViewer(doc, false);
    expect(projected.events).toHaveLength(1);
    const payload = (projected.events[0] as QuireEvent).payload as Record<
      string,
      unknown
    >;
    // Player-visible fields stay.
    expect(payload.name).toBe('Yui');
    expect(payload.pronouns).toBe('she/her');
    expect(payload.backstory).toBe('A short backstory.');
    // DM-only sub-fields are stripped.
    expect(payload.dmNotes).toBeUndefined();
  });

  it('defense-in-depth: a future v:2 pc-edit with path:dmNotes (rename bypass) IS DROPPED by the strengthened scrubber', () => {
    // Run #14 INV-RENAME-FIREWALL: the lead's run-#14 fix to the
    // pc-edit scrubber scans ALL top-level string values for
    // DM-only field-path names.  This pins the bypass-defense.
    const bypassEvent = buildEvent(
      'future-dm',
      1,
      'pc-edit',
      {
        // hypothetical future shape: rename `field` → `path`.
        v: 2,
        pcId: 'pc-1',
        path: 'dmNotes',
        value: 'future-attempted-leak'
      },
      1700000000000
    );
    const doc = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'future-dm',
      events: [bypassEvent]
    };
    const projected = projectSaveForViewer(doc, false);
    // The scrubber DROPS the event because `path: "dmNotes"` is a
    // string value matching a DM-only character field name.
    expect(projected.events).toHaveLength(0);
  });

  it('defense-in-depth: a v:2 pc-edit with a tax.releaseMoment-shaped dotted string is ALSO dropped', () => {
    // A dotted path under a DM-only top-level field is itself
    // DM-only (isDmOnlyCharacterFieldPath returns true for
    // 'tax.releaseMoment').  The scan picks it up.
    const bypassEvent = buildEvent(
      'future-dm',
      1,
      'pc-edit',
      {
        v: 2,
        pcId: 'pc-1',
        target: 'tax.releaseMoment',
        value: 'future-attempted-tax-leak'
      },
      1700000000000
    );
    const doc = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'future-dm',
      events: [bypassEvent]
    };
    const projected = projectSaveForViewer(doc, false);
    expect(projected.events).toHaveLength(0);
  });

  it('the strengthened scrubber does NOT over-strip: a benign pc-edit harm=2 SURVIVES', () => {
    // Regression: the value-scan must not false-positive on
    // player-visible payloads.  `harm`/`stress`/`advancements` are
    // NOT DM-only top-level fields, so a payload with `field:
    // "harm"` and `value: 2` survives.
    const benignEvent = buildEvent(
      'dm-peer',
      1,
      'pc-edit',
      { v: 1, pcId: 'pc-1', field: 'harm', value: 2 },
      1700000000000
    );
    const doc = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'dm-peer',
      events: [benignEvent]
    };
    const projected = projectSaveForViewer(doc, false);
    expect(projected.events).toHaveLength(1);
    const payload = (projected.events[0] as QuireEvent).payload as Record<
      string,
      unknown
    >;
    expect(payload.field).toBe('harm');
    expect(payload.value).toBe(2);
  });

  it('run #15 FC-2 narrowing: pc-edit field:name value:Tax (player named themselves Tax) SURVIVES player projection', () => {
    // Adversarial v2 H-3 fix: the run-#14 broad value-scan dropped
    // this benign rename because `value:'tax'` triggered a DM-only
    // field-name match.  Narrowing to field-name keys
    // (field/path/target/key/attr/prop) lets the rename through.
    // Without this, a player whose PC is named "Tax" would see
    // their rename dropped from the player projection → cross-
    // device divergence.
    const renameEvent = buildEvent(
      'dm-peer',
      1,
      'pc-edit',
      { v: 1, pcId: 'pc-1', field: 'name', value: 'Tax' },
      1700000000000
    );
    const doc = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'dm-peer',
      events: [renameEvent]
    };
    const projected = projectSaveForViewer(doc, false);
    expect(projected.events).toHaveLength(1);
    const payload = (projected.events[0] as QuireEvent).payload as Record<
      string,
      unknown
    >;
    expect(payload.field).toBe('name');
    expect(payload.value).toBe('Tax');
  });

  it('run #15 FC-2 parity: bond-ratify v:2 path:dmNotes (rename bypass) IS DROPPED by the strengthened scrubber', () => {
    // Adversarial v2 H-1 fix: the run-#14 defense was pc-edit-only;
    // bond-ratify had the same rename-bypass shape (a v:2 author
    // renames dmNotes → private via a field-name key).  Parity:
    // bond-ratify now scans the same FIELD_NAME_KEYS vocabulary.
    const bypassEvent = buildEvent(
      'future-dm',
      1,
      'bond-ratify',
      {
        v: 2,
        pcId: 'pc-1',
        id: 'b1',
        target: 'dmNotes',
        text: 'a malicious leak'
      },
      1700000000000
    );
    const doc = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'future-dm',
      events: [bypassEvent]
    };
    const projected = projectSaveForViewer(doc, false);
    expect(projected.events).toHaveLength(0);
  });

  it('run #15 FC-2 parity: pc-create v:2 path:dmNotes (rename bypass) IS DROPPED by the strengthened scrubber', () => {
    // Adversarial v2 H-1 fix: same parity for pc-create.  A v:2
    // pc-create that renames the dmNotes key would otherwise bypass
    // the by-name strip; the FIELD_NAME_KEYS scan catches it.
    const bypassEvent = buildEvent(
      'future-dm',
      1,
      'pc-create',
      {
        v: 2,
        pcId: 'pc-1',
        name: 'Bex',
        pronouns: 'they/them',
        backstory: 'short',
        path: 'dmNotes',
        value: 'a malicious leak'
      },
      1700000000000
    );
    const doc = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'future-dm',
      events: [bypassEvent]
    };
    const projected = projectSaveForViewer(doc, false);
    expect(projected.events).toHaveLength(0);
  });

  it('a hypothetical v:2 pc-edit with path:dmNotes — silent no-op at materialize (INV-7) is the second line of defense', () => {
    // This test documents the CONTRACT, not the today-behavior of the
    // scrubber.  The scrubber would PASS THROUGH the v:2 event because
    // p.field is undefined.  But INV-7 says the v:2 payload no-ops at
    // materialize.  Together: a future runtime that ships a v:2
    // pc-edit-with-renamed-field MUST bump kind name (per DEC-031);
    // if it doesn't, the player save will INCLUDE the event (firewall
    // hole) but materialize won't apply it.  That's not enough —
    // DEC-031 forbids the rename.  We pin the materialize no-op to
    // make the test surface its dependency on the contract.
    const v2Event = buildEvent(
      'future-dm',
      1,
      'pc-edit',
      { v: 2, pcId: 'pc-1', path: 'dmNotes', value: 'future-leak' },
      1700000000000
    );
    const log = new EventLog('today-peer');
    log.apply(v2Event);
    // Materialize is the second line of defense.  Today's runtime
    // ignores v:2 payloads.
    expect(() => materialize(log.events())).not.toThrow();
  });
});

describe('Format-stability: defensive — known-key collision in extraFields', () => {
  it('a forged extraFields containing a known key drops the duplicate at stringify', () => {
    // This shouldn't happen in practice (parseSaveDocument filters
    // known keys out of extraFields) but the stringifier defends
    // anyway.  The defense protects determinism (no DOUBLE key in
    // the output) at the cost of dropping the misclassified extra.
    const doc: SaveDocument = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T13:00:00.000Z',
      campaign: CAMPAIGN,
      savedByPeerId: 'lead-peer',
      events: [],
      extraFields: {
        // Forged: claims to be a known key.  Stringify must NOT
        // emit it (the legit known field wins).
        savedByPeerId: 'hostile-replacement'
      }
    };
    const json = stringifySave(doc);
    // The legit savedByPeerId comes from the known fields.
    const parsed = JSON.parse(json);
    expect(parsed.savedByPeerId).toBe('lead-peer');
  });
});

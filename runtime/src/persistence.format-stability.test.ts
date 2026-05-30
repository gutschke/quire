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
  stringifySave,
  parseSaveDocument,
  applySaveToLog,
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

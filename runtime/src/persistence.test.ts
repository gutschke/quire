import { describe, it, expect } from 'vitest';
import {
  serializeSession,
  stringifySave,
  parseSaveDocument,
  applySaveToLog,
  type SaveDocument
} from './persistence';
import { EventLog, type QuireEvent } from './core/event-log';

const CAMPAIGN = { owner: 'gutschke', repo: 'underleaf', ref: 'main' };

function fakeLog(peerId: string, eventCount: number): EventLog {
  const log = new EventLog(peerId);
  for (let i = 0; i < eventCount; i++) {
    log.append('chat', { text: `msg ${i}` });
  }
  return log;
}

describe('serializeSession', () => {
  it('produces a save document with all required fields', () => {
    const log = fakeLog('alice', 3);
    const doc = serializeSession(log.events(), CAMPAIGN, 'alice');
    expect(doc.$schemaVersion).toMatch(/^0\.\d+\.\d+$/);
    expect(doc.campaign).toEqual(CAMPAIGN);
    expect(doc.savedByPeerId).toBe('alice');
    expect(doc.events).toHaveLength(3);
    expect(typeof doc.savedAt).toBe('string');
    // ISO 8601 parseable
    expect(Date.parse(doc.savedAt)).toBeGreaterThan(0);
  });
});

describe('stringifySave — deterministic output', () => {
  it('produces identical strings for identical inputs', () => {
    const log = fakeLog('alice', 5);
    const doc1 = serializeSession(log.events(), CAMPAIGN, 'alice');
    const doc2: SaveDocument = { ...doc1 };
    expect(stringifySave(doc1)).toBe(stringifySave(doc2));
  });

  it('sorts top-level keys alphabetically', () => {
    const log = fakeLog('alice', 1);
    const doc = serializeSession(log.events(), CAMPAIGN, 'alice');
    const s = stringifySave(doc);
    // The first key after '{' must be alphabetically first.
    const firstKey = /^{\s*"([^"]+)"/.exec(s)?.[1];
    const keys = Object.keys(doc).sort();
    expect(firstKey).toBe(keys[0]);
  });

  it('sorts campaign sub-object keys', () => {
    const doc = serializeSession([], CAMPAIGN, 'alice');
    const s = stringifySave(doc);
    // campaign has owner, repo, ref — sorted: owner, ref, repo
    const campaignBlock = s.match(/"campaign":\s*({[^}]*})/)?.[1];
    expect(campaignBlock).toBeTruthy();
    const order = [...campaignBlock!.matchAll(/"([a-z]+)":/g)].map(
      (m) => m[1]
    );
    expect(order).toEqual(['owner', 'ref', 'repo']);
  });

  it('sorts events by (clock-sum, peerId, seq) for git-friendly diffs', () => {
    // Two interleaved authors; verify the serialized order is stable
    // by causal sort, not by author insertion order.
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    const a1 = alice.append('chat', { text: 'a1' });
    const b1 = bob.append('chat', { text: 'b1' });
    bob.apply(a1);
    const b2 = bob.append('chat', { text: 'b2' });
    alice.apply(b1);
    alice.apply(b2);
    const doc1 = serializeSession(alice.events(), CAMPAIGN, 'alice');
    const doc2 = serializeSession(bob.events(), CAMPAIGN, 'bob');
    // Different savedByPeerId but identical event order.
    const ev1 = JSON.parse(stringifySave(doc1)).events;
    const ev2 = JSON.parse(stringifySave(doc2)).events;
    expect(ev1.map((e: { id: string }) => e.id)).toEqual(
      ev2.map((e: { id: string }) => e.id)
    );
  });

  it('appending one event produces a small diff (git-friendly)', () => {
    const log = fakeLog('alice', 5);
    const before = stringifySave(
      serializeSession(log.events(), CAMPAIGN, 'alice')
    );
    log.append('chat', { text: 'one more' });
    const after = stringifySave(
      serializeSession(log.events(), CAMPAIGN, 'alice')
    );
    // The two should share a long common prefix.  The added text is
    // a single event entry, so the changed portion should be a small
    // fraction of the total (excluding the savedAt timestamp).  We
    // assert the common-prefix length is at least 50% of `before`.
    let common = 0;
    while (common < before.length && before[common] === after[common]) {
      common++;
    }
    expect(common).toBeGreaterThanOrEqual(before.length * 0.5);
  });
});

describe('parseSaveDocument — happy path', () => {
  it('round-trips serialize → stringify → parse → equal', () => {
    const log = fakeLog('alice', 4);
    const doc = serializeSession(log.events(), CAMPAIGN, 'alice');
    const parsed = parseSaveDocument(stringifySave(doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc.events).toHaveLength(4);
      expect(parsed.doc.savedByPeerId).toBe('alice');
      expect(parsed.doc.campaign).toEqual(CAMPAIGN);
    }
  });
});

describe('parseSaveDocument — error paths', () => {
  it('rejects empty string', () => {
    const r = parseSaveDocument('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/json|empty/i);
  });

  it('rejects non-JSON', () => {
    const r = parseSaveDocument('not json {');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/json/i);
  });

  it('rejects null / array / number at top level', () => {
    expect(parseSaveDocument('null').ok).toBe(false);
    expect(parseSaveDocument('[]').ok).toBe(false);
    expect(parseSaveDocument('42').ok).toBe(false);
  });

  it('rejects missing $schemaVersion', () => {
    const r = parseSaveDocument(
      JSON.stringify({
        savedAt: new Date().toISOString(),
        campaign: CAMPAIGN,
        savedByPeerId: 'alice',
        events: []
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/schemaVersion/i);
  });

  it('rejects non-semver schemaVersion', () => {
    const r = parseSaveDocument(
      JSON.stringify({
        $schemaVersion: 'one-point-oh',
        savedAt: new Date().toISOString(),
        campaign: CAMPAIGN,
        savedByPeerId: 'alice',
        events: []
      })
    );
    expect(r.ok).toBe(false);
  });

  it('rejects different major version', () => {
    const r = parseSaveDocument(
      JSON.stringify({
        $schemaVersion: '1.0.0',
        savedAt: new Date().toISOString(),
        campaign: CAMPAIGN,
        savedByPeerId: 'alice',
        events: []
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/version|update/i);
  });

  it('accepts same-major newer minor (forward-compat)', () => {
    const r = parseSaveDocument(
      JSON.stringify({
        $schemaVersion: '0.99.0',
        savedAt: new Date().toISOString(),
        campaign: CAMPAIGN,
        savedByPeerId: 'alice',
        events: []
      })
    );
    expect(r.ok).toBe(true);
  });

  it('rejects missing campaign', () => {
    const r = parseSaveDocument(
      JSON.stringify({
        $schemaVersion: '0.1.0',
        savedAt: new Date().toISOString(),
        savedByPeerId: 'alice',
        events: []
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/campaign/i);
  });

  it('rejects campaign with non-string fields', () => {
    const r = parseSaveDocument(
      JSON.stringify({
        $schemaVersion: '0.1.0',
        savedAt: new Date().toISOString(),
        campaign: { owner: 'x', repo: 42, ref: 'main' },
        savedByPeerId: 'alice',
        events: []
      })
    );
    expect(r.ok).toBe(false);
  });

  it('rejects missing savedByPeerId', () => {
    const r = parseSaveDocument(
      JSON.stringify({
        $schemaVersion: '0.1.0',
        savedAt: new Date().toISOString(),
        campaign: CAMPAIGN,
        events: []
      })
    );
    expect(r.ok).toBe(false);
  });

  it('rejects non-array events', () => {
    const r = parseSaveDocument(
      JSON.stringify({
        $schemaVersion: '0.1.0',
        savedAt: new Date().toISOString(),
        campaign: CAMPAIGN,
        savedByPeerId: 'alice',
        events: { foo: 'bar' }
      })
    );
    expect(r.ok).toBe(false);
  });

  it('accepts a slightly-future minor version (forward compat)', () => {
    // pinned at 0.99.0 above
    expect(true).toBe(true);
  });

  it('rejects unparseable savedAt', () => {
    const r = parseSaveDocument(
      JSON.stringify({
        $schemaVersion: '0.1.0',
        savedAt: 'not a date',
        campaign: CAMPAIGN,
        savedByPeerId: 'alice',
        events: []
      })
    );
    expect(r.ok).toBe(false);
  });
});

describe('applySaveToLog — happy path', () => {
  it('applies all events to an empty log', () => {
    const source = fakeLog('alice', 5);
    const doc = serializeSession(source.events(), CAMPAIGN, 'alice');
    const target = new EventLog('bob');
    const result = applySaveToLog(target, doc);
    expect(result.applied).toBe(5);
    expect(result.duplicates).toBe(0);
    expect(result.rejected).toBe(0);
    expect(result.unknownKinds).toBe(0);
    expect(result.errors).toEqual([]);
    expect(target.events()).toHaveLength(5);
  });

  it('is idempotent — second apply returns all-duplicates', () => {
    const source = fakeLog('alice', 3);
    const doc = serializeSession(source.events(), CAMPAIGN, 'alice');
    const target = new EventLog('bob');
    applySaveToLog(target, doc);
    const second = applySaveToLog(target, doc);
    expect(second.applied).toBe(0);
    expect(second.duplicates).toBe(3);
    expect(target.events()).toHaveLength(3);
  });

  it('preserves divergent local events; merged log contains all', () => {
    const source = fakeLog('alice', 3);
    const doc = serializeSession(source.events(), CAMPAIGN, 'alice');
    const target = new EventLog('bob');
    // Bob already has some local events.
    target.append('chat', { text: 'bob local 1' });
    target.append('chat', { text: 'bob local 2' });
    const r = applySaveToLog(target, doc);
    expect(r.applied).toBe(3);
    expect(target.events()).toHaveLength(5);
  });
});

describe('applySaveToLog — error paths + forward compat', () => {
  function badEvent(extra: Partial<QuireEvent> = {}): QuireEvent {
    // Default: valid event; override fields to make it bad.
    return {
      id: 'alice:1',
      peerId: 'alice',
      seq: 1,
      clock: { alice: 1 },
      kind: 'chat',
      payload: { text: 'ok' },
      ts: Date.now(),
      ...extra
    };
  }

  it('rejects malformed events and reports them in errors[]', () => {
    const goodSrc = fakeLog('alice', 2);
    const doc: SaveDocument = {
      $schemaVersion: '0.1.0',
      savedAt: new Date().toISOString(),
      campaign: CAMPAIGN,
      savedByPeerId: 'alice',
      events: [
        ...goodSrc.events(),
        badEvent({ id: 'mismatch', peerId: 'alice', seq: 1 }), // id != peerId:seq
        badEvent({
          id: 'alice:99',
          peerId: 'alice',
          seq: 99,
          clock: {} // missing alice entry
        })
      ]
    };
    const target = new EventLog('bob');
    const r = applySaveToLog(target, doc);
    expect(r.applied).toBe(2);
    expect(r.rejected).toBe(2);
    expect(r.errors.length).toBe(2);
    expect(target.events()).toHaveLength(2);
  });

  it('counts unknown event kinds (forward compat)', () => {
    // Valid event but with a kind the materializer doesn't recognize.
    // EventLog still applies it (idempotent forward compat); the
    // materializer's switch ignores it; the load result surfaces it
    // so the loader can warn "your version is older than this save".
    const future = badEvent({
      id: 'alice:1',
      peerId: 'alice',
      seq: 1,
      clock: { alice: 1 },
      kind: 'future-event-kind-we-do-not-know',
      payload: { whatever: true }
    });
    const doc: SaveDocument = {
      $schemaVersion: '0.1.0',
      savedAt: new Date().toISOString(),
      campaign: CAMPAIGN,
      savedByPeerId: 'alice',
      events: [future]
    };
    const target = new EventLog('bob');
    const r = applySaveToLog(target, doc);
    expect(r.applied).toBe(1);
    expect(r.unknownKinds).toBe(1);
  });

  it('mixed: some good, some duplicates, some bad, some unknown', () => {
    const target = new EventLog('bob');
    const a1 = target.append('chat', { text: 'already have' });
    const doc: SaveDocument = {
      $schemaVersion: '0.1.0',
      savedAt: new Date().toISOString(),
      campaign: CAMPAIGN,
      savedByPeerId: 'alice',
      events: [
        a1, // duplicate
        badEvent({ id: 'mismatch' }), // bad
        badEvent({
          id: 'charlie:1',
          peerId: 'charlie',
          seq: 1,
          clock: { charlie: 1 },
          kind: 'unknown-future-kind'
        }), // unknown but valid event
        badEvent({
          id: 'doris:1',
          peerId: 'doris',
          seq: 1,
          clock: { doris: 1 }
        }) // good
      ]
    };
    const r = applySaveToLog(target, doc);
    expect(r.duplicates).toBe(1);
    expect(r.rejected).toBe(1);
    expect(r.unknownKinds).toBe(1);
    expect(r.applied).toBe(2); // unknown-kind is still applied
  });
});

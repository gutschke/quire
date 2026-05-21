/**
 * Materializer payload-validation tests.  The pc-edit case is the
 * highest-risk because a hostile peer can otherwise:
 *
 *   - shadow any real PC by sending pcId='<real-pc-id>' with
 *     arbitrary field/value (overwrites the live sheet)
 *   - corrupt iteration via prototype-key pcIds ('__proto__')
 *   - cause the renderer to crash with non-string pcId/field
 *
 * Other event kinds also depend on string-typed payload fields
 * (chat.text, scene-reveal.scenePath, dice-roll.expression); a
 * non-string or non-finite value passed through would render as
 * "[object Object]" / "NaN" or crash array helpers.  These are
 * pinned here so a future "loosen the type and trust the input"
 * change is caught.
 */

import { describe, it, expect } from 'vitest';
import { materialize, isPayloadV1, EVENT_PAYLOAD_V1 } from './state';
import type { QuireEvent } from './event-log';

function ev(
  peerId: string,
  seq: number,
  kind: string,
  payload: unknown
): QuireEvent {
  return {
    id: `${peerId}:${seq}`,
    peerId,
    seq,
    clock: { [peerId]: seq },
    kind,
    payload,
    ts: Date.now()
  };
}

describe('materialize — pc-edit hostile payloads', () => {
  it('rejects pc-edit with non-string pcId', () => {
    const s = materialize([
      ev('alice', 1, 'pc-edit', { pcId: 42, field: 'harm', value: 1 })
    ]);
    expect(s.pcEdits).toEqual({});
  });

  it('rejects pc-edit with prototype-poisoning pcId', () => {
    const s = materialize([
      ev('alice', 1, 'pc-edit', { pcId: '__proto__', field: 'harm', value: 1 })
    ]);
    expect(s.pcEdits).toEqual({});
    // And the prototype is unpolluted.
    expect(({} as Record<string, unknown>).harm).toBeUndefined();
  });

  it('rejects pc-edit with empty / over-cap pcId', () => {
    const s1 = materialize([
      ev('alice', 1, 'pc-edit', { pcId: '', field: 'harm', value: 1 })
    ]);
    expect(s1.pcEdits).toEqual({});
    const huge = 'x'.repeat(257);
    const s2 = materialize([
      ev('alice', 1, 'pc-edit', { pcId: huge, field: 'harm', value: 1 })
    ]);
    expect(s2.pcEdits).toEqual({});
  });

  it('rejects pc-edit with non-string field', () => {
    const s = materialize([
      ev('alice', 1, 'pc-edit', { pcId: 'pc1', field: 42, value: 1 })
    ]);
    expect(s.pcEdits).toEqual({});
  });

  it('rejects pc-edit with prototype-poisoning field', () => {
    const s = materialize([
      ev('alice', 1, 'pc-edit', {
        pcId: 'pc1',
        field: '__proto__',
        value: { polluted: true }
      })
    ]);
    expect(s.pcEdits).toEqual({});
  });

  it('accepts legitimate pc-edit', () => {
    const s = materialize([
      ev('alice', 1, 'pc-edit', { pcId: 'pc1', field: 'harm', value: 2 })
    ]);
    expect(s.pcEdits).toEqual({ pc1: { harm: 2 } });
  });

  it('rejects pcId with spaces / slashes / dot-segments', () => {
    // The state.ts validator now mirrors character-loader.ts's
    // ID_RE — pcIds that could never be loaded by loadCharacter
    // should never make it into pcEdits.
    for (const bad of ['has space', 'has/slash', '../escape', '.', '..']) {
      const s = materialize([
        ev('alice', 1, 'pc-edit', { pcId: bad, field: 'harm', value: 1 })
      ]);
      expect(s.pcEdits).toEqual({});
    }
  });

  it('caps the number of distinct fields per PC (DoS guard)', () => {
    const events: QuireEvent[] = [];
    for (let i = 0; i < 200; i++) {
      events.push(
        ev('alice', i + 1, 'pc-edit', {
          pcId: 'pc1',
          field: `f${i}`,
          value: i
        })
      );
    }
    const s = materialize(events);
    expect(Object.keys(s.pcEdits.pc1).length).toBeLessThanOrEqual(100);
  });

  it('allows continued updates to an existing field once cap reached', () => {
    const events: QuireEvent[] = [];
    for (let i = 0; i < 100; i++) {
      events.push(
        ev('alice', i + 1, 'pc-edit', {
          pcId: 'pc1',
          field: `f${i}`,
          value: i
        })
      );
    }
    // Add a 101st DISTINCT field — should be rejected.
    events.push(
      ev('alice', 101, 'pc-edit', {
        pcId: 'pc1',
        field: 'too-many',
        value: 99
      })
    );
    // But an UPDATE to an existing field should still land (LWW).
    events.push(
      ev('alice', 102, 'pc-edit', {
        pcId: 'pc1',
        field: 'f0',
        value: 999
      })
    );
    const s = materialize(events);
    expect(Object.keys(s.pcEdits.pc1).length).toBe(100);
    expect(s.pcEdits.pc1.f0).toBe(999);
    expect(s.pcEdits.pc1['too-many']).toBeUndefined();
  });
});

describe('materialize — note hostile payloads', () => {
  it('drops non-boolean private', () => {
    const events: QuireEvent[] = [
      ev('alice', 1, 'note', { text: 'a', private: 'yes' as unknown }),
      ev('alice', 2, 'note', { text: 'b', private: 1 as unknown }),
      ev('alice', 3, 'note', { text: 'c', private: { malicious: true } as unknown })
    ];
    const s = materialize(events);
    // All notes accepted (text is valid); only the private field
    // gets coerced to undefined when not strictly boolean.
    expect(s.notes).toHaveLength(3);
    for (const n of s.notes) expect(n.private).toBeUndefined();
  });

  it('preserves a true / false private', () => {
    const s = materialize([
      ev('alice', 1, 'note', { text: 'a', private: true }),
      ev('alice', 2, 'note', { text: 'b', private: false })
    ]);
    expect(s.notes[0].private).toBe(true);
    expect(s.notes[1].private).toBe(false);
  });
});

describe('materialize — chat hostile payloads', () => {
  it('drops non-string text', () => {
    const s = materialize([ev('alice', 1, 'chat', { text: 42 })]);
    expect(s.chat).toEqual([]);
  });

  it('drops over-length text', () => {
    const s = materialize([
      ev('alice', 1, 'chat', { text: 'x'.repeat(5001) })
    ]);
    expect(s.chat).toEqual([]);
  });

  it('drops missing payload', () => {
    const s = materialize([ev('alice', 1, 'chat', null)]);
    expect(s.chat).toEqual([]);
  });
});

describe('materialize — scene-reveal hostile payloads', () => {
  it('drops non-string scenePath', () => {
    const events = [
      ev('alice', 1, 'coordinator-claim', {}),
      ev('alice', 2, 'scene-reveal', { scenePath: 42 })
    ];
    const s = materialize(events);
    expect(s.revealedScenes).toEqual([]);
  });

  it('drops over-length scenePath', () => {
    const events = [
      ev('alice', 1, 'coordinator-claim', {}),
      ev('alice', 2, 'scene-reveal', { scenePath: 'x'.repeat(2049) })
    ];
    const s = materialize(events);
    expect(s.revealedScenes).toEqual([]);
  });
});

describe('materialize — dice-roll hostile payloads', () => {
  it('drops missing or non-string expression', () => {
    const s1 = materialize([ev('alice', 1, 'dice-roll', { result: 7, dice: [1, 6] })]);
    expect(s1.diceRolls).toEqual([]);
    const s2 = materialize([
      ev('alice', 1, 'dice-roll', { expression: 42, result: 7, dice: [1, 6] })
    ]);
    expect(s2.diceRolls).toEqual([]);
  });

  it('drops non-array dice', () => {
    const s = materialize([
      ev('alice', 1, 'dice-roll', {
        expression: '2d6',
        result: 7,
        dice: 'not an array'
      })
    ]);
    expect(s.diceRolls).toEqual([]);
  });
});

describe('isPayloadV1 predicate (P0-5 v:1 contract)', () => {
  it('accepts a plain object with v === 1', () => {
    expect(isPayloadV1({ v: 1, pcId: 'x' })).toBe(true);
    expect(isPayloadV1({ v: EVENT_PAYLOAD_V1 })).toBe(true);
  });

  it('rejects missing v field', () => {
    expect(isPayloadV1({})).toBe(false);
    expect(isPayloadV1({ pcId: 'x' })).toBe(false);
  });

  it('rejects future versions (v:2+)', () => {
    expect(isPayloadV1({ v: 2 })).toBe(false);
    expect(isPayloadV1({ v: 99 })).toBe(false);
  });

  it('rejects non-strict-equal v values (string, null, etc.)', () => {
    expect(isPayloadV1({ v: '1' })).toBe(false);
    expect(isPayloadV1({ v: null })).toBe(false);
    expect(isPayloadV1({ v: true })).toBe(false);
  });

  it('rejects null / undefined / non-object payloads', () => {
    expect(isPayloadV1(null)).toBe(false);
    expect(isPayloadV1(undefined)).toBe(false);
    expect(isPayloadV1('string')).toBe(false);
    expect(isPayloadV1(42)).toBe(false);
  });

  it('rejects arrays even if [0]==1', () => {
    expect(isPayloadV1([1, 2, 3])).toBe(false);
  });
});

describe('M1-registered event kinds — v:1 enforcement', () => {
  // Spot-check that all 18 M1-registered kinds reject events with
  // missing/wrong v.  The materializer stubs land in M3a/M3b/M4/M5/M6;
  // until then they no-op, but the v:1 check MUST already be in place
  // so a future per-kind materializer that gets added cannot forget it
  // without breaking the test.

  // The 18 kinds registered at M1.  raise-hand / lower-hand
  // materialize starting M2.8 (they're tested separately below);
  // the rest remain v:1-validated no-ops until their per-kind
  // materializer ships in M3a/M3b/M4/M5/M6.
  const M1_STILL_NOOP_KINDS = [
    'scene-reveal-paragraph',
    'scene-unreveal-paragraph',
    'thread-debt-set',
    'npc-pin',
    'npc-unpin',
    'map-blob-add',
    'map-blob-move',
    'map-blob-remove',
    'map-blob-reveal',
    'map-blob-unreveal',
    'broadcast-view',
    'scratch-note',
    'ai-prompt',
    'ai-response',
    'ai-accept',
    'ai-reject'
  ];

  it('M1 kinds with missing v are silently no-oped (forward-compat)', () => {
    // No state mutation occurs because the no-op stub breaks before
    // any state.* mutation; verify the events also do NOT crash the
    // materializer.
    for (const kind of M1_STILL_NOOP_KINDS) {
      expect(() =>
        materialize([ev('alice', 1, kind, { /* no v */ pcId: 'x' })])
      ).not.toThrow();
    }
  });

  it('M1 kinds with v: 2 (future version) are silently no-oped', () => {
    for (const kind of M1_STILL_NOOP_KINDS) {
      expect(() =>
        materialize([ev('alice', 1, kind, { v: 2, pcId: 'x' })])
      ).not.toThrow();
    }
  });

  it('M1 kinds with v: 1 are accepted (no-op until materializer ships)', () => {
    // At M1 the case body just breaks — verify no crash and no state
    // leakage from the validated payload.
    for (const kind of M1_STILL_NOOP_KINDS) {
      const s = materialize([ev('alice', 1, kind, { v: 1, pcId: 'x' })]);
      // None of the M1+ fields should be populated by these stubs.
      expect(s.scratchNotes).toEqual([]);
      expect(s.threadDebt).toEqual({});
      expect(s.pinnedNpcs).toEqual([]);
      expect(Object.keys(s.revealedParagraphs)).toEqual([]);
    }
  });

  it('hostile payloads for M1 kinds cannot cause prototype pollution', () => {
    // Even with v: 1, a payload claiming __proto__ pollution should
    // not poison state.  The stubs no-op, so this is just defense-
    // in-depth that the stub doesn't accidentally call Object.assign
    // on the payload.
    for (const kind of M1_STILL_NOOP_KINDS) {
      materialize([
        ev('alice', 1, kind, {
          v: 1,
          __proto__: { polluted: true },
          constructor: { prototype: { polluted: true } }
        })
      ]);
    }
    expect((Object.prototype as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('raise-hand / lower-hand materializer (M2.8 — P1-7)', () => {
  it('raise-hand adds the author to state.raisedHands when peer is known', () => {
    const s = materialize([
      ev('alice', 1, 'peer-join', { name: 'Alice' }),
      ev('alice', 2, 'raise-hand', { v: 1 })
    ]);
    expect(s.raisedHands.has('alice')).toBe(true);
  });

  it('lower-hand removes the author from state.raisedHands', () => {
    const s = materialize([
      ev('alice', 1, 'peer-join', { name: 'Alice' }),
      ev('alice', 2, 'raise-hand', { v: 1 }),
      ev('alice', 3, 'lower-hand', { v: 1 })
    ]);
    expect(s.raisedHands.has('alice')).toBe(false);
  });

  it('raise-hand is idempotent (Set dedup)', () => {
    const s = materialize([
      ev('alice', 1, 'peer-join', { name: 'Alice' }),
      ev('alice', 2, 'raise-hand', { v: 1 }),
      ev('alice', 3, 'raise-hand', { v: 1 })
    ]);
    expect(s.raisedHands.size).toBe(1);
  });

  it('raise-hand on an unknown peer is silently dropped (no ghost hands)', () => {
    // peer-join is required first; a raise-hand from a peer that
    // hasn't announced themselves doesn't materialize.
    const s = materialize([
      ev('ghost', 1, 'raise-hand', { v: 1 })
    ]);
    expect(s.raisedHands.has('ghost')).toBe(false);
  });

  it('peer-leave clears the leaving peer\'s raised hand', () => {
    const s = materialize([
      ev('alice', 1, 'peer-join', { name: 'Alice' }),
      ev('alice', 2, 'raise-hand', { v: 1 }),
      ev('alice', 3, 'peer-leave', {})
    ]);
    expect(s.raisedHands.has('alice')).toBe(false);
  });

  it('peer-disconnect (coord-emitted) clears the disconnected peer\'s hand', () => {
    const s = materialize([
      ev('dm', 1, 'peer-join', { name: 'DM' }),
      ev('dm', 2, 'coordinator-claim', {}),
      ev('alice', 1, 'peer-join', { name: 'Alice' }),
      ev('alice', 2, 'raise-hand', { v: 1 }),
      ev('dm', 3, 'peer-disconnect', { peerId: 'alice' })
    ]);
    expect(s.raisedHands.has('alice')).toBe(false);
  });

  it('raise-hand rejects missing / wrong v', () => {
    const s = materialize([
      ev('alice', 1, 'peer-join', { name: 'Alice' }),
      ev('alice', 2, 'raise-hand', { /* no v */ }),
      ev('alice', 3, 'raise-hand', { v: 2 })
    ]);
    expect(s.raisedHands.has('alice')).toBe(false);
  });

  it('multiple peers raise hands independently', () => {
    const s = materialize([
      ev('alice', 1, 'peer-join', { name: 'Alice' }),
      ev('bob', 1, 'peer-join', { name: 'Bob' }),
      ev('alice', 2, 'raise-hand', { v: 1 }),
      ev('bob', 2, 'raise-hand', { v: 1 })
    ]);
    expect(s.raisedHands.size).toBe(2);
    expect(s.raisedHands.has('alice')).toBe(true);
    expect(s.raisedHands.has('bob')).toBe(true);
  });
});

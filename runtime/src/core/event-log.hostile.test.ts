/**
 * Hostile-input tests for EventLog.apply().  These cover the cases a
 * malicious peer (or a buggy peer with corrupted state) can send.
 * Before R1.2, the apply() method validated nothing beyond duplicate
 * id, so every probe here would have been accepted into the log.
 *
 * Failure modes covered:
 *  - missing / wrong-typed fields
 *  - id not matching peerId:seq
 *  - seq non-positive / non-integer / absurdly large
 *  - clock not a plain object
 *  - clock[peerId] != seq (author's own entry must match)
 *  - clock entries with non-integer or absurdly large values
 *    (vector clock forgery: alice's next event must NOT jump to seq=1B)
 */

import { describe, it, expect } from 'vitest';
import { EventLog, type QuireEvent } from './event-log';

function legitEvent(
  overrides: Partial<QuireEvent> = {}
): QuireEvent {
  return {
    id: 'alice:1',
    peerId: 'alice',
    seq: 1,
    clock: { alice: 1 },
    kind: 'chat',
    payload: { text: 'hi' },
    ts: Date.now(),
    ...overrides
  };
}

describe('EventLog.apply — shape validation', () => {
  it('accepts a well-formed event (sanity)', () => {
    const log = new EventLog('bob');
    expect(log.apply(legitEvent())).toBe(true);
  });

  it('rejects null / undefined / non-object', () => {
    const log = new EventLog('bob');
    expect(log.apply(null as unknown as QuireEvent)).toBe(false);
    expect(log.apply(undefined as unknown as QuireEvent)).toBe(false);
    expect(log.apply('event' as unknown as QuireEvent)).toBe(false);
    expect(log.apply(42 as unknown as QuireEvent)).toBe(false);
  });

  it('rejects empty / non-string id', () => {
    const log = new EventLog('bob');
    expect(log.apply(legitEvent({ id: '' }))).toBe(false);
    expect(log.apply(legitEvent({ id: 0 as unknown as string }))).toBe(false);
  });

  it('rejects empty / non-string peerId', () => {
    const log = new EventLog('bob');
    expect(log.apply(legitEvent({ peerId: '' }))).toBe(false);
    expect(log.apply(legitEvent({ peerId: null as unknown as string }))).toBe(
      false
    );
  });

  it('rejects non-positive or fractional seq', () => {
    const log = new EventLog('bob');
    expect(log.apply(legitEvent({ seq: 0 }))).toBe(false);
    expect(log.apply(legitEvent({ seq: -1 }))).toBe(false);
    expect(log.apply(legitEvent({ seq: 1.5 }))).toBe(false);
    expect(log.apply(legitEvent({ seq: NaN }))).toBe(false);
    expect(log.apply(legitEvent({ seq: 'one' as unknown as number }))).toBe(false);
  });

  it('rejects seq above sanity cap (10^9)', () => {
    const log = new EventLog('bob');
    expect(log.apply(legitEvent({ id: 'alice:999999999', seq: 999_999_999, clock: { alice: 999_999_999 } }))).toBe(true);
    expect(log.apply(legitEvent({ id: 'alice:1000000001', seq: 1_000_000_001, clock: { alice: 1_000_000_001 } }))).toBe(false);
  });

  it('rejects id that does not match `${peerId}:${seq}`', () => {
    const log = new EventLog('bob');
    expect(log.apply(legitEvent({ id: 'mallory:1' }))).toBe(false);
    expect(log.apply(legitEvent({ id: 'alice:2' }))).toBe(false);
    expect(log.apply(legitEvent({ id: 'alice:1:extra' }))).toBe(false);
  });

  it('rejects clock that is not a plain object', () => {
    const log = new EventLog('bob');
    expect(log.apply(legitEvent({ clock: null as unknown as Record<string, number> }))).toBe(false);
    expect(log.apply(legitEvent({ clock: [] as unknown as Record<string, number> }))).toBe(false);
    expect(log.apply(legitEvent({ clock: 'x' as unknown as Record<string, number> }))).toBe(false);
  });

  it('rejects clock missing the authoring peer or with mismatched seq', () => {
    const log = new EventLog('bob');
    expect(log.apply(legitEvent({ clock: {} }))).toBe(false);
    expect(log.apply(legitEvent({ clock: { alice: 0 } }))).toBe(false);
    expect(log.apply(legitEvent({ clock: { alice: 2 } }))).toBe(false);
  });

  it('rejects clock entries with non-integer / negative / absurd values', () => {
    const log = new EventLog('bob');
    expect(
      log.apply(legitEvent({ clock: { alice: 1, mallory: -1 } }))
    ).toBe(false);
    expect(
      log.apply(legitEvent({ clock: { alice: 1, mallory: 1.5 } }))
    ).toBe(false);
    expect(
      log.apply(
        legitEvent({ clock: { alice: 1, mallory: 'foo' as unknown as number } })
      )
    ).toBe(false);
    expect(
      log.apply(legitEvent({ clock: { alice: 1, mallory: 1_000_000_001 } }))
    ).toBe(false);
  });

  it('rejects non-string kind', () => {
    const log = new EventLog('bob');
    expect(log.apply(legitEvent({ kind: 42 as unknown as string }))).toBe(false);
    expect(log.apply(legitEvent({ kind: '' }))).toBe(false);
  });

  it('rejects non-number ts', () => {
    const log = new EventLog('bob');
    expect(log.apply(legitEvent({ ts: 'now' as unknown as number }))).toBe(false);
    expect(log.apply(legitEvent({ ts: NaN }))).toBe(false);
  });
});

describe('EventLog.apply — prototype-pollution defense', () => {
  // Builtin Object property names that, if used as a peerId or a
  // clock-entry key, would either pollute the prototype chain or
  // shadow built-in methods, corrupting downstream Object.keys /
  // Object.entries / Object iteration.
  const POISONOUS_KEYS = [
    '__proto__',
    'constructor',
    'prototype',
    'toString',
    'hasOwnProperty',
    'valueOf',
    'isPrototypeOf'
  ];

  for (const bad of POISONOUS_KEYS) {
    it(`rejects "${bad}" as peerId`, () => {
      const log = new EventLog('bob');
      expect(
        log.apply(
          legitEvent({
            id: `${bad}:1`,
            peerId: bad,
            seq: 1,
            clock: { [bad]: 1 }
          })
        )
      ).toBe(false);
    });

    it(`rejects "${bad}" as a clock-entry key`, () => {
      const log = new EventLog('bob');
      expect(
        log.apply(
          legitEvent({ clock: { alice: 1, [bad]: 0 } })
        )
      ).toBe(false);
    });
  }
});

describe('EventLog.apply — length caps', () => {
  it('rejects peerId longer than the cap', () => {
    const log = new EventLog('bob');
    const huge = 'x'.repeat(257);
    expect(
      log.apply(
        legitEvent({ id: `${huge}:1`, peerId: huge, clock: { [huge]: 1 } })
      )
    ).toBe(false);
  });

  it('rejects kind longer than the cap', () => {
    const log = new EventLog('bob');
    expect(log.apply(legitEvent({ kind: 'x'.repeat(257) }))).toBe(false);
  });
});

describe('EventLog.apply — vector clock forgery resistance', () => {
  it('caps absolute clock-entry damage via the seq cap', () => {
    // The full impersonation defense (transport sender == event.peerId)
    // lives in Peer.handleMessage; EventLog alone cannot tell whether
    // the wire really sent this event from `peerId`.  What EventLog CAN
    // do is bound the damage: a hostile event cannot inflate any clock
    // entry above SEQ_CAP (1e9), so even if a forged event slips through
    // the transport check, peer-X's future seq numbering can never jump
    // by more than that bound.
    const bob = new EventLog('bob');
    expect(
      bob.apply({
        id: 'mallory:1',
        peerId: 'mallory',
        seq: 1,
        clock: { mallory: 1, alice: 1_000_000_001 },
        kind: 'chat',
        payload: { text: 'forged-too-big' },
        ts: Date.now()
      })
    ).toBe(false);
  });

  it('a peer cannot squat another peer-id by mismatching id, peerId, and seq', () => {
    // The id must be `${peerId}:${seq}` — so a sender can't try
    // `id: 'alice:1'` with `peerId: 'mallory'`.  This rules out the
    // simplest case of id-forgery at the log level.  Higher-level
    // impersonation (well-formed event whose claimed peerId doesn't
    // match the transport sender) is enforced in Peer.handleMessage
    // (see R2.1).
    const log = new EventLog('bob');
    expect(
      log.apply(
        legitEvent({
          id: 'alice:1',
          peerId: 'mallory',
          seq: 1,
          clock: { mallory: 1 }
        })
      )
    ).toBe(false);
  });
});

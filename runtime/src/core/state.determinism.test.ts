// @vitest-environment node

/**
 * #405 (2026-05-28, senior Test/Architecture consultancy): replay
 * determinism + the LWW concurrent-write tiebreak.
 *
 * Two invariants the rest of the system trusts but that were
 * under-tested (backlog E-TEST-1):
 *
 *   1. **Convergence.** `materialize` is a pure fold, and ordering is
 *      owned by `EventLog.events()` (sorted by `causalCompare`:
 *      sum-of-clock → lexicographic peerId → seq).  So ANY order in
 *      which peers receive the same event set must converge to the
 *      same materialized state.  The runtime path is
 *      `materialize(log.events())` — so this test routes through
 *      `EventLog.apply` + `events()`, NOT raw `materialize` on an
 *      unsorted array (which would NOT sort — the playbook
 *      "test the real predicate" rule).
 *
 *   2. **The LWW hazard.** For two CONCURRENT writes to the same
 *      (pcId, field) with equal clock-sums, the winner is the
 *      lexicographically-greater peerId — NOT the later wall-clock
 *      `ts`.  This is a real, intentional property of `causalCompare`
 *      (event-log.ts:184) that nothing else pins.  If a future change
 *      ever makes ordering depend on `ts`, this fails loudly.
 */

import { describe, it, expect } from 'vitest';
import { EventLog, type QuireEvent } from './event-log';
import { materialize, type SessionState } from './state';

/** Hand-build a valid QuireEvent (passes EventLog.apply's isValidEvent). */
function ev(
  peerId: string,
  seq: number,
  clock: Record<string, number>,
  kind: string,
  payload: unknown,
  ts: number
): QuireEvent {
  return {
    id: `${peerId}:${seq}`,
    peerId,
    seq,
    clock,
    kind: kind as QuireEvent['kind'],
    payload,
    ts
  };
}

/** Deterministic, seedable PRNG (mulberry32) — reproducible fuzzing. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('#405 LWW concurrent-write tiebreak (peerId, NOT wall-clock ts)', () => {
  it('greater peerId wins a same-sum concurrent edit even with an EARLIER ts', () => {
    // alice & bob each author their FIRST event → clock sum 1 each →
    // concurrent, equal sum.  alice's ts is LATER (5000 > 1000), yet
    // bob wins because "bob" > "alice" lexicographically.  This pins
    // greatest-peerId-wins and proves ts is ignored.
    const alice = ev('alice', 1, { alice: 1 }, 'pc-edit',
      { v: 1, pcId: 'pc1', field: 'harm', value: 1 }, 5000);
    const bob = ev('bob', 1, { bob: 1 }, 'pc-edit',
      { v: 1, pcId: 'pc1', field: 'harm', value: 2 }, 1000);

    const obs1 = new EventLog('obs1');
    expect(obs1.apply(alice)).toBe(true);
    expect(obs1.apply(bob)).toBe(true);
    const s1 = materialize(obs1.events());

    // Reverse apply order → identical result (order-independence).
    const obs2 = new EventLog('obs2');
    obs2.apply(bob);
    obs2.apply(alice);
    const s2 = materialize(obs2.events());

    expect(s1.pcEdits.pc1.harm).toBe(2); // bob wins (greater peerId)
    expect(s2.pcEdits.pc1.harm).toBe(2);
  });

  it('three concurrent same-sum writes resolve to the lexicographically-greatest peerId', () => {
    const a = ev('alice', 1, { alice: 1 }, 'pc-edit',
      { v: 1, pcId: 'pc1', field: 'harm', value: 1 }, 9000);
    const b = ev('bob', 1, { bob: 1 }, 'pc-edit',
      { v: 1, pcId: 'pc1', field: 'harm', value: 2 }, 8000);
    const c = ev('carol', 1, { carol: 1 }, 'pc-edit',
      { v: 1, pcId: 'pc1', field: 'harm', value: 3 }, 1);
    const obs = new EventLog('obs');
    for (const e of [c, a, b]) obs.apply(e); // arbitrary apply order
    // "carol" > "bob" > "alice"; carol last in sorted order → wins,
    // despite having the EARLIEST ts (1).
    expect(materialize(obs.events()).pcEdits.pc1.harm).toBe(3);
  });

  it('a causally-later write (higher clock sum) always wins regardless of ts', () => {
    // bob saw alice's edit, then edited → bob's clock {alice:1,bob:1}
    // sum 2 > alice's sum 1.  bob happens-after alice, so bob wins even
    // with an earlier ts.
    const alice = ev('alice', 1, { alice: 1 }, 'pc-edit',
      { v: 1, pcId: 'pc1', field: 'harm', value: 1 }, 9999);
    const bob = ev('bob', 1, { alice: 1, bob: 1 }, 'pc-edit',
      { v: 1, pcId: 'pc1', field: 'harm', value: 2 }, 1);
    const obs = new EventLog('obs');
    obs.apply(bob);
    obs.apply(alice);
    expect(materialize(obs.events()).pcEdits.pc1.harm).toBe(2);
  });
});

describe('#405 replay convergence (any receive order → same state)', () => {
  type Action = { kind: string; payload: unknown };
  const PC_FIELDS = ['harm', 'stress', 'marks', 'notes'] as const;

  function buildScenario(seed: number): QuireEvent[] {
    const rng = mulberry32(seed);
    const pick = <T,>(arr: readonly T[]): T =>
      arr[Math.floor(rng() * arr.length)];
    const peers = ['alice', 'bob', 'carol'];
    const logs = new Map(peers.map((p) => [p, new EventLog(p)]));
    const all: QuireEvent[] = [];
    const steps = 12 + Math.floor(rng() * 18);
    for (let i = 0; i < steps; i++) {
      const author = pick(peers);
      const log = logs.get(author)!;
      // Occasionally sync a random prior event from another peer first
      // (creates a happens-before edge → mixed concurrent/causal).
      if (all.length > 0 && rng() < 0.4) {
        const prior = all[Math.floor(rng() * all.length)];
        log.apply(prior);
      }
      const action: Action =
        rng() < 0.6
          ? {
              kind: 'pc-edit',
              payload: {
                v: 1,
                pcId: pick(['pc1', 'pc2']),
                field: pick(PC_FIELDS),
                value: Math.floor(rng() * 5)
              }
            }
          : rng() < 0.5
            ? { kind: 'chat', payload: { v: 1, text: `m${i}` } }
            : {
                kind: 'raise-hand',
                payload: { v: 1 }
              };
      const e = log.append(action.kind as QuireEvent['kind'], action.payload);
      all.push(e);
    }
    return all;
  }

  function applyAllInOrder(
    events: QuireEvent[],
    order: number[]
  ): SessionState {
    const obs = new EventLog('observer');
    for (const idx of order) obs.apply(events[idx]);
    return materialize(obs.events());
  }

  function shuffle(n: number, rng: () => number): number[] {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  it('50 random scenarios converge under arbitrary receive orderings', () => {
    for (let scenario = 0; scenario < 50; scenario++) {
      const seed = 0x5eed + scenario * 7919;
      const events = buildScenario(seed);
      const reference = applyAllInOrder(
        events,
        events.map((_, i) => i)
      );
      const permRng = mulberry32(seed ^ 0xabcdef);
      for (let trial = 0; trial < 4; trial++) {
        const order = shuffle(events.length, permRng);
        const got = applyAllInOrder(events, order);
        expect(
          got,
          `convergence broke: seed=${seed} trial=${trial} ` +
            `(re-run with this seed to reproduce)`
        ).toEqual(reference);
      }
    }
  });
});

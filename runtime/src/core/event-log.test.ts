import { describe, it, expect } from 'vitest';
import { EventLog, compareClocks, type VectorClock } from './event-log';

describe('EventLog — basics', () => {
  it('starts empty with an empty clock', () => {
    const log = new EventLog('alice');
    expect(log.events()).toHaveLength(0);
    expect(log.snapshot()).toEqual({});
  });

  it('appends events with monotonically incrementing seq', () => {
    const log = new EventLog('alice');
    log.append('chat', { text: 'hello' });
    log.append('chat', { text: 'world' });
    const events = log.events();
    expect(events).toHaveLength(2);
    expect(events[0].seq).toBe(1);
    expect(events[1].seq).toBe(2);
  });

  it('stamps each event with this peer id and a wall-clock timestamp', () => {
    const before = Date.now();
    const log = new EventLog('alice');
    const ev = log.append('chat', { text: 'hi' });
    const after = Date.now();
    expect(ev.peerId).toBe('alice');
    expect(ev.ts).toBeGreaterThanOrEqual(before);
    expect(ev.ts).toBeLessThanOrEqual(after);
  });

  it('produces deterministic event ids of the form peerId:seq', () => {
    const log = new EventLog('alice');
    const ev = log.append('chat', { text: 'hi' });
    expect(ev.id).toBe('alice:1');
  });

  it('snapshots the clock at the time of append', () => {
    const log = new EventLog('alice');
    const ev = log.append('chat', { text: 'hi' });
    expect(ev.clock).toEqual({ alice: 1 });
    log.append('chat', { text: 'two' });
    // First event's clock is unchanged
    expect(log.events()[0].clock).toEqual({ alice: 1 });
  });

  it('event payloads can be any JSON-shaped value', () => {
    const log = new EventLog('alice');
    log.append('roll', { kind: 'd20', result: 17 });
    log.append('note', 'a string payload');
    log.append('list', [1, 2, 3]);
    expect(log.events()).toHaveLength(3);
  });
});

describe('EventLog — replication', () => {
  it('integrates an external event into this log', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    const ev = bob.append('chat', { text: 'hi' });
    expect(alice.apply(ev)).toBe(true);
    expect(alice.events()).toHaveLength(1);
    expect(alice.events()[0].peerId).toBe('bob');
  });

  it('is idempotent on the same event', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    const ev = bob.append('chat', { text: 'hi' });
    expect(alice.apply(ev)).toBe(true);
    expect(alice.apply(ev)).toBe(false);
    expect(alice.events()).toHaveLength(1);
  });

  it('merges the applied event clock element-wise max', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    bob.append('chat', { text: '1' });
    bob.append('chat', { text: '2' });
    const ev2 = bob.events()[1];
    alice.apply(ev2);
    expect(alice.snapshot()).toEqual({ bob: 2 });
  });

  it('uses merged clock for subsequent local appends', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.apply(bob.append('chat', { text: 'hi' }));
    const ev = alice.append('chat', { text: 'hi back' });
    expect(ev.clock).toEqual({ alice: 1, bob: 1 });
  });
});

describe('EventLog — causal ordering', () => {
  it('orders happens-before pairs correctly', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    const a1 = alice.append('chat', { text: 'first' });
    bob.apply(a1);
    bob.append('chat', { text: 'reply' });
    // Bring everything to a third observer
    const observer = new EventLog('observer');
    for (const ev of bob.events()) observer.apply(ev);
    const ordered = observer.events();
    expect(ordered[0].payload).toEqual({ text: 'first' });
    expect(ordered[1].payload).toEqual({ text: 'reply' });
  });

  it('orders concurrent events deterministically by peer id', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    const a1 = alice.append('chat', { text: 'alice' });
    const b1 = bob.append('chat', { text: 'bob' });

    const obs1 = new EventLog('obs1');
    obs1.apply(a1);
    obs1.apply(b1);

    const obs2 = new EventLog('obs2');
    obs2.apply(b1);
    obs2.apply(a1);

    expect(obs1.events().map((e) => e.id)).toEqual(
      obs2.events().map((e) => e.id)
    );
    expect(obs1.events()[0].peerId).toBe('alice');
    expect(obs1.events()[1].peerId).toBe('bob');
  });

  it('orders same-peer events by seq', () => {
    const alice = new EventLog('alice');
    alice.append('chat', { text: '1' });
    alice.append('chat', { text: '2' });
    alice.append('chat', { text: '3' });
    const obs = new EventLog('obs');
    // Apply out of order
    obs.apply(alice.events()[2]);
    obs.apply(alice.events()[0]);
    obs.apply(alice.events()[1]);
    const ordered = obs.events();
    expect(ordered.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});

describe('EventLog — since', () => {
  it('returns events not yet seen by the given clock', () => {
    const alice = new EventLog('alice');
    const bob = new EventLog('bob');
    alice.append('chat', { text: '1' });
    alice.apply(bob.append('chat', { text: '2' }));

    expect(alice.since({}).length).toBe(2);
    expect(alice.since({ alice: 1, bob: 0 }).length).toBe(1);
    expect(alice.since({ alice: 1, bob: 1 }).length).toBe(0);
  });

  it('treats a peer absent from the clock as zero', () => {
    const alice = new EventLog('alice');
    alice.append('chat', { text: 'hi' });
    expect(alice.since({}).length).toBe(1);
    expect(alice.since({ bob: 99 }).length).toBe(1);
  });
});

describe('compareClocks', () => {
  it('detects equal clocks', () => {
    expect(compareClocks({ alice: 1 }, { alice: 1 })).toBe('equal');
    expect(compareClocks({}, {})).toBe('equal');
  });

  it('detects before / after on single dimension', () => {
    expect(compareClocks({ alice: 1 }, { alice: 2 })).toBe('before');
    expect(compareClocks({ alice: 2 }, { alice: 1 })).toBe('after');
  });

  it('detects before / after when one clock is a strict superset', () => {
    expect(compareClocks({ alice: 1 }, { alice: 1, bob: 1 })).toBe('before');
    expect(compareClocks({ alice: 1, bob: 1 }, { alice: 1 })).toBe('after');
  });

  it('detects concurrent clocks', () => {
    expect(compareClocks({ alice: 1 }, { bob: 1 })).toBe('concurrent');
    expect(compareClocks({ alice: 2, bob: 1 }, { alice: 1, bob: 2 })).toBe(
      'concurrent'
    );
  });

  it('treats missing keys as zero', () => {
    const a: VectorClock = { alice: 1, bob: 0 };
    const b: VectorClock = { alice: 1 };
    expect(compareClocks(a, b)).toBe('equal');
  });
});

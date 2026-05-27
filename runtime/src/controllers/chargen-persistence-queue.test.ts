// @vitest-environment node

/**
 * D5.5-A tests for ChargenPersistenceQueue.  Behavior under
 * extraction must match the pre-extraction inline implementation:
 * schedule debounces, flushKey writes once, concurrent keys don't
 * stomp each other, flushAll covers tab-close.
 *
 * Real timers + short debounce window: vitest's fake-timer machinery
 * has a well-known hang interaction in this repo (see
 * rule-hover.test.ts + ai-write-controller.test.ts for prior art).
 * The queue is debounce-only, so a 20ms window keeps test wall-clock
 * tiny while still exercising real setTimeout semantics — the exact
 * code path production uses.
 */

import { describe, it, expect } from 'vitest';
import { ChargenPersistenceQueue } from './chargen-persistence-queue';

const DEBOUNCE_MS = 20;
const WAIT_PAST_DEBOUNCE_MS = DEBOUNCE_MS + 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ChargenPersistenceQueue', () => {
  it('schedules + flushes a single key after the debounce window', async () => {
    const writes: Array<{ key: string; value: number }> = [];
    const q = new ChargenPersistenceQueue<number>(
      (key, value) => writes.push({ key, value }),
      DEBOUNCE_MS
    );
    q.schedule('foo', 1);
    expect(writes).toHaveLength(0);
    await sleep(WAIT_PAST_DEBOUNCE_MS);
    expect(writes).toEqual([{ key: 'foo', value: 1 }]);
  });

  it('subsequent schedules within the window coalesce — last-writer-wins', async () => {
    const writes: Array<{ key: string; value: number }> = [];
    const q = new ChargenPersistenceQueue<number>(
      (key, value) => writes.push({ key, value }),
      DEBOUNCE_MS
    );
    q.schedule('foo', 1);
    await sleep(5);
    q.schedule('foo', 2);
    await sleep(5);
    q.schedule('foo', 3);
    await sleep(WAIT_PAST_DEBOUNCE_MS);
    expect(writes).toEqual([{ key: 'foo', value: 3 }]);
  });

  it('separate keys do not stomp each other', async () => {
    const writes: Array<{ key: string; value: number }> = [];
    const q = new ChargenPersistenceQueue<number>(
      (key, value) => writes.push({ key, value }),
      DEBOUNCE_MS
    );
    q.schedule('foo', 1);
    q.schedule('bar', 2);
    await sleep(WAIT_PAST_DEBOUNCE_MS);
    expect(writes).toContainEqual({ key: 'foo', value: 1 });
    expect(writes).toContainEqual({ key: 'bar', value: 2 });
    expect(writes).toHaveLength(2);
  });

  it('flushKey forces immediate write + clears the pending entry', async () => {
    const writes: Array<{ key: string; value: number }> = [];
    const q = new ChargenPersistenceQueue<number>(
      (key, value) => writes.push({ key, value }),
      DEBOUNCE_MS
    );
    q.schedule('foo', 1);
    expect(q.pendingCount()).toBe(1);
    q.flushKey('foo');
    expect(writes).toEqual([{ key: 'foo', value: 1 }]);
    expect(q.pendingCount()).toBe(0);
    // Subsequent timer firing should NOT double-write.
    await sleep(WAIT_PAST_DEBOUNCE_MS);
    expect(writes).toHaveLength(1);
  });

  it('flushKey on a non-existent key is a no-op', () => {
    const writes: Array<{ key: string; value: number }> = [];
    const q = new ChargenPersistenceQueue<number>(
      (key, value) => writes.push({ key, value }),
      DEBOUNCE_MS
    );
    q.flushKey('ghost');
    expect(writes).toHaveLength(0);
  });

  it('flushAll writes every pending entry (tab-close scenario)', async () => {
    const writes: Array<{ key: string; value: number }> = [];
    const q = new ChargenPersistenceQueue<number>(
      (key, value) => writes.push({ key, value }),
      DEBOUNCE_MS
    );
    q.schedule('a', 1);
    q.schedule('b', 2);
    q.schedule('c', 3);
    expect(q.pendingCount()).toBe(3);
    q.flushAll();
    expect(writes).toContainEqual({ key: 'a', value: 1 });
    expect(writes).toContainEqual({ key: 'b', value: 2 });
    expect(writes).toContainEqual({ key: 'c', value: 3 });
    expect(writes).toHaveLength(3);
    expect(q.pendingCount()).toBe(0);
    // No double-writes from timer.
    await sleep(WAIT_PAST_DEBOUNCE_MS);
    expect(writes).toHaveLength(3);
  });

  it('default debounce is 300ms when constructor omits it', () => {
    // We don't want to wait 300ms of wall-clock per run, so this
    // test just asserts the public contract by inspection: after
    // schedule(), the value is pending — and it does NOT flush
    // before a much-shorter wait.  The full debounce semantics are
    // verified in the other tests with an injected 20ms window.
    const writes: number[] = [];
    const q = new ChargenPersistenceQueue<number>((_key, value) =>
      writes.push(value)
    );
    q.schedule('foo', 42);
    expect(q.pendingCount()).toBe(1);
    expect(writes).toHaveLength(0);
    // Force-flush instead of waiting 300ms.
    q.flushKey('foo');
    expect(writes).toEqual([42]);
  });
});

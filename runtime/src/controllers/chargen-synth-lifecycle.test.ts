// @vitest-environment node

/**
 * D5.5-A step 3 tests for ChargenSynthLifecycle.  Focus: per-slot
 * isolation of the 4 state slots + the generation-counter
 * invalidation pattern that backs the Scenario-4 fix.
 */

import { describe, it, expect } from 'vitest';
import { ChargenSynthLifecycle } from './chargen-synth-lifecycle';
import type { SynthesizeBackstoryResult } from '../ai/backstory-synthesizer';

function fakeOkResult(name = 'Mei'): SynthesizeBackstoryResult {
  return {
    ok: true,
    response: {
      name,
      pronouns: 'they/them',
      tags: ['a', 'b', 'c'],
      stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
      skillMastery: ['Tech'],
      backstory: 'x',
      raw: '{}',
      tokensIn: 0,
      tokensOut: 0,
      responseId: 'r1'
    },
    warnings: [],
    retried: false
  } as SynthesizeBackstoryResult;
}

describe('ChargenSynthLifecycle — synthResults', () => {
  it('set + get + has + delete round-trip', () => {
    const s = new ChargenSynthLifecycle();
    expect(s.hasResult(1)).toBe(false);
    expect(s.getResult(1)).toBeUndefined();
    s.setResult(1, fakeOkResult('Mei'));
    expect(s.hasResult(1)).toBe(true);
    expect(s.getResult(1)?.ok).toBe(true);
    expect(s.deleteResult(1)).toBe(true);
    expect(s.hasResult(1)).toBe(false);
  });

  it('resultKeys enumerates slots with cached results', () => {
    const s = new ChargenSynthLifecycle();
    s.setResult(1, fakeOkResult());
    s.setResult(3, fakeOkResult());
    expect([...s.resultKeys()].sort()).toEqual([1, 3]);
  });
});

describe('ChargenSynthLifecycle — synthInFlight', () => {
  it('mark + clear + isSynthInFlight', () => {
    const s = new ChargenSynthLifecycle();
    expect(s.isSynthInFlight(1)).toBe(false);
    s.markSynthInFlight(1);
    expect(s.isSynthInFlight(1)).toBe(true);
    expect(s.clearSynthInFlight(1)).toBe(true);
    expect(s.isSynthInFlight(1)).toBe(false);
  });

  it('synthInFlightSize tracks current count', () => {
    const s = new ChargenSynthLifecycle();
    s.markSynthInFlight(1);
    s.markSynthInFlight(2);
    expect(s.synthInFlightSize()).toBe(2);
    s.clearSynthInFlight(1);
    expect(s.synthInFlightSize()).toBe(1);
  });

  it('clearAllSynthInFlight wipes every in-flight flag (hostDisconnected)', () => {
    const s = new ChargenSynthLifecycle();
    s.markSynthInFlight(1);
    s.markSynthInFlight(2);
    s.markSynthInFlight(3);
    s.clearAllSynthInFlight();
    expect(s.synthInFlightSize()).toBe(0);
  });
});

describe('ChargenSynthLifecycle — resyncInFlight', () => {
  it('mark + clear + isResyncInFlight', () => {
    const s = new ChargenSynthLifecycle();
    expect(s.isResyncInFlight(1)).toBe(false);
    s.markResyncInFlight(1);
    expect(s.isResyncInFlight(1)).toBe(true);
    expect(s.clearResyncInFlight(1)).toBe(true);
    expect(s.isResyncInFlight(1)).toBe(false);
  });

  it('snapshot is shallow-clone + mutation-safe', () => {
    const s = new ChargenSynthLifecycle();
    s.markResyncInFlight(1);
    const snap = s.resyncInFlightSnapshot() as unknown as Set<number>;
    snap.add(99);
    expect(s.isResyncInFlight(99)).toBe(false);
  });
});

describe('ChargenSynthLifecycle — generation counter', () => {
  it('captureGeneration returns 0 for an untouched slot', () => {
    const s = new ChargenSynthLifecycle();
    expect(s.captureGeneration(1)).toBe(0);
  });

  it('bumpGeneration increments the per-slot counter', () => {
    const s = new ChargenSynthLifecycle();
    s.bumpGeneration(1);
    expect(s.captureGeneration(1)).toBe(1);
    s.bumpGeneration(1);
    expect(s.captureGeneration(1)).toBe(2);
    // Other slots unaffected.
    expect(s.captureGeneration(2)).toBe(0);
  });

  it('captureGeneration vs currentGeneration: pre-await / post-await pattern', () => {
    const s = new ChargenSynthLifecycle();
    // Caller captures pre-await.
    const captured = s.captureGeneration(1);
    expect(captured).toBe(0);
    // Mid-flight: someone else (clearSlot) bumps.
    s.bumpGeneration(1);
    // Caller checks post-await.
    expect(s.currentGeneration(1)).toBe(1);
    expect(s.currentGeneration(1) !== captured).toBe(true); // invalidation signal
  });
});

describe('ChargenSynthLifecycle — clearSlot aggregate', () => {
  it('wipes synthResults + bumps generation; preserves in-flight flags', () => {
    const s = new ChargenSynthLifecycle();
    s.setResult(1, fakeOkResult());
    s.markSynthInFlight(1);
    s.markResyncInFlight(1);

    const hadResult = s.clearSlot(1);

    expect(hadResult).toBe(true);
    expect(s.hasResult(1)).toBe(false);
    expect(s.captureGeneration(1)).toBe(1);
    // Critically: in-flight finally-blocks own their own teardown.
    expect(s.isSynthInFlight(1)).toBe(true);
    expect(s.isResyncInFlight(1)).toBe(true);
  });

  it('returns false when no result was cached (so caller skips requestUpdate)', () => {
    const s = new ChargenSynthLifecycle();
    const hadResult = s.clearSlot(1);
    expect(hadResult).toBe(false);
    // Generation still bumped — invalidates any in-flight synth.
    expect(s.captureGeneration(1)).toBe(1);
  });

  it('does not affect other slots', () => {
    const s = new ChargenSynthLifecycle();
    s.setResult(1, fakeOkResult());
    s.setResult(2, fakeOkResult());
    s.clearSlot(1);
    expect(s.hasResult(2)).toBe(true);
    expect(s.captureGeneration(2)).toBe(0);
  });
});

// @vitest-environment node

/**
 * D5.5-A step 2 tests for ChargenAcceptanceMachine.  Behavior must
 * match the pre-extraction inline implementation in chargen-
 * controller.ts.  Focus areas:
 *
 *   - Thin accessors round-trip + isolate per-slot
 *   - `getJoiningSession` defaults to 1 when unset (load-bearing
 *     for catch-up math)
 *   - The 3 named reset methods clear the EXACT inline-block
 *     subsets the controller used pre-extraction (any drift here
 *     IS the bug)
 *   - Snapshot accessors return shallow clones (caller-mutation
 *     safe)
 */

import { describe, it, expect } from 'vitest';
import {
  ChargenAcceptanceMachine,
  type PreAcceptDrift,
  type ResyncFailure
} from './chargen-acceptance-machine';

describe('ChargenAcceptanceMachine — accepted', () => {
  it('mark + unmark + isAccepted round-trip', () => {
    const m = new ChargenAcceptanceMachine();
    expect(m.isAccepted(1)).toBe(false);
    m.markAccepted(1);
    expect(m.isAccepted(1)).toBe(true);
    expect(m.unmarkAccepted(1)).toBe(true);
    expect(m.isAccepted(1)).toBe(false);
    expect(m.unmarkAccepted(1)).toBe(false); // double-clear no-op
  });

  it('per-slot isolation', () => {
    const m = new ChargenAcceptanceMachine();
    m.markAccepted(1);
    expect(m.isAccepted(1)).toBe(true);
    expect(m.isAccepted(2)).toBe(false);
  });

  it('acceptedIterator enumerates marked slots', () => {
    const m = new ChargenAcceptanceMachine();
    m.markAccepted(1);
    m.markAccepted(3);
    m.markAccepted(2);
    expect([...m.acceptedIterator()].sort()).toEqual([1, 2, 3]);
  });
});

describe('ChargenAcceptanceMachine — raceMismatch', () => {
  it('mark + clear + hasRaceMismatch', () => {
    const m = new ChargenAcceptanceMachine();
    expect(m.hasRaceMismatch(1)).toBe(false);
    m.markRaceMismatch(1);
    expect(m.hasRaceMismatch(1)).toBe(true);
    expect(m.clearRaceMismatch(1)).toBe(true);
    expect(m.hasRaceMismatch(1)).toBe(false);
    expect(m.clearRaceMismatch(1)).toBe(false);
  });

  it('snapshot returns a shallow clone (mutation-safe)', () => {
    const m = new ChargenAcceptanceMachine();
    m.markRaceMismatch(1);
    // Cast through unknown: the public type is ReadonlySet (load-
    // bearing for caller intent), but at runtime we verify the
    // returned Set is a fresh clone, not the internal reference.
    const snap = m.raceMismatchSnapshot() as unknown as Set<number>;
    snap.add(99);
    expect(m.hasRaceMismatch(99)).toBe(false);
  });
});

describe('ChargenAcceptanceMachine — preAcceptOriginals', () => {
  it('set + get + delete', () => {
    const m = new ChargenAcceptanceMachine();
    expect(m.getPreAcceptOriginal(1)).toBeUndefined();
    const drift: PreAcceptDrift = { name: 'Mei' };
    m.setPreAcceptOriginal(1, drift);
    expect(m.getPreAcceptOriginal(1)).toBe(drift);
    expect(m.deletePreAcceptOriginal(1)).toBe(true);
    expect(m.getPreAcceptOriginal(1)).toBeUndefined();
  });

  it('preAcceptOriginalEntries enumerates all', () => {
    const m = new ChargenAcceptanceMachine();
    m.setPreAcceptOriginal(1, { name: 'Mei' });
    m.setPreAcceptOriginal(2, { pronouns: 'they/them' });
    const entries = [...m.preAcceptOriginalEntries()];
    expect(entries).toHaveLength(2);
    expect(entries.map(([s]) => s).sort()).toEqual([1, 2]);
  });
});

describe('ChargenAcceptanceMachine — pronounPatched', () => {
  it('mark + clear', () => {
    const m = new ChargenAcceptanceMachine();
    m.markPronounPatched(1);
    expect(m.hasPronounPatch(1)).toBe(true);
    expect(m.clearPronounPatched(1)).toBe(true);
    expect(m.hasPronounPatch(1)).toBe(false);
  });
});

describe('ChargenAcceptanceMachine — resyncInFlight', () => {
  it('mark + clear', () => {
    const m = new ChargenAcceptanceMachine();
    m.markResyncInFlight(1);
    expect(m.isResyncInFlight(1)).toBe(true);
    expect(m.clearResyncInFlight(1)).toBe(true);
    expect(m.isResyncInFlight(1)).toBe(false);
  });

  it('snapshot mutation-safe', () => {
    const m = new ChargenAcceptanceMachine();
    m.markResyncInFlight(1);
    const snap = m.resyncInFlightSnapshot() as unknown as Set<number>;
    snap.add(99);
    expect(m.isResyncInFlight(99)).toBe(false);
  });
});

describe('ChargenAcceptanceMachine — resyncFailures', () => {
  it('set + get + clear', () => {
    const m = new ChargenAcceptanceMachine();
    const f: ResyncFailure = { code: 'spoiler', message: 'caught a leak' };
    m.setResyncFailure(1, f);
    expect(m.hasResyncFailure(1)).toBe(true);
    expect(m.getResyncFailure(1)).toBe(f);
    expect(m.clearResyncFailure(1)).toBe(true);
    expect(m.hasResyncFailure(1)).toBe(false);
  });

  it('snapshot mutation-safe', () => {
    const m = new ChargenAcceptanceMachine();
    m.setResyncFailure(1, { code: 'a', message: 'b' });
    const snap = m.resyncFailuresSnapshot() as unknown as Map<
      number,
      ResyncFailure
    >;
    snap.delete(1);
    expect(m.hasResyncFailure(1)).toBe(true);
  });
});

describe('ChargenAcceptanceMachine — originalBackstoryForResync', () => {
  it('set + get + delete + has', () => {
    const m = new ChargenAcceptanceMachine();
    expect(m.hasOriginalBackstoryForResync(1)).toBe(false);
    m.setOriginalBackstoryForResync(1, 'original prose');
    expect(m.getOriginalBackstoryForResync(1)).toBe('original prose');
    expect(m.hasOriginalBackstoryForResync(1)).toBe(true);
    expect(m.deleteOriginalBackstoryForResync(1)).toBe(true);
    expect(m.hasOriginalBackstoryForResync(1)).toBe(false);
  });
});

describe('ChargenAcceptanceMachine — joiningSession', () => {
  it('defaults to 1 when unset (load-bearing for catch-up)', () => {
    const m = new ChargenAcceptanceMachine();
    expect(m.getJoiningSession(1)).toBe(1);
  });

  it('set + clear round-trip', () => {
    const m = new ChargenAcceptanceMachine();
    m.setJoiningSession(1, 3);
    expect(m.getJoiningSession(1)).toBe(3);
    expect(m.clearJoiningSession(1)).toBe(true);
    expect(m.getJoiningSession(1)).toBe(1); // back to default
  });

  it('snapshot is shallow-clone', () => {
    const m = new ChargenAcceptanceMachine();
    m.setJoiningSession(1, 3);
    const snap = m.joiningSessionSnapshot() as unknown as Map<number, number>;
    snap.set(1, 99);
    expect(m.getJoiningSession(1)).toBe(3);
  });
});

describe('ChargenAcceptanceMachine — resetForRevise', () => {
  it('clears the 5-slot subset; KEEPS raceMismatch + resyncInFlight + joiningSession', () => {
    const m = new ChargenAcceptanceMachine();
    m.markAccepted(1);
    m.markRaceMismatch(1);
    m.setPreAcceptOriginal(1, { name: 'x' });
    m.markPronounPatched(1);
    m.markResyncInFlight(1);
    m.setResyncFailure(1, { code: 'a', message: 'b' });
    m.setOriginalBackstoryForResync(1, 'prose');
    m.setJoiningSession(1, 3);

    m.resetForRevise(1);

    expect(m.isAccepted(1)).toBe(false);
    expect(m.getPreAcceptOriginal(1)).toBeUndefined();
    expect(m.hasPronounPatch(1)).toBe(false);
    expect(m.hasOriginalBackstoryForResync(1)).toBe(false);
    expect(m.hasResyncFailure(1)).toBe(false);
    // Critically:
    expect(m.hasRaceMismatch(1)).toBe(true);
    expect(m.isResyncInFlight(1)).toBe(true);
    // Post-D5.5-A playthrough Scenario 6: joiningSession is table-
    // state, not per-attempt — revise must preserve it.
    expect(m.getJoiningSession(1)).toBe(3);
  });
});

describe('ChargenAcceptanceMachine — resetAfterFreshSynth', () => {
  it('fresh-synth ok (not a resync): clears accepted + raceMismatch only', () => {
    const m = new ChargenAcceptanceMachine();
    m.markAccepted(1);
    m.markRaceMismatch(1);
    m.setPreAcceptOriginal(1, { name: 'x' });
    m.setOriginalBackstoryForResync(1, 'prose');
    m.setResyncFailure(1, { code: 'a', message: 'b' });

    m.resetAfterFreshSynth(1, { resultOk: true, resyncSucceeded: false });

    expect(m.isAccepted(1)).toBe(false);
    expect(m.hasRaceMismatch(1)).toBe(false);
    // Drift + resync-anchor + failure preserved:
    expect(m.getPreAcceptOriginal(1)).toBeDefined();
    expect(m.hasOriginalBackstoryForResync(1)).toBe(true);
    expect(m.hasResyncFailure(1)).toBe(true);
  });

  /**
   * Post-D5.5-A playthrough Scenario 3 nit: a FAILED synth (or
   * failed resync) must NOT clear the raceMismatch banner — the
   * prior synth result is still the live one + the DM still
   * needs the "re-review" hint.
   */
  it('failed synth: clears accepted but KEEPS raceMismatch', () => {
    const m = new ChargenAcceptanceMachine();
    m.markAccepted(1);
    m.markRaceMismatch(1);

    m.resetAfterFreshSynth(1, { resultOk: false, resyncSucceeded: false });

    expect(m.isAccepted(1)).toBe(false);
    expect(m.hasRaceMismatch(1)).toBe(true);
  });

  it('successful resync: ALSO clears drift + original-backstory', () => {
    const m = new ChargenAcceptanceMachine();
    m.markAccepted(1);
    m.markRaceMismatch(1);
    m.setPreAcceptOriginal(1, { name: 'x' });
    m.setOriginalBackstoryForResync(1, 'prose');

    m.resetAfterFreshSynth(1, { resultOk: true, resyncSucceeded: true });

    expect(m.isAccepted(1)).toBe(false);
    expect(m.hasRaceMismatch(1)).toBe(false);
    expect(m.getPreAcceptOriginal(1)).toBeUndefined();
    expect(m.hasOriginalBackstoryForResync(1)).toBe(false);
  });
});

describe('ChargenAcceptanceMachine — resetForDelete', () => {
  it('clears all lifecycle state EXCEPT resyncInFlight', () => {
    const m = new ChargenAcceptanceMachine();
    m.markAccepted(1);
    m.markRaceMismatch(1);
    m.setPreAcceptOriginal(1, { name: 'x' });
    m.markPronounPatched(1);
    m.markResyncInFlight(1);
    m.setResyncFailure(1, { code: 'a', message: 'b' });
    m.setOriginalBackstoryForResync(1, 'prose');
    m.setJoiningSession(1, 3);

    m.resetForDelete(1);

    expect(m.isAccepted(1)).toBe(false);
    expect(m.hasRaceMismatch(1)).toBe(false);
    expect(m.getPreAcceptOriginal(1)).toBeUndefined();
    expect(m.hasPronounPatch(1)).toBe(false);
    expect(m.hasResyncFailure(1)).toBe(false);
    expect(m.hasOriginalBackstoryForResync(1)).toBe(false);
    expect(m.getJoiningSession(1)).toBe(1);
    // Critically: resyncInFlight survives so the in-flight async
    // cleans itself up via its own finally block.
    expect(m.isResyncInFlight(1)).toBe(true);
  });

  it('does not affect other slots', () => {
    const m = new ChargenAcceptanceMachine();
    m.markAccepted(1);
    m.markAccepted(2);
    m.resetForDelete(1);
    expect(m.isAccepted(2)).toBe(true);
  });
});

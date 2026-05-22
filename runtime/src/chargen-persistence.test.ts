// @vitest-environment happy-dom

/**
 * chargen-persistence tests (CC-11).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveChargenState,
  loadChargenState,
  clearChargenState,
  chargenStorageKey,
  CHARGEN_STORAGE_PREFIX
} from './chargen-persistence';

describe('chargenStorageKey', () => {
  it('builds a stable key for valid input', () => {
    expect(chargenStorageKey('gutschke/underleaf', 3)).toBe(
      `${CHARGEN_STORAGE_PREFIX}gutschke-underleaf:slot3`
    );
  });

  it('sanitizes special chars in the slug', () => {
    const k = chargenStorageKey('g/u@main!evil&..', 1);
    expect(k).not.toContain('/');
    expect(k).not.toContain('@');
    expect(k).not.toContain('..');
    expect(k).toContain('slot1');
  });

  it('throws for out-of-range slot', () => {
    expect(() => chargenStorageKey('x', 0)).toThrow();
    expect(() => chargenStorageKey('x', 10)).toThrow();
    expect(() => chargenStorageKey('x', 1.5)).toThrow();
  });
});

describe('saveChargenState + loadChargenState round-trip', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null when nothing is saved', () => {
    expect(loadChargenState('g/u', 1)).toBeNull();
  });

  it('round-trips a typical state', () => {
    saveChargenState(
      'gutschke/underleaf',
      3,
      {
        chosenPath: 'qa',
        answers: { archetype: 'hacker', item: 'a brass key' }
      },
      1700000000000
    );
    const loaded = loadChargenState('gutschke/underleaf', 3);
    expect(loaded).toEqual({
      chosenPath: 'qa',
      answers: { archetype: 'hacker', item: 'a brass key' },
      updatedAt: 1700000000000
    });
  });

  it('overwrites on subsequent save (LWW)', () => {
    saveChargenState('g/u', 1, { chosenPath: 'qa', answers: { q: 'first' } });
    saveChargenState(
      'g/u',
      1,
      { chosenPath: 'free-write', answers: { q: 'second' } },
      0
    );
    const loaded = loadChargenState('g/u', 1);
    expect(loaded?.chosenPath).toBe('free-write');
    expect(loaded?.answers).toEqual({ q: 'second' });
  });

  it('keys are slot-scoped (different slots, same slug)', () => {
    saveChargenState('g/u', 1, { chosenPath: 'qa', answers: { q: 'one' } });
    saveChargenState(
      'g/u',
      2,
      { chosenPath: 'free-write', answers: { q: 'two' } }
    );
    expect(loadChargenState('g/u', 1)?.answers.q).toBe('one');
    expect(loadChargenState('g/u', 2)?.answers.q).toBe('two');
  });

  it('keys are campaign-scoped (same slot, different slugs)', () => {
    saveChargenState('a/b', 1, { chosenPath: 'qa', answers: { q: 'ab' } });
    saveChargenState('c/d', 1, { chosenPath: 'qa', answers: { q: 'cd' } });
    expect(loadChargenState('a/b', 1)?.answers.q).toBe('ab');
    expect(loadChargenState('c/d', 1)?.answers.q).toBe('cd');
  });

  it('save does not mutate caller answers (shallow copy)', () => {
    const answers = { q: 'one' };
    saveChargenState('g/u', 1, { chosenPath: 'qa', answers });
    answers.q = 'mutated';
    const loaded = loadChargenState('g/u', 1);
    expect(loaded?.answers.q).toBe('one');
  });
});

describe('loadChargenState — corruption tolerance', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null on non-JSON storage value', () => {
    window.localStorage.setItem(
      chargenStorageKey('g/u', 1),
      'not-valid-json'
    );
    expect(loadChargenState('g/u', 1)).toBeNull();
  });

  it('returns null on JSON-not-object', () => {
    window.localStorage.setItem(chargenStorageKey('g/u', 1), '[]');
    expect(loadChargenState('g/u', 1)).toBeNull();
  });

  it('handles missing fields with sensible defaults', () => {
    window.localStorage.setItem(
      chargenStorageKey('g/u', 1),
      JSON.stringify({})
    );
    const loaded = loadChargenState('g/u', 1);
    expect(loaded).toEqual({
      chosenPath: '',
      answers: {},
      updatedAt: 0
    });
  });

  it('coerces unknown chosenPath to empty string', () => {
    window.localStorage.setItem(
      chargenStorageKey('g/u', 1),
      JSON.stringify({ chosenPath: 'invalid-path' })
    );
    const loaded = loadChargenState('g/u', 1);
    expect(loaded?.chosenPath).toBe('');
  });

  it('drops non-string answer values', () => {
    window.localStorage.setItem(
      chargenStorageKey('g/u', 1),
      JSON.stringify({
        chosenPath: 'qa',
        answers: { ok: 'str', bad: 42, alsoBad: null }
      })
    );
    const loaded = loadChargenState('g/u', 1);
    expect(loaded?.answers).toEqual({ ok: 'str' });
  });

  it('returns null when slot is out of range (defensive)', () => {
    expect(loadChargenState('g/u', 10)).toBeNull();
    expect(loadChargenState('g/u', 0)).toBeNull();
  });
});

describe('clearChargenState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('removes the saved entry', () => {
    saveChargenState('g/u', 1, { chosenPath: 'qa', answers: { q: 'v' } });
    expect(loadChargenState('g/u', 1)).not.toBeNull();
    clearChargenState('g/u', 1);
    expect(loadChargenState('g/u', 1)).toBeNull();
  });

  it('does not affect other slots', () => {
    saveChargenState('g/u', 1, { chosenPath: 'qa', answers: { q: '1' } });
    saveChargenState('g/u', 2, { chosenPath: 'qa', answers: { q: '2' } });
    clearChargenState('g/u', 1);
    expect(loadChargenState('g/u', 2)?.answers.q).toBe('2');
  });

  it('is idempotent on a missing key', () => {
    expect(() => clearChargenState('never-saved', 1)).not.toThrow();
  });
});

describe('save tolerates localStorage failures (silent)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('does not throw when localStorage is unavailable', () => {
    // Simulate quota-exceeded by stubbing setItem to throw.
    const orig = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() =>
      saveChargenState('g/u', 1, {
        chosenPath: 'qa',
        answers: { q: 'v' }
      })
    ).not.toThrow();
    window.localStorage.setItem = orig;
  });
});

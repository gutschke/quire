/**
 * chargen-pack tests (CC-10).
 */

import { describe, it, expect } from 'vitest';
import {
  packChargen,
  parseChargenPack,
  stringifyChargenPack,
  suggestedPackFilename,
  CHARGEN_PACK_SCHEMA_VERSION,
  ChargenPackError
} from './chargen-pack';

describe('packChargen', () => {
  const base = {
    campaignFingerprint: 'fpabc123',
    slot: 3,
    chosenPath: 'qa' as const,
    answers: { archetype: 'hacker' },
    nowMs: 1700000000000
  };

  it('produces a complete document', () => {
    const out = packChargen(base);
    expect(out.$schemaVersion).toBe(CHARGEN_PACK_SCHEMA_VERSION);
    expect(out.campaignFingerprint).toBe('fpabc123');
    expect(out.slot).toBe(3);
    expect(out.chosenPath).toBe('qa');
    expect(out.answers).toEqual({ archetype: 'hacker' });
    expect(out.packedAt).toBe(1700000000000);
  });

  it('defaults packedAt to Date.now() when not provided', () => {
    const before = Date.now();
    const out = packChargen({ ...base, nowMs: undefined });
    const after = Date.now();
    expect(out.packedAt).toBeGreaterThanOrEqual(before);
    expect(out.packedAt).toBeLessThanOrEqual(after);
  });

  it('shallow-copies answers (caller mutation doesn\'t leak)', () => {
    const answers = { a: '1', b: '2' };
    const out = packChargen({ ...base, answers });
    answers.a = 'mutated';
    expect(out.answers.a).toBe('1');
  });

  it('rejects non-integer slot', () => {
    expect(() => packChargen({ ...base, slot: 1.5 })).toThrow(
      ChargenPackError
    );
  });

  it('rejects slot out of [1, 9]', () => {
    for (const slot of [0, 10, -1]) {
      expect(() => packChargen({ ...base, slot })).toThrow(ChargenPackError);
    }
  });

  it('rejects empty campaignFingerprint', () => {
    expect(() =>
      packChargen({ ...base, campaignFingerprint: '' })
    ).toThrow(ChargenPackError);
  });

  it('accepts empty chosenPath (player didn\'t pick yet)', () => {
    const out = packChargen({ ...base, chosenPath: '' });
    expect(out.chosenPath).toBe('');
  });

  it('accepts empty answers (no questions answered yet)', () => {
    const out = packChargen({ ...base, answers: {} });
    expect(out.answers).toEqual({});
  });
});

describe('stringifyChargenPack', () => {
  it('produces parseable JSON', () => {
    const doc = packChargen({
      campaignFingerprint: 'fp',
      slot: 1,
      chosenPath: 'qa',
      answers: { archetype: 'hacker' },
      nowMs: 1700000000000
    });
    const json = stringifyChargenPack(doc);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)).toEqual(doc);
  });

  it('pretty-prints (2-space indent) for player inspection', () => {
    const doc = packChargen({
      campaignFingerprint: 'fp',
      slot: 1,
      chosenPath: '',
      answers: {},
      nowMs: 0
    });
    const json = stringifyChargenPack(doc);
    expect(json).toContain('\n  ');
  });
});

describe('parseChargenPack — round-trip', () => {
  it('round-trips a packed doc', () => {
    const original = packChargen({
      campaignFingerprint: 'fpabc',
      slot: 4,
      chosenPath: 'free-write',
      answers: { a: 'one', b: 'two with spaces' },
      nowMs: 1700000000000
    });
    const restored = parseChargenPack(stringifyChargenPack(original));
    expect(restored).toEqual(original);
  });
});

describe('parseChargenPack — validation', () => {
  function pack(overrides: Record<string, unknown>): string {
    return JSON.stringify({
      $schemaVersion: '0.1.0',
      campaignFingerprint: 'fp',
      slot: 1,
      chosenPath: '',
      answers: {},
      packedAt: 0,
      ...overrides
    });
  }

  it('throws malformed for non-JSON input', () => {
    expect(() => parseChargenPack('not-json')).toThrow(ChargenPackError);
  });

  it('throws malformed for JSON-but-not-object', () => {
    expect(() => parseChargenPack('"a string"')).toThrow(ChargenPackError);
    expect(() => parseChargenPack('[]')).toThrow(ChargenPackError);
  });

  it('throws schema-version on missing/invalid $schemaVersion', () => {
    try {
      parseChargenPack(pack({ $schemaVersion: undefined }));
    } catch (e) {
      expect((e as ChargenPackError).code).toBe('schema-version');
    }
    try {
      parseChargenPack(pack({ $schemaVersion: 'v1' }));
    } catch (e) {
      expect((e as ChargenPackError).code).toBe('schema-version');
    }
  });

  it('throws invalid-fingerprint on missing/empty fingerprint', () => {
    try {
      parseChargenPack(pack({ campaignFingerprint: '' }));
    } catch (e) {
      expect((e as ChargenPackError).code).toBe('invalid-fingerprint');
    }
  });

  it('throws invalid-slot on out-of-range slot', () => {
    try {
      parseChargenPack(pack({ slot: 10 }));
    } catch (e) {
      expect((e as ChargenPackError).code).toBe('invalid-slot');
    }
  });

  it('throws malformed on unknown chosenPath', () => {
    try {
      parseChargenPack(pack({ chosenPath: 'unknown-path' }));
    } catch (e) {
      expect((e as ChargenPackError).code).toBe('malformed');
    }
  });

  it('throws malformed when answers is not an object', () => {
    try {
      parseChargenPack(pack({ answers: 'string' }));
    } catch (e) {
      expect((e as ChargenPackError).code).toBe('malformed');
    }
    try {
      parseChargenPack(pack({ answers: [] }));
    } catch (e) {
      expect((e as ChargenPackError).code).toBe('malformed');
    }
  });

  it('throws malformed on answer-value not a string', () => {
    try {
      parseChargenPack(pack({ answers: { q1: 42 } }));
    } catch (e) {
      expect((e as ChargenPackError).code).toBe('malformed');
    }
  });

  it('caps answer count (DoS guard)', () => {
    const huge: Record<string, string> = {};
    for (let i = 0; i < 100; i++) huge[`q${i}`] = 'a';
    try {
      parseChargenPack(pack({ answers: huge }));
    } catch (e) {
      expect((e as ChargenPackError).code).toBe('malformed');
    }
  });

  it('caps answer value length (DoS guard)', () => {
    const longValue = 'x'.repeat(10000);
    try {
      parseChargenPack(pack({ answers: { q1: longValue } }));
    } catch (e) {
      expect((e as ChargenPackError).code).toBe('malformed');
    }
  });
});

describe('suggestedPackFilename', () => {
  it('includes slug + slot + date', () => {
    const doc = packChargen({
      campaignFingerprint: 'fp',
      slot: 3,
      chosenPath: 'qa',
      answers: {},
      nowMs: Date.UTC(2026, 4, 22) // May 22 2026
    });
    expect(suggestedPackFilename(doc, 'gutschke/underleaf')).toBe(
      'quire-pc-gutschke-underleaf-slot3-2026-05-22.json'
    );
  });

  it('sanitizes slashes and special chars from the slug', () => {
    const doc = packChargen({
      campaignFingerprint: 'fp',
      slot: 1,
      chosenPath: '',
      answers: {},
      nowMs: Date.UTC(2026, 0, 1)
    });
    const out = suggestedPackFilename(doc, 'g/u@main!evil&../');
    expect(out).not.toContain('/');
    expect(out).not.toContain('@');
    expect(out).not.toContain('..');
    expect(out).toContain('slot1');
    expect(out).toContain('2026-01-01');
  });

  it('falls back to "campaign" when slug is undefined', () => {
    const doc = packChargen({
      campaignFingerprint: 'fp',
      slot: 1,
      chosenPath: '',
      answers: {},
      nowMs: 0
    });
    expect(suggestedPackFilename(doc)).toContain('campaign');
  });
});

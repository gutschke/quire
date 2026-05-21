import { describe, it, expect } from 'vitest';
import {
  applyCharacterEdits,
  HARM_MAX,
  STRESS_MAX,
  STAT_MIN,
  STAT_MAX
} from './character-edits';
import type { CharacterRecord } from './character-loader';

function base(): CharacterRecord {
  return {
    $schemaVersion: '0.1.0',
    name: 'Test PC',
    stats: { str: 0, dex: 1, con: 0, int: 2, wis: 1, cha: -1 },
    harm: 0,
    stress: 0
  };
}

describe('applyCharacterEdits', () => {
  it('returns the original record when no edits', () => {
    const r = base();
    expect(applyCharacterEdits(r, undefined)).toBe(r);
    expect(applyCharacterEdits(r, {})).toBe(r);
  });

  it('overrides a single stat', () => {
    const r = applyCharacterEdits(base(), { 'stats.str': 2 });
    expect(r.stats?.str).toBe(2);
    expect(r.stats?.dex).toBe(1);
  });

  it('overrides multiple stats and top-level fields', () => {
    const r = applyCharacterEdits(base(), {
      'stats.str': 3,
      'stats.cha': 0,
      harm: 2,
      stress: 1
    });
    expect(r.stats?.str).toBe(3);
    expect(r.stats?.cha).toBe(0);
    expect(r.harm).toBe(2);
    expect(r.stress).toBe(1);
  });

  it('clamps stats to [STAT_MIN, STAT_MAX]', () => {
    const high = applyCharacterEdits(base(), { 'stats.str': 99 });
    expect(high.stats?.str).toBe(STAT_MAX);
    const low = applyCharacterEdits(base(), { 'stats.dex': -99 });
    expect(low.stats?.dex).toBe(STAT_MIN);
  });

  it('clamps harm to [0, HARM_MAX]', () => {
    const over = applyCharacterEdits(base(), { harm: 99 });
    expect(over.harm).toBe(HARM_MAX);
    const under = applyCharacterEdits(base(), { harm: -5 });
    expect(under.harm).toBe(0);
  });

  it('clamps stress to [0, STRESS_MAX]', () => {
    const over = applyCharacterEdits(base(), { stress: 99 });
    expect(over.stress).toBe(STRESS_MAX);
  });

  it('ignores unknown keys', () => {
    const r = applyCharacterEdits(base(), {
      hax: 'oops',
      'stats.bogus': 9,
      backstory: 'not editable here'
    });
    expect(r.stats?.str).toBe(0);
    expect(r.backstory).toBe(base().backstory);
  });

  it('ignores wrong-type values', () => {
    const r = applyCharacterEdits(base(), {
      'stats.str': 'two',
      harm: 'a lot',
      stress: NaN,
      con: Infinity
    });
    expect(r.stats?.str).toBe(0);
    expect(r.harm).toBe(0);
    expect(r.stress).toBe(0);
  });

  it('does not mutate the input record', () => {
    const r = base();
    const before = JSON.stringify(r);
    applyCharacterEdits(r, { 'stats.str': 3, harm: 2 });
    expect(JSON.stringify(r)).toBe(before);
  });

  it('rounds fractional stat input', () => {
    const r = applyCharacterEdits(base(), { 'stats.wis': 1.4 });
    expect(r.stats?.wis).toBe(1);
  });

  it('ignores null value (treats as wrong type, preserves base)', () => {
    // Regression pin: null is a JSON-legal value a hostile peer could
    // send.  Today it's ignored (preserves base) — this test catches
    // a future change that decides to treat null as "reset".
    const r = applyCharacterEdits(base(), {
      'stats.str': null as unknown as number,
      harm: null as unknown as number
    });
    expect(r.stats?.str).toBe(0);
    expect(r.harm).toBe(0);
  });

  it('ignores object value silently', () => {
    const r = applyCharacterEdits(base(), {
      'stats.str': { malicious: true } as unknown as number
    });
    expect(r.stats?.str).toBe(0);
  });
});

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

  // OP-044 (2026-05-30 run #12): advancements + marks were
  // floor-only before; clamp to their rules-grounded ceilings.
  it('OP-044: clamps advancements to [0, ADVANCEMENT_CAP] (rules.md:166)', () => {
    const over = applyCharacterEdits(base(), { advancements: 99 });
    expect(over.advancements).toBe(8);
    const neg = applyCharacterEdits(base(), { advancements: -5 });
    expect(neg.advancements).toBe(0);
    const at = applyCharacterEdits(base(), { advancements: 8 });
    expect(at.advancements).toBe(8);
  });

  it('OP-044: clamps marks to [0, 5] (rules.md:157)', () => {
    const over = applyCharacterEdits(base(), { marks: 99 });
    expect(over.marks).toBe(5);
    const neg = applyCharacterEdits(base(), { marks: -5 });
    expect(neg.marks).toBe(0);
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

// =====================================================================
// Phase B P1c (2026-05-23): per-field validation for the new fields
// (knowsTheyCanCast, magicPhase, moneyBand, tax.*, threadDebt.*,
// alignmentDrift.*, markBullets.*).
// =====================================================================

describe('Phase B P1c — knowsTheyCanCast / magicPhase / moneyBand', () => {
  it('writes knowsTheyCanCast when value is boolean', () => {
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei' },
      { knowsTheyCanCast: true }
    );
    expect(r.knowsTheyCanCast).toBe(true);
  });

  it('ignores knowsTheyCanCast when value is non-boolean', () => {
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei', knowsTheyCanCast: false },
      { knowsTheyCanCast: 'yes' as unknown as boolean }
    );
    expect(r.knowsTheyCanCast).toBe(false);
  });

  it('writes magicPhase only for valid enum values', () => {
    const valid = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei' },
      { magicPhase: 'realization' }
    );
    expect(valid.magicPhase).toBe('realization');
    const invalid = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei', magicPhase: 'accidental' },
      { magicPhase: 'made-up-phase' }
    );
    expect(invalid.magicPhase).toBe('accidental');
  });

  it('writes moneyBand only for valid enum values', () => {
    const valid = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei' },
      { moneyBand: 'comfortable' }
    );
    expect(valid.moneyBand).toBe('comfortable');
    const invalid = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei', moneyBand: 'tight' },
      { moneyBand: '$$$' }
    );
    expect(invalid.moneyBand).toBe('tight');
  });
});

describe('Phase B P1c — tax.* sub-fields', () => {
  it('writes tax.active as boolean', () => {
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei' },
      { 'tax.active': true }
    );
    expect(r.tax?.active).toBe(true);
  });

  it('writes tax.sessionsRemaining as a clamped non-negative integer', () => {
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei', tax: { active: true } },
      { 'tax.sessionsRemaining': 2.7 }
    );
    expect(r.tax?.sessionsRemaining).toBe(2);
    const neg = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei', tax: { active: true } },
      { 'tax.sessionsRemaining': -5 }
    );
    expect(neg.tax?.sessionsRemaining).toBe(0);
  });

  it('writes tax.releaseMoment as bounded string', () => {
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei', tax: { active: false } },
      { 'tax.releaseMoment': 'released at the bay' }
    );
    expect(r.tax?.releaseMoment).toBe('released at the bay');
  });

  it('drops tax.releaseMoment when it exceeds the bound', () => {
    const longStr = 'x'.repeat(500);
    const r = applyCharacterEdits(
      {
        $schemaVersion: '0.1.0',
        name: 'Mei',
        tax: { active: false, releaseMoment: 'old' }
      },
      { 'tax.releaseMoment': longStr }
    );
    expect(r.tax?.releaseMoment).toBe('old');
  });

  it('preserves existing tax fields when writing one sub-key', () => {
    const r = applyCharacterEdits(
      {
        $schemaVersion: '0.1.0',
        name: 'Mei',
        tax: { active: true, sessionsRemaining: 3 }
      },
      { 'tax.active': false }
    );
    expect(r.tax?.active).toBe(false);
    expect(r.tax?.sessionsRemaining).toBe(3);
  });
});

describe('Phase B P1c — threadDebt.* sub-fields', () => {
  it('writes threadDebt.rung only for valid rung enum', () => {
    const valid = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei' },
      { 'threadDebt.rung': 'watched' }
    );
    expect(valid.threadDebt?.rung).toBe('watched');
    const invalid = applyCharacterEdits(
      {
        $schemaVersion: '0.1.0',
        name: 'Mei',
        threadDebt: { rung: 'quiet' }
      },
      { 'threadDebt.rung': 'invented-rung' }
    );
    expect(invalid.threadDebt?.rung).toBe('quiet');
  });

  it('writes threadDebt.spamCount as a non-negative integer', () => {
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei' },
      { 'threadDebt.spamCount': 4 }
    );
    expect(r.threadDebt?.spamCount).toBe(4);
  });
});

describe('Phase B P1c — alignmentDrift.* sub-fields', () => {
  it('clamps alignmentDrift.marks to [0, 5]', () => {
    const high = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei' },
      { 'alignmentDrift.marks': 99 }
    );
    expect(high.alignmentDrift?.marks).toBe(5);
    const neg = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei' },
      { 'alignmentDrift.marks': -3 }
    );
    expect(neg.alignmentDrift?.marks).toBe(0);
  });

  it('writes alignmentDrift.lastUpdated as a non-negative integer epoch', () => {
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei' },
      { 'alignmentDrift.lastUpdated': 1700000000000 }
    );
    expect(r.alignmentDrift?.lastUpdated).toBe(1700000000000);
  });
});

describe('Phase B P1c — markBullets.* sub-fields', () => {
  it('writes each of the 5 mark bullets as a boolean', () => {
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei' },
      {
        'markBullets.hardMoment': true,
        'markBullets.learned': false,
        'markBullets.risk': true,
        'markBullets.against': false,
        'markBullets.complication': true
      }
    );
    expect(r.markBullets?.hardMoment).toBe(true);
    expect(r.markBullets?.learned).toBe(false);
    expect(r.markBullets?.risk).toBe(true);
    expect(r.markBullets?.against).toBe(false);
    expect(r.markBullets?.complication).toBe(true);
  });

  it('ignores markBullets sub-keys outside the 5-bullet set', () => {
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei' },
      {
        'markBullets.hardMoment': true,
        'markBullets.invented': true
      }
    );
    expect(r.markBullets?.hardMoment).toBe(true);
    expect(
      (r.markBullets as Record<string, unknown>)?.invented
    ).toBeUndefined();
  });
});

describe('Phase B P1c — input record is not mutated', () => {
  it('preserves the source record when writing to new fields', () => {
    const src = {
      $schemaVersion: '0.1.0',
      name: 'Mei',
      tax: { active: true, sessionsRemaining: 3 }
    } as const;
    const before = JSON.stringify(src);
    applyCharacterEdits(src, {
      'tax.active': false,
      'tax.sessionsRemaining': 0
    });
    // Source unchanged.
    expect(JSON.stringify(src)).toBe(before);
  });
});

describe('Phase B P1c+ regression-guard — no spurious undefined keys (2026-05-23)', () => {
  // Live-reported against build 75792d5: the output of
  // applyCharacterEdits started carrying `tax: undefined`,
  // `threadDebt: undefined`, `alignmentDrift: undefined`,
  // `markBullets: undefined` as KEYS on every effective record,
  // even when the source had none of them.  Caused a render
  // regression in the deployed cockpit when the user loaded a
  // packed character.  These tests pin the fix.

  function srcNoNewFields() {
    return {
      $schemaVersion: '0.1.0',
      name: 'Mei',
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 }
    } as const;
  }

  it('does NOT add `tax` key when source has no tax and edits do not touch tax', () => {
    const out = applyCharacterEdits(srcNoNewFields(), { harm: 1 });
    expect('tax' in out).toBe(false);
  });

  it('does NOT add `threadDebt` key when source has none and edits do not touch it', () => {
    const out = applyCharacterEdits(srcNoNewFields(), { harm: 1 });
    expect('threadDebt' in out).toBe(false);
  });

  it('does NOT add `alignmentDrift` key when source has none and edits do not touch it', () => {
    const out = applyCharacterEdits(srcNoNewFields(), { harm: 1 });
    expect('alignmentDrift' in out).toBe(false);
  });

  it('does NOT add `markBullets` key when source has none and edits do not touch it', () => {
    const out = applyCharacterEdits(srcNoNewFields(), { harm: 1 });
    expect('markBullets' in out).toBe(false);
  });

  it('adds `tax` key (lazily) only when a tax.* edit actually applies a value', () => {
    const out = applyCharacterEdits(srcNoNewFields(), {
      'tax.active': true
    });
    expect('tax' in out).toBe(true);
    expect(out.tax?.active).toBe(true);
  });

  it('does NOT add `tax` key when a tax.* edit value is invalid (drop-on-bad-input)', () => {
    const out = applyCharacterEdits(srcNoNewFields(), {
      'tax.active': 'yes' as unknown as boolean
    });
    expect('tax' in out).toBe(false);
  });

  it('lazy-clone preserves existing source object when edit writes a different sub-field', () => {
    const src = {
      $schemaVersion: '0.1.0',
      name: 'Mei',
      tax: { active: true, sessionsRemaining: 2 }
    } as const;
    const out = applyCharacterEdits(src, {
      'tax.sessionsRemaining': 1
    });
    expect(out.tax?.active).toBe(true); // preserved
    expect(out.tax?.sessionsRemaining).toBe(1); // updated
  });
});

// =====================================================================
// Task #295 (2026-05-25): dmNotes — DM-private soft-notes field.
// Coordinator-only at the surface; engine accepts any peer's pc-edit
// but the viewer-scope projection in core/state.ts wipes the overlay
// from player-bound state.  Tests here pin the per-field validation
// (string only, ≤ DM_NOTES_MAX chars, empty-string clears).
// =====================================================================

describe('Task #295 — dmNotes', () => {
  it('writes dmNotes when value is a string', () => {
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei' },
      { dmNotes: 'remember: deflect the premonition question' }
    );
    expect(r.dmNotes).toBe('remember: deflect the premonition question');
  });

  it('accepts an empty string (clears the notes)', () => {
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei', dmNotes: 'old note' },
      { dmNotes: '' }
    );
    expect(r.dmNotes).toBe('');
  });

  it('rejects non-string values silently', () => {
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei', dmNotes: 'keep me' },
      {
        dmNotes: 42 as unknown as string
      }
    );
    expect(r.dmNotes).toBe('keep me');
  });

  it('rejects oversized strings silently (preserves base)', () => {
    const oversized = 'x'.repeat(2001);
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei', dmNotes: 'small' },
      { dmNotes: oversized }
    );
    expect(r.dmNotes).toBe('small');
  });

  it('accepts strings at the boundary (length = DM_NOTES_MAX)', () => {
    const exact = 'x'.repeat(2000);
    const r = applyCharacterEdits(
      { $schemaVersion: '0.1.0', name: 'Mei' },
      { dmNotes: exact }
    );
    expect(r.dmNotes).toBe(exact);
  });
});

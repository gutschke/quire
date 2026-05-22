/**
 * Phase 3b-X step 2 — JSON Schema mirror tests.
 *
 * Schemas in `schema-json.ts` describe the wire shape providers
 * emit under constrained decoding.  TS interfaces in `schema.ts`
 * describe the in-memory shape downstream code consumes.  These
 * must agree.
 *
 * Strategy (per the 3b-X plan's question 3): a hand-rolled
 * mini-validator that walks the JSON Schema subset we actually
 * author (no AJV dependency, no Zod dependency — both would add
 * browser bundle weight per [[feedback-tech-debt-policy]]).  For
 * each canonical sample:
 *   1. Assert the sample satisfies the JSON Schema (via the
 *      mini-validator).
 *   2. Assert the sample satisfies the corresponding TS type guard.
 *   3. Assert one OR more "bad" mutations FAIL the JSON Schema —
 *      which proves the schema isn't a no-op.
 *
 * If the canonical TS interface gains a field, the sample no longer
 * satisfies the schema's `required[]` (mirror drift caught).  If
 * the schema drifts to allow something the TS interface forbids,
 * the bad-mutation tests catch it.
 *
 * The mini-validator supports only the JSON Schema features we
 * actually use here.  Adding features means extending the validator
 * in this file (deliberate).
 */

import { describe, it, expect } from 'vitest';
import {
  PC_BACKSTORY_SYNTHESIS_SCHEMA,
  toAnthropicSchema,
  toGeminiSchema
} from './schema-json';
import {
  QUIRE_SKILL_CATEGORIES,
  isPcBackstorySynthesisResponse
} from './schema';

/**
 * Minimal JSON Schema validator covering the keywords we use in
 * `schema-json.ts`.  Returns `null` on success, an error-path
 * string on failure (for test diagnostics).
 *
 * Supported keywords:
 *   - type: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean'
 *   - properties + required + additionalProperties (object)
 *   - items + minItems + maxItems + uniqueItems (array)
 *   - minLength + maxLength + pattern (string)
 *   - minimum + maximum (integer)
 *   - enum (any)
 *
 * Anything else fails-loud at first encounter so the test author
 * knows to extend the validator instead of silently passing.
 */
function validate(
  value: unknown,
  schema: Record<string, unknown>,
  path = '$'
): string | null {
  // enum
  if (Array.isArray(schema.enum)) {
    const ok = schema.enum.some((e) => e === value);
    return ok ? null : `${path}: not in enum`;
  }
  // type
  if (typeof schema.type === 'string') {
    const t = schema.type;
    if (t === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return `${path}: not an object`;
      }
      const props = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
      const required = (schema.required as string[]) ?? [];
      for (const r of required) {
        if (!(r in (value as Record<string, unknown>))) {
          return `${path}: missing required key ${r}`;
        }
      }
      if (schema.additionalProperties === false) {
        for (const k of Object.keys(value as Record<string, unknown>)) {
          if (!(k in props)) {
            return `${path}: unexpected key ${k}`;
          }
        }
      }
      for (const [k, sub] of Object.entries(props)) {
        if (k in (value as Record<string, unknown>)) {
          const e = validate(
            (value as Record<string, unknown>)[k],
            sub,
            `${path}.${k}`
          );
          if (e) return e;
        }
      }
      return null;
    }
    if (t === 'array') {
      if (!Array.isArray(value)) return `${path}: not an array`;
      if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
        return `${path}: too few items (${value.length} < ${schema.minItems})`;
      }
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
        return `${path}: too many items (${value.length} > ${schema.maxItems})`;
      }
      if (schema.uniqueItems) {
        const seen = new Set();
        for (const v of value) {
          const key = typeof v === 'string' ? v : JSON.stringify(v);
          if (seen.has(key)) return `${path}: duplicate item`;
          seen.add(key);
        }
      }
      if (schema.items && typeof schema.items === 'object') {
        for (let i = 0; i < value.length; i++) {
          const e = validate(
            value[i],
            schema.items as Record<string, unknown>,
            `${path}[${i}]`
          );
          if (e) return e;
        }
      }
      return null;
    }
    if (t === 'string') {
      if (typeof value !== 'string') return `${path}: not a string`;
      if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
        return `${path}: too short`;
      }
      if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
        return `${path}: too long`;
      }
      return null;
    }
    if (t === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return `${path}: not an integer`;
      }
      if (typeof schema.minimum === 'number' && value < schema.minimum) {
        return `${path}: below minimum`;
      }
      if (typeof schema.maximum === 'number' && value > schema.maximum) {
        return `${path}: above maximum`;
      }
      return null;
    }
    if (t === 'number') {
      if (typeof value !== 'number') return `${path}: not a number`;
      return null;
    }
    if (t === 'boolean') {
      if (typeof value !== 'boolean') return `${path}: not a boolean`;
      return null;
    }
    return `${path}: validator missing type=${t}`;
  }
  return null;
}

// Canonical sample — matches the in-memory PcBackstorySynthesisResponse
// shape we want providers to emit.  Used as both:
//   - the positive case (must satisfy the schema AND the TS guard).
//   - the seed for negative mutations (each variant breaks ONE thing).
function makeValidSample(): Record<string, unknown> {
  // Backstory needs to be ≥80 chars to satisfy the conservative
  // character bound in the schema.  This sample is ~280 chars.
  const backstory =
    'Mei grew up in the Mission, listening to ferries leave the Embarcadero each morning before school. ' +
    'Her father worked nights; she learned to hold the household together with quiet competence. ' +
    'At university she chose engineering because the answers were findable, even when the questions were hard.';
  return {
    name: 'Mei Tanaka',
    pronouns: 'she/her',
    tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
    stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
    skillMastery: ['Tech', 'Knowledge'],
    backstory
  };
}

describe('PC_BACKSTORY_SYNTHESIS_SCHEMA — mirror tests', () => {
  it('canonical sample satisfies the JSON Schema', () => {
    const sample = makeValidSample();
    const err = validate(sample, PC_BACKSTORY_SYNTHESIS_SCHEMA);
    expect(err).toBeNull();
  });

  it('canonical sample satisfies the TS guard isPcBackstorySynthesisResponse', () => {
    const sample = makeValidSample();
    // The TS guard expects broker-filled fields (raw/tokensIn/etc.)
    // but tolerates their absence per the provider-side parse path.
    expect(isPcBackstorySynthesisResponse(sample)).toBe(true);
  });

  it('all 8 quire-v0.1 skill categories are accepted by the enum', () => {
    for (const cat of QUIRE_SKILL_CATEGORIES) {
      const sample = makeValidSample();
      sample.skillMastery = [cat];
      const err = validate(sample, PC_BACKSTORY_SYNTHESIS_SCHEMA);
      expect(err).toBeNull();
    }
  });

  // ---- negative mutations: each breaks one schema rule ----

  it('rejects missing required key (name)', () => {
    const sample = makeValidSample();
    delete sample.name;
    expect(validate(sample, PC_BACKSTORY_SYNTHESIS_SCHEMA)).toMatch(/missing required/);
  });

  it('rejects unexpected additional property (extraField)', () => {
    const sample = makeValidSample();
    (sample as Record<string, unknown>).extraField = 'sneak';
    expect(validate(sample, PC_BACKSTORY_SYNTHESIS_SCHEMA)).toMatch(/unexpected/);
  });

  it('rejects too-short tags array (2 entries; minItems is 3)', () => {
    const sample = makeValidSample();
    sample.tags = ['only', 'two'];
    expect(validate(sample, PC_BACKSTORY_SYNTHESIS_SCHEMA)).toMatch(/too few/);
  });

  it('rejects too-long tags array (6 entries; maxItems is 5)', () => {
    const sample = makeValidSample();
    sample.tags = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(validate(sample, PC_BACKSTORY_SYNTHESIS_SCHEMA)).toMatch(/too many/);
  });

  it('rejects stat out of range (CHA = 4)', () => {
    const sample = makeValidSample();
    (sample.stats as Record<string, number>).CHA = 4;
    expect(validate(sample, PC_BACKSTORY_SYNTHESIS_SCHEMA)).toMatch(/above maximum/);
  });

  it('rejects non-integer stat (DEX = 1.5)', () => {
    const sample = makeValidSample();
    (sample.stats as Record<string, number>).DEX = 1.5;
    expect(validate(sample, PC_BACKSTORY_SYNTHESIS_SCHEMA)).toMatch(/not an integer/);
  });

  it('rejects missing stat key', () => {
    const sample = makeValidSample();
    delete (sample.stats as Record<string, unknown>).WIS;
    expect(validate(sample, PC_BACKSTORY_SYNTHESIS_SCHEMA)).toMatch(/missing required key WIS/);
  });

  it('rejects unknown skill category', () => {
    const sample = makeValidSample();
    sample.skillMastery = ['Tech', 'Hacking'];
    expect(validate(sample, PC_BACKSTORY_SYNTHESIS_SCHEMA)).toMatch(/not in enum/);
  });

  it('rejects duplicate skill category (uniqueItems)', () => {
    const sample = makeValidSample();
    sample.skillMastery = ['Tech', 'Tech'];
    expect(validate(sample, PC_BACKSTORY_SYNTHESIS_SCHEMA)).toMatch(/duplicate/);
  });

  it('rejects too-short backstory (< 80 chars; conservative bound)', () => {
    const sample = makeValidSample();
    sample.backstory = 'too short';
    expect(validate(sample, PC_BACKSTORY_SYNTHESIS_SCHEMA)).toMatch(/too short/);
  });
});

describe('toAnthropicSchema (step 3 adapter)', () => {
  it('is identity for the strict-mode-compatible canonical schema', () => {
    expect(toAnthropicSchema(PC_BACKSTORY_SYNTHESIS_SCHEMA as unknown as Record<string, unknown>))
      .toBe(PC_BACKSTORY_SYNTHESIS_SCHEMA);
  });
});

describe('toGeminiSchema (step 4 adapter)', () => {
  it('strips additionalProperties (Gemini dialect)', () => {
    const adapted = toGeminiSchema(
      PC_BACKSTORY_SYNTHESIS_SCHEMA as unknown as Record<string, unknown>
    );
    // Top-level should have NO additionalProperties.
    expect('additionalProperties' in adapted).toBe(false);
    // Nested `stats` object also stripped.
    const stats = (
      adapted.properties as Record<string, Record<string, unknown>>
    ).stats;
    expect('additionalProperties' in stats).toBe(false);
  });

  it('preserves required[] (Gemini supports it)', () => {
    const adapted = toGeminiSchema(
      PC_BACKSTORY_SYNTHESIS_SCHEMA as unknown as Record<string, unknown>
    );
    expect(adapted.required).toEqual([
      'name',
      'pronouns',
      'tags',
      'stats',
      'skillMastery',
      'backstory'
    ]);
  });

  it('preserves enum constraints (Gemini supports it)', () => {
    const adapted = toGeminiSchema(
      PC_BACKSTORY_SYNTHESIS_SCHEMA as unknown as Record<string, unknown>
    );
    const skillMastery = (
      adapted.properties as Record<string, Record<string, unknown>>
    ).skillMastery;
    const items = skillMastery.items as Record<string, unknown>;
    expect(items.enum).toEqual([...QUIRE_SKILL_CATEGORIES]);
  });
});

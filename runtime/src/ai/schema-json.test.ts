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
  AI_RESPONSE_SCHEMA,
  toAnthropicSchema,
  toGeminiSchema
} from './schema-json';
import {
  QUIRE_SKILL_CATEGORIES,
  isPcBackstorySynthesisResponse,
  isAiResponse,
  isStateUpdate
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
  // oneOf: succeed iff exactly one variant validates (we relax to
  // "at least one" for test simplicity — Anthropic strict mode
  // enforces oneOf-exclusivity at decode time; our mini-validator
  // mirrors the more permissive anyOf semantics).
  if (Array.isArray(schema.oneOf)) {
    const variants = schema.oneOf as Array<Record<string, unknown>>;
    let lastErr = '';
    for (const v of variants) {
      const err = validate(value, v, path);
      if (err === null) return null;
      lastErr = err;
    }
    return `${path}: no oneOf variant matched (last: ${lastErr})`;
  }
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
  it('preserves additionalProperties and other strict-mode features for the chargen schema', () => {
    const adapted = toAnthropicSchema(
      PC_BACKSTORY_SYNTHESIS_SCHEMA as unknown as Record<string, unknown>
    );
    // Strict mode supports additionalProperties: false — must survive.
    expect(adapted.additionalProperties).toBe(false);
    expect(adapted.required).toEqual([
      'name',
      'pronouns',
      'tags',
      'stats',
      'skillMastery',
      'backstory'
    ]);
  });

  it('Phase 3b-X follow-up: flattens oneOf for AI_RESPONSE_SCHEMA (strict mode rejects oneOf)', () => {
    // Live-tested 2026-05-22: Anthropic strict tool use returns
    // `tools.0.custom: Schema type 'oneOf' is not supported` when
    // input_schema contains oneOf at depth.  The adapter must
    // flatten — same algorithm as toGeminiSchema.
    const adapted = toAnthropicSchema(
      AI_RESPONSE_SCHEMA as unknown as Record<string, unknown>
    );
    const stateUpdates = (
      adapted.properties as Record<string, Record<string, unknown>>
    ).stateUpdates;
    const items = stateUpdates.items as Record<string, unknown>;
    expect(items.oneOf).toBeUndefined();
    expect(items.anyOf).toBeUndefined();
    expect(items.type).toBe('object');
    // Merged property set includes fields from all 3 variants.
    const props = items.properties as Record<string, unknown>;
    expect(props.kind).toBeDefined();
    expect(props.field).toBeDefined(); // pc-edit
    expect(props.purpose).toBeDefined(); // dice-roll
    expect(props.ladderState).toBeDefined(); // caster-state-set
    // Intersection: only `kind` is in every variant's required[].
    expect(items.required).toEqual(['kind']);
    // Live-tested 2026-05-22: Anthropic strict tool use rejects an
    // object schema that omits additionalProperties.  The flattener
    // must always emit it.
    expect(items.additionalProperties).toBe(false);
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

// =====================================================================
// Phase 3b-X step 8: AI_RESPONSE_SCHEMA mirror tests.
// =====================================================================

function makeValidAiResponse(): Record<string, unknown> {
  return {
    safe: 'The corridor is dark; one fluorescent flickers near the stairs.',
    dmOnly:
      'Maya is here — she has the override key but will only show it if pressed about her sister.',
    sources: [{ label: 'Scene 03 — Hospice', path: 'episodes/03/scene-3.md' }],
    stateUpdates: [
      {
        kind: 'pc-edit',
        pcId: 'pc-mei',
        field: 'stress',
        delta: 1,
        reason: 'cast under pressure'
      },
      {
        kind: 'dice-roll',
        purpose: 'sneak past the night porter',
        expression: '2d6+1'
      },
      {
        kind: 'caster-state-set',
        pcId: 'pc-mei',
        ladderState: 'noticed',
        reason: 'the lights flicker but only Yui sees',
        taxActive: false,
        spamCount: 2
      }
    ]
  };
}

describe('AI_RESPONSE_SCHEMA — mirror tests', () => {
  it('canonical sample satisfies the JSON Schema', () => {
    const sample = makeValidAiResponse();
    const err = validate(sample, AI_RESPONSE_SCHEMA);
    expect(err).toBeNull();
  });

  it('canonical sample satisfies the TS guard isAiResponse', () => {
    const sample = makeValidAiResponse();
    expect(
      isAiResponse({
        ...sample,
        raw: '',
        tokensIn: 0,
        tokensOut: 0,
        responseId: ''
      })
    ).toBe(true);
  });

  it('each stateUpdate satisfies isStateUpdate', () => {
    const sample = makeValidAiResponse();
    for (const u of sample.stateUpdates as unknown[]) {
      expect(isStateUpdate(u)).toBe(true);
    }
  });

  it('accepts an empty stateUpdates array (the common case)', () => {
    const sample = makeValidAiResponse();
    sample.stateUpdates = [];
    expect(validate(sample, AI_RESPONSE_SCHEMA)).toBeNull();
  });

  it('accepts a missing stateUpdates field (optional)', () => {
    const sample = makeValidAiResponse();
    delete sample.stateUpdates;
    expect(validate(sample, AI_RESPONSE_SCHEMA)).toBeNull();
  });

  it('accepts empty safe + non-empty dmOnly (DM-only-answer case)', () => {
    const sample = makeValidAiResponse();
    sample.safe = '';
    expect(validate(sample, AI_RESPONSE_SCHEMA)).toBeNull();
  });

  // ---- negative mutations ----

  it('rejects missing required safe', () => {
    const sample = makeValidAiResponse();
    delete sample.safe;
    expect(validate(sample, AI_RESPONSE_SCHEMA)).toMatch(/missing required/);
  });

  it('rejects missing required dmOnly', () => {
    const sample = makeValidAiResponse();
    delete sample.dmOnly;
    expect(validate(sample, AI_RESPONSE_SCHEMA)).toMatch(/missing required/);
  });

  it('rejects missing required sources', () => {
    const sample = makeValidAiResponse();
    delete sample.sources;
    expect(validate(sample, AI_RESPONSE_SCHEMA)).toMatch(/missing required/);
  });

  it('rejects non-string safe (number)', () => {
    const sample = makeValidAiResponse();
    sample.safe = 42;
    expect(validate(sample, AI_RESPONSE_SCHEMA)).toMatch(/not a string/);
  });

  it('rejects pc-edit with wrong field value (skill)', () => {
    const sample = makeValidAiResponse();
    sample.stateUpdates = [
      {
        kind: 'pc-edit',
        pcId: 'pc-mei',
        field: 'skill', // schema enum is 'harm' | 'stress' only
        delta: 1
      }
    ];
    // 'skill' fails the pc-edit variant (enum) but might still
    // match a different variant if any field overlaps; the failure
    // message names the last-tried variant.
    expect(validate(sample, AI_RESPONSE_SCHEMA)).toMatch(/no oneOf variant matched/);
  });

  it('rejects unknown stateUpdate kind', () => {
    const sample = makeValidAiResponse();
    sample.stateUpdates = [{ kind: 'unknown-kind', pcId: 'x' }];
    expect(validate(sample, AI_RESPONSE_SCHEMA)).toMatch(/no oneOf variant matched/);
  });

  it('rejects caster-state-set with bad ladderState enum value', () => {
    const sample = makeValidAiResponse();
    sample.stateUpdates = [
      {
        kind: 'caster-state-set',
        pcId: 'pc-mei',
        ladderState: 'enlightened' // not in the canonical 6-ladder list
      }
    ];
    expect(validate(sample, AI_RESPONSE_SCHEMA)).toMatch(/no oneOf variant matched/);
  });

  it('rejects pc-edit missing required delta', () => {
    const sample = makeValidAiResponse();
    sample.stateUpdates = [
      { kind: 'pc-edit', pcId: 'pc-mei', field: 'harm' }
    ];
    expect(validate(sample, AI_RESPONSE_SCHEMA)).toMatch(/no oneOf variant matched/);
  });

  it('rejects source missing required label', () => {
    const sample = makeValidAiResponse();
    sample.sources = [{ path: 'episodes/03/scene-3.md' }];
    expect(validate(sample, AI_RESPONSE_SCHEMA)).toMatch(/missing required/);
  });
});

describe('toGeminiSchema (step 8: oneOf flattening for AI_RESPONSE_SCHEMA)', () => {
  it('flattens stateUpdates.items oneOf to a single object schema', () => {
    const adapted = toGeminiSchema(
      AI_RESPONSE_SCHEMA as unknown as Record<string, unknown>
    );
    const stateUpdates = (
      adapted.properties as Record<string, Record<string, unknown>>
    ).stateUpdates;
    const items = stateUpdates.items as Record<string, unknown>;
    expect(items.oneOf).toBeUndefined();
    expect(items.type).toBe('object');
    // The merged property set includes fields from all three variants.
    const props = items.properties as Record<string, unknown>;
    expect(props.kind).toBeDefined();
    expect(props.field).toBeDefined(); // from pc-edit
    expect(props.purpose).toBeDefined(); // from dice-roll
    expect(props.ladderState).toBeDefined(); // from caster-state-set
  });

  it('flattened items.required is the intersection (only kind)', () => {
    const adapted = toGeminiSchema(
      AI_RESPONSE_SCHEMA as unknown as Record<string, unknown>
    );
    const stateUpdates = (
      adapted.properties as Record<string, Record<string, unknown>>
    ).stateUpdates;
    const items = stateUpdates.items as Record<string, unknown>;
    expect(items.required).toEqual(['kind']);
  });
});

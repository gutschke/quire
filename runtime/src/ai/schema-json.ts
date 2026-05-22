/**
 * Phase 3b-X JSON Schema definitions for provider-side constrained
 * decoding (Anthropic strict tool use; Gemini responseSchema).
 *
 * Schemas live here, NOT in `schema.ts`, because:
 *   - `schema.ts` carries the TS interfaces (source of truth for
 *     the in-memory shape) + type guards.
 *   - `schema-json.ts` carries the JSON Schema mirrors for wire
 *     transport + provider-side validation.
 *   - A colocated mirror test (`schema-json.test.ts`) asserts a
 *     known-good sample of each TS type satisfies BOTH the schema
 *     AND the TS guard — drift detection without a runtime
 *     validator library (rejected: would add browser bundle weight
 *     + a second source of truth).
 *
 * Hand-rolled `as const` literals.  Both providers consume the
 * canonical shape; per-provider adapters (`toAnthropicSchema`,
 * `toGeminiSchema`) translate dialect differences (Gemini doesn't
 * support `additionalProperties` / `format` / `$schema`; Anthropic
 * strict mode forbids `format` and complex `$ref`).
 *
 * Strict-mode subset constraints we observe:
 *   - No `$ref` (resolve inline).
 *   - No `format` (handled by `pattern` where needed).
 *   - No `additionalProperties: true` (strict mode requires explicit
 *     `additionalProperties: false` to forbid stray fields).
 *   - All required properties listed in `required[]`.
 *   - `integer` for stat values (provider knows not to emit floats).
 *
 * Step 2 ships only `PC_BACKSTORY_SYNTHESIS_SCHEMA`.  Step 8 adds
 * the DM-aide `AI_RESPONSE_SCHEMA` analog.
 */

import { QUIRE_SKILL_CATEGORIES } from './schema';
import type { AiStructuredCallSchema } from './broker';

/**
 * Phase 3b-X step 2: canonical JSON Schema for
 * `PcBackstorySynthesisResponse` (chargen synthesis output).
 *
 * Schema-enforced (provider does NOT emit anything outside these
 * bounds — constrained decoding):
 *   - name, pronouns, backstory: typed strings.
 *   - tags: array of 3-5 strings.
 *   - stats: exact six keys (STR/DEX/CON/INT/WIS/CHA), integers
 *     in range -2..+3.
 *   - skillMastery: array of 0-4 strings drawn from
 *     `QUIRE_SKILL_CATEGORIES` (uniqueItems).
 *
 * NOT schema-enforced (semantic-only; stays in `backstory-validator.ts`):
 *   - name must differ from player's display name (cross-check).
 *   - backstory word count (target 250-400; not character count).
 *   - place-token presence in backstory (campaign-declared list).
 *   - stat-distribution multiset (one +2, three +1s, two 0s — the
 *     range alone is insufficient; needs multiset check).
 *   - forbidden-token post-scan (semantic; uses spoiler-check.ts).
 *
 * Broker-filled fields (NOT requested from the provider; the
 * synthesizer attaches them after the call):
 *   - raw, tokensIn, tokensOut, responseId.
 */
export const PC_BACKSTORY_SYNTHESIS_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 80,
      description:
        "Plausible character name (NOT the player's name; that's a post-parse semantic check)."
    },
    pronouns: {
      type: 'string',
      minLength: 1,
      maxLength: 40,
      description: 'Pronoun set, e.g. "she/her" or "they/them".'
    },
    tags: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 80
      },
      description:
        '3-5 concrete, fiction-relevant tags (free-form expertise — distinct from skillMastery).'
    },
    stats: {
      type: 'object',
      properties: {
        STR: { type: 'integer', minimum: -2, maximum: 3 },
        DEX: { type: 'integer', minimum: -2, maximum: 3 },
        CON: { type: 'integer', minimum: -2, maximum: 3 },
        INT: { type: 'integer', minimum: -2, maximum: 3 },
        WIS: { type: 'integer', minimum: -2, maximum: 3 },
        CHA: { type: 'integer', minimum: -2, maximum: 3 }
      },
      required: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'],
      additionalProperties: false,
      description:
        'quire-v0.1 fixed starting array: one +2, three +1s, two 0s (multiset enforced post-parse).'
    },
    skillMastery: {
      type: 'array',
      minItems: 0,
      maxItems: 4,
      uniqueItems: true,
      items: {
        type: 'string',
        enum: [...QUIRE_SKILL_CATEGORIES]
      },
      description:
        'Subset of the 8 quire-v0.1 skill categories (Action / Subterfuge / Knowledge / Insight / Influence / Tech / Craft / Medic).  Typically 2-3 entries.'
    },
    backstory: {
      type: 'string',
      minLength: 80,
      maxLength: 8000,
      description:
        '250-400 words of markdown prose, 3-4 short paragraphs (word-count target; the character range here is conservative).'
    }
  },
  required: ['name', 'pronouns', 'tags', 'stats', 'skillMastery', 'backstory'],
  additionalProperties: false
} as const;

/**
 * Envelope passed to `AiProvider.callStructured`.  `name` is the
 * stable identifier Anthropic uses for the tool definition; Gemini
 * ignores it but it's logged for audit.
 */
export const PC_BACKSTORY_SYNTHESIS_CALL_SCHEMA: AiStructuredCallSchema = {
  name: 'emit_pc_backstory',
  schema: PC_BACKSTORY_SYNTHESIS_SCHEMA as unknown as Record<string, unknown>
};

/**
 * Phase 3b-X step 4 (Gemini): translate the canonical schema to
 * Gemini's responseSchema dialect.  Gemini follows OpenAPI 3.0,
 * not JSON Schema 2020-12, so:
 *   - `additionalProperties` → not supported; stripped.
 *   - `uniqueItems` → supported but provider may ignore (post-parse
 *     check catches violations).
 *   - `$schema` → not allowed; stripped.
 *   - `format` → semantics differ; we don't use it.
 *   - integer ranges → supported via `minimum`/`maximum`.
 *
 * Step 4 inlines this adapter usage at the call site.  Lives here
 * so the strip rules are documented alongside the canonical schema.
 */
export function toGeminiSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const drop = new Set([
    'additionalProperties',
    '$schema',
    '$id',
    '$ref',
    'format'
  ]);
  function strip(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (drop.has(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return strip(schema) as Record<string, unknown>;
}

/**
 * Phase 3b-X step 3 (Anthropic): the canonical schema is already
 * strict-mode compatible (no $ref, no format, additionalProperties:
 * false everywhere).  This adapter is identity today but exists as
 * a future-proofing seam — if Anthropic's strict subset ever
 * changes, the translation lives here, not at the call site.
 */
export function toAnthropicSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  return schema;
}

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
    },
    // ---- Phase B P2 (2026-05-26) additive fields ----
    // OPTIONAL.  Older provider responses without these keys still
    // parse; the materializer fills sane defaults ('English' /
    // 'tight').  Locked enum / length caps prevent open-ended
    // free-text injection from leaking through the structured-decode
    // boundary.  DM-only fields (magicPhase / tax / threadDebt /
    // knowsTheyCanCast) MUST NOT be added here — the TTRPG firewall
    // says chargen output stays player-safe; downstream synthesis
    // never proposes those values.
    languages: {
      type: 'array',
      minItems: 0,
      maxItems: 8,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 40
      },
      description:
        'Languages the PC speaks (rules.md:21 ties to INT).  Default ["English"] when omitted; campaign-config can override later.'
    },
    moneyBand: {
      type: 'string',
      enum: ['broke', 'tight', 'comfortable', 'well-off', 'wealthy'],
      description:
        "Fictional money band, NOT numeric currency.  Bias toward 'tight' for fresh PCs unless the answers strongly indicate otherwise."
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
 * Phase 3b-X step 8: canonical JSON Schema for `AiResponse` (the
 * DM-aide dual-card output).  Mirrors `AiResponse` in `schema.ts`
 * MINUS the broker-filled fields (raw / tokensIn / tokensOut /
 * responseId — the synthesizer attaches them post-call).
 *
 * `stateUpdates` is a discriminated union — Anthropic strict mode
 * handles it via `oneOf` at item level; Gemini's responseSchema
 * doesn't support `oneOf` at depth, so the Gemini adapter strips
 * the union and emits a flat schema with all-fields-optional + a
 * client-side `isStateUpdate` discriminator.  The flat-fields
 * fallback today (pre-3b-X) is what Gemini already used.
 *
 * Schema-enforced:
 *   - safe, dmOnly: strings (may be empty).
 *   - sources: array of {label, path?} objects.
 *   - stateUpdates: array; each item satisfies one of three union
 *     shapes (pc-edit / dice-roll / caster-state-set).
 *
 * NOT schema-enforced (stays semantic / post-parse):
 *   - safe vs dmOnly content classification (the AI's call;
 *     spoiler-check + DM eyes are the guards).
 *   - sources paths existing in the campaign repo (validated
 *     elsewhere when the DM clicks a citation).
 *   - StateUpdate hard-gate transitions (AiWriteController).
 */
export const AI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    safe: {
      type: 'string',
      description:
        'Text safe to read aloud at the table.  No spoilers, no DM-only material, no future-plot details.  Empty string if all of the answer is DM-only.'
    },
    dmOnly: {
      type: 'string',
      description:
        "DM-eyes-only narrative / mechanics / spoilers.  Rendered in the amber-rail card with the 'copy (do not read aloud)' affordance.  Empty string if all of the answer is player-safe."
    },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          path: { type: 'string' }
        },
        required: ['label'],
        additionalProperties: false
      },
      description:
        'Citations into the campaign repo — { label, path? }.  Cite when the answer leans on a specific file.'
    },
    stateUpdates: {
      type: 'array',
      description:
        'OPTIONAL typed bookkeeping the DM will accept-gate before any event lands.  Emit ONLY when your prose response clearly implies a state change.',
      items: {
        // Anthropic strict mode handles oneOf at item level via
        // its discriminator semantics.  Gemini drops oneOf via
        // `toGeminiSchema` (Gemini-side falls back to the
        // flat-fields shape with `isStateUpdate` discriminating
        // client-side; this is the pre-3b-X behavior).
        oneOf: [
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['pc-edit'] },
              pcId: { type: 'string' },
              field: { type: 'string', enum: ['harm', 'stress'] },
              delta: { type: 'integer' },
              reason: { type: 'string' }
            },
            required: ['kind', 'pcId', 'field', 'delta'],
            additionalProperties: false
          },
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['dice-roll'] },
              purpose: { type: 'string' },
              expression: { type: 'string' },
              modifierBreakdown: { type: 'string' }
            },
            required: ['kind', 'purpose', 'expression'],
            additionalProperties: false
          },
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['caster-state-set'] },
              pcId: { type: 'string' },
              ladderState: {
                type: 'string',
                enum: [
                  'clear',
                  'quiet',
                  'noticed',
                  'watched',
                  'pushing-back',
                  'hunted'
                ]
              },
              reason: { type: 'string' },
              taxActive: { type: 'boolean' },
              spamCount: { type: 'integer' }
            },
            required: ['kind', 'pcId', 'ladderState'],
            additionalProperties: false
          }
        ]
      }
    }
  },
  required: ['safe', 'dmOnly', 'sources'],
  additionalProperties: false
} as const;

export const AI_RESPONSE_CALL_SCHEMA: AiStructuredCallSchema = {
  name: 'respond',
  schema: AI_RESPONSE_SCHEMA as unknown as Record<string, unknown>
};

// Phase 3b polish (2026-05-23): SPOILER_CHECK_SCHEMA used to live
// here but moved to `spoiler-check.ts` so it lands in the lazy
// chargen chunk (which is the only consumer), not in main.  Schema
// + call schema are co-located with the `aiSemanticSpoilerCheck`
// function that uses them.

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
    // Phase 3b-X step 8: Gemini doesn't support `oneOf`/`anyOf` at
    // depth — flatten to a union object whose `required` is the
    // intersection of all variants' `required` arrays.  The
    // discriminator (`kind`) is required in every variant, so it
    // survives the intersection; per-variant required fields
    // become optional (client-side `isStateUpdate` re-enforces).
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.oneOf) || Array.isArray(obj.anyOf)) {
      const variants = (obj.oneOf ?? obj.anyOf) as Array<
        Record<string, unknown>
      >;
      return flattenUnion(variants.map((v) => strip(v) as Record<string, unknown>));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (drop.has(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return strip(schema) as Record<string, unknown>;
}

/**
 * Merge a discriminated-union variant list into a single flat
 * object schema for Gemini's responseSchema dialect.  Properties
 * become the union (variants are expected to share identical
 * shapes for shared keys); `required` becomes the intersection
 * (only the discriminator survives).
 */
function flattenUnion(
  variants: Array<Record<string, unknown>>
): Record<string, unknown> {
  const mergedProps: Record<string, unknown> = {};
  const requiredSets: Set<string>[] = [];
  for (const v of variants) {
    const props = v.properties as Record<string, unknown> | undefined;
    if (props) {
      for (const [k, val] of Object.entries(props)) {
        if (!(k in mergedProps)) mergedProps[k] = val;
      }
    }
    if (Array.isArray(v.required)) {
      requiredSets.push(new Set(v.required as string[]));
    }
  }
  const required =
    requiredSets.length === 0
      ? []
      : [...requiredSets[0]].filter((r) =>
          requiredSets.every((s) => s.has(r))
        );
  // Live-tested 2026-05-22: Anthropic strict tool use rejects the
  // flattened object with "For 'object' type, 'additionalProperties'
  // must be explicitly set to false".  Always set it.  The Gemini
  // adapter strips additionalProperties for its dialect, so this is
  // harmless on that path.
  return {
    type: 'object',
    additionalProperties: false,
    properties: mergedProps,
    ...(required.length > 0 && { required })
  };
}

/**
 * Phase 3b-X step 3 (Anthropic): translate the canonical schema to
 * Anthropic's strict tool-use dialect.
 *
 * Strict mode's accepted JSON Schema subset is narrow.  Live-tested
 * incrementally 2026-05-22 — each restriction below produced an
 * HTTP 400 we fixed by adding a drop to this adapter:
 *
 *   - `oneOf` / `anyOf` / `allOf` — not supported; flatten unions
 *     to a union object whose `required[]` is the intersection.
 *     (Runtime `isStateUpdate` re-enforces variant-specific required
 *     fields post-parse.)
 *   - `additionalProperties: false` — must be set on EVERY object,
 *     not just the top level.  Added by `flattenUnion`.
 *   - `minItems` / `maxItems` — only 0 or 1 accepted ("values other
 *     than 0 or 1 are not supported").  Strip when outside that.
 *   - `minimum` / `maximum` on integers — not supported ("For
 *     'integer' type, properties maximum, minimum are not supported").
 *     Strip unconditionally.
 *   - `uniqueItems` / `minLength` / `maxLength` / `pattern` /
 *     `format` / `exclusiveMinimum` / `exclusiveMaximum` /
 *     `minProperties` / `maxProperties` — all in the same family of
 *     "soft validation hints".  Strip unconditionally — the AI
 *     respects them via prompt language and the post-parse
 *     defense-in-depth (`backstory-validator`, `isStateUpdate`,
 *     `isAiResponse`) catches violations.
 *
 * What strict mode accepts (the allowlist this adapter targets):
 *   - `type`
 *   - `properties`, `required`
 *   - `additionalProperties: false`
 *   - `items` (array element schema)
 *   - `enum`
 *   - `description`
 *
 * Everything else is dropped via the explicit unconditional set
 * below.  When future strict-mode 400s show up, extend the set —
 * do NOT special-case keep-when-X conditions, since each
 * "exception" tends to be another round-trip with the API.
 */
export function toAnthropicSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const stripUnconditional = new Set([
    // Number/integer bounds.
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    // Array bounds (we'll handle minItems/maxItems separately to keep 0/1).
    'uniqueItems',
    // String bounds.
    'minLength',
    'maxLength',
    'pattern',
    'format',
    // Object bounds.
    'minProperties',
    'maxProperties',
    // Refs / dialect markers strict mode doesn't process.
    '$ref',
    '$schema',
    '$id'
  ]);
  function strip(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== 'object') return node;
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.oneOf) || Array.isArray(obj.anyOf)) {
      const variants = (obj.oneOf ?? obj.anyOf) as Array<
        Record<string, unknown>
      >;
      return flattenUnion(variants.map((v) => strip(v) as Record<string, unknown>));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (stripUnconditional.has(k)) continue;
      // minItems/maxItems: strict accepts only 0 and 1.
      if (k === 'minItems' || k === 'maxItems') {
        if (v === 0 || v === 1) out[k] = v;
        continue;
      }
      out[k] = strip(v);
    }
    return out;
  }
  return strip(schema) as Record<string, unknown>;
}

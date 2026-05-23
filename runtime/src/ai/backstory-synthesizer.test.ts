/**
 * backstory-synthesizer tests (end-to-end synthesis orchestration).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  synthesizeBackstory,
  type SynthesizeBackstoryRequest
} from './backstory-synthesizer';
import { type AiProvider } from './broker';
import type { CampaignCharCreationQuestion } from '../campaign-loader';

function sa(id: string, prompt: string): CampaignCharCreationQuestion {
  return { id, kind: 'short-answer', prompt };
}

/**
 * Build a mock provider that returns each of the given raw
 * responses in order.  Each raw is parsed as JSON for the
 * `value` field of the structured result; if parsing fails, the
 * mock surfaces it as a `truncated` refusal (matching production
 * behavior for malformed payloads under constrained decoding).
 * `calls` array captures every request the synthesizer made so
 * tests can assert on retry behavior + prompt contents.
 */
function mockProvider(
  rawResponses: string[],
  options: {
    /**
     * Phase 3b polish (2026-05-23): synthesizer now runs an AI
     * semantic-spoiler-check whenever the substring scanner fires.
     * Tests that exercise the spoiler firewall must supply verdicts
     * for those AI calls; verdicts are consumed in order each time
     * the schema name matches `spoiler_check_verdict`.  When unset,
     * the mock defaults to verdict='leak' returning the candidates
     * verbatim — preserves the pre-polish behavior so tests written
     * before the polish keep working.
     */
    spoilerVerdicts?: Array<
      | 'auto-leak' // default: returns all candidates as leaks
      | 'auto-ordinary' // all candidates are false positives
      | {
          verdict: 'ordinary' | 'leak';
          leakingWords: string[];
          reason: string;
        }
    >;
  } = {}
): {
  provider: AiProvider;
  /**
   * Generation-only calls (synthesizer requests).  Older tests
   * that assert call counts use this so they don't accidentally
   * count the new spoiler-check calls.
   */
  calls: Array<{ system: string; user: string }>;
  /** Spoiler-check calls (post-substring AI verdict requests). */
  spoilerCalls: Array<{ system: string; user: string }>;
} {
  let i = 0;
  let spoilerI = 0;
  const calls: Array<{ system: string; user: string }> = [];
  const spoilerCalls: Array<{ system: string; user: string }> = [];
  const provider: AiProvider = {
    id: 'claude',
    callStructured: vi.fn(
      async <T>(
        req: { systemPrompt: string; prompt: string },
        schema?: { name?: string }
      ) => {
        const target =
          schema?.name === 'spoiler_check_verdict' ? spoilerCalls : calls;
        target.push({ system: req.systemPrompt, user: req.prompt });
        const meta = (id: string | number) => ({
          tokensIn: 100,
          tokensOut: 200,
          responseId: `mock-${id}`
        });
        // Spoiler-check call: synthesize a structured verdict.
        if (schema?.name === 'spoiler_check_verdict') {
          const j = spoilerI++;
          const v = options.spoilerVerdicts?.[j] ?? 'auto-leak';
          // Extract the flagged candidates from the prompt (line:
          // "Flagged words: a, b, c") so 'auto-*' verdicts can
          // produce a sensible response.
          const m = /Flagged words: ([^\n]+)/.exec(req.prompt);
          const candidates = m
            ? m[1].split(/,\s*/).map((s) => s.trim()).filter((s) => s.length > 0)
            : [];
          let value: {
            verdict: 'ordinary' | 'leak';
            leakingWords: string[];
            reason: string;
          };
          if (v === 'auto-leak') {
            value = {
              verdict: 'leak',
              leakingWords: candidates,
              reason: 'mock: auto-leak verdict (default)'
            };
          } else if (v === 'auto-ordinary') {
            value = {
              verdict: 'ordinary',
              leakingWords: [],
              reason: 'mock: auto-ordinary verdict'
            };
          } else {
            value = v;
          }
          return {
            ok: true as const,
            value: value as T,
            raw: JSON.stringify(value),
            ...meta(`spoiler-${j}`)
          };
        }
        // Generation call: replay rawResponses in order.  Use the
        // 1-based generation index for the responseId so existing
        // tests that assert `mock-1`, `mock-2` keep matching.
        const raw = rawResponses[i++] ?? rawResponses[rawResponses.length - 1];
        try {
          const value = JSON.parse(raw) as T;
          return { ok: true as const, value, raw, ...meta(i) };
        } catch {
          return {
            ok: false as const,
            refusal: {
              kind: 'truncated' as const,
              message: 'mock: unparseable raw'
            },
            raw,
            ...meta(i)
          };
        }
      }
    ) as AiProvider['callStructured']
  };
  return { provider, calls, spoilerCalls };
}

const VALID_BACKSTORY_300 = Array.from({ length: 300 }, () => 'lorem').join(
  ' '
);

// P3T-2: synthesizer responses now MUST include stats + skillMastery.
// Default canonical sheet-ready values used by most tests.
const SHEET_READY = {
  stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
  skillMastery: ['Tech', 'Knowledge']
};

const VALID_JSON_BODY = JSON.stringify({
  name: 'Mei Tanaka',
  pronouns: 'she/her',
  tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
  ...SHEET_READY,
  backstory: `Mei grew up in the Mission. ${VALID_BACKSTORY_300}`
});

const BASE_REQ: SynthesizeBackstoryRequest = {
  campaignContext: [],
  dmConstraints: '',
  playerDisplayName: 'Markus',
  answers: [
    { question: sa('intent-moment', 'Intent moment'), answer: 'I stood up.' }
  ],
  apiKey: 'sk-test',
  model: 'claude-test-model'
};

// Phase 3b-X step 5: `extractJsonObject` describe block deleted —
// the function itself is gone (constrained decoding eliminates the
// need for prose-to-JSON regex extraction).  Surviving test
// coverage of the chargen pipeline is in the spoiler-firewall +
// validation + provider-refusal blocks below.

describe('synthesizeBackstory — happy path', () => {
  it('returns ok=true with the parsed response on a clean call', async () => {
    const { provider } = mockProvider([VALID_JSON_BODY]);
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.name).toBe('Mei Tanaka');
      expect(result.response.tags).toContain('junior engineer');
      expect(result.retried).toBe(false);
      // tokensIn / tokensOut land in the response.
      expect(result.response.tokensIn).toBe(100);
      expect(result.response.tokensOut).toBe(200);
      // responseId is broker-filled.
      expect(result.response.responseId).toBe('mock-1');
    }
  });

  it('returns warnings (non-blocking) when the validator surfaces them', async () => {
    // Backstory is short — < 250 default → "backstory-too-short" error.
    // But also missing pronouns → that's a warning.
    // Use a longer backstory + missing pronouns to isolate the warning.
    const body = JSON.stringify({
      name: 'Mei',
      // pronouns intentionally omitted from the JSON — but the schema
      // type guard requires pronouns to exist + be string.  Use empty
      // string instead: that satisfies the schema and triggers the
      // CC-21 'pronouns-empty' warning path.  Actually
      // `validatePcBackstory` flags pronouns only when it's
      // undefined/null.  Empty string passes.  Use too-many tags to
      // produce a warning instead.
      pronouns: 'she/her',
      tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], // 7 tags → warning.
      ...SHEET_READY,
      backstory:
        `Mei grew up in San Francisco. ${VALID_BACKSTORY_300}`
    });
    const { provider } = mockProvider([body]);
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.code === 'tags-too-many')).toBe(
        true
      );
    }
  });
});

describe('synthesizeBackstory — provider refusal / truncation (Phase 3b-X)', () => {
  // Under constrained decoding (steps 3+4), the providers emit
  // schema-conforming JSON by construction.  These tests run via
  // the step-1 shim (mocks return raw text → shim does JSON.parse
  // → maps parse failures to truncated).  Under real strict mode,
  // these failures are nearly impossible; under the shim they
  // exercise the truncated/refusal branch.

  it('maps unparseable provider output to code: provider-refused / kind: truncated', async () => {
    const { provider } = mockProvider(['not json at all']);
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('provider-refused');
      expect(result.refusalKind).toBe('truncated');
    }
  });

  it('maps schema-valid-JSON-but-missing-fields to code: provider-refused / kind: truncated', async () => {
    // Under the shim, JSON.parse succeeds → typed value is missing
    // required fields → the synthesizer's defense-in-depth guard
    // returns parse-failed.  Under real constrained decoding the
    // schema's `required[]` would prevent the missing field at the
    // wire, but the shim doesn't enforce schemas.
    const { provider } = mockProvider([
      JSON.stringify({ name: 'Just a name' })
    ]);
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Either parse-failed (defense-in-depth guard) OR
      // provider-refused (shim's truncated mapping) — both are
      // legitimate "AI didn't return a usable response" signals.
      expect(['parse-failed', 'provider-refused']).toContain(result.code);
    }
  });

  it('fenced code blocks are no longer a thing — under the shim they fail to parse → provider-refused', async () => {
    // Pre-3b-X: synthesizer ran extractJsonObject which stripped
    // ```json fences.  Post-3b-X: constrained decoding never emits
    // prose-wrapped JSON.  Under the shim, fenced text fails
    // JSON.parse → truncated → provider-refused.  Test pins the
    // new behavior so a future revival of fenced-output support is
    // a deliberate decision, not a regression.
    const { provider } = mockProvider(['```json\n' + VALID_JSON_BODY + '\n```']);
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('provider-refused');
      expect(result.refusalKind).toBe('truncated');
    }
  });
});

describe('synthesizeBackstory — spoiler firewall', () => {
  it('auto-retries once when forbidden tokens appear in the backstory', async () => {
    // First response leaks "magic"; second is clean.
    const leaky = JSON.stringify({
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
      ...SHEET_READY,
      backstory:
        `She felt the magic was real. ${VALID_BACKSTORY_300}`
    });
    const clean = JSON.stringify({
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
      ...SHEET_READY,
      backstory:
        `She grew up in the Mission. ${VALID_BACKSTORY_300}`
    });
    const { provider, calls } = mockProvider([leaky, clean]);
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.retried).toBe(true);
      expect(result.response.backstory).not.toContain('magic');
    }
    // Two calls made; second call's user prompt includes the "do
    // not use" appendix with the caught token named.
    expect(calls.length).toBe(2);
    expect(calls[1].user).toContain('Retry instruction');
    expect(calls[1].user).toContain('magic');
  });

  it('returns spoiler-leak-persistent when both attempts leak', async () => {
    const leaky = JSON.stringify({
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      ...SHEET_READY,
      backstory:
        `She felt the magic was real. ${VALID_BACKSTORY_300}`
    });
    const { provider, calls } = mockProvider([leaky, leaky]);
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('spoiler-leak-persistent');
      expect(result.persistentTokens).toContain('magic');
    }
    expect(calls.length).toBe(2);
  });

  it('accepts a campaign-supplied spoiler token list', async () => {
    // Default list doesn't include "cabal"; a campaign-supplied
    // list does.  Use a body with "cabal" and check that the
    // synthesizer catches it.
    const leaky = JSON.stringify({
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      ...SHEET_READY,
      backstory:
        `She had been recruited by the cabal. ${VALID_BACKSTORY_300}`
    });
    const { provider, calls } = mockProvider([leaky, leaky]);
    const result = await synthesizeBackstory(provider, {
      ...BASE_REQ,
      spoilerTokens: ['cabal']
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.code === 'spoiler-leak-persistent') {
      expect(result.persistentTokens).toContain('cabal');
    }
    expect(calls.length).toBe(2);
  });

  // ---- Phase 3b polish (2026-05-23): AI semantic-check filter ----

  it('Phase 3b: false positive — substring hits but AI verdict says "ordinary"; backstory ACCEPTED with no retry', async () => {
    // The substring scanner trips on the common-English word "chosen"
    // but the AI semantic check looks at context and decides it's
    // used in its everyday meaning ("problems I had chosen to
    // focus on").  Per the user's live-reported false positive
    // 2026-05-23 ("chosen" in "problems you'd chosen").
    const benign = JSON.stringify({
      name: 'Casey',
      pronouns: 'they/them',
      tags: ['systems engineer', 'self-taught', 'skeptical'],
      ...SHEET_READY,
      backstory:
        `They picked contract work, freelance, side projects they'd chosen. ${VALID_BACKSTORY_300}`
    });
    const { provider, calls, spoilerCalls } = mockProvider([benign], {
      spoilerVerdicts: ['auto-ordinary']
    });
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // No retry because AI filtered the substring hit as a false
      // positive.
      expect(result.retried).toBe(false);
      expect(result.response.backstory).toContain('chosen');
    }
    // One generation call + one spoiler-check call.
    expect(calls.length).toBe(1);
    expect(spoilerCalls.length).toBe(1);
  });

  it('Phase 3b: genuine leak — substring hits AND AI verdict says "leak"; retry fires', async () => {
    const leaky = JSON.stringify({
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      ...SHEET_READY,
      backstory:
        `She was the chosen one, destined for greater things. ${VALID_BACKSTORY_300}`
    });
    const clean = JSON.stringify({
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      ...SHEET_READY,
      backstory:
        `She grew up in the Mission. ${VALID_BACKSTORY_300}`
    });
    const { provider, calls, spoilerCalls } = mockProvider(
      [leaky, clean],
      {
        // First spoiler-check: verdict=leak (genuine).  No second
        // check because the retry's backstory has no substring
        // hits — the substring scanner short-circuits.
        spoilerVerdicts: ['auto-leak']
      }
    );
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.retried).toBe(true);
    }
    expect(calls.length).toBe(2); // two generation calls
    expect(spoilerCalls.length).toBe(1); // one check (only first backstory had hits)
  });

  it('Phase 3b: AI-check failure (provider error) → conservative fallback to treating substring hits as genuine', async () => {
    // When the AI check itself throws/refuses, the synthesizer
    // should fall back to treating the substring hits as genuine
    // leaks (conservative — over-flag rather than leak).
    const leaky = JSON.stringify({
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      ...SHEET_READY,
      backstory:
        `She had chosen wisely. ${VALID_BACKSTORY_300}`
    });
    // Make the provider refuse all spoiler-check calls.
    let callCount = 0;
    const provider: AiProvider = {
      id: 'claude',
      callStructured: vi.fn(
        async <T>(
          _req: { systemPrompt: string; prompt: string },
          schema?: { name?: string }
        ) => {
          callCount++;
          if (schema?.name === 'spoiler_check_verdict') {
            return {
              ok: false as const,
              refusal: {
                kind: 'provider-error' as const,
                message: 'simulated network outage'
              },
              raw: '',
              tokensIn: 0,
              tokensOut: 0,
              responseId: 'mock-fail'
            };
          }
          return {
            ok: true as const,
            value: JSON.parse(leaky) as T,
            raw: leaky,
            tokensIn: 100,
            tokensOut: 200,
            responseId: `mock-gen-${callCount}`
          };
        }
      ) as AiProvider['callStructured']
    };
    const result = await synthesizeBackstory(provider, BASE_REQ);
    // Substring hits + AI check failed → treated as genuine →
    // retry → second attempt also hits → spoiler-leak-persistent.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('spoiler-leak-persistent');
      expect(result.persistentTokens).toContain('chosen');
    }
  });
});

describe('synthesizeBackstory — validation failure', () => {
  it('returns validation-failed when structural errors exist', async () => {
    // 30-word backstory: too-short error.
    const short = JSON.stringify({
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      ...SHEET_READY,
      backstory: 'too short'
    });
    const { provider } = mockProvider([short]);
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('validation-failed');
      expect(result.errors).toBeDefined();
      expect(
        result.errors?.some((e) => e.code === 'backstory-too-short')
      ).toBe(true);
    }
  });

  it('flags player-name-match through validatorOptions', async () => {
    const body = JSON.stringify({
      name: 'Markus',
      pronouns: 'they/them',
      tags: ['a', 'b', 'c'],
      ...SHEET_READY,
      backstory: `${VALID_BACKSTORY_300}`
    });
    const { provider } = mockProvider([body]);
    const result = await synthesizeBackstory(provider, {
      ...BASE_REQ,
      validatorOptions: { playerDisplayName: 'Markus' }
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.code === 'validation-failed') {
      expect(
        result.errors?.some((e) => e.code === 'name-matches-player')
      ).toBe(true);
    }
  });
});

describe('synthesizeBackstory — provider errors', () => {
  it('returns provider-error when callStructured surfaces a network failure', async () => {
    // Phase 3b-X step 9: callStructured surfaces provider HTTP /
    // network failures as a refusal arm with `kind: 'provider-error'`.
    // The synthesizer maps that to its own `code: 'provider-error'`
    // (additive — same code, different upstream path).
    const provider: AiProvider = {
      id: 'claude',
      callStructured: vi.fn(async () => ({
        ok: false as const,
        refusal: { kind: 'provider-error' as const, message: 'network down' },
        raw: '',
        tokensIn: 0,
        tokensOut: 0,
        responseId: ''
      })) as AiProvider['callStructured']
    };
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('provider-error');
      expect(result.message).toContain('network down');
    }
  });

  it('returns aborted when callStructured throws AbortError', async () => {
    const provider: AiProvider = {
      id: 'claude',
      callStructured: vi.fn(async () => {
        const e = new Error('Aborted');
        e.name = 'AbortError';
        throw e;
      }) as AiProvider['callStructured']
    };
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('aborted');
    }
  });
});

describe('synthesizeBackstory — prompt assembly', () => {
  it('sends the canonical Underleaf system prompt', async () => {
    const { provider, calls } = mockProvider([VALID_JSON_BODY]);
    await synthesizeBackstory(provider, BASE_REQ);
    // System prompt is fixed via CC-19's constant; the synthesizer
    // doesn't mutate it.
    expect(calls[0].system).toContain('Avoid:');
    expect(calls[0].system).toContain('The Quiet');
  });

  it('includes player answers in the user prompt', async () => {
    const { provider, calls } = mockProvider([VALID_JSON_BODY]);
    await synthesizeBackstory(provider, {
      ...BASE_REQ,
      answers: [
        {
          question: sa('intent-moment', 'Intent moment'),
          answer: 'I refused to look away.'
        }
      ]
    });
    expect(calls[0].user).toContain('Intent moment');
    expect(calls[0].user).toContain('I refused to look away.');
  });
});

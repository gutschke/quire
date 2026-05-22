/**
 * backstory-synthesizer tests (end-to-end synthesis orchestration).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  synthesizeBackstory,
  extractJsonObject,
  type SynthesizeBackstoryRequest
} from './backstory-synthesizer';
import type { AiProvider, AiProviderCallResult } from './broker';
import type { CampaignCharCreationQuestion } from '../campaign-loader';

function sa(id: string, prompt: string): CampaignCharCreationQuestion {
  return { id, kind: 'short-answer', prompt };
}

/**
 * Build a mock provider that returns each of the given raw
 * responses in order.  `calls` array captures every request the
 * synthesizer made so tests can assert on retry behavior + prompt
 * contents.
 */
function mockProvider(rawResponses: string[]): {
  provider: AiProvider;
  calls: Array<{ system: string; user: string }>;
} {
  let i = 0;
  const calls: Array<{ system: string; user: string }> = [];
  const provider: AiProvider = {
    id: 'claude',
    call: vi.fn(async (req): Promise<AiProviderCallResult> => {
      calls.push({ system: req.systemPrompt, user: req.prompt });
      const raw = rawResponses[i++] ?? rawResponses[rawResponses.length - 1];
      return {
        raw,
        tokensIn: 100,
        tokensOut: 200,
        responseId: `mock-${i}`
      };
    }),
    parse: () => null
  };
  return { provider, calls };
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

describe('extractJsonObject', () => {
  it('returns the input when it is already a JSON object', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('returns the trimmed object for surrounding whitespace', () => {
    expect(extractJsonObject('   \n{"a":1}\n   ')).toBe('{"a":1}');
  });

  it('strips a ```json fenced code block', () => {
    expect(
      extractJsonObject('Here you go:\n```json\n{"a":1}\n```\nthanks')
    ).toBe('{"a":1}');
  });

  it('strips a bare ``` fenced code block', () => {
    expect(extractJsonObject('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('extracts an object embedded in surrounding prose', () => {
    expect(
      extractJsonObject('Sure! { "a": 1, "b": 2 } end of message.')
    ).toBe('{ "a": 1, "b": 2 }');
  });

  it('returns null on empty input', () => {
    expect(extractJsonObject('')).toBeNull();
    expect(extractJsonObject('   ')).toBeNull();
  });

  it('returns null when there is no { ... } at all', () => {
    expect(extractJsonObject('not a json response')).toBeNull();
  });
});

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

describe('synthesizeBackstory — JSON parse failures', () => {
  it('returns parse-failed when raw is not parseable JSON', async () => {
    const { provider } = mockProvider(['not json at all']);
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('parse-failed');
      expect(result.rawResponse).toBe('not json at all');
    }
  });

  it('returns parse-failed when JSON is valid but missing required fields', async () => {
    const { provider } = mockProvider([
      JSON.stringify({ name: 'Just a name' })
    ]);
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('parse-failed');
    }
  });

  it('handles JSON wrapped in fenced code blocks', async () => {
    const { provider } = mockProvider(['```json\n' + VALID_JSON_BODY + '\n```']);
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(true);
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
  it('returns provider-error on a thrown call', async () => {
    const provider: AiProvider = {
      id: 'claude',
      call: vi.fn(async () => {
        throw new Error('network down');
      }),
      parse: () => null
    };
    const result = await synthesizeBackstory(provider, BASE_REQ);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('provider-error');
      expect(result.message).toContain('network down');
    }
  });

  it('returns aborted on AbortError', async () => {
    const provider: AiProvider = {
      id: 'claude',
      call: vi.fn(async () => {
        const e = new Error('Aborted');
        e.name = 'AbortError';
        throw e;
      }),
      parse: () => null
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

import { describe, it, expect } from 'vitest';
import {
  requestComplementarityHints,
  type RosterSnapshot,
  type ComplementaritySuggestion
} from './complementarity-hints';
import type { AiProvider } from './broker';

function makeMockProvider(
  response:
    | { kind: 'ok'; suggestions: ComplementaritySuggestion[] }
    | { kind: 'refusal'; reason: string }
    | { kind: 'throw'; error: string }
): AiProvider {
  return {
    name: 'mock',
    call: async () => {
      throw new Error('not used');
    },
    callStructured: async () => {
      if (response.kind === 'throw') {
        throw new Error(response.error);
      }
      if (response.kind === 'refusal') {
        return {
          ok: false as const,
          refusal: { kind: 'content_filter', message: response.reason },
          tokensIn: 0,
          tokensOut: 0,
          raw: ''
        };
      }
      return {
        ok: true as const,
        value: { suggestions: response.suggestions },
        tokensIn: 100,
        tokensOut: 50,
        raw: JSON.stringify({ suggestions: response.suggestions })
      };
    }
  } as unknown as AiProvider;
}

const sampleRoster: RosterSnapshot = {
  pcs: [
    { name: 'Mei', archetype: 'junior engineer', dominantStat: 'INT', tags: ['tech', 'sister-of-a-pilot'] },
    { name: 'Reggie', archetype: 'aid worker', dominantStat: 'CHA', tags: ['paramedic'] }
  ]
};

describe('requestComplementarityHints', () => {
  it('returns ok=true with cleaned suggestions on AI success', async () => {
    const provider = makeMockProvider({
      kind: 'ok',
      suggestions: [
        { archetype: 'ex-soldier', hook: 'lost their squad to corporate violence' },
        { archetype: 'rebel cell veteran', hook: 'paying off a debt to the underground' }
      ]
    });
    const r = await requestComplementarityHints(provider, {
      apiKey: 'x',
      model: 'claude-haiku-4-5',
      roster: sampleRoster
    });
    expect(r.ok).toBe(true);
    expect(r.suggestions).toHaveLength(2);
    expect(r.suggestions[0].archetype).toBe('ex-soldier');
  });

  it('truncates oversized archetype + hook strings', async () => {
    const provider = makeMockProvider({
      kind: 'ok',
      suggestions: [
        {
          archetype: 'x'.repeat(100),
          hook: 'y'.repeat(200)
        }
      ]
    });
    const r = await requestComplementarityHints(provider, {
      apiKey: 'x',
      model: 'm',
      roster: sampleRoster
    });
    expect(r.suggestions[0].archetype.length).toBeLessThanOrEqual(40);
    expect(r.suggestions[0].hook.length).toBeLessThanOrEqual(120);
  });

  it('rejects entries with non-string fields silently', async () => {
    const provider = makeMockProvider({
      kind: 'ok',
      suggestions: [
        { archetype: 'good', hook: 'good hook' },
        { archetype: 42 as unknown as string, hook: 'broken' },
        { archetype: 'fine', hook: null as unknown as string }
      ]
    });
    const r = await requestComplementarityHints(provider, {
      apiKey: 'x',
      model: 'm',
      roster: sampleRoster
    });
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].archetype).toBe('good');
  });

  it('rejects empty-string fields', async () => {
    const provider = makeMockProvider({
      kind: 'ok',
      suggestions: [
        { archetype: '', hook: 'x' },
        { archetype: 'y', hook: '' }
      ]
    });
    const r = await requestComplementarityHints(provider, {
      apiKey: 'x',
      model: 'm',
      roster: sampleRoster
    });
    expect(r.ok).toBe(false);
    expect(r.suggestions).toEqual([]);
  });

  it('returns ok=false with reason on provider throw', async () => {
    const provider = makeMockProvider({
      kind: 'throw',
      error: 'network down'
    });
    const r = await requestComplementarityHints(provider, {
      apiKey: 'x',
      model: 'm',
      roster: sampleRoster
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/network down/);
  });

  it('returns ok=false with refusal reason on provider refusal', async () => {
    const provider = makeMockProvider({
      kind: 'refusal',
      reason: 'inappropriate content'
    });
    const r = await requestComplementarityHints(provider, {
      apiKey: 'x',
      model: 'm',
      roster: sampleRoster
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/refused/);
  });

  it('handles empty roster (suggests starting-party archetypes)', async () => {
    const provider = makeMockProvider({
      kind: 'ok',
      suggestions: [
        { archetype: 'medic', hook: 'a' },
        { archetype: 'tech', hook: 'b' },
        { archetype: 'face', hook: 'c' }
      ]
    });
    const r = await requestComplementarityHints(provider, {
      apiKey: 'x',
      model: 'm',
      roster: { pcs: [] }
    });
    expect(r.ok).toBe(true);
    expect(r.suggestions.length).toBe(3);
  });

  it('AbortError propagates rather than being trapped', async () => {
    const provider: AiProvider = {
      name: 'mock',
      call: async () => {
        throw new Error('not used');
      },
      callStructured: async () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
    } as unknown as AiProvider;
    await expect(
      requestComplementarityHints(provider, {
        apiKey: 'x',
        model: 'm',
        roster: sampleRoster
      })
    ).rejects.toThrow(/aborted/);
  });
});

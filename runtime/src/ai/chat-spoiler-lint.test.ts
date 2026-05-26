import { describe, it, expect } from 'vitest';
import {
  lintChatDraftSync,
  lintChatDraftAi
} from './chat-spoiler-lint';
import type { AiSpoilerCheckResult } from './spoiler-check';

describe('lintChatDraftSync', () => {
  it('returns flagged=false on a clean draft', () => {
    const r = lintChatDraftSync('we should grab coffee before the scene');
    expect(r.flagged).toBe(false);
    expect(r.substringHits).toEqual([]);
  });

  it('flags drafts containing default spoiler tokens', () => {
    const r = lintChatDraftSync('hey can you ask the AI what the magic system is');
    expect(r.flagged).toBe(true);
    expect(r.substringHits).toContain('magic');
  });

  it('returns multiple hits deduped + lowercased', () => {
    const r = lintChatDraftSync(
      'Magic and MAGIC and fate all over — the chosen one cometh'
    );
    expect(r.substringHits).toEqual(['magic', 'fate', 'chosen']);
  });

  it('respects caller-supplied token list (campaign policy)', () => {
    const r = lintChatDraftSync(
      'beware the antagonist whose true name is Vellum',
      ['Vellum']
    );
    expect(r.flagged).toBe(true);
    expect(r.substringHits).toEqual(['vellum']);
  });

  it('does NOT flag idiomatic substrings (word-boundary)', () => {
    const r = lintChatDraftSync('a magical sunset over the cafe');
    expect(r.flagged).toBe(false);
  });

  it('preserves the draft verbatim for caller display', () => {
    const draft = 'is the chosen one Yui?';
    const r = lintChatDraftSync(draft);
    expect(r.draft).toBe(draft);
  });
});

function fakeAiCheck(
  result: AiSpoilerCheckResult
): (candidates: string[], draft: string) => Promise<AiSpoilerCheckResult> {
  return async () => result;
}

describe('lintChatDraftAi', () => {
  it("maps ok=true → status='clean'", async () => {
    const r = await lintChatDraftAi({
      draft: 'the chosen seat at the cafe',
      substringHits: ['chosen'],
      aiCheck: fakeAiCheck({
        ok: true,
        leakingWords: [],
        reason: 'Ordinary verb meaning "selected"',
        checkFailed: false
      })
    });
    expect(r.status).toBe('clean');
    expect(r.aiLeaks).toEqual([]);
  });

  it("maps ok=false (real leak) → status='leak'", async () => {
    const r = await lintChatDraftAi({
      draft: 'they were the chosen one',
      substringHits: ['chosen'],
      aiCheck: fakeAiCheck({
        ok: false,
        leakingWords: ['chosen'],
        reason: 'Chosen-one trope reveals hidden lore',
        checkFailed: false
      })
    });
    expect(r.status).toBe('leak');
    expect(r.aiLeaks).toEqual(['chosen']);
  });

  it("maps checkFailed → status='failed' (conservative — keeps hits)", async () => {
    const r = await lintChatDraftAi({
      draft: 'magic system question',
      substringHits: ['magic'],
      aiCheck: fakeAiCheck({
        ok: false,
        leakingWords: ['magic'],
        reason: 'AI provider down; treating substring hits as genuine.',
        checkFailed: true
      })
    });
    expect(r.status).toBe('failed');
    expect(r.aiLeaks).toEqual(['magic']);
  });

  it('short-circuits without calling the AI when no hits to evaluate', async () => {
    let called = false;
    const r = await lintChatDraftAi({
      draft: 'clean',
      substringHits: [],
      aiCheck: async () => {
        called = true;
        return { ok: true, leakingWords: [], reason: '', checkFailed: false };
      }
    });
    expect(called).toBe(false);
    expect(r.status).toBe('clean');
  });

  it('passes substring hits + draft to the AI thunk verbatim', async () => {
    let receivedHits: string[] | null = null;
    let receivedDraft: string | null = null;
    await lintChatDraftAi({
      draft: 'hello fate',
      substringHits: ['fate'],
      aiCheck: async (hits, draft) => {
        receivedHits = hits;
        receivedDraft = draft;
        return { ok: true, leakingWords: [], reason: 'fine', checkFailed: false };
      }
    });
    expect(receivedHits).toEqual(['fate']);
    expect(receivedDraft).toBe('hello fate');
  });
});

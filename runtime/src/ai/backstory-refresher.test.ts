/**
 * backstory-refresher tests — UX-MH-3.
 *
 * Coverage:
 *   - happy path: surgical refresh returns proposed backstory +
 *     baseline hash
 *   - spoiler-leak post-check: first-pass leak triggers retry; retry
 *     leak triggers REFUSE (proposal never returned)
 *   - prompt shape: NO DM-side reasoning or dmNotes string in the
 *     assembled prompt (Adversarial P1 #4)
 *   - scope discipline: the module's public API has no `scope`
 *     parameter (type-level enforcement; smoke test via tsc)
 *   - sha256Hex: deterministic for fixed input
 */

import { describe, it, expect, vi } from 'vitest';
import {
  refreshBackstory,
  sha256Hex,
  _testHooks,
  type RefreshBackstoryRequest
} from './backstory-refresher';
import type { AiProvider } from './broker';

function mockProvider(
  refreshResponses: string[],
  options: {
    spoilerVerdicts?: Array<
      | 'auto-leak'
      | 'auto-ordinary'
      | { verdict: 'ordinary' | 'leak'; leakingWords: string[]; reason: string }
    >;
  } = {}
): {
  provider: AiProvider;
  refreshCalls: Array<{ system: string; user: string }>;
  spoilerCalls: Array<{ system: string; user: string }>;
} {
  let i = 0;
  let spoilerI = 0;
  const refreshCalls: Array<{ system: string; user: string }> = [];
  const spoilerCalls: Array<{ system: string; user: string }> = [];
  const provider: AiProvider = {
    id: 'claude',
    callStructured: vi.fn(
      async <T>(
        req: { systemPrompt: string; prompt: string },
        schema?: { name?: string }
      ) => {
        const isSpoiler = schema?.name === 'spoiler_check_verdict';
        const target = isSpoiler ? spoilerCalls : refreshCalls;
        target.push({ system: req.systemPrompt, user: req.prompt });
        const meta = (id: string | number) => ({
          tokensIn: 100,
          tokensOut: 200,
          responseId: `mock-${id}`
        });
        if (isSpoiler) {
          const j = spoilerI++;
          const v = options.spoilerVerdicts?.[j] ?? 'auto-leak';
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
              reason: 'mock: auto-leak'
            };
          } else if (v === 'auto-ordinary') {
            value = {
              verdict: 'ordinary',
              leakingWords: [],
              reason: 'mock: auto-ordinary'
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
        const raw =
          refreshResponses[i++] ?? refreshResponses[refreshResponses.length - 1];
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
  return { provider, refreshCalls, spoilerCalls };
}

function baseReq(
  overrides: Partial<RefreshBackstoryRequest> = {}
): RefreshBackstoryRequest {
  const { provider } = mockProvider(['{"backstory":"unused"}']);
  return {
    provider,
    apiKey: 'fake-key',
    model: 'claude-test',
    campaignContext: [],
    pcName: 'Mei',
    pcPronouns: 'they/them',
    pcTags: ['nurse', 'climber', 'beekeeper-raised'],
    baselineBackstory:
      'Mei grew up by the Underleaf. She trained as a nurse. She climbs in her off-time.',
    fieldDelta: {
      pronounsChanged: { from: 'she/her', to: 'they/them' }
    },
    initiator: 'dm',
    ...overrides
  };
}

describe('refreshBackstory — happy path', () => {
  it('returns proposedBackstory + baselineHash on a clean refresh', async () => {
    const { provider, refreshCalls } = mockProvider([
      '{"backstory":"Mei grew up by the Underleaf. They trained as a nurse. They climb in their off-time."}'
    ]);
    const result = await refreshBackstory(baseReq({ provider }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposedBackstory.toLowerCase()).toContain('they');
    expect(result.baselineHash).toHaveLength(64); // SHA-256 hex
    expect(result.retried).toBe(false);
    expect(refreshCalls.length).toBe(1);
  });

  it('baselineHash is deterministic against the baseline backstory', async () => {
    const { provider } = mockProvider([
      '{"backstory":"refreshed body"}'
    ]);
    const baseline = 'Mei grew up by the Underleaf.';
    const result = await refreshBackstory(
      baseReq({ provider, baselineBackstory: baseline })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = await sha256Hex(baseline);
    expect(result.baselineHash).toBe(expected);
  });
});

describe('refreshBackstory — spoiler firewall (R-G / P1 #2)', () => {
  it('first-pass leak triggers ONE retry; clean retry resolves OK', async () => {
    const { provider, refreshCalls } = mockProvider(
      [
        // First attempt leaks "the Quiet"
        '{"backstory":"Mei felt the Quiet pulling at her."}',
        // Retry resolves cleanly.
        '{"backstory":"Mei grew up by the Underleaf. They trained as a nurse."}'
      ],
      { spoilerVerdicts: ['auto-leak'] }
    );
    const result = await refreshBackstory(baseReq({ provider }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.retried).toBe(true);
    expect(refreshCalls.length).toBe(2);
    // The retry user-prompt names the leaking word in a do-not-use
    // appendix (Adversarial P1 #2 — explicit instruction to avoid).
    expect(refreshCalls[1].user).toContain('Retry instruction');
    expect(refreshCalls[1].user).toContain('quiet');
  });

  it('persistent leak after retry REFUSES — proposal never returned', async () => {
    const { provider } = mockProvider(
      [
        '{"backstory":"Mei felt the Quiet pulling at her."}',
        '{"backstory":"The Quiet rose around her again."}'
      ],
      { spoilerVerdicts: ['auto-leak', 'auto-leak'] }
    );
    const result = await refreshBackstory(baseReq({ provider }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('spoiler-leak-persistent');
    expect(result.persistentTokens).toContain('quiet');
  });

  it('false-positive spoiler word (semantic check verdict=ordinary) does NOT trigger retry', async () => {
    const { provider, refreshCalls } = mockProvider(
      [
        // The word "magic" surfaces in an ordinary metaphor sense.
        '{"backstory":"The magic of the morning light woke her."}'
      ],
      { spoilerVerdicts: ['auto-ordinary'] }
    );
    const result = await refreshBackstory(baseReq({ provider }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.retried).toBe(false);
    expect(refreshCalls.length).toBe(1);
  });
});

describe('refreshBackstory — prompt shape (Adversarial P1 #4)', () => {
  it('the assembled prompt does NOT contain DM dmNotes / reason / rationale strings', () => {
    const { system, user } = _testHooks.buildRefreshPrompt(
      baseReq({
        fieldDelta: {
          pronounsChanged: { from: 'she/her', to: 'they/them' },
          tagsRemoved: ['outsider']
        }
      })
    );
    const combined = `${system}\n${user}`.toLowerCase();
    // None of these DM-side strings should appear in the prompt.
    // (They would NEVER be passed in via fieldDelta — the type
    // doesn't even allow them — but the smoke test cheap-pins the
    // contract.)
    expect(combined).not.toContain('dmnotes');
    expect(combined).not.toContain('dm note');
    expect(combined).not.toContain('rationale');
    expect(combined).not.toContain('why this changed');
    expect(combined).not.toContain('reason');
    // The Quiet (Underleaf's load-bearing DM-private name) MUST NOT
    // appear — it's not in the player-facing context (the test
    // passes empty campaignContext + a player-safe fieldDelta).
    expect(combined).not.toContain('the quiet');
  });

  it('the prompt does include the field delta verbatim', () => {
    const { user } = _testHooks.buildRefreshPrompt(
      baseReq({
        fieldDelta: {
          pronounsChanged: { from: 'she/her', to: 'they/them' },
          tagsRemoved: ['outsider'],
          tagsAdded: ['witness']
        }
      })
    );
    expect(user).toContain('she/her');
    expect(user).toContain('they/them');
    expect(user).toContain('outsider');
    expect(user).toContain('witness');
  });

  it('player hint (when present) is forwarded verbatim', () => {
    const { user } = _testHooks.buildRefreshPrompt(
      baseReq({
        fieldDelta: {
          tagsAdded: ['cartographer'],
          playerHint: 'keep the bookstore reference'
        }
      })
    );
    expect(user).toContain('keep the bookstore reference');
  });
});

describe('refreshBackstory — provider refusal handling', () => {
  it('truncated provider response surfaces as parse-failed', async () => {
    const { provider } = mockProvider(['not valid JSON {{[}}']);
    const result = await refreshBackstory(baseReq({ provider }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('provider-refused');
    expect(result.refusalKind).toBe('truncated');
  });
});

describe('sha256Hex', () => {
  it('returns a 64-char hex string', async () => {
    const h = await sha256Hex('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', async () => {
    const a = await sha256Hex('the quick brown fox');
    const b = await sha256Hex('the quick brown fox');
    expect(a).toBe(b);
  });

  it('differs for different inputs', async () => {
    const a = await sha256Hex('a');
    const b = await sha256Hex('b');
    expect(a).not.toBe(b);
  });
});

describe('refreshBackstory — scope discipline (R-G P1 #1)', () => {
  it('the module source (excluding comments) calls no DM-scope helper', async () => {
    // CI-lint shape: grep the module source for forbidden patterns.
    // This is a smoke test that catches a regression where a
    // refactor forgets the lock and reintroduces a `scope:'dm'`
    // call inside the module.
    //
    // We strip TypeScript-style comments first so the doc-comments
    // that *describe* what the lock forbids don't trip the lint on
    // themselves.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = url.fileURLToPath(import.meta.url);
    const moduleFile = path.join(
      path.dirname(here),
      'backstory-refresher.ts'
    );
    const src = await fs.readFile(moduleFile, 'utf8');
    const stripped = stripComments(src);
    expect(
      stripped,
      'backstory-refresher.ts contains a forbidden scope:"dm" call site'
    ).not.toMatch(/scope\s*:\s*['"]dm['"]/);
    expect(
      stripped,
      'backstory-refresher.ts directly references buildCampaignContext; use buildPlayerFacingContext at the call site instead'
    ).not.toContain('buildCampaignContext');
  });
});

/** Strip TS-style `//` line and `/* … *\/` block comments. */
function stripComments(src: string): string {
  // Block comments first (greedy on /* … */ pairs, including JSDoc).
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Then trailing `// …` line comments.  We don't try to be clever
  // about string-literal-aware parsing — there are no `//` inside
  // string literals in this module.
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return out;
}

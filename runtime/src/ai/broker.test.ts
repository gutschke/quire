/**
 * AiBroker tests (M3b.2).
 *
 * Up-front guards (coord, api key, context refs) → AiBrokerError.
 * Provider success → AiResponse normalized.
 * Provider parse failure → parseFailureResponse fallback (no throw).
 * Provider HTTP failure → AiBrokerError(provider-error).
 */

import { describe, it, expect } from 'vitest';
import { AiBroker, type AiProvider } from './broker';

import type { AiAuditEntry } from '../core/state';

function makeBroker(
  provider: AiProvider,
  hostOverrides: Partial<{
    coord: string | undefined;
    me: string | undefined;
    apiKey: string;
    audit: readonly AiAuditEntry[];
    ceiling: number;
  }> = {}
): AiBroker {
  const host = {
    getCoordinator: () =>
      'coord' in hostOverrides ? hostOverrides.coord : 'alice',
    getLocalPeerId: () =>
      'me' in hostOverrides ? hostOverrides.me : 'alice',
    getApiKey: () =>
      'apiKey' in hostOverrides ? hostOverrides.apiKey ?? '' : 'sk-fake',
    getAiAudit: () => hostOverrides.audit ?? [],
    getBudgetCeiling: () => hostOverrides.ceiling ?? 1_000_000
  };
  return new AiBroker(provider, host);
}

const happyProvider: AiProvider = {
  id: 'claude',
  callStructured: async <T>() =>
    ({
      ok: true,
      value: { safe: 'Hello', dmOnly: 'secret', sources: [] } as T,
      raw: '{"safe":"Hello","dmOnly":"secret","sources":[]}',
      tokensIn: 10,
      tokensOut: 5,
      responseId: 'resp-1'
    } as const)
};

const malformedProvider: AiProvider = {
  id: 'claude',
  callStructured: async () => ({
    ok: false as const,
    refusal: { kind: 'truncated' as const, message: 'simulated truncation' },
    raw: 'this is not JSON',
    tokensIn: 7,
    tokensOut: 3,
    responseId: 'resp-2'
  })
};

const networkErrorProvider: AiProvider = {
  id: 'claude',
  callStructured: async () => ({
    ok: false as const,
    refusal: { kind: 'provider-error' as const, message: 'HTTP 500 from claude' },
    raw: '',
    tokensIn: 0,
    tokensOut: 0,
    responseId: ''
  })
};

describe('AiBroker.complete — guards', () => {
  it('throws not-coordinator when caller is not the current coord', async () => {
    const broker = makeBroker(happyProvider, { coord: 'someone-else' });
    await expect(
      broker.complete({ prompt: 'hi', scope: 'public', model: 'sonnet' })
    ).rejects.toMatchObject({
      name: 'AiBrokerError',
      code: 'not-coordinator'
    });
  });

  it('allows submission in solo mode (no coordinator set)', async () => {
    const broker = makeBroker(happyProvider, { coord: undefined });
    await expect(
      broker.complete({ prompt: 'hi', scope: 'public', model: 'sonnet' })
    ).resolves.toMatchObject({ safe: 'Hello' });
  });

  it('throws no-api-key when getApiKey returns empty', async () => {
    const broker = makeBroker(happyProvider, { apiKey: '' });
    await expect(
      broker.complete({ prompt: 'hi', scope: 'public', model: 'sonnet' })
    ).rejects.toMatchObject({ code: 'no-api-key' });
  });

  it('throws context-ref-invalid when a contextRef fails path validation', async () => {
    const broker = makeBroker(happyProvider);
    await expect(
      broker.complete({
        prompt: 'hi',
        scope: 'public',
        model: 'sonnet',
        contextRefs: ['../etc/passwd']
      })
    ).rejects.toMatchObject({ code: 'context-ref-invalid' });
  });

  it('throws context-ref-invalid for public-scope dm/* ref (defense in depth)', async () => {
    const broker = makeBroker(happyProvider);
    await expect(
      broker.complete({
        prompt: 'hi',
        scope: 'public',
        model: 'sonnet',
        contextRefs: ['dm/spoilers.md']
      })
    ).rejects.toMatchObject({ code: 'context-ref-invalid' });
  });
});

describe('AiBroker.complete — budget guard', () => {
  it('throws budget-exceeded when the session ceiling is met', async () => {
    const broker = makeBroker(happyProvider, {
      audit: [{ peerId: 'a', ts: 1, kind: 'prompt', tokensIn: 100 }],
      ceiling: 100
    });
    await expect(
      broker.complete({ prompt: 'hi', scope: 'public', model: 'sonnet' })
    ).rejects.toMatchObject({
      name: 'AiBrokerError',
      code: 'budget-exceeded'
    });
  });

  it('proceeds when under the ceiling', async () => {
    const broker = makeBroker(happyProvider, {
      audit: [{ peerId: 'a', ts: 1, kind: 'prompt', tokensIn: 50 }],
      ceiling: 100
    });
    await expect(
      broker.complete({ prompt: 'hi', scope: 'public', model: 'sonnet' })
    ).resolves.toMatchObject({ safe: 'Hello' });
  });
});

describe('AiBroker.complete — happy path', () => {
  it('returns the parsed AiResponse with broker-filled raw + tokens + id', async () => {
    const broker = makeBroker(happyProvider);
    const r = await broker.complete({
      prompt: 'hi',
      scope: 'public',
      model: 'sonnet'
    });
    expect(r.safe).toBe('Hello');
    expect(r.dmOnly).toBe('secret');
    expect(r.sources).toEqual([]);
    expect(r.raw).toContain('Hello');
    expect(r.tokensIn).toBe(10);
    expect(r.tokensOut).toBe(5);
    expect(r.responseId).toBe('resp-1');
  });
});

describe('AiBroker.complete — provider refusal → degraded response', () => {
  it('returns a refusal-shaped AiResponse when callStructured truncates', async () => {
    // Phase 3b-X step 9: callStructured returns a typed refusal
    // arm; broker.complete renders the non-provider-error kinds as
    // empty `safe` + a `(AI <kind>: ...)` dmOnly so the DM sees
    // something concrete and the audit chain still records it.
    const broker = makeBroker(malformedProvider);
    const r = await broker.complete({
      prompt: 'hi',
      scope: 'public',
      model: 'sonnet'
    });
    expect(r.safe).toBe('');
    expect(r.dmOnly).toMatch(/^\(AI truncated:/);
    expect(r.raw).toBe('this is not JSON');
    expect(r.tokensIn).toBe(7);
    expect(r.tokensOut).toBe(3);
    expect(r.responseId).toBe('resp-2');
  });
});

describe('AiBroker.complete — provider HTTP error', () => {
  it('wraps as AiBrokerError(provider-error) so the UI surfaces a banner', async () => {
    // Phase 3b-X step 8: callStructured maps HTTP/network errors to
    // `refusal.kind: 'provider-error'`; broker.complete throws that
    // as AiBrokerError so the UI shows an error banner.  (Other
    // refusal kinds — safety, truncated, model-unsupported — return
    // a degraded AiResponse instead; see the corresponding tests in
    // anthropic.test.ts / gemini.test.ts.)
    const broker = makeBroker(networkErrorProvider);
    await expect(
      broker.complete({ prompt: 'hi', scope: 'public', model: 'sonnet' })
    ).rejects.toMatchObject({
      name: 'AiBrokerError',
      code: 'provider-error'
    });
  });
});

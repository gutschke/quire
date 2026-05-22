/**
 * Gemini provider tests.
 *
 * Phase 3b-X step 9 deleted the legacy `parse()` method (along
 * with `call()`); coverage now centers on the `callStructured`
 * responseSchema path.  Schema-level shape enforcement lives in
 * `src/ai/schema-json.test.ts`; this file exercises wire shape +
 * refusal handling + error mapping.
 */

import { describe, it, expect } from 'vitest';
import { geminiProvider } from './gemini';

// Phase 3b-X step 4: responseSchema callStructured tests.

describe('geminiProvider.callStructured (Phase 3b-X step 4)', () => {
  const TEST_SCHEMA = {
    name: 'emit_test',
    schema: {
      type: 'object',
      properties: { greeting: { type: 'string' } },
      required: ['greeting'],
      additionalProperties: false
    }
  } as const;

  function mockOk(value: unknown): typeof fetch {
    return (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: JSON.stringify(value) }] },
              finishReason: 'STOP'
            }
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          responseId: 'gemini-1'
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
  }

  function mockJson(json: object, status = 200): typeof fetch {
    return (async () =>
      new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;
  }

  function mockStatus(status: number, body = 'err'): typeof fetch {
    return (async () =>
      new Response(body, { status })) as unknown as typeof fetch;
  }

  const baseReq = {
    apiKey: 'key',
    model: 'gemini-2.5-flash',
    systemPrompt: '',
    prompt: 'Say hi'
  };

  it('returns typed value on success', async () => {
    globalThis.fetch = mockOk({ greeting: 'Hello' });
    const r = await geminiProvider.callStructured<{ greeting: string }>(
      baseReq,
      TEST_SCHEMA
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.greeting).toBe('Hello');
      expect(r.tokensIn).toBe(10);
      expect(r.tokensOut).toBe(5);
    }
  });

  it('sends responseSchema + responseMimeType in the body', async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: '{"greeting":"hi"}' }] },
              finishReason: 'STOP'
            }
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    await geminiProvider.callStructured(baseReq, TEST_SCHEMA);
    const genCfg = capturedBody.generationConfig as Record<string, unknown>;
    expect(genCfg.responseMimeType).toBe('application/json');
    expect(genCfg.responseSchema).toBeDefined();
    // toGeminiSchema strips additionalProperties; verify.
    const respSchema = genCfg.responseSchema as Record<string, unknown>;
    expect('additionalProperties' in respSchema).toBe(false);
  });

  it('refuses pre-1.5 model with model-unsupported', async () => {
    const r = await geminiProvider.callStructured(
      { ...baseReq, model: 'gemini-pro' },
      TEST_SCHEMA
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.kind).toBe('model-unsupported');
      expect(r.refusal.message).toMatch(/1.5\+/);
    }
  });

  it('accepts gemini-1.5-* models', async () => {
    globalThis.fetch = mockOk({ greeting: 'ok' });
    const r = await geminiProvider.callStructured(
      { ...baseReq, model: 'gemini-1.5-pro' },
      TEST_SCHEMA
    );
    expect(r.ok).toBe(true);
  });

  it('surfaces SAFETY finishReason as kind: safety', async () => {
    globalThis.fetch = mockJson({
      candidates: [{ finishReason: 'SAFETY' }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 }
    });
    const r = await geminiProvider.callStructured(baseReq, TEST_SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.kind).toBe('safety');
      expect(r.refusal.message).toMatch(/SAFETY/);
    }
  });

  it('surfaces promptFeedback.blockReason as kind: safety', async () => {
    globalThis.fetch = mockJson({
      promptFeedback: { blockReason: 'SAFETY' },
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 0 }
    });
    const r = await geminiProvider.callStructured(baseReq, TEST_SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.kind).toBe('safety');
  });

  it('surfaces HTTP 5xx as provider-error', async () => {
    globalThis.fetch = mockStatus(500);
    const r = await geminiProvider.callStructured(baseReq, TEST_SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.kind).toBe('provider-error');
  });

  it('surfaces empty response body as truncated', async () => {
    globalThis.fetch = mockJson({
      candidates: [
        { content: { parts: [{ text: '' }] }, finishReason: 'STOP' }
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 0 }
    });
    const r = await geminiProvider.callStructured(baseReq, TEST_SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.kind).toBe('truncated');
  });

  it('surfaces unparseable JSON (truncation under responseSchema) as truncated', async () => {
    globalThis.fetch = mockJson({
      candidates: [
        {
          content: { parts: [{ text: '{"greeting":"hello' }] }, // cut mid-stream
          finishReason: 'MAX_TOKENS'
        }
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 5 }
    });
    const r = await geminiProvider.callStructured(baseReq, TEST_SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.kind).toBe('truncated');
  });

  it('rejects empty prompt with provider-error', async () => {
    const r = await geminiProvider.callStructured(
      { ...baseReq, prompt: '' },
      TEST_SCHEMA
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.kind).toBe('provider-error');
  });
});

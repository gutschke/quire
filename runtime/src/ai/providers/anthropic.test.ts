/**
 * Anthropic provider tests.
 *
 * Phase 3b-X step 9 deleted the legacy `parse()` method (along
 * with `call()`); coverage now centers on the `callStructured`
 * strict tool-use path.  Schema-level shape enforcement is in
 * `src/ai/schema-json.test.ts`; this file exercises wire shape
 * + refusal handling + error mapping.
 */

import { describe, it, expect } from 'vitest';
import { anthropicProvider } from './anthropic';

// Phase 3b-X step 3: strict tool-use callStructured tests.
//
// These tests mock global.fetch.  The provider sends
// `tools: [{strict: true, ...}]` + `tool_choice: {type:'tool', name}`;
// the mock returns a content array with a tool_use block whose
// `input` is the typed payload Claude would emit under constrained
// decoding.

describe('anthropicProvider.callStructured (Phase 3b-X step 3)', () => {
  const TEST_SCHEMA = {
    name: 'emit_test',
    schema: {
      type: 'object',
      properties: { greeting: { type: 'string' } },
      required: ['greeting'],
      additionalProperties: false
    }
  } as const;

  function mockOk(input: unknown): typeof fetch {
    return (async () =>
      new Response(
        JSON.stringify({
          id: 'msg_test_1',
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', name: 'emit_test', input }],
          usage: { input_tokens: 10, output_tokens: 5 }
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
  }

  function mockStatus(status: number, body = 'err'): typeof fetch {
    return (async () =>
      new Response(body, { status })) as unknown as typeof fetch;
  }

  function mockJson(json: object, status = 200): typeof fetch {
    return (async () =>
      new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;
  }

  const baseReq = {
    apiKey: 'sk-test',
    model: 'claude-haiku-4-5-20251001',
    systemPrompt: '',
    prompt: 'Say hi'
  };

  it('returns typed value on a strict tool-use success', async () => {
    globalThis.fetch = mockOk({ greeting: 'Hello' });
    const r = await anthropicProvider.callStructured<{ greeting: string }>(
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

  it('sends strict: true on the tool definition', async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({
          id: 'msg_x',
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', name: 'emit_test', input: { greeting: 'hi' } }],
          usage: { input_tokens: 1, output_tokens: 1 }
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    await anthropicProvider.callStructured(baseReq, TEST_SCHEMA);
    const tools = capturedBody.tools as Array<Record<string, unknown>>;
    expect(tools[0].strict).toBe(true);
    expect(tools[0].name).toBe('emit_test');
    expect(capturedBody.tool_choice).toEqual({ type: 'tool', name: 'emit_test' });
  });

  it('refuses older model with model-unsupported', async () => {
    const r = await anthropicProvider.callStructured(
      { ...baseReq, model: 'claude-3-opus-20240229' },
      TEST_SCHEMA
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.kind).toBe('model-unsupported');
      expect(r.refusal.message).toMatch(/3.5\+ \/ Claude 4.x/);
    }
  });

  it('accepts Claude 3.5+ models', async () => {
    globalThis.fetch = mockOk({ greeting: 'ok' });
    const r = await anthropicProvider.callStructured(
      { ...baseReq, model: 'claude-3-5-sonnet-20240620' },
      TEST_SCHEMA
    );
    expect(r.ok).toBe(true);
  });

  it('surfaces safety refusal as kind: safety', async () => {
    globalThis.fetch = mockJson({
      id: 'msg_refusal',
      stop_reason: 'refusal',
      content: [{ type: 'text', text: 'I cannot help with that.' }],
      usage: { input_tokens: 5, output_tokens: 2 }
    });
    const r = await anthropicProvider.callStructured(baseReq, TEST_SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.kind).toBe('safety');
      expect(r.refusal.message).toBe('I cannot help with that.');
    }
  });

  it('surfaces HTTP 5xx as provider-error', async () => {
    globalThis.fetch = mockStatus(500, 'server down');
    const r = await anthropicProvider.callStructured(baseReq, TEST_SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.kind).toBe('provider-error');
      expect(r.refusal.message).toMatch(/500/);
    }
  });

  it('surfaces strict-rejection 400 as model-unsupported', async () => {
    globalThis.fetch = mockStatus(400, 'strict mode not supported on this model');
    const r = await anthropicProvider.callStructured(baseReq, TEST_SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.kind).toBe('model-unsupported');
    }
  });

  it('surfaces missing tool_use block as truncated', async () => {
    // Strict + forced tool_choice → must produce tool_use.  If only
    // text comes back (streaming truncation, eg), surface as truncated.
    globalThis.fetch = mockJson({
      id: 'msg_truncated',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'no tool here' }],
      usage: { input_tokens: 1, output_tokens: 1 }
    });
    const r = await anthropicProvider.callStructured(baseReq, TEST_SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.kind).toBe('truncated');
    }
  });

  it('rejects empty prompt with provider-error', async () => {
    const r = await anthropicProvider.callStructured(
      { ...baseReq, prompt: '   ' },
      TEST_SCHEMA
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.kind).toBe('provider-error');
  });
});

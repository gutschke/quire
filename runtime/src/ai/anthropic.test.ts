import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callAnthropic, AnthropicError } from './anthropic';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('callAnthropic', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the text from a normal response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        content: [{ type: 'text', text: 'Hello, world.' }]
      })
    );
    const out = await callAnthropic({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5',
      user: 'hi'
    });
    expect(out).toBe('Hello, world.');
  });

  it('joins multiple text blocks', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        content: [
          { type: 'text', text: 'Part one. ' },
          { type: 'text', text: 'Part two.' }
        ]
      })
    );
    const out = await callAnthropic({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5',
      user: 'hi'
    });
    expect(out).toBe('Part one. Part two.');
  });

  it('sends the system prompt when provided', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ content: [{ type: 'text', text: 'OK' }] })
    );
    await callAnthropic({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5',
      system: 'You are a TTRPG narrator.',
      user: 'describe the scene'
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.system).toBe('You are a TTRPG narrator.');
    expect(body.messages).toEqual([
      { role: 'user', content: 'describe the scene' }
    ]);
  });

  it('uses the browser-direct opt-in header', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ content: [{ type: 'text', text: 'OK' }] })
    );
    await callAnthropic({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5',
      user: 'hi'
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('throws AnthropicError on missing key', async () => {
    await expect(
      callAnthropic({ apiKey: '', model: 'claude-haiku-4-5', user: 'hi' })
    ).rejects.toThrow(AnthropicError);
  });

  it('throws AnthropicError on empty prompt', async () => {
    await expect(
      callAnthropic({
        apiKey: 'sk-test',
        model: 'claude-haiku-4-5',
        user: '   '
      })
    ).rejects.toThrow(AnthropicError);
  });

  it('throws AnthropicError on HTTP error with status', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('quota exceeded', { status: 429 })
    );
    try {
      await callAnthropic({
        apiKey: 'sk-test',
        model: 'claude-haiku-4-5',
        user: 'hi'
      });
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AnthropicError);
      expect((e as AnthropicError).status).toBe(429);
    }
  });

  it('passes AbortSignal through', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ content: [{ type: 'text', text: 'OK' }] })
    );
    const ac = new AbortController();
    await callAnthropic({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5',
      user: 'hi',
      signal: ac.signal
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init as RequestInit).signal).toBe(ac.signal);
  });

  it('throws on a no-text response', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ content: [] }));
    await expect(
      callAnthropic({ apiKey: 'sk-test', model: 'claude-haiku-4-5', user: 'hi' })
    ).rejects.toThrow(/no text/i);
  });
});

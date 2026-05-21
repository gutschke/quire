import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callGemini, GeminiError } from './gemini';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('callGemini', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns text from a normal response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: 'Hello from Gemini.' }] },
            finishReason: 'STOP'
          }
        ]
      })
    );
    const out = await callGemini({
      apiKey: 'AIza-test',
      model: 'gemini-2.5-flash',
      user: 'hi'
    });
    expect(out).toBe('Hello from Gemini.');
  });

  it('joins multiple text parts', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: 'Part one. ' }, { text: 'Part two.' }]
            },
            finishReason: 'STOP'
          }
        ]
      })
    );
    const out = await callGemini({
      apiKey: 'AIza-test',
      model: 'gemini-2.5-flash',
      user: 'hi'
    });
    expect(out).toBe('Part one. Part two.');
  });

  it('sends system instruction when provided', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: 'OK' }] },
            finishReason: 'STOP'
          }
        ]
      })
    );
    await callGemini({
      apiKey: 'AIza-test',
      model: 'gemini-2.5-flash',
      system: 'You are a TTRPG narrator.',
      user: 'describe the scene'
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.systemInstruction).toEqual({
      parts: [{ text: 'You are a TTRPG narrator.' }]
    });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'describe the scene' }] }
    ]);
  });

  it('uses the x-goog-api-key header (not a query param)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }]
      })
    );
    await callGemini({
      apiKey: 'AIza-secret',
      model: 'gemini-2.5-flash',
      user: 'hi'
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect((url as string).includes('AIza-secret')).toBe(false);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('AIza-secret');
  });

  it('URL-encodes the model name', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }]
      })
    );
    await callGemini({
      apiKey: 'AIza-test',
      model: 'gemini-2.5-flash',
      user: 'hi'
    });
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url as string).toContain('gemini-2.5-flash:generateContent');
  });

  it('throws GeminiError on missing key', async () => {
    await expect(
      callGemini({ apiKey: '', model: 'gemini-2.5-flash', user: 'hi' })
    ).rejects.toThrow(GeminiError);
  });

  it('throws GeminiError on empty prompt', async () => {
    await expect(
      callGemini({
        apiKey: 'AIza-test',
        model: 'gemini-2.5-flash',
        user: '   '
      })
    ).rejects.toThrow(GeminiError);
  });

  it('throws GeminiError on HTTP error with status', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"error":{"code":403}}', { status: 403 })
    );
    try {
      await callGemini({
        apiKey: 'AIza-test',
        model: 'gemini-2.5-flash',
        user: 'hi'
      });
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(GeminiError);
      expect((e as GeminiError).status).toBe(403);
    }
  });

  it('surfaces a safety block at the candidate level', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        candidates: [{ finishReason: 'SAFETY' }]
      })
    );
    await expect(
      callGemini({
        apiKey: 'AIza-test',
        model: 'gemini-2.5-flash',
        user: 'hi'
      })
    ).rejects.toThrow(/SAFETY/);
  });

  it('surfaces a safety block at the prompt level', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        promptFeedback: { blockReason: 'OTHER' },
        candidates: []
      })
    );
    await expect(
      callGemini({
        apiKey: 'AIza-test',
        model: 'gemini-2.5-flash',
        user: 'hi'
      })
    ).rejects.toThrow(/declined.*OTHER/);
  });

  it('accepts MAX_TOKENS as a non-blocked finish reason', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: 'partial response' }] },
            finishReason: 'MAX_TOKENS'
          }
        ]
      })
    );
    const out = await callGemini({
      apiKey: 'AIza-test',
      model: 'gemini-2.5-flash',
      user: 'hi'
    });
    expect(out).toBe('partial response');
  });

  it('passes AbortSignal through', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }]
      })
    );
    const ac = new AbortController();
    await callGemini({
      apiKey: 'AIza-test',
      model: 'gemini-2.5-flash',
      user: 'hi',
      signal: ac.signal
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init as RequestInit).signal).toBe(ac.signal);
  });
});

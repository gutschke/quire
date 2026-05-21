/**
 * Browser-only Anthropic API client.  The user supplies their own API
 * key; we send it directly to api.anthropic.com with the
 * `anthropic-dangerous-direct-browser-access` opt-in header.
 *
 * This is deliberately a single-shot, single-response helper.  The
 * Quire AI surface is a DM aid — one prompt, one response, no
 * conversation memory.  If we ever need a thread-aware DM assistant
 * we'll layer it on top of this primitive rather than smuggling
 * conversational state into a side-effect function.
 *
 * No SDK, no streaming, no tool use for v1.  Tests can mock fetch
 * directly.
 */

export interface AnthropicRequest {
  apiKey: string;
  model: string;
  system?: string;
  user: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export class AnthropicError extends Error {
  override readonly name = 'AnthropicError';
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: string
  ) {
    super(message);
  }
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export async function callAnthropic(req: AnthropicRequest): Promise<string> {
  if (!req.apiKey) {
    throw new AnthropicError('Missing API key.');
  }
  if (!req.user.trim()) {
    throw new AnthropicError('Empty prompt.');
  }
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 1024,
    messages: [{ role: 'user', content: req.user }]
  };
  if (req.system) body.system = req.system;

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': req.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body),
      signal: req.signal
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AnthropicError(
      `Network error contacting Anthropic API.`,
      undefined,
      (e as Error).message
    );
  }

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const errText = await response.text();
      detail = errText.slice(0, 500);
    } catch {
      /* ignore */
    }
    throw new AnthropicError(
      `Anthropic API returned ${response.status}.`,
      response.status,
      detail
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (e) {
    throw new AnthropicError(
      'Anthropic API returned non-JSON.',
      response.status,
      (e as Error).message
    );
  }

  const text = extractText(json);
  if (text === null) {
    throw new AnthropicError(
      'Anthropic API returned no text content.',
      response.status
    );
  }
  return text;
}

function extractText(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const content = (json as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.length ? parts.join('') : null;
}

/**
 * Browser-only Google Gemini API client.  Mirrors the shape of
 * `anthropic.ts` so the QuireApp AI surface can use either provider
 * interchangeably via the AiClient interface.
 *
 * API key comes from aistudio.google.com (NOT from a Google One AI
 * Premium consumer subscription — those are separate products).
 * Free tier is generous enough for a TTRPG session.
 *
 * The endpoint is CORS-permitted for browser calls with an API key,
 * so no opt-in header is needed.  Auth is sent in the `x-goog-api-key`
 * header rather than a query parameter to keep keys out of URL logs.
 *
 * Gemini-specific gotcha: safety filters can return a 200 OK response
 * with no usable content (empty candidates, or finishReason of
 * SAFETY / RECITATION / OTHER).  We surface those as GeminiError so
 * the user sees a clear "the model declined to respond" message
 * rather than a generic empty-response failure.
 */

export interface GeminiRequest {
  apiKey: string;
  model: string;
  system?: string;
  user: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export class GeminiError extends Error {
  override readonly name = 'GeminiError';
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: string
  ) {
    super(message);
  }
}

function endpointFor(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;
}

export async function callGemini(req: GeminiRequest): Promise<string> {
  if (!req.apiKey) {
    throw new GeminiError('Missing API key.');
  }
  if (!req.user.trim()) {
    throw new GeminiError('Empty prompt.');
  }
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: req.user }] }],
    generationConfig: {
      maxOutputTokens: req.maxTokens ?? 1024
    }
  };
  if (req.system) {
    body.systemInstruction = { parts: [{ text: req.system }] };
  }

  let response: Response;
  try {
    response = await fetch(endpointFor(req.model), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': req.apiKey
      },
      body: JSON.stringify(body),
      signal: req.signal
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new GeminiError(
      `Network error contacting Gemini API.`,
      undefined,
      (e as Error).message
    );
  }

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const text = await response.text();
      detail = text.slice(0, 500);
    } catch {
      /* ignore */
    }
    throw new GeminiError(
      `Gemini API returned ${response.status}.`,
      response.status,
      detail
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (e) {
    throw new GeminiError(
      'Gemini API returned non-JSON.',
      response.status,
      (e as Error).message
    );
  }

  const { text, blockReason } = extractText(json);
  if (text === null) {
    if (blockReason) {
      throw new GeminiError(
        `Gemini declined to respond (${blockReason}).`,
        response.status
      );
    }
    throw new GeminiError('Gemini API returned no text content.', response.status);
  }
  return text;
}

interface ExtractResult {
  text: string | null;
  blockReason: string | null;
}

function extractText(json: unknown): ExtractResult {
  if (!json || typeof json !== 'object') return { text: null, blockReason: null };

  // Prompt-level block (before any generation happened).
  const promptFeedback = (json as { promptFeedback?: { blockReason?: string } })
    .promptFeedback;
  if (promptFeedback?.blockReason) {
    return { text: null, blockReason: promptFeedback.blockReason };
  }

  const candidates = (json as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { text: null, blockReason: null };
  }

  const first = candidates[0] as {
    content?: { parts?: Array<{ text?: unknown }> };
    finishReason?: string;
  };

  // Output-level block.
  if (
    first.finishReason &&
    first.finishReason !== 'STOP' &&
    first.finishReason !== 'MAX_TOKENS'
  ) {
    return { text: null, blockReason: first.finishReason };
  }

  const parts = first.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return { text: null, blockReason: null };
  }
  const pieces: string[] = [];
  for (const p of parts) {
    if (typeof p.text === 'string') pieces.push(p.text);
  }
  return {
    text: pieces.length ? pieces.join('') : null,
    blockReason: null
  };
}

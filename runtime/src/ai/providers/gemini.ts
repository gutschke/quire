/**
 * Gemini provider impl for AiBroker (M3b.2).
 *
 * Uses Gemini's `generationConfig.responseSchema` to coerce
 * structured `{safe, dmOnly, sources}` output.  Per redesign-plan.md
 * L159: Gemini structured output doesn't support oneOf/anyOf for
 * the root, so AiResponse maps cleanly (every field has a single
 * type).
 *
 * Gemini quirks (preserved from src/ai/gemini.ts):
 *   - safety filters return 200 OK with empty candidates +
 *     finishReason of SAFETY / RECITATION / OTHER → treated as
 *     declined response.
 *   - prompt-level blocks land in promptFeedback.blockReason.
 *
 * Both shapes flow through to the broker as a parse failure (raw
 * text empty → broker degrades to parseFailureResponse).
 */

import type {
  AiProvider,
  AiProviderCallRequest,
  AiProviderCallResult
} from '../broker';
import type { AiResponse } from '../schema';

const AI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    safe: { type: 'string' },
    dmOnly: { type: 'string' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          path: { type: 'string' }
        },
        required: ['label']
      }
    },
    // M3c.2: optional stateUpdates.  Gemini's responseSchema
    // doesn't support oneOf for items, so we flatten — all fields
    // are optional and the client-side validator (isStateUpdate)
    // enforces the discriminated-union semantics per kind.
    stateUpdates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['pc-edit', 'dice-roll', 'caster-state-set']
          },
          pcId: { type: 'string' },
          field: { type: 'string', enum: ['harm', 'stress'] },
          delta: { type: 'integer' },
          reason: { type: 'string' },
          purpose: { type: 'string' },
          expression: { type: 'string' },
          modifierBreakdown: { type: 'string' },
          ladderState: {
            type: 'string',
            enum: [
              'clear',
              'quiet',
              'noticed',
              'watched',
              'pushing-back',
              'hunted'
            ]
          },
          taxActive: { type: 'boolean' },
          spamCount: { type: 'integer' }
        },
        required: ['kind']
      }
    }
  },
  required: ['safe', 'dmOnly', 'sources']
};

export class GeminiProviderError extends Error {
  override readonly name = 'GeminiProviderError';
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

export const geminiProvider: AiProvider = {
  id: 'gemini',
  async call(req: AiProviderCallRequest): Promise<AiProviderCallResult> {
    if (!req.prompt.trim()) {
      throw new GeminiProviderError('Empty prompt.');
    }
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema: AI_RESPONSE_SCHEMA
      }
    };
    if (req.systemPrompt) {
      body.systemInstruction = { parts: [{ text: req.systemPrompt }] };
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
      throw new GeminiProviderError(
        'Network error contacting Gemini API.',
        undefined,
        (e as Error).message
      );
    }
    if (!response.ok) {
      let detail: string | undefined;
      try {
        detail = (await response.text()).slice(0, 500);
      } catch {
        /* ignore */
      }
      throw new GeminiProviderError(
        `Gemini API returned ${response.status}.`,
        response.status,
        detail
      );
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (e) {
      throw new GeminiProviderError(
        'Gemini API returned non-JSON.',
        response.status,
        (e as Error).message
      );
    }
    const blockReason = extractBlockReason(json);
    if (blockReason) {
      throw new GeminiProviderError(
        `Gemini declined to respond (${blockReason}).`,
        response.status
      );
    }
    const raw = extractRawText(json);
    const usage = extractUsage(json);
    const responseId = extractResponseId(json);
    return {
      raw,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      responseId
    };
  },
  parse(raw: string): Partial<AiResponse> | null {
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.safe !== 'string') return null;
    if (typeof p.dmOnly !== 'string') return null;
    if (!Array.isArray(p.sources)) return null;
    const stateUpdates = Array.isArray(p.stateUpdates)
      ? (p.stateUpdates as Array<Record<string, unknown>>)
      : undefined;
    return {
      safe: p.safe,
      dmOnly: p.dmOnly,
      sources: p.sources as Array<{ label: string; path?: string }>,
      ...(stateUpdates !== undefined && { stateUpdates: stateUpdates as never })
    };
  }
};

function extractRawText(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const candidates = (json as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const first = candidates[0] as {
    content?: { parts?: Array<{ text?: unknown }> };
  };
  const parts = first.content?.parts;
  if (!Array.isArray(parts)) return '';
  const pieces: string[] = [];
  for (const p of parts) {
    if (typeof p.text === 'string') pieces.push(p.text);
  }
  return pieces.join('');
}

function extractBlockReason(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const promptFeedback = (
    json as { promptFeedback?: { blockReason?: string } }
  ).promptFeedback;
  if (promptFeedback?.blockReason) return promptFeedback.blockReason;
  const candidates = (json as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0] as { finishReason?: string };
  if (
    first.finishReason &&
    first.finishReason !== 'STOP' &&
    first.finishReason !== 'MAX_TOKENS'
  ) {
    return first.finishReason;
  }
  return null;
}

function extractUsage(json: unknown): { tokensIn: number; tokensOut: number } {
  if (!json || typeof json !== 'object') return { tokensIn: 0, tokensOut: 0 };
  const meta = (json as { usageMetadata?: unknown }).usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number }
    | undefined;
  return {
    tokensIn:
      typeof meta?.promptTokenCount === 'number' ? meta.promptTokenCount : 0,
    tokensOut:
      typeof meta?.candidatesTokenCount === 'number'
        ? meta.candidatesTokenCount
        : 0
  };
}

function extractResponseId(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const id =
    (json as { responseId?: unknown }).responseId ??
    (json as { modelVersion?: unknown }).modelVersion;
  return typeof id === 'string' ? id : '';
}

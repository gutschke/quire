/**
 * Anthropic provider impl for AiBroker (M3b.2).
 *
 * Uses Claude tool_use forced-choice to coerce the model into
 * returning a structured `{safe, dmOnly, sources}` object.  The
 * provider returns the tool_use input as a stringified JSON for
 * the broker to parse + audit; on absent tool_use (which Claude
 * sometimes does despite forced choice), the parser returns null
 * so the broker falls back to `parseFailureResponse`.
 *
 * Per redesign-plan.md L158: Anthropic tool use can include a
 * leading `text` block before the `tool_use` block (Claude often
 * narrates its tool choice).  We iterate `content[]` and pick the
 * first `tool_use` block; an absent tool_use is treated as a
 * parse failure, NOT silently surfaced as safe-card content.
 */

import type {
  AiProvider,
  AiProviderCallRequest,
  AiProviderCallResult
} from '../broker';
import type { AiResponse } from '../schema';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const AI_RESPONSE_TOOL = {
  name: 'ai_response',
  description:
    'Return your response as TWO parts: `safe` (text safe to read aloud at the table — no spoilers, no DM-only material) and `dmOnly` (DM-eyes-only notes, mechanics hints, spoilers).  Both must be strings.  `sources` is an array of {label, path?} citations into the campaign repo.',
  input_schema: {
    type: 'object',
    properties: {
      safe: {
        type: 'string',
        description: 'Player-safe text (read aloud).  Empty string if all of the answer is DM-only.'
      },
      dmOnly: {
        type: 'string',
        description: 'DM-eyes-only text (spoilers, mechanics, NPC motivations).  Empty string if all of the answer is player-safe.'
      },
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
      }
    },
    required: ['safe', 'dmOnly', 'sources']
  }
};

export class AnthropicProviderError extends Error {
  override readonly name = 'AnthropicProviderError';
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: string
  ) {
    super(message);
  }
}

export const anthropicProvider: AiProvider = {
  id: 'claude',
  async call(req: AiProviderCallRequest): Promise<AiProviderCallResult> {
    if (!req.prompt.trim()) {
      throw new AnthropicProviderError('Empty prompt.');
    }
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: req.prompt }],
      tools: [AI_RESPONSE_TOOL],
      tool_choice: { type: 'tool', name: AI_RESPONSE_TOOL.name }
    };
    if (req.systemPrompt) body.system = req.systemPrompt;
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
      throw new AnthropicProviderError(
        'Network error contacting Anthropic API.',
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
      throw new AnthropicProviderError(
        `Anthropic API returned ${response.status}.`,
        response.status,
        detail
      );
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (e) {
      throw new AnthropicProviderError(
        'Anthropic API returned non-JSON.',
        response.status,
        (e as Error).message
      );
    }
    const raw = extractRawToolInput(json);
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
    return {
      safe: p.safe,
      dmOnly: p.dmOnly,
      sources: p.sources as Array<{ label: string; path?: string }>
    };
  }
};

/**
 * Find the first tool_use block in the response's content array
 * and return its input as a stringified JSON.  When no tool_use
 * block exists (Claude returned only text despite forced tool),
 * returns the concatenated text blocks — the broker's parse step
 * will reject it as malformed and fall back gracefully.
 */
function extractRawToolInput(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const content = (json as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'tool_use' &&
      (block as { name?: unknown }).name === AI_RESPONSE_TOOL.name
    ) {
      const input = (block as { input?: unknown }).input;
      if (input && typeof input === 'object') {
        return JSON.stringify(input);
      }
    }
  }
  // No tool_use — fall back to concatenated text for the audit log.
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
  return parts.join('');
}

function extractUsage(json: unknown): { tokensIn: number; tokensOut: number } {
  if (!json || typeof json !== 'object') return { tokensIn: 0, tokensOut: 0 };
  const usage = (json as { usage?: unknown }).usage as
    | { input_tokens?: number; output_tokens?: number }
    | undefined;
  return {
    tokensIn:
      typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0,
    tokensOut:
      typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0
  };
}

function extractResponseId(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const id = (json as { id?: unknown }).id;
  return typeof id === 'string' ? id : '';
}

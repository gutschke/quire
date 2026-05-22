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
  AiProviderCallResult,
  AiProviderStructuredResult,
  AiStructuredCallSchema
} from '../broker';
import type { AiResponse } from '../schema';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const AI_RESPONSE_TOOL = {
  name: 'ai_response',
  description:
    'Return your response with `safe` (text safe to read aloud — no spoilers, no DM-only material), `dmOnly` (DM-eyes-only spoilers / mechanics / motivations), `sources` (campaign-repo citations), and OPTIONAL `stateUpdates` (typed bookkeeping the DM will accept-gate: pc-edit for harm/stress changes, dice-roll proposals, caster-state-set for the magic ladder / trying-too-hard tax / cast-spam counter).',
  input_schema: {
    type: 'object',
    properties: {
      safe: {
        type: 'string',
        description:
          'Player-safe text (read aloud).  Empty string if all of the answer is DM-only.'
      },
      dmOnly: {
        type: 'string',
        description:
          'DM-eyes-only text (spoilers, mechanics, NPC motivations).  Empty string if all of the answer is player-safe.'
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
      },
      stateUpdates: {
        type: 'array',
        description:
          'Optional typed bookkeeping the DM will accept before any event is appended.  Default to empty; only emit when the prose response clearly implies a state change.  HARD-GATED transitions (harm box 3 or 4, stress box 4, ladder advancing to hunted, trying-too-hard activation or release, dice double-1, cross-PC pc-edit) WILL require explicit DM click — surface them anyway, but expect the friction.',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['pc-edit', 'dice-roll', 'caster-state-set']
            },
            // pc-edit
            pcId: { type: 'string' },
            field: { type: 'string', enum: ['harm', 'stress'] },
            delta: { type: 'integer' },
            reason: { type: 'string' },
            // dice-roll
            purpose: { type: 'string' },
            expression: { type: 'string' },
            modifierBreakdown: { type: 'string' },
            // caster-state-set
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
    // M3c.2: stateUpdates is OPTIONAL.  Absent or empty → broker
    // defaults to [].  When present, hand it through; the broker's
    // isAiResponse / isStateUpdate guard rejects malformed entries.
    const stateUpdates = Array.isArray(p.stateUpdates)
      ? (p.stateUpdates as Array<Record<string, unknown>>)
      : undefined;
    return {
      safe: p.safe,
      dmOnly: p.dmOnly,
      sources: p.sources as Array<{ label: string; path?: string }>,
      ...(stateUpdates !== undefined && { stateUpdates: stateUpdates as never })
    };
  },
  /**
   * Phase 3b-X step 3: Anthropic strict tool use.  The provider
   * sends a single tool definition with `strict: true` and forces
   * tool_choice to that tool, so Claude must emit a payload matching
   * `schema.schema` exactly via grammar-constrained decoding.
   * Returns a typed parsed value directly — no regex extraction, no
   * JSON.parse on prose, no shape guard at the call site.
   *
   * Refusals (Claude declines for safety reasons) surface as
   * `{ok: false, refusal: {kind: 'safety', message}}`.  Older models
   * that don't support strict tool use surface as
   * `{ok: false, refusal: {kind: 'model-unsupported', message}}`.
   *
   * Per the 3b-X plan Q5, model support is hard-failed at the
   * provider — the user sees a clear UI message instead of silent
   * fallback to the legacy prose-parse path.
   */
  async callStructured<T>(
    req: AiProviderCallRequest,
    schema: AiStructuredCallSchema
  ): Promise<AiProviderStructuredResult<T>> {
    if (!req.prompt.trim()) {
      return refusalResult('provider-error', 'Empty prompt.');
    }
    if (!isStrictToolUseCapableModel(req.model)) {
      return refusalResult(
        'model-unsupported',
        `Model "${req.model}" predates Anthropic strict tool use (Claude 3.5+ / Claude 4.x).  Pick a newer model in AI settings.`
      );
    }
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: req.prompt }],
      tools: [
        {
          name: schema.name,
          description: `Emit the response as a structured ${schema.name} payload.`,
          input_schema: schema.schema,
          // Anthropic strict tool use: grammar-constrained decoding.
          // Claude's decoder cannot emit tokens that violate the
          // schema; mis-shaped responses become impossible.
          strict: true
        }
      ],
      tool_choice: { type: 'tool', name: schema.name }
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
      return refusalResult(
        'provider-error',
        `Network error contacting Anthropic API: ${(e as Error).message}`
      );
    }
    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 500);
      } catch {
        /* ignore */
      }
      // 400 from strict-mode-unsupported request → surface as
      // model-unsupported so the DM gets a clearer error than the
      // raw provider message.
      if (response.status === 400 && /strict/i.test(detail)) {
        return refusalResult(
          'model-unsupported',
          `Anthropic rejected strict tool use for model "${req.model}" — likely not supported on this model: ${detail}`
        );
      }
      return refusalResult(
        'provider-error',
        `Anthropic API returned ${response.status}: ${detail}`
      );
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (e) {
      return refusalResult(
        'truncated',
        `Anthropic API returned non-JSON: ${(e as Error).message}`
      );
    }
    const usage = extractUsage(json);
    const responseId = extractResponseId(json);
    const stopReason = extractStopReason(json);
    // Claude 4.x surfaces safety refusals as stop_reason: 'refusal'.
    if (stopReason === 'refusal') {
      const message = extractRefusalText(json) || 'Claude declined to respond.';
      return {
        ok: false,
        refusal: { kind: 'safety', message },
        raw: message,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        responseId
      };
    }
    // Locate the tool_use block.  Under strict mode + forced tool
    // choice, this MUST exist — but be defensive.
    const toolInput = extractToolUseInput(json, schema.name);
    if (toolInput === null) {
      return refusalResult(
        'truncated',
        'Claude did not emit a tool_use block under forced tool choice; likely a streaming truncation.'
      );
    }
    return {
      ok: true,
      value: toolInput as T,
      raw: JSON.stringify(toolInput),
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      responseId
    };
  }
};

/** Helper to construct a refusal-arm result without repeating boilerplate. */
function refusalResult<T>(
  kind: 'safety' | 'model-unsupported' | 'provider-error' | 'truncated',
  message: string
): AiProviderStructuredResult<T> {
  return {
    ok: false,
    refusal: { kind, message },
    raw: '',
    tokensIn: 0,
    tokensOut: 0,
    responseId: ''
  };
}

/**
 * Strict tool use requires Claude 3.5+ or Claude 4.x.  Pre-3.5
 * Claude (haiku-3, opus-3, sonnet-3) returns a 400 when the
 * request includes `strict: true`.  We hard-fail early with a UI-
 * friendly message rather than send a known-bad request.
 *
 * Heuristic: the model id contains a "-N-" major-version marker
 * (claude-3-5, claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-7).
 * 3.5+ and 4.x both support strict; pre-3.5 don't.
 */
function isStrictToolUseCapableModel(model: string): boolean {
  if (/claude.*-4(?:-|\d|$)/.test(model)) return true;
  if (/claude.*-3-5(?:-|$)/.test(model)) return true;
  return false;
}

function extractStopReason(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const r = (json as { stop_reason?: unknown }).stop_reason;
  return typeof r === 'string' ? r : undefined;
}

function extractRefusalText(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const content = (json as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as { type?: unknown; text?: unknown };
      if (b.type === 'text' && typeof b.text === 'string') return b.text;
    }
  }
  return '';
}

function extractToolUseInput(
  json: unknown,
  toolName: string
): unknown | null {
  if (!json || typeof json !== 'object') return null;
  const content = (json as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as { type?: unknown; name?: unknown; input?: unknown };
      if (b.type === 'tool_use' && b.name === toolName) {
        return b.input ?? null;
      }
    }
  }
  return null;
}

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

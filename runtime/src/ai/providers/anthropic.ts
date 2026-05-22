/**
 * Anthropic provider impl for AiBroker.
 *
 * Uses Anthropic strict tool use for provider-side constrained
 * decoding (Phase 3b-X): the caller hands in a JSON Schema via
 * `callStructured`, and Claude's decoder cannot emit tokens that
 * violate it.  Returns a typed parsed value directly — no regex
 * extraction, no JSON.parse on prose, no shape guard at the call
 * site.  Refusals (safety / model-unsupported / truncated) surface
 * as typed `refusal` arms instead of throwing.
 *
 * Step 9 (this commit) deleted the legacy `call()` / `parse()`
 * pair; everything routes through `callStructured` now.
 */

import type {
  AiProvider,
  AiProviderCallRequest,
  AiProviderStructuredResult,
  AiStructuredCallSchema
} from '../broker';
import { toAnthropicSchema } from '../schema-json';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export const anthropicProvider: AiProvider = {
  id: 'claude',
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
          input_schema: toAnthropicSchema(schema.schema),
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

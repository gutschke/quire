/**
 * AiBroker — the single AI surface the UI calls (M3b.2, P2-6).
 *
 * Wraps the existing `callAnthropic` / `callGemini` text-in/text-out
 * functions with the AiResponse contract.  Provider impls (Anthropic
 * tool_use, Gemini response schema) parse to `{safe, dmOnly, sources}`;
 * the broker normalizes both, validates with `isAiResponse`, and
 * falls back to `parseFailureResponse(rawText)` if parsing fails
 * — never throws on a model-side parse error.
 *
 * Coord-only enforcement (audit chain invariant): only the
 * currently-acting coordinator may call `complete()`.  A peer who
 * historically held coord but has since yielded is rejected — the
 * audit chain is strict (single appender), not a fork-prone DAG.
 */

import type { AiResponse } from './schema';
import { isAiResponse, parseFailureResponse } from './schema';
import { validateContextRef, type ContextScope } from './context';
import { assertWithinBudget } from './budget';
import type { AiAuditEntry } from '../core/state';

/**
 * The shape an HTTP-callable provider impl must satisfy.  Returns
 * the raw provider text (or stringified JSON) so the broker can
 * audit it verbatim; parsing happens via the provider's `parse`.
 */
export interface AiProvider {
  /** Provider id, e.g. 'claude' or 'gemini' — for audit + UI. */
  id: 'claude' | 'gemini';
  /** Issue a structured request; return raw text + token counts. */
  call(req: AiProviderCallRequest): Promise<AiProviderCallResult>;
  /** Parse provider raw response to (best-effort) AiResponse shape. */
  parse(raw: string): Partial<AiResponse> | null;
}

export interface AiProviderCallRequest {
  apiKey: string;
  model: string;
  systemPrompt: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface AiProviderCallResult {
  /** Raw response text or stringified-JSON tool output. */
  raw: string;
  tokensIn: number;
  tokensOut: number;
  responseId: string;
}

export interface AiCompleteRequest {
  prompt: string;
  scope: ContextScope;
  /** Campaign-relative paths to include as untrusted context. */
  contextRefs?: string[];
  /** System prompt prepended to the model request. */
  systemPrompt?: string;
  /** Model name override (provider-specific). */
  model: string;
  signal?: AbortSignal;
}

/**
 * Surface checked by the broker before calling a provider — both
 * the api key and the current-coord guard live here.  The host
 * supplies a getter (rather than a static value) so the broker
 * always reads the LATEST state at call time, not at construction
 * time.
 */
export interface AiBrokerHost {
  /** Returns the current coordinator's peerId, or undefined. */
  getCoordinator(): string | undefined;
  /** Returns the local peerId, or undefined when offline. */
  getLocalPeerId(): string | undefined;
  /** Returns the API key for the active provider, or empty. */
  getApiKey(): string;
  /** Returns the current session's aiAudit entries (for budget). */
  getAiAudit(): readonly AiAuditEntry[];
  /** Returns the configured per-session token ceiling. */
  getBudgetCeiling(): number;
}

export class AiBrokerError extends Error {
  override readonly name = 'AiBrokerError';
  constructor(
    message: string,
    public readonly code:
      | 'not-coordinator'
      | 'no-api-key'
      | 'context-ref-invalid'
      | 'budget-exceeded'
      | 'provider-error'
  ) {
    super(message);
  }
}

export class AiBroker {
  constructor(
    private readonly provider: AiProvider,
    private readonly host: AiBrokerHost
  ) {}

  /**
   * Execute a structured AI completion.  Returns an AiResponse
   * (possibly the degraded `parseFailureResponse` shape on a
   * provider-side parse failure, never throws on parse failure).
   * Throws AiBrokerError for the up-front guards (not coord,
   * missing API key, invalid context ref) — those are user-facing
   * errors that the UI should surface in the prompt panel.
   */
  async complete(req: AiCompleteRequest): Promise<AiResponse> {
    const coord = this.host.getCoordinator();
    const me = this.host.getLocalPeerId();
    if (!coord || !me || coord !== me) {
      throw new AiBrokerError(
        'AI broker calls are restricted to the current DM (coordinator).',
        'not-coordinator'
      );
    }
    const apiKey = this.host.getApiKey();
    if (!apiKey) {
      throw new AiBrokerError(
        'No API key configured for the active provider.',
        'no-api-key'
      );
    }
    // Validate every context ref up-front; fail closed.
    for (const ref of req.contextRefs ?? []) {
      const v = validateContextRef(ref, req.scope);
      if (!v.ok) {
        throw new AiBrokerError(v.error, 'context-ref-invalid');
      }
    }
    // Budget gate — checked AFTER coord/key/refs so the most
    // common rejection messages take precedence.  When already
    // over the ceiling, no provider request fires.
    try {
      assertWithinBudget(this.host.getAiAudit(), this.host.getBudgetCeiling());
    } catch (e) {
      throw new AiBrokerError(
        (e as Error).message,
        'budget-exceeded'
      );
    }
    let providerResult: AiProviderCallResult;
    try {
      providerResult = await this.provider.call({
        apiKey,
        model: req.model,
        systemPrompt: req.systemPrompt ?? '',
        prompt: req.prompt,
        signal: req.signal
      });
    } catch (e) {
      // Re-throw network / HTTP errors with a typed wrapper so the
      // UI distinguishes "provider down" from "parse failure."
      throw new AiBrokerError(
        e instanceof Error ? e.message : String(e),
        'provider-error'
      );
    }
    const parsed = this.provider.parse(providerResult.raw);
    if (parsed && isAiResponse({ ...parsed, raw: '', tokensIn: 0, tokensOut: 0, responseId: '' })) {
      return {
        safe: parsed.safe ?? '',
        dmOnly: parsed.dmOnly ?? '',
        sources: parsed.sources ?? [],
        raw: providerResult.raw,
        tokensIn: providerResult.tokensIn,
        tokensOut: providerResult.tokensOut,
        responseId: providerResult.responseId
      };
    }
    // Provider returned text that didn't match the AiResponse shape;
    // degrade rather than throw so the DM at least sees what
    // happened (raw text lands in the audit chain regardless).
    const fallback = parseFailureResponse(providerResult.raw);
    return {
      ...fallback,
      tokensIn: providerResult.tokensIn,
      tokensOut: providerResult.tokensOut,
      responseId: providerResult.responseId
    };
  }
}
